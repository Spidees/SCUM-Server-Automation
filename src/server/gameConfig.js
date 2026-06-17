'use strict';

const fs = require('fs');
const path = require('path');
const { paths } = require('../core/config');

const CONFIG_DIR = () => path.join(paths.savedDir, 'Config', 'WindowsServer');

const INI_FILES = {
  'server-settings': 'ServerSettings.ini',
};

const LIST_FILES = {
  'admin-users': 'AdminUsers.ini',
  'banned-users': 'BannedUsers.ini',
  'exclusive-users': 'ExclusiveUsers.ini',
  'whitelisted-users': 'WhitelistedUsers.ini',
};

// Raw-JSON files edited via a textarea in the dashboard.
const JSON_FILES = {
  economy: 'EconomyOverride.json',
  'raid-times': 'RaidTimes.json',
  notifications: 'Notifications.json',
};

const UTF16LE_BOM = '﻿';

// ---------------------------------------------------------------------------
// Encoding detection — SCUM writes these files as either UTF-8 (no BOM) or
// UTF-16LE (with BOM) depending on the version, so we must detect & preserve.
// ---------------------------------------------------------------------------

/**
 * Detect the text encoding of a buffer: 'utf16le' or 'utf8'.
 * Uses BOMs first, then a null-byte heuristic for BOM-less UTF-16LE.
 */
function detectBufferEncoding(buf) {
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return 'utf16le';
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return 'utf8';
  // BOM-less heuristic: ASCII text encoded as UTF-16LE has 0x00 in every odd byte.
  const sample = Math.min(buf.length, 128);
  let zeros = 0;
  for (let i = 1; i < sample; i += 2) if (buf[i] === 0x00) zeros += 1;
  if (sample > 1 && zeros > sample / 4) return 'utf16le';
  return 'utf8';
}

/** Detect the encoding of an on-disk file (defaults to 'utf8' if missing). */
function detectFileEncoding(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(128);
    const bytesRead = fs.readSync(fd, buf, 0, 128, 0);
    fs.closeSync(fd);
    return detectBufferEncoding(buf.subarray(0, bytesRead));
  } catch {
    return 'utf8';
  }
}

/** Read a text file with auto-detected encoding, stripping any BOM. */
function readTextFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const encoding = detectBufferEncoding(buf);
  const text = buf.toString(encoding).replace(/^﻿/, '');
  return { text, encoding };
}

/** Write a text file in the given encoding (UTF-16LE keeps a BOM; UTF-8 has none). */
function writeTextFile(filePath, text, encoding) {
  if (encoding === 'utf16le') {
    fs.writeFileSync(filePath, UTF16LE_BOM + text, 'utf16le');
  } else {
    fs.writeFileSync(filePath, text, 'utf8');
  }
}

// ---------------------------------------------------------------------------
// INI helpers
// ---------------------------------------------------------------------------

/**
 * Read an INI file (UTF-8 or UTF-16LE, auto-detected) into an ordered line array
 * plus a flat values map.
 * Line types: {type:'section',name}, {type:'kv',section,key,raw}, {type:'other',raw}.
 * Values are type-inferred: "0"/"1" → boolean, numeric strings → number, else string.
 */
function readIni(filePath) {
  const { text: raw } = readTextFile(filePath);
  const rawLines = raw.split(/\r?\n/);
  const lines = [];
  const values = {};
  let currentSection = '';

  for (const rawLine of rawLines) {
    const stripped = rawLine.trimEnd();
    const sectionMatch = /^\[([^\]]+)\]/.exec(stripped);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      lines.push({ type: 'section', name: currentSection, raw: stripped });
      continue;
    }
    const kvMatch = /^([^=;#]+)=(.*)$/.exec(stripped);
    if (kvMatch && currentSection) {
      const key = kvMatch[1].trimEnd();
      const val = kvMatch[2];
      const flatKey = `${currentSection}||${key}`;
      lines.push({ type: 'kv', section: currentSection, key, raw: stripped });
      values[flatKey] = inferType(val);
      continue;
    }
    lines.push({ type: 'other', raw: stripped });
  }

  return { lines, values };
}

function inferType(val) {
  // Only literal True/False are booleans. "0"/"1" are kept as numbers — many SCUM
  // settings use integers like 0/1/2 that must NOT be turned into checkboxes.
  if (/^(true|false)$/i.test(val)) return /^true$/i.test(val);
  if (/^-?\d+(\.\d+)?$/.test(val)) return Number(val);
  return val;
}

function serializeValue(v) {
  // SCUM writes booleans as the textual True/False (see ServerSettings.ini).
  if (v === true) return 'True';
  if (v === false) return 'False';
  return String(v);
}

/**
 * Write back an INI file (preserving its original encoding), applying `updates`
 * (flat {SectionKey: value} map).
 */
function writeIni(filePath, lines, updates) {
  const encoding = detectFileEncoding(filePath);
  const out = lines.map((line) => {
    if (line.type !== 'kv') return line.raw;
    const flatKey = `${line.section}||${line.key}`;
    if (!(flatKey in updates)) return line.raw;
    const newSerialized = serializeValue(updates[flatKey]);
    // Skip rewriting when the value is effectively unchanged so we don't reformat
    // untouched lines the form posts back (e.g. "400.000000" → "400").
    const eqIdx = line.raw.indexOf('=');
    const originalValue = eqIdx >= 0 ? line.raw.slice(eqIdx + 1) : '';
    if (serializeValue(inferType(originalValue)) === newSerialized) return line.raw;
    return `${line.key}=${newSerialized}`;
  });

  writeTextFile(filePath, out.join('\r\n'), encoding);
}

// ---------------------------------------------------------------------------
// Line-list helpers (AdminUsers.ini, BannedUsers.ini, …)
// ---------------------------------------------------------------------------

function readLines(filePath) {
  if (!fs.existsSync(filePath)) return { lines: [] };
  const { text } = readTextFile(filePath);
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd());
  return { lines };
}

function writeLines(filePath, lines) {
  const encoding = detectFileEncoding(filePath);
  writeTextFile(filePath, lines.join('\r\n'), encoding);
}

// ---------------------------------------------------------------------------
// Economy JSON helpers
// ---------------------------------------------------------------------------

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function writeJson(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, '\t'), 'utf8');
}

// ---------------------------------------------------------------------------
// Public helpers (used by API route)
// ---------------------------------------------------------------------------

function resolveIniPath(key) {
  const name = INI_FILES[key];
  if (!name) return null;
  return path.join(CONFIG_DIR(), name);
}

function resolveListPath(key) {
  const name = LIST_FILES[key];
  if (!name) return null;
  return path.join(CONFIG_DIR(), name);
}

function resolveJsonPath(key) {
  const name = JSON_FILES[key];
  if (!name) return null;
  return path.join(CONFIG_DIR(), name);
}

module.exports = {
  INI_FILES,
  LIST_FILES,
  JSON_FILES,
  resolveIniPath,
  resolveListPath,
  resolveJsonPath,
  readIni,
  writeIni,
  readLines,
  writeLines,
  readJson,
  writeJson,
};
