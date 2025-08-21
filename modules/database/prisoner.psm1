# ===============================================================
# SCUM Server Automation - Prisoner Database Module
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
    
    # Use the unified a_user_profile table with user_is_online flag
    $query = "SELECT user_name as PlayerName, user_id as SteamID, last_login_time, last_logout_time FROM a_user_profile WHERE user_is_online = 1"
    
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
    $query = "SELECT * FROM a_user_profile WHERE user_id = '$escapedValue'"
    
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
    $query = "SELECT * FROM a_user_profile WHERE user_name = '$escapedValue'"
    
    $result = Invoke-DatabaseQuery -Query $query
    if ($result.Success -and $result.Data.Count -gt 0) {
        return @{ Success = $true; Data = $result.Data[0] }
    }
    
    return @{ Success = $false; Error = "Player not found" }
}

# Get total player count (improved)
function Get-TotalPlayerCount {
    $result = Invoke-DatabaseQuery -Query "SELECT COUNT(*) as TotalCount FROM a_user_profile"
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data[0].TotalCount
    }
    
    return 0
}

# Get online player count (improved)
function Get-OnlinePlayerCount {
    $result = Invoke-DatabaseQuery -Query "SELECT COUNT(*) as OnlineCount FROM a_user_profile WHERE user_is_online = 1"
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data[0].OnlineCount
    }
    
    return 0
}

# Get recently active players
function Get-RecentlyActivePlayers {
    param([int]$Hours = 24, [int]$Limit = 50)
    
    $query = "SELECT user_name as PlayerName, user_id as SteamID, last_login_time, last_logout_time FROM a_user_profile WHERE datetime(last_login_time) > datetime('now', '-$Hours hours') ORDER BY last_login_time DESC LIMIT $Limit"
    
    $result = Invoke-DatabaseQuery -Query $query
    if ($result.Success -and $result.Data.Count -gt 0) {
        return @{ Success = $true; Data = $result.Data; Count = $result.Data.Count }
    }
    
    return @{ Success = $false; Error = "No recently active players found" }
}


# Search players by partial name
function Search-PlayersByName {
    param([string]$SearchTerm, [int]$Limit = 20)
    
    $escapedTerm = $SearchTerm -replace "'", "''"
    $query = "SELECT user_name as PlayerName, user_id as SteamID, last_login_time, last_logout_time FROM a_user_profile WHERE user_name LIKE '%$escapedTerm%' ORDER BY user_name LIMIT $Limit"
    
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
    'Search-PlayersByName'
)