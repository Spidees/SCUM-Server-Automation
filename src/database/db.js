'use strict';

const fs = require('fs');
const path = require('path');
const fsExtra = require('fs-extra');
const Database = require('better-sqlite3');
const logger = require('../core/logger');
const { paths } = require('../core/config');
const cache = require('./cache');

const WEEKLY_DB_PATH = path.join(paths.root, 'data', 'weekly_leaderboards.db');

const WEEKLY_SCHEMA = `
CREATE TABLE IF NOT EXISTS weekly_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_profile_id INTEGER NOT NULL,
    week_start_date TEXT NOT NULL,
    locks_picked INTEGER DEFAULT 0,
    puppets_killed INTEGER DEFAULT 0,
    headshots INTEGER DEFAULT 0,
    drone_kills INTEGER DEFAULT 0,
    sentry_kills INTEGER DEFAULT 0,
    animals_killed INTEGER DEFAULT 0,
    longest_kill_distance REAL DEFAULT 0.0,
    melee_kills INTEGER DEFAULT 0,
    archery_kills INTEGER DEFAULT 0,
    minutes_survived REAL DEFAULT 0.0,
    wounds_patched INTEGER DEFAULT 0,
    guns_crafted INTEGER DEFAULT 0,
    bullets_crafted INTEGER DEFAULT 0,
    arrows_crafted INTEGER DEFAULT 0,
    clothing_crafted INTEGER DEFAULT 0,
    containers_looted INTEGER DEFAULT 0,
    distance_travelled_by_foot REAL DEFAULT 0.0,
    fame_points REAL DEFAULT 0.0,
    fish_caught INTEGER DEFAULT 0,
    events_won INTEGER DEFAULT 0,
    money_balance INTEGER DEFAULT 0,
    play_time INTEGER DEFAULT 0,
    enemy_kills INTEGER DEFAULT 0,
    deaths INTEGER DEFAULT 0,
    team_kills INTEGER DEFAULT 0,
    melee_weapons_crafted INTEGER DEFAULT 0,
    squad_name TEXT,
    squad_score INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_profile_id, week_start_date)
);

CREATE INDEX IF NOT EXISTS idx_weekly_snapshots_user_week ON weekly_snapshots(user_profile_id, week_start_date);
CREATE INDEX IF NOT EXISTS idx_weekly_snapshots_week ON weekly_snapshots(week_start_date);

CREATE TABLE IF NOT EXISTS current_week_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_start_date TEXT UNIQUE NOT NULL,
    week_end_date TEXT NOT NULL,
    created_date TEXT NOT NULL
);
`;

let scumDb = null;
let scumDbPath = null;
let weeklyDb = null;
let markedDeletionChecked = false;
let markedDeletionExists = false;

/**
 * Mirrors Initialize-DatabaseModule's auto-detection: serverDir/SCUM/Saved/SaveFiles/SCUM.db
 */
function getScumDbPath() {
  return path.join(paths.serverDir, 'SCUM', 'Saved', 'SaveFiles', 'SCUM.db');
}

function isScumDbAvailable() {
  return fs.existsSync(getScumDbPath());
}

/**
 * Returns a read-only better-sqlite3 connection to SCUM.db, or null if it doesn't exist yet.
 * Re-opens automatically if the configured path changes (shouldn't normally happen at runtime).
 */
function getScumDb() {
  const dbPath = getScumDbPath();
  if (!fs.existsSync(dbPath)) return null;

  if (scumDb && scumDbPath === dbPath) return scumDb;

  if (scumDb) {
    try { scumDb.close(); } catch { /* already closed */ }
    scumDb = null;
  }

  // New connection (possibly a different save file) — drop every memoized read and
  // the SQL-transform cache so nothing stale from the previous DB survives.
  markedDeletionChecked = false;
  transformCache.clear();
  cache.clear();
  scumDb = new Database(dbPath, { readonly: true, fileMustExist: true });
  scumDbPath = dbPath;
  logger.info(`[Database] Opened SCUM database (read-only): ${dbPath}`);
  return scumDb;
}

/**
 * Whether SCUM.db has the user_profiles_marked_for_deletion table (dead
 * characters pending deletion). Cached per connection.
 */
function hasMarkedForDeletionTable() {
  const db = getScumDb();
  if (!db) return false;
  if (markedDeletionChecked) return markedDeletionExists;
  try {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='user_profiles_marked_for_deletion'",
    ).get();
    markedDeletionExists = !!row;
  } catch {
    markedDeletionExists = false;
  }
  markedDeletionChecked = true;
  return markedDeletionExists;
}

// Admin Steam IDs from AdminUsers.ini, cached briefly. Handles UTF-8 / UTF-16 and
// the "76561199509851252[godmode]" suffix form by just extracting 17-digit IDs.
let adminCache = { ts: 0, ids: [] };

function getAdminSteamIds() {
  if (Date.now() - adminCache.ts < 60000) return adminCache.ids;
  const ids = [];
  try {
    const file = path.join(paths.savedDir, 'Config', 'WindowsServer', 'AdminUsers.ini');
    if (fs.existsSync(file)) {
      // latin1 + strip NULs makes the digit IDs readable regardless of encoding.
      const text = fs.readFileSync(file).toString('latin1').replace(/\0/g, '');
      const re = /\b(\d{17})\b/g;
      let m;
      while ((m = re.exec(text)) !== null) ids.push(m[1]);
    }
  } catch { /* no admin file / unreadable — treat as no admins */ }
  adminCache = { ts: Date.now(), ids: [...new Set(ids)] };
  return adminCache.ids;
}

/** Build the `FROM (...)` replacement applying the requested user_profile filters. */
function buildUserProfileFrom(excludeAdmins) {
  const conds = [];
  if (hasMarkedForDeletionTable()) {
    conds.push('id NOT IN (SELECT user_profile_id FROM user_profiles_marked_for_deletion WHERE user_profile_id IS NOT NULL)');
  }
  if (excludeAdmins) {
    const admins = getAdminSteamIds();
    if (admins.length) conds.push(`user_id NOT IN (${admins.map((id) => `'${id}'`).join(',')})`);
  }
  if (!conds.length) return null;
  return `FROM (SELECT * FROM user_profile WHERE ${conds.join(' AND ')})`;
}

// The `FROM user_profile` rewrite is the same for every call until the marked-for-
// deletion table or the admin list changes, but it ran a regex replace + subquery
// rebuild on every query. Memoize the transformed SQL, keyed by the input string,
// and revalidate against a cheap signature so a changed admin list still takes effect.
const transformCache = new Map(); // cacheKey -> { sig, out }

function transformSignature(excludeAdmins) {
  const marked = hasMarkedForDeletionTable() ? '1' : '0';
  if (!excludeAdmins) return `m${marked}`;
  return `m${marked}|a${getAdminSteamIds().join(',')}`;
}

function transformUserProfileFrom(sql, excludeAdmins) {
  const sig = transformSignature(excludeAdmins);
  const cacheKey = (excludeAdmins ? 'A:' : 'D:') + sql;
  const hit = transformCache.get(cacheKey);
  if (hit && hit.sig === sig) return hit.out;
  const from = buildUserProfileFrom(excludeAdmins);
  const out = from ? sql.replace(/FROM user_profile\b/g, from) : sql;
  transformCache.set(cacheKey, { sig, out });
  return out;
}

/**
 * Rewrite a query so every `FROM user_profile` excludes profiles marked for
 * deletion (dead characters). Stats/leaderboards then only count the player's
 * current, living character. No-op when there's nothing to filter.
 */
function excludeDeletedProfiles(sql) {
  return transformUserProfileFrom(sql, false);
}

/**
 * Like excludeDeletedProfiles but ALSO excludes admins (AdminUsers.ini) — used for
 * leaderboards so server staff don't appear in the rankings. (Individual stat
 * lookups still use excludeDeletedProfiles so admins can view their own stats.)
 */
function excludeDeletedAndAdmins(sql) {
  return transformUserProfileFrom(sql, true);
}

/**
 * Returns the (read-write) connection to our own weekly leaderboards database,
 * creating the schema on first use. Mirrors the table layout created in
 * Update-WeeklySnapshot.
 */
function getWeeklyDb() {
  if (weeklyDb) return weeklyDb;

  fsExtra.ensureDirSync(path.dirname(WEEKLY_DB_PATH));
  weeklyDb = new Database(WEEKLY_DB_PATH);
  weeklyDb.exec(WEEKLY_SCHEMA);
  return weeklyDb;
}

function closeAll() {
  transformCache.clear();
  cache.clear();
  if (scumDb) {
    try { scumDb.close(); } catch { /* ignore */ }
    scumDb = null;
    scumDbPath = null;
  }
  if (weeklyDb) {
    try { weeklyDb.close(); } catch { /* ignore */ }
    weeklyDb = null;
  }
}

module.exports = {
  getScumDb,
  getWeeklyDb,
  getScumDbPath,
  isScumDbAvailable,
  excludeDeletedProfiles,
  excludeDeletedAndAdmins,
  hasMarkedForDeletionTable,
  closeAll,
  WEEKLY_DB_PATH,
};
