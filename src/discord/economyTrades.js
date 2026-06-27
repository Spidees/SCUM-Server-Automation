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

const MAX = 60; // rolling buffer size
let recent = []; // newest first: { ts, item, player, price, action, traderLoc, traderType }
let seeded = false;

// Same trade line the economy feed parses, with the leading timestamp captured.
const SEED_RE = /^([\d.-]+):\s+\[Trade\]\s+Tradeable\s+\((.+?)\)\s+(sold by|purchased by)\s+(.+?)\((\d+)\)\s+for\s+(\d+)\s+.*?\b(to|from)\s+trader\s+([^,]+)/;

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

function add(ts, item, player, price, isSell, trader) {
  const t = parseTraderName(trader);
  const code = itemCode(item);
  recent.unshift({
    // Prefer the proper scum_items.json name; fall back to a cleaned asset code.
    ts, item: getItemDisplayName(code) || cleanItem(item), code, player, price: Number(price) || 0,
    action: isSell ? 'sell' : 'buy', traderLoc: t.location, traderType: t.type,
  });
  if (recent.length > MAX) recent.length = MAX;
}

/** Record a live trade event from economyFeed.handle (type 'sell' | 'buy'). */
function recordTrade(ev) {
  if (!ev || (ev.type !== 'sell' && ev.type !== 'buy')) return;
  add(ev.timestamp ? tsToMs(ev.timestamp) : Date.now(), ev.item, ev.playerName, ev.amount, ev.type === 'sell', ev.trader);
}

/** Seed the buffer from the newest economy log once, so the page isn't blank at start. */
function seedFromLog() {
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
    for (const m of hits.slice(-MAX)) add(tsToMs(m[1]), m[2], m[4], m[6], m[3] === 'sold by', m[8]);
    if (hits.length) logger.info(`[EconomyTrades] Seeded ${Math.min(hits.length, MAX)} recent trade(s) from log`);
  } catch (err) {
    logger.warn(`[EconomyTrades] seed failed: ${err.message}`);
  }
}

function getRecentTrades(n = 15) {
  return recent.slice(0, n).map((r) => ({
    ts: r.ts, item: r.item, code: r.code, player: r.player, price: r.price, action: r.action,
    trader: r.traderType + (r.traderLoc ? ` (${r.traderLoc})` : ''),
  }));
}

/** Aggregates over the rolling buffer: total volume, hot items, busiest trader. */
function getMarketStats() {
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
  const topItems = Object.values(items).sort((a, b) => b.value - a.value).slice(0, 6);
  const top = Object.entries(traders).sort((a, b) => b[1] - a[1])[0];
  return { volume, count: recent.length, topItems, busiestTrader: top ? { name: top[0], value: top[1] } : null };
}

module.exports = { recordTrade, seedFromLog, getRecentTrades, getMarketStats };
