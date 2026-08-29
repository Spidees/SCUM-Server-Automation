/**
 * SCUM Server Automation — Plugin SDK typings (apiVersion 1).
 * Public contract for plugins. Backend: `host`. Admin frontend: `window.SSA`. Field Console: `window.FC`.
 * Full guide: https://scumsa.com/docs. This describes the API only — not the manager's internals.
 */

// ── Backend: the `host` facade passed to register(host) ──────────────────────
export interface Host {
  info: { id: string; dir: string; libDir: string; dataDir: string; version: string; apiVersion: number };

  logger: { info(m: string): void; warn(m: string): void; error(m: string): void; debug(m: string): void };

  events: {
    on(evt: PluginEvent | string, fn: (payload: any) => void): () => void;
    once(evt: PluginEvent | string, fn: (payload: any) => void): () => void;
    /** Broadcast your own event. Names without a ':' are auto-namespaced `<yourId>:<evt>`. */
    emit(evt: string, payload?: any): void;
  };

  config: {
    get<T = Record<string, any>>(): T;
    set<T = Record<string, any>>(patch: Partial<T>): T;
    text(): string;
    onChange(fn: (cfg: any) => void): () => void;
  };

  db: {
    /** Read-only SCUM.db (better-sqlite3 semantics). Returns null/[] while the server is stopped. */
    scum: {
      available(): boolean;
      get<T = any>(sql: string, ...params: any[]): T | null;
      all<T = any>(sql: string, ...params: any[]): T[];
      /**
       * Rewrite a query so soft-deleted profiles drop out, the way the manager's own reads do.
       *
       * It rewrites `FROM user_profile` and nothing else. Behind a JOIN it is a SILENT no-op — the
       * SQL comes back untouched and the deleted rows come back with it. Write the query so
       * `user_profile` is the FROM table if you need the filter to apply.
       */
      excludeDeleted(sql: string): string;
    };
    /** Curated read helpers over the manager's own data. */
    manager: { kills(limit?: number): any[]; trades(limit?: number): any[] };
  };

  /** Linked players (Discord ↔ SCUM character) + player data. */
  players: {
    linked(discordUserId: string): any | null;
    bySteamId(steamId: string): any | null;
    stats(steamId: string): any | null;
    statsByName(name: string): any | null;
    /** { cash, bank, gold, accountNumber, cards } — `bank` is the pool the Bridge charges. */
    finances(steamId: string): any | null;
    skills(steamId: string): any | null;
    /**
     * That player's squad, with its members' names and ranks.
     *
     * The member list WITHHOLDS Steam IDs by design, so this is not the call to build a chat
     * `targets` array from. Read `squad_member` out of the game database yourself when you need to
     * address a squad in-game.
     */
    squad(steamId: string): any | null;
    byName(name: string): any | null;
    online(): any[];
    vehicles(steamId: string): any[];
    stuff(steamId: string): any | null;
    weeklyDeltas(steamId: string): any | null;
    /** Player Intelligence (Premium) risk verdict, or null if never assessed. Pair with `player:intel`. */
    intel(steamId: string): any | null;
    /** Live join/leave straight from the SSA Bridge — no log-tail lag. Returns an off() (auto-removed). */
    onJoin(cb: (e: { steamId: string; playerName: string }) => void): () => void;
    onLeave(cb: (e: { steamId: string; playerName: string }) => void): () => void;
    /**
     * A player's state, LIVE first and the database second.
     *
     * Everything else in this namespace reads `SCUM.db`, which is the SAVED state — it lags by the
     * game's save interval. That gap is not academic: a player can send their money to a friend and
     * buy a kit before the save catches up, so a plugin that charges against the database charges
     * against a balance that no longer exists.
     *
     * `source` says which answered. `null` means neither could — refuse rather than guess.
     */
    live(steamId: string): Promise<({ source: 'live' | 'db'; steamId: string } & Record<string, any>) | null>;
    /** Every online player as the running game has them, or null. No database substitution. */
    liveAll(): Promise<Array<Record<string, any>> | null>;
  };

  /** Game-code database — items AND vehicles/animals/zombies/NPCs by class code. Images are Premium. */
  items: {
    resolve(id: string): any | null;
    name(id: string): string | null;
    image(id: string, variant?: 'vicinity' | string): string | null;
    imageUrl(file: string): string | null;
    /**
     * A world ACTOR's name — what to print for `event.killerName` / `event.victimName`.
     *
     * `name()` answers about an ITEM code and is wrong for these: a kill event carries either a
     * PLAYER's name or a spawn class with its runtime instance number
     * (`BP_Guard_Lvl_5_C_2146943462`), and only one rule can tell those apart. This is that rule,
     * and it is the same one the manager's own kill feed uses — so a plugin's feed and the built-in
     * feed name the same kill the same way.
     *
     * A player's name comes back untouched; a class becomes "Guard (Lvl 5)".
     *
     * Added in manager 5.2. Call it defensively (`host.items.actorName ? … : name`) if your
     * `minManagerVersion` is lower — an older host does not have it.
     */
    actorName(name: string): string | null;
  };

  /** Live world data. */
  map: {
    world(): any | null;
    container(entityId: any): any | null;
    vehicleParts(entityId: any): any[];
    bunkers(): any[];
    /**
     * Is this world point inside the flag rectangle of that player's — or their squad's — bases?
     * `margin` widens the rectangle, in centimetres (default 0 = the exact flag).
     *
     * `null` means the question could NOT be answered (the game database is unreadable, or the
     * player is not resolvable in it yet). That is not the same as `false`. It is falsy, so an
     * `if (...)` behaves as it always did, but anything that punishes a player on a `false` has to
     * rule out `null` first.
     */
    isInOwnerArea(steamId: string, x: number, y: number, margin?: number): boolean | null;
    /**
     * World→map calibration from the host, or null when it has none. ASYNC.
     * Never substitute your own bounds — a wrong calibration places things
     * confidently in the wrong spot. Show nothing instead.
     */
    calibration(): Promise<{ world: { minX: number; maxX: number; minY: number; maxY: number }; width?: number; height?: number } | null>;
    /**
     * A world point → its SCUM grid sector ("B3"), or null when uncalibrated. ASYNC.
     * Uses the same grid the live map draws, so a plugin never invents a second
     * coordinate system.
     */
    sector(x: number, y: number): Promise<string | null>;
  };

  leaderboards: { get(cat: string, limit?: number, weeklyOnly?: boolean): any[]; all(limit?: number, weeklyOnly?: boolean): any; categories(): any[] };
  /**
   * Every value the manager knows, addressable as a {token}: server state, a player's gold, a
   * leaderboard, an item image, map counts — and whatever other plugins publish.
   * Declare a token once; the catalog and the resolver are the same list, so a picker always shows
   * the real current value rather than a sample that can drift.
   */
  data: {
    /** All tokens with their CURRENT values. ctx `{ steamId }` / `{ playerName }` scopes player ones. */
    catalog(ctx?: DataCtx): DataToken[];
    /** One token's value, or null if no such token exists. */
    value(key: string, ctx?: DataCtx): string | null;
    /** Replace every {token} in a string. Unknown tokens are left as-is. */
    render(text: string, ctx?: DataCtx): string;
    /** Same, for every string inside an object or array. */
    renderDeep<T>(obj: T, ctx?: DataCtx): T;
    /** Publish your own tokens; keys are namespaced with your plugin id. Returns the final keys. */
    provide(tokens: Array<{ key: string; label?: string; group?: string; get(ctx: DataCtx): unknown }>): string[];
  };
  economy: {
    traderFunds(): any;
    outpost(): any;
    /** @deprecated Always returns []. Special deals belong to individual players
     *  (economy_special_deals is keyed by user_profile_id), so there is no server-wide list. */
    specialDeals(limit?: number): any[];
    goldCapacity(): any;
  };
  stats: { server(): any; counts(): any; onlineCount(): number; gameTime(): any; weather(): any; vehicleCount(): number; baseCount(): number; squadCount(): number };

  /**
   * Persistent key/value store — a JSON file in the plugin's dataDir, written atomically.
   *
   * A file that exists but will not parse is treated as DAMAGED, not empty: a copy is kept beside
   * it and the manager logs loudly, and your plugin is handed an empty store. Don't let it save over
   * that until somebody has looked, or a rentals or economy plugin reports total loss as a fresh
   * start. Debounce your writes — every `set()` rewrites the whole file.
   */
  store: {
    get<T = any>(key: string, dflt?: T): T | null;
    set<T = any>(key: string, value: T): T;
    delete(key: string): void;
    all(): Record<string, any>;
    clear(): void;
  };
  /** Open a real better-sqlite3 database in the plugin's dataDir (closed for you on unload). */
  sqlite(name?: string): any | null;

  server: {
    status(): any | null;
    /** Read-only address/name/port/version/next-restart. */
    info(): { name: string | null; publicIP: string | null; port: number | null; connectPort: number | null; address: string; version: string | null; nextRestartUnix: number | null };
    isRunning(): boolean;
    start(reason?: string): Promise<boolean>;
    stop(reason?: string): Promise<boolean>;
    restart(reason?: string): Promise<boolean>;
    /**
     * Run an in-game admin command through the SSA Bridge (Premium). Fails by RETURNING `{ ok:
     * false, error }` — a try/catch around it catches nothing.
     *
     * `opts.executor` is a SteamID to run the command THROUGH that online player, which is required
     * for commands that have no location argument and land on whoever ran them
     * (`#SpawnInventoryFullOf`). `opts.caller` is the label written into the bridge's activity log
     * so an owner can see who asked (defaults to `plugin:<your-id>`). `opts.hide` (default `true`)
     * keeps the command's own echo out of the executing player's chat.
     *
     * **`ok: true` does not always mean it worked.** On a normal run `output` carries the lines the
     * game printed back. But on an EMPTY server — and only when the owner has switched that on —
     * the bridge dispatches through the game's static entry point, which returns **void**: the
     * result then reads `{ executor: 'none', dispatched: true, confirmed: false, output: null }`,
     * and nothing anywhere can say whether the command was accepted, or even recognised. Anything
     * that CHARGES a player for the outcome has to check `confirmed !== false`, not just `ok`.
     */
    command(cmd: string, opts?: { executor?: string; caller?: string; hide?: boolean }): Promise<
      { ok: true; executor: string; output: string[] | null; dispatched?: boolean; confirmed?: boolean }
      | { ok: false; error: string }>;
    /**
     * SSA Bridge health for a pre-flight check before spawning or charging.
     *
     * `players` is a COUNT, not a list. Never throws — an unreachable bridge answers
     * `{ available: false, licensed: false, players: 0, error }`.
     */
    bridge(): Promise<{ available: boolean; licensed: boolean; players: number; version?: string; error?: string }>;
  };

  /**
   * The SSA Bridge's in-game modules — state that only the RUNNING game knows.
   *
   * Every call is async and answers `null` (or `[]`) on failure rather than throwing. That is a
   * deliberate difference from `host.chat.*`: a bridge that is off is the ordinary state on a server
   * without Premium, not an exceptional one, so `if (!d) …fall back…` is the shape to write. Wrapping
   * the normal case in a try/catch is how the fallback gets forgotten.
   *
   * A key MISSING from a payload means "this build cannot answer it", never zero. An empty fuel tank
   * and an unreadable one need opposite handling.
   */
  bridge: {
    /** Is the bridge up? Cheap pre-check before anything that depends on it. It does NOT ask about
     *  the licence: the bridge runs every call with or without one, and a licence decides only
     *  whether joining players are shown a line naming it. Use `health().licensed` if you want that. */
    available(): Promise<boolean>;
    /** `{ available, licensed, players, version }` — `players` is a COUNT. Never throws. */
    health(): Promise<{ available: boolean; licensed: boolean; players: number; version?: string; error?: string }>;
    /** Every module the running bridge has. `[]` when it cannot be asked. */
    modules(): Promise<Array<{ id: string; name: string; enabled: boolean; config: Record<string, any>; status: Record<string, any> }>>;
    /**
     * Is one module switched on? `null` when the bridge itself could not be reached.
     *
     * If a module your plugin needs is off, say so BY NAME in your own UI. A feature that silently
     * does nothing is indistinguishable from a broken one.
     */
    moduleEnabled(moduleId: string): Promise<boolean | null>;
    /**
     * The general form. `null` when the bridge is off, the module is off, or it refused that key.
     * Keep writing `if (!d) …fall back…`; use `query()` when you need to know which of those it was.
     */
    data(moduleId: string, what: string): Promise<any | null>;
    /**
     * `data()` with the reason attached instead of only `null` — for showing an admin why, or for
     * telling "the module is off" apart from "the module said no".
     *
     * On a refusal `reason` is the module's OWN sentence, written for a human and safe to print
     * ("someone is driving it", "nothing within 800 cm of that point"), or `null` when it refused
     * without saying. Logs nothing, unlike `data()`.
     */
    query(moduleId: string, what: string): Promise<BridgeResult>;
    /**
     * A one-shot instruction to a module. Failure by return, not by throw.
     *
     * `code` says which of the four things went wrong and `reason` carries the module's own words on
     * a refusal. `error` is the raw wire string and is unchanged from earlier manager versions.
     */
    command(moduleId: string, what: string): Promise<BridgeCommandResult>;
    /**
     * What THIS plugin declared it needs switched on (`bridge` in plugin.json), resolved against the
     * bridge that is actually there.
     *
     * READ-ONLY, and that is the design rather than an omission. Everything in the bridge ships off
     * deliberately, so a plugin declares and the OWNER approves in one click on the plugin's card;
     * nothing a plugin can call turns anything on. Use it to say, in the owner's own words, which
     * switch is missing — `switches[].label` is the module's own label for it.
     *
     * `{ declared: false }` when the manifest has no `bridge` block.
     */
    needs(): Promise<BridgeNeeds>;

    /** Money, gold, fame, vitals and body state per online player — whichever groups the owner enabled. */
    livePlayers(): Promise<Array<Record<string, any>> | null>;
    /** Time of day, sun, rain/snow/fog/wind/lightning, cloud decks, temperatures, humidity. */
    world(): Promise<Record<string, number> | null>;
    /**
     * What the GAME thinks about the session: player/spectator/bot counts, squads, bunkers, and
     * `uptimeSeconds` from the match clock.
     *
     * The manager counts players by tailing the log and measures uptime from when it started the
     * service — both are inferences and both drift. `uptimeSeconds` here survives a manager restart
     * because it is the game's own match clock, not ours.
     */
    serverState(): Promise<Record<string, any> | null>;
    /** Fuel, battery, engine state, RPM, condition, mileage, driver — per loaded vehicle. */
    vehicles(): Promise<Array<Record<string, any>> | null>;
    /**
     * The vehicle manager's own settings — the numbers behind "where did all the cars go": the four
     * autosave intervals, how long a spawner remembers a vehicle before the map may put a fresh one
     * there, and the forbidden-zone pair. One lookup rather than a sweep, so it is cheap on a timer.
     */
    vehicleManager(): Promise<any>;
    /**
     * Squads: roster, ranks, and who is online, alive and IN DANGER.
     *
     * `inDanger` has no database equivalent at all — it is the flag the game's own squad UI uses to
     * redden a member's name, i.e. the nearest thing to "a squadmate is being shot at right now"
     * that exists outside the game process.
     */
    squads(): Promise<Array<Record<string, any>> | null>;
    /**
     * Chests and lockers: owner, access level, locks, protecting flag, buried and by whom, and
     * whether it holds anything.
     *
     * NOT what it holds. The game reflects a `hasItems` bool and no item list anywhere on the
     * inventory component; `host.map.container(entityId)` answers the contents from `SCUM.db`.
     */
    storage(): Promise<Array<Record<string, any>> | null>;
    /**
     * Bases taking fire right now: hits, structures destroyed, damage, where, how long.
     *
     * Pass `true` to include raids that have gone quiet — "was this base raided recently" is asked
     * AFTER the shooting stops, which is exactly when an offline-protection rule needs it.
     */
    raids(includeFinished?: boolean): Promise<Array<Record<string, any>> | null>;

    /**
     * Game events since the LAST call: kills, trades, squad joins and leaves, flag takeovers,
     * vehicles destroyed, item pickups and drops.
     *
     * This DRAINS — each event is handed out exactly once, so two plugins polling it will each see
     * half. If more than one thing needs these, read them once and fan them out yourself.
     *
     * Several have no log line at all: trades, squad changes, and a flag changing hands are
     * invisible to `SCUM.log`.
     */
    events(): Promise<Array<{ kind: string; agoMs: number; a: number; b: number; c: number; s1?: string; s2?: string }> | null>;
    /** The same list WITHOUT draining it — for a diagnostic screen, never for a consumer. */
    peekEvents(): Promise<Array<Record<string, any>> | null>;
    /**
     * What each event kind actually puts in `a`, `b`, `c`, `d`, `s1`, `s2`, `s3`.
     *
     * **Read this before reading an event.** Every kind travels on the same seven slots and **what
     * each one holds changes with the kind**: a flag changing hands arrives as `{a: 60, b: 997}`, and
     * nothing in that payload says those are the old and the new owner. The map used to live only in
     * the module's C++ comments.
     *
     * Validated against `SCUM.db` rather than against those comments — on a player event `a` is
     * `user_profile.id`, on a squad event `b` is `squad.id`, `s3` is the inventory's owning actor.
     * Static text, all fifteen kinds, so read it once at start-up.
     *
     * **A key a kind does not carry is ABSENT, not zero.** `0` is a real-looking profile id.
     */
    eventKinds(): Promise<Record<string, any> | null>;
    /**
     * Whether each watch is actually wired to the game, and what it has seen.
     *
     * **This module's only failure mode is silence.** A watch resolves the game's parameters by name;
     * a name the build has renamed resolves to nothing, and the watch then fires and records nothing —
     * one line in the bridge log and no other symptom. From outside that is indistinguishable from
     * "nobody has done that thing yet" and from "the group is switched off", and those three want
     * completely different actions.
     *
     * Per watch: `fired` (counted **before** the group switch, so it is a fact about the build rather
     * than about the owner's settings), `recorded`, `resolved`, `attempts`, and one sentence naming
     * which of the three states it is in.
     */
    eventWatches(): Promise<Record<string, any> | null>;

    /** Bases, the server-wide flag rules, and which flags are protected. */
    bases(): Promise<Record<string, any> | null>;
    /**
     * The flag ids with raid protection ACTIVE right now — no other source has this.
     *
     * `[]` genuinely means nothing is protected; `null` means the question could not be answered.
     * A rule that reads the second as the first will let somebody raid a protected base.
     */
    protectedFlags(): Promise<number[] | null>;

    /**
     * What state a player is in: spawned, god mode, and the body effects they carry by class name.
     *
     * Death and knockout are separate states with separate exits, and the effect classes are how
     * the game tells them apart — read this BEFORE `act(id, 'revive')` rather than guessing which
     * one you are undoing.
     */
    playerState(steamId: string): Promise<Record<string, any> | null>;

    /**
     * Do something to an online player: `act(id, 'revive')`, `act(id, 'godmode', 'off')`,
     * `act(id, 'money', '1000')`.
     *
     * WRITES to live player state, which the game then saves. The verbs are grouped into families
     * (revive, currency, fame, flags, messages, kick, gear, squads, effects, …), each its own owner
     * switch in the panel, and **all of them are off by default** — so a fresh install answers
     * `{ ok: false, code: 'refused' }` to every one of these until an owner turns the family on.
     *
     * `{ ok: false }` whenever it did not happen — the family switched off, the player offline, the
     * field absent from this build. It never reports success for something it could not do.
     *
     * Pass the literal `'all'` instead of a SteamID to reach everyone at once. Only `hud`, `warn`,
     * `killfeed`, `fade`, `dbmoney`, `dbgold` and `dbfame` accept it; every other verb needs one
     * player and refuses `'all'` by name. A broadcast reports success if it reached ANYBODY.
     *
     * `hud`, `warn`, `kick` and the squad verbs have dedicated wrappers below — prefer those.
     */
    act(steamId: string | 'all', verb: BridgeActVerb, value?: string | number): Promise<BridgeCommandResult>;

    /**
     * An on-screen HUD message to one player, or to everyone with `'all'`.
     *
     * Chat cannot do this: a HUD message is unmissable, does not scroll away, and reaches somebody
     * who has chat closed or filtered.
     */
    hud(steamId: string | 'all', text: string): Promise<BridgeCommandResult>;
    /**
     * The coloured warning banner. **THIS ALWAYS REFUSES, on every build, at every setting.**
     *
     * It is kept, and kept documented, because it is the obvious thing to reach for and because a
     * call that vanishes is worse than one that says no. The reason is not a bug and not a missing
     * feature: the game's warning banner is drawn by each player's own copy of the game, and the
     * call that draws it is not one a server can send. A server can ask for it, the call succeeds,
     * and it builds a banner for nobody — which is exactly why this refuses instead of reporting
     * the success it would otherwise get. The refusal `reason` says all of this.
     *
     * There is no colour anywhere on this route either. What DOES reach a player:
     *   - `hud()` — a line in the message feed at the left. Plain white, and it scrolls away.
     *   - `killFeedTo()` / `killFeed()` — an entry that STAYS on screen instead of fading.
     *
     * `seconds` and any `#rrggbb:` prefix in `text` are accepted and ignored; earlier versions of
     * this file described the colour prefix as working, and it never did.
     */
    warn(steamId: string | 'all', seconds: number, text: string): Promise<BridgeCommandResult>;
    /** Kick through the game's own `KickPlayer`, so the REASON reaches the player. */
    kick(steamId: string, reason?: string): Promise<BridgeCommandResult>;
    /**
     * Squad membership, server-side — it takes effect without the player doing anything.
     *
     * **`join` takes a SQUAD id; `leave`, `promote` and `demote` take a PROFILE id.** That is the
     * game's own split, and it is worth stating loudly because the two are the same type and the
     * same order of magnitude — so passing the wrong one is not a type error and used not to be an
     * error at all: `join` leaves the player's current squad *before* it joins them to the named
     * one, so a squad id nobody has left them in no squad and still answered `ok`. The first bridge
     * release after 2.6.0 refuses an unknown squad id and confirms the join off the roster.
     *
     * A profile id is the SCUM **user profile id**, never a Steam ID — `host.players.bySteamId()`
     * resolves one. A squad id is what `host.bridge.squads()` reports.
     */
    squad(steamId: string, verb: 'join' | 'leave' | 'promote' | 'demote' | 'create',
          squadOrProfileId?: number | string): Promise<BridgeCommandResult>;

    /**
     * What is happening in the world: `{ cargo, events }`.
     *
     * Cargo drops as they STAND — where the crate will land (known while it is still falling, which
     * is when an announcement is worth anything), whether it has landed, seconds until it detonates,
     * how many lockers. The log line says a drop happened and nothing after.
     *
     * `events` is the competitive side — deathmatch, team deathmatch, CTF, drop zone — with state,
     * round, time left, participants and team scores. There is no other route to any of it.
     *
     * That is the SHARED scoreboard, and it is a TOTAL. What decides the match lives one class
     * further down and differs per mode, so the module's **`modes`** switch adds that half **inside
     * this same payload — there is no second call**: a drop zone's phase, phase clock, capture
     * progress, capturing team and key carrier; capture the flag's two flags, who holds each, the
     * return timers and the winning score; both deathmatches' round score limit. A mode your map does
     * not run produces no block at all, and an unreadable value is omitted rather than sent as a zero.
     */
    worldEvents(): Promise<{ cargo?: Array<Record<string, any>>; events?: Array<Record<string, any>> } | null>;

    /**
     * What an ONLINE player is carrying, right now.
     *
     * `items` is `null` — never `[]` — when the player is not in the world: "offline" and "carrying
     * nothing" are different answers.
     *
     * **The most expensive call in the bridge.** It walks every item actor on the server to answer
     * one question, so it is off by default and has no polling form. Ask it when something happens,
     * never on a timer — `host.map.container(entityId)` reads container contents from the database
     * for a fraction of the cost.
     *
     * Resolve each item's `class` to a name and icon with `host.items.resolve()`.
     */
    inventory(steamId: string): Promise<{ found: boolean; items: Array<Record<string, any>> | null; count?: number; truncated?: boolean } | null>;
    /** Loose items on the ground within `radius` centimetres — what a raid left behind, a dropped bag. */
    itemsNear(x: number, y: number, radius: number): Promise<Record<string, any> | null>;
    /** How many item actors exist, by where they are — the cheap diagnostic before enabling a sweep. */
    itemCounts(): Promise<Record<string, number> | null>;

    /**
     * Every creature currently alerted or in combat, and what it is on.
     *
     * Nothing outside the game process can know this: the stance and the target are replicated
     * per-creature state. The log says a player died; it never says a horde is closing on them.
     *
     * Animals and sharks carry a stance but NO target — the game does not record one — so an entry
     * with no `target` key means exactly that, not "target unknown".
     */
    threats(): Promise<Array<Record<string, any>> | null>;
    /**
     * Every creature within N **metres** of a player, **calm ones included**, each with the id the
     * writing verbs take.
     *
     * **This is the only listing that names a creature which is not already hostile.** `threats()`
     * and `hunting()` both filter to things already fighting or already on somebody, so on a quiet
     * server they are empty and nothing that acts on a creature can be aimed at anything.
     *
     * `near` is `null`, never `[]`, when the player is not in the world. Carries `omitted` and
     * `truncated`: a radius matching more rows than the cap is reported as cut short, never
     * silently shortened. Ids are runtime object slots and do NOT survive the creature or a
     * restart, so read one and use it promptly.
     *
     * The walk is the expensive part - ask it when something happens, never on a timer.
     */
    creaturesNear(steamId: string, radiusM: number): Promise<{ found: boolean; near: Array<Record<string, any>> | null; count?: number; omitted?: number; truncated?: boolean } | null>;
    /**
     * Which teleports are still in flight, and which landed.
     *
     * **The only call that separates `dispatched` from `arrived`.** A player teleport is a client
     * handshake and lands two to five seconds after the game accepts it, so a position read taken
     * when `teleportPlayer()` returns shows the OLD position every time. A plugin that skipped this
     * counted an unconfirmed teleport as a rescue and told a player they were off the mine they were
     * still standing on.
     *
     * Read `movedCm` and `alreadyThere` before believing `arrived: true` on a short hop — arrival is
     * a tolerance around the destination, so a teleport to where somebody already stood reports
     * success without anything having happened, and says so with `provesNothing`.
     */
    teleportInflight(): Promise<Record<string, any> | null>;
    /**
     * Every padlock SCUM has SAVED, read out of the game's own door records.
     *
     * The locks a door carries are not actors -- they are inline save data -- so this is the only
     * way to see one that nobody is standing next to. Measured on a full world: 435 padlocks across
     * 208 doors, with 92 of 300 door records carrying none.
     *
     * A record with no `baseElementDoorId` is a world door somebody locked or claimed: the key is
     * ABSENT, never zero. And do not match a lock to a door by position -- thirty pairs of doors on
     * this map share an identical x/y and differ only in height, and one of each pair has a lock.
     */
    savedLocks(): Promise<Record<string, any> | null>;
    /**
     * What is targeting ONE player right now.
     *
     * `hunting` is `null`, never `[]`, when the player is not in the world. A rule built on "nothing
     * is hunting them" must not fire because they logged out.
     */
    hunting(steamId: string): Promise<{ found: boolean; hunting: Array<Record<string, any>> | null; count?: number } | null>;
    /**
     * Every garden and what is growing in each slot.
     *
     * **`growthPercent` is a real reading, but it is NOT a percentage** — it is a `uint8` on a scale
     * the game does not publish. Measured on a live world: **16 distinct values across 103 planted
     * cells, 96 of them above 100**, tracking `stage` (every `Ripening` cell exactly 255), and a
     * re-read twenty minutes later gave a different sixteen because the crops were growing while it
     * was watched. An earlier note claimed it read 255 everywhere and measured nothing — that was an
     * **empty world**, not the field. Read **`growthRaw`** (the same number under an honest name)
     * with `stage`, and never render it as a percentage. `healthRaw` moves too (0 on a dead cell,
     * 243–255 on a living one); `nextHarvestTimeRaw` was 63488 across 306 cells and measures nothing.
     * Water, plant health and the harvest countdown
     * end in **`Raw`** because the game sends them quantised and does not publish the scale —
     * `nextHarvestTimeRaw` is NOT a timestamp and must never be rendered as a clock time.
     *
     * A garden has no owner the game will admit to; `gardenId` is for a `SCUM.db` join.
     */
    gardens(): Promise<Record<string, any> | null>;

    /**
     * Is a world position sane to put something into?
     *
     * A check that could not be RUN is **absent**, never `false`, and `safe` is absent unless every
     * check it depends on actually ran. **`levelLoaded` is the one that matters**: spawning into a
     * level that has not streamed in produces nothing at all — no object, no error, no log line.
     *
     * Advisory. It blocks nothing.
     */
    checkPlace(x: number, y: number, z: number): Promise<Record<string, any> | null>;

    /**
     * Change a flag's raid protection at runtime.
     *
     * **The units of `delay` and `duration` are undocumented and untested.** Nothing in the game's
     * own headers says whether they are seconds or minutes, whether `delay` is a countdown before
     * protection starts or a cooldown before it may start again, or what zero means in either. The
     * bridge passes both through unchanged and interprets nothing.
     *
     * The failure mode is not a wrong reading: it is a base losing its protection permanently,
     * because the value is written into the save. There is no read-back beyond `protectedFlags()`.
     *
     * These are per-player channel calls, so an offline-protection rule firing as the LAST player
     * disconnects will find no channel. That is the game's API shape, not a bridge limitation.
     */
    setProtection(flagId: number, delay: number, duration: number): Promise<BridgeCommandResult>;
    /**
     * Teleport a player to exact coordinates WITH a facing.
     *
     * `#Teleport` takes three numbers and no rotation, so this exists for the rotation — a request
     * without a yaw is refused rather than becoming a second path to the admin command. Also refused
     * while a teleport is in progress, and when that guard cannot be read.
     *
     * `dropCm` (1..10000) is optional and raises ONLY the arrival Z, so the player falls onto the
     * spot instead of being placed inside whatever is standing on it. Nothing searches for a nearby
     * place that fits: a caller who asked for a place and silently got a different one has been lied
     * to. For a PLAYER it is a precaution rather than a retry — the game's player teleport returns
     * nothing, so a collision refusal can never be reported here at all, and for the same reason
     * there is no `force` on this one at any setting.
     */
    teleportPlayer(steamId: string, x: number, y: number, z: number, yaw: number,
                   dropCm?: number): Promise<BridgeCommandResult>;
    /**
     * Move a VEHICLE. Nothing in the command set does this — every `#Teleport*` takes a player.
     * Addressed by the packed entity id the map publishes as `elo`/`ehi`. Refused while driven.
     *
     * Unlike a player move this one CAN report the engine's collision refusal, so `dropCm` is a
     * genuine retry for a vehicle that would not fit. `force` skips the fit test entirely and puts
     * the vehicle exactly where asked — the last resort for one sunk in terrain, and just as capable
     * of burying it. It needs the module's own `force` switch, which is off by default.
     */
    moveVehicle(idLo: number, idHi: number, x: number, y: number, z: number, yaw: number,
                dropCm?: number, force?: boolean): Promise<BridgeCommandResult>;
    /** Move a dropped item. Refused unless the game says it is actually lying on the ground — one
     *  inside an inventory, attached to something or on a corpse is not moved. `dropCm` and `force`
     *  behave exactly as they do for `moveVehicle()`. */
    moveItem(idLo: number, idHi: number, x: number, y: number, z: number, yaw: number,
             dropCm?: number, force?: boolean): Promise<BridgeCommandResult>;
    /**
     * Make a base structure appear, remove one, or move ownership.
     *
     * **Nothing here is confirmed to persist.** These are multicasts and the database row is almost
     * certainly written by the server path that runs BEFORE them — so a structure spawned this way
     * may last only until the next restart. The bridge refuses to spawn until it has WATCHED the game
     * send a `dataVersion` of its own, and can only replay a base and class it has already observed.
     */
    buildAction(verb: 'spawn' | 'destroy' | 'damage' | 'overtake' | 'setowner' | 'clearowner'
                    | 'chown' | 'transfer' | 'demolish',
                args: string): Promise<BridgeCommandResult>;
    /**
     * Act on a vehicle: repair or damage a part, set fuel or battery, write the mileage, destroy it,
     * change its owner or access level, recolour it.
     *
     * Values are clamped to the part's own maximum — putting 999 into a fuel tank is not a favour.
     */
    repairAction(verb: 'repair' | 'damage' | 'destroy' | 'fuel' | 'battery' | 'mileage'
                     | 'owner' | 'access' | 'colors' | 'pattern',
                 args: string): Promise<BridgeCommandResult>;

    /** Reset a flag's protection cooldown. What it resets TO is unverified. */
    resetProtection(flagId: number): Promise<BridgeCommandResult>;

    /** Killbox rooms: armed or not, seconds left, and how far the run has got. */
    killboxes(): Promise<Record<string, any> | null>;

    /**
     * The three Apex research facilities and whether a purge is running.
     *
     * State (locked, unlocked, counting down, ending, clearing up), both raw clock values, the span
     * between them, the designed durations, and where each facility is — addressed by LEVEL, the way
     * a killbox is.
     *
     * **The clocks have no established origin.** Nothing in this build says what they count from, so
     * the raw pair is useful only for comparing one reading against the next, and the number worth
     * announcing is their DIFFERENCE (`purgeSpan`), which means the same thing whatever the origin.
     * **"Seconds until the purge" is not offered rather than guessed**: it needs that clock's current
     * value and there is no way to read it.
     *
     * Nothing here can be written either — there is no server-side call to start a purge, so writing
     * the state would run the handler on every CLIENT and start nothing.
     *
     * Read-only, needs the `killbox` module and its own `apex` switch.
     */
    apexFacilities(): Promise<{ facilities: Array<Record<string, any>>; truncated?: boolean } | null>;

    /** How many creatures of each kind exist, and how many are hostile. The cheap summary. */
    creatureCounts(): Promise<Record<string, { total: number; hostile: number; truncated?: boolean }> | null>;
    /**
     * Traps and mines. **`armed`** is the field with no other source: a mine-protection rule
     * otherwise infers it from a log line and a timer.
     *
     * An ABSENT key means the game could not answer — never `false`.
     */
    traps(): Promise<Array<Record<string, any>> | null>;

    /**
     * A server setting as the RUNNING game holds it — not always what `ServerSettings.ini` says.
     *
     * `type` must be stated: the game cannot be asked what type a setting is, and guessing would
     * report a float as a rounded integer.
     *
     * `{ name, exists: false }` is a REAL answer, not an error. The game's own getters take a
     * fallback and hand it back for a missing setting, so the bridge reads each one twice with
     * different fallbacks — agreement means the value is real. Without that, a returned `0` could be
     * the value or the fallback.
     */
    setting(name: string, type?: 'int' | 'bool' | 'float' | 'string'):
        Promise<{ name: string; type?: string; value?: any; exists?: false } | null>;

    /**
     * Change a server setting at runtime, with no restart.
     *
     * Behind its own switch and off by default. A name that cannot be read back first is refused, so
     * a typo cannot create a phantom setting — but nothing can check a RANGE, and whether a change
     * survives a restart is the game's own per-setting business.
     */
    setSetting(name: string, type: 'int' | 'bool' | 'float' | 'string',
               value: string | number | boolean): Promise<BridgeCommandResult>;

    /**
     * The custom zones an admin drew in-game.
     *
     * `known: false` is a REAL answer: the live set exists only as the parameters of the game's own
     * reply, so call `refreshZones()` and read a moment later. `ageMs` says how stale it is.
     */
    zones(): Promise<{ known: boolean; ageMs?: number; zones: Array<Record<string, any>> | null; configs?: Array<Record<string, any>> } | null>;
    /** Ask the server to send its current zone set; the reply lands a frame or two later. */
    refreshZones(): Promise<BridgeCommandResult>;
    /**
     * Add or replace one zone by name.
     *
     * **The game only accepts the COMPLETE set**, so this rewrites all of them — and is refused
     * until the current set has been read back at least once, or a write would delete every zone it
     * had not seen. Call `refreshZones()` first on a cold start.
     */
    setZone(name: string, shape: 'circle' | 'rectangle', x: number, y: number,
            width: number, height: number, config?: number): Promise<BridgeCommandResult>;
    /** Remove one zone by name. Refused when no zone by that name is known — a typo is not a no-op. */
    deleteZone(name: string): Promise<BridgeCommandResult>;

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // Named wrappers for the rest of the in-game modules
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    //
    // Everything below is a thin wrapper over `data()` / `command()`, so the four refusal codes and
    // the once-per-reason logging behave exactly as they do for a raw call. `data()` and `command()`
    // stay public: a verb with no wrapper here is not out of reach, and a bridge newer than your
    // manager will always have some.
    //
    // Two contracts hold throughout:
    //   · a READ answers the module's payload, or plain `null` when it could not answer. `null` never
    //     means "empty" — an empty list comes back as an empty list.
    //   · a WRITE answers `BridgeCommandResult`. `ok: false` with `reason` set is the module's own
    //     sentence, written for a human and safe to show an admin.

    // ── one player, one verb (all of these are `act()` under a name) ─────────────────────────────
    // Every one is behind an owner switch and every switch is OFF by default, so `module_off` is the
    // ordinary answer on a fresh server. All need the player online.

    /**
     * Bring a player back.
     *
     * **Semantics unverified** — very likely the KNOCKOUT exit rather than a resurrection, and never
     * watched on a live server. Read `playerState()` first to see which of the two you are undoing.
     */
    revive(steamId: string): Promise<BridgeCommandResult>;
    /** Kill a player through the game's own path. No undo. */
    suicide(steamId: string): Promise<BridgeCommandResult>;
    godMode(steamId: string, on: boolean): Promise<BridgeCommandResult>;
    /** Immortality — a separate flag from god mode, with its own meaning in the game. */
    immortal(steamId: string, on: boolean): Promise<BridgeCommandResult>;
    infiniteAmmo(steamId: string, on: boolean): Promise<BridgeCommandResult>;
    superJump(steamId: string, on: boolean): Promise<BridgeCommandResult>;
    nightVision(steamId: string, on: boolean): Promise<BridgeCommandResult>;
    /** Force a limp on or off. `clearLimp()` drops the override entirely, which is a third state. */
    limp(steamId: string, on: boolean): Promise<BridgeCommandResult>;
    /** Clear the limp OVERRIDE — the game goes back to deciding for itself. */
    clearLimp(steamId: string): Promise<BridgeCommandResult>;
    /** Set fame points. ABSOLUTE, not a delta. */
    setFame(steamId: string, fame: number): Promise<BridgeCommandResult>;
    /**
     * Set a player's CASH balance — absolute, and the wrapper picks the right currency enum, which
     * is the point of it: the obvious zero-based table is off by one and writing "0" for cash sets a
     * balance nobody has.
     *
     * **Persistence unconfirmed.** This writes the replicated mirror, and whether that is the
     * authoritative figure has not been observed on a running server. For anything that must survive
     * a restart use the `#SetCurrencyBalance` admin command through `host.server.command()`.
     */
    setMoney(steamId: string, amount: number): Promise<BridgeCommandResult>;
    /** Set a player's GOLD balance. Same persistence caveat as `setMoney()`. */
    setGold(steamId: string, amount: number): Promise<BridgeCommandResult>;
    /**
     * Set how wet a player is, as a ratio 0..1. Omit `part` to set all four.
     *
     * A write is REFUSED rather than made in the wrong unit when the game's own maximum for that
     * part cannot be read.
     */
    setWetness(steamId: string, ratio: number,
               part?: 'head' | 'upperbody' | 'torso' | 'chest' | 'lowerbody' | 'legs' | 'feet'): Promise<BridgeCommandResult>;
    /**
     * Ask the game to save this player now.
     *
     * **Whether it flushes the balance and fame written above has not been observed on a running
     * server.** Treat it as a request, not a guarantee.
     */
    savePlayer(steamId: string): Promise<BridgeCommandResult>;
    /**
     * Clear everything a player is wearing and carrying.
     *
     * **Irreversible — the items are GONE, not dropped.** Nothing lands on the floor to pick back up.
     */
    stripPlayer(steamId: string): Promise<BridgeCommandResult>;
    /**
     * Remove handcuffs.
     *
     * **Cuffs are one-way through the bridge**: they can be removed and cannot be applied, because
     * the game's own call needs a real item actor that nothing here can produce.
     */
    uncuff(steamId: string): Promise<BridgeCommandResult>;

    // ── creatures ────────────────────────────────────────────────────────────────────────────────
    // ⚠ A creature id is `"<index>-<serial>"` — a HYPHEN, where `despawn` uses a DOT for the same
    // shape of id. Pass it through exactly as `threats()`, `hunting()` or `creature()` reported it:
    // ids are object-array slots and do not survive the creature, so a stale one resolves to nothing.

    /**
     * One creature in full, including `healthMax` — reported **only** here, because it is class
     * tuning and reads the same off every creature of a kind.
     *
     * `{ found: false }` when the id no longer resolves. Animals and sharks additionally need the
     * module's `animals` switch: with it off they are not in the walk at all.
     */
    creature(id: string): Promise<Record<string, any> | null>;
    /**
     * Set a creature's health in absolute POINTS, not a ratio.
     *
     * **Zero is NOT a kill.** The death path runs off damage, not off the field, so a creature at
     * zero health stands there until something hits it — and killing through the damage system is
     * unreachable from here. Use `removeCreature()` to make one go away.
     */
    setCreatureHealth(id: string, hp: number): Promise<BridgeCommandResult>;
    /**
     * Point a creature at a player, or pass `null` to let go.
     *
     * **Impossible for animals and sharks** — the game records a stance for them and no target at
     * all, so this is refused rather than silently doing nothing.
     */
    setCreatureTarget(id: string, steamId: string | null): Promise<BridgeCommandResult>;
    /** Make a creature fight, or calm it. Works on puppets and NPCs only. */
    setCreatureHostile(id: string, on: boolean): Promise<BridgeCommandResult>;
    /** Set a creature's stance by the name its own kind uses; `creature()` reports the current one. */
    setCreatureStance(id: string, stance: string): Promise<BridgeCommandResult>;
    /** Set one named replicated flag. Powerful, and nothing proves the name exists until you call it. */
    setCreatureField(id: string, field: string, value: string | number | boolean): Promise<BridgeCommandResult>;
    /**
     * Destroy a creature outright.
     *
     * **It leaves no corpse and no loot and counts as nobody's kill.** Killing through the damage
     * system is unreachable, so this is a removal rather than a death — by construction, not by
     * oversight.
     */
    removeCreature(id: string): Promise<BridgeCommandResult>;

    // ── base structures ──────────────────────────────────────────────────────────────────────────
    // **A `dataVersion` must have been OBSERVED before ANY of these work.** It cannot be read or
    // derived — live logging watched it climb 111 → 175 within seconds — so check
    // `baseBuilding().dataVersionKnown` before offering the feature at all. Persistence is unknown in
    // both directions: these are multicasts and the database row is almost certainly written by the
    // server path that runs before them.

    /** Bases, the element classes the bridge has watched being spawned, and `dataVersionKnown`. */
    baseBuilding(): Promise<Record<string, any> | null>;
    /**
     * The base elements the bridge has SEEN since it started, optionally one base's worth.
     *
     * The payload says `observedOnly: true` and means it — this is not the game's element table,
     * which is native and outside reflection. Capped at 4096.
     */
    buildElements(baseId?: number): Promise<Record<string, any> | null>;
    /**
     * Make a base element appear. **This can only REPLAY** a class the bridge has watched being
     * spawned, into a base it has a captured record for; neither can be constructed by name.
     *
     * **`elementId` is your problem.** Nothing inside the game process can allocate an id the
     * database has not used, and inventing one that collides means two elements the game believes
     * are the same. `yaw` is DEGREES about Z; an owner of 0 is what makes an element not
     * player-owned.
     */
    spawnElement(baseId: number, cls: string, x: number, y: number, z: number, yaw: number,
                 elementId: number, ownerProfileId?: number, creatorPrisonerId?: number): Promise<BridgeCommandResult>;
    /**
     * Destroy a base element.
     *
     * `reason` is **not cosmetic**: only `damage` counts as a raid to the raid module, so destroying
     * something as `admincommand` (the default) deliberately does not register as one.
     */
    destroyElement(baseId: number, elementId: number, x: number, y: number, z: number,
                   reason?: 'none' | 'user' | 'upgrade' | 'internal' | 'damage' | 'decay'
                         | 'movedoutofflagarea' | 'admincommand',
                   cascade?: boolean): Promise<BridgeCommandResult>;
    /**
     * Damage a base element by an amount in HEALTH POINTS — not a percentage.
     *
     * The units are not comparable between element types and the module cannot report the resulting
     * health, so this is no way to set a structure to half. Zero is refused and the amount is capped
     * at 10000 — **refused, never clamped**. `repair: true` sends a negative amount, and **whether
     * the game treats that as a repair is unconfirmed**.
     */
    damageElement(baseId: number, elementId: number, x: number, y: number, z: number,
                  amount: number, repair?: boolean): Promise<BridgeCommandResult>;
    /** Hand one element to a new owner. Nothing checks that it is a flag — the game does not say. */
    overtakeElement(elementId: number, x: number, y: number, z: number, newOwnerProfileId: number): Promise<BridgeCommandResult>;
    /** Give a whole base a new owner profile. */
    setBaseOwner(baseId: number, x: number, y: number, z: number, newOwnerProfileId: number): Promise<BridgeCommandResult>;
    /** Leave a base with NO owner — after which anyone can take it. */
    clearBaseOwner(baseId: number, x: number, y: number, z: number): Promise<BridgeCommandResult>;
    /** Move EVERY flag from one profile to another. **Bulk and unscoped** — it names no flag. */
    chownFlags(oldProfileId: number, newProfileId: number): Promise<BridgeCommandResult>;
    /** The game's own bulk transfer. **The KIND of id it takes is undocumented** — the game's shape. */
    transferOwnership(oldId: number, newId: number): Promise<BridgeCommandResult>;
    /**
     * Demolish everything of one element type within `radius` centimetres. Radius is capped at 2000
     * and is **refused, never clamped**. The game reports no count of what it removed.
     */
    demolishArea(x: number, y: number, z: number, radius: number,
                 elementType: 'none' | 'default' | 'woodenpalisade' | 'sandbox' | 'door' | 'well'
                            | 'platform' | 'watchtower' | 'gunrack' | 'foundation' | 'flag'
                            | 'wallornament' | 'ceilingornament' | 'cabin' | 'stairs' | 'newwalls'
                            | 'wallgunrack' | 'modular' | 'modularfoundation' | 'all'): Promise<BridgeCommandResult>;

    // ── weather and time ─────────────────────────────────────────────────────────────────────────

    /**
     * Every weather and time knob with its value, range, group and — the useful part —
     * `basis: 'measured' | 'declared'`, which says whether that knob was actually tested.
     */
    climate(): Promise<Record<string, any> | null>;
    /** One knob on its own. */
    climateKnob(key: string): Promise<Record<string, any> | null>;
    /** The twelve boolean switches, each with its group and what it needs first. */
    climateSwitches(): Promise<Record<string, any> | null>;
    /** The group names a knob can belong to — `time`, `precipitation`, `fog`, `wind`, … */
    climateGroups(): Promise<Record<string, any> | null>;
    /**
     * Write one knob, in the channel's own unit.
     *
     * **A `resimulated` knob is undone within a second.** Measured, not feared: fog set to 0.95
     * landed (read back at 204 ms) and the game's own controller had put it back to 0.38 inside one
     * second. Use `pinClimate()` for those, or set the matching interpolation speed to 0.
     * `timeSpeed` HOLDS — also measured. `climate()` says which is which.
     *
     * A value outside the knob's range is REFUSED, never clamped. Clock values are given as hours
     * 0..24. **Writes can survive a restart** — the game serialises its climate state on its own
     * timer — so turn persistence off before experimenting.
     */
    setClimate(key: string, value: number): Promise<BridgeCommandResult>;
    /** The same write with the simulation held first, so a `resimulated` knob stays where it was put. */
    pinClimate(key: string, value: number): Promise<BridgeCommandResult>;
    /** One of the twelve boolean switches. */
    setClimateSwitch(key: string, on: boolean): Promise<BridgeCommandResult>;
    /**
     * Hold the weather simulation (`true`) or release it (`false`). Holding leaves the clock
     * advancing and remembers the prior values, so releasing restores them.
     */
    holdClimate(on: boolean): Promise<BridgeCommandResult>;

    // ── crafting and fishing ─────────────────────────────────────────────────────────────────────

    /**
     * What is being crafted right now. **Ingredient NAMES cannot be resolved** — slots come out as an
     * ordered list matching recipe order, and `recipeId` maps to no reflected table.
     */
    crafting(): Promise<Record<string, any> | null>;
    /** Base-building placements staked out but not yet paid for, with the per-slot tally. */
    placements(): Promise<Record<string, any> | null>;
    /** Fishing state. Mass and size carry a `Raw` suffix because the units are genuinely unknown. */
    fishing(): Promise<Record<string, any> | null>;
    /**
     * Crafting and fishing events since the last call — `fish.caught`, `craft.start`, `cook.collect`
     * and the rest.
     *
     * **This DRAINS**, like `events()`: two consumers polling it each see half. `slotId: -1` is never
     * emitted, so an absent key means the event has no slot — a different thing from slot 0.
     */
    craftEvents(): Promise<Record<string, any> | null>;

    // ── removing things from the world ───────────────────────────────────────────────────────────
    // ⚠ An object id here uses a DOT (`<index>.<serial>`), where `ai` uses a hyphen. Everything is
    // IRREVERSIBLE and the sweep is a SPHERE, not a circle: a wrong Z removes nothing, which is the
    // direction a mistake in an irreversible call should fail in.

    /** Every kind this bridge will despawn, with its switch and its `maxPerCall` / `maxRadius` —
     *  which are REFUSED, never clamped. */
    despawnKinds(): Promise<Record<string, any> | null>;
    /**
     * What a despawn WOULD remove, without removing it.
     *
     * Deliberately does not require the kind's own switch — it reports `allowed: false` instead, so
     * a preview screen works before an owner has turned anything on.
     */
    despawnPreview(kind: string, x: number, y: number, z: number, radius: number,
                   objectId?: string): Promise<Record<string, any> | null>;
    /** Every kind at one point in a single walk — a survey, cheaper than asking per kind. */
    despawnSurvey(x: number, y: number, z: number, radius: number): Promise<Record<string, any> | null>;
    /**
     * Remove things. **Irreversible, and the cleanliness is UNVERIFIED** — whether destroying the
     * actor triggers the game's own de-registration is not established, and for vehicles there is a
     * registration this module can neither see nor clear.
     *
     * `kind` takes its id, its plural config key, or a synonym: `animal`, `shark`, `drone`, `sentry`,
     * `puppet`, `npc`, `brenner`, `razor`, `dropship`, `mapsentry`, `vehicle`, plus `actor=<Class>`
     * behind a deny list. The whole call is ABANDONED, not merely skipped, if any candidate has a
     * player attached. Never available at any setting: base elements, items and floor loot, corpses,
     * and anything a player is inside.
     */
    despawnAt(kind: string, x: number, y: number, z: number, radius: number,
              objectId?: string): Promise<BridgeCommandResult>;

    // ── doors (the Door Shuffle module) ──────────────────────────────────────────────────────────
    // A door key is `<Level>:<Actor>` and CONTAINS a colon, which is why these take the two halves
    // separately. This is not the `locks` module below, which addresses a door a different way again.

    /** Every level holding a door the module has recorded, with counts. */
    doorLevels(): Promise<Record<string, any> | null>;
    /** The door CLASSES seen. The rows spell the key `level` although the value is a class name. */
    doorClasses(): Promise<Record<string, any> | null>;
    /**
     * One door's state. The registry is not always populated: in `random` mode with "close doors
     * players left open" off, only already-open doors are recorded.
     */
    doorState(level: string, actor: string): Promise<Record<string, any> | null>;
    /**
     * Ask the module to persist its door state.
     *
     * **It returns success even when it was ignored** — outside persist mode it logs and returns
     * true, and inside it only sets a flag, because the doors may not be loaded yet. Do not read
     * success here as "it is saved".
     */
    saveDoors(): Promise<BridgeCommandResult>;
    /**
     * One door, by verb. **The whole vocabulary this module acts on is `open`, `close`, `seal` and
     * `unseal`** — four verbs, and there is no fifth.
     *
     * `lock` and `unlock` are still in the type because they are answered rather than ignored: the
     * module **refuses them by name**, because somebody typing them has the right idea and the wrong
     * module. Use `lockDoor()` / `unlockDoor()`, where the target is shaped differently again.
     *
     * **`seal` is NOT the game's lock.** It writes the door's own "can open" flag false, which also
     * blocks the module itself, and NOTHING PERSISTS IT — a restart releases every sealed door.
     */
    doorAction(verb: 'open' | 'close' | 'seal' | 'unseal' | 'lock' | 'unlock',
               level: string, actor: string): Promise<BridgeCommandResult>;

    // ── the live world index ─────────────────────────────────────────────────────────────────────
    // ⚠ Ids here are runtime object-array slots and **change on a restart**.

    /** Which entity kinds this module indexes — the only read here that says whether it is on. */
    entityKinds(): Promise<Record<string, any> | null>;
    /**
     * The live world index.
     *
     * **Complete only if the module was on before the world was built** — status says `partial` vs
     * `ready`, and anything constructed before that moment is never constructed again until a
     * restart. Twenty-five thousand entities is the better part of a megabyte of string building on
     * the game thread, so this is emphatically not a polling call.
     */
    entities(): Promise<Record<string, any> | null>;
    /** The bases the entity index holds. Same cost and the same partial/ready caveat. */
    entityBases(): Promise<Record<string, any> | null>;
    /** One entity by runtime id. The id is paired with a pinned serial, so a recycled slot fails to
     *  resolve rather than being written. */
    entity(id: string): Promise<Record<string, any> | null>;
    /**
     * Write one named property on one entity.
     *
     * **Unchecked**: a property named on the wire has no literal for the manager's build-time name
     * checker to verify, so nothing proves it exists until the call is made. Mitigated by a read-back
     * at the declared width and by nothing else. Powerful, and not undoable.
     */
    setEntityProperty(id: string, property: string, type: 'bool' | 'int' | 'int64' | 'float',
                      value: string | number | boolean): Promise<BridgeCommandResult>;
    /** Heal an entity to a fraction of its full health, 0..1. */
    healEntity(id: string, ratio: number): Promise<BridgeCommandResult>;

    // ── gardens ──────────────────────────────────────────────────────────────────────────────────

    /** One garden by id. Both farming reads walk every garden actor, so this is not cheaper than
     *  `gardens()` — only narrower. */
    garden(gardenId: number): Promise<Record<string, any> | null>;
    /**
     * Change one slot of one garden, or the whole bed with `slot: '*'`.
     *
     * **There is no server-side HARVEST**, and asking for one is refused by name rather than quietly
     * mapped onto `clear`: taking the crop is something a player does at the bed, and `clear`
     * destroys the plant and yields nothing.
     *
     * **These writes have never run on a live server.** The only garden write path in the build is a
     * debug channel of which no live instance exists, so the call target is a class default object.
     * Treat the first use as a test, on a server you can restart. A partial `*` is reported as a
     * REFUSAL even though the world changed, naming how many slots took it.
     *
     * `value` is what the verb takes: litres for `water` (0 < v ≤ 1000), a stage for `grow`
     * (`none|seeding|vegetating|flowering|ripening`, or 0–4, matched against the running build's own
     * enum), `organic|industrial` for `fertilize`, an intensity for `weeds`, a crop for `plant` —
     * which alone also takes `steamId`, because planting is attributed to a player and therefore
     * needs one spawned in. `clear`, `kill`, `pesticide` and `fungicide` take none.
     *
     * **`clear` and `kill` over the WHOLE bed need the literal `'CONFIRM'` as `value`**:
     * `gardenAction('clear', 7, '*', 'CONFIRM')`. That is the one shape here with no way back. A
     * single slot does not — a ceremony demanded for every ordinary call is how a ceremony stops
     * being read.
     */
    gardenAction(verb: 'water' | 'grow' | 'clear' | 'kill' | 'fertilize' | 'pesticide' | 'fungicide'
                     | 'weeds' | 'plant',
                 gardenId: number, slot: number | '*',
                 value?: string | number, steamId?: string): Promise<BridgeCommandResult>;

    // ── moving items between players, inventories and the ground ─────────────────────────────────
    //
    // A `selector` is one of:
    //   `'<ItemClass>'`                 what the acting player is carrying
    //   `'held:<steamid>:<ItemClass>'`  what THAT player is carrying
    //   `'floor:<x>,<y>,<r>:<Class>'`   the nearest one lying loose within r centimetres  ⚠ COMMAS
    //   `'near:<x>,<y>,<r>:<Class>'`    the nearest one within r cm wherever it is
    // Class matching strips one trailing `_C` from both sides, case-insensitive, EXACT never substring.
    //
    // **This module never CREATES items** — every verb moves one that already exists, so the shape an
    // owner usually wants (spawn on an admin, hand it to the player who paid) takes two steps and only
    // the second is here. Every call is a full sweep of tens of thousands of objects, so there is no
    // polling shape and it is off by default. Success means CONFIRMED by read-back, all-or-nothing;
    // these are MOVES, so retrying an unconfirmed one duplicates nothing.

    /** Put an item straight into a player's hands. */
    giveToHands(steamId: string, selector: string): Promise<BridgeCommandResult>;
    /** Put one matching item into a player's inventory. */
    giveToInventory(steamId: string, selector: string): Promise<BridgeCommandResult>;
    /** Every match in one sweep. */
    giveAll(steamId: string, selector: string): Promise<BridgeCommandResult>;
    /** The first `count` matches. */
    giveN(steamId: string, count: number, selector: string): Promise<BridgeCommandResult>;
    /**
     * Drop an item on the ground at a coordinate.
     *
     * **The coordinate is not validated against the world**: a drop into a level that has not
     * streamed in produces no object whatsoever, with no error. `checkPlace()` answers that first.
     */
    dropItemAt(steamId: string, x: number, y: number, z: number, selector: string): Promise<BridgeCommandResult>;
    /** Drop `count` items where the player stands — recoverable, by them or by anyone, which is the
     *  point when a confiscation is meant to be seen. */
    dropItem(steamId: string, count: number, selector: string): Promise<BridgeCommandResult>;
    /** Take `count` items out of the world entirely. **No undo** — this destroys them. */
    removeItemFrom(steamId: string, count: number, selector: string): Promise<BridgeCommandResult>;
    /** The last give/drop/remove in full, including WHICH no it was when one failed. */
    lastGive(): Promise<Record<string, any> | null>;

    // ── live item actors ─────────────────────────────────────────────────────────────────────────
    // A selector here is `'eid:<n>'`, `'held:<steamid>:<Class>'` or `'floor:<x>,<y>,<r>:<Class>'`.
    // **There is no bare-class shorthand**, unlike the give verbs: these have no acting player to
    // default to, and a silent default on a destroying verb is how the wrong thing goes.

    /** Set an item's condition — an absolute health figure, or a share when the value ends in `%`. */
    setItemCondition(value: string | number, selector: string): Promise<BridgeCommandResult>;
    /** Destroy one item. Ambiguity is refused, not resolved — only `floor:` is defined as nearest.
     *  An unconfirmed destroy reports FAILURE even if it worked, because the retry is harmless. */
    destroyItem(selector: string): Promise<BridgeCommandResult>;
    /** The last item operation in full. */
    lastItemOp(): Promise<Record<string, any> | null>;

    // ── killboxes ────────────────────────────────────────────────────────────────────────────────
    // Every verb names a LEVEL explicitly: no "all", no default, no nearest match. **Nothing tuned
    // here is saved** — a restart puts every one of them back.

    /** End a run through the game's own failure path. **Success is unknowable** — the game does not
     *  report what it did with it. */
    stopKillbox(level: string): Promise<BridgeCommandResult>;
    /** Trigger panic mode. Also unknowable, and there is no panic READING at all. */
    panicKillbox(level: string): Promise<BridgeCommandResult>;
    /** Write the countdown, 0..7200 seconds. `remainingSeconds` holds a leftover while a killbox is
     *  inactive, so gate on `active` and never on it being non-zero. */
    setKillboxTime(level: string, seconds: number): Promise<BridgeCommandResult>;
    /**
     * Move the replicated activation flag — **and nothing else.**
     *
     * **This does NOT start a killbox.** There is no server-side activation call in this build:
     * writing the flag makes every CLIENT run its activation handler, while the server's own work —
     * the timer, the spawns, the doors — does not happen, because nothing on the server is listening.
     */
    setKillboxActivated(level: string, on: boolean): Promise<BridgeCommandResult>;
    /** Move the replicated finale flag. */
    setKillboxFinale(level: string, on: boolean): Promise<BridgeCommandResult>;
    /**
     * One tuning field on one killbox. Seconds 0..7200: `duration`, `lockdown`, `reductioncap`,
     * `reductionpenalty`, `panictimecut`, `gasentrance`, `laserentrance`. Counts 0..500:
     * `maxzombies`, `maxzombiespermistake`.
     */
    tuneKillbox(level: string, key: string, value: number): Promise<BridgeCommandResult>;

    // ── doors, their locks and their codes ───────────────────────────────────────────────────────
    // ⚠ A `target` is `'#<entityId>'` **or** `'<level>/<actor>'` — one forward SLASH inside what is
    // otherwise a colon grammar. Both spellings appear in this module's own report, so you never have
    // to assemble one. There is no "nearest", no radius and no default.
    //
    // **This is the most expensive reader in the bridge** — every door the server has loaded, around
    // 16800 on a full map — and a COMMAND costs one full walk too.

    /** Every door passing the module's `claimed` filter. Combination codes are OFF by default:
     *  turning them on puts the actual code a player set into the report. */
    locks(): Promise<Record<string, any> | null>;
    /**
     * What the game itself passed the last few times a door was locked or unlocked.
     *
     * A measurement, not a feature. Sending a door's own replication message needs two numbers
     * nobody has established — the version the game expects, and the origin its zeroed position is
     * measured against — and guessing either writes a door's state into the wrong place, so that
     * call stays unmade. Instead the module watches the message the game makes itself and reports
     * each one beside where that door actually stands, with the difference between them. A
     * difference that is identical on every row IS the convention, read off the running build.
     *
     * Lock one door in game, then call this. Until somebody does, the rows are empty, and that is
     * the correct answer rather than a fault.
     */
    lockReplication(): Promise<any>;
    /** Only the doors whose state says locked, ignoring the `claimed` filter deliberately. */
    lockedDoors(): Promise<Record<string, any> | null>;
    /** Swing a door open. */
    openLock(target: string): Promise<BridgeCommandResult>;
    /** Swing a door shut. */
    closeLock(target: string): Promise<BridgeCommandResult>;
    /**
     * Set the game's own Locked flag — a different thing from the swing, and a third thing from the
     * door module's `seal`, which makes a door refuse to open without touching the lock at all. A
     * door can be any combination of the three. This never sets the unpickable state, which belongs
     * to bunker and quest doors and is not on offer.
     */
    lockDoor(target: string): Promise<BridgeCommandResult>;
    /** Clear the Locked flag. */
    unlockDoor(target: string): Promise<BridgeCommandResult>;
    /** Set who may open it. */
    setDoorAccess(target: string, level: 'public' | 'private' | 'rank1' | 'rank2' | 'rank3' | 'rank4'): Promise<BridgeCommandResult>;
    /**
     * Set a combination, 0..999999 — a bound this module imposes, because the game declares no digit
     * count anywhere. **A code cannot be CLEARED**: there is no value meaning "no code" in this
     * build.
     */
    setDoorCode(target: string, combination: number): Promise<BridgeCommandResult>;
    /** Set EVERY lock's health on that door, 0..10000 — the report has no per-lock handle to aim at.
     *  Clients keep showing the old number until the game next tells them otherwise. */
    setLockHealth(target: string, value: number): Promise<BridgeCommandResult>;
    /** Set every lock's remaining pick attempts, 0..1000. Same "every lock" caveat. */
    setLockTries(target: string, count: number): Promise<BridgeCommandResult>;
    /**
     * Take the locks off a door.
     *
     * **Two things are not established**: whether it removes one lock or all of them on a door
     * carrying several, and whether the removal survives a restart. It also needs a player online.
     */
    stripLocks(target: string): Promise<BridgeCommandResult>;

    // ── medical ──────────────────────────────────────────────────────────────────────────────────
    // A selector is an effect NAME as `medicalCatalogue()` spells it, `'#<id>'` for exactly one
    // instance, or the literal `'all'` (cure only). A NAME hits EVERY instance — four bleeds are four
    // writes — and effect ids change every time an effect is created.
    //
    // **Privacy**: this is health information about identifiable people, and it leaves the game the
    // moment the switch is on.

    /** Every player in the world with whatever medical state could be read. */
    medicalPlayers(): Promise<Record<string, any> | null>;
    /** One player. `{ found: false }` when offline — which is neither an error nor an empty medical
     *  record; those are three different facts. */
    medicalPlayer(steamId: string): Promise<Record<string, any> | null>;
    /** The effect names this build currently NAMES — not the full class list, and not a fixed set. */
    /**
     * The severities the game HAS but does not replicate, asked of the game itself.
     *
     * `medicalPlayer()` reads replicated properties and SCUM never writes `_repSeverity` for a large
     * class of conditions, so most effects report the figure as unknown -- not hidden, never sent.
     * This runs the game's own `ListBodyEffects` as that player and parses the reply.
     *
     * Off by default; needs the medical module's own switch AND `allowModuleAdmin`, because it runs
     * an admin command. It changes nothing. Not merged into `medicalPlayer()` on purpose: different
     * route, different failure mode, and it costs an admin dispatch against a shared rate limit.
     *
     * `count: 0` with `fieldsNotUnderstood` set means the output format moved, not that the player
     * is healthy.
     */
    medicalSeverities(steamId: string): Promise<Record<string, any> | null>;
    medicalCatalogue(): Promise<Record<string, any> | null>;
    /** Which fields each effect kind carries, so a panel can draw a form without knowing the classes. */
    medicalFields(): Promise<Record<string, any> | null>;
    /** The last medical write with the figures either side of it. */
    lastMedicalChange(): Promise<Record<string, any> | null>;
    /**
     * Set how bad one effect is.
     *
     * Severity is QUANTISED: the replicated value only refreshes once it has moved by a configured
     * step, so it is close enough to act on and not exact enough to difference between two polls.
     */
    setEffectSeverity(steamId: string, selector: string, value: number): Promise<BridgeCommandResult>;
    /** Set one measurement or descriptor on an effect — `medicalFields()` lists what each kind has. */
    setEffectField(steamId: string, selector: string, field: string,
                   value: string | number | boolean): Promise<BridgeCommandResult>;
    /**
     * Zero everything that means "harm" on one effect — and nothing else.
     *
     * **An effect cannot be REMOVED this way.** The game adds and removes by class through native
     * commands that declare no callable function, so this ZEROES rather than deletes, and **whether
     * the game then retires a zero-severity effect is unverified**. Treatment values (a bandage,
     * disinfectant) are deliberately not zeroed: zeroing the bandage on a wound is the opposite of
     * curing it.
     */
    cureEffect(steamId: string, selector: string): Promise<BridgeCommandResult>;
    /** The same for a player's entire medical record. */
    cureAll(steamId: string): Promise<BridgeCommandResult>;
    /** Add an effect by class name, through the game's own admin command. **It reports nothing back**
     *  — success means dispatched, not that the effect exists. */
    addEffect(steamId: string, effectName: string): Promise<BridgeCommandResult>;
    /** Remove an effect through the same route, with the same "reports nothing back" caveat.
     *
     *  The two-argument call has ALWAYS been refused: the module requires the literal word
     *  CONFIRM and the wrapper never sent it, so every call silently did nothing. Pass
     *  `'CONFIRM'` as the third argument to actually remove. The two-argument form keeps its
     *  old wire on purpose -- a plugin written against it must not start deleting when the
     *  manager is updated -- and `check-bridge-calls` pins both shapes.
     */
    removeEffect(steamId: string, selector: string, confirm?: 'CONFIRM'): Promise<BridgeCommandResult>;
    /** What the last cure actually did: how many effects were set to zero, how many still read
     *  zero four seconds later, and how many the game put straight back. Added in manager 5.4 --
     *  call it defensively. A cure never shortens the medical record; this is how you tell a
     *  cure that worked from one that did not. */
    lastCure(): Promise<any>;

    // ── is this a sane spot? ─────────────────────────────────────────────────────────────────────

    /** Everything the game knows about a point, not just `checkPlace()`'s summary. Same
     *  absent-never-false rule. */
    whereIs(x: number, y: number, z: number): Promise<Record<string, any> | null>;
    /** The map's own extent, so a caller can pick a point at all. */
    worldExtent(): Promise<Record<string, any> | null>;

    // ── fire, generators, lamps and cooking ──────────────────────────────────────────────────────
    // Targeting is the NEAREST object of that kind within the module's configured radius (500 cm by
    // default) — there is no id.
    //
    // **Undocumented units wherever a key ends in `Raw`**: temperature, dial, energy ratio, light
    // intensity, cook quality. Dividing by a design maximum would be a guess wearing a unit. There is
    // no cooking progress FRACTION for the same reason — the two times the game exposes are not in
    // the same unit.
    //
    // **Two things this module will never do, and there is deliberately no call for either.** Both
    // are refused BY NAME rather than as "unknown verb", because "not written yet" and "the game has
    // no such thing" are different answers and only one of them is worth waiting for:
    //
    //   a device on/off switch — a device is a battery or canister slot and has no on and off. Set
    //                            its charge with `setDeviceCharge()`, or switch the lamp on it with
    //                            `setLight()`.
    //   lighting or dousing a fire — nothing in this build does it from outside the game. The burning
    //                            flag is the combustion loop's own OUTPUT, so forcing it adds no fuel
    //                            and no heat and only tells clients about a fire the server is not
    //                            simulating. Put fuel in with `setFireFuel()` and let the game burn it.

    /** Every fire, stove, oven and torch the server has loaded. */
    heatSources(): Promise<Record<string, any> | null>;
    /** Generators, lamps and (behind its own switch) battery devices. **Zero of each is the world's
     *  state on a stock server, not a narrow filter** — the `seen` counts separate "archetypes exist,
     *  no live ones" from "this build has no such class". */
    powerSources(): Promise<Record<string, any> | null>;
    /** Every cooking slot, what is in it and how far along it is. */
    cooking(): Promise<Record<string, any> | null>;
    /** Switch the nearest generator on or off. **Partial success is possible and reports FALSE**: the
     *  flag write can succeed while the ranged provider fails, and the reason says so. */
    setGenerator(x: number, y: number, z: number, on: boolean): Promise<BridgeCommandResult>;
    /** Fuel in the nearest generator's tank. **There is no maximum** — the game states none, so none
     *  is imposed; a ceiling invented here would be a made-up number enforced as the game's. */
    setGeneratorFuel(x: number, y: number, z: number, amount: number): Promise<BridgeCommandResult>;
    /** Switch the nearest lamp on or off. Bunker and vehicle lighting are a different component and
     *  do not appear here at all. */
    setLight(x: number, y: number, z: number, on: boolean): Promise<BridgeCommandResult>;
    /** How bright the nearest lamp burns, on the game's own raw 0..255 scale. */
    setLightIntensity(x: number, y: number, z: number, value: number): Promise<BridgeCommandResult>;
    /** Put fuel in the nearest wood fire's fire box, by mass. */
    setFireFuel(x: number, y: number, z: number, mass: number): Promise<BridgeCommandResult>;
    /** Charge in the nearest battery or canister slot, as a RATIO 0..1 — **not** a percentage. */
    setDeviceCharge(x: number, y: number, z: number, ratio: number): Promise<BridgeCommandResult>;

    // ── raid protection windows ──────────────────────────────────────────────────────────────────

    /** The protection RPCs this module has watched go past, with what they asked for. */
    protectionCalls(): Promise<Record<string, any> | null>;
    /**
     * Every protection the manager holds, with `_raidProtectionPacked` reported RAW.
     *
     * The packed word is never decoded — a uint32 with no documented bit layout — and a `set`
     * records it immediately before and after each write, which is how the unit question in
     * `setProtection()` can eventually be settled: send a known value to an unowned flag and read
     * the delta.
     */
    protections(): Promise<Record<string, any> | null>;
    /** One flag's protection. Needs the raid-protection manager, which the game only spawns when the
     *  server's protection type is non-zero. */
    flagProtection(flagId: number): Promise<Record<string, any> | null>;
    /** Take a raw snapshot of the protection state, for measuring what a `setProtection()` did. */
    snapshotProtection(): Promise<BridgeCommandResult>;

    // ── raid detection and announcements ─────────────────────────────────────────────────────────
    // **`startRaid`, `endRaid` and `forgetRaid` touch NOTHING in the game** — they edit the bridge's
    // own record. A declared window carries `declared: true`, and a real hit clears the mark.

    /** One base's raid record. */
    raidBase(baseId: number): Promise<Record<string, any> | null>;
    /** Which bases the module is tracking at all. */
    raidBases(): Promise<Record<string, any> | null>;
    /** The destroy reasons the module counts as a raid — only `damage` does, which is why
     *  `destroyElement()`'s reason argument matters. */
    raidReasons(): Promise<Record<string, any> | null>;
    /** Declare a raid window. Half a position is worse than none, so the coordinates are recorded
     *  only when all three parse; an existing window is REFRESHED, not restarted, so its hit
     *  counters survive. */
    startRaid(baseId: number, x?: number, y?: number, z?: number): Promise<BridgeCommandResult>;
    /** Close a declared window. */
    endRaid(baseId: number): Promise<BridgeCommandResult>;
    /** Discard a base's raid record, or every record with `'all'`. **No undo**: the hit count, the
     *  damage total and the position are gone, and nothing can reconstruct them. */
    forgetRaid(baseId: number | 'all'): Promise<BridgeCommandResult>;
    /**
     * Send one of the game's raid announcements. `seconds` (0..86400) applies to `'ending'`.
     *
     * **This only ANNOUNCES.** It does not open or close the game's protection period, which is
     * driven by the server settings and the manager's own clock — "announce the raid window" and
     * "start the raid window" are one word apart and a very long way apart in consequence.
     */
    announceRaid(kind: 'allowed' | 'ending' | 'concluded', seconds?: number): Promise<BridgeCommandResult>;

    // ── changing a vehicle ───────────────────────────────────────────────────────────────────────
    //
    // A `target` is `'e<entityId>'` — the whole 64-bit word, reassembled as `(ehi << 32) | elo` from
    // what `entities()` reports — or `'@<x>,<y>[,<radius>]'`, the single vehicle within that many
    // centimetres. Ambiguity is BOUNDED, not resolved: a second vehicle in range refuses the whole
    // command rather than picking the nearest, because "nearest wins" repairs the car parked behind
    // the one somebody meant.
    //
    // A `part` narrows repair, damage, pattern and colours: omit it or pass `'*'` for every part,
    // `'#<id>'` for one, a kind (`wheel`, `door`, `engine`, `battery`, …), or `'~<region>'` for the
    // game's own damage grouping. A selector matching NOTHING is a refusal, not a no-op.

    /** Which vehicle an address would hit, its heading, the damage REGIONS its attachments carry (the
     *  `~` selector's only source) and its damage-type multipliers — which say whether a
     *  `damageVehicle()` will do anything at all. */
    resolveVehicle(target: string): Promise<Record<string, any> | null>;
    /** Raise health towards each part's own maximum. `percent` may be a bare number or end in `%`;
     *  omit it for a full repair. */
    repairVehicle(target: string, percent?: number | string, part?: string): Promise<BridgeCommandResult>;
    /** Damage through the game's OWN damage call, so destruction, propagation and effects all happen.
     *  A direct health write is deliberately not offered: a part at zero health the game never
     *  processed as destroyed is a wheel that reads as gone and still drives. */
    damageVehicle(target: string, percent: number | string, part?: string): Promise<BridgeCommandResult>;
    /** The same call, lethal, on every destructible part — so whether the wreck burns, explodes or
     *  becomes a corpse is the game's decision and not the bridge's. */
    destroyVehicle(target: string): Promise<BridgeCommandResult>;
    /** Set the engine block's fuel, in litres or as a share ending in `%`. */
    setVehicleFuel(target: string, value: number | string): Promise<BridgeCommandResult>;
    /** Set the battery's charge, absolute or as a share ending in `%`. */
    setVehicleBattery(target: string, value: number | string): Promise<BridgeCommandResult>;
    /** Set the odometer, in kilometres. */
    setVehicleMileage(target: string, km: number, part?: string): Promise<BridgeCommandResult>;
    /** Set the paint pattern index, 0..255. */
    setVehiclePattern(target: string, index: number, part?: string): Promise<BridgeCommandResult>;
    /** Set the packed colour indexes — a raw uint32, which is why it is not range-checked. */
    setVehicleColors(target: string, packed: number, part?: string): Promise<BridgeCommandResult>;
    /** Who may open the vehicle's item container. Acts on the whole vehicle — a part selector here is
     *  refused rather than ignored. */
    setVehicleAccess(target: string, level: string): Promise<BridgeCommandResult>;
    /** Who owns the vehicle's item container. Same whole-vehicle rule. */
    setVehicleOwner(target: string, profileId: number): Promise<BridgeCommandResult>;

    // ── the running server's own settings ────────────────────────────────────────────────────────
    // **The game exposes no way to enumerate its settings.** The catalogue of NAMES comes from the
    // settings file the game itself writes; every VALUE comes from the running game. Nothing can
    // check a RANGE, and whether a change survives a restart is the game's own per-setting business.

    /** The whole catalogue: name, declared type, section. No engine calls, so it costs nothing and
     *  always answers. `text` filters case-insensitively on the name. */
    settingsList(text?: string): Promise<Record<string, any> | null>;
    /** The LIVE value of every catalogue entry matching `text`, capped at 60 with `truncated` when the
     *  cap was hit. `from` starts at the n-th match — the only way to reach the rest of a 437-entry
     *  catalogue. */
    settingValues(text?: string, from?: number): Promise<Record<string, any> | null>;
    /** The catalogue names in one section. No engine calls. */
    settingsSection(name: string): Promise<Record<string, any> | null>;
    /** Ask all four getters which type this build actually answers for — the honest way to find out
     *  before writing, since guessing reports a float as a rounded integer. */
    probeSetting(name: string): Promise<Record<string, any> | null>;
    /** The section names, for a panel that wants to group them. */
    settingCategories(): Promise<Record<string, any> | null>;
    /** Every write this module has made, and what the value was before it. */
    settingChanges(): Promise<Record<string, any> | null>;
    /** Put back what the last write to one setting changed. */
    revertSetting(name: string): Promise<BridgeCommandResult>;
    /** The same for every setting this module has changed since the server started. */
    revertAllSettings(): Promise<BridgeCommandResult>;

    // ── creating things in the world ─────────────────────────────────────────────────────────────
    // ⚠ Note the shape: the spawn itself is a READ verb — a write wearing a read's shape, because it
    // answers with what it made. So these two return a payload or `null`, not `{ ok }`.

    /** Every kind name this module accepts, with the route it takes and the switch it needs. */
    spawnKinds(): Promise<Record<string, any> | null>;
    /** What happens to what this module spawns, measured on THIS server: each success records its
     *  slot, re-resolves it at about 30 s and 5 min, and reports the tallies. */
    spawnPersistence(): Promise<Record<string, any> | null>;
    /**
     * Spawn something at a point with a rotation. Coordinates are centimetres, angles degrees.
     *
     * **What this spawns does not persist, and that is unreachable rather than untested.** Every
     * reflected spawn function in the build either takes no class or takes no place, and the managers
     * that own animals and items expose nothing inbound that would register one. Measured live: a
     * deer spawned this way appeared (the animal count went 85 → 86) and was gone on its own inside
     * **thirty seconds** — and even that is an upper bound on when anything looked, not a lifetime:
     * the first check made at thirty seconds already found it missing, the count back to 85 and a
     * sweep of the area empty. Budget seconds, not minutes. **There is no setting that changes
     * this.**
     *
     * `spawnPersistent()` is the only route that lasts — and it reports nothing back.
     */
    spawnAt(kind: 'creature' | 'boss' | 'vehicle' | 'actor' | (string & {}),
            x: number, y: number, z: number, yaw: number, pitch: number, roll: number,
            classPath: string): Promise<Record<string, any> | null>;
    /**
     * Spawn through one of SCUM's own admin commands, at a chosen point — the only PERSISTENT route.
     *
     * **No admin spawn command has a rotation argument**, so a persistent spawn cannot be rotated;
     * that is the game's shape, not a gap here. And the command reports nothing back, so success
     * means dispatched.
     */
    spawnPersistent(kind: string, x: number, y: number, z: number, count: number,
                    type: string): Promise<Record<string, any> | null>;

    // ── the game state's own squad list ──────────────────────────────────────────────────────────
    // A DIFFERENT set from `bridge.squad()`: that one drives the five RPCs on a PRISONER and needs
    // the player online, with the game's own rank rules applied. Everything here goes through the
    // game state and works when NOBODY from the squad is on — which is exactly when an owner wants
    // it. `profileId` is the SCUM user profile id, not a Steam ID.

    /** One squad by id, through the game state's own index — no walk. */
    squadById(squadId: number): Promise<Record<string, any> | null>;
    /** Which squad a profile id is in, asked the way the game asks it. */
    squadOfProfile(profileId: number): Promise<Record<string, any> | null>;
    /** Disband a squad, member by member. Works with the whole squad offline. */
    disbandSquad(squadId: number): Promise<BridgeCommandResult>;
    /**
     * Put a profile into a squad without asking anyone's permission — an owner conscripting somebody,
     * not the player accepting a place, which is `bridge.squad(id, 'join', …)`. Needs the prisoner
     * online, because the call takes one.
     */
    addSquadMember(squadId: number, profileId: number): Promise<BridgeCommandResult>;
    /** Evict a profile from one squad. No prisoner needed, so it works while they are offline. */
    removeSquadMember(squadId: number, profileId: number): Promise<BridgeCommandResult>;
    /** Evict a profile from EVERY squad it is in, in one call. */
    removeFromAllSquads(profileId: number): Promise<BridgeCommandResult>;
    /** Rename a squad. Needs a member online — the change travels on the game's own squad-data call. */
    renameSquad(squadId: number, name: string): Promise<BridgeCommandResult>;
    /** Set the squad's message of the day. Same online requirement; the text may contain colons. */
    setSquadMessage(squadId: number, text: string): Promise<BridgeCommandResult>;
    /** Set the squad's information text. Same online requirement. */
    setSquadInfo(squadId: number, text: string): Promise<BridgeCommandResult>;

    // ── survival counters and skills ─────────────────────────────────────────────────────────────

    /** Every player the module currently holds counters for. */
    survivalStats(): Promise<Record<string, any> | null>;
    /** One player by the profile id the game files them under. */
    playerStats(profileId: number): Promise<Record<string, any> | null>;
    /** The same by Steam ID. `{ found: false }` when they are offline — the counters are kept by
     *  profile id and there is no way to learn one for somebody who is not here. */
    playerStatsBySteamId(steamId: string): Promise<Record<string, any> | null>;
    /** A player's live skill sheet, and the skill names this build actually has — the read-back for a
     *  write. */
    playerSkills(steamId: string): Promise<Record<string, any> | null>;
    /** The last skill write with the figures either side of it, and whether the forced replication
     *  refresh was accepted. The evidence that an award landed. */
    lastSkillWrite(): Promise<Record<string, any> | null>;
    /** The kill registry, all of it or one player's. Behind its own switch. */
    killRegistry(profileId?: number): Promise<Record<string, any> | null>;
    /** Ask the game to refresh the snapshot — everyone online, paced, or one player. */
    refreshStats(profileId?: number): Promise<BridgeCommandResult>;
    /**
     * Forget every captured counter.
     *
     * **The only way back is a refresh sweep, which can only reach whoever is online right now** — so
     * anybody who has logged off since is simply gone until they return.
     */
    clearStats(): Promise<BridgeCommandResult>;
    /** Award skill experience through the game's own path. `skill` is a name from `playerSkills()`,
     *  and the player must be in the world with a skill component. */
    awardSkill(steamId: string, skill: string, points: number): Promise<BridgeCommandResult>;
    /** Reach an absolute figure instead. Refused when the player has no record for that skill yet —
     *  there is nothing to measure a `set` against, so use `awardSkill()` first. */
    setSkill(steamId: string, skill: string, points: number): Promise<BridgeCommandResult>;
    /**
     * Set a skill's LEVEL outright -- the only route that can LOWER one.
     *
     * `awardSkill()` and `setSkill()` move experience, and the game discards a negative, so neither
     * can take a skill down. This runs the game's own SetSkillLevel, which writes a level and an
     * absolute experience in either direction; the module reads both back and refuses when the level
     * did not arrive.
     *
     * `skill` is the DISPLAY name, spaces and all -- 'Melee Weapons', not 'MeleeWeapons', both of
     * which the game answers with "Skill not found." And `experience` is required: omitted from the
     * game's command it writes zero, silently emptying the skill you were only re-levelling.
     *
     * Behind its own switch, separate from the two above because this one can empty a skill. Needs
     * the bridge's admin switch as well, and the executing player must have elevated status.
     */
    setSkillLevel(steamId: string, skill: string, level: number, experience: number): Promise<BridgeCommandResult>;

    // ── containers, and what is inside them ──────────────────────────────────────────────────────

    /** Lockboxes specifically. */
    lockboxes(): Promise<Record<string, any> | null>;
    /** What one container holds, by the id `storage()` listed. */
    containerContents(containerId: string): Promise<Record<string, any> | null>;
    /** How many of one item class a player is carrying. Matching is EXACT on the listing's `class`
     *  key after one trailing `_C`, never a substring. The three counts mean three different things
     *  and are never added together: `stack` is how many of the thing, `uses` how many uses remain in
     *  one, `quantity` an unrecognised component's raw figure. Read `uncounted` before you trust any
     *  of them — an entry that reported no count is not an entry holding one — and `truncated` makes
     *  every number a floor. Composed from `inventory()`, so it costs exactly that. */
    countHeld(steamId: string, itemClass: string): Promise<ItemTally>;
    /** The same, for what is inside one container. Same reply, same rules. */
    countInContainer(containerId: string | number, itemClass: string): Promise<ItemTally>;
    /** Move an item out of a container into a player's inventory. The player must be SPAWNED IN, not
     *  merely connected. */
    takeFromContainer(containerId: string, itemId: string, steamId: string): Promise<BridgeCommandResult>;
    /** Move an item between containers. Made through a player's inventory component, so it needs at
     *  least one player spawned in even though no player is involved in the outcome. */
    moveBetweenContainers(containerId: string, itemId: string, targetContainerId: string): Promise<BridgeCommandResult>;
    /** Destroy one item inside a container. No undo. */
    destroyContainerItem(containerId: string, itemId: string): Promise<BridgeCommandResult>;

    // ── teleporting ──────────────────────────────────────────────────────────────────────────────
    // **A player teleport cannot report a collision refusal at all**: the game's player teleport
    // starts a handshake and returns nothing. So `dropCm` (1..10000) is a PRECAUTION, not a retry —
    // it raises only the arrival Z, and nothing searches for a nearby place that fits, because
    // silently relocating somebody to a different place from the one asked for is worse than refusing.

    /**
     * Move a player to another player, arriving facing the way the TARGET faces.
     *
     * That facing is the whole reason this is not `#TeleportTo`, which has no argument for it. A
     * facing that cannot be read refuses rather than inventing one.
     */
    teleportToPlayer(steamId: string, targetSteamId: string, dropCm?: number): Promise<BridgeCommandResult>;
    /** Two players exchange places in one call. Both positions are read before either moves, so a
     *  half-completed swap is not a state this can produce. */
    swapPlayers(steamIdA: string, steamIdB: string, dropCm?: number): Promise<BridgeCommandResult>;
    /** Every online, spawned-in member of one squad to the same point. **They all land on the SAME
     *  spot** — give a drop height if that matters, or move them one at a time. Members who are
     *  offline or still loading are skipped and counted, never silently dropped. */
    teleportSquad(squadId: number, x: number, y: number, z: number, yaw: number, dropCm?: number): Promise<BridgeCommandResult>;
    /**
     * Put a player back where this module last moved them from.
     *
     * Memory only, 512 entries, **lost on a restart**, and it replaces rather than stacks: `back`
     * means "undo the last one", so calling it twice returns the player to where the first `back`
     * took them from. Read `teleportOrigin()` first — the record may be hours old.
     */
    teleportBack(steamId: string): Promise<BridgeCommandResult>;
    /** Where `teleportBack()` would put this player, and how long ago they were there. */
    teleportOrigin(steamId: string): Promise<Record<string, any> | null>;
    /**
     * Every player `teleportBack()` could still undo — `{ origins, count, max }`.
     *
     * **Free**: a walk over a few hundred structs in the module's own memory that touches the game
     * not at all, so unlike most reads here it is safe on a timer. `teleportOrigin()` answers "where
     * would this one go"; this answers "who can I undo at all".
     *
     * **A listed player may not be on the server.** These are coordinates keyed by Steam ID and never
     * a pointer to anybody, so somebody who has since disconnected is still listed — correctly:
     * `teleportBack()` will refuse for them because they are not here, not because the record has
     * gone. Nothing persists; the list starts empty at every server start.
     *
     * The list is a **ring** — at `max` the OLDEST record is dropped, so a long event can quietly
     * lose the ability to undo its own first teleports. `count` against `max` is how you see that
     * coming.
     */
    teleportOrigins(): Promise<Record<string, any> | null>;
    /** Every prisoner corpse in the world with the name written on it. Not a convenience:
     *  `moveCorpse()` addresses a body BY that name, so this is the only way to know what names exist
     *  and whether one is duplicated. */
    corpses(): Promise<Record<string, any> | null>;
    /**
     * Move a body, addressed by the name written on it.
     *
     * **Two bodies with the same name are REFUSED, not guessed between.** The name is whatever the
     * game put in that field — expected to be the dead prisoner's name and NOT confirmed on a running
     * server. Vehicle wrecks are not covered at all: nothing on one distinguishes it from another.
     *
     * `force` skips the engine's fit test and puts it exactly where asked, including inside a hill.
     */
    moveCorpse(displayName: string, x: number, y: number, z: number, yaw: number,
               dropCm?: number, force?: boolean): Promise<BridgeCommandResult>;
    /** Turn a player where they stand, through the game's own turn-in-place path, so the animation
     *  plays. Yaw only — a prisoner has no meaningful pitch or roll. */
    facePlayer(steamId: string, yaw: number): Promise<BridgeCommandResult>;
    /** Turn a vehicle where it stands, with a full rotator — righting something lying on its side is
     *  most of the reason to ask. Refused while someone is driving it. */
    faceVehicle(idLo: number, idHi: number, pitch: number, yaw: number, roll: number): Promise<BridgeCommandResult>;
    /** The same for a dropped item. */
    faceItem(idLo: number, idHi: number, pitch: number, yaw: number, roll: number): Promise<BridgeCommandResult>;

    // ── outposts and the economy ─────────────────────────────────────────────────────────────────

    /** Every trade outpost the server has loaded. */
    traders(): Promise<Record<string, any> | null>;
    /** The economy settings alone — no world walk at all, so this is the one that belongs on a screen
     *  an owner leaves open. */
    economy(): Promise<Record<string, any> | null>;
    /** Every key `setEconomy()` accepts, with its kind, its bounds and whether a change reaches
     *  clients — enough to draw the form without knowing what any of them mean. */
    economyWritable(): Promise<Record<string, any> | null>;
    /** Per-item price overrides, for every trader personality or only those whose asset name contains
     *  `text`. Behind its own switch. */
    itemPrices(text?: string): Promise<Record<string, any> | null>;
    /**
     * Set one live economy setting. One key per call, deliberately: a batch would have to decide what
     * to do when the third of five writes is refused, and a partial economy change is a state nobody
     * chose and nobody can name afterwards. The write is CONFIRMED by reading the property back.
     *
     * **Nothing here persists** — a restart rebuilds the economy actor. And the keys split by
     * replication: unlimited funds, unlimited stock and the fame requirement reach clients, while the
     * gold base price and the sale modifier do not, so the server computes with the new value
     * immediately while an already-open shop shows the old one.
     */
    setEconomy(key: string, value: string | number | boolean): Promise<BridgeCommandResult>;

    // ── cargo drops and competitive events ───────────────────────────────────────────────────────
    // `cls` is the event CLASS as `worldEvents()` spells it (`BP_DeathmatchGameEvent_C`), matched
    // exactly first and then as a substring — and a substring hitting more than one class is refused
    // and names them. The optional point narrows several events of the same class to the nearest;
    // WITHOUT it, several candidates are refused rather than picked from, because ten deathmatch
    // locations are ten different places and starting one on the wrong side of the island is not
    // recoverable by cancelling it.

    /** Start the announce → round → end cycle for one event. */
    scheduleEvent(cls: string, x?: number, y?: number, z?: number): Promise<BridgeCommandResult>;
    /** Stop it. `force` skips whatever grace the game would normally give. */
    cancelEvent(cls: string, x?: number, y?: number, z?: number, force?: boolean): Promise<BridgeCommandResult>;
    /** Put the arena back the way it started. */
    resetEventArea(cls: string, x?: number, y?: number, z?: number): Promise<BridgeCommandResult>;
    /** Set every team's score to zero. */
    clearEventScores(cls: string, x?: number, y?: number, z?: number): Promise<BridgeCommandResult>;
    /** Re-target a crate that is **already falling**, optionally changing its remaining seconds.
     *  Starting a NEW drop is the game's own `#ScheduleCargoDrop`, not this. */
    retargetCargoDrop(x: number, y: number, z: number, seconds?: number): Promise<BridgeCommandResult>;
    /** Detonate a crate early. With no point it acts on the only one; with one it picks the nearest. */
    detonateCargo(x?: number, y?: number, z?: number): Promise<BridgeCommandResult>;
    /** Move an ambient event's declared centre. `cls` is optional — an idle server has no ambient
     *  events and a busy one rarely has two. */
    moveAmbientEvent(cls: string | null | undefined, x: number, y: number, z: number): Promise<BridgeCommandResult>;
    /** Resize one. The value is the game's own hundredths-of-a-metre figure, not metres. */
    resizeAmbientEvent(cls: string | null | undefined, radius: number): Promise<BridgeCommandResult>;

    // ── more zones ───────────────────────────────────────────────────────────────────────────────
    // Every write still rewrites the WHOLE set, so `refreshZones()` first on a cold start and
    // remember that `known: false` is not "no zones" — conflating them makes a caller overwrite a set
    // it never saw. Writing needs a player online. Game-default zones are never dropped: a delete
    // marks them deleted and an edit marks them modified, which is the game's own mechanism.

    /** One zone by name, with its configuration resolved. */
    zone(name: string): Promise<Record<string, any> | null>;
    /** The server-wide configuration every zone inherits from. */
    globalZoneConfig(): Promise<Record<string, any> | null>;
    /** One configuration by index — the number a zone's `config` points at. */
    zoneConfig(index: number): Promise<Record<string, any> | null>;
    /** The words every zone verb accepts — shapes, damage channels, handlings. Ask this rather than
     *  hard-coding them. */
    zoneEnums(): Promise<Record<string, any> | null>;
    /** Move a zone's centre. */
    moveZone(name: string, x: number, y: number): Promise<BridgeCommandResult>;
    /** Resize one. */
    resizeZone(name: string, width: number, height: number): Promise<BridgeCommandResult>;
    /** Change a zone between a circle and a rectangle. */
    reshapeZone(name: string, shape: 'circle' | 'rectangle'): Promise<BridgeCommandResult>;
    /** Point a zone at a different configuration index. */
    assignZoneConfig(name: string, index: number): Promise<BridgeCommandResult>;
    /** Rename a zone. */
    renameZone(oldName: string, newName: string): Promise<BridgeCommandResult>;
    /** Duplicate a zone under a new name. */
    copyZone(name: string, newName: string): Promise<BridgeCommandResult>;
    /** Remove every custom zone. Game-default zones are marked deleted rather than dropped. */
    clearZones(): Promise<BridgeCommandResult>;

    /**
     * The guarded zones — where the game's own sentries defend, and the numbers behind how they
     * behave.
     *
     * Twenty-two zones, one per streaming level: the prison, the airfields, the military base. They
     * share a class AND an actor name, so **the level is the only thing that tells them apart**, and
     * is how they are addressed here.
     *
     * Sentry spawners are COUNTED, not listed. What a spawner holds is where a sentry belongs — its
     * patrol points, its class, its range — and nothing about whether one is alive right now, so
     * walking them would multiply the answer sixfold and add no fact.
     *
     * `global` and `zones` fail independently and say so independently: a missing `zones` is a walk
     * that faulted, never an island with no guarded places.
     *
     * Read-only, needs the `zones` module and its own `guarded` switch.
     */
    guardedZones(): Promise<{ global?: Record<string, number>; zones?: Array<Record<string, any>>; truncated?: boolean } | null>;
    /**
     * The map border, including the rectangle the game is actually enforcing.
     *
     * Whether a border is active, whether the server is in tournament mode and how far through it is,
     * and both rectangles — the live one (`map`) and the tournament final. On a server that has never
     * run a tournament the live rectangle may read as an unset box.
     *
     * **Nothing here can be WRITTEN, and that is a finding rather than caution**: the class exposes a
     * mesh, a material and four client-side handlers, and nothing in the build is the server-side
     * rule for a player who steps outside. Setting the flag would draw a wall for everyone with no way
     * to learn whether the server enforces it.
     *
     * Read-only, needs the `zones` module and its own `border` switch.
     */
    mapBorder(): Promise<Record<string, any> | null>;
    /**
     * Change one of the guarded zones' shared sentry numbers: `respawn`, `standdown`, `hits`,
     * `hitsreset`.
     *
     * This changes the WHOLE island — the game keeps one set for all 22 places — and nothing
     * persists a restart. Out-of-range values are REFUSED, never trimmed. Five more fields are
     * reported and deliberately read-only: a tick period trades server cost against reaction lag in
     * no unit an owner can reason in, and the dropship distances are spawn geometry with no
     * read-back, so a wrong value could not even be seen afterwards.
     *
     * Needs the `zones` module and its own `guardedwrite` switch — deliberately **NOT** the module's
     * `write` switch, which arms the call that rewrites every custom zone an admin ever drew.
     *
     * WHEN the zone manager re-reads a changed value is not established: the write lands on a live
     * actor, but whether a respawn already scheduled picks it up needs a live server to answer.
     */
    setSentryTuning(field: 'respawn' | 'standdown' | 'hits' | 'hitsreset',
                    value: number): Promise<BridgeCommandResult>;
    /**
     * One zone-configuration verb, passed through as a string: `'add:<name>'`,
     * `'copy:<index>:<name>'`, `'rename:<index>:<name>'`,
     * `'setting:<index>:<none|visibleOnMap|notifyOnEntry>'`,
     * `'event:<index>:<event>:<ignore|allow|block>'`, `'eventall:<index>:<handling>'`,
     * `'color:<index>:<r>:<g>:<b>:<a>'`,
     * `'damage:<index>:<instigator>:<channel>:<receiver>:<handling>'`,
     * `'damageclear:<index>:<instigator>'`, `'delete:<index>'`.
     *
     * Left as one string on purpose: ten verbs of three to six fields each, all colon-separated with
     * no nested separator, and `zoneEnums()` already names every word they take.
     */
    zoneConfigCommand(rest: string): Promise<BridgeCommandResult>;
    /** The same for the server-wide configuration: `'setting:<value>'`, `'event:<event>:<handling>'`,
     *  `'eventall:<handling>'`, `'rename:<name>'`, `'color:<r>:<g>:<b>:<a>'`,
     *  `'damage:<instigator>:<channel>:<receiver>:<handling>'`, `'damageclear:<instigator>'`. */
    globalZoneCommand(rest: string): Promise<BridgeCommandResult>;

    // ── quests ───────────────────────────────────────────────────────────────────────────────────
    //
    // **Per-player quest PROGRESS cannot be read at all.** The player's quest component reflects one
    // float — a design constant identical on every player — and every quest-carrying struct in the
    // build reflects EMPTY. Progress is only ever OBSERVED, through the watched calls
    // `questActivity()` reports, which is a live buffer inside the game process and not a log: what
    // must survive a restart has to be collected from here and stored elsewhere.
    //
    // Quest TITLES are unreadable (localised text, no reader for it), so the `name` reported is the
    // asset's own. And the `questId` in activity **cannot be joined** to a quest name or to the
    // `netIndex` the catalogue uses — different identifiers, unrelated anywhere in the build.

    /** The quest manager's own state — counts, rules, overrides. */
    quests(): Promise<Record<string, any> | null>;
    /** Every quest this server has, by `netIndex`. Objectives are included only when the module's
     *  `conditions` switch is on, because each one costs an extra read per quest. */
    questCatalogue(): Promise<Record<string, any> | null>;
    /** One quest by `netIndex`. Objectives are ALWAYS included here — one quest is one read. */
    quest(netIndex: number): Promise<Record<string, any> | null>;
    /** Quest outposts and where they are. */
    questOutposts(): Promise<Record<string, any> | null>;
    /**
     * The named circular regions quests draw their objectives inside — `{ count, groups }`, each
     * group a name and its `areas` of `{ x, y, z, radius }`.
     *
     * Costs one singleton lookup plus one map read, the same order as `questOutposts()` and nothing
     * like the object-array pass `questGivers()` makes. Needs the module on and no separate switch.
     *
     * **`areas` is omitted, never zeroed, when a group's array could not be read** — "this group has
     * no circles" and "I could not see this group's circles" are opposite answers to anything drawing
     * a map. `areaCount` is the array's own length while the listed areas are what was read, so the
     * two differ exactly when `areasTruncated` is set; `truncated` says the same about the group
     * list. `radius` is absent when this build has no readable one — draw the point, not a circle of
     * an invented size.
     */
    questAreas(): Promise<Record<string, any> | null>;
    /** The quest-giver components. Behind its own switch — a full pass over the object array. */
    questGivers(): Promise<Record<string, any> | null>;
    /** Time-limited quests. **`startTicks`/`endTicks` are raw engine ticks** and must not be rendered
     *  as a date without checking that first. */
    timedQuests(): Promise<Record<string, any> | null>;
    /**
     * Quest activity the bridge has watched — starts, advances, completions, resets. Pass a `steamId`
     * to filter (that form needs the module's `watch` switch).
     *
     * A `steamId` is **omitted**, never a placeholder, when the player had already left before the
     * event resolved: the event is real and its owner is unknown, and those are different facts.
     */
    questActivity(steamId?: string): Promise<Record<string, any> | null>;
    /**
     * Make a player abandon a quest. Needs them ONLINE, and there is no undo.
     *
     * `questId` is the game's own id as `questActivity()` reports it — not a `netIndex`. **`ok: true`
     * means DISPATCHED**, not that the player's quest log now reads the way you intended; nothing
     * inside the process can claim that.
     */
    abandonQuest(steamId: string, questId: number): Promise<BridgeCommandResult>;
    /** The same for one task. */
    abandonTask(steamId: string, taskId: number): Promise<BridgeCommandResult>;
    /**
     * Start a TASK for a player.
     *
     * **Starting a QUEST is impossible** and is refused by name: the game's own start call takes a
     * struct that reflects no members and therefore cannot be built. Server-side quest COMPLETION
     * does not exist either — the game's completion call is a client-side notification, and sending
     * one would tell a player they finished something the server does not believe they finished.
     */
    startTask(steamId: string, taskId: number): Promise<BridgeCommandResult>;
    /**
     * Drive the server-wide quest cycle.
     *
     * `reset` and `endcycle` **change every player's quests at once and have no undo**. All three go
     * out as admin commands, so success means SENT — the game returns nothing.
     */
    questCycle(sub: 'reset' | 'endcycle' | 'refresh'): Promise<BridgeCommandResult>;

    // ── radiation and world wetness ──────────────────────────────────────────────────────────────
    //
    // **Nothing here is live replicated state and nothing persists.** No field carries replication or
    // save markers, so a write is server-side only, no client is told, and a restart is the undo for
    // every one of them. Nothing re-simulates them either, so a write that lands holds for as long as
    // the server runs. Every range is the MODULE's own; the game states none.
    //
    // This is WORLD-object wetness. A prisoner's is `setWetness()`.

    /** Every knob with its value, range, group and which manager it lives on. A value that could not
     *  be read comes back as an explicit `null`, never 0. */
    hazard(): Promise<Record<string, any> | null>;
    /** One knob on its own. */
    hazardKnob(key: string): Promise<Record<string, any> | null>;
    /** The two group names and the five writable per-zone field names. */
    hazardGroups(): Promise<Record<string, any> | null>;
    /** Every radiation zone the island DECLARES. `zoneCount: null` in `hazard()` means the array could
     *  not be reached — not the same as zero. */
    radiationZones(): Promise<Record<string, any> | null>;
    /**
     * The same zones, each actually SAMPLED at its own epicentre.
     *
     * `frame` deliberately does not pick a side: `unconfirmed` means either the epicentre is local to
     * a transform this module will not guess at, OR the running server does not evaluate radiation
     * from this asset at all. A sample that could not be TAKEN is never reported as zero.
     */
    radiationMeasured(): Promise<Record<string, any> | null>;
    /** Every online player's radiation exposure. `radiationRate` is OMITTED, never zeroed, when the
     *  sample could not be taken. */
    radiationExposure(): Promise<Record<string, any> | null>;
    /** Write one knob. Outside its range it is REFUSED, never clamped. Each write arms one re-read
     *  about two seconds later, and only the LAST write is watched. */
    setHazard(key: string, value: number): Promise<BridgeCommandResult>;
    /** Write one field of one radiation zone. Zone GEOMETRY is deliberately read-only — the coordinate
     *  frame is unverified. */
    setRadiationZone(index: number,
                     field: 'rate' | 'falloff' | 'radius' | 'noiseAmount' | 'noiseScale',
                     value: number): Promise<BridgeCommandResult>;
    /**
     * Scale every radiation zone on the island at once, 0..1000.
     *
     * **This changes the whole island for everyone online.** All-or-nothing on the range check: if
     * the multiplier would put any one zone outside its bounds, the whole event is refused and
     * nothing changes. `restoreRadiation()` and a restart are both undos.
     */
    radiationEvent(multiplier: number): Promise<BridgeCommandResult>;
    /** Put back what this module changed — one zone, or all of them. */
    restoreRadiation(index?: number): Promise<BridgeCommandResult>;

    // ── ambushes and spawn waves ─────────────────────────────────────────────────────────────────

    /** Everything below in one payload, each section present only when its switch is on. */
    encounters(): Promise<Record<string, any> | null>;
    /** The encounter manager's tuning. `governedBy` names WHICH switch governs each family, not what
     *  that switch is currently set to. */
    encounterTuning(): Promise<Record<string, any> | null>;
    /** Live hordes, grouped by proximity. **The only expensive verb here.** It returns null with a
     *  reason rather than a zero count when the walk fails: a zero reads as "the coast is clear",
     *  which is precisely the wrong thing to say about a horde. */
    hordes(): Promise<Record<string, any> | null>;
    /** Bases that have gained an encounter, with `active` and an age. An ended encounter is kept as
     *  `active: false` — "this base had an ambush and it is over" is not "this base never had one". */
    encounterBases(): Promise<Record<string, any> | null>;
    /**
     * The last encounter capture an admin's own in-game command produced. **Passive and possibly
     * stale** — the bridge cannot trigger it.
     *
     * `seen: false` (nobody has ever run it) and `seen: true` with an empty list (an admin asked and
     * there was nothing) are DIFFERENT answers: collapsing them turns "we have not looked" into "we
     * looked and there is nothing".
     */
    nearbyEncounters(): Promise<Record<string, any> | null>;
    /** The competitive-event schedule. A bucket is omitted entirely when its array cannot be read. */
    eventSchedule(): Promise<Record<string, any> | null>;
    /**
     * Force a base-building encounter at a base near one player.
     *
     * **Irreversible** — it drops hostiles on somebody's base and the game exposes no way to call
     * them off. There is no default target, ever. **`ok: true` means the dispatch did not fault**,
     * nothing more; read `encounterBases()` a moment later, and THAT is the confirmation.
     */
    forceBaseEncounter(steamId: string): Promise<BridgeCommandResult>;
    /**
     * Ask the game to draw the encounters near a player, ON THAT PLAYER'S SCREEN.
     *
     * A read -- it changes nothing in the world. What it changes is one person's view, which is why
     * the player is named rather than assumed.
     *
     * `extentCm` is a search half-width in CENTIMETRES, checked here because the game silently
     * ignores a value it dislikes rather than refusing it; omit it for the game's own default.
     * Measured live: 50 000 found one encounter, 500 000 found two.
     *
     * This is what fills `encountersNearby()`, which has nothing to report until it has run.
     */
    drawNearbyEncounters(steamId: string, extentCm?: number): Promise<BridgeCommandResult>;
    /** Ask the game to dump its encounter-manager data to disk. **The path is unknowable from inside
     *  the process**, so nothing is handed back. */
    dumpEncounters(): Promise<BridgeCommandResult>;

    // ── virtualized items and world containers ───────────────────────────────────────────────────
    //
    // **Read-only, and its most valuable answer is a negative one.** Container CONTENTS cannot be
    // read from either of the game's managers: the container class is a lockable crate with no
    // inventory, and the virtualization manager reflects zero properties and zero functions. The
    // item sweep behind `inventory()` and `storage()` remains the only route, and
    // `host.map.container()` reads the same fact from the game database for a fraction of the cost.
    //
    // This IS the one bridge reader cheap enough to sit on a timer — a couple of hundred objects
    // rather than twenty thousand — though it is still off by default.

    /** Virtualized item records, all of them or one profile's. */
    virtualized(profileId?: number): Promise<Record<string, any> | null>;
    /** World containers with their locks. `locks: []` means "walk in"; the key being ABSENT means the
     *  lock list could not be read at all, and the two must not be confused. */
    worldContainers(): Promise<Record<string, any> | null>;
    /** Who owns a container, by profile id — WHO, never how many. */
    containerOwners(): Promise<Record<string, any> | null>;
    /** The container replication map. Its lock arrays are reported as UNREAD rather than as empty.
     *  Cannot be joined to `worldContainers()` — the two key on different identifiers. */
    containerRepData(): Promise<Record<string, any> | null>;
    /** A survey of both managers, re-measured on this server rather than read off a dump — so a game
     *  update shows up as a number moving. */
    virtualSurvey(): Promise<Record<string, any> | null>;

    // ── server-wide messages ─────────────────────────────────────────────────────────────────────
    //
    // **None of this has been confirmed on a live server.** Every call is server-side by construction
    // and that is reasoning from the game's own headers, not a banner anybody watched appear.
    //
    // Text is REFUSED, never trimmed and never stripped: over the byte limit, or carrying a line
    // break or control character, the call fails rather than delivering something other than what was
    // written. A HUD line and a banner both EXPIRE; only a kill-feed entry persists in the list.
    //
    // Per-PLAYER messages are `hud()` and `warn()`; this family is broadcast only.

    /** Whether the game has a notification manager yet, and what is queued. `{ found: false }` is an
     *  answer, not a refusal. */
    notifyQueue(): Promise<Record<string, any> | null>;
    /** A HUD line to everyone, 1..200 bytes. Cannot report a recipient count — the fan-out happens
     *  inside the game mode. */
    announceAll(text: string): Promise<BridgeCommandResult>;
    /** The same with the game's alert sound. Needs the module's `sound` switch as well. */
    alertAll(text: string): Promise<BridgeCommandResult>;
    /**
     * The same banner, to everyone. **THIS ALWAYS REFUSES too** — see `warn()` for why.
     *
     * Worth knowing: the refusal comes BEFORE the banner switch on the notifications card is
     * consulted. That is deliberate. Reporting "switched off" would send an owner to a setting that
     * changes nothing, and they would turn it on and try again.
     *
     * `bannerAll()` and `warn()` are the only two calls in this whole interface that cannot work.
     * For a broadcast that reaches everybody, use `killFeedAll()` or ordinary chat.
     */
    bannerAll(seconds: number, colour: string, text: string): Promise<BridgeCommandResult>;
    /**
     * Write one line into a player's kill feed.
     *
     * The three text parts travel separated by PIPES — the only place in the whole bridge that is
     * true, because a colon inside free text cannot be told from a separator. This wrapper joins
     * them, so **none of the three may itself contain a `|`**: the module refuses a line with more
     * than three parts rather than guessing where the split was meant. `prefix` and `suffix` may be
     * empty, `name` may not, and each is at most 64 bytes.
     */
    killFeed(steamId: string, prefix: string, name: string, suffix: string,
             ping?: boolean): Promise<BridgeCommandResult>;
    /** The same line to everyone online. Refused when nobody is. */
    killFeedAll(prefix: string, name: string, suffix: string, ping?: boolean): Promise<BridgeCommandResult>;

    // -- more things to do to one player ---------------------------------------------------------
    // All of these ride the same per-player route as `revive()` and `godMode()` above, so they share
    // its rules: the player has to be online and spawned in, and a `true` means the game accepted
    // the call, not that you can see the result.

    /** Take a player out of their squad, server-side. They do not have to agree, or be looking. */
    squadQuit(steamId: string): Promise<BridgeCommandResult>;
    /** Drop whatever they are holding onto the ground. */
    disarm(steamId: string): Promise<BridgeCommandResult>;
    /** Get them out of a vehicle, a bed, a chair - whatever they are sitting in. */
    unmount(steamId: string): Promise<BridgeCommandResult>;
    /** Free look on or off - whether they can turn their head without turning their body. */
    freeLook(steamId: string, on: boolean): Promise<BridgeCommandResult>;
    /** How tight their handcuffs are. Higher hurts more and does damage over time. */
    setCuffTightness(steamId: string, value: number): Promise<BridgeCommandResult>;
    /** Which limbs the cuffs are on. */
    setCuffPart(steamId: string, part: 'hands' | 'feet'): Promise<BridgeCommandResult>;
    /** The character's gender, as the game models it. */
    setGender(steamId: string, gender: string): Promise<BridgeCommandResult>;
    /** How they move - walking, running, and the speeds between. */
    setPace(steamId: string, pace: string): Promise<BridgeCommandResult>;
    /**
     * Show a different name over their head and in the kill feed.
     *
     * It changes what OTHERS see, not who the player is: nothing about their account, their squad
     * or their database rows moves with it. Useful for an event; misleading if left on by accident.
     */
    setFakeName(steamId: string, name: string): Promise<BridgeCommandResult>;
    /** Make them vomit. `natural` asks the game for its own reason rather than forcing it. */
    vomit(steamId: string, natural?: boolean): Promise<BridgeCommandResult>;
    /** The other end of the same idea. */
    urinate(steamId: string, natural?: boolean): Promise<BridgeCommandResult>;
    /** As above; `diarrhea` picks the unpleasant variant. */
    defecate(steamId: string, diarrhea?: boolean): Promise<BridgeCommandResult>;
    /** A cough. `intensity` is 0..1 and decides how loud it is - which is how far it carries. */
    cough(steamId: string, intensity?: number): Promise<BridgeCommandResult>;
    /** A sneeze, same scale. Both give away a hiding player, which is usually the point. */
    sneeze(steamId: string, intensity?: number): Promise<BridgeCommandResult>;
    /** Fade their screen to black and back over `seconds`. A scene transition, not a punishment. */
    fade(steamId: string, seconds?: number): Promise<BridgeCommandResult>;
    /**
     * Blow their head off. `keepHeadgear` leaves the helmet where it was.
     *
     * Fatal and immediate. There is no undo, and nothing asks the player first.
     */
    detonateHead(steamId: string, keepHeadgear?: boolean): Promise<BridgeCommandResult>;
    /** Put the spawn-selection screen in front of them. `withLoadout` includes the gear choice. */
    showSpawnScreen(steamId: string, withLoadout?: boolean): Promise<BridgeCommandResult>;
    /** How long the suicide hold takes for this player, in seconds. */
    setSuicideTime(steamId: string, seconds: number): Promise<BridgeCommandResult>;
    /** Hand a player back control of their own character after something else took it. */
    repossess(steamId: string): Promise<BridgeCommandResult>;
    /** Ask the game to load this player's character. Rarely what you want; occasionally the only thing that is. */
    loadPlayer(steamId: string): Promise<BridgeCommandResult>;
    /** One kill-feed line to one player. The same three parts and the same pipe rule as `killFeed()`. */
    killFeedTo(steamId: string, prefix: string, name: string, suffix: string,
               ping?: boolean): Promise<BridgeCommandResult>;

    // -- money, gold and fame that OUTLIVE the session -------------------------------------------
    // The ordinary setters change the running character. These three go to the stored row instead,
    // so the value survives a restart - and so a mistake survives one too. There is no undo beyond
    // writing the old number back, and you have to have read it first.

    setMoneyPersistent(steamId: string, amount: number): Promise<BridgeCommandResult>;
    setGoldPersistent(steamId: string, amount: number): Promise<BridgeCommandResult>;
    setFamePersistent(steamId: string, amount: number): Promise<BridgeCommandResult>;

    /**
     * The same action to EVERYONE online at once.
     *
     * Only a handful of verbs accept this - the ones where "all of them" is a sensible thing to
     * mean. Anything else is refused rather than quietly applied to one player. It is exactly as
     * irreversible as the single-player form, multiplied by however many people are logged in, so
     * read the single-player documentation for the verb before reaching for this.
     */
    actAll(verb: string, value?: string | number | boolean): Promise<BridgeCommandResult>;

    // -- weather, in more detail than `setWeather()` offers ---------------------------------------
    // The plain climate calls cover what most things want. These reach the machinery underneath:
    // the values the weather is built from, the ranges it rolls inside, and the curves it follows
    // between them. Reading is free; writing here changes how the weather BEHAVES rather than what
    // it currently is, which is the difference between making it rain and making it a rainy island.

    /** Every value the weather system currently holds. */
    climateMembers(): Promise<any>;
    /** The ranges each channel rolls its next value inside. */
    climateRolls(): Promise<any>;
    /** The curves it follows moving from one value to the next. */
    climateCurves(): Promise<any>;
    /** Set a multi-part value (a colour, a direction) in one call. */
    setClimateVector(key: string, ...values: number[]): Promise<BridgeCommandResult>;
    /** The same, and hold it there against the system's own next roll. */
    pinClimateVector(key: string, ...values: number[]): Promise<BridgeCommandResult>;
    /** One part of a multi-part value, leaving the rest alone. */
    setClimateComponent(key: string, component: string | number, value: number): Promise<BridgeCommandResult>;
    /** Move one point on one curve - the gentlest way to make a change stay. */
    setClimateCurveKey(curve: string, index: number, value: number): Promise<BridgeCommandResult>;
    /** Narrow (or widen) one stage of one channel's roll range. */
    setClimateRollStage(channel: string, index: number, value: number): Promise<BridgeCommandResult>;
    /** Stop or restart the weather simulation itself. Stopped, nothing rolls and nothing drifts. */
    setClimateSimulation(on: boolean): Promise<BridgeCommandResult>;
    /** Stop or restart the passage of in-game time. */
    setClimateClock(on: boolean): Promise<BridgeCommandResult>;

    // -- more to read -----------------------------------------------------------------------------
    // Read-only, every one of them. Each needs its own module switched on, and each returns `null`
    // rather than an empty answer when it is not - so "nothing there" and "not turned on" stay
    // different things.

    /** What the creature reader knows how to report, so you can ask for the right thing. */
    creatureFields(): Promise<any>;
    /** What is inside one base, by base id. */
    baseContents(baseId: string | number): Promise<any>;
    /** Every base the building system knows about. */
    buildBases(): Promise<any>;
    /**
     * Teach the building catalogue one class, proved rather than assumed.
     *
     * The catalogue's other routes both need the class to have been USED — one watches the game
     * build something, the other reads what is already standing. On a fresh server with nothing
     * built on it neither can fire, so `spawnElement()`, which refuses a class the catalogue has not
     * seen, was unusable until somebody built the thing by hand first.
     *
     * This asks the engine whether the path really descends from the game's own base-building
     * component. A path that resolves to something else is refused, and the catalogue records how
     * each entry got there, so one added this way stays distinguishable from one the game showed.
     *
     * `path` is the full class path exactly as `buildCatalogue()` reports it. One field: a class
     * path contains no colon, so anything after it is refused rather than ignored.
     */
    buildLearn(path: string): Promise<BridgeCommandResult>;
    /** The catalogue of things a base can be built from. */
    catalogueElements(): Promise<any>;
    /** The game's own kill registry, as the running world holds it. */
    prisonerKillRegistry(): Promise<any>;
    /** The same registry, narrowed to one player. */
    killRegistryBySteamId(steamId: string): Promise<any>;
    /**
     * Remove ONE entry from the game's own kill registry — the write half of `killRegistry()`.
     *
     * One at a time, and there is no clear-everything form at any setting. That asymmetry is
     * deliberate: removing an entry an admin has ruled on is a correction, adding one would be a
     * fiction, so the game's matching add call is not exposed at all.
     *
     * Every rejection happens before anything is sent, so a refusal means nothing moved, and it
     * re-reads the registry afterwards — `true` here is verified, not merely dispatched. Not
     * established: whether the mark a player sees on their own screen clears with it.
     */
    forgiveKill(profileId: number): Promise<BridgeCommandResult>;
    /** Which bases the encounter system has flagged, and how. */
    encounterBaseFlags(): Promise<any>;
    /** The raid-protection manager's own state. */
    protectionManager(): Promise<any>;
    /** What has CHANGED in raid protection since the last look - begins and lapses, not a snapshot. */
    protectionDelta(): Promise<any>;
    /** Raid announcements the game has made. */
    raidAnnouncements(): Promise<any>;
    /** Raids the encounter system is tracking. */
    raidEncounters(): Promise<any>;
    /** Server settings that have been changed and not yet taken effect. */
    outstandingSettings(): Promise<any>;
    /** Point a player's quest tracker at a quest or one of its tasks. */
    trackQuest(steamId: string, id: string | number, kind?: 'quest' | 'task'): Promise<BridgeCommandResult>;

    // ── where new players arrive ─────────────────────────────────────────────────────────────────

    /**
     * Every authored start location with its index, position, type flags and whether it is off.
     *
     * A point whose position could not be read is ABSENT and counted under `unreadable`, never
     * reported at 0,0,0 — which is a real place on this map, in the sea, and would send someone
     * swimming. `count` is the array length and is deliberately not the length of `points`.
     */
    spawnPoints(): Promise<Record<string, any> | null>;
    /** The map's own bounds, elevation limits and spawn altitudes. */
    spawnMap(): Promise<Record<string, any> | null>;
    /** Respawn prices, currencies and cooldowns, grouped the way the spawn menu shows them. */
    respawnSettings(): Promise<Record<string, any> | null>;
    /**
     * Switch one authored spawn point off or on, by the index `spawnPoints()` reported.
     *
     * There is deliberately **no coordinate form**: a coordinate that misses by a few metres picks a
     * DIFFERENT spawn point, and the mistake is invisible until players start arriving somewhere
     * nobody chose. Turning off the last enabled player spawn is REFUSED, not clamped.
     *
     * **Whether the game re-reads this array when it picks a spawn, or caches it at level load,
     * cannot be established from inside the process.** Try it on a spare server before a live one.
     * Nothing here persists a restart either.
     */
    setSpawnPointEnabled(index: number, on: boolean): Promise<BridgeCommandResult>;

    // ── the animal, shark and fish population ────────────────────────────────────────────────────
    //
    // **Nothing here persists.** Not one population field carries replication or save markers, so
    // every value returns to what the blueprint shipped on the next restart. Whether the running
    // server picks a change up at all cannot be known from a header either, so every write arms a
    // re-read about 2.5 seconds later and records whether the value HELD or was REVERTED.

    /** How many animals, sharks and fish schools exist right now, by species. A species with none
     *  alive is ABSENT from the map, not `0`. **Answer on demand, never on a timer** — a census walks
     *  every creature on the server. */
    wildlifeCensus(): Promise<Record<string, any> | null>;
    /** Every population knob with its value, range, whether it needs a confirmation, and — when the
     *  class default resolved — whether it has MOVED from what the blueprint shipped, which is the
     *  only static evidence that the game itself writes to it. */
    wildlifeLimits(): Promise<Record<string, any> | null>;
    /** Per-biome animal density. **The species MIX is unreachable** — it lives in a set type the
     *  engine layer has no reader for — and the payload says so in words rather than omitting it. */
    wildlifeBiomes(): Promise<Record<string, any> | null>;
    /** The aquatic manager, shark species and the fishing volumes. */
    wildlifeWater(): Promise<Record<string, any> | null>;
    /** Fish species, spawning presets and their weights. */
    wildlifeFish(): Promise<Record<string, any> | null>;
    /**
     * Set one population knob — `animalMax`, `sharkMax`, `schoolMax`, `spawnDistance` (centimetres),
     * `corpseLifetime` (minutes) and the rest; `wildlifeLimits()` names them all with their ranges.
     *
     * Out of range is REFUSED, never clamped. Six of the keys can empty or flood the map and require
     * `confirm: true`; the module refuses without it where it is needed, which is the safe direction.
     */
    setWildlifeLimit(key: string, value: number, confirm?: boolean): Promise<BridgeCommandResult>;
    /**
     * Set a biome's animal density, in animals per square metre, 0..1000. `biome` is the tag or asset
     * name exactly as `wildlifeBiomes()` reports it — **never an index**; `slot` is 0 or 1.
     *
     * **This writes a SHARED DATA ASSET**: one biome asset is used by every region that references
     * it, so the blast radius is not something the caller picks. Behind its own `assets` switch.
     */
    setBiomeDensity(biome: string, slot: 0 | 1, value: number): Promise<BridgeCommandResult>;
    /** Set one species' spawning weight inside one preset, 0..1000. Also a shared asset — one preset
     *  is used by every volume pointing at it. */
    setFishWeight(preset: string, species: string, value: number): Promise<BridgeCommandResult>;

    // ── watching raid protection ─────────────────────────────────────────────────────────────────
    //
    // Read-only by design — **to CHANGE a flag's window use `setProtection()` / `resetProtection()`**.
    // This family watches, so a rule can react to a window opening or lapsing rather than polling.
    //
    // The load-bearing rule of the whole feature: `[]` means nothing is protected, a failure means the
    // question could not be answered, and code that confuses them lets somebody raid a protected base.
    // A census that fails produces a recorded GAP and touches nothing — treating an unreadable list as
    // an empty one would announce that every protected base on the server had just lapsed.

    /** Which raid-protection mode the server is in, read TWO independent ways, with `agrees` when both
     *  are known. */
    protectionMode(): Promise<Record<string, any> | null>;
    /** The server's raid-protection settings, as the game's own text. Ten reflected calls — meant to
     *  be asked rarely. A setting that could not be read is absent, never blank. */
    protectionRules(): Promise<Record<string, any> | null>;
    /** The protection list as the last census saw it, with each flag's raw packed change stamp. */
    protectionState(): Promise<Record<string, any> | null>;
    /** Protection windows that began, lapsed or changed since the module started watching — plus
     *  `gap` entries where a census could not be taken, and a change on the far side of a gap may
     *  have happened at any point inside it. Memory only: gone on a restart. */
    protectionChanges(): Promise<Record<string, any> | null>;
    /** Protection RPCs seen going past — what was ASKED FOR, before the game handled it, which is not
     *  the same as a confirmed change. */
    protectionRequests(): Promise<Record<string, any> | null>;
    /** One flag. `sinceMs` is present **only** when the module actually witnessed the protection
     *  begin — "protected since the bridge started looking" is not a start time, and `sinceObserved`
     *  says which of the two you have. */
    flagProtectionState(flagId: number): Promise<Record<string, any> | null>;
    /** Run the census now instead of waiting for the poll. This is a read, not a write. */
    recheckProtection(): Promise<BridgeCommandResult>;
    /** Discard the change log and the baseline. **No undo.** */
    forgetProtectionHistory(): Promise<BridgeCommandResult>;

    // ── levels and streaming ─────────────────────────────────────────────────────────────────────
    //
    // Level names are not English — bunkers, mines and the underground airbase all have asset names
    // that no amount of guessing arrives at, which is what `findLevels()` exists for.
    //
    // **Nothing here may be polled**: every whole-world verb costs a walk of the object array, and a
    // polled walk is a frame-time bill every player pays forever. The LIST verbs never report
    // visibility while `level()` does — visibility is packed into a bitfield a byte-wide reader would
    // answer `true` for on every level, forever, with no error anywhere, so it is only ever taken
    // from the game's own accessor.

    /** How many streaming levels this map has and how many are loaded. `worldSource` says whether the
     *  world was identified from the game mode (decisive) or inferred (not). */
    worldSummary(): Promise<Record<string, any> | null>;
    /** The level list. `matched` and `returned` are separate keys on purpose, and `truncated` (the
     *  walk hit its ceiling) is a different fact from `listCapped` (the list was cut to the
     *  configured limit) — a caller that confuses them believes it has seen the whole map. */
    levels(filter?: 'all' | 'loaded' | 'unloaded'): Promise<Record<string, any> | null>;
    /** Every level whose name contains `text`, case-insensitively. The right first call before
     *  guessing at a level name. */
    findLevels(text: string): Promise<Record<string, any> | null>;
    /**
     * One level in full — loaded, visible, pending, its package and what it contains.
     *
     * `known: false` and NO `known` key at all are different answers: the second means the lookup
     * could not be MADE, and only the first means a spawn there is pointless.
     */
    level(name: string): Promise<Record<string, any> | null>;
    /** The world's own managers. `{ present: true }` with no count means "there, and its table could
     *  not be read", which is not `{ present: false }`. */
    worldManagers(): Promise<Record<string, any> | null>;
    /** The distant-level descriptions and their draw distances. */
    distantLevels(): Promise<Record<string, any> | null>;
    /**
     * Ask the game to stream a level in.
     *
     * **This cannot claim the level arrives.** What is proved: the level is known to the world, the
     * request did not fault, and the game ACCEPTED it. What is not provable from inside the process
     * is that it actually loads — the game runs its own streaming logic and may reverse the request
     * within a frame. Call `level(name)` a moment later; that is how anybody finds out.
     *
     * There is no unload at any setting: a level taken away under a player is not recoverable.
     */
    streamLevel(name: string): Promise<BridgeCommandResult>;

    // ── barricades over windows and doorways ─────────────────────────────────────────────────────
    //
    // **NOT base building.** A fortification is what a player nails over a window or a doorway. Base
    // walls are `buildElements()` / `baseBuilding()`, a different module entirely.
    //
    // There are two routes here and they are never blended, because they answer different questions.
    // The WALK sees every barricade standing right now — including ones built long before the bridge
    // started — and knows NO owner, because a live barricade component does not carry one. The LEDGER
    // is built from the announcements the game makes as barricades go up, change and come down, and is
    // the ONLY route to who built one: a fact that is unrecoverable afterwards.
    //
    // **Nothing here writes to the game**, and each refusal names its own reason: the five
    // announcements tell clients about a change the server has already made; the authoritative destroy
    // is a method on a player drone that exists only while somebody is flying one; and the health on a
    // live barricade is neither replicated nor saved, so writing it would change what this server
    // believes until the next save and nothing any player can see.
    //
    // **None of it has run on a live game.** The walk has never been observed returning a barricade,
    // and whether the ledger fills itself in again after a restart is unknown.

    /**
     * Every barricade standing right now: `type`, position, `health`, and `freshHealth` — what one of
     * THAT type starts with (there is no maximum on the instance). Also what it is nailed to.
     *
     * **Returns `null`, never `[]`, when the walk could not be made.** An empty array is a claim about
     * the server, and "nobody has barricaded anything" and "the object list could not be read" are
     * different answers.
     *
     * **No owner.** If you need who built it, that is `fortificationsByOwner()`, and only for
     * barricades this module was running to watch.
     *
     * Needs the `fortifications` module and its `sweep` switch; the module's own `detail` switch adds
     * toughness and the repair figures.
     */
    fortifications(): Promise<{ source: 'sweep'; sweepUnreadable?: boolean; truncated?: boolean;
                                fortifications?: Array<Record<string, any>>; count?: number } | null>;
    /**
     * The same walk, filtered to a sphere — the raid-report shape. **All four numbers are required**
     * and are centimetres; the radius is capped at 100000 and an over-large one is REFUSED rather than
     * trimmed.
     */
    fortificationsNear(x: number, y: number, z: number, radius: number):
        Promise<{ source: 'sweep'; sweepUnreadable?: boolean; truncated?: boolean;
                  near?: { x: number; y: number; z: number; radius: number };
                  fortifications?: Array<Record<string, any>>; count?: number } | null>;
    /**
     * What this module has watched happen, per fortifiable opening — and who owns each barricade.
     *
     * `onlyWhatWasWatched` is on every reply and means what it says: this covers what happened while
     * the module was running, not what is standing. `watchingForMs` says how long that has been.
     * Whether the game replays existing barricades when a player streams in — and therefore whether
     * this fills in after a restart — is **not established**.
     *
     * It also carries three counters that settle an open question. Nothing in the game's headers says
     * whether a destroy announcement's position is relative or in world space, so the module tries
     * both readings and counts which matched. **One broken barricade on a live server moves exactly
     * one counter and answers it permanently.**
     *
     * Needs the `fortifications` module and its `ledger` switch.
     */
    fortificationLedger(): Promise<{ openings: Array<Record<string, any>>; openingCount: number;
                                     barricadeCount: number; watchingForMs: number;
                                     onlyWhatWasWatched: true;
                                     destroyMatchedAsRelative: number; destroyMatchedAsWorld: number;
                                     destroyUnmatched: number } | null>;
    /** Every barricade the ledger attributes to one profile id — the game's own profile number, not a
     *  Steam ID. The question this module exists for, and the walk cannot answer it. */
    fortificationsByOwner(profileId: number):
        Promise<{ owner: number; barricades: Array<Record<string, any>>; count: number;
                  onlyWhatWasWatched: true } | null>;
    /** The recent barricade events, newest first, with how long ago each was: `add`, `addMany`,
     *  `update`, `destroy`, `removeAll`. A short bounded window, not an audit trail — nothing is
     *  written to disk and a restart clears it. Needs the module's `events` switch. */
    fortificationEvents(): Promise<{ events: Array<Record<string, any>>; count: number;
                                     window: number; droppedEvents?: number } | null>;
    /**
     * Clear this module's own memory of what it watched. **Nothing in the game changes.**
     *
     * The literal `true` is required and the SDK refuses without it: the ledger is the only route to
     * who built a barricade, and that fact cannot be recovered once it is dropped.
     */
    forgetFortifications(confirm: true): Promise<BridgeCommandResult>;

    // ── an explosion at a point on the map ───────────────────────────────────────────────────────
    //
    // **The most destructive thing in this interface.** It can kill players, flatten what people
    // built and delete vehicles, and nothing puts any of it back.
    //
    // It lives in its own module rather than beside the map oracle, deliberately: that module's own
    // promise is "it only answers", and hiding this behind a switch somebody turned on to ask
    // whether a crate would sink would take that promise away without saying so.
    //
    // **Nothing here has been fired on a live server.** In particular it is NOT established that the
    // game takes the blast origin from the coordinate rather than from the caller — which would put
    // every explosion at the world origin with nothing anywhere saying so. Preview first, on a
    // server you can restart.

    /**
     * Set off an explosion at a coordinate. `radiusCm` is centimetres; both it and `damage` are
     * capped by the owner and an over-large one is REFUSED, never quietly shrunk.
     *
     * **`true` means ACCEPTED, not done.** The game's call returns nothing, so nothing can confirm
     * the blast from the call itself. What the module does instead is read the health of everything
     * it can see in the blast immediately before and after; `damageLast()` then reports one of three
     * answers — something lost health, witnesses were read and none moved, or nothing could be read
     * back at all. Ask it if you need to know.
     *
     * `false` is the wire's word for REFUSED, so every refusal happens before the call and the call
     * is the last thing on the path: a caller told "refused" for a blast that went out would fire it
     * again.
     *
     * The confirmation is **not synthesised here**. The literal `'CONFIRM'` is required, because a
     * confirmation a wrapper supplies on your behalf confirms nothing. Players are a second gate
     * again: `players: true` sends a second literal word, and without it a blast with anybody inside
     * it is refused — as is one that cannot tell, because an unreadable position and a truncated
     * sweep both count as "there is somebody in there".
     *
     * **Unverified on a live game.** Call `damagePreview()` first.
     *
     * Needs the `damage` module on and its `explode` switch on beneath it.
     */
    explodeAt(x: number, y: number, z: number, radiusCm: number, damage: number,
              opts: { confirm: 'CONFIRM'; players?: boolean }): Promise<BridgeCommandResult>;
    /**
     * What an explosion at that point would catch, without setting one off.
     *
     * Runs the same guards in the same order as the verb, so `wouldFire: false` with `wouldRefuse`
     * is the answer the verb would give. Use it before the first real one — and before every one
     * that matters. Needs only the `damage` module, not its blast switch: deciding *whether* to fire
     * should not require arming the thing first.
     */
    damagePreview(x: number, y: number, z: number, radiusCm: number):
        Promise<{ x: number; y: number; z: number; radiusCm: number;
                  players: number; puppets: number; animals: number; vehicles: number;
                  nearestPlayerCm?: number;
                  playersCountedUnread?: number; vehiclesCountedUnread?: number;
                  playerListTruncated?: true; vehicleListTruncated?: true;
                  creatureListTruncated?: true;
                  playerSteamIds?: string[];
                  wouldFire: boolean; wouldRefuse?: string; needsPlayersWord?: true } | null>;
    /**
     * What became of the last blast — **the only confirmation that exists**, because the game's own
     * call says nothing.
     *
     * `confirmed: true` means something standing in the blast lost health in the same frame.
     * `confirmed: false` with `witnessesReRead > 0` means witnesses were read and none moved: the
     * effect may be deferred, blocked or absent and this cannot tell which. `confirmed: false` with
     * none re-read means nothing in the blast could be read back at all. `meaning` says which in
     * words. A refused call does not replace the record, which is why `ageMs` is here.
     */
    damageLast(): Promise<{ x: number; y: number; z: number; radiusCm: number;
                            innerRadiusCm: number; damage: number; falloff: number; force: number;
                            eventDamage: boolean; playersInBlast: number; puppetsInBlast: number;
                            animalsInBlast: number; vehiclesInBlast: number;
                            dispatched: boolean; confirmed: boolean; meaning: string;
                            witnessesWatched?: number; witnessesReRead?: number;
                            witnessesChanged?: number; largestHealthDrop?: number;
                            ageMs: number } | null>;

    /**
     * The game's own ordered cooking-recipe table.
     *
     * **It ships the TABLE, not a joined name.** A dish's id on the wire is a number, and whether
     * that number indexes this table is settled everywhere except one place: entries carry an
     * `enabled` flag, so the index could be into the enabled subset instead. Those two readings are
     * identical while every entry is enabled and diverge silently otherwise — which is exactly what
     * `allEnabled` reports, and why naming a dish from an assumed index is not done for you. Cooking
     * two dishes you can identify settles it.
     *
     * Static design data, so it is cached after the first success — but a failure is never cached
     * and neither is a truncated table. `asset` and `enabled` are each omitted when that column did
     * not resolve; `allEnabled` is absent when there is no flag column to judge. Read-only, needs
     * the `craft` module, and it refuses with a reason while the world is still loading.
     */
    cookRecipes(): Promise<{ entries: Array<{ index: number; asset?: string; enabled?: boolean }>;
                             count: number; truncated?: true; allEnabled?: boolean } | null>;

    // ── asking the game about a squad, rather than reading its rows ──────────────────────────────
    //
    // These are REQUEST-then-READ pairs. The game answers frames later on its own schedule, so the
    // command means "asked", never "answered", and the reader is a separate call whose reply carries
    // `ageMs` so you can tell a fresh answer from a stale one.
    //
    // **No Steam ID appears in any of these replies.** The one field that could carry one is a byte
    // blob in a format nothing in the game describes, so identity here is the profile id and the
    // account behind it is the manager's own database join.

    /** Ask the game for a squad's member list. Read it back with `squadMembers()` a moment later.
     *  It travels through an online player, so somebody has to be on the server. */
    squadMemberInfo(squadId: number): Promise<BridgeCommandResult>;
    /**
     * The member list, if one has arrived — profile ids, names and fame, with `ageMs`.
     *
     * A squad that never answers is reported as "not yet", **not** as a failure: whether the game
     * answers at all for a squad the asker is not a member of is not established, and those two look
     * identical from here. `count` is how many the game sent and `members` is as many as fitted;
     * `truncated` says when they differ. Fame is the number the game sends and its scale is not
     * established anywhere.
     */
    squadMembers(squadId: number):
        Promise<{ squadId: number; ageMs: number; count: number;
                  members: Array<{ profileId?: number; name?: string; nameTruncated?: true;
                                   fame?: number }>;
                  truncated?: true; note: string } | null>;
    /**
     * Ask the game for the squad leaderboard. Read it back with `squadLeaderboard()`.
     *
     * Both arguments are optional; an absent one leaves its field off entirely rather than sending a
     * placeholder the module would read as a value. Pass `squadId` to have the reply also carry that
     * squad's own rank.
     */
    squadLeaderboardRefresh(count?: number, squadId?: number): Promise<BridgeCommandResult>;
    /**
     * The squad leaderboard, if one has arrived.
     *
     * The leaderboard identifies a squad by **name and nothing else** — no id comes back with it, so
     * joining a row to a squad means matching the name, and two squads may share one. `position` is
     * the order the game sent them in. `squadRank` / `squadIndex` answer for `forSquadId` and not
     * for the list.
     */
    squadLeaderboard():
        Promise<{ ageMs: number; asked: number; count: number;
                  squads: Array<{ position: number; name?: string; nameTruncated?: true;
                                  information?: string; informationTruncated?: true;
                                  score?: number }>;
                  truncated?: true; forSquadId?: number; squadRank?: number; squadIndex?: number;
                  note: string } | null>;
    /**
     * Squads the game has announced as destroyed, newest kept in a bounded live buffer.
     *
     * **An empty list is ambiguous and the reply says so.** Whether the game's own destruction
     * handler is reached the way this watches for it is an inference from its shape, not something
     * anybody has observed — so "no squad was ever destroyed" and "the watch never fires" look
     * identical here. Treat a long empty list on a busy server as the second one. An entry with no
     * `squadId` is a real destruction whose squad could no longer be named, which is different from
     * one that had no name. Not a log: it starts empty after a restart.
     */
    squadsDestroyed(): Promise<{ kept: number; held: number;
                                 destroyed: Array<{ squadId?: number; name?: string;
                                                    ageMs: number }>;
                                 note: string } | null>;

    /**
     * Ask the game for a ranked leaderboard — the one answer the stats module could not give, since
     * everything else there answers about one player at a time. It needs no profile id.
     *
     * It is a REQUEST, not a read: the answer arrives separately, so call this and then read
     * `statsRanking()`. All three arguments are optional (10, by fame, highest first). `count` is
     * 1–50; `sortBy` and `order` are words from `statsRankingWords()`, read out of the running build
     * rather than hard-coded, so a game update that adds a sort order needs no new manager.
     *
     * Needs the `stats` module on and `ranking` on beneath it.
     */
    requestStatsRanking(count?: number, sortBy?: string, order?: string):
        Promise<BridgeCommandResult>;
    /**
     * The ranked leaderboard, if one has arrived.
     *
     * **Three outcomes are kept apart on purpose.** `received: false` with `rows: null` means nothing
     * was ever asked for, or nothing has decoded yet — `waiting` says which. `received: true` with
     * `rows: []` means the game answered and nobody is ranked. Those are different claims. On a build
     * where the ranking is wired only to game events the first is what you get, and **it is not a
     * fault**. Over 50 rows sets `truncated`.
     */
    statsRanking(): Promise<{ received: boolean; rows: Array<Record<string, any>> | null;
                              waiting: boolean; hint?: string; ageMs?: number;
                              sortBy?: string; order?: string; asked?: number; truncated?: boolean;
                              askedFor?: number; playerRank?: number } | null>;
    /**
     * The words `requestStatsRanking()` will accept, read out of the running build's own enums.
     *
     * `fromEngine` says whether a word was resolved against the build or is this build's fallback —
     * which is the difference between a vocabulary and a guess.
     */
    statsRankingWords(): Promise<{ maxRows: number;
                                   sortBy: Array<{ word: string; game: string; value: number;
                                                   fromEngine: boolean }>;
                                   order: Array<{ word: string; game: string; value: number;
                                                  fromEngine: boolean }> } | null>;

    /**
     * What happened the last time an item was destroyed out of a container — an **instrument, not a
     * feature.**
     *
     * There is an open question nobody could settle from the game's own headers: whether destroying
     * the last item in a chest leaves the container still believing it holds something. So every
     * destroy records how many items were in there beforehand and the container's own "has entries"
     * flag before and after. **`heldBefore: 1` with `hadEntriesAfter: true` IS that ghost, on the
     * record, from one command.** Destroy the last item out of a chest and read this; that is the
     * whole measurement.
     *
     * A flag that could not be read is ABSENT rather than reported as false — "the container says it
     * still has entries" and "this build does not expose that" are the two answers this exists to
     * tell apart. Two honest caveats: the flag is replicated state the game may rebuild on its own
     * schedule, so an unchanged reading is "it did not move yet" and not proof either way; and it
     * says nothing about a weight cached somewhere the bridge cannot see.
     */
    lastContainerDestroy(): Promise<{ made: boolean; hint?: string; ageMs?: number;
                                      container?: number; item?: number; class?: string;
                                      heldBefore?: number; hadEntriesBefore?: boolean;
                                      hadEntriesAfter?: boolean } | null>;
  };

  discord: {
    /** The entire discord.js module (EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, …). */
    readonly js: any;
    client(): any | null;
    enabled(): boolean;
    /** The admin's configured live-embed image URLs (any may be null). */
    liveEmbedImages(): { status: string | null; players: string | null; bunker: string | null; leaderboard: string | null; economy: string | null };
    embed(): any;                                                                        // discord.js EmbedBuilder
    /**
     * The footer the manager stamps on its OWN embeds — the owner's Discord branding, or the SSA
     * defaults when premium branding is off. Feed it to `setFooter()` so your embeds read as the
     * same bot instead of inventing a second identity.
     *
     * The field names are discord.js's own: `{ text, iconURL }`, not `{ name, icon }`.
     */
    branding(): { text: string; iconURL: string | null } | null;
    button(o?: { id?: string; label?: string; style?: number; url?: string; emoji?: string; disabled?: boolean }): any;
    row(...components: any[]): any;                  // ActionRowBuilder
    channel(id: string): Promise<any | null>;
    /**
     * Post to a channel. payload: string | EmbedBuilder | EmbedBuilder[] |
     * `{ content, embeds, components, files, allowedMentions }`.
     *
     * Resolves to the sent Message, or to **`false`** when the bot is off, the channel cannot be
     * fetched or Discord refused it. It does not throw, so a try/catch around it sees nothing —
     * check the return before you log the thing as sent.
     *
     * The manager's branded footer and a timestamp are stamped onto the FIRST embed of the message,
     * exactly as on its own embeds, so a plugin's post sits next to them without looking foreign.
     */
    send(channelId: string, payload: any): Promise<any | false>;
    /** Direct-message a user. Resolves to the Message, or `false` — a closed DM is not an error. */
    dm(userId: string, payload: any): Promise<any | false>;
    onMessage(fn: (message: any) => void): () => void;
    onInteraction(fn: (interaction: any) => void): () => void;
    onButton(customId: string | RegExp, fn: (interaction: any) => void): () => void;
    onSelect(customId: string | RegExp, fn: (interaction: any) => void): () => void;
    /**
     * Register a slash command and its handler. Guild-scoped when the owner configured a guild
     * (instant), global otherwise (visible everywhere, and up to an hour late). `false` when the
     * bot is not ready.
     */
    registerSlash(data: any, handler?: (interaction: any) => void): Promise<boolean>;
    /**
     * The channel ids the OWNER configured, by role — not a listing of the channels the bot can
     * see. Any role the owner left unset is simply absent, so test for the key rather than for an
     * empty string.
     */
    channels(): Partial<Record<'admin' | 'players' | 'status' | 'playersEmbed' | 'bunkers'
                            | 'leaderboards' | 'economy' | 'accountLinking', string>>;
    /** Add/modify fields on the manager's own embeds. fn may mutate or return an EmbedBuilder. */
    onEmbed(kind: EmbedKind, fn: (embed: any, ctx: any, kind: EmbedKind) => any): void;
    /**
     * Every styleable kind with the embed's REAL current shape. Use this instead of describing the
     * manager's layouts yourself — the real ones are translated, have conditional fields, and
     * format their values on the way out.
     */
    embedKinds(): EmbedKindInfo[];
    /** The last embed the manager really sent for one kind, or null if it hasn't sent one. */
    lastEmbed(kind: EmbedKind): { at: number; embed: EmbedKindInfo['sample']; ctx: any } | null;
    /**
     * Turn `:shield:` shortcodes into the glyph Discord will actually show.
     *
     * The send path does this anyway, so you only need it when you are RENDERING text yourself —
     * a preview that skips it does not look like the message it is previewing.
     */
    emojify(text: string): string;
  };

  /**
   * In-game chat + `/commands` via the SSA Bridge (Premium).
   *
   * These three are the ONE part of the SDK that fails by THROWING. `host.bridge.*` answers `null`
   * because a bridge that is off is the ordinary state on a free server; a chat line is a thing you
   * asked to happen, so it rejects instead — with `bridge_off`, `chat_failed` or the bridge's own
   * word. Never let that reach an event handler unawaited.
   */
  chat: {
    /**
     * Register a `/command`. The bridge hides the line in-game and it never reaches the Discord
     * relay or the Field Console; `ctx.reply()` answers the sender and nobody else.
     *
     * Command names are GLOBAL across plugins — if another installed plugin registers the same
     * name, the later registration wins and the earlier one silently stops working. And there is no
     * permission model: any player can type it, so check `ctx.steamId` yourself if it should be
     * restricted.
     */
    onCommand(name: string, handler: (ctx: ChatCommandCtx) => void | Promise<void>): () => void;
    /** Change the in-game command prefix (default `/`) for every plugin, not just yours. */
    setPrefix(prefix: string): void;
    prefix(): string;
    /** `targets` narrows delivery to those SteamIDs; `channel` only decides where it appears. */
    send(text: string, opts?: ChatOpts): Promise<{ channel: string; delivered: number }>;
    dm(steamId: string, text: string, opts?: ChatOpts): Promise<{ channel: string; delivered: number }>;
    broadcast(text: string, opts?: ChatOpts): Promise<{ channel: string; delivered: number }>;
  };

  /** Push a notification through the manager's own pipeline (Discord + admin realtime). */
  notify(type: string, data?: Record<string, any>): void;

  schedule: {
    every(ms: number, fn: () => void): () => void;
    after(ms: number, fn: () => void): () => void;
  };

  /**
   * Time windows — "from when to when is this available".
   *
   * One evaluator for every plugin, so a window means the same thing on every tab of the panel. Use
   * it for a happy hour, a weekend kit, a command that stops overnight, or a price that changes in
   * the evening (two plans, one windowed).
   *
   * **It runs on the SERVER'S WALL CLOCK, not the game's day/night cycle**, and every screen you
   * draw must say so — pass `describe()` straight through rather than composing your own caption.
   * The game has a time of day but no day of the week (so "weekend" is inexpressible), its day runs
   * at a configurable multiplier (so a two-hour window can recur five times a night), and it reads
   * from the last save (so it is unavailable while the server is stopped, which is exactly when
   * owners configure things).
   *
   * A schedule is an ARRAY of windows and is open when ANY of them is open. **An empty array is
   * always open**, which is what makes adding this to an existing plugin additive: a config with no
   * `windows` key behaves exactly as it did.
   *
   * Two edges worth knowing. `from` later than `to` crosses midnight and the window belongs to **the
   * day it starts**, so `{ days: [5], from: '22:00', to: '02:00' }` is Friday night running into
   * Saturday and is NOT open at 01:00 on Friday. And `from` equal to `to` is REFUSED rather than
   * guessed — it reads as "all day" to one person and "no time at all" to the next.
   *
   * Added in manager 5.3.0. Feature-detect it (`host.time && host.time.isOpen`); on an older manager
   * treat a window that IS configured as closed rather than ignoring it, so a happy-hour price
   * cannot quietly run all day.
   */
  time: {
    /** Open right now? `why` is a sentence you can show a player verbatim. */
    isOpen(schedule: TimeWindow[] | TimeWindow | null, at?: Date): {
      open: boolean;
      /** Why, in words — "open now — Fri 22:00–02:00…" or "available Mon–Fri 20:00–22:00 … in 2h". */
      why: string;
      opensInMinutes: number | null;
      closesInMinutes: number | null;
      /** Windows that could not be read. An unreadable window is treated as CLOSED. */
      invalid: string[];
    };
    /** Call before saving. `errors` name the problem in words an owner can act on. */
    validate(schedule: TimeWindow[] | TimeWindow | null): { ok: boolean; errors: string[] };
    /** The one sentence a screen shows. Render THIS; do not compose your own. */
    describe(schedule: TimeWindow[] | TimeWindow | null): string;
    /** What the manager's own clock says right now. */
    now(tz?: string): { unix: number; weekday: number; minutes: number; hhmm: string; tz: string | null; offset: string | null; label: string } | null;
    /** `{ tz, offset, label }` for a zone, or for this machine when `tz` is omitted. */
    zone(tz?: string): { tz: string | null; offset: string | null; label: string };
  };

  routes: RouteApi & { public: RouteApi };

  realtime: { toAdmins(event: string, payload: any): void };

  /** Read-only. Plugins cannot enable, disable or fake Premium. */
  premium: { active(): boolean };

  paths: { root: string; serverDir: string; appRoot: string };

  provide(name: string, api: any): void;
  consume<T = any>(name: string): T | null;

  onUnload(fn: () => void): void;
}

/**
 * Why a bridge call could not be answered.
 *
 *  • `bridge_off`  nothing answered at all — the bridge is off, not installed, unlicensed or timed
 *                  out. The ORDINARY state on a server without Premium: fall back, say nothing.
 *  • `no_module`   the bridge answered and has no module by that id — wrong id, or an older bridge.
 *  • `module_off`  the module is there and the owner has it switched off. Say so BY NAME in your UI.
 *  • `refused`     the module answered and said no. `reason` is its own sentence, or `null` when it
 *                  refused without saying why.
 */
export type BridgeFailureCode = 'bridge_off' | 'no_module' | 'module_off' | 'refused';

/**
 * The verbs `host.bridge.act()` accepts, grouped by the owner switch that gates them. Each family
 * is switched separately in the panel and **every family is off by default**, so assume a refusal
 * until an owner has turned yours on and say WHICH one in your UI.
 *
 * The `(string & {})` arm is there so a verb a newer bridge adds still type-checks; the listed ones
 * are what autocomplete offers. A verb this bridge does not know comes back as
 * `{ ok: false, code: 'refused' }` with the module's own words.
 */
export type BridgeActVerb =
  /** revive · life */
  | 'revive' | 'suicide' | 'suicidetime'
  /** currency · fame — the replicated mirror; `db*` go through the game's admin commands instead */
  | 'money' | 'gold' | 'fame' | 'dbmoney' | 'dbgold' | 'dbfame'
  /** flags */
  | 'godmode' | 'immortal' | 'ammo' | 'superjump'
  /** messages — `hud`, `warn`, `killfeed` and `fade` also accept the target `'all'` */
  | 'hud' | 'warn' | 'killfeed' | 'fade'
  /** kick */
  | 'kick'
  /** gear */
  | 'strip' | 'uncuff' | 'cuffpart' | 'cufftight' | 'nightvision' | 'limp' | 'limpclear'
  | 'disarm' | 'unmount' | 'freelook'
  /** squads */
  | 'squadjoin' | 'squadleave' | 'squadpromote' | 'squaddemote' | 'squadcreate' | 'squadquit'
  /** body · effects · naming · wetness */
  | 'gender' | 'pace' | 'vomit' | 'urinate' | 'defecate' | 'cough' | 'sneeze'
  | 'fakename' | 'wetness'
  /** the rest — check the bridge's own Actions settings for which switch each sits behind */
  | 'detonate' | 'repossess' | 'spawnscreen' | 'save' | 'load'
  | (string & {});

/**
 * What is inside a competitive event, per element of `worldEvents()`.
 *
 * `players` is the answer to "who is winning". The scores and the rankings were always there —
 * team 1 has 19, participant 4 came first — and until now nothing said who participant 4 IS.
 * Each entry carries the name, the id, the team, the state and the seven per-player figures.
 * Capped at 64 while `registered` keeps the real count, so a truncated list is visible rather
 * than quietly short. An entry that could not be read keeps its position rather than being
 * skipped, because `a` and `b` on an `event.kill` index into this list IN ORDER.
 *
 * `border` is the ring closing. The live radius and the one it is heading for are separate
 * fields, and the gap between them is the only way to see it moving — the marker radius already
 * reported is where the event is HELD, which is a different claim.
 *
 * Both ride inside the existing payload behind their own switches, both off by default.
 */
export interface BridgeEventParticipant {
  name?: string;
  id?: string;
  team?: number;
  state?: 'Registered' | 'Spawning' | 'Alive' | 'Dead' | 'Left' | (string & {});
  score?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
  headshots?: number;
  suicides?: number;
  teamKills?: number;
}

export interface BridgeEventBorder {
  state?: string;
  /** What the ring is right now. */
  radius?: number;
  /** What it is closing towards. Equal to `radius` means it is not moving. */
  targetRadius?: number;
  x?: number;
  y?: number;
  z?: number;
}

/** What `countHeld()` and `countInContainer()` return. `ok: false` carries `code: 'no_data'`. */
export interface ItemTally {
    ok: boolean;
    /** Only when `ok` is false. */
    code?: string;
    /** Only when `ok` is false. */
    error?: string;
    /** How many matching item ENTRIES were found — not how many of the item. */
    entries?: number;
    /** How many of the thing, summed across stackable entries. */
    stack?: number;
    /** Uses remaining, summed. Never added into `stack`. */
    uses?: number;
    /** Raw count from a component kind that is neither of the above. */
    quantity?: number;
    /** Matching entries that reported no count at all. Not zero-valued entries. */
    uncounted?: number;
    /** The listing was cut short, so every number above is a floor. */
    truncated?: boolean;
}

export interface BridgeFailure {
  ok: false;
  code: BridgeFailureCode;
  /** The module's own words on a refusal, written for a human. `null` when it did not say. */
  reason: string | null;
  /** The raw wire string, unchanged — for a log, not for a player. */
  error: string;
  /**
   * The switch to send the owner to, named the way their own screen names it.
   *
   * Present on `module_off`, and on a `refused` that gave no reason. `null` otherwise — and `null`
   * for every plugin that declares no `bridge` block in its manifest, because a call like
   * `command('give', 'inv:…')` says nothing about which of nine switches gates it. The declaration
   * is the only thing that can say which, and guessing would send somebody to the wrong control.
   */
  switchTo?: BridgeSwitchTo | null;
}

/** Where to go to turn something on. `label` is the module's own schema label, never the config key. */
export interface BridgeSwitchTo {
  moduleId: string;
  moduleName: string;
  off: Array<{ key: string; label: string; group: string }>;
}

/** Why the manager will not switch something on. `null` means it will. */
export type BridgeNeedBlock = 'wants' | 'core' | 'never_module' | 'tier' | 'unclassified' | 'absent' | 'not_a_switch';

export interface BridgeNeedSwitch {
  key: string;
  /** The module's own label for it — what the owner's screen calls this control. */
  label: string;
  group: string;
  hint: string;
  type: string;
  /** From the shipped tier table: `safe`, `cost`, `heavy`, `undo`, `permanent`, `authority`, … */
  tier: string;
  tierLabel: string;
  tierFamily: 'none' | 'cost' | 'danger';
  /**
   * `missing` and `unknown` are NOT the same: one says this bridge does not have it (an older DLL,
   * a renamed key), the other says the bridge could not be asked.
   */
  state: 'on' | 'off' | 'missing' | 'unknown';
  block: BridgeNeedBlock | null;
}

export interface BridgeNeedGroup {
  kind: 'needs' | 'wants';
  module: string;
  moduleName: string;
  why: string;
  present: boolean;
  /** The bridge's OWN settings rather than an in-game module. Never written for a plugin. */
  core: boolean;
  switches: BridgeNeedSwitch[];
}

export interface BridgeNeeds {
  ok: boolean;
  id?: string;
  /** False for a plugin with no `bridge` block — everything then behaves exactly as it always did. */
  declared: boolean;
  online?: boolean;
  /** How many `needs` switches are off AND the manager is willing to switch on. */
  pending?: number;
  /** How many are off and it will not touch — each one says why in `block`. */
  blocked?: number;
  /** Whether this build shipped a tier table at all. Without one, nothing is ever applied. */
  classified?: boolean;
  groups: BridgeNeedGroup[];
}

export type BridgeResult = ({ ok: true; data: any; code: null; reason: null; error: null })
                         | (BridgeFailure & { data: null });

/**
 * A bridge module command's answer.
 *
 * `accepted: true` says the module took the call. Two optional keys say more, and both are ABSENT
 * unless the module answers them — absence is never a `false`:
 *
 *  - **`note`** — a sentence for a PERSON: what it did, from what to what, and any reason the change
 *    may not be visible where they are looking. Show it; never branch on its text.
 *  - **`changed`** — the same answer for a PROGRAM. `true` means it really altered something and read
 *    that back, `false` means nothing needed doing. A refuel that filled a tank and one that found it
 *    already full both answer `accepted: true` with different prose, and a plugin cannot branch on
 *    prose — so charging on `ok` alone charges for both. This is `confirmed` one step further in:
 *    dispatched is not done, and **done is not needed-doing**.
 *
 * Test for presence: `r.changed === true`, never `if (r.changed)`.
 */
export type BridgeCommandResult =
  ({ ok: true; accepted?: boolean; note?: string; changed?: boolean } & Record<string, any>)
  | BridgeFailure;

export interface RouteApi {
  get(path: string, handler: (req: any, res: any) => void): void;
  post(path: string, handler: (req: any, res: any) => void): void;
  put(path: string, handler: (req: any, res: any) => void): void;
  delete(path: string, handler: (req: any, res: any) => void): void;
}

export type ChatChannel = 'local' | 'global' | 'squad' | 'admin' | 'server';
/**
 * One slice of the week, on the server's wall clock. Store an ARRAY of these; the thing is available
 * when any one of them is open, and an empty array means always.
 */
export interface TimeWindow {
  /** ISO weekday numbers, 1 = Monday … 7 = Sunday. Absent or empty means every day. */
  days?: number[];
  /** "HH:MM", 24-hour. Later than `to` crosses midnight and belongs to the day it STARTS. */
  from: string;
  /** "HH:MM", 24-hour, exclusive. Equal to `from` is refused rather than guessed. */
  to: string;
  /** An IANA zone name. Omit for the machine the manager runs on, which is what owners expect. */
  tz?: string | null;
}

export interface ChatOpts { name?: string; channel?: ChatChannel; targets?: string[]; exclude?: string[] }
export interface ChatCommandCtx {
  steamId: string; name: string; channel: ChatChannel; command: string;
  args: string[]; argString: string;
  reply(text: string, opts?: { channel?: ChatChannel }): void;
}

export type PluginEvent =
  | 'server:online' | 'server:offline' | 'server:starting' | 'server:loading' | 'server:stopping'
  | 'service:started' | 'service:stopped' | 'manager:started' | 'manager:stopped'
  | 'performance' | 'admin:alert' | 'status' | 'logline' | 'notification'
  | 'update:available' | 'update:failed' | 'backup:started' | 'backup:completed' | 'backup:failed'
  | 'kill' | 'economy' | 'player:join' | 'player:leave' | 'player:chat' | 'player:intel' | 'raid:alert';

/**
 * Every embed the manager sends can be transformed. The named kinds below are the fixed ones; the
 * template literal types cover the generated families — one notification type, one property-alert
 * sub-type or one intel action each. The narrower kind runs before its umbrella
 * (`dm.raid.attack` → `dm.raid` → `dm`).
 */
export type EmbedKind =
  | 'kill' | 'kill_public' | 'economy' | 'login' | 'gameplay' | 'chest' | 'vehicle'
  | 'raid' | 'quest' | 'fame' | 'violation' | 'eventkill' | 'eventkill_public' | 'admin'
  | 'status' | 'leaderboard' | 'players' | 'bunker'
  | 'notification' | `notify.${string}`
  | 'dm' | `dm.${string}`
  | 'intel' | `intel.${string}`;

/** Scopes the player-specific tokens ({gold}, {fame}, {stat_*}). Event ctx objects work as-is. */
export interface DataCtx { steamId?: string | number; playerName?: string; [k: string]: unknown }

/** One token, with the value it holds right now. */
export interface DataToken {
  key: string;
  label: string;
  /** 'Server' | 'Counts' | 'Player' | 'Player stats' | 'Leaderboards' | 'Economy' | … */
  group: string;
  value: string;
  /** false when the value is currently empty (server offline, no data yet) or parametric. */
  live: boolean;
  /** true for shapes like `img:ITEM_CODE` that take an argument and cannot be enumerated. */
  parametric?: boolean;
}

/** One styleable embed, with the shape the manager really produces for it. */
export interface EmbedKindInfo {
  key: EmbedKind;
  label: string;
  /** 'feeds' | 'live' | 'notifications' | 'dm' | 'intel' */
  group: string;
  /** true when `sample` is an embed the manager actually sent (rather than one built on demand). */
  live: boolean;
  at: number | null;
  sample: {
    title: string | null;
    description: string | null;
    color: number | null;
    thumbnail: string | null;
    image: string | null;
    author: { name: string; iconURL: string | null } | null;
    fields: Array<{ name: string; value: string; inline: boolean }>;
  } | null;
  /** Token names with the values they hold on that embed — real data, not illustrations. */
  tokens: Array<{ t: string; label: string; value: string }>;
}

export interface PluginModule {
  register(host: Host): void | Promise<void>;
  unregister?(host: Host): void | Promise<void>;
}

// ── Admin frontend: window.SSA (payload/web/plugin.js) ───────────────────────
export interface ActionEntry { label: string; icon?: string; danger?: boolean; disabled?: boolean; run?: () => void; submenu?: any }
export interface TabDef {
  id: string; label: string; icon?: string; order?: number;
  permission?: string; premium?: boolean; when?: () => boolean;
  render: (el: HTMLElement) => void;
}
export interface SSA {
  ready(fn: (ssa: SSA) => void): void;
  registerTab(opts: TabDef): void;
  views: {
    mount(anchor: string | HTMLElement, render: (el: HTMLElement) => void, opts?: { when?: () => boolean }): () => void;
    replace(tabId: string, render: (el: HTMLElement) => void): void;
  };
  actions: {
    player(fn: (player: any) => ActionEntry | ActionEntry[] | null): void;
    entity(kind: 'player' | 'vehicle' | 'chest' | 'base' | 'storage', fn: (entity: any) => ActionEntry | ActionEntry[] | null): void;
  };
  el(tag: string, props?: Record<string, any>, kids?: any): HTMLElement;
  mount(target: string | HTMLElement, content: string | HTMLElement): HTMLElement | null;
  toast(msg: string, kind?: 'ok' | 'err' | 'error' | 'info'): void;
  modal(opts: { title?: string; body: string | HTMLElement; actions?: Array<{ label: string; primary?: boolean; run?: () => boolean | void }>; wide?: boolean; dismissable?: boolean }): { close: () => void; el: HTMLElement; body: HTMLElement };
  confirm(msg: string, opts?: { title?: string; okLabel?: string; cancelLabel?: string }): Promise<boolean>;
  menu(title: string, entries: ActionEntry[], opts?: any): void;
  theme: { setTokens(tokens: Record<string, string>, opts?: { selector?: string }): void; injectCss(css: string): void };
  i18n: { add(lang: string, dict: Record<string, string>): void; override(lang: string, dict: Record<string, string>): void };
  t(key: string, fallback?: string, vars?: Record<string, any>): string;
  lang(): string;
  api<T = any>(path: string, opts?: RequestInit): Promise<T>;
  on(evt: string, fn: (payload: any) => void): () => void;
  emit(evt: string, payload?: any): void;
  socket: { on(evt: string, fn: (payload: any) => void): void };
  provide(name: string, api: any): void;
  consume<T = any>(name: string): T | null;
  premium(): boolean;
  admin(): { isDefault?: boolean; permissions?: string[] } | null;
  refreshGates(): void;

  // ── native UI building blocks (render plugin UIs that are pixel-identical to the panel) ──
  /** A panel SVG sprite icon node: `<svg class="ico [cls]"><use href="#i-<id>"/></svg>`. Never use emoji. */
  icon(id: string, cls?: string): SVGElement;
  /** Native clickable table cells — identical markup/behaviour to the Log Viewer. */
  cell: {
    /** Player name → opens the native player modal on click (admin-actions if no name). */
    player(name?: string | null, steamId?: string | null): Node;
    /** World coordinate → centres the native Live Map on click. */
    location(x: number, y: number, z?: number): Node;
    /** Item code → shows the item-preview popover on click (same as the Log Viewer). */
    item(code?: string | null, label?: string): Node;
    /** Coloured status label. kind: 'ok'|'bad'|'warn'|'muted' or a number 0–5 (stable palette). */
    tag(text: string, kind?: 'ok' | 'bad' | 'warn' | 'muted' | number): HTMLElement;
  };
  /** A full native data-table with search, click-to-sort headers and pagination. Returns { el, refresh }. */
  table(opts: {
    columns: Array<{ key: string; label: string; sort?: boolean; sortVal?: (row: any) => any; render: (row: any) => Node; tdClass?: string; thClass?: string }>;
    rows: (() => any[]) | any[];
    search?: (row: any) => string;
    searchPlaceholder?: string;
    pageSize?: number;
    sort?: { key: string; dir?: 'asc' | 'desc' };
    empty?: string | (() => string);
    onRefresh?: () => void;   // adds a native refresh icon-button to the toolbar
    toolbar?: Node[];         // extra toolbar buttons/nodes (placed before the count)
  }): { el: HTMLElement; refresh: () => void; search: HTMLInputElement };

  // ── native affordances (open the built-in UI a plugin can't rebuild) ──
  openPlayer(name: string): void;                              // open a player's detail modal
  openPlayerAdmin(steamIdOrName: string, name?: string): void; // open the admin-actions menu
  showOnMap(x: number, y: number, z?: number): void;           // centre the Live Map on a coordinate
  itemPreview(elOrCode: HTMLElement | string, anchor?: HTMLElement): void; // show the item-preview popover
  showTab(name: string): void;                                 // switch to a native panel tab

  // ── native pickers (Promise; also accept opts.onPick / opts.onCancel) ──
  pickItem(opts?: { domain?: 'items' | 'vehicles'; category?: string; title?: string; onPick?: (it: any) => void; onCancel?: () => void }): Promise<{ id: string; code: string; name: string; image: string | null } | null>;
  pickVehicle(opts?: any): Promise<{ id: string; code: string; name: string; image: string | null } | null>;
  pickPlayer(opts?: { title?: string }): Promise<{ steamId: string; name: string } | null>;

  // ── data helpers (same endpoints the panel uses) ──
  onlinePlayers(): Promise<any[]>;
  itemInfo(codes: string | string[]): Promise<any[]>;
  searchItems(query: string, opts?: { domain?: 'items' | 'vehicles' }): Promise<any[]>;

  // ── capability flags (feature-detect before wiring an affordance up) ──
  canOpenPlayer(): boolean;
  canShowOnMap(): boolean;
  canItemPreview(): boolean;
  canPickItem(): boolean;
}

// ── Public Field Console frontend: window.FC (payload/fc/plugin.js) ───────────
// Mirrors SSA minus the admin-only bits. Feed it with PUBLIC routes (host.routes.public.*).
export interface FC {
  ready(fn: (fc: FC) => void): void;
  registerTab(opts: { id: string; label: string; icon?: string; order?: number; render: (el: HTMLElement) => void }): void;
  views: { mount(anchor: string | HTMLElement, render: (el: HTMLElement) => void, opts?: { when?: () => boolean }): () => void; replace(viewId: string, render: (el: HTMLElement) => void): void };
  el(tag: string, props?: Record<string, any>, kids?: any): HTMLElement;
  mount(target: string | HTMLElement, content: string | HTMLElement): HTMLElement | null;
  toast(msg: string, kind?: string): void;
  modal(opts: any): any;
  confirm(msg: string): Promise<boolean>;
  theme: { setTokens(tokens: Record<string, string>): void; injectCss(css: string): void };
  i18n: { add(lang: string, dict: Record<string, string>): void };
  t(key: string, fallback?: string, vars?: Record<string, any>): string;
  lang(): string;
  api<T = any>(path: string, opts?: RequestInit): Promise<T>;
  on(evt: string, fn: (payload: any) => void): () => void;
  emit(evt: string, payload?: any): void;
  provide(name: string, api: any): void;
  consume<T = any>(name: string): T | null;
  go(viewId: string): void;
}

declare global { interface Window { SSA: SSA; FC: FC } }
