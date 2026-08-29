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
//
// ── what is SAVED here, and what the running game is asked instead ────────────────────────────────
// Everything above comes out of SCUM.db, which is the state as of the last SAVE. For a leaderboard
// that is fine. For this plugin two of those numbers decide whether a real player is teleported onto
// a live explosive, so where the game itself can answer, it is asked — and only at the moment of
// acting, never on a clock of its own:
//
//   • `armed` — the save says what the mine was at the last write. The `items` module reports what it
//     is NOW. Asked once, immediately before a teleport, and a live "not armed" cancels it.
//   • the SQUAD half of "inside their own flag" — `isInOwnerArea` resolves the placer's squadmates
//     out of `squad_member`, which is also saved. A player who joined a squad since the last save is
//     not in it yet, so their mine inside a teammate's base reads as an offence. Before punishing, the
//     placer's LIVE roster is read from the `squads` module and the SAME shared flag test is re-run
//     over it. It can only ever find a mine legal that the saved answer called illegal.
//
// The flag GEOMETRY itself stays on SCUM.db and there is no live alternative: no bridge read carries
// a base's owner. `bases()` reports id, name, position and element counts and no ownership at all,
// and `buildElements()` only knows what the bridge watched being built since it started. Ownership of
// a flag exists live nowhere, so the rectangle is the database's answer or it is nobody's.

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
  // `Number(x) || 6` turns a deliberate 0 into 6, because 0 is falsy — so an owner asking for the
  // fastest scan silently got the slowest default instead of the 2s floor this line already means
  // to give them. Validate explicitly, the same way the joinDelaySeconds bug elsewhere was fixed.
  c.pollSeconds = Math.max(2, Math.min(120, Number.isFinite(Number(c.pollSeconds)) ? Number(c.pollSeconds) : 6));
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

    // ── asking the running game, when the save is not good enough ────────────────────────────────
    //
    // Both readers below share three rules, and all three exist because the alternative kills people:
    //   1. A refusal is reported with the MODULE'S OWN sentence where there is one, and by naming the
    //      switch an owner has to find where there is not. "It failed" is not something anyone can act
    //      on, and this plugin already had one silent-enforcement bug of exactly that shape.
    //   2. An ABSENT value is never read as a "no". The bridge omits what it could not read, on
    //      purpose, so that "unknown" and "no" stay apart — the same rule this plugin already follows
    //      for the three-valued `armed` and `inArea`.
    //   3. Nothing here has a timer. Both are called from inside a scan that is already running, at
    //      most once per scan, and only when there is actually an offender to judge.
    const liveNote = { traps: null, squads: null };     // last live-read verdict, for the admin panel
    const liveSaid = { traps: 0, squads: 0 };
    // What an owner has to do about each way a live read can come back empty. `refused` is the
    // module's own sentence and is used verbatim; the rest have no sentence on the wire, so the
    // switch is named here — by the label the panel actually shows, not by the config key.
    const SWITCH = {
      traps: "Read live inventories (Settings → Bridge → Inventories)",
      squads: "Report live squads (Settings → Bridge → Squads)",
    };
    function noteLive(key, q) {
      const code = (q && q.code) || 'bridge_off';
      let text;
      if (code === 'refused') text = (q && q.reason) || null;
      else if (code === 'module_off') text = `the in-game module is switched off — turn on '${SWITCH[key]}'`;
      else if (code === 'no_module') text = 'this server runs an older SSA Bridge that does not have this module';
      else text = 'the SSA Bridge did not answer';
      liveNote[key] = { code, text, at: Date.now() };
      // `bridge_off` is the ordinary state on a server without the bridge running and deserves
      // silence; the other three are one switch or one update away and deserve saying — once an
      // hour, because this sits inside a scan that runs every few seconds.
      if (code === 'bridge_off' || !text) return;
      if (Date.now() - liveSaid[key] < 3600000) return;
      liveSaid[key] = Date.now();
      host.logger.warn(`the live ${key === 'traps' ? 'armed-state' : 'squad'} check could not run: ${text}. Mine Protection carries on with the last save, which is what it did before this check existed.`);
    }
    const clearLive = (key) => { liveNote[key] = null; };
    const canQuery = () => !!(host.bridge && typeof host.bridge.query === 'function');

    /**
     * Every trap the RUNNING GAME has, or null when it could not say.
     *
     * One read per scan at most — the cache is created by poll() and dies with it, so this never
     * becomes a poll of its own.
     */
    async function liveTraps(cache) {
      if (cache.traps !== undefined) return cache.traps;
      cache.traps = null;
      if (!canQuery()) return null;
      const q = await host.bridge.query('items', 'traps');
      if (!q || !q.ok) { noteLive('traps', q); return null; }
      clearLive('traps');
      cache.traps = (q.data && Array.isArray(q.data.traps)) ? q.data.traps : null;
      return cache.traps;
    }

    // How close a live trap actor has to be to a saved trap row to be the same trap. The live read
    // carries no entity id — game actors are not database rows — so a position is the only thing the
    // two views share, and 1.5 m is far tighter than any two mines a player can place apart.
    const TRAP_MATCH_CM = 150;

    /**
     * Does the running game say this trap is NOT armed?
     *
     * TRUE only on an explicit live `armed: false`. Everything else — no live answer, the trap not in
     * the live list, the key absent because the game could not read it — is UNKNOWN and answers
     * false, i.e. "carry on with the saved value". A mine sitting in a level that is not streamed in
     * has no actor to find, and "I did not see it" is not "it is safe".
     */
    async function liveSaysDisarmed(mine, cache) {
      const list = await liveTraps(cache);
      if (!list) return false;
      let best = null, bestD = Infinity;
      for (const t of list) {
        const tx = Number(t && t.x), ty = Number(t && t.y);
        if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
        const d = Math.hypot(tx - Number(mine.x), ty - Number(mine.y));
        if (d < bestD) { bestD = d; best = t; }
      }
      if (!best || bestD > TRAP_MATCH_CM) return false;
      return best.armed === false;
    }

    // profile id → Steam ID. A profile id never changes hands, so unlike membership this is identity
    // rather than state and the database is the right place for it.
    const sidByProfile = new Map();
    function steamIdOfProfile(profileId) {
      const key = Number(profileId);
      if (!Number.isFinite(key) || key <= 0) return null;
      if (sidByProfile.has(key)) return sidByProfile.get(key);
      let sid = null;
      try { const r = host.db.scum.get('SELECT user_id AS steamId FROM user_profile WHERE id = ?', key); sid = (r && r.steamId) ? String(r.steamId) : null; }
      catch (e) { return null; }                        // a failed lookup is not a cacheable answer
      sidByProfile.set(key, sid);
      return sid;
    }

    /**
     * The saved answer said "outside their flag". Ask the game whether the placer's squad, as it
     * holds it right now, makes the same mine legal.
     *
     * `true`  — a squadmate the save did not know about owns that ground. Legal, do not punish.
     * `null`  — the live roster named somebody this manager cannot resolve, so the answer is
     *           incomplete. Skip and retry, exactly as for an unresolvable placer.
     * `false` — nothing live changes the verdict, INCLUDING every case where the game could not be
     *           asked at all. That is deliberately the old behaviour: this check may only ever
     *           rescue a mine, never create an offence.
     */
    async function liveSquadAllows(mine, marginCm, profileId, cache) {
      const pid = Number(profileId);
      if (!Number.isFinite(pid) || pid <= 0 || !canQuery()) return false;
      if (!cache.squads.has(pid)) cache.squads.set(pid, await host.bridge.query('squads', `member:${pid}`));
      const q = cache.squads.get(pid);
      // A solo placer is the common case and the module says so by name ("profile N is not in any
      // loaded squad"). That is a real answer, not a fault, so it is not worth a panel note.
      if (!q || !q.ok) {
        if (!(q && q.code === 'refused' && /not in any/i.test(String(q.reason || '')))) noteLive('squads', q);
        return false;
      }
      clearLive('squads');
      const members = (q.data && Array.isArray(q.data.members)) ? q.data.members : null;
      // The roster rides on the module's own "Include the member list" switch. Counts without names
      // cannot answer this, and guessing from a count is how somebody gets teleported onto a mine.
      if (!members) { noteLive('squads', { code: 'module_off' }); return false; }
      let unknown = false;
      for (const mem of members) {
        const mpid = Number(mem && mem.profileId);
        if (!Number.isFinite(mpid) || mpid === pid) continue;
        const sid = steamIdOfProfile(mpid);
        if (!sid) { unknown = true; continue; }         // in their squad, and we cannot test them
        const v = host.map.isInOwnerArea(sid, mine.x, mine.y, marginCm);
        if (v === true) return true;
        if (v !== false) unknown = true;                // null = the database could not say
      }
      return unknown ? null : false;
    }

    function pushRecent(rec) {
      recent.unshift(rec);
      if (recent.length > 100) recent = recent.slice(0, 100);
      persistRecent();
      try { host.realtime.toAdmins('mine-protection:event', rec); } catch (e) { /* realtime optional */ }
    }

    // Warn or punish one offender. Only reports success when the in-game action actually went through,
    // so a transient bridge failure leaves the mine UNHANDLED to be retried (never a silent miss).
    async function act(mine, placer, c, cache) {
      const steamId = String(placer.steamId);
      const count = offenses[steamId] || 0;
      const warnOnly = c.action === 'warn' || count < c.warningsBeforeAction;
      const name = displayName(mine);
      let ok = false;
      // The penalty is "stand on your own armed mine". `armed` here came out of the last SAVE, and a
      // mine defused or set off since then is no longer that. Only the teleport asks — a warning is
      // just a sentence, and delaying it on a bridge round-trip would buy nothing.
      if (!warnOnly && await liveSaysDisarmed(mine, cache)) {
        host.logger.debug(`skipped ${placer.name || steamId}'s ${name}: the running game says it is no longer armed`);
        return false;                                   // unhandled → re-checked next scan
      }
      try {
        if (warnOnly) {
          // A warning only counts if it ARRIVED.
          //
          // This used to set ok = true regardless, on the reasoning that the placer must be online
          // to get here. That is only true while `requireOnline` is on, and it is a setting — with
          // it off, the warning went to a player who was not there, the mine was marked handled and
          // the offence was counted. They never saw it, and their next mine got the real punishment
          // for a warning that was never delivered. The whole point of warning first is that nobody
          // is punished without notice.
          //
          // The bridge reports how many players it reached; anything other than a positive number is
          // treated as not delivered, so the mine stays unhandled and is warned about again when
          // they are actually there.
          const r = await host.chat.dm(steamId, c.warnMessage || DEFAULTS.warnMessage, { channel: c.channel });
          ok = !!(r && Number(r.delivered) > 0);
          if (!ok) host.logger.debug(`warning for ${placer.name || steamId} was not delivered (offline?) — will warn again`);
        } else {
          // Run "#Teleport X Y Z" THROUGH the placer (executor) so, with no target arg, the game
          // teleports the placer themselves onto the armed mine — reliable, no name/steamid targeting.
          const r = await host.server.command(`#Teleport ${Math.round(mine.x)} ${Math.round(mine.y)} ${Math.round(mine.z)}`, { executor: steamId });
          // `confirmed !== false`, not `ok` alone. The bridge answers `ok: true, dispatched: true,
          // confirmed: false` when it handed the command over and the game never said anything back.
          // Treating that as success marked the mine handled, counted an offence and told the player
          // they had been moved — while they were still standing on an armed mine. The currency here
          // is not money, which is why this instance survived the sweep that found the other three.
          // `confirmed` is absent on the ordinary executor path, so this changes nothing there.
          ok = !!(r && r.ok !== false && r.confirmed !== false);
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

    /**
     * The manager could not tell us whether a mine is inside its placer's flag.
     *
     * Skipping is right — punishing on a guess is how you kill someone for a legal mine — but a
     * plugin whose whole job is enforcement, silently enforcing nothing, is its own problem. If the
     * database stays unreadable this never punishes anyone again and the panel looks perfectly
     * normal. So it is said once an hour rather than once per mine per scan, which at a 1s heartbeat
     * would be thousands of identical lines.
     */
    let lastUnknownWarn = 0;
    function noteUnknownArea(placer, mine) {
      if (Date.now() - lastUnknownWarn < 3600000) return;
      lastUnknownWarn = Date.now();
      host.logger.warn(`could not tell whether ${placer.name || placer.steamId}'s ${displayName(mine)} is inside their own flag — the game database did not answer. Nothing was done about it, and nothing will be while that lasts. Mines are re-checked every scan, so this recovers on its own once the database is readable.`);
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
      // Lives exactly as long as this pass. One live trap read and one live squad read per placer,
      // per scan, at most — and only if a scan actually finds something to act on.
      const cache = { traps: undefined, squads: new Map() };

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
        // THREE answers, not two. `null` means the manager could not say — the game database was
        // unreadable, or that player is not resolvable in it yet — and it must never be read as
        // "outside their flag", because the next line teleports them onto an armed mine.
        //
        // The mine itself comes from the world snapshot and this comes from SCUM.db, so one being
        // available says nothing about the other. Treated as false, a database hiccup killed a player
        // for a mine legally placed inside their own base, and nothing anywhere recorded why.
        //
        // Skip and retry, exactly as for a placer we cannot resolve: the mine stays unhandled, and if
        // it really is illegal it will still be there on the next scan.
        const inArea = host.map.isInOwnerArea(placer.steamId, m.x, m.y, marginCm);
        if (inArea === null || inArea === undefined) { noteUnknownArea(placer, m); continue; }
        if (inArea) { handled.add(id); continue; }                                                    // legal (own/squad flag)
        // "Outside their flag" — computed from SAVED squad membership. Before acting on it, ask the
        // game who is in their squad NOW and re-run the same shared test over that roster. `null` is
        // an incomplete answer and is skipped for the same reason the line above skips one.
        const liveArea = await liveSquadAllows(m, marginCm, m.ownerId, cache);
        if (liveArea === true) { handled.add(id); continue; }                                        // legal by a squad the save has not caught up with
        if (liveArea === null) { noteUnknownArea(placer, m); continue; }
        if (c.requireOnline && online && !online.has(placer.steamId)) continue;                          // offline → retry when they return
        if (await act(m, placer, c, cache)) handled.add(id);   // only mark handled once the action succeeded
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
        // THREE-VALUED, exactly like the enforcement path above — and for the same reason.
        //
        // This used to be `!!host.map.isInOwnerArea(...)`, which collapses the manager's `null`
        // ("the game database could not answer") into `false` ("outside their flag"). The scan
        // stopped doing that; this table did not, so it showed a mine as an offence the plugin
        // was deliberately refusing to judge, and an admin reading "Pending" beside a mine that
        // never got enforced had nothing to go on. The panel has to show the same three answers
        // the plugin acts on, or it is describing a different plugin.
        const inArea = sid ? host.map.isInOwnerArea(sid, m.x, m.y, marginCm) : false;
        // Same rule for `armed`: the world scan OMITS the key when it could not read the trap's
        // XML, and "unknown" is not "not armed" — the plugin does nothing in either case, but only
        // one of them is a trap sitting there disarmed.
        const armed = (m.armed === true || m.armed === false) ? m.armed : null;
        return {
          id: m.id, type: m.type, code: m.code || null, name: displayName(m), armed,
          x: Math.round(m.x), y: Math.round(m.y), z: Math.round(m.z),
          placerName: placer ? placer.name : null, placerSteamId: sid || null,
          inArea: (inArea === true || inArea === false) ? inArea : null,
          exempt: sid ? exempt.has(sid) : false,
          handled: handled.has(String(m.id)), offences: sid ? (offenses[sid] || 0) : 0,
        };
      });
      // Most-relevant first: armed & outside-flag & not-yet-handled at the top; un-armed last.
      out.sort((a, b) => (Number(a.armed === true ? 0 : 1) - Number(b.armed === true ? 0 : 1)) || (Number(a.inArea === true) - Number(b.inArea === true)) || (Number(a.handled) - Number(b.handled)) || (b.offences - a.offences));
      res.json({ mines: out, serverRunning: true });
    });

    // `GET /online` used to live here, for the exemption picker. The picker uses the panel's own
    // SSA.pickPlayer now — which is the point of having an SDK — so nothing called it.

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
        // What the two live cross-checks are doing. `null` for a check means the last time it ran it
        // answered — an owner should see "the game is being asked" or the reason it is not, and never
        // a plugin that quietly fell back to the save without saying.
        live: { traps: liveNote.traps, squads: liveNote.squads },
      });
    });

    // Reset the escalation memory (offence counts) — e.g. after a wipe, so everyone starts on a warning again.
    /**
     * Forget offences — for one player, or for everyone.
     *
     * The count only ever grew, and the reset was all-or-nothing. So forgiving one player meant
     * wiping the record of every other offender, and an admin who did not want to do that had no
     * option at all: the player stayed one mine away from the real punishment for ever, over
     * something from months ago.
     *
     * A body with no `steamId` still clears everything, which is what the existing "Reset warnings"
     * button sends — that keeps working untouched.
     */
    host.routes.post('/reset-offenses', (req, res) => {
      const sid = String((req.body || {}).steamId || '').trim();
      if (sid) {
        delete offenses[sid];
        persistOffenses();
        return res.json({ ok: true, cleared: 1 });
      }
      const n = Object.keys(offenses).length;
      for (const k of Object.keys(offenses)) delete offenses[k];
      persistOffenses(); res.json({ ok: true, cleared: n });
    });
    // Clear the recent-actions history shown in the panel.
    host.routes.post('/clear-history', (req, res) => { recent = []; persistRecent(); res.json({ ok: true }); });

    host.logger.info(`Mine Protection active — watching ${cfg().watchedTypes.length} type(s)`);
  },

  async unregister(host) { host.logger.info('Mine Protection stopped'); },
};
