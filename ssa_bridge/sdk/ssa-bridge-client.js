'use strict';
/**
 * SSA Bridge reference client for Node. No dependencies.
 *
 *   const { connect, discover } = require('./ssa-bridge-client.js');
 *   // or: import { connect, discover } from './ssa-bridge-client.js';
 *
 *   const where = discover({ serverDir: 'C:/SCUM-Server' });          // a bridge on this machine
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
const { EventEmitter } = require('events');

const MAX_REPLY_BYTES = 8 * 1024 * 1024;
const RETRYABLE = new Set(['rate_limited']);   // `busy` arrives with id "0", so it cannot be matched to a request
/** Codes the bridge itself sends in `error`. Anything else in `error` is a module's own sentence. */
const BRIDGE_CODES = new Set([
  'bad json', 'unknown action', 'unauthorized', 'remote_disabled', 'bad_token', 'wrong_instance',
  'rate_limited', 'busy', 'line_too_long', 'too_many_clients', 'tampered', 'unknown_module',
  'unknown_command', 'no_data', 'missing_config', 'missing_command', 'missing item', 'missing text',
  'missing command', 'missing_xy', 'bad_xy', 'bad_xyz', 'no_ground', 'no ground below that height',
  'no_executor', 'player not ready', 'console_failed', 'console_refused', 'bad channel',
  'too_many_spawns', 'no position', 'reply_too_long', 'reply_too_large', 'unlicensed',
]);
/** Actions that run a SCUM admin command. The client keeps at most one of them on the wire. */
const ADMIN_ACTIONS = new Set(['cmd', 'spawn', 'batch']);

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
  if (msg && msg.reach) out.reach = msg.reach;
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class BridgeClient extends EventEmitter {
  constructor(socket, opts) {
    super();
    this._sock = socket;
    this._opts = opts;
    this._seq = 0;
    this._pending = new Map();
    this._buf = '';
    this._adminChain = Promise.resolve();
    this._closed = false;
    this.status = null;
    this.protocol = 1;
    socket.setEncoding('utf8');
    socket.on('data', (d) => this._onData(d));
    socket.on('error', () => {});
    socket.on('close', () => this._onClose());
  }

  _onData(chunk) {
    this._buf += chunk;
    if (this._buf.length > MAX_REPLY_BYTES && this._buf.indexOf('\n') < 0) {
      this._buf = '';
      this._failAll('bad_response', 'a reply was larger than 8 MB');
      return;
    }
    let nl;
    while ((nl = this._buf.indexOf('\n')) >= 0) {
      const line = this._buf.slice(0, nl).replace(/\r$/, '');
      this._buf = this._buf.slice(nl + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { this.emit('stray', line); continue; }
      if (msg && msg.event && msg.id === undefined) { this.emit('event', msg); continue; }
      const p = this._pending.get(String(msg && msg.id));
      if (!p) { this.emit('stray', msg); continue; }
      this._pending.delete(String(msg.id));
      clearTimeout(p.timer);
      p.resolve(msg);
    }
  }

  _onClose() {
    this._closed = true;
    this._failAll('closed', 'the connection closed before the reply arrived');
    this.emit('close');
  }

  _failAll(code, reason) {
    for (const [id, p] of this._pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: code, reason, _client: true });
      this._pending.delete(id);
    }
  }

  /** Sends one line and waits for the reply with its id. Resolves to the raw wire message. */
  _send(action, fields) {
    if (this._closed) return Promise.resolve({ ok: false, error: 'closed', reason: 'the connection is closed', _client: true });
    const id = String(++this._seq);
    const req = Object.assign({ id, action }, fields || {});
    if (this._opts.instance) req.instance = this._opts.instance;
    if (this._opts.caller && req.caller === undefined) req.caller = this._opts.caller;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        // A request over the bridge's rate budget is queued, not refused, so silence is not "no".
        resolve({ ok: false, error: 'timeout', reason: 'no reply in time; the request may still run', _client: true });
      }, this._opts.timeoutMs);
      this._pending.set(id, { resolve, timer });
      this._sock.write(`${JSON.stringify(req)}\n`);
    });
  }

  /** Any action, with `rate_limited` answered by waiting and sending again. */
  async request(action, fields) {
    const run = async () => {
      let msg;
      for (let attempt = 0; ; attempt++) {
        msg = await this._send(action, fields);
        if (msg.ok === false && RETRYABLE.has(msg.error) && attempt < this._opts.retries) {
          await sleep(this._opts.backoffMs * (attempt + 1));
          continue;
        }
        break;
      }
      if (msg._client) return { ok: false, code: msg.error, reason: msg.reason };
      return toReply(msg);
    };
    if (!ADMIN_ACTIONS.has(action)) return run();
    // One admin command on the wire at a time: the next waits for this one's reply.
    const next = this._adminChain.then(run, run);
    this._adminChain = next.catch(() => {});
    return next;
  }

  query(module, what) { return this.request('module_data', { module, what }); }
  command(module, what) { return this.request('module_command', { module, what }); }
  configure(module, config) { return this.request('module_config', { module, config }); }
  modules() { return this.request('modules'); }
  players() { return this.request('players'); }
  cmd(command, opts) { return this.request('cmd', Object.assign({ command: bareCommand(command) }, opts || {})); }
  chat(text, opts) { return this.request('chat', Object.assign({ text: String(text) }, opts || {})); }
  subscribe(events) { return this.request('subscribe', { events }); }
  close() { this._closed = true; this._sock.end(); this._sock.destroy(); }
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
 * Opens one connection: `auth` first when a token is given (a remote client has ten seconds), then
 * `status`. Rejects only when there is no usable connection, with `code` and `reason` on the error.
 */
async function connect(opts) {
  const o = Object.assign({ host: '127.0.0.1', timeoutMs: 20000, backoffMs: 1000, retries: 3, minProtocol: 1 }, opts || {});
  if (!Number.isInteger(o.port) || o.port <= 0) {
    throw Object.assign(new Error('no port: read it from SSABridge.status.json or ask the owner'), { code: 'no_port' });
  }
  const sock = await openSocket(o.host, o.port, o.timeoutMs);
  const c = new BridgeClient(sock, o);
  const fail = (r) => { c.close(); throw Object.assign(new Error(r.reason), { code: r.code, reason: r.reason }); };
  if (o.token) {
    const a = await c.request('auth', { token: o.token });
    if (!a.ok) fail(a);
  }
  const st = await c.request('status');
  if (!st.ok) fail(st);
  c.status = st.result || {};
  c.protocol = Number.isInteger(c.status.protocol) ? c.status.protocol : 1;
  if (c.protocol < o.minProtocol) {
    fail({ code: 'protocol', reason: `this bridge speaks protocol ${c.protocol}; ${o.minProtocol} or newer is needed (bridge ${c.status.version})` });
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

module.exports = { BridgeClient, connect, discover, bareCommand, toReply };
