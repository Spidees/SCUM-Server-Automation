#!/usr/bin/env node
'use strict';

/*
 * validate-plugins.js: checks SCUM Server Automation plugins before you share them.
 *
 *   node plugins/tools/validate-plugins.js <plugin folder>      one plugin
 *   node plugins/tools/validate-plugins.js <folder of plugins>  every plugin inside it
 *   node plugins/tools/validate-plugins.js a b c                several of either
 *
 * Options:
 *   --strict   warnings fail the run too
 *   --quiet    print only findings and the final line
 *
 * Exit code: 0 when nothing is wrong, 1 when there is at least one error (or a warning
 * with --strict), 2 when the command line itself is wrong.
 *
 * It needs Node 20 or newer and nothing else: no packages, no network. It reads files and
 * never changes one. The rules are the ones the manager applies when it installs a plugin,
 * the ones the scumsa.com library applies when you upload one, and the translation rules
 * on https://scumsa.com/docs/dev/plugin-frontend. Passing here means the plugin is shaped
 * right. It does not run your code: test that in your own manager.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── the languages a plugin may ship ─────────────────────────────────────────
// English is not in the list on purpose: English is the fallback written at each
// SSA.t() call, so a plugin ships no en.json.
const LOCALES = ['cs', 'sk', 'de', 'ru', 'pl', 'es', 'pt', 'fr', 'hr', 'it', 'el', 'tr', 'hu', 'uk',
  'fi', 'sv', 'zh', 'zh-tw', 'th', 'ko'];

const TYPES = ['manager', 'ue4ss', 'ue4ss-runtime'];
const RESERVED_IDS = ['ue4ss', 'ssa-bridge'];
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const MOD_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ICON_EXT_RE = /\.(png|jpe?g|webp)$/i;
const ICON_MAX = 2 * 1024 * 1024;

// The words "capabilities" understands. Module ids are checked by the manager itself,
// against the bridge it ships; here a word only has to have one of these shapes.
const RAW_ACTIONS = ['cmd', 'batch', 'chat', 'console', 'module_config', 'module_command', 'module_data',
  'setcmdprefix', 'spawn', 'groundz', 'list', 'players', 'where', 'name', 'tracediag', 'perf', 'snapshot',
  'status', 'modules', 'subscribe'];
const SAVE_WRITE = 'save:write';

// ── output ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const STRICT = argv.includes('--strict');
const QUIET = argv.includes('--quiet');
const targets = argv.filter((a) => !a.startsWith('--'));
const unknownFlags = argv.filter((a) => a.startsWith('--') && a !== '--strict' && a !== '--quiet');

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node validate-plugins.js [--strict] [--quiet] <plugin folder or folder of plugins> ...');
  process.exit(2);
}
if (unknownFlags.length) usage(`unknown option: ${unknownFlags.join(', ')}`);
if (!targets.length) usage();

/** One plugin's findings. */
function report(label) {
  const r = { label, errors: [], warnings: [], notes: [] };
  r.err = (m) => r.errors.push(m);
  r.warn = (m) => r.warnings.push(m);
  r.note = (m) => r.notes.push(m);
  return r;
}

const some = (list, n = 5) => `${list.slice(0, n).join(', ')}${list.length > n ? ` (+${list.length - n} more)` : ''}`;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const rel = (base, p) => path.relative(base, p).split(path.sep).join('/');

// ── files ───────────────────────────────────────────────────────────────────
function exists(p) { try { fs.statSync(p); return true; } catch { return false; } }
function isFile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

/** Every file under `dir` as a path relative to it, leaving out dist/, node_modules/, dot entries and archives. */
function sourceFiles(dir) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'dist' && e.name !== 'node_modules') walk(p); continue; }
      if (!e.isFile() || /\.zip$/i.test(e.name)) continue;
      out.push(rel(dir, p));
    }
  })(dir);
  return out.sort();
}

/** A manifest path that stays inside the plugin, normalised to forward slashes, or null. */
function safeRel(p) {
  if (typeof p !== 'string' || !p || p.length > 200) return null;
  if (/^[a-z]:/i.test(p) || /^[\\/]/.test(p)) return null;
  if (/[\0<>:"|?*]/.test(p)) return null;
  const parts = p.split(/[\\/]+/).filter((s) => s && s !== '.');
  if (!parts.length || parts.includes('..')) return null;
  return parts.join('/');
}

// ── zip reading (central directory, store and deflate) ─────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * The entries of a zip: [{ name, dir, data }] where `data` is the inflated file. Throws with a
 * readable message for anything this reader does not handle (zip64, encryption, an unknown method)
 * or anything broken (a bad offset, a size or CRC that does not match).
 */
function readZip(file) {
  const buf = fs.readFileSync(file);
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('no end-of-central-directory record, so this is not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOff = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff) throw new Error('zip64 archives are not supported');
  if (cdOff + cdSize > eocd) throw new Error('the central directory points past the end of the file');
  const entries = [];
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`central directory entry ${i + 1} is damaged`);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const loff = buf.readUInt32LE(p + 42);
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    const isDirEntry = name.endsWith('/');
    if (isDirEntry) { entries.push({ name, dir: true, data: null }); continue; }
    if (flags & 0x1) throw new Error(`${name} is encrypted`);
    if (buf.readUInt32LE(loff) !== 0x04034b50) throw new Error(`${name}: its local header is missing`);
    const start = loff + 30 + buf.readUInt16LE(loff + 26) + buf.readUInt16LE(loff + 28);
    const raw = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`${name} uses compression method ${method}; only store and deflate are supported`);
    if (data.length !== usize) throw new Error(`${name} inflates to ${data.length} bytes, the directory says ${usize}`);
    if (crc32(data) !== crc) throw new Error(`${name} fails its CRC check`);
    entries.push({ name, dir: false, data });
  }
  return entries;
}

// ── reading SSA.t() calls out of the code ──────────────────────────────────
/** The source without comments; strings and template literals are kept as they are. */
function withoutComments(src) {
  let out = '';
  let quote = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { if (n !== undefined) out += n; i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; }
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

function unescapeJs(s) {
  return s.replace(/\\(.)/g, (m, ch) => (ch === 'n' ? '\n' : ch === 't' ? '\t' : (ch === "'" || ch === '"' || ch === '\\') ? ch : m));
}

// A string literal in single or double quotes. Each form only excludes its own quote.
const LIT = `(?:'((?:[^'\\\\]|\\\\.)*)'|"((?:[^"\\\\]|\\\\.)*)")`;

/**
 * Every translation key a file asks for: Map key → { fallback: bool, en: string|null }.
 * `en` is null when the fallback is not a plain literal (a variable, a template, a call),
 * and then the two rules that compare a translation with its English skip that key.
 * Local aliases are followed: `const T = SSA.t;` and `function T(k, f) { return SSA.t(k, f); }`.
 */
function translationCalls(src, into) {
  const code = withoutComments(src);
  const aliases = new Set();
  for (const m of code.matchAll(/(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*SSA\s*\.\s*t\b/g)) aliases.add(m[1]);
  for (const m of code.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*return\s+SSA\s*\.\s*t\s*\(/g)) aliases.add(m[1]);
  const callee = ['SSA\\s*\\.\\s*t'].concat(aliases.size ? [`\\b(?:${[...aliases].map((a) => a.replace(/\$/g, '\\$')).join('|')})\\b`] : []).join('|');
  const re = new RegExp(`(?:${callee})\\s*\\(\\s*${LIT}\\s*(,)?\\s*(?:${LIT})?`, 'g');
  let m;
  while ((m = re.exec(code))) {
    const key = m[1] !== undefined ? m[1] : m[2];
    if (!key) continue;
    const hasFallback = m[3] === ',';
    const lit = m[4] !== undefined ? m[4] : m[5];
    let en = lit !== undefined ? unescapeJs(lit) : null;
    if (en !== null) {
      // A fallback written as 'one part ' + 'another' is read whole.
      let i = m.index + m[0].length;
      for (;;) {
        const more = new RegExp(`^\\s*\\+\\s*${LIT}`).exec(code.slice(i, i + 4000));
        if (more) { en += unescapeJs(more[1] !== undefined ? more[1] : more[2]); i += more[0].length; continue; }
        if (/^\s*\+/.test(code.slice(i, i + 50))) en = null;
        break;
      }
    }
    const prev = into.get(key);
    into.set(key, {
      fallback: (prev ? prev.fallback : false) || hasFallback,
      en: prev && prev.en !== null ? prev.en : en,
    });
  }
  return into;
}

function jsFilesUnder(dir) {
  const out = [];
  if (!isDir(dir)) return out;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); } else if (e.name.endsWith('.js')) out.push(p);
    }
  })(dir);
  return out;
}

// ── plurals ─────────────────────────────────────────────────────────────────
const PLURAL_CATS = ['zero', 'one', 'two', 'few', 'many', 'other'];
const VARIANT_RE = /^(.+)\.(zero|one|two|few|many|other)$/;
const categoryCache = new Map();
/** The plural categories a whole number can need in `lang`, `one` always included, `other` never. */
function neededCategories(lang) {
  if (categoryCache.has(lang)) return categoryCache.get(lang);
  let rules;
  try { rules = new Intl.PluralRules(lang); } catch { rules = new Intl.PluralRules('en'); }
  const seen = new Set(['one']);
  for (let i = 0; i <= 1000; i++) seen.add(rules.select(i));
  seen.delete('other');
  const out = PLURAL_CATS.filter((c) => seen.has(c));
  categoryCache.set(lang, out);
  return out;
}
/** `{ base, cat }` when `key` is a plural form of a key `isBase` accepts. */
function variantOf(key, isBase) {
  const m = VARIANT_RE.exec(key);
  return m && isBase(m[1]) ? { base: m[1], cat: m[2] } : null;
}
// `change(s)`, `Änderung(en)`, `item/s`: a plural nobody filled in. Hungarian's `a(z)` is an article.
const FAKE_PLURAL_RE = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]\(\p{Ll}{1,4}\)|\p{L}\/s\b/u;
function fakePlural(v) {
  if (typeof v !== 'string') return null;
  const m = FAKE_PLURAL_RE.exec(v.replace(/(^|[^\p{L}])[aA]\(z\)/gu, '$1'));
  return m ? m[0] : null;
}

const placeholders = (s) => (String(s).match(/\{[A-Za-z_$][\w$]*\}/g) || []).sort().join(',');
const edges = (s) => `${/^\s/.test(s) ? 'lead' : ''}|${/\s$/.test(s) ? 'trail' : ''}`;

// ── the translation rules ───────────────────────────────────────────────────
function checkTranslations(r, dir, man, census) {
  const payload = path.join(dir, 'payload');
  const used = new Map();
  const webScript = man.web && safeRel(man.web.script);
  if (webScript && isFile(path.join(payload, webScript))) translationCalls(fs.readFileSync(path.join(payload, webScript), 'utf8'), used);
  const fcScript = man.fc && safeRel(man.fc.script);
  if (fcScript && isFile(path.join(payload, fcScript))) {
    translationCalls(fs.readFileSync(path.join(payload, fcScript), 'utf8').replace(/\bFC\s*\.\s*t\s*\(/g, 'SSA.t('), used);
  }
  for (const f of jsFilesUnder(path.join(payload, 'backend'))) {
    translationCalls(fs.readFileSync(f, 'utf8').replace(/\bhost\s*\.\s*i18n\s*\.\s*t\s*\(/g, 'SSA.t('), used);
  }

  const i18nRel = man.web && man.web.i18n;
  if (!i18nRel) {
    if (used.size) r.warn(`the code asks for ${used.size} translated string(s) but plugin.json has no web.i18n, so every language shows English`);
    return;
  }
  const i18nSafe = safeRel(i18nRel);
  const i18nDir = i18nSafe && path.join(payload, i18nSafe);
  if (!i18nDir || !isDir(i18nDir)) { r.err(`web.i18n names ${i18nRel}, which is not a folder under payload/`); return; }
  if (!used.size) { r.err('web.i18n is declared but no code calls SSA.t(), FC.t() or host.i18n.t(), so nothing can be translated'); return; }

  const prefix = `pl.${man.id}.`;
  const files = fs.readdirSync(i18nDir).filter((f) => f.endsWith('.json')).sort();
  const others = fs.readdirSync(i18nDir).filter((f) => !f.endsWith('.json') && !f.startsWith('.'));
  if (others.length) r.warn(`${i18nSafe}/ holds files that are not locale files: ${some(others)}`);
  if (files.includes('en.json')) r.err(`${i18nSafe}/en.json must not exist: English is the fallback written at each SSA.t() call`);
  const langs = files.map((f) => f.slice(0, -5)).filter((l) => l !== 'en');
  const unknown = langs.filter((l) => !LOCALES.includes(l));
  if (unknown.length) r.err(`${i18nSafe}/ holds languages the panel does not have: ${unknown.join(', ')} (it has ${LOCALES.join(', ')})`);
  const known = langs.filter((l) => LOCALES.includes(l));
  if (!known.length) r.warn('web.i18n is declared but holds no locale file, so every language shows English');
  else {
    const missingLangs = LOCALES.filter((l) => !known.includes(l));
    if (missingLangs.length) r.warn(`no locale file for ${missingLangs.join(', ')}; those readers get English`);
  }

  const dicts = new Map();
  for (const lang of known) {
    const f = path.join(i18nDir, `${lang}.json`);
    let d;
    try { d = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch (e) { r.err(`${i18nSafe}/${lang}.json is not valid JSON: ${e.message}`); continue; }
    if (!isObj(d)) { r.err(`${i18nSafe}/${lang}.json must be one object of flat "key": "text" pairs`); continue; }
    dicts.set(lang, d);
  }

  // Keys outside the plugin's own prefix. The panel's own keys (nav.plugins, …) may be borrowed,
  // never shipped: a borrowed key the plugin does not ship is noted, a shipped one is an error.
  const shippedAnywhere = new Set();
  for (const d of dicts.values()) for (const k of Object.keys(d)) shippedAnywhere.add(k);
  const foreign = [...used.keys()].filter((k) => !k.startsWith(prefix));
  const borrowed = foreign.filter((k) => !shippedAnywhere.has(k));
  const shippedForeign = foreign.filter((k) => shippedAnywhere.has(k));
  if (borrowed.length) r.note(`read as the panel's own key(s), not shipped by this plugin: ${some(borrowed)}. A key the panel does not have shows its English fallback`);
  if (shippedForeign.length) r.err(`translation keys must start with "${prefix}": ${some(shippedForeign)}. A panel key may be borrowed but never shipped`);
  for (const k of borrowed) used.delete(k);

  const noFallback = [...used].filter(([, v]) => !v.fallback).map(([k]) => k);
  if (noFallback.length) r.err(`SSA.t() with no English fallback (an untranslated language would show the key itself): ${some(noFallback)}`);

  const pluralBases = new Set();
  for (const d of dicts.values()) {
    for (const k of Object.keys(d)) { const v = variantOf(k, (b) => used.has(b)); if (v) pluralBases.add(v.base); }
  }
  const noOne = [...pluralBases].filter((b) => !used.has(`${b}.one`));
  if (noOne.length) r.err(`plural key(s) whose English singular the code never asks for; call "<key>.one" with its own English when the count is 1: ${some(noOne)}`);

  let ok = true;
  for (const [lang, d] of dicts) {
    const file = `${i18nSafe}/${lang}.json`;
    const keys = Object.keys(d);
    const say = (m) => { ok = false; r.err(`${file}: ${m}`); };
    if (keys.includes('')) say('has an empty key ""');
    const nested = keys.filter((k) => d[k] !== null && typeof d[k] === 'object');
    if (nested.length) say(`nested values never resolve, keys must be flat: ${some(nested)}`);
    const notText = keys.filter((k) => d[k] === null || (typeof d[k] !== 'string' && typeof d[k] !== 'object'));
    if (notText.length) say(`values must be text: ${some(notText)}`);
    const empty = keys.filter((k) => typeof d[k] === 'string' && !d[k].trim());
    if (empty.length) say(`empty values show as nothing, not as English: ${some(empty)}`);
    const isExtraVariant = (k) => { const v = variantOf(k, (b) => pluralBases.has(b)); return !!v && v.cat !== 'one'; };
    const extra = keys.filter((k) => k && !used.has(k) && !isExtraVariant(k));
    if (extra.length) say(`${extra.length} key(s) the code never asks for: ${some(extra)}`);
    const missing = [...used.keys()].filter((k) => !Object.prototype.hasOwnProperty.call(d, k));
    if (missing.length) say(`${missing.length} key(s) missing, shown in English inside a ${lang} screen: ${some(missing)}`);

    const need = neededCategories(lang);
    const formsMissing = [];
    for (const b of pluralBases) {
      if (!Object.prototype.hasOwnProperty.call(d, b)) continue;
      for (const c of need) if (typeof d[`${b}.${c}`] !== 'string' && !missing.includes(`${b}.${c}`)) formsMissing.push(`${b}.${c}`);
    }
    if (formsMissing.length) say(`plural form(s) ${lang} needs are missing: ${some(formsMissing)}`);
    const unreachable = keys.filter((k) => { const v = variantOf(k, (b) => pluralBases.has(b)); return v && !need.includes(v.cat); });
    if (unreachable.length) r.warn(`${file}: plural form(s) ${lang} never uses for a whole number: ${some(unreachable)}`);

    const fakes = keys.filter((k) => fakePlural(d[k])).map((k) => `${k} ("${fakePlural(d[k])}")`);
    if (fakes.length) say(`a plural written as a suffix in brackets; give the key real plural forms instead: ${some(fakes, 3)}`);

    // Each value against the English at its call site (a plural form against its base's English).
    const badVars = [];
    const badEdges = [];
    for (const k of keys) {
      if (typeof d[k] !== 'string') continue;
      let src = used.get(k);
      if (!src) { const v = variantOf(k, (b) => pluralBases.has(b)); src = v && used.get(v.base); }
      if (!src || src.en === null) continue;
      if (placeholders(src.en) !== placeholders(d[k])) badVars.push(k);
      else if (edges(src.en) !== edges(d[k])) badEdges.push(k);
    }
    if (badVars.length) say(`{placeholders} differ from the English on ${badVars.length} key(s) (a dropped one loses the value, an invented one shows its braces): ${some(badVars)}`);
    if (badEdges.length) say(`a leading or trailing space differs from the English on ${badEdges.length} key(s): ${some(badEdges)}`);
  }
  if (ok && dicts.size) r.note(`${used.size} translated string(s) in ${dicts.size} language(s), every key in every one`);
  census.keys += used.size;
  census.locales += dicts.size;
}

// ── the bridge declaration ──────────────────────────────────────────────────
function checkBridge(r, man) {
  const b = man.bridge;
  if (b === undefined) return;
  if (!isObj(b)) { r.err('"bridge" must be an object with "needs" and/or "wants"'); return; }
  for (const k of Object.keys(b)) if (k !== 'needs' && k !== 'wants') r.warn(`"bridge.${k}" is not read; only "needs" and "wants" are`);
  const seen = new Map();
  for (const kind of ['needs', 'wants']) {
    const list = b[kind];
    if (list === undefined) continue;
    if (!Array.isArray(list)) { r.err(`"bridge.${kind}" must be an array`); continue; }
    list.forEach((e, i) => {
      const at = `bridge.${kind}[${i}]`;
      if (!isObj(e)) { r.err(`${at} must be an object`); return; }
      const id = typeof e.module === 'string' ? e.module.trim() : '';
      if (!id) { r.err(`${at} has no "module"`); return; }
      if (!Array.isArray(e.switches) || !e.switches.length || !e.switches.every((s) => typeof s === 'string' && s.trim())) {
        r.err(`${at} ("${id}") must list at least one switch name in "switches"`);
        return;
      }
      if (typeof e.why !== 'string' || e.why.trim().length < 12) r.err(`${at} ("${id}") needs a "why" sentence; the owner reads it next to the switch they are asked to turn on`);
      if (seen.has(id)) r.err(`bridge module "${id}" is declared twice (${seen.get(id)} and ${at})`);
      else seen.set(id, at);
      if (id === 'bridge') {
        if (kind === 'needs') r.err(`${at}: the bridge's own settings can only be listed under "wants"`);
        return;
      }
      if (!e.switches.some((s) => s.trim() === 'enabled')) r.err(`${at} ("${id}"): list "enabled" too; a switch inside a module that is off does nothing`);
    });
  }
}

// ── the manifest ────────────────────────────────────────────────────────────
function checkDeps(r, man, field) {
  const v = man[field];
  if (v === undefined) return;
  if (!Array.isArray(v)) { r.err(`"${field}" must be an array`); return; }
  v.forEach((d, i) => {
    const id = typeof d === 'string' ? d : (isObj(d) ? d.id : undefined);
    if (typeof id !== 'string' || !ID_RE.test(id)) r.err(`${field}[${i}] must be a plugin id or { "id": ... }, got ${JSON.stringify(d)}`);
    if (isObj(d) && d.version !== undefined && typeof d.version !== 'string') r.err(`${field}[${i}].version must be a string`);
  });
}

function checkCapabilities(r, man, dir) {
  const caps = man.capabilities;
  if (caps === undefined) return;
  if (!Array.isArray(caps)) { r.err('"capabilities" must be an array of strings'); return; }
  const bad = caps.filter((c) => typeof c !== 'string' || !c.trim());
  if (bad.length) r.err(`"capabilities" holds something that is not a word: ${some(bad.map((c) => JSON.stringify(c)))}`);
  const odd = caps.filter((c) => typeof c === 'string' && c.trim()).map((c) => c.trim()).filter((c) => !(
    c === '*' || c === SAVE_WRITE || /^cmd:.+$/i.test(c) || RAW_ACTIONS.includes(c) || /^[a-z][a-z0-9_]*(?::(read|write))?$/.test(c)));
  if (odd.length) r.warn(`"capabilities" word(s) the manager will not recognise and that grant nothing: ${some(odd)}`);
}

function checkPlugin(dir, census) {
  const folder = path.basename(dir);
  const r = report(folder);
  const manPath = path.join(dir, 'plugin.json');
  let man;
  try { man = JSON.parse(fs.readFileSync(manPath, 'utf8').replace(/^﻿/, '')); } catch (e) { r.err(`plugin.json is not valid JSON: ${e.message}`); return r; }
  if (!isObj(man)) { r.err('plugin.json must be a JSON object'); return r; }

  // identity
  if (typeof man.id !== 'string' || !man.id) r.err('plugin.json has no "id"');
  else {
    if (!ID_RE.test(man.id) || man.id.length > 64) r.err(`id "${man.id}" must be lower-case letters, digits, ".", "_" and "-", starting with a letter or digit, at most 64 characters`);
    if (RESERVED_IDS.includes(man.id.toLowerCase())) r.err(`id "${man.id}" is reserved`);
    if (man.id !== folder) r.err(`id "${man.id}" does not match its folder "${folder}"; the manager installs a plugin into a folder named after its id`);
    r.label = man.id;
  }
  if (typeof man.name !== 'string' || !man.name.trim()) r.err('plugin.json has no "name"');
  if (typeof man.version !== 'string' || !VERSION_RE.test(man.version)) r.err(`version ${JSON.stringify(man.version)} must be x.y.z (for example 1.0.0)`);
  if (man.type === undefined) r.err('plugin.json has no "type"; without it the manager treats the plugin as "ue4ss"');
  else if (!TYPES.includes(man.type)) r.err(`type ${JSON.stringify(man.type)} must be one of ${TYPES.join(', ')}`);
  for (const k of ['minManagerVersion', 'maxManagerVersion']) {
    if (man[k] === undefined || man[k] === null) continue;
    if (typeof man[k] !== 'string' || !VERSION_RE.test(man[k])) r.err(`${k} ${JSON.stringify(man[k])} must be x.y.z`);
  }
  if (man.type === 'manager' && !man.minManagerVersion) r.warn('no minManagerVersion: name the oldest manager you tested on, or an older one may load it and fail');
  if (man.apiVersion !== undefined && man.apiVersion !== 1) r.err(`apiVersion ${JSON.stringify(man.apiVersion)}: only 1 exists, and a manager does not load another`);
  for (const k of ['description', 'author', 'website', 'updated']) {
    if (man[k] !== undefined && typeof man[k] !== 'string') r.err(`"${k}" must be text`);
  }
  if (typeof man.website === 'string' && man.website && !/^https?:\/\//i.test(man.website)) r.warn('"website" is not an http(s) link, so the library does not show it');
  if (man.modName !== undefined && (typeof man.modName !== 'string' || !MOD_NAME_RE.test(man.modName))) r.err(`modName ${JSON.stringify(man.modName)} must be a plain folder name`);

  // paths the manifest names
  const named = {};
  for (const [field, underPayload] of [['main', true], ['config', true], ['image', false], ['readme', false]]) {
    if (man[field] === undefined || man[field] === null) continue;
    const s = safeRel(man[field]);
    if (!s) { r.err(`"${field}" ${JSON.stringify(man[field])} must be a path inside the plugin's own folder`); continue; }
    const where = underPayload ? `payload/${s}` : s;
    if (!isFile(path.join(dir, where))) r.err(`"${field}" names ${where}, which does not exist`);
    else named[field] = where;
  }
  for (const part of ['web', 'fc']) {
    const block = man[part];
    if (block === undefined) continue;
    if (!isObj(block)) { r.err(`"${part}" must be an object`); continue; }
    for (const k of ['script', 'style']) {
      if (block[k] === undefined) continue;
      const s = safeRel(block[k]);
      if (!s) r.err(`${part}.${k} ${JSON.stringify(block[k])} must be a path inside payload/`);
      else if (!isFile(path.join(dir, 'payload', s))) r.err(`${part}.${k} names payload/${s}, which does not exist`);
    }
    if (part === 'fc' && 'requireLogin' in block && typeof block.requireLogin !== 'boolean') {
      r.err(`fc.requireLogin is ${JSON.stringify(block.requireLogin)}; only true or false work, anything else leaves the tab public`);
    }
  }

  // payload
  const payloadFiles = isDir(path.join(dir, 'payload')) ? sourceFiles(path.join(dir, 'payload')) : [];
  if (!payloadFiles.length) r.err('payload/ is missing or empty; everything a plugin deploys lives there');
  if (man.type === 'manager') {
    if (!man.main && !(isObj(man.web) && man.web.script) && !(isObj(man.fc) && man.fc.script)) r.err('a manager plugin needs "main", "web.script" or "fc.script"; this one runs nothing');
    if (!man.main && isFile(path.join(dir, 'payload', 'backend', 'index.js'))) r.warn('payload/backend/index.js exists but "main" does not name it, so it never runs');
    if (!(isObj(man.web) && man.web.script) && isFile(path.join(dir, 'payload', 'web', 'plugin.js'))) r.warn('payload/web/plugin.js exists but "web.script" does not name it, so it never loads');
  }
  if (man.type === 'ue4ss' && !payloadFiles.some((f) => /^Mods\/[^/]+\/(Scripts\/main\.lua|dlls\/main\.dll)$/.test(f))) {
    r.err('a ue4ss plugin needs payload/Mods/<Mod>/Scripts/main.lua or payload/Mods/<Mod>/dlls/main.dll');
  }

  // readme and icon
  if (!named.readme && !isFile(path.join(dir, 'README.md'))) r.err('README.md is missing; owners read it on the plugin card and in the library');
  if (isFile(path.join(dir, 'icon.png')) && !man.image) r.err('icon.png exists but plugin.json has no "image", so the icon never shows');
  if (named.image) {
    if (!ICON_EXT_RE.test(named.image)) r.warn(`the icon ${named.image} is not .png, .jpg or .webp, so the library does not show it`);
    else if (fs.statSync(path.join(dir, named.image)).size > ICON_MAX) r.warn(`the icon ${named.image} is over 2 MB, so the library does not show it`);
  }

  // config
  if (named.config && /\.json$/i.test(named.config)) {
    try { JSON.parse(fs.readFileSync(path.join(dir, named.config), 'utf8').replace(/^﻿/, '')); } catch (e) { r.err(`${named.config} is not valid JSON: ${e.message}`); }
  }

  checkDeps(r, man, 'dependencies');
  checkDeps(r, man, 'optionalDependencies');
  checkCapabilities(r, man, dir);
  checkBridge(r, man);

  // A save write is refused unless the plugin names "save:write" itself; "*" does not cover it.
  const caps = Array.isArray(man.capabilities) ? man.capabilities.map((c) => String(c).trim()) : [];
  const writesSave = jsFilesUnder(path.join(dir, 'payload', 'backend'))
    .some((f) => /\bhost\s*\.\s*db\s*\.\s*scum\s*\.\s*write\s*\(/.test(withoutComments(fs.readFileSync(f, 'utf8'))));
  if (writesSave && !caps.includes(SAVE_WRITE)) r.err('the backend calls host.db.scum.write() but "capabilities" does not list "save:write"; every such call is refused');

  if (isObj(man.web) || isObj(man.fc) || man.type === 'manager') checkTranslations(r, dir, man, census);
  if (typeof man.id === 'string' && typeof man.version === 'string') checkDist(r, dir, man);
  return r;
}

// ── a packed zip next to the source ────────────────────────────────────────
function checkDist(r, dir, man) {
  const distDirs = [path.join(dir, 'dist'), path.join(path.dirname(dir), 'dist')].filter(isDir);
  const prefix = new RegExp(`^${man.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d`);
  const zips = [];
  for (const d of distDirs) for (const f of fs.readdirSync(d)) if (prefix.test(f) && f.endsWith('.zip')) zips.push(path.join(d, f));
  if (!zips.length) return;
  const want = `${man.id}-${man.version}.zip`;
  const current = zips.find((z) => path.basename(z) === want);
  if (!current) { r.err(`dist/ has ${zips.map((z) => path.basename(z)).join(', ')} but plugin.json says ${man.version}; ${want} is missing`); return; }
  const older = zips.filter((z) => z !== current);
  if (older.length) r.warn(`dist/ also holds older zips: ${older.map((z) => path.basename(z)).join(', ')}`);

  let entries;
  try { entries = readZip(current); } catch (e) { r.err(`${want} cannot be read: ${e.message}`); return; }
  const files = entries.filter((e) => !e.dir);
  const unsafe = files.filter((e) => e.name.includes('\\') || safeRel(e.name) !== e.name);
  if (unsafe.length) r.err(`${want} holds entries with an unsafe path: ${some(unsafe.map((e) => e.name))}`);
  if (!files.some((e) => e.name === 'plugin.json')) r.err(`${want} has no plugin.json at the top of the archive`);
  const refused = files.filter((e) => e.name.split('/').some((p) => p.startsWith('.') || p === 'dist' || p === 'node_modules') || /\.zip$/i.test(e.name));
  if (refused.length) r.err(`${want} carries files a plugin zip must not carry (dot-files, archives, dist/ or node_modules/): ${some(refused.map((e) => e.name))}`);

  const source = new Set(sourceFiles(dir));
  const inZip = new Set();
  const differ = [];
  const onlyInZip = [];
  for (const e of files) {
    inZip.add(e.name);
    if (!source.has(e.name)) { onlyInZip.push(e.name); continue; }
    if (!e.data.equals(fs.readFileSync(path.join(dir, e.name)))) differ.push(e.name);
  }
  const notPacked = [...source].filter((f) => !inZip.has(f));
  if (!differ.length && !onlyInZip.length && !notPacked.length) { r.note(`${want} is byte for byte the source (${files.length} files)`); return; }
  const parts = [];
  if (differ.length) parts.push(`${differ.length} file(s) differ: ${some(differ, 4)}`);
  if (notPacked.length) parts.push(`${notPacked.length} in the source and not in the zip: ${some(notPacked, 4)}`);
  if (onlyInZip.length) parts.push(`${onlyInZip.length} in the zip and not in the source: ${some(onlyInZip, 4)}`);
  // A source change waiting for its release is normal: the zip is repacked under a new version
  // when it ships. So this warns; --strict makes it fail.
  r.warn(`${want} is not the source: ${parts.join('; ')}. A new zip ships under a new version`);
}

// ── run ─────────────────────────────────────────────────────────────────────
const pluginDirs = [];
let skipped = 0;
for (const t of targets) {
  const abs = path.resolve(t);
  if (!isDir(abs)) usage(`not a folder: ${t}`);
  if (isFile(path.join(abs, 'plugin.json'))) { pluginDirs.push(abs); continue; }
  const subs = fs.readdirSync(abs, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'dist').map((e) => path.join(abs, e.name)).sort();
  for (const s of subs) { if (isFile(path.join(s, 'plugin.json'))) pluginDirs.push(s); else skipped++; }
}
if (!pluginDirs.length) { console.error('no plugin.json found in any folder given'); process.exit(1); }

const census = { keys: 0, locales: 0 };
let errors = 0;
let warnings = 0;
for (const d of pluginDirs) {
  const r = checkPlugin(d, census);
  errors += r.errors.length;
  warnings += r.warnings.length;
  const bad = r.errors.length || (STRICT && r.warnings.length);
  if (QUIET && !r.errors.length && !r.warnings.length) continue;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${r.label} (${rel(process.cwd(), d) || '.'})`);
  for (const m of r.errors) console.log(`     error: ${m}`);
  for (const m of r.warnings) console.log(`     warn:  ${m}`);
  if (!QUIET) for (const m of r.notes) console.log(`     note:  ${m}`);
}
const failed = errors + (STRICT ? warnings : 0);
const tail = `${pluginDirs.length} plugin(s), ${census.locales} locale file(s), ${census.keys} translated string(s)`
  + `${skipped ? `, ${skipped} folder(s) without plugin.json skipped` : ''}`;
if (failed) {
  console.log(`\n${errors} error(s), ${warnings} warning(s) in ${tail}${STRICT && warnings ? ' (--strict: warnings fail)' : ''}`);
  process.exit(1);
}
console.log(`\nvalid: ${tail}, ${warnings} warning(s)`);
