/**
 * SSA Bridge client typings.
 *
 * The SSA Bridge is a free UE4SS mod that runs inside a SCUM dedicated server and answers
 * newline-delimited JSON on a TCP socket. These typings describe that socket as a client sees it:
 * how to connect, what a request and a reply look like, every refusal code, and the vocabulary of
 * every module. They describe the WIRE, so they are as useful to a tool written in another language
 * as to `ssa-bridge-client.js` beside this file.
 *
 * Protocol:          https://scumsa.com/docs/dev/ssa-bridge-protocol
 * Module reference:  https://scumsa.com/docs/reference/bridge-verbs
 *
 * The section between the two GENERATED markers below is produced from the bridge's own source on
 * every release. Do not edit it by hand: a verb that is renamed there is renamed here.
 */

// ── Connecting ──────────────────────────────────────────────────────────────────────────────────

/**
 * `Mods/SSABridge/SSABridge.status.json`, written by the bridge after it has bound its port.
 * It is the only reliable source of the port: the bridge moves to the next free port when the
 * configured one is taken, so a client never guesses one.
 */
export interface BridgeStatusFile {
  version: string;
  /**
   * The wire contract this build speaks. Absent on builds before 2.19.5, which means 1.
   *
   * - 1: every build up to 2.24.1.
   * - 2: 2.25.0 and newer. `zones` `delete:<name>:CONFIRM` and `squads` `disband:<squadId>:CONFIRM`
   *   need the confirmation word; nothing else changed. To a protocol 1 bridge, send both without it.
   *
   * A higher number than you know is still usable: proceed and ignore what you do not recognise.
   */
  protocol?: number;
  /** The oldest contract this build still answers. */
  protocolMin?: number;
  host: string;
  port: number;
  /** Identifies the Windows install. Not part of the protocol. */
  machineId?: string;
  /**
   * Changes every time the server starts. Send it on every line: a line naming a different run is
   * refused with `wrong_instance`, which on a machine with several servers means this port now
   * belongs to another server's bridge. Absent on older bridges; send none to them.
   */
  instance?: string;
}

export interface BridgeConnectOptions {
  /** Default `127.0.0.1`. The bridge speaks IPv4 only. */
  host?: string;
  /** Read it from the status file, or ask the owner. Never assume 27717. */
  port: number;
  /**
   * The `token` from the server's `SSABridge.config.json`. Required from any machine other than the
   * server's own, and accepted from loopback too. Remote control is off while it is empty.
   */
  token?: string;
  /** The `instance` from the status file, when the client can read it. Remote clients usually cannot. */
  instance?: string;
  /** A label for the bridge's activity log, sent as `caller`. */
  caller?: string;
  /**
   * How long to wait for one reply. Default 20000. A request over the bridge's rate budget is queued
   * rather than refused, so an expired timeout means UNKNOWN: the request may still run.
   */
  timeoutMs?: number;
  /** How long to wait before resending after `rate_limited`, times the attempt number. Default 1000. */
  backoffMs?: number;
  /** How many times to resend after `rate_limited`. Default 3. */
  retries?: number;
}

// ── The frame ───────────────────────────────────────────────────────────────────────────────────

/** One JSON object per line, both directions, terminated by `\n`. UTF-8. */
export interface BridgeRequest {
  /** Echoed on the reply. A number comes back as a string; absent comes back as `"0"`. */
  id: string;
  action: BridgeAction;
  instance?: string;
  caller?: string;
  [field: string]: unknown;
}

export type BridgeAction =
  | 'status' | 'auth' | 'list' | 'players' | 'where' | 'name'
  | 'cmd' | 'spawn' | 'batch' | 'chat' | 'console' | 'groundz' | 'tracediag'
  | 'subscribe' | 'setcmdprefix' | 'perf'
  | 'modules' | 'module_config' | 'module_data' | 'module_command';

/**
 * A success. `changed`, `note` and `reach` ride BESIDE `result` on `module_data` and
 * `module_command` replies, never inside it.
 */
export interface BridgeOk<T = unknown> {
  ok: true;
  result: T;
  /** `true` something moved, `false` nothing needed doing, absent not reported. */
  changed?: boolean;
  /** The same answer in words, for a person. */
  note?: string;
  /** Whether players see the change and whether it is saved, as counts. */
  reach?: BridgeReach;
}

export interface BridgeReach {
  wrote: number;
  /** `wrote` larger than `known` means a field name did not resolve. */
  known: number;
  replicated: number;
  persists: number;
  pushed: number;
  atAddress: number;
  notRun?: number;
}

/**
 * A refusal, as `ssa-bridge-client.js` hands it back. Never thrown.
 *
 * On the wire the bridge's own refusals carry a stable code in `error` and a sentence in `reason`.
 * A MODULE's refusal carries its sentence in `error` and sometimes a code in `reasonCode`. The client
 * folds both into `code` + `reason`: switch on `code`, show `reason`, never switch on `reason`.
 */
export interface BridgeRefusal {
  ok: false;
  code: BridgeErrorCode | ClientErrorCode | string;
  reason: string;
  /** Present when the bridge or a module named a more specific case, e.g. `needs_player`. */
  reasonCode?: string;
  /** A refusal after a partial write still reports what was written. */
  reach?: BridgeReach;
}

export type BridgeReply<T = unknown> = BridgeOk<T> | BridgeRefusal;

/**
 * Codes the bridge itself sends in `error`. Stable: they never change meaning without the protocol
 * number going up. The sentence after each is what it means and what to do.
 */
export type BridgeErrorCode =
  /** The line was not one complete JSON object. Arrives with id "0". Fix the serialiser. */
  | 'bad json'
  /** No such action in this build. The reason lists the ones there are. */
  | 'unknown action'
  /** A remote client has not sent `auth`. Send it first. Also sent before the connection is closed after ten seconds unauthenticated. */
  | 'unauthorized'
  /** A remote client, and the owner has set no token. Remote control is off until they do. */
  | 'remote_disabled'
  /** Wrong token, or no token configured. Do not retry in a loop. */
  | 'bad_token'
  /** The `instance` names a different run of the bridge. Read the status file again. */
  | 'wrong_instance'
  /** Too many `auth` attempts too quickly. Wait a second and send it again. */
  | 'rate_limited'
  /** 1024 requests are already queued. Arrives with id "0", so the request it dropped times out. */
  | 'busy'
  /** Over 64 KB without a newline. The connection closes. */
  | 'line_too_long'
  /** 24 connections already open. Reuse one connection. */
  | 'too_many_clients'
  /** This installation's DLL is not the signed file. The owner reinstalls from an official download. */
  | 'tampered'
  /** No module with that id. `modules` lists them. */
  | 'unknown_module'
  /** A module refused a verb without a reason: the verb may not exist. */
  | 'unknown_command'
  /** A module report was empty without a reason. */
  | 'no_data'
  /** `module_config` without a `config` object. Send the full settings object. */
  | 'missing_config'
  /** A required field is absent. The reason names it. */
  | 'missing_command' | 'missing item' | 'missing text' | 'missing command'
  /** Coordinates absent or not JSON numbers. */
  | 'missing_xy' | 'bad_xy' | 'bad_xyz'
  /** Nothing solid below that point. */
  | 'no_ground' | 'no ground below that height'
  /** Nobody online to run the command through. `reasonCode` is `needs_player` or `executor_offline`. */
  | 'no_executor'
  /** That player is not on the server or has not spawned. Retry later. */
  | 'player not ready'
  /** The console could not be reached. Says nothing about the command. */
  | 'console_failed'
  /** A console command with no undo, such as `exit`. The owner must set `consoleUnrestricted`. */
  | 'console_refused'
  /** `chat` with a channel that is not one of the five. */
  | 'bad channel'
  /** A `batch` holding more than one spawn command. Send spawns one at a time. */
  | 'too_many_spawns'
  /** `where` found the player but could not read the location. Retry in a moment. */
  | 'no position'
  /** A `groundz` answer did not fit its buffer: a coordinate far outside the map. */
  | 'reply_too_long'
  /** An answer over 8 MB. Ask for less. */
  | 'reply_too_large'
  /** Older bridges only: the licence gate that no longer exists. Treat it as "not available". */
  | 'unlicensed';

/** Codes the reference client adds for things that never reached the bridge or never came back. */
export type ClientErrorCode =
  /** No reply within `timeoutMs`. The request may still run; treat the outcome as unknown. */
  | 'timeout'
  /** The connection closed before the reply arrived. */
  | 'closed'
  /** A reply line that was not JSON, or over 8 MB. */
  | 'bad_response'
  /** A module refused in its own words and gave no code. `reason` is that sentence. */
  | 'module_refused';

// ── The bridge's own actions ────────────────────────────────────────────────────────────────────

export interface StatusResult {
  version: string;
  protocol?: number;
  protocolMin?: number;
  /** The rest is withheld from a remote client that has not authenticated. */
  port?: number;
  players?: number;
  uptimeSec?: number;
  licensed?: boolean;
  licenseExp?: number;
}

export interface PlayerRow {
  steamid: string;
  name: string;
  /** Absent together when the position could not be read, usually a player who has just died. */
  x?: number;
  y?: number;
  z?: number;
}

export interface CmdResult {
  executor: string;
  output: string[];
  /** Act on this, never on `ok` alone, when the command charges somebody or gives something. */
  confirmed?: boolean;
}

export type ChatChannel = 'local' | 'global' | 'squad' | 'admin' | 'server' | 1 | 2 | 3 | 4 | 6;

export interface ChatOptions {
  channel?: ChatChannel;
  /** Absent or "all" sends to everyone; Steam IDs make it private. */
  targets?: string[] | 'all';
  exclude?: string[];
}

export interface ModuleEntry<M extends ModuleId = ModuleId> {
  id: M;
  name: string;
  enabled: boolean;
  /** What is stored. */
  config: Partial<ModuleSettings<M>>;
  /** Every setting, its type, range, default and explanation, for this build. */
  schema: unknown;
  /** What the module is doing now. */
  status: unknown;
  /** Present only when a stored value could not be read. */
  configErrors?: unknown;
}

export type BridgeEvent =
  | { event: 'player_join'; steamid: string; name: string }
  /** Reported about five seconds after the player left. `name` is empty: keep your own map. */
  | { event: 'player_leave'; steamid: string; name: string }
  /** Needs a command prefix. The line is removed from chat; reply to the player yourself. */
  | { event: 'chat_command'; steamid: string; name: string; channel: number; text: string }
  | { event: string; [key: string]: unknown };

export type BridgeEventName = 'player_join' | 'player_leave' | 'chat_command';

/**
 * Rate limits, as the bridge ships them. The owner can change both in `SSABridge.config.json`.
 * Over budget is NOT an error: the request is queued and runs on a later pass. Pipeline requests on
 * one connection; more connections add no parallelism.
 */
export interface BridgeLimits {
  ratePerSec: 15;
  rateBurst: 30;
  maxConnections: 24;
  maxQueued: 1024;
  maxLineBytes: 65536;
  maxReplyBytes: 8388608;
  authGraceSeconds: 10;
}

// ── The reference client (ssa-bridge-client.js) ─────────────────────────────────────────────────

export declare class BridgeClient {
  /** What `status` answered on connect. */
  readonly status: StatusResult;
  /** `status.protocol`, with an absent number read as 1. */
  readonly protocol: number;

  /** Any action. Resolves to a reply; never rejects for a refusal. */
  request<T = unknown>(action: BridgeAction, fields?: Record<string, unknown>): Promise<BridgeReply<T>>;
  /**
   * `module_data`: ask a module for a report. The catalogue lists every spelling a module tests
   * whole, such as `deaths:since:<seq>`. A word inside an argument is not listed (a sub-command such
   * as `zones` `config:delete:<n>`); send those through `request('module_data', { module, what })`,
   * which takes any string.
   */
  query<M extends ModuleId>(module: M, what: DataQuery<M>): Promise<BridgeReply>;
  /** `module_command`: tell a module to do something. Unlisted spellings go through `request()` too. */
  command<M extends ModuleId>(module: M, what: Command<M>): Promise<BridgeReply>;
  /** `module_config`: REPLACES the module's settings. Read `modules`, change the object, send all of it. */
  configure<M extends ModuleId>(module: M, config: ModuleSettings<M>): Promise<BridgeReply<ModuleEntry[]>>;
  modules(): Promise<BridgeReply<ModuleEntry[]>>;
  players(): Promise<BridgeReply<PlayerRow[]>>;
  /**
   * One SCUM admin command, without the leading `#` (one is stripped if present). The client sends
   * one admin command at a time: a second call waits for the first reply.
   */
  cmd(command: string, opts?: { executor?: string; hide?: boolean }): Promise<BridgeReply<CmdResult>>;
  chat(text: string, opts?: ChatOptions): Promise<BridgeReply<{ channel: number; delivered: number }>>;
  /** Turns on push events for this connection. Unknown names are dropped: compare the answer. */
  subscribe(events: BridgeEventName[]): Promise<BridgeReply<{ subscribed: string[] }>>;
  on(name: 'event', fn: (e: BridgeEvent) => void): this;
  /** A line with an id this client never sent, such as a `busy` with id "0". */
  on(name: 'stray', fn: (line: unknown) => void): this;
  on(name: 'close', fn: () => void): this;
  close(): void;
}

/**
 * Open one connection, send `auth` when a token is given, then `status`. Rejects only when there is
 * no usable connection: the socket failed, `auth` was refused, or the bridge speaks a protocol below
 * `minProtocol`. The error carries `code` and `reason`.
 */
export declare function connect(opts: BridgeConnectOptions & { minProtocol?: number }): Promise<BridgeClient>;

/**
 * Read the status file of a bridge on this machine. `serverDir` is the folder holding `SCUM/`.
 * Returns null when there is no file: that bridge has never listened, and a client must not guess.
 */
export declare function discover(where: { serverDir?: string; statusFile?: string }): (BridgeStatusFile & { host: string }) | null;

/** Removes one leading `#`. The `#` is the chat prefix; the bridge wants the bare verb. */
export declare function bareCommand(command: string): string;

// ── GENERATED: the module vocabulary ───────────────────────────────────────────────────────────
//
// 50 modules, 218 reads, 274 writes, 34 retired verbs, 380 settings.
// Produced from the bridge's own source. Do not edit by hand.

/** The words the despawn module's first field accepts. */
export type Kind_despawn =
  | "airdrop"
  | "airdrops"
  | "animal"
  | "animals"
  | "aquatic"
  | "aquaticanimal"
  | "aquaticanimals"
  | "armednpc"
  | "armednpcs"
  | "bird"
  | "birds"
  | "boat"
  | "brenner"
  | "brenners"
  | "car"
  | "cargo"
  | "cargodrop"
  | "cars"
  | "crate"
  | "deer"
  | "deployablesentry"
  | "drifter"
  | "drone"
  | "drones"
  | "dropship"
  | "dropships"
  | "dropzone"
  | "dropzonecargo"
  | "dropzonecrate"
  | "dropzones"
  | "fish"
  | "fishschool"
  | "fishschools"
  | "fixedsentry"
  | "guard"
  | "mapsentries"
  | "mapsentry"
  | "mechanoid"
  | "mechanoids"
  | "npc"
  | "npcs"
  | "puppet"
  | "puppets"
  | "razor"
  | "razors"
  | "sentries"
  | "sentry"
  | "sentry2"
  | "shark"
  | "sharks"
  | "school"
  | "schools"
  | "vehicle"
  | "vehicles"
  | "wildlife"
  | "wolf"
  | "zombie"
  | "zombies"
  | `actor=${string}`
  | `class=${string}`;

/**
 * Every module, what `module_data` and `module_command` accept for it, and the verbs that are
 * retired. The field COUNT is in each doc comment; `${string}` also matches a colon, so the
 * compiler checks the verb and not the count. What a field means is in the module's own refusal:
 * send a verb wrong and it answers with a sentence naming what it wanted.
 *
 * Every module ships switched off, and a module that is off refuses its verbs and names the
 * setting to turn on.
 */
export interface ModuleVocabulary {
  /**
   * In-game actions · 18 settings
   *
   * Reads (`module_data`):
   * - `state:…`
   *
   * Writes (`module_command`), with the verb in field 2:
   * - `…:ammo`
   * - `…:cough`
   * - `…:crouch`
   * - `…:cuffpart`
   * - `…:cufftight`
   * - `…:dbfame`
   * - `…:dbfameadd`
   * - `…:dbgold`
   * - `…:dbgoldadd`
   * - `…:dbmoney`
   * - `…:dbmoneyadd`
   * - `…:defecate`
   * - `…:detonate`
   * - `…:disarm`
   * - `…:fade`
   * - `…:fakename`
   * - `…:fame`
   * - `…:freelook`
   * - `…:gender`
   * - `…:godmode`
   * - `…:gold`
   * - `…:hud`
   * - `…:immortal`
   * - `…:kick`
   * - `…:killfeed`
   * - `…:limp`
   * - `…:limpclear`
   * - `…:load`
   * - `…:money`
   * - `…:nightvision`
   * - `…:pace`
   * - `…:repossess`
   * - `…:revive`
   * - `…:save`
   * - `…:silence`
   * - `…:sneeze`
   * - `…:spawnscreen`
   * - `…:squadcreate`
   * - `…:squaddemote`
   * - `…:squadjoin`
   * - `…:squadleave`
   * - `…:squadpromote`
   * - `…:squadquit`
   * - `…:strip`
   * - `…:suicide`
   * - `…:suicidetime`
   * - `…:superjump`
   * - `…:uncuff`
   * - `…:unmount`
   * - `…:unsilence`
   * - `…:urinate`
   * - `…:vomit`
   * - `…:wetness`
   *
   * Retired, always refuse: `warn`.
   */
  "actions": {
    data:
      | `state:${string}`;
    command:
      | `${string}:ammo`
      | `${string}:ammo:${string}`
      | `${string}:cough`
      | `${string}:cough:${string}`
      | `${string}:crouch`
      | `${string}:crouch:${string}`
      | `${string}:cuffpart`
      | `${string}:cuffpart:${string}`
      | `${string}:cufftight`
      | `${string}:cufftight:${string}`
      | `${string}:dbfame`
      | `${string}:dbfame:${string}`
      | `${string}:dbfameadd`
      | `${string}:dbfameadd:${string}`
      | `${string}:dbgold`
      | `${string}:dbgold:${string}`
      | `${string}:dbgoldadd`
      | `${string}:dbgoldadd:${string}`
      | `${string}:dbmoney`
      | `${string}:dbmoney:${string}`
      | `${string}:dbmoneyadd`
      | `${string}:dbmoneyadd:${string}`
      | `${string}:defecate`
      | `${string}:defecate:${string}`
      | `${string}:detonate`
      | `${string}:detonate:${string}`
      | `${string}:disarm`
      | `${string}:disarm:${string}`
      | `${string}:fade`
      | `${string}:fade:${string}`
      | `${string}:fakename`
      | `${string}:fakename:${string}`
      | `${string}:fame`
      | `${string}:fame:${string}`
      | `${string}:freelook`
      | `${string}:freelook:${string}`
      | `${string}:gender`
      | `${string}:gender:${string}`
      | `${string}:godmode`
      | `${string}:godmode:${string}`
      | `${string}:gold`
      | `${string}:gold:${string}`
      | `${string}:hud`
      | `${string}:hud:${string}`
      | `${string}:immortal`
      | `${string}:immortal:${string}`
      | `${string}:kick`
      | `${string}:kick:${string}`
      | `${string}:killfeed`
      | `${string}:killfeed:${string}`
      | `${string}:limp`
      | `${string}:limp:${string}`
      | `${string}:limpclear`
      | `${string}:limpclear:${string}`
      | `${string}:load`
      | `${string}:load:${string}`
      | `${string}:money`
      | `${string}:money:${string}`
      | `${string}:nightvision`
      | `${string}:nightvision:${string}`
      | `${string}:pace`
      | `${string}:pace:${string}`
      | `${string}:repossess`
      | `${string}:repossess:${string}`
      | `${string}:revive`
      | `${string}:revive:${string}`
      | `${string}:save`
      | `${string}:save:${string}`
      | `${string}:silence`
      | `${string}:silence:${string}`
      | `${string}:sneeze`
      | `${string}:sneeze:${string}`
      | `${string}:spawnscreen`
      | `${string}:spawnscreen:${string}`
      | `${string}:squadcreate`
      | `${string}:squadcreate:${string}`
      | `${string}:squaddemote`
      | `${string}:squaddemote:${string}`
      | `${string}:squadjoin`
      | `${string}:squadjoin:${string}`
      | `${string}:squadleave`
      | `${string}:squadleave:${string}`
      | `${string}:squadpromote`
      | `${string}:squadpromote:${string}`
      | `${string}:squadquit`
      | `${string}:squadquit:${string}`
      | `${string}:strip`
      | `${string}:strip:${string}`
      | `${string}:suicide`
      | `${string}:suicide:${string}`
      | `${string}:suicidetime`
      | `${string}:suicidetime:${string}`
      | `${string}:superjump`
      | `${string}:superjump:${string}`
      | `${string}:uncuff`
      | `${string}:uncuff:${string}`
      | `${string}:unmount`
      | `${string}:unmount:${string}`
      | `${string}:unsilence`
      | `${string}:unsilence:${string}`
      | `${string}:urinate`
      | `${string}:urinate:${string}`
      | `${string}:vomit`
      | `${string}:vomit:${string}`
      | `${string}:wetness`
      | `${string}:wetness:${string}`;
    retired: "warn";
  };
  /**
   * Creature behaviour · 3 settings
   *
   * Reads (`module_data`):
   * - `counts`
   * - `creature:…`
   * - `fields`
   * - `hunting:…`
   * - `near:…`
   * - `threats`
   *
   * Writes (`module_command`):
   * - `health:…:…` (3 fields)
   * - `hostile:…:…` (3 fields)
   * - `move:…` (2 fields)
   * - `remove:…` (2 fields)
   * - `set:…:…:…` (4 fields)
   * - `stance:…:…` (3 fields)
   * - `target:…:…` (3 fields)
   */
  "ai": {
    data:
      | "counts"
      | `creature:${string}`
      | "fields"
      | `hunting:${string}`
      | `near:${string}`
      | "threats";
    command:
      | `health:${string}:${string}`
      | `hostile:${string}:${string}`
      | `move:${string}`
      | `remove:${string}`
      | `set:${string}:${string}:${string}`
      | `stance:${string}:${string}`
      | `target:${string}:${string}`;
    retired: never;
  };
  /**
   * Live bases and raid protection · 5 settings · read-only
   *
   * Reads (`module_data`):
   * - `bases`
   * - `contents:…`
   * - `protection`
   */
  "bases": {
    data:
      | "bases"
      | `contents:${string}`
      | "protection";
    command: never;
    retired: never;
  };
  /**
   * Base building · 8 settings
   *
   * Reads (`module_data`):
   * - `bases`
   * - `build`
   * - `elements`
   * - `elements:…`
   *
   * Writes (`module_command`):
   * - `catalogue`
   * - `clearowner:…:…:…:…:…` (6 fields)
   * - `demolish:…:…:…:…:…:…` (7 fields)
   * - `destroy:…:…:…:…:…` (6 fields, up to 8)
   * - `chown:…:…` (3 fields)
   * - `learn:…` (2 fields)
   * - `overtake:…:…:…:…:…` (6 fields)
   * - `setowner:…:…:…:…:…` (6 fields)
   * - `spawn:…:…:…:…:…:…:…` (8 fields, up to 10)
   * - `transfer:…:…` (3 fields)
   *
   * Retired, always refuse: `damage`.
   */
  "build": {
    data:
      | "bases"
      | "build"
      | "elements"
      | `elements:${string}`;
    command:
      | "catalogue"
      | `clearowner:${string}:${string}:${string}:${string}:${string}`
      | `demolish:${string}:${string}:${string}:${string}:${string}:${string}`
      | `destroy:${string}:${string}:${string}:${string}:${string}`
      | `destroy:${string}:${string}:${string}:${string}:${string}:${string}`
      | `destroy:${string}:${string}:${string}:${string}:${string}:${string}:${string}`
      | `chown:${string}:${string}`
      | `learn:${string}`
      | `overtake:${string}:${string}:${string}:${string}:${string}`
      | `setowner:${string}:${string}:${string}:${string}:${string}`
      | `spawn:${string}:${string}:${string}:${string}:${string}:${string}:${string}`
      | `spawn:${string}:${string}:${string}:${string}:${string}:${string}:${string}:${string}`
      | `spawn:${string}:${string}:${string}:${string}:${string}:${string}:${string}:${string}:${string}`
      | `transfer:${string}:${string}`;
    retired: "damage";
  };
  /**
   * Weather and time · 2 settings
   *
   * Reads (`module_data`):
   * - `curves`
   * - `get:…`
   * - `groups`
   * - `members`
   * - `rolls`
   * - `state`
   * - `switches`
   *
   * Writes (`module_command`):
   * - `advance:…`
   * - `set:…`
   * - `setbool:…`
   * - `setc:…`
   * - `setcurve:…`
   * - `setstage:…`
   * - `setv:…`
   * - `simulate:…`
   *
   * Retired, always refuse: `hold`, `pin`, `pinv`.
   */
  "climate": {
    data:
      | "curves"
      | `get:${string}`
      | "groups"
      | "members"
      | "rolls"
      | "state"
      | "switches";
    command:
      | `advance:${string}`
      | `set:${string}`
      | `setbool:${string}`
      | `setc:${string}`
      | `setcurve:${string}`
      | `setstage:${string}`
      | `setv:${string}`
      | `simulate:${string}`;
    retired: "hold" | "pin" | "pinv";
  };
  /**
   * Crafting and fishing · 11 settings · read-only
   *
   * Reads (`module_data`):
   * - `cookrecipes`
   * - `craft`
   * - `craftEvents`
   * - `fishing`
   * - `placements`
   */
  "craft": {
    data:
      | "cookrecipes"
      | "craft"
      | "craftEvents"
      | "fishing"
      | "placements";
    command: never;
    retired: never;
  };
  /**
   * Damage at a point · 7 settings
   *
   * Reads (`module_data`):
   * - `last`
   * - `preview:…`
   *
   * Writes (`module_command`):
   * - `explode`
   */
  "damage": {
    data:
      | "last"
      | `preview:${string}`;
    command:
      | "explode"
      | `explode:${string}`;
    retired: never;
  };
  /**
   * Remove from the world · 21 settings
   *
   * Reads (`module_data`):
   * - `here:…`
   * - `kinds`
   * - `preview:…`
   *
   * Writes (`module_command`):
   * - `<kind>:…` (2 to 5 fields)
   * - `stow:…`
   */
  "despawn": {
    data:
      | `here:${string}`
      | "kinds"
      | `preview:${string}`;
    command:
      | `${Kind_despawn}:${string}`
      | `${Kind_despawn}:${string}:${string}`
      | `${Kind_despawn}:${string}:${string}:${string}`
      | `${Kind_despawn}:${string}:${string}:${string}:${string}`
      | `stow:${string}`;
    retired: never;
  };
  /**
   * Door Shuffle · 22 settings
   *
   * Reads (`module_data`):
   * - `classes`
   * - `door:…`
   * - `levels`
   *
   * Writes (`module_command`):
   * - `close:…`
   * - `lock`
   * - `lock:…`
   * - `open:…`
   * - `save`
   * - `seal:…`
   * - `unlock`
   * - `unlock:…`
   * - `unseal:…`
   */
  "doors": {
    data:
      | "classes"
      | `door:${string}`
      | "levels";
    command:
      | `close:${string}`
      | "lock"
      | `lock:${string}`
      | `open:${string}`
      | "save"
      | `seal:${string}`
      | "unlock"
      | `unlock:${string}`
      | `unseal:${string}`;
    retired: never;
  };
  /**
   * Encounters and spawn waves · 8 settings
   *
   * Reads (`module_data`):
   * - `bases`
   * - `encounters`
   * - `hordes`
   * - `nearby`
   * - `places`
   * - `schedule`
   * - `tuning`
   *
   * Writes (`module_command`):
   * - `bb`
   * - `draw`
   * - `dump`
   * - `zone:…:…:…:…:…:…` (7 fields)
   * - `zonerestore`
   */
  "encounters": {
    data:
      | "bases"
      | "encounters"
      | "hordes"
      | "nearby"
      | "places"
      | "schedule"
      | "tuning";
    command:
      | "bb"
      | `bb:${string}`
      | "draw"
      | `draw:${string}`
      | "dump"
      | `dump:${string}`
      | `zone:${string}:${string}:${string}:${string}:${string}:${string}`
      | "zonerestore"
      | `zonerestore:${string}`;
    retired: never;
  };
  /**
   * Live world · 6 settings
   *
   * Reads (`module_data`):
   * - `bases`
   * - `entities`
   * - `entity:…`
   * - `kinds`
   *
   * Writes (`module_command`):
   * - `heal:…`
   * - `set:…`
   */
  "entities": {
    data:
      | "bases"
      | "entities"
      | `entity:${string}`
      | "kinds";
    command:
      | `heal:${string}`
      | `set:${string}`;
    retired: never;
  };
  /**
   * Live game events · 12 settings · read-only
   *
   * Reads (`module_data`):
   * - `events`
   * - `kinds`
   * - `peek`
   * - `watches`
   */
  "events": {
    data:
      | "events"
      | "kinds"
      | "peek"
      | "watches";
    command: never;
    retired: never;
  };
  /**
   * Gardens and crops · 4 settings
   *
   * Reads (`module_data`):
   * - `farming`
   * - `garden:…`
   *
   * Retired, always refuse: `clear`, `fertilize`, `fungicide`, `grow`, `harvest`, `kill`, `pesticide`, `plant`, `water`, `weeds`.
   */
  "farming": {
    data:
      | "farming"
      | `garden:${string}`;
    command: never;
    retired: "clear" | "fertilize" | "fungicide" | "grow" | "harvest" | "kill" | "pesticide" | "plant" | "water" | "weeds";
  };
  /**
   * Window and door barricades · 7 settings
   *
   * Reads (`module_data`):
   * - `events`
   * - `fortifications`
   * - `ledger`
   * - `near:…`
   * - `openings`
   * - `owner:…`
   *
   * Writes (`module_command`):
   * - `add`
   * - `build`
   * - `destroy`
   * - `forget`
   * - `forget:CONFIRM`
   * - `heal`
   * - `place`
   * - `remove`
   * - `repair`
   * - `sethealth`
   */
  "fortifications": {
    data:
      | "events"
      | "fortifications"
      | "ledger"
      | `near:${string}`
      | "openings"
      | `owner:${string}`;
    command:
      | "add"
      | "build"
      | "destroy"
      | "forget"
      | "forget:CONFIRM"
      | "heal"
      | "place"
      | "remove"
      | "repair"
      | "sethealth";
    retired: never;
  };
  /**
   * Move items · 11 settings
   *
   * Reads (`module_data`):
   * - `last`
   *
   * Writes (`module_command`), with the verb in field 2:
   * - `…:drop`
   * - `…:dropat`
   * - `…:equip`
   * - `…:equipswap`
   * - `…:hands`
   * - `…:inventory`
   * - `…:inventoryall`
   * - `…:inventoryn`
   * - `…:remove`
   * - `…:shoulder`
   * - `…:unequip`
   */
  "give": {
    data:
      | "last";
    command:
      | `${string}:drop`
      | `${string}:drop:${string}`
      | `${string}:dropat`
      | `${string}:dropat:${string}`
      | `${string}:equip`
      | `${string}:equip:${string}`
      | `${string}:equipswap`
      | `${string}:equipswap:${string}`
      | `${string}:hands`
      | `${string}:hands:${string}`
      | `${string}:inventory`
      | `${string}:inventory:${string}`
      | `${string}:inventoryall`
      | `${string}:inventoryall:${string}`
      | `${string}:inventoryn`
      | `${string}:inventoryn:${string}`
      | `${string}:remove`
      | `${string}:remove:${string}`
      | `${string}:shoulder`
      | `${string}:shoulder:${string}`
      | `${string}:unequip`
      | `${string}:unequip:${string}`;
    retired: never;
  };
  /**
   * Radiation and wetness · 10 settings
   *
   * Reads (`module_data`):
   * - `exposure`
   * - `get:…`
   * - `groups`
   * - `measure`
   * - `measure:…`
   * - `state`
   * - `zones`
   *
   * Writes (`module_command`):
   * - `event:…`
   * - `restore`
   * - `restore:…`
   * - `set:…`
   * - `zone:…`
   */
  "hazard": {
    data:
      | "exposure"
      | `get:${string}`
      | "groups"
      | "measure"
      | `measure:${string}`
      | "state"
      | "zones";
    command:
      | `event:${string}`
      | "restore"
      | `restore:${string}`
      | `set:${string}`
      | `zone:${string}`;
    retired: never;
  };
  /**
   * Live inventories · 11 settings
   *
   * Reads (`module_data`):
   * - `counts`
   * - `inventory:…`
   * - `last`
   * - `near:…`
   * - `traps`
   * - `where:…`
   *
   * Writes (`module_command`):
   * - `condition:…`
   * - `destroy:…`
   * - `drop:…`
   */
  "items": {
    data:
      | "counts"
      | `inventory:${string}`
      | "last"
      | `near:${string}`
      | "traps"
      | `where:${string}`;
    command:
      | `condition:${string}`
      | `destroy:${string}`
      | `drop:${string}`;
    retired: never;
  };
  /**
   * Killbox · 9 settings
   *
   * Reads (`module_data`):
   * - `apex`
   * - `killbox`
   *
   * Writes (`module_command`):
   * - `activated:…` (2 fields)
   * - `finale:…` (2 fields)
   * - `panic:…:…` (3 fields)
   * - `time:…:…` (3 fields)
   * - `tune:…:…:…` (4 fields)
   */
  "killbox": {
    data:
      | "apex"
      | "killbox";
    command:
      | `activated:${string}`
      | `finale:${string}`
      | `panic:${string}:${string}`
      | `time:${string}:${string}`
      | `tune:${string}:${string}:${string}`;
    retired: never;
  };
  /**
   * Live player data · 18 settings · read-only
   *
   * Reads (`module_data`):
   * - `kills`
   * - `players`
   * - `server`
   * - `world`
   */
  "live": {
    data:
      | "kills"
      | "players"
      | "server"
      | "world";
    command: never;
    retired: never;
  };
  /**
   * Doors and locks · 11 settings
   *
   * Reads (`module_data`):
   * - `locked`
   * - `locked:…`
   * - `locks`
   * - `locks:…`
   * - `near:…`
   * - `replication`
   * - `saved`
   *
   * Writes (`module_command`):
   * - `access:…:…` (3 fields)
   * - `close:…` (2 fields)
   * - `code:…:…` (3 fields)
   * - `hp:…:…` (3 fields)
   * - `lock:…` (2 fields)
   * - `open:…` (2 fields)
   * - `tries:…:…` (3 fields)
   * - `unlock:…` (2 fields)
   */
  "locks": {
    data:
      | "locked"
      | `locked:${string}`
      | "locks"
      | `locks:${string}`
      | `near:${string}`
      | "replication"
      | "saved";
    command:
      | `access:${string}:${string}`
      | `close:${string}`
      | `code:${string}:${string}`
      | `hp:${string}:${string}`
      | `lock:${string}`
      | `open:${string}`
      | `tries:${string}:${string}`
      | `unlock:${string}`;
    retired: never;
  };
  /**
   * Loot tables · 2 settings
   *
   * Reads (`module_data`):
   * - `files`
   *
   * Writes (`module_command`):
   * - `export:…`
   */
  "loot": {
    data:
      | "files";
    command:
      | `export:${string}`;
    retired: never;
  };
  /**
   * Medical state · 12 settings
   *
   * Reads (`module_data`):
   * - `catalogue`
   * - `conditions:…`
   * - `deaths`
   * - `deaths:since:…`
   * - `fields`
   * - `lastcure`
   * - `lastchange`
   * - `lastmeta`
   * - `player:…`
   * - `players`
   * - `severities:…`
   * - `substances:…`
   *
   * Writes (`module_command`):
   * - `add:…:…` (3 fields)
   * - `bladder:…:…` (3 fields)
   * - `bleed:…:…` (3 fields)
   * - `burn:…:…` (3 fields)
   * - `cure:…:…` (3 fields)
   * - `exhaustion:…:…` (3 fields)
   * - `feed:…:…` (3 fields)
   * - `incubation:…:…` (3 fields)
   * - `infiniteoxygen:…:…` (3 fields)
   * - `infinitestamina:…:…` (3 fields)
   * - `knockout:…:…` (3 fields)
   * - `metabolism:…:…` (3 fields)
   * - `radiation:…:…` (3 fields)
   * - `remove:…:…` (3 fields)
   * - `set:…:…:…:…` (5 fields)
   * - `severity:…:…:…` (4 fields)
   * - `stamina:…:…` (3 fields)
   * - `wellbeing:…:…` (3 fields)
   */
  "medical": {
    data:
      | "catalogue"
      | `conditions:${string}`
      | "deaths"
      | `deaths:since:${string}`
      | "fields"
      | "lastcure"
      | "lastchange"
      | "lastmeta"
      | `player:${string}`
      | "players"
      | `severities:${string}`
      | `substances:${string}`;
    command:
      | `add:${string}:${string}`
      | `bladder:${string}:${string}`
      | `bleed:${string}:${string}`
      | `burn:${string}:${string}`
      | `cure:${string}:${string}`
      | `exhaustion:${string}:${string}`
      | `feed:${string}:${string}`
      | `incubation:${string}:${string}`
      | `infiniteoxygen:${string}:${string}`
      | `infinitestamina:${string}:${string}`
      | `knockout:${string}:${string}`
      | `metabolism:${string}:${string}`
      | `radiation:${string}:${string}`
      | `remove:${string}:${string}`
      | `set:${string}:${string}:${string}:${string}`
      | `severity:${string}:${string}:${string}`
      | `stamina:${string}:${string}`
      | `wellbeing:${string}:${string}`;
    retired: never;
  };
  /**
   * Server notifications · 5 settings
   *
   * Reads (`module_data`):
   * - `queue`
   *
   * Writes (`module_command`):
   * - `alert`
   * - `all`
   * - `banner`
   * - `killfeed`
   * - `killfeedall`
   */
  "notify": {
    data:
      | "queue";
    command:
      | "alert"
      | `alert:${string}`
      | "all"
      | `all:${string}`
      | "banner"
      | `banner:${string}`
      | "killfeed"
      | `killfeed:${string}`
      | "killfeedall"
      | `killfeedall:${string}`;
    retired: never;
  };
  /**
   * Offline raid protection · 5 settings
   *
   * Reads (`module_data`):
   * - `encounterBases`
   * - `flag:…`
   * - `changes`
   * - `mode`
   * - `requests`
   * - `rules`
   * - `state`
   *
   * Writes (`module_command`):
   * - `forget`
   * - `recheck`
   */
  "offline": {
    data:
      | "encounterBases"
      | `flag:${string}`
      | "changes"
      | "mode"
      | "requests"
      | "rules"
      | "state";
    command:
      | "forget"
      | `forget:${string}`
      | "recheck"
      | `recheck:${string}`;
    retired: never;
  };
  /**
   * Placement check · 2 settings · read-only
   *
   * Reads (`module_data`):
   * - `check:…`
   * - `where:…`
   * - `world`
   */
  "place": {
    data:
      | `check:${string}`
      | `where:${string}`
      | "world";
    command: never;
    retired: never;
  };
  /**
   * Fire, power and cooking · 7 settings
   *
   * Reads (`module_data`):
   * - `cooking`
   * - `heat`
   * - `power`
   *
   * Writes (`module_command`):
   * - `devicecharge:…` (2 fields)
   * - `generatorfuel:…` (2 fields)
   * - `generatoroff:…` (2 fields)
   * - `generatoron:…` (2 fields)
   * - `lightintensity:…` (2 fields)
   * - `lightoff:…` (2 fields)
   * - `lighton:…` (2 fields)
   *
   * Retired, always refuse: `deviceoff`, `deviceon`, `firefuel`, `firelight`, `fireoff`, `fireon`, `fireout`.
   */
  "power": {
    data:
      | "cooking"
      | "heat"
      | "power";
    command:
      | `devicecharge:${string}`
      | `generatorfuel:${string}`
      | `generatoroff:${string}`
      | `generatoron:${string}`
      | `lightintensity:${string}`
      | `lightoff:${string}`
      | `lighton:${string}`;
    retired: "deviceoff" | "deviceon" | "firefuel" | "firelight" | "fireoff" | "fireon" | "fireout";
  };
  /**
   * Raid protection control · 6 settings
   *
   * Reads (`module_data`):
   * - `calls`
   * - `flag:…`
   * - `changes`
   * - `layout`
   * - `manager`
   * - `offline:…`
   * - `protections`
   *
   * Writes (`module_command`):
   * - `grant:…` (2 fields, up to 4)
   * - `postpone:…` (2 fields, up to 4)
   * - `reset:…` (2 fields, up to 4)
   * - `set:…` (2 fields, up to 4)
   * - `snapshot`
   */
  "protect": {
    data:
      | "calls"
      | `flag:${string}`
      | "changes"
      | "layout"
      | "manager"
      | `offline:${string}`
      | "protections";
    command:
      | `grant:${string}`
      | `grant:${string}:${string}:${string}`
      | `postpone:${string}`
      | `postpone:${string}:${string}`
      | `postpone:${string}:${string}:${string}`
      | `reset:${string}`
      | `reset:${string}:${string}:${string}`
      | `set:${string}`
      | `set:${string}:${string}:${string}`
      | "snapshot"
      | `snapshot:${string}`
      | `snapshot:${string}:${string}:${string}`;
    retired: never;
  };
  /**
   * Quests · 8 settings
   *
   * Reads (`module_data`):
   * - `activity`
   * - `areas`
   * - `catalogue`
   * - `givers`
   * - `outposts`
   * - `player:…`
   * - `quest:…`
   * - `quests`
   * - `timed`
   *
   * Writes (`module_command`):
   * - `abandon`
   * - `abandontask`
   * - `cycle:…` (2 fields, up to 3)
   * - `track`
   *
   * Retired, always refuse: `complete`, `completequest`, `completetask`, `give`, `start`, `startquest`, `starttask`.
   */
  "quests": {
    data:
      | "activity"
      | "areas"
      | "catalogue"
      | "givers"
      | "outposts"
      | `player:${string}`
      | `quest:${string}`
      | "quests"
      | "timed";
    command:
      | "abandon"
      | `abandon:${string}`
      | "abandontask"
      | `abandontask:${string}`
      | `cycle:${string}`
      | `cycle:${string}:${string}`
      | "track"
      | `track:${string}`;
    retired: "complete" | "completequest" | "completetask" | "give" | "start" | "startquest" | "starttask";
  };
  /**
   * Raid detection · 5 settings
   *
   * Reads (`module_data`):
   * - `all`
   * - `announcements`
   * - `base:…`
   * - `bases`
   * - `encounters`
   * - `raids`
   * - `reasons`
   *
   * Writes (`module_command`):
   * - `announce:…` (2 fields, up to 3)
   * - `end:…` (2 fields)
   * - `forget:…:…` (3 fields)
   * - `start:…` (2 fields, up to 5)
   */
  "raid": {
    data:
      | "all"
      | "announcements"
      | `base:${string}`
      | "bases"
      | "encounters"
      | "raids"
      | "reasons";
    command:
      | `announce:${string}`
      | `announce:${string}:${string}`
      | `end:${string}`
      | `forget:${string}:${string}`
      | `start:${string}`
      | `start:${string}:${string}:${string}:${string}`;
    retired: never;
  };
  /**
   * Vehicle condition · 14 settings
   *
   * Reads (`module_data`):
   * - `resolve:…`
   *
   * Writes (`module_command`), with the verb in field 2:
   * - `…:access`
   * - `…:battery`
   * - `…:colors`
   * - `…:damage`
   * - `…:destroy`
   * - `…:fuel`
   * - `…:mileage`
   * - `…:owner`
   * - `…:pattern`
   * - `…:rename`
   * - `…:repair`
   * - `…:tyre`
   */
  "repair": {
    data:
      | `resolve:${string}`;
    command:
      | `${string}:access`
      | `${string}:access:${string}`
      | `${string}:battery`
      | `${string}:battery:${string}`
      | `${string}:colors`
      | `${string}:colors:${string}`
      | `${string}:damage`
      | `${string}:damage:${string}`
      | `${string}:destroy`
      | `${string}:destroy:${string}`
      | `${string}:fuel`
      | `${string}:fuel:${string}`
      | `${string}:mileage`
      | `${string}:mileage:${string}`
      | `${string}:owner`
      | `${string}:owner:${string}`
      | `${string}:pattern`
      | `${string}:pattern:${string}`
      | `${string}:rename`
      | `${string}:rename:${string}`
      | `${string}:repair`
      | `${string}:repair:${string}`
      | `${string}:tyre`
      | `${string}:tyre:${string}`;
    retired: never;
  };
  /**
   * Server browser report · 1 settings
   *
   * Reads (`module_data`):
   * - `status`
   */
  "report": {
    data:
      | "status";
    command: never;
    retired: never;
  };
  /**
   * Fuel & resource stations · 4 settings
   *
   * Reads (`module_data`):
   * - `resources`
   * - `stations`
   * - `stations:…`
   *
   * Writes (`module_command`):
   * - `near`
   *
   * Retired, always refuse: `fill`, `set`.
   */
  "resources": {
    data:
      | "resources"
      | "stations"
      | `stations:${string}`;
    command:
      | "near"
      | `near:${string}`;
    retired: "fill" | "set";
  };
  /**
   * Respawn timers · 2 settings
   *
   * Reads (`module_data`):
   * - `timers:…`
   *
   * Writes (`module_command`):
   * - `clear:…` (2 fields)
   * - `set:…:…:…` (4 fields)
   */
  "respawn": {
    data:
      | `timers:${string}`;
    command:
      | `clear:${string}`
      | `set:${string}:${string}:${string}`;
    retired: never;
  };
  /**
   * Live server settings · 1 settings
   *
   * Reads (`module_data`):
   * - `categories`
   * - `get:…`
   * - `changes`
   * - `list`
   * - `list:…`
   * - `outstanding`
   * - `probe:…`
   * - `section:…`
   * - `values:…`
   * - `valuesfrom:…`
   *
   * Retired, always refuse: `revert`, `revertall`, `set`.
   */
  "settings": {
    data:
      | "categories"
      | `get:${string}`
      | "changes"
      | "list"
      | `list:${string}`
      | "outstanding"
      | `probe:${string}`
      | `section:${string}`
      | `values:${string}`
      | `valuesfrom:${string}`;
    command: never;
    retired: "revert" | "revertall" | "set";
  };
  /**
   * Precise spawning · 9 settings
   *
   * Reads (`module_data`):
   * - `check:…`
   * - `kinds`
   * - `loadcheck:…`
   * - `persistence`
   * - `persistent:…`
   * - `spawn:…`
   *
   * Writes (`module_command`):
   * - `load:…`
   */
  "spawn": {
    data:
      | `check:${string}`
      | "kinds"
      | `loadcheck:${string}`
      | "persistence"
      | `persistent:${string}`
      | `spawn:${string}`;
    command:
      | `load:${string}`;
    retired: never;
  };
  /**
   * Spawn points · 2 settings
   *
   * Reads (`module_data`):
   * - `list`
   * - `map`
   * - `respawn`
   *
   * Writes (`module_command`):
   * - `disable:…:…` (3 fields)
   * - `enable:…:…` (3 fields)
   */
  "spawnpoints": {
    data:
      | "list"
      | "map"
      | "respawn";
    command:
      | `disable:${string}:${string}`
      | `enable:${string}:${string}`;
    retired: never;
  };
  /**
   * Live squads · 7 settings
   *
   * Reads (`module_data`):
   * - `board`
   * - `destroyed`
   * - `member:…`
   * - `names:…`
   * - `squad:…`
   * - `squads`
   *
   * Writes (`module_command`):
   * - `add`
   * - `board`
   * - `disband`
   * - `info`
   * - `message`
   * - `names`
   * - `remove`
   * - `removeall`
   * - `rename`
   */
  "squads": {
    data:
      | "board"
      | "destroyed"
      | `member:${string}`
      | `names:${string}`
      | `squad:${string}`
      | "squads";
    command:
      | "add"
      | `add:${string}`
      | "board"
      | `board:${string}`
      | "disband"
      | `disband:${string}`
      | "info"
      | `info:${string}`
      | "message"
      | `message:${string}`
      | "names"
      | `names:${string}`
      | "remove"
      | `remove:${string}`
      | "removeall"
      | `removeall:${string}`
      | "rename"
      | `rename:${string}`;
    retired: never;
  };
  /**
   * Placed containers and items · 5 settings
   *
   * Reads (`module_data`):
   * - `check:…`
   * - `job:…`
   * - `jobs`
   *
   * Writes (`module_command`):
   * - `detonate`
   * - `fill:…:…:…:…` (5 fields)
   * - `place:…:…:…` (4 fields)
   */
  "stash": {
    data:
      | `check:${string}`
      | `job:${string}`
      | "jobs";
    command:
      | "detonate"
      | `detonate:${string}`
      | `fill:${string}:${string}:${string}:${string}`
      | `place:${string}:${string}:${string}`;
    retired: never;
  };
  /**
   * Survival stats · 11 settings
   *
   * Reads (`module_data`):
   * - `attributes`
   * - `attributes:…`
   * - `fame`
   * - `kills`
   * - `kills:…`
   * - `lastskill`
   * - `ranking`
   * - `rankwords`
   * - `skillinfo:…`
   * - `skills:…`
   * - `stats`
   * - `stats:…`
   * - `stats:steam:…`
   *
   * Writes (`module_command`):
   * - `attributes`
   * - `attributes:…`
   * - `clear`
   * - `clear:CONFIRM`
   * - `forgive`
   * - `forgive:…`
   * - `rank`
   * - `rank:…`
   * - `refresh`
   * - `refresh:…`
   * - `skill:…`
   * - `skilllevel:…`
   */
  "stats": {
    data:
      | "attributes"
      | `attributes:${string}`
      | "fame"
      | "kills"
      | `kills:${string}`
      | "lastskill"
      | "ranking"
      | "rankwords"
      | `skillinfo:${string}`
      | `skills:${string}`
      | "stats"
      | `stats:${string}`
      | `stats:steam:${string}`;
    command:
      | "attributes"
      | `attributes:${string}`
      | "clear"
      | "clear:CONFIRM"
      | "forgive"
      | `forgive:${string}`
      | "rank"
      | `rank:${string}`
      | "refresh"
      | `refresh:${string}`
      | `skill:${string}`
      | `skilllevel:${string}`;
    retired: never;
  };
  /**
   * Live storage · 10 settings
   *
   * Reads (`module_data`):
   * - `contents:…`
   * - `dropcheck:…`
   * - `lastdestroy`
   * - `lockboxes`
   * - `storage`
   *
   * Writes (`module_command`):
   * - `destroy:…`
   * - `drop:…`
   * - `move:…`
   * - `observe:…`
   * - `take:…`
   */
  "storage": {
    data:
      | `contents:${string}`
      | `dropcheck:${string}`
      | "lastdestroy"
      | "lockboxes"
      | "storage";
    command:
      | `destroy:${string}`
      | `drop:${string}`
      | `move:${string}`
      | `observe:${string}`
      | `take:${string}`;
    retired: never;
  };
  /**
   * Teleport · 7 settings
   *
   * Reads (`module_data`):
   * - `corpses`
   * - `inflight`
   * - `origin:…`
   * - `origins`
   *
   * Writes (`module_command`):
   * - `back:…` (2 fields, up to 3)
   * - `corpse:…:…:…:…:…` (6 fields, up to 8)
   * - `face:…:…:…` (4 fields, up to 8)
   * - `item:…:…:…:…:…:…` (7 fields, up to 9)
   * - `player:…:…:…:…:…` (6 fields, up to 8)
   * - `squad:…:…:…:…:…` (6 fields, up to 8)
   * - `swap:…:…` (3 fields, up to 5)
   * - `toplayer:…:…` (3 fields, up to 5)
   * - `vehicle:…:…:…:…:…:…` (7 fields, up to 9)
   */
  "teleport": {
    data:
      | "corpses"
      | "inflight"
      | `origin:${string}`
      | "origins";
    command:
      | `back:${string}`
      | `back:${string}:${string}`
      | `corpse:${string}:${string}:${string}:${string}:${string}`
      | `corpse:${string}:${string}:${string}:${string}:${string}:${string}`
      | `corpse:${string}:${string}:${string}:${string}:${string}:${string}:${string}`
      | `face:${string}:${string}:${string}`
      | `face:${string}:${string}:${string}:${string}`
      | `face:${string}:${string}:${string}:${string}:${string}:${string}`
      | `face:${string}:${string}:${string}:${string}:${string}:${string}:${string}`
      | `item:${string}:${string}:${string}:${string}:${string}:${string}`
      | `item:${string}:${string}:${string}:${string}:${string}:${string}:${string}`
      | `item:${string}:${string}:${string}:${string}:${string}:${string}:${string}:${string}`
      | `player:${string}:${string}:${string}:${string}:${string}`
      | `player:${string}:${string}:${string}:${string}:${string}:${string}`
      | `player:${string}:${string}:${string}:${string}:${string}:${string}:${string}`
      | `squad:${string}:${string}:${string}:${string}:${string}`
      | `squad:${string}:${string}:${string}:${string}:${string}:${string}`
      | `squad:${string}:${string}:${string}:${string}:${string}:${string}:${string}`
      | `swap:${string}:${string}`
      | `swap:${string}:${string}:${string}`
      | `swap:${string}:${string}:${string}:${string}`
      | `toplayer:${string}:${string}`
      | `toplayer:${string}:${string}:${string}`
      | `toplayer:${string}:${string}:${string}:${string}`
      | `vehicle:${string}:${string}:${string}:${string}:${string}:${string}`
      | `vehicle:${string}:${string}:${string}:${string}:${string}:${string}:${string}`
      | `vehicle:${string}:${string}:${string}:${string}:${string}:${string}:${string}:${string}`;
    retired: never;
  };
  /**
   * Trade outposts · 8 settings
   *
   * Reads (`module_data`):
   * - `bank`
   * - `economy`
   * - `prices`
   * - `prices:…`
   * - `trade`
   * - `writable`
   *
   * Writes (`module_command`):
   * - `economy:…`
   * - `randomizeprices`
   * - `reseteconomy`
   */
  "trade": {
    data:
      | "bank"
      | "economy"
      | "prices"
      | `prices:${string}`
      | "trade"
      | "writable";
    command:
      | `economy:${string}`
      | "randomizeprices"
      | "reseteconomy";
    retired: never;
  };
  /**
   * Live vehicles · 11 settings · read-only
   *
   * Reads (`module_data`):
   * - `manager`
   * - `vehicles`
   */
  "vehicles": {
    data:
      | "manager"
      | "vehicles";
    command: never;
    retired: never;
  };
  /**
   * Owners of mines, bedrolls and trader depots · 5 settings · read-only
   *
   * Reads (`module_data`):
   * - `containers`
   * - `owners`
   * - `repdata`
   * - `survey`
   * - `virtualized`
   * - `virtualized:…`
   * - `virtualized:`
   */
  "virtual": {
    data:
      | "containers"
      | "owners"
      | "repdata"
      | "survey"
      | "virtualized"
      | `virtualized:${string}`
      | "virtualized:";
    command: never;
    retired: never;
  };
  /**
   * Votes and tournaments · 3 settings
   *
   * Reads (`module_data`):
   * - `tournament`
   * - `vote`
   *
   * Writes (`module_command`):
   * - `tournamentend`
   * - `votecancel`
   */
  "vote": {
    data:
      | "tournament"
      | "vote";
    command:
      | "tournamentend"
      | "votecancel";
    retired: never;
  };
  /**
   * Vehicles far from players · 2 settings
   *
   * Reads (`module_data`):
   * - `near:…`
   * - `reach`
   *
   * Writes (`module_command`):
   * - `vehicles:…` (2 fields)
   */
  "wake": {
    data:
      | `near:${string}`
      | "reach";
    command:
      | `vehicles:${string}`;
    retired: never;
  };
  /**
   * Wildlife population · 3 settings
   *
   * Reads (`module_data`):
   * - `biomes`
   * - `census`
   * - `feeders`
   * - `fish`
   * - `limits`
   * - `water`
   *
   * Writes (`module_command`):
   * - `density:…:…:…:…` (5 fields)
   * - `fishweight:…:…:…` (4 fields)
   * - `set:…:…` (3 fields)
   */
  "wildlife": {
    data:
      | "biomes"
      | "census"
      | "feeders"
      | "fish"
      | "limits"
      | "water";
    command:
      | `density:${string}:${string}:${string}:${string}`
      | `fishweight:${string}:${string}:${string}`
      | `set:${string}:${string}`;
    retired: never;
  };
  /**
   * Levels and streaming · 4 settings
   *
   * Reads (`module_data`):
   * - `distant`
   * - `find:…`
   * - `level:…`
   * - `levels`
   * - `levels:loaded`
   * - `levels:unloaded`
   * - `managers`
   * - `summary`
   *
   * Writes (`module_command`):
   * - `stream:…`
   * - `unload`
   * - `unstream`
   */
  "world": {
    data:
      | "distant"
      | `find:${string}`
      | `level:${string}`
      | "levels"
      | "levels:loaded"
      | "levels:unloaded"
      | "managers"
      | "summary";
    command:
      | `stream:${string}`
      | "unload"
      | "unstream";
    retired: never;
  };
  /**
   * Live world events · 9 settings
   *
   * Reads (`module_data`):
   * - `events`
   * - `ledger`
   * - `ledger:…`
   * - `ledger:at:…`
   * - `ledger:player:…`
   *
   * Writes (`module_command`):
   * - `cancel`
   * - `cancelforce`
   * - `cargodetonate`
   * - `cargodrop`
   * - `clearscores`
   * - `cooldown`
   * - `eventmove`
   * - `eventradius`
   * - `join`
   * - `kick`
   * - `leave`
   * - `resetarea`
   * - `schedule`
   */
  "worldevents": {
    data:
      | "events"
      | "ledger"
      | `ledger:${string}`
      | `ledger:at:${string}`
      | `ledger:player:${string}`;
    command:
      | "cancel"
      | `cancel:${string}`
      | "cancelforce"
      | `cancelforce:${string}`
      | "cargodetonate"
      | `cargodetonate:${string}`
      | "cargodrop"
      | `cargodrop:${string}`
      | "clearscores"
      | `clearscores:${string}`
      | "cooldown"
      | `cooldown:${string}`
      | "eventmove"
      | `eventmove:${string}`
      | "eventradius"
      | `eventradius:${string}`
      | "join"
      | `join:${string}`
      | "kick"
      | `kick:${string}`
      | "leave"
      | `leave:${string}`
      | "resetarea"
      | `resetarea:${string}`
      | "schedule"
      | `schedule:${string}`;
    retired: never;
  };
  /**
   * Custom zones · 6 settings
   *
   * Reads (`module_data`):
   * - `border`
   * - `config:…`
   * - `defaults`
   * - `enums`
   * - `global`
   * - `guarded`
   * - `spawners`
   * - `spawners:…`
   * - `zone:…`
   * - `zones`
   *
   * Writes (`module_command`):
   * - `assign:…`
   * - `batch:…`
   * - `clear`
   * - `clear:…`
   * - `clear:CONFIRM`
   * - `config:…`
   * - `copy:…`
   * - `delete:…`
   * - `global:…`
   * - `guardedtune:…`
   * - `mapreload`
   * - `move:…`
   * - `order:…`
   * - `refresh`
   * - `rename:…`
   * - `resize:…`
   * - `restore:…`
   * - `set:…`
   * - `shape:…`
   */
  "zones": {
    data:
      | "border"
      | `config:${string}`
      | "defaults"
      | "enums"
      | "global"
      | "guarded"
      | "spawners"
      | `spawners:${string}`
      | `zone:${string}`
      | "zones";
    command:
      | `assign:${string}`
      | `batch:${string}`
      | "clear"
      | `clear:${string}`
      | "clear:CONFIRM"
      | `config:${string}`
      | `copy:${string}`
      | `delete:${string}`
      | `global:${string}`
      | `guardedtune:${string}`
      | "mapreload"
      | `move:${string}`
      | `order:${string}`
      | "refresh"
      | `rename:${string}`
      | `resize:${string}`
      | `restore:${string}`
      | `set:${string}`
      | `shape:${string}`;
    retired: never;
  };
}

/**
 * Every module's settings, as `module_config` takes them and `modules` reports them. All
 * optional here because `module_config` REPLACES the whole object and a missing key falls back
 * to its default: read `modules`, change the object, send all of it.
 */
export interface ModuleSettingsMap {
  "actions": {
    /** Allow in-game actions. Master switch for every action below. Each changes a real player's character at once. */
    enabled?: boolean;
    /** Revive a downed player. Brings a downed player back on their feet without them having to respawn. */
    revive?: boolean;
    /** Death, respawn and possession. Kill a stuck prisoner, open the respawn screen, set the suicide wait, or return a player to their body. */
    life?: boolean;
    /** Set a player's money or gold. Sets a player's money or gold on screen only; it never reaches the saved balance. */
    currency?: boolean;
    /** Set fame points. Sets an online player's fame points outright, and the game writes that figure out at its next save. */
    fame?: boolean;
    /** Save a player on demand, and load them back. Saves a player now instead of at the next autosave, except money and gold, or reloads them. */
    persist?: boolean;
    /** God mode, immortality, infinite ammo, super jump. Turns god mode, immortality, infinite ammo or super jump on or off. Server admins only: the game bans anyone else. */
    flags?: boolean;
    /** Set how wet a player is. Sets how wet each of a player's four body parts is, from dry to soaked, and the game keeps it. */
    wetness?: boolean;
    /** Put text on a player's screen, or fade it. Puts a line in one player's message feed or kill feed, or fades their screen to black and back. */
    messages?: boolean;
    /** Gender and movement pace. Changes a prisoner's gender, or nudges them to walk, jog or sprint. */
    body?: boolean;
    /** Crouch depth. Sets how deep a player crouches, from 0 upright to 1 deepest. */
    stance?: boolean;
    /** Make a player vomit, cough or worse. Plays the vomiting, urinating, defecating, coughing or sneezing effect on a player, for everyone nearby to see and hear. */
    effects?: boolean;
    /** Give a player a fake name. Changes the name everyone else sees above a player until the server restarts, and clears it again. */
    naming?: boolean;
    /** Write money and fame permanently. Pays or charges money, gold and fame so it lands in the save as well as on screen. */
    database?: boolean;
    /** Kick a player. Removes a player from the server with a reason they can read, through the game's own kick. */
    kick?: boolean;
    /** Equipment, cuffs, night vision, free look, limp, disarm, unmount. Strips, disarms, uncuffs, adjusts cuffs, toggles night vision, free look or a limp, and pulls a player off what they are riding. */
    gear?: boolean;
    /** Squad membership. Joins, leaves, promotes, demotes and creates squads, without the player being asked. */
    squads?: boolean;
    /** Stop a player talking in chat. Stops a player chatting in local, global or squad chat, for some hours or until lifted. */
    silence?: boolean;
  };
  "ai": {
    /** Read what creatures are doing, and allow the changes below. Reports each creature's stance, target, health and position. Creatures only exist near players. (default false) */
    enabled?: boolean;
    /** Include animals and sharks. Includes wildlife in every read and change; with it off, animals are refused. (default true, applies when `enabled`) */
    animals?: boolean;
    /** Allow changing a live creature. Lets one creature, named by the id this module reported, have its health, target, stance or flags set, or be removed from the world. (default false, applies when `enabled`) */
    write?: boolean;
  };
  "bases": {
    /** Report bases and raid protection. Reports bases, building rules and which flags have raid protection entries. Changes nothing. */
    enabled?: boolean;
    /** Which flags have a raid-protection entry. Lists flags with a raid-protection entry. An entry does not mean protected right now. (default true) */
    protection?: boolean;
    /** The bases themselves. Lists every base with the id the database knows it by, its name and where it stands. (default true) */
    bases?: boolean;
    /** How much each base is built from. Counts how many pieces, and how many kinds, each base is built from. (default true, applies when `bases`) */
    contents?: boolean;
    /** Server-wide flag and building rules. Reports flag radius, overtake time, element and flag limits, and the build-height ceiling. (default true) */
    rules?: boolean;
  };
  "build": {
    /** Allow base building actions. Turns on building, removing and re-owning player structures from outside the game; nothing it does can be undone. */
    enabled?: boolean;
    /** Spawn base elements. Places a structure into an existing base at coordinates you give. Unconfirmed — check in game. */
    spawn?: boolean;
    /** Destroy one base element. Removes one structure; anything a load-bearing piece carried goes with it. */
    destroy?: boolean;
    /** Transfer ownership. Hands everything a profile owns to another, or takes a flag over. */
    ownership?: boolean;
    /** Remember the elements the game touches. Remembers element ids as structures are built, decay or are hit; needed to name one. (default true) */
    index?: boolean;
    /** Demolish everything in a radius (DANGEROUS). Destroys every structure of the kinds you name whose footprint the sphere touches, in one call, with no undo. */
    demolish?: boolean;
    /** Demolition radius cap (cm). The furthest one demolish may reach, in centimetres; a bigger request is refused rather than trimmed. (default 2000, min 100, max 1000000, applies when `demolish`) */
    maxRadius?: number;
    /** Quality of a spawned element. The quality value a spawned structure is given. What the game then does with that value is not known. (default 100, min 0, max 100, applies when `spawn`) */
    qualityPercent?: number;
  };
  "climate": {
    /** Change the weather and the time of day. Sets the weather and the clock directly: rain, fog, wind, cloud, temperature, sunrise, sunset and day length, with nobody online. */
    enabled?: boolean;
    /** Change how the weather controller itself runs. Changes how the weather controller runs rather than what the sky looks like: saving, update intervals and config overrides. (applies when `enabled`) */
    system?: boolean;
  };
  "craft": {
    /** Report crafting and fishing. Reports half-built base elements, who is fishing, and every catch, craft and cook. Not recipes. */
    enabled?: boolean;
    /** Unfinished base-building placements. Lists base elements placed but not finished, and how much of each ingredient went in. (default true) */
    placements?: boolean;
    /** Per-slot ingredient counts. Breaks each placement down slot by slot: what each slot needs and what has gone in. (applies when `placements`) */
    slots?: boolean;
    /** Where placements and rods are. Adds coordinates to each half-built placement and each fishing rod in use. */
    position?: boolean;
    /** Who is fishing. Lists who is fishing, whether they are casting, waiting or reeling, and what is hooked. (default true) */
    fishing?: boolean;
    /** Rod detail. Adds each rod's cast power, its short-cast flag and its fitted attachments. (applies when `fishing`) */
    rodDetail?: boolean;
    /** What each player is doing right now. Names the action each online player is running this instant - crafting, washing, repainting, lighting a fire - as the game's own class name. No progress figure exists. */
    actions?: boolean;
    /** Catches as they happen. Records every fish landed, with species, mass and size, and whether the player kept it or threw it back. */
    eventsFishing?: boolean;
    /** Crafts and uncrafts as they happen. Records crafts started, finished and taken apart. Pay rewards on the finish, not the start. */
    eventsCrafting?: boolean;
    /** Cooking as it happens. Records pots put on the fire, food collected and pots taken off early, with player and recipe. */
    eventsCooking?: boolean;
    /** Resolve player names. Puts the player's name on each recorded event instead of leaving you to join it up yourself. (default true) */
    names?: boolean;
  };
  "damage": {
    /** Look at what is standing at a set of coordinates. Reports what stands inside a sphere and records the last blast; changes nothing on its own. (default false) */
    enabled?: boolean;
    /** Set off an explosion at coordinates (DANGEROUS). Sets off a real explosion at the coordinates you name, as wide as the radius. (default false, applies when `enabled`) */
    explode?: boolean;
    /** Radius cap (cm). The furthest one call may reach, in centimetres; a call asking for more is refused. (default 1500, min 100, max 1000000, applies when `enabled`) */
    maxRadius?: number;
    /** Damage cap per blast. The most damage one blast may apply at its centre; a call asking for more is refused. (default 200, min 1, max 5000, applies when `explode`) */
    maxDamage?: number;
    /** Allow a blast that a player is standing in. Permits a blast with a player inside its radius, which is otherwise refused outright however the call is written. (default false, applies when `explode`) */
    allowPlayers?: boolean;
    /** Refuse a blast with a vehicle inside it. Refuses a blast with a vehicle inside its radius, with no word a call can add to override it. (default true, applies when `explode`) */
    protectVehicles?: boolean;
    /** Mark the blast as event damage. Marks each blast as event damage rather than damage from somebody's weapon. (default true, applies when `explode`) */
    eventDamage?: boolean;
  };
  "despawn": {
    /** Allow removing things from the world. Allows removing one named object, or everything of a kind inside a sphere. No undo. (default false) */
    enabled?: boolean;
    /** Remove animals. Removes animals one at a time or everything of the kind inside a radius. (default false, applies when `enabled`) */
    animals?: boolean;
    /** Remove sharks and other large aquatic animals. Removes sharks and other large aquatic animals from a stretch of water. (default false, applies when `enabled`) */
    sharks?: boolean;
    /** Remove mechanoid drones. Removes mechanoid drones through the game's own self-destruct, which players nearby see and hear. (default false, applies when `enabled`) */
    drones?: boolean;
    /** Remove dropship-dropped sentries. Removes the sentries a base-attack dropship drops on a raid. Whether the attack drops another is not established. (default false, applies when `enabled`) */
    sentries?: boolean;
    /** Remove puppets (zombies). Removes puppets, leaving no corpse and crediting nobody with the kill. (default false, applies when `enabled`) */
    puppets?: boolean;
    /** Remove armed NPCs. Removes armed NPCs — drifters and guards — leaving no corpse and no gear behind. (default false, applies when `enabled`) */
    npcs?: boolean;
    /** Remove Brenner. Removes a Brenner outright instead of killing it; whether whatever spawned it treats that as a death is not established. (default false, applies when `enabled`) */
    brenners?: boolean;
    /** Remove Razor. Removes a Razor outright instead of killing it; whether whatever spawned it treats that as a death is not established. (default false, applies when `enabled`) */
    razors?: boolean;
    /** Remove Dropship. Removes a Dropship of any kind, and not the sentries it has already dropped. (default false, applies when `enabled`) */
    dropships?: boolean;
    /** Remove fixed map sentries. Removes fixed sentries. The game replaces them within seconds while a player is near; stow them instead. (default false, applies when `enabled`) */
    mapsentries?: boolean;
    /** Remove vehicles. Removes a vehicle and everything inside it; one with somebody in the driver's seat is skipped and reported. (default false, applies when `enabled`) */
    vehicles?: boolean;
    /** Remove fish schools. Removes shoals of small fish, which the game goes on spawning around players by itself. (default false, applies when `enabled`) */
    fishschools?: boolean;
    /** Remove cargo drop containers. Removes an airdrop crate before its own detonation clock does. (default false, applies when `enabled`) */
    cargo?: boolean;
    /** Remove drop zone crates and cargo. Removes the Drop Zone event's crates and its cargo, both classes in one call. (default false, applies when `enabled`) */
    dropzones?: boolean;
    /** Remove any other actor class by name. Removes any other actor class you name, with only a deny list protecting anything. (default false, applies when `enabled`) */
    actors?: boolean;
    /** Make a radius sweep end in the word CONFIRM. Refuses any radius sweep that does not end in the literal word CONFIRM; removing one named object never needs it. (default false, applies when `enabled`) */
    requireConfirm?: boolean;
    /** Put fixed map sentries away instead of removing them. Hides a fixed sentry underground, frozen, one by id. It is not removed, so it is not replaced. (default false, applies when `enabled`) */
    stowSentries?: boolean;
    /** Sentry depth below ground (cm). How far down a sentry is put, in centimetres (100 = 1 m). Never below the kill floor. (default 9000, min 1000, max 20000, applies when `stowSentries`) */
    stowDepth?: number;
    /** Most one call may remove. The most one call may remove; a call that would exceed it is refused whole rather than trimmed to fit. (default 25, min 1, max 200, applies when `enabled`) */
    maxPerCall?: number;
    /** Largest radius one call may use (cm). The largest radius one call may use, in centimetres, and it is a sphere rather than a circle. (default 5000, min 100, max 1000000, applies when `enabled`) */
    maxRadius?: number;
  };
  "doors": {
    /** What to do at server start. (default "random") */
    mode?: "random" | "persist";
    /** How many doors to open. What share of the doors your filters already allow gets opened at each start. (default 25, min 0, max 100, applies when `mode=random`) */
    chance?: number;
    /** Save the world every (seconds). How often every door's state is written down while the server runs; 0 writes it only when the manager asks. (default 60, min 0, max 3600, applies when `mode=persist`) */
    saveEvery?: number;
    /** Close them again. When a sweep may shut doors again: never, once after each restart, or repeatedly while the server runs. (default "off") */
    closeMode?: "off" | "restart" | "periodic";
    /** Close every (minutes). How long between sweeps, timed from the end of the last one so two can never overlap. (default 30, min 1, max 1440, applies when `closeMode=periodic`) */
    closeEvery?: number;
    /** Doors per sweep. How many doors one sweep may close; 0 closes everything that passes the guards. (default 0, min 0, max 100000, applies when `closeMode!=off`) */
    closeCount?: number;
    /** Never close within (metres) of a player. No door within this distance of a player is shut; 0 turns the guard off. (default 60, min 0, max 2000, applies when `closeMode!=off`) */
    keepAway?: number;
    /** Also close doors players left open. Lets a sweep also close doors players left open, not only the ones this module opened. (default false, applies when `closeMode!=off`) */
    closeOthers?: boolean;
    /** …but only after it has stood open for (minutes). How long a door must have stood open before a sweep will touch it. (default 360, min 1, max 20160, applies when `closeOthers`) */
    closeAfter?: number;
    /** Never touch bunker and killbox doors. Leaves alone every door the game itself marks as belonging to a bunker or a killbox. (default true) */
    skipSpecial?: boolean;
    /** Never touch a door a player owns. Leaves alone every door a player has locked, claimed or upgraded. (default true) */
    skipOwned?: boolean;
    /** Never touch player-built doors. Leaves alone doors players built themselves, as opposed to doors the map shipped with. (default true) */
    skipBaseDoor?: boolean;
    /** Skip broken doors. Leaves alone doors the game has already recorded as broken down. (default true) */
    skipBroken?: boolean;
    /** Skip anything that could take a lock. Leaves alone every door that could take a lock, which is nearly all of them. (default false) */
    skipLockable?: boolean;
    /** Leave already-open doors alone. Leaves doors that are already open where they are, instead of counting them towards the share you asked for. (default true) */
    skipOpen?: boolean;
    /** Places to leave alone. Places this feature never touches, matched against the door's whole name. (default "tv_base,zeljava,military,prison,coalmine,_mine_,stone_mine,nuclearplant,weaponsfactory,killbox,bunker,silo,armory,vault,secret", comma-separated) */
    denyLevels?: string;
    /** Only these places. Restricts the whole feature to these places and nowhere else; empty means everywhere that is not blocked above. (default "", comma-separated) */
    allowLevels?: string;
    /** Door types to leave alone. The kinds of door to leave alone, matched against what the door is rather than against where it stands. (default "bunker,killbox,armory,vault,prison,silo,hangar,secret,gate,elevator,airlock,cargo,safe", comma-separated) */
    denyClasses?: string;
    /** Let a door be sealed shut. Lets one named door be held in place until released. A restart releases it. (default true) */
    seal?: boolean;
    /** Dry run. Counts what would happen and changes nothing in the world. (default false) */
    dryrun?: boolean;
    /** Settle time (seconds). How long a newly built door is left alone before anything judges it. (default 3, min 1, max 60) */
    settle?: number;
    /** Doors done at a time. How many doors are handled at a time while the world is loading. (default 200, min 1, max 2000) */
    batch?: number;
  };
  "encounters": {
    /** Read encounters, and allow the changes below. Reports the game's own hordes, dropship raids and base ambushes: where, and how big. (default false) */
    enabled?: boolean;
    /** Encounter manager settings. Reports the encounter system's current numbers, read live from the running game. (default true) */
    tuning?: boolean;
    /** Live hordes. Reports whether a horde is active right now, how many are in it and where each pack is standing. (default true) */
    hordes?: boolean;
    /** Horde grouping distance (cm). How far apart two packs must be to count as separate hordes; head counts stay exact. (default 6000, min 100, max 100000, applies when `hordes`) */
    hordeRadius?: number;
    /** Game event schedule. Reports which competitive events the game has announced, which are running and which have already finished. (default true) */
    schedule?: boolean;
    /** Allow encounters to be forced. Allows forcing a base ambush on a named player's base. No undo: it cannot be called off. (default false) */
    writes?: boolean;
    /** Allow changing how busy a kind of place is. Changes how often puppets and NPCs spawn at a kind of place; every place of that kind changes. (default false) */
    zonetune?: boolean;
    /** Put a change back after (seconds). Longest a change may last; after that it is put back, even if the manager stops. (default 900, min 30, max 21600, applies when `zonetune`) */
    zoneHold?: number;
  };
  "entities": {
    /** What to track. Which kinds of thing to show on the map, live. Each one adds work to every refresh. (default "puppet,animal,shark,sentry,sentry_d,drifter,guard,npc,drone,dropship,boss,boss2,base,vehicle,boat,cart", comma-separated) */
    kinds?: string;
    /** Update positions every (seconds). How often every tracked thing's position is read again; each pass costs the server CPU time. (default 5, min 1, max 60) */
    refresh?: number;
    /** Group base structures within (metres). Base structures this close together are listed as one base with an average condition. (default 30, min 5, max 500) */
    groupDistance?: number;
    /** Most things to track at once. The most things this module will hold at once; anything past it is ignored and counted on the status line. (default 25000, min 100, max 60000) */
    maxTracked?: number;
    /** Settle time (seconds). Wait before reading a new thing's position, so it is not shown at zero. (default 2, min 1, max 60) */
    settle?: number;
    /** Allow changing tracked entities. Lets a tracked thing's properties be written by name, including the devices inside a vehicle, with nothing to undo it. (default false) */
    write?: boolean;
  };
  "events": {
    /** Report game events as they happen. Reports events as they happen, before or instead of the log files. Each kind below costs extra. */
    enabled?: boolean;
    /** Kills. Reports who killed whom the moment it happens, with the place the victim died, before the kill log is written. (default true) */
    kills?: boolean;
    /** Trader purchases and sales. Reports each purchase or sale: the player, the trader, where, and whether they paid cash. (default true) */
    trades?: boolean;
    /** Squad joins and leaves. Reports the moment somebody joins or leaves a squad, and whether the leaving dissolved it. (default true) */
    squads?: boolean;
    /** Flag owner changes and overtakes. Reports flags changing owner, and flag overtakes with the taker and the place. (default true) */
    flags?: boolean;
    /** Vehicles destroyed. Reports a vehicle being destroyed, with the place it died and the id that joins to the database. (default true) */
    vehicles?: boolean;
    /** Items picked up and dropped. Reports who picked up or dropped what, and where. Fires constantly on a busy server. */
    items?: boolean;
    /** Deaths. Reports a death and where it happened. A death that skips the respawn screen may not appear. (default true) */
    deaths?: boolean;
    /** Base elements opened, closed and locked. Reports who opened, closed or locked which door, gate or lock of which base, and where that element stands. */
    bases?: boolean;
    /** Containers opened. Reports each chest, corpse or vehicle boot opened, by whom and where — not what was taken. */
    containers?: boolean;
    /** Kills inside competitive events. Reports a kill inside one of the game's four competitive modes, naming both players and where the victim died. (default true) */
    eventkills?: boolean;
    /** Resolve player names. Puts the player's name in every event above instead of only a profile id, at one extra lookup per event. (default true) */
    names?: boolean;
  };
  "farming": {
    /** Report gardens. Reports every garden bed, each of its cells, and how far each crop has grown. */
    enabled?: boolean;
    /** Per-plant detail. Adds each cell's crop, growth stage and progress, soil water and plant health. (default true) */
    plants?: boolean;
    /** Pests, disease, weeds and treatments. Adds each cell's pest, disease and weed levels, and which treatments the player has applied to it. */
    conditions?: boolean;
    /** Where each garden stands. Adds each bed's world coordinates, the reliable way to match it to its saved row. */
    position?: boolean;
  };
  "fortifications": {
    /** Report window and door barricades. Reports the barricades players nail over windows and doorways, and never adds, repairs or removes one. (default false) */
    enabled?: boolean;
    /** Every barricade standing right now. Walks the running world for every barricade standing this second, whether or not the bridge ever saw it go up. (default true, applies when `enabled`) */
    sweep?: boolean;
    /** Toughness and repair figures per barricade. Adds each barricade's toughness and repair figures, read off the running server rather than assumed. (default false, applies when `sweep`) */
    detail?: boolean;
    /** Openings that could be barricaded. Walks the world for every window and doorway that can be barricaded and says how many of them already are. (default false, applies when `enabled`) */
    openings?: boolean;
    /** Remember who put each barricade up. Keeps a record of every barricade the bridge has watched appear, change or come down, and who put it there. (default true, applies when `enabled`) */
    ledger?: boolean;
    /** Keep a short log of what happened. Keeps the last few hundred things the game said about barricades, each with where it happened and how long ago. (default true, applies when `enabled`) */
    events?: boolean;
    /** Stop the walk after this many. How many barricades or openings a world walk counts before stopping; a cut-short answer says so. (default 512, min 16, max 2048, applies when `enabled`) */
    sweepLimit?: number;
  };
  "give": {
    /** Allow moving items between places. Lets a plugin move an item that already exists somewhere in the world; nothing here creates one. (default false) */
    enabled?: boolean;
    /** Put an item in a player's hands. Puts an item into what the player is holding, swapping out whatever was there. (default false) */
    hands?: boolean;
    /** Move an item into a player's inventory. Puts an item into a player's bag, through the game's own pickup path. (default false) */
    inventory?: boolean;
    /** Move every matching item at once. Lets one call move several matching items at once, all of them or none of them. (default false, applies when `inventory`) */
    batch?: boolean;
    /** Drop an item at a coordinate. Takes an item out of the acting player's bag and puts it on the ground at coordinates you give. (default false) */
    drop?: boolean;
    /** Drop an item where the player stands. Takes an item out of a player's bag and leaves it on the ground at their feet. (default false) */
    dropHere?: boolean;
    /** Remove an item from a player for good. Takes items off a named player for good, the whole count or none. No undo. (default false) */
    remove?: boolean;
    /** Remove items lying in the world. Lets that removal reach items nobody is holding, taking the ones nearest the point you name. (default false, applies when `remove`) */
    removeAnywhere?: boolean;
    /** Put clothes on or take them off. Dresses a player in a garment, or takes one off into their bag. Nothing is destroyed. (default false) */
    wear?: boolean;
    /** Put an item on a shoulder. Slings an item over a player's left or right shoulder, the way a player carries a rifle. (default false) */
    shoulder?: boolean;
    /** Most item actors to walk in one call. How many item actors one call may search. A search that hits this says it was cut short. (default 20000, min 500, max 20000) */
    maxItems?: number;
  };
  "hazard": {
    /** See the island's radiation zones and its wetness settings. Reads the radiation zones, the wetness settings and each online player's radiation dose. */
    enabled?: boolean;
    /** Change wetting, drying and radiation dispersion rates. Changes the eight wetness and radiation tuning numbers, from rain soaking to radiation dispersion. Not saved. (applies when `enabled`) */
    tune?: boolean;
    /** Turn the island's radiation zones up or down. Changes a radiation zone's strength, size, falloff and patchiness, or restores the map's values. Zones never move. (applies when `enabled`) */
    zones?: boolean;
    /** Keep the wetness and drying settings below applied. Applies the percentages below and reapplies them after every restart; otherwise a restart resets them. (applies when `enabled`) */
    keepTuning?: boolean;
    /** How fast things dry, as a percent of normal. 100 is the game's rate; 300 dries players and clothes three times as fast, 50 half as fast. (default 100, min 0, max 5000, applies when `keepTuning`) */
    dryingRatePercent?: number;
    /** How fast players get wet, as a percent of normal. 100 is the game's rate. Covers water and wet ground; rain is set below. (default 100, min 0, max 5000, applies when `keepTuning`) */
    wettingPercent?: number;
    /** How fast rain soaks players, as a percent of normal. 100 is the game's rate. Scales all rain, drizzle and downpour alike. (default 100, min 0, max 5000, applies when `keepTuning`) */
    rainPercent?: number;
    /** Change how fast the ground makes players dirty and wet. Scales how much each ground surface dirties and wets players and their clothes. Off restores the game's values. (applies when `enabled`) */
    surfaces?: boolean;
    /** How fast ground dirties players, as a percent of normal. 100 is the game's rate; 30 is under a third as fast, 0 means the ground never dirties players. (default 100, min 0, max 5000, applies when `surfaces`) */
    dirtinessPercent?: number;
    /** How wet ground makes players, as a percent of normal. 100 is the game's rate. Wet ground only (water, mud, snow, ice), not rain. (default 100, min 0, max 5000, applies when `surfaces`) */
    surfaceWetnessPercent?: number;
  };
  "items": {
    /** Read live inventories. Reads what a player, chest or vehicle carries right now. The most costly reader here. (default false) */
    enabled?: boolean;
    /** Include item weight. Adds each item's weight with and without contents, so a full bag stands out. (default true) */
    weight?: boolean;
    /** Include item condition. Adds how worn each item is, as a value and as a share of its own maximum. (default false) */
    health?: boolean;
    /** Include weapon ammunition. Adds each weapon's loaded and fireable rounds, capacity, and whether a magazine is fitted. (default false) */
    ammo?: boolean;
    /** Include stack counts. Adds stack size and uses left, as two separate counts. (default false) */
    quantity?: boolean;
    /** Rarity, expiry and handling flags. Adds the item class's rarity, when it spoils, its spawner group, and whether it can be dropped, held or seen by admin commands. (default false) */
    detail?: boolean;
    /** Include entity ids. Adds each item's entity id, used to name that item later. Unregistered items have none. (default true) */
    ids?: boolean;
    /** Most items to walk in one answer. How many items one request may walk; an answer that hits it says so. (default 20000, min 500, max 20000) */
    maxItems?: number;
    /** Change an item's condition. Sets an item's condition as absolute health, or a share with %. Zero can destroy it. (default false) */
    setCondition?: boolean;
    /** Destroy an item. Removes one named item permanently, with no undo, refusing rather than guessing when more than one thing matches. (default false) */
    destroy?: boolean;
    /** Drop an item. Drops one named item out of a player's inventory at their feet, or out of a container beside it. (default false) */
    drop?: boolean;
  };
  "killbox": {
    /** Report killboxes. Reads whether each killbox is armed, its clock in seconds, and whether the exit is sealed. (default false) */
    enabled?: boolean;
    /** Cage and electrical doors. Adds each cage: which doors are open, locked or forced, and its zombie spawn points. (default true, applies when `enabled`) */
    rooms?: boolean;
    /** Include tuning values. Adds a run's durations, zombie counts and the player counts it scales to. (default false, applies when `enabled`) */
    config?: boolean;
    /** Players near the room. Lists players within the radius of the room; distance only, not who is locked inside. (default false, applies when `enabled`) */
    occupants?: boolean;
    /** Proximity radius (cm). How far from the room still counts as near, in centimetres. (default 5000, min 500, max 50000, applies when `occupants`) */
    radius?: number;
    /** The panic call, and the clock. Panics one killbox or sets its clock. Panicking a run the game did not start ruins its rooms for good. (default false, applies when `enabled`) */
    control?: boolean;
    /** Flip the activation markers on a killbox. Flips one killbox's activated and finale flags. Players' games react; no run starts. (default false, applies when `enabled`) */
    flags?: boolean;
    /** Apex facility purge. Reads each research facility's state: locked, unlocked, purge countdown, purging or clearing up. (default false, applies when `enabled`) */
    apex?: boolean;
    /** Change a run's shape. Changes one killbox's durations, zombie counts, difficulty and zapper multipliers. (default false, applies when `enabled`) */
    tuning?: boolean;
  };
  "live": {
    /** Read live player data. Reads players as they are now, not as last saved. Turn on the groups below too. */
    enabled?: boolean;
    /** Name, fake name, ping, profile id, session start. Adds each player's name, ping, the fake name the game may show, and session start. (default true) */
    identity?: boolean;
    /** Server profile id and profile name. Adds the server profile id and profile name, for matching database rows; the two ids differ. */
    ids?: boolean;
    /** Position, facing and speed. Adds each player's position, facing and speed, in centimetres, degrees and cm per second. */
    where?: boolean;
    /** Squad id and name. Adds each player's current squad, by id and name; the database shows it only after a save. */
    squad?: boolean;
    /** What they are holding. Adds the item each player holds, with its id so the map can drop or delete it. */
    hands?: boolean;
    /** Money, gold and account number. Adds live money, gold and bank account number, so a shop never charges against a stale figure. */
    money?: boolean;
    /** Fame points and level. Adds fame points, fame level, the figure the player sees, and their next-award multiplier. */
    fame?: boolean;
    /** Health, stamina, hydration, energy, temperature, stomach. Adds health, stamina, hydration, energy, alive, conscious, stomach fullness, and a temperature taken at the SKIN - what the weather is doing to them, never their own metabolism reading. */
    vitals?: boolean;
    /** Wetness, weight, stance, combat, fishing, what they are doing. Adds what the body is DOING this second: stance, pace, combat, scoping, cuffed, limping, wet, loaded down, how much noise they make and how easily they are seen. */
    body?: boolean;
    /** God mode, immortality, infinite ammo, admin, push-to-talk. Adds god mode and similar flags, whether the game sees an admin, and spectator, bot or inactive connections. */
    flags?: boolean;
    /** Game event participation. Adds who is in a game event, alive in it, round started, and seconds until they can rejoin. */
    event?: boolean;
    /** Respawn and suicide countdowns. Adds a dead player's two countdowns in seconds and their spawn point; suicide reads -1 when idle. */
    respawn?: boolean;
    /** Skills and experience. Adds every skill with its level and experience; skills added by game updates appear automatically. */
    skills?: boolean;
    /** The game's own kill registry. Reads who currently owes whom a revenge kill, on request. Not a kill log; empty is normal. */
    kills?: boolean;
    /** Time of day and day length. Reads the clock, sunrise, sunset and sun and moon position; speed is game hours per real hour. */
    time?: boolean;
    /** Rain, snow, fog, wind, lightning. Reads rain, snow, fog, wind, lightning and three cloud layers as strengths rather than as weather types, plus whether the simulation is running at all. */
    weather?: boolean;
    /** Air and water temperature. Reads air and water temperature, humidity, the altitude, shade and depth modifiers, and the RANGE the simulation rolls each temperature inside. */
    temp?: boolean;
  };
  "locks": {
    /** Report doors and locks. Reads what only the running game knows about a door: open, locked, who owns it, what is fitted to it, and how much each lock has left. (default false) */
    enabled?: boolean;
    /** Only doors a player has claimed. Keeps the report to doors somebody has actually locked, claimed or upgraded, instead of the thousands of untouched town doors. (default true) */
    claimed?: boolean;
    /** Locks fitted to each door. Adds each door's fitted locks: difficulty, health, attempts left, and an electronic lock's paired player and battery. (default true) */
    locks?: boolean;
    /** Include combination-lock codes. Puts padlock codes in the report. Anyone who can read the report can open those bases. (default false) */
    combination?: boolean;
    /** Position. Adds each door's coordinates, for something that wants to put doors on a map of its own. (default false) */
    position?: boolean;
    /** Include each door's design data. Adds how each door is built: swing time, self-closing, breakable, two-way, zappers. (default false, applies when `enabled`) */
    detail?: boolean;
    /** Open and close a door. Opens or closes one named door and asks it afterwards whether it agreed. It does not unlock anything. (default false, applies when `enabled`) */
    doors?: boolean;
    /** Lock and unlock a door. Locks and unlocks one named door. A door with no lock fitted is never locked. (default false, applies when `enabled`) */
    lockstate?: boolean;
    /** Set who may open a door. Sets who may open a door: everybody, its owner, or a squad rank. May not survive a restart. (default false, applies when `enabled`) */
    access?: boolean;
    /** Set a padlock code. Sets the code on every combination lock fitted to one named door, live and saved. It cannot clear a code. (default false, applies when `enabled`) */
    codes?: boolean;
    /** Repair or weaken a lock. Sets health and attempts left on every lock of one named door. (default false, applies when `enabled`) */
    condition?: boolean;
  };
  "loot": {
    /** Report the loot table files. Reports the game's two loot table files: whether each exists, its size and last change. (default false) */
    enabled?: boolean;
    /** Write the loot tables out. Lets the game write its default loot tables to disk, replacing the existing files. (default false, applies when `enabled`) */
    export?: boolean;
  };
  "medical": {
    /** Read players' medical state, and allow the changes below. Reads every wound, illness and infection on each player by Steam ID, and gates the changes below. (default false) */
    enabled?: boolean;
    /** Injuries, diseases and infections. Adds the things a player would see a doctor for: bleeds, burns, infections, sepsis, colds, hypothermia, radiation, poisoning and knockout. (default false, applies when `enabled`) */
    conditions?: boolean;
    /** Symptoms. Adds what those conditions are doing right now - pain, fever, nausea, dizziness, blurred vision, weakness, coughing. (default false, applies when `enabled`) */
    symptoms?: boolean;
    /** Death, coma, limping and the other plain effects. Adds the eight plain effects, which are neither an illness nor a symptom: death, coma, limping and the consumption modifiers. (default false, applies when `enabled`) */
    effects?: boolean;
    /** Severity, treatment state and measurements. Adds how bad each effect is: blood lost and how fast, burns, contamination, body part, treatment state, and the baseline it is recovering from. (default false, applies when `enabled`) */
    detail?: boolean;
    /** Restraints. Adds which limb is tied and how tightly, and reports nothing at all for a player who is not restrained. (default false, applies when `enabled`) */
    bondage?: boolean;
    /** Change a player's medical state. Heals, hurts, or sets one measurement on a player's effects - bleeding rate, contamination, body part, treatment state - and cures on a confirmation word. (default false, applies when `enabled`) */
    write?: boolean;
    /** Allow adding and removing effects (uses the game's admin command). Adds or deletes a whole effect on the player you name, using the game's admin commands. (default false, applies when `write`) */
    admin?: boolean;
    /** Ask the game how bad each effect is. Reads how bad each effect is and its penalty, using a game admin command run as that player. (default false, applies when `enabled`) */
    severities?: boolean;
    /** Feed and rest a player (uses the game's admin commands). Sets a player's stomach, bladder, stamina, exhaustion and metabolism speed with game admin commands, and confirms each. (default false, applies when `write`) */
    metabolic?: boolean;
    /** Allow wounds, burns, radiation and knockouts. Adds a bleeding wound, a burn on a body part, radiation or a timed knockout. Undo with cure or remove. (default false, applies when `metabolic`) */
    harm?: boolean;
    /** Record deaths and their cause. Keeps the last 256 player deaths with the killer, the last hit and the conditions they died with. (default false, applies when `enabled`) */
    deaths?: boolean;
  };
  "notify": {
    /** Allow server notifications. Lets the manager and plugins put text on players' screens. Goes out immediately. (default false) */
    enabled?: boolean;
    /** Announce to everyone. One line of white text low on every player's screen, fading after a few seconds. (default false, applies when `enabled`) */
    broadcast?: boolean;
    /** Coloured warning banner. The game's big yellow warning across every player's screen, for five seconds. Neither can be changed. (default false, applies when `enabled`) */
    banner?: boolean;
    /** Write to the kill feed. Adds a three-part line to the kill feed, only the middle part highlighted. (default false, applies when `enabled`) */
    killfeed?: boolean;
    /** Let notifications make a sound. Adds the game's own notification sound to an announcement, and the ping to a kill-feed line. (default false, applies when `enabled`) */
    sound?: boolean;
  };
  "offline": {
    /** Track raid-protection mode and changes. Reads the server's raid-protection mode and rules, and records when each base's protection begins or lapses. (default false) */
    enabled?: boolean;
    /** Re-read the protection list every. How often the protection list is re-read, which is how tightly the moment protection begins or lapses gets pinned down. (default 10, min 2, max 300, applies when `enabled`) */
    pollSeconds?: number;
    /** Remember this many changes. How many changes and player-set windows are kept. Held in memory; a restart empties it. (default 64, min 8, max 512, applies when `enabled`) */
    history?: number;
    /** Read the server's raid-protection settings. Reads the ten raid-protection settings the running server holds, grouped by mode. Costs ten calls into the game. (default true, applies when `enabled`) */
    rules?: boolean;
    /** Log the protection windows players ask for. Records each protection window a player sets in game: the flag, and both numbers in seconds as sent. (default true, applies when `enabled`) */
    watch?: boolean;
  };
  "place": {
    /** Check a location before placing anything there. Answers four things about a set of coordinates: is it loaded, under water, inside the map, or near a sentry spawn. It never blocks a spawn. (default false) */
    enabled?: boolean;
    /** Also answer 'what is here?'. Adds the bunker, radiation, warmth, indoors or out, the floor below, and the map bounds. (default true) */
    describe?: boolean;
  };
  "power": {
    /** Report fire, power and cooking. Shows generators and their fuel, lit fires, what is cooking, and powered devices. (default false) */
    enabled?: boolean;
    /** Name the recipe in each cooking slot. Names each dish, with its cooking time, target temperature and whether it needs heat. (default true) */
    recipes?: boolean;
    /** Include battery-powered devices. Adds items with a battery or canister: charge, drain rate and fitted cell. (default false) */
    devices?: boolean;
    /** Include heat-source design values. Adds each burner's maximum temperature, heat radii, temperature multiplier and fuel ratio. (default false) */
    design?: boolean;
    /** Where each fire, generator and cooker stands. Adds world coordinates to everything this module reports. (default false) */
    position?: boolean;
    /** Allow generators, lamps and batteries to be changed. Switches generators and lamps, sets brightness, fuel and battery charge. Fires cannot be changed. (default false) */
    writes?: boolean;
    /** How close a coordinate has to be (cm). The nearest generator, lamp or battery within this many centimetres is the one changed. (default 500, min 1, max 20000, applies when `writes`) */
    radius?: number;
  };
  "protect": {
    /** Read and change raid protection. Reads the raid-protection mode in use, which flags have an entry, and the game clock. (default false) */
    enabled?: boolean;
    /** Set a flag's protection window. Sets when a flag's armed protection starts and how long it lasts (or forever). No undo. (default false, applies when `enabled`) */
    set?: boolean;
    /** Give a base protection it does not have. Arms offline protection on a base without any. An owner logging in clears it. No undo. (default false, applies when `enabled`) */
    grant?: boolean;
    /** Reset a flag's change cooldown. Clears the wait before a player may change their window again. Flag-specific protection only. (default false, applies when `enabled`) */
    reset?: boolean;
    /** Postpone offline protection. Moves a flag's pending offline protection later, never earlier; running protection is left alone. (default false, applies when `enabled`) */
    postpone?: boolean;
    /** Refuse Delay or Duration above. The largest start delay or duration this module accepts, in seconds. Anything above it is refused, never quietly trimmed. (default 90000, min 1, max 315360000, applies when `enabled`) */
    maxValue?: number;
  };
  "quests": {
    /** Read the quest system. Reads this server's quest catalogue - each definition's title, tier, time limit, reward, trader and destinations - but never a player's progress. */
    enabled?: boolean;
    /** Include each quest's objectives. Adds each quest's objectives in order: kind, tracker text and map marker count. (applies when `enabled`) */
    conditions?: boolean;
    /** Report quest givers. Reports every quest giver: id, trader, whether it varies per player, and position. (applies when `enabled`) */
    givers?: boolean;
    /** Record quest activity per player. Records each quest and task change per player; the only live way to see who holds what. (applies when `enabled`) */
    watch?: boolean;
    /** Also record what players ASK for. Also records requests: abandoning, starting at a giver, or re-tracking. A start has no quest id. (applies when `watch`) */
    requests?: boolean;
    /** Quest events to keep. How many recorded events one request returns. A restart empties the list. (default 200, min 10, max 2000, applies when `watch`) */
    history?: number;
    /** Allow quests to be abandoned or tracked. Abandons a player's quest or task, or re-points their tracker. Player must be online. Abandoning: no undo. (applies when `enabled`) */
    writes?: boolean;
    /** Allow the quest cycle to be reset. Resets or ends the quest cycle, refreshes pools, toggles quest limits, lists fetch quests. (applies when `enabled`) */
    cycle?: boolean;
  };
  "raid": {
    /** Detect raids as they happen. Detects somebody starting to hit a base, told apart from decay, admin clearing and upgrades. (default false) */
    enabled?: boolean;
    /** A raid stays "active" for. How long after the last hit a base still counts as raided; refuse protection changes inside it. (default 300, min 30, max 3600, applies when `enabled`) */
    activeSeconds?: number;
    /** A hit only counts above this much damage. Hits below this damage are ignored and keep no raid open. Under 0.01 is always ignored. (default 0, min 0, max 1000, applies when `enabled`) */
    minDamage?: number;
    /** Let a caller declare a raid window. Lets a caller open or close a raid window by hand. Changes the bridge's record, never the game. (default false, applies when `enabled`) */
    control?: boolean;
    /** Announce the global raid window. Shows the game's raid-window messages to every player. Announces only; never opens, closes or moves it. (default false, applies when `enabled`) */
    announce?: boolean;
  };
  "repair": {
    /** Read vehicles, and allow the changes below. Reads every vehicle in the world and allows the changes below. Every change survives a restart. (default false) */
    enabled?: boolean;
    /** Repair. Raises every part, or the parts you name, towards full health. (default false) */
    repair?: boolean;
    /** Damage. Wears a vehicle down or breaks a named part; a destroyed part is removed. (default false) */
    damage?: boolean;
    /** Refuel. Fills or empties the tank, in litres or as a percentage. A vehicle with no engine block fitted is refused. (default false) */
    fuel?: boolean;
    /** Charge the battery. Charges or drains the battery, in units or percent. No battery fitted is refused. (default false) */
    battery?: boolean;
    /** Repaint. Changes a vehicle's pattern and colours by index, and clears any fading. (default false) */
    paint?: boolean;
    /** Destroy a vehicle. Ends the vehicle by overwhelming every destructible part. Parts the game marks indestructible survive, and there is no undo. (default false) */
    destroy?: boolean;
    /** Set the odometer. Sets how far a vehicle has been driven, in kilometres, on every part your selector matches. (default false) */
    mileage?: boolean;
    /** Set who may open the vehicle. Sets who may open the boot: everybody, the owner, or a squad rank. Not a lock. (default false) */
    access?: boolean;
    /** Set the container's owning profile. Sets which profile owns the vehicle's boot, not the car; 0 clears it. (default false) */
    owner?: boolean;
    /** Name a vehicle. Gives a vehicle a saved name usable in place of its number. One word, not digits. (default false) */
    rename?: boolean;
    /** Repair through the game's damage call. Has no effect: repair always writes each part's health. Kept so old settings still load. (default false, applies when `repair`) */
    viaDamage?: boolean;
    /** What kind of damage to apply. Which kind of damage the Damage and Destroy verbs apply. Each part scales each kind by its own figure. (default "1", applies when `damage`) */
    damageType?: "0" | "1" | "2" | "3" | "4";
    /** Largest radius for addressing by position (centimetres). How far to look when a vehicle is named by position. Two in range is refused. (default 1000, min 0, max 100000) */
    radius?: number;
  };
  "report": {
    /** Report to the server browser. Sends name, players and version to scumsa.com every minute. The token goes in SSABridge.config.json. */
    enabled?: boolean;
  };
  "resources": {
    /** Watch fuel and resource stations. Lists refillable sources and their last announced level, once the game mentions each one. (default false) */
    enabled?: boolean;
    /** Read every station's level from the game. Reads every station's level from the running game, so the list covers the whole island. (default false, applies when `enabled`) */
    read?: boolean;
    /** Allow the game's own refill command around a player. Runs SCUM's own refill admin command around a named player, filling everything refillable within the radius below. (default false, applies when `enabled`) */
    near?: boolean;
    /** Radius for the refill command, in centimetres. How far around the player the refill reaches; 100 is a metre. The game bounds it. (default 0, min 0, max 20000, applies when `near`) */
    nearArea?: number;
  };
  "respawn": {
    /** Read respawn timers. Shows how long each respawn option is locked for an online player. */
    enabled?: boolean;
    /** Change respawn timers. Lets the panel and plugins set or clear those locks. (applies when `enabled`) */
    write?: boolean;
  };
  "settings": {
    /** Read live server settings. Reads a server setting's live value and lists names, types and sections. Change settings in ServerSettings.ini. */
    enabled?: boolean;
  };
  "spawn": {
    /** Spawn at exact coordinates with a rotation. Places an object at exact coordinates and facing. Nothing placed this way survives a restart. (default false) */
    enabled?: boolean;
    /** Creatures (animals, puppets, NPCs, drones, sentries). Lets the placement above cover animals, puppets, NPCs, drones and sentries, spawned with their AI running. (default false, applies when `enabled`) */
    creatures?: boolean;
    /** Vehicles. Lets the placement above cover vehicles, as set dressing only. The car is gone at the restart. (default false, applies when `enabled`) */
    vehicles?: boolean;
    /** Bosses (Brenner, Razor, Dropship, Sentry). Lets a Brenner, Razor, Dropship or Sentry be placed. Creatures does not cover them. (default false, applies when `enabled`) */
    bosses?: boolean;
    /** Anything else the game can place. Lets props and fixtures be spawned by their class path. (default false, applies when `enabled`) */
    actors?: boolean;
    /** Also spawn things that LAST, through the game's admin commands. A vehicle spawned this way survives a restart. No facing, and somebody must be online. (default false, applies when `enabled`) */
    persistent?: boolean;
    /** Load a class the game has not made yet. Loads a class the game has not built yet, such as a Razor. Loading pauses the server. (default true, applies when `enabled`) */
    makeResident?: boolean;
    /** When the spot is already occupied. What to do when something already stands on the spot you named. (default "adjust", applies when `enabled`) */
    collision?: "adjust" | "always" | "strict" | "never";
    /** Minimum gap between spawns (ms). Spawns closer together than this are refused. 350 ms is the floor. (default 350, min 350, max 60000, applies when `enabled`) */
    minGapMs?: number;
  };
  "spawnpoints": {
    /** Report where players enter the world. Reads the map's spawn points, the world's edges, and respawn prices and cooldowns. (default false) */
    enabled?: boolean;
    /** Allow switching an individual spawn point off and on. Switches one spawn point off or on by index, with CONFIRM. The last player spawn stays on. (default false, applies when `enabled`) */
    allowToggle?: boolean;
  };
  "squads": {
    /** Read live squads, and allow the changes below. Reads the game's own squad list, with each member's online, alive and in-danger state, which the save does not hold. */
    enabled?: boolean;
    /** Include the member list. Adds the member list, profile id and rank for each; the counts and the pending invitations are reported either way. (default true) */
    members?: boolean;
    /** Include the squad message and information. Adds the two free-form texts a squad carries: its message of the day and its information block. */
    text?: boolean;
    /** Allow squads to be changed, not just read. Lets squads be changed: disband, evict, add a member, rename, or set the message or information. A disband deletes the squad from the save for good and needs a confirmation. */
    writes?: boolean;
    /** Ask the game for member names and fame. Asks for each member's name and fame; needs a player online, answers a moment later. (applies when `enabled`) */
    names?: boolean;
    /** Read the squad leaderboard. Asks for the server's squad ranking; needs a player online, answers a moment later. (applies when `enabled`) */
    board?: boolean;
    /** Record squads being torn down. Records squads unloaded by the game, and whether each still exists; keeps the last hundred. (applies when `enabled`) */
    wipes?: boolean;
  };
  "stash": {
    /** Place containers and items. Master switch for this module. Nothing happens until one of the switches below is on. (default false) */
    enabled?: boolean;
    /** Put an item at a coordinate. Places any item or container at a coordinate. Needs a player online and 'Let in-game mods run admin commands'. (default false, applies when `enabled`) */
    place?: boolean;
    /** Fill a container. Puts new items into a container, vehicle storage or a player's worn bag. A container needs someone within 3.5 m. (default false, applies when `enabled`) */
    fill?: boolean;
    /** Most items of one kind per fill. The largest count one fill line may ask for. The game stops at 2500. (default 50, min 1, max 2500, applies when `fill`) */
    maxPerEntry?: number;
    /** Set off traps and mines. Sets off an armed mine or trap. It hurts whoever is near it. (default false, applies when `enabled`) */
    traps?: boolean;
  };
  "stats": {
    /** Read players' lifetime survival stats, and allow the changes below. Reads each prisoner's 92 lifetime counters, such as kills, deaths and accuracy. Turning it off discards them. */
    enabled?: boolean;
    /** Ask again every. How often the bridge refreshes everyone online without being asked, in minutes. Zero asks only when you say so. (default 30, min 0, max 240, applies when `enabled`) */
    refreshMinutes?: number;
    /** Wait between requests. Milliseconds between two players' requests during a refresh. Raise it if the server stutters. (default 250, min 100, max 10000, applies when `enabled`) */
    requestGapMs?: number;
    /** Remember at most. How many players' figures are kept in memory. When full, the oldest is dropped. (default 64, min 1, max 128, applies when `enabled`) */
    maxPlayers?: number;
    /** Award and set players' skill experience. Grants skill experience. It can only raise a skill; a set below the current figure is refused. (applies when `enabled`) */
    skillWrites?: boolean;
    /** Set a skill level and experience outright. Sets a skill's level and experience, up or down. The player must be in the world. (applies when `enabled`) */
    skillLevel?: boolean;
    /** Read a player's four base attributes. Reads strength, constitution, dexterity and intelligence for a player in the world. (applies when `enabled`) */
    attributes?: boolean;
    /** Set a player's four base attributes. Sets all four attributes, up or down. All four must be given, each within its range. (applies when `attributes`) */
    attributeWrites?: boolean;
    /** Read the server-wide kill registry. Reads the game's live list of who killed whom, by profile id. (applies when `enabled`) */
    killRegistry?: boolean;
    /** Also clear a single entry from that list. Asks the game to remove one entry from the kill registry. It counts only if the entry is gone. (applies when `killRegistry`) */
    killWrites?: boolean;
    /** Ask the game for a ranked leaderboard. Reads the game's own ranking with names — the rows around one player, not the top. (applies when `enabled`) */
    ranking?: boolean;
  };
  "storage": {
    /** Report live storage. Reports the chests, lockers and lockable containers the running server has loaded. (default false) */
    enabled?: boolean;
    /** Owner and protecting flag. Adds who owns each container and which base flag is protecting it. (default true) */
    owner?: boolean;
    /** Access level, locks and how it can be opened. Adds the access level, the locks fitted, the attempts left and how it can be opened. (default true) */
    locks?: boolean;
    /** Whether it is buried. Adds whether the chest is in the ground and which profile put it there. (default true) */
    buried?: boolean;
    /** Position. Adds each container's world position, read at the same instant as the live owner and lock state above. (default false) */
    position?: boolean;
    /** Player-given names. Adds the name a player typed on a chest and the profile that typed it. (default false) */
    names?: boolean;
    /** Item condition in contents listings. Adds how worn each item in a contents listing is, at the cost of two extra reads per item. (default false) */
    condition?: boolean;
    /** Stack counts in contents listings. Adds stack sizes and uses left to each item in a contents listing. (default false) */
    quantity?: boolean;
    /** Allow moving and destroying container contents. Lets a plugin take, move or destroy an item in a container. A destroy has no undo. (default false) */
    write?: boolean;
    /** Let a caller open a container for a named player. Opens a container for a named player so its contents load. It may reach their screen and cannot be closed. (default false) */
    observe?: boolean;
  };
  "teleport": {
    /** Allow teleporting. Opens the module; each kind of move below is its own switch. Moves below the world's floor are refused. */
    enabled?: boolean;
    /** Teleport a player, to a point or to someone else. Moves a player to a point with a facing, to another player, swaps two, turns one on the spot, or puts one back where it last took them from. */
    player?: boolean;
    /** Teleport a whole squad. Moves every online member of one squad to one place; offline or loading members are skipped. */
    squads?: boolean;
    /** Move a vehicle. Moves a vehicle, for one that is stuck; a vehicle with somebody driving it is refused. */
    vehicles?: boolean;
    /** Move a dropped item. Moves one item lying on the ground, by entity id; items in an inventory or on a body are refused. */
    items?: boolean;
    /** Move a body. Moves a dead player's body, found by the name on it; the corpse list shows the names. */
    corpses?: boolean;
    /** Allow placing without a collision check. Lets a vehicle, item or body be placed without a fit check, for something sunk in terrain. Never players. */
    force?: boolean;
  };
  "trade": {
    /** Report trade outposts. Reports the four trade outposts: where they stand, their shops, and who staffs each counter. */
    enabled?: boolean;
    /** Economy settings. Adds the live economy rules: fame gate, gold pricing, limits, rotation, prosperity tiers and bank fees. (default true) */
    economy?: boolean;
    /** Configured trader roster. Adds which trader personality is meant to staff which counter, spawned or not. (default true) */
    roster?: boolean;
    /** Live traders. Adds the trader actors that exist this instant and what each is doing; they spawn only while somebody is near. */
    traders?: boolean;
    /** Positions. Adds world coordinates for each outpost, shop and trader, plus each trader's home position. (default true) */
    position?: boolean;
    /** Per-item price overrides. Reports the items whose price a trader overrides; ask per trader or per outpost. */
    prices?: boolean;
    /** Allow changing the economy settings. Lets the live economy settings be changed, such as the fame gate, gold pricing and limits. */
    write?: boolean;
    /** Reroll prices and reset the economy. Reroll every outpost's price offsets, or reset trader funds and stock. */
    economyadmin?: boolean;
  };
  "vehicles": {
    /** Report live vehicle state. Reports each vehicle's live state and the server-wide vehicle settings, rather than what the save last recorded. (default false) */
    enabled?: boolean;
    /** Fuel, battery and engine. Adds fuel, battery charge and what the engine is doing, live. (default true) */
    fuel?: boolean;
    /** Condition and mileage. Adds one averaged roadworthiness figure per vehicle and its odometer in kilometres. (default true) */
    condition?: boolean;
    /** Whether someone is driving. Adds whether the driving seat is occupied and whether the vehicle is sitting in water. (default true) */
    driver?: boolean;
    /** WHO is driving. Adds the driver's Steam ID; costs one extra read per online player on each report. (default false, applies when `driver`) */
    driverId?: boolean;
    /** Read the game's own names. Adds the game's own words for each listed part: its name, its socket, its damage region, the servicing tool and the item that replaces it. (default false) */
    names?: boolean;
    /** Position and heading. Adds where the vehicle is and which way it is pointing. (default true) */
    position?: boolean;
    /** Locks and container owner. Adds locks and their difficulty, who may open the boot, its capacity, and the protecting base flag. (default false) */
    lock?: boolean;
    /** Service ramp and physics state. Adds whether the vehicle is on a jack, which one, who put it there, and whether it is asleep. (default true) */
    service?: boolean;
    /** Per-part breakdown. Adds each part's condition, paint and mounting, and the state of devices like a radio, light or door. (default false) */
    parts?: boolean;
    /** Parts described per vehicle. How many parts to list per vehicle; damaged ones come first, and a cut list is flagged. (default 24, min 1, max 128, applies when `parts`) */
    partsMax?: number;
  };
  "virtual": {
    /** Read owners of mines, bedrolls and trader depots. Reports who owns each mine, bedroll and trader depot, including ones not currently loaded. */
    enabled?: boolean;
    /** Include bedroll timers. Adds when a bedroll's timer started and how many seconds it runs for. (default true) */
    timers?: boolean;
    /** Most owner records to read in one answer. Caps how many owner records one answer may carry; an answer that hit the cap says so. (default 4096, min 256, max 20000) */
    maxObjects?: number;
    /** Lock state of locked world crates. Adds each locker's lock difficulty, remaining health, neutralisation attempts and starting lock count. (default true) */
    locks?: boolean;
    /** Where each locked world crate stands. Adds world coordinates for each locked world crate. */
    position?: boolean;
  };
  "vote": {
    /** Report votes and tournaments. Reports any running vote and what it asks, and any tournament with its scoreboard. (default false) */
    enabled?: boolean;
    /** Start and cancel votes. Lets a vote be put to every player on the server, and lets a running one be cancelled. (default false, applies when `enabled`) */
    votes?: boolean;
    /** Start and end tournament mode. Starts tournament mode around a map point, or ends it. Changes the map border for everyone. (default false, applies when `enabled`) */
    tournaments?: boolean;
  };
  "wake": {
    /** Build vehicles far from players. Lets a caller have the game build vehicles further from players for a set time. */
    enabled?: boolean;
    /** Longest a wider distance may last (seconds). Every wider distance ends by itself after this; nothing stays changed for good. (default 600, min 10, max 3600) */
    maxSeconds?: number;
  };
  "wildlife": {
    /** Read the wildlife population, and allow the changes below. Reports how much wildlife the server holds and of what: a head count per species against the ceilings, plus sharks, fish, biome density and the bait feeders. (default false) */
    enabled?: boolean;
    /** Allow changing the population limits and behaviour. Lets the population limits and behaviour be changed: the animal ceiling, spawn distances, carcass lifetime, bait feeders, sharks and fish. (default false, applies when `enabled`) */
    write?: boolean;
    /** Allow changing biome density and fish weights. Lets biome animal density and fish weights be changed. Shared: other regions use the same asset. (default false, applies when `enabled`) */
    assets?: boolean;
  };
  "world": {
    /** Answer questions about levels and streaming. Reports which map levels are loaded and visible right now, and their names. */
    enabled?: boolean;
    /** Also report the world's own managers. Adds the world's own manager objects: the base-building state, the long-range scenery tuning and the collision that stays loaded. (default true) */
    managers?: boolean;
    /** Most levels one answer may list. Caps how many levels one answer lists; the match count stays true and a cut list is flagged. (default 250, min 10, max 3000) */
    listLimit?: number;
    /** Allow forcing a level to stream in. Lets one named level be asked to stream in, after the word CONFIRM; nothing here can unload a level. (default false) */
    allowStream?: boolean;
  };
  "worldevents": {
    /** Report world events. Reports what is happening on the island right now: cargo drops, competitive events and abandoned bunkers, read on demand. */
    enabled?: boolean;
    /** Cargo drops. Adds each cargo drop: landing spot, whether it is falling, self-destruct time and locker count. (default true) */
    cargo?: boolean;
    /** Deathmatch, CTF, drop zone. Adds each competitive event: round, time left, players still in it, team scores and ranking. (default true) */
    events?: boolean;
    /** Inside the event. Adds a running event's phase and time left, capture progress, flag carriers and winning score. (default false, applies when `events`) */
    modes?: boolean;
    /** Event players and deaths. Keeps each running event and its players, so a death inside an event is told apart from any other. (default true) */
    ledger?: boolean;
    /** Who is in the event. Adds the event roster: each player's name, Steam id, team, alive or not, score, kills and deaths. (default false, applies when `events`) */
    players?: boolean;
    /** The event's play area. Adds a running event's ring: state, centre, current radius and the radius it closes to. (default false, applies when `events`) */
    border?: boolean;
    /** Abandoned bunkers. Adds each abandoned bunker's activation window, the previous one and any admin override, plus its powered rooms, alarm and noise. (default true) */
    bunkers?: boolean;
    /** Allow events to be started and stopped. Lets events be run rather than only watched: schedule, cancel or reset one, zero its scores, and move, re-target, resize or detonate a cargo drop. */
    writes?: boolean;
  };
  "zones": {
    /** Read the server's custom zones. Reads every custom zone in priority order with its shape, colour, rules and damage table, plus the shipped zones. */
    enabled?: boolean;
    /** Guarded zones and sentries. Reads the guarded places on the map with their sentry spawn points, and the island-wide numbers the defence runs on. (default false, applies when `enabled`) */
    guarded?: boolean;
    /** Change the sentry numbers. Lets those island-wide sentry numbers be changed: respawn delay, spawner deactivation, the defender-horde threshold and the hit memory. (default false, applies when `guarded`) */
    guardedwrite?: boolean;
    /** The map border. Reads the custom map border: its rectangle, whether it is on, and any tournament shrink. (default false, applies when `enabled`) */
    border?: boolean;
    /** Reload the custom map settings. Lets the running game re-read the custom map border settings out of the server's own settings file, with no restart. (default false, applies when `border`) */
    borderreload?: boolean;
    /** Allow creating and changing zones. Lets zones be created, edited, moved, reordered, deleted or restored, and a damage row set in one go; every change is saved by the game. */
    write?: boolean;
  };
}

export type ModuleId = keyof ModuleVocabulary;
/** The `what` of a `module_data` request to module `M`. */
export type DataQuery<M extends ModuleId> = ModuleVocabulary[M]['data'];
/** The `what` of a `module_command` request to module `M`. */
export type Command<M extends ModuleId> = ModuleVocabulary[M]['command'];
export type ModuleSettings<M extends ModuleId> = ModuleSettingsMap[M];

// ── END GENERATED ──────────────────────────────────────────────────────────────────────────────
