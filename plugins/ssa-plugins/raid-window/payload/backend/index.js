'use strict';

// Raid Window — keeps offline raid protection OUT OF THE WAY while a base is actually being raided.
//
// The problem it solves, in the words it was reported in: defenders log out on purpose in the middle
// of a raid, offline protection arms itself an hour later, and the raid can never be finished. The
// answer is to push the START of that one flag's protection window further out, again and again,
// for as long as the raid is still going — and only for that flag.
//
// ── WHAT COUNTS AS "BEING RAIDED", AND WHY IT IS THIS AND NOT SOMETHING ELSE ──────────────────────
//
// A false positive here denies protection to somebody who is not being raided, which is worse than
// the problem being solved. So the evidence is narrow, it is the game's own, and it is recorded
// beside every single push:
//
//   · The SSA Bridge's `raid` module watches the game's two base-damage multicasts
//     (`ApplyDamageToBaseElement` and `DestroyElement`) and separates real damage from decay, from an
//     upgrade and from an admin clearing a build. A hit on that feed is a player hitting a wall. It
//     is not a scan of the world, and that distinction is the whole design: sentries, NPCs, animals
//     and puppets exist only around players, so anything that looked for live actors near the flag
//     would be at its weakest exactly when the defenders have logged off — which is the only moment
//     this plugin has to work.
//
//   · OPENING a window takes the full evidence floor (`minHits`, or a destroyed structure). KEEPING
//     one open takes any further real hit on that base: the bridge starts its counters again after
//     a pause, so a raid that resumes with two hits would otherwise read as "under the floor" and
//     be allowed to end while it is still going on.
//
//   · The manager's own owner/raid alerts (`raid:alert`, built from the game's base-destruction log)
//     may only ever EXTEND a window this plugin already opened on that first evidence, and only a
//     base ATTACK counts — not a stolen car, a picked lock or a protection status change. They carry
//     no base id, so the base is found by where the damage landed, or failing that by the owner of
//     the base's FLAG; letting them START a window would push protection on bases nobody has
//     touched. They are a second pair of eyes for the case that matters — the bridge going quiet
//     mid-raid — and never a second way in.
//
// ── AND HOW IT ENDS, WHICH IS THE HALF THAT CAN GO SILENTLY WRONG ────────────────────────────────
//
// **Only a positive fact ends a raid: `holdSeconds` of real time with no new evidence.** Never an
// empty answer. "No raid rows came back", "the bridge is not answering", "the game database could not
// be read" and "the raid is over" all look identical from a count, and reading any of the first three
// as the fourth hands the defenders exactly the outcome the owner is trying to prevent — silently.
// So `lastHitAt` is stored per base, is MONOTONIC, and a tick that learns nothing changes nothing.
//
// That also survives the bridge restarting: its raid counters start again from zero, so this plugin
// never compares counters. It takes `now - lastHitMs` as an absolute instant and keeps the latest one
// it has ever seen.
//
// ⚠ **The bridge remembers a raid long after it ends**, and a window may only open on evidence that
// is both FRESH (inside one hold period) and NEW (later than the hit an earlier window closed on).
// Without both, a remembered raid re-opens the window it just closed on every pass, for as long as
// the bridge keeps the record: a log line, a feed entry and a store write every twenty seconds, and
// the real feed pushed out of the history by the noise.
//
// ── TWO PROTECTION MODES, TWO WRITES ─────────────────────────────────────────────────────────────
//
// Which write is right depends on the raid protection the server runs, and the plugin asks the
// bridge which manager the game built before it writes anything:
//
//   · OFFLINE (scum.RaidProtectionType=1) — `postpone:<flag>:<seconds>`. The game arms a flag when
//     the last of its owners and squadmates logs out, by storing a START (now + the configured start
//     delay) and a length; protection is simply on while the server's clock is between the two, and
//     logging back in clears it. There is no RPC to change that start under this mode: the offline
//     manager's slot for the window setter is the engine's "return false" stub, which is why the
//     `set` below "dispatched and nothing moved" on every offline server. `postpone` moves that
//     stored start LATER — never earlier, never under protection that is already running, never into
//     an entry that is not armed — and leaves the length alone, so no length is ever read or
//     invented on this path. The server's start delay setting is not touched.
//     Driven end to end on a test server: the game armed a flag 120 s after its owner logged out,
//     the push moved that to 300 s, the 120 s mark passed with nothing happening, and protection
//     began at 300 s with its full length in front of it.
//   · FLAG-SPECIFIC (scum.RaidProtectionType=2) — `set:<flag>:<delay>:<duration>`, exactly as
//     before, with everything the next section says about it.
//   · Anything else, or a mode that could not be read — NOTHING is written, and the tab says why. A
//     guess about which write applies is a write to somebody's base on a guess.
//
// On the offline path only a push that MOVED the start counts towards "Most pushes for one raid":
// while a defender is still online the game keeps the entry empty and every push answers "nothing to
// postpone", and letting those use up the allowance would leave the raid unguarded at the moment
// the defender finally logs out.
//
// ── WHAT IS WRITTEN ON A FLAG-SPECIFIC SERVER, AND WHAT IS MEASURED ABOUT IT ─────────────────────
//
//   RaidProtection_Server_SetFlagProtectionTime(FlagId, Delay, Duration)
//
// `Delay` is the countdown before protection BEGINS and `Duration` is how long it then lasts; both
// are SECONDS. Those are the bridge's own settled readings and this plugin does no arithmetic on
// them beyond the two numbers an owner typed.
//
// **`Duration` is never invented.** The write needs one, and a missing value must not become a
// plausible one, so it is read in this order and the source is recorded on every push:
//
//   1. `durationSeconds` — the owner's own number, if they set one.
//   2. The flag's own saved window: `base_raid_protection.data`, twelve bytes read as
//      `u16 active, u16, u32 start, u32 duration`, so the duration is the little-endian word at
//      byte 8, in whole seconds. Measured on a real save of an OFFLINE server: 22 of 23 rows read
//      86400 (= its `RaidProtectionOfflineMaxProtectionTime` of 24:00:00) and the 23rd reads 0,
//      which is the game holding an entry with nothing in it. This path only ever runs on a
//      FLAG-SPECIFIC server, and no flag-specific save has been read: that the same bytes hold the
//      duration there is the reasonable reading, not a measurement.
//   3. The running game's own decoded window, from the bridge's `protect` module. Its decode is the
//      one measured on an offline server, where the game packs the duration as a 15-bit float and
//      86400 comes back as 86528. The unpacker has a second mode that stores whole MINUTES, and the
//      bridge reads the mode byte as the manager's own protection type — so on a flag-specific server
//      this figure may be decoded with the wrong mode. The game caps flag-specific protection at
//      8 hours (its own setting description), and 480 minutes read the offline way decodes to 0.0,
//      which `liveWindow` treats as "no length": the likely failure is a skipped base, not a wrong
//      length. Not driven on a flag-specific server.
//
// If none of the three answers, the flag is NOT pushed and the tab says which of them was missing.
// A window LONGER than the bridge will ever send (a week) is not pushed either: writing a shorter one
// back would take protection away from the owner, which is the one thing this plugin must not do.
//
// ── WHAT IS NOT VERIFIED, SAID HERE RATHER THAN LEFT TO BE DISCOVERED ────────────────────────────
//
//   · **What a zero means in either argument.** Nothing here ever sends one: a duration of 0 is
//     treated as "no window to preserve" and the push is refused instead.
//   · **Whether the game's change cooldown gates this call.** The game has a "safety time set
//     cooldown" and a paid way to skip it, and both belong to its FLAG-SPECIFIC protection mode;
//     an offline-protection server has no cooldown path of its own. Whether the server-side call is
//     nevertheless refused while a cooldown is running has not been shown either way. So
//     `resetCooldownFirst` exists and is OFF by default — the reset is the game's own PAID skip and
//     it travels on a player's channel, so it may charge whoever is online. Leave it off unless
//     pushes come back saying nothing moved.
//   · **Every push reports whether the flag's stored state actually MOVED**, because the bridge reads
//     the packed word either side of the call on the same frame. A call that was accepted and moved
//     nothing is recorded as exactly that. `accepted` on its own is never read as "it worked".
//   · **The call does NOT take effect under OFFLINE protection, and that is settled.** It was driven
//     on an offline server and moved nothing, and the bridge then found why in `SCUMServer.exe`: the
//     offline manager's slot for the window setter is the engine's "return false" stub. That is why
//     the offline path above uses `postpone` and never this call.
//
// ── ONE DELIBERATE NON-GATE, AND ONE GATE ────────────────────────────────────────────────────────
//
// It pushes whether or not the DEFENDERS are still online. The game clears a flag's protection while
// an owner or a squadmate is connected, so a push made then may well read "accepted, nothing moved".
// Gating on "are they offline yet" would mean skipping the push at the one moment that matters if
// that reading failed — which is the same mistake as reading an absence as a verdict, one layer out.
// It pushes on the cadence and lets the game decide; the re-apply is what catches the logout.
//
// It does NOTHING while the game database positively says nobody at all is online. Nobody can be
// raiding then. On a flag-specific server a push would be refused anyway, because the game takes that
// call only through a connected player's channel; `postpone` on an offline server needs no player,
// so there the idle is the "nobody is raiding" reason alone. The bridge keeps its raid records with absolute last-hit times, so nothing seen
// before is lost: the first pass after somebody connects reads the same feed. An unreadable database
// is not "nobody online" and does not idle anything.

const MAX_WINDOW = 604800;          // one week — the most the bridge's protect module will ever send
const FLAG_ASSET_LIKE = '%BP_Base_Flag%';   // covers BP_Base_Flag_C and BP_Base_Flag_Supporter_C
const CONFIG_TTL_MS = 15000;        // re-read the config file at most this often (an edit on the card)
const NAME_TTL_MS = 600000;         // base names barely change; the tab polls every ten seconds
const QUIET_MS = 3600000;           // a repeating warning is said at most once an hour
const MODE_TTL_MS = 300000;         // the manager is built at boot; a known answer is re-asked every 5 min

/** The game's manager class, to the protection mode it means. Anything else writes nothing. */
const MODE_BY_CLASS = {
  OfflineRaidProtectionManager: 'offline',
  FlagSpecificRaidProtectionManager: 'flagSpecific',
  GlobalRaidProtectionManager: 'global',
};

const DEFAULTS = {
  enabled: true,
  pollSeconds: 20,            // how often the raid feed is read
  pushSeconds: 3600,          // how far out the start of protection is pushed, each time
  reapplySeconds: 600,        // how often to re-apply while the raid is still going
  holdSeconds: 3600,          // real time with NO new evidence before a raid counts as over
  minHits: 3,                 // hits on one base before it counts as a raid (a destroyed structure always does)
  acceptDeclared: false,      // act on a raid window some other caller DECLARED rather than one that was observed
  useOwnerAlerts: true,       // let the manager's own raid alerts extend a window this plugin already opened
  resetCooldownFirst: false,  // send the game's cooldown reset before each push (see the note above)
  durationSeconds: null,      // pin the Duration written, instead of reading the flag's own
  allowDecodedDuration: true, // fall back to the running game's decoded window when the save has none
  maxPushesPerRaid: 24,       // ceiling on how many times one raid may write, so nothing can push for ever
  countFromLastHit: false,    // protection starts `pushSeconds` after the LAST hit; every new hit restarts it
  exemptBaseIds: [],
  exemptFlagIds: [],
};

const CLAMP = {
  pollSeconds: [5, 300],
  pushSeconds: [60, 86400],
  reapplySeconds: [30, 86400],
  holdSeconds: [60, 86400],
  minHits: [1, 1000],
  maxPushesPerRaid: [1, 1000],
};

const BOOLS = ['enabled', 'acceptDeclared', 'useOwnerAlerts', 'resetCooldownFirst', 'allowDecodedDuration', 'countFromLastHit'];

/** The words on the tab, so a refused save names the box rather than a key. */
const LABELS = {
  enabled: 'Keep raids going when defenders log out',
  pollSeconds: 'Look for raid damage every',
  pushSeconds: 'Push protection back by',
  reapplySeconds: 'Repeat the push every',
  holdSeconds: 'A raid is over after no damage for',
  minHits: 'Hits needed to count as a raid',
  acceptDeclared: 'Accept raids declared by other tools',
  useOwnerAlerts: 'Base attack alerts keep a raid going',
  resetCooldownFirst: 'Clear the protection cooldown before each push',
  durationSeconds: 'Fixed protection length',
  allowDecodedDuration: 'If the save has no length, ask the running game',
  maxPushesPerRaid: 'Most pushes for one raid',
  countFromLastHit: 'Every hit restarts the countdown',
  exemptBaseIds: 'Never touch these bases',
  exemptFlagIds: 'Never touch these flags',
};

/**
 * The unit each number is shown in on the tab. The config stores seconds; the tab shows the unit an
 * owner thinks in, so a refusal has to speak that unit too, or it names a range nobody typed.
 */
const SHOWN_IN = {
  pollSeconds: ['seconds', 1],
  pushSeconds: ['minutes', 60],
  reapplySeconds: ['minutes', 60],
  holdSeconds: ['minutes', 60],
  durationSeconds: ['hours', 3600],
};
function shownRange(k, lo, hi) {
  const u = SHOWN_IN[k];
  if (!u) return `a number from ${lo} to ${hi}`;
  const f = (n) => String(Math.round((n / u[1]) * 100) / 100);
  return `from ${f(lo)} to ${f(hi)} ${u[0]}`;
}

/**
 * A number inside its range, or the default.
 *
 * Written in the POSITIVE form on purpose. `if (n < lo || n > hi)` lets NaN straight through, because
 * every comparison against NaN is false — the shape that has cost this product a world sweep that
 * excluded nothing and a setting that could never be set again.
 */
function ranged(v, key, dflt) {
  const [lo, hi] = CLAMP[key];
  const n = Number(v);
  return (Number.isFinite(n) && n >= lo && n <= hi) ? Math.round(n) : dflt;
}

/** A whole positive id, or null. */
function oneId(x) {
  if (x === null || x === undefined || x === '' || typeof x === 'boolean') return null;
  const n = Number(x);
  return (Number.isFinite(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER) ? Math.round(n) : null;
}

/** Ids an owner typed, as positive whole numbers. Anything else is dropped rather than guessed at. */
function idList(v) {
  const out = [];
  for (const x of (Array.isArray(v) ? v : [])) {
    const n = oneId(x);
    if (n != null) out.push(n);
  }
  return [...new Set(out)];
}

function normalizeConfig(raw) {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const c = {};
  // Only the keys this build knows. A key it cannot keep is not carried along to look configured.
  for (const k of Object.keys(DEFAULTS)) c[k] = Object.prototype.hasOwnProperty.call(src, k) ? src[k] : DEFAULTS[k];
  c.enabled = c.enabled !== false;
  for (const k of Object.keys(CLAMP)) c[k] = ranged(c[k], k, DEFAULTS[k]);
  c.acceptDeclared = c.acceptDeclared === true;
  c.useOwnerAlerts = c.useOwnerAlerts !== false;
  c.resetCooldownFirst = c.resetCooldownFirst === true;
  c.allowDecodedDuration = c.allowDecodedDuration !== false;
  c.countFromLastHit = c.countFromLastHit === true;
  // `null` is "read the flag's own", and it is NOT the same as 0. A 0 here would be a Duration this
  // plugin refuses to send, so it is rejected back to null rather than stored as a number.
  {
    const n = (c.durationSeconds === null || c.durationSeconds === '') ? NaN : Number(c.durationSeconds);
    c.durationSeconds = (Number.isFinite(n) && n > 0 && n <= MAX_WINDOW) ? Math.round(n) : null;
  }
  c.exemptBaseIds = idList(c.exemptBaseIds);
  c.exemptFlagIds = idList(c.exemptFlagIds);
  return c;
}

/**
 * What is wrong with a body an admin sent, in the words on the tab. Empty when nothing is.
 *
 * `normalizeConfig` quietly falls back to a default, which is right for READING a file an older build
 * wrote and wrong for a SAVE: an owner who typed 10 into a box whose floor is 60 was answered "Saved",
 * the screen kept showing 10, and the plugin ran on 3600. A save is refused instead, naming the box.
 */
/**
 * The same, as `{ key, rule, lo, hi, unit, max }` per box, so the tab can say it in the reader's
 * language with its own label. `rule` is range | bool | duration | ids; `lo`/`hi` are in the unit
 * the tab shows (`unit` is seconds | minutes | hours, or null for a plain count).
 */
function invalidDetails(body) {
  const out = [];
  if (!body || typeof body !== 'object') return out;
  for (const k of Object.keys(body)) {
    const v = body[k];
    if (CLAMP[k]) {
      const [lo, hi] = CLAMP[k];
      const n = (v === null || v === '' || typeof v === 'boolean') ? NaN : Number(v);
      if (!(Number.isFinite(n) && n >= lo && n <= hi)) {
        const u = SHOWN_IN[k];
        const f = (x) => (u ? Math.round((x / u[1]) * 100) / 100 : x);
        out.push({ key: k, rule: 'range', lo: f(lo), hi: f(hi), unit: u ? u[0] : null, text: `“${LABELS[k]}” must be ${shownRange(k, lo, hi)}` });
      }
    } else if (BOOLS.indexOf(k) >= 0) {
      if (typeof v !== 'boolean') out.push({ key: k, rule: 'bool', text: `“${LABELS[k]}” must be on or off` });
    } else if (k === 'durationSeconds') {
      if (v === null || v === '') continue;
      const n = typeof v === 'boolean' ? NaN : Number(v);
      if (!(Number.isFinite(n) && n > 0 && n <= MAX_WINDOW)) out.push({ key: k, rule: 'duration', max: MAX_WINDOW / 3600, text: `“${LABELS[k]}” must be empty, or up to ${MAX_WINDOW / 3600} hours` });
    } else if (k === 'exemptBaseIds' || k === 'exemptFlagIds') {
      if (!Array.isArray(v) || v.some((x) => oneId(x) == null)) out.push({ key: k, rule: 'ids', text: `“${LABELS[k]}” must be a list of id numbers, separated by commas` });
    }
  }
  return out;
}

/**
 * A caller's body laid over what is already STORED, one level deep.
 *
 * By KEY PRESENCE, never truthiness: `"exemptBaseIds": []` is an owner who cleared the list and must
 * stay cleared, `"resetCooldownFirst": false` is a deliberate off, and an absent key has never been
 * sent. `normalizeConfig` fills from DEFAULTS, so a body naming one key would otherwise reset every
 * other setting to the shipped value and answer `ok`.
 */
function overlayConfig(stored, body) {
  const out = Object.assign({}, (stored && typeof stored === 'object') ? stored : {});
  if (!body || typeof body !== 'object') return out;
  for (const k of Object.keys(body)) out[k] = body[k];
  return out;
}

const sameConfig = (a, b) => JSON.stringify(a) === JSON.stringify(b);

module.exports = {
  async register(host) {
    const now0 = () => Date.now();
    const quiet = {};
    /** A warning that would repeat on a timer, said at most once an hour per topic. */
    function warnQuietly(topic, text) {
      if (now0() - (quiet[topic] || 0) < QUIET_MS) return;
      quiet[topic] = now0();
      host.logger.warn(text);
    }

    // ── configuration ────────────────────────────────────────────────────────────────────────────
    //
    // `config.json` is the owner's copy, read through `host.config` — the same file the plugin card's
    // Config button edits. Version 1.0.0 kept the tab's settings in the plugin store instead, where
    // the card could not see them and the shipped `config.json` was read by nothing at all. A store
    // copy found on boot is moved into the file once, and only dropped after the file has been read
    // back holding it. On a manager where the config file cannot be written, the store copy stays
    // and keeps winning, so nothing an owner saved is ever lost in the move.
    const hasConfigApi = !!(host.config && typeof host.config.get === 'function' && typeof host.config.set === 'function');
    const fileConfig = () => {
      if (!hasConfigApi) return {};
      try { const v = host.config.get(); return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; } catch (e) { return {}; }
    };
    let legacy = (() => {
      try { const v = host.store.get('config', null); return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null; } catch (e) { return null; }
    })();
    let cfgCache = null, cfgAt = 0;
    const invalidate = () => { cfgCache = null; cfgAt = 0; };
    const rawConfig = () => (legacy ? overlayConfig(fileConfig(), legacy) : fileConfig());
    /**
     * The settings in force. Cached, because a one-second heartbeat asks for them and the answer is a
     * file read: a save and the manager's own change event drop the cache at once, and an edit made
     * on the plugin card (which raises no event) is picked up within a quarter of a minute.
     */
    function cfg() {
      if (!cfgCache || now0() - cfgAt >= CONFIG_TTL_MS || now0() < cfgAt) {
        cfgCache = normalizeConfig(rawConfig());
        cfgAt = now0();
      }
      return cfgCache;
    }
    function dropLegacy() {
      try {
        if (typeof host.store.delete === 'function') host.store.delete('config');
        else host.store.set('config', null);
      } catch (e) { /* the file already holds it; a stale copy that still equals it is harmless */ }
      legacy = null;
    }
    /** Store a whole normalized config. Returns where it landed: 'config' or 'store'. */
    function writeConfig(next) {
      if (hasConfigApi) {
        try {
          host.config.set(next);
          if (sameConfig(normalizeConfig(fileConfig()), next)) {
            if (legacy) dropLegacy();
            invalidate();
            return 'config';
          }
        } catch (e) { /* this manager cannot write the file; the store below keeps the save */ }
      }
      host.store.set('config', next);
      legacy = next;
      invalidate();
      return 'store';
    }
    if (legacy) {
      const where = writeConfig(normalizeConfig(overlayConfig(fileConfig(), legacy)));
      host.logger.info(where === 'config'
        ? 'moved the settings saved by an earlier version into config.json'
        : 'kept the settings saved by an earlier version in the plugin store, because config.json could not be written');
    }
    if (hasConfigApi && typeof host.config.onChange === 'function') {
      try { host.config.onChange(() => invalidate()); } catch (e) { /* the TTL still picks it up */ }
    }

    // ── persisted state ──────────────────────────────────────────────────────────────────────────
    // One record per base this plugin has ever evidenced a raid on. It outlives a manager restart on
    // purpose: a raid does not end because this process did.
    //
    //   { base, openedAt, lastHitAt, hits, destroyed, damage, elements, closedAt, closedByAdmin,
    //     pushes, capped, snapshotAt, knownFlags, flagsAt,
    //     flags: { <flagId>: { pushes, lastPushAt, lastTryAt, lastVerdict, before } } }
    const raids = Object.assign({}, host.store.get('raids', {}) || {});
    let history = (host.store.get('history', []) || []).slice(0, 200);
    let snapshotTaken = host.store.get('snapshotTaken', null);     // { at, note } | null — for the tab
    let historyDirty = false;

    const persistRaids = () => { try { host.store.set('raids', raids); } catch (e) { /* ignore */ } };
    const persistHistory = () => { historyDirty = false; try { host.store.set('history', history.slice(0, 200)); } catch (e) { /* ignore */ } };

    // What the last read of each source said, so the tab can show an owner why nothing is happening
    // rather than showing them a plugin that looks idle. `null` means the last attempt answered.
    const notes = { raid: null, protect: null, db: null, mode: null };
    // Why the last pass did no work at all, or null when it did. Different from a note: a note is a
    // source that could not answer, this is a pass that had no reason to ask.
    let idle = null;

    // The bridge's own names for the two modules, the words on its cards under Plugins → SSA Bridge.
    const MODULE_NAME = { raid: 'Raid detection', protect: 'Raid protection control' };
    /**
     * A source that could not answer, as a CODE the tab translates. `text` is the English fallback
     * for an older tab, and for `refused` it is the bridge's own words, which are shown as they are.
     * `module` is the bridge card's own name, which ships in English on the bridge itself.
     */
    function noteFailure(key, q, what) {
      const code = (q && q.code) || 'bridge_off';
      const shown = MODULE_NAME[what] || what;
      let text;
      if (code === 'refused') text = (q && q.reason) || null;
      else if (code === 'module_off') text = `the bridge's ${shown} module is switched off. The Bridge box on this tab turns it on`;
      else if (code === 'no_module') text = `this server runs an older SSA Bridge with no ${shown} module. Update the bridge`;
      else text = 'the SSA Bridge did not answer';
      notes[key] = { code, text, module: shown, at: now0() };
      if (code === 'bridge_off' || !text) return;
      warnQuietly('note:' + key, `${text}. No new raid evidence can arrive while that is true — nothing is being ended on that account.`);
    }
    const clearNote = (key) => { notes[key] = null; };

    const canQuery = () => !!(host.bridge && typeof host.bridge.query === 'function');
    const canCommand = () => !!(host.bridge && typeof host.bridge.command === 'function');
    /**
     * ⚠ **"THE SAVE IS THERE" IS NOT "THE SAVE CAN BE READ".** `host.db.scum.available()` is a file
     * existence test, and the manager lets go of its handle before every stop, restart and zone
     * write while the file stays on disk. In that window every read answers `null`/`[]`, which this
     * plugin used to read as "this base has no flag" and "nobody is online". So readability is
     * PROBED with a query that cannot come back empty from a readable save.
     *
     *   absent     — no save at all yet (the server has never run, or the path is wrong)
     *   unreadable — the save is there and a read did not answer (stopping, starting, restarting)
     *   readable   — a read answered
     */
    function saveState() {
      let there = false;
      try { there = host.db.scum.available() === true; } catch (e) { there = false; }
      if (!there) return 'absent';
      let r = null;
      try { r = host.db.scum.get('SELECT 1 AS one'); } catch (e) { r = null; }
      return (r && Number(r.one) === 1) ? 'readable' : 'unreadable';
    }
    const dbReadable = () => saveState() === 'readable';

    // Who connected through the bridge's own join hook. The online list read from the save lags
    // by the save interval, so without this "starts again as soon as somebody connects" would wait
    // for the next autosave.
    const liveHere = new Set();
    const sidOf = (p) => String((p && (p.steamId || p.steamid || p.SteamID || p.steam_id)) || '');

    /**
     * Is there a reason not to do any work at all right now? `null` when there is none.
     *
     * Only a POSITIVE reading idles: the game database is readable and says nobody is online. An
     * unreadable database, a missing API or a list that could not be produced is "I do not know", and
     * "I do not know" does the work.
     */
    function idleReason() {
      if (!(host.players && typeof host.players.online === 'function')) return null;
      if (liveHere.size) return null;
      if (!dbReadable()) return null;
      let list;
      try { list = host.players.online(); } catch (e) { return null; }
      if (Array.isArray(list) && list.length === 0) {
        return {
          code: 'nobody_online',
          text: 'nobody is online, so nobody can be raiding. The plugin starts looking again as soon as somebody connects, and nothing the bridge saw before is lost',
          at: now0(),
        };
      }
      return null;
    }

    // ── the save: which flags a base has, and what window each one is holding ────────────────────
    //
    // Two routes, and they were measured against each other on a real save of 28 bases: the
    // protection manager's own rows (`base_raid_protection` joined through `base_element`) named 23
    // flags on 23 bases, and the flag ELEMENTS (`base_element.asset` matching the flag blueprints)
    // named exactly the same 23 — no extras, no gaps, and not one base with two flags. The union is
    // used anyway, because the element route also finds a flag the protection manager has no row for
    // yet, and because the game's type system allows a base to have several.
    function flagsOfBase(baseId) {
      const id = Number(baseId);
      if (!(Number.isFinite(id) && id > 0)) return null;
      // ⚠ ASK WHETHER THE DATABASE IS THERE BEFORE READING AN EMPTY ANSWER AS ONE. `db.scum.all()`
      // answers `[]` for a handle that is missing and for a query that threw, exactly as it does for
      // a base with no flag — and those are opposite facts: one is "leave this base alone", the
      // other is "I could not find out". Without this the screen would tell an owner their base has
      // no flag every time the server was mid-restart. `available()` alone is not that question:
      // it stays true while the manager has let go of the save, so readability is probed.
      if (!dbReadable()) return null;
      let rows;
      try {
        rows = host.db.scum.all(
          'SELECT be.element_id AS flagId FROM base_element be'
          + ' WHERE be.base_id = ? AND be.asset LIKE ?'
          + ' UNION'
          + ' SELECT brp.base_flag_id AS flagId FROM base_raid_protection brp'
          + ' JOIN base_element be2 ON be2.element_id = brp.base_flag_id WHERE be2.base_id = ?',
          id, FLAG_ASSET_LIKE, id);
      } catch (e) { return null; }
      // Past the guard above, an empty result is a base with no flag — a real answer, and a
      // different one from `null`. The caller decides what to do with each.
      if (!Array.isArray(rows)) return null;
      return idList(rows.map((r) => r && r.flagId));
    }

    // Base names are read for the tab, which asks every ten seconds, and for every feed entry. They
    // are kept for ten minutes once READ; an unreadable database is not cached, so it is asked again.
    const names = new Map();
    function baseName(baseId) {
      const key = Number(baseId);
      const hit = names.get(key);
      if (hit && now0() - hit.at < NAME_TTL_MS && now0() >= hit.at) return hit.name;
      if (!dbReadable()) return hit ? hit.name : null;
      let name = null;
      try {
        const r = host.db.scum.get('SELECT name FROM base WHERE id = ?', key);
        name = (r && r.name) ? String(r.name) : null;
      } catch (e) { return hit ? hit.name : null; }
      if (names.size > 500) names.clear();
      names.set(key, { name, at: now0() });
      return name;
    }

    /**
     * The Duration this flag's own save row is holding, in seconds.
     *
     * `base_raid_protection.data` is twelve bytes, `u16 active, u16, u32 start, u32 duration`, so the
     * little-endian word at byte 8 is the protection duration in whole seconds. Measured across every
     * row of a real save of an OFFLINE server — 22 read 86400 against 24:00:00, and the one row whose
     * protection had been cleared reads 0. Only a flag-specific server reaches this, and no save of one
     * has been read (see the header).
     *
     * Three different answers, and they must stay apart:
     *   a number > 0 — this is the window the flag is holding (it may be longer than can be sent)
     *   0            — the game is holding an entry with nothing in it (an owner is online)
     *   null         — the row, the column or the database could not be read
     */
    function savedDuration(flagId) {
      let row;
      try { row = host.db.scum.get('SELECT data FROM base_raid_protection WHERE base_flag_id = ?', Number(flagId)); }
      catch (e) { return null; }
      if (!row || !row.data) return null;
      let b;
      try { b = Buffer.from(row.data); } catch (e) { return null; }
      if (b.length < 12) return null;
      return b.readUInt32LE(8);
    }

    /** The running game's own decoded window for one flag, or null. Needs the `protect` module on. */
    async function liveWindow(flagId, cache) {
      const key = String(flagId);
      if (cache.flags.has(key)) return cache.flags.get(key);
      let out = null;
      if (canQuery()) {
        const q = await host.bridge.query('protect', `flag:${Number(flagId)}`);
        if (q && q.ok) {
          clearNote('protect');
          const d = q.data || {};
          const dur = Number(d.durationSeconds);
          out = {
            active: d.active === true ? true : (d.active === false ? false : null),
            durationSeconds: (Number.isFinite(dur) && dur > 0) ? dur : null,
          };
        } else {
          // A flag the manager holds no entry for refuses BY NAME and that is a real answer about
          // the world, not a fault worth putting on the tab.
          if (!(q && q.code === 'refused')) noteFailure('protect', q, 'protect');
          out = null;
        }
      }
      cache.flags.set(key, out);
      return out;
    }

    // `code` and `params` are what the tab translates; `why` is the English fallback for an older tab.
    const tooLong = (seconds, where) => ({
      seconds: null, source: null,
      code: 'too_long',
      params: { hours: Math.round(seconds / 3600), max: MAX_WINDOW / 3600, from: where === 'the save' ? 'save' : 'game' },
      why: `${where} says this base's protection lasts ${Math.round(seconds / 3600)} hours, which is longer than the ${MAX_WINDOW / 3600} hours the SSA Bridge will ever send. Writing a shorter length back would take protection away, so it is not pushed. To push it anyway, set a fixed protection length under More options`,
    });

    /**
     * Which Duration to write for this flag, and where it came from.
     *
     * Returns `{ seconds, source }` or `{ seconds: null, source: null, why }`. Nothing here ever
     * substitutes a plausible number for one it could not read.
     */
    async function durationFor(flagId, c, cache) {
      if (c.durationSeconds != null) return { seconds: c.durationSeconds, source: 'configured' };
      const saved = savedDuration(flagId);
      if (saved != null && saved > 0) {
        if (saved > MAX_WINDOW) return tooLong(saved, 'the save');
        return { seconds: saved, source: 'saved' };
      }
      if (c.allowDecodedDuration) {
        const live = await liveWindow(flagId, cache);
        if (live && live.durationSeconds) {
          if (live.durationSeconds > MAX_WINDOW) return tooLong(live.durationSeconds, 'the running game');
          return { seconds: live.durationSeconds, source: 'decoded' };
        }
      }
      const why = (saved === 0)
        ? 'the save holds no protection length for this base right now (the game writes 0 while an owner is online), and the running game did not offer one either'
        : 'neither the save nor the running game could say how long this base\'s protection lasts';
      return {
        seconds: null, source: null,
        code: saved === 0 ? 'no_length_now' : 'no_length', params: {},
        why: `${why}. To push it anyway, set a fixed protection length under More options`,
      };
    }

    // ── reading the raid feed ───────────────────────────────────────────────────────────────────
    //
    // `all` rather than `raids`: a window that has just gone quiet is still the one this plugin is
    // holding open, and its own `holdSeconds` — not the bridge's `activeSeconds` — decides when it is
    // over.
    async function readRaids() {
      if (!canQuery()) { noteFailure('raid', null, 'raid'); return null; }
      const q = await host.bridge.query('raid', 'all');
      if (!q || !q.ok) { noteFailure('raid', q, 'raid'); return null; }
      clearNote('raid');
      const d = q.data || {};
      return Array.isArray(d.raids) ? d.raids : null;
    }

    /** Does this row carry enough evidence to OPEN a window? */
    function qualifies(row, c) {
      if (row.declared === true && !c.acceptDeclared) return false;
      const destroyed = Number(row.destroyed);
      if (Number.isFinite(destroyed) && destroyed >= 1) return true;    // a structure came down
      const hits = Number(row.hits);
      return Number.isFinite(hits) && hits >= c.minHits;
    }

    /** When the last hit on this row landed, as an absolute instant, or null. */
    function hitInstant(row, now) {
      const ms = Number(row.lastHitMs);
      if (!(Number.isFinite(ms) && ms >= 0 && ms <= 86400000 * 30)) return null;
      return now - ms;
    }

    const rec = (base) => {
      if (!raids[base]) {
        raids[base] = {
          base: Number(base), openedAt: 0, lastHitAt: 0, hits: 0, destroyed: 0, damage: 0,
          elements: 0, closedAt: 0, pushes: 0, flags: {},
        };
      }
      return raids[base];
    };

    const isOpen = (r) => !!(r && r.openedAt && !r.closedAt);

    /** Take the larger of each counter. Returns whether anything moved. */
    function absorb(r, row) {
      let moved = false;
      for (const [k, v] of [['hits', row.hits], ['destroyed', row.destroyed], ['damage', row.damage], ['elements', row.elements]]) {
        const n = Number(v);
        if (Number.isFinite(n) && n > (r[k] || 0)) { r[k] = n; moved = true; }
      }
      return moved;
    }

    /** Add a feed entry. Written to the store once per pass, not once per entry. */
    function remember(what) {
      history.unshift(Object.assign({ at: now0() }, what));
      history = history.slice(0, 200);
      historyDirty = true;
    }

    // ── the write ───────────────────────────────────────────────────────────────────────────────

    /**
     * Make sure the bridge holds a baseline of every flag's window before anything is written.
     *
     * Asked once per raid window rather than once for ever: the bridge keeps its snapshot in memory,
     * so a server restart drops it, and a "baseline recorded" remembered here from last week would be
     * a claim about a bridge that no longer has one. The bridge keeps one snapshot at a time and
     * refuses a second while one exists — so asking is cheap, and that refusal is not a failure here:
     * a baseline exists either way, which is the thing being asked for.
     */
    async function ensureSnapshot() {
      if (!canCommand()) return null;
      const r = (await host.bridge.command('protect', 'snapshot')) || {};
      const already = refusedAs(r, 'snapshot_exists', /snapshot already exists/i);
      if (!r.ok && !already) {
        warnQuietly('snapshot', `could not record a baseline of the protection state before writing: ${r.reason || r.error || 'the bridge did not say why'}`);
        return null;
      }
      const at = now0();
      if (!already || !snapshotTaken) {
        snapshotTaken = { at, note: already ? 'a baseline was already recorded' : (r.note || 'baseline recorded') };
        try { host.store.set('snapshotTaken', snapshotTaken); } catch (e) { /* ignore */ }
      }
      return { at };
    }

    /**
     * ══ WHY A REFUSAL SAID NO — THE TOKEN FIRST, THE ENGLISH ONLY FOR AN OLDER BRIDGE ═══════════
     *
     * This plugin used to tell its six refusals apart by matching the bridge's SENTENCE —
     * `/unknown verb 'postpone'/`, `/already running/i`, `/for offline raid protection only/i`,
     * `/no raid-protection manager/i`, `/snapshot already exists/i`, and a range limit parsed out of
     * the wording with a capture group. Every one of those breaks the moment somebody improves the
     * sentence, and the reason text is the part of that surface that is MEANT to be rewritten.
     *
     * Since bridge **2.29.1** a refusal carries a machine token beside the sentence, and the SDK
     * hands it up as `reasonCode`. So the token is asked first and the regex is kept only as the
     * fallback for a bridge that predates it.
     *
     * ⚠ **`reasonCode` IS NOT `code`.** `code` classifies the whole call — `bridge_off`,
     * `no_module`, `module_off`, `refused` — and answers whether it could be asked at all. This one
     * is the module's answer to why it said no, and only exists inside `refused`.
     *
     * ⚠ **AN ABSENT TOKEN IS NOT A VERDICT**, so the prose fallback still runs when there is none.
     * Owners run the bridge they have, and a plugin that treats `null` as "not that reason" would
     * quietly stop recognising all six on every server that has not updated.
     *
     * ⚠ **`unknown_verb` IS THE VERSION GATE, AND THERE IS NO VERB CATALOGUE TO ASK INSTEAD.**
     * Telling an owner their bridge is too old for `postpone` used to mean matching the words
     * *"unknown verb 'postpone'"*, and the obvious replacement — ask the bridge which verbs it has —
     * was proposed and REFUSED for a reason worth keeping: publishing one needs a new virtual on
     * the bridge's module base class across all of its modules, and adding one there shifts every
     * vtable slot after it with no compiler error. The token answers the same question with no
     * parsing and no risk, so this is settled rather than pending.
     */
    function refusedAs(r, token, fallbackRe) {
      if (!r || r.ok !== false || r.code !== 'refused') return false;
      if (typeof r.reasonCode === 'string' && r.reasonCode) return r.reasonCode === token;
      return !!fallbackRe && fallbackRe.test(String(r.reason || r.error || ''));
    }

    /**
     * The `protect` module's own `maxValue` — the ceiling it refuses a delay or a duration above.
     *
     * Read off the module's CARD rather than parsed out of the refusal sentence. `bad_value` says
     * THAT the number was out of range; it does not say what the range is, and the limit is a
     * setting an owner can see and change. A capture group over the wording answered the same
     * question by reading prose, and would have kept answering until the sentence was reworded.
     *
     * Memoised for a few minutes: it is a setting, so it changes when somebody saves the card, and
     * this is only ever asked on a refusal. `null` when it could not be read, which is a real answer
     * and is why the sentence below is built in two halves.
     */
    const MAXVALUE_LABEL = 'Refuse Delay or Duration above';   // the bridge schema's own label, if the card cannot be read
    let maxValueSeen = { at: 0, value: null, label: MAXVALUE_LABEL, moduleName: MODULE_NAME.protect };
    const MAXVALUE_TTL_MS = 300000;
    async function protectMaxValue() {
      if (maxValueSeen.at && Date.now() - maxValueSeen.at < MAXVALUE_TTL_MS) return maxValueSeen;
      let v = null, label = MAXVALUE_LABEL, moduleName = MODULE_NAME.protect;
      try {
        const list = (host.bridge && typeof host.bridge.modules === 'function')
          ? await host.bridge.modules() : null;
        const m = (Array.isArray(list) ? list : []).find((x) => x && String(x.id) === 'protect');
        const raw = m && m.config ? Number(m.config.maxValue) : NaN;
        if (Number.isFinite(raw) && raw > 0) v = raw;
        // The setting's name and the card's name are read off the module itself, so the sentence
        // names the control the owner really sees.
        const field = m && Array.isArray(m.schema) ? m.schema.find((f) => f && f.key === 'maxValue') : null;
        if (field && typeof field.label === 'string' && field.label) label = field.label;
        if (m && typeof m.name === 'string' && m.name) moduleName = m.name;
      } catch (e) { v = null; }
      maxValueSeen = { at: Date.now(), value: v, label, moduleName };
      return maxValueSeen;
    }

    /**
     * The bridge's refusal, and — for a range refusal — the setting that decides it.
     *
     * Returns `{ text, code, params }`. `text` is the bridge's own sentence, shown as it is. The
     * route to the setting is NOT written here: the tab builds it from the panel's own words, so it
     * is right in every language and survives a renamed tab. `code` is `range` or `bridge`.
     */
    async function explainRefusal(text, r) {
      const said = String(text || '');
      // A bridge that already names the setting says it once; saying it again reads as two limits.
      if (/Refuse Delay or Duration above/.test(said)) return { text: said, code: 'bridge', params: {} };
      const isRange = refusedAs(r, 'bad_value',
        /(delay|duration) must be a (?:plain decimal )?number between 0 and \d+/i);
      if (!isRange) return { text: said, code: 'bridge', params: {} };
      const m = await protectMaxValue();
      // `limit: null` is "I could not read the card", which is a different fact from a number and
      // must not put one in front of an owner.
      return { text: said, code: 'range', params: { limit: m.value, setting: m.label, module: m.moduleName } };
    }

    /**
     * Push one flag's protection start out.
     *
     * ⚠ **`accepted: true` is not "it worked".** The bridge reads the flag's stored state either side
     * of the call on the same frame and answers `changed` — true when the flag's packed protection
     * word or its last-changed stamp moved, false when it did not, and absent when it could not be
     * read. That is the field this plugin records and shows; a call that was accepted and moved
     * nothing is written down as exactly that, not as a success.
     *
     * Only a call the bridge DISPATCHED counts towards the per-raid ceiling. A refusal wrote nothing,
     * and counting it would let a switch that was off for ten minutes use up a raid's whole allowance.
     */
    async function push(record, flagId, c, cache, delaySeconds) {
      const delay = Number.isFinite(delaySeconds) ? delaySeconds : c.pushSeconds;
      const f = record.flags[flagId] || (record.flags[flagId] = { pushes: 0, lastPushAt: 0, lastTryAt: 0, lastVerdict: null, before: null });
      f.lastTryAt = now0();
      const dur = await durationFor(flagId, c, cache);
      if (dur.seconds == null) {
        f.lastVerdict = { ok: false, state: 'no_duration', code: dur.code || null, params: dur.params || {}, text: dur.why, at: now0() };
        return false;
      }

      // The flag's own state before this plugin ever touched it — recorded once, so an owner can see
      // what they had. Restoring a value nobody read is not restoring.
      if (!f.before) {
        const live = await liveWindow(flagId, cache);
        f.before = {
          at: now0(),
          savedDurationSeconds: savedDuration(flagId),
          liveDurationSeconds: live ? live.durationSeconds : null,
          liveActive: live ? live.active : null,
        };
      }

      if (!record.snapshotAt) {
        const s = await ensureSnapshot();
        if (s) record.snapshotAt = s.at;
      }

      if (c.resetCooldownFirst) {
        const r0 = (await host.bridge.command('protect', `reset:${Number(flagId)}`)) || {};
        if (!r0.ok) warnQuietly('reset', `the cooldown reset before a push was refused: ${r0.reason || r0.error || 'no reason given'}`);
      }

      const r = (await host.bridge.command('protect', `set:${Number(flagId)}:${delay}:${dur.seconds}`)) || {};
      const at = now0();
      if (r.ok === true) {
        f.lastPushAt = at;
        f.pushedForHitAt = record.lastHitAt;
        f.pushes = (f.pushes || 0) + 1;
        record.pushes = (record.pushes || 0) + 1;
      }

      // `text` is the bridge's own words or nothing: the tab says what each state means in its own
      // translated words, and shows the bridge's note beside it. An English sentence invented here
      // would reach every language untranslated.
      let state, text, code = null, params = {};
      if (!r.ok) {
        state = 'refused';
        const ex = await explainRefusal(r.reason || r.error || '', r);
        text = ex.text || null; code = ex.code; params = ex.params;
      } else if (r.changed === true) {
        state = 'moved';
        text = r.note || null;
      } else if (r.changed === false) {
        state = 'unchanged';
        text = r.note || null;
      } else {
        state = 'unconfirmed';
        text = r.note || null;
      }
      f.lastVerdict = { ok: r.ok === true, state, code, params, text, at };

      remember({
        base: record.base, baseName: baseName(record.base), flag: Number(flagId),
        delaySeconds: delay, durationSeconds: dur.seconds, durationSource: dur.source,
        state, code, params, text,
        evidence: {
          hits: record.hits, destroyed: record.destroyed, damage: record.damage,
          elements: record.elements, lastHitAgoSeconds: Math.round((at - record.lastHitAt) / 1000),
        },
      });
      return r.ok === true;
    }

    // ── which protection mode the server runs ───────────────────────────────────────────────────
    //
    // `{ kind, managerClass, at, text }`, where `kind` is offline | flagSpecific | global | none |
    // unknown. Only a real answer naming offline, flag-specific or global is kept for five minutes;
    // "no manager" (a server still starting looks the same as one with protection off) and "could not
    // ask" are asked again on the next pass that has a raid to push.
    let modeInfo = null;
    async function readMode() {
      const t = now0();
      if (modeInfo && MODE_BY_CLASS[modeInfo.managerClass] && t - modeInfo.at < MODE_TTL_MS && t >= modeInfo.at) return modeInfo;
      // `code` is what the tab translates, `cause` the note that explains an unreadable mode, and
      // `text` the English fallback for an older tab.
      if (!canQuery()) {
        modeInfo = { kind: 'unknown', code: 'unreadable', cause: { code: 'bridge_off', module: MODULE_NAME.protect }, managerClass: null, at: t, text: 'the SSA Bridge did not answer, so the plugin cannot tell which raid protection this server runs. Nothing is pushed until it can' };
        return modeInfo;
      }
      const q = await host.bridge.query('protect', 'manager');
      if (q && q.ok) {
        clearNote('protect');
        const cls = (q.data && typeof q.data.managerClass === 'string') ? q.data.managerClass : null;
        const kind = (cls && MODE_BY_CLASS[cls]) || 'unknown';
        let text = null, code = null;
        if (kind === 'global') { code = 'global'; text = 'this server runs global raid protection, which protects bases by the clock rather than by who is online. There is nothing for this plugin to push'; }
        else if (kind === 'unknown') { code = 'unknown_class'; text = `the server runs a raid-protection manager this plugin does not know (${cls || 'it could not be named'}), so nothing is pushed`; }
        modeInfo = { kind, code, cause: null, managerClass: cls, at: t, text };
        return modeInfo;
      }
      if (refusedAs(q, 'no_manager', /no raid-protection manager/i)) {
        modeInfo = { kind: 'none', code: 'none', cause: null, managerClass: null, at: t, text: 'the game has no raid-protection manager right now: either the server runs no raid protection, or it is still starting. Nothing is pushed' };
        return modeInfo;
      }
      noteFailure('protect', q, 'protect');
      const said = notes.protect && notes.protect.text ? notes.protect.text : 'the SSA Bridge did not answer';
      const cause = notes.protect ? { code: notes.protect.code, module: notes.protect.module, text: notes.protect.text } : { code: 'bridge_off', module: MODULE_NAME.protect };
      modeInfo = { kind: 'unknown', code: 'unreadable', cause, managerClass: null, at: t, text: `${said}, so the plugin cannot tell which raid protection this server runs. Nothing is pushed until it can` };
      return modeInfo;
    }

    /**
     * One flag's OFFLINE protection as the server decides with it, or null.
     * `{ armed, running, startsInSeconds, durationSeconds }` — each key only when the bridge sent it.
     */
    async function offlineReading(flagId) {
      if (!canQuery()) return null;
      const q = await host.bridge.query('protect', `offline:${Number(flagId)}`);
      if (!q || !q.ok || !q.data) return null;
      const d = q.data;
      const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
      return {
        armed: d.armed === true ? true : (d.armed === false ? false : null),
        running: d.running === true ? true : (d.running === false ? false : null),
        startsInSeconds: num(d.startsInSeconds),
        durationSeconds: num(d.durationSeconds),
      };
    }

    /**
     * Push one flag's OFFLINE protection start out: `postpone:<flag>:<seconds>`.
     *
     * The bridge moves a start only LATER and only while it is still to come, and says which of its
     * outcomes it reached. `changed: true` is a start that moved. `changed: false` is a real answer
     * that nothing needed doing — the entry is not armed because a defender is still online, or it
     * already starts later than this push would set. A refusal saying protection is ALREADY RUNNING is
     * kept apart from other refusals: the plugin never takes protection away, and the tab says so.
     *
     * Only a start that moved counts towards the per-raid ceiling (see the header).
     */
    async function pushOffline(record, flagId, c, delaySeconds) {
      const delay = Math.round(Number.isFinite(delaySeconds) ? delaySeconds : c.pushSeconds);
      const f = record.flags[flagId] || (record.flags[flagId] = { pushes: 0, lastPushAt: 0, lastTryAt: 0, lastVerdict: null, before: null });
      f.lastTryAt = now0();

      if (!f.before) {
        const live = await offlineReading(flagId);
        f.before = {
          at: now0(), mode: 'offline',
          armed: live ? live.armed : null,
          running: live ? live.running : null,
          startsInSeconds: live ? live.startsInSeconds : null,
          liveDurationSeconds: live ? live.durationSeconds : null,
        };
      }

      if (!record.snapshotAt) {
        const s = await ensureSnapshot();
        if (s) record.snapshotAt = s.at;
      }

      const r = (await host.bridge.command('protect', `postpone:${Number(flagId)}:${delay}`)) || {};
      const at = now0();

      /**
       * ══ THE FIVE ANSWERS, AND THEY ARE NOT ALL THE SAME KIND OF ANSWER ═══════════════════════
       *
       * This block used to decide all five by matching the bridge's English. Three of them are
       * REFUSALS and now carry a machine token (`reasonCode`, bridge 2.29.1 and newer), asked
       * through `refusedAs()` with the old regex kept as the fallback for an older bridge.
       *
       * ⚠ **THE OTHER TWO ARE SUCCESSES AND NO TOKEN WILL EVER APPEAR ON THEM.** `postpone` on a
       * flag that is not armed, one whose window has already run its course, and one that already
       * starts later than asked all answer `ok: true` with `accepted: true, changed: false` and a
       * note — the verb took the call and correctly did nothing. A rule waiting for a `reasonCode`
       * there waits for ever. **`changed === false` is the test**, and converting these two the
       * same way as the three above is the mistake this comment exists to prevent.
       */
      let state, text, code = null, params = {};
      if (!r.ok) {
        const reason = String(r.reason || r.error || '');
        if (refusedAs(r, 'unknown_verb', /unknown verb 'postpone'/)) {
          state = 'refused';
          code = 'bridge_too_old';
          text = 'this server runs an SSA Bridge that cannot postpone offline protection yet. Update the SSA Bridge';
        } else if (refusedAs(r, 'already_running', /already running/i)) {
          state = 'running';
          text = reason || null;
        } else if (r.code === 'refused') {
          state = 'refused';
          const ex = await explainRefusal(reason, r);
          text = ex.text || null; code = ex.code; params = ex.params;
          // The server was restarted into another mode since the mode was last read: ask again next pass.
          if (refusedAs(r, 'wrong_protection_type', /for offline raid protection only/i)) modeInfo = null;
        } else {
          state = 'refused';
          noteFailure('protect', r, 'protect');
          // Not the bridge's words: the bridge could not be asked. The tab says so from the code.
          code = 'note';
          params = { note: notes.protect ? notes.protect.code : 'bridge_off', module: MODULE_NAME.protect };
          text = (notes.protect && notes.protect.text) || 'the SSA Bridge did not answer';
        }
      } else if (r.changed === true) {
        state = 'moved';
        text = r.note || null;
      } else if (r.changed === false) {
        /**
         * ⚠ **A SUCCESS, AND THE LAST ENGLISH TEST IN THIS FILE — DELIBERATELY.**
         *
         * Three of the bridge's no-op paths land here and they are all `changed: false`: the entry
         * is not armed (a defender is still online), the window has already run its course, and the
         * start is already further out than this push would set. Only the third is worth a
         * different badge — *"already later"* is good news and *"nothing needed changing"* is
         * neutral — and the bridge does not separate them on the wire, because a token is for a
         * REFUSAL and none of these refused anything.
         *
         * So the distinction is cosmetic and the fallback if the wording moves is the neutral
         * badge, which is the safe direction. **Do not "fix" this by waiting for a `reasonCode`:**
         * one will never come. What would remove it is a distinguishing FIELD on the three
         * `say_unchanged` paths, which is a bridge change nobody has asked for.
         */
        state = /already starts in/i.test(String(r.note || '')) ? 'later' : 'unchanged';
        text = r.note || null;
      } else {
        state = 'unconfirmed';
        text = r.note || null;
      }

      if (r.ok === true) f.pushedForHitAt = record.lastHitAt;
      if (state === 'moved') {
        f.lastPushAt = at;
        f.pushes = (f.pushes || 0) + 1;
        record.pushes = (record.pushes || 0) + 1;
      }

      const prev = f.lastVerdict ? f.lastVerdict.state : null;
      f.lastVerdict = { ok: r.ok === true, state, code, params, text, at, mode: 'offline' };

      // A push that moved, or anything that went wrong, is always listed. "Nothing needed doing" is
      // listed when it is NEW, so a defender sitting online for an evening is one line, not thirty.
      if (state === 'moved' || state === 'refused' || state === 'running' || state === 'unconfirmed' || state !== prev) {
        remember({
          base: record.base, baseName: baseName(record.base), flag: Number(flagId), mode: 'offline',
          delaySeconds: delay, durationSeconds: null, durationSource: null,
          state, code, params, text,
          evidence: {
            hits: record.hits, destroyed: record.destroyed, damage: record.damage,
            elements: record.elements, lastHitAgoSeconds: Math.round((at - record.lastHitAt) / 1000),
          },
        });
      }
      return state === 'moved';
    }

    // ── one pass ────────────────────────────────────────────────────────────────────────────────
    async function poll() {
      const c = cfg();
      const now = now0();
      const cache = { flags: new Map() };
      let dirty = false;

      idle = idleReason();

      // 1) take in whatever evidence there is. A tick that learns nothing changes nothing.
      const rows = idle ? null : await readRaids();
      if (rows) {
        for (const row of rows) {
          const base = Number(row && row.base);
          if (!(Number.isFinite(base) && base > 0)) continue;
          const at = hitInstant(row, now);
          if (at == null) continue;
          if (row.declared === true && !c.acceptDeclared) continue;
          const known = raids[base];

          if (isOpen(known)) {
            // KEEPING a window open takes any further real hit, not the opening floor: the bridge
            // restarts its counters after a pause, and a raid that resumes below the floor is still
            // the same raid. MONOTONIC — an older reading cannot pull the instant back.
            if (at > known.lastHitAt) { known.lastHitAt = at; dirty = true; }
            if (absorb(known, row)) dirty = true;
            continue;
          }

          // OPENING one takes evidence that is FRESH, NEW and over the floor.
          if (c.exemptBaseIds.indexOf(base) >= 0) continue;
          if (now - at >= c.holdSeconds * 1000) continue;          // quiet for a whole hold already
          if (!qualifies(row, c)) continue;
          if (known && !(at > known.lastHitAt)) continue;          // the hit the last window closed on
          const r = rec(base);
          // The gap SINCE the last evidenced hit, read before the update below overwrites it. It is
          // what tells a raid that never stopped from a new one that started later.
          const gap = r.lastHitAt ? (at - r.lastHitAt) : Infinity;
          r.lastHitAt = at;
          dirty = true;
          // ⚠ AN ADMIN WHO PRESSED "STOP PUSHING" IS NOT OVERRULED BY THE RAID THAT IS STILL GOING
          // ON. Without this the button did nothing an owner could see: the record closed, the very
          // next pass saw the same live raid row and re-opened it, and the writing carried straight
          // on. The suppression is not permanent either — once this base has been quiet for a full
          // hold period, a fresh hit is a NEW raid and opens a new window.
          if (r.closedByAdmin && gap < c.holdSeconds * 1000) continue;
          r.openedAt = now;
          r.closedAt = 0;
          r.closedByAdmin = false;
          r.pushes = 0;
          r.capped = false;
          r.snapshotAt = 0;
          r.flags = {};
          r.knownFlags = null;
          r.flagsAt = 0;
          // A new raid's evidence is its own. The last raid's counters are not carried into it.
          r.hits = 0; r.destroyed = 0; r.damage = 0; r.elements = 0;
          absorb(r, row);
          host.logger.info(`base ${base} is under raid (${Number(row.hits) || 0} hit(s), ${Number(row.destroyed) || 0} destroyed) — its protection window will be pushed out while this lasts`);
        }
      }

      // 2) close only on the positive fact: real time with no new evidence.
      for (const key of Object.keys(raids)) {
        const r = raids[key];
        if (r.closedAt) continue;
        if (!(r.lastHitAt > 0)) continue;
        if (now - r.lastHitAt >= c.holdSeconds * 1000) {
          r.closedAt = now;
          dirty = true;
          host.logger.info(`base ${r.base} has taken no further damage for ${c.holdSeconds}s — its protection window is no longer being pushed`);
          remember({ base: r.base, baseName: baseName(r.base), flag: null, state: 'closed', code: 'quiet', params: { minutes: Math.round(c.holdSeconds / 60) }, text: `no damage for ${Math.round(c.holdSeconds / 60)} minutes, so the raid is over. Protection starts when the last push said it would` });
        }
      }

      // 3) push the open ones — unless there is nobody a push could travel through, or the mode the
      //    server runs cannot be read. The mode is asked only when there is something to push.
      let mode = null;
      const anyToPush = Object.keys(raids).some((k) => isOpen(raids[k]) && c.exemptBaseIds.indexOf(raids[k].base) < 0);
      if (!anyToPush) notes.mode = null;
      if (!idle && canCommand() && anyToPush) {
        mode = await readMode();
        const pushable = mode.kind === 'offline' || mode.kind === 'flagSpecific';
        notes.mode = pushable ? null : {
          code: mode.code || mode.kind, kind: mode.kind, cls: mode.managerClass || null, cause: mode.cause || null,
          text: mode.text || 'the raid protection this server runs could not be read', at: now0(),
        };
        if (!pushable) {
          warnQuietly('mode:' + mode.kind, `${mode.text || 'the raid protection mode could not be read'}.`);
          mode = null;
        }
      }
      if (mode) {
        for (const key of Object.keys(raids)) {
          const r = raids[key];
          if (r.closedAt) continue;
          if (c.exemptBaseIds.indexOf(r.base) >= 0) continue;
          if ((r.pushes || 0) >= c.maxPushesPerRaid) {
            if (!r.capped) {
              r.capped = true;
              dirty = true;
              remember({ base: r.base, baseName: baseName(r.base), flag: null, state: 'capped', code: 'capped', params: { pushes: r.pushes }, text:`this raid has been pushed ${r.pushes} time(s), the most “Most pushes for one raid” allows. Nothing more is pushed until it ends` });
            }
            continue;
          }
          // Which flags the base has changes when somebody places or removes one, not every twenty
          // seconds, and a push is due at most once per re-apply period — so the save is asked once
          // per period rather than once per pass.
          if (!Array.isArray(r.knownFlags) || !(now - (r.flagsAt || 0) < c.reapplySeconds * 1000) || now < (r.flagsAt || 0)) {
            const flags = flagsOfBase(r.base);
            if (flags === null) {
              // The LAST reading is dropped rather than left on the screen: a list that resolved an hour
              // ago, shown now, says "these are this base's flags" about a database nobody can read.
              r.knownFlags = null;
              r.flagsAt = 0;
              notes.db = { code: 'save_unreadable', text: 'the game database could not be read, so the plugin cannot find this base\'s flag yet', at: now0() };
              warnQuietly('note:db', 'the game database could not be read, so the plugin cannot find a raided base\'s flag yet. Nothing is being ended on that account.');
              continue;
            }
            clearNote('db');
            r.knownFlags = flags;
            r.flagsAt = now;
          }
          /**
           * ⚠ **EVERY HIT RESTARTS THE COUNTDOWN.** The owner: *"kdyz tam neco poskodej … tak se zase ten
           * odpocet vyresetuje a bude se odpocitavat zase hodina do aktivace offline protekce"* — a base
           * under attack behaves as if its owner had only just logged off, from the LAST hit. So the
           * delay written is what is left of `pushSeconds` since that hit, rather than a fresh
           * `pushSeconds` from whenever the push happens to run: repeating the push then moves nothing,
           * and protection starts exactly that long after the last damage. A new hit is pushed on the
           * next pass (at most once a minute per flag); without one, the repeat only re-states the same
           * moment, which is what catches a game that re-armed the flag when its owner logged out.
           */
          const sinceHit = Math.max(0, Math.round((now - r.lastHitAt) / 1000));
          const left = c.pushSeconds - sinceHit;
          for (const flagId of r.knownFlags) {
            if (c.exemptFlagIds.indexOf(flagId) >= 0) continue;
            const f = r.flags[flagId];
            const last = f ? (f.lastTryAt || f.lastPushAt || 0) : 0;
            // ⚠ ON OFFLINE PROTECTION, "NOT ARMED YET" IS ASKED AGAIN WITHIN A MINUTE, NOT A RE-APPLY
            // PERIOD LATER. The game arms the flag the moment the last defender logs out, to start after
            // the SERVER's own start delay — and an owner who set that delay shorter than the repeat
            // would see protection switch on between two pushes, ending the raid this plugin exists to
            // keep going. A push on an entry that is not armed writes nothing, so asking once a minute
            // costs a read, and the feed still says it once.
            const waitMs = (mode.kind === 'offline' && f && f.lastVerdict && f.lastVerdict.state === 'unchanged')
              ? Math.min(c.reapplySeconds, 60) * 1000 : c.reapplySeconds * 1000;
            if (c.countFromLastHit) {
              if (left < 60) continue;                                   // protection is about to start anyway
              const newHit = !f || !(f.pushedForHitAt >= r.lastHitAt);
              const dueByHit = newHit && (!last || now - last >= 60000 || now < last);
              const dueByRepeat = !last || now - last >= waitMs || now < last;
              if (!dueByHit && !dueByRepeat) continue;
            } else if (last && now - last < waitMs && now >= last) continue;
            if ((r.pushes || 0) >= c.maxPushesPerRaid) break;
            if (mode.kind === 'offline') await pushOffline(r, flagId, c, c.countFromLastHit ? left : undefined);
            else await push(r, flagId, c, cache, c.countFromLastHit ? left : undefined);
            dirty = true;
          }
        }
      }

      // 4) forget a closed raid once nothing will ever look at it again.
      for (const key of Object.keys(raids)) {
        const r = raids[key];
        if (r.closedAt && now - r.closedAt > 7 * 86400000) { delete raids[key]; dirty = true; }
      }

      if (dirty) persistRaids();
      if (historyDirty) persistHistory();
    }

    // ── scheduling ──────────────────────────────────────────────────────────────────────────────
    // A 1 s heartbeat that runs the pass when it is due, so a changed interval applies without a
    // manager restart. The heartbeat itself reads nothing: the config it consults is cached.
    let lastRun = 0, busy = false;
    host.schedule.every(1000, () => {
      if (busy) return;
      const c = cfg();
      if (!c.enabled) return;
      const t = now0();
      if (t - lastRun < c.pollSeconds * 1000 && t >= lastRun) return;
      busy = true; lastRun = t;
      poll().catch((e) => host.logger.warn('pass failed: ' + e.message)).then(() => { busy = false; }, () => { busy = false; });
    });

    // Somebody connecting ends the "nobody is online" idle at once, rather than at the next autosave.
    try {
      if (host.players && typeof host.players.onJoin === 'function') {
        host.players.onJoin((p) => { const s = sidOf(p); if (s) liveHere.add(s); lastRun = 0; });
      }
      if (host.players && typeof host.players.onLeave === 'function') {
        host.players.onLeave((p) => { const s = sidOf(p); if (s) liveHere.delete(s); });
      }
    } catch (e) { /* an older manager has no join hook; the saved list still decides */ }

    /**
     * Is this alert a base being DAMAGED? Only that may keep a raid going.
     *
     * `raid:alert` also carries stolen cars, opened chests, picked locks and every protection status
     * change, and letting those count kept a raid "going" because somebody's car was taken. Since
     * the manager sends `subType`, an attack is `type: 'raid', subType: 'attack'`. An older manager
     * sends no `subType`, and there the attack is the one `raid` alert that names an `object` — the
     * protection status alerts name none.
     */
    function isAttackAlert(e) {
      if (!e || e.type !== 'raid') return false;
      if (e.subType === 'attack') return true;
      if (e.subType != null) return false;
      const o = e.object;
      if (!o || typeof o !== 'object') return false;
      return o.kind == null || o.kind === 'structure';
    }

    const ALERT_NEAR_CM = 5000;     // the manager's own window for "the base this destruction belongs to"
    /**
     * Which bases an attack alert is about.
     *
     * By WHERE it happened first: the alert carries the position of the destroyed part, and the
     * nearest surviving element of a base within 50 m is that base's (the manager measured no two
     * bases' elements inside that window). Only when there is no position, or nothing near it, the
     * OWNER is used — and the owner of a base is the owner of its FLAG element, never
     * `base.owner_user_profile_id`, which is the founder and names the wrong player on many bases.
     * `null` means the save could not be read.
     */
    function basesForAlert(e) {
      if (!dbReadable()) return null;
      const loc = e && e.location;
      const x = loc ? Number(loc.x) : NaN, y = loc ? Number(loc.y) : NaN, z = loc ? Number(loc.z) : NaN;
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        let near = null;
        try {
          near = host.db.scum.get(
            'SELECT base_id AS baseId, ((location_x - ?) * (location_x - ?) + (location_y - ?) * (location_y - ?)'
            + ' + (location_z - ?) * (location_z - ?)) AS d2 FROM base_element'
            + ' WHERE location_x BETWEEN ? AND ? AND location_y BETWEEN ? AND ? ORDER BY d2 ASC LIMIT 1',
            x, x, y, y, z, z, x - ALERT_NEAR_CM, x + ALERT_NEAR_CM, y - ALERT_NEAR_CM, y + ALERT_NEAR_CM);
        } catch (err) { near = null; }
        const id = near ? Number(near.baseId) : NaN;
        if (Number.isFinite(id) && id > 0 && Math.sqrt(Number(near.d2)) <= ALERT_NEAR_CM) return [id];
      }
      const sid = e && e.ownerSteamId ? String(e.ownerSteamId) : null;
      if (!sid) return [];
      let owned;
      try {
        owned = host.db.scum.all(
          'SELECT DISTINCT be.base_id AS id FROM base_element be'
          + ' JOIN user_profile up ON up.id = be.owner_profile_id'
          + ' WHERE up.user_id = ? AND be.asset LIKE ?',
          sid, FLAG_ASSET_LIKE);
      } catch (err) { return null; }
      return Array.isArray(owned) ? idList(owned.map((r) => r && r.id)) : null;
    }

    // The manager's own base attack alerts. They may only ever EXTEND a window this plugin already
    // opened on the bridge's evidence — never start one.
    host.events.on('raid:alert', (e) => {
      try {
        if (!isAttackAlert(e)) return;
        // Nothing open means nothing an alert may touch, so the database is not asked.
        if (!Object.keys(raids).some((k) => isOpen(raids[k]))) return;
        const c = cfg();
        if (!c.enabled || !c.useOwnerAlerts) return;
        const bases = basesForAlert(e);
        if (!Array.isArray(bases) || !bases.length) return;
        const now = now0();
        let touched = 0;
        for (const id of bases) {
          const r = raids[id];
          if (!r || !isOpen(r)) continue;           // never opens one, only keeps one alive
          if (now > r.lastHitAt) { r.lastHitAt = now; touched++; }
        }
        if (touched) persistRaids();
      } catch (err) { /* an event handler never rejects */ }
    });

    // ── admin-panel endpoints ───────────────────────────────────────────────────────────────────
    //
    // Every one of these answers with the game stopped and the bridge absent. The configuration is
    // the whole of what an owner edits and none of it needs a running server; the live half is an
    // extra column, never a gate.
    host.routes.get('/config', (req, res) => res.json(cfg()));
    host.routes.post('/config', (req, res) => {
      try {
        const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
        const wrong = invalidDetails(body);
        if (wrong.length) {
          // `invalid` is what the tab words in the reader's language; `reason` is the English fallback.
          return res.json({ ok: false, invalid: wrong.map((d) => { const o = Object.assign({}, d); delete o.text; return o; }),
            reason: `nothing was saved: ${wrong.map((d) => d.text).join('; ')}` });
        }
        // A key this build does not know is NAMED rather than dropped in silence.
        const ignored = Object.keys(body).filter((k) => !Object.prototype.hasOwnProperty.call(DEFAULTS, k));
        const known = {};
        for (const k of Object.keys(body)) if (ignored.indexOf(k) < 0) known[k] = body[k];
        const next = normalizeConfig(overlayConfig(rawConfig(), known));
        const where = writeConfig(next);
        lastRun = 0;
        res.json({ ok: true, config: cfg(), savedTo: where, ignored });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    host.routes.get('/status', (req, res) => {
      const c = cfg();
      const now = now0();
      const save = saveState();
      const open = [], recent = [];
      for (const key of Object.keys(raids)) {
        const r = raids[key];
        const row = {
          base: r.base, name: baseName(r.base),
          hits: r.hits, destroyed: r.destroyed, damage: r.damage, elements: r.elements,
          openedAt: r.openedAt, lastHitAt: r.lastHitAt, closedAt: r.closedAt || null,
          pushes: r.pushes || 0,
          capped: r.capped === true,
          flags: Object.keys(r.flags || {}).map((f) => ({
            flag: Number(f),
            pushes: r.flags[f].pushes || 0,
            lastPushAt: r.flags[f].lastPushAt || null,
            lastVerdict: r.flags[f].lastVerdict || null,
            before: r.flags[f].before || null,
          })),
          knownFlags: Array.isArray(r.knownFlags) ? r.knownFlags : null,
          // Present only when it is knowable. `null` is "this raid has no evidenced hit yet", which
          // is a different fact from "the countdown is at zero".
          endsInSeconds: r.closedAt ? null : (r.lastHitAt > 0 ? Math.max(0, Math.round((r.lastHitAt + c.holdSeconds * 1000 - now) / 1000)) : null),
        };
        (r.closedAt ? recent : open).push(row);
      }
      open.sort((a, b) => b.lastHitAt - a.lastHitAt);
      recent.sort((a, b) => b.closedAt - a.closedAt);
      res.json({
        enabled: c.enabled,
        open, recent: recent.slice(0, 20), history: history.slice(0, 60),
        snapshot: snapshotTaken,
        // Why nothing may be happening. An owner looking at an idle plugin has to be able to tell
        // "nothing is being raided" from "the evidence cannot reach me" from "there is nobody on".
        notes,
        idle,
        // Which raid protection the server runs, as the last pass that had something to push read it.
        // `null` until then: the mode is asked only when there is a raid, not on every tab refresh.
        mode: modeInfo ? { kind: modeInfo.kind, code: modeInfo.code || null, cause: modeInfo.cause || null, managerClass: modeInfo.managerClass, at: modeInfo.at, text: modeInfo.text } : null,
        // ONE key for one fact, and it is named the way every sibling plugin names it.
        // `serverRunning` here means "the game database is readable right now", which is the
        // meaningful signal for this plugin and is not the same as a process check: a server
        // mid-restart is up and its save is not there to read.
        serverRunning: save === 'readable',
        // absent | unreadable | readable — so the tab can tell "no save yet" from "the save is
        // there and cannot be read right now", which is every stop, start and restart.
        save,
      });
    });

    // What the save and the running game say about one flag right now — so an owner setting a fixed
    // Duration can see the numbers rather than invent one.
    // A POST rather than a GET with a query string: it reads nothing that is not already on this
    // tab and it writes nothing, but the id travels in a body so the route's own path stays a plain
    // literal on both sides — which is what lets the build check prove the UI and the backend agree.
    host.routes.post('/flag', async (req, res) => {
      const flagId = Number((req.body || {}).id);
      if (!(Number.isFinite(flagId) && flagId > 0)) return res.status(400).json({ error: 'a positive flag id is required' });
      const cache = { flags: new Map() };
      const live = await liveWindow(flagId, cache);
      // The offline reading answers only on an offline server with a new enough bridge; null otherwise.
      const offline = await offlineReading(flagId);
      res.json({
        flag: flagId,
        savedDurationSeconds: savedDuration(flagId),
        live,
        offline,
        note: 'the saved figure is the game’s own whole-second record; the live one is decoded out of a 15-bit packed word and is accurate to a couple of minutes in a day, never to the second',
      });
    });

    // Stop pushing one base by hand. It writes nothing into the game: the window the last push wrote
    // simply runs out, which is what the owner asked for when the raid is over.
    host.routes.post('/close', (req, res) => {
      const base = Number((req.body || {}).base);
      const r = raids[base];
      if (!r || r.closedAt) return res.json({ ok: false, code: 'not_open', reason: 'that base has no open raid window here' });
      r.closedAt = now0();
      r.closedByAdmin = true;
      persistRaids();
      remember({ base: r.base, baseName: baseName(r.base), flag: null, state: 'closed', code: 'admin', params: {}, text: 'stopped by an admin. Nothing was written to the game' });
      persistHistory();
      res.json({ ok: true });
    });

    host.routes.post('/clear-history', (req, res) => { history = []; persistHistory(); res.json({ ok: true }); });

    /**
     * Which bridge switches THIS configuration uses, and whether each one is on.
     *
     * Derived from what is set: the cooldown reset is only asked about by an owner who turned it on.
     * Each entry says what it is FOR in the owner's words. The tab turns the off ones on with one
     * confirmed click through the manager's own route; this route only reads, and it answers with
     * the server stopped (the manager resolves against the shipped module list then).
     */
    host.routes.get('/bridge-check', async (req, res) => {
      const c = cfg();
      // Which write this server needs depends on its protection mode. While that is not known (the
      // server is stopped, or no raid has asked yet) both are listed, because either may be the one.
      let kind = modeInfo ? modeInfo.kind : 'unknown';
      if (kind === 'unknown' || kind === 'none') {
        try { kind = (await readMode()).kind; } catch (e) { kind = 'unknown'; }
      }
      const want = [
        ['raid.enabled', 'Seeing raid damage'],
        ['protect.enabled', 'Pushing protection back'],
      ];
      if (kind !== 'flagSpecific') want.push(['protect.postpone', 'Pushing offline protection back']);
      if (kind !== 'offline') want.push(['protect.set', 'Pushing protection back']);
      if (c.resetCooldownFirst && kind !== 'offline') want.push(['protect.reset', 'Clearing the cooldown first']);
      let r = null;
      if (host.bridge && typeof host.bridge.needs === 'function') {
        try { r = await host.bridge.needs(); } catch (e) { r = null; }
      }
      const found = new Map();
      for (const g of ((r && Array.isArray(r.groups)) ? r.groups : [])) {
        for (const sw of (Array.isArray(g.switches) ? g.switches : [])) found.set(`${g.module}.${sw.key}`, { g, sw });
      }
      // The cooldown reset is deliberately NOT in the manifest's declaration: the module can be declared
      // once, and declaring the reset beside the push would have the plugin card offer a paid skip to
      // every owner. So it is read off the running bridge when there is one, and never offered to the
      // button: the owner turns it on by name on the module's own card.
      let live = null;
      if (c.resetCooldownFirst && host.bridge && typeof host.bridge.modules === 'function') {
        try { live = await host.bridge.modules(); } catch (e) { live = null; }
      }
      const liveSwitch = (module, key) => {
        const m = Array.isArray(live) ? live.find((x) => x && String(x.id) === module) : null;
        if (!m) return null;
        const v = m.config ? m.config[key] : undefined;
        return (v === true || v === 'true') ? 'on' : 'off';
      };
      const RESET_LABEL = 'Reset a flag\'s change cooldown';
      const items = want.map(([k, forWhat]) => {
        const [module, key] = k.split('.');
        const hit = found.get(k);
        if (!hit && k === 'protect.reset') {
          return { module, key, forWhat, label: RESET_LABEL, moduleName: MODULE_NAME.protect, state: liveSwitch(module, key) || 'unknown', ownerMay: false, byHand: true, noUndo: true };
        }
        if (!hit) return { module, key, forWhat, label: key, moduleName: MODULE_NAME[module] || module, state: 'unknown', ownerMay: false };
        const sw = hit.sw;
        return {
          module, key, forWhat,
          label: sw.label || key,
          moduleName: hit.g.moduleName || MODULE_NAME[module] || module,
          state: sw.state || 'unknown',
          // An older manager has no owner's click; its plain apply still turns on a `needs` switch.
          ownerMay: (typeof sw.ownerMay === 'boolean') ? sw.ownerMay : (hit.g.kind === 'needs' && sw.state === 'off' && !sw.block),
          noUndo: sw.tierFamily === 'danger',
        };
      });
      res.json({ known: !!(r && r.declared), online: r ? r.online !== false : null, mode: kind, items });
    });

    host.logger.info('Raid Window active — offline protection is pushed out only for a base with evidenced raid damage');
  },

  async unregister(host) { host.logger.info('Raid Window stopped'); },
};
