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
// A container (backpack/vest/crate) filled with {fill} — #SpawnInventoryFullOf. This command has NO
// Location arg: it spawns on whoever runs it, so we run it THROUGH the target player (executor =
// their SteamID) — no Location in the template.
// NO {sets} in the default: the game reads every word after the container as an ITEM, so a count
// there came back "'2' is not allowed to be spawned." and a nearly empty bag, while the command
// with only the fill item comes back full. `{sets}` still works in an owner's own template.
const DEFAULT_INV_CMD  = '#SpawnInventoryFullOf {container} {fill}';
// The old default, exactly as every earlier version wrote it into config.json. It is replaced when
// read; any other template an owner wrote is theirs and is used as it stands.
const OLD_DEFAULT_INV_CMD = '#SpawnInventoryFullOf {container} {sets} {fill}';
const invCmd = (t) => (!t || t === OLD_DEFAULT_INV_CMD) ? DEFAULT_INV_CMD : t;
const DEFAULT_CHANNEL  = 'local';   // channels that reliably show to ONE targeted player

// Default player-facing system messages (all overridable in config → any language). Tokens available:
// {player} {pack} {cmd} {h} (hours left, rounded up) {left} (the wait in words) {cost} {currency}
// plus every rich token.
// `insufficient` gets three more: {have} — the balance the refusal was actually decided on — {pool},
// which NAMES the pool it came from ("bank account" / "gold balance" / "fame"), and {asof}, which is
// empty when the game answered and says so when only the last save could. A player told just "you
// can't afford it" knows neither which of their balances was looked at nor how old it was.
const DEFAULT_MSG = {
  // `{left}` is the wait in words ("25m", "3h 10m"). `{h}` is still whole hours rounded UP and still
  // works, because it is in every message an owner has already written — but one minute left of a
  // daily kit reads "~1h" through it, which is an hour of somebody's evening.
  cooldown:      'You already used {pack}. Try again in {left}.',
  alreadyClaimed:'You already claimed {pack}.',
  groupLocked:   'You already picked from this set — {pack} is locked.',
  maxClaims:     'You have reached the limit for {pack}.',
  notAllowed:    "You can't use {pack}.",
  // The one refusal a player can ACT on, so it says what to do rather than that they may not.
  // Editable like every other message: an owner who links accounts somewhere else rewrites it.
  notLinked:     '{pack} is for linked players — link your SCUM character to Discord on the Field Console, then try again.',
  insufficient:  "You can't afford {pack} ({cost} {currency}) — your {pool} has {have}{asof}.",
  notInGame:     'Get fully spawned in first, then try again.',
  // ⚠ **THE LOCK THAT ANSWERED NOTHING.** A kit drains a throttled, retried spawn queue and can take
  // several seconds; the per-player in-flight lock is right and necessary (it is what stops a click
  // in Discord and a typed command both landing), but it used to `return` in silence. The player
  // sees nothing, types it again, sees nothing again, and reports the plugin as broken — which is
  // the same silence the dispatcher was fixed for one layer up.
  inflight:      'That one is already on its way to you — give it a moment.',
  spawnFailed:   "Couldn't deliver {pack} right now — nothing was taken. Try again.",
  // A kit an admin has not finished filling in. The player is told the truth rather than thanked for
  // taking delivery of nothing, and neither their claim nor their cooldown is spent on it.
  emptyKit:      '{pack} is not ready yet — an admin still has to put something in it. Nothing was taken.',
  // ── THE ONE LINE THAT SAYS "YOU PAID AND IT DID NOT ALL ARRIVE" ────────────────────────────────
  //
  // A kit has ONE price and its items are not priced individually, so a partial delivery is charged
  // in full — that is the owner's decision to change, not this code's. What is not the owner's
  // decision is that it was said in English on every server, because this sentence was a literal
  // down in `deliver()` rather than a field on the Messages screen: the screen tells an owner it
  // holds "every line a player sees", and the line a player is most likely to bring to them was not
  // in it. {missing} names what did not arrive THROUGH THE RESOLVER, so it reads "Medkit" and never
  // `BP_Medkit_01_C` — an item code in front of a player is the same defect this project already
  // has one resolver to stop everywhere else.
  partial:       '⚠ Part of {pack} could not be delivered ({missing}). Tell an admin — you were charged in full.',
  // ── …AND THE TWO WORLDS IN WHICH THAT SENTENCE IS NOT TRUE ────────────────────────────────────
  //
  // The charge happens AFTER the kit lands and it has three outcomes, so "you were charged in full"
  // is a claim this plugin cannot always make. A REFUSED charge definitely did not happen (the
  // player got the kit for nothing, which they are entitled to know rather than be billed for in
  // words); an UNCONFIRMED one went to the game's static dispatch on an empty server and answered
  // nothing at all, so neither "charged" nor "not charged" is honest. Saying the wrong one of these
  // sends somebody to an admin to be refunded money that was never taken, or to be charged twice.
  partialUnpaid: '⚠ Part of {pack} could not be delivered ({missing}), and the payment did not go through either — nothing was taken. Tell an admin.',
  partialUnknown:'⚠ Part of {pack} could not be delivered ({missing}), and the server could not confirm your payment. Check your balance and show an admin this message.',
  // The game refused the spawn outright — almost always a code a game update has moved. Nothing is
  // charged, because the delivery fuse fires before the charge.
  spawnRefused:  "The server refused to create {pack} — its spawn code looks out of date. Nothing was taken; please tell an admin.",
  // The running game answered with a CUT list of who is online, so this player could not be looked up
  // live and the saved balance beside it may be minutes old. Refused rather than charged against it.
  listCut:       '⏳ The server could not give a complete list of who is online, so your balance could not be checked. Nothing was taken — try again in a moment.',
  // {window} is the manager's own sentence for the window that refused, and it always names the
  // clock — "from 20:00" is meaningless to a player who does not know whether that is the server's
  // evening or the game's, and on a server with a fast day cycle those are wildly different.
  closed:        '⏳ {pack} is not available right now — {window}',
  // ── …AND ITS SIBLING ON THE OTHER CLOCK ───────────────────────────────────────────────────────
  //
  // A separate line rather than a second use of `closed`, because the two say different things and
  // a player who cannot act on the difference will wait for the wrong thing. The server clock is
  // the one on their wall: "come back at eight" is something they can do. The GAME clock runs at
  // whatever multiplier the server is set to, so "come back at 21:00 in game" may be four real
  // minutes away or forty — which is why `{window}` for this one carries the game time it is NOW
  // as well as the hours, and why the two are never merged into one sentence.
  closedGame:    '⏳ {pack} is not available at this time of day in game — {window}',

  // ── THE WORDS INSIDE THOSE SENTENCES ─────────────────────────────────────────────────────────
  //
  // `{pool}`, `{asof}`, `{currency}` and `{window}` used to be filled with English made here, so a
  // fully translated `insufficient` line still read "…your bank account has 100" in the middle of a
  // Czech sentence. They are the owner's words now, like the sentences around them: absent from a
  // config written before this, which reads the English below exactly as it read before.
  poolMoney:     'bank account',
  poolGold:      'gold balance',
  poolFame:      'fame',
  // Starts with a space on purpose: it is glued onto `{have}` and is empty when the game answered.
  asofSave:      ' — that is your balance as of the last server save, so try again shortly',
  curMoney:      'money',
  curGold:       'gold',
  curFame:       'fame',
  curFree:       'free',
  // `{window}` for `closedGame`. `{speed}` is `windowGameSpeed` filled in, or empty when the bridge
  // did not say how fast the game day runs.
  windowGame:    'it is available {from}–{to} in GAME time; it is {now} in game now{speed}',
  windowGameSpeed: ' ({speed} game hours per real hour)',
  // `{window}` for `closed` on a manager too old to evaluate a wall-clock window at all.
  windowNeedsUpdate: 'time windows need a newer manager, so this is switched off until an admin updates it',

  // ── THE DISCORD CLAIM PANEL ──────────────────────────────────────────────────────────────────
  //
  // Players read every one of these in Discord. They were fixed English down in the interaction
  // handler; they are the owner's words now, with the same English as before.
  discordLink:      '⚠️ Link your SCUM character to Discord first (on the Field Console), then try again.',
  discordNone:      'No kits are available from Discord right now.',
  discordPick:      'Pick a kit:',
  discordChoose:    'Choose a kit',
  discordFree:      'Free',
  discordStale:     '🔄 The kit list changed, so nothing was claimed. Open the menu again.',
  discordOffline:   '🔌 You need to be online in game to receive a kit.',
  discordDelivering:'⏳ Delivering…',
  discordDone:      '✅ **{pack}** is on its way — check your inventory.',
  discordFailed:    'That could not be claimed right now.',
  discordError:     'Something went wrong.',
  // The short reason under a kit in the menu. A dropdown row is a hundred characters, so these are
  // the short forms of the chat refusals above rather than the same sentences.
  discordNotAllowed:    'not available to you',
  discordGroupLocked:   'you already picked another from this group',
  discordMaxClaims:     'claim limit reached',
  discordCooldown:      'on cooldown — {left} left',
  discordAlreadyClaimed:'already claimed',
  discordNotLinked:     'for linked players only',
  discordInflight:      'already on its way to you',
  discordClosed:        'not available right now — {window}',
  discordClosedGame:    'not at this time of day in game — {window}',
  discordUnavailable:   'not available right now',
};
// Which screen section each message belongs on. The panel draws the sections in this order and
// anything not named here lands in the first one, so a key added later still gets a field.
const MSG_GROUPS = {
  words: ['poolMoney', 'poolGold', 'poolFame', 'asofSave', 'curMoney', 'curGold', 'curFame', 'curFree',
    'windowGame', 'windowGameSpeed', 'windowNeedsUpdate'],
  discord: Object.keys(DEFAULT_MSG).filter((k) => /^discord[A-Z]/.test(k)),
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
  // ── WHAT A FRESH INSTALL SAYS TO PLAYERS, AND WHAT IT DELIBERATELY DOES NOT ────────────────────
  //
  // Everything shipped ON has to be true the moment the plugin is switched on, because an owner
  // installing it does not expect their server to start talking to players before they have looked
  // at the screen. Two of the shipped five used to break that:
  //
  //   • `/discord` answered "discord.gg/yourserver" — a dead link, in front of every player, from
  //     the first minute, and `/info` sent them to it. It ships OFF, with the placeholder still in
  //     it so it is obvious what to fill in and where.
  //   • the two example kits were ON with nothing in them, so a player was thanked for a starter
  //     pack that did not exist and `/daily` spent their 24-hour cooldown on nothing. They ship OFF.
  //
  // `/info` and `/rules` stay ON: both are true out of the box, and a plugin that does nothing at
  // all until it is configured teaches an owner nothing about what it is for.
  commands: [
    { name: 'info', enabled: true, channel: 'local', broadcast: false, cooldownHours: 0, requireLinked: false, cost: { currency: 'free', amount: 0 }, allow: [], deny: [], actions: [],
      response: 'Welcome, {player}!\nPlayers online: {online}/{maxplayers}\nType /rules to read the server rules.' },
    { name: 'discord', enabled: false, channel: 'local', broadcast: false, cooldownHours: 0, requireLinked: false, cost: { currency: 'free', amount: 0 }, allow: [], deny: [], actions: [],
      response: 'Join our Discord: discord.gg/yourserver' },
    { name: 'rules', enabled: true, channel: 'local', broadcast: false, cooldownHours: 0, requireLinked: false, cost: { currency: 'free', amount: 0 }, allow: [], deny: [], actions: [],
      response: 'Server rules:\n1) No cheating\n2) Be respectful\n3) Have fun!' },
    // An example of a live token. A config that already has a `commands` list never gets it: the
    // merge is by key presence, so an owner's own list — even an empty one — stays exactly as saved.
    { name: 'ping', enabled: true, channel: 'local', broadcast: false, cooldownHours: 0, requireLinked: false, cost: { currency: 'free', amount: 0 }, allow: [], deny: [], actions: [],
      response: 'Your ping: {ping} ms' },
  ],
  packs: [
    { id: 'welcome', name: 'Welcome Pack', enabled: false, trigger: 'welcome', command: '', cooldownHours: 0, requireLinked: false, maxClaims: 0, group: '',
      cost: { currency: 'free', amount: 0 }, allow: [], deny: [], items: [], vehicles: [], actions: [], replyChannel: 'local',
      message: 'Welcome to {server}, {player}! Enjoy your starter pack.' },
    { id: 'daily', name: 'Daily Kit', enabled: false, trigger: 'command', command: 'daily', cooldownHours: 24, requireLinked: false, maxClaims: 0, group: '',
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
    // The five channels the bridge accepts for a chat line; anything else falls back to the default.
    // CommandsOnly(5) is refused by the bridge. ServerMessage(6) is allowed: the old report that it did
    // not display to one recipient was the bridge's own command-feedback suppression eating the reply,
    // fixed in the bridge, not the channel.
    const TARGET_OK = { local: 1, global: 1, squad: 1, admin: 1, server: 1 };
    const safeChannel = (ch) => (ch && TARGET_OK[ch]) ? ch : DEFAULT_CHANNEL;
    const replyChannelFor = (obj) => safeChannel((obj && (obj.channel || obj.replyChannel)) || cfg().replyChannel || DEFAULT_CHANNEL);
    const msgText = (key) => (cfg().messages || {})[key] || DEFAULT_MSG[key] || '';
    // The prefix players type, exactly as this plugin sets it on the bridge in `reload()`.
    const chatPrefix = () => { const p = cfg().commandPrefix; return (typeof p === 'string' && p.trim()) ? p.trim() : '/'; };

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
    /**
     * Where the player is standing NOW, for a position that is about to be acted on.
     *
     * `playerLoc` reads `host.map.world()`, which is `SCUM.db` — the position as of the LAST SAVE. A
     * teleport-and-back frozen from that sent the player back to wherever they stood when the game
     * last saved, which can be minutes and hundreds of metres away from where they typed the
     * command. `host.players.live()` asks the running game first (its `x`/`y`/`z` ride on the live
     * module's position switch) and the saved position is used only when it cannot answer.
     *
     * `null` when neither source has a position. Never `{0,0,0}`: that is a real place on the
     * island, and a teleport there is not a harmless default.
     */
    async function playerLocNow(steamId) {
      try {
        const p = await host.players.live(steamId);
        if (p && p.source === 'live') {
          const x = Number(p.x), y = Number(p.y), z = Number(p.z);
          if (p.x != null && p.y != null && p.z != null && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
            return { x: Math.round(x), y: Math.round(y), z: Math.round(z) };
          }
        }
      } catch { /* the saved position below */ }
      return playerLoc(steamId);
    }
    const USES_POS = /\{(x|y|z|location)\}/i;
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
    /**
     * What the GAME calls this thing, for a line a player reads.
     *
     * `host.items.name()` is the manager's one resolver and it is fed by the scumsa catalogue in the
     * bot's language, so a code becomes "Medkit" rather than `BP_Medkit_01_C`. Never a second prefix
     * strip here: six copies of `replace(/^BP_|_C$/g, '')` once grew across this product and
     * disagreed with each other. A code it cannot place comes back as itself, which is still better
     * than an empty name, and a manager too old to have the resolver keeps today's behaviour.
     */
    function prettyCode(code) {
      const c = String(code || '').trim();
      if (!c) return '';
      try { if (host.items && typeof host.items.name === 'function') return host.items.name(c) || c; }
      catch { /* the code itself, below */ }
      return c;
    }
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
        // The chat prefix, so "type {prefix}daily" stays right when an owner changes it.
        prefix: chatPrefix(),
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
      //
      // ⚠ **A SOURCE THAT DID NOT ANSWER IS `?`, NEVER 0.** `finances()` and `stats()` answer null for
      // a save that will not open or a profile it cannot find, and `|| 0` turned that into "you have
      // 0" in front of a player whose bank holds thousands. A field the save holds as NULL is the
      // same: nobody could read it, so nobody can say it is nought.
      const known = (v) => { const n = num(v); return n == null ? UNKNOWN_TOKEN : n; };
      if (/\{(money|bank|cash|gold)\}/i.test(tpl)) { const f = host.players.finances(steamId); map.money = known(f && f.bank); map.bank = map.money; map.cash = known(f && f.cash); map.gold = known(f && f.gold); }
      if (/\{(fame|kills|deaths|kd|pvpkills|headshots|zombiekills|animalkills|longestkill|distance|lockspicked|fishcaught|playtime|survived)\}/i.test(tpl)
          && !host.players.stats(steamId)) {
        // The whole stat sheet could not be read. Every one of these is unknown, not zero.
        for (const k of ['fame', 'kills', 'deaths', 'kd', 'pvpkills', 'headshots', 'zombiekills', 'animalkills', 'longestkill', 'distance', 'lockspicked', 'fishcaught', 'playtime', 'survived']) map[k] = UNKNOWN_TOKEN;
      } else if (/\{(fame|kills|deaths|kd|pvpkills|headshots|zombiekills|animalkills|longestkill|distance|lockspicked|fishcaught|playtime|survived)\}/i.test(tpl)) {
        // A sheet that WAS read: its blank columns are LEFT JOINs with no row behind them, which is
        // a player with nothing recorded yet — a real 0.
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
      // No position is not the island's origin: `?` in a chat line. An ACTION naming one of these is
      // skipped before it gets here (`runActions`), so `?` never reaches the game's console.
      if (/\{(x|y|z|location)\}/i.test(tpl)) {
        const l = (extra && extra.loc) || playerLoc(steamId);
        const has = !!(l && num(l.x) != null && num(l.y) != null);
        map.x = has ? Math.round(num(l.x)) : UNKNOWN_TOKEN; map.y = has ? Math.round(num(l.y)) : UNKNOWN_TOKEN;
        map.z = (has && num(l.z) != null) ? Math.round(num(l.z)) : UNKNOWN_TOKEN;
        map.location = has ? `${map.x}, ${map.y}` : UNKNOWN_TOKEN;
      }
      if (/\{saved_[xyz]\}/i.test(tpl)) {
        const sp = ledger.get('pos:' + steamId, null);
        const has = !!(sp && num(sp.x) != null && num(sp.y) != null && num(sp.z) != null);
        map.saved_x = has ? Math.round(num(sp.x)) : UNKNOWN_TOKEN; map.saved_y = has ? Math.round(num(sp.y)) : UNKNOWN_TOKEN; map.saved_z = has ? Math.round(num(sp.z)) : UNKNOWN_TOKEN;
      }
      if (extra) for (const k of Object.keys(extra)) if (k !== 'loc' && extra[k] != null) map[k.toLowerCase()] = extra[k];
      let out = tpl.replace(/\{arg(\d+)\}/gi, (_, n) => safeArg((ctx && ctx.args && ctx.args[Number(n) - 1]) || ''));
      out = out.replace(/\{(\w+)\}/g, (m, k) => { const key = k.toLowerCase(); return (key in map) ? String(map[key]) : m; });
      return out;
    }

    // ── tokens the running game answers ──────────────────────────────────────
    //
    // `subst` is synchronous and reads the SAVE. These are read at send time from the running game
    // where it can answer, and from the save where it cannot, and only when the template names
    // them: a line with none of them never reaches the bridge.
    //
    // ⚠ **A VALUE NOBODY COULD READ IS `?`, NEVER A NUMBER.** A ping of 0, a health of 0 or the
    // clock at midnight are all real answers, and printing one for "the bridge did not say" tells
    // the player something false. `?` is the same in every language.
    const UNKNOWN_TOKEN = '?';
    const LIVE_TOKENS = /\{(ping|health|sector|gametime|temperature|nextrestart|restartin|money|bank|gold|fame)\}/i;
    const usesTok = (tpl, names) => new RegExp('\\{(' + names + ')\\}', 'i').test(tpl);
    const num = (v) => { if (v == null || v === '' || typeof v === 'boolean') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
    const pad2 = (n) => String(n).padStart(2, '0');
    // A game hour (0..24, fractional) as "14:05".
    const hhmmOfHour = (h) => { const m = Math.floor(h * 60 + 1e-6) % 1440; return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`; };
    // The world payload, for the temperature. Twenty seconds, the game clock's own cache length.
    let worldAt = 0;
    let worldWas = null;
    async function worldNow() {
      if (Date.now() - worldAt < GAME_CLOCK_MS) return worldWas;
      let w = null;
      try {
        const f = host.bridge && host.bridge.world;
        if (typeof f === 'function') w = await Promise.resolve(f.call(host.bridge)).catch(() => null);
      } catch { w = null; }
      worldWas = (w && typeof w === 'object') ? w : null;
      worldAt = Date.now();
      return worldWas;
    }
    /**
     * The live tokens a template names, resolved. Every value is a plain string made here — a
     * number or a sector name — so it is safe inside an admin command as well as a chat line.
     *
     *   {ping}        milliseconds. The game replicates ping divided by four (UE's compressed ping),
     *                 so the reading is multiplied back out here. Live only: the save has no ping.
     *   {health}      percent, from the game's own HUD ratio. Live only.
     *   {sector}      the map sector the player stands in, the grid the live map draws.
     *   {gametime}    the in-game clock, from the running world, else the last save.
     *   {temperature} air temperature in °C, from the running world, else the last save.
     *   {nextrestart} the next scheduled restart on the server's clock, "HH:MM".
     *   {restartin}   how long until then, "1h 20m".
     *   {money} {bank} {gold} {fame}  the running game's figure when it sends one; the saved
     *                 figure (in `subst`) when it does not.
     */
    async function liveTokens(tpl, steamId, extra) {
      tpl = String(tpl || '');
      const out = {};
      if (!LIVE_TOKENS.test(tpl)) return out;
      let live = null;
      if (steamId && usesTok(tpl, 'ping|health|sector|money|bank|gold|fame')) {
        try { const p = await host.players.live(steamId); if (p && p.source === 'live') live = p; } catch { live = null; }
      }
      if (usesTok(tpl, 'ping')) {
        const raw = live ? num(live.ping) : null;
        out.ping = (raw != null && raw >= 0 && raw <= 255) ? String(Math.round(raw * 4)) : UNKNOWN_TOKEN;
      }
      if (usesTok(tpl, 'health')) {
        const r = live ? num(live.health) : null;
        out.health = (r != null && r >= 0 && r <= 1.05) ? String(Math.round(Math.min(1, r) * 100)) : UNKNOWN_TOKEN;
      }
      if (live) {
        const money = num(live.money), gold = num(live.gold);
        if (money != null) { out.money = String(money); out.bank = String(money); }
        if (gold != null) out.gold = String(gold);
        const fame = num(live.fameRounded) != null ? num(live.fameRounded) : num(live.fame);
        if (fame != null) out.fame = String(Math.round(fame));
      }
      if (usesTok(tpl, 'sector')) {
        let at = (extra && extra.loc) || null;
        if (!at && live && num(live.x) != null && num(live.y) != null) at = { x: num(live.x), y: num(live.y) };
        if (!at && steamId) at = playerLoc(steamId);
        let s = null;
        if (at && num(at.x) != null && num(at.y) != null) {
          try { s = await host.map.sector(num(at.x), num(at.y)); } catch { s = null; }
        }
        const clean = typeof s === 'string' ? s.replace(/[^\w\-]/g, '').slice(0, 8) : '';
        out.sector = clean || UNKNOWN_TOKEN;
      }
      if (usesTok(tpl, 'gametime')) {
        let v = null;
        try { const c = await gameClock(); if (c && !c.unknown && Number.isFinite(c.hour)) v = hhmmOfHour(c.hour); } catch { v = null; }
        if (!v) {
          try { const g = host.stats.gameTime(); if (g && g.Success && /^\d{2}:\d{2}$/.test(String(g.FormattedTime))) v = String(g.FormattedTime); } catch { v = null; }
        }
        out.gametime = v || UNKNOWN_TOKEN;
      }
      if (usesTok(tpl, 'temperature')) {
        let t = null;
        try { const w = await worldNow(); t = w ? num(w.airTemp) : null; } catch { t = null; }
        if (t == null || t < -80 || t > 80) {
          try { const s = host.stats.weather(); t = (s && s.Success) ? num(s.AirTemperature) : null; } catch { t = null; }
        }
        out.temperature = (t != null && t >= -80 && t <= 80) ? String(Math.round(t * 10) / 10) : UNKNOWN_TOKEN;
      }
      if (usesTok(tpl, 'nextrestart|restartin')) {
        let at = null;
        try { at = num((host.server.info() || {}).nextRestartUnix); } catch { at = null; }
        const ms = at != null ? at * 1000 - Date.now() : null;
        const ok = ms != null && ms > 0;
        const d = ok ? new Date(at * 1000) : null;
        out.nextrestart = ok ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : UNKNOWN_TOKEN;
        out.restartin = ok ? fmtDuration(Math.ceil(ms / 60000)) : UNKNOWN_TOKEN;
      }
      return out;
    }
    /** `subst`, with the live tokens resolved first. Every line a player reads goes through this. */
    async function substLive(tpl, name, steamId, ctx, extra) {
      let got = {};
      try { got = await liveTokens(tpl, steamId, extra); } catch { got = {}; }
      return subst(tpl, name, steamId, ctx, Object.assign({}, got, extra || {}));
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
    // The OWNER's word for the pool, because a player reads it inside their `insufficient` line. The
    // admin-facing log and alert lines below keep the English (`poolEn`): they are read by whoever
    // reconciles a charge and are not on the Messages screen.
    const poolWord = (cur) => msgText(cur === 'gold' ? 'poolGold' : cur === 'fame' ? 'poolFame' : 'poolMoney');
    const poolEn = (cur) => (cur === 'gold' ? 'gold balance' : cur === 'fame' ? 'fame' : 'bank account');
    /** The owner's word for a currency, for `{currency}`. An unknown one is shown as it was set. */
    const curWord = (cur) => {
      const k = { money: 'curMoney', gold: 'curGold', fame: 'curFame', free: 'curFree' }[String(cur || '')];
      return k ? msgText(k) : (cur == null ? '' : String(cur));
    };
    const finite = (v) => ((typeof v === 'number' && Number.isFinite(v)) ? v : null);

    // The bridge's live `money` and `fame` groups are BOTH off by default, so the commonest reason a
    // balance falls back to the save is a switch nobody has turned on. Said once per group per boot:
    // it would otherwise fire on every paid claim.
    const _warnedLiveOff = {};
    function warnLiveOff(currency) {
      const grp = currency === 'fame' ? 'fame' : 'money';
      if (_warnedLiveOff[grp]) return;
      _warnedLiveOff[grp] = true;
      // That group ships off; until it is on, affordability is judged on the last save.
      host.logger.warn(`the SSA Bridge sent no ${grp} for this player. Turn on "${grp === 'fame' ? 'Fame points and level' : 'Money, gold and account number'}" on the Live player data card in Plugins → SSA Bridge.`);
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
      // ⚠ **A CUT LIST IS NOT A SHORT LIST. IT IS THE WRONG ANSWER, AND IT ARRIVES LOOKING RIGHT.**
      //
      // `mod_live`'s walk over connected players stops at its own ceiling and says so with a marker;
      // `host.players.live()` turns that into `liveTruncated` and answers `source: 'db'`. Every
      // reader — this one included — has to treat a player who is absent from the live payload as
      // OFFLINE, so a player past the ceiling gets priced against the SAVE while standing in the
      // world. That is exactly the staleness the live path exists to end, wearing the clothes of the
      // one case where the save is the right answer, and nothing here had ever asked.
      const cut = !!(p && p.liveTruncated);
      if (p && p.source === 'live') {
        // Live keys: `money` (ECurrencyType Normal), `gold` (Gold), `fame`.
        const v = currency === 'money' ? finite(p.money) : currency === 'gold' ? finite(p.gold) : finite(p.fame);
        if (v != null) return { have: v, source: 'live', cut: false };
        warnLiveOff(currency);
      } else if (p && p.source === 'db') {
        // The same three values as the game reports, under the save's own names — `bank` is the
        // type-1 bank row, i.e. the identical pool the live `money` reading names.
        const v = currency === 'money' ? finite(p.bank) : currency === 'gold' ? finite(p.gold) : finite(p.FamePoints);
        return { have: v, source: v == null ? null : 'db', cut: cut };
      }
      // Either the game answered without the money group, or nothing answered at all. Ask the save
      // directly rather than reporting "cannot say" when a saved figure does exist.
      const v = currency === 'fame'
        ? finite((host.players.stats(steamId) || {}).FamePoints)
        : finite((host.players.finances(steamId) || {})[currency === 'gold' ? 'gold' : 'bank']);
      return { have: v, source: v == null ? null : 'db', cut: cut };
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
      // BEFORE the figure, because the figure is what is in doubt. A cut roster means this player may
      // be in the world while the payload says they are not, so the saved balance beside it is not a
      // reading of anything current. The manager already refuses an AREA action over a world it could
      // not enumerate rather than narrowing to what was visible; this is that rule on the one list a
      // price is decided against. Refusing costs a retry and says so; charging on it is the stale
      // balance with nothing anywhere complaining.
      if (bal.cut) return { cut: true, have: bal.have, source: bal.source };
      if (bal.have == null) return null;                       // cannot say — the charge decides
      if (bal.have >= Number(cost.amount)) return null;
      return bal;
    }
    /** The three tokens an `insufficient` line needs, so both call sites fill them identically. */
    const shortVars = (short, currency) => ({
      have: short.have,
      pool: poolWord(currency),
      asof: short.source === 'db' ? msgText('asofSave') : '',
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
        if (out === 'ok') host.logger.debug(`took ${amt} from ${steamId}'s ${poolEn(cost.currency)}`);
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
      const price = `${Math.abs(Number(cost.amount) || 0)} ${cost.currency} (${poolEn(cost.currency)})`;
      if (why === 'unconfirmed') {
        // Nobody online: the charge went out with no answer, so it may or may not have been taken.
        host.logger.warn(`${name || steamId} received "${what}"; the ${price} charge could NOT BE CONFIRMED. Check their balance before reversing anything.`);
      } else {
        host.logger.warn(`${name || steamId} received "${what}" but the ${price} charge failed. Reconcile by hand if needed.`);
      }
      try {
        host.notify('admin.alert', {
          message: why === 'unconfirmed'
            ? `Commands & Kits: ${name || steamId} got "${what}"; the ${price} charge is unconfirmed. Check their balance.`
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

    // ── the per-player ledger: claims, claim counts, group picks, saved positions, welcome times ──
    //
    // These used to be one store key EACH (`claim:<id>:<sid>`, `count:…`, `group:…`, `pos:…`,
    // `wmsg:…`), and the store rewrites its whole file on every `set`. So one paid kit read that file
    // three to six times and rewrote it up to five, and clearing the claims list rewrote it once per
    // key. They now live together under ONE key, held in memory and written back once per operation
    // — synchronously, before the operation reports anything, so a claim that was recorded is on disk
    // exactly as before. The key names inside are unchanged.
    //
    // Upgrading: the old per-player keys are read once and carried into the ledger, which is written
    // straight away. They are left where they are rather than deleted one rewrite at a time; nothing
    // reads them once the ledger exists.
    //
    // ⚠ "The store could not be read" and "the store is empty" look the same from here — both come
    // back `{}`, and the store then refuses to write, so nothing on disk is lost. Until the ledger has
    // been confirmed ON DISK every read asks the store again and merges what it finds, so a store
    // that was locked at boot and readable a minute later still has its old claims honoured. A
    // count keeps the higher of the two figures and a claim the later time: the merge errs towards
    // "already claimed", never towards a second one.
    const LEDGER_KEY = 'ledger';
    // ⚠ **THIS IS AN ALLOW-LIST AND A NEW KIND OF ENTRY HAS TO BE ADDED TO IT.** `mergeFrom` drops
    // anything it does not match, so an entry written under a prefix that is not here is saved,
    // read back, and silently discarded on the next merge — which is every restart. `var:` is the
    // per-player place in a kit's variant rotation, and without it a rotating kit would hand every
    // player the first variant for ever, resetting on each boot, with nothing to see.
    const LEDGER_ENTRY = /^(claim|count|group|pos|wmsg|var):/;
    const WELCOME_MIN_GAP_MS = 5 * 60 * 1000;
    const ledger = (() => {
      const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
      const isObj = (v) => !!(v && typeof v === 'object' && !Array.isArray(v));
      const data = {};
      let onDisk = false;
      const dropped = new Set();     // deleted this session: a late merge must not bring them back
      let lazyPending = false;
      function mergeFrom(all) {
        const src = isObj(all[LEDGER_KEY]) ? all[LEDGER_KEY] : all;
        const now = Date.now();
        for (const k of Object.keys(src)) {
          if (!LEDGER_ENTRY.test(k) || dropped.has(k)) continue;
          const v = src[k];
          // A welcome time only matters for five minutes; an old one is not worth carrying.
          if (k.startsWith('wmsg:') && !(now - (Number(v) || 0) < WELCOME_MIN_GAP_MS)) continue;
          if (!own(data, k)) { data[k] = v; continue; }
          if (k.startsWith('count:')) data[k] = Math.max(Number(data[k]) || 0, Number(v) || 0);
          else if (k.startsWith('claim:') && atOf(v) > atOf(data[k])) data[k] = v;
        }
      }
      function catchUp() {
        if (onDisk) return;
        let all = null;
        try { all = host.store.all(); } catch (e) { all = null; }
        if (!isObj(all)) return;
        mergeFrom(all);
        if (isObj(all[LEDGER_KEY])) onDisk = true;
      }
      function save() {
        lazyPending = false;
        catchUp();
        const now = Date.now();
        for (const k of Object.keys(data)) if (k.startsWith('wmsg:') && !(now - (Number(data[k]) || 0) < WELCOME_MIN_GAP_MS)) delete data[k];
        try { host.store.set(LEDGER_KEY, data); } catch (e) { host.logger.error(`could not save the claim ledger: ${e.message}`); }
        if (!onDisk) { try { onDisk = isObj(host.store.get(LEDGER_KEY, null)); } catch (e) { onDisk = false; } }
      }
      catchUp();
      save();                          // the one-time carry-over, and the read-back that confirms it
      return {
        get(k, dflt) { catchUp(); return own(data, k) ? data[k] : dflt; },
        /** Write several entries in one save. `lazy` batches a welcome time into a later save. */
        set(entries, opts) {
          for (const k of Object.keys(entries)) { data[k] = entries[k]; dropped.delete(k); }
          if (opts && opts.lazy) {
            if (!lazyPending) { lazyPending = true; host.schedule.after(10000, () => { if (lazyPending) save(); }); }
            return;
          }
          save();
        },
        /** Delete every entry `pred(key, value)` picks, in one save. */
        drop(pred) {
          catchUp();
          let n = 0;
          for (const k of Object.keys(data)) if (pred(k, data[k])) { delete data[k]; dropped.add(k); n++; }
          save();
          return n;
        },
        entries() { catchUp(); return Object.assign({}, data); },
        flush() { if (lazyPending) save(); },
      };
    })();
    if (typeof host.onUnload === 'function') host.onUnload(() => { try { ledger.flush(); } catch (e) { /* unloading */ } });
    // allow/deny entries come from the UI as {steamId,name} objects (or bare strings) → normalise to IDs.
    const asIds = (arr) => (Array.isArray(arr) ? arr.map((e) => (e && typeof e === 'object') ? String(e.steamId || e.steamid || e.SteamID || '').trim() : String(e).trim()).filter(Boolean) : []);
    /**
     * Is this character registered to a Discord account?
     *
     * `bySteamId` is SYNCHRONOUS (`safe(() => …)` in host.js) — no promise to forget to await, which
     * matters because a promise is truthy and would answer "linked" for everybody.
     *
     * ⚠ The test is `prof.steamId`, not `prof`, and that is the guard the SDK page spells out: this
     * call handed back a raw database row for as long as it existed, so the named field was
     * `undefined` for every linked player there has ever been — and THIS PLUGIN's kit claim was one
     * of the two that told correctly-linked people to go and link. Fixed in the host; written the
     * documented way here so it cannot come back.
     */
    function isLinked(sid) {
      if (!sid) return false;
      const prof = host.players.bySteamId(String(sid));
      return !!(prof && prof.steamId);
    }
    function allowed(obj, sid) {
      const deny = asIds(obj && obj.deny); if (deny.includes(String(sid))) return false;
      const allow = asIds(obj && obj.allow); if (allow.length) return allow.includes(String(sid));
      return true;
    }
    /** Milliseconds until this player may use it again — 0 when they may now. */
    function cooldownLeftMs(id, cdHours, sid) {
      const cd = Math.max(0, Number(cdHours) || 0); if (cd <= 0) return 0;
      const last = atOf(ledger.get(K.claim(id, sid), 0));
      return Math.max(0, cd * 3600e3 - (Date.now() - last));
    }
    function cooldownLeftH(id, cdHours, sid) { return Math.ceil(cooldownLeftMs(id, cdHours, sid) / 3600e3); }
    /**
     * The same wait, in words, and the reason `{h}` was not simply fixed.
     *
     * `{h}` is documented as HOURS and rounds up, so one minute left of a day-long cooldown reads
     * "~1h" and a player waits an hour for something that was ready in sixty seconds. But the token
     * is in every message an owner has already written, and a token that silently starts saying
     * "25m" inside "~{h}h" would print "~25mh" on their server. So `{h}` keeps its meaning exactly
     * and `{left}` is the new one the shipped message uses — additive, which is the rule here.
     */
    function fmtLeft(ms) {
      const s = Math.max(0, Math.ceil(Number(ms) / 1000));
      if (s >= 3600) { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return m ? `${h}h ${m}m` : `${h}h`; }
      if (s >= 60) return `${Math.ceil(s / 60)}m`;
      return `${s}s`;
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
        // host.time is missing, so every command or pack with a time window is treated as closed.
        host.logger.warn('host.time is missing: this manager is too old for time windows, so those entries stay closed. Update it.');
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
      if (!t) return msgText('windowNeedsUpdate');
      const r = t.isOpen(entry.windows);
      return r.open ? '' : r.why;
    }

    // ── …and the OTHER clock: the game's own time of day ─────────────────────────────────────────
    //
    // A second, independent window, and the two answer different questions. `windows` above is the
    // SERVER'S wall clock — days of the week, dates, "a weekend kit", "evenings" — and `gameTime`
    // here is the hour it is IN THE GAME, which is the only way to say "only at night". Neither can
    // say what the other says: SCUM has a time of day and no day of the week at all, and the server
    // clock knows nothing about a world running at eight game hours to the real one.
    //
    // They are ANDed. Each is a restriction, and any other composition is a surprise.
    //
    // ⚠ **AND THEY FAIL IN OPPOSITE DIRECTIONS, WHICH LOOKS INCONSISTENT AND IS NOT.** A wall clock
    // is arithmetic on something that is always there, so a window that cannot be read means
    // something is broken and CLOSED is the loud, safe direction — that is `timeWindows.js`'s own
    // rule and it is right. The game's clock comes from the bridge's `live` module, and every bridge
    // module SHIPS OFF: "cannot be read" is the ORDINARY state of a server whose owner has not
    // switched that group on. Closing there would silently disarm every kit with a night window on
    // most servers on the day they updated, with nothing anywhere saying why.
    //
    // So an unreadable game clock means the window is **NOT APPLIED** — the kit behaves exactly as it
    // did before anybody set one — and that state is said out loud, every round, on the panel, in
    // the log and through `/status`. **"Closed" and "not being applied" must never read as the same
    // sentence**, which is why `closedGame` exists beside `closed` and why `gameWindowState()`
    // answers three states rather than a boolean.
    const nzNum = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
    // The clock comes from the bridge's Live player data module; both switches below are reads.
    const NO_GAME_CLOCK = 'the game clock is unreadable. Turn on "Read live player data" and '
      + '"Time of day and day length" in the SSA Bridge.';
    // Twenty seconds, for the reason Loot Zones keeps its own reading that long: at the default day
    // speed of 8 game hours to the real one a game hour is 7.5 real minutes, so twenty seconds is
    // 0.044 of an hour — far finer than the whole hours a window is written in, and it turns a read
    // per claim (and per `/help` row) into one per burst.
    const GAME_CLOCK_MS = 20000;
    let gameClockAt = 0;
    let gameClockWas = null;
    /**
     * `{ hour, unit, speed, speedUnit }`, or `{ unknown, why }`. Never throws, never blocks on a
     * bridge that is not there.
     *
     * ⚠ **"NOTHING CAME BACK" IS NOT MIDNIGHT.** The world payload answers an object carrying a
     * `note` when the module's world groups are off or the weather controller is not in the world
     * yet — both perfectly ordinary, neither of them a time. A missing `timeOfDay` is `unknown` and
     * never 0, which would otherwise put every "at night" kit permanently into the small hours.
     */
    async function gameClock() {
      if (gameClockWas && Date.now() - gameClockAt < GAME_CLOCK_MS) return gameClockWas;
      let w = null;
      try {
        const f = host.bridge && host.bridge.world;
        if (typeof f === 'function') w = await Promise.resolve(f.call(host.bridge)).catch(() => null);
      } catch (e) { w = null; }
      const hour = w ? nzNum(w.timeOfDay, NaN) : NaN;
      // Positive form. Every comparison against NaN is false, so the negated range test would let a
      // NaN hour straight through — the shape this project has paid for six times over.
      const v = (Number.isFinite(hour) && hour >= 0 && hour < 24.0001)
        ? { hour, unit: 'game-hours', speed: nzNum(w.timeSpeed, null), speedUnit: 'game-hours-per-real-hour' }
        // The module's own sentence wherever it gave one: it is better than ours and it names the
        // switch that is off.
        : { unknown: true, why: (w && typeof w.note === 'string' && w.note.trim()) ? w.note.trim() : NO_GAME_CLOCK };
      gameClockWas = v;
      gameClockAt = Date.now();
      return v;
    }
    /** Whatever the last reading was, without asking. `null` before the first one has ever landed. */
    const gameClockCached = () => gameClockWas;

    /**
     * Tidy a game window on the way in — the sibling of `normalizeWindows` above, and the same job:
     * fix what is merely untidy so a config hand-edited, copied from another server or written by an
     * older panel does not reach an owner as a kit that quietly stopped being claimable.
     *
     * `enabled` is read by KEY PRESENCE and `=== true`, so a window that has never been switched on
     * stays off, and the two hours are whole numbers in 0..24 because that is what a window can be
     * written in and what a screen can show.
     */
    function normalizeGameTime(g) {
      if (!g || typeof g !== 'object') return g;
      const h = (v, d) => Math.max(0, Math.min(24, Math.round(nzNum(v, d))));
      return { enabled: g.enabled === true, fromHour: h(g.fromHour, 0), toHour: h(g.toHour, 24) };
    }
    /**
     * Tidy a variant list on the way in.
     *
     * The weight is the one field that has to survive being typed: a key that was never written, or
     * one holding nothing at all, becomes 1 — an equal share, which is what somebody who never
     * touched it meant — while a 0 somebody really typed is kept and means "never comes up".
     *
     * ⚠ **`Number('')` IS 0, AND SO IS `Number('  ')`.** Not NaN, which is what a finiteness test is
     * written expecting — so the obvious version of this function turns a key holding an empty
     * string into a considered zero, and a variant that nobody meant to switch off never comes up
     * again, silently, for as long as that config lives. It is the same trap that read an empty
     * coordinate box as the island's origin. The emptiness is tested BEFORE the conversion, because
     * afterwards there is nothing left to tell an empty box from a typed nought.
     *
     * Positive form throughout, so a NaN cannot slip past a range test and become a share of the
     * pool.
     */
    function normalizeVariants(list) {
      if (!Array.isArray(list)) return [];
      return list.map((v, i) => {
        if (!v || typeof v !== 'object') return v;
        // THE one reading, not a second copy of it — see `readWeight`, which is where the rule and
        // the reasoning live. This route's job is to write the tidied value back, not to decide
        // what it is.
        const weight = readWeight(v);
        return Object.assign({}, v, {
          id: String(v.id || ('v' + (i + 1))),
          name: String(v.name == null ? '' : v.name),
          enabled: v.enabled !== false,
          weight,
          items: Array.isArray(v.items) ? v.items : [],
          vehicles: Array.isArray(v.vehicles) ? v.vehicles : [],
          inventories: Array.isArray(v.inventories) ? v.inventories : [],
          actions: Array.isArray(v.actions) ? v.actions : [],
          message: String(v.message == null ? '' : v.message),
        });
      });
    }

    /** `{ on, from, to }` off whatever an owner set. `on: false` is every config written before this. */
    function gameWindowOf(entry) {
      const g = entry && entry.gameTime;
      if (!g || typeof g !== 'object' || g.enabled !== true) return { on: false };
      // Whole game hours: a window is written in them, and a fractional one cannot be put on a
      // screen in a way anybody can act on.
      const h = (v, d) => Math.max(0, Math.min(24, Math.round(nzNum(v, d))));
      return { on: true, from: h(g.fromHour, 0), to: h(g.toHour, 24) };
    }
    /** `21:00` out of a whole game hour, for a sentence somebody reads. */
    const gameHHMM = (h) => `${String(Math.max(0, Math.min(24, Math.round(nzNum(h, 0)))) % 24).padStart(2, '0')}:00`;
    /**
     * THREE states, never two: `open`, `closed`, and `blind` — the window is set and is NOT being
     * applied because nothing could say what time it is in game.
     *
     * `clock` is passed IN rather than read here, because this is called from `blockReason`, which
     * `/help` runs with no `await` available to it and which must never touch the bridge — one
     * `/help` runs every provider on the server. The claim path hands it a freshly awaited reading;
     * `/help` hands it the cache, which is at most twenty seconds old and is a status line rather
     * than a charge.
     */
    function gameWindowState(entry, clock) {
      const win = gameWindowOf(entry);
      if (!win.on) return { applied: false, open: true, set: false };
      // 0–24 and from == to are both "all day" rather than "never": the second is a typo an owner
      // makes once, and reading it as an empty window disarms the kit for ever with no message.
      if (win.from === win.to || (win.from === 0 && win.to === 24)) return { applied: false, open: true, set: true, whole: true, win };
      if (!clock || clock.unknown) {
        return { applied: false, open: true, set: true, blind: true, win, why: (clock && clock.why) || NO_GAME_CLOCK };
      }
      const h = clock.hour;
      const open = win.from < win.to ? (h >= win.from && h < win.to) : (h >= win.from || h < win.to);
      return { applied: true, open, set: true, win, hour: h, speed: clock.speed };
    }
    /** Why this entry is out of GAME hours, in words a player can act on — or `''` when it is not. */
    function gameWindowWhy(entry, clock) {
      const st = gameWindowState(entry, clock);
      if (st.open) return '';
      // The hour it is NOW belongs in the sentence: a game clock runs at the server's own multiplier,
      // so "from 21:00" alone tells a player nothing about how long they have to wait. The speed is
      // named when the bridge gave it, because that is the only thing that turns the gap into
      // minutes somebody can plan around.
      // Both halves are the owner's words (`windowGame`, `windowGameSpeed`), because the player reads
      // this inside their `closedGame` line and a translated sentence with English in the middle is
      // not translated.
      const speed = Number(st.speed) > 0 ? fill(msgText('windowGameSpeed'), { speed: st.speed }) : '';
      return fill(msgText('windowGame'), { from: gameHHMM(st.win.from), to: gameHHMM(st.win.to), now: gameHHMM(st.hour), speed });
    }
    /** The one sentence either clock gives for a refusal, whichever of the two is doing it. */
    const anyWindowWhy = (entry, clock) => windowWhy(entry) || gameWindowWhy(entry, clock);

    // ── kit variants ─────────────────────────────────────────────────────────────────────────────
    //
    // "Once it gives this, then that", and "what the chance is of what it gives" — the owner asked
    // for both in one sentence, and they are two different mechanisms, so there is one list and two
    // modes rather than two features.
    //
    //   `random`  weights. A variant's share is its own weight over the total of the ones that can
    //             come up. The panel shows the weight AND the percentage it works out to, live,
    //             because a weight on its own is a number with no meaning — 3 is 75% beside a 1 and
    //             3% beside a 97.
    //   `rotate`  in turn, down the list, and **per player**. A server-wide turn order hands one
    //             player the same variant twice whenever somebody else claims in between, which is
    //             not what "once this, then that" means to the person receiving it.
    //
    // ⚠ **A VARIANT IS ADDED TO THE KIT, NEVER A REPLACEMENT FOR IT.** Three reasons, and the first
    // is the one that decides it: a kit that has items today and gains its first variant must keep
    // giving them, and under a replace reading the moment an owner adds one variant every existing
    // item in that kit stops being handed out — on a live server, silently. Second, "alternatives"
    // is perfectly expressible under add (leave the kit's own lists empty, which is what somebody
    // who wants alternatives does anyway) while "a fixed base plus a variable part" cannot be said
    // at all under replace. Third, one sentence on the screen covers it.
    //
    // ⚠ **AND THE SHARE IS NOT AN IMPLICIT ORDER.** Σweight of zero is not "pick the first": it is
    // "the owner has not said what should come up", so the kit falls back to its own contents, and
    // a kit with none of those is the ordinary `emptyKit` refusal with the claim and the cooldown
    // left alone. Choosing the first would be a decision nobody made.
    const VARIANT_MODES = ['random', 'rotate'];
    const variantMode = (pack) => (VARIANT_MODES.indexOf(String(pack && pack.variantMode)) >= 0 ? String(pack.variantMode) : 'random');
    /**
     * ⚠ **ONE READING OF A WEIGHT, AND THERE WERE BRIEFLY THREE.**
     *
     * A share is read in three places — the panel draws the percentage, the save route tidies what
     * is stored, and the roll shares the pool out — and they were written separately and disagreed
     * on two inputs. A weight of `-3` read as "never comes up" on the screen, as an equal share by
     * the save, and as "never" again by the roll; a `NaN` did the same. A number that means one
     * thing to the screen and another to the thing the screen is a picture of is the whole of the
     * *"neco je tam, neco tam a neco tam"* complaint, on a field nobody can check by looking.
     *
     * The rule, once:
     *
     *   • a key nobody wrote, one holding nothing, and one holding something that is not a number
     *     at all are all **1** — an equal share, which is what somebody who never touched the box
     *     meant, and the only reading under which a hand-edited config behaves like a typed one;
     *   • a **0** somebody really typed is kept, and really does mean never;
     *   • a NEGATIVE is not a decision either. It becomes 1 rather than 0, because reading it as
     *     "never" silently switches a variant off over a typo, and an owner who wanted it off has
     *     both a 0 and a toggle to say so with.
     *
     * The panel has its own copy in `varWeight()`, in its own language, and `check-plugin-balance`
     * drives the two against the same inputs so they cannot drift apart again.
     */
    function readWeight(v) {
      if (!v || typeof v !== 'object') return 1;
      const said = Object.prototype.hasOwnProperty.call(v, 'weight')
        && v.weight !== null && v.weight !== undefined
        && !(typeof v.weight === 'string' && String(v.weight).trim() === '');
      if (!said) return 1;
      const n = Number(v.weight);
      // Positive form: every comparison against NaN is false, so this answers 1 for one — which is
      // the "not a number at all" case above, not a special one.
      return (Number.isFinite(n) && n >= 0) ? Math.min(Math.round(n), 1e6) : 1;
    }
    /** The share this variant takes of the pool. 0 is a real answer and means it never comes up. */
    const variantWeight = (v) => readWeight(v);
    /** The variants that can come up at all: present, an object, and not switched off. */
    function variantsOf(pack) {
      const raw = (pack && Array.isArray(pack.variants)) ? pack.variants : [];
      return raw.filter((v) => v && typeof v === 'object' && v.enabled !== false);
    }
    const VAR_CURSOR = (id, sid) => `var:${id}:${sid}`;
    /**
     * Which variant this claim gets — decided BEFORE anything is delivered, because it decides what
     * is delivered.
     *
     * Returns `{ variant, index, mode, total, share }` or `null` for "this kit has no variant to
     * add", which is every kit written before this feature and every kit whose weights come to
     * nothing.
     *
     * ⚠ **IT DOES NOT ADVANCE THE ROTATION.** `advanceVariant()` does, and it is called at exactly
     * the point `recordUse` is — after a delivery that really happened. Advancing here would spend a
     * player's place in the turn order on a kit the bridge refused, which is the same defect as
     * spending their cooldown on it, and that one has already shipped once.
     */
    function pickVariant(pack, id, sid) {
      const list = variantsOf(pack);
      if (!list.length) return null;
      const mode = variantMode(pack);
      if (mode === 'rotate') {
        // The cursor is a COUNT of claims, not an index, so inserting or removing a variant moves
        // whose turn it is by one rather than resetting everybody to the top of the list.
        const seen = Math.max(0, Number(ledger.get(VAR_CURSOR(id, sid), 0)) || 0);
        const index = seen % list.length;
        return { variant: list[index], index, mode, total: list.length, share: null };
      }
      const total = list.reduce((a, v) => a + variantWeight(v), 0);
      if (!(total > 0)) return null;          // positive form; nothing can come up, so nothing does
      /**
       * ⚠ **A ZERO-WEIGHT ENTRY IS SKIPPED OUTRIGHT, NEVER "STEPPED OVER".**
       *
       * The obvious walk subtracts each weight and takes the first entry that drives the running
       * total to nought or below — and that hands a roll of exactly 0 to whatever sits FIRST in the
       * list, weight or no weight, because subtracting 0 leaves the total at 0 and the test fires.
       * A variant an owner switched off by setting its chance to 0 would then come up after all,
       * once in about nine quadrillion claims: never on any server, and reliably in the one place a
       * rule like this is read rather than run. `Math.random()` really does return 0.
       *
       * Comparing BEFORE subtracting, and skipping a weight of 0 before comparing at all, has
       * neither hole: `roll` is in `[0, total)`, every entry that can be reached has a weight above
       * zero, and `0 < w` is true for the first of them.
       */
      let roll = Math.random() * total;
      let last = null;
      for (let i = 0; i < list.length; i++) {
        const w = variantWeight(list[i]);
        if (!(w > 0)) continue;               // cannot come up, whatever the roll is
        last = { variant: list[i], index: i, mode, total: list.length, share: w / total };
        if (roll < w) return last;
        roll -= w;
      }
      // Floating-point rounding can leave a hair of `roll` after the last subtraction. The last
      // entry that COULD have come up is the honest answer, and `last` is never null here because
      // `total > 0` means at least one entry has a weight.
      return last;
    }
    /**
     * One step of the turn order, for one player — only ever called after a delivery that happened.
     *
     * The id is the PACK's, the same string `recordUse` keys a claim by, so resetting a player's
     * claims and resetting their place in the rotation are the same gesture and cannot come apart.
     */
    function advanceVariant(pack, id, sid) {
      if (variantMode(pack) !== 'rotate') return;
      if (!variantsOf(pack).length) return;
      const k = VAR_CURSOR(id, sid);
      ledger.set({ [k]: (Number(ledger.get(k, 0)) || 0) + 1 });
    }
    /**
     * The kit as it will actually be delivered: its own contents with the chosen variant's added.
     *
     * A shallow object over the pack, so every other field — cost, cooldown, group, channel, the
     * allow and deny lists — is the pack's own and there is no second copy of any of them to drift.
     * Only the four reward lists and the message are combined, and the variant's message REPLACES
     * the kit's when it has one (two messages about one delivery is two lines in the player's chat
     * saying the same thing).
     */
    function resolvePack(pack, chosen) {
      if (!chosen || !chosen.variant) return pack;
      const v = chosen.variant;
      const join = (a, b) => (Array.isArray(a) ? a : []).concat(Array.isArray(b) ? b : []);
      return Object.assign({}, pack, {
        items: join(pack.items, v.items),
        vehicles: join(pack.vehicles, v.vehicles),
        inventories: join(pack.inventories, v.inventories),
        actions: join(pack.actions, v.actions),
        message: (v.message && String(v.message).trim()) ? v.message : pack.message,
      });
    }

    // Why a pack/command can't be used right now — or null if it can. `cmd` treats cooldown only.
    //
    // `clock` is the game's time of day, passed in rather than read: this runs on the `/help` path
    // too, which has no `await` and must never reach the bridge. `undefined` there is the same as
    // an unreadable clock, which means a game window is NOT APPLIED — see `gameWindowState`.
    function blockReason(entry, id, sid, isCommand, clock) {
      if (!allowed(entry, sid)) return 'notAllowed';
      // Straight after the deny list and before every other reason, and the ORDER is the point.
      // After `allowed()`: somebody on the deny list is refused whatever they do, so sending them
      // off to link an account would be a lie. Before the window and the cooldown, for the reason
      // the comment below gives about `closed` — a player who can never use this must not be told
      // to come back at eight.
      if (entry && entry.requireLinked && !isLinked(sid)) return 'notLinked';
      // After allow/deny and before everything else. A player who is denied outright must not be
      // told to come back at eight; a player who is merely early should hear that before they hear
      // about a cooldown that is not what is stopping them.
      if (windowWhy(entry)) return 'closed';
      // The game's clock, second, and it is its own refusal rather than a second `closed`. The order
      // between the two is the owner's real one: the wall clock decides whether the thing is on
      // offer this evening at all, the game clock decides whether this is the right time of day
      // inside it, and a player told the second while the first also refuses would come back in
      // game-night to a kit that is not running today.
      if (gameWindowWhy(entry, clock)) return 'closedGame';
      if (!isCommand && entry.group) { const chosen = ledger.get(K.group(entry.group, sid), ''); if (chosen && chosen !== id) return 'groupLocked'; }
      if (!isCommand) { const max = Math.max(0, Number(entry.maxClaims) || 0); if (max > 0 && (Number(ledger.get(K.count(id, sid), 0)) || 0) >= max) return 'maxClaims'; }
      const cd = Math.max(0, Number(entry.cooldownHours) || 0);
      const last = atOf(ledger.get(K.claim(id, sid), 0));
      if (cd > 0) { if ((Date.now() - last) < cd * 3600e3) return 'cooldown'; }
      else if (!isCommand && entry.trigger === 'welcome') { if (last !== 0) return 'alreadyClaimed'; }
      return null;
    }
    function recordUse(id, sid, name, group) {
      // One save for all of it, and before the caller reports anything — see the ledger above.
      const entries = {};
      entries[K.claim(id, sid)] = { at: Date.now(), name: name || '' };
      entries[K.count(id, sid)] = (Number(ledger.get(K.count(id, sid), 0)) || 0) + 1;
      if (group) entries[K.group(group, sid)] = id;
      ledger.set(entries);
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
    // The delivery counters are a tally for the panel, not a record of anything a player paid for
    // (that is the activity log and the ledger, both saved at once). So they are written at most every
    // 30 s and on unload instead of costing a store rewrite per delivery; a crash can lose the last
    // few seconds of the tally and nothing else. `persistStats(true)` writes at once (the reset button).
    let statsDirty = false;
    function persistStats(now) {
      if (!now) {
        if (!statsDirty) { statsDirty = true; host.schedule.after(30000, () => { if (statsDirty) persistStats(true); }); }
        return;
      }
      statsDirty = false;
      try { host.store.set('ckstats', stats); } catch { /* ignore */ }
    }
    if (typeof host.onUnload === 'function') host.onUnload(() => { if (statsDirty) persistStats(true); });
    // The activity log is written back at most every two seconds and on unload, not once per row: the
    // store rewrites its whole file on every `set`, and a kit for a full server was a rewrite per
    // player. What a player PAID for is the ledger, which is still written at once; this is the
    // panel's history of it, and the admin alert for an unpaid delivery goes out immediately anyway.
    let recentDirty = false;
    function persistRecent() {
      recentDirty = false;
      try { host.store.set('recent', recent.slice(0, 150)); } catch { /* ignore */ }
    }
    if (typeof host.onUnload === 'function') host.onUnload(() => { if (recentDirty) persistRecent(); });
    function pushRecent(rec) {
      recent.unshift(rec);
      if (recent.length > 150) recent = recent.slice(0, 150);
      if (!recentDirty) { recentDirty = true; host.schedule.after(2000, () => { if (recentDirty) persistRecent(); }); }
      try { host.realtime.toAdmins('commands-kits:event', { rec: rec, stats: stats, queue: spawnQueue.length }); } catch { /* realtime optional */ }
    }
    function statusSnapshot() {
      return {
        queue: spawnQueue.length, running: spawnBusy, stats: stats, recent: recent,
        // Live queue for the panel: the item being dispatched now + what's waiting (labels only).
        current: currentJob ? (currentJob.view || currentJob.label) : null,
        queueItems: spawnQueue.slice(0, 50).map((j) => j.view || j.label),
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
    //
    // `report` is the caller's own object rather than a shared one on purpose: two claims can be in
    // the queue at once, and "the game refused one of MY items" has to stay attached to the delivery
    // it belongs to. The queue writes the refused labels into it; a caller that passes nothing gets
    // exactly the old behaviour.
    function enqueueSpawn(cmd, opts, label, report, view) {
      return new Promise((resolve) => {
        if (spawnQueue.length >= MAX_QUEUE) { host.logger.warn(`[spawn-queue] full (${MAX_QUEUE}) — dropping "${label}"`); return resolve(false); }
        spawnQueue.push({ cmd: cmd, opts: opts, label: label, view: view || null, resolve: resolve, report: report });
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
              const r = await host.server.command(job.cmd, job.opts || undefined);
              const out = cmdOutcome(r);
              // ⚠ **A SPAWN CAN BE DISPATCHED, CONFIRMED, AND HAVE SPAWNED NOTHING**, and retrying it
              // is pointless. That is what a stale code is: the command is perfect, the game answers
              // *"'BP_Gone_C' is not allowed to be spawned."*, and `cmdOutcome` is entirely right
              // that it ran. The bridge has carried the game's own verdict as `status` since 2.1 and
              // nothing here read it, so an item a game update had moved counted as delivered and
              // the player paid for it. `status` rides on `SpawnItem`/`SpawnVehicle` only, so an
              // owner's own template — or an older bridge — is judged by nothing, the same shape as
              // `confirmed !== false`.
              const refused = !!(r && r.status === 'refused');
              ok = out === 'ok' && !refused;
              if (refused) {
                // Not retried and not counted as delivered; a game update has usually moved the spawn code.
                host.logger.warn(`[spawn-queue] the GAME refused "${job.label}" — ${(Array.isArray(r.output) && r.output.filter(Boolean).join(' | ')) || '(it said nothing)'}. Check the spawn code.`);
                if (job.report && Array.isArray(job.report.gameRefused)) job.report.gameRefused.push(job.label);
                break;
              }
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
        // An action that names the player's position, when no position is known, would put the
        // player's frozen `{x} {y} {z}` on the wire as 0 0 0 — the island's origin. Skipped and said,
        // and it does not count toward the charging fuse.
        if (!frozenLoc && USES_POS.test(raw)) {
          host.logger.warn(`action "${raw}" was skipped: no position is known for ${steamId}`);
          continue;
        }
        // The same for {saved_x} {saved_y} {saved_z} before any command has remembered a position.
        if (/\{saved_[xyz]\}/i.test(raw) && !ledger.get('pos:' + steamId, null)) {
          host.logger.warn(`action "${raw}" was skipped: no remembered position for ${steamId}`);
          continue;
        }
        const cmd = await substLive(raw, name, steamId, ctx, { loc: frozenLoc, x: frozenLoc && frozenLoc.x, y: frozenLoc && frozenLoc.y, z: frozenLoc && frozenLoc.z });
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
            else if (out === 'unconfirmed') host.logger.warn(`action "${cmd}" is unconfirmed (nobody online), so it does not count toward charging`);
            else ran++;
          } catch (e) { host.logger.debug(`action failed: ${e.message}`); }
        }
      }
      return ran;
    }

    // ── deliver a pack (spawn items/vehicles + charge + record + message) ──────────
    async function deliver(steamId, name, pack, i) {
      const id = packId(pack, i);
      // ── WHICH VARIANT, DECIDED HERE AND SPENT LATER ───────────────────────────────
      //
      // First, because the variant decides what is delivered and every fuse below has to judge what
      // will REALLY be handed over — a kit whose own lists are empty and whose variant carries the
      // items is not an empty kit, and the empty-kit refusal one paragraph down would otherwise
      // turn every alternatives-style kit into "not ready yet".
      //
      // ⚠ **AND THE TURN ORDER IS NOT ADVANCED HERE.** `advanceVariant` is called beside
      // `recordUse`, after a delivery that actually happened, for exactly the reason the cooldown
      // is recorded there: a claim the bridge refused must cost the player nothing, and a place in
      // a rotation is something they paid for with a claim. Advancing at the moment of the roll
      // would have been the same defect as the cooldown one this plugin has already shipped once,
      // on a piece of state nobody would think to look at.
      const chosen = pickVariant(pack, id, steamId);
      const given = resolvePack(pack, chosen);
      if (chosen) {
        host.logger.debug(`"${pack.name || id}" for ${name || steamId}: variant "${(chosen.variant && chosen.variant.name) || ('#' + (chosen.index + 1))}" `
          + `(${chosen.mode === 'rotate' ? `turn ${chosen.index + 1} of ${chosen.total}` : `${Math.round((chosen.share || 0) * 100)}% chance`})`);
      } else if (Array.isArray(pack.variants) && pack.variants.length) {
        // Variants exist and not one of them can come up — every weight zero, or every one switched
        // off. The kit falls back to its own contents, which may well be enough; if it has none, the
        // empty-kit refusal below is reached and the claim is not spent. Said out loud either way,
        // because from a player's side a kit quietly giving only its base is indistinguishable from
        // one whose variants are working.
        // Every variant is switched off or has a chance of 0, so only the kit's own contents were given.
        host.logger.warn(`"${pack.name || id}" has ${pack.variants.length} variant(s) and none of them can be picked. Switch one on or raise its chance.`);
      }
      // ── A KIT WITH NOTHING IN IT IS REFUSED, BEFORE ANYTHING ELSE HAPPENS ──────────
      //
      // The two fuses below — "nothing spawned" and "every action refused" — both need something to
      // have been ATTEMPTED. A kit with no items, no vehicles, no containers and no actions attempts
      // nothing, so neither fires, and the player is charged nothing, told "Enjoy your starter pack",
      // given nothing, and has their claim and their cooldown spent on it. A one-a-day kit costs them
      // the day.
      //
      // It is not a hypothetical shape: it is what an empty kit an owner has not finished filling in
      // looks like, and the answer a player deserves is that it is not ready, not a thank-you note.
      // Refusing here also leaves `recordUse` unreached, so the claim and the cooldown survive for
      // when the kit really has something in it.
      //
      // ⚠ **IT JUDGES `given`, NOT `pack`, AND THAT IS THE WHOLE OF IT.** A kit whose own lists are
      // empty and whose variants carry the items is the natural way to write "one thing OR another",
      // and judging the raw pack refuses every one of them with "it is not ready yet" — a sentence
      // about an owner who has done nothing wrong, on the shape the variants feature exists for.
      const packText = (a) => String((a && (a.cmd || a.command)) || (typeof a === 'string' ? a : '')).trim();
      const hasSomething = (given.items || []).some((it) => it && it.item)
        || (given.vehicles || []).some((v) => v && v.code)
        || (given.inventories || []).some((iv) => iv && iv.container && iv.fill)
        || (Array.isArray(given.actions) ? given.actions : []).some((a) => packText(a));
      if (!hasSomething) {
        host.logger.warn(`"${pack.name || id}" is empty, so ${name || steamId} got nothing and paid nothing. Add something on Kits & Packs.`);
        return { ok: false, reason: 'emptyKit' };
      }
      // From here down "the pack" IS the resolved one. Everything below spawns, charges, records and
      // announces, and every one of those has to be about what the player is really getting — while
      // the cost, the cooldown, the group and the allow lists are the kit's own and come across
      // unchanged, because `resolvePack` is a shallow copy over it rather than a new object.
      pack = given;
      // Spawn targets the player by SteamID, so the player just needs to be connected — which they are
      // (they typed the command, or just joined). We do NOT gate on live map coordinates: getMapData()
      // can lag or be empty right after connect, and blocking on it made packs "give nothing".
      // The position is asked for only when something in this kit names it: the shipped spawn templates
      // target the player by Steam ID and need none, and a kit should not wait on the game for nothing.
      // A custom spawn template naming {x} {y} {z} with no position known keeps the token unfilled, and
      // the game refuses it, rather than spawning at the island's origin.
      const cfgNow = cfg();
      const actText = (a) => String((a && (a.cmd || a.command)) || (typeof a === 'string' ? a : ''));
      const needsPos = [cfgNow.itemSpawnCmd, cfgNow.vehicleSpawnCmd, cfgNow.invSpawnCmd].some((t) => t && USES_POS.test(String(t)))
        || (Array.isArray(pack.actions) ? pack.actions : []).some((a) => USES_POS.test(actText(a)));
      const loc = needsPos ? await playerLocNow(steamId) : playerLoc(steamId);
      const lp = loc || {};
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
        if (short) {
          // The online list came back cut, so the live balance is unknown and the saved one is unsafe.
          if (short.cut) host.logger.warn(`"${pack.name || id}" was refused for ${name || steamId}: their balance could not be checked live.`);
          return { ok: false, reason: short.cut ? 'listCut' : 'insufficient', have: short.have, balanceSource: short.source };
        }
        host.logger.debug(`${name || steamId} may claim "${pack.name || id}" (${cost.amount} ${cost.currency} from their ${poolEn(cost.currency)})`);
      }
      const c = cfg();
      // Spawn FIRST. Fuse: if nothing lands, don't charge and don't spend the claim.
      let spawned = 0, total = 0, failed = 0;
      const failedItems = [];   // human-readable names of what didn't land, for the activity log
      // Which of this delivery's spawns the GAME itself refused (a stale code), as opposed to ones
      // the bridge could not deliver. The player's advice differs: "try again" is right for the
      // second and is a lie about the first, which will never work until an admin changes the code.
      const spawnReport = { gameRefused: [] };
      // Clamp any spawn count to a sane ceiling so a config typo (or a shop arg) can't ask the game for
      // millions of items and take the server down.
      const clampCount = (n) => Math.max(1, Math.min(1000, Math.floor(Number(n) || 1)));
      // All spawns go through the throttled+retried queue so a burst never faults items away.
      // ── TWO LABELS PER SPAWN, AND THEY ARE FOR DIFFERENT READERS ────────────────────────────────
      //
      // `label` keeps the CODE: it goes into the manager's log and the admin alert, where whoever
      // reconciles a delivery needs the exact spawn code. `view` is what the panel draws — the
      // game's own name through the resolver, the count, and for a container the item it is filled
      // with as a separate field, so no English "of" is glued in here and the panel words it in the
      // reader's language. The failed-item chip keeps `code` for its preview link.
      for (const it of (pack.items || [])) {
        if (!it.item) continue; total++;
        const n = clampCount(it.count);
        const label = `${it.item}${n > 1 ? ` ×${n}` : ''}`;
        const view = { code: it.item, name: prettyCode(it.item), count: n, player: name || '' };
        const cmd = fill(c.itemSpawnCmd || DEFAULT_ITEM_CMD, { item: it.item, count: n, x: lp.x, y: lp.y, z: lp.z, steamid: steamId });
        (await enqueueSpawn(cmd, spawnOpts, `${label} → ${name}`, spawnReport, view)) ? spawned++ : (failed++, failedItems.push({ code: it.item, label: `${view.name}${n > 1 ? ` ×${n}` : ''}`, name: view.name, count: n, codeLabel: label }));
      }
      for (const v of (pack.vehicles || [])) {
        if (!v.code) continue; total++;
        const n = clampCount(v.count);
        const label = `${v.code}${n > 1 ? ` ×${n}` : ''}`;
        const view = { code: v.code, name: prettyCode(v.code), count: n, player: name || '' };
        const cmd = fill(c.vehicleSpawnCmd || DEFAULT_VEH_CMD, { code: v.code, count: n, x: lp.x, y: lp.y, z: lp.z, steamid: steamId });
        (await enqueueSpawn(cmd, spawnOpts, `${label} → ${name}`, spawnReport, view)) ? spawned++ : (failed++, failedItems.push({ code: v.code, label: `${view.name}${n > 1 ? ` ×${n}` : ''}`, name: view.name, count: n, codeLabel: label }));
      }
      // filled containers (backpack/vest/crate full of an item) — #SpawnInventoryFullOf has no Location,
      // so it's run THROUGH the target player (executor) and appears on them.
      for (const inv of (pack.inventories || [])) {
        if (!inv.container || !inv.fill) continue; total++;
        const sets = clampCount(inv.sets);
        const label = `${inv.container} + ${inv.fill}`;
        const view = { code: inv.container, name: prettyCode(inv.container), fill: inv.fill, fillName: prettyCode(inv.fill), player: name || '' };
        const cmd = fill(invCmd(c.invSpawnCmd), { container: inv.container, sets: sets, fill: inv.fill, x: lp.x, y: lp.y, z: lp.z, steamid: steamId });
        (await enqueueSpawn(cmd, { executor: steamId, hide }, `${label} → ${name}`, spawnReport, view)) ? spawned++ : (failed++, failedItems.push({ code: inv.container, label: `${view.name} + ${view.fillName}`, name: view.name, fill: inv.fill, fillName: view.fillName, codeLabel: label }));
      }
      // `variant` is on the row because it is the only way an owner can check that the chances are
      // doing what they set: a weighted roll is invisible from anywhere else, and "it always gives
      // me the same one" is a report nobody can answer without a list of what really went out.
      const rec = { at: Date.now(), player: name || null, steamId: steamId, reward: pack.name || id, kind: 'kit', spawned: spawned, total: total, failed: failed, failedItems: failedItems,
        variant: chosen ? ((chosen.variant && chosen.variant.name) || `#${chosen.index + 1}`) : null };
      stats.deliveries++; stats.ok += spawned; stats.failed += failed; persistStats();
      if (total > 0 && spawned === 0) {
        pushRecent(rec);
        // "Try again" is the right advice for a bridge that was busy and the wrong advice for a code
        // the game will refuse every time until somebody edits it. Nothing was taken either way — the
        // charge is below this fuse — so both sentences are honest about the money and only one is
        // honest about what to do next.
        if (spawnReport.gameRefused.length) {
          host.logger.warn(`"${pack.name || id}" delivered nothing to ${name || steamId}: the game refused ${spawnReport.gameRefused.join(', ')}. Nothing was charged; check those spawn codes.`);
          try {
            host.notify('admin.alert', {
              message: `Commands & Kits: the game refused every spawn in "${pack.name || id}" (${spawnReport.gameRefused.join(', ')}). Nobody was charged; check the spawn codes.`,
              severity: 'warning',
            });
          } catch (e) { /* notifications are optional */ }
          return { ok: false, reason: 'spawnRefused' };
        }
        return { ok: false, reason: 'spawnFailed' };
      }
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
        host.logger.warn(`"${pack.name || id}": the bridge refused every action. ${name || steamId} was not charged; the claim is unspent.`);
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
        // The same price as structure, so the panel can name the currency in the reader's language
        // rather than printing the config key.
        rec.priceAmount = Math.abs(Number(cost.amount) || 0);
        rec.priceCurrency = cost.currency || null;
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
        const missing = failedItems.map((f) => (f && (f.codeLabel || f.label)) || (f && f.code) || '?').join(', ');
        host.logger.warn(`"${pack.name || id}" reached ${name || steamId} with ${failed} of ${total} item(s) MISSING (${missing}) — they were charged the full price.`);
        try {
          // The PLAYER's copy names the things the way the game names them; the log line above keeps
          // the codes, because an admin reconciling this needs the code and a player cannot use one.
          const missingForPlayer = failedItems.map((f) => prettyCode((f && f.code) || '') || (f && f.label) || '?').join(', ');
          // Which of the three the charge really was decides the sentence. `partial` claims "you were
          // charged in full", which was said even when the charge had been refused outright and even
          // when nobody could say — see the two siblings beside it in DEFAULT_MSG.
          const partKey = !paid || took.ok ? 'partial' : (took.why === 'unconfirmed' ? 'partialUnknown' : 'partialUnpaid');
          await host.chat.dm(steamId, await substLive(fill(msgText(partKey), { pack: pack.name || id, missing: missingForPlayer }), name, steamId, null),
            { channel: replyChannelFor(pack) });
        } catch (e) { /* the in-game line is best effort; the log and the panel still have it */ }
      }
      pushRecent(rec);
      recordUse(id, steamId, name, pack.group);
      // The same moment and the same condition as the cooldown, for the same reason — see the note
      // where the variant was chosen. Everything above this line can still refuse; nothing below it
      // can.
      advanceVariant(pack, id, steamId);
      if (pack.message) {
        const ch = replyChannelFor(pack);
        // ── THE PLAYER LEARNS THE PRICE, AND IT USED TO BE UNSAYABLE ───────────────────────────
        //
        // A paid kit took the money and said "Enjoy your starter pack": the only line that ever
        // named a price was the refusal for somebody who could not afford it, so the player who
        // COULD had no way to find out what they had just spent — and an owner could not tell them
        // either, because `{cost}` and `{currency}` were filled for the refusals and for nothing
        // else. `fill` first with the pack's own facts, `subst` after for everything else: `fill`
        // leaves a token it does not know exactly as it found it, which is what lets the two run in
        // series over one template.
        const paidVars = { pack: pack.name || id, cost: cost.amount, currency: curWord(cost.currency) };
        for (const line of (await substLive(fill(pack.message, paidVars), name, steamId, null)).split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean)) host.chat.dm(steamId, line, { channel: ch }).catch(() => {});
      }
      host.logger.info(`delivered "${pack.name || id}" to ${name} (${spawned}/${total} spawned${failed ? `, ${failed} failed` : ''})${paid ? `, ${took.ok ? 'charged' : 'NOT charged'} ${Math.abs(Number(cost.amount) || 0)} ${cost.currency} from their ${poolEn(cost.currency)}` : ''}`);
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
      if (inFlight.has(lockKey)) return { ok: false, reason: 'inflight', message: msgText('inflight') };
      inFlight.add(lockKey);
      try {
        // A FRESH reading of the game's clock, awaited, because this one decides a delivery. The
        // `/help` path deliberately uses the cached one instead — it draws a status line and must
        // not reach the bridge at all. Asked only when this entry has a game window, so a kit
        // without one costs nothing and works with no bridge whatsoever.
        const clock = gameWindowOf(pack).on ? await gameClock() : null;
        const vars = {
          pack: pack.name || cmdName || id, cmd: cmdName || '',
          h: cooldownLeftH(id, pack.cooldownHours, steamId),
          left: fmtLeft(cooldownLeftMs(id, pack.cooldownHours, steamId)),
          cost: pack.cost && pack.cost.amount, currency: curWord(pack.cost && pack.cost.currency),
          window: anyWindowWhy(pack, clock),
        };
        const block = blockReason(pack, id, steamId, false, clock);
        if (block) return { ok: false, reason: block, message: await substLive(fill(msgText(block), vars), playerName, steamId, ctx || null) };
        const res = await deliver(steamId, playerName, pack, i);
        if (!res.ok) {
          // Fill {have}/{pool} from the figure the refusal was ACTUALLY decided on, rather than
          // letting `subst` read the database again — a second read can disagree with the first,
          // and a player told "you have 900" after being refused at 900 has been lied to once.
          if (res.have != null) Object.assign(vars, shortVars({ have: res.have, source: res.balanceSource }, pack.cost && pack.cost.currency));
          return { ok: false, reason: res.reason, message: await substLive(fill(msgText(res.reason), vars), playerName, steamId, ctx || null) };
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
        // A claim of this command/group is already processing for this player — and it says so,
        // because a lock that answers nothing is indistinguishable from a plugin that is broken.
        if (inFlight.has(lockKey)) return ctx.reply(msgText('inflight'), { channel: ch }).catch(() => {});
        inFlight.add(lockKey);
        try {
          // As in `claimPack`: fresh and awaited, and only when this command really has a game
          // window on it. A command without one never touches the bridge for this.
          const clock = gameWindowOf(cmd).on ? await gameClock() : null;
          const vars = { pack: cmd.name || name, cmd: name, h: cooldownLeftH(cdKey, cmd.cooldownHours, ctx.steamId), left: fmtLeft(cooldownLeftMs(cdKey, cmd.cooldownHours, ctx.steamId)), cost: cmd.cost && cmd.cost.amount, currency: curWord(cmd.cost && cmd.cost.currency), window: anyWindowWhy(cmd, clock) };
          // gate: allow/deny + cooldown (shared per group when set, else per command name)
          const block = blockReason(cmd, cdKey, ctx.steamId, true, clock);
          if (block) return ctx.reply(await substLive(fill(msgText(block), vars), ctx.name, ctx.steamId, ctx), { channel: ch }).catch(() => {});
          // Check the cost up front so we can refuse cleanly, but only DEBIT after the effect (below).
          // Same gate as a pack claim: the running game first, the save only when it cannot answer.
          if (isPaid(cmd.cost)) {
            const short = await affordGate(ctx.steamId, cmd.cost);
            if (short) {
              if (short.cut) host.logger.warn(`"${cmd.name || cdKey}" was refused for ${ctx.name || ctx.steamId}: their balance could not be checked live.`);
              Object.assign(vars, shortVars(short, cmd.cost.currency));
              return ctx.reply(await substLive(fill(msgText(short.cut ? 'listCut' : 'insufficient'), vars), ctx.name, ctx.steamId, ctx), { channel: ch }).catch(() => {});
            }
          }
          // freeze position now so a teleport action can send the player back to it. From the running
          // game where it can answer, the last save where it cannot, and null when neither has one.
          const frozen = await playerLocNow(ctx.steamId);
          // Optionally REMEMBER this spot for later — a separate /back command can teleport here on demand
          // via {saved_x} {saved_y} {saved_z} (so the player isn't stuck waiting for the timed return).
          // Only a real position is remembered: an unknown one must not overwrite the last good spot.
          if (cmd.savePosition && frozen) ledger.set({ ['pos:' + ctx.steamId]: frozen });
          const ran = await runActions(cmd.actions, ctx.name, ctx.steamId, ctx, frozen, cmd.notify);
          const hadActions = (Array.isArray(cmd.actions) ? cmd.actions : []).some((a) => String((a && (a.cmd || a.command)) || (typeof a === 'string' ? a : '')).trim());
          // `vars` carries this command's own price and name — see the same change in `deliver()`.
          // A command that charges can now say what it charged, which it could not before.
          //
          // ⚠ …and it is only sent once the effect is KNOWN to have happened. It used to go out
          // before the fuse below was read, so a `/home` whose teleport the bridge refused still
          // answered "Teleporting you to spawn!" — the player watched themselves not move while the
          // server told them it had worked. `spawnFailed` is the owner's own sentence for exactly
          // this and it already says the true half: nothing was taken.
          const worked = !hadActions || ran > 0;
          if (!worked) {
            sendReply(ctx, await substLive(fill(msgText('spawnFailed'), vars), ctx.name, ctx.steamId, ctx), ch, false);
          } else if (cmd.response) {
            sendReply(ctx, await substLive(fill(cmd.response, vars), ctx.name, ctx.steamId, ctx, { loc: frozen }), cmd.broadcast ? (cmd.channel || 'global') : ch, cmd.broadcast);
          }
          // Fuse: charge AFTER the effect — if the command had actions and none of them ran, take nothing.
          // And say so when the charge itself does not land: the effect has already happened, so the
          // player got it for nothing, which is invisible unless somebody writes it down.
          if (isPaid(cmd.cost) && (!hadActions || ran > 0)) {
            const took = await charge(ctx.steamId, cmd.cost);
            if (!took.ok) reportUnpaid(ctx.steamId, ctx.name, cmd.cost, cmd.name || cdKey, took.why);
          }
          // ⚠ **A COOLDOWN SPENT ON SOMETHING THAT DID NOT HAPPEN.** The money fuse above is right and
          // has been for a long time; `recordUse` had no fuse at all, so a `/home` with a six-hour
          // cooldown run during a bridge blip refused every action, charged nothing — and took the
          // six hours anyway. The player is out an evening for a command that teleported nobody, and
          // nothing anywhere says so. The pack path already refuses BEFORE `recordUse` for exactly
          // this case (`deliver()`'s actions fuse); this is the sibling that was never brought into
          // line. Same condition as the charge, because they are the same question.
          if (!worked) {
            host.logger.warn(`"${cmd.name || cdKey}": the bridge refused every action. ${ctx.name || ctx.steamId} was not charged; no cooldown started.`);
          } else if (Math.max(0, Number(cmd.cooldownHours) || 0) > 0 || isPaid(cmd.cost)) {
            recordUse(cdKey, ctx.steamId, ctx.name, null);
          }
        } finally { inFlight.delete(lockKey); }
      };
    }
    /**
     * Where ONE player stands with one pack or command, for the built-in `/help`.
     *
     * The Discord menu has shown this for a long time — each kit's row reads "on cooldown, 3h left"
     * before anybody picks anything — and in the game the only way to find out was to type the
     * command and be refused. On a one-a-day kit the attempt IS the thing being rationed, so the
     * answer cost the player the thing they were asking about.
     *
     * It reuses `blockReason` rather than restating any of it: a second reading of "may this player
     * have this" is a second set of rules to drift, and the whole design of `claimPack` is that
     * there is one. Everything it touches is memory (the ledger) or arithmetic — no game DB, no
     * bridge — because one `/help` runs every provider on the server.
     *
     * A refusal we cannot put into words is left UNANSWERED (`why: ''` is not a shape the dispatcher
     * accepts), which reads as "could not be checked" rather than as "go ahead".
     */
    function statusFor(entry, id, isCommand) {
      return ({ steamId }) => {
        const sid = String(steamId || '');
        // ⚠ **THE CACHED CLOCK, NEVER A FRESH ONE.** This function is synchronous by contract and
        // one `/help` runs every provider on the server, so reaching the bridge from here would put
        // a round trip per plugin behind a line somebody typed in chat. At twenty seconds the
        // reading is 0.04 of a game hour out at the default day speed, against a window written in
        // whole hours — and the claim itself re-reads, so nothing is ever decided on this figure.
        //
        // A clock that has never been read answers `null`, which means a game window is NOT APPLIED
        // rather than closed. That is the honest answer and not a hedge: the claim would go through.
        // What must not happen is the opposite — promising a player a window that is not in force —
        // and that is what the panel's own "not being applied" note is for.
        const clock = gameClockCached();
        const block = blockReason(entry, id, sid, isCommand, clock);
        if (!block) return { ready: true };
        const leftMs = cooldownLeftMs(id, entry.cooldownHours, sid);
        if (block === 'cooldown' && leftMs > 0) return { ready: false, until: Date.now() + leftMs };
        const vars = {
          pack: entry.name || id, cmd: entry.command || entry.name || id,
          h: cooldownLeftH(id, entry.cooldownHours, sid), left: fmtLeft(leftMs),
          cost: entry.cost && entry.cost.amount, currency: curWord(entry.cost && entry.cost.currency),
          window: anyWindowWhy(entry, clock),
        };
        // The owner's own sentence for this refusal, so it is in their language like every other
        // line this plugin says. `subst` is deliberately NOT called: it reads the database for the
        // rich tokens, and none of these six messages carries one.
        return { ready: false, why: fill(msgText(block), vars) };
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
        // A command's cooldown key is its GROUP when it has one, exactly as the handler computes it.
        const cdKey = (cmd.group && String(cmd.group).trim()) ? ('grp:' + String(cmd.group).trim()) : name;
        seen[name] = true;
        offs.push(host.chat.onCommand(name, makeCmdHandler(cmd), { status: statusFor(cmd, cdKey, true) }));
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
        }, { status: statusFor(pack, id, false) }));
      });
      // ── KEEPING THE GAME CLOCK WARM, AND ONLY WHEN SOMEBODY IS USING IT ───────────────────────
      //
      // `/help` reads the cached reading and cannot ask for one, so without this a game window would
      // read as NOT APPLIED for ever on a server where nobody has claimed anything yet — the status
      // line would be right about the outcome and silent about the window. One read a minute keeps
      // it answerable.
      //
      // ⚠ **AND IT IS ARMED ONLY IF A GAME WINDOW IS REALLY SET.** Every bridge call costs an owner
      // something, and the overwhelming majority of configurations have no game window at all: a
      // timer that polls regardless would put a request a minute on every server for ever to keep a
      // value nothing reads. `reload()` runs on every config change, so switching one on arms it and
      // clearing the last one disarms it, with no separate bookkeeping.
      const wantsGameClock = [].concat(Array.isArray(c.commands) ? c.commands : [], Array.isArray(c.packs) ? c.packs : [])
        .some((e) => e && e.enabled !== false && gameWindowOf(e).on);
      if (wantsGameClock) {
        gameClock().catch(() => {});
        offs.push(host.schedule.every(60000, () => { gameClock().catch(() => {}); }));
      }
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
      const lastW = Number(ledger.get('wmsg:' + steamId, 0)) || 0;
      if (w.enabled && w.message && (Date.now() - lastW) >= WELCOME_MIN_GAP_MS) {
        ledger.set({ ['wmsg:' + steamId]: Date.now() }, { lazy: true });
        host.schedule.after(delayMs, () => {
          const ch = safeChannel(w.channel || c.replyChannel || DEFAULT_CHANNEL);
          // The live tokens ({ping}, {sector} …) are read now, when the line is sent, not at join.
          substLive(w.message, name, steamId, { channel: w.channel }).then((text) => {
            for (const line of text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean)) host.chat.dm(steamId, line, { channel: ch }).catch(() => {});
          }).catch(() => {});
        });
      }
      (Array.isArray(c.packs) ? c.packs : []).forEach((pack, i) => {
        if (pack.enabled === false || pack.trigger !== 'welcome') return;
        const id = packId(pack, i);
        // Same in-flight guard as the command path: a fast reconnect / respawn re-fires join, and without
        // this a welcome pack could be delivered twice before the first claim is recorded.
        //
        // ⚠ **THE LOCK IS TAKEN BEFORE THE FIRST `await`, NOT AFTER IT.** A game window makes this
        // path asynchronous, and a guard that reads a set on one side of a yield and writes it on
        // the other is not a guard at all — it is the read-modify-write across a yield that let a
        // login lockout compare a hundred passwords in one burst. Taking it first and releasing it
        // on every exit keeps the promise the synchronous version made.
        const lockKey = 'p:' + ((pack.group && String(pack.group).trim()) ? 'grp:' + String(pack.group).trim() : id) + ':' + steamId;
        if (inFlight.has(lockKey)) return;
        inFlight.add(lockKey);
        (async () => {
          const clock = gameWindowOf(pack).on ? await gameClock() : null;
          if (blockReason(pack, id, steamId, false, clock)) { inFlight.delete(lockKey); return; }
          host.schedule.after(delayMs, () => { deliver(steamId, name, pack, i).catch(() => {}).then(() => inFlight.delete(lockKey)); });
        })().catch(() => { inFlight.delete(lockKey); });
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
    // The owner's sentence (Messages → Discord claim panel), read when it is sent.
    const D_STALE = () => msgText('discordStale');

    /** Packs an owner has made claimable from Discord, with their real list positions kept. */
    function discordPacks(c) {
      return (Array.isArray(c.packs) ? c.packs : [])
        .map((pack, i) => ({ pack, i }))
        .filter(({ pack }) => pack && pack.enabled !== false && pack.discord === true);
    }
    const priceText = (pack) => (isPaid(pack.cost)
      ? `${Math.abs(Number(pack.cost.amount) || 0)} ${curWord(pack.cost.currency)}`
      : msgText('discordFree'));

    async function postPanel(channelId) {
      const c = cfg();
      const d = c.discord || {};
      const chId = String(channelId || d.channelId || '');
      if (!chId) return { ok: false, code: 'noChannel', error: 'no channel is set for the Discord panel' };
      if (!discordPacks(c).length) return { ok: false, code: 'noKits', error: 'no kit is marked "claimable from Discord" yet' };
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
      if (!msg) return { ok: false, code: 'postFailed', error: 'the bot could not post there (missing channel or permission)' };
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
          return await i.reply({ content: msgText('discordLink'), ...EPHEMERAL });
        }
        const steamId = String(prof.steamId);
        const playerName = prof.name || prof.playerName || prof.discordUsername || '';

        if (isBtn) {
          const list = discordPacks(c);
          if (!list.length) return await i.reply({ content: msgText('discordNone'), ...EPHEMERAL });
          const B = host.discord.js;
          // Show WHY a kit cannot be taken rather than hiding it: "the button does nothing" is the
          // complaint an owner gets, and a greyed-out reason answers it before they ask.
          // One reading for the whole menu, and only if a kit on it really has a game window: the
          // menu is drawn in one go, so twenty-five kits must not be twenty-five bridge calls.
          const clock = list.some(({ pack }) => gameWindowOf(pack).on) ? await gameClock() : null;
          const opts = list.slice(0, 25).map(({ pack, i: idx }) => {
            const id = packId(pack, idx);
            const block = blockReason(pack, id, steamId, false, clock);
            // ⚠ **THE FALLBACK USED TO BE THE KEY ITSELF.** `closed`, `notLinked` and `inflight` were
            // never in this table, so a kit out of hours described itself to a player in a Discord
            // menu as the word "closed" — a raw internal name on a screen, which is the same defect
            // this project has one resolver to stop everywhere else. Every reason `blockReason` can
            // return is named here now, and the fallback is a sentence rather than a token.
            const why = block ? fill(msgText({
              notAllowed: 'discordNotAllowed', groupLocked: 'discordGroupLocked', maxClaims: 'discordMaxClaims',
              cooldown: 'discordCooldown', alreadyClaimed: 'discordAlreadyClaimed', notLinked: 'discordNotLinked',
              inflight: 'discordInflight',
              // Both windows get the short form here — a dropdown row is a hundred characters and
              // the full sentence does not fit — but they are still two different reasons, and the
              // one that says "in game" is the one a player must not read as their own evening.
              closed: 'discordClosed', closedGame: 'discordClosedGame',
            }[block] || 'discordUnavailable'), {
              left: fmtLeft(cooldownLeftMs(id, pack.cooldownHours, steamId)),
              h: cooldownLeftH(id, pack.cooldownHours, steamId),
              window: block === 'closedGame' ? gameWindowWhy(pack, clock) : windowWhy(pack),
              pack: pack.name || id,
            }) : priceText(pack);
            return {
              label: String(pack.name || id).slice(0, 100),
              description: String(why).slice(0, 100),
              value: (idx + '.' + packSig(pack, id)).slice(0, 100),
            };
          });
          const menu = new B.StringSelectMenuBuilder().setCustomId(D_PICK).setPlaceholder(String(msgText('discordChoose')).slice(0, 150)).addOptions(opts);
          return await i.reply({ content: msgText('discordPick'), components: [host.discord.row(menu)], ...EPHEMERAL });
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
          return await i.update({ content: D_STALE(), components: [] });
        }
        // Items are spawned onto the player, so they have to BE there. Saying so beats a kit that
        // silently lands nowhere.
        const online = (() => { try { return (host.players.online() || []).some((p) => String(sidOf(p)) === steamId); } catch { return null; } })();
        if (online === false) return await i.update({ content: msgText('discordOffline'), components: [] });

        await i.update({ content: msgText('discordDelivering'), components: [] });
        const out = await claimPack(steamId, playerName, pack, idx, pack.command || '', null);
        const said = out.ok
          ? fill(msgText('discordDone'), { pack: pack.name || id })
          : (out.message || msgText('discordFailed'));
        // Discord's edit window is FIFTEEN MINUTES, and delivery can outlast it: every item goes
        // through one global, throttled, retried spawn queue, and under a bridge outage on a busy
        // server the queue alone takes longer than that. When the edit is refused the player's
        // private message reads "⏳ Delivering…" for ever — they cannot tell whether they got the
        // kit, and the claim HAS been recorded, so retrying is refused too.
        //
        // They are in game, which is where the kit landed. Say it there instead of swallowing it.
        try { await i.editReply({ content: said }); }
        catch (e) {
          host.logger.warn(`Discord reply to ${playerName || steamId} expired; telling them in game instead`);
          try { await host.chat.dm(steamId, said, { channel: replyChannelFor(pack) }); } catch (x) { /* nothing left to try */ }
        }
      } catch (e) {
        host.logger.error('discord interaction: ' + e.message);
        try { if (i && !i.replied && i.reply) await i.reply({ content: msgText('discordError'), ...EPHEMERAL }); } catch (x) { /* nothing left to say */ }
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
        // A CODE, which the panel words in the reader's language; `why` stays for anything older.
        return res.json({ supported: false, code: 'managerTooOld', why: 'This manager is too old for time windows. Entries with one stay closed until you update.' });
      }
      res.json({ supported: true, now: t.now(), zone: t.zone() });
    });
    /**
     * …and the OTHER clock, for the editor beside it.
     *
     * It answers with a bridge that is not there, which is the whole point: the ordinary state of a
     * server that has not switched the live module's time group on is exactly the state an owner has
     * to be able to see and act on, and a route that 500s or hangs there teaches them nothing.
     *
     * `applied` is the field the screen turns into a sentence, and it is NOT `open`. A game window
     * that cannot be evaluated is not closed — it is not in force, and the kit is being handed out
     * exactly as it was before the window was set. Those two must never render as the same line.
     */
    host.routes.get('/game-clock', async (req, res) => {
      const clock = await gameClock().catch(() => null);
      if (!clock || clock.unknown) {
        // `code` is what the panel turns into a sentence, with the route to the switches built out of
        // the panel's own words. `why` is the English kept for anything that reads it.
        return res.json({ supported: true, known: false, code: 'noGameClock', why: (clock && clock.why) || NO_GAME_CLOCK });
      }
      res.json({
        supported: true, known: true, hour: clock.hour, unit: 'game-hours',
        hhmm: gameHHMM(clock.hour), speed: clock.speed, speedUnit: 'game-hours-per-real-hour',
      });
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
    /**
     * A caller's body laid over what is already STORED, one level deep.
     *
     * ⚠ **A SECTION NOBODY SENT IS NOT A SECTION TO RESET.** Every key below is rebuilt from the
     * body — `commands: Array.isArray(b.commands) ? b.commands : []` and its eleven siblings — so a
     * body naming ONE key replaces all the others. A `{"commandPrefix":"!"}` PATCH deletes every
     * command, every kit, the welcome message and every translated line, and answers `ok: true`.
     * The panel POSTs the whole object so nothing has done it yet; a script or a future partial save
     * would, and the loss has no symptom until somebody reopens the tab.
     *
     * By KEY PRESENCE, never truthiness — `"commands": []` is an owner who deleted every command and
     * must stay empty, which is the same rule `withDefaults` already follows one layer up. An ARRAY
     * replaces rather than merging: merging two command lists by index is never what was meant.
     */
    function overlay(stored, body) {
      const out = Object.assign({}, (stored && typeof stored === 'object') ? stored : {});
      if (!body || typeof body !== 'object') return out;
      for (const k of Object.keys(body)) {
        const v = body[k]; const cur = out[k];
        if (v && typeof v === 'object' && !Array.isArray(v)
            && cur && typeof cur === 'object' && !Array.isArray(cur)) out[k] = Object.assign({}, cur, v);
        else out[k] = v;
      }
      return out;
    }

    host.routes.post('/config', (req, res) => {
      const b = overlay(host.config.get() || {}, req.body || {});
      // Refuse a window nobody can read BEFORE it is saved. `validate()` is the same rule `isOpen()`
      // applies at claim time, so the panel can name the problem instead of the owner discovering it
      // as a kit that silently stopped existing. An entry with no windows is never inspected, which
      // is why every config that predates this feature saves exactly as it did.
      // Tidy the two additive keys on the way in, always — they are not `host.time`'s business and
      // must be normalised even on a manager too old to evaluate a wall-clock window.
      //
      // ⚠ **NOTHING HERE REFUSES A SAVE.** A kit whose variants all have a chance of 0 is a kit
      // mid-edit as often as it is a mistake, and refusing the save would strand an owner halfway
      // through building one with no way to put the work down. It is a warning on the row, a warning
      // in the log when it is claimed, and a fall back to the kit's own contents — three places that
      // say so, none of which loses anybody's work.
      [].concat(Array.isArray(b.commands) ? b.commands : [], Array.isArray(b.packs) ? b.packs : [])
        .forEach((e) => {
          if (!e || typeof e !== 'object') return;
          if (e.gameTime) e.gameTime = normalizeGameTime(e.gameTime);
          if (Array.isArray(e.variants)) e.variants = normalizeVariants(e.variants);
          if (e.variantMode != null) e.variantMode = variantMode(e);
        });
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
    host.routes.post('/reset-stats', (req, res) => { stats = { deliveries: 0, ok: 0, failed: 0 }; persistStats(true); res.json({ ok: true }); });
    host.routes.get('/meta', (req, res) => res.json({
      channels: ['local', 'global', 'squad', 'admin', 'server'],
      currencies: ['free', 'money', 'gold', 'fame'],
      triggers: ['welcome', 'command'],
      // Data rather than a second list in the browser: the panel draws whatever is here, so a mode
      // added later reaches the dropdown without anybody remembering to edit two files.
      variantModes: VARIANT_MODES,
      messageKeys: Object.keys(DEFAULT_MSG),
      defaultMessages: DEFAULT_MSG,
      // Which section of the Messages screen each key is drawn in. The token list that used to be
      // here was read by nothing and had drifted from what `subst` fills; the panel's palette is the
      // one list, with a sentence beside every token.
      messageGroups: MSG_GROUPS,
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
    /**
     * What a claim key is FOR, for a screen. The ledger keys a claim by the kit's id (`pack3`, `daily`),
     * by a command's own word, or by `grp:<name>` for commands sharing one cooldown — all internal.
     * Kits are looked up first, because a kit's id and a command's word can be the same string and the
     * kit is the one with a claim limit. `kind: null` is an entry that no longer exists in the config.
     */
    function claimSubject(pid) {
      const c = cfg();
      const p = String(pid || '');
      if (p.startsWith('grp:')) return { kind: 'group', name: p.slice(4) };
      const packs = Array.isArray(c.packs) ? c.packs : [];
      for (let i = 0; i < packs.length; i++) {
        if (packs[i] && packId(packs[i], i) === p) return { kind: 'kit', name: String(packs[i].name || packs[i].command || p) };
      }
      for (const cmd of (Array.isArray(c.commands) ? c.commands : [])) {
        const n = String((cmd && cmd.name) || '').toLowerCase().replace(/^\/+/, '').trim();
        if (n && n === p) return { kind: 'command', name: chatPrefix() + n };
      }
      return { kind: null, name: p };
    }
    host.routes.get('/claims', (req, res) => {
      const all = ledger.entries();
      const rows = [];
      for (const [k, v] of Object.entries(all)) {
        if (!k.startsWith('claim:')) continue;
        const rest = k.slice(6); const cut = rest.lastIndexOf(':'); if (cut < 0) continue;
        const pid = rest.slice(0, cut), sid = rest.slice(cut + 1);
        const what = claimSubject(pid);
        rows.push({ key: k, packId: pid, steamId: sid, name: nameOf(v) || playerName(sid, ''), at: atOf(v), count: Number(all[`count:${pid}:${sid}`] || 0) || 0,
          reward: what.name, rewardKind: what.kind });
      }
      rows.sort((a, b) => b.at - a.at);
      res.json({ claims: rows });
    });
    function resetOne(pid, sid) {
      const ck = K.claim(pid, sid), nk = K.count(pid, sid);
      // The place in the variant rotation goes with the claim. An owner resetting somebody so they
      // can have a kit again means "as if they had never had it" — leaving the cursor where it is
      // would hand them the SECOND variant on their fresh first claim, which is the kind of thing
      // nobody reports because nobody can see it.
      const vk = VAR_CURSOR(pid, sid);
      ledger.drop((k, v) => k === ck || k === nk || k === vk || (k.startsWith('group:') && k.endsWith(':' + sid) && v === pid));
    }
    host.routes.post('/claims/reset', (req, res) => {
      const b = req.body || {};
      let pid = b.packId, sid = b.steamId;
      if (b.key && (!pid || !sid)) { const rest = String(b.key).replace(/^claim:/, ''); const cut = rest.lastIndexOf(':'); if (cut >= 0) { pid = rest.slice(0, cut); sid = rest.slice(cut + 1); } }
      if (!pid || !sid) return res.json({ ok: false, error: 'need key or packId+steamId' });
      resetOne(pid, sid); res.json({ ok: true });
    });
    host.routes.post('/claims/clear', (req, res) => {
      const b = req.body || {};
      // One save for the whole list; this used to rewrite the store once per key it removed.
      // `var:` goes with them, for the reason `resetOne` gives: a reset means "as if they had never
      // had it", and a rotation cursor left behind is the one part of "had it" that would survive.
      ledger.drop((k, v) => (b.packId
        ? (k.startsWith(`claim:${b.packId}:`) || k.startsWith(`count:${b.packId}:`) || k.startsWith(`var:${b.packId}:`) || (k.startsWith('group:') && v === b.packId))
        : (k.startsWith('claim:') || k.startsWith('count:') || k.startsWith('var:') || k.startsWith('group:'))));
      res.json({ ok: true });
    });
  },

  async unregister() { /* auto-cleaned via host unload tracking */ },
};
