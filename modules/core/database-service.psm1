# ===============================================================
# CENTRALIZED DATABASE SERVICE 
# Single point for all database calls with built-in caching
# ===============================================================

# Standard import of common module
try {
    $helperPath = Join-Path $PSScriptRoot "..\..\core\module-helper.psm1"
    if (Test-Path $helperPath) {
        Import-Module $helperPath -Force -ErrorAction SilentlyContinue
        Import-CommonModule | Out-Null
    }
} catch {
    Write-Warning "Common module not available for database-service module"
}

# Global cache for all database queries
$global:DatabaseService = @{
    Cache = @{
        PlayerStats = @{
            TotalPlayers = 0
            OnlinePlayers = 0
            ActiveSquads = 0
            LastUpdate = [DateTime]::MinValue
        }
        GameWorld = @{
            GameTime = "N/A"
            Temperature = "N/A"
            LastUpdate = [DateTime]::MinValue
        }
    }
    Config = @{
        CacheIntervalSeconds = 60  # Will be loaded from config
        DatabaseModule = $null
    }
    Initialized = $false
}

function Initialize-DatabaseService {
    <#
    .SYNOPSIS
    Initialize the centralized database service
    #>
    param(
        [int]$CacheIntervalSeconds = 60
    )
    
    $global:DatabaseService.Config.CacheIntervalSeconds = $CacheIntervalSeconds
    $global:DatabaseService.Config.DatabaseModule = Get-Module "scum-database" -ErrorAction SilentlyContinue
    
    Write-Log "[DatabaseService] Initialized with cache interval: $CacheIntervalSeconds seconds" -Level Info
    
    # Initialize cache with actual data immediately
    Write-Log "[DatabaseService] Loading initial data into cache..." -Level Info
    $now = Get-Date
    
    try {
        # Load player stats immediately
        if (Get-Command "Get-TotalPlayerCount" -ErrorAction SilentlyContinue) {
            $totalPlayers = Get-TotalPlayerCount
        } else {
            $totalPlayers = 0
        }
        
        if (Get-Command "Get-OnlinePlayerCount" -ErrorAction SilentlyContinue) {
            $onlinePlayers = Get-OnlinePlayerCount  
        } else {
            $onlinePlayers = 0
        }
        
        if (Get-Command "Get-ActiveSquadCount" -ErrorAction SilentlyContinue) {
            $activeSquads = Get-ActiveSquadCount
        } else {
            $activeSquads = 0
        }
        
        # Load game world data immediately
        if (Get-Command "Get-GameTimeData" -ErrorAction SilentlyContinue) {
            $timeData = Get-GameTimeData
        } else {
            $timeData = $null
        }
        
        if (Get-Command "Get-WeatherData" -ErrorAction SilentlyContinue) {
            $weatherData = Get-WeatherData
        } else {
            $weatherData = $null
        }
        
        # Set cache with actual data
        $global:DatabaseService.Cache.PlayerStats.TotalPlayers = if ($null -ne $totalPlayers) { $totalPlayers } else { 0 }
        $global:DatabaseService.Cache.PlayerStats.OnlinePlayers = if ($null -ne $onlinePlayers) { $onlinePlayers } else { 0 }
        $global:DatabaseService.Cache.PlayerStats.ActiveSquads = if ($null -ne $activeSquads) { $activeSquads } else { 0 }
        $global:DatabaseService.Cache.PlayerStats.LastUpdate = $now
        
        $global:DatabaseService.Cache.GameWorld.GameTime = if ($timeData -and $timeData.Success) { $timeData.FormattedTime } else { "N/A" }
        $global:DatabaseService.Cache.GameWorld.Temperature = if ($weatherData -and $weatherData.Success) { $weatherData.FormattedTemperature } else { "N/A" }
        $global:DatabaseService.Cache.GameWorld.LastUpdate = $now
        
        Write-Log "[DatabaseService] Initial cache loaded: Total=$totalPlayers, Online=$onlinePlayers, Squads=$activeSquads" -Level Info
        Write-Log "[DatabaseService] Initial game world: Time=$($global:DatabaseService.Cache.GameWorld.GameTime), Temp=$($global:DatabaseService.Cache.GameWorld.Temperature)" -Level Info
        
    } catch {
        Write-Log "[DatabaseService] Failed to load initial data: $($_.Exception.Message)" -Level Error
        # Initialize with empty data as fallback
        $global:DatabaseService.Cache.PlayerStats.LastUpdate = $now
        $global:DatabaseService.Cache.GameWorld.LastUpdate = $now
    }
    
    $global:DatabaseService.Initialized = $true
    Write-Log "[DatabaseService] Cache initialized at: $($now.ToString('HH:mm:ss'))" -Level Info
}

function Update-DatabaseServiceCache {
    <#
    .SYNOPSIS
    Update database cache ONLY when needed - respects cache interval to minimize database calls
    Updates both player stats and game world data together when cache interval is reached
    #>
    
    if (-not $global:DatabaseService.Initialized) {
        Write-Log "[DatabaseService] Service not initialized" -Level Warning
        return
    }

    $now = Get-Date
    $cacheInterval = $global:DatabaseService.Config.CacheIntervalSeconds
    
    # Check if cache needs update - use the older timestamp to determine if update is needed
    $playerStatsAge = ($now - $global:DatabaseService.Cache.PlayerStats.LastUpdate).TotalSeconds
    $gameWorldAge = ($now - $global:DatabaseService.Cache.GameWorld.LastUpdate).TotalSeconds
    
    # Use the maximum age to determine if cache needs update (ensures both are updated together)
    $maxAge = [Math]::Max($playerStatsAge, $gameWorldAge)
    $cacheNeedsUpdate = $maxAge -ge $cacheInterval
    
    # Debug: Show cache status
    Write-Log "[DatabaseService] Cache status: PlayerStats age=${playerStatsAge}s, GameWorld age=${gameWorldAge}s, Max age=${maxAge}s (update needed: $cacheNeedsUpdate)" -Level Debug
    
    if (-not $cacheNeedsUpdate) {
        Write-Log "[DatabaseService] Cache is fresh, no database calls needed" -Level Debug
        return
    }

    Write-Log "[DatabaseService] Updating entire cache (both player stats and game world)..." -Level Info
    $callsMade = 0
    
    # Update player stats cache
    try {
        if (Get-Command "Get-TotalPlayerCount" -ErrorAction SilentlyContinue) {
            $totalPlayers = Get-TotalPlayerCount
            $callsMade++
        } else {
            $totalPlayers = 0
        }
        
        if (Get-Command "Get-OnlinePlayerCount" -ErrorAction SilentlyContinue) {
            $onlinePlayers = Get-OnlinePlayerCount  
            $callsMade++
        } else {
            $onlinePlayers = 0
        }
        
        if (Get-Command "Get-ActiveSquadCount" -ErrorAction SilentlyContinue) {
            $activeSquads = Get-ActiveSquadCount
            $callsMade++
        } else {
            $activeSquads = 0
        }
        
        $global:DatabaseService.Cache.PlayerStats.TotalPlayers = if ($null -ne $totalPlayers) { $totalPlayers } else { 0 }
        $global:DatabaseService.Cache.PlayerStats.OnlinePlayers = if ($null -ne $onlinePlayers) { $onlinePlayers } else { 0 }
        $global:DatabaseService.Cache.PlayerStats.ActiveSquads = if ($null -ne $activeSquads) { $activeSquads } else { 0 }
        $global:DatabaseService.Cache.PlayerStats.LastUpdate = $now
        
        Write-Log "[DatabaseService] Player stats updated: Total=$totalPlayers, Online=$onlinePlayers, Squads=$activeSquads" -Level Info
    } catch {
        Write-Log "[DatabaseService] Failed to update player stats: $($_.Exception.Message)" -Level Error
    }
    
    # Update game world cache
    try {
        if (Get-Command "Get-GameTimeData" -ErrorAction SilentlyContinue) {
            $timeData = Get-GameTimeData
            $callsMade++
        } else {
            $timeData = $null
        }
        
        if (Get-Command "Get-WeatherData" -ErrorAction SilentlyContinue) {
            $weatherData = Get-WeatherData
            $callsMade++
        } else {
            $weatherData = $null
        }
        
        $global:DatabaseService.Cache.GameWorld.GameTime = if ($timeData -and $timeData.Success) { $timeData.FormattedTime } else { "N/A" }
        $global:DatabaseService.Cache.GameWorld.Temperature = if ($weatherData -and $weatherData.Success) { $weatherData.FormattedTemperature } else { "N/A" }
        $global:DatabaseService.Cache.GameWorld.LastUpdate = $now
        
        Write-Log "[DatabaseService] Game world updated: Time=$($global:DatabaseService.Cache.GameWorld.GameTime), Temp=$($global:DatabaseService.Cache.GameWorld.Temperature)" -Level Info
    } catch {
        Write-Log "[DatabaseService] Failed to update game world: $($_.Exception.Message)" -Level Error
    }
    
    Write-Log "[DatabaseService] Complete cache update finished: $callsMade database calls made" -Level Info
}

function Get-DatabaseServiceStats {
    <#
    .SYNOPSIS
    Get all cached database statistics - SINGLE SOURCE OF TRUTH
    #>
    
    if (-not $global:DatabaseService.Initialized) {
        Write-Log "[DatabaseService] Service not initialized, returning empty stats" -Level Warning
        return @{
            TotalPlayers = 0
            OnlinePlayers = 0
            ActiveSquads = 0
            GameTime = "N/A"
            Temperature = "N/A"
            LastPlayerStatsUpdate = [DateTime]::MinValue
            LastGameWorldUpdate = [DateTime]::MinValue
        }
    }
    
    return @{
        TotalPlayers = $global:DatabaseService.Cache.PlayerStats.TotalPlayers
        OnlinePlayers = $global:DatabaseService.Cache.PlayerStats.OnlinePlayers
        ActiveSquads = $global:DatabaseService.Cache.PlayerStats.ActiveSquads
        GameTime = $global:DatabaseService.Cache.GameWorld.GameTime
        Temperature = $global:DatabaseService.Cache.GameWorld.Temperature
        LastPlayerStatsUpdate = $global:DatabaseService.Cache.PlayerStats.LastUpdate
        LastGameWorldUpdate = $global:DatabaseService.Cache.GameWorld.LastUpdate
    }
}

function Get-DatabaseServiceCacheInfo {
    <#
    .SYNOPSIS
    Get information about cache status and efficiency
    #>
    
    if (-not $global:DatabaseService.Initialized) {
        return "Database service not initialized"
    }
    
    $now = Get-Date
    $playerStatsAge = ($now - $global:DatabaseService.Cache.PlayerStats.LastUpdate).TotalSeconds
    $gameWorldAge = ($now - $global:DatabaseService.Cache.GameWorld.LastUpdate).TotalSeconds
    $maxAge = [Math]::Max($playerStatsAge, $gameWorldAge)
    $cacheInterval = $global:DatabaseService.Config.CacheIntervalSeconds
    
    return @{
        CacheInterval = $cacheInterval
        PlayerStatsAge = [Math]::Round($playerStatsAge, 1)
        GameWorldAge = [Math]::Round($gameWorldAge, 1)
        MaxAge = [Math]::Round($maxAge, 1)
        CacheValid = $maxAge -lt $cacheInterval
        EstimatedCallsPerHour = [Math]::Round((3600 / $cacheInterval) * 5, 1)  # 5 calls per cache update (both player and world together)
        UpdateStrategy = "Unified - both player stats and game world updated together"
    }
}

# Export functions
Export-ModuleMember -Function Initialize-DatabaseService, Update-DatabaseServiceCache, Get-DatabaseServiceStats, Get-DatabaseServiceCacheInfo
