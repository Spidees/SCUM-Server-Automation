'use strict';

/**
 * Loot Zones — one rectangle, several halves, kept in step.
 *
 * SCUM lets a server change what spawns inside a rectangle: you put spawner-preset files in
 * `Config/WindowsServer/Loot/Spawners/Presets/Override/<anything>/` together with a `Zones.json`
 * naming the corners, and the game applies them inside it. `ReloadLootCustomizationsAndResetSpawners`
 * makes that take effect without a restart. Separately, the game lets an admin draw a custom zone on
 * the map — a named, coloured rectangle players can see. Separately again, the world holds sentries
 * and the bridge can remove things from a place and put things back.
 *
 * Those are unrelated features that happen to share a rectangle, and doing them by hand means copying
 * a folder, running a command, drawing a zone whose corners you hope match, and sweeping the sentries
 * yourself. This plugin makes the ONE rectangle drive all of it, so the area a player sees is exactly
 * the area whose loot changed and exactly the area whose guards did.
 *
 * ── WHAT THE GAME ACTUALLY DOES, because none of these is obvious ────────────────────────────────
 *
 * **Loot priority is by zone SIZE, smallest wins** — not by folder depth or name. A preset file at
 * the root of `Override/` with no `Zones.json` is global, which is the largest area there is and so
 * the lowest priority. That is what makes this plugin safe to run on a server that already has its
 * own permanent overrides: a zone folder wins inside its rectangle and changes nothing outside it,
 * and the owner's root files are never read, moved or written.
 *
 * **The reload resets every examine spawner on the map, not just the ones in the zone.** So each
 * switch hands every player on the server a fresh set of searchable containers everywhere. That is
 * the game's command, not a choice this plugin makes, and it is why `minMinutesBetweenSwitches`
 * exists and why it is checked for a manual switch too.
 *
 * **Vicinity and World spawners are NOT reset by it** — loot lying on the ground changes only as its
 * own cooldown expires. Roughly a fifth of a typical preset set is that kind, so a zone does not
 * fully "arrive" the instant it is switched on. Told to the admin in the tab rather than hidden.
 *
 * **A zone write rewrites the game's WHOLE zone set**, so the bridge refuses one until it has read
 * the current set back at least once — otherwise a write deletes every zone an admin ever drew.
 * Reading it back needs a player online, because the refresh goes out on a player's RPC channel. So
 * the loot half of a switch works on an empty server and the map half genuinely cannot, and this
 * plugin does the loot immediately and keeps trying the rectangle rather than reporting a zone it
 * never drew. `drawn` is per zone and it is on the screen.
 *
 * **Visible on map and Notification on entry belong to a CONFIGURATION, not to a zone.** A zone
 * carries a name, a shape, a rectangle and the index of a configuration; the two switches live on
 * that configuration, as bits of one byte. So `configMode: 'own'` keeps a configuration of this
 * plugin's own and writes them there, and `'existing'` points at one the owner already has and
 * touches nothing.
 *
 * **A sentry removed here comes back, and the timer that brings it back is GLOBAL.** SCUM keeps one
 * set of sentry numbers for every guarded zone on the map — the bridge's own `guardedtune` says so
 * and takes no level argument — so lengthening the respawn delay is a server-wide change, it is not
 * saved (it resets on restart, so it has to be re-applied), and whether a respawn already scheduled
 * picks up the new value is not established. That is why the patrol is what this plugin does by
 * default and the global delay is an extra an owner switches on knowing what it costs.
 *
 * **An NPC put in a sentry's place is NOT registered with SCUM**, so it is gone at the next restart,
 * and it can be killed like anything else. Keeping a post guarded is therefore a patrol as well:
 * the plugin remembers where each post is and puts a new one there when the old one has gone.
 *
 * ── WHAT THIS PLUGIN WILL NOT DO ────────────────────────────────────────────────────────────────
 *
 * It never writes into `Override/` except inside its own `LOOT_ZONES_*` folder, and it removes only
 * folders with that prefix. An owner's existing overrides are untouchable by construction rather
 * than by care.
 *
 * It never invents a rectangle. Every zone's corners are READ from that set's own `Zones.json` —
 * the same file the game reads — so the map zone and the loot zone cannot drift apart. A set whose
 * `Zones.json` is missing or unreadable is refused and named, not guessed at.
 *
 * It never sweeps a sphere. The bridge's despawn is a sphere and a zone is a rectangle, so every
 * candidate is PREVIEWED first and removed one by one by its own id, and only the ones whose
 * position is inside the rectangle. A sentry a metre outside the owner's zone is not this plugin's
 * to touch.
 */

const fs = require('fs');
const path = require('path');

// ── the shipped configuration, IN THE BACKEND ────────────────────────────────────────────────────
//
// `payload/config.json` is the owner's copy of this and must match it key for key.
// `host.config.get()` is a `safe()` wrapper over a file read: a library copy that is missing,
// half-written or older than this version's keys comes back `{}`, which is indistinguishable from
// "configured nothing" — so the defaults live here and the file is a copy, never the only source.
const DEFAULTS = {
  enabled: false,

  // Where the loot sets live. Empty = the plugin's own `sets` folder under its data directory,
  // which is what `GET /sets` reports so an owner can see where to put them.
  setsDir: '',

  // How the active zone is chosen.
  //   'manual'  — only what an admin switches on in the tab
  //   'time'    — each zone's own time windows decide
  //   'restart' — one zone per SERVER restart, taken in turn, and chosen the moment the server
  //               STOPS rather than when it comes back: SCUM reads its Loot folder at startup, so
  //               files written under a running game are read a whole session late. The server's own
  //               restart, not the manager's — those are different clocks, and a manager that
  //               restarts for its own reasons while the game runs on must not move the loot.
  rotation: 'manual',

  // 'restart' only: 'order' walks the enabled list in turn, 'random' picks one.
  restartPick: 'order',

  // How many zones may be active at once. The game allows several; this is a floor under accidents,
  // because every extra zone is another folder the reload has to read.
  maxActive: 1,

  // ⚠ Every switch resets every examine spawner ON THE WHOLE MAP — that is what the game's reload
  // command does. Rotating every few minutes therefore hands players endlessly refreshed containers
  // island-wide. This is the guard, in minutes, and it is checked for EVERY switch including a
  // manual one and including a switch-off, which runs the same reload.
  minMinutesBetweenSwitches: 30,

  // Reload loot and reset spawners straight after a switch while the server is running, so the zone's
  // loot is live at once instead of at the next restart. Needs SSA Bridge 2.22.2 or newer, which runs
  // the game's command on its own thread; an older bridge is never sent it.
  reloadOnSwitch: true,

  // How often the schedule is looked at, and how often a rectangle that could not be drawn is tried
  // again. One minute is plenty for a feature whose floor is measured in tens of minutes.
  checkEverySeconds: 60,

  // The zone as players meet it.
  zone: {
    // Prefix for the zone name in game. The set's name is appended, so a zone is recognisable and
    // cannot collide with a zone an admin drew by hand. It is also what `reconcile()` matches on,
    // so changing it orphans whatever is live — switch everything off first.
    //
    // ⚠ NO COLON. The bridge's zone command is seven colon-separated fields with the name first, so
    // a colon in a name shifts the shape into a coordinate's place and the game refuses the whole
    // write. This shipped as "Loot: " and every zone it ever tried to draw was refused.
    namePrefix: 'Loot ',

    // 'existing' points every zone at a configuration the owner already has, by index, and changes
    // nothing about it. 'own' keeps a configuration of this plugin's own, by NAME, and writes the
    // two switches and the colour below onto it.
    configMode: 'existing',
    configIndex: 0,
    ownConfigName: 'Loot Zones',

    // These belong to the CONFIGURATION, so they are written only in 'own' mode. In 'existing' mode
    // they are not this plugin's to change and the tab says so.
    visibleOnMap: true,
    notifyOnEntry: true,

    // The configuration's colour. FOUR FLOATS BETWEEN 0 AND 1 — the module's own refusal says so in
    // as many words — not four bytes. Only written in 'own' mode.
    colour: { r: 1, g: 0.64, b: 0.1, a: 1 },
  },

  // ── what players are told ──────────────────────────────────────────────────────────────────────
  //
  // Four messages, each with its own text and its own routes. An empty text switches that message
  // off however the routes are set, which is the one behaviour an owner will expect without reading
  // anything.
  //
  // The routes, and what each one really is:
  //   chat      a line in the game's chat, on `chatChannel` — which may be `server`, the channel the
  //             game keeps for the server's own voice; the bridge has always taken it
  //   hud       a HUD line, which scrolls away with the rest of the feed
  //   alert     the same with the game's alert sound (needs the bridge's `sound` switch too)
  //   killFeed  a kill-feed entry, which is the one thing that STAYS on screen
  //   history   the CHAT HISTORY — the admin chat view, the field console, and the Discord chat
  //             channel. SCUM does not log what the bridge injects, so without this an announcement
  //             is visible in game and nowhere else. A route of its own rather than part of `chat`,
  //             because an owner may want the record without the in-game line or the other way round.
  //
  // There is no banner and no colour anywhere: the game's only banner call is client-local, and a
  // HUD notification reflects no colour field. A colour prefix travels through as literal text.
  chatChannel: 'global',

  messages: {
    activate: {
      enabled: true,
      text: '{zone} now has different loot. It stays that way for a while.',
      chat: true, hud: false, alert: false, killFeed: false, history: false,
    },
    deactivate: {
      enabled: true,
      text: '{zone} is back to its normal loot.',
      chat: true, hud: false, alert: false, killFeed: false, history: false,
    },
    // Sent to ONE player who joins while a zone is live. `delaySeconds` exists because a player who
    // has just spawned in is still looking at a loading screen.
    join: {
      enabled: false,
      text: 'Right now the richer loot is in {zones}.',
      delaySeconds: 20,
      // `alert` on a message to ONE player is the kill feed's notification sound — the game has no
      // other per-player sound — and it sends one entry rather than two.
      chat: true, hud: false, alert: false, killFeed: false, history: false,
    },
    // A periodic reminder while something is live. Off by default: a server that says the same
    // sentence every ten minutes is a server people mute.
    reminder: {
      enabled: false,
      everyMinutes: 60,
      text: '{zones} still has the better loot.',
      chat: true, hud: false, alert: false, killFeed: false, history: false,
    },
  },

  // ── the guards inside a zone, as a DEFAULT ─────────────────────────────────────────────────────
  //
  // Every zone falls back to this, and any zone may carry its own `sentries` block that overrides it
  // key by key — one outpost wants clearing and the airfield across the island does not, which is the
  // ordinary case rather than the exotic one. Set once here for the zones that agree.
  //
  // 'leave'   touch nothing
  // 'remove'  clear the sentries inside the rectangle while the zone is live
  // 'replace' the same, and keep guards of your choosing standing where they stood
  sentries: {
    mode: 'leave',

    // Which kinds count. `sentry` is the deployed one; `mapsentry` is the fixed emplacement; `puppet`
    // is the game's zombies, for a zone that should hold nothing but the guards chosen below.
    kinds: ['sentry'],

    // ⚠ NOTHING HAPPENS IN A ZONE NOBODY IS NEAR. SCUM makes sentries, NPCs, animals and puppets
    // around players and takes them away again once nobody is close, so clearing an empty place or
    // putting guards into it is work the game undoes before anybody could see it. A zone is AWAKE
    // while a player stands within this many centimetres of its rectangle (0 inside it), and asleep
    // otherwise — asleep, the plugin makes no bridge call for that zone at all apart from reading
    // where the players are. 40000 is 400 m, past the 200-300 m at which the game switches a guarded
    // place on, so a zone wakes before its sentries exist. Floored at 50 m, capped at 2 km.
    wakeDistance: 40000,

    // How often an AWAKE zone is looked at, in seconds, floored at 3. A sentry the game has just made
    // is put away within one of these, so it is the longest a player can see one appear. Asleep, the
    // same clock only reads where the players are.
    nearbyPatrolSeconds: 5,

    // Kept so a configuration written before the patrol followed the players still loads unchanged.
    // Nothing reads it any more: `nearbyPatrolSeconds` is the patrol's clock, and only while somebody
    // is near.
    patrolSeconds: 60,

    // The search is a SPHERE, so it needs a height for its centre and a vertical reach. Everything
    // outside the rectangle is discarded afterwards, so these only decide what is LOOKED at.
    centreZ: 0,
    reachZ: 100000,

    // ⚠ SCUM keeps ONE set of sentry numbers for every guarded zone on the map — its own tuning call
    // takes no zone argument — so this lengthens the respawn delay ISLAND-WIDE, not in the zone. It
    // is also not saved: it resets when the server restarts, which is why the plugin re-applies it
    // while a zone is live and puts it back when nothing is. Off by default, because an owner who
    // wanted a quieter loot zone did not ask for quieter outposts everywhere.
    globalRespawn: {
      enabled: false,
      seconds: 3600,
    },

    // ── FIXED MAP SENTRIES ARE PUT AWAY, NOT REMOVED ────────────────────────────────────────────
    //
    // A removed map sentry does not stay removed: each guarded place keeps its own record of what
    // belongs there and builds a new machine within about three seconds of the old one going.
    // Measured on a live server, 464 removals in a day and the same eleven sentries back every time.
    //
    // So a `mapsentry` is PUT AWAY instead, through the bridge's despawn module: its clock stopped, its
    // sight and hearing off, hidden with no collision, and moved ninety metres under the ground — still
    // inside the distance its post allows, so the record sees a sentry and builds nothing. Driven on a
    // dev server with a player standing where they stood: nothing seen, nothing heard, nothing to walk
    // into, and no replacement over the whole test.
    //
    // It lasts as long as the game keeps that place switched on. Once nobody is near, the game takes
    // its sentries away itself and makes fresh ones when somebody comes back — which is exactly when
    // this zone wakes up again and puts them away. That needs "Put fixed map sentries away instead of
    // removing them" on the bridge's Removal card. A deployed `sentry` is not rebuilt by anything, so
    // it is simply removed.

    // Guards where the game put none. A rectangle over open ground has no sentries to clear, and
    // most of the island is open ground — so a zone can ask for posts of its own, laid out inside it,
    // with no sentry involved at all. 0 keeps the old behaviour: posts come only from cleared
    // sentries.
    ownPosts: 0,

    replace: {
      // MORE THAN ONE KIND OF GUARD. A guarded place in SCUM is not one repeated figure — an outpost
      // has riflemen and something heavier, a town has a few puppets and one thing worth running
      // from — so a zone names a LIST, and each entry is a whole choice in itself:
      //
      //   { route, kind, classPath, spawnKind, spawnName, count, weight, label }
      //
      // `weight` decides how often that entry is the one a post gets, against the other entries'
      // weights: two entries weighted 5 and 1 fill five posts with the first for every one of the
      // second. The share is worked out by POSITION rather than by chance, so an owner asking for one
      // heavy in six gets exactly that rather than a roll that gives them none.
      //
      // Empty means the single choice below, which is what every configuration written before this
      // list existed carries. Nothing an owner already set changes meaning.
      types: [],

      // 'spawn' puts a guard there directly. It works on an empty server, it hands back an id — which
      // is the only reason a post can be CHECKED afterwards — and it is gone at the next restart, so
      // the patrol simply fills every post again. 'persistent' goes through the game's own spawn
      // command instead: SCUM keeps what it makes, and it answers with no identifier at all, so a
      // guard made that way can never be asked about again and the patrol falls back to looking at
      // what is standing there, which cannot tell a corpse from a guard. It also needs somebody
      // online, because the command is dispatched on a player's own admin channel.
      route: 'spawn',

      // 'persistent' route: the game's own spawn NAME, which is what the picker in the tab hands
      // back, and the kinds its command accepts.
      spawnKind: 'armednpc',
      spawnName: '',

      // 'spawn' route: the bridge's kind plus the full class path the game knows it by. There is no
      // picker for this one and the tab says why — nothing this product publishes carries a class
      // path.
      kind: 'npc',
      classPath: '',

      // How many stand at each post.
      count: 1,

      // A post is held while something of ours is standing within this many centimetres of it. The
      // patrol counts what is there rather than remembering what it spawned: an actor this plugin
      // created carries no identity it could ask about later, and something that walked off its post
      // is not holding it either.
      postRadius: 1500,

      // How long a post may stand empty before a new guard appears, in seconds. Not zero by default:
      // a guard that reappears the instant it dies reads as a cheat to the player who killed it.
      afterDeathSeconds: 120,

      // A ceiling on how many posts one zone keeps, so a rectangle over a whole outpost cannot turn
      // into fifty spawns a minute. Posts past it are cleared and not guarded, and the tab says so.
      maxPosts: 12,

      // How long the whole ZONE waits after sending one guard before it sends another, in seconds.
      //
      // The other two brakes are a different question: `afterDeathSeconds` is per POST — how long one
      // place may stand empty — and one-guard-per-round is the bridge's rate limit rather than the
      // owner's taste. Neither bounds the zone, so twelve posts fill one per patrol round, a few
      // seconds apart, for as long as somebody is near.
      //
      // ⚠ NOT a cap on how many guards a zone ends up with. It decides how FAST they arrive; every
      // post is still filled eventually, because a zone wiped in a raid has to be able to come back.
      // 0 is no cooldown at all.
      cooldownSeconds: 0,

      // At most this many of this zone's guards in the world at once, whatever the posts would take.
      // Counted across the whole zone, every guard type together. 0 is no ceiling.
      maxGuards: 0,

      // ⚠ **NO GUARD EVER APPEARS NEXT TO A PLAYER.** An armed NPC materialising in front of somebody
      // reads as a cheat and cannot be fought fairly — the one thing a player cannot do about it is
      // see it coming. A post with anybody within this many centimetres is SKIPPED this round rather
      // than filled; the patrol comes round again in a few seconds. Skipped rather than moved, because a
      // post is a fixed place on purpose and the whole mechanism rests on that.
      //
      // ⚠ **50 m, AND 150 m WAS TOO FAR.** Driven on a live server with the owner standing in the
      // zone: eleven sentries cleared, five guards sent, and SEVEN posts skipped because they were
      // within 150 m of them. The five were really there and all five were out on the edges, so what
      // the owner saw was an empty base and no guards at all.
      //
      // What was asked for is "not near, not right on top of". 150 m is neither — it is most of a
      // military base. 50 m is past the distance a spawn is visible popping in, and leaves the place
      // populated rather than ringed; the posts beside a player fill as soon as they move on.
      // 0 switches it off.
      keepAwayFromPlayers: 5000,
    },
  },

  // One entry per loot set. `set` is the folder name under `setsDir`; the rectangle is read from
  // that folder's own `Zones.json` and is never copied here, so the two cannot disagree.
  zones: [],
};

// How near two sentry positions have to be to count as ONE emplacement the game keeps refilling,
// rather than two places that both want guarding. Deliberately not an owner setting and deliberately
// not `postRadius`: that one asks how far a guard may stray from its post, which is metres because a
// guard with a working brain walks about, while this asks whether a respawn came back where it
// stood, which is not.
const SAME_SPOT_CM = 300;

/**
 * How many times a post may be filled without anything ever being seen standing on it, before the
 * post takes a REST — and how long that rest is.
 *
 * ⚠ **THIS IS A LEAK GUARD, NOT A RETRY LIMIT.** The game's own spawn route answers `confirmed` when
 * the game did not OBJECT and hands back no identifier, so a spawn that produced nothing in the
 * world is indistinguishable from one that worked — and the patrol then fills the post again, and
 * again. Measured on a live server: ten posts, five NPCs each, every five minutes, for ever, with
 * every number on the screen reading as success.
 *
 * Deliberately not 1 or 2. A guard really can die between two patrols and the direct route's id can
 * genuinely go missing, and both are ordinary. Never having seen ANYTHING standing, after this many
 * tries, is not ordinary.
 *
 * ⚠ **AND IT IS A REST, NOT A STOP.** *"They must not stop spawning — if they die or somebody shoots
 * them they have to come back, never be gone for ever."* A post that gave up for good would be a zone
 * that quietly disarms itself, which is worse than one that never armed: nobody notices. So after the
 * rest it tries again, and again, for ever. The spend stays bounded — a genuinely broken post costs a
 * handful of attempts an hour instead of one a minute — and nothing is ever permanently dead.
 *
 * A post that is ever seen held forgets all of it, so a zone where guards really are being killed is
 * never throttled at all.
 */
const MAX_BLIND_FILLS = 4;
const BLIND_REST_MS = 10 * 60 * 1000;

// A folder this plugin owns. Everything it puts in the game's `Override/` starts with this, and it
// removes nothing that does not — which is what makes an owner's own overrides safe by construction.
const OWNED_PREFIX = 'LOOT_ZONES_';

module.exports = {
  async register(host) {
    const log = host.logger || host.log;
    const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };
    const nz = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

    /**
     * One bridge call, or `null`.
     *
     * The bridge may not be deployed, may be older than a verb this plugin knows, or may reject —
     * and every caller here treats those three alike, because all three mean the game could not be
     * asked. What none of them may do is THROW: a route that throws takes the whole tab down with
     * it, and from the panel's side that is indistinguishable from a plugin that never registered.
     */
    function bx(verb) {
      const args = Array.prototype.slice.call(arguments, 1);
      let out;
      try {
        const f = host.bridge && host.bridge[verb];
        if (typeof f !== 'function') return Promise.resolve(null);
        out = f.apply(host.bridge, args);
      } catch { return Promise.resolve(null); }
      return Promise.resolve(out).catch(() => null);
    }

    // ── configuration ────────────────────────────────────────────────────────────────────────────
    // Merged by KEY PRESENCE, never truthiness: `"zones": []` is an owner who removed every zone
    // and must stay empty, while an absent `zones` has never been written.
    function merge(stored, defaults) {
      const out = Array.isArray(defaults) ? defaults.slice() : Object.assign({}, defaults);
      if (!stored || typeof stored !== 'object') return out;
      for (const k of Object.keys(stored)) {
        const v = stored[k];
        const d = defaults ? defaults[k] : undefined;
        if (v && typeof v === 'object' && !Array.isArray(v) && d && typeof d === 'object' && !Array.isArray(d)) {
          out[k] = merge(v, d);
        } else {
          out[k] = v;
        }
      }
      return out;
    }
    const cfg = () => merge(host.config.get() || {}, DEFAULTS);

    /** A caller's body laid over what is STORED, so a save naming one key does not reset the rest. */
    function overlay(stored, body) {
      const out = Object.assign({}, (stored && typeof stored === 'object') ? stored : {});
      if (!body || typeof body !== 'object') return out;
      for (const k of Object.keys(body)) {
        const v = body[k];
        const cur = out[k];
        if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
          out[k] = overlay(cur, v);
        } else {
          out[k] = v;
        }
      }
      return out;
    }

    // ── where things are ─────────────────────────────────────────────────────────────────────────
    const serverDir = (host.paths && host.paths.serverDir) || '';
    const lootDir = serverDir
      ? path.join(serverDir, 'SCUM', 'Saved', 'Config', 'WindowsServer', 'Loot')
      : '';
    const overrideDir = lootDir ? path.join(lootDir, 'Spawners', 'Presets', 'Override') : '';

    /**
     * The server's own NPC ceiling, `scum.MaxAllowedNPCs`, or null when it cannot be read.
     *
     * ⚠ **AT 0 THE GAME KEEPS AN ARMED NPC ONLY NEAR A PLAYER.** Measured at B2 Airport on a server
     * set to 0: a guard sent 120, 162 and 173 m from the player stayed; one sent 177, 196, 201, 222 and
     * 252 m away was destroyed by the game three to four seconds after it appeared, wherever it stood.
     * So on such a server a guard can only ever be where somebody is, and sending one further out makes
     * players watch it pop in and out. Read off the ini the game itself reads, re-read when it changes.
     */
    let npcLimitSeen = { mtimeMs: -1, value: null };
    function npcLimit() {
      if (!serverDir) return null;
      const f = path.join(serverDir, 'SCUM', 'Saved', 'Config', 'WindowsServer', 'ServerSettings.ini');
      try {
        const st = fs.statSync(f);
        if (st.mtimeMs === npcLimitSeen.mtimeMs) return npcLimitSeen.value;
        const m = /^\s*scum\.MaxAllowedNPCs\s*=\s*(-?\d+)/im.exec(fs.readFileSync(f, 'utf8'));
        npcLimitSeen = { mtimeMs: st.mtimeMs, value: m ? Number(m[1]) : null };
        return npcLimitSeen.value;
      } catch { return null; }
    }

    function setsRoot() {
      const custom = String(cfg().setsDir || '').trim();
      if (custom) return custom;
      const dir = (host.info && host.info.dataDir) || '';
      return dir ? path.join(dir, 'sets') : '';
    }

    // ── reading a set ────────────────────────────────────────────────────────────────────────────
    /**
     * The corners of a set, out of the set's OWN `Zones.json`.
     *
     * Never out of this plugin's configuration. The game reads that file to decide where the loot
     * applies; if the map zone came from anywhere else the two could drift, and a rectangle drawn
     * somewhere other than the loot it advertises is worse than no rectangle at all.
     *
     * SCUM writes the corners as `"X=547167.188 Y=-498499.219"`, and TopLeft carries the LARGER X
     * and the larger Y on this map, so the centre and the size are taken with absolute differences
     * rather than by assuming a direction.
     */
    function readRect(setName) {
      const root = setsRoot();
      if (!root) return { ok: false, why: `${setName}: there is nowhere to read loot sets from — this manager has given the plugin no data directory` };
      const f = path.join(root, setName, 'Zones.json');
      let raw;
      try {
        raw = fs.readFileSync(f, 'utf8');
      } catch (e) {
        return { ok: false, why: `${setName}: its Zones.json could not be read (${e.code || e.message}) — that file is what tells the game where this loot applies, so the set cannot be used without it` };
      }
      let j;
      try { j = JSON.parse(raw); } catch (e) {
        return { ok: false, why: `${setName}: its Zones.json is not valid JSON (${e.message})` };
      }
      const list = Array.isArray(j && j.Zones) ? j.Zones : [];
      if (!list.length) return { ok: false, why: `${setName}: its Zones.json carries no rectangle` };

      const pt = (s) => {
        const m = /X\s*=\s*(-?[\d.]+)\s+Y\s*=\s*(-?[\d.]+)/i.exec(String(s || ''));
        return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
      };
      const rects = [];
      for (const r of list) {
        const a = pt(r && r.TopLeft);
        const b = pt(r && r.BottomRight);
        if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
          return { ok: false, why: `${setName}: a rectangle in Zones.json has corners this cannot read` };
        }
        // x,y is the CENTRE and width/height the whole span of the rectangle, which is what every
        // measurement in this plugin works in. What the GAME stores is half of that: see `halfOf`.
        rects.push({
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
          width: Math.abs(a.x - b.x),
          height: Math.abs(a.y - b.y),
        });
      }
      return { ok: true, rects, count: rects.length };
    }

    /** Every set on disk: a folder with a Zones.json in it. */
    function listSets() {
      const root = setsRoot();
      if (!root) return { root: '', sets: [], readable: false };
      let names = [];
      try {
        names = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
      } catch {
        return { root, sets: [], readable: false };
      }
      const sets = names.map((n) => {
        const r = readRect(n);
        let files = 0; let examine = 0; let world = 0;
        try {
          for (const f of fs.readdirSync(path.join(root, n))) {
            if (!f.toLowerCase().endsWith('.json') || f === 'Zones.json') continue;
            files++;
            if (f.includes('Examine_')) examine++; else if (f.includes('World_')) world++;
          }
        } catch { /* counted as zero; the rect error below is the one that matters */ }
        return { name: n, ok: r.ok, why: r.why || null, rects: r.ok ? r.rects : [], presets: files, examine, world };
      });
      return { root, sets, readable: true };
    }

    // ── state ────────────────────────────────────────────────────────────────────────────────────
    // What WE believe is on. The game is the authority and `reconcile()` below asks it.
    /**
     * When THIS manager process watched the server come up — in memory, deliberately.
     *
     * ⚠ It used to be in the store, and a stored one goes STALE rather than absent. It is written
     * only from `server:online`, and a manager started over an already-running server never sees
     * that event — so after both restart in that order the store still held the PREVIOUS session's
     * start, `lootWrittenAt > serverUpAt` stayed true for ever, and the tab told the owner to restart
     * a server that had already read the files. A fact about what this process observed must not
     * outlive it: absent then reads as "I do not know", which is the honest answer and the one the
     * screen already has a sentence for.
     */
    let serverUpAt = 0;

    /**
     * The patrol's own clocks and last readings, IN MEMORY.
     *
     * An awake zone is looked at every few seconds, and writing the store that often is a file
     * rewrite every few seconds for a timestamp. So the clocks live here, and the stored copy of a
     * patrol is written only when what it SAYS has changed — `/status` reads this first.
     */
    const patrolClock = {};
    const patrolSeen = {};
    const lastRefusalLog = {};
    const wasAwake = {};

    const K = {
      active: 'active', lastSwitch: 'lastSwitchMs', turn: 'restartTurn',
      reminded: 'lastReminderMs', swept: 'lastGuardSweepMs', posts: 'guardPosts',
      respawnSet: 'globalRespawnSet', respawnWas: 'globalRespawnWas',
      // Which zone the CURRENT server session picked. A manager that restarts under a running server
      // re-applies this rather than advancing, so its own restart never moves the loot.
      sessionPick: 'sessionPick',
      // What the last patrol of each zone actually saw. On the screen, because the bridge logs
      // commands and not reads: a patrol that found nothing is otherwise invisible.
      lastPatrol: 'lastPatrol',
      // The two halves of "is the loot live, or is it waiting for a restart" — the question the
      // reload command would have answered, and the only honest thing left now that it cannot be
      // sent. SCUM reads its Loot folder at STARTUP and at no other time, so what matters is which
      // of the two happened last: this plugin writing the files, or the game coming up and reading
      // them. ⚠ `serverUpAt` is ABSENT on a manager that was started over an already-running server,
      // and absent is reported as not knowing rather than filled in.
      // When each zone last really sent a guard — the zone's own cooldown clock.
      lastGuardAt: 'lastGuardAtMs',
      // Guards seen DEAD, per zone, by actor id, with when they were first seen dead. What makes the
      // respawn delay apply to a kill and not to a guard the game took away.
      kills: 'guardKills',
      lootWrittenAt: 'lootWrittenAtMs',
      // Which way the waiting change goes: 'on' (richer loot coming) or 'off' (normal loot back).
      lootPendingKind: 'lootPendingKind',
      // When the running game last reloaded its Loot folder on this plugin's say-so.
      lootReloadedAt: 'lootReloadedAtMs',
    };

    /**
     * The posts of one zone: the places a sentry was cleared from, which this plugin then keeps
     * held. In the STORE rather than in a closure, for the same reason the three clocks are — a
     * manager restart forgets a closure, and a forgotten post is a place that was guarded yesterday
     * and is quietly empty today with nothing saying so.
     */
    function postsOf(zoneId) {
      const all = host.store.get(K.posts, {});
      const v = (all && typeof all === 'object') ? all[String(zoneId)] : null;
      return Array.isArray(v) ? v.slice() : [];
    }
    /**
     * The island-wide respawn delay a live zone is asking for, if any.
     *
     * It reaches every guarded zone on the map, so it cannot be per zone in effect however it is
     * configured — one live zone asking for it is the whole answer, and the longest wins.
     */
    function globalRespawnWanted() {
      const byId = new Map((cfg().zones || []).map((z) => [String(z.id), z]));
      const active = getActive();
      let best = null;
      for (const a of active) {
        const g = (guardsFor(byId.get(String(a.id)) || a) || {}).globalRespawn;
        if (!g || !g.enabled) continue;
        if (!best || nz(g.seconds, 0) > nz(best.seconds, 0)) best = g;
      }
      if (best) return best;
      // ⚠ "NO LIVE ZONE ASKED FOR IT" IS AN ANSWER, AND IT USED TO FALL THROUGH TO THE DEFAULT.
      // A zone carrying its own guard settings with this switched OFF, live and alone, still had the
      // page default applied — the one control here whose effect leaves the rectangle and reaches
      // every outpost on the island, applied against the explicit wish of the only zone running.
      // The default is what a zone FALLS BACK to, and `guardsFor` has already done that for each of
      // them; reaching for it again here overrides them instead.
      if (active.length) return { enabled: false };
      return (cfg().sentries || {}).globalRespawn || {};
    }

    /** Drop every remembered guard id, keeping the posts themselves. */
    function forgetGuardIds() {
      const all = host.store.get(K.posts, {});
      if (!all || typeof all !== 'object') return;
      const next = {};
      let moved = false;
      for (const id of Object.keys(all)) {
        next[id] = (Array.isArray(all[id]) ? all[id] : []).map((p) => {
          if (p && Array.isArray(p.ids) && p.ids.length) moved = true;
          return Object.assign({}, p, { ids: [], emptySince: 0, everHeld: false });
        });
      }
      if (moved) host.store.set(K.posts, next);
    }

    function setPostsIfChanged(zoneId, list) {
      if (JSON.stringify(postsOf(zoneId)) !== JSON.stringify(list)) setPosts(zoneId, list);
    }
    function setPosts(zoneId, list) {
      const all = Object.assign({}, host.store.get(K.posts, {}) || {});
      if (list && list.length) all[String(zoneId)] = list; else delete all[String(zoneId)];
      host.store.set(K.posts, all);
    }
    const getActive = () => {
      const v = host.store.get(K.active, []);
      return Array.isArray(v) ? v : [];
    };
    const setActive = (list) => host.store.set(K.active, list);

    /**
     * The name a zone carries in the game.
     *
     * ⚠ A COLON IS REMOVED, and this is the only place that happens, so the draw, the delete and
     * `reconcile()` all agree by construction. The bridge's zone commands are colon-separated with
     * the name FIRST — `set:<name>:<shape>:…` — so a colon in a name moves every field after it and
     * the write is refused. That was shipped as the default prefix and every zone was refused.
     */
    const safeZoneName = (v) => String(v == null ? '' : v).replace(/:/g, '-').trim();

    /**
     * ⚠ **THE PREFIX IS THE ONLY THING THAT MAKES A ZONE OURS, SO AN EMPTY ONE OWNS EVERYTHING.**
     *
     * `reconcile()` finds this plugin's zones with `name.startsWith(prefix)`, and
     * `''.startsWith('')` is true for every string there is — so a cleared box turns every zone the
     * admin ever drew into a stray of ours, and reconcile DELETES strays, through the bridge and then
     * through the save. It runs at boot and behind a button called "Check against the game".
     *
     * There is no safe way to have no prefix, because ownership is the prefix. So this is a refusal
     * rather than a quiet fallback to the shipped value: drawing under a name the owner did not
     * choose would then own — and delete — whatever else happens to carry it.
     */
    const prefixUsable = () => safeZoneName(cfg().zone && cfg().zone.namePrefix).length > 0;
    const NO_PREFIX = 'the zone name prefix is empty, and that prefix is the only thing that tells this '
      + "plugin's zones apart from the ones you drew yourself — with it blank, every zone on the server "
      + 'would count as ours. Put something in "Zone name prefix" on the plugin\'s tab.';
    const zoneNameFor = (entry) => safeZoneName(`${cfg().zone.namePrefix}${entry.name || entry.set}`);
    const zoneNameAt = (entry, i, count) => safeZoneName(count > 1 ? `${zoneNameFor(entry)} ${i + 1}` : zoneNameFor(entry));
    const ownedFolder = (entry) => `${OWNED_PREFIX}${String(entry.set).replace(/[^A-Za-z0-9._-]/g, '_')}`;

    // ── the game's zone set ──────────────────────────────────────────────────────────────────────
    /**
     * Read the game's zone set, asking for it if it has not arrived.
     *
     * Every zone write rewrites the whole set, so the bridge refuses one until it has read the set
     * back at least once — `mod_zones.cpp`: *"the current set has never been read — send 'refresh'
     * first, or every zone an admin drew is deleted"*. Nothing in the manager ever sends that
     * refresh, and the game only volunteers the set when a client opens the zone screen or an admin
     * saves, so without this a rectangle is simply never drawn on a quiet server.
     *
     * The refresh itself goes out on an online player's RPC channel, so on an EMPTY server this
     * still comes back unknown. That is a real answer and the caller says so rather than retrying
     * for ever inside one call.
     */
    async function zoneSet(opts) {
      const first = await readZones();
      if (first && first.known === true) return first;
      if (opts && opts.noAsk) return first;
      const asked = await bx('refreshZones');
      // The reply lands a frame or two later, on the game's own thread.
      await new Promise((r) => setTimeout(r, 1500));
      const second = await readZones();
      if (second && second.known === true) return second;
      // The refresh's own refusal is the better sentence when there is one: it is the call that
      // needs a player, so it is the call that says so.
      if (asked && asked.ok === false && (asked.reason || asked.code)) {
        return Object.assign({ known: false }, second || {}, { why: asked.reason || asked.code });
      }
      return second;
    }

    /**
     * The game's zone set, WITH the reason when there is not one.
     *
     * `host.bridge.zones()` goes through `data()`, which answers `null` for a bridge that is off, a
     * module that is off and a module that refused alike, and writes the real reason to the
     * manager's log. `query()` is the documented way to be told instead — it logs nothing precisely
     * because a caller asking for the reason means to handle it.
     */
    async function readZones() {
      const q = (host.bridge && typeof host.bridge.query === 'function')
        ? await Promise.resolve(host.bridge.query('zones', 'zones')).catch(() => null)
        : null;
      if (q && q.ok && q.data) return q.data;
      if (q && q.ok === false) {
        return { known: false, why: q.reason || (await whyNoAnswer('zones', 'the zone list')) };
      }
      // An older manager with no `query`: fall back to the wrapper and ask the cheap question.
      const r = await bx('zones');
      if (r && r.known === true) return r;
      return { known: false, why: await whyNoAnswer('zones', 'the zone list') };
    }

    /**
     * Why a module did not answer, in as few words as are true.
     *
     * `host.bridge.data()` collapses every failure into `null` and logs the real reason where a
     * plugin cannot reach it, so a caller that only sees the null has to ask again. This asks the one
     * question that covers nearly every case — is that module switched on — and where it is neither
     * of those two it says the read was refused rather than inventing a third answer.
     */
    async function whyNoAnswer(moduleId, what) {
      const on = await bx('moduleEnabled', moduleId);
      if (on === null || on === undefined) {
        return 'the bridge is not answering at all — check it is installed, running, and switched on '
          + 'for this server';
      }
      if (on === false) {
        return `the bridge's "${moduleId}" module is switched off, so ${what} cannot be read. Turn it `
          + 'on on that module\'s own card.';
      }
      return `the bridge's "${moduleId}" module is on and refused this read; the manager's log carries `
        + 'its own words for it';
    }

    const NO_BRIDGE_ANSWER = 'the bridge did not answer — it is not deployed, it is not running, '
      + 'or this build of it does not carry that command';

    const NOT_KNOWN = 'the game has not sent the bridge its zone list yet, and a zone cannot be '
      + 'written until it has — the bridge asks for it through an online player, so this usually '
      + 'means nobody is on the server. The loot is live; the rectangle is drawn as soon as it can be.';

    /**
     * The configuration index our zones should point at.
     *
     * In `'own'` mode this is looked up BY NAME on every call and never remembered: deleting a
     * configuration renumbers every one above it, so a stored index is a number that silently starts
     * meaning something else.
     */
    async function configIndexFor(live) {
      const c = cfg();
      if (c.zone.configMode !== 'own') return { index: Math.max(0, nz(c.zone.configIndex, 0)) };
      const want = String(c.zone.ownConfigName || 'Loot Zones');
      const find = (l) => {
        const rows = (l && Array.isArray(l.configs)) ? l.configs : [];
        const hit = rows.findIndex((r) => String(r && r.name) === want);
        return hit >= 0 ? hit : -1;
      };
      let at = find(live);
      if (at < 0) {
        const made = await bx('zoneConfigCommand', `add:${want}`);
        if (!made || made.ok !== true) {
          return { index: null, why: `the configuration "${want}" does not exist and could not be created (${(made && (made.reason || made.error)) || 'refused'})` };
        }
        const again = await bx('zones');
        at = find(again);
        if (at < 0) return { index: null, why: `the configuration "${want}" was created and is not in the list the game sent back` };
        log.info(`created the zone configuration "${want}" at index ${at}`);
      }
      // Its two switches and its colour are ours to keep in step, and only in this mode. Handed back
      // as EDITS rather than sent: they travel with the rectangles in one zone set — see `zoneEdits`.
      const bits = [];
      if (c.zone.visibleOnMap) bits.push('visibleOnMap');
      if (c.zone.notifyOnEntry) bits.push('notifyOnEntry');
      // Four floats between 0 and 1. Clamped rather than passed through: a config written against
      // the old 0..255 shape would otherwise be refused on every switch with nothing on the screen
      // saying why, and a colour is not worth refusing a zone over.
      const col = c.zone.colour || {};
      const part = (v, d) => {
        let n = nz(v, d);
        if (n > 1) n = n / 255;                       // an old 0..255 value, read as what it meant
        return Math.max(0, Math.min(1, n));
      };
      /**
       * ⚠ **KEEPING ZOMBIES OUT IS THE GAME'S OWN RULE FIRST, AND REMOVAL ONLY AFTER.** The owner, at B2
       * Airport, watching the plugin remove zombies the game kept making: *"nemaji se spawnovat vubec
       * v te zone"*. The zone configuration carries the game's "Availability Grid" rule — *"Certain
       * systems use the availability grid to check if the area can be used for spawning"* — and set to
       * Block on this plugin's own configuration, the owner reported no zombie appearing in the zone
       * and nothing was left for the plugin to remove. Only in this mode, because it is this plugin's
       * configuration; an existing one is shared with zones the owner drew and is not ours to change.
       */
      const blocks = [c.sentries || {}].concat((c.zones || []).filter((z) => z && z.sentries).map((z) => z.sentries));
      const zombiesOut = blocks.some((b) => (b.mode === 'remove' || b.mode === 'replace')
        && Array.isArray(b.kinds) && b.kinds.includes('puppet'));
      return {
        index: at,
        edits: [
          `config:setting:${at}:${bits.length ? bits.join('|') : 'none'}`,
          `config:color:${at}:${part(col.r, 1)}:${part(col.g, 0.64)}:${part(col.b, 0.1)}:${part(col.a, 1)}`,
          `config:event:${at}:availabilityGrid:${zombiesOut ? 'block' : 'allow'}`,
        ],
      };
    }

    /**
     * Zone edits, as ONE zone set whenever the bridge can take one. One answer per edit.
     *
     * The game takes nothing smaller than the whole set and sends it to every player, so drawing a
     * zone as a setting, a colour and a rectangle — three commands — replaced every zone on the
     * server three times. The owner noticed: *"je to takove jak kdyz se aplikuje vse"*. A batch is
     * all or nothing, so one refusal is every edit's answer. A bridge too old to know the verb says
     * so in its own refusal once, and the edits then go one at a time for the rest of this run.
     */
    let batchKnown = null;
    async function zoneEdits(lines) {
      const list = lines.filter(Boolean);
      if (!list.length) return [];
      if (list.length > 1 && batchKnown !== false) {
        const r = await bx('zoneBatch', list);
        const why = r ? String(r.reason || r.error || '') : '';
        const tooOld = !r || (r.ok !== true && /commands are refresh/.test(why) && !/batch:/.test(why));
        if (!tooOld) {
          batchKnown = true;
          return list.map(() => r);
        }
        if (r) batchKnown = false;
      }
      const out = [];
      for (const line of list) out.push(await bx('command', 'zones', line));
      return out;
    }

    // ── the loot side ────────────────────────────────────────────────────────────────────────────
    /**
     * ⚠ THE RELOAD NEEDS BRIDGE 2.22.2, AND AN OLDER BRIDGE IS NEVER SENT IT.
     *
     * `ReloadLootCustomizationsAndResetSpawners` dispatched through an older bridge KILLED THE SERVER.
     * Measured on a live one — two attempts, two fatals, two crashes, never a success:
     *
     *     bridge  00:50:15  fault dispatch faulted | cmd: ReloadLootCustomizationsAndResetSpawners
     *     game    22:50:15  Fatal error: [Line: 954] Node /Game/…/Items/SpawnerPresets2/…
     *                       Package_LoadSummary has zero prerequisites, but has not been queued.
     *
     * The clocks are two hours apart, so that is one instant, and the package named is a spawner
     * preset — the thing the reload goes and reads. It is Unreal's event-driven loader being asked to
     * bring a package in from a dispatch on the bridge's thread: the assert at Line 954, and the same
     * family as the `#SpawnItem` and quest fatals already recorded in this product. The standing rule
     * is never to force a synchronous load, and there is no way to ask for this one from inside the
     * game's own frame from out here.
     *
     * The cause was the THREAD: the bridge dispatched from UE4SS's polling thread, and a load is only
     * allowed on the game's. Bridge 2.22.2 runs this command on the game thread between frames, and
     * on the dev server it answered "Loot customizations reloaded." and "Examine spawners reset.",
     * re-parsed all 154 preset files, and the server carried on. So the version is the gate: below it
     * the plugin behaves as it always did and the loot lands at the next start.
     */
    const RELOAD_BRIDGE = [2, 22, 2];
    function bridgeAtLeast(v, want) {
      const got = String(v || '').split('.').map((n) => parseInt(n, 10));
      if (got.length < 3 || got.some((n) => !Number.isFinite(n))) return false;
      for (let i = 0; i < 3; i++) { if (got[i] !== want[i]) return got[i] > want[i]; }
      return true;
    }
    /**
     * Make the running game read its Loot folder again and reset its spawners. `{ ok, why }`.
     *
     * ⚠ Every searchable container on the WHOLE MAP is reset, not just the zone's — that is the game's
     * command, and it is why the switch floor exists. Only the game's own answer counts as done.
     */
    async function reloadLoot() {
      const running = (host.server && typeof host.server.isRunning === 'function') ? !!host.server.isRunning() : false;
      if (!running) return { ok: false, why: 'the server is not running, so it reads the loot when it starts' };
      const h = (host.bridge && typeof host.bridge.health === 'function') ? await host.bridge.health().catch(() => null) : null;
      if (!h || !h.available) return { ok: false, why: 'the bridge is not answering, so the loot lands at the next server start' };
      if (!bridgeAtLeast(h.version, RELOAD_BRIDGE)) {
        return { ok: false, why: `the bridge is ${h.version || 'an older version'}; reloading loot on a running server needs 2.22.2 or newer, so the loot lands at the next server start` };
      }
      const r = await host.server.command('ReloadLootCustomizationsAndResetSpawners');
      const said = (r && Array.isArray(r.output)) ? r.output.join(' ') : '';
      if (r && r.ok && r.confirmed !== false && /reloaded/i.test(said)) {
        host.store.set(K.lootReloadedAt, Date.now());
        log.info(`loot reloaded on the running server — the game said: ${said}`);
        return { ok: true, said };
      }
      const why = (r && (r.error || r.reason)) || (said ? `the game said: ${said}` : 'the game did not confirm it');
      log.warn(`loot reload was not confirmed (${why}); the loot lands at the next server start`);
      return { ok: false, why };
    }
    const LOOT_AT_RESTART = 'the loot files are in place: a running server reads them straight away when '
      + 'the reload after a switch is on and the bridge is 2.22.2 or newer, otherwise at its next start.';
    function copySet(setName, dest) {
      const src = path.join(setsRoot(), setName);
      fs.mkdirSync(dest, { recursive: true });
      let n = 0;
      for (const f of fs.readdirSync(src)) {
        if (!f.toLowerCase().endsWith('.json')) continue;
        fs.copyFileSync(path.join(src, f), path.join(dest, f));
        n++;
      }
      return n;
    }

    /**
     * Remove one of OUR folders. It refuses anything without the prefix, which is the whole of the
     * protection an owner's own overrides get: they are not in a folder this can name.
     */
    function removeOwned(folder) {
      if (!folder.startsWith(OWNED_PREFIX)) return false;
      try { fs.rmSync(path.join(overrideDir, folder), { recursive: true, force: true }); return true; } catch { return false; }
    }

    function ownedFolders() {
      try {
        return fs.readdirSync(overrideDir, { withFileTypes: true })
          .filter((e) => e.isDirectory() && e.name.startsWith(OWNED_PREFIX))
          .map((e) => e.name);
      } catch { return []; }
    }

    // ── the map side ─────────────────────────────────────────────────────────────────────────────
    /** Draw every rectangle of one set. Returns one row per rectangle, each honest about itself. */
    /**
     * Both refusals, in the order they were tried — or ONE, when they are the same refusal.
     *
     * The pairing exists because the two routes usually fail for different reasons and either alone
     * reads as the whole answer, sending somebody to fix the thing that is not wrong. When they
     * agree there is nothing to pair, and printing the same sentence twice is a wall of text an
     * owner stops reading.
     */
    function twoReasons(bridgeWhy, saveWhy) {
      const a = String(bridgeWhy || '').trim();
      const b = String(saveWhy || '').trim();
      if (a && b && a === b) return a;
      return `The bridge could not draw it: ${a} And the save could not be written: ${b}`;
    }

    /**
     * ⚠ **THE GAME'S RECTANGLE SIZE IS HALF ITS SPAN.** `FCustomZoneRegion::Size` is measured from the
     * centre outwards on each axis — for a circle that number is the radius, and a rectangle is the
     * same. Sending the whole span drew every zone twice as wide and twice as tall as its Zones.json:
     * the owner teleported to a TopLeft corner and the zone's corner was hundreds of metres away. With
     * B2 Airport resized to half those numbers, the owner confirmed they stood exactly on its corner.
     */
    const halfOf = (r) => ({ w: Number(r.width) / 2, h: Number(r.height) / 2 });

    async function drawZone(entry, rects, live) {
      // The other half of the reconcile refusal. A zone drawn while the prefix is blank is one
      // nothing can ever recognise as its own, so it would sit on the map for ever — and the moment
      // a prefix IS typed it becomes a stray belonging to nobody.
      if (!prefixUsable()) return rects.map((r, i) => ({ name: zoneNameAt(entry, i, rects.length), ok: false, why: NO_PREFIX }));
      const idx = await configIndexFor(live);
      if (idx.index == null) return rects.map((r, i) => ({ name: zoneNameAt(entry, i, rects.length), ok: false, why: idx.why }));
      const sets = rects.map((r, i) => `set:${zoneNameAt(entry, i, rects.length)}:rectangle:`
        + `${Number(r.x)}:${Number(r.y)}:${halfOf(r).w}:${halfOf(r).h}:${idx.index}`);
      const pre = idx.edits || [];
      const answers = await zoneEdits(pre.concat(sets));
      return rects.map((r, i) => {
        const res = answers[pre.length + i];
        return {
          name: zoneNameAt(entry, i, rects.length),
          ok: !!(res && res.ok),
          why: res ? ((res.reason || res.error) || null) : NO_BRIDGE_ANSWER,
        };
      });
    }

    /**
     * Draw the rectangles by writing them into the SAVE, with the game stopped.
     *
     * The route that exists because the bridge cannot do this when nobody is on. Everything that
     * makes it safe belongs to the manager's own zone writer: it refuses while this install's server
     * is running, refuses while a `SCUMServer` it could not place is running, refuses when the
     * process check and the database's own lock disagree, takes a verified `VACUUM INTO` backup
     * first, reads each row back inside the transaction, and refuses rather than repairs.
     *
     * So nothing here decides anything. It asks whether a write is possible, and if the answer is no
     * it hands that answer's own sentence back to be shown.
     */
    async function drawIntoSave(entry, rects, live) {
      if (!prefixUsable()) return { ok: false, why: NO_PREFIX };
      const m = host.map || {};
      if (typeof m.writeZones !== 'function' || typeof m.zonesWritable !== 'function') {
        return { ok: false, why: 'this manager is too old to write zones into the save — 5.15.2 is the first that can' };
      }
      const pre = await m.zonesWritable().catch(() => null);
      if (!pre || pre.ok !== true) {
        return { ok: false, why: (pre && (pre.reason || pre.code)) || 'the save cannot be written just now' };
      }
      const idx = await configIndexFor(live);
      if (idx.index == null) return { ok: false, why: idx.why };

      // Named exactly as the bridge route names them, so one zone is one zone whichever route drew
      // it and `reconcile()` recognises its own work either way.
      const known = new Set(((pre.zones || pre.regions || []).map((z) => String(z && z.name))));
      const create = []; const update = [];
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        const spec = {
          name: zoneNameAt(entry, i, rects.length),
          x: r.x, y: r.y, shape: 'rectangle', width: halfOf(r).w, height: halfOf(r).h, config: idx.index,
        };
        (known.has(spec.name) ? update : create).push(spec);
      }
      const res = await m.writeZones({ regions: { create, update } }).catch((e) => ({ ok: false, reason: e && e.message }));
      if (!res || res.ok !== true) {
        return { ok: false, why: (res && (res.reason || res.code)) || 'the zone write gave no answer' };
      }
      log.info(`"${entry.name || entry.set}" — ${create.length + update.length} rectangle(s) `
        + `written into the save${res.backup ? `, backup ${res.backup}` : ''}. Players see them when the server starts.`);
      return { ok: true, backup: res.backup };
    }

    /** Remove our rectangles from the SAVE. Same route, same guard, and a no-op if it cannot run. */
    async function eraseFromSave(entry, count) {
      const m = host.map || {};
      if (typeof m.writeZones !== 'function') return { ok: false };
      const n = Math.max(1, count || 1);
      const del = [];
      for (let i = 0; i < n; i++) del.push({ name: zoneNameAt(entry, i, n) });
      const res = await m.writeZones({ regions: { delete: del } }).catch(() => null);
      return { ok: !!(res && res.ok === true), why: res && (res.reason || res.code) };
    }

    async function eraseZone(entry, count) {
      const n = Math.max(1, count || 1);
      const names = [];
      for (let i = 0; i < n; i++) names.push(zoneNameAt(entry, i, n));
      const answers = await zoneEdits(names.map((name) => `delete:${name}`));
      return names.map((name, i) => ({ name, ok: !!(answers[i] && answers[i].ok) }));
    }

    // ── the guards ───────────────────────────────────────────────────────────────────────────────
    /**
     * The guard settings for ONE zone: its own, over the page's default.
     *
     * The single reader, deliberately. Nothing below it knows which of the two answered, so a zone
     * that overrides one key cannot end up on a different code path from one that overrides none.
     */
    /** When this zone was last patrolled. One clock per zone: two zones may patrol at different
     *  rates, and a shared one lets the faster keep resetting the slower. */
    function patrolClocks() { return patrolClock; }
    /** The last patrol of one zone, for the screen. */
    function rememberPatrol(zoneId, out) {
      const row = {
        at: Date.now(),
        reached: out.reached, inside: out.inside,
        removed: out.removed, stowed: out.stowed, puppets: out.puppets || 0, spawned: out.spawned, held: out.held, posts: out.posts,
        inZone: out.inZone == null ? null : out.inZone, maxGuards: out.maxGuards || 0, killed: out.killed || 0,
        refusals: (out.refusals || []).slice(0, 4),
        // Which kind of zero this patrol's zeros are. See `patrolGuards`.
        playersKnown: out.playersKnown === undefined ? null : !!out.playersKnown,
        playersOnline: out.playersOnline === undefined ? null : out.playersOnline,
        // true, false, or null when nobody's position could be read — three states, because "nobody
        // is near" and "I could not find out" must not render alike.
        awake: out.awake === undefined ? null : out.awake,
        nearest: out.nearest == null ? null : out.nearest,
        wakeDistance: out.wakeDistance == null ? null : out.wakeDistance,
      };
      const key = String(zoneId);
      patrolSeen[key] = row;
      // Stored only when the SENTENCE changed. A counter that moved is a changed sentence; the
      // timestamp and the distance to the nearest player are not.
      const gist = (r) => JSON.stringify(Object.assign({}, r, { at: 0, nearest: 0 }));
      const all = host.store.get(K.lastPatrol, {}) || {};
      if (!all[key] || gist(all[key]) !== gist(row)) {
        host.store.set(K.lastPatrol, Object.assign({}, all, { [key]: row }));
      }
    }

    /** What the screen shows: this process's own readings over whatever the store last kept. */
    function patrolsForScreen() {
      return Object.assign({}, host.store.get(K.lastPatrol, {}) || {}, patrolSeen);
    }

    function markPatrolled(zoneId) {
      patrolClock[String(zoneId)] = Date.now();
    }

    function guardsFor(entry) {
      const base = cfg().sentries || {};
      const own = (entry && entry.sentries) || null;
      if (!own || typeof own !== 'object') return base;
      const out = merge(own, base);
      // `replace` is a nested object and `merge` already recurses, but a zone that names only a
      // couple of its keys must keep the rest of the default's — which is the same key-presence rule
      // the whole config is merged by.
      return out;
    }

    const inRect = (o, r) => Math.abs(nz(o.x, NaN) - r.x) <= r.width / 2 && Math.abs(nz(o.y, NaN) - r.y) <= r.height / 2;
    const near = (a, b, cm) => {
      const dx = nz(a.x, NaN) - nz(b.x, NaN);
      const dy = nz(a.y, NaN) - nz(b.y, NaN);
      return Number.isFinite(dx) && Number.isFinite(dy) && (dx * dx + dy * dy) <= cm * cm;
    };

    /** How far a point is from a rectangle on the map, in centimetres, 0 inside it. Flat: a player
     *  flying over a zone is near it for every purpose this is asked for. */
    function rectDistance(p, r) {
      const dx = Math.max(0, Math.abs(nz(p.x, NaN) - r.x) - r.width / 2);
      const dy = Math.max(0, Math.abs(nz(p.y, NaN) - r.y) - r.height / 2);
      return Math.sqrt(dx * dx + dy * dy);
    }
    const wakeCm = (s) => Math.max(5000, Math.min(200000, nz(s.wakeDistance, 40000)));

    /**
     * Is anybody near this zone? `{ known, awake, nearest }`.
     *
     * ⚠ `known: false` IS NOT "NOBODY IS NEAR". A zone whose players could not be read does nothing and
     * says why: acting blind clears or fills places the game will undo, and sleeping silently reads as
     * a plugin that stopped working.
     */
    function awakeFor(s, rects, who) {
      if (!who || who.known !== true) return { known: false, awake: false, nearest: null };
      let nearest = Infinity;
      for (const q of who.at) {
        for (const r of rects) {
          const d = rectDistance(q, r);
          if (d < nearest) nearest = d;
        }
      }
      return {
        known: true,
        awake: nearest <= wakeCm(s),
        nearest: Number.isFinite(nearest) ? Math.round(nearest) : null,
      };
    }

    const PLAYERS_UNKNOWN = 'nothing was done in this zone: the plugin could not read where the players '
      + 'are, and it only works in a zone somebody is near. That reading is the bridge\'s "Live player '
      + 'data" module — it needs "Read live player data" and "Position, facing and speed" switched on. '
      + 'Both are reads.';

    /**
     * Can this bridge put a map sentry away, and is it allowed to? Read off the despawn module's own
     * `kinds` answer rather than learned from a refusal, and kept for thirty seconds — a patrol comes
     * round every few, and the answer changes only when an owner flips a switch.
     */
    let stowSeen = { at: 0, v: null };
    async function stowInfo() {
      if (stowSeen.v && Date.now() - stowSeen.at < 30000) return stowSeen.v;
      const k = await bx('despawnKinds');
      let v;
      if (!k || k.error || typeof k !== 'object') v = { known: false };
      else if (!k.stow || typeof k.stow !== 'object') v = { known: true, supported: false };
      else v = { known: true, supported: true, allowed: k.stow.allowed === true };
      if (v.known) stowSeen = { at: Date.now(), v };
      return v;
    }
    function stowWhy(st) {
      if (!st || !st.known) {
        return 'mapsentry: the bridge did not say whether it can put sentries away — the despawn module '
          + 'is off or the bridge is not running — so the fixed sentries here were left alone';
      }
      if (!st.supported) {
        return 'mapsentry: this bridge is too old to put fixed sentries away, and removing one is '
          + 'pointless because the game builds a new one within seconds — update the bridge (2.22.1 or '
          + 'newer) and the sentries here are dealt with';
      }
      return 'mapsentry: the fixed sentries here were left alone — turn on "Put fixed map sentries away '
        + 'instead of removing them" on the bridge\'s Removal card. Removing them instead would not '
        + 'work: the game builds a new one within seconds';
    }

    /** The bridge switch that removes each kind, by the label on its card. */
    const REMOVE_SWITCH = { sentry: 'Remove deployed sentries', puppet: 'Remove puppets (zombies)' };

    /**
     * Where this zone's own guards of one bridge kind are: the slots this plugin was handed when it
     * sent them, and — for the game's own spawn, which hands back no id — the posts they hold.
     */
    function ownGuardSpots(entry, posts, kind) {
      const types = guardTypes(entry);
      const slots = new Set();
      const spots = [];
      // ⚠ A GUARD THAT WALKS IS NOT NEAR ITS POST. A zombie chosen as a guard wanders off like any
      // zombie, and "Keep zombies out" would remove it as a wild one — then the zone, counting its
      // guards across the whole rectangle, sends another. So a walking guard type is recognised by its
      // class wherever it is. A wild zombie of exactly that class is spared too; the zone configuration
      // already stops the game spawning zombies inside it.
      const words = new Set();
      // Only for the game's own spawn, which hands back no id; a guard put there directly is known by its id.
      for (const t of types) if (t.route === 'persistent' && typeKind(t) === kind && roams(t)) words.add(typeWord(t));
      if (!types.length) return { slots, spots, words, radius: 0 };
      const rep = (guardsFor(entry) || {}).replace || {};
      posts.forEach((p, i) => {
        const t = typeForPost(types, p, i);
        if (!t || typeKind(t) !== kind) return;
        const ids = Array.isArray(p.ids) ? p.ids : [];
        for (const id of ids) slots.add(Number(id));
        // Only a guard with no id is recognised by where it stands. Doing that for every post would
        // shelter any wild puppet that wandered past one of ours.
        if (t.route === 'persistent') spots.push(p);
      });
      return { slots, spots, words, radius: Math.max(200, nz(rep.postRadius, 1500)) };
    }
    function isOwnGuard(o, g) {
      const slot = Number(String((o && o.id) || '').split('.')[0]);
      if (Number.isFinite(slot) && g.slots.has(slot)) return true;
      if (g.words && g.words.has(actorWord(o && o.class))) return true;
      return g.spots.some((p) => near(p, o, g.radius));
    }

    /** The sphere that is the smallest one able to contain a rectangle, plus the vertical reach. */
    const sphereFor = (rect, s) =>
      Math.ceil(Math.sqrt((rect.width / 2) ** 2 + (rect.height / 2) ** 2) + Math.max(0, nz(s.reachZ, 0)));

    /**
     * Which bridge kind the replacement really is, so a post can be looked at with the same word it
     * was filled with. The persistent route speaks the game's admin vocabulary and the direct route
     * speaks the bridge's, and `despawnPreview` only understands the second.
     */
    const PERSISTENT_AS_KIND = { armednpc: 'npc', zombie: 'puppet', animal: 'animal' };
    function typeKind(t) {
      return t.route === 'persistent'
        ? (PERSISTENT_AS_KIND[String(t.spawnKind || 'armednpc')] || 'npc')
        : String(t.kind || 'npc');
    }
    /** The name this guard will carry, for matching what is standing at a post. */
    function typeWord(t) {
      const raw = t.route === 'persistent' ? t.spawnName : t.classPath;
      const v = String(raw || '').trim();
      if (!v) return '';
      // A class path's last segment is the class; a spawn name is already one. Either way the word
      // that appears in an actor's class name is what is compared, and never the whole string.
      const leaf = v.split('/').pop().split('.').pop();
      return leaf.replace(/_C$/, '');
    }
    /**
     * The word an ACTOR's reported class comes down to, normalised exactly as `typeWord` normalises
     * a configured one, so the two can be compared as names rather than as substrings.
     *
     * ⚠ `includes()` is not a name test. The bridge reports a class NAME — measured on a real
     * owner's log, `BP_Boar_Mutant_C`, with no path and no instance number — so any configured word
     * that is a PREFIX of another matches it: a `BP_Guard_Lvl_5_AbandonedBunker` standing near a
     * post whose guard is `BP_Guard` read as holding it, one guard covered two posts, and the second
     * never got filled. Normalising both sides also keeps a class PATH matching, which is what the
     * rigs' fixtures send.
     */
    const actorWord = (cls) => String(cls || '').split('/').pop().split('.').pop().replace(/_C$/, '');

    /** What to call this guard on a screen, when the owner did not name it themselves. */
    function typeLabel(t) {
      return String(t.label || '').trim() || typeWord(t) || 'an unnamed guard';
    }

    /**
     * A zone's guard types, as a list, whatever shape the configuration is in.
     *
     * The list is the shape from now on; the single `route`/`classPath`/`spawnName` fields beside it
     * are what every configuration written before it carries, and are read as a list of one. An entry
     * naming nothing to spawn is dropped here rather than at the post, so "nothing is chosen" is one
     * answer in one place instead of a silent skip per post.
     */
    function guardTypes(entry) {
      const r = (guardsFor(entry) || {}).replace || {};
      const raw = Array.isArray(r.types) && r.types.length ? r.types : [r];
      const out = [];
      for (const t of raw) {
        if (!t || typeof t !== 'object') continue;
        const one = {
          route: t.route === 'persistent' ? 'persistent' : 'spawn',
          kind: String(t.kind || 'npc'),
          classPath: String(t.classPath || '').trim(),
          spawnKind: String(t.spawnKind || 'armednpc'),
          spawnName: String(t.spawnName || '').trim(),
          // Per entry, so a zone can stand one rifleman at most posts and a pair of puppets at
          // others. Falls back to the block's own count, which is what a pre-list config has.
          count: Math.max(1, Math.min(10, nz(t.count, nz(r.count, 1)))),
          weight: Math.max(1, Math.min(100, Math.round(nz(t.weight, 1)))),
          label: String(t.label || '').trim(),
        };
        if (!typeWord(one)) continue;            // names nothing to send
        out.push(one);
      }
      return out;
    }

    /**
     * Which type stands at post `i`.
     *
     * Deterministic, and that is the whole point of it. `Math.random()` over the handful of posts a
     * zone really has gives an owner who asked for one heavy in six a zone with none of them, or with
     * four; laying the weights out in order and taking position `i` gives exactly the ratio asked for
     * and gives the same layout every time — the same reason the posts are a grid rather than
     * scattered. A post that has already been filled keeps what it was given, so a rifleman is never
     * replaced by a bear.
     */
    function typeForPost(types, p, i) {
      if (!types.length) return null;
      if (p && p.gt != null) {
        const want = String(p.gt);
        // ⚠ THE INDEX IS THE IDENTITY AND THE NAME ONLY CONFIRMS IT. A word is the class path's last
        // segment, so two entries share one whenever the same class is listed twice — two counts of
        // the same guard, or the same figure on both routes. Matching by word alone collapsed every
        // such post onto the FIRST entry: a post laid out as three heavies came back as one the
        // first time somebody killed them, permanently, and nothing said the garrison had shrunk.
        const at = Number(p.gti);
        if (Number.isInteger(at) && types[at] && typeWord(types[at]) === want) return types[at];
        // No index, or the entry there is a different guard now — the list was reordered or edited.
        // The NAME then keeps the post on the figure it is holding, which is what makes a reorder
        // move nobody.
        const held = types.find((t) => typeWord(t) === want);
        if (held) return held;
        // The guard it held is gone from the list entirely. Falling through re-assigns it rather
        // than leaving the post unfillable, and the new word and index are stored below.
      }
      const total = types.reduce((n, t) => n + t.weight, 0);
      let at = ((i % total) + total) % total;
      for (const t of types) {
        if (at < t.weight) return t;
        at -= t.weight;
      }
      return types[0];
    }

    /**
     * The ground height inside a rectangle, from whatever the bridge can already see there.
     *
     * ⚠ **A GRID POSITION HAS NO HEIGHT, AND `centreZ` IS NOT ONE.** That setting is the centre of a
     * SEARCH sphere whose vertical reach is a kilometre, so 0 is a fine answer for looking and the
     * worst possible answer for placing: measured on a live server, ten posts at z=0 and every guard
     * ever sent to them put under the terrain.
     *
     * And the ground is not one number. Measured across one owner's three zones, from the bridge's
     * own lines: the Naval Base's sentries stand at **309 to 3927**, a prisoner teleported to one of
     * Samobor's posts arrived at **17801**, and the Airport's sentries are at **35938**. That is 355
     * metres of spread, inside ONE zone in the first case — so a single figure typed into a setting
     * could not be right even for one zone, let alone three. It is why this asks the world, per post.
     *
     * ⚠ 35938 was written here as the Naval Base and it is the AIRPORT. A measurement carries where
     * it was taken or it sends the next person to the wrong place.
     *
     * Anything standing inside the rectangle is standing ON something, so its Z is the ground to
     * within a storey. `seen` is whatever the patrol has already looked at — a cleared sentry is
     * perfect and free — and only when that is empty does this spend a call of its own.
     *
     * The MEDIAN: one actor on a roof or down a stairwell drags a mean and cannot drag a median.
     */
    /**
     * The game's own downward trace at one point, or `null`.
     *
     * ⚠ **IT ONLY LOOKS 200 m DOWN, FROM 150 cm ABOVE WHERE YOU ASK.** Ask at 0 and it answers
     * `noGroundBelow` — which reads as "there is no ground here" and means "you are 177 m under it".
     * So it is swept from the top of the island downwards and the first real answer wins.
     *
     * ⚠ **THE SWEEP SPANS THE ISLAND, NOT THE PLACES THAT HAPPENED TO BE TESTED.** An owner draws a
     * zone wherever they like, and three zones measured on one server already run 309 to 35938 — a
     * sweep fitted to those would have a hole everywhere else. These five probes cover -35 m to
     * 651 m with no gap between them. A post is laid out once, so this costs five calls at worst and
     * usually one.
     */
    async function tracedGround(x, y) {
      for (const from of [65000, 45000, 25000, 5000, -15000]) {
        const r = await bx('whereIs', x, y, from);
        if (!r || r.error) continue;
        const z = nz(r.groundZ, NaN);
        if (Number.isFinite(z)) return { z, inWater: r.inWater === true };
      }
      return null;
    }

    async function groundZ(entry, rects, s, seen) {
      const zs = [];
      const take = (list) => {
        for (const o of (list || [])) {
          const z = nz(o.z, NaN);
          if (!Number.isFinite(z)) continue;
          if (!rects.some((r) => inRect(o, r))) continue;
          zs.push(z);
        }
      };
      take(seen);
      // The game's own trace, at the middle of the first rectangle. Better than any sample because it
      // is the ground rather than something standing near it, and it works in an empty zone.
      if (!zs.length && rects[0]) {
        const t = await tracedGround(rects[0].x, rects[0].y);
        if (t) return { z: t.z, from: t.inWater ? 'the game (in water)' : 'the game' };
      }
      if (!zs.length) {
        // Nothing was cleared here, so ask what else is about. Puppets and animals are everywhere on
        // this island and both stand on the ground; one lookup answers for the whole zone.
        for (const kind of ['puppet', 'animal', 'npc']) {
          if (zs.length) break;
          const rect = rects[0];
          if (!rect) break;
          const pre = await bx('despawnPreview', kind, rect.x, rect.y, nz(s.centreZ, 0), sphereFor(rect, s));
          if (pre && !pre.error) take(pre.objects);
        }
      }
      if (!zs.length) return { z: nz(s.centreZ, 0), from: 'setting' };
      zs.sort((a, b) => a - b);
      return { z: zs[Math.floor(zs.length / 2)], from: zs.length === 1 ? 'one actor' : `${zs.length} actors` };
    }

    /**
     * `n` points spread over the rectangles, on a grid.
     *
     * Deliberately not random. A random point is a different point on the next patrol, so a guard
     * standing where the last one was put could never be recognised as holding its post — the whole
     * mechanism depends on a post being the SAME place every time. A grid is also the thing an owner
     * can see coming and build around.
     *
     * The inset keeps a post off the boundary: a guard exactly on the line is one the rectangle test
     * can put on either side of it depending on which way the engine nudged it.
     */
    function gridPoints(rects, n, z) {
      const out = [];
      if (!(n > 0) || !rects.length) return out;
      // Spread over the rectangles in proportion to nothing — the first one takes the remainder —
      // because a set almost always has one, and dividing a handful of guards by area would put
      // fractions of a guard in the small ones.
      const per = Math.max(1, Math.ceil(n / rects.length));
      for (const r of rects) {
        const cols = Math.ceil(Math.sqrt(per));
        const rows = Math.ceil(per / cols);
        for (let iy = 0; iy < rows; iy++) {
          for (let ix = 0; ix < cols; ix++) {
            if (out.length >= n) return out;
            // Cell centres, which keeps every point clear of the edge by construction.
            const fx = (ix + 0.5) / cols;
            const fy = (iy + 0.5) / rows;
            out.push({
              x: r.x - r.width / 2 + fx * r.width,
              y: r.y - r.height / 2 + fy * r.height,
              z,
            });
          }
        }
      }
      return out;
    }

    /**
     * Clear the sentries out of one rectangle, and keep the posts they leave behind held.
     *
     * **The search is a SPHERE and a zone is a RECTANGLE**, so nothing is ever swept: every candidate
     * is previewed, the ones whose position is outside the rectangle are discarded, and each survivor
     * is removed BY ITS OWN ID. A sentry a metre beyond the owner's line is not this plugin's to
     * touch, and a radius wide enough to cover a rectangle always reaches past its corners.
     *
     * The despawn module refuses a radius over its own `maxRadius` rather than clamping it, so a
     * zone bigger than that setting is reported with the setting named — the fix is on the module's
     * own card and this plugin cannot and should not make it.
     */
    async function patrolGuards(entry, rects, seen) {
      const s = guardsFor(entry) || {};
      if (s.mode !== 'remove' && s.mode !== 'replace') return null;
      // A zone asking only for guards of its own has nothing to clear, and must still patrol: the
      // posts are its own and something has to keep them filled.
      const clearing = (Array.isArray(s.kinds) && s.kinds.length > 0);
      const kinds = (Array.isArray(s.kinds) && s.kinds.length) ? s.kinds : ['sentry'];
      // `reached` and `inside` are recorded even when they are zero, because zero is the answer an
      // owner most needs and the one nothing else can give them: the bridge logs commands and not
      // reads, so a patrol that looked and found nothing leaves no trace at all.
      const out = { removed: 0, stowed: 0, spawned: 0, posts: 0, held: 0, reached: 0, inside: 0, refusals: [] };
      const posts = postsOf(entry.id);
      out.posts = posts.length;
      /**
       * ⚠ **NOTHING HAPPENS IN A ZONE NOBODY IS NEAR, AND THAT IS THE GAME'S RULE BEFORE IT IS OURS.**
       * Sentries, NPCs, animals and puppets are made around players and are simply not in the world
       * otherwise; the game takes them away again once everybody has gone. So an empty zone has no
       * sentries to put away, and a guard sent into it is a guard the game deletes before anybody
       * arrives. Asleep, the only thing this costs is the one reading of where the players are, which
       * the caller shares across every zone.
       */
      const who = seen || await playersNow();
      out.playersKnown = who.known;
      out.playersOnline = who.known ? who.at.length : null;
      const wake = awakeFor(s, rects, who);
      out.wakeDistance = wakeCm(s);
      out.nearest = wake.nearest;
      if (!wake.known || !wake.awake) {
        out.awake = wake.known ? false : null;
        if (!wake.known) out.refusals.push(PLAYERS_UNKNOWN);
        wasAwake[String(entry.id)] = false;
        markPatrolled(entry.id);
        rememberPatrol(entry.id, out);
        return out;
      }
      out.awake = true;
      /**
       * ⚠ **A ZONE THAT HAS JUST WOKEN UP FILLS ITS POSTS NOW, NOT AFTER THE DEATH DELAY.** While it
       * slept the game took away whatever stood there — the guards this plugin sent included — so an
       * empty post on waking is not a guard that was just killed, and `afterDeathSeconds` is not about
       * it. Without this every post stood empty for that whole delay each time somebody arrived, which
       * is the moment the guards are for. A post still held reads as held and loses nothing.
       */
      if (wasAwake[String(entry.id)] !== true) {
        for (const p of posts) { p.emptySince = 0; p.everHeld = false; p.blind = 0; p.blindUntil = 0; }
        // ⚠ A ZONE THAT WAS LEFT STARTS AGAIN. The kill delay exists so whoever just cleared the zone
        // has time to loot and fight without guards appearing behind them — the owner: *"aby mel cas
        // na loot a na pvp"*. Somebody who walks away and comes back meets a guarded zone again,
        // looted or not, and that was said to be fine.
        const allKills = host.store.get(K.kills, {}) || {};
        if (allKills[String(entry.id)]) {
          const rest = Object.assign({}, allKills);
          delete rest[String(entry.id)];
          host.store.set(K.kills, rest);
        }
      }
      wasAwake[String(entry.id)] = true;

      // Every sentry this patrol dealt with, kept for one reason: it stood on the ground, so its height
      // is the best answer there is to where a post of our own should be — and it costs nothing.
      const cleared = [];
      const rep = s.replace || {};
      const maxPosts = Math.max(1, Math.min(60, nz(rep.maxPosts, 12)));
      // Asked once per patrol, and only when there is a fixed sentry to ask about.
      const stow = (clearing && kinds.indexOf('mapsentry') >= 0) ? await stowInfo() : null;
      const stowOk = !!(stow && stow.known && stow.supported && stow.allowed);
      let stowSaid = false;

      for (const rect of clearing ? rects : []) {
        const radius = sphereFor(rect, s);
        for (const kind of kinds) {
          const stowing = kind === 'mapsentry';
          // ⚠ A FIXED SENTRY THAT CANNOT BE PUT AWAY IS LEFT ALONE. Removing it is not a lesser
          // version of the same thing: the game builds a replacement within seconds, so a patrol every
          // few seconds would become a few thousand spawns an hour and a zone that is never clear.
          if (stowing && !stowOk) {
            if (!stowSaid) { out.refusals.push(stowWhy(stow)); stowSaid = true; }
            continue;
          }
          const pre = await bx('despawnPreview', kind, rect.x, rect.y, nz(s.centreZ, 0), radius);
          if (!pre || pre.error) {
            out.refusals.push(`${kind}: ${pre ? ((pre.reason || pre.error) || 'the preview gave no answer')
              : await whyNoAnswer('despawn', 'what is in this zone')}`);
            continue;
          }
          // Putting a sentry away has its own switch, so the removal switch this reports on does not
          // decide it.
          if (!stowing && pre.allowed === false) {
            out.refusals.push(`${kind}: the bridge will not remove these yet — turn on "${REMOVE_SWITCH[kind] || kind}" on the bridge's Removal card, which is yours to switch on`);
            continue;
          }
          const all = pre.objects || [];
          const mine = all.filter((x) => inRect(x, rect));
          const guardsHere = ownGuardSpots(entry, posts, kind);
          out.reached += all.length;
          out.inside += mine.length;
          for (const o of mine) {
            // Already under the ground: nothing to put away. Its x and y are still where it stood, so
            // a zone switched to keeping guards AFTER its sentries were put away still gets their
            // posts — the height is the ground there, since the sentry's own is ninety metres down.
            if (stowing && o.stowed === true) {
              if (s.mode === 'replace' && posts.length < maxPosts && !posts.some((p) => near(p, o, SAME_SPOT_CM))) {
                const here = await tracedGround(nz(o.x, 0), nz(o.y, 0));
                if (here && !here.inWater) {
                  posts.push({ x: nz(o.x, 0), y: nz(o.y, 0), z: here.z, ground: true, emptySince: 0 });
                }
              }
              continue;
            }
            // ⚠ NEVER ONE OF OUR OWN GUARDS. A zone that keeps puppets out and stations puppets of its
            // own would otherwise clear its garrison every round and fill it again the next.
            if (isOwnGuard(o, guardsHere)) { out.ownKept = (out.ownKept || 0) + 1; continue; }
            const done = stowing
              ? await bx('despawnStow', kind, rect.x, rect.y, nz(s.centreZ, 0), radius, o.id)
              : await bx('despawnAt', kind, rect.x, rect.y, nz(s.centreZ, 0), radius, o.id);
            if (!done || done.ok !== true) {
              out.refusals.push(`${kind} ${o.id}: ${done ? ((done.reason || done.error) || 'refused') : NO_BRIDGE_ANSWER}`);
              continue;
            }
            if (stowing) out.stowed++; else if (kind === 'puppet') out.puppets = (out.puppets || 0) + 1; else out.removed++;
            cleared.push({ x: nz(o.x, 0), y: nz(o.y, 0), z: nz(o.z, NaN) });
            // The place a sentry stood becomes a post — read BEFORE it was put away, which is the only
            // moment its position is the place. Somewhere this plugin has already recorded is not a
            // second post. A puppet wanders; where one happened to be is not a place worth guarding.
            if (s.mode === 'replace' && kind !== 'puppet'
                && posts.length < maxPosts
                && !posts.some((p) => near(p, o, SAME_SPOT_CM))) {
              posts.push({ x: nz(o.x, 0), y: nz(o.y, 0), z: nz(o.z, 0), emptySince: 0 });
            }
          }
        }
      }

      // Posts of the zone's OWN, where the game put no sentries. Laid out on a grid rather than at
      // random: a random point is a different point every patrol, so nothing could ever be found
      // still standing at one, and a grid an owner can predict is one they can plan around.
      const want = Math.max(0, Math.min(maxPosts, nz(s.ownPosts, 0)));
      if (s.mode === 'replace' && want > 0) {
        // The height, once. A post that already exists keeps the one it was laid out with — moving a
        // post is moving a guard's station, and the whole mechanism rests on a post being the same
        // place every patrol.
        const known = posts.map((p) => nz(p.z, NaN)).filter((z) => Number.isFinite(z) && z !== 0)[0];
        let z = known;
        if (!Number.isFinite(z)) {
          const g = await groundZ(entry, rects, s, cleared);
          z = g.z;
          out.groundFrom = g.from;
          if (g.from === 'setting' && z === 0) {
            out.refusals.push('nothing could be found standing inside this zone, so the height of its '
              + 'own posts fell back to "Where to search", which is 0 — sea level, under the ground '
              + 'everywhere on this island. Set that to the height of this place, or wait until '
              + 'something is in the zone for the plugin to measure against.');
          }
        }
        /**
         * ⚠ **LIFT THE POSTS THAT ARE ALREADY STUCK AT SEA LEVEL.**
         *
         * Without this the height fix reaches only zones that have never been laid out: `near()`
         * compares x and y, so every corrected grid point matches the post already sitting at that
         * spot and is skipped as a duplicate. Measured after the fix was deployed — ten posts, all
         * still z 0, and the game refusing every spawn onto them.
         *
         * This is NOT the rule "a post does not move when the world changes under it". That rule is
         * about a post whose height is real. A post at 0 is not a place a guard can be — the game
         * refuses it outright, so it has never held anybody and never will — and repairing a position
         * that was never valid is a different act from moving somebody's station.
         */
        if (Number.isFinite(z) && z !== 0) {
          let lifted = 0;
          for (const p of posts) {
            const pz = nz(p.z, NaN);
            if (Number.isFinite(pz) && pz !== 0) continue;      // a real height: leave it alone
            // Its OWN ground where the trace can give one, the zone's where it cannot.
            const here = await tracedGround(p.x, p.y);
            p.z = (here && !here.inWater) ? here.z : z;
            p.ground = true;                                    // a ground height, not a body's
            p.blind = 0; p.blindUntil = 0;                      // it never had a fair chance
            lifted++;
          }
          if (lifted) {
            log.info(`[loot-zones] "${entry.name || entry.set}" — ${lifted} post(s) were at sea level `
              + `and have been lifted to ${Math.round(z)}, which is where the ground is`);
          }
        }
        // ⚠ EACH POST ASKS ABOUT ITS OWN PLACE. One height for a whole zone is the same mistake an
        // order of magnitude smaller: measured on two posts of one zone 1.1 km apart, the ground is
        // 17706 at one and not even within 200 m of that at the other. A post is laid out once, so
        // this is paid once.
        let inWater = 0;
        for (const spot of gridPoints(rects, want, z)) {
          if (posts.length >= maxPosts) break;
          if (posts.some((p) => near(p, spot, SAME_SPOT_CM))) continue;
          const here = await tracedGround(spot.x, spot.y);
          // ⚠ NOT IN THE SEA. A grid over a coastal city puts points in the bay, and an armed NPC
          // treading water is not a guard. Dropped rather than placed, and counted so the zone can
          // say why it has fewer posts than were asked for.
          if (here && here.inWater) { inWater++; continue; }
          posts.push({ x: spot.x, y: spot.y, z: (here ? here.z : spot.z), emptySince: 0, everHeld: false, own: true });
        }
        if (inWater) {
          out.refusals.push(`${inWater} of this zone's own posts fell in water and were left out — a `
            + 'guard cannot stand there. Make the rectangle cover less water, or ask for fewer posts.');
        }
      }

      /**
       * ⚠ **ON A SERVER THAT ALLOWS NO NPCs, A GUARD STANDS NEAR A PLAYER OR NOWHERE.** The game
       * removes an armed NPC nobody is within about 175 m of, so only spots within 150 m of somebody
       * are ever sent to — and a zone's own spots are a grid over the whole rectangle. Measured in
       * Samobor City: five spots about 500 m apart, the owner standing inside the zone, the nearest
       * spot 259 m away, and not one guard sent, with nothing on the card to say why.
       *
       * So on such a server the zone also keeps a few spots AROUND each player inside it, 90 to 110 m
       * out, on the ground, inside the rectangle and never in water. They are marked `temp` and go
       * again once nobody is near them; every other rule — the cap, the kill delay, "never appear
       * within" — applies to them exactly as to any other spot.
       */
      if (s.mode === 'replace' && npcLimit() === 0 && who && who.known === true) {
        for (let i = posts.length - 1; i >= 0; i--) {
          const p = posts[i];
          if (p.temp && !who.at.some((q) => within(p, q, NPC_STAY_CM + 5000))) posts.splice(i, 1);
        }
        const perPlayer = Math.max(1, Math.min(3, maxPosts));
        let added = 0;
        for (const q of who.at) {
          if (!rects.some((r) => inRect(q, r))) continue;
          let close = posts.filter((p) => within(p, q, NPC_STAY_CM - 3000)).length;
          const base = (Math.abs(Math.round(q.x / 1000) * 7 + Math.round(q.y / 1000) * 13) % 360) * Math.PI / 180;
          for (let k = 0; k < 9 && close < perPlayer && added < 6; k++) {
            const ang = base + k * (2 * Math.PI / 9) * 4;          // steps round the ring, not side by side
            const dist = 9000 + (k % 3) * 1000;
            const x = q.x + Math.cos(ang) * dist;
            const y = q.y + Math.sin(ang) * dist;
            if (!rects.some((r) => inRect({ x, y }, r))) continue;
            if (posts.some((p) => near(p, { x, y }, 3000))) continue;
            const w = await bx('whereIs', x, y, nz(q.z, 0) + 1500);
            let here = (w && !w.error && Number.isFinite(nz(w.groundZ, NaN))) ? { z: nz(w.groundZ, NaN), inWater: w.inWater === true } : null;
            if (!here) here = await tracedGround(x, y);
            if (!here || here.inWater) continue;
            // Not on a roof or down a cliff: a spot far above or below the player is not "near" them.
            if (Math.abs(here.z - nz(q.z, here.z)) > 1500) continue;
            posts.push({ x, y, z: here.z, emptySince: 0, everHeld: false, own: true, ground: true, temp: true });
            close++; added++;
          }
        }
      }

      if (s.mode === 'replace') {
        const r = await holdPosts(entry, posts, who, { rects, s });
        out.spawned = r.spawned; out.held = r.held;
        out.inZone = r.inZone; out.maxGuards = r.maxGuards; out.killed = r.killed;
        for (const w of r.refusals) out.refusals.push(w);
      }
      out.posts = posts.length;
      setPostsIfChanged(entry.id, posts);
      // The stamp belongs with the WORK, not with the thing that decides whether it is due: a patrol
      // that runs when a zone is switched on and records nothing is a patrol the very next tick
      // repeats.
      markPatrolled(entry.id);
      // Kept where the screen can read it. "It looked and there was nothing there" and "it never
      // ran" are opposite facts that look identical from outside, and only one of them is a defect.
      rememberPatrol(entry.id, out);
      // Logged when something was DONE. A refusal repeats every few seconds while somebody is near,
      // so it is logged only when its wording changes, and the card carries it every round.
      const said = out.refusals.join(' | ');
      const saidBefore = lastRefusalLog[String(entry.id)];
      if (out.removed || out.stowed || out.spawned || (said && said !== saidBefore)) {
        log.info(`"${entry.name || entry.set}" patrol — put away ${out.stowed}, removed ${out.removed}, `
          + `${out.held}/${out.posts} post(s) held, ${out.spawned} guard(s) sent`
          + `${out.refusals.length ? `, ${out.refusals.length} refused: ${out.refusals[0]}` : ''}`);
      }
      lastRefusalLog[String(entry.id)] = said;
      return out;
    }

    /**
     * Look at each post and put a guard back on the empty ones.
     *
     * ⚠ **A CORPSE IS PRESENT, so presence is the wrong question.** The bridge's own candidate test
     * has no health check and no aliveness check in it, and says why: a puppet a player merely kills
     * is still a live actor with `_isAlive` false and must go on being counted. So a post checked by
     * asking what is standing near it reads as HELD for as long as the body lies there — and the game
     * keeps a body longer while a player is near it, which is exactly when the post matters.
     *
     * `entity(id)` is the question that can be answered. It reports `alive` off the game's own
     * `IsAlive()` and `healthPoints` read live in the reply, and it costs one lookup rather than a
     * walk of every object in the process. `spawnAt` hands back the id it needs.
     *
     * **Only ONE post is filled per round.** The bridge serialises spawns at one per frame with a
     * minimum gap between them, so sending ten at once collects nine rate-limited refusals; a patrol
     * that comes round every few seconds fills them all soon enough and never bursts.
     */
    /**
     * Where the players are right now: `{ known, at: [{x,y,z}] }`.
     *
     * ⚠ **`known: false` IS NOT "NOBODY IS NEAR".** If this cannot be read, no post is filled at all —
     * the cost is an empty post for a minute, and the alternative is the exact thing an owner asked
     * never to happen. This is the same rule the rest of the plugin follows for a reading it could
     * not get, applied where being wrong is most visible.
     */
    async function playersNow() {
      const live = await bx('livePlayers');
      if (!Array.isArray(live)) return { known: false, at: [] };
      const at = [];
      for (const p of live) {
        const x = nz(p.x, NaN); const y = nz(p.y, NaN); const z = nz(p.z, NaN);
        if (Number.isFinite(x) && Number.isFinite(y)) at.push({ x, y, z: Number.isFinite(z) ? z : 0 });
      }
      return { known: true, at };
    }

    /**
     * Where a guard is actually sent for a post.
     *
     * ⚠ **A GROUND HEIGHT IS NOT A PLACE A BODY FITS.** A post laid out on the grid, or lifted off sea
     * level, holds the height the ground trace answered — and a character's capsule centred exactly
     * there is half inside the terrain. The game refuses that spawn outright ("Cannot spawn at the
     * specified location"): driven on the dev server, the same point refused at the ground's height
     * and accepted 120 cm above it. A post taken from a sentry holds that sentry's own position,
     * which is already a standing body's, and is sent as it is.
     */
    const STAND_ABOVE_GROUND_CM = 120;
    // How near a player a guard is sent when the server keeps no NPC away from players: under the
    // ~175 m the game was measured keeping one, with room for a player walking a few steps away.
    // `scum.ArmedNPCNetCullDistanceOverride` does not move that edge: at 500 a guard 200 m away was
    // still destroyed after 5 s, exactly as at the default.
    const NPC_STAY_CM = 15000;
    // How soon after sending a guard its absence means the game took it away rather than somebody
    // killing it, and the ring a spot moves round when that happens: 15 m, then 30 m, then diagonals.
    const VANISH_MS = 20000;
    const VANISH_RING = [[0, 0], [1500, 0], [-1500, 0], [0, 1500], [0, -1500], [3000, 0], [-3000, 0],
      [0, 3000], [0, -3000], [2500, 2500], [-2500, 2500], [2500, -2500], [-2500, -2500]];
    function standingSpot(p) {
      const lift = (p.own || p.ground) ? STAND_ABOVE_GROUND_CM : 0;
      return { x: p.x, y: p.y, z: nz(p.z, 0) + lift };
    }

    /** True distance, in three dimensions — a player 200 m overhead is not standing next to a post. */
    function within(a, b, cm) {
      const dx = nz(a.x, NaN) - nz(b.x, NaN);
      const dy = nz(a.y, NaN) - nz(b.y, NaN);
      const dz = nz(a.z, 0) - nz(b.z, 0);
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
      return (dx * dx + dy * dy + dz * dz) <= cm * cm;
    }

    /**
     * ⚠ **A GUARD THAT WALKS IS NOT AT ITS POST, AND THAT IS NOT AN EMPTY POST.** The game's Guard
     * stands at a station and goes back to it (`NPCControllerStateGuardReturnToPost`); a Drifter's
     * controller has a "move towards target location" state instead, and a puppet or an animal roams
     * too. Measured at B2 Airport: a zone of Drifters, five to a post, looked for them within 15 m of
     * each post, found the ones that had walked off missing, and sent five more to the same post
     * three times in eight minutes — sixteen Drifters where twenty was the ceiling only by luck, and
     * the owner killed among them. So a walking type is counted across the whole zone, and a post of
     * that type holds while more of them are alive than the posts before it account for.
     */
    // Only the game's Guard keeps a post; everything else — Drifters, zombies, animals, bosses — walks.
    const roams = (t) => !/(^|_)Guard(_|$)/i.test(typeWord(t));

    /**
     * The despawn kind a guard really is, for counting it. `typeKind` is the word its SPAWN takes, and a
     * Brenner sent directly is spawned as `npc` but walks the world as a `brenner`: counted as an armed
     * NPC it would never be seen, and a zone would send another one every round.
     */
    function censusKind(t) {
      const w = typeWord(t);
      if (/Brenner/i.test(w)) return 'brenner';
      if (/Razor/i.test(w)) return 'razor';
      if (/Drone/i.test(w)) return 'drone';
      const k = typeKind(t);
      return k === 'zombie' ? 'puppet' : k;
    }

    /**
     * ⚠ **A KILLED GUARD IS STILL AN NPC IN THE WORLD.** Measured on the dev server: a Guard shot dead
     * stayed in the despawn preview, at the spot where it fell, for as long as it was watched —
     * while the entity index said `alive: false, hp 0` for the same actor. So "is something standing
     * there" counts bodies, and the only way to tell a guard from a body is to ask the index.
     *
     * `true` alive, `false` dead, `null` when the index could not answer (not adopted, or a slot now
     * holding something else). A `null` is counted as alive: holding a post with an unreadable body
     * in it costs one refill; reading it as dead would stack guards.
     */
    async function isAlive(o) {
      const slot = String((o && o.id) || '').split('.')[0];
      if (!slot) return null;
      const e = await bx('entity', slot);
      if (!e || e.error || e.ok === false) return null;
      if (e.class && actorWord(e.class) !== actorWord(o.class)) return null;
      return !(e.alive === false || (e.healthPoints != null && nz(e.healthPoints, 1) <= 0));
    }

    /**
     * Every guard of one type in the zone, split into the living and the dead. Over the zone's own
     * sphere plus 100 m, because a Drifter chasing somebody out of the rectangle is still ours.
     */
    async function zoneCensus(t, area) {
      const word = typeWord(t);
      const seenIds = new Set();
      const alive = [];
      const dead = [];
      for (const rect of area.rects) {
        const radius = sphereFor(rect, area.s) + 10000;
        const pre = await bx('despawnPreview', censusKind(t), rect.x, rect.y, nz(area.s.centreZ, 0), radius);
        if (!pre || pre.error) {
          return { unknown: true, why: pre ? ((pre.reason || pre.error) || 'no answer') : NO_BRIDGE_ANSWER };
        }
        for (const o of pre.objects || []) {
          if (actorWord(o.class) !== word || seenIds.has(String(o.id))) continue;
          seenIds.add(String(o.id));
          if (await isAlive(o) === false) dead.push(o); else alive.push(o);
        }
      }
      return { alive, dead, count: alive.length };
    }

    /**
     * ⚠ **KILLED AND TAKEN AWAY ARE DIFFERENT, AND ONLY A KILL WAITS.** The owner: a guard nobody
     * killed that the game removed — nobody near, or the player ran off — must come back as soon as
     * somebody is near again, and only a guard somebody KILLED waits out the respawn delay. So a body
     * is remembered from the moment it is first seen dead, for the length of that delay, and it keeps
     * its place in the zone's count until then; a guard that simply vanished leaves no record and is
     * replaced on the next round. Forgotten when the zone goes to sleep: a player who leaves and
     * comes back finds the zone guarded again.
     */
    function recentKills(zoneId, deadByWord, windowMs) {
      const all = host.store.get(K.kills, {}) || {};
      const key = String(zoneId);
      const mine = Object.assign({}, all[key] || {});
      const now = Date.now();
      let changed = false;
      for (const [word, list] of deadByWord) {
        for (const o of list) {
          const id = String(o.id);
          if (!mine[id]) { mine[id] = { at: now, word }; changed = true; }
        }
      }
      const perWord = new Map();
      for (const id of Object.keys(mine)) {
        if (!(windowMs > 0) || now - nz(mine[id].at, 0) >= windowMs) { delete mine[id]; changed = true; continue; }
        perWord.set(mine[id].word, (perWord.get(mine[id].word) || 0) + 1);
      }
      if (changed) host.store.set(K.kills, Object.assign({}, all, { [key]: mine }));
      return perWord;
    }

    async function holdPosts(entry, posts, seen, area) {
      const rep = (guardsFor(entry) || {}).replace || {};
      const out = { spawned: 0, held: 0, refusals: [] };
      const types = guardTypes(entry);
      // One zone-wide count per walking type per round, and how many posts of that type came before.
      const census = new Map();
      const rank = new Map();
      if (!types.length) {
        // Nothing chosen. The sentries still went — that is what "replace" with an empty choice
        // means — and saying nothing here would look like a patrol that failed.
        out.refusals.push('no guard has been chosen yet, so the posts are standing empty');
        return out;
      }
      const wait = Math.max(0, nz(rep.afterDeathSeconds, 120)) * 1000;
      let sent = false;

      // ⚠ THE ZONE'S OWN CLOCK, checked before anything else is spent. A zone still inside its
      // cooldown makes no bridge call at all this round — the cheapest correct answer.
      const cool = Math.max(0, nz(rep.cooldownSeconds, 0)) * 1000;
      const lastSent = nz((host.store.get(K.lastGuardAt, {}) || {})[String(entry.id)], 0);
      if (cool > 0 && lastSent && (Date.now() - lastSent) < cool) {
        const left = Math.ceil((cool - (Date.now() - lastSent)) / 1000);
        out.refusals.push('no guard was sent this round: this zone is waiting out its cooldown, '
          + `${left} more second(s). Every post still gets filled — this only sets how fast.`);
        return out;
      }

      // Where everybody is, read ONCE for the whole round rather than per post.
      // On a server with no NPC allowance a guard lives only near a player (see `npcLimit`), so the
      // spot has to be near somebody — and "never appear within" has to leave room inside that.
      const nearOnly = npcLimit() === 0;
      const keepAway = nearOnly
        ? Math.min(Math.max(0, nz(rep.keepAwayFromPlayers, 5000)), NPC_STAY_CM - 7000)
        : Math.max(0, nz(rep.keepAwayFromPlayers, 5000));
      // The patrol that called this has just read it; a second read in the same round is a second walk
      // of the game's player controllers for the same answer.
      const players = (keepAway > 0 || nearOnly) ? (seen || await playersNow()) : { known: true, at: [] };
      const playerNear = (p) => players.at.some((q) => within(p, q, NPC_STAY_CM));
      let nearPlayer = 0;
      let resting = 0;
      let moved = 0;
      let waitingNear = 0;
      if (keepAway > 0 && !players.known) {
        // ⚠ Could not find out, so nothing is filled. An empty post for a minute is the cheap side of
        // this; a guard appearing in somebody's face is the expensive one.
        // ⚠ A PLUGIN THAT FAILS CLOSED OWES THE OWNER THE SWITCH THAT OPENS IT. Without this sentence
        // the card says only "could not read", which reads as a fault in the plugin rather than as a
        // module that is off — and the owner has no way to find out which.
        out.refusals.push('no guard was sent this round: the plugin could not read where the players '
          + 'are, and it will not risk putting one next to somebody. That reading is the bridge\'s '
          + '"Live player data" module — it needs "Read live player data" and "Position, facing and '
          + 'speed" switched on. Both are reads. Or set "Never appear within" to 0 to send guards '
          + 'without checking, which is not recommended.');
        return out;
      }

      /**
       * The zone's living guards and its recent kills, read ONCE per round for every guard type. With
       * this a post is held by a living guard near it (or, for a type that walks, anywhere in the zone),
       * a body holds nothing, and the respawn delay is owed only for a kill.
       */
      const zoneWide = !!(area && area.rects && area.rects.length);
      const owed = new Map();
      let killsTotal = 0;

      if (zoneWide) {
        for (const t of types) {
          const word = typeWord(t);
          if (census.has(word)) continue;
          census.set(word, await zoneCensus(t, area));
        }
        const deadByWord = new Map();
        for (const [word, c] of census) {
          if (c.unknown) {
            out.refusals.push(`no guard was sent this round: the guards already in the zone could not be counted (${c.why})`);
            return out;
          }
          deadByWord.set(word, c.dead);
        }
        for (const [word, n] of recentKills(entry.id, deadByWord, wait)) { owed.set(word, n); killsTotal += n; }
      }

      /**
       * ⚠ **A CEILING ON THE ZONE, NOT ON A POST.** The owner asked for "at most five in the zone at a
       * time" — and posts times guards per post is not that number: a zone has as many posts as it had
       * sentries, and a type that walks leaves its post. So every guard type is counted across the
       * whole zone, and nothing more is sent once the count reaches the ceiling. A send is also trimmed
       * to the room that is left, so five to a post never overshoots a ceiling of five.
       */
      const maxGuards = Math.max(0, Math.round(nz(rep.maxGuards, 0)));
      let room = Infinity;

      if (zoneWide) {
        let total = 0;
        for (const c of census.values()) total += c.count;
        out.inZone = total;
        // A guard killed less than the delay ago still has its place: five killed out of five is a
        // zone that waits, not a zone that refills.
        if (maxGuards > 0) { room = maxGuards - total - killsTotal; out.maxGuards = maxGuards; }
      }

      for (let i = 0; i < posts.length; i++) {
        const p = posts[i];
        const t = typeForPost(types, p, i);
        let verdict;
        if (zoneWide && roams(t)) {
          const word = typeWord(t);
          const c = census.get(word);
          const before = rank.get(word) || 0;
          rank.set(word, before + 1);
          verdict = { held: c.count > before * countFor(t) };
        } else if (zoneWide) {
          const radius = Math.max(200, nz(rep.postRadius, 1500));
          verdict = { held: census.get(typeWord(t)).alive.some((o) => near(p, o, radius)) };
        } else {
          verdict = await postHeld(p, rep, t);
        }
        if (verdict.unknown) {
          // A post that could not be LOOKED at is left exactly as it is. Sending a guard on an
          // unreadable answer is how one dead guard becomes a heap of them.
          out.refusals.push(`a post could not be checked: ${verdict.why}`);
          continue;
        }
        if (verdict.held) {
          // Seen standing: everything this post has been through is forgiven, rest included, and the
          // spot it stands on is one the game keeps a guard on.
          p.emptySince = 0; p.everHeld = true; p.blind = 0; p.blindUntil = 0;
          p.sentAt = 0; p.vanished = 0; out.held++; continue;
        }
        /**
         * ⚠ **SENT, AND GONE BEFORE THE NEXT LOOK: THE SPOT IS WRONG, NOT THE GUARD.**
         *
         * Measured at B2 Airport with a player in the zone: the game accepted every spawn, the guards
         * appeared, and the game destroyed them three to four seconds later — nothing in this plugin or
         * the bridge removed them. The same guard sent fifteen metres from a sentry's concrete pad
         * stayed; on the pad, on a roof, it went. A character the game cannot keep where it was put
         * is taken away, so sending again to the same point only makes players watch guards pop in
         * and out. The post moves instead, round a ring about where it started, until a guard stays.
         */
        // Gone because nobody is near any more is the game's NPC ceiling at work, not a bad spot.
        if (p.sentAt && nearOnly && !playerNear(p)) p.sentAt = 0;
        if (p.sentAt && Date.now() - p.sentAt < VANISH_MS) {
          p.vanished = nz(p.vanished, 0) + 1;
          if (!p.home) p.home = { x: p.x, y: p.y };
          p.sentAt = 0;
          if (p.vanished >= VANISH_RING.length) {
            // The whole ring refused. Back to where it started, and a long rest before trying again.
            p.x = p.home.x; p.y = p.home.y; p.vanished = 0;
            p.blind = MAX_BLIND_FILLS; p.blindUntil = Date.now() + BLIND_REST_MS;
            out.refusals.push('the game removed every guard sent round one spot within seconds — the ground '
              + 'there is not somewhere it keeps a character. It rests and tries again later; a smaller '
              + 'or moved rectangle, or more extra guard spots, helps.');
            continue;
          }
          const off = VANISH_RING[p.vanished];
          const here = await tracedGround(p.home.x + off[0], p.home.y + off[1]);
          if (here && !here.inWater) {
            p.x = p.home.x + off[0]; p.y = p.home.y + off[1]; p.z = here.z; p.ground = true;
          }
          p.everHeld = false; p.emptySince = 0; p.blind = 0; p.blindUntil = 0;
          moved++;
        }
        // ⚠ FILLED, AND NEVER ONCE SEEN. Not a guard that died — a guard that was never there. Going
        // round again just asks the game for more actors nobody can find.
        if (nz(p.blind, 0) >= MAX_BLIND_FILLS) {
          // ⚠ A REST, NEVER A STOP. A post that gave up for good is a zone that disarms itself
          // silently, and that is worse than one that never worked — so after the wait it goes round
          // again, for ever. What is bounded is the RATE, not the lifetime.
          if (Date.now() >= nz(p.blindUntil, 0)) {
            p.blind = 0;                          // rested: try once more, properly
          } else {
            // Said EVERY patrol, not once. The screen draws the LAST patrol's refusals, so saying
            // this a single time left a card showing posts, none held, and no reason given.
            out.refusals.push('a post has been filled several times and nothing has ever been seen '
              + 'standing there, so it is resting for a few minutes before trying again — it will '
              + 'keep trying. The commonest cause is the height: the game refuses a spawn below the '
              + 'ground outright. Check "Where to search", or use the direct route, which can be '
              + 'asked whether the guard it made is alive.');
            continue;
          }
        }

        // A post nobody has ever stood on is being filled for the first time, not refilled after a
        // death — so it is filled NOW. Waiting here would leave the zone undefended for the whole of
        // the delay every time it opened, which is the opposite of what the delay is for.
        if (zoneWide) {
          // Only a KILL waits, and one kill holds back one guard's worth of posts of its own type.
          const word = typeWord(t);
          const due = owed.get(word) || 0;
          if (due > 0) { owed.set(word, due - countFor(t)); continue; }
        } else if (p.everHeld) {
          // Stamped and then CHECKED in the same round: returning here after stamping spent a whole
          // round before the delay was even consulted, which turned a delay of zero into a delay of
          // one patrol.
          if (!p.emptySince) p.emptySince = Date.now();
          if (Date.now() - p.emptySince < wait) continue;
        }
        // ⚠ A POST THE GAME JUST REFUSED RESTS. Without this the patrol asked again every round —
        // measured on the dev server, the same refused spawn every five or six seconds for as long as
        // somebody stood in the zone, each one a command the game had to parse and turn down.
        if (nz(p.refusedUntil, 0) > Date.now()) { resting++; continue; }
        // ⚠ NOT NEXT TO A PLAYER. Skipped, never moved: a post is a fixed place by design, and the
        // patrol comes round again in a few seconds, by which time whoever was there may have moved.
        if (nearOnly && typeKind(t) === 'npc' && !playerNear(p)) { waitingNear++; continue; }
        if (keepAway > 0 && players.at.some((q) => within(p, q, keepAway))) {
          nearPlayer++;
          continue;
        }
        if (room <= 0) continue;
        if (sent) continue;                      // one per round, deliberately
        const trimmed = room < countFor(t) ? Object.assign({}, t, { count: room }) : t;
        const made = await sendGuard(standingSpot(p), trimmed, typeLabel(t));
        if (made.count > 0) {
          out.spawned += made.count;
          room -= made.count;
          p.refused = 0; p.refusedUntil = 0;
          p.sentAt = Date.now();
          p.emptySince = 0;
          p.everHeld = true;
          p.ids = made.ids;
          // The post remembers WHICH guard stands on it, so the next patrol looks for the right one
          // and a replacement is the same figure as the one that died. Both halves: the position is
          // the identity, and the name is what proves that position still means the same guard.
          p.gt = typeWord(t);
          p.gti = types.indexOf(t);
          // Counted BEFORE anything has been seen. It is cleared the moment the post reads as held.
          p.blind = nz(p.blind, 0) + 1;
          if (p.blind >= MAX_BLIND_FILLS) p.blindUntil = Date.now() + BLIND_REST_MS;
          // The zone's clock starts when a guard really goes out, not when one was merely attempted.
          const clocks = Object.assign({}, host.store.get(K.lastGuardAt, {}) || {});
          clocks[String(entry.id)] = Date.now();
          host.store.set(K.lastGuardAt, clocks);
          sent = true;
        } else if (made.why) {
          out.refusals.push(made.why);
          // Half a minute, doubling, at most ten: a place the game will not take is tried again in
          // case whatever stood there has moved, and never hammered.
          p.refused = nz(p.refused, 0) + 1;
          p.refusedUntil = Date.now() + Math.min(600000, 30000 * 2 ** Math.min(5, p.refused - 1));
          sent = true;                           // a refusal is an answer; do not hammer the rest
        }
      }
      out.killed = killsTotal;
      if (moved) {
        log.info(`"${entry.name || entry.set}" — ${moved} guard spot(s) moved: the game removed `
          + 'the guards sent there within seconds');
      }
      if (resting) {
        out.refusals.push(`${resting} post(s) are resting after the game refused a guard there, and are `
          + 'tried again shortly. If it keeps refusing one place, the ground there is not somewhere a '
          + 'guard can stand — a roof, a wall or a steep slope — and a smaller or moved rectangle helps.');
      }
      // Said where it was counted. A post skipped in silence reads as a post that is broken.
      if (waitingNear && !sent && !out.held && !out.spawned) {
        out.refusals.push(`no guard was sent: this server allows no NPCs, so a guard goes only within 150 m `
          + `of a player, and ${waitingNear} guard spot(s) are further than that from everybody. Walk closer `
          + 'to one of them, or add extra guard spots.');
      }
      if (nearPlayer) {
        out.refusals.push(`${nearPlayer} post(s) were left empty this round because a player was `
          + 'standing near them — a guard is never made to appear next to somebody. They fill as soon '
          + 'as the area is clear.');
      }
      return out;
    }

    /**
     * Is this post held? `{ held }`, or `{ unknown, why }` when nothing could answer.
     *
     * "I could not find out" is NOT "it is empty" — the whole failure this separates is a patrol
     * that spawns a second guard because a reading failed, and then a third.
     */
    async function postHeld(p, rep, t) {
      const ids = Array.isArray(p.ids) ? p.ids : [];
      if (t.route !== 'persistent' && ids.length) {
        let anyAnswered = false;
        for (const id of ids) {
          const e = await bx('entity', id);
          if (!e || e.error || e.ok === false) continue;      // not adopted, or gone — try the next
          anyAnswered = true;
          const dead = e.alive === false || (e.healthPoints != null && nz(e.healthPoints, 1) <= 0);
          if (!dead) return { held: true };
        }
        // Every id answered and every one of them was dead: the post is genuinely empty.
        if (anyAnswered) return { held: false };
        // Nothing answered. That is "gone" and "the index never adopted it" wearing one face, and
        // the two are told apart only by prose the bridge does not promise — so it falls through to
        // the position check rather than branching on a sentence.
      }
      const radius = Math.max(200, nz(rep.postRadius, 1500));
      const pre = await bx('despawnPreview', typeKind(t), p.x, p.y, p.z, radius);
      if (!pre || pre.error) {
        return { unknown: true, why: pre ? ((pre.reason || pre.error) || 'no answer') : NO_BRIDGE_ANSWER };
      }
      const word = typeWord(t);
      const standing = (pre.objects || [])
        .filter((o) => actorWord(o.class) === word)
        .filter((o) => near(p, o, radius)).length;
      // ⚠ This branch cannot tell a corpse from a guard — see the note above. It is the FALLBACK,
      // reached only for the persistent route, which hands back no id to ask about, and for a direct
      // spawn the entity index never adopted. Where it is the only answer available, holding a post
      // with a body in it is still better than stacking guards on one that is fine.
      return { held: standing > 0 };
    }

    /**
     * Send the owner's chosen guard to one post. `{ count, ids, why }`.
     *
     * The ids are what makes the post checkable afterwards, and only the direct route has them:
     * `spawnPersistent` answers with no identifier at all, so a guard made that way can never be
     * asked about again. That is why the direct route is the default here and why the tab says what
     * the other one costs.
     */
    /**
     * How many this route will really take at one post.
     *
     * ⚠ **FIVE ON THE GAME'S OWN SPAWN, AND THE BRIDGE MEANS IT.** Its refusal says why: *"it is
     * small on purpose, because SCUM builds spawned actors deferred inside its own tick and a burst
     * is what crashes a server."* This plugin offered ten on both routes, so a guard set to ten was
     * refused with `bad_count` on every patrol, for ever — and the screen blamed something else.
     *
     * The DIRECT route really does take ten: it sends them one at a time and no bridge count is
     * involved. So the ceiling is the route's, not the block's.
     */
    const MAX_AT_POST = { spawn: 10, persistent: 5 };
    const countFor = (r) => Math.max(1, Math.min(MAX_AT_POST[r.route === 'persistent' ? 'persistent' : 'spawn'], nz(r.count, 1)));

    /**
     * ⚠ **THE GAME'S OWN SPAWN NEEDS A BRIDGE SETTING THE BRIDGE DOES NOT PUBLISH.** A module-issued
     * admin command is refused unless the bridge's own `allowModuleAdmin` is on — *"Let in-game mods
     * run admin commands"* on the SSA Bridge card, which takes effect when the server restarts. It is
     * off as the bridge ships, it is not a module switch the one-click button may change, and no
     * reading reports it, so a live owner met the raw words "allowModuleAdmin is off in
     * SSABridge.config.json" with no idea where that is. The refusal is the only evidence, so it is
     * remembered and turned into the setting's own name and where to find it.
     */
    let moduleAdminOffAt = 0;
    const MODULE_ADMIN_WHY = 'the bridge does not let plugins use the game\'s own spawn yet. Turn on "Let in-game '
      + 'mods run admin commands" on the SSA Bridge card (Settings, Bridge, group In game), then restart '
      + 'the server';

    async function sendGuard(at, r, what) {
      const name = what || 'the guard';
      const count = countFor(r);
      if (r.route === 'persistent') {
        const name = String(r.spawnName || '').trim();
        if (!name) return { count: 0, ids: [] };
        // The game's own spawn command, so SCUM keeps what it makes — and it is dispatched on a
        // player's own admin channel, so with nobody online it does nothing at all. `confirmed` is
        // the game not objecting, never a count of what appeared.
        const res = await bx('spawnPersistent', String(r.spawnKind || 'armednpc'), at.x, at.y, at.z, count, name);
        if (res && res.refusedByGame) {
          return { count: 0, ids: [], why: `the game refused the guard "${name}": ${res.gameSaid || 'no reason given'}` };
        }
        /**
         * ⚠ **THE GAME'S OWN WORDS OUTRANK A CONFIRMATION, AND THIS IS WHY.**
         *
         * Driven on a live server: every refused spawn came back `confirmed: true` with
         * `confirmedBy: "silence. The command was recognised and not refused…"` — and
         * `gameSaid: "Cannot spawn at the specified location."` in the SAME reply. The bridge's
         * confirmation reads silence and never reads `gameSaid`, so 25 sends asking for 113 guards
         * were all reported as successes while the game refused every one.
         *
         * That is the bridge's defect to fix and not this plugin's to wait for. A reply carrying a
         * sentence from the game is a refusal, whatever the flag beside it says.
         */
        const saidNo = String((res && res.gameSaid) || '').trim();
        if (saidNo) {
          return { count: 0, ids: [], why: `the game refused the guard "${name}": ${saidNo}`
            + (at.z === 0 ? ' — the post is at sea level, which the game will not spawn into.' : '') };
        }
        if (!res) return { count: 0, ids: [], why: NO_BRIDGE_ANSWER };
        if (res.confirmed === true) { moduleAdminOffAt = 0; return { count, ids: [] }; }
        /**
         * ⚠ **`confirmed: false` IS NOT A CAUSE, AND THIS USED TO NAME ONE.**
         *
         * It read `confirmed !== true` and reported "nobody was online" every time — so an owner
         * standing in their own server, watching nothing appear, was sent to look for a player. The
         * real answer was in the bridge's own refusal and was being thrown away.
         *
         * The bridge's words first, always. "Nobody was online" is said only when there is nothing
         * else to say, and even then it is offered as the likely reading rather than as the fact.
         */
        const said = String((res && (res.reason || res.error)) || '').trim();
        if (/allowModuleAdmin is off/i.test(said)) {
          moduleAdminOffAt = Date.now();
          return { count: 0, ids: [], why: `${name} was not created: ${MODULE_ADMIN_WHY}` };
        }
        if (res.confirmed === true || res.sent === true) moduleAdminOffAt = 0;
        return { count: 0, ids: [], why: said
          ? `${name} was not created: ${said}`
          : `${name} was handed over and the game confirmed nothing. The commonest reason is that `
            + 'nobody was online — this route runs through a player\'s own admin channel — but the '
            + 'bridge gave no reason, so that is a likely cause rather than a certain one.' };
      }
      const cls = String(r.classPath || '').trim();
      if (!cls) return { count: 0, ids: [] };
      const ids = [];
      let why = null;
      for (let i = 0; i < count; i++) {
        const res = await bx('spawnAt', String(r.kind || 'npc'), at.x, at.y, at.z, 0, 0, 0, cls);
        if (!res || res.error) {
          const said = (res && (res.reason || res.error)) || NO_BRIDGE_ANSWER;
          /**
           * ⚠ **"NOT IN MEMORY" IS NOT A BROKEN PATH, AND THE PLUGIN OWNS THE CONTROL THAT FIXES IT.**
           *
           * The direct route can only spawn a class Unreal has ALREADY LOADED, and Unreal loads a
           * blueprint class the first time the game creates one. A bunker guard on a naval base has
           * never been created, so its class is not in memory and will not be — and the bridge
           * refuses rather than loading it, because an asset load started from a module is
           * asynchronous and a second one arriving mid-flight is the `#SpawnItem` fatal.
           *
           * The bridge's sentence explains the mechanism, which is a bridge's job. Naming the switch
           * that gets round it is this plugin's, because this plugin is what has the switch.
           */
          why = /not in memory/i.test(String(said))
            ? `${name} has never existed on this server, so the direct route cannot make one — `
              + 'Unreal only knows a class once the game itself has created one. Switch this guard to '
              + '"The game\'s own spawn": that goes through SCUM\'s own spawner, which can bring a '
              + `class in. (The bridge's own words: ${said})`
            : `${name} could not be sent to its post: ${said}`;
          break;
        }
        // The entity index keys on the object slot, which is the half of the spawn id before the
        // dot. Taken here rather than later: the reply is the only place it is ever offered.
        const slot = Number(String(res.id || '').split('.')[0]);
        if (Number.isFinite(slot) && slot > 0) ids.push(slot);
        // A guard with no brain stands still for ever and gets reported as a bug against this
        // plugin, so the warning the bridge already made is passed on rather than dropped.
        if (res.warning || res.brain === false) {
          log.warn(`the guard spawned at a post has no working AI: ${res.warning || 'no controller was created'}`);
        }
      }
      return { count: ids.length || 0, ids, why };
    }

    /**
     * SCUM's own respawn delay, which is GLOBAL.
     *
     * The game keeps one set of sentry numbers for every guarded zone on the map and its tuning call
     * takes no zone argument, so this is an island-wide change and the tab says so where it is
     * switched on. It is also not saved — the bridge's own log says it resets on restart — which is
     * why it is re-applied while a zone is live and put back when nothing is.
     */
    async function applyGlobalRespawn(want) {
      // Island-wide by nature, so it is asked of the WHOLE set: any live zone that wants it holds it.
      const g = globalRespawnWanted() || {};
      if (!g.enabled) {
        // Only ever put back what THIS plugin set. A number an owner changed themselves while a zone
        // was live is theirs, and restoring over it would be this plugin undoing somebody else.
        const mine = nz(host.store.get(K.respawnSet, 0), 0);
        if (!mine) return;
        host.store.set(K.respawnSet, 0);
        const back = nz(host.store.get(K.respawnWas, 0), 0);
        if (back > 0) await bx('setSentryTuning', 'respawn', back);
        return;
      }
      if (!want) {
        const mine = nz(host.store.get(K.respawnSet, 0), 0);
        if (!mine) return;
        const back = nz(host.store.get(K.respawnWas, 0), 0);
        host.store.set(K.respawnSet, 0);
        if (back > 0) {
          const r = await bx('setSentryTuning', 'respawn', back);
          log.info(`sentry respawn delay put back to ${back}s ${r && r.ok ? '' : '(the bridge did not confirm it)'}`);
        }
        return;
      }
      const seconds = Math.max(1, Math.min(86400, nz(g.seconds, 3600)));
      if (nz(host.store.get(K.respawnSet, 0), 0) === seconds) return;
      // Read what it is first, so it can be put back. A reading that failed is not a value to
      // remember: the restore is skipped rather than writing a number nobody measured.
      const live = await bx('guardedZones');
      const was = (() => {
        const rows = (live && Array.isArray(live.fields)) ? live.fields : [];
        const row = rows.find((f) => f && (f.key === 'respawn' || f.key === 'sentryRespawnSeconds'));
        return row ? nz(row.value, 0) : 0;
      })();
      const r = await bx('setSentryTuning', 'respawn', seconds);
      if (!r || r.ok !== true) {
        log.warn(`the sentry respawn delay could not be set: ${(r && (r.reason || r.error)) || NO_BRIDGE_ANSWER}`);
        return;
      }
      if (was > 0) host.store.set(K.respawnWas, was);
      host.store.set(K.respawnSet, seconds);
      log.info(`sentry respawn delay set to ${seconds}s for EVERY guarded zone on the map`
        + `${was > 0 ? ` (it was ${was}s)` : ' (the old value could not be read, so it will not be put back)'}`);
    }

    // ── what players are told ────────────────────────────────────────────────────────────────────
    /**
     * One message, on every route the owner switched on.
     *
     * A `steamId` makes it private: chat goes to that player through `targets`, and the HUD and
     * kill-feed routes take their per-player form. `alert` is broadcast-only in the game and is
     * simply not offered on a per-player message.
     *
     * Nothing here throws. A message failing must never take a switch down with it.
     */
    async function deliver(which, tokens, steamId) {
      const c = cfg();
      const m = (c.messages || {})[which];
      if (!m || m.enabled === false) return;
      let text = String(m.text == null ? '' : m.text).trim();
      if (!text) return;
      for (const k of Object.keys(tokens || {})) {
        text = text.split(`{${k}}`).join(String(tokens[k] == null ? '' : tokens[k]));
      }

      const jobs = [];
      if (m.chat) {
        const opt = { channel: c.chatChannel || 'global' };
        if (steamId) opt.targets = [String(steamId)];
        jobs.push(host.chat.send(text, opt));
      }
      /**
       * The chat HISTORY — the admin chat view, the field console and the Discord chat channel.
       *
       * ⚠ Never for a line aimed at ONE player. The join message goes to whoever just logged in, and
       * the history is public — the field console is a page strangers read — so recording it would
       * publish something meant for one person, once per join. The host refuses it as well; this is
       * the near guard, because a plugin that has to be told by a refusal is a plugin that will one
       * day be told by a different host.
       */
      if (m.history && !steamId) {
        if (typeof host.chat.record === 'function') {
          const rec = host.chat.record(text, { channel: c.chatChannel || 'global' });
          if (rec && rec.ok === false) log.warn(`the chat history was not written: ${rec.reason}`);
        } else {
          // Feature-detected rather than assumed: this plugin runs on whatever manager is installed,
          // and an older one has no such door. Said once, in words, rather than failing quietly.
          log.warn('this manager is too old to put a line in the chat history — '
            + 'the message still went to the game');
        }
      }
      if (m.hud) jobs.push(steamId ? bx('hud', String(steamId), text) : bx('announceAll', text));
      // The game's alert is a BROADCAST call, so it has nothing to offer one player. For one player
      // the sound lives on the kill feed, whose wire carries a trailing `ping` that asks for the
      // notification sound — and that is the only per-player sound the game has.
      if (m.alert && !steamId) jobs.push(bx('alertAll', text));
      const ping = !!m.alert;
      if (m.killFeed || (ping && steamId)) {
        // The kill feed's fields are pipe-separated, and a pipe in the text is REFUSED rather than
        // mangled. The message is the middle field, which is the styled one. One entry either way:
        // a sound is a property of the entry, not a second entry.
        jobs.push(steamId
          ? bx('killFeedTo', String(steamId), '', text, '', ping)
          : bx('killFeedAll', '', text, '', ping));
      }
      const res = await Promise.all(jobs.map((p) => Promise.resolve(p).catch((e) => ({ ok: false, error: e && e.message }))));
      const bad = res.filter((r) => r && r.ok === false);
      if (bad.length) {
        log.warn(`the "${which}" message did not reach ${bad.length} of its ${jobs.length} route(s): `
          + bad.map((b) => b.reason || b.error || 'refused').join('; '));
      }
    }

    /** The live zone names, for `{zones}`. */
    const liveNames = () => getActive().map((a) => a.name || a.set);

    // ── switching ────────────────────────────────────────────────────────────────────────────────
    let busy = false;

    async function deactivate(entry, opts = {}) {
      // The posts go with the zone. Keeping them would have the patrol guarding a rectangle whose
      // loot is back to normal, which is a place nobody chose to defend.
      setPosts(entry.id, []);
      removeOwned(ownedFolder(entry));
      // ⚠ BOTH ROUTES, because which one CREATED a zone does not decide which one can remove it.
      // A zone written into the save is in the game's live set from the moment the server starts, and
      // only the bridge can touch it then; a zone the bridge drew is in the save as soon as the game
      // writes one, and with the server down only the save writer can. Clearing by the creating route
      // alone left a rectangle behind every time that route could not act — measured, two loot zones
      // standing side by side in an owner's save where one should have been.
      const erased = await eraseZone(entry, entry.rectCount || 1);
      const byBridge = erased.length > 0 && erased.every((e) => e.ok);
      let bySave = false;
      if (!byBridge) {
        const r = await eraseFromSave(entry, entry.rectCount || 1).catch(() => ({ ok: false }));
        bySave = !!(r && r.ok);
      }
      if (!byBridge && !bySave) {
        // Neither could. Said out loud: a rectangle nobody removed is one an owner meets tomorrow,
        // and reporting a clean switch over it is how it stays there.
        log.warn(`"${entry.name || entry.set}" — the LOOT is back to normal, and the `
          + 'rectangle could not be removed by either route. It is still on the map. Run "Check '
          + 'against the game" with the server up, or switch the zone off again while it is down.');
      }
      if (!opts.quiet) await deliver('deactivate', { zone: entry.name || entry.set, set: entry.set });
      // Removing the files is a loot change too, and the game will not see it until it restarts —
      // so what is pending here is the NORMAL loot coming back, which is the opposite sentence.
      host.store.set(K.lootWrittenAt, Date.now());
      host.store.set(K.lootPendingKind, 'off');
      log.info(`"${entry.name || entry.set}" off — its loot files are gone, and the game `
        + 'goes back to normal loot when the server next starts');
      return { erased };
    }

    async function activate(entry) {
      const r = readRect(entry.set);
      if (!r.ok) return { ok: false, why: r.why };
      if (!overrideDir) return { ok: false, why: 'the server directory is not configured, so there is nowhere to put the loot files' };

      const folder = ownedFolder(entry);
      let copied = 0;
      try {
        copied = copySet(entry.set, path.join(overrideDir, folder));
      } catch (e) {
        return { ok: false, why: `the loot files could not be copied into the server's Override folder (${e.code || e.message})` };
      }
      // The map half is separable and may honestly fail on an empty server, so the loot is never
      // held back for it and `drawn` carries the answer rather than a log line nobody reads.
      const live = await zoneSet();
      let drawn = false; let drawnBy = null; let rows = [];
      // The module's own words where there are any. A sentence of this plugin's own about a cause it
      // did not measure is how an owner standing in the game gets told nobody is on the server.
      let drawnWhy = (live && live.why) || NOT_KNOWN;
      if (live && live.known === true) {
        rows = await drawZone(entry, r.rects, live);
        drawn = rows.length > 0 && rows.every((d) => d.ok);
        drawnBy = drawn ? 'bridge' : null;
        drawnWhy = drawn ? null : (rows.find((d) => !d.ok) || {}).why || 'the game refused the zone write';
      }
      if (!drawn) {
        // The bridge could not. With the game stopped the save can, which is the moment an owner is
        // most likely to be laying zones out in the first place.
        const saved = await drawIntoSave(entry, r.rects, live);
        if (saved.ok) {
          drawn = true; drawnBy = 'save';
          drawnWhy = 'written into the save with the server stopped — players see it when the server starts';
        } else if (saved.why) {
          // BOTH refusals, in the order they were tried. Either one alone reads as the whole answer
          // and sends somebody to fix the thing that is not wrong.
          drawnWhy = twoReasons(drawnWhy, saved.why);
        }
      }

      const guards = await patrolGuards(entry, r.rects)
        .catch((e) => ({ removed: 0, spawned: 0, posts: 0, held: 0, refusals: [String(e && e.message)] }));
      await deliver('activate', { zone: entry.name || entry.set, set: entry.set });
      // The moment this plugin put loot on disk, and WHICH WAY. Compared against the server's own
      // start to tell "live" from "waiting" — the question the reload would have answered — and the
      // direction decides the sentence, because "richer loot is coming" and "normal loot is coming
      // back" are opposite things to tell an owner.
      host.store.set(K.lootWrittenAt, Date.now());
      host.store.set(K.lootPendingKind, 'on');
      log.info(`"${entry.name || entry.set}" on — ${copied} preset file(s) in place, `
        + `zone ${drawn ? 'drawn' : 'NOT drawn'}. ${LOOT_AT_RESTART}`);
      return { ok: true, copied, drawn, drawnWhy, drawnBy, rectCount: r.rects.length, rows, guards };
    }

    /** Draw a rectangle for a zone that is already live and never got one. */
    let sizesChecked = false;
    async function retryDraw() {
      const have = getActive();
      const c = cfg();
      const byId = new Map((c.zones || []).map((z) => [String(z.id), z]));
      // Once per load, while the game's zone list can be read: a rectangle an older version drew at
      // twice its size is drawn again at the right one.
      let live = null;
      if (!sizesChecked && have.some((a) => a.drawn === true)) {
        live = await zoneSet();
        if (live && live.known === true) {
          sizesChecked = true;
          const byName = new Map((live.zones || []).map((z) => [String(z && z.name), z]));
          for (const a of have) {
            if (a.drawn !== true) continue;
            const e = byId.get(String(a.id)) || a;
            const r = readRect(e.set);
            if (!r.ok) continue;
            const wrong = r.rects.some((rect, i) => {
              const z = byName.get(zoneNameAt(e, i, r.rects.length));
              return z && z.shape === 'rectangle'
                && (Math.abs(Number(z.width) - halfOf(rect).w) > 100 || Math.abs(Number(z.height) - halfOf(rect).h) > 100);
            });
            if (wrong) {
              a.drawn = false;
              log.info(`"${e.name || e.set}" — its rectangle on the map is not the size its Zones.json says; drawing it again`);
            }
          }
        }
      }
      const pending = have.filter((a) => a.drawn !== true);
      if (!pending.length) return;
      if (!live) live = await zoneSet();
      let moved = false;
      for (const a of pending) {
        const e = byId.get(String(a.id)) || a;
        const r = readRect(e.set);
        if (!r.ok) { a.drawnWhy = r.why; continue; }
        if (live && live.known === true) {
          const rows = await drawZone(e, r.rects, live);
          a.drawn = rows.length > 0 && rows.every((d) => d.ok);
          a.drawnBy = a.drawn ? 'bridge' : null;
          a.drawnWhy = a.drawn ? null : (rows.find((d) => !d.ok) || {}).why || 'the game refused the zone write';
        }
        if (!a.drawn) {
          // ⚠ THE REASON THIS BRANCH ALREADY HAS, kept before the save can overwrite it. This is
          // reached with the zone list KNOWN — it was read and the WRITE was refused — so
          // `live.why` is empty and printing the generic one told an owner standing in the game
          // that nobody was on the server. `activate()` gets this right by using its own local.
          const bridgeWhy = a.drawnWhy || (live && live.why) || NOT_KNOWN;
          const saved = await drawIntoSave(e, r.rects, live);
          if (saved.ok) {
            a.drawn = true; a.drawnBy = 'save';
            a.drawnWhy = 'written into the save with the server stopped — players see it when the server starts';
          } else if (saved.why) {
              a.drawnWhy = twoReasons(bridgeWhy, saved.why);
          }
        }
        a.rectCount = r.rects.length;
        moved = true;
        if (a.drawn) {
          log.info(`"${e.name || e.set}" — the rectangle is ${a.drawnBy === 'save'
            ? 'in the save, and players see it when the server starts' : 'on the map now'}`);
        }
      }
      if (moved) setActive(have);
    }

    /**
     * Turn the wanted set of zones into the live one.
     *
     * Everything goes through here — the schedule, the restart pick and the admin tab — so there is
     * one place that knows how to switch and one place the guard lives.
     */
    async function applyWanted(wantIds, why) {
      if (busy) return { ok: false, why: 'a switch is already in progress' };
      const c = cfg();
      const byId = new Map((c.zones || []).map((z) => [String(z.id), z]));
      const want = wantIds.map(String).filter((id) => byId.has(id)).slice(0, Math.max(1, nz(c.maxActive, 1)));
      const have = getActive();
      const haveIds = have.map((a) => String(a.id));

      const same = want.length === haveIds.length && want.every((id) => haveIds.includes(id));
      if (same) return { ok: true, unchanged: true };

      // The guard. Applied to every switch including a manual one AND a switch-off, because both
      // run the same reload and the cost it protects against — every examine spawner on the map
      // reset — falls on players either way.
      const gap = Math.max(0, nz(c.minMinutesBetweenSwitches, 0)) * 60000;
      const last = nz(host.store.get(K.lastSwitch, 0), 0);
      if (gap && last && (Date.now() - last) < gap && !(why && why.force)) {
        const leftM = Math.ceil((gap - (Date.now() - last)) / 60000);
        return { ok: false, why: `the last switch was less than ${c.minMinutesBetweenSwitches} minutes ago; every switch resets the searchable containers on the whole map, so this one waits ${leftM} more minute(s)` };
      }

      busy = true;
      try {
        const out = { off: [], on: [] };
        for (const a of have) {
          if (want.includes(String(a.id))) continue;
          const e = byId.get(String(a.id)) || a;
          await deactivate(Object.assign({}, e, { rectCount: a.rectCount, drawnBy: a.drawnBy }));
          out.off.push(a.id);
        }
        const nowActive = have.filter((a) => want.includes(String(a.id)));
        for (const id of want) {
          if (haveIds.includes(id)) continue;
          const e = byId.get(id);
          const res = await activate(e);
          if (res.ok) {
            nowActive.push({
              id: e.id, set: e.set, name: e.name, rectCount: res.rectCount, at: Date.now(),
              drawn: res.drawn, drawnWhy: res.drawnWhy, drawnBy: res.drawnBy,
              guards: res.guards ? { removed: res.guards.removed, spawned: res.guards.spawned } : null,
            });
            out.on.push({ id: e.id, ok: true, drawn: res.drawn, drawnWhy: res.drawnWhy, drawnBy: res.drawnBy, guards: res.guards });
          } else {
            out.on.push({ id: e.id, ok: false, why: res.why });
            log.warn(`"${e.name || e.set}" could not be switched on: ${res.why}`);
          }
        }
        setActive(nowActive);
        // Whether SCUM's island-wide respawn delay should be held now follows what is live, and it
        // is put back the moment nothing is.
        await applyGlobalRespawn(nowActive.length > 0).catch(() => {});
        // The reminder counts from the moment something went live, so the first one lands an
        // interval later instead of directly under the "it changed" line players just read.
        if (nowActive.length && !have.length) host.store.set(K.reminded, Date.now());
        // Stamped HERE rather than inside `activate`, so a switch-OFF starts the clock too: it runs
        // the same map-wide reload, and counting only the switch-on made every other one free.
        host.store.set(K.lastSwitch, Date.now());
        if (cfg().reloadOnSwitch !== false && (out.off.length || out.on.some((o) => o.ok))) {
          out.reload = await reloadLoot().catch((e) => ({ ok: false, why: e && e.message }));
        }
        return { ok: true, changed: out };
      } finally {
        busy = false;
      }
    }

    // ── what SHOULD be on ────────────────────────────────────────────────────────────────────────
    function wantedByTime() {
      const c = cfg();
      const t = host.time;
      const out = [];
      for (const z of (c.zones || [])) {
        if (z.enabled === false) continue;
        const w = Array.isArray(z.windows) ? z.windows : [];
        // An empty schedule is ALWAYS OPEN, which is the rule everywhere else in this product and
        // is what makes the feature additive: a zone with no windows written is a zone the owner
        // has not scheduled, not a zone that never runs.
        if (!w.length) { out.push(String(z.id)); continue; }
        if (!t || typeof t.isOpen !== 'function') continue;
        const r = safe(() => t.isOpen(w), null);
        if (r && r.open) out.push(String(z.id));
      }
      return out;
    }

    /** Advance to the next zone and remember it as THIS server session's pick. */
    function wantedByRestart() {
      const picked = pickNext();
      if (picked.length) host.store.set(K.sessionPick, picked[0]);
      return picked;
    }

    function pickNext() {
      const c = cfg();
      const list = (c.zones || []).filter((z) => z.enabled !== false).map((z) => String(z.id));
      if (!list.length) return [];
      if (c.restartPick === 'random') return [list[Math.floor(Math.random() * list.length)]];
      // ⚠ `Number(x) || -1` is the bug this line exists to not have: turn 0 is a legitimate
      // position and it is FALSY, so the fallback fired on it and the rotation sat on the first
      // zone for ever. Driven, four starts in a row, all of them zone one.
      const raw = host.store.get(K.turn, -1);
      const turn = Number.isFinite(Number(raw)) ? Number(raw) : -1;
      const next = (turn + 1) % list.length;
      host.store.set(K.turn, next);
      return [list[next]];
    }

    // ── reconcile: the game is the authority ─────────────────────────────────────────────────────
    /**
     * What this plugin believes and what the game holds are two different things, and the game wins.
     *
     * SCUM SAVES a custom zone the moment it is created, so a manager that stopped between drawing a
     * zone and recording it leaves that zone behind for ever — and the same crash leaves our loot
     * folder in `Override/`. Without this, a few restarts leave a map covered in zones nobody can
     * name and loot from sets nobody switched on.
     *
     * `zones()` answers `known: false` when the bridge has not captured the game's list yet, and
     * that is a real answer rather than an error. On `known: false` this does NOTHING — acting on a
     * list we do not have is how a reconcile deletes an admin's own zones.
     */
    async function reconcile() {
      // ⚠ FIRST, and not merely on the screen. This is the function that deletes, so it may not
      // depend on anybody having read a warning somewhere else — and the failure it prevents is
      // every custom zone on the server going, silently, at boot.
      if (!prefixUsable()) {
        log.warn(`not checking against the game: ${NO_PREFIX}`);
        return { skipped: true, why: NO_PREFIX };
      }
      const live = await zoneSet();
      if (!live || live.known !== true) {
        log.info('the game has not told the bridge its zone list yet — leaving everything alone until it does');
        return { skipped: true, why: NOT_KNOWN };
      }
      // The prefix as it is really NAMED, not as it is typed. `zoneNameFor` puts every name through
      // `safeZoneName`, so an owner whose prefix still carries a colon has zones called "Loot- …" on
      // the map — and comparing those against the raw "Loot: " matches nothing, which makes every
      // one of this plugin's own zones invisible to its own clean-up.
      const prefix = safeZoneName(cfg().zone.namePrefix);
      const ours = (live.zones || []).filter((z) => String(z.name || '').startsWith(prefix)).map((z) => z.name);
      const believed = getActive();
      const believedNames = new Set();
      for (const a of believed) {
        const n = zoneNameFor({ name: a.name, set: a.set });
        if ((a.rectCount || 1) > 1) for (let i = 1; i <= a.rectCount; i++) believedNames.add(`${n} ${i}`);
        else believedNames.add(n);
      }
      const strayZones = ours.filter((n) => !believedNames.has(n));
      const strayFolders = ownedFolders().filter((f) => !believed.some((a) => ownedFolder(a) === f));

      const stubborn = [];
      for (const n of strayZones) {
        const gone = await bx('deleteZone', n);
        if (gone && gone.ok === true) {
          log.warn(`removed "${n}", a zone of ours the game still held that nothing here had switched on`);
        } else {
          stubborn.push(n);
        }
      }
      // The bridge could not, so the save is asked — which is the route that works with the server
      // down, and a leftover is most likely to be found by somebody who has just stopped one.
      if (stubborn.length && host.map && typeof host.map.writeZones === 'function') {
        const r = await host.map.writeZones({ regions: { delete: stubborn.map((n) => ({ name: n })) } })
          .catch(() => null);
        if (r && r.ok === true) {
          log.warn(`removed ${stubborn.length} leftover zone(s) from the save: ${stubborn.join(', ')}`);
        } else {
          log.warn(`${stubborn.length} zone(s) of ours are still on the map and neither route `
            + `could remove them (${stubborn.join(', ')}): ${(r && (r.reason || r.code)) || 'the bridge refused and the save could not be written'}`);
        }
      }
      for (const f of strayFolders) {
        removeOwned(f);
        log.warn(`removed the loot folder "${f}", which nothing here had switched on`);
      }
      return { strayZones, strayFolders };
    }

    // ── the loop ─────────────────────────────────────────────────────────────────────────────────
    let timer = null;
    let bootDone = false;

    async function tick() {
      const c = cfg();
      if (!c.enabled) return;
      if (c.rotation === 'time') {
        await applyWanted(wantedByTime(), {}).catch((e) => log.warn(`${e && e.message}`));
      }
      // A rectangle that could not be written when the zone went live, and the guards the game has
      // respawned since. Both only ever touch what is already on.
      await retryDraw().catch(() => {});
      // Re-applied rather than set once: the game does not save this number, so a restart puts it
      // back and nothing would say so.
      await applyGlobalRespawn(getActive().length > 0).catch(() => {});
      await remindDue().catch(() => {});
    }

    /**
     * The patrol's own clock, apart from the slow tick.
     *
     * Each zone is due every `nearbyPatrolSeconds`. Due zones share ONE reading of where the players
     * are; a zone nobody is near stops there, with no other bridge call. So an empty server costs one
     * small read every few seconds, and a server with players far from every zone costs the same.
     */
    let patrolBusy = false;
    // The earliest moment any zone can next be due. Until then a tick returns without reading the
    // configuration or the store, both of which are files.
    let patrolNotBefore = 0;
    async function patrolDue() {
      if (patrolBusy || Date.now() < patrolNotBefore) return;
      patrolBusy = true;
      try {
        // Nothing live, or nothing guarded: look again in a few seconds, which is how soon a zone
        // switched on or set to guard starts being patrolled.
        patrolNotBefore = Date.now() + 3000;
        const c = cfg();
        if (!c.enabled) return;
        const have = getActive();
        if (!have.length) return;
        const byId = new Map((c.zones || []).map((z) => [String(z.id), z]));
        const due = [];
        let soonest = Infinity;
        for (const a of have) {
          const e = byId.get(String(a.id)) || a;
          const s = guardsFor(e) || {};
          if (s.mode !== 'remove' && s.mode !== 'replace') continue;
          const every = Math.max(3, nz(s.nearbyPatrolSeconds, 5)) * 1000;
          const last = nz(patrolClock[String(a.id)], 0);
          const at = last ? last + every : 0;
          if (at > Date.now()) { soonest = Math.min(soonest, at); continue; }
          soonest = Math.min(soonest, Date.now() + every);
          due.push(e);
        }
        if (Number.isFinite(soonest)) patrolNotBefore = Math.min(patrolNotBefore, soonest);
        if (!due.length) return;
        const who = await playersNow();
        for (const e of due) {
          const r = readRect(e.set);
          if (!r.ok) { markPatrolled(e.id); continue; }
          // `patrolGuards` stamps its own clock, so nothing here has to remember to.
          await patrolGuards(e, r.rects, who).catch((err) => {
            markPatrolled(e.id);
            log.warn(`"${e.name || e.set}" patrol failed: ${err && err.message}`);
          });
        }
      } finally {
        patrolBusy = false;
      }
    }

    async function remindDue() {
      const m = (cfg().messages || {}).reminder || {};
      if (!m.enabled) return;
      const every = Math.max(1, nz(m.everyMinutes, 60)) * 60000;
      const last = nz(host.store.get(K.reminded, 0), 0);
      if (last && Date.now() - last < every) return;
      const names = liveNames();
      // Nothing to say is not a reminder. Stamping here spent the interval on an empty server, so a
      // zone switched on afterwards waited a full hour for a line that was due the moment it started.
      if (!names.length) return;
      host.store.set(K.reminded, Date.now());
      await deliver('reminder', { zones: names.join(', '), zone: names[0], count: names.length });
    }

    async function boot() {
      if (bootDone) return;
      bootDone = true;
      const c = cfg();
      // Nothing this plugin spawns directly is registered with SCUM, so a restart took every guard
      // AND voided every id with it. A post still carrying one would be asked about, get no answer,
      // and fall through to reading whatever is standing there — so they start empty, which is what
      // they really are.
      forgetGuardIds();
      await reconcile().catch((e) => log.warn(`reconcile: ${e && e.message}`));
      if (!c.enabled) return;
      if (c.rotation === 'restart') {
        // NOT a rotation. The manager restarting is not the server restarting — that is the whole
        // point of this mode — so it re-applies the zone this server session already picked and
        // leaves the turn alone. With no pick yet it does nothing and waits for the server to come
        // up, which is the signal that really moves it.
        const mine = String(host.store.get(K.sessionPick, '') || '');
        if (mine) {
          await applyWanted([mine], { force: true }).catch((e) => log.warn(`${e && e.message}`));
        }
      } else if (c.rotation === 'time') {
        await tick();
      }
    }

    // One timer across reloads, or reopening the tab stacks them.
    function arm() {
      if (timer) clearInterval(timer);
      const every = Math.max(15, nz(cfg().checkEverySeconds, 60)) * 1000;
      timer = setInterval(() => { tick().catch(() => {}); }, every);
    }
    arm();
    // The patrol's clock. One second is how finely a zone's own `nearbyPatrolSeconds` is honoured; a
    // tick with nothing due returns before it touches the bridge.
    const patrolTimer = setInterval(() => { patrolDue().catch(() => {}); }, 1000);
    if (typeof host.onUnload === 'function') {
      host.onUnload(() => { clearInterval(timer); clearInterval(patrolTimer); });
    }

    // The bridge is not there the instant a plugin registers, so the first pass waits for the
    // server rather than racing it. Failing that, the timer picks it up.
    setTimeout(() => { boot().catch(() => {}); }, 20000);

    // ── a player arriving ────────────────────────────────────────────────────────────────────────
    //
    // `onJoin` is the bridge's live signal — the instant the prisoner is spawned in, with none of the
    // log tail's lag. The delay is not politeness: a player who has just arrived is still looking at
    // a loading screen, and a chat line sent then is a chat line nobody reads.
    /**
     * The server came up — which is when this mode rotates, and the only time it does.
     *
     * ⚠ This is NOT fired when the manager starts over a server that is already running:
     * `monitoring.js` primes its lifecycle baseline on the first tick precisely so the state it
     * found is not re-announced. So the event means the server really restarted, which is the
     * distinction this whole mode is about.
     *
     * The switch guard is respected rather than forced past. It exists because every switch resets
     * every searchable container on the whole map, and a server crash-looping every two minutes must
     * not do that on every loop; a scheduled restart is hours apart and never meets it.
     */
    if (host.events && typeof host.events.on === 'function') {
      /**
       * The server has stopped — which is when the loot for the NEXT session is decided.
       *
       * ⚠ Not when it comes up. SCUM reads its `Loot` folder at STARTUP, so files put there while
       * the game is already running are read at the restart after that one: an owner would be told a
       * zone was live a whole session before it was. With no reload command to fall back on — it
       * crashes the server — the moment the files are written is the only thing that decides when the
       * loot lands.
       *
       * It is the right moment twice over: the save writer refuses while the server is running, so
       * with the game down the rectangle can be written too. Both halves land together, before the
       * game reads either.
       */
      host.events.on('server:offline', () => {
        const c = cfg();
        if (!c.enabled || c.rotation !== 'restart') return;
        Promise.resolve()
          // NOT forced past the switch floor. Forcing was right while a switch reset every
          // searchable container on the map — nobody was on to mind — and that cost went with the
          // reload. What the floor is still for is a server crash-looping every two minutes walking
          // through every zone an owner has.
          .then(() => applyWanted(wantedByRestart(), {}))
          .then((r) => {
            if (r && r.ok === false) log.info(`the server stopped and the zone stayed as it was: ${r.why}`);
            else log.info('the server stopped — the next session\'s loot zone is in place');
          })
          .catch((e) => log.warn(`${e && e.message}`));
      });

      /**
       * The server is up. NOT a rotation — that already happened as it went down.
       *
       * Two things can only be done with a running game: drawing a rectangle the save could not take,
       * and looking at the guards. Both are the ordinary tick's work, so this only brings it forward
       * rather than waiting up to a minute for it.
       */
      host.events.on('server:online', () => {
        // When the game last read its Loot folder. It reads it AT STARTUP and at no other time, so
        // this is the only thing that separates "the loot is live" from "the loot is waiting" —
        // and a manager started over an already-running server never sees this event, which is why
        // its absence is reported as not knowing rather than filled in.
        serverUpAt = Date.now();
        if (!cfg().enabled) return;
        Promise.resolve()
          .then(() => retryDraw())
          .then(() => patrolDue())
          .catch((e) => log.warn(`${e && e.message}`));
      });
    }

    if (host.players && typeof host.players.onJoin === 'function') {
      host.players.onJoin((p) => {
        const m = (cfg().messages || {}).join || {};
        if (!m.enabled) return;
        const names = liveNames();
        if (!names.length) return;
        const wait = Math.max(0, Math.min(300, nz(m.delaySeconds, 20))) * 1000;
        setTimeout(() => {
          deliver('join', {
            player: (p && p.playerName) || '', zones: names.join(', '), zone: names[0], count: names.length,
          }, p && p.steamId).catch(() => {});
        }, wait);
      });
    }

    // ── admin API ────────────────────────────────────────────────────────────────────────────────
    // Mounted unconditionally: a `register()` that stands down takes the whole tab with it, and
    // every read below answers with the server stopped.
    host.routes.get('/config', (req, res) => res.json(cfg()));

    /**
     * Put this plugin's own zone configuration in step with what was just saved — its colour, its two
     * switches and the zombie rule — while a zone is live. One zone set, and nothing at all is sent when
     * the game already holds exactly that. Never awaited by the save: the game may be down.
     */
    async function syncOwnConfig() {
      if (cfg().zone.configMode !== 'own' || !getActive().length) return;
      const live = await readZones();
      if (!live || live.known !== true) return;
      const idx = await configIndexFor(live);
      if (idx.index != null && idx.edits && idx.edits.length) await zoneEdits(idx.edits);
    }

    host.routes.post('/config', (req, res) => {
      const next = overlay(host.config.get() || {}, req.body || {});
      host.config.set(next);
      arm();
      syncOwnConfig().catch(() => {});
      // A pipe is the kill feed's field separator and the bridge REFUSES text carrying one rather
      // than mangling it, so a message that can never be delivered is said here, at the save, and
      // not discovered when a zone switches at three in the morning.
      const c = cfg();
      const warn = [];
      // A colon in a zone name is removed when the name is built, because the bridge's own commands
      // are colon-separated and a name carrying one breaks the write outright. Said here rather than
      // silently: an owner who typed one should know their name is not quite what appears in game.
      if (!prefixUsable()) {
        warn.push(`⚠ ${NO_PREFIX} Until it has one, the plugin will not draw a zone and will not `
          + 'check the game for leftovers — both of those need to know which zones are its own.');
      }
      const colons = [];
      if (String(c.zone.namePrefix || '').includes(':')) colons.push('the name prefix');
      for (const z of (c.zones || [])) if (String(z.name || '').includes(':')) colons.push(`"${z.name}"`);
      if (colons.length) {
        warn.push(`a colon cannot appear in a zone's name — the bridge's own zone commands are `
          + `colon-separated and the name comes first, so one there moves every field after it and the `
          + `write is refused. It is replaced with a dash in ${colons.join(', ')}.`);
      }
      // A schedule nobody can read is CLOSED, which is the right direction and a silent one: the zone
      // simply never comes on. `host.time` is the one evaluator for this in the product, so its own
      // sentence is carried rather than a second reading of the same rule — and the commonest of
      // those sentences is about the DAYS, which are 1 (Monday) to 7 (Sunday) and were written 0..6
      // on this tab for as long as it had existed.
      if (c.rotation === 'time' && host.time && typeof host.time.validate === 'function') {
        for (const z of (c.zones || [])) {
          const w = Array.isArray(z.windows) ? z.windows : [];
          if (!w.length) continue;
          const v = safe(() => host.time.validate(w), null);
          if (v && v.ok === false) {
            for (const e of (v.errors || [])) {
              warn.push(`"${z.name || z.set}" has a time that cannot be read, so the zone stays off: ${e}`);
            }
          }
        }
      }

      // A guard setting that cannot do anything. Every one of these is reachable by ordinary
      // clicking, every individual value in it is legal, and the screen shows guards switched on —
      // so without this the zone simply does nothing and the owner has no way of finding out why.
      // The owner's C3 zone was the middle case: replace, nothing to clear, and no posts of its own.
      const guardTrouble = (s2) => {
        const kinds = Array.isArray(s2.kinds) ? s2.kinds.filter(Boolean) : [];
        const own = Math.max(0, Number(s2.ownPosts) || 0);
        const rep = s2.replace || {};
        // The same fallback `guardTypes()` uses, and for the same reason: an EMPTY list means "the
        // single choice beside it", which is what every configuration written before the list
        // existed carries. Reading `[]` as "nothing is chosen" warned about settings that work.
        // ⚠ THE PARENTHESES ARE LOAD-BEARING. `||` binds tighter than `?:`, so
        // `String(c ? a : b || '')` is `String(c ? a : (b || ''))` — and for a persistent entry whose
        // `spawnName` is undefined that is `String(undefined)`, the four-letter word "undefined",
        // which is truthy. The warning was then suppressed for exactly the configuration it exists
        // for, while `guardTypes()` dropped the entry and the posts really did stand empty.
        const chosen = (Array.isArray(rep.types) && rep.types.length ? rep.types : [rep])
          .filter((t) => t && String((t.route === 'persistent' ? t.spawnName : t.classPath) || '').trim());
        if (s2.mode === 'remove' && !kinds.length) {
          return 'it is set to clear guards and no kind of guard is ticked, so there is nothing for it to look for';
        }
        if (s2.mode === 'replace' && !kinds.length && !own) {
          return 'it is set to replace guards, but no kind of guard is ticked to clear and it asks for '
            + 'no posts of its own — so there is nowhere for a guard to stand. Tick a kind to clear, or '
            + 'set "posts of its own" to the number of guards the zone should have';
        }
        if (s2.mode === 'replace' && !chosen.length) {
          return 'it is set to replace guards and no guard has been chosen, so its posts will stand empty';
        }
        return null;
      };
      const defaultTrouble = guardTrouble(c.sentries || {});
      if (defaultTrouble) warn.push(`the guard setting every zone falls back to can do nothing: ${defaultTrouble}`);
      for (const z of (c.zones || [])) {
        if (!z || !z.sentries) continue;         // follows the default, already judged above
        // ⚠ THE SAME MERGE THE RUNTIME USES. A shallow one judged a zone naming only
        // `{replace: {count: 3}}` against a `replace` with no class path in it, and warned "no guard
        // has been chosen" at every save about a zone that works perfectly — which is the
        // fires-on-correct-code failure that gets a warning ignored.
        const t = guardTrouble(guardsFor(z));
        if (t) warn.push(`"${z.name || z.set}" has its own guard setting and it can do nothing: ${t}`);
      }

      for (const k of Object.keys(c.messages || {})) {
        const m = c.messages[k];
        if (m && m.killFeed && String(m.text || '').includes('|')) {
          warn.push(`the "${k}" message is set to go to the kill feed and its text contains "|", which the game reads as a field separator — that route will be refused until it is removed`);
        }
      }
      res.json({ ok: true, config: c, warnings: warn });
    });

    host.routes.get('/sets', (req, res) => {
      const l = listSets();
      res.json({ root: l.root, readable: l.readable, sets: l.sets, overrideDir, serverConfigured: !!serverDir });
    });

    /**
     * Each scheduled zone's own verdict, in the evaluator's words.
     *
     * ⚠ `host.time.isOpen` FAILS CLOSED and so does this. "I could not work out whether this window
     * is open" and "it is shut" are different facts, and only one of them is safe to render as the
     * other — a zone reported open that is not simply shows a wrong chip, where a zone reported shut
     * that is open sends its owner looking, which is the outcome that gets fixed.
     */
    function scheduleSummary() {
      const c = cfg();
      const t = host.time;
      const out = {};
      if (c.rotation !== 'time') return out;
      // ⚠ WITH NO EVALUATOR, `wantedByTime()` STILL SWITCHES ON A ZONE THAT HAS NO WINDOWS — it
      // returns before it ever asks for one. Returning an empty summary here left the screen silent
      // about a zone that is running, which is the gap between the two halves rather than a missing
      // feature. Every zone gets the answer that is true on this manager.
      if (!t || typeof t.isOpen !== 'function') {
        for (const z of (c.zones || [])) {
          const w = Array.isArray(z.windows) ? z.windows : [];
          out[String(z.id)] = (z.enabled === false)
            ? { open: false, disabled: true, why: 'this zone is switched off in the list below' }
            : (w.length
              ? { open: false, errors: ['this manager is too old to read a schedule, so a zone with '
                + 'times set stays off — update the manager, or clear its times to have it always on'] }
              : { open: true, unscheduled: true, why: 'no times set, so this zone is on whenever rotation is running' });
        }
        return out;
      }
      // How many zones the rotation will really take, so a zone the ceiling holds back is not shown
      // a green "Open now" it can never act on.
      const room = Math.max(1, nz(c.maxActive, 1));
      let opened = 0;
      for (const z of (c.zones || [])) {
        // ⚠ THE SAME ZONES `wantedByTime()` CONSIDERS. It skips a disabled one; this used to report
        // for it anyway, so a zone switched off showed "Open now — Mon–Fri 20:00–23:00" and was
        // never switched on. A screen that promises what the runtime will not do is worse than one
        // that says nothing.
        if (z.enabled === false) {
          out[String(z.id)] = { open: false, disabled: true,
            why: 'this zone is switched off in the list below, so its times are not looked at' };
          continue;
        }
        const w = Array.isArray(z.windows) ? z.windows : [];
        if (!w.length) {
          // The rule everywhere in this product: an empty schedule is ALWAYS OPEN. Said in words,
          // because "no times set" reads as "never" to about half the people who see it.
          out[String(z.id)] = { open: true, unscheduled: true, heldBack: (++opened) > room,
            why: 'no times set, so this zone is on whenever rotation is running' };
          continue;
        }
        const r = safe(() => t.isOpen(w), null);
        const v = safe(() => t.validate(w), null);
        if (r && r.open) opened++;
        out[String(z.id)] = {
          open: !!(r && r.open),
          // Open, and yet not switched on, because the rotation's own ceiling is already met. Two
          // green "Open now" zones and a `maxActive` of 1 is an ordinary configuration and the
          // screen said nothing about which of them loses.
          heldBack: !!(r && r.open) && opened > room,
          why: (r && r.why) || '',
          text: safe(() => t.describe(w), '') || '',
          opensInMinutes: r ? r.opensInMinutes : null,
          closesInMinutes: r ? r.closesInMinutes : null,
          errors: (v && v.ok === false) ? (v.errors || []) : [],
        };
      }
      return out;
    }

    /** Which clock a window is read on, so the screen never leaves that to a guess. */
    host.routes.get('/clock', (req, res) => {
      const t = host.time;
      res.json({
        now: (t && typeof t.now === 'function') ? safe(() => t.now(), null) : null,
        zone: (t && typeof t.zone === 'function') ? safe(() => t.zone(), null) : null,
      });
    });

    host.routes.post('/reload-loot', async (req, res) => {
      res.json(await reloadLoot().catch((e) => ({ ok: false, why: e && e.message })));
    });

    host.routes.get('/status', async (req, res) => {
      const c = cfg();
      const live = await readZones();
      const last = nz(host.store.get(K.lastSwitch, 0), 0);
      const gapMs = Math.max(0, nz(c.minMinutesBetweenSwitches, 0)) * 60000;
      const lootAt = nz(host.store.get(K.lootWrittenAt, 0), 0);
      const upAt = serverUpAt;
      const running = (host.server && typeof host.server.isRunning === 'function') ? !!host.server.isRunning() : null;
      const info = (host.server && typeof host.server.info === 'function')
        ? (safe(() => host.server.info(), null) || {}) : {};
      res.json({
        enabled: c.enabled,
        rotation: c.rotation,
        active: getActive(),
        // `known: false` is the bridge saying the game has not sent its zone list, which is not the
        // same as "there are no zones" and is drawn differently.
        zonesKnown: !!(live && live.known === true),
        // The module's own sentence where there is one, this plugin's only when there is not.
        zonesUnknownWhy: (live && live.known === true) ? null : ((live && live.why) || NOT_KNOWN),
        zoneAgeMs: live && live.ageMs != null ? live.ageMs : null,
        configs: (live && live.known === true && Array.isArray(live.configs))
          ? live.configs.map((x, i) => ({ index: i, name: x && x.name })) : null,
        ourZones: live && live.known === true
          ? (live.zones || []).filter((z) => String(z.name || '').startsWith(safeZoneName(c.zone.namePrefix))).map((z) => z.name)
          : null,
        ownedFolders: ownedFolders(),
        // One sentence per scheduled zone, from the manager's own evaluator rather than composed
        // here: "open now — Mon–Fri 20:00–23:00" is a thing an owner can check at a glance, and three
        // text boxes are a thing they have to evaluate in their head. `tz` is named because "20:00"
        // means two different things and the screen must never leave which one to a guess.
        schedule: scheduleSummary(),
        patrols: patrolsForScreen(),
        lastSwitchMs: last || null,
        nextSwitchInMs: (gapMs && last) ? Math.max(0, gapMs - (Date.now() - last)) : 0,
        serverConfigured: !!serverDir,
        // A live half full of honest nothings reads as a broken plugin unless something says why.
        // Everything above it stays editable either way: the loot files and every message on this
        // page are set up before a server is ever started.
        serverRunning: running,
        /**
         * Is there loot on disk the game has not read yet?
         *
         * SCUM reads its `Loot` folder ONLY when it starts — the one command that would make a
         * running server re-read it crashes the game every time, measured, so there is nothing to
         * offer instead. That makes this the most important fact on the page: the rectangle appears
         * at once and the loot behind it may not be live for hours.
         *
         * ⚠ THREE STATES, NOT TWO. `null` is "I could not work it out", which happens whenever the
         * manager was started over an already-running server and so never saw it come up. Reporting
         * that as `false` would tell an owner their loot is live when it may be waiting, and as
         * `true` would send them to restart a server that needs nothing.
         */
        lootPending: (running !== true || !lootAt) ? false
          : (nz(host.store.get(K.lootReloadedAt, 0), 0) >= lootAt ? false : (upAt ? (lootAt > upAt) : null)),
        // WHICH WAY the waiting change goes. "The richer loot is coming" and "the normal loot is
        // coming back" are opposite things to tell somebody, and the old screen said the first one
        // for both — so switching everything off reported that the files were on disk and players
        // were still seeing normal loot, with all three of its clauses false.
        lootPendingKind: host.store.get(K.lootPendingKind, null) || null,
        // The server's NPC ceiling, so the tab can say why guards appear only near players.
        npcLimit: npcLimit(),
        lootWrittenAt: lootAt || null,
        serverUpAt: upAt || null,
        // The restart the MANAGER has already scheduled, so the screen can say when the loot really
        // lands rather than only that it will.
        nextRestartUnix: info.nextRestartUnix || null,
      });
    });

    host.routes.post('/activate', async (req, res) => {
      const id = String((req.body && req.body.id) || '');
      const force = !!(req.body && req.body.force);
      const r = await applyWanted([id], { force }).catch((e) => ({ ok: false, why: e && e.message }));
      res.json(r);
    });

    host.routes.post('/deactivate', async (req, res) => {
      const r = await applyWanted([], { force: !!(req.body && req.body.force) })
        .catch((e) => ({ ok: false, why: e && e.message }));
      res.json(r);
    });

    host.routes.post('/reconcile', async (req, res) => {
      const r = await reconcile().catch((e) => ({ error: e && e.message }));
      res.json(r || {});
    });

    /**
     * Spawn code to blueprint class path, for the picker on the direct route.
     *
     * The direct route takes a full object path and refuses anything shorter, and no catalogue this
     * product publishes carries one — so without this the field could only ever be typed into. The
     * table is a reading of the game build this plugin was packaged against; a code that is not in
     * it is answered as not in it, rather than guessed at.
     */
    host.routes.get('/guard-classes', (req, res) => {
      try {
        const raw = fs.readFileSync(path.join(__dirname, 'guard-classes.json'), 'utf8');
        res.json(JSON.parse(raw));
      } catch (e) {
        // A missing table is not a broken plugin: the field is still typeable and the panel says so.
        res.json({ classes: {}, kinds: {}, error: `the class table could not be read (${e.code || e.message})` });
      }
    });

    /**
     * Which bridge switches THIS configuration uses, and whether each one is on.
     *
     * Derived from what is set rather than from everything the plugin could ever touch: an owner who
     * only draws loot rectangles is not asked about removing zombies. Each entry says what it is FOR in
     * the owner's words, because "despawn → puppets" means nothing to somebody setting up a zone. The
     * tab turns the off ones on with one click through the manager — this route only reads.
     */
    host.routes.get('/bridge-check', async (req, res) => {
      const c = cfg();
      const want = new Map();
      const add = (forWhat, keys) => { for (const k of keys) if (!want.has(k)) want.set(k, forWhat); };
      if ((c.zones || []).length) add('Drawing the zone on the map', ['zones.enabled', 'zones.write']);
      const blocks = [{ entry: null, s: c.sentries || {} }]
        .concat((c.zones || []).filter((z) => z && z.sentries).map((z) => ({ entry: z, s: guardsFor(z) || {} })));
      for (const { entry, s } of blocks) {
        const kinds = Array.isArray(s.kinds) ? s.kinds : [];
        if (s.mode !== 'remove' && s.mode !== 'replace') continue;
        add('Knowing who is near a zone', ['live.enabled', 'live.where']);
        if (kinds.includes('mapsentry')) add('Keeping sentries out', ['despawn.enabled', 'despawn.stowSentries']);
        if (kinds.includes('sentry')) add('Keeping sentries out', ['despawn.enabled', 'despawn.sentries']);
        if (kinds.includes('puppet')) add('Keeping zombies out', ['despawn.enabled', 'despawn.puppets']);
        if (s.mode === 'replace') {
          add('Sending guards', ['spawn.enabled', 'place.enabled', 'place.describe']);
          const types = guardTypes(entry || {});
          if (types.some((t) => t.route === 'persistent')) add('Sending guards', ['spawn.persistent']);
          if (types.some((t) => t.route !== 'persistent')) add('Sending guards', ['spawn.creatures', 'entities.enabled']);
        }
        if (s.globalRespawn && s.globalRespawn.enabled) add('Slowing the sentry respawn', ['zones.guarded', 'zones.guardedwrite']);
      }
      for (const m of Object.values(c.messages || {})) {
        if (!m || typeof m !== 'object' || !String(m.text || '').trim()) continue;
        if (m.hud || m.alert || m.killFeed) add('On-screen messages', ['notify.enabled', 'actions.enabled', 'actions.messages']);
        if (m.hud) add('On-screen messages', ['notify.broadcast']);
        if (m.alert) add('On-screen messages', ['notify.sound']);
        if (m.killFeed) add('On-screen messages', ['notify.killfeed']);
      }
      const r = (host.bridge && typeof host.bridge.needs === 'function')
        ? await Promise.resolve(host.bridge.needs()).catch(() => null) : null;
      const found = new Map();
      for (const g of ((r && r.groups) || [])) {
        for (const sw of (g.switches || [])) {
          found.set(`${g.module}.${sw.key}`, { g, sw });
        }
      }
      // Not a module switch, so `needs()` cannot report it: listed from the last refusal, for an hour.
      const usesGameSpawn = [{ entry: null }].concat((c.zones || []).map((z) => ({ entry: z })))
        .some(({ entry }) => (guardsFor(entry || {}) || {}).mode === 'replace' && guardTypes(entry || {}).some((t) => t.route === 'persistent'));
      const manual = (usesGameSpawn && moduleAdminOffAt && Date.now() - moduleAdminOffAt < 3600000)
        ? [{ module: 'bridge', key: 'allowModuleAdmin', forWhat: 'Sending guards', label: 'Let in-game mods run admin commands',
          moduleName: 'SSA Bridge', state: 'off', ownerMay: false, manual: true }]
        : [];
      const items = manual.concat([...want.entries()].map(([k, forWhat]) => {
        const hit = found.get(k);
        const [module, key] = k.split('.');
        if (!hit) return { module, key, forWhat, label: key, moduleName: module, state: 'unknown', ownerMay: false };
        return {
          module, key, forWhat,
          label: hit.sw.label || key,
          moduleName: hit.g.moduleName || module,
          state: hit.sw.state,
          ownerMay: !!hit.sw.ownerMay,
          danger: hit.sw.tierFamily === 'danger',
        };
      }));
      res.json({ known: !!(r && r.declared), online: r ? r.online !== false : null, items });
    });

    /** Send one of the four messages to the game as players would get it, so wording can be tried out. */
    host.routes.post('/test-message', async (req, res) => {
      const which = String((req.body && req.body.which) || 'activate');
      const to = String((req.body && req.body.steamId) || '').trim();
      const names = liveNames();
      const names2 = names.length ? names : ['(no zone is live — this is how it would read)'];
      await deliver(which, {
        zone: names2[0], set: names2[0], zones: names2.join(', '), count: names2.length, player: '',
      }, to || undefined).catch(() => {});
      res.json({ ok: true, sentTo: to || 'everyone' });
    });

    /** What the bridge will remove, and what of it is really inside the rectangle. Removes nothing. */
    host.routes.post('/guard-preview', async (req, res) => {
      const id = String((req.body && req.body.id) || '');
      const z = (cfg().zones || []).find((x) => String(x.id) === id);
      if (!z) return res.json({ error: 'no zone by that id' });
      const r = readRect(z.set);
      if (!r.ok) return res.json({ error: r.why });
      const s = guardsFor(z) || {};
      const ticked = (Array.isArray(s.kinds) ? s.kinds : []).filter(Boolean);
      // ⚠ BOTH KINDS, whatever is ticked. This button answers "what is really in this rectangle",
      // and the kind an owner did NOT tick is exactly the one they need to hear about: a naval base
      // carries fixed emplacements (`mapsentry`) and no deployed sentries at all, so surveying only
      // the ticked kinds reported zero of everything while the turrets stood there in plain sight.
      const kinds = ['sentry', 'mapsentry', 'puppet'];
      const out = [];
      // ⚠ THE SAME RULE AS THE PATROL. This button answers "what is really in this rectangle", and
      // on a server with nobody in that rectangle the honest answer is "nothing is there to look
      // at", not "there is nothing there". They are opposite findings and they render identically.
      const who = await playersNow();
      for (const rect of r.rects) {
        const radius = sphereFor(rect, s);
        for (const kind of kinds) {
          const pre = await bx('despawnPreview', kind, rect.x, rect.y, nz(s.centreZ, 0), radius);
          if (!pre || pre.error) {
            out.push({ kind, ticked: ticked.indexOf(kind) >= 0,
              error: pre ? ((pre.reason || pre.error) || 'no answer')
                : await whyNoAnswer('despawn', 'what is in this zone') });
            continue;
          }
          const all = pre.objects || [];
          out.push({
            kind,
            // Which of the two the zone is actually set to clear. A count means one thing for a kind
            // you chose and the opposite for one you did not.
            ticked: ticked.indexOf(kind) >= 0,
            found: all.length,
            // The number that matters: the sphere reaches past the corners and this is what is left
            // after the rectangle is applied. Anything else would be swept and should not be.
            inside: all.filter((o) => inRect(o, rect)).length,
            // Already under the ground, of those inside. Only a fixed sentry is ever put away.
            stowed: all.filter((o) => inRect(o, rect) && o.stowed === true).length,
            allowed: pre.allowed !== false,
          });
        }
      }
      return res.json({
        kinds: out,
        // Whether a fixed sentry can be put away here, which is a different switch from removing one.
        stow: await stowInfo(),
        playersKnown: who.known,
        playersOnline: who.known ? who.at.length : null,
      });
    });

    log.info('loot zones ready');
  },
};
