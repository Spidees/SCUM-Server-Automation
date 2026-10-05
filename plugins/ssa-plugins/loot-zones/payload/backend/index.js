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
 * **A sentry removed here comes back within seconds, and NO timer an owner can change governs that.**
 * The guarded place refills a removed sentry at its own zone tick — measured, about three seconds,
 * 464 removals in a day with the respawn delay at its shipped 600 s — so lengthening that delay does
 * not keep a removed sentry away; putting the sentry away (below) is what does. The delay
 * (`_timeToRespawnSentry` on the one `AGlobalGuardedZoneManager`) is what the bridge describes as the
 * wait before a KILLED sentry comes back; that it governs a kill, and whether a respawn already
 * scheduled picks up a new value, are not measured here. SCUM keeps one set of those numbers for
 * every guarded zone on the map — `guardedtune` takes no level argument — so changing it is a
 * server-wide change, and the property is not `SaveGame` (the bridge logs it as resetting on restart,
 * so it has to be re-applied). That is why it is an extra an owner switches on knowing what it costs.
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
  // No colour anywhere: a HUD notification reflects no colour field, and a colour prefix travels
  // through as literal text. The game's warning banner IS reachable — the bridge's notify module
  // raises it through the game's own `SendNotification` command, broadcast only, yellow and five
  // seconds hard-coded, and not yet watched on a screen — and this plugin does not offer it as a route.
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
      // `alert` on a message to ONE player is the kill feed's notification sound, the one per-player
      // sound the bridge offers (the game's per-player HUD line takes an audio asset, which the bridge
      // leaves empty) — and it sends one entry rather than two.
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
    // where the players are. 40000 is 400 m. All 94 of the game's sentry posts author an
    // `ActivationDistance` in the level data: 200 m on 7, 300 m on 56, 350 m on 5 and 500 m on 26 (B2
    // Airport, D4 Zeljava, C2 Prison, C2 Power Plant) — so 400 m is past most of them and INSIDE those
    // 26, and whether that field is what switches a post on has not been traced to its readers.
    // Floored at 50 m, capped at 2 km.
    wakeDistance: 40000,

    // How often an AWAKE zone is looked at, in seconds, floored at 3. A sentry the game has just made
    // is put away within one of these, so it is the longest a player can see one appear. Asleep, the
    // same clock only reads where the players are.
    nearbyPatrolSeconds: 5,

    // ⚠ `patrolSeconds` USED TO BE HERE AND IS NOT COMING BACK. Nothing has read it since the
    // patrol started following the players — `nearbyPatrolSeconds` is the clock, and only while
    // somebody is near — and a default is what puts a key into every NEW owner's `config.json`,
    // so leaving it there shipped a box an owner could set that changed nothing. It was kept on
    // the argument that an old configuration would otherwise "load changed", and that argument is
    // simply not true of this merge: `merge()` walks the STORED keys, so a configuration that
    // carries `patrolSeconds` still carries it, read or not. Removing the default removes it from
    // new installs and from nobody's saved settings.

    // The search is a SPHERE, so it needs a height for its centre and a vertical reach. Everything
    // outside the rectangle is discarded afterwards, so these only decide what is LOOKED at.
    //
    // ⚠ ONE NUMBER DOES BOTH, AND IT IS NOT A SUM. A sphere covers the rectangle once its radius
    // reaches the rectangle's half diagonal, and it then reaches up and down as well — at a right
    // angle to that, never added to it. So `reachZ` is what the search is ASKED for; how much of it
    // it gets is bounded by the despawn module's own ceiling on a radius, which is the owner's
    // number on that module's card. See `sphereFor`.
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
    // test server with a player standing where they stood: nothing seen, nothing heard, nothing to walk
    // into, and no replacement over the whole test.
    //
    // It lasts as long as the game keeps that place switched on. Once nobody is near, the game takes
    // its sentries away itself and makes fresh ones when somebody comes back — which is exactly when
    // this zone wakes up again and puts them away. That needs "Put fixed map sentries away instead of
    // removing them" on the bridge's Remove from the world card. A deployed `sentry` is not rebuilt by anything, so
    // it is simply removed.

    // Guards where the game put none. A rectangle over open ground has no sentries to clear, and
    // most of the island is open ground — so a zone can ask for posts of its own, laid out inside it,
    // with no sentry involved at all.
    //
    // ⚠ **NOTHING IN THIS PLUGIN PUTS A GUARD WHERE A SENTRY NEVER STOOD EXCEPT THIS NUMBER.** At 0
    // a zone keeps guards only where the game already had a sentry to clear — which is a handful of
    // military places and nowhere else on the island — so a zone drawn over a town, a field or a
    // road stood permanently empty and nothing said why. It ships non-zero for that reason: a new
    // zone anywhere on the map has places to guard from the moment it is switched on. A zone that
    // really wants sentry places only sets it back to 0, and a configuration written before this
    // carries its own value and is not touched, because the merge is by key presence.
    ownPosts: 6,

    /**
     * ── HOW LONG A GUARD OF THIS ZONE'S OWN LIVES ──────────────────────────────────────────────
     *
     * ⚠ **THE GAME'S OWN CREATURES ARE NOT THERE WHEN NOBODY IS.** Sentries, puppets, animals and
     * NPCs are made around players and taken away again once everybody has gone, and a place is
     * populated by the time somebody walks into it. A guard this plugin places directly is not
     * registered with the game at all, so none of that applies to it: it stays exactly where it
     * was put, for as long as the server runs, whether anybody is within a kilometre of it or
     * not — and, being a character with a brain, it walks. Left alone long enough, a zone's
     * garrison spreads out across the island and stops being a garrison.
     *
     * So the zone owns the lifetime rather than leaving it to the game:
     *
     *   'nearby'  the guards exist while somebody is near the zone and are taken away again
     *             once nobody is — which is how everything else in the world behaves, and is
     *             what a player meets: the zone is already guarded when they arrive, and holds
     *             nothing while they are away.
     *   'persist' once placed, they stay. What this plugin did before the choice existed, for a
     *             zone that really wants a permanent garrison.
     *
     * Only guards this plugin itself placed are ever taken away, and only by the exact id the
     * game handed back when it made each one. Nothing the game made, nothing another plugin
     * made, and nothing that merely stands in the rectangle.
     */
    ownLife: {
      mode: 'nearby',

      // How long after the last player leaves before the guards go, in seconds. Not zero: somebody
      // stepping a few metres past the edge and back must not empty the zone behind them, and a
      // reading that briefly misses a player must not either.
      sleepGraceSeconds: 20,

      // ⚠ **A GUARD THAT WALKS OUT OF THE ZONE IS NOT GUARDING IT.** Every guard type walks — a
      // drifter patrols, and a guard chasing somebody leaves its post exactly when the post
      // matters — so one that ends up outside the rectangle is taken away and its post is free to
      // be filled again. 'zone' keeps them in; 'none' lets them go where they like.
      leash: 'zone',

      // How far past the edge of the zone a guard may be before it counts as having left, in
      // centimetres. Room for a chase to spill over the line without the zone emptying itself.
      leashSlackCm: 2000,
    },

    replace: {
      // MORE THAN ONE KIND OF GUARD. A guarded place in SCUM is not one repeated figure — an outpost
      // has riflemen and something heavier, a town has a few puppets and one thing worth running
      // from — so a zone names a LIST, and each entry is a whole choice in itself:
      //
      //   { route, kind, classPath, spawnKind, spawnName, count, weight, want, label, at, andAuto }
      //
      // `at` IS WHERE IT STANDS, and it is the answer to "the guards always appear in the same
      // places". A list of `{ x, y, z, yaw, note, on }` in CENTIMETRES — the frame the game, the
      // map, the bridge and the admin console all speak — naming the places THIS guard stands.
      // Absent or empty is the zone choosing for itself, which is what every configuration
      // written before this key carries; non-empty is these places and NOWHERE ELSE, and a point
      // the game will not take is refused by name rather than moved somewhere nearby. `andAuto`
      // adds the places the zone chooses beside them. `note` is the owner's own words and is
      // never translated or rewritten; `on: false` is a point kept and not used.
      //
      // `weight` decides how often that entry is the one a post gets, against the other entries'
      // weights: two entries weighted 5 and 1 fill five posts with the first for every one of the
      // second. The share is worked out by POSITION rather than by chance, so an owner asking for one
      // heavy in six gets exactly that rather than a roll that gives them none.
      //
      // `want` is the other way of saying it: how many of THIS guard the zone should hold, as a
      // number rather than as a share. It takes its places off the top — `ceil(want / count)` of
      // them — and whatever is left over is shared by weight among the entries that named no number.
      // ABSENT OR 0 IS EXACTLY THE BEHAVIOUR ABOVE, which is what every configuration written before
      // this key existed carries. `maxGuards` still caps the whole zone above both of them.
      //
      // Empty means the single choice below, which is what every configuration written before this
      // list existed carries. Nothing an owner already set changes meaning.
      types: [],

      /**
       * ── WHEN, ON THE GAME'S OWN CLOCK ────────────────────────────────────────────────────────
       *
       * "Guards only after dark" is a sentence about the world a player is standing in, and the
       * world's clock is not this machine's. `src/plugins/timeWindows.js` is the manager's other
       * window and it uses the SERVER's clock on purpose — its own header argues why, and every
       * word of that argument is still right for a rental: a game clock has no day of the week, it
       * runs at a multiplier an owner can change, and it cannot be read with the server down. That
       * same header then names this one as *"a different feature, not a mode of this one"*, and
       * this is that feature.
       *
       * ⚠ **THE UNIT IS GAME HOURS AND IT IS SAID OUT LOUD EVERYWHERE THIS NUMBER TRAVELS.** This
       * tree has shipped three duration bugs from a bare number on a screen — the weather roll
       * intervals everyone read as seconds and that are GAME MINUTES, an autosave in real seconds
       * beside them, and two trade intervals on one card running at different multiples of the
       * clock. `fromHour` and `toHour` are whole hours on the game's own 0..24 clock, `from`
       * inclusive and `to` exclusive, and every payload that carries them carries the unit.
       *
       * A window that runs past midnight is the ordinary case — 21 to 5 is "at night" — so
       * `from > to` WRAPS. `0` to `24` is the default and is always open; so is any window where
       * the two are equal, because "from 5 to 5" is a thing nobody means and refusing it outright
       * would disarm a zone over a typo.
       *
       * ⚠ **AND WHEN THE CLOCK CANNOT BE READ THE WINDOW IS NOT IN FORCE.** The reading comes from
       * the bridge's `live` module with its "Time of day" switch on; with either off there is no
       * clock, and the two ways to be wrong are not equal. Treating an unreadable clock as CLOSED
       * disarms every zone on the server the moment a switch is off, silently, which is the shape
       * this product calls "a zone that quietly disarms itself". Treating it as OPEN is exactly
       * what the zone did before anybody set a window. So it stays open, the patrol says the clock
       * could not be read and the window is not being applied, and the card repeats it every round.
       */
      gameTime: { enabled: false, fromHour: 0, toHour: 24 },


      // 'spawn' puts a guard there directly. It works on an empty server, it hands back an id — which
      // is the only reason a post can be CHECKED afterwards — and it is gone at the next restart, so
      // the patrol simply fills every post again. 'persistent' goes through the game's own spawn
      // command instead (SCUM makes it as one of its own, though whether one survives a restart has
      // not been measured for a creature), and it answers with no identifier at all, so a
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

      // How long a guard stands on one place the ZONE chose before that place moves elsewhere in the
      // zone, in seconds. 0 is never, which is what every configuration written before this carries.
      // A killed guard's place moves whatever this says; this is for the guard nobody has touched.
      moveAfterSeconds: 0,

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

  // ── how busy the zone is, through the game's own population layer ────────────────────────────
  //
  // This is the OTHER creature question and it is not the guards above. A guard is one character in
  // one place and the game has no way to author that, which is why it needs the spawn route and an
  // online player. How busy a PLACE is IS authored: SCUM keeps its whole population plan in one
  // cooked asset and the running server re-reads it, so this reaches the game with nobody online at
  // all.
  //
  // ⚠ **What it cannot do is make a place busy while nobody is there.** The game never places a
  // creature: it authors a place and spawns when a player comes near it. Every screen this plugin
  // draws about this says so.
  //
  // ⚠ **And a schedule is SHARED by every place of its kind** — the island's 294 places run on 27
  // of them — so turning one village up turns villages up. The tab counts that before an owner
  // chooses anything and `maxPlaces` is where they can put a ceiling on it.
  activity: {
    // 'leave' is the shipped value and touches nothing at all, which is what makes this additive:
    // every zone configured before this existed goes on behaving exactly as it did.
    mode: 'leave',           // 'leave' | 'busier' | 'quieter'
    // Of what the GAME authored, never of what it says right now — a percentage of the current
    // value compounds every tick. 100 is the game's own balance and is a real choice.
    percent: 200,
    // How often the game rolls the spawn chance, in REAL seconds. 0 leaves the game's own roll
    // alone, which is what an owner who only wants a different chance should have. The game
    // authors 300-600 s; the longest end is set to twice this.
    checkSeconds: 0,
    // Refuse to change a kind of place that more than this many places on the island share. 0 is no
    // ceiling. It is here because the spill is the one thing about this feature nobody can design
    // away, and an owner who only wants their own corner touched needs a way to say so.
    maxPlaces: 0,
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
     * The half of a bridge actor id that the `entities` module's `entity:` read wants.
     *
     * ⚠ **THREE MODULES SPELL ONE ACTOR THREE WAYS AND ONLY ONE OF THEM TAKES A SERIAL.**
     * `despawn` and `spawn` say `<slot>.<serial>`; `entities` says `<slot>` and reads a dot as the
     * start of a PROPERTY PATH, so handing it the whole id is refused with "has no property called
     * '<serial>'", measured against the shipping bridge. Losing the serial there is safe
     * and nowhere else: `mod_entities` pins its own serial when it first indexes an object and
     * refuses a recycled slot, which is the guarantee `isOwnGuard` has to make for itself.
     *
     * One function so the trim happens where it is explained, rather than as a `split` at each
     * call site that reads like the id simply being tidied up.
     */
    const entitySlot = (id) => String(id == null ? '' : id).split('.')[0];

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

    /**
     * ── ONE BRIDGE READ, WITH THE REASON ATTACHED ────────────────────────────────────────────────
     *
     * ⚠ **`host.bridge.data()` ANSWERS `null` FOR THREE DIFFERENT FACTS AND EVERY SCREEN IN THIS
     * PLUGIN READ IT AS ONE.** *The bridge is not there*, *the module is switched off* and *the
     * module refused, in its own words* all collapse into that one value, and the real sentence is
     * written to the manager's log where a plugin cannot reach it. So `rate_limited`, a class path
     * that does not resolve, a point outside the map and the bridge's own **Bosses** switch being
     * off all reached an owner's card as *"the bridge did not answer"* — while the Bridge card at
     * the top of the same tab said everything was on. Nothing on the page could be acted on.
     *
     * `host.bridge.query(module, wire)` has always answered `{ ok, data, code, reason, error }`
     * instead, with `code` one of `bridge_off` / `no_module` / `module_off` / `refused` and the
     * module's own sentence in `reason`. `readZones()` below has used it since it was written; this
     * is the same door for every other read, so the wire strings live in ONE table rather than being
     * spelled out at fourteen call sites.
     *
     * ⚠ **IT RAISES NO MINIMUM.** `query()` shipped in manager 5.0.3 and this plugin already
     * declares 5.16.2, so every install that can run this build has it. The `bx()` fallback below is
     * kept anyway — a host is whatever the owner has, and a plugin that assumes otherwise is the
     * `typeof === 'function'` guard this product already has a rule about.
     *
     * The wire strings are copied from `src/plugins/host.js`'s own wrappers, which is where they are
     * built today; `check-loot-zones` drives every one of them against a mock that parses the wire,
     * so a spelling that drifts is a failure here rather than a refusal on somebody's live server.
     */
    const WIRE = {
      whereIs: ['place', (x, y, z) => `where:${Number(x)},${Number(y)},${Number(z)}`],
      livePlayers: ['live', () => 'players'],
      world: ['live', () => 'world'],
      entity: ['entities', (id) => `entity:${String(id)}`],
      despawnKinds: ['despawn', () => 'kinds'],
      despawnPreview: ['despawn', (kind, x, y, z, r, id) => {
        const w = `preview:${String(kind)}:${Number(x)},${Number(y)},${Number(z)},${Number(r)}`;
        return id ? `${w}:${String(id)}` : w;
      }],
      spawnAt: ['spawn', (kind, x, y, z, yaw, pitch, roll, cls) => `spawn:${String(kind)}:${Number(x)},`
        + `${Number(y)},${Number(z)}:${Number(yaw)},${Number(pitch)},${Number(roll)}:${String(cls)}`],
      spawnPersistent: ['spawn', (kind, x, y, z, count, type) => `persistent:${String(kind)}:`
        + `${Number(x)},${Number(y)},${Number(z)}:${Number(count)}:${String(type)}`],
      encounterPlaces: ['encounters', () => 'places'],
      guardedZones: ['zones', () => 'guarded'],
    };

    /**
     * `{ ok, data, code, reason }` for one bridge read. Never throws, exactly as `bx` never does.
     *
     * `reason` is the MODULE'S OWN sentence where it gave one, and `null` where it did not — a
     * caller that wants words for a screen reads `whyOf()` below, which turns the other two codes
     * into the sentence this plugin already has for them.
     */
    async function bq(verb) {
      const args = Array.prototype.slice.call(arguments, 1);
      const spec = WIRE[verb];
      const q = host.bridge && host.bridge.query;
      if (spec && typeof q === 'function') {
        let r = null;
        try {
          r = await Promise.resolve(q.call(host.bridge, spec[0], spec[1].apply(null, args))).catch(() => null);
        } catch { r = null; }
        if (!r) return { ok: false, data: null, code: null, reason: null };
        if (r.ok !== true) {
          return { ok: false, data: null, code: r.code || null, reason: r.reason || null, error: r.error || null };
        }
        return { ok: true, data: unwrap(verb, r.data), code: null, reason: null };
      }
      // A host with no `query` — older than 5.0.3, which this plugin's own minimum already rules
      // out. The wrapper answers the same data and cannot say why, which is the state this whole
      // helper exists to leave behind.
      const d = await bx.apply(null, [verb].concat(args));
      if (d == null) return { ok: false, data: null, code: null, reason: null };
      return { ok: true, data: d, code: null, reason: null };
    }
    /**
     * ⚠ **ONE READ IS NOT THE SHAPE ITS WRAPPER HANDS BACK, AND GOING ROUND THE WRAPPER LOSES IT.**
     * `host.bridge.livePlayers()` accepts BOTH shapes the bridge has ever sent — a bare array and a
     * `{ players: [...] }` object — because a manager and a DLL are updated separately and an owner
     * runs whichever pair they have. Reading the wire directly here would answer `null` on one of
     * the two and fall through to "nobody could be read", which is the exact failure that wrapper
     * records in its own comment.
     */
    function unwrap(verb, d) {
      if (verb !== 'livePlayers') return d;
      if (Array.isArray(d)) return d;
      return (d && Array.isArray(d.players)) ? d.players : null;
    }
    /** The reason, in words, whatever the bridge managed to say. For a screen, never for a branch. */
    async function whyOf(r, moduleId, what) {
      if (r && r.reason) return String(r.reason);
      return whyNoAnswer(moduleId, what);
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
    /**
     * ⚠ **"THERE IS NO CONFIGURATION" AND "I COULD NOT READ THE CONFIGURATION" ARE OPPOSITES, AND
     * `host.config.get()` SPELLS BOTH `{}`.** It is a `safe()` wrapper over a file read, so a
     * library copy that is missing, half-written, locked or truncated comes back empty — which is
     * exactly what an owner who has configured nothing looks like.
     *
     * For READING that does not matter: the defaults are merged in and the plugin behaves as it
     * ships. For a WRITE it is the whole ball game — `POST /config` lays a partial body over what
     * is stored, so one flaky read turns "save this checkbox" into "delete every zone, every
     * message and every guard", answered `{ ok: true }`. That is the `readJson(path, {})` shape
     * this product already has a gate for, one layer out, on a merge target.
     *
     * This is the half a plugin can answer: once a real configuration has been read IN THIS
     * PROCESS, an empty one afterwards is a failed read and not an owner who emptied it — because
     * `host.config.set()` always writes the whole merged object, so the file is never `{}` again
     * after the first save. In memory deliberately: a stored flag goes STALE rather than absent,
     * and a fresh process has read nothing and must not refuse a first-ever save.
     */
    let sawConfig = false;
    const cfg = () => {
      const stored = host.config.get() || {};
      if (stored && typeof stored === 'object' && Object.keys(stored).length) sawConfig = true;
      return merge(stored, DEFAULTS);
    };

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

    /**
     * ⚠ **A SET NAME IS A FOLDER NAME AND NEVER A PATH, AND THIS SIDE WAS THE UNGUARDED ONE.**
     *
     * The DESTINATION has always been fenced — `removeOwned` refuses anything without the
     * `LOOT_ZONES_` prefix and `ownedFolder` strips every character a folder name may not carry.
     * The SOURCE was `path.join(setsRoot(), setName)` with the name straight out of the
     * configuration, so `"set": "../../.."` reads and copies whatever `.json` files it finds
     * somewhere else on the disk into the running server's `Override/`. The configuration is
     * admin-authored, which is why it is small — but an asymmetry where one end of a copy is
     * checked and the other is not is not a thing to leave in a file that writes into a live
     * server tree.
     *
     * Two tests rather than one, because neither covers the other on Windows: the NAME must be a
     * single plain segment (no separator, no `.`/`..`, no drive letter — `C:x` resolves against
     * that drive's own working directory and is not absolute), and the RESOLVED path must still be
     * under the root, which is what catches a root that is itself unusual. `null` is the refusal
     * and every caller says so in words rather than falling back to somewhere else.
     */
    function setDirOf(setName) {
      const root = setsRoot();
      if (!root) return null;
      const n = String(setName == null ? '' : setName);
      if (!n || n === '.' || n === '..') return null;
      if (/[\\/]/.test(n) || /^[A-Za-z]:/.test(n) || path.isAbsolute(n)) return null;
      const p = path.join(root, n);
      const rel = path.relative(root, p);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
      return p;
    }
    // A set is the name of one folder inside the sets folder, never a path: a slash, a drive
    // letter or `..` is refused and nothing is read or copied.
    const NOT_A_SET_NAME = 'a loot set must be a folder name, not a path. Rename the folder and pick it again.';

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
      if (!root) return { ok: false, why: `${setName}: this manager gave the plugin no data folder to read loot sets from` };
      const dir = setDirOf(setName);
      if (!dir) return { ok: false, why: `${setName}: ${NOT_A_SET_NAME}` };
      const f = path.join(dir, 'Zones.json');
      let raw;
      try {
        raw = fs.readFileSync(f, 'utf8');
      } catch (e) {
        return { ok: false, why: `${setName}: its Zones.json could not be read (${e.code || e.message}), so the set is unusable` };
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

    /**
     * ══ THE AREA A ZONE DRAWS, WHICH IS NOT ALWAYS THE AREA ITS LOOT COVERS ══════════════════════
     *
     * A set's `Zones.json` is the GAME'S own record of where that loot applies. It is copied into
     * the server's Override folder unchanged and it stays the only thing that decides the loot —
     * nothing here rewrites it, and nothing here can widen what the loot change touches.
     *
     * What a zone DRAWS is a different question: the rectangle players see on their map, the reach
     * that wakes the zone, the ground its guards stand on, the sweep that clears sentries out of
     * it. Wanting that to cover more ground than the loot does is the ordinary case — a whole
     * airfield marked out, with the loot change on the handful of buildings the set names.
     *
     * So each zone may carry an `area`:
     *
     *   mode    'file'   the set's own corners, which is what every zone written before this
     *                    carries and what an absent block means. Nothing changes.
     *           'custom' the numbers below decide the area that is drawn.
     *   shape   'rect' | 'circle'
     *   x, y    the centre, in centimetres
     *   sizeX   HALF the width, and `sizeY` HALF the height, in centimetres
     *   radius  the radius, in centimetres, for a circle
     *
     * ⚠ **A SIZE IS HALF A SPAN, AND A CIRCLE'S RADIUS IS THE SAME MEASUREMENT.** That is the
     * game's own convention — `FCustomZoneRegion::Size` is measured from the centre outwards on
     * each axis — and reading it as a whole span draws every zone at twice the size that was
     * asked for, which looks perfectly ordinary on a map and is out by hundreds of metres on the
     * ground. Everything inside this plugin works in a centre and a WHOLE span, so the two are
     * converted here, in one place, and nowhere else.
     *
     * A circle is carried as its own bounding box as well, so anything measuring how far a sweep
     * has to reach gets an answer without knowing about shapes; the three tests that decide
     * whether a point is INSIDE — `inRect`, `rectDistance` and `placeTouches` — ask the shape.
     */

    // Bounds on the FIELD, never on the island: a box left empty, a stray zero, a number that
    // overflowed. Where the map ends is the game's own question, and `withinMapLimits` — which
    // `areaOnMap` below asks for — is the only thing that can answer it. Nothing here is a limit
    // of the world's, and no limit of the world's is ever derived in this plugin.
    const AREA_MAX_COORD_CM = 10000000;
    const AREA_MAX_HALF_CM = 2000000;

    /** The zone's own `area` block when it really asks for one, else null. */
    function areaOf(entry) {
      const a = entry && entry.area;
      if (!a || typeof a !== 'object') return null;
      return String(a.mode || 'file') === 'custom' ? a : null;
    }

    /**
     * The one rectangle or circle a custom area asks for — or a refusal, in words.
     *
     * ⚠ **REFUSED, NEVER REPAIRED.** A half-typed area is a row somebody started and has not
     * finished, and guessing what they meant draws a zone somewhere they did not choose: on a map
     * players read, with loot, guards and a sweep attached to it. `Number('')` is 0 and 0,0,0 is a
     * real place on this island, so an empty box is caught rather than accepted.
     */
    function customRect(entry) {
      const a = areaOf(entry);
      if (!a) return null;
      const shape = String(a.shape || 'rect') === 'circle' ? 'circle' : 'rect';
      const x = Number(a.x);
      const y = Number(a.y);
      const bad = (why) => ({ ok: false, why });
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return bad('the zone centre needs two numbers, in centimetres, or use the loot set\'s own area.');
      }
      if (Math.abs(x) > AREA_MAX_COORD_CM || Math.abs(y) > AREA_MAX_COORD_CM) {
        // Over a hundred kilometres from the origin: a typo, not a place. Nothing is drawn.
        return bad(`the zone centre ${Math.round(x)}, ${Math.round(y)} is off the map. `
          + 'Stand at the middle of the zone and take your position.');
      }
      if (shape === 'circle') {
        const r = Number(a.radius);
        if (!Number.isFinite(r) || r <= 0) {
          return bad('the circle has no radius. Fill the radius in, in centimetres.');
        }
        if (r > AREA_MAX_HALF_CM) {
          return bad(`a radius of ${Math.round(r / 100)} m is wider than the island. `
            + 'The radius is in centimetres: 1 km is 100000.');
        }
        return { ok: true, rect: { x, y, shape: 'circle', radius: r, width: r * 2, height: r * 2 } };
      }
      const sx = Number(a.sizeX);
      const sy = Number(a.sizeY);
      if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) {
        // A rectangle with no height is read back by the game as a circle, so nothing is drawn.
        return bad('both rectangle sizes are needed: half the span, in centimetres (400 m across is 20000).');
      }
      if (sx > AREA_MAX_HALF_CM || sy > AREA_MAX_HALF_CM) {
        return bad(`a ${Math.round(sx * 2 / 100)} m by ${Math.round(sy * 2 / 100)} m rectangle is `
          + 'larger than the island. Each size is half the span in centimetres: 400 m is 20000.');
      }
      return { ok: true, rect: { x, y, shape: 'rect', width: sx * 2, height: sy * 2 } };
    }

    /**
     * The area a zone WORKS IN, which is what every reader below this line wants.
     *
     * The set is read first and refused first whatever the area says, because the loot is the
     * set's own and a set whose `Zones.json` cannot be read cannot be switched on at all. Only
     * then does a custom area replace the geometry.
     *
     * `source` travels with it — `'file'` or `'custom'` — so a screen can say which of the two an
     * owner is looking at rather than leaving them to work it out from the numbers.
     */
    function zoneRects(entry) {
      const r = readRect(entry && entry.set);
      if (!r.ok) return Object.assign({}, r, { source: 'file' });
      const c = customRect(entry);
      if (!c) return { ok: true, rects: r.rects, count: r.rects.length, source: 'file' };
      if (!c.ok) return { ok: false, why: `${entry.name || entry.set}: ${c.why}`, source: 'custom' };
      return { ok: true, rects: [c.rect], count: 1, source: 'custom', lootRects: r.rects };
    }

    /**
     * ── IS THE AREA SOMEBODY TYPED ACTUALLY ON THE MAP? ──────────────────────────────────────────
     *
     * ⚠ **THE GAME IS THE ONLY AUTHORITY ON WHERE THE WORLD ENDS, AND NOTHING HERE DERIVES ONE.**
     * The island is not a rectangle: two of its four sides are tables of segments, so the limit on
     * one axis moves with the other, and a single number for either is wrong somewhere. The game
     * answers `withinMapLimits` for a POINT and that is the whole of what can be relied on.
     *
     * ⚠ **THE CENTRE DECIDES AND THE EDGES ONLY REPORT.** A centre off the map is a typed number
     * rather than a place — a decimal point in the wrong column, a sign flipped — and nothing good
     * comes of drawing it. An area that merely SPILLS over the edge is an ordinary coastal zone
     * whose corner is out at sea, and refusing the whole thing over it would disarm a zone that
     * works. So the corners are reported and the centre is the verdict.
     *
     * ⚠ **AND "COULD NOT ASK" IS NEITHER.** The reading needs the bridge's Where am I module, and a
     * zone that stops drawing itself because a module is off is a zone that quietly disarms. An
     * unanswered check draws the area and says the check could not be made.
     *
     * Cached on the geometry itself, so an area nobody has edited is asked about once: the ground
     * does not move, and the answer is only ever re-asked for a different set of numbers.
     */
    const AREA_MAP_CACHE_MS = 30 * 60000;
    const areaMapSeen = new Map();
    const areaKeyOf = (rects) => (rects || [])
      .map((r) => `${shapeOf(r)}:${Math.round(nz(r.x, 0))},${Math.round(nz(r.y, 0))},`
        + `${Math.round(halfOf(r).w)},${Math.round(halfOf(r).h)}`).join('|');

    /** The points that decide it: the centre, then the extremes of the shape. */
    function areaProbePoints(r) {
      const cx = nz(r.x, 0);
      const cy = nz(r.y, 0);
      if (r.shape === 'circle') {
        const rad = Math.abs(nz(r.radius, 0));
        return [{ x: cx, y: cy, centre: true }, { x: cx + rad, y: cy }, { x: cx - rad, y: cy },
          { x: cx, y: cy + rad }, { x: cx, y: cy - rad }];
      }
      const hw = nz(r.width, 0) / 2;
      const hh = nz(r.height, 0) / 2;
      return [{ x: cx, y: cy, centre: true },
        { x: cx - hw, y: cy - hh }, { x: cx + hw, y: cy - hh },
        { x: cx - hw, y: cy + hh }, { x: cx + hw, y: cy + hh }];
    }

    async function areaOnMap(rects) {
      const key = areaKeyOf(rects);
      const hit = areaMapSeen.get(key);
      if (hit && Date.now() - hit.at < AREA_MAP_CACHE_MS) return hit.v;
      let why = null;
      const outside = [];
      let centreOutside = false;
      let asked = 0;
      for (const r of rects || []) {
        for (const p of areaProbePoints(r)) {
          // ⚠ SERIAL. The bridge's own limiter is fifteen calls a second with a burst of thirty,
          // and everything else in this plugin already goes one at a time for that reason.
          const q = await bq('whereIs', Math.round(p.x), Math.round(p.y), nz(cfg().sentries && cfg().sentries.centreZ, 0));
          if (!q.ok) { why = why || await whyOf(q, 'place', 'whether a point is on the map'); continue; }
          const w = q.data;
          if (!w || w.error) { why = why || ((w && (w.reason || w.error)) || NO_BRIDGE_ANSWER); continue; }
          if (typeof w.withinMapLimits !== 'boolean') {
            why = why || 'the game did not say whether that point is inside the map';
            continue;
          }
          asked++;
          if (w.withinMapLimits === false) {
            outside.push({ x: Math.round(p.x), y: Math.round(p.y) });
            if (p.centre) centreOutside = true;
          }
        }
      }
      // Nothing answered at all: neither verdict, and nothing is cached — half an hour of a
      // remembered non-answer is half an hour that cannot recover when the module comes back on.
      if (!asked) return { known: false, why: why || NO_BRIDGE_ANSWER };
      const v = {
        known: true,
        inside: !centreOutside,
        centreOutside,
        outside,
        why: centreOutside
          // Only the game can answer this for a point: the island is not a rectangle. Nothing drawn.
          ? 'the zone centre is outside the map. Stand at the middle of the zone and take your position.'
          : (outside.length
            // An ordinary coastal zone: it is drawn, and nothing is ever placed past the edge.
            ? `${outside.length} corner(s) of this zone are outside the map; nothing is placed out there.`
            : null),
      };
      areaMapSeen.set(key, { at: Date.now(), v });
      return v;
    }

    /**
     * The custom area's verdict for a zone that is about to be drawn: `null` when there is nothing
     * to refuse. A zone on the set's own corners is never asked — those came out of the file the
     * game itself reads.
     */
    async function areaRefusal(entry, r) {
      if (!r || r.source !== 'custom') return null;
      const v = await areaOnMap(r.rects).catch(() => null);
      if (!v || !v.known || v.inside) return null;
      return `${entry.name || entry.set}: ${v.why}`;
    }

    /**
     * Every set on disk: a folder with a Zones.json in it.
     *
     * ⚠ **"THERE IS NO SETS FOLDER" AND "I COULD NOT READ THE SETS FOLDER" ARE OPPOSITE FACTS AND
     * THIS ANSWERED BOTH WITH ONE `readable: false`.** The screen then told an owner whose folder
     * is right there — held open by a backup, denied by an ACL, on a network share that has gone
     * away — to *create* it, which is advice they cannot act on about a state they are not in. It
     * is this project's most-repeated defect, in a plugin whose three-state discipline is otherwise
     * good, and it costs one field: `missing` is `true` only for ENOENT, `false` for a folder that
     * exists and would not open, and the failure's own code travels in `why` so the sentence on
     * the card can name it.
     */
    function listSets() {
      const root = setsRoot();
      if (!root) return { root: '', sets: [], readable: false, missing: null, why: null };
      let names = [];
      try {
        names = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
      } catch (e) {
        const code = String((e && e.code) || '');
        return { root, sets: [], readable: false, missing: code === 'ENOENT', why: code || (e && e.message) || null };
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
    /**
     * When each zone was first seen with nobody near it, and whether its own guards have already
     * been taken away for this sleep. IN MEMORY, deliberately: both are facts about what THIS
     * process has watched, and a stored one goes STALE rather than absent — a manager that restarts
     * has watched nothing, and starting the grace period again is exactly right for it.
     */
    const asleepSince = {};
    const sweptAsleep = {};
    // What the last sleep sweep of each zone did, carried on every asleep row until the zone wakes.
    const sleepReport = {};
    // Guards that walked out of each zone since it last woke, and when the latest one did.
    const strayedSinceWake = {};

    const K = {
      active: 'active', lastSwitch: 'lastSwitchMs', turn: 'restartTurn',
      reminded: 'lastReminderMs', swept: 'lastGuardSweepMs', posts: 'guardPosts',
      // Where the sentries a zone cleared stood, per zone. Counted, never guarded: each one is one
      // more guard at a place of the zone's own choosing.
      sentrySeen: 'sentrySeen',
      respawnSet: 'globalRespawnSet', respawnWas: 'globalRespawnWas',
      /**
       * ⚠ **THE PLACES A ZONE CHOOSES FOR ITSELF — found once, kept for good. See `fillPool`.**
       * In the store rather than in a closure because finding ONE costs five bridge calls and about
       * a third of a second, measured; a manager restart that forgot them would spend half a minute
       * of the bridge's own rate limit rediscovering geometry that has not moved since the map was
       * built. It is also what makes a post stay where a player last saw it.
       */
      pool: 'guardPool',
      // Which zone the CURRENT server session picked. A manager that restarts under a running server
      // re-applies this rather than advancing, so its own restart never moves the loot.
      sessionPick: 'sessionPick',
      // What the last patrol of each zone actually saw. On the screen, because the bridge logs
      // commands and not reads: a patrol that found nothing is otherwise invisible.
      lastPatrol: 'lastPatrol',
      // The two halves of "is the loot live, or is it waiting for a restart" — the question the
      // reload command answers when it can be sent (bridge 2.22.2 or newer, server running). SCUM
      // reads its Loot folder at STARTUP and otherwise only when that command runs, so without a
      // reload what matters is which of the two happened last: this plugin writing the files, or the
      // game coming up and reading them. ⚠ `serverUpAt` is ABSENT on a manager that was started over an already-running server,
      // and absent is reported as not knowing rather than filled in.
      // When each zone last really sent a guard — the zone's own cooldown clock.
      lastGuardAt: 'lastGuardAtMs',
      // Guards seen DEAD, per zone, by actor id, with when they were first seen dead. What makes the
      // respawn delay apply to a kill and not to a guard the game took away.
      kills: 'guardKills',
      // Which spawn schedules THIS PLUGIN has changed, by asset name. The bridge keeps its own
      // record and would put everything back on one call, but that set is not the same set: the
      // panel and another plugin reach the same verb. This is what makes the restore by NAME.
      activitySet: 'activitySet',
      lootWrittenAt: 'lootWrittenAtMs',
      // Which way the waiting change goes: 'on' (richer loot coming) or 'off' (normal loot back).
      lootPendingKind: 'lootPendingKind',
      // When the running game last reloaded its Loot folder on this plugin's say-so.
      lootReloadedAt: 'lootReloadedAtMs',
      /**
       * ⚠ **THE NAMES THIS PLUGIN REALLY WROTE ON THE MAP, per zone — the LEDGER.**
       *
       * Every removal used to REBUILD the name out of the prefix, the zone's own name and how many
       * rectangles its `Zones.json` had at the time. That is a guess about the past made out of the
       * present, and it is wrong the moment any of the three moves: rename the prefix and the delete
       * aims at a name nothing ever drew; rename the zone, the same; go from three rectangles to one
       * and "X 1", "X 2" and "X 3" stay on the map while "X" is deleted.
       *
       * A count is not a record. This IS the record — what was written, written down — so a removal
       * derives nothing. It lives in the store, so it survives a manager restart and a crash, and it
       * holds the name that is really on the map, so it survives every rename.
       *
       * Shape: `{ "<zoneId>": { set, names: [ … ] } }`. A name leaves it only when the game has been
       * seen not to have it any more — because it was deleted, or because the game says it is gone.
       */
      drawn: 'drawnZoneNames',
      /**
       * ⚠ **A REMOVAL THAT DID NOT LAND IS OWED, AND THE DEBT IS KEPT HERE.** A switch made as the
       * server goes down can find neither route open — the bridge is gone and the game has not let
       * go of its save yet — and the old rectangle then stayed on the map for the whole next session,
       * because the sweep that would have taken it ran once per manager process and had already run.
       * Set whenever a removal or a sweep could not finish, cleared only by a sweep that read a
       * real zone list and removed everything of ours that was not wanted. In the store, so a
       * manager restart does not forget what it still owes.
       */
      sweepDue: 'zoneSweepDue',
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

    /**
     * Start a run with no post believing it knows who is standing on it.
     *
     * Nothing this plugin places directly is registered with SCUM, so a SERVER restart takes every
     * guard and voids every id with it. A post still carrying one would be asked about, get no
     * answer, and fall through to reading whatever happens to be standing there — so they start
     * empty, which is what they really are.
     *
     * ⚠ **BUT A MANAGER RESTART IS NOT A SERVER RESTART, AND NOTHING HERE CAN TELL THEM APART AT
     * BOOT.** A manager restarted under a running game meets its own garrison still standing, and
     * an id thrown away is the only thing that could ever have named it — the zone would then go
     * on counting those guards (the census sees them) and be permanently unable to take any of
     * them away again, which is exactly the state the whole lifetime half exists to end.
     *
     * So the ids are SET ASIDE rather than destroyed. `ids` is what a post believes is standing on
     * it and is cleared; `wasIds` is what this plugin once placed and may still remove, which
     * costs nothing to be wrong about: an id carries the serial Unreal allocated, and the bridge
     * refuses a slot whose serial has moved on — so a stale one can only ever fail, never land on
     * whatever took its place. It is dropped the first time the sweep really looks for it.
     */
    function forgetGuardIds() {
      const all = host.store.get(K.posts, {});
      if (!all || typeof all !== 'object') return;
      const next = {};
      let moved = false;
      for (const id of Object.keys(all)) {
        next[id] = (Array.isArray(all[id]) ? all[id] : []).map((p) => {
          const had = uniq((Array.isArray(p && p.ids) ? p.ids : []).concat(Array.isArray(p && p.wasIds) ? p.wasIds : []));
          if (p && Array.isArray(p.ids) && p.ids.length) moved = true;
          return Object.assign({}, p, { ids: [], wasIds: had, emptySince: 0, everHeld: false });
        });
      }
      if (moved) host.store.set(K.posts, next);
    }

    /**
     * Start a run with no post resting on an old refusal. A refusal is an answer about the world and
     * the plugin as they were, and a new plugin version or a restarted manager may answer it: a post
     * left resting on "not loaded yet" from an older version stayed empty for up to ten minutes after
     * the fix was installed, still showing the old sentence.
     */
    function forgetRefusals() {
      const all = host.store.get(K.posts, {});
      if (!all || typeof all !== 'object') return;
      const next = {};
      let moved = false;
      for (const id of Object.keys(all)) {
        next[id] = (Array.isArray(all[id]) ? all[id] : []).map((p) => {
          if (!p || !(nz(p.refusedUntil, 0) || nz(p.refused, 0))) return p;
          moved = true;
          return Object.assign({}, p, { refused: 0, refusedUntil: 0, refusedWhy: '' });
        });
      }
      if (moved) host.store.set(K.posts, next);
    }
    // At load, before the first patrol, so the first round already tries.
    forgetRefusals();

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

    // ── the ledger: what this plugin really drew ─────────────────────────────────────────────────
    /**
     * Whether the sweep has ever really RUN in this process — in memory, deliberately.
     *
     * A fact about what this process has done must not outlive it: a stored one goes STALE rather
     * than absent, and a manager that restarts is a manager that has checked nothing.
     */
    let sweptOnce = false;
    const uniq = (list) => Array.from(new Set((list || []).map((n) => String(n)).filter(Boolean)));

    function ledger() {
      const v = host.store.get(K.drawn, {});
      return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    }
    /** The names the ledger holds for one zone — the ones it was really drawn under. */
    function drawnNames(entry) {
      const rec = ledger()[String(entry && entry.id)];
      return (rec && Array.isArray(rec.names)) ? uniq(rec.names) : [];
    }
    /** Every name in the ledger, whatever zone it belongs to. What the sweep calls ours. */
    function allDrawnNames() {
      const all = ledger();
      const out = [];
      for (const id of Object.keys(all)) {
        const rec = all[id];
        if (rec && Array.isArray(rec.names)) out.push(...rec.names);
      }
      return uniq(out);
    }
    /**
     * Write down names this plugin has just put on the map.
     *
     * A UNION rather than a replacement, deliberately: a zone can be drawn one rectangle at a time
     * across several ticks, and it can be drawn AGAIN under a new name after a rename while the old
     * one is still standing. Forgetting the old one there is exactly how it becomes an orphan.
     */
    function noteDrawn(entry, names) {
      const add = uniq(names);
      if (!add.length) return;
      const all = ledger();
      const id = String(entry && entry.id);
      const rec = all[id] && typeof all[id] === 'object' ? all[id] : {};
      const next = uniq((Array.isArray(rec.names) ? rec.names : []).concat(add));
      if (Array.isArray(rec.names) && next.length === rec.names.length
        && next.every((n, i) => n === rec.names[i])) return;          // nothing new: no store write
      all[id] = { set: (entry && entry.set) || rec.set || null, names: next };
      host.store.set(K.drawn, all);
    }
    /** Take names out of the ledger — they are off the map, or the game says it never had them. */
    function forgetDrawn(entry, names) {
      const gone = new Set(uniq(names));
      if (!gone.size) return;
      const all = ledger();
      const id = String(entry && entry.id);
      const rec = all[id];
      if (!rec || !Array.isArray(rec.names)) return;
      const left = rec.names.filter((n) => !gone.has(String(n)));
      if (left.length === rec.names.length) return;
      if (left.length) all[id] = { set: rec.set || null, names: left }; else delete all[id];
      host.store.set(K.drawn, all);
    }
    /** The same, for a name the sweep removed and which may belong to any zone or to none. */
    function forgetDrawnAnywhere(names) {
      const gone = new Set(uniq(names));
      if (!gone.size) return;
      const all = ledger();
      let moved = false;
      for (const id of Object.keys(all)) {
        const rec = all[id];
        if (!rec || !Array.isArray(rec.names)) { delete all[id]; moved = true; continue; }
        const left = rec.names.filter((n) => !gone.has(String(n)));
        if (left.length === rec.names.length) continue;
        moved = true;
        if (left.length) all[id] = { set: rec.set || null, names: left }; else delete all[id];
      }
      if (moved) host.store.set(K.drawn, all);
    }
    /**
     * The names the CURRENT configuration would produce for one zone.
     *
     * The floor under the ledger, and nothing more: it is what a zone drawn by a version older than
     * the ledger has, and it is the reading that goes wrong on a rename. Never used on its own to
     * decide that something is ours — only to widen what a removal tries, against a live set that
     * then says which of them really exist.
     */
    function derivedNames(entry) {
      const n = Math.max(1, nz(entry && entry.rectCount, 1));
      const out = [];
      for (let i = 0; i < n; i++) out.push(zoneNameAt(entry, i, n));
      if (n > 1) out.push(zoneNameFor(entry));         // the bare name a one-rectangle draw used
      return uniq(out);
    }
    /** The subset of `names` the game really holds, or NULL when its set could not be read. */
    function presentNames(live, names) {
      if (!live || live.known !== true) return null;
      const have = new Set((live.zones || []).map((z) => String(z && z.name)));
      return uniq(names).filter((n) => have.has(n));
    }

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
    // ⚠ NO ENGLISH LABEL. This plugin's own controls are translated into eighteen languages, so
    // quoting one here is a sentence that is correct only for an English reader — and this
    // sentence reaches the card through a slot that does not translate. It names WHERE rather
    // than WHAT, which is true whatever language the box is drawn in.
    // The prefix is the only thing that tells this plugin's zones apart from ones drawn by hand;
    // blank, every zone on the server would count as ours.
    const NO_PREFIX = 'the zone name prefix is empty. Fill it in where this tab sets up the rectangle.';
    const zoneNameFor = (entry) => safeZoneName(`${cfg().zone.namePrefix}${entry.name || entry.set}`);
    const zoneNameAt = (entry, i, count) => safeZoneName(count > 1 ? `${zoneNameFor(entry)} ${i + 1}` : zoneNameFor(entry));
    /**
     * ⚠ **THE FOLDER A SET'S LOOT LIVES IN, AND IT USED TO BE A MANY-TO-ONE MAP.**
     *
     * A folder name may only carry `A-Z a-z 0-9 . _ -`, so every other character was replaced with
     * `_` — which makes `My Set` and `My_Set` the SAME folder. Two sets in one configuration, one
     * folder: switching the first off calls `removeOwned` and deletes the SECOND one's live loot,
     * and `reconcile`'s stray sweep cannot see it either, because by its own arithmetic the folder
     * belongs to a believed zone. It writes into the running server's tree, so it is worth closing
     * even though it takes two oddly-named sets to reach.
     *
     * **The disambiguator is added only where the name really was rewritten**, which is what keeps
     * this additive: a set whose name is already a legal folder name — which is very nearly all of
     * them — gets byte for byte the folder it has today, so no owner's live loot moves on an
     * update. Only the names that were at risk change, and those are the ones whose current folder
     * is ambiguous anyway. FNV-1a over the ORIGINAL name, so two names that sanitise alike part
     * here; `.` is not in the alphabet a folder may carry a surprise in, so `-` joins it.
     */
    function nameTag(s) {
      let h = 0x811c9dc5;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return h.toString(16).padStart(8, '0');
    }
    const ownedFolder = (entry) => {
      const raw = String(entry.set);
      const safe = raw.replace(/[^A-Za-z0-9._-]/g, '_');
      return `${OWNED_PREFIX}${safe}${safe === raw ? '' : `-${nameTag(raw)}`}`;
    };

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
    /**
     * ⚠ **WITH THE SERVER STOPPED THERE IS NOBODY TO ASK, AND ASKING COST THE ONLY SECONDS THERE
     * WERE.** Between the game letting go of its save and the next start a restart leaves about five
     * seconds, and every bridge call made in them fails — after a timeout, and after a 1.5 s wait
     * for a reply the refused refresh was never going to send. Driven on the dev server: a rotation
     * spent six seconds asking the bridge before it reached the save, and the next server had
     * already started. So once the server is known to be down (`server:offline`, or the manager
     * about to start one) the game is not asked until it is up again.
     */
    const SERVER_DOWN_WHY = 'the server is stopped, so the game cannot be asked; the save is the route until it starts';
    let downSince = null;
    const serverDown = () => downSince != null;

    async function zoneSet(opts) {
      if (serverDown()) return { known: false, why: SERVER_DOWN_WHY };
      const first = await readZones();
      if (first && first.known === true) return first;
      if (opts && opts.noAsk) return first;
      const asked = await bx('refreshZones');
      // A refresh that was not even accepted sends no reply to wait for: say why at once. The
      // refresh's own refusal is the better sentence when there is one: it is the call that needs
      // a player, so it is the call that says so.
      if (!asked || asked.ok !== true) {
        if (asked && asked.ok === false && (asked.reason || asked.code)) {
          return Object.assign({ known: false }, first || {}, { why: asked.reason || asked.code });
        }
        // No answer at all (a bridge without the verb, or one that did not reply): one more look,
        // without the wait, for a set that arrived by itself in the meantime.
        if (!asked) {
          const again = await readZones();
          return (again && again.known === true) ? again : (again || first);
        }
        return first;
      }
      // The reply lands a frame or two later, on the game's own thread — and on a busy server or one
      // that has just started, later than that. One look at 1.5 s turned a slow answer into "the
      // game has not sent its zone list", which is what "Check against the game" then told an owner
      // standing in the game. A refresh that was ACCEPTED is worth waiting a little longer for.
      let second = null;
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        second = await readZones();
        if (second && second.known === true) return second;
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
        return 'the bridge is not answering. Check it is installed, running and switched on.';
      }
      if (on === false) {
        return `the bridge's "${moduleId}" module is switched off, so ${what} is unknown. Turn it on.`;
      }
      return `the bridge's "${moduleId}" module refused this read; the manager's log says why`;
    }

    const NO_BRIDGE_ANSWER = 'the bridge did not answer: not deployed, not running, or too old';

    // The bridge asks for the zone list through an online player, so this usually means nobody is on.
    const NOT_KNOWN = 'the game has not sent the bridge its zone list yet. Loot is live; '
      + 'the rectangle follows once a player is online.';

    /**
     * The configuration index our zones should point at.
     *
     * In `'own'` mode this is looked up BY NAME on every call and never remembered: deleting a
     * configuration renumbers every one above it, so a stored index is a number that silently starts
     * meaning something else.
     */
    /**
     * ⚠ **KEEPING ZOMBIES OUT IS A ZONE'S OWN CHOICE, SO IT CANNOT LIVE ON ONE SHARED CONFIGURATION.**
     * The availability grid rule belongs to a configuration, and every zone of this plugin used to
     * point at the same one. So a single zone set to keep zombies out, or the hidden page default,
     * blocked zombies in EVERY zone: the owner's Samobor zone, with "Keep zombies out" off, had no
     * zombies at all. A zone that keeps zombies out now points at a second configuration of its own,
     * named after the first, and every other zone at the first.
     */
    const zombiesOutFor = (entry) => {
      const s = guardsFor(entry) || {};
      return (s.mode === 'remove' || s.mode === 'replace') && Array.isArray(s.kinds) && s.kinds.includes('puppet');
    };
    const NO_ZOMBIES_SUFFIX = ' (no zombies)';

    /**
     * ⚠ **THE SWEEP DOES NOT TOUCH CONFIGURATIONS, AND THAT IS A DECISION RATHER THAN AN OMISSION.**
     *
     * They were checked for the same leak the rectangles had, and there is not one: this looks a
     * configuration up BY NAME on every call and creates it only when the name is missing, so at
     * most two can ever exist however many zones are switched on and off — the one named on the tab
     * and its `(no zombies)` twin, which is exactly the two a measured install carries.
     *
     * And deleting one is dangerous in a way deleting a rectangle is not. **`configuration_index` is
     * a POSITION, not an id**: every zone in the save carries the INDEX of its configuration, so
     * removing ours renumbers every configuration above it and silently re-points the owner's own
     * zones at a different one. The bridge refuses `config:delete` inside a batch for exactly that
     * reason, and the manager's zone writer refuses a configuration a zone still points at. A
     * configuration left behind holds no state, costs nothing and is one click to remove on the
     * game's own screen; a renumbered map is not recoverable by anybody.
     *
     * The one case that does leave something behind is an owner RENAMING the configuration on the
     * tab: the pair under the old name stops being used and stays. That is reported here rather
     * than repaired, for the reason above, and it is the trade this file is making on purpose.
     */
    async function configIndexFor(live, entry) {
      const c = cfg();
      if (c.zone.configMode !== 'own') return { index: Math.max(0, nz(c.zone.configIndex, 0)) };
      const zombiesOut = zombiesOutFor(entry);
      const want = safeZoneName(String(c.zone.ownConfigName || 'Loot Zones')) + (zombiesOut ? NO_ZOMBIES_SUFFIX : '');
      const find = (l) => {
        const rows = (l && Array.isArray(l.configs)) ? l.configs : [];
        const hit = rows.findIndex((r) => String(r && r.name) === want);
        return hit >= 0 ? hit : -1;
      };
      let at = find(live);
      let created = false;
      if (at < 0) {
        const made = await bx('zoneConfigCommand', `add:${want}`);
        if (!made || made.ok !== true) {
          return { index: null, why: `the configuration "${want}" does not exist and could not be created (${(made && (made.reason || made.error)) || 'refused'})` };
        }
        const again = await bx('zones');
        at = find(again);
        if (at < 0) return { index: null, why: `the configuration "${want}" was created and is not in the list the game sent back` };
        log.info(`created the zone configuration "${want}" at index ${at}`);
        created = true;
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
       * ⚠ **KEEPING ZOMBIES OUT IS THE GAME'S OWN RULE FIRST, AND REMOVAL ONLY AFTER.** The zone
       * configuration carries the game's "Availability Grid" rule — *"Certain systems use the
       * availability grid to check if the area can be used for spawning"* — and set to Block, the
       * owner saw no zombie appear in the zone at B2 Airport. Only in this mode, because these are this
       * plugin's configurations; an existing one is shared with zones the owner drew.
       */
      return {
        index: at,
        created,
        edits: [
          `config:setting:${at}:${bits.length ? bits.join('|') : 'none'}`,
          `config:color:${at}:${part(col.r, 1)}:${part(col.g, 0.64)}:${part(col.b, 0.1)}:${part(col.a, 1)}`,
          `config:event:${at}:availabilityGrid:${zombiesOut ? 'block' : 'allow'}`,
        ],
      };
    }

    /**
     * ⚠ **NOTHING WRITES A ZONE UNTIL THE SET HAS BEEN READ, AND THE RULE LIVES HERE RATHER THAN AT
     * THE CALL SITES.**
     *
     * `mod_zones` refuses EVERY write — `set:`, `delete:`, the lot — until that bridge process has
     * captured the game's own zone set at least once: *"nothing has been read yet — send 'refresh'
     * first"*. `m_seen` belongs to the BRIDGE PROCESS and is never cleared, so it is false after
     * every server restart, not only on a cold boot. `zoneSet()` is the only thing in this plugin
     * that asks for that capture.
     *
     * `activate()` called it and `deactivate()` did not. So the zone being switched OFF was refused
     * and the zone being switched ON was drawn a moment later, off the refresh `activate()` sent —
     * and the map ended up with both rectangles standing side by side, with the log saying only
     * that one of them could not be removed by either route.
     *
     * Two call sites, one of which forgot; a third would. So the read lives in ONE function that
     * every zone write asks — `zoneEdits` below, which every edit passes through, and `deactivate`,
     * which needs the same reading to know which of its names the game really has. That is the same
     * reasoning that puts the replication tally in the bridge's dispatcher rather than in each of
     * its modules.
     *
     * ⚠ It is `zoneSet()` and not `readZones()`, and the difference is the whole fix: `zoneSet()`
     * ASKS, with `refresh`. One that only looked would answer "not known" for ever on a bridge
     * nobody has asked, which is the defect it replaces wearing a tidier hat. `already` is an
     * answer a caller has just had, and it is consulted ONLY for whether the set has been read at
     * all — never for its contents, which the write is about to change.
     */
    const setForWrite = async (already) => ((already && already.known === true) ? already : zoneSet());

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
    async function zoneEdits(lines, already) {
      const list = lines.filter(Boolean);
      if (!list.length) return [];
      {
        const live = await setForWrite(already);
        if (!live || live.known !== true) {
          // Refused, and it says so in the module's own words where there are any. Every caller
          // reads `ok`, so this cannot be mistaken for a write that landed.
          const why = (live && live.why) || NOT_KNOWN;
          return list.map(() => ({ ok: false, reason: why }));
        }
      }
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
     * driven, it answered "Loot customizations reloaded." and "Examine spawners reset.",
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
     * ══ THE BRIDGE THAT MADE THE ENGINE ROUTE USABLE FOR A HUMANOID ══════════════════════════
     *
     * Every ordinary humanoid FAULTED on the bridge's direct spawn until 2.27.0 — a guard, a
     * drifter, a puppet all answered `call_failed` on the AI path and `begin_failed` on the actor
     * path, and each left a half-built pawn standing at the coordinate. 2.27.0 runs that route's
     * `Begin` and `Finish` inside ONE game-thread job, and the A/B at one point with the class
     * resident both times is `BP_Zombie2_C` 4 of 4 faulted against 8 of 8 placed, and
     * `BP_Guard_Lvl_2_C` 4 of 4 placed.
     *
     * It is a version gate rather than a try-and-see because the cost of being wrong is not a
     * refusal: a fault leaves a body in the world, every patrol, for as long as the zone runs.
     *
     * ⚠ **AND "I COULD NOT FIND OUT" IS NOT "IT IS OLD".** `null` is a third answer and it keeps
     * TODAY's behaviour, which is the one that works on every bridge ever shipped. A route is not
     * moved on a reading nobody got.
     */
    const ENGINE_HUMANOID_BRIDGE = [2, 27, 0];
    let bridgeVerSeen = { at: 0, version: null, known: false };
    async function readBridgeVersion() {
      const h = (host.bridge && typeof host.bridge.health === 'function')
        ? await host.bridge.health().catch(() => null) : null;
      if (!h || !h.available || !h.version) { bridgeVerSeen = { at: Date.now(), version: null, known: false }; return null; }
      bridgeVerSeen = { at: Date.now(), version: String(h.version), known: true };
      return bridgeVerSeen.version;
    }
    /** `true` / `false` / `null` — and `null` is a real answer. Sync, because `routeOf` is. */
    function engineRouteOk() {
      if (!bridgeVerSeen.known) return null;
      return bridgeAtLeast(bridgeVerSeen.version, ENGINE_HUMANOID_BRIDGE);
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
        return { ok: false, why: `the bridge is ${h.version || 'an older version'}; live reload needs 2.22.2, so loot lands at the next start` };
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
    // Read at once when the reload after a switch is on and the bridge is 2.22.2 or newer.
    const LOOT_AT_RESTART = 'the loot files are in place; read on a live reload or at the next start.';
    function copySet(setName, dest) {
      // ⚠ The same fence as `readRect`, and it has to be here too: this is the call that WRITES,
      // and a name that escapes the sets folder here copies somebody else's JSON into the running
      // server's `Override/`. Throwing is right — every caller of this already treats a failed
      // copy as a refusal with a sentence, and there is no safe partial answer.
      const src = setDirOf(setName);
      if (!src) throw Object.assign(new Error(NOT_A_SET_NAME), { code: 'bad_set_name' });
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
    /**
     * ⚠ **A CIRCLE'S HEIGHT IS THE SHAPE, AND IT MUST BE EXACTLY ZERO.** `custom_zone_region` has
     * no shape column at all: the game reads a height of 0 as "circle" and fills it from the
     * width. So a circle's width IS its radius and its height is 0, and a rectangle's height must
     * be greater than zero or it comes back a circle at the next restart. Both routes — the
     * bridge's zone command and the save writer — take the pair this way.
     */
    const halfOf = (r) => ((r && r.shape === 'circle')
      ? { w: Math.abs(Number(r.radius)), h: 0 }
      : { w: Number(r.width) / 2, h: Number(r.height) / 2 });
    const shapeOf = (r) => ((r && r.shape === 'circle') ? 'circle' : 'rectangle');

    async function drawZone(entry, rects, live) {
      // The other half of the reconcile refusal. A zone drawn while the prefix is blank is one
      // nothing can ever recognise as its own, so it would sit on the map for ever — and the moment
      // a prefix IS typed it becomes a stray belonging to nobody.
      if (!prefixUsable()) return rects.map((r, i) => ({ name: zoneNameAt(entry, i, rects.length), ok: false, why: NO_PREFIX }));
      const idx = await configIndexFor(live, entry);
      if (idx.index == null) return rects.map((r, i) => ({ name: zoneNameAt(entry, i, rects.length), ok: false, why: idx.why }));
      const sets = rects.map((r, i) => `set:${zoneNameAt(entry, i, rects.length)}:${shapeOf(r)}:`
        + `${Number(r.x)}:${Number(r.y)}:${halfOf(r).w}:${halfOf(r).h}:${idx.index}`);
      const pre = idx.edits || [];
      const answers = await zoneEdits(pre.concat(sets), live);
      const rows = rects.map((r, i) => {
        const res = answers[pre.length + i];
        return {
          name: zoneNameAt(entry, i, rects.length),
          ok: !!(res && res.ok),
          why: res ? ((res.reason || res.error) || null) : NO_BRIDGE_ANSWER,
        };
      });
      // Written down BEFORE anybody is told it worked: a manager that dies in the next millisecond
      // leaves a rectangle on the map, and the ledger is the only thing that can name it afterwards.
      noteDrawn(entry, rows.filter((d) => d.ok).map((d) => d.name));
      return rows;
    }

    /**
     * The custom zones the SAVE holds, as `zonesWritable()` reported them — or NULL when that report
     * carries no list, which is every manager before 5.42.0.
     *
     * ⚠ **NULL IS NOT AN EMPTY SAVE, AND READING IT AS ONE IS THE DEFECT THIS REPLACES.** Both
     * functions below used to filter against `pre.zones || pre.regions || []`, and the writer had
     * never returned either — so the list was always empty. A delete then filtered down to nothing
     * and answered SUCCESS without writing a byte, and the switch forgot a rectangle that was still
     * in the save: after a rotation at a server restart, the old zone came back with the server and
     * nothing here knew it was ours. "There is nothing to delete" and "I was not told what is
     * there" are opposite facts that both spell an empty list.
     */
    function saveRegionsOf(pre) {
      if (!pre || pre.ok !== true) return null;
      const rows = Array.isArray(pre.regions) ? pre.regions : (Array.isArray(pre.zones) ? pre.zones : null);
      if (!rows) return null;
      return rows.map((z) => ({
        name: String(z && z.name),
        x: Number(z && z.x), y: Number(z && z.y),
        sizeX: Number(z && z.sizeX), sizeY: Number(z && z.sizeY),
        configIndex: Number(z && z.configIndex),
      }));
    }
    /** The configurations the save holds, in the game's order — or NULL when not reported. */
    const saveConfigsOf = (pre) => ((pre && Array.isArray(pre.configs)) ? pre.configs : null);

    // The writer's own refusals, by the shape of the sentence it throws. Each one names exactly one
    // zone or configuration, and each has exactly one honest answer: the request is corrected for
    // that name and sent again. Anything else is a real refusal and is handed back as it came.
    const SAVE_MISSING = /no zone called "([^"]+)"/;
    const SAVE_TAKEN = /already has a zone called "([^"]+)"/;
    const SAVE_SAME = /the update for zone "([^"]+)" changes nothing/;
    const SAVE_NO_CONFIG = /there is no configuration called "([^"]+)"/;

    /**
     * Write regions into the save, correcting the request for what the save really holds.
     *
     * Used when the save's own list is not known (an older manager) and as a backstop when it is.
     * The writer refuses the WHOLE transaction over one name it cannot act on, which is right for
     * it and means a request has to be exact. So a refusal that names a zone is answered by moving
     * that one zone: a delete of a name that is not there is already done, a create of a name that
     * is there is an update, and an update that changes nothing is already right. Bounded, because
     * every pass removes or moves one name and a request has finitely many.
     *
     * `makeConfig` is offered once, for a refusal that names a configuration this plugin owns.
     */
    async function writeSaveRegions(plan, makeConfig) {
      const m = host.map || {};
      const create = (plan.create || []).slice();
      const update = (plan.update || []).slice();
      const del = uniq(plan.delete || []);
      const gone = []; const same = [];
      let configs = null;
      const limit = (create.length + update.length + del.length) * 2 + 3;
      for (let i = 0; i < limit; i++) {
        if (!create.length && !update.length && !del.length) {
          return { ok: true, erased: [], gone, same, created: [], updated: [], nothing: true };
        }
        const req = { regions: { create, update, delete: del.map((name) => ({ name })) } };
        if (configs) req.configs = configs;
        const res = await m.writeZones(req).catch((e) => ({ ok: false, reason: e && e.message }));
        if (res && res.ok === true) {
          // The writer hands back its backup's MANIFEST, not a path: printed as it came, the log read
          // "backup [object Object]". The file's path is the part an owner can use.
          const bk = (res.backup && typeof res.backup === 'object') ? (res.backup.backup || null) : (res.backup || null);
          return {
            ok: true, backup: bk, erased: del.slice(), gone, same,
            created: create.map((s) => s.name), updated: update.map((s) => s.name),
          };
        }
        const why = String((res && (res.reason || res.code)) || '');
        let hit = SAVE_MISSING.exec(why);
        if (hit) {
          const d = del.indexOf(hit[1]);
          if (d >= 0) { del.splice(d, 1); gone.push(hit[1]); continue; }
          const u = update.findIndex((s) => s.name === hit[1]);
          if (u >= 0) { create.push(update.splice(u, 1)[0]); continue; }
        }
        hit = SAVE_TAKEN.exec(why);
        if (hit) {
          const c = create.findIndex((s) => s.name === hit[1]);
          if (c >= 0) { update.push(create.splice(c, 1)[0]); continue; }
        }
        hit = SAVE_SAME.exec(why);
        if (hit) {
          const u = update.findIndex((s) => s.name === hit[1]);
          if (u >= 0) { same.push(update.splice(u, 1)[0].name); continue; }
        }
        hit = SAVE_NO_CONFIG.exec(why);
        if (hit && !configs && typeof makeConfig === 'function') {
          const made = makeConfig(hit[1]);
          if (made) { configs = { create: [made] }; continue; }
        }
        return { ok: false, why: why || 'the zone write gave no answer' };
      }
      return { ok: false, why: 'the save kept refusing the zone write' };
    }

    /**
     * Which configuration a rectangle written into the SAVE points at, by NAME.
     *
     * ⚠ **THE WRITER TAKES A NAME OR AN ID, NEVER AN INDEX, AND THIS USED TO SEND AN INDEX.** The
     * bridge addresses a configuration by its position in the game's array; the save writer by its
     * name or its id, and it refuses a zone that names neither. So every rectangle this route ever
     * offered was refused — and before that, in this plugin's own mode, the index was looked up by
     * asking the BRIDGE, which is not there when the save is the only route. The rectangle was then
     * drawn only once a player came online, and the switch-off beside it had no such second chance.
     *
     * In the plugin's own mode the name is ours to know, and the configuration is described in full
     * so the writer can make it when the save has none. In the game's mode the owner chose a position,
     * which is translated through the save's own list where the manager reports one.
     */
    function saveConfigFor(entry, pre) {
      const c = cfg();
      if (c.zone.configMode === 'own') {
        const noZombies = zombiesOutFor(entry);
        const name = safeZoneName(String(c.zone.ownConfigName || 'Loot Zones')) + (noZombies ? NO_ZOMBIES_SUFFIX : '');
        const col = c.zone.colour || {};
        const part = (v, d) => {
          let n = nz(v, d);
          if (n > 1) n = n / 255;
          return Math.max(0, Math.min(1, n));
        };
        const settings = [];
        if (c.zone.visibleOnMap) settings.push('visibleOnMap');
        if (c.zone.notifyOnEntry) settings.push('notifyOnEntry');
        return {
          configName: name,
          make: (asked) => (asked === name ? {
            name,
            color: [part(col.r, 1), part(col.g, 0.64), part(col.b, 0.1)],
            settings: settings.length ? settings : ['none'],
            events: { availabilityGrid: noZombies ? 'block' : 'allow' },
          } : null),
        };
      }
      const list = saveConfigsOf(pre);
      const at = Math.max(0, nz(c.zone.configIndex, 0));
      const row = list ? list.find((r) => Number(r && r.index) === at) : null;
      if (row && row.name) return { configName: String(row.name) };
      return { why: 'the zone uses a configuration chosen by its position in the game, and this manager '
        + 'does not report the save\'s configurations. It is drawn once the server is up.' };
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
    async function drawIntoSave(entry, rects) {
      if (!prefixUsable()) return { ok: false, why: NO_PREFIX };
      const m = host.map || {};
      if (typeof m.writeZones !== 'function' || typeof m.zonesWritable !== 'function') {
        return { ok: false, why: 'this manager is too old to write zones; update to 5.15.2 or newer' };
      }
      const pre = await m.zonesWritable().catch(() => null);
      if (!pre || pre.ok !== true) {
        return { ok: false, why: (pre && (pre.reason || pre.code)) || 'the save cannot be written just now' };
      }
      const conf = saveConfigFor(entry, pre);
      if (!conf.configName) return { ok: false, why: conf.why };

      // Named exactly as the bridge route names them, so one zone is one zone whichever route drew
      // it and `reconcile()` recognises its own work either way.
      const have = saveRegionsOf(pre);
      const byName = new Map((have || []).map((z) => [z.name, z]));
      const create = []; const update = []; const already = [];
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        const spec = {
          name: zoneNameAt(entry, i, rects.length),
          x: r.x, y: r.y, shape: shapeOf(r), width: halfOf(r).w, height: halfOf(r).h, configName: conf.configName,
        };
        const z = byName.get(spec.name);
        if (!z) { create.push(spec); continue; }
        // Already in the save at this place and size: an update would be refused as changing
        // nothing, and every refusal costs a backup. The configuration is left to the writer to
        // judge, because the list carries its position and this spec carries its name.
        const near = (a, b) => Math.abs(Number(a) - Number(b)) < 1;
        if (near(z.x, spec.x) && near(z.y, spec.y) && near(z.sizeX, spec.width) && near(z.sizeY, spec.height)) {
          already.push(spec.name);
        } else {
          update.push(spec);
        }
      }
      const res = await writeSaveRegions({ create, update }, conf.make);
      if (!res.ok) return { ok: false, why: res.why };
      // The other route, and the same record. Which of the two drew a zone has never decided which
      // can remove it, so it must not decide which can NAME it either.
      const names = res.created.concat(res.updated, res.same, already);
      noteDrawn(entry, names);
      log.info(`"${entry.name || entry.set}" — ${names.length} rectangle(s) `
        + `written into the save${res.backup ? `, backup ${res.backup}` : ''}. Players see them when the server starts.`);
      return { ok: true, backup: res.backup };
    }

    /**
     * Remove NAMED rectangles from the SAVE. Same route, same guard.
     *
     * ⚠ **A DELETE OF A NAME THAT IS NOT THERE REFUSES THE WHOLE WRITE.** `zoneWriter.js` looks each
     * one up and throws rather than repairing — which is right, and it means a list built out of
     * anything but the save's own zones takes every other delete down with it. So it is filtered
     * against the save's own list where the manager reports one, and where it does not, the writer's
     * own refusal names the missing zone and the rest are sent again (`writeSaveRegions`).
     *
     * `erased` is what really came out and `gone` is what the save did not have; only those two may
     * leave the ledger. A list that could not be checked is never reported as erased.
     */
    async function eraseFromSave(names) {
      const m = host.map || {};
      if (typeof m.writeZones !== 'function' || typeof m.zonesWritable !== 'function') return { ok: false };
      const want = uniq(names);
      if (!want.length) return { ok: true, erased: [], gone: [] };
      const pre = await m.zonesWritable().catch(() => null);
      if (!pre || pre.ok !== true) {
        return { ok: false, why: (pre && (pre.reason || pre.code)) || 'the save cannot be written just now' };
      }
      const have = saveRegionsOf(pre);
      let list = want; let gone = [];
      if (have) {
        const names2 = new Set(have.map((z) => z.name));
        list = want.filter((n) => names2.has(n));
        gone = want.filter((n) => !names2.has(n));
        if (!list.length) return { ok: true, erased: [], gone };
      }
      const res = await writeSaveRegions({ delete: list });
      if (!res.ok) return { ok: false, why: res.why, erased: [], gone };
      return { ok: true, why: null, erased: res.erased, gone: gone.concat(res.gone), backup: res.backup };
    }

    /**
     * Remove NAMED rectangles through the bridge.
     *
     * ⚠ **`delete:` NEEDS `:CONFIRM`, AND WITHOUT IT NOT ONE RECTANGLE HAS EVER COME OFF THE MAP
     * THIS WAY.** `mod_zones::delete_zone` gates every delete behind the literal word — *"delete
     * removes 'X' from this server's zones and the game saves that, so it needs the literal word
     * CONFIRM in capitals"* — and a batch is ALL OR NOTHING, so one unconfirmed delete abandons
     * every edit sitting beside it. `host.bridge.deleteZone()` appends the word itself, which is why
     * the sweep has always worked while the switch-off beside it silently never did: two routes to
     * one verb, one of them spelling it by hand. These lines are built by hand for the batch, so
     * they carry it by hand.
     */
    async function eraseZone(names, already) {
      const list = uniq(names);
      if (!list.length) return [];
      const answers = await zoneEdits(list.map((name) => `delete:${name}:CONFIRM`), already);
      /**
       * ⚠ **THE REFUSAL'S OWN WORDS, because a delete that was REFUSED must never read as one that
       * worked.** They are available here and they were being thrown away: a zone edit goes out on
       * `host.bridge.command()`, which answers `{ ok:false, code, reason }` — unlike the READ side,
       * `host.bridge.zones()`, which goes through `bridge.data()` and collapses *the bridge is
       * down*, *the module is off* and *the module said no* into one `null`. That blindness is real
       * and it is on the read path; this plugin already works round it by asking `query()` in
       * `readZones()`. On the WRITE path there is a sentence, so it travels.
       */
      return list.map((name, i) => {
        const res = answers[i];
        return { name, ok: !!(res && res.ok), why: res ? ((res.reason || res.error) || null) : NO_BRIDGE_ANSWER };
      });
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
        underground: out.underground || 0, underSpots: out.underSpots || 0,
        // The places that were laid out and could not be used, with the game's own breakdown beside
        // the number — both were counted and neither reached a screen before.
        spotsDropped: out.spotsDropped || 0,
        untracked: out.untracked || 0,
        spotsDroppedWhy: out.spotsDroppedWhy || null,
        spotsInside: out.spotsInside || 0,
        unplaced: out.unplaced || 0,
        groundWhy: out.groundWhy || null,
        // Named points: how many the owner gave this zone and how many of them the game will not
        // take. Two numbers rather than one, because "you named none" and "none of yours works"
        // are opposite facts that both draw as a zero.
        named: out.named || 0,
        namedRefused: out.namedRefused || 0,
        // How many places of its OWN the zone has found against how many it is looking for, so a
        // zone that is still filling reads as filling rather than as broken.
        pool: out.pool || null,
        spare: out.spare || 0,
        // Three states, never two: true is "counted", false is "could not count", null is "the zone
        // never got as far as counting" (asleep, nobody near, nothing chosen).
        censusKnown: out.censusKnown === undefined ? null : out.censusKnown,
        censusWhy: out.censusWhy || null,
        types: Array.isArray(out.types) ? out.types : [],
        // The game's own clock, ONLY where a window asked for it: an absent key is "nobody asked",
        // which is a different fact from "it could not be read" and the card draws them differently.
        // ⚠ The unit travels with the hour, always — see `gameClock`.
        clock: out.clock || null,
        outsideWindow: out.outsideWindow || 0,
        refusals: (out.refusals || []).slice(0, 4),
        // Which kind of zero this patrol's zeros are. See `patrolGuards`.
        playersKnown: out.playersKnown === undefined ? null : !!out.playersKnown,
        playersOnline: out.playersOnline === undefined ? null : out.playersOnline,
        // true, false, or null when nobody's position could be read — three states, because "nobody
        // is near" and "I could not find out" must not render alike.
        awake: out.awake === undefined ? null : out.awake,
        nearest: out.nearest == null ? null : out.nearest,
        wakeDistance: out.wakeDistance == null ? null : out.wakeDistance,
        // ── what became of this zone's OWN guards ──────────────────────────────────────────────
        // Which lifetime this zone is on, and what that cost this round. A zone that empties itself
        // when nobody is near is doing exactly what it was set to do, and a screen that cannot say
        // so reads as a garrison that keeps disappearing.
        ownLife: out.ownLife || null,
        leash: out.leash || null,
        // How many were taken away because nobody is near, and how many the sweep could not find —
        // already gone, or walked past its reach. Different facts, so different numbers. Carried on
        // every asleep row until the zone wakes, never only on the one patrol that swept.
        slept: out.slept || 0,
        // When that sweep ran. Null when no sweep has run since the zone last woke.
        sleptAt: out.sleptAt || null,
        sleptMissing: out.sleptMissing || 0,
        // Guards the game's own spawn command made: no identifier, so nothing here can name them.
        sleptUnidentified: out.sleptUnidentified || 0,
        // How long is left of the grace period before they go. Null while the zone is awake.
        sleepInMs: out.sleepInMs == null ? null : out.sleepInMs,
        // How many had walked out of the zone and were taken back out of the world since it last
        // woke, and when the latest one did. A running count, because the patrol that removes a
        // stray is one of dozens and a per-round figure would read 0 almost every time it is looked at.
        strayed: out.strayed || 0,
        strayedAt: out.strayedAt || null,
        // Which of the two the area came from, so a screen never has to guess whether the numbers
        // beside it are the loot set's own corners or ones somebody typed.
        areaSource: out.areaSource || null,
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

    /**
     * Is this point inside the zone's area? The one containment test, and it asks the SHAPE.
     *
     * A circle carries its own bounding box so that everything measuring how far a sweep must
     * reach goes on working without knowing about shapes — which makes the box the wrong answer
     * here, by up to a fifth of the area at the corners. Somewhere a zone does not cover must not
     * have its sentries cleared, its guards posted or its loot advertised.
     */
    const inRect = (o, r) => {
      const dx = nz(o.x, NaN) - nz(r.x, NaN);
      const dy = nz(o.y, NaN) - nz(r.y, NaN);
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
      if (r.shape === 'circle') {
        const rad = Math.abs(nz(r.radius, 0));
        return (dx * dx + dy * dy) <= rad * rad;
      }
      return Math.abs(dx) <= nz(r.width, 0) / 2 && Math.abs(dy) <= nz(r.height, 0) / 2;
    };
    const near = (a, b, cm) => {
      const dx = nz(a.x, NaN) - nz(b.x, NaN);
      const dy = nz(a.y, NaN) - nz(b.y, NaN);
      return Number.isFinite(dx) && Number.isFinite(dy) && (dx * dx + dy * dy) <= cm * cm;
    };

    /** How far a point is from a rectangle on the map, in centimetres, 0 inside it. Flat: a player
     *  flying over a zone is near it for every purpose this is asked for. */
    function rectDistance(p, r) {
      if (r && r.shape === 'circle') {
        const cx = nz(p.x, NaN) - nz(r.x, NaN);
        const cy = nz(p.y, NaN) - nz(r.y, NaN);
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) return NaN;
        return Math.max(0, Math.sqrt(cx * cx + cy * cy) - Math.abs(nz(r.radius, 0)));
      }
      const dx = Math.max(0, Math.abs(nz(p.x, NaN) - r.x) - nz(r.width, 0) / 2);
      const dy = Math.max(0, Math.abs(nz(p.y, NaN) - r.y) - nz(r.height, 0) / 2);
      return Math.sqrt(dx * dx + dy * dy);
    }
    /** How far outside the zone a point is, 0 anywhere inside it. Flat, like everything else here. */
    const outsideBy = (p, rects) => {
      let best = Infinity;
      for (const r of rects || []) {
        const d = rectDistance(p, r);
        if (Number.isFinite(d) && d < best) best = d;
      }
      return best;
    };
    const wakeCm = (s) => Math.max(5000, Math.min(200000, nz(s.wakeDistance, 40000)));

    /**
     * How this zone's own guards live, with every field bounded.
     *
     * ⚠ **AN ABSENT BLOCK IS THE SHIPPED CHOICE, NOT "LEAVE THEM FOR EVER".** `guardsFor` merges a
     * zone's own `sentries` over the page default by key presence, so a zone written before this
     * block existed inherits it — which is the whole point: the guards a zone places are meant to
     * behave the way the game's own creatures do, and every zone running today does not.
     */
    function lifeOf(s) {
      const raw = (s && s.ownLife && typeof s.ownLife === 'object') ? s.ownLife : {};
      return {
        mode: String(raw.mode || 'nearby') === 'persist' ? 'persist' : 'nearby',
        // Floored at zero and capped at an hour: this is a pause before a zone empties itself, not
        // a second lifetime.
        graceMs: Math.max(0, Math.min(3600, nz(raw.sleepGraceSeconds, 20))) * 1000,
        leash: String(raw.leash || 'zone') === 'none' ? 'none' : 'zone',
        // Capped at a kilometre. Past that the guard is not spilling out of the zone, it has gone.
        slackCm: Math.max(0, Math.min(100000, nz(raw.leashSlackCm, 2000))),
      };
    }

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

    // A zone only works while somebody is near it, so no player positions means nothing is done.
    // Both switches are reads, in the bridge's "Live player data" module.
    const PLAYERS_UNKNOWN = 'player positions are unknown, so nothing was done. Turn on "Read live player data" '
      + 'and "Position, facing and speed" (Live player data).';

    /**
     * Can this bridge put a map sentry away, and is it allowed to? Read off the despawn module's own
     * `kinds` answer rather than learned from a refusal, and kept for thirty seconds — a patrol comes
     * round every few, and the answer changes only when an owner flips a switch.
     */
    let kindsSeen = { at: 0, k: null };
    /**
     * The despawn module's own `kinds` answer, kept for thirty seconds.
     *
     * Two unrelated facts come out of one read, which is why it is read in one place: whether a fixed
     * sentry can be put away, and the ceiling this module enforces on a radius. The second is
     * published as the number IN FORCE rather than the number stored, so it is the one to measure a
     * sweep against.
     */
    let ceilingSeen = { at: 0, cm: null, source: '' };
    async function despawnKinds() {
      if (kindsSeen.k && Date.now() - kindsSeen.at < 30000) return kindsSeen.k;
      const q = await bq('despawnKinds');
      const k = q.ok ? q.data : null;
      if (k && !k.error && typeof k === 'object') {
        kindsSeen = { at: Date.now(), k };
        const cm = Number(k.maxRadius);
        if (Number.isFinite(cm) && cm > 0) {
          ceilingSeen = { at: Date.now(), cm, source: String(k.maxRadiusSource || '') };
        }
      }
      return k;
    }
    /**
     * The largest radius the despawn module will accept, or `null` when it has not said.
     *
     * Kept longer than the answer itself: a bridge that has gone away does not change an owner's
     * setting, and asking for the smallest sphere that still covers the rectangle is the safe
     * direction while nothing has answered.
     */
    function despawnCeiling() {
      return (ceilingSeen.cm && Date.now() - ceilingSeen.at < 10 * 60000) ? ceilingSeen.cm : null;
    }
    async function stowInfo() {
      const k = await despawnKinds();
      if (!k || k.error || typeof k !== 'object') return { known: false };
      if (!k.stow || typeof k.stow !== 'object') return { known: true, supported: false };
      return { known: true, supported: true, allowed: k.stow.allowed === true };
    }
    function stowWhy(st) {
      if (!st || !st.known) {
        // The despawn module is off or the bridge is not running.
        return 'mapsentry: the bridge cannot put sentries away right now, so they were left alone';
      }
      if (!st.supported) {
        // Removing one is pointless: the game builds a new one within seconds.
        return 'mapsentry: this bridge is too old to put fixed sentries away. Update it to 2.22.1 or newer.';
      }
      // ⚠ **"Remove from the world" IS THE CARD; "Removal" IS A GROUP INSIDE IT.** A route that
      // names the group as though it were the card sends an owner looking down a list of cards for
      // a word that is not on any of them. The frontend's copy of this sentence was corrected and
      // the backend's was not, and the backend's is the one that reaches the card through an
      // untranslatable slot.
      // Removing them instead would not work: the game builds a new one within seconds.
      return 'mapsentry: sentries left alone. Turn on "Put fixed map sentries away '
        + 'instead of removing them" (Remove from the world card, Removal group).';
    }

    /**
     * The bridge switch that removes each kind, BY THE LABEL THAT IS REALLY ON ITS CARD.
     *
     * ⚠ A bridge caption is English on every screen — the bridge ships its 380 of them in English —
     * so quoting one is right where quoting this plugin's own control would not be. What is not
     * right is quoting one that does not exist: this said *"Remove deployed sentries"* and the
     * control is **"Remove dropship-dropped sentries"** (`mod_despawn.cpp`), so an owner searching
     * the card for the words they had just been given found nothing at all.
     */
    const REMOVE_SWITCH = { sentry: 'Remove dropship-dropped sentries', puppet: 'Remove puppets (zombies)' };

    /**
     * Where this zone's own guards of one bridge kind are: the slots this plugin was handed when it
     * sent them, and — for the game's own spawn, which hands back no id — the posts they hold.
     */
    function ownGuardSpots(entry, posts, kind) {
      const types = guardTypes(entry);
      const ids = new Set();       // `<slot>.<serial>` — THIS actor, and no other
      const slots = new Set();     // bare slots, from a store written before the serial was kept
      const spots = [];
      // ⚠ A GUARD THAT WALKS IS NOT NEAR ITS POST. A zombie chosen as a guard wanders off like any
      // zombie, and "Keep zombies out" would remove it as a wild one — then the zone, counting its
      // guards across the whole rectangle, sends another. So a walking guard type is recognised by its
      // class wherever it is. A wild zombie of exactly that class is spared too; the zone configuration
      // already stops the game spawning zombies inside it.
      const words = new Set();
      // Only for the game's own spawn, which hands back no id; a guard put there directly is known by its id.
      for (const t of types) if (t.route === 'persistent' && typeKind(t) === kind && roams(t)) words.add(typeWord(t));
      if (!types.length) return { ids, slots, spots, words, radius: 0 };
      const rep = (guardsFor(entry) || {}).replace || {};
      posts.forEach((p, i) => {
        const t = typeForPost(types, p, i);
        if (!t || typeKind(t) !== kind) return;
        // `wasIds` too: a guard this plugin placed in a previous run of the manager is still ours
        // and must not be cleared as a wild one. Widening what is SPARED is the safe direction —
        // the narrow list is the one that decides what may be removed.
        const mine = uniq((Array.isArray(p.ids) ? p.ids : []).concat(Array.isArray(p.wasIds) ? p.wasIds : []));
        for (const id of mine) {
          const s = String(id);
          // ⚠ **A STORE WRITTEN BEFORE THE SERIAL WAS KEPT HOLDS A BARE SLOT, AND IT STAYS
          // TRUSTED.** Refusing it would make every zone running today stop recognising its own
          // garrison the moment the plugin updates — it would clear the lot and refill, which is a
          // visible disruption in exchange for a hole that closes by itself at the next refill.
          // Additive: the loose match is what these entries already had.
          if (s.includes('.')) ids.add(s); else if (Number(s) > 0) slots.add(Number(s));
        }
        // Only a guard with no id is recognised by where it stands. Doing that for every post would
        // shelter any wild puppet that wandered past one of ours.
        if (t.route === 'persistent') spots.push(p);
      });
      return { ids, slots, spots, words, radius: Math.max(200, nz(rep.postRadius, 1500)) };
    }
    /**
     * ⚠ **AN OBJECT-ARRAY SLOT IS NOT AN IDENTITY, AND HERE THAT MISTAKE SPARES SOMETHING.**
     *
     * This decides whether a thing standing in the zone is one of ours — and a `true` means it is
     * left alone. Matching on the slot ALONE therefore shelters whatever the engine later puts in
     * a freed slot, which on a zone that keeps puppets out is precisely the wild puppet the owner
     * switched the zone on to be rid of. The id the preview hands over carries the serial for
     * exactly this reason (`resolve()` in `mod_despawn` refuses a slot whose serial has moved on),
     * so the exact id is asked first and the bare slot is only the legacy path above.
     */
    function isOwnGuard(o, g) {
      const id = String((o && o.id) || '');
      if (id && g.ids.has(id)) return true;
      const slot = Number(id.split('.')[0]);
      if (Number.isFinite(slot) && g.slots.has(slot)) return true;
      if (g.words && g.words.has(actorWord(o && o.class))) return true;
      return g.spots.some((p) => near(p, o, g.radius));
    }

    /**
     * ── EVERY GUARD THIS ZONE REALLY PLACED, BY THE ID THE GAME GAVE BACK ────────────────────────
     *
     * ⚠ **THE ID IS THE WHOLE OF THE PERMISSION TO REMOVE SOMETHING.** Taking a guard away is
     * exactly as destructive as taking a sentry away, and the zone's other rules for recognising
     * its own — the post it stands near, the class it wears — are there to decide what to SPARE.
     * Read the other way round they would remove somebody else's NPC that happened to be the same
     * figure, or a wild puppet standing where a guard once stood. So nothing is ever taken away
     * except an actor whose exact `<slot>.<serial>` this plugin wrote down when the game made it.
     *
     * That leaves out the guards made by the game's OWN spawn command, which answers with no
     * identifier at all. Nothing is lost by it: those are registered with the game, so the game
     * removes them itself once nobody is near — which is the very behaviour this is here to give
     * the others. The count of them travels so a screen can say so rather than implying a clean
     * sweep.
     */
    function ownGuardIds(entry, posts) {
      const types = guardTypes(entry);
      const byKind = new Map();
      let total = 0;
      let unidentified = 0;
      posts.forEach((p, i) => {
        // `wasIds` is what a previous run of this manager placed and never got to take away. It is
        // removable and it is not "held by": the two lists are separate for that reason.
        const ids = uniq((Array.isArray(p.ids) ? p.ids : []).concat(Array.isArray(p.wasIds) ? p.wasIds : []))
          .map(String).filter((s) => /^\d+\.\d+$/.test(s));
        const t = typeForPost(types, p, i);
        // ⚠ ONLY A PLACE THAT BELIEVES SOMETHING IS ON IT. Counting every place of this route
        // reported an empty post — never filled, or filled and killed — as a guard standing there
        // that nobody could remove, which is a figure about the configuration dressed as one about
        // the world.
        if (t && t.route === 'persistent') {
          if (p.everHeld || p.sentAt) unidentified += countFor(t);
          return;
        }
        if (p.noId && (p.everHeld || p.sentAt)) unidentified += t ? countFor(t) : 1;
        if (!ids.length) return;
        const kind = t ? censusKind(t) : 'npc';
        const set = byKind.get(kind) || new Set();
        for (const id of ids) { if (!set.has(id)) { set.add(id); total++; } }
        byKind.set(kind, set);
      });
      return { byKind, total, unidentified };
    }

    /**
     * Take this zone's own guards out of the world, and forget them.
     *
     * ⚠ **A SPHERE STILL APPLIES TO A REMOVAL BY ID.** The despawn module runs the same guard list
     * for a named object as for a sweep — that is its whole safety story — so the radius is still
     * consulted, and an id handed over with a sphere that does not contain it removes nothing and
     * says so. The candidates are therefore taken from a PREVIEW over the zone's own reach, exactly
     * as the patrol takes them, and only the ones whose id this plugin wrote down are acted on.
     *
     * ⚠ **AND AN ID NOTHING CAN FIND IS FORGOTTEN RATHER THAN CHASED.** A guard the game has
     * already taken away, one that has walked past the reach, and one killed by a player all read
     * the same from here. Keeping the id would have every round of a sleeping zone paying for a
     * sweep that can never succeed; dropping it costs nothing, because the zone counts what is
     * really standing in it before it sends anybody, so a survivor still holds its post.
     */
    async function takeOwnGuardsAway(entry, s, posts, rects, why) {
      const mine = ownGuardIds(entry, posts);
      const out = { removed: 0, missing: 0, unidentified: mine.unidentified, refusals: [] };
      if (!mine.total) return out;
      const seen = new Set();
      for (const rect of rects || []) {
        const radius = sphereFor(rect, s, chaseFor(s));
        for (const [kind, ids] of mine.byKind) {
          const q = await bq('despawnPreview', kind, rect.x, rect.y, nz(s.centreZ, 0), radius);
          const pre = q.ok ? q.data : null;
          if (!pre || pre.error) {
            const said = pre ? ((pre.reason || pre.error) || 'the preview gave no answer')
              : await whyOf(q, 'despawn', 'the guards this zone placed');
            if (!out.refusals.includes(said)) out.refusals.push(said);
            continue;
          }
          for (const o of pre.objects || []) {
            const id = String(o && o.id);
            if (!ids.has(id) || seen.has(id)) continue;
            seen.add(id);
            const done = await bx('despawnAt', kind, rect.x, rect.y, nz(s.centreZ, 0), radius, id);
            if (done && done.ok === true) { out.removed++; continue; }
            const said = done ? ((done.reason || done.error) || 'refused') : NO_BRIDGE_ANSWER;
            if (!out.refusals.includes(said)) out.refusals.push(said);
          }
        }
      }
      // A preview that could not be taken at all is not an answer about the guards, so nothing is
      // forgotten on the strength of it — the sweep comes round again.
      if (out.refusals.length && !out.removed && !seen.size) return out;
      /**
       * ⚠ **NOT SEEN BY THE SWEEP IS NOT GONE.** This used to write every id the sweep did not meet
       * off as "already gone" and forget it — and a guard that had walked out of the zone's reach is
       * exactly one the sweep does not meet. It was then loose for good, with nothing left that
       * could name it. Each is asked about by id instead, wherever it is, and removed where it
       * stands; only one confirmed gone is forgotten. The rest stay on the list and the sleeping
       * zone asks again.
       */
      const keep = new Set();
      let asked = 0;
      for (const r of trackedIds(entry, posts)) {
        if (seen.has(r.id)) continue;
        if (asked >= STRAY_LOOKUPS * 2) { keep.add(r.id); continue; }
        asked++;
        const res = await chaseById(r.id, r.kind, r.word, true);
        if (res.state === 'removed') { out.removed++; continue; }
        if (res.state === 'gone') { out.missing++; continue; }
        keep.add(r.id);
        if (res.why && !out.refusals.includes(res.why)) out.refusals.push(res.why);
      }
      out.left = keep.size;
      for (const p of posts) {
        if (!(Array.isArray(p.ids) && p.ids.length) && !(Array.isArray(p.wasIds) && p.wasIds.length)) continue;
        const still = uniq((Array.isArray(p.ids) ? p.ids : []).concat(Array.isArray(p.wasIds) ? p.wasIds : []))
          .filter((id) => keep.has(String(id)));
        p.ids = [];
        // Removed, or confirmed gone, is dealt with. What is still out there stays named.
        if (still.length) p.wasIds = still; else { delete p.wasIds; delete p.wasGt; }
        p.emptySince = 0;
        p.everHeld = false;
        p.sentAt = 0;
      }
      dropEmptyHolders(posts);
      if (out.removed) {
        log.info(`"${entry.name || entry.set}" — ${out.removed} guard(s) removed (${why}); `
          + 'they return when somebody is near.');
      }
      return out;
    }

    /**
     * ── A GUARD THAT HAS LEFT THE ZONE IS TAKEN BACK OUT OF THE WORLD ────────────────────────────
     *
     * ⚠ **EVERY GUARD TYPE WALKS.** A drifter patrols by design, and a guard chasing somebody is
     * off its post exactly when the post matters — so over an afternoon a zone's garrison drifts
     * out of the rectangle and across the island, still alive, still counted, and guarding nothing.
     * The count is what hides it: the zone believes it holds six because six are alive, and a
     * player standing in it sees none.
     *
     * So one that ends up further outside than the slack allows is removed, and its post is free to
     * be filled again on this very round. Only by the id this plugin wrote down — a wild NPC of the
     * same figure walking past is not ours to touch, inside the zone or outside it.
     *
     * It runs on the census that has already been taken, so it costs one call per guard it really
     * removes and nothing at all on a zone whose guards have stayed put. The strays leave the
     * census with it, so nothing downstream counts a guard that is no longer there as holding a
     * post.
     */
    /**
     * ── EVERY GUARD THIS ZONE PLACED STAYS NAMED UNTIL IT IS CONFIRMED GONE ─────────────────────
     *
     * ⚠ **A GUARD THAT OUTRAN THE ZONE'S OWN SWEEP WAS INVISIBLE TO EVERYTHING HERE.** The count,
     * the leash and the sleep sweep all look through the zone's sphere, and a Drifter heading for a
     * player a few hundred metres off walks out of it. Then it was not counted — so its place was
     * filled again — the leash could not see it to bring it back, and the sleep sweep wrote it off as
     * "already gone" and forgot its id. Measured on a dev server: 13 guards held, 5 taken away when
     * the zone slept, the rest loose on the island.
     *
     * So an id the sweep did not see is asked about BY ID, wherever it is. Four answers:
     *   'gone'     dead, the id now names something else, or the entity index says it has no
     *              such thing — forgotten. The index can lag a fresh spawn by a few seconds, but a
     *              guard the zone's own sweep ALSO cannot see is not a fresh one standing at its
     *              place; forgetting it here is what this code always did, and now it is asked first;
     *   'removed'  it was alive and has been taken away where it stands;
     *   'alive'    it is out there and was not taken away (the owner lets guards walk, or the
     *              removal was refused) — it still counts as one of this zone's guards;
     *   'unknown'  nothing answered — kept, and counted, because "could not find out" is not "gone".
     */
    /**
     * ⚠ **A PLACE THAT IS DROPPED HANDS ON THE GUARDS IT STILL NAMES.** Places come and go — a wave
     * picks new ground, an owner deletes a point, the ring round a player moves with them — and a
     * guard standing on a dropped place used to be dropped with it: alive, walking, and named by
     * nothing any more. Its id moves to a place of the same guard that stays, with the guard's name
     * beside it so the id is still judged as that guard. With no place left at all, the dropped one
     * stays behind as a HOLDER: never filled, and gone as soon as it names nobody.
     */
    function handOver(gone, posts) {
      for (const g of gone) {
        const ids = uniq((Array.isArray(g.ids) ? g.ids : []).concat(Array.isArray(g.wasIds) ? g.wasIds : []))
          .filter((id) => /^\d+\.\d+$/.test(id));
        if (!ids.length) continue;
        const words = {};
        for (const id of ids) words[id] = (g.wasGt && g.wasGt[id]) || (g.gt != null ? String(g.gt) : '');
        const word = g.gt != null ? String(g.gt) : '';
        const to = posts.find((q) => q !== g && !q.hold && q.gt != null && String(q.gt) === word)
          || posts.find((q) => q !== g && !q.hold);
        if (to) {
          to.wasIds = uniq((Array.isArray(to.wasIds) ? to.wasIds : []).concat(ids));
          to.wasGt = Object.assign({}, to.wasGt || {}, words);
        } else {
          posts.push({ x: g.x, y: g.y, z: g.z, hold: true, gt: g.gt, gti: g.gti, ids: [], wasIds: ids,
            wasGt: words, spot: SPOT_VERSION, emptySince: 0, everHeld: false });
        }
      }
    }
    function dropPost(posts, i) {
      const gone = posts.splice(i, 1);
      handOver(gone, posts);
    }
    /** A holder that names nobody any more has done its job. */
    function dropEmptyHolders(posts) {
      for (let i = posts.length - 1; i >= 0; i--) {
        const p = posts[i];
        if (p.hold && !(Array.isArray(p.wasIds) && p.wasIds.length) && !(Array.isArray(p.ids) && p.ids.length)) posts.splice(i, 1);
      }
    }

    const STRAY_REACH_CM = 3000;         // the sphere round a guard's last known position, for a removal by id
    const SLEEP_RETRY_MS = 30000;        // a sleeping zone with a guard still loose asks again this often
    const STRAY_LOOKUPS = 4;             // ids asked about per round, so a big garrison costs a bounded number of calls
    async function chaseById(id, kind, word, take) {
      const q = await bq('entity', entitySlot(id));
      // The module ANSWERED that it has no such entity (`refused`) is a miss; the bridge or the
      // module not answering at all is nothing learned.
      if (!q.ok && q.code !== 'refused') return { state: 'unknown', why: q.reason ? String(q.reason) : NO_BRIDGE_ANSWER };
      const e = q.ok ? q.data : null;
      if (!e || e.error || e.ok === false) return { state: 'gone' };
      // The slot holds something else now, so the guard that had it is gone.
      if (e.class && word && actorWord(e.class) !== actorWord(word)) return { state: 'gone' };
      if (e.alive === false || (e.healthPoints != null && nz(e.healthPoints, 1) <= 0)) return { state: 'gone' };
      const at = { x: nz(e.x, NaN), y: nz(e.y, NaN), z: nz(e.z, 0) };
      if (!take || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return { state: 'alive', at };
      const done = await bx('despawnAt', kind, at.x, at.y, at.z, STRAY_REACH_CM, String(id));
      if (done && done.ok === true) return { state: 'removed' };
      return { state: 'alive', at, why: done ? ((done.reason || done.error) || 'refused') : NO_BRIDGE_ANSWER };
    }
    /** Every id this zone still holds, with the place that holds it and what kind of guard it is. */
    function trackedIds(entry, posts) {
      const types = guardTypes(entry);
      const out = [];
      const seen = new Set();
      posts.forEach((p, i) => {
        const t = typeForPost(types, p, i);
        const own = p.gt != null ? String(p.gt) : (t ? typeWord(t) : '');
        for (const list of [p.ids, p.wasIds]) {
          for (const id of (Array.isArray(list) ? list : []).map(String)) {
            if (!/^\d+\.\d+$/.test(id) || seen.has(id)) continue;
            seen.add(id);
            const word = (p.wasGt && p.wasGt[id]) || own;
            const tt = types.find((x) => typeWord(x) === word) || t;
            out.push({ id, p, word, kind: tt ? censusKind(tt) : 'npc' });
          }
        }
      });
      return out;
    }
    /** Forget one id on every place that holds it. */
    function forgetId(posts, id) {
      for (const p of posts) {
        if (Array.isArray(p.ids) && p.ids.map(String).includes(id)) {
          p.ids = p.ids.filter((x) => String(x) !== id);
          if (!p.ids.length) p.emptySince = p.emptySince || Date.now();
        }
        if (Array.isArray(p.wasIds)) {
          const rest = p.wasIds.filter((x) => String(x) !== id);
          if (rest.length) p.wasIds = rest; else delete p.wasIds;
        }
        if (p.wasGt && p.wasGt[id]) { p.wasGt = Object.assign({}, p.wasGt); delete p.wasGt[id]; }
      }
      dropEmptyHolders(posts);
    }
    const strayTurn = {};
    /**
     * The awake half: the ids the zone's count did not see this round. Dead ones in the count are
     * forgotten here too, off the old list only — the current `ids` is how a kill is told apart.
     * What is still out there is COUNTED as the zone's, so a guard that left is never replaced
     * while it lives; with the leash on it is taken away first.
     */
    async function trackOwn(entry, census, area, out) {
      const posts = Array.isArray(area && area.allPosts) ? area.allPosts : [];
      const life = lifeOf((area && area.s) || {});
      const inCount = new Set();
      const dead = new Set();
      for (const c of census.values()) {
        if (!c || c.unknown) continue;
        for (const o of (c.alive || [])) inCount.add(String(o && o.id));
        for (const o of (c.dead || [])) { inCount.add(String(o && o.id)); dead.add(String(o && o.id)); }
      }
      for (const p of posts) {
        if (!Array.isArray(p.wasIds)) continue;
        const rest = p.wasIds.filter((x) => !dead.has(String(x)));
        if (rest.length) p.wasIds = rest; else delete p.wasIds;
        if (p.wasGt) {
          const names = {};
          for (const id of (p.wasIds || [])) if (p.wasGt[id]) names[id] = p.wasGt[id];
          if (Object.keys(names).length) p.wasGt = names; else delete p.wasGt;
        }
      }
      dropEmptyHolders(posts);
      const away = trackedIds(entry, posts).filter((r) => !inCount.has(r.id));
      if (!away.length) return;
      const key = String(entry.id);
      const start = (strayTurn[key] || 0) % away.length;
      strayTurn[key] = start + STRAY_LOOKUPS;
      let taken = 0;
      let loose = 0;
      let why = null;
      for (let k = 0; k < away.length; k++) {
        const r = away[(start + k) % away.length];
        const res = k < STRAY_LOOKUPS ? await chaseById(r.id, r.kind, r.word, life.leash === 'zone') : { state: 'unknown' };
        if (res.state === 'gone' || res.state === 'removed') {
          forgetId(posts, r.id);
          if (res.state === 'removed') taken++;
          continue;
        }
        // Still this zone's: counted where it is, or at its own place when that is not known.
        const c = census.get(r.word);
        if (c && !c.unknown) {
          const at = res.at && Number.isFinite(res.at.x) ? res.at : { x: r.p.x, y: r.p.y, z: r.p.z };
          c.alive = (c.alive || []).concat([{ id: r.id, x: at.x, y: at.y, z: at.z, away: true }]);
          c.count = c.alive.length;
        }
        loose++;
        if (res.why && !why) why = res.why;
      }
      if (taken) {
        out.strayed = (out.strayed || 0) + taken;
        log.info(`"${entry.name || entry.set}" — ${taken} guard(s) that had left the zone's reach were taken away`);
      }
      if (loose && life.leash === 'zone' && why) {
        out.refusals.push(`${loose} guard(s) outside the zone could not be taken back yet: ${why}`);
      }
    }

    async function leashStrays(entry, census, area, out) {
      const s = (area && area.s) || {};
      const life = lifeOf(s);
      if (life.leash !== 'zone') return;
      const posts = Array.isArray(area && area.allPosts) ? area.allPosts : [];
      const mine = ownGuardIds(entry, posts);
      if (!mine.total) return;
      const ours = new Set();
      for (const ids of mine.byKind.values()) for (const id of ids) ours.add(id);
      let removed = 0;
      let stuck = 0;
      let why = null;
      const gone = new Set();
      for (const c of census.values()) {
        if (!c || c.unknown || !Array.isArray(c.alive)) continue;
        const keep = [];
        for (const o of c.alive) {
          const id = String(o && o.id);
          const away = outsideBy(o, area.rects);
          if (!ours.has(id) || !Number.isFinite(away) || away <= life.slackCm || !o.sweep) {
            keep.push(o);
            continue;
          }
          const done = await bx('despawnAt', o.sweep.kind, o.sweep.x, o.sweep.y, o.sweep.z, o.sweep.radius, id);
          if (done && done.ok === true) { removed++; gone.add(id); continue; }
          // It could not be removed, so it is still out there and still ours: it stays in the count
          // rather than being written off, which would have the zone send a replacement beside it.
          stuck++;
          why = why || (done ? ((done.reason || done.error) || 'refused') : NO_BRIDGE_ANSWER);
          keep.push(o);
        }
        c.alive = keep;
        c.count = keep.length;
      }
      if (removed) {
        out.strayed = (out.strayed || 0) + removed;
        // Forgotten on the posts too, or the next round would ask the entity index about an actor
        // that is gone and read the silence as "the post could not be checked".
        for (const p of posts) {
          if (Array.isArray(p.wasIds) && p.wasIds.length) {
            const rest = p.wasIds.filter((id) => !gone.has(String(id)));
            if (rest.length) p.wasIds = rest; else delete p.wasIds;
          }
          if (!Array.isArray(p.ids) || !p.ids.length) continue;
          const left = p.ids.filter((id) => !gone.has(String(id)));
          if (left.length === p.ids.length) continue;
          p.ids = left;
          if (!left.length) p.emptySince = Date.now();
          // ⚠ **THE PLACE MUST NOT READ AS ONE THE GAME REFUSED.** A post whose guard disappears
          // within seconds of being sent is the shape that makes this plugin move the place round a
          // ring and eventually rest it — a rule that exists because the GAME sometimes takes a
          // spawn straight back. Here it was this zone that removed it, on purpose, so leaving the
          // stamp behind would have every leashed guard walk its own place off into a ring and then
          // stop the post for ten minutes.
          p.sentAt = 0;
          p.vanished = 0;
        }
        log.info(`"${entry.name || entry.set}" — ${removed} guard(s) walked out and were removed; `
          + 'their places refill.');
      }
      if (stuck) {
        // Still counted as this zone's, so nothing is sent beside them; retried next round.
        out.refusals.push(`${stuck} guard(s) walked outside the zone and could not be removed: ${why} `
          + 'Retried next round.');
      }
    }

    /**
     * How far one despawn call is asked to reach, in centimetres.
     *
     * ⚠ **A VERTICAL REACH IS NOT A HORIZONTAL DISTANCE, AND THIS USED TO ADD ONE TO THE OTHER.**
     * The radius was the rectangle's half diagonal PLUS `reachZ`, and the two are at right angles:
     * `reachZ` ships at 100000 cm, so a rectangle TEN METRES across asked to sweep a kilometre. The
     * despawn module refuses a radius over its own ceiling rather than clamping it, and that ceiling
     * ships at 5000 — so on an untouched install every zone on the map was refused, for every kind,
     * every round, and the only thing on the card was the module saying no.
     *
     * The geometry, which is the whole fix: a sphere centred on the rectangle covers it once its
     * radius is the half diagonal (`flat`), and at the far corner it then reaches `sqrt(R² − flat²)`
     * up and down. So the radius that reaches `reachZ` everywhere inside is `hypot(flat, reachZ)` —
     * and the extra vertical reach is bought out of the module's own ceiling, as much of it as the
     * ceiling allows.
     *
     * ⚠ **NEVER BELOW `flat`.** A smaller sphere leaves part of the rectangle unlooked-at, and a
     * sentry quietly never seen is worse than a refusal: where the rectangle alone is over the
     * ceiling the module is asked anyway and answers in its own words, which name the number asked
     * for, the ceiling, and the control that raises it. This plugin has no opinion about how far a
     * sweep may reach; that is the owner's number on the owner's card.
     *
     * `extraCm` is horizontal too — the census below looks past the rectangle for a guard that has
     * chased somebody out of it. ⚠ **IT IS A NICETY AND THE RECTANGLE IS THE REQUIREMENT**, so it is
     * bought out of the ceiling exactly as the vertical reach is and is NEVER part of the floor. Put
     * into the floor it made the shipped ceiling unreachable on its own — 100 m of margin against a
     * ceiling of 50 — so the count could not be taken for ANY zone, however small, on an untouched
     * install. Measured by driving it.
     */
    // A circle's own radius, not its bounding box's half diagonal — that would be 41% wider than
    // the area and is bought out of the despawn module's ceiling for nothing.
    const flatFor = (rect) => ((rect && rect.shape === 'circle')
      ? Math.abs(nz(rect.radius, 0))
      : Math.hypot(nz(rect.width, 0) / 2, nz(rect.height, 0) / 2));
    function sphereFor(rect, s, extraCm) {
      const flat = flatFor(rect);
      const floor = Math.max(1, Math.ceil(flat));
      const up = Math.max(0, nz(s && s.reachZ, 0));
      const want = Math.ceil(Math.hypot(flat + Math.max(0, nz(extraCm, 0)), up));
      const ceiling = despawnCeiling();
      // Not read yet: the smallest ask that still covers the rectangle, which cannot be refused for
      // being larger than it has to be.
      if (!(ceiling > 0)) return floor;
      return Math.max(floor, Math.min(want, Math.floor(ceiling)));
    }
    /** How far past the rectangle a guard of ours is still counted as ours. Horizontal. */
    const CHASE_CM = 10000;
    /**
     * ...and how far the count has to REACH, which is a different number once a zone leashes its
     * guards. A guard is only ever taken back inside the zone if the sweep that finds it looks far
     * enough out to see it, so a leash wider than the ordinary chase margin buys the difference out
     * of the despawn module's own ceiling exactly as the vertical reach does. Never narrower: a
     * shorter reach would leave a strayed guard invisible, which reads as a guard that has died.
     */
    const chaseFor = (s) => {
      const life = lifeOf(s);
      return life.leash === 'none' ? CHASE_CM : Math.max(CHASE_CM, life.slackCm + 2000);
    };

    /**
     * Which bridge kind the replacement really is, so a post can be looked at with the same word it
     * was filled with. The persistent route speaks the game's admin vocabulary and the direct route
     * speaks the bridge's, and `despawnPreview` only understands the second.
     */
    const PERSISTENT_AS_KIND = { armednpc: 'npc', zombie: 'puppet', animal: 'animal' };
    function typeKind(t) {
      if (t.random) return String((randomFor(t) || {}).kind || 'puppet');
      return t.route === 'persistent'
        ? (PERSISTENT_AS_KIND[String(t.spawnKind || 'armednpc')] || 'npc')
        : String(t.kind || 'npc');
    }

    /**
     * ── THE GAME'S OWN RANDOM SPAWNS ─────────────────────────────────────────────────────────────
     *
     * They are the one guard that works on a server whatever it has ever made:
     * `SpawnRandomZombie` and `SpawnRandomAnimal` take
     * a COUNT and a PLACE and no class at all, so nothing has to be resident and nothing has to be
     * looked up in a catalogue. Driven: a random zombie asked for at a point appeared
     * **46 cm from it**, so they aim exactly as the named creature verbs do.
     *
     * ⚠ **WHAT THEY COST IS IDENTITY, AND IT IS A BIGGER COST HERE THAN ON THE OTHER ROUTES.** The
     * command hands back no id, and what appears is not known in advance — so a post filled this way
     * cannot be asked about and cannot even be recognised by NAME. It is held by any creature of
     * that kind standing on it, **the game's own wildlife included**: a random-animal post in a
     * field with deer in it reads as held and will not refill. That degrades the safe way round (a
     * post that stays empty because the world already put something there) and it is said on the
     * card rather than left for an owner to work out.
     *
     * ⚠ **`SpawnRandomZombie2` IS THE GAME'S OWN NARROWER LIST**, and it excludes exactly the loot,
     * suicide, hospital and nuclear puppets — the same families whose abstract bases are the five
     * names the game refuses outright. Worth offering as the safer of the two.
     */
    let randomTable = null;
    function randomFor(t) {
      if (randomTable === null) {
        try {
          randomTable = JSON.parse(fs.readFileSync(path.join(__dirname, 'guard-classes.json'), 'utf8')).random || {};
        } catch { randomTable = {}; }
      }
      const key = String((t && t.random) || '').trim();
      return (key && randomTable[key] && randomTable[key].verb) ? randomTable[key] : null;
    }
    /**
     * Does this actor hold a post of this type? The NAME for an ordinary guard, and the KIND alone
     * for a random one — which is the whole of the cost above, in one place rather than at each of
     * the two sites that used to compare a word.
     */
    function typeHolds(t, cls) {
      if (t && t.random) return true;      // the caller has already filtered by kind
      return actorWord(cls) === typeWord(t);
    }
    /** The name this guard will carry, for matching what is standing at a post. */
    function typeWord(t) {
      // ⚠ A RANDOM GUARD HAS NO CLASS, SO IT IS GIVEN A WORD OF ITS OWN. It still needs one: a word
      // is what `guardTypes` drops an entry for not having, what a post remembers it is holding, and
      // what the card calls the row. It never matches an actor's class, and it must not — see
      // `typeHolds`, which is the one place that knows a random post is judged by kind alone.
      if (t.random) return `random_${String(t.random).replace(/[^a-z0-9_]/gi, '')}`;
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
     * ── THE GAME'S OWN CLOCK ─────────────────────────────────────────────────────────────────────
     *
     * `{ hour, unit, speed, speedUnit, sunrise, sunset }`, or `{ unknown, why }`.
     *
     * One reading serves a whole patrol of every zone, and it is kept for twenty seconds: at the
     * default day speed of 8 game hours per real hour a game hour is 7.5 real minutes, so twenty
     * seconds is 0.044 of an hour — far finer than the whole hours a window is written in, and it
     * turns a per-zone read into one.
     *
     * ⚠ **EVERY NUMBER CARRIES ITS UNIT, INCLUDING THE SPEED.** `timeOfDay` is in GAME HOURS and
     * `timeOfDaySpeed` is in game hours per REAL hour — both measured by the bridge rather than
     * inferred from their range, because a 0..1 fraction and a 0..24 hour count look equally
     * plausible in a payload you sample once. The speed is published beside the hour so a screen can
     * say how long a window really lasts: a four-hour window at speed 8 is thirty real minutes.
     *
     * ⚠ **AND "NOTHING CAME BACK" IS NOT MIDNIGHT.** The world payload answers an OBJECT carrying a
     * `note` when the module's three world groups are all off, or when the weather controller is not
     * in the world yet — both of which are perfectly ordinary and neither of which is a time. A
     * missing `timeOfDay` is therefore `unknown` and never 0, which would put every "guards at
     * night" zone permanently into the small hours.
     */
    const GAME_CLOCK_MS = 20000;
    let gameClockAt = 0;
    let gameClockWas = null;
    // The clock comes from the bridge's Live player data module; both switches are reads.
    const NO_CLOCK = 'the game clock is unreadable. Turn on "Read live player data" and '
      + '"Time of day and day length" in the SSA Bridge.';
    async function gameClock() {
      if (gameClockWas && Date.now() - gameClockAt < GAME_CLOCK_MS) return gameClockWas;
      const q = await bq('world');
      const w = q.ok ? q.data : null;
      const hour = w ? nz(w.timeOfDay, NaN) : NaN;
      const v = Number.isFinite(hour) && hour >= 0 && hour < 24.0001
        ? {
          hour,
          unit: 'game-hours',
          speed: nz(w.timeSpeed, null),
          speedUnit: 'game-hours-per-real-hour',
          sunrise: nz(w.sunrise, null),
          sunset: nz(w.sunset, null),
        }
        // The module's own sentence wherever it gave one — it is better than ours and it names the
        // switch. `note` is what the world payload carries when it has nothing else to say, and a
        // refusal's own `reason` outranks both.
        : { unknown: true, why: (w && typeof w.note === 'string' && w.note.trim()) ? w.note.trim() : (q.reason ? String(q.reason) : NO_CLOCK) };
      gameClockWas = v;
      gameClockAt = Date.now();
      return v;
    }

    /**
     * One window, read off whatever an owner set. `{ on, from, to }` — `on: false` is "no window",
     * which is what every configuration written before this key carries.
     *
     * The hours are clamped to 0..24 and rounded, because a window is written in whole game hours
     * and a fractional one cannot be shown on a screen in a way anybody can act on.
     */
    function windowOf(g) {
      if (!g || typeof g !== 'object' || g.enabled !== true) return { on: false };
      const h = (v, d) => Math.max(0, Math.min(24, Math.round(nz(v, d))));
      return { on: true, from: h(g.fromHour, 0), to: h(g.toHour, 24) };
    }
    /**
     * Is `hour` inside the window? `{ open, why }` — and `open` is TRUE for every case where the
     * answer is not a real "no", which is the direction argued for beside the default above.
     */
    function windowOpen(win, clock) {
      if (!win.on) return { open: true };
      // 0..24, and from == to. Both are "all day" rather than "never": the second is a typo an owner
      // makes once, and reading it as an empty window disarms the zone for ever with no message.
      if (win.from === win.to || (win.from === 0 && win.to === 24)) return { open: true, whole: true };
      if (!clock || clock.unknown) return { open: true, blind: true, why: (clock && clock.why) || NO_CLOCK };
      const h = clock.hour;
      const open = win.from < win.to ? (h >= win.from && h < win.to) : (h >= win.from || h < win.to);
      return { open, hour: h };
    }
    /** `21:00` out of a whole game hour, for a sentence an owner reads. */
    const hhmm = (h) => `${String(Math.max(0, Math.min(24, Math.round(nz(h, 0)))) % 24).padStart(2, '0')}:00`;

    /**
     * One number off an entry, or `undefined` for "this entry did not say" — which is INHERIT.
     *
     * The key has to be PRESENT and the value has to be a number. An owner who clears the box sends
     * `""` or `null`, which is "I do not want an override" rather than "zero", and a `0` typed on
     * purpose is a real setting that must survive.
     */
    function ownNum(t, key, lo, hi) {
      if (!t || !Object.prototype.hasOwnProperty.call(t, key)) return undefined;
      const n = Number(t[key]);
      if (!Number.isFinite(n)) return undefined;
      return Math.max(lo, Math.min(hi, n));
    }
    /** The three keys above, as the tab is told them. Data, so nothing has to read this file. */
    const GUARD_OVERRIDABLE = ['postRadius', 'afterDeathSeconds', 'keepAwayFromPlayers'];

    /**
     * ── A PLACE THE OWNER NAMED ──────────────────────────────────────────────────────────────────
     *
     * Your own coordinates for a guard, so a post goes exactly where you want it rather than
     * wherever the zone's own layout puts one. One list per GUARD, not per zone, because a place
     * that suits a sentry rarely suits a boss.
     *
     * `{ x, y, z, yaw, note, on }` in CENTIMETRES — the frame the game, the map, the bridge and the
     * admin console all speak, so a coordinate copied off any of them goes straight in.
     *
     * ⚠ **AN INCOMPLETE POINT IS NOT A PLACE AND IS NOT GUESSED AT.** `Number('')` is 0 and 0,0,0
     * is a real place on the island — the admin console shipped exactly that once and read an empty
     * form as "aimed at the origin". A point with a box left empty is dropped here and counted, and
     * the tab already says so beside it.
     *
     * ⚠ **`note` IS THE OWNER'S OWN DATA.** Never keyed, never translated, never rewritten — the
     * same rule this plugin already keeps for a zone's name and a message template.
     *
     * ⚠ **`on: false` IS A POINT KEPT AND NOT USED**, which is a different thing from a point
     * deleted, and it is why the switch exists. Absent is ON, because every point ever written by
     * the screen carries the key and one written by hand should not vanish.
     */
    function normAt(raw) {
      if (!Array.isArray(raw)) return { pts: [], dropped: 0 };
      const pts = [];
      let dropped = 0;
      for (const p of raw) {
        if (!p || typeof p !== 'object') { dropped++; continue; }
        if (p.on === false) continue;                      // kept in the configuration, not used
        const x = Number(p.x); const y = Number(p.y); const z = Number(p.z);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) { dropped++; continue; }
        pts.push({
          x: Math.round(x), y: Math.round(y), z: Math.round(z),
          yaw: Math.max(0, Math.min(360, Math.round(nz(p.yaw, 0)))),
          note: String(p.note == null ? '' : p.note),
        });
      }
      return { pts, dropped };
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
        const named = normAt(t.at);
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
          // How many of THIS guard the zone should hold, as a number rather than as a share of the
          // places. ⚠ 0 AND ABSENT MUST MEAN THE SAME THING and must mean exactly the share-by-weight
          // behaviour that was here before: every configuration ever written lacks this key, so any
          // other reading of the default changes what somebody already set.
          want: Math.max(0, Math.min(500, Math.round(nz(t.want, 0)))),
          label: String(t.label || '').trim(),
          /**
           * ⚠ **ABSENT INHERITS, IT DOES NOT MEAN OFF.** A per-entry window is an OVERRIDE of the
           * zone's, so `undefined` takes the zone's whole object and any value present takes the
           * entry's — key presence, the rule the whole configuration is merged by. Every entry
           * written before this key existed has no `gameTime`, so every one of them inherits, and a
           * zone with no window of its own is the `enabled: false` default: always open.
           */
          /**
           * ── THE THREE NUMBERS THAT REALLY ARE PER GUARD ──────────────────────────────────────
           *
           * `undefined` is INHERIT and it is the only honest absent value here: `0` is a real
           * setting on all three — no cooldown, no keep-away, a post that refills the instant it
           * empties — so a truthiness test would silently hand the zone's number back to an owner
           * who typed a zero. Key presence, the rule the whole configuration is merged by.
           *
           * ⚠ **AND THE OTHER THREE THE TAB ASKED ABOUT ARE NOT HERE, ON PURPOSE.** `maxPosts` is a
           * count of the zone's PLACES and the places are laid out before any guard is assigned to
           * one, so a per-guard version of it cannot be expressed at all; `maxGuards` and
           * `cooldownSeconds` are zone-wide brakes tangled into the census and the zone's own clock,
           * and a half-done per-guard version of either is worse than none. `/status` publishes the
           * list rather than this file arguing about it — see `guardOverridable`.
           */
          // The game's own random spawn, if this row is one. A random entry names no class and no
          // spawn name, so `typeWord` gives it one of its own and `typeHolds` judges its post by
          // kind — see both. An unknown key is dropped below with everything else that names
          // nothing to send, rather than quietly becoming an ordinary guard.
          random: String(t.random || '').trim(),
          /**
           * ⚠ **ABSENT IS "THE ZONE CHOOSES", WHICH IS EXACTLY WHAT EVERY CONFIGURATION WRITTEN
           * BEFORE THIS KEY CARRIES.** Key presence, the rule the whole configuration is merged by:
           * no `at` and an empty `at` both behave as this plugin always has, and `andAuto` only
           * ever means anything beside a list that has something in it.
           */
          at: named.pts,
          atDropped: named.dropped,
          andAuto: t.andAuto === true,
          postRadius: ownNum(t, 'postRadius', 200, 20000),
          afterDeathSeconds: ownNum(t, 'afterDeathSeconds', 0, 86400),
          keepAwayFromPlayers: ownNum(t, 'keepAwayFromPlayers', 0, 100000),
          gameTime: (t.gameTime && typeof t.gameTime === 'object')
            ? merge(t.gameTime, (r.gameTime && typeof r.gameTime === 'object') ? r.gameTime : DEFAULTS.sentries.replace.gameTime)
            : ((r.gameTime && typeof r.gameTime === 'object') ? r.gameTime : DEFAULTS.sentries.replace.gameTime),
        };
        // ⚠ A RANDOM ENTRY IS KEPT ONLY IF THE CATALOGUE KNOWS ITS KEY. `typeWord` gives every
        // random row a word, so the old test alone would have passed a misspelt key straight
        // through to a verb that does not exist.
        if (one.random && !randomFor(one)) continue;
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
     *
     * ⚠ **A NUMBER BEATS A SHARE, AND A SHARE IS WHAT IS LEFT OVER.** An entry naming `want` takes
     * `ceil(want / count)` places off the top, in list order; the rest are shared by weight among the
     * entries that named no number, exactly as they always were. Where every entry named a number and
     * there are more places than they add up to, the spare places are given to NOBODY — filling them
     * would quietly overshoot the count somebody asked for, and the patrol says how many are spare
     * instead. With no `want` anywhere this is the weight walk and nothing else.
     */
    function byWeight(list, i) {
      const total = list.reduce((n, t) => n + t.weight, 0);
      let at = ((i % total) + total) % total;
      for (const t of list) {
        if (at < t.weight) return t;
        at -= t.weight;
      }
      return list[0];
    }
    /**
     * The guards that will take a place the ZONE chose.
     *
     * ⚠ **"MY POINTS AND NOTHING ELSE" IS THE DEFAULT ONCE A POINT IS NAMED, AND IT HAS TO BE
     * HONOURED HERE OR IT IS NOT HONOURED ANYWHERE.** A guard with named points is out of the
     * share-out entirely unless its own `andAuto` is on, so the places the zone lays out go to the
     * guards that asked for none. A zone where every guard has named points therefore lays out no
     * places of its own at all, which is also what makes it free: nothing is probed for.
     */
    const autoTypesOf = (types) => types.filter((t) => !t.at.length || t.andAuto === true);

    function typeForPost(types, p, i) {
      if (!types.length) return null;
      /**
       * ⚠ **A NAMED PLACE ALREADY SAYS WHOSE IT IS, so nothing is shared out for it.** The whole
       * weight/quota walk exists to decide which guard stands at an ANONYMOUS post; a point an
       * owner typed onto one guard's row belongs to that guard and to no other. The index is the
       * identity and the word confirms it, exactly as below — a reordered list must move nobody.
       */
      if (p && p.named) {
        const at = Number(p.gti);
        if (Number.isInteger(at) && types[at] && typeWord(types[at]) === String(p.gt)) return types[at];
        return types.find((t) => typeWord(t) === String(p.gt)) || null;
      }
      const auto = autoTypesOf(types);
      if (!auto.length) return null;
      if (auto.length !== types.length) return typeForPost(auto, p, i);
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
      const quota = types.map((t) => (t.want > 0 ? Math.max(1, Math.ceil(t.want / countFor(t))) : 0));
      const fixed = quota.reduce((a, b) => a + b, 0);
      if (!fixed) return byWeight(types, i);
      if (i < fixed) {
        let at = i;
        for (let k = 0; k < types.length; k++) {
          if (at < quota[k]) return types[k];
          at -= quota[k];
        }
      }
      const rest = types.filter((t) => !(t.want > 0));
      return rest.length ? byWeight(rest, i - fixed) : null;
    }

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
    // Kept per 5 m cell for half an hour: a player's column is asked about every patrol while they
    // are in a zone, and the ground does not move. A column with no surface is not kept, because
    // the level may simply not be streamed in yet.
    const topCache = new Map();
    /**
     * ⚠ **"THE BRIDGE COULD NOT BE ASKED" AND "THERE IS NO GROUND HERE" ARE OPPOSITE FINDINGS AND
     * BOTH USED TO BE `null`.** One is a module somebody can switch on; the other is a place to move
     * a rectangle away from. Collapsed into one answer they reached the screen as neither: the posts
     * were left unplaced, the patrol skipped them without a word, and a zone that had drawn its
     * rectangle stood with no guards and no reason given anywhere.
     *
     * `{ z, inWater }` for a surface, `{ none: true, why }` for everything else — and `why` is the
     * module's own sentence wherever it gave one.
     */
    // The game builds a part of the map only while a player is near enough.
    const NO_GROUND_HERE = 'the game found no surface here; this part of the map may not be built yet';
    async function tracedGround(x, y) {
      const key = `${Math.round(x / 500)},${Math.round(y / 500)}`;
      const hit = topCache.get(key);
      if (hit && Date.now() - hit.at < 30 * 60000) return hit.v;
      let refused = null;
      let answered = false;
      for (const from of [65000, 45000, 25000, 5000, -15000]) {
        const q = await bq('whereIs', x, y, from);
        if (!q.ok) { refused = refused || await whyOf(q, 'place', 'where the ground is'); continue; }
        const r = q.data;
        if (!r) { refused = refused || NO_BRIDGE_ANSWER; continue; }
        if (r.error) { refused = refused || ((r.reason || r.error) || null); continue; }
        answered = true;
        const z = nz(r.groundZ, NaN);
        if (Number.isFinite(z)) {
          const v = { z, inWater: r.inWater === true };
          if (topCache.size > 4000) topCache.clear();
          topCache.set(key, { at: Date.now(), v });
          return v;
        }
      }
      // Every probe answered and none of them found a surface: that is a fact about the world.
      // Anything else is a fact about the bridge, and it carries the bridge's own words.
      return { none: true, why: answered ? NO_GROUND_HERE : (refused || NO_BRIDGE_ANSWER) };
    }

    /**
     * ⚠ **THE FIRST SURFACE FROM THE SKY IS A ROOF WHEREVER A BUILDING STANDS.** `tracedGround` takes
     * the topmost hit, so a spot laid out over a town put guards on the roofs — the owner saw exactly
     * that in a town. Measured over a town's own guard posts: at open ground a trace
     * started one metre under the surface finds nothing within 200 m, while one post's surface at
     * 23423 had a floor 16 m under it that the game calls `indoorSmall`. So a spot is ground only when
     * nothing lies under its surface and the game calls the air above it outdoors.
     *
     * ⚠ **AND A ROOF IS NOT A REASON TO GIVE UP ON THE PLACE — IT IS A REASON TO LOOK UNDER IT.**
     * Every place with something over it used to be thrown away outright, and in a town that is the
     * whole grid: a zone over Samobor laid nothing out, dropped its posts, and remembered each point
     * as hopeless for the life of the process. Players walk about inside those buildings and the
     * game's puppets stand in them, so a guard belongs there too. The reading that decides it is
     * already in the same reply — `freeSpot` is the game's own collision check against a real
     * prisoner's shape, `movedCm` says how far it had to move one to find room, and `groundZ` at
     * that height says the floor really is where the trace put it. That is exactly the test the
     * tunnels under the map are learned by, applied where the roof belongs to a building.
     *
     * ⚠ **IT SAYS A GUARD FITS. IT DOES NOT SAY A GUARD CAN GET OUT.** Nothing in this product can
     * answer that — not the bridge, not the game's own data — so nothing here pretends to. An inside
     * place is a floor with room for a body on it, and whether anything can walk from there to
     * anywhere else is not established.
     *
     * `{ z }` for a place in the open, `{ z, inside: true }` for one under a roof,
     * `{ reject: 'water' | 'structure' | 'indoors' }` for one a guard cannot stand on, and
     * `{ unknown: true, why }` when nothing could be found out — which places nothing and says so.
     */
    // ⚠ 3 -> 4: a roofed spot now settles on the LOWEST floor of the building rather
    // than the first one under the roof, so every place settled by the old rule has to be asked
    // again. The stamp is what makes that happen by itself, on the next patrol, with no migration.
    const SPOT_VERSION = 4;
    // How far the game may move a prisoner to find room before that stops being "there is room
    // here", and how far the floor under a body may be from the floor the trace found.
    const FITS_MOVED_CM = 60;
    const FLOOR_AGREES_CM = 150;
    // How far under the first surface from the sky that surface's own floor may be before the pair
    // stops being a building and starts being two different places. See `standableAsk`.
    const ROOM_UNDER_ROOF_CM = 2000;
    // Answers per 5 m cell, for half an hour: the spots near a player are asked about every patrol,
    // and the ground does not move.
    const spotCache = new Map();
    async function standableAt(x, y) {
      const key = `${Math.round(x / 500)},${Math.round(y / 500)}`;
      const hit = spotCache.get(key);
      if (hit && Date.now() - hit.at < 30 * 60000) return hit.v;
      const v = await standableAsk(x, y);
      // ⚠ NEVER CACHE "I COULD NOT FIND OUT". Half an hour of a remembered non-answer is half an hour
      // of a zone that cannot recover when the module is switched back on.
      if (v && !v.unknown) {
        if (spotCache.size > 4000) spotCache.clear();
        spotCache.set(key, { at: Date.now(), v });
      }
      return v;
    }
    /** What one `whereIs` reply says about standing on the floor it reports. */
    function fitsHere(w, floorZ) {
      if (w.inWater === true) return { reject: 'water' };
      const g = nz(w.groundZ, NaN);
      if (!Number.isFinite(g) || Math.abs(g - floorZ) > FLOOR_AGREES_CM) return { reject: 'indoors' };
      // ⚠ THE COLLISION CHECK IS ASKED ABOUT A REAL PRISONER'S SHAPE, so with nobody on the server
      // there is nobody to ask about and the key is absent. That is not a refusal of the place — and
      // reading it as one would blacklist a whole town because the server happened to be empty.
      if (!w.freeSpot || typeof w.freeSpot !== 'object') {
        // The game answers this against a real prisoner's shape.
        return { unknown: true, why: 'whether a body fits here is unknown; it needs a player on the server' };
      }
      if (!(w.freeSpot.found === true && nz(w.freeSpot.movedCm, Infinity) <= FITS_MOVED_CM)) {
        return { reject: 'indoors' };
      }
      return { z: g, inside: true };
    }
    /** Is there room for a guard on the floor at `floorZ`, under whatever is over it? */
    async function roomUnder(x, y, floorZ) {
      const q = await bq('whereIs', x, y, floorZ + STAND_ABOVE_GROUND_CM);
      if (!q.ok) return { unknown: true, why: await whyOf(q, 'place', 'where the ground is') };
      const w = q.data;
      if (!w) return { unknown: true, why: NO_BRIDGE_ANSWER };
      if (w.error) return { unknown: true, why: (w.reason || w.error) || NO_BRIDGE_ANSWER };
      const v = fitsHere(w, floorZ);
      // A floor under a roof with no room on it is what it always was: a wall, a beam, a vehicle, a
      // rock overhang. It keeps the name it had so the counts on the card still mean one thing.
      return v.reject === 'indoors' ? { reject: 'structure' } : v;
    }
    /**
     * ⚠ **THE FIRST FLOOR UNDER A ROOF IS THE TOP STOREY, AND PLAYERS ARE ON THE BOTTOM ONE.**
     *
     * Measured on a test server, one column of a real building with somebody
     * standing in it. `place where:` traces from the z it is asked about DOWNWARD (150 cm above it,
     * 200 m of reach — the bridge's own note), so walking the column one floor at a time reads:
     *
     *     roof    23313.5
     *     floor   22841.7   <- what the old rule picked: the TOP storey
     *     floor   22604.8
     *     floor   22164.8   <- the floor the player was standing on
     *     floor   21724.8
     *     floor   21284.8
     *     floor   21064.8   <- the bottom
     *     (nothing below)
     *
     * Every one of them `Indoor_Medium` with room for a body. So the old rule put a guard six and a
     * half metres above the player, on the top floor of a six-storey building, and nothing said so:
     * the answer was a floor, it was inside, and it was not the floor anybody uses.
     *
     * This walks down instead and takes the LOWEST floor that has room. The ground floor is the one
     * with a way in from outside, which is the nearest this product can get to "a guard a player
     * will actually meet" — and the header above is still honest that nothing here can prove a guard
     * can walk out of a room.
     *
     * Two bounds, both of them the same rule the first step already had. A gap wider than
     * `ROOM_UNDER_ROOF_CM` is not the next storey of this building — it is the tunnel twenty-three
     * metres under a field that dragged four learned tunnel floors onto a slab once already — and
     * the walk stops at `MAX_STOREYS` so a column of scaffolding cannot cost a patrol fifty reads.
     * A floor with no room does NOT stop the walk: a beam or a parked vehicle on the top floor is no
     * reason to give up on the ground floor under it.
     */
    const MAX_STOREYS = 6;
    async function lowestFloorUnder(x, y, firstFloor) {
      let best = null;
      let unknown = null;
      let z = firstFloor;
      for (let i = 0; i < MAX_STOREYS; i++) {
        const v = await roomUnder(x, y, z);
        // ⚠ "I COULD NOT FIND OUT" ONLY WINS WHILE NOTHING HAS BEEN FOUND. Once a floor with room is
        // in hand, a storey below that cannot be judged is simply not taken — reporting the whole
        // column as unanswerable would throw away an answer we already have.
        if (v.unknown) { if (!best) unknown = v; break; }
        if (!v.reject) best = { z: v.z, storeys: i + 1 };
        // ⚠ **250, AND IT MUST STAY OVER 150.** The game's trace starts 150 cm ABOVE the z it is
        // asked about, so a step of 40 re-finds the surface it has just reported — measured while
        // the column reader was being written, one floor reported eight times in a loop that could
        // not end. Every step down this file takes is 250.
        const nq = await bq('whereIs', x, y, z - 250);
        const next = nq.ok ? nq.data : null;
        if (!next || next.error) break;
        const g = nz(next.groundZ, NaN);
        if (!Number.isFinite(g) || g >= z - 50) break;          // nothing below, or not below at all
        if (z - g > ROOM_UNDER_ROOF_CM) break;                  // too far down to be this building
        z = g;
      }
      if (best) return { z: best.z, inside: true, storeys: best.storeys };
      if (unknown) return unknown;
      // Every storey answered and not one of them had room for a body: a wall, a beam, a rock
      // overhang. It keeps the name it always had so the counts on the card still mean one thing.
      return { reject: 'structure' };
    }

    async function standableAsk(x, y) {
      const top = await tracedGround(x, y);
      if (!top || top.none) return { unknown: true, why: (top && top.why) || NO_BRIDGE_ANSWER };
      const bq1 = await bq('whereIs', x, y, top.z - 250);            // the trace starts 100 cm under it
      if (!bq1.ok) return { unknown: true, why: await whyOf(bq1, 'place', 'where the ground is') };
      const below = bq1.data;
      if (!below) return { unknown: true, why: NO_BRIDGE_ANSWER };
      if (below.error) return { unknown: true, why: (below.reason || below.error) || NO_BRIDGE_ANSWER };
      const under = nz(below.groundZ, NaN);
      // Something lies under the first surface from the sky, so that surface is a ROOF and `under` is
      // the floor beneath it. The guard goes on the floor.
      //
      // ⚠ **ONLY WHEN IT IS NEAR ENOUGH TO BE A ROOM.** That trace looks 200 m down, so without a
      // bound ANY hit below counts as "the floor of the building overhead" — and under open ground a
      // tunnel twenty-three metres down is such a hit. Driven: a place on the surface above a tunnel
      // was settled on the TUNNEL'S OWN ROOF SLAB, so a guard meant to stand in a field was sent
      // 23 m underground, and a learned tunnel floor was dragged up onto that same slab. A tunnel is
      // reached by a player walking into it (`learnUnder`), never by a trace from the sky.
      const roofed = Number.isFinite(under) && under < top.z - 50;
      // Measured in Samobor: a house floor sat 16 m under the surface the trace found. So the bound
      // is over that and far under a tunnel's depth.
      if (roofed && top.z - under > ROOM_UNDER_ROOF_CM) return { reject: 'structure' };
      if (roofed) return lowestFloorUnder(x, y, under);
      const bq2 = await bq('whereIs', x, y, top.z + STAND_ABOVE_GROUND_CM);
      if (!bq2.ok) return { unknown: true, why: await whyOf(bq2, 'place', 'where the ground is') };
      const air = bq2.data;
      if (!air) return { unknown: true, why: NO_BRIDGE_ANSWER };
      if (air.error) return { unknown: true, why: (air.reason || air.error) || NO_BRIDGE_ANSWER };
      if (air.inWater === true) return { reject: 'water' };
      const env = air.environment || {};
      // Inside, with nothing over its own roof — a hangar, a hall, a shelter. The floor the trace
      // found IS the floor, and the same test decides it.
      if (env.indoor === true || env.underground === true) return fitsHere(air, top.z);
      return { z: top.z };
    }

    /**
     * ⚠ **THE 25-POINT HUNT IS GONE, AND WHAT IT COST IS WHY.**
     *
     * `findStandable()` used to ring every place that would not settle with eight points at 8 m,
     * eight at 16 m and eight at 30 m, and ask about all twenty-five. Each one is six to nineteen
     * `whereIs` round trips, three places a round: about 450 sequential round trips in one patrol
     * for a single unplaceable place, each on its own socket, on a five-second clock.
     *
     * It existed because the plugin had to hunt for ground near a point NOBODY CHOSE. Both halves
     * of that have gone: a point an owner named is REFUSED by name rather than swapped for one
     * thirty metres away, and a place the zone chose for itself is discarded and another candidate
     * drawn — which costs one place's worth of calls instead of twenty-five and cannot invent a
     * place. What is left here is the VALIDATOR, which the audit says to keep entirely.
     */

    /**
     * What the game says about ONE point, at the height the owner named. `{ ok, z, ... }`, or
     * `{ code, why }` with the game's own word for it, or `{ unknown, why }`.
     *
     * The single reader for a named point: `POST /check-spot` draws it on the screen and
     * `placePosts` acts on it, so the answer a person is shown and the answer the patrol obeys
     * cannot be two different readings.
     */
    const NAMED_CACHE_MS = 30 * 60000;
    const namedCache = new Map();
    async function checkPoint(x, y, z) {
      const key = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
      const hit = namedCache.get(key);
      if (hit && Date.now() - hit.at < NAMED_CACHE_MS) return hit.v;
      const v = await checkPointAsk(x, y, z);
      // ⚠ NEVER CACHE "I COULD NOT FIND OUT": half an hour of a remembered non-answer is half an
      // hour of a point that cannot recover when the module is switched back on.
      if (v && !v.unknown) {
        if (namedCache.size > 2000) namedCache.clear();
        namedCache.set(key, { at: Date.now(), v });
      }
      return v;
    }
    async function checkPointAsk(x, y, z) {
      const q = await bq('whereIs', x, y, nz(z, 0) + STAND_ABOVE_GROUND_CM);
      if (!q.ok) return { unknown: true, why: await whyOf(q, 'place', 'what is at that spot') };
      const w = q.data;
      if (!w || w.error) {
        return { unknown: true, why: (w && (w.reason || w.error)) || NO_BRIDGE_ANSWER };
      }
      /**
       * ⚠ **A LEVEL THAT IS NOT BUILT IS NOT A BAD COORDINATE.** SCUM streams a place in while a
       * player is near it, and the bridge says which of the two this is. Drawing "the game has not
       * built this yet" in red tells an owner their correct coordinate is wrong and sends them to
       * change the one thing that was right — which is the whole reason `unknown` is a third
       * answer rather than a refusal.
       */
      if (w.levelLoaded === false) {
        // The game builds a place only while a player is near it, e.g. a tunnel or a far corner.
        return { unknown: true, why: 'this part of the map is not built right now, as nobody is near. '
          + 'The point is kept as typed.' };
      }
      const g = nz(w.groundZ, NaN);
      if (!Number.isFinite(g)) {
        return { code: 'no_ground', why: 'the game found no surface within 200 m below this point.' };
      }
      if (w.inWater === true) return { code: 'water', why: 'the game says this point is in water.' };
      const env = w.environment || {};
      const off = Math.round(nz(z, 0) - g);
      if (Math.abs(off) > FLOOR_AGREES_CM) {
        return { code: 'no_ground',
          why: `the floor here is at ${Math.round(g)} cm, `
            + `${Math.abs(Math.round(off / 100))} m ${off > 0 ? 'below' : 'above'} the height typed. `
            + 'Use that, or take your position there.' };
      }
      // The game's own collision check, against a real prisoner's shape. Absent means there was
      // nobody on the server to ask about, which is not a refusal of the place.
      const fit = fitsHere(w, g);
      if (fit.unknown) return { unknown: true, why: fit.why };
      if (fit.reject) {
        const indoors = env.indoor === true || env.underground === true;
        return { code: indoors ? 'indoors' : 'structure',
          why: indoors
            ? 'the game found no room for a body on this floor — something is standing in it.'
            : 'the game found something solid in the way at this point.' };
      }
      return {
        ok: true,
        z: g,
        /**
         * The LIFT this point needs, MEASURED against the floor the game reported rather than
         * assumed. A guard is sent to at least `STAND_ABOVE_GROUND_CM` over the floor — a body
         * centred exactly on it is half inside the terrain and the game refuses the spawn outright
         * ("Cannot spawn at the specified location", driven; the same point accepted 120 cm up).
         *
         * ⚠ **AND A POINT TAKEN FROM A PLAYER IS ALREADY ABOVE THE FLOOR.** A prisoner's own
         * position is the capsule's centre, so "take a player's position" hands back roughly
         * 90 cm over what they are standing on. Lifting that by another 120 would put a guard two
         * metres in the air over a tunnel floor. Subtracting what is already there gets both.
         */
        lift: Math.max(0, STAND_ABOVE_GROUND_CM - (nz(z, 0) - g)),
        underground: env.underground === true,
        indoor: env.indoor === true,
        inWater: false,
        fits: true,
      };
    }

    /**
     * ══ THE POOL: WHERE A ZONE PUTS A GUARD WHEN NOBODY HAS TOLD IT ═══════════════════════════════
     *
     * A per-zone list of places the GAME has said a guard can stand on, drawn anywhere inside the
     * rectangles, found a couple at a time and then left alone for good.
     *
     * ⚠ **THE FOUR PROMISES, AND THE FOURTH IS WHY THIS IS A POOL RATHER THAN A DICE ROLL.**
     *
     *  1. **Anywhere on the map.** Nothing here depends on a sentry having stood somewhere, on the
     *     game's own authored encounter points, or on a place having been walked through. A
     *     rectangle over a field, a town, an airfield or a bunker all work the same way.
     *  2. **Not the same place twice.** The candidates come off a seeded generator whose seed is
     *     drawn once per zone and kept — never derived from the rectangle — so two servers with the
     *     same rectangle do not get the same layout, and each WAVE stands on the least recently
     *     used points rather than on the same ones again.
     *  3. **Bounded.** Measured on the live game: validating one candidate is 5.1–5.5 bridge calls
     *     and about a third of a second, and the bridge's own limiter is 15 a second with a burst of
     *     30 — forty parallel calls produced nineteen failures. So it is SERIAL and it is a couple
     *     of probes per round, and a patrol never waits for it: a zone works with whatever the pool
     *     has and the pool fills underneath it.
     *  4. **It must not wander.** A post that moves every round is a guard that is never where a
     *     player just learned it was. So a pool point is found ONCE and never re-sampled, and the
     *     set in use only ever changes at a WAVE — the moment a zone wakes up, which is already the
     *     moment the game has taken away everything that was standing in it.
     */
    const POOL_MIN_GAP_CM = 2500;        // two pool points are at least 25 m apart
    const POOL_PROBES_PER_ROUND = 2;     // ~11 bridge calls a round, serial, while the pool is short
    const POOL_DRAWS_PER_ROUND = 12;     // candidates rejected without a probe are free, not endless
    const POOL_REST_MS = 5 * 60000;      // a rectangle with nothing standable in it stops being asked
    const POOL_MISS_REST = 25;           // that many rejected in a row, with nothing found, is a rest
    const POOL_HEADROOM_TRIES = 120;     // candidates spent on the SPARE points before giving up
    const POOL_MAX = 60;                 // a ceiling on the fill cost, whatever `ownPosts` says
    const POOL_DRIFT = 0.15;             // share of the spare places swapped for new ones each wave
    /**
     * Three times the places, so a wave stands somewhere a player has not seen, and the spare ones
     * are slowly replaced (`POOL_DRIFT`), so after a few waves no layout repeats.
     */
    const poolTarget = (want) => Math.max(1, Math.min(POOL_MAX, Math.max(want + 6, want * 3)));

    /**
     * A cleared sentry is COUNTED, not guarded where it stood: a guard always on the sentry's spot
     * is a guard every player knows the place of. Each one seen adds one guard to the zone, placed
     * on the zone's own random ground. Only an admin's named point pins a guard to one place.
     */
    function sentriesOf(zoneId) {
      const all = host.store.get(K.sentrySeen, {});
      const v = (all && typeof all === 'object') ? all[String(zoneId)] : null;
      return Array.isArray(v) ? v : [];
    }
    function noteSentry(zoneId, o) {
      const at = { x: Math.round(nz(o.x, 0)), y: Math.round(nz(o.y, 0)) };
      const had = sentriesOf(zoneId);
      if (had.some((q) => near(q, at, SAME_SPOT_CM))) return;
      const all = Object.assign({}, host.store.get(K.sentrySeen, {}) || {});
      all[String(zoneId)] = had.concat([at]);
      host.store.set(K.sentrySeen, all);
    }

    /**
     * A generator with a seed of its own. `Math.random()` is right for DRAWING the seed — a restart
     * must not reproduce a layout — and wrong for drawing the candidates, because the sequence has
     * to carry on where it left off across a manager restart without repeating what it already
     * rejected. Mulberry32: thirty-two bits of state, which is what fits in the store beside it.
     */
    function rngOf(seed) {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function poolOf(zoneId) {
      const all = host.store.get(K.pool, {});
      const v = (all && typeof all === 'object') ? all[String(zoneId)] : null;
      const rec = (v && typeof v === 'object') ? v : {};
      return {
        seed: Number.isFinite(Number(rec.seed)) ? Number(rec.seed) : ((Math.random() * 0xFFFFFFFF) >>> 0),
        step: Math.max(0, nz(rec.step, 0)),
        miss: Math.max(0, nz(rec.miss, 0)),
        tries: Math.max(0, nz(rec.tries, 0)),
        done: rec.done === true,
        restUntil: Math.max(0, nz(rec.restUntil, 0)),
        pts: Array.isArray(rec.pts) ? rec.pts.slice() : [],
      };
    }
    function setPool(zoneId, rec) {
      const all = Object.assign({}, host.store.get(K.pool, {}) || {});
      const was = JSON.stringify(all[String(zoneId)] || null);
      const now = { seed: rec.seed, step: rec.step, miss: rec.miss, tries: rec.tries, done: rec.done, restUntil: rec.restUntil, pts: rec.pts };
      if (was === JSON.stringify(now)) return;           // a round that learned nothing writes nothing
      all[String(zoneId)] = now;
      host.store.set(K.pool, all);
    }
    /** The pool of a zone that has gone: nothing else ever removes it. */
    function dropPool(zoneId) {
      const all = host.store.get(K.pool, {}) || {};
      if (!all[String(zoneId)]) return;
      const next = Object.assign({}, all);
      delete next[String(zoneId)];
      host.store.set(K.pool, next);
    }

    /**
     * One candidate, inside the rectangles, off the seeded generator.
     *
     * Weighted by AREA, so a set of two rectangles one of which is ten times the size does not put
     * half the guards in the small one. The inset keeps a candidate off the boundary: a point
     * exactly on the line is one the rectangle test can put on either side of depending on which
     * way the engine nudged it.
     */
    const POOL_INSET_CM = 500;
    function drawCandidate(rects, rnd) {
      let total = 0;
      for (const r of rects) total += Math.max(1, Math.abs(nz(r.width, 0)) * Math.abs(nz(r.height, 0)));
      let pick = rnd() * total;
      let rect = rects[0];
      for (const r of rects) {
        const a = Math.max(1, Math.abs(nz(r.width, 0)) * Math.abs(nz(r.height, 0)));
        if (pick < a) { rect = r; break; }
        pick -= a;
      }
      const w = Math.max(0, Math.abs(nz(rect.width, 0)) / 2 - POOL_INSET_CM);
      const h = Math.max(0, Math.abs(nz(rect.height, 0)) / 2 - POOL_INSET_CM);
      return { x: Math.round(rect.x + (rnd() * 2 - 1) * w), y: Math.round(rect.y + (rnd() * 2 - 1) * h) };
    }

    /**
     * A couple of probes' worth of pool, and not one more this round.
     *
     * ⚠ **A CANDIDATE THAT IS NOT STANDABLE IS DISCARDED AND ANOTHER IS DRAWN.** The old code HUNTED
     * — twenty-five points in rings at 8, 16 and 30 m round every place that would not settle,
     * every one of them six to nineteen bridge calls, up to three places a round: about 450 round
     * trips in one patrol for a single unplaceable spot. Drawing another candidate costs one place's
     * worth of calls and, unlike the hunt, it does not invent a place thirty metres from one
     * somebody chose.
     */
    async function fillPool(entry, rects, posts, want, out) {
      const pool = poolOf(entry.id);
      // A rectangle an owner has edited leaves points outside it. Dropped rather than re-sampled:
      // what is still inside is still good ground and was paid for once already.
      const inside = pool.pts.filter((p) => rects.some((r) => inRect(p, r)));
      if (inside.length !== pool.pts.length) { pool.pts = inside; pool.done = false; }
      const target = poolTarget(want);
      const report = () => { out.pool = { have: pool.pts.length, want: target, need: want }; };
      report();
      /**
       * ⚠ **THE HEADROOM IS A NICETY AND THE PLACES ARE THE REQUIREMENT, AND CONFUSING THE TWO
       * COSTS A STORE WRITE EVERY PATROL ROUND FOR EVER.**
       *
       * The pool aims at twice the places the zone asked for, because that is what lets the next
       * wave stand somewhere else. A rectangle that will not give it — most of it water, roofs or
       * rock — then has the zone drawing candidates for the rest of the server's life: two probes
       * a round, and a pool record that changed (the generator advanced, a miss was counted) and
       * so was written to disk every five seconds. Measured on a rectangle that was 12% standable:
       * one store write per round, for ever, on a zone that had laid out every place it wanted.
       *
       * So the headroom gets a BOUNDED number of tries and then the pool is done. It is re-opened
       * by the one thing that can change the answer — the pool dropping below what the zone asks
       * for, which is an owner editing the rectangle or raising the number of places.
       */
      if (pool.pts.length >= want && pool.done) { setPool(entry.id, pool); return; }
      /**
       * ⚠ **RESTING IS A STATE, NOT AN EVENT, AND SAYING IT ONCE SAID IT TO NOBODY.** The card
       * draws the LAST patrol's refusals, so a sentence pushed only on the round the rest began is
       * gone by the next round — and the owner is left with a zone holding no places and not one
       * word about why, which is the state this sentence exists for.
       */
      if (Date.now() < pool.restUntil) { out.poolRest = true; setPool(entry.id, pool); return; }
      if (pool.pts.length >= target) { pool.done = true; setPool(entry.id, pool); return; }
      let probes = 0;
      let draws = 0;
      const rnd = rngOf((pool.seed + pool.step * 0x9E3779B1) >>> 0);
      while (probes < POOL_PROBES_PER_ROUND && draws < POOL_DRAWS_PER_ROUND && pool.pts.length < target) {
        draws++;
        pool.step++;
        const c = drawCandidate(rects, rnd);
        // Free rejections first, so a probe is never spent on a place we already hold.
        if (pool.pts.some((p) => near(p, c, POOL_MIN_GAP_CM))) continue;
        /**
         * ⚠ **AN UNDERGROUND FLOOR IS A DIFFERENT PLACE FROM THE SURFACE OVER IT, whatever its x
         * and y are.** `postFrom` has always said so for the places a cleared sentry leaves; the
         * pool needed telling too, or a tunnel somebody walked through last week silently blocks
         * every candidate in the field above it — for free, with no bridge call, so nothing on any
         * screen would ever have shown which places went missing or why.
         */
        if (posts.some((p) => !p.under && near(p, c, POOL_MIN_GAP_CM))) continue;
        probes++;
        /**
         * ⚠ **THE BUDGET IS COUNTED IN BRIDGE CALLS, NOT IN CANDIDATES.** Counted in draws it was
         * spent by the FREE rejections — a candidate that lands near a point already held costs
         * nothing at all — so a dozen of those a round exhausted the headroom in four rounds and
         * the pool stopped at whatever it happened to hold. Measured: a rectangle that is
         * three-quarters good ground ended with exactly as many places as the zone asked for and
         * no spare, so consecutive waves had nothing else to stand on and the whole point of the
         * pool was quietly gone. What is being bounded is the SPEND.
         */
        pool.tries = nz(pool.tries, 0) + 1;
        const g = await standableAt(c.x, c.y);
        // ⚠ NOTHING COULD BE FOUND OUT, so nothing is decided and nothing is counted against the
        // rectangle. Filling stops for this round and the reason travels; a rest here would be a
        // zone that gives up because a module was switched off for a minute.
        if (!g || g.unknown) { out.poolWhy = (g && g.why) || NO_BRIDGE_ANSWER; break; }
        if (g.reject) { pool.miss++; continue; }
        pool.pts.push({
          x: c.x, y: c.y, z: g.z,
          // What the GAME called the place. `indoor` is a floor under a roof — a house, a hangar —
          // which `standableAt` settles on the lowest storey of. Underground is not reachable from
          // a trace out of the sky and never claimed here; that comes from a player walking it.
          kind: g.inside === true ? 'indoor' : 'outdoor',
          foundAt: Date.now(), usedAt: 0,
        });
        pool.miss = 0;
      }
      /**
       * ⚠ **A RECTANGLE CAN BE FULL WITHOUT THE POOL BEING FULL, AND THAT IS NOT A DEFECT.** The
       * points are kept apart on purpose, so a small rectangle runs out of room for another one
       * long before the target is reached — and a round that drew a dozen candidates and rejected
       * every one of them for being too close to a point already held has learned exactly that.
       * Those rejections are free, so nothing on any screen would ever have shown it.
       */
      if (!probes && draws >= POOL_DRAWS_PER_ROUND) pool.done = true;
      // The headroom's budget, spent. Everything the zone asked for is there; the extra is not
      // coming out of this rectangle and is not worth another call.
      if (pool.pts.length >= want && nz(pool.tries, 0) >= POOL_HEADROOM_TRIES) pool.done = true;
      /**
       * ⚠ **A REST, NOT A SENTENCE.** A rectangle over water, a cliff or a roofed compound can run
       * out of standable ground entirely, and asking for ever costs a handful of bridge calls a
       * round for nothing. After enough misses in a row it waits, and then asks again — a zone
       * that gave up for good is a zone that quietly disarms itself, which is worse than one that
       * never armed because nobody notices. This is the branch for a zone that is SHORT; the two
       * above are for one that has what it needs.
       */
      if (pool.pts.length < want && pool.miss >= POOL_MISS_REST) {
        pool.restUntil = Date.now() + POOL_REST_MS;
        pool.miss = 0;
        out.poolRest = true;
      }
      setPool(entry.id, pool);
      report();
    }

    /**
     * Which of the pool this wave stands on.
     *
     * Least recently used first, so consecutive waves do not reuse a point while the pool has
     * others. Within a wave nothing moves: a post is added or retired here and nowhere else, and a
     * wave boundary is the moment the zone wakes up — which is already the moment the game has
     * taken away everything that was standing in it, so nothing is being pulled out from under a
     * player.
     */
    function usePool(entry, posts, rects, want, maxPosts, newWave, out) {
      const pool = poolOf(entry.id);
      if (!pool.pts.length) return;
      const surfaceCount = () => posts.filter((p) => !p.under && !p.hold).length;
      const mine = posts.filter((p) => p.pool === true);
      const held = new Set(mine.map((p) => `${p.x},${p.y}`));
      const inside = (p) => rects.some((r) => inRect(p, r));
      const order = pool.pts.slice().sort((a, b) => nz(a.usedAt, 0) - nz(b.usedAt, 0)
        || nz(a.foundAt, 0) - nz(b.foundAt, 0));
      const room = Math.max(0, maxPosts - (surfaceCount() - mine.length));
      let adopt = [];
      let drifted = false;
      // Its own generator, so choosing places never shifts `Math.random` for anything else.
      const pick = rngOf((pool.seed ^ Math.floor(Date.now() / 1000) ^ (pool.step * 0x9E3779B1)) >>> 0);
      if (newWave) {
        /**
         * A wave: the whole set is chosen again, least recently used first, so consecutive waves
         * do not stand on the same points while the pool has others. The ones this wave is not
         * using are retired — safe here and nowhere else, because a wave boundary is the moment
         * the zone woke up and the game has already taken away everything that was standing in it.
         */
        const take = Math.max(0, Math.min(want, room));
        const chosen = order.filter(inside).slice(0, take);
        // Swap a share of the spare places for new ground, so the layout keeps changing.
        if (pool.done && pool.pts.length > take) {
          const chosenKey = new Set(chosen.map((q) => `${q.x},${q.y}`));
          const spare = pool.pts.filter((q) => !chosenKey.has(`${q.x},${q.y}`));
          let drop = Math.max(1, Math.round(spare.length * POOL_DRIFT));
          while (drop-- > 0 && spare.length) {
            const k = Math.floor(pick() * spare.length);
            const gone = spare.splice(k, 1)[0];
            pool.pts = pool.pts.filter((q) => q !== gone);
          }
          pool.done = false; pool.tries = 0; drifted = true;
        }
        const keep = new Set(chosen.map((p) => `${p.x},${p.y}`));
        for (let i = posts.length - 1; i >= 0; i--) {
          if (posts[i].pool === true && !keep.has(`${posts[i].x},${posts[i].y}`)) dropPost(posts, i);
        }
        adopt = chosen.filter((p) => !held.has(`${p.x},${p.y}`));
      } else {
        /**
         * ⚠ **BETWEEN WAVES IT ONLY EVER TOPS UP, AND READING THIS AS "CHOOSE AGAIN" ADDS PLACES
         * FOR EVER.** The pool fills a couple of points a round, so the first rounds of a zone
         * stand on fewer places than it asked for; choosing the whole set again each round picked
         * the points it had NOT just used — the least recently used ones — and added them beside
         * the ones already standing. A zone asking for three ended up with five.
         */
        const need = Math.max(0, Math.min(want - mine.length, room - mine.length));
        if (need <= 0) return;
        adopt = order.filter((p) => inside(p) && !held.has(`${p.x},${p.y}`)).slice(0, need);
      }
      if (!adopt.length) { if (drifted) setPool(entry.id, pool); return; }
      for (const p of adopt) {
        p.usedAt = Date.now();
        posts.push({
          x: p.x, y: p.y, z: p.z, pool: true, own: true, ground: true, inside: p.kind === 'indoor',
          spot: SPOT_VERSION, emptySince: 0, everHeld: false,
        });
      }
      // ⚠ WRITTEN ONLY WHERE SOMETHING WAS ADOPTED. `usedAt` moves on every stamp, so a `setPool`
      // outside this branch is a store write every patrol round, for ever, for a number nothing
      // read that round — which is the file rewrite every few seconds this plugin already avoids
      // for its patrol clocks.
      setPool(entry.id, pool);
      if (out) out.poolUsed = mine.length + adopt.length;
    }

    /**
     * A post as first recorded: where it came from, and no height yet. `placePosts` finds the ground a
     * guard can stand on at or near it before anything is sent there.
     */
    function newPost(x, y, extra) {
      return Object.assign({ x, y, z: 0, from: { x, y }, emptySince: 0, everHeld: false }, extra || {});
    }

    // Places in a zone where no ground a guard could stand on was found within 30 m, so the grid and
    // the cleared sentries do not lay a post there again every patrol. In memory: after a restart they
    // are asked about once more, from the answers the game gives in a few calls.
    //
    // ⚠ **A REST, NOT A SENTENCE.** This used to hold for the life of the process, so one sweep taken
    // while a place was half built — or while a rule was narrower than it is now — narrowed the zone
    // permanently and nothing could widen it again but a restart. It is forgotten on the same clock
    // as the answers it came from, and the zone simply asks again.
    const NO_GROUND_REST_MS = 30 * 60000;
    const noGround = {};
    function noGroundNear(zoneId, at) {
      const list = noGround[String(zoneId)];
      if (!list || !list.length) return false;
      const cut = Date.now() - NO_GROUND_REST_MS;
      const live = list.filter((q) => nz(q.at, 0) > cut);
      if (live.length !== list.length) noGround[String(zoneId)] = live;
      return live.some(at);
    }
    function postFrom(zoneId, posts, o) {
      const at = (q) => q && near(q, o, SAME_SPOT_CM);
      // An underground spot is a different place from the surface over it, whatever its x and y.
      return posts.some((p) => !p.under && (at(p) || at(p.from) || at(p.home)))
        || noGroundNear(zoneId, at);
    }

    /**
     * Put every post that has not been placed yet onto open ground: its own spot where that is ground,
     * else the nearest one within 30 m, else the post is dropped. A few per patrol, so a zone of sixty
     * posts does not make a hundred calls in one round.
     */
    async function placePosts(entry, posts, rects, out) {
      let asked = 0;
      const dropped = { water: 0, structure: 0, indoors: 0 };
      let movedN = 0;
      let insideN = 0;
      let unknownWhy = null;
      for (let i = 0; i < posts.length && asked < 3;) {
        const p = posts[i];
        if (p.spot === SPOT_VERSION) { i++; continue; }
        // ⚠ **AN UNDERGROUND PLACE IS NEVER SETTLED FROM THE SKY.** Its floor was established by a
        // player standing on it and by the game's own collision check (`learnUnder`); a downward
        // trace from over the terrain cannot reach a tunnel and would "settle" it on whatever slab
        // lies between — the surface itself, or the tunnel's own roof. Driven: bumping the placement
        // rule dragged four learned tunnel floors up onto that slab, and the guards went with them.
        // It carries the current stamp so nothing downstream reads it as unsettled.
        if (p.under) { p.spot = SPOT_VERSION; i++; continue; }
        /**
         * ── A PLACE THE OWNER NAMED IS VALIDATED, AND REFUSED BY NAME ─────────────────────────
         *
         * ⚠ **IT IS NEVER MOVED.** An owner who typed a coordinate meant that coordinate, and
         * quietly standing a guard thirty metres away is the swap this project already records for
         * art — in the one place where it puts a boss somewhere nobody chose. So the point is
         * asked about once, kept if the game takes it, and REFUSED WITH THE GAME'S OWN WORD and
         * its own three numbers if it does not. It is asked again later, because a level the game
         * has not built yet is not a mistake and neither is a module somebody has switched off.
         */
        if (p.named) {
          asked++;
          const v = await checkPoint(p.x, p.y, p.z);
          if (v.unknown) { unknownWhy = v.why || NO_BRIDGE_ANSWER; break; }
          if (v.code) {
            p.badPoint = { code: v.code, why: v.why, at: Date.now() };
            delete p.spot;
            i++;
            continue;
          }
          delete p.badPoint;
          Object.assign(p, { ground: false, lift: v.lift, spot: SPOT_VERSION, inside: v.indoor === true || v.underground === true });
          i++;
          continue;
        }
        const origin = p.home || p.from || { x: p.x, y: p.y };
        asked++;
        const at = await standableAt(nz(origin.x, 0), nz(origin.y, 0));
        // ⚠ NOTHING COULD BE FOUND OUT, so nothing is decided: the post is neither placed nor
        // dropped, and the reason is carried out of here rather than left as a silent `break`. The
        // whole defect this separates is a zone that drew its rectangle, placed no post, refused
        // nothing and said nothing.
        if (!at || at.unknown) { unknownWhy = (at && at.why) || NO_BRIDGE_ANSWER; break; }
        const g = at.reject
          ? { none: true, why: at.reject }
          : { x: nz(origin.x, 0), y: nz(origin.y, 0), z: at.z, inside: at.inside === true };
        if (g.none) {
          dropped[g.why]++;
          (noGround[String(entry.id)] = noGround[String(entry.id)] || [])
            .push({ x: origin.x, y: origin.y, at: Date.now() });
          dropPost(posts, i);
          continue;
        }
        const moved = !near(p, g, SAME_SPOT_CM) || Math.abs(nz(p.z, 0) - g.z) > 300;
        Object.assign(p, {
          x: g.x, y: g.y, z: g.z, from: { x: origin.x, y: origin.y },
          ground: true, spot: SPOT_VERSION, inside: g.inside === true,
        });
        if (g.inside) insideN++;
        delete p.home;
        if (moved) {
          movedN++;
          Object.assign(p, { blind: 0, blindUntil: 0, refused: 0, refusedUntil: 0, vanished: 0, sentAt: 0 });
        }
        i++;
      }
      const lost = dropped.water + dropped.structure + dropped.indoors;
      if (movedN || lost) {
        log.info(`"${entry.name || entry.set}" — ${movedN} guard place(s) settled`
          // Inside a building: a floor and room for a body, not proof a guard can walk out.
          + (insideN ? ` (${insideN} inside a building)` : '')
          + (lost ? `, ${lost} left out (${dropped.structure} blocked, `
            + `${dropped.indoors} no room indoors, ${dropped.water} in water)` : ''));
      }
      if (!out) return;
      if (insideN) out.spotsInside = (out.spotsInside || 0) + insideN;
      if (lost) {
        out.spotsDropped = (out.spotsDropped || 0) + lost;
        // Read by the card. A number with no reason beside it is a number nobody can act on.
        out.spotsDroppedWhy = `${dropped.structure} blocked, ${dropped.indoors} no room indoors, `
          + `${dropped.water} in water`;
      }
      if (unknownWhy) out.groundWhy = unknownWhy;
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
    /**
     * ⚠ **ONE PATROL PER ZONE AT A TIME, STATED RATHER THAN ACCIDENTAL.**
     *
     * There are two callers — `activate()` and `patrolDue()` — and today they cannot collide,
     * because `activate()` runs BEFORE `setActive()` and `patrolDue()` only ever walks
     * `getActive()`. That is an invariant nothing declares, spread over three functions, and a
     * perfectly reasonable future edit — moving `setActive` up so the zone shows as live sooner —
     * makes two patrols of one zone run at once. Both read `postsOf(id)`, edit their own copy and
     * write it back, so the loser's whole round is lost: guards sent twice, posts the other one
     * placed forgotten, and nothing anywhere reporting it.
     *
     * A zone id is in flight or it is not. A second round on the same zone is DROPPED, not queued
     * — the patrol runs every few seconds and the next one is along shortly with a fresher reading
     * — and it says so in the log rather than returning a silent `null` that reads as "this zone
     * asked for nothing".
     */
    const patrolInFlight = new Set();
    async function patrolGuards(entry, rects, seen) {
      const zid = String((entry && entry.id) != null ? entry.id : (entry && entry.set) || '');
      if (patrolInFlight.has(zid)) {
        log.debug(`"${(entry && (entry.name || entry.set)) || zid}": a patrol is already running; `
          + 'this round was skipped');
        return null;
      }
      patrolInFlight.add(zid);
      try {
        return await patrolGuardsInner(entry, rects, seen);
      } finally {
        patrolInFlight.delete(zid);
      }
    }

    async function patrolGuardsInner(entry, rects, seen) {
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
      // Read off the zone's own configuration rather than off the rectangles handed in: the caller
      // has already resolved those and a second read of the set's file every few seconds is a file
      // read for a fact that is one key away.
      out.areaSource = areaOf(entry) ? 'custom' : 'file';
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
      const life = lifeOf(s);
      out.ownLife = life.mode;
      out.leash = life.leash;
      if (!wake.known || !wake.awake) {
        out.awake = wake.known ? false : null;
        if (!wake.known) out.refusals.push(PLAYERS_UNKNOWN);
        /**
         * ⚠ **A ZONE WITH NOBODY IN IT HOLDS NOTHING, AND ITS OWN GUARDS ARE THE ONE THING THAT
         * DOES NOT KNOW THAT.** The game takes its sentries, puppets, animals and NPCs away as soon
         * as everybody has gone; a guard placed directly is not registered with the game at all, so
         * it stays, it walks, and over an afternoon a garrison spreads out across the island.
         *
         * So the zone takes its own back. Only after the grace period — somebody stepping over the
         * edge and back must not empty the zone behind them — and only once per sleep, because a
         * sweep that found nothing is not a reason to sweep again every few seconds.
         *
         * ⚠ **ONLY WHERE SOMEBODY'S POSITION WAS REALLY READ.** `known: false` is the plugin unable
         * to find out where anybody is, and emptying a zone on that reading would take a garrison
         * away from a server full of players the moment a bridge switch was turned off.
         */
        if (wake.known && s.mode === 'replace' && life.mode === 'nearby') {
          const key = String(entry.id);
          const since = asleepSince[key] || (asleepSince[key] = Date.now());
          const waited = Date.now() - since;
          if (waited < life.graceMs) {
            out.sleepInMs = life.graceMs - waited;
          } else if (sweptAsleep[key] !== true && Date.now() >= nz(sweptAsleep[key], 0)) {
            const gone = await takeOwnGuardsAway(entry, s, posts, rects, 'nobody is near this zone');
            const was = sleepReport[key];
            if (was) { gone.removed += nz(was.slept, 0); gone.missing += nz(was.sleptMissing, 0); }
            // Only once the sweep really ran. A preview nothing could answer is not a sweep, and
            // marking it done would leave the garrison standing until the next wave.
            // ⚠ AND ONLY ONCE NOTHING IS LEFT TO NAME: a guard still out there is asked about
            // again half a minute later, for as long as the zone sleeps.
            if (!gone.refusals.length || gone.removed || gone.missing) {
              sweptAsleep[key] = nz(gone.left, 0) > 0 ? Date.now() + SLEEP_RETRY_MS : true;
            }
            /**
             * ⚠ **THE SWEEP'S RESULT IS KEPT UNTIL THE ZONE WAKES, NOT FOR ONE PATROL.** The row a
             * screen reads is the LAST patrol, and every asleep round after this one runs no sweep
             * — so a figure set only here was on the card for a few seconds and then read 0 for the
             * rest of the night. A tab polled every fifteen seconds almost never saw it, and "the
             * zone went to sleep" then read as "the zone is empty and nothing was ever there",
             * which is the very state this lifetime work exists to make visible. Same for a
             * removal that FAILED: a warning shown for one patrol is a warning nobody reads.
             *
             * ⚠ **THE UNIDENTIFIED COUNT TRAVELS AS A NUMBER AND NOTHING ELSE.** It is not a
             * refusal — nothing was refused, the game removes those itself — and putting a
             * sentence beside the number put the same fact on the card twice, once translated and
             * once in English. The count is the channel.
             */
            sleepReport[key] = {
              at: Date.now(),
              slept: gone.removed,
              sleptMissing: gone.missing,
              sleptUnidentified: gone.unidentified,
              refusals: gone.refusals.map((w) => `the zone's guards could not be removed now nobody is near: `
                + `${w} Retrying shortly.`),
            };
            setPostsIfChanged(entry.id, posts);
          }
          const rep = sleepReport[key];
          if (rep) {
            out.slept = rep.slept;
            out.sleptMissing = rep.sleptMissing;
            out.sleptUnidentified = rep.sleptUnidentified;
            out.sleptAt = rep.at;
            for (const w of rep.refusals) out.refusals.push(w);
          }
        }
        // Guards that walked out while the zone was awake are still a fact about this wave.
        if (strayedSinceWake[String(entry.id)]) {
          out.strayed = strayedSinceWake[String(entry.id)].n;
          out.strayedAt = strayedSinceWake[String(entry.id)].at;
        }
        wasAwake[String(entry.id)] = false;
        markPatrolled(entry.id);
        rememberPatrol(entry.id, out);
        return out;
      }
      out.awake = true;
      delete asleepSince[String(entry.id)];
      delete sweptAsleep[String(entry.id)];
      // Awake again: the last sweep is history, and whatever it said no longer describes the zone.
      delete sleepReport[String(entry.id)];
      /**
       * ⚠ **A ZONE THAT HAS JUST WOKEN UP FILLS ITS POSTS NOW, NOT AFTER THE DEATH DELAY.** While it
       * slept the game took away whatever stood there — the guards this plugin sent included — so an
       * empty post on waking is not a guard that was just killed, and `afterDeathSeconds` is not about
       * it. Without this every post stood empty for that whole delay each time somebody arrived, which
       * is the moment the guards are for. A post still held reads as held and loses nothing.
       */
      const newWave = wasAwake[String(entry.id)] !== true;
      if (newWave) {
        for (const p of posts) { p.emptySince = 0; p.everHeld = false; p.blind = 0; p.blindUntil = 0; }
        // A post left on a sentry's own spot by an older version: counted as a sentry and dropped,
        // so its guard stands on the zone's random ground from now on.
        // ⚠ NOT A PLACE LAID ROUND A PLAYER (`temp`): that is no sentry, and counting one on every
        // visit grew the zone by a guard for each, for ever.
        for (let i = posts.length - 1; i >= 0; i--) {
          const q = posts[i];
          if (q.pool || q.named || q.under || q.temp || q.hold) continue;
          noteSentry(entry.id, q.from || q);
          dropPost(posts, i);
        }
        // A new wave counts its strays from nothing. "Since the zone last woke" is the one span
        // a reader opening the tab at a random moment can make sense of.
        delete strayedSinceWake[String(entry.id)];
        // ⚠ A ZONE THAT WAS LEFT STARTS AGAIN. The kill delay exists so whoever just cleared the zone
        // has time to loot and fight without guards appearing behind them. Somebody who walks away
        // and comes back meets a guarded zone again, looted or not, which is deliberate.
        const allKills = host.store.get(K.kills, {}) || {};
        if (allKills[String(entry.id)]) {
          const rest = Object.assign({}, allKills);
          delete rest[String(entry.id)];
          host.store.set(K.kills, rest);
        }
      }
      wasAwake[String(entry.id)] = true;

      const rep = s.replace || {};
      const maxPosts = Math.max(1, Math.min(60, nz(rep.maxPosts, 12)));
      // Learned underground spots have a cap of their own and do not use up this one.
      const surfaceCount = () => posts.filter((p) => !p.under && !p.hold).length;
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
          const q = await bq('despawnPreview', kind, rect.x, rect.y, nz(s.centreZ, 0), radius);
          const pre = q.ok ? q.data : null;
          if (!pre || pre.error) {
            out.refusals.push(`${kind}: ${pre ? ((pre.reason || pre.error) || 'the preview gave no answer')
              : await whyOf(q, 'despawn', 'what is in this zone')}`);
            continue;
          }
          // Putting a sentry away has its own switch, so the removal switch this reports on does not
          // decide it.
          if (!stowing && pre.allowed === false) {
            // ⚠ The CARD is "Remove from the world"; "Removal" is a group inside it.
            out.refusals.push(`${kind}: not removed. Turn on "${REMOVE_SWITCH[kind] || kind}" (Remove from the world card, Removal group).`);
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
              if (s.mode === 'replace' && surfaceCount() < maxPosts && !postFrom(entry.id, posts, o)) {
                noteSentry(entry.id, o);
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
            // The place a sentry stood becomes a post — read BEFORE it was put away, which is the only
            // moment its position is the place. Somewhere this plugin has already recorded is not a
            // second post. A puppet wanders; where one happened to be is not a place worth guarding.
            if (s.mode === 'replace' && kind !== 'puppet'
                && surfaceCount() < maxPosts
                && !postFrom(entry.id, posts, o)) {
              noteSentry(entry.id, o);
            }
          }
        }
      }

      /**
       * ── THE PLACES THE OWNER NAMED ────────────────────────────────────────────────────────────
       *
       * ⚠ **THESE ARE CONFIGURATION, SO THEY ARE REBUILT FROM IT EVERY ROUND.** A named place is
       * not something this plugin discovered and has to remember — it is three numbers somebody
       * typed, and the moment they change one the old place is not a place any more. So the list is
       * derived, and only what the RUNTIME learned about each one (the guards standing on it, when
       * it last emptied, what the game said about it) is carried across by matching the coordinates
       * and the guard they belong to. Nothing here can go stale.
       */
      const allTypes = guardTypes(entry);
      if (s.mode === 'replace') {
        const keep = [];
        const seen = new Set();
        for (let ti = 0; ti < allTypes.length; ti++) {
          const t = allTypes[ti];
          const word = typeWord(t);
          for (const pt of t.at) {
            const key = `${word}|${pt.x},${pt.y},${pt.z}`;
            if (seen.has(key)) continue;            // the same three numbers twice is one place
            seen.add(key);
            const was = posts.find((p) => p.named && String(p.gt) === word
              && p.x === pt.x && p.y === pt.y && p.z === pt.z);
            const post = was || { emptySince: 0, everHeld: false };
            Object.assign(post, {
              x: pt.x, y: pt.y, z: pt.z, yaw: pt.yaw, note: pt.note,
              named: true, own: true, gt: word, gti: ti,
            });
            keep.push(post);
          }
        }
        // Every other post is an ANONYMOUS one — from a sentry we cleared, from the pool, learned
        // in a tunnel, or a temporary ring round a player. A named post the owner deleted simply
        // is not in `keep`, so it leaves here rather than lingering with nobody to stand on it.
        const others = posts.filter((p) => !p.named);
        const deleted = posts.filter((p) => p.named && !keep.includes(p));
        posts.length = 0;
        posts.push(...others, ...keep);
        handOver(deleted, posts);
      }

      /**
       * ── AND THE PLACES THE ZONE CHOOSES FOR ITSELF ────────────────────────────────────────────
       *
       * ⚠ **THIS USED TO BE SIX CELL CENTRES OF A 3×2 GRID, AND THAT IS THE WHOLE OF "THEY ALWAYS
       * SPAWN IN THE SAME PLACES".** It was deliberate — a random point is a different
       * point every round, so nothing could ever be found still standing at one — and the price was
       * that every zone on every server put its guards in the same handful of geometric places, for
       * ever, and a player learned all six in one visit.
       *
       * What replaces it has to satisfy four things at once and the fourth is the one the grid was
       * protecting: anywhere on the map · not the same place twice · a bounded number of bridge
       * calls · **and it must not wander**. A POOL does all four. It is filled a couple of probes at
       * a time, it is persisted, and it is never re-sampled — the variety is in WHICH of its points
       * this wave stands on, and within a wave nothing moves at all.
       */
      const autoTypes = autoTypesOf(allTypes);
      // A zone where every guard named its own points asks for no places of its own, and therefore
      // costs nothing to fill: no candidates are drawn and no ground is probed.
      /**
       * ⚠ **"ALSO USE THE PLACES THE ZONE CHOOSES" USED TO DO NOTHING ON A ZONE THAT CHOOSES NONE.**
       * With "Places spread over the zone" at 0 and no sentry cleared, a guard with its own points
       * and that switch on had no zone places to go to, and the switch sat there looking on. Such a
       * guard now brings as many zone places as it has points of its own, so the switch always means
       * what it says. A zone that already asks for more is not touched.
       */
      const alsoFloor = allTypes.reduce((n, t) => n + (t.andAuto === true && t.at.length ? t.at.length : 0), 0);
      const want = autoTypes.length
        ? Math.max(0, Math.min(maxPosts, Math.max(alsoFloor,
          nz(s.ownPosts, 0) + (s.mode === 'replace' ? sentriesOf(entry.id).length : 0))))
        : 0;
      if (s.mode === 'replace' && want > 0) {
        await fillPool(entry, rects, posts, want, out);
        usePool(entry, posts, rects, want, maxPosts, newWave, out);
      }
      await placePosts(entry, posts, rects, out);
      // ⚠ **A PLACE THROWN AWAY USED TO BE THROWN AWAY IN SILENCE.** The count was recorded on the
      // patrol and read by nothing, so a zone over a town dropped every place it laid out and the
      // card showed a rectangle, no places and no reason. Both halves reach the screen now: how many
      // went, and what the game said about them.
      if (out.spotsDropped) {
        out.refusals.push(`${out.spotsDropped} guard place(s) left out: no room to stand within 30 m `
          + `(${out.spotsDroppedWhy}). Retried later.`);
      }
      if (out.groundWhy) {
        out.refusals.push(`some guard places could not be settled on the ground this round — ${out.groundWhy}`);
      }
      /**
       * ⚠ **A POINT SOMEBODY TYPED IS REFUSED BY NAME, WITH ITS OWN THREE NUMBERS ON THE CARD.**
       * Every other place in this zone is one the plugin chose, so "a place was left out" is enough
       * for it; this one is the owner's, they can see it on the screen they typed it into, and the
       * only useful sentence is the one that says WHICH and WHY. It is said every round, because
       * the card draws the last patrol's refusals and a point that is quietly not being used is
       * exactly the state this is for.
       */
      /**
       * ⚠ **A POINT WITH A BOX LEFT EMPTY IS NOT A PLACE, and it is not a typo either — it is a
       * row somebody started and has not finished.** `Number('')` is 0 and 0,0,0 is a real place on
       * the island, so it is dropped rather than guessed at; dropped in SILENCE it is a row on the
       * screen that never does anything, which is the shape an owner reports as "my point is
       * ignored".
       */
      const halfTyped = allTypes.reduce((n, t) => n + nz(t.atDropped, 0), 0);
      if (halfTyped) {
        out.refusals.push(`${halfTyped} named point(s) are missing a number and are skipped. `
          + 'Fill all three, or remove the point.');
      }
      const bad = posts.filter((p) => p.named && p.badPoint);
      out.named = posts.filter((p) => p.named).length;
      out.namedRefused = bad.length;
      for (const p of bad.slice(0, 3)) {
        // Re-checked every few minutes, in case the game had simply not built that place yet.
        out.refusals.push(`the point ${p.x}, ${p.y}, ${p.z}${p.note ? ` ("${p.note}")` : ''} is not `
          + `used for "${p.gt}": ${p.badPoint.why} It is not moved; it is checked again later.`);
      }
      if (bad.length > 3) {
        out.refusals.push(`${bad.length - 3} more named point(s) are unused. Press "Check this spot" `
          + 'on each in its guard.');
      }
      /**
       * ⚠ **ONLY WHERE THE ZONE IS REALLY SHORT.** A pool stops being filled for two reasons and
       * only one of them is a problem: the rectangle has no standable ground left, or it simply
       * has no ROOM for another point at the spacing they are kept apart by. The second is an
       * ordinary small rectangle that has laid out everything it asked for, and telling its owner
       * it is "running out of places" is a warning about a zone that is working perfectly — which
       * is how a card stops being read.
       */
      /**
       * The pool could not be filled because nothing ANSWERED, which is a different fact from a
       * rectangle with no ground in it and has a different fix. Said only where the zone is short
       * of places, because a zone that has what it asked for is not waiting on anything.
       */
      if (out.poolWhy && (out.poolUsed || 0) < want) {
        out.refusals.push(`this zone is still finding places; the last check failed: ${out.poolWhy} `
          + 'Retrying in seconds.');
      }
      if (out.poolRest && (out.poolUsed || 0) < want) {
        // The ground it looked at is water, roofs or walls; it looks again in a few minutes.
        out.refusals.push('this zone is running out of places of its own. Name points on a guard\'s '
          + 'row, or move the rectangle.');
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
      /**
       * ⚠ **A ZONE CAN HAVE A FLOOR UNDER THE GROUND, AND A SPOT FROM THE SKY NEVER REACHES IT.** The
       * owner, at A4 Naval Base: players walk its tunnels and every guard stands on the surface above
       * them. The tunnels are not streamed in until a player is near (the bridge answers
       * `levelLoaded: false` there on an empty server), so nothing can be laid out in advance.
       *
       * So it is learned from the players: a player standing under the ground inside the zone marks
       * the floor they stand on as a spot, and the corridor round them is probed at their own level.
       * Those spots are kept, so a tunnel somebody walked yesterday is guarded ahead of the next
       * player too. They are used only while somebody is under the ground near them.
       */
      const underPlayers = [];
      /**
       * ⚠ **A ZONE WHOSE EVERY GUARD NAMED ITS OWN POINTS LEARNS NOTHING, because there is nobody
       * to stand on what it learns.** The tunnel floors a player walks over are places the ZONE
       * chose, so a guard that said "my points and nothing else" is not eligible for them — and
       * without this the zone quietly collects a dozen of them, gives each to nobody, and puts
       * *"N places have no guard to put in them"* on the card of a configuration that is exactly
       * what its owner asked for. Measured while a case for the tunnels was being written.
       */
      if (s.mode === 'replace' && who && who.known === true) {
        for (const q of who.at) {
          if (!rects.some((r) => inRect(q, r))) continue;
          const u = await belowGround(q);
          if (u && u.under) underPlayers.push({ q, floorZ: u.floorZ });
        }
        /**
         * ⚠ **KNOWING SOMEBODY IS DOWN THERE AND LEARNING PLACES DOWN THERE ARE TWO THINGS, and
         * gating both on the same test cost the first one.** The reading is used by the rule that
         * holds back a place on the SURFACE over a player in a tunnel, and a surface place can
         * come from a cleared sentry whatever the guards have named — so it is taken whenever
         * anybody is inside the rectangle.
         *
         * What is gated is the LEARNING. The floors a player walks over are places the ZONE
         * chose, so a guard that said "my points and nothing else" is not eligible for them, and
         * a zone where every guard said it would otherwise collect a dozen, give each to nobody,
         * and put *"N places have no guard to put in them"* on the card of a configuration that
         * is exactly what its owner asked for. Measured while the tunnel case was being written.
         */
        if (autoTypes.length) {
          for (const u of underPlayers) await learnUnder(posts, rects, u.q, u.floorZ, out);
        }
        if (underPlayers.length) out.underground = underPlayers.length;
      }
      const isUnder = (q) => underPlayers.some((u) => u.q === q);

      if (s.mode === 'replace' && npcLimit() === 0 && who && who.known === true) {
        for (let i = posts.length - 1; i >= 0; i--) {
          const p = posts[i];
          if (p.temp && !who.at.some((q) => within(p, q, NPC_STAY_CM + 5000))) dropPost(posts, i);
        }
        const perPlayer = Math.max(1, Math.min(3, maxPosts));
        let added = 0;
        for (const q of who.at) {
          if (!rects.some((r) => inRect(q, r))) continue;
          // Somebody under the ground is guarded by the spots down there, not by the surface above.
          if (isUnder(q)) continue;
          let close = posts.filter((p) => within(p, q, NPC_STAY_CM - 3000)).length;
          const base = (Math.abs(Math.round(q.x / 1000) * 7 + Math.round(q.y / 1000) * 13) % 360) * Math.PI / 180;
          for (let k = 0; k < 9 && close < perPlayer && added < 6; k++) {
            const ang = base + k * (2 * Math.PI / 9) * 4;          // steps round the ring, not side by side
            const dist = 9000 + (k % 3) * 1000;
            const x = q.x + Math.cos(ang) * dist;
            const y = q.y + Math.sin(ang) * dist;
            if (!rects.some((r) => inRect({ x, y }, r))) continue;
            if (posts.some((p) => near(p, { x, y }, 3000))) continue;
            // Open ground only: never a roof, never indoors, never water. See `standableAt`.
            const here = await standableAt(x, y);
            if (!here || here.unknown || here.reject) continue;
            // Not down a cliff or up a hill: a spot far above or below the player is not "near" them.
            if (Math.abs(here.z - nz(q.z, here.z)) > 1500) continue;
            posts.push({ x, y, z: here.z, emptySince: 0, everHeld: false, own: true, ground: true, temp: true, spot: SPOT_VERSION });
            close++; added++;
          }
        }
      }

      if (s.mode === 'replace') {
        // Underground spots take part only near somebody who is down there: the nearest few that are
        // not inside "Never appear within", or the nearest few at all when every one of them is.
        //
        // ⚠ THE REACH FOLLOWS "NEVER APPEAR WITHIN". Measured at A4 with the owner in a tunnel: 26 spots
        // learned, a reach of 80 m and "Never appear within" at 100 m (80 m on a server with no NPCs),
        // so every active spot was too close and nothing ever went underground. The reach is that
        // distance plus 40 m, and on a server with no NPC allowance no further than where the game
        // still keeps a guard.
        const active = new Set();
        const keep = Math.max(0, nz(rep.keepAwayFromPlayers, 5000));
        const noNpcs = npcLimit() === 0;
        const effKeep = noNpcs ? Math.min(keep, NPC_STAY_CM - 7000) : keep;
        let reach = Math.max(UNDER_REACH_CM, effKeep + 4000);
        if (noNpcs) reach = Math.min(reach, NPC_STAY_CM - 500);
        const perUnder = Math.max(1, Math.min(3, maxPosts));
        for (const { q } of underPlayers) {
          const byDistance = posts.filter((p) => p.under && within(p, q, reach))
            .sort((a, b) => dist3(a, q) - dist3(b, q));
          const clear = byDistance.filter((p) => !within(p, q, effKeep));
          (clear.length ? clear : byDistance).slice(0, perUnder).forEach((p) => active.add(p));
        }
        if (posts.some((p) => p.under)) out.underSpots = posts.filter((p) => p.under).length;
        const r = await holdPosts(entry, posts.filter((p) => !p.under || active.has(p)), who,
          // `allPosts` is EVERY place, not the ones this round is filling: the leash has to know
          // about a guard whose place is an inactive tunnel spot just as much as one on the
          // surface, and the ids are what tell it which actor is this zone's.
          { rects, s, allPosts: posts, underAt: underPlayers.map((u) => u.q), groundWhy: out.groundWhy || null });
        out.spawned = r.spawned; out.held = r.held;
        // Guards out there that no id names: said while the zone is awake too, not only at sleep.
        out.untracked = ownGuardIds(entry, posts).unidentified;
        out.inZone = r.inZone; out.maxGuards = r.maxGuards; out.killed = r.killed;
        // Which kind of zero the numbers above are. `censusKnown` false says the zone-wide count
        // could not be taken and each place was checked on its own; true with `inZone` 0 says it was
        // taken and the zone really is empty.
        out.censusKnown = r.censusKnown === undefined ? null : r.censusKnown;
        out.censusWhy = r.censusWhy || null;
        out.spare = r.spare || 0;
        out.unplaced = r.unplaced || 0;
        /**
         * ⚠ A RUNNING COUNT SINCE THE ZONE WOKE, NOT THIS ROUND'S. A stray is taken away on the one
         * patrol that sees it, and the next patrol's row would read 0 — so a tab polled every
         * fifteen seconds would almost never show that anything had walked off. The time of the
         * last one travels beside the count so the number can be read as recent or not.
         */
        if (r.strayed > 0) {
          const k = String(entry.id);
          const was = strayedSinceWake[k] || { n: 0, at: 0 };
          strayedSinceWake[k] = { n: was.n + r.strayed, at: Date.now() };
        }
        const sw = strayedSinceWake[String(entry.id)];
        out.strayed = sw ? sw.n : 0;
        out.strayedAt = sw ? sw.at : null;
        out.types = r.types || [];
        // The game's own clock and what the windows did with it, only when a window is set — an
        // absent key is "nobody asked", which is a different fact from "it could not be read".
        if (r.clock) out.clock = r.clock;
        if (r.outsideWindow) out.outsideWindow = r.outsideWindow;
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
      const q = await bq('livePlayers');
      const live = q.ok ? q.data : null;
      if (!Array.isArray(live)) {
        return { known: false, at: [], why: q.reason ? String(q.reason) : null };
      }
      const at = [];
      for (const p of live) {
        const x = nz(p.x, NaN); const y = nz(p.y, NaN); const z = nz(p.z, NaN);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          // The NAME travels with the position. `/positions` is the one place a person picks a
          // player out of a list, and a list of three coordinates is not something anybody can
          // choose from — the reading has always carried both and this used to throw one away.
          at.push({ x, y, z: Number.isFinite(z) ? z : 0, name: String(p.name || ''), steamId: String(p.steamid || p.steamId || '') });
        }
      }
      return { known: true, at };
    }

    /**
     * Where a guard is actually sent for a post.
     *
     * ⚠ **A GROUND HEIGHT IS NOT A PLACE A BODY FITS.** A post laid out on the grid, or lifted off sea
     * level, holds the height the ground trace answered — and a character's capsule centred exactly
     * there is half inside the terrain. The game refuses that spawn outright ("Cannot spawn at the
     * specified location"): driven, the same point refused at the ground's height
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
    // How long a place whose guard was lost waits for somewhere else to fit before it refills where it is.
    const MOVE_WAIT_MS = 2 * 60000;
    const VANISH_RING = [[0, 0], [1500, 0], [-1500, 0], [0, 1500], [0, -1500], [3000, 0], [-3000, 0],
      [0, 3000], [0, -3000], [2500, 2500], [-2500, 2500], [2500, -2500], [-2500, -2500]];
    /**
     * ⚠ **A POINT AN OWNER TYPED IS NOT ALWAYS A FLOOR, AND THE LIFT IS MEASURED RATHER THAN
     * ASSUMED.** *"Take a player's position"* hands back where a standing body's origin is, which
     * is already above the floor; a coordinate copied off the map or the console is usually the
     * floor itself. Lifting both would put a guard a metre in the air over a tunnel floor somebody
     * is standing on, and lifting neither is a spawn the game refuses outright ("Cannot spawn at
     * the specified location", driven — the same point accepted 120 cm higher).
     *
     * So the check that validates the point records which of the two it is, in `p.lift`, out of the
     * floor the GAME reported there. A post with no reading yet keeps the old rule.
     */
    function standingSpot(p) {
      const lift = p.named
        ? (Number.isFinite(Number(p.lift)) ? Number(p.lift) : STAND_ABOVE_GROUND_CM)
        : ((p.own || p.ground) ? STAND_ABOVE_GROUND_CM : 0);
      return {
        x: p.x, y: p.y, z: nz(p.z, 0) + lift,
        yaw: nz(p.yaw, 0),
        // The direct route's boss bootstrap fires only for a point somebody chose — see `sendGuard`.
        named: p.named === true,
      };
    }

    // ── under the ground ────────────────────────────────────────────────────────────────────────
    const UNDER_REACH_CM = 8000;       // underground spots within this of a player below take part
    const UNDER_SPACING_CM = 1500;     // two learned spots are at least this far apart
    const UNDER_MAX = 40;              // learned spots kept per zone
    const UNDER_DEPTH_CM = 400;        // a floor this far under the open ground round it is below it
    const dist3 = (a, b) => Math.hypot(nz(a.x, 0) - nz(b.x, 0), nz(a.y, 0) - nz(b.y, 0), nz(a.z, 0) - nz(b.z, 0));

    /**
     * Is this player under the ground? `{ under, floorZ }`, or `null` when the bridge did not answer.
     *
     * Two ways to say yes. The game's own environment says `underground`; or, when it does not, the
     * player's floor has something over it and lies at least 4 m under the open ground round about.
     * A player in a ditch has nothing over them, and one in a building stands at the ground's level,
     * so neither reads as under the ground.
     */
    async function belowGround(q) {
      const r = await bq('whereIs', q.x, q.y, q.z);
      const w = r.ok ? r.data : null;
      if (!w || w.error) return null;
      const floor = nz(w.groundZ, NaN);
      if (!Number.isFinite(floor)) return { under: false };
      const env = w.environment || {};
      if (env.underground === true) return { under: true, floorZ: floor };
      const top = await tracedGround(q.x, q.y);
      if (!top || top.none || top.z < floor + 300) return { under: false };
      let open = Infinity;
      for (const [dx, dy] of [[2500, 0], [-2500, 0], [0, 2500], [0, -2500]]) {
        const g = await standableAt(q.x + dx, q.y + dy);
        // ⚠ An inside floor is not "the open ground round about" — this asks how far under the open
        // air the player is, and a floor under a roof is the very thing being measured against.
        if (g && !g.unknown && !g.reject && g.inside !== true) open = Math.min(open, g.z);
      }
      return (Number.isFinite(open) && floor < open - UNDER_DEPTH_CM) ? { under: true, floorZ: floor } : { under: false };
    }

    /**
     * Learn spots under the ground round a player standing down there, at their own level.
     *
     * Where the player stands is a spot by definition: a body is standing on it. The corridor round
     * them is probed at 25, 40 and 60 m: a probe counts only when the floor it finds is within 1.5 m
     * of the player's own, the game calls the air above it indoors or underground, and the game's own
     * collision check finds room for a prisoner there. A point inside the rock has no floor at that
     * level and is refused. Each probe is asked once; the answers are kept for half an hour.
     */
    const underProbes = new Map();
    async function learnUnder(posts, rects, q, floorZ, out) {
      const under = () => posts.filter((p) => p.under);
      const add = (x, y, z, how) => {
        posts.push({ x, y, z, under: true, learned: how, ground: true, own: true, spot: SPOT_VERSION, emptySince: 0, everHeld: false });
        out.underLearned = (out.underLearned || 0) + 1;
      };
      const here = { x: q.x, y: q.y, z: floorZ };
      if (under().length < UNDER_MAX && !under().some((p) => within(p, here, UNDER_SPACING_CM))) add(q.x, q.y, floorZ, 'walked');
      let asked = 0;
      for (const d of [2500, 4000, 6000]) {
        for (let k = 0; k < 8; k++) {
          if (under().length >= UNDER_MAX || asked >= 8) return;
          const x = Math.round(q.x + Math.cos(k * Math.PI / 4) * d);
          const y = Math.round(q.y + Math.sin(k * Math.PI / 4) * d);
          const c = { x, y, z: floorZ };
          if (!rects.some((r) => inRect(c, r))) continue;
          if (under().some((p) => within(p, c, UNDER_SPACING_CM))) continue;
          const key = `${Math.round(x / 500)},${Math.round(y / 500)},${Math.round(floorZ / 200)}`;
          const seen = underProbes.get(key);
          if (seen && Date.now() - seen < 30 * 60000) continue;
          asked++;
          const qw = await bq('whereIs', x, y, floorZ + STAND_ABOVE_GROUND_CM);
          const w = qw.ok ? qw.data : null;
          if (!w || w.error) continue;                      // no answer: asked again next time
          if (underProbes.size > 4000) underProbes.clear();
          underProbes.set(key, Date.now());
          const g = nz(w.groundZ, NaN);
          const env = w.environment || {};
          const room = w.freeSpot && w.freeSpot.found === true && nz(w.freeSpot.movedCm, Infinity) <= 60;
          if (!Number.isFinite(g) || Math.abs(g - floorZ) > 150) continue;
          if (!(env.underground === true || env.indoor === true)) continue;
          if (!room || w.inWater === true) continue;
          add(x, y, g, 'probed');
        }
      }
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
     * ⚠ **A GUARD THAT MOVES IS NOT AT ITS POST, AND THAT IS NOT AN EMPTY POST — AND EVERY GUARD MOVES.**
     * Measured at B2 Airport: a zone of Drifters, five to a post, looked for them within 15 m of each
     * post, found the ones that had walked off missing, and sent five more to the same post three
     * times in eight minutes. That was fixed for the types that walk, on the reading that the game's
     * Guard stands at its station (`NPCControllerStateGuardReturnToPost`). The owner corrected it:
     * *"a nechodej jen drifteri, muzou chodit i guardi kdyz nekoho pronasleduji"* — a Guard chasing
     * somebody is off its post exactly when the post matters. So every type is counted across the
     * whole zone, and a post holds while more of that type are alive than the posts before it account
     * for.
     */
    const roams = () => true;

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
     * ⚠ **A KILLED GUARD IS STILL AN NPC IN THE WORLD.** Measured: a Guard shot dead
     * stayed in the despawn preview, at the spot where it fell, for as long as it was watched —
     * while the entity index said `alive: false, hp 0` for the same actor. So "is something standing
     * there" counts bodies, and the only way to tell a guard from a body is to ask the index.
     *
     * `true` alive, `false` dead, `null` when the index could not answer (not adopted, or a slot now
     * holding something else). A `null` is counted as alive: holding a post with an unreadable body
     * in it costs one refill; reading it as dead would stack guards.
     */
    async function isAlive(o) {
      const slot = entitySlot((o && o.id) || '');
      if (!slot) return null;
      const q = await bq('entity', slot);
      const e = q.ok ? q.data : null;
      if (!e || e.error || e.ok === false) return null;
      if (e.class && actorWord(e.class) !== actorWord(o.class)) return null;
      return !(e.alive === false || (e.healthPoints != null && nz(e.healthPoints, 1) <= 0));
    }

    /**
     * Every guard of one type in the zone, split into the living and the dead. Over the zone's own
     * sphere plus 100 m, because a Drifter chasing somebody out of the rectangle is still ours.
     */
    async function zoneCensus(t, area) {
      const seenIds = new Set();
      const alive = [];
      const dead = [];
      for (const rect of area.rects) {
        const radius = sphereFor(rect, area.s, chaseFor(area.s));
        const q = await bq('despawnPreview', censusKind(t), rect.x, rect.y, nz(area.s.centreZ, 0), radius);
        const pre = q.ok ? q.data : null;
        if (!pre || pre.error) {
          return { unknown: true, why: pre ? ((pre.reason || pre.error) || 'no answer')
            : await whyOf(q, 'despawn', 'what is in this zone') };
        }
        for (const o of pre.objects || []) {
          if (!typeHolds(t, o.class) || seenIds.has(String(o.id))) continue;
          seenIds.add(String(o.id));
          // Which sweep found it, kept on the object itself. A removal by id is still judged
          // against a sphere, so the leash below has to hand back the very sphere this object was
          // seen in — rebuilding one from the rectangle would be a second answer to a question
          // that already has one, and a guard sitting just outside it would refuse silently.
          o.sweep = { kind: censusKind(t), x: rect.x, y: rect.y, z: nz(area.s.centreZ, 0), radius };
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
    /**
     * ⚠ `windowMs` IS A FUNCTION OF THE WORD, not one number. A zone can hold a rifleman that comes
     * back after two minutes and a bear that comes back after ten, and the kill delay is the same
     * setting in both cases — so the window a kill is held for has to be the DEAD GUARD'S own.
     */
    function recentKills(zoneId, deadByWord, windowFor) {
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
        const windowMs = windowFor(mine[id].word);
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
      // One zone-wide count per guard type per round.
      const census = new Map();
      if (!types.length) {
        // Nothing chosen. The sentries still went — that is what "replace" with an empty choice
        // means — and saying nothing here would look like a patrol that failed.
        out.refusals.push('no guard has been chosen yet, so the posts are standing empty');
        return out;
      }
      const zoneWait = Math.max(0, nz(rep.afterDeathSeconds, 120)) * 1000;
      const waitFor = (t) => Math.max(0, nz(t.afterDeathSeconds, nz(rep.afterDeathSeconds, 120))) * 1000;
      let sent = false;

      /**
       * ── THE GAME'S CLOCK, ONCE PER ROUND AND ONLY IF SOMEBODY ASKED FOR IT ────────────────────
       *
       * A zone with no window makes no clock call at all, which is every zone configured before this
       * existed. Where one is set the reading is shared by every type in the round, because the hour
       * cannot move between two entries of the same patrol by anything a screen could show.
       *
       * ⚠ **A SHUT WINDOW STOPS THE FILLING AND NOTHING ELSE.** It never removes a guard that is
       * already standing: taking the garrison away at sunrise would delete something a player may be
       * fighting, and the owner asked for spawns to follow the day, not for a cull on the hour. The
       * guards that are there live out their lives and the posts simply stop being refilled.
       */
      const wantsClock = types.some((t) => windowOf(t.gameTime).on);
      const clock = wantsClock ? await gameClock() : null;
      if (wantsClock) {
        out.clock = clock && !clock.unknown
          ? { hour: Math.round(clock.hour * 100) / 100, unit: 'game-hours', speed: clock.speed, speedUnit: 'game-hours-per-real-hour' }
          : { unknown: true, why: (clock && clock.why) || NO_CLOCK };
      }
      /**
       * Which types are shut this round, with the sentence each one earns. Judged ONCE per type
       * rather than per post: twelve posts of one guard would otherwise put twelve identical lines
       * on a card, which is how a card stops being read.
       */
      const shut = new Map();
      for (const t of types) {
        const win = windowOf(t.gameTime);
        const v = windowOpen(win, clock);
        if (v.blind) {
          // Said EVERY round, deliberately: the card draws the last patrol's refusals, and a window
          // that is quietly not being applied is exactly the "partly working" state this is for.
          out.refusals.push(`"${typeLabel(t)}" has a time window set (${hhmm(win.from)} to `
            + `${hhmm(win.to)}, GAME'S clock) that is NOT being applied: ${v.why} `
            + 'Guards are sent as if no window were set.');
          continue;
        }
        if (!v.open) {
          shut.set(t, `${hhmm(win.from)} to ${hhmm(win.to)}`);
          // Posts are not filled; guards already standing are left alone.
          out.refusals.push(`"${typeLabel(t)}" is outside its time window `
            + `(${hhmm(win.from)}–${hhmm(win.to)}, GAME'S clock; now ${hhmm(v.hour)}).`
            + (clock && clock.speed ? ` A game hour is ${Math.round(600 / clock.speed) / 10} real minutes.` : ''));
        }
      }

      // ⚠ THE ZONE'S OWN CLOCK, checked before anything else is spent. A zone still inside its
      // cooldown makes no bridge call at all this round — the cheapest correct answer.
      const cool = Math.max(0, nz(rep.cooldownSeconds, 0)) * 1000;
      const lastSent = nz((host.store.get(K.lastGuardAt, {}) || {})[String(entry.id)], 0);
      if (cool > 0 && lastSent && (Date.now() - lastSent) < cool) {
        const left = Math.ceil((cool - (Date.now() - lastSent)) / 1000);
        out.refusals.push(`no guard was sent this round: cooldown, ${left} more second(s).`);
        return out;
      }

      // Where everybody is, read ONCE for the whole round rather than per post.
      // On a server with no NPC allowance a guard lives only near a player (see `npcLimit`), so the
      // spot has to be near somebody — and "never appear within" has to leave room inside that.
      const nearOnly = npcLimit() === 0;
      const keepAwayFor = (t) => {
        const want = Math.max(0, nz(t && t.keepAwayFromPlayers, nz(rep.keepAwayFromPlayers, 5000)));
        // On a server with no NPC allowance a guard lives only near a player, so "never appear
        // within" has to leave room inside that however wide the owner set it.
        return nearOnly ? Math.min(want, NPC_STAY_CM - 7000) : want;
      };
      // ⚠ THE WIDEST ANY GUARD ASKS FOR, because this one decides whether the player positions are
      // read AT ALL. Taking the zone's own number here would skip that read for a zone whose only
      // override is on a guard — and the whole point of the reading is that a guard never appears
      // next to somebody.
      const keepAway = Math.max(keepAwayFor(null), ...types.map(keepAwayFor));
      // The patrol that called this has just read it; a second read in the same round is a second walk
      // of the game's player controllers for the same answer.
      const players = (keepAway > 0 || nearOnly) ? (seen || await playersNow()) : { known: true, at: [] };
      const playerNear = (p) => players.at.some((q) => within(p, q, NPC_STAY_CM));

      /**
       * ── ANOTHER PLACE FOR A GUARD, OUT OF THE ZONE'S OWN POOL ─────────────────────────────────
       *
       * ⚠ **A PLACE THAT REFILLS WHERE ITS GUARD FELL IS A PLACE A SNIPER WATCHES.** Choosing again
       * only at a wave left the whole of one visit on one layout: kill the guard on the hill, wait,
       * and the next one appears on the same hill. So a place the ZONE chose moves to another point
       * of its pool when its guard is killed, and — where the owner asks for it — when a guard has
       * stood there long enough.
       *
       * It answers from the pool alone, so it costs no bridge call, and every rule the fill itself
       * applies is applied here FIRST: inside the rectangle, clear of every other place, away from
       * players by the guard's own distance, near one where the server keeps no NPC away from them,
       * and not on the surface over somebody in a tunnel. A place that fails any of those is not a
       * move, it is a place that would then sit empty. Least recently used first, with a random pick
       * among the three oldest so the order itself cannot be learned. `null` is "nowhere else fits
       * right now", and the caller decides what that means.
       */
      // Only a pool that EXISTS is read: `poolOf` draws a fresh seed for a zone that has none, and a
      // zone with no places of its own has nothing to move to anyway.
      const poolRec = (host.store.get(K.pool, {}) || {})[String(entry.id)];
      const poolNow = (poolRec && area && Array.isArray(area.rects) && area.rects.length) ? poolOf(entry.id) : null;
      let poolTouched = false;
      function otherPlace(p, t) {
        if (!poolNow || !poolNow.pts.length) return null;
        const keepIt = keepAwayFor(t);
        const fits = poolNow.pts.filter((q) => {
          if (!area.rects.some((r) => inRect(q, r))) return false;
          if (near(q, p, POOL_MIN_GAP_CM)) return false;
          if (p.leftFrom && near(q, p.leftFrom, POOL_MIN_GAP_CM)) return false;
          if (posts.some((o) => o !== p && !o.under && near(o, q, POOL_MIN_GAP_CM))) return false;
          if (keepIt > 0 && players.at.some((w) => within(q, w, keepIt))) return false;
          if (nearOnly && typeKind(t) === 'npc' && !playerNear(q)) return false;
          if (Array.isArray(area.underAt) && area.underAt.length) {
            const by = players.at.filter((w) => within(q, w, NPC_STAY_CM));
            if (by.length && by.every((w) => area.underAt.includes(w))) return false;
          }
          return true;
        });
        if (!fits.length) return null;
        fits.sort((a, b) => nz(a.usedAt, 0) - nz(b.usedAt, 0) || nz(a.foundAt, 0) - nz(b.foundAt, 0));
        const pick = rngOf((poolNow.seed ^ Math.floor(Date.now() / 1000) ^ ((nz(p.x, 0) + nz(p.y, 0)) | 0)) >>> 0);
        return fits[Math.floor(pick() * Math.min(3, fits.length))];
      }
      /** Put place `p` on pool point `q`. What it went through at the old spot stays behind there. */
      function moveTo(p, q) {
        p.leftFrom = { x: p.x, y: p.y };
        Object.assign(p, {
          x: q.x, y: q.y, z: q.z, inside: q.kind === 'indoor', ground: true, spot: SPOT_VERSION,
          blind: 0, blindUntil: 0, refused: 0, refusedUntil: 0, refusedWhy: '', vanished: 0, sentAt: 0,
        });
        delete p.home;
        // Kept as `wasIds`, never dropped: a guard reported lost may only have walked off.
        const had = (Array.isArray(p.ids) ? p.ids : []).map(String);
        if (had.length) p.wasIds = uniq((Array.isArray(p.wasIds) ? p.wasIds : []).concat(had));
        delete p.ids;
        delete p.sawGuard; delete p.heldSince; delete p.waitSince;
        q.usedAt = Date.now();
        poolTouched = true;
      }
      // How long a guard may stand on one place the zone chose before it is moved to another. 0 is never.
      const moveAfter = Math.max(0, nz(rep.moveAfterSeconds, 0)) * 1000;
      let relocated = 0;
      let movedNow = false;                      // one standing guard moved per round, at most
      let waitMove = 0;
      let nearPlayer = 0;
      let resting = 0;
      /**
       * ⚠ **THE REST USED TO BLAME THE GROUND WHATEVER THE CAUSE.** A post refused once is tried
       * again later, and every round in between the card said the ground there is a roof, a wall or a
       * steep slope and a smaller rectangle would help. For a guard whose class the game has never
       * made, all of that is false and none of it can be acted on — the same defect as the lecture
       * the boss route replaced, one screen along, and worse because it is the sentence the owner
       * sees for MOST of the wait. So the reason is remembered on the post and said again.
       */
      const restingWhy = new Set();
      let moved = 0;
      let waitingNear = 0;
      let overUnder = 0;
      let unplaced = 0;
      let outsideWindow = 0;
      if (keepAway > 0 && !players.known) {
        // ⚠ Could not find out, so nothing is filled. An empty post for a minute is the cheap side of
        // this; a guard appearing in somebody's face is the expensive one.
        // ⚠ A PLUGIN THAT FAILS CLOSED OWES THE OWNER THE SWITCH THAT OPENS IT. Without this sentence
        // the card says only "could not read", which reads as a fault in the plugin rather than as a
        // module that is off — and the owner has no way to find out which.
        // It will not risk a guard next to somebody. Both switches are reads (Live player data);
        // "Never appear within" 0 sends guards without checking, which is not recommended.
        out.refusals.push('no guard sent: player positions unknown. Turn on "Read live player data" '
          + 'and "Position, facing and speed".');
        return out;
      }

      /**
       * The zone's living guards and its recent kills, read ONCE per round for every guard type. With
       * this a post is held by a living guard near it (or, for a type that walks, anywhere in the zone),
       * a body holds nothing, and the respawn delay is owed only for a kill.
       */
      /**
       * ⚠ **"COULD NOT COUNT" IS NOT "THERE ARE NONE", AND IT IS ALSO NOT A REASON TO DO NOTHING.**
       * A failed count used to end the round before a single place was looked at, so a zone that asks
       * for guards and has nothing to clear — the ordinary zone over open ground — did nothing at all
       * whenever the zone-wide sweep was refused, which on a rectangle wider than the despawn
       * module's own ceiling is every round for ever.
       *
       * The count is a convenience: it tells one guard that walked off from one that died, across the
       * whole rectangle at once. Without it each place can still be asked about ON ITS OWN, over a
       * few metres rather than a few hundred, which is a sphere no ceiling refuses — so the round
       * degrades to that instead of ending. The three answers stay apart and the card says which one
       * this was: `censusKnown` false is *could not count*, `inZone` 0 with it true is *counted, and
       * there are none*.
       */
      let zoneWide = !!(area && area.rects && area.rects.length);
      const owed = new Map();
      let killsTotal = 0;
      let censusWhy = null;

      if (zoneWide) {
        for (const t of types) {
          const word = typeWord(t);
          if (census.has(word)) continue;
          census.set(word, await zoneCensus(t, area));
        }
        for (const c of census.values()) if (c.unknown) { censusWhy = c.why || 'no reason given'; break; }
        if (censusWhy) {
          census.clear();
          zoneWide = false;
        } else {
          // ⚠ BEFORE ANYTHING IS COUNTED. A guard that has walked out of the zone is not holding a
          // post in it, and leaving it in the count until after the posts were handed out would
          // have the zone believe it is fully manned while a player standing in it sees nobody.
          await leashStrays(entry, census, area, out);
          await trackOwn(entry, census, area, out);
          const deadByWord = new Map();
          for (const [word, c] of census) deadByWord.set(word, c.dead);
          // The dead guard's OWN delay: `types` is keyed by the same word the kill was stored under.
          const waitOf = (word) => {
            const t = types.find((x) => typeWord(x) === word);
            return t ? waitFor(t) : zoneWait;
          };
          for (const [word, n] of recentKills(entry.id, deadByWord, waitOf)) { owed.set(word, n); killsTotal += n; }
        }
      }
      out.censusKnown = !censusWhy;
      if (censusWhy) out.censusWhy = censusWhy;

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

      /**
       * ⚠ **A GUARD HOLDS THE NEAREST POST OF ITS KIND, NOT THE FIRST ONE IN THE LIST.** Every type is
       * counted across the zone, and the count used to be handed out in list order: one living guard
       * held the first post of its type. When that first post could not be filled anyway — a surface
       * post over a player in a tunnel — the guard really standing at the second post was credited to
       * the first, the second read as empty, and a second guard was sent to the same place. Now each
       * living guard is matched to the nearest post of its own type that still has room, however far
       * it has walked or chased somebody. HOW MANY posts are held still comes from the count — three
       * guards of a five-to-a-post type hold one post, not the two they happen to stand between — and
       * the posts that have the most of them nearest are the ones held.
       */
      const postType = posts.map((p, i) => typeForPost(types, p, i));
      // A place the plan gives to nobody: every type named its own number and they add up to fewer
      // places than the zone has. Counted and said, never quietly filled with somebody's spare.
      let spare = 0;
      /**
       * ⚠ **WITHOUT A ZONE-WIDE COUNT, THE PLACES ARE THE COUNT — AND IT HAS TO BE TAKEN UP FRONT.**
       * The ceiling is about the whole zone, so it cannot be decided against the places the loop
       * below happens to have walked past before it reaches the one it fills. Each place is asked
       * about exactly once either way; this only moves when.
       *
       * It is a FLOOR rather than a census: a guard that has walked away from its place is not in it,
       * so the ceiling can be reached one guard late. That is said on the card rather than implied.
       */
      const verdicts = new Array(posts.length).fill(null);
      if (!zoneWide) {
        let counted = 0;
        for (let i = 0; i < posts.length; i++) {
          const t = postType[i];
          if (!t) continue;
          const v = await postHeld(posts[i], rep, t);
          verdicts[i] = v;
          if (v && v.held) counted += countFor(t);
        }
        out.inZone = counted;
        if (maxGuards > 0) { room = maxGuards - counted; out.maxGuards = maxGuards; }
      }
      /**
       * `want` counted the way the zone ceiling is counted: how many of that guard are alive against
       * how many were asked for.
       *
       * ⚠ **ENTRIES NAMING THE SAME CLASS SHARE ONE COUNT**, because the only thing that can be
       * counted in the world is the name the game gives an actor, and two entries listing one class
       * are one name. Their numbers are added together rather than one of them winning.
       *
       * With no count taken this round it is the place plan alone that bounds a type, which is close
       * — `ceil(want / count)` places of `count` each — and is not the number itself.
       */
      const wantByWord = new Map();
      for (const t of types) {
        if (!(t.want > 0)) continue;
        const w = typeWord(t);
        wantByWord.set(w, (wantByWord.get(w) || 0) + t.want);
      }
      const sentByWord = new Map();
      function typeRoom(t) {
        const w = typeWord(t);
        const cap = wantByWord.get(w);
        if (!(cap > 0)) return Infinity;
        const c = census.get(w);
        if (!c || c.unknown || !Number.isFinite(c.count)) return Infinity;
        return cap - c.count - (sentByWord.get(w) || 0);
      }
      let overWant = 0;
      const holding = new Map();
      const heldPosts = new Set();
      if (zoneWide) {
        for (const [word, c] of census) {
          const all = posts.map((p, i) => ({ p, i, t: postType[i] })).filter((x) => x.t && !x.p.hold && typeWord(x.t) === word);
          if (!all.length) continue;
          /**
           * ⚠ **BY ID FIRST.** A guard this zone placed on a place is that place's guard wherever it
           * has walked, and counting it by proximity alone handed it to whichever place it happened
           * to be nearest — so its own place read empty, was filled again, and a Drifter heading
           * for a player turned one place into a queue of guards. Only what no id names is shared
           * out by distance, exactly as before.
           */
          const claimed = new Set();
          for (const x of all) {
            const ids = (Array.isArray(x.p.ids) ? x.p.ids : []).map(String);
            if (!ids.length) continue;
            const on = (c.alive || []).filter((o) => o && ids.includes(String(o.id)) && !claimed.has(String(o.id)));
            if (!on.length) continue;
            for (const o of on) claimed.add(String(o.id));
            heldPosts.add(x.p);
          }
          const mine = all.filter((x) => !heldPosts.has(x.p));
          const rest = (c.alive || []).filter((o) => !claimed.has(String(o && o.id)));
          if (!mine.length) continue;
          for (const g of rest) {
            let best = null; let bestD = Infinity;
            for (const x of mine) {
              if ((holding.get(x.p) || 0) >= countFor(x.t)) continue;
              const d = dist3(x.p, g);
              if (d < bestD) { bestD = d; best = x.p; }
            }
            if (best) holding.set(best, (holding.get(best) || 0) + 1);
          }
          const per = countFor(mine[0].t);
          const want = Math.ceil(rest.length / per);
          mine.slice().sort((a, b) => ((holding.get(b.p) || 0) - (holding.get(a.p) || 0)) || (a.i - b.i))
            .slice(0, want).forEach((x) => heldPosts.add(x.p));
        }
      }
      /**
       * Take a guard that has stood long enough off its place, and move the place. Only a guard this
       * zone can NAME — the id the game handed back when it was made — and only with nobody close
       * enough to watch it go: never within the guard's own keep-away, and never within 50 m. One
       * per round, and never onto a spot that does not pass every rule the fill applies.
       */
      async function moveStanding(p, t) {
        const ids = Array.isArray(p.ids) ? p.ids.map(String) : [];
        if (!ids.length) return false;
        const c = census.get(typeWord(t));
        if (!c || c.unknown || !Array.isArray(c.alive)) return false;
        const them = c.alive.filter((o) => o && ids.includes(String(o.id)));
        if (!them.length || them.some((o) => !o.sweep)) return false;
        const watch = Math.max(5000, keepAwayFor(t));
        // ⚠ ASKED EVEN WHERE THE FILL DID NOT NEED TO: with "never appear within" at 0 nobody's
        // position was read this round, and an empty list would read as nobody watching. Could not
        // find out is no move.
        const who = (keepAway > 0 || nearOnly) ? players : (seen || await playersNow());
        if (!who || !who.known) return false;
        if (who.at.some((w) => within(p, w, watch) || them.some((o) => within(o, w, watch)))) return false;
        const q = otherPlace(p, t);
        if (!q) return false;
        const gone = new Set();
        for (const o of them) {
          const done = await bx('despawnAt', o.sweep.kind, o.sweep.x, o.sweep.y, o.sweep.z, o.sweep.radius, String(o.id));
          if (done && done.ok === true) gone.add(String(o.id));
        }
        if (gone.size) {
          c.alive = c.alive.filter((o) => !gone.has(String(o && o.id)));
          c.count = c.alive.length;
          if (Number.isFinite(room)) room += gone.size;
        }
        // Part of it still standing there still holds the place; the rest is asked again next round.
        if (gone.size !== them.length) {
          p.ids = ids.filter((id) => !gone.has(id));
          return false;
        }
        p.ids = [];                              // every one of them removed, so nothing to keep
        moveTo(p, q);
        p.everHeld = false; p.emptySince = 0;
        movedNow = true;
        relocated++;
        return true;
      }
      for (let i = 0; i < posts.length; i++) {
        const p = posts[i];
        const t = postType[i];
        // A holder only names guards of a place that was dropped; it is never filled.
        if (p.hold) continue;
        // Given to nobody by the plan. Nothing below it may touch `t`.
        if (!t) { spare++; continue; }
        let verdict;
        if (zoneWide && roams(t)) {
          verdict = { held: heldPosts.has(p) };
        } else {
          verdict = verdicts[i] || await postHeld(p, rep, t);
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
          p.sentAt = 0; p.vanished = 0;
          if (p.pool === true && !p.named) {
            // A guard really SEEN here, so losing it later is a loss and not a send that never landed.
            p.sawGuard = true;
            if (!p.heldSince) p.heldSince = Date.now();
            delete p.waitSince;
            // Stood long enough: taken away and the place moved. On success it falls through as an
            // empty place at its new spot and is filled like any other.
            if (moveAfter > 0 && !movedNow && zoneWide && Date.now() - p.heldSince >= moveAfter
              && await moveStanding(p, t)) {
              // fall through
            } else { out.held++; continue; }
          } else { out.held++; continue; }
        }
        // ⚠ OUTSIDE ITS HOURS. Checked here rather than at the top of the round so a post still gets
        // LOOKED at: "held" and "empty" are what the card shows, and a zone that goes blind at
        // sunrise reports an empty garrison it has not actually lost. Nothing is removed and nothing
        // is sent; the reason was said once per type above.
        if (shut.has(t)) { outsideWindow++; continue; }
        /**
         * ⚠ **SENT, AND GONE BEFORE THE NEXT LOOK.**
         *
         * Measured at B2 Airport with a player in the zone: the game accepted every spawn, the guards
         * appeared, and the game destroyed them three to four seconds later — nothing in this plugin or
         * the bridge removed them. The same guard sent fifteen metres from a sentry's concrete pad
         * stayed; on the pad, on a roof, it went, and that was first read as the SPOT being wrong.
         * The later measurement on the same server (`scum.MaxAllowedNPCs` 0) explained it by DISTANCE
         * instead: guards 120 to 173 m from the player stayed and 177 m and beyond went, wherever they
         * stood. That case is handled by `nearOnly` just below. Whether the game ever removes a guard
         * for the ground it stands on has not been established, so the ring stays as a fallback:
         * sending again to the same point only makes players watch guards pop in and out, so the post
         * moves round a ring about where it started until a guard stays.
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
            out.refusals.push('the game kept removing guards at one spot; resting. A moved rectangle '
              + 'or more guard spots helps.');
            continue;
          }
          const off = VANISH_RING[p.vanished];
          const here = await standableAt(p.home.x + off[0], p.home.y + off[1]);
          if (here && !here.unknown && !here.reject) {
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
            // ⚠ NAME THE CONTROL THE WAY THE CARD NAMES IT, AND ONLY OFFER WHAT CAN BE DONE.
            // This used to say 'Check "Where to search"' — a control that does not exist under that
            // name anywhere on the tab; it is "Search height and reach", under Technical settings.
            // And it offered the direct route to an owner who, for an NPC, had no way of choosing
            // it: the route was decided by which entry of the Add menu the guard came from. Both
            // halves are the same defect — a sentence an owner cannot act on.
            /**
             * ⚠ **THIS SENTENCE QUOTED TWO OF THIS PLUGIN'S OWN CONTROLS BY THEIR ENGLISH NAMES,
             * AND ONE OF THEM IS ON NO SCREEN IN ANY LANGUAGE.** A bridge caption really is English
             * everywhere and quoting one is right; these are the tab's own controls, translated
             * into eighteen languages, so the sentence was correct only for an English reader — and
             * *"placed directly"* was never a control at all: the row offers the game's own spawn
             * and the one that is gone at a restart. The comment three lines above this records
             * fixing exactly that once already, and the other half of the same sentence put it back.
             *
             * So it names no control. It says what to look at and what the choice buys, which is
             * true in every language and is the half an owner can act on.
             */
            // Commonest cause is height: the game refuses a spawn below the ground. The route that is
            // gone at the next restart can be asked whether what it made is still alive.
            out.refusals.push('a post never kept a guard, so it is resting. Widen the search height '
              + 'or name the point yourself.');
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
          if (Date.now() - p.emptySince < waitFor(t)) continue;
        }
        // ⚠ A POST THE GAME JUST REFUSED RESTS. Without this the patrol asked again every round —
        // measured, the same refused spawn every five or six seconds for as long as
        // somebody stood in the zone, each one a command the game had to parse and turn down.
        if (nz(p.refusedUntil, 0) > Date.now()) { resting++; if (p.refusedWhy) restingWhy.add(p.refusedWhy); continue; }
        // Not settled yet: `placePosts` gets to it in a round or two. Nothing is sent to a place that
        // may be a roof. ⚠ COUNTED, because this used to be the silent end of the road: where nothing
        // could answer, every place stayed unsettled for ever and the card showed places, none held,
        // no guards and not one word about it.
        // A point the owner named that the game will not take. Its own sentence was said once, up
        // in `patrolGuards`, naming the three numbers — so it is skipped here in silence rather
        // than counted among the places that are merely waiting to be settled, which are a
        // different fact with a different fix.
        if (p.named && p.badPoint) continue;
        if (p.spot !== SPOT_VERSION) { unplaced++; continue; }
        /**
         * ⚠ **ITS GUARD WAS LOST, SO THE NEXT ONE STANDS SOMEWHERE ELSE.** Only for a place the zone
         * chose, and only once a guard was really seen on it — a send that never landed is the
         * ring's business above, not this. Nowhere else fitting right now is a short wait rather than
         * the same spot, because the same spot is exactly what somebody is aiming at; after
         * `MOVE_WAIT_MS` it refills in place, because an empty zone is the worse of the two. A pool
         * with no other point at all refills in place at once.
         */
        if (p.pool === true && !p.named && p.sawGuard) {
          const q = otherPlace(p, t);
          if (q) {
            moveTo(p, q);
            relocated++;
          } else {
            const others = !!(poolNow && poolNow.pts.some((o) => !near(o, p, POOL_MIN_GAP_CM)
              && area.rects.some((r) => inRect(o, r))));
            if (!p.waitSince) p.waitSince = Date.now();
            if (others && Date.now() - p.waitSince < MOVE_WAIT_MS) { waitMove++; continue; }
            delete p.sawGuard; delete p.waitSince;
          }
        }
        // ⚠ NOT NEXT TO A PLAYER. Skipped, never moved: a post is a fixed place by design, and the
        // patrol comes round again in a few seconds, by which time whoever was there may have moved.
        if (nearOnly && typeKind(t) === 'npc' && !playerNear(p)) { waitingNear++; continue; }
        // ⚠ NOT ON THE SURFACE OVER SOMEBODY IN A TUNNEL. Measured at A4: with the owner 44 m down, the
        // zone sent its guard to a surface spot above them, reached its ceiling of two, and never sent
        // one underground. A surface spot whose only nearby players are under the ground waits for
        // somebody on the surface.
        /**
         * ⚠ **AND NEVER FOR A POINT SOMEBODY CHOSE.** This rule exists because a place the PLUGIN
         * laid out from the sky sits on the ground over a tunnel, and filling it while the only
         * players are forty metres below is a guard nobody will ever meet. A point an owner typed
         * carries its own height — it IS the tunnel floor, which is the whole reason the box is
         * there — so judging it as "the surface over them" would leave exactly the point that was
         * named for the tunnels as the one place that never fills while anybody is in them.
         */
        if (!p.named && !p.under && area && Array.isArray(area.underAt) && area.underAt.length) {
          const nearBy = players.at.filter((q) => within(p, q, NPC_STAY_CM));
          if (nearBy.length && nearBy.every((q) => area.underAt.includes(q))) { overUnder++; continue; }
        }
        const keepIt = keepAwayFor(t);
        if (keepIt > 0 && players.at.some((q) => within(p, q, keepIt))) {
          nearPlayer++;
          continue;
        }
        if (room <= 0) continue;
        // This guard's own number, where its entry named one. It bounds only itself; `room` above is
        // still the ceiling on everything the zone holds together.
        const mine = typeRoom(t);
        if (mine <= 0) { overWant++; continue; }
        if (sent) continue;                      // one per round, deliberately
        const allow = Math.min(room, mine);
        const trimmed = allow < countFor(t) ? Object.assign({}, t, { count: allow }) : t;
        const made = await sendGuard(standingSpot(p), trimmed, typeLabel(t));
        if (made.count > 0) {
          /**
           * ⚠ **A FILL THAT ONLY PARTLY LANDED USED TO BE REPORTED AS A FILL.** The caller read
           * `made.count > 0`, marked the place held and threw `made.why` away — so a place asked
           * for five guards collected one, read HELD for ever afterwards, and the four refusals
           * went nowhere at all. The send paces itself past the bridge's own gap now, so this
           * should be rare; when it is not, the owner is told rather than left counting bodies.
           */
          if (made.why) out.refusals.push(`${made.why} (${made.count} of ${countFor(t)} arrived at that place)`);
          out.spawned += made.count;
          room -= made.count;
          sentByWord.set(typeWord(t), (sentByWord.get(typeWord(t)) || 0) + made.count);
          p.refused = 0; p.refusedUntil = 0; p.refusedWhy = '';
          p.sentAt = Date.now();
          p.emptySince = 0;
          p.everHeld = true;
          // A new guard, not seen yet: neither the loss rule nor the standing clock applies until it is.
          delete p.sawGuard; delete p.heldSince; delete p.waitSince;
          /**
           * ⚠ **THE GUARD SENT HERE BEFORE IS NOT FORGOTTEN BECAUSE ANOTHER ONE WAS SENT.** A guard
           * that walks leaves its place, the place reads empty and is filled again — and writing
           * the new id over the old one left the first guard with nothing in this plugin that could
           * ever name it: not the leash, not the sleep sweep. It walked the island for as long as
           * the server ran. The old ids move to `wasIds` and stay there until the guard is
           * confirmed dead, removed, or gone from the world.
           */
          const before = (Array.isArray(p.ids) ? p.ids : []).map(String);
          if (before.length) p.wasIds = uniq((Array.isArray(p.wasIds) ? p.wasIds : []).concat(before));
          p.ids = made.ids;
          // A route that hands back no id makes a guard nothing here can name again. Marked, so the
          // card can say how many of those are out there.
          if (Array.isArray(made.ids) && made.ids.length) delete p.noId; else p.noId = true;
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
          p.refusedWhy = made.why;               // said again for the whole rest, not once — see `restingWhy`
          sent = true;                           // a refusal is an answer; do not hammer the rest
        }
      }
      out.killed = killsTotal;
      if (poolTouched && poolNow) setPool(entry.id, poolNow);
      if (relocated) {
        out.relocated = relocated;
        log.info(`"${entry.name || entry.set}" — ${relocated} guard place(s) moved to another part of the zone`);
      }
      if (waitMove && !sent) {
        out.refusals.push(`${waitMove} place(s) wait for a new spot away from where the last guard fell.`);
      }
      if (moved) {
        log.info(`"${entry.name || entry.set}" — ${moved} guard spot(s) moved: the game removed `
          + 'the guards sent there within seconds');
      }
      if (resting) {
        // A post whose own refusal was remembered says that, verbatim. Only the ones with nothing
        // remembered fall back to the ground, which is what that sentence was always about.
        for (const w of restingWhy) out.refusals.push(w);
        if (resting > restingWhy.size) {
          // A place refused again and again is a roof, a wall or a steep slope.
          out.refusals.push(`${resting - restingWhy.size} post(s) resting after the game refused a guard. `
            + 'If it repeats, move the rectangle.');
        }
      }
      // Said where it was counted. A post skipped in silence reads as a post that is broken.
      if (waitingNear && !sent && !out.held && !out.spawned) {
        // With no NPC allowance a guard lives only near a player.
        out.refusals.push(`no guard sent: guards need a player within 150 m, and ${waitingNear} spot(s) `
          + 'are further than that from everybody. Walk closer.');
      }
      if (overUnder && !out.spawned) {
        out.refusals.push(`${overUnder} surface spot(s) wait: nearby players are underground, so guards go there.`);
      }
      // A count rather than another sentence: the WHY was said once per guard type above, and the
      // number is the half a card cannot work out for itself.
      if (outsideWindow) out.outsideWindow = outsideWindow;
      if (nearPlayer) {
        out.refusals.push(`${nearPlayer} post(s) left empty: a player is near. They fill once clear.`);
      }
      if (unplaced) {
        out.unplaced = unplaced;
        const why = (area && area.groundWhy) || null;
        // A guard put where the game will not keep one pops in and out in front of players.
        out.refusals.push(`${unplaced} place(s) not settled on the ground yet, so nothing is sent. `
          + (why
            ? `The last check failed: ${why}`
            : 'They settle within a minute or so.'));
      }
      if (overWant && !out.spawned) {
        out.refusals.push(`${overWant} place(s) left empty: that guard\'s number is reached. Raise it, `
          + 'or add a guard with no number.');
      }
      if (spare) {
        out.spare = spare;
        // Every guard names a number and they add up to fewer than the places; a guard with no
        // number shares whatever is left.
        out.refusals.push(`${spare} place(s) have no guard. Raise a guard\'s number, add one with no number, `
          + 'or lower "At most this many places".');
      }
      // ⚠ SAID LAST, so it never pushes a sharper reason off the card. Degrading is not a failure and
      // it is not a success either; the owner is told which kind of zero the numbers beside it are.
      if (censusWhy) {
        // Counted from held places, so a guard that walked away is missed and the ceiling can be
        // reached one guard late.
        out.refusals.push(`guards could not be counted across the zone (${censusWhy}); `
          + 'each place was checked instead.');
      }
      // What the zone asked for, what the plan gave it, and what it has — per guard, for the card.
      // ⚠ `have` IS NULL WHERE NOTHING COULD BE COUNTED, which is a different fact from 0 and must
      // not render as one; `places` is what the plan decided and is known either way.
      const places = new Map();
      for (const t of postType) {
        if (!t) continue;
        const k = types.indexOf(t);
        places.set(k, (places.get(k) || 0) + 1);
      }
      out.types = types.map((t, i) => {
        const c = census.get(typeWord(t));
        const win = windowOf(t.gameTime);
        const row = {
          label: typeLabel(t),
          word: typeWord(t),
          want: t.want > 0 ? t.want : null,
          places: places.get(i) || 0,
          have: (c && !c.unknown && Number.isFinite(c.count)) ? c.count : null,
        };
        // ⚠ THE UNIT TRAVELS WITH THE NUMBERS. A screen that draws `from` and `to` bare will be read
        // as real hours by everybody, and on a server at speed 8 that is wrong by a factor of eight.
        if (win.on) {
          row.window = {
            fromHour: win.from, toHour: win.to, unit: 'game-hours',
            open: shut.has(t) ? false : true,
            applied: !!(clock && !clock.unknown),
          };
        }
        return row;
      });
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
          // ⚠ `entity:` TAKES THE SLOT AND NOTHING ELSE — there a dot starts a PROPERTY PATH, so
          // `entity:1648804.672961` is refused with "has no property called '672961'". The serial
          // is not needed and not wanted: `mod_entities` pins its own and refuses a recycled slot.
          const qe = await bq('entity', entitySlot(id));
          const e = qe.ok ? qe.data : null;
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
      // Per guard where the guard says so: a bear wanders further from its post than a rifleman.
      const radius = Math.max(200, nz(t.postRadius, nz(rep.postRadius, 1500)));
      const q = await bq('despawnPreview', typeKind(t), p.x, p.y, p.z, radius);
      const pre = q.ok ? q.data : null;
      if (!pre || pre.error) {
        return { unknown: true, why: pre ? ((pre.reason || pre.error) || 'no answer')
          : await whyOf(q, 'despawn', 'what is standing at this place') };
      }
      const standing = (pre.objects || [])
        .filter((o) => typeHolds(t, o.class))
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
    /**
     * ⚠ **THE ROUTE IN THIS SENTENCE WAS DEAD AND THE PRODUCT HAD ALREADY RECORDED IT AS DEAD.**
     * It said *(Settings, Bridge, group In game)* — and Settings holds Manager, Discord, Server,
     * Frontend, Game Settings and Translations, and has never held a Bridge. The bridge's own card
     * is a TAB UNDER PLUGINS. This plugin's frontend was fixed to build that route out of the
     * panel's own keys, in every language; the backend string was not, and it is the one an owner
     * reads on the card. It names no menu of its own now — the card is named, which is true in
     * every language, and the switch itself is a bridge caption and so is English everywhere.
     */
    // The switch is on the bridge's own settings card: the SSA Bridge tab under Plugins.
    const MODULE_ADMIN_WHY = 'turn on "Let in-game mods run admin commands" on the SSA Bridge card, '
      + 'then restart the server';

    /**
     * ── A CLASS THE GAME HAS NEVER MADE, AND THE ONE ROUTE THAT CAN MAKE ONE ──────────────────────
     *
     * The direct route resolves a blueprint class with `StaticFindObject`, which answers about what is
     * ALREADY IN MEMORY and never fetches — measured in the bridge's own `mod_spawn.cpp`:
     * `BP_Razor.BP_Razor_C` refused on a server that had never had a razor in it, while `BP_Deer_C`
     * resolved because deer were walking about. Unreal loads a blueprint class the first time the game
     * creates one, so for a BOSS that is the ordinary state of a server, and a restart puts it back —
     * a fresh process has nothing loaded.
     *
     * ⚠ **AND THE OTHER ROUTE IS NOT AN ANSWER FOR A BOSS, WHICH IS WHAT THE OLD REFUSAL GOT WRONG.**
     * It told an owner to "switch this guard to The game's own spawn" — and the bridge's persistent
     * route carries four verbs (`SpawnAnimal`, `SpawnZombie`, `SpawnArmedNPC`, `SpawnVehicle`) and no
     * boss among them, so that switch does not exist on a boss's row and never did. A sentence naming
     * a control that is not on the screen is the defect, not the advice.
     *
     * ⚠ **AND THE NATIVE CLASS IS NOT ONE EITHER.** `/Script/SCUM.Razor` always resolves, and the
     * bridge refuses it as `native_pawn_class` — because spawning it took a server down: a native
     * `ARazor` has a null `_razorCommonData` and the game's own tick dereferences it unguarded. Do not
     * be tempted by a class path that resolves.
     *
     * What CAN bring the class in is the game's OWN spawn command, and exactly two bosses have one —
     * read out of the paks rather than guessed at (`AdminCommands/SpawnRazor`, build 1.3.3.4):
     *
     *   SpawnRazor    one optional `Location` argument, a string — places a Razor where it is asked
     *   SpawnBrenner  no argument at all — lands on whoever ran it, so it cannot be aimed
     *
     * Dropship, Sentry and Sentry2 have no admin command anywhere in the game's 233. For those the
     * honest answer is that the class arrives when the game makes one, and `whyNoGameSpawn` says so.
     *
     * **It goes out as the MANAGER's own admin command, not as a module's.** `host.server.command` is
     * the route `reloadLoot` already takes; the bridge's `is_spawn_family()` names `SpawnRazor` and
     * `SpawnBrenner` outright and holds them to the spawn gap, and `needs_game_thread()` puts every
     * `Spawn…` verb inside a frame — the route measured safe for
     * `ReloadLootCustomizationsAndResetSpawners` in 2.22.2. So it needs no bridge spawn switch and no
     * `allowModuleAdmin`, and nothing here starts an asset load of its own: the GAME loads the class,
     * on its own thread, the way it does for an admin typing the command.
     *
     * **It needs somebody online, and that costs this plugin nothing.** A zone only fills posts while a
     * player is within `wakeDistance` of the rectangle, so the executor is there by construction. That
     * is the objection that makes the game's own spawn a poor default elsewhere and a free one here.
     */
    let gameSpawnTable = null;
    function gameSpawnFor(t) {
      if (gameSpawnTable === null) {
        try {
          gameSpawnTable = JSON.parse(fs.readFileSync(path.join(__dirname, 'guard-classes.json'), 'utf8')).gameSpawn || {};
        } catch { gameSpawnTable = {}; }
      }
      const word = typeWord(t);
      const e = word ? gameSpawnTable[word] : null;
      // ⚠ EVERY ENTRY COMES BACK, INCLUDING THE ONES THAT SAY NO. `spawnable: false` is a MEASURED
      // refusal by the game and it is worth more to a caller than the absence it used to be read as:
      // absent means "no admin command exists", and that is a different sentence to put on a card.
      //
      // The KEY travels with it: the game's own command takes the spawn NAME, which is the key of
      // this table and never the class path the direct route wants. Carrying it here is what stops a
      // caller sending a label, a path or `undefined` as a type name.
      return e ? Object.assign({ name: word }, e) : null;
    }

    /**
     * Place one guard through the game's own spawn command. `{ count, ids, why }`, the same shape
     * `sendGuard` answers in — and `ids` is always empty, because the command hands back no identifier.
     *
     * ── DRIVEN, against game build 1.3.3.4, with a player in the world ───────────────────────────
     *
     * ⚠ **SILENCE IS SUCCESS ON THESE VERBS, AND A SENTENCE IS A REFUSAL.** This used to require the
     * reply to start `Spawned` or `Loading`, which is what `#SpawnItem` answers — and no creature
     * verb says either. Measured: `SpawnAnimal BP_Deer 1 Location "X=337182 Y=380521 Z=21100"`
     * answered with an EMPTY output and put a deer 83 cm from that point, while
     * `SpawnZombie BP_Zombie_Military 1 Location "…"` answered `'BP_Zombie_Military' is not allowed
     * to be spawned.` and created nothing. So the old rule called every success a failure, the post
     * was filled again on the next round, and nothing on any screen said why.
     *
     * ⚠ **`Location` IS A PROPERTY VALUE AND IT WORKS ON THE THREE CREATURE VERBS ONLY.** They all
     * derive `UAdminCommand_SpawnPrimaryActorAsset`, whose grammar is
     * `<verb> <name> <count> <property> <value>` with `Location` one of the two values its own
     * completion asset publishes. The deer landing 83 cm from the asked point is that measured. The
     * two BOSS verbs are not of that family — `SpawnRazor` declares one argument of its own called
     * `Location` and `SpawnBrenner` declares none — and NEITHER can be aimed; see `places: false` in
     * `guard-classes.json` and the note beside it.
     */
    async function gameSpawn(entry, at, name) {
      const x = Math.round(nz(at.x, 0)); const y = Math.round(nz(at.y, 0)); const z = Math.round(nz(at.z, 0));
      // The quotes are real characters in the command line: SCUM parses `Location "X=… Y=… Z=…"` as
      // one argument, and an UNQUOTED coordinate is the form recorded as taking a server down. One at
      // a time, always — the count stays 1 and the post's next fill goes direct.
      const word = String(entry.name || '').trim();
      // ⚠ A NAMED VERB WITH NO NAME IS NOT A COMMAND TO GUESS AT. `SpawnZombie  1 Location "…"` is a
      // line the game would read as something else entirely, and a label like "the guard" is not a
      // spawn type. It refuses here rather than sending anything.
      if (entry.named && !/^[A-Za-z0-9_]{1,64}$/.test(word)) {
        // The game's spawn command takes a name, and only a class path is known here.
        return { count: 0, ids: [], why: `${name} could not be sent: it has no spawn name, only a class path` };
      }
      /**
       * Three shapes, and which one a verb takes was DRIVEN rather than read off the catalogue:
       *
       *   named    `SpawnZombie BP_Zombie_Police_Fat 1 Location "X=… Y=… Z=…"`  — aims, 83 cm
       *   count    `SpawnRandomZombie 1 Location "X=… Y=… Z=…"`                 — aims, 46 cm
       *   bare     `SpawnBrenner`                                               — lands on the player
       *
       * ⚠ **THE BARE ONE IS NOT A SHORTER SPELLING OF THE OTHERS.** Four forms of `SpawnRazor` were
       * driven, including the `Location` keyword the game's own argument hint carries, and every one
       * that spawned anything put the boss on the player who ran the command, 120 m from the point
       * asked for. So a boss verb is sent bare, because the argument changes nothing and the
       * keyword-present UNQUOTED form is the one this project has measured taking a server down.
       */
      /**
       * 🚫 **THE BAN, ASSERTED AGAIN AT THE WIRE.** `BANNED_VERBS` is checked where the decision is
       * made, and it is checked here too, because this is the only function in the plugin that can
       * put an admin spawn command on the wire and the shape of a bare verb is exactly the shape
       * `SpawnBrenner` takes. A catalogue is a data file an update rewrites; a refusal here is not.
       */
      if (BANNED_VERBS.has(String(entry.verb))) {
        // That command once killed a prisoner two metres away.
        return { count: 0, ids: [], why: `${name} is never sent: its command takes no place and lands on whoever runs it. `
          + 'The post fills once the game makes one.' };
      }
      const cmd = entry.named
        ? `${entry.verb} ${word} 1 Location "X=${x} Y=${y} Z=${z}"`
        : (entry.count ? `${entry.verb} 1 Location "X=${x} Y=${y} Z=${z}"` : entry.verb);
      let res = null;
      try {
        res = (host.server && typeof host.server.command === 'function')
          ? await host.server.command(cmd)
          : null;
      } catch { res = null; }
      if (!res) return { count: 0, ids: [], why: `${name} could not be sent: ${NO_BRIDGE_ANSWER}` };
      if (res.ok === false) return { count: 0, ids: [], why: `${name} could not be sent: ${res.error || res.reason || 'the command was refused'}` };
      const said = (Array.isArray(res.output) ? res.output : []).map((s) => String(s || '').trim()).filter(Boolean);
      // A sentence from the game is a refusal, whatever else came back with it — the same rule the
      // persistent route below learned the hard way, where 25 sends were reported as successes while
      // the game was refusing every one.
      if (said.length) {
        if (said.some((s) => /^(Spawned|Loading)\b/i.test(s))) return { count: 1, ids: [], gameSaid: said.join(' ') };
        return { count: 0, ids: [], why: `the game refused ${name}: ${said.join(' ')}` };
      }
      // ⚠ NOTHING CAME BACK, AND FOR THESE VERBS THAT IS THE SUCCESS CASE — but only where there was
      // somebody to run it. With nobody online the bridge dispatches through the game's static entry
      // point, which was measured creating nothing at all, and that silence means the opposite.
      if (res.confirmed === false) {
        // The spawn command runs through a player's admin channel.
        return { count: 0, ids: [], why: `${name} was not spawned: it needs a player online` };
      }
      return { count: 1, ids: [], gameSaid: '' };
    }

    /**
     * Why a guard cannot be brought in, in one sentence and NAMING WHICH OF THE THREE CASES IT IS.
     *
     * They are genuinely different and an owner can act on two of them:
     *
     *   · the game refuses the NAME (`spawnable: false`) — the five abstract bases a puppet family is
     *     built on. Measured: the game answers "'BP_Zombie_Military' is not allowed to be spawned",
     *     and the DIRECT route faults on the same class. Pick one of its variants instead.
     *   · the command exists and cannot be AIMED (`places: false`) — the two bosses. Measured twice:
     *     a Razor asked for at a post 120 m away appeared on the executing player instead. Sending it
     *     anyway would drop a boss on top of whoever happens to be nearest, so it is not sent.
     *   · there is no command at all — Dropship, Sentry, Sentry2, Drone, Shark. Nothing in the game's
     *     233 makes one.
     */
    function whyNoGameSpawn(name, entry) {
      if (entry && entry.spawnable === false) {
        // It is the base a family of puppets is built on, and both routes refuse it.
        return `${name} cannot be spawned ("'${name}' is not allowed to be spawned"). `
          + 'Choose one of its variants on this guard\'s row.';
      }
      /**
       * The two bosses are not the same case, and saying so is the point. `SpawnRazor` with its
       * own quoted coordinate creates nothing anywhere and yet brings `BP_Razor_C` into memory, so
       * a Razor at a point somebody named arrives on the next round. `SpawnBrenner` declares no
       * argument at all and lands on whoever runs it, killing them — there is no safe way to make
       * the first one, so it waits.
       */
      if (entry && entry.verb && BANNED_VERBS.has(String(entry.verb))) {
        // Something else must make the first one (an encounter, a bunker, an admin); then every
        // post fills, for the rest of the session.
        return `${name} is not loaded yet. Its only command takes no place and lands on whoever runs it, `
          + 'so posts wait until the game makes one.';
      }
      if (entry && entry.verb && entry.atPlayer) {
        /**
         * For one of them there is something to do about it. `SpawnRazor` given its own quoted
         * coordinate creates nothing anywhere — an island-wide razor preview afterwards finds none,
         * including none on the player who ran it — and yet brings `BP_Razor_C`
         * into memory. So for that one verb, naming a point on the row turns this wait into a
         * few seconds. It is offered only where it is true; the other boss has no such route, and
         * this sentence must not imply one.
         */
        const alsoNamed = LOADER_VERBS.has(String(entry.verb))
          ? ' Or name a point on this guard\'s row: it is placed there next round.'
          : '';
        // Every spelling of its command puts the boss on the PLAYER who ran it, so nothing is sent.
        // Anything else making one (a bunker, an encounter, an admin) fills these posts.
        return `${name} is not loaded yet. Its command WORKS but cannot be aimed, so posts wait `
          + 'for the game to make one, then fill for the rest of the session; a restart resets it.' + alsoNamed;
      }
      /**
       * ⚠ **"NOT LOADED" IS TWO ANSWERS AND ONLY ONE OF THEM IS A NO.** The bridge resolves with
       * `StaticFindObject`, which sees what the game has MADE and nothing else, so one refusal
       * covers both *"this build has no such class"* and *"the game has it and nothing has made one
       * yet"*. An owner reads the first, gives up, and the truth was the second.
       *
       * This plugin does not have to pass that on. It SHIPS the answer: `guard-classes.json` is a
       * catalogue of what the build contains, derived from the game's own paks, and it answers with
       * nothing loaded, nobody online and no reading of the world at all. So a path the catalogue
       * knows is a WAIT with an end, and a path it does not know is the owner's to check.
       */
      if (catalogueHas(name)) {
        // The direct route can only place a class the game has built once; the first arrives from
        // an encounter, a bunker or a guarded post. The zone keeps trying meanwhile.
        return `${name} is in this build, but nothing has made one on this server yet. `
          + 'There is no admin command for the first; posts fill once the game makes one.';
      }
      // The game answers a name it never made and a name it lacks with the same refusal.
      return `${name} is not in this plugin's catalogue. Check the class path on this guard\'s row.`;
    }
    /**
     * Is this a class the BUILD has? Answered from the shipped catalogue, never from the world —
     * which is the whole point: what the game contains is a fact about the build and does not change
     * while the server runs, so it needs no bridge, no player and no loaded class to answer.
     */
    function catalogueHas(word) {
      const w = String(word || '').trim();
      if (!w) return false;
      if (gameSpawnTable === null) gameSpawnFor({});         // fills both tables off the same file
      if (gameSpawnTable && gameSpawnTable[w]) return true;
      return Object.prototype.hasOwnProperty.call(classTable(), w);
    }

    let classPathTable = null;
    function classTable() {
      if (classPathTable === null) {
        try {
          classPathTable = JSON.parse(fs.readFileSync(path.join(__dirname, 'guard-classes.json'), 'utf8')).classes || {};
        } catch { classPathTable = {}; }
      }
      return classPathTable;
    }
    /**
     * The BLUEPRINT path the engine route needs, for a guard of either kind.
     *
     * A guard picked from the boss-or-creature picker carries one already. A guard picked from the
     * NPC, Zombie or Animal picker carries the game's own SPAWN NAME and no path at all — which is
     * all the game's command ever needed — so the path comes out of the shipped catalogue, keyed
     * by the same word `typeWord` derives for everything else here.
     *
     * ⚠ **A `/Script/` CLASS IS NEVER HANDED BACK.** A native-class pawn stands there with no
     * behaviour and one took a live server down in under a second; the picker already refuses to
     * SAVE one, and this is the second gate, on the path that builds one out of a catalogue rather
     * than out of an owner's choice.
     */
    function classPathFor(t) {
      const own = String((t && t.classPath) || '').trim();
      if (own) return /^\/Script\//i.test(own) ? '' : own;
      const w = typeWord(t || {});
      const p = w ? String(classTable()[w] || '') : '';
      return /^\/Script\//i.test(p) ? '' : p;
    }

    /**
     * How long to leave between two spawns at one post. The bridge's own `spawnMinGapMs` ships at
     * 350 and is an owner setting; this is past it with room, because the cost of being under it is
     * a refusal and the cost of being over it is a few hundred milliseconds of one patrol round.
     */
    const SPAWN_GAP_MS = 450;

    /**
     * 🚫 **VERBS THIS PLUGIN WILL NOT RUN, WHATEVER THE CATALOGUE SAYS.**
     *
     * `SpawnBrenner` declares no argument at all, so it lands on whoever runs it: it puts a
     * Brenner about two metres from the prisoner who ran it and kills them. There
     * is no safe way to aim it and none to make the class resident without it, so a Brenner is
     * offered only once something else has made one, and this plugin never asks the game to.
     */
    const BANNED_VERBS = new Set(['SpawnBrenner']);
    /**
     * …and the one verb that is a class LOADER rather than a spawn.
     *
     * `SpawnRazor "X=… Y=… Z=…"` creates nothing anywhere — an island-wide razor preview
     * afterwards finds none, including none on the player who ran it — and flips `BP_Razor_C` from
     * `loaded:false` to `true`. So it is exactly what a boss at a chosen point needs: the class
     * arrives, and the direct route then places one where the owner said, facing where they said,
     * with the game's own `BP_RazorAIController_C` behind it.
     *
     * ⚠ **ONE SPELLING, AND IT IS THE QUOTED ONE.** The BARE verb is the form measured to land on
     * the executing player, and the keyword-present unquoted form is the one this project has
     * recorded taking a server down. Neither is sent.
     *
     * ⚠ **AND IT IS ONE ENTRY BECAUSE THERE IS ONE VERB OF THIS SHAPE, not because the rest are
     * unhandled.** A LOADER is a verb that brings a class in and puts NOTHING in the world, which
     * is the only reason it may be sent at a coordinate an owner named: whatever it did place
     * would be unaimed. `SpawnArmedNPC`, `SpawnZombie` and `SpawnAnimal` are not that — they AIM,
     * measured at 83 cm, and they place a real guard. So a class those can reach is bootstrapped
     * by the `entry.places` branch in `sendGuard`, which sends one, counts it, and says on the
     * card that this one came through the game because the class was not resident. That covers
     * **58 of the catalogue's 70 classes**; five more are the family bases the game refuses
     * outright, five (Drone, Dropship, Sentry, Sentry2, Shark) have no spawn verb anywhere in the
     * game's 233 and can only wait for the game to make one, Razor is here, and Brenner is banned.
     * Adding a placing verb to this set would make it claim "nothing has been placed yet" about a
     * guard that is standing there.
     */
    const LOADER_VERBS = new Set(['SpawnRazor']);
    /**
     * Fetch a class into memory, once per server session, and place NOTHING.
     *
     * It answers in `sendGuard`'s shape with `count: 0` on purpose: nothing was created, so the post
     * is still empty and the patrol comes round again in a few seconds — by which time the class is
     * resident and the direct route places the boss at the point the owner named.
     */
    /**
     * Ask the bridge to bring a class into memory. `{ ok }` when it is resident afterwards,
     * `{ ok:false, why }` with the bridge's own sentence otherwise (switch off, older bridge).
     */
    async function loadClass(cls) {
      let r = null;
      try {
        r = (host.bridge && typeof host.bridge.command === 'function')
          ? await host.bridge.command('spawn', 'load:' + cls) : null;
      } catch { r = null; }
      if (r && r.ok) { log.info(`loaded ${cls} so it can be placed${r.note ? ` (${r.note})` : ''}`); return { ok: true }; }
      return { ok: false, why: r && r.reason ? String(r.reason) : null };
    }
    const bootstrapped = new Set();
    async function bootstrapClass(entry, at, name) {
      const word = typeWord({ classPath: entry.name || '' }) || String(entry.name || entry.verb);
      if (bootstrapped.has(String(entry.verb))) {
        // It arrives once anything else makes one: an encounter, a bunker, an admin.
        return { count: 0, ids: [], why: `${name} is not in this server's memory yet; the game `
          + 'has already been asked once this session. Your point fills once it arrives.' };
      }
      const x = Math.round(nz(at.x, 0)); const y = Math.round(nz(at.y, 0)); const z = Math.round(nz(at.z, 0));
      let res = null;
      try {
        res = (host.server && typeof host.server.command === 'function')
          ? await host.server.command(`${entry.verb} "X=${x} Y=${y} Z=${z}"`)
          : null;
      } catch { res = null; }
      /**
       * ⚠ **THE ONE ATTEMPT A SESSION GETS IS SPENT ONLY ON A COMMAND THAT REALLY RAN.**
       *
       * `host.server.command` has three outcomes, not two. With nobody in the world the bridge
       * dispatches through the game's static entry point and answers
       * `ok: true, dispatched: true, confirmed: false` — handed over, not accepted, not run. This
       * used to mark the class bootstrapped BEFORE the call and never look at the answer, so a
       * round that happened to land on an empty server burned the attempt: every later round
       * refused with *"the game has already been asked once this session"*, the boss post stayed
       * empty until the next restart, and nothing anywhere said why. An empty server is exactly
       * when a patrol has the least reason not to try.
       *
       * The same test `gameSpawn` above already uses — `confirmed !== false`, never `ok` alone,
       * because the field is ABSENT on the ordinary executor path and reading `ok` would call a
       * dispatch into the void a success.
       */
      const ran = !!(res && res.ok !== false && res.confirmed !== false);
      if (ran) bootstrapped.add(String(entry.verb));
      const said = (res && Array.isArray(res.output)) ? res.output.map((s) => String(s || '').trim()).filter(Boolean) : [];
      log.info(`asked the game to load ${word} for a named point — ${ran ? '' : 'nobody was online to run it, so it was not asked; '}${said.length ? said.join(' ') : 'it said nothing, which is what this call does'}`);
      if (!ran) {
        return { count: 0, ids: [], why: `${name} is not in this server's memory yet; loading it `
          + 'needs a player online. Retried then.' };
      }
      return { count: 0, ids: [], why: `${name} was not in this server's memory; it is loading. `
        + 'Your point fills next round. A restart repeats this once.' };
    }

    /**
     * ══ WHICH WIRE A GUARD GOES OUT ON — ONE DECISION, IN ONE PLACE ═══════════════════════════
     *
     * Three, and they are not interchangeable:
     *
     *   · `random`  — the game's own `SpawnRandom*`. Nothing has to be resident and nothing has to
     *     be named, it aims (46 cm, measured), and what it costs is IDENTITY: the post can never be
     *     asked about and is held by any creature of that kind, the game's own wildlife included.
     *   · `game`    — the game's own named spawn command. It places to the centimetre, SCUM makes
     *     the creature as one of its own, it needs somebody online, and it hands back no id.
     *   · `engine`  — the bridge's direct spawn. The only one with a FACING, the only one that
     *     hands back an id, and the only one that works with nobody online — at the cost of the
     *     class having to be resident already and the creature being gone at the next restart.
     *
     * ⚠ **THE ENGINE ROUTE USED TO FAULT FOR EVERY ORDINARY HUMANOID AND SINCE BRIDGE 2.27.0 IT
     * DOES NOT — so a guard an owner picked from the NPC, Zombie or Animal picker now takes it.**
     * Until then `BP_Guard_Lvl_2_C`, `BP_Drifter_Lvl_2_C`, `BP_Zombie_Civilian_Normal_Male_C` and
     * `BP_Zombie2_C` all answered `call_failed` / `begin_failed` and each left a half-built pawn
     * behind, so this refused to re-route and named the fault instead. That judgement was right
     * and its premise expired: 2.27.0 runs the route's `Begin` and `Finish` inside one game-thread
     * job, and the A/B at one point with the class resident both times is 4 of 4 faulted against
     * 8 of 8 placed.
     *
     * **What the move BUYS is the thing the owner asked for and no setting could give.** An
     * admin-spawned NPC is a *rogue character*: the encounter manager owns it and destroys it once
     * no player is within 175 m, five seconds after the last one leaves. An engine-placed one is
     * not registered at all, so that walk never looks at it — four guards measured still standing
     * at 45 s with the nearest player 50 km away, where an admin-spawned one dies about 9 s in.
     * Guards that stay in a zone the players are not standing in.
     *
     * **What it COSTS is on the card rather than in here.** No entity id and no save row, so it is
     * gone at the next server restart; and the class has to be resident already, which the first
     * fill arranges by going through the game's own command once. Both are drawn on the guard's
     * own row — a route an owner did not choose must not be a route they cannot see.
     *
     * ⚠ **`null` KEEPS TODAY'S BEHAVIOUR.** A bridge that has not answered is not an old bridge,
     * and a route moved on a reading nobody got is the worst of the three outcomes: the fault is
     * back, silently, with a body left behind every patrol.
     *
     * ⚠ **AND A ROW WITH NO BLUEPRINT PATH STAYS ON THE GAME ROUTE WHATEVER THE VERSION SAYS.**
     * The game's command takes a spawn NAME; the engine needs a path, and five of the catalogue's
     * classes have one and no verb while none has a verb and no path. `classPathFor` is the test,
     * so an owner who typed a name the catalogue has never heard of keeps the route that can still
     * work for them.
     */
    const routeOf = (t) => {
      if (t && t.random) return 'random';
      if (!t || t.route !== 'persistent') return 'engine';
      return (engineRouteOk() === true && classPathFor(t)) ? 'engine' : 'game';
    };
    /**
     * Why this guard is on the route it is on, for the card. Never a sentence — the words are the
     * frontend's, in eighteen languages, and this is the fact they are drawn from.
     */
    function routeNote(t) {
      const chosen = (t && t.random) ? 'random' : ((t && t.route === 'persistent') ? 'game' : 'engine');
      const now = routeOf(t);
      return { chosen, route: now, moved: now !== chosen, engineOk: engineRouteOk() };
    }

    async function sendGuard(at, r, what) {
      const name = what || 'the guard';
      const count = countFor(r);
      /**
       * ⚠ **WHICH WAY IT LOOKS, AND ONLY THE ENGINE ROUTE HAS IT.** `spawn:` takes a yaw and no
       * admin command in the game does — so a facing an owner typed is honoured on the direct route
       * and is simply not expressible on the other one. Clamped rather than passed through: the box
       * is a number an owner types.
       */
      const yaw = Math.max(0, Math.min(360, Math.round(nz(at.yaw, 0))));
      /**
       * ⚠ **A RANDOM GUARD NEEDS NOTHING LOADED AND NOTHING NAMED**, which is why it is answered
       * before either of the routes below: there is no class to resolve, so the whole "is it in
       * memory" question does not arise, and the game's own verb aims (46 cm, measured). It is the
       * one guard that works on a server whatever it has ever made.
       */
      const rnd = routeOf(r) === 'random' ? randomFor(r) : null;
      if (rnd) {
        const g = await gameSpawn(Object.assign({ name: '' }, rnd), at, name);
        return { count: g.count, ids: [], why: g.why };
      }
      if (routeOf(r) === 'game') {
        const name = String(r.spawnName || '').trim();
        if (!name) return { count: 0, ids: [] };
        // The game's own spawn command — dispatched on a player's own admin channel, so with nobody
        // online the bridge falls back to a route measured to create nothing at all. `confirmed` is
        // the game not objecting, never a count of what appeared.
        const q = await bq('spawnPersistent', String(r.spawnKind || 'armednpc'), at.x, at.y, at.z, count, name);
        const res = q.ok ? q.data : null;
        // ⚠ **THE MODULE'S OWN REFUSAL, WHICH USED TO BE THROWN AWAY BEFORE IT WAS READ.** A refusal
        // came back as `null` from `data()`, so every branch below this one was decided on a value
        // that could never carry a sentence — `allowModuleAdmin is off` included, which is why the
        // manual row on the Bridge card could never be drawn. `q.reason` is that sentence.
        if (!q.ok && q.reason) {
          const said = String(q.reason);
          if (/allowModuleAdmin is off/i.test(said)) {
            moduleAdminOffAt = Date.now();
            return { count: 0, ids: [], why: `${name} was not created: ${MODULE_ADMIN_WHY}` };
          }
          return { count: 0, ids: [], why: `${name} was not created: ${said}` };
        }
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
         * The bridge has since fixed it: a reply where the game said something and named no entity now
         * carries `confirmed: false` and `refusedByGame: true` (handled just above). This stays for an
         * older bridge, which is still out there. A reply carrying a sentence from the game is a
         * refusal, whatever the flag beside it says.
         */
        const saidNo = String((res && res.gameSaid) || '').trim();
        if (saidNo) {
          return { count: 0, ids: [], why: `the game refused the guard "${name}": ${saidNo}`
            + (at.z === 0 ? ' — the post is at sea level, which the game will not spawn into.' : '') };
        }
        if (!res) return { count: 0, ids: [], why: `${name} was not created: ${await whyOf(q, 'spawn', 'a guard at its post')}` };
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
          // This route runs through a player's admin channel; the bridge gave no reason.
          : `${name} was handed over and the game confirmed nothing. Probably nobody was online.` };
      }
      // ⚠ `classPathFor`, NOT `r.classPath`. A guard picked from the NPC, Zombie or Animal picker
      // carries the game's own spawn NAME and no path — all the game's command ever needed — and
      // since bridge 2.27.0 `routeOf` sends those here too. The catalogue is what turns one into
      // the other, and `routeOf` has already refused this route for a row it cannot resolve, so
      // an empty answer here is genuinely a row with nothing on it.
      const cls = classPathFor(r);
      if (!cls) return { count: 0, ids: [] };
      /**
       * ⚠ **A CLASS BOTH ROUTES REFUSE IS NOT SENT AT ALL, AND THE REASON IS THAT IT LEAVES A BODY.**
       *
       * Driven: `spawn:puppet:…:/Game/…/BP_Zombie_Civilian.BP_Zombie_Civilian_C`
       * answers `call_failed` — "the engine's spawn call faulted and was caught" — and the bridge's
       * own refusal warns, correctly, that a pawn may be standing at the coordinate anyway. Read back
       * afterwards, one was. So a post configured with one of the five family bases would fault the
       * engine every patrol and leave a puppet behind each time, for as long as the zone ran.
       *
       * The catalogue knows which five they are, so it is answered here rather than by trying.
       */
      const known = gameSpawnFor(r);
      if (known && known.spawnable === false) {
        return { count: 0, ids: [], why: whyNoGameSpawn(typeWord(r) || name, known) };
      }
      const ids = [];
      // Guards the GAME'S OWN command made, which hands back no identifier — counted apart from `ids`
      // because `ids.length` is what makes a post checkable, and a post filled this way is one that
      // falls back to looking at what is standing there. Folding the two would have reported this
      // whole fill as "nothing was made" and the patrol would have filled the post again immediately.
      let viaGame = 0;
      let why = null;
      const loadTried = new Set();
      for (let i = 0; i < count; i++) {
        /**
         * ⚠ **THE SECOND ONE IS REFUSED UNLESS THIS WAITS, AND THE REFUSAL USED TO BE DISCARDED.**
         *
         * `mod_spawn` governs its own rate — at most two per game tick, and never inside
         * `spawnMinGapMs` (350 ms as it ships) of the last one. This loop sent `count` requests back
         * to back, so a post asked for five collected ONE guard and four `rate_limited` refusals;
         * the caller then read `made.count > 0` and threw `made.why` away, the post was marked
         * filled, and nothing on any screen ever said the other four had not arrived. The tab
         * offers up to ten.
         *
         * So it PACES itself past the bridge's own gap. Five guards cost two seconds of one patrol
         * round, which is invisible — the patrol is on its own timer and the zone sends one post per
         * round anyway — and every one of them lands. The wait is skipped before the first, so an
         * ordinary post of one costs nothing at all.
         */
        if (i > 0) await new Promise((rs) => setTimeout(rs, SPAWN_GAP_MS));
        /**
         * ⚠ **`typeKind(r)`, AND `r.kind` WOULD HAVE BEEN WRONG FOR EVERY RE-ROUTED GUARD.** A row
         * picked from the NPC, Zombie or Animal picker carries `kind: 'npc'` whatever it is — the
         * real one is in `spawnKind`, because that is what the game's own command takes — so a
         * zombie sent here as `npc` is a zombie asking the bridge for the wrong gate, and the
         * census then looks for it under `puppet` and never finds what it just placed.
         * `typeKind` is the one function that reads both shapes, and it is what every other part
         * of this plugin already asks.
         */
        const q = await bq('spawnAt', typeKind(r), at.x, at.y, at.z, yaw, 0, 0, cls);
        const res = q.ok ? q.data : null;
        if (!res || res.error) {
          // The module's own words, at last: `rate_limited`, `not_spawned`, a class that does not
          // resolve, the Bosses switch being off. Every one of these reached the card as "the
          // bridge did not answer" until this read `q.reason`.
          const said = (res && (res.reason || res.error)) || q.reason || NO_BRIDGE_ANSWER;
          /**
           * ⚠ **THE CODE FIRST, THE PROSE ONLY AS A FALLBACK — AND `class_not_loaded` IS A REFUSAL
           * RATHER THAN A FAULT.** Every refusal here carries `error: "<code>"` beside the
           * sentence, and the two read alike from outside: both answer `spawned:false`. They are
           * opposite things to tell an owner — *the game has to make one of these first, and the
           * next wave does that for you* against *the engine's spawn call faulted and there may be
           * a half-built body at that coordinate*. The prose test below is kept because
           * `class_not_loaded`'s own sentence contains "not in memory for this to place" and an
           * older bridge is still out there, but the code is what is asked first.
           */
          const code = String((res && res.error) || '').trim();
          const notLoaded = code === 'class_not_loaded' || code === 'class_not_found'
            || (!code && /not in memory/i.test(String(said)));
          /**
           * ⚠ **"NOT IN MEMORY" IS NOT A BROKEN PATH, AND IT IS NOT THE OWNER'S PROBLEM TO SOLVE.**
           *
           * The bridge's sentence explains Unreal's class loading, which is a bridge's job and is a
           * good sentence. What this plugin used to do with it was hand the owner a lecture and a
           * control that is not on a boss's row — so the whole of it now happens here instead: the
           * game's own spawn command places this one, which is also what brings the class in, and
           * every fill after it takes the direct route and its ids. See `gameSpawn` above.
           *
           * ⚠ It is tried ONCE per fill rather than remembered, deliberately. "The class is not
           * loaded" is a fact about the game that changes without telling anybody — an encounter, a
           * bunker, this very command — and a memo saying otherwise would keep a post on the route
           * with no ids for the rest of the session.
           */
          if (notLoaded) {
            const entry = gameSpawnFor(r);
            /**
             * The bridge loads the class itself (`spawn` `load:<classPath>`): nothing is spawned,
             * the class comes into memory inside one game frame, and this post is placed directly
             * straight after. Driven live: Razor 234 ms, Brenner 203-218 ms, no fatal, and a Brenner placed
             * at the requested point right after the load. So
             * no boss has to wait for the game to make one, and no command lands on a player.
             * Tried once per class per round; the older routes below stay for a bridge with the
             * load switch off.
             */
            if (!loadTried.has(cls)) {
              loadTried.add(cls);
              const ld = await loadClass(cls);
              // Placed at once, past the bridge's spawn gap: the game drops a class nothing uses
              // within a minute or two (driven: Razor and Brenner were both gone again), so a load
              // left for the next round can be wasted.
              if (ld.ok) { i--; await new Promise((rs) => setTimeout(rs, SPAWN_GAP_MS)); continue; }
            }
            /**
             * ⚠ **A BOSS IS NEVER SENT, AND THIS IS THE SECOND ANSWER TO THAT QUESTION.** The first
             * was an owner switch that let one arrive beside a player, and the owner refused it in
             * the words *"nemuze se mu neco objevit na hlave"* — a Razor materialising on top of
             * somebody is not a feature with a cost, it is a thing that happens to a player. So the
             * option is gone rather than defaulted off.
             *
             * What is left is not a gap, and it was MEASURED rather than assumed. Every route in the
             * game that can make the FIRST one is anchored to a player: both boss verbs land on the
             * executor whatever argument they are given (four spellings, two verbs, all four
             * driven), and every `Force…Encounter` verb in the game's 233 says "at player's
             * location" in its own description. There is no aimed route.
             *
             * And the good half, which is why this reads as a wait rather than a wall: once ANYTHING
             * has made one, the class stays resident and the direct route places them exactly, with
             * an id — a Razor can be spawned directly hours after every earlier instance has been
             * destroyed, because the class survives garbage collection for as long as the server is
             * up. A restart clears it, and the zone simply waits again.
             */
            /**
             * There is one boss with a safe way in. `SpawnRazor`
             * given its own quoted coordinate produces NOTHING anywhere — an island-wide razor
             * preview finds none, including none on the player who ran it — and yet flips `BP_Razor_C` from
             * `loaded:false` to `true`. So it is a class LOADER rather than a spawn, and once the
             * class is in, the direct route places a Razor exactly, facing where it was told, with
             * the game's own `BP_RazorAIController_C` behind it.
             *
             * It is fired ONCE per server session, and only for a guard whose owner has NAMED a
             * point — the case where the alternative is a post that waits for ever. The refusal
             * below is what every other boss still gets.
             *
             * `SpawnBrenner` is banned, and the ban is here rather than in a data file. It
             * declares ZERO arguments, so it always lands on whoever runs it: it spawns a Brenner
             * about two metres from the prisoner who ran it and kills them. The
             * catalogue's `places: false` already keeps it out of the branch below, and a catalogue
             * is a file an update rewrites — this is the rule, in code, where it cannot drift.
             */
            if (entry && entry.verb && BANNED_VERBS.has(String(entry.verb))) {
              const banned = whyNoGameSpawn(typeWord(r) || name, entry);
              why = banned;
              break;
            }
            if (entry && entry.atPlayer && LOADER_VERBS.has(String(entry.verb)) && at.named === true) {
              const g = await bootstrapClass(entry, at, name);
              why = g.why;
              break;                                   // nothing was placed: the class was fetched
            }
            if (entry && entry.places) {
              const g = await gameSpawn(entry, at, name);
              // ⚠ **ONE, AND THEN STOP FOR THIS ROUND.** The game's own command is what brings the
              // CLASS in, and a second one would be a second admin command inside the bridge's own
              // spawn gap — refused, and reported as a failure of the fill. So a post asking for
              // three guards gets one now and the rest on the next patrol a few seconds later, by
              // which time the class is resident and they go directly, with ids.
              //
              // ⚠ **AND IT SAYS SO, BECAUSE IT IS NOT A FAILURE AND IT IS NOT NOTHING EITHER.** A
              // guard really arrived, at the right place, and it is the one guard of this wave
              // that carries no id and that the game will cull at 175 m. Saying nothing here makes
              // the first wave of every zone look like a broken one; saying "it faulted" would be
              // a sentence about a thing that did not happen.
              if (g.count) {
                viaGame += g.count;
                // The spawn command also brings the class into memory.
                why = `${name} is not in this server's memory yet, so this one used the game's spawn `
                  + 'command. Next wave places them directly.';
                break;
              }
              why = g.why;
              break;
            }
            // ⚠ THE CLASS WORD, NEVER THE OWNER'S LABEL. Every sentence this returns is about a
            // class path, and one of them now asks the shipped catalogue whether the build HAS it —
            // which a label like "night shift" can only ever answer no to.
            why = whyNoGameSpawn(typeWord(r) || name, entry);
            break;
          }
          /**
           * ⚠ **THE ENGINE'S OWN SPAWN CALL FAULTING IS NOT "THE BRIDGE IS NOT THERE", AND WHAT TO
           * SAY ABOUT IT DEPENDS ON THE BRIDGE'S VERSION.** Every ordinary humanoid faulted on this
           * route below 2.27.0 — `call_failed` on the AI path, `begin_failed` on the actor path,
           * each leaving a half-built pawn at the coordinate — because `Begin` and `Finish` ran on
           * UE4SS's polling thread rather than inside one game-thread job. On such a bridge the act
           * an owner can take is real and this names it: move this guard to the game's own command,
           * which places every one of them to the centimetre.
           *
           * On 2.27.0 and newer that advice is wrong, and a wrong remedy is worse than none: the
           * route is the one this plugin CHOSE for them, humanoids place 8 of 8 on it, and a fault
           * here is a fault to report rather than a setting to change. The one thing it must still
           * say is the part an owner can check — something may be standing at that coordinate.
           */
          if (/call_failed|begin_failed|spawn call faulted|begin play/i.test(String(said))) {
            why = engineRouteOk() === false
              // On this bridge the engine route faults for humanoids (guard, drifter, puppet).
              ? `${name} could not be placed directly: ${said}. Update the bridge to 2.27.0, `
                + 'or switch this guard to the route that goes through the game, on its own row.'
              : `${name} could not be placed directly: ${said}. Check the spot in game for a half-built `
                + 'body. Retried next wave.';
            break;
          }
          why = `${name} could not be sent to its post: ${said}`;
          break;
        }
        /**
         * ⚠ **KEEP THE WHOLE ID. THE HALF AFTER THE DOT IS THE ONLY THING THAT MAKES IT AN
         * IDENTITY.**
         *
         * A spawn answers `<slot>.<serial>` — the object-array index, and the serial Unreal
         * allocated for that particular object. The index alone is a POSITION: the engine hands a
         * freed slot to the next actor that needs one, and the whole point of the serial is that
         * `resolve()` then refuses it. This used to store `Number(id.split('.')[0])`, throwing the
         * serial away at the one moment it is ever offered, and the two readers wanted opposite
         * things from it — so both now take what they need out of the full string instead:
         *
         *   · `postHeld()` asks `entity:<slot>`, which is right and stays right: `mod_entities`
         *     PINS the serial itself when it first indexes an object and refuses a recycled slot,
         *     so the index is the whole of the id that verb wants. Driven —
         *     `entity:1648804` answers the record, `entity:1648804.672961` is refused with "has no
         *     property called '672961'", because there the dot introduces a property path.
         *   · `isOwnGuard()` compares against a `preview` id, which carries the serial, and it is
         *     the one place a stale slot COSTS something: it spares whatever is standing there.
         */
        const id = String(res.id || '');
        if (/^\d+(\.\d+)?$/.test(id) && Number(id.split('.')[0]) > 0) ids.push(id);
        // A guard with no brain stands still for ever and gets reported as a bug against this
        // plugin, so the warning the bridge already made is passed on rather than dropped.
        if (res.warning || res.brain === false) {
          log.warn(`the guard spawned at a post has no working AI: ${res.warning || 'no controller was created'}`);
        }
      }
      // ⚠ **A POST HELD PARTLY BY SOMETHING WITH NO ID IS CHECKED BY LOOKING, NOT BY ASKING.** With a
      // count above one the class can come in halfway through, so one fill can produce a guard the
      // game made and a guard this made — and `postHeld` stops at the ids when there are any, so the
      // day every id had died it would call the post empty with a razor standing on it and send
      // another. Dropping the ids costs this one post the cheaper check and cannot over-fill.
      return { count: ids.length + viaGame, ids: viaGame ? [] : ids, why };
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
      /**
       * ⚠ **THE STORE IS NOT THE GAME, AND COMPARING AGAINST IT MADE THE RE-APPLICATION A NO-OP.**
       *
       * This used to be `if (stored === seconds) return;` — and the whole reason it runs on every
       * slow tick is that the game does NOT save this property: a server restart puts it back to
       * the shipped value and nothing anywhere says so. The manager's store survives that restart,
       * so after the first application the guard short-circuited for ever, the delay silently
       * stopped being applied, and the tab went on reporting it as held.
       *
       * So the comparison is against the LIVE value, read from the bridge. One read per slow tick
       * while a zone is asking for it; nothing at all while none is.
       */
      const gq = await bq('guardedZones');
      const live = gq.ok ? gq.data : null;
      const was = (() => {
        const rows = (live && Array.isArray(live.fields)) ? live.fields : [];
        const row = rows.find((f) => f && (f.key === 'respawn' || f.key === 'sentryRespawnSeconds'));
        return row ? nz(row.value, 0) : 0;
      })();
      const mine = nz(host.store.get(K.respawnSet, 0), 0);
      // Already exactly what was asked for, and the game confirmed it: nothing to send.
      if (was === seconds && mine === seconds) return;
      /**
       * ⚠ **"WHAT IT WAS" IS ONLY EVER READ WHILE THIS PLUGIN IS NOT HOLDING IT.** The reading was
       * taken after the plugin had already written its own number, so changing the delay from 3600
       * to 7200 recorded 3600 — OUR value — as the owner's original, and switching the zone off
       * then "put back" a number the owner had never chosen. While `respawnSet` is set, the live
       * value is ours by construction and must not be recorded as anybody's.
       */
      const r = await bx('setSentryTuning', 'respawn', seconds);
      if (!r || r.ok !== true) {
        log.warn(`the sentry respawn delay could not be set: ${(r && (r.reason || r.error)) || NO_BRIDGE_ANSWER}`);
        return;
      }
      if (was > 0 && !mine) host.store.set(K.respawnWas, was);
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
     *
     * Answers `{ sent, why?, routes, failed }` so "Try it in game" can say what really happened: a
     * message that is switched off, has no text or has no route ticked sends NOTHING, and a toast
     * saying "Sent" over that is a control that lies.
     */

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // HOW BUSY A ZONE IS — the game's own population layer, and not a borrowed player
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    //
    // Everything else this plugin does about creatures puts ONE character in ONE place: it clears a
    // sentry and stands a guard of the owner's choosing where it stood. That is an aimed act and it
    // needs the game's own spawn route, which is why it needs somebody online.
    //
    // This is the other half and it is a different question. *"How busy is this place?"* is not
    // something the game answers by placing anything: SCUM keeps its whole population plan in one
    // cooked asset, `The_Island_LevelStaticData`, and **the running server re-reads it**. A PLACE
    // there is a rectangle with a schedule behind it — a spawn chance and how often the game rolls
    // it — and the game spawns from that schedule when a player comes near the place.
    //
    // So a zone can be made busier or quieter with **no borrowed player at all**, which is the thing
    // that was wrong with doing it the other way. What has not changed, and what the screen has to
    // say out loud, is that **nothing appears anywhere until somebody is near it**. The game has
    // never had a creature standing in a place nobody is close to, and no setting here invents one.
    //
    // ── AND THE SCHEDULE IS SHARED, WHICH IS THE WHOLE SHAPE OF THIS FEATURE ──────────────────────
    //
    // The island's 294 places run on **27 distinct schedules**. One schedule is every village; one
    // is every military compound. So a zone cannot turn up ITS village — it turns up VILLAGES. That
    // is a real limit and it is not one this plugin can design away: the schedule is the game's,
    // shared by construction, and inventing a new one means creating a cooked asset inside a running
    // server, which nobody here has established is safe.
    //
    // Everything in this section therefore exists to make that limit visible rather than to hide it.
    // `activityPlan()` counts, for every zone, how many places its rectangle covers, how many kinds
    // of place those are, and **how many OTHER places on the island share those kinds**. The tab
    // prints that third number before an owner has chosen anything, the backend refuses a kind whose
    // reach is over the owner's own ceiling, and nothing is ever applied that has not been counted.
    //
    // ── WHAT IS PUT BACK, AND WHEN ────────────────────────────────────────────────────────────────
    //
    // These are the game's objects, not this plugin's configuration, and a server left with every
    // village at a hundred percent is a wrecked server. Four things put them back and only the first
    // is this plugin's doing:
    //
    //   · a zone going off, this plugin being switched off, the tab being unloaded — `restoreActivity`;
    //   · the BRIDGE's own hold. Every write says how long it is meant for and the bridge puts the
    //     schedule back by itself when that lapses. `applyActivity` runs on the slow tick and asks
    //     again each time, so the hold is always several ticks ahead — and a manager that CRASHES
    //     stops asking, and the island comes back on its own. That is the one that survives this
    //     process dying, and it is why the hold is never set to something enormous;
    //   · a server restart, because nothing here is saved anywhere;
    //   · and the bridge restoring when its own switch goes off.
    //
    // ⚠ **THIS PLUGIN RESTORES BY NAME, NEVER BY ASKING FOR EVERYTHING.** `restoreEncounterZones()`
    // with no argument puts back every schedule the BRIDGE has changed, which is not the same set as
    // the ones this plugin changed — the panel and another plugin can reach the same verb. So the
    // store remembers which schedules are ours and each one is named on the way back.

    /**
     * The zone's own activity settings, or the page defaults. The single reader, exactly like
     * `guardsFor` — nothing below this knows which of the two answered.
     */
    function activityFor(entry) {
      const base = cfg().activity || {};
      const own = (entry && entry.activity) || null;
      if (!own || typeof own !== 'object') return base;
      return merge(own, base);
    }

    /**
     * The configured zone behind a live one.
     *
     * The active list is a SNAPSHOT taken when the zone went on, so a setting changed since is on
     * the configured entry and not on it. Every reader of a zone's settings in this file goes
     * through the configured entry for that reason; this is the one line that does the lookup.
     */
    function byIdOf(c, a) {
      return ((c && c.zones) || []).find((z) => String(z.id) === String(a && a.id)) || null;
    }

    /** Is this zone asking for anything at all? `leave` is the shipped default and touches nothing. */
    function activityWanted(entry) {
      const a = activityFor(entry) || {};
      if (a.mode !== 'busier' && a.mode !== 'quieter') return null;
      const pct = Math.max(0, Math.min(300, nz(a.percent, 100)));
      // A hundred percent is the game's own value, so it is a request to change nothing however the
      // mode reads. Said here rather than at the four call sites, and it is NOT an error: an owner
      // sliding back to 100 is choosing the game's own balance, which is a perfectly good choice.
      if (pct === 100 && !nz(a.checkSeconds, 0)) return null;
      return {
        percent: pct,
        checkSeconds: Math.max(0, Math.min(3600, Math.round(nz(a.checkSeconds, 0)))),
        maxPlaces: Math.max(0, Math.round(nz(a.maxPlaces, 0))),
      };
    }

    /**
     * The island's places, read once and remembered for a while.
     *
     * It is a cooked asset — it cannot change while the server runs — so this is cached for the life
     * of a server session rather than polled. What CAN change is what each schedule is set to right
     * now, and that comes back on every read, so the cache is dropped whenever anything is written.
     *
     * ⚠ `null` is "the bridge could not answer", never "the island has no places in it". Every
     * caller below treats it as the first, because the second would mean this plugin quietly
     * deciding a zone covers nothing and applying nothing while reporting success.
     */
    /**
     * ⚠ **"THIS MANAGER CANNOT ASK" IS NOT "THE BRIDGE DID NOT ANSWER", AND `bx` SPELLS THEM THE
     * SAME.** It hands back `null` for a verb the host has never heard of and for a bridge that
     * refused, which is right for every caller that only has to stand down — and wrong on a screen,
     * because one of the two is fixed by updating the manager and the other by starting the server.
     * A plugin installed on a manager too old for this feature would otherwise be told, for ever,
     * that the game had not sent its zone list yet.
     */
    // Everything else on the page keeps working.
    const OLD_MANAGER = 'this manager is older than the spawn-plan reading. Update the manager for this part.';
    /**
     * ⚠ **THREE CAUSES, AND THE FIRST TWO ARE NOT THE SAME SENTENCE.** No bridge at all is the
     * ordinary one and this plugin already has words for it; a bridge with none of these three verbs
     * is a MANAGER older than the feature, which no amount of starting the server will fix. Folding
     * them together sends an owner to restart a server over a manager they need to update, which is
     * the commoner of the two and the one that reads as a fault.
     */
    function activityBlocker() {
      if (!host.bridge) return NO_BRIDGE_ANSWER;
      if (typeof host.bridge.encounterPlaces !== 'function'
        || typeof host.bridge.setEncounterZone !== 'function'
        || typeof host.bridge.restoreEncounterZones !== 'function') return OLD_MANAGER;
      return null;
    }

    let placesCache = null;
    let placesCacheAt = 0;
    // The ENCOUNTERS module's own sentence for the last failed read, so a card that says "the
    // island could not be read" can say WHY rather than restating the commonest cause.
    let placesWhy = null;
    const PLACES_CACHE_MS = 5 * 60 * 1000;
    function dropPlacesCache() { placesCache = null; placesCacheAt = 0; }
    async function islandPlaces(force) {
      if (!force && placesCache && Date.now() - placesCacheAt < PLACES_CACHE_MS) return placesCache;
      const q = await bq('encounterPlaces');
      const r = q.ok ? q.data : null;
      if (!q.ok && q.reason) placesWhy = String(q.reason);
      else if (q.ok) placesWhy = null;
      // ⚠ A FAILED READ DROPS THE CACHE, and that is not tidiness. The places themselves cannot
      // change while the server runs — they are a cooked asset — but what each schedule SAYS can,
      // and so can whether the bridge will let it be changed at all. Serving yesterday's answer to
      // a screen after the bridge has just said it cannot answer is this plugin telling an owner a
      // number it no longer has any reason to believe.
      if (!r || !Array.isArray(r.places)) { dropPlacesCache(); return null; }
      placesCache = r;
      placesCacheAt = Date.now();
      return r;
    }

    /**
     * Does a place's own rectangle touch any of a zone's rectangles?
     *
     * ⚠ **TWO CONVENTIONS, AND MIXING THEM DOUBLES A RECTANGLE.** `readRect` hands back
     * `{x, y, width, height}` — a centre and the WHOLE span, which is what every measurement in
     * this plugin works in — while a place carries `halfX`/`halfY`, which are HALF-widths exactly as
     * the game's own zones are. Reading one of those as a whole span is the mistake that made every
     * loot rectangle twice its size, found on a live server with the owner standing on what should
     * have been the corner. Both are centimetres, and both are halved here before anything is
     * compared.
     *
     * OVERLAP, not "the centre is inside". A village whose centre sits ten metres outside the
     * rectangle still spawns into it, and calling that place untouched would make the count on the
     * screen smaller than what the owner would actually see.
     */
    function placeTouches(p, rects) {
      const px = Number(p.x), py = Number(p.y);
      if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
      const hx = Number.isFinite(Number(p.halfX)) ? Math.abs(Number(p.halfX)) : 0;
      const hy = Number.isFinite(Number(p.halfY)) ? Math.abs(Number(p.halfY)) : 0;
      for (const r of rects || []) {
        const rx = Number(r.x), ry = Number(r.y);
        if (!Number.isFinite(rx) || !Number.isFinite(ry)) continue;
        const rhx = Math.abs(nz(r.width, 0)) / 2;
        const rhy = Math.abs(nz(r.height, 0)) / 2;
        if (!(Math.abs(px - rx) <= hx + rhx && Math.abs(py - ry) <= hy + rhy)) continue;
        // A circle carries its bounding box, so the test above is the box's. For a circle the
        // corners of that box are not in the zone, and counting a village that sits in one as
        // "covered" would put it in a number an owner decides with.
        if (r.shape === 'circle') {
          const cx = Math.max(0, Math.abs(px - rx) - hx);
          const cy = Math.max(0, Math.abs(py - ry) - hy);
          const rad = Math.abs(nz(r.radius, 0));
          if ((cx * cx + cy * cy) > rad * rad) continue;
        }
        return true;
      }
      return false;
    }

    /**
     * ── WHAT A KIND OF PLACE CAN ACTUALLY PRODUCE ────────────────────────────────────────────────
     *
     * **A plan's chance decides how OFTEN the game rolls, never how many characters it makes.** The
     * amount lives on the encounter class behind the plan, and a plan can be authored to make none.
     * Driven: one kind of place authors an encounter whose base amount is `{0, 0}`,
     * and at a hundred percent with a five-to-ten-second roll and a player standing in it, about
     * forty successful rolls over five minutes put NOTHING in the world. The control group — the
     * same place at 0% and then at 100% — gave no characters and then five, so the dial does drive
     * the game. It simply cannot conjure something out of a plan that makes nothing, and a card
     * promising a busier zone over one of those is a false promise with no symptom.
     *
     * ⚠ **THREE STATES, NEVER TWO.** The bridge sends `baseAmountAlwaysZero: false` when it is SURE
     * something can appear, `true` when every encounter in the plan is authored to make none, and
     * **omits the key entirely** — with `verdictUnreadable` carrying its own sentence — when a row
     * could not be read. A value that could not be READ and a value the game does not HAVE are
     * opposite facts, and any truthiness test on that key collapses them into the one that takes a
     * control away. So it is read with `=== true` / `=== false` and nothing else, and everything
     * downstream carries `'yes'` / `'no'` / `'unknown'` rather than a boolean with nowhere to put
     * the third.
     *
     * There is a FOURTH shape and it lands in the same `'unknown'`: the whole list unreadable
     * (`plan.unreadable`), and a bridge too old to send a plan at all. Each keeps its own sentence,
     * because one is fixed by looking at the server and the other by updating the bridge.
     */
    // Everything else on the page keeps working.
    const PLAN_OLD_BRIDGE = 'the bridge is older than the spawn-plan reading, so this is not reported. '
      + 'Update the bridge.';
    const PLAN_PART_UNREAD = 'part of this plan could not be read, so what it spawns is unknown.';
    const PLAN_NO_ASSET = 'the game has not got this kind of place loaded, so what it spawns is unknown. '
      + 'Nothing is broken.';

    /**
     * What the encounters behind a plan add to the base amount, reduced to what a screen can SAY.
     *
     * ⚠ **THE ENCOUNTER CLASS NAMES DELIBERATELY DO NOT TRAVEL.** `Enc_Puppets_Village` is a raw
     * game identifier, this product has one resolver for those and it has never heard of an
     * encounter class, so publishing them would put a class name in front of an owner or leave a
     * field nothing reads — and a reader for something no screen can fill is its own finding here.
     * Two numbers are all the page needs, and both are about what a roll MAKES rather than what it
     * is called.
     */
    function planExtras(rows) {
      let extra = null;
      let curve = false;
      for (const r of rows) {
        if (!r || typeof r !== 'object') continue;
        if (r.amountCurve === true) curve = true;
        const n = Number(r.extraPerPlayer);
        if (Number.isFinite(n) && (extra == null || n > extra)) extra = n;
      }
      return { extraPerPlayer: extra, amountCurve: curve };
    }

    /**
     * The one reader of a kind of place's `plan`. Every caller goes through it, so the three states
     * are decided once.
     */
    function planVerdict(a) {
      const p = (a && typeof a.plan === 'object' && a.plan) ? a.plan : null;
      const out = {
        spawns: 'unknown', planWhy: PLAN_OLD_BRIDGE, encounters: null, maxBaseAmount: null,
        extraPerPlayer: null, amountCurve: false,
      };
      // ⚠ A FOURTH SILENCE, AND IT IS NOT THE OLD-BRIDGE ONE. `a` is absent when the game has not
      // got this kind of place loaded at all, and telling that owner to update their bridge sends
      // them to fix something that is not broken. The row is refused further down for a reason of
      // its own; this only has to stop claiming the wrong cause.
      if (!a) { out.planWhy = PLAN_NO_ASSET; return out; }
      if (!p) return out;
      if (typeof p.unreadable === 'string' && p.unreadable) { out.planWhy = p.unreadable; return out; }
      out.encounters = Number.isFinite(Number(p.count)) ? Number(p.count) : null;
      out.maxBaseAmount = Number.isFinite(Number(p.maxBaseAmount)) ? Number(p.maxBaseAmount) : null;
      Object.assign(out, planExtras(Array.isArray(p.encounters) ? p.encounters : []));
      // ⚠ Strict, both ways. `=== true` and `=== false`, and every other shape — absent, null, the
      // string "false", a number — falls to the third state with a reason rather than to a verdict.
      if (p.baseAmountAlwaysZero === true) { out.spawns = 'no'; out.planWhy = null; }
      else if (p.baseAmountAlwaysZero === false) { out.spawns = 'yes'; out.planWhy = null; }
      else out.planWhy = (typeof p.verdictUnreadable === 'string' && p.verdictUnreadable)
        ? p.verdictUnreadable : PLAN_PART_UNREAD;
      return out;
    }

    /**
     * What one zone's rectangle covers, and what changing it would reach.
     *
     * `here` is how many of the island's places the rectangle touches. `kinds` is one row per
     * distinct schedule behind them, each carrying `usedBy` — how many places on the WHOLE island
     * run on that same schedule — and `elsewhere`, which is `usedBy` minus the ones inside. That
     * last number is the sentence the tab prints, and it is the honest cost of the setting.
     */
    function coverageOf(rects, island) {
      if (!island || !Array.isArray(island.places)) return null;
      const assets = new Map((island.assets || []).map((a) => [String(a.asset), a]));
      const kinds = new Map();
      let here = 0;
      let unnamed = 0;
      for (const p of island.places) {
        if (!placeTouches(p, rects)) continue;
        here++;
        const name = p.zone ? String(p.zone) : '';
        // A place whose schedule could not be read is COUNTED and not acted on. Dropping it would
        // make `here` smaller than the world; acting on it is impossible, since there is no name to
        // send. The number is on the screen so the two can be told apart.
        if (!name) { unnamed++; continue; }
        const row = kinds.get(name) || { asset: name, here: 0 };
        row.here++;
        kinds.set(name, row);
      }
      const out = [];
      for (const row of kinds.values()) {
        const a = assets.get(row.asset) || {};
        const usedBy = Number.isFinite(Number(a.usedBy)) ? Number(a.usedBy) : null;
        out.push(Object.assign({
          asset: row.asset,
          here: row.here,
          usedBy,
          elsewhere: usedBy == null ? null : Math.max(0, usedBy - row.here),
          chancePercent: Number.isFinite(Number(a.chancePercent)) ? Number(a.chancePercent) : null,
          checkMinSec: Number.isFinite(Number(a.checkMinSec)) ? Number(a.checkMinSec) : null,
          checkMaxSec: Number.isFinite(Number(a.checkMaxSec)) ? Number(a.checkMaxSec) : null,
          held: a.held === true,
          // ⚠ The LOOKUP, not `a` — `a` has already been defaulted to `{}` for every other field on
          // this row, and an absent asset and one whose plan is missing want different sentences.
        }, planVerdict(assets.get(row.asset))));
      }
      out.sort((x, y) => y.here - x.here || String(x.asset).localeCompare(String(y.asset)));
      // ⚠ **A ROLLUP OF THREE, COUNTED SEPARATELY AND NEVER SUBTRACTED.** A screen asking "can this
      // zone be made busier" has three answers and the tempting one — `kinds.length - canSpawn` —
      // reports every unreadable plan as one that makes nothing, which is the collapse this whole
      // reading exists to prevent. `maxBaseAmount` is the largest base amount any plan that CAN
      // spawn authors, so it is a floor on what one roll makes and is null when nothing said.
      let canSpawn = 0, noSpawn = 0, unknownSpawn = 0, maxBase = null;
      for (const k of out) {
        if (k.spawns === 'yes') {
          canSpawn++;
          if (k.maxBaseAmount != null) maxBase = maxBase == null ? k.maxBaseAmount : Math.max(maxBase, k.maxBaseAmount);
        } else if (k.spawns === 'no') noSpawn++;
        else unknownSpawn++;
      }
      return { here, unnamed, kinds: out, canSpawn, noSpawn, unknownSpawn, maxBaseAmount: maxBase };
    }

    /**
     * The whole plan: every live zone that is asking for something, what it would reach, and what
     * would be refused.
     *
     * ⚠ **THE BASELINE IS THE SCHEDULE'S OWN AUTHORED VALUE, AND THE BRIDGE IS THE ONE THAT KNOWS
     * IT.** A percentage has to be OF something, and reading "what it says right now" would compound
     * — 200% of a value this plugin already doubled is four times the game's, and again on the next
     * tick, for ever. That is the compounding baseline this project has already been bitten by once,
     * in a retired plugin that multiplied three weather fields off a value it had recorded itself.
     * So `wasChancePercent` — which the bridge records on its FIRST write of the session and never
     * overwrites — is the baseline whenever the schedule is held, and `chancePercent` only when it
     * is not.
     */
    function activityPlan(island) {
      const c = cfg();
      const byId = new Map((c.zones || []).map((z) => [String(z.id), z]));
      const assets = new Map((island && island.assets ? island.assets : []).map((a) => [String(a.asset), a]));
      const want = new Map();
      const zones = [];
      const refused = [];

      for (const a of getActive()) {
        const entry = byId.get(String(a.id)) || a;
        const wants = activityWanted(entry);
        const name = entry.name || entry.set || String(a.id);
        if (!wants) continue;
        const r = zoneRects(entry);
        if (!r.ok) { refused.push({ zone: name, why: r.why }); continue; }
        const cov = coverageOf(r.rects, island);
        if (!cov) { refused.push({ zone: name, why: NOT_KNOWN }); continue; }
        zones.push({ zone: name, id: String(a.id), wants, coverage: cov });

        for (const k of cov.kinds) {
          /**
           * ⚠ **A PLAN THAT MAKES NOTHING IS LEFT ALONE, AND THE OWNER IS TOLD WHY.** Turning its
           * chance up asks the server to roll more often for a result that is authored to be no
           * characters at all — measured, about forty successful rolls over five minutes with a
           * player standing there and nothing appearing. The write would succeed, the card would
           * read "busier" and the island would be exactly as quiet, which is the shape of false
           * promise this plugin already had to be fixed for once.
           *
           * ⚠ **AND IT IS A CONFIRMED `'no'` ONLY.** `'unknown'` goes through and is applied, because
           * refusing on a reading that failed would quietly stop a zone that has been working — the
           * same "a value that could not be read must not be remembered as a state" rule, at the one
           * place in this file where getting it wrong costs an owner a feature rather than a note.
           *
           * It is tested BEFORE the owner's own ceiling on purpose: raising that ceiling would still
           * change nothing here, so sending somebody to raise it first is a wasted round.
           */
          if (k.spawns === 'no') {
            refused.push({
              zone: name, asset: k.asset, why: 'nothing',
              here: k.here, usedBy: k.usedBy, encounters: k.encounters,
            });
            continue;
          }
          if (wants.maxPlaces > 0 && k.usedBy != null && k.usedBy > wants.maxPlaces) {
            refused.push({
              zone: name, asset: k.asset, usedBy: k.usedBy, limit: wants.maxPlaces,
              why: 'shared',
            });
            continue;
          }
          const src = assets.get(k.asset) || {};
          const base = Number.isFinite(Number(src.wasChancePercent)) ? Number(src.wasChancePercent)
            : (Number.isFinite(Number(src.chancePercent)) ? Number(src.chancePercent) : null);
          if (base == null) { refused.push({ zone: name, asset: k.asset, why: 'unreadable' }); continue; }
          // Clamped to the game's own scale and ROUNDED to two places, because the bridge compares
          // what it read back against what was asked for exactly: an unrounded product is a value
          // a float cannot hold and the write would report itself as not having taken.
          const chance = Math.round(Math.max(0, Math.min(100, base * wants.percent / 100)) * 100) / 100;
          const prev = want.get(k.asset);
          // Two live zones over one kind of place. The BUSIER wins and the other zone is named, so
          // an owner reading the tab sees why their quiet zone is not quiet rather than finding out
          // in game. Picking one silently is the same defect as not counting the spill.
          if (!prev || chance > prev.chance) {
            want.set(k.asset, {
              asset: k.asset, chance, base,
              checkSeconds: wants.checkSeconds,
              zone: name,
              usedBy: k.usedBy,
              alsoWantedBy: prev ? (prev.alsoWantedBy || []).concat([prev.zone]) : [],
            });
          } else {
            prev.alsoWantedBy = (prev.alsoWantedBy || []).concat([name]);
          }
        }
      }
      return { zones, want: Array.from(want.values()), refused };
    }

    /**
     * Put the schedules this plugin changed back, by name.
     *
     * Never `restoreEncounterZones()` with no argument: that is every schedule the BRIDGE has
     * changed, and the panel or another plugin can have changed one too. The store is what says
     * which are ours, and an entry is dropped only once the bridge has confirmed the schedule is
     * back — a failed restore that forgot the name would leave a village at a hundred percent with
     * nothing anywhere remembering it.
     */
    async function restoreActivity(which) {
      const held = host.store.get(K.activitySet, {}) || {};
      const names = Object.keys(held).filter((n) => !which || which.indexOf(n) >= 0);
      if (!names.length) return { restored: 0, failed: 0 };
      let restored = 0;
      const failed = [];
      for (const asset of names) {
        const r = await bx('restoreEncounterZones', asset);
        // A bridge that has forgotten the change — because it restarted, or because its own hold
        // lapsed — refuses, and that refusal means the schedule is ALREADY back. Treating it as a
        // failure would keep the name in the store for ever and report a problem that is not one.
        const gone = !!(r && r.ok) || !!(r && typeof r.reason === 'string' && /not holding/i.test(r.reason));
        if (gone) restored++; else failed.push(asset);
      }
      // ⚠ EVERY NAME THIS CALL DID NOT ASK ABOUT STAYS. The record started as `{}` plus the failures,
      // which is right only when `which` is null and wrong every other time — and the every-other
      // time is the ordinary one: one zone of several goes off, this is called with that zone's
      // schedules, and the store came back holding nothing about the zones still running. They would
      // then never be put back by name at all, and the only thing left covering them is the bridge's
      // own hold lapsing under a live zone.
      const next = Object.assign({}, held);
      for (const nm of names) delete next[nm];
      for (const nm of failed) next[nm] = held[nm];
      host.store.set(K.activitySet, next);
      dropPlacesCache();
      if (failed.length) {
        // The bridge also puts each back when its hold lapses.
        log.warn(`${failed.length} spawn schedule(s) are still changed (${failed.join(', ')}). `
          + 'A server restart puts them back.');
      }
      return { restored, failed: failed.length };
    }

    /**
     * Ask for everything the live zones want, and put back everything they no longer do.
     *
     * Runs on the SLOW tick, so the bridge's hold is asked for again several times over before it
     * could lapse. That is deliberate: the hold is what puts an owner's island back if this manager
     * crashes, so it is short enough to matter and refreshed often enough not to flicker.
     *
     * Nothing here is sent twice for nothing: a schedule already reading what was asked for is
     * skipped unless its hold is running low, so the ordinary tick costs one read and no writes.
     */
    let activityBusy = false;
    let oldManagerSaid = false;
    async function applyActivity() {
      if (activityBusy) return null;
      activityBusy = true;
      try {
        const c = cfg();
        const held = host.store.get(K.activitySet, {}) || {};

        // Switched off entirely, or nothing live: put back whatever is ours and stop. Asked BEFORE
        // the island is read, because a plugin that has been switched off must not be making bridge
        // calls to find out what it would have done.
        if (!c.enabled) {
          if (Object.keys(held).length) await restoreActivity(null);
          return null;
        }

        // ⚠ ASKED BEFORE THE ISLAND IS READ. A plugin whose every zone is on the shipped 'leave'
        // — which is every zone configured before this existed — must make no bridge call at all on
        // its account, or the cost of a feature nobody turned on is one object-array walk a minute
        // for ever. `held` is the other half: something already changed still has to be looked at,
        // whatever the zones now say.
        if (!Object.keys(held).length && !getActive().some((a) => activityWanted(byIdOf(c, a) || a))) return null;
        // Said ONCE per load, not once per tick. A manager that cannot ask will never be able to
        // ask, so repeating it every minute is the loop-flood shape rather than a warning.
        const blocked = activityBlocker();
        if (blocked === OLD_MANAGER) {
          if (!oldManagerSaid) { oldManagerSaid = true; log.warn(OLD_MANAGER); }
          return { known: false, why: OLD_MANAGER };
        }
        if (blocked) return { known: false, why: blocked };

        const island = await islandPlaces(true);
        if (!island) {
          // ⚠ NOT a restore. "The bridge could not answer" and "no zone wants anything" are opposite
          // facts that both produce an empty plan, and restoring on the first would undo an owner's
          // live zone every time a poll missed. The bridge's own hold is what covers a manager that
          // really has stopped; this path simply waits.
          return { known: false, why: NOT_KNOWN };
        }
        if (island.canChange === false) {
          return { known: true, blocked: 'switch', want: [], held: Object.keys(held) };
        }

        const plan = activityPlan(island);
        const wantByAsset = new Map(plan.want.map((w) => [w.asset, w]));
        const assets = new Map((island.assets || []).map((a) => [String(a.asset), a]));

        // ── put back first, ask second ──────────────────────────────────────────────────────────
        //
        // A zone switched off this tick must be back to normal before another zone's request is
        // applied, or one tick of the island runs both.
        const stale = Object.keys(held).filter((a) => !wantByAsset.has(a));
        if (stale.length) await restoreActivity(stale);

        const maxHold = Math.max(60, Math.min(21600, nz(island.maxHoldSec, 900)));
        // Four slow ticks of margin, inside the bridge's own ceiling. Long enough that an ordinary
        // missed tick changes nothing an owner could see, short enough that a manager that stopped
        // talking gives the island back in minutes rather than hours.
        const hold = Math.max(120, Math.min(maxHold, Math.round(Math.max(15, nz(c.checkEverySeconds, 60)) * 4)));

        const sent = [];
        const failed = [];
        const nowHeld = Object.assign({}, host.store.get(K.activitySet, {}) || {});
        for (const w of plan.want) {
          const live = assets.get(w.asset) || {};
          const already = Number.isFinite(Number(live.chancePercent))
            && Math.abs(Number(live.chancePercent) - w.chance) < 0.005;
          const intervalOk = !w.checkSeconds
            || (Number.isFinite(Number(live.checkMinSec)) && Number(live.checkMinSec) === w.checkSeconds);
          const holdLow = !Number.isFinite(Number(live.holdLeftSec)) || Number(live.holdLeftSec) < hold / 2;
          if (already && intervalOk && !holdLow) continue;

          const r = await bx('setEncounterZone', w.asset,
            w.chance,
            w.checkSeconds ? w.checkSeconds : null,
            w.checkSeconds ? w.checkSeconds * 2 : null,
            hold);
          if (r && r.ok) {
            sent.push({ asset: w.asset, chance: w.chance, base: w.base, zone: w.zone, usedBy: w.usedBy });
            nowHeld[w.asset] = { zone: w.zone, chance: w.chance, at: Date.now() };
          } else {
            failed.push({ asset: w.asset, why: (r && r.reason) || NOT_KNOWN });
          }
        }
        if (sent.length || stale.length) {
          host.store.set(K.activitySet, nowHeld);
          dropPlacesCache();
        }
        if (sent.length) {
          for (const s of sent) {
            log.info(`"${s.zone}" — ${s.asset} now spawns at ${s.chance}% of its ${s.base}% `
              + `(SHARED by ${s.usedBy == null ? 'an unknown number of' : s.usedBy} place(s) on the island). `
              + 'It resets on its own; nothing spawns until a player is near.');
          }
        }
        for (const f of failed) log.warn(`${f.asset} was not changed — ${f.why}`);
        return { known: true, sent, failed, refused: plan.refused, zones: plan.zones, holdSec: hold };
      } finally {
        activityBusy = false;
      }
    }

    /**
     * A switch's own announcement. With the server stopped it is sent without being waited for: the
     * in-game route cannot land anyway, and the seconds a switch has to write the save in are not
     * spent waiting for it to fail. A Discord route on the same message still goes out.
     */
    async function announce(which, tokens) {
      const sent = deliver(which, tokens);
      if (serverDown()) { sent.catch(() => {}); return null; }
      return sent;
    }

    async function deliver(which, tokens, steamId) {
      const c = cfg();
      const m = (c.messages || {})[which];
      if (!m) return { sent: false, why: 'there is no such message', routes: 0, failed: [] };
      if (m.enabled === false) return { sent: false, why: 'this message is switched off', routes: 0, failed: [] };
      let text = String(m.text == null ? '' : m.text).trim();
      if (!text) return { sent: false, why: 'this message has no text, which switches it off', routes: 0, failed: [] };
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
          log.warn('this manager cannot write chat history; the message still reached the game');
        }
      }
      if (m.hud) jobs.push(steamId ? bx('hud', String(steamId), text) : bx('announceAll', text));
      // The game's alert is a BROADCAST call, so it has nothing to offer one player. For one player
      // the sound lives on the kill feed, whose wire carries a trailing `ping` that asks for the
      // notification sound — and that is the only per-player sound the bridge offers.
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
      // `bx()` answers null for a bridge that is not there, which is a route that did not arrive too.
      const bad = res.map((r) => (r === null ? { ok: false, error: NO_BRIDGE_ANSWER } : r)).filter((r) => r && r.ok === false);
      if (bad.length) {
        log.warn(`the "${which}" message did not reach ${bad.length} of its ${jobs.length} route(s): `
          + bad.map((b) => b.reason || b.error || 'refused').join('; '));
      }
      const recorded = !!(m.history && !steamId);
      // ⚠ The group heading is one of this plugin's own translated labels, so it is described
      // rather than quoted — see `NO_PREFIX`.
      if (!jobs.length && !recorded) return { sent: false, why: 'this message has no route ticked, so there is nowhere for it to go', routes: 0, failed: [] };
      // `host.chat.send` REJECTS with a bare `bridge_unavailable` when there is no bridge, and a
      // bare code is exactly what must not reach a screen. The plugin already has the sentence.
      const words = (b) => {
        const s = String((b && (b.reason || b.error)) || 'refused');
        return s === 'bridge_unavailable' ? NO_BRIDGE_ANSWER : s;
      };
      const why = bad.map(words);
      return {
        sent: bad.length < jobs.length || recorded,
        routes: jobs.length,
        failed: why,
        // When NOTHING landed, the tab prints `why` — and its fallback, "no route reached the game",
        // restates the commoner cause to an owner who has just been told the routes. Quote the
        // refusal instead: the reason is in hand and was being thrown away.
        why: (jobs.length && bad.length === jobs.length && !recorded) ? why.join('; ') : undefined,
      };
    }

    /** The live zone names, for `{zones}`. */
    const liveNames = () => getActive().map((a) => a.name || a.set);

    // ── switching ────────────────────────────────────────────────────────────────────────────────
    let busy = false;

    async function deactivate(entry, opts = {}) {
      /**
       * ⚠ **THE GUARDS GO WITH THE ZONE, AND THEY USED TO BE LEFT STANDING.** The posts were
       * forgotten and the loot folder was removed, so everything this plugin could still NAME about
       * a zone's garrison went at the moment it was switched off — while the garrison itself stayed
       * in the world, walking, for the rest of the server's life, with nothing left that could
       * identify it. Switching a zone off and on again then stacked a second garrison on the first.
       *
       * Only the ones this plugin placed and only by the exact id the game gave back, exactly as
       * the sleep sweep does. A guard the game's own spawn command made carries no identifier and
       * is left to the game, which removes it itself once nobody is near.
       */
      const posts = postsOf(entry.id);
      if (posts.length) {
        const s = guardsFor(entry) || {};
        const r = zoneRects(entry);
        if (r.ok) {
          const gone = await takeOwnGuardsAway(entry, s, posts, r.rects, 'the zone was switched off')
            .catch((e) => ({ removed: 0, refusals: [String((e && e.message) || e)] }));
          for (const w of (gone.refusals || [])) {
            // Nothing this plugin places is registered with the game.
            log.warn(`"${entry.name || entry.set}" — a guard stayed as the zone went off: ${w} `
              + 'It goes at the next server restart.');
          }
        }
      }
      // The posts go with the zone. Keeping them would have the patrol guarding a rectangle whose
      // loot is back to normal, which is a place nobody chose to defend.
      setPosts(entry.id, []);
      delete asleepSince[String(entry.id)];
      delete sweptAsleep[String(entry.id)];
      delete sleepReport[String(entry.id)];
      delete strayedSinceWake[String(entry.id)];
      removeOwned(ownedFolder(entry));
      /**
       * ⚠ **THE GAME'S SET IS READ FIRST, AND THAT IS NOT AN OPTIMISATION.**
       *
       * `mod_zones` refuses every edit until it has captured the game's own zone set at least once
       * — *"nothing has been read yet — send 'refresh' first"* — and `zoneSet()` is the only thing
       * in this plugin that asks for that capture. `activate()` has always called it and this had
       * not, so a switch made before anything else had read the set deleted NOTHING, drew the new
       * rectangle a moment later off the refresh `activate()` then sent, and left the old one
       * standing — so a switch left the old rectangle on the map beside the new one.
       *
       * The reading is then used for the other half: only names the game really has are sent, so a
       * name the ledger is stale about cannot take the rest of the batch down with it.
       */
      const live = await setForWrite();
      const targets = uniq(drawnNames(entry).concat(derivedNames(entry)));
      const present = presentNames(live, targets);
      // ⚠ BOTH ROUTES, because which one CREATED a zone does not decide which one can remove it.
      // A zone written into the save is in the game's live set from the moment the server starts, and
      // only the bridge can touch it then; a zone the bridge drew is in the save as soon as the game
      // writes one, and with the server down only the save writer can. Clearing by the creating route
      // alone left a rectangle behind every time that route could not act — measured, two loot zones
      // standing side by side in an owner's save where one should have been.
      let byBridge = false;
      let bySave = false;
      let nothingThere = false;
      // One row per name this really tried, for the caller and for the tab. Empty when there was
      // nothing of ours on the map, which is a different answer from "nothing worked".
      let erased = [];
      if (present && !present.length) {
        // The game HAS its set and none of our names is in it. There is nothing to remove, which is
        // a clean switch rather than a failure — and the ledger is out of date, so it goes too.
        nothingThere = true;
        forgetDrawn(entry, targets);
      } else {
        erased = await eraseZone(present || targets, live);
        byBridge = erased.length > 0 && erased.every((e) => e.ok);
        if (byBridge) forgetDrawn(entry, erased.map((e) => e.name));
        if (!byBridge) {
          const r = await eraseFromSave(present || targets).catch(() => ({ ok: false }));
          bySave = !!(r && r.ok);
          // What it really took out, which with the save's own filter is not always what was asked
          // for: a name it reports as `gone` was not in the save either, and holding on to it in the
          // ledger would have the next sweep chasing something nothing has.
          if (bySave) forgetDrawn(entry, (r.erased || []).concat(r.gone || []));
        }
      }
      if (!byBridge && !bySave && !nothingThere) {
        // Owed, and remembered as owed: the next sweep that can read a list takes it.
        host.store.set(K.sweepDue, true);
        // Neither could. Said out loud, WITH THE REFUSAL'S OWN WORDS: a rectangle nobody removed is
        // one an owner meets tomorrow, and reporting a clean switch over it is how it stays there.
        // The sentence used to name neither the zone's names nor why, so an owner reading the log
        // had the symptom and nothing to act on.
        const said = erased.map((e) => e.why).filter(Boolean)[0];
        log.warn(`"${entry.name || entry.set}" — the LOOT is back to normal, and ${targets.length}`
          + ` rectangle(s) could not be removed by either route${targets.length ? ` (${targets.join(', ')})` : ''}`
          + `${said ? `: ${said}` : '.'} Run "Check `
          + 'against the game" with the server up.');
      }
      if (!opts.quiet) await announce('deactivate', { zone: entry.name || entry.set, set: entry.set });
      // Removing the files is a loot change too, and the game will not see it until it restarts —
      // so what is pending here is the NORMAL loot coming back, which is the opposite sentence.
      host.store.set(K.lootWrittenAt, Date.now());
      host.store.set(K.lootPendingKind, 'off');
      log.info(`"${entry.name || entry.set}" off — loot files removed; normal loot from the next start`);
      return { erased, nothingThere };
    }

    async function activate(entry) {
      const r = zoneRects(entry);
      if (!r.ok) return { ok: false, why: r.why };
      // ⚠ ASKED BEFORE A SINGLE FILE IS COPIED. A zone whose own area is off the map is not a zone
      // that half works — nothing is drawn, nothing can be placed in it, and switching its loot on
      // would leave an owner with a live set and no rectangle and nothing saying which half failed.
      const offMap = await areaRefusal(entry, r);
      if (offMap) return { ok: false, why: offMap };
      if (!overrideDir) return { ok: false, why: 'the server directory is not configured, so there is nowhere to put the loot files' };

      const folder = ownedFolder(entry);
      let copied = 0;
      try {
        copied = copySet(entry.set, path.join(overrideDir, folder));
      } catch (e) {
        // The name fence says its own sentence; every other failure is a filesystem code, and a
        // code is the useful half of those.
        if (e && e.code === 'bad_set_name') return { ok: false, why: `${entry.set}: ${e.message}` };
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

      // Nothing can be posted in a world that is not running; the patrol does it once the server is up.
      const guards = serverDown() ? { removed: 0, spawned: 0, posts: 0, held: 0, refusals: [] }
        : await patrolGuards(entry, r.rects)
          .catch((e) => ({ removed: 0, spawned: 0, posts: 0, held: 0, refusals: [String(e && e.message)] }));
      await announce('activate', { zone: entry.name || entry.set, set: entry.set });
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
            const r = zoneRects(e);
            if (!r.ok) continue;
            const wrong = r.rects.some((rect, i) => {
              const z = byName.get(zoneNameAt(e, i, r.rects.length));
              if (!z) return false;
              // ⚠ THE SHAPE IS PART OF THE SIZE HERE. A zone whose area was switched from the set's
              // rectangle to a circle of its own is on the map as a rectangle until something
              // notices, and a comparison that only ever looks at rectangles never can — the zone
              // then keeps the shape it had for the life of the server with nothing saying so.
              if (String(z.shape || '') !== shapeOf(rect)) return true;
              if (shapeOf(rect) === 'circle') return Math.abs(Number(z.width) - halfOf(rect).w) > 100;
              return Math.abs(Number(z.width) - halfOf(rect).w) > 100
                || Math.abs(Number(z.height) - halfOf(rect).h) > 100;
            });
            if (wrong) {
              a.drawn = false;
              log.info(`"${e.name || e.set}" — the area on the map is not the area this zone asks for; drawing it again`);
            }
          }
          // And once per load, the configuration each live zone points at: an older version put every
          // zone on one configuration whose zombie rule was decided by whichever zone asked for Block.
          await syncOwnConfig().catch(() => {});
        }
      }
      const pending = have.filter((a) => a.drawn !== true);
      if (!pending.length) return;
      if (!live) live = await zoneSet();
      let moved = false;
      for (const a of pending) {
        const e = byId.get(String(a.id)) || a;
        const r = zoneRects(e);
        if (!r.ok) { a.drawnWhy = r.why; continue; }
        // An area edited to somewhere off the map after the zone went live. Cached on the geometry,
        // so a zone nobody has touched costs nothing here however often this runs.
        const offMap = await areaRefusal(e, r);
        if (offMap) { a.drawnWhy = offMap; continue; }
        // THIS pass's bridge refusal, never the stored one: `a.drawnWhy` already holds the last pass's
        // pair of reasons, and pairing that again on every retry grew the sentence by one "The bridge
        // could not draw it:" per minute — measured on the dev server, nine deep in nine minutes.
        let bridgeWhy = null;
        if (live && live.known === true) {
          const rows = await drawZone(e, r.rects, live);
          a.drawn = rows.length > 0 && rows.every((d) => d.ok);
          a.drawnBy = a.drawn ? 'bridge' : null;
          a.drawnWhy = a.drawn ? null : (rows.find((d) => !d.ok) || {}).why || 'the game refused the zone write';
          bridgeWhy = a.drawnWhy;
        }
        if (!a.drawn) {
          // ⚠ THE REASON THIS BRANCH ALREADY HAS, kept before the save can overwrite it. This is
          // reached with the zone list KNOWN — it was read and the WRITE was refused — so
          // `live.why` is empty and printing the generic one told an owner standing in the game
          // that nobody was on the server. `activate()` gets this right by using its own local.
          bridgeWhy = bridgeWhy || (live && live.why) || NOT_KNOWN;
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
          // ⚠ THE COUNT CAN HAVE MOVED — an owner edits `Zones.json` — AND THE NAMES FOLLOW THE
          // COUNT. Three rectangles are "X 1", "X 2", "X 3" and one is "X", so a set that shrinks
          // is redrawn under a name none of the three had and the three stay on the map for ever.
          // The ledger is what makes that visible at all: whatever this zone is no longer drawn
          // under is still out there, so it goes now rather than waiting for the next sweep.
          const now = r.rects.map((_, i) => zoneNameAt(e, i, r.rects.length));
          const dropped = drawnNames(e).filter((n) => !now.includes(n));
          if (dropped.length) {
            const here = presentNames(live, dropped);
            if (here && !here.length) {
              forgetDrawn(e, dropped);
            } else {
              const off = await eraseZone(here || dropped, live);
              const gone = off.filter((o) => o.ok).map((o) => o.name);
              if (gone.length) {
                forgetDrawn(e, gone);
                log.info(`"${e.name || e.set}" — ${gone.length} rectangle(s) it is no longer drawn `
                  + `under were taken off the map: ${gone.join(', ')}`);
              }
            }
          }
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
        return { ok: false, why: `each switch resets containers map-wide, so wait ${leftM} more minute(s) (minimum gap ${c.minMinutesBetweenSwitches} min)` };
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
        /**
         * ⚠ **AND THEN THE GAME IS ASKED WHAT IT REALLY HAS.**
         *
         * Every removal above can fail — the bridge refuses, the save is locked, the manager died
         * between the draw and the store write — and every one of those failures is SILENT on the
         * map: the loot goes back to normal and the rectangle stays. This used to be repaired
         * only at boot, and only on a boot where the
         * bridge already had the game's zone list, which on a server that starts with nobody online
         * it never does. So the sweep runs here as well, on the one occasion we know something
         * moved, and it is the same sweep: nothing of ours that is not wanted stays on the map.
         */
        await sweepZones().catch((e) => log.warn(`${e && e.message}`));
        // Whether SCUM's island-wide respawn delay should be held now follows what is live, and it
        // is put back the moment nothing is.
        await applyGlobalRespawn(nowActive.length > 0).catch(() => {});
        // ⚠ AFTER `setActive`, AND THAT IS THE WHOLE OF IT. `applyActivity` decides what to ask for
        // and what to put back by reading the ACTIVE list, and `deactivate` runs while the zone
        // being switched off is still on it — so this call sitting in `deactivate`, which is where
        // it was first put, read the zone as live and re-applied the very schedule it was meant to
        // hand back. One call, here, once the list says what is really running.
        //
        // The slow tick would have caught it a minute later either way; a minute of an island
        // running a switched-off zone's setting is a minute too many when the answer is one call.
        await applyActivity().catch((e) => log.warn(`${e && e.message}`));
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
     * ── WHICH ZONES ON THE MAP ARE OURS, WHICH IS THE WHOLE OF WHAT MAKES A SWEEP SAFE ───────────
     *
     * Two answers, and they are a UNION because each covers exactly what the other cannot:
     *
     *   · **The LEDGER** — a name this plugin wrote down as it wrote it. Exact, and the only one
     *     that still holds after the owner renames the prefix or the zone: the map keeps the old
     *     name and so does the ledger, so a rename cannot orphan what was drawn before it.
     *   · **The PREFIX** — `name.startsWith(prefix)`, which is what this plugin has always used and
     *     the only thing that can recognise a zone drawn by a version that kept no ledger, or one
     *     left behind by a crash between the draw and the store write.
     *
     * ⚠ **AND NOT THE CONFIGURATION.** Pointing at "Loot Zones" looks like the tidiest mark of
     * ownership there is, and it is the one that would wreck an owner's map: a configuration is a
     * DROPDOWN on the game's own zone screen, so anybody can put their own rectangle on ours in two
     * clicks and a sweep keyed on it would then delete it. Ownership has to be something only this
     * plugin can have caused — a name it either wrote, or wrote down.
     *
     * ⚠ **AN EMPTY PREFIX OWNS EVERY ZONE THERE IS**, `''.startsWith('')` being true of every string
     * — so with the box blank the prefix half is refused and the ledger half runs on its own. That
     * is strictly better than the old refusal of the whole sweep: a name in the ledger is ours by
     * construction whatever is in that box, and leaving our own rectangles standing because the
     * owner cleared a text field helps nobody.
     *
     * The keep list is deliberately WIDER than the ledger: it is the ledger of every live zone plus
     * the names its current configuration would derive. Keeping too much never deletes anything,
     * and this is the side to be generous on.
     */
    async function sweepZones() {
      const live = await zoneSet();
      /**
       * ⚠ **WITH THE SERVER STOPPED THE SAVE IS THE GAME'S ZONE LIST, AND THIS USED TO GIVE UP.**
       * The bridge can only hand over the game's list while the game runs and somebody is on it, so
       * a sweep asked with the server down — which is exactly when a rotation at a server restart
       * happens — skipped, every time, and left the rectangle it existed for in the save. The save
       * writer refuses while this install's server is running, so the two readings never compete:
       * when the bridge cannot answer and the save can be written, the save is the authority.
       */
      let names = null; let via = 'bridge';
      if (live && live.known === true) {
        names = (live.zones || []).map((z) => String(z && z.name)).filter(Boolean);
      } else {
        const m = host.map || {};
        const pre = (typeof m.zonesWritable === 'function' && typeof m.writeZones === 'function')
          ? await m.zonesWritable().catch(() => null) : null;
        if (pre && pre.ok === true) {
          via = 'save';
          const have = saveRegionsOf(pre);
          // An older manager writes the save but does not say what is in it. Then only the names
          // this plugin WROTE DOWN can be chased — never a name guessed from the prefix, because
          // without the list there is nothing to match a prefix against.
          if (!have) return sweepLedgerIntoSave(live);
          names = have.map((z) => z.name);
        } else {
          log.info('the game has not told the bridge its zone list yet, and the save cannot be written '
            + '— leaving everything alone until one of them can answer');
          host.store.set(K.sweepDue, true);
          return { skipped: true, why: (live && live.why) || NOT_KNOWN, strayZones: [] };
        }
      }
      sweptOnce = true;
      const believed = getActive();
      const keep = new Set();
      for (const a of believed) for (const n of drawnNames(a).concat(derivedNames(a))) keep.add(n);

      // The prefix as it is really NAMED, not as it is typed. `zoneNameFor` puts every name through
      // `safeZoneName`, so an owner whose prefix still carries a colon has zones called "Loot- …" on
      // the map — and comparing those against the raw "Loot: " matches nothing, which makes every
      // one of this plugin's own zones invisible to its own clean-up.
      const prefix = safeZoneName(cfg().zone.namePrefix);
      const byPrefix = prefixUsable();
      if (!byPrefix) log.warn(`only the zones this plugin wrote down are being checked: ${NO_PREFIX}`);
      const ledgerNames = new Set(allDrawnNames());
      const strayZones = names.filter((n) => !keep.has(n)
        && (ledgerNames.has(n) || (byPrefix && n.startsWith(prefix))));

      // A name the ledger holds that the game does not have any more is GONE — somebody deleted it
      // on the game's own screen, a restore put the set back, a save was replaced. Kept, it would
      // have every sweep from here to the end of time chasing a rectangle nothing has.
      const have = new Set(names);
      const vanished = Array.from(ledgerNames).filter((n) => !have.has(n));
      if (vanished.length) forgetDrawnAnywhere(vanished);

      const stubborn = [];
      const removed = [];
      let lastWhy = null;
      if (via === 'bridge') {
        for (const n of strayZones) {
          // `{ confirm: true }` because we mean it: the wrapper sends the bridge's CONFIRM token
          // either way and only WARNS without this, and a warning on every leftover is noise that
          // teaches an owner to stop reading the log.
          const gone = await bx('deleteZone', n, { confirm: true });
          if (gone && gone.ok === true) {
            removed.push(n);
            log.warn(`removed "${n}", a zone of ours the game still held that nothing here had switched on`);
          } else {
            stubborn.push(n);
            lastWhy = (gone && (gone.reason || gone.error)) || NO_BRIDGE_ANSWER;
          }
        }
      } else {
        stubborn.push(...strayZones);
      }
      // The bridge could not, so the save is asked — which is the route that works with the server
      // down, and a leftover is most likely to be found by somebody who has just stopped one.
      if (stubborn.length) {
        const r = await eraseFromSave(stubborn).catch(() => ({ ok: false }));
        if (r && r.ok === true) {
          removed.push(...(r.erased || []).concat(r.gone || []));
          stubborn.length = 0;
          if ((r.erased || []).length) log.warn(`removed ${r.erased.length} leftover zone(s) from the save: ${r.erased.join(', ')}`);
        } else {
          lastWhy = (r && r.why) || lastWhy || 'the bridge refused and the save could not be written';
          log.warn(`${stubborn.length} zone(s) of ours are still on the map and neither route `
            + `could remove them (${stubborn.join(', ')}): ${lastWhy}`);
        }
      }
      if (removed.length) forgetDrawnAnywhere(removed);
      // Settled only by a sweep that read a real list and left nothing of ours behind.
      host.store.set(K.sweepDue, stubborn.length > 0);
      return { strayZones, removed, stubborn, why: stubborn.length ? lastWhy : null, via };
    }

    /**
     * The sweep with the server stopped on a manager that does not report the save's zones: the
     * names this plugin wrote down and does not want any more are deleted, and the writer's own
     * refusal says which of them were never there. Nothing is found by prefix, because there is no
     * list to look for one in — that half waits for the server and the bridge, so the debt stays.
     */
    async function sweepLedgerIntoSave(live) {
      const believed = getActive();
      const keep = new Set();
      for (const a of believed) for (const n of drawnNames(a).concat(derivedNames(a))) keep.add(n);
      const owed = allDrawnNames().filter((n) => !keep.has(n));
      host.store.set(K.sweepDue, true);
      if (!owed.length) return { skipped: true, why: (live && live.why) || NOT_KNOWN, strayZones: [] };
      const r = await eraseFromSave(owed).catch(() => ({ ok: false }));
      if (r && r.ok === true) {
        const out = (r.erased || []).concat(r.gone || []);
        forgetDrawnAnywhere(out);
        if ((r.erased || []).length) log.warn(`removed ${r.erased.length} leftover zone(s) from the save: ${r.erased.join(', ')}`);
        return { strayZones: owed, removed: out, stubborn: [], via: 'save' };
      }
      const why = (r && r.why) || 'the save could not be written';
      log.warn(`${owed.length} zone(s) of ours are still in the save and could not be removed (${owed.join(', ')}): ${why}`);
      return { strayZones: owed, removed: [], stubborn: owed, why, via: 'save' };
    }

    /**
     * What this plugin believes and what the game holds are two different things, and the game wins.
     *
     * SCUM SAVES a custom zone the moment it is created, so a manager that stopped between drawing a
     * zone and recording it leaves that zone behind for ever — and the same crash leaves our loot
     * folder in `Override/`. Without this, a few restarts leave a map covered in zones nobody can
     * name and loot from sets nobody switched on.
     *
     * `zones()` answers `known: false` when the bridge has not captured the game's list yet, and
     * that is a real answer rather than an error. On `known: false` the zone half does NOTHING —
     * acting on a list we do not have is how a reconcile deletes an admin's own zones — and the
     * caller is told it was SKIPPED, so the tick can ask again rather than calling it done.
     */
    async function reconcile() {
      const swept = await sweepZones();
      // The loot folders are a separate question and do not need the game at all, so they are swept
      // even when the zone list could not be read — a folder left in `Override/` is loot nobody
      // switched on, and it is readable from here whatever the bridge is doing.
      const believed = getActive();
      const strayFolders = ownedFolders().filter((f) => !believed.some((a) => ownedFolder(a) === f));
      for (const f of strayFolders) {
        removeOwned(f);
        log.warn(`removed the loot folder "${f}", which nothing here had switched on`);
      }
      return Object.assign({}, swept, { strayFolders });
    }

    // ── the loop ─────────────────────────────────────────────────────────────────────────────────
    let timer = null;
    let bootDone = false;

    /**
     * ⚠ **THE WINDOW BETWEEN "THE SERVER IS STOPPING" AND "THE NEXT ONE STARTS" IS THE ONLY TIME THE
     * SAVE CAN BE WRITTEN, AND IT CAN BE SHORTER THAN ONE SLOW TICK.**
     *
     * The rotation runs the moment the game logs that it is going down, which is a few seconds
     * BEFORE its process lets go of the save — so the switch finds the bridge gone and the save
     * still locked, and neither the old rectangle's removal nor the new one's drawing can land. A
     * scheduled restart then starts the next server well inside a minute, and the old rectangle was
     * on the map for that whole session. So what the switch could not do is chased every few
     * seconds until the save opens, the work is done, or the next server comes up — after which
     * the bridge is the route and the slow tick owns it.
     *
     * Held and cleared, like every other timer here: a plugin switched off must not go on writing
     * into a save on its own afterwards.
     */
    const OWED_EVERY_MS = 5000;
    const OWED_TRIES = 24;
    let owedTimer = null;
    let owedTries = 0;
    function owedWork() {
      return host.store.get(K.sweepDue, false) === true || getActive().some((a) => a.drawn !== true);
    }
    // A generation, so a chase stopped while one of its passes is still running does not re-arm
    // itself when that pass finishes.
    let owedGen = 0;
    function stopChasingOwed() {
      owedGen++;
      if (owedTimer) clearTimeout(owedTimer);
      owedTimer = null;
    }
    /**
     * One pass over what the save still owes — the sweep, then any rectangle not drawn — and ONE at
     * a time: the chase below and the manager's before-start call can both reach for it, and two
     * passes side by side send the same delete twice and refuse each other's writes.
     */
    let owedChain = Promise.resolve();
    function settleOwed() {
      owedChain = owedChain.then(async () => {
        if (!cfg().enabled) return;
        await reconcile().catch((e) => log.warn(`reconcile: ${e && e.message}`));
        await retryDraw().catch(() => {});
      });
      return owedChain;
    }
    function chaseOwed() {
      if (owedTimer || !owedWork()) return;
      owedTries = 0;
      const gen = owedGen;
      const step = () => {
        owedTimer = setTimeout(async () => {
          owedTimer = null;
          if (!cfg().enabled || gen !== owedGen) return;
          await settleOwed();
          if (gen === owedGen && owedWork() && ++owedTries < OWED_TRIES && !owedTimer) step();
        }, OWED_EVERY_MS);
      };
      step();
    }

    async function tick() {
      const c = cfg();
      if (!c.enabled) return;
      // Which wire a guard goes out on depends on the bridge's version, and `routeOf` has to answer
      // synchronously — so the reading is taken here, on the slow tick, and is at most one tick old.
      // An owner who updates the bridge under a running manager gets the better route within a
      // minute rather than at the next manager restart.
      await readBridgeVersion().catch(() => {});
      /**
       * ⚠ **THE BOOT SWEEP IS RETRIED UNTIL IT HAS REALLY RUN ONCE, and without this it never did.**
       *
       * It is the only thing that takes a rectangle off the map that nothing here believes in, and
       * it needs the game's zone list — which the bridge gets from a refresh sent through an ONLINE
       * PLAYER. A manager that boots with the server empty, or twenty seconds ahead of the first
       * join, is skipped; and it was a one-shot, so it was skipped for the rest of that run.
       * Measured: three boots, three skips, and a leftover rectangle across all three.
       *
       * After the first real sweep this costs nothing: `sweptOnce` is in memory, so a manager
       * restart asks again, which is right — that is a new process with a store it has not checked.
       */
      //
      // ⚠ AND AGAIN WHENEVER A REMOVAL IS OWED. Once per process was not enough: a switch made as
      // the server went down could reach neither route, and the rectangle it could not remove stayed
      // for the whole next session because the one sweep this process owed had already run.
      if (bootDone && (!sweptOnce || host.store.get(K.sweepDue, false) === true)) {
        await reconcile().catch((e) => log.warn(`reconcile: ${e && e.message}`));
      }
      if (c.rotation === 'time') {
        await applyWanted(wantedByTime(), {}).catch((e) => log.warn(`${e && e.message}`));
      }
      // A rectangle that could not be written when the zone went live, and the guards the game has
      // respawned since. Both only ever touch what is already on.
      await retryDraw().catch(() => {});
      /**
       * The places a DELETED zone had chosen for itself. Everything else about a zone leaves with
       * it; the pool is persisted on purpose — it is static geometry that cost five bridge calls a
       * point — so it is the one thing that would sit in the store for ever with nothing able to
       * reach it. Dropped only for an id the configuration no longer has, never for a zone that is
       * merely switched off: that one is coming back and its ground has not moved.
       */
      {
        const known = new Set((c.zones || []).map((z) => String(z && z.id)));
        for (const id of Object.keys(host.store.get(K.pool, {}) || {})) {
          if (!known.has(String(id))) dropPool(id);
        }
      }
      // Re-applied rather than set once: the game does not save this number, so a restart puts it
      // back and nothing would say so.
      await applyGlobalRespawn(getActive().length > 0).catch(() => {});
      // Asked again on every slow tick rather than set once, which is what keeps the bridge's hold
      // several ticks ahead of lapsing. A manager that stops ticking — because it crashed, because
      // it was stopped — therefore gives the island back by itself within minutes, and that is the
      // only restore in this feature that does not depend on this process still being alive.
      await applyActivity().catch((e) => log.warn(`${e && e.message}`));
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
          const r = zoneRects(e);
          if (!r.ok) {
            // ⚠ **A ZONE THAT CANNOT WORK OUT ITS OWN AREA USED TO SKIP IN SILENCE**, and the card
            // then showed a zone with places, no guards and not one word about why. The refusal is
            // the owner's own area, or the set's own file, and either way it names what to fix.
            rememberPatrol(e.id, {
              reached: 0, inside: 0, removed: 0, stowed: 0, spawned: 0, held: 0,
              posts: postsOf(e.id).length, areaSource: areaOf(e) ? 'custom' : 'file',
              refusals: [r.why],
            });
            markPatrolled(e.id);
            continue;
          }
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
      // ⚠ ASKED HERE AS WELL AS ON THE TICK, and this is the case that needs it: a manager that
      // restarted under a RUNNING server has a store saying which schedules are ours and a bridge
      // that may have let their holds lapse in the meantime. Without this the island sits at the
      // game's own values for up to a whole slow tick while every screen says the zone is live.
      await applyActivity().catch((e) => log.warn(`${e && e.message}`));
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
    // The bridge is not there the instant a plugin registers, so the first pass waits for the
    // server rather than racing it. Failing that, the timer picks it up.
    //
    // ⚠ IT IS HELD AND CLEARED. A raw `setTimeout` is known to nobody but this closure, so a plugin
    // switched off — or reloaded, which is what an update does — inside that twenty seconds still
    // ran `boot()` afterwards: a plugin an owner had just deactivated writing loot customizations
    // into a live server's own folder and drawing its rectangles on the players' map. Nothing
    // throws and nothing is logged, because from `boot()`'s side everything worked.
    const bootTimer = setTimeout(() => { boot().catch(() => {}); }, 20000);
    // Every queued "welcome, the loot is over there" line. See the join handler below: one of these
    // can be five minutes long and nothing could reach it.
    const joinTimers = new Set();
    if (typeof host.onUnload === 'function') {
      host.onUnload(() => {
        clearInterval(timer);
        clearInterval(patrolTimer);
        clearTimeout(bootTimer);
        stopChasingOwed();
        for (const t of joinTimers) clearTimeout(t);
        joinTimers.clear();
        // The island goes back to what the game authored when this plugin is unloaded — switched
        // off, updated, removed. NOT awaited, because an unload handler that returns a promise is
        // not waited for either, and the bridge's own hold is the guarantee behind this one: if the
        // process is gone before these land, the schedules come back on their own anyway.
        restoreActivity(null).catch(() => {});
      });
    }

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
    /**
     * ── ONE ROTATION PER STOP, AND IT FINISHES BEFORE THE NEXT SERVER STARTS ──────────────────────
     *
     * ⚠ **A RESTART LEAVES THE SAVE FREE FOR ABOUT FIVE SECONDS, AND THE ROTATION NEEDS MORE.** The
     * manager stops the server, waits five seconds and starts the next one. Removing the old rectangle
     * from the save and writing the new one is two zone-writer calls, and on the dev server's 99 MB
     * save one call measured a 1.9 s check and a 2.4–4.6 s write with its verified backup. Driven
     * through the manager's own restart, twice, the next server had started before the first write:
     * every write was refused and the old rectangle came back with the server, next to the loot of
     * the new zone.
     *
     * So on a manager that offers it (`host.server.beforeStart`, 5.42), the manager WAITS for this
     * rotation, and for anything the save still owes, before it launches the game. An older manager
     * has no such wait: the rotation still runs, as fast as it can, and whatever misses the window is
     * taken off the map through the bridge once the server is up and the game hands over its zones.
     *
     * One rotation per stop, whichever of the two calls arrives first — the monitoring's
     * `server:offline` or the manager's start. Two calls in one stop would move the turn twice.
     */
    let stopRotation = null;
    // The server has been seen running by this manager process, so a start that follows is the end
    // of a session rather than a manager that booted onto a stopped server.
    let seenUp = false;
    try { if (host.server && typeof host.server.isRunning === 'function' && host.server.isRunning() === true) seenUp = true; } catch { /* unknown */ }
    function markDown() { if (downSince == null) downSince = Date.now(); }
    function markUp() { downSince = null; stopRotation = null; seenUp = true; }
    function rotateForStop() {
      if (stopRotation) return stopRotation;
      const c = cfg();
      if (!c.enabled || c.rotation !== 'restart') return Promise.resolve(null);
      stopRotation = Promise.resolve()
        // NOT forced past the switch floor. The server is down, so no reload runs and no container
        // is reset by this switch. What the floor is still for is a server crash-looping every two
        // minutes walking through every zone an owner has.
        .then(() => applyWanted(wantedByRestart(), {}))
        .then((r) => {
          if (r && r.ok === false) log.info(`the server stopped and the zone stayed as it was: ${r.why}`);
          else log.info('the server stopped — the next session\'s loot zone is in place');
          return r;
        })
        .catch((e) => { log.warn(`${e && e.message}`); return null; });
      return stopRotation;
    }

    if (host.server && typeof host.server.beforeStart === 'function') {
      host.server.beforeStart(async () => {
        // The manager calls this only with the server confirmed stopped, so the save is free.
        markDown();
        if (!cfg().enabled) return;
        if (cfg().rotation === 'restart' && (stopRotation || seenUp)) await rotateForStop();
        stopChasingOwed();
        // Whatever the save still owes — a leftover rectangle, a zone not drawn yet — now, while it
        // can still be written. The game reads the save as it starts.
        if (owedWork()) await settleOwed();
      });
    }

    if (host.events && typeof host.events.on === 'function') {
      /**
       * The server has stopped — which is when the loot for the NEXT session is decided.
       *
       * ⚠ Not when it comes up. SCUM reads its `Loot` folder at STARTUP, so files put there while
       * the game is already running are read at the restart after that one unless the reload command
       * runs: an owner would be told a zone was live a whole session before it was. The reload is
       * dispatched only through bridge 2.22.2 or newer — through an older bridge it crashed the server
       * — so in this mode the moment the files are written is what decides when the loot lands.
       *
       * It is the right moment twice over: the save writer refuses while the server is running, so
       * with the game down the rectangle can be written too. Both halves land together, before the
       * game reads either.
       */
      host.events.on('server:offline', () => {
        markDown();
        const c = cfg();
        if (!c.enabled || c.rotation !== 'restart') return;
        rotateForStop().then(() => chaseOwed()).catch((e) => log.warn(`${e && e.message}`));
      });
      // Still up, and about to go down: the stop that follows is a real end of a session.
      host.events.on('server:stopping', () => { seenUp = true; });
      // The next server has been launched: from here the save is the game's again, so nothing goes
      // on knocking at it every five seconds while the server loads — on the dev server that was a
      // two-minute run of refusals, each one a process scan.
      host.events.on('server:starting', () => { markUp(); stopChasingOwed(); });

      /**
       * The server is up. NOT a rotation — that already happened as it went down.
       *
       * Two things can only be done with a running game: drawing a rectangle the save could not take,
       * and looking at the guards. Both are the ordinary tick's work, so this only brings it forward
       * rather than waiting up to a minute for it.
       */
      host.events.on('server:online', () => {
        // When the game last read its Loot folder at STARTUP. Apart from a reload (`lootReloadedAt`)
        // that is the only time it reads it, so this is what separates "the loot is live" from "the loot is waiting" —
        // and a manager started over an already-running server never sees this event, which is why
        // its absence is reported as not knowing rather than filled in.
        serverUpAt = Date.now();
        markUp();
        // A new server session is a new zone list, loaded out of the save — whatever this plugin could
        // not take out of it while the server was down is on the map again. One sweep, once the
        // bridge can read the list, settles it.
        host.store.set(K.sweepDue, true);
        /**
         * ⚠ **AND THE CLASSES THE ENGINE ROUTE NEEDS ARE GONE, so the once-per-session bootstrap
         * has to be allowed to run again.** A blueprint class is resident because something made
         * one; a restart empties the lot, measured — on a fresh boot with nobody online only
         * `BP_Zombie2_C` read `loaded:true` out of five asked. A memo that survives the server it
         * describes leaves every named point waiting for a class nothing is going to load.
         */
        bootstrapped.clear();
        // The next server is up: the save is the game's again and the bridge is the route.
        stopChasingOwed();
        if (!cfg().enabled) return;
        Promise.resolve()
          .then(() => readBridgeVersion())
          .then(() => retryDraw())
          .then(() => patrolDue())
          .catch((e) => log.warn(`${e && e.message}`));
      });
    }

    if (host.players && typeof host.players.onJoin === 'function') {
      host.players.onJoin((p) => {
        /**
         * ⚠ **THE MASTER SWITCH IS READ HERE, AND IT WAS NOT.** Switching this plugin off makes
         * `tick()` return on its first line and deactivates nothing — so the active list still
         * names every zone, `liveNames()` still reads it, and players who logged in went on being
         * told which zone had the better loot by a plugin the owner had turned off.
         */
        if (!cfg().enabled) return;
        const m = (cfg().messages || {}).join || {};
        if (!m.enabled) return;
        const names = liveNames();
        if (!names.length) return;
        const wait = Math.max(0, Math.min(300, nz(m.delaySeconds, 20))) * 1000;
        /**
         * ⚠ **HELD AND CLEARED, for the same reason `bootTimer` is.** A raw `setTimeout` is known
         * to nobody but this closure, and this one can be five minutes long: a plugin switched off
         * — or reloaded, which is what an update does — still spoke to a player afterwards, on
         * behalf of something that was no longer running. Nothing throws and nothing is logged,
         * because from the timer's side everything worked.
         *
         * And the switch is read AGAIN when it fires: five minutes is long enough for an owner to
         * have turned the plugin off in between, and the line would still have gone out.
         */
        const t = setTimeout(() => {
          joinTimers.delete(t);
          if (!cfg().enabled) return;
          deliver('join', {
            player: (p && p.playerName) || '', zones: names.join(', '), zone: names[0], count: names.length,
          }, p && p.steamId).catch(() => {});
        }, wait);
        joinTimers.add(t);
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
      let live = await readZones();
      if (!live || live.known !== true) return;
      const byId = new Map((cfg().zones || []).map((z) => [String(z.id), z]));
      const edits = [];
      const moves = [];
      for (const a of getActive()) {
        if (a.drawn !== true) continue;
        const e = byId.get(String(a.id)) || a;
        const r = zoneRects(e);
        if (!r.ok) continue;
        const idx = await configIndexFor(live, e);
        if (idx.index == null) continue;
        // A configuration created just now renumbers nothing, but the list the next zone is looked up
        // in has to contain it.
        if (idx.created) live = (await readZones()) || live;
        for (const line of (idx.edits || [])) if (!edits.includes(line)) edits.push(line);
        // A zone whose "Keep zombies out" changed while it was live moves to the other configuration.
        const byName = new Map((live.zones || []).map((z) => [String(z && z.name), z]));
        r.rects.forEach((rect, i) => {
          const name = zoneNameAt(e, i, r.rects.length);
          const z = byName.get(name);
          if (z && Number(z.config) !== idx.index) {
            moves.push(`set:${name}:${shapeOf(rect)}:${Number(rect.x)}:${Number(rect.y)}:${halfOf(rect).w}:${halfOf(rect).h}:${idx.index}`);
          }
        });
      }
      if (edits.length || moves.length) await zoneEdits(edits.concat(moves));
    }

    host.routes.post('/config', (req, res) => {
      /**
       * ⚠ **A SAVE IS NEVER LAID OVER A READ THAT FAILED.** See `sawConfig` above: the stored copy
       * coming back empty after a real one has been read in this process is a file that could not
       * be read, and merging a partial body onto that writes away every zone, every message and
       * every guard the owner has — successfully, silently, with `ok: true` on the screen.
       *
       * Refused rather than repaired, and the sentence says what to do: nothing has been lost, the
       * file on disk is untouched, and pressing save again once the read works costs nothing.
       */
      const stored = host.config.get();
      const empty = !stored || typeof stored !== 'object' || !Object.keys(stored).length;
      if (empty && sawConfig) {
        // Saving over a failed read would erase every zone, message and guard in it.
        return res.json({ ok: false, why: 'nothing was saved: the plugin\'s config.json could not be read. '
          + 'Try again; if it repeats, check nothing holds it open.' });
      }
      const next = overlay(stored || {}, req.body || {});
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
        warn.push(`⚠ ${NO_PREFIX} Until then no zone is drawn or cleaned up.`);
      }
      const colons = [];
      if (String(c.zone.namePrefix || '').includes(':')) colons.push('the name prefix');
      for (const z of (c.zones || [])) if (String(z.name || '').includes(':')) colons.push(`"${z.name}"`);
      if (colons.length) {
        // The bridge's zone commands are colon-separated with the name first.
        warn.push(`a zone name cannot contain a colon; replaced with a dash in ${colons.join(', ')}.`);
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
          return { dead: true, text: 'it is set to clear guards, but no kind of guard is ticked' };
        }
        if (s2.mode === 'replace' && !kinds.length && !own) {
          return { dead: true, text: 'it replaces guards but has nowhere to put them. Tick a kind to clear, '
            + 'or set "places of its own"' };
        }
        if (s2.mode === 'replace' && !chosen.length) {
          return { dead: true, text: 'it is set to replace guards and no guard has been chosen, so its places will stand empty' };
        }
        /**
         * ⚠ **THE THIRD CASE IS NOT DEAD, IT IS NARROW — AND IT WAS NEVER WARNED ABOUT.** The rule
         * above fires only when NOTHING is ticked and there are no places of its own. Tick a kind and
         * the zone passes every test while still having exactly one source of places: wherever the
         * game already put a sentry. That is a handful of military places and nowhere else on the
         * island, so a zone over a town, a field or a road looks perfectly configured and stands
         * empty for ever.
         */
        if (s2.mode === 'replace' && !own) {
          // The game puts sentries only in a few military places, so elsewhere nothing is guarded.
          return { dead: false, text: 'with "places of its own" at 0, guards stand only where the game '
            + 'put a sentry. Raise it' };
        }
        return null;
      };
      const defaultTrouble = guardTrouble(c.sentries || {});
      if (defaultTrouble) {
        warn.push(defaultTrouble.dead
          ? `the guard setting every zone falls back to can do nothing: ${defaultTrouble.text}`
          : `the guard setting every zone falls back to: ${defaultTrouble.text}`);
      }
      for (const z of (c.zones || [])) {
        if (!z || !z.sentries) continue;         // follows the default, already judged above
        // ⚠ THE SAME MERGE THE RUNTIME USES. A shallow one judged a zone naming only
        // `{replace: {count: 3}}` against a `replace` with no class path in it, and warned "no guard
        // has been chosen" at every save about a zone that works perfectly — which is the
        // fires-on-correct-code failure that gets a warning ignored.
        const t = guardTrouble(guardsFor(z));
        if (t) {
          warn.push(t.dead
            ? `"${z.name || z.set}" has its own guard setting and it can do nothing: ${t.text}`
            : `"${z.name || z.set}" has its own guard setting: ${t.text}`);
        }
      }

      for (const k of Object.keys(c.messages || {})) {
        const m = c.messages[k];
        if (m && m.killFeed && String(m.text || '').includes('|')) {
          // The game reads "|" as a field separator on that route.
          warn.push(`the "${k}" message goes to the kill feed, which refuses "|". Remove it from the text.`);
        }
      }
      res.json({ ok: true, config: c, warnings: warn });
    });

    /**
     * ── WHAT THE GAME SAYS ABOUT ONE POINT ───────────────────────────────────────────────────────
     *
     * `POST /check-spot { id, x, y, z }` — the button beside every coordinate an owner types.
     * Nothing is sent to the world, nothing is saved, and the answer is the game's own.
     *
     * ⚠ **THERE ARE THREE ANSWERS AND ONLY ONE OF THEM IS A NO.** *The game will not take this
     * spot*, *the game could not be ASKED about it*, and *it is fine* are three different facts,
     * and the middle one is the ordinary state of most of the island: SCUM builds a place while a
     * player is near it, so a tunnel nobody is standing in and a corner nobody has walked into both
     * answer it. Drawing that as a refusal tells an owner their correct coordinate is wrong and
     * sends them to change the one thing that was right, so it has its own code and the tab draws
     * it in its own colour.
     *
     * ⚠ **IT ANSWERS WITH THE SERVER STOPPED**, like every other read on this tab, and says which
     * of the three "cannot" it is rather than handing back an empty verdict.
     */
    host.routes.post('/check-spot', async (req, res) => {
      const b = req.body || {};
      const x = Number(b.x); const y = Number(b.y); const z = Number(b.z);
      if (![x, y, z].every((n) => Number.isFinite(n))) {
        return res.json({ ok: false, code: 'unknown',
          why: 'all three numbers are needed before the game can be asked about a point.' });
      }
      /**
       * ⚠ **"IS IT IN THE ZONE" NEEDS TO KNOW WHICH ZONE, AND WITHOUT ONE IT IS NOT GUESSED AT.**
       * A point outside the rectangle is a real mistake an owner makes and it must not be silently
       * honoured either — but answering it against whichever zone happened to be first is worse
       * than not answering it. With no id, `inZone` is null and everything else still works.
       */
      const id = String(b.id == null ? '' : b.id);
      const zone = id ? (cfg().zones || []).find((q) => String(q.id) === id) : null;
      let inZone = null;
      if (zone) {
        const r = zoneRects(zone);
        if (r.ok) {
          inZone = r.rects.some((rect) => inRect({ x, y }, rect));
          if (!inZone) {
            return res.json({ ok: false, code: 'outside', inZone: false,
              why: `this point is outside "${zone.name || zone.set}", so it would never be used.` });
          }
        }
      }
      const v = await checkPoint(x, y, z).catch((e) => ({ unknown: true, why: (e && e.message) || '' }));
      if (v.unknown) return res.json({ ok: false, code: 'unknown', inZone, why: v.why || '' });
      if (v.code) return res.json({ ok: false, code: v.code, inZone, why: v.why || '' });
      res.json({
        ok: true,
        z: v.z,
        underground: v.underground === true,
        inWater: false,
        fits: true,
        inZone,
        // A sentence the page prints after its own, only where there is something to add.
        note: v.underground
          ? 'It is underground: guards appear there only while a player is down there too.'
          // A floor and room for a body, which is not proof a guard can walk out of the room.
          : (v.indoor ? 'It is inside a building; a guard may not find its way out.' : ''),
      });
    });

    /**
     * ── WHERE EVERYBODY IS STANDING, WITH THEIR NAMES ────────────────────────────────────────────
     *
     * `GET /positions` — the list behind *"take a player's position"*, which is the only practical
     * way to name a point in a tunnel and therefore the answer to the hardest half of *"it does not
     * work underground"*.
     *
     * ⚠ **THE TWO SOURCES ARE NOT THE SAME THING AND THE PAYLOAD SAYS WHICH ANSWERED.** `live` is
     * where the running game has somebody this instant. `saved` is where the game last WROTE them
     * down, which is minutes old and is not where they are standing — the tab prints a sentence
     * over the list for that reason, and it can only do so because the answer says so.
     *
     * ⚠ **AND AN EMPTY LIST HAS TWO CAUSES.** "Nobody is on the server" is fixed by walking
     * somewhere; "the bridge could not be asked" is fixed by starting a server or switching a
     * module on. One list with one sentence over it sends half of them to do the wrong thing.
     */
    host.routes.get('/positions', async (req, res) => {
      const who = await playersNow().catch(() => ({ known: false, at: [] }));
      if (who.known && who.at.length) {
        return res.json({
          source: 'live',
          players: who.at
            .filter((p) => String(p.name || '').trim() || String(p.steamId || '').trim())
            .map((p) => ({
              name: String(p.name || '').trim() || String(p.steamId || ''),
              steamId: String(p.steamId || ''),
              x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z),
            })),
        });
      }
      if (who.known) {
        return res.json({ source: 'live', players: [],
          why: 'there is nobody on the server to take a position from. Stand where the guard should be.' });
      }
      /**
       * The live reading failed. The SAVE still knows where each prisoner was written down, which
       * is a real answer for somebody laying a zone out with the server stopped — and it is a
       * different answer, so it is labelled as one rather than quietly serving stale numbers under
       * the name of live ones.
       */
      const saved = (host.map && typeof host.map.world === 'function') ? safe(() => host.map.world(), null) : null;
      const rows = (saved && Array.isArray(saved.players)) ? saved.players : null;
      if (rows && rows.length) {
        return res.json({
          source: 'saved',
          players: rows
            .filter((p) => Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
            .slice(0, 60)
            .map((p) => ({
              name: String(p.name || p.steamId || ''),
              steamId: String(p.steamId || ''),
              x: Math.round(Number(p.x)), y: Math.round(Number(p.y)), z: Math.round(Number(p.z) || 0),
              note: p.online === true ? '' : 'they are not on the server now',
            })),
        });
      }
      res.json({
        source: 'saved',
        players: [],
        why: who.why ? String(who.why)
          // The save cannot answer while the server has never been started.
          : (PLAYERS_UNKNOWN + ' The save has no positions either.'),
      });
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
              ? { open: false, errors: ['this manager is too old for schedules, so this zone stays off. '
                + 'Update it, or clear the times'] }
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
      // Read here too, so the ceiling is on the page before a zone has ever been switched on. Cached
      // for thirty seconds, and it answers null rather than a guess when the bridge is not there.
      await despawnKinds();
      /**
       * ⚠ **ONCE, HERE, OR THE CARD IS WRONG FOR THE FIRST MINUTE OF EVERY BOOT.** The version is
       * normally taken on the slow tick, which is a minute apart and does not run at all while the
       * plugin is switched off — so a tab opened straight after a manager start read `null` and
       * drew every guard on the route it is NOT on, then changed its mind a minute later with
       * nothing having happened. Only while nothing is known, and at most every five seconds, so a
       * bridge that is really absent is not asked on every poll.
       */
      if (!bridgeVerSeen.known && Date.now() - bridgeVerSeen.at > 5000) {
        await readBridgeVersion().catch(() => {});
      }
      const despawnLimit = despawnCeiling();
      const sweep = (c.zones || []).map((z) => {
        const r = zoneRects(z);
        // ⚠ THE AREA TRAVELS EVEN WHEN IT IS REFUSED, and `why` with it. A zone whose own area has
        // a box left empty draws nothing and patrols nothing, and a row that says only "no numbers"
        // sends its owner looking at the loot set, which is not where the mistake is.
        const area = {
          source: r.source || 'file',
          why: r.ok ? null : r.why,
          shape: r.ok ? shapeOf(r.rects[0]) : null,
          // The area as the GAME measures it — a centre and a half-span, a circle's being its
          // radius. The same numbers the box on the tab holds, so a screen never converts.
          rects: r.ok ? r.rects.map((rect) => ({
            shape: shapeOf(rect), x: rect.x, y: rect.y,
            sizeX: halfOf(rect).w, sizeY: halfOf(rect).h,
            radius: rect.shape === 'circle' ? Math.abs(nz(rect.radius, 0)) : null,
          })) : [],
          unit: 'cm-half-width',
        };
        if (!r.ok) return { id: String(z.id), need: null, ask: null, overCeiling: false, area };
        const gs = guardsFor(z) || {};
        const need = Math.max(...r.rects.map((rect) => Math.ceil(flatFor(rect))));
        const ask = Math.max(...r.rects.map((rect) => sphereFor(rect, gs, chaseFor(gs))));
        return {
          id: String(z.id), need, ask, area,
          overCeiling: !!(despawnLimit > 0 && need > despawnLimit),
          // What this zone's own guards are set to do with themselves, so the card can say it
          // without re-deriving the merge of a zone's block over the page default.
          ownLife: lifeOf(gs),
        };
      });
      res.json({
        enabled: c.enabled,
        rotation: c.rotation,
        /**
         * Which keys a single guard's row may override, as DATA rather than as a sentence in a
         * README nothing reads. The three here are the ones a post can really be asked about on its
         * own; `maxPosts` is a count of the zone's PLACES, which are laid out before a guard is
         * given one, and `maxGuards` and `cooldownSeconds` are zone-wide brakes. A tab that draws
         * this list draws exactly what the backend honours, and a key that becomes per-guard later
         * appears on the row without anybody editing the tab.
         */
        guardOverridable: GUARD_OVERRIDABLE.slice(),
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
        /**
         * How far the despawn module will let one call reach, and how far each zone needs to reach
         * to cover its own rectangle.
         *
         * ⚠ **THE MODULE REFUSES A RADIUS OVER ITS CEILING RATHER THAN CLAMPING IT**, and that
         * ceiling ships at 5000 cm — fifty metres. So a rectangle wider than a hundred metres across
         * the diagonal cannot be looked at at all until the owner raises the number on that module's
         * own card, and nothing on this page said so. This plugin has no opinion about how far a
         * sweep may reach: it asks for what covers the rectangle and never quietly asks for less.
         */
        despawn: {
          maxRadius: despawnLimit,
          source: despawnLimit ? (ceilingSeen.source || null) : null,
          zones: sweep,
        },
        lootWrittenAt: lootAt || null,
        serverUpAt: upAt || null,
        // The restart the MANAGER has already scheduled, so the screen can say when the loot really
        // lands rather than only that it will.
        nextRestartUnix: info.nextRestartUnix || null,
        /**
         * ⚠ **WHICH WIRE EACH GUARD REALLY GOES OUT ON, DECIDED HERE AND NOWHERE ELSE.**
         *
         * Since bridge 2.27.0 a guard an owner picked from the NPC, Zombie or Animal picker takes
         * the ENGINE route instead of the game's own command, because that is the only way it
         * survives the encounter manager's 175 m cull — which is what the owner asked for. The two
         * routes differ in what the owner gets (an id or none, a facing or none, gone at a restart
         * or not), so a route the plugin chose has to be one they can SEE.
         *
         * The frontend must not re-derive it. It needs the bridge's version, the shipped class
         * catalogue and the `/Script/` rule to answer, and a second copy of a rule spread over
         * three inputs is a copy that disagrees — which this project has already paid for six
         * times over one prefix strip. So the words are the frontend's and the FACT is this list:
         * every guard word in the whole configuration that is on the engine route right now.
         */
        spawnRoute: {
          ready: engineRouteOk(),
          bridge: bridgeVerSeen.known ? bridgeVerSeen.version : null,
          needs: ENGINE_HUMANOID_BRIDGE.join('.'),
          engine: [...new Set([{}].concat(c.zones || [])
            .flatMap((z) => guardTypes(z || {}))
            .filter((t) => routeOf(t) === 'engine')
            .map((t) => typeWord(t))
            .filter(Boolean))],
        },
      });
    });

    host.routes.post('/activate', async (req, res) => {
      const id = String((req.body && req.body.id) || '');
      const force = !!(req.body && req.body.force);
      // ⚠ "SWITCH THIS ONE ON" IS NOT "SWITCH EVERY OTHER ONE OFF". With "Zones at once" above 1 the
      // zones already live stay live as far as the ceiling allows; the new one goes first, so it is
      // never the one the ceiling drops. At the shipped ceiling of 1 this is exactly the old swap.
      // A zone added on the tab and not saved yet has an id the configuration does not know. Asked for
      // it, `applyWanted` used to drop the id and read what was left, nothing, as "switch everything
      // off", which the screen then reported as "Switched on".
      if (!(cfg().zones || []).some((z) => z && String(z.id) === id)) {
        return res.json({ ok: false, why: 'this zone is not saved yet. Save, then switch it on' });
      }
      const others = getActive().map((a) => String(a.id)).filter((x) => x !== id);
      const r = await applyWanted([id].concat(others), { force }).catch((e) => ({ ok: false, why: e && e.message }));
      // A zone that could not be switched on is a REFUSAL, even though the switch as a whole ran:
      // answering `ok: true` over it put "Switched on" on the screen for a zone whose loot set could
      // not be read and whose files never reached the server.
      const mine = (r && r.changed && Array.isArray(r.changed.on)) ? r.changed.on.find((o) => String(o.id) === id) : null;
      if (mine && mine.ok === false) return res.json(Object.assign({}, r, { ok: false, why: mine.why }));
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
    /**
     * What the zones cover, what changing it would reach, and what is changed right now.
     *
     * Everything the tab needs to say the one sentence this feature is about — *your rectangle
     * covers 6 places, of 3 kinds, and those kinds are also used by 112 other places on the island*
     * — plus the plan, so an owner sees what WOULD happen before they turn anything on.
     *
     * ⚠ It answers with the game stopped and with the bridge absent. `known: false` is "the bridge
     * could not be asked", never "nothing is covered": the tab prints the first as a note and the
     * second as a number, and running them together is how a screen tells somebody their zone
     * reaches nothing. Every other control on this page stays editable either way, which is this
     * plugin's rule everywhere — a zone is configured before a server is started, not after.
     */
    host.routes.get('/activity', async (req, res) => {
      const c = cfg();
      const island = await islandPlaces(req && req.query && req.query.fresh === '1');
      const held = host.store.get(K.activitySet, {}) || {};
      if (!island) {
        return res.json({
          known: false,
          why: activityBlocker() || NOT_KNOWN,
          // The names are ours whatever the bridge can answer, so an owner can always see what is
          // outstanding — and the sentence beside them is the one that matters: nothing here is
          // saved, so the worst case is one server restart.
          heldByUs: Object.keys(held),
          zones: [],
        });
      }
      const plan = activityPlan(island);
      const byZone = {};
      for (const z of (c.zones || [])) {
        const r = zoneRects(z);
        byZone[String(z.id)] = r.ok
          ? { coverage: coverageOf(r.rects, island), wants: activityWanted(z) }
          : { why: r.why, wants: activityWanted(z) };
      }
      res.json({
        known: true,
        canChange: island.canChange !== false,
        maxHoldSec: island.maxHoldSec || null,
        // The island's own totals, so the tab can say what a share is a share OF.
        island: { places: island.count || (island.places || []).length, kinds: (island.assets || []).length },
        // `truncated` travels rather than being swallowed: a place list cut short makes every count
        // below it smaller than the world, and a smaller number that looks ordinary is worse than
        // no number at all.
        truncated: island.truncated === true,
        positionsUnavailable: island.positionsUnavailable || null,
        // ⚠ **THE UNIT TRAVELS WITH THE NUMBER.** This tree has been bitten three times in one day
        // by a duration published bare — game minutes read as seconds, two intervals on one card
        // running at different multiples — so the bridge states its own units and they are handed
        // on rather than being assumed here. A chance is a PERCENT and a roll interval is in REAL
        // seconds, which is what the screen says beside every one of them.
        unit: island.unit || null,
        zones: byZone,
        live: plan.zones,
        want: plan.want,
        refused: plan.refused,
        heldByUs: Object.keys(held),
        /**
         * ⚠ **`assets` IS GONE, AND IT WENT FOR BOTH REASONS AT ONCE.** It was the bridge's raw
         * asset rows handed straight through, and **nothing on the page had ever read one** — a
         * reader for something no screen can fill is its own finding here, and every fact in it
         * already reaches the page through `zones[].coverage.kinds`, which is bound to the zone
         * the owner is looking at. Then the spawn plan arrived on those same rows and made it a
         * second thing: `Enc_Puppets_Village` is a raw game identifier, and a payload carrying one
         * is one careless `JSON.stringify` away from a class name on an owner's screen. It was
         * found by the gate rather than by reading, which is the only reason it is not still there.
         */
      });
    });

    /**
     * Put every schedule this plugin has changed back, now, by hand.
     *
     * Here because the other three restores are all automatic and an owner who has just watched
     * their island get busy wants a button, not an explanation of when it would have happened.
     */
    host.routes.post('/activity-restore', async (req, res) => {
      const r = await restoreActivity(null);
      dropPlacesCache();
      res.json(Object.assign({ ok: r.failed === 0 }, r));
    });

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
          // ⚠ BY THE ROUTE EACH ONE IS REALLY ON. A guard the plugin moved onto the engine route
          // never touches the persistent verb, so listing that switch for it sends an owner to a
          // control this guard's spawn does not consult — and, worse, leaves the switch it DOES
          // need off the list, which is the case where nothing appears and the checklist is green.
          if (types.some((t) => routeOf(t) === 'game')) add('Sending guards', ['spawn.persistent']);
          if (types.some((t) => routeOf(t) === 'engine')) add('Sending guards', ['spawn.creatures', 'entities.enabled']);
          // A Brenner, a Razor, a dropship or a sentry needs the bridge's "Bosses" switch, and the
          // bridge decides that from the CLASS NAME rather than from the kind it was asked for —
          // so the test here is the same one it makes, or the two can disagree and an owner is
          // sent to a switch that was never the problem. Without this line the tab listed every
          // switch but the one that refuses, and a Razor added from the picker simply never came.
          // ⚠ `classPathFor`, so a guard that reached the engine route WITHOUT a path of its own —
          // resolved out of the catalogue off its spawn name — is judged by the same class name
          // the bridge will judge it by.
          if (types.some((t) => routeOf(t) === 'engine' && /brenner|razor|dropship|sentry/i.test(classPathFor(t))))
            add('Sending guards', ['spawn.bosses']);
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
      // ⚠ **EVERY ROUTE CAN REACH THE GAME'S OWN COMMAND, so the test is not "is one of them on the
      // game route".** A random row goes out as `SpawnRandomZombie`; a guard on the engine route
      // whose class is not resident yet has its first one placed by `SpawnArmedNPC`. Both are admin
      // commands, both are refused by the same switch, and testing for the persistent route alone
      // hid the row for exactly the configurations that now reach it most often.
      const usesGameSpawn = [{ entry: null }].concat((c.zones || []).map((z) => ({ entry: z })))
        .some(({ entry }) => (guardsFor(entry || {}) || {}).mode === 'replace' && guardTypes(entry || {}).length > 0);
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
      const r = await deliver(which, {
        zone: names2[0], set: names2[0], zones: names2.join(', '), count: names2.length, player: '',
      }, to || undefined).catch((e) => ({ sent: false, why: (e && e.message) || 'it could not be sent', failed: [] }));
      res.json(Object.assign({ ok: !!(r && r.sent), sentTo: to || 'everyone' }, r || {}));
    });

    /**
     * ── IS THIS AREA ONE THE GAME WILL TAKE? Reads only, and changes nothing. ────────────────────
     *
     * Answers for an area that has not been saved yet — the numbers in the boxes — so a mistake is
     * caught where it is typed rather than after a zone has been switched on. The two questions are
     * separate and stay separate on the way out: whether the numbers are an area at all, which
     * needs nothing but arithmetic and is answered with the server down; and whether it is on the
     * map, which only the game can say and which answers `known: false` when it cannot be asked.
     *
     * It compares with the loot set's own corners where a set was named, because *"how much bigger
     * than the loot is this?"* is the question somebody drawing a wider area is really asking.
     */
    host.routes.post('/area-check', async (req, res) => {
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const set = String(b.set == null ? '' : b.set);
      const entry = { name: String(b.name || set || 'this zone'), set, area: b.area };
      const from = set ? readRect(set) : null;
      const c = customRect(entry);
      if (!c) {
        return res.json({
          ok: !!(from && from.ok),
          source: 'file',
          why: from ? (from.ok ? null : from.why) : 'no loot set was named, so there are no corners to read',
          rects: (from && from.ok) ? from.rects.map((r) => ({ shape: 'rectangle', x: r.x, y: r.y, sizeX: r.width / 2, sizeY: r.height / 2 })) : [],
          unit: 'cm-half-width',
          onMap: null,
        });
      }
      if (!c.ok) return res.json({ ok: false, source: 'custom', why: c.why, rects: [], unit: 'cm-half-width', onMap: null });
      const onMap = await areaOnMap([c.rect]).catch(() => null);
      const lootArea = (from && from.ok)
        ? from.rects.reduce((n, r) => n + Math.abs(nz(r.width, 0)) * Math.abs(nz(r.height, 0)), 0) : null;
      const drawnArea = c.rect.shape === 'circle'
        ? Math.PI * c.rect.radius * c.rect.radius
        : Math.abs(nz(c.rect.width, 0)) * Math.abs(nz(c.rect.height, 0));
      res.json({
        // The area is usable unless the GAME said its centre is off the map. "Could not ask" is not
        // a verdict and never refuses anything here, which is the same rule the draw itself follows.
        ok: !(onMap && onMap.known && !onMap.inside),
        source: 'custom',
        why: (onMap && onMap.known) ? onMap.why : null,
        rects: [{
          shape: shapeOf(c.rect), x: c.rect.x, y: c.rect.y,
          sizeX: halfOf(c.rect).w, sizeY: halfOf(c.rect).h,
          radius: c.rect.shape === 'circle' ? c.rect.radius : null,
        }],
        unit: 'cm-half-width',
        // Three states: true, false, and null for a question the game could not be asked.
        onMap: (onMap && onMap.known) ? onMap.inside : null,
        onMapWhy: (onMap && !onMap.known) ? onMap.why : null,
        outsideCorners: (onMap && onMap.known) ? onMap.outside : [],
        // What the LOOT still covers, which a wider area does not change. Square metres, so a
        // screen never has to work out what a square centimetre is.
        lootSquareMetres: lootArea == null ? null : Math.round(lootArea / 10000),
        drawnSquareMetres: Math.round(drawnArea / 10000),
        lootRects: (from && from.ok) ? from.rects.length : null,
        lootWhy: from ? (from.ok ? null : from.why) : null,
      });
    });

    /** What the bridge will remove, and what of it is really inside the rectangle. Removes nothing. */
    host.routes.post('/guard-preview', async (req, res) => {
      const id = String((req.body && req.body.id) || '');
      const z = (cfg().zones || []).find((x) => String(x.id) === id);
      if (!z) return res.json({ error: 'no zone by that id' });
      const r = zoneRects(z);
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
          const q = await bq('despawnPreview', kind, rect.x, rect.y, nz(s.centreZ, 0), radius);
          const pre = q.ok ? q.data : null;
          if (!pre || pre.error) {
            out.push({ kind, ticked: ticked.indexOf(kind) >= 0,
              error: pre ? ((pre.reason || pre.error) || 'no answer')
                : await whyOf(q, 'despawn', 'what is in this zone') });
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
      const stow = await stowInfo();
      return res.json({
        kinds: out,
        // Whether a fixed sentry can be put away here, which is a different switch from removing one.
        stow,
        // How far this survey reached against how far it is allowed to, because a refusal above is
        // almost always this and the number that fixes it is on the despawn module's own card.
        radius: Math.max(...r.rects.map((rect) => sphereFor(rect, s))),
        needRadius: Math.max(...r.rects.map((rect) => Math.ceil(flatFor(rect)))),
        maxRadius: despawnCeiling(),
        playersKnown: who.known,
        playersOnline: who.known ? who.at.length : null,
      });
    });

    log.info('loot zones ready');
  },
};
