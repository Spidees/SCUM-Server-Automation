'use strict';

// Rolling record of recent marketplace trades, derived from the economy log. The
// economy feed already parses every "Tradeable (...) sold/purchased by ..." line;
// we keep the last few here so the Field Console can show live market activity
// (recent trades, hot items, turnover) instead of only static trader funds.

const fs = require('fs');
const path = require('path');
const logger = require('../core/logger');
const { paths } = require('../core/config');
const { parseTraderName } = require('./economyState');
const { getItemDisplayName } = require('./items');

const MAX = 250; // rolling buffer size — keeps a good chunk of recent history
let recent = []; // newest first: { ts, item, player, price, action, traderLoc, traderType }
let seeded = false;
let loaded = false;
let saveTimer = null;

// Persisted across restarts so market activity survives a script restart.
const STATE_FILE = path.join(paths.root, 'data', 'economy_trades_state.json');

// Same trade line the economy feed parses, with the leading timestamp captured.
const SEED_RE = /^([\d.-]+):\s+\[Trade\]\s+Tradeable\s+\((.+?)\)\s+(sold by|purchased by)\s+(.+?)\((\d+)\)\s+for\s+(\d+)\s+.*?\b(to|from)\s+trader\s+([^,]+)/;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    if (fs.existsSync(STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (parsed && Array.isArray(parsed.recent)) recent = parsed.recent.slice(0, MAX);
    }
  } catch (err) {
    logger.warn(`[EconomyTrades] failed to load state: ${err.message}`);
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify({ recent, lastUpdate: new Date().toISOString() }));
    } catch (err) {
      logger.warn(`[EconomyTrades] failed to save state: ${err.message}`);
    }
  }, 3000);
  if (saveTimer.unref) saveTimer.unref();
}

// "Weapon_M16 (health: 80, uses: 17)" → "M16"
function cleanItem(raw) {
  return String(raw)
    .replace(/\s*\(.*$/, '')      // drop the "(health: …)" descriptor
    .replace(/^Weapon_/, '')
    .replace(/_/g, ' ')
    .trim() || String(raw);
}

// Same line, but keep the asset code (scum_items.json id) for image lookup.
function itemCode(raw) {
  return String(raw).replace(/\s*\(.*$/, '').trim();
}

// SCUM log timestamp "2026.06.19-16.11.06" → epoch ms (treated as UTC).
function tsToMs(s) {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})$/.exec(String(s));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : Date.now();
}

function add(ts, item, player, price, isSell, trader, defer) {
  const t = parseTraderName(trader);
  const code = itemCode(item);
  recent.unshift({
    // Prefer the proper scum_items.json name; fall back to a cleaned asset code.
    ts, item: getItemDisplayName(code) || cleanItem(item), code, player, price: Number(price) || 0,
    action: isSell ? 'sell' : 'buy', traderLoc: t.location, traderType: t.type,
  });
  if (recent.length > MAX) recent.length = MAX;
  if (!defer) scheduleSave();
}

/** Record a live trade event from economyFeed.handle (type 'sell' | 'buy'). */
function recordTrade(ev) {
  if (!ev || (ev.type !== 'sell' && ev.type !== 'buy')) return;
  load();
  add(ev.timestamp ? tsToMs(ev.timestamp) : Date.now(), ev.item, ev.playerName, ev.amount, ev.type === 'sell', ev.trader);
}

/** Seed once from the newest economy log, merging any trades not already persisted
 *  (so the first run gets history and a restart picks up trades from the downtime). */
function seedFromLog() {
  load();
  if (seeded) return;
  seeded = true;
  try {
    const dir = path.join(paths.savedDir, 'SaveFiles', 'Logs');
    const files = fs.readdirSync(dir)
      .filter((f) => /^economy_.*\.log$/i.test(f))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).ctimeMs }))
      .sort((a, b) => b.t - a.t);
    if (!files.length) return;
    const txt = fs.readFileSync(path.join(dir, files[0].f), 'utf16le').replace(/^﻿/, '');
    const hits = txt.split(/\r?\n/).map((l) => SEED_RE.exec(l)).filter(Boolean);
    const seen = new Set(recent.map((r) => `${r.ts}|${r.code}|${r.player}|${r.price}`));
    let added = 0;
    for (const m of hits.slice(-MAX)) {
      const ts = tsToMs(m[1]);
      const key = `${ts}|${itemCode(m[2])}|${m[4]}|${Number(m[6]) || 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      add(ts, m[2], m[4], m[6], m[3] === 'sold by', m[8], true);
      added += 1;
    }
    if (added) {
      recent.sort((a, b) => b.ts - a.ts);
      if (recent.length > MAX) recent.length = MAX;
      scheduleSave();
      logger.info(`[EconomyTrades] Seeded ${added} trade(s) from log (merged with ${recent.length - added} stored)`);
    }
  } catch (err) {
    logger.warn(`[EconomyTrades] seed failed: ${err.message}`);
  }
}

function getRecentTrades(n = 30) {
  load();
  return recent.slice(0, n).map((r) => ({
    ts: r.ts, item: r.item, code: r.code, player: r.player, price: r.price, action: r.action,
    trader: r.traderType + (r.traderLoc ? ` (${r.traderLoc})` : ''),
  }));
}

/** Aggregates over the rolling buffer: total volume, hot items, busiest trader. */
function getMarketStats() {
  load();
  const items = {};
  const traders = {};
  let volume = 0;
  for (const r of recent) {
    volume += r.price;
    if (!items[r.item]) items[r.item] = { item: r.item, count: 0, value: 0 };
    items[r.item].count += 1;
    items[r.item].value += r.price;
    const tk = r.traderType + (r.traderLoc ? ` (${r.traderLoc})` : '');
    traders[tk] = (traders[tk] || 0) + r.price;
  }
  const topItems = Object.values(items).sort((a, b) => b.value - a.value).slice(0, 8);
  const top = Object.entries(traders).sort((a, b) => b[1] - a[1])[0];
  return { volume, count: recent.length, topItems, busiestTrader: top ? { name: top[0], value: top[1] } : null };
}

module.exports = { recordTrade, seedFromLog, getRecentTrades, getMarketStats };
