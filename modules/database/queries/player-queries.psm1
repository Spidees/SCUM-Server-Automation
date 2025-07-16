# ===============================================================
# SCUM Server Automation - Database Player Queries
# ===============================================================
# SQL queries for player information and statistics
# Provides player data access for leaderboards and profiles
# ===============================================================

# Queries for player information and statistics
$script:PlayerQueries = @{
    
    # Basic player info
    GetPlayerInfo = @(
        "SELECT * FROM user_profile WHERE steam_id = @steam_id",
        "SELECT * FROM user WHERE steam_id = @steam_id",
        "SELECT * FROM Players WHERE SteamID = @steam_id"
    )
    
    GetPlayerByName = @(
        "SELECT * FROM user_profile WHERE player_name LIKE @name",
        "SELECT * FROM user WHERE player_name LIKE @name", 
        "SELECT * FROM Players WHERE PlayerName LIKE @name"
    )
    
    GetOnlinePlayers = @(
        "SELECT * FROM user_profile WHERE is_online = 1 ORDER BY player_name",
        "SELECT * FROM user WHERE online_status = 1 ORDER BY player_name",
        "SELECT * FROM Players WHERE IsOnline = 1 ORDER BY PlayerName"
    )
    
    GetAllPlayers = @(
        "SELECT * FROM user_profile ORDER BY player_name LIMIT @limit",
        "SELECT * FROM user ORDER BY player_name LIMIT @limit",
        "SELECT * FROM Players ORDER BY PlayerName LIMIT @limit"
    )
    
    # Player statistics
    GetPlayerStats = @(
        "SELECT 
         user_profile_id,
         events_won, events_lost,
         enemy_kills, deaths,
         ctf_captures, ctf_flag_returns
         FROM events_stats WHERE user_profile_id = @player_id"
    )
    
    GetPlayerEventStats = @(
        "SELECT 
         user_profile_id,
         score, enemy_kills, team_kills, deaths, suicides, assists
         FROM event_round_stats WHERE user_profile_id = @player_id
         ORDER BY round_id DESC LIMIT @limit"
    )
    
    GetPlayerDMStats = @(
        "SELECT 
         user_profile_id,
         longest_headshot, melee_kills, longest_life
         FROM event_round_stats_dm WHERE user_profile_id = @player_id
         ORDER BY round_id DESC LIMIT @limit"
    )
    
    # Player activity
    GetRecentConnections = @(
        "SELECT * FROM user_profile WHERE last_login > datetime('now', '-@hours hours') ORDER BY last_login DESC",
        "SELECT * FROM Players WHERE LastLogin > datetime('now', '-@hours hours') ORDER BY LastLogin DESC"
    )
    
    GetPlayerHistory = @(
        "SELECT 
         'login' as activity_type, last_login as timestamp
         FROM user_profile WHERE user_profile_id = @player_id
         UNION ALL
         SELECT 
         'event' as activity_type, er.start_time as timestamp
         FROM event_round_stats ers
         JOIN event_round er ON ers.round_id = er.id
         WHERE ers.user_profile_id = @player_id
         ORDER BY timestamp DESC LIMIT @limit"
    )
    
    # Player search and filtering
    SearchPlayers = @(
        "SELECT * FROM user_profile WHERE 
         player_name LIKE @search OR 
         steam_id LIKE @search
         ORDER BY player_name LIMIT @limit"
    )
    
    GetPlayersByLevel = @(
        "SELECT * FROM user_profile WHERE level BETWEEN @min_level AND @max_level ORDER BY level DESC LIMIT @limit"
    )
    
    GetPlayersByPlaytime = @(
        "SELECT * FROM user_profile WHERE playtime > @min_playtime ORDER BY playtime DESC LIMIT @limit"
    )
    
    # Player counts and statistics
    GetPlayerCounts = @(
        "SELECT 
         COUNT(*) as total_players,
         COUNT(CASE WHEN is_online = 1 THEN 1 END) as online_players,
         COUNT(CASE WHEN last_login > datetime('now', '-24 hours') THEN 1 END) as active_today
         FROM user_profile"
    )
}

Export-ModuleMember -Variable PlayerQueries
