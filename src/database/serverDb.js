'use strict';

const path = require('path');
const { randomBytes } = require('crypto');
const fsExtra = require('fs-extra');
const Database = require('better-sqlite3');
const logger = require('../core/logger');
const { paths } = require('../core/config');

const SERVER_DB_PATH = path.join(paths.root, 'data', 'server_database.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS a_user_profile (
  user_id TEXT PRIMARY KEY,
  steam_id TEXT,
  user_name TEXT,
  user_ip TEXT,
  flag_id TEXT,
  last_login_time TEXT,
  last_logout_time TEXT,
  user_is_online INTEGER DEFAULT 0,
  last_update DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS a_raid_protection (
  flag_id TEXT PRIMARY KEY,
  owner_user_id TEXT,
  location_x TEXT,
  location_y TEXT,
  location_z TEXT,
  protection_type TEXT,
  protection_duration INTEGER,
  start_delay INTEGER,
  last_logged_in_user_id TEXT,
  reason TEXT,
  last_update DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS a_pending_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_user_id TEXT NOT NULL,
  discord_username TEXT NOT NULL,
  registration_code TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS a_discord_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_user_id TEXT NOT NULL UNIQUE,
  discord_username TEXT NOT NULL,
  steam_id TEXT NOT NULL UNIQUE,
  player_name TEXT,
  linked_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS a_notification_prefs (
  discord_user_id TEXT PRIMARY KEY,
  notify_raid INTEGER DEFAULT 0,
  notify_vehicle INTEGER DEFAULT 0,
  notify_chest INTEGER DEFAULT 0,
  notify_lock INTEGER DEFAULT 0,
  scope TEXT DEFAULT 'own',
  last_update DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

let serverDb = null;

/**
 * Returns the (read-write) connection to our own server database, creating
 * the schema on first use. Mirrors the a_user_profile / a_raid_protection
 * tables maintained by login-log.psm1 / raidprotection-log.psm1.
 */
function getServerDb() {
  if (serverDb) return serverDb;

  fsExtra.ensureDirSync(path.dirname(SERVER_DB_PATH));
  serverDb = new Database(SERVER_DB_PATH);
  serverDb.exec(SCHEMA);
  // Migration: add notify_lock to an a_notification_prefs table created before it existed.
  try { serverDb.exec('ALTER TABLE a_notification_prefs ADD COLUMN notify_lock INTEGER DEFAULT 0'); } catch { /* already present */ }
  logger.info(`[Database] Opened server database: ${SERVER_DB_PATH}`);
  return serverDb;
}

/**
 * Record a player login. Mirrors the UPDATE-then-INSERT-if-no-rows pattern
 * from Update-UserProfileLogin.
 */
function upsertLoginEvent(userId, { steamId, userName, userIp, loginTime }) {
  const db = getServerDb();
  const update = db.prepare(`
    UPDATE a_user_profile
    SET steam_id = ?, user_name = ?, user_ip = ?, last_login_time = ?,
        user_is_online = 1, last_update = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).run(steamId, userName, userIp, loginTime, userId);

  if (update.changes === 0) {
    db.prepare(`
      INSERT INTO a_user_profile
        (user_id, steam_id, user_name, user_ip, flag_id, last_login_time, last_logout_time, user_is_online, last_update)
      VALUES (?, ?, ?, ?, NULL, ?, NULL, 1, CURRENT_TIMESTAMP)
    `).run(userId, steamId, userName, userIp, loginTime);
  }
}

/**
 * Record a player logout. Mirrors Update-UserProfileLogout.
 */
function upsertLogoutEvent(userId, { steamId, userName, userIp, logoutTime }) {
  const db = getServerDb();
  const update = db.prepare(`
    UPDATE a_user_profile
    SET steam_id = ?, user_name = ?, user_ip = ?, last_logout_time = ?,
        user_is_online = 0, last_update = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).run(steamId, userName, userIp, logoutTime, userId);

  if (update.changes === 0) {
    db.prepare(`
      INSERT INTO a_user_profile
        (user_id, steam_id, user_name, user_ip, flag_id, last_login_time, last_logout_time, user_is_online, last_update)
      VALUES (?, ?, ?, ?, NULL, NULL, ?, 0, CURRENT_TIMESTAMP)
    `).run(userId, steamId, userName, userIp, logoutTime);
  }
}

/**
 * Upsert a raid protection flag record. Mirrors Update-RaidProtectionRecord.
 */
function upsertRaidProtection(flagId, {
  ownerUserId = null, x = null, y = null, z = null, type, duration = null,
  startDelay = null, lastLoggedInUserId = null, reason = null, lastUpdate,
}) {
  const db = getServerDb();
  const update = db.prepare(`
    UPDATE a_raid_protection
    SET owner_user_id = ?, location_x = ?, location_y = ?, location_z = ?,
        protection_type = ?, protection_duration = ?, start_delay = ?,
        last_logged_in_user_id = ?, reason = ?, last_update = ?
    WHERE flag_id = ?
  `).run(ownerUserId, x, y, z, type, duration, startDelay, lastLoggedInUserId, reason, lastUpdate, flagId);

  if (update.changes === 0) {
    db.prepare(`
      INSERT INTO a_raid_protection
        (flag_id, owner_user_id, location_x, location_y, location_z, protection_type,
         protection_duration, start_delay, last_logged_in_user_id, reason, last_update)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(flagId, ownerUserId, x, y, z, type, duration, startDelay, lastLoggedInUserId, reason, lastUpdate);
  }
}

/**
 * Read the currently stored raid protection record for a flag, or null.
 * Used to detect whether protection was active before an "ended" event.
 */
function getRaidProtection(flagId) {
  if (flagId == null) return null;
  const db = getServerDb();
  return db.prepare('SELECT * FROM a_raid_protection WHERE flag_id = ?').get(String(flagId)) || null;
}

/**
 * Associate a flag id with a user's profile. Mirrors Update-UserProfileFlagId,
 * called when a ProtectionEnded event identifies the logged-in owner.
 */
/**
 * Look up a player's login profile by name from server_database.db.
 * Returns null if the DB is empty or the player hasn't logged in yet.
 * Mirrors Get-PlayerByName from prisoner.psm1 but against a_user_profile.
 */
function getPlayerProfileByName(name) {
  try {
    const db = getServerDb();
    return db.prepare(
      `SELECT user_id, steam_id, user_name, user_ip, flag_id,
              last_login_time, last_logout_time, user_is_online
       FROM a_user_profile WHERE LOWER(user_name) = LOWER(?) LIMIT 1`
    ).get(name) || null;
  } catch {
    return null;
  }
}

function updateUserProfileFlagId(userId, flagId) {
  const db = getServerDb();
  db.prepare(`
    UPDATE a_user_profile SET flag_id = ?, last_update = CURRENT_TIMESTAMP WHERE user_id = ?
  `).run(flagId, userId);
}

// ===========================================================================
// Account linking
// ===========================================================================

function generateCode() {
  return randomBytes(3).toString('hex').toUpperCase();
}

/**
 * Create (or refresh) a pending registration for a Discord user.
 * Returns { code, expiresAt }.
 */
function createPendingRegistration(discordUserId, discordUsername) {
  const db = getServerDb();
  db.prepare(`DELETE FROM a_pending_registrations WHERE discord_user_id = ?`).run(discordUserId);
  const code = generateCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO a_pending_registrations (discord_user_id, discord_username, registration_code, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(discordUserId, discordUsername, code, expiresAt);
  return { code, expiresAt };
}

/**
 * Get a user's active (non-expired, unused) pending registration.
 */
function getPendingRegistrationByUserId(discordUserId) {
  const db = getServerDb();
  return db.prepare(`
    SELECT * FROM a_pending_registrations
    WHERE discord_user_id = ? AND used = 0 AND expires_at > datetime('now')
  `).get(discordUserId) || null;
}

/**
 * Process a connect:CODE command from in-game chat. Validates the code,
 * creates the Discord profile link, and returns the result.
 * Returns { success, discordUserId, discordUsername } on success,
 * or { success: false, reason } on failure.
 */
function completeLinking(registrationCode, steamId, playerName) {
  const db = getServerDb();

  const pending = db.prepare(`
    SELECT * FROM a_pending_registrations
    WHERE registration_code = ? AND used = 0 AND expires_at > datetime('now')
  `).get(registrationCode);

  if (!pending) return { success: false, reason: 'invalid_code' };

  const existingSteam = db.prepare(`SELECT * FROM a_discord_profiles WHERE steam_id = ?`).get(steamId);
  if (existingSteam && existingSteam.discord_user_id !== pending.discord_user_id) {
    return { success: false, reason: 'steam_already_linked' };
  }

  db.prepare(`DELETE FROM a_discord_profiles WHERE discord_user_id = ?`).run(pending.discord_user_id);
  db.prepare(`DELETE FROM a_pending_registrations WHERE registration_code = ?`).run(registrationCode);
  db.prepare(`
    INSERT INTO a_discord_profiles (discord_user_id, discord_username, steam_id, player_name)
    VALUES (?, ?, ?, ?)
  `).run(pending.discord_user_id, pending.discord_username, steamId, playerName);

  return { success: true, discordUserId: pending.discord_user_id, discordUsername: pending.discord_username };
}

function getDiscordProfile(discordUserId) {
  const db = getServerDb();
  return db.prepare(`SELECT * FROM a_discord_profiles WHERE discord_user_id = ?`).get(discordUserId) || null;
}

function getDiscordProfileBySteamId(steamId) {
  const db = getServerDb();
  return db.prepare(`SELECT * FROM a_discord_profiles WHERE steam_id = ?`).get(steamId) || null;
}

/**
 * Removes the link for a Discord user. Returns the old profile row, or null.
 */
function unlinkAccount(discordUserId) {
  const db = getServerDb();
  const profile = getDiscordProfile(discordUserId);
  if (!profile) return null;
  db.prepare(`DELETE FROM a_discord_profiles WHERE discord_user_id = ?`).run(discordUserId);
  db.prepare(`DELETE FROM a_pending_registrations WHERE discord_user_id = ?`).run(discordUserId);
  return profile;
}

// ===========================================================================
// Per-player raid notification preferences
// ===========================================================================

function getNotifyPrefs(discordUserId) {
  const db = getServerDb();
  const row = db.prepare('SELECT * FROM a_notification_prefs WHERE discord_user_id = ?').get(discordUserId);
  return {
    raid: row ? row.notify_raid === 1 : false,
    vehicle: row ? row.notify_vehicle === 1 : false,
    chest: row ? row.notify_chest === 1 : false,
    lock: row ? row.notify_lock === 1 : false,
    scope: row && row.scope === 'squad' ? 'squad' : 'own',
  };
}

function setNotifyPrefs(discordUserId, { raid, vehicle, chest, lock, scope }) {
  const db = getServerDb();
  db.prepare(`
    INSERT INTO a_notification_prefs (discord_user_id, notify_raid, notify_vehicle, notify_chest, notify_lock, scope, last_update)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(discord_user_id) DO UPDATE SET
      notify_raid = excluded.notify_raid,
      notify_vehicle = excluded.notify_vehicle,
      notify_chest = excluded.notify_chest,
      notify_lock = excluded.notify_lock,
      scope = excluded.scope,
      last_update = CURRENT_TIMESTAMP
  `).run(discordUserId, raid ? 1 : 0, vehicle ? 1 : 0, chest ? 1 : 0, lock ? 1 : 0, scope === 'squad' ? 'squad' : 'own');
}

/**
 * Linked Discord users who want notifications of a given type ('raid'|'vehicle'|'chest'|'lock').
 * Returns [{ discordUserId, steamId, playerName, scope }].
 */
function getNotifyRecipients(type) {
  const col = {
    raid: 'notify_raid', vehicle: 'notify_vehicle', chest: 'notify_chest', lock: 'notify_lock',
  }[type];
  if (!col) return [];
  const db = getServerDb();
  return db.prepare(`
    SELECT p.discord_user_id AS discordUserId, dp.steam_id AS steamId,
           dp.player_name AS playerName, p.scope AS scope
    FROM a_notification_prefs p
    JOIN a_discord_profiles dp ON dp.discord_user_id = p.discord_user_id
    WHERE p.${col} = 1
  `).all();
}

/** Resolve a player's Steam ID from a flag owner's user id / flag id (best effort). */
function getSteamIdByUserId(userId) {
  if (userId == null) return null;
  const db = getServerDb();
  const row = db.prepare('SELECT steam_id FROM a_user_profile WHERE user_id = ?').get(String(userId));
  return row ? row.steam_id : null;
}

function getSteamIdByFlagId(flagId) {
  if (flagId == null) return null;
  const db = getServerDb();
  const row = db.prepare('SELECT steam_id FROM a_user_profile WHERE flag_id = ? LIMIT 1').get(String(flagId));
  return row ? row.steam_id : null;
}

function closeAll() {
  if (serverDb) {
    try { serverDb.close(); } catch { /* ignore */ }
    serverDb = null;
  }
}

module.exports = {
  getServerDb,
  upsertLoginEvent,
  upsertLogoutEvent,
  upsertRaidProtection,
  getRaidProtection,
  updateUserProfileFlagId,
  getPlayerProfileByName,
  createPendingRegistration,
  getPendingRegistrationByUserId,
  completeLinking,
  getDiscordProfile,
  getDiscordProfileBySteamId,
  unlinkAccount,
  getNotifyPrefs,
  setNotifyPrefs,
  getNotifyRecipients,
  getSteamIdByUserId,
  getSteamIdByFlagId,
  closeAll,
  SERVER_DB_PATH,
};
