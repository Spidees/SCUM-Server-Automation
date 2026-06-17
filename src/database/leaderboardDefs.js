'use strict';

// Leaderboard category definitions, ported from $script:DatabaseQueries and the
// "NEW LEADERBOARD SYSTEM" Get-Top* / Get-WeeklyLeaderboard / Format-WeeklyValue
// functions in modules/database/scum-database.psm1.
//
// Each category has:
//  - key: category identifier (used in the API and matches the Get-WeeklyLeaderboard
//    category keys where one exists)
//  - label: human-readable name for the dashboard
//  - allTime: { sql, value(score), format(score) } for the all-time leaderboard
//  - weekly: describes how to compute the weekly delta leaderboard (or null if the
//    PS version doesn't define one)

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

const CATEGORIES = [
  {
    key: 'kills',
    label: 'Top Kills',
    allTime: {
      sql: `SELECT u.name as Name, e.enemy_kills as Score FROM user_profile u LEFT JOIN events_stats e ON u.id = e.user_profile_id WHERE e.enemy_kills > 0 ORDER BY e.enemy_kills DESC LIMIT @limit`,
      value: (score) => Math.trunc(score),
      format: (score) => `${Math.trunc(score)} kills`,
    },
    weekly: {
      type: 'simple',
      currentSql: `SELECT u.id as Id, u.name as Name, COALESCE(e.enemy_kills, 0) as Score FROM user_profile u LEFT JOIN events_stats e ON u.id = e.user_profile_id`,
      snapshotField: 'enemy_kills',
      value: (delta) => Math.trunc(delta),
      format: (delta) => `+${Math.trunc(delta)} kills`,
    },
  },
  {
    key: 'deaths',
    label: 'Top Deaths',
    allTime: {
      sql: `SELECT u.name as Name, e.deaths as Score FROM user_profile u LEFT JOIN events_stats e ON u.id = e.user_profile_id WHERE e.deaths > 0 ORDER BY e.deaths DESC LIMIT @limit`,
      value: (score) => Math.trunc(score),
      format: (score) => `${Math.trunc(score)} deaths`,
    },
    weekly: {
      type: 'simple',
      currentSql: `SELECT u.id as Id, u.name as Name, COALESCE(e.deaths, 0) as Score FROM user_profile u LEFT JOIN events_stats e ON u.id = e.user_profile_id`,
      snapshotField: 'deaths',
      value: (delta) => Math.trunc(delta),
      format: (delta) => `+${Math.trunc(delta)} deaths`,
    },
  },
  {
    key: 'playtime',
    label: 'Top Playtime',
    allTime: {
      sql: `SELECT name as Name, play_time as Score FROM user_profile WHERE play_time > 0 ORDER BY play_time DESC LIMIT @limit`,
      value: (score) => Math.trunc(score),
      format: (score) => `${round(score / 3600, 1)}h`,
    },
    weekly: {
      type: 'simple',
      currentSql: `SELECT id as Id, name as Name, COALESCE(play_time, 0) as Score FROM user_profile`,
      snapshotField: 'play_time',
      value: (delta) => Math.trunc(delta),
      format: (delta) => `+${round(delta / 3600, 1)}h`,
    },
  },
  {
    key: 'fame',
    label: 'Top Fame',
    allTime: {
      sql: `SELECT name as Name, fame_points as Score FROM user_profile WHERE fame_points > 0 ORDER BY fame_points DESC LIMIT @limit`,
      value: (score) => Math.trunc(score),
      format: (score) => `${Math.trunc(score)} fame`,
    },
    weekly: {
      type: 'simple',
      currentSql: `SELECT id as Id, name as Name, COALESCE(fame_points, 0) as Score FROM user_profile`,
      snapshotField: 'fame_points',
      value: (delta) => Math.trunc(delta),
      format: (delta) => `+${Math.trunc(delta)} fame`,
    },
  },
  {
    key: 'money',
    label: 'Top Money',
    allTime: {
      sql: `SELECT u.name as Name, barc.account_balance as Score FROM user_profile u JOIN bank_account_registry bar ON u.id = bar.account_owner_user_profile_id JOIN bank_account_registry_currencies barc ON bar.id = barc.bank_account_id WHERE barc.currency_type = 1 AND barc.account_balance > 0 ORDER BY barc.account_balance DESC LIMIT @limit`,
      value: (score) => Math.trunc(score),
      format: (score) => `${Math.trunc(score)} credits`,
    },
    weekly: {
      type: 'simple',
      currentSql: `SELECT u.id as Id, u.name as Name, COALESCE(barc.account_balance, 0) as Score FROM user_profile u LEFT JOIN bank_account_registry bar ON u.id = bar.account_owner_user_profile_id LEFT JOIN bank_account_registry_currencies barc ON bar.id = barc.bank_account_id AND barc.currency_type = 1`,
      snapshotField: 'money_balance',
      value: (delta) => Math.trunc(delta),
      format: (delta) => `+${Math.trunc(delta)} credits`,
    },
  },
  {
    key: 'events',
    label: 'Top Events Won',
    allTime: {
      sql: `SELECT u.name as Name, e.events_won as Score FROM user_profile u LEFT JOIN events_stats e ON u.id = e.user_profile_id WHERE e.events_won > 0 ORDER BY e.events_won DESC LIMIT @limit`,
      value: (score) => Math.trunc(score),
      format: (score) => `${Math.trunc(score)} events`,
    },
    weekly: {
      type: 'simple',
      currentSql: `SELECT u.id as Id, u.name as Name, COALESCE(e.events_won, 0) as Score FROM user_profile u LEFT JOIN events_stats e ON u.id = e.user_profile_id`,
      snapshotField: 'events_won',
      value: (delta) => Math.trunc(delta),
      format: (delta) => `+${Math.trunc(delta)} events`,
    },
  },
  {
    key: 'kdr',
    label: 'Top K/D Ratio',
    allTime: {
      sql: `SELECT u.name as Name, CASE WHEN e.deaths > 0 THEN CAST(e.enemy_kills AS REAL) / e.deaths ELSE e.enemy_kills END as Score FROM user_profile u LEFT JOIN events_stats e ON u.id = e.user_profile_id WHERE e.enemy_kills > 0 ORDER BY Score DESC LIMIT @limit`,
      value: (score) => round(score, 2),
      format: (score) => `${round(score, 2)} K/D`,
    },
    weekly: {
      type: 'kdr',
      currentSql: `SELECT u.id as Id, u.name as Name, COALESCE(e.enemy_kills, 0) as Kills, COALESCE(e.deaths, 0) as Deaths FROM user_profile u LEFT JOIN events_stats e ON u.id = e.user_profile_id`,
      value: (delta) => round(delta, 2),
      format: (delta) => `+${round(delta, 2)} K/D`,
    },
  },
  {
    key: 'headshots',
    label: 'Top Headshots',
    allTime: {
      sql: `SELECT u.name as Name, s.headshots as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.headshots > 0 ORDER BY s.headshots DESC LIMIT @limit`,
      value: (score) => Math.trunc(score),
      format: (score) => `${Math.trunc(score)} headshots`,
    },
    weekly: {
      type: 'simple',
      currentSql: `SELECT u.id as Id, u.name as Name, COALESCE(s.headshots, 0) as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id`,
      snapshotField: 'headshots',
      value: (delta) => Math.trunc(delta),
      format: (delta) => `+${Math.trunc(delta)} headshots`,
    },
  },
  {
    key: 'team_kills',
    label: 'Top Team Kills',
    allTime: {
      sql: `SELECT u.name as Name, e.team_kills as Score FROM user_profile u LEFT JOIN events_stats e ON u.id = e.user_profile_id WHERE e.team_kills > 0 ORDER BY e.team_kills DESC LIMIT @limit`,
      value: (score) => Math.trunc(score),
      format: (score) => `${Math.trunc(score)} team kills`,
    },
    weekly: {
      type: 'simple',
      currentSql: `SELECT u.id as Id, u.name as Name, COALESCE(e.team_kills, 0) as Score FROM user_profile u LEFT JOIN events_stats e ON u.id = e.user_profile_id`,
      snapshotField: 'team_kills',
      value: (delta) => Math.trunc(delta),
      format: (delta) => `+${Math.trunc(delta)} team kills`,
    },
  },
  {
    key: 'animal_kills',
    label: 'Top Animal Kills',
    allTime: {
      sql: `SELECT u.name as Name, s.animals_killed as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.animals_killed > 0 ORDER BY s.animals_killed DESC LIMIT @limit`,
      value: (score) => Math.trunc(score),
      format: (score) => `${Math.trunc(score)} animals`,
    },
    weekly: {
      type: 'simple',
      currentSql: `SELECT u.id as Id, u.name as Name, COALESCE(s.animals_killed, 0) as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id`,
      snapshotField: 'animals_killed',
      value: (delta) => Math.trunc(delta),
      format: (delta) => `+${Math.trunc(delta)} animals`,
    },
  },
  {
    key: 'puppet_kills',
    label: 'Top Puppet Kills',
    allTime: {
      sql: `SELECT u.name as Name, s.puppets_killed as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.puppets_killed > 0 ORDER BY s.puppets_killed DESC LIMIT @limit`,
      value: (score) => Math.trunc(score),
      format: (score) => `${Math.trunc(score)} puppets`,
    },
    weekly: {
      type: 'simple',
      currentSql: `SELECT u.id as Id, u.name as Name, COALESCE(s.puppets_killed, 0) as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id`,
      snapshotField: 'puppets_killed',
      value: (delta) => Math.trunc(delta),
      format: (delta) => `+${Math.trunc(delta)} puppets`,
    },
  },
  {
    key: 'drone_kills',
    label: 'Top Drone Kills',
    allTime: {
      sql: `SELECT u.name as Name, s.drone_kills as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.drone_kills > 0 ORDER BY s.drone_kills DESC LIMIT @limit`,
      value: (score) => Math.trunc(score),
      format: (score) => `${Math.trunc(score)} drones`,
    },
    weekly: {
      type: 'simple',
      currentSql: `SELECT u.id as Id, u.name as Name, COALESCE(s.drone_kills, 0) as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id`,
      snapshotField: 'drone_kills',
      value: (delta) => Math.trunc(delta),
      format: (delta) => `+${Math.trunc(delta)} drones`,
    },
  },
  {
    key: 'sentry_kills',
    label: 'Top Sentry Kills',
    allTime: {
      sql: `SELECT u.name as Name, s.sentry_kills as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.sentry_kills > 0 ORDER BY s.sentry_kills DESC LIMIT @limit`,
      value: (score) => Math.trunc(score),
      format: (score) => `${Math.trunc(score)} sentries`,
    },
    weekly: {
      type: 'simple',
      currentSql: `SELECT u.id as Id, u.name as Name, COALESCE(s.sentry_kills, 0) as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id`,
      snapshotField: 'sentry_kills',
      value: (delta) => Math.trunc(delta),
      format: (delta) => `+${Math.trunc(delta)} sentries`,
    },
  },
  {
    key: 'locks_picked',
    label: 'Top Lockpickers',
    allTime: {
      sql: `SELECT u.name as Name, s.locks_picked as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.locks_picked > 0 ORDER BY s.locks_picked DESC LIMIT @limit`,
      value: (score) => Math.trunc(score),
      format: (score) => `${Math.trunc(score)} locks`,
    },
    weekly: {
      type: 'simple',
      currentSql: `SELECT u.id as Id, u.name as Name, COALESCE(s.locks_picked, 0) as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id`,
      snapshotField: 'locks_picked',
      value: (delta) => Math.trunc(delta),
      format: (delta) => `+${Math.trunc(delta)} locks`,
    },
  },
  {
    key: 'guns_crafted',
    label: 'Top Gun Crafters',
    allTime: {
      sql: `SELECT u.name as Name, s.guns_crafted as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.guns_crafted > 0 ORDER BY s.guns_crafted DESC LIMIT @limit`,
      value: (score) => Math.trunc(score),
      format: (score) => `${Math.trunc(score)} guns`,
    },
    weekly: {
      type: 'simple',
      currentSql: `SELECT u.id as Id, u.name as Name, COALESCE(s.guns_crafted, 0) as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id`,
      snapshotField: 'guns_crafted',
      value: (delta) => Math.trunc(delta),
      format: (delta) => `+${Math.trunc(delta)} guns`,
    },
  },
  {
    key: 'bullets_crafted',
    label: 'Top Bullet Crafters',
    allTime: {
      sql: `SELECT u.name as Name, s.bullets_crafted as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.bullets_crafted > 0 ORDER BY s.bullets_crafted DESC LIMIT @limit`,
      value: (score) => Math.trunc(score),
      format: (score) => `${Math.trunc(score)} bullets`,
    },
    weekly: {
      type: 'simple',
      currentSql: `SELECT u.id as Id, u.name as Name, COALESCE(s.bullets_crafted, 0) as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id`,
      snapshotField: 'bullets_crafted',
      value: (delta) => Math.trunc(delta),
      format: (delta) => `+${Math.trunc(delta)} bullets`,
    },
  },
  {
    key: 'melee_crafted',
    label: 'Top Melee Crafters',
    allTime: {
      sql: `SELECT u.name as Name, s.melee_weapons_crafted as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.melee_weapons_crafted > 0 ORDER BY s.melee_weapons_crafted DESC LIMIT @limit`,
      value: (score) => Math.trunc(score),
      format: (score) => `${Math.trunc(score)} melee`,
    },
    weekly: {
      // Get-WeeklyLeaderboard uses category key "melee_weapons_crafted", which has
      // no case in Format-WeeklyValue, so it falls through to the default "+$Value".
      type: 'simple',
      currentSql: `SELECT u.id as Id, u.name as Name, COALESCE(s.melee_weapons_crafted, 0) as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id`,
      snapshotField: 'melee_weapons_crafted',
      value: (delta) => Math.trunc(delta),
      format: (delta) => `+${Math.trunc(delta)}`,
    },
  },
  {
    key: 'clothing_crafted',
    label: 'Top Clothing Crafters',
    allTime: {
      sql: `SELECT u.name as Name, s.clothing_crafted as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.clothing_crafted > 0 ORDER BY s.clothing_crafted DESC LIMIT @limit`,
      value: (score) => Math.trunc(score),
      format: (score) => `${Math.trunc(score)} clothing`,
    },
    weekly: {
      type: 'simple',
      currentSql: `SELECT u.id as Id, u.name as Name, COALESCE(s.clothing_crafted, 0) as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id`,
      snapshotField: 'clothing_crafted',
      value: (delta) => Math.trunc(delta),
      format: (delta) => `+${Math.trunc(delta)} clothing`,
    },
  },
  {
    key: 'fish_caught',
    label: 'Top Fishers',
    allTime: {
      sql: `SELECT u.name as Name, f.fish_caught as Score FROM user_profile u LEFT JOIN fishing_stats f ON u.id = f.user_profile_id WHERE f.fish_caught > 0 ORDER BY f.fish_caught DESC LIMIT @limit`,
      value: (score) => Math.trunc(score),
      format: (score) => `${Math.trunc(score)} fish`,
    },
    weekly: {
      type: 'simple',
      currentSql: `SELECT u.id as Id, u.name as Name, COALESCE(f.fish_caught, 0) as Score FROM user_profile u LEFT JOIN fishing_stats f ON u.id = f.user_profile_id`,
      snapshotField: 'fish_caught',
      value: (delta) => Math.trunc(delta),
      format: (delta) => `+${Math.trunc(delta)} fish`,
    },
  },
  {
    key: 'squad_score',
    label: 'Top Squads',
    allTime: {
      sql: `SELECT name as Name, score as Score FROM squad WHERE score > 0 ORDER BY score DESC LIMIT @limit`,
      value: (score) => score,
      format: (score) => `${score.toFixed(0)} score`,
    },
    weekly: {
      type: 'squad',
      currentSql: `SELECT name as Name, COALESCE(score, 0) as Score FROM squad`,
      snapshotField: 'squad_score',
      value: (delta) => delta,
      format: (delta) => `+${delta.toFixed(0)} score`,
    },
  },
  {
    key: 'squad_members',
    label: 'Top Squad Leaders',
    allTime: {
      sql: `SELECT u.name as Name, COUNT(sm.user_profile_id) as Score FROM user_profile u LEFT JOIN squad_member sm ON u.id = sm.user_profile_id WHERE sm.rank = 4 GROUP BY u.id, u.name HAVING COUNT(sm.user_profile_id) > 0 ORDER BY Score DESC LIMIT @limit`,
      value: (score) => Math.trunc(score),
      format: (score) => `${Math.trunc(score)} members`,
    },
    weekly: {
      // Get-WeeklyLeaderboard's "squad_leaders" query just re-runs the same
      // current-count query (no snapshot diff), and "squad_leaders" has no
      // Format-WeeklyValue case, so it falls through to the default "+$Value".
      type: 'raw',
      currentSql: `SELECT u.name as Name, COUNT(sm.user_profile_id) as Score FROM user_profile u LEFT JOIN squad_member sm ON u.id = sm.user_profile_id WHERE sm.rank = 4 GROUP BY u.id, u.name HAVING COUNT(sm.user_profile_id) > 0`,
      value: (score) => Math.trunc(score),
      format: (score) => `+${Math.trunc(score)}`,
    },
  },
  {
    key: 'distance',
    label: 'Top Distance Travelled',
    allTime: {
      sql: `SELECT u.name as Name, s.distance_travelled_by_foot as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.distance_travelled_by_foot > 0 ORDER BY s.distance_travelled_by_foot DESC LIMIT @limit`,
      value: (score) => Math.trunc(score),
      format: (score) => `${round(score / 1000, 1)} km`,
    },
    weekly: {
      type: 'simple',
      currentSql: `SELECT u.id as Id, u.name as Name, COALESCE(s.distance_travelled_by_foot, 0) as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id`,
      snapshotField: 'distance_travelled_by_foot',
      value: (delta) => Math.trunc(delta),
      format: (delta) => `+${Math.trunc(delta)} meters`,
    },
  },
  {
    key: 'sniper',
    label: 'Top Sniper Distance',
    allTime: {
      sql: `SELECT u.name as Name, s.longest_kill_distance as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.longest_kill_distance > 0 ORDER BY s.longest_kill_distance DESC LIMIT @limit`,
      value: (score) => round(score, 1),
      format: (score) => `${round(score, 1)}m`,
    },
    weekly: {
      // GetWeeklyLeaderboard "sniper": delta = MAX(current.longest_kill_distance)
      // where current > snapshot (i.e. a new personal-best this week, not a sum).
      type: 'max',
      currentSql: `SELECT u.id as Id, u.name as Name, COALESCE(s.longest_kill_distance, 0) as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id`,
      snapshotField: 'longest_kill_distance',
      value: (delta) => round(delta, 1),
      format: (delta) => `+${round(delta, 1)}m`,
    },
  },
  {
    key: 'melee_warriors',
    label: 'Top Melee Warriors',
    allTime: {
      sql: `SELECT u.name as Name, s.melee_kills as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.melee_kills > 0 ORDER BY s.melee_kills DESC LIMIT @limit`,
      value: (score) => Math.trunc(score),
      format: (score) => `${Math.trunc(score)} melee kills`,
    },
    weekly: {
      type: 'simple',
      currentSql: `SELECT u.id as Id, u.name as Name, COALESCE(s.melee_kills, 0) as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id`,
      snapshotField: 'melee_kills',
      value: (delta) => Math.trunc(delta),
      format: (delta) => `+${Math.trunc(delta)} melee kills`,
    },
  },
  {
    key: 'archers',
    label: 'Top Archers',
    allTime: {
      sql: `SELECT u.name as Name, s.archery_kills as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.archery_kills > 0 ORDER BY s.archery_kills DESC LIMIT @limit`,
      value: (score) => Math.trunc(score),
      format: (score) => `${Math.trunc(score)} bow kills`,
    },
    weekly: {
      type: 'simple',
      currentSql: `SELECT u.id as Id, u.name as Name, COALESCE(s.archery_kills, 0) as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id`,
      snapshotField: 'archery_kills',
      value: (delta) => Math.trunc(delta),
      format: (delta) => `+${Math.trunc(delta)} bow kills`,
    },
  },
  {
    key: 'survivors',
    label: 'Top Survivors',
    allTime: {
      sql: `SELECT u.name as Name, s.minutes_survived as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.minutes_survived > 0 ORDER BY s.minutes_survived DESC LIMIT @limit`,
      value: (score) => score,
      format: (score) => `${round(score / 60, 1)}h survived`,
    },
    weekly: {
      type: 'simple',
      currentSql: `SELECT u.id as Id, u.name as Name, COALESCE(s.minutes_survived, 0) as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id`,
      snapshotField: 'minutes_survived',
      // minutes_survived is in minutes — convert to hours like the all-time format.
      value: (delta) => round(delta / 60, 1),
      format: (delta) => `+${round(delta / 60, 1)}h survived`,
    },
  },
  {
    key: 'medics',
    label: 'Top Medics',
    allTime: {
      sql: `SELECT u.name as Name, s.wounds_patched as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.wounds_patched > 0 ORDER BY s.wounds_patched DESC LIMIT @limit`,
      value: (score) => Math.trunc(score),
      format: (score) => `${Math.trunc(score)} wounds healed`,
    },
    weekly: {
      type: 'simple',
      currentSql: `SELECT u.id as Id, u.name as Name, COALESCE(s.wounds_patched, 0) as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id`,
      snapshotField: 'wounds_patched',
      value: (delta) => Math.trunc(delta),
      format: (delta) => `+${Math.trunc(delta)} wounds patched`,
    },
  },
  {
    key: 'looters',
    label: 'Top Looters',
    allTime: {
      sql: `SELECT u.name as Name, s.containers_looted as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.containers_looted > 0 ORDER BY s.containers_looted DESC LIMIT @limit`,
      value: (score) => Math.trunc(score),
      format: (score) => `${Math.trunc(score)} containers`,
    },
    weekly: {
      type: 'simple',
      currentSql: `SELECT u.id as Id, u.name as Name, COALESCE(s.containers_looted, 0) as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id`,
      snapshotField: 'containers_looted',
      value: (delta) => Math.trunc(delta),
      format: (delta) => `+${Math.trunc(delta)} containers`,
    },
  },
  {
    key: 'all_crafters',
    label: 'Top All-Round Crafters',
    allTime: {
      sql: `SELECT u.name as Name, (COALESCE(s.guns_crafted, 0) + COALESCE(s.bullets_crafted, 0) + COALESCE(s.arrows_crafted, 0) + COALESCE(s.clothing_crafted, 0)) as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE (COALESCE(s.guns_crafted, 0) + COALESCE(s.bullets_crafted, 0) + COALESCE(s.arrows_crafted, 0) + COALESCE(s.clothing_crafted, 0)) > 0 ORDER BY Score DESC LIMIT @limit`,
      value: (score) => Math.trunc(score),
      format: (score) => `${Math.trunc(score)} items crafted`,
    },
    weekly: {
      // "all_crafters" has no Format-WeeklyValue case -> default "+$Value".
      type: 'sum',
      currentSql: `SELECT u.id as Id, u.name as Name, (COALESCE(s.guns_crafted, 0) + COALESCE(s.bullets_crafted, 0) + COALESCE(s.arrows_crafted, 0) + COALESCE(s.clothing_crafted, 0)) as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id`,
      snapshotFields: ['guns_crafted', 'bullets_crafted', 'arrows_crafted', 'clothing_crafted'],
      value: (delta) => Math.trunc(delta),
      format: (delta) => `+${Math.trunc(delta)}`,
    },
  },
];

const CATEGORIES_BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

module.exports = { CATEGORIES, CATEGORIES_BY_KEY, round };
