#!/usr/bin/env node
'use strict';

/*
 * test-validate-plugins.js: proves that every rule in validate-plugins.js still fires.
 *
 *   node plugins/tools/test-validate-plugins.js
 *
 * It copies examples/hello-plugin into a temporary folder, breaks one thing at a time and
 * runs the validator on the copy. The unbroken copy must pass; every broken one must fail
 * (or warn) with the finding that names what was broken. A rule that no longer fires on its
 * own defect is a rule that is silently gone, so run this after changing the validator.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const VALIDATOR = path.join(__dirname, 'validate-plugins.js');
const SAMPLE = path.join(__dirname, '..', 'examples', 'hello-plugin');
const ID = 'hello-plugin';
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'ssa-validate-'));

// ── a small zip writer, so the dist/ rules can be tested without packages ──
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function writeZip(file, entries) {
  const locals = [];
  const central = [];
  let off = 0;
  entries.forEach(({ name, data }, i) => {
    const deflate = i % 2 === 0;                     // alternate store and deflate
    const body = deflate ? zlib.deflateRawSync(data) : data;
    const n = Buffer.from(name, 'utf8');
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt16LE(deflate ? 8 : 0, 8);
    h.writeUInt32LE(crc32(data), 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    locals.push(h, n, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(deflate ? 8 : 0, 10);
    c.writeUInt32LE(crc32(data), 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(off, 42);
    central.push(c, n);
    off += 30 + n.length + body.length;
  });
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  fs.writeFileSync(file, Buffer.concat([...locals, cd, e]));
}
function filesOf(dir) {
  const out = [];
  (function walk(d) {
    for (const x of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, x.name);
      if (x.isDirectory()) { if (x.name !== 'dist') walk(p); } else out.push(path.relative(dir, p).split(path.sep).join('/'));
    }
  })(dir);
  return out.sort();
}
const packOf = (dir) => filesOf(dir).map((name) => ({ name, data: fs.readFileSync(path.join(dir, name)) }));

// ── helpers that break the copy ────────────────────────────────────────────
let n = 0;
function fresh() {
  const dir = path.join(WORK, String(++n), ID);
  fs.cpSync(SAMPLE, dir, { recursive: true });
  return dir;
}
const P = (dir, ...p) => path.join(dir, ...p);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n');
const manifest = (dir, fn) => { const f = P(dir, 'plugin.json'); const m = readJson(f); fn(m); writeJson(f, m); };
const locale = (dir, lang, fn) => { const f = P(dir, 'payload', 'web', 'i18n', `${lang}.json`); const d = readJson(f); fn(d); writeJson(f, d); };
const allLocales = (dir, fn) => { for (const f of fs.readdirSync(P(dir, 'payload', 'web', 'i18n'))) locale(dir, f.slice(0, -5), fn); };
const appendWeb = (dir, src) => fs.appendFileSync(P(dir, 'payload', 'web', 'plugin.js'), `\n${src}\n`);
const appendBackend = (dir, src) => fs.appendFileSync(P(dir, 'payload', 'backend', 'index.js'), `\n${src}\n`);
// A key hello-plugin asks for with a plain English fallback that carries a placeholder, read from the
// sample itself so the test follows the example when it changes.
function keyWithPlaceholder(dir) {
  const src = fs.readFileSync(P(dir, 'payload', 'web', 'plugin.js'), 'utf8');
  const m = /SSA\.t\('(pl\.hello-plugin\.[^']+)',\s*'([^']*\{[A-Za-z_]+\}[^']*)'/.exec(src);
  if (!m) throw new Error('the sample no longer has a translated string with a placeholder');
  return { key: m[1], en: m[2], token: /\{[A-Za-z_]+\}/.exec(m[2])[0] };
}

function run(dir, flags = []) {
  const r = spawnSync(process.execPath, [VALIDATOR, ...flags, dir], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

// Each case: what to break, the exit code wanted, and the text the finding must contain.
const cases = [
  ['the sample as it is passes', () => {}, 0, 'valid: 1 plugin(s)'],
  ['id that is not its folder', (d) => manifest(d, (m) => { m.id = 'hello-other'; }), 1, 'does not match its folder'],
  ['id with capitals', (d) => manifest(d, (m) => { m.id = 'Hello-Plugin'; }), 1, 'must be lower-case'],
  ['reserved id', (d) => { const to = path.join(path.dirname(d), 'ssa-bridge'); fs.renameSync(d, to); manifest(to, (m) => { m.id = 'ssa-bridge'; }); return to; }, 1, 'is reserved'],
  ['version that is not x.y.z', (d) => manifest(d, (m) => { m.version = '1.0'; }), 1, 'must be x.y.z (for example'],
  ['no name', (d) => manifest(d, (m) => { delete m.name; }), 1, 'has no "name"'],
  ['no type', (d) => manifest(d, (m) => { delete m.type; }), 1, 'has no "type"'],
  ['unknown type', (d) => manifest(d, (m) => { m.type = 'node'; }), 1, 'must be one of manager'],
  ['minManagerVersion not x.y.z', (d) => manifest(d, (m) => { m.minManagerVersion = '6'; }), 1, 'minManagerVersion "6" must be x.y.z'],
  ['no minManagerVersion warns', (d) => manifest(d, (m) => { delete m.minManagerVersion; }), 0, 'no minManagerVersion'],
  ['no minManagerVersion fails with --strict', (d) => manifest(d, (m) => { delete m.minManagerVersion; }), 1, '--strict: warnings fail', ['--strict']],
  ['apiVersion 2', (d) => manifest(d, (m) => { m.apiVersion = 2; }), 1, 'only 1 exists'],
  ['main names a missing file', (d) => manifest(d, (m) => { m.main = 'backend/nope.js'; }), 1, '"main" names payload/backend/nope.js'],
  ['main leaves the plugin', (d) => manifest(d, (m) => { m.main = '../../outside.js'; }), 1, 'must be a path inside'],
  ['web.script names a missing file', (d) => manifest(d, (m) => { m.web.script = 'web/nope.js'; }), 1, 'web.script names payload/web/nope.js'],
  ['fc.requireLogin as text', (d) => manifest(d, (m) => { m.fc.requireLogin = 'true'; }), 1, 'fc.requireLogin is "true"'],
  ['config is not valid JSON', (d) => fs.writeFileSync(P(d, 'payload', 'config.json'), '{ "a": 1,, }'), 1, 'payload/config.json is not valid JSON'],
  ['README missing', (d) => { fs.rmSync(P(d, 'README.md')); manifest(d, (m) => { delete m.readme; }); }, 1, 'README.md is missing'],
  ['icon present, image not named', (d) => manifest(d, (m) => { delete m.image; }), 1, 'icon.png exists but plugin.json has no "image"'],
  ['empty payload', (d) => { fs.rmSync(P(d, 'payload'), { recursive: true }); fs.mkdirSync(P(d, 'payload')); }, 1, 'payload/ is missing or empty'],
  ['dependency that is not an id', (d) => manifest(d, (m) => { m.dependencies = [{}]; }), 1, 'dependencies[0] must be a plugin id'],
  ['capability that is not text', (d) => manifest(d, (m) => { m.capabilities = ['chat', 3]; }), 1, 'holds something that is not a word'],
  ['capability nobody recognises warns', (d) => manifest(d, (m) => { m.capabilities = ['Give Items']; }), 0, 'will not recognise'],
  ['save write without save:write', (d) => { appendBackend(d, 'module.exports._w = (host) => host.db.scum.write({});'); manifest(d, (m) => { m.capabilities = ['*']; }); }, 1, 'does not list "save:write"'],
  ['save write with save:write passes', (d) => { appendBackend(d, 'module.exports._w = (host) => host.db.scum.write({});'); manifest(d, (m) => { m.capabilities = ['save:write']; }); }, 0, 'valid: 1 plugin(s)'],
  ['bridge need without enabled', (d) => manifest(d, (m) => { m.bridge = { needs: [{ module: 'live', switches: ['where'], why: 'Reads where players stand.' }] }; }), 1, 'list "enabled" too'],
  ['bridge need without why', (d) => manifest(d, (m) => { m.bridge = { needs: [{ module: 'live', switches: ['enabled'] }] }; }), 1, 'needs a "why" sentence'],
  ['locale file not valid JSON', (d) => fs.writeFileSync(P(d, 'payload', 'web', 'i18n', 'cs.json'), '{ "x": '), 1, 'cs.json is not valid JSON'],
  ['en.json shipped', (d) => fs.copyFileSync(P(d, 'payload', 'web', 'i18n', 'de.json'), P(d, 'payload', 'web', 'i18n', 'en.json')), 1, 'en.json must not exist'],
  ['unknown language', (d) => fs.copyFileSync(P(d, 'payload', 'web', 'i18n', 'de.json'), P(d, 'payload', 'web', 'i18n', 'xx.json')), 1, 'languages the panel does not have: xx'],
  ['a language left out warns', (d) => fs.rmSync(P(d, 'payload', 'web', 'i18n', 'fi.json')), 0, 'no locale file for fi'],
  ['a key missing in one language', (d) => { const { key } = keyWithPlaceholder(d); locale(d, 'cs', (x) => { delete x[key]; }); }, 1, 'cs.json: 1 key(s) missing'],
  ['a key nobody asks for', (d) => locale(d, 'de', (x) => { x['pl.hello-plugin.neverAsked'] = 'Nie gefragt'; }), 1, 'de.json: 1 key(s) the code never asks for'],
  ['an unprefixed key shipped', (d) => { appendWeb(d, "SSA.t('greeting.other', 'Hello');"); allLocales(d, (x) => { x['greeting.other'] = 'Hallo'; }); }, 1, 'must start with "pl.hello-plugin."'],
  ['an empty value', (d) => { const { key } = keyWithPlaceholder(d); locale(d, 'fr', (x) => { x[key] = '  '; }); }, 1, 'fr.json: empty values'],
  ['an empty key', (d) => locale(d, 'fr', (x) => { x[''] = 'rien'; }), 1, 'has an empty key'],
  ['a nested value', (d) => { const { key } = keyWithPlaceholder(d); locale(d, 'it', (x) => { x[key] = { a: 'b' }; }); }, 1, 'it.json: nested values'],
  ['a placeholder dropped', (d) => { const { key } = keyWithPlaceholder(d); locale(d, 'pl', (x) => { x[key] = 'bez zmiennej'; }); }, 1, 'pl.json: {placeholders} differ'],
  ['a placeholder invented', (d) => { const { key } = keyWithPlaceholder(d); locale(d, 'sv', (x) => { x[key] = `${x[key]} {extra}`; }); }, 1, 'sv.json: {placeholders} differ'],
  ['a trailing space added', (d) => { const { key } = keyWithPlaceholder(d); locale(d, 'hu', (x) => { x[key] = `${x[key]} `; }); }, 1, 'hu.json: a leading or trailing space differs'],
  ['SSA.t() with no fallback', (d) => { appendWeb(d, "SSA.t('pl.hello-plugin.bare');"); allLocales(d, (x) => { x['pl.hello-plugin.bare'] = 'x'; }); }, 1, 'with no English fallback'],
  ['a concatenated fallback is read whole', (d) => { appendWeb(d, "SSA.t('pl.hello-plugin.long', 'First half, ' +\n  'second half {n}.', { n: 1 });"); allLocales(d, (x) => { x['pl.hello-plugin.long'] = 'Eins, zwei {n}.'; }); }, 0, 'valid: 1 plugin(s)'],
  ['a fake plural', (d) => { const { key, token } = keyWithPlaceholder(d); locale(d, 'de', (x) => { x[key] = `${token} Änderung(en)`; }); }, 1, 'a plural written as a suffix in brackets'],
  ['a plural form a language needs', (d) => {
    appendWeb(d, "n === 1 ? SSA.t('pl.hello-plugin.things.one', '{n} thing', { n }) : SSA.t('pl.hello-plugin.things', '{n} things', { n });");
    allLocales(d, (x) => { x['pl.hello-plugin.things'] = '{n} x'; x['pl.hello-plugin.things.one'] = '{n} x'; x['pl.hello-plugin.things.few'] = '{n} x'; x['pl.hello-plugin.things.many'] = '{n} x'; });
    locale(d, 'cs', (x) => { delete x['pl.hello-plugin.things.few']; });
  }, 1, 'plural form(s) cs needs are missing: pl.hello-plugin.things.few'],
  ['a plural whose singular the code never asks for', (d) => {
    appendWeb(d, "SSA.t('pl.hello-plugin.items', '{n} items', { n });");
    allLocales(d, (x) => { x['pl.hello-plugin.items'] = '{n} x'; x['pl.hello-plugin.items.few'] = '{n} x'; });
  }, 1, 'whose English singular the code never asks for'],
  ['a matching zip passes', (d) => { fs.mkdirSync(P(d, 'dist')); writeZip(P(d, 'dist', `${ID}-${readJson(P(d, 'plugin.json')).version}.zip`), packOf(d)); }, 0, 'is byte for byte the source'],
  ['a zip that differs warns', (d) => {
    const z = packOf(d); z.find((e) => e.name === 'README.md').data = Buffer.from('old readme\n');
    fs.mkdirSync(P(d, 'dist')); writeZip(P(d, 'dist', `${ID}-${readJson(P(d, 'plugin.json')).version}.zip`), z);
  }, 0, '1 file(s) differ: README.md'],
  ['a zip that differs fails with --strict', (d) => {
    const z = packOf(d).filter((e) => e.name !== 'icon.png');
    fs.mkdirSync(P(d, 'dist')); writeZip(P(d, 'dist', `${ID}-${readJson(P(d, 'plugin.json')).version}.zip`), z);
  }, 1, 'in the source and not in the zip: icon.png', ['--strict']],
  ['a zip under another version', (d) => { fs.mkdirSync(P(d, 'dist')); writeZip(P(d, 'dist', `${ID}-0.0.1.zip`), packOf(d)); }, 1, 'is missing'],
  ['a zip in the folder beside the plugins', (d) => { const dist = path.join(path.dirname(d), 'dist'); fs.mkdirSync(dist); writeZip(path.join(dist, `${ID}-0.0.1.zip`), packOf(d)); }, 1, 'is missing'],
  ['a zip carrying a dot-file', (d) => {
    const z = packOf(d); z.push({ name: '.env', data: Buffer.from('TOKEN=x\n') });
    fs.mkdirSync(P(d, 'dist')); writeZip(P(d, 'dist', `${ID}-${readJson(P(d, 'plugin.json')).version}.zip`), z);
  }, 1, 'must not carry'],
  ['a zip with plugin.json in a sub-folder', (d) => {
    const z = packOf(d).map((e) => ({ name: `inner/${e.name}`, data: e.data }));
    fs.mkdirSync(P(d, 'dist')); writeZip(P(d, 'dist', `${ID}-${readJson(P(d, 'plugin.json')).version}.zip`), z);
  }, 1, 'no plugin.json at the top'],
  ['a damaged zip', (d) => {
    fs.mkdirSync(P(d, 'dist')); const f = P(d, 'dist', `${ID}-${readJson(P(d, 'plugin.json')).version}.zip`);
    writeZip(f, packOf(d)); const b = fs.readFileSync(f); b[40] ^= 0xff; fs.writeFileSync(f, b);
  }, 1, 'cannot be read'],
];

let failed = 0;
try {
  for (const [label, breakIt, wantCode, wantText, flags] of cases) {
    const dir = fresh();
    const target = breakIt(dir) || dir;
    const r = run(target, flags);
    const ok = r.code === wantCode && r.out.includes(wantText);
    if (!ok) {
      failed++;
      console.log(`FAIL ${label}: wanted exit ${wantCode} and "${wantText}", got exit ${r.code}`);
      console.log(r.out.split('\n').map((l) => `     | ${l}`).join('\n'));
    } else console.log(`ok   ${label}`);
  }
} finally {
  fs.rmSync(WORK, { recursive: true, force: true });
}
console.log(`\n${cases.length - failed} of ${cases.length} case(s) behaved${failed ? `, ${failed} did not` : ''}`);
process.exit(failed ? 1 : 0);
