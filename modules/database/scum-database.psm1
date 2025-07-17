# ===============================================================
# SCUM Server Automation - Database Access
# ===============================================================
# SQLite database access for SCUM server statistics and data
# Provides player stats, leaderboards, and game data queries
# ===============================================================

#Requires -Version 5.1

# Import common module during initialization
function Import-CommonModule {
    <#
    .SYNOPSIS
    Import required common module for database operations
    #>
    $commonPath = Join-Path $PSScriptRoot "..\core\common\common.psm1"
    if (Test-Path $commonPath) {
        Import-Module $commonPath -Force -Global
    } else {
        throw "Cannot find common module at: $commonPath"
    }
}

# Module variables
$script:DatabaseConfig = $null
$script:DatabasePath = $null
$script:SqliteProvider = "External"  # Always use external sqlite3.exe
$script:SqliteExePath = $null        # Path to sqlite3.exe
$script:LastConnectionTest = [DateTime]::MinValue
$script:ConnectionTestInterval = 300 # 5 minutes
$script:PlayerCache = @{}
$script:PlayerCacheExpiry = [DateTime]::MinValue
$script:VehicleCache = @{}
$script:VehicleCacheExpiry = [DateTime]::MinValue

# Define all database queries directly in the database module for simplicity and reliability
$script:DatabaseQueries = @{
    
    # New Leaderboard Queries - 19 Categories for Weekly and All-Time
    GetTopKills = @(
        "SELECT u.name as Name, e.enemy_kills as Score FROM user_profile u LEFT JOIN events_stats e ON u.id = e.user_profile_id WHERE e.enemy_kills > 0 ORDER BY e.enemy_kills DESC LIMIT @limit"
    )
    GetTopDeaths = @(
        "SELECT u.name as Name, e.deaths as Score FROM user_profile u LEFT JOIN events_stats e ON u.id = e.user_profile_id WHERE e.deaths > 0 ORDER BY e.deaths DESC LIMIT @limit"
    )
    GetTopPlaytime = @(
        "SELECT name as Name, play_time as Score FROM user_profile WHERE play_time > 0 ORDER BY play_time DESC LIMIT @limit"
    )
    GetTopFame = @(
        "SELECT name as Name, fame_points as Score FROM user_profile WHERE fame_points > 0 ORDER BY fame_points DESC LIMIT @limit"
    )
    GetTopMoney = @(
        "SELECT u.name as Name, barc.account_balance as Score FROM user_profile u JOIN bank_account_registry bar ON u.id = bar.account_owner_user_profile_id JOIN bank_account_registry_currencies barc ON bar.id = barc.bank_account_id WHERE barc.currency_type = 1 AND barc.account_balance > 0 ORDER BY barc.account_balance DESC LIMIT @limit"
    )
    GetTopEvents = @(
        "SELECT u.name as Name, e.events_won as Score FROM user_profile u LEFT JOIN events_stats e ON u.id = e.user_profile_id WHERE e.events_won > 0 ORDER BY e.events_won DESC LIMIT @limit"
    )
    GetTopKDR = @(
        "SELECT u.name as Name, CASE WHEN e.deaths > 0 THEN CAST(e.enemy_kills AS REAL) / e.deaths ELSE e.enemy_kills END as Score FROM user_profile u LEFT JOIN events_stats e ON u.id = e.user_profile_id WHERE e.enemy_kills > 0 ORDER BY Score DESC LIMIT @limit"
    )
    GetTopHeadshots = @(
        "SELECT u.name as Name, s.headshots as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.headshots > 0 ORDER BY s.headshots DESC LIMIT @limit"
    )
    GetTopTeamKills = @(
        "SELECT u.name as Name, e.team_kills as Score FROM user_profile u LEFT JOIN events_stats e ON u.id = e.user_profile_id WHERE e.team_kills > 0 ORDER BY e.team_kills DESC LIMIT @limit"
    )
    GetTopAnimalKills = @(
        "SELECT u.name as Name, s.animals_killed as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.animals_killed > 0 ORDER BY s.animals_killed DESC LIMIT @limit"
    )
    GetTopPuppetKills = @(
        "SELECT u.name as Name, s.puppets_killed as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.puppets_killed > 0 ORDER BY s.puppets_killed DESC LIMIT @limit"
    )
    GetTopDroneKills = @(
        "SELECT u.name as Name, s.drone_kills as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.drone_kills > 0 ORDER BY s.drone_kills DESC LIMIT @limit"
    )
    GetTopSentriKills = @(
        "SELECT u.name as Name, s.sentry_kills as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.sentry_kills > 0 ORDER BY s.sentry_kills DESC LIMIT @limit"
    )
    GetTopLockpickers = @(
        "SELECT u.name as Name, s.locks_picked as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.locks_picked > 0 ORDER BY s.locks_picked DESC LIMIT @limit"
    )
    GetTopGunCrafters = @(
        "SELECT u.name as Name, s.guns_crafted as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.guns_crafted > 0 ORDER BY s.guns_crafted DESC LIMIT @limit"
    )
    GetTopBulletCrafters = @(
        "SELECT u.name as Name, s.bullets_crafted as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.bullets_crafted > 0 ORDER BY s.bullets_crafted DESC LIMIT @limit"
    )
    GetTopMeleeCrafters = @(
        "SELECT u.name as Name, s.melee_weapons_crafted as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.melee_weapons_crafted > 0 ORDER BY s.melee_weapons_crafted DESC LIMIT @limit"
    )
    GetTopClothingCrafters = @(
        "SELECT u.name as Name, s.clothing_crafted as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.clothing_crafted > 0 ORDER BY s.clothing_crafted DESC LIMIT @limit"
    )
    GetTopFishCatchers = @(
        "SELECT u.name as Name, f.fish_caught as Score FROM user_profile u LEFT JOIN fishing_stats f ON u.id = f.user_profile_id WHERE f.fish_caught > 0 ORDER BY f.fish_caught DESC LIMIT @limit"
    )
    GetTopSquadLeaders = @(
        "SELECT u.name as Name, COUNT(sm.user_profile_id) as Score FROM user_profile u LEFT JOIN squad_member sm ON u.id = sm.user_profile_id WHERE sm.rank = 4 GROUP BY u.id, u.name HAVING COUNT(sm.user_profile_id) > 0 ORDER BY Score DESC LIMIT @limit"
    )
    GetTopSquads = @(
        "SELECT name as Name, score as Score FROM squad WHERE score > 0 ORDER BY score DESC LIMIT @limit"
    )
    GetTopDistance = @(
        "SELECT u.name as Name, s.distance_travelled_by_foot as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.distance_travelled_by_foot > 0 ORDER BY s.distance_travelled_by_foot DESC LIMIT @limit"
    )
    GetTopSniper = @(
        "SELECT u.name as Name, s.longest_kill_distance as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.longest_kill_distance > 0 ORDER BY s.longest_kill_distance DESC LIMIT @limit"
    )
    GetTopMeleeWarriors = @(
        "SELECT u.name as Name, s.melee_kills as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.melee_kills > 0 ORDER BY s.melee_kills DESC LIMIT @limit"
    )
    GetTopArchers = @(
        "SELECT u.name as Name, s.archery_kills as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.archery_kills > 0 ORDER BY s.archery_kills DESC LIMIT @limit"
    )
    GetTopSurvivors = @(
        "SELECT u.name as Name, s.minutes_survived as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.minutes_survived > 0 ORDER BY s.minutes_survived DESC LIMIT @limit"
    )
    GetTopMedics = @(
        "SELECT u.name as Name, s.wounds_patched as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.wounds_patched > 0 ORDER BY s.wounds_patched DESC LIMIT @limit"
    )
    GetTopLooters = @(
        "SELECT u.name as Name, s.containers_looted as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.containers_looted > 0 ORDER BY s.containers_looted DESC LIMIT @limit"
    )
    GetTopAllCrafters = @(
        "SELECT u.name as Name, (COALESCE(s.guns_crafted, 0) + COALESCE(s.bullets_crafted, 0) + COALESCE(s.arrows_crafted, 0) + COALESCE(s.clothing_crafted, 0)) as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE (COALESCE(s.guns_crafted, 0) + COALESCE(s.bullets_crafted, 0) + COALESCE(s.arrows_crafted, 0) + COALESCE(s.clothing_crafted, 0)) > 0 ORDER BY Score DESC LIMIT @limit"
    )
    
    # Player queries
    GetOnlinePlayers = @(
        "SELECT name as PlayerName, user_id as SteamID, last_login_time, last_logout_time FROM user_profile WHERE last_login_time > last_logout_time OR last_logout_time IS NULL",
        "SELECT * FROM Players WHERE IsOnline = 1",
        "SELECT * FROM PlayerData WHERE Online = 1"
    )
    GetPlayerBySteamID = @(
        "SELECT * FROM user_profile WHERE user_id = '@steamid'",
        "SELECT * FROM Players WHERE SteamID = '@steamid'",
        "SELECT * FROM PlayerData WHERE Steam_ID = '@steamid'"
    )
    GetPlayerByName = @(
        "SELECT * FROM user_profile WHERE name = '@playername'",
        "SELECT * FROM Players WHERE PlayerName = '@playername' OR Name = '@playername'",
        "SELECT * FROM PlayerData WHERE PlayerName = '@playername' OR Name = '@playername'"
    )
    
    # Statistics queries
    GetTotalPlayerCount = @(
        "SELECT COUNT(*) as TotalCount FROM user_profile"
    )
    GetOnlinePlayerCount = @(
        "SELECT COUNT(*) as OnlineCount FROM user_profile WHERE last_login_time > last_logout_time OR last_logout_time IS NULL"
    )
    GetTotalKills = @(
        "SELECT SUM(enemy_kills) as total FROM events_stats"
    )
    GetTotalDeaths = @(
        "SELECT SUM(deaths) as total FROM events_stats"
    )
    GetTotalPlaytime = @(
        "SELECT SUM(play_time) as total FROM user_profile"
    )
    GetActiveSquadsCount = @(
        "SELECT COUNT(DISTINCT squad_id) as total FROM squad_member WHERE squad_id IS NOT NULL AND squad_id != ''"
    )
    GetVehicleCount = @(
        "SELECT COUNT(*) as VehicleCount FROM vehicle_entity",
        "SELECT COUNT(*) as VehicleCount FROM Vehicles WHERE IsDestroyed = 0"
    )
    GetBaseCount = @(
        "SELECT COUNT(*) as BaseCount FROM base",
        "SELECT COUNT(DISTINCT OwnerID) as BaseCount FROM Buildings WHERE IsDestroyed = 0"
    )
    
    # Game data queries
    GetGameTime = @(
        "SELECT time_of_day FROM weather_parameters LIMIT 1"
    )
    GetWeatherData = @(
        "SELECT base_air_temperature, water_temperature FROM weather_parameters LIMIT 1"
    )
    GetDatabaseTables = @(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    
    # Vehicle queries
    GetVehicles = @(
        "SELECT * FROM vehicle_entity",
        "SELECT * FROM Vehicles",
        "SELECT * FROM VehicleData"
    )
}

# ===============================================================
# INITIALIZATION
# ===============================================================

function Initialize-DatabaseModule {
    <#
    .SYNOPSIS
    Initialize the SCUM database module
    .PARAMETER Config
    Configuration object
    .PARAMETER DatabasePath
    Path to SCUM.db file (optional, auto-detected if not provided)
    #>
    param(
        [Parameter(Mandatory)]
        [object]$Config,
        
        [Parameter()]
        [string]$DatabasePath
    )
    
    try {
        # Import common module
        Import-CommonModule
        
        $script:DatabaseConfig = $Config
        
        # Auto-detect database path if not provided
        if (-not $DatabasePath) {
            $serverDir = Get-SafeConfigValue $Config "serverDir" "./server"
            $script:DatabasePath = Join-Path $serverDir "SCUM\Saved\SaveFiles\SCUM.db"
        } else {
            $script:DatabasePath = $DatabasePath
        }
        
        # Verify database exists
        if (-not (Test-PathExists $script:DatabasePath)) {
            throw "SCUM database not found at: $script:DatabasePath"
        }
        
        # Test SQLite availability (only external sqlite3.exe)
        $sqliteTest = Test-SQLiteAvailability
        if (-not $sqliteTest.Available) {
            Write-Log "[Database] External SQLite not available: $($sqliteTest.Error)" -Level Error
            return @{ Success = $false; Error = $sqliteTest.Error }
        }
        
        # Store SQLite information
        $script:SqliteExePath = $sqliteTest.Path
        
        Write-Log "[Database] Using external SQLite: $($script:SqliteExePath)" -Level Info
        Write-Log "[Database] SQLite version: $($sqliteTest.Version)" -Level Info
        
        # Test database connection
        $connectionTest = Test-DatabaseConnection
        if (-not $connectionTest.Success) {
            throw "Failed to connect to database: $($connectionTest.Error)"
        }
        
        Write-Log "[Database] Module initialized successfully"
        Write-Log "[Database] Database path: $script:DatabasePath"
        Write-Log "[Database] Database size: $([math]::Round((Get-Item $script:DatabasePath).Length / 1MB, 2)) MB"
        
        return @{ Success = $true }
        
    } catch {
        Write-Log "[Database] Failed to initialize: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

function Test-SQLiteAvailability {
    <#
    .SYNOPSIS
    Test if external sqlite3.exe is available (no .NET fallback)
    .RETURNS
    Hashtable with availability status
    #>
    
    # Always use sqlite3.exe from sqlite-tools directory - no fallbacks
    $rootPath = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    $sqliteExePath = Join-Path $rootPath "sqlite-tools\sqlite3.exe"
    
    if (Test-Path $sqliteExePath) {
        try {
            # Test if sqlite3.exe works
            $testResult = & $sqliteExePath "-version" 2>$null
            if ($LASTEXITCODE -eq 0) {
                Write-Verbose "[Database] Using external SQLite: $sqliteExePath"
                return @{ 
                    Available = $true 
                    Provider = "External" 
                    Path = $sqliteExePath
                    Version = $testResult.Trim()
                }
            } else {
                return @{ 
                    Available = $false 
                    Error = "sqlite3.exe found but failed to execute (exit code: $LASTEXITCODE)"
                }
            }
        } catch {
            return @{ 
                Available = $false 
                Error = "sqlite3.exe found but failed to execute: $($_.Exception.Message)"
            }
        }
    } else {
        return @{ 
            Available = $false 
            Error = "sqlite3.exe not found at expected location: $sqliteExePath"
        }
    }
}

# ===============================================================
# DATABASE QUERIES
# ===============================================================

function Invoke-ExternalSQLiteQuery {
    <#
    .SYNOPSIS
    Execute SQLite query using external sqlite3.exe
    .PARAMETER Query
    SQL query to execute
    .RETURNS
    Query results or error information
    #>
    param(
        [Parameter(Mandatory)]
        [string]$Query
    )
    
    try {
        if (-not $script:SqliteExePath -or -not (Test-Path $script:SqliteExePath)) {
            throw "External SQLite executable not found"
        }
        
        # Create temporary file for the output
        $tempOutputFile = [System.IO.Path]::GetTempFileName()
        
        try {
            # Execute sqlite3.exe directly with arguments
            $arguments = @(
                $script:DatabasePath
                "-separator"
                "`t"
                "-header"
                $Query
            )
            
            $processInfo = New-Object System.Diagnostics.ProcessStartInfo
            $processInfo.FileName = $script:SqliteExePath
            $processInfo.Arguments = ($arguments | ForEach-Object { if ($_ -match '\s') { "`"$_`"" } else { $_ } }) -join ' '
            $processInfo.UseShellExecute = $false
            $processInfo.RedirectStandardOutput = $true
            $processInfo.RedirectStandardError = $true
            $processInfo.CreateNoWindow = $true
            
            Write-Verbose "[Database] Executing: $($processInfo.FileName) $($processInfo.Arguments)"
            
            $process = New-Object System.Diagnostics.Process
            $process.StartInfo = $processInfo
            $process.Start() | Out-Null
            
            $stdout = $process.StandardOutput.ReadToEnd()
            $stderr = $process.StandardError.ReadToEnd()
            $process.WaitForExit()
            
            if ($process.ExitCode -ne 0) {
                throw "SQLite error: $stderr"
            }
            
            # Parse tab-separated output from stdout
            if ([string]::IsNullOrWhiteSpace($stdout)) {
                return @{ Success = $true; Data = @(); Count = 0 }
            }
            
            # Parse tab-separated output
            $results = @()
            $lines = $stdout -split "`r?`n" | Where-Object { $_ -and $_.Trim() }
            
            if ($lines.Count -gt 1) {
                $headers = $lines[0] -split "`t"
                
                for ($i = 1; $i -lt $lines.Count; $i++) {
                    $values = $lines[$i] -split "`t"
                    $row = @{}
                    
                    for ($j = 0; $j -lt [Math]::Min($headers.Count, $values.Count); $j++) {
                        $columnName = $headers[$j].Trim('"')
                        $columnValue = $values[$j].Trim('"')
                        
                        # Try to convert numeric values
                        if ($columnValue -match '^\d+$') {
                            $row[$columnName] = [int]$columnValue
                        } elseif ($columnValue -match '^\d+\.\d+$') {
                            $row[$columnName] = [double]$columnValue
                        } else {
                            $row[$ColumnName] = $columnValue
                        }
                    }
                    
                    $results += $row
                }
            } elseif ($lines.Count -eq 1) {
                # Only headers, no data
                return @{ Success = $true; Data = @(); Count = 0 }
            }
            
            return @{ Success = $true; Data = $results; Count = $results.Count }
            
        } finally {
            # Clean up temp files
            if (Test-Path $tempOutputFile) { Remove-Item $tempOutputFile -Force -ErrorAction SilentlyContinue }
        }
        
    } catch {
        Write-Verbose "[Database] External SQLite query failed: $($_.Exception.Message)"
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

function Test-DatabaseConnection {
    <#
    .SYNOPSIS
    Test connection to SCUM database using external sqlite3.exe only
    .RETURNS
    Hashtable with connection test results
    #>
    
    try {
        if (-not $script:SqliteExePath -or -not (Test-Path $script:SqliteExePath)) {
            return @{ Success = $false; Error = "External SQLite executable not found" }
        }
        
        # Test external SQLite with a simple query
        $testResult = Invoke-ExternalSQLiteQuery -Query "SELECT name FROM sqlite_master WHERE type='table' LIMIT 1"
        
        if ($testResult.Success) {
            $script:LastConnectionTest = Get-Date
            $testTable = if ($testResult.Data.Count -gt 0) { $testResult.Data[0].name } else { "No tables" }
            return @{ Success = $true; TestTable = $testTable; Provider = "External" }
        } else {
            return @{ Success = $false; Error = $testResult.Error }
        }
        
    } catch {
        Write-Log "[Database] Connection test failed: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

function Invoke-DatabaseQuery {
    <#
    .SYNOPSIS
    Execute a read-only query against the SCUM database using external sqlite3.exe only
    .PARAMETER Query
    SQL query to execute
    .RETURNS
    Query results or error information
    #>
    param(
        [Parameter(Mandatory)]
        [string]$Query
    )
    
    try {
        # Check if database module is properly initialized
        if (-not $script:DatabasePath -or [string]::IsNullOrEmpty($script:DatabasePath)) {
            throw "Database module not initialized - DatabasePath is empty"
        }
        
        # Check if database is available
        if (-not (Test-PathExists $script:DatabasePath)) {
            throw "Database file not found at: $script:DatabasePath"
        }
        
        # Check if external SQLite is available
        if (-not $script:SqliteExePath -or -not (Test-Path $script:SqliteExePath)) {
            throw "External SQLite executable not found at: $script:SqliteExePath"
        }
        
        # Test connection periodically
        $timeSinceLastTest = ((Get-Date) - $script:LastConnectionTest).TotalSeconds
        if ($timeSinceLastTest -gt $script:ConnectionTestInterval) {
            $connectionTest = Test-DatabaseConnection
            if (-not $connectionTest.Success) {
                throw "Database connection failed: $($connectionTest.Error)"
            }
        }
        
        # Execute query using external SQLite
        return Invoke-ExternalSQLiteQuery -Query $Query
        
    } catch {
        $errorMsg = "Query failed: $($_.Exception.Message)"
        Write-Verbose "[Database] Query Error: $errorMsg"
        return @{ Success = $false; Error = $errorMsg }
    }
}

function Invoke-DatabaseQuerySet {
    <#
    .SYNOPSIS
    Execute a set of database queries with parameter substitution
    .PARAMETER QueryKey
    Key to identify which query set to use from $script:DatabaseQueries
    .PARAMETER Parameters
    Parameters to substitute in queries (e.g., @{limit = 20; steamid = "12345"; playername = "TestPlayer"})
    .RETURNS
    Query results or error information
    #>
    param(
        [Parameter(Mandatory)]
        [string]$QueryKey,
        
        [Parameter()]
        [hashtable]$Parameters = @{
        }
    )
    
    try {
        if (-not $script:DatabaseQueries.ContainsKey($QueryKey)) {
            throw "Query set '$QueryKey' not found in database queries"
        }
        
        $queries = $script:DatabaseQueries[$QueryKey]
        
        foreach ($query in $queries) {
            # Substitute parameters in query
            $finalQuery = $query
            foreach ($key in $Parameters.Keys) {
                $finalQuery = $finalQuery -replace "@$key", $Parameters[$key]
            }
            
            Write-Verbose "[Database] Trying query: $finalQuery"
            $result = Invoke-DatabaseQuery -Query $finalQuery
            
            if ($result.Success -and $result.Data -and $result.Data.Count -gt 0) {
                Write-Verbose "[Database] Query succeeded with $($result.Data.Count) results"
                return $result
            }
        }
        
        # No queries returned data
        Write-Verbose "[Database] All queries in set '$QueryKey' returned no data"
        return @{ Success = $true; Data = @(); Count = 0 }
        
    } catch {
        $errorMsg = "Query set '$QueryKey' failed: $($_.Exception.Message)"
        Write-Verbose "[Database] $errorMsg"
        return @{ Success = $false; Error = $errorMsg }
    }
}

function Invoke-LeaderboardQuery {
    <#
    .SYNOPSIS
    Execute leaderboard queries with parameter substitution (backward compatibility)
    .PARAMETER Queries
    Array of SQL queries to try
    .PARAMETER Parameters
    Parameters to substitute in queries (e.g., @{limit = 20})
    .RETURNS
    Query results or error information
    #>
    param(
        [Parameter(Mandatory)]
        [string[]]$Queries,
        
        [Parameter()]
        [hashtable]$Parameters = @{
        }
    )
    
    try {
        foreach ($query in $Queries) {
            # Substitute parameters in query
            $finalQuery = $query
            foreach ($key in $Parameters.Keys) {
                $finalQuery = $finalQuery -replace "@$key", $Parameters[$key]
            }
            
            Write-Verbose "[Database] Trying leaderboard query: $finalQuery"
            $result = Invoke-DatabaseQuery -Query $finalQuery
            
            if ($result.Success -and $result.Data -and $result.Data.Count -gt 0) {
                Write-Verbose "[Database] Leaderboard query succeeded with $($result.Data.Count) results"
                return $result
            }
        }
        
        # No queries returned data
        Write-Verbose "[Database] All leaderboard queries returned no data"
        return @{ Success = $true; Data = @(); Count = 0 }
        
    } catch {
        $errorMsg = "Leaderboard query failed: $($_.Exception.Message)"
        Write-Verbose "[Database] $errorMsg"
        return @{ Success = $false; Error = $errorMsg }
    }
}

function Get-DatabaseTables {
    <#
    .SYNOPSIS
    Get list of tables in the SCUM database
    .RETURNS
    Array of table names
    #>
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetDatabaseTables" -Parameters @{}
        
        if ($result.Success) {
            $tableNames = $result.Data | ForEach-Object { $_.name }
            Write-Log "[Database] Found $($tableNames.Count) tables in database"
            return @{ Success = $true; Tables = $tableNames }
        } else {
            return $result
        }
        
    } catch {
        Write-Log "[Database] Failed to get table list: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

function Get-OnlinePlayers {
    <#
    .SYNOPSIS
    Get list of currently online players
    .PARAMETER UseCache
    Use cached data if available and fresh
    .RETURNS
    Array of online player information
    #>
    param(
        [Parameter()]
        [switch]$UseCache
    )
    
    try {
        # Check cache first if requested
        if ($UseCache -and $script:PlayerCacheExpiry -gt (Get-Date)) {
            return @{ Success = $true; Data = $script:PlayerCache; Cached = $true }
        }
        
        $result = Invoke-DatabaseQuerySet -QueryKey "GetOnlinePlayers" -Parameters @{}
        
        if ($result.Success -and $result.Count -gt 0) {
            # Cache the results for 30 seconds
            $script:PlayerCache = $result.Data
            $script:PlayerCacheExpiry = (Get-Date).AddSeconds(30)
            
            Write-Log "[Database] Found $($result.Count) online players"
            return @{ Success = $true; Data = $result.Data; Count = $result.Count }
        }
        
        return @{ Success = $false; Error = "No player data found or accessible" }
        
    } catch {
        Write-Log "[Database] Failed to get online players: $($_.Exception.Message)" -Level Warning
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

function Get-PlayerInfo {
    <#
    .SYNOPSIS
    Get detailed information about a specific player
    .PARAMETER SteamID
    Steam ID of the player
    .PARAMETER PlayerName
    Player name (alternative to SteamID)
    .RETURNS
    Player information hashtable
    #>
    param(
        [Parameter(ParameterSetName = "BySteamID")]
        [string]$SteamID,
        
        [Parameter(ParameterSetName = "ByName")]
        [string]$PlayerName
    )
    
    try {
        $result = $null
        
        if ($SteamID) {
            $escapedValue = $SteamID -replace "'", "''"
            $result = Invoke-DatabaseQuerySet -QueryKey "GetPlayerBySteamID" -Parameters @{steamid = $escapedValue}
        } elseif ($PlayerName) {
            $escapedValue = $PlayerName -replace "'", "''"
            $result = Invoke-DatabaseQuerySet -QueryKey "GetPlayerByName" -Parameters @{playername = $escapedValue}
        }
        
        if ($result -and $result.Success -and $result.Count -gt 0) {
            Write-Log "[Database] Found player info: $($result.Data[0].PlayerName -or $result.Data[0].Name -or 'Unknown')"
            return @{ Success = $true; Data = $result.Data[0] }
        }
        
        return @{ Success = $false; Error = "Player not found" }
        
    } catch {
        Write-Log "[Database] Failed to get player info: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

function Get-VehicleInfo {
    <#
    .SYNOPSIS
    Get information about vehicles in the game
    .PARAMETER UseCache
    Use cached data if available
    .RETURNS
    Array of vehicle information
    #>
    param(
        [Parameter()]
        [switch]$UseCache
    )
    
    try {
        # Check cache
        if ($UseCache -and $script:VehicleCacheExpiry -gt (Get-Date)) {
            return @{ Success = $true; Data = $script:VehicleCache; Cached = $true }
        }
        
        $result = Invoke-DatabaseQuerySet -QueryKey "GetVehicleCount" -Parameters @{}
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            $vehicleCount = $result.Data[0].VehicleCount
            
            # Cache for 5 minutes
            $script:VehicleCache = @(@{ Count = $vehicleCount })
            $script:VehicleCacheExpiry = (Get-Date).AddMinutes(5)
            
            return @{ Success = $true; Data = @(); Count = $vehicleCount }
        }
        
        return @{ Success = $false; Error = "No vehicle data found or accessible" }
        
    } catch {
        Write-Log "[Database] Failed to get vehicle info: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

function Get-ServerStatistics {
    <#
    .SYNOPSIS
    Get basic server statistics from database
    .RETURNS
    Hashtable with server statistics
    #>
    
    try {
        # Check if database module is initialized
        if (-not $script:DatabasePath -or [string]::IsNullOrEmpty($script:DatabasePath)) {
            Write-Verbose "[Database] Module not initialized - cannot get server statistics"
            return @{ Success = $false; Error = "Database module not initialized" }
        }
        
        $stats = @{
            Timestamp = Get-Date
            DatabaseSize = 0
            TotalPlayers = 0
            OnlinePlayers = 0
            TotalVehicles = 0
            LastUpdate = $null
        }
        
        # Get database file size
        if (Test-PathExists $script:DatabasePath) {
            $stats.DatabaseSize = [math]::Round((Get-Item $script:DatabasePath).Length / 1MB, 2)
            $stats.LastUpdate = (Get-Item $script:DatabasePath).LastWriteTime
        }
        
        # Get player counts
        $playersResult = Get-OnlinePlayers -UseCache
        if ($playersResult.Success) {
            if ($playersResult.AllPlayers) {
                $stats.TotalPlayers = $playersResult.Count
                $stats.OnlinePlayers = "Unknown"
            } else {
                $stats.OnlinePlayers = $playersResult.Count
            }
        }
        
        # Get vehicle count  
        $vehiclesResult = Get-VehicleInfo -UseCache
        if ($vehiclesResult.Success) {
            $stats.TotalVehicles = $vehiclesResult.Count
        }
        
        Write-Verbose "[Database] Server statistics compiled"
        return @{ Success = $true; Statistics = $stats }
        
    } catch {
        Write-Log "[Database] Failed to get server statistics: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

function Clear-DatabaseCache {
    <#
    .SYNOPSIS
    Clear all cached database data
    #>
    
    $script:PlayerCache = @{}
    $script:PlayerCacheExpiry = [DateTime]::MinValue
    $script:VehicleCache = @{}
    $script:VehicleCacheExpiry = [DateTime]::MinValue
    
    Write-Log "[Database] Cache cleared"
}

# ===============================================================
# DATA PROCESSING
# ===============================================================

function Get-TotalPlayerCount {
    <#
    .SYNOPSIS
    Get total number of registered players
    .RETURNS
    Integer count of total players
    #>
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTotalPlayerCount" -Parameters @{}
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            return $result.Data[0].TotalCount
        }
        
        return 0
    } catch {
        Write-Log "[Database] Failed to get total player count: $($_.Exception.Message)" -Level Warning
        return 0
    }
}

function Get-OnlinePlayerCount {
    <#
    .SYNOPSIS
    Get count of currently online players from database
    .RETURNS
    Integer count of online players
    #>
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetOnlinePlayerCount" -Parameters @{}
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            return $result.Data[0].OnlineCount
        }
        
        return 0
    } catch {
        Write-Log "[Database] Failed to get online player count: $($_.Exception.Message)" -Level Error
        return 0
    }
}

function Get-GameTimeData {
    <#
    .SYNOPSIS
    Get current game time from weather parameters
    .RETURNS
    Hashtable with game time information
    #>
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetGameTime" -Parameters @{}
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            $timeOfDay = [double]$result.Data[0].time_of_day
            
            # SCUM stores time_of_day directly as hours (0-24)
            # Convert decimal hours to hours and minutes
            $hours = [int]([Math]::Floor($timeOfDay)) % 24
            $minutes = [int](($timeOfDay - [Math]::Floor($timeOfDay)) * 60)
            
            return @{
                TimeOfDay = $timeOfDay
                FormattedTime = "{0:D2}:{1:D2}" -f $hours, $minutes
                Success = $true
            }
        }
        
        return @{ Success = $false; FormattedTime = "N/A" }
    } catch {
        Write-Log "[Database] Failed to get game time: $($_.Exception.Message)" -Level Warning
        return @{ Success = $false; FormattedTime = "N/A" }
    }
}

function Get-WeatherData {
    <#
    .SYNOPSIS
    Get current weather data from database
    .RETURNS
    Hashtable with temperature information
    #>
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetWeatherData" -Parameters @{}
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            $airTemp = [Math]::Round([double]$result.Data[0].base_air_temperature, 1)
            $waterTemp = [Math]::Round([double]$result.Data[0].water_temperature, 1)
            
            return @{
                AirTemperature = $airTemp
                WaterTemperature = $waterTemp
                FormattedTemperature = "A: {0}°C | W: {1}°C" -f $airTemp, $waterTemp
                Success = $true
            }
        }
        
        return @{ Success = $false; FormattedTemperature = "N/A" }
    } catch {
        Write-Log "[Database] Failed to get weather data: $($_.Exception.Message)" -Level Warning
        return @{ Success = $false; FormattedTemperature = "N/A" }
    }
}

function Get-ActiveSquadCount {
    <#
    .SYNOPSIS
    Get count of squads that have members
    .RETURNS
    Integer count of active squads
    #>
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetActiveSquadsCount" -Parameters @{}
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            return $result.Data[0].total
        }
        
        return 0
    } catch {
        Write-Log "[Database] Failed to get active squad count: $($_.Exception.Message)" -Level Warning
        return 0
    }
}

function Get-VehicleCount {
    <#
    .SYNOPSIS
    Get total number of vehicles in the world
    .RETURNS
    Integer count of vehicles
    #>
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetVehicleCount" -Parameters @{}
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            return $result.Data[0].VehicleCount
        }
        
        return 0
    } catch {
        Write-Log "[Database] Failed to get vehicle count: $($_.Exception.Message)" -Level Warning
        return 0
    }
}

function Get-BaseCount {
    <#
    .SYNOPSIS
    Get total number of player bases
    .RETURNS
    Integer count of bases
    #>
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetBaseCount" -Parameters @{}
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            return $result.Data[0].BaseCount
        }
        
        return 0
    } catch {
        # Table may not exist in this database version
        return 0
    }
}

function Get-TopPlayersByPlaytime {
    <#
    .SYNOPSIS
    Get top players by playtime
    .PARAMETER Limit
    Number of top players to return (default: 10)
    .RETURNS
    Array of player objects with playtime information
    #>
    param(
        [Parameter(Mandatory = $false)]
        [int]$Limit = 10
    )
    
    try {
        # Note: PlayTime column name may vary based on SCUM database version
        # You might need to adjust column names based on actual database structure
        $query = "SELECT PlayerName, SteamID, PlayTime, Level FROM Players WHERE PlayTime > 0 ORDER BY PlayTime DESC LIMIT $Limit"
        $result = Invoke-DatabaseQuery -Query $query
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            $players = $result.Data | ForEach-Object {
                @{
                    PlayerName = $_.PlayerName
                    SteamID = $_.SteamID
                    PlaytimeHours = [math]::Round($_.PlayTime / 3600, 1)  # Convert seconds to hours
                    Level = $_.Level
                }
            }
            return $players
        }
        
        return @()
    } catch {
        # Database columns may not exist in this version
        return @()
    }
}

# Leaderboard query functions
function Get-TopPlayersByExperience {
    <#
    .SYNOPSIS
    Get top players by experience points
    .PARAMETER Limit
    Maximum number of players to return
    #>
    param([int]$Limit = 10)
    
    $queries = @(
        "SELECT name as player_name, fame_points as total_experience, 0 as kills, 0 as deaths FROM user_profile WHERE fame_points > 0 ORDER BY fame_points DESC LIMIT $Limit",
        "SELECT u.name as player_name, u.fame_points as total_experience, COALESCE(e.enemy_kills, 0) as kills, COALESCE(e.deaths, 0) as deaths FROM user_profile u LEFT JOIN events_stats e ON u.id = e.user_profile_id WHERE u.fame_points > 0 ORDER BY u.fame_points DESC LIMIT $Limit"
    )
    
    foreach ($query in $queries) {
        try {
            $result = Invoke-DatabaseQuery -Query $query
            if ($result.Success -and $result.Data -and $result.Data.Count -gt 0) {
                Write-Verbose "Successfully retrieved top players by experience using query: $($query.Substring(0, 50))..."
                return $result.Data
            }
        } catch {
            Write-Verbose "Query failed: $($_.Exception.Message)"
        }
    }
    
    Write-Verbose "No experience data found"
    return @()
}

function Get-TopPlayersByKills {
    <#
    .SYNOPSIS
    Get top players by total kills
    .PARAMETER Limit
    Maximum number of players to return
    #>
    param([int]$Limit = 10)
    
    $queries = @(
        "SELECT 
            u.name as player_name, 
            e.enemy_kills as total_kills,
            e.deaths
        FROM events_stats e 
        JOIN user_profile u ON e.user_profile_id = u.id 
        WHERE e.enemy_kills > 0 
        ORDER BY e.enemy_kills DESC 
        LIMIT $Limit"
    )
    
    foreach ($query in $queries) {
        try {
            $result = Invoke-DatabaseQuery -Query $query
            if ($result.Success -and $result.Data -and $result.Data.Count -gt 0) {
                Write-Verbose "Successfully retrieved top players by kills using query: $($query.Substring(0, 50))..."
                return $result.Data
            }
        } catch {
            Write-Verbose "Query failed: $($_.Exception.Message)"
        }
    }
    
    Write-Verbose "No kills data found"
    return @()
}

function Get-TopPlayersByPlaytime {
    <#
    .SYNOPSIS
    Get top players by total playtime
    .PARAMETER Limit
    Maximum number of players to return
    #>
    param([int]$Limit = 10)
    
    $queries = @(
        "SELECT name as player_name, play_time as total_playtime FROM user_profile WHERE play_time > 0 ORDER BY play_time DESC LIMIT $Limit"
    )
    
    foreach ($query in $queries) {
        try {
            $result = Invoke-DatabaseQuery -Query $query
            if ($result.Success -and $result.Data -and $result.Data.Count -gt 0) {
                Write-Verbose "Successfully retrieved top players by playtime using query: $($query.Substring(0, 50))..."
                return $result.Data
            }
        } catch {
            Write-Verbose "Query failed: $($_.Exception.Message)"
        }
    }
    
    Write-Verbose "No playtime data found"
    return @()
}

function Get-TotalKills {
    <#
    .SYNOPSIS
    Get total number of kills across all players
    .RETURNS
    Integer count of total kills
    #>
    $result = Invoke-DatabaseQuerySet -QueryKey "GetTotalKills" -Parameters @{}
    
    if ($result.Success -and $result.Data -and $result.Data.Count -gt 0) {
        $firstRow = $result.Data[0]
        $totalValue = if ($firstRow.total) { [int]$firstRow.total } else { 0 }
        Write-Verbose "Successfully retrieved total kills: $totalValue"
        return $totalValue
    }
    
    Write-Verbose "No kills data found"
    return 0
}

function Get-TotalDeaths {
    <#
    .SYNOPSIS
    Get total number of deaths across all players
    .RETURNS
    Integer count of total deaths
    #>
    $result = Invoke-DatabaseQuerySet -QueryKey "GetTotalDeaths" -Parameters @{}
    
    if ($result.Success -and $result.Data -and $result.Data.Count -gt 0) {
        $firstRow = $result.Data[0]
        $totalValue = if ($firstRow.total) { [int]$firstRow.total } else { 0 }
        Write-Verbose "Successfully retrieved total deaths: $totalValue"
        return $totalValue
    }
    
    Write-Verbose "No deaths data found"
    return 0
}

function Get-TotalPlaytime {
    <#
    .SYNOPSIS
    Get total playtime across all players
    .RETURNS
    Integer count of total playtime in seconds
    #>
    $result = Invoke-DatabaseQuerySet -QueryKey "GetTotalPlaytime" -Parameters @{}
    
    if ($result.Success -and $result.Data -and $result.Data.Count -gt 0) {
        $firstRow = $result.Data[0]
        $totalValue = if ($firstRow.total) { [int]$firstRow.total } else { 0 }
        Write-Verbose "Successfully retrieved total playtime: $totalValue minutes"
        return $totalValue
    }
    
    Write-Verbose "No playtime data found"
    return 0
}

function Get-ActiveSquadsCount {
    <#
    .SYNOPSIS
    Get count of active squads in the game
    .RETURNS
    Integer count of active squads
    #>
    $result = Invoke-DatabaseQuerySet -QueryKey "GetActiveSquadsCount" -Parameters @{}
    
    if ($result.Success -and $result.Data -and $result.Data.Count -gt 0) {
        $firstRow = $result.Data[0]
        $totalValue = if ($firstRow.total) { [int]$firstRow.total } else { 0 }
        Write-Verbose "Successfully retrieved active squads count: $totalValue"
        return $totalValue
    }
    
    Write-Verbose "No squads data found"
    return 0
}

# ===================================================
# NEW LEADERBOARD SYSTEM - 19 CATEGORIES
# Supports both All-Time and Weekly views
# ===================================================

function Get-TopKills {
    <#
    .SYNOPSIS
    Get top players by kill count (PvP kills from events_stats)
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [switch]$WeeklyOnly
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "kills" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopKills" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "$([int]$_.Score) kills"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top kills: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopDeaths {
    <#
    .SYNOPSIS
    Get top players by death count
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [switch]$WeeklyOnly
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "deaths" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopDeaths" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "$([int]$_.Score) deaths"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top deaths: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopPlaytime {
    <#
    .SYNOPSIS
    Get top players by playtime (in hours)
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [switch]$WeeklyOnly
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "playtime" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopPlaytime" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                $hours = [math]::Round([int]$_.Score / 3600, 1)
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "${hours}h"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top playtime: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopFame {
    <#
    .SYNOPSIS
    Get top players by fame points
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [switch]$WeeklyOnly
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "fame" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopFame" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "$([int]$_.Score) fame"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top fame: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopMoney {
    <#
    .SYNOPSIS
    Get top players by money/wealth
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [switch]$WeeklyOnly
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "money" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopMoney" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "$([int]$_.Score) credits"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top money: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopEvents {
    <#
    .SYNOPSIS
    Get top players by events won
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [switch]$WeeklyOnly
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "events" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopEvents" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "$([int]$_.Score) events"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top events: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopKDR {
    <#
    .SYNOPSIS
    Get top players by Kill/Death Ratio
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [bool]$WeeklyOnly = $false
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "kdr" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopKDR" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                $kdr = [math]::Round([double]$_.Score, 2)
                @{
                    Name = $_.Name
                    Value = $kdr
                    FormattedValue = "$kdr K/D"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top KDR: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopHeadshots {
    <#
    .SYNOPSIS
    Get top players by headshot count
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [bool]$WeeklyOnly = $false
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "headshots" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopHeadshots" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "$([int]$_.Score) headshots"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top headshots: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopTeamKills {
    <#
    .SYNOPSIS
    Get top players by team kills
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [bool]$WeeklyOnly = $false
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "team_kills" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopTeamKills" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "$([int]$_.Score) team kills"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top team kills: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopAnimalKills {
    <#
    .SYNOPSIS
    Get top players by animal kills
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [bool]$WeeklyOnly = $false
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "animal_kills" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopAnimalKills" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "$([int]$_.Score) animals"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top animal kills: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopPuppetKills {
    <#
    .SYNOPSIS
    Get top players by puppet kills
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [bool]$WeeklyOnly = $false
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "puppet_kills" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopPuppetKills" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "$([int]$_.Score) puppets"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top puppet kills: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopDroneKills {
    <#
    .SYNOPSIS
    Get top players by drone kills
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [bool]$WeeklyOnly = $false
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "drone_kills" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopDroneKills" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "$([int]$_.Score) drones"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top drone kills: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopSentryKills {
    <#
    .SYNOPSIS
    Get top players by sentry kills
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [bool]$WeeklyOnly = $false
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "sentry_kills" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopSentriKills" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "$([int]$_.Score) sentries"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top sentry kills: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopLockpickers {
    <#
    .SYNOPSIS
    Get top players by locks picked
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [bool]$WeeklyOnly = $false
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "locks_picked" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopLockpickers" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "$([int]$_.Score) locks"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top lockpickers: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopGunCrafters {
    <#
    .SYNOPSIS
    Get top players by guns crafted
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [bool]$WeeklyOnly = $false
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "guns_crafted" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopGunCrafters" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "$([int]$_.Score) guns"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top gun crafters: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopBulletCrafters {
    <#
    .SYNOPSIS
    Get top players by bullets crafted
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [bool]$WeeklyOnly = $false
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "bullets_crafted" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopBulletCrafters" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "$([int]$_.Score) bullets"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top bullet crafters: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopMeleeCrafters {
    <#
    .SYNOPSIS
    Get top players by melee weapons crafted
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [bool]$WeeklyOnly = $false
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "melee_crafted" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopMeleeCrafters" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "$([int]$_.Score) melee"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top melee crafters: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopClothingCrafters {
    <#
    .SYNOPSIS
    Get top players by clothing crafted
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [bool]$WeeklyOnly = $false
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "clothing_crafted" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopClothingCrafters" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "$([int]$_.Score) clothing"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top clothing crafters: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopFishers {
    <#
    .SYNOPSIS
    Get top players by fish caught
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [bool]$WeeklyOnly = $false
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "fish_caught" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopFishCatchers" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "$([int]$_.Score) fish"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top fishers: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopSquads {
    <#
    .SYNOPSIS
    Get top squads by score
    #>
    param(
        [int]$Limit = 10,
        [bool]$WeeklyOnly = $false
    )
    
    try {
        if ($WeeklyOnly) {
            return Get-WeeklyLeaderboard -Category "squad_score" -Limit $Limit
        }
        
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopSquads" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = $_.Score
                    FormattedValue = "{0:F0} score" -f $_.Score
                }
            }
        }
        
        return @()
    } catch {
        Write-Verbose "Failed to get top squads: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopSquadLeaders {
    <#
    .SYNOPSIS
    Get top squad leaders by squad members
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [bool]$WeeklyOnly = $false
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "squad_members" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopSquadLeaders" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "$([int]$_.Score) members"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top squad leaders: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopDistance {
    <#
    .SYNOPSIS
    Get top players by distance travelled
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [switch]$WeeklyOnly
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "distance" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopDistance" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                $distanceKm = [math]::Round([double]$_.Score / 1000, 1)
                @{
                    Name = $_.Name
                    Value = [double]$_.Score
                    FormattedValue = "${distanceKm} km"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top distance: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopSniper {
    <#
    .SYNOPSIS
    Get top players by longest kill distance
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [switch]$WeeklyOnly
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "longest_kill_distance" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopSniper" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                $distanceM = [math]::Round([double]$_.Score, 1)
                @{
                    Name = $_.Name
                    Value = [double]$_.Score
                    FormattedValue = "${distanceM}m"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top sniper: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopMeleeWarriors {
    <#
    .SYNOPSIS
    Get top players by melee kills
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [switch]$WeeklyOnly
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "melee_kills" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopMeleeWarriors" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "$([int]$_.Score) melee kills"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top melee warriors: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopArchers {
    <#
    .SYNOPSIS
    Get top players by archery kills
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [switch]$WeeklyOnly
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "archery_kills" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopArchers" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "$([int]$_.Score) bow kills"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top archers: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopSurvivors {
    <#
    .SYNOPSIS
    Get top players by survival time
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [switch]$WeeklyOnly
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "minutes_survived" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopSurvivors" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                $hours = [math]::Round([double]$_.Score / 60, 1)
                @{
                    Name = $_.Name
                    Value = [double]$_.Score
                    FormattedValue = "${hours}h survived"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top survivors: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopMedics {
    <#
    .SYNOPSIS
    Get top players by wounds patched
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [switch]$WeeklyOnly
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "wounds_patched" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopMedics" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "$([int]$_.Score) wounds healed"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top medics: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopLooters {
    <#
    .SYNOPSIS
    Get top players by containers looted
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [switch]$WeeklyOnly
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "containers_looted" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopLooters" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "$([int]$_.Score) containers"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top looters: $($_.Exception.Message)"
        return @()
    }
}

function Get-TopAllCrafters {
    <#
    .SYNOPSIS
    Get top players by total crafting (guns + bullets + arrows + clothing)
    .PARAMETER Limit
    Maximum number of results (default: 10)
    .PARAMETER WeeklyOnly
    If true, get weekly delta; if false, get all-time totals
    #>
    param(
        [int]$Limit = 10,
        [switch]$WeeklyOnly
    )
    
    if ($WeeklyOnly) {
        return Get-WeeklyLeaderboard -Category "total_crafting" -Limit $Limit
    }
    
    try {
        $result = Invoke-DatabaseQuerySet -QueryKey "GetTopAllCrafters" -Parameters @{limit = $Limit}
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "$([int]$_.Score) items crafted"
                }
            }
        }
        return @()
    } catch {
        Write-Verbose "Failed to get top all crafters: $($_.Exception.Message)"
        return @()
    }
}

# ===================================================
# WEEKLY LEADERBOARD FUNCTIONS
# ===================================================

function Get-WeeklyLeaderboard {
    <#
    .SYNOPSIS
    Get weekly delta statistics for a specific category
    .PARAMETER Category
    The leaderboard category (kills, deaths, playtime, etc.)
    .PARAMETER Limit
    Maximum number of results (default: 10)
    #>
    param(
        [Parameter(Mandatory)]
        [string]$Category,
        [int]$Limit = 10
    )
    
    try {
        $weeklyDbPath = ".\data\weekly_leaderboards.db"
        
        # Create data directory if it doesn't exist
        $dataDir = ".\data"
        if (-not (Test-Path $dataDir)) {
            New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
        }
        
        if (-not (Test-Path $weeklyDbPath)) {
            Write-Warning "Weekly leaderboards database not found at: $weeklyDbPath"
            return @()
        }
        
        # Get current week start date
        $currentWeekStart = Get-CurrentWeekStart
        
        # Calculate weekly deltas for the category using ATTACH DATABASE
        $weekStartStr = $currentWeekStart.ToString('yyyy-MM-dd')
        $categoryQueries = @{
            # All categories matching GetTop* functions from all-time system
            "kills" = "SELECT u.name, (COALESCE(current.enemy_kills, 0) - COALESCE(ws.enemy_kills, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN events_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.enemy_kills, 0) - COALESCE(ws.enemy_kills, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "deaths" = "SELECT u.name, (COALESCE(current.deaths, 0) - COALESCE(ws.deaths, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN events_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.deaths, 0) - COALESCE(ws.deaths, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "playtime" = "SELECT u.name, (COALESCE(u.play_time, 0) - COALESCE(ws.play_time, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' WHERE (COALESCE(u.play_time, 0) - COALESCE(ws.play_time, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "fame" = "SELECT u.name, (COALESCE(u.fame_points, 0) - COALESCE(ws.fame_points, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' WHERE (COALESCE(u.fame_points, 0) - COALESCE(ws.fame_points, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "money" = "SELECT u.name, (COALESCE(barc.account_balance, 0) - COALESCE(ws.money_balance, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN bank_account_registry bar ON u.id = bar.account_owner_user_profile_id LEFT JOIN bank_account_registry_currencies barc ON bar.id = barc.bank_account_id AND barc.currency_type = 1 WHERE (COALESCE(barc.account_balance, 0) - COALESCE(ws.money_balance, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "events" = "SELECT u.name, (COALESCE(current.events_won, 0) - COALESCE(ws.events_won, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN events_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.events_won, 0) - COALESCE(ws.events_won, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "kdr" = "SELECT u.name, CASE WHEN (COALESCE(current.deaths, 0) - COALESCE(ws.deaths, 0)) > 0 THEN CAST((COALESCE(current.enemy_kills, 0) - COALESCE(ws.enemy_kills, 0)) AS REAL) / (COALESCE(current.deaths, 0) - COALESCE(ws.deaths, 0)) ELSE (COALESCE(current.enemy_kills, 0) - COALESCE(ws.enemy_kills, 0)) END as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN events_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.enemy_kills, 0) - COALESCE(ws.enemy_kills, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "headshots" = "SELECT u.name, (COALESCE(current.headshots, 0) - COALESCE(ws.headshots, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.headshots, 0) - COALESCE(ws.headshots, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "team_kills" = "SELECT u.name, (COALESCE(current.team_kills, 0) - COALESCE(ws.team_kills, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN events_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.team_kills, 0) - COALESCE(ws.team_kills, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "animal_kills" = "SELECT u.name, (COALESCE(current.animals_killed, 0) - COALESCE(ws.animals_killed, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.animals_killed, 0) - COALESCE(ws.animals_killed, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "puppet_kills" = "SELECT u.name, (COALESCE(current.puppets_killed, 0) - COALESCE(ws.puppets_killed, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.puppets_killed, 0) - COALESCE(ws.puppets_killed, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "drone_kills" = "SELECT u.name, (COALESCE(current.drone_kills, 0) - COALESCE(ws.drone_kills, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.drone_kills, 0) - COALESCE(ws.drone_kills, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "sentry_kills" = "SELECT u.name, (COALESCE(current.sentry_kills, 0) - COALESCE(ws.sentry_kills, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.sentry_kills, 0) - COALESCE(ws.sentry_kills, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "locks_picked" = "SELECT u.name, (COALESCE(current.locks_picked, 0) - COALESCE(ws.locks_picked, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.locks_picked, 0) - COALESCE(ws.locks_picked, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "guns_crafted" = "SELECT u.name, (COALESCE(current.guns_crafted, 0) - COALESCE(ws.guns_crafted, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.guns_crafted, 0) - COALESCE(ws.guns_crafted, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "bullets_crafted" = "SELECT u.name, (COALESCE(current.bullets_crafted, 0) - COALESCE(ws.bullets_crafted, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.bullets_crafted, 0) - COALESCE(ws.bullets_crafted, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "melee_weapons_crafted" = "SELECT u.name, (COALESCE(current.melee_weapons_crafted, 0) - COALESCE(ws.melee_weapons_crafted, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.melee_weapons_crafted, 0) - COALESCE(ws.melee_weapons_crafted, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "clothing_crafted" = "SELECT u.name, (COALESCE(current.clothing_crafted, 0) - COALESCE(ws.clothing_crafted, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.clothing_crafted, 0) - COALESCE(ws.clothing_crafted, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "fish_caught" = "SELECT u.name, (COALESCE(current.fish_caught, 0) - COALESCE(ws.fish_caught, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN fishing_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.fish_caught, 0) - COALESCE(ws.fish_caught, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "squad_leaders" = "SELECT u.name, COUNT(sm.user_profile_id) as delta FROM user_profile u LEFT JOIN squad_member sm ON u.id = sm.user_profile_id WHERE sm.rank = 4 GROUP BY u.id, u.name HAVING COUNT(sm.user_profile_id) > 0 ORDER BY delta DESC LIMIT $Limit"
            "squads" = "SELECT s.name, (COALESCE(s.score, 0) - COALESCE(ws.squad_score, 0)) as delta FROM squads s LEFT JOIN weekly.weekly_snapshots ws ON s.id = ws.squad_id AND ws.week_start_date = '$weekStartStr' WHERE (COALESCE(s.score, 0) - COALESCE(ws.squad_score, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "distance" = "SELECT u.name, (COALESCE(current.distance_travelled_by_foot, 0) - COALESCE(ws.distance_travelled_by_foot, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.distance_travelled_by_foot, 0) - COALESCE(ws.distance_travelled_by_foot, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "sniper" = "SELECT u.name, MAX(COALESCE(current.longest_kill_distance, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE COALESCE(current.longest_kill_distance, 0) > COALESCE(ws.longest_kill_distance, 0) ORDER BY delta DESC LIMIT $Limit"
            "melee_warriors" = "SELECT u.name, (COALESCE(current.melee_kills, 0) - COALESCE(ws.melee_kills, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.melee_kills, 0) - COALESCE(ws.melee_kills, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "archers" = "SELECT u.name, (COALESCE(current.archery_kills, 0) - COALESCE(ws.archery_kills, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.archery_kills, 0) - COALESCE(ws.archery_kills, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "survivors" = "SELECT u.name, (COALESCE(current.minutes_survived, 0) - COALESCE(ws.minutes_survived, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.minutes_survived, 0) - COALESCE(ws.minutes_survived, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "medics" = "SELECT u.name, (COALESCE(current.wounds_patched, 0) - COALESCE(ws.wounds_patched, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.wounds_patched, 0) - COALESCE(ws.wounds_patched, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "looters" = "SELECT u.name, (COALESCE(current.containers_looted, 0) - COALESCE(ws.containers_looted, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.containers_looted, 0) - COALESCE(ws.containers_looted, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "all_crafters" = "SELECT u.name, ((COALESCE(current.guns_crafted, 0) + COALESCE(current.bullets_crafted, 0) + COALESCE(current.arrows_crafted, 0) + COALESCE(current.clothing_crafted, 0)) - (COALESCE(ws.guns_crafted, 0) + COALESCE(ws.bullets_crafted, 0) + COALESCE(ws.arrows_crafted, 0) + COALESCE(ws.clothing_crafted, 0))) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE ((COALESCE(current.guns_crafted, 0) + COALESCE(current.bullets_crafted, 0) + COALESCE(current.arrows_crafted, 0) + COALESCE(current.clothing_crafted, 0)) - (COALESCE(ws.guns_crafted, 0) + COALESCE(ws.bullets_crafted, 0) + COALESCE(ws.arrows_crafted, 0) + COALESCE(ws.clothing_crafted, 0))) > 0 ORDER BY delta DESC LIMIT $Limit"
            
            # Aliases for backward compatibility
            "minutes_survived" = "SELECT u.name, (COALESCE(current.minutes_survived, 0) - COALESCE(ws.minutes_survived, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.minutes_survived, 0) - COALESCE(ws.minutes_survived, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "containers_looted" = "SELECT u.name, (COALESCE(current.containers_looted, 0) - COALESCE(ws.containers_looted, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.containers_looted, 0) - COALESCE(ws.containers_looted, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "items_looted" = "SELECT u.name, (COALESCE(current.containers_looted, 0) - COALESCE(ws.containers_looted, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.containers_looted, 0) - COALESCE(ws.containers_looted, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "melee_kills" = "SELECT u.name, (COALESCE(current.melee_kills, 0) - COALESCE(ws.melee_kills, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.melee_kills, 0) - COALESCE(ws.melee_kills, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "archery_kills" = "SELECT u.name, (COALESCE(current.archery_kills, 0) - COALESCE(ws.archery_kills, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.archery_kills, 0) - COALESCE(ws.archery_kills, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "longest_kill_distance" = "SELECT u.name, MAX(COALESCE(current.longest_kill_distance, 0)) as delta FROM user_profile u LEFT JOIN weekly.weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE COALESCE(current.longest_kill_distance, 0) > COALESCE(ws.longest_kill_distance, 0) ORDER BY delta DESC LIMIT $Limit"
            "squad_score" = "SELECT s.name, (COALESCE(s.score, 0) - COALESCE(ws.squad_score, 0)) as delta FROM squads s LEFT JOIN weekly.weekly_snapshots ws ON s.id = ws.squad_id AND ws.week_start_date = '$weekStartStr' WHERE (COALESCE(s.score, 0) - COALESCE(ws.squad_score, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        }
        
        $query = $categoryQueries[$Category]
        if (-not $query) {
            Write-Verbose "No query available for weekly category: $Category"
            return @()
        }
        
        # Build the complete query with ATTACH DATABASE
        $fullQuery = @"
ATTACH DATABASE '$weeklyDbPath' AS weekly;
$query;
DETACH DATABASE weekly;
"@
        
        # Execute query against main database (with weekly attached)
        $result = Invoke-DatabaseQuery -Query $fullQuery
        
        if ($result -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.name
                    Value = [int]$_.delta
                    FormattedValue = Format-WeeklyValue -Category $Category -Value ([int]$_.delta)
                }
            }
        }
        
        return @()
        
    } catch {
        Write-Verbose "Failed to get weekly leaderboard for $Category : $($_.Exception.Message)"
        return @()
    }
}

function Get-CurrentWeekStart {
    <#
    .SYNOPSIS
    Get the start date of the current week (Monday)
    #>
    $today = Get-Date
    $daysToSubtract = ($today.DayOfWeek.value__ + 6) % 7
    return $today.Date.AddDays(-$daysToSubtract)
}

function Get-WeeklyDeltaQuery {
    <#
    .SYNOPSIS
    Get the SQL query for weekly delta calculation for a specific category
    #>
    param(
        [string]$Category,
        [datetime]$WeekStart,
        [int]$Limit
    )
    
    $weekStartStr = $WeekStart.ToString('yyyy-MM-dd')
    
    $categoryQueries = @{
        "kills" = "SELECT u.name, (COALESCE(current.enemy_kills, 0) - COALESCE(ws.enemy_kills, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN events_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.enemy_kills, 0) - COALESCE(ws.enemy_kills, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        
        "deaths" = "SELECT u.name, (COALESCE(current.deaths, 0) - COALESCE(ws.deaths, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN events_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.deaths, 0) - COALESCE(ws.deaths, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        
        "playtime" = "SELECT u.name, (COALESCE(u.play_time, 0) - COALESCE(ws.play_time, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' WHERE (COALESCE(u.play_time, 0) - COALESCE(ws.play_time, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        
        "fame" = "SELECT u.name, (COALESCE(u.fame_points, 0) - COALESCE(ws.fame_points, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' WHERE (COALESCE(u.fame_points, 0) - COALESCE(ws.fame_points, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        
        "money" = "SELECT u.name, (COALESCE(u.money_balance, 0) - COALESCE(ws.money_balance, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' WHERE (COALESCE(u.money_balance, 0) - COALESCE(ws.money_balance, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        
        "events" = "SELECT u.name, (COALESCE(current.events_won, 0) - COALESCE(ws.events_won, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN events_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.events_won, 0) - COALESCE(ws.events_won, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        
        "headshots" = "SELECT u.name, (COALESCE(current.headshots, 0) - COALESCE(ws.headshots, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.headshots, 0) - COALESCE(ws.headshots, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        
        "team_kills" = "SELECT u.name, (COALESCE(current.team_kills, 0) - COALESCE(ws.team_kills, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN events_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.team_kills, 0) - COALESCE(ws.team_kills, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        
        "animal_kills" = "SELECT u.name, (COALESCE(current.animals_killed, 0) - COALESCE(ws.animals_killed, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.animals_killed, 0) - COALESCE(ws.animals_killed, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        
        "puppet_kills" = "SELECT u.name, (COALESCE(current.puppets_killed, 0) - COALESCE(ws.puppets_killed, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.puppets_killed, 0) - COALESCE(ws.puppets_killed, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        
        "drone_kills" = "SELECT u.name, (COALESCE(current.drone_kills, 0) - COALESCE(ws.drone_kills, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.drone_kills, 0) - COALESCE(ws.drone_kills, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        
        "sentry_kills" = "SELECT u.name, (COALESCE(current.sentry_kills, 0) - COALESCE(ws.sentry_kills, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.sentry_kills, 0) - COALESCE(ws.sentry_kills, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        
        "locks_picked" = "SELECT u.name, (COALESCE(current.locks_picked, 0) - COALESCE(ws.locks_picked, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.locks_picked, 0) - COALESCE(ws.locks_picked, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        
        "guns_crafted" = "SELECT u.name, (COALESCE(current.guns_crafted, 0) - COALESCE(ws.guns_crafted, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.guns_crafted, 0) - COALESCE(ws.guns_crafted, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        
        "bullets_crafted" = "SELECT u.name, (COALESCE(current.bullets_crafted, 0) - COALESCE(ws.bullets_crafted, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.bullets_crafted, 0) - COALESCE(ws.bullets_crafted, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        
        "melee_crafted" = "SELECT u.name, (COALESCE(current.melee_weapons_crafted, 0) - COALESCE(ws.melee_weapons_crafted, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.melee_weapons_crafted, 0) - COALESCE(ws.melee_weapons_crafted, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        
        "clothing_crafted" = "SELECT u.name, (COALESCE(current.clothing_crafted, 0) - COALESCE(ws.clothing_crafted, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.clothing_crafted, 0) - COALESCE(ws.clothing_crafted, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        
        "fish_caught" = "SELECT u.name, (COALESCE(current.fish_caught, 0) - COALESCE(ws.fish_caught, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN fishing_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.fish_caught, 0) - COALESCE(ws.fish_caught, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        
        "kdr" = "SELECT u.name, CASE WHEN COALESCE(current.deaths, 0) > 0 THEN CAST(COALESCE(current.enemy_kills, 0) AS REAL) / COALESCE(current.deaths, 0) ELSE COALESCE(current.enemy_kills, 0) END - CASE WHEN COALESCE(ws.deaths, 0) > 0 THEN CAST(COALESCE(ws.enemy_kills, 0) AS REAL) / COALESCE(ws.deaths, 0) ELSE COALESCE(ws.enemy_kills, 0) END as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN events_stats current ON u.id = current.user_profile_id ORDER BY delta DESC LIMIT $Limit"
        
        # Missing categories for weekly leaderboards
        "squad_score" = "SELECT s.name, (COALESCE(s.score, 0) - COALESCE(ws.squad_score, 0)) as delta FROM squads s LEFT JOIN weekly_snapshots ws ON s.id = ws.squad_id AND ws.week_start_date = '$weekStartStr' WHERE (COALESCE(s.score, 0) - COALESCE(ws.squad_score, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        
        "squad_members" = "SELECT s.name, (COALESCE(s.members_count, 0) - COALESCE(ws.squad_members, 0)) as delta FROM squads s LEFT JOIN weekly_snapshots ws ON s.id = ws.squad_id AND ws.week_start_date = '$weekStartStr' WHERE (COALESCE(s.members_count, 0) - COALESCE(ws.squad_members, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        
        "minutes_survived" = "SELECT u.name, (COALESCE(current.minutes_survived, 0) - COALESCE(ws.minutes_survived, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.minutes_survived, 0) - COALESCE(ws.minutes_survived, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        
        # Weapon-specific kills for weekly tracking
        "melee_kills" = "SELECT u.name, (COALESCE(current.melee_kills, 0) - COALESCE(ws.melee_kills, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN weapons_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.melee_kills, 0) - COALESCE(ws.melee_kills, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        
        "bow_kills" = "SELECT u.name, (COALESCE(current.bow_kills, 0) - COALESCE(ws.bow_kills, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN weapons_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.bow_kills, 0) - COALESCE(ws.bow_kills, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        
        "sniper_kills" = "SELECT u.name, (COALESCE(current.sniper_kills, 0) - COALESCE(ws.sniper_kills, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN weapons_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.sniper_kills, 0) - COALESCE(ws.sniper_kills, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        
        "items_looted" = "SELECT u.name, (COALESCE(current.items_looted, 0) - COALESCE(ws.items_looted, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.items_looted, 0) - COALESCE(ws.items_looted, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
    }
    
    return $categoryQueries[$Category]
}

function Format-WeeklyValue {
    <#
    .SYNOPSIS
    Format a weekly delta value for display
    #>
    param(
        [string]$Category,
        [int]$Value
    )
    
    switch ($Category) {
        "playtime" { 
            $hours = [math]::Round($Value / 3600, 1)
            return "+${hours}h"
        }
        "minutes_survived" {
            $hours = [math]::Round($Value / 60, 1)
            return "+${hours}h survived"
        }
        "kdr" {
            $kdr = [math]::Round($Value, 2)
            return "+$kdr K/D"
        }
        "kills" { return "+$Value kills" }
        "deaths" { return "+$Value deaths" }
        "fame" { return "+$Value fame" }
        "money" { return "+$Value credits" }
        "events" { return "+$Value events" }
        "headshots" { return "+$Value headshots" }
        "team_kills" { return "+$Value team kills" }
        "animal_kills" { return "+$Value animals" }
        "puppet_kills" { return "+$Value puppets" }
        "drone_kills" { return "+$Value drones" }
        "sentry_kills" { return "+$Value sentries" }
        "locks_picked" { return "+$Value locks" }
        "guns_crafted" { return "+$Value guns" }
        "bullets_crafted" { return "+$Value bullets" }
        "melee_crafted" { return "+$Value melee" }
        "clothing_crafted" { return "+$Value clothing" }
        "fish_caught" { return "+$Value fish" }
        default { return "+$Value" }
    }
}

function Invoke-WeeklyDatabaseQuery {
    <#
    .SYNOPSIS
    Execute a query against the weekly leaderboards database
    #>
    param(
        [Parameter(Mandatory)]
        [string]$Query,
        [Parameter(Mandatory)]
        [string]$DatabasePath
    )
    
    try {
        if (-not $script:SqliteExePath -or -not (Test-Path $script:SqliteExePath)) {
            throw "External SQLite executable not found"
        }
        
        # Create temporary file for the output
        $tempOutputFile = [System.IO.Path]::GetTempFileName()
        
        try {
            # Execute sqlite3.exe against weekly database
            $arguments = @(
                $DatabasePath
                "-csv"
                "-header"
                $Query
            )
            
            $processInfo = New-Object System.Diagnostics.ProcessStartInfo
            $processInfo.FileName = $script:SqliteExePath
            $processInfo.Arguments = ($arguments | ForEach-Object { if ($_ -match '\s') { "`"$_`"" } else { $_ } }) -join ' '
            $processInfo.UseShellExecute = $false
            $processInfo.RedirectStandardOutput = $true
            $processInfo.RedirectStandardError = $true
            $processInfo.CreateNoWindow = $true
            
            Write-Verbose "[Database] Executing weekly query: $($processInfo.FileName) $($processInfo.Arguments)"
            
            $process = New-Object System.Diagnostics.Process
            $process.StartInfo = $processInfo
            $process.Start() | Out-Null
            
            $stdout = $process.StandardOutput.ReadToEnd()
            $stderr = $process.StandardError.ReadToEnd()
            $process.WaitForExit()
            
            if ($process.ExitCode -ne 0) {
                throw "SQLite error: $stderr"
            }
            
            # Parse CSV output from stdout
            if ([string]::IsNullOrWhiteSpace($stdout)) {
                return @{ Success = $true; Data = @(); Count = 0 }
            }
            
            # Parse CSV output
            $results = @()
            $lines = $stdout -split "`r?`n" | Where-Object { $_ -and $_.Trim() }
            
            if ($lines.Count -gt 1) {
                $headers = $lines[0] -split ','
                
                for ($i = 1; $i -lt $lines.Count; $i++) {
                    $values = $lines[$i] -split ','
                    $row = @{}
                    
                    for ($j = 0; $j -lt [Math]::Min($headers.Count, $values.Count); $j++) {
                        $columnName = $headers[$j].Trim('"')
                        $columnValue = $values[$j].Trim('"')
                        
                        # Try to convert numeric values
                        if ($columnValue -match '^\d+$') {
                            $row[$columnName] = [int]$columnValue
                        } elseif ($columnValue -match '^\d+\.\d+$') {
                            $row[$columnName] = [double]$columnValue
                        } else {
                            $row[$columnName] = $columnValue
                        }
                    }
                    
                    $results += $row
                }
            } elseif ($lines.Count -eq 1) {
                # Only headers, no data
                return @{ Success = $true; Data = @(); Count = 0 }
            }
            
            return @{ Success = $true; Data = $results; Count = $results.Count }
            
        } finally {
            # Clean up temp files
            if (Test-Path $tempOutputFile) { Remove-Item $tempOutputFile -Force -ErrorAction SilentlyContinue }
        }
        
    } catch {
        Write-Verbose "[Database] Weekly SQLite query failed: $($_.Exception.Message)"
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

# ===================================================
# WEEKLY SNAPSHOT AND RESET LOGIC
# ===================================================

function Update-WeeklySnapshot {
    <#
    .SYNOPSIS
    Take a snapshot of current player statistics for weekly tracking
    Called automatically every Monday or when needed
    #>
    param(
        [datetime]$WeekStartDate = (Get-CurrentWeekStart)
    )
    
    try {
        $weeklyDbPath = ".\data\weekly_leaderboards.db"
        
        # Create data directory if it doesn't exist
        $dataDir = ".\data"
        if (-not (Test-Path $dataDir)) {
            New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
        }
        
        # Create weekly database if it doesn't exist
        if (-not (Test-Path $weeklyDbPath)) {
            Write-Log "[Leaderboards] Creating weekly leaderboards database at: $weeklyDbPath"
            
            # Create the database with required tables
            $createDbQuery = @"
CREATE TABLE IF NOT EXISTS weekly_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_profile_id INTEGER NOT NULL,
    week_start_date TEXT NOT NULL,
    locks_picked INTEGER DEFAULT 0,
    puppets_killed INTEGER DEFAULT 0,
    headshots INTEGER DEFAULT 0,
    drone_kills INTEGER DEFAULT 0,
    sentry_kills INTEGER DEFAULT 0,
    animals_killed INTEGER DEFAULT 0,
    longest_kill_distance REAL DEFAULT 0.0,
    melee_kills INTEGER DEFAULT 0,
    archery_kills INTEGER DEFAULT 0,
    minutes_survived REAL DEFAULT 0.0,
    wounds_patched INTEGER DEFAULT 0,
    guns_crafted INTEGER DEFAULT 0,
    bullets_crafted INTEGER DEFAULT 0,
    arrows_crafted INTEGER DEFAULT 0,
    clothing_crafted INTEGER DEFAULT 0,
    containers_looted INTEGER DEFAULT 0,
    distance_travelled_by_foot REAL DEFAULT 0.0,
    fame_points REAL DEFAULT 0.0,
    fish_caught INTEGER DEFAULT 0,
    events_won INTEGER DEFAULT 0,
    money_balance INTEGER DEFAULT 0,
    play_time INTEGER DEFAULT 0,
    enemy_kills INTEGER DEFAULT 0,
    deaths INTEGER DEFAULT 0,
    team_kills INTEGER DEFAULT 0,
    melee_weapons_crafted INTEGER DEFAULT 0,
    snapshot_date TEXT,
    UNIQUE(user_profile_id, week_start_date)
);

CREATE INDEX IF NOT EXISTS idx_weekly_snapshots_user_week ON weekly_snapshots(user_profile_id, week_start_date);
CREATE INDEX IF NOT EXISTS idx_weekly_snapshots_week ON weekly_snapshots(week_start_date);

CREATE TABLE IF NOT EXISTS current_week_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_start_date TEXT UNIQUE NOT NULL,
    week_end_date TEXT NOT NULL,
    created_date TEXT NOT NULL
);
"@
            
            $createResult = Invoke-WeeklyDatabaseQuery -Query $createDbQuery -DatabasePath $weeklyDbPath
            if (-not $createResult.Success) {
                Write-Warning "Failed to create weekly database: $($createResult.Error)"
                return $false
            }
        }
        
        $weekStartStr = $WeekStartDate.ToString('yyyy-MM-dd')
        $weekEndDate = $WeekStartDate.AddDays(7)
        $weekEndStr = $weekEndDate.ToString('yyyy-MM-dd')
        
        Write-Log "[Leaderboards] Taking weekly snapshot for week starting: $weekStartStr"
        
        # Check if we already have a snapshot for this week
        $checkQuery = "SELECT COUNT(*) as count FROM weekly_snapshots WHERE week_start_date = '$weekStartStr'"
        $checkResult = Invoke-WeeklyDatabaseQuery -Query $checkQuery -DatabasePath $weeklyDbPath
        
        if ($checkResult.Success -and $checkResult.Data.Count -gt 0 -and $checkResult.Data[0].count -gt 0) {
            Write-Log "[Leaderboards] Snapshot already exists for week $weekStartStr"
            return $true
        }
        
        # Insert current week info
        $insertWeekQuery = "INSERT OR REPLACE INTO current_week_info (week_start_date, week_end_date, created_date) VALUES ('$weekStartStr', '$weekEndStr', '$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')')"
        $weekResult = Invoke-WeeklyDatabaseQuery -Query $insertWeekQuery -DatabasePath $weeklyDbPath
        
        if (-not $weekResult.Success) {
            Write-Warning "Failed to insert week info: $($weekResult.Error)"
            return $false
        }
        
        # Build the comprehensive snapshot query - attach the weekly database to the main database
        $attachQuery = @"
ATTACH DATABASE '$weeklyDbPath' AS weekly;
INSERT INTO weekly.weekly_snapshots (
    user_profile_id, week_start_date,
    play_time, fame_points, money_balance,
    enemy_kills, deaths, events_won, team_kills,
    headshots, animals_killed, puppets_killed, drone_kills, sentry_kills,
    locks_picked, guns_crafted, bullets_crafted, melee_weapons_crafted, clothing_crafted,
    fish_caught, minutes_survived, containers_looted, melee_kills, archery_kills,
    wounds_patched, distance_travelled_by_foot, arrows_crafted, longest_kill_distance, snapshot_date
)
SELECT 
    u.id,
    '$weekStartStr',
    COALESCE(u.play_time, 0),
    COALESCE(u.fame_points, 0),
    COALESCE(u.money_balance, 0),
    COALESCE(e.enemy_kills, 0),
    COALESCE(e.deaths, 0),
    COALESCE(e.events_won, 0),
    COALESCE(e.team_kills, 0),
    COALESCE(s.headshots, 0),
    COALESCE(s.animals_killed, 0),
    COALESCE(s.puppets_killed, 0),
    COALESCE(s.drone_kills, 0),
    COALESCE(s.sentry_kills, 0),
    COALESCE(s.locks_picked, 0),
    COALESCE(s.guns_crafted, 0),
    COALESCE(s.bullets_crafted, 0),
    COALESCE(s.melee_weapons_crafted, 0),
    COALESCE(s.clothing_crafted, 0),
    COALESCE(f.fish_caught, 0),
    COALESCE(s.minutes_survived, 0),
    COALESCE(s.containers_looted, 0),
    COALESCE(s.melee_kills, 0),
    COALESCE(s.archery_kills, 0),
    COALESCE(s.wounds_patched, 0),
    COALESCE(s.distance_travelled_by_foot, 0),
    COALESCE(s.arrows_crafted, 0),
    COALESCE(s.longest_kill_distance, 0),
    '$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')'
FROM user_profile u
LEFT JOIN events_stats e ON u.id = e.user_profile_id
LEFT JOIN survival_stats s ON u.id = s.user_profile_id  
LEFT JOIN fishing_stats f ON u.id = f.user_profile_id
WHERE u.type != 2;
DETACH DATABASE weekly;
"@
        
        # Execute the attach query against the main database
        $snapshotResult = Invoke-DatabaseQuery -Query $attachQuery
        
        if ($snapshotResult.Success) {
            Write-Log "[Leaderboards] Weekly snapshot completed successfully for week $weekStartStr"
            return $true
        } else {
            Write-Warning "Failed to create weekly snapshot: $($snapshotResult.Error)"
            return $false
        }
        
    } catch {
        Write-Warning "Error during weekly snapshot: $($_.Exception.Message)"
        return $false
    }
}

function Test-WeeklyResetNeeded {
    <#
    .SYNOPSIS
    Check if a weekly reset is needed (every Monday)
    #>
    
    try {
        $weeklyDbPath = ".\data\weekly_leaderboards.db"
        
        # Create data directory if it doesn't exist
        $dataDir = ".\data"
        if (-not (Test-Path $dataDir)) {
            New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
        }
        
        if (-not (Test-Path $weeklyDbPath)) {
            return $true # Need to create initial snapshot
        }
        
        $currentWeekStart = Get-CurrentWeekStart
        $currentWeekStartStr = $currentWeekStart.ToString('yyyy-MM-dd')
        
        # Check if we have current week data
        $checkQuery = "SELECT COUNT(*) as count FROM current_week_info WHERE week_start_date = '$currentWeekStartStr'"
        $result = Invoke-WeeklyDatabaseQuery -Query $checkQuery -DatabasePath $weeklyDbPath
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            return $result.Data[0].count -eq 0
        }
        
        return $true
        
    } catch {
        Write-Verbose "Error checking weekly reset status: $($_.Exception.Message)"
        return $true # Default to needing reset if there's an error
    }
}

function Invoke-WeeklyReset {
    <#
    .SYNOPSIS
    Perform weekly reset - take snapshot and prepare for new week
    #>
    
    try {
        Write-Log "[Leaderboards] Starting weekly reset process..."
        
        $currentWeekStart = Get-CurrentWeekStart
        $success = Update-WeeklySnapshot -WeekStartDate $currentWeekStart
        
        if ($success) {
            Write-Log "[Leaderboards] Weekly reset completed successfully"
            return $true
        } else {
            Write-Warning "Weekly reset failed"
            return $false
        }
        
    } catch {
        Write-Warning "Error during weekly reset: $($_.Exception.Message)"
        return $false
    }
}

# Export functions
Export-ModuleMember -Function @(
    'Initialize-DatabaseModule',
    'Test-SQLiteAvailability', 
    'Test-DatabaseConnection',
    'Invoke-DatabaseQuery',
    'Invoke-DatabaseQuerySet',
    'Get-DatabaseTables',
    'Get-OnlinePlayers',
    'Get-PlayerInfo',
    'Get-VehicleInfo', 
    'Get-ServerStatistics',
    'Clear-DatabaseCache',
    'Get-TotalPlayerCount',
    'Get-OnlinePlayerCount',
    'Get-ActiveSquadCount',
    'Get-GameTimeData',
    'Get-WeatherData',
    'Get-VehicleCount',
    'Get-BaseCount',
    'Get-TotalKills',
    'Get-TotalDeaths',
    'Get-TotalPlaytime',
    'Get-ActiveSquadsCount',
    'Invoke-LeaderboardQuery',
    # NEW LEADERBOARD SYSTEM - 19 Categories
    'Get-TopKills',
    'Get-TopDeaths',
    'Get-TopPlaytime',
    'Get-TopFame',
    'Get-TopMoney',
    'Get-TopDistance',
    'Get-TopEvents',
    'Get-TopKDR',
    'Get-TopHeadshots',
    'Get-TopTeamKills',
    'Get-TopAnimalKills',
    'Get-TopPuppetKills',
    'Get-TopDroneKills',
    'Get-TopSentryKills',
    'Get-TopLockpickers',
    'Get-TopGunCrafters',
    'Get-TopBulletCrafters',
    'Get-TopMeleeCrafters',
    'Get-TopClothingCrafters',
    'Get-TopFishers',
    'Get-TopSquads',
    'Get-TopSquadLeaders',
    'Get-TopSniper',
    'Get-TopMeleeWarriors', 
    'Get-TopArchers',
    'Get-TopSurvivors',
    'Get-TopMedics',
    'Get-TopLooters',
    'Get-TopAllCrafters',
    # Weekly and Combined Functions
    'Get-WeeklyLeaderboard',
    'Get-AllLeaderboardData',
    'Get-CurrentWeekStart',
    'Invoke-WeeklyDatabaseQuery',
    'Update-WeeklySnapshot',
    'Test-WeeklyResetNeeded',
    'Invoke-WeeklyReset'
)
