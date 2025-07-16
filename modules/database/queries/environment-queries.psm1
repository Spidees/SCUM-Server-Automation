# ===============================================================
# SCUM Server Automation - Database Environment Queries
# ===============================================================
# SQL queries for world environment, weather, and map data
# Provides access to game world state and environmental information
# ===============================================================

# Queries for map, weather, radiation, and bunkers
$script:EnvironmentQueries = @{
    
    # Map information
    GetAllMaps = @(
        "SELECT * FROM map ORDER BY id"
    )
    
    GetMapById = @(
        "SELECT * FROM map WHERE id = @map_id"
    )
    
    # Radiation data
    GetRadiationData = @(
        "SELECT * FROM global_radiation_data ORDER BY timestamp DESC LIMIT @limit"
    )
    
    GetRadiationByMap = @(
        "SELECT * FROM global_radiation_data 
         WHERE map_id = @map_id
         ORDER BY timestamp DESC LIMIT @limit"
    )
    
    GetRadiationByPlayer = @(
        "SELECT * FROM global_radiation_data 
         WHERE user_profile_id = @player_id
         ORDER BY timestamp DESC LIMIT @limit"
    )
    
    GetRecentRadiation = @(
        "SELECT * FROM global_radiation_data 
         WHERE timestamp > @since_timestamp
         ORDER BY timestamp DESC"
    )
    
    GetCurrentRadiation = @(
        "SELECT 
         map_id,
         MAX(timestamp) as latest_timestamp,
         user_profile_id
         FROM global_radiation_data 
         GROUP BY map_id
         ORDER BY latest_timestamp DESC"
    )
    
    # Bunker information
    GetAllBunkers = @(
        "SELECT 
         bunker_id,
         COUNT(*) as alarmed_rooms,
         AVG(alarm_time_remaining) as avg_alarm_time,
         MAX(alarm_time_remaining) as max_alarm_time
         FROM abandoned_bunker_alarmed_room 
         GROUP BY bunker_id
         ORDER BY bunker_id"
    )
    
    GetBunkerById = @(
        "SELECT * FROM abandoned_bunker_alarmed_room 
         WHERE bunker_id = @bunker_id
         ORDER BY room_name"
    )
    
    GetBunkerAlarms = @(
        "SELECT 
         bunker_id,
         room_name,
         alarm_time_remaining,
         CASE 
             WHEN alarm_time_remaining > 0 THEN 'ACTIVE' 
             ELSE 'INACTIVE' 
         END as alarm_status
         FROM abandoned_bunker_alarmed_room
         ORDER BY alarm_time_remaining DESC"
    )
    
    GetActiveBunkerAlarms = @(
        "SELECT * FROM abandoned_bunker_alarmed_room 
         WHERE alarm_time_remaining > 0
         ORDER BY alarm_time_remaining DESC"
    )
    
    GetBunkersByAlarmStatus = @(
        "SELECT 
         bunker_id,
         COUNT(*) as total_rooms,
         COUNT(CASE WHEN alarm_time_remaining > 0 THEN 1 END) as active_alarms,
         COUNT(CASE WHEN alarm_time_remaining = 0 THEN 1 END) as inactive_alarms
         FROM abandoned_bunker_alarmed_room 
         GROUP BY bunker_id
         ORDER BY active_alarms DESC"
    )
    
    # Environment statistics
    GetRadiationStats = @(
        "SELECT 
         COUNT(*) as total_radiation_events,
         COUNT(DISTINCT map_id) as maps_with_radiation,
         COUNT(DISTINCT user_profile_id) as players_affected,
         MIN(timestamp) as first_event,
         MAX(timestamp) as latest_event
         FROM global_radiation_data"
    )
    
    GetRadiationByMap_Stats = @(
        "SELECT 
         map_id,
         COUNT(*) as radiation_events,
         COUNT(DISTINCT user_profile_id) as players_affected,
         MIN(timestamp) as first_event,
         MAX(timestamp) as latest_event
         FROM global_radiation_data 
         GROUP BY map_id
         ORDER BY radiation_events DESC"
    )
    
    GetBunkerStats = @(
        "SELECT 
         COUNT(DISTINCT bunker_id) as total_bunkers,
         COUNT(*) as total_rooms,
         COUNT(CASE WHEN alarm_time_remaining > 0 THEN 1 END) as active_alarms,
         AVG(alarm_time_remaining) as avg_alarm_time,
         MAX(alarm_time_remaining) as max_alarm_time
         FROM abandoned_bunker_alarmed_room"
    )
    
    # Entity cleanup information
    GetEntitiesToDelete = @(
        "SELECT * FROM entity_to_delete_on_startup ORDER BY entity_id LIMIT @limit"
    )
    
    GetEntityDeleteCount = @(
        "SELECT COUNT(*) as entities_to_delete FROM entity_to_delete_on_startup"
    )
    
    # Environment trends and analysis
    GetRadiationTrends = @(
        "SELECT 
         DATE(datetime(timestamp, 'unixepoch')) as radiation_date,
         COUNT(*) as events_count,
         COUNT(DISTINCT map_id) as maps_affected,
         COUNT(DISTINCT user_profile_id) as players_affected
         FROM global_radiation_data 
         WHERE timestamp > @since_timestamp
         GROUP BY DATE(datetime(timestamp, 'unixepoch'))
         ORDER BY radiation_date DESC"
    )
    
    GetBunkerActivity = @(
        "SELECT 
         bunker_id,
         COUNT(*) as rooms_count,
         AVG(alarm_time_remaining) as avg_alarm_time,
         COUNT(CASE WHEN alarm_time_remaining > 0 THEN 1 END) as active_rooms,
         ROUND(
             (COUNT(CASE WHEN alarm_time_remaining > 0 THEN 1 END) * 100.0) / COUNT(*), 
             2
         ) as activity_percentage
         FROM abandoned_bunker_alarmed_room 
         GROUP BY bunker_id
         ORDER BY activity_percentage DESC"
    )
    
    # Map activity overview
    GetMapActivity = @(
        "SELECT 
         m.id as map_id,
         COALESCE(r.radiation_events, 0) as radiation_events,
         COALESCE(b.bunker_count, 0) as bunker_count,
         COALESCE(t.trader_count, 0) as trader_count,
         COALESCE(p.player_count, 0) as player_count
         FROM map m
         LEFT JOIN (
             SELECT map_id, COUNT(*) as radiation_events 
             FROM global_radiation_data 
             GROUP BY map_id
         ) r ON m.id = r.map_id
         LEFT JOIN (
             SELECT COUNT(DISTINCT bunker_id) as bunker_count 
             FROM abandoned_bunker_alarmed_room
         ) b ON 1=1
         LEFT JOIN (
             SELECT map_id, COUNT(*) as trader_count 
             FROM economy_traders 
             GROUP BY map_id
         ) t ON m.id = t.map_id
         LEFT JOIN (
             SELECT COUNT(*) as player_count 
             FROM user_profile
         ) p ON 1=1
         ORDER BY m.id"
    )
    
    # Environmental hazards
    GetEnvironmentalHazards = @(
        "SELECT 
         'radiation' as hazard_type,
         map_id,
         COUNT(*) as events,
         MAX(timestamp) as last_occurrence
         FROM global_radiation_data 
         GROUP BY map_id
         UNION ALL
         SELECT 
         'bunker_alarms' as hazard_type,
         NULL as map_id,
         COUNT(*) as events,
         NULL as last_occurrence
         FROM abandoned_bunker_alarmed_room 
         WHERE alarm_time_remaining > 0
         ORDER BY hazard_type, map_id"
    )
}

Export-ModuleMember -Variable EnvironmentQueries
