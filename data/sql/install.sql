CREATE TABLE IF NOT EXISTS a_discord_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_user_id TEXT NOT NULL UNIQUE,
    discord_username TEXT NOT NULL,
    user_id TEXT,
    steam_id TEXT NOT NULL UNIQUE,
    player_name TEXT NOT NULL,
    linked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    notifications_enabled INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS a_pending_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    registration_code TEXT NOT NULL UNIQUE,
    discord_user_id TEXT NOT NULL,
    discord_username TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS a_notification_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_user_id TEXT NOT NULL,
    notification_type TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(discord_user_id, notification_type)
);

CREATE TABLE a_user_profile (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id						TEXT,
	steam_id						TEXT,    
	user_name						TEXT,
	user_ip				TEXT,
    flag_id INTEGER,    
	last_login_time				TEXT,
	last_logout_time				TEXT,
    user_is_online INTEGER DEFAULT 0, -- 1 for online, 0 for offline
    last_update DATETIME DEFAULT CURRENT_TIMESTAMP    
);

CREATE TABLE IF NOT EXISTS a_raid_protection (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flag_id INTEGER NOT NULL,
    owner_user_id INTEGER NOT NULL,        
    location_x REAL,
    location_y REAL,
    location_z REAL,
    protection_type TEXT NOT NULL, -- 'set', 'finished', 'started'
    protection_duration INTEGER, -- duration in seconds
    start_delay INTEGER, -- delay before protection starts in seconds
    last_logged_in_user_id INTEGER, -- user who logged in (for finished events)
    reason TEXT, -- additional info like "all flag owners offline" or "user logged in"
    last_update DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS a_vehicle_destruction (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL,  
    vehicle_type TEXT NOT NULL,
    owner_user_id INTEGER,
    location_x REAL,
    location_y REAL,
    location_z REAL,
    reason TEXT NOT NULL, -- 'Destroyed', 'Disappeared', 'VehicleInactiveTimerReached'    
    last_update  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS a_chest_ownership (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chest_entity_id INTEGER NOT NULL,
    owner_user_id INTEGER,
    owner_steam_id TEXT,
    owner_player_name TEXT,
    event_type TEXT NOT NULL, -- 'claimed', 'changed'
    old_owner_steam_id TEXT, -- for ownership changes
    old_owner_user_id INTEGER, -- for ownership changes
    old_owner_player_name TEXT, -- for ownership changes
    location_x REAL,
    location_y REAL,
    location_z REAL,
    last_update DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS a_bunker_lock (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bunker_name TEXT NOT NULL, -- 'A1', 'A3', 'C4', 'D1', etc.    
    activation_time_ago TEXT, -- e.g., '02h 04m 23s ago', '00h 00m 00s ago'
    location_x REAL,
    location_y REAL,
    location_z REAL,
    status TEXT, -- 'Active', 'Locked', etc.
    last_update DATETIME DEFAULT CURRENT_TIMESTAMP
);


CREATE INDEX idx_pending_registrations_code ON a_pending_registrations(registration_code);
CREATE INDEX idx_pending_registrations_discord_id ON a_pending_registrations(discord_user_id);
CREATE INDEX idx_notification_preferences_user ON a_notification_preferences(discord_user_id, notification_type);
CREATE INDEX idx_discord_profiles_discord_id ON a_discord_profiles(discord_user_id);
CREATE INDEX idx_discord_profiles_steam_id ON a_discord_profiles(steam_id);
CREATE INDEX idx_discord_profiles_user_id ON a_discord_profiles(user_id);
CREATE INDEX idx_user_profile_user_id ON a_user_profile(user_id);
CREATE INDEX idx_raid_protection_flag_id ON a_raid_protection(flag_id);
CREATE INDEX idx_raid_protection_owner_user_id ON a_raid_protection(owner_user_id);
CREATE INDEX idx_raid_protection_last_update ON a_raid_protection(last_update);
CREATE INDEX idx_raid_protection_protection_type ON a_raid_protection(protection_type);
CREATE INDEX idx_vehicle_destruction_vehicle_id ON a_vehicle_destruction(vehicle_id);
CREATE INDEX idx_vehicle_destruction_owner_user_id ON a_vehicle_destruction(owner_user_id);
CREATE INDEX idx_vehicle_destruction_last_update ON a_vehicle_destruction(last_update);
CREATE INDEX idx_vehicle_destruction_reason ON a_vehicle_destruction(reason);
CREATE INDEX idx_vehicle_destruction_vehicle_type ON a_vehicle_destruction(vehicle_type);
CREATE INDEX idx_chest_ownership_chest_entity_id ON a_chest_ownership(chest_entity_id);
CREATE INDEX idx_chest_ownership_owner_steam_id ON a_chest_ownership(owner_steam_id);
CREATE INDEX idx_chest_ownership_last_update ON a_chest_ownership(last_update);
CREATE INDEX idx_chest_ownership_event_type ON a_chest_ownership(event_type);
CREATE INDEX idx_chest_ownership_owner_user_id ON a_chest_ownership(owner_user_id);
CREATE INDEX idx_bunker_lock_bunker_name ON a_bunker_lock(bunker_name);
CREATE INDEX idx_bunker_lock_last_update ON a_bunker_lock(last_update);
CREATE INDEX idx_bunker_lock_status ON a_bunker_lock(status);

-- Copy data from user_profile to a_user_profile with column mapping
INSERT OR IGNORE INTO a_user_profile (
    user_id,           -- maps to user_profile.id
    steam_id,          -- maps to user_profile.user_id
    user_name,         -- maps to user_profile.name
    user_ip,           -- maps to user_profile.authority_ip
    flag_id,           -- maps to user_profile.type
    last_login_time,   -- maps to user_profile.last_login_time
    last_logout_time,  -- maps to user_profile.last_logout_time
    user_is_online,    -- set to 0 (offline) for initial data
    last_update        -- set to current timestamp
)
SELECT 
    up.id,             -- user_profile.id -> a_user_profile.user_id
    up.user_id,        -- user_profile.user_id -> a_user_profile.steam_id
    up.name,           -- user_profile.name -> a_user_profile.user_name
    up.authority_ip,   -- user_profile.authority_ip -> a_user_profile.user_ip
    NULL,           -- user_profile.type -> a_user_profile.flag_id
    up.last_login_time,    -- user_profile.last_login_time -> a_user_profile.last_login_time
    up.last_logout_time,   -- user_profile.last_logout_time -> a_user_profile.last_logout_time
    0,  -- user_is_online = 0 (all offline initially)
    CURRENT_TIMESTAMP  -- last_update
FROM user_profile up
WHERE up.user_id IS NOT NULL 
  AND up.user_id != '';


