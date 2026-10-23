'use strict';

/**
 * A stand-in for the manager's plugin `host`, so a plugin's backend can be tested with plain Node:
 * no manager, no game server, no SSA Bridge and no Discord. It needs Node 20 or newer and no packages.
 *
 *   const { loadPlugin } = require('./mock-host');
 *   const mock = await loadPlugin('path/to/my-plugin', { online: [{ steamId: '7656…', name: 'Ann' }] });
 *   const { replies } = await mock.say('/online', { steamId: '7656…', name: 'Ann' });
 *
 * What it promises is the published typings next to it (`ssa-plugin-sdk.d.ts`), read when a mock is
 * made, and nothing beyond them:
 *
 *  • A name the typings do not have is not on the real host either. Reading one THROWS a
 *    `MockHostError` with the code `not_in_host`, and is recorded in `mock.refusals` in case the plugin
 *    caught it. `'name' in host.x` answers false and records nothing, so feature detection stays quiet.
 *  • A documented name this mock does not act out throws `not_modelled` when called. Give it a
 *    stand-in for your test with `extend: { 'map.sector': () => 'B2' }`.
 *  • The bridge and the game answer only what your test says they answer: `host.server.command()` and
 *    every `host.bridge.*` call throw `no_answer` until you pass one (`commands`, `bridge`). A test that
 *    forgot to say what the game replies is a test that proves nothing.
 *  • `without: ['time', 'routes.player']` takes documented names away, the way an older manager
 *    lacks them, so you can test your feature detection.
 *
 * Passing here means your plugin uses the host the way the typings describe. It does not mean the
 * game does what you asked, so try the plugin on your own server too.
 *
 * MIT licence, like every example in this folder. Copy it into your own plugin's tests.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_TYPINGS = path.join(__dirname, 'ssa-plugin-sdk.d.ts');

class MockHostError extends Error {
  constructor(code, member, message) {
    super(message);
    this.name = 'MockHostError';
    this.code = code;
    this.member = member;
  }
}

// ── The typings reader ──────────────────────────────────────────────────────────────────────────

/** The source with comments removed and string contents emptied, so braces inside them do not count. */
function stripNoise(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 1;
      out += ' ';
    } else if (c === '/' && d === '/') {
      const end = src.indexOf('\n', i);
      i = end < 0 ? src.length : end - 1;
    } else if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += c + c;
      i = j;
    } else out += c;
  }
  return out;
}

/** The index of the bracket that closes the one at `open`. */
function closing(src, open) {
  const pair = { '{': '}', '(': ')', '[': ']' };
  const want = pair[src[open]];
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === src[open]) depth++;
    else if (src[i] === want && --depth === 0) return i;
  }
  return -1;
}

/** Split a type body into its members, at `;`, `,` and line ends that sit outside every bracket. */
function splitTop(body, seps) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '{' || c === '(' || c === '[' || c === '<') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (c === '>' && body[i - 1] !== '=') depth--;
    if (depth === 0 && seps.includes(c)) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const MEMBER = /^(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*(\?)?\s*(<[^(]*?>)?\s*([:(])/;

/**
 * Read the `Host` interface of the published typings: every name two deep, and three deep where a
 * member's member is itself an object (`db.scum.all`, `routes.public.get`).
 * Answers `{ has(name), isCallable(name), names(prefix), all() }`; `names('')` is the top level.
 */
function readTypings(file = DEFAULT_TYPINGS) {
  const src = stripNoise(fs.readFileSync(file, 'utf8'));
  const interfaces = new Map();
  const re = /\binterface\s+([A-Za-z_$][\w$]*)\s*(?:<[^{]*?>)?\s*(?:extends\s+[^{]+)?\{/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const open = m.index + m[0].length - 1;
    const end = closing(src, open);
    if (end > open) interfaces.set(m[1], src.slice(open + 1, end));
  }
  if (!interfaces.has('Host')) throw new Error(`${file} has no interface Host`);
  const table = new Map();
  const walk = (body, prefix, level) => {
    for (const seg of splitTop(body, ';,\n')) {
      const m = MEMBER.exec(seg);
      if (!m) continue;
      const name = prefix ? `${prefix}.${m[1]}` : m[1];
      const method = m[4] === '(';
      const type = method ? '' : seg.slice(m[0].length).trim();
      const parts = method ? [] : splitTop(type, '&|');
      const callable = method || parts.some((p) => /^\(+/.test(p) && p.includes('=>'));
      table.set(name, { callable, optional: !!m[2] });
      if (callable || level >= 3) continue;
      for (const p of parts) {
        if (p.startsWith('{')) walk(p.slice(1, closing(p, 0)), name, level + 1);
        else {
          const ref = /^([A-Za-z_$][\w$]*)/.exec(p);
          if (ref && interfaces.has(ref[1])) walk(interfaces.get(ref[1]), name, level + 1);
        }
      }
    }
  };
  walk(interfaces.get('Host'), '', 1);
  return {
    has: (name) => table.has(name),
    isCallable: (name) => !!(table.get(name) || {}).callable,
    names: (prefix) => [...table.keys()]
      .filter((k) => (prefix ? k.startsWith(`${prefix}.`) && !k.slice(prefix.length + 1).includes('.') : !k.includes('.')))
      .map((k) => (prefix ? k.slice(prefix.length + 1) : k))
      .sort(),
    all: () => [...table.keys()].sort(),
  };
}

// ── Texts in a player's language, as the manager renders them ──────────────────────────────────

const isLoc = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.text === 'string';
const ESC = { '[': '\uE000', ']': '\uE001', '{': '\uE002', '}': '\uE003' };
const UNESC = { '\uE000': '[', '\uE001': ']', '\uE002': '{', '\uE003': '}' };

/** `{name}` placeholders (case-insensitive), `[ optional segments ]`, `\[` for a literal bracket. */
function fill(text, vars) {
  const v = vars && typeof vars === 'object' ? vars : {};
  const val = (k) => {
    let x = Object.prototype.hasOwnProperty.call(v, k) ? v[k] : undefined;
    if (x === undefined) {
      const hit = Object.keys(v).find((n) => n.toLowerCase() === String(k).toLowerCase());
      x = hit !== undefined ? v[hit] : undefined;
    }
    return x == null ? '' : String(x);
  };
  let s = String(text == null ? '' : text).replace(/\\([[\]{}])/g, (m, c) => ESC[c]);
  let dropped = false;
  s = s.replace(/\[([^[\]]*)\]/g, (m, inner) => {
    const toks = inner.match(/\{(\w+)\}/g) || [];
    if (toks.some((t) => val(t.slice(1, -1)) === '')) { dropped = true; return ''; }
    return inner;
  });
  let emptied = false;
  s = s.replace(/\{(\w+)\}/g, (m, k) => { const out = val(k); if (out === '') emptied = true; return out; });
  if (dropped || emptied) {
    s = s.replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([,.!?;:])/g, '$1')
      .replace(/^[\s,;:\u2014\u2013]+/, '')
      .replace(/[\s,;:\u2014\u2013-]+$/, '')
      .trim();
  }
  return s.replace(/[\uE000-\uE003]/g, (c) => UNESC[c]);
}

function pick(loc, lang, serverLang) {
  if (!isLoc(loc)) return typeof loc === 'string' ? loc : (loc == null ? '' : String(loc));
  const code = String(lang || '').toLowerCase();
  if (!code || code === serverLang) return loc.text;
  const v = loc.i18n && typeof loc.i18n === 'object' ? loc.i18n[code] : null;
  return typeof v === 'string' && v.trim() ? v : loc.text;
}

// ── The mock ────────────────────────────────────────────────────────────────────────────────────

const QUIET = new Set(['then', 'toJSON', 'inspect', 'constructor', 'asymmetricMatch', 'nodeType', '$$typeof']);
const PLAYER_ROUTE_REFUSAL = { error: 'login_required', reason: 'sign in on the Field Console to use this' };

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * Make a mock host. Every option is optional:
 *
 *   plugin       the plugin folder (holds plugin.json); gives `info`, the shipped config and the locales
 *   config       the owner's config (default: the plugin's payload/config.json, else `{}`)
 *   configSaveFails  `config.set()` throws, as it does when the manager cannot save
 *   store        the key/value store's starting content
 *   online       the players online: `[{ steamId, name }]`
 *   players      profiles for `players.bySteamId()`: `{ [steamId]: profile }`
 *   serverLang   default 'en'; `playerLangs` `{ [steamId]: 'cs' }` is each player's own choice
 *   items        game names for `items.name()`: `{ Weapon_M1911: 'M1911' }`
 *   serverRunning  what `server.isRunning()` answers (default false)
 *   bridgeOnline what `bridge.available()` answers (default true)
 *   commands     what the game answers to `server.command()`: a function `(cmd, opts) => answer`, or
 *                `{ SpawnItem: answer }` by the command's first word, where an answer may be a function
 *   bridge       what the bridge answers: `{ livePlayers: [...], command: (moduleId, what) => ... }`
 *   enforceCapabilities  refuse `server.command()` for a verb plugin.json `capabilities` does not cover
 *   chatDelivers default true; false makes `chat.send/dm/broadcast` reject, as with the bridge down
 *   premium      what `premium.active()` answers (default false)
 *   services     other plugins' services for `consume()`: `{ name: api }`
 *   without      documented names to take away, as an older manager lacks them
 *   extend       stand-ins for documented names: `{ 'db.scum.available': () => true }`
 *   typings      another copy of ssa-plugin-sdk.d.ts
 *   verbose      print the plugin's log lines as they happen
 */
function createMockHost(opts = {}) {
  const typings = readTypings(opts.typings || DEFAULT_TYPINGS);
  const without = new Set(opts.without || []);
  const extend = opts.extend || {};
  for (const name of Object.keys(extend)) {
    if (!typings.has(name)) throw new MockHostError('not_in_host', name, `extend names host.${name}, which the manager does not have`);
  }
  const answers = opts.bridge || {};
  for (const name of Object.keys(answers)) {
    if (!typings.has(`bridge.${name}`)) throw new MockHostError('not_in_host', `bridge.${name}`, `bridge names host.bridge.${name}, which the manager does not have`);
  }

  const pluginDir = opts.plugin ? path.resolve(opts.plugin) : null;
  const manifest = pluginDir ? readJson(path.join(pluginDir, 'plugin.json')) : null;
  if (pluginDir && !manifest) throw new Error(`no readable plugin.json in ${pluginDir}`);
  const id = (manifest && manifest.id) || 'mock-plugin';
  const payload = pluginDir ? path.join(pluginDir, 'payload') : null;
  const shipped = payload && manifest && manifest.config ? readJson(path.join(payload, manifest.config)) : null;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ssa-mock-host-'));
  const dataDir = path.join(root, 'plugins', id, 'state');
  fs.mkdirSync(dataDir, { recursive: true });

  const st = {
    config: { ...(opts.config || shipped || {}) },
    store: new Map(Object.entries(opts.store || {})),
    online: (opts.online || []).map((p) => ({ steamId: String(p.steamId), name: String(p.name || '') })),
    playerLangs: { ...(opts.playerLangs || {}) },
    listeners: [],
    commands: new Map(),
    routes: [],
    unloadFns: [],
    providedServices: new Map(),
  };
  const serverLang = String(opts.serverLang || 'en').toLowerCase();
  const mock = {
    host: null,
    logs: [],
    chat: [],
    commandsSent: [],
    bridgeCalls: [],
    refusals: [],
    emitted: [],
    notifications: [],
    realtime: [],
    timers: [],
    discord: { buttons: [], slash: [], messages: [], embeds: [] },
    errors: [],
  };

  const refuse = (code, member, message) => {
    const e = new MockHostError(code, member, message);
    mock.refusals.push({ code, member, message });
    return e;
  };
  const notModelled = (name) => () => {
    throw refuse('not_modelled', name, `host.${name} is in the typings but this mock does not act it out; give your test a stand-in: extend: { '${name}': ... }`);
  };
  const log = (level) => (m) => {
    const message = String(m);
    mock.logs.push({ level, message });
    if (opts.verbose) console.log(`[${id}] ${level}: ${message}`);
  };

  // i18n, as the manager renders it.
  const dicts = new Map();
  const dict = (code) => {
    if (dicts.has(code)) return dicts.get(code);
    const rel = manifest && manifest.web && typeof manifest.web.i18n === 'string' ? manifest.web.i18n : null;
    const d = rel && /^[a-z]{2}(?:-[a-z]{2})?$/.test(code) ? readJson(path.join(payload, rel, `${code}.json`)) : null;
    dicts.set(code, d);
    return d;
  };
  const langOf = (steamId) => String(st.playerLangs[String(steamId)] || serverLang).toLowerCase();
  const render = (loc, lang, vars) => { const t = pick(loc, lang, serverLang); return vars ? fill(t, vars) : t; };
  const deliver = (kind, text, o, to) => {
    const lang = to ? langOf(to) : serverLang;
    const line = { kind, to: to || null, text: render(text, lang, o && o.vars), opts: o || {} };
    mock.chat.push(line);
    if (opts.chatDelivers === false) return Promise.reject(new Error('the SSA Bridge is not answering, so nothing was sent'));
    return Promise.resolve({ channel: (o && o.channel) || 'global', delivered: to ? 1 : st.online.length });
  };

  const unsubscribe = (list, entry) => () => { const i = list.indexOf(entry); if (i >= 0) list.splice(i, 1); };
  const on = (evt, fn, once) => {
    const entry = { evt: String(evt), fn, once: !!once };
    st.listeners.push(entry);
    return unsubscribe(st.listeners, entry);
  };
  const fire = (evt, payloadArg) => {
    for (const l of st.listeners.slice()) {
      if (l.evt !== evt) continue;
      if (l.once) unsubscribe(st.listeners, l)();
      try { l.fn(payloadArg); } catch (e) { mock.errors.push({ where: `event ${evt}`, error: e }); }
    }
  };
  const route = (scope, method) => (p, handler) => { st.routes.push({ scope, method, path: String(p), handler }); };
  const routeApi = (scope) => ({ get: route(scope, 'GET'), post: route(scope, 'POST'), put: route(scope, 'PUT'), delete: route(scope, 'DELETE') });
  const timer = (kind) => (ms, fn) => {
    if (typeof ms !== 'number' || typeof fn !== 'function') return () => {};
    const entry = { kind, ms, fn };
    mock.timers.push(entry);
    return unsubscribe(mock.timers, entry);
  };
  const health = () => (opts.bridgeOnline === false
    ? { available: false, licensed: false, players: 0, error: 'bridge_off' }
    : { available: true, licensed: true, players: st.online.length, version: 'mock' });

  const permitted = (cmd) => {
    if (!opts.enforceCapabilities) return true;
    const caps = (manifest && Array.isArray(manifest.capabilities)) ? manifest.capabilities : null;
    if (!caps) return true;
    const verb = String(cmd).trim().split(/\s+/)[0].toLowerCase();
    return caps.some((c) => c === 'cmd' || String(c).toLowerCase() === `cmd:${verb}`);
  };
  const gameAnswer = (cmd, o) => {
    const c = opts.commands;
    const verb = String(cmd).trim().split(/\s+/)[0];
    let a;
    if (typeof c === 'function') a = c(cmd, o);
    else if (c && typeof c === 'object') {
      const key = Object.keys(c).find((k) => k.toLowerCase() === verb.toLowerCase());
      a = key === undefined ? undefined : (typeof c[key] === 'function' ? c[key](cmd, o) : c[key]);
    }
    if (a === undefined && opts.bridgeOnline === false) a = { ok: false, error: 'bridge_off' };
    if (a === undefined) throw refuse('no_answer', 'server.command', `the test did not say what the game answers to "${cmd}"; pass commands: { ${verb}: { ok: true, executor: 'mock', output: [] } }`);
    return a;
  };

  // What this mock acts out, by the name the typings give it.
  const model = {
    'info.id': id,
    'info.dir': pluginDir || root,
    'info.libDir': path.join(root, 'plugins', id),
    'info.dataDir': dataDir,
    'info.version': (manifest && manifest.version) || '0.0.0',
    'info.apiVersion': (manifest && manifest.apiVersion) || 1,
    'paths.root': root,
    'paths.serverDir': path.join(root, 'server'),
    'paths.appRoot': root,

    'logger.info': log('info'), 'logger.warn': log('warn'), 'logger.error': log('error'), 'logger.debug': log('debug'),

    'events.on': (evt, fn) => on(evt, fn, false),
    'events.once': (evt, fn) => on(evt, fn, true),
    'events.emit': (evt, p) => {
      const name = String(evt).includes(':') ? String(evt) : `${id}:${evt}`;
      mock.emitted.push({ event: name, payload: p });
      fire(name, p);
    },

    'config.get': () => JSON.parse(JSON.stringify(st.config)),
    'config.text': () => JSON.stringify(st.config, null, 2),
    'config.set': (patch) => {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return JSON.parse(JSON.stringify(st.config));
      if (opts.configSaveFails || (manifest && !manifest.config)) throw new Error('the config file could not be written');
      st.config = { ...st.config, ...JSON.parse(JSON.stringify(patch)) };
      const next = JSON.parse(JSON.stringify(st.config));
      fire(`${id}:config`, next);
      return next;
    },
    'config.onChange': (fn) => on(`${id}:config`, fn, false),

    'store.get': (k, dflt) => (st.store.has(String(k)) ? st.store.get(String(k)) : (dflt === undefined ? null : dflt)),
    'store.set': (k, v) => { st.store.set(String(k), v); return v; },
    'store.delete': (k) => { st.store.delete(String(k)); },
    'store.all': () => Object.fromEntries(st.store),
    'store.clear': () => { st.store.clear(); },

    sqlite: () => null,

    'db.scum.available': () => false,
    'db.scum.all': () => [],
    'db.scum.get': () => null,
    'db.scum.excludeDeleted': (sql) => sql,
    'db.manager.kills': () => [],
    'db.manager.trades': () => [],

    'players.bySteamId': (sid) => ((opts.players || {})[String(sid)] || null),
    'players.onJoin': (fn) => on('player:join', fn, false),
    'players.onLeave': (fn) => on('player:leave', fn, false),

    'items.name': (code) => ((opts.items || {})[code] || String(code)),
    'items.image': () => null,
    'items.imageUrl': () => null,
    'items.actorName': (n) => String(n == null ? '' : n),

    'map.world': () => opts.world || null,
    'stats.onlineCount': () => st.online.length,

    'server.isRunning': () => !!opts.serverRunning,
    'server.bridge': async () => health(),
    'server.command': async (cmd, o) => {
      mock.commandsSent.push({ cmd: String(cmd), opts: o || {} });
      if (!permitted(cmd)) {
        return { ok: false, code: 'not_permitted', error: 'capability_refused', reason: `plugin.json capabilities do not cover "${String(cmd).split(/\s+/)[0]}"` };
      }
      return gameAnswer(cmd, o);
    },

    'discord.enabled': () => false,
    'discord.client': () => null,
    'discord.send': async () => false,
    'discord.onButton': (customId, fn) => { const e = { customId, fn }; mock.discord.buttons.push(e); return unsubscribe(mock.discord.buttons, e); },
    'discord.registerSlash': async (data, fn) => { mock.discord.slash.push({ data, fn }); return false; },
    'discord.onMessage': (fn) => { const e = { fn }; mock.discord.messages.push(e); return unsubscribe(mock.discord.messages, e); },
    'discord.onEmbed': (kind, fn) => { const e = { kind, fn }; mock.discord.embeds.push(e); return unsubscribe(mock.discord.embeds, e); },

    'schedule.every': timer('every'),
    'schedule.after': timer('after'),

    'chat.onCommand': (name, handler, o) => {
      const key = String(name).toLowerCase();
      st.commands.set(key, { handler, opts: o || {} });
      return () => { st.commands.delete(key); };
    },
    'chat.prefix': () => '/',
    'chat.send': (text, o) => deliver('send', text, o, o && Array.isArray(o.targets) && o.targets.length === 1 ? o.targets[0] : null),
    'chat.dm': (steamId, text, o) => deliver('dm', text, o, String(steamId)),
    'chat.broadcast': (text, o) => deliver('broadcast', text, o, null),

    'i18n.languages': () => {
      const out = [{ code: 'en', name: 'English' }];
      const rel = manifest && manifest.web && manifest.web.i18n;
      try {
        for (const f of fs.readdirSync(path.join(payload, rel)).sort()) if (f.endsWith('.json')) out.push({ code: f.slice(0, -5), name: f.slice(0, -5) });
      } catch { /* no locales */ }
      return out;
    },
    'i18n.serverLang': () => serverLang,
    'i18n.playerLang': (sid) => langOf(sid),
    'i18n.setPlayerLang': (sid, lang) => { st.playerLangs[String(sid)] = lang || null; return { ok: true, lang: lang || serverLang }; },
    'i18n.pick': (loc, lang) => pick(loc, lang, serverLang),
    'i18n.fill': (text, vars) => fill(text, vars),
    'i18n.render': (loc, lang, vars) => render(loc, lang, vars),
    'i18n.t': (key, fallback, lang, vars) => {
      const d = dict(String(lang || serverLang).toLowerCase());
      const v = d && typeof d[key] === 'string' && d[key] !== '' ? d[key] : (fallback == null ? String(key == null ? '' : key) : String(fallback));
      return vars ? fill(v, vars) : v;
    },

    // An empty schedule is always open; a real one is the manager's clock, so give your test a stand-in.
    'time.isOpen': (schedule) => {
      if (schedule == null || (Array.isArray(schedule) && !schedule.length)) {
        return { open: true, why: 'no time window is set, so this is always available', opensInMinutes: null, closesInMinutes: null, invalid: [] };
      }
      return notModelled('time.isOpen')();
    },
    'time.describe': (schedule) => {
      if (schedule == null || (Array.isArray(schedule) && !schedule.length)) return 'Always available \u2014 no time window is set.';
      return notModelled('time.describe')();
    },

    'routes.get': route('admin', 'GET'), 'routes.post': route('admin', 'POST'),
    'routes.put': route('admin', 'PUT'), 'routes.delete': route('admin', 'DELETE'),
    'realtime.toAdmins': (event, p) => { mock.realtime.push({ event, payload: p }); },
    'premium.active': () => !!opts.premium,
    notify: (type, data) => { mock.notifications.push({ type, data }); },
    provide: (name, api) => { st.providedServices.set(String(name), api); },
    consume: (name) => ((opts.services || {})[name] || null),
    onUnload: (fn) => { if (typeof fn === 'function') st.unloadFns.push(fn); },
  };
  for (const scope of ['public', 'player']) {
    for (const [m, fn] of Object.entries(routeApi(scope))) model[`routes.${scope}.${m}`] = fn;
  }
  model['bridge.available'] = async () => health().available;

  /** A namespace that throws on a name the typings do not have. */
  const guard = (target, prefix) => new Proxy(target, {
    get(t, k) {
      if (typeof k === 'symbol' || QUIET.has(k) || k in Object.prototype || Object.prototype.hasOwnProperty.call(t, k)) return Reflect.get(t, k);
      const name = prefix ? `${prefix}.${k}` : k;
      if (without.has(name)) return undefined;
      throw refuse('not_in_host', name, `host.${name} does not exist: the manager has no such name, so a plugin that reads it breaks on every server`);
    },
  });
  /** A documented value this mock does not act out (`discord.js`): every read of it throws. */
  const opaque = (name) => new Proxy({}, {
    get(t, k) {
      if (typeof k === 'symbol' || QUIET.has(k)) return undefined;
      throw refuse('not_modelled', `${name}.${String(k)}`, `host.${name} is in the typings but this mock does not act it out; give your test a stand-in: extend: { '${name}': ... }`);
    },
  });
  const bridgeCall = (member) => (...args) => {
    mock.bridgeCalls.push({ name: member, args });
    if (Object.prototype.hasOwnProperty.call(answers, member)) {
      const a = answers[member];
      return Promise.resolve(typeof a === 'function' ? a(...args) : a);
    }
    if (model[`bridge.${member}`]) return model[`bridge.${member}`](...args);
    throw refuse('no_answer', `bridge.${member}`, `the test did not say what the bridge answers to host.bridge.${member}(); pass bridge: { ${member}: ... }`);
  };
  const build = (prefix) => {
    const ns = {};
    for (const k of typings.names(prefix)) {
      const name = prefix ? `${prefix}.${k}` : k;
      if (without.has(name)) continue;
      if (Object.prototype.hasOwnProperty.call(extend, name)) ns[k] = extend[name];
      else if (prefix === 'bridge') ns[k] = bridgeCall(k);
      else if (Object.prototype.hasOwnProperty.call(model, name)) ns[k] = model[name];
      else if (typings.isCallable(name)) ns[k] = notModelled(name);
      else if (typings.names(name).length) ns[k] = build(name);
      else ns[k] = opaque(name);
    }
    return guard(ns, prefix);
  };
  mock.host = build('');

  /** Load the plugin's backend and call its `register(host)`. Answers the plugin module. */
  mock.load = async () => {
    if (!pluginDir) throw new Error('createMockHost({ plugin }) names no plugin folder to load');
    const main = path.join(payload, manifest.main || 'backend/index.js');
    for (const k of Object.keys(require.cache)) if (k.startsWith(pluginDir)) delete require.cache[k];
    mock.plugin = require(main);
    await mock.plugin.register(mock.host);
    return mock.plugin;
  };
  /** Call `unregister(host)` and every `onUnload` function, then remove the mock's temporary folder. Once. */
  let unloaded = false;
  mock.unload = async () => {
    if (unloaded) return;
    unloaded = true;
    try {
      if (mock.plugin && typeof mock.plugin.unregister === 'function') await mock.plugin.unregister(mock.host);
      for (const fn of st.unloadFns.splice(0)) fn();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
  /**
   * A player types a line in game. Answers `{ replies, error }`: what the command said back to that
   * player, and what it threw (the manager logs a throw and the player gets no answer).
   */
  mock.say = async (line, from = {}) => {
    const raw = String(line);
    if (!raw.startsWith('/')) return { replies: [], error: null, handled: false };
    const body = raw.slice(1);
    const sp = body.search(/\s/);
    const name = (sp < 0 ? body : body.slice(0, sp)).toLowerCase();
    const argString = sp < 0 ? '' : body.slice(sp + 1).trim();
    const entry = st.commands.get(name);
    if (!entry) return { replies: [], error: null, handled: false };
    const sid = String(from.steamId || '');
    const lang = sid ? langOf(sid) : serverLang;
    const replies = [];
    const ctx = {
      steamId: sid,
      name: String(from.name || ''),
      channel: from.channel || 'global',
      command: name,
      argString,
      args: argString ? argString.split(/\s+/) : [],
      lang,
      reply: (text, a, b) => {
        const isOpts = !!a && typeof a === 'object' && Object.keys(a).length > 0 && Object.keys(a).every((k) => k === 'channel' || k === 'vars');
        const o = isOpts ? a : (b || {});
        const vars = isOpts ? a.vars : ((a && typeof a === 'object') ? a : (o && o.vars));
        replies.push((text && typeof text === 'object') || vars ? render(text, lang, vars) : String(text));
        return Promise.resolve();
      },
    };
    let error = null;
    try { await entry.handler(ctx); } catch (e) { error = e; mock.errors.push({ where: `/${name}`, error: e }); }
    return { replies, error, handled: true };
  };
  /** What a command's `status` option tells the built-in /help for one player. */
  mock.commandStatus = async (name, steamId) => {
    const entry = st.commands.get(String(name).toLowerCase());
    if (!entry || typeof entry.opts.status !== 'function') return null;
    return entry.opts.status({ steamId: String(steamId || '') });
  };
  mock.commandNames = () => [...st.commands.keys()].sort();
  /** A player joins or leaves; `onJoin` and `player:join` listeners hear it. */
  mock.join = (player) => { st.online.push({ steamId: String(player.steamId), name: String(player.playerName || player.name || '') }); fire('player:join', player); };
  mock.leave = (player) => { st.online = st.online.filter((p) => p.steamId !== String(player.steamId)); fire('player:leave', player); };
  /** The manager raises an event on the plugin bus (`kill`, `server:online`, …). */
  mock.emit = (evt, p) => fire(String(evt), p);
  /** Run every scheduled function once; an `after` timer is spent by it. */
  mock.runTimers = async () => {
    for (const t of mock.timers.slice()) {
      if (t.kind === 'after') unsubscribe(mock.timers, t)();
      await t.fn();
    }
  };
  /** A service this plugin provided with `host.provide()`. */
  mock.service = (name) => st.providedServices.get(String(name)) || null;
  mock.config = () => JSON.parse(JSON.stringify(st.config));
  mock.store = () => Object.fromEntries(st.store);
  /**
   * Call one of the plugin's HTTP routes. `scope` is 'admin' (default, `routes.*`), 'public' or
   * 'player'. Answers `{ status, body }`.
   */
  mock.request = async (method, url, { scope = 'admin', body, query, visitor = null } = {}) => {
    const want = String(url).split('?')[0];
    for (const r of st.routes) {
      if (r.scope !== scope || r.method !== String(method).toUpperCase()) continue;
      const names = [];
      const re = new RegExp(`^${r.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)/g, (m, n) => { names.push(n); return '([^/]+)'; })}$`);
      const m = re.exec(want);
      if (!m) continue;
      if (scope === 'player' && !visitor) return { status: 401, body: { ...PLAYER_ROUTE_REFUSAL } };
      const params = {};
      names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
      const out = { status: 200, body: undefined, headers: {} };
      const res = {
        status(n) { out.status = n; return res; },
        json(b) { out.body = b; return res; },
        send(b) { out.body = b; return res; },
        end() { return res; },
        set(k, v) { out.headers[String(k).toLowerCase()] = v; return res; },
        type(t) { out.headers['content-type'] = t; return res; },
      };
      res.header = res.set;
      const req = { method: r.method, path: want, params, query: query || {}, body: body === undefined ? {} : body, visitor };
      try { await r.handler(req, res); } catch (e) {
        mock.errors.push({ where: `${r.method} ${r.path}`, error: e });
        return { status: 500, body: { error: 'handler_threw', reason: e.message } };
      }
      return out;
    }
    return { status: 404, body: { error: 'no_route' } };
  };
  return mock;
}

/** `createMockHost({ ...opts, plugin: dir })`, then `load()`. */
async function loadPlugin(dir, opts = {}) {
  const mock = createMockHost({ ...opts, plugin: dir });
  await mock.load();
  return mock;
}

module.exports = { createMockHost, loadPlugin, readTypings, MockHostError, fill };
