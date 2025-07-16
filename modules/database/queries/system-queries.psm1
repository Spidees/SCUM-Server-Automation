# ===============================================================
# SCUM Server Automation - Database System Queries
# ===============================================================
# SQL queries for system operations and database management
# Provides database discovery, utility functions, and admin tools
# ===============================================================

# Queries for system operations, discovery, and utility functions
$script:SystemQueries = @{
    
    # Database discovery
    GetTables = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    
    GetTableSchema = "PRAGMA table_info(@tablename)"
    
    GetTableCreationSQL = "SELECT sql FROM sqlite_master WHERE type='table' AND name = @tablename"
    
    GetRowCount = "SELECT COUNT(*) as RowCount FROM [@tablename]"
    
    GetSampleData = "SELECT * FROM [@tablename] LIMIT @limit"
    
    # Database metadata
    GetDatabaseInfo = @(
        "SELECT 
         (SELECT COUNT(*) FROM sqlite_master WHERE type='table') as table_count,
         (SELECT COUNT(*) FROM sqlite_master WHERE type='index') as index_count,
         (SELECT COUNT(*) FROM sqlite_master WHERE type='view') as view_count,
         (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger') as trigger_count"
    )
    
    GetTableSizes = @(
        "SELECT 
         name as table_name,
         'table' as type
         FROM sqlite_master 
         WHERE type='table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name"
    )
    
    # Admin and elevated users
    GetElevatedUsers = @(
        "SELECT * FROM elevated_users ORDER BY user_id"
    )
    
    GetElevatedUserById = @(
        "SELECT * FROM elevated_users WHERE user_id = @user_id"
    )
    
    # System penalties and punishments
    GetSquadPenalties = @(
        "SELECT * FROM penalty_squad_leave_info ORDER BY squadmates_left DESC LIMIT @limit"
    )
    
    GetSquadPenaltyByUser = @(
        "SELECT * FROM penalty_squad_leave_info WHERE user_id = @user_id"
    )
    
    GetPenaltyStats = @(
        "SELECT 
         COUNT(*) as total_penalties,
         AVG(squadmates_left) as avg_squadmates_left,
         MAX(squadmates_left) as max_squadmates_left,
         COUNT(DISTINCT user_id) as penalized_users
         FROM penalty_squad_leave_info"
    )
    
    # Entity system
    GetEntitySystems = @(
        "SELECT * FROM entity_system ORDER BY map_id, id LIMIT @limit"
    )
    
    GetEntitySystemByMap = @(
        "SELECT * FROM entity_system WHERE map_id = @map_id ORDER BY id"
    )
    
    GetEntitySystemStats = @(
        "SELECT 
         COUNT(*) as total_entity_systems,
         COUNT(DISTINCT map_id) as maps_with_entities,
         AVG(latest_fake_entity_id) as avg_fake_entity_id,
         MAX(latest_fake_entity_id) as max_fake_entity_id
         FROM entity_system"
    )
    
    # System health and monitoring
    CheckDatabaseIntegrity = "PRAGMA integrity_check"
    
    GetDatabaseVersion = "PRAGMA user_version"
    
    GetPageCount = "PRAGMA page_count"
    
    GetPageSize = "PRAGMA page_size"
    
    GetCacheSize = "PRAGMA cache_size"
    
    # Performance and optimization
    AnalyzeDatabase = "ANALYZE"
    
    VacuumDatabase = "VACUUM"
    
    GetIndexList = @(
        "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name, name"
    )
    
    # Data validation queries
    ValidatePlayerData = @(
        "SELECT 
         COUNT(*) as total_players,
         COUNT(CASE WHEN steam_id IS NOT NULL AND steam_id != '' THEN 1 END) as players_with_steam_id,
         COUNT(CASE WHEN player_name IS NOT NULL AND player_name != '' THEN 1 END) as players_with_names
         FROM user_profile"
    )
    
    ValidateEventData = @(
        "SELECT 
         COUNT(*) as total_events,
         COUNT(CASE WHEN start_time IS NOT NULL THEN 1 END) as events_with_start_time,
         COUNT(CASE WHEN end_time IS NOT NULL THEN 1 END) as events_with_end_time
         FROM event_round"
    )
    
    ValidateTradingData = @(
        "SELECT 
         COUNT(*) as total_traders,
         COUNT(CASE WHEN map_id IS NOT NULL THEN 1 END) as traders_with_map,
         COUNT(DISTINCT map_id) as unique_maps
         FROM economy_traders"
    )
    
    # Cleanup and maintenance
    GetOrphanedRecords = @(
        "SELECT 'event_round_stats' as table_name, COUNT(*) as orphaned_count
         FROM event_round_stats ers
         WHERE NOT EXISTS (SELECT 1 FROM event_round er WHERE er.id = ers.round_id)
         UNION ALL
         SELECT 'economy_tradeables_info' as table_name, COUNT(*) as orphaned_count
         FROM economy_tradeables_info eti
         WHERE NOT EXISTS (SELECT 1 FROM economy_traders et WHERE et.id = eti.trader_id)"
    )
    
    GetDuplicateRecords = @(
        "SELECT 
         'user_profile' as table_name,
         steam_id,
         COUNT(*) as duplicate_count
         FROM user_profile 
         GROUP BY steam_id 
         HAVING COUNT(*) > 1
         UNION ALL
         SELECT 
         'elevated_users' as table_name,
         user_id,
         COUNT(*) as duplicate_count
         FROM elevated_users 
         GROUP BY user_id 
         HAVING COUNT(*) > 1"
    )
    
    # Export and backup helpers
    GetTableRowCounts = @(
        "SELECT 
         'user_profile' as table_name, COUNT(*) as row_count FROM user_profile
         UNION ALL SELECT 
         'events_stats' as table_name, COUNT(*) as row_count FROM events_stats
         UNION ALL SELECT 
         'economy_traders' as table_name, COUNT(*) as row_count FROM economy_traders
         UNION ALL SELECT 
         'base_raid_protection_manager' as table_name, COUNT(*) as row_count FROM base_raid_protection_manager
         UNION ALL SELECT 
         'event_round' as table_name, COUNT(*) as row_count FROM event_round
         ORDER BY row_count DESC"
    )
    
    GetLargestTables = @(
        "SELECT name as table_name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    
    # Quick health check
    QuickHealthCheck = @(
        "SELECT 
         (SELECT COUNT(*) FROM user_profile) as total_players,
         (SELECT COUNT(*) FROM economy_traders) as total_traders,
         (SELECT COUNT(*) FROM event) as total_events,
         (SELECT COUNT(*) FROM base_raid_protection_manager) as total_protected_bases,
         (SELECT COUNT(*) FROM global_radiation_data) as total_radiation_events"
    )
}

Export-ModuleMember -Variable SystemQueries
