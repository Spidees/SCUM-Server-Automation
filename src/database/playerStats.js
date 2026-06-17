'use strict';

const fs = require('fs');
const logger = require('../core/logger');
const { getScumDb, getScumDbPath, excludeDeletedProfiles } = require('./db');
const { round } = require('./leaderboardDefs');

/**
 * Try each SQL query in order, returning the result of the first one that
 * executes without error. Mirrors Invoke-DatabaseQuerySet's fallback-table pattern.
 * Profiles marked for deletion (dead characters) are excluded automatically.
 */
function tryQueries(db, queries, params = {}) {
  for (const sql of queries) {
    try {
      return db.prepare(excludeDeletedProfiles(sql)).all(params);
    } catch {
      // try next fallback
    }
  }
  return null;
}

function tryQueriesGet(db, queries, params = {}) {
  const rows = tryQueries(db, queries, params);
  return rows && rows.length > 0 ? rows[0] : null;
}

/**
 * Mirrors Get-OnlinePlayers.
 */
function getOnlinePlayers() {
  const db = getScumDb();
  if (!db) return [];

  const rows = tryQueries(db, [
    `SELECT name as PlayerName, user_id as SteamID, last_login_time, last_logout_time FROM user_profile WHERE last_login_time > last_logout_time OR last_logout_time IS NULL`,
    `SELECT * FROM Players WHERE IsOnline = 1`,
    `SELECT * FROM PlayerData WHERE Online = 1`,
  ]);

  return rows || [];
}

/**
 * Mirrors Get-TotalPlayerCount.
 */
function getTotalPlayerCount() {
  const db = getScumDb();
  if (!db) return 0;
  const row = tryQueriesGet(db, [`SELECT COUNT(*) as TotalCount FROM user_profile`]);
  return row ? row.TotalCount : 0;
}

/**
 * Mirrors Get-OnlinePlayerCount.
 */
function getOnlinePlayerCount() {
  const db = getScumDb();
  if (!db) return 0;
  const row = tryQueriesGet(db, [
    `SELECT COUNT(*) as OnlineCount FROM user_profile WHERE last_login_time > last_logout_time OR last_logout_time IS NULL`,
  ]);
  return row ? row.OnlineCount : 0;
}

/**
 * Mirrors Get-GameTimeData.
 */
function getGameTimeData() {
  const db = getScumDb();
  if (!db) return { Success: false, FormattedTime: 'N/A' };

  const row = tryQueriesGet(db, [`SELECT time_of_day FROM weather_parameters LIMIT 1`]);
  if (!row) return { Success: false, FormattedTime: 'N/A' };

  const timeOfDay = Number(row.time_of_day);
  const hours = Math.floor(timeOfDay) % 24;
  const minutes = Math.floor((timeOfDay - Math.floor(timeOfDay)) * 60);

  return {
    Success: true,
    TimeOfDay: timeOfDay,
    FormattedTime: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
  };
}

/**
 * Mirrors Get-WeatherData.
 */
function getWeatherData() {
  const db = getScumDb();
  if (!db) return { Success: false, FormattedTemperature: 'N/A' };

  const row = tryQueriesGet(db, [`SELECT base_air_temperature, water_temperature FROM weather_parameters LIMIT 1`]);
  if (!row) return { Success: false, FormattedTemperature: 'N/A' };

  const airTemp = round(Number(row.base_air_temperature), 1);
  const waterTemp = round(Number(row.water_temperature), 1);

  return {
    Success: true,
    AirTemperature: airTemp,
    WaterTemperature: waterTemp,
    FormattedTemperature: `A: ${airTemp} | W: ${waterTemp}`,
  };
}

/**
 * Mirrors Get-ActiveSquadCount / Get-ActiveSquadsCount.
 */
function getActiveSquadCount() {
  const db = getScumDb();
  if (!db) return 0;
  const row = tryQueriesGet(db, [
    `SELECT COUNT(DISTINCT squad_id) as total FROM squad_member WHERE squad_id IS NOT NULL AND squad_id != ''`,
  ]);
  return row ? row.total : 0;
}

/**
 * Mirrors Get-VehicleCount.
 */
function getVehicleCount() {
  const db = getScumDb();
  if (!db) return 0;
  const row = tryQueriesGet(db, [
    `SELECT COUNT(*) as VehicleCount FROM vehicle_entity`,
    `SELECT COUNT(*) as VehicleCount FROM Vehicles WHERE IsDestroyed = 0`,
  ]);
  return row ? row.VehicleCount : 0;
}

/**
 * Mirrors Get-BaseCount.
 */
function getBaseCount() {
  const db = getScumDb();
  if (!db) return 0;
  const row = tryQueriesGet(db, [
    `SELECT COUNT(*) as BaseCount FROM base`,
    `SELECT COUNT(DISTINCT OwnerID) as BaseCount FROM Buildings WHERE IsDestroyed = 0`,
  ]);
  return row ? row.BaseCount : 0;
}

/**
 * Mirrors Get-ServerStatistics.
 */
function getServerStatistics() {
  const dbPath = getScumDbPath();
  const stats = {
    Timestamp: new Date(),
    DatabaseSize: 0,
    TotalPlayers: 0,
    OnlinePlayers: 0,
    TotalVehicles: 0,
    LastUpdate: null,
  };

  if (fs.existsSync(dbPath)) {
    const st = fs.statSync(dbPath);
    stats.DatabaseSize = round(st.size / (1024 * 1024), 2);
    stats.LastUpdate = st.mtime;
  }

  stats.TotalPlayers = getTotalPlayerCount();
  stats.OnlinePlayers = getOnlinePlayerCount();
  stats.TotalVehicles = getVehicleCount();

  return stats;
}

/**
 * Look up a single player's game stats by exact or partial name.
 * Returns null if the DB is unavailable or no match found.
 * Mirrors Get-PlayerByName / Get-PlayerBySteamID from prisoner.psm1 combined
 * with the leaderboard JOIN patterns from leaderboardDefs.js.
 */
function getPlayerStatsByName(name) {
  const db = getScumDb();
  if (!db) return null;

  const sql = `
    SELECT
      u.name                                    AS Name,
      u.user_id                                 AS SteamID,
      COALESCE(u.fame_points, 0)                AS FamePoints,
      COALESCE(u.play_time, 0)                  AS PlayTime,
      u.last_logout_time                        AS LastLogout,
      CASE WHEN u.last_login_time > u.last_logout_time
                OR u.last_logout_time IS NULL
           THEN 1 ELSE 0 END                    AS IsOnline,
      COALESCE(e.enemy_kills, 0)                AS Kills,
      COALESCE(e.deaths, 0)                     AS Deaths,
      COALESCE(e.team_kills, 0)                 AS TeamKills,
      COALESCE(e.events_won, 0)                 AS EventsWon,
      COALESCE(s.headshots, 0)                  AS Headshots,
      COALESCE(s.puppets_killed, 0)             AS ZombieKills,
      COALESCE(s.animals_killed, 0)             AS AnimalKills,
      COALESCE(s.locks_picked, 0)               AS LocksPicked,
      COALESCE(barc.account_balance, 0)         AS Money
    FROM user_profile u
    LEFT JOIN events_stats e      ON u.id = e.user_profile_id
    LEFT JOIN survival_stats s    ON u.id = s.user_profile_id
    LEFT JOIN bank_account_registry bar
           ON u.id = bar.account_owner_user_profile_id
    LEFT JOIN bank_account_registry_currencies barc
           ON bar.id = barc.bank_account_id AND barc.currency_type = 1
    WHERE LOWER(u.name) = LOWER(?)
    LIMIT 1
  `;

  try {
    const row = db.prepare(excludeDeletedProfiles(sql)).get(name);
    return row || null;
  } catch {
    return null;
  }
}

/**
 * Search players by partial name (up to 10 results).
 * Used by the web API player search endpoint.
 */
function searchPlayersByName(term, limit = 10) {
  const db = getScumDb();
  if (!db) return [];

  const sql = `
    SELECT u.name AS Name, u.user_id AS SteamID,
           COALESCE(u.fame_points, 0) AS FamePoints,
           COALESCE(u.play_time, 0)   AS PlayTime,
           COALESCE(e.enemy_kills, 0) AS Kills,
           COALESCE(e.deaths, 0)      AS Deaths
    FROM user_profile u
    LEFT JOIN events_stats e ON u.id = e.user_profile_id
    WHERE LOWER(u.name) LIKE LOWER(?)
    ORDER BY u.name
    LIMIT ?
  `;

  try {
    return db.prepare(excludeDeletedProfiles(sql)).all(`%${term}%`, limit);
  } catch {
    return [];
  }
}

function searchPlayersBySteamId(steamId) {
  const db = getScumDb();
  if (!db) return [];

  const sql = `
    SELECT u.name AS Name, u.user_id AS SteamID,
           COALESCE(u.fame_points, 0) AS FamePoints,
           COALESCE(u.play_time, 0)   AS PlayTime,
           COALESCE(e.enemy_kills, 0) AS Kills,
           COALESCE(e.deaths, 0)      AS Deaths
    FROM user_profile u
    LEFT JOIN events_stats e ON u.id = e.user_profile_id
    WHERE u.user_id = ?
    LIMIT 1
  `;

  try {
    return db.prepare(excludeDeletedProfiles(sql)).all(steamId);
  } catch {
    return [];
  }
}

module.exports = {
  getOnlinePlayers,
  getTotalPlayerCount,
  getOnlinePlayerCount,
  getGameTimeData,
  getWeatherData,
  getActiveSquadCount,
  getVehicleCount,
  getBaseCount,
  getServerStatistics,
  getPlayerStatsByName,
  searchPlayersByName,
  searchPlayersBySteamId,
};
