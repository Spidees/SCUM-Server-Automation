# ===============================================================
# SCUM Server Automation - Stats Database Module
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
    Write-Host "[WARNING] Common module not available for stats database module" -ForegroundColor Yellow
}

# Module variables
$script:DatabasePath = $null
$script:SqliteExePath = $null

# Module initialization function
function Initialize-StatsModule {
    param([string]$DatabasePath, [string]$SqliteExePath)
    
    try {
        $script:DatabasePath = $DatabasePath
        $script:SqliteExePath = $SqliteExePath
        
        Write-Log "[Stats] Module initialized successfully"
        Write-Log "[Stats] Database: $DatabasePath"
        return @{ Success = $true }
    } catch {
        Write-Log "[Stats] Failed to initialize: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

# Get top kills (improved)
function Get-TopKills {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, e.enemy_kills as Score FROM user_profile u LEFT JOIN events_stats e ON u.id = e.user_profile_id WHERE u.type != 2 AND e.enemy_kills > 0 ORDER BY e.enemy_kills DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) kills"
            }
        }
    }
    return @()
}

# Get top deaths (improved)
function Get-TopDeaths {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, e.deaths as Score FROM user_profile u LEFT JOIN events_stats e ON u.id = e.user_profile_id WHERE u.type != 2 AND e.deaths > 0 ORDER BY e.deaths DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) deaths"
            }
        }
    }
    return @()
}

# Get top playtime (improved)
function Get-TopPlaytime {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT name as Name, play_time as Score FROM user_profile WHERE type != 2 AND play_time > 0 ORDER BY play_time DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
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
}

# Get top fame (improved)
function Get-TopFame {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT name as Name, fame_points as Score FROM user_profile WHERE type != 2 AND fame_points > 0 ORDER BY fame_points DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) fame"
            }
        }
    }
    return @()
}

# Get total kills (improved)
function Get-TotalKills {
    $result = Invoke-DatabaseQuery -Query "SELECT SUM(e.enemy_kills) as total FROM events_stats e JOIN user_profile u ON e.user_profile_id = u.id WHERE u.type != 2"
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return if ($result.Data[0].total) { [int]$result.Data[0].total } else { 0 }
    }
    return 0
}

# Get total deaths (improved)
function Get-TotalDeaths {
    $result = Invoke-DatabaseQuery -Query "SELECT SUM(e.deaths) as total FROM events_stats e JOIN user_profile u ON e.user_profile_id = u.id WHERE u.type != 2"
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return if ($result.Data[0].total) { [int]$result.Data[0].total } else { 0 }
    }
    return 0
}

# Get total playtime (improved)
function Get-TotalPlaytime {
    $result = Invoke-DatabaseQuery -Query "SELECT SUM(play_time) as total FROM user_profile WHERE type != 2"
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return if ($result.Data[0].total) { [int]$result.Data[0].total } else { 0 }
    }
    return 0
}

# Get top KDR
function Get-TopKDR {
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

# Get top headshots
function Get-TopHeadshots {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, s.headshots as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.headshots > 0 ORDER BY s.headshots DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) headshots"
            }
        }
    }
    return @()
}

# Get top survivors
function Get-TopSurvivors {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, s.minutes_survived as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.minutes_survived > 0 ORDER BY s.minutes_survived DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
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
}

# Get top animal kills
function Get-TopAnimalKills {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, s.animals_killed as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.animals_killed > 0 ORDER BY s.animals_killed DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) animals"
            }
        }
    }
    return @()
}

# Get top puppet kills
function Get-TopPuppetKills {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, s.puppets_killed as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.puppets_killed > 0 ORDER BY s.puppets_killed DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) puppets"
            }
        }
    }
    return @()
}

# Get top medics
function Get-TopMedics {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, s.wounds_patched as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.wounds_patched > 0 ORDER BY s.wounds_patched DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) wounds healed"
            }
        }
    }
    return @()
}

# Get top looters
function Get-TopLooters {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, s.containers_looted as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.containers_looted > 0 ORDER BY s.containers_looted DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) containers"
            }
        }
    }
    return @()
}

# Get top distance
function Get-TopDistance {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, s.distance_travelled_by_foot as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.distance_travelled_by_foot > 0 ORDER BY s.distance_travelled_by_foot DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
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
}

# Get top sniper
function Get-TopSniper {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, s.longest_kill_distance as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.longest_kill_distance > 0 ORDER BY s.longest_kill_distance DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
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
}

# Get top melee warriors
function Get-TopMeleeWarriors {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, s.melee_kills as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.melee_kills > 0 ORDER BY s.melee_kills DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) melee kills"
            }
        }
    }
    return @()
}

# Get top archers
function Get-TopArchers {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, s.archery_kills as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.archery_kills > 0 ORDER BY s.archery_kills DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) bow kills"
            }
        }
    }
    return @()
}

# Get top gun crafters
function Get-TopGunCrafters {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, s.guns_crafted as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.guns_crafted > 0 ORDER BY s.guns_crafted DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) guns"
            }
        }
    }
    return @()
}

# Get top bullet crafters
function Get-TopBulletCrafters {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, s.bullets_crafted as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.bullets_crafted > 0 ORDER BY s.bullets_crafted DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) bullets"
            }
        }
    }
    return @()
}

# Get top melee crafters
function Get-TopMeleeCrafters {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, s.melee_weapons_crafted as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.melee_weapons_crafted > 0 ORDER BY s.melee_weapons_crafted DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) melee"
            }
        }
    }
    return @()
}

# Get top clothing crafters
function Get-TopClothingCrafters {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, s.clothing_crafted as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.clothing_crafted > 0 ORDER BY s.clothing_crafted DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) clothing"
            }
        }
    }
    return @()
}

# Get top all crafters
function Get-TopAllCrafters {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, (COALESCE(s.guns_crafted, 0) + COALESCE(s.bullets_crafted, 0) + COALESCE(s.arrows_crafted, 0) + COALESCE(s.clothing_crafted, 0)) as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE (COALESCE(s.guns_crafted, 0) + COALESCE(s.bullets_crafted, 0) + COALESCE(s.arrows_crafted, 0) + COALESCE(s.clothing_crafted, 0)) > 0 ORDER BY Score DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) items crafted"
            }
        }
    }
    return @()
}

# Get top fishers
function Get-TopFishers {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, f.fish_caught as Score FROM user_profile u LEFT JOIN fishing_stats f ON u.id = f.user_profile_id WHERE f.fish_caught > 0 ORDER BY f.fish_caught DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) fish"
            }
        }
    }
    return @()
}

# Get top lockpickers
function Get-TopLockpickers {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, s.locks_picked as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.locks_picked > 0 ORDER BY s.locks_picked DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) locks"
            }
        }
    }
    return @()
}

# Get top drone kills
function Get-TopDroneKills {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, s.drone_kills as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE s.drone_kills > 0 ORDER BY s.drone_kills DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) drones"
            }
        }
    }
    return @()
}

# Get top sentry kills
function Get-TopSentryKills {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, s.sentry_kills as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE u.type != 2 AND s.sentry_kills > 0 ORDER BY s.sentry_kills DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) sentries"
            }
        }
    }
    return @()
}

# Get top vehicle travelers
function Get-TopVehicleTravelers {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, s.distance_travelled_in_vehicle as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE u.type != 2 AND s.distance_travelled_in_vehicle > 0 ORDER BY s.distance_travelled_in_vehicle DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            $distanceKm = [math]::Round([double]$_.Score / 1000, 1)
            @{
                Name = $_.Name
                Value = [double]$_.Score
                FormattedValue = "${distanceKm} km by vehicle"
            }
        }
    }
    return @()
}

# Get top swimmers
function Get-TopSwimmers {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, s.distance_travelled_swimming as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE u.type != 2 AND s.distance_travelled_swimming > 0 ORDER BY s.distance_travelled_swimming DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            $distanceKm = [math]::Round([double]$_.Score / 1000, 1)
            @{
                Name = $_.Name
                Value = [double]$_.Score
                FormattedValue = "${distanceKm} km swimming"
            }
        }
    }
    return @()
}

# Get top shots accuracy
function Get-TopShotsAccuracy {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, CASE WHEN s.shots_fired > 0 THEN CAST(s.shots_hit AS REAL) / s.shots_fired * 100 ELSE 0 END as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE u.type != 2 AND s.shots_fired > 10 ORDER BY Score DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            $accuracy = [math]::Round([double]$_.Score, 1)
            @{
                Name = $_.Name
                Value = [double]$_.Score
                FormattedValue = "${accuracy}% accuracy"
            }
        }
    }
    return @()
}

# Get top food consumers
function Get-TopFoodConsumers {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, s.food_eaten as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE u.type != 2 AND s.food_eaten > 0 ORDER BY s.food_eaten DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            $foodKg = [math]::Round([double]$_.Score / 1000, 1)
            @{
                Name = $_.Name
                Value = [double]$_.Score
                FormattedValue = "${foodKg} kg food"
            }
        }
    }
    return @()
}

# Get top bear hunters
function Get-TopBearHunters {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, s.bears_killed as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE u.type != 2 AND s.bears_killed > 0 ORDER BY s.bears_killed DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) bears"
            }
        }
    }
    return @()
}

# Get top wolf hunters
function Get-TopWolfHunters {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, s.wolves_killed as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE u.type != 2 AND s.wolves_killed > 0 ORDER BY s.wolves_killed DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) wolves"
            }
        }
    }
    return @()
}

# Get top bare handed fighters
function Get-TopBareHandedFighters {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, s.bare_handed_kills as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE u.type != 2 AND s.bare_handed_kills > 0 ORDER BY s.bare_handed_kills DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) bare handed kills"
            }
        }
    }
    return @()
}

# Get top firearm specialists
function Get-TopFirearmSpecialists {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, s.firearm_kills as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE u.type != 2 AND s.firearm_kills > 0 ORDER BY s.firearm_kills DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) firearm kills"
            }
        }
    }
    return @()
}

# Get fishing specialists by specific fish types
function Get-TopTunaFishers {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, f.tuna_caught as Score FROM user_profile u LEFT JOIN fishing_stats f ON u.id = f.user_profile_id WHERE u.type != 2 AND f.tuna_caught > 0 ORDER BY f.tuna_caught DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) tuna"
            }
        }
    }
    return @()
}

# Get top heavy lifters
function Get-TopHeavyLifters {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, s.highest_weight_carried as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE u.type != 2 AND s.highest_weight_carried > 0 ORDER BY s.highest_weight_carried DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            $weightKg = [math]::Round([double]$_.Score, 1)
            @{
                Name = $_.Name
                Value = [double]$_.Score
                FormattedValue = "${weightKg} kg max carried"
            }
        }
    }
    return @()
}

# Get survival hardships (most deaths, heart attacks, etc.)
function Get-TopSurvivalHardships {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    $query = "SELECT u.name as Name, (COALESCE(s.heart_attacks, 0) + COALESCE(s.overdose, 0) + COALESCE(s.starvation, 0) + COALESCE(s.times_mauled_by_bear, 0)) as Score FROM user_profile u LEFT JOIN survival_stats s ON u.id = s.user_profile_id WHERE u.type != 2 AND (COALESCE(s.heart_attacks, 0) + COALESCE(s.overdose, 0) + COALESCE(s.starvation, 0) + COALESCE(s.times_mauled_by_bear, 0)) > 0 ORDER BY Score DESC LIMIT $Limit"
    $result = Invoke-DatabaseQuery -Query $query
    
    if ($result.Success -and $result.Data.Count -gt 0) {
        return $result.Data | ForEach-Object {
            @{
                Name = $_.Name
                Value = [int]$_.Score
                FormattedValue = "$([int]$_.Score) hardships survived"
            }
        }
    }
    return @()
}

# Export functions
Export-ModuleMember -Function @(
    'Initialize-StatsModule',
    'Get-TopKills',
    'Get-TopDeaths',
    'Get-TopPlaytime',
    'Get-TopFame',
    'Get-TotalKills',
    'Get-TotalDeaths',
    'Get-TotalPlaytime',
    'Get-OnlinePlayerCount',
    'Get-VehicleTravelDistance',
    'Get-SwimmingDistance',
    'Get-ShootingAccuracy',
    'Get-TopBearHunters',
    'Get-TopWolfHunters',
    'Get-TopPuppetHunters',
    'Get-TopBareHandedCombat',
    'Get-TopFirearmKills',
    'Get-TopFishCaught',
    'Get-TopFishingTime',
    'Get-TopFishingXP',
    'Get-TopWeightLifted',
    'Get-TopSurvivalChallenges',
    'Get-TopSurvivalTime',
    'Get-TopKDR',
    'Get-TopHeadshots',
    'Get-TopSurvivors',
    'Get-TopAnimalKills',
    'Get-TopPuppetKills',
    'Get-TopMedics',
    'Get-TopLooters',
    'Get-TopDistance',
    'Get-TopSniper',
    'Get-TopMeleeWarriors',
    'Get-TopArchers',
    'Get-TopGunCrafters',
    'Get-TopBulletCrafters',
    'Get-TopMeleeCrafters',
    'Get-TopClothingCrafters',
    'Get-TopAllCrafters',
    'Get-TopFishers',
    'Get-TopLockpickers',
    'Get-TopDroneKills',
    'Get-TopSentryKills'
)
