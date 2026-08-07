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
const DEFAULT_MSG = {
  cooldown:      'You already used {pack}. Try again in ~{h}h.',
  alreadyClaimed:'You already claimed {pack}.',
  groupLocked:   'You already picked from this set — {pack} is locked.',
  maxClaims:     'You have reached the limit for {pack}.',
  notAllowed:    "You can't use {pack}.",
  insufficient:  "You can't afford {pack} ({cost} {currency}).",
  notInGame:     'Get fully spawned in first, then try again.',
  spawnFailed:   "Couldn't deliver {pack} right now — nothing was taken. Try again.",
};

module.exports = {
  async register(host) {
    const offs = [];
    const clear = () => { while (offs.length) { try { offs.pop()(); } catch { /* ignore */ } } };
    // SECURITY: one claim of a given resource (command / group / pack) per player may be in flight at a
    // time. A kit takes seconds to drain the throttled+retried spawn queue — WITHOUT this lock a player
    // could fire the command again mid-delivery (past the 1.5 s chat dedup) and double-claim a one-time
    // reward or bypass cooldown / exclusive groups, because `recordUse` only lands after delivery.
    const inFlight = new Set();
    const cfg = () => host.config.get() || {};
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
    function balanceOf(steamId, currency) {
      if (currency === 'gold') return (host.players.finances(steamId) || {}).gold || 0;
      if (currency === 'money') return (host.players.finances(steamId) || {}).bank || 0;
      if (currency === 'fame') return (host.players.stats(steamId) || {}).FamePoints || 0;
      return Infinity;
    }
    async function charge(steamId, cost) {
      const amt = Math.abs(Number(cost.amount) || 0); if (amt <= 0) return;
      if (cost.currency === 'gold') await host.server.command(`#ChangeCurrencyBalance Gold -${amt} ${steamId}`);
      else if (cost.currency === 'fame') await host.server.command(`#ChangeFamePoints -${amt} ${steamId}`);
      else if (cost.currency === 'money') await host.server.command(`#ChangeCurrencyBalance Normal -${amt} ${steamId}`);
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
    // Why a pack/command can't be used right now — or null if it can. `cmd` treats cooldown only.
    function blockReason(entry, id, sid, isCommand) {
      if (!allowed(entry, sid)) return 'notAllowed';
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
            try { const r = await host.server.command(job.cmd, job.opts || undefined); ok = !!(r && r.ok !== false); }
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
        if (delay > 0) host.schedule.after(delay, () => { host.server.command(cmd, opts).catch((e) => host.logger.debug(`action failed: ${e.message}`)); });
        else { try { await host.server.command(cmd, opts); ran++; } catch (e) { host.logger.debug(`action failed: ${e.message}`); } }
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
      if (paid && balanceOf(steamId, cost.currency) < Number(cost.amount)) return { ok: false, reason: 'insufficient' };
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
      // Record the delivery in the activity log + counters (drives the panel's log + status badges).
      const rec = { at: Date.now(), player: name || null, steamId: steamId, reward: pack.name || id, kind: 'kit', spawned: spawned, total: total, failed: failed, failedItems: failedItems };
      stats.deliveries++; stats.ok += spawned; stats.failed += failed; persistStats();
      pushRecent(rec);
      if (total > 0 && spawned === 0) return { ok: false, reason: 'spawnFailed' };
      // run any extra actions the pack defines (e.g. a buff, a teleport)
      await runActions(pack.actions, name, steamId, null, loc, pack.notify);
      if (paid) await charge(steamId, cost);
      recordUse(id, steamId, name, pack.group);
      if (pack.message) {
        const ch = replyChannelFor(pack);
        for (const line of subst(pack.message, name, steamId, null).split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean)) host.chat.dm(steamId, line, { channel: ch }).catch(() => {});
      }
      host.logger.info(`delivered "${pack.name || id}" to ${name} (${spawned}/${total} spawned${failed ? `, ${failed} failed` : ''})`);
      return { ok: true, spawned, total, failed };
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
          const vars = { pack: cmd.name || name, cmd: name, h: cooldownLeftH(cdKey, cmd.cooldownHours, ctx.steamId), cost: cmd.cost && cmd.cost.amount, currency: cmd.cost && cmd.cost.currency };
          // gate: allow/deny + cooldown (shared per group when set, else per command name)
          const block = blockReason(cmd, cdKey, ctx.steamId, true);
          if (block) return ctx.reply(subst(fill(msgText(block), vars), ctx.name, ctx.steamId, ctx), { channel: ch }).catch(() => {});
          // Check the cost up front so we can refuse cleanly, but only DEBIT after the effect (below).
          if (isPaid(cmd.cost) && balanceOf(ctx.steamId, cmd.cost.currency) < Number(cmd.cost.amount)) return ctx.reply(subst(fill(msgText('insufficient'), vars), ctx.name, ctx.steamId, ctx), { channel: ch }).catch(() => {});
          // freeze position now so a teleport action can send the player back to it
          const frozen = playerLoc(ctx.steamId) || { x: 0, y: 0, z: 0 };
          // Optionally REMEMBER this spot for later — a separate /back command can teleport here on demand
          // via {saved_x} {saved_y} {saved_z} (so the player isn't stuck waiting for the timed return).
          if (cmd.savePosition) host.store.set('pos:' + ctx.steamId, frozen);
          const ran = await runActions(cmd.actions, ctx.name, ctx.steamId, ctx, frozen, cmd.notify);
          const hadActions = (Array.isArray(cmd.actions) ? cmd.actions : []).some((a) => String((a && (a.cmd || a.command)) || (typeof a === 'string' ? a : '')).trim());
          if (cmd.response) sendReply(ctx, subst(cmd.response, ctx.name, ctx.steamId, ctx, { loc: frozen }), cmd.broadcast ? (cmd.channel || 'global') : ch, cmd.broadcast);
          // Fuse: charge AFTER the effect — if the command had actions and none of them ran, take nothing.
          if (isPaid(cmd.cost) && (!hadActions || ran > 0)) await charge(ctx.steamId, cmd.cost);
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
          const lockKey = 'p:' + ((pack.group && String(pack.group).trim()) ? 'grp:' + String(pack.group).trim() : id) + ':' + ctx.steamId;
          if (inFlight.has(lockKey)) return;   // this pack/group is already being delivered to this player
          inFlight.add(lockKey);
          try {
            const ch = replyChannelFor(pack);
            const vars = { pack: pack.name || name, cmd: name, h: cooldownLeftH(id, pack.cooldownHours, ctx.steamId), cost: pack.cost && pack.cost.amount, currency: pack.cost && pack.cost.currency };
            const block = blockReason(pack, id, ctx.steamId, false);
            if (block) return ctx.reply(subst(fill(msgText(block), vars), ctx.name, ctx.steamId, ctx), { channel: ch }).catch(() => {});
            const res = await deliver(ctx.steamId, ctx.name, pack, i);
            if (!res.ok) return ctx.reply(subst(fill(msgText(res.reason), vars), ctx.name, ctx.steamId, ctx), { channel: ch }).catch(() => {});
          } finally { inFlight.delete(lockKey); }
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

    // ── admin API ─────────────────────────────────────────────────────────────────
    host.routes.get('/config', (req, res) => res.json(cfg()));
    host.routes.post('/config', (req, res) => {
      const b = req.body || {};
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

    // online players — for the allow/deny picker and to resolve names in the claims view
    host.routes.get('/players', (req, res) => {
      let list = []; try { list = host.players.online() || []; } catch { /* offline */ }
      res.json({ players: (Array.isArray(list) ? list : []).map((p) => ({ steamId: sidOf(p), name: nmOf(p) })).filter((p) => p.steamId) });
    });
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
