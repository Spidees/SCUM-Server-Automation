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

    // Rich token substitution — heavy lookups only run if the template actually uses them. `extra`
    // lets a caller freeze values (e.g. the player's position at command time, for teleport-and-back).
    function subst(tpl, name, steamId, ctx, extra) {
      tpl = String(tpl || '');
      const now = new Date();
      const map = {
        player: name || 'player', name: name || 'player', steamid: steamId || '',
        channel: (ctx && ctx.channel) || '', args: (ctx && ctx.argString) || '',
        server: serverName(), date: now.toLocaleDateString(), time: now.toLocaleTimeString(),
      };
      if (/\{(online|maxplayers)\}/i.test(tpl)) { refreshMax(); const on = onlineCount(); map.online = on != null ? on : '?'; map.maxplayers = _maxPlayers != null ? _maxPlayers : '?'; }
      if (/\{(money|bank|cash|gold)\}/i.test(tpl)) { const f = host.players.finances(steamId) || {}; map.money = f.bank || 0; map.bank = f.bank || 0; map.cash = f.cash || 0; map.gold = f.gold || 0; }
      if (/\{(fame|kills|deaths|headshots|playtime)\}/i.test(tpl)) { const s = host.players.stats(steamId) || {}; map.fame = s.FamePoints || 0; map.kills = s.Kills || 0; map.deaths = s.Deaths || 0; map.headshots = s.Headshots || 0; map.playtime = s.PlayTime || 0; }
      if (/\{(squad|squadsize)\}/i.test(tpl)) { const q = host.players.squad(steamId) || {}; map.squad = q.Name || q.SquadName || ''; map.squadsize = q.MemberCount || q.memberCount || ''; }
      if (/\{(x|y|z|location)\}/i.test(tpl)) { const l = (extra && extra.loc) || playerLoc(steamId) || {}; map.x = Math.round(l.x || 0); map.y = Math.round(l.y || 0); map.z = Math.round(l.z || 0); map.location = l.x != null ? `${map.x}, ${map.y}` : ''; }
      if (/\{saved_[xyz]\}/i.test(tpl)) { const sp = host.store.get('pos:' + steamId, null) || {}; map.saved_x = Math.round(sp.x || 0); map.saved_y = Math.round(sp.y || 0); map.saved_z = Math.round(sp.z || 0); }
      if (extra) for (const k of Object.keys(extra)) if (k !== 'loc' && extra[k] != null) map[k.toLowerCase()] = extra[k];
      let out = tpl.replace(/\{arg(\d+)\}/gi, (_, n) => ((ctx && ctx.args && ctx.args[Number(n) - 1]) || ''));
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

    // ── run a list of admin actions (teleport / give / spawn / …) ─────────────────
    // Each action: { cmd, delaySeconds }. Tokens (incl. the FROZEN {x}{y}{z} from invocation time so
    // "teleport there and back" can return the player to where they started) are substituted per action.
    async function runActions(actions, name, steamId, ctx, frozenLoc) {
      let ran = 0;
      for (const a of (Array.isArray(actions) ? actions : [])) {
        const raw = (a && (a.cmd || a.command)) ? String(a.cmd || a.command) : (typeof a === 'string' ? a : '');
        if (!raw.trim()) continue;
        const cmd = subst(raw, name, steamId, ctx, { loc: frozenLoc, x: frozenLoc && frozenLoc.x, y: frozenLoc && frozenLoc.y, z: frozenLoc && frozenLoc.z });
        const delay = Math.max(0, Number(a && a.delaySeconds) || 0) * 1000;
        if (delay > 0) host.schedule.after(delay, () => { host.server.command(cmd).catch((e) => host.logger.debug(`action failed: ${e.message}`)); });
        else { try { await host.server.command(cmd); ran++; } catch (e) { host.logger.debug(`action failed: ${e.message}`); } }
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
      if (paid && balanceOf(steamId, cost.currency) < Number(cost.amount)) return { ok: false, reason: 'insufficient' };
      const c = cfg();
      // Spawn FIRST. Fuse: if nothing lands, don't charge and don't spend the claim.
      let spawned = 0, total = 0, failed = 0;
      for (const it of (pack.items || [])) {
        if (!it.item) continue; total++;
        try { const r = await host.server.command(fill(c.itemSpawnCmd || DEFAULT_ITEM_CMD, { item: it.item, count: it.count || 1, x: loc.x, y: loc.y, z: loc.z, steamid: steamId })); (r && r.ok !== false) ? spawned++ : failed++; }
        catch { failed++; }
      }
      for (const v of (pack.vehicles || [])) {
        if (!v.code) continue; total++;
        try { const r = await host.server.command(fill(c.vehicleSpawnCmd || DEFAULT_VEH_CMD, { code: v.code, count: v.count || 1, x: loc.x, y: loc.y, z: loc.z, steamid: steamId })); (r && r.ok !== false) ? spawned++ : failed++; }
        catch { failed++; }
      }
      // filled containers (backpack/vest/crate full of an item) — #SpawnInventoryFullOf has no Location,
      // so it's run THROUGH the target player (executor) and appears on them.
      for (const inv of (pack.inventories || [])) {
        if (!inv.container || !inv.fill) continue; total++;
        try { const r = await host.server.command(fill(c.invSpawnCmd || DEFAULT_INV_CMD, { container: inv.container, sets: inv.sets || 1, fill: inv.fill, x: loc.x, y: loc.y, z: loc.z, steamid: steamId }), { executor: steamId }); (r && r.ok !== false) ? spawned++ : failed++; }
        catch { failed++; }
      }
      if (total > 0 && spawned === 0) return { ok: false, reason: 'spawnFailed' };
      // run any extra actions the pack defines (e.g. a buff, a teleport)
      await runActions(pack.actions, name, steamId, null, loc);
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
        const vars = { pack: cmd.name || name, cmd: name, h: cooldownLeftH(cdKey, cmd.cooldownHours, ctx.steamId), cost: cmd.cost && cmd.cost.amount, currency: cmd.cost && cmd.cost.currency };
        // gate: allow/deny + cooldown (shared per group when set, else per command name)
        const block = blockReason(cmd, cdKey, ctx.steamId, true);
        if (block) return ctx.reply(subst(fill(msgText(block), vars), ctx.name, ctx.steamId, ctx), { channel: ch }).catch(() => {});
        // optional cost to use the command
        if (isPaid(cmd.cost)) {
          if (balanceOf(ctx.steamId, cmd.cost.currency) < Number(cmd.cost.amount)) return ctx.reply(subst(fill(msgText('insufficient'), vars), ctx.name, ctx.steamId, ctx), { channel: ch }).catch(() => {});
          await charge(ctx.steamId, cmd.cost);
        }
        // freeze position now so a teleport action can send the player back to it
        const frozen = playerLoc(ctx.steamId) || { x: 0, y: 0, z: 0 };
        // Optionally REMEMBER this spot for later — a separate /back command can teleport here on demand
        // via {saved_x} {saved_y} {saved_z} (so the player isn't stuck waiting for the timed return).
        if (cmd.savePosition) host.store.set('pos:' + ctx.steamId, frozen);
        await runActions(cmd.actions, ctx.name, ctx.steamId, ctx, frozen);
        if (cmd.response) sendReply(ctx, subst(cmd.response, ctx.name, ctx.steamId, ctx, { loc: frozen }), cmd.broadcast ? (cmd.channel || 'global') : ch, cmd.broadcast);
        if (Math.max(0, Number(cmd.cooldownHours) || 0) > 0 || isPaid(cmd.cost)) recordUse(cdKey, ctx.steamId, ctx.name, null);
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
          const ch = replyChannelFor(pack);
          const vars = { pack: pack.name || name, cmd: name, h: cooldownLeftH(id, pack.cooldownHours, ctx.steamId), cost: pack.cost && pack.cost.amount, currency: pack.cost && pack.cost.currency };
          const block = blockReason(pack, id, ctx.steamId, false);
          if (block) return ctx.reply(subst(fill(msgText(block), vars), ctx.name, ctx.steamId, ctx), { channel: ch }).catch(() => {});
          const res = await deliver(ctx.steamId, ctx.name, pack, i);
          if (!res.ok) return ctx.reply(subst(fill(msgText(res.reason), vars), ctx.name, ctx.steamId, ctx), { channel: ch }).catch(() => {});
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
        if (blockReason(pack, packId(pack, i), steamId, false)) return;
        host.schedule.after(delayMs, () => { deliver(steamId, name, pack, i).catch(() => {}); });
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
      });
      reload();
      res.json({ ok: true });
    });
    host.routes.get('/meta', (req, res) => res.json({
      channels: ['local', 'global', 'squad', 'admin', 'server'],
      currencies: ['free', 'money', 'gold', 'fame'],
      triggers: ['welcome', 'command'],
      messageKeys: Object.keys(DEFAULT_MSG),
      defaultMessages: DEFAULT_MSG,
      tokens: ['{player}', '{steamid}', '{online}', '{maxplayers}', '{server}', '{channel}', '{args}', '{arg1}',
        '{money}', '{cash}', '{gold}', '{fame}', '{kills}', '{deaths}', '{headshots}', '{playtime}',
        '{squad}', '{squadsize}', '{location}', '{x}', '{y}', '{z}', '{saved_x}', '{saved_y}', '{saved_z}', '{date}', '{time}'],
    }));

    // online players — for the allow/deny picker and to resolve names in the claims view
    host.routes.get('/players', (req, res) => {
      let list = []; try { list = host.players.online() || []; } catch { /* offline */ }
      res.json({ players: (Array.isArray(list) ? list : []).map((p) => ({ steamId: sidOf(p), name: nmOf(p) })).filter((p) => p.steamId) });
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
