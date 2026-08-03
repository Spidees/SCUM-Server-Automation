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
  };

  leaderboards: { get(cat: string, limit?: number, weeklyOnly?: boolean): any[]; all(limit?: number, weeklyOnly?: boolean): any; categories(): any[] };
  economy: { traderFunds(): any; outpost(): any; specialDeals(limit?: number): any[]; goldCapacity(): any };
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
     *  that online player (for commands with no Location arg). Returns { ok, error? } — check `ok`. */
    command(cmd: string, opts?: { executor?: string }): Promise<{ ok: boolean; error?: string; output?: string }>;
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
    embed(): any;                                   // discord.js EmbedBuilder
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

export type EmbedKind =
  | 'kill' | 'economy' | 'login' | 'gameplay' | 'chest' | 'vehicle'
  | 'raid' | 'quest' | 'fame' | 'violation' | 'eventkill' | 'admin'
  | 'status' | 'leaderboard' | 'players' | 'bunker';

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
