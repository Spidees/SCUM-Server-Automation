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
  | 'modules' | 'module_config' | 'module_data' | 'module_command' | 'persisted';

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

/**
 * Keeping a change across a restart. A `module_command` sent with `"persist": true`, through
 * `request('module_command', { module, what, persist: true })`, carries these keys beside
 * `accepted` in its `result`. `persisted: true` means the bridge recorded the request in
 * `SSABridge.persist.json` and sends it again after every boot, once the world has loaded. Which
 * writes can be kept is `ModuleWriteNeeds[module][verb].persistable`. A refused write keeps nothing,
 * and its refusal carries `persisted: false` with `persistCode: 'refused'`. A `persist` that is not
 * a boolean is refused with `bad_request` before the write runs.
 */
export interface PersistOutcome {
  persisted: boolean;
  /** The record's id, for the `persisted` action's `forget:<id>`. With `persisted: true`. */
  persistId?: number;
  /** Why nothing was kept. With `persisted: false`. */
  persistCode?: 'refused' | 'not_persistable' | 'target_not_stable' | 'store_full' | 'store_unreadable' | 'write_failed';
  persistReason?: string;
}

/** One kept change, as the `persisted` action and `module_data <module> persisted` list it. */
export interface PersistRecord {
  id: number;
  module: string;
  what: string;
  /** Who asked: the request's `caller`, or `local` / `remote`. */
  by: string;
  /** Epoch milliseconds of the request that asked for it. */
  at: number;
  /** The most recent replay, from this boot or an earlier one. Absent until one has run. */
  lastReplay?: { at: number; ok: boolean; note: string };
  /** `true` once it has applied, or was recorded, since this boot. */
  replayedThisBoot: boolean;
}

/**
 * What the `persisted` action answers for `what: 'list'` (the default) and `module_data` answers
 * for `what: 'persisted'`. `forget:<id>` and `forget:all` answer `{ forgotten, left }`; forgetting
 * stops the replay at the next boot and does not undo what the change already did.
 */
export interface PersistedList {
  file: string;
  /** `false` when the file exists and could not be read; then nothing is replayed or kept. */
  readable: boolean;
  reason?: string;
  max: number;
  replay: { state: string; passes: number };
  records: PersistRecord[];
  count: number;
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
// 50 modules, 223 reads, 284 writes, 34 retired verbs, 386 settings.
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

// ── one type per verb, so an editor shows its usage and its fields ─────────────────────────────
//
// `<name>` is a field to fill in, `<x>,<y>,<z>` is one field of three comma-separated numbers,
// and `[:<name>]` is an optional field. A wrong request is refused with a sentence that spells
// the shape it expected.

/**
 * `state:<steamid>`
 *
 * - `steamid`
 *
 * In-game actions, `module_data`.
 */
export type ActionsRead_State =
  | `state:${string}`;

/**
 * `<steamId>:ammo:<on>`
 *
 * - `steamId`
 * - `on`: On
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Ammo =
  | `${string}:ammo`
  | `${string}:ammo:${string}`;

/**
 * `<steamId>:cough:<intensity>`
 *
 * - `steamId`
 * - `intensity`: How hard (%)
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Cough =
  | `${string}:cough`
  | `${string}:cough:${string}`;

/**
 * `<steamid>:crouch[:<value>]`
 *
 * - `steamid`
 * - `value`: Amount (optional)
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Crouch =
  | `${string}:crouch`
  | `${string}:crouch:${string}`;

/**
 * `<steamid>:cuffpart:<hands|feet>`
 *
 * - `steamid`
 * - `hands|feet`: one of `hands`, `feet`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Cuffpart =
  | `${string}:cuffpart`
  | `${string}:cuffpart:${string}`;

/**
 * `<steamid>:cufftight:<value>`
 *
 * - `steamid`
 * - `value`: Amount
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Cufftight =
  | `${string}:cufftight`
  | `${string}:cufftight:${string}`;

/**
 * `<steamId>:dbfame:<amount>`
 *
 * - `steamId`
 * - `amount`
 *
 * Needs: Any player online (admin command). Runs one of the game's admin commands, which the game only runs through an online player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Dbfame =
  | `${string}:dbfame`
  | `${string}:dbfame:${string}`;

/**
 * `<steamid>:dbfameadd[:<value>]`
 *
 * - `steamid`
 * - `value`: Amount (optional)
 *
 * Needs: Any player online (admin command). Runs one of the game's admin commands, which the game only runs through an online player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Dbfameadd =
  | `${string}:dbfameadd`
  | `${string}:dbfameadd:${string}`;

/**
 * `<steamId>:dbgold:<amount>`
 *
 * - `steamId`
 * - `amount`
 *
 * Needs: Any player online (admin command). Runs one of the game's admin commands, which the game only runs through an online player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Dbgold =
  | `${string}:dbgold`
  | `${string}:dbgold:${string}`;

/**
 * `<steamid>:dbgoldadd[:<value>]`
 *
 * - `steamid`
 * - `value`: Amount (optional)
 *
 * Needs: Any player online (admin command). Runs one of the game's admin commands, which the game only runs through an online player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Dbgoldadd =
  | `${string}:dbgoldadd`
  | `${string}:dbgoldadd:${string}`;

/**
 * `<steamId>:dbmoney:<amount>`
 *
 * - `steamId`
 * - `amount`
 * - also `<sid>:dbmoney`
 *
 * Needs: Any player online (admin command). Runs one of the game's admin commands, which the game only runs through an online player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Dbmoney =
  | `${string}:dbmoney`
  | `${string}:dbmoney:${string}`;

/**
 * `<steamid>:dbmoneyadd[:<value>]`
 *
 * - `steamid`
 * - `value`: Amount (optional)
 *
 * Needs: Any player online (admin command). Runs one of the game's admin commands, which the game only runs through an online player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Dbmoneyadd =
  | `${string}:dbmoneyadd`
  | `${string}:dbmoneyadd:${string}`;

/**
 * `<steamId>:defecate:diarrhea`
 *
 * - `steamId`
 * - `diarrhea`: The worse version; the word `diarrhea`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Defecate =
  | `${string}:defecate`
  | `${string}:defecate:${string}`;

/**
 * `<steamId>:detonate:<keepHeadgear>`
 *
 * - `steamId`
 * - `keepHeadgear`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Detonate =
  | `${string}:detonate`
  | `${string}:detonate:${string}`;

/**
 * `<steamId>:disarm`
 *
 * - `steamId`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Disarm =
  | `${string}:disarm`
  | `${string}:disarm:${string}`;

/**
 * `<steamId>:fade:<seconds>`
 *
 * - `steamId`
 * - `seconds`: Seconds
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Fade =
  | `${string}:fade`
  | `${string}:fade:${string}`;

/**
 * `<steamid>:fakename:<text>`
 *
 * - `steamid`
 * - `text`
 * - also `<steamid>:fakename`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Fakename =
  | `${string}:fakename`
  | `${string}:fakename:${string}`;

/**
 * `<steamId>:fame:<fame>`
 *
 * - `steamId`
 * - `fame`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Fame =
  | `${string}:fame`
  | `${string}:fame:${string}`;

/**
 * `<steamId>:freelook:<on>`
 *
 * - `steamId`
 * - `on`: On
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Freelook =
  | `${string}:freelook`
  | `${string}:freelook:${string}`;

/**
 * `<steamId>:gender:<gender>`
 *
 * - `steamId`
 * - `gender`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: the game keeps the character itself.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Gender =
  | `${string}:gender`
  | `${string}:gender:${string}`;

/**
 * `<sid>:godmode:maybe`
 *
 * - `sid`
 * - `maybe`: the word `maybe`
 * - also `<sid>:godmode`
 * - also `<steamId>:godmode:<on>`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Godmode =
  | `${string}:godmode`
  | `${string}:godmode:${string}`;

/**
 * `<steamId>:gold:<amount>`
 *
 * - `steamId`
 * - `amount`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: the game keeps the balance itself, so a replay would change it again.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Gold =
  | `${string}:gold`
  | `${string}:gold:${string}`;

/**
 * `<steamid>:hud:server`
 *
 * - `steamid`
 * - `server`: the word `server`
 * - also `<steamId>:hud:<text>`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Hud =
  | `${string}:hud`
  | `${string}:hud:${string}`;

/**
 * `<steamId>:immortal:<on>`
 *
 * - `steamId`
 * - `on`: On
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Immortal =
  | `${string}:immortal`
  | `${string}:immortal:${string}`;

/**
 * `<steamId>:kick:<reason>`
 *
 * - `steamId`
 * - `reason`: Reason
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Kick =
  | `${string}:kick`
  | `${string}:kick:${string}`;

/**
 * `<steamid>:killfeed:<prefix>|<name>|<suffix>[|ping]`
 *
 * - `steamid`
 * - `prefix|name|suffix|ping`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Killfeed =
  | `${string}:killfeed`
  | `${string}:killfeed:${string}`;

/**
 * `<steamId>:limp:<on>`
 *
 * - `steamId`
 * - `on`: On
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Limp =
  | `${string}:limp`
  | `${string}:limp:${string}`;

/**
 * `<steamId>:limpclear`
 *
 * - `steamId`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Limpclear =
  | `${string}:limpclear`
  | `${string}:limpclear:${string}`;

/**
 * `<steamId>:load`
 *
 * - `steamId`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Load =
  | `${string}:load`
  | `${string}:load:${string}`;

/**
 * `<steamId>:money:<amount>`
 *
 * - `steamId`
 * - `amount`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: the game keeps the balance itself, so a replay would change it again.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Money =
  | `${string}:money`
  | `${string}:money:${string}`;

/**
 * `<steamId>:nightvision:<on>`
 *
 * - `steamId`
 * - `on`: On
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Nightvision =
  | `${string}:nightvision`
  | `${string}:nightvision:${string}`;

/**
 * `<steamId>:pace:<pace>`
 *
 * - `steamId`
 * - `pace`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Pace =
  | `${string}:pace`
  | `${string}:pace:${string}`;

/**
 * `<steamId>:repossess`
 *
 * - `steamId`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Repossess =
  | `${string}:repossess`
  | `${string}:repossess:${string}`;

/**
 * `<steamId>:revive`
 *
 * - `steamId`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Revive =
  | `${string}:revive`
  | `${string}:revive:${string}`;

/**
 * `<steamid>:save`
 *
 * - `steamid`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Save =
  | `${string}:save`
  | `${string}:save:${string}`;

/**
 * `<steamid>:silence:<hours>[:<channel>]`
 *
 * - `steamid`
 * - `hours`
 * - `channel` (optional)
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a countdown, so a replay would start it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Silence =
  | `${string}:silence`
  | `${string}:silence:${string}`;

/**
 * `<steamId>:sneeze:<intensity>`
 *
 * - `steamId`
 * - `intensity`: How hard (%)
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Sneeze =
  | `${string}:sneeze`
  | `${string}:sneeze:${string}`;

/**
 * `<steamId>:spawnscreen:<withLoadout>`
 *
 * - `steamId`
 * - `withLoadout`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Spawnscreen =
  | `${string}:spawnscreen`
  | `${string}:spawnscreen:${string}`;

/**
 * `<steamId>:squadcreate:<v>`
 *
 * - `steamId`
 * - `v`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: the game keeps squads itself.
 * Creates: The game's own route. Made through the game's own command or logic, so the game keeps it exactly as it keeps one it made itself. Whether that kind gets a save row was not measured here. Note: the game's own squad call makes the squad.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Squadcreate =
  | `${string}:squadcreate`
  | `${string}:squadcreate:${string}`;

/**
 * `<steamId>:squaddemote:<v>`
 *
 * - `steamId`
 * - `v`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: the game keeps squads itself.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Squaddemote =
  | `${string}:squaddemote`
  | `${string}:squaddemote:${string}`;

/**
 * `<steamId>:squadjoin:<v>`
 *
 * - `steamId`
 * - `v`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: the game keeps squads itself.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Squadjoin =
  | `${string}:squadjoin`
  | `${string}:squadjoin:${string}`;

/**
 * `<steamId>:squadleave:<v>`
 *
 * - `steamId`
 * - `v`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: the game keeps squads itself.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Squadleave =
  | `${string}:squadleave`
  | `${string}:squadleave:${string}`;

/**
 * `<sid>:squadpromote:<profileId>`
 *
 * - `sid`
 * - `profileId`: Profile to demote
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: the game keeps squads itself.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Squadpromote =
  | `${string}:squadpromote`
  | `${string}:squadpromote:${string}`;

/**
 * `<steamId>:squadquit`
 *
 * - `steamId`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: the game keeps squads itself.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Squadquit =
  | `${string}:squadquit`
  | `${string}:squadquit:${string}`;

/**
 * `<steamId>:strip`
 *
 * - `steamId`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Strip =
  | `${string}:strip`
  | `${string}:strip:${string}`;

/**
 * `<steamId>:suicide`
 *
 * - `steamId`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Suicide =
  | `${string}:suicide`
  | `${string}:suicide:${string}`;

/**
 * `<steamId>:suicidetime:<seconds>`
 *
 * - `steamId`
 * - `seconds`: Seconds
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a countdown, so a replay would start it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Suicidetime =
  | `${string}:suicidetime`
  | `${string}:suicidetime:${string}`;

/**
 * `<steamId>:superjump:<on>`
 *
 * - `steamId`
 * - `on`: On
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Superjump =
  | `${string}:superjump`
  | `${string}:superjump:${string}`;

/**
 * `<steamId>:uncuff`
 *
 * - `steamId`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Uncuff =
  | `${string}:uncuff`
  | `${string}:uncuff:${string}`;

/**
 * `<steamId>:unmount`
 *
 * - `steamId`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Unmount =
  | `${string}:unmount`
  | `${string}:unmount:${string}`;

/**
 * `<steamid>:unsilence[:<channel>]`
 *
 * - `steamid`
 * - `channel` (optional)
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Unsilence =
  | `${string}:unsilence`
  | `${string}:unsilence:${string}`;

/**
 * `<steamId>:urinate:<natural>`
 *
 * - `steamId`
 * - `natural`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Urinate =
  | `${string}:urinate`
  | `${string}:urinate:${string}`;

/**
 * `<steamId>:vomit:<natural>`
 *
 * - `steamId`
 * - `natural`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Vomit =
  | `${string}:vomit`
  | `${string}:vomit:${string}`;

/**
 * `<steamId>:wetness:<part>`
 *
 * - `steamId`
 * - `part`: Limb
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * In-game actions, `module_command`.
 */
export type ActionsWrite_Wetness =
  | `${string}:wetness`
  | `${string}:wetness:${string}`;

/**
 * - `counts`
 *
 * Creature behaviour, `module_data`.
 */
export type AiRead_Counts =
  | "counts";

/**
 * `creature:<id>`
 *
 * - `id`
 *
 * Creature behaviour, `module_data`.
 */
export type AiRead_Creature =
  | `creature:${string}`;

/**
 * - `fields`
 *
 * Creature behaviour, `module_data`.
 */
export type AiRead_Fields =
  | "fields";

/**
 * `hunting:<steamid>`
 *
 * - `steamid`
 *
 * Creature behaviour, `module_data`.
 */
export type AiRead_Hunting =
  | `hunting:${string}`;

/**
 * `near:<steamid>:<radius>`
 *
 * - `steamid`
 * - `radius`
 * - also `near:<sid>:abc`
 *
 * Creature behaviour, `module_data`.
 */
export type AiRead_Near =
  | `near:${string}`;

/**
 * - `threats`
 *
 * Creature behaviour, `module_data`.
 */
export type AiRead_Threats =
  | "threats";

/**
 * `health:<id>:<value>`
 *
 * - `id`
 * - `value`: Health
 * - also `health:<id>:abc`
 * - also `health:<id>:nan`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: its target is a live object number that a restart does not keep.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Creature behaviour, `module_command`.
 */
export type AiWrite_Health =
  | `health:${string}:${string}`;

/**
 * `hostile:<id>:yes`
 *
 * - `id`
 * - `yes`: the word `yes`
 * - also `hostile:<id>:<on>`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: its target is a live object number that a restart does not keep.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Creature behaviour, `module_command`.
 */
export type AiWrite_Hostile =
  | `hostile:${string}:${string}`;

/**
 * `move:<id>:<x>,<y>,<z>`
 *
 * - `id`
 * - `x,y,z`: x, y and z, separated by commas
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: its target is a live object number that a restart does not keep.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Creature behaviour, `module_command`.
 */
export type AiWrite_Move =
  | `move:${string}`;

/**
 * `remove:<id>:junk`
 *
 * - `id`
 * - `junk`: the word `junk`
 * - also `remove:<id>`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: its target is a live object number that a restart does not keep.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Creature behaviour, `module_command`.
 */
export type AiWrite_Remove =
  | `remove:${string}`;

/**
 * `set:<id>:<field>:<value>`
 *
 * - `id`
 * - `field`
 * - `value`: Health
 * - also `set:<id>:limping:true`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: its target is a live object number that a restart does not keep.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Creature behaviour, `module_command`.
 */
export type AiWrite_Set =
  | `set:${string}:${string}:${string}`;

/**
 * `stance:<id>:<name>`
 *
 * - `id`
 * - `name`
 * - also `stance:<id>:combat:whatever`
 * - also `stance:<id>:alerted`
 * - also `stance:<id>:combat`
 * - also `stance:<rabbit>:aggressive`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: its target is a live object number that a restart does not keep.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Creature behaviour, `module_command`.
 */
export type AiWrite_Stance =
  | `stance:${string}:${string}`;

/**
 * `target:<id>:<steamid|none>`
 *
 * - `id`
 * - `steamid|none`: one of `steamid`, `none`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: its target is a live object number that a restart does not keep.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Creature behaviour, `module_command`.
 */
export type AiWrite_Target =
  | `target:${string}:${string}`;

/**
 * - `bases`
 *
 * Live bases and raid protection, `module_data`.
 */
export type BasesRead_Bases =
  | "bases";

/**
 * `contents:<baseId>`
 *
 * - `baseId`
 *
 * Live bases and raid protection, `module_data`.
 */
export type BasesRead_Contents =
  | `contents:${string}`;

/**
 * - `protection`
 *
 * Live bases and raid protection, `module_data`.
 */
export type BasesRead_Protection =
  | "protection";

/**
 * - `bases`
 *
 * Base building, `module_data`.
 */
export type BuildRead_Bases =
  | "bases";

/**
 * - `build`
 *
 * Base building, `module_data`.
 */
export type BuildRead_Build =
  | "build";

/**
 * `elements:<baseId>`
 *
 * - `baseId`: Base id
 *
 * Base building, `module_data`.
 */
export type BuildRead_Elements =
  | "elements"
  | `elements:${string}`;

/**
 * - `catalogue`
 *
 * Needs: Bridge records only. Changes the bridge's own bookkeeping, not the game.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Base building, `module_command`.
 */
export type BuildWrite_Catalogue =
  | "catalogue";

/**
 * `clearowner:<baseId>:<x>:<y>:<z>:CONFIRM`
 *
 * - `baseId`
 * - `x`
 * - `y`
 * - `z`
 * - `CONFIRM`: the word `CONFIRM`
 *
 * Needs: No player needed. Works with nobody online. Note: this clears the base record's owner; the owner players see is the flag's, which overtake moves.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Base building, `module_command`.
 */
export type BuildWrite_Clearowner =
  | `clearowner:${string}:${string}:${string}:${string}:${string}`;

/**
 * `demolish:<x>:<y>:<z>:<radius>:<elementType>:CONFIRM`
 *
 * - `x`
 * - `y`
 * - `z`
 * - `radius`
 * - `elementType`
 * - `CONFIRM`: the word `CONFIRM`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Base building, `module_command`.
 */
export type BuildWrite_Demolish =
  | `demolish:${string}:${string}:${string}:${string}:${string}:${string}`;

/**
 * `destroy:<baseId>:<elementId>:<x>:<y>:<z>[:<reason>[:<cascade>]]`
 *
 * - `baseId`
 * - `elementId`
 * - `x`
 * - `y`
 * - `z`
 * - `reason` (optional)
 * - `cascade` (optional)
 * - also `destroy:<baseId>:<elementId>:<x>:<y>:<z>[:<reason>][:true]`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Base building, `module_command`.
 */
export type BuildWrite_Destroy =
  | `destroy:${string}:${string}:${string}:${string}:${string}`
  | `destroy:${string}:${string}:${string}:${string}:${string}:${string}`
  | `destroy:${string}:${string}:${string}:${string}:${string}:${string}:${string}`;

/**
 * `fill:<placementId>:craft|godmode:via:<executor>`
 *
 * - `placementId`
 * - `craft|godmode`: one of `craft`, `godmode`
 * - `via`: the word `via`
 * - `executor`
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: The game's own route. Made through the game's own command or logic, so the game keeps it exactly as it keeps one it made itself. Whether that kind gets a save row was not measured here. Note: the game's own Craft or GodModeFill finishes the piece the way a player's does; whether it gets a save row is not measured yet.
 *
 * Base building, `module_command`.
 */
export type BuildWrite_Fill =
  | `fill:${string}:${string}`;

/**
 * `chown:<old>:<new>`
 *
 * - `old`
 * - `new`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Base building, `module_command`.
 */
export type BuildWrite_Chown =
  | `chown:${string}:${string}`;

/**
 * `learn:<full class path>`
 *
 * - `full class path`
 *
 * Needs: Bridge records only. Changes the bridge's own bookkeeping, not the game.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Base building, `module_command`.
 */
export type BuildWrite_Learn =
  | `learn:${string}`;

/**
 * `overtake:<elementId>:<x>:<y>:<z>:<newOwnerProfileId>`
 *
 * - `elementId`
 * - `x`
 * - `y`
 * - `z`
 * - `newOwnerProfileId`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Base building, `module_command`.
 */
export type BuildWrite_Overtake =
  | `overtake:${string}:${string}:${string}:${string}:${string}`;

/**
 * `place:<recipeName>:<x>:<y>:<z>:via:<steamId>`
 *
 * - `recipeName`
 * - `x`
 * - `y`
 * - `z`
 * - `via`: the word `via`
 * - `steamId`
 *
 * Needs: That player online. Acts on the named player, who must be online. Note: the recipe must be one the game holds in memory and both classes it names resident; the point within 10 m of the named player.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: The game's own route. Made through the game's own command or logic, so the game keeps it exactly as it keeps one it made itself. Whether that kind gets a save row was not measured here. Note: the game's own placement call makes the blueprint preview a player sees while choosing a spot; the game numbers and saves it only when that player confirms it in game.
 *
 * Base building, `module_command`.
 */
export type BuildWrite_Place =
  | `place:${string}:${string}:${string}:${string}`;

/**
 * `seedbase:<baseId>:<name>:<locX>:<locY>:<sizeX>:<sizeY>:<minX>:<minY>:<maxX>:<maxY>:<owner>:<ownedByPlayer>`
 *
 * - `baseId`
 * - `name`
 * - `locX`
 * - `locY`
 * - `sizeX`
 * - `sizeY`
 * - `minX`
 * - `minY`
 * - `maxX`
 * - `maxY`
 * - `owner`
 * - `ownedByPlayer`
 *
 * Needs: Bridge records only. Changes the bridge's own bookkeeping, not the game.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Base building, `module_command`.
 */
export type BuildWrite_Seedbase =
  | `seedbase:${string}:${string}:${string}:${string}:${string}:${string}:${string}:${string}:${string}:${string}:${string}:${string}`;

/**
 * `setowner:<baseId>:<x>:<y>:<z>:<newOwnerProfileId>`
 *
 * - `baseId`
 * - `x`
 * - `y`
 * - `z`
 * - `newOwnerProfileId`
 *
 * Needs: No player needed. Works with nobody online. Note: this is the base record's owner; the owner players see is the flag's, which overtake moves.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Base building, `module_command`.
 */
export type BuildWrite_Setowner =
  | `setowner:${string}:${string}:${string}:${string}:${string}`;

/**
 * `spawn:<baseId>:<class>:<x>:<y>:<z>:<yaw>:<elementId>[:<owner>[:<creator>]]`
 *
 * - `baseId`
 * - `class`
 * - `x`
 * - `y`
 * - `z`
 * - `yaw`
 * - `elementId`
 * - `owner` (optional)
 * - `creator` (optional)
 *
 * Needs: Needs a condition. Works with nobody online, but only once the condition its note names holds. Note: the base's data must be known: a piece built there since the server started, or its save row given with seedbase.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: the game keeps this state itself when a player does it, so the answer is the game's own route rather than a replay.
 * Creates: Not registered. No route in the game registers it: it has no entity id and no save row, and the reply says so. Note: the game wrote no save row for a piece placed this way, with the caller's id or with -1, and none of its own routes builds one.
 *
 * Base building, `module_command`.
 */
export type BuildWrite_Spawn =
  | `spawn:${string}:${string}:${string}:${string}:${string}:${string}:${string}`
  | `spawn:${string}:${string}:${string}:${string}:${string}:${string}:${string}:${string}`
  | `spawn:${string}:${string}:${string}:${string}:${string}:${string}:${string}:${string}:${string}`;

/**
 * `transfer:<old>:<new>`
 *
 * - `old`
 * - `new`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Base building, `module_command`.
 */
export type BuildWrite_Transfer =
  | `transfer:${string}:${string}`;

/**
 * - `curves`
 *
 * Weather and time, `module_data`.
 */
export type ClimateRead_Curves =
  | "curves";

/**
 * `get:<field>`
 *
 * - `field`
 *
 * Weather and time, `module_data`.
 */
export type ClimateRead_Get =
  | `get:${string}`;

/**
 * - `groups`
 *
 * Weather and time, `module_data`.
 */
export type ClimateRead_Groups =
  | "groups";

/**
 * - `members`
 *
 * Weather and time, `module_data`.
 */
export type ClimateRead_Members =
  | "members";

/**
 * - `rolls`
 *
 * Weather and time, `module_data`.
 */
export type ClimateRead_Rolls =
  | "rolls";

/**
 * - `state`
 *
 * Weather and time, `module_data`.
 */
export type ClimateRead_State =
  | "state";

/**
 * - `switches`
 *
 * Weather and time, `module_data`.
 */
export type ClimateRead_Switches =
  | "switches";

/**
 * `advance:<on>`
 *
 * - `on`: On
 *
 * Needs: Always refuses. Kept so a caller gets a reason; the game gives this verb no working route.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Weather and time, `module_command`.
 */
export type ClimateWrite_Advance =
  | `advance:${string}`;

/**
 * `set:<field>:<value>`
 *
 * - `field`
 * - `value`: Value
 *
 * Needs: No player needed. Works with nobody online. Note: it depends on the field: the clock and the water temperature came back after a restart (the game saves them, with the moon, the air temperature and the fog density), every other field goes back to the game's value, and a saved value the weather simulation moves can drift before the server stops.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Weather and time, `module_command`.
 */
export type ClimateWrite_Set =
  | `set:${string}`;

/**
 * `setbool:<switch>:on`
 *
 * - `switch`
 * - `on`: On; the word `on`
 * - also `setbool:<switch>:on|off`
 * - also `setbool:<key>:on|off`
 * - also `setbool:<key>:<on>`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Weather and time, `module_command`.
 */
export type ClimateWrite_Setbool =
  | `setbool:${string}`;

/**
 * `setc:<field>:<part>:<value>`
 *
 * - `field`
 * - `part`
 * - `value`: Value
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Weather and time, `module_command`.
 */
export type ClimateWrite_Setc =
  | `setc:${string}`;

/**
 * `setcurve:<curve>:<n>:<value>`
 *
 * - `curve`
 * - `n`
 * - `value`: Value
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Weather and time, `module_command`.
 */
export type ClimateWrite_Setcurve =
  | `setcurve:${string}`;

/**
 * `setstage:<channel>:<n>:<value>`
 *
 * - `channel`
 * - `n`
 * - `value`: Value
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Weather and time, `module_command`.
 */
export type ClimateWrite_Setstage =
  | `setstage:${string}`;

/**
 * `setv:<field>:<a>,<b>,…`
 *
 * - `field`
 * - `a,b,…`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Weather and time, `module_command`.
 */
export type ClimateWrite_Setv =
  | `setv:${string}`;

/**
 * `simulate:<on>`
 *
 * - `on`: On
 *
 * Needs: Always refuses. Kept so a caller gets a reason; the game gives this verb no working route.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Weather and time, `module_command`.
 */
export type ClimateWrite_Simulate =
  | `simulate:${string}`;

/**
 * - `cookrecipes`
 *
 * Crafting and fishing, `module_data`.
 */
export type CraftRead_Cookrecipes =
  | "cookrecipes";

/**
 * - `craft`
 *
 * Crafting and fishing, `module_data`.
 */
export type CraftRead_Craft =
  | "craft";

/**
 * - `craftEvents`
 *
 * Crafting and fishing, `module_data`.
 */
export type CraftRead_CraftEvents =
  | "craftEvents";

/**
 * - `fishing`
 *
 * Crafting and fishing, `module_data`.
 */
export type CraftRead_Fishing =
  | "fishing";

/**
 * - `placements`
 *
 * Crafting and fishing, `module_data`.
 */
export type CraftRead_Placements =
  | "placements";

/**
 * - `last`
 *
 * Damage at a point, `module_data`.
 */
export type DamageRead_Last =
  | "last";

/**
 * `preview:<x>:<y>:<z>:<radius>`
 *
 * - `x`
 * - `y`
 * - `z`
 * - `radius`
 *
 * Damage at a point, `module_data`.
 */
export type DamageRead_Preview =
  | `preview:${string}`;

/**
 * - `explode`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Damage at a point, `module_command`.
 */
export type DamageWrite_Explode =
  | "explode"
  | `explode:${string}`;

/**
 * `here:<x>,<y>,<z>,<radius>`
 *
 * - `x,y,z,radius`: x, y, z and radius, separated by commas
 *
 * Remove from the world, `module_data`.
 */
export type DespawnRead_Here =
  | `here:${string}`;

/**
 * - `kinds`
 *
 * Remove from the world, `module_data`.
 */
export type DespawnRead_Kinds =
  | "kinds";

/**
 * `preview:<kind>:<x>,<y>,<z>,<r>:<id>`
 *
 * - `kind`
 * - `x,y,z,r`: x, y, z and r, separated by commas
 * - `id`
 * - also `preview:<kind>:<x>,<y>,<z>,<radius>`
 * - also `preview:<kind>`
 * - also `preview:<kind>:<x>,<y>,<z>,<r>`
 *
 * Remove from the world, `module_data`.
 */
export type DespawnRead_Preview =
  | `preview:${string}`;

/**
 * `<kind>:<x>,<y>,<z>,<radius>:<index>.<serial>`
 *
 * - `x,y,z,radius`: x, y, z and radius, separated by commas
 * - `index.serial`
 * - also `<kind>:<x>,<y>,<z>,<radius>`
 * - also `vehicle:<x>,<y>,<z>,<radius>:eid:<entity id>`
 * - also `<kind>:<x>,<y>,<z>,<radius>:CONFIRM`
 * - also `<kind>:<x>,<y>,<z>,<radius>[:CONFIRM]`
 * - the parser accepts a field count no usage spells; send a wrong one to read what it wants
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player. Note: a vehicle removed by entity id stays removed; creatures, sentries and the other kinds have no save row, and the game's own spawners make new ones.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Remove from the world, `module_command`.
 */
export type DespawnWrite_Kind =
  | `${Kind_despawn}:${string}`
  | `${Kind_despawn}:${string}:${string}`
  | `${Kind_despawn}:${string}:${string}:${string}`
  | `${Kind_despawn}:${string}:${string}:${string}:${string}`;

/**
 * `stow:<kind>:<x>,<y>,<z>,<radius>:<index>.<serial>`
 *
 * - `kind`
 * - `x,y,z,radius`: x, y, z and radius, separated by commas
 * - `index.serial`
 * - also `stow:mapsentry:<x>,<y>,<z>,<radius>:<index>.<serial>`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: its target is a live object number that a restart does not keep.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Remove from the world, `module_command`.
 */
export type DespawnWrite_Stow =
  | `stow:${string}`;

/**
 * - `classes`
 *
 * Door Shuffle, `module_data`.
 */
export type DoorsRead_Classes =
  | "classes";

/**
 * `door:<Level>:<Actor>`
 *
 * - `Level`: Level
 * - `Actor`: Door
 *
 * Door Shuffle, `module_data`.
 */
export type DoorsRead_Door =
  | `door:${string}`;

/**
 * - `interact`
 *
 * Door Shuffle, `module_data`.
 */
export type DoorsRead_Interact =
  | "interact";

/**
 * - `levels`
 *
 * Door Shuffle, `module_data`.
 */
export type DoorsRead_Levels =
  | "levels";

/**
 * `close:<Level>:<Actor>`
 *
 * - `Level`: Level
 * - `Actor`: Door
 *
 * Needs: No player needed. Works with nobody online. Note: with :via:<steamId> or :via:any it runs as the game's own interaction through an online player; run that way with the player kilometres from the door, the game offered only the move the door's state allows and applied it.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: open and shut are saved for nobody, a player's change included, so the game decides each door again at a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Door Shuffle, `module_command`.
 */
export type DoorsWrite_Close =
  | `close:${string}`;

/**
 * `lock:<target>`
 *
 * - `target`
 *
 * Needs: Always refuses. Kept so a caller gets a reason; the game gives this verb no working route.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Door Shuffle, `module_command`.
 */
export type DoorsWrite_Lock =
  | "lock"
  | `lock:${string}`;

/**
 * `open:<Level>:<Actor>`
 *
 * - `Level`: Level
 * - `Actor`: Door
 *
 * Needs: No player needed. Works with nobody online. Note: with :via:<steamId> or :via:any it runs as the game's own interaction through an online player; run that way with the player kilometres from the door, the game offered only the move the door's state allows and applied it.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: open and shut are saved for nobody, a player's change included, so the game decides each door again at a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Door Shuffle, `module_command`.
 */
export type DoorsWrite_Open =
  | `open:${string}`;

/**
 * - `save`
 *
 * Needs: Bridge records only. Changes the bridge's own bookkeeping, not the game.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Door Shuffle, `module_command`.
 */
export type DoorsWrite_Save =
  | "save";

/**
 * `seal:<Level>:<Actor>`
 *
 * - `Level`: Level
 * - `Actor`: Door
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: a seal is the door's own may-open flag, which the game saves for nobody.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Door Shuffle, `module_command`.
 */
export type DoorsWrite_Seal =
  | `seal:${string}`;

/**
 * `unlock:<target>`
 *
 * - `target`
 *
 * Needs: Always refuses. Kept so a caller gets a reason; the game gives this verb no working route.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Door Shuffle, `module_command`.
 */
export type DoorsWrite_Unlock =
  | "unlock"
  | `unlock:${string}`;

/**
 * `unseal:<key>:force`
 *
 * - `key`
 * - `force`: the word `force`
 * - also `unseal:<Level>:<Actor>`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: a seal is the door's own may-open flag, which the game saves for nobody.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Door Shuffle, `module_command`.
 */
export type DoorsWrite_Unseal =
  | `unseal:${string}`;

/**
 * - `bases`
 *
 * Encounters and spawn waves, `module_data`.
 */
export type EncountersRead_Bases =
  | "bases";

/**
 * - `encounters`
 *
 * Encounters and spawn waves, `module_data`.
 */
export type EncountersRead_Encounters =
  | "encounters";

/**
 * - `hordes`
 *
 * Encounters and spawn waves, `module_data`.
 */
export type EncountersRead_Hordes =
  | "hordes";

/**
 * - `nearby`
 *
 * Encounters and spawn waves, `module_data`.
 */
export type EncountersRead_Nearby =
  | "nearby";

/**
 * - `places`
 *
 * Encounters and spawn waves, `module_data`.
 */
export type EncountersRead_Places =
  | "places";

/**
 * - `schedule`
 *
 * Encounters and spawn waves, `module_data`.
 */
export type EncountersRead_Schedule =
  | "schedule";

/**
 * - `tuning`
 *
 * Encounters and spawn waves, `module_data`.
 */
export type EncountersRead_Tuning =
  | "tuning";

/**
 * - `bb`
 *
 * Needs: Any player online (admin command). Runs one of the game's admin commands, which the game only runs through an online player.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: The game's own route. Made through the game's own command or logic, so the game keeps it exactly as it keeps one it made itself. Whether that kind gets a save row was not measured here. Note: the game's encounter makes whatever it spawns.
 *
 * Encounters and spawn waves, `module_command`.
 */
export type EncountersWrite_Bb =
  | "bb"
  | `bb:${string}`;

/**
 * - `draw`
 *
 * Needs: Any player online (admin command). Runs one of the game's admin commands, which the game only runs through an online player.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: The game's own route. Made through the game's own command or logic, so the game keeps it exactly as it keeps one it made itself. Whether that kind gets a save row was not measured here. Note: the game's encounter makes whatever it spawns.
 *
 * Encounters and spawn waves, `module_command`.
 */
export type EncountersWrite_Draw =
  | "draw"
  | `draw:${string}`;

/**
 * - `dump`
 *
 * Needs: Any player online (admin command). Runs one of the game's admin commands, which the game only runs through an online player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Encounters and spawn waves, `module_command`.
 */
export type EncountersWrite_Dump =
  | "dump"
  | `dump:${string}`;

/**
 * `zone:<asset>:<chance %|->:<check min s|->:<check max s|->:<hold s>:CONFIRM`
 *
 * - `asset`: Kind of place
 * - `chance %|-`: one of `chance %`, `-`
 * - `check min s|-`: one of `check min s`, `-`
 * - `check max s|-`: one of `check max s`, `-`
 * - `hold s`
 * - `CONFIRM`: the word `CONFIRM`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Encounters and spawn waves, `module_command`.
 */
export type EncountersWrite_Zone =
  | `zone:${string}:${string}:${string}:${string}:${string}:${string}`;

/**
 * - `zonerestore`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: it puts the game's own values back, which a restart already does.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Encounters and spawn waves, `module_command`.
 */
export type EncountersWrite_Zonerestore =
  | "zonerestore"
  | `zonerestore:${string}`;

/**
 * - `bases`
 *
 * Live world, `module_data`.
 */
export type EntitiesRead_Bases =
  | "bases";

/**
 * - `entities`
 *
 * Live world, `module_data`.
 */
export type EntitiesRead_Entities =
  | "entities";

/**
 * `entity:<id>,<property>`
 *
 * - `id,property`: id and property, separated by commas
 *
 * Live world, `module_data`.
 */
export type EntitiesRead_Entity =
  | `entity:${string}`;

/**
 * - `kinds`
 *
 * Live world, `module_data`.
 */
export type EntitiesRead_Kinds =
  | "kinds";

/**
 * `heal:<id>,<ratio>`
 *
 * - `id,ratio`: id and ratio, separated by commas
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live world, `module_command`.
 */
export type EntitiesWrite_Heal =
  | `heal:${string}`;

/**
 * `set:<id>,<property>,<type>,<value>`
 *
 * - `id,property,type,value`: id, property, type and value, separated by commas
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live world, `module_command`.
 */
export type EntitiesWrite_Set =
  | `set:${string}`;

/**
 * `events:since:<seq>`
 *
 * - `since`: the word `since`
 * - `seq`
 * - also `events`
 *
 * Live game events, `module_data`.
 */
export type EventsRead_Events =
  | "events"
  | `events:since:${string}`;

/**
 * - `kinds`
 *
 * Live game events, `module_data`.
 */
export type EventsRead_Kinds =
  | "kinds";

/**
 * - `peek`
 *
 * Live game events, `module_data`.
 */
export type EventsRead_Peek =
  | "peek";

/**
 * - `watches`
 *
 * Live game events, `module_data`.
 */
export type EventsRead_Watches =
  | "watches";

/**
 * - `farming`
 *
 * Gardens and crops, `module_data`.
 */
export type FarmingRead_Farming =
  | "farming";

/**
 * `garden:<id>`
 *
 * - `id`
 *
 * Gardens and crops, `module_data`.
 */
export type FarmingRead_Garden =
  | `garden:${string}`;

/**
 * - `events`
 *
 * Window and door barricades, `module_data`.
 */
export type FortificationsRead_Events =
  | "events";

/**
 * - `fortifications`
 *
 * Window and door barricades, `module_data`.
 */
export type FortificationsRead_Fortifications =
  | "fortifications";

/**
 * - `ledger`
 *
 * Window and door barricades, `module_data`.
 */
export type FortificationsRead_Ledger =
  | "ledger";

/**
 * `near:<x>,<y>,<z>,<radius>`
 *
 * - `x,y,z,radius`: x, y, z and radius, separated by commas
 *
 * Window and door barricades, `module_data`.
 */
export type FortificationsRead_Near =
  | `near:${string}`;

/**
 * - `openings`
 *
 * Window and door barricades, `module_data`.
 */
export type FortificationsRead_Openings =
  | "openings";

/**
 * `owner:<profileId>`
 *
 * - `profileId`
 *
 * Window and door barricades, `module_data`.
 */
export type FortificationsRead_Owner =
  | `owner:${string}`;

/**
 * - `add`
 *
 * Needs: Always refuses. Kept so a caller gets a reason; the game gives this verb no working route.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Window and door barricades, `module_command`.
 */
export type FortificationsWrite_Add =
  | "add";

/**
 * - `build`
 *
 * Needs: Always refuses. Kept so a caller gets a reason; the game gives this verb no working route.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Window and door barricades, `module_command`.
 */
export type FortificationsWrite_Build =
  | "build";

/**
 * - `destroy`
 *
 * Needs: Always refuses. Kept so a caller gets a reason; the game gives this verb no working route.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Window and door barricades, `module_command`.
 */
export type FortificationsWrite_Destroy =
  | "destroy";

/**
 * - `forget`
 * - `forget:CONFIRM`
 *
 * Needs: Bridge records only. Changes the bridge's own bookkeeping, not the game.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Window and door barricades, `module_command`.
 */
export type FortificationsWrite_Forget =
  | "forget"
  | "forget:CONFIRM";

/**
 * - `heal`
 *
 * Needs: Always refuses. Kept so a caller gets a reason; the game gives this verb no working route.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Window and door barricades, `module_command`.
 */
export type FortificationsWrite_Heal =
  | "heal";

/**
 * - `place`
 *
 * Needs: Always refuses. Kept so a caller gets a reason; the game gives this verb no working route.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Window and door barricades, `module_command`.
 */
export type FortificationsWrite_Place =
  | "place";

/**
 * - `remove`
 *
 * Needs: Always refuses. Kept so a caller gets a reason; the game gives this verb no working route.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Window and door barricades, `module_command`.
 */
export type FortificationsWrite_Remove =
  | "remove";

/**
 * - `repair`
 *
 * Needs: Always refuses. Kept so a caller gets a reason; the game gives this verb no working route.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Window and door barricades, `module_command`.
 */
export type FortificationsWrite_Repair =
  | "repair";

/**
 * - `sethealth`
 *
 * Needs: Always refuses. Kept so a caller gets a reason; the game gives this verb no working route.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Window and door barricades, `module_command`.
 */
export type FortificationsWrite_Sethealth =
  | "sethealth";

/**
 * - `last`
 *
 * Move items, `module_data`.
 */
export type GiveRead_Last =
  | "last";

/**
 * `<sid>:drop:<count>:<selector>`
 *
 * - `sid`
 * - `count`
 * - `selector`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Move items, `module_command`.
 */
export type GiveWrite_Drop =
  | `${string}:drop`
  | `${string}:drop:${string}`;

/**
 * `<steamid>:dropat:<x>,<y>,<z>:<selector>`
 *
 * - `steamid`
 * - `x,y,z`: x, y and z, separated by commas
 * - `selector`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Move items, `module_command`.
 */
export type GiveWrite_Dropat =
  | `${string}:dropat`
  | `${string}:dropat:${string}`;

/**
 * `<steamId>:equip:eid:<entityId>`
 *
 * - `steamId`
 * - `eid`: the word `eid`
 * - `entityId`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Move items, `module_command`.
 */
export type GiveWrite_Equip =
  | `${string}:equip`
  | `${string}:equip:${string}`;

/**
 * `<steamId>:equipswap:<oldEntityId>:eid:<newEntityId>`
 *
 * - `steamId`
 * - `oldEntityId`
 * - `eid`: the word `eid`
 * - `newEntityId`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: the game keeps what a player carries and wears itself.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Move items, `module_command`.
 */
export type GiveWrite_Equipswap =
  | `${string}:equipswap`
  | `${string}:equipswap:${string}`;

/**
 * `<sid>:hands:<selector>`
 *
 * - `sid`
 * - `selector`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Move items, `module_command`.
 */
export type GiveWrite_Hands =
  | `${string}:hands`
  | `${string}:hands:${string}`;

/**
 * `<sid>:inventory:<selector>`
 *
 * - `sid`
 * - `selector`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Move items, `module_command`.
 */
export type GiveWrite_Inventory =
  | `${string}:inventory`
  | `${string}:inventory:${string}`;

/**
 * `<sid>:inventoryall:<selector>`
 *
 * - `sid`
 * - `selector`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: it gives an item the game then keeps, so a replay would give it again.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Move items, `module_command`.
 */
export type GiveWrite_Inventoryall =
  | `${string}:inventoryall`
  | `${string}:inventoryall:${string}`;

/**
 * `<sid>:inventoryn:<count>:<selector>`
 *
 * - `sid`
 * - `count`
 * - `selector`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: it gives an item the game then keeps, so a replay would give it again.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Move items, `module_command`.
 */
export type GiveWrite_Inventoryn =
  | `${string}:inventoryn`
  | `${string}:inventoryn:${string}`;

/**
 * `<sid>:remove:<count>:<areaSelector>:CONFIRM`
 *
 * - `sid`
 * - `count`
 * - `areaSelector`
 * - `CONFIRM`: the word `CONFIRM`
 * - also `<sid>:remove:<count>:<selector>`
 * - also `<steamId>:remove:<count>:<selector>`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Move items, `module_command`.
 */
export type GiveWrite_Remove =
  | `${string}:remove`
  | `${string}:remove:${string}`;

/**
 * `<steamId>:shoulder:<s>:eid:<entityId>`
 *
 * - `steamId`
 * - `s`
 * - `eid`: the word `eid`
 * - `entityId`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: the game keeps what a player carries and wears itself.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Move items, `module_command`.
 */
export type GiveWrite_Shoulder =
  | `${string}:shoulder`
  | `${string}:shoulder:${string}`;

/**
 * `<steamId>:unequip:eid:<entityId>`
 *
 * - `steamId`
 * - `eid`: the word `eid`
 * - `entityId`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: the game keeps what a player carries and wears itself.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Move items, `module_command`.
 */
export type GiveWrite_Unequip =
  | `${string}:unequip`
  | `${string}:unequip:${string}`;

/**
 * - `exposure`
 *
 * Radiation and wetness, `module_data`.
 */
export type HazardRead_Exposure =
  | "exposure";

/**
 * `get:<field>`
 *
 * - `field`
 *
 * Radiation and wetness, `module_data`.
 */
export type HazardRead_Get =
  | `get:${string}`;

/**
 * - `groups`
 *
 * Radiation and wetness, `module_data`.
 */
export type HazardRead_Groups =
  | "groups";

/**
 * - `job`
 *
 * Radiation and wetness, `module_data`.
 */
export type HazardRead_Job =
  | "job";

/**
 * `measure:<zone index>`
 *
 * - `zone index`
 * - also `measure`
 *
 * Radiation and wetness, `module_data`.
 */
export type HazardRead_Measure =
  | "measure"
  | `measure:${string}`;

/**
 * - `state`
 *
 * Radiation and wetness, `module_data`.
 */
export type HazardRead_State =
  | "state";

/**
 * - `zones`
 *
 * Radiation and wetness, `module_data`.
 */
export type HazardRead_Zones =
  | "zones";

/**
 * `event:<multiplier>:CONFIRM`
 *
 * - `multiplier`
 * - `CONFIRM`: the word `CONFIRM`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Radiation and wetness, `module_command`.
 */
export type HazardWrite_Event =
  | `event:${string}`;

/**
 * `restore:<index>`
 *
 * - `index`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: it puts the game's own values back, which a restart already does.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Radiation and wetness, `module_command`.
 */
export type HazardWrite_Restore =
  | "restore"
  | `restore:${string}`;

/**
 * `set:<field>:<value>`
 *
 * - `field`
 * - `value`: Value
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Radiation and wetness, `module_command`.
 */
export type HazardWrite_Set =
  | `set:${string}`;

/**
 * `zone:<index>:<field>:<value>`
 *
 * - `index`
 * - `field`
 * - `value`: Value
 * - also `zone:<index>:rate:<value>`
 * - also `zone:<index>:rate`
 * - also `zone:<index>`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Radiation and wetness, `module_command`.
 */
export type HazardWrite_Zone =
  | `zone:${string}`;

/**
 * - `attachjob`
 *
 * Live inventories, `module_data`.
 */
export type ItemsRead_Attachjob =
  | "attachjob";

/**
 * `attachments:eid:<id>`
 *
 * - `eid`: the word `eid`
 * - `id`
 *
 * Live inventories, `module_data`.
 */
export type ItemsRead_Attachments =
  | `attachments:${string}`;

/**
 * - `counts`
 *
 * Live inventories, `module_data`.
 */
export type ItemsRead_Counts =
  | "counts";

/**
 * `inventory:<steamid>`
 *
 * - `steamid`
 *
 * Live inventories, `module_data`.
 */
export type ItemsRead_Inventory =
  | `inventory:${string}`;

/**
 * - `last`
 *
 * Live inventories, `module_data`.
 */
export type ItemsRead_Last =
  | "last";

/**
 * `near:<x>,<y>,<r>`
 *
 * - `x,y,r`: x, y and r, separated by commas
 *
 * Live inventories, `module_data`.
 */
export type ItemsRead_Near =
  | `near:${string}`;

/**
 * - `traps`
 *
 * Live inventories, `module_data`.
 */
export type ItemsRead_Traps =
  | "traps";

/**
 * `where:eid:<id>`
 *
 * - `eid`: the word `eid`
 * - `id`
 *
 * Live inventories, `module_data`.
 */
export type ItemsRead_Where =
  | `where:${string}`;

/**
 * `attach:eid:<weapon>:eid:<attachment>`
 *
 * - `eid`: the word `eid`
 * - `weapon`
 * - `eid`: the word `eid`
 * - `attachment`
 * - also `attach:eid:<weapon>:<ItemCode>`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player. Note: both items must be loaded; the `attach:eid:<weapon>:<ItemCode>` form spawns the part through an online player. The fit is saved with the weapon and lasts as long as the weapon does; a weapon left on the ground expires like any loose item.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Registered. Made through the game's own route and kept in the game's own records, an entity id and a save row for an item, so the game brings it back after a restart. Note: only the form naming an item code makes a part, through the game's own item spawn, and the part has an entity id.
 *
 * Live inventories, `module_command`.
 */
export type ItemsWrite_Attach =
  | `attach:${string}`;

/**
 * `condition:<value>:<selector>`
 *
 * - `value`
 * - `selector`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live inventories, `module_command`.
 */
export type ItemsWrite_Condition =
  | `condition:${string}`;

/**
 * `destroy:<selector>`
 *
 * - `selector`
 * - also `destroy:CONFIRM:<selector>`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live inventories, `module_command`.
 */
export type ItemsWrite_Destroy =
  | `destroy:${string}`;

/**
 * `detach:eid:<weapon>:eid:<attachment>`
 *
 * - `eid`: the word `eid`
 * - `weapon`
 * - `eid`: the word `eid`
 * - `attachment`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: the game keeps a weapon's parts itself, as a measured fit shows.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live inventories, `module_command`.
 */
export type ItemsWrite_Detach =
  | `detach:${string}`;

/**
 * `drop:eid:<id>`
 *
 * - `eid`: the word `eid`
 * - `id`
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live inventories, `module_command`.
 */
export type ItemsWrite_Drop =
  | `drop:${string}`;

/**
 * - `apex`
 *
 * Killbox, `module_data`.
 */
export type KillboxRead_Apex =
  | "apex";

/**
 * - `killbox`
 *
 * Killbox, `module_data`.
 */
export type KillboxRead_Killbox =
  | "killbox";

/**
 * `activated:<level>:<on|off>:CONFIRM`
 *
 * - `level`
 * - `on|off`: one of `on`, `off`
 * - `CONFIRM`: the word `CONFIRM`
 * - also `activated:<lvl>:on:CONFIRM`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Killbox, `module_command`.
 */
export type KillboxWrite_Activated =
  | `activated:${string}`;

/**
 * `finale:<level>:<on|off>`
 *
 * - `level`
 * - `on|off`: one of `on`, `off`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Killbox, `module_command`.
 */
export type KillboxWrite_Finale =
  | `finale:${string}`;

/**
 * `panic:<level>:CONFIRM`
 *
 * - `level`
 * - `CONFIRM`: the word `CONFIRM`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Killbox, `module_command`.
 */
export type KillboxWrite_Panic =
  | `panic:${string}:${string}`;

/**
 * `time:<level>:<seconds>`
 *
 * - `level`
 * - `seconds`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: a countdown, so a replay would start it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Killbox, `module_command`.
 */
export type KillboxWrite_Time =
  | `time:${string}:${string}`;

/**
 * `tune:<level>:<field>:<value>`
 *
 * - `level`
 * - `field`
 * - `value`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Killbox, `module_command`.
 */
export type KillboxWrite_Tune =
  | `tune:${string}:${string}:${string}`;

/**
 * - `kills`
 *
 * Live player data, `module_data`.
 */
export type LiveRead_Kills =
  | "kills";

/**
 * - `players`
 *
 * Live player data, `module_data`.
 */
export type LiveRead_Players =
  | "players";

/**
 * - `server`
 *
 * Live player data, `module_data`.
 */
export type LiveRead_Server =
  | "server";

/**
 * - `world`
 *
 * Live player data, `module_data`.
 */
export type LiveRead_World =
  | "world";

/**
 * `locked:<level>`
 *
 * - `level`
 * - also `locked`
 *
 * Doors and locks, `module_data`.
 */
export type LocksRead_Locked =
  | "locked"
  | `locked:${string}`;

/**
 * `locks:<level>`
 *
 * - `level`
 * - also `locks`
 *
 * Doors and locks, `module_data`.
 */
export type LocksRead_Locks =
  | "locks"
  | `locks:${string}`;

/**
 * `near:<x>:<y>:<radius>`
 *
 * - `x`
 * - `y`
 * - `radius`
 *
 * Doors and locks, `module_data`.
 */
export type LocksRead_Near =
  | `near:${string}`;

/**
 * - `replication`
 *
 * Doors and locks, `module_data`.
 */
export type LocksRead_Replication =
  | "replication";

/**
 * - `saved`
 *
 * Doors and locks, `module_data`.
 */
export type LocksRead_Saved =
  | "saved";

/**
 * `access:<base door>:private`
 *
 * - `base door`
 * - `private`: the word `private`
 * - also `access:<target>:<level>`
 * - also `access:<target>:<public|private|rank1|rank2|rank3|rank4>`
 *
 * Needs: No player needed. Works with nobody online. Note: with :via:<steamId> or :via:any it runs as the game's own interaction through an online player, and the game saves that change and keeps it across a restart.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: the game keeps this state itself when a player does it, so the answer is the game's own route rather than a replay.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Doors and locks, `module_command`.
 */
export type LocksWrite_Access =
  | `access:${string}:${string}`;

/**
 * `attach:<target>:via:<steamId>`
 *
 * - `target`: Lock or door
 * - `via`: the word `via`
 * - `steamId`
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server. Note: needs :via:<steamId>, the player holding the lock to fit; the game's lock-slot drop (AddUpgrade with that item), which the game's menu does not list.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Doors and locks, `module_command`.
 */
export type LocksWrite_Attach =
  | `attach:${string}`;

/**
 * `close:<target>`
 *
 * - `target`: Lock or door
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: the game keeps this state itself when a player does it, so the answer is the game's own route rather than a replay.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Doors and locks, `module_command`.
 */
export type LocksWrite_Close =
  | `close:${string}`;

/**
 * `code:<target>:<combination>`
 *
 * - `target`: Lock or door
 * - `combination`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a base lock is named by its door's instance number, which held across the restarts measured but is not promised once a base is built or destroyed, and the wrong door is somebody else's base.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Doors and locks, `module_command`.
 */
export type LocksWrite_Code =
  | `code:${string}:${string}`;

/**
 * `detach:<target>[:<n>]:via:<steamId>`
 *
 * - `target`: Lock or door
 * - `n` (optional)
 * - `via`: the word `via`
 * - `steamId`
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server. Note: needs :via:<steamId>; the game's own RemoveLocks, the lock numbered as in the game's menu (first by default).
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Doors and locks, `module_command`.
 */
export type LocksWrite_Detach =
  | `detach:${string}`
  | `detach:${string}:${string}`;

/**
 * `hp:<target>:<value>`
 *
 * - `target`: Lock or door
 * - `value`: Attempts
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a base lock is named by its door's instance number, which held across the restarts measured but is not promised once a base is built or destroyed, and the wrong door is somebody else's base.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Doors and locks, `module_command`.
 */
export type LocksWrite_Hp =
  | `hp:${string}:${string}`;

/**
 * `lock:<target>`
 *
 * - `target`: Lock or door
 *
 * Needs: No player needed. Works with nobody online. Note: with :via:<steamId> or :via:any it runs as the game's own interaction through an online player.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a base lock is named by its door's instance number, which held across the restarts measured but is not promised once a base is built or destroyed, and the wrong door is somebody else's base.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Doors and locks, `module_command`.
 */
export type LocksWrite_Lock =
  | `lock:${string}`;

/**
 * `open:<target>`
 *
 * - `target`: Lock or door
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: the game keeps this state itself when a player does it, so the answer is the game's own route rather than a replay.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Doors and locks, `module_command`.
 */
export type LocksWrite_Open =
  | `open:${string}`;

/**
 * `tries:<target>:<count>`
 *
 * - `target`: Lock or door
 * - `count`
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a base lock is named by its door's instance number, which held across the restarts measured but is not promised once a base is built or destroyed, and the wrong door is somebody else's base.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Doors and locks, `module_command`.
 */
export type LocksWrite_Tries =
  | `tries:${string}:${string}`;

/**
 * `unlock:<target>`
 *
 * - `target`: Lock or door
 *
 * Needs: No player needed. Works with nobody online. Note: with :via:<steamId> or :via:any it runs as the game's own interaction through an online player.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: a base lock is named by its door's instance number, which held across the restarts measured but is not promised once a base is built or destroyed, and the wrong door is somebody else's base.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Doors and locks, `module_command`.
 */
export type LocksWrite_Unlock =
  | `unlock:${string}`;

/**
 * - `files`
 *
 * Loot tables, `module_data`.
 */
export type LootRead_Files =
  | "files";

/**
 * - `export:…`
 *
 * The source does not name these fields.
 *
 * Needs: Any player online (admin command). Runs one of the game's admin commands, which the game only runs through an online player.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Loot tables, `module_command`.
 */
export type LootWrite_Export =
  | `export:${string}`;

/**
 * - `catalogue`
 *
 * Medical state, `module_data`.
 */
export type MedicalRead_Catalogue =
  | "catalogue";

/**
 * `conditions:<steamid>`
 *
 * - `steamid`
 *
 * Medical state, `module_data`.
 */
export type MedicalRead_Conditions =
  | `conditions:${string}`;

/**
 * `deaths:since:<seq>`
 *
 * - `since`: the word `since`
 * - `seq`
 *
 * Medical state, `module_data`.
 */
export type MedicalRead_Deaths =
  | "deaths"
  | `deaths:since:${string}`;

/**
 * - `fields`
 *
 * Medical state, `module_data`.
 */
export type MedicalRead_Fields =
  | "fields";

/**
 * - `lastcure`
 *
 * Medical state, `module_data`.
 */
export type MedicalRead_Lastcure =
  | "lastcure";

/**
 * - `lastchange`
 *
 * Medical state, `module_data`.
 */
export type MedicalRead_Lastchange =
  | "lastchange";

/**
 * - `lastmeta`
 *
 * Medical state, `module_data`.
 */
export type MedicalRead_Lastmeta =
  | "lastmeta";

/**
 * `player:<steamid>`
 *
 * - `steamid`
 *
 * Medical state, `module_data`.
 */
export type MedicalRead_Player =
  | `player:${string}`;

/**
 * - `players`
 *
 * Medical state, `module_data`.
 */
export type MedicalRead_Players =
  | "players";

/**
 * `severities:<steamid>`
 *
 * - `steamid`
 *
 * Medical state, `module_data`.
 */
export type MedicalRead_Severities =
  | `severities:${string}`;

/**
 * `substances:<steamid>`
 *
 * - `steamid`
 *
 * Medical state, `module_data`.
 */
export type MedicalRead_Substances =
  | `substances:${string}`;

/**
 * `add:<steamid>:<EffectName>`
 *
 * - `steamid`
 * - `EffectName`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Medical state, `module_command`.
 */
export type MedicalWrite_Add =
  | `add:${string}:${string}`;

/**
 * `bladder:<steamid>:<amount in ml or SU, or a %>`
 *
 * - `steamid`
 * - `amount in ml or SU, or a %`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Medical state, `module_command`.
 */
export type MedicalWrite_Bladder =
  | `bladder:${string}:${string}`;

/**
 * `bleed:<steamid>:<bodyPart>:<damage>:<bloodLossRate>`
 *
 * - `steamid`
 * - `bodyPart`
 * - `damage`
 * - `bloodLossRate`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Medical state, `module_command`.
 */
export type MedicalWrite_Bleed =
  | `bleed:${string}:${string}`;

/**
 * `burn:<steamid>:<bodyPart>:<damage>`
 *
 * - `steamid`
 * - `bodyPart`
 * - `damage`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Medical state, `module_command`.
 */
export type MedicalWrite_Burn =
  | `burn:${string}:${string}`;

/**
 * `cure:<steamid>:all:CONFIRM`
 *
 * - `steamid`
 * - `all`: the word `all`
 * - `CONFIRM`: the word `CONFIRM`
 * - also `cure:<steamid>:<selector>`
 * - also `cure:<sid>:FeelingCold_C`
 * - also `cure:<sid>:Hypothermia`
 * - also `cure:<steamid>:FootAbrasions`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Medical state, `module_command`.
 */
export type MedicalWrite_Cure =
  | `cure:${string}:${string}`;

/**
 * `exhaustion:<steamid>:<amount in ml or SU, or a %>`
 *
 * - `steamid`
 * - `amount in ml or SU, or a %`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: the game keeps the character's body and profile itself, so a replay would apply it again over what changed since.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Medical state, `module_command`.
 */
export type MedicalWrite_Exhaustion =
  | `exhaustion:${string}:${string}`;

/**
 * `feed:<steamid>:<amount in ml or SU, or a %>`
 *
 * - `steamid`
 * - `amount in ml or SU, or a %`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Medical state, `module_command`.
 */
export type MedicalWrite_Feed =
  | `feed:${string}:${string}`;

/**
 * `incubation:<steamid>:<true|false>`
 *
 * - `steamid`
 * - `true|false`: one of `true`, `false`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: the game keeps the character's body and profile itself, so a replay would apply it again over what changed since.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Medical state, `module_command`.
 */
export type MedicalWrite_Incubation =
  | `incubation:${string}:${string}`;

/**
 * `infiniteoxygen:<steamid>:<true|false>`
 *
 * - `steamid`
 * - `true|false`: one of `true`, `false`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: the game keeps the character's body and profile itself, so a replay would apply it again over what changed since.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Medical state, `module_command`.
 */
export type MedicalWrite_Infiniteoxygen =
  | `infiniteoxygen:${string}:${string}`;

/**
 * `infinitestamina:<steamid>:<true|false>`
 *
 * - `steamid`
 * - `true|false`: one of `true`, `false`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: the game keeps the character's body and profile itself, so a replay would apply it again over what changed since.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Medical state, `module_command`.
 */
export type MedicalWrite_Infinitestamina =
  | `infinitestamina:${string}:${string}`;

/**
 * `knockout:<steamid>:<seconds>`
 *
 * - `steamid`
 * - `seconds`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Medical state, `module_command`.
 */
export type MedicalWrite_Knockout =
  | `knockout:${string}:${string}`;

/**
 * `metabolism:<steamid>:<speed>`
 *
 * - `steamid`
 * - `speed`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: the game keeps the character's body and profile itself, so a replay would apply it again over what changed since.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Medical state, `module_command`.
 */
export type MedicalWrite_Metabolism =
  | `metabolism:${string}:${string}`;

/**
 * `radiation:<steamid>:<amount>:<rate>`
 *
 * - `steamid`
 * - `amount`
 * - `rate`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: the game keeps the character's body and profile itself, so a replay would apply it again over what changed since.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Medical state, `module_command`.
 */
export type MedicalWrite_Radiation =
  | `radiation:${string}:${string}`;

/**
 * `remove:<steamid>:<EffectName|#id>:CONFIRM`
 *
 * - `steamid`
 * - `EffectName|#id`: one of `EffectName`, `#id`
 * - `CONFIRM`: the word `CONFIRM`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Medical state, `module_command`.
 */
export type MedicalWrite_Remove =
  | `remove:${string}:${string}`;

/**
 * `set:<steamid>:<selector>:<field>:<value>`
 *
 * - `steamid`
 * - `selector`
 * - `field`
 * - `value`
 * - also `set:<sid>:<effect>:bodyPart:<name>`
 * - also `set:<sid>:Exhaustion:exhaustion:nan`
 * - also `set:<sid>:Exhaustion:state:stabilizing`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: the game keeps the character's body and profile itself, so a replay would apply it again over what changed since.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Medical state, `module_command`.
 */
export type MedicalWrite_Set =
  | `set:${string}:${string}:${string}:${string}`;

/**
 * `severity:<steamid>:<selector>:<value>`
 *
 * - `steamid`
 * - `selector`
 * - `value`
 * - also `severity:<id>:<effect>:inf`
 * - also `severity:<id>:<name>:inf`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: the game keeps the character's body and profile itself, so a replay would apply it again over what changed since.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Medical state, `module_command`.
 */
export type MedicalWrite_Severity =
  | `severity:${string}:${string}:${string}`;

/**
 * `stamina:<steamid>:<amount in ml or SU, or a %>`
 *
 * - `steamid`
 * - `amount in ml or SU, or a %`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: the game keeps the character's body and profile itself, so a replay would apply it again over what changed since.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Medical state, `module_command`.
 */
export type MedicalWrite_Stamina =
  | `stamina:${string}:${string}`;

/**
 * `wellbeing:<steamid>:<stomach ml or %>`
 *
 * - `steamid`
 * - `stomach ml or %`
 *
 * Needs: That player online. Acts on the named player, who must be online. Note: the stomach survives a restart; the exhaustion it sets resets at a boot, as the exhaustion verb does.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Medical state, `module_command`.
 */
export type MedicalWrite_Wellbeing =
  | `wellbeing:${string}:${string}`;

/**
 * - `queue`
 *
 * Server notifications, `module_data`.
 */
export type NotifyRead_Queue =
  | "queue";

/**
 * - `alert`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Server notifications, `module_command`.
 */
export type NotifyWrite_Alert =
  | "alert"
  | `alert:${string}`;

/**
 * - `all`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Server notifications, `module_command`.
 */
export type NotifyWrite_All =
  | "all"
  | `all:${string}`;

/**
 * - `banner`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Server notifications, `module_command`.
 */
export type NotifyWrite_Banner =
  | "banner"
  | `banner:${string}`;

/**
 * - `killfeed`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Server notifications, `module_command`.
 */
export type NotifyWrite_Killfeed =
  | "killfeed"
  | `killfeed:${string}`;

/**
 * - `killfeedall`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Server notifications, `module_command`.
 */
export type NotifyWrite_Killfeedall =
  | "killfeedall"
  | `killfeedall:${string}`;

/**
 * - `encounterBases`
 *
 * Offline raid protection, `module_data`.
 */
export type OfflineRead_EncounterBases =
  | "encounterBases";

/**
 * `flag:<id>`
 *
 * - `id`
 *
 * Offline raid protection, `module_data`.
 */
export type OfflineRead_Flag =
  | `flag:${string}`;

/**
 * - `changes`
 *
 * Offline raid protection, `module_data`.
 */
export type OfflineRead_Changes =
  | "changes";

/**
 * - `mode`
 *
 * Offline raid protection, `module_data`.
 */
export type OfflineRead_Mode =
  | "mode";

/**
 * - `requests`
 *
 * Offline raid protection, `module_data`.
 */
export type OfflineRead_Requests =
  | "requests";

/**
 * - `rules`
 *
 * Offline raid protection, `module_data`.
 */
export type OfflineRead_Rules =
  | "rules";

/**
 * - `state`
 *
 * Offline raid protection, `module_data`.
 */
export type OfflineRead_State =
  | "state";

/**
 * `forget:CONFIRM`
 *
 * - `CONFIRM`: the word `CONFIRM`
 * - the parser accepts a field count no usage spells; send a wrong one to read what it wants
 *
 * Needs: Bridge records only. Changes the bridge's own bookkeeping, not the game.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Offline raid protection, `module_command`.
 */
export type OfflineWrite_Forget =
  | "forget"
  | `forget:${string}`;

/**
 * `recheck`
 *
 * - the parser accepts a field count no usage spells; send a wrong one to read what it wants
 *
 * Needs: Bridge records only. Changes the bridge's own bookkeeping, not the game.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Offline raid protection, `module_command`.
 */
export type OfflineWrite_Recheck =
  | "recheck"
  | `recheck:${string}`;

/**
 * `check:<x>,<y>,<z>`
 *
 * - `x,y,z`: x, y and z, separated by commas
 *
 * Placement check, `module_data`.
 */
export type PlaceRead_Check =
  | `check:${string}`;

/**
 * `where:<x>,<y>,<z>`
 *
 * - `x,y,z`: x, y and z, separated by commas
 *
 * Placement check, `module_data`.
 */
export type PlaceRead_Where =
  | `where:${string}`;

/**
 * - `world`
 *
 * Placement check, `module_data`.
 */
export type PlaceRead_World =
  | "world";

/**
 * - `cooking`
 *
 * Fire, power and cooking, `module_data`.
 */
export type PowerRead_Cooking =
  | "cooking";

/**
 * - `heat`
 *
 * Fire, power and cooking, `module_data`.
 */
export type PowerRead_Heat =
  | "heat";

/**
 * - `power`
 *
 * Fire, power and cooking, `module_data`.
 */
export type PowerRead_Power =
  | "power";

/**
 * `devicecharge:<x>,<y>,<z>:<ratio>`
 *
 * - `x,y,z`: x, y and z, separated by commas
 * - `ratio`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: the game keeps this state itself when a player does it, so the answer is the game's own route rather than a replay.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Fire, power and cooking, `module_command`.
 */
export type PowerWrite_Devicecharge =
  | `devicecharge:${string}`;

/**
 * `generatorfuel:<x>,<y>,<z>:<amount>`
 *
 * - `x,y,z`: x, y and z, separated by commas
 * - `amount`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player. Note: add :via:<steamId> to pour the canister that player holds through the game's own interaction: AddFuel or Refuel on the generator, or the canister's own fill when the generator refuses it (:via:any is refused, since it spends one named player's canister); without via the field write runs.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: the game keeps this state itself when a player does it, so the answer is the game's own route rather than a replay.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Fire, power and cooking, `module_command`.
 */
export type PowerWrite_Generatorfuel =
  | `generatorfuel:${string}`;

/**
 * `generatoroff:<x>,<y>,<z>`
 *
 * - `x,y,z`: x, y and z, separated by commas
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Fire, power and cooking, `module_command`.
 */
export type PowerWrite_Generatoroff =
  | `generatoroff:${string}`;

/**
 * `generatoron:<x,y,z>:junk`
 *
 * - `x,y,z`
 * - `junk`: the word `junk`
 * - also `generatoron:<x>,<y>,<z>`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Fire, power and cooking, `module_command`.
 */
export type PowerWrite_Generatoron =
  | `generatoron:${string}`;

/**
 * `lightintensity:<x>,<y>,<z>:<value>`
 *
 * - `x,y,z`: x, y and z, separated by commas
 * - `value`
 * - also `lightintensity:<x>,<y>,<z>`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player. Note: with :via:<steamId> or :via:any it runs as the game's own interaction through an online player; the chandelier tested (Chandelier_WFP_C) offered no brightness steps, on or off, so it answered not_offered there.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: the game keeps this state itself when a player does it, so the answer is the game's own route rather than a replay.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Fire, power and cooking, `module_command`.
 */
export type PowerWrite_Lightintensity =
  | `lightintensity:${string}`;

/**
 * `lightoff:<x>,<y>,<z>`
 *
 * - `x,y,z`: x, y and z, separated by commas
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player. Note: with :via:<steamId> or :via:any it runs as the game's own interaction through an online player; run that way with the player near a powered lamp it switched, and on an unpowered lamp the game takes the switch, nothing happens and the reply is not_confirmed.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: a lamp's switch is saved for nobody, a player's change included.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Fire, power and cooking, `module_command`.
 */
export type PowerWrite_Lightoff =
  | `lightoff:${string}`;

/**
 * `lighton:<x>,<y>,<z>`
 *
 * - `x,y,z`: x, y and z, separated by commas
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player. Note: with :via:<steamId> or :via:any it runs as the game's own interaction through an online player; run that way with the player near a powered lamp it switched, and on an unpowered lamp the game takes the switch, nothing happens and the reply is not_confirmed.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: a lamp's switch is saved for nobody, a player's change included.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Fire, power and cooking, `module_command`.
 */
export type PowerWrite_Lighton =
  | `lighton:${string}`;

/**
 * - `calls`
 *
 * Raid protection control, `module_data`.
 */
export type ProtectRead_Calls =
  | "calls";

/**
 * `flag:<id>`
 *
 * - `id`
 *
 * Raid protection control, `module_data`.
 */
export type ProtectRead_Flag =
  | `flag:${string}`;

/**
 * - `changes`
 *
 * Raid protection control, `module_data`.
 */
export type ProtectRead_Changes =
  | "changes";

/**
 * - `layout`
 *
 * Raid protection control, `module_data`.
 */
export type ProtectRead_Layout =
  | "layout";

/**
 * - `manager`
 *
 * Raid protection control, `module_data`.
 */
export type ProtectRead_Manager =
  | "manager";

/**
 * `offline:<id>`
 *
 * - `id`
 *
 * Raid protection control, `module_data`.
 */
export type ProtectRead_Offline =
  | `offline:${string}`;

/**
 * - `protections`
 *
 * Raid protection control, `module_data`.
 */
export type ProtectRead_Protections =
  | "protections";

/**
 * `grant:<flagId>:<delay s>:<duration s|forever>`
 *
 * - `flagId`: Flag id
 * - `delay s`
 * - `duration s|forever`: one of `duration s`, `forever`
 * - the parser accepts a field count no usage spells; send a wrong one to read what it wants
 *
 * Needs: No player needed. Works with nobody online. Note: offline raid protection only.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Raid protection control, `module_command`.
 */
export type ProtectWrite_Grant =
  | `grant:${string}`
  | `grant:${string}:${string}:${string}`;

/**
 * `postpone:<flagId>:<seconds from now>`
 *
 * - `flagId`: Flag id
 * - `seconds from now`
 * - the parser accepts a field count no usage spells; send a wrong one to read what it wants
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Raid protection control, `module_command`.
 */
export type ProtectWrite_Postpone =
  | `postpone:${string}`
  | `postpone:${string}:${string}`
  | `postpone:${string}:${string}:${string}`;

/**
 * `reset:<flagId>`
 *
 * - `flagId`: Flag id
 * - the parser accepts a field count no usage spells; send a wrong one to read what it wants
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Raid protection control, `module_command`.
 */
export type ProtectWrite_Reset =
  | `reset:${string}`
  | `reset:${string}:${string}:${string}`;

/**
 * `set:<flagId>:<delay>:<duration, or the word forever>`
 *
 * - `flagId`: Flag id
 * - `delay`
 * - `duration, or the word forever`
 * - also `set:<flag>`
 * - the parser accepts a field count no usage spells; send a wrong one to read what it wants
 *
 * Needs: No player needed. Works with nobody online. Note: under flag-specific raid protection it needs a player online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Raid protection control, `module_command`.
 */
export type ProtectWrite_Set =
  | `set:${string}`
  | `set:${string}:${string}:${string}`;

/**
 * `snapshot`
 *
 * - the parser accepts a field count no usage spells; send a wrong one to read what it wants
 *
 * Needs: Bridge records only. Changes the bridge's own bookkeeping, not the game.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Raid protection control, `module_command`.
 */
export type ProtectWrite_Snapshot =
  | "snapshot"
  | `snapshot:${string}`
  | `snapshot:${string}:${string}:${string}`;

/**
 * - `activity`
 *
 * Quests, `module_data`.
 */
export type QuestsRead_Activity =
  | "activity";

/**
 * - `areas`
 *
 * Quests, `module_data`.
 */
export type QuestsRead_Areas =
  | "areas";

/**
 * - `catalogue`
 *
 * Quests, `module_data`.
 */
export type QuestsRead_Catalogue =
  | "catalogue";

/**
 * - `givers`
 *
 * Quests, `module_data`.
 */
export type QuestsRead_Givers =
  | "givers";

/**
 * - `outposts`
 *
 * Quests, `module_data`.
 */
export type QuestsRead_Outposts =
  | "outposts";

/**
 * `player:<steamid>`
 *
 * - `steamid`
 *
 * Quests, `module_data`.
 */
export type QuestsRead_Player =
  | `player:${string}`;

/**
 * `quest:<netIndex>`
 *
 * - `netIndex`
 *
 * Quests, `module_data`.
 */
export type QuestsRead_Quest =
  | `quest:${string}`;

/**
 * - `quests`
 *
 * Quests, `module_data`.
 */
export type QuestsRead_Quests =
  | "quests";

/**
 * - `timed`
 *
 * Quests, `module_data`.
 */
export type QuestsRead_Timed =
  | "timed";

/**
 * - `abandon`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: the game keeps quest progress itself.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Quests, `module_command`.
 */
export type QuestsWrite_Abandon =
  | "abandon"
  | `abandon:${string}`;

/**
 * - `abandontask`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: the game keeps quest progress itself.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Quests, `module_command`.
 */
export type QuestsWrite_Abandontask =
  | "abandontask"
  | `abandontask:${string}`;

/**
 * `cycle:<subcommand>`
 *
 * - `subcommand`
 * - also `cycle:<s>:CONFIRM`
 * - the parser accepts a field count no usage spells; send a wrong one to read what it wants
 *
 * Needs: Any player online (admin command). Runs one of the game's admin commands, which the game only runs through an online player.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Quests, `module_command`.
 */
export type QuestsWrite_Cycle =
  | `cycle:${string}`
  | `cycle:${string}:${string}`;

/**
 * - `track`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Quests, `module_command`.
 */
export type QuestsWrite_Track =
  | "track"
  | `track:${string}`;

/**
 * - `all`
 *
 * Raid detection, `module_data`.
 */
export type RaidRead_All =
  | "all";

/**
 * - `announcements`
 *
 * Raid detection, `module_data`.
 */
export type RaidRead_Announcements =
  | "announcements";

/**
 * `base:<id>`
 *
 * - `id`
 *
 * Raid detection, `module_data`.
 */
export type RaidRead_Base =
  | `base:${string}`;

/**
 * - `bases`
 *
 * Raid detection, `module_data`.
 */
export type RaidRead_Bases =
  | "bases";

/**
 * - `encounters`
 *
 * Raid detection, `module_data`.
 */
export type RaidRead_Encounters =
  | "encounters";

/**
 * - `raids`
 *
 * Raid detection, `module_data`.
 */
export type RaidRead_Raids =
  | "raids";

/**
 * - `reasons`
 *
 * Raid detection, `module_data`.
 */
export type RaidRead_Reasons =
  | "reasons";

/**
 * `announce:ending:<minutes>`
 *
 * - `ending`: the word `ending`
 * - `minutes`
 * - the parser accepts a field count no usage spells; send a wrong one to read what it wants
 *
 * Needs: Needs a condition. Works with nobody online, but only once the condition its note names holds. Note: raid protection must be set to Global.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Raid detection, `module_command`.
 */
export type RaidWrite_Announce =
  | `announce:${string}`
  | `announce:${string}:${string}`;

/**
 * `end:<baseId>`
 *
 * - `baseId`
 *
 * Needs: Bridge records only. Changes the bridge's own bookkeeping, not the game.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Raid detection, `module_command`.
 */
export type RaidWrite_End =
  | `end:${string}`;

/**
 * `forget:<baseId>:CONFIRM`
 *
 * - `baseId`
 * - `CONFIRM`: the word `CONFIRM`
 *
 * Needs: Bridge records only. Changes the bridge's own bookkeeping, not the game.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Raid detection, `module_command`.
 */
export type RaidWrite_Forget =
  | `forget:${string}:${string}`;

/**
 * `start:<baseId>[:<x>:<y>:<z>]`
 *
 * - `baseId`
 * - `x` (optional)
 * - `y` (optional)
 * - `z` (optional)
 *
 * Needs: Bridge records only. Changes the bridge's own bookkeeping, not the game.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Raid detection, `module_command`.
 */
export type RaidWrite_Start =
  | `start:${string}`
  | `start:${string}:${string}:${string}:${string}`;

/**
 * `resolve:<address>`
 *
 * - `address`
 *
 * Vehicle condition, `module_data`.
 */
export type RepairRead_Resolve =
  | `resolve:${string}`;

/**
 * `<target>:access:<level>`
 *
 * - `target`
 * - `level`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Vehicle condition, `module_command`.
 */
export type RepairWrite_Access =
  | `${string}:access`
  | `${string}:access:${string}`;

/**
 * `<target>:battery:<amount|percent%>`
 *
 * - `target`
 * - `amount|percent%`: one of `amount`, `percent%`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Vehicle condition, `module_command`.
 */
export type RepairWrite_Battery =
  | `${string}:battery`
  | `${string}:battery:${string}`;

/**
 * `<target>:colors:<uint32>[:<part>]`
 *
 * - `target`
 * - `uint32`
 * - `part` (optional)
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Vehicle condition, `module_command`.
 */
export type RepairWrite_Colors =
  | `${string}:colors`
  | `${string}:colors:${string}`;

/**
 * `<target>:damage:<amount>:<part>`
 *
 * - `target`
 * - `amount`
 * - `part`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Vehicle condition, `module_command`.
 */
export type RepairWrite_Damage =
  | `${string}:damage`
  | `${string}:damage:${string}`;

/**
 * `<target>:destroy:CONFIRM`
 *
 * - `target`
 * - `CONFIRM`: the word `CONFIRM`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Vehicle condition, `module_command`.
 */
export type RepairWrite_Destroy =
  | `${string}:destroy`
  | `${string}:destroy:${string}`;

/**
 * `<target>:fuel:<litres|percent%>`
 *
 * - `target`
 * - `litres|percent%`: one of `litres`, `percent%`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Vehicle condition, `module_command`.
 */
export type RepairWrite_Fuel =
  | `${string}:fuel`
  | `${string}:fuel:${string}`;

/**
 * `<target>:mileage:<km>[:<part>]`
 *
 * - `target`
 * - `km`
 * - `part` (optional)
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Vehicle condition, `module_command`.
 */
export type RepairWrite_Mileage =
  | `${string}:mileage`
  | `${string}:mileage:${string}`;

/**
 * `<target>:owner:<profileId>`
 *
 * - `target`
 * - `profileId`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Vehicle condition, `module_command`.
 */
export type RepairWrite_Owner =
  | `${string}:owner`
  | `${string}:owner:${string}`;

/**
 * `<target>:pattern:<index>[:<part>]`
 *
 * - `target`
 * - `index`
 * - `part` (optional)
 * - also `<target>:pattern`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Vehicle condition, `module_command`.
 */
export type RepairWrite_Pattern =
  | `${string}:pattern`
  | `${string}:pattern:${string}`;

/**
 * `<target>:rename:<Name>`
 *
 * - `target`
 * - `Name`
 *
 * Needs: Any player online (admin command). Runs one of the game's admin commands, which the game only runs through an online player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Vehicle condition, `module_command`.
 */
export type RepairWrite_Rename =
  | `${string}:rename`
  | `${string}:rename:${string}`;

/**
 * `<target>:repair[:<percent>[:<part>]]`
 *
 * - `target`
 * - `percent` (optional)
 * - `part` (optional)
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Vehicle condition, `module_command`.
 */
export type RepairWrite_Repair =
  | `${string}:repair`
  | `${string}:repair:${string}`;

/**
 * `<target>:tyre:<inflate|deflate>:<wheel>`
 *
 * - `target`
 * - `inflate|deflate`: one of `inflate`, `deflate`
 * - `wheel`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Vehicle condition, `module_command`.
 */
export type RepairWrite_Tyre =
  | `${string}:tyre`
  | `${string}:tyre:${string}`;

/**
 * - `status`
 *
 * Server browser report, `module_data`.
 */
export type ReportRead_Status =
  | "status";

/**
 * - `resources`
 *
 * Fuel & resource stations, `module_data`.
 */
export type ResourcesRead_Resources =
  | "resources";

/**
 * `stations:<resource>`
 *
 * - `resource`
 *
 * Fuel & resource stations, `module_data`.
 */
export type ResourcesRead_Stations =
  | "stations"
  | `stations:${string}`;

/**
 * - `near`
 *
 * Needs: Any player online (admin command). Runs one of the game's admin commands, which the game only runs through an online player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Fuel & resource stations, `module_command`.
 */
export type ResourcesWrite_Near =
  | "near"
  | `near:${string}`;

/**
 * `timers:<steamId>`
 *
 * - `steamId`
 *
 * Respawn timers, `module_data`.
 */
export type RespawnRead_Timers =
  | `timers:${string}`;

/**
 * `clear:<steamId>`
 *
 * - `steamId`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Respawn timers, `module_command`.
 */
export type RespawnWrite_Clear =
  | `clear:${string}`;

/**
 * `set:<steamId>:<option|all>:<seconds>`
 *
 * - `steamId`
 * - `option|all`: one of `option`, `all`
 * - `seconds`: Seconds
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: a countdown, so a replay would start it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Respawn timers, `module_command`.
 */
export type RespawnWrite_Set =
  | `set:${string}:${string}:${string}`;

/**
 * - `categories`
 *
 * Live server settings, `module_data`.
 */
export type SettingsRead_Categories =
  | "categories";

/**
 * `get:<type>:<name>`
 *
 * - `type`
 * - `name`
 *
 * Live server settings, `module_data`.
 */
export type SettingsRead_Get =
  | `get:${string}`;

/**
 * - `changes`
 *
 * Live server settings, `module_data`.
 */
export type SettingsRead_Changes =
  | "changes";

/**
 * `list:<text>`
 *
 * - `text`
 *
 * Live server settings, `module_data`.
 */
export type SettingsRead_List =
  | "list"
  | `list:${string}`;

/**
 * - `outstanding`
 *
 * Live server settings, `module_data`.
 */
export type SettingsRead_Outstanding =
  | "outstanding";

/**
 * `probe:<name>`
 *
 * - `name`
 *
 * Live server settings, `module_data`.
 */
export type SettingsRead_Probe =
  | `probe:${string}`;

/**
 * `section:<Name>`
 *
 * - `Name`
 *
 * Live server settings, `module_data`.
 */
export type SettingsRead_Section =
  | `section:${string}`;

/**
 * `values:<text>`
 *
 * - `text`
 *
 * Live server settings, `module_data`.
 */
export type SettingsRead_Values =
  | `values:${string}`;

/**
 * `valuesfrom:<n>:<text>`
 *
 * - `n`
 * - `text`
 *
 * Live server settings, `module_data`.
 */
export type SettingsRead_Valuesfrom =
  | `valuesfrom:${string}`;

/**
 * `check:<classPath>`
 *
 * - `classPath`
 *
 * Precise spawning, `module_data`.
 */
export type SpawnRead_Check =
  | `check:${string}`;

/**
 * - `kinds`
 *
 * Precise spawning, `module_data`.
 */
export type SpawnRead_Kinds =
  | "kinds";

/**
 * `loadcheck:<classPath>`
 *
 * - `classPath`
 *
 * Precise spawning, `module_data`.
 */
export type SpawnRead_Loadcheck =
  | `loadcheck:${string}`;

/**
 * - `persistence`
 *
 * Precise spawning, `module_data`.
 */
export type SpawnRead_Persistence =
  | "persistence";

/**
 * `persistent:<kind>:<x>,<y>,<z>:<count>:<type>`
 *
 * - `kind`
 * - `x,y,z`: x, y and z, separated by commas
 * - `count`
 * - `type`
 *
 * Needs: Any player online (admin command). Runs one of the game's admin commands, which the game only runs through an online player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: The game's own route. Made through the game's own command or logic, so the game keeps it exactly as it keeps one it made itself. Whether that kind gets a save row was not measured here. Note: a vehicle gets an entity id and a save row; the game gives a creature neither, even from its own command.
 *
 * Precise spawning, `module_data`.
 */
export type SpawnRead_Persistent =
  | `persistent:${string}`;

/**
 * `spawn:<kind>:<x>,<y>,<z>:<yaw>,<pitch>,<roll>:<classPath>`
 *
 * - `kind`
 * - `x,y,z`: x, y and z, separated by commas
 * - `yaw,pitch,roll`: yaw, pitch and roll, separated by commas
 * - `classPath`
 *
 * Needs: Needs a condition. Works with nobody online, but only once the condition its note names holds. Note: the class must already be in memory.
 * After a restart: Lost. Measured to revert, or never saved.
 * Creates: Not registered. No route in the game registers it: it has no entity id and no save row, and the reply says so. Note: the engine builds it without the game's registration; a vehicle also leaves an unowned inventory row in the save.
 *
 * Precise spawning, `module_data`.
 */
export type SpawnRead_Spawn =
  | `spawn:${string}`;

/**
 * `load:<classPath>:FORCE_SYNC_LOAD`
 *
 * - `classPath`
 * - `FORCE_SYNC_LOAD`: the word `FORCE_SYNC_LOAD`
 * - also `load:<classPath>`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Precise spawning, `module_command`.
 */
export type SpawnWrite_Load =
  | `load:${string}`;

/**
 * - `list`
 *
 * Spawn points, `module_data`.
 */
export type SpawnpointsRead_List =
  | "list";

/**
 * - `map`
 *
 * Spawn points, `module_data`.
 */
export type SpawnpointsRead_Map =
  | "map";

/**
 * - `respawn`
 *
 * Spawn points, `module_data`.
 */
export type SpawnpointsRead_Respawn =
  | "respawn";

/**
 * `disable:<index>:CONFIRM`
 *
 * - `index`
 * - `CONFIRM`: the word `CONFIRM`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Spawn points, `module_command`.
 */
export type SpawnpointsWrite_Disable =
  | `disable:${string}:${string}`;

/**
 * `enable:<index>:CONFIRM`
 *
 * - `index`
 * - `CONFIRM`: the word `CONFIRM`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Spawn points, `module_command`.
 */
export type SpawnpointsWrite_Enable =
  | `enable:${string}:${string}`;

/**
 * - `board`
 *
 * Live squads, `module_data`.
 */
export type SquadsRead_Board =
  | "board";

/**
 * - `destroyed`
 *
 * Live squads, `module_data`.
 */
export type SquadsRead_Destroyed =
  | "destroyed";

/**
 * `member:<profileId>`
 *
 * - `profileId`: Squad member
 *
 * Live squads, `module_data`.
 */
export type SquadsRead_Member =
  | `member:${string}`;

/**
 * `names:<squadId>`
 *
 * - `squadId`: Squad id
 *
 * Live squads, `module_data`.
 */
export type SquadsRead_Names =
  | `names:${string}`;

/**
 * `squad:<id>`
 *
 * - `id`
 *
 * Live squads, `module_data`.
 */
export type SquadsRead_Squad =
  | `squad:${string}`;

/**
 * - `squads`
 *
 * Live squads, `module_data`.
 */
export type SquadsRead_Squads =
  | "squads";

/**
 * - `add`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: the game keeps squads itself.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live squads, `module_command`.
 */
export type SquadsWrite_Add =
  | "add"
  | `add:${string}`;

/**
 * - `board`
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live squads, `module_command`.
 */
export type SquadsWrite_Board =
  | "board"
  | `board:${string}`;

/**
 * - `disband`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live squads, `module_command`.
 */
export type SquadsWrite_Disband =
  | "disband"
  | `disband:${string}`;

/**
 * - `info`
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live squads, `module_command`.
 */
export type SquadsWrite_Info =
  | "info"
  | `info:${string}`;

/**
 * - `message`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live squads, `module_command`.
 */
export type SquadsWrite_Message =
  | "message"
  | `message:${string}`;

/**
 * - `names`
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live squads, `module_command`.
 */
export type SquadsWrite_Names =
  | "names"
  | `names:${string}`;

/**
 * - `remove`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live squads, `module_command`.
 */
export type SquadsWrite_Remove =
  | "remove"
  | `remove:${string}`;

/**
 * - `removeall`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live squads, `module_command`.
 */
export type SquadsWrite_Removeall =
  | "removeall"
  | `removeall:${string}`;

/**
 * - `rename`
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server. Note: a member of that squad must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live squads, `module_command`.
 */
export type SquadsWrite_Rename =
  | "rename"
  | `rename:${string}`;

/**
 * `check:eid:<id>`
 *
 * - `eid`: the word `eid`
 * - `id`
 *
 * Placed containers and items, `module_data`.
 */
export type StashRead_Check =
  | `check:${string}`;

/**
 * `job:<tag>`
 *
 * - `tag`
 *
 * Placed containers and items, `module_data`.
 */
export type StashRead_Job =
  | `job:${string}`;

/**
 * - `jobs`
 *
 * Placed containers and items, `module_data`.
 */
export type StashRead_Jobs =
  | "jobs";

/**
 * - `detonate`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Placed containers and items, `module_command`.
 */
export type StashWrite_Detonate =
  | "detonate"
  | `detonate:${string}`;

/**
 * `fill:<tag>:eid:<id>:<Code>*<n>,…`
 *
 * - `tag`
 * - `eid`: the word `eid`
 * - `id`
 * - `Code*n,…`
 * - also `fill:<tag>:player:<steamId>:<Code>*<n>,…`
 * - also `fill:<tag>:eid:<id>:<list>[:via:<steamId>]`
 * - also `fill:<tag>:veh:<id>:<list>[:via:<steamId>]`
 * - also `fill:<tag>:player:<steamId>:<Code>*<n>[,…]`
 *
 * Needs: Any player online (admin command). Runs one of the game's admin commands, which the game only runs through an online player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: The game's own route. Made through the game's own command or logic, so the game keeps it exactly as it keeps one it made itself. Whether that kind gets a save row was not measured here. Note: the game's own inventory command makes each item.
 *
 * Placed containers and items, `module_command`.
 */
export type StashWrite_Fill =
  | `fill:${string}:${string}:${string}:${string}`;

/**
 * `place:<tag>:<x>,<y>,<z>:<ItemCode>[:<Code>*<n>,…]`
 *
 * - `tag`
 * - `x,y,z`: x, y and z, separated by commas
 * - `ItemCode`
 * - `Code*n,…` (optional)
 *
 * Needs: Any player online (admin command). Runs one of the game's admin commands, which the game only runs through an online player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Registered. Made through the game's own route and kept in the game's own records, an entity id and a save row for an item, so the game brings it back after a restart.
 *
 * Placed containers and items, `module_command`.
 */
export type StashWrite_Place =
  | `place:${string}:${string}:${string}`;

/**
 * `attributes:<steamid>:<strength>:<constitution>:<dexterity>:<intelligence>`
 *
 * - `steamid`
 * - `strength`
 * - `constitution`
 * - `dexterity`
 * - `intelligence`
 * - also `attributes:<steamid>`
 *
 * Survival stats, `module_data`.
 */
export type StatsRead_Attributes =
  | "attributes"
  | `attributes:${string}`;

/**
 * - `fame`
 *
 * Survival stats, `module_data`.
 */
export type StatsRead_Fame =
  | "fame";

/**
 * `kills:steam:<steamid>`
 *
 * - `steam`: the word `steam`
 * - `steamid`
 * - also `kills:<profileId>`
 *
 * Survival stats, `module_data`.
 */
export type StatsRead_Kills =
  | "kills"
  | `kills:${string}`;

/**
 * - `lastskill`
 *
 * Survival stats, `module_data`.
 */
export type StatsRead_Lastskill =
  | "lastskill";

/**
 * - `ranking`
 *
 * Survival stats, `module_data`.
 */
export type StatsRead_Ranking =
  | "ranking";

/**
 * - `rankwords`
 *
 * Survival stats, `module_data`.
 */
export type StatsRead_Rankwords =
  | "rankwords";

/**
 * `skillinfo:<steamid>`
 *
 * - `steamid`
 *
 * Survival stats, `module_data`.
 */
export type StatsRead_Skillinfo =
  | `skillinfo:${string}`;

/**
 * `skills:<steamid>`
 *
 * - `steamid`
 *
 * Survival stats, `module_data`.
 */
export type StatsRead_Skills =
  | `skills:${string}`;

/**
 * `stats:steam:<steamid>`
 *
 * - `steam`: the word `steam`
 * - `steamid`
 * - also `stats:<profileId>`
 * - also `stats:<pid>`
 *
 * Survival stats, `module_data`.
 */
export type StatsRead_Stats =
  | "stats"
  | `stats:${string}`
  | `stats:steam:${string}`;

/**
 * `attributes:<steamid>:<strength>:<constitution>:<dexterity>:<intelligence>`
 *
 * - `steamid`
 * - `strength`
 * - `constitution`
 * - `dexterity`
 * - `intelligence`
 * - also `attributes:<steamid>`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Survival stats, `module_command`.
 */
export type StatsWrite_Attributes =
  | "attributes"
  | `attributes:${string}`;

/**
 * - `clear`
 * - `clear:CONFIRM`
 *
 * Needs: Bridge records only. Changes the bridge's own bookkeeping, not the game.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Survival stats, `module_command`.
 */
export type StatsWrite_Clear =
  | "clear"
  | "clear:CONFIRM";

/**
 * `forgive:<profileId>`
 *
 * - `profileId`
 *
 * Needs: Needs a condition. Works with nobody online, but only once the condition its note names holds. Note: the profile must be a victim in the game's kill registry, which only a kill fills.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Survival stats, `module_command`.
 */
export type StatsWrite_Forgive =
  | "forgive"
  | `forgive:${string}`;

/**
 * `rank:<count>:<sortBy>:asc|desc`
 *
 * - `count`
 * - `sortBy`
 * - `asc|desc`: one of `asc`, `desc`
 * - also `rank[:<count>][:<sortBy>][:<order>]`
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Survival stats, `module_command`.
 */
export type StatsWrite_Rank =
  | "rank"
  | `rank:${string}`;

/**
 * `refresh:<profileId>`
 *
 * - `profileId`
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Survival stats, `module_command`.
 */
export type StatsWrite_Refresh =
  | "refresh"
  | `refresh:${string}`;

/**
 * `skill:<steamid>:<skill>:add|set:<points>`
 *
 * - `steamid`
 * - `skill`
 * - `add|set`: one of `add`, `set`
 * - `points`
 * - also `skill:<id>:boxing:add:nan`
 * - also `skill:<steamid>:<skill>:add:<points>`
 * - also `skill:<steamid>:<skill>:set:<points>`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Survival stats, `module_command`.
 */
export type StatsWrite_Skill =
  | `skill:${string}`;

/**
 * `skilllevel:<steamid>:<skill>:<level>:<experience>`
 *
 * - `steamid`
 * - `skill`
 * - `level`
 * - `experience`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Survival stats, `module_command`.
 */
export type StatsWrite_Skilllevel =
  | `skilllevel:${string}`;

/**
 * `contents:eid:<entityId>`
 *
 * - `eid`: the word `eid`
 * - `entityId`
 * - also `contents:<containerId>`
 * - also `contents:<id>`
 *
 * Live storage, `module_data`.
 */
export type StorageRead_Contents =
  | `contents:${string}`;

/**
 * `dropcheck:<container>,<item>`
 *
 * - `container,item`: container and item, separated by commas
 *
 * Live storage, `module_data`.
 */
export type StorageRead_Dropcheck =
  | `dropcheck:${string}`;

/**
 * - `lastdestroy`
 *
 * Live storage, `module_data`.
 */
export type StorageRead_Lastdestroy =
  | "lastdestroy";

/**
 * - `lockboxes`
 *
 * Live storage, `module_data`.
 */
export type StorageRead_Lockboxes =
  | "lockboxes";

/**
 * - `storage`
 *
 * Live storage, `module_data`.
 */
export type StorageRead_Storage =
  | "storage";

/**
 * `destroy:<containerId>,<itemId>[,<steamid>]`
 *
 * - `containerId,itemId,steamid`: containerId, itemId and steamid, separated by commas
 * - also `destroy:CONFIRM:eid:<entityLo>`
 * - also `destroy:CONFIRM:eid:<this>`
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live storage, `module_command`.
 */
export type StorageWrite_Destroy =
  | `destroy:${string}`;

/**
 * `drop:<container>,<item>[,<steamid>]`
 *
 * - `container,item,steamid`: container, item and steamid, separated by commas
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live storage, `module_command`.
 */
export type StorageWrite_Drop =
  | `drop:${string}`;

/**
 * `move:<containerId>,<itemId>,<targetContainerId>[,<steamid>]`
 *
 * - `containerId,itemId,targetContainerId,steamid`: containerId, itemId, targetContainerId and steamid, separated by commas
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live storage, `module_command`.
 */
export type StorageWrite_Move =
  | `move:${string}`;

/**
 * `observe:<containerId>,<steamid>`
 *
 * - `containerId,steamid`: containerId and steamid, separated by commas
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live storage, `module_command`.
 */
export type StorageWrite_Observe =
  | `observe:${string}`;

/**
 * `take:<containerId>,<itemId>,<steamid>`
 *
 * - `containerId,itemId,steamid`: containerId, itemId and steamid, separated by commas
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live storage, `module_command`.
 */
export type StorageWrite_Take =
  | `take:${string}`;

/**
 * - `corpses`
 *
 * Teleport, `module_data`.
 */
export type TeleportRead_Corpses =
  | "corpses";

/**
 * - `inflight`
 *
 * Teleport, `module_data`.
 */
export type TeleportRead_Inflight =
  | "inflight";

/**
 * `origin:<steamid>`
 *
 * - `steamid`
 *
 * Teleport, `module_data`.
 */
export type TeleportRead_Origin =
  | `origin:${string}`;

/**
 * - `origins`
 *
 * Teleport, `module_data`.
 */
export type TeleportRead_Origins =
  | "origins";

/**
 * `back:<steamid>`
 *
 * - `steamid`
 * - the parser accepts a field count no usage spells; send a wrong one to read what it wants
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Teleport, `module_command`.
 */
export type TeleportWrite_Back =
  | `back:${string}`
  | `back:${string}:${string}`;

/**
 * `corpse:<displayName>:<x>:<y>:<z>:<yaw>[:<dropCm>][:force]`
 *
 * - `displayName`
 * - `x`
 * - `y`
 * - `z`
 * - `yaw`: Facing (degrees)
 * - `dropCm` (optional)
 * - `force`: the word `force` (optional)
 * - also `corpse:<name>:<x>:<y>:<z>:<yaw>[:<dropCm>]`
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Teleport, `module_command`.
 */
export type TeleportWrite_Corpse =
  | `corpse:${string}:${string}:${string}:${string}:${string}`
  | `corpse:${string}:${string}:${string}:${string}:${string}:${string}`
  | `corpse:${string}:${string}:${string}:${string}:${string}:${string}:${string}`;

/**
 * `face:<kind>:<idLow>:<idHigh>:<pitch>:<yaw>:<roll>`
 *
 * - `kind`
 * - `idLow`
 * - `idHigh`
 * - `pitch`
 * - `yaw`: Facing (degrees)
 * - `roll`
 * - also `face:player:<steamid>:<yaw>`
 * - also `face:item:<entityIdLow>:<entityIdHigh>:<pitch>:<yaw>:<roll>`
 * - also `face:vehicle:<entityIdLow>:<entityIdHigh>:<pitch>:<yaw>:<roll>`
 * - also `face:vehicle:<idLo>:<idHi>:<pitch>:<yaw>:<roll>`
 * - the parser accepts a field count no usage spells; send a wrong one to read what it wants
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Teleport, `module_command`.
 */
export type TeleportWrite_Face =
  | `face:${string}:${string}:${string}`
  | `face:${string}:${string}:${string}:${string}`
  | `face:${string}:${string}:${string}:${string}:${string}:${string}`
  | `face:${string}:${string}:${string}:${string}:${string}:${string}:${string}`;

/**
 * `item:<entityIdLow>:<entityIdHigh>:<x>:<y>:<z>:<yaw>[:<dropCm>][:force]`
 *
 * - `entityIdLow`
 * - `entityIdHigh`
 * - `x`
 * - `y`
 * - `z`
 * - `yaw`: Facing (degrees)
 * - `dropCm` (optional)
 * - `force`: the word `force` (optional)
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Teleport, `module_command`.
 */
export type TeleportWrite_Item =
  | `item:${string}:${string}:${string}:${string}:${string}:${string}`
  | `item:${string}:${string}:${string}:${string}:${string}:${string}:${string}`
  | `item:${string}:${string}:${string}:${string}:${string}:${string}:${string}:${string}`;

/**
 * `player:<steamid>:<x>:<y>:<z>:<yaw>[:<dropCm>]`
 *
 * - `steamid`
 * - `x`
 * - `y`
 * - `z`
 * - `yaw`: Facing (degrees)
 * - `dropCm` (optional)
 * - also `player:<sid>:<x>:<y>:<z>:<yaw>`
 * - the parser accepts a field count no usage spells; send a wrong one to read what it wants
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Teleport, `module_command`.
 */
export type TeleportWrite_Player =
  | `player:${string}:${string}:${string}:${string}:${string}`
  | `player:${string}:${string}:${string}:${string}:${string}:${string}`
  | `player:${string}:${string}:${string}:${string}:${string}:${string}:${string}`;

/**
 * `squad:<squadid>:<x>:<y>:<z>:<yaw>[:<dropCm>]`
 *
 * - `squadid`
 * - `x`
 * - `y`
 * - `z`
 * - `yaw`: Facing (degrees)
 * - `dropCm` (optional)
 * - the parser accepts a field count no usage spells; send a wrong one to read what it wants
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Teleport, `module_command`.
 */
export type TeleportWrite_Squad =
  | `squad:${string}:${string}:${string}:${string}:${string}`
  | `squad:${string}:${string}:${string}:${string}:${string}:${string}`
  | `squad:${string}:${string}:${string}:${string}:${string}:${string}:${string}`;

/**
 * `swap:<a>:<b>`
 *
 * - `a`
 * - `b`
 * - also `swap:<steamidA>:<steamidB>[:<dropCm>]`
 * - the parser accepts a field count no usage spells; send a wrong one to read what it wants
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a move; the game keeps where a player or squad stands.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Teleport, `module_command`.
 */
export type TeleportWrite_Swap =
  | `swap:${string}:${string}`
  | `swap:${string}:${string}:${string}`
  | `swap:${string}:${string}:${string}:${string}`;

/**
 * `toplayer:<mover>:<target>`
 *
 * - `mover`
 * - `target`
 * - also `toplayer:<mover>:<target>[:<dropCm>]`
 * - also `toplayer:<steamid>:<targetSteamid>[:<dropCm>]`
 * - the parser accepts a field count no usage spells; send a wrong one to read what it wants
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a move; the game keeps where a player or squad stands.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Teleport, `module_command`.
 */
export type TeleportWrite_Toplayer =
  | `toplayer:${string}:${string}`
  | `toplayer:${string}:${string}:${string}`
  | `toplayer:${string}:${string}:${string}:${string}`;

/**
 * `vehicle:<entityIdLow>:<entityIdHigh>:<x>:<y>:<z>:<yaw>[:<dropCm>][:force]`
 *
 * - `entityIdLow`
 * - `entityIdHigh`
 * - `x`
 * - `y`
 * - `z`
 * - `yaw`: Facing (degrees)
 * - `dropCm` (optional)
 * - `force`: the word `force` (optional)
 *
 * Needs: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Teleport, `module_command`.
 */
export type TeleportWrite_Vehicle =
  | `vehicle:${string}:${string}:${string}:${string}:${string}:${string}`
  | `vehicle:${string}:${string}:${string}:${string}:${string}:${string}:${string}`
  | `vehicle:${string}:${string}:${string}:${string}:${string}:${string}:${string}:${string}`;

/**
 * - `bank`
 *
 * Trade outposts, `module_data`.
 */
export type TradeRead_Bank =
  | "bank";

/**
 * - `economy`
 *
 * Trade outposts, `module_data`.
 */
export type TradeRead_Economy =
  | "economy";

/**
 * `prices:<text>`
 *
 * - `text`
 *
 * Trade outposts, `module_data`.
 */
export type TradeRead_Prices =
  | "prices"
  | `prices:${string}`;

/**
 * - `trade`
 *
 * Trade outposts, `module_data`.
 */
export type TradeRead_Trade =
  | "trade";

/**
 * - `writable`
 *
 * Trade outposts, `module_data`.
 */
export type TradeRead_Writable =
  | "writable";

/**
 * `economy:<key>:<value>`
 *
 * - `key`: Setting
 * - `value`: Value
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Trade outposts, `module_command`.
 */
export type TradeWrite_Economy =
  | `economy:${string}`;

/**
 * - `randomizeprices`
 *
 * Needs: Any player online (admin command). Runs one of the game's admin commands, which the game only runs through an online player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Trade outposts, `module_command`.
 */
export type TradeWrite_Randomizeprices =
  | "randomizeprices";

/**
 * - `reseteconomy`
 *
 * Needs: Any player online (admin command). Runs one of the game's admin commands, which the game only runs through an online player.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Trade outposts, `module_command`.
 */
export type TradeWrite_Reseteconomy =
  | "reseteconomy";

/**
 * - `manager`
 *
 * Live vehicles, `module_data`.
 */
export type VehiclesRead_Manager =
  | "manager";

/**
 * - `vehicles`
 *
 * Live vehicles, `module_data`.
 */
export type VehiclesRead_Vehicles =
  | "vehicles";

/**
 * - `containers`
 *
 * Owners of mines, bedrolls and trader depots, `module_data`.
 */
export type VirtualRead_Containers =
  | "containers";

/**
 * - `owners`
 *
 * Owners of mines, bedrolls and trader depots, `module_data`.
 */
export type VirtualRead_Owners =
  | "owners";

/**
 * - `repdata`
 *
 * Owners of mines, bedrolls and trader depots, `module_data`.
 */
export type VirtualRead_Repdata =
  | "repdata";

/**
 * - `survey`
 *
 * Owners of mines, bedrolls and trader depots, `module_data`.
 */
export type VirtualRead_Survey =
  | "survey";

/**
 * `virtualized:<profileId>`
 *
 * - `profileId`
 *
 * Owners of mines, bedrolls and trader depots, `module_data`.
 */
export type VirtualRead_Virtualized =
  | "virtualized"
  | `virtualized:${string}`
  | "virtualized:";

/**
 * - `tournament`
 *
 * Votes and tournaments, `module_data`.
 */
export type VoteRead_Tournament =
  | "tournament";

/**
 * - `vote`
 *
 * Votes and tournaments, `module_data`.
 */
export type VoteRead_Vote =
  | "vote";

/**
 * - `tournamentend`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Votes and tournaments, `module_command`.
 */
export type VoteWrite_Tournamentend =
  | "tournamentend";

/**
 * - `votecancel`
 *
 * Needs: Any player online (admin command). Runs one of the game's admin commands, which the game only runs through an online player.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Votes and tournaments, `module_command`.
 */
export type VoteWrite_Votecancel =
  | "votecancel";

/**
 * `near:<x>,<y>,<z>:<radius cm up to 200000>`
 *
 * - `x,y,z`: x, y and z, separated by commas
 * - `radius cm up to 200000`
 *
 * Far from players, `module_data`.
 */
export type WakeRead_Near =
  | `near:${string}`;

/**
 * - `reach`
 *
 * Far from players, `module_data`.
 */
export type WakeRead_Reach =
  | "reach";

/**
 * - `visitors`
 *
 * Far from players, `module_data`.
 */
export type WakeRead_Visitors =
  | "visitors";

/**
 * `move:<visitor id>:<x>:<y>:<z>`
 *
 * - `visitor id`
 * - `x`
 * - `y`
 * - `z`
 *
 * Needs: No player needed. Works with nobody online. Note: moves the bridge's own visitor; nothing is saved.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: the visitor id is the bridge's own count since the boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Far from players, `module_command`.
 */
export type WakeWrite_Move =
  | `move:${string}:${string}:${string}:${string}`;

/**
 * `place:<x>:<y>:<z>[:<reach cm>][:<seconds>]`
 *
 * - `x`
 * - `y`
 * - `z`
 * - `reach cm` (optional)
 * - `seconds` (optional)
 *
 * Needs: No player needed. Works with nobody online. Note: a visitor of the bridge's own; nothing is saved, so a restart removes it.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Not registered. No route in the game registers it: it has no entity id and no save row, and the reply says so. Note: deliberately: the visitor is a pawn of the bridge's own and is never saved.
 *
 * Far from players, `module_command`.
 */
export type WakeWrite_Place =
  | `place:${string}:${string}:${string}`;

/**
 * `remove:<id>`
 *
 * - `id`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Far from players, `module_command`.
 */
export type WakeWrite_Remove =
  | `remove:${string}`;

/**
 * `vehicles:<cm>:<seconds>`
 *
 * - `cm`
 * - `seconds`
 *
 * Needs: No player needed. Works with nobody online. Note: works with nobody online, but the game builds a vehicle only near an online player.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Far from players, `module_command`.
 */
export type WakeWrite_Vehicles =
  | `vehicles:${string}`;

/**
 * - `biomes`
 *
 * Wildlife population, `module_data`.
 */
export type WildlifeRead_Biomes =
  | "biomes";

/**
 * - `census`
 *
 * Wildlife population, `module_data`.
 */
export type WildlifeRead_Census =
  | "census";

/**
 * - `feeders`
 *
 * Wildlife population, `module_data`.
 */
export type WildlifeRead_Feeders =
  | "feeders";

/**
 * - `fish`
 *
 * Wildlife population, `module_data`.
 */
export type WildlifeRead_Fish =
  | "fish";

/**
 * - `limits`
 *
 * Wildlife population, `module_data`.
 */
export type WildlifeRead_Limits =
  | "limits";

/**
 * - `water`
 *
 * Wildlife population, `module_data`.
 */
export type WildlifeRead_Water =
  | "water";

/**
 * `density:<biome>:<slot>:<value>:CONFIRM`
 *
 * - `biome`
 * - `slot`
 * - `value`: Value
 * - `CONFIRM`: the word `CONFIRM`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Wildlife population, `module_command`.
 */
export type WildlifeWrite_Density =
  | `density:${string}:${string}:${string}:${string}`;

/**
 * `fishweight:<preset>:<species>:<value>[:<n>]`
 *
 * - `preset`
 * - `species`
 * - `value`: Value
 * - `n` (optional)
 * - also `fishweight:<preset>:<species>:<value>`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Wildlife population, `module_command`.
 */
export type WildlifeWrite_Fishweight =
  | `fishweight:${string}:${string}:${string}`;

/**
 * `set:<key>:<value>[:CONFIRM]`
 *
 * - `key`: Limit
 * - `value`: Value
 * - `CONFIRM`: the word `CONFIRM` (optional)
 * - also `set:<key>:<value>`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Wildlife population, `module_command`.
 */
export type WildlifeWrite_Set =
  | `set:${string}:${string}`;

/**
 * - `distant`
 *
 * Levels and streaming, `module_data`.
 */
export type WorldRead_Distant =
  | "distant";

/**
 * `find:<text>`
 *
 * - `text`
 *
 * Levels and streaming, `module_data`.
 */
export type WorldRead_Find =
  | `find:${string}`;

/**
 * `level:<name>`
 *
 * - `name`
 *
 * Levels and streaming, `module_data`.
 */
export type WorldRead_Level =
  | `level:${string}`;

/**
 * - `levels`
 * - `levels:loaded`
 * - `levels:unloaded`
 *
 * Levels and streaming, `module_data`.
 */
export type WorldRead_Levels =
  | "levels"
  | "levels:loaded"
  | "levels:unloaded";

/**
 * - `managers`
 *
 * Levels and streaming, `module_data`.
 */
export type WorldRead_Managers =
  | "managers";

/**
 * - `summary`
 *
 * Levels and streaming, `module_data`.
 */
export type WorldRead_Summary =
  | "summary";

/**
 * `stream:<level>:CONFIRM`
 *
 * - `level`
 * - `CONFIRM`: the word `CONFIRM`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Levels and streaming, `module_command`.
 */
export type WorldWrite_Stream =
  | `stream:${string}`;

/**
 * - `unload`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: it always refuses.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Levels and streaming, `module_command`.
 */
export type WorldWrite_Unload =
  | "unload";

/**
 * - `unstream`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: it always refuses.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Levels and streaming, `module_command`.
 */
export type WorldWrite_Unstream =
  | "unstream";

/**
 * - `events`
 *
 * Live world events, `module_data`.
 */
export type WorldeventsRead_Events =
  | "events";

/**
 * `ledger:at:<steamId>:<ms>`
 *
 * - `at`: the word `at`
 * - `steamId`
 * - `ms`
 * - also `ledger:player:<steamId>`
 *
 * Live world events, `module_data`.
 */
export type WorldeventsRead_Ledger =
  | "ledger"
  | `ledger:${string}`
  | `ledger:at:${string}`
  | `ledger:player:${string}`;

/**
 * - `cancel`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live world events, `module_command`.
 */
export type WorldeventsWrite_Cancel =
  | "cancel"
  | `cancel:${string}`;

/**
 * - `cancelforce`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live world events, `module_command`.
 */
export type WorldeventsWrite_Cancelforce =
  | "cancelforce"
  | `cancelforce:${string}`;

/**
 * - `cargodetonate`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live world events, `module_command`.
 */
export type WorldeventsWrite_Cargodetonate =
  | "cargodetonate"
  | `cargodetonate:${string}`;

/**
 * - `cargodrop`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live world events, `module_command`.
 */
export type WorldeventsWrite_Cargodrop =
  | "cargodrop"
  | `cargodrop:${string}`;

/**
 * - `clearscores`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live world events, `module_command`.
 */
export type WorldeventsWrite_Clearscores =
  | "clearscores"
  | `clearscores:${string}`;

/**
 * - `cooldown`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Not kept on request: a countdown, so a replay would start it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live world events, `module_command`.
 */
export type WorldeventsWrite_Cooldown =
  | "cooldown"
  | `cooldown:${string}`;

/**
 * - `eventmove`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live world events, `module_command`.
 */
export type WorldeventsWrite_Eventmove =
  | "eventmove"
  | `eventmove:${string}`;

/**
 * - `eventradius`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live world events, `module_command`.
 */
export type WorldeventsWrite_Eventradius =
  | "eventradius"
  | `eventradius:${string}`;

/**
 * - `join`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live world events, `module_command`.
 */
export type WorldeventsWrite_Join =
  | "join"
  | `join:${string}`;

/**
 * - `kick`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live world events, `module_command`.
 */
export type WorldeventsWrite_Kick =
  | "kick"
  | `kick:${string}`;

/**
 * - `leave`
 *
 * Needs: That player online. Acts on the named player, who must be online.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live world events, `module_command`.
 */
export type WorldeventsWrite_Leave =
  | "leave"
  | `leave:${string}`;

/**
 * - `resetarea`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Live world events, `module_command`.
 */
export type WorldeventsWrite_Resetarea =
  | "resetarea"
  | `resetarea:${string}`;

/**
 * - `schedule`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Not measured. Nobody has measured whether it survives a restart.
 * Not kept on request: a one-off act, so a replay would do it again at every boot.
 * Creates: The game's own route. Made through the game's own command or logic, so the game keeps it exactly as it keeps one it made itself. Whether that kind gets a save row was not measured here. Note: the game runs the event and makes what it brings.
 *
 * Live world events, `module_command`.
 */
export type WorldeventsWrite_Schedule =
  | "schedule"
  | `schedule:${string}`;

/**
 * - `border`
 *
 * Custom zones, `module_data`.
 */
export type ZonesRead_Border =
  | "border";

/**
 * `config:rename:<index>:<name>`
 *
 * - `rename`: the word `rename`
 * - `index`
 * - `name`
 * - also `config:copy:<index>:<newName>`
 * - also `config:add:<name>`
 * - also `config:delete:<index>`
 * - also `config:<index>`
 * - also `config:color:<index>:<r>:<g>:<b>:<a>`
 * - also `config:damage:<index>:<instigator>:<channel>:<receiver>:<ignore|allow|block>`
 *
 * Custom zones, `module_data`.
 */
export type ZonesRead_Config =
  | `config:${string}`;

/**
 * - `defaults`
 *
 * Custom zones, `module_data`.
 */
export type ZonesRead_Defaults =
  | "defaults";

/**
 * - `enums`
 *
 * Custom zones, `module_data`.
 */
export type ZonesRead_Enums =
  | "enums";

/**
 * - `global`
 *
 * Custom zones, `module_data`.
 */
export type ZonesRead_Global =
  | "global";

/**
 * - `guarded`
 *
 * Custom zones, `module_data`.
 */
export type ZonesRead_Guarded =
  | "guarded";

/**
 * `spawners:<x>:<y>:<radius>`
 *
 * - `x`
 * - `y`
 * - `radius`
 * - also `spawners:<level>`
 *
 * Custom zones, `module_data`.
 */
export type ZonesRead_Spawners =
  | "spawners"
  | `spawners:${string}`;

/**
 * `zone:<name>`
 *
 * - `name`
 *
 * Custom zones, `module_data`.
 */
export type ZonesRead_Zone =
  | `zone:${string}`;

/**
 * - `zones`
 *
 * Custom zones, `module_data`.
 */
export type ZonesRead_Zones =
  | "zones";

/**
 * `assign:<name>:<configIndex>`
 *
 * - `name`: Zone
 * - `configIndex`
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Custom zones, `module_command`.
 */
export type ZonesWrite_Assign =
  | `assign:${string}`;

/**
 * `batch:<edit>`
 *
 * - `edit`
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Registered. Made through the game's own route and kept in the game's own records, an entity id and a save row for an item, so the game brings it back after a restart. Note: a zone is kept in the game's own zone records.
 *
 * Custom zones, `module_command`.
 */
export type ZonesWrite_Batch =
  | `batch:${string}`;

/**
 * `clear:<bed>:*:CONFIRM`
 *
 * - `bed`
 * - `*`: the word `*`
 * - `CONFIRM`: the word `CONFIRM`
 * - also `clear:CONFIRM`
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Custom zones, `module_command`.
 */
export type ZonesWrite_Clear =
  | "clear"
  | `clear:${string}`
  | "clear:CONFIRM";

/**
 * `config:rename:<index>:<name>`
 *
 * - `rename`: the word `rename`
 * - `index`
 * - `name`: Zone
 * - also `config:copy:<index>:<newName>`
 * - also `config:add:<name>`
 * - also `config:delete:<index>`
 * - also `config:<index>`
 * - also `config:color:<index>:<r>:<g>:<b>:<a>`
 * - also `config:damage:<index>:<instigator>:<channel>:<receiver>:<ignore|allow|block>`
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Custom zones, `module_command`.
 */
export type ZonesWrite_Config =
  | `config:${string}`;

/**
 * `copy:<name>:<newName>`
 *
 * - `name`: Zone
 * - `newName`: Name for the copy
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Registered. Made through the game's own route and kept in the game's own records, an entity id and a save row for an item, so the game brings it back after a restart. Note: a zone is kept in the game's own zone records.
 *
 * Custom zones, `module_command`.
 */
export type ZonesWrite_Copy =
  | `copy:${string}`;

/**
 * `delete:<name>:CONFIRM`
 *
 * - `name`: Zone
 * - `CONFIRM`: the word `CONFIRM`
 * - also `delete:<name>`
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Custom zones, `module_command`.
 */
export type ZonesWrite_Delete =
  | `delete:${string}`;

/**
 * `global:color:<r>:<g>:<b>:<a>`
 *
 * - `color`: the word `color`
 * - `r`
 * - `g`
 * - `b`
 * - `a`
 * - also `global:damage:<instigator>:<channel>:<receiver>:<handling>`
 * - also `global:damageall:<instigator>:<receiver>:<handling>`
 * - also `global:event:<event>:<handling>`
 * - also `global:damageclear:<instigator>`
 * - also `global:eventall:<handling>`
 * - also `global:rename:<name>`
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Custom zones, `module_command`.
 */
export type ZonesWrite_Global =
  | `global:${string}`;

/**
 * `guardedtune:<field>:<value>`
 *
 * - `field`
 * - `value`
 *
 * Needs: No player needed. Works with nobody online.
 * After a restart: Lost. Measured to revert, or never saved.
 * Kept on request: send it with `persist: true` and the bridge applies it again after every boot.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Custom zones, `module_command`.
 */
export type ZonesWrite_Guardedtune =
  | `guardedtune:${string}`;

/**
 * - `mapreload`
 *
 * Needs: Any player online (admin command). Runs one of the game's admin commands, which the game only runs through an online player.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Custom zones, `module_command`.
 */
export type ZonesWrite_Mapreload =
  | "mapreload";

/**
 * `move:<name>:<x>:<y>`
 *
 * - `name`: Zone
 * - `x`
 * - `y`
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Custom zones, `module_command`.
 */
export type ZonesWrite_Move =
  | `move:${string}`;

/**
 * `order:<name>:<up|down|top|bottom|position>`
 *
 * - `name`: Zone
 * - `up|down|top|bottom|position`: one of `up`, `down`, `top`, `bottom`, `position`
 * - also `order:<name>`
 * - also `order:<name>:up`
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Custom zones, `module_command`.
 */
export type ZonesWrite_Order =
  | `order:${string}`;

/**
 * - `refresh`
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Custom zones, `module_command`.
 */
export type ZonesWrite_Refresh =
  | "refresh";

/**
 * `rename:<oldName>:<newName>`
 *
 * - `oldName`
 * - `newName`: Name for the copy
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Custom zones, `module_command`.
 */
export type ZonesWrite_Rename =
  | `rename:${string}`;

/**
 * `resize:<name>:<width>:<height>`
 *
 * - `name`: Zone
 * - `width`
 * - `height`
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Custom zones, `module_command`.
 */
export type ZonesWrite_Resize =
  | `resize:${string}`;

/**
 * `restore:<name>`
 *
 * - `name`: Zone
 * - also `restore:all:CONFIRM`
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Registered. Made through the game's own route and kept in the game's own records, an entity id and a save row for an item, so the game brings it back after a restart. Note: a zone is kept in the game's own zone records.
 *
 * Custom zones, `module_command`.
 */
export type ZonesWrite_Restore =
  | `restore:${string}`;

/**
 * `set:<name>:<shape>:<x>:<y>:<width>:<height>:<configIndex>`
 *
 * - `name`: Zone
 * - `shape`
 * - `x`
 * - `y`
 * - `width`
 * - `height`
 * - `configIndex`
 * - also `set:<id>:circle`
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Registered. Made through the game's own route and kept in the game's own records, an entity id and a save row for an item, so the game brings it back after a restart. Note: a zone is kept in the game's own zone records.
 *
 * Custom zones, `module_command`.
 */
export type ZonesWrite_Set =
  | `set:${string}`;

/**
 * `shape:<name>:rectangle:<height>`
 *
 * - `name`: Zone
 * - `rectangle`: the word `rectangle`
 * - `height`
 * - also `shape:<name>`
 * - also `shape:<name>:<circle|rectangle>[:<height>]`
 * - also `shape:<name>:<shape>[:<height>]`
 *
 * Needs: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * After a restart: Survives. Measured to be in the save after a restart.
 * Creates: Nothing. Creates nothing new in the world.
 *
 * Custom zones, `module_command`.
 */
export type ZonesWrite_Shape =
  | `shape:${string}`;

/**
 * Every module, what `module_data` and `module_command` accept for it, and the verbs that are
 * retired. Each verb is a type of its own above, with its usage and fields in its doc comment;
 * `${string}` also matches a colon, so the compiler checks the verb and not the count.
 *
 * Every module ships switched off, and a module that is off refuses its verbs and names the
 * setting to turn on.
 */
export interface ModuleVocabulary {
  /**
   * In-game actions · 18 settings
   *
   * Reads (`module_data`):
   * - `state:<steamid>`
   *
   * Writes (`module_command`), with the verb in field 2:
   * - `<steamId>:ammo:<on>`
   * - `<steamId>:cough:<intensity>`
   * - `<steamid>:crouch[:<value>]`
   * - `<steamid>:cuffpart:<hands|feet>`
   * - `<steamid>:cufftight:<value>`
   * - `<steamId>:dbfame:<amount>`
   * - `<steamid>:dbfameadd[:<value>]`
   * - `<steamId>:dbgold:<amount>`
   * - `<steamid>:dbgoldadd[:<value>]`
   * - `<steamId>:dbmoney:<amount>`
   * - `<steamid>:dbmoneyadd[:<value>]`
   * - `<steamId>:defecate:diarrhea`
   * - `<steamId>:detonate:<keepHeadgear>`
   * - `<steamId>:disarm`
   * - `<steamId>:fade:<seconds>`
   * - `<steamid>:fakename:<text>`
   * - `<steamId>:fame:<fame>`
   * - `<steamId>:freelook:<on>`
   * - `<steamId>:gender:<gender>`
   * - `<sid>:godmode:maybe`
   * - `<steamId>:gold:<amount>`
   * - `<steamid>:hud:server`
   * - `<steamId>:immortal:<on>`
   * - `<steamId>:kick:<reason>`
   * - `<steamid>:killfeed:<prefix>|<name>|<suffix>[|ping]`
   * - `<steamId>:limp:<on>`
   * - `<steamId>:limpclear`
   * - `<steamId>:load`
   * - `<steamId>:money:<amount>`
   * - `<steamId>:nightvision:<on>`
   * - `<steamId>:pace:<pace>`
   * - `<steamId>:repossess`
   * - `<steamId>:revive`
   * - `<steamid>:save`
   * - `<steamid>:silence:<hours>[:<channel>]`
   * - `<steamId>:sneeze:<intensity>`
   * - `<steamId>:spawnscreen:<withLoadout>`
   * - `<steamId>:squadcreate:<v>`
   * - `<steamId>:squaddemote:<v>`
   * - `<steamId>:squadjoin:<v>`
   * - `<steamId>:squadleave:<v>`
   * - `<sid>:squadpromote:<profileId>`
   * - `<steamId>:squadquit`
   * - `<steamId>:strip`
   * - `<steamId>:suicide`
   * - `<steamId>:suicidetime:<seconds>`
   * - `<steamId>:superjump:<on>`
   * - `<steamId>:uncuff`
   * - `<steamId>:unmount`
   * - `<steamid>:unsilence[:<channel>]`
   * - `<steamId>:urinate:<natural>`
   * - `<steamId>:vomit:<natural>`
   * - `<steamId>:wetness:<part>`
   *
   * Retired, always refuse: `warn`.
   */
  "actions": {
    data:
      | ActionsRead_State;
    command:
      | ActionsWrite_Ammo
      | ActionsWrite_Cough
      | ActionsWrite_Crouch
      | ActionsWrite_Cuffpart
      | ActionsWrite_Cufftight
      | ActionsWrite_Dbfame
      | ActionsWrite_Dbfameadd
      | ActionsWrite_Dbgold
      | ActionsWrite_Dbgoldadd
      | ActionsWrite_Dbmoney
      | ActionsWrite_Dbmoneyadd
      | ActionsWrite_Defecate
      | ActionsWrite_Detonate
      | ActionsWrite_Disarm
      | ActionsWrite_Fade
      | ActionsWrite_Fakename
      | ActionsWrite_Fame
      | ActionsWrite_Freelook
      | ActionsWrite_Gender
      | ActionsWrite_Godmode
      | ActionsWrite_Gold
      | ActionsWrite_Hud
      | ActionsWrite_Immortal
      | ActionsWrite_Kick
      | ActionsWrite_Killfeed
      | ActionsWrite_Limp
      | ActionsWrite_Limpclear
      | ActionsWrite_Load
      | ActionsWrite_Money
      | ActionsWrite_Nightvision
      | ActionsWrite_Pace
      | ActionsWrite_Repossess
      | ActionsWrite_Revive
      | ActionsWrite_Save
      | ActionsWrite_Silence
      | ActionsWrite_Sneeze
      | ActionsWrite_Spawnscreen
      | ActionsWrite_Squadcreate
      | ActionsWrite_Squaddemote
      | ActionsWrite_Squadjoin
      | ActionsWrite_Squadleave
      | ActionsWrite_Squadpromote
      | ActionsWrite_Squadquit
      | ActionsWrite_Strip
      | ActionsWrite_Suicide
      | ActionsWrite_Suicidetime
      | ActionsWrite_Superjump
      | ActionsWrite_Uncuff
      | ActionsWrite_Unmount
      | ActionsWrite_Unsilence
      | ActionsWrite_Urinate
      | ActionsWrite_Vomit
      | ActionsWrite_Wetness;
    retired: "warn";
  };
  /**
   * Creature behaviour · 3 settings
   *
   * Reads (`module_data`):
   * - `counts`
   * - `creature:<id>`
   * - `fields`
   * - `hunting:<steamid>`
   * - `near:<steamid>:<radius>`
   * - `threats`
   *
   * Writes (`module_command`):
   * - `health:<id>:<value>`
   * - `hostile:<id>:yes`
   * - `move:<id>:<x>,<y>,<z>`
   * - `remove:<id>:junk`
   * - `set:<id>:<field>:<value>`
   * - `stance:<id>:<name>`
   * - `target:<id>:<steamid|none>`
   */
  "ai": {
    data:
      | AiRead_Counts
      | AiRead_Creature
      | AiRead_Fields
      | AiRead_Hunting
      | AiRead_Near
      | AiRead_Threats;
    command:
      | AiWrite_Health
      | AiWrite_Hostile
      | AiWrite_Move
      | AiWrite_Remove
      | AiWrite_Set
      | AiWrite_Stance
      | AiWrite_Target;
    retired: never;
  };
  /**
   * Live bases and raid protection · 5 settings · read-only
   *
   * Reads (`module_data`):
   * - `bases`
   * - `contents:<baseId>`
   * - `protection`
   */
  "bases": {
    data:
      | BasesRead_Bases
      | BasesRead_Contents
      | BasesRead_Protection;
    command: never;
    retired: never;
  };
  /**
   * Base building · 8 settings
   *
   * Reads (`module_data`):
   * - `bases`
   * - `build`
   * - `elements:<baseId>`
   *
   * Writes (`module_command`):
   * - `catalogue`
   * - `clearowner:<baseId>:<x>:<y>:<z>:CONFIRM`
   * - `demolish:<x>:<y>:<z>:<radius>:<elementType>:CONFIRM`
   * - `destroy:<baseId>:<elementId>:<x>:<y>:<z>[:<reason>[:<cascade>]]`
   * - `fill:<placementId>:craft|godmode:via:<executor>`
   * - `chown:<old>:<new>`
   * - `learn:<full class path>`
   * - `overtake:<elementId>:<x>:<y>:<z>:<newOwnerProfileId>`
   * - `place:<recipeName>:<x>:<y>:<z>:via:<steamId>`
   * - `seedbase:<baseId>:<name>:<locX>:<locY>:<sizeX>:<sizeY>:<minX>:<minY>:<maxX>:<maxY>:<owner>:<ownedByPlayer>`
   * - `setowner:<baseId>:<x>:<y>:<z>:<newOwnerProfileId>`
   * - `spawn:<baseId>:<class>:<x>:<y>:<z>:<yaw>:<elementId>[:<owner>[:<creator>]]`
   * - `transfer:<old>:<new>`
   *
   * Retired, always refuse: `damage`.
   */
  "build": {
    data:
      | BuildRead_Bases
      | BuildRead_Build
      | BuildRead_Elements;
    command:
      | BuildWrite_Catalogue
      | BuildWrite_Clearowner
      | BuildWrite_Demolish
      | BuildWrite_Destroy
      | BuildWrite_Fill
      | BuildWrite_Chown
      | BuildWrite_Learn
      | BuildWrite_Overtake
      | BuildWrite_Place
      | BuildWrite_Seedbase
      | BuildWrite_Setowner
      | BuildWrite_Spawn
      | BuildWrite_Transfer;
    retired: "damage";
  };
  /**
   * Weather and time · 2 settings
   *
   * Reads (`module_data`):
   * - `curves`
   * - `get:<field>`
   * - `groups`
   * - `members`
   * - `rolls`
   * - `state`
   * - `switches`
   *
   * Writes (`module_command`):
   * - `advance:<on>`
   * - `set:<field>:<value>`
   * - `setbool:<switch>:on`
   * - `setc:<field>:<part>:<value>`
   * - `setcurve:<curve>:<n>:<value>`
   * - `setstage:<channel>:<n>:<value>`
   * - `setv:<field>:<a>,<b>,…`
   * - `simulate:<on>`
   *
   * Retired, always refuse: `hold`, `pin`, `pinv`.
   */
  "climate": {
    data:
      | ClimateRead_Curves
      | ClimateRead_Get
      | ClimateRead_Groups
      | ClimateRead_Members
      | ClimateRead_Rolls
      | ClimateRead_State
      | ClimateRead_Switches;
    command:
      | ClimateWrite_Advance
      | ClimateWrite_Set
      | ClimateWrite_Setbool
      | ClimateWrite_Setc
      | ClimateWrite_Setcurve
      | ClimateWrite_Setstage
      | ClimateWrite_Setv
      | ClimateWrite_Simulate;
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
      | CraftRead_Cookrecipes
      | CraftRead_Craft
      | CraftRead_CraftEvents
      | CraftRead_Fishing
      | CraftRead_Placements;
    command: never;
    retired: never;
  };
  /**
   * Damage at a point · 7 settings
   *
   * Reads (`module_data`):
   * - `last`
   * - `preview:<x>:<y>:<z>:<radius>`
   *
   * Writes (`module_command`):
   * - `explode`
   */
  "damage": {
    data:
      | DamageRead_Last
      | DamageRead_Preview;
    command:
      | DamageWrite_Explode;
    retired: never;
  };
  /**
   * Remove from the world · 21 settings
   *
   * Reads (`module_data`):
   * - `here:<x>,<y>,<z>,<radius>`
   * - `kinds`
   * - `preview:<kind>:<x>,<y>,<z>,<r>:<id>`
   *
   * Writes (`module_command`):
   * - `<kind>:<x>,<y>,<z>,<radius>:<index>.<serial>`
   * - `stow:<kind>:<x>,<y>,<z>,<radius>:<index>.<serial>`
   */
  "despawn": {
    data:
      | DespawnRead_Here
      | DespawnRead_Kinds
      | DespawnRead_Preview;
    command:
      | DespawnWrite_Kind
      | DespawnWrite_Stow;
    retired: never;
  };
  /**
   * Door Shuffle · 22 settings
   *
   * Reads (`module_data`):
   * - `classes`
   * - `door:<Level>:<Actor>`
   * - `interact`
   * - `levels`
   *
   * Writes (`module_command`):
   * - `close:<Level>:<Actor>`
   * - `lock:<target>`
   * - `open:<Level>:<Actor>`
   * - `save`
   * - `seal:<Level>:<Actor>`
   * - `unlock:<target>`
   * - `unseal:<key>:force`
   */
  "doors": {
    data:
      | DoorsRead_Classes
      | DoorsRead_Door
      | DoorsRead_Interact
      | DoorsRead_Levels;
    command:
      | DoorsWrite_Close
      | DoorsWrite_Lock
      | DoorsWrite_Open
      | DoorsWrite_Save
      | DoorsWrite_Seal
      | DoorsWrite_Unlock
      | DoorsWrite_Unseal;
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
   * - `zone:<asset>:<chance %|->:<check min s|->:<check max s|->:<hold s>:CONFIRM`
   * - `zonerestore`
   */
  "encounters": {
    data:
      | EncountersRead_Bases
      | EncountersRead_Encounters
      | EncountersRead_Hordes
      | EncountersRead_Nearby
      | EncountersRead_Places
      | EncountersRead_Schedule
      | EncountersRead_Tuning;
    command:
      | EncountersWrite_Bb
      | EncountersWrite_Draw
      | EncountersWrite_Dump
      | EncountersWrite_Zone
      | EncountersWrite_Zonerestore;
    retired: never;
  };
  /**
   * Live world · 6 settings
   *
   * Reads (`module_data`):
   * - `bases`
   * - `entities`
   * - `entity:<id>,<property>`
   * - `kinds`
   *
   * Writes (`module_command`):
   * - `heal:<id>,<ratio>`
   * - `set:<id>,<property>,<type>,<value>`
   */
  "entities": {
    data:
      | EntitiesRead_Bases
      | EntitiesRead_Entities
      | EntitiesRead_Entity
      | EntitiesRead_Kinds;
    command:
      | EntitiesWrite_Heal
      | EntitiesWrite_Set;
    retired: never;
  };
  /**
   * Live game events · 12 settings · read-only
   *
   * Reads (`module_data`):
   * - `events:since:<seq>`
   * - `kinds`
   * - `peek`
   * - `watches`
   */
  "events": {
    data:
      | EventsRead_Events
      | EventsRead_Kinds
      | EventsRead_Peek
      | EventsRead_Watches;
    command: never;
    retired: never;
  };
  /**
   * Gardens and crops · 4 settings
   *
   * Reads (`module_data`):
   * - `farming`
   * - `garden:<id>`
   *
   * Retired, always refuse: `clear`, `fertilize`, `fungicide`, `grow`, `harvest`, `kill`, `pesticide`, `plant`, `water`, `weeds`.
   */
  "farming": {
    data:
      | FarmingRead_Farming
      | FarmingRead_Garden;
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
   * - `near:<x>,<y>,<z>,<radius>`
   * - `openings`
   * - `owner:<profileId>`
   *
   * Writes (`module_command`):
   * - `add`
   * - `build`
   * - `destroy`
   * - `forget`
   * - `heal`
   * - `place`
   * - `remove`
   * - `repair`
   * - `sethealth`
   */
  "fortifications": {
    data:
      | FortificationsRead_Events
      | FortificationsRead_Fortifications
      | FortificationsRead_Ledger
      | FortificationsRead_Near
      | FortificationsRead_Openings
      | FortificationsRead_Owner;
    command:
      | FortificationsWrite_Add
      | FortificationsWrite_Build
      | FortificationsWrite_Destroy
      | FortificationsWrite_Forget
      | FortificationsWrite_Heal
      | FortificationsWrite_Place
      | FortificationsWrite_Remove
      | FortificationsWrite_Repair
      | FortificationsWrite_Sethealth;
    retired: never;
  };
  /**
   * Move items · 11 settings
   *
   * Reads (`module_data`):
   * - `last`
   *
   * Writes (`module_command`), with the verb in field 2:
   * - `<sid>:drop:<count>:<selector>`
   * - `<steamid>:dropat:<x>,<y>,<z>:<selector>`
   * - `<steamId>:equip:eid:<entityId>`
   * - `<steamId>:equipswap:<oldEntityId>:eid:<newEntityId>`
   * - `<sid>:hands:<selector>`
   * - `<sid>:inventory:<selector>`
   * - `<sid>:inventoryall:<selector>`
   * - `<sid>:inventoryn:<count>:<selector>`
   * - `<sid>:remove:<count>:<areaSelector>:CONFIRM`
   * - `<steamId>:shoulder:<s>:eid:<entityId>`
   * - `<steamId>:unequip:eid:<entityId>`
   */
  "give": {
    data:
      | GiveRead_Last;
    command:
      | GiveWrite_Drop
      | GiveWrite_Dropat
      | GiveWrite_Equip
      | GiveWrite_Equipswap
      | GiveWrite_Hands
      | GiveWrite_Inventory
      | GiveWrite_Inventoryall
      | GiveWrite_Inventoryn
      | GiveWrite_Remove
      | GiveWrite_Shoulder
      | GiveWrite_Unequip;
    retired: never;
  };
  /**
   * Radiation and wetness · 10 settings
   *
   * Reads (`module_data`):
   * - `exposure`
   * - `get:<field>`
   * - `groups`
   * - `job`
   * - `measure:<zone index>`
   * - `state`
   * - `zones`
   *
   * Writes (`module_command`):
   * - `event:<multiplier>:CONFIRM`
   * - `restore:<index>`
   * - `set:<field>:<value>`
   * - `zone:<index>:<field>:<value>`
   */
  "hazard": {
    data:
      | HazardRead_Exposure
      | HazardRead_Get
      | HazardRead_Groups
      | HazardRead_Job
      | HazardRead_Measure
      | HazardRead_State
      | HazardRead_Zones;
    command:
      | HazardWrite_Event
      | HazardWrite_Restore
      | HazardWrite_Set
      | HazardWrite_Zone;
    retired: never;
  };
  /**
   * Live inventories · 13 settings
   *
   * Reads (`module_data`):
   * - `attachjob`
   * - `attachments:eid:<id>`
   * - `counts`
   * - `inventory:<steamid>`
   * - `last`
   * - `near:<x>,<y>,<r>`
   * - `traps`
   * - `where:eid:<id>`
   *
   * Writes (`module_command`):
   * - `attach:eid:<weapon>:eid:<attachment>`
   * - `condition:<value>:<selector>`
   * - `destroy:<selector>`
   * - `detach:eid:<weapon>:eid:<attachment>`
   * - `drop:eid:<id>`
   */
  "items": {
    data:
      | ItemsRead_Attachjob
      | ItemsRead_Attachments
      | ItemsRead_Counts
      | ItemsRead_Inventory
      | ItemsRead_Last
      | ItemsRead_Near
      | ItemsRead_Traps
      | ItemsRead_Where;
    command:
      | ItemsWrite_Attach
      | ItemsWrite_Condition
      | ItemsWrite_Destroy
      | ItemsWrite_Detach
      | ItemsWrite_Drop;
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
   * - `activated:<level>:<on|off>:CONFIRM`
   * - `finale:<level>:<on|off>`
   * - `panic:<level>:CONFIRM`
   * - `time:<level>:<seconds>`
   * - `tune:<level>:<field>:<value>`
   */
  "killbox": {
    data:
      | KillboxRead_Apex
      | KillboxRead_Killbox;
    command:
      | KillboxWrite_Activated
      | KillboxWrite_Finale
      | KillboxWrite_Panic
      | KillboxWrite_Time
      | KillboxWrite_Tune;
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
      | LiveRead_Kills
      | LiveRead_Players
      | LiveRead_Server
      | LiveRead_World;
    command: never;
    retired: never;
  };
  /**
   * Doors and locks · 11 settings
   *
   * Reads (`module_data`):
   * - `locked:<level>`
   * - `locks:<level>`
   * - `near:<x>:<y>:<radius>`
   * - `replication`
   * - `saved`
   *
   * Writes (`module_command`):
   * - `access:<base door>:private`
   * - `attach:<target>:via:<steamId>`
   * - `close:<target>`
   * - `code:<target>:<combination>`
   * - `detach:<target>[:<n>]:via:<steamId>`
   * - `hp:<target>:<value>`
   * - `lock:<target>`
   * - `open:<target>`
   * - `tries:<target>:<count>`
   * - `unlock:<target>`
   */
  "locks": {
    data:
      | LocksRead_Locked
      | LocksRead_Locks
      | LocksRead_Near
      | LocksRead_Replication
      | LocksRead_Saved;
    command:
      | LocksWrite_Access
      | LocksWrite_Attach
      | LocksWrite_Close
      | LocksWrite_Code
      | LocksWrite_Detach
      | LocksWrite_Hp
      | LocksWrite_Lock
      | LocksWrite_Open
      | LocksWrite_Tries
      | LocksWrite_Unlock;
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
      | LootRead_Files;
    command:
      | LootWrite_Export;
    retired: never;
  };
  /**
   * Medical state · 12 settings
   *
   * Reads (`module_data`):
   * - `catalogue`
   * - `conditions:<steamid>`
   * - `deaths:since:<seq>`
   * - `fields`
   * - `lastcure`
   * - `lastchange`
   * - `lastmeta`
   * - `player:<steamid>`
   * - `players`
   * - `severities:<steamid>`
   * - `substances:<steamid>`
   *
   * Writes (`module_command`):
   * - `add:<steamid>:<EffectName>`
   * - `bladder:<steamid>:<amount in ml or SU, or a %>`
   * - `bleed:<steamid>:<bodyPart>:<damage>:<bloodLossRate>`
   * - `burn:<steamid>:<bodyPart>:<damage>`
   * - `cure:<steamid>:all:CONFIRM`
   * - `exhaustion:<steamid>:<amount in ml or SU, or a %>`
   * - `feed:<steamid>:<amount in ml or SU, or a %>`
   * - `incubation:<steamid>:<true|false>`
   * - `infiniteoxygen:<steamid>:<true|false>`
   * - `infinitestamina:<steamid>:<true|false>`
   * - `knockout:<steamid>:<seconds>`
   * - `metabolism:<steamid>:<speed>`
   * - `radiation:<steamid>:<amount>:<rate>`
   * - `remove:<steamid>:<EffectName|#id>:CONFIRM`
   * - `set:<steamid>:<selector>:<field>:<value>`
   * - `severity:<steamid>:<selector>:<value>`
   * - `stamina:<steamid>:<amount in ml or SU, or a %>`
   * - `wellbeing:<steamid>:<stomach ml or %>`
   */
  "medical": {
    data:
      | MedicalRead_Catalogue
      | MedicalRead_Conditions
      | MedicalRead_Deaths
      | MedicalRead_Fields
      | MedicalRead_Lastcure
      | MedicalRead_Lastchange
      | MedicalRead_Lastmeta
      | MedicalRead_Player
      | MedicalRead_Players
      | MedicalRead_Severities
      | MedicalRead_Substances;
    command:
      | MedicalWrite_Add
      | MedicalWrite_Bladder
      | MedicalWrite_Bleed
      | MedicalWrite_Burn
      | MedicalWrite_Cure
      | MedicalWrite_Exhaustion
      | MedicalWrite_Feed
      | MedicalWrite_Incubation
      | MedicalWrite_Infiniteoxygen
      | MedicalWrite_Infinitestamina
      | MedicalWrite_Knockout
      | MedicalWrite_Metabolism
      | MedicalWrite_Radiation
      | MedicalWrite_Remove
      | MedicalWrite_Set
      | MedicalWrite_Severity
      | MedicalWrite_Stamina
      | MedicalWrite_Wellbeing;
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
      | NotifyRead_Queue;
    command:
      | NotifyWrite_Alert
      | NotifyWrite_All
      | NotifyWrite_Banner
      | NotifyWrite_Killfeed
      | NotifyWrite_Killfeedall;
    retired: never;
  };
  /**
   * Offline raid protection · 5 settings
   *
   * Reads (`module_data`):
   * - `encounterBases`
   * - `flag:<id>`
   * - `changes`
   * - `mode`
   * - `requests`
   * - `rules`
   * - `state`
   *
   * Writes (`module_command`):
   * - `forget:CONFIRM`
   * - `recheck`
   */
  "offline": {
    data:
      | OfflineRead_EncounterBases
      | OfflineRead_Flag
      | OfflineRead_Changes
      | OfflineRead_Mode
      | OfflineRead_Requests
      | OfflineRead_Rules
      | OfflineRead_State;
    command:
      | OfflineWrite_Forget
      | OfflineWrite_Recheck;
    retired: never;
  };
  /**
   * Placement check · 2 settings · read-only
   *
   * Reads (`module_data`):
   * - `check:<x>,<y>,<z>`
   * - `where:<x>,<y>,<z>`
   * - `world`
   */
  "place": {
    data:
      | PlaceRead_Check
      | PlaceRead_Where
      | PlaceRead_World;
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
   * - `devicecharge:<x>,<y>,<z>:<ratio>`
   * - `generatorfuel:<x>,<y>,<z>:<amount>`
   * - `generatoroff:<x>,<y>,<z>`
   * - `generatoron:<x,y,z>:junk`
   * - `lightintensity:<x>,<y>,<z>:<value>`
   * - `lightoff:<x>,<y>,<z>`
   * - `lighton:<x>,<y>,<z>`
   *
   * Retired, always refuse: `deviceoff`, `deviceon`, `firefuel`, `firelight`, `fireoff`, `fireon`, `fireout`.
   */
  "power": {
    data:
      | PowerRead_Cooking
      | PowerRead_Heat
      | PowerRead_Power;
    command:
      | PowerWrite_Devicecharge
      | PowerWrite_Generatorfuel
      | PowerWrite_Generatoroff
      | PowerWrite_Generatoron
      | PowerWrite_Lightintensity
      | PowerWrite_Lightoff
      | PowerWrite_Lighton;
    retired: "deviceoff" | "deviceon" | "firefuel" | "firelight" | "fireoff" | "fireon" | "fireout";
  };
  /**
   * Raid protection control · 6 settings
   *
   * Reads (`module_data`):
   * - `calls`
   * - `flag:<id>`
   * - `changes`
   * - `layout`
   * - `manager`
   * - `offline:<id>`
   * - `protections`
   *
   * Writes (`module_command`):
   * - `grant:<flagId>:<delay s>:<duration s|forever>`
   * - `postpone:<flagId>:<seconds from now>`
   * - `reset:<flagId>`
   * - `set:<flagId>:<delay>:<duration, or the word forever>`
   * - `snapshot`
   */
  "protect": {
    data:
      | ProtectRead_Calls
      | ProtectRead_Flag
      | ProtectRead_Changes
      | ProtectRead_Layout
      | ProtectRead_Manager
      | ProtectRead_Offline
      | ProtectRead_Protections;
    command:
      | ProtectWrite_Grant
      | ProtectWrite_Postpone
      | ProtectWrite_Reset
      | ProtectWrite_Set
      | ProtectWrite_Snapshot;
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
   * - `player:<steamid>`
   * - `quest:<netIndex>`
   * - `quests`
   * - `timed`
   *
   * Writes (`module_command`):
   * - `abandon`
   * - `abandontask`
   * - `cycle:<subcommand>`
   * - `track`
   *
   * Retired, always refuse: `complete`, `completequest`, `completetask`, `give`, `start`, `startquest`, `starttask`.
   */
  "quests": {
    data:
      | QuestsRead_Activity
      | QuestsRead_Areas
      | QuestsRead_Catalogue
      | QuestsRead_Givers
      | QuestsRead_Outposts
      | QuestsRead_Player
      | QuestsRead_Quest
      | QuestsRead_Quests
      | QuestsRead_Timed;
    command:
      | QuestsWrite_Abandon
      | QuestsWrite_Abandontask
      | QuestsWrite_Cycle
      | QuestsWrite_Track;
    retired: "complete" | "completequest" | "completetask" | "give" | "start" | "startquest" | "starttask";
  };
  /**
   * Raid detection · 5 settings
   *
   * Reads (`module_data`):
   * - `all`
   * - `announcements`
   * - `base:<id>`
   * - `bases`
   * - `encounters`
   * - `raids`
   * - `reasons`
   *
   * Writes (`module_command`):
   * - `announce:ending:<minutes>`
   * - `end:<baseId>`
   * - `forget:<baseId>:CONFIRM`
   * - `start:<baseId>[:<x>:<y>:<z>]`
   */
  "raid": {
    data:
      | RaidRead_All
      | RaidRead_Announcements
      | RaidRead_Base
      | RaidRead_Bases
      | RaidRead_Encounters
      | RaidRead_Raids
      | RaidRead_Reasons;
    command:
      | RaidWrite_Announce
      | RaidWrite_End
      | RaidWrite_Forget
      | RaidWrite_Start;
    retired: never;
  };
  /**
   * Vehicle condition · 14 settings
   *
   * Reads (`module_data`):
   * - `resolve:<address>`
   *
   * Writes (`module_command`), with the verb in field 2:
   * - `<target>:access:<level>`
   * - `<target>:battery:<amount|percent%>`
   * - `<target>:colors:<uint32>[:<part>]`
   * - `<target>:damage:<amount>:<part>`
   * - `<target>:destroy:CONFIRM`
   * - `<target>:fuel:<litres|percent%>`
   * - `<target>:mileage:<km>[:<part>]`
   * - `<target>:owner:<profileId>`
   * - `<target>:pattern:<index>[:<part>]`
   * - `<target>:rename:<Name>`
   * - `<target>:repair[:<percent>[:<part>]]`
   * - `<target>:tyre:<inflate|deflate>:<wheel>`
   */
  "repair": {
    data:
      | RepairRead_Resolve;
    command:
      | RepairWrite_Access
      | RepairWrite_Battery
      | RepairWrite_Colors
      | RepairWrite_Damage
      | RepairWrite_Destroy
      | RepairWrite_Fuel
      | RepairWrite_Mileage
      | RepairWrite_Owner
      | RepairWrite_Pattern
      | RepairWrite_Rename
      | RepairWrite_Repair
      | RepairWrite_Tyre;
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
      | ReportRead_Status;
    command: never;
    retired: never;
  };
  /**
   * Fuel & resource stations · 4 settings
   *
   * Reads (`module_data`):
   * - `resources`
   * - `stations:<resource>`
   *
   * Writes (`module_command`):
   * - `near`
   *
   * Retired, always refuse: `fill`, `set`.
   */
  "resources": {
    data:
      | ResourcesRead_Resources
      | ResourcesRead_Stations;
    command:
      | ResourcesWrite_Near;
    retired: "fill" | "set";
  };
  /**
   * Respawn timers · 2 settings
   *
   * Reads (`module_data`):
   * - `timers:<steamId>`
   *
   * Writes (`module_command`):
   * - `clear:<steamId>`
   * - `set:<steamId>:<option|all>:<seconds>`
   */
  "respawn": {
    data:
      | RespawnRead_Timers;
    command:
      | RespawnWrite_Clear
      | RespawnWrite_Set;
    retired: never;
  };
  /**
   * Live server settings · 1 settings
   *
   * Reads (`module_data`):
   * - `categories`
   * - `get:<type>:<name>`
   * - `changes`
   * - `list:<text>`
   * - `outstanding`
   * - `probe:<name>`
   * - `section:<Name>`
   * - `values:<text>`
   * - `valuesfrom:<n>:<text>`
   *
   * Retired, always refuse: `revert`, `revertall`, `set`.
   */
  "settings": {
    data:
      | SettingsRead_Categories
      | SettingsRead_Get
      | SettingsRead_Changes
      | SettingsRead_List
      | SettingsRead_Outstanding
      | SettingsRead_Probe
      | SettingsRead_Section
      | SettingsRead_Values
      | SettingsRead_Valuesfrom;
    command: never;
    retired: "revert" | "revertall" | "set";
  };
  /**
   * Precise spawning · 9 settings
   *
   * Reads (`module_data`):
   * - `check:<classPath>`
   * - `kinds`
   * - `loadcheck:<classPath>`
   * - `persistence`
   * - `persistent:<kind>:<x>,<y>,<z>:<count>:<type>`
   * - `spawn:<kind>:<x>,<y>,<z>:<yaw>,<pitch>,<roll>:<classPath>`
   *
   * Writes (`module_command`):
   * - `load:<classPath>:FORCE_SYNC_LOAD`
   */
  "spawn": {
    data:
      | SpawnRead_Check
      | SpawnRead_Kinds
      | SpawnRead_Loadcheck
      | SpawnRead_Persistence
      | SpawnRead_Persistent
      | SpawnRead_Spawn;
    command:
      | SpawnWrite_Load;
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
   * - `disable:<index>:CONFIRM`
   * - `enable:<index>:CONFIRM`
   */
  "spawnpoints": {
    data:
      | SpawnpointsRead_List
      | SpawnpointsRead_Map
      | SpawnpointsRead_Respawn;
    command:
      | SpawnpointsWrite_Disable
      | SpawnpointsWrite_Enable;
    retired: never;
  };
  /**
   * Live squads · 7 settings
   *
   * Reads (`module_data`):
   * - `board`
   * - `destroyed`
   * - `member:<profileId>`
   * - `names:<squadId>`
   * - `squad:<id>`
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
      | SquadsRead_Board
      | SquadsRead_Destroyed
      | SquadsRead_Member
      | SquadsRead_Names
      | SquadsRead_Squad
      | SquadsRead_Squads;
    command:
      | SquadsWrite_Add
      | SquadsWrite_Board
      | SquadsWrite_Disband
      | SquadsWrite_Info
      | SquadsWrite_Message
      | SquadsWrite_Names
      | SquadsWrite_Remove
      | SquadsWrite_Removeall
      | SquadsWrite_Rename;
    retired: never;
  };
  /**
   * Placed containers and items · 5 settings
   *
   * Reads (`module_data`):
   * - `check:eid:<id>`
   * - `job:<tag>`
   * - `jobs`
   *
   * Writes (`module_command`):
   * - `detonate`
   * - `fill:<tag>:eid:<id>:<Code>*<n>,…`
   * - `place:<tag>:<x>,<y>,<z>:<ItemCode>[:<Code>*<n>,…]`
   */
  "stash": {
    data:
      | StashRead_Check
      | StashRead_Job
      | StashRead_Jobs;
    command:
      | StashWrite_Detonate
      | StashWrite_Fill
      | StashWrite_Place;
    retired: never;
  };
  /**
   * Survival stats · 11 settings
   *
   * Reads (`module_data`):
   * - `attributes:<steamid>:<strength>:<constitution>:<dexterity>:<intelligence>`
   * - `fame`
   * - `kills:steam:<steamid>`
   * - `lastskill`
   * - `ranking`
   * - `rankwords`
   * - `skillinfo:<steamid>`
   * - `skills:<steamid>`
   * - `stats:steam:<steamid>`
   *
   * Writes (`module_command`):
   * - `attributes:<steamid>:<strength>:<constitution>:<dexterity>:<intelligence>`
   * - `clear`
   * - `forgive:<profileId>`
   * - `rank:<count>:<sortBy>:asc|desc`
   * - `refresh:<profileId>`
   * - `skill:<steamid>:<skill>:add|set:<points>`
   * - `skilllevel:<steamid>:<skill>:<level>:<experience>`
   */
  "stats": {
    data:
      | StatsRead_Attributes
      | StatsRead_Fame
      | StatsRead_Kills
      | StatsRead_Lastskill
      | StatsRead_Ranking
      | StatsRead_Rankwords
      | StatsRead_Skillinfo
      | StatsRead_Skills
      | StatsRead_Stats;
    command:
      | StatsWrite_Attributes
      | StatsWrite_Clear
      | StatsWrite_Forgive
      | StatsWrite_Rank
      | StatsWrite_Refresh
      | StatsWrite_Skill
      | StatsWrite_Skilllevel;
    retired: never;
  };
  /**
   * Live storage · 10 settings
   *
   * Reads (`module_data`):
   * - `contents:eid:<entityId>`
   * - `dropcheck:<container>,<item>`
   * - `lastdestroy`
   * - `lockboxes`
   * - `storage`
   *
   * Writes (`module_command`):
   * - `destroy:<containerId>,<itemId>[,<steamid>]`
   * - `drop:<container>,<item>[,<steamid>]`
   * - `move:<containerId>,<itemId>,<targetContainerId>[,<steamid>]`
   * - `observe:<containerId>,<steamid>`
   * - `take:<containerId>,<itemId>,<steamid>`
   */
  "storage": {
    data:
      | StorageRead_Contents
      | StorageRead_Dropcheck
      | StorageRead_Lastdestroy
      | StorageRead_Lockboxes
      | StorageRead_Storage;
    command:
      | StorageWrite_Destroy
      | StorageWrite_Drop
      | StorageWrite_Move
      | StorageWrite_Observe
      | StorageWrite_Take;
    retired: never;
  };
  /**
   * Teleport · 7 settings
   *
   * Reads (`module_data`):
   * - `corpses`
   * - `inflight`
   * - `origin:<steamid>`
   * - `origins`
   *
   * Writes (`module_command`):
   * - `back:<steamid>`
   * - `corpse:<displayName>:<x>:<y>:<z>:<yaw>[:<dropCm>][:force]`
   * - `face:<kind>:<idLow>:<idHigh>:<pitch>:<yaw>:<roll>`
   * - `item:<entityIdLow>:<entityIdHigh>:<x>:<y>:<z>:<yaw>[:<dropCm>][:force]`
   * - `player:<steamid>:<x>:<y>:<z>:<yaw>[:<dropCm>]`
   * - `squad:<squadid>:<x>:<y>:<z>:<yaw>[:<dropCm>]`
   * - `swap:<a>:<b>`
   * - `toplayer:<mover>:<target>`
   * - `vehicle:<entityIdLow>:<entityIdHigh>:<x>:<y>:<z>:<yaw>[:<dropCm>][:force]`
   */
  "teleport": {
    data:
      | TeleportRead_Corpses
      | TeleportRead_Inflight
      | TeleportRead_Origin
      | TeleportRead_Origins;
    command:
      | TeleportWrite_Back
      | TeleportWrite_Corpse
      | TeleportWrite_Face
      | TeleportWrite_Item
      | TeleportWrite_Player
      | TeleportWrite_Squad
      | TeleportWrite_Swap
      | TeleportWrite_Toplayer
      | TeleportWrite_Vehicle;
    retired: never;
  };
  /**
   * Trade outposts · 8 settings
   *
   * Reads (`module_data`):
   * - `bank`
   * - `economy`
   * - `prices:<text>`
   * - `trade`
   * - `writable`
   *
   * Writes (`module_command`):
   * - `economy:<key>:<value>`
   * - `randomizeprices`
   * - `reseteconomy`
   */
  "trade": {
    data:
      | TradeRead_Bank
      | TradeRead_Economy
      | TradeRead_Prices
      | TradeRead_Trade
      | TradeRead_Writable;
    command:
      | TradeWrite_Economy
      | TradeWrite_Randomizeprices
      | TradeWrite_Reseteconomy;
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
      | VehiclesRead_Manager
      | VehiclesRead_Vehicles;
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
   * - `virtualized:<profileId>`
   */
  "virtual": {
    data:
      | VirtualRead_Containers
      | VirtualRead_Owners
      | VirtualRead_Repdata
      | VirtualRead_Survey
      | VirtualRead_Virtualized;
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
      | VoteRead_Tournament
      | VoteRead_Vote;
    command:
      | VoteWrite_Tournamentend
      | VoteWrite_Votecancel;
    retired: never;
  };
  /**
   * Far from players · 6 settings
   *
   * Reads (`module_data`):
   * - `near:<x>,<y>,<z>:<radius cm up to 200000>`
   * - `reach`
   * - `visitors`
   *
   * Writes (`module_command`):
   * - `move:<visitor id>:<x>:<y>:<z>`
   * - `place:<x>:<y>:<z>[:<reach cm>][:<seconds>]`
   * - `remove:<id>`
   * - `vehicles:<cm>:<seconds>`
   */
  "wake": {
    data:
      | WakeRead_Near
      | WakeRead_Reach
      | WakeRead_Visitors;
    command:
      | WakeWrite_Move
      | WakeWrite_Place
      | WakeWrite_Remove
      | WakeWrite_Vehicles;
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
   * - `density:<biome>:<slot>:<value>:CONFIRM`
   * - `fishweight:<preset>:<species>:<value>[:<n>]`
   * - `set:<key>:<value>[:CONFIRM]`
   */
  "wildlife": {
    data:
      | WildlifeRead_Biomes
      | WildlifeRead_Census
      | WildlifeRead_Feeders
      | WildlifeRead_Fish
      | WildlifeRead_Limits
      | WildlifeRead_Water;
    command:
      | WildlifeWrite_Density
      | WildlifeWrite_Fishweight
      | WildlifeWrite_Set;
    retired: never;
  };
  /**
   * Levels and streaming · 4 settings
   *
   * Reads (`module_data`):
   * - `distant`
   * - `find:<text>`
   * - `level:<name>`
   * - `levels`
   * - `managers`
   * - `summary`
   *
   * Writes (`module_command`):
   * - `stream:<level>:CONFIRM`
   * - `unload`
   * - `unstream`
   */
  "world": {
    data:
      | WorldRead_Distant
      | WorldRead_Find
      | WorldRead_Level
      | WorldRead_Levels
      | WorldRead_Managers
      | WorldRead_Summary;
    command:
      | WorldWrite_Stream
      | WorldWrite_Unload
      | WorldWrite_Unstream;
    retired: never;
  };
  /**
   * Live world events · 9 settings
   *
   * Reads (`module_data`):
   * - `events`
   * - `ledger:at:<steamId>:<ms>`
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
      | WorldeventsRead_Events
      | WorldeventsRead_Ledger;
    command:
      | WorldeventsWrite_Cancel
      | WorldeventsWrite_Cancelforce
      | WorldeventsWrite_Cargodetonate
      | WorldeventsWrite_Cargodrop
      | WorldeventsWrite_Clearscores
      | WorldeventsWrite_Cooldown
      | WorldeventsWrite_Eventmove
      | WorldeventsWrite_Eventradius
      | WorldeventsWrite_Join
      | WorldeventsWrite_Kick
      | WorldeventsWrite_Leave
      | WorldeventsWrite_Resetarea
      | WorldeventsWrite_Schedule;
    retired: never;
  };
  /**
   * Custom zones · 6 settings
   *
   * Reads (`module_data`):
   * - `border`
   * - `config:rename:<index>:<name>`
   * - `defaults`
   * - `enums`
   * - `global`
   * - `guarded`
   * - `spawners:<x>:<y>:<radius>`
   * - `zone:<name>`
   * - `zones`
   *
   * Writes (`module_command`):
   * - `assign:<name>:<configIndex>`
   * - `batch:<edit>`
   * - `clear:<bed>:*:CONFIRM`
   * - `config:rename:<index>:<name>`
   * - `copy:<name>:<newName>`
   * - `delete:<name>:CONFIRM`
   * - `global:color:<r>:<g>:<b>:<a>`
   * - `guardedtune:<field>:<value>`
   * - `mapreload`
   * - `move:<name>:<x>:<y>`
   * - `order:<name>:<up|down|top|bottom|position>`
   * - `refresh`
   * - `rename:<oldName>:<newName>`
   * - `resize:<name>:<width>:<height>`
   * - `restore:<name>`
   * - `set:<name>:<shape>:<x>:<y>:<width>:<height>:<configIndex>`
   * - `shape:<name>:rectangle:<height>`
   */
  "zones": {
    data:
      | ZonesRead_Border
      | ZonesRead_Config
      | ZonesRead_Defaults
      | ZonesRead_Enums
      | ZonesRead_Global
      | ZonesRead_Guarded
      | ZonesRead_Spawners
      | ZonesRead_Zone
      | ZonesRead_Zones;
    command:
      | ZonesWrite_Assign
      | ZonesWrite_Batch
      | ZonesWrite_Clear
      | ZonesWrite_Config
      | ZonesWrite_Copy
      | ZonesWrite_Delete
      | ZonesWrite_Global
      | ZonesWrite_Guardedtune
      | ZonesWrite_Mapreload
      | ZonesWrite_Move
      | ZonesWrite_Order
      | ZonesWrite_Refresh
      | ZonesWrite_Rename
      | ZonesWrite_Resize
      | ZonesWrite_Restore
      | ZonesWrite_Set
      | ZonesWrite_Shape;
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
    /** Spawn base elements. Places a structure into a base built in since the server started. The game does not save it. */
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
    /** Include weapon attachments. Adds what is fitted to each weapon and which of its slots are free. (default true) */
    attachments?: boolean;
    /** Fit and remove weapon attachments. Fits a scope, rail, magazine or other part onto a weapon, or takes one off, when the game allows it. (default false) */
    attach?: boolean;
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
    /** Lock and unlock a door. Locks, unlocks, fits or removes the lock on one named door. A door with no lock fitted is never locked. (default false, applies when `enabled`) */
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
    /** Ask the game how bad each effect is. Reads how bad each effect is, its penalty and one player's stamina, with an admin command run as them. (default false, applies when `enabled`) */
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
    /** Announce the global raid window. Shows the game's raid-window messages to every player, with raid protection set to Global. Never opens or closes it. (default false, applies when `enabled`) */
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
    /** Spawn at exact coordinates with a rotation. Places an object at exact coordinates and facing. The game does not register it, so a restart removes it. (default false) */
    enabled?: boolean;
    /** Creatures (animals, puppets, NPCs, drones, sentries). Lets the placement above cover animals, puppets, NPCs, drones and sentries, spawned with their AI running. (default false, applies when `enabled`) */
    creatures?: boolean;
    /** Vehicles. Lets the placement above cover vehicles, as set dressing only. The car is gone at the restart. (default false, applies when `enabled`) */
    vehicles?: boolean;
    /** Bosses (Brenner, Razor, Dropship, Sentry). Lets a Brenner, Razor, Dropship or Sentry be placed. Creatures does not cover them. (default false, applies when `enabled`) */
    bosses?: boolean;
    /** Anything else the game can place. Lets props and fixtures be spawned by their class path. (default false, applies when `enabled`) */
    actors?: boolean;
    /** Also spawn things that LAST, through the game's admin commands. Registered and kept for a vehicle, not for a creature. No facing; needs a player online. (default false, applies when `enabled`) */
    persistent?: boolean;
    /** Load a class the game has not made yet. Allows forcing a load of a class nothing has built yet; it pauses the server and can crash it. (default false, applies when `enabled`) */
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
    /** Allow squads to be changed, not just read. Lets squads be changed: disband, evict, add a member, rename, or set the message or information. A disband is permanent and needs a confirmation; renaming needs a member online. */
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
    /** Also clear a single entry from that list. Asks the game to remove one recorded kill from the kill registry. It counts only if the entry is gone. (applies when `killRegistry`) */
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
    /** Work far from players. Builds far vehicles and loads far world items for a set time; container contents stay asleep. */
    enabled?: boolean;
    /** Longest a wider vehicle distance may last (seconds). A wider vehicle distance ends by itself after this; a smaller one is refused, it removes vehicles. (default 600, min 10, max 3600) */
    maxSeconds?: number;
    /** Longest a visitor may stay (seconds). Every visitor is parked out of the way after this, or sooner when the caller asks. (default 600, min 10, max 3600) */
    visitorSeconds?: number;
    /** Visitor reach when none is given (cm). How far around a visitor the game builds world items, when the caller names no reach. (default 500, min 100, max 7500) */
    visitorBoundsCm?: number;
    /** Largest visitor reach (cm). The widest reach a caller may ask for; a player wakes 7500 cm on this game. (default 5000, min 100, max 7500) */
    maxVisitorBoundsCm?: number;
    /** Most visitors at once. Each visitor costs the server like one more player; parked ones count until a restart. (default 4, min 1, max 16) */
    maxVisitors?: number;
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
    /** Allow events to be started and stopped. Lets events be run rather than only watched: schedule, cancel or reset one, zero its scores, and move, re-target, resize or detonate a cargo drop. Player verbs need that player online. */
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

// ── what a read can carry ───────────────────────────────────────────────────────────────────────

/**
 * Keys the In-game actions read `state:<steamid>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingActions_State {
  /** Absent when the game did not give it. Type not readable from the source. */
  alive?: unknown;
  /** Absent when the game did not give it. */
  bondage?: Record<string, unknown>;
  /** On each item of a list. */
  class?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  conscious?: unknown;
  effects?: unknown[];
  /** Absent when the game did not give it. */
  fakeName?: string;
  /** Absent when the game did not give it. */
  found?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  id?: number;
  /** Absent when the game did not give it. */
  item?: boolean;
  /** Absent when the game did not give it. Type not readable from the source. */
  mounted?: unknown;
  /** Absent when the game did not give it. */
  part?: string;
  /** Absent when the game did not give it. */
  spawned?: boolean;
  /** Absent when the game did not give it. */
  tightness?: number;
  /** Absent when the game did not give it. */
  wetness?: Record<string, unknown>;
}

/**
 * Keys the Creature behaviour read `counts` can carry, at any depth. Not the object's shape.
 */
export interface ReadingAi_Counts {
  /** Absent when the game did not give it. On each item of a list. */
  destroyed?: number;
  /** On each item of a list. */
  hostile?: number;
  /** On each item of a list. */
  total?: number;
  /** On each item of a list. */
  truncated?: boolean;
}

/**
 * Keys the Creature behaviour read `creature:<id>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingAi_Creature {
  /** Absent when the game did not give it. */
  class?: string;
  /** Absent when the game did not give it. */
  creature?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  enumDrift?: boolean;
  /** Absent when the game did not give it. */
  found?: boolean;
  /** Absent when the game did not give it. */
  health?: number;
  /** Absent when the game did not give it. */
  healthMax?: number;
  /** Type not readable from the source. */
  hostile?: unknown;
  /** Absent when the game did not give it. */
  id?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  inCombat?: unknown;
  kind?: string;
  nearestPlayer?: string;
  nearestPlayerIsNotATarget?: boolean;
  /** Absent when the game did not give it. */
  reason?: string;
  /** Absent when the game did not give it. */
  speciesNameGameSaid?: string;
  /** Absent when the game did not give it. */
  speciesNameNote?: string;
  /** Absent when the game did not give it. */
  speciesNameNotItsOwn?: boolean;
  /** Absent when the game did not give it. */
  state?: string;
  /** Absent when the game did not give it. */
  stateEngine?: string;
  /** Absent when the game did not give it. */
  stateEngineUnasked?: boolean;
  /** Absent when the game did not give it. */
  switchedOff?: "animals";
  /** Absent when the game did not give it. */
  target?: string;
  /** Absent when the game did not give it. */
  targetClass?: string;
  /** Absent when the game did not give it. */
  unreadable?: boolean;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Creature behaviour read `fields` can carry, at any depth. Not the object's shape.
 */
export interface ReadingAi_Fields {
  /** Absent when the game did not give it. On each item of a list. */
  calmStance?: string;
  /** Absent when the game did not give it. On each item of a list. */
  combatFlag?: boolean;
  /** On each item of a list. */
  field?: string;
  /** On each item of a list. */
  fields?: unknown[];
  /** On each item of a list. Type not readable from the source. */
  health?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  hostileStance?: string;
  /** On each item of a list. */
  kind?: string;
  kinds?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  max?: number;
  /** Absent when the game did not give it. On each item of a list. */
  min?: number;
  /** On each item of a list. */
  readOnlyWhy?: string;
  /** Absent when the game did not give it. On each item of a list. */
  stanceEnum?: string;
  /** Absent when the game did not give it. On each item of a list. */
  stances?: unknown[] | null;
  /** On each item of a list. Type not readable from the source. */
  target?: unknown;
  /** On each item of a list. */
  type?: string;
  /** Absent when the game did not give it. On each item of a list. */
  values?: unknown[];
  /** On each item of a list. */
  writable?: boolean;
}

/**
 * Keys the Creature behaviour read `hunting:<steamid>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingAi_Hunting {
  /** Absent when the game did not give it. */
  class?: string;
  count?: number;
  /** Absent when the game did not give it. */
  destroyed?: number;
  /** Absent when the game did not give it. */
  enumDrift?: boolean;
  /** Absent when the game did not give it. */
  found?: boolean;
  /** Absent when the game did not give it. */
  health?: number;
  /** Absent when the game did not give it. */
  healthMax?: number;
  /** Type not readable from the source. */
  hostile?: unknown;
  /** Absent when the game did not give it. */
  hunting?: null;
  /** Absent when the game did not give it. */
  id?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  inCombat?: unknown;
  kind?: string;
  nearestPlayer?: string;
  nearestPlayerIsNotATarget?: boolean;
  /** Absent when the game did not give it. */
  omitted?: number;
  /** Absent when the game did not give it. */
  outOfRange?: number;
  /** Absent when the game did not give it. */
  position?: "centimetres";
  /** Absent when the game did not give it. */
  radius?: "metres";
  /** Unit: m. Absent when the game did not give it. */
  radiusM?: number;
  /** Absent when the game did not give it. */
  speciesNameGameSaid?: string;
  /** Absent when the game did not give it. */
  speciesNameNote?: string;
  /** Absent when the game did not give it. */
  speciesNameNotItsOwn?: boolean;
  /** Absent when the game did not give it. */
  state?: string;
  /** Absent when the game did not give it. */
  stateEngine?: string;
  /** Absent when the game did not give it. */
  stateEngineUnasked?: boolean;
  /** Absent when the game did not give it. */
  target?: string;
  /** Absent when the game did not give it. */
  targetClass?: string;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. */
  unit?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  unplaced?: number;
  /** Absent when the game did not give it. */
  unplacedNote?: string;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Creature behaviour read `near:<steamid>:<radius>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingAi_Near {
  /** Absent when the game did not give it. */
  class?: string;
  count?: number;
  /** Absent when the game did not give it. */
  destroyed?: number;
  /** Absent when the game did not give it. */
  enumDrift?: boolean;
  /** Absent when the game did not give it. */
  found?: boolean;
  /** Absent when the game did not give it. */
  health?: number;
  /** Absent when the game did not give it. */
  healthMax?: number;
  /** Type not readable from the source. */
  hostile?: unknown;
  /** Absent when the game did not give it. */
  id?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  inCombat?: unknown;
  kind?: string;
  /** Absent when the game did not give it. */
  near?: null;
  /** Absent when the game did not give it. */
  omitted?: number;
  /** Absent when the game did not give it. */
  outOfRange?: number;
  /** Absent when the game did not give it. */
  position?: "centimetres";
  /** Absent when the game did not give it. */
  radius?: "metres";
  /** Unit: m. Absent when the game did not give it. */
  radiusM?: number;
  /** Absent when the game did not give it. */
  state?: string;
  /** Absent when the game did not give it. */
  stateEngine?: string;
  /** Absent when the game did not give it. */
  stateEngineUnasked?: boolean;
  /** Absent when the game did not give it. */
  target?: string;
  /** Absent when the game did not give it. */
  targetClass?: string;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. */
  unit?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  unplaced?: number;
  /** Absent when the game did not give it. */
  unplacedNote?: string;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Creature behaviour read `threats` can carry, at any depth. Not the object's shape.
 */
export interface ReadingAi_Threats {
  /** Absent when the game did not give it. */
  class?: string;
  count?: number;
  /** Absent when the game did not give it. */
  destroyed?: number;
  /** Absent when the game did not give it. */
  enumDrift?: boolean;
  /** Absent when the game did not give it. */
  found?: boolean;
  /** Absent when the game did not give it. */
  health?: number;
  /** Absent when the game did not give it. */
  healthMax?: number;
  /** Type not readable from the source. */
  hostile?: unknown;
  /** Absent when the game did not give it. */
  id?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  inCombat?: unknown;
  kind?: string;
  nearestPlayer?: string;
  nearestPlayerIsNotATarget?: boolean;
  /** Absent when the game did not give it. */
  omitted?: number;
  /** Absent when the game did not give it. */
  outOfRange?: number;
  /** Absent when the game did not give it. */
  position?: "centimetres";
  /** Absent when the game did not give it. */
  radius?: "metres";
  /** Unit: m. Absent when the game did not give it. */
  radiusM?: number;
  /** Absent when the game did not give it. */
  speciesNameGameSaid?: string;
  /** Absent when the game did not give it. */
  speciesNameNote?: string;
  /** Absent when the game did not give it. */
  speciesNameNotItsOwn?: boolean;
  /** Absent when the game did not give it. */
  state?: string;
  /** Absent when the game did not give it. */
  stateEngine?: string;
  /** Absent when the game did not give it. */
  stateEngineUnasked?: boolean;
  /** Absent when the game did not give it. */
  target?: string;
  /** Absent when the game did not give it. */
  targetClass?: string;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. */
  unit?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  unplaced?: number;
  /** Absent when the game did not give it. */
  unplacedNote?: string;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Live bases and raid protection read `bases` can carry, at any depth. Not the object's shape.
 */
export interface ReadingBases_Bases {
  /** Absent when the game did not give it. */
  actor?: boolean;
  /** Absent when the game did not give it. */
  baseId?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  bases?: unknown;
  basesHaveNoIds?: boolean;
  /** Absent when the game did not give it. */
  basesSource?: "registry" | "scan";
  /** Absent when the game did not give it. */
  basesTableRows?: number;
  /** Absent when the game did not give it. */
  basesTemplatesSkipped?: number;
  /** Absent when the game did not give it. */
  basesTruncated?: boolean;
  /** Absent when the game did not give it. */
  basesUnreadable?: boolean;
  /** Absent when the game did not give it. */
  basesUnreadableWhy?: string;
  /** Absent when the game did not give it. */
  elementClassTypes?: number;
  /** Absent when the game did not give it. */
  elements?: number;
  /** Absent when the game did not give it. */
  elementsAre?: "drawn mesh instances";
  /** Absent when the game did not give it. */
  elementsFrom?: number;
  /** Absent when the game did not give it. */
  elementsZeroMeans?: string;
  /** Absent when the game did not give it. */
  initialBaseSize?: unknown[];
  /** Absent when the game did not give it. */
  meshTypes?: number;
  /** Absent when the game did not give it. */
  name?: string;
  /** Absent when the game did not give it. */
  protectedFlags?: unknown[];
  /** Absent when the game did not give it. */
  protectedFlagsAre?: string;
  /** Absent when the game did not give it. */
  protectedFlagsWhy?: string;
  repairBands?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  rules?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  seconds?: number;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Live bases and raid protection read `contents:<baseId>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingBases_Contents {
  baseId?: number;
  /** On each item of a list. */
  count?: number;
  elements?: number;
  elementsAre?: "drawn mesh instances";
  elementsNote?: "drawn pieces only; furniture and traps are not counted";
  elementsZeroMeans?: string;
  /** On each item of a list. */
  mesh?: string;
  meshes?: unknown[];
  meshTypes?: number;
  noElementIds?: boolean;
  truncated?: boolean;
}

/**
 * Keys the Live bases and raid protection read `protection` can carry, at any depth. Not the object's shape.
 */
export interface ReadingBases_Protection {
  protectedFlags?: unknown[];
  /** Absent when the game did not give it. */
  protectedFlagsAre?: string;
  /** Absent when the game did not give it. */
  protectedFlagsWhy?: string;
  /** Absent when the game did not give it. */
  serverTimeInSyncs?: number;
  /** Absent when the game did not give it. */
  utcDayTimeAtStartup?: number;
}

/**
 * Keys the Base building read `bases` can carry, at any depth. Not the object's shape.
 */
export interface ReadingBuild_Bases {
  /** Absent when the game did not give it. On each item of a list. */
  actor?: boolean;
  /** On each item of a list. */
  baseId?: number;
  bases?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  capturedX?: number;
  /** Absent when the game did not give it. On each item of a list. */
  capturedY?: number;
  /** Absent when the game did not give it. On each item of a list. */
  capturedZ?: number;
  count?: number;
  /** Absent when the game did not give it. On each item of a list. */
  name?: string;
  /** On each item of a list. */
  spawnable?: boolean;
  truncated?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  x?: number;
  /** Absent when the game did not give it. On each item of a list. */
  y?: number;
  /** Absent when the game did not give it. On each item of a list. */
  z?: number;
}

/**
 * Keys the Base building read `build` can carry, at any depth. Not the object's shape.
 */
export interface ReadingBuild_Build {
  /** Unit: ms. On each item of a list. */
  ageMs?: number;
  /** On each item of a list. */
  baseId?: number;
  bases?: unknown[];
  basesObservedOnly?: boolean;
  buildProgressSource?: string;
  /** Absent when the game did not give it. On each item of a list. */
  canBeDamaged?: boolean;
  classes?: unknown[];
  /** Absent when the game did not give it. */
  dataVersion?: number;
  dataVersionKnown?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  destroysWhatIsOnTop?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  elementType?: string;
  /** Absent when the game did not give it. On each item of a list. */
  health?: number;
  healthPersistence?: string;
  healthUnits?: "points; the save stores health as a fraction of this number";
  /** On each item of a list. */
  learnedFrom?: string;
  /** Absent when the game did not give it. */
  liveBases?: number;
  /** On each item of a list. */
  name?: string;
  /** On each item of a list. */
  ownedByPlayer?: boolean;
  /** On each item of a list. */
  ownerProfileId?: number;
  /** On each item of a list. */
  path?: string;
  tierSource?: "the tier is the element's class; there is no tier field to set";
  trackedElements?: number;
  /** On each item of a list. */
  x?: number;
  /** On each item of a list. */
  y?: number;
  /** On each item of a list. */
  z?: number;
}

/**
 * Keys the Base building read `elements:<baseId>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingBuild_Elements {
  /** Unit: ms. On each item of a list. */
  ageMs?: number;
  /** Absent when the game did not give it. On each item of a list. */
  baseId?: number;
  cap?: number;
  /** Absent when the game did not give it. On each item of a list. */
  class?: string;
  /** On each item of a list. */
  elementId?: number;
  elements?: unknown[];
  full?: boolean;
  note?: "Only elements seen since the bridge started. Not proof anything is standing there.";
  observedOnly?: boolean;
  rosterSource?: "SCUM.db table base_element";
  /** On each item of a list. */
  seenVia?: string;
  tracked?: number;
  /** Absent when the game did not give it. On each item of a list. */
  x?: number;
  /** Absent when the game did not give it. On each item of a list. */
  y?: number;
  /** Absent when the game did not give it. On each item of a list. */
  z?: number;
}

/**
 * Keys the Weather and time read `curves` can carry, at any depth. Not the object's shape.
 */
export interface ReadingClimate_Curves {
  basis?: "declared";
  count?: number;
  curves?: unknown[];
  /** Absent when the game did not give it. */
  drives?: string;
  external?: boolean | null;
  group?: string;
  hint?: string;
  /** On each item of a list. */
  index?: number;
  key?: string;
  keyCount?: number;
  /** Type not readable from the source. */
  keyLayout?: unknown;
  /** Absent when the game did not give it. */
  keys?: unknown[] | null;
  role?: string;
  sim?: "input";
  /** Absent when the game did not give it. On each item of a list. */
  time?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  type?: "curve";
  /** Absent when the game did not give it. On each item of a list. */
  value?: number;
  /** Absent when the game did not give it. */
  why?: "No keys of its own; it comes from a curve file this cannot edit." | "The game uses a curve file here, not these keys." | "The keys could not be read in this game build.";
  /** Absent when the game did not give it. */
  writable?: boolean | string;
}

/**
 * Keys the Weather and time read `get:<field>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingClimate_Get {
  after?: unknown[];
  /** Unit: ms. */
  agoMs?: number;
  basis?: string;
  /** Absent when the game did not give it. */
  bounds?: "module";
  /** Unit: ms. */
  delayMs?: number;
  /** Absent when the game did not give it. */
  drives?: string;
  external?: boolean | null;
  group?: string;
  hint?: string;
  /** On each item of a list. */
  index?: number;
  /** Absent when the game did not give it. */
  inside?: string;
  key?: string;
  keyCount?: number;
  /** Absent when the game did not give it. */
  keys?: unknown[] | null;
  /** Absent when the game did not give it. */
  max?: number;
  /** Absent when the game did not give it. */
  min?: number;
  /** Absent when the game did not give it. */
  needs?: string;
  observed?: Record<string, unknown>;
  parts?: unknown[];
  /** Absent when the game did not give it. */
  persists?: boolean;
  /** Absent when the game did not give it. */
  propagates?: string;
  role?: string;
  /** Absent when the game did not give it. */
  shipped?: string;
  sim?: string;
  /** Absent when the game did not give it. */
  simulating?: boolean;
  state?: string;
  /** Absent when the game did not give it. On each item of a list. */
  time?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  type?: string;
  /** Absent when the game did not give it. */
  unit?: "hours";
  /** Absent when the game did not give it. */
  value?: unknown[] | boolean | null | number;
  /** Absent when the game did not give it. */
  why?: "No keys of its own; it comes from a curve file this cannot edit." | "The game uses a curve file here, not these keys." | "The keys could not be read in this game build.";
  /** Absent when the game did not give it. */
  writable?: boolean;
  wrote?: unknown[];
}

/**
 * Keys the Weather and time read `groups` can carry, at any depth. Not the object's shape.
 */
export interface ReadingClimate_Groups {
  groups?: unknown[];
}

/**
 * Keys the Weather and time read `members` can carry, at any depth. Not the object's shape.
 */
export interface ReadingClimate_Members {
  after?: unknown[];
  /** Unit: ms. */
  agoMs?: number;
  basis?: string;
  /** Absent when the game did not give it. */
  bounds?: "module";
  composites?: unknown[];
  /** Unit: ms. */
  delayMs?: number;
  group?: string;
  hint?: string;
  /** Absent when the game did not give it. */
  inside?: string;
  key?: string;
  /** Absent when the game did not give it. */
  max?: number;
  /** Absent when the game did not give it. */
  min?: number;
  /** Absent when the game did not give it. */
  needs?: "system";
  observed?: Record<string, unknown>;
  parts?: unknown[];
  /** Absent when the game did not give it. */
  persists?: boolean;
  /** Absent when the game did not give it. */
  propagates?: string;
  role?: string;
  sim?: string;
  /** Absent when the game did not give it. */
  simulating?: boolean;
  state?: string;
  type?: string;
  /** Absent when the game did not give it. */
  value?: unknown[] | boolean | null | number;
  values?: unknown[];
  writable?: boolean;
  wrote?: unknown[];
}

/**
 * Keys the Weather and time read `rolls` can carry, at any depth. Not the object's shape.
 */
export interface ReadingClimate_Rolls {
  /** On each item of a list. */
  drives?: string;
  /** Absent when the game did not give it. On each item of a list. */
  index?: number;
  /** Absent when the game did not give it. On each item of a list. */
  interpSpeed?: number;
  /** On each item of a list. */
  key?: string;
  /** Absent when the game did not give it. On each item of a list. */
  max?: number;
  /** Absent when the game did not give it. On each item of a list. */
  min?: number;
  /** Absent when the game did not give it. On each item of a list. */
  pinned?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  range?: Record<string, unknown>;
  /** Absent when the game did not give it. On each item of a list. */
  rollInterval?: Record<string, unknown>;
  rolls?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  stages?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  truncated?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  unit?: "game-minutes";
}

/**
 * Keys the Weather and time read `state` can carry, at any depth. Not the object's shape.
 */
export interface ReadingClimate_State {
  /** Absent when the game did not give it. Type not readable from the source. */
  actorReplicates?: unknown;
  after?: unknown[];
  /** Unit: ms. */
  agoMs?: number;
  basis?: string;
  bounds?: string;
  /** Type not readable from the source. */
  dayLength?: unknown;
  /** Unit: ms. */
  delayMs?: number;
  fields?: unknown[];
  group?: string;
  hint?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  holding?: unknown;
  /** Absent when the game did not give it. */
  holdingNote?: string;
  key?: string;
  /** Absent when the game did not give it. */
  level?: string;
  max?: number;
  min?: number;
  /** Absent when the game did not give it. */
  needs?: "system";
  observed?: Record<string, unknown>;
  persistsNote?: string;
  propagates?: string;
  /** Type not readable from the source. */
  resimulatedFieldsHold?: unknown;
  resimulatedObserved?: string;
  resimulatedVerdictIs?: string;
  role?: string;
  sim?: string;
  /** Absent when the game did not give it. */
  simulating?: boolean;
  state?: string;
  type?: string;
  /** Absent when the game did not give it. */
  unit?: "hours";
  /** Absent when the game did not give it. */
  value?: null | number;
  wrote?: unknown[];
}

/**
 * Keys the Weather and time read `switches` can carry, at any depth. Not the object's shape.
 */
export interface ReadingClimate_Switches {
  group?: string;
  hint?: string;
  key?: string;
  needs?: string;
  /** Absent when the game did not give it. */
  persists?: boolean;
  /** Absent when the game did not give it. */
  propagates?: string;
  /** Absent when the game did not give it. */
  shipped?: string;
  switches?: unknown[];
  type?: "bool";
  /** Absent when the game did not give it. */
  value?: boolean;
}

/**
 * Keys the Crafting and fishing read `cookrecipes` can carry, at any depth. Not the object's shape.
 */
export interface ReadingCraft_Cookrecipes {
  active?: unknown[];
  activeMeaning?: "recipes cooking right now, with vessel, heat, time and result";
  activeNote?: "live cooking is not ready yet; ask again once the map has loaded." | "nothing is cooking right now, as far as can be read" | "what is cooking cannot be named on this game build" | "what is cooking cannot be read on this game build";
  /** Absent when the game did not give it. */
  activeTruncated?: boolean;
  /** Type not readable from the source. */
  allEnabled?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  asset?: string;
  /** Absent when the game did not give it. */
  cookingTemperatureC?: number;
  /** Unit: s. Absent when the game did not give it. */
  cookingTimeSec?: number;
  /** Absent when the game did not give it. */
  count?: number;
  emptyMeaning?: string;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  enabled?: unknown;
  entries?: unknown[];
  /** On each item of a list. */
  index?: number;
  joinNote?: "recipeId N is the entry at index N-1";
  /** Absent when the game did not give it. Type not readable from the source. */
  requiresHeat?: unknown;
  /** Absent when the game did not give it. */
  resultingFood?: string;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. Type not readable from the source. */
  utility?: unknown;
  /** Absent when the game did not give it. */
  utilityTruncated?: boolean;
}

/**
 * Keys the Crafting and fishing read `craft` can carry, at any depth. Not the object's shape.
 */
export interface ReadingCraft_Craft {
  /** Absent when the game did not give it. On each item of a list. */
  accumulatedQuality?: number;
  /** On each item of a list. */
  action?: string;
  /** Absent when the game did not give it. */
  actions?: Record<string, unknown>;
  actionsNote?: "empty is normal: nobody is crafting, washing or similar right now.";
  actionsOnline?: number;
  actionsWithPrisoner?: number;
  class?: string;
  distinctIds?: number;
  duplicateNote?: string;
  /** Absent when the game did not give it. */
  fishing?: Record<string, unknown>;
  fishingNote?: "empty is normal: nobody is fishing right now." | "players could not be read; this is not a result. Ask again.";
  /** On each item of a list. */
  hasComponent?: boolean;
  /** Absent when the game did not give it. */
  id?: number;
  /** On each item of a list. */
  index?: number;
  /** Absent when the game did not give it. On each item of a list. */
  ingredientClass?: string;
  /** Absent when the game did not give it. On each item of a list. */
  limiter?: string;
  /** Absent when the game did not give it. */
  limiterNote?: string;
  /** Absent when the game did not give it. */
  name?: string;
  /** Absent when the game did not give it. */
  onTheLine?: string;
  /** Absent when the game did not give it. */
  path?: string;
  placed?: number;
  /** Absent when the game did not give it. */
  placements?: unknown[];
  placementsNote?: "empty is normal: nobody is mid-way through building.";
  placing?: number;
  placingNote?: string;
  /** Type not readable from the source. */
  players?: unknown;
  /** Absent when the game did not give it. */
  productClass?: string;
  /** Absent when the game did not give it. */
  profileId?: number;
  /** Absent when the game did not give it. */
  progress?: number;
  provided?: number;
  reason?: "players could not be read; ask again.";
  /** Absent when the game did not give it. */
  recipe?: string;
  required?: number;
  /** Type not readable from the source. */
  rods?: unknown;
  slotCount?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  slots?: unknown;
  /** Absent when the game did not give it. */
  slotsTruncated?: boolean;
  /** Absent when the game did not give it. */
  slotsUnread?: number;
  /** Absent when the game did not give it. */
  state?: string;
  /** Absent when the game did not give it. */
  status?: string;
  /** Absent when the game did not give it. */
  statusRaw?: number;
  /** Absent when the game did not give it. */
  steamid?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  trophy?: unknown;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  unreadable?: boolean;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Crafting and fishing read `craftEvents` can carry, at any depth. Not the object's shape.
 */
export interface ReadingCraft_CraftEvents {
  /** Unit: ms. On each item of a list. */
  agoMs?: number;
  count?: number;
  dropped?: number;
  /** Absent when the game did not give it. */
  emptyMeaning?: string;
  events?: unknown[];
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  kept?: unknown;
  /** On each item of a list. */
  kind?: string;
  /** Absent when the game did not give it. On each item of a list. */
  massRaw?: number;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  personalBest?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  recipeId?: number;
  seen?: number;
  /** Absent when the game did not give it. On each item of a list. */
  sizeRaw?: number;
  /** Absent when the game did not give it. On each item of a list. */
  slotId?: number;
  /** Absent when the game did not give it. On each item of a list. */
  species?: string;
  /** Absent when the game did not give it. On each item of a list. */
  speciesRaw?: number;
  /** Absent when the game did not give it. */
  watching?: string;
  /** Absent when the game did not give it. On each item of a list. */
  what?: string;
  /** Absent when the game did not give it. On each item of a list. */
  who?: string;
}

/**
 * Keys the Crafting and fishing read `fishing` can carry, at any depth. Not the object's shape.
 */
export interface ReadingCraft_Fishing {
  class?: string;
  /** Absent when the game did not give it. */
  fishing?: Record<string, unknown>;
  fishingNote?: "empty is normal: nobody is fishing right now." | "players could not be read; this is not a result. Ask again.";
  /** On each item of a list. */
  hasComponent?: boolean;
  /** Absent when the game did not give it. */
  name?: string;
  /** Absent when the game did not give it. */
  onTheLine?: string;
  /** Type not readable from the source. */
  players?: unknown;
  /** Absent when the game did not give it. */
  profileId?: number;
  /** Type not readable from the source. */
  rods?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  state?: string;
  /** Absent when the game did not give it. */
  steamid?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  trophy?: unknown;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Crafting and fishing read `placements` can carry, at any depth. Not the object's shape.
 */
export interface ReadingCraft_Placements {
  /** Absent when the game did not give it. On each item of a list. */
  accumulatedQuality?: number;
  class?: string;
  distinctIds?: number;
  duplicateNote?: string;
  /** Absent when the game did not give it. */
  id?: number;
  /** On each item of a list. */
  index?: number;
  /** Absent when the game did not give it. On each item of a list. */
  ingredientClass?: string;
  /** Absent when the game did not give it. On each item of a list. */
  limiter?: string;
  /** Absent when the game did not give it. */
  limiterNote?: string;
  /** Absent when the game did not give it. */
  path?: string;
  placed?: number;
  /** Absent when the game did not give it. */
  placements?: unknown[];
  placementsNote?: "empty is normal: nobody is mid-way through building.";
  placing?: number;
  placingNote?: string;
  /** Absent when the game did not give it. */
  productClass?: string;
  /** Absent when the game did not give it. */
  progress?: number;
  provided?: number;
  /** Absent when the game did not give it. */
  recipe?: string;
  required?: number;
  slotCount?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  slots?: unknown;
  /** Absent when the game did not give it. */
  slotsTruncated?: boolean;
  /** Absent when the game did not give it. */
  slotsUnread?: number;
  /** Absent when the game did not give it. */
  state?: string;
  /** Absent when the game did not give it. */
  status?: string;
  /** Absent when the game did not give it. */
  statusRaw?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Damage at a point read `last` can carry, at any depth. Not the object's shape.
 */
export interface ReadingDamage_Last {
  /** Unit: ms. Absent when the game did not give it. */
  ageMs?: number;
}

/**
 * Keys the Damage at a point read `preview:<x>:<y>:<z>:<radius>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingDamage_Preview {
  animals?: number;
  /** Absent when the game did not give it. */
  creatureListTruncated?: boolean;
  /** Unit: cm. Absent when the game did not give it. */
  nearestPlayerCm?: number;
  /** Absent when the game did not give it. */
  needsPlayersWord?: boolean;
  notCounted?: unknown[];
  /** Absent when the game did not give it. */
  playerIdsUnreadable?: boolean;
  /** Absent when the game did not give it. */
  playerListTruncated?: boolean;
  players?: number;
  /** Absent when the game did not give it. */
  playersAwaitingCleanup?: number;
  /** Absent when the game did not give it. */
  playersCountedUnread?: number;
  /** Absent when the game did not give it. */
  playersReadAtWorldOrigin?: number;
  /** Absent when the game did not give it. */
  playerSteamIds?: unknown[];
  puppets?: number;
  /** Unit: cm. */
  radiusCm?: number;
  targetTypesCounted?: number;
  targetTypesInGame?: number;
  /** Absent when the game did not give it. */
  vehicleListTruncated?: boolean;
  vehicles?: number;
  /** Absent when the game did not give it. */
  vehiclesAwaitingCleanup?: number;
  /** Absent when the game did not give it. */
  vehiclesCountedUnread?: number;
  /** Absent when the game did not give it. */
  vehiclesReadAtWorldOrigin?: number;
  /** Absent when the game did not give it. */
  wouldFire?: boolean;
  /** Absent when the game did not give it. */
  wouldRefuse?: string;
  x?: number;
  y?: number;
  z?: number;
}

/**
 * Keys the Remove from the world read `here:<x>,<y>,<z>,<radius>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingDespawn_Here {
  actorsNotSurveyed?: boolean;
  /** On each item of a list. */
  allowed?: boolean;
  /** On each item of a list. */
  awaitingCleanup?: number;
  /** On each item of a list. */
  awaitingCleanupNote?: "already destroyed, awaiting cleanup; not in the world";
  /** Absent when the game did not give it. */
  buckets?: number;
  class?: string;
  /** On each item of a list. */
  count?: number;
  dist?: number;
  /** On each item of a list. */
  entityBacked?: boolean;
  /** Absent when the game did not give it. */
  error?: "bad_radius" | "malformed" | "scan_failed";
  id?: string;
  kinds?: unknown[];
  /** Absent when the game did not give it. */
  label?: string;
  /** Absent when the game did not give it. */
  labelGameSaid?: string;
  /** Absent when the game did not give it. */
  labelNote?: "the game's caption names another species; remove by label, not this";
  listedPerKind?: number;
  maxPerCall?: number;
  /** On each item of a list. */
  maxScan?: number;
  note?: "survey only; nothing was removed or changed";
  /** On each item of a list. */
  objects?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  objectsListed?: "partial";
  radius?: number;
  /** Absent when the game did not give it. */
  reason?: string;
  scope?: "loaded";
  scopeNote?: "counts only what is loaded near players; zero is not proof";
  /** On each item of a list. */
  skippedInUse?: number;
  sphere?: boolean;
  /** Absent when the game did not give it. */
  stowed?: boolean;
  /** On each item of a list. */
  switch?: string;
  /** On each item of a list. */
  unplaced?: number;
  /** On each item of a list. */
  unplacedNote?: "some positions did not read; a zero is not proof. Ask again.";
  /** On each item of a list. */
  via?: string;
  /** Absent when the game did not give it. On each item of a list. */
  wouldRefuse?: "player-owned object in range" | "scan truncated" | "too many";
  x?: number;
  y?: number;
  z?: number;
}

/**
 * Keys the Remove from the world read `kinds` can carry, at any depth. Not the object's shape.
 */
export interface ReadingDespawn_Kinds {
  /** On each item of a list. */
  accepts?: unknown[];
  actorEscapeHatchRefusesKindClasses?: boolean;
  allowed?: boolean;
  byEntityId?: "vehicle:<x>,<y>,<z>,<radius>:eid:<entity id>";
  byId?: "<kind>:<x>,<y>,<z>,<radius>:<index>.<serial>";
  ceilingsNote?: "a stored limit is not a whole number; the default is used. Fix the setting.";
  class?: "";
  confirmAppliesTo?: "sweep";
  confirmWord?: "CONFIRM";
  depth?: number;
  entityBacked?: boolean;
  id?: "actor=<ClassName>";
  idsFrom?: "preview";
  irreversible?: boolean;
  kind?: "mapsentry";
  kinds?: unknown[];
  labelled?: boolean;
  maxPerCall?: number;
  maxPerCallSaid?: string;
  maxPerCallSource?: string;
  maxRadius?: number;
  maxRadiusSaid?: string;
  maxRadiusSource?: string;
  maxScan?: number;
  registrationVerified?: boolean;
  /** Type not readable from the source. */
  requiresConfirm?: unknown;
  skipsInUse?: boolean;
  sphere?: boolean;
  stow?: Record<string, unknown>;
  survey?: "here:<x>,<y>,<z>,<radius>";
  switch?: "actors";
  verb?: "stow:<kind>:<x>,<y>,<z>,<radius>:<index>.<serial>";
  via?: "engine";
}

/**
 * Keys the Remove from the world read `preview:<kind>:<x>,<y>,<z>,<r>:<id>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingDespawn_Preview {
  allowed?: boolean;
  awaitingCleanup?: number;
  awaitingCleanupNote?: "already destroyed, awaiting cleanup; not in the world";
  class?: string;
  count?: number;
  countIsNotAnAnswer?: string;
  dist?: number;
  entityBacked?: boolean;
  /** Absent when the game did not give it. */
  error?: string;
  id?: string;
  irreversible?: boolean;
  kind?: string;
  /** Absent when the game did not give it. */
  label?: string;
  /** Absent when the game did not give it. */
  labelGameSaid?: string;
  /** Absent when the game did not give it. */
  labelNote?: "the game's caption names another species; remove by label, not this";
  maxPerCall?: number;
  objects?: unknown[];
  radius?: number;
  /** Absent when the game did not give it. */
  reason?: string;
  /** Type not readable from the source. */
  requiresConfirm?: unknown;
  scanCeiling?: number;
  scope?: "loaded";
  scopeNote?: "counts only what is loaded near players; zero is not proof";
  skippedInUse?: number;
  sphere?: boolean;
  /** Absent when the game did not give it. */
  stowed?: boolean;
  unplaced?: number;
  unplacedNote?: "some positions did not read; a zero is not proof. Ask again.";
  via?: string;
  /** Absent when the game did not give it. */
  wouldRefuse?: string;
  /** Absent when the game did not give it. */
  wouldRefuseReason?: string;
  x?: number;
  y?: number;
  z?: number;
}

/**
 * Keys the Door Shuffle read `classes` can carry, at any depth. Not the object's shape.
 */
export interface ReadingDoors_Classes {
  /** Absent when the game did not give it. On each item of a list. */
  class?: string;
  /** Absent when the game did not give it. On each item of a list. */
  doors?: number;
  /** Absent when the game did not give it. On each item of a list. */
  level?: string;
}

/**
 * Keys the Door Shuffle read `door:<Level>:<Actor>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingDoors_Door {
  /** Absent when the game did not give it. */
  access?: number;
  /** Absent when the game did not give it. */
  attachedItems?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  broken?: unknown;
  /** Absent when the game did not give it. */
  claimed?: boolean;
  class?: string;
  /** Absent when the game did not give it. */
  controlName?: string;
  /** Absent when the game did not give it. */
  doorType?: number;
  /** Absent when the game did not give it. */
  entityId?: number;
  key?: string;
  level?: string;
  /** Type not readable from the source. */
  locked?: unknown;
  /** Absent when the game did not give it. */
  maxLocks?: number;
  /** Absent when the game did not give it. */
  maxZappers?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  open?: unknown;
  /** Type not readable from the source. */
  openedByMod?: unknown;
  /** Absent when the game did not give it. */
  owner?: number;
  playerBuilt?: boolean;
  /** Absent when the game did not give it. Type not readable from the source. */
  special?: unknown;
  state?: Record<string, unknown>;
  /** Type not readable from the source. */
  stateFlagsVerified?: unknown;
  stateSource?: string;
  /** Type not readable from the source. */
  tracked?: unknown;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Door Shuffle read `levels` can carry, at any depth. Not the object's shape.
 */
export interface ReadingDoors_Levels {
  /** On each item of a list. */
  doors?: number;
  /** On each item of a list. */
  level?: string;
}

/**
 * Keys the Encounters and spawn waves read `bases` can carry, at any depth. Not the object's shape.
 */
export interface ReadingEncounters_Bases {
  /** On each item of a list. */
  active?: boolean;
  /** Unit: ms. On each item of a list. */
  ageMs?: number;
  /** On each item of a list. */
  baseId?: number;
  /** Type not readable from the source. */
  declared?: unknown;
  fired?: number;
  list?: unknown[];
  note?: string;
  resolved?: boolean;
  seen?: number;
}

/**
 * Keys the Encounters and spawn waves read `encounters` can carry, at any depth. Not the object's shape.
 */
export interface ReadingEncounters_Encounters {
  /** On each item of a list. */
  active?: boolean;
  /** Unit: ms. */
  ageMs?: number;
  /** Absent when the game did not give it. */
  asked?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  baseBuilding?: unknown;
  /** On each item of a list. */
  baseId?: number;
  bases?: Record<string, unknown>;
  classes?: unknown[];
  count?: number;
  /** Absent when the game did not give it. */
  declared?: boolean;
  /** Absent when the game did not give it. */
  dropped?: number;
  /** Absent when the game did not give it. */
  encounterClasses?: string;
  encounterTypes?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  encounterWeights?: unknown;
  examined?: number;
  fired?: number;
  flagRead?: number;
  /** Absent when the game did not give it. */
  flagUnreadable?: boolean;
  found?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  governedBy?: unknown;
  grouped?: number;
  groups?: unknown[];
  /** Absent when the game did not give it. */
  groupsTruncated?: boolean;
  /** Absent when the game did not give it. */
  historyLimit?: number;
  /** Absent when the game did not give it. */
  hordes?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  hordeTruncated?: boolean;
  /** Absent when the game did not give it. Type not readable from the source. */
  intervals?: unknown;
  kept?: number;
  list?: unknown[];
  /** Absent when the game did not give it. Type not readable from the source. */
  lowPlayerCount?: unknown;
  /** Absent when the game did not give it. */
  lowThreatZone?: string;
  max?: number;
  members?: number;
  min?: number;
  nearby?: Record<string, unknown>;
  /** Absent when the game did not give it. Type not readable from the source. */
  noise?: unknown;
  /** Absent when the game did not give it. */
  note?: string;
  radius?: number;
  resolved?: boolean;
  /** Absent when the game did not give it. */
  seen?: boolean | number;
  /** Absent when the game did not give it. */
  schedule?: Record<string, unknown>;
  source?: string;
  /** Absent when the game did not give it. */
  specialCooldownTag?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  strays?: unknown;
  /** Absent when the game did not give it. */
  stride?: number;
  total?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. */
  tuning?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  unplaced?: number;
  /** On each item of a list. */
  x?: number;
  /** On each item of a list. */
  y?: number;
  /** On each item of a list. */
  z?: number;
}

/**
 * Keys the Encounters and spawn waves read `hordes` can carry, at any depth. Not the object's shape.
 */
export interface ReadingEncounters_Hordes {
  /** On each item of a list. */
  count?: number;
  examined?: number;
  flagRead?: number;
  /** Absent when the game did not give it. */
  flagUnreadable?: boolean;
  found?: number;
  grouped?: number;
  groups?: unknown[];
  /** Absent when the game did not give it. */
  groupsTruncated?: boolean;
  /** Absent when the game did not give it. */
  hordeTruncated?: boolean;
  members?: number;
  radius?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. */
  unplaced?: number;
  /** On each item of a list. */
  x?: number;
  /** On each item of a list. */
  y?: number;
  /** On each item of a list. */
  z?: number;
}

/**
 * Keys the Encounters and spawn waves read `nearby` can carry, at any depth. Not the object's shape.
 */
export interface ReadingEncounters_Nearby {
  /** Unit: ms. */
  ageMs?: number;
  /** Absent when the game did not give it. */
  asked?: number;
  /** Absent when the game did not give it. */
  declared?: boolean;
  /** Absent when the game did not give it. */
  dropped?: number;
  kept?: number;
  list?: unknown[];
  /** Absent when the game did not give it. */
  note?: string;
  /** Absent when the game did not give it. */
  seen?: boolean;
  /** Absent when the game did not give it. */
  stride?: number;
  total?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** On each item of a list. */
  x?: number;
  /** On each item of a list. */
  y?: number;
  /** On each item of a list. */
  z?: number;
}

/**
 * Keys the Encounters and spawn waves read `places` can carry, at any depth. Not the object's shape.
 */
export interface ReadingEncounters_Places {
  /** Absent when the game did not give it. On each item of a list. */
  amountCurve?: boolean;
  /** On each item of a list. */
  asset?: string;
  assets?: unknown[];
  assetsUnreadable?: "the current spawn plan settings could not be read";
  /** Absent when the game did not give it. */
  baseAmountAlwaysZero?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  baseAmountMax?: number;
  /** Absent when the game did not give it. On each item of a list. */
  baseAmountMin?: number;
  /** Absent when the game did not give it. On each item of a list. */
  baseAmountUnreadable?: boolean;
  canChange?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  class?: string;
  /** Absent when the game did not give it. On each item of a list. */
  classUnreadable?: boolean;
  count?: number;
  /** Type not readable from the source. */
  encounters?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  extraPerPlayer?: number;
  halfExtent?: "cm-half-width";
  /** Absent when the game did not give it. On each item of a list. */
  halfX?: number;
  /** Absent when the game did not give it. On each item of a list. */
  halfY?: number;
  /** On each item of a list. */
  held?: boolean;
  hold?: "real-seconds";
  /** Unit: s. On each item of a list. */
  holdLeftSec?: number;
  chance?: "percent";
  /** Unit: %. Absent when the game did not give it. On each item of a list. */
  chancePercent?: number;
  /** Unit: s. Absent when the game did not give it. On each item of a list. */
  checkMaxSec?: number;
  /** Unit: s. Absent when the game did not give it. On each item of a list. */
  checkMinSec?: number;
  /** On each item of a list. */
  i?: number;
  interval?: "real-seconds";
  /** Absent when the game did not give it. */
  maxBaseAmount?: number;
  /** Unit: s. */
  maxHoldSec?: number;
  places?: unknown[];
  /** On each item of a list. */
  plan?: Record<string, unknown>;
  position?: "cm";
  /** Absent when the game did not give it. */
  positionsUnavailable?: string;
  /** Absent when the game did not give it. On each item of a list. */
  resolved?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  spawnsCharacters?: boolean;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  unit?: Record<string, unknown>;
  unreadable?: "what this kind of place can spawn could not be read";
  /** Absent when the game did not give it. On each item of a list. */
  usedBy?: number;
  /** Absent when the game did not give it. */
  verdictUnreadable?: string;
  /** Unit: %. Absent when the game did not give it. On each item of a list. */
  wasChancePercent?: number;
  /** Unit: s. Absent when the game did not give it. On each item of a list. */
  wasCheckMaxSec?: number;
  /** Unit: s. Absent when the game did not give it. On each item of a list. */
  wasCheckMinSec?: number;
  /** Absent when the game did not give it. On each item of a list. */
  weight?: number;
  /** Absent when the game did not give it. On each item of a list. */
  x?: number;
  /** Absent when the game did not give it. On each item of a list. */
  y?: number;
  /** Absent when the game did not give it. On each item of a list. */
  z?: number;
  /** Absent when the game did not give it. On each item of a list. */
  zone?: string;
}

/**
 * Keys the Encounters and spawn waves read `schedule` can carry, at any depth. Not the object's shape.
 */
export interface ReadingEncounters_Schedule {
  classes?: unknown[];
  count?: number;
  /** Absent when the game did not give it. */
  historyLimit?: number;
  /** Absent when the game did not give it. */
  note?: "'announced' counts idle event spots, not starts; 'current' is running.";
  /** Absent when the game did not give it. */
  truncated?: boolean;
}

/**
 * Keys the Encounters and spawn waves read `tuning` can carry, at any depth. Not the object's shape.
 */
export interface ReadingEncounters_Tuning {
  /** Absent when the game did not give it. Type not readable from the source. */
  baseBuilding?: unknown;
  /** Absent when the game did not give it. */
  encounterClasses?: string;
  encounterTypes?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  encounterWeights?: unknown;
  /** Absent when the game did not give it. Type not readable from the source. */
  governedBy?: unknown;
  /** Absent when the game did not give it. Type not readable from the source. */
  intervals?: unknown;
  /** Absent when the game did not give it. Type not readable from the source. */
  lowPlayerCount?: unknown;
  /** Absent when the game did not give it. */
  lowThreatZone?: string;
  max?: number;
  min?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  noise?: unknown;
  source?: string;
  /** Absent when the game did not give it. */
  specialCooldownTag?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  strays?: unknown;
}

/**
 * Keys the Live world read `bases` can carry, at any depth. Not the object's shape.
 */
export interface ReadingEntities_Bases {
  /** Absent when the game did not give it. On each item of a list. */
  b25?: number;
  /** Absent when the game did not give it. On each item of a list. */
  b50?: number;
  /** Absent when the game did not give it. On each item of a list. */
  b75?: number;
  /** On each item of a list. */
  elements?: number;
  /** Absent when the game did not give it. On each item of a list. */
  hp?: number;
  /** On each item of a list. */
  id?: number;
  /** Absent when the game did not give it. On each item of a list. */
  measured?: number;
  /** Absent when the game did not give it. On each item of a list. */
  worst?: number;
  /** On each item of a list. */
  x?: number;
  /** On each item of a list. */
  y?: number;
  /** On each item of a list. */
  z?: number;
}

/**
 * Keys the Live world read `entities` can carry, at any depth. Not the object's shape.
 */
export interface ReadingEntities_Entities {
  alive?: boolean;
  /** Absent when the game did not give it. */
  attachments?: unknown[];
  /** Absent when the game did not give it. */
  attachmentsTruncated?: number;
  /** Absent when the game did not give it. On each item of a list. */
  b25?: number;
  /** Absent when the game did not give it. On each item of a list. */
  b50?: number;
  /** Absent when the game did not give it. On each item of a list. */
  b75?: number;
  /** Absent when the game did not give it. */
  class?: string;
  /** Absent when the game did not give it. */
  ehi?: number;
  /** On each item of a list. */
  elements?: number;
  /** Absent when the game did not give it. */
  elo?: number;
  /** Absent when the game did not give it. On each item of a list. */
  empty?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  healable?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  health?: boolean | number;
  /** Absent when the game did not give it. */
  healthPoints?: number;
  /** Absent when the game did not give it. */
  hp?: number;
  /** Unit: ms. Absent when the game did not give it. */
  hpAgeMs?: number;
  /** Absent when the game did not give it. */
  hpSource?: "index" | "live";
  /** Absent when the game did not give it. On each item of a list. */
  i?: number;
  /** Absent when the game did not give it. */
  id?: number | string;
  /** Absent when the game did not give it. */
  idNote?: "'id' changes on restart; use eid:<elo> to keep it.";
  /** Absent when the game did not give it. On each item of a list. */
  indestructible?: boolean;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  inParts?: unknown;
  kind?: string;
  /** Absent when the game did not give it. On each item of a list. */
  label?: string;
  /** Absent when the game did not give it. */
  maxFromClassDefault?: number;
  /** Absent when the game did not give it. */
  maxFromSharedData?: number;
  /** Absent when the game did not give it. */
  maxHealth?: number;
  /** Absent when the game did not give it. On each item of a list. */
  measured?: number;
  /** Absent when the game did not give it. On each item of a list. */
  n?: string;
  /** Absent when the game did not give it. On each item of a list. */
  name?: string;
  /** Absent when the game did not give it. On each item of a list. */
  note?: "Always empty here. Use the Bases module for bases.";
  /** Absent when the game did not give it. */
  of?: string;
  /** Absent when the game did not give it. */
  parts?: unknown[];
  /** Absent when the game did not give it. */
  path?: string;
  placed?: boolean;
  /** Absent when the game did not give it. */
  properties?: string;
  /** Absent when the game did not give it. On each item of a list. */
  why?: "no health of its own, so left out of the average" | "the game declares this one indestructible, so it is left out of the condition average";
  /** Absent when the game did not give it. */
  worst?: number;
  /** Unit: ms. Absent when the game did not give it. */
  worstAgeMs?: number;
  x?: number;
  y?: number;
  z?: number;
}

/**
 * Keys the Live world read `entity:<id>,<property>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingEntities_Entity {
  alive?: boolean;
  /** Absent when the game did not give it. */
  attachments?: unknown[];
  /** Absent when the game did not give it. */
  attachmentsTruncated?: number;
  /** Absent when the game did not give it. */
  bitMask?: number;
  /** Absent when the game did not give it. */
  bytes?: number;
  /** Absent when the game did not give it. */
  cannotWrite?: "text inside a struct cannot be written safely";
  /** Absent when the game did not give it. */
  class?: string;
  /** Absent when the game did not give it. */
  ehi?: number;
  /** Absent when the game did not give it. */
  elo?: number;
  /** Absent when the game did not give it. On each item of a list. */
  empty?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  health?: number;
  /** Absent when the game did not give it. */
  healthPoints?: number;
  /** Absent when the game did not give it. */
  hp?: number;
  /** Unit: ms. Absent when the game did not give it. */
  hpAgeMs?: number;
  /** Absent when the game did not give it. */
  hpSource?: "index" | "live";
  /** Absent when the game did not give it. On each item of a list. */
  i?: number;
  id?: number;
  /** Absent when the game did not give it. */
  idNote?: "'id' changes on restart; use eid:<elo> to keep it.";
  /** Absent when the game did not give it. On each item of a list. */
  indestructible?: boolean;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  inParts?: unknown;
  inStruct?: string;
  kind?: string;
  /** Absent when the game did not give it. On each item of a list. */
  label?: string;
  /** Absent when the game did not give it. */
  length?: number;
  /** Absent when the game did not give it. */
  maxFromClassDefault?: number;
  /** Absent when the game did not give it. */
  maxFromSharedData?: number;
  /** Absent when the game did not give it. */
  maxHealth?: number;
  /** Absent when the game did not give it. */
  members?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  n?: string;
  /** Absent when the game did not give it. */
  name?: string;
  /** Absent when the game did not give it. */
  noReflectedMembers?: boolean;
  /** Absent when the game did not give it. */
  noScalar?: string;
  /** Absent when the game did not give it. */
  of?: string;
  /** Absent when the game did not give it. */
  parts?: unknown[];
  /** Absent when the game did not give it. */
  path?: string;
  placed?: boolean;
  /** Absent when the game did not give it. */
  points?: string;
  /** Absent when the game did not give it. */
  properties?: string;
  property?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  replicated?: unknown;
  /** Absent when the game did not give it. Type not readable from the source. */
  set?: unknown;
  /** Absent when the game did not give it. */
  setAs?: null | string;
  /** Absent when the game did not give it. */
  type?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  unrealSaves?: unknown;
  /** Absent when the game did not give it. */
  value?: number | string;
  /** Absent when the game did not give it. Type not readable from the source. */
  wholeByte?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  why?: "no health of its own, so left out of the average" | "the game declares this one indestructible, so it is left out of the condition average";
  /** Absent when the game did not give it. */
  worst?: number;
  /** Unit: ms. Absent when the game did not give it. */
  worstAgeMs?: number;
  x?: number;
  y?: number;
  z?: number;
}

/**
 * Keys the Live world read `kinds` can carry, at any depth. Not the object's shape.
 */
export interface ReadingEntities_Kinds {
  /** Absent when the game did not give it. On each item of a list. */
  healable?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  health?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  id?: string;
  /** Absent when the game did not give it. On each item of a list. */
  label?: string;
  /** Absent when the game did not give it. On each item of a list. */
  note?: "Always empty here. Use the Bases module for bases.";
}

/**
 * Keys the Live game events read `events:since:<seq>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingEvents_Events {
  /** Unit: ms. On each item of a list. */
  agoMs?: number;
  /** Absent when the game did not give it. On each item of a list. */
  class?: string;
  /** Type not readable from the source. */
  drained?: unknown;
  dropped?: number;
  droppedBeforeDrain?: number;
  droppedBeforeRead?: number;
  /** Absent when the game did not give it. On each item of a list. */
  event?: Record<string, unknown>;
  events?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  id?: string;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  inEvent?: unknown;
  /** On each item of a list. */
  kind?: string;
  /** Absent when the game did not give it. On each item of a list. */
  name?: string;
  note?: "Nothing new since the last read; the watches payload shows what is watched.";
  /** Absent when the game did not give it. On each item of a list. */
  run?: number;
  /** Absent when the game did not give it. On each item of a list. */
  s1?: string;
  /** Absent when the game did not give it. On each item of a list. */
  s2?: string;
  /** Absent when the game did not give it. On each item of a list. */
  s3?: string;
  /** On each item of a list. */
  seq?: number;
  /** Absent when the game did not give it. On each item of a list. */
  x?: number;
  /** Absent when the game did not give it. On each item of a list. */
  y?: number;
  /** Absent when the game did not give it. On each item of a list. */
  z?: number;
}

/**
 * Keys the Live game events read `peek` can carry, at any depth. Not the object's shape.
 */
export interface ReadingEvents_Peek {
  /** Unit: ms. On each item of a list. */
  agoMs?: number;
  /** Absent when the game did not give it. On each item of a list. */
  class?: string;
  /** Type not readable from the source. */
  drained?: unknown;
  dropped?: number;
  droppedBeforeDrain?: number;
  droppedBeforeRead?: number;
  /** Absent when the game did not give it. On each item of a list. */
  event?: Record<string, unknown>;
  events?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  id?: string;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  inEvent?: unknown;
  /** On each item of a list. */
  kind?: string;
  /** Absent when the game did not give it. On each item of a list. */
  name?: string;
  note?: "Nothing new since the last read; the watches payload shows what is watched.";
  /** Absent when the game did not give it. On each item of a list. */
  run?: number;
  /** Absent when the game did not give it. On each item of a list. */
  s1?: string;
  /** Absent when the game did not give it. On each item of a list. */
  s2?: string;
  /** Absent when the game did not give it. On each item of a list. */
  s3?: string;
  /** On each item of a list. */
  seq?: number;
  /** Absent when the game did not give it. On each item of a list. */
  x?: number;
  /** Absent when the game did not give it. On each item of a list. */
  y?: number;
  /** Absent when the game did not give it. On each item of a list. */
  z?: number;
}

/**
 * Keys the Live game events read `watches` can carry, at any depth. Not the object's shape.
 */
export interface ReadingEvents_Watches {
  /** On each item of a list. */
  attempts?: number;
  /** Unit: ms. Absent when the game did not give it. */
  countingForMs?: number;
  /** Type not readable from the source. */
  countingHasGaps?: unknown;
  /** On each item of a list. Type not readable from the source. */
  declared?: unknown;
  /** On each item of a list. */
  fired?: number;
  /** On each item of a list. */
  group?: string;
  /** On each item of a list. */
  kind?: string;
  /** Unit: ms. Absent when the game did not give it. On each item of a list. */
  lastFiredAgoMs?: number;
  neverFired?: number;
  notDeclared?: number;
  note?: "declared false means the game cannot report that kind; fired 0 just means it has not happened.";
  /** On each item of a list. */
  parameters?: number;
  /** On each item of a list. */
  recorded?: number;
  resolved?: number;
  /** On each item of a list. */
  state?: string;
  /** On each item of a list. Type not readable from the source. */
  switchedOn?: unknown;
  total?: number;
  unresolvable?: number;
  /** Unit: ms. Absent when the game did not give it. */
  watchedForMs?: number;
  watches?: unknown[];
}

/**
 * Keys the Gardens and crops read `farming` can carry, at any depth. Not the object's shape.
 */
export interface ReadingFarming_Farming {
  class?: string;
  count?: number;
  emptyMeaning?: string;
  /** Absent when the game did not give it. */
  gardenId?: number;
  gardens?: unknown[];
  gridHeight?: number;
  gridWidth?: number;
  /** Absent when the game did not give it. On each item of a list. */
  gridX?: number;
  /** Absent when the game did not give it. On each item of a list. */
  gridY?: number;
  growthRaw?: number;
  healthRaw?: number;
  /** On each item of a list. */
  index?: number;
  /** Absent when the game did not give it. */
  maxHealthPerSlot?: number;
  /** Absent when the game did not give it. */
  maxWaterLitersPerSlot?: number;
  note?: "Raw fields are game bytes; read the Percent fields and waterLiters instead.";
  planted?: number;
  plants?: unknown[];
  /** Type not readable from the source. */
  playersInWorld?: unknown;
  /** Absent when the game did not give it. */
  radius?: number;
  scales?: Record<string, unknown>;
  scope?: "loaded";
  scopeNote?: string;
  slots?: number;
  /** Absent when the game did not give it. */
  slotsTruncated?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  species?: string;
  /** Absent when the game did not give it. On each item of a list. */
  speciesName?: string;
  /** Absent when the game did not give it. */
  structureHealth?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  waterEncoding?: "ufloat16";
  waterExponentBias?: number;
  waterExponentBits?: number;
  waterMantissaBits?: number;
  weedIntensity?: number;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Gardens and crops read `garden:<id>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingFarming_Garden {
  class?: string;
  /** Absent when the game did not give it. */
  gardenId?: number;
  gridHeight?: number;
  gridWidth?: number;
  /** Absent when the game did not give it. On each item of a list. */
  gridX?: number;
  /** Absent when the game did not give it. On each item of a list. */
  gridY?: number;
  /** Unit: %. Absent when the game did not give it. Type not readable from the source. */
  growthPercent?: unknown;
  /** Absent when the game did not give it. */
  growthRaw?: number;
  /** Absent when the game did not give it. */
  growthScale?: number;
  /** Absent when the game did not give it. */
  healthRaw?: number;
  /** On each item of a list. */
  index?: number;
  /** Absent when the game did not give it. */
  maxHealthPerSlot?: number;
  /** Absent when the game did not give it. */
  maxWaterLitersPerSlot?: number;
  /** Absent when the game did not give it. */
  nextHarvestTimeRaw?: number;
  /** Absent when the game did not give it. */
  nextHarvestTimeSpecial?: string;
  /** Absent when the game did not give it. */
  nextHarvestTimeValue?: number;
  note?: "Raw fields are game bytes; read the Percent fields and waterLiters instead.";
  planted?: number;
  plants?: unknown[];
  /** Absent when the game did not give it. */
  radius?: number;
  /** Unit: %. */
  readyAtPercent?: number;
  scales?: Record<string, unknown>;
  slots?: number;
  /** Absent when the game did not give it. */
  slotsTruncated?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  species?: string;
  /** Absent when the game did not give it. On each item of a list. */
  speciesName?: string;
  /** Absent when the game did not give it. */
  stage?: string;
  /** Absent when the game did not give it. */
  stageRaw?: number;
  /** Absent when the game did not give it. */
  structureHealth?: number;
  waterEncoding?: "ufloat16";
  waterExponentBias?: number;
  waterExponentBits?: number;
  /** Absent when the game did not give it. */
  waterLiters?: number;
  waterMantissaBits?: number;
  /** Absent when the game did not give it. */
  waterRaw?: number;
  /** Absent when the game did not give it. */
  waterSpecial?: string;
  /** Absent when the game did not give it. */
  weedIntensity?: number;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Window and door barricades read `events` can carry, at any depth. Not the object's shape.
 */
export interface ReadingFortifications_Events {
  /** Unit: ms. On each item of a list. */
  agoMs?: number;
  /** Absent when the game did not give it. On each item of a list. */
  announcedAtOpening?: number;
  count?: number;
  /** Absent when the game did not give it. On each item of a list. */
  dataVersion?: number;
  /** Absent when the game did not give it. */
  droppedEvents?: number;
  events?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  health?: number;
  /** On each item of a list. */
  kind?: string;
  /** On each item of a list. */
  openingX?: number;
  /** On each item of a list. */
  openingY?: number;
  /** On each item of a list. */
  openingZ?: number;
  /** Absent when the game did not give it. On each item of a list. */
  owner?: number;
  window?: number;
  /** Absent when the game did not give it. On each item of a list. */
  x?: number;
  /** Absent when the game did not give it. On each item of a list. */
  y?: number;
  /** Absent when the game did not give it. On each item of a list. */
  z?: number;
}

/**
 * Keys the Window and door barricades read `fortifications` can carry, at any depth. Not the object's shape.
 */
export interface ReadingFortifications_Fortifications {
  /** Absent when the game did not give it. */
  attachedTo?: string;
  count?: number;
  fortifications?: unknown[];
  /** Absent when the game did not give it. */
  freshHealth?: number;
  /** Absent when the game did not give it. */
  hostX?: number;
  /** Absent when the game did not give it. */
  hostY?: number;
  /** Absent when the game did not give it. */
  hostZ?: number;
  /** Absent when the game did not give it. */
  minSkill?: string;
  /** Absent when the game did not give it. */
  minSkillLevel?: number;
  /** Absent when the game did not give it. */
  near?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  radius?: number;
  repair?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  repairsFromZero?: boolean;
  /** Absent when the game did not give it. */
  source?: "sweep";
  /** Absent when the game did not give it. */
  sweepUnreadable?: boolean;
  /** Absent when the game did not give it. */
  sweepUnreadableWhy?: string;
  /** Absent when the game did not give it. */
  templatesSkipped?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. */
  type?: string;
  /** Absent when the game did not give it. */
  withoutLiveOwner?: number;
  /** Absent when the game did not give it. */
  withoutPosition?: number;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Window and door barricades read `ledger` can carry, at any depth. Not the object's shape.
 */
export interface ReadingFortifications_Ledger {
  /** Absent when the game did not give it. On each item of a list. */
  announced?: number;
  barricadeCount?: number;
  /** On each item of a list. */
  barricades?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  clearedWholesale?: number;
  /** Absent when the game did not give it. On each item of a list. */
  destroyed?: number;
  destroyMatchedAsRelative?: number;
  destroyMatchedAsWorld?: number;
  destroyUnmatched?: number;
  /** Absent when the game did not give it. On each item of a list. */
  dropped?: number;
  /** Absent when the game did not give it. */
  droppedEvents?: number;
  /** Absent when the game did not give it. */
  droppedOpenings?: number;
  /** Absent when the game did not give it. */
  eventsWithoutPosition?: number;
  /** Unit: ms. */
  firstSeenAgoMs?: number;
  /** Absent when the game did not give it. */
  health?: number;
  /** On each item of a list. */
  known?: number;
  /** Unit: ms. On each item of a list. */
  lastEventAgoMs?: number;
  onlyWhatWasWatched?: boolean;
  openingCount?: number;
  openings?: unknown[];
  /** Absent when the game did not give it. */
  owner?: number;
  /** Absent when the game did not give it. On each item of a list. */
  partial?: boolean;
  /** Unit: ms. */
  updatedAgoMs?: number;
  /** Unit: ms. */
  watchingForMs?: number;
  x?: number;
  y?: number;
  z?: number;
}

/**
 * Keys the Window and door barricades read `near:<x>,<y>,<z>,<radius>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingFortifications_Near {
  /** Absent when the game did not give it. */
  attachedTo?: string;
  count?: number;
  fortifications?: unknown[];
  /** Absent when the game did not give it. */
  freshHealth?: number;
  /** Absent when the game did not give it. */
  hostX?: number;
  /** Absent when the game did not give it. */
  hostY?: number;
  /** Absent when the game did not give it. */
  hostZ?: number;
  /** Absent when the game did not give it. */
  near?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  radius?: number;
  /** Absent when the game did not give it. */
  source?: "sweep";
  /** Absent when the game did not give it. */
  sweepUnreadable?: boolean;
  /** Absent when the game did not give it. */
  sweepUnreadableWhy?: string;
  /** Absent when the game did not give it. */
  templatesSkipped?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. */
  type?: string;
  /** Absent when the game did not give it. */
  withoutLiveOwner?: number;
  /** Absent when the game did not give it. */
  withoutPosition?: number;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Window and door barricades read `openings` can carry, at any depth. Not the object's shape.
 */
export interface ReadingFortifications_Openings {
  /** Absent when the game did not give it. On each item of a list. */
  attachedTo?: string;
  /** Absent when the game did not give it. On each item of a list. */
  barricades?: number;
  /** Absent when the game did not give it. On each item of a list. */
  barricadesExceedOpenings?: boolean;
  /** Absent when the game did not give it. */
  barricadesOnListedPlaces?: number;
  /** Absent when the game did not give it. */
  barricadesStanding?: number;
  barricadesUnreadable?: boolean;
  barricadesUnreadableWhy?: string;
  /** Absent when the game did not give it. */
  barricadeWalkTruncated?: boolean;
  count?: number;
  /** On each item of a list. */
  fortifiable?: number;
  /** Absent when the game did not give it. */
  hostsWithoutMarkers?: number;
  /** Absent when the game did not give it. On each item of a list. */
  hostX?: number;
  /** Absent when the game did not give it. On each item of a list. */
  hostY?: number;
  /** Absent when the game did not give it. On each item of a list. */
  hostZ?: number;
  loadedWorldOnly?: boolean;
  /** Absent when the game did not give it. */
  markerListUnreadable?: number;
  /** On each item of a list. */
  markers?: number;
  /** Absent when the game did not give it. On each item of a list. */
  markersTruncated?: boolean;
  openingsFortifiable?: number;
  /** Absent when the game did not give it. */
  openingWalkUnreadable?: boolean;
  /** Absent when the game did not give it. */
  openingWalkUnreadableWhy?: string;
  places?: unknown[];
  placesWalked?: number;
  placesWithNoFortifiableOpening?: number;
  /** Absent when the game did not give it. */
  source?: "openings";
  /** Absent when the game did not give it. */
  templatesSkipped?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  types?: Record<string, unknown>;
  /** Only when the subtraction is a real number. Absent when the game did not give it. On each item of a list. */
  unbarricaded?: number;
  /** Absent when the game did not give it. */
  withoutLiveOwner?: number;
  /** Absent when the game did not give it. On each item of a list. */
  withoutType?: number;
}

/**
 * Keys the Window and door barricades read `owner:<profileId>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingFortifications_Owner {
  barricades?: unknown[];
  count?: number;
  /** Unit: ms. */
  firstSeenAgoMs?: number;
  /** Absent when the game did not give it. */
  health?: number;
  onlyWhatWasWatched?: boolean;
  /** On each item of a list. */
  openingX?: number;
  /** On each item of a list. */
  openingY?: number;
  /** On each item of a list. */
  openingZ?: number;
  openingZIsNotAltitude?: boolean;
  openingZNote?: string;
  /** Absent when the game did not give it. */
  owner?: number;
  /** Unit: ms. */
  updatedAgoMs?: number;
  /** Unit: ms. */
  watchingForMs?: number;
  x?: number;
  y?: number;
  z?: number;
}

/**
 * Keys the Move items read `last` can carry, at any depth. Not the object's shape.
 */
export interface ReadingGive_Last {
  /** Unit: ms. Absent when the game did not give it. */
  ageMs?: number;
  class?: string;
  confirmed?: number;
  /** Absent when the game did not give it. */
  entityHi?: number;
  /** Absent when the game did not give it. */
  entityLo?: number;
  /** Absent when the game did not give it. */
  entityPacked?: number;
  /** Where the item was BEFORE the move, floor, inventory, corpse or attachment. Absent when the game did not give it. */
  foundIn?: string;
  /** Absent when the game did not give it. */
  locationAfter?: number;
  /** Absent when the game did not give it. */
  locationBefore?: number;
  /** Absent when the game did not give it. */
  nowIn?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  refused?: unknown;
  result?: string;
  selected?: number;
  swept?: number;
  /** Type not readable from the source. */
  truncated?: unknown;
  verb?: string;
}

/**
 * Keys the Radiation and wetness read `exposure` can carry, at any depth. Not the object's shape.
 */
export interface ReadingHazard_Exposure {
  online?: number;
  players?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  radiationRate?: number;
  sampled?: number;
  /** On each item of a list. */
  steamId?: string;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** On each item of a list. */
  x?: number;
  /** On each item of a list. */
  y?: number;
  /** On each item of a list. */
  z?: number;
}

/**
 * Keys the Radiation and wetness read `get:<field>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingHazard_Get {
  after?: number;
  /** Unit: ms. */
  agoMs?: number;
  basis?: "declared";
  bounds?: "module";
  consumer?: string;
  /** Unit: ms. */
  delayMs?: number;
  /** Absent when the game did not give it. */
  effect?: string;
  group?: string;
  /** The one field an owner actually reads. */
  hint?: string;
  key?: string;
  max?: number;
  min?: number;
  needs?: "tune";
  observed?: Record<string, unknown>;
  owner?: string;
  persists?: boolean;
  propagates?: "server-only";
  /** Absent when the game did not give it. */
  rateAfter?: number;
  /** Absent when the game did not give it. */
  rateBefore?: number;
  sim?: "input";
  /** Absent when the game did not give it. */
  state?: string;
  type?: string;
  /** Omitted rather than defaulted: a field this build does not have must not read as zero. Absent when the game did not give it. */
  value?: null | number;
  wrote?: number;
}

/**
 * Keys the Radiation and wetness read `groups` can carry, at any depth. Not the object's shape.
 */
export interface ReadingHazard_Groups {
  /** On each item of a list. */
  bounds?: "module";
  fields?: unknown[];
  groups?: unknown[];
  /** On each item of a list. */
  hint?: string;
  /** On each item of a list. */
  key?: string;
  /** On each item of a list. */
  max?: number;
  /** On each item of a list. */
  min?: number;
  /** On each item of a list. */
  needs?: "zones";
  /** No verb writes a position; the frame itself IS established (see 'measure'). */
  reason?: "Zones cannot be moved; only rate, falloff, radius and noise can change.";
  writable?: boolean;
  zoneFields?: unknown[];
  zoneGeometry?: Record<string, unknown>;
}

/**
 * Keys the Radiation and wetness read `job` can carry, at any depth. Not the object's shape.
 */
export interface ReadingHazard_Job {
  busyUs?: number;
  /** Unit: ms. */
  elapsedMs?: number;
  id?: number;
  kind?: string;
  maxSliceUs?: number;
  /** Absent when the game did not give it. */
  note?: string;
  /** Absent when the game did not give it. */
  restored?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  result?: unknown;
  /** Absent when the game did not give it. */
  samplesTaken?: number;
  slices?: number;
  state?: string;
  /** Absent when the game did not give it. */
  stuck?: number;
  /** Absent when the game did not give it. */
  why?: string;
  zonesDone?: number;
  zonesInRange?: number;
  /** Absent when the game did not give it. */
  zonesToRestore?: number;
}

/**
 * Keys the Radiation and wetness read `measure:<zone index>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingHazard_Measure {
  busyUs?: number;
  /** Absent when the game did not give it. */
  complete?: boolean;
  count?: number;
  /** Unit: ms. */
  elapsedMs?: number;
  /** Absent when the game did not give it. On each item of a list. */
  epicenter?: Record<string, unknown>;
  /** Absent when the game did not give it. On each item of a list. */
  extents?: Record<string, unknown>;
  /** A zero-rate zone reading zero is not evidence about the frame either way, and must not be counted as any. Absent when the game did not give it. On each item of a list. */
  frame?: string;
  /** Absent when the game did not give it. */
  framesConfirmed?: number;
  /** Absent when the game did not give it. */
  framesLocalSpace?: number;
  /** Absent when the game did not give it. */
  framesTested?: number;
  /** Absent when the game did not give it. */
  framesWorldSpace?: number;
  /** Frame established: measure finds each zone's authored rate at transformOrigin+epicentre and nothing at the raw epicentre. Absent when the game did not give it. */
  geometryReason?: "Zone positions are read-only; run 'measure' to check them." | "Zones cannot be moved; only rate, falloff, radius and noise can change.";
  /** Said outright, once, because it is the fact an owner most needs and the one they would otherwise infer from an absence. */
  geometryWritable?: boolean;
  /** On each item of a list. */
  changed?: boolean;
  id?: number;
  /** On each item of a list. */
  index?: number;
  job?: Record<string, unknown>;
  jobNote?: "The measurement runs in the background; read 'job' for its result.";
  kind?: string;
  /** Absent when the game did not give it. */
  level?: string;
  /** Absent when the game did not give it. On each item of a list. */
  localPoint?: Record<string, unknown>;
  maxSliceUs?: number;
  /** Absent when the game did not give it. */
  measured?: boolean;
  /** Absent when the game did not give it. */
  measuredZones?: number;
  /** Absent when the game did not give it. */
  note?: string;
  /** On each item of a list. */
  overridden?: boolean;
  /** Absent when the game did not give it. */
  restored?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  result?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  rotationApplied?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  rotationVerdict?: string;
  /** Absent when the game did not give it. On each item of a list. */
  sampledAtEpicenter?: number;
  /** Absent when the game did not give it. On each item of a list. */
  sampledAtLocalPoint?: number;
  /** Absent when the game did not give it. On each item of a list. */
  sampledAtTranslationOnly?: number;
  /** Absent when the game did not give it. On each item of a list. */
  sampleDominatedByAnotherZone?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  sampleDominatedNote?: string;
  /** Absent when the game did not give it. On each item of a list. */
  sampledOutsideRadius?: number;
  /** Absent when the game did not give it. */
  samplesTaken?: number;
  slices?: number;
  /** Absent when the game did not give it. */
  startedAt?: number;
  state?: string;
  /** Absent when the game did not give it. */
  stuck?: number;
  /** Absent when the game did not give it. On each item of a list. */
  transformOrigin?: Record<string, unknown>;
  /** On each item of a list. */
  transformPresent?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  transformRotated?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  transformRotatedNote?: string;
  /** Absent when the game did not give it. On each item of a list. */
  translationOnlyPoint?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. */
  why?: string;
  /** Absent when the game did not give it. On each item of a list. */
  x?: number;
  /** Absent when the game did not give it. On each item of a list. */
  y?: number;
  /** Absent when the game did not give it. On each item of a list. */
  z?: number;
  /** Absent when the game did not give it. */
  zoneCount?: number;
  zones?: unknown[];
  zonesDone?: number;
  zonesInRange?: number;
  /** Absent when the game did not give it. */
  zonesToRestore?: number;
}

/**
 * Keys the Radiation and wetness read `state` can carry, at any depth. Not the object's shape.
 */
export interface ReadingHazard_State {
  after?: number;
  /** Unit: ms. */
  agoMs?: number;
  basis?: "declared";
  bounds?: "module";
  consumer?: string;
  /** Unit: ms. */
  delayMs?: number;
  /** Absent when the game did not give it. */
  effect?: string;
  fields?: unknown[];
  group?: string;
  /** The one field an owner actually reads. */
  hint?: string;
  key?: string;
  max?: number;
  min?: number;
  needs?: "tune";
  observed?: Record<string, unknown>;
  oracle?: string;
  owner?: string;
  /** Said once, in the payload, so nothing downstream has to work it out from the per-field labels. */
  persists?: boolean;
  pointers?: unknown[];
  propagates?: "server-only";
  radiationManager?: boolean;
  /** Absent when the game did not give it. */
  rateAfter?: number;
  /** Absent when the game did not give it. */
  rateBefore?: number;
  /** Said once, in the payload, so nothing downstream has to work it out from the per-field labels. */
  replicated?: boolean;
  /** Said once, in the payload, so nothing downstream has to work it out from the per-field labels. */
  resimulated?: boolean;
  /** On each item of a list. */
  set?: boolean;
  sim?: "input";
  /** Absent when the game did not give it. */
  state?: string;
  type?: string;
  /** Omitted rather than defaulted: a field this build does not have must not read as zero. Absent when the game did not give it. */
  value?: null | number;
  wetnessManager?: boolean;
  /** On each item of a list. */
  writable?: boolean;
  wrote?: number;
  /** Type not readable from the source. */
  zoneCount?: unknown;
}

/**
 * Keys the Radiation and wetness read `zones` can carry, at any depth. Not the object's shape.
 */
export interface ReadingHazard_Zones {
  /** Absent when the game did not give it. */
  complete?: boolean;
  count?: number;
  /** Absent when the game did not give it. On each item of a list. */
  epicenter?: Record<string, unknown>;
  /** Absent when the game did not give it. On each item of a list. */
  extents?: Record<string, unknown>;
  /** A zero-rate zone reading zero is not evidence about the frame either way, and must not be counted as any. Absent when the game did not give it. On each item of a list. */
  frame?: string;
  /** Absent when the game did not give it. */
  framesConfirmed?: number;
  /** Absent when the game did not give it. */
  framesLocalSpace?: number;
  /** Absent when the game did not give it. */
  framesTested?: number;
  /** Absent when the game did not give it. */
  framesWorldSpace?: number;
  /** Frame established: measure finds each zone's authored rate at transformOrigin+epicentre and nothing at the raw epicentre. Absent when the game did not give it. */
  geometryReason?: "Zone positions are read-only; run 'measure' to check them." | "Zones cannot be moved; only rate, falloff, radius and noise can change.";
  /** Said outright, once, because it is the fact an owner most needs and the one they would otherwise infer from an absence. */
  geometryWritable?: boolean;
  /** On each item of a list. */
  changed?: boolean;
  /** On each item of a list. */
  index?: number;
  /** Absent when the game did not give it. */
  level?: string;
  /** Absent when the game did not give it. On each item of a list. */
  localPoint?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  measured?: boolean;
  /** Absent when the game did not give it. */
  measuredZones?: number;
  /** On each item of a list. */
  overridden?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  rotationApplied?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  rotationVerdict?: string;
  /** Absent when the game did not give it. On each item of a list. */
  sampledAtEpicenter?: number;
  /** Absent when the game did not give it. On each item of a list. */
  sampledAtLocalPoint?: number;
  /** Absent when the game did not give it. On each item of a list. */
  sampledAtTranslationOnly?: number;
  /** Absent when the game did not give it. On each item of a list. */
  sampleDominatedByAnotherZone?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  sampleDominatedNote?: string;
  /** Absent when the game did not give it. On each item of a list. */
  sampledOutsideRadius?: number;
  /** Absent when the game did not give it. */
  samplesTaken?: number;
  /** Absent when the game did not give it. */
  startedAt?: number;
  /** Absent when the game did not give it. On each item of a list. */
  transformOrigin?: Record<string, unknown>;
  /** On each item of a list. */
  transformPresent?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  transformRotated?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  transformRotatedNote?: string;
  /** Absent when the game did not give it. On each item of a list. */
  translationOnlyPoint?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  x?: number;
  /** Absent when the game did not give it. On each item of a list. */
  y?: number;
  /** Absent when the game did not give it. On each item of a list. */
  z?: number;
  /** Absent when the game did not give it. */
  zoneCount?: number;
  zones?: unknown[];
}

/**
 * Keys the Live inventories read `attachjob` can carry, at any depth. Not the object's shape.
 */
export interface ReadingItems_Attachjob {
  /** Unit: ms. */
  ageMs?: number;
  code?: string;
  /** Absent when the game did not give it. */
  fitStep?: string;
  /** Type not readable from the source. */
  fitted?: unknown;
  /** Absent when the game did not give it. */
  gameSaid?: string;
  /** Absent when the game did not give it. */
  reasonCode?: string;
  scumRegistered?: boolean;
  /** Absent when the game did not give it. */
  spawned?: number;
  /** Absent when the game did not give it. */
  spawnStep?: string;
  /** Absent when the game did not give it. */
  state?: string;
  weapon?: number;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Live inventories read `attachments:eid:<id>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingItems_Attachments {
  attachments?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  bone?: string;
  class?: string;
  /** Absent when the game did not give it. */
  entityLo?: number;
  /** On each item of a list. Type not readable from the source. */
  free?: unknown;
  freeMounts?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  mount?: string;
  /** Absent when the game did not give it. On each item of a list. */
  mounted?: string;
  /** Absent when the game did not give it. On each item of a list. */
  mountedLo?: number;
  /** Absent when the game did not give it. On each item of a list. */
  on?: number;
  sockets?: unknown[];
  /** Absent when the game did not give it. */
  socketsRead?: boolean;
}

/**
 * Keys the Live inventories read `counts` can carry, at any depth. Not the object's shape.
 */
export interface ReadingItems_Counts {
  attachment?: number;
  corpse?: number;
  countsDestroyed?: boolean;
  floor?: number;
  inventory?: number;
  note?: "loaded items only; shows what a sweep costs, not a census";
  other?: number;
  scope?: "loaded";
  total?: number;
  truncated?: boolean;
  unknown?: number;
}

/**
 * Keys the Live inventories read `inventory:<steamid>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingItems_Inventory {
  /** Absent when the game did not give it. */
  adminVisible?: boolean;
  ammo?: number;
  /** Absent when the game did not give it. */
  ammoLive?: number;
  /** Absent when the game did not give it. */
  ammoMax?: number;
  /** Absent when the game did not give it. */
  ammoRatio?: number;
  attachments?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  bone?: string;
  /** Absent when the game did not give it. */
  canBeDropped?: boolean;
  /** Absent when the game did not give it. */
  canTakeInHands?: boolean;
  class?: string;
  /** Absent when the game did not give it. */
  condition?: number;
  count?: number;
  /** Absent when the game did not give it. */
  entityHi?: number;
  /** Absent when the game did not give it. */
  entityLo?: number;
  /** Absent when the game did not give it. */
  entityPacked?: number;
  /** Absent when the game did not give it. */
  expires?: number;
  /** Absent when the game did not give it. */
  found?: boolean;
  /** On each item of a list. Type not readable from the source. */
  free?: unknown;
  freeMounts?: unknown[];
  /** Absent when the game did not give it. */
  health?: number;
  /** Absent when the game did not give it. */
  items?: unknown[] | null;
  magazine?: string;
  /** Absent when the game did not give it. */
  maxHealth?: number;
  /** Absent when the game did not give it. On each item of a list. */
  mount?: string;
  /** Absent when the game did not give it. On each item of a list. */
  mounted?: string;
  /** Absent when the game did not give it. On each item of a list. */
  mountedLo?: number;
  /** Absent when the game did not give it. */
  omitted?: number;
  /** Absent when the game did not give it. On each item of a list. */
  on?: number;
  /** Absent when the game did not give it. On each item of a list. */
  quantity?: number;
  /** Absent when the game did not give it. */
  rarity?: string;
  /** Absent when the game did not give it. */
  rarityName?: string;
  scope?: "attachedOrOwned";
  scopeNote?: string;
  /** Absent when the game did not give it. */
  scumRegistered?: boolean;
  sockets?: unknown[];
  /** Absent when the game did not give it. */
  socketsRead?: boolean;
  /** Absent when the game did not give it. */
  spawnGroup?: string;
  /** Absent when the game did not give it. On each item of a list. */
  stack?: number;
  /** Type not readable from the source. */
  truncated?: unknown;
  truncatedBy?: string;
  /** Absent when the game did not give it. On each item of a list. */
  uses?: number;
  /** Absent when the game did not give it. */
  via?: string;
  /** Absent when the game did not give it. */
  weight?: number;
  /** Absent when the game did not give it. */
  weightSelf?: number;
  /** Absent when the game did not give it. */
  where?: string;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Live inventories read `last` can carry, at any depth. Not the object's shape.
 */
export interface ReadingItems_Last {
  /** Unit: ms. Absent when the game did not give it. */
  ageMs?: number;
  /** Type not readable from the source. */
  confirmed?: unknown;
  destroyed?: number;
  /** Absent when the game did not give it. */
  destroyPending?: boolean;
  /** Unit: ms. Absent when the game did not give it. */
  destroyPendingMs?: number;
  changed?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  refused?: unknown;
  result?: string;
}

/**
 * Keys the Live inventories read `near:<x>,<y>,<r>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingItems_Near {
  /** Absent when the game did not give it. */
  adminVisible?: boolean;
  ammo?: number;
  /** Absent when the game did not give it. */
  ammoLive?: number;
  /** Absent when the game did not give it. */
  ammoMax?: number;
  /** Absent when the game did not give it. */
  ammoRatio?: number;
  attachments?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  bone?: string;
  /** Absent when the game did not give it. */
  canBeDropped?: boolean;
  /** Absent when the game did not give it. */
  canTakeInHands?: boolean;
  class?: string;
  /** Absent when the game did not give it. */
  condition?: number;
  count?: number;
  /** Absent when the game did not give it. */
  entityHi?: number;
  /** Absent when the game did not give it. */
  entityLo?: number;
  /** Absent when the game did not give it. */
  entityPacked?: number;
  /** Absent when the game did not give it. */
  expires?: number;
  /** On each item of a list. Type not readable from the source. */
  free?: unknown;
  freeMounts?: unknown[];
  /** Absent when the game did not give it. */
  health?: number;
  items?: unknown[];
  magazine?: string;
  /** Absent when the game did not give it. */
  maxHealth?: number;
  /** Absent when the game did not give it. On each item of a list. */
  mount?: string;
  /** Absent when the game did not give it. On each item of a list. */
  mounted?: string;
  /** Absent when the game did not give it. On each item of a list. */
  mountedLo?: number;
  /** Absent when the game did not give it. */
  omitted?: number;
  /** Absent when the game did not give it. On each item of a list. */
  on?: number;
  /** Absent when the game did not give it. On each item of a list. */
  quantity?: number;
  /** Absent when the game did not give it. */
  rarity?: string;
  /** Absent when the game did not give it. */
  rarityName?: string;
  scope?: "loaded";
  scopeNote?: "only loaded items; with nobody nearby this reads empty";
  /** Absent when the game did not give it. */
  scumRegistered?: boolean;
  sockets?: unknown[];
  /** Absent when the game did not give it. */
  socketsRead?: boolean;
  /** Absent when the game did not give it. */
  spawnGroup?: string;
  /** Absent when the game did not give it. On each item of a list. */
  stack?: number;
  /** Type not readable from the source. */
  truncated?: unknown;
  truncatedBy?: string;
  /** Absent when the game did not give it. On each item of a list. */
  uses?: number;
  /** Absent when the game did not give it. */
  via?: string;
  /** Absent when the game did not give it. */
  weight?: number;
  /** Absent when the game did not give it. */
  weightSelf?: number;
  /** Absent when the game did not give it. */
  where?: string;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Live inventories read `traps` can carry, at any depth. Not the object's shape.
 */
export interface ReadingItems_Traps {
  /** Unit: s. Absent when the game did not give it. On each item of a list. */
  armedLifetimeSeconds?: number;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  buried?: unknown;
  /** On each item of a list. */
  class?: string;
  count?: number;
  /** Absent when the game did not give it. On each item of a list. */
  defuseAttemptsLeft?: number;
  destroyedRows?: number;
  /** Absent when the game did not give it. On each item of a list. */
  entityHi?: number;
  /** Absent when the game did not give it. On each item of a list. */
  entityLo?: number;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  lastTriggeredByProfileId?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  minDamageForTrigger?: number;
  /** Unit: s. Absent when the game did not give it. On each item of a list. */
  ownerlessLifetimeSeconds?: number;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  ownerProfileId?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  ownerUnread?: boolean;
  scope?: "loaded";
  scopeNote?: string;
  /** Absent when the game did not give it. On each item of a list. */
  scumRegistered?: boolean;
  traps?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  trapType?: string;
  /** Absent when the game did not give it. On each item of a list. */
  trigger?: string;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. */
  truncatedBy?: "list";
  /** Absent when the game did not give it. On each item of a list. */
  x?: number;
  /** Absent when the game did not give it. On each item of a list. */
  y?: number;
  /** Absent when the game did not give it. On each item of a list. */
  z?: number;
}

/**
 * Keys the Live inventories read `where:eid:<id>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingItems_Where {
  class?: string;
  /** Absent when the game did not give it. */
  command?: string;
  /** Absent when the game did not give it. */
  containerClass?: string;
  /** Absent when the game did not give it. */
  containerEntityLo?: number;
  /** Absent when the game did not give it. */
  contentsGrams?: number;
  destroy?: Record<string, unknown>;
  drop?: Record<string, unknown>;
  entityLo?: number;
  /** Absent when the game did not give it. */
  found?: boolean;
  /** Absent when the game did not give it. */
  module?: string;
  place?: string;
  /** Type not readable from the source. */
  ready?: unknown;
  /** Absent when the game did not give it. */
  reasonCode?: string;
  /** Absent when the game did not give it. */
  steamid?: string;
  /** Absent when the game did not give it. */
  why?: string;
}

/**
 * Keys the Killbox read `apex` can carry, at any depth. Not the object's shape.
 */
export interface ReadingKillbox_Apex {
  facilities?: unknown[];
  /** Absent when the game did not give it. */
  level?: string;
  purgeControl?: string;
  /** Absent when the game did not give it. */
  purgeEnd?: number;
  /** Absent when the game did not give it. */
  purgeSpan?: number;
  /** Absent when the game did not give it. */
  purgeStart?: number;
  /** Absent when the game did not give it. */
  state?: string;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Killbox read `killbox` can carry, at any depth. Not the object's shape.
 */
export interface ReadingKillbox_Killbox {
  /** Absent when the game did not give it. Type not readable from the source. */
  active?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  bunker?: string;
  /** Absent when the game did not give it. On each item of a list. */
  bunkerLink?: string;
  /** On each item of a list. */
  class?: string;
  config?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  difficultyConfigurations?: number;
  /** Absent when the game did not give it. */
  fieldScaleX?: number;
  /** Absent when the game did not give it. */
  fieldScaleY?: number;
  /** Absent when the game did not give it. */
  fieldScaleZ?: number;
  /** Absent when the game did not give it. */
  fieldX?: number;
  /** Absent when the game did not give it. */
  fieldY?: number;
  /** Absent when the game did not give it. */
  fieldZ?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  finale?: unknown;
  flags?: unknown[];
  /** Absent when the game did not give it. */
  hardSpawnPoints?: number;
  /** On each item of a list. Type not readable from the source. */
  hasC4?: unknown;
  /** On each item of a list. Type not readable from the source. */
  hasLocker?: unknown;
  killboxes?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  level?: string;
  /** Type not readable from the source. */
  locked?: unknown;
  near?: unknown[];
  nearCount?: number;
  nearFrom?: string;
  nearRadius?: number;
  /** Absent when the game did not give it. */
  nearUnreadable?: boolean;
  nearWatched?: number;
  /** Type not readable from the source. */
  open?: unknown;
  /** Absent when the game did not give it. */
  panicButtonX?: number;
  /** Absent when the game did not give it. */
  panicButtonY?: number;
  /** Absent when the game did not give it. */
  panicButtonZ?: number;
  /** Unit: s. Absent when the game did not give it. */
  remainingSeconds?: number;
  roomCount?: number;
  /** On each item of a list. */
  roomIndex?: number;
  rooms?: unknown[];
  /** Absent when the game did not give it. */
  roomsPackedNote?: string;
  /** Absent when the game did not give it. On each item of a list. */
  roomTag?: string;
  /** Absent when the game did not give it. */
  spawnedZombies?: number;
  /** Absent when the game did not give it. */
  spawnPoints?: number;
  /** Absent when the game did not give it. */
  target?: string;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. */
  unlockFailureAssistanceBonus?: number;
  x?: number;
  y?: number;
  z?: number;
}

/**
 * Keys the Live player data read `kills` can carry, at any depth. Not the object's shape.
 */
export interface ReadingLive_Kills {
  /** On each item of a list. */
  killer?: number;
  kills?: unknown[];
  note?: "empty is normal: nobody currently owes a revenge kill.";
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** On each item of a list. */
  victim?: number;
}

/**
 * Keys the Live player data read `players` can carry, at any depth. Not the object's shape.
 */
export interface ReadingLive_Players {
  /** Absent when the game did not give it. On each item of a list. */
  foliage?: number;
  /** Absent when the game did not give it. On each item of a list. */
  hitReact?: string;
  /** Absent when the game did not give it. On each item of a list. */
  inHands?: string;
  /** Absent when the game did not give it. On each item of a list. */
  inHandsEid?: number;
  /** On each item of a list. */
  level?: string;
  /** Type not readable from the source. */
  limit?: unknown;
  note?: "list cut at the limit; some players are missing. Report this.";
  pitch?: number;
  /** On each item of a list. */
  skill?: string;
  skills?: unknown[];
  spawnX?: number;
  spawnY?: number;
  spawnZ?: number;
  speed?: number;
  /** Absent when the game did not give it. On each item of a list. */
  squad?: string;
  /** Absent when the game did not give it. On each item of a list. */
  squadId?: number;
  /** On each item of a list. */
  steamid?: string;
  truncated?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  visibilityNote?: "0 to 1, higher is easier to see; 1.0 means not computed";
  vx?: number;
  vy?: number;
  vz?: number;
  x?: number;
  /** Absent when the game did not give it. On each item of a list. */
  xp?: number;
  y?: number;
  yaw?: number;
  z?: number;
}

/**
 * Keys the Live player data read `server` can carry, at any depth. Not the object's shape.
 */
export interface ReadingLive_Server {
  /** Absent when the game did not give it. Type not readable from the source. */
  bunkers?: unknown;
  /** Absent when the game did not give it. Type not readable from the source. */
  killRegistry?: unknown;
  /** Absent when the game did not give it. Type not readable from the source. */
  knownPlayers?: unknown;
  /** Absent when the game did not give it. */
  matchState?: string;
  note?: "the server is still starting; ask again in a moment.";
  /** Absent when the game did not give it. Type not readable from the source. */
  squads?: unknown;
}

/**
 * Keys the Live player data read `world` can carry, at any depth. Not the object's shape.
 */
export interface ReadingLive_World {
  note?: "all World groups are off; turn on the ones you want." | "weather is not ready yet; ask again in a moment.";
}

/**
 * Keys the Doors and locks read `locked:<level>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingLocks_Locked {
  /** Absent when the game did not give it. */
  access?: string;
  actor?: string;
  /** Absent when the game did not give it. */
  baseElementDoorId?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  brokenDown?: unknown;
  /** Absent when the game did not give it. */
  cap?: number;
  /** Absent when the game did not give it. */
  class?: string;
  /** Absent when the game did not give it. */
  controlName?: string;
  /** Absent when the game did not give it. */
  cut?: boolean;
  /** Absent when the game did not give it. */
  cutWhy?: string;
  doors?: unknown[];
  /** Absent when the game did not give it. */
  entityId?: number;
  /** Absent when the game did not give it. */
  filter?: "locked";
  /** Absent when the game did not give it. On each item of a list. */
  health?: number;
  /** Absent when the game did not give it. On each item of a list. */
  i?: number;
  /** Absent when the game did not give it. */
  level?: string;
  lockItems?: number;
  /** Absent when the game did not give it. */
  lockItemsTruncated?: boolean;
  locks?: unknown[];
  matched?: number;
  /** Absent when the game did not give it. */
  maxLocks?: number;
  /** Absent when the game did not give it. */
  maxZappers?: number;
  /** Absent when the game did not give it. */
  nearX?: number;
  /** Absent when the game did not give it. */
  nearY?: number;
  /** Absent when the game did not give it. */
  owner?: number;
  /** Absent when the game did not give it. */
  radius?: number;
  /** Absent when the game did not give it. */
  repAttachmentDetail?: unknown[];
  /** Absent when the game did not give it. */
  repAttachments?: number;
  /** Absent when the game did not give it. */
  repAttachmentsTruncated?: boolean;
  /** Absent when the game did not give it. */
  repLockDetail?: unknown[];
  /** Absent when the game did not give it. */
  repLocks?: number;
  /** Absent when the game did not give it. */
  repLocksTruncated?: boolean;
  reported?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  shouldOpen?: unknown;
  /** Absent when the game did not give it. Type not readable from the source. */
  special?: unknown;
  state?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  stateFlagsProblem?: string;
  stateFlagsVerified?: boolean;
  stateSource?: string;
  target?: string;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. */
  type?: string;
  /** Absent when the game did not give it. */
  upgradeSlots?: number;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Doors and locks read `locks:<level>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingLocks_Locks {
  /** Absent when the game did not give it. */
  access?: string;
  actor?: string;
  /** Absent when the game did not give it. */
  baseElementDoorId?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  brokenDown?: unknown;
  /** Absent when the game did not give it. */
  cap?: number;
  /** Absent when the game did not give it. */
  class?: string;
  /** Absent when the game did not give it. */
  controlName?: string;
  /** Absent when the game did not give it. */
  cut?: boolean;
  /** Absent when the game did not give it. */
  cutWhy?: string;
  doors?: unknown[];
  /** Absent when the game did not give it. */
  entityId?: number;
  /** Absent when the game did not give it. */
  filter?: "locked";
  /** Absent when the game did not give it. On each item of a list. */
  health?: number;
  /** Absent when the game did not give it. On each item of a list. */
  i?: number;
  /** Absent when the game did not give it. */
  level?: string;
  lockItems?: number;
  /** Absent when the game did not give it. */
  lockItemsTruncated?: boolean;
  locks?: unknown[];
  matched?: number;
  /** Absent when the game did not give it. */
  maxLocks?: number;
  /** Absent when the game did not give it. */
  maxZappers?: number;
  /** Absent when the game did not give it. */
  nearX?: number;
  /** Absent when the game did not give it. */
  nearY?: number;
  /** Absent when the game did not give it. */
  owner?: number;
  /** Absent when the game did not give it. */
  radius?: number;
  /** Absent when the game did not give it. */
  repAttachmentDetail?: unknown[];
  /** Absent when the game did not give it. */
  repAttachments?: number;
  /** Absent when the game did not give it. */
  repAttachmentsTruncated?: boolean;
  /** Absent when the game did not give it. */
  repLockDetail?: unknown[];
  /** Absent when the game did not give it. */
  repLocks?: number;
  /** Absent when the game did not give it. */
  repLocksTruncated?: boolean;
  reported?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  shouldOpen?: unknown;
  /** Absent when the game did not give it. Type not readable from the source. */
  special?: unknown;
  state?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  stateFlagsProblem?: string;
  stateFlagsVerified?: boolean;
  stateSource?: string;
  target?: string;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. */
  type?: string;
  /** Absent when the game did not give it. */
  upgradeSlots?: number;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Doors and locks read `near:<x>:<y>:<radius>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingLocks_Near {
  /** Absent when the game did not give it. */
  access?: string;
  actor?: string;
  /** Absent when the game did not give it. */
  baseElementDoorId?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  brokenDown?: unknown;
  /** Absent when the game did not give it. */
  cap?: number;
  /** Absent when the game did not give it. */
  class?: string;
  /** Absent when the game did not give it. */
  controlName?: string;
  /** Absent when the game did not give it. */
  cut?: boolean;
  /** Absent when the game did not give it. */
  cutWhy?: string;
  doors?: unknown[];
  /** Absent when the game did not give it. */
  entityId?: number;
  /** Absent when the game did not give it. */
  filter?: "locked";
  /** Absent when the game did not give it. On each item of a list. */
  health?: number;
  /** Absent when the game did not give it. On each item of a list. */
  i?: number;
  /** Absent when the game did not give it. */
  level?: string;
  lockItems?: number;
  /** Absent when the game did not give it. */
  lockItemsTruncated?: boolean;
  locks?: unknown[];
  matched?: number;
  /** Absent when the game did not give it. */
  maxLocks?: number;
  /** Absent when the game did not give it. */
  maxZappers?: number;
  /** Absent when the game did not give it. */
  nearX?: number;
  /** Absent when the game did not give it. */
  nearY?: number;
  /** Absent when the game did not give it. */
  owner?: number;
  /** Absent when the game did not give it. */
  radius?: number;
  /** Absent when the game did not give it. */
  repAttachmentDetail?: unknown[];
  /** Absent when the game did not give it. */
  repAttachments?: number;
  /** Absent when the game did not give it. */
  repAttachmentsTruncated?: boolean;
  /** Absent when the game did not give it. */
  repLockDetail?: unknown[];
  /** Absent when the game did not give it. */
  repLocks?: number;
  /** Absent when the game did not give it. */
  repLocksTruncated?: boolean;
  reported?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  shouldOpen?: unknown;
  /** Absent when the game did not give it. Type not readable from the source. */
  special?: unknown;
  state?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  stateFlagsProblem?: string;
  stateFlagsVerified?: boolean;
  stateSource?: string;
  target?: string;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. */
  type?: string;
  /** Absent when the game did not give it. */
  upgradeSlots?: number;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Doors and locks read `replication` can carry, at any depth. Not the object's shape.
 */
export interface ReadingLocks_Replication {
  /** Unit: ms. On each item of a list. */
  ageMs?: number;
  /** Absent when the game did not give it. */
  dataVersion?: number;
  /** Absent when the game did not give it. On each item of a list. */
  deltaX?: number;
  /** Absent when the game did not give it. On each item of a list. */
  deltaY?: number;
  /** Absent when the game did not give it. On each item of a list. */
  deltaZ?: number;
  /** Absent when the game did not give it. On each item of a list. */
  doorFound?: boolean;
  /** Absent when the game did not give it. */
  doorLocationZeroOrigin?: number;
  /** Absent when the game did not give it. On each item of a list. */
  doorX?: number;
  /** Absent when the game did not give it. On each item of a list. */
  doorY?: number;
  /** Absent when the game did not give it. On each item of a list. */
  doorZ?: number;
  /** Absent when the game did not give it. On each item of a list. */
  entityId?: number;
  /** Absent when the game did not give it. */
  events?: unknown[];
  kept?: number;
  /** Absent when the game did not give it. */
  note?: "Recorded from the game; the bridge never sends this update itself.";
  /** Absent when the game did not give it. */
  repDataEntityId?: number;
  /** Absent when the game did not give it. */
  resolved?: Record<string, unknown>;
  seen?: number;
  /** Absent when the game did not give it. On each item of a list. */
  sentX?: number;
  /** Absent when the game did not give it. On each item of a list. */
  sentY?: number;
  /** Absent when the game did not give it. On each item of a list. */
  sentZ?: number;
}

/**
 * Keys the Doors and locks read `saved` can carry, at any depth. Not the object's shape.
 */
export interface ReadingLocks_Saved {
  /** Absent when the game did not give it. */
  access?: string;
  /** Type not readable from the source. */
  actorsSeen?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  attachedEntityId?: number;
  /** Absent when the game did not give it. */
  attachmentCount?: number;
  /** Absent when the game did not give it. */
  attachments?: unknown[];
  attachmentsJoinedToAnActor?: number;
  /** Absent when the game did not give it. */
  attachmentsTruncated?: boolean;
  /** Absent when the game did not give it. */
  attempts?: number;
  /** Absent when the game did not give it. */
  attemptsLeft?: number;
  /** Absent when the game did not give it. */
  baseElementDoorId?: number;
  /** Absent when the game did not give it. On each item of a list. */
  class?: string;
  /** Absent when the game did not give it. On each item of a list. */
  combination?: number;
  /** Absent when the game did not give it. */
  crowbarDamage?: number;
  /** Absent when the game did not give it. */
  difficulty?: string;
  doors?: unknown[];
  doorsReported?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  famePointsRequired?: unknown;
  /** Absent when the game did not give it. Type not readable from the source. */
  forceUnlockable?: unknown;
  /** Unit: s. Absent when the game did not give it. */
  forceUnlockSeconds?: number;
  /** Absent when the game did not give it. On each item of a list. */
  health?: number;
  /** Absent when the game did not give it. */
  hp?: number;
  /** Absent when the game did not give it. On each item of a list. */
  i?: number;
  identity?: "baseElementDoorId";
  identityNote?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  ignoresLockProtection?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  liveClass?: string;
  /** Absent when the game did not give it. */
  lockCount?: number;
  /** Absent when the game did not give it. */
  lockIndex?: number;
  /** Absent when the game did not give it. */
  locks?: unknown[];
  /** Absent when the game did not give it. */
  locksTruncated?: boolean;
  noBaseElementDoorId?: number;
  /** Absent when the game did not give it. */
  owner?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  penaltyOnFailure?: unknown;
  /** Absent when the game did not give it. */
  pickBreaksAfterFailedPushes?: number;
  /** Unit: s. Absent when the game did not give it. */
  pickSeconds?: number;
  /** Type not readable from the source. */
  saveClassResolved?: unknown;
  /** Absent when the game did not give it. */
  savedCombination?: number;
  savesSeen?: number;
  /** Absent when the game did not give it. */
  savesSeenNote?: string;
  /** Absent when the game did not give it. On each item of a list. */
  scumRegistered?: boolean;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. */
  wheels?: number;
  withAttachments?: number;
  withLocks?: number;
}

/**
 * Keys the Loot tables read `files` can carry, at any depth. Not the object's shape.
 */
export interface ReadingLoot_Files {
  /** Absent when the game did not give it. */
  bytes?: number;
  /** Type not readable from the source. */
  exists?: unknown;
  files?: unknown[];
  holds?: string;
  /** Unit: s. Absent when the game did not give it. */
  changedAgoSec?: number;
  name?: string;
  path?: string;
}

/**
 * Keys the Medical state read `catalogue` can carry, at any depth. Not the object's shape.
 */
export interface ReadingMedical_Catalogue {
  /** Absent when the game did not give it. */
  assetManager?: boolean;
  count?: number;
  effects?: unknown[];
  /** Absent when the game did not give it. */
  emptyBecause?: string;
  fromAssetManager?: boolean;
  /** On each item of a list. */
  kind?: string;
  /** On each item of a list. */
  name?: string;
  playersRead?: number;
  source?: string;
}

/**
 * Keys the Medical state read `conditions:<steamid>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingMedical_Conditions {
  /** On each item of a list. */
  class?: string;
  count?: number;
  /** Absent when the game did not give it. */
  fieldsNotUnderstood?: number;
  /** Absent when the game did not give it. On each item of a list. */
  id?: number;
  /** Absent when the game did not give it. On each item of a list. */
  modifier?: number;
  /** On each item of a list. */
  name?: string;
  /** Absent when the game did not give it. */
  note?: "Nothing listed, which usually means the player has none.";
  /** Absent when the game did not give it. On each item of a list. */
  severity?: number;
  /** Absent when the game did not give it. On each item of a list. */
  severityMax?: number;
  source?: string;
  /** Absent when the game did not give it. On each item of a list. */
  state?: string;
  steamId?: string;
}

/**
 * Keys the Medical state read `deaths:since:<seq>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingMedical_Deaths {
  deaths?: unknown[];
  detectedWithin?: "1 second of the death";
  dropped?: number;
  harm?: string;
  impactSpeed?: "centimetres per second";
  latest?: number;
  secondsBefore?: string;
  severity?: string;
  source?: "poll";
  unit?: Record<string, unknown>;
}

/**
 * Keys the Medical state read `fields` can carry, at any depth. Not the object's shape.
 */
export interface ReadingMedical_Fields {
  /** Absent when the game did not give it. On each item of a list. */
  enum?: string;
  /** On each item of a list. */
  field?: string;
  fields?: unknown[];
  /** The wire word and the number this module would fall back to. Absent when the game did not give it. On each item of a list. */
  name?: string;
  /** On each item of a list. */
  role?: string;
  severity?: "set with the severity verb, not with set";
  /** On each item of a list. */
  type?: string;
  /** The wire word and the number this module would fall back to. Absent when the game did not give it. On each item of a list. */
  value?: number;
  /** Absent when the game did not give it. On each item of a list. */
  values?: unknown[];
  /** On each item of a list. Type not readable from the source. */
  writable?: unknown;
  /** On each item of a list. */
  zeroedByCure?: boolean;
}

/**
 * Keys the Medical state read `lastcure` can carry, at any depth. Not the object's shape.
 */
export interface ReadingMedical_Lastcure {
  /** On each item of a list. */
  after?: number;
  /** Unit: ms. */
  afterMs?: number;
  /** Unit: ms. */
  ageMs?: number;
  alreadyZero?: number;
  /** On each item of a list. */
  before?: number;
  /** Absent when the game did not give it. */
  cameBack?: number;
  didNotTake?: number;
  done?: boolean;
  due?: boolean;
  effects?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  gone?: boolean;
  /** Absent when the game did not give it. */
  heldZero?: number;
  hint?: "no cure has been run since the bridge started";
  /** On each item of a list. */
  id?: number;
  /** Absent when the game did not give it. On each item of a list. */
  later?: number;
  /** Absent when the game did not give it. On each item of a list. */
  laterKnown?: boolean;
  made?: boolean;
  matched?: number;
  /** On each item of a list. */
  measured?: boolean;
  /** On each item of a list. */
  name?: string;
  noMeasurement?: number;
  /** Absent when the game did not give it. */
  noMeasurementLater?: number;
  note?: string;
  player?: string;
  recheck?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  retired?: number;
  selector?: string;
  /** Absent when the game did not give it. */
  unreadable?: number;
  written?: number;
  zeroed?: number;
}

/**
 * Keys the Medical state read `lastchange` can carry, at any depth. Not the object's shape.
 */
export interface ReadingMedical_Lastchange {
  added?: unknown[];
  /** Unit: ms. */
  ageMs?: number;
  aimed?: boolean;
  command?: string;
  effect?: string;
  /** -1 rather than a count: the readback itself failed, which is not "they had none". */
  effectsAfter?: number;
  effectsBefore?: number;
  gameSaid?: string;
  hint?: string;
  made?: boolean;
  note?: "Run as the target player; observedChange shows whether their effects changed.";
  observedChange?: boolean;
  removed?: unknown[];
  sent?: boolean;
  target?: string;
  verb?: string;
  /** Kept beside the new name rather than replaced. */
  watching?: string;
}

/**
 * Keys the Medical state read `lastmeta` can carry, at any depth. Not the object's shape.
 */
export interface ReadingMedical_Lastmeta {
  /** Unit: ms. */
  ageMs?: number;
  /** On each item of a list. */
  agreed?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  asked?: number;
  /** Absent when the game did not give it. On each item of a list. */
  before?: number;
  /** On each item of a list. */
  command?: string;
  /** Three states, not two: confirmed, the game set its own figure, and nothing to compare the request against. On each item of a list. */
  comparable?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  gameSaid?: string;
  hint?: string;
  made?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  max?: number;
  /** Admin commands run as the target; the printed figure is the only read-back (live metabolism is not reachable by name). */
  note?: string;
  /** On each item of a list. */
  readBack?: boolean;
  /** On each item of a list. */
  sent?: boolean;
  steps?: unknown[];
  target?: string;
  /** Absent when the game did not give it. On each item of a list. */
  unit?: string;
  /** Absent when the game did not give it. On each item of a list. */
  value?: number;
  verb?: string;
}

/**
 * Keys the Medical state read `player:<steamid>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingMedical_Player {
  bandage?: number;
  /** Absent when the game did not give it. */
  boundPart?: string;
  effects?: unknown[];
  /** Absent when the game did not give it. */
  found?: boolean;
  /** Absent when the game did not give it. */
  id?: number;
  kind?: string;
  /** Type not readable from the source. */
  lifeThreatening?: unknown;
  name?: string;
  /** Absent when the game did not give it. */
  reason?: string;
  /** Absent when the game did not give it. */
  severity?: number;
  /** The game computes it every tick and stores it nowhere readable; only #ListBodyEffects run as the player shows it. */
  severityKnown?: boolean;
  /** Absent when the game did not give it. */
  severityMax?: number;
  /** The game computes it every tick and stores it nowhere readable; only #ListBodyEffects run as the player shows it. */
  severityNote?: string;
  /** The game never wrote the replicated MAXIMUM. */
  severityScaleKnown?: boolean;
  /** The game never wrote the replicated MAXIMUM. */
  severityScaleNote?: string;
  /** Absent when the game did not give it. */
  spawned?: boolean;
  /** Absent when the game did not give it. */
  stamina?: number;
  /** Absent when the game did not give it. */
  staminaNote?: string;
  steamid?: string;
  /** Absent when the game did not give it. */
  stomachFullnessByte?: number;
  /** Absent when the game did not give it. */
  tightness?: number;
  /** The bound is a real ceiling, not a hint, so a truncated answer says so. Absent when the game did not give it. */
  truncated?: boolean;
  /** Type not readable from the source. */
  usesSeverityForLifeThreat?: unknown;
}

/**
 * Keys the Medical state read `players` can carry, at any depth. Not the object's shape.
 */
export interface ReadingMedical_Players {
  bandage?: number;
  /** Absent when the game did not give it. */
  boundPart?: string;
  effects?: unknown[];
  found?: boolean;
  /** Absent when the game did not give it. */
  id?: number;
  kind?: string;
  /** Type not readable from the source. */
  lifeThreatening?: unknown;
  name?: string;
  /** Absent when the game did not give it. */
  severity?: number;
  /** The game computes it every tick and stores it nowhere readable; only #ListBodyEffects run as the player shows it. */
  severityKnown?: boolean;
  /** Absent when the game did not give it. */
  severityMax?: number;
  /** The game computes it every tick and stores it nowhere readable; only #ListBodyEffects run as the player shows it. */
  severityNote?: string;
  /** The game never wrote the replicated MAXIMUM. */
  severityScaleKnown?: boolean;
  /** The game never wrote the replicated MAXIMUM. */
  severityScaleNote?: string;
  /** Absent when the game did not give it. */
  spawned?: boolean;
  steamid?: string;
  /** Absent when the game did not give it. */
  stomachFullnessByte?: number;
  /** Absent when the game did not give it. */
  tightness?: number;
  /** The bound is a real ceiling, not a hint, so a truncated answer says so. Absent when the game did not give it. */
  truncated?: boolean;
  /** Type not readable from the source. */
  usesSeverityForLifeThreat?: unknown;
}

/**
 * Keys the Medical state read `severities:<steamid>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingMedical_Severities {
  /** On each item of a list. */
  class?: string;
  count?: number;
  /** Absent when the game did not give it. */
  fieldsNotUnderstood?: number;
  /** Absent when the game did not give it. On each item of a list. */
  id?: number;
  /** Absent when the game did not give it. On each item of a list. */
  modifier?: number;
  /** On each item of a list. */
  name?: string;
  /** Absent when the game did not give it. */
  note?: "Nothing listed, which usually means the player has none.";
  /** Absent when the game did not give it. On each item of a list. */
  severity?: number;
  /** Absent when the game did not give it. On each item of a list. */
  severityMax?: number;
  source?: string;
  /** Absent when the game did not give it. On each item of a list. */
  state?: string;
  steamId?: string;
}

/**
 * Keys the Medical state read `substances:<steamid>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingMedical_Substances {
  /** On each item of a list. */
  class?: string;
  count?: number;
  /** Absent when the game did not give it. */
  fieldsNotUnderstood?: number;
  /** Absent when the game did not give it. On each item of a list. */
  id?: number;
  /** Absent when the game did not give it. On each item of a list. */
  modifier?: number;
  /** On each item of a list. */
  name?: string;
  /** Absent when the game did not give it. */
  note?: "Nothing listed, which usually means the player has none.";
  /** Absent when the game did not give it. On each item of a list. */
  severity?: number;
  /** Absent when the game did not give it. On each item of a list. */
  severityMax?: number;
  source?: string;
  /** Absent when the game did not give it. On each item of a list. */
  state?: string;
  steamId?: string;
}

/**
 * Keys the Server notifications read `queue` can carry, at any depth. Not the object's shape.
 */
export interface ReadingNotify_Queue {
  class?: string;
  /** Absent when the game did not give it. */
  found?: boolean;
  /** Absent when the game did not give it. */
  chains?: number;
  note?: "Held for offline players. Sending a notification does not change this count; timeout is in seconds.";
  /** Absent when the game did not give it. */
  queued?: number;
  /** Absent when the game did not give it. */
  timeout?: number;
}

/**
 * Keys the Offline raid protection read `encounterBases` can carry, at any depth. Not the object's shape.
 */
export interface ReadingOffline_EncounterBases {
  /** Absent when the game did not give it. On each item of a list. */
  base?: number;
  count?: number;
  encounters?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  flags?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  flagsReadable?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  flagsTruncated?: boolean;
  note?: "Only bases with a live encounter are listed; a base can have several flags.";
  /** Absent when the game did not give it. */
  truncated?: boolean;
}

/**
 * Keys the Offline raid protection read `flag:<id>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingOffline_Flag {
  flag?: number;
  lastProtectionTimeChangedPacked?: number;
  note?: "Protected means listed; an entry can outlive its protection. sinceMs only when seen appearing.";
  protected?: boolean;
  /** Unit: ms. Absent when the game did not give it. */
  sinceMs?: number;
  /** Absent when the game did not give it. */
  sinceObserved?: boolean;
  /** Absent when the game did not give it. */
  truncated?: boolean;
}

/**
 * Keys the Offline raid protection read `changes` can carry, at any depth. Not the object's shape.
 */
export interface ReadingOffline_Changes {
  /** Unit: ms. On each item of a list. */
  ageMs?: number;
  baselineTaken?: boolean;
  dropped?: number;
  /** On each item of a list. */
  event?: string;
  /** Absent when the game did not give it. On each item of a list. */
  flag?: number;
  changes?: unknown[];
  kept?: number;
  /** On each item of a list. */
  lastProtectionTimeChangedPacked?: number;
  note?: "A gap is a missed read; a change after one may have happened during it.";
  /** Unit: ms. */
  pollMs?: number;
  /** On each item of a list. */
  previousLastProtectionTimeChangedPacked?: number;
  /** Absent when the game did not give it. On each item of a list. */
  reason?: string;
  watching?: boolean;
  why?: "Raid protection is off on this server. Changing that needs a restart.";
}

/**
 * Keys the Offline raid protection read `mode` can carry, at any depth. Not the object's shape.
 */
export interface ReadingOffline_Mode {
  /** Absent when the game did not give it. */
  agrees?: boolean;
  /** Absent when the game did not give it. */
  managerClass?: string;
  /** Absent when the game did not give it. */
  managerKind?: string;
  managerPresent?: boolean;
  /** Absent when the game did not give it. */
  mode?: string;
  modeNamesProblem?: string;
  modeNamesVerified?: boolean;
  note?: "Protection mode: 0 none, 1 offline, 2 flag-specific, 3 global. Type 0 has no manager.";
  /** Absent when the game did not give it. */
  raidProtectionType?: number;
  /** Absent when the game did not give it. */
  settingReadable?: boolean;
}

/**
 * Keys the Offline raid protection read `requests` can carry, at any depth. Not the object's shape.
 */
export interface ReadingOffline_Requests {
  /** Unit: ms. Absent when the game did not give it. On each item of a list. */
  ageMs?: number;
  /** Absent when the game did not give it. On each item of a list. */
  delay?: number;
  dropped?: number;
  /** Absent when the game did not give it. On each item of a list. */
  duration?: number;
  /** Absent when the game did not give it. On each item of a list. */
  flag?: number;
  note?: "Requests seen, not confirmed changes; see 'changes' for what moved.";
  requests?: unknown[];
  resetParams?: string;
  resolved?: boolean;
  setParams?: string;
  unit?: "seconds";
  unitNote?: "Delay and duration are in seconds, as sent.";
  /** Absent when the game did not give it. On each item of a list. */
  verb?: "reset" | "set";
  watching?: boolean;
  watchNote?: "'failed' means these requests cannot be recorded until a restart; report it.";
}

/**
 * Keys the Offline raid protection read `rules` can carry, at any depth. Not the object's shape.
 */
export interface ReadingOffline_Rules {
  flagSpecific?: Record<string, unknown>;
  /** Type not readable from the source. */
  global?: unknown;
  /** Absent when the game did not give it. */
  inForce?: string;
  key?: string;
  note?: "Values as the server holds them. '-' means unlimited for max protection time, disabled for the price.";
  offline?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  raidProtectionType?: number;
  setting?: string;
  /** Absent when the game did not give it. */
  settingReadable?: boolean;
  unread?: unknown[];
}

/**
 * Keys the Offline raid protection read `state` can carry, at any depth. Not the object's shape.
 */
export interface ReadingOffline_State {
  baselineTaken?: boolean;
  censusFailures?: number;
  count?: number;
  /** Absent when the game did not give it. */
  currentServerRealTimeInSyncs?: number;
  /** On each item of a list. */
  flag?: number;
  /** On each item of a list. */
  lastProtectionTimeChangedPacked?: number;
  managerClass?: string;
  managerKind?: string;
  note?: "An entry can outlive its protection; ask the protect module whether it is still running.";
  protections?: unknown[];
  /** Absent when the game did not give it. */
  serverUtcDayTimeAtServerStartup?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
}

/**
 * Keys the Placement check read `world` can carry, at any depth. Not the object's shape.
 */
export interface ReadingPlace_World {
  /** Absent when the game did not give it. */
  alongAxis?: "x" | "y";
  /** Absent when the game did not give it. */
  alongMax?: number;
  /** Absent when the game did not give it. */
  alongMin?: number;
  bounds?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  boundsNote?: string;
  /** Absent when the game did not give it. */
  elevation?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  gerstnerWaves?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  islandBoundsVolume?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  killZ?: number;
  /** Absent when the game did not give it. */
  killZNote?: "Anything below this z is destroyed; a player dies.";
  /** Absent when the game did not give it. */
  level?: string;
  /** Absent when the game did not give it. */
  limitAxis?: "x" | "y";
  /** Absent when the game did not give it. */
  limitMax?: number;
  /** Absent when the game did not give it. */
  limitMin?: number;
  /** Absent when the game did not give it. */
  mapAssets?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  mapLimits?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  max?: number;
  /** Absent when the game did not give it. */
  maxX?: number;
  /** Absent when the game did not give it. */
  maxY?: number;
  maxZ?: number;
  /** Absent when the game did not give it. */
  min?: number;
  /** Absent when the game did not give it. */
  minX?: number;
  /** Absent when the game did not give it. */
  minY?: number;
  minZ?: number;
  /** Absent when the game did not give it. */
  segments?: number;
  /** Absent when the game did not give it. */
  segmentsTruncated?: boolean;
  /** Absent when the game did not give it. */
  set?: boolean;
  /** Absent when the game did not give it. */
  south?: number;
  units?: "centimetres";
  /** Absent when the game did not give it. */
  valid?: boolean;
  /** Absent when the game did not give it. */
  west?: number;
  /** Absent when the game did not give it. */
  worldBounds?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  writable?: boolean;
}

/**
 * Keys the Fire, power and cooking read `cooking` can carry, at any depth. Not the object's shape.
 */
export interface ReadingPower_Cooking {
  containers?: number;
  cooking?: unknown[];
  /** Absent when the game did not give it. */
  cookQualityPacked?: number;
  /** Absent when the game did not give it. */
  cookTimeRaw?: number;
  count?: number;
  /** Absent when the game did not give it. */
  itemTagIndex?: number;
  progressNote?: string;
  /** Absent when the game did not give it. */
  recipe?: string;
  /** Absent when the game did not give it. */
  recipeCookingTemperature?: number;
  /** Absent when the game did not give it. */
  recipeCookingTime?: number;
  /** Absent when the game did not give it. */
  recipeName?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  recipeRequiresHeat?: unknown;
  /** On each item of a list. */
  slot?: number;
  /** Absent when the game did not give it. */
  targetCookTime?: number;
  /** Absent when the game did not give it. */
  temperatureRaw?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. */
  usageRaw?: number;
  /** Absent when the game did not give it. */
  utilityType?: string;
  /** Absent when the game did not give it. On each item of a list. */
  x?: number;
  /** Absent when the game did not give it. On each item of a list. */
  y?: number;
  /** Absent when the game did not give it. On each item of a list. */
  z?: number;
}

/**
 * Keys the Fire, power and cooking read `heat` can carry, at any depth. Not the object's shape.
 */
export interface ReadingPower_Heat {
  /** Absent when the game did not give it. */
  atWorldOrigin?: boolean;
  /** Absent when the game did not give it. Type not readable from the source. */
  availableForCooking?: unknown;
  burners?: unknown[];
  class?: string;
  count?: number;
  fuelMassNote?: string;
  heatSources?: unknown[];
  kind?: string;
  loadedOnly?: boolean;
  loadedOnlyNote?: "only fires loaded near a player are listed; empty means none loaded, not none on the server";
  seen?: number;
  /** Absent when the game did not give it. */
  temperatureRaw?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  x?: number;
  y?: number;
  z?: number;
}

/**
 * Keys the Fire, power and cooking read `power` can carry, at any depth. Not the object's shape.
 */
export interface ReadingPower_Power {
  /** Absent when the game did not give it. */
  atWorldOrigin?: boolean;
  /** Absent when the game did not give it. */
  cell?: string;
  class?: string;
  classConfigNote?: string;
  devices?: unknown[];
  /** Absent when the game did not give it. */
  drainRateNormalized?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  drawing?: unknown;
  /** Absent when the game did not give it. */
  emDisabledFor?: number;
  /** Absent when the game did not give it. */
  fuel?: number;
  /** Absent when the game did not give it. */
  fuelMax?: number;
  /** Absent when the game did not give it. */
  fuelRatio?: number;
  /** Absent when the game did not give it. */
  fuelType?: string;
  generators?: unknown[] | number;
  /** Absent when the game did not give it. */
  has?: number;
  /** Absent when the game did not give it. */
  chargeRatio?: number;
  /** Absent when the game did not give it. */
  intensityRaw?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  interactionsDisabled?: unknown;
  lightPowerNote?: string;
  lights?: unknown[] | number;
  /** Absent when the game did not give it. */
  load?: number;
  loadedOnly?: boolean;
  loadedOnlyNote?: string;
  /** Absent when the game did not give it. */
  needs?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  on?: unknown;
  /** Absent when the game did not give it. */
  power?: number | Record<string, unknown>;
  /** Absent when the game did not give it. */
  resource?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  running?: unknown;
  seen?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  supply?: number;
  /** Absent when the game did not give it. */
  supplyAvailable?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  x?: number;
  y?: number;
  z?: number;
}

/**
 * Keys the Raid protection control read `calls` can carry, at any depth. Not the object's shape.
 */
export interface ReadingProtect_Calls {
  /** Absent when the game did not give it. On each item of a list. */
  activeAfter?: boolean;
  /** Bit 30 either side, spelled out rather than left for a caller to shift out of the raw word. Absent when the game did not give it. On each item of a list. */
  activeBefore?: boolean;
  /** Unit: ms. Absent when the game did not give it. On each item of a list. */
  ageMs?: number;
  calls?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  delay?: number;
  delayIsStartCountdown?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  dispatched?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  duration?: number;
  /** Absent when the game did not give it. On each item of a list. */
  flag?: number;
  /** Absent when the game did not give it. On each item of a list. */
  inActiveListAfter?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  inActiveListBefore?: boolean;
  /** On each item of a list. */
  lastChangedPackedAfter?: number;
  /** On each item of a list. */
  lastChangedPackedBefore?: number;
  maxValue?: number;
  note?: "Dispatched means sent to the game, not confirmed. Times are in seconds.";
  /** Absent when the game did not give it. On each item of a list. */
  packedAfter?: number;
  /** Absent when the game did not give it. On each item of a list. */
  packedBefore?: number;
  /** Absent when the game did not give it. On each item of a list. */
  protectedAfter?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  protectedBefore?: boolean;
  scopeNote?: string;
  /** On each item of a list. */
  serverTimeInSyncsAfter?: number;
  /** On each item of a list. */
  serverTimeInSyncsBefore?: number;
  snapshot?: boolean;
  unit?: "seconds";
  unitsVerified?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  verb?: string;
}

/**
 * Keys the Raid protection control read `flag:<id>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingProtect_Flag {
  active?: boolean;
  count?: number;
  /** Unit: s. Absent when the game did not give it. */
  durationSeconds?: number;
  flag?: number;
  /** Absent when the game did not give it. */
  forever?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  inActiveList?: boolean;
  lastChangedPacked?: number;
  /** Absent when the game did not give it. */
  managerClass?: string;
  managerPresent?: boolean;
  /** Absent when the game did not give it. */
  note?: string;
  packed?: number;
  /** Absent when the game did not give it. On each item of a list. */
  protected?: boolean;
  protections?: unknown[];
  /** Absent when the game did not give it. */
  scopeNote?: string;
  serverTimeInSyncs?: number;
  serverUtcDayAtStartup?: number;
  /** Unit: s. Absent when the game did not give it. */
  startSeconds?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
}

/**
 * Keys the Raid protection control read `changes` can carry, at any depth. Not the object's shape.
 */
export interface ReadingProtect_Changes {
  active?: boolean;
  /** Unit: s. Absent when the game did not give it. */
  durationSeconds?: number;
  flag?: number;
  /** Absent when the game did not give it. */
  forever?: boolean;
  gained?: unknown[];
  lastChangedPacked?: number;
  lost?: unknown[];
  /** Absent when the game did not give it. */
  managerClass?: string;
  managerPresent?: boolean;
  moved?: unknown[];
  note?: string;
  packed?: number;
  serverTimeInSyncs?: number;
  serverUtcDayAtStartup?: number;
  /** Unit: ms. */
  snapshotAgeMs?: number;
  snapshotCount?: number;
  snapshotServerTimeInSyncs?: number;
  /** Unit: s. Absent when the game did not give it. */
  startSeconds?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** On each item of a list. */
  wasLastChangedPacked?: number;
  /** On each item of a list. */
  wasPacked?: number;
}

/**
 * Keys the Raid protection control read `layout` can carry, at any depth. Not the object's shape.
 */
export interface ReadingProtect_Layout {
  active?: number;
  canArm?: boolean;
  duration?: number;
  entries?: number;
  entriesProven?: number;
  changedAt?: number;
  /** Absent when the game did not give it. */
  layout?: string;
  managerClass?: string;
  mode?: number;
  /** Absent when the game did not give it. */
  note?: string;
  offsets?: Record<string, unknown>;
  start?: number;
  stride?: number;
}

/**
 * Keys the Raid protection control read `manager` can carry, at any depth. Not the object's shape.
 */
export interface ReadingProtect_Manager {
  /** The KIND travels with the name. On each item of a list. */
  bytes?: number;
  /** Absent when the game did not give it. */
  count?: number;
  /** Absent when the game did not give it. */
  entryStructBytes?: number;
  entryStructMembers?: unknown[];
  /** Absent when the game did not give it. */
  entryStructResolved?: boolean;
  /** On each item of a list. */
  kind?: string;
  /** Absent when the game did not give it. */
  managerClass?: string;
  managerPresent?: boolean;
  /** The KIND travels with the name. On each item of a list. */
  name?: string;
  note?: "One sync is one real minute since the world started.";
  serverTimeInSyncs?: number;
  serverUtcDayAtStartup?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
}

/**
 * Keys the Raid protection control read `offline:<id>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingProtect_Offline {
  armed?: boolean;
  /** Unit: s. Absent when the game did not give it. */
  durationSeconds?: number;
  /** Unit: s. Absent when the game did not give it. */
  endsInSeconds?: number;
  entriesProven?: number;
  flag?: number;
  layout?: string;
  layoutProven?: boolean;
  managerClass?: string;
  note?: "Live, in seconds. Not armed means an owner or squadmate is online.";
  /** Absent when the game did not give it. Type not readable from the source. */
  over?: unknown;
  /** Absent when the game did not give it. Type not readable from the source. */
  running?: unknown;
  /** Unit: s. Absent when the game did not give it. */
  serverRealTimeSeconds?: number;
  /** Unit: s. Absent when the game did not give it. */
  startsInSeconds?: number;
}

/**
 * Keys the Raid protection control read `protections` can carry, at any depth. Not the object's shape.
 */
export interface ReadingProtect_Protections {
  active?: boolean;
  count?: number;
  /** Unit: s. Absent when the game did not give it. */
  durationSeconds?: number;
  flag?: number;
  /** Absent when the game did not give it. */
  forever?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  inActiveList?: boolean;
  lastChangedPacked?: number;
  /** Absent when the game did not give it. */
  managerClass?: string;
  managerPresent?: boolean;
  /** Absent when the game did not give it. */
  note?: string;
  packed?: number;
  /** Absent when the game did not give it. On each item of a list. */
  protected?: boolean;
  protections?: unknown[];
  /** Absent when the game did not give it. */
  scopeNote?: string;
  serverTimeInSyncs?: number;
  serverUtcDayAtStartup?: number;
  /** Unit: s. Absent when the game did not give it. */
  startSeconds?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
}

/**
 * Keys the Quests read `activity` can carry, at any depth. Not the object's shape.
 */
export interface ReadingQuests_Activity {
  /** Unit: ms. On each item of a list. */
  ageMs?: number;
  /** Absent when the game did not give it. On each item of a list. */
  count?: number;
  dropped?: number;
  /** On each item of a list. */
  event?: string;
  events?: unknown[];
  idKindsNote?: "Task requests carry task ids; every other event carries quest ids.";
  /** Absent when the game did not give it. On each item of a list. */
  idsTruncated?: boolean;
  kept?: number;
  matched?: number;
  /** Absent when the game did not give it. On each item of a list. */
  nextResetRaw?: number;
  note?: "questId is the game's tracking id; its quest name is not known live.";
  player?: string;
  /** Absent when the game did not give it. On each item of a list. */
  questId?: number;
  /** Absent when the game did not give it. On each item of a list. */
  questIds?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  questIndex?: number;
  requestNote?: "Request events are what a player asked for; an outcome may never follow.";
  requests?: boolean;
  savedNote?: "The save holds which quest an id is and its objective progress.";
  seen?: number;
  /** Absent when the game did not give it. On each item of a list. */
  steamId?: string;
  /** Absent when the game did not give it. On each item of a list. */
  trackKindRaw?: number;
  unattributed?: number;
  unattributedNote?: "These events could not be matched to a player.";
  watching?: boolean;
}

/**
 * Keys the Quests read `areas` can carry, at any depth. Not the object's shape.
 */
export interface ReadingQuests_Areas {
  /** Absent when the game did not give it. On each item of a list. */
  areaCount?: number;
  /** Absent when the game did not give it. On each item of a list. */
  areas?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  areasTruncated?: boolean;
  count?: number;
  emptyMeaning?: string;
  groups?: unknown[];
  /** On each item of a list. */
  name?: string;
  /** Absent when the game did not give it. On each item of a list. */
  radius?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  x?: number;
  /** Absent when the game did not give it. On each item of a list. */
  y?: number;
  /** Absent when the game did not give it. On each item of a list. */
  z?: number;
}

/**
 * Keys the Quests read `catalogue` can carry, at any depth. Not the object's shape.
 */
export interface ReadingQuests_Catalogue {
  /** Absent when the game did not give it. On each item of a list. */
  amount?: number;
  /** Absent when the game did not give it. */
  cachedNetIndex?: number;
  /** Absent when the game did not give it. On each item of a list. */
  caption?: string;
  /** Absent when the game did not give it. On each item of a list. */
  circularArea?: string;
  /** On each item of a list. */
  circularAreaGroup?: string;
  class?: string;
  /** On each item of a list. */
  condition?: string;
  count?: number;
  /** Absent when the game did not give it. On each item of a list. */
  currency?: unknown[] | string;
  /** Absent when the game did not give it. On each item of a list. */
  currencyRaw?: number;
  /** Absent when the game did not give it. */
  descriptionSegments?: number;
  /** Absent when the game did not give it. On each item of a list. */
  dialogueOnCompletion?: string;
  /** Absent when the game did not give it. On each item of a list. */
  fame?: number;
  /** Absent when the game did not give it. */
  giverClass?: string;
  /** On each item of a list. */
  index?: number;
  /** Absent when the game did not give it. On each item of a list. */
  itemCount?: number;
  /** Absent when the game did not give it. On each item of a list. */
  items?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  itemsTruncated?: boolean;
  /** Absent when the game did not give it. */
  limitedToX?: number;
  /** Absent when the game did not give it. */
  limitedToY?: number;
  /** Absent when the game did not give it. */
  limitedToZ?: number;
  /** Absent when the game did not give it. On each item of a list. */
  limitToAreaCount?: number;
  /** Absent when the game did not give it. On each item of a list. */
  mapMarkers?: number;
  /** Absent when the game did not give it. */
  name?: string;
  netIndex?: number;
  note?: "Match quests by name; a missing title has not loaded yet.";
  objectiveList?: unknown[];
  /** Absent when the game did not give it. */
  objectives?: number;
  /** Absent when the game did not give it. */
  objectivesTruncated?: boolean;
  /** On each item of a list. */
  option?: number;
  quests?: unknown[];
  /** Absent when the game did not give it. */
  rewardOptions?: number;
  rewards?: unknown[];
  rewardsNote?: "Skill experience rewards are counted only, not named or sized.";
  /** Absent when the game did not give it. On each item of a list. */
  sequenceIndex?: number;
  /** Absent when the game did not give it. On each item of a list. */
  skillExperienceEntries?: number;
  /** Absent when the game did not give it. On each item of a list. */
  skillExperienceNamed?: boolean;
  /** Absent when the game did not give it. */
  steamStatUnlocks?: number;
  /** Absent when the game did not give it. */
  tier?: number;
  /** Absent when the game did not give it. */
  timeLimitRaw?: number;
  /** Absent when the game did not give it. */
  title?: string;
  /** Absent when the game did not give it. */
  truncated?: boolean;
}

/**
 * Keys the Quests read `givers` can carry, at any depth. Not the object's shape.
 */
export interface ReadingQuests_Givers {
  /** On each item of a list. */
  class?: string;
  count?: number;
  emptyMeaning?: string;
  /** Type not readable from the source. */
  giverIndex?: unknown;
  /** Absent when the game did not give it. */
  giverIndexCount?: number;
  givers?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  netIndex?: number;
  /** Type not readable from the source. */
  playersInWorld?: unknown;
  scope?: "loaded";
  scopeNote?: "Only givers in loaded areas are listed.";
  /** Absent when the game did not give it. On each item of a list. */
  sectorSelection?: string;
  /** Absent when the game did not give it. On each item of a list. */
  sectorSelectionRaw?: number;
  /** Absent when the game did not give it. On each item of a list. */
  sourceActorClass?: string;
  /** Absent when the game did not give it. */
  templatesSkipped?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  uniqueId?: number;
  /** Absent when the game did not give it. On each item of a list. */
  x?: number;
  /** Absent when the game did not give it. On each item of a list. */
  y?: number;
  /** Absent when the game did not give it. On each item of a list. */
  z?: number;
}

/**
 * Keys the Quests read `outposts` can carry, at any depth. Not the object's shape.
 */
export interface ReadingQuests_Outposts {
  count?: number;
  emptyMeaning?: string;
  /** Absent when the game did not give it. On each item of a list. */
  name?: string;
  outposts?: unknown[];
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  x?: number;
  /** Absent when the game did not give it. On each item of a list. */
  y?: number;
  /** Absent when the game did not give it. On each item of a list. */
  z?: number;
}

/**
 * Keys the Quests read `player:<steamid>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingQuests_Player {
  /** Unit: ms. On each item of a list. */
  ageMs?: number;
  /** Absent when the game did not give it. On each item of a list. */
  count?: number;
  dropped?: number;
  /** On each item of a list. */
  event?: string;
  events?: unknown[];
  idKindsNote?: "Task requests carry task ids; every other event carries quest ids.";
  /** Absent when the game did not give it. On each item of a list. */
  idsTruncated?: boolean;
  kept?: number;
  matched?: number;
  /** Absent when the game did not give it. On each item of a list. */
  nextResetRaw?: number;
  note?: "questId is the game's tracking id; its quest name is not known live.";
  player?: string;
  /** Absent when the game did not give it. On each item of a list. */
  questId?: number;
  /** Absent when the game did not give it. On each item of a list. */
  questIds?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  questIndex?: number;
  requestNote?: "Request events are what a player asked for; an outcome may never follow.";
  requests?: boolean;
  savedNote?: "The save holds which quest an id is and its objective progress.";
  seen?: number;
  /** Absent when the game did not give it. On each item of a list. */
  steamId?: string;
  /** Absent when the game did not give it. On each item of a list. */
  trackKindRaw?: number;
  unattributed?: number;
  unattributedNote?: "These events could not be matched to a player.";
  watching?: boolean;
}

/**
 * Keys the Quests read `quest:<netIndex>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingQuests_Quest {
  /** Absent when the game did not give it. On each item of a list. */
  amount?: number;
  /** Absent when the game did not give it. */
  cachedNetIndex?: number;
  /** Absent when the game did not give it. On each item of a list. */
  caption?: string;
  /** Absent when the game did not give it. On each item of a list. */
  circularArea?: string;
  /** On each item of a list. */
  circularAreaGroup?: string;
  class?: string;
  /** On each item of a list. */
  condition?: string;
  count?: number;
  /** Absent when the game did not give it. On each item of a list. */
  currency?: unknown[] | string;
  /** Absent when the game did not give it. On each item of a list. */
  currencyRaw?: number;
  /** Absent when the game did not give it. */
  descriptionSegments?: number;
  /** Absent when the game did not give it. On each item of a list. */
  dialogueOnCompletion?: string;
  /** Absent when the game did not give it. On each item of a list. */
  fame?: number;
  /** Absent when the game did not give it. */
  giverClass?: string;
  /** On each item of a list. */
  index?: number;
  /** Absent when the game did not give it. On each item of a list. */
  itemCount?: number;
  /** Absent when the game did not give it. On each item of a list. */
  items?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  itemsTruncated?: boolean;
  /** Absent when the game did not give it. */
  limitedToX?: number;
  /** Absent when the game did not give it. */
  limitedToY?: number;
  /** Absent when the game did not give it. */
  limitedToZ?: number;
  /** Absent when the game did not give it. On each item of a list. */
  limitToAreaCount?: number;
  /** Absent when the game did not give it. On each item of a list. */
  mapMarkers?: number;
  /** Absent when the game did not give it. */
  name?: string;
  netIndex?: number;
  note?: "Match quests by name; a missing title has not loaded yet.";
  objectiveList?: unknown[];
  /** Absent when the game did not give it. */
  objectives?: number;
  /** Absent when the game did not give it. */
  objectivesTruncated?: boolean;
  /** On each item of a list. */
  option?: number;
  quests?: unknown[];
  /** Absent when the game did not give it. */
  rewardOptions?: number;
  rewards?: unknown[];
  rewardsNote?: "Skill experience rewards are counted only, not named or sized.";
  /** Absent when the game did not give it. On each item of a list. */
  sequenceIndex?: number;
  /** Absent when the game did not give it. On each item of a list. */
  skillExperienceEntries?: number;
  /** Absent when the game did not give it. On each item of a list. */
  skillExperienceNamed?: boolean;
  /** Absent when the game did not give it. */
  steamStatUnlocks?: number;
  /** Absent when the game did not give it. */
  tier?: number;
  /** Absent when the game did not give it. */
  timeLimitRaw?: number;
  /** Absent when the game did not give it. */
  title?: string;
  /** Absent when the game did not give it. */
  truncated?: boolean;
}

/**
 * Keys the Quests read `quests` can carry, at any depth. Not the object's shape.
 */
export interface ReadingQuests_Quests {
  /** Absent when the game did not give it. */
  activeQuest?: number;
  eventsHeld?: number;
  /** Absent when the game did not give it. */
  initiallyAvailableTasks?: number;
  manager?: string;
  /** Absent when the game did not give it. */
  maxSimultaneousTasks?: number;
  note?: "Player quest progress is not here; see activity, or the save.";
  /** Absent when the game did not give it. */
  outposts?: number;
  /** Absent when the game did not give it. */
  questGiverComponents?: number;
  /** Absent when the game did not give it. */
  questGiverIdentifier?: number;
  /** Absent when the game did not give it. */
  questGiverTemplatesSkipped?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  questListManualOverride?: unknown;
  /** Absent when the game did not give it. */
  quests?: number;
  /** Absent when the game did not give it. */
  questsManualOverride?: number;
  /** Absent when the game did not give it. */
  questsTruncated?: boolean;
  /** Absent when the game did not give it. */
  reflectedStructMembers?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  specialQuestSets?: number;
  /** Absent when the game did not give it. */
  tierUnlockRules?: number;
  /** Absent when the game did not give it. */
  timedQuests?: number;
  /** Absent when the game did not give it. */
  timedQuestsTruncated?: boolean;
  watching?: boolean;
}

/**
 * Keys the Quests read `timed` can carry, at any depth. Not the object's shape.
 */
export interface ReadingQuests_Timed {
  count?: number;
  /** Absent when the game did not give it. On each item of a list. */
  endTicks?: number;
  /** Absent when the game did not give it. On each item of a list. */
  endUtc?: string;
  /** On each item of a list. */
  index?: number;
  /** Absent when the game did not give it. On each item of a list. */
  name?: string;
  /** Absent when the game did not give it. On each item of a list. */
  netIndex?: number;
  note?: "Times are UTC; compute with the ticks, show the date.";
  /** Absent when the game did not give it. On each item of a list. */
  startTicks?: number;
  /** Absent when the game did not give it. On each item of a list. */
  startUtc?: string;
  timed?: unknown[];
  /** Absent when the game did not give it. */
  truncated?: boolean;
}

/**
 * Keys the Raid detection read `all` can carry, at any depth. Not the object's shape.
 */
export interface ReadingRaid_All {
  /** On each item of a list. Type not readable from the source. */
  active?: unknown;
  activeCount?: number;
  /** Unit: ms. */
  activeWindowMs?: number;
  /** On each item of a list. */
  base?: number;
  /** On each item of a list. Type not readable from the source. */
  closedByCaller?: unknown;
  /** On each item of a list. */
  damage?: number;
  damageEvents?: number;
  damageUnresolved?: number;
  /** On each item of a list. Type not readable from the source. */
  declared?: unknown;
  /** On each item of a list. */
  destroyed?: number;
  effectiveMinDamage?: number;
  /** Absent when the game did not give it. On each item of a list. */
  element?: number;
  /** On each item of a list. */
  elements?: number;
  /** On each item of a list. Type not readable from the source. */
  elementsCapped?: unknown;
  /** On each item of a list. Type not readable from the source. */
  encounter?: unknown;
  filter?: string;
  /** On each item of a list. */
  hits?: number;
  ignoredElements?: number;
  ignoredElementsCapped?: boolean;
  ignoredHits?: number;
  ignoredWithoutElement?: number;
  /** Unit: ms. On each item of a list. */
  lastHitMs?: number;
  /** Additive keys beside the array, never inside it: `raids` and `all` are the two shapes the manager has shipped against. */
  minDamage?: number;
  /** Present only when it was READ. Absent when the game did not give it. On each item of a list. */
  name?: string;
  note?: "hits include admin damage commands; hits below 0.01 are always ignored";
  /** On each item of a list. Type not readable from the source. */
  pos?: unknown;
  raids?: unknown[];
  /** Unit: ms. On each item of a list. */
  sinceMs?: number;
  trackedCount?: number;
  unreadHits?: number;
  /** On each item of a list. */
  x?: number;
  /** On each item of a list. */
  y?: number;
  /** On each item of a list. */
  z?: number;
}

/**
 * Keys the Raid detection read `announcements` can carry, at any depth. Not the object's shape.
 */
export interface ReadingRaid_Announcements {
  /** Absent when the game did not give it. Type not readable from the source. */
  allowed?: unknown;
  announceEnabled?: boolean;
  /** Absent when the game did not give it. */
  canSend?: Record<string, unknown>;
  /** Absent when the game did not give it. Type not readable from the source. */
  concluded?: unknown;
  /** Absent when the game did not give it. Type not readable from the source. */
  ending?: unknown;
  managerPresent?: boolean;
  note?: "messages only; the raid schedule is in RaidTimes.json";
  /** Absent when the game did not give it. */
  periodLayoutFromBinary?: string;
  /** Absent when the game did not give it. */
  periodStructBytes?: number;
  /** Absent when the game did not give it. */
  periodStructMemberNames?: unknown[];
  /** The buffer is 32 and `n` is whatever the engine reports. Absent when the game did not give it. */
  periodStructMemberNamesTruncated?: boolean;
  /** -1 is a failed read and 0 is "this build reflects no members". Absent when the game did not give it. */
  periodStructMembers?: number;
  periodStructResolved?: boolean;
  /** Absent when the game did not give it. */
  present?: Record<string, unknown>;
  /** Absent when the game did not give it. Type not readable from the source. */
  raidTimes?: unknown;
  /** Absent when the game did not give it. Type not readable from the source. */
  startAnnouncement?: unknown;
  /** The game builds the manager only for scum.RaidProtectionType=3 (Global); on 0 None, 1 Offline and 2 Flag Specific there is none. Absent when the game did not give it. */
  why?: "needs raid protection type Global; none of the messages can be sent";
}

/**
 * Keys the Raid detection read `base:<id>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingRaid_Base {
  /** On each item of a list. Type not readable from the source. */
  active?: unknown;
  activeCount?: number;
  /** Unit: ms. */
  activeWindowMs?: number;
  /** On each item of a list. */
  base?: number;
  /** On each item of a list. Type not readable from the source. */
  closedByCaller?: unknown;
  /** On each item of a list. */
  damage?: number;
  damageEvents?: number;
  damageUnresolved?: number;
  /** On each item of a list. Type not readable from the source. */
  declared?: unknown;
  /** On each item of a list. */
  destroyed?: number;
  effectiveMinDamage?: number;
  /** Absent when the game did not give it. On each item of a list. */
  element?: number;
  /** On each item of a list. */
  elements?: number;
  /** On each item of a list. Type not readable from the source. */
  elementsCapped?: unknown;
  /** On each item of a list. Type not readable from the source. */
  encounter?: unknown;
  filter?: string;
  /** On each item of a list. */
  hits?: number;
  ignoredElements?: number;
  ignoredElementsCapped?: boolean;
  ignoredHits?: number;
  ignoredWithoutElement?: number;
  /** Unit: ms. On each item of a list. */
  lastHitMs?: number;
  /** Additive keys beside the array, never inside it: `raids` and `all` are the two shapes the manager has shipped against. */
  minDamage?: number;
  /** Present only when it was READ. Absent when the game did not give it. On each item of a list. */
  name?: string;
  note?: "hits include admin damage commands; hits below 0.01 are always ignored";
  /** On each item of a list. Type not readable from the source. */
  pos?: unknown;
  raids?: unknown[];
  /** Unit: ms. On each item of a list. */
  sinceMs?: number;
  trackedCount?: number;
  unreadHits?: number;
  /** On each item of a list. */
  x?: number;
  /** On each item of a list. */
  y?: number;
  /** On each item of a list. */
  z?: number;
}

/**
 * Keys the Raid detection read `bases` can carry, at any depth. Not the object's shape.
 */
export interface ReadingRaid_Bases {
  /** On each item of a list. */
  base?: number;
  bases?: unknown[];
  count?: number;
  /** On each item of a list. */
  encounter?: boolean;
  /** On each item of a list. */
  live?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  name?: string;
  note?: "base ids are not flag ids";
  /** On each item of a list. */
  raidActive?: boolean;
  /** Absent when the game did not give it. */
  truncated?: boolean;
}

/**
 * Keys the Raid detection read `encounters` can carry, at any depth. Not the object's shape.
 */
export interface ReadingRaid_Encounters {
  /** On each item of a list. */
  base?: number;
  /** The same distinction the other two payloads now carry. */
  encounterEvents?: number;
  encounters?: unknown[];
  encounterUnresolved?: number;
  /** Reported beside a raid and never counted as one: a base nobody has hit is not raided. */
  note?: "an encounter attack on a base is not counted as a raid";
  /** On each item of a list. */
  on?: boolean;
  /** Unit: ms. On each item of a list. */
  sinceMs?: number;
}

/**
 * Keys the Raid detection read `raids` can carry, at any depth. Not the object's shape.
 */
export interface ReadingRaid_Raids {
  /** On each item of a list. Type not readable from the source. */
  active?: unknown;
  activeCount?: number;
  /** Unit: ms. */
  activeWindowMs?: number;
  /** On each item of a list. */
  base?: number;
  /** On each item of a list. Type not readable from the source. */
  closedByCaller?: unknown;
  /** On each item of a list. */
  damage?: number;
  damageEvents?: number;
  damageUnresolved?: number;
  /** On each item of a list. Type not readable from the source. */
  declared?: unknown;
  /** On each item of a list. */
  destroyed?: number;
  effectiveMinDamage?: number;
  /** Absent when the game did not give it. On each item of a list. */
  element?: number;
  /** On each item of a list. */
  elements?: number;
  /** On each item of a list. Type not readable from the source. */
  elementsCapped?: unknown;
  /** On each item of a list. Type not readable from the source. */
  encounter?: unknown;
  filter?: string;
  /** On each item of a list. */
  hits?: number;
  ignoredElements?: number;
  ignoredElementsCapped?: boolean;
  ignoredHits?: number;
  ignoredWithoutElement?: number;
  /** Unit: ms. On each item of a list. */
  lastHitMs?: number;
  /** Additive keys beside the array, never inside it: `raids` and `all` are the two shapes the manager has shipped against. */
  minDamage?: number;
  /** Present only when it was READ. Absent when the game did not give it. On each item of a list. */
  name?: string;
  note?: "hits include admin damage commands; hits below 0.01 are always ignored";
  /** On each item of a list. Type not readable from the source. */
  pos?: unknown;
  raids?: unknown[];
  /** Unit: ms. On each item of a list. */
  sinceMs?: number;
  trackedCount?: number;
  unreadHits?: number;
  /** On each item of a list. */
  x?: number;
  /** On each item of a list. */
  y?: number;
  /** On each item of a list. */
  z?: number;
}

/**
 * Keys the Raid detection read `reasons` can carry, at any depth. Not the object's shape.
 */
export interface ReadingRaid_Reasons {
  destroyedByReason?: Record<string, unknown>;
  destroyEvents?: number;
  destroyUnresolved?: number;
  note?: string;
  raidReason?: "damage";
}

/**
 * Keys the Vehicle condition read `resolve:<address>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingRepair_Resolve {
  attachmentDamageRatios?: Record<string, unknown>;
  attachmentDamageRatiosNote?: string;
  /** Absent when the game did not give it. */
  attachmentRatiosUnreadable?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  burnsWhenDestroyed?: unknown;
  /** Absent when the game did not give it. */
  candidates?: number;
  class?: string;
  /** Absent when the game did not give it. */
  damageRatios?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  damageRatiosNote?: string;
  /** Absent when the game did not give it. */
  dist?: number;
  eid?: number;
  eidHi?: number;
  eidLo?: number;
  eidStr?: string;
  /** Absent when the game did not give it. */
  found?: boolean;
  /** Absent when the game did not give it. */
  liftModes?: unknown[];
  /** On each item of a list. */
  max?: number;
  /** On each item of a list. */
  min?: number;
  /** Absent when the game did not give it. */
  minSkill?: number;
  /** Absent when the game did not give it. */
  minSkillName?: string;
  note?: "players see a repair or repaint only when shared equals parts";
  /** Absent when the game did not give it. */
  onServiceStation?: boolean;
  parts?: number;
  /** Absent when the game did not give it. */
  partsNeedingNoTool?: number;
  /** Absent when the game did not give it. */
  partsOnlyServicedOnALift?: number;
  /** On each item of a list. */
  partsWithoutAnEntry?: number;
  /** Absent when the game did not give it. */
  pitch?: number;
  /** Absent when the game did not give it. */
  placed?: boolean;
  /** Absent when the game did not give it. */
  placedWhy?: string;
  /** Absent when the game did not give it. */
  reason?: string;
  regionParts?: Record<string, unknown>;
  regions?: unknown[];
  /** Absent when the game did not give it. */
  repairableParams?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  repairsFromZero?: boolean;
  replicatedParts?: number;
  replication?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  requiredTools?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  roll?: number;
  service?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  serviceComponentBuilt?: boolean;
  /** Absent when the game did not give it. */
  serviceStation?: string;
  /** Absent when the game did not give it. */
  serviceTagsNotListed?: number;
  shared?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. */
  vehicleLiftPoints?: unknown[];
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  yaw?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Server browser report read `status` can carry, at any depth. Not the object's shape.
 */
export interface ReadingReport_Status {
  /** Absent when the game did not give it. */
  configProblem?: string;
  hasToken?: boolean;
  /** Type not readable from the source. */
  lastReading?: unknown;
  /** Type not readable from the source. */
  report?: unknown;
}

/**
 * Keys the Fuel & resource stations read `resources` can carry, at any depth. Not the object's shape.
 */
export interface ReadingResources_Resources {
  /** Absent when the game did not give it. */
  blueprintAsset?: string;
  byType?: unknown[];
  canWrite?: boolean;
  canWriteReason?: string;
  coverage?: string;
  created?: number;
  /** Absent when the game did not give it. */
  dataVersion?: number;
  dataVersionKnown?: boolean;
  default?: number;
  /** Absent when the game did not give it. */
  full?: boolean;
  /** Absent when the game did not give it. */
  layout?: string;
  levelsAnnounced?: number;
  /** Absent when the game did not give it. */
  levelsRead?: number;
  max?: number;
  min?: number;
  /** Absent when the game did not give it. */
  note?: string;
  /** Type not readable from the source. */
  observedOnly?: unknown;
  /** Unit: ms. Absent when the game did not give it. */
  readAgoMs?: number;
  readEveryStation?: boolean;
  /** Absent when the game did not give it. */
  readNote?: string;
  refillRadius?: Record<string, unknown>;
  removed?: number;
  /** Absent when the game did not give it. */
  replenishmentsPerTick?: number;
  /** Absent when the game did not give it. */
  replenishNearPlayersWithin?: number;
  source?: string;
  /** Absent when the game did not give it. */
  sourceNote?: string;
  stations?: number;
  /** Absent when the game did not give it. */
  stationsRead?: number;
  /** On each item of a list. */
  type?: string;
  unidentified?: number;
  withCapacity?: number;
  withLevel?: number;
}

/**
 * Keys the Fuel & resource stations read `stations:<resource>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingResources_Stations {
  /** Unit: ms. Absent when the game did not give it. On each item of a list. */
  afterMs?: number;
  /** Absent when the game did not give it. On each item of a list. */
  amount?: number;
  /** Unit: ms. Absent when the game did not give it. On each item of a list. */
  amountAgeMs?: number;
  /** Absent when the game did not give it. On each item of a list. */
  amountSource?: string;
  /** Absent when the game did not give it. On each item of a list. */
  announcements?: number;
  count?: number;
  /** Absent when the game did not give it. */
  full?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  fullness?: number;
  /** Absent when the game did not give it. On each item of a list. */
  gameSaid?: number;
  /** Absent when the game did not give it. On each item of a list. */
  initial?: number;
  /** On each item of a list. */
  key?: string;
  /** Absent when the game did not give it. On each item of a list. */
  lastWrite?: Record<string, unknown>;
  /** Absent when the game did not give it. On each item of a list. */
  max?: number;
  /** Absent when the game did not give it. On each item of a list. */
  note?: string;
  /** Type not readable from the source. */
  observedOnly?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  pricePerUnit?: number;
  /** Absent when the game did not give it. On each item of a list. */
  proximityReplenishAmountMax?: number;
  /** Absent when the game did not give it. On each item of a list. */
  proximityReplenishAmountMin?: number;
  /** Absent when the game did not give it. On each item of a list. */
  proximityReplenishChance?: number;
  /** Absent when the game did not give it. On each item of a list. */
  proximityReplenishTimeout?: number;
  /** Absent when the game did not give it. On each item of a list. */
  replenishAmount?: number;
  /** Absent when the game did not give it. On each item of a list. */
  replenishesOnATimer?: boolean;
  /** Unit: min. Absent when the game did not give it. On each item of a list. */
  replenishIntervalMinutes?: number;
  /** Unit: s. Absent when the game did not give it. On each item of a list. */
  replenishIntervalSeconds?: number;
  /** Absent when the game did not give it. On each item of a list. */
  state?: string;
  stations?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  type?: string;
  unidentifiedNotShown?: number;
  /** Absent when the game did not give it. On each item of a list. */
  wanted?: number;
}

/**
 * Keys the Respawn timers read `timers:<steamId>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingRespawn_Timers {
  options?: Record<string, unknown>;
  /** Absent when the game did not give it. On each item of a list. */
  seconds?: number;
  /** Absent when the game did not give it. On each item of a list. */
  secondsLeft?: number;
  steamId?: string;
}

/**
 * Keys the Live server settings read `categories` can carry, at any depth. Not the object's shape.
 */
export interface ReadingSettings_Categories {
  categories?: unknown[];
}

/**
 * Keys the Live server settings read `get:<type>:<name>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingSettings_Get {
  /** Absent when the game did not give it. Type not readable from the source. */
  before?: unknown;
  /** Absent when the game did not give it. */
  catalogue?: string;
  /** Absent when the game did not give it. */
  category?: string;
  /** Absent when the game did not give it. */
  exists?: boolean;
  /** Absent when the game did not give it. */
  changedHere?: boolean;
  /** Absent when the game did not give it. */
  inSettingsFile?: boolean;
  /** Absent when the game did not give it. */
  name?: string;
  /** Absent when the game did not give it. */
  nameCaution?: string;
  /** Absent when the game did not give it. */
  proven?: boolean;
  /** Absent when the game did not give it. */
  provenType?: string;
  /** Absent when the game did not give it. */
  reason?: string;
  resolved?: string;
  /** Absent when the game did not give it. */
  type?: string;
  /** Absent when the game did not give it. */
  typeCaution?: string;
  /** Type not readable from the source. */
  value?: unknown;
}

/**
 * Keys the Live server settings read `changes` can carry, at any depth. Not the object's shape.
 */
export interface ReadingSettings_Changes {
  /** On each item of a list. Type not readable from the source. */
  after?: unknown;
  /** Unit: ms. On each item of a list. */
  agoMs?: number;
  basis?: string;
  /** On each item of a list. Type not readable from the source. */
  before?: unknown;
  cap?: number;
  count?: number;
  changes?: unknown[];
  /** On each item of a list. */
  name?: string;
  /** On each item of a list. */
  reverted?: boolean;
  /** On each item of a list. */
  type?: string;
}

/**
 * Keys the Live server settings read `list:<text>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingSettings_List {
  /** On each item of a list. */
  category?: string;
  /** Type not readable from the source. */
  count?: unknown;
  /** On each item of a list. */
  name?: string;
  settings?: unknown[];
  total?: number;
  /** On each item of a list. */
  type?: string;
}

/**
 * Keys the Live server settings read `outstanding` can carry, at any depth. Not the object's shape.
 */
export interface ReadingSettings_Outstanding {
  /** On each item of a list. Type not readable from the source. */
  after?: unknown;
  /** Unit: ms. On each item of a list. */
  agoMs?: number;
  basis?: string;
  /** On each item of a list. Type not readable from the source. */
  before?: unknown;
  count?: number;
  /** On each item of a list. */
  name?: string;
  settings?: unknown[];
  /** On each item of a list. */
  type?: string;
}

/**
 * Keys the Live server settings read `probe:<name>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingSettings_Probe {
  answers?: unknown[];
  /** Absent when the game did not give it. */
  catalogue?: string;
  category?: string;
  /** Absent when the game did not give it. */
  inSettingsFile?: boolean;
  name?: string;
  /** Absent when the game did not give it. */
  note?: string;
  /** On each item of a list. */
  proven?: boolean;
  /** Absent when the game did not give it. */
  provenTypes?: unknown[];
  /** Absent when the game did not give it. */
  reason?: "No such setting — check the spelling or search with list:<text>." | "The game does not expose this setting. Set it in ServerSettings.ini and restart." | "The game does not expose this setting; edit ServerSettings.ini.";
  /** On each item of a list. */
  resolved?: string;
  /** Absent when the game did not give it. */
  type?: string;
  /** Absent when the game did not give it. */
  typeBasis?: "ambiguous" | "catalogue" | "proven" | "unknown";
  /** On each item of a list. Type not readable from the source. */
  value?: unknown;
}

/**
 * Keys the Live server settings read `section:<Name>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingSettings_Section {
  category?: string;
  count?: number;
  /** On each item of a list. */
  name?: string;
  settings?: unknown[];
  /** On each item of a list. */
  type?: string;
}

/**
 * Keys the Live server settings read `values:<text>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingSettings_Values {
  /** Absent when the game did not give it. Type not readable from the source. */
  before?: unknown;
  cap?: number;
  /** Absent when the game did not give it. */
  catalogue?: string;
  /** Absent when the game did not give it. */
  category?: string;
  count?: number;
  /** Absent when the game did not give it. */
  exists?: boolean;
  from?: number;
  /** Absent when the game did not give it. */
  changedHere?: boolean;
  /** Absent when the game did not give it. */
  inSettingsFile?: boolean;
  matched?: number;
  /** Absent when the game did not give it. */
  name?: string;
  /** Absent when the game did not give it. */
  nameCaution?: string;
  next?: number;
  /** Absent when the game did not give it. */
  proven?: boolean;
  /** Absent when the game did not give it. */
  provenType?: string;
  /** Absent when the game did not give it. */
  reason?: string;
  resolved?: string;
  settings?: unknown[];
  truncated?: boolean;
  /** Absent when the game did not give it. */
  type?: string;
  /** Absent when the game did not give it. */
  typeCaution?: string;
  /** Type not readable from the source. */
  value?: unknown;
}

/**
 * Keys the Live server settings read `valuesfrom:<n>:<text>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingSettings_Valuesfrom {
  /** Absent when the game did not give it. Type not readable from the source. */
  before?: unknown;
  cap?: number;
  /** Absent when the game did not give it. */
  catalogue?: string;
  /** Absent when the game did not give it. */
  category?: string;
  count?: number;
  /** Absent when the game did not give it. */
  exists?: boolean;
  from?: number;
  /** Absent when the game did not give it. */
  changedHere?: boolean;
  /** Absent when the game did not give it. */
  inSettingsFile?: boolean;
  matched?: number;
  /** Absent when the game did not give it. */
  name?: string;
  /** Absent when the game did not give it. */
  nameCaution?: string;
  next?: number;
  /** Absent when the game did not give it. */
  proven?: boolean;
  /** Absent when the game did not give it. */
  provenType?: string;
  /** Absent when the game did not give it. */
  reason?: string;
  resolved?: string;
  settings?: unknown[];
  truncated?: boolean;
  /** Absent when the game did not give it. */
  type?: string;
  /** Absent when the game did not give it. */
  typeCaution?: string;
  /** Type not readable from the source. */
  value?: unknown;
}

/**
 * Keys the Precise spawning read `check:<classPath>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingSpawn_Check {
  /** Absent when the game did not give it. Type not readable from the source. */
  actorClass?: unknown;
  /** Type not readable from the source. */
  loaded?: unknown;
  note?: string;
  path?: string;
  presence?: string;
  presenceFrom?: string;
  /** Absent when the game did not give it. */
  why?: string;
}

/**
 * Keys the Precise spawning read `kinds` can carry, at any depth. Not the object's shape.
 */
export interface ReadingSpawn_Kinds {
  actor?: boolean;
  ai?: boolean;
  animal?: number;
  armednpc?: number;
  kinds?: unknown[];
  note?: "false means it has not been needed yet, not that this build lacks it";
  persistentConfirmable?: "with an online player, yes — the game's own reply is read";
  persistentEnabled?: boolean;
  persistentKinds?: unknown[];
  persistentMaxCount?: number;
  persistentMaxCountByKind?: Record<string, unknown>;
  persistentMaxCountNote?: "one vehicle per command; a count above 1 is refused";
  persistentRequest?: "persistent:<kind>:<x>,<y>,<z>:<count>:<type>";
  persists?: boolean;
  request?: "spawn:<kind>:<x>,<y>,<z>:<yaw>,<pitch>,<roll>:<classPath>";
  rotationRequired?: boolean;
  /** On each item of a list. */
  route?: string;
  routesResolved?: Record<string, unknown>;
  /** On each item of a list. */
  said?: string;
  scumRegistered?: boolean;
  /** On each item of a list. */
  switch?: string;
  units?: "centimetres and degrees";
  vehicle?: number;
  /** On each item of a list. */
  verb?: string;
  zombie?: number;
}

/**
 * Keys the Precise spawning read `loadcheck:<classPath>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingSpawn_Loadcheck {
  /** Absent when the game did not give it. */
  assetAt?: number;
  /** Type not readable from the source. */
  loaded?: unknown;
  note?: "a dry run of a forced load: nothing was loaded";
  optInWord?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  parameterBuilt?: unknown;
  /** Absent when the game did not give it. */
  parameterWhy?: string;
  /** Absent when the game did not give it. */
  parmsBytes?: number;
  path?: string;
  presence?: string;
  /** Absent when the game did not give it. */
  presenceWhy?: string;
  /** Absent when the game did not give it. */
  readBack?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  readBackMatches?: unknown;
  /** Absent when the game did not give it. */
  returnAt?: number;
  /** Type not readable from the source. */
  routeResolved?: unknown;
  /** Type not readable from the source. */
  switchOn?: unknown;
  /** Absent when the game did not give it. */
  why?: string;
  /** Type not readable from the source. */
  willDispatch?: unknown;
}

/**
 * Keys the Precise spawning read `persistence` can carry, at any depth. Not the object's shape.
 */
export interface ReadingSpawn_Persistence {
  at30s?: Record<string, unknown>;
  at5m?: Record<string, unknown>;
  available?: boolean;
  confirmable?: "only with somebody online";
  countersCaveat?: string;
  engineRoute?: Record<string, unknown>;
  evidence?: string;
  gone?: number;
  checked?: number;
  kinds?: "animal, zombie, armednpc, vehicle";
  means?: string;
  measured?: string;
  needsAnOnlinePlayer?: boolean;
  persistentRoute?: Record<string, unknown>;
  persistentRouteNote?: string;
  propertiesNotSent?: string;
  propertyNames?: string;
  registrationReachable?: boolean;
  registrationReachableWhy?: "the game offers no way to register a spawned actor";
  request?: "persistent:<kind>:<x>,<y>,<z>:<count>:<type>";
  rotation?: boolean;
  scumRegistered?: boolean;
  sent?: number;
  /** Unit: s. */
  soonestVanishSeconds?: number;
  typeIsTheGameSOwnName?: string;
}

/**
 * Keys the Precise spawning read `persistent:<kind>:<x>,<y>,<z>:<count>:<type>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingSpawn_Persistent {
  command?: string;
  /** Type not readable from the source. */
  confirmed?: unknown;
  confirmedBy?: string;
  count?: number;
  /** Absent when the game did not give it. */
  entityId?: string;
  /** Absent when the game did not give it. */
  entityIdNote?: "the saved id of this vehicle; creatures get none, which is normal";
  error?: string;
  /** Absent when the game did not give it. */
  gameSaid?: string;
  ifItRan?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  means?: string;
  /** Type not readable from the source. */
  persists?: unknown;
  reason?: string;
  reasonCode?: string;
  /** Absent when the game did not give it. */
  refusedByGame?: boolean;
  rotation?: boolean;
  route?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  scumRegistered?: unknown;
  /** Absent when the game did not give it. */
  scumRegisteredNote?: string;
  sent?: boolean;
  type?: string;
  verb?: string;
  verifyWith?: string;
  x?: number;
  y?: number;
  z?: number;
}

/**
 * Keys the Precise spawning read `spawn:<kind>:<x>,<y>,<z>:<yaw>,<pitch>,<roll>:<classPath>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingSpawn_Spawn {
  /** Absent when the game did not give it. */
  actor?: string;
  /** Unit: cm. Absent when the game did not give it. */
  adjustedCm?: number;
  /** Absent when the game did not give it. */
  adjustedCmNote?: string;
  /** Absent when the game did not give it. */
  at?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  at30s?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  at5m?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  brain?: boolean;
  class?: string;
  confirmed?: boolean;
  confirmedNote?: string;
  /** Absent when the game did not give it. */
  controller?: null | string;
  /** Absent when the game did not give it. */
  entityId?: string;
  /** Absent when the game did not give it. */
  entityIdNote?: string;
  /** Absent when the game did not give it. */
  error?: string;
  /** Unit: s. */
  expectedLifetimeSeconds?: "unknown; one lasted over ten minutes";
  /** Absent when the game did not give it. */
  facing?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  facingNote?: string;
  /** Unit: degrees. Absent when the game did not give it. */
  facingOffByDeg?: number;
  /** Absent when the game did not give it. */
  fault?: "the engine declined the spawn; nothing was created or left behind";
  /** Absent when the game did not give it. */
  faultAddress?: string;
  faultAt?: string;
  faultCode?: string;
  /** Absent when the game did not give it. */
  faultIsOurs?: boolean;
  /** Absent when the game did not give it. */
  faultOperation?: string;
  /** Absent when the game did not give it. */
  faultRva?: string;
  faultSeqDelta?: number;
  /** Absent when the game did not give it. */
  gone?: number;
  /** Absent when the game did not give it. */
  health?: number;
  /** Absent when the game did not give it. */
  checked?: number;
  /** Absent when the game did not give it. */
  id?: string;
  /** Absent when the game did not give it. */
  idForCreatureModule?: string;
  /** Absent when the game did not give it. */
  idNote?: string;
  /** Absent when the game did not give it. */
  jobError?: string;
  /** Absent when the game did not give it. */
  leavesInTheSave?: string;
  /** Absent when the game did not give it. */
  leavesInTheSaveNote?: string;
  /** Absent when the game did not give it. */
  moves?: boolean;
  /** Absent when the game did not give it. */
  movesNote?: string;
  note?: "not saved; gone at the next restart";
  /** Absent when the game did not give it. */
  observed?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  orphan?: string;
  /** Absent when the game did not give it. */
  orphanCount?: number;
  /** Absent when the game did not give it. */
  orphanNote?: "several of this class stand here, so nothing was removed; see orphanSlots";
  /** Absent when the game did not give it. */
  orphanSlots?: unknown[];
  /** Absent when the game did not give it. */
  persistentAlternative?: string;
  /** Absent when the game did not give it. */
  persistentAlternativeNote?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  persistentAlternativeTakesLocation?: unknown;
  persists?: boolean;
  /** Absent when the game did not give it. */
  pitch?: number;
  /** Absent when the game did not give it. */
  placementNote?: "created, but its position could not be read" | "moved to fit; `at` is where it really is";
  reason?: string;
  /** Absent when the game did not give it. */
  replicated?: boolean;
  /** Absent when the game did not give it. */
  replicatedNote?: string;
  /** Absent when the game did not give it. */
  roll?: number;
  route?: string;
  scumRegistered?: boolean;
  /** Absent when the game did not give it. */
  spawned?: boolean;
  /** Absent when the game did not give it. */
  species?: string;
  /** Absent when the game did not give it. */
  speciesName?: string;
  /** Absent when the game did not give it. */
  warning?: "it has no AI controller, so it will stand still rather than behave";
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  yaw?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Spawn points read `list` can carry, at any depth. Not the object's shape.
 */
export interface ReadingSpawnpoints_List {
  /** Absent when the game did not give it. */
  atOrigin?: number;
  /** Absent when the game did not give it. */
  atOriginNote?: string;
  /** Absent when the game did not give it. */
  disabled?: number;
  /** Absent when the game did not give it. */
  enabled?: number;
  /** Absent when the game did not give it. */
  missing?: string;
  /** Absent when the game did not give it. */
  playerSpawns?: number;
  /** Absent when the game did not give it. */
  playerSpawnsEnabled?: number;
  points?: unknown[];
  /** Absent when the game did not give it. */
  talliesCoverFirst?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** The list and EVERY count beside it describe the first N only; they are not totals. Absent when the game did not give it. */
  truncationNote?: string;
  /** Absent when the game did not give it. On each item of a list. */
  types?: unknown[];
  /** Unreal units. */
  units?: "centimetres";
  /** Absent when the game did not give it. */
  unreadable?: number;
}

/**
 * Keys the Spawn points read `map` can carry, at any depth. Not the object's shape.
 */
export interface ReadingSpawnpoints_Map {
  authored?: string;
  /** Absent when the game did not give it. */
  bounds?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  elevation?: Record<string, unknown>;
  extentNote?: "mapLimits is the playable edge; worldBounds is larger and not playable";
  /** Absent when the game did not give it. */
  mapLimits?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  memberNames?: unknown[];
  /** Absent when the game did not give it. */
  missing?: string;
  sectorId?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  segments?: unknown[];
  /** Absent when the game did not give it. */
  segmentsNote?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  spawnInAir?: unknown;
  /** Which route reached FTransform. Absent when the game did not give it. */
  typeRoute?: string;
  /** Unreal units, which is what every coordinate in this bridge is. */
  units?: "centimetres";
  /** Absent when the game did not give it. */
  worldBounds?: Record<string, unknown>;
}

/**
 * Keys the Spawn points read `respawn` can carry, at any depth. Not the object's shape.
 */
export interface ReadingSpawnpoints_Respawn {
  /** Absent when the game did not give it. */
  missing?: string;
  note?: "times are in seconds; price modifiers apply per online squad member. Edit in ServerSettings.ini.";
}

/**
 * Keys the Live squads read `board` can carry, at any depth. Not the object's shape.
 */
export interface ReadingSquads_Board {
  /** Unit: ms. */
  ageMs?: number;
  asked?: number;
  count?: number;
  /** Absent when the game did not give it. */
  forSquadId?: number;
  /** Absent when the game did not give it. On each item of a list. */
  information?: string;
  /** Absent when the game did not give it. On each item of a list. */
  informationTruncated?: boolean;
  /** Type not readable from the source. */
  mayHaveMore?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  name?: string;
  /** Absent when the game did not give it. On each item of a list. */
  nameTruncated?: boolean;
  note?: "Whole server in score order; with a squad id, the rows around that squad.";
  /** On each item of a list. */
  position?: number;
  /** Absent when the game did not give it. On each item of a list. */
  score?: number;
  /** Absent when the game did not give it. */
  squadIndex?: number;
  /** Absent when the game did not give it. */
  squadRank?: number;
  squads?: unknown[];
  /** Absent when the game did not give it. */
  truncated?: boolean;
}

/**
 * Keys the Live squads read `destroyed` can carry, at any depth. Not the object's shape.
 */
export interface ReadingSquads_Destroyed {
  /** Unit: ms. On each item of a list. */
  ageMs?: number;
  destroyed?: unknown[];
  held?: number;
  kept?: number;
  /** Absent when the game did not give it. On each item of a list. */
  name?: string;
  note?: "Squads unloaded when their last member left; not a wipe log. Check stillExists.";
  /** Absent when the game did not give it. On each item of a list. */
  squadId?: number;
  /** Absent when the game did not give it. On each item of a list. */
  stillExists?: boolean;
}

/**
 * Keys the Live squads read `member:<profileId>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingSquads_Member {
  alive?: boolean | number;
  emblem?: Record<string, unknown>;
  former?: number;
  /** Absent when the game did not give it. */
  formerListTruncated?: boolean;
  formerMembers?: unknown[];
  /** Absent when the game did not give it. */
  id?: number;
  inDanger?: boolean | number;
  /** Absent when the game did not give it. */
  information?: string;
  /** Absent when the game did not give it. */
  maxMembers?: number;
  /** Absent when the game did not give it. */
  members?: unknown[];
  /** Absent when the game did not give it. */
  message?: string;
  /** Absent when the game did not give it. */
  name?: string;
  online?: boolean | number;
  pending?: number;
  /** Absent when the game did not give it. */
  pendingListTruncated?: boolean;
  pendingMembers?: unknown[];
  /** On each item of a list. */
  primary?: number;
  /** On each item of a list. */
  profileId?: number;
  /** On each item of a list. */
  rank?: string;
  /** On each item of a list. */
  secondary?: number;
  /** On each item of a list. */
  shape?: number;
  size?: number;
  /** On each item of a list. */
  tertiary?: number;
}

/**
 * Keys the Live squads read `names:<squadId>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingSquads_Names {
  /** Unit: ms. */
  ageMs?: number;
  count?: number;
  /** Absent when the game did not give it. On each item of a list. */
  fame?: number;
  members?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  name?: string;
  /** Absent when the game did not give it. On each item of a list. */
  nameTruncated?: boolean;
  note?: "Live members; identity is the profile id, fame is in game fame points.";
  /** Absent when the game did not give it. On each item of a list. */
  profileId?: number;
  squadId?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
}

/**
 * Keys the Live squads read `squad:<id>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingSquads_Squad {
  alive?: boolean | number;
  emblem?: Record<string, unknown>;
  former?: number;
  /** Absent when the game did not give it. */
  formerListTruncated?: boolean;
  formerMembers?: unknown[];
  /** Absent when the game did not give it. */
  id?: number;
  inDanger?: boolean | number;
  /** Absent when the game did not give it. */
  information?: string;
  /** Absent when the game did not give it. */
  maxMembers?: number;
  /** Absent when the game did not give it. */
  members?: unknown[];
  /** Absent when the game did not give it. */
  message?: string;
  /** Absent when the game did not give it. */
  name?: string;
  online?: boolean | number;
  pending?: number;
  /** Absent when the game did not give it. */
  pendingListTruncated?: boolean;
  pendingMembers?: unknown[];
  /** On each item of a list. */
  primary?: number;
  /** On each item of a list. */
  profileId?: number;
  /** On each item of a list. */
  rank?: string;
  /** On each item of a list. */
  secondary?: number;
  /** On each item of a list. */
  shape?: number;
  size?: number;
  /** On each item of a list. */
  tertiary?: number;
}

/**
 * Keys the Live squads read `squads` can carry, at any depth. Not the object's shape.
 */
export interface ReadingSquads_Squads {
  alive?: boolean | number;
  count?: number;
  emblem?: Record<string, unknown>;
  former?: number;
  /** Absent when the game did not give it. */
  formerListTruncated?: boolean;
  formerMembers?: unknown[];
  /** Absent when the game did not give it. */
  id?: number;
  inDanger?: boolean | number;
  /** Absent when the game did not give it. */
  information?: string;
  /** Absent when the game did not give it. */
  maxMembers?: number;
  /** Absent when the game did not give it. */
  members?: unknown[];
  /** Absent when the game did not give it. */
  message?: string;
  /** Absent when the game did not give it. */
  name?: string;
  online?: boolean | number;
  pending?: number;
  /** Absent when the game did not give it. */
  pendingListTruncated?: boolean;
  pendingMembers?: unknown[];
  /** On each item of a list. */
  primary?: number;
  /** On each item of a list. */
  profileId?: number;
  /** On each item of a list. */
  rank?: string;
  scopeNote?: "Only squads the game has loaded; the save and board list them all.";
  /** On each item of a list. */
  secondary?: number;
  /** On each item of a list. */
  shape?: number;
  size?: number;
  squads?: unknown[];
  /** On each item of a list. */
  tertiary?: number;
  /** Type not readable from the source. */
  truncated?: unknown;
}

/**
 * Keys the Placed containers and items read `check:eid:<id>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingStash_Check {
  /** Absent when the game did not give it. Type not readable from the source. */
  armed?: unknown;
  /** Absent when the game did not give it. Type not readable from the source. */
  buried?: unknown;
  /** Absent when the game did not give it. Type not readable from the source. */
  canDetonate?: unknown;
  /** Absent when the game did not give it. Type not readable from the source. */
  canTrigger?: unknown;
  class?: string;
  /** Absent when the game did not give it. */
  containerWeight?: number;
  entityId?: number;
  /** Type not readable from the source. */
  held?: unknown;
  /** Absent when the game did not give it. Type not readable from the source. */
  spent?: unknown;
  /** Absent when the game did not give it. Type not readable from the source. */
  switch?: unknown;
  /** Absent when the game did not give it. */
  trap?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  trapType?: string;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Placed containers and items read `job:<tag>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingStash_Job {
  /** Absent when the game did not give it. On each item of a list. */
  added?: number;
  /** On each item of a list. */
  asked?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  buriableByPlayer?: unknown;
  code?: string;
  /** Absent when the game did not give it. */
  ehi?: number;
  /** Absent when the game did not give it. */
  elo?: number;
  /** Absent when the game did not give it. */
  entityId?: number;
  /** Absent when the game did not give it. On each item of a list. */
  entityIds?: unknown[];
  fill?: unknown[];
  /** Absent when the game did not give it. */
  gameSaid?: string;
  /** Absent when the game did not give it. On each item of a list. */
  into?: number;
  kind?: string;
  /** Absent when the game did not give it. On each item of a list. */
  newSeen?: number;
  /** Kept for callers that read it. */
  notes?: "fitting a lock is a player act and is not done here";
  /** On each item of a list. */
  outcome?: string;
  /** Absent when the game did not give it. */
  reason?: string;
  /** Absent when the game did not give it. */
  reasonCode?: string;
  /** Absent when the game did not give it. */
  route?: string;
  /** Absent when the game did not give it. On each item of a list. */
  said?: string;
  /** Absent when the game did not give it. */
  scumRegistered?: boolean;
  state?: string;
  tag?: string;
  /** Absent when the game did not give it. */
  target?: "player";
  /** Absent when the game did not give it. */
  via?: string;
  /** Absent when the game did not give it. On each item of a list. */
  weightAfter?: number;
  /** Absent when the game did not give it. On each item of a list. */
  weightBefore?: number;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Placed containers and items read `jobs` can carry, at any depth. Not the object's shape.
 */
export interface ReadingStash_Jobs {
  /** Absent when the game did not give it. On each item of a list. */
  added?: number;
  /** On each item of a list. */
  asked?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  buriableByPlayer?: unknown;
  code?: string;
  /** Absent when the game did not give it. */
  ehi?: number;
  /** Absent when the game did not give it. */
  elo?: number;
  /** Absent when the game did not give it. */
  entityId?: number;
  /** Absent when the game did not give it. On each item of a list. */
  entityIds?: unknown[];
  fill?: unknown[];
  /** Absent when the game did not give it. */
  gameSaid?: string;
  /** Absent when the game did not give it. On each item of a list. */
  into?: number;
  /** Absent when the game did not give it. */
  jobs?: unknown[];
  kind?: string;
  /** Absent when the game did not give it. On each item of a list. */
  newSeen?: number;
  /** Kept for callers that read it. */
  notes?: "fitting a lock is a player act and is not done here";
  /** On each item of a list. */
  outcome?: string;
  /** Absent when the game did not give it. */
  reason?: string;
  /** Absent when the game did not give it. */
  reasonCode?: string;
  /** Absent when the game did not give it. */
  route?: string;
  /** Absent when the game did not give it. On each item of a list. */
  said?: string;
  /** Absent when the game did not give it. */
  scumRegistered?: boolean;
  state?: string;
  tag?: string;
  /** Absent when the game did not give it. */
  target?: "player";
  /** Absent when the game did not give it. */
  via?: string;
  /** Absent when the game did not give it. On each item of a list. */
  weightAfter?: number;
  /** Absent when the game did not give it. On each item of a list. */
  weightBefore?: number;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Survival stats read `attributes:<steamid>:<strength>:<constitution>:<dexterity>:<intelligence>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingStats_Attributes {
  /** Absent when the game did not give it. */
  found?: boolean;
  limits?: Record<string, unknown>;
  /** On each item of a list. */
  max?: number;
  /** On each item of a list. */
  min?: number;
  note?: "Strength and constitution drift with activity, so small changes between readings are normal.";
  /** Absent when the game did not give it. */
  reason?: "player not in the world (offline or loading) — ask again";
}

/**
 * Keys the Survival stats read `fame` can carry, at any depth. Not the object's shape.
 */
export interface ReadingStats_Fame {
  /** Absent when the game did not give it. */
  asset?: string;
  awards?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  found?: boolean;
  /** Type not readable from the source. */
  gainCurve?: unknown;
  /** Unit: s. Absent when the game did not give it. */
  maxTimeFromLastLoginSeconds?: number;
  note?: "What the game pays per action. The FameGainMultiplier server setting scales these.";
  penalties?: Record<string, unknown>;
  read?: number;
  /** Absent when the game did not give it. */
  reason?: string;
  /** Type not readable from the source. */
  tagSettings?: unknown;
  unread?: number;
}

/**
 * Keys the Survival stats read `kills:steam:<steamid>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingStats_Kills {
  count?: number;
  /** Absent when the game did not give it. */
  found?: boolean;
  /** On each item of a list. */
  killer?: number;
  /** Absent when the game did not give it. On each item of a list. */
  killerSteamId?: string;
  note?: "Victim profile id to killer profile id. Steam ids only for online players.";
  pairs?: unknown[];
  /** Absent when the game did not give it. */
  reason?: string;
  /** Absent when the game did not give it. */
  registrySize?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** On each item of a list. */
  victim?: number;
  /** Absent when the game did not give it. On each item of a list. */
  victimSteamId?: string;
}

/**
 * Keys the Survival stats read `lastskill` can carry, at any depth. Not the object's shape.
 */
export interface ReadingStats_Lastskill {
  /** Absent when the game did not give it. */
  after?: number;
  /** Unit: ms. */
  ageMs?: number;
  awarded?: number;
  /** Absent when the game did not give it. */
  before?: number;
  forcedRefresh?: boolean;
  hint?: "no skill has been awarded since the bridge started";
  made?: boolean;
  mode?: string;
  /** Absent when the game did not give it. */
  moved?: number;
  note?: "If forcedRefresh is false, an unchanged after may just be stale.";
  requested?: number;
  skill?: string;
  steamid?: string;
}

/**
 * Keys the Survival stats read `ranking` can carry, at any depth. Not the object's shape.
 */
export interface ReadingStats_Ranking {
  /** Unit: ms. */
  ageMs?: number;
  asked?: number;
  /** Absent when the game did not give it. */
  askedFor?: number;
  /** Absent when the game did not give it. On each item of a list. */
  fameLevelComputed?: number;
  fameLevelNote?: "Show fameLevelComputed; the raw FameLevel reads 0 on this build.";
  /** Absent when the game did not give it. */
  hint?: "send command 'rank' and read again in a moment";
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  IsBanned?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  name?: string;
  note?: "Rows around one player, not the top N — use each row's rank.";
  order?: string;
  /** Absent when the game did not give it. */
  playerRank?: number;
  /** Absent when the game did not give it. On each item of a list. */
  profileId?: number;
  /** Absent when the game did not give it. On each item of a list. */
  rank?: number;
  /** Absent when the game did not give it. */
  received?: boolean;
  /** Absent when the game did not give it. */
  rows?: unknown[] | null;
  sortBy?: string;
  truncated?: boolean;
  /** Absent when the game did not give it. */
  waiting?: boolean;
}

/**
 * Keys the Survival stats read `rankwords` can carry, at any depth. Not the object's shape.
 */
export interface ReadingStats_Rankwords {
  /** On each item of a list. */
  fromEngine?: boolean;
  /** On each item of a list. */
  game?: string;
  maxRows?: number;
  order?: unknown[];
  sortBy?: unknown[];
  /** On each item of a list. */
  value?: number;
  /** On each item of a list. */
  word?: string;
}

/**
 * Keys the Survival stats read `skillinfo:<steamid>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingStats_Skillinfo {
  /** Absent when the game did not give it. On each item of a list. */
  asset?: string;
  /** Absent when the game did not give it. On each item of a list. */
  caption?: string;
  count?: number;
  /** Absent when the game did not give it. */
  found?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  id?: number;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  inCharacterCreation?: unknown;
  note?: "Server-wide skill settings, the same for everyone. skills:<steamid> gives a player's figures.";
  /** Absent when the game did not give it. */
  reason?: "player not in the world (offline or loading) — ask again";
  /** Absent when the game did not give it. On each item of a list. */
  skill?: string;
  skills?: unknown[];
}

/**
 * Keys the Survival stats read `skills:<steamid>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingStats_Skills {
  /** Absent when the game did not give it. On each item of a list. */
  counter?: number;
  /** Absent when the game did not give it. */
  found?: boolean;
  /** On each item of a list. */
  level?: string;
  /** Absent when the game did not give it. */
  noiseLevel?: number;
  /** Absent when the game did not give it. */
  noiseLevelNote?: "Raw value, meaning unknown — not an amount of noise.";
  /** Absent when the game did not give it. */
  reason?: "player not in the world (offline or loading) — ask again";
  /** On each item of a list. */
  skill?: string;
  skills?: unknown[];
  /** Absent when the game did not give it. */
  snapshotNote?: "Changes made elsewhere can be up to snapshotPeriodSec old.";
  /** Unit: s. Absent when the game did not give it. */
  snapshotPeriodSec?: number;
  /** Absent when the game did not give it. On each item of a list. */
  xp?: number;
}

/**
 * Keys the Survival stats read `stats:steam:<steamid>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingStats_Stats {
  /** Unit: ms. */
  ageMs?: number;
  cached?: number;
  cacheMax?: number;
  fields?: number;
  /** Absent when the game did not give it. */
  hint?: "send command 'refresh' and read again in a moment";
  /** Absent when the game did not give it. */
  players?: unknown[] | null;
  profileId?: number;
  refreshing?: boolean;
  /** Absent when the game did not give it. */
  resolved?: boolean;
}

/**
 * Keys the Live storage read `contents:eid:<entityId>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingStorage_Contents {
  class?: string;
  /** Absent when the game did not give it. */
  condition?: number;
  container?: number;
  containerEntityId?: number;
  /** Absent when the game did not give it. */
  contentsUnreadable?: boolean;
  /** Absent when the game did not give it. */
  contentsUnreadableReason?: string;
  count?: number;
  /** Absent when the game did not give it. */
  ehi?: number;
  /** Absent when the game did not give it. */
  elo?: number;
  /** Absent when the game did not give it. */
  entityId?: number;
  /** Absent when the game did not give it. */
  expirationTimeRaw?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  hasItems?: unknown;
  /** Absent when the game did not give it. */
  health?: number;
  /** Absent when the game did not give it. */
  id?: number;
  inventoryItemOwners?: unknown[];
  /** Absent when the game did not give it. */
  inventoryItemOwnersTruncated?: boolean;
  inventoryItemsOnServer?: number;
  inventoryItemsWithNoOwner?: number;
  items?: unknown[];
  /** Absent when the game did not give it. */
  itemsTruncated?: boolean;
  /** Absent when the game did not give it. */
  maxHealth?: number;
  /** Absent when the game did not give it. */
  ownWeight?: number;
  /** Absent when the game did not give it. On each item of a list. */
  quantity?: number;
  /** Absent when the game did not give it. On each item of a list. */
  stack?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  uses?: number;
  /** Absent when the game did not give it. */
  via?: string;
  /** Absent when the game did not give it. */
  weight?: number;
  /** Absent when the game did not give it. */
  where?: string;
}

/**
 * Keys the Live storage read `dropcheck:<container>,<item>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingStorage_Dropcheck {
  /** Absent when the game did not give it. */
  class?: string;
  /** Absent when the game did not give it. */
  containerEntityLo?: number;
  /** Absent when the game did not give it. */
  entityLo?: number;
  /** Type not readable from the source. */
  ready?: unknown;
  /** Absent when the game did not give it. */
  reasonCode?: "switched_off";
  /** Absent when the game did not give it. */
  through?: string;
  /** Absent when the game did not give it. */
  via?: string;
  /** Absent when the game did not give it. */
  why?: "turn on 'Allow moving and destroying container contents'";
  /** Type not readable from the source. */
  writeOn?: unknown;
}

/**
 * Keys the Live storage read `lastdestroy` can carry, at any depth. Not the object's shape.
 */
export interface ReadingStorage_Lastdestroy {
  actor?: string;
  /** Unit: ms. */
  ageMs?: number;
  class?: string;
  container?: number;
  /** Absent when the game did not give it. */
  containerEntityId?: number;
  destroySent?: boolean;
  entryRemoval?: string;
  entryRemovalSent?: boolean;
  /** Absent when the game did not give it. */
  finishWith?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  hadEntriesAfter?: unknown;
  /** Absent when the game did not give it. Type not readable from the source. */
  hadEntriesBefore?: unknown;
  heldAfter?: number;
  heldBefore?: number;
  hint?: string;
  item?: number;
  /** Absent when the game did not give it. */
  itemEntityId?: number;
  /** Absent when the game did not give it. */
  itemModule?: string;
  made?: boolean;
  stillInContainerAfterRemoval?: boolean;
  /** Absent when the game did not give it. */
  via?: string;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Live storage read `lockboxes` can carry, at any depth. Not the object's shape.
 */
export interface ReadingStorage_Lockboxes {
  attemptsLeft?: unknown[];
  /** Absent when the game did not give it. */
  atWorldOrigin?: boolean;
  /** Absent when the game did not give it. Type not readable from the source. */
  canBeForceUnlocked?: unknown;
  class?: string;
  count?: number;
  /** On each item of a list. */
  data?: string;
  /** Absent when the game did not give it. On each item of a list. */
  difficulty?: string;
  emptyMeaning?: string;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  famePointsRequired?: unknown;
  /** Unit: s. Absent when the game did not give it. */
  forceUnlockSeconds?: number;
  /** Absent when the game did not give it. */
  id?: number;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  ignoresLockProtection?: unknown;
  lockboxes?: unknown[];
  lockData?: unknown[];
  lockDataCount?: number;
  /** Absent when the game did not give it. */
  lockDataUnreadable?: boolean;
  /** Absent when the game did not give it. */
  lockDataVia?: "none" | "position";
  /** Absent when the game did not give it. Type not readable from the source. */
  lockDataViaNote?: unknown;
  /** Absent when the game did not give it. */
  lockRuntimeId?: string;
  /** Absent when the game did not give it. */
  locks?: number;
  lockState?: unknown[];
  lockTypes?: unknown[];
  /** Absent when the game did not give it. */
  owned?: number;
  /** Absent when the game did not give it. */
  ownerMapUnreadable?: boolean;
  /** Absent when the game did not give it. */
  ownerProfileId?: number;
  /** Type not readable from the source. */
  playersInWorld?: unknown;
  /** Absent when the game did not give it. */
  positionUnreadable?: boolean;
  /** On each item of a list. */
  runtimeId?: string;
  scope?: "loaded";
  scopeNote?: string;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Live storage read `storage` can carry, at any depth. Not the object's shape.
 */
export interface ReadingStorage_Storage {
  /** Absent when the game did not give it. */
  access?: string;
  /** Absent when the game did not give it. */
  accessName?: string;
  /** Absent when the game did not give it. */
  addressable?: boolean;
  /** Absent when the game did not give it. */
  addressableReason?: string;
  /** Absent when the game did not give it. */
  attemptsLeft?: unknown[];
  /** Absent when the game did not give it. */
  atWorldOrigin?: boolean;
  /** Absent when the game did not give it. */
  bcuLock?: string;
  /** Type not readable from the source. */
  buried?: unknown;
  /** Absent when the game did not give it. */
  buriedByProfileId?: number;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  canBeForceUnlocked?: unknown;
  /** Absent when the game did not give it. Type not readable from the source. */
  canContainChests?: unknown;
  class?: string;
  /** Absent when the game did not give it. */
  contentsWeight?: number;
  count?: number;
  /** On each item of a list. */
  data?: string;
  /** Absent when the game did not give it. */
  decaysUnderWater?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  difficulty?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  droneDestructible?: unknown;
  /** Absent when the game did not give it. */
  ehi?: number;
  /** Absent when the game did not give it. */
  elo?: number;
  emptyMeaning?: string;
  /** Absent when the game did not give it. */
  entityId?: number;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  famePointsRequired?: unknown;
  /** Absent when the game did not give it. Type not readable from the source. */
  hasItems?: unknown;
  /** Absent when the game did not give it. */
  id?: number;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  ignoresLockProtection?: unknown;
  /** Absent when the game did not give it. */
  lockIdsUnfilled?: boolean;
  /** Absent when the game did not give it. */
  lockObjects?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  lockpickable?: unknown;
  /** Absent when the game did not give it. */
  locks?: number;
  lockState?: unknown[];
  lockTypes?: unknown[];
  /** Absent when the game did not give it. */
  maxWeight?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  meleeDamageable?: unknown;
  name?: string;
  /** Absent when the game did not give it. */
  ownWeight?: number;
  /** Absent when the game did not give it. */
  playersInWorld?: null | number;
  scope?: "loaded";
  scopeNote?: string;
  storage?: unknown[];
  /** Absent when the game did not give it. Type not readable from the source. */
  supportsBCULock?: unknown;
  /** Absent when the game did not give it. */
  totalWeight?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Unit: s. Absent when the game did not give it. */
  underWaterDecaySeconds?: number;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Teleport read `corpses` can carry, at any depth. Not the object's shape.
 */
export interface ReadingTeleport_Corpses {
  /** Absent when the game did not give it. On each item of a list. */
  atRest?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  attachments?: number;
  /** Unit: s. Absent when the game did not give it. On each item of a list. */
  bodyLifetimeSeconds?: number;
  /** Unit: cm. Absent when the game did not give it. On each item of a list. */
  bodyRemovalRadiusCm?: number;
  /** Absent when the game did not give it. On each item of a list. */
  carrying?: number;
  corpses?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  mass?: number;
  /** Absent when the game did not give it. On each item of a list. */
  name?: string;
  /** Absent when the game did not give it. */
  note?: "no body is loaded right now — bodies far from every player may not be loaded";
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  x?: number;
  /** Absent when the game did not give it. On each item of a list. */
  y?: number;
  /** Absent when the game did not give it. On each item of a list. */
  z?: number;
}

/**
 * Keys the Teleport read `inflight` can carry, at any depth. Not the object's shape.
 */
export interface ReadingTeleport_Inflight {
  /** Unit: ms. On each item of a list. */
  ageMs?: number;
  /** Absent when the game did not give it. On each item of a list. */
  alreadyFacing?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  alreadyThere?: boolean;
  arrivals?: unknown[];
  arrived?: boolean | number;
  /** On each item of a list. */
  decided?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  dz?: number;
  /** On each item of a list. */
  fromYaw?: number;
  /** Unit: cm. Absent when the game did not give it. On each item of a list. */
  movedCm?: number;
  notArrived?: number;
  notTurned?: number;
  pending?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  provesNothing?: string;
  /** On each item of a list. */
  steamId?: string;
  /** Unit: ms. */
  timeoutMs?: number;
  /** Unit: cm. */
  toleranceCm?: number;
  /** Unit: ms. Absent when the game did not give it. On each item of a list. */
  tookMs?: number;
  /** Absent when the game did not give it. */
  turned?: boolean | number;
  turnedAlreadyFacing?: number;
  turns?: unknown[];
  /** Unit: degrees. */
  turnSlackDeg?: number;
  /** Unit: ms. */
  turnTimeoutMs?: number;
  /** On each item of a list. */
  wantYaw?: number;
  /** Absent when the game did not give it. On each item of a list. */
  wantZ?: number;
  /** Absent when the game did not give it. On each item of a list. */
  why?: string;
  /** Absent when the game did not give it. On each item of a list. */
  x?: number;
  /** Absent when the game did not give it. On each item of a list. */
  y?: number;
  /** Absent when the game did not give it. On each item of a list. */
  yaw?: number;
  /** Absent when the game did not give it. On each item of a list. */
  z?: number;
}

/**
 * Keys the Teleport read `origin:<steamid>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingTeleport_Origin {
  /** Unit: ms. */
  ageMs?: number;
  found?: boolean;
  x?: number;
  y?: number;
  yaw?: number;
  z?: number;
}

/**
 * Keys the Teleport read `origins` can carry, at any depth. Not the object's shape.
 */
export interface ReadingTeleport_Origins {
  /** Unit: ms. On each item of a list. */
  ageMs?: number;
  count?: number;
  max?: number;
  origins?: unknown[];
  /** On each item of a list. */
  steamid?: string;
  /** On each item of a list. */
  x?: number;
  /** On each item of a list. */
  y?: number;
  /** On each item of a list. */
  yaw?: number;
  /** On each item of a list. */
  z?: number;
}

/**
 * Keys the Trade outposts read `bank` can carry, at any depth. Not the object's shape.
 */
export interface ReadingTrade_Bank {
  /** Absent when the game did not give it. */
  asset?: string;
  /** Unit: %. */
  atmProvisionPercent?: "fraction-0-1";
  /** Absent when the game did not give it. Type not readable from the source. */
  bank?: unknown;
  /** Unit: %. */
  bankerProvisionPercent?: "fraction-0-1";
  /** Absent when the game did not give it. */
  cardCount?: null | number;
  /** Type not readable from the source. */
  cards?: unknown;
  /** Absent when the game did not give it. */
  cardsUnreadable?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  cardType?: string;
  /** Absent when the game did not give it. On each item of a list. */
  cardTypeRaw?: number;
  /** Absent when the game did not give it. On each item of a list. */
  configSymbol?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  currencies?: unknown;
  /** On each item of a list. Type not readable from the source. */
  chance?: unknown;
  /** On each item of a list. */
  index?: number;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  mustOwnCard?: unknown;
  note?: string;
  /** Absent when the game did not give it. */
  prosperityAvailabilityBonus?: "percentage-points added by prosperity tier";
  /** Absent when the game did not give it. On each item of a list. */
  purchaseCurrency?: string;
  /** Absent when the game did not give it. On each item of a list. */
  purchaseCurrencyRaw?: number;
  /** On each item of a list. */
  rarity?: string;
  /** Absent when the game did not give it. On each item of a list. */
  requiresCard?: string;
  /** Absent when the game did not give it. On each item of a list. */
  requiresCardRaw?: number;
  rotationRarityCount?: number;
  rotationRarityChance?: "percent-0-100";
  /** Absent when the game did not give it. */
  rotationRarityUnreadable?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  symbol?: string;
  units?: Record<string, unknown>;
}

/**
 * Keys the Trade outposts read `economy` can carry, at any depth. Not the object's shape.
 */
export interface ReadingTrade_Economy {
  /** Absent when the game did not give it. Type not readable from the source. */
  economy?: unknown;
  /** Absent when the game did not give it. */
  economyOverrideFile?: string;
  /** On each item of a list. */
  level?: number;
  /** Absent when the game did not give it. On each item of a list. */
  name?: string;
  overrideTraderKey?: "traderName";
  /** Absent when the game did not give it. */
  pendingTraderPersonalities?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  prosperityLevels?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  thresholdGold?: number;
  /** Absent when the game did not give it. */
  vehicleSpawnGroupTag?: string;
}

/**
 * Keys the Trade outposts read `prices:<text>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingTrade_Prices {
  /** Absent when the game did not give it. */
  altCurrencyPrice?: number;
  /** Absent when the game did not give it. */
  class?: string;
  /** Absent when the game did not give it. */
  currency?: string;
  /** Absent when the game did not give it. */
  currencyRaw?: number;
  /** Absent when the game did not give it. */
  deltaPriceRaw?: number;
  itemNames?: boolean;
  itemNamesNote?: "This game version does not say which item each price is for.";
  note?: "Only a trader's per-item overrides; other items sell at the economy price.";
  overridesOnly?: boolean;
  overrideTraderKey?: "traderName";
  /** Absent when the game did not give it. */
  path?: string;
  /** On each item of a list. */
  personality?: string;
  /** Absent when the game did not give it. On each item of a list. */
  prices?: unknown[];
  /** Absent when the game did not give it. */
  purchasePrice?: number;
  /** Absent when the game did not give it. */
  requiredFame?: number;
  /** Absent when the game did not give it. On each item of a list. */
  rows?: null | number;
  rowsReported?: number;
  /** Absent when the game did not give it. On each item of a list. */
  rowsTruncated?: boolean;
  /** Absent when the game did not give it. */
  sellPrice?: number;
  traderCount?: number;
  /** Absent when the game did not give it. On each item of a list. */
  traderName?: string;
  traders?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  traderType?: string;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  unreadable?: boolean;
}

/**
 * Keys the Trade outposts read `trade` can carry, at any depth. Not the object's shape.
 */
export interface ReadingTrade_Trade {
  /** Absent when the game did not give it. */
  actor?: string;
  class?: string;
  /** Absent when the game did not give it. */
  description?: string;
  /** Absent when the game did not give it. On each item of a list. */
  doing?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  economy?: unknown;
  /** Absent when the game did not give it. */
  economyOverrideFile?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  givesQuests?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  homeX?: number;
  /** Absent when the game did not give it. On each item of a list. */
  homeY?: number;
  /** Absent when the game did not give it. On each item of a list. */
  homeZ?: number;
  /** Absent when the game did not give it. */
  level?: number | string;
  managerCount?: number;
  /** Absent when the game did not give it. */
  name?: string;
  /** Absent when the game did not give it. */
  note?: string;
  /** Absent when the game did not give it. On each item of a list. */
  npcTag?: string;
  /** Absent when the game did not give it. */
  otherBuildings?: number;
  outposts?: unknown[];
  overrideTraderKey?: "traderName";
  /** Absent when the game did not give it. */
  pendingTraderPersonalities?: number;
  postCount?: number;
  posts?: unknown[];
  /** Absent when the game did not give it. */
  postsTruncated?: boolean;
  /** Absent when the game did not give it. */
  postsUnread?: boolean;
  /** Absent when the game did not give it. Type not readable from the source. */
  prosperityLevels?: unknown;
  roster?: unknown[];
  /** Absent when the game did not give it. */
  rosterTruncated?: boolean;
  /** Absent when the game did not give it. */
  spawnedNpcs?: number;
  /** Absent when the game did not give it. */
  spawnedTraders?: number;
  startingProsperity?: string;
  /** Absent when the game did not give it. On each item of a list. */
  thresholdGold?: number;
  traders?: unknown[];
  /** Absent when the game did not give it. */
  tradersTruncated?: boolean;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  unassignedPosts?: unknown[];
  /** Absent when the game did not give it. */
  vehicleSpawnGroupTag?: string;
  x?: number;
  y?: number;
  z?: number;
}

/**
 * Keys the Trade outposts read `writable` can carry, at any depth. Not the object's shape.
 */
export interface ReadingTrade_Writable {
  enabled?: boolean;
  /** On each item of a list. */
  key?: string;
  keys?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  max?: number;
  /** Absent when the game did not give it. On each item of a list. */
  min?: number;
  persists?: boolean;
  /** On each item of a list. Type not readable from the source. */
  replicates?: unknown;
  /** On each item of a list. */
  type?: string;
  /** On each item of a list. */
  what?: string;
}

/**
 * Keys the Live vehicles read `manager` can carry, at any depth. Not the object's shape.
 */
export interface ReadingVehicles_Manager {
  /** Absent when the game did not give it. */
  alwaysFunctioning?: number;
  /** Absent when the game did not give it. */
  spawnPoints?: number;
}

/**
 * Keys the Live vehicles read `vehicles` can carry, at any depth. Not the object's shape.
 */
export interface ReadingVehicles_Vehicles {
  /** Absent when the game did not give it. */
  access?: string;
  /** Absent when the game did not give it. */
  accessName?: string;
  /** Absent when the game did not give it. */
  addressable?: boolean;
  /** Absent when the game did not give it. */
  addressableWhy?: string;
  /** Absent when the game did not give it. */
  adminVisible?: boolean;
  /** Absent when the game did not give it. */
  attachments?: number;
  /** Absent when the game did not give it. */
  attachmentsDescribed?: number;
  /** Absent when the game did not give it. */
  attachmentsRead?: boolean;
  /** Absent when the game did not give it. */
  attachmentsReadWhy?: string;
  /** Absent when the game did not give it. */
  battery?: number;
  /** Absent when the game did not give it. */
  batteryMax?: number;
  /** Absent when the game did not give it. */
  batteryRatio?: number;
  /** Absent when the game did not give it. */
  bcuLock?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  bcuLocking?: unknown;
  /** Absent when the game did not give it. */
  brokenParts?: number;
  class?: string;
  /** Absent when the game did not give it. */
  condition?: number;
  /** Absent when the game did not give it. */
  containerEHi?: number;
  /** Absent when the game did not give it. */
  containerEidStr?: string;
  /** Absent when the game did not give it. */
  containerELo?: number;
  /** Absent when the game did not give it. */
  containerOwner?: number;
  /** Absent when the game did not give it. */
  displayName?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  driven?: unknown;
  /** Absent when the game did not give it. */
  driverLookupFailed?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  driverSteamId?: string;
  /** Absent when the game did not give it. */
  eHi?: number;
  /** Absent when the game did not give it. */
  eidStr?: string;
  /** Absent when the game did not give it. */
  eLo?: number;
  /** Absent when the game did not give it. */
  engine?: string;
  /** Absent when the game did not give it. */
  engineName?: string;
  /** Absent when the game did not give it. */
  engineTemp?: number;
  /** Absent when the game did not give it. */
  family?: string;
  /** Absent when the game did not give it. */
  fuel?: number;
  /** Absent when the game did not give it. */
  fuelMax?: number;
  /** Absent when the game did not give it. */
  fuelRatio?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  inWater?: unknown;
  /** Absent when the game did not give it. */
  jackClass?: string;
  /** Absent when the game did not give it. */
  jackMode?: string;
  /** Absent when the game did not give it. */
  km?: number;
  /** Absent when the game did not give it. */
  lockAttemptsLeft?: unknown[];
  /** Absent when the game did not give it. */
  lockAttemptsTruncated?: boolean;
  /** Absent when the game did not give it. */
  lockDetail?: unknown[];
  /** Absent when the game did not give it. */
  lockDetailTruncated?: boolean;
  /** Absent when the game did not give it. */
  lockIds?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  lockpickable?: unknown;
  /** Absent when the game did not give it. */
  locks?: number;
  /** Absent when the game did not give it. */
  lockTypes?: unknown[];
  /** Absent when the game did not give it. */
  lockTypesTruncated?: boolean;
  /** Absent when the game did not give it. */
  maxCarryWeight?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  onJack?: unknown;
  /** Absent when the game did not give it. */
  parkedPitch?: number;
  /** Absent when the game did not give it. */
  parkedRoll?: number;
  /** Absent when the game did not give it. */
  parkedX?: number;
  /** Absent when the game did not give it. */
  parkedY?: number;
  /** Absent when the game did not give it. */
  parkedYaw?: number;
  /** Absent when the game did not give it. */
  parkedZ?: number;
  /** Absent when the game did not give it. */
  parts?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  physics?: unknown;
  /** Absent when the game did not give it. */
  pitch?: number;
  /** Unit: cm. Absent when the game did not give it. */
  positionDisagreesCm?: number;
  /** Absent when the game did not give it. */
  positionNote?: string;
  /** Absent when the game did not give it. */
  protectingFlag?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  quickService?: unknown;
  /** Absent when the game did not give it. */
  roll?: number;
  /** Absent when the game did not give it. */
  rpm?: number;
  scope?: "loaded";
  scopeNote?: string;
  /** Absent when the game did not give it. */
  serviceComponent?: boolean;
  /** Absent when the game did not give it. */
  serviceInitiator?: number;
  /** Absent when the game did not give it. */
  serviceStationField?: boolean;
  /** Absent when the game did not give it. */
  spawnGroup?: string;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  vehicles?: unknown[];
  /** Unit: s. Absent when the game did not give it. */
  waterDestroySeconds?: number;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  yaw?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Owners of mines, bedrolls and trader depots read `containers` can carry, at any depth. Not the object's shape.
 */
export interface ReadingVirtual_Containers {
  /** Absent when the game did not give it. */
  blueprintTemplates?: number;
  /** Absent when the game did not give it. */
  blueprintTemplatesNote?: "templates, not crates in the world; left out";
  class?: string;
  containers?: unknown[];
  count?: number;
  /** Absent when the game did not give it. */
  famePointAwardTag?: string;
  /** Absent when the game did not give it. */
  forceUnlockRadius?: number;
  /** Unit: s. Absent when the game did not give it. */
  forceUnlockSeconds?: number;
  lockCount?: number;
  locks?: unknown[];
  /** Absent when the game did not give it. */
  locksTruncated?: boolean;
  /** Absent when the game did not give it. */
  managerFound?: boolean;
  /** Absent when the game did not give it. Type not readable from the source. */
  opened?: unknown;
  openedCount?: number;
  openedNote?: "lock gone, cause unknown; not a raid alert on its own";
  /** Absent when the game did not give it. */
  originalLockCount?: number;
  /** Absent when the game did not give it. */
  path?: string;
  /** Absent when the game did not give it. */
  registered?: number;
  /** Absent when the game did not give it. */
  replicated?: number;
  /** Absent when the game did not give it. */
  scopeNote?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  tracked?: unknown;
  truncated?: boolean;
  /** Absent when the game did not give it. */
  upgradeItemSlots?: number;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Owners of mines, bedrolls and trader depots read `owners` can carry, at any depth. Not the object's shape.
 */
export interface ReadingVirtual_Owners {
  count?: number;
  /** Absent when the game did not give it. On each item of a list. */
  cratePaths?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  cratePathsTruncated?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  crates?: number;
  emptyMeans?: string;
  owners?: unknown[];
  pairs?: number;
  /** On each item of a list. */
  profileId?: number;
  truncated?: boolean;
  valueStructConfirmed?: boolean;
}

/**
 * Keys the Owners of mines, bedrolls and trader depots read `repdata` can carry, at any depth. Not the object's shape.
 */
export interface ReadingVirtual_Repdata {
  /** Absent when the game did not give it. On each item of a list. */
  attemptsLeftPerLock?: unknown[];
  count?: number;
  entries?: unknown[];
  joinUnavailable?: boolean;
  joinUnavailableNote?: string;
  /** Absent when the game did not give it. On each item of a list. */
  lockClasses?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  lockClassesTruncated?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  lockClassPaths?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  lockCount?: number;
  lockDisagreementNote?: string;
  locksOmitted?: boolean;
  locksOmittedNote?: string;
  note?: string;
  /** On each item of a list. */
  runtimeId?: string;
  truncated?: boolean;
  valueStructConfirmed?: boolean;
}

/**
 * Keys the Owners of mines, bedrolls and trader depots read `survey` can carry, at any depth. Not the object's shape.
 */
export interface ReadingVirtual_Survey {
  blueprintTemplates?: number;
  /** Unit: cm. */
  boundsCm?: unknown[];
  /** Absent when the game did not give it. */
  boundsTruncated?: boolean;
  byClass?: Record<string, unknown>;
  components?: number;
  containers?: Record<string, unknown>;
  contentsRoute?: "none";
  finding?: "world crates hold no inventory; read contents with the items or storage module";
  inWorld?: number;
  live?: number;
  managerFound?: boolean;
  /** Absent when the game did not give it. */
  managerPath?: string;
  /** Absent when the game did not give it. */
  managerProperties?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  managerReflectsNothing?: unknown;
  note?: "visitors wake items near them; boundsCm is each one's reach in cm";
  /** Absent when the game did not give it. */
  owners?: number;
  records?: number;
  /** Absent when the game did not give it. */
  recordsUnderManager?: number;
  /** Absent when the game did not give it. */
  registered?: number;
  trapActorsLoaded?: number;
  trapActorsTruncated?: boolean;
  truncated?: boolean;
  virtualization?: Record<string, unknown>;
  virtualizationVisitors?: Record<string, unknown>;
}

/**
 * Keys the Owners of mines, bedrolls and trader depots read `virtualized:<profileId>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingVirtual_Virtualized {
  class?: string;
  count?: number;
  coverageNote?: "only owned mines, bedrolls and depots; not every stored item";
  emptyMeans?: string;
  overlapNote?: "some of these traps also appear in the items report; do not add them";
  /** Absent when the game did not give it. */
  path?: string;
  /** Absent when the game did not give it. */
  profileId?: number;
  records?: unknown[];
  scanned?: number;
  /** Unit: s. Absent when the game did not give it. */
  timerSeconds?: number;
  /** Absent when the game did not give it. */
  timerStartTicks?: number;
  /** Absent when the game did not give it. */
  timerStartUnix?: number;
  /** Absent when the game did not give it. */
  traderId?: string;
  trapActorsLoaded?: number;
  /** Absent when the game did not give it. */
  trapActorsTruncated?: boolean;
  truncated?: boolean;
  /** Absent when the game did not give it. Type not readable from the source. */
  underManager?: unknown;
  /** Absent when the game did not give it. */
  virtualizationManager?: string;
}

/**
 * Keys the Votes and tournaments read `tournament` can carry, at any depth. Not the object's shape.
 */
export interface ReadingVote_Tournament {
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  alive?: unknown;
  /** Absent when the game did not give it. Type not readable from the source. */
  ended?: unknown;
  /** Absent when the game did not give it. */
  everStarted?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  name?: string;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  online?: unknown;
  players?: unknown[];
  /** Absent when the game did not give it. */
  running?: boolean;
  /** Absent when the game did not give it. Type not readable from the source. */
  suddenDeath?: unknown;
  /** Absent when the game did not give it. */
  tournament?: Record<string, unknown>;
}

/**
 * Keys the Votes and tournaments read `vote` can carry, at any depth. Not the object's shape.
 */
export interface ReadingVote_Vote {
  /** Absent when the game did not give it. */
  lastMessage?: string;
  /** Absent when the game did not give it. */
  lastTopic?: string;
  runningReadable?: boolean;
  /** What this module cannot see, said in the payload rather than left for a caller to infer from an absent key. */
  tallyReadable?: boolean;
  topics?: unknown[];
  /** Type not readable from the source. */
  vote?: unknown;
}

/**
 * Keys the Far from players read `near:<x>,<y>,<z>:<radius cm up to 200000>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingWake_Near {
  /** Absent when the game did not give it. On each item of a list. */
  class?: string;
  /** On each item of a list. */
  count?: number;
  /** Absent when the game did not give it. On each item of a list. */
  ehi?: number;
  /** Absent when the game did not give it. On each item of a list. */
  eid?: number;
  /** Absent when the game did not give it. On each item of a list. */
  list?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  truncated?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  unreadable?: string;
  /** Absent when the game did not give it. On each item of a list. */
  x?: number;
  /** Absent when the game did not give it. On each item of a list. */
  y?: number;
  /** Absent when the game did not give it. On each item of a list. */
  z?: number;
}

/**
 * Keys the Far from players read `reach` can carry, at any depth. Not the object's shape.
 */
export interface ReadingWake_Reach {
  everySpawner?: boolean;
  held?: boolean;
  /** Absent when the game did not give it. */
  secondsLeft?: number;
  /** Unit: cm. */
  vehicleReachCm?: number;
  /** Unit: cm. Absent when the game did not give it. */
  wasCm?: number;
}

/**
 * Keys the Far from players read `visitors` can carry, at any depth. Not the object's shape.
 */
export interface ReadingWake_Visitors {
  /** Unit: ms. Absent when the game did not give it. On each item of a list. */
  backAfterMs?: number;
  /** Unit: cm. Absent when the game did not give it. On each item of a list. */
  boundsCm?: number;
  /** On each item of a list. */
  class?: string;
  /** Unit: cm. */
  defaultBoundsCm?: number;
  /** On each item of a list. */
  id?: number;
  /** On each item of a list. */
  inertCalls?: number;
  /** Absent when the game did not give it. On each item of a list. */
  itemsBack?: number;
  /** On each item of a list. */
  itemsBefore?: number;
  /** Absent when the game did not give it. On each item of a list. */
  itemsOut?: number;
  max?: number;
  /** Unit: cm. */
  maxBoundsCm?: number;
  /** Unit: s. */
  maxSeconds?: number;
  /** On each item of a list. */
  nudge?: Record<string, unknown>;
  /** Unit: ms. Absent when the game did not give it. On each item of a list. */
  outAfterMs?: number;
  /** On each item of a list. Type not readable from the source. */
  parked?: unknown;
  /** On each item of a list. */
  pawn?: string;
  /** On each item of a list. Type not readable from the source. */
  pawnLive?: unknown;
  /** On each item of a list. */
  secondsLeft?: number;
  /** On each item of a list. */
  state?: string;
  /** On each item of a list. */
  uses?: number;
  /** On each item of a list. Type not readable from the source. */
  visitorLive?: unknown;
  visitors?: unknown[];
  /** On each item of a list. */
  x?: number;
  /** On each item of a list. */
  y?: number;
  /** On each item of a list. */
  z?: number;
}

/**
 * Keys the Wildlife population read `biomes` can carry, at any depth. Not the object's shape.
 */
export interface ReadingWildlife_Biomes {
  /** Absent when the game did not give it. On each item of a list. */
  asset?: string;
  /** Absent when the game did not give it. */
  available?: boolean;
  biomes?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  density?: number;
  /** Absent when the game did not give it. */
  elementTypeResolved?: boolean;
  /** Absent when the game did not give it. */
  members?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  minDistanceToAnyAnimal?: number;
  /** Absent when the game did not give it. On each item of a list. */
  minDistanceToSameAnimal?: number;
  /** Absent when the game did not give it. On each item of a list. */
  packMax?: number;
  /** Absent when the game did not give it. On each item of a list. */
  packMin?: number;
  /** Absent when the game did not give it. On each item of a list. */
  population?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  populationSlots?: number;
  /** Absent when the game did not give it. On each item of a list. */
  prevalence?: number;
  /** Absent when the game did not give it. On each item of a list. */
  priority?: number;
  /** Absent when the game did not give it. On each item of a list. */
  radius?: number;
  /** Absent when the game did not give it. */
  reflectsNoMembers?: boolean;
  /** Absent when the game did not give it. */
  regionList?: unknown[];
  /** Absent when the game did not give it. */
  regions?: number;
  /** Absent when the game did not give it. */
  regionsTruncated?: boolean;
  /** On each item of a list. */
  slot?: number;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  spawningEnabled?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  species?: string;
  /** Absent when the game did not give it. */
  speciesMix?: Record<string, unknown>;
  /** Absent when the game did not give it. On each item of a list. */
  speciesTruncated?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  tag?: string;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  visitorDeactivationDistance?: number;
  /** Absent when the game did not give it. */
  why?: string;
  /** Absent when the game did not give it. On each item of a list. */
  x?: number;
  /** Absent when the game did not give it. On each item of a list. */
  y?: number;
  /** Absent when the game did not give it. On each item of a list. */
  z?: number;
}

/**
 * Keys the Wildlife population read `census` can carry, at any depth. Not the object's shape.
 */
export interface ReadingWildlife_Census {
  /** Absent when the game did not give it. */
  animalCeiling?: number;
  animals?: Record<string, unknown>;
  /** Absent when the game did not give it. Type not readable from the source. */
  animalSpawning?: unknown;
  /** Absent when the game did not give it. */
  byRole?: Record<string, unknown>;
  bySpecies?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  ceiling?: number;
  /** Absent when the game did not give it. */
  displayNameGameSaid?: Record<string, unknown>;
  displayNameNote?: string;
  displayNameNotItsOwn?: unknown[];
  /** Absent when the game did not give it. Type not readable from the source. */
  displayNames?: unknown;
  enumSource?: string;
  /** Absent when the game did not give it. */
  fishMax?: number;
  /** Absent when the game did not give it. */
  fishMin?: number;
  fishSchools?: Record<string, unknown>;
  sharks?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  sized?: number;
  total?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. */
  unreadableRole?: number;
  /** Absent when the game did not give it. */
  unreadableSpecies?: number;
}

/**
 * Keys the Wildlife population read `feeders` can carry, at any depth. Not the object's shape.
 */
export interface ReadingWildlife_Feeders {
  /** Absent when the game did not give it. */
  animal?: string;
  /** Absent when the game did not give it. */
  asset?: string;
  /** Absent when the game did not give it. */
  baitClassesMissing?: number;
  /** Absent when the game did not give it. */
  baitClassesMissingBreakdown?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  baitClassesNote?: string;
  /** Absent when the game did not give it. */
  baits?: unknown[];
  /** Absent when the game did not give it. */
  baitsNote?: string;
  /** Absent when the game did not give it. */
  baitsSource?: string;
  /** Absent when the game did not give it. */
  baitsTruncated?: boolean;
  /** Absent when the game did not give it. */
  baitsUnreadable?: boolean;
  /** Absent when the game did not give it. */
  baitsUnreadableWhy?: string;
  /** Absent when the game did not give it. On each item of a list. */
  class?: string;
  /** Absent when the game did not give it. */
  contentsNote?: string;
  /** Absent when the game did not give it. */
  couldNotTell?: number;
  /** Absent when the game did not give it. */
  count?: number;
  /** Absent when the game did not give it. */
  damageOnLure?: number;
  /** Absent when the game did not give it. */
  emptyNote?: string;
  /** Absent when the game did not give it. On each item of a list. */
  entityHi?: number;
  /** Absent when the game did not give it. On each item of a list. */
  entityId?: number;
  /** Absent when the game did not give it. On each item of a list. */
  entityLo?: number;
  /** Absent when the game did not give it. */
  feedersUnreadable?: boolean;
  /** Absent when the game did not give it. */
  list?: unknown[];
  /** Absent when the game did not give it. */
  notInThisBuild?: number;
  /** Absent when the game did not give it. */
  shippedButNotLoaded?: number;
  /** Absent when the game did not give it. */
  spawnDistanceMax?: number;
  /** Absent when the game did not give it. */
  spawnDistanceMin?: number;
  /** Absent when the game did not give it. On each item of a list. */
  state?: number;
  /** Absent when the game did not give it. */
  stateNote?: string;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  tuningNote?: string;
  /** Absent when the game did not give it. */
  why?: string;
  /** Absent when the game did not give it. On each item of a list. */
  x?: number;
  /** Absent when the game did not give it. On each item of a list. */
  y?: number;
  /** Absent when the game did not give it. On each item of a list. */
  z?: number;
}

/**
 * Keys the Wildlife population read `fish` can carry, at any depth. Not the object's shape.
 */
export interface ReadingWildlife_Fish {
  /** Absent when the game did not give it. On each item of a list. */
  asset?: string;
  /** Absent when the game did not give it. On each item of a list. */
  chance?: number;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  predator?: unknown;
  presets?: unknown[];
  /** On each item of a list. */
  rows?: unknown[];
  /** Absent when the game did not give it. */
  spawningPresets?: unknown[];
  spawningPresetsUnreadable?: boolean;
  spawningPresetsUnreadableWhy?: string;
  /** Absent when the game did not give it. */
  species?: unknown[] | string;
  /** Absent when the game did not give it. */
  speciesTruncated?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  waterType?: string;
  /** Absent when the game did not give it. */
  waterTypeNote?: string;
  /** Absent when the game did not give it. On each item of a list. */
  weight?: number;
}

/**
 * Keys the Wildlife population read `limits` can carry, at any depth. Not the object's shape.
 */
export interface ReadingWildlife_Limits {
  /** Absent when the game did not give it. On each item of a list. */
  after?: number;
  /** Absent when the game did not give it. On each item of a list. */
  ageNote?: string;
  /** Unit: s. Absent when the game did not give it. On each item of a list. */
  ageSeconds?: number;
  /** Absent when the game did not give it. */
  aquaticManager?: boolean;
  /** On each item of a list. */
  confirm?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  default?: number;
  /** Unit: ms. Absent when the game did not give it. On each item of a list. */
  delayMs?: number;
  /** Absent when the game did not give it. */
  huntingManager?: boolean;
  /** On each item of a list. */
  key?: string;
  keys?: unknown[];
  /** On each item of a list. */
  manager?: string;
  /** On each item of a list. */
  max?: number;
  /** On each item of a list. */
  min?: number;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  moved?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  observed?: Record<string, unknown>;
  replication?: string;
  /** Absent when the game did not give it. On each item of a list. */
  state?: string;
  /** On each item of a list. */
  type?: string;
  /** On each item of a list. */
  value?: number;
  /** On each item of a list. */
  what?: string;
  /** Absent when the game did not give it. On each item of a list. */
  why?: string;
  /** Absent when the game did not give it. On each item of a list. */
  wrote?: number;
}

/**
 * Keys the Wildlife population read `water` can carry, at any depth. Not the object's shape.
 */
export interface ReadingWildlife_Water {
  /** Absent when the game did not give it. On each item of a list. */
  asset?: string;
  /** Absent when the game did not give it. */
  count?: number;
  /** Absent when the game did not give it. On each item of a list. */
  id?: string;
  /** Absent when the game did not give it. */
  list?: unknown[];
  /** Absent when the game did not give it. */
  manager?: Record<string, unknown>;
  /** Absent when the game did not give it. On each item of a list. */
  maxIndicators?: number;
  /** Absent when the game did not give it. On each item of a list. */
  maxIndicatorsPerPlayer?: number;
  /** Absent when the game did not give it. On each item of a list. */
  maxSchools?: number;
  /** Absent when the game did not give it. */
  presetNamesUnreadable?: boolean;
  /** Absent when the game did not give it. */
  presetNamesUnreadableWhy?: string;
  /** Absent when the game did not give it. On each item of a list. */
  requiredDepth?: number;
  /** Absent when the game did not give it. */
  sharkSpecies?: unknown[];
  /** Absent when the game did not give it. */
  sharkSpeciesUnreadable?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  specialTag?: string;
  /** Absent when the game did not give it. */
  specialTagged?: number;
  /** Absent when the game did not give it. */
  specialTagNote?: string;
  /** Absent when the game did not give it. On each item of a list. */
  speciesPreset?: string;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. */
  volumes?: Record<string, unknown>;
  /** Absent when the game did not give it. On each item of a list. */
  water?: string;
}

/**
 * Keys the Levels and streaming read `distant` can carry, at any depth. Not the object's shape.
 */
export interface ReadingWorld_Distant {
  descriptions?: number;
  /** Type not readable from the source. */
  levels?: unknown;
  /** Absent when the game did not give it. */
  listCapped?: boolean;
  /** Unit: cm. Absent when the game did not give it. On each item of a list. */
  maxDrawDistanceCm?: number;
  /** Absent when the game did not give it. On each item of a list. */
  meshLODs?: number;
  /** Absent when the game did not give it. On each item of a list. */
  name?: string;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  neverDistanceCull?: unknown;
  returned?: number;
  /** Absent when the game did not give it. On each item of a list. */
  streaming?: string;
  /** Absent when the game did not give it. */
  truncated?: boolean;
}

/**
 * Keys the Levels and streaming read `find:<text>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingWorld_Find {
  emptyReason?: "every level is already loaded; this is normal." | "no level is loaded; spawns and placements will do nothing." | "no level name contains that text; try a shorter fragment." | "the level list is still being built; ask again in a moment.";
  filter?: string;
  /** Absent when the game did not give it. */
  find?: string;
  /** Absent when the game did not give it. On each item of a list. */
  level?: string;
  /** Type not readable from the source. */
  levels?: unknown;
  /** Absent when the game did not give it. */
  listCapped?: boolean;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  loaded?: unknown;
  matched?: number;
  /** Absent when the game did not give it. On each item of a list. */
  package?: string;
  /** Absent when the game did not give it. */
  persistentLevel?: string;
  returned?: number;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  shouldBeLoaded?: unknown;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  shouldBeVisible?: unknown;
  streamingLevels?: number;
  /** Absent when the game did not give it. */
  templates?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  visible?: unknown;
  worldSource?: string;
}

/**
 * Keys the Levels and streaming read `level:<name>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingWorld_Level {
  /** Absent when the game did not give it. */
  actors?: number;
  asked?: string;
  /** Absent when the game did not give it. */
  contents?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  extentNote?: "for the map's edges ask place world or zones border.";
  /** Absent when the game did not give it. Type not readable from the source. */
  hasLevelScript?: unknown;
  /** Type not readable from the source. */
  hasWorldSettings?: unknown;
  /** Absent when the game did not give it. */
  hint?: "use find: to list the levels this map really has";
  /** Absent when the game did not give it. */
  known?: boolean;
  /** Absent when the game did not give it. */
  level?: string;
  /** Absent when the game did not give it. */
  loaded?: boolean;
  /** Absent when the game did not give it. */
  lodPackages?: number;
  /** Absent when the game did not give it. */
  package?: string;
  /** Absent when the game did not give it. */
  packageToLoad?: string;
  /** Absent when the game did not give it. */
  pendingUnload?: boolean;
  /** Absent when the game did not give it. */
  persistent?: boolean;
  /** Absent when the game did not give it. */
  reason?: "lookup_unavailable";
  /** Absent when the game did not give it. Type not readable from the source. */
  shouldBeLoaded?: unknown;
  /** Absent when the game did not give it. */
  shouldBeLoadedDisagrees?: boolean;
  /** Absent when the game did not give it. Type not readable from the source. */
  shouldBeLoadedFlag?: unknown;
  /** Absent when the game did not give it. */
  streamingEntry?: boolean;
  /** Absent when the game did not give it. Type not readable from the source. */
  visible?: unknown;
  /** Absent when the game did not give it. */
  visibleDisagrees?: boolean;
  /** Absent when the game did not give it. Type not readable from the source. */
  visibleFlag?: unknown;
  /** Absent when the game did not give it. */
  worldSettings?: string;
}

/**
 * Keys the Levels and streaming read `levels` can carry, at any depth. Not the object's shape.
 */
export interface ReadingWorld_Levels {
  emptyReason?: "every level is already loaded; this is normal." | "no level is loaded; spawns and placements will do nothing." | "no level name contains that text; try a shorter fragment." | "the level list is still being built; ask again in a moment.";
  filter?: string;
  /** Absent when the game did not give it. */
  find?: string;
  /** Absent when the game did not give it. On each item of a list. */
  level?: string;
  /** Type not readable from the source. */
  levels?: unknown;
  /** Absent when the game did not give it. */
  listCapped?: boolean;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  loaded?: unknown;
  matched?: number;
  /** Absent when the game did not give it. On each item of a list. */
  package?: string;
  /** Absent when the game did not give it. */
  persistentLevel?: string;
  returned?: number;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  shouldBeLoaded?: unknown;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  shouldBeVisible?: unknown;
  streamingLevels?: number;
  /** Absent when the game did not give it. */
  templates?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  visible?: unknown;
  worldSource?: string;
}

/**
 * Keys the Levels and streaming read `managers` can carry, at any depth. Not the object's shape.
 */
export interface ReadingWorld_Managers {
  /** Absent when the game did not give it. */
  absentReason?: string;
  buildingManager?: Record<string, unknown>;
  buildings?: number;
  /** Absent when the game did not give it. */
  cleared?: number;
  /** Absent when the game did not give it. */
  descriptions?: number;
  distantLevelManager?: Record<string, unknown>;
  emptyReason?: "no persistent collision held; normal when every level is loaded." | "this table is empty; for standing bases use the bases module.";
  /** Absent when the game did not give it. */
  noClearedFlag?: boolean;
  persistentCollisionManager?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  present?: boolean;
  /** Absent when the game did not give it. */
  recentlyUsedMeshes?: number;
  /** Absent when the game did not give it. */
  sample?: unknown[];
  /** Absent when the game did not give it. */
  sampleOf?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
}

/**
 * Keys the Levels and streaming read `summary` can carry, at any depth. Not the object's shape.
 */
export interface ReadingWorld_Summary {
  emptyReason?: "the level list is still being built; ask again in a moment.";
  loaded?: number;
  loadedNotVisible?: number;
  /** Absent when the game did not give it. */
  persistentLevel?: string;
  streamingLevels?: number;
  /** Absent when the game did not give it. */
  templates?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  unloaded?: number;
  unnamed?: number;
  /** Absent when the game did not give it. */
  unreadable?: number;
  visibilityCounted?: boolean;
  /** Absent when the game did not give it. */
  visibilityUnreadable?: number;
  visible?: number;
  wantLoaded?: number;
  wantVisible?: number;
  worldSource?: string;
}

/**
 * Keys the Live world events read `events` can carry, at any depth. Not the object's shape.
 */
export interface ReadingWorldevents_Events {
  activationEnd?: number;
  activationStart?: number;
  /** Absent when the game did not give it. */
  active?: number;
  /** Absent when the game did not give it. */
  actorX?: number;
  /** Absent when the game did not give it. */
  actorY?: number;
  /** Absent when the game did not give it. */
  actorZ?: number;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  alarm?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  alarmedRooms?: number;
  /** Absent when the game did not give it. */
  announced?: number;
  /** Absent when the game did not give it. */
  bunkerClock?: string;
  /** Absent when the game did not give it. */
  bunkers?: unknown[];
  /** Absent when the game did not give it. */
  bunkersEmptyReason?: "Bunkers are not loaded yet. Ask again in a minute.";
  /** Absent when the game did not give it. */
  cargo?: unknown[];
  /** On each item of a list. */
  class?: string;
  /** Absent when the game did not give it. */
  current?: number;
  /** Absent when the game did not give it. On each item of a list. */
  detonatesIn?: number;
  /** Absent when the game did not give it. */
  ended?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  eventLists?: unknown;
  /** Type not readable from the source. */
  eventManager?: unknown;
  /** Absent when the game did not give it. Type not readable from the source. */
  events?: unknown;
  /** Absent when the game did not give it. */
  eventsEmptyReason?: "Events are not set up yet. Ask again in a minute.";
  /** Absent when the game did not give it. */
  eventTypes?: number;
  /** Absent when the game did not give it. On each item of a list. */
  fallingSpeed?: number;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  flare?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  floors?: number;
  /** Absent when the game did not give it. */
  historyLimit?: number;
  /** Absent when the game did not give it. On each item of a list. */
  id?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  keyCarried?: unknown;
  /** Absent when the game did not give it. */
  keyCarrier?: string;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  landed?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  listedAs?: string;
  /** Absent when the game did not give it. On each item of a list. */
  locationName?: string;
  lockers?: number;
  /** Absent when the game did not give it. */
  lockersTruncated?: boolean;
  /** Unit: min. Absent when the game did not give it. */
  maxMinutes?: number;
  /** Unit: min. Absent when the game did not give it. */
  minMinutes?: number;
  /** Absent when the game did not give it. On each item of a list. */
  name?: string;
  /** Absent when the game did not give it. */
  note?: "'Announced' only means the location exists; 'running' means it is on.";
  overridden?: boolean;
  overrideEnd?: number;
  overrideStart?: number;
  /** Absent when the game did not give it. */
  phase?: string;
  phaseNote?: "Not running; the phase shown means nothing until it starts.";
  players?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  positionKnown?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  poweredRooms?: number;
  previousActivationEnd?: number;
  /** Absent when the game did not give it. On each item of a list. */
  radius?: number;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  randomPickable?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  registered?: number;
  /** Absent when the game did not give it. */
  reportsNothing?: string;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  running?: unknown;
  score?: number;
  /** Absent when the game did not give it. On each item of a list. Type not readable from the source. */
  secret?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  selector?: string;
  scheduled?: boolean;
  scheduleNote?: "No activation window yet; the times shown are placeholders.";
  /** Absent when the game did not give it. */
  state?: string;
  /** Absent when the game did not give it. Type not readable from the source. */
  targetSet?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  team?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. */
  unit?: "minutes";
  /** Absent when the game did not give it. */
  worldEvents?: unknown[];
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  yaw?: number;
  /** Absent when the game did not give it. */
  z?: number;
}

/**
 * Keys the Live world events read `ledger:at:<steamId>:<ms>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingWorldevents_Ledger {
  /** Absent when the game did not give it. */
  at?: number;
  class?: string;
  cost?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  coverSince?: number;
  /** Absent when the game did not give it. On each item of a list. */
  ended?: number;
  /** Absent when the game did not give it. */
  event?: Record<string, unknown> | string;
  failedPolls?: number;
  /** On each item of a list. */
  firstSeen?: number;
  id?: string;
  /** Absent when the game did not give it. On each item of a list. */
  index?: number;
  /** Type not readable from the source. */
  inEvent?: unknown;
  /** Absent when the game did not give it. On each item of a list. */
  inPlay?: unknown[];
  /** Absent when the game did not give it. */
  lastPoll?: number;
  /** Absent when the game did not give it. On each item of a list. */
  locationName?: string;
  /** Absent when the game did not give it. */
  matchedBy?: string;
  /** Absent when the game did not give it. */
  name?: string;
  notifications?: unknown[];
  notificationsSeen?: number;
  /** On each item of a list. */
  participants?: unknown[];
  /** On each item of a list. */
  phase?: string;
  /** Absent when the game did not give it. On each item of a list. */
  player?: string;
  /** Unit: ms. */
  pollEveryMs?: number;
  polls?: number;
  pollUsAvg?: number;
  pollUsMax?: number;
  processEvents?: number;
  processEventsLastMinute?: number;
  /** Absent when the game did not give it. On each item of a list. */
  registered?: number;
  /** Absent when the game did not give it. On each item of a list. */
  removed?: boolean;
  /** Absent when the game did not give it. */
  run?: number;
  runs?: unknown[];
  /** Absent when the game did not give it. On each item of a list. */
  started?: number;
  /** Absent when the game did not give it. */
  state?: string;
  /** Absent when the game did not give it. */
  steamId?: string;
  /** Absent when the game did not give it. On each item of a list. */
  team?: number;
  /** Absent when the game did not give it. On each item of a list. */
  type?: string;
  unit?: "times are epoch milliseconds; inPlay is the first and last poll in play";
  /** Absent when the game did not give it. On each item of a list. */
  x?: number;
  /** Absent when the game did not give it. On each item of a list. */
  y?: number;
  /** Absent when the game did not give it. On each item of a list. */
  z?: number;
}

/**
 * Keys the Custom zones read `border` can carry, at any depth. Not the object's shape.
 */
export interface ReadingZones_Border {
  /** Absent when the game did not give it. Type not readable from the source. */
  active?: unknown;
  maxX?: number;
  maxY?: number;
  minX?: number;
  minY?: number;
  /** Absent when the game did not give it. */
  set?: boolean;
  /** Absent when the game did not give it. */
  tournamentCompletion?: number;
  /** Absent when the game did not give it. Type not readable from the source. */
  tournamentMode?: unknown;
}

/**
 * Keys the Custom zones read `config:rename:<index>:<name>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingZones_Config {
  color?: unknown[];
  damage?: unknown[];
  damageGroups?: unknown[];
  /** Absent when the game did not give it. */
  defaultState?: number;
  events?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  gameDefault?: boolean;
  /** On each item of a list. */
  handling?: string;
  /** On each item of a list. */
  channel?: string;
  /** On each item of a list. */
  channels?: number;
  index?: number;
  /** On each item of a list. */
  instigator?: string;
  name?: string;
  /** On each item of a list. */
  receiver?: string;
  setting?: string;
  settingBits?: boolean;
  settingNote?: "Several are on. Send them joined with '|', or send settingRaw back, to keep all.";
  settingRaw?: number;
}

/**
 * Keys the Custom zones read `defaults` can carry, at any depth. Not the object's shape.
 */
export interface ReadingZones_Defaults {
  /** On each item of a list. */
  config?: number;
  count?: number;
  defaults?: unknown[];
  /** On each item of a list. */
  height?: number;
  /** Absent when the game did not give it. On each item of a list. */
  liveName?: string;
  liveSetKnown?: boolean;
  /** On each item of a list. */
  name?: string;
  /** Absent when the game did not give it. On each item of a list. */
  onServer?: boolean;
  /** On each item of a list. */
  shape?: string;
  /** Absent when the game did not give it. On each item of a list. */
  state?: string;
  /** On each item of a list. */
  width?: number;
  /** On each item of a list. */
  x?: number;
  /** On each item of a list. */
  y?: number;
}

/**
 * Keys the Custom zones read `enums` can carry, at any depth. Not the object's shape.
 */
export interface ReadingZones_Enums {
  damageGroupCustom?: string;
  event?: unknown[];
  handling?: unknown[];
  channel?: unknown[];
  instigator?: unknown[];
  orderWord?: unknown[];
  receiver?: unknown[];
  setting?: unknown[];
  shape?: unknown[];
  state?: unknown[];
}

/**
 * Keys the Custom zones read `global` can carry, at any depth. Not the object's shape.
 */
export interface ReadingZones_Global {
  color?: unknown[];
  damage?: unknown[];
  damageGroups?: unknown[];
  /** Absent when the game did not give it. */
  defaultState?: number;
  events?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  gameDefault?: boolean;
  /** On each item of a list. */
  handling?: string;
  /** On each item of a list. */
  channel?: string;
  /** On each item of a list. */
  channels?: number;
  index?: number;
  /** On each item of a list. */
  instigator?: string;
  name?: string;
  /** On each item of a list. */
  receiver?: string;
  setting?: string;
  settingBits?: boolean;
  settingNote?: "Several are on. Send them joined with '|', or send settingRaw back, to keep all.";
  settingRaw?: number;
}

/**
 * Keys the Custom zones read `guarded` can carry, at any depth. Not the object's shape.
 */
export interface ReadingZones_Guarded {
  /** Absent when the game did not give it. */
  fields?: unknown[];
  /** Absent when the game did not give it. */
  global?: Record<string, unknown>;
  /** Absent when the game did not give it. On each item of a list. */
  key?: string;
  /** Absent when the game did not give it. */
  level?: string;
  /** Absent when the game did not give it. On each item of a list. */
  max?: number;
  /** Absent when the game did not give it. */
  sentrySpawners?: number;
  /** Absent when the game did not give it. */
  truncated?: boolean;
  /** Absent when the game did not give it. On each item of a list. */
  type?: "float" | "int";
  /** Absent when the game did not give it. On each item of a list. */
  value?: number;
  /** Absent when the game did not give it. On each item of a list. */
  what?: string;
  /** Absent when the game did not give it. On each item of a list. */
  writable?: boolean;
  /** Absent when the game did not give it. */
  x?: number;
  /** Absent when the game did not give it. */
  y?: number;
  /** Absent when the game did not give it. */
  z?: number;
  /** Absent when the game did not give it. */
  zones?: unknown[];
  /** Absent when the game did not give it. */
  zonesUnreadable?: boolean;
  /** Absent when the game did not give it. */
  zonesWhy?: string;
}

/**
 * Keys the Custom zones read `spawners:<x>:<y>:<radius>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingZones_Spawners {
  /** Absent when the game did not give it. */
  activationDistance?: number;
  /** Absent when the game did not give it. */
  activationVaries?: boolean;
  /** Absent when the game did not give it. */
  found?: number;
  level?: string;
  /** Absent when the game did not give it. */
  levels?: unknown[];
  /** Absent when the game did not give it. */
  note?: "Levels of sentries standing in the circle now. Ask without a circle for every level." | "Posts show only shortly after a server start. Nothing here stops a place making sentries.";
  posts?: number;
  /** Absent when the game did not give it. */
  respawning?: number;
  /** Absent when the game did not give it. */
  respawnRead?: number;
  sentriesStanding?: number;
}

/**
 * Keys the Custom zones read `zone:<name>` can carry, at any depth. Not the object's shape.
 */
export interface ReadingZones_Zone {
  color?: unknown[];
  config?: number;
  /** Absent when the game did not give it. On each item of a list. */
  configuration?: Record<string, unknown>;
  damage?: unknown[];
  damageGroups?: unknown[];
  /** Absent when the game did not give it. */
  defaultState?: number;
  events?: Record<string, unknown>;
  /** Absent when the game did not give it. */
  gameDefault?: boolean;
  /** On each item of a list. */
  handling?: string;
  height?: number;
  /** On each item of a list. */
  channel?: string;
  /** On each item of a list. */
  channels?: number;
  index?: number;
  /** On each item of a list. */
  instigator?: string;
  name?: string;
  /** Absent when the game did not give it. */
  order?: number;
  /** On each item of a list. */
  receiver?: string;
  setting?: string;
  settingBits?: boolean;
  settingNote?: "Several are on. Send them joined with '|', or send settingRaw back, to keep all.";
  settingRaw?: number;
  shape?: string;
  state?: string;
  width?: number;
  x?: number;
  y?: number;
  /** Absent when the game did not give it. On each item of a list. */
  zone?: Record<string, unknown>;
}

/**
 * Keys the Custom zones read `zones` can carry, at any depth. Not the object's shape.
 */
export interface ReadingZones_Zones {
  /** Unit: ms. */
  ageMs?: number;
  config?: number;
  configCount?: number;
  configLimit?: number;
  configs?: unknown[];
  damageRules?: number;
  /** Absent when the game did not give it. */
  defaultState?: number;
  /** Absent when the game did not give it. */
  gameDefault?: boolean;
  height?: number;
  /** Absent when the game did not give it. */
  hint?: "send command 'refresh' and read again in a moment";
  index?: number;
  /** Absent when the game did not give it. */
  known?: boolean;
  name?: string;
  /** Absent when the game did not give it. */
  order?: number;
  orderMatters?: string;
  setting?: string;
  settingBits?: boolean;
  settingNote?: "Several are on. Send them joined with '|', or send settingRaw back, to keep all.";
  settingRaw?: number;
  shape?: string;
  state?: string;
  usedBy?: number;
  width?: number;
  writable?: boolean;
  x?: number;
  y?: number;
  zoneCount?: number;
  zoneLimit?: number;
  /** Absent when the game did not give it. */
  zones?: unknown[] | null;
}

/**
 * The keys each read's answer can carry, by module and by query name (the verb, not the whole
 * `what` string). A key is absent when the game did not give it: absent never means zero.
 * A read missing here is one whose payload this generator could not follow.
 */
export interface ModuleReadings {
  "actions": {
    "state": ReadingActions_State;
  };
  "ai": {
    "counts": ReadingAi_Counts;
    "creature": ReadingAi_Creature;
    "fields": ReadingAi_Fields;
    "hunting": ReadingAi_Hunting;
    "near": ReadingAi_Near;
    "threats": ReadingAi_Threats;
  };
  "bases": {
    "bases": ReadingBases_Bases;
    "contents": ReadingBases_Contents;
    "protection": ReadingBases_Protection;
  };
  "build": {
    "bases": ReadingBuild_Bases;
    "build": ReadingBuild_Build;
    "elements": ReadingBuild_Elements;
  };
  "climate": {
    "curves": ReadingClimate_Curves;
    "get": ReadingClimate_Get;
    "groups": ReadingClimate_Groups;
    "members": ReadingClimate_Members;
    "rolls": ReadingClimate_Rolls;
    "state": ReadingClimate_State;
    "switches": ReadingClimate_Switches;
  };
  "craft": {
    "cookrecipes": ReadingCraft_Cookrecipes;
    "craft": ReadingCraft_Craft;
    "craftEvents": ReadingCraft_CraftEvents;
    "fishing": ReadingCraft_Fishing;
    "placements": ReadingCraft_Placements;
  };
  "damage": {
    "last": ReadingDamage_Last;
    "preview": ReadingDamage_Preview;
  };
  "despawn": {
    "here": ReadingDespawn_Here;
    "kinds": ReadingDespawn_Kinds;
    "preview": ReadingDespawn_Preview;
  };
  "doors": {
    "classes": ReadingDoors_Classes;
    "door": ReadingDoors_Door;
    "levels": ReadingDoors_Levels;
  };
  "encounters": {
    "bases": ReadingEncounters_Bases;
    "encounters": ReadingEncounters_Encounters;
    "hordes": ReadingEncounters_Hordes;
    "nearby": ReadingEncounters_Nearby;
    "places": ReadingEncounters_Places;
    "schedule": ReadingEncounters_Schedule;
    "tuning": ReadingEncounters_Tuning;
  };
  "entities": {
    "bases": ReadingEntities_Bases;
    "entities": ReadingEntities_Entities;
    "entity": ReadingEntities_Entity;
    "kinds": ReadingEntities_Kinds;
  };
  "events": {
    "events": ReadingEvents_Events;
    "peek": ReadingEvents_Peek;
    "watches": ReadingEvents_Watches;
  };
  "farming": {
    "farming": ReadingFarming_Farming;
    "garden": ReadingFarming_Garden;
  };
  "fortifications": {
    "events": ReadingFortifications_Events;
    "fortifications": ReadingFortifications_Fortifications;
    "ledger": ReadingFortifications_Ledger;
    "near": ReadingFortifications_Near;
    "openings": ReadingFortifications_Openings;
    "owner": ReadingFortifications_Owner;
  };
  "give": {
    "last": ReadingGive_Last;
  };
  "hazard": {
    "exposure": ReadingHazard_Exposure;
    "get": ReadingHazard_Get;
    "groups": ReadingHazard_Groups;
    "job": ReadingHazard_Job;
    "measure": ReadingHazard_Measure;
    "state": ReadingHazard_State;
    "zones": ReadingHazard_Zones;
  };
  "items": {
    "attachjob": ReadingItems_Attachjob;
    "attachments": ReadingItems_Attachments;
    "counts": ReadingItems_Counts;
    "inventory": ReadingItems_Inventory;
    "last": ReadingItems_Last;
    "near": ReadingItems_Near;
    "traps": ReadingItems_Traps;
    "where": ReadingItems_Where;
  };
  "killbox": {
    "apex": ReadingKillbox_Apex;
    "killbox": ReadingKillbox_Killbox;
  };
  "live": {
    "kills": ReadingLive_Kills;
    "players": ReadingLive_Players;
    "server": ReadingLive_Server;
    "world": ReadingLive_World;
  };
  "locks": {
    "locked": ReadingLocks_Locked;
    "locks": ReadingLocks_Locks;
    "near": ReadingLocks_Near;
    "replication": ReadingLocks_Replication;
    "saved": ReadingLocks_Saved;
  };
  "loot": {
    "files": ReadingLoot_Files;
  };
  "medical": {
    "catalogue": ReadingMedical_Catalogue;
    "conditions": ReadingMedical_Conditions;
    "deaths": ReadingMedical_Deaths;
    "fields": ReadingMedical_Fields;
    "lastcure": ReadingMedical_Lastcure;
    "lastchange": ReadingMedical_Lastchange;
    "lastmeta": ReadingMedical_Lastmeta;
    "player": ReadingMedical_Player;
    "players": ReadingMedical_Players;
    "severities": ReadingMedical_Severities;
    "substances": ReadingMedical_Substances;
  };
  "notify": {
    "queue": ReadingNotify_Queue;
  };
  "offline": {
    "encounterBases": ReadingOffline_EncounterBases;
    "flag": ReadingOffline_Flag;
    "changes": ReadingOffline_Changes;
    "mode": ReadingOffline_Mode;
    "requests": ReadingOffline_Requests;
    "rules": ReadingOffline_Rules;
    "state": ReadingOffline_State;
  };
  "place": {
    "world": ReadingPlace_World;
  };
  "power": {
    "cooking": ReadingPower_Cooking;
    "heat": ReadingPower_Heat;
    "power": ReadingPower_Power;
  };
  "protect": {
    "calls": ReadingProtect_Calls;
    "flag": ReadingProtect_Flag;
    "changes": ReadingProtect_Changes;
    "layout": ReadingProtect_Layout;
    "manager": ReadingProtect_Manager;
    "offline": ReadingProtect_Offline;
    "protections": ReadingProtect_Protections;
  };
  "quests": {
    "activity": ReadingQuests_Activity;
    "areas": ReadingQuests_Areas;
    "catalogue": ReadingQuests_Catalogue;
    "givers": ReadingQuests_Givers;
    "outposts": ReadingQuests_Outposts;
    "player": ReadingQuests_Player;
    "quest": ReadingQuests_Quest;
    "quests": ReadingQuests_Quests;
    "timed": ReadingQuests_Timed;
  };
  "raid": {
    "all": ReadingRaid_All;
    "announcements": ReadingRaid_Announcements;
    "base": ReadingRaid_Base;
    "bases": ReadingRaid_Bases;
    "encounters": ReadingRaid_Encounters;
    "raids": ReadingRaid_Raids;
    "reasons": ReadingRaid_Reasons;
  };
  "repair": {
    "resolve": ReadingRepair_Resolve;
  };
  "report": {
    "status": ReadingReport_Status;
  };
  "resources": {
    "resources": ReadingResources_Resources;
    "stations": ReadingResources_Stations;
  };
  "respawn": {
    "timers": ReadingRespawn_Timers;
  };
  "settings": {
    "categories": ReadingSettings_Categories;
    "get": ReadingSettings_Get;
    "changes": ReadingSettings_Changes;
    "list": ReadingSettings_List;
    "outstanding": ReadingSettings_Outstanding;
    "probe": ReadingSettings_Probe;
    "section": ReadingSettings_Section;
    "values": ReadingSettings_Values;
    "valuesfrom": ReadingSettings_Valuesfrom;
  };
  "spawn": {
    "check": ReadingSpawn_Check;
    "kinds": ReadingSpawn_Kinds;
    "loadcheck": ReadingSpawn_Loadcheck;
    "persistence": ReadingSpawn_Persistence;
    "persistent": ReadingSpawn_Persistent;
    "spawn": ReadingSpawn_Spawn;
  };
  "spawnpoints": {
    "list": ReadingSpawnpoints_List;
    "map": ReadingSpawnpoints_Map;
    "respawn": ReadingSpawnpoints_Respawn;
  };
  "squads": {
    "board": ReadingSquads_Board;
    "destroyed": ReadingSquads_Destroyed;
    "member": ReadingSquads_Member;
    "names": ReadingSquads_Names;
    "squad": ReadingSquads_Squad;
    "squads": ReadingSquads_Squads;
  };
  "stash": {
    "check": ReadingStash_Check;
    "job": ReadingStash_Job;
    "jobs": ReadingStash_Jobs;
  };
  "stats": {
    "attributes": ReadingStats_Attributes;
    "fame": ReadingStats_Fame;
    "kills": ReadingStats_Kills;
    "lastskill": ReadingStats_Lastskill;
    "ranking": ReadingStats_Ranking;
    "rankwords": ReadingStats_Rankwords;
    "skillinfo": ReadingStats_Skillinfo;
    "skills": ReadingStats_Skills;
    "stats": ReadingStats_Stats;
  };
  "storage": {
    "contents": ReadingStorage_Contents;
    "dropcheck": ReadingStorage_Dropcheck;
    "lastdestroy": ReadingStorage_Lastdestroy;
    "lockboxes": ReadingStorage_Lockboxes;
    "storage": ReadingStorage_Storage;
  };
  "teleport": {
    "corpses": ReadingTeleport_Corpses;
    "inflight": ReadingTeleport_Inflight;
    "origin": ReadingTeleport_Origin;
    "origins": ReadingTeleport_Origins;
  };
  "trade": {
    "bank": ReadingTrade_Bank;
    "economy": ReadingTrade_Economy;
    "prices": ReadingTrade_Prices;
    "trade": ReadingTrade_Trade;
    "writable": ReadingTrade_Writable;
  };
  "vehicles": {
    "manager": ReadingVehicles_Manager;
    "vehicles": ReadingVehicles_Vehicles;
  };
  "virtual": {
    "containers": ReadingVirtual_Containers;
    "owners": ReadingVirtual_Owners;
    "repdata": ReadingVirtual_Repdata;
    "survey": ReadingVirtual_Survey;
    "virtualized": ReadingVirtual_Virtualized;
  };
  "vote": {
    "tournament": ReadingVote_Tournament;
    "vote": ReadingVote_Vote;
  };
  "wake": {
    "near": ReadingWake_Near;
    "reach": ReadingWake_Reach;
    "visitors": ReadingWake_Visitors;
  };
  "wildlife": {
    "biomes": ReadingWildlife_Biomes;
    "census": ReadingWildlife_Census;
    "feeders": ReadingWildlife_Feeders;
    "fish": ReadingWildlife_Fish;
    "limits": ReadingWildlife_Limits;
    "water": ReadingWildlife_Water;
  };
  "world": {
    "distant": ReadingWorld_Distant;
    "find": ReadingWorld_Find;
    "level": ReadingWorld_Level;
    "levels": ReadingWorld_Levels;
    "managers": ReadingWorld_Managers;
    "summary": ReadingWorld_Summary;
  };
  "worldevents": {
    "events": ReadingWorldevents_Events;
    "ledger": ReadingWorldevents_Ledger;
  };
  "zones": {
    "border": ReadingZones_Border;
    "config": ReadingZones_Config;
    "defaults": ReadingZones_Defaults;
    "enums": ReadingZones_Enums;
    "global": ReadingZones_Global;
    "guarded": ReadingZones_Guarded;
    "spawners": ReadingZones_Spawners;
    "zone": ReadingZones_Zone;
    "zones": ReadingZones_Zones;
  };
}

/** The keys of one read, e.g. `ReadingOf<'zones', 'zones'>`. Use it as `BridgeReply<ReadingOf<…>>`. */
export type ReadingOf<M extends keyof ModuleReadings, Q extends keyof ModuleReadings[M]> = ModuleReadings[M][Q];

// ── what a write needs, and whether it survives a restart ─────────────────────────────────────

/**
 * What must be there before a write can act. A write that needs a player refuses on an empty
 * server and says so.
 *
 * - `no-player`: No player needed. Works with nobody online.
 * - `loaded-target`: Target must be loaded. Works with nobody online only when the game keeps the target loaded. Doors, bases and lockpick crates stay loaded; vehicles and creatures are built only near a player.
 * - `player-channel`: Any player online. Goes through an online player's connection, so somebody must be on the server.
 * - `player-target`: That player online. Acts on the named player, who must be online.
 * - `admin-command`: Any player online (admin command). Runs one of the game's admin commands, which the game only runs through an online player.
 * - `refuses`: Always refuses. Kept so a caller gets a reason; the game gives this verb no working route.
 * - `own-records`: Bridge records only. Changes the bridge's own bookkeeping, not the game.
 * - `condition`: Needs a condition. Works with nobody online, but only once the condition its note names holds.
 */
export type VerbNeeds = "no-player" | "loaded-target" | "player-channel" | "player-target" | "admin-command" | "refuses" | "own-records" | "condition";

/**
 * Whether what a write changes is still there after the server restarts. Only `survives` and
 * `lost` are measurements.
 *
 * - `survives`: Survives. Measured to be in the save after a restart.
 * - `lost`: Lost. Measured to revert, or never saved.
 * - `unmeasured`: Not measured. Nobody has measured whether it survives a restart.
 * - `n-a`: Does not apply. Changes nothing that a restart could keep, such as a message or a read.
 */
export type VerbPersistence = "survives" | "lost" | "unmeasured" | "n-a";

/**
 * Whether a write makes something new, and whether the game registers it (an entity id and a
 * save row). Only `registered` is a measurement of the save.
 *
 * - `none`: Nothing. Creates nothing new in the world.
 * - `registered`: Registered. Made through the game's own route and kept in the game's own records, an entity id and a save row for an item, so the game brings it back after a restart.
 * - `game-route`: The game's own route. Made through the game's own command or logic, so the game keeps it exactly as it keeps one it made itself. Whether that kind gets a save row was not measured here.
 * - `unregistered`: Not registered. No route in the game registers it: it has no entity id and no save row, and the reply says so.
 */
export type VerbCreates = "none" | "registered" | "game-route" | "unregistered";

/**
 * Every write's requirement and persistence, by module and by verb name. `persistable` is
 * present on a write a restart may undo: `true` when the bridge keeps it on request
 * (`persist: true`, see `PersistOutcome`), `false` when it does not.
 */
export interface ModuleWriteNeeds {
  "actions": {
    "ammo": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: true };
    "cough": { needs: "player-target"; persists: "n-a"; creates: "none" };
    "crouch": { needs: "player-target"; persists: "lost"; creates: "none"; persistable: false };
    "cuffpart": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: true };
    "cufftight": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: true };
    "dbfame": { needs: "admin-command"; persists: "survives"; creates: "none" };
    "dbfameadd": { needs: "admin-command"; persists: "survives"; creates: "none" };
    "dbgold": { needs: "admin-command"; persists: "survives"; creates: "none" };
    "dbgoldadd": { needs: "admin-command"; persists: "survives"; creates: "none" };
    "dbmoney": { needs: "admin-command"; persists: "survives"; creates: "none" };
    "dbmoneyadd": { needs: "admin-command"; persists: "survives"; creates: "none" };
    "defecate": { needs: "player-target"; persists: "n-a"; creates: "none" };
    "detonate": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "disarm": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "fade": { needs: "player-target"; persists: "n-a"; creates: "none" };
    "fakename": { needs: "player-target"; persists: "lost"; creates: "none"; persistable: true };
    "fame": { needs: "player-target"; persists: "survives"; creates: "none" };
    "freelook": { needs: "player-target"; persists: "lost"; creates: "none"; persistable: true };
    "gender": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "godmode": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: true };
    "gold": { needs: "player-target"; persists: "lost"; creates: "none"; persistable: false };
    "hud": { needs: "player-target"; persists: "n-a"; creates: "none" };
    "immortal": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: true };
    "kick": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "killfeed": { needs: "player-target"; persists: "n-a"; creates: "none" };
    "limp": { needs: "player-target"; persists: "lost"; creates: "none"; persistable: true };
    "limpclear": { needs: "player-target"; persists: "n-a"; creates: "none" };
    "load": { needs: "player-target"; persists: "n-a"; creates: "none" };
    "money": { needs: "player-target"; persists: "lost"; creates: "none"; persistable: false };
    "nightvision": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: true };
    "pace": { needs: "player-target"; persists: "lost"; creates: "none"; persistable: true };
    "repossess": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "revive": { needs: "player-target"; persists: "survives"; creates: "none" };
    "save": { needs: "player-target"; persists: "survives"; creates: "none" };
    "silence": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "sneeze": { needs: "player-target"; persists: "n-a"; creates: "none" };
    "spawnscreen": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "squadcreate": { needs: "player-target"; persists: "unmeasured"; creates: "game-route"; persistable: false };
    "squaddemote": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "squadjoin": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "squadleave": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "squadpromote": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "squadquit": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "strip": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "suicide": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "suicidetime": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "superjump": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: true };
    "uncuff": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "unmount": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "unsilence": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "urinate": { needs: "player-target"; persists: "n-a"; creates: "none" };
    "vomit": { needs: "player-target"; persists: "n-a"; creates: "none" };
    "wetness": { needs: "player-target"; persists: "survives"; creates: "none" };
  };
  "ai": {
    "health": { needs: "loaded-target"; persists: "lost"; creates: "none"; persistable: false };
    "hostile": { needs: "loaded-target"; persists: "lost"; creates: "none"; persistable: false };
    "move": { needs: "loaded-target"; persists: "lost"; creates: "none"; persistable: false };
    "remove": { needs: "loaded-target"; persists: "lost"; creates: "none"; persistable: false };
    "set": { needs: "loaded-target"; persists: "lost"; creates: "none"; persistable: false };
    "stance": { needs: "loaded-target"; persists: "lost"; creates: "none"; persistable: false };
    "target": { needs: "loaded-target"; persists: "lost"; creates: "none"; persistable: false };
  };
  "build": {
    "catalogue": { needs: "own-records"; persists: "n-a"; creates: "none" };
    "clearowner": { needs: "no-player"; persists: "survives"; creates: "none" };
    "demolish": { needs: "no-player"; persists: "survives"; creates: "none" };
    "destroy": { needs: "no-player"; persists: "survives"; creates: "none" };
    "fill": { needs: "player-channel"; persists: "unmeasured"; creates: "game-route"; persistable: false };
    "chown": { needs: "no-player"; persists: "survives"; creates: "none" };
    "learn": { needs: "own-records"; persists: "n-a"; creates: "none" };
    "overtake": { needs: "no-player"; persists: "survives"; creates: "none" };
    "place": { needs: "player-target"; persists: "lost"; creates: "game-route"; persistable: false };
    "seedbase": { needs: "own-records"; persists: "n-a"; creates: "none" };
    "setowner": { needs: "no-player"; persists: "survives"; creates: "none" };
    "spawn": { needs: "condition"; persists: "lost"; creates: "unregistered"; persistable: false };
    "transfer": { needs: "no-player"; persists: "survives"; creates: "none" };
  };
  "climate": {
    "advance": { needs: "refuses"; persists: "n-a"; creates: "none" };
    "set": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: true };
    "setbool": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: true };
    "setc": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: true };
    "setcurve": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: true };
    "setstage": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: true };
    "setv": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: true };
    "simulate": { needs: "refuses"; persists: "n-a"; creates: "none" };
  };
  "damage": {
    "explode": { needs: "loaded-target"; persists: "unmeasured"; creates: "none"; persistable: false };
  };
  "despawn": {
    "<kind>": { needs: "loaded-target"; persists: "survives"; creates: "none" };
    "stow": { needs: "loaded-target"; persists: "unmeasured"; creates: "none"; persistable: false };
  };
  "doors": {
    "close": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: false };
    "lock": { needs: "refuses"; persists: "n-a"; creates: "none" };
    "open": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: false };
    "save": { needs: "own-records"; persists: "n-a"; creates: "none" };
    "seal": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: false };
    "unlock": { needs: "refuses"; persists: "n-a"; creates: "none" };
    "unseal": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: false };
  };
  "encounters": {
    "bb": { needs: "admin-command"; persists: "unmeasured"; creates: "game-route"; persistable: false };
    "draw": { needs: "admin-command"; persists: "n-a"; creates: "game-route" };
    "dump": { needs: "admin-command"; persists: "survives"; creates: "none" };
    "zone": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: true };
    "zonerestore": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: false };
  };
  "entities": {
    "heal": { needs: "loaded-target"; persists: "unmeasured"; creates: "none"; persistable: true };
    "set": { needs: "loaded-target"; persists: "survives"; creates: "none" };
  };
  "fortifications": {
    "add": { needs: "refuses"; persists: "n-a"; creates: "none" };
    "build": { needs: "refuses"; persists: "n-a"; creates: "none" };
    "destroy": { needs: "refuses"; persists: "n-a"; creates: "none" };
    "forget": { needs: "own-records"; persists: "n-a"; creates: "none" };
    "heal": { needs: "refuses"; persists: "n-a"; creates: "none" };
    "place": { needs: "refuses"; persists: "n-a"; creates: "none" };
    "remove": { needs: "refuses"; persists: "n-a"; creates: "none" };
    "repair": { needs: "refuses"; persists: "n-a"; creates: "none" };
    "sethealth": { needs: "refuses"; persists: "n-a"; creates: "none" };
  };
  "give": {
    "drop": { needs: "player-target"; persists: "lost"; creates: "none"; persistable: false };
    "dropat": { needs: "player-target"; persists: "lost"; creates: "none"; persistable: false };
    "equip": { needs: "player-target"; persists: "survives"; creates: "none" };
    "equipswap": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "hands": { needs: "player-target"; persists: "survives"; creates: "none" };
    "inventory": { needs: "player-target"; persists: "survives"; creates: "none" };
    "inventoryall": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "inventoryn": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "remove": { needs: "player-target"; persists: "survives"; creates: "none" };
    "shoulder": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "unequip": { needs: "player-target"; persists: "lost"; creates: "none"; persistable: false };
  };
  "hazard": {
    "event": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: true };
    "restore": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: false };
    "set": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: true };
    "zone": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: true };
  };
  "items": {
    "attach": { needs: "loaded-target"; persists: "survives"; creates: "registered" };
    "condition": { needs: "loaded-target"; persists: "survives"; creates: "none" };
    "destroy": { needs: "loaded-target"; persists: "survives"; creates: "none" };
    "detach": { needs: "loaded-target"; persists: "lost"; creates: "none"; persistable: false };
    "drop": { needs: "player-channel"; persists: "lost"; creates: "none"; persistable: false };
  };
  "killbox": {
    "activated": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: true };
    "finale": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: true };
    "panic": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: false };
    "time": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: false };
    "tune": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: true };
  };
  "locks": {
    "access": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: false };
    "attach": { needs: "player-channel"; persists: "survives"; creates: "none" };
    "close": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: false };
    "code": { needs: "loaded-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "detach": { needs: "player-channel"; persists: "survives"; creates: "none" };
    "hp": { needs: "player-channel"; persists: "unmeasured"; creates: "none"; persistable: false };
    "lock": { needs: "no-player"; persists: "unmeasured"; creates: "none"; persistable: false };
    "open": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: false };
    "tries": { needs: "player-channel"; persists: "unmeasured"; creates: "none"; persistable: false };
    "unlock": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: false };
  };
  "loot": {
    "export": { needs: "admin-command"; persists: "n-a"; creates: "none" };
  };
  "medical": {
    "add": { needs: "player-target"; persists: "survives"; creates: "none" };
    "bladder": { needs: "player-target"; persists: "survives"; creates: "none" };
    "bleed": { needs: "player-target"; persists: "survives"; creates: "none" };
    "burn": { needs: "player-target"; persists: "survives"; creates: "none" };
    "cure": { needs: "player-target"; persists: "survives"; creates: "none" };
    "exhaustion": { needs: "player-target"; persists: "lost"; creates: "none"; persistable: false };
    "feed": { needs: "player-target"; persists: "survives"; creates: "none" };
    "incubation": { needs: "player-target"; persists: "lost"; creates: "none"; persistable: false };
    "infiniteoxygen": { needs: "player-target"; persists: "lost"; creates: "none"; persistable: false };
    "infinitestamina": { needs: "player-target"; persists: "lost"; creates: "none"; persistable: false };
    "knockout": { needs: "player-target"; persists: "survives"; creates: "none" };
    "metabolism": { needs: "player-target"; persists: "lost"; creates: "none"; persistable: false };
    "radiation": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "remove": { needs: "player-target"; persists: "survives"; creates: "none" };
    "set": { needs: "player-target"; persists: "lost"; creates: "none"; persistable: false };
    "severity": { needs: "player-target"; persists: "lost"; creates: "none"; persistable: false };
    "stamina": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "wellbeing": { needs: "player-target"; persists: "survives"; creates: "none" };
  };
  "notify": {
    "alert": { needs: "player-target"; persists: "n-a"; creates: "none" };
    "all": { needs: "player-target"; persists: "n-a"; creates: "none" };
    "banner": { needs: "player-target"; persists: "n-a"; creates: "none" };
    "killfeed": { needs: "player-target"; persists: "n-a"; creates: "none" };
    "killfeedall": { needs: "player-target"; persists: "n-a"; creates: "none" };
  };
  "offline": {
    "forget": { needs: "own-records"; persists: "n-a"; creates: "none" };
    "recheck": { needs: "own-records"; persists: "n-a"; creates: "none" };
  };
  "power": {
    "devicecharge": { needs: "loaded-target"; persists: "lost"; creates: "none"; persistable: false };
    "generatorfuel": { needs: "loaded-target"; persists: "lost"; creates: "none"; persistable: false };
    "generatoroff": { needs: "loaded-target"; persists: "survives"; creates: "none" };
    "generatoron": { needs: "loaded-target"; persists: "survives"; creates: "none" };
    "lightintensity": { needs: "loaded-target"; persists: "lost"; creates: "none"; persistable: false };
    "lightoff": { needs: "loaded-target"; persists: "lost"; creates: "none"; persistable: false };
    "lighton": { needs: "loaded-target"; persists: "lost"; creates: "none"; persistable: false };
  };
  "protect": {
    "grant": { needs: "no-player"; persists: "survives"; creates: "none" };
    "postpone": { needs: "no-player"; persists: "survives"; creates: "none" };
    "reset": { needs: "player-channel"; persists: "n-a"; creates: "none" };
    "set": { needs: "no-player"; persists: "survives"; creates: "none" };
    "snapshot": { needs: "own-records"; persists: "n-a"; creates: "none" };
  };
  "quests": {
    "abandon": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "abandontask": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "cycle": { needs: "admin-command"; persists: "unmeasured"; creates: "none"; persistable: false };
    "track": { needs: "player-target"; persists: "survives"; creates: "none" };
  };
  "raid": {
    "announce": { needs: "condition"; persists: "n-a"; creates: "none" };
    "end": { needs: "own-records"; persists: "n-a"; creates: "none" };
    "forget": { needs: "own-records"; persists: "n-a"; creates: "none" };
    "start": { needs: "own-records"; persists: "n-a"; creates: "none" };
  };
  "repair": {
    "access": { needs: "loaded-target"; persists: "survives"; creates: "none" };
    "battery": { needs: "loaded-target"; persists: "survives"; creates: "none" };
    "colors": { needs: "loaded-target"; persists: "survives"; creates: "none" };
    "damage": { needs: "loaded-target"; persists: "survives"; creates: "none" };
    "destroy": { needs: "loaded-target"; persists: "survives"; creates: "none" };
    "fuel": { needs: "loaded-target"; persists: "survives"; creates: "none" };
    "mileage": { needs: "loaded-target"; persists: "survives"; creates: "none" };
    "owner": { needs: "loaded-target"; persists: "survives"; creates: "none" };
    "pattern": { needs: "loaded-target"; persists: "survives"; creates: "none" };
    "rename": { needs: "admin-command"; persists: "survives"; creates: "none" };
    "repair": { needs: "loaded-target"; persists: "survives"; creates: "none" };
    "tyre": { needs: "loaded-target"; persists: "lost"; creates: "none"; persistable: true };
  };
  "resources": {
    "near": { needs: "admin-command"; persists: "survives"; creates: "none" };
  };
  "respawn": {
    "clear": { needs: "player-target"; persists: "lost"; creates: "none"; persistable: false };
    "set": { needs: "player-target"; persists: "lost"; creates: "none"; persistable: false };
  };
  "spawn": {
    "load": { needs: "no-player"; persists: "n-a"; creates: "none" };
  };
  "spawnpoints": {
    "disable": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: true };
    "enable": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: true };
  };
  "squads": {
    "add": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "board": { needs: "player-channel"; persists: "n-a"; creates: "none" };
    "disband": { needs: "no-player"; persists: "survives"; creates: "none" };
    "info": { needs: "player-channel"; persists: "n-a"; creates: "none" };
    "message": { needs: "player-target"; persists: "survives"; creates: "none" };
    "names": { needs: "player-channel"; persists: "n-a"; creates: "none" };
    "remove": { needs: "no-player"; persists: "survives"; creates: "none" };
    "removeall": { needs: "no-player"; persists: "survives"; creates: "none" };
    "rename": { needs: "player-channel"; persists: "survives"; creates: "none" };
  };
  "stash": {
    "detonate": { needs: "loaded-target"; persists: "n-a"; creates: "none" };
    "fill": { needs: "admin-command"; persists: "survives"; creates: "game-route" };
    "place": { needs: "admin-command"; persists: "survives"; creates: "registered" };
  };
  "stats": {
    "attributes": { needs: "player-target"; persists: "survives"; creates: "none" };
    "clear": { needs: "own-records"; persists: "n-a"; creates: "none" };
    "forgive": { needs: "condition"; persists: "unmeasured"; creates: "none"; persistable: false };
    "rank": { needs: "player-channel"; persists: "n-a"; creates: "none" };
    "refresh": { needs: "player-channel"; persists: "n-a"; creates: "none" };
    "skill": { needs: "player-target"; persists: "survives"; creates: "none" };
    "skilllevel": { needs: "player-target"; persists: "survives"; creates: "none" };
  };
  "storage": {
    "destroy": { needs: "player-channel"; persists: "survives"; creates: "none" };
    "drop": { needs: "player-channel"; persists: "lost"; creates: "none"; persistable: false };
    "move": { needs: "player-channel"; persists: "survives"; creates: "none" };
    "observe": { needs: "player-channel"; persists: "n-a"; creates: "none" };
    "take": { needs: "player-target"; persists: "survives"; creates: "none" };
  };
  "teleport": {
    "back": { needs: "player-target"; persists: "survives"; creates: "none" };
    "corpse": { needs: "loaded-target"; persists: "survives"; creates: "none" };
    "face": { needs: "loaded-target"; persists: "survives"; creates: "none" };
    "item": { needs: "loaded-target"; persists: "survives"; creates: "none" };
    "player": { needs: "player-target"; persists: "survives"; creates: "none" };
    "squad": { needs: "player-target"; persists: "survives"; creates: "none" };
    "swap": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "toplayer": { needs: "player-target"; persists: "unmeasured"; creates: "none"; persistable: false };
    "vehicle": { needs: "loaded-target"; persists: "survives"; creates: "none" };
  };
  "trade": {
    "economy": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: true };
    "randomizeprices": { needs: "admin-command"; persists: "survives"; creates: "none" };
    "reseteconomy": { needs: "admin-command"; persists: "survives"; creates: "none" };
  };
  "vote": {
    "tournamentend": { needs: "no-player"; persists: "n-a"; creates: "none" };
    "votecancel": { needs: "admin-command"; persists: "n-a"; creates: "none" };
  };
  "wake": {
    "move": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: false };
    "place": { needs: "no-player"; persists: "lost"; creates: "unregistered"; persistable: true };
    "remove": { needs: "no-player"; persists: "n-a"; creates: "none" };
    "vehicles": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: true };
  };
  "wildlife": {
    "density": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: true };
    "fishweight": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: true };
    "set": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: true };
  };
  "world": {
    "stream": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: true };
    "unload": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: false };
    "unstream": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: false };
  };
  "worldevents": {
    "cancel": { needs: "no-player"; persists: "unmeasured"; creates: "none"; persistable: false };
    "cancelforce": { needs: "no-player"; persists: "unmeasured"; creates: "none"; persistable: false };
    "cargodetonate": { needs: "no-player"; persists: "unmeasured"; creates: "none"; persistable: false };
    "cargodrop": { needs: "no-player"; persists: "unmeasured"; creates: "none"; persistable: false };
    "clearscores": { needs: "no-player"; persists: "unmeasured"; creates: "none"; persistable: false };
    "cooldown": { needs: "player-target"; persists: "lost"; creates: "none"; persistable: false };
    "eventmove": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: true };
    "eventradius": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: true };
    "join": { needs: "player-target"; persists: "n-a"; creates: "none" };
    "kick": { needs: "player-target"; persists: "n-a"; creates: "none" };
    "leave": { needs: "player-target"; persists: "n-a"; creates: "none" };
    "resetarea": { needs: "no-player"; persists: "unmeasured"; creates: "none"; persistable: false };
    "schedule": { needs: "no-player"; persists: "unmeasured"; creates: "game-route"; persistable: false };
  };
  "zones": {
    "assign": { needs: "player-channel"; persists: "survives"; creates: "none" };
    "batch": { needs: "player-channel"; persists: "survives"; creates: "registered" };
    "clear": { needs: "player-channel"; persists: "survives"; creates: "none" };
    "config": { needs: "player-channel"; persists: "survives"; creates: "none" };
    "copy": { needs: "player-channel"; persists: "survives"; creates: "registered" };
    "delete": { needs: "player-channel"; persists: "survives"; creates: "none" };
    "global": { needs: "player-channel"; persists: "survives"; creates: "none" };
    "guardedtune": { needs: "no-player"; persists: "lost"; creates: "none"; persistable: true };
    "mapreload": { needs: "admin-command"; persists: "n-a"; creates: "none" };
    "move": { needs: "player-channel"; persists: "survives"; creates: "none" };
    "order": { needs: "player-channel"; persists: "survives"; creates: "none" };
    "refresh": { needs: "player-channel"; persists: "n-a"; creates: "none" };
    "rename": { needs: "player-channel"; persists: "survives"; creates: "none" };
    "resize": { needs: "player-channel"; persists: "survives"; creates: "none" };
    "restore": { needs: "player-channel"; persists: "survives"; creates: "registered" };
    "set": { needs: "player-channel"; persists: "survives"; creates: "registered" };
    "shape": { needs: "player-channel"; persists: "survives"; creates: "none" };
  };
}

export type ModuleId = keyof ModuleVocabulary;
/** The `what` of a `module_data` request to module `M`. */
export type DataQuery<M extends ModuleId> = ModuleVocabulary[M]['data'];
/** The `what` of a `module_command` request to module `M`. */
export type Command<M extends ModuleId> = ModuleVocabulary[M]['command'];
export type ModuleSettings<M extends ModuleId> = ModuleSettingsMap[M];

// ── END GENERATED ──────────────────────────────────────────────────────────────────────────────
