# ===============================================================
# SCUM Server Automation - World Database Module
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
    Write-Host "[WARNING] Common module not available for world database module" -ForegroundColor Yellow
}

# Module variables
$script:DatabasePath = $null
$script:SqliteExePath = $null

# Module initialization function
function Initialize-WorldModule {
    param([string]$DatabasePath, [string]$SqliteExePath)
    
    try {
        $script:DatabasePath = $DatabasePath
        $script:SqliteExePath = $SqliteExePath
        
        Write-Log "[World] Module initialized successfully"
        Write-Log "[World] Database: $DatabasePath"
        return @{ Success = $true }
    } catch {
        Write-Log "[World] Failed to initialize: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

# Get game time data
function Get-GameTimeData {
    try {
        $result = Invoke-DatabaseQuery -Query "SELECT time_of_day FROM weather_parameters LIMIT 1"
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            $timeOfDay = [double]$result.Data[0].time_of_day
            
            # SCUM stores time_of_day directly as hours (0-24)
            $hours = [int]([Math]::Floor($timeOfDay)) % 24
            $minutes = [int](($timeOfDay - [Math]::Floor($timeOfDay)) * 60)
            
            return @{
                TimeOfDay = $timeOfDay
                Hours = $hours
                Minutes = $minutes
                FormattedTime = "{0:D2}:{1:D2}" -f $hours, $minutes
                Success = $true
            }
        }
        
        return @{ Success = $false; FormattedTime = "N/A" }
    } catch {
        return @{ Success = $false; FormattedTime = "N/A" }
    }
}

# Get weather data (enhanced)
function Get-WeatherData {
    try {
        $result = Invoke-DatabaseQuery -Query "SELECT base_air_temperature, water_temperature, moon_rotation, fog_density, should_cumulonimbus_cause_fog FROM weather_parameters LIMIT 1"
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            $airTemp = [Math]::Round([double]$result.Data[0].base_air_temperature, 1)
            $waterTemp = [Math]::Round([double]$result.Data[0].water_temperature, 1)
            $moonRotation = [Math]::Round([double]$result.Data[0].moon_rotation, 2)
            $fogDensity = [Math]::Round([double]$result.Data[0].fog_density, 3)
            $cumulonimbusFog = [bool]$result.Data[0].should_cumulonimbus_cause_fog
            
            return @{
                AirTemperature = $airTemp
                WaterTemperature = $waterTemp
                MoonRotation = $moonRotation
                FogDensity = $fogDensity
                CumulonimbusFog = $cumulonimbusFog
                FormattedTemperature = "Air: {0} | Water: {1}" -f $airTemp, $waterTemp
                FormattedFog = "Density: {0}" -f $fogDensity
                Success = $true
            }
        }
        
        return @{ Success = $false; FormattedTemperature = "N/A" }
    } catch {
        return @{ Success = $false; FormattedTemperature = "N/A" }
    }
}

# Get map information
function Get-MapInfo {
    try {
        $result = Invoke-DatabaseQuery -Query "SELECT id, name FROM map LIMIT 1"
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            return @{
                MapId = [int]$result.Data[0].id
                MapName = $result.Data[0].name
                Success = $true
            }
        }
        
        return @{ Success = $false; MapName = "Unknown" }
    } catch {
        return @{ Success = $false; MapName = "Unknown" }
    }
}

# Get radiation data status
function Get-RadiationStatus {
    try {
        $result = Invoke-DatabaseQuery -Query "SELECT COUNT(*) as RadiationEvents FROM global_radiation_data"
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            $eventCount = [int]$result.Data[0].RadiationEvents
            return @{
                RadiationEvents = $eventCount
                HasRadiation = $eventCount -gt 0
                Success = $true
            }
        }
        
        return @{ Success = $false; RadiationEvents = 0; HasRadiation = $false }
    } catch {
        return @{ Success = $false; RadiationEvents = 0; HasRadiation = $false }
    }
}

# Get server settings
function Get-ServerSettings {
    try {
        $result = Invoke-DatabaseQuery -Query "SELECT enable_item_cooldown_groups FROM server_settings LIMIT 1"
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            return @{
                ItemCooldownEnabled = [bool]$result.Data[0].enable_item_cooldown_groups
                Success = $true
            }
        }
        
        return @{ Success = $false; ItemCooldownEnabled = $false }
    } catch {
        return @{ Success = $false; ItemCooldownEnabled = $false }
    }
}

# Get world statistics summary
function Get-WorldStatsSummary {
    $timeData = Get-GameTimeData
    $weatherData = Get-WeatherData
    $mapData = Get-MapInfo
    $radiationData = Get-RadiationStatus
    $serverData = Get-ServerSettings
    
    return @{
        GameTime = if ($timeData.Success) { $timeData.FormattedTime } else { "N/A" }
        Temperature = if ($weatherData.Success) { $weatherData.FormattedTemperature } else { "N/A" }
        MapName = if ($mapData.Success) { $mapData.MapName } else { "Unknown" }
        RadiationActive = if ($radiationData.Success) { $radiationData.HasRadiation } else { $false }
        FogDensity = if ($weatherData.Success) { $weatherData.FogDensity } else { 0 }
        MoonPhase = if ($weatherData.Success) { $weatherData.MoonRotation } else { 0 }
    }
}

# Get detailed world environment data
function Get-WorldEnvironment {
    $summary = @{}
    
    # Time information
    $timeData = Get-GameTimeData
    if ($timeData.Success) {
        $summary.Time = @{
            Current = $timeData.FormattedTime
            Hours = $timeData.Hours
            Minutes = $timeData.Minutes
            RawValue = $timeData.TimeOfDay
        }
    }
    
    # Weather information
    $weatherData = Get-WeatherData
    if ($weatherData.Success) {
        $summary.Weather = @{
            AirTemperature = $weatherData.AirTemperature
            WaterTemperature = $weatherData.WaterTemperature
            FogDensity = $weatherData.FogDensity
            MoonRotation = $weatherData.MoonRotation
            CumulonimbusFog = $weatherData.CumulonimbusFog
        }
    }
    
    # Map and world data
    $mapData = Get-MapInfo
    $radiationData = Get-RadiationStatus
    
    if ($mapData.Success) {
        $summary.Map = @{
            Name = $mapData.MapName
            Id = $mapData.MapId
        }
    }
    
    if ($radiationData.Success) {
        $summary.Radiation = @{
            Events = $radiationData.RadiationEvents
            Active = $radiationData.HasRadiation
        }
    }
    
    return $summary
}

# Export functions
Export-ModuleMember -Function @(
    'Initialize-WorldModule',
    'Get-GameTimeData',
    'Get-WeatherData',
    'Get-MapInfo',
    'Get-RadiationStatus',
    'Get-ServerSettings',
    'Get-WorldStatsSummary',
    'Get-WorldEnvironment'
)
