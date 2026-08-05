'use strict';

// Mine Protection — punishes players who ARM a mine/trap OUTSIDE their (or their squad's) flag area.
//
// How it stays reliable:
//   • It reads placed mines/traps from the manager's OWN world scan (host.map.world().traps), which
//     parses the item XML canonically — armed state + who armed it (profile id, incl. a buried mine's
//     placer) — exactly like the live map. Re-parsing the XML by hand here was the old bug: the armed
//     flag lives on a nested element, so a first-tag-only regex missed it and "sometimes didn't punish".
//   • profile id → steamId via user_profile(id → user_id).
//   • "inside the flag" = the shared manager test (host.map.isInOwnerArea) against every base owned by
//     the placer OR any squadmate — a squad member arming inside a teammate's base is never punished.
//   • Outside → escalate: the first N offences per player are a chat warning, then the placer is
//     teleported onto their own armed mine (run THROUGH the placer via the bridge executor, so no
//     fragile name/steamid targeting) and it detonates.
//   • A placer who is offline is retried every scan AND the instant they reconnect (bridge join hook),
//     so an offence is never silently dropped.
//
// State (handled mines, per-player offence counts, recent actions) is persisted in the plugin store,
// so a restart never re-punishes a mine it already handled and keeps the escalation/history intact.

// ── the mine/trap catalog (mirrors the manager's live-map TRAP_CLASSES, keyed by the stable `type`) ──
// `type` matches host.map.world().traps[].type (the class with the _ES suffix stripped, C4 folded).
// `code` is a representative item code used only to fetch a display name + icon for the picker UI.
const TRAP_CATALOG = [
  { type: 'ImprovisedMine',     code: 'ImprovisedMine_ES',     explosive: true },
  { type: 'Mine_01',            code: 'Mine_01_ES',            explosive: true },
  { type: 'Mine_02',            code: 'Mine_02_ES',            explosive: true },
  { type: 'ImprovisedClaymore', code: 'ImprovisedClaymore_ES', explosive: true },
  { type: 'Claymore',           code: 'Claymore_ES',           explosive: true },
  { type: 'PressureCookerBomb', code: 'PressureCookerBomb_ES', explosive: true },
  { type: 'PipeBomb',           code: 'PipeBomb_ES',           explosive: true },
  { type: 'PromTrap',           code: 'PromTrap_ES',           explosive: true },
  { type: 'CartridgeTrap',      code: 'CartridgeTrap_ES',      explosive: false },
  { type: 'StakePitTrap',       code: 'StakePitTrap_ES',       explosive: false },
  { type: 'BarbedSpikeTrap',    code: 'BarbedSpikeTrap_ES',    explosive: false },
  { type: 'FlareTrap',          code: 'FlareTrap_ES',          explosive: false },
  { type: 'SilentAlarm',        code: 'SilentAlarm_ES',        explosive: false },
  { type: 'C4',                 code: 'C4_Pack_ES',            explosive: true },
];
const KNOWN_TYPES = new Set(TRAP_CATALOG.map((t) => t.type));
// Default watch list: the explosive traps that grief players in the open (C4 is a raiding tool placed
// outside flags by design, so it's NOT watched by default — the admin can add it).
const DEFAULT_TYPES = ['ImprovisedMine', 'Mine_01', 'Mine_02', 'ImprovisedClaymore', 'Claymore', 'PressureCookerBomb', 'PipeBomb', 'PromTrap'];

const DEFAULTS = {
  enabled: true,
  pollSeconds: 6,
  marginMeters: 0,                    // extra tolerance around the real flag rectangle (0 = exact flag area)
  watchedTypes: DEFAULT_TYPES.slice(),
  action: 'teleport_to_mine',         // 'teleport_to_mine' | 'warn'
  warningsBeforeAction: 1,            // chat warnings per player before the action kicks in (0 = act at once)
  requireOnline: true,               // only act while the placer is online (needed to teleport them)
  exemptSteamIds: [],
  channel: 'local',                  // in-game chat channel the warn/penalty message shows in for the offender
  message: 'Placing a mine outside your flag is not allowed. Enjoy your own trap.',
  warnMessage: 'Warning: arming a mine outside your flag is not allowed. Next one takes you with it.',
};
// Channels a targeted DM can be delivered to for one player.
const CHANNELS = ['local', 'global', 'squad', 'admin', 'server'];

// Accept older stored configs: `classes` (class-name prefixes) → `watchedTypes`; `warnFirst` bool →
// `warningsBeforeAction`. Always returns a clean, validated config.
function normalizeConfig(raw) {
  const c = Object.assign({}, DEFAULTS, raw || {});
  if (!Array.isArray(c.watchedTypes) && Array.isArray(raw && raw.classes)) {
    const picked = new Set();
    for (const pref of raw.classes) {
      const p = String(pref || '');
      for (const t of TRAP_CATALOG) if (t.type === p || t.type.indexOf(p) === 0 || t.code.indexOf(p) === 0) picked.add(t.type);
    }
    c.watchedTypes = picked.size ? [...picked] : DEFAULT_TYPES.slice();
  }
  if (raw && raw.warnFirst != null && raw.warningsBeforeAction == null) c.warningsBeforeAction = raw.warnFirst ? 1 : 0;
  c.watchedTypes = (Array.isArray(c.watchedTypes) ? c.watchedTypes : DEFAULT_TYPES).map(String).filter((t) => KNOWN_TYPES.has(t));
  if (!c.watchedTypes.length) c.watchedTypes = DEFAULT_TYPES.slice();
  c.pollSeconds = Math.max(2, Math.min(120, Number(c.pollSeconds) || 6));
  c.marginMeters = Math.max(0, Number(c.marginMeters) || 0);
  c.warningsBeforeAction = Math.max(0, Math.min(10, parseInt(c.warningsBeforeAction, 10) || 0));
  c.action = c.action === 'warn' ? 'warn' : 'teleport_to_mine';
  c.enabled = c.enabled !== false;
  c.requireOnline = c.requireOnline !== false;
  c.exemptSteamIds = (Array.isArray(c.exemptSteamIds) ? c.exemptSteamIds : []).map((s) => String(s).trim()).filter(Boolean);
  c.channel = CHANNELS.indexOf(c.channel) >= 0 ? c.channel : 'local';
  c.message = String(c.message || DEFAULTS.message);
  c.warnMessage = String(c.warnMessage || DEFAULTS.warnMessage);
  return c;
}

module.exports = {
  async register(host) {
    const cfg = () => normalizeConfig(host.store.get('config', {}));

    // The plugin leans on two shared manager facilities; without them it refuses to run rather than
    // guess (and risk punishing legal mines): the flag-area test and the canonical world scan.
    if (!host.map || typeof host.map.isInOwnerArea !== 'function' || typeof host.map.world !== 'function') {
      host.logger.error('Mine Protection needs a newer manager (host.map.world + isInOwnerArea) — not started.');
      return;
    }

    // ── persisted state ──
    const handled = new Set((host.store.get('handled', []) || []).map(String));  // mine ids already acted on / cleared
    const offenses = Object.assign({}, host.store.get('offenses', {}) || {});     // steamId → offence count (escalation)
    let recent = (host.store.get('recent', []) || []).slice(0, 100);             // recent actions (newest first) for the UI
    let seeded = host.store.get('seeded', false) === true;
    const absent = new Map();          // handled mine id → consecutive scans missing (debounced pruning)
    const PRUNE_AFTER = 20;            // forget a handled mine only after this many CONSECUTIVE absent scans
                                       // (~2 min at the default interval) — a still-armed mine that blips out
                                       // of one scan is never forgotten, so it can't be re-punished.

    // One-time migration from the pre-1.4 store keys, so UPDATING from an older version keeps the
    // baseline (never mass-punishes existing mines) and who was already warned — instead of re-seeding.
    if (host.store.get('handled', null) === null && Array.isArray(host.store.get('seen', null))) {
      (host.store.get('seen', []) || []).forEach((id) => handled.add(String(id)));
      seeded = true;
      try { host.store.set('handled', [...handled]); host.store.set('seeded', true); } catch (e) { /* ignore */ }
    }
    if (host.store.get('offenses', null) === null && Array.isArray(host.store.get('warned', null))) {
      (host.store.get('warned', []) || []).forEach((sid) => { offenses[String(sid)] = 1; });   // already had their warning
      try { host.store.set('offenses', offenses); } catch (e) { /* ignore */ }
    }

    let handledSig = [...handled].sort().join(',');
    const persistHandled = () => { const sig = [...handled].sort().join(','); if (sig !== handledSig) { handledSig = sig; try { host.store.set('handled', [...handled]); } catch (e) { /* ignore */ } } };
    const persistOffenses = () => { try { host.store.set('offenses', offenses); } catch (e) { /* ignore */ } };
    const persistRecent = () => { try { host.store.set('recent', recent.slice(0, 100)); } catch (e) { /* ignore */ } };

    // ── helpers ──
    function resolvePlacer(profileId) {
      if (!profileId) return null;
      try { const p = host.db.scum.get('SELECT user_id AS steamId, name FROM user_profile WHERE id = ?', Number(profileId)); return p && p.steamId ? { steamId: String(p.steamId), name: p.name || null } : null; }
      catch (e) { return null; }
    }
    const onlineSet = () => {
      try { return new Set((host.players.online() || []).map((p) => String(p.steamId || p.steamid || p.SteamID || p.steam_id || '')).filter(Boolean)); }
      catch (e) { return new Set(); }
    };
    const typeMeta = (type) => TRAP_CATALOG.find((t) => t.type === type) || null;
    const displayName = (t) => t.name || (typeMeta(t.type) && host.items.name(typeMeta(t.type).code)) || String(t.type || t.code || 'mine');

    // The manager's canonical world scan is the single source of truth for "is the game DB readable
    // right now". getMapData() returns null ONLY when the SCUM.db handle is unavailable (server
    // stopped / mid-restart / file missing) — NOT tied to a possibly-stale process check. So we gate on
    // this directly instead of host.server.isRunning() (which was wrongly reporting "offline").
    function worldTraps() {
      const world = host.map.world();
      return (world && Array.isArray(world.traps)) ? world.traps : null;   // null = DB not readable now
    }
    // All currently-placed mines/traps of a watched type (armed OR not) — for the overview table.
    function watchedTraps(c) {
      const traps = worldTraps();
      if (traps === null) return null;
      const watch = new Set(c.watchedTypes);
      return traps.filter((t) => watch.has(t.type));
    }
    // Just the ARMED, placer-known ones — the actual enforcement candidates.
    function armedWatchedMines(c) {
      const traps = watchedTraps(c);
      if (traps === null) return null;
      return traps.filter((t) => t.armed === true && t.ownerId);
    }

    function pushRecent(rec) {
      recent.unshift(rec);
      if (recent.length > 100) recent = recent.slice(0, 100);
      persistRecent();
      try { host.realtime.toAdmins('mine-protection:event', rec); } catch (e) { /* realtime optional */ }
    }

    // Warn or punish one offender. Only reports success when the in-game action actually went through,
    // so a transient bridge failure leaves the mine UNHANDLED to be retried (never a silent miss).
    async function act(mine, placer, c) {
      const steamId = String(placer.steamId);
      const count = offenses[steamId] || 0;
      const warnOnly = c.action === 'warn' || count < c.warningsBeforeAction;
      const name = displayName(mine);
      let ok = false;
      try {
        if (warnOnly) {
          await host.chat.dm(steamId, c.warnMessage || DEFAULTS.warnMessage, { channel: c.channel });
          ok = true;   // best-effort delivery (the placer is online — required to reach here)
        } else {
          // Run "#Teleport X Y Z" THROUGH the placer (executor) so, with no target arg, the game
          // teleports the placer themselves onto the armed mine — reliable, no name/steamid targeting.
          const r = await host.server.command(`#Teleport ${Math.round(mine.x)} ${Math.round(mine.y)} ${Math.round(mine.z)}`, { executor: steamId });
          ok = !!(r && r.ok !== false);
          if (ok) { try { await host.chat.dm(steamId, c.message || DEFAULTS.message, { channel: c.channel }); } catch (e) { /* message optional */ } }
        }
      } catch (e) { host.logger.warn('penalty failed: ' + e.message); ok = false; }
      if (!ok) return false;

      offenses[steamId] = count + 1; persistOffenses();
      const action = warnOnly ? 'warn' : 'teleport';
      pushRecent({ at: Date.now(), player: placer.name || null, steamId, mine: name, type: mine.type, action, loc: { x: Math.round(mine.x), y: Math.round(mine.y), z: Math.round(mine.z) } });
      host.logger.info(`${action === 'warn' ? 'warned' : 'punished'} ${placer.name || steamId} (${steamId}) for arming a ${name} outside their flag`);
      return true;
    }

    async function poll() {
      const c = cfg();
      if (!c.enabled) return;

      const mines = armedWatchedMines(c);
      if (mines === null) return;                  // world not readable right now → skip, keep memory

      const marginCm = Math.max(0, Number(c.marginMeters) || 0) * 100;
      const exempt = new Set(c.exemptSteamIds.map(String));
      const current = new Set(mines.map((m) => String(m.id)));
      const online = c.requireOnline ? onlineSet() : null;

      if (!seeded) {                               // first successful scan: learn existing mines, punish none
        handled.clear(); for (const id of current) handled.add(id);
        seeded = true; try { host.store.set('seeded', true); } catch (e) { /* ignore */ }
        persistHandled(); return;
      }

      for (const m of mines) {
        const id = String(m.id);
        if (handled.has(id)) continue;             // already dealt with
        const placer = resolvePlacer(m.ownerId);
        if (!placer) continue;                      // can't resolve the placer yet → retry next scan
        if (exempt.has(placer.steamId)) { handled.add(id); continue; }
        if (host.map.isInOwnerArea(placer.steamId, m.x, m.y, marginCm)) { handled.add(id); continue; }  // legal (own/squad flag)
        if (c.requireOnline && online && !online.has(placer.steamId)) continue;                          // offline → retry when they return
        if (await act(m, placer, c)) handled.add(id);   // only mark handled once the action succeeded
      }

      // Debounced memory upkeep: keep every mine still present; forget a handled mine only after it has
      // been absent for several consecutive scans (a real detonation/pickup, not a one-off bad read).
      for (const id of current) absent.delete(id);
      for (const id of [...handled]) {
        if (current.has(id)) continue;
        const n = (absent.get(id) || 0) + 1;
        if (n >= PRUNE_AFTER) { handled.delete(id); absent.delete(id); } else absent.set(id, n);
      }
      persistHandled();
    }

    // ── scheduling: a light 1 s heartbeat runs the scan when it's due, so a changed interval takes
    //    effect live (no manager restart) and a fresh join can force an immediate re-scan. ──
    let lastRun = 0, busy = false;
    async function tick() {
      if (busy) return;
      const c = cfg();
      if (!c.enabled) return;
      if (Date.now() - lastRun < c.pollSeconds * 1000) return;
      busy = true; lastRun = Date.now();
      try { await poll(); } catch (e) { host.logger.warn('poll error: ' + e.message); } finally { busy = false; }
    }
    host.schedule.every(1000, () => { tick(); });

    // Punish the moment an offender reconnects (offline mines waiting on `requireOnline`) — the bridge
    // join hook fires with no log-tail lag; nudge the next heartbeat to scan right away.
    try { host.players.onJoin(() => { lastRun = 0; }); } catch (e) { /* join hook optional */ }

    // ── admin-panel endpoints ──
    host.routes.get('/config', (req, res) => res.json(cfg()));
    host.routes.post('/config', (req, res) => {
      try {
        const next = normalizeConfig(req.body || {});
        host.store.set('config', next);
        lastRun = 0;                               // apply immediately (interval/type changes take effect now)
        res.json({ ok: true, config: next });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Rich picker data: every known mine/trap type with a display name, icon and how many are placed /
    // armed on THIS server right now — so the admin picks from real, illustrated options.
    host.routes.get('/catalog', (req, res) => {
      const counts = {};
      try {
        const traps = worldTraps();
        if (traps) for (const t of traps) {
          const k = t.type; if (!counts[k]) counts[k] = { placed: 0, armed: 0 };
          counts[k].placed++; if (t.armed === true) counts[k].armed++;
        }
      } catch (e) { /* counts optional */ }
      const items = TRAP_CATALOG.map((t) => ({
        type: t.type,
        name: (host.items.name(t.code) || t.type.replace(/_/g, ' ')),
        image: host.items.image(t.code) || null,
        explosive: t.explosive,
        placed: (counts[t.type] && counts[t.type].placed) || 0,
        armed: (counts[t.type] && counts[t.type].armed) || 0,
      }));
      res.json({ items, defaults: DEFAULT_TYPES });
    });

    // Live overview: EVERY currently-placed watched mine/trap (armed or not) with who armed it, where,
    // whether it's inside a flag, and its enforcement state — powers the admin overview table. Showing
    // un-armed ones too means a freshly-placed mine appears immediately (not only once it's armed).
    host.routes.get('/mines', (req, res) => {
      const c = cfg();
      const traps = watchedTraps(c);
      if (traps === null) return res.json({ mines: [], serverRunning: false });
      const marginCm = Math.max(0, Number(c.marginMeters) || 0) * 100;
      const exempt = new Set(c.exemptSteamIds.map(String));
      const out = traps.map((m) => {
        const placer = m.ownerId ? resolvePlacer(m.ownerId) : null;
        const sid = placer && placer.steamId;
        const inArea = sid ? !!host.map.isInOwnerArea(sid, m.x, m.y, marginCm) : false;
        return {
          id: m.id, type: m.type, code: m.code || null, name: displayName(m), armed: m.armed === true,
          x: Math.round(m.x), y: Math.round(m.y), z: Math.round(m.z),
          placerName: placer ? placer.name : null, placerSteamId: sid || null,
          inArea, exempt: sid ? exempt.has(sid) : false,
          handled: handled.has(String(m.id)), offences: sid ? (offenses[sid] || 0) : 0,
        };
      });
      // Most-relevant first: armed & outside-flag & not-yet-handled at the top; un-armed last.
      out.sort((a, b) => (Number(a.armed ? 0 : 1) - Number(b.armed ? 0 : 1)) || (Number(a.inArea) - Number(b.inArea)) || (Number(a.handled) - Number(b.handled)) || (b.offences - a.offences));
      res.json({ mines: out, serverRunning: true });
    });

    // Online players — for the exemption picker (never punish these players).
    host.routes.get('/online', (req, res) => {
      let list = [];
      try { list = (host.players.online() || []).map((p) => ({ steamId: String(p.steamId || p.steamid || p.SteamID || p.steam_id || ''), name: p.name || p.playerName || p.Name || null })).filter((p) => p.steamId); }
      catch (e) { /* empty */ }
      res.json({ players: list });
    });

    // Live status for the UI header + recent-actions feed. "serverRunning" here means "the game DB is
    // readable right now" (worldTraps() !== null) — the meaningful signal for this plugin, and the one
    // that isn't a false-negative like a stale process check.
    host.routes.get('/status', (req, res) => {
      const c = cfg();
      const readable = worldTraps() !== null;
      res.json({
        enabled: c.enabled, action: c.action, watchedTypes: c.watchedTypes, warningsBeforeAction: c.warningsBeforeAction,
        requireOnline: c.requireOnline, marginMeters: c.marginMeters, pollSeconds: c.pollSeconds,
        serverRunning: readable, knownMines: handled.size, warnedPlayers: Object.keys(offenses).length, recent,
      });
    });

    // Reset the escalation memory (offence counts) — e.g. after a wipe, so everyone starts on a warning again.
    host.routes.post('/reset-offenses', (req, res) => {
      for (const k of Object.keys(offenses)) delete offenses[k];
      persistOffenses(); res.json({ ok: true });
    });
    // Clear the recent-actions history shown in the panel.
    host.routes.post('/clear-history', (req, res) => { recent = []; persistRecent(); res.json({ ok: true }); });

    host.logger.info(`Mine Protection active — watching ${cfg().watchedTypes.length} type(s)`);
  },

  async unregister(host) { host.logger.info('Mine Protection stopped'); },
};
