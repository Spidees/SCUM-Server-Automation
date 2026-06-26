'use strict';

// Public-facing leaderboard snapshot. The public dashboard must never touch
// SCUM.db per request — instead every category is computed once and cached in
// memory, then served to all viewers. The cache is refreshed lazily: a request
// recomputes it only when the cached copy is older than the TTL. This keeps the
// load on SCUM.db at most one full rebuild per TTL when there's traffic, and
// ZERO load while nobody is looking (no background polling).

const logger = require('../core/logger');
const { isScumDbAvailable } = require('./db');
const { getAllLeaderboards, listCategories } = require('./leaderboards');

// How many rows per category to keep in the snapshot. The public API slices this
// down to whatever page size it wants without recomputing.
const SNAPSHOT_LIMIT = 100;
const DEFAULT_INTERVAL_MS = 60000; // cache TTL

let snapshot = { generatedAt: null, available: false, categories: [], allTime: {}, weekly: {} };
let lastRefreshMs = 0;

/** Recompute the snapshot now and return it. Never throws. */
function refreshSnapshot() {
  lastRefreshMs = Date.now(); // set first so a failing rebuild won't hot-loop
  try {
    if (!isScumDbAvailable()) {
      snapshot = {
        generatedAt: new Date().toISOString(),
        available: false,
        categories: listCategories(),
        allTime: {},
        weekly: {},
      };
      return snapshot;
    }
    snapshot = {
      generatedAt: new Date().toISOString(),
      available: true,
      categories: listCategories(),
      allTime: getAllLeaderboards(SNAPSHOT_LIMIT, false),
      weekly: getAllLeaderboards(SNAPSHOT_LIMIT, true),
    };
  } catch (err) {
    logger.warn(`[LeaderboardSnapshot] refresh failed: ${err.message}`);
  }
  return snapshot;
}

/** Cached snapshot; rebuilt on access only when stale (older than the TTL). */
function getSnapshot() {
  if (!snapshot.generatedAt || Date.now() - lastRefreshMs > DEFAULT_INTERVAL_MS) refreshSnapshot();
  return snapshot;
}

/**
 * A player's rank in every leaderboard they appear in, derived entirely from the
 * in-memory snapshot (no SCUM.db query). Matched by display name. Only categories
 * where the player is within the snapshot's top rows are returned.
 */
function getPlayerRanks(name, weekly = false) {
  if (!name) return [];
  const snap = getSnapshot();
  const board = (weekly ? snap.weekly : snap.allTime) || {};
  const out = [];
  for (const [key, entry] of Object.entries(board)) {
    const data = entry.data || [];
    const idx = data.findIndex((r) => r.Name === name);
    if (idx >= 0) {
      out.push({ key, label: entry.label, rank: idx + 1, value: data[idx].FormattedValue });
    }
  }
  out.sort((a, b) => a.rank - b.rank);
  return out;
}

/** Warm the cache once at startup. Subsequent rebuilds happen lazily on access. */
function startSnapshotRefresh() {
  refreshSnapshot();
  logger.info('[LeaderboardSnapshot] Snapshot warmed (lazy refresh, TTL '
    + `${Math.round(DEFAULT_INTERVAL_MS / 1000)}s)`);
}

// No background timer to stop anymore; kept for API compatibility.
function stopSnapshotRefresh() { /* noop */ }

module.exports = {
  refreshSnapshot,
  getSnapshot,
  getPlayerRanks,
  startSnapshotRefresh,
  stopSnapshotRefresh,
  SNAPSHOT_LIMIT,
};
