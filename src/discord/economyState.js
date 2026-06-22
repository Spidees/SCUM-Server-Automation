'use strict';

// Per-trader fund tracking derived from the economy log.
//
// SCUM.db stores trader funds only under opaque GUIDs (no readable names), but the
// economy log spells the trader out by location/sector/type and prints the running
// balance on every trade, e.g.:
//   [Trade] After tradeable sale to trader C_2_Armory, player ... and trader has 8900 funds.
// We accumulate the latest balance per named trader here so the economy embed can
// show "C2 · Armory — 8,900" instead of a meaningless GUID. State is persisted so a
// restart doesn't blank the embed until every trader trades again.

const fs = require('fs');
const path = require('path');
const fsExtra = require('fs-extra');
const logger = require('../core/logger');
const { paths } = require('../core/config');
const { findLatestLogFile, getLogsDir, readAllLines } = require('./logFeeds/tailer');

const STATE_FILE = path.join(paths.root, 'data', 'economy_traders_state.json');

// Same balance line the economy feed parses; duplicated here (instead of importing
// economyFeed) to avoid a require cycle, since economyFeed already imports this module.
const SEED_RE = /^([\d.-]+):\s+\[Trade\]\s+After\b.*?\btrader\s+([A-Za-z0-9_]+).*?\btrader has\s+(\d+)\s+funds/;

let traders = null; // raw trader name -> { funds, updatedAt }
let saveTimer = null;
let seeded = false;

function load() {
  if (traders) return traders;
  traders = {};
  try {
    if (fs.existsSync(STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.traders) traders = parsed.traders;
    }
  } catch (err) {
    logger.warn(`[EconomyState] Failed to load state: ${err.message}`);
    traders = {};
  }
  return traders;
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fsExtra.ensureDirSync(path.dirname(STATE_FILE));
      fs.writeFileSync(STATE_FILE, JSON.stringify({ traders, lastUpdate: new Date().toISOString() }, null, 2));
    } catch (err) {
      logger.warn(`[EconomyState] Failed to save state: ${err.message}`);
    }
  }, 3000);
  if (saveTimer.unref) saveTimer.unref();
}

/**
 * Split "C_2_Armory" into { location:'C2', sector:'2', type:'Armory', raw }.
 * The type may itself contain underscores (e.g. "Boat_Trader"); everything after
 * the location letter and sector number is the type.
 */
function parseTraderName(raw) {
  const parts = String(raw).split('_');
  if (parts.length >= 3) {
    const loc = parts[0];
    const sector = parts[1];
    const type = parts.slice(2).join(' ');
    return { raw, location: `${loc}${sector}`, sector, type };
  }
  return { raw, location: raw, sector: '', type: raw };
}

/** Record the latest known funds for a trader (from an economy-log trade line). */
function recordTraderFunds(rawName, funds, timestamp) {
  if (!rawName || funds == null || Number.isNaN(funds)) return;
  const store = load();
  store[rawName] = { funds: Number(funds), updatedAt: timestamp || new Date().toISOString() };
  scheduleSave();
}

/**
 * One-time backfill from the whole latest economy log so the embed shows current
 * trader funds immediately after setup instead of waiting for fresh trades. Later
 * lines override earlier ones, so each trader ends on its most recent balance.
 */
function seedFromLog() {
  if (seeded) return;
  seeded = true;
  try {
    const latest = findLatestLogFile(getLogsDir(), 'economy_');
    if (!latest || !fs.existsSync(latest)) return;
    let count = 0;
    for (const line of readAllLines(latest)) {
      const m = SEED_RE.exec(line);
      if (m) { recordTraderFunds(m[2], parseInt(m[3], 10), m[1]); count += 1; }
    }
    if (count) logger.info(`[EconomyState] Seeded trader funds from ${count} log line(s)`);
  } catch (err) {
    logger.warn(`[EconomyState] Failed to seed from log: ${err.message}`);
  }
}

/**
 * All known traders as a sorted array of
 * { raw, location, sector, type, funds, updatedAt }, grouped-friendly by location.
 */
function getTraderFunds() {
  const store = load();
  return Object.entries(store)
    .map(([raw, v]) => ({ ...parseTraderName(raw), funds: v.funds, updatedAt: v.updatedAt }))
    .sort((a, b) => (a.location === b.location
      ? a.type.localeCompare(b.type)
      : a.location.localeCompare(b.location)));
}

module.exports = { recordTraderFunds, getTraderFunds, parseTraderName, seedFromLog };
