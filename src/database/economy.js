'use strict';

const fs = require('fs');
const path = require('path');
const { getScumDb } = require('./db');
const { memo } = require('./cache');
const { paths } = require('../core/config');

/** Turn a tradeable asset path into a readable item name. */
function cleanAssetName(asset) {
  if (!asset) return 'Unknown';
  // ".../Foo_Bar_01.Foo_Bar_01_C" -> last path segment, drop the ".Class" suffix.
  let name = String(asset).split('/').pop() || String(asset);
  name = name.split('.')[0];
  return name.replace(/_C$/, '').replace(/_ES$/, '').replace(/_/g, ' ').trim() || 'Unknown';
}

/**
 * Turn a vendor blueprint path (e.g.
 * ".../BP_General_Goods_01.BP_General_Goods_01_C") into a readable trader name
 * ("General Goods"). Strips the BP_ prefix and trailing index.
 */
function cleanTraderName(raw) {
  if (!raw) return 'Trader';
  const n = cleanAssetName(raw).replace(/^BP\s+/i, '').replace(/\s+\d+$/, '').trim();
  return n || 'Trader';
}

/**
 * Current special deals ("on sale" items). Empty when no rotation deals are active.
 * Cached briefly — deals only change on the economy rotation timer.
 */
function getSpecialDeals(limit = 12) {
  const db = getScumDb();
  if (!db) return [];
  return memo(`econ:specialDeals:${limit}`, 30000, () => {
    try {
      const rows = db.prepare(`
        SELECT tradeable_asset, base_purchase_price, amount_in_store,
               required_fame_points, can_be_purchased_by_player, sector, trader
        FROM economy_special_deals
        WHERE can_be_purchased_by_player = 1 AND amount_in_store > 0
        ORDER BY base_purchase_price ASC
        LIMIT ?
      `).all(limit);
      return rows.map((r) => ({
        item: cleanAssetName(r.tradeable_asset),
        price: r.base_purchase_price || 0,
        stock: r.amount_in_store || 0,
        fameRequired: r.required_fame_points || 0,
        sector: r.sector || '',
        trader: cleanTraderName(r.trader),
      }));
    } catch {
      return [];
    }
  });
}

/** Aggregate gold buying/selling capacity across all outposts. */
function getGoldCapacity() {
  const db = getScumDb();
  if (!db) return null;
  return memo('econ:goldCapacity', 30000, () => {
    try {
      const row = db.prepare(`
        SELECT COALESCE(SUM(gold_buying_capability_funds), 0)  AS buyFunds,
               COALESCE(SUM(gold_selling_capability_funds), 0) AS sellFunds,
               COUNT(*) AS outposts
        FROM economy_outpost_gold
      `).get();
      return row ? { buyFunds: row.buyFunds, sellFunds: row.sellFunds, outposts: row.outposts } : null;
    } catch {
      return null;
    }
  });
}

function readEconomyOverride() {
  return memo('econ:override', 300000, () => {
    try {
      const file = path.join(paths.savedDir, 'Config', 'WindowsServer', 'EconomyOverride.json');
      if (!fs.existsSync(file)) return null;
      const buf = fs.readFileSync(file);
      const isUtf16 = buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE;
      const text = buf.toString(isUtf16 ? 'utf16le' : 'utf8').replace(/^﻿/, '');
      const json = JSON.parse(text);
      return json['economy-override'] || json.economyOverride || null;
    } catch {
      return null;
    }
  });
}

/**
 * Economy rotation / restock info: how long since the last economy reset (from the
 * DB) plus the configured rotation and restock windows (from EconomyOverride.json).
 */
function getEconomyTiming() {
  const db = getScumDb();
  const ov = readEconomyOverride() || {};
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

  let secondsSinceReset = null;
  if (db) {
    secondsSinceReset = memo('econ:sinceReset', 30000, () => {
      try {
        const row = db.prepare('SELECT time_since_last_economy_reset AS s FROM economy LIMIT 1').get();
        return row ? row.s : null;
      } catch {
        return null;
      }
    });
  }

  return {
    secondsSinceReset,
    resetTimeHours: num(ov['economy-reset-time-hours']),
    rotationHoursMin: num(ov['tradeable-rotation-time-ingame-hours-min']),
    rotationHoursMax: num(ov['tradeable-rotation-time-ingame-hours-max']),
    fullRestockHours: num(ov['fully-restock-tradeable-hours']),
    rotationEnabled: ov['tradeable-rotation-enabled'] === '1' || ov['tradeable-rotation-enabled'] === 1,
  };
}

module.exports = { getSpecialDeals, getGoldCapacity, getEconomyTiming, cleanAssetName, cleanTraderName };
