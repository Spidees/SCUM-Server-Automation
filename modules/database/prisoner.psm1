# ===============================================================
# SCUM Server Automation - Prisoner Database Module
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
    Write-Host "[WARNING] Common module not available for prisoner database module" -ForegroundColor Yellow
}

# Module variables
$script:DatabasePath = $null
$script:SqliteExePath = $null

# Module initialization function
function Initialize-PrisonerModule {
    param([string]$DatabasePath, [string]$SqliteExePath)
    
    try {
        $script:DatabasePath = $DatabasePath
        $script:SqliteExePath = $SqliteExePath
        
        Write-Log "[Prisoner] Module initialized successfully"
        Write-Log "[Prisoner] Database: $DatabasePath"
        return @{ Success = $true }
    } catch {
        Write-Log "[Prisoner] Failed to initialize: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

# Get online players (improved)
function Get-OnlinePlayers {
    param([switch]$UseCache)
    
    # Exclude admin/bot accounts (type = 2) and only players who logged in within last 24 hours
    $query = "SELECT u.name as PlayerName, u.user_id as SteamID, u.last_login_time, u.last_logout_time, u.play_time, u.fame_points FROM user_profile u WHERE u.type != 2 AND (u.last_login_time > u.last_logout_time OR u.last_logout_time IS NULL) AND datetime(u.last_login_time) > datetime('now', '-24 hours')"
    
    $result = Invoke-DatabaseQuery -Query $query
    if ($result.Success -and $result.Data.Count -gt 0) {
        return @{ Success = $true; Data = $result.Data; Count = $result.Data.Count }
    }
    
    return @{ Success = $false; Error = "No online players found" }
}

# Get player info by Steam ID (improved)
function Get-PlayerBySteamID {
    param([string]$SteamID)
    
    $escapedValue = $SteamID -replace "'", "''"
    $query = "SELECT u.*, p.is_alive, p.time_of_death, p.team_index, p.gender, p.age FROM user_profile u LEFT JOIN prisoner p ON u.prisoner_id = p.id WHERE u.user_id = '$escapedValue' AND u.type != 2"
    
    $result = Invoke-DatabaseQuery -Query $query
    if ($result.Success -and $result.Data.Count -gt 0) {
        return @{ Success = $true; Data = $result.Data[0] }
    }
    
    return @{ Success = $false; Error = "Player not found" }
}

# Get player info by name (improved)
function Get-PlayerByName {
    param([string]$PlayerName)
    
    $escapedValue = $PlayerName -replace "'", "''"
    $query = "SELECT u.*, p.is_alive, p.time_of_death, p.team_index, p.gender, p.age FROM user_profile u LEFT JOIN prisoner p ON u.prisoner_id = p.id WHERE u.name = '$escapedValue' AND u.type != 2"
    
    $result = Invoke-DatabaseQuery -Query $query
    if ($result.Success -and $result.Data.Count -gt 0) {
        return @{ Success = $true; Data = $result.Data[0] }
    }
    
    return @{ Success = $false; Error = "Player not found" }
}

# Get total player count (improved)
function Get-TotalPlayerCount {
    $result = Invoke-DatabaseQuery -Query "SELECT COUNT(*) as TotalCount FROM user_profile WHERE type != 2"
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data[0].TotalCount
    }
    
    return 0
}

# Get online player count (improved)
function Get-OnlinePlayerCount {
    $result = Invoke-DatabaseQuery -Query "SELECT COUNT(*) as OnlineCount FROM user_profile WHERE type != 2 AND (last_login_time > last_logout_time OR last_logout_time IS NULL) AND datetime(last_login_time) > datetime('now', '-24 hours')"
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data[0].OnlineCount
    }
    
    return 0
}

# Get recently active players
function Get-RecentlyActivePlayers {
    param([int]$Hours = 24, [int]$Limit = 50)
    
    $query = "SELECT u.name as PlayerName, u.user_id as SteamID, u.last_login_time, u.last_logout_time, u.play_time, u.fame_points FROM user_profile u WHERE u.type != 2 AND datetime(u.last_login_time) > datetime('now', '-$Hours hours') ORDER BY u.last_login_time DESC LIMIT $Limit"
    
    $result = Invoke-DatabaseQuery -Query $query
    if ($result.Success -and $result.Data.Count -gt 0) {
        return @{ Success = $true; Data = $result.Data; Count = $result.Data.Count }
    }
    
    return @{ Success = $false; Error = "No recently active players found" }
}

# Get top players by playtime
function Get-TopPlayersByPlaytime {
    param([int]$Limit = 10)
    
    $query = "SELECT u.name as PlayerName, u.user_id as SteamID, u.play_time, u.fame_points, u.creation_time FROM user_profile u WHERE u.type != 2 AND u.play_time > 0 ORDER BY u.play_time DESC LIMIT $Limit"
    
    $result = Invoke-DatabaseQuery -Query $query
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            $hours = [math]::Round($_.play_time / 3600, 1)
            @{
                Name = $_.PlayerName
                SteamID = $_.SteamID
                PlayTime = $_.play_time
                PlayTimeFormatted = "${hours}h"
                FamePoints = $_.fame_points
                CreationTime = $_.creation_time
            }
        }
    }
    
    return @()
}

# Get alive/dead prisoners statistics
function Get-PrisonerStatusStats {
    $aliveQuery = "SELECT COUNT(*) as AliveCount FROM prisoner p JOIN user_profile u ON p.user_profile_id = u.id WHERE u.type != 2 AND p.is_alive = 1"
    $deadQuery = "SELECT COUNT(*) as DeadCount FROM prisoner p JOIN user_profile u ON p.user_profile_id = u.id WHERE u.type != 2 AND p.is_alive = 0"
    
    $aliveResult = Invoke-DatabaseQuery -Query $aliveQuery
    $deadResult = Invoke-DatabaseQuery -Query $deadQuery
    
    $alive = if ($aliveResult.Success -and $aliveResult.Data.Count -gt 0) { $aliveResult.Data[0].AliveCount } else { 0 }
    $dead = if ($deadResult.Success -and $deadResult.Data.Count -gt 0) { $deadResult.Data[0].DeadCount } else { 0 }
    
    return @{
        Alive = $alive
        Dead = $dead
        Total = $alive + $dead
    }
}

# Get players by team
function Get-PlayersByTeam {
    param([int]$TeamIndex = -1)
    
    $query = if ($TeamIndex -eq -1) {
        "SELECT u.name as PlayerName, u.user_id as SteamID, p.team_index, p.is_alive, p.gender, p.age FROM user_profile u JOIN prisoner p ON u.prisoner_id = p.id WHERE u.type != 2 ORDER BY p.team_index, u.name"
    } else {
        "SELECT u.name as PlayerName, u.user_id as SteamID, p.team_index, p.is_alive, p.gender, p.age FROM user_profile u JOIN prisoner p ON u.prisoner_id = p.id WHERE u.type != 2 AND p.team_index = $TeamIndex ORDER BY u.name"
    }
    
    $result = Invoke-DatabaseQuery -Query $query
    if ($result.Success -and $result.Data.Count -gt 0) {
        return @{ Success = $true; Data = $result.Data; Count = $result.Data.Count }
    }
    
    return @{ Success = $false; Error = "No players found" }
}

# Get player demographics
function Get-PlayerDemographics {
    $genderQuery = "SELECT p.gender, COUNT(*) as Count FROM prisoner p JOIN user_profile u ON p.user_profile_id = u.id WHERE u.type != 2 GROUP BY p.gender"
    $ageQuery = "SELECT AVG(p.age) as AverageAge, MIN(p.age) as MinAge, MAX(p.age) as MaxAge FROM prisoner p JOIN user_profile u ON p.user_profile_id = u.id WHERE u.type != 2"
    
    $genderResult = Invoke-DatabaseQuery -Query $genderQuery
    $ageResult = Invoke-DatabaseQuery -Query $ageQuery
    
    $demographics = @{
        Gender = @{}
        Age = @{}
    }
    
    if ($genderResult.Success -and $genderResult.Data.Count -gt 0) {
        foreach ($row in $genderResult.Data) {
            $genderName = if ($row.gender -eq 0) { "Male" } else { "Female" }
            $demographics.Gender[$genderName] = $row.Count
        }
    }
    
    if ($ageResult.Success -and $ageResult.Data.Count -gt 0) {
        $demographics.Age = @{
            Average = [math]::Round($ageResult.Data[0].AverageAge, 1)
            Min = $ageResult.Data[0].MinAge
            Max = $ageResult.Data[0].MaxAge
        }
    }
    
    return $demographics
}

# Search players by partial name
function Search-PlayersByName {
    param([string]$SearchTerm, [int]$Limit = 20)
    
    $escapedTerm = $SearchTerm -replace "'", "''"
    $query = "SELECT u.name as PlayerName, u.user_id as SteamID, u.last_login_time, u.play_time, u.fame_points FROM user_profile u WHERE u.type != 2 AND u.name LIKE '%$escapedTerm%' ORDER BY u.name LIMIT $Limit"
    
    $result = Invoke-DatabaseQuery -Query $query
    if ($result.Success -and $result.Data.Count -gt 0) {
        return @{ Success = $true; Data = $result.Data; Count = $result.Data.Count }
    }
    
    return @{ Success = $false; Error = "No players found matching '$SearchTerm'" }
}

# Export functions
Export-ModuleMember -Function @(
    'Initialize-PrisonerModule',
    'Get-OnlinePlayers',
    'Get-PlayerBySteamID',
    'Get-PlayerByName',
    'Get-TotalPlayerCount',
    'Get-OnlinePlayerCount',
    'Get-RecentlyActivePlayers',
    'Get-TopPlayersByPlaytime',
    'Get-PrisonerStatusStats',
    'Get-PlayersByTeam',
    'Get-PlayerDemographics',
    'Search-PlayersByName'
)