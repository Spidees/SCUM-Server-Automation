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
  };

  /** Game-code database — items AND vehicles/animals/zombies/NPCs by class code. Images are Premium. */
  items: {
    resolve(id: string): any | null;
    name(id: string): string | null;
    image(id: string, variant?: 'vicinity' | string): string | null;
    imageUrl(file: string): string | null;
  };

  /** Live world data. */
  map: {
    world(): any | null;
    container(entityId: any): any | null;
    vehicleParts(entityId: any): any[];
    bunkers(): any[];
    /** Is (x,y) inside the flag rectangle of that player's or their squad's bases? `margin` in cm. */
    isInOwnerArea(steamId: string, x: number, y: number, margin?: number): boolean;
    /**
     * World→map calibration from the host, or null when it has none. ASYNC.
     * Never substitute your own bounds — a wrong calibration places things
     * confidently in the wrong spot. Show nothing instead.
     */
    calibration?(): Promise<{ world: { minX: number; maxX: number; minY: number; maxY: number }; width?: number; height?: number } | null>;
    /**
     * A world point → its SCUM grid sector ("B3"), or null when uncalibrated. ASYNC.
     * Uses the same grid the live map draws, so a plugin never invents a second
     * coordinate system. Feature-detect: added after the first 4.0.x builds.
     */
    sector?(x: number, y: number): Promise<string | null>;
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

  /** Persistent key/value store (a JSON file in the plugin's dataDir). */
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
    /** In-game command via the SSA Bridge (Premium). `opts.executor` = a SteamID to run it through
     *  that online player (for commands with no Location arg). `opts.caller` = a label recorded in the
     *  Bridge's activity log (defaults to `plugin:<your-id>`). Returns { ok, error? } — check `ok`. */
    command(cmd: string, opts?: { executor?: string; caller?: string }): Promise<{ ok: boolean; error?: string; output?: string }>;
    /** SSA Bridge health for a pre-flight check before spawning/charging. */
    bridge(): Promise<{ available: boolean; licensed: boolean; players?: any[]; version?: string; error?: string }>;
  };

  discord: {
    /** The entire discord.js module (EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, …). */
    readonly js: any;
    client(): any | null;
    enabled(): boolean;
    /** The admin's configured live-embed image URLs (any may be null). */
    liveEmbedImages(): { status: string | null; players: string | null; bunker: string | null; leaderboard: string | null; economy: string | null };
    embed(): any;
    /** Footer the manager stamps on its own embeds: `{ name, icon }`, or null. */
    branding(): { name: string; icon: string } | null;                                   // discord.js EmbedBuilder
    button(o?: { id?: string; label?: string; style?: number; url?: string; emoji?: string; disabled?: boolean }): any;
    row(...components: any[]): any;                  // ActionRowBuilder
    channel(id: string): Promise<any | null>;
    /** payload: string | EmbedBuilder | EmbedBuilder[] | { content, embeds, components, files } */
    send(channelId: string, payload: any): Promise<any>;
    dm(userId: string, payload: any): Promise<any>;
    onMessage(fn: (message: any) => void): () => void;
    onInteraction(fn: (interaction: any) => void): () => void;
    onButton(customId: string | RegExp, fn: (interaction: any) => void): () => void;
    onSelect(customId: string | RegExp, fn: (interaction: any) => void): () => void;
    registerSlash(data: any, handler: (interaction: any) => void): Promise<boolean>;
    channels(): Record<string, any>;
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
  };

  /** In-game chat + /commands via the SSA Bridge (Premium). */
  chat: {
    /** Register a /command. Handler ctx: { steamId, name, channel, command, args, argString, reply }. */
    onCommand(name: string, handler: (ctx: ChatCommandCtx) => void | Promise<void>): () => void;
    setPrefix(prefix: string): void;
    prefix(): string;
    send(text: string, opts?: ChatOpts): Promise<any>;
    dm(steamId: string, text: string, opts?: ChatOpts): Promise<any>;
    broadcast(text: string, opts?: ChatOpts): Promise<any>;
  };

  /** Push a notification through the manager's own pipeline (Discord + admin realtime). */
  notify(type: string, data?: Record<string, any>): void;

  schedule: {
    every(ms: number, fn: () => void): () => void;
    after(ms: number, fn: () => void): () => void;
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

export interface RouteApi {
  get(path: string, handler: (req: any, res: any) => void): void;
  post(path: string, handler: (req: any, res: any) => void): void;
  put(path: string, handler: (req: any, res: any) => void): void;
  delete(path: string, handler: (req: any, res: any) => void): void;
}

export type ChatChannel = 'local' | 'global' | 'squad' | 'admin' | 'server';
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
