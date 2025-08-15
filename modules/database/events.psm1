# ===============================================================
# SCUM Server Automation - Events Database Module
# ===============================================================

#Requires -Version 5.1

# Standard import of common module
try {
    $helperPath = Join-Path $PSScriptRoot "..\core\module-helper.psm1"
    if (Test-Path $helperPath) {
        # MEMORY LEAK FIX: Check if module already loaded before importing
        if (-not (Get-Module "module-helper" -ErrorAction SilentlyContinue)) {
            Import-Module $helperPath -ErrorAction SilentlyContinue
        }
        Import-CommonModule | Out-Null
    }
} catch {
    Write-Host "[WARNING] Common module not available for events database module" -ForegroundColor Yellow
}

# Module variables
$script:DatabasePath = $null
$script:SqliteExePath = $null

# Module initialization function
function Initialize-EventsModule {
    param([string]$DatabasePath, [string]$SqliteExePath)
    
    try {
        $script:DatabasePath = $DatabasePath
        $script:SqliteExePath = $SqliteExePath
        
        Write-Log "[Events] Module initialized successfully"
        Write-Log "[Events] Database: $DatabasePath"
        return @{ Success = $true }
    } catch {
        Write-Log "[Events] Failed to initialize: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

# Get top events
function Get-TopEventsWon {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, e.events_won as Score FROM user_profile u LEFT JOIN events_stats e ON u.id = e.user_profile_id WHERE e.events_won > 0 ORDER BY e.events_won DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) events"
            }
        }
    }
    return @()
}

# Get top team kills
function Get-TopTeamKills {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, e.team_kills as Score FROM user_profile u LEFT JOIN events_stats e ON u.id = e.user_profile_id WHERE e.team_kills > 0 ORDER BY e.team_kills DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) team kills"
            }
        }
    }
    return @()
}

# Get top events lost
function Get-TopEventsLost {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, e.events_lost as Score FROM user_profile u LEFT JOIN events_stats e ON u.id = e.user_profile_id WHERE e.events_lost > 0 ORDER BY e.events_lost DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) events lost"
            }
        }
    }
    return @()
}

# Get top kills from events
function Get-TopEventKills {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, e.enemy_kills as Score FROM user_profile u LEFT JOIN events_stats e ON u.id = e.user_profile_id WHERE e.enemy_kills > 0 ORDER BY e.enemy_kills DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) event kills"
            }
        }
    }
    return @()
}

# Get top deaths from events
function Get-TopEventDeaths {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, e.deaths as Score FROM user_profile u LEFT JOIN events_stats e ON u.id = e.user_profile_id WHERE e.deaths > 0 ORDER BY e.deaths DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) event deaths"
            }
        }
    }
    return @()
}

# Get top CTF captures
function Get-TopCTFCaptures {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, e.ctf_captures as Score FROM user_profile u LEFT JOIN events_stats e ON u.id = e.user_profile_id WHERE e.ctf_captures > 0 ORDER BY e.ctf_captures DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) CTF captures"
            }
        }
    }
    return @()
}

# Get top event KDR (Kill/Death Ratio)
function Get-TopEventKDR {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, CASE WHEN e.deaths > 0 THEN CAST(e.enemy_kills AS REAL) / e.deaths ELSE e.enemy_kills END as Score FROM user_profile u LEFT JOIN events_stats e ON u.id = e.user_profile_id WHERE e.enemy_kills > 0 ORDER BY Score DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
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
}


# Export functions
Export-ModuleMember -Function @(
    'Initialize-EventsModule',
    'Get-TopEventsWon',
    'Get-TopTeamKills',
    'Get-TopEventsLost',
    'Get-TopEventKills',
    'Get-TopEventDeaths',
    'Get-TopCTFCaptures',
    'Get-TopEventKDR'
)
