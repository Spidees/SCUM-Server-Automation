'use strict';

// More Chat Messages — announce what happens on the server in the game's own chat.
//
// Six announcements, each switched on separately, each with its own chat channel and its own
// wording. Everything ships OFF and nothing is announced until an owner turns it on.
//
// ── where each announcement comes from, because they are not all the same kind of thing ─────────
//
// Three arrive as EVENTS the manager already publishes, and cost nothing to watch:
//
//   kills          `kill`          — the manager's own kill feed, already parsed and already
//                                    resolved: `killerName` / `victimName` are the game's own words
//                                    for an actor, not a blueprint class.
//   join / leave   `player:join`, `player:leave`
//   raids          `raid:alert`    — the owner alert that fires when a base is attacked.
//
// Three have to be ASKED FOR rather than waited for, and they do not share a source:
//
//   bunkers        `host.map.bunkers()` AND `host.map.secretBunkers()` — the MANAGER's own reading.
//                  SCUM writes `[LogBunkerLock]` lines and `bunkerState.js` already parses them
//                  into `{ sector, state: 'active' | 'locked' }`. That is a real state on a real
//                  clock, it names the sector itself, and it works with no bridge at all.
//
//                  ⚠ **TWO CALLS, BECAUSE THEY ARE TWO DIFFERENT THINGS.** The first version read
//                  one list and split it on `keycard`, which is wrong on both sides. `keycard` in
//                  that list means an ABANDONED bunker somebody opened EARLY with a card, so the
//                  "secret bunkers" switch announced abandoned ones; and a real secret bunker was
//                  never in the list at all, because the game gives it no scheduled activation and
//                  it therefore never appears in the periodic state dump that list is built from.
//                  The secret switch could not fire once, on any server, ever.
//   cargo          the SSA Bridge's `worldevents` module. Cargo is in no log and in no table of
//                  `SCUM.db`; the only thing that knows is the running game.
//   events         the same module's `events` list -- the competitive game events (deathmatch, CTF,
//                  drop zone). ⚠ **THE GAME LOGS NOTHING ABOUT THESE.** Counted across all 19 log
//                  kinds the server writes: the only lines that mention an event at all are kills
//                  inside one, plus one line a PLAYER typed into global chat. There is no
//                  registration line, no participant count and no "started" line anywhere, so
//                  unlike the bunkers this section cannot fall back to the log and needs the
//                  bridge switched on.
//
// ⚠ **THE BRIDGE'S OWN BUNKER LIST IS THE WRONG SOURCE AND WAS ALMOST USED.** It publishes
// `activationStart` / `activationEnd` RAW, on a clock whose zero this side has no route to — the
// module says so in as many words — so "is it open right now" cannot be computed from it. Its
// `bunkerClock` is a SENTENCE explaining those numbers, not a state; reading `.active` off it is
// `undefined` for every bunker, which is `false`, and the announcement would simply never fire.
// One parser, and it is the manager's — the same rule that keeps `items.js` the only resolver.
//
// ⚠ **A POLL THAT FAILS IS NOT A WORLD THAT EMPTIED.** The bridge being unreachable, the module
// being switched off and an island with no cargo on it all produce an empty list, and treating them
// alike would announce every crate as "gone" the moment the server hiccups. So a refusal or an
// unreadable answer leaves the last known state ALONE and announces nothing, and only an answer the
// bridge really gave is compared against. The same rule holds for the bunker read.
//
// ── the rules this plugin holds to ──────────────────────────────────────────────────────────────
//
// **The defaults live HERE and `config.json` is the owner's copy of them.** `host.config.get()` is a
// safe() wrapper over a file read, so a library copy that is missing, half-written or older than
// this version's keys comes back `{}` — indistinguishable from "configured nothing". A plugin whose
// settings live only in the file draws an empty screen when that happens.
//
// **Merged by KEY PRESENCE, never truthiness.** `"enabled": false` is an owner who switched
// something off and must survive a merge; an absent key has never been written and takes the
// default. A truthiness merge hands the shipped value back to somebody who deliberately cleared it.
//
// **Every route is mounted and every read answers with nothing running.** The whole of this
// plugin's configuration is editable with the server stopped, which is the better moment to write
// it; only the live counters wait for a game.

const DEFAULTS = {
  // Every announcement is off. A plugin that starts talking the moment it is installed is a plugin
  // an owner turns off rather than configures.
  kills: {
    enabled: false,
    channel: 'global',
    message: '{killer} killed {victim} ({weapon}) at {distance} m',
    // A death SCUM could not attribute to anybody — a fall, a mine, a trap. The game writes its own
    // fallbacks ("Unknown", "NPC", "-1") into the killer field, and `host.items.actorName()` is what
    // tells those apart from a real name, so this is a separate line rather than the same one with
    // an empty killer in it.
    messageNoKiller: '{victim} died',
    selfMessage: '{victim} killed themselves',
    minDistance: 0,
  },
  joins: {
    enabled: false,
    channel: 'global',
    message: '{name} joined the server ({sector})',
  },
  leaves: {
    enabled: false,
    channel: 'global',
    message: '{name} left the server ({sector})',
  },
  cargo: {
    enabled: false,
    channel: 'global',
    // How often THIS one asks. 0 = use the plugin-wide interval at the bottom.
    everySeconds: 0,
    // Three states, three lines, because they are three different pieces of news to a player: one
    // is a race starting, one is a place to go, and one is the race being over.
    incomingMessage: 'A cargo drop is on its way to {sector}',
    landedMessage: 'The cargo drop has landed in {sector}',
    goneMessage: 'The cargo drop in {sector} is gone',
    announceIncoming: true,
    announceLanded: true,
    announceGone: false,
  },
  events: {
    enabled: false,
    channel: 'global',
    // How often THIS one asks. 0 = use the plugin-wide interval at the bottom.
    everySeconds: 0,
    // Registration is open and there is somebody in it. This is the "come and play" line.
    announceOpen: true,
    openMessage: 'The {event} at {location} is open — {registered} signed up so far. Join in if you want to play.',
    // One line per person who signs up. OFF by default and it needs a second switch in the bridge:
    // names come from `players`, which is a real ProcessEvent per participant per poll.
    announceJoin: false,
    joinMessage: '{player} joined the {event} — {registered} signed up',
    // The running total, every time it moves. Off by default: on a filling event this is one line
    // per person anyway, which is what announceJoin is for.
    announceCount: false,
    countMessage: '{registered} players are signed up for the {event} at {location}',
    announceStart: true,
    startMessage: 'The {event} at {location} has started with {participants} players',
    announceEnd: false,
    endMessage: 'The {event} at {location} has finished',
  },
  bunkersSecret: {
    enabled: false,
    channel: 'global',
    // How often THIS one asks. 0 = use the plugin-wide interval at the bottom.
    everySeconds: 0,
    openMessage: 'A secret bunker has opened in {sector}',
    closeMessage: 'The secret bunker in {sector} has closed',
    announceClose: false,
  },
  bunkersAbandoned: {
    enabled: false,
    channel: 'global',
    // How often THIS one asks. 0 = use the plugin-wide interval at the bottom.
    everySeconds: 0,
    openMessage: 'The abandoned bunker in {sector} is now active',
    closeMessage: 'The abandoned bunker in {sector} has locked',
    announceClose: true,
  },
  raids: {
    enabled: false,
    channel: 'global',
    message: 'A base is under attack in {sector}',
    // ⚠ OFF, AND THE HINT SAYS WHY. A raid announcement naming the owner tells the whole server
    // whose base is being hit and where — which on a PVP server is a raid advertisement, not news.
    // An owner can turn it on; it must not be the default.
    includeOwner: false,
    ownerMessage: "{owner}'s base is under attack in {sector}",
  },
  // How often the three polled announcements ask the game. Seconds. The bridge answers a world walk,
  // so this is not free: 30s is a compromise between a crate being announced late and a question
  // nobody asked being put to the game twice a minute.
  // The shared interval, used by any section whose own `everySeconds` is 0. Only cargo, game
  // events and the two bunker sections poll at all; everything else here is announced the
  // moment the manager reads it out of the log.
  pollSeconds: 30,
};

const CHANNELS = ['local', 'global', 'squad', 'admin', 'server'];

/**
 * The owner's config over the defaults, by KEY PRESENCE.
 *
 * One level deep on purpose: every section here is a flat object of scalars, and a deep merge would
 * have to decide what an absent key means inside a list — which this config has none of, and which
 * is exactly where a generic merge starts guessing.
 */
function merge(stored) {
  const out = {};
  for (const k of Object.keys(DEFAULTS)) {
    const d = DEFAULTS[k];
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      const s = (stored && typeof stored[k] === 'object' && stored[k] && !Array.isArray(stored[k])) ? stored[k] : {};
      const sec = { ...d };
      for (const kk of Object.keys(d)) {
        if (Object.prototype.hasOwnProperty.call(s, kk)) sec[kk] = s[kk];
      }
      out[k] = sec;
    } else {
      out[k] = (stored && Object.prototype.hasOwnProperty.call(stored, k)) ? stored[k] : d;
    }
  }
  return out;
}

/** A channel the bridge really has. Anything else falls back rather than being sent nowhere. */
function channelOf(v) { return CHANNELS.includes(String(v)) ? String(v) : 'global'; }

/** `{name}` substitution. A placeholder with no value becomes an empty string, never `undefined`. */
function fill(tpl, vars) {
  return String(tpl == null ? '' : tpl).replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? '' : String(v);
  });
}

async function register(host) {
  const log = host.logger;
  let cfg = merge(host.config.get());
  host.config.onChange(() => { cfg = merge(host.config.get()); });

  // What was said, so a screen can show it and so an owner can tell "switched off" from "nothing
  // has happened yet". Capped, because this is a ring buffer in memory and not a log.
  const recent = [];
  const stats = { sent: 0, failed: 0, skipped: 0 };
  const note = (kind, text, ok, why) => {
    recent.unshift({ at: Date.now(), kind, text, ok: !!ok, why: why || '' });
    if (recent.length > 60) recent.length = 60;
    if (ok) stats.sent += 1; else stats.failed += 1;
  };

  /**
   * Send one announcement, or record why it was not sent.
   *
   * `host.chat.send` resolves with `{ channel, delivered }`; `delivered` is how many players it
   * reached, and ZERO is a legitimate answer on an empty server rather than a failure. So the
   * failure test is the call throwing, not the count — counting zero as a failure would fill the
   * screen with red on a quiet night.
   */
  async function say(kind, section, tpl, vars) {
    if (!section.enabled) return;
    const text = fill(tpl, vars).trim();
    if (!text) { stats.skipped += 1; return; }
    try {
      const r = await host.chat.send(text, { channel: channelOf(section.channel) });
      note(kind, text, true, r && r.delivered === 0 ? 'nobody online to hear it' : '');
    } catch (e) {
      note(kind, text, false, e && e.message ? e.message : 'the chat call failed');
    }
  }

  // ── the three that arrive as events ───────────────────────────────────────────────────────────

  host.events.on('kill', (e) => {
    const s = cfg.kills;
    if (!s.enabled || !e) return;
    const dist = Number(e.distance);
    if (Number.isFinite(dist) && Number(s.minDistance) > 0 && dist < Number(s.minDistance)) {
      stats.skipped += 1;
      return;
    }
    const vars = {
      killer: e.killerName || '',
      victim: e.victimName || '',
      weapon: e.weapon || e.weaponType || '',
      distance: Number.isFinite(dist) ? Math.round(dist) : '',
      sector: e.sector || '',
    };
    // Three different pieces of news, and the manager's own kill feed already draws the same three
    // distinctions: SCUM writes its own fallbacks into the killer field for a death it could not
    // attribute, and `killer === victim` on those would read as a suicide.
    if (e.suicide || (e.killerSteamId && e.killerSteamId === e.victimSteamId)) {
      say('kill', s, s.selfMessage, vars);
    } else if (!vars.killer) {
      say('kill', s, s.messageNoKiller, vars);
    } else {
      say('kill', s, s.message, vars);
    }
  });

  /**
   * The squad a player is in, as a name, or `''`.
   *
   * `''` and not "no squad": a placeholder with nothing behind it disappears from the sentence,
   * which is what an owner writing "{name} ({squad}) joined" wants for a solo player — a line
   * reading "Bob (no squad) joined" is worse than one reading "Bob () joined", and both are worse
   * than the owner choosing. Whoever wants the words puts them in the template.
   *
   * `host.players.squad()` reads `SCUM.db`, so it answers null with the server stopped and for a
   * player the save has not seen yet. Null is not "solo" -- it is "could not say" -- and both come
   * out as an empty placeholder here because a chat line has nowhere to put the difference.
   */
  const squadOf = (steamId) => {
    if (!steamId) return '';
    const s = host.players.squad(String(steamId));
    return (s && (s.Name || s.name)) ? String(s.Name || s.name) : '';
  };

  /**
   * The sector a login happened in.
   *
   * The game writes `logged in at: X=… Y=…` and `loginFeed` parses it into `location`, so this is
   * the player's real position at that moment rather than a lookup that would race the save. ASYNC,
   * because `host.map.sector()` goes through the host's map calibration -- which is remote-only ON
   * PURPOSE, so that a server with no calibration gets NOTHING rather than a sector invented from a
   * baked-in guess.
   */
  const sectorAt = async (loc) => {
    if (!loc || !Number.isFinite(Number(loc.x)) || !Number.isFinite(Number(loc.y))) return '';
    try { return (await host.map.sector(Number(loc.x), Number(loc.y))) || ''; }
    catch { return ''; }
  };

  const onLoginLine = async (kind, section, e) => {
    if (!section.enabled || !e) return;
    const steamId = (e && e.steamId) || '';
    say(kind, section, section.message, {
      name: (e && (e.playerName || e.name)) || '',
      steamId,
      squad: squadOf(steamId),
      sector: await sectorAt(e && e.location),
    });
  };

  // The listener itself stays synchronous -- `host.events.on` wraps a throw, and an async listener
  // that rejects is not a throw it can catch. The promise is handled here instead.
  host.events.on('player:join', (e) => { onLoginLine('join', cfg.joins, e).catch(() => {}); });
  host.events.on('player:leave', (e) => { onLoginLine('leave', cfg.leaves, e).catch(() => {}); });

  host.events.on('raid:alert', (e) => {
    const s = cfg.raids;
    if (!s.enabled || !e) return;
    const vars = {
      owner: e.ownerName || e.owner || '',
      sector: e.sector || '',
      element: e.elementName || '',
      // The owner's squad, so "{squad}'s base is under attack" reads the way a server talks about a
      // raid. Empty for a solo owner and empty when the save cannot be read -- see `squadOf`.
      squad: squadOf(e.ownerSteamId || e.steamId || ''),
    };
    say('raid', s, s.includeOwner && vars.owner ? s.ownerMessage : s.message, vars);
  });

  // ── the three that have to be asked for, and diffed ───────────────────────────────────────────

  // `null` means "never successfully read", which is NOT the same as "read and empty". Until the
  // first good answer nothing is compared and nothing is announced — otherwise the first poll after
  // a restart would announce every crate and every open bunker as new.
  let lastCargo = null;
  let lastBunkers = null;
  let lastSecret = null;
  let lastEvents = null;
  let eventPlayersSeen = false;
  // Which events have already had their "sign-ups are open" line this cycle. Cleared for an
  // event the moment it is seen RUNNING, which is the only unambiguous end of a sign-up phase.
  const openSaid = new Set();
  let lastPollError = '';
  let lastCargoUnplaceable = 0;

  /**
   * A crate's own sector, through the host's map calibration.
   *
   * ⚠ The first version of this was a stub that could only ever return `''` -- it had a branch
   * whose both arms were `null` -- so every cargo announcement would have said "in " with nothing
   * after it, on every server, for ever. It is exactly the shape this session has been finding all
   * day: a call that succeeds, answers a plausible type, and is wrong in one direction always.
   */
  const cargoVars = async (c) => ({
    sector: await sectorAt(c),
    x: Math.round(Number(c && c.x) || 0),
    y: Math.round(Number(c && c.y) || 0),
  });

  /**
   * One bunker list, read through whatever host call was handed in.
   *
   * `null` for "could not read", NEVER an empty array: the two are opposite facts here and the
   * caller announces a close on the difference between them. A host that is too old to have the
   * call at all lands in the same place, which is what keeps this working on an older manager
   * instead of throwing every poll.
   */
  const readList = (fn) => {
    if (typeof fn !== 'function') return null;
    let list = null;
    try { list = fn.call(host.map); } catch { list = null; }
    return Array.isArray(list) ? list : null;
  };

  /**
   * Diff one bunker list against the previous poll and announce what moved.
   *
   * ⚠ **THE FIRST GOOD READING IS A BASELINE, NOT A ROUND OF NEWS.** Both lists are built from the
   * game's own log and both come back populated the moment the manager has read it, so announcing
   * on the first poll would tell the server every open bunker had just opened -- on every manager
   * restart. `null` means nothing has been compared yet.
   *
   * ⚠ **AND AN EMPTY LIST IS A READING.** For the secret list it is the ordinary state — nobody has
   * opened one — so it has to be compared rather than skipped, or the close would never be
   * announced. That is the opposite of the cargo rule above, where an empty answer is
   * indistinguishable from a refusal; here the refusal is `null` and is already gone.
   */
  function bunkerPass(section, list, last) {
    if (!section.enabled || list === null) return last;
    const now = new Map(list.map((b) => [String(b.sector), b]));
    if (!last) return now;                       // baseline
    // ⚠ A COORDINATE OF EXACTLY 0 IS A PLACE, NOT A BLANK. `|| ''` is the same falsy-swallow as
    // the `|| 0` that made one cargo drop announce itself once a minute for ever, pointing the
    // other way: that one turned an unreadable value into a real one, this one turns a real value
    // into nothing. The island runs from -904800 to 619200 on both axes, so 0 is inside it on
    // both. A coordinate that really is missing -- every secret bunker, whose dump line carries no
    // position at all -- still renders as empty.
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : '');
    const varsOf = (sector, b) => ({
      sector,
      x: num(b && b.location && b.location.x),
      y: num(b && b.location && b.location.y),
    });
    for (const [sector, b] of now) {
      const was = last.get(sector);
      const open = b.state === 'active';
      const wasOpen = !!(was && was.state === 'active');
      if (open && !wasOpen) say('bunker', section, section.openMessage, varsOf(sector, b));
      else if (wasOpen && !open && section.announceClose) say('bunker', section, section.closeMessage, varsOf(sector, b));
    }
    // Leaving the list IS closing. `getBunkers()` drops a keycard bunker whose window has elapsed
    // and `getSecretBunkers()` drops every row whose window ran out, and in both cases the bunker
    // shut -- so a row that vanished is the close, not a gap in the reading.
    for (const [sector, was] of last) {
      if (now.has(sector)) continue;
      if (section.announceClose && was.state === 'active') {
        say('bunker', section, section.closeMessage, varsOf(sector, was));
      }
    }
    return now;
  }

  /**
   * A stable identity for one crate across two polls, or `null` when this row has none.
   *
   * ⚠ **`|| 0` ON A MISSING COORDINATE IS WHAT MADE ONE DROP ANNOUNCE ITSELF FOR EVER.** The bridge
   * omits `x`/`y` rather than defaulting them, and says `positionKnown:false` when it does — and its
   * own notes record a crate on a live server whose `_endLocation` read exactly 0,0,0 for eight
   * minutes during its pre-fall delay. Turning either into `0` gives that crate a SECOND identity,
   * so the real one disappears (announce "gone") while `class|0|0` arrives (announce "landed"), and
   * back again on the next poll. The drop happened once; the announcements did not.
   *
   * A row with no position is not a crate this pass can follow, so it gets no id and is left alone.
   */
  const idOf = (o) => {
    if (!o || o.positionKnown === false) return null;
    const x = Number(o.x);
    const y = Number(o.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return [o.class, Math.round(x), Math.round(y)].join('|');
  };

  /**
   * One reading of the bridge's competitive-event list, diffed against the previous poll.
   *
   * ⚠ **`state` IS NOT A STATE AND MUST NEVER BE THE TRIGGER.** `EGameEventState` is
   * `{ Announced, RoundStarted, RoundEnded, Ended }` and `Announced` is ZERO, which is what the
   * class constructor leaves behind — so all twenty-five pre-placed event locations on the map read
   * `state: "announced"` permanently, on every server, before anything has been announced. An
   * announcement keyed on that word fires twenty-five times for locations nobody has touched. The
   * bridge publishes `running` beside it precisely because it is the one decidable fact (it comes
   * from the event manager's own "current" list, not from a field that has a default), so that is
   * what this keys on.
   *
   * ⚠ **`class` IS THE IDENTITY AND `name` IS THE WORDS.** The bridge's own note says anything
   * keying off an event must key off `class`; `name` is an FText read through the engine's text
   * converter and is OMITTED, never blank, while it has not resolved. So an event whose name has
   * not arrived yet is skipped rather than announced -- printing `class` would put
   * `BP_GameEvent_...` in front of players, which is the one thing every screen in this product
   * exists to avoid.
   */
  async function eventPass(list, last) {
    const s = cfg.events;
    if (!s.enabled || !Array.isArray(list)) return last;
    const now = new Map();
    for (const e of list) {
      if (e && e.class) now.set(String(e.class), e);
    }
    if (!last) return now;                        // baseline: never announce the first reading

    const varsOf = async (e, extra) => Object.assign({
      event: e.name || '',
      location: e.locationName || '',
      sector: await sectorAt(e),
      registered: Number.isFinite(Number(e.registered)) ? Number(e.registered) : '',
      participants: Number.isFinite(Number(e.participants)) ? Number(e.participants) : '',
      teams: Number.isFinite(Number(e.teams)) ? Number(e.teams) : '',
      x: Math.round(Number(e.x) || 0),
      y: Math.round(Number(e.y) || 0),
    }, extra || {});

    for (const [id, e] of now) {
      const was = last.get(id);
      // No display name yet means the level is still arriving. Say nothing this poll rather than
      // announce a raw class; the next poll has it.
      //
      // ⚠ **AND KEEP THE LAST NAMED READING AS THE STATE.** Storing the nameless row instead
      // spends the comparison: an event that starts during a poll where its `name` has not
      // resolved is compared away, and by the time there are words to say it with, `running` has
      // already matched for a poll. The name is the WORDS -- not having them yet is not news about
      // the event, and it must not cost the announcement.
      if (!e.name) { if (was) now.set(id, was); continue; }
      // Absent is not false, here either. The bridge omits `running` entirely when the event
      // manager's own lists could not be read — its note says so in as many words — and reading
      // that as `false` against an event that WAS running announces "has finished" for an event
      // that is still going. Same for `registered`: an omitted count is not zero people.
      const runKnown = typeof e.running === 'boolean';
      // `typeof`, not `Number()`: `Number(null)` is 0, and a null would then read as nobody signed
      // up rather than as a count that did not arrive.
      const regKnown = typeof e.registered === 'number' && Number.isFinite(e.registered);
      const reg = regKnown ? Number(e.registered) : 0;
      const run = e.running === true;

      // Whether the bridge is answering the participant question AT ALL, recorded regardless of the
      // owner's switch. Inside the `announceJoin` branch it was only ever true for somebody who had
      // already turned naming on, so the panel told everyone else the bridge was not sending a list
      // it had never been asked for.
      if (Array.isArray(e.players)) eventPlayersSeen = true;

      if (!was) {
        // A location the walk meets for the first time MID-SESSION is not news: it may have been
        // filling up for ten minutes. Remember where it already is, including that its sign-up
        // phase is not ours to announce.
        if (reg > 0 || run) openSaid.add(id);
        continue;
      }

      // ⚠ **THE PREVIOUS READING HAS A KNOWN-NESS TOO, AND ONLY THIS READING'S HAD EVER BEEN
      // ASKED ABOUT.** A row the walk meets for the first time is stored exactly as it came, gaps
      // and all -- so a location first seen while the bridge could not read the count is remembered
      // as `undefined`, and `Number(undefined) || 0` then reads it as nobody. The next complete
      // reading announces 0 -> 5, "sign-ups are open, join in", for an event that has been open all
      // along; the same on the other field reads as a start that never happened. Both were driven
      // before this was written.
      const wasRegKnown = typeof was.registered === 'number' && Number.isFinite(was.registered);
      const wasRunKnown = typeof was.running === 'boolean';
      const wasReg = wasRegKnown ? Number(was.registered) : 0;
      const wasRun = was.running === true;

      // ⚠ **AN INCREASE, ONCE PER CYCLE — NOT THE `registered` EDGE AND NOT A COUNT.**
      // `registered` is the length of `_participantInfo`, which the bridge documents as "everyone
      // who ever registered", and whether the game empties it between rounds is NOT measured. Every
      // rule that reads the VALUE has to answer that question:
      //
      //   `wasReg === 0 && reg > 0`  — a list that never clears fires this once for the life of the
      //                                server and stays silent for every event after it.
      //   `reg > 0`, armed while running — the end poll then says "has finished" and "sign-ups are
      //                                open" in the same breath, which is what the first draft did.
      //   `reg > 0`, armed at the end  — announces sign-ups for the people who played the last round.
      //
      // An INCREASE answers none of it and needs to: somebody signing up moves the number whether
      // the array clears (0 -> 1) or not (3 -> 4), it cannot move on the poll where the event ends,
      // and "somebody just signed up" is what the sentence claims. `openSaid` then only stops it
      // repeating within one sign-up phase — that repetition is what `announceCount` is for.
      // One line per person, and it goes FIRST: a join is read out of `players` and out of nothing
      // else, so a gap in the count or in the running flag must neither produce one nor suppress
      // one. `players` only exists when the owner switched "Who is in the event" on in the bridge
      // -- it costs a call per participant per poll, which is why it is not on by default there or
      // here. Absent means the question was never asked, so nothing is announced and nothing is
      // inferred from the silence.
      if (s.announceJoin && Array.isArray(e.players)) {
        const before = new Set((Array.isArray(was.players) ? was.players : [])
          .map((p) => String((p && (p.id || p.name)) || '')));
        for (const p of e.players) {
          const key = String((p && (p.id || p.name)) || '');
          if (!key || before.has(key)) continue;
          if (!p.name) continue;                   // an id with no name is not something to read out
          say('event', s, s.joinMessage, await varsOf(e, { player: p.name }));
        }
      }

      // ⚠ **EVERY unknown field, not just the one that gated a branch.** Hanging the carry off
      // `runKnown` alone left a readable `running` beside an omitted `registered` stored as
      // `undefined`, and the next complete reading announced a count change nobody made. Silence on
      // an unknown reading is half the rule; not remembering the gap AS a state is the other half,
      // and it has been got wrong three times now — twice here and once in the cargo pass.
      if (!runKnown || !regKnown) {
        now.set(id, Object.assign({}, e, {
          running: runKnown ? e.running : was.running,
          registered: regKnown ? e.registered : was.registered,
        }));
        continue;
      }

      // ...and the gap at the other end. A complete reading compared against one that had a hole in
      // it is not a comparison, so this poll is the BASELINE instead — the same treatment, and for
      // the same reason, that a row met for the first time gets four lines above.
      if (!wasRunKnown || !wasRegKnown) {
        if (reg > 0 || run) openSaid.add(id);
        continue;
      }

      const ended = !run && wasRun;
      if (ended) openSaid.delete(id);
      if (s.announceOpen && !run && !ended && reg > wasReg && !openSaid.has(id)) {
        openSaid.add(id);
        say('event', s, s.openMessage, await varsOf(e));
      } else if (s.announceCount && reg !== wasReg && reg > 0 && !run) {
        say('event', s, s.countMessage, await varsOf(e));
      }

      if (s.announceStart && run && !wasRun) say('event', s, s.startMessage, await varsOf(e));
      else if (s.announceEnd && !run && wasRun) say('event', s, s.endMessage, await varsOf(e));
    }
    return now;
  }

  // ── how often each announcement asks, and what asking costs ───────────────────────────────────
  //
  // ⚠ **THE BRIDGE CALL IS NOT CHEAP AND THE PLUGIN CANNOT MAKE IT CHEAPER.** One
  // `worldEvents()` reaches `find_all_multi`, which visits every UObject in the process and walks
  // each one's super-struct chain -- 1,794,563 objects on this build's own dump. Unreal has no
  // by-class index to ask instead, and the four buckets (crates, events, bunkers, world events)
  // already SHARE that one walk, so asking for fewer of them shortens nothing. On top of it sit
  // five real ProcessEvent calls per event location, about 125 per reply.
  //
  // The only lever on this side is how often, so it is per section rather than one number for all
  // of them -- bunkers come from the manager's own parsed log and cost the game nothing, cargo and
  // events cost that walk. And when two sections fall due in the same tick they share ONE reply,
  // because two intervals must never mean two walks.
  const BASE_TICK_MS = 5000;
  const dueAt = new Map();
  /** A section's own interval, or the plugin-wide one. Bounded here, so a hand-edited 0 cannot spin. */
  const everyOf = (section) => {
    const own = Number(section && section.everySeconds);
    if (own >= 5 && own <= 3600) return own;
    const all = Number(cfg.pollSeconds);
    return (all >= 5 && all <= 3600) ? all : DEFAULTS.pollSeconds;
  };
  /** Is this section switched on AND due? Records the next time as a side effect, so ask once. */
  const isDue = (key, section, now) => {
    if (!section || !section.enabled) return false;
    const at = dueAt.get(key);
    if (at !== undefined && now < at) return false;
    dueAt.set(key, now + everyOf(section) * 1000);
    return true;                                   // an unseen key is due immediately: the baseline
  };

  /**
   * One tick. Takes `now` so a test can drive its own clock -- `host.schedule.every` calls this
   * with no arguments, which is the production path.
   */
  async function poll(nowMs) {
    // `nowAt`, not `now`: the cargo block below already owns that name for its own map, and two
    // `const now` in one function is a SyntaxError rather than a subtle bug -- caught by the
    // syntax check, but worth the word so nobody renames it back.
    const nowAt = Number(nowMs) || Date.now();
    const doAbandoned = isDue('bunkersAbandoned', cfg.bunkersAbandoned, nowAt);
    const doSecret = isDue('bunkersSecret', cfg.bunkersSecret, nowAt);
    const doCargo = isDue('cargo', cfg.cargo, nowAt);
    const doEvents = isDue('events', cfg.events, nowAt);

    // ── bunkers: the manager's own reading, and it needs no bridge ─────────────────────────────
    //
    // `host.map.bunkers()` is `bunkerState.js`, which parses the game's own `[LogBunkerLock]` lines
    // into a real state. An empty array is BOTH "no bunker has been seen in the log yet" and "this
    // island has none", so the same rule as everywhere else applies: nothing is announced until
    // there is something to compare against.
    if (doAbandoned) lastBunkers = bunkerPass(cfg.bunkersAbandoned, readList(host.map.bunkers), lastBunkers);
    if (doSecret) lastSecret = bunkerPass(cfg.bunkersSecret, readList(host.map.secretBunkers), lastSecret);

    // ── cargo and the competitive events: only the bridge knows ────────────────────────────────
    //
    // One reading feeds both. ⚠ The `return` that used to be here was gated on CARGO alone, so an
    // owner who wanted only the event announcements would have had a section that was switched on,
    // configured, and never once asked the bridge anything.
    // Nothing that needs the bridge is due, so it is not asked. This is the whole point of the
    // per-section intervals: a fast bunker line does not buy a world walk every five seconds.
    if (!doCargo && !doEvents) return;
    let payload = null;
    try { payload = await host.bridge.worldEvents(); } catch { payload = null; }
    // ⚠ A REFUSAL IS NOT AN EMPTY WORLD. The bridge being off, the module being off and an island
    // with no crate on it all look like nothing here, and announcing "gone" for all of them would
    // fire every drop as it vanished on a hiccup. The last known state is left exactly as it is.
    if (!payload || payload.ok === false) {
      lastPollError = (payload && (payload.reason || payload.error)) || 'the bridge did not answer';
      return;
    }

    // ⚠ AND AN EMPTY EVENT LIST IS NOT AN ISLAND WITH NO EVENTS. The bridge says so itself: the 25
    // event locations are level-placed actors, so a walk during start-up finds none and `events: []`
    // reads exactly like a map that has none. `eventsEmptyReason` is the module's word for it, and
    // an empty list is left uncompared rather than treated as everything having ended.
    if (doEvents && Array.isArray(payload.events) && payload.events.length) {
      lastEvents = await eventPass(payload.events, lastEvents);
    }

    if (!doCargo) { lastPollError = ''; return; }
    if (!Array.isArray(payload.cargo)) {
      lastPollError = 'the bridge answered without a cargo list';
      return;
    }
    lastPollError = '';

    const now = new Map();
    // A row the pass cannot identify is not a crate that vanished — it is a crate it cannot see
    // this time round. Counted, because the gone pass below is only safe on a COMPLETE reading.
    let unplaceable = 0;
    for (const c of payload.cargo) {
      const id = idOf(c);
      if (id === null) { unplaceable += 1; continue; }
      now.set(id, c);
    }
    if (lastCargo) {
      const s = cfg.cargo;
      for (const [id, c] of now) {
        const before = lastCargo.get(id);
        // Absent is not false. `landed` is omitted when the bridge could not read it, and reading
        // that as "still in the air" announces the landing again every time it flickers.
        const known = typeof c.landed === 'boolean';
        const landed = c.landed === true;
        if (!known) {
          // ⚠ NOT JUST `continue`. Storing the row as it came leaves `landed: undefined` in the
          // memory, and the next complete reading compares `undefined !== true` against `true` and
          // announces the landing again. Silence now is worth nothing if the gap is remembered as
          // a state — carry the last value that WAS known.
          if (before) now.set(id, Object.assign({}, c, { landed: before.landed }));
          continue;
        }
        if (!before) {
          if (landed && s.announceLanded) say('cargo', s, s.landedMessage, await cargoVars(c));
          else if (!landed && s.announceIncoming) say('cargo', s, s.incomingMessage, await cargoVars(c));
        } else if (before.landed !== true && landed && s.announceLanded) {
          say('cargo', s, s.landedMessage, await cargoVars(c));
        }
      }
      // ⚠ ONLY ON A COMPLETE READING. With a row the pass could not place, "not in `now`" and
      // "somewhere in this reply without a position" are the same thing from here, and announcing
      // the difference is what made one drop say "gone" once a minute.
      if (s.announceGone && unplaceable === 0) {
        for (const [id, c] of lastCargo) {
          if (!now.has(id)) say('cargo', s, s.goneMessage, await cargoVars(c));
        }
      }
      // ...and the crates it could not place keep whatever was last known about them, so the next
      // complete reading compares against the truth rather than against a gap.
      if (unplaceable > 0) {
        for (const [id, c] of lastCargo) if (!now.has(id)) now.set(id, c);
      }
    }
    lastCargo = now;
    lastCargoUnplaceable = unplaceable;
  }

  // A short base tick that is almost always a no-op -- it compares four numbers and returns. The
  // work only happens for a section that is due, so the interval an owner sets is what decides how
  // often the game is touched, not this.
  // The argument is passed THROUGH rather than swallowed: `host.schedule.every` calls this with
  // none, so production gets `Date.now()`, and a driver holding this callback can run its own
  // clock. An arrow that dropped it made every driven tick land in the same millisecond.
  host.schedule.every(BASE_TICK_MS, (nowMs) => { poll(nowMs).catch(() => {}); });

  // ── the screen's own reads ────────────────────────────────────────────────────────────────────
  //
  // Mounted unconditionally. A `register()` that stands down takes the whole tab with it: every
  // fetch 404s and the plugin's own `api()` helper turns that into `{}`, so the screen draws empty
  // and says nothing about why.

  host.routes.get('/config', (req, res) => res.json({ ok: true, config: cfg, defaults: DEFAULTS, channels: CHANNELS }));

  host.routes.post('/config', (req, res) => {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    host.config.set(merge(body));
    cfg = merge(host.config.get());
    res.json({ ok: true, config: cfg });
  });

  host.routes.get('/status', (req, res) => {
    res.json({
      ok: true,
      stats,
      recent,
      pollSeconds: everyOf(null),
      // What each section really asks at, so the screen never has to guess which number won.
      intervals: {
        cargo: everyOf(cfg.cargo),
        events: everyOf(cfg.events),
        bunkersSecret: everyOf(cfg.bunkersSecret),
        bunkersAbandoned: everyOf(cfg.bunkersAbandoned),
      },
      // ⚠ **THREE ZEROES AND AN EMPTY LIST ARE TWO OPPOSITE FACTS.** "Nothing has happened yet" and
      // "the server is not running, so nothing CAN happen" look identical on this screen, and a
      // reader who cannot tell them apart concludes the plugin is broken. The screen can only say
      // it if the payload carries it.
      serverRunning: (host.server && typeof host.server.isRunning === 'function') ? !!host.server.isRunning() : null,
      // Said out loud rather than left as three zeroes: an owner reading "0 sent" needs to know
      // whether that is a quiet night or a bridge that is not answering.
      pollError: lastPollError,
      watching: {
        cargo: cfg.cargo.enabled,
        bunkers: cfg.bunkersSecret.enabled || cfg.bunkersAbandoned.enabled,
        seededCargo: lastCargo !== null,
        seededBunkers: lastBunkers !== null,
        seededSecretBunkers: lastSecret !== null,
        // Whether this manager can answer about secret bunkers at all. It is a separate call and
        // it arrived in 5.14.8; an older one has no route to them, and a switch that is on and
        // silent with no explanation is the thing this field exists to stop.
        secretBunkersSupported: typeof host.map.secretBunkers === 'function',
        events: cfg.events.enabled,
        seededEvents: lastEvents !== null,
        // Whether the bridge has ever handed over a participant LIST. `announceJoin` cannot fire
        // without it, and a switch that is on and silent needs a reason on the screen.
        eventPlayersAvailable: eventPlayersSeen,
      },
    });
  });

  log.info('more-chat-messages ready — '
    + Object.keys(DEFAULTS).filter((k) => cfg[k] && cfg[k].enabled).length + ' announcement(s) on');
}

module.exports = { register, _DEFAULTS: DEFAULTS, _merge: merge, _fill: fill, _channelOf: channelOf };
