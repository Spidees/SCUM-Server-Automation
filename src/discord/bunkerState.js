'use strict';

// Tracks the current state of abandoned bunkers (active / locked) parsed from the
// [LogBunkerLock] lines in gameplay_*.log. The game periodically dumps the full
// state ("X1 Bunker is Active. Activated Xh ago. X=.. Y=.. Z=..") plus emits
// Activated / Deactivated events; we keep the latest state per sector so the live
// Discord embed can show it.

const fs = require('fs');
const logger = require('../core/logger');
const { findLatestLogFile, getLogsDir, readAllLines } = require('./logFeeds/tailer');

const TS_RE = /^(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):/;
const ACTIVE_RE = /\[LogBunkerLock\]\s+([A-Z]\d+)\s+Bunker is Active\.\s+Activated\s+(.+?)\s+ago\.\s+X=([-\d.]+)\s+Y=([-\d.]+)\s+Z=([-\d.]+)/;
const LOCKED_RE = /\[LogBunkerLock\]\s+([A-Z]\d+)\s+Bunker is Locked\.?\s*(.*)/;
const ACTIVATED_RE = /\[LogBunkerLock\]\s+([A-Z]\d+)\s+Bunker Activated\s+(.+?)\s+ago/;
const DEACTIVATED_RE = /\[LogBunkerLock\]\s+([A-Z]\d+)\s+Bunker Deactivated/;

const bunkers = new Map(); // sector -> { state, activationUnix, location, eta, updatedAt }
let seeded = false;

/** SCUM logs are UTC; return the line's epoch ms or null. */
function parseLineTimeMs(line) {
  const m = TS_RE.exec(line);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

function agoToSeconds(text) {
  let total = 0;
  let m;
  if ((m = /(\d+)\s*h/.exec(text))) total += +m[1] * 3600;
  if ((m = /(\d+)\s*m/.exec(text))) total += +m[1] * 60;
  if ((m = /(\d+)\s*s/.exec(text))) total += +m[1];
  return total;
}

/** Process a single gameplay log line; updates bunker state if it's a bunker line. */
function processLine(line) {
  if (!line || line.indexOf('[LogBunkerLock]') === -1) return;
  let m;

  if ((m = ACTIVE_RE.exec(line))) {
    const lineMs = parseLineTimeMs(line);
    const activationUnix = lineMs ? Math.floor((lineMs - agoToSeconds(m[2]) * 1000) / 1000) : null;
    bunkers.set(m[1], {
      state: 'active',
      activationUnix,
      location: { x: parseFloat(m[3]), y: parseFloat(m[4]), z: parseFloat(m[5]) },
      eta: null,
      updatedAt: Date.now(),
    });
    return;
  }

  if ((m = ACTIVATED_RE.exec(line))) {
    const lineMs = parseLineTimeMs(line);
    const activationUnix = lineMs ? Math.floor((lineMs - agoToSeconds(m[2]) * 1000) / 1000) : null;
    const prev = bunkers.get(m[1]) || {};
    bunkers.set(m[1], { ...prev, state: 'active', activationUnix, eta: null, updatedAt: Date.now() });
    return;
  }

  if ((m = DEACTIVATED_RE.exec(line))) {
    const prev = bunkers.get(m[1]) || {};
    bunkers.set(m[1], { ...prev, state: 'locked', activationUnix: null, updatedAt: Date.now() });
    return;
  }

  if ((m = LOCKED_RE.exec(line))) {
    const sector = m[1];
    const rest = m[2] || '';
    const prev = bunkers.get(sector) || {};

    // "next Activation in 07h 39m 35s" -> absolute activation time
    let etaUnix = null;
    const em = /next Activation in\s+([\dhms\s]+)/i.exec(rest);
    const lineMs = parseLineTimeMs(line);
    if (em && lineMs) etaUnix = Math.floor((lineMs + agoToSeconds(em[1]) * 1000) / 1000);

    // location (kept only for the map link, never shown as raw coords)
    let location = prev.location || null;
    const lm = /X=([-\d.]+)\s+Y=([-\d.]+)\s+Z=([-\d.]+)/.exec(rest);
    if (lm) location = { x: parseFloat(lm[1]), y: parseFloat(lm[2]), z: parseFloat(lm[3]) };

    bunkers.set(sector, { ...prev, state: 'locked', activationUnix: null, etaUnix, location, updatedAt: Date.now() });
  }
}

/** One-time seed from the whole latest gameplay log so the embed isn't empty at startup. */
function seedFromLog() {
  if (seeded) return;
  seeded = true;
  try {
    const latest = findLatestLogFile(getLogsDir(), 'gameplay_');
    if (!latest || !fs.existsSync(latest)) return;
    for (const line of readAllLines(latest)) {
      if (line.indexOf('[LogBunkerLock]') !== -1) processLine(line);
    }
    logger.info(`[Bunkers] Seeded ${bunkers.size} bunker(s) from ${latest}`);
  } catch (err) {
    logger.warn(`[Bunkers] Failed to seed bunker state: ${err.message}`);
  }
}

function getBunkers() {
  return [...bunkers.entries()]
    .map(([sector, info]) => ({ sector, ...info }))
    .sort((a, b) => a.sector.localeCompare(b.sector));
}

module.exports = { processLine, seedFromLog, getBunkers };
