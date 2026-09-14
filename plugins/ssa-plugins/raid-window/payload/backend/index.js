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
//     may only ever EXTEND a window this plugin already opened on that first evidence. They carry an
//     owner and no base id, and an owner can have several bases, so letting them START a window would
//     push protection on bases nobody has touched. They are a second pair of eyes for the case that
//     matters — the bridge going quiet mid-raid — and never a second way in.
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
// ── WHAT IS WRITTEN, AND WHAT IS MEASURED ABOUT IT ───────────────────────────────────────────────
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
//   2. The flag's own saved window: `base_raid_protection.data`, three little-endian 32-bit words,
//      of which word 2 is the duration in whole seconds. Measured on a real save: 22 of 23 rows read
//      86400 (= the server's `RaidProtectionOfflineMaxProtectionTime` of 24:00:00) and the 23rd reads
//      0, which is the game holding an entry with nothing in it.
//   3. The running game's own decoded window, from the bridge's `protect` module. Marked as decoded
//      because the game packs it into 15 bits and the nearest value that encoding can hold to 86400
//      is 86528 — accurate to a couple of minutes in a day, and never to the second.
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
//   · **Whether the call takes effect under OFFLINE protection.** It is the one the game's own
//     flag-specific panel drives, and it writes into the per-flag list all three protection modes
//     share, so there is every reason to expect it to — but expecting is not measuring, and the
//     verdict above is what answers it on a real raid rather than a claim made here.
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
// raiding then, and the game only accepts a protection change through a connected player, so a push
// would be refused. The bridge keeps its raid records with absolute last-hit times, so nothing seen
// before is lost: the first pass after somebody connects reads the same feed. An unreadable database
// is not "nobody online" and does not idle anything.

const MAX_WINDOW = 604800;          // one week — the most the bridge's protect module will ever send
const FLAG_ASSET_LIKE = '%BP_Base_Flag%';   // covers BP_Base_Flag_C and BP_Base_Flag_Supporter_C
const CONFIG_TTL_MS = 15000;        // re-read the config file at most this often (an edit on the card)
const NAME_TTL_MS = 600000;         // base names barely change; the tab polls every ten seconds
const QUIET_MS = 3600000;           // a repeating warning is said at most once an hour

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
function invalidFields(body) {
  const out = [];
  if (!body || typeof body !== 'object') return out;
  for (const k of Object.keys(body)) {
    const v = body[k];
    if (CLAMP[k]) {
      const [lo, hi] = CLAMP[k];
      const n = (v === null || v === '' || typeof v === 'boolean') ? NaN : Number(v);
      if (!(Number.isFinite(n) && n >= lo && n <= hi)) out.push(`“${LABELS[k]}” must be ${shownRange(k, lo, hi)}`);
    } else if (BOOLS.indexOf(k) >= 0) {
      if (typeof v !== 'boolean') out.push(`“${LABELS[k]}” must be on or off`);
    } else if (k === 'durationSeconds') {
      if (v === null || v === '') continue;
      const n = typeof v === 'boolean' ? NaN : Number(v);
      if (!(Number.isFinite(n) && n > 0 && n <= MAX_WINDOW)) out.push(`“${LABELS[k]}” must be empty, or up to ${MAX_WINDOW / 3600} hours`);
    } else if (k === 'exemptBaseIds' || k === 'exemptFlagIds') {
      if (!Array.isArray(v) || v.some((x) => oneId(x) == null)) out.push(`“${LABELS[k]}” must be a list of id numbers, separated by commas`);
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
    const notes = { raid: null, protect: null, db: null };
    // Why the last pass did no work at all, or null when it did. Different from a note: a note is a
    // source that could not answer, this is a pass that had no reason to ask.
    let idle = null;

    // The bridge's own names for the two modules, the words on its cards in Settings → Bridge.
    const MODULE_NAME = { raid: 'Raid detection', protect: 'Raid protection control' };
    function noteFailure(key, q, what) {
      const code = (q && q.code) || 'bridge_off';
      const shown = MODULE_NAME[what] || what;
      let text;
      if (code === 'refused') text = (q && q.reason) || null;
      else if (code === 'module_off') text = `the bridge's ${shown} module is switched off. The Bridge box on this tab turns it on`;
      else if (code === 'no_module') text = `this server runs an older SSA Bridge with no ${shown} module. Update the bridge`;
      else text = 'the SSA Bridge did not answer';
      notes[key] = { code, text, at: now0() };
      if (code === 'bridge_off' || !text) return;
      warnQuietly('note:' + key, `${text}. No new raid evidence can arrive while that is true — nothing is being ended on that account.`);
    }
    const clearNote = (key) => { notes[key] = null; };

    const canQuery = () => !!(host.bridge && typeof host.bridge.query === 'function');
    const canCommand = () => !!(host.bridge && typeof host.bridge.command === 'function');
    const dbReadable = () => { try { return host.db.scum.available() === true; } catch (e) { return false; } };

    /**
     * Is there a reason not to do any work at all right now? `null` when there is none.
     *
     * Only a POSITIVE reading idles: the game database is readable and says nobody is online. An
     * unreadable database, a missing API or a list that could not be produced is "I do not know", and
     * "I do not know" does the work.
     */
    function idleReason() {
      if (!(host.players && typeof host.players.online === 'function')) return null;
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
      // no flag every time the server was mid-restart.
      if (host.db.scum.available() !== true) return null;
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
     * `base_raid_protection.data` is twelve bytes: three little-endian 32-bit words, of which word 2
     * is the protection duration in whole seconds. Measured across every row of a real save — 22 read
     * 86400 against a server configured for 24:00:00, and the one row whose protection had been
     * cleared reads 0.
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

    const tooLong = (seconds, where) => ({
      seconds: null, source: null,
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
      return { seconds: null, source: null, why: `${why}. To push it anyway, set a fixed protection length under More options` };
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
      const already = !r.ok && r.code === 'refused' && /snapshot already exists/i.test(String(r.reason || ''));
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

    /** The bridge's range refusal, with the name of the setting that decides it. */
    function explainRefusal(text) {
      const m = /(delay|duration) must be a (?:plain decimal )?number between 0 and (\d+)/i.exec(String(text || ''));
      if (!m) return text;
      // A bridge that already names the setting says it once; saying it again reads as two limits.
      if (/Refuse Delay or Duration above/.test(String(text))) return text;
      return `${text}. That limit is the “Refuse Delay or Duration above” setting (${m[2]}) on the bridge's Raid protection control card in Settings → Bridge. Raise it there, or set a shorter fixed protection length under More options`;
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
        f.lastVerdict = { ok: false, state: 'no_duration', text: dur.why, at: now0() };
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

      let state, text;
      if (!r.ok) {
        state = 'refused';
        text = explainRefusal(r.reason || r.error || 'the bridge did not say why');
      } else if (r.changed === true) {
        state = 'moved';
        text = r.note || 'the flag’s stored protection state moved';
      } else if (r.changed === false) {
        state = 'unchanged';
        text = r.note || 'the call was accepted and the flag’s stored state did not move';
      } else {
        state = 'unconfirmed';
        text = r.note || 'the call was accepted and the flag’s state could not be read back';
      }
      f.lastVerdict = { ok: r.ok === true, state, text, at };

      remember({
        base: record.base, baseName: baseName(record.base), flag: Number(flagId),
        delaySeconds: delay, durationSeconds: dur.seconds, durationSource: dur.source,
        state, text,
        evidence: {
          hits: record.hits, destroyed: record.destroyed, damage: record.damage,
          elements: record.elements, lastHitAgoSeconds: Math.round((at - record.lastHitAt) / 1000),
        },
      });
      return r.ok === true;
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
          remember({ base: r.base, baseName: baseName(r.base), flag: null, state: 'closed', text: `no damage for ${Math.round(c.holdSeconds / 60)} minutes, so the raid is over. Protection starts when the last push said it would` });
        }
      }

      // 3) push the open ones — unless there is nobody a push could travel through.
      if (!idle && canCommand()) {
        for (const key of Object.keys(raids)) {
          const r = raids[key];
          if (r.closedAt) continue;
          if (c.exemptBaseIds.indexOf(r.base) >= 0) continue;
          if ((r.pushes || 0) >= c.maxPushesPerRaid) {
            if (!r.capped) {
              r.capped = true;
              dirty = true;
              remember({ base: r.base, baseName: baseName(r.base), flag: null, state: 'capped', text: `this raid has been pushed ${r.pushes} time(s), the most “Most pushes for one raid” allows. Nothing more is pushed until it ends` });
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
              noteFailure('db', { code: 'refused', reason: 'the game database could not be read, so the plugin cannot find this base\'s flag yet' }, 'database');
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
            if (c.countFromLastHit) {
              if (left < 60) continue;                                   // protection is about to start anyway
              const newHit = !f || !(f.pushedForHitAt >= r.lastHitAt);
              const dueByHit = newHit && (!last || now - last >= 60000 || now < last);
              const dueByRepeat = !last || now - last >= c.reapplySeconds * 1000 || now < last;
              if (!dueByHit && !dueByRepeat) continue;
            } else if (last && now - last < c.reapplySeconds * 1000 && now >= last) continue;
            if ((r.pushes || 0) >= c.maxPushesPerRaid) break;
            await push(r, flagId, c, cache, c.countFromLastHit ? left : undefined);
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

    // The manager's own owner/raid alerts. They may only ever EXTEND a window this plugin already
    // opened — they name an owner and not a base, and an owner can have several bases, so starting a
    // window from one would push protection on bases nobody has touched.
    host.events.on('raid:alert', (e) => {
      // Nothing open means nothing an alert may touch, so the database is not asked.
      if (!Object.keys(raids).some((k) => isOpen(raids[k]))) return;
      const c = cfg();
      if (!c.enabled || !c.useOwnerAlerts) return;
      const sid = e && e.ownerSteamId ? String(e.ownerSteamId) : null;
      if (!sid) return;
      let owned;
      try {
        owned = host.db.scum.all(
          'SELECT b.id AS id FROM base b JOIN user_profile up ON up.id = b.owner_user_profile_id WHERE up.user_id = ?',
          sid);
      } catch (err) { return; }
      if (!Array.isArray(owned) || !owned.length) return;
      const now = now0();
      let touched = 0;
      for (const row of owned) {
        const r = raids[Number(row.id)];
        if (!r || r.closedAt) continue;           // never opens one, only keeps one alive
        if (now > r.lastHitAt) { r.lastHitAt = now; touched++; }
      }
      if (touched) persistRaids();
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
        const wrong = invalidFields(body);
        if (wrong.length) return res.json({ ok: false, reason: `nothing was saved: ${wrong.join('; ')}` });
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
        // ONE key for one fact, and it is named the way every sibling plugin names it.
        // `serverRunning` here means "the game database is readable right now", which is the
        // meaningful signal for this plugin and is not the same as a process check: a server
        // mid-restart is up and its save is not there to read.
        serverRunning: dbReadable(),
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
      res.json({
        flag: flagId,
        savedDurationSeconds: savedDuration(flagId),
        live,
        note: 'the saved figure is the game’s own whole-second record; the live one is decoded out of a 15-bit packed word and is accurate to a couple of minutes in a day, never to the second',
      });
    });

    // Stop pushing one base by hand. It writes nothing into the game: the window the last push wrote
    // simply runs out, which is what the owner asked for when the raid is over.
    host.routes.post('/close', (req, res) => {
      const base = Number((req.body || {}).base);
      const r = raids[base];
      if (!r || r.closedAt) return res.json({ ok: false, reason: 'that base has no open raid window here' });
      r.closedAt = now0();
      r.closedByAdmin = true;
      persistRaids();
      remember({ base: r.base, baseName: baseName(r.base), flag: null, state: 'closed', text: 'stopped by an admin. Nothing was written to the game' });
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
      const want = [
        ['raid.enabled', 'Seeing raid damage'],
        ['protect.enabled', 'Pushing protection back'],
        ['protect.set', 'Pushing protection back'],
      ];
      if (c.resetCooldownFirst) want.push(['protect.reset', 'Clearing the cooldown first']);
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
      res.json({ known: !!(r && r.declared), online: r ? r.online !== false : null, items });
    });

    host.logger.info('Raid Window active — offline protection is pushed out only for a base with evidenced raid damage');
  },

  async unregister(host) { host.logger.info('Raid Window stopped'); },
};
