'use strict';

const logger = require('../core/logger');
const { getScumDb, getWeeklyDb, excludeDeletedAndAdmins } = require('./db');

/**
 * Get the start (Monday, 00:00) of the current week.
 * Mirrors Get-CurrentWeekStart: ($today.DayOfWeek.value__ + 6) % 7 days back from today.
 */
function getCurrentWeekStart(now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysToSubtract = (date.getDay() + 6) % 7; // Sunday=0..Saturday=6 -> Monday-based offset
  date.setDate(date.getDate() - daysToSubtract);
  return date;
}

function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toDateTimeStr(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const SNAPSHOT_USER_QUERY = `
SELECT
    u.id as user_profile_id,
    COALESCE(u.play_time, 0) as play_time,
    COALESCE(u.fame_points, 0) as fame_points,
    COALESCE(barc.account_balance, 0) as money_balance,
    COALESCE(e.enemy_kills, 0) as enemy_kills,
    COALESCE(e.deaths, 0) as deaths,
    COALESCE(e.events_won, 0) as events_won,
    COALESCE(e.team_kills, 0) as team_kills,
    COALESCE(s.headshots, 0) as headshots,
    COALESCE(s.animals_killed, 0) as animals_killed,
    COALESCE(s.puppets_killed, 0) as puppets_killed,
    COALESCE(s.drone_kills, 0) as drone_kills,
    COALESCE(s.sentry_kills, 0) as sentry_kills,
    COALESCE(s.locks_picked, 0) as locks_picked,
    COALESCE(s.guns_crafted, 0) as guns_crafted,
    COALESCE(s.bullets_crafted, 0) as bullets_crafted,
    COALESCE(s.melee_weapons_crafted, 0) as melee_weapons_crafted,
    COALESCE(s.clothing_crafted, 0) as clothing_crafted,
    COALESCE(f.fish_caught, 0) as fish_caught,
    COALESCE(s.minutes_survived, 0) as minutes_survived,
    COALESCE(s.containers_looted, 0) as containers_looted,
    COALESCE(s.melee_kills, 0) as melee_kills,
    COALESCE(s.archery_kills, 0) as archery_kills,
    COALESCE(s.wounds_patched, 0) as wounds_patched,
    COALESCE(s.distance_travelled_by_foot, 0) as distance_travelled_by_foot,
    COALESCE(s.arrows_crafted, 0) as arrows_crafted,
    COALESCE(s.longest_kill_distance, 0) as longest_kill_distance
FROM user_profile u
LEFT JOIN events_stats e ON u.id = e.user_profile_id
LEFT JOIN survival_stats s ON u.id = s.user_profile_id
LEFT JOIN fishing_stats f ON u.id = f.user_profile_id
LEFT JOIN bank_account_registry bar ON u.id = bar.account_owner_user_profile_id
LEFT JOIN bank_account_registry_currencies barc ON bar.id = barc.bank_account_id AND barc.currency_type = 1
WHERE u.type != 2
`;

const SNAPSHOT_SQUAD_QUERY = `SELECT name, COALESCE(score, 0) as score FROM squad WHERE score > 0`;

const INSERT_USER_SNAPSHOT_SQL = `
INSERT OR REPLACE INTO weekly_snapshots (
    user_profile_id, week_start_date,
    play_time, fame_points, money_balance,
    enemy_kills, deaths, events_won, team_kills,
    headshots, animals_killed, puppets_killed, drone_kills, sentry_kills,
    locks_picked, guns_crafted, bullets_crafted, melee_weapons_crafted, clothing_crafted,
    fish_caught, minutes_survived, containers_looted, melee_kills, archery_kills,
    wounds_patched, distance_travelled_by_foot, arrows_crafted, longest_kill_distance, updated_at
) VALUES (
    @user_profile_id, @week_start_date,
    @play_time, @fame_points, @money_balance,
    @enemy_kills, @deaths, @events_won, @team_kills,
    @headshots, @animals_killed, @puppets_killed, @drone_kills, @sentry_kills,
    @locks_picked, @guns_crafted, @bullets_crafted, @melee_weapons_crafted, @clothing_crafted,
    @fish_caught, @minutes_survived, @containers_looted, @melee_kills, @archery_kills,
    @wounds_patched, @distance_travelled_by_foot, @arrows_crafted, @longest_kill_distance, @updated_at
)
`;

const INSERT_SQUAD_SNAPSHOT_SQL = `
INSERT OR REPLACE INTO weekly_snapshots (user_profile_id, week_start_date, squad_name, squad_score, updated_at)
VALUES (@user_profile_id, @week_start_date, @squad_name, @squad_score, @updated_at)
`;

/**
 * Take a snapshot of current player/squad statistics for weekly delta tracking.
 * Mirrors Update-WeeklySnapshot. Returns true on success (including "already exists").
 */
function updateWeeklySnapshot(weekStartDate = getCurrentWeekStart()) {
  try {
    const scumDb = getScumDb();
    if (!scumDb) {
      logger.warn('[Leaderboards] Cannot take weekly snapshot - SCUM database not available');
      return false;
    }

    const weeklyDb = getWeeklyDb();
    const weekStartStr = toDateStr(weekStartDate);
    const weekEndStr = toDateStr(new Date(weekStartDate.getFullYear(), weekStartDate.getMonth(), weekStartDate.getDate() + 7));
    const now = toDateTimeStr(new Date());

    logger.info(`[Leaderboards] Taking weekly snapshot for week starting: ${weekStartStr}`);

    const existing = weeklyDb.prepare('SELECT COUNT(*) as count FROM weekly_snapshots WHERE week_start_date = ?').get(weekStartStr);
    if (existing && existing.count > 0) {
      logger.info(`[Leaderboards] Snapshot already exists for week ${weekStartStr}`);
      return true;
    }

    weeklyDb.prepare(`
      INSERT OR REPLACE INTO current_week_info (week_start_date, week_end_date, created_date)
      VALUES (?, ?, ?)
    `).run(weekStartStr, weekEndStr, now);

    const users = scumDb.prepare(excludeDeletedAndAdmins(SNAPSHOT_USER_QUERY)).all();
    const squads = scumDb.prepare(SNAPSHOT_SQUAD_QUERY).all();

    const insertUser = weeklyDb.prepare(INSERT_USER_SNAPSHOT_SQL);
    const insertSquad = weeklyDb.prepare(INSERT_SQUAD_SNAPSHOT_SQL);

    weeklyDb.transaction(() => {
      for (const u of users) {
        insertUser.run({ ...u, week_start_date: weekStartStr, updated_at: now });
      }
      squads.forEach((squad, index) => {
        insertSquad.run({
          user_profile_id: -(index + 1),
          week_start_date: weekStartStr,
          squad_name: squad.name,
          squad_score: squad.score,
          updated_at: now,
        });
      });
    })();

    logger.info(`[Leaderboards] Weekly snapshot completed successfully for week ${weekStartStr} (${users.length} players, ${squads.length} squads)`);
    return true;
  } catch (err) {
    logger.warn(`[Leaderboards] Error during weekly snapshot: ${err.message}`);
    return false;
  }
}

/**
 * Check whether a weekly reset (new snapshot) is needed. Mirrors Test-WeeklyResetNeeded.
 */
function testWeeklyResetNeeded() {
  try {
    const weeklyDb = getWeeklyDb();
    const weekStartStr = toDateStr(getCurrentWeekStart());
    const row = weeklyDb.prepare('SELECT COUNT(*) as count FROM current_week_info WHERE week_start_date = ?').get(weekStartStr);
    return !row || row.count === 0;
  } catch (err) {
    logger.warn(`[Leaderboards] Error checking weekly reset status: ${err.message}`);
    return true;
  }
}

/**
 * Perform the weekly reset (take a snapshot for the current week). Mirrors Invoke-WeeklyReset.
 */
function invokeWeeklyReset() {
  logger.info('[Leaderboards] Starting weekly reset process...');
  const success = updateWeeklySnapshot(getCurrentWeekStart());
  if (success) logger.info('[Leaderboards] Weekly reset completed successfully');
  else logger.warn('[Leaderboards] Weekly reset failed');
  return success;
}

module.exports = {
  getCurrentWeekStart,
  toDateStr,
  updateWeeklySnapshot,
  testWeeklyResetNeeded,
  invokeWeeklyReset,
};
