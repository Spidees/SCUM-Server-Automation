'use strict';

const logger = require('../core/logger');
const { getScumDb, getWeeklyDb, excludeDeletedAndAdmins } = require('./db');
const { memo } = require('./cache');
const { CATEGORIES, CATEGORIES_BY_KEY } = require('./leaderboardDefs');
const { getCurrentWeekStart, toDateStr } = require('./weekly');

// Each leaderboard category is a full scan + sort over user_profile and its stat
// tables. The live embeds rebuild every category twice (weekly + all-time) on each
// refresh, and the web API computes all 30 categories per request. Caching the
// computed rows for a short window (< the embed refresh cadence) keeps the output
// identical while collapsing bursts of identical queries into one.
const LEADERBOARD_TTL_MS = 60000;

/**
 * Run the all-time leaderboard query for a category.
 * Mirrors the Get-Top* functions (all-time branch).
 */
function getAllTimeLeaderboard(category, limit) {
  return memo(`lb:all:${category.key}:${limit}`, LEADERBOARD_TTL_MS,
    () => computeAllTimeLeaderboard(category, limit));
}

function computeAllTimeLeaderboard(category, limit) {
  const db = getScumDb();
  if (!db) return [];

  try {
    const rows = db.prepare(excludeDeletedAndAdmins(category.allTime.sql)).all({ limit });
    return rows.map((row) => ({
      Name: row.Name,
      Value: category.allTime.value(row.Score),
      FormattedValue: category.allTime.format(row.Score),
    }));
  } catch (err) {
    logger.warn(`[Leaderboards] ${category.key} (all-time) query failed: ${err.message}`);
    return [];
  }
}

/**
 * Compute the weekly delta leaderboard for a category.
 * Mirrors Get-WeeklyLeaderboard for each category's delta formula.
 */
function getWeeklyLeaderboard(category, limit) {
  if (!category.weekly) return [];
  return memo(`lb:week:${category.key}:${limit}`, LEADERBOARD_TTL_MS,
    () => computeWeeklyLeaderboard(category, limit));
}

function computeWeeklyLeaderboard(category, limit) {
  const w = category.weekly;
  if (!w) return [];

  const scumDb = getScumDb();
  if (!scumDb) return [];

  const weeklyDb = getWeeklyDb();
  const weekStartStr = toDateStr(getCurrentWeekStart());

  try {
    if (w.type === 'raw') {
      const rows = scumDb.prepare(excludeDeletedAndAdmins(w.currentSql)).all();
      return rows
        .filter((row) => row.Score > 0)
        .sort((a, b) => b.Score - a.Score)
        .slice(0, limit)
        .map((row) => ({
          Name: row.Name,
          Value: w.value(row.Score),
          FormattedValue: w.format(row.Score),
        }));
    }

    const snapshotRows = weeklyDb.prepare('SELECT * FROM weekly_snapshots WHERE week_start_date = ?').all(weekStartStr);
    const current = scumDb.prepare(excludeDeletedAndAdmins(w.currentSql)).all();

    let computed;

    if (w.type === 'squad') {
      const snapByName = new Map();
      for (const r of snapshotRows) {
        if (r.user_profile_id < 0 && r.squad_name) snapByName.set(r.squad_name, r);
      }
      computed = current.map((row) => {
        const snap = snapByName.get(row.Name);
        const snapVal = snap ? (snap[w.snapshotField] || 0) : 0;
        return { Name: row.Name, delta: row.Score - snapVal };
      }).filter((r) => r.delta > 0);
    } else {
      const snapById = new Map();
      for (const r of snapshotRows) {
        if (r.user_profile_id >= 0) snapById.set(r.user_profile_id, r);
      }

      if (w.type === 'kdr') {
        computed = current.map((row) => {
          const snap = snapById.get(row.Id);
          const killsSnap = snap ? (snap.enemy_kills || 0) : 0;
          const deathsSnap = snap ? (snap.deaths || 0) : 0;
          const killsDelta = row.Kills - killsSnap;
          const deathsDelta = row.Deaths - deathsSnap;
          const delta = deathsDelta > 0 ? killsDelta / deathsDelta : killsDelta;
          return { Name: row.Name, delta, _killsDelta: killsDelta };
        }).filter((r) => r._killsDelta > 0);
      } else if (w.type === 'max') {
        computed = current.map((row) => {
          const snap = snapById.get(row.Id);
          const snapVal = snap ? (snap[w.snapshotField] || 0) : 0;
          return { Name: row.Name, delta: row.Score, _current: row.Score, _snap: snapVal };
        }).filter((r) => r._current > r._snap);
      } else if (w.type === 'sum') {
        computed = current.map((row) => {
          const snap = snapById.get(row.Id);
          const snapVal = snap ? w.snapshotFields.reduce((sum, f) => sum + (snap[f] || 0), 0) : 0;
          return { Name: row.Name, delta: row.Score - snapVal };
        }).filter((r) => r.delta > 0);
      } else {
        // 'simple'
        computed = current.map((row) => {
          const snap = snapById.get(row.Id);
          const snapVal = snap ? (snap[w.snapshotField] || 0) : 0;
          return { Name: row.Name, delta: row.Score - snapVal };
        }).filter((r) => r.delta > 0);
      }
    }

    return computed
      .sort((a, b) => b.delta - a.delta)
      .slice(0, limit)
      .map((r) => ({
        Name: r.Name,
        Value: w.value(r.delta),
        FormattedValue: w.format(r.delta),
      }));
  } catch (err) {
    logger.warn(`[Leaderboards] ${category.key} (weekly) query failed: ${err.message}`);
    return [];
  }
}

/**
 * Get a leaderboard by category key. Returns [] if the category doesn't exist,
 * the database isn't available, or the query fails.
 */
function getLeaderboard(categoryKey, limit = 10, weeklyOnly = false) {
  const category = CATEGORIES_BY_KEY.get(categoryKey);
  if (!category) return [];

  return weeklyOnly ? getWeeklyLeaderboard(category, limit) : getAllTimeLeaderboard(category, limit);
}

/**
 * Get all leaderboards (all categories), all-time and/or weekly.
 */
function getAllLeaderboards(limit = 10, weeklyOnly = false) {
  const result = {};
  for (const category of CATEGORIES) {
    result[category.key] = {
      label: category.label,
      data: weeklyOnly ? getWeeklyLeaderboard(category, limit) : getAllTimeLeaderboard(category, limit),
    };
  }
  return result;
}

function listCategories() {
  return CATEGORIES.map((c) => ({ key: c.key, label: c.label, hasWeekly: !!c.weekly }));
}

module.exports = {
  getLeaderboard,
  getAllLeaderboards,
  listCategories,
};
