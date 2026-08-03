'use strict';

// Mine Protection — punishes players who ARM a mine/trap OUTSIDE their (or their squad's) flag area.
//
//   • A placed+armed mine is an `entity` (class e.g. ImprovisedMine_ES) with world coords in
//     entity.location_x/y/z and, in its item_entity.xml, `_isArmed="true"` and `_currentArmer="<N>"`
//     where N is the profile id of the player who armed it (0 = unplaced loot, ignored).
//   • profile id → steamId via user_profile(id → user_id).
//   • "inside the flag" = inside the REAL flag rectangle: SCUM stores each base's claimed area in
//     `base(location_x/y, bounds_min/max_x/y, owner_user_profile_id)` — bounds are relative to location.
//     We test the mine against every base owned by the placer OR any squadmate (squad-aware), so a
//     squad member arming inside a teammate's base is never punished.
//   • Outside → teleport the placer onto their own armed mine (it detonates) + a chat warning.
//
// State (warned players, known mines) is persisted in the plugin store so a manager restart doesn't
// re-warn people who were already warned, and doesn't re-punish or re-seed mines it already knows.

const DEFAULTS = {
  enabled: true,
  pollSeconds: 6,
  marginMeters: 0,                   // extra tolerance around the real flag rectangle (0 = exact flag area)
  classes: ['ImprovisedMine', 'Mine_0', 'Claymore', 'ImprovisedClaymore', 'PromTrap', 'PressureCookerBomb'],
  action: 'teleport_to_mine',        // 'teleport_to_mine' | 'warn'
  warnFirst: true,                    // first offence per player = warning only, then act
  requireOnline: true,               // only act while the placer is online (needed to teleport them)
  exemptSteamIds: [],
  message: 'Placing a mine outside your flag is not allowed. Enjoy your own trap.',
  warnMessage: 'Warning: arming a mine outside your flag is not allowed. Next one takes you with it.',
};

module.exports = {
  async register(host) {
    const cfg = () => Object.assign({}, DEFAULTS, host.store.get('config', {}));
    const scum = host.db.scum;

    // The flag-area test is the manager's single shared function (same one the raid-alert filter and the
    // live map use). Requires a manager that exposes it; bail out safely rather than punish blindly.
    if (!host.map || typeof host.map.isInOwnerArea !== 'function') {
      host.logger.error('Mine Protection needs a newer manager (host.map.isInOwnerArea) — not started.');
      return;
    }

    // ── persisted state ──
    const warned = new Set((host.store.get('warned', []) || []).map(String));   // players already warned
    const seen = new Set();                                                     // mine entity ids already handled
    let seeded = false;
    { const s = host.store.get('seen', null); if (Array.isArray(s)) { s.forEach((id) => seen.add(id)); seeded = true; } }
    let seenSig = [...seen].sort().join(',');
    const recent = [];
    const absent = new Map();          // seen mine id -> consecutive polls it's been missing (debounced pruning)
    const PRUNE_AFTER = 5;             // forget a known mine only after this many absent polls (= real removal, not a bad read)

    function persistSeen() { const sig = [...seen].sort().join(','); if (sig !== seenSig) { seenSig = sig; try { host.store.set('seen', [...seen]); } catch (e) { /* ignore */ } } }
    function rememberWarned(sid) { warned.add(String(sid)); try { host.store.set('warned', [...warned]); } catch (e) { /* ignore */ } }

    function resolvePlacer(profileId) {
      try { const p = scum.get('SELECT user_id AS steamId, name FROM user_profile WHERE id = ?', profileId); return p && p.steamId ? p : null; }
      catch (e) { return null; }
    }

    function isOnline(steamId) {
      try { const list = host.players.online() || []; return list.some((p) => String(p.steamId || p.steamid || p.SteamID || p.steam_id) === String(steamId)); }
      catch (e) { return false; }
    }

    // All currently placed+armed mines matching the watched classes.
    // Returns NULL (not []) when the game DB can't be trusted right now — the server is restarting, its
    // SCUM.db handle is released, or the file is gone. host.db.scum.all() masks all of those (and any
    // locked read) as an empty array, which would make the caller believe every mine vanished and wipe
    // its memory; the availability gate here (plus the empty-guard in poll) keeps that from happening.
    function fetchArmedMines(c) {
      if (!host.server.isRunning() || !host.db.scum.available()) return null;
      const classes = (Array.isArray(c.classes) && c.classes.length ? c.classes : DEFAULTS.classes);
      const clause = classes.map(() => 'e.class LIKE ?').join(' OR ');
      const params = classes.map((k) => String(k) + '%');
      let rows = [];
      try {
        rows = scum.all(
          `SELECT e.id AS id, e.class AS class, e.location_x AS x, e.location_y AS y, e.location_z AS z, ie.xml AS xml
           FROM entity e JOIN item_entity ie ON ie.entity_id = e.id
           WHERE (${clause}) AND (e.location_x != 0 OR e.location_y != 0)`,
          ...params,
        );
      } catch (e) { host.logger.warn('query failed: ' + e.message); return null; }
      const out = [];
      for (const r of rows) {
        const tag = (String(r.xml || '').match(/<Item\b[^>]*>/) || [''])[0];
        if (!/_isArmed="true"/.test(tag)) continue;
        const armer = parseInt((tag.match(/_currentArmer="(\d+)"/) || [])[1] || '0', 10);
        if (!armer) continue;
        out.push({ id: r.id, class: r.class, x: r.x, y: r.y, z: r.z, armer });
      }
      return out;
    }

    async function punish(m, placer, c) {
      const steamId = String(placer.steamId);
      const warnOnly = c.action === 'warn' || (c.warnFirst && !warned.has(steamId));
      if (c.warnFirst && !warned.has(steamId)) rememberWarned(steamId);
      try {
        if (warnOnly) {
          await host.chat.dm(steamId, c.warnMessage || DEFAULTS.warnMessage);
        } else {
          await host.server.command(`#Teleport ${Math.round(m.x)} ${Math.round(m.y)} ${Math.round(m.z)} ${steamId}`);
          await host.chat.dm(steamId, c.message || DEFAULTS.message);
        }
      } catch (e) { host.logger.warn('penalty failed: ' + e.message); }
      const rec = { at: Date.now(), player: placer.name, steamId, mine: m.class, action: warnOnly ? 'warn' : c.action, loc: { x: Math.round(m.x), y: Math.round(m.y), z: Math.round(m.z) } };
      recent.unshift(rec); if (recent.length > 50) recent.pop();
      host.logger.info(`${warnOnly ? 'warned' : 'punished'} ${placer.name} (${steamId}) for a ${m.class} outside their flag`);
    }

    async function poll() {
      const c = cfg();
      if (!c.enabled) return;

      const mines = fetchArmedMines(c);
      if (mines === null) return;          // DB not readable right now (restart / released handle / locked) → skip, keep memory

      const marginCm = Math.max(0, Number(c.marginMeters) || 0) * 100;
      const exempt = new Set((c.exemptSteamIds || []).map(String));
      const current = new Set(mines.map((m) => m.id));

      if (!seeded) {                       // first SUCCESSFUL run: learn existing mines, punish nothing
        seen.clear(); for (const id of current) seen.add(id);
        seeded = true; persistSeen(); return;
      }

      // Second line of defence: armed mines are only ever removed one at a time (detonation / pickup),
      // so a poll that suddenly shows ZERO while we already know of several is almost certainly a bad
      // read that slipped past the gate — skip it and keep `seen`, rather than treat every mine as new.
      if (current.size === 0 && seen.size >= 2) return;

      const retry = new Set();             // ids to re-check next poll (e.g. placer offline right now)
      for (const m of mines) {
        if (seen.has(m.id)) continue;       // already handled
        const placer = resolvePlacer(m.armer);
        if (!placer || exempt.has(String(placer.steamId))) continue;
        if (host.map.isInOwnerArea(placer.steamId, m.x, m.y, marginCm)) continue;   // legal → inside own/squad flag (shared manager check)
        if (c.requireOnline && !isOnline(placer.steamId)) { retry.add(m.id); continue; }
        await punish(m, placer, c);
      }

      // Update memory WITHOUT ever wiping it (the old wholesale `seen.clear()` rebuild was the bug: a
      // single masked bad read re-armed every already-known mine). Add everything present now (minus
      // retry); forget a known mine only after it's been absent for several consecutive polls — a real
      // removal, not a one-off read glitch.
      for (const id of current) { if (!retry.has(id)) seen.add(id); absent.delete(id); }
      for (const id of [...seen]) {
        if (current.has(id) || retry.has(id)) continue;
        const n = (absent.get(id) || 0) + 1;
        if (n >= PRUNE_AFTER) { seen.delete(id); absent.delete(id); } else absent.set(id, n);
      }
      persistSeen();
    }

    const intervalMs = Math.max(2, Number(cfg().pollSeconds) || 6) * 1000;
    host.schedule.every(intervalMs, () => { poll().catch((e) => host.logger.warn('poll error: ' + e.message)); });

    // Config read/save for the admin-panel UI (persisted in the plugin store).
    host.routes.get('/config', (req, res) => res.json(cfg()));
    host.routes.post('/config', (req, res) => { try { host.store.set('config', Object.assign({}, DEFAULTS, req.body || {})); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
    host.routes.get('/status', (req, res) => { const c = cfg(); res.json({ enabled: c.enabled, watching: c.classes, marginMeters: c.marginMeters, action: c.action, knownMines: seen.size, warnedPlayers: warned.size, recent }); });

    host.logger.info('Mine Protection active');
  },

  async unregister(host) { host.logger.info('Mine Protection stopped'); },
};
