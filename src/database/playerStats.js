'use strict';

const fs = require('fs');
const logger = require('../core/logger');
const { getScumDb, getScumDbPath, excludeDeletedProfiles } = require('./db');
const { memo, memoPersistent } = require('./cache');
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

  return memo('onlinePlayers', 5000, () => {
    const rows = tryQueries(db, [
      `SELECT name as PlayerName, user_id as SteamID, last_login_time, last_logout_time FROM user_profile WHERE last_login_time > last_logout_time OR last_logout_time IS NULL`,
      `SELECT * FROM Players WHERE IsOnline = 1`,
      `SELECT * FROM PlayerData WHERE Online = 1`,
    ]);
    return rows || [];
  });
}

/**
 * Total and online player counts in a single pass over user_profile. Both numbers
 * are needed together by the status embed / API, and the online count is also
 * polled by the monitoring loop — one cached query now serves all of them instead
 * of two separate full scans per caller.
 */
function getPlayerCounts() {
  const db = getScumDb();
  if (!db) return { total: 0, online: 0 };
  return memo('playerCounts', 5000, () => {
    const row = tryQueriesGet(db, [
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN last_login_time > last_logout_time OR last_logout_time IS NULL THEN 1 ELSE 0 END) as online
       FROM user_profile`,
    ]);
    return { total: row ? (row.total || 0) : 0, online: row ? (row.online || 0) : 0 };
  });
}

/**
 * Mirrors Get-TotalPlayerCount.
 */
function getTotalPlayerCount() {
  return getPlayerCounts().total;
}

/**
 * Mirrors Get-OnlinePlayerCount.
 */
function getOnlinePlayerCount() {
  return getPlayerCounts().online;
}

/**
 * Read the single weather_parameters row once (time + both temperatures). The
 * status embed and API need game time and temperature together, which used to be
 * two separate queries against the same one-row table — now one cached read.
 */
function getWeatherSnapshot() {
  const db = getScumDb();
  if (!db) return null;
  return memo('weatherSnapshot', 5000, () => tryQueriesGet(db, [
    `SELECT time_of_day, base_air_temperature, water_temperature FROM weather_parameters LIMIT 1`,
  ]));
}

/**
 * Mirrors Get-GameTimeData.
 */
function getGameTimeData() {
  const row = getWeatherSnapshot();
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
  const row = getWeatherSnapshot();
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
  return memo('activeSquadCount', 10000, () => {
    const row = tryQueriesGet(db, [
      `SELECT COUNT(DISTINCT squad_id) as total FROM squad_member WHERE squad_id IS NOT NULL AND squad_id != ''`,
    ]);
    return row ? row.total : 0;
  });
}

/**
 * Mirrors Get-VehicleCount.
 */
function getVehicleCount() {
  const db = getScumDb();
  if (!db) return 0;
  return memo('vehicleCount', 10000, () => {
    const row = tryQueriesGet(db, [
      `SELECT COUNT(*) as VehicleCount FROM vehicle_entity`,
      `SELECT COUNT(*) as VehicleCount FROM Vehicles WHERE IsDestroyed = 0`,
    ]);
    return row ? row.VehicleCount : 0;
  });
}

/**
 * Mirrors Get-BaseCount.
 */
function getBaseCount() {
  const db = getScumDb();
  if (!db) return 0;
  return memo('baseCount', 10000, () => {
    const row = tryQueriesGet(db, [
      `SELECT COUNT(*) as BaseCount FROM base`,
      `SELECT COUNT(DISTINCT OwnerID) as BaseCount FROM Buildings WHERE IsDestroyed = 0`,
    ]);
    return row ? row.BaseCount : 0;
  });
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
// Shared SELECT for a single player's full stat sheet. Append a WHERE clause
// (by name or by Steam ID) plus `LIMIT 1`.
const PLAYER_STATS_SELECT = `
    SELECT
      u.name                                    AS Name,
      u.user_id                                 AS SteamID,
      (SELECT sq.name FROM squad_member sm JOIN squad sq ON sm.squad_id = sq.id
         WHERE sm.user_profile_id = u.id LIMIT 1) AS SquadName,
      COALESCE(u.fame_points, 0)                AS FamePoints,
      COALESCE(u.play_time, 0)                  AS PlayTime,
      u.last_logout_time                        AS LastLogout,
      CASE WHEN u.last_login_time > u.last_logout_time
                OR u.last_logout_time IS NULL
           THEN 1 ELSE 0 END                    AS IsOnline,
      -- Kills/Deaths live in survival_stats on current SCUM saves (events_stats is
      -- the Events-mode table and is all-zero on survival servers). Fall back to
      -- events_stats only when survival_stats has nothing.
      (CASE WHEN COALESCE(s.kills, 0)  > 0 THEN s.kills  ELSE COALESCE(e.enemy_kills, 0) END) AS Kills,
      (CASE WHEN COALESCE(s.deaths, 0) > 0 THEN s.deaths ELSE COALESCE(e.deaths, 0)      END) AS Deaths,
      COALESCE(s.prisoner_kills, 0)             AS PvpKills,
      COALESCE(s.firearm_kills, 0)              AS FirearmKills,
      COALESCE(s.deaths_by_prisoners, 0)        AS PvpDeaths,
      COALESCE(s.players_knocked_out, 0)        AS KnockedOut,
      COALESCE(s.shots_fired, 0)                AS ShotsFired,
      COALESCE(s.shots_hit, 0)                  AS ShotsHit,
      COALESCE(e.team_kills, 0)                 AS TeamKills,
      COALESCE(e.events_won, 0)                 AS EventsWon,
      COALESCE(s.headshots, 0)                  AS Headshots,
      COALESCE(s.puppets_killed, 0)             AS ZombieKills,
      COALESCE(s.animals_killed, 0)             AS AnimalKills,
      COALESCE(s.locks_picked, 0)               AS LocksPicked,
      COALESCE(s.melee_kills, 0)                AS MeleeKills,
      COALESCE(s.archery_kills, 0)              AS ArcheryKills,
      COALESCE(s.longest_kill_distance, 0)      AS LongestKill,
      COALESCE(s.minutes_survived, 0)           AS MinutesSurvived,
      COALESCE(s.distance_travelled_by_foot, 0) AS Distance,
      COALESCE(s.containers_looted, 0)          AS Looted,
      COALESCE(s.wounds_patched, 0)             AS WoundsPatched,
      COALESCE(f.fish_caught, 0)                AS FishCaught,
      (COALESCE(s.guns_crafted, 0) + COALESCE(s.bullets_crafted, 0)
       + COALESCE(s.arrows_crafted, 0) + COALESCE(s.clothing_crafted, 0)
       + COALESCE(s.melee_weapons_crafted, 0)) AS Crafted,
      COALESCE(barc.account_balance, 0)         AS Money
    FROM user_profile u
    LEFT JOIN events_stats e      ON u.id = e.user_profile_id
    LEFT JOIN survival_stats s    ON u.id = s.user_profile_id
    LEFT JOIN fishing_stats f     ON u.id = f.user_profile_id
    LEFT JOIN bank_account_registry bar
           ON u.id = bar.account_owner_user_profile_id
    LEFT JOIN bank_account_registry_currencies barc
           ON bar.id = barc.bank_account_id AND barc.currency_type = 1
`;

function getPlayerStatsByName(name) {
  const db = getScumDb();
  if (!db || name == null) return null;
  // Cached briefly — hit by the public player-profile click and admin lookups,
  // and the stat sheet is a multi-join scan.
  return memo(`statsByName:${String(name).toLowerCase()}`, 15000, () => {
    const sql = `${PLAYER_STATS_SELECT} WHERE LOWER(u.name) = LOWER(?) LIMIT 1`;
    try {
      const row = db.prepare(excludeDeletedProfiles(sql)).get(name);
      return row || null;
    } catch {
      return null;
    }
  });
}

/**
 * Same full stat sheet as getPlayerStatsByName but keyed on Steam ID — used for a
 * linked player's own stats, where names may collide or change.
 */
function getPlayerStatsBySteamId(steamId) {
  const db = getScumDb();
  if (!db || steamId == null) return null;
  // Cached briefly: a linked player's panel may poll this, and the stat sheet is
  // a multi-join scan — one query per player per 15s is plenty.
  return memo(`statsBySteam:${steamId}`, 15000, () => {
    const sql = `${PLAYER_STATS_SELECT} WHERE u.user_id = ? LIMIT 1`;
    try {
      const row = db.prepare(excludeDeletedProfiles(sql)).get(String(steamId));
      return row || null;
    } catch {
      return null;
    }
  });
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

/** Squad id of the player with the given Steam ID, or null. */
function getSquadIdBySteamId(steamId) {
  const db = getScumDb();
  if (!db || steamId == null) return null;
  return memo(`squadIdBySteam:${steamId}`, 15000, () => {
    try {
      const row = db.prepare(excludeDeletedProfiles(
        `SELECT sm.squad_id AS SquadId FROM user_profile u
         JOIN squad_member sm ON u.id = sm.user_profile_id
         WHERE u.user_id = ? LIMIT 1`,
      )).get(String(steamId));
      return row ? row.SquadId : null;
    } catch {
      return null;
    }
  });
}

const SQUAD_RANKS = { 4: 'Leader', 3: 'Officer', 2: 'Member', 1: 'Recruit' };

/**
 * A player's own squad: name, score and members (name, rank, online, last seen).
 * No Steam IDs are returned. Keyed on the player's Steam ID.
 */
function getSquadInfoBySteamId(steamId) {
  const db = getScumDb();
  if (!db || steamId == null) return null;
  return memo(`squadInfo:${steamId}`, 15000, () => {
    try {
      const sq = db.prepare(excludeDeletedProfiles(
        `SELECT s.id AS Id, s.name AS Name, COALESCE(s.score, 0) AS Score
         FROM user_profile u
         JOIN squad_member sm ON u.id = sm.user_profile_id
         JOIN squad s ON s.id = sm.squad_id
         WHERE u.user_id = ? LIMIT 1`,
      )).get(String(steamId));
      if (!sq) return null;
      const members = db.prepare(excludeDeletedProfiles(
        `SELECT u.name AS name, sm.rank AS rank,
                CASE WHEN u.last_login_time > u.last_logout_time OR u.last_logout_time IS NULL
                     THEN 1 ELSE 0 END AS online,
                u.last_login_time AS lastLogin, u.last_logout_time AS lastLogout
         FROM squad_member sm JOIN user_profile u ON u.id = sm.user_profile_id
         WHERE sm.squad_id = ?
         ORDER BY online DESC, sm.rank DESC, u.name`,
      )).all(sq.Id);
      return {
        name: sq.Name,
        score: sq.Score,
        memberCount: members.length,
        members: members.map((m) => ({
          name: m.name,
          rank: SQUAD_RANKS[m.rank] || 'Member',
          online: !!m.online,
          lastSeen: m.online ? null : (m.lastLogout || m.lastLogin || null),
        })),
      };
    } catch {
      return null;
    }
  });
}

/**
 * Event ranking board from event_rankings_cached (+ events_stats wins). Shows only
 * players with any event activity, so it's empty until an event has actually run.
 */
function getEventRankings(limit = 50) {
  const db = getScumDb();
  if (!db) return [];
  return memo(`eventRankings:${limit}`, 30000, () => {
    try {
      return db.prepare(excludeDeletedProfiles(
        `SELECT r.name AS Name, r.score AS Score, r.enemy_kills AS Kills, r.deaths AS Deaths,
                r.headshots AS Headshots, r.assists AS Assists, r.ctf_captures AS Captures,
                COALESCE(e.events_won, 0) AS Wins
         FROM event_rankings_cached r
         LEFT JOIN events_stats e ON e.user_profile_id = r.user_profile_id
         JOIN user_profile u ON u.id = r.user_profile_id
         WHERE r.score > 0 OR r.enemy_kills > 0 OR COALESCE(e.events_won, 0) > 0
         ORDER BY r.score DESC, r.enemy_kills DESC LIMIT ?`,
      )).all(limit);
    } catch {
      return [];
    }
  });
}

/** Public squad list: name, score, member count. No per-member data. */
function getSquadList(limit = 60) {
  const db = getScumDb();
  if (!db) return [];
  return memo(`squadList:${limit}`, 30000, () => {
    try {
      return db.prepare(
        `SELECT s.id AS id, s.name AS name, COALESCE(s.score, 0) AS score,
                COUNT(m.user_profile_id) AS memberCount
         FROM squad s LEFT JOIN squad_member m ON m.squad_id = s.id
         GROUP BY s.id, s.name HAVING memberCount > 0
         ORDER BY score DESC LIMIT ?`,
      ).all(limit);
    } catch {
      return [];
    }
  });
}

/** Public squad detail: name, score, members (name + rank only — no online/last-seen). */
function getSquadDetailById(squadId) {
  const db = getScumDb();
  if (!db || squadId == null) return null;
  return memo(`squadDetail:${squadId}`, 30000, () => {
    try {
      const sq = db.prepare('SELECT name, COALESCE(score, 0) AS score FROM squad WHERE id = ?').get(Number(squadId));
      if (!sq) return null;
      const members = db.prepare(excludeDeletedProfiles(
        `SELECT u.name AS name, sm.rank AS rank
         FROM squad_member sm JOIN user_profile u ON u.id = sm.user_profile_id
         WHERE sm.squad_id = ? ORDER BY sm.rank DESC, u.name`,
      )).all(Number(squadId));
      return {
        name: sq.name,
        score: sq.score,
        memberCount: members.length,
        members: members.map((m) => ({ name: m.name, rank: SQUAD_RANKS[m.rank] || 'Member' })),
      };
    } catch {
      return null;
    }
  });
}

/** Steam IDs of all members of a squad. */
function getSquadMemberSteamIds(squadId) {
  const db = getScumDb();
  if (!db || squadId == null) return [];
  return memo(`squadMembers:${squadId}`, 15000, () => {
    try {
      const rows = db.prepare(excludeDeletedProfiles(
        `SELECT u.user_id AS SteamID FROM user_profile u
         JOIN squad_member sm ON u.id = sm.user_profile_id
         WHERE sm.squad_id = ?`,
      )).all(squadId);
      return rows.map((r) => String(r.SteamID));
    } catch {
      return [];
    }
  });
}

/** Steam ID (user_profile.user_id) for a SCUM user_profile.id, or null. */
function getSteamIdByProfileId(profileId) {
  const db = getScumDb();
  if (!db || profileId == null) return null;
  // A profile id maps to one steam id for the life of the save file.
  return memoPersistent(`steamByProfile:${profileId}`, () => {
    try {
      const row = db.prepare('SELECT user_id AS SteamID FROM user_profile WHERE id = ?').get(Number(profileId));
      return row ? String(row.SteamID) : null;
    } catch {
      return null;
    }
  });
}

/** Player name for a SCUM user_profile.id, or null. */
function getPlayerNameByProfileId(profileId) {
  const db = getScumDb();
  if (!db || profileId == null) return null;
  // A profile's name can change, so don't cache it persistently.
  return memo(`nameByProfile:${profileId}`, 15000, () => {
    try {
      const row = db.prepare('SELECT name AS Name FROM user_profile WHERE id = ?').get(Number(profileId));
      return row && row.Name ? String(row.Name) : null;
    } catch {
      return null;
    }
  });
}

/** Human-readable name for an entity id (e.g. 'Wolfswagen Item Container'), or null. */
function getEntityDisplayName(entityId) {
  const db = getScumDb();
  if (!db || entityId == null) return null;
  // An entity's class never changes once the row exists.
  return memoPersistent(`entityName:${entityId}`, () => {
    try {
      const row = db.prepare('SELECT class AS Class FROM entity WHERE id = ?').get(Number(entityId));
      if (!row || !row.Class) return null;
      return String(row.Class).replace(/_ES$/, '').replace(/_C$/, '').replace(/_/g, ' ').trim();
    } catch {
      return null;
    }
  });
}

/**
 * Owner (user_profile.id) of the base nearest a destruction location. The destroyed
 * element itself is already gone from base_element, so we match the closest
 * surviving element of the same base (within maxDist game units / cm).
 */
function getBaseElementOwnerProfileId(x, y, z, maxDist = 5000) {
  const db = getScumDb();
  if (!db || x == null || y == null || z == null) return null;
  try {
    // Pre-filter to an x/y box of half-width maxDist before the distance sort.
    // Any element within maxDist (3D) is necessarily within maxDist horizontally,
    // so it stays inside the box — the nearest-within-maxDist result is unchanged,
    // but SQLite sorts far fewer rows instead of the whole base_element table.
    const row = db.prepare(`
      SELECT owner_profile_id AS OwnerProfileId,
        ((location_x - ?) * (location_x - ?) + (location_y - ?) * (location_y - ?)
         + (location_z - ?) * (location_z - ?)) AS d2
      FROM base_element
      WHERE location_x BETWEEN ? AND ? AND location_y BETWEEN ? AND ?
      ORDER BY d2 ASC LIMIT 1
    `).get(x, x, y, y, z, z, x - maxDist, x + maxDist, y - maxDist, y + maxDist);
    if (!row || row.OwnerProfileId == null) return null;
    if (Math.sqrt(row.d2) > maxDist) return null;
    return row.OwnerProfileId;
  } catch {
    return null;
  }
}

/**
 * SCUM user_profile.id values that make up an owner's "base side": the player
 * themselves plus every member of their squad. Used to decide whether a location
 * belongs to that player's territory/flag area.
 */
function getOwnerAreaProfileIds(steamId) {
  const db = getScumDb();
  if (!db || steamId == null) return [];
  return memo(`ownerAreaProfileIds:${steamId}`, 15000, () => {
    const ids = new Set();
    try {
      const own = db.prepare(excludeDeletedProfiles(
        'SELECT id AS Id FROM user_profile WHERE user_id = ?',
      )).get(String(steamId));
      if (own && own.Id != null) ids.add(own.Id);
    } catch { /* ignore */ }
    try {
      const squadId = getSquadIdBySteamId(steamId);
      if (squadId != null) {
        const rows = db.prepare(excludeDeletedProfiles(
          `SELECT u.id AS Id FROM user_profile u
           JOIN squad_member sm ON u.id = sm.user_profile_id
           WHERE sm.squad_id = ?`,
        )).all(squadId);
        for (const r of rows) if (r.Id != null) ids.add(r.Id);
      }
    } catch { /* ignore */ }
    return [...ids];
  });
}

/**
 * True if (x,y) lies within `radius` game units (cm) of any base element owned by
 * the player or their squad — i.e. inside their territory flag area. Horizontal
 * distance only (flag zones are cylindrical). Returns false if the player has no
 * known base elements, which conservatively means "not in their flag area".
 */
function isLocationInOwnerArea(steamId, x, y, radius = 5000) {
  const db = getScumDb();
  if (!db || x == null || y == null) return false;
  const profileIds = getOwnerAreaProfileIds(steamId);
  if (!profileIds.length) return false;
  try {
    const placeholders = profileIds.map(() => '?').join(',');
    // Bound the scan to an x/y box of half-width `radius`: anything within `radius`
    // is inside the box, so the nearest-within-radius decision is identical while
    // SQLite scans far fewer base_element rows.
    const row = db.prepare(`
      SELECT ((location_x - ?) * (location_x - ?) + (location_y - ?) * (location_y - ?)) AS d2
      FROM base_element
      WHERE owner_profile_id IN (${placeholders})
        AND location_x BETWEEN ? AND ? AND location_y BETWEEN ? AND ?
      ORDER BY d2 ASC LIMIT 1
    `).get(x, x, y, y, ...profileIds, x - radius, x + radius, y - radius, y + radius);
    if (!row || row.d2 == null) return false;
    return Math.sqrt(row.d2) <= radius;
  } catch {
    return false;
  }
}

module.exports = {
  getOnlinePlayers,
  getTotalPlayerCount,
  getSquadIdBySteamId,
  getSquadMemberSteamIds,
  getSquadInfoBySteamId,
  getSquadList,
  getSquadDetailById,
  getEventRankings,
  getSteamIdByProfileId,
  getPlayerNameByProfileId,
  getOwnerAreaProfileIds,
  isLocationInOwnerArea,
  getEntityDisplayName,
  getBaseElementOwnerProfileId,
  getOnlinePlayerCount,
  getGameTimeData,
  getWeatherData,
  getActiveSquadCount,
  getVehicleCount,
  getBaseCount,
  getServerStatistics,
  getPlayerStatsByName,
  getPlayerStatsBySteamId,
  searchPlayersByName,
  searchPlayersBySteamId,
};
