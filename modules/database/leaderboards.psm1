# ===============================================================
# SCUM Server Automation - Leaderboards Management Module
# ===============================================================

#Requires -Version 5.1

# Standard import of common module
try {
    $helperPath = Join-Path $PSScriptRoot "..\core\module-helper.psm1"
    if (Test-Path $helperPath) {
        Import-Module $helperPath -Force -ErrorAction SilentlyContinue
        Import-CommonModule | Out-Null
    }
} catch {
    Write-Host "[WARNING] Common module not available for leaderboards database module" -ForegroundColor Yellow
}

# Module variables
$script:DatabasePath = $null
$script:SqliteExePath = $null
$script:WeeklyDbPath = $null

# Module initialization function
function Initialize-LeaderboardsModule {
    param([string]$DatabasePath, [string]$SqliteExePath)
    
    try {
        $script:DatabasePath = $DatabasePath
        $script:SqliteExePath = $SqliteExePath
        $script:WeeklyDbPath = ".\data\weekly_leaderboards.db"
        
        Write-Log "[Leaderboards] Module initialized successfully"
        Write-Log "[Leaderboards] Main Database: $DatabasePath"
        Write-Log "[Leaderboards] Weekly Database: $script:WeeklyDbPath"
        
        return @{ Success = $true }
    } catch {
        Write-Log "[Leaderboards] Failed to initialize: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

# ===============================================================
# LEADERBOARD QUERY INTERFACE
# ===============================================================

function Invoke-LeaderboardQuery {
    <#
    .SYNOPSIS
    Execute a leaderboard query with specific formatting and limits
    
    .DESCRIPTION
    This function executes database queries specifically for leaderboards,
    applying consistent formatting and error handling across all leaderboard types.
    
    .PARAMETER Query
    The SQL query to execute
    
    .PARAMETER Limit
    Maximum number of results to return (default: 10)
    
    .PARAMETER WeeklyOnly
    If true, queries the weekly database instead of main database
    #>
    param(
        [string]$Query,
        [int]$Limit = 10,
        [switch]$WeeklyOnly
    )
    
    try {
        $targetDb = if ($WeeklyOnly) { $script:WeeklyDbPath } else { $script:DatabasePath }
        
        if ($WeeklyOnly -and -not (Test-Path $script:WeeklyDbPath)) {
            return @{ Success = $false; Error = "Weekly database not found" }
        }
        
        # Apply limit to query if not already present
        if ($Query -notmatch "LIMIT\s+\d+") {
            $Query += " LIMIT $Limit"
        }
        
        $result = Invoke-DatabaseQuery -Query $Query -DatabasePath $targetDb
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            return @{
                Success = $true
                Data = $result.Data
                Count = $result.Data.Count
            }
        } else {
            return @{
                Success = $true
                Data = @()
                Count = 0
            }
        }
    } catch {
        Write-Log "[Leaderboards] Query failed: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
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
        if (-not (Test-Path $script:WeeklyDbPath)) {
            Write-Verbose "Weekly leaderboards database not found at: $script:WeeklyDbPath"
            return @()
        }
        
        # Get current week start date
        $currentWeekStart = Get-CurrentWeekStart
        $weekStartStr = $currentWeekStart.ToString('yyyy-MM-dd')
        
        # For weekly leaderboards, we need delta calculations
        # Use existing functions to get current data and subtract snapshot values
        $result = Get-WeeklyDeltaResults -Category $Category -WeekStart $currentWeekStart -Limit $Limit
        
        if ($result -and $result.Count -gt 0) {
            $formattedResults = @()
            $result | ForEach-Object {
                $formattedResults += @{
                    Name = $_.name
                    Value = [int]$_.delta
                    FormattedValue = Format-WeeklyValue -Category $Category -Value ([int]$_.delta)
                }
            }
            return ,$formattedResults  # Comma operator ensures array is returned even with single item
        }
        
        return @()
        
    } catch {
        Write-Verbose "Failed to get weekly leaderboard for $Category : $($_.Exception.Message)"
        return @()
    }
}

function Get-WeeklyDeltaResults {
    <#
    .SYNOPSIS
    Calculate weekly deltas by using direct SQL queries
    #>
    param(
        [string]$Category,
        [datetime]$WeekStart,
        [int]$Limit
    )
    
    try {
        # For now, delegate all categories to direct SQL approach
        # This is simpler and more reliable than trying to combine existing functions with snapshots
        return Get-WeeklyDeltaDirectSQL -Category $Category -WeekStart $WeekStart -Limit $Limit
        
    } catch {
        Write-Verbose "Failed to calculate weekly deltas for $Category : $($_.Exception.Message)"
        return @()
    }
}

function Get-WeeklyDeltaDirectSQL {
    <#
    .SYNOPSIS
    Handle special weekly categories that require direct SQL (KDR, squads, etc.)
    #>
    param(
        [string]$Category,
        [datetime]$WeekStart,
        [int]$Limit
    )
    
    try {
        $weekStartStr = $WeekStart.ToString('yyyy-MM-dd')
        
        # Special queries for complex categories
        $specialQueries = @{
            "squads" = "SELECT s.name, (COALESCE(s.score, 0) - COALESCE(ws.squad_score, 0)) as delta FROM squad s LEFT JOIN weekly_snapshots ws ON s.name = ws.squad_name AND ws.week_start_date = '$weekStartStr' AND ws.user_profile_id < 0 WHERE (COALESCE(s.score, 0) - COALESCE(ws.squad_score, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"            
            "minutes_survived" = "SELECT u.name, (COALESCE(current.minutes_survived, 0) - COALESCE(ws.minutes_survived, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.minutes_survived, 0) - COALESCE(ws.minutes_survived, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "fame" = "SELECT u.name, (COALESCE(u.fame_points, 0) - COALESCE(ws.fame_points, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' WHERE (COALESCE(u.fame_points, 0) - COALESCE(ws.fame_points, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "money" = "SELECT u.name, (COALESCE(barc.account_balance, 0) - COALESCE(ws.money_balance, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN bank_account_registry bar ON u.id = bar.account_owner_user_profile_id LEFT JOIN bank_account_registry_currencies barc ON bar.id = barc.bank_account_id AND barc.currency_type = 1 WHERE (COALESCE(barc.account_balance, 0) - COALESCE(ws.money_balance, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "puppet_kills" = "SELECT u.name, (COALESCE(current.puppets_killed, 0) - COALESCE(ws.puppets_killed, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.puppets_killed, 0) - COALESCE(ws.puppets_killed, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "animal_kills" = "SELECT u.name, (COALESCE(current.animals_killed, 0) - COALESCE(ws.animals_killed, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.animals_killed, 0) - COALESCE(ws.animals_killed, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "melee_kills" = "SELECT u.name, (COALESCE(current.melee_kills, 0) - COALESCE(ws.melee_kills, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.melee_kills, 0) - COALESCE(ws.melee_kills, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "archery_kills" = "SELECT u.name, (COALESCE(current.archery_kills, 0) - COALESCE(ws.archery_kills, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.archery_kills, 0) - COALESCE(ws.archery_kills, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "longest_kill_distance" = "SELECT u.name, (COALESCE(current.longest_kill_distance, 0) - COALESCE(ws.longest_kill_distance, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.longest_kill_distance, 0) - COALESCE(ws.longest_kill_distance, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "headshots" = "SELECT u.name, (COALESCE(current.headshots, 0) - COALESCE(ws.headshots, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.headshots, 0) - COALESCE(ws.headshots, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "locks_picked" = "SELECT u.name, (COALESCE(current.locks_picked, 0) - COALESCE(ws.locks_picked, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.locks_picked, 0) - COALESCE(ws.locks_picked, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
            "containers_looted" = "SELECT u.name, (COALESCE(current.containers_looted, 0) - COALESCE(ws.containers_looted, 0)) as delta FROM user_profile u LEFT JOIN weekly_snapshots ws ON u.id = ws.user_profile_id AND ws.week_start_date = '$weekStartStr' LEFT JOIN survival_stats current ON u.id = current.user_profile_id WHERE (COALESCE(current.containers_looted, 0) - COALESCE(ws.containers_looted, 0)) > 0 ORDER BY delta DESC LIMIT $Limit"
        }
        
        $query = $specialQueries[$Category]
        if (-not $query) {
            Write-Verbose "No special query available for category: $Category"
            return @()
        }
        
        # Execute with ATTACH DATABASE
        $fullQuery = @"
ATTACH DATABASE '$script:WeeklyDbPath' AS weekly;
$query;
DETACH DATABASE weekly;
"@
        
        $result = Invoke-WeeklyDatabaseQuery -Query $fullQuery -DatabasePath $script:DatabasePath
        
        if ($result.Success -and $result.Data -and $result.Data.Count -gt 0) {
            return $result.Data
        }
        
        return @()
        
    } catch {
        Write-Verbose "Failed to get special weekly category $Category : $($_.Exception.Message)"
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
        "squads" { return "+$Value score" }
        "minutes_survived" {
            $hours = [math]::Round($Value / 60, 1)
            return "+${hours}h survived"
        }
        "fame" { return "+$Value fame" }
        "money" { return "+$Value credits" }
        "puppet_kills" { return "+$Value puppets" }
        "animal_kills" { return "+$Value animals" }
        "melee_kills" { return "+$Value melee kills" }
        "archery_kills" { return "+$Value bow kills" }
        "longest_kill_distance" { return "+${Value}m" }
        "headshots" { return "+$Value headshots" }
        "locks_picked" { return "+$Value locks" }
        "containers_looted" { return "+$Value containers" }
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
        # Create data directory if it doesn't exist
        $dataDir = Split-Path $script:WeeklyDbPath -Parent
        if (-not (Test-Path $dataDir)) {
            New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
        }
        
        # Create weekly database if it doesn't exist
        if (-not (Test-Path $script:WeeklyDbPath)) {
            try {
                Write-Log "[Leaderboards] Creating weekly leaderboards database at: $script:WeeklyDbPath" -Level Info
                
                # Create weekly database using external SQLite
                
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
    squad_name TEXT,
    squad_score INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
                
                $createResult = Invoke-WeeklyDatabaseQuery -Query $createDbQuery -DatabasePath $script:WeeklyDbPath
                if (-not $createResult.Success) {
                    Write-Log "Failed to create weekly database: $($createResult.Error)" -Level Error
                    return $false
                }
            } catch {
                Write-Log "Failed to create weekly database: $($_.Exception.Message)" -Level Error
                return $false
            }
        }
        
        $weekStartStr = $WeekStartDate.ToString('yyyy-MM-dd')
        $weekEndDate = $WeekStartDate.AddDays(7)
        $weekEndStr = $weekEndDate.ToString('yyyy-MM-dd')
        
        Write-Log "[Leaderboards] Taking weekly snapshot for week starting: $weekStartStr" -Level Info
        
        # Check if we already have a snapshot for this week
        $checkQuery = "SELECT COUNT(*) as count FROM weekly_snapshots WHERE week_start_date = '$weekStartStr'"
        $checkResult = Invoke-WeeklyDatabaseQuery -Query $checkQuery -DatabasePath $script:WeeklyDbPath
        
        if ($checkResult.Success -and $checkResult.Data.Count -gt 0 -and $checkResult.Data[0].count -gt 0) {
            Write-Log "[Leaderboards] Snapshot already exists for week $weekStartStr" -Level Info
            return $true
        }
        
        # Check if this is the first snapshot ever (newly created DB)
        $totalSnapshotsQuery = "SELECT COUNT(*) as total FROM weekly_snapshots"
        $totalResult = Invoke-WeeklyDatabaseQuery -Query $totalSnapshotsQuery -DatabasePath $script:WeeklyDbPath
        $isFirstSnapshot = ($totalResult.Success -and $totalResult.Data.Count -gt 0 -and $totalResult.Data[0].total -eq 0)
        
        # Insert current week info
        $insertWeekQuery = "INSERT OR REPLACE INTO current_week_info (week_start_date, week_end_date, created_date) VALUES ('$weekStartStr', '$weekEndStr', '$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')')"
        $weekResult = Invoke-WeeklyDatabaseQuery -Query $insertWeekQuery -DatabasePath $script:WeeklyDbPath
        
        if (-not $weekResult.Success) {
            Write-Log "Failed to insert week info: $($weekResult.Error)" -Level Error
            return $false
        }
        
        # Build the comprehensive snapshot query - attach the weekly database to the main database
        if ($isFirstSnapshot) {
            Write-Log "[Leaderboards] Creating first snapshot with current values as baseline for weekly tracking" -Level Info
            # For the first snapshot, capture current values as baseline - future changes will be deltas
            $attachQuery = @"
ATTACH DATABASE '$script:WeeklyDbPath' AS weekly;
INSERT INTO weekly.weekly_snapshots (
    user_profile_id, week_start_date,
    play_time, fame_points, money_balance,
    enemy_kills, deaths, events_won, team_kills,
    headshots, animals_killed, puppets_killed, drone_kills, sentry_kills,
    locks_picked, guns_crafted, bullets_crafted, melee_weapons_crafted, clothing_crafted,
    fish_caught, minutes_survived, containers_looted, melee_kills, archery_kills,
    wounds_patched, distance_travelled_by_foot, arrows_crafted, longest_kill_distance, updated_at
)
SELECT 
    u.id,
    '$weekStartStr',
    COALESCE(u.play_time, 0),
    COALESCE(u.fame_points, 0),
    COALESCE(barc.account_balance, 0),
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
LEFT JOIN bank_account_registry bar ON u.id = bar.account_owner_user_profile_id
LEFT JOIN bank_account_registry_currencies barc ON bar.id = barc.bank_account_id AND barc.currency_type = 1
WHERE u.type != 2;
DETACH DATABASE weekly;
"@
        } else {
            # For subsequent snapshots, copy current values
            $attachQuery = @"
ATTACH DATABASE '$script:WeeklyDbPath' AS weekly;
INSERT INTO weekly.weekly_snapshots (
    user_profile_id, week_start_date,
    play_time, fame_points, money_balance,
    enemy_kills, deaths, events_won, team_kills,
    headshots, animals_killed, puppets_killed, drone_kills, sentry_kills,
    locks_picked, guns_crafted, bullets_crafted, melee_weapons_crafted, clothing_crafted,
    fish_caught, minutes_survived, containers_looted, melee_kills, archery_kills,
    wounds_patched, distance_travelled_by_foot, arrows_crafted, longest_kill_distance, updated_at
)
SELECT 
    u.id,
    '$weekStartStr',
    COALESCE(u.play_time, 0),
    COALESCE(u.fame_points, 0),
    COALESCE(barc.account_balance, 0),
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
LEFT JOIN bank_account_registry bar ON u.id = bar.account_owner_user_profile_id
LEFT JOIN bank_account_registry_currencies barc ON bar.id = barc.bank_account_id AND barc.currency_type = 1
WHERE u.type != 2;
DETACH DATABASE weekly;
"@
        }
        
        # Execute the attach query against the main database using direct sqlite call
        $snapshotResult = Invoke-WeeklyDatabaseQuery -Query $attachQuery -DatabasePath $script:DatabasePath
        
        if ($snapshotResult.Success) {
            # Also create squad snapshots
            if ($isFirstSnapshot) {
                Write-Log "[Leaderboards] Creating first squad snapshots with current values" -Level Info
                $squadSnapshotQuery = @"
ATTACH DATABASE '$script:WeeklyDbPath' AS weekly;
INSERT OR REPLACE INTO weekly.weekly_snapshots (user_profile_id, week_start_date, squad_name, squad_score, updated_at)
SELECT 
    -(ROW_NUMBER() OVER (ORDER BY s.name)),  -- Unique negative ID for each squad
    '$weekStartStr',
    s.name,
    COALESCE(s.score, 0),  -- Current score for first snapshot
    '$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')'
FROM squad s
WHERE s.score > 0;
DETACH DATABASE weekly;
"@
            } else {
                $squadSnapshotQuery = @"
ATTACH DATABASE '$script:WeeklyDbPath' AS weekly;
INSERT OR REPLACE INTO weekly.weekly_snapshots (user_profile_id, week_start_date, squad_name, squad_score, updated_at)
SELECT 
    -(ROW_NUMBER() OVER (ORDER BY s.name)),  -- Unique negative ID for each squad
    '$weekStartStr',
    s.name,
    COALESCE(s.score, 0),
    '$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')'
FROM squad s
WHERE s.score > 0;
DETACH DATABASE weekly;
"@
            }
            
            $squadResult = Invoke-WeeklyDatabaseQuery -Query $squadSnapshotQuery -DatabasePath $script:DatabasePath
            if ($squadResult.Success) {
                Write-Log "[Leaderboards] Squad snapshots completed successfully" -Level Info
            } else {
                Write-Log "Failed to create squad snapshots: $($squadResult.Error)" -Level Error
            }
            
            Write-Log "[Leaderboards] Weekly snapshot completed successfully for week $weekStartStr" -Level Info
            return $true
        } else {
            Write-Log "Failed to create weekly snapshot: $($snapshotResult.Error)" -Level Error
            return $false
        }
        
    } catch {
        Write-Log "Error during weekly snapshot: $($_.Exception.Message)" -Level Error
        return $false
    }
}

function Test-WeeklyResetNeeded {
    <#
    .SYNOPSIS
    Check if a weekly reset is needed (every Monday)
    #>
    
    try {
        # Create data directory if it doesn't exist
        $dataDir = Split-Path $script:WeeklyDbPath -Parent
        if (-not (Test-Path $dataDir)) {
            New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
        }
        
        if (-not (Test-Path $script:WeeklyDbPath)) {
            return $true # Need to create initial snapshot
        }
        
        $currentWeekStart = Get-CurrentWeekStart
        $currentWeekStartStr = $currentWeekStart.ToString('yyyy-MM-dd')
        
        # Check if we have current week data
        $checkQuery = "SELECT COUNT(*) as count FROM current_week_info WHERE week_start_date = '$currentWeekStartStr'"
        $result = Invoke-WeeklyDatabaseQuery -Query $checkQuery -DatabasePath $script:WeeklyDbPath
        
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
        Write-Log "[Leaderboards] Starting weekly reset process..." -Level Info
        
        $currentWeekStart = Get-CurrentWeekStart
        $success = Update-WeeklySnapshot -WeekStartDate $currentWeekStart
        
        if ($success) {
            Write-Log "[Leaderboards] Weekly reset completed successfully" -Level Info
            return @{ Success = $true }
        } else {
            Write-Log "Weekly reset failed" -Level Error
            return @{ Success = $false; Error = "Snapshot creation failed" }
        }
        
    } catch {
        $errorMsg = "Error during weekly reset: $($_.Exception.Message)"
        Write-Log $errorMsg -Level Error
        return @{ Success = $false; Error = $errorMsg }
    }
}

function Reset-WeeklyLeaderboards {
    <#
    .SYNOPSIS
    Force reset weekly leaderboards with zero baseline values
    This creates a new snapshot with zero values so all current stats become weekly deltas
    #>
    param(
        [switch]$Force
    )
    
    try {
        if (-not $Force) {
            Write-Log "This will reset weekly leaderboards. All current stats will become this week's progress." -Level Warning
            Write-Log "Use -Force parameter to confirm this action." -Level Warning
            return @{ Success = $false; Error = "Force parameter required" }
        }
        
        if (-not (Test-Path $script:WeeklyDbPath)) {
            Write-Log "[Leaderboards] Weekly database not found. Creating new one..." -Level Warning
            $result = Update-WeeklySnapshot
            return @{ Success = $result }
        }
        
        $currentWeekStart = Get-CurrentWeekStart
        $weekStartStr = $currentWeekStart.ToString('yyyy-MM-dd')
        
        Write-Log "[Leaderboards] Force resetting weekly leaderboards with zero baseline" -Level Info
        
        # Delete existing snapshots for current week
        $deleteQuery = "DELETE FROM weekly_snapshots WHERE week_start_date = '$weekStartStr'"
        $deleteResult = Invoke-WeeklyDatabaseQuery -Query $deleteQuery -DatabasePath $script:WeeklyDbPath
        
        if (-not $deleteResult.Success) {
            $errorMsg = "Failed to delete existing snapshots: $($deleteResult.Error)"
            Write-Log $errorMsg -Level Error
            return @{ Success = $false; Error = $errorMsg }
        }
        
        # Force first snapshot behavior by deleting all snapshots
        $deleteAllQuery = "DELETE FROM weekly_snapshots"
        $deleteAllResult = Invoke-WeeklyDatabaseQuery -Query $deleteAllQuery -DatabasePath $script:WeeklyDbPath
        
        if (-not $deleteAllResult.Success) {
            $errorMsg = "Failed to clear snapshots: $($deleteAllResult.Error)"
            Write-Log $errorMsg -Level Error
            return @{ Success = $false; Error = $errorMsg }
        }
        
        # Now create new snapshot with zero values
        $success = Update-WeeklySnapshot -WeekStartDate $currentWeekStart
        
        if ($success) {
            Write-Log "[Leaderboards] Weekly leaderboards reset successfully with zero baseline" -Level Info
            return @{ Success = $true }
        } else {
            $errorMsg = "Failed to create new zero baseline snapshot"
            Write-Log $errorMsg -Level Error
            return @{ Success = $false; Error = $errorMsg }
        }
        
    } catch {
        $errorMsg = "Error during weekly leaderboards reset: $($_.Exception.Message)"
        Write-Log $errorMsg -Level Error
        return @{ Success = $false; Error = $errorMsg }
    }
}

# Export functions
Export-ModuleMember -Function @(
    'Initialize-LeaderboardsModule',
    'Invoke-LeaderboardQuery',
    'Get-WeeklyLeaderboard',
    'Get-CurrentWeekStart',
    'Get-WeeklyDeltaResults',
    'Get-WeeklyDeltaDirectSQL',
    'Format-WeeklyValue',
    'Invoke-WeeklyDatabaseQuery',
    'Update-WeeklySnapshot',
    'Test-WeeklyResetNeeded',
    'Invoke-WeeklyReset',
    'Reset-WeeklyLeaderboards'
)
