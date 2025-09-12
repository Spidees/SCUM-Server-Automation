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
        
        Write-Log "[World] Module initialized successfully" -Level Debug
        Write-Log "[World] Database: $DatabasePath" -Level Debug
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

# Export functions
Export-ModuleMember -Function @(
    'Initialize-WorldModule',
    'Get-GameTimeData',
    'Get-WeatherData'
)
