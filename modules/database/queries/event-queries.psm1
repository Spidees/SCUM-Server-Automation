# ===============================================================
# SCUM Server Automation - Database Event Queries
# ===============================================================
# SQL queries for server events, rounds, and event statistics
# Provides access to game events and competition data
# ===============================================================

# Queries for events, rounds, and event statistics
$script:EventQueries = @{
    
    # Basic event information
    GetAllEvents = @(
        "SELECT * FROM event ORDER BY id DESC LIMIT @limit"
    )
    
    GetEventById = @(
        "SELECT * FROM event WHERE id = @event_id"
    )
    
    GetRecentEvents = @(
        "SELECT * FROM event 
         WHERE id IN (
             SELECT DISTINCT event_id FROM event_round 
             WHERE start_time > datetime('now', '-@days days')
         )
         ORDER BY id DESC LIMIT @limit"
    )
    
    # Event rounds
    GetEventRounds = @(
        "SELECT * FROM event_round WHERE event_id = @event_id ORDER BY start_time DESC"
    )
    
    GetRecentRounds = @(
        "SELECT * FROM event_round 
         WHERE start_time > datetime('now', '-@days days')
         ORDER BY start_time DESC LIMIT @limit"
    )
    
    GetActiveRounds = @(
        "SELECT * FROM event_round 
         WHERE end_time IS NULL OR end_time = ''
         ORDER BY start_time DESC"
    )
    
    GetRoundById = @(
        "SELECT * FROM event_round WHERE id = @round_id"
    )
    
    # Event statistics and leaderboards
    GetEventLeaderboard = @(
        "SELECT 
         ers.user_profile_id,
         ers.score,
         ers.enemy_kills,
         ers.deaths,
         ers.assists,
         ers.team_kills,
         ers.suicides
         FROM event_round_stats ers
         JOIN event_round er ON ers.round_id = er.id
         WHERE er.event_id = @event_id
         ORDER BY ers.score DESC LIMIT @limit"
    )
    
    GetRoundLeaderboard = @(
        "SELECT 
         user_profile_id,
         score,
         enemy_kills,
         deaths,
         assists
         FROM event_round_stats 
         WHERE round_id = @round_id
         ORDER BY score DESC LIMIT @limit"
    )
    
    GetDMLeaderboard = @(
        "SELECT 
         ersm.user_profile_id,
         ersm.longest_headshot,
         ersm.melee_kills,
         ersm.longest_life
         FROM event_round_stats_dm ersm
         JOIN event_round er ON ersm.round_id = er.id
         WHERE er.event_id = @event_id
         ORDER BY ersm.longest_headshot DESC LIMIT @limit"
    )
    
    # Player event performance
    GetPlayerEventStats = @(
        "SELECT 
         ers.round_id,
         er.event_id,
         er.start_time,
         er.end_time,
         ers.score,
         ers.enemy_kills,
         ers.deaths,
         ers.assists
         FROM event_round_stats ers
         JOIN event_round er ON ers.round_id = er.id
         WHERE ers.user_profile_id = @player_id
         ORDER BY er.start_time DESC LIMIT @limit"
    )
    
    GetPlayerDMStats = @(
        "SELECT 
         ersm.round_id,
         er.event_id,
         er.start_time,
         ersm.longest_headshot,
         ersm.melee_kills,
         ersm.longest_life
         FROM event_round_stats_dm ersm
         JOIN event_round er ON ersm.round_id = er.id
         WHERE ersm.user_profile_id = @player_id
         ORDER BY er.start_time DESC LIMIT @limit"
    )
    
    GetPlayerBestScores = @(
        "SELECT 
         MAX(score) as best_score,
         MAX(enemy_kills) as best_kills,
         MIN(deaths) as best_deaths,
         MAX(assists) as best_assists
         FROM event_round_stats 
         WHERE user_profile_id = @player_id"
    )
    
    # Event statistics and analysis
    GetEventStats = @(
        "SELECT 
         COUNT(*) as total_events,
         COUNT(DISTINCT er.id) as total_rounds,
         COUNT(DISTINCT ers.user_profile_id) as unique_participants,
         AVG(ers.score) as avg_score,
         MAX(ers.score) as max_score
         FROM event e
         LEFT JOIN event_round er ON e.id = er.event_id
         LEFT JOIN event_round_stats ers ON er.id = ers.round_id"
    )
    
    GetRoundStats = @(
        "SELECT 
         er.id as round_id,
         er.event_id,
         COUNT(ers.user_profile_id) as participants,
         AVG(ers.score) as avg_score,
         MAX(ers.score) as max_score,
         SUM(ers.enemy_kills) as total_kills,
         SUM(ers.deaths) as total_deaths
         FROM event_round er
         LEFT JOIN event_round_stats ers ON er.id = ers.round_id
         WHERE er.id = @round_id
         GROUP BY er.id"
    )
    
    GetTopEventParticipants = @(
        "SELECT 
         user_profile_id,
         COUNT(DISTINCT round_id) as rounds_participated,
         COUNT(DISTINCT er.event_id) as events_participated,
         AVG(score) as avg_score,
         SUM(enemy_kills) as total_kills
         FROM event_round_stats ers
         JOIN event_round er ON ers.round_id = er.id
         GROUP BY user_profile_id
         ORDER BY rounds_participated DESC LIMIT @limit"
    )
    
    # Event participation analysis
    GetEventParticipation = @(
        "SELECT 
         er.event_id,
         COUNT(DISTINCT ers.user_profile_id) as unique_participants,
         COUNT(ers.round_id) as total_participations,
         AVG(ers.score) as avg_score
         FROM event_round er
         LEFT JOIN event_round_stats ers ON er.id = ers.round_id
         GROUP BY er.event_id
         ORDER BY unique_participants DESC"
    )
    
    GetRecentParticipants = @(
        "SELECT DISTINCT 
         ers.user_profile_id,
         er.start_time as last_participation
         FROM event_round_stats ers
         JOIN event_round er ON ers.round_id = er.id
         WHERE er.start_time > datetime('now', '-@days days')
         ORDER BY er.start_time DESC"
    )
    
    # Performance trends
    GetPlayerEventTrend = @(
        "SELECT 
         DATE(er.start_time) as event_date,
         COUNT(*) as rounds_played,
         AVG(ers.score) as avg_score,
         AVG(ers.enemy_kills) as avg_kills
         FROM event_round_stats ers
         JOIN event_round er ON ers.round_id = er.id
         WHERE ers.user_profile_id = @player_id
         AND er.start_time > datetime('now', '-@days days')
         GROUP BY DATE(er.start_time)
         ORDER BY event_date DESC"
    )
}

Export-ModuleMember -Variable EventQueries
