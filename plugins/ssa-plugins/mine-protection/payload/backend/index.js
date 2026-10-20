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
//
// The game's own VERDICT per trap is live, though, and this plugin does not read it yet: the codex says
// ownership of a trap is conferred only by arming it inside a flag area, and `items traps` publishes
// that as `ownerProfileId`, absent exactly on a trap armed outside one (on a live server, one player's
// mines inside their own flag all named them, and their mine far from any flag named nobody and fired
// under a motionless body). Which flag confers it (own, squad's, anybody's) was not measured, which is
// why the rule here stays the plugin's own own-or-squad test.

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
  message: 'Arming a mine outside your own or your squad\'s flag area is not allowed. Enjoy your own trap.',
  warnMessage: 'Warning: arm mines only inside your own or your squad\'s flag area. The next one takes you with it.',
  // The same two lines per player language (code -> text). Empty means every player reads the text
  // above, or, while that is still the shipped English, the plugin's own translation of it.
  messageI18n: {},
  warnMessageI18n: {},
  // ── the mines a fallen flag leaves behind ──
  // OFF as shipped, so every config written before this existed behaves exactly as it did.
  fallenFlagCleanup: false,
  fallenFlagDelayMinutes: 10,         // a new flag in the area before this keeps the mines
  fallenFlagGraceMinutes: 120,        // how long removal keeps trying after the delay
  fallenFlagTypes: 'all',             // 'all' | 'watched' (only the watched types above)
  fallenFlagCancelBy: 'owner',        // 'owner' (the same owner or their squad) | 'any' (any new flag)
  fallenFlagWake: true,               // ask the bridge's "Work far from players" to load an empty area
  fallenFlagAlert: true,              // an owner alert (Discord + panel) when mines are removed
  fallenFlagAnnounce: false,          // a line in game chat when mines are removed
  fallenFlagMessage: 'The mines left in a fallen flag\'s area have been removed.',
  fallenFlagMessageI18n: {},
  // ── 1.10.0 ──
  // The punishment on its own switch, so an owner can run only the clean-up. `enabled` stays the
  // master switch for the whole plugin, exactly as before.
  punishEnabled: true,
  // ── mines that sit inside NO standing flag area (whatever the reason: the flag fell before this
  // plugin ever saw it, the base was wiped, the mine was armed outside every flag) ──
  // OFF as shipped, like the fallen-flag switch: it removes things from the world.
  orphanCleanup: false,
  orphanTypes: 'watched',             // 'watched' | 'all'
  orphanGraceMinutes: 60,             // how long a mine must be outside every flag before it goes
  orphanOfflineOnly: true,            // never while its placer is online (an unknown placer is not online)
  orphanAlert: true,
  orphanAnnounce: false,
  orphanMessage: 'Mines left outside every flag area have been removed.',
  orphanMessageI18n: {},
  // How long an orphan or manual removal keeps trying (the area has to be loaded to remove a mine).
  removeTryMinutes: 120,
  // Mines the owner chose to keep: never removed by the orphan clean-up.
  keepMineIds: [],
};
// Channels a targeted DM can be delivered to for one player.
const CHANNELS = ['local', 'global', 'squad', 'admin', 'server'];

// Accept older stored configs: `classes` (class-name prefixes) → `watchedTypes`; `warnFirst` bool →
// `warningsBeforeAction`. Always returns a clean, validated config.
function normalizeConfig(raw) {
  const c = Object.assign({}, DEFAULTS, raw || {});
  const r = (raw && typeof raw === 'object') ? raw : {};
  // ⚠ WHICH LIST THE OWNER WROTE IS A QUESTION ABOUT `raw`, NEVER ABOUT `c`. The merge above has
  // already put the shipped eight under `c.watchedTypes`, so asking `c` cannot tell a config that
  // named NO types from one that named none at all — and it cost two things at once.
  //
  // The types picker ships a "Clear" button, so `[]` is an owner who chose to watch NOTHING. Handed
  // the eight back, the plugin went on teleporting players onto their own mines for every type
  // while that owner's own screen read "Watched 0": a punishment they switched off, running on a
  // live server, with the panel and the plugin giving two different answers and nothing reporting
  // it. Key presence, never truthiness — the same rule as every other list here.
  //
  // And it made the `classes` migration DEAD CODE for exactly the configs it exists for: DEFAULTS
  // always supplies an array, so `!Array.isArray(c.watchedTypes)` was false whenever `watchedTypes`
  // was absent, which is what an old `classes`-only config looks like. Upgrading silently replaced
  // the owner's chosen subset with all eight.
  if (Array.isArray(r.watchedTypes)) {
    c.watchedTypes = r.watchedTypes;
  } else if (Array.isArray(r.classes)) {
    const picked = new Set();
    for (const pref of r.classes) {
      const p = String(pref || '');
      for (const t of TRAP_CATALOG) if (t.type === p || t.type.indexOf(p) === 0 || t.code.indexOf(p) === 0) picked.add(t.type);
    }
    c.watchedTypes = picked.size ? [...picked] : DEFAULT_TYPES.slice();
  } else {
    c.watchedTypes = DEFAULT_TYPES.slice();
  }
  if (raw && raw.warnFirst != null && raw.warningsBeforeAction == null) c.warningsBeforeAction = raw.warnFirst ? 1 : 0;
  // A list that NAMED types and lost all of them to the filter is a config this build cannot read —
  // a type renamed under an owner — which is not the same as an empty one and is the only case the
  // old fallback was really for. An empty list stays empty.
  const named = c.watchedTypes.length;
  c.watchedTypes = c.watchedTypes.map(String).filter((t) => KNOWN_TYPES.has(t));
  if (named && !c.watchedTypes.length) c.watchedTypes = DEFAULT_TYPES.slice();
  // `Number(x) || 6` turns a deliberate 0 into 6, because 0 is falsy — so an owner asking for the
  // fastest scan silently got the slowest default instead of the 2s floor this line already means
  // to give them. Validate explicitly, the same way the joinDelaySeconds bug elsewhere was fixed.
  c.pollSeconds = Math.max(2, Math.min(120, Number.isFinite(Number(c.pollSeconds)) ? Number(c.pollSeconds) : 6));
  c.marginMeters = Math.max(0, Number(c.marginMeters) || 0);
  // An unreadable value falls back to the DEFAULT, never to 0: `parseInt('x') || 0` read garbage as
  // "act at once", which is the harshest setting there is.
  const warnN = parseInt(c.warningsBeforeAction, 10);
  c.warningsBeforeAction = Math.max(0, Math.min(10, Number.isFinite(warnN) ? warnN : DEFAULTS.warningsBeforeAction));
  c.action = c.action === 'warn' ? 'warn' : 'teleport_to_mine';
  c.enabled = c.enabled !== false;
  c.requireOnline = c.requireOnline !== false;
  c.exemptSteamIds = (Array.isArray(c.exemptSteamIds) ? c.exemptSteamIds : []).map((s) => String(s).trim()).filter(Boolean);
  c.channel = CHANNELS.indexOf(c.channel) >= 0 ? c.channel : 'local';
  c.message = String(c.message || DEFAULTS.message);
  c.warnMessage = String(c.warnMessage || DEFAULTS.warnMessage);
  c.messageI18n = cleanI18n(r.messageI18n);
  c.warnMessageI18n = cleanI18n(r.warnMessageI18n);
  // Fallen flags. Only an explicit `true` switches removal on: it is irreversible, and a config that
  // never named the key is an owner who never chose it. Numbers are validated, never `|| default`,
  // and an unreadable one falls back to the DEFAULT rather than to a bound.
  c.fallenFlagCleanup = r.fallenFlagCleanup === true;
  c.fallenFlagDelayMinutes = boundedNumber(r.fallenFlagDelayMinutes, 1, 1440, DEFAULTS.fallenFlagDelayMinutes);
  c.fallenFlagGraceMinutes = boundedNumber(r.fallenFlagGraceMinutes, 5, 10080, DEFAULTS.fallenFlagGraceMinutes);
  c.fallenFlagTypes = c.fallenFlagTypes === 'watched' ? 'watched' : 'all';
  c.fallenFlagCancelBy = c.fallenFlagCancelBy === 'any' ? 'any' : 'owner';
  c.fallenFlagWake = c.fallenFlagWake !== false;
  c.fallenFlagAlert = c.fallenFlagAlert !== false;
  c.fallenFlagAnnounce = c.fallenFlagAnnounce === true;
  c.fallenFlagMessage = String(c.fallenFlagMessage || DEFAULTS.fallenFlagMessage);
  c.fallenFlagMessageI18n = cleanI18n(r.fallenFlagMessageI18n);
  c.punishEnabled = c.punishEnabled !== false;
  // Orphans. The same rule as the fallen flags: only an explicit `true` removes anything.
  c.orphanCleanup = r.orphanCleanup === true;
  c.orphanTypes = c.orphanTypes === 'all' ? 'all' : 'watched';
  c.orphanGraceMinutes = boundedNumber(r.orphanGraceMinutes, 1, 10080, DEFAULTS.orphanGraceMinutes);
  c.orphanOfflineOnly = c.orphanOfflineOnly !== false;
  c.orphanAlert = c.orphanAlert !== false;
  c.orphanAnnounce = c.orphanAnnounce === true;
  c.orphanMessage = String(c.orphanMessage || DEFAULTS.orphanMessage);
  c.orphanMessageI18n = cleanI18n(r.orphanMessageI18n);
  c.removeTryMinutes = boundedNumber(r.removeTryMinutes, 5, 10080, DEFAULTS.removeTryMinutes);
  c.keepMineIds = [...new Set((Array.isArray(r.keepMineIds) ? r.keepMineIds : [])
    .map((s) => String(s).trim()).filter((s) => /^[\w-]{1,40}$/.test(s)))].slice(0, 5000);
  return c;
}

/** A number inside [min, max], or `dflt` when the value is not a number at all. */
function boundedNumber(v, min, max, dflt) {
  const n = (v === null || v === undefined || v === '') ? NaN : Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : dflt;
}

/** A per-language map as it is stored: a language code to a text that is not blank. */
function cleanI18n(m) {
  const out = {};
  if (!m || typeof m !== 'object' || Array.isArray(m)) return out;
  for (const k of Object.keys(m)) {
    const code = String(k).toLowerCase();
    if (/^[a-z]{2}(?:-[a-z]{2})?$/.test(code) && typeof m[k] === 'string' && m[k].trim()) out[code] = m[k];
  }
  return out;
}

/**
 * A caller's body laid over what is already STORED, one level deep.
 *
 * ⚠ **A SETTING NOBODY SENT IS NOT A SETTING TO RESET.** `normalizeConfig` builds from DEFAULTS,
 * which is what makes reading an older version's config safe — and it means a body naming ONE key
 * replaces every other setting with the shipped default. An owner's exemption list, their watched
 * types, their warning text and their scan interval, gone on a partial save that answers `ok`. The
 * panel POSTs the whole object so nothing has done it yet; a script or a future screen would.
 *
 * By KEY PRESENCE, never truthiness: `"exemptSteamIds": []` is an owner who cleared the list and
 * must stay cleared; an absent key has never been sent. An ARRAY replaces rather than merging.
 */
function overlayConfig(stored, body) {
  const out = Object.assign({}, (stored && typeof stored === 'object') ? stored : {});
  if (!body || typeof body !== 'object') return out;
  for (const k of Object.keys(body)) {
    const b = body[k]; const cur = out[k];
    // A per-language map is sent WHOLE and replaces what is stored: merged, a language the owner
    // cleared would come back from the stored copy.
    if (/I18n$/.test(k)) out[k] = b;
    else if (b && typeof b === 'object' && !Array.isArray(b)
        && cur && typeof cur === 'object' && !Array.isArray(cur)) out[k] = Object.assign({}, cur, b);
    else out[k] = b;
  }
  return out;
}

/**
 * Does one row of the Mines screen match its filters?
 *
 * ⚠ THE SCREEN HAS A COPY OF THIS, and the two must agree: "Remove all matching" names a count that
 * the screen worked out, and the backend works the match out again at the press. A difference
 * between the two is a refusal ("the list changed"), never a different removal from the one the
 * admin confirmed. Every unknown matches nothing: a mine whose flag could not be told is neither
 * inside nor outside one, and a mine with no recorded age is not "older than" anything.
 */
function mineMatches(r, f, now) {
  f = f || {};
  if (f.type === '*watched') { if (!r.watched) return false; }
  else if (f.type && r.type !== f.type) return false;
  if (f.placer === '*unknown') { if (r.placerSteamId) return false; }
  else if (f.placer && r.placerSteamId !== f.placer) return false;
  if (f.flag === 'inside' && r.insideFlag !== true) return false;
  if (f.flag === 'outside' && r.insideFlag !== false) return false;
  if (f.flag === 'unknown' && r.insideFlag !== null && r.insideFlag !== undefined) return false;
  if (f.armed === 'armed' && r.armed !== true) return false;
  if (f.armed === 'disarmed' && r.armed !== false) return false;
  if (f.armed === 'unknown' && r.armed !== null && r.armed !== undefined) return false;
  if (f.sector && r.sector !== f.sector) return false;
  const days = Number(f.age) || 0;
  if (days > 0 && !(Number.isFinite(r.lastTouched) && now - r.lastTouched >= days * 86400000)) return false;
  const q = String(f.q || '').trim().toLowerCase();
  if (q && mineSearchText(r).toLowerCase().indexOf(q) < 0) return false;
  return true;
}
function mineSearchText(r) { return [r.id, r.name, r.type, r.placerName, r.placerSteamId, r.sector].join(' '); }

module.exports = {
  async register(host) {
    // ── what the offender reads, in their own language ──────────────────────────────────────
    // A player picks their language with /lang in game, on the Field Console or on Discord; the
    // manager delivers each one the variant written for it, else the text in the server's language.
    // While a text is still the shipped English and no language has been written, the plugin's own
    // translation goes out instead, so a fresh install already speaks every language. A manager
    // without `host.i18n` gets the plain text, exactly as before.
    function shippedText(field, lang) {
      if (!host.i18n) return null;
      if (field === 'warnMessage') return host.i18n.t('pl.mine-protection.default.warnMessage', 'Warning: arm mines only inside your own or your squad\'s flag area. The next one takes you with it.', lang);
      if (field === 'fallenFlagMessage') return host.i18n.t('pl.mine-protection.default.fallenFlagMessage', 'The mines left in a fallen flag\'s area have been removed.', lang);
      if (field === 'orphanMessage') return host.i18n.t('pl.mine-protection.default.orphanMessage', 'Mines left outside every flag area have been removed.', lang);
      return host.i18n.t('pl.mine-protection.default.message', 'Arming a mine outside your own or your squad\'s flag area is not allowed. Enjoy your own trap.', lang);
    }
    // Per language: the owner's own line, else the plugin's translation while the text is still the
    // shipped one, else the owner's text. A language the owner left empty keeps its built-in line
    // even when another language has one, which is what the language editor shows for that tab.
    function playerText(c, field) {
      const value = String(c[field] || DEFAULTS[field]);
      const map = cleanI18n(c[field + 'I18n']);
      if (!host.i18n) return { text: value, i18n: map };
      const shipped = value === DEFAULTS[field];
      const srv = host.i18n.serverLang();
      const i18n = {};
      for (const l of host.i18n.languages()) {
        if (!l || !l.code || l.code === srv) continue;
        i18n[l.code] = map[l.code] || (shipped ? shippedText(field, l.code) : value);
      }
      return { text: shipped ? shippedText(field, srv) : value, i18n };
    }
    /** The shipped lines in every player language, for the language editor's built-in text. */
    function textDefaults() {
      const fields = ['message', 'warnMessage', 'fallenFlagMessage', 'orphanMessage'];
      const english = {};
      for (const f of fields) english[f] = DEFAULTS[f];
      const byLang = {};
      if (host.i18n && typeof host.i18n.languages === 'function') {
        for (const l of host.i18n.languages()) {
          if (!l || !l.code) continue;
          byLang[l.code] = {};
          for (const f of fields) byLang[l.code][f] = shippedText(f, l.code);
        }
      }
      return { english, byLang };
    }

    // The config is held in memory. The heartbeat below runs every second, and reading it from the
    // store there parsed the plugin's whole store file once a second, enabled or not. It is re-read
    // after every save and once a minute, so a store that could not be read at boot (and answered
    // the defaults) still recovers on its own, exactly as the per-second read did.
    //
    // ⚠ A config this plugin has read before and now cannot is NOT "no config". The host answers
    // nothing for a store file that exists and could not be read (an antivirus hold, a half-written
    // file), and read as the defaults that switched both clean-ups off for a minute: the fallen-flag
    // timers were dropped and their flags learned again, so a flag that fell in that minute was
    // never seen to fall. The last config read stays in force until the store answers again.
    const CONFIG_REREAD_MS = 60000;
    let configStored = host.store.get('config', undefined);
    let configNow = normalizeConfig(configStored || {});
    let configReadAt = Date.now();
    let configLostSaid = false;
    const reloadConfig = () => {
      const raw = host.store.get('config', undefined);
      configReadAt = Date.now();
      if (raw === undefined && configStored !== undefined) {
        if (!configLostSaid) { configLostSaid = true; host.logger.warn('the stored settings could not be read; the ones read before stay in force'); }
        return configNow;
      }
      configLostSaid = false;
      configStored = raw;
      configNow = normalizeConfig(raw || {});
      return configNow;
    };
    const cfg = () => (Date.now() - configReadAt >= CONFIG_REREAD_MS ? reloadConfig() : configNow);

    // The plugin leans on two shared manager facilities; without them it ENFORCES nothing rather than
    // guess (and risk punishing legal mines): the flag-area test and the canonical world scan.
    //
    // ⚠ Only the scan stands down. This used to `return` here, before a single route was mounted, so
    // on such a manager the whole tab 404'd and the owner's screen said "sign in again" instead of
    // why nothing happens. The routes are mounted regardless and `/status` says `idle`.
    const mapOk = !!(host.map && typeof host.map.isInOwnerArea === 'function' && typeof host.map.world === 'function');
    if (!mapOk) host.logger.error('Mine Protection needs a newer manager (host.map.world + isInOwnerArea) — it enforces nothing until then.');

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
    // Who the bridge has seen join and not yet leave. The saved online list trails a real join by up
    // to a save, so "the save lists nobody" alone is not "nobody is here" — a player the bridge
    // announced a moment ago is HERE. A leave that never arrives only keeps them counted until the
    // save says otherwise, and a warning or teleport to somebody who is not there is not delivered,
    // so the mine simply stays unhandled.
    const liveHere = new Set();
    const sidOf = (p) => String((p && (p.steamId || p.steamid || p.SteamID || p.steam_id)) || '');
    // Online = the saved list PLUS the bridge's join announcements. Reading only the save was why a
    // returning offender — "dealt with the moment they reconnect" — waited for the next save instead.
    const onlineSet = () => {
      let out;
      try { out = new Set((host.players.online() || []).map(sidOf).filter(Boolean)); }
      catch (e) { out = new Set(); }
      for (const s of liveHere) out.add(s);
      return out;
    };
    const typeMeta = (type) => TRAP_CATALOG.find((t) => t.type === type) || null;
    // The catalogue's item code for a placed trap: the one name/icon lookup that resolves (C4 folds
    // several classes into `C4`, and `C4_ES` is not an item — `C4_Pack_ES` is).
    const codeOf = (t) => (t && typeMeta(t.type) ? typeMeta(t.type).code : (t && t.code) || null);
    const displayName = (t) => t.name || host.items.name(codeOf(t) || String(t.type || 'mine'));

    // The manager's canonical world scan is the single source of truth for "is the game DB readable
    // right now". getMapData() returns null ONLY when the SCUM.db handle is unavailable (server
    // stopped / mid-restart / file missing) — NOT tied to a possibly-stale process check. So we gate on
    // this directly instead of host.server.isRunning() (which was wrongly reporting "offline").
    function worldTraps() {
      if (!mapOk) return null;
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
    // switch is named here — by the label the panel actually shows, not by the config key. The label
    // travels as its own field and the panel builds the route in front of it out of its own nav keys.
    const SWITCH = {
      traps: "Read live inventories",
      squads: "Read live squads, and allow the changes below",
    };
    function noteLive(key, q) {
      const code = (q && q.code) || 'bridge_off';
      let text;
      if (code === 'refused') text = (q && q.reason) || null;
      else if (code === 'module_off') text = `the in-game module is switched off — turn on '${SWITCH[key]}'`;
      else if (code === 'no_module') text = 'this server runs an older SSA Bridge that does not have this module';
      else text = 'the SSA Bridge did not answer';
      liveNote[key] = { code, text, at: Date.now(), switch: code === 'module_off' ? SWITCH[key] : undefined };
      // `bridge_off` is the ordinary state on a server without the bridge running and deserves
      // silence; the other three are one switch or one update away and deserve saying — once an
      // hour, because this sits inside a scan that runs every few seconds.
      if (code === 'bridge_off' || !text) return;
      if (Date.now() - liveSaid[key] < 3600000) return;
      liveSaid[key] = Date.now();
      host.logger.warn(`the live ${key === 'traps' ? 'armed-state' : 'squad'} check could not run: ${text}. Mine Protection uses the last save meanwhile.`);
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
          const r = await host.chat.dm(steamId, host.i18n ? playerText(c, 'warnMessage') : (c.warnMessage || DEFAULTS.warnMessage), { channel: c.channel });
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
          if (ok) { try { await host.chat.dm(steamId, host.i18n ? playerText(c, 'message') : (c.message || DEFAULTS.message), { channel: c.channel }); } catch (e) { /* message optional */ } }
        }
      } catch (e) { host.logger.warn('penalty failed: ' + e.message); ok = false; }
      if (!ok) return false;

      offenses[steamId] = count + 1; persistOffenses();
      const action = warnOnly ? 'warn' : 'teleport';
      pushRecent({ at: Date.now(), player: placer.name || null, steamId, mine: name, type: mine.type, code: codeOf(mine), action, loc: { x: Math.round(mine.x), y: Math.round(mine.y), z: Math.round(mine.z) } });
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
      // Nothing is done while the database cannot answer; every scan re-checks, so it recovers alone.
      host.logger.warn(`could not check whether ${placer.name || placer.steamId}'s ${displayName(mine)} is inside their flag: game database unreadable. Skipped until it answers.`);
    }

    async function poll() {
      const c = cfg();
      if (!c.enabled || !c.punishEnabled) return;

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
        // Offline → retry when they return. Asked BEFORE anything else is: a placer who is not here
        // can be neither warned nor moved, so neither the flag test nor the live squad read below
        // buys anything for them — and both were paid again on every scan, per offline placer, for
        // as long as they stayed away.
        if (c.requireOnline && online && !online.has(placer.steamId)) continue;
        // THREE answers, not two. `null` means the manager could not say — the game database was
        // unreadable, or that player is not resolvable in it yet — and it must never be read as
        // "outside their flag", because the next line teleports them onto an armed mine.
        //
        // The mine comes from the memoized world scan and this answer from a separate SCUM.db query,
        // so one being available says nothing about the other. Treated as false, a database hiccup killed a player
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

    // ── the mines a FALLEN FLAG leaves behind ───────────────────────────────────────────────────────
    //
    // A player can arm mines inside their own flag area, lose the flag (destroyed by a raid, taken
    // down, decayed) and the mines stay: armed, ownerless, firing for anybody. When the owner switches
    // `fallenFlagCleanup` on, a flag that disappears starts a timer; if no new flag stands in the
    // ORIGINAL area when it runs out, every placed mine inside that area is removed.
    //
    // ── how each half is known ──────────────────────────────────────────────────────────────────
    //
    //   • A FLAG FALLING is a flag the world scan listed and no longer lists. `host.map.world().bases`
    //     is the save's base layer, which drops a base whose flag element is gone (the `base` row
    //     itself outlives its flag: `check-base-flag`), and before the next autosave it also drops one
    //     the game has logged `[Flag] Destroyed` for. No bridge read reports whether a base still has
    //     a flag, so this is the only reading there is. The flags last seen are kept in the store, so a
    //     flag that falls while the manager is down is seen at the first scan after it comes back.
    //   • THE AREA is the square the flag stood for: its element's position and the scan's own
    //     offsets (a fixed 100 x 100 m, `FLAG_HALF_CM` in the manager), copied when the flag was last
    //     seen and kept with the timer, because the flag is exactly what is gone.
    //   • A NEW FLAG IN THE AREA is any flag in the scan whose position is inside that square. By
    //     default only the same owner or a member of their squad keeps the mines: a raider who builds
    //     their own flag on the ruins is the case this exists for, and letting their flag cancel the
    //     removal would leave the old owner's mines live inside the raider's base. `fallenFlagCancelBy:
    //     'any'` makes every new flag keep them. The same flag id coming back (a save rolled back)
    //     always keeps them.
    //
    // ── removing, and why nothing is claimed that was not seen ──────────────────────────────────
    //
    // The targets are the placed mines the SAVE holds inside the square (armed or not, of every type
    // or only the watched ones). Each one is removed with the bridge's `items destroy:eid:<id>`, the
    // one verb that names a placed trap by its entity id, and only once the running game has it
    // loaded: a trap far from every player is not an actor at all (`items traps` says so in its own
    // scope note). With nobody near, the bridge's "Work far from players" visitor can load the area,
    // when the owner has that module on.
    //
    // A destroy of a deployable is confirmed on a LATER frame (2.4-3.3 s measured), so the call's
    // answer is never the verdict. A mine counts as removed on positive evidence only: the module's
    // own confirmed-destroy counter moving past what it read before the call, the live row reporting
    // `destroyed`, or a later save no longer holding the entity. A refusal is logged in the module's
    // own words and the mine is tried again on a later pass, until the delay plus the grace runs out;
    // whatever is still standing then is reported as left, never as removed.
    const FF_HALF_CM = 5000;               // the flag square's half side, the manager's FLAG_HALF_CM
    const FF_TICK_MS = 15000;              // how often flags are compared while nothing is in flight
    const FF_RETRY_MS = 30000;             // a pass that could not act looks again after this
    const FF_CONFIRM_MS = 4000;            // the bridge confirms a deployable's destroy within ~3.3 s
    const FF_PENDING_MAX_MS = 20000;       // ...and gives up its own re-check well before this
    const FF_RESEND_MS = 30000;            // a mine still standing this long after a destroy is tried again
    const FF_SAVE_SETTLE_MS = 15 * 60000;  // a mine that vanished from the live list waits this long for a save
    const FF_WAKE_SETTLE_MS = 20000;       // a placed visitor nudges and loads its reach in about 15 s
    const FF_MAX_TRIES = 5;                // destroy calls per mine before it is reported as failed
    const FF_KEEP_DONE = 30;               // finished areas kept for the panel
    const FF_SAY_EVERY_MS = 10 * 60000;    // the same reason is logged again at most this often
    const FF_LIVE_STATES = new Set(['waiting', 'removing']);
    // The labels the bridge panel shows for the switches a refusal can point at.
    const FF_SWITCH = { items: 'Read live inventories', wake: 'Work far from players' };

    let ffSeeded = host.store.get('ffSeeded', false) === true;
    let ffFlags = (() => { const f = host.store.get('ffFlags', {}); return (f && typeof f === 'object' && !Array.isArray(f)) ? f : {}; })();
    let ffAreas = (() => { const a = host.store.get('ffAreas', []); return Array.isArray(a) ? a.filter((x) => x && typeof x === 'object') : []; })();
    let ffFlagsSig = Object.keys(ffFlags).sort().join(',');
    let ffDirty = false;
    let ffBusy = false, ffNextRun = 0;

    // ── 1.10.0: one removal engine, three kinds of job ──────────────────────────────────────────
    //
    // A fallen flag's area is one kind of removal job. Two more run through the SAME passes below,
    // so a mine is listed, destroyed, confirmed and logged one way whoever asked for it:
    //
    //   • `orphan`: mines that sit inside NO standing flag area, found by `orScan()`. That is the case
    //     the fallen-flag timer can never reach, because it only knows flags it saw standing: a flag
    //     that fell before this plugin first looked, a base wiped with its owner, a mine armed outside
    //     every flag. Measured on the dev save: 26 armed mines of one deleted profile (23 improvised
    //     mines and 3 cartridge traps) where no base stands any more, already there in every backup
    //     taken before the fallen-flag switch first ran.
    //   • `manual`: mines an admin picked on the Mines screen, or a "Remove now" press.
    //
    // A job covers one square the size of a flag's (`RM_CELL_CM`), so the bridge's visitor reaches it
    // the same way it reaches a flag. Only ONE job holds the visitor at a time (`wakeHolder`): the
    // bridge keeps a small pool of them, and ten clusters asking at once would each get half a nudge.
    const RM_CELL_CM = 2 * FF_HALF_CM;
    const RM_KEEP_DONE = 30;               // finished jobs kept for the panel
    const RM_LOG_MAX = 300;                // one row per removed mine, newest first
    const OR_SCAN_MS = 60000;              // how often the world is searched for mines outside every flag
    const OR_MAX_LIVE = 4;                 // orphan jobs running at once; the rest wait for the next scan
    let rmJobs = (() => { const a = host.store.get('rmJobs', []); return Array.isArray(a) ? a.filter((x) => x && typeof x === 'object' && x.mines) : []; })();
    let removals = (() => { const a = host.store.get('removals', []); return Array.isArray(a) ? a.filter((x) => x && typeof x === 'object').slice(0, RM_LOG_MAX) : []; })();
    let orphans = (() => { const o = host.store.get('orphans', {}); return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; })();
    let rmDirty = false, logDirty = false, orDirty = false;
    let rmSeq = 0, orNextScan = 0, wakeHolder = null;

    function ffPersist() {
      const sig = Object.keys(ffFlags).sort().join(',');
      try {
        if (sig !== ffFlagsSig) { ffFlagsSig = sig; host.store.set('ffFlags', ffFlags); }
        if (ffDirty) {
          ffDirty = false;
          const live = ffAreas.filter((a) => FF_LIVE_STATES.has(a.state));
          const done = ffAreas.filter((a) => !FF_LIVE_STATES.has(a.state)).slice(0, FF_KEEP_DONE);
          ffAreas = live.concat(done);
          host.store.set('ffAreas', ffAreas);
          rmDirty = true;                  // a job's mine moved too: the same flag covers both lists
        }
        if (rmDirty) {
          rmDirty = false;
          const live = rmJobs.filter((a) => FF_LIVE_STATES.has(a.state));
          const done = rmJobs.filter((a) => !FF_LIVE_STATES.has(a.state)).slice(0, RM_KEEP_DONE);
          rmJobs = live.concat(done);
          if (rmJobs.length || host.store.get('rmJobs', null) !== null) host.store.set('rmJobs', rmJobs);
        }
        if (logDirty) { logDirty = false; removals = removals.slice(0, RM_LOG_MAX); host.store.set('removals', removals); }
        if (orDirty) { orDirty = false; host.store.set('orphans', orphans); }
      } catch (e) { /* the store logs its own refusal */ }
    }

    /**
     * Every flag the world scan lists now, or null when that cannot be told.
     *
     * Each layer of the scan is caught on its own, so a base query that failed arrives as an EMPTY
     * list rather than as an error. Read as "every flag fell", that would start a timer on every base
     * on the server. So an empty list is believed only when the save itself says it holds no flag.
     */
    function ffScan() {
      if (!mapOk) return null;
      let w;
      try { w = host.map.world(); } catch (e) { return null; }
      if (!w || !Array.isArray(w.bases)) return null;
      if (!w.bases.length) {
        let r = null;
        try { r = host.db.scum.get("SELECT COUNT(*) AS n FROM base_element WHERE asset LIKE '%BP_Base_Flag%'"); } catch (e) { r = null; }
        if (!r || Number(r.n) !== 0) return null;
      }
      const flags = {};
      for (const b of w.bases) {
        const x = Number(b && b.x), y = Number(b && b.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const key = (b.flagId !== null && b.flagId !== undefined) ? `f${b.flagId}` : `b${b.id}`;
        const off = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
        flags[key] = {
          flagId: (b.flagId !== null && b.flagId !== undefined) ? Number(b.flagId) : null,
          baseId: (b.id !== null && b.id !== undefined) ? Number(b.id) : null,
          name: b.name || null, x: Math.round(x), y: Math.round(y), z: Math.round(off(b.z, 0)),
          minX: off(b.minX, -FF_HALF_CM), maxX: off(b.maxX, FF_HALF_CM), minY: off(b.minY, -FF_HALF_CM), maxY: off(b.maxY, FF_HALF_CM),
          ownerId: Number(b.ownerId) > 0 ? Number(b.ownerId) : null, owner: b.owner || null,
          squadId: (b.squadId !== null && b.squadId !== undefined) ? b.squadId : null,
        };
      }
      return { flags, traps: Array.isArray(w.traps) ? w.traps : null };
    }

    const ffIn = (a, x, y) => Number.isFinite(x) && Number.isFinite(y)
      && x >= a.x + a.minX && x <= a.x + a.maxX && y >= a.y + a.minY && y <= a.y + a.maxY;
    const ffLabel = (a) => `${a.flagId !== null && a.flagId !== undefined ? `#${a.flagId}` : `of base ${a.baseId}`}`
      + `${a.owner ? ` (${a.owner})` : ''}${a.sector ? ` in ${a.sector}` : ''}`;
    const ffCount = (a, st) => Object.values(a.mines || {}).filter((m) => m.state === st).length;
    // What a job is called in the log and the alert. A fallen-flag area keeps its 1.9 wording.
    const jobLabel = (a) => (a.kind === 'orphan'
      ? `mines outside every flag${a.sector ? ` in ${a.sector}` : ` near ${Math.round(a.x)}, ${Math.round(a.y)}`}`
      : a.kind === 'manual'
        ? `removal asked for by an admin${a.label ? ` (${a.label})` : ''}${a.sector ? ` in ${a.sector}` : ''}`
        : `fallen flag ${ffLabel(a)}`);
    const isJob = (a) => a && (a.kind === 'orphan' || a.kind === 'manual');
    const liveWork = () => ffAreas.filter((a) => FF_LIVE_STATES.has(a.state)).concat(rmJobs.filter((a) => FF_LIVE_STATES.has(a.state)));
    /** Every mine a live job or area is working on, so nothing is queued twice. */
    function idsInLiveWork() {
      const out = new Set();
      for (const a of liveWork()) for (const id of Object.keys(a.mines || {})) {
        const st = a.mines[id] && a.mines[id].state;
        if (st === 'pending' || st === 'sent') out.add(String(id));
      }
      return out;
    }

    /**
     * One mine the game confirmed gone: counted, logged on its own line, and kept for Activity.
     * `by` says which evidence answered: the bridge's own confirmation, or a later save without it.
     */
    function markRemoved(a, id, m, by) {
      if (!m || m.state === 'removed') return;
      m.state = 'removed'; m.by = by; ffDirty = true;
      const code = m.code || (m.type && typeMeta(m.type) ? typeMeta(m.type).code : null);
      let name = m.type || 'mine';
      try { name = host.items.name(code || String(m.type || 'mine')) || name; } catch (e) { /* the type stands in */ }
      removals.unshift({ at: Date.now(), id: String(id), type: m.type || null, code, name,
        x: m.x, y: m.y, z: m.z, kind: a.kind || 'fallen', job: a.id, label: jobLabel(a), by,
        ownerId: m.ownerId || null });
      if (removals.length > RM_LOG_MAX) removals.length = RM_LOG_MAX;
      logDirty = true;
      host.logger.info(`removed ${name} #${id} at ${Math.round(m.x)}, ${Math.round(m.y)} (${jobLabel(a)}): confirmed by the ${by === 'save' ? 'save' : 'game'}`);
      try { host.realtime.toAdmins('mine-protection:event', { at: Date.now(), action: 'removedOne', id: String(id) }); } catch (e) { /* realtime optional */ }
    }
    // Same owner, or a member of the squad that owned the fallen flag. An owner the save could not
    // name is nobody's, so it keeps the mines only under 'any'.
    const ffSameSide = (f, a) => (f.ownerId !== null && f.ownerId === a.ownerId)
      || (f.squadId !== null && f.squadId !== undefined && a.squadId !== null && a.squadId !== undefined && String(f.squadId) === String(a.squadId));

    /** Say why a pass could not act, once per reason, and keep it for the panel. */
    function ffNote(a, text) {
      const now = Date.now();
      if (a.note !== text) ffDirty = true;
      a.note = text;
      if (a.said === text && now - (a.saidAt || 0) < FF_SAY_EVERY_MS) return;
      a.said = text; a.saidAt = now;
      host.logger.warn(`${jobLabel(a)}: ${text}. Trying again.`);
    }

    /**
     * The two bridge switches every removal stands on, read off the module cards, or null.
     *
     * ⚠ "Destroy an item" ships OFF, and on 1.9.0 every destroy it refused was counted as one of the
     * mine's five tries: about two and a half minutes after the delay ran out the mine was marked
     * failed for good, and switching it on afterwards removed nothing. A switch that is off is not
     * the mine's fault, so it is read FIRST, nothing is sent while it is off, and no try is spent.
     * `null` (no bridge, an older bridge with no module list) leaves the destroy to say it itself.
     */
    let swCache = null, swAt = 0;
    async function bridgeSwitches(now) {
      if (swAt && now - swAt < 30000) return swCache;
      if (!host.bridge || typeof host.bridge.modules !== 'function') return null;
      let list = null;
      try { list = await host.bridge.modules(); } catch (e) { list = null; }
      swAt = now;
      if (!Array.isArray(list) || !list.length) { swCache = null; return null; }
      const card = (id) => list.find((x) => x && String(x.id) === id) || null;
      const flag = (m, key) => {
        if (!m) return null;
        const v = (m.config && m.config[key] !== undefined) ? m.config[key] : (m.status && m.status[key] !== undefined ? m.status[key] : undefined);
        if (v === undefined || v === null) return null;
        return v === true || v === 'true';
      };
      const items = card('items'), wake = card('wake');
      swCache = {
        items: items ? !!items.enabled : null,
        destroy: items ? flag(items, 'destroy') : null,
        wake: wake ? !!wake.enabled : null,
      };
      return swCache;
    }

    /** A bridge failure in the module's own words, or the switch an owner has to find. */
    function ffWhy(mod, q) {
      const code = (q && q.code) || 'bridge_off';
      if (code === 'refused') return (q && q.reason) || `the bridge's ${mod} module refused without a reason`;
      if (code === 'module_off') {
        const off = q && q.switchTo && Array.isArray(q.switchTo.off) && q.switchTo.off[0];
        return `turn on '${(off && off.label) || FF_SWITCH[mod] || mod}' in the SSA Bridge`;
      }
      if (code === 'no_module') return `this server's SSA Bridge has no '${mod}' module`;
      return 'the SSA Bridge did not answer';
    }

    function ffTypeOk(c) {
      if (c.fallenFlagTypes !== 'watched') return () => true;
      const watch = new Set(c.watchedTypes);
      return (t) => watch.has(t && t.type);
    }

    /** Does the save still hold this entity as a placed item? `null` when the save cannot answer. */
    function ffStillPlaced(id) {
      let r = null;
      try { r = host.db.scum.get('SELECT COUNT(*) AS n FROM entity WHERE id = ? AND owning_entity_id IS NULL', Number(id)); } catch (e) { r = null; }
      if (!r || !Number.isFinite(Number(r.n))) return null;
      return Number(r.n) > 0;
    }

    /** The live row for one saved mine: by entity id, else the nearest within 1.5 m. */
    function ffLiveRow(live, id, m) {
      let best = null, bestD = Infinity;
      for (const t of live) {
        if (t && t.entityLo !== undefined && t.entityLo !== null) { if (String(t.entityLo) === String(id)) return t; continue; }
        const d = Math.hypot(Number(t && t.x) - m.x, Number(t && t.y) - m.y);
        if (Number.isFinite(d) && d < bestD) { bestD = d; best = t; }
      }
      return (best && bestD <= TRAP_MATCH_CM) ? best : null;
    }

    /** The module's count of confirmed destroys, or null when it could not be read. */
    async function ffDestroyedCount() {
      const q = await host.bridge.query('items', 'last');
      const n = q && q.ok && q.data ? Number(q.data.destroyed) : NaN;
      return Number.isFinite(n) ? { n, data: q.data } : null;
    }

    /** Hand the bridge's visitor back (it parks; its lease ends it anyway). Best effort. */
    async function ffReleaseWake(a) {
      if (wakeHolder === a.id) wakeHolder = null;
      if (!a.wake) return;
      const w = a.wake; a.wake = null; ffDirty = true;
      try {
        const v = await host.bridge.query('wake', 'visitors');
        const list = v && v.ok && v.data && Array.isArray(v.data.visitors) ? v.data.visitors : [];
        const mine = list.find((x) => x && x.parked !== true && Math.abs(Number(x.x) - w.x) < 1000 && Math.abs(Number(x.y) - w.y) < 1000);
        if (mine && mine.id !== undefined) await host.bridge.command('wake', `remove:${mine.id}`);
      } catch (e) { /* the lease removes it */ }
    }

    /** Ask the bridge to load an area nobody is near. True when a visitor is (now) there. */
    async function ffWake(a, c, now) {
      if (!c.fallenFlagWake) return false;
      if (a.wake && a.wake.until > now) return true;
      if (!canQuery()) return false;
      // One place at a time. Another job is using the visitor; this one waits its turn.
      if (wakeHolder && wakeHolder !== a.id && liveWork().some((x) => x.id === wakeHolder && x.wake)) {
        a.wakeWhy = 'the visitor is loading another place first';
        return false;
      }
      const v = await host.bridge.query('wake', 'visitors');
      if (!v || !v.ok) { a.wakeWhy = ffWhy('wake', v); return false; }
      const reach = Math.max(100, Math.min(7500, Number(v.data && v.data.maxBoundsCm) || 5000));
      const secs = Math.max(30, Math.min(300, Number(v.data && v.data.maxSeconds) || 300));
      const x = Math.round(a.x), y = Math.round(a.y), z = Math.round(a.z + 200);
      const r = await host.bridge.command('wake', `place:${x}:${y}:${z}:${reach}:${secs}`);
      if (!r || !r.ok) { a.wakeWhy = ffWhy('wake', r); return false; }
      a.wake = { x, y, placedAt: now, until: now + secs * 1000 };
      a.wakeWhy = null;
      wakeHolder = a.id;
      ffDirty = true;
      host.logger.info(`${jobLabel(a)}: nobody is near, so a bridge visitor is loading its area`);
      return true;
    }

    async function ffFinish(a, c, state, now) {
      const removed = ffCount(a, 'removed'), gone = ffCount(a, 'gone'), failed = ffCount(a, 'failed');
      const left = ffCount(a, 'pending') + ffCount(a, 'sent'), skipped = ffCount(a, 'skipped');
      a.state = state; a.endedAt = now; a.removed = removed; a.gone = gone; a.failed = failed; a.left = left; a.skipped = skipped;
      a.total = Object.keys(a.mines || {}).length;
      ffDirty = true;
      await ffReleaseWake(a);
      const counts = `removed ${removed} of ${a.total} mine(s), ${gone} already gone, ${failed + left} not removed${skipped ? `, ${skipped} left alone` : ''}`;
      const label = jobLabel(a);
      if (state === 'gaveup') host.logger.warn(`${label}: gave up after the grace period; ${counts}${a.note ? ` (last reason: ${a.note})` : ''}`);
      else if (failed) host.logger.warn(`${label}: ${counts}${a.note ? ` (last reason: ${a.note})` : ''}`);
      else host.logger.info(`${label}: ${counts}`);
      if (!removed) return;
      const kind = a.kind || 'fallen';
      pushRecent({ at: now, player: a.owner || null, steamId: null, mine: String(removed), type: null, code: null,
        action: kind === 'orphan' ? 'orphans' : kind === 'manual' ? 'removed' : 'cleared',
        loc: { x: a.x, y: a.y, z: a.z } });
      // Who asked decides who is told. An admin's own removal is on their screen already.
      const alert = kind === 'orphan' ? c.orphanAlert : kind === 'manual' ? false : c.fallenFlagAlert;
      const announce = kind === 'orphan' ? c.orphanAnnounce : kind === 'manual' ? false : c.fallenFlagAnnounce;
      const field = kind === 'orphan' ? 'orphanMessage' : 'fallenFlagMessage';
      if (alert) {
        const what = kind === 'orphan' ? `outside every flag${a.sector ? ` in ${a.sector}` : ''}` : `left at fallen flag ${ffLabel(a)}`;
        try { host.notify('admin.alert', { message: `Mine Protection: removed ${removed} mine(s) ${what}.`, severity: 'info' }); } catch (e) { /* alerts optional */ }
      }
      if (announce) {
        const vars = { count: removed };
        try {
          if (host.i18n) await host.chat.broadcast(playerText(c, field), { channel: 'global', vars });
          else await host.chat.broadcast(String(c[field] || DEFAULTS[field]).replace(/\{count\}/gi, String(removed)), { channel: 'global' });
        } catch (e) { host.logger.debug('the removal announcement was not sent: ' + e.message); }
      }
    }
    async function ffCancel(a, now, why) {
      const removed = ffCount(a, 'removed');
      a.state = 'kept'; a.endedAt = now; a.keptBy = why; a.removed = removed; a.total = Object.keys(a.mines || {}).length;
      ffDirty = true;
      await ffReleaseWake(a);
      host.logger.info(`fallen flag ${ffLabel(a)}: ${why}; its mines stay${removed ? ` (${removed} were already removed)` : ''}`);
    }

    /** Compare the flags now against the flags last seen: start timers, cancel them. */
    async function ffCompare(scan, c, now) {
      const flags = scan.flags;
      if (!ffSeeded) {
        // The first readable scan with the feature on only LEARNS the flags: a flag that fell before
        // the owner switched this on is not a flag this plugin watched fall.
        ffFlags = flags; ffSeeded = true;
        try { host.store.set('ffSeeded', true); } catch (e) { /* ignore */ }
        host.logger.info(`fallen-flag removal is on: watching ${Object.keys(flags).length} flag(s)`);
        return;
      }
      const delayMs = c.fallenFlagDelayMinutes * 60000;
      for (const key of Object.keys(ffFlags)) {
        if (flags[key]) continue;
        const f = ffFlags[key];
        if (ffAreas.some((a) => FF_LIVE_STATES.has(a.state) && a.key === key)) continue;
        const a = Object.assign({ id: `${key}-${now}`, key }, f, {
          fellAt: now, deadline: now + delayMs, giveUpAt: now + delayMs + c.fallenFlagGraceMinutes * 60000,
          state: 'waiting', mines: {}, sector: null,
        });
        if (typeof host.map.sector === 'function') {
          try { a.sector = (await host.map.sector(a.x, a.y)) || null; } catch (e) { a.sector = null; }
        }
        ffAreas.unshift(a); ffDirty = true;
        host.logger.info(`fallen flag ${ffLabel(a)}: its mines are removed in ${c.fallenFlagDelayMinutes} min unless a new flag is built there`);
      }
      for (const a of ffAreas) {
        if (!FF_LIVE_STATES.has(a.state)) continue;
        if (flags[a.key]) { await ffCancel(a, now, 'the flag is back'); continue; }
        for (const k of Object.keys(flags)) {
          const f = flags[k];
          if (!ffIn(a, f.x, f.y)) continue;
          if (c.fallenFlagCancelBy === 'any' || ffSameSide(f, a)) {
            await ffCancel(a, now, `a new flag${f.flagId !== null ? ` #${f.flagId}` : ''}${f.owner ? ` by ${f.owner}` : ''} stands in its area`);
            break;
          }
        }
      }
      ffFlags = flags;
    }

    /**
     * Step 1 of a pass for an orphan or manual job: its mines are named by id, so this only asks
     * what has happened to each one since the last pass.
     *
     * An orphan job asks one question more, and it is the one that may never be skipped: is the mine
     * STILL outside every flag. A flag built over it since it was queued keeps it, and a placer who
     * came online keeps it under the offline-only rule; the orphan scan queues it again later if it is
     * still an orphan then. False when the save could not say: nothing is destroyed on a guess.
     */
    function rmListed(a, scan, c) {
      if (!scan || !Array.isArray(scan.traps)) return false;
      const mines = a.mines;
      const byId = new Map();
      for (const t of scan.traps) if (t && t.id !== undefined && t.id !== null) byId.set(String(t.id), t);
      const flags = a.kind === 'orphan' ? Object.values(scan.flags || {}) : null;
      const marginCm = Math.max(0, Number(c.marginMeters) || 0) * 100;
      const online = (a.kind === 'orphan' && c.orphanOfflineOnly) ? onlineSet() : null;
      for (const id of Object.keys(mines)) {
        const m = mines[id];
        if (m.state !== 'pending' && m.state !== 'sent') continue;
        const t = byId.get(String(id));
        if (t) {
          const tx = Number(t.x), ty = Number(t.y);
          if (flags && (!Number.isFinite(tx) || !Number.isFinite(ty) || insideAnyFlag(flags, tx, ty, marginCm))) {
            if (m.state === 'pending') { m.state = 'skipped'; m.why = 'a flag stands here now'; ffDirty = true; }
            continue;
          }
          if (online && m.state === 'pending' && m.ownerId) {
            const pl = resolvePlacer(m.ownerId);
            if (pl && online.has(pl.steamId)) { m.state = 'skipped'; m.why = 'its placer is online'; ffDirty = true; }
          }
          continue;
        }
        if (ffStillPlaced(id) !== false) continue;
        if (m.state === 'sent') markRemoved(a, id, m, 'save');
        else { m.state = 'gone'; ffDirty = true; }
      }
      return true;
    }

    /** One removal pass for one area or job. */
    async function ffWork(a, c, now, scan) {
      if (a.state === 'waiting') {
        if (now < a.deadline) return;
        a.state = 'removing'; a.startedAt = now; ffDirty = true;
        host.logger.info(`fallen flag ${ffLabel(a)}: no new flag in time, removing the mines in its area`);
      }
      if (a.state !== 'removing') return;
      if (now >= a.giveUpAt) { await ffFinish(a, c, 'gaveup', now); return; }
      if (a.nextAt && now < a.nextAt) return;
      a.nextAt = now + FF_RETRY_MS;
      const mines = a.mines || (a.mines = {});

      if (isJob(a)) {
        // An orphan or manual job decides on THIS pass's reading of the save, never on an older one:
        // "is it still outside every flag" is a question about now.
        if (!rmListed(a, scan, c)) { ffNote(a, 'the game database cannot be read yet'); return; }
      } else {
      // 1. What the SAVE holds inside the square. An empty trap layer is not "no mines": each layer
      //    is caught on its own, so only a mine the save positively no longer holds changes state.
      if (scan && Array.isArray(scan.traps)) {
        const want = ffTypeOk(c);
        const inside = new Set();
        for (const t of scan.traps) {
          const tx = Number(t && t.x), ty = Number(t && t.y);
          if (!want(t) || !ffIn(a, tx, ty)) continue;
          const id = String(t.id);
          inside.add(id);
          if (!mines[id]) { mines[id] = { type: t.type || null, x: Math.round(tx), y: Math.round(ty), z: Math.round(Number(t.z) || 0), state: 'pending', tries: 0, ownerId: Number(t.ownerId) > 0 ? Number(t.ownerId) : null }; ffDirty = true; }
        }
        for (const id of Object.keys(mines)) {
          const m = mines[id];
          if (inside.has(id) || (m.state !== 'pending' && m.state !== 'sent')) continue;
          if (ffStillPlaced(id) !== false) continue;
          if (m.state === 'sent') markRemoved(a, id, m, 'save');        // ours once we had destroyed it
          else m.state = 'gone';
          ffDirty = true;
        }
        a.listed = true;
      }
      if (!a.listed) { ffNote(a, 'the game database cannot be read yet'); return; }
      }
      const open = Object.keys(mines).filter((id) => mines[id].state === 'pending' || mines[id].state === 'sent');
      if (!open.length) { await ffFinish(a, c, ffCount(a, 'failed') ? 'partial' : 'cleared', now); return; }

      // 2a. The bridge's own switches, before anything is sent (see `bridgeSwitches`).
      const sw = await bridgeSwitches(now);
      if (sw && sw.items === false) { ffNote(a, `turn on '${FF_SWITCH.items}' in the SSA Bridge`); return; }
      if (sw && sw.destroy === false) { ffNote(a, "turn on 'Destroy an item' in the SSA Bridge"); return; }

      // 2. What the RUNNING GAME has loaded. Nothing is destroyed or believed without this answer.
      if (!canQuery()) { ffNote(a, 'the SSA Bridge did not answer'); return; }
      const q = await host.bridge.query('items', 'traps');
      if (!q || !q.ok) { ffNote(a, ffWhy('items', q)); return; }
      const live = (q.data && Array.isArray(q.data.traps)) ? q.data.traps : [];

      // 3. The destroy in flight: confirmed, still pending, or still standing.
      for (const id of open) {
        const m = mines[id];
        if (m.state !== 'sent') continue;
        const row = ffLiveRow(live, id, m);
        if (row && row.destroyed === true) { markRemoved(a, id, m, 'bridge'); if (a.inflight === id) a.inflight = null; continue; }
        if (a.inflight === id) {
          if (now - m.sentAt < FF_CONFIRM_MS) { a.nextAt = m.sentAt + FF_CONFIRM_MS; return; }
          const after = await ffDestroyedCount();
          if (after && Number.isFinite(m.before) && after.n > m.before && after.data.confirmed === true) {
            markRemoved(a, id, m, 'bridge'); a.inflight = null; continue;
          }
          if (after && after.data.destroyPending === true && now - m.sentAt < FF_PENDING_MAX_MS) { a.nextAt = now + 2000; return; }
          a.inflight = null; ffDirty = true;
        }
        if (row && now - m.sentAt >= FF_RESEND_MS) { m.state = 'pending'; ffDirty = true; }        // still standing: again
        else if (!row && now - m.sentAt >= FF_SAVE_SETTLE_MS) { m.state = 'pending'; ffDirty = true; } // no save settled it
      }

      // 4. The next loaded mine, one destroy per pass so its confirmation is unambiguous.
      let unloaded = 0;
      for (const id of Object.keys(mines)) {
        const m = mines[id];
        if (m.state !== 'pending') continue;
        const row = ffLiveRow(live, id, m);
        if (row && row.destroyed === true) { markRemoved(a, id, m, 'bridge'); continue; }
        if (!row) { unloaded++; continue; }
        const before = await ffDestroyedCount();
        const r = await host.bridge.destroyItem(`eid:${id}`);
        m.tries = (m.tries || 0) + 1; ffDirty = true;
        if (r && r.ok) {
          m.state = 'sent'; m.sentAt = now; m.before = before ? before.n : null; a.inflight = id;
          a.nextAt = now + FF_CONFIRM_MS;
          return;
        }
        const why = ffWhy('items', r);
        m.why = why;
        if (m.tries >= FF_MAX_TRIES) m.state = 'failed';
        ffNote(a, `a mine could not be removed: ${why}`);
        return;
      }
      if (ffCount(a, 'pending') + ffCount(a, 'sent') === 0) { await ffFinish(a, c, ffCount(a, 'failed') ? 'partial' : 'cleared', now); return; }

      // 5. What is left is not loaded: nobody is near. The bridge's visitor can load it.
      if (unloaded) {
        const placed = await ffWake(a, c, now);
        if (placed) { if (a.wake && now - a.wake.placedAt < FF_WAKE_SETTLE_MS) a.nextAt = a.wake.placedAt + FF_WAKE_SETTLE_MS; return; }
        // Nothing is loaded and nothing is in flight, so the visitor this job held is free for the next.
        if (wakeHolder === a.id && !a.wake) wakeHolder = null;
        ffNote(a, `${unloaded} mine(s) are not loaded because nobody is near${c.fallenFlagWake && a.wakeWhy ? `, and the area could not be loaded: ${a.wakeWhy}` : ''}`);
      }
    }

    /** Switched off: drop every timer, so switching on again starts from the flags of that moment. */
    async function ffStandDown(now) {
      const live = ffAreas.filter((a) => FF_LIVE_STATES.has(a.state));
      if (!ffSeeded && !live.length && !Object.keys(ffFlags).length) return;
      for (const a of live) { a.state = 'off'; a.endedAt = now; await ffReleaseWake(a); }
      if (live.length) host.logger.info(`fallen-flag removal is off: ${live.length} waiting area(s) dropped, their mines stay`);
      ffSeeded = false; ffFlags = {}; ffDirty = true;
      try { host.store.set('ffSeeded', false); } catch (e) { /* ignore */ }
    }

    // ── mines outside every flag ────────────────────────────────────────────────────────────────

    /** Inside the square of any flag standing now, widened by `marginCm`. */
    function insideAnyFlag(flags, x, y, marginCm) {
      for (const f of flags) {
        if (x >= f.x + f.minX - marginCm && x <= f.x + f.maxX + marginCm
          && y >= f.y + f.minY - marginCm && y <= f.y + f.maxY + marginCm) return true;
      }
      return false;
    }
    const cellKey = (x, y) => `${Math.floor(x / RM_CELL_CM)}:${Math.floor(y / RM_CELL_CM)}`;
    function orTypeOk(c) {
      if (c.orphanTypes === 'all') return () => true;
      const watch = new Set(c.watchedTypes);
      return (t) => watch.has(t && t.type);
    }
    // A fallen flag still on its timer owns the mines in its square: the owner may yet rebuild there.
    const inLiveFallenArea = (x, y) => ffAreas.some((a) => FF_LIVE_STATES.has(a.state) && ffIn(a, x, y));

    /** A new job for named mines, one square of the map. */
    async function rmCreate(kind, entries, c, now, extra) {
      const mines = {};
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const [id, t] of entries) {
        const x = Number(t && t.x), y = Number(t && t.y), z = Number(t && t.z) || 0;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        mines[String(id)] = { type: (t && t.type) || null, x: Math.round(x), y: Math.round(y), z: Math.round(z), state: 'pending', tries: 0,
          ownerId: Number(t && t.ownerId) > 0 ? Number(t.ownerId) : null };
        sx += x; sy += y; sz += z; n++;
      }
      if (!n) return null;
      const a = Object.assign({
        id: `${kind === 'orphan' ? 'o' : 'r'}${now}-${++rmSeq}`, kind, state: 'removing', startedAt: now, fellAt: now,
        x: Math.round(sx / n), y: Math.round(sy / n), z: Math.round(sz / n),
        minX: -FF_HALF_CM, maxX: FF_HALF_CM, minY: -FF_HALF_CM, maxY: FF_HALF_CM,
        giveUpAt: now + c.removeTryMinutes * 60000, mines, sector: null,
      }, extra || {});
      if (typeof host.map.sector === 'function') {
        try { a.sector = (await host.map.sector(a.x, a.y)) || null; } catch (e) { a.sector = null; }
      }
      rmJobs.unshift(a); rmDirty = true; ffNextRun = 0;
      host.logger.info(`${jobLabel(a)}: removing ${n} mine(s)`);
      return a;
    }

    /**
     * Find the mines outside every standing flag, start their grace, and queue the due ones.
     *
     * Three-valued like everything here. With the base layer unreadable `ffScan()` answers null and
     * this is never reached; a mine whose position is not a number is left alone. A mine counts as
     * outside only against a flag list that was READ this pass.
     */
    async function orScan(scan, c, now) {
      if (now < orNextScan) return;
      orNextScan = now + OR_SCAN_MS;
      if (!Array.isArray(scan.traps)) return;
      const flags = Object.values(scan.flags || {});
      const marginCm = Math.max(0, Number(c.marginMeters) || 0) * 100;
      const want = orTypeOk(c);
      const keep = new Set(c.keepMineIds.map(String));
      const seen = new Set();
      for (const t of scan.traps) {
        if (!t || !want(t)) continue;
        const x = Number(t.x), y = Number(t.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const id = String(t.id);
        if (keep.has(id) || insideAnyFlag(flags, x, y, marginCm) || inLiveFallenArea(x, y)) continue;
        seen.add(id);
        const ownerId = Number(t.ownerId) > 0 ? Number(t.ownerId) : null;
        const o = orphans[id];
        if (!o) { orphans[id] = { firstAt: now, type: t.type || null, x: Math.round(x), y: Math.round(y), z: Math.round(Number(t.z) || 0), ownerId }; orDirty = true; }
        else if (o.ownerId !== ownerId || o.type !== (t.type || null)) { o.ownerId = ownerId; o.type = t.type || null; orDirty = true; }
      }
      for (const id of Object.keys(orphans)) if (!seen.has(id)) { delete orphans[id]; orDirty = true; }

      const grace = c.orphanGraceMinutes * 60000;
      const busy = idsInLiveWork();
      const online = c.orphanOfflineOnly ? onlineSet() : null;
      const exempt = new Set(c.exemptSteamIds.map(String));
      const cells = new Map();
      for (const id of Object.keys(orphans)) {
        const o = orphans[id];
        let wait = null;
        if (busy.has(id)) wait = 'queued';
        else if (now - o.firstAt < grace) wait = 'grace';
        else {
          const pl = o.ownerId ? resolvePlacer(o.ownerId) : null;
          if (pl && exempt.has(pl.steamId)) wait = 'exempt';
          else if (online && pl && online.has(pl.steamId)) wait = 'online';
        }
        if ((o.wait || null) !== wait) { o.wait = wait; orDirty = true; }
        if (wait) continue;
        const k = cellKey(o.x, o.y);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push([id, o]);
      }
      for (const entries of cells.values()) {
        if (rmJobs.filter((j) => j.kind === 'orphan' && FF_LIVE_STATES.has(j.state)).length >= OR_MAX_LIVE) break;
        await rmCreate('orphan', entries, c, now, null);
      }
    }

    /** Orphan removal switched off: its grace timers and its unfinished jobs are dropped. */
    async function orStandDown(now) {
      const live = rmJobs.filter((a) => a.kind === 'orphan' && FF_LIVE_STATES.has(a.state));
      if (!live.length && !Object.keys(orphans).length) return;
      for (const a of live) { a.state = 'off'; a.endedAt = now; await ffReleaseWake(a); }
      if (live.length) host.logger.info(`removing mines outside every flag is off: ${live.length} unfinished job(s) dropped, their mines stay`);
      orphans = {}; orDirty = true; rmDirty = true; orNextScan = 0;
    }

    /** The whole plugin switched off: an admin's removal waiting in the queue does not run either. */
    async function rmStandDown(now) {
      const live = rmJobs.filter((a) => FF_LIVE_STATES.has(a.state));
      for (const a of live) { a.state = 'off'; a.endedAt = now; await ffReleaseWake(a); rmDirty = true; }
    }

    async function ffTick(now) {
      const c = cfg();
      ffNextRun = now + FF_TICK_MS;
      if (!c.enabled || !c.fallenFlagCleanup) await ffStandDown(now);
      if (!c.enabled || !c.orphanCleanup) await orStandDown(now);
      if (!c.enabled) { await rmStandDown(now); ffPersist(); return; }
      // Nothing switched on and nothing queued: the world is not read at all.
      if (!c.fallenFlagCleanup && !c.orphanCleanup && !rmJobs.some((a) => FF_LIVE_STATES.has(a.state))) { ffPersist(); return; }
      const scan = ffScan();
      if (c.fallenFlagCleanup) {
        if (scan) await ffCompare(scan, c, now);
        for (const a of ffAreas.slice()) {
          if (!FF_LIVE_STATES.has(a.state)) continue;
          await ffWork(a, c, now, scan);
          if (a.state === 'removing' && a.nextAt) ffNextRun = Math.min(ffNextRun, a.nextAt);
          else if (a.state === 'waiting') ffNextRun = Math.min(ffNextRun, Math.max(now + 1000, a.deadline));
        }
      }
      if (c.orphanCleanup && scan) await orScan(scan, c, now);
      for (const a of rmJobs.slice()) {
        if (!FF_LIVE_STATES.has(a.state)) continue;
        await ffWork(a, c, now, scan);
        if (a.state === 'removing' && a.nextAt) ffNextRun = Math.min(ffNextRun, a.nextAt);
      }
      if (c.orphanCleanup) ffNextRun = Math.min(ffNextRun, Math.max(now + 1000, orNextScan));
      ffPersist();
    }
    async function ffHeartbeat() {
      if (ffBusy) return;
      const now = Date.now();
      if (now < ffNextRun) return;
      ffBusy = true;
      try { await ffTick(now); } catch (e) { host.logger.warn('fallen-flag pass error: ' + e.message); } finally { ffBusy = false; }
    }
    const ffSummary = (a) => ({
      id: a.id, flagId: a.flagId, baseId: a.baseId, name: a.name || null, owner: a.owner || null, sector: a.sector || null,
      x: a.x, y: a.y, z: a.z, fellAt: a.fellAt, deadline: a.deadline, giveUpAt: a.giveUpAt, state: a.state,
      total: Object.keys(a.mines || {}).length, removed: ffCount(a, 'removed'), gone: ffCount(a, 'gone'),
      failed: ffCount(a, 'failed'), left: ffCount(a, 'pending') + ffCount(a, 'sent'),
      note: FF_LIVE_STATES.has(a.state) ? (a.note || null) : null, keptBy: a.keptBy || null, endedAt: a.endedAt || null,
      kind: a.kind || 'fallen', label: jobLabel(a), skipped: ffCount(a, 'skipped'), startedAt: a.startedAt || null,
    });

    // ── scheduling: a light 1 s heartbeat runs the scan when it's due, so a changed interval takes
    //    effect live (no manager restart) and a fresh join can force an immediate re-scan. ──
    let lastRun = 0, busy = false;
    // `liveHere` (declared with the helpers above) keeps the scan running for a player the bridge
    // announced a moment ago, before the save lists them.
    // Nobody in the world means nobody can be warned (a warning counts only once delivered) or moved
    // (the teleport runs through the placer), so a scan then walks the whole world to change
    // nothing. Skipped — except before the first scan, which only learns what is already placed.
    function anybodyHere() {
      if (liveHere.size) return true;
      try { return (host.players.online() || []).length > 0; } catch (e) { return true; }
    }
    async function tick() {
      if (busy) return;
      const c = cfg();
      if (!c.enabled) return;
      // The punishment switched off on its own. Its memory of which mines were already placed is
      // forgotten, so switching it on again learns the world of that moment and punishes nothing
      // that was armed while it was off, the same as a first start.
      if (!c.punishEnabled) {
        if (seeded) { seeded = false; try { host.store.set('seeded', false); } catch (e) { /* ignore */ } }
        return;
      }
      if (Date.now() - lastRun < c.pollSeconds * 1000) return;
      lastRun = Date.now();
      if (seeded && !anybodyHere()) return;        // the join hook below forces a scan the moment somebody arrives
      busy = true;
      try { await poll(); } catch (e) { host.logger.warn('poll error: ' + e.message); } finally { busy = false; }
    }
    if (mapOk) host.schedule.every(1000, () => { tick(); ffHeartbeat(); });

    // Punish the moment an offender reconnects (offline mines waiting on `requireOnline`) — the bridge
    // join hook fires with no log-tail lag; nudge the next heartbeat to scan right away.
    try { host.players.onJoin((p) => { const s = sidOf(p); if (s) liveHere.add(s); lastRun = 0; }); } catch (e) { /* join hook optional */ }
    try { if (typeof host.players.onLeave === 'function') host.players.onLeave((p) => { const s = sidOf(p); if (s) liveHere.delete(s); }); } catch (e) { /* leave hook optional */ }

    // ── admin-panel endpoints ──
    host.routes.get('/config', (req, res) => res.json(cfg()));
    host.routes.get('/text-defaults', (req, res) => {
      try { res.json(textDefaults()); } catch (e) { res.json({ english: {}, byLang: {} }); }
    });
    host.routes.post('/config', (req, res) => {
      try {
        // Over what is STORED first, filled from DEFAULTS second — see `overlayConfig`.
        const next = normalizeConfig(overlayConfig(host.store.get('config', {}), req.body || {}));
        host.store.set('config', next);
        reloadConfig();                            // what the store really holds now, not what was sent
        lastRun = 0;                               // apply immediately (interval/type changes take effect now)
        ffNextRun = 0;                             // and the fallen-flag switch too
        orNextScan = 0;                            // and the search for mines outside every flag
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
        name: host.items.name(t.code),
        code: t.code,
        image: host.items.image(t.code) || null,
        explosive: t.explosive,
        placed: (counts[t.type] && counts[t.type].placed) || 0,
        armed: (counts[t.type] && counts[t.type].armed) || 0,
      }));
      res.json({ items, defaults: DEFAULT_TYPES });
    });

    // ── the Mines screen: every placed mine and trap, with what each filter is decided on ─────────
    //
    // Every type, not only the watched ones: the screen is also where an owner removes mines by
    // conditions, and a mine of a type nobody watches is still a mine. Per row:
    //   • `insideFlag` — inside the square of ANY flag standing now (`null` when the base layer could
    //     not be read, and then no filter matches it as outside);
    //   • `inArea` — the punishment's own question (the placer's or their squad's flag), asked only for
    //     the watched types, exactly as before;
    //   • `lastTouched` — `_lastAccessTime` out of the trap's own XML in the save, in seconds: when the
    //     game last saw anybody handle it. 729 of the dev save's 729 placed traps carry it.
    //   • `sector` — the panel's own grid, `null` without a map calibration.
    const RM_MAX_REQUEST = 2000;
    const allTraps = () => worldTraps();
    let touched = { at: 0, map: null };
    function touchedMap(now) {
      if (touched.map && now - touched.at < 60000) return touched.map;
      const map = new Map();
      try {
        const codes = TRAP_CATALOG.map((t) => t.code).concat(['C4_Detonator_ES', 'C4_Keypad_ES', 'PracticeTrap_ES']);
        const rows = host.db.scum.all(`SELECT e.id AS id, ie.xml AS xml FROM entity e JOIN item_entity ie ON ie.entity_id = e.id
          WHERE e.owning_entity_id IS NULL AND e.class IN (${codes.map(() => '?').join(',')})`, ...codes) || [];
        for (const r of rows) {
          const m = /_lastAccessTime="(\d+)"/.exec(String((r && r.xml) || ''));
          if (m && Number(m[1]) > 0) map.set(String(r.id), Number(m[1]) * 1000);
        }
      } catch (e) { /* the age is then unknown, never zero */ }
      touched = { at: now, map };
      return map;
    }
    const sectorOf = new Map();
    async function fillSectors(traps) {
      if (typeof host.map.sector !== 'function') return;
      const missing = traps.filter((t) => !sectorOf.has(String(t.id)) && Number.isFinite(Number(t.x)) && Number.isFinite(Number(t.y))).slice(0, 1500);
      await Promise.all(missing.map(async (t) => {
        let s = null;
        try { s = (await host.map.sector(Number(t.x), Number(t.y))) || null; } catch (e) { s = null; }
        sectorOf.set(String(t.id), s);
      }));
      if (sectorOf.size > 20000) sectorOf.clear();
    }
    /** Which live job or area holds each mine: `{ state: 'pending'|'sent', kind, job }`. */
    function workById() {
      const out = new Map();
      for (const a of liveWork()) for (const id of Object.keys(a.mines || {})) {
        const st = a.mines[id] && a.mines[id].state;
        if (st === 'pending' || st === 'sent') out.set(String(id), { state: st, kind: a.kind || 'fallen', job: a.id });
      }
      return out;
    }

    async function mineRows(c, now) {
      const traps = allTraps();
      if (traps === null) return null;
      const scan = ffScan();
      const flags = scan ? Object.values(scan.flags || {}) : null;
      const marginCm = Math.max(0, Number(c.marginMeters) || 0) * 100;
      const watch = new Set(c.watchedTypes);
      const exempt = new Set(c.exemptSteamIds.map(String));
      const keep = new Set(c.keepMineIds.map(String));
      const work = workById();
      const tm = touchedMap(now);
      const placers = new Map();
      await fillSectors(traps);
      const out = traps.map((m) => {
        const id = String(m.id);
        let placer = null;
        if (m.ownerId) { if (!placers.has(m.ownerId)) placers.set(m.ownerId, resolvePlacer(m.ownerId)); placer = placers.get(m.ownerId); }
        const sid = placer && placer.steamId;
        const watched = watch.has(m.type);
        const x = Number(m.x), y = Number(m.y);
        // THREE-VALUED, exactly like the enforcement path — and for the same reason. `!!` on the
        // manager's answer collapsed "the game database could not answer" into "outside their flag",
        // and the table then described a mine as an offence the plugin was declining to judge.
        const inArea = !watched ? null : (sid ? host.map.isInOwnerArea(sid, m.x, m.y, marginCm) : false);
        // Same rule for `armed`: the world scan OMITS the key when it could not read the trap's XML.
        const armed = (m.armed === true || m.armed === false) ? m.armed : null;
        const w = work.get(id) || null;
        return {
          id: m.id, type: m.type, code: codeOf(m), name: displayName(m), armed, watched,
          x: Math.round(x), y: Math.round(y), z: Math.round(Number(m.z) || 0),
          placerName: placer ? placer.name : null, placerSteamId: sid || null,
          inArea: (inArea === true || inArea === false) ? inArea : null,
          insideFlag: (flags && Number.isFinite(x) && Number.isFinite(y)) ? insideAnyFlag(flags, x, y, marginCm) : null,
          exempt: sid ? exempt.has(sid) : false, kept: keep.has(id),
          handled: handled.has(id), offences: sid ? (offenses[sid] || 0) : 0,
          sector: sectorOf.has(id) ? sectorOf.get(id) : null,
          lastTouched: tm.has(id) ? tm.get(id) : null,
          orphanSince: orphans[id] ? orphans[id].firstAt : null, orphanWait: orphans[id] ? (orphans[id].wait || null) : null,
          work: w ? w.state : null, workKind: w ? w.kind : null,
        };
      });
      out.flagsKnown = !!flags;
      return out;
    }

    // Overview of the old screen kept its order: armed & outside-flag & not-yet-handled first.
    host.routes.get('/mines', async (req, res) => {
      try {
        const c = cfg();
        const traps = allTraps();
      if (traps === null) return res.json({ mines: [], serverRunning: false });
        const now = Date.now();
        const out = await mineRows(c, now);
        const flagsKnown = out.flagsKnown;
        out.sort((a, b) => (Number(a.watched ? 0 : 1) - Number(b.watched ? 0 : 1)) || (Number(a.armed === true ? 0 : 1) - Number(b.armed === true ? 0 : 1)) || (Number(a.inArea === true) - Number(b.inArea === true)) || (Number(a.handled) - Number(b.handled)) || (b.offences - a.offences));
        res.json({ mines: out, serverRunning: true, flagsKnown, at: now });
      } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // `GET /online` used to live here, for the exemption picker. The picker uses the panel's own
    // SSA.pickPlayer now — which is the point of having an SDK — so nothing called it.

    /**
     * The mines outside every flag, in squares of the map, for the Flags screen.
     *
     * Computed from THIS reading whether the clean-up is on or not: an owner deciding whether to
     * switch it on is asking exactly what it would remove. With it on, each group also carries how
     * long its mines have been waiting and why one is held (`grace`, `online`, `exempt`, `queued`).
     */
    function orphanGroups(c, now) {
      const scan = ffScan();
      if (!scan || !Array.isArray(scan.traps)) return null;
      const flags = Object.values(scan.flags || {});
      const marginCm = Math.max(0, Number(c.marginMeters) || 0) * 100;
      const want = orTypeOk(c);
      const keep = new Set(c.keepMineIds.map(String));
      const cells = new Map();
      for (const t of scan.traps) {
        if (!t || !want(t)) continue;
        const x = Number(t.x), y = Number(t.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (insideAnyFlag(flags, x, y, marginCm) || inLiveFallenArea(x, y)) continue;
        const id = String(t.id);
        const k = cellKey(x, y);
        let g = cells.get(k);
        if (!g) { g = { key: k, n: 0, kept: 0, armed: 0, sx: 0, sy: 0, sz: 0, types: {}, owners: {}, since: null, waits: {}, ids: [] }; cells.set(k, g); }
        if (keep.has(id)) { g.kept++; continue; }
        g.n++; g.ids.push(id); g.sx += x; g.sy += y; g.sz += Number(t.z) || 0;
        if (t.armed === true) g.armed++;
        g.types[t.type] = (g.types[t.type] || 0) + 1;
        const own = Number(t.ownerId) > 0 ? Number(t.ownerId) : 0;
        g.owners[own] = (g.owners[own] || 0) + 1;
        const o = c.orphanCleanup ? orphans[id] : null;
        if (o) { g.since = g.since === null ? o.firstAt : Math.min(g.since, o.firstAt); const wt = o.wait || 'due'; g.waits[wt] = (g.waits[wt] || 0) + 1; }
      }
      const work = workById();
      const out = [];
      for (const g of cells.values()) {
        if (!g.n) { if (g.kept) out.push({ key: g.key, n: 0, kept: g.kept, x: null, y: null, z: null, types: {}, placers: [], armed: 0, since: null, dueAt: null, waits: {}, removing: 0 }); continue; }
        const placers = Object.keys(g.owners).map((pid) => {
          const p = Number(pid) > 0 ? resolvePlacer(Number(pid)) : null;
          return { name: p ? p.name : null, steamId: p ? p.steamId : null, n: g.owners[pid] };
        }).sort((a, b) => b.n - a.n);
        out.push({
          key: g.key, n: g.n, kept: g.kept, armed: g.armed, types: g.types, placers,
          x: Math.round(g.sx / g.n), y: Math.round(g.sy / g.n), z: Math.round(g.sz / g.n),
          since: g.since, dueAt: g.since === null ? null : g.since + c.orphanGraceMinutes * 60000, waits: g.waits,
          removing: g.ids.filter((id) => work.has(id)).length,
        });
      }
      out.sort((a, b) => b.n - a.n);
      return out.slice(0, 200);
    }

    // Live status for the UI header + recent-actions feed. "serverRunning" here means "the game DB is
    // readable right now" (worldTraps() !== null) — the meaningful signal for this plugin, and the one
    // that isn't a false-negative like a stale process check.
    host.routes.get('/status', async (req, res) => {
      try {
        const c = cfg();
        const now = Date.now();
        const traps = worldTraps();
        const readable = traps !== null;
        // Counters for the header: what is placed, and how much of it sits outside every flag.
        let counts = null;
        let groups = null;
        if (readable) {
          const watch = new Set(c.watchedTypes);
          groups = orphanGroups(c, now);
          // Per type, for the Overview: placed, armed, and outside every flag (whatever the type, so
          // an owner sees what choosing "every mine and trap" would add). Null when flags are unknown.
          const scan = ffScan();
          const flags = scan ? Object.values(scan.flags || {}) : null;
          const marginCm = Math.max(0, Number(c.marginMeters) || 0) * 100;
          const byType = {};
          for (const t of traps) {
            const k = String(t.type || '');
            const b = byType[k] || (byType[k] = { placed: 0, armed: 0, outside: flags ? 0 : null });
            b.placed++;
            if (t.armed === true) b.armed++;
            const x = Number(t.x), y = Number(t.y);
            if (flags && Number.isFinite(x) && Number.isFinite(y) && !insideAnyFlag(flags, x, y, marginCm)) b.outside++;
          }
          counts = {
            placed: traps.length,
            watched: traps.filter((t) => watch.has(t.type)).length,
            armed: traps.filter((t) => t.armed === true).length,
            outside: groups ? groups.reduce((s, g) => s + g.n, 0) : null,
            byType,
          };
        }
        const day = now - 86400000;
        res.json({
          enabled: c.enabled, action: c.action, watchedTypes: c.watchedTypes, warningsBeforeAction: c.warningsBeforeAction,
          requireOnline: c.requireOnline, marginMeters: c.marginMeters, pollSeconds: c.pollSeconds, punishEnabled: c.punishEnabled,
          serverRunning: readable, knownMines: handled.size, warnedPlayers: Object.keys(offenses).length, recent,
          // What the two live cross-checks are doing. `null` for a check means the last time it ran it
          // answered — an owner should see "the game is being asked" or the reason it is not, and never
          // a plugin that quietly fell back to the save without saying.
          live: { traps: liveNote.traps, squads: liveNote.squads },
          // The fallen-flag timers: what is waiting, being removed, and what happened to the last ones.
          fallen: { on: c.fallenFlagCleanup === true, areas: ffAreas.map(ffSummary) },
          // Mines outside every flag, by square, and the clean-up's own queue.
          orphans: { on: c.orphanCleanup === true, graceMinutes: c.orphanGraceMinutes, groups: groups || [], known: groups !== null },
          jobs: rmJobs.map(ffSummary),
          counts,
          removed24h: removals.filter((r) => r && r.at > day).length,
          removals: removals.slice(0, 50),
          // The switches every removal needs, read off the bridge's module cards (null: not readable).
          bridge: await bridgeSwitches(now),
          // Why nothing is being enforced, when that is the case for a reason the owner cannot fix in
          // this tab: `manager_too_old` = the manager lacks the world scan / flag test. null otherwise.
          idle: mapOk ? null : 'manager_too_old',
        });
      } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // Every removed mine this plugin kept a line for, newest first.
    host.routes.get('/removals', (req, res) => res.json({ removals }));

    /** Store a change to the settings the same way the Save button does: over what is stored. */
    function saveConfigPatch(patch) {
      const merged = normalizeConfig(overlayConfig(host.store.get('config', {}), patch));
      host.store.set('config', merged);
      reloadConfig();
      ffNextRun = 0; orNextScan = 0;
      return merged;
    }
    /** Queue named mines (rows of `mineRows`, or `[id, trap]` pairs) as manual jobs, one per square. */
    async function queueManual(entries, c, now, label) {
      const busy = idsInLiveWork();
      const cells = new Map();
      let fresh = 0;
      for (const [id, t] of entries) {
        if (busy.has(String(id))) continue;
        const x = Number(t && t.x), y = Number(t && t.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const k = cellKey(x, y);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push([id, t]);
        fresh++;
      }
      let jobs = 0;
      for (const list of cells.values()) if (await rmCreate('manual', list, c, now, { label: label || null })) jobs++;
      if (fresh) host.logger.info(`an admin asked to remove ${fresh} mine(s)${label ? ` (${label})` : ''}: ${jobs} job(s) queued`);
      return { queued: fresh, already: entries.length - fresh, jobs };
    }
    function refusal(res, code, error, reason, extra) { return res.status(code).json(Object.assign({ ok: false, error, reason }, extra || {})); }

    /**
     * Remove mines by the admin's choice: `{ ids }` (the ticked rows) or `{ filter, expect }` (every
     * row the filter matches). The filter is evaluated HERE, at the press, with the same function the
     * screen used; `expect` is the count the confirmation named, and a world that moved since then is
     * a refusal rather than a different removal than the one confirmed.
     */
    host.routes.post('/remove', async (req, res) => {
      try {
        const c = cfg();
        if (!c.enabled) return refusal(res, 409, 'plugin_off', 'Mine Protection is switched off. Switch it on in Settings first.');
        const now = Date.now();
        const rows = await mineRows(c, now);
        if (rows === null) return refusal(res, 503, 'world_unreadable', 'The game database cannot be read now, so nothing was queued.');
        const b = req.body || {};
        let picked;
        if (Array.isArray(b.ids)) {
          const want = new Set(b.ids.map(String));
          picked = rows.filter((r) => want.has(String(r.id)));
        } else if (b.filter && typeof b.filter === 'object') {
          const at = Number(b.filter.at);
          const t = Number.isFinite(at) && Math.abs(at - now) < 600000 ? at : now;
          picked = rows.filter((r) => mineMatches(r, b.filter, t));
        } else return refusal(res, 400, 'nothing_named', 'Name the mines to remove, or a filter.');
        const expect = b.expect === undefined || b.expect === null || b.expect === '' ? null : Number(b.expect);
        if (expect !== null && expect !== picked.length) {
          return refusal(res, 409, 'changed', `The list changed: ${picked.length} mine(s) match now, not ${expect}. Nothing was queued.`, { count: picked.length });
        }
        if (!picked.length) return refusal(res, 404, 'none', 'No placed mine matches that any more. Nothing was queued.');
        if (picked.length > RM_MAX_REQUEST) return refusal(res, 413, 'too_many', `That is ${picked.length} mines. Remove at most ${RM_MAX_REQUEST} at once.`);
        const r = await queueManual(picked.map((p) => [String(p.id), p]), c, now, null);
        ffPersist();
        res.json(Object.assign({ ok: true }, r));
      } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // "Remove now" on a fallen flag's row: a flag still on its timer skips the rest of the wait; one
    // that finished, gave up or was kept gets its square's mines queued as an admin's removal.
    host.routes.post('/fallen-now', async (req, res) => {
      try {
        const c = cfg();
        if (!c.enabled) return refusal(res, 409, 'plugin_off', 'Mine Protection is switched off. Switch it on in Settings first.');
        const id = String((req.body || {}).id || '');
        const a = ffAreas.find((x) => x.id === id);
        if (!a) return refusal(res, 404, 'not_found', 'That fallen flag is not in the list any more.');
        const now = Date.now();
        if (c.fallenFlagCleanup && a.state === 'waiting') { a.deadline = now; ffDirty = true; ffNextRun = 0; ffPersist(); return res.json({ ok: true, state: a.state, now: true }); }
        if (c.fallenFlagCleanup && a.state === 'removing') { a.nextAt = 0; ffNextRun = 0; return res.json({ ok: true, state: a.state, now: true }); }
        const scan = ffScan();
        if (!scan || !Array.isArray(scan.traps)) return refusal(res, 503, 'world_unreadable', 'The game database cannot be read now, so nothing was queued.');
        const want = ffTypeOk(c);
        const entries = scan.traps.filter((t) => want(t) && ffIn(a, Number(t.x), Number(t.y))).map((t) => [String(t.id), t]);
        if (!entries.length) return refusal(res, 404, 'none', 'No placed mine is left in that flag\'s area.');
        const r = await queueManual(entries, c, now, `fallen flag ${ffLabel(a)}`);
        ffPersist();
        res.json(Object.assign({ ok: true }, r));
      } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // The orphan groups' two buttons. Both name a square by its key, read again here.
    function orphanEntries(c, key) {
      const scan = ffScan();
      if (!scan || !Array.isArray(scan.traps)) return null;
      const flags = Object.values(scan.flags || {});
      const marginCm = Math.max(0, Number(c.marginMeters) || 0) * 100;
      const want = orTypeOk(c);
      return scan.traps.filter((t) => {
        if (!t || !want(t)) return false;
        const x = Number(t.x), y = Number(t.y);
        return Number.isFinite(x) && Number.isFinite(y) && cellKey(x, y) === key
          && !insideAnyFlag(flags, x, y, marginCm) && !inLiveFallenArea(x, y);
      }).map((t) => [String(t.id), t]);
    }
    host.routes.post('/orphans-now', async (req, res) => {
      try {
        const c = cfg();
        if (!c.enabled) return refusal(res, 409, 'plugin_off', 'Mine Protection is switched off. Switch it on in Settings first.');
        const entries = orphanEntries(c, String((req.body || {}).key || ''));
        if (entries === null) return refusal(res, 503, 'world_unreadable', 'The game database cannot be read now, so nothing was queued.');
        const keep = new Set(c.keepMineIds.map(String));
        const list = entries.filter(([id]) => !keep.has(id));
        if (!list.length) return refusal(res, 404, 'none', 'No mine outside a flag is left there.');
        const r = await queueManual(list, c, Date.now(), 'outside every flag');
        ffPersist();
        res.json(Object.assign({ ok: true }, r));
      } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });
    host.routes.post('/orphans-keep', (req, res) => {
      try {
        const c = cfg();
        const entries = orphanEntries(c, String((req.body || {}).key || ''));
        if (entries === null) return refusal(res, 503, 'world_unreadable', 'The game database cannot be read now, so nothing was kept.');
        if (!entries.length) return refusal(res, 404, 'none', 'No mine outside a flag is left there.');
        const ids = entries.map(([id]) => id);
        const merged = saveConfigPatch({ keepMineIds: c.keepMineIds.concat(ids) });
        for (const id of ids) if (orphans[id]) { delete orphans[id]; orDirty = true; }
        ffPersist();
        host.logger.info(`an admin kept ${ids.length} mine(s) outside every flag; the clean-up leaves them alone`);
        res.json({ ok: true, kept: ids.length, total: merged.keepMineIds.length });
      } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });
    host.routes.post('/keep-forget', (req, res) => {
      try {
        const n = cfg().keepMineIds.length;
        saveConfigPatch({ keepMineIds: [] });
        res.json({ ok: true, forgotten: n });
      } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });
    host.routes.post('/removals-clear', (req, res) => { removals = []; logDirty = true; ffPersist(); res.json({ ok: true }); });
    // An admin's queued removal, called off before it is done. The mines not yet removed stay.
    host.routes.post('/job-stop', async (req, res) => {
      const id = String((req.body || {}).id || '');
      const a = rmJobs.find((x) => x.id === id);
      if (!a) return refusal(res, 404, 'not_found', 'That removal is not in the list any more.');
      if (!FF_LIVE_STATES.has(a.state)) return res.json({ ok: true, state: a.state });
      try { await ffFinish(a, cfg(), 'stopped', Date.now()); ffPersist(); res.json({ ok: true, state: a.state }); }
      catch (e) { res.status(500).json({ ok: false, error: e.message }); }
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
    // Keep the mines of one fallen flag: the owner's own call, from the panel, before or during removal.
    // From 1.10.0 the mines in its square are also kept from the orphan clean-up, which would
    // otherwise remove them once the timer that was called off no longer covers them.
    host.routes.post('/fallen-keep', async (req, res) => {
      const id = String((req.body || {}).id || '');
      const a = ffAreas.find((x) => x.id === id);
      if (!a) return res.status(404).json({ ok: false, error: 'not_found', reason: 'That fallen flag is not in the list any more.' });
      if (!FF_LIVE_STATES.has(a.state)) return res.json({ ok: true, state: a.state });
      try {
        await ffCancel(a, Date.now(), 'kept by an admin from the panel');
        const ids = new Set(Object.keys(a.mines || {}).filter((k) => a.mines[k].state === 'pending' || a.mines[k].state === 'sent'));
        const scan = ffScan();
        if (scan && Array.isArray(scan.traps)) for (const t of scan.traps) if (ffIn(a, Number(t.x), Number(t.y))) ids.add(String(t.id));
        if (ids.size) saveConfigPatch({ keepMineIds: cfg().keepMineIds.concat([...ids]) });
        ffPersist(); res.json({ ok: true, state: a.state, kept: ids.size });
      } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    host.logger.info(`Mine Protection active — watching ${cfg().watchedTypes.length} type(s)`);
  },

  async unregister(host) { host.logger.info('Mine Protection stopped'); },
};
