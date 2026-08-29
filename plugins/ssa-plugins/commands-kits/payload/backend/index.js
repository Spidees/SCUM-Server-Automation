'use strict';

/**
 * Chat Commands & Kits — a complete, admin-configurable in-game command & reward system.
 *
 *   • Custom /commands: reply text AND/OR run any admin action(s) — teleport, give currency, spawn,
 *     weather… — with rich {tokens}, optional cost, cooldown and per-player allow/deny.
 *   • Welcome message on join.
 *   • Reward packs / kits: items + vehicles (picker), free or money/gold/fame, on join or via a
 *     command; cooldown, per-player claim limit, mutually-exclusive groups, allow/deny.
 *   • Spawn-failure fuses: if nothing can be delivered, no currency is taken and no claim is spent.
 *   • Fully configurable text for every player-facing line (any language) via {tokens}.
 *   • Admin can inspect and reset who has claimed what (so a player can use a one-time reward again).
 *
 * Everything runs through the SSA Bridge and is managed from the admin panel.
 */

const DEFAULT_ITEM_CMD = '#SpawnItem {item} {count} Location {steamid}';
const DEFAULT_VEH_CMD  = '#SpawnVehicle {code} {count} Location {steamid}';
// A container (backpack/vest/crate) filled with {sets} sets of {fill} — #SpawnInventoryFullOf. This
// command has NO Location arg: it spawns on whoever runs it, so we run it THROUGH the target player
// (executor = their SteamID) — no Location in the template.
const DEFAULT_INV_CMD  = '#SpawnInventoryFullOf {container} {sets} {fill}';
const DEFAULT_CHANNEL  = 'local';   // channels that reliably show to ONE targeted player

// Default player-facing system messages (all overridable in config → any language). Tokens available:
// {player} {pack} {cmd} {h} (hours left) {cost} {currency} plus every rich token.
// `insufficient` gets three more: {have} — the balance the refusal was actually decided on — {pool},
// which NAMES the pool it came from ("bank account" / "gold balance" / "fame"), and {asof}, which is
// empty when the game answered and says so when only the last save could. A player told just "you
// can't afford it" knows neither which of their balances was looked at nor how old it was.
const DEFAULT_MSG = {
  cooldown:      'You already used {pack}. Try again in ~{h}h.',
  alreadyClaimed:'You already claimed {pack}.',
  groupLocked:   'You already picked from this set — {pack} is locked.',
  maxClaims:     'You have reached the limit for {pack}.',
  notAllowed:    "You can't use {pack}.",
  insufficient:  "You can't afford {pack} ({cost} {currency}) — your {pool} has {have}{asof}.",
  notInGame:     'Get fully spawned in first, then try again.',
  spawnFailed:   "Couldn't deliver {pack} right now — nothing was taken. Try again.",
  // {window} is the manager's own sentence for the window that refused, and it always names the
  // clock — "from 20:00" is meaningless to a player who does not know whether that is the server's
  // evening or the game's, and on a server with a fast day cycle those are wildly different.
  closed:        '⏳ {pack} is not available right now — {window}',
};

// ── the shipped configuration, IN THE BACKEND ─────────────────────────────────────────────────────
//
// This used to live only in `payload/config.json`, and that one fact is what made the plugin's whole
// admin tab go blank. `host.config.get()` is a `safe()` wrapper over a file read: a library copy that
// is missing, half-written, not valid JSON, or simply older than the keys this version needs comes
// back as `{}` — indistinguishable from "the owner configured nothing". With the defaults in the file
// and nowhere else, `{}` meant no commands, no packs, no welcome message and no explanation, on a
// screen an owner opens BEFORE the server has ever run. Its sibling `better-squads` merges its own
// DEFAULTS and therefore cannot draw an empty screen whatever the file says; this one could not draw
// anything else.
//
// So the file is now the OWNER's copy and this is the floor. They must stay equal —
// `check-plugin-balance --offline` compares them key by key and fails when they drift.
//
// **Absent is not empty.** The merge is by KEY PRESENCE, never by truthiness: a config that HAS
// `"commands": []` is an owner who deleted every command and must keep an empty list, while a config
// with no `commands` key at all has never been written and gets the shipped three. Reading those two
// as the same thing is the `readJson(path, {})` mistake that has already cost this project data.
const DEFAULTS = {
  joinDelaySeconds: 0,
  commandPrefix: '/',
  replyChannel: DEFAULT_CHANNEL,
  itemSpawnCmd: DEFAULT_ITEM_CMD,
  vehicleSpawnCmd: DEFAULT_VEH_CMD,
  invSpawnCmd: DEFAULT_INV_CMD,
  spawnGapMs: 180,
  spawnTries: 3,
  messages: {},
  welcome: {
    enabled: true,
    channel: 'local',
    message: 'Welcome to {server}, {player}!\nThere are {online}/{maxplayers} players online. Type /info for details.',
  },
  commands: [
    { name: 'info', enabled: true, channel: 'local', broadcast: false, cooldownHours: 0, cost: { currency: 'free', amount: 0 }, allow: [], deny: [], actions: [],
      response: 'Welcome, {player}!\nPlayers online: {online}/{maxplayers}\nType /discord for our community link.' },
    { name: 'discord', enabled: true, channel: 'local', broadcast: false, cooldownHours: 0, cost: { currency: 'free', amount: 0 }, allow: [], deny: [], actions: [],
      response: 'Join our Discord: discord.gg/yourserver' },
    { name: 'rules', enabled: true, channel: 'local', broadcast: false, cooldownHours: 0, cost: { currency: 'free', amount: 0 }, allow: [], deny: [], actions: [],
      response: 'Server rules:\n1) No cheating\n2) Be respectful\n3) Have fun!' },
  ],
  packs: [
    { id: 'welcome', name: 'Welcome Pack', enabled: true, trigger: 'welcome', command: '', cooldownHours: 0, maxClaims: 0, group: '',
      cost: { currency: 'free', amount: 0 }, allow: [], deny: [], items: [], vehicles: [], actions: [], replyChannel: 'local',
      message: 'Welcome to {server}, {player}! Enjoy your starter pack.' },
    { id: 'daily', name: 'Daily Kit', enabled: true, trigger: 'command', command: 'daily', cooldownHours: 24, maxClaims: 0, group: '',
      cost: { currency: 'free', amount: 0 }, allow: [], deny: [], items: [], vehicles: [], actions: [], replyChannel: 'local',
      message: "Here's your daily kit, {player}! Come back in 24h." },
  ],
  discord: { channelId: '', buttonLabel: '', title: '', description: '' },
};
const cloneDefault = (k) => JSON.parse(JSON.stringify(DEFAULTS[k]));
function withDefaults(raw) {
  const c = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const out = {};
  for (const k of Object.keys(DEFAULTS)) out[k] = Object.prototype.hasOwnProperty.call(c, k) ? c[k] : cloneDefault(k);
  for (const k of Object.keys(c)) if (!(k in out)) out[k] = c[k];
  return out;
}

module.exports = {
  async register(host) {
    const offs = [];
    const clear = () => { while (offs.length) { try { offs.pop()(); } catch { /* ignore */ } } };
    // SECURITY: one claim of a given resource (command / group / pack) per player may be in flight at a
    // time. A kit takes seconds to drain the throttled+retried spawn queue — WITHOUT this lock a player
    // could fire the command again mid-delivery (past the 1.5 s chat dedup) and double-claim a one-time
    // reward or bypass cooldown / exclusive groups, because `recordUse` only lands after delivery.
    const inFlight = new Set();
    // Never the raw file: the shipped floor is merged in, so a config that could not be read draws a
    // complete, editable screen instead of an empty one. See DEFAULTS above.
    const cfg = () => withDefaults(host.config.get());
    const packId = (p, i) => String((p && (p.id || p.command || p.name)) || ('pack' + i));

    // ── channels ──────────────────────────────────────────────────────────────
    // A reply to ONE player must use a channel the client renders for a single recipient. Local/Global/
    // Squad/Admin do; ServerMessage(6)/CommandsOnly(5) do NOT — clamp them so a reply is never invisible.
    const TARGET_OK = { local: 1, global: 1, squad: 1, admin: 1, server: 1 };
    const safeChannel = (ch) => (ch && TARGET_OK[ch]) ? ch : DEFAULT_CHANNEL;
    const replyChannelFor = (obj) => safeChannel((obj && (obj.channel || obj.replyChannel)) || cfg().replyChannel || DEFAULT_CHANNEL);
    const msgText = (key) => (cfg().messages || {})[key] || DEFAULT_MSG[key] || '';

    // ── context / tokens ────────────────────────────────────────────────────────
    const serverName = () => { try { return (host.server.info() || {}).name || 'the server'; } catch { return 'the server'; } };
    // host.server.status() is ASYNC (returns a Promise) — reading .OnlinePlayers off it gave undefined →
    // tokens showed "?". So {online} comes from the SYNC player list, and {maxplayers} from a cache we
    // refresh opportunistically off the async status.
    let _maxPlayers = null;
    function refreshMax() { try { const p = host.server.status(); if (p && typeof p.then === 'function') p.then((s) => { if (s && s.MaxPlayers != null) _maxPlayers = s.MaxPlayers; }).catch(() => {}); else if (p && p.MaxPlayers != null) _maxPlayers = p.MaxPlayers; } catch { /* ignore */ } }
    function onlineCount() { try { const a = host.players.online(); return Array.isArray(a) ? a.length : null; } catch { return null; } }
    refreshMax();   // populate the cache before the first player message
    function playerLoc(steamId) {
      try {
        const w = host.map.world() || {};
        const list = w.players || w.player || [];
        const p = (Array.isArray(list) ? list : []).find((pl) => String(pl.steamId || pl.steamid || pl.SteamID) === String(steamId));
        if (p) return { x: Math.round(p.x || 0), y: Math.round(p.y || 0), z: Math.round(p.z || 0) };
      } catch { /* not ready */ }
      return null;
    }
    const sidOf = (pl) => String((pl && (pl.SteamID || pl.steamId || pl.steamid || pl.steam_id || pl.user_id)) || '');
    const nmOf = (pl) => (pl && (pl.PlayerName || pl.name || pl.playerName)) || '';
    function playerName(steamId, fallback) {
      try {
        const list = host.players.online() || [];
        const p = (Array.isArray(list) ? list : []).find((pl) => sidOf(pl) === String(steamId));
        if (p) return nmOf(p) || fallback || '';
      } catch { /* ignore */ }
      return fallback || '';
    }
    const fill = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
    // minutes → "3d 4h" / "5h 20m" / "12m" — human-readable durations for {playtime} / {survived}.
    const fmtDuration = (mins) => { mins = Math.max(0, Math.floor(Number(mins) || 0)); const d = Math.floor(mins / 1440), hh = Math.floor((mins % 1440) / 60), mm = mins % 60; return d ? `${d}d ${hh}h` : hh ? `${hh}h ${mm}m` : `${mm}m`; };

    // SECURITY: player-controlled values (their in-game NAME, chat ARGS) get substituted into admin
    // commands that we send straight to the SCUM console via the bridge. A crafted name/arg like
    // "x #Ban <admin>" or one with a newline could break out and run a SECOND command. So neutralise
    // them before substitution: names keep normal punctuation (they also show in chat) but lose the
    // command-breakers `#` and newlines; args are restricted to a safe code/number charset.
    const safeName = (s) => String(s == null ? '' : s).replace(/[\r\n\t\0]/g, '').replace(/#/g, '').replace(/\s+/g, ' ').trim().slice(0, 48) || 'player';
    const safeArg = (s) => String(s == null ? '' : s).replace(/[^\w .\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 48);
    const safeSid = (s) => (/^\d{17}$/.test(String(s || '')) ? String(s) : '');

    // Rich token substitution — heavy lookups only run if the template actually uses them. `extra`
    // lets a caller freeze values (e.g. the player's position at command time, for teleport-and-back).
    function subst(tpl, name, steamId, ctx, extra) {
      tpl = String(tpl || '');
      const now = new Date();
      const map = {
        player: safeName(name), name: safeName(name), steamid: safeSid(steamId),
        channel: (ctx && ctx.channel) || '', args: safeArg((ctx && ctx.argString) || ''),
        server: serverName(), date: now.toLocaleDateString(), time: now.toLocaleTimeString(),
      };
      if (/\{(online|maxplayers)\}/i.test(tpl)) { refreshMax(); const on = onlineCount(); map.online = on != null ? on : '?'; map.maxplayers = _maxPlayers != null ? _maxPlayers : '?'; }
      // DISPLAY ONLY, and deliberately the SAVED figures. `subst` is synchronous and is called from
      // a dozen message paths; asking the running game means an await in every one of them, for a
      // number nobody spends. Nothing here decides anything — every affordability gate and every
      // charge goes through `balanceOf`/`affordGate` below, which ask the game first.
      //   {money} = {bank} = the bank account (ECurrencyType Normal, the pool that is charged)
      //   {gold}  = the gold pool          {cash} = `user_profile.money_balance`, a legacy column
      //                                            observed NULL for every profile on this build
      // The `insufficient` line does NOT use these: it is filled with the live {have} the refusal
      // was actually decided on, before `subst` ever runs.
      if (/\{(money|bank|cash|gold)\}/i.test(tpl)) { const f = host.players.finances(steamId) || {}; map.money = f.bank || 0; map.bank = f.bank || 0; map.cash = f.cash || 0; map.gold = f.gold || 0; }
      if (/\{(fame|kills|deaths|kd|pvpkills|headshots|zombiekills|animalkills|longestkill|distance|lockspicked|fishcaught|playtime|survived)\}/i.test(tpl)) {
        const s = host.players.stats(steamId) || {};
        map.fame = s.FamePoints || 0; map.kills = s.Kills || 0; map.deaths = s.Deaths || 0; map.pvpkills = s.PvpKills || 0;
        map.headshots = s.Headshots || 0; map.zombiekills = s.ZombieKills || 0; map.animalkills = s.AnimalKills || 0;
        map.longestkill = Math.round(s.LongestKill || 0); map.distance = Math.round(s.Distance || 0); map.lockspicked = s.LocksPicked || 0; map.fishcaught = s.FishCaught || 0;
        map.kd = Number(s.Deaths) > 0 ? (Number(s.Kills || 0) / Number(s.Deaths)).toFixed(2) : String(s.Kills || 0);
        map.playtime = fmtDuration(s.PlayTime || 0); map.survived = fmtDuration(s.MinutesSurvived || 0);
      }
      // Squad name is `q.name` (lowercase) — NOT `q.Name`/`q.SquadName`, which are undefined and made
      // {squad} come out empty. memberCount holds the size.
      if (/\{(squad|squadsize)\}/i.test(tpl)) { const q = host.players.squad(steamId) || {}; map.squad = q.name || ''; map.squadsize = q.memberCount || ''; }
      if (/\{(strength|constitution|dexterity|intelligence)\}/i.test(tpl)) { const at = (host.players.skills(steamId) || {}).attributes || {}; map.strength = at.strength != null ? at.strength : ''; map.constitution = at.constitution != null ? at.constitution : ''; map.dexterity = at.dexterity != null ? at.dexterity : ''; map.intelligence = at.intelligence != null ? at.intelligence : ''; }
      if (/\{(x|y|z|location)\}/i.test(tpl)) { const l = (extra && extra.loc) || playerLoc(steamId) || {}; map.x = Math.round(l.x || 0); map.y = Math.round(l.y || 0); map.z = Math.round(l.z || 0); map.location = l.x != null ? `${map.x}, ${map.y}` : ''; }
      if (/\{saved_[xyz]\}/i.test(tpl)) { const sp = host.store.get('pos:' + steamId, null) || {}; map.saved_x = Math.round(sp.x || 0); map.saved_y = Math.round(sp.y || 0); map.saved_z = Math.round(sp.z || 0); }
      if (extra) for (const k of Object.keys(extra)) if (k !== 'loc' && extra[k] != null) map[k.toLowerCase()] = extra[k];
      let out = tpl.replace(/\{arg(\d+)\}/gi, (_, n) => safeArg((ctx && ctx.args && ctx.args[Number(n) - 1]) || ''));
      out = out.replace(/\{(\w+)\}/g, (m, k) => { const key = k.toLowerCase(); return (key in map) ? String(map[key]) : m; });
      return out;
    }

    // ── currency ────────────────────────────────────────────────────────────────
    /**
     * WHICH POOL. There is exactly one money pool per player and one gold pool, and this plugin
     * charges both of them by name, so it can say which one it took from.
     *
     * The game's `ECurrencyType` is `{ None=0, Normal=1, Gold=2 }` and a player carries exactly one
     * balance per value: `_moneyBalanceRep` for Normal, `_goldBalanceRep` for Gold, both written by
     * the single setter `SetCurrencyBalanceRep(ECurrencyType, int64)`. The save keys the same two
     * values the same way — `bank_account_registry_currencies.currency_type` is 1 for money and 2
     * for gold. So the live `money` reading, `#ChangeCurrencyBalance Normal` and the manager's
     * `finances().bank` are all ONE pool: the bank account. Nothing here can charge the wrong one.
     *
     * `finances().cash` (`user_profile.money_balance`) is NOT that pool and is deliberately never
     * read to decide anything: it carries no currency type at all, so it cannot be the gold side of
     * anything, and it is a legacy column observed NULL for every profile on this build. Judging
     * affordability on it would refuse solvent players outright.
     */
    const poolWord = (cur) => (cur === 'gold' ? 'gold balance' : cur === 'fame' ? 'fame' : 'bank account');
    const finite = (v) => ((typeof v === 'number' && Number.isFinite(v)) ? v : null);

    // The bridge's live `money` and `fame` groups are BOTH off by default, so the commonest reason a
    // balance falls back to the save is a switch nobody has turned on. Said once per group per boot:
    // it would otherwise fire on every paid claim.
    const _warnedLiveOff = {};
    function warnLiveOff(currency) {
      const grp = currency === 'fame' ? 'fame' : 'money';
      if (_warnedLiveOff[grp]) return;
      _warnedLiveOff[grp] = true;
      host.logger.warn(`the SSA Bridge answered about this player but not about their ${grp} — turn on Bridge → Live data → "${grp === 'fame' ? 'Fame points and level' : 'Money, gold and account number'}" (that group ships OFF). Until then affordability is judged on the LAST SAVE, which is as old as your save interval.`);
    }

    /**
     * What the player has, for the currency being asked for — and WHERE the figure came from.
     *
     * Returns `{ have, source }`. `source` is `'live'` (the running game), `'db'` (the last save) or
     * `null`, and `have` is `null` whenever nothing could answer.
     *
     * **The game first, the save only as a fallback.** Everything below this reads `SCUM.db`, which
     * lags by the save interval — a player can send their money to a friend and claim a kit before
     * the save catches up. `host.players.live()` asks the running game and only falls back when it
     * cannot answer, which is the only correct order: the save is never MORE current than the game.
     *
     * A live answer can still be silent about money: the bridge's `money`/`fame` groups are OFF by
     * default, and then the key is simply ABSENT from the payload. Absent is not zero — reading it
     * as zero would tell every player on a default install that they are broke — so this falls
     * through to the save and labels the result `'db'` rather than pretending it is live.
     *
     * `have: null` for "cannot say" is the other half. `finances()` and `stats()` answer null for an
     * unknown profile or a failed read, and turning that into ZERO once told a solvent player they
     * were broke and refused the kit, with no way for them to tell it from actually being poor. Not
     * knowing is a reason to let the charge decide, not a reason to say no.
     */
    async function balanceOf(steamId, currency) {
      if (currency !== 'money' && currency !== 'gold' && currency !== 'fame') return { have: null, source: null };
      let p = null;
      try { p = await host.players.live(steamId); } catch (e) { p = null; }
      if (p && p.source === 'live') {
        // Live keys: `money` (ECurrencyType Normal), `gold` (Gold), `fame`.
        const v = currency === 'money' ? finite(p.money) : currency === 'gold' ? finite(p.gold) : finite(p.fame);
        if (v != null) return { have: v, source: 'live' };
        warnLiveOff(currency);
      } else if (p && p.source === 'db') {
        // The same three values as the game reports, under the save's own names — `bank` is the
        // type-1 bank row, i.e. the identical pool the live `money` reading names.
        const v = currency === 'money' ? finite(p.bank) : currency === 'gold' ? finite(p.gold) : finite(p.FamePoints);
        return { have: v, source: v == null ? null : 'db' };
      }
      // Either the game answered without the money group, or nothing answered at all. Ask the save
      // directly rather than reporting "cannot say" when a saved figure does exist.
      const v = currency === 'fame'
        ? finite((host.players.stats(steamId) || {}).FamePoints)
        : finite((host.players.finances(steamId) || {})[currency === 'gold' ? 'gold' : 'bank']);
      return { have: v, source: v == null ? null : 'db' };
    }

    /**
     * The affordability gate, in one place because both call sites must answer it identically.
     *
     * Returns `null` to let the claim through, or `{ have, source }` to refuse.
     *
     * **Stale is not acceptable for taking money — but the two ways of being wrong are not equally
     * expensive, and that is what decides the `'db'` case.** The charge is a DELTA
     * (`#ChangeCurrencyBalance Normal -N`), so a stale reading can never make this plugin take the
     * wrong AMOUNT; it can only open or close the gate wrongly. Letting a stale-poor player through
     * does not fail safe: the game permits a negative bank balance (observed down to −1750), so the
     * kit is handed over on credit and cannot be taken back. Refusing a stale-rich player costs a
     * retry after the next save, and the message says which figure was used so they are not left
     * guessing. So a saved figure that is short still refuses, out loud.
     */
    async function affordGate(steamId, cost) {
      const bal = await balanceOf(steamId, cost.currency);
      if (bal.have == null) return null;                       // cannot say — the charge decides
      if (bal.have >= Number(cost.amount)) return null;
      return bal;
    }
    /** The three tokens an `insufficient` line needs, so both call sites fill them identically. */
    const shortVars = (short, currency) => ({
      have: short.have,
      pool: poolWord(currency),
      asof: short.source === 'db' ? ' — that is your balance as of the last server save, so try again shortly' : '',
    });
    /**
     * Did that bridge call actually reach the game?
     *
     * `host.server.command` has TWO ways of not working and they are not the same answer:
     *
     *   { ok: false }                  the bridge refused, or is not there. It did not run.
     *   { ok: true, confirmed: false } manager 5.x / bridge 2.x. Nobody was online, the owner has
     *                                  `allowNoExecutor` on, so the bridge handed the command to
     *                                  the game's STATIC entry point — which returns void. That
     *                                  says "handed over" and nothing more: not that the game
     *                                  accepted it, not even that it recognised it.
     *
     * Everything here charges players or spends a one-time claim on the strength of that answer, so
     * the second one cannot be read as success. `confirmed` is ABSENT on every executor-backed call
     * (which is every call on a server with somebody on it), and absent is a real confirmation —
     * only an explicit `false` is the unverifiable case, so this stays correct against an older
     * manager that never sends the field.
     */
    const cmdOutcome = (r) => (!r || r.ok === false) ? 'refused' : (r.confirmed === false ? 'unconfirmed' : 'ok');

    /**
     * Take the price. Returns `{ ok, why }` — `why` is 'refused' or 'unconfirmed' when it did not.
     *
     * The result used to be thrown away. `host.server.command` RETURNS false when the bridge refuses
     * or is offline — it does not throw — so a charge that never landed looked exactly like one that
     * did, and the player kept a kit they had not paid for. Silently, every time.
     *
     * Unlike a rental, this cannot be undone: the items are already in their inventory and taking
     * them back is not something to do automatically. So the honest thing is to KNOW, and to put it
     * where an admin will see it — the caller logs it, alerts, and marks the delivery unpaid in the
     * activity log so it can be reconciled by hand.
     */
    async function charge(steamId, cost) {
      const amt = Math.abs(Number(cost.amount) || 0); if (amt <= 0) return { ok: true, why: null };
      let cmd = null;
      // A DELTA, never an absolute set. That is what keeps a stale reading out of the amount: the
      // game applies `-N` to whatever the balance really is at that instant, so this plugin never
      // has to compute a new balance from a figure it read earlier.
      if (cost.currency === 'gold') cmd = `#ChangeCurrencyBalance Gold -${amt} ${steamId}`;
      else if (cost.currency === 'fame') cmd = `#ChangeFamePoints -${amt} ${steamId}`;
      else if (cost.currency === 'money') cmd = `#ChangeCurrencyBalance Normal -${amt} ${steamId}`;
      if (!cmd) return { ok: true, why: null };    // free / unknown currency — nothing to take
      try {
        const out = cmdOutcome(await host.server.command(cmd));
        if (out === 'ok') host.logger.debug(`took ${amt} from ${steamId}'s ${poolWord(cost.currency)}`);
        return out === 'ok' ? { ok: true, why: null } : { ok: false, why: out };
      } catch (e) {
        host.logger.warn(`charge command threw for ${steamId}: ${e.message}`);
        return { ok: false, why: 'refused' };
      }
    }
    /**
     * One place to say "they were not charged", so both call sites report it the same way.
     *
     * The two failures need different words. A REFUSED charge definitely did not happen. An
     * UNCONFIRMED one may well have — the debit went to the game's static dispatch on an empty
     * server and there is no return value to read — so telling an admin it "did NOT go through"
     * would send them to reverse a charge that might have landed. Both are worth an alert; only one
     * of them is a fact.
     */
    function reportUnpaid(steamId, name, cost, what, why) {
      // Naming the pool is not decoration: an owner reconciling this by hand has to know which
      // balance to look at, and "500 money" does not say whether that is the bank account or gold.
      const price = `${Math.abs(Number(cost.amount) || 0)} ${cost.currency} (${poolWord(cost.currency)})`;
      if (why === 'unconfirmed') {
        host.logger.warn(`${name || steamId} received "${what}" and the ${price} charge could NOT BE CONFIRMED — nobody was online, so it went through the game's static dispatch, which reports nothing back. It may or may not have been taken; check their balance before reversing anything.`);
      } else {
        host.logger.warn(`${name || steamId} received "${what}" but the ${price} charge did NOT go through — they have it for free. The items cannot be taken back automatically; reconcile by hand if it matters.`);
      }
      try {
        host.notify('admin.alert', {
          message: why === 'unconfirmed'
            ? `Commands & Kits: ${name || steamId} got "${what}" and the ${price} charge could not be confirmed (nobody online). Check their balance.`
            : `Commands & Kits: ${name || steamId} got "${what}" without paying (${price}) — the charge failed. Check the bridge.`,
          severity: 'warning',
        });
      } catch (e) { /* notifications are optional */ }
    }
    const isPaid = (cost) => !!(cost && cost.currency && cost.currency !== 'free' && Number(cost.amount) > 0);

    // ── claim store (per-player usage) ────────────────────────────────────────────
    // claim:<id>:<sid>  → { at, name }   last use (cooldown / once)
    // count:<id>:<sid>  → number         total uses (maxClaims)
    // group:<grp>:<sid> → <id>           which pack was chosen from a mutex group
    const K = {
      claim: (id, sid) => `claim:${id}:${sid}`,
      count: (id, sid) => `count:${id}:${sid}`,
      group: (g, sid) => `group:${g}:${sid}`,
    };
    const atOf = (rec) => (rec && typeof rec === 'object') ? Number(rec.at || 0) : Number(rec || 0);
    const nameOf = (rec) => (rec && typeof rec === 'object') ? (rec.name || '') : '';
    // allow/deny entries come from the UI as {steamId,name} objects (or bare strings) → normalise to IDs.
    const asIds = (arr) => (Array.isArray(arr) ? arr.map((e) => (e && typeof e === 'object') ? String(e.steamId || e.steamid || e.SteamID || '').trim() : String(e).trim()).filter(Boolean) : []);
    function allowed(obj, sid) {
      const deny = asIds(obj && obj.deny); if (deny.includes(String(sid))) return false;
      const allow = asIds(obj && obj.allow); if (allow.length) return allow.includes(String(sid));
      return true;
    }
    function cooldownLeftH(id, cdHours, sid) {
      const cd = Math.max(0, Number(cdHours) || 0); if (cd <= 0) return 0;
      const last = atOf(host.store.get(K.claim(id, sid), 0));
      return Math.ceil(Math.max(0, cd * 3600e3 - (Date.now() - last)) / 3600e3);
    }
    // ── time windows ─────────────────────────────────────────────────────────────
    //
    // "From when to when is this available" — a weekend kit, a command that stops overnight, a
    // happy hour. The evaluator is the MANAGER'S (`host.time`), shared with Vehicle Rental, so a
    // window written on one tab means exactly what it means on the other. It runs on the SERVER'S
    // WALL CLOCK, never the game's day/night cycle; the full argument is in the manager's
    // `timeWindows.js` and the short version is on every screen and in every refusal.
    //
    // A window lives on a command or a pack as `windows: [ { days, from, to, tz } ]`. It is NOT in
    // the shipped defaults, and that is deliberate: an absent key reads as an empty list, an empty
    // list is always open, and so every config ever written keeps behaving exactly as it does — with
    // `payload/config.json` and `DEFAULTS` still identical, which `check-plugin-balance` requires.
    //
    // On a manager too old to evaluate one, a CONFIGURED window is treated as CLOSED, not ignored.
    // The alternative is a weekend-only kit handed out every day of the week with nothing to show
    // for it; this way an owner hears about it the first morning.
    let _warnedNoTimeApi = false;
    function timeApi() {
      const t = host.time;
      if (t && typeof t.isOpen === 'function') return t;
      if (!_warnedNoTimeApi) {
        _warnedNoTimeApi = true;
        host.logger.warn('this manager is too old to evaluate time windows (host.time is missing), so every command or pack that has one is treated as CLOSED. Update the manager, or clear the time windows in the plugin\'s admin tab.');
      }
      return null;
    }
    const hasWindows = (e) => !!(e && Array.isArray(e.windows) && e.windows.length);
    /**
     * Tidy a window list on the way IN, before it is stored.
     *
     * A different job from `host.time.validate()`, which refuses what cannot be read: this fixes what
     * is merely untidy — `days` out of order, a day listed twice, `"3"` where a number was meant,
     * whitespace around a time. The panel sends clean data; a config hand-edited, copied from another
     * server or written by an older panel does not, and each of those would otherwise reach an owner
     * as a kit that quietly stopped being claimable.
     *
     * All seven days is the same as none — both mean every day — so it is stored in the empty form,
     * leaving one representation rather than two that have to agree.
     */
    function normalizeWindows(list) {
      if (!Array.isArray(list)) return [];
      return list.map((w) => {
        if (!w || typeof w !== 'object') return w;
        const days = [];
        (Array.isArray(w.days) ? w.days : []).forEach((d) => {
          const n = Number(d);
          // Positive form: every comparison against NaN is false, so `n < 1 || n > 7` would let one
          // through. That shape has cost this project six separate bugs elsewhere.
          if (Number.isInteger(n) && n >= 1 && n <= 7 && days.indexOf(n) < 0) days.push(n);
        });
        days.sort((a, b) => a - b);
        return { days: days.length === 7 ? [] : days, from: String(w.from == null ? '' : w.from).trim(), to: String(w.to == null ? '' : w.to).trim(), tz: w.tz || null };
      });
    }
    /** Why this entry is out of hours, in words a player can act on — or `''` when it is open. */
    function windowWhy(entry) {
      if (!hasWindows(entry)) return '';
      const t = timeApi();
      if (!t) return 'time windows need a newer manager, so this is switched off until an admin updates it';
      const r = t.isOpen(entry.windows);
      return r.open ? '' : r.why;
    }

    // Why a pack/command can't be used right now — or null if it can. `cmd` treats cooldown only.
    function blockReason(entry, id, sid, isCommand) {
      if (!allowed(entry, sid)) return 'notAllowed';
      // After allow/deny and before everything else. A player who is denied outright must not be
      // told to come back at eight; a player who is merely early should hear that before they hear
      // about a cooldown that is not what is stopping them.
      if (windowWhy(entry)) return 'closed';
      if (!isCommand && entry.group) { const chosen = host.store.get(K.group(entry.group, sid), ''); if (chosen && chosen !== id) return 'groupLocked'; }
      if (!isCommand) { const max = Math.max(0, Number(entry.maxClaims) || 0); if (max > 0 && (Number(host.store.get(K.count(id, sid), 0)) || 0) >= max) return 'maxClaims'; }
      const cd = Math.max(0, Number(entry.cooldownHours) || 0);
      const last = atOf(host.store.get(K.claim(id, sid), 0));
      if (cd > 0) { if ((Date.now() - last) < cd * 3600e3) return 'cooldown'; }
      else if (!isCommand && entry.trigger === 'welcome') { if (last !== 0) return 'alreadyClaimed'; }
      return null;
    }
    function recordUse(id, sid, name, group) {
      host.store.set(K.claim(id, sid), { at: Date.now(), name: name || '' });
      host.store.set(K.count(id, sid), (Number(host.store.get(K.count(id, sid), 0)) || 0) + 1);
      if (group) host.store.set(K.group(group, sid), id);
    }

    // ── serialized spawn queue ───────────────────────────────────────────────────
    // A burst of claims (many players at once, or a big kit) firing spawns back-to-back overwhelmed the
    // bridge — the game occasionally faulted mid-dispatch ("dispatch faulted") and that item was silently
    // lost. So every spawn now goes through ONE global queue: dispatched one at a time with a small gap,
    // and each command is retried a few times before giving up. Result: no burst, and a transient fault
    // no longer drops an item — the player reliably gets the whole kit.
    const RETRY_BACKOFF_MS = 600;  // wait before a retry
    const clampN = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; };
    const spawnGap = () => clampN(cfg().spawnGapMs, 0, 3000, 180);   // throttle between spawns (config-tunable)
    const spawnTries = () => clampN(cfg().spawnTries, 1, 6, 3);      // attempts per spawn (config-tunable)
    function qWait(ms) { return new Promise((res) => host.schedule.after(ms, res)); }
    let spawnQueue = [];
    let spawnBusy = false;
    let currentJob = null;   // the spawn currently being dispatched (for the live queue view)

    // ── activity log + counters (shown live in the panel, styled like the mine-protection log) ──
    let stats = Object.assign({ deliveries: 0, ok: 0, failed: 0 }, host.store.get('ckstats', {}) || {});
    let recent = (host.store.get('recent', []) || []).slice(0, 150);
    function persistStats() { try { host.store.set('ckstats', stats); } catch { /* ignore */ } }
    function pushRecent(rec) {
      recent.unshift(rec);
      if (recent.length > 150) recent = recent.slice(0, 150);
      try { host.store.set('recent', recent.slice(0, 150)); } catch { /* ignore */ }
      try { host.realtime.toAdmins('commands-kits:event', { rec: rec, stats: stats, queue: spawnQueue.length }); } catch { /* realtime optional */ }
    }
    function statusSnapshot() {
      return {
        queue: spawnQueue.length, running: spawnBusy, stats: stats, recent: recent,
        // Live queue for the panel: the item being dispatched now + what's waiting (labels only).
        current: currentJob ? currentJob.label : null,
        queueItems: spawnQueue.slice(0, 50).map((j) => j.label),
        // Deliveries, failures and the queue are all necessarily 0 before the server has ever run, and
        // a row of zeroes with nothing said about them reads as a broken plugin rather than an idle
        // one. `running` above is the SPAWN QUEUE's own flag and answers a different question, which is
        // why this is its own key. Feature-detected: an older manager has no `isRunning`.
        serverRunning: (host.server && typeof host.server.isRunning === 'function') ? !!host.server.isRunning() : null,
      };
    }

    const MAX_QUEUE = 4000;   // hard ceiling so a spam/misconfig can't grow the queue (and memory) without bound
    // Enqueue one spawn command; resolves true once it actually landed (after retries), false if it
    // couldn't be delivered at all. opts (e.g. { executor }) is passed straight through to the bridge.
    function enqueueSpawn(cmd, opts, label) {
      return new Promise((resolve) => {
        if (spawnQueue.length >= MAX_QUEUE) { host.logger.warn(`[spawn-queue] full (${MAX_QUEUE}) — dropping "${label}"`); return resolve(false); }
        spawnQueue.push({ cmd: cmd, opts: opts, label: label, resolve: resolve });
        if (spawnQueue.length > 1) host.logger.debug(`[spawn-queue] queued "${label}" (depth ${spawnQueue.length})`);
        pumpQueue();
      });
    }
    async function pumpQueue() {
      if (spawnBusy) return;
      spawnBusy = true;
      try {
        while (spawnQueue.length) {
          const job = spawnQueue.shift();
          currentJob = job;
          const tries = spawnTries();
          let ok = false;
          for (let attempt = 1; attempt <= tries && !ok; attempt++) {
            // `cmdOutcome` and not `r.ok !== false`: an UNCONFIRMED dispatch is not a landed spawn.
            // It only happens when nobody is ready in game — which for a kit means the claimant is
            // not there either — so retrying is the right response, and if every try comes back
            // unconfirmed the delivery fuse must fire rather than charge for items nobody received.
            try {
              const out = cmdOutcome(await host.server.command(job.cmd, job.opts || undefined));
              ok = out === 'ok';
              if (out === 'unconfirmed') host.logger.debug(`[spawn-queue] "${job.label}" try ${attempt}/${tries}: dispatched with nobody online, so the game could not confirm it`);
            }
            catch (e) { host.logger.debug(`[spawn-queue] "${job.label}" try ${attempt}/${tries} error: ${e.message}`); }
            if (!ok && attempt < tries) await qWait(RETRY_BACKOFF_MS);
          }
          if (!ok) host.logger.warn(`[spawn-queue] gave up on "${job.label}" after ${tries} tries`);
          currentJob = null;
          job.resolve(ok);
          if (spawnQueue.length) await qWait(spawnGap());
        }
      } finally { spawnBusy = false; currentJob = null; }
    }

    // ── run a list of admin actions (teleport / give / spawn / …) ─────────────────
    // Each action: { cmd, delaySeconds }. Tokens (incl. the FROZEN {x}{y}{z} from invocation time so
    // "teleport there and back" can return the player to where they started) are substituted per action.
    async function runActions(actions, name, steamId, ctx, frozenLoc, notify) {
      let ran = 0;
      const hide = !notify;   // notify=true → let the game show its own feedback for these admin commands
      // When notifying, run the actions THROUGH the invoking player so the game's feedback reaches THEM
      // (and Location-less commands land on them) instead of a random online player the bridge would pick.
      const opts = notify ? { hide, executor: steamId } : { hide };
      for (const a of (Array.isArray(actions) ? actions : [])) {
        const raw = (a && (a.cmd || a.command)) ? String(a.cmd || a.command) : (typeof a === 'string' ? a : '');
        if (!raw.trim()) continue;
        const cmd = subst(raw, name, steamId, ctx, { loc: frozenLoc, x: frozenLoc && frozenLoc.x, y: frozenLoc && frozenLoc.y, z: frozenLoc && frozenLoc.z });
        const delay = Math.max(0, Number(a && a.delaySeconds) || 0) * 1000;
        // `ran` is the FUSE for charging: the caller only takes the money when an action actually
        // happened. But `host.server.command` reports a refusal by RETURNING `{ ok: false }` rather
        // than throwing, so counting every call that did not throw meant a command whose actions the
        // bridge refused outright still counted as run — and the player paid for it. The catch here
        // was covering a failure mode that never occurs.
        if (delay > 0) {
          host.schedule.after(delay, () => {
            // A delayed action cannot count toward the fuse — the charge has already been decided by
            // the time it fires — but it must not fail silently either.
            Promise.resolve(host.server.command(cmd, opts))
              .then((r) => {
                const out = cmdOutcome(r);
                if (out === 'refused') host.logger.warn(`delayed action "${cmd}" was refused by the bridge`);
                else if (out === 'unconfirmed') host.logger.warn(`delayed action "${cmd}" was dispatched with nobody online — the game could not confirm it ran`);
              })
              .catch((e) => host.logger.debug(`action failed: ${e.message}`));
          });
        } else {
          try {
            // `ran` is the CHARGING fuse, so an unconfirmed dispatch must not increment it: the
            // static entry point returns void, and charging on the strength of "handed over" is
            // exactly what the fuse exists to prevent.
            const out = cmdOutcome(await host.server.command(cmd, opts));
            if (out === 'refused') host.logger.warn(`action "${cmd}" was refused by the bridge`);
            else if (out === 'unconfirmed') host.logger.warn(`action "${cmd}" was dispatched with nobody online — the game could not confirm it ran, so it does not count toward charging`);
            else ran++;
          } catch (e) { host.logger.debug(`action failed: ${e.message}`); }
        }
      }
      return ran;
    }

    // ── deliver a pack (spawn items/vehicles + charge + record + message) ──────────
    async function deliver(steamId, name, pack, i) {
      const id = packId(pack, i);
      // Spawn targets the player by SteamID, so the player just needs to be connected — which they are
      // (they typed the command, or just joined). We do NOT gate on live map coordinates: getMapData()
      // can lag or be empty right after connect, and blocking on it made packs "give nothing".
      const loc = playerLoc(steamId) || { x: 0, y: 0, z: 0 };
      const cost = pack.cost || {};
      const paid = isPaid(cost);
      // When `notify` is on, let the GAME show its own "item spawned" messages to the player as the kit
      // lands (hide:false). Default is silent (hide:true) — same default as the admin console — so a big
      // kit doesn't spam the player's feed. This is separate from the pack's own chat `message`.
      const hide = !pack.notify;
      // The game notifies whoever EXECUTES the command, not the Location target. So when notifying, run
      // the spawn THROUGH the recipient (executor = their SteamID) — otherwise the bridge's 'auto' picks
      // some other online player and THEY get the "item spawned" message. Silent spawns keep 'auto'.
      const notifyExec = pack.notify ? steamId : null;
      const spawnOpts = notifyExec ? { executor: notifyExec, hide } : { hide };
      // The gate asks the RUNNING GAME first (see `affordGate`). It used to read `SCUM.db` only, so
      // a player who had just been paid was told they were broke and one who had just spent it all
      // was let through — for as long as the save interval, every time.
      if (paid) {
        const short = await affordGate(steamId, cost);
        if (short) return { ok: false, reason: 'insufficient', have: short.have, balanceSource: short.source };
        host.logger.debug(`${name || steamId} may claim "${pack.name || id}" (${cost.amount} ${cost.currency} from their ${poolWord(cost.currency)})`);
      }
      const c = cfg();
      // Spawn FIRST. Fuse: if nothing lands, don't charge and don't spend the claim.
      let spawned = 0, total = 0, failed = 0;
      const failedItems = [];   // human-readable names of what didn't land, for the activity log
      // Clamp any spawn count to a sane ceiling so a config typo (or a shop arg) can't ask the game for
      // millions of items and take the server down.
      const clampCount = (n) => Math.max(1, Math.min(1000, Math.floor(Number(n) || 1)));
      // All spawns go through the throttled+retried queue so a burst never faults items away.
      for (const it of (pack.items || [])) {
        if (!it.item) continue; total++;
        const n = clampCount(it.count);
        const label = `${it.item}${n > 1 ? ` ×${n}` : ''}`;
        const cmd = fill(c.itemSpawnCmd || DEFAULT_ITEM_CMD, { item: it.item, count: n, x: loc.x, y: loc.y, z: loc.z, steamid: steamId });
        (await enqueueSpawn(cmd, spawnOpts, `${label} → ${name}`)) ? spawned++ : (failed++, failedItems.push({ code: it.item, label }));
      }
      for (const v of (pack.vehicles || [])) {
        if (!v.code) continue; total++;
        const n = clampCount(v.count);
        const label = `${v.code}${n > 1 ? ` ×${n}` : ''}`;
        const cmd = fill(c.vehicleSpawnCmd || DEFAULT_VEH_CMD, { code: v.code, count: n, x: loc.x, y: loc.y, z: loc.z, steamid: steamId });
        (await enqueueSpawn(cmd, spawnOpts, `${label} → ${name}`)) ? spawned++ : (failed++, failedItems.push({ code: v.code, label }));
      }
      // filled containers (backpack/vest/crate full of an item) — #SpawnInventoryFullOf has no Location,
      // so it's run THROUGH the target player (executor) and appears on them.
      for (const inv of (pack.inventories || [])) {
        if (!inv.container || !inv.fill) continue; total++;
        const sets = clampCount(inv.sets);
        const label = `${inv.container} of ${inv.fill}`;
        const cmd = fill(c.invSpawnCmd || DEFAULT_INV_CMD, { container: inv.container, sets: sets, fill: inv.fill, x: loc.x, y: loc.y, z: loc.z, steamid: steamId });
        (await enqueueSpawn(cmd, { executor: steamId, hide }, `${label} → ${name}`)) ? spawned++ : (failed++, failedItems.push({ code: inv.container, label }));
      }
      const rec = { at: Date.now(), player: name || null, steamId: steamId, reward: pack.name || id, kind: 'kit', spawned: spawned, total: total, failed: failed, failedItems: failedItems };
      stats.deliveries++; stats.ok += spawned; stats.failed += failed; persistStats();
      if (total > 0 && spawned === 0) { pushRecent(rec); return { ok: false, reason: 'spawnFailed' }; }
      // run any extra actions the pack defines (e.g. a buff, a teleport)
      //
      // `ran` is how many the bridge actually ACCEPTED. The command path has always used it as its
      // charging fuse; the pack path threw it away. A pack made only of actions has `total === 0`,
      // so the spawn fuse above cannot fire either — every action could be refused and the player
      // was still charged, and the claim still spent, for nothing whatsoever happening.
      const ran = await runActions(pack.actions, name, steamId, null, loc, pack.notify);
      const hadActions = (Array.isArray(pack.actions) ? pack.actions : [])
        .some((a) => String((a && (a.cmd || a.command)) || (typeof a === 'string' ? a : '')).trim());
      if (total === 0 && hadActions && !ran) {
        host.logger.warn(`"${pack.name || id}" is made only of actions and the bridge refused every one — ${name || steamId} was NOT charged and the claim was not spent.`);
        pushRecent(Object.assign(rec, { failed: 1, actionsRefused: true }));
        return { ok: false, reason: 'spawnFailed' };
      }
      // The charge can fail AFTER the kit has landed, so the record is written once the answer is
      // known. It used to be pushed (and persisted) before charging, which meant an unpaid delivery
      // could only ever be marked in memory — the flag was gone on the next restart, and the log an
      // owner reads afterwards showed it as an ordinary paid one.
      const took = paid ? await charge(steamId, cost) : { ok: true, why: null };
      if (!took.ok) {
        reportUnpaid(steamId, name, cost, pack.name || id, took.why);
        rec.unpaid = true;
        rec.unpaidWhy = took.why;
        rec.price = `${Math.abs(Number(cost.amount) || 0)} ${cost.currency}`;
      }
      // A PARTIAL delivery is charged in full — the kit has one price, its items are not priced
      // individually, so there is nothing to pro-rate and changing that is the owner's decision, not
      // this code's. What is not acceptable is saying nothing: the player pays for five things and
      // gets one, and the only trace was a count buried in the activity log.
      //
      // So the player is told what did not arrive, and the row is marked so an owner can find it and
      // put it right — the same shape as `unpaid` above.
      if (failed > 0) {
        rec.partial = true;
        const missing = failedItems.map((f) => (f && f.label) || (f && f.code) || '?').join(', ');
        host.logger.warn(`"${pack.name || id}" reached ${name || steamId} with ${failed} of ${total} item(s) MISSING (${missing}) — they were charged the full price.`);
        try {
          await host.chat.dm(steamId, `⚠ Part of ${pack.name || id} could not be delivered (${missing}). Tell an admin — you were charged in full.`, { channel: replyChannelFor(pack) });
        } catch (e) { /* the in-game line is best effort; the log and the panel still have it */ }
      }
      pushRecent(rec);
      recordUse(id, steamId, name, pack.group);
      if (pack.message) {
        const ch = replyChannelFor(pack);
        for (const line of subst(pack.message, name, steamId, null).split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean)) host.chat.dm(steamId, line, { channel: ch }).catch(() => {});
      }
      host.logger.info(`delivered "${pack.name || id}" to ${name} (${spawned}/${total} spawned${failed ? `, ${failed} failed` : ''})${paid ? `, ${took.ok ? 'charged' : 'NOT charged'} ${Math.abs(Number(cost.amount) || 0)} ${cost.currency} from their ${poolWord(cost.currency)}` : ''}`);
      return { ok: true, spawned, total, failed };
    }

    /**
     * Claim one pack for one player. THE only way a pack is handed out.
     *
     * In-game chat and the Discord buttons both come through here, so there is no second copy of the
     * rules to drift out of step with this one — every allow/deny list, group lock, claim limit,
     * cooldown, price and per-player in-flight lock applies identically whichever one they used.
     * Writing the Discord path as its own flow would have meant, sooner or later, a kit that Discord
     * hands out twice a day and chat once.
     *
     * Returns `{ ok, reason, message }` and sends nothing itself: chat answers in the game, Discord
     * answers in the interaction, and only the caller knows which.
     */
    async function claimPack(steamId, playerName, pack, i, cmdName, ctx) {
      const id = packId(pack, i);
      // One claim per player per pack (or per GROUP, since a group is a pick-one). Two clicks, or a
      // click and a typed command at the same moment, must not both land.
      const lockKey = 'p:' + ((pack.group && String(pack.group).trim()) ? 'grp:' + String(pack.group).trim() : id) + ':' + steamId;
      if (inFlight.has(lockKey)) return { ok: false, reason: 'inflight', message: null };
      inFlight.add(lockKey);
      try {
        const vars = {
          pack: pack.name || cmdName || id, cmd: cmdName || '',
          h: cooldownLeftH(id, pack.cooldownHours, steamId),
          cost: pack.cost && pack.cost.amount, currency: pack.cost && pack.cost.currency,
          window: windowWhy(pack),
        };
        const block = blockReason(pack, id, steamId, false);
        if (block) return { ok: false, reason: block, message: subst(fill(msgText(block), vars), playerName, steamId, ctx || null) };
        const res = await deliver(steamId, playerName, pack, i);
        if (!res.ok) {
          // Fill {have}/{pool} from the figure the refusal was ACTUALLY decided on, rather than
          // letting `subst` read the database again — a second read can disagree with the first,
          // and a player told "you have 900" after being refused at 900 has been lied to once.
          if (res.have != null) Object.assign(vars, shortVars({ have: res.have, source: res.balanceSource }, pack.cost && pack.cost.currency));
          return { ok: false, reason: res.reason, message: subst(fill(msgText(res.reason), vars), playerName, steamId, ctx || null) };
        }
        return { ok: true, reason: null, message: null, result: res };
      } finally { inFlight.delete(lockKey); }
    }

    // ── (re)register chat commands + pack commands ────────────────────────────────
    function sendReply(ctx, text, channel, broadcast) {
      const lines = String(text || '').split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.length > 0);
      for (const line of lines) {
        try { if (broadcast) host.chat.send(line, { channel: channel || 'global' }).catch(() => {}); else ctx.reply(line, { channel: channel }).catch(() => {}); }
        catch (e) { host.logger.debug(`deliver failed: ${e.message}`); }
      }
    }
    function makeCmdHandler(cmd) {
      return async (ctx) => {
        const name = String(cmd.name || '').toLowerCase().replace(/^\/+/, '').trim();
        const ch = replyChannelFor(cmd);
        // Grouped commands SHARE one cooldown: using any command in the group starts the timer for all of
        // them (e.g. /shopb4, /shopc1 in group "shops" — a player can't hop between shops). Ungrouped
        // commands keep a per-command cooldown keyed by their own name.
        const cdKey = (cmd.group && String(cmd.group).trim()) ? ('grp:' + String(cmd.group).trim()) : name;
        const lockKey = 'c:' + cdKey + ':' + ctx.steamId;
        if (inFlight.has(lockKey)) return;   // a claim of this command/group is already processing for this player
        inFlight.add(lockKey);
        try {
          const vars = { pack: cmd.name || name, cmd: name, h: cooldownLeftH(cdKey, cmd.cooldownHours, ctx.steamId), cost: cmd.cost && cmd.cost.amount, currency: cmd.cost && cmd.cost.currency, window: windowWhy(cmd) };
          // gate: allow/deny + cooldown (shared per group when set, else per command name)
          const block = blockReason(cmd, cdKey, ctx.steamId, true);
          if (block) return ctx.reply(subst(fill(msgText(block), vars), ctx.name, ctx.steamId, ctx), { channel: ch }).catch(() => {});
          // Check the cost up front so we can refuse cleanly, but only DEBIT after the effect (below).
          // Same gate as a pack claim: the running game first, the save only when it cannot answer.
          if (isPaid(cmd.cost)) {
            const short = await affordGate(ctx.steamId, cmd.cost);
            if (short) {
              Object.assign(vars, shortVars(short, cmd.cost.currency));
              return ctx.reply(subst(fill(msgText('insufficient'), vars), ctx.name, ctx.steamId, ctx), { channel: ch }).catch(() => {});
            }
          }
          // freeze position now so a teleport action can send the player back to it
          const frozen = playerLoc(ctx.steamId) || { x: 0, y: 0, z: 0 };
          // Optionally REMEMBER this spot for later — a separate /back command can teleport here on demand
          // via {saved_x} {saved_y} {saved_z} (so the player isn't stuck waiting for the timed return).
          if (cmd.savePosition) host.store.set('pos:' + ctx.steamId, frozen);
          const ran = await runActions(cmd.actions, ctx.name, ctx.steamId, ctx, frozen, cmd.notify);
          const hadActions = (Array.isArray(cmd.actions) ? cmd.actions : []).some((a) => String((a && (a.cmd || a.command)) || (typeof a === 'string' ? a : '')).trim());
          if (cmd.response) sendReply(ctx, subst(cmd.response, ctx.name, ctx.steamId, ctx, { loc: frozen }), cmd.broadcast ? (cmd.channel || 'global') : ch, cmd.broadcast);
          // Fuse: charge AFTER the effect — if the command had actions and none of them ran, take nothing.
          // And say so when the charge itself does not land: the effect has already happened, so the
          // player got it for nothing, which is invisible unless somebody writes it down.
          if (isPaid(cmd.cost) && (!hadActions || ran > 0)) {
            const took = await charge(ctx.steamId, cmd.cost);
            if (!took.ok) reportUnpaid(ctx.steamId, ctx.name, cmd.cost, cmd.name || cdKey, took.why);
          }
          if (Math.max(0, Number(cmd.cooldownHours) || 0) > 0 || isPaid(cmd.cost)) recordUse(cdKey, ctx.steamId, ctx.name, null);
        } finally { inFlight.delete(lockKey); }
      };
    }
    function reload() {
      clear();
      const c = cfg();
      // The plugin owns the in-game prefix (overrides the bridge config file) so it's set in one place.
      if (typeof host.chat.setPrefix === 'function') host.chat.setPrefix(c.commandPrefix || '/');
      const seen = {};
      for (const cmd of (Array.isArray(c.commands) ? c.commands : [])) {
        const name = String((cmd && cmd.name) || '').toLowerCase().replace(/^\/+/, '').trim();
        if (!name || seen[name] || cmd.enabled === false) continue;
        seen[name] = true; offs.push(host.chat.onCommand(name, makeCmdHandler(cmd)));
      }
      (Array.isArray(c.packs) ? c.packs : []).forEach((pack, i) => {
        if (pack.enabled === false || pack.trigger !== 'command') return;
        const name = String(pack.command || '').toLowerCase().replace(/^\/+/, '').trim();
        if (!name || seen[name]) return;
        seen[name] = true;
        const id = packId(pack, i);
        offs.push(host.chat.onCommand(name, async (ctx) => {
          const out = await claimPack(ctx.steamId, ctx.name, pack, i, name, ctx);
          if (out.message) ctx.reply(out.message, { channel: replyChannelFor(pack) }).catch(() => {});
        }));
      });
      host.logger.info('commands & packs registered');
    }
    reload();
    host.config.onChange(() => reload());

    // ── welcome message + welcome packs on join ───────────────────────────────────
    function onPlayerJoin(e) {
      const steamId = String((e && e.steamId) || ''); if (!steamId) return;
      const name = (e && e.playerName) || 'player';
      const c = cfg();
      const delayMs = Math.max(0, Number(c.joinDelaySeconds != null ? c.joinDelaySeconds : 0)) * 1000;
      const w = c.welcome || {};
      // Guard against a repeated greeting: the live join can re-fire on a respawn or a quick reconnect,
      // and we don't want to spam the same player. Once per WELCOME_MIN_GAP per SteamID.
      const WELCOME_MIN_GAP_MS = 5 * 60 * 1000;
      const lastW = Number(host.store.get('wmsg:' + steamId, 0)) || 0;
      if (w.enabled && w.message && (Date.now() - lastW) >= WELCOME_MIN_GAP_MS) {
        host.store.set('wmsg:' + steamId, Date.now());
        host.schedule.after(delayMs, () => {
          const ch = safeChannel(w.channel || c.replyChannel || DEFAULT_CHANNEL);
          for (const line of subst(w.message, name, steamId, { channel: w.channel }).split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean)) host.chat.dm(steamId, line, { channel: ch }).catch(() => {});
        });
      }
      (Array.isArray(c.packs) ? c.packs : []).forEach((pack, i) => {
        if (pack.enabled === false || pack.trigger !== 'welcome') return;
        const id = packId(pack, i);
        if (blockReason(pack, id, steamId, false)) return;
        // Same in-flight guard as the command path: a fast reconnect / respawn re-fires join, and without
        // this a welcome pack could be delivered twice before the first claim is recorded.
        const lockKey = 'p:' + ((pack.group && String(pack.group).trim()) ? 'grp:' + String(pack.group).trim() : id) + ':' + steamId;
        if (inFlight.has(lockKey)) return;
        inFlight.add(lockKey);
        host.schedule.after(delayMs, () => { deliver(steamId, name, pack, i).catch(() => {}).then(() => inFlight.delete(lockKey)); });
      });
    }
    // Prefer the bridge's LIVE join — it fires the instant the player is spawned in (no log-tail lag), so
    // the welcome lands immediately like a native server greeting. Fall back to the log-based event on an
    // older manager that doesn't expose it. (Both are auto-cleaned on unload.)
    if (typeof host.players.onJoin === 'function') host.players.onJoin(onPlayerJoin);
    else host.events.on('player:join', onPlayerJoin);

    // ── Discord panel: claim a kit from Discord, exactly as if typed in game ──────
    //
    // One message in a channel with a button; the button opens a private menu of the packs that
    // player can actually claim right now, and picking one runs `claimPack` — the SAME entry point
    // the in-game command uses. Nothing here re-implements a rule: allow/deny, group locks, claim
    // limits, cooldowns, price and the per-player lock all apply because they live behind that one
    // call. A parallel Discord flow would eventually hand out a kit chat would have refused.
    const D_OPEN = 'ck:open', D_PICK = 'ck:pick';
    // Every reply here is private to whoever clicked. discord.js deprecated the `ephemeral: true`
    // option in favour of the flag; 64 is its fixed value in Discord's API, used as the fallback so
    // an older discord.js still gets a private reply rather than a public one.
    const EPHEMERAL = (() => {
      try { return { flags: host.discord.js.MessageFlags.Ephemeral }; } catch { return { flags: 64 }; }
    })();

    /** A short fingerprint of WHAT an option meant when the menu was drawn. */
    function sigOf(s) {
      let h = 5381; const str = String(s);
      for (let k = 0; k < str.length; k++) h = ((h * 33) ^ str.charCodeAt(k)) >>> 0;
      return h.toString(36);
    }
    const packSig = (pack, id) => sigOf(id + '|' + (pack && pack.name) + '|' + ((pack && pack.cost && pack.cost.amount) || 0) + '|' + ((pack && pack.cost && pack.cost.currency) || ''));
    const D_STALE = '🔄 The kit list changed while that menu was open, so nothing was claimed. Open the menu again.';

    /** Packs an owner has made claimable from Discord, with their real list positions kept. */
    function discordPacks(c) {
      return (Array.isArray(c.packs) ? c.packs : [])
        .map((pack, i) => ({ pack, i }))
        .filter(({ pack }) => pack && pack.enabled !== false && pack.discord === true);
    }
    const priceText = (pack) => (isPaid(pack.cost)
      ? `${Math.abs(Number(pack.cost.amount) || 0)} ${pack.cost.currency}`
      : 'Free');

    async function postPanel(channelId) {
      const c = cfg();
      const d = c.discord || {};
      const chId = String(channelId || d.channelId || '');
      if (!chId) return { ok: false, error: 'no channel is set for the Discord panel' };
      if (!discordPacks(c).length) return { ok: false, error: 'no kit is marked "claimable from Discord" yet' };
      const B = host.discord.js;
      // Clamped. These come straight from owner config, and discord.js validates at the SETTER — an
      // over-long title throws here, gets caught by the route wrapper and surfaces as a raw
      // shapeshift error. Worse, the same failure at send time makes `discord.send` return false,
      // and the panel then reports "the bot could not post there (missing channel or permission)",
      // which sends the owner to fix a permission that was never the problem.
      const cut = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n - 1) + '…' : s);
      const e = host.discord.embed()
        .setTitle(cut(d.title || '🎁 Claim a kit', 256))
        .setDescription(cut(d.description || 'Click below to claim a kit. It is delivered in game, exactly as if you had typed the command yourself.', 4096))
        .setColor(0xff6a1a);
      const row = host.discord.row(
        new B.ButtonBuilder().setCustomId(D_OPEN).setLabel(String(d.buttonLabel || '🎁 Claim a kit').slice(0, 80)).setStyle(B.ButtonStyle.Success),
      );
      const msg = await host.discord.send(chId, { embeds: [e], components: [row] });
      // `host.discord.send` RETURNS false rather than throwing, so "nothing happened" has to be
      // checked for — the panel would otherwise report a post that never existed.
      if (!msg) return { ok: false, error: 'the bot could not post there (missing channel or permission)' };
      return { ok: true };
    }

    host.discord.onInteraction(async (i) => {
      // Every branch below `await`s before returning. `return somePromise()` inside a try does
      // NOT route its rejection through the catch — the function returns first and the rejection
      // escapes unhandled, which made the error handler at the bottom unreachable. The player then
      // saw Discord's own "This interaction failed" instead of the message written for them.
      try {
        const isBtn = !!(i.isButton && i.isButton());
        const isSel = !!(i.isStringSelectMenu && i.isStringSelectMenu());
        if (!isBtn && !isSel) return;
        if (isBtn && i.customId !== D_OPEN) return;                 // not ours
        if (isSel && i.customId !== D_PICK) return;

        const c = cfg();
        const prof = host.players.linked(i.user.id);
        if (!prof || !prof.steamId) {
          return await i.reply({ content: '⚠️ Link your SCUM character to Discord first (on the Field Console), then try again.', ...EPHEMERAL });
        }
        const steamId = String(prof.steamId);
        const playerName = prof.name || prof.playerName || prof.discordUsername || '';

        if (isBtn) {
          const list = discordPacks(c);
          if (!list.length) return await i.reply({ content: 'No kits are available from Discord right now.', ...EPHEMERAL });
          const B = host.discord.js;
          // Show WHY a kit cannot be taken rather than hiding it: "the button does nothing" is the
          // complaint an owner gets, and a greyed-out reason answers it before they ask.
          const opts = list.slice(0, 25).map(({ pack, i: idx }) => {
            const id = packId(pack, idx);
            const block = blockReason(pack, id, steamId, false);
            const why = block ? ({
              notAllowed: 'not available to you', groupLocked: 'you already picked another from this group',
              maxClaims: 'claim limit reached', cooldown: `on cooldown — ${cooldownLeftH(id, pack.cooldownHours, steamId)}h left`,
              alreadyClaimed: 'already claimed',
            }[block] || block) : priceText(pack);
            return {
              label: String(pack.name || id).slice(0, 100),
              description: String(why).slice(0, 100),
              value: (idx + '.' + packSig(pack, id)).slice(0, 100),
            };
          });
          const menu = new B.StringSelectMenuBuilder().setCustomId(D_PICK).setPlaceholder('Choose a kit').addOptions(opts);
          return await i.reply({ content: 'Pick a kit:', components: [host.discord.row(menu)], ...EPHEMERAL });
        }

        // A choice. The value carries which pack it MEANT, not just where it sat — an owner editing
        // the kit list while someone has a menu open must not hand them a different kit at a
        // different price.
        const raw = String((i.values || [])[0] || '');
        const dot = raw.indexOf('.');
        const idx = Number(dot < 0 ? raw : raw.slice(0, dot));
        const sig = dot < 0 ? '' : raw.slice(dot + 1);
        const pack = (Array.isArray(c.packs) ? c.packs : [])[idx];
        const id = pack ? packId(pack, idx) : '';
        if (!pack || pack.discord !== true || (sig && packSig(pack, id) !== sig)) {
          return await i.update({ content: D_STALE, components: [] });
        }
        // Items are spawned onto the player, so they have to BE there. Saying so beats a kit that
        // silently lands nowhere.
        const online = (() => { try { return (host.players.online() || []).some((p) => String(sidOf(p)) === steamId); } catch { return null; } })();
        if (online === false) return await i.update({ content: '🔌 You need to be online in game to receive a kit.', components: [] });

        await i.update({ content: '⏳ Delivering…', components: [] });
        const out = await claimPack(steamId, playerName, pack, idx, pack.command || '', null);
        const said = out.ok
          ? `✅ **${pack.name || id}** is on its way — check your inventory.`
          : (out.message || 'That could not be claimed right now.');
        // Discord's edit window is FIFTEEN MINUTES, and delivery can outlast it: every item goes
        // through one global, throttled, retried spawn queue, and under a bridge outage on a busy
        // server the queue alone takes longer than that. When the edit is refused the player's
        // private message reads "⏳ Delivering…" for ever — they cannot tell whether they got the
        // kit, and the claim HAS been recorded, so retrying is refused too.
        //
        // They are in game, which is where the kit landed. Say it there instead of swallowing it.
        try { await i.editReply({ content: said }); }
        catch (e) {
          host.logger.warn(`could not update the Discord reply for ${playerName || steamId} (the 15-minute window passed) — telling them in game instead`);
          try { await host.chat.dm(steamId, said, { channel: replyChannelFor(pack) }); } catch (x) { /* nothing left to try */ }
        }
      } catch (e) {
        host.logger.error('discord interaction: ' + e.message);
        try { if (i && !i.replied && i.reply) await i.reply({ content: 'Something went wrong.', ...EPHEMERAL }); } catch (x) { /* nothing left to say */ }
      }
    });

    // ── admin API ─────────────────────────────────────────────────────────────────
    host.routes.post('/post-panel', async (req, res) => {
      // Wrapped: the host catches a SYNC throw, but an async one escapes as an unhandled rejection
      // and the browser never gets an answer at all — the panel sits on "Posting…" for ever.
      try {
        const out = await postPanel((req.body || {}).channelId);
        res.json(out);
      } catch (e) { res.json({ ok: false, error: e.message }); }
    });
    host.routes.get('/discord-channels', async (req, res) => {
      const cl = host.discord.client();
      if (!cl) return res.json([]);
      try {
        const g = cl.guilds.cache.first(); if (!g) return res.json([]);
        const all = await g.channels.fetch();
        const out = [];
        all.forEach((ch) => { if (ch && ch.type === 0) out.push({ id: ch.id, name: ch.name }); });
        out.sort((a, b) => a.name.localeCompare(b.name));
        res.json(out);
      } catch (e) { res.json([]); }
    });

    host.routes.get('/config', (req, res) => res.json(cfg()));
    /**
     * The server's clock, and how this manager reads the windows that are set.
     *
     * The panel's window editor draws from this and composes no time text of its own, which is what
     * keeps the sentence identical here and on the Vehicle Rental tab. It answers with the server
     * stopped, with no bridge and with no Discord — a wall-clock window is not live data, and a
     * setting an owner cannot see the effect of before their first start is a setting they cannot
     * configure.
     */
    host.routes.get('/clock', (req, res) => {
      const t = host.time;
      if (!t || typeof t.now !== 'function') {
        return res.json({ supported: false, why: 'This manager is too old to evaluate time windows. Any window set here is treated as CLOSED until it is updated.' });
      }
      res.json({ supported: true, now: t.now(), zone: t.zone() });
    });
    /**
     * What the window an owner is EDITING right now would do — the sentence, whether it is open, and
     * anything wrong with it. Identical to Vehicle Rental's route of the same name, on purpose.
     *
     * It reads the windows out of the REQUEST rather than the saved config, because the question is
     * about the edit in progress. The panel could compose "Mon–Fri 20:00–22:00" itself in six lines,
     * and then the wrap rule, the day names and the clock caption would exist twice — with the copy
     * in the browser being the one that quietly drifted.
     */
    host.routes.post('/clock/preview', (req, res) => {
      const t = host.time;
      if (!t || typeof t.describe !== 'function') return res.json({ supported: false, text: '', errors: [] });
      const w = (req.body && Array.isArray(req.body.windows)) ? req.body.windows : [];
      const v = t.validate(w);
      const state = t.isOpen(w);
      res.json({ supported: true, text: t.describe(w), open: !!state.open, why: state.why, errors: v.errors });
    });
    host.routes.post('/config', (req, res) => {
      const b = req.body || {};
      // Refuse a window nobody can read BEFORE it is saved. `validate()` is the same rule `isOpen()`
      // applies at claim time, so the panel can name the problem instead of the owner discovering it
      // as a kit that silently stopped existing. An entry with no windows is never inspected, which
      // is why every config that predates this feature saves exactly as it did.
      const t = host.time;
      if (t && typeof t.validate === 'function') {
        // Tidy first, judge second: a duplicate or unsorted day is not a reason to refuse a save.
        [].concat(Array.isArray(b.commands) ? b.commands : [], Array.isArray(b.packs) ? b.packs : [])
          .forEach((e) => { if (e && Array.isArray(e.windows)) e.windows = normalizeWindows(e.windows); });
        const problems = [];
        const check = (e, where) => {
          if (!e || !Array.isArray(e.windows) || !e.windows.length) return;
          const v = t.validate(e.windows);
          if (!v.ok) v.errors.forEach((err) => problems.push(`${where}: ${err}`));
        };
        (Array.isArray(b.commands) ? b.commands : []).forEach((e, i) => check(e, `Command ${(e && e.name) ? `/${e.name}` : i + 1}`));
        (Array.isArray(b.packs) ? b.packs : []).forEach((e, i) => check(e, `Pack ${(e && e.name) || i + 1}`));
        if (problems.length) return res.json({ ok: false, error: problems.join('\n') });
      }
      host.config.set({
        commands: Array.isArray(b.commands) ? b.commands : [],
        welcome: (b.welcome && typeof b.welcome === 'object') ? b.welcome : {},
        packs: Array.isArray(b.packs) ? b.packs : [],
        messages: (b.messages && typeof b.messages === 'object') ? b.messages : {},
        replyChannel: TARGET_OK[b.replyChannel] ? b.replyChannel : DEFAULT_CHANNEL,
        commandPrefix: (typeof b.commandPrefix === 'string' && b.commandPrefix.trim()) ? b.commandPrefix.trim() : '/',
        itemSpawnCmd: b.itemSpawnCmd || DEFAULT_ITEM_CMD,
        vehicleSpawnCmd: b.vehicleSpawnCmd || DEFAULT_VEH_CMD,
        invSpawnCmd: b.invSpawnCmd || DEFAULT_INV_CMD,
        // 0 = greet instantly (safe: the live bridge join fires only once the player is spawned in).
        // `|| 15` would have turned 0 back into 15 — so validate explicitly.
        joinDelaySeconds: (Number.isFinite(Number(b.joinDelaySeconds)) && Number(b.joinDelaySeconds) >= 0) ? Number(b.joinDelaySeconds) : 0,
        // Spawn queue tuning (delivery reliability): gap between spawns + attempts per spawn.
        spawnGapMs: clampN(b.spawnGapMs, 0, 3000, 180),
        spawnTries: clampN(b.spawnTries, 1, 6, 3),
        // The Discord claim panel. Absent in every config written before this existed, which is why
        // it is read with defaults everywhere rather than assumed present.
        discord: (b.discord && typeof b.discord === 'object') ? b.discord : {},
      });
      reload();
      res.json({ ok: true });
    });
    // Live status for the panel header + the activity log feed.
    host.routes.get('/status', (req, res) => res.json(statusSnapshot()));
    // Clear the activity log (keeps the running counters).
    host.routes.post('/clear-history', (req, res) => { recent = []; try { host.store.set('recent', []); } catch { /* ignore */ } res.json({ ok: true }); });
    // Reset the running counters too.
    host.routes.post('/reset-stats', (req, res) => { stats = { deliveries: 0, ok: 0, failed: 0 }; persistStats(); res.json({ ok: true }); });
    host.routes.get('/meta', (req, res) => res.json({
      channels: ['local', 'global', 'squad', 'admin', 'server'],
      currencies: ['free', 'money', 'gold', 'fame'],
      triggers: ['welcome', 'command'],
      messageKeys: Object.keys(DEFAULT_MSG),
      defaultMessages: DEFAULT_MSG,
      tokens: ['{player}', '{steamid}', '{squad}', '{squadsize}', '{online}', '{maxplayers}', '{server}', '{channel}', '{args}', '{arg1}',
        '{money}', '{cash}', '{gold}', '{fame}', '{kills}', '{deaths}', '{kd}', '{pvpkills}', '{headshots}', '{zombiekills}', '{animalkills}',
        '{longestkill}', '{distance}', '{lockspicked}', '{fishcaught}', '{playtime}', '{survived}',
        '{strength}', '{constitution}', '{dexterity}', '{intelligence}',
        '{location}', '{x}', '{y}', '{z}', '{saved_x}', '{saved_y}', '{saved_z}', '{date}', '{time}'],
    }));

    // `GET /players` (online only) used to live here. Both jobs its comment claimed are done
    // elsewhere now: the picker uses /players/all, which lists everyone and marks who is connected,
    // and the claims view resolves its own names in the backend. Nothing called it.
    //
    // ALL known players (offline included) for the allow/deny picker — straight from the game DB so an
    // admin can pre-authorise someone who isn't online. Marks who's currently connected. Returns [] while
    // the server is stopped (DB unavailable) — the picker still offers the online list + SteamID paste.
    host.routes.get('/players/all', (req, res) => {
      const out = []; const onlineIds = new Set();
      try { (host.players.online() || []).forEach((p) => { const sid = sidOf(p); if (sid) onlineIds.add(sid); }); } catch { /* offline */ }
      try {
        if (host.db && host.db.scum && host.db.scum.available && host.db.scum.available()) {
          const rows = host.db.scum.all(host.db.scum.excludeDeleted('SELECT name AS name, user_id AS steamId FROM user_profile ORDER BY name COLLATE NOCASE')) || [];
          for (const r of rows) { const sid = String(r.steamId || ''); if (!sid) continue; out.push({ steamId: sid, name: r.name || '', online: onlineIds.has(sid) }); }
        }
      } catch (e) { host.logger.debug(`[players/all] ${e.message}`); }
      // If the DB gave nothing (server down), fall back to the live online roster so the picker still works.
      if (!out.length && onlineIds.size) { try { (host.players.online() || []).forEach((p) => { const sid = sidOf(p); if (sid) out.push({ steamId: sid, name: nmOf(p), online: true }); }); } catch { /* ignore */ } }
      res.json({ players: out });
    });

    // who has claimed what — one row per (pack, player). Reset lets a player use a one-time reward again.
    host.routes.get('/claims', (req, res) => {
      const all = host.store.all() || {};
      const rows = [];
      for (const [k, v] of Object.entries(all)) {
        if (!k.startsWith('claim:')) continue;
        const rest = k.slice(6); const cut = rest.lastIndexOf(':'); if (cut < 0) continue;
        const pid = rest.slice(0, cut), sid = rest.slice(cut + 1);
        rows.push({ key: k, packId: pid, steamId: sid, name: nameOf(v) || playerName(sid, ''), at: atOf(v), count: Number(all[`count:${pid}:${sid}`] || 0) || 0 });
      }
      rows.sort((a, b) => b.at - a.at);
      res.json({ claims: rows });
    });
    function resetOne(pid, sid) {
      host.store.delete(K.claim(pid, sid));
      host.store.delete(K.count(pid, sid));
      const all = host.store.all() || {};
      for (const gk of Object.keys(all)) if (gk.startsWith('group:') && gk.endsWith(':' + sid) && all[gk] === pid) host.store.delete(gk);
    }
    host.routes.post('/claims/reset', (req, res) => {
      const b = req.body || {};
      let pid = b.packId, sid = b.steamId;
      if (b.key && (!pid || !sid)) { const rest = String(b.key).replace(/^claim:/, ''); const cut = rest.lastIndexOf(':'); if (cut >= 0) { pid = rest.slice(0, cut); sid = rest.slice(cut + 1); } }
      if (!pid || !sid) return res.json({ ok: false, error: 'need key or packId+steamId' });
      resetOne(pid, sid); res.json({ ok: true });
    });
    host.routes.post('/claims/clear', (req, res) => {
      const b = req.body || {}; const all = host.store.all() || {};
      for (const k of Object.keys(all)) {
        if (b.packId) { if (k.startsWith(`claim:${b.packId}:`) || k.startsWith(`count:${b.packId}:`) || (k.startsWith('group:') && all[k] === b.packId)) host.store.delete(k); }
        else if (k.startsWith('claim:') || k.startsWith('count:') || k.startsWith('group:')) host.store.delete(k);
      }
      res.json({ ok: true });
    });
  },

  async unregister() { /* auto-cleaned via host unload tracking */ },
};
