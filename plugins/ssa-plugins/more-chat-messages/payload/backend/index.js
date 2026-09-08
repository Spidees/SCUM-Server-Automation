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
//   bunkers        `host.map.bunkers()` — the MANAGER's own reading. SCUM writes `[LogBunkerLock]`
//                  lines and `bunkerState.js` already parses them into
//                  `{ sector, state: 'active' | 'locked', keycard }`. That is a real state on a real
//                  clock, it names the sector itself, and it works with no bridge at all.
//   cargo          the SSA Bridge's `worldevents` module. Cargo is in no log and in no table of
//                  `SCUM.db`; the only thing that knows is the running game.
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
    // Three states, three lines, because they are three different pieces of news to a player: one
    // is a race starting, one is a place to go, and one is the race being over.
    incomingMessage: 'A cargo drop is on its way to {sector}',
    landedMessage: 'The cargo drop has landed in {sector}',
    goneMessage: 'The cargo drop in {sector} is gone',
    announceIncoming: true,
    announceLanded: true,
    announceGone: false,
  },
  bunkersSecret: {
    enabled: false,
    channel: 'global',
    openMessage: 'A secret bunker has opened in {sector}',
    closeMessage: 'The secret bunker in {sector} has closed',
    announceClose: false,
  },
  bunkersAbandoned: {
    enabled: false,
    channel: 'global',
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
  let lastPollError = '';

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

  /** A stable identity for one crate or bunker across two polls. */
  const idOf = (o) => [o && o.class, Math.round(Number(o && o.x) || 0), Math.round(Number(o && o.y) || 0)].join('|');

  async function poll() {
    // ── bunkers: the manager's own reading, and it needs no bridge ─────────────────────────────
    //
    // `host.map.bunkers()` is `bunkerState.js`, which parses the game's own `[LogBunkerLock]` lines
    // into a real state. An empty array is BOTH "no bunker has been seen in the log yet" and "this
    // island has none", so the same rule as everywhere else applies: nothing is announced until
    // there is something to compare against.
    if (cfg.bunkersSecret.enabled || cfg.bunkersAbandoned.enabled) {
      let list = null;
      try { list = host.map.bunkers(); } catch { list = null; }
      if (Array.isArray(list) && list.length) {
        const now = new Map(list.map((b) => [String(b.sector), b]));
        if (lastBunkers) {
          for (const [sector, b] of now) {
            // `keycard` is what the game does for a SECRET bunker: it is opened with a key card and
            // runs on its own duration, where the abandoned ones are on a scheduled rota. That is
            // the same split an owner sees in game, so it is the split the two switches make.
            const s = b.keycard === true ? cfg.bunkersSecret : cfg.bunkersAbandoned;
            if (!s.enabled) continue;
            const was = lastBunkers.get(sector);
            const open = b.state === 'active';
            const wasOpen = !!(was && was.state === 'active');
            const vars = {
              sector,
              x: (b.location && b.location.x) || '',
              y: (b.location && b.location.y) || '',
            };
            if (open && (!was || !wasOpen)) say('bunker', s, s.openMessage, vars);
            else if (was && wasOpen && !open && s.announceClose) say('bunker', s, s.closeMessage, vars);
          }
          // A bunker that DISAPPEARS from the list is not one that closed -- `getBunkers()` drops a
          // keycard bunker whose window has elapsed, which is the same event as it closing, so it is
          // announced; a scheduled one never leaves the list at all.
          for (const [sector, was] of lastBunkers) {
            if (now.has(sector)) continue;
            const s = was.keycard === true ? cfg.bunkersSecret : cfg.bunkersAbandoned;
            if (s.enabled && s.announceClose && was.state === 'active') {
              say('bunker', s, s.closeMessage, { sector, x: (was.location && was.location.x) || '', y: (was.location && was.location.y) || '' });
            }
          }
        }
        lastBunkers = now;
      }
    }

    // ── cargo: only the bridge knows ───────────────────────────────────────────────────────────
    if (!cfg.cargo.enabled) return;
    let payload = null;
    try { payload = await host.bridge.worldEvents(); } catch { payload = null; }
    // ⚠ A REFUSAL IS NOT AN EMPTY WORLD. The bridge being off, the module being off and an island
    // with no crate on it all look like nothing here, and announcing "gone" for all of them would
    // fire every drop as it vanished on a hiccup. The last known state is left exactly as it is.
    if (!payload || payload.ok === false || !Array.isArray(payload.cargo)) {
      lastPollError = (payload && (payload.reason || payload.error)) || 'the bridge did not answer';
      return;
    }
    lastPollError = '';

    const now = new Map(payload.cargo.map((c) => [idOf(c), c]));
    if (lastCargo) {
      const s = cfg.cargo;
      for (const [id, c] of now) {
        const before = lastCargo.get(id);
        const landed = c.landed === true;
        if (!before) {
          if (landed && s.announceLanded) say('cargo', s, s.landedMessage, await cargoVars(c));
          else if (!landed && s.announceIncoming) say('cargo', s, s.incomingMessage, await cargoVars(c));
        } else if (before.landed !== true && landed && s.announceLanded) {
          say('cargo', s, s.landedMessage, await cargoVars(c));
        }
      }
      if (s.announceGone) {
        for (const [id, c] of lastCargo) {
          if (!now.has(id)) say('cargo', s, s.goneMessage, await cargoVars(c));
        }
      }
    }
    lastCargo = now;
  }

  const secs = Number(cfg.pollSeconds);
  // Bounded here rather than trusted: a hand-edited 0 would put a world walk on the game thread as
  // fast as the loop can go. The positive form, so a NaN lands on the default.
  const every = (secs >= 5 && secs <= 3600) ? secs : DEFAULTS.pollSeconds;
  host.schedule.every(every * 1000, () => { poll().catch(() => {}); });

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
      pollSeconds: every,
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
      },
    });
  });

  log.info('more-chat-messages ready — '
    + Object.keys(DEFAULTS).filter((k) => cfg[k] && cfg[k].enabled).length + ' announcement(s) on');
}

module.exports = { register, _DEFAULTS: DEFAULTS, _merge: merge, _fill: fill, _channelOf: channelOf };
