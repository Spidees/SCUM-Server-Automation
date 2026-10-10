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
    history: false,
    message: '{killer} killed {victim} ({weapon}) at {distance} m',
    // A kill whose killer name is EMPTY. Rarer than it reads: a mine or a trap names whoever armed it
    // (the player's own one arrives as a suicide), and a death the game could not attribute carries
    // the placeholder `Unknown`, which `killFeed.js` also writes for a missing name — both of those
    // take `message`, not this line. `host.items.actorName()` resolves a class to a name; it does not
    // tell a placeholder from a player's name. See the handler below.
    messageNoKiller: '{victim} died',
    selfMessage: '{victim} killed themselves',
    minDistance: 0,
  },
  joins: {
    enabled: false,
    channel: 'global',
    history: false,
    message: '{name} joined the server ({sector})',
  },
  leaves: {
    enabled: false,
    channel: 'global',
    history: false,
    message: '{name} left the server ({sector})',
  },
  cargo: {
    enabled: false,
    channel: 'global',
    history: false,
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
    history: false,
    // Registration is open and there is somebody in it. This is the "come and play" line.
    announceOpen: true,
    openMessage: 'The {event} at {location} is open: {registered} signed up. Join in!',
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
    history: false,
    openMessage: 'A secret bunker has opened in {sector}',
    closeMessage: 'The secret bunker in {sector} has closed',
    announceClose: false,
  },
  bunkersAbandoned: {
    enabled: false,
    channel: 'global',
    history: false,
    openMessage: 'The abandoned bunker in {sector} is now active',
    closeMessage: 'The abandoned bunker in {sector} has locked',
    announceClose: true,
  },
  raids: {
    enabled: false,
    channel: 'global',
    history: false,
    message: 'A base is under attack in {sector}',
    // ⚠ OFF, AND THE HINT SAYS WHY. A raid announcement naming the owner tells the whole server
    // whose base is being hit and where — which on a PVP server is a raid advertisement, not news.
    // An owner can turn it on; it must not be the default.
    includeOwner: false,
    ownerMessage: "{owner}'s base is under attack in {sector}",
  },
};

/**
 * Keys an earlier version declared and this one does not, by section (`''` for the top level).
 *
 * ⚠ **THE INTERVALS ARE GONE, AND WHY IS A MEASUREMENT.** Every poll had its own "ask every N
 * seconds" box and a shared one behind it, with a 30-second floor on cargo and game events because
 * a read was believed to walk every object in the game. Measured on bridge 2.32.0 with a player
 * online: one `worldevents events` read costs **18.6 ms** of the bridge's update thread (the
 * module's own perf meter, 20 reads) and **62 ms** round trip at the median, because the bridge now
 * answers it out of a shared world index refreshed once a second. So there is nothing for an owner
 * to trade off any more: everything polled is checked every `TICK_SECONDS`, and a crate or a
 * sign-up is announced within about five seconds instead of within half a minute.
 *
 * An owner's stored values are not an error and are not reported as one; `merge()` simply leaves
 * them out, so the next save drops them from the file.
 */
const RETIRED = { '': ['pollSeconds'], cargo: ['everySeconds'], events: ['everySeconds'],
  bunkersSecret: ['everySeconds'], bunkersAbandoned: ['everySeconds'] };
const retired = (section, key) => (RETIRED[section] || []).includes(key);

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

/**
 * The keys a caller sent that THIS BUILD does not declare, as `section.key` strings.
 *
 * ⚠ **`merge()` DISCARDS THEM SILENTLY, WHICH IS RIGHT, AND SAYING NOTHING ABOUT IT IS NOT.**
 * It builds from `DEFAULTS`, so a key this version has never heard of cannot survive a save -- and
 * the screen that sent it gets `ok: true` and shows the owner their own number until they refresh.
 * That is not hypothetical: the panel serves `web/plugin.js` from the library on every request
 * while the manager only re-requires `backend/index.js` when the plugin is reloaded, so a card can
 * be a version ahead of the code answering it. The field is then unsettable for the life of that
 * manager process and nothing anywhere says why.
 */
/**
 * A caller's body laid over what is already STORED, one section deep.
 *
 * ⚠ **A SECTION NOBODY SENT IS NOT A SECTION TO RESET.** `merge()` fills every section it does
 * not find from DEFAULTS -- which is what makes reading an older version's file safe -- so handing
 * it a body that names one section and passing the result to `host.config.set`, which spreads at the
 * TOP level, replaced every other section with the shipped template. Driven: one
 * `{"kills":{"enabled":true}}` blanked every message, channel and interval an owner had written, and
 * answered `ok: true`. The panel sends the whole config, so nothing did that yet; a PATCH from
 * anywhere would have.
 */
function overlay(stored, body) {
  const out = Object.assign({}, stored && typeof stored === 'object' ? stored : {});
  if (!body || typeof body !== 'object') return out;
  for (const k of Object.keys(body)) {
    const b = body[k];
    const cur = out[k];
    if (b && typeof b === 'object' && !Array.isArray(b)
        && cur && typeof cur === 'object' && !Array.isArray(cur)) {
      out[k] = Object.assign({}, cur, b);          // by key presence, so `false` and `0` survive
    } else {
      out[k] = b;
    }
  }
  return out;
}

function unknownKeys(sent) {
  const out = [];
  if (!sent || typeof sent !== 'object') return out;
  for (const k of Object.keys(sent)) {
    const d = DEFAULTS[k];
    if (d === undefined) { if (!retired('', k)) out.push(k); continue; }
    const v = sent[k];
    if (!d || typeof d !== 'object' || Array.isArray(d)) continue;
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    for (const kk of Object.keys(v)) {
      if (!Object.prototype.hasOwnProperty.call(d, kk) && !retired(k, kk)) out.push(k + '.' + kk);
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

/**
 * ONE rule for a coordinate that is going into a sentence.
 *
 * ⚠ **A COORDINATE OF EXACTLY 0 IS A PLACE, NOT A BLANK, AND A COORDINATE THAT COULD NOT BE READ IS
 * NOT 0.** Both halves have been got wrong here, in opposite directions and in the same file: the
 * bunker line used `|| ''`, which turned a real position on the island's centre line into nothing,
 * while the cargo and event lines used `Math.round(Number(v) || 0)`, which turned a position nobody
 * could read into the middle of the map. The island runs from -904800 to 619200 on both axes, so 0
 * is inside it on both.
 *
 * Finite means a number to render; anything else means an empty placeholder, which disappears from
 * the sentence rather than lying in it. Rounded, because a chat line has no use for a millimetre.
 */
function coord(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : '';
}

/**
 * Every position ONE cargo row publishes, as `[x, y]` pairs in centimetres.
 *
 * ⚠ **`x`/`y` IS NOT ONE QUANTITY. IT IS TWO, UNDER ONE NAME, CHOSEN PER POLL BY THE BRIDGE.**
 * `mod_worldevents`' `add_target` publishes `_endLocation` — where the crate is GOING — when that
 * field holds something, and the crate's own live position when it does not, and it says which one
 * answered in `targetSet`. Beside it `add_actor_pos` publishes the live position again, always,
 * under `actorX`/`actorY`. So a single crate can be described by two different pairs of numbers
 * during its life, and the switch between them happens when `DropToLocation` runs — mid-flight,
 * with nothing about the crate having changed.
 *
 * That is why this returns a LIST rather than a point. Two readings are the same crate when they
 * share a position, and a row carries every position the bridge could give it, so the reading before
 * the switch and the reading after it still overlap.
 */
function pointsOf(o) {
  const out = [];
  // The bridge's own explicit "I could not place this row". It is kept as the signal rather than
  // inferred from the absences below, and it is not the only guard: `add_target` falls back to the
  // actor, so a row carrying this key has no `actorX` either and would produce no points anyway.
  if (!o || o.positionKnown === false) return out;
  const add = (px, py) => {
    const a = Number(px);
    const b = Number(py);
    if (Number.isFinite(a) && Number.isFinite(b)) out.push([a, b]);
  };
  add(o.x, o.y);
  add(o.actorX, o.actorY);
  return out;
}

async function register(host) {
  const log = host.logger;
  let cfg = merge(host.config.get());
  host.config.onChange(() => { cfg = merge(host.config.get()); });

  // What was said, so a screen can show it and so an owner can tell "switched off" from "nothing
  // has happened yet". Capped, because this is a ring buffer in memory and not a log.
  const recent = [];
  const stats = { sent: 0, failed: 0, skipped: 0 };
  // `why` is a CODE the screen translates (`nobody`, `failed`), never a sentence: this list is read
  // in nineteen languages and the backend speaks none of them. `detail` is the raw failure the chat
  // call threw (`bridge_unavailable`, …), which the screen turns into words for the ones it knows.
  const note = (kind, text, ok, why, detail) => {
    recent.unshift({ at: Date.now(), kind, text, ok: !!ok, why: why || '', detail: detail || '' });
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
    /**
     * The chat HISTORY — the admin chat view, the Field Console and the Discord chat channel.
     *
     * ⚠ SCUM does not log a line the bridge injects, and both of those surfaces read the game's own
     * chat log — so every line this plugin has ever sent was visible in game and nowhere else. This
     * is the separate door the manager opens for exactly that; it needs no bridge of its own.
     *
     * ⚠ **IT IS WRITTEN BY `send()` ITSELF, BEFORE THE BRIDGE IS ASKED.** Recording it here after a
     * successful send lost the line on exactly the pass the owner most wanted it kept: the bridge
     * down, the game restarting. `send(…, { history: true })` records first and reports a history
     * failure apart from the chat one. It arrived in the same manager release as `record()`, so the
     * presence of `record` is how an older manager — whose `send` ignores the option — is told apart.
     */
    const wantHistory = section.history === true;
    const canHistory = typeof host.chat.record === 'function';
    if (wantHistory && !canHistory) {
      // Feature-detected: this runs on whatever manager is installed, and an older one has no
      // such door. Said in words rather than failing quietly.
      log.warn('[more-chat-messages] this manager cannot write chat history; the announcement still goes to the game.');
    }
    try {
      const opts = { channel: channelOf(section.channel) };
      if (wantHistory && canHistory) opts.history = true;
      const r = await host.chat.send(text, opts);
      if (r && r.history && r.history.ok === false) {
        log.warn(`[more-chat-messages] the chat history was not written: ${r.history.reason}`);
      }
      note(kind, text, true, r && r.delivered === 0 ? 'nobody' : '');
    } catch (e) {
      note(kind, text, false, 'failed', e && e.message ? e.message : '');
    }
  }

  // ── the three that arrive as events ───────────────────────────────────────────────────────────

  /**
   * A world ACTOR's name, through the manager's ONE resolver.
   *
   * ⚠ **`killerName` / `victimName` ARE NOT ALREADY RESOLVED, AND THIS FILE USED TO SAY THEY WERE.**
   * `killFeed.js` writes `K.ProfileName` straight out of the game's JSON, which is a player's name
   * for a player and a spawn class with its instance number for anything else — so a puppet kill
   * announced `BP_Guard_Lvl_5_C_2146943462` in the server's chat where the manager's own feed says
   * "Guard (Lvl 5)". `host.items.actorName()` is the one rule for exactly this field and the SDK
   * names it for exactly this field; a player's name passes through it unchanged.
   */
  const actorName = (n) => {
    if (!n) return '';
    try {
      const v = (host.items && typeof host.items.actorName === 'function') ? host.items.actorName(n) : n;
      return v ? String(v) : String(n);
    } catch { return String(n); }
  };

  /** An item CODE's display name, in the bot's language. `items.js` is the only resolver. */
  const itemName = (code) => {
    if (!code) return '';
    try {
      const v = (host.items && typeof host.items.name === 'function') ? host.items.name(code) : code;
      return v ? String(v) : String(code);
    } catch { return String(code); }
  };

  host.events.on('kill', (e) => {
    const s = cfg.kills;
    if (!s.enabled || !e) return;

    // ⚠ **A SUICIDE IS ITS OWN EVENT SHAPE AND CARRIES NONE OF A KILL'S FIELDS.** `killFeed.js`
    // returns `{ type: 'suicide', playerName, steamId, … }` — no `victimName`, no `killerName`, and
    // no `suicide` flag anywhere in this manager. This handler tested `e.suicide`, which has never
    // existed on any event it emits, so `selfMessage` could not fire ONCE on any server; a real
    // suicide fell through to the no-killer line and was announced as " died", with nobody named,
    // because `victimName` is not a field of that event either. Two placeholder fields read as
    // states, in one branch.
    if (e.type === 'suicide') {
      say('kill', s, s.selfMessage, {
        killer: '', victim: actorName(e.playerName), weapon: '', distance: '', sector: '',
      });
      return;
    }

    const dist = Number(e.distance);
    if (Number.isFinite(dist) && Number(s.minDistance) > 0 && dist < Number(s.minDistance)) {
      stats.skipped += 1;
      return;
    }
    const vars = {
      killer: actorName(e.killerName),
      victim: actorName(e.victimName),
      // ⚠ **`weaponName` IS THE WEAPON AND `weaponType` IS THE DAMAGE CLASS.** There is no `weapon`
      // field on this event at all, so `e.weapon || e.weaponType` fell through to the second every
      // time and put the word `Projectile` — or `Melee`, or `Explosion` — where a player expects
      // the gun. `weaponName` is an item code and `host.items.name()` is what turns it into a name,
      // which is what the SDK's own example for this event does.
      weapon: itemName(e.weaponName),
      distance: coord(dist),
      // ⚠ THE KILL EVENT CARRIES NO POSITION THIS PLUGIN CAN USE. `killFeed.js` publishes the two
      // places only inside `locationText`, a sentence it formatted for an embed, and re-parsing
      // that here would be a second reader of a string the manager owns. So `{sector}` cannot be
      // filled for a kill and is no longer offered on the kill lines in the panel — it was blank on
      // every kill on every server, which is a hole in the sentence rather than a missing detail.
      sector: '',
    };
    // ⚠ **`killer === victim` IS NOT A SUICIDE TEST AND MUST NOT BE ONE HERE.** SCUM writes its own
    // fallbacks ("Unknown", "NPC", "-1") into the killer field for a death it could not attribute,
    // and those MATCH EACH OTHER — so a raw comparison reads a fall or a mine as that player
    // killing themselves. `killFeed.js` already makes that decision with `unnamedId()` and
    // `unnamedActor()`, which are the one answer to "did the game name this actor at all", and it
    // emits `type: 'suicide'` when the answer is yes. Making it a second time here, with a weaker
    // rule, is how the two disagree.
    //
    // ⚠ **AND `messageNoKiller` STILL CANNOT SEE THE COMMONEST CASE.** `killFeed.js` writes the
    // literal `'Unknown'` for a killer the game did not name, so a fall or a trap arrives here with
    // a truthy killer and is announced as a kill by somebody called Unknown. Telling that apart
    // from a player who really is called Unknown needs `unnamedActor()`, which lives in the
    // manager's `parseCommon.js` and is not on the host — and writing a second copy of it here is
    // the one thing this project forbids outright. Said plainly rather than half-closed: this
    // branch fires only on a genuinely empty name.
    if (!vars.killer) say('kill', s, s.messageNoKiller, vars);
    else say('kill', s, s.message, vars);
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

  /**
   * What a raid alert was ABOUT, as a name.
   *
   * `raidNotify.js` emits `object: { name, class, kind, customName }`, and the feed that built the
   * alert has already resolved `name`. `customName` is the owner's own label for that particular
   * chest or car — the one detail that says WHICH of theirs was hit, which is why that module's own
   * `namedSuffix()` exists — so it wins. A bare class is a last resort and goes through the one
   * resolver rather than reaching a chat line as `BP_…_C`.
   */
  const raidObject = (o) => {
    if (!o || typeof o !== 'object') return '';
    if (o.customName) return String(o.customName);
    if (o.name) return String(o.name);
    return o.class ? itemName(o.class) : '';
  };

  // ⚠ **`{sector}` AND `{element}` WERE BLANK ON EVERY RAID LINE ON EVERY SERVER.** The event
  // `raidNotify.js` emits is `{ type, ownerSteamId, ownerName, location, timestamp, object,
  // thumbnail }` — there is no `sector` field and no `elementName` field, and `|| ''` turned both
  // absences into an empty placeholder rather than into an error. So the shipped default message,
  // "A base is under attack in {sector}", went out as "A base is under attack in" with the sentence
  // ending mid-phrase. The position is there under `location`, which is what `host.map.sector()`
  // takes, and the thing that was hit is there under `object`.
  //
  // Async for the sector lookup, and the listener itself stays synchronous: `host.events.on` wraps
  // a throw and an async listener that rejects is not a throw it can catch.
  //
  // ⚠ **`raid:alert` IS EVERY OWNER ALERT, AND ONLY ONE OF THEM IS A BASE UNDER ATTACK.** The same
  // event carries the raid-protection status changes (an owner logging off schedules protection),
  // a picked lock, a looted chest and a sold car — and this handler announced every one of them as
  // "a base is under attack". The manager now says which: `type: 'raid'` + `subType: 'attack'` is
  // the base taking damage, `protSched`/`protOn`/`protOff` are status changes, and the other kinds
  // carry `subType: null`. An older manager sends no `subType` key at all; there the attack is the
  // `raid` alert that names an `object` (what was destroyed), because a status change names none.
  const isAttack = (e) => {
    if (!e || typeof e !== 'object') return false;
    if (Object.prototype.hasOwnProperty.call(e, 'subType')) return e.subType === 'attack';
    return e.type === 'raid' && !!e.object;
  };
  const onRaid = async (e) => {
    const s = cfg.raids;
    if (!s.enabled || !isAttack(e)) return;
    const vars = {
      owner: e.ownerName || e.owner || '',
      sector: await sectorAt(e.location),
      element: raidObject(e.object),
      // The owner's squad, so "{squad}'s base is under attack" reads the way a server talks about a
      // raid. Empty for a solo owner and empty when the save cannot be read -- see `squadOf`.
      squad: squadOf(e.ownerSteamId || e.steamId || ''),
    };
    say('raid', s, s.includeOwner && vars.owner ? s.ownerMessage : s.message, vars);
  };
  host.events.on('raid:alert', (e) => { onRaid(e).catch(() => {}); });

  // ── the three that have to be asked for, and diffed ───────────────────────────────────────────

  // `null` means "never successfully read", which is NOT the same as "read and empty". Until the
  // first good answer nothing is compared and nothing is announced — otherwise the first poll after
  // a restart would announce every crate and every open bunker as new.
  let lastCargo = null;
  let lastBunkers = null;
  let lastSecret = null;
  let lastEvents = null;
  let eventPlayersSeen = false;

  /**
   * WHO SIGNED UP, FROM THE BRIDGE'S EVENT LEDGER (SSA Bridge 2.41.0, `host.bridge.eventLedger()`).
   *
   * The ledger is the one place the bridge reads an event's roster: once per poll, each player's
   * identity once per event. The `players` list on `worldEvents()` was the only route before it and
   * costs the game seven calls per participant on every read, which is why it ships off and why
   * this plugin never switched it on. So each event's `players` is filled from the ledger's open run
   * for that event (`id` is the same actor name on both), in the same shape (`id` the Steam id, then
   * `name`), and everything downstream reads it exactly as before.
   *
   * Only while the ledger is WATCHING (`coverSince`): an event with no open run then really has
   * nobody signed up. With no ledger at all (an older manager or bridge, the switch off) the list is
   * left exactly as `worldEvents()` gave it — `players` when that switch is on, absent otherwise.
   */
  async function namesFromLedger(events) {
    if (!host.bridge || typeof host.bridge.eventLedger !== 'function') return;
    let led = null;
    try { led = await host.bridge.eventLedger(); } catch { led = null; }
    if (!led || !Array.isArray(led.runs) || !led.coverSince) return;
    const open = new Map();
    for (const r of led.runs) if (r && r.id && r.phase !== 'ended') open.set(String(r.id), r);
    for (const e of events) {
      if (!e || !e.id) continue;   // a bridge older than 2.41.0 names no event: leave it as it came
      const r = open.get(String(e.id));
      e.players = r && Array.isArray(r.participants)
        ? r.participants.filter((p) => p && !p.removed).map((p) => {
          const o = {};
          if (p.steamId) o.id = String(p.steamId);
          if (p.name) o.name = String(p.name);
          if (typeof p.team === 'number') o.team = p.team;
          if (p.state) o.state = String(p.state);
          return o;
        })
        : [];
    }
  }
  // Which events have already reported a participant the game had not named yet — once per run,
  // because the poll repeats every few seconds.
  const namelessSaid = new Set();
  // Per event, the participants who signed up before the game had a name for them, by id -- so the
  // poll where the name arrives still announces them. See `eventPass`.
  const namelessWaiting = new Map();

  // Which events have already had their "sign-ups are open" line this cycle. Cleared for an
  // event the moment it is seen RUNNING, which is the only unambiguous end of a sign-up phase.
  const openSaid = new Set();
  // `lastPollError` is a code (`no_answer`, `no_cargo_list`) the screen translates; `lastPollDetail`
  // is the bridge's own refusal, when it gave one.
  let lastPollError = '';
  let lastPollDetail = '';
  let lastCargoUnplaceable = 0;

  /**
   * A crate's own sector, through the host's map calibration.
   *
   * ⚠ The first version of this was a stub that could only ever return `''` -- it had a branch
   * whose both arms were `null` -- so every cargo announcement would have said "in " with nothing
   * after it, on every server, for ever. It is exactly the shape this session has been finding all
   * day: a call that succeeds, answers a plausible type, and is wrong in one direction always.
   */
  const cargoVars = async (c) => {
    // Whichever pair the bridge managed to publish. `x`/`y` is the landing point where that is
    // decided and the crate's own position where it is not (`targetSet` says which); `actorX`/
    // `actorY` is the position on its own, and it is what is left on a row whose landing point is
    // the only thing that read. A sentence wants a place, not a provenance.
    const p = pointsOf(c)[0] || [];
    return {
      sector: await sectorAt({ x: p[0], y: p[1] }),
      // ⚠ `Math.round(Number(v) || 0)` stood here and it is the shape this whole file is about: a
      // coordinate nobody could read became the middle of the map. See `coord`.
      x: coord(p[0]),
      y: coord(p[1]),
    };
  };

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
  //
  // ⚠ **AND `host.map.bunkers()` / `.secretBunkers()` ARE `safe(…, [])`, SO A READ THAT THREW ARRIVES
  // AS `[]`, NOT `null`.** `readList`'s null only covers a manager with no such call. Two rules close
  // the gap, one per list, because an empty answer means different things on each:
  //
  //   abandoned  The list is built from the game's periodic dump and only ever grows — a scheduled
  //              bunker stays in it, active or locked, for the life of the process. So EMPTY is
  //              never a reading: it is "the dump has not been written yet" (a server that has just
  //              started, where the seed found nothing) or a read that failed. Neither is compared,
  //              and neither becomes the baseline — otherwise the server's first dump announced every
  //              already-active bunker as opening, which the README promises does not happen.
  //   secret     Empty is the ordinary state, so it is compared — but a bunker that vanished from an
  //              EMPTY reading before its own window ran out cannot be told apart from a failed read,
  //              and is HELD rather than announced as closed. Its close is said when the clock it
  //              carries passes, or when a non-empty reading (which proves the read worked) lacks it.
  function bunkerPass(section, list, last) {
    if (!section.enabled || list === null) return last;
    const abandoned = section === cfg.bunkersAbandoned;
    if (abandoned && list.length === 0) return last;
    const now = new Map(list.map((b) => [String(b.sector), b]));
    if (!last) return now;                       // baseline
    // ⚠ A COORDINATE OF EXACTLY 0 IS A PLACE, NOT A BLANK. `|| ''` is the same falsy-swallow as
    // the `|| 0` that made one cargo drop announce itself once a minute for ever, pointing the
    // other way: that one turned an unreadable value into a real one, this one turns a real value
    // into nothing. The island runs from -904800 to 619200 on both axes, so 0 is inside it on
    // both. A coordinate that really is missing -- every secret bunker, whose dump line carries no
    // position at all -- still renders as empty. `coord` is the one rule; there is not a second
    // one in this file any more.
    const varsOf = (sector, b) => ({
      sector,
      x: coord(b && b.location && b.location.x),
      y: coord(b && b.location && b.location.y),
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
    const nowSec = Math.floor(Date.now() / 1000);
    for (const [sector, was] of last) {
      if (now.has(sector)) continue;
      // An empty reading proves nothing about a bunker whose own window is still open. See above.
      const until = Number(was && was.activeUntilUnix);
      const elapsed = Number.isFinite(until) && until > 0 && until <= nowSec;
      if (list.length === 0 && was.state === 'active' && !elapsed) { now.set(sector, was); continue; }
      if (section.announceClose && was.state === 'active') {
        say('bunker', section, section.closeMessage, varsOf(sector, was));
      }
    }
    return now;
  }

  // ── ONE CRATE IS ONE CRATE, AND THE PAYLOAD CARRIES NO ID TO SAY SO ──────────────────────────
  //
  // ⚠ **THE FIRST FIX HERE CLOSED HALF OF THIS AND THE OTHER HALF WENT ON SHIPPING.** A crate's
  // identity used to be the string `class|round(x)|round(y)`, built with `Number(o.x) || 0`. That
  // `|| 0` gave an UNPLACEABLE row the identity `class|0|0`, and `pointsOf` plus the `unplaceable`
  // rule below ended it. What it did not touch is the case where both readings are perfectly
  // placeable and DISAGREE — and an owner reported exactly that afterwards, on a drop that was
  // there once:
  //
  //     The cargo drop has landed in Z0.   The cargo drop in Z0 is gone.
  //     The cargo drop has landed in Z0.   The cargo drop in Z0 is gone.
  //
  // A string key is an EXACT match, so any change at all in the number makes a second crate: the
  // old key leaves the map (announce "gone") and the new one arrives (announce "landed"), and back
  // again when the reading flips back. Nothing throws, the count of drops is right, and every line
  // is individually true.
  //
  // The bridge publishes `x`/`y` from two different sources — see `pointsOf` — and publishes the
  // crate's live position beside it under `actorX`/`actorY`. Neither pair is stable across a
  // crate's whole life on its own; together they overlap, because the source that stops answering
  // is still published under the other name.
  //
  // **So identity is PROXIMITY, not a string.** A row belongs to a crate this pass is already
  // following when the two share a published position within `MATCH_CM`, and the pairing is
  // ONE-TO-ONE and nearest-first so two crates cannot collapse into one while both are in the
  // reply. A crate remembers the positions it has published (capped, distinct) rather than only its
  // last one, so a reading that flips back and forth between two of them still matches.
  //
  // **What it costs when two drops are live at once**, said plainly because this is the trade:
  // matching is one-to-one, so two crates 25 m apart are still two crates as long as both are in
  // the reply — the radius only decides whether a row is the SAME crate or a NEW one. It is wrong
  // only if two drops are within 25 m of each other AND one of them is missing from a reply, in
  // which case the surviving row is read as the missing crate: one landing goes unannounced and one
  // "gone" is late. That is the direction to fail in — a missed line, never a line repeated for
  // ever — and the game makes it vanishingly unlikely: `scum.CargoDropCooldownMinimum` is 45
  // minutes and the island is about 15 km across.
  //
  // 25 m is a DRIFT tolerance, not a guess at where a crate is. It absorbs the two sources of one
  // crate's own position (which the bridge measured as the same X and Y, a crate descending
  // vertically — only the height differs) and the one decimal place the payload prints. It does not
  // absorb an admin re-targeting a falling crate with `cargodrop`, which really does move it: that
  // costs one spurious "gone" plus one "landed", once, caused by the person who moved it.
  const MATCH_CM = 2500;
  const MATCH_CM2 = MATCH_CM * MATCH_CM;
  /** How many distinct positions one crate is remembered by. Two sources plus room to move. */
  const MAX_POINTS = 4;

  /** Smallest squared distance between any point of `a` and any of `b`, or `null` if either is empty. */
  const closeness = (a, b) => {
    let best = null;
    for (const p of a) {
      for (const q of b) {
        const dx = p[0] - q[0];
        const dy = p[1] - q[1];
        const d = dx * dx + dy * dy;
        if (best === null || d < best) best = d;
      }
    }
    return best;
  };

  /** The points a crate is remembered by: this reading's, then the older ones it does not repeat. */
  const rememberPoints = (fresh, old) => {
    const out = fresh.slice();
    for (const p of (old || [])) {
      if (out.length >= MAX_POINTS) break;
      if (out.some((q) => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 <= MATCH_CM2)) continue;
      out.push(p);
    }
    return out;
  };

  /**
   * Pair this poll's rows against the crates already being followed.
   *
   * Greedy, smallest distance first, one-to-one: every candidate pair under the radius is scored,
   * the closest is bound, and both sides leave the pool. `tOf[i]` is the row index bound to tracked
   * crate `i` (or -1), `rOf[j]` the tracked index bound to row `j` (or -1).
   */
  const pairUp = (tracked, rows) => {
    const tOf = new Array(tracked.length).fill(-1);
    const rOf = new Array(rows.length).fill(-1);
    const cand = [];
    for (let i = 0; i < tracked.length; i++) {
      for (let j = 0; j < rows.length; j++) {
        // A class is the one thing about a crate that cannot drift, so it is a hard gate rather
        // than part of the distance: a `BP_Cargo_C` is never the `BP_DropZoneCargo_C` beside it,
        // however close they land.
        if (tracked[i].cls !== rows[j].cls) continue;
        const d = closeness(tracked[i].points, rows[j].points);
        if (d === null || d > MATCH_CM2) continue;
        cand.push([d, i, j]);
      }
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (const [, i, j] of cand) {
      if (tOf[i] >= 0 || rOf[j] >= 0) continue;
      tOf[i] = j;
      rOf[j] = i;
    }
    return { tOf, rOf };
  };

  // ── A CRATE HAS A LIFE, AND IT ONLY GOES FORWARD ─────────────────────────────────────────────
  //
  // `air` from the moment it is in the list until it lands, `down` from the first reading that
  // says `landed:true`, then gone. Each line is said at most once per crate, and a reading that
  // says `landed:false` about a crate already down does not put it back in the air.
  //
  // Measured on a dev server with bridge 2.33.0, one reading every two seconds: the crate is in the
  // list within a second of the game's own "Cargo drop spawned" line, sits 540 s at the event's
  // centre with `targetSet:false`, falls for 60 s straight down (x and y never move), reads
  // `landed:true` from then on and is counted down from 1223 s.
  //
  // ⚠ **"GONE" NEEDS SEVERAL READINGS, NOT ONE.** That was the owner's report: "it is only starting
  // to fall and it already says gone, then that it is falling, then landed, then gone". One reply
  // without the crate ended its life on the spot, and the next reply that carried it again was a
  // new crate, announced from the start. `GONE_POLLS` complete readings in a row without it, at one
  // every `TICK_SECONDS`, is about twenty seconds -- nothing next to the twenty minutes a landed
  // crate stays, and a reply that missed it once or twice says nothing.
  const GONE_POLLS = 4;

  /**
   * ⚠ **A CRATE THAT HAS BLOWN UP IS STILL IN THE LIST FOR ABOUT FOUR MINUTES.** Measured: the
   * self-destruct starts 1200 s after landing (`flare` goes false, `detonatesIn` reads 25), the
   * crate explodes 26 s later -- from then on the bridge can no longer read where the actor is, so
   * the row carries the landing point and no `actorX` -- and the row leaves 235 s after that.
   * Waiting for the row to leave announced "gone" four minutes after everybody heard it go off.
   *
   * Landed, flare out and no actor position, for `END_READINGS` readings in a row, is the
   * explosion. One reading alone is not: a read of the actor's position that failed once is not an
   * explosion, and a crate that is still there must not be called gone.
   */
  const END_READINGS = 2;
  const blownUp = (row) => !!row && row.landed === true && row.flare === false
    && !Number.isFinite(Number(row.actorX)) && row.positionKnown !== false;

  /** `air`, `down`, or the previous phase when this reading does not say. Never back from `down`. */
  const phaseOf = (row, prev) => {
    if (prev === 'down') return 'down';
    if (row && row.landed === true) return 'down';
    if (row && row.landed === false) return 'air';
    return prev || null;
  };

  /**
   * A crate still in the air that matched nothing, and a row of its class that matched nothing,
   * are the same crate.
   *
   * ⚠ **THE POSITION OF A CRATE IN THE AIR IS NOT AN IDENTITY.** A game-scheduled drop falls
   * straight down, but `cargodrop` re-aims a falling crate anywhere, and the published pair is the
   * crate itself until `_endLocation` is decided. Matching on distance alone then reads one crate
   * as two: "gone" for the old position, "on its way" for the new one, then "landed" and "gone"
   * again. Drops are tens of minutes apart, so a crate in the air that matched nothing and a new
   * row of its class are that crate. A crate already DOWN does not move and is never paired this
   * way, so a new drop beside a landed one is still news.
   */
  const adoptMoved = (tracked, rows, tOf, rOf) => {
    const cand = [];
    for (let i = 0; i < tracked.length; i++) {
      if (tOf[i] >= 0 || tracked[i].phase === 'down') continue;
      for (let j = 0; j < rows.length; j++) {
        if (rOf[j] >= 0 || tracked[i].cls !== rows[j].cls) continue;
        cand.push([closeness(tracked[i].points, rows[j].points), i, j]);
      }
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (const [, i, j] of cand) {
      if (tOf[i] >= 0 || rOf[j] >= 0) continue;
      tOf[i] = j;
      rOf[j] = i;
    }
  };

  /**
   * Which location each row of the event list is, as `[key, row]` pairs.
   *
   * ⚠ **`class` IS A KIND OF EVENT, NOT A PLACE, AND KEYING ON IT KEPT FOUR OF TWENTY-FIVE.** The
   * island carries 3 capture-the-flag, 10 deathmatch, 4 drop-zone and 8 team-deathmatch locations,
   * and every location of one kind shares one class (read off the dev server's bridge 2.32.0). A map
   * keyed on `class` kept only the LAST row of each kind, so an event opening at any of the other
   * twenty-one locations was never compared against anything and never announced. Whether an event
   * was heard about depended on which location the game happened to pick -- which reads, from the
   * owner's chair, as "it only works on the second round".
   *
   * A location is its class plus the marker's `locationName`. That is not quite unique either: the
   * Cage in C4 carries TWO deathmatch and TWO team-deathmatch locations, one above the other, same
   * name, same x and y, different z. Such a pair is remembered in `twins` the first time a reply
   * shows it, and from then on keyed by its height as well, so a poll that could not read one twin's
   * position cannot hand its state to the other. The bridge sends the twenty-five in the same order
   * on every reply (checked over five consecutive reads), but an order is not an identity.
   *
   * A row with no `locationName` cannot be told apart from its siblings and is left out of this
   * reading; its last state is carried by `eventPass`. Its announcement also has no `{location}` to
   * say, so nothing a player would have read is lost.
   */
  const twins = new Set();
  function eventRows(list) {
    const place = (e) => `${e.class}|${e.locationName}`;
    const counts = new Map();
    for (const e of list) {
      if (e && e.class && e.locationName) counts.set(place(e), (counts.get(place(e)) || 0) + 1);
    }
    for (const [k, n] of counts) if (n > 1) twins.add(k);
    const out = [];
    const seen = new Set();
    for (const e of list) {
      if (!e || !e.class || !e.locationName) continue;
      let key = place(e);
      if (twins.has(key)) {
        if (typeof e.z !== 'number' || !Number.isFinite(e.z)) continue;
        key += `|${Math.round(e.z / 100)}`;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([key, e]);
    }
    return out;
  }

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
   * ⚠ **A LOCATION IS THE IDENTITY, AND `name` IS THE WORDS.** See `eventRows` for the key. `name`
   * is an FText read through the engine's text converter and is OMITTED, never blank, while it has
   * not resolved. So an event whose name has not arrived yet is skipped rather than announced --
   * printing `class` would put `BP_GameEvent_...` in front of players, which is the one thing every
   * screen in this product exists to avoid.
   */
  async function eventPass(list, last, quiet) {
    const s = cfg.events;
    if (!s.enabled || !Array.isArray(list)) return last;
    // Nobody online: the reading was made only to take a baseline, so one that exists is kept as it
    // is -- a sign-up nobody could hear about is still news to the first player who logs in.
    if (quiet && last) return last;
    const now = new Map(eventRows(list));
    if (!last) return now;                        // baseline: never announce the first reading

    const varsOf = async (e, extra) => Object.assign({
      event: e.name || '',
      location: e.locationName || '',
      sector: await sectorAt(e),
      registered: Number.isFinite(Number(e.registered)) ? Number(e.registered) : '',
      participants: Number.isFinite(Number(e.participants)) ? Number(e.participants) : '',
      teams: Number.isFinite(Number(e.teams)) ? Number(e.teams) : '',
      // ⚠ `Math.round(Number(e.x) || 0)` stood here, which put the middle of the map into a sentence
      // about an event location whose position the bridge had not sent. See `coord`.
      x: coord(e.x),
      y: coord(e.y),
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
      //
      // ⚠ **AND THE PREVIOUS READING'S `players` HAS A KNOWN-NESS TOO — THE SAME GAP AS `running`
      // AND `registered`, ON THE ONE FIELD THAT HAD NEVER BEEN ASKED ABOUT.** The bridge's own note
      // is explicit: `add_players` is "absent when the array could not be read at all, `[]` when
      // nobody has registered". `Array.isArray(was.players) ? was.players : []` read the first of
      // those as the second, so the poll after a failed read announced EVERY person in the event as
      // having just signed up — one line each, for people who joined ten minutes ago. The same
      // sentence fires the first time an owner switches "Who is in the event" on in the bridge.
      // Compare only against a list that really was one, and carry the last real list forward below
      // so a single unreadable poll does not spend the comparison either.
      const wasPlayers = Array.isArray(was.players) ? was.players : null;
      if (s.announceJoin && Array.isArray(e.players) && wasPlayers) {
        const before = new Set(wasPlayers
          .map((p) => String((p && (p.id || p.name)) || '')));
        // ⚠ **A NAME THAT ARRIVES A POLL LATE IS STILL THAT PERSON'S JOIN.** A participant the game
        // has not named yet is keyed by their id, and the next reading carries that id in `before`
        // -- so without this, the poll where the name finally resolves read them as somebody already
        // there, and the join the log line below promised was never announced at all.
        const pend = namelessWaiting.get(id) || new Set();
        const present = new Set();
        for (const p of e.players) {
          const key = String((p && (p.id || p.name)) || '');
          if (key) present.add(key);
          const waiting = pend.has(key);
          if (!key || (before.has(key) && !waiting)) continue;
          /*
           * ⚠ A PARTICIPANT WITH NO NAME IS NOT NOTHING, AND DROPPING THEM IN SILENCE IS THE
           * DEFECT. The bridge omits `name` when `FGameEventParticipantInfo::Name` is an empty
           * string, and an empty name cannot be read out to a server — so this line is right to
           * say nothing IN CHAT. What it must not do is say nothing to the OWNER: reported as
           * "I signed up and nothing was sent" with every switch on at both ends, which is
           * indistinguishable from a broken feed, a wrong switch and a plugin that is not running.
           *
           * Said once per event per run, at warn: the poll repeats every few seconds and a line per
           * poll would bury the thing it is trying to report.
           */
          if (!p.name) {
            pend.add(key);
            if (!namelessSaid.has(id)) {
              namelessSaid.add(id);
              // The sign-up count still moves, so "how many are signed up" works; the player is
              // announced as soon as the game names them. Nothing is wrong with the switches.
              log.warn(`[more-chat-messages] a sign-up for "${e.name || id}" has no player name yet; `
                + 'it is announced once it has one.');
            }
            continue;
          }
          pend.delete(key);
          say('event', s, s.joinMessage, await varsOf(e, { player: p.name }));
        }
        // Somebody who left before the game named them is nobody to announce later.
        for (const k of [...pend]) if (!present.has(k)) pend.delete(k);
        if (pend.size) namelessWaiting.set(id, pend); else namelessWaiting.delete(id);
      }

      // ⚠ **EVERY unknown field, not just the one that gated a branch.** Hanging the carry off
      // `runKnown` alone left a readable `running` beside an omitted `registered` stored as
      // `undefined`, and the next complete reading announced a count change nobody made. Silence on
      // an unknown reading is half the rule; not remembering the gap AS a state is the other half,
      // and it has been got wrong four times now — three times here and once in the cargo pass.
      //
      // `players` is on this list for the same reason and was the one missing from it: an absent
      // list remembered as the state makes the NEXT complete reading a comparison against nobody.
      // Unconditional, because it has to happen on the path where the other two read perfectly.
      if (!Array.isArray(e.players) && wasPlayers) {
        now.set(id, Object.assign({}, e, { players: wasPlayers }));
      }
      if (!runKnown || !regKnown) {
        now.set(id, Object.assign({}, now.get(id), {
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
    // A location this reply did not name is not a location that went away: the twenty-five are
    // placed in the level and stay there. Its last known state is kept, so the reading where it is
    // back compares against the truth rather than meeting it as new -- which is silent.
    for (const [id, was] of last) if (!now.has(id)) now.set(id, was);
    return now;
  }

  // ── how often it asks, and what asking costs ──────────────────────────────────────────────────
  //
  // ONE cadence for everything polled, and no setting for it. The bunker lists are the manager's own
  // parse of the game's log and cost the game nothing. The cargo and game-event list is one bridge
  // read, measured on bridge 2.32.0 with a player online at 18.6 ms of the bridge's update thread
  // and 62 ms round trip at the median -- it comes out of a world index the bridge refreshes once a
  // second for every module, not out of a walk of its own. Every five seconds that is under half a
  // percent of that thread, and it buys an announcement within about five seconds of the game
  // changing state.
  //
  // ⚠ **THE READ STAYS SERIAL.** A tick whose read has not come back yet does not start another:
  // the bridge answers two heavy requests a frame and a plugin must never be the one that queues.
  const TICK_SECONDS = 5;
  let reading = false;

  /**
   * Is the server KNOWN to have nobody on it?
   *
   * A chat line with nobody online reaches nobody, so a read to produce one buys nothing.
   * ⚠ **"NOBODY IS ONLINE" AND "THE PLAYER COUNT COULD NOT BE READ" ARE OPPOSITE FACTS.**
   * `host.players.online()` answers `[]` for both, so it cannot decide this; `host.stats.counts()`
   * answers `null` when the save could not be read and a real `{ online: 0 }` when it was. Only the
   * second is a reason to stay quiet. Anything else, including a manager with no such reader, asks
   * the game exactly as before.
   */
  const nobodyOnline = () => {
    try {
      if (!host.stats || typeof host.stats.counts !== 'function') return false;
      const c = host.stats.counts();
      return !!(c && typeof c === 'object' && typeof c.online === 'number' && c.online === 0);
    } catch { return false; }
  };
  // Whether the last bridge poll was skipped because nobody was online. For the screen.
  let waitingForPlayers = false;

  /**
   * One tick. Takes `now` so a test can drive its own clock -- `host.schedule.every` calls this
   * with no arguments, which is the production path.
   */
  async function poll(nowMs) {
    void nowMs;
    const doAbandoned = !!cfg.bunkersAbandoned.enabled;
    const doSecret = !!cfg.bunkersSecret.enabled;
    const doCargo = !!cfg.cargo.enabled;
    const doEvents = !!cfg.events.enabled;

    // ── bunkers: the manager's own reading, and it needs no bridge ─────────────────────────────
    //
    // `host.map.bunkers()` is `bunkerState.js`, which parses the game's own `[LogBunkerLock]` lines
    // into a real state. An empty array is BOTH "no bunker has been seen in the log yet" and "this
    // island has none", so the same rule as everywhere else applies: nothing is announced until
    // there is something to compare against.
    if (doAbandoned) lastBunkers = bunkerPass(cfg.bunkersAbandoned, readList(host.map.bunkers), lastBunkers);
    if (doSecret) lastSecret = bunkerPass(cfg.bunkersSecret, readList(host.map.secretBunkers), lastSecret);

    // Nothing that needs the bridge is on, so it is not asked.
    if (!doCargo && !doEvents) return;
    if (reading) return;

    // ── nobody online: the game is asked only for a baseline ───────────────────────────────────
    //
    // A line sent to an empty server is heard by nobody, so the read that would produce one is not
    // made. The ONE reader it still has is the chat history (the admin chat view, the Field Console
    // and the Discord chat channel), which records a line whether or not anybody was in game -- so a
    // section with `history` on is still asked for.
    //
    // ⚠ **BUT THE BASELINE IS TAKEN ANYWAY, AND NOT TAKING IT WAS HALF OF "ONLY THE SECOND ROUND".**
    // A manager starts before anybody joins, so the old skip meant no reading at all until the first
    // player was in -- and that first reading is the baseline, which announces nothing. An event
    // whose sign-ups opened as the first players arrived was therefore folded into the baseline
    // and never announced; only the next one was. So a section with no baseline yet is read even on
    // an empty server (one read, or a few while the level is still arriving), and only the
    // comparison waits for a player.
    //
    // ⚠ **A SKIP IS NOT A READING.** Once a baseline exists nothing is touched while the server is
    // empty: the first poll after somebody logs in compares against the world as it was last SEEN,
    // so a crate that arrived while nobody was on is announced once.
    const keepsHistory = (doCargo && cfg.cargo.history === true) || (doEvents && cfg.events.history === true);
    const quiet = !keepsHistory && nobodyOnline();
    const needBaseline = (doCargo && lastCargo === null) || (doEvents && lastEvents === null);
    if (quiet && !needBaseline) {
      waitingForPlayers = true;
      return;
    }
    waitingForPlayers = quiet;

    let payload = null;
    reading = true;
    try { payload = await host.bridge.worldEvents(); } catch { payload = null; } finally { reading = false; }
    // ⚠ A REFUSAL IS NOT AN EMPTY WORLD. The bridge being off, the module being off and an island
    // with no crate on it all look like nothing here, and announcing "gone" for all of them would
    // fire every drop as it vanished on a hiccup. The last known state is left exactly as it is.
    if (!payload || payload.ok === false) {
      // A CODE for the screen to translate, and the bridge's own words beside it when it gave any.
      lastPollError = 'no_answer';
      lastPollDetail = String((payload && (payload.reason || payload.error)) || '');
      return;
    }

    // ⚠ AND AN EMPTY EVENT LIST IS NOT AN ISLAND WITH NO EVENTS. The bridge says so itself: the 25
    // event locations are level-placed actors, so a walk during start-up finds none and `events: []`
    // reads exactly like a map that has none. `eventsEmptyReason` is the module's word for it, and
    // an empty list is left uncompared rather than treated as everything having ended.
    if (doEvents && Array.isArray(payload.events) && payload.events.length) {
      await namesFromLedger(payload.events);
      lastEvents = await eventPass(payload.events, lastEvents, quiet);
    }

    lastPollDetail = '';
    if (!doCargo) { lastPollError = ''; return; }
    if (!Array.isArray(payload.cargo)) {
      lastPollError = 'no_cargo_list';
      return;
    }
    lastPollError = '';

    // This poll's rows, reduced to what identity is decided on. A row the pass cannot place is not
    // a crate that vanished — it is a crate it cannot SEE this time round. Counted, because the
    // gone pass below is only safe on a COMPLETE reading.
    const rows = [];
    let unplaceable = 0;
    // Which classes had a row this pass could not place. A crate of that class that matched nothing
    // may be that row, so its absence this poll is not counted.
    const blind = new Set();
    for (const c of payload.cargo) {
      const points = pointsOf(c);
      const cls = String((c && c.class) || '');
      if (!points.length) { unplaceable += 1; blind.add(cls); continue; }
      rows.push({ cls, points, row: c });
    }

    // The first good reading is the baseline: nothing is compared and nothing is announced, or a
    // manager restart would tell the server about every crate already on the island. What is
    // already there is remembered as already said, so its next change is still news.
    if (quiet && lastCargo !== null) return;
    if (lastCargo === null) {
      lastCargo = rows.map((r) => {
        const ph = phaseOf(r.row, null);
        const said = { incoming: true, landed: ph === 'down', gone: ph === 'down' && blownUp(r.row) };
        return { cls: r.cls, points: r.points, phase: ph, said, missing: 0, row: r.row };
      });
      lastCargoUnplaceable = unplaceable;
      return;
    }

    const s = cfg.cargo;
    const { tOf, rOf } = pairUp(lastCargo, rows);
    adoptMoved(lastCargo, rows, tOf, rOf);
    const next = [];

    for (let j = 0; j < rows.length; j++) {
      const c = rows[j].row;
      const before = rOf[j] >= 0 ? lastCargo[rOf[j]] : null;
      const points = rememberPoints(rows[j].points, before && before.points);
      const phase = phaseOf(c, before ? before.phase : null);
      const said = before ? before.said : { incoming: false, landed: false, gone: false };
      // A crate whose state nobody could read yet is followed and not announced: telling the
      // server a drop is on its way when the bridge could not say whether it had already landed is
      // a guess. `phase` stays unknown, so the first reading that knows decides.
      if (phase === 'air' && !said.incoming && !said.landed) {
        said.incoming = true;
        if (s.announceIncoming) say('cargo', s, s.incomingMessage, await cargoVars(c));
      } else if (phase === 'down' && !said.landed) {
        said.landed = true;
        // Also marks the incoming line as spent: a crate first seen on the ground was never news
        // on its way down, and must not become it if a later reading says otherwise.
        said.incoming = true;
        if (s.announceLanded) say('cargo', s, s.landedMessage, await cargoVars(c));
      }
      // The crate has blown up and the row has not left yet. See `blownUp`.
      const ends = phase === 'down' && blownUp(c) ? ((before && before.ends) || 0) + 1 : 0;
      if (ends >= END_READINGS && !said.gone) {
        said.gone = true;
        if (s.announceGone) say('cargo', s, s.goneMessage, await cargoVars(c));
      }
      next.push({ cls: rows[j].cls, points, phase, said, ends, missing: 0, row: c });
    }

    // ⚠ **A CRATE MISSING FROM ONE REPLY IS NOT GONE.** It is gone after `GONE_POLLS` complete
    // readings in a row without it. A crate this reply might be hiding as a row with no position
    // is held as it is, neither counted nor dropped.
    for (let i = 0; i < lastCargo.length; i++) {
      if (tOf[i] >= 0) continue;
      const t = lastCargo[i];
      if (blind.has(t.cls)) { next.push(t); continue; }
      const missing = (t.missing || 0) + 1;
      if (missing < GONE_POLLS) { next.push(Object.assign({}, t, { missing })); continue; }
      // ⚠ A crate already said gone when it blew up is still FOLLOWED until it has really left,
      // and only then dropped in silence. Dropping it on the first reply without it made the wreck
      // a new crate the next time it was in the list: "landed", "gone", again, every few seconds.
      if (s.announceGone && !t.said.gone) say('cargo', s, s.goneMessage, await cargoVars(t.row));
    }

    lastCargo = next;
    lastCargoUnplaceable = unplaceable;
  }

  // The argument is passed THROUGH rather than swallowed: `host.schedule.every` calls this with
  // none, so production gets `Date.now()`, and a driver holding this callback can run its own
  // clock. An arrow that dropped it made every driven tick land in the same millisecond.
  host.schedule.every(TICK_SECONDS * 1000, (nowMs) => { poll(nowMs).catch(() => {}); });

  // ── the screen's own reads ────────────────────────────────────────────────────────────────────
  //
  // Mounted unconditionally. A `register()` that stands down takes the whole tab with it: every
  // fetch 404s and the plugin's own `api()` helper turns that into `{}`, so the screen draws empty
  // and says nothing about why.

  host.routes.get('/config', (req, res) => res.json({ ok: true, config: cfg, defaults: DEFAULTS, channels: CHANNELS }));

  host.routes.post('/config', (req, res) => {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    // Worked out BEFORE the write, against what the caller actually sent: `merge()` returns a whole
    // config built from DEFAULTS, so afterwards there is nothing left to compare and the loss is
    // gone. `dropped` is how a screen can tell "saved" from "saved without that".
    const dropped = unknownKeys(body);
    // Over what is STORED first, filled from DEFAULTS second. The other order resets every section
    // the caller did not name — see `overlay`.
    // ⚠ SAID IN THE LOG, not only on the screen. A dropped key is the one save failure that answers
    // `ok`, and the toast that names it is gone in seconds — so when an owner reports "3 settings did
    // not land" there is otherwise nothing on disk that says WHICH three, or that it happened at all.
    if (dropped.length) {
      // The running backend is older than the screen that sent these keys.
      log.warn(`[more-chat-messages] ${dropped.length} setting(s) not saved: ${dropped.join(', ')}. `
        + 'Restart the manager and set them again.');
    }
    host.config.set(merge(overlay(host.config.get(), body)));
    cfg = merge(host.config.get());
    // The stored config is echoed so the caller can read its own write back -- the rule the bridge
    // lives by, on this side of the wire. A save that answers `ok` and stored something else is the
    // one failure nobody can see.
    res.json({ ok: true, config: cfg, dropped });
  });

  host.routes.get('/status', (req, res) => {
    res.json({
      ok: true,
      stats,
      recent,
      // How often cargo, game events and bunkers are checked. Fixed; see TICK_SECONDS.
      checkSeconds: TICK_SECONDS,
      // ⚠ **THREE ZEROES AND AN EMPTY LIST ARE TWO OPPOSITE FACTS.** "Nothing has happened yet" and
      // "the server is not running, so nothing CAN happen" look identical on this screen, and a
      // reader who cannot tell them apart concludes the plugin is broken. The screen can only say
      // it if the payload carries it.
      serverRunning: (host.server && typeof host.server.isRunning === 'function') ? !!host.server.isRunning() : null,
      // Said out loud rather than left as three zeroes: an owner reading "0 sent" needs to know
      // whether that is a quiet night or a bridge that is not answering.
      pollError: lastPollError,
      pollErrorDetail: lastPollDetail,
      // Cargo and events are not asked for while the server is known to be empty -- see `poll`.
      waitingForPlayers,
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
