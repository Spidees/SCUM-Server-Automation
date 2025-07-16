# ===============================================================
# SCUM Server Automation - Database Base Queries
# ===============================================================
# SQL queries for player bases, structures, and raid protection
# Provides base management and raid protection data access
# ===============================================================

# Queries for bases, structures, and raid protection
$script:BaseQueries = @{
    
    # Player bases and structures
    GetPlayerBases = @(
        "SELECT * FROM base_raid_protection_manager WHERE user_profile_id = @player_id"
    )
    
    GetPlayerDoors = @(
        "SELECT * FROM door_locking_registry_data WHERE user_profile_id = @player_id"
    )
    
    # Raid protection status
    GetAllRaidProtection = @(
        "SELECT 
         user_profile_id,
         protection_type,
         map_id
         FROM base_raid_protection_manager 
         ORDER BY user_profile_id"
    )
    
    GetRaidProtectionByMap = @(
        "SELECT * FROM base_raid_protection_manager 
         WHERE map_id = @map_id
         ORDER BY protection_type"
    )
    
    GetRaidProtectionByType = @(
        "SELECT * FROM base_raid_protection_manager 
         WHERE protection_type = @protection_type
         ORDER BY user_profile_id"
    )
    
    # Door and lock information
    GetAllDoorLocks = @(
        "SELECT * FROM door_locking_registry_data ORDER BY user_profile_id LIMIT @limit"
    )
    
    GetDoorsByAsset = @(
        "SELECT * FROM door_locking_registry_data 
         WHERE asset = @asset_type
         ORDER BY count DESC"
    )
    
    GetDoorsByType = @(
        "SELECT * FROM door_locking_registry_data 
         WHERE type = @door_type
         ORDER BY user_profile_id"
    )
    
    GetDoorsByMap = @(
        "SELECT * FROM door_locking_registry_data 
         WHERE map_id = @map_id
         ORDER BY user_profile_id"
    )
    
    # Base statistics
    GetBaseStats = @(
        "SELECT 
         COUNT(*) as total_protected_bases,
         COUNT(DISTINCT user_profile_id) as players_with_bases,
         COUNT(DISTINCT map_id) as maps_with_bases
         FROM base_raid_protection_manager"
    )
    
    GetProtectionTypeStats = @(
        "SELECT 
         protection_type,
         COUNT(*) as bases_count,
         COUNT(DISTINCT user_profile_id) as players_count,
         COUNT(DISTINCT map_id) as maps_count
         FROM base_raid_protection_manager 
         GROUP BY protection_type
         ORDER BY bases_count DESC"
    )
    
    GetDoorStats = @(
        "SELECT 
         COUNT(*) as total_doors,
         COUNT(DISTINCT user_profile_id) as players_with_doors,
         COUNT(DISTINCT asset) as door_types,
         SUM(count) as total_door_count
         FROM door_locking_registry_data"
    )
    
    GetDoorTypeStats = @(
        "SELECT 
         asset as door_asset,
         type as door_type,
         COUNT(*) as installations,
         SUM(count) as total_doors,
         AVG(count) as avg_doors_per_player
         FROM door_locking_registry_data 
         GROUP BY asset, type
         ORDER BY total_doors DESC"
    )
    
    # Map-based statistics
    GetBasesByMap = @(
        "SELECT 
         map_id,
         COUNT(*) as protected_bases,
         COUNT(DISTINCT user_profile_id) as players_count
         FROM base_raid_protection_manager 
         GROUP BY map_id
         ORDER BY protected_bases DESC"
    )
    
    GetDoorsByMap_Stats = @(
        "SELECT 
         map_id,
         COUNT(*) as door_installations,
         COUNT(DISTINCT user_profile_id) as players_count,
         SUM(count) as total_doors
         FROM door_locking_registry_data 
         GROUP BY map_id
         ORDER BY total_doors DESC"
    )
    
    # Player base activity
    GetTopBaseBuilders = @(
        "SELECT 
         user_profile_id,
         COUNT(*) as protected_bases_count,
         GROUP_CONCAT(DISTINCT protection_type) as protection_types
         FROM base_raid_protection_manager 
         GROUP BY user_profile_id
         ORDER BY protected_bases_count DESC LIMIT @limit"
    )
    
    GetTopDoorBuilders = @(
        "SELECT 
         user_profile_id,
         COUNT(*) as door_types_count,
         SUM(count) as total_doors,
         COUNT(DISTINCT map_id) as maps_count
         FROM door_locking_registry_data 
         GROUP BY user_profile_id
         ORDER BY total_doors DESC LIMIT @limit"
    )
    
    # Security and protection analysis
    GetUnprotectedPlayers = @(
        "SELECT DISTINCT user_profile_id 
         FROM door_locking_registry_data 
         WHERE user_profile_id NOT IN (
             SELECT user_profile_id FROM base_raid_protection_manager
         )"
    )
    
    GetHighSecurityBases = @(
        "SELECT 
         brpm.user_profile_id,
         brpm.protection_type,
         dlrd.total_doors,
         dlrd.door_types
         FROM base_raid_protection_manager brpm
         LEFT JOIN (
             SELECT 
                 user_profile_id,
                 SUM(count) as total_doors,
                 COUNT(DISTINCT asset) as door_types
             FROM door_locking_registry_data 
             GROUP BY user_profile_id
         ) dlrd ON brpm.user_profile_id = dlrd.user_profile_id
         WHERE dlrd.total_doors > @min_doors
         ORDER BY dlrd.total_doors DESC"
    )
}

Export-ModuleMember -Variable BaseQueries
