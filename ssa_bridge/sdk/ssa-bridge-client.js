'use strict';
/**
 * SSA Bridge reference client for Node. No dependencies.
 *
 *   const { connect, discover } = require('./ssa-bridge-client.js');
 *   // or: import { connect, discover } from './ssa-bridge-client.js';
 *
 *   const where = discover({ serverDir: 'C:/SCUM-Server' });          // a bridge on this machine
 *   if (!where) throw new Error('that bridge has never listened: no status file');
 *   const bridge = await connect({ ...where, caller: 'my-tool' });
 *   const r = await bridge.query('live', 'players');
 *   if (r.ok) console.log(r.result); else console.log(r.code, r.reason);
 *
 * One connection, kept open, every request multiplexed over it by `id`. Requests never throw for a
 * refusal: they resolve to `{ ok: false, code, reason }`. Types: ssa-bridge-sdk.d.ts.
 * Protocol: https://scumsa.com/docs/dev/ssa-bridge-protocol
 */

const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const MAX_REPLY_BYTES = 8 * 1024 * 1024;
/** The longest line the client buffers: the bridge's largest answer, plus room for its envelope. */
const MAX_LINE_BYTES = MAX_REPLY_BYTES + 64 * 1024;
/**
 * Refusals the client answers by waiting and sending again. `rate_limited` is a wait the bridge asks
 * for. `busy` means the bridge's queue was full and it DROPPED the request without running it, so
 * sending it again is safe; it carries the request's own id since bridge 2.44.0. A module that
 * refuses with `reasonCode` `busy` is not retried: that refusal is the module's, not the queue's.
 */
const RETRYABLE = new Set(['rate_limited', 'busy']);
/** Codes the bridge itself sends in `error`. Anything else in `error` is a module's own sentence. */
/* @@BRIDGE_CODES begin: generated from the bridge's source, do not edit by hand */
const BRIDGE_CODES = new Set([
  'bad json',
  'unknown action',
  'bad_request',
  'control_char',
  'unauthorized',
  'remote_disabled',
  'bad_token',
  'hmac_unavailable',
  'nonce_failed',
  'wrong_instance',
  'rate_limited',
  'busy',
  'line_too_long',
  'too_many_clients',
  'tampered',
  'unknown_module',
  'unknown_command',
  'no_data',
  'missing_config',
  'missing_command',
  'missing item',
  'missing text',
  'missing command',
  'bad_item',
  'bad_rest',
  'missing_xy',
  'bad_xy',
  'bad_xyz',
  'no_ground',
  'no ground below that height',
  'no_executor',
  'nothing_ran',
  'player not ready',
  'console_failed',
  'console_refused',
  'bad channel',
  'bad_targets',
  'bad_exclude',
  'no_frame',
  'too_many_spawns',
  'no position',
  'reply_too_long',
  'reply_too_large',
  'not_found',
  'write_failed',
  'bad_use',
  'bad_class',
  'unknown_class',
  'unlicensed',
]);
/* @@BRIDGE_CODES end */
/** Actions that run a SCUM admin command. The client keeps at most one of them on the wire. */
const ADMIN_ACTIONS = new Set(['cmd', 'spawn', 'batch']);
/** Refusals after which a reconnect would only be refused again. */
const FATAL_ON_RECONNECT = new Set(['bad_token', 'remote_disabled', 'tampered', 'protocol', 'wrong_instance']);

/** One leading `#` removed: it is the chat prefix, and the bridge wants the bare verb. */
function bareCommand(command) {
  return String(command == null ? '' : command).replace(/^\s*#/, '').trim();
}

/** A wire reply as the client hands it back: a success unchanged, a refusal as `{ ok:false, code, reason }`. */
function toReply(msg) {
  if (msg && msg.ok === true) {
    const out = { ok: true, result: msg.result };
    for (const k of ['changed', 'note', 'reach']) if (msg[k] !== undefined) out[k] = msg[k];
    return out;
  }
  const err = msg && msg.error != null ? String(msg.error) : 'unknown';
  const out = BRIDGE_CODES.has(err)
    ? { ok: false, code: err, reason: msg.reason ? String(msg.reason) : err }
    : { ok: false, code: (msg && msg.reasonCode) ? String(msg.reasonCode) : 'module_refused', reason: err };
  if (msg && msg.reasonCode) out.reasonCode = String(msg.reasonCode);
  if (msg && Number.isFinite(msg.retryAfterMs)) out.retryAfterMs = msg.retryAfterMs;
  if (msg && msg.reach) out.reach = msg.reach;
  return out;
}

/** A refusal the client made itself: it never reached the bridge, or never came back. */
const local = (code, reason, reasonCode) => Object.assign({ ok: false, error: code, reason, _client: true }, reasonCode ? { reasonCode } : {});

/**
 * `rate_limited` with `reasonCode` `locked_out` is not a wait: too many wrong tokens came from this
 * address, the bridge has closed the connection, and resending would only be refused again.
 */
const isLockout = (msg) => !!msg && msg.reasonCode === 'locked_out';

/** A timer that does not keep the process alive by itself: the heartbeat. */
const later = (fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class BridgeClient extends EventEmitter {
  constructor(socket, opts) {
    super();
    this._opts = Object.assign({ timeoutMs: 20000, backoffMs: 1000, retries: 3, heartbeatMs: 30000, keepAlive: true }, opts || {});
    this._seq = 0;
    this._pending = new Map();
    this._adminGate = Promise.resolve();
    this._closed = false;          // for good
    this._userClosed = false;
    this._reconnecting = false;
    this._subs = new Set();
    this._hbTimer = null;
    this._probing = false;
    this.closeReason = null;
    this.status = null;
    this.protocol = 1;
    this._attach(socket);
  }

  /** True once the connection is gone for good. */
  get closed() { return this._closed; }

  _attach(socket) {
    this._sock = socket;
    this._buf = '';
    this._scanFrom = 0;
    socket.setEncoding('utf8');
    if (this._opts.keepAlive !== false) { try { socket.setKeepAlive(true, 15000); } catch { /* not a TCP socket */ } }
    socket.on('data', (d) => { if (socket === this._sock) this._onData(d); });
    socket.on('error', () => {});
    socket.on('close', () => this._onClose(socket));
    this._armHeartbeat();
  }

  /** Calls the listeners of `name`; one that throws is reported and never breaks the connection. */
  _safeEmit(name, ...args) {
    try { this.emit(name, ...args); } catch (e) {
      if (this.listenerCount('listenerError')) { try { this.emit('listenerError', e, name); } catch { /* its own listener threw */ } }
      else console.error(`[ssa-bridge-client] a '${name}' listener threw:`, e);
    }
  }

  _onData(chunk) {
    this._armHeartbeat();
    this._buf += chunk;
    // Scan only what arrived: a large reply comes in many chunks, and searching the whole buffer for
    // its newline again on every one of them is quadratic.
    let pos = 0;
    let nl;
    while ((nl = this._buf.indexOf('\n', this._scanFrom)) >= 0) {
      const line = this._buf.slice(pos, nl).replace(/\r$/, '');
      pos = nl + 1;
      this._scanFrom = pos;
      if (line.trim()) this._line(line);
      if (this._sock === null) return;
    }
    if (pos) this._buf = this._buf.slice(pos);
    this._scanFrom = this._buf.length;
    if (this._buf.length > MAX_LINE_BYTES) {
      // A line this long is not a reply the bridge sends. Everything waiting fails as a bad
      // response, and the connection goes: nothing after it on this stream can be trusted.
      this._buf = '';
      this._scanFrom = 0;
      this._failAll('bad_response', 'a reply was larger than 8 MB');
      this._sock.destroy();
    }
  }

  _line(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { this._safeEmit('stray', line); return; }
    if (msg && msg.event && msg.id === undefined) { this._safeEmit('event', msg); return; }
    const p = this._pending.get(String(msg && msg.id));
    if (!p) { this._safeEmit('stray', msg); return; }
    this._pending.delete(String(msg.id));
    p.settle(msg);
  }

  _onClose(socket) {
    if (socket !== this._sock) return;
    this._sock = null;
    this._disarmHeartbeat();
    this._failAll('closed', 'the connection closed before the reply arrived');
    if (this._reconnecting && !this._closed) return;   // a socket opened by the reconnect loop: the loop goes on
    if (this._userClosed || !this._opts.reconnect || this._closed) { this._finish({ code: 'closed', reason: 'the connection closed' }); return; }
    this._reconnecting = true;
    this._safeEmit('disconnect', { code: 'closed', reason: 'the connection dropped; reconnecting' });
    this._reconnectLoop();
  }

  /** Closed for good: `close` is emitted once. */
  _finish(why) {
    if (this._closed) return;
    this._closed = true;
    this._reconnecting = false;
    this._disarmHeartbeat();
    this.closeReason = why;
    this._failAll('closed', why.reason || 'the connection is closed');
    this._safeEmit('close');
  }

  _failAll(code, reason) {
    for (const [id, p] of this._pending) {
      this._pending.delete(id);
      p.settle(local(code, reason));
    }
  }

  // ── heartbeat ──────────────────────────────────────────────────────────────────────────────

  _disarmHeartbeat() { if (this._hbTimer) { clearTimeout(this._hbTimer); this._hbTimer = null; } }

  /** Restarted on every byte received: silence, not traffic, is what sends the probe. */
  _armHeartbeat() {
    this._disarmHeartbeat();
    const ms = this._opts.heartbeatMs;
    if (!(ms > 0) || this._closed) return;
    this._hbTimer = later(() => this._probe(), ms);
  }

  async _probe() {
    this._hbTimer = null;
    const sock = this._sock;
    if (!sock || this._probing || this._reconnecting) return;
    this._probing = true;
    const wait = Math.min(this._opts.timeoutMs, this._opts.heartbeatMs);
    const r = await this._send('status', {}, wait).reply;
    this._probing = false;
    if (r && r._client && r.error === 'timeout' && sock === this._sock) {
      // Nothing came back from a link that was silent already: it is dead, not slow.
      sock.destroy();
    }
  }

  // ── sending ────────────────────────────────────────────────────────────────────────────────

  /**
   * Writes one line. `reply` resolves to the raw wire message, or to the client's own refusal at the
   * timeout; `wire` resolves only when the bridge has answered or the connection is gone. An admin
   * command keeps its id registered after a timeout (`hold`), so the late reply is recognised and
   * the next admin command waits for it.
   */
  _send(action, fields, timeoutMs, hold) {
    if (!this._sock || this._closed) {
      const m = local('closed', this._reconnecting ? 'the connection dropped and is reconnecting' : 'the connection is closed', 'not_sent');
      return { reply: Promise.resolve(m), wire: Promise.resolve() };
    }
    const id = String(++this._seq);
    const req = Object.assign({ id, action }, fields || {});
    if (this._opts.instance) req.instance = this._opts.instance;
    if (this._opts.caller && req.caller === undefined) req.caller = this._opts.caller;
    let resolveReply; let resolveWire;
    const reply = new Promise((r) => { resolveReply = r; });
    const wire = new Promise((r) => { resolveWire = r; });
    const timer = setTimeout(() => {
      if (!hold) this._pending.delete(id);
      // A request over the bridge's rate budget is queued, not refused, so silence is not "no".
      resolveReply(local('timeout', 'no reply in time; the request may still run'));
      if (!hold) resolveWire();
    }, timeoutMs);
    this._pending.set(id, { settle: (msg) => { clearTimeout(timer); resolveReply(msg); resolveWire(); } });
    this._sock.write(`${JSON.stringify(req)}\n`, (err) => {
      if (!err) return;
      // The line never left: the request did not run, and waiting out the timeout would say "unknown".
      const p = this._pending.get(id);
      if (p) { this._pending.delete(id); p.settle(local('closed', `the line could not be written: ${err.message}`, 'not_sent')); }
    });
    return { reply, wire };
  }

  /** The wait before attempt `attempt + 1`, or null when the refusal is handed back instead. */
  _retryWait(msg, attempt, timeoutMs) {
    if (!(msg.ok === false && !msg._client && RETRYABLE.has(msg.error)) || isLockout(msg) || attempt >= this._opts.retries) return null;
    if (Number.isFinite(msg.retryAfterMs) && msg.retryAfterMs >= 0) {
      // The bridge said how long. A wait longer than the caller's timeout is the caller's to decide.
      return msg.retryAfterMs <= timeoutMs ? msg.retryAfterMs : null;
    }
    return this._opts.backoffMs * (attempt + 1);
  }

  /** Sends, resending after `rate_limited` / `busy`. Resolves `{ msg, wire }` of the last attempt. */
  async _attempts(action, fields, timeoutMs, hold) {
    for (let attempt = 0; ; attempt++) {
      const s = this._send(action, fields, timeoutMs, hold);
      const msg = await s.reply;
      const wait = this._retryWait(msg, attempt, timeoutMs);
      if (wait === null) return { msg, wire: s.wire };
      await sleep(wait);
    }
  }

  static _out(msg) {
    if (msg._client) return Object.assign({ ok: false, code: msg.error, reason: msg.reason }, msg.reasonCode ? { reasonCode: msg.reasonCode } : {});
    return toReply(msg);
  }

  /** Any action, with `rate_limited` and `busy` answered by waiting and sending again. */
  async request(action, fields, opts) {
    if (this._reconnecting) return BridgeClient._out(local('closed', 'the connection dropped and is reconnecting', 'not_sent'));
    return this._request(action, fields, opts);
  }

  async _request(action, fields, opts) {
    const timeoutMs = opts && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : this._opts.timeoutMs;
    if (!ADMIN_ACTIONS.has(action)) return BridgeClient._out((await this._attempts(action, fields, timeoutMs, false)).msg);
    // One admin command on the wire at a time. The slot is held until the bridge has ANSWERED, not
    // until the caller stopped waiting: a timed-out command may still be running.
    const prev = this._adminGate;
    let release;
    const gate = new Promise((r) => { release = r; });
    this._adminGate = gate;
    let t;
    const turn = await Promise.race([prev.then(() => true), new Promise((r) => { t = setTimeout(() => r(false), timeoutMs); })]);
    clearTimeout(t);
    if (!turn) {
      prev.then(release);
      return BridgeClient._out(local('timeout', 'an earlier admin command had not been answered in time, so this one was never sent', 'not_sent'));
    }
    let r;
    try { r = await this._attempts(action, fields, timeoutMs, true); } catch (e) { release(); throw e; }
    r.wire.then(release);
    return BridgeClient._out(r.msg);
  }

  query(module, what, opts) { return this.request('module_data', { module, what }, opts); }
  command(module, what, opts) { return this.request('module_command', { module, what }, opts); }
  configure(module, config, opts) { return this.request('module_config', { module, config }, opts); }
  modules(opts) { return this.request('modules', undefined, opts); }
  players(opts) { return this.request('players', undefined, opts); }
  cmd(command, opts) {
    const o = Object.assign({}, opts || {});
    const t = o.timeoutMs; delete o.timeoutMs;
    return this.request('cmd', Object.assign({ command: bareCommand(command) }, o), { timeoutMs: t });
  }
  chat(text, opts) {
    const o = Object.assign({}, opts || {});
    const t = o.timeoutMs; delete o.timeoutMs;
    return this.request('chat', Object.assign({ text: String(text) }, o), { timeoutMs: t });
  }
  async subscribe(events, opts) {
    const r = await this.request('subscribe', { events }, opts);
    if (r.ok) {
      const got = r.result && Array.isArray(r.result.subscribed) ? r.result.subscribed : events;
      for (const e of got || []) this._subs.add(String(e));
    }
    return r;
  }

  close() {
    this._userClosed = true;
    const s = this._sock;
    this._finish({ code: 'closed', reason: 'closed by the client' });
    if (s) { s.end(); s.destroy(); }
  }

  // ── reconnecting ───────────────────────────────────────────────────────────────────────────

  async _reconnectLoop() {
    const rc = this._opts.reconnect === true ? {} : this._opts.reconnect;
    const minMs = Number.isFinite(rc.minMs) && rc.minMs >= 0 ? rc.minMs : 1000;
    const maxMs = Number.isFinite(rc.maxMs) && rc.maxMs >= minMs ? rc.maxMs : Math.max(30000, minMs);
    for (let attempt = 1; !this._closed; attempt++) {
      await sleep(Math.min(maxMs, minMs * 2 ** Math.min(attempt - 1, 20)));
      if (this._closed) return;
      if (typeof this._opts.rediscover === 'function') {
        let w = null;
        try { w = this._opts.rediscover(); } catch { w = null; }
        if (!w || !Number.isInteger(w.port) || w.port <= 0) continue;
        this._opts.port = w.port;
        if (w.host) this._opts.host = w.host;
        this._opts.instance = w.instance || undefined;
      }
      let sock;
      try { sock = await openSocket(this._opts.host, this._opts.port, this._opts.timeoutMs); } catch { continue; }
      if (this._closed) { sock.destroy(); return; }
      this._attach(sock);
      let h;
      try { h = await handshake(this, this._opts); } catch (e) { h = { ok: false, code: 'closed', reason: String(e && e.message) }; }
      if (this._closed) return;
      if (h.ok) {
        if (this._subs.size) {
          const s = await this._request('subscribe', { events: [...this._subs] });
          if (!s.ok && this._sock === sock) { sock.destroy(); continue; }
        }
        if (this._sock !== sock) continue;
        this._reconnecting = false;
        this._safeEmit('reconnect', { attempt, status: this.status });
        return;
      }
      const fatal = FATAL_ON_RECONNECT.has(h.code) && !(h.code === 'wrong_instance' && typeof this._opts.rediscover === 'function');
      if (fatal || isLockout(h)) {
        this._finish({ code: h.code, reason: `reconnecting stopped: ${h.reason}` });
        if (this._sock) this._sock.destroy();
        return;
      }
      if (this._sock === sock) { this._sock = null; sock.destroy(); }
    }
  }
}

function openSocket(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port });
    const t = setTimeout(() => { s.destroy(); reject(Object.assign(new Error('connect timed out'), { code: 'timeout' })); }, timeoutMs);
    s.once('connect', () => { clearTimeout(t); resolve(s); });
    s.once('error', (e) => { clearTimeout(t); reject(Object.assign(new Error(e.message), { code: e.code || 'closed', reason: e.message })); });
  });
}

/**
 * `auth` without putting the token on the wire, when the bridge offers it: `status` lists `hmac` in
 * `authModes`, `auth_nonce` hands out a nonce for this connection, and the login carries
 * `proof` = hex(HMAC-SHA256(token, nonce + "\n" + instance)). A bridge that does not list `hmac`
 * predates it and gets the token itself. A bridge that lists it never does, even if the nonce fails.
 */
async function logIn(c, o) {
  const pre = await c._request('status');
  if (!pre.ok) return pre;
  const modes = pre.result && Array.isArray(pre.result.authModes) ? pre.result.authModes : [];
  if (modes.includes('hmac')) {
    const n = await c._request('auth_nonce');
    if (!n.ok) return n;
    const nonce = String((n.result && n.result.nonce) || '');
    const instance = o.instance || String((n.result && n.result.instance) || '');
    const proof = crypto.createHmac('sha256', String(o.token)).update(`${nonce}\n${instance}`).digest('hex');
    return c._request('auth', { proof });
  }
  return c._request('auth', { token: o.token });
}

/** Log in when there is a token, then `status`. Resolves `{ ok: true }` or the refusal. */
async function handshake(c, o) {
  if (o.token) {
    const a = await logIn(c, o);
    if (!a.ok && a.reasonCode === 'locked_out') {
      const wait = Number.isFinite(a.retryAfterMs) ? a.retryAfterMs : null;
      return Object.assign({}, a, { reason: `too many wrong tokens from this address; the bridge closed the connection`
        + (wait !== null ? ` and accepts auth again in ${wait} ms (retryAfterMs)` : '') });
    }
    if (!a.ok) return a;
  }
  const st = await c._request('status');
  if (!st.ok) return st;
  const status = st.result || {};
  const protocol = Number.isInteger(status.protocol) ? status.protocol : 1;
  if (protocol < o.minProtocol) {
    return { ok: false, code: 'protocol', reason: `this bridge speaks protocol ${protocol}; ${o.minProtocol} or newer is needed (bridge ${status.version})` };
  }
  c.status = status;
  c.protocol = protocol;
  return { ok: true };
}

/**
 * Opens one connection: when a token is given, logs in first (a remote client has ten seconds),
 * then `status`. Rejects only when there is no usable connection, with `code` and `reason` on the error.
 */
async function connect(opts) {
  const o = Object.assign({ host: '127.0.0.1', timeoutMs: 20000, backoffMs: 1000, retries: 3, minProtocol: 1,
    heartbeatMs: 30000, keepAlive: true, reconnect: false }, opts || {});
  if (!Number.isInteger(o.port) || o.port <= 0) {
    throw Object.assign(new Error('no port: read it from SSABridge.status.json or ask the owner'), { code: 'no_port' });
  }
  const sock = await openSocket(o.host, o.port, o.timeoutMs);
  const c = new BridgeClient(sock, o);
  const r = await handshake(c, o);
  if (!r.ok) {
    c.close();
    const e = Object.assign(new Error(r.reason), { code: r.code, reason: r.reason });
    if (r.reasonCode) e.reasonCode = r.reasonCode;
    if (Number.isFinite(r.retryAfterMs)) e.retryAfterMs = r.retryAfterMs;
    throw e;
  }
  return c;
}

/**
 * A bridge on this machine, from the file it writes after binding. Null when there is no such file:
 * that bridge has never listened, and whatever answers on 27717 may be another server's.
 */
function discover(where) {
  const w = where || {};
  const file = w.statusFile || (w.serverDir
    && path.join(w.serverDir, 'SCUM', 'Binaries', 'Win64', 'Mods', 'SSABridge', 'SSABridge.status.json'));
  if (!file) return null;
  let s;
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (!s || !Number.isInteger(s.port) || s.port <= 0) return null;
  const host = (s.host && s.host !== '0.0.0.0') ? s.host : '127.0.0.1';
  return Object.assign({}, s, { host, instance: typeof s.instance === 'string' && s.instance ? s.instance : undefined });
}

module.exports = { BridgeClient, connect, discover, bareCommand, toReply, BRIDGE_CODES, RETRYABLE };
