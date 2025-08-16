# ===============================================================
# SCUM Server Automation - Discord Event Kill Log Manager
# ===============================================================
# Real-time event kill log monitoring and Discord relay system
# ===============================================================

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
    
    # MEMORY LEAK FIX: Import log streaming helper - check if already loaded
    $streamingPath = Join-Path $PSScriptRoot "..\core\log-streaming.psm1"
    if (Test-Path $streamingPath) {
        if (-not (Get-Module "log-streaming" -ErrorAction SilentlyContinue)) {
            Import-Module $streamingPath -ErrorAction SilentlyContinue
        }
    }
    
    # MEMORY LEAK FIX: Import embed templates - check if already loaded
    $embedPath = Join-Path $PSScriptRoot "..\communication\discord\templates\log-embed-templates.psm1"
    if (Test-Path $embedPath) {
        if (-not (Get-Module "log-embed-templates" -ErrorAction SilentlyContinue)) {
            Import-Module $embedPath -ErrorAction SilentlyContinue
        }
    }
} catch {
    Write-Host "[WARNING] Common module not available for eventkill-log module" -ForegroundColor Yellow
}

# Global variables
$script:Config = $null
$script:DiscordConfig = $null
$script:LogDirectory = $null
$script:CurrentLogFile = $null
$script:IsMonitoring = $false
$script:LastLineNumber = 0
$script:StateFile = $null
$script:IsRelayActive = $false

# ===============================================================
# INITIALIZATION
# ===============================================================
function Initialize-EventKillLogModule {
    param([hashtable]$Config)
    
    try {
        Write-Log "Initializing event kill log management system..." -Level "Info"
        
        # Initialize configuration
        $script:DiscordConfig = $Config.Discord
        if (-not $script:DiscordConfig -or -not $script:DiscordConfig.Token) {
            Write-Log "Discord not configured, event kill log relay disabled" -Level "Info"
            return $false
        }
        
        # Look for EventKillFeed in Features section
        if ($Config.SCUMLogFeatures -and $Config.SCUMLogFeatures.EventKillFeed) {
            $script:Config = $Config.SCUMLogFeatures.EventKillFeed
        }
        else {
            Write-Log "Event kill log relay not enabled in configuration" -Level "Info"
            return $false
        }
        
        if (-not $script:Config.AdminEnabled -and -not $script:Config.PlayersEnabled) {
            Write-Log "Event kill log relay not enabled in configuration" -Level "Info"
            return $false
        }
        
        # Initialize event kill log directory
        $serverDir = $Config.serverDir
        if (-not $serverDir) {
            Write-Log "Server directory not configured" -Level "Info"
            return $false
        }
        
        $script:LogDirectory = Join-Path $serverDir "SCUM\Saved\SaveFiles\Logs"
        Write-Log "Event kill log directory: $script:LogDirectory" -Level "Info"
        Write-Log "Admin channel: $($script:Config.AdminChannel)" -Level "Info"
        if ($script:Config.PlayersEnabled) {
            Write-Log "Players channel: $($script:Config.PlayersChannel)" -Level "Info"
        }
        
        if (-not (Test-Path $script:LogDirectory)) {
            Write-Log "Event kill log directory not found: $script:LogDirectory" -Level "Info"
            return $false
        }
        
        # Initialize state persistence
        $stateDir = ".\state"
        if (-not (Test-Path $stateDir)) {
            New-Item -Path $stateDir -ItemType Directory -Force | Out-Null
        }
        $script:StateFile = Join-Path $stateDir "eventkill-log-manager.json"
        
        # Load previous state
        Load-EventKillState
        
        # Mark as active
        $script:IsMonitoring = $true
        $script:IsRelayActive = $true
        
        return $true
    } catch {
        Write-Log "Failed to initialize event kill log manager: $($_.Exception.Message)" -Level "Info"
        return $false
    }
}

# ===============================================================
# EVENT KILL LOG MONITORING
# ===============================================================
function Update-EventKillLogProcessing {
    if (-not $script:IsMonitoring -or -not $script:IsRelayActive) {
        return
    }
    
    try {
        $newActions = Get-NewEventKillActions
        
        if (-not $newActions -or $newActions.Count -eq 0) {
            return
        }
        
        foreach ($action in $newActions) {
            # Clean format: EVENT KILL [Type] Player: Action
            Write-Log "EVENT KILL [$($action.Type)] $($action.PlayerName): $($action.Action)" -Level "Info"
            Send-EventKillActionToDiscord -Action $action
        }
        
        # Save state after processing
        Save-EventKillState
        
    } catch {
        Write-Log "Error during event kill log update: $($_.Exception.Message)" -Level "Info"
    }
}

function Get-NewEventKillActions {
    # Get the latest event kill log file
    $latestLogFile = Get-LatestEventKillLogFile
    if (-not $latestLogFile) {
        return @()
    }
    
    # Check if we're monitoring a different file now
    if ($script:CurrentLogFile -ne $latestLogFile) {
        Write-Log "Switched to new event kill log file" -Level "Debug"
        $script:CurrentLogFile = $latestLogFile
        $script:LastLineNumber = 0  # Reset line counter for new file
    }
    
    if (-not (Test-Path $script:CurrentLogFile)) {
        Write-Log "Event kill log file not found: $script:CurrentLogFile" -Level "Info"
        return @()
    }
    
    try {
        # MEMORY LEAK FIX: Use streaming instead of Get-Content on entire file
        $result = Read-LogStreamLines -FilePath $script:CurrentLogFile -LastLineNumber $script:LastLineNumber -Encoding ([System.Text.Encoding]::Unicode)
        
        if (-not $result.Success -or $result.NewLines.Count -eq 0) {
            return @()
        }
        
        # Update position and get new lines
        $newLines = $result.NewLines
        $script:LastLineNumber = $result.TotalLines
        
        if ($newLines.Count -eq 0) {
            return @()
        }
        
        # Parse event kill actions from new lines
        $newActions = @()
        foreach ($line in $newLines) {
            if (-not [string]::IsNullOrWhiteSpace($line) -and $line -notmatch "Game version:") {
                $parsedAction = ConvertFrom-EventKillLine -LogLine $line
                if ($parsedAction) {
                    # All event kill actions are enabled by default when EventKillFeed is enabled
                # MEMORY LEAK FIX: Use ArrayList instead of array +=
                if (-not $newActions) {
                    $newActions = New-Object System.Collections.ArrayList
                }
                $null = $newActions.Add($parsedAction)
                }
            }
        }
        
        return $newActions
        
    } catch {
        Write-Log "Error reading event kill log: $($_.Exception.Message)" -Level "Info"
        return @()
    }
}

function Get-LatestEventKillLogFile {
    try {
        # Get all event kill log files
        $LogFiles = Get-ChildItem -Path $script:LogDirectory -Filter "event_kill_*.log" -ErrorAction SilentlyContinue
        
        if (-not $LogFiles -or $LogFiles.Count -eq 0) {
            Write-Log "No event kill log files found in $script:LogDirectory" -Level "Info"
            return $null
        }
        
        # Sort by creation time and get the latest
        $latestFile = $LogFiles | Sort-Object CreationTime -Descending | Select-Object -First 1
        return $latestFile.FullName
        
    } catch {
        Write-Log "Error finding latest event kill log: $($_.Exception.Message)" -Level "Info"
        return $null
    }
}

# ===============================================================
# STATE PERSISTENCE
# ===============================================================
function Save-EventKillState {
    try {
        $state = @{
            CurrentLogFile = $script:CurrentLogFile
            LastLineNumber = $script:LastLineNumber
            LastUpdate = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        }
        
        $stateJson = $state | ConvertTo-Json
        Set-Content -Path $script:StateFile -Value $stateJson -Encoding UTF8
        
    } catch {
        Write-Log "Failed to save event kill log state: $($_.Exception.Message)" -Level "Info"
    }
}

function Load-EventKillState {
    try {
        if (Test-Path $script:StateFile) {
            $stateJson = Get-Content -Path $script:StateFile -Raw -Encoding UTF8
            $state = $stateJson | ConvertFrom-Json
            
            $script:CurrentLogFile = if ($state.CurrentLogFile) { $state.CurrentLogFile } else { $null }
            $script:LastLineNumber = if ($state.LastLineNumber) { $state.LastLineNumber } else { 0 }
            
            # Verify the saved log file still exists, if not reset
            if ($script:CurrentLogFile -and -not (Test-Path $script:CurrentLogFile)) {
                Write-Log "Previous event kill log file no longer exists, resetting state" -Level "Info"
                $script:CurrentLogFile = $null
                $script:LastLineNumber = 0
            } else {
                Write-Log "Loaded event kill log state: File=$($script:CurrentLogFile), Line=$($script:LastLineNumber)" -Level "Info"
            }
        } else {
            Write-Log "No previous event kill log state found, starting from current log end" -Level "Info"
            # Initialize to current log file and skip to end to avoid spam
            $latestLogFile = Get-LatestEventKillLogFile
            if ($latestLogFile -and (Test-Path $latestLogFile)) {
                $script:CurrentLogFile = $latestLogFile
                # MEMORY LEAK FIX: Use streaming to count lines instead of loading entire file
                try {
                    $script:LastLineNumber = Get-LogFileLineCount -FilePath $script:CurrentLogFile -Encoding ([System.Text.Encoding]::Unicode)
                    Write-Log "Initialized kill log state: File=$($script:CurrentLogFile), Starting from line $($script:LastLineNumber)" -Level "Info"
                } catch {
                    $script:LastLineNumber = 0
                }
            } else {
                $script:CurrentLogFile = $null
                $script:LastLineNumber = 0
            }
        }
    } catch {
        Write-Log "Failed to load event kill log state, starting fresh: $($_.Exception.Message)" -Level "Info"
        $script:CurrentLogFile = $null
        $script:LastLineNumber = 0
    }
}

# ===============================================================
# EVENT KILL LOG PARSING
# ===============================================================
function ConvertFrom-EventKillLine {
    param([string]$LogLine)
    
    # Handle JSON format first (has IsInGameEvent: true)
    if ($LogLine -match "^[\d\-\s:]+\s*(\{.*\})$") {
        return ConvertFrom-EventKillJSON -JSONLine $matches[1] -OriginalLine $LogLine
    }
    
    # Event kill log patterns (players killed during game events):
    # 2025.07.17-13.25.44: Died: Jorgan Hogar (76561198087164215), Killer: SfSuralias (76561198401501494) Weapon: Weapon_M16A4_C [Projectile] S[KillerLoc : 229239.58, 106084.84, 27377.79 VictimLoc: 229448.52, 106229.88, 27177.87, Distance: 3.24 m] C[KillerLoc: 229239.58, 106084.84, 27377.79, VictimLoc: 229457.59, 106224.30, 27176.21, Distance: 3.28 m] (killer participating in game event) (victim participating in game event)
    
    # Parse the "Died:" format with event participation markers - BOTH players must be in event
    if ($LogLine -match "^([\d.-]+):\s+Died:\s+([^(]+)\s+\((\d+)\),\s+Killer:\s+([^(]+)\s+\((\d+)\)\s+Weapon:\s+(.+?)\s+\[(.+?)\].*\(killer participating in game event\).*\(victim participating in game event\)") {
        # Standard SCUM log format with event participation markers
        $dateString = $matches[1]
        $victimName = $matches[2].Trim()
        $victimSteamId = $matches[3]
        $killerName = $matches[4].Trim()
        $killerSteamId = $matches[5]
        $weapon = $matches[6]
        $weaponType = $matches[7]
        
        try {
            # Parse date: 2025.07.17-13.25.44 -> 2025/07/17 13:25:44
            $datePart = $dateString -replace '\.', '/' -replace '-', ' '
            $timestamp = [datetime]::ParseExact($datePart, "yyyy/MM/dd HH.mm.ss", $null)
        } catch {
            $timestamp = Get-Date
        }
        
        # Extract distance if available
        $distance = 0
        if ($LogLine -match "Distance:\s+([\d.]+)\s+m") {
            try {
                $distance = [math]::Round([double]$matches[1], 1)
            } catch {
                $distance = 0
            }
        }
        
        # Extract locations - both killer and victim
        $location = ""
        $killerLocation = ""
        $victimLocation = ""
        
        # Extract killer location
        if ($LogLine -match "KillerLoc\s*:\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)") {
            $x = [double]$matches[1]
            $y = [double]$matches[2]
            $z = [double]$matches[3]
            $killerLocation = "X=$x Y=$y Z=$z"
        }
        
        # Extract victim location
        $victimLocation = Extract-VictimLocation -LogLine $LogLine
        
        # Format combined location info
        if ($killerLocation -and $victimLocation) {
            $location = "Killer: $killerLocation | Victim: $victimLocation"
        } elseif ($killerLocation) {
            $location = "Killer: $killerLocation"
        } elseif ($victimLocation) {
            $location = "Victim: $victimLocation"
        }
        
        # Clean weapon name and determine action
        $cleanWeapon = Format-EventWeaponName -WeaponName $weapon -WeaponType $weaponType
        $actionType = Get-EventActionType -WeaponType $weaponType -Weapon $weapon
        $action = Format-EventAction -KillerName $killerName -VictimName $victimName -WeaponName $cleanWeapon -WeaponType $weaponType -Distance $distance
        
        return @{
            Timestamp = $timestamp
            KillerName = $killerName
            KillerSteamId = $killerSteamId
            VictimName = $victimName
            VictimSteamId = $victimSteamId
            PlayerName = $killerName  # For Discord compatibility
            Weapon = $cleanWeapon
            WeaponName = $cleanWeapon
            WeaponType = $weaponType.ToLower()
            Action = $action
            Type = $actionType
            Distance = $distance
            Location = $location
            IsGameEvent = $true
            RawLine = $LogLine
        }
    }
    # Alternative test format with [EVENT] marker and "both in game event"
    elseif ($LogLine -match "\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]\[EVENT\]\s+(\w+)\s+\((\d+)\)\s+killed\s+(\w+)\s+\((\d+)\)\s+with\s+(.+?)\s+at distance\s+(\d+)m\s+\(both in game event\)") {
        $dateString = $matches[1]
        $killerName = $matches[2]
        $killerSteamId = $matches[3]
        $victimName = $matches[4]
        $victimSteamId = $matches[5]
        $weapon = $matches[6]
        $distance = [int]$matches[7]
        
        try {
            $timestamp = [datetime]::Parse($dateString)
        } catch {
            $timestamp = Get-Date
        }
        
        # Clean weapon name and determine action
        $cleanWeapon = Format-EventWeaponName -WeaponName $weapon -WeaponType "Projectile"
        $actionType = Get-EventActionType -WeaponType "Projectile" -Weapon $weapon
        $action = Format-EventAction -KillerName $killerName -VictimName $victimName -WeaponName $cleanWeapon -WeaponType "Projectile" -Distance $distance
        
        return @{
            Timestamp = $timestamp
            KillerName = $killerName
            KillerSteamId = $killerSteamId
            VictimName = $victimName
            VictimSteamId = $victimSteamId
            PlayerName = $killerName  # For Discord compatibility
            Weapon = $cleanWeapon
            WeaponName = $cleanWeapon
            WeaponType = "projectile"
            Action = $action
            Type = $actionType
            Distance = $distance
            Location = ""
            IsGameEvent = $true
            RawLine = $LogLine
        }
    }
    
    # If no event participation markers found, this is not an event kill
    return $null
}

function ConvertFrom-EventKillJSON {
    param(
        [string]$JSONLine,
        [string]$OriginalLine
    )
    
    try {
        $jsonData = $JSONLine | ConvertFrom-Json
        
        # Verify this is an event kill - check both formats
        $isEventKill = $false
        
        # Format 1: Top-level IsInGameEvent flag
        if ($jsonData.PSObject.Properties.Name -contains "IsInGameEvent") {
            $isEventKill = $jsonData.IsInGameEvent -eq $true
        }
        # Format 2: Individual player IsInGameEvent flags
        elseif ($jsonData.Killer.PSObject.Properties.Name -contains "IsInGameEvent" -and 
                $jsonData.Killed.PSObject.Properties.Name -contains "IsInGameEvent") {
            $isEventKill = $jsonData.Killer.IsInGameEvent -and $jsonData.Killed.IsInGameEvent
        }
        
        # Skip if not an event kill
        if (-not $isEventKill) {
            return $null
        }
        
        # Extract basic data - handle different property names
        if (-not $jsonData.Killer -or -not $jsonData.Killed -or -not $jsonData.Weapon) {
            return $null
        }
        
        # Get names - try different property formats
        $killerName = if ($jsonData.Killer.Name) { $jsonData.Killer.Name } 
                     elseif ($jsonData.Killer.ProfileName) { $jsonData.Killer.ProfileName } 
                     else { "Unknown" }
        
        $victimName = if ($jsonData.Killed.Name) { $jsonData.Killed.Name } 
                     elseif ($jsonData.Killed.ProfileName) { $jsonData.Killed.ProfileName } 
                     else { "Unknown" }
        
        # Get Steam IDs
        $killerSteamId = if ($jsonData.Killer.Id) { $jsonData.Killer.Id } 
                        elseif ($jsonData.Killer.SteamId) { $jsonData.Killer.SteamId } 
                        else { "0" }
        
        $victimSteamId = if ($jsonData.Killed.Id) { $jsonData.Killed.Id } 
                        elseif ($jsonData.Killed.SteamId) { $jsonData.Killed.SteamId } 
                        else { "0" }
        
        $weapon = $jsonData.Weapon
        $weaponType = if ($jsonData.DamageType) { $jsonData.DamageType } else { "Unknown" }
        
        # Parse timestamp from original line
        $timestamp = Get-Date
        if ($OriginalLine -match "^([\d\-\s:]+)") {
            $dateString = $matches[1].Trim()
            try {
                $timestamp = [datetime]::Parse($dateString)
            } catch {
                $timestamp = Get-Date
            }
        }
        
        # Calculate distance if locations available
        $distance = 0
        if ($null -ne $jsonData.Killer.X -and $null -ne $jsonData.Killed.X) {
            try {
                $kx = [double]$jsonData.Killer.X
                $ky = [double]$jsonData.Killer.Y
                $vx = [double]$jsonData.Killed.X
                $vy = [double]$jsonData.Killed.Y
                
                $distance = [math]::Round([math]::Sqrt(($kx-$vx)*($kx-$vx) + ($ky-$vy)*($ky-$vy))/100, 1)
            } catch {
                $distance = 0
            }
        }
        elseif ($jsonData.Killer.ServerLocation -and $jsonData.Killed.ServerLocation) {
            try {
                $kx = [double]$jsonData.Killer.ServerLocation.X
                $ky = [double]$jsonData.Killer.ServerLocation.Y
                $kz = [double]$jsonData.Killer.ServerLocation.Z
                $vx = [double]$jsonData.Killed.ServerLocation.X
                $vy = [double]$jsonData.Killed.ServerLocation.Y
                $vz = [double]$jsonData.Killed.ServerLocation.Z
                
                $distance = [math]::Round([math]::Sqrt(($kx-$vx)*($kx-$vx) + ($ky-$vy)*($ky-$vy) + ($kz-$vz)*($kz-$vz))/100, 1)
            } catch {
                $distance = 0
            }
        }
        
        # Extract locations - both killer and victim
        $location = ""
        $killerLocation = ""
        $victimLocation = ""
        
        # Extract killer location
        if ($jsonData.Killer.ServerLocation) {
            try {
                $x = [double]$jsonData.Killer.ServerLocation.X
                $y = [double]$jsonData.Killer.ServerLocation.Y
                $z = [double]$jsonData.Killer.ServerLocation.Z
                $killerLocation = "X=$x Y=$y Z=$z"
            } catch {
                $killerLocation = ""
            }
        } elseif ($null -ne $jsonData.Killer.X) {
            try {
                $x = [double]$jsonData.Killer.X
                $y = [double]$jsonData.Killer.Y
                $z = [double]$jsonData.Killer.Z
                $killerLocation = "X=$x Y=$y Z=$z"
            } catch {
                $killerLocation = ""
            }
        }
        
        # Extract victim location
        if ($jsonData.Killed.ServerLocation) {
            try {
                $x = [double]$jsonData.Killed.ServerLocation.X
                $y = [double]$jsonData.Killed.ServerLocation.Y
                $z = [double]$jsonData.Killed.ServerLocation.Z
                $victimLocation = "X=$x Y=$y Z=$z"
            } catch {
                $victimLocation = ""
            }
        } elseif ($null -ne $jsonData.Killed.X) {
            try {
                $x = [double]$jsonData.Killed.X
                $y = [double]$jsonData.Killed.Y
                $z = [double]$jsonData.Killed.Z
                $victimLocation = "X=$x Y=$y Z=$z"
            } catch {
                $victimLocation = ""
            }
        }
        
        # Format combined location info
        if ($killerLocation -and $victimLocation) {
            $location = "Killer: $killerLocation | Victim: $victimLocation"
        } elseif ($killerLocation) {
            $location = "Killer: $killerLocation"
        } elseif ($victimLocation) {
            $location = "Victim: $victimLocation"
        }
        
        # Format weapon name and get action type
        $cleanWeapon = Format-EventWeaponName -WeaponName $weapon -WeaponType $weaponType
        $actionType = Get-EventActionType -WeaponType $weaponType -Weapon $weapon
        $action = Format-EventAction -KillerName $killerName -VictimName $victimName -WeaponName $cleanWeapon -WeaponType $weaponType -Distance $distance
        
        return @{
            Timestamp = $timestamp
            KillerName = $killerName
            KillerSteamId = $killerSteamId
            VictimName = $victimName
            VictimSteamId = $victimSteamId
            PlayerName = $killerName  # For Discord compatibility
            Weapon = $cleanWeapon
            WeaponName = $cleanWeapon
            WeaponType = $weaponType.ToLower()
            Action = $action
            Type = $actionType
            Distance = $distance
            Location = $location
            IsGameEvent = $true
            RawLine = $OriginalLine
        }
    }
    catch {
        Write-Log "Error parsing event kill JSON: $($_.Exception.Message)" -Level "Debug"
        return $null
    }
}

# ===============================================================
# LOCATION EXTRACTION FUNCTIONS
# ===============================================================
function Extract-VictimLocation {
    param([string]$LogLine)
    
    # Extract victim location from VictimLoc patterns
    if ($LogLine -match "VictimLoc:\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)") {
        $x = [double]$matches[1]
        $y = [double]$matches[2] 
        $z = [double]$matches[3]
        return "X=$x Y=$y Z=$z"
    }
    
    return ""
}

# ===============================================================
# HELPER FUNCTIONS FOR EVENT KILL PROCESSING
# ===============================================================
function Format-EventWeaponName {
    param(
        [string]$WeaponName,
        [string]$WeaponType
    )
    
    if (-not $WeaponName -or $WeaponName -eq "") {
        return "Unknown Weapon"
    }
    
    # Handle special cases
    if ($WeaponName -match "Fists/Legs") {
        return "Bare Hands"
    }
    
    # Clean standard weapon names
    $cleanName = $WeaponName -replace "Weapon_", "" -replace "_C$", "" -replace "_", " " -replace "\s+\[.+\]", ""
    
    if ($cleanName -eq "") {
        return "Unknown Weapon"
    }
    
    return $cleanName
}

function Get-EventActionType {
    param(
        [string]$WeaponType,
        [string]$Weapon
    )
    
    if ($WeaponType -match "Projectile") {
        return "ranged"
    }
    elseif ($WeaponType -match "Melee" -or $Weapon -match "Fists|Legs") {
        return "melee"
    }
    else {
        return "event_kill"
    }
}

function Format-EventAction {
    param(
        [string]$KillerName,
        [string]$VictimName, 
        [string]$WeaponName,
        [string]$WeaponType,
        [int]$Distance
    )
    
    if ($WeaponName -eq "Bare Hands") {
        return "eliminated $VictimName in hand-to-hand combat"
    }
    elseif ($WeaponType -match "Projectile" -and $Distance -gt 0) {
        if ($Distance -gt 100) {
            return "eliminated $VictimName with $WeaponName from long range (${Distance}m)"
        } elseif ($Distance -gt 50) {
            return "eliminated $VictimName with $WeaponName at medium range (${Distance}m)"
        } else {
            return "eliminated $VictimName with $WeaponName at close range (${Distance}m)"
        }
    }
    elseif ($WeaponType -match "Melee") {
        return "eliminated $VictimName with $WeaponName in close combat"
    }
    else {
        return "eliminated $VictimName during event participation"
    }
}

# ===============================================================
# DISCORD INTEGRATION
# ===============================================================
function Send-EventKillActionToDiscord {
    param($Action)
    
    try {
        # Validate action data
        if (-not $Action -or -not $Action.Action) {
            Write-Log "Invalid event kill action data, skipping Discord notification" -Level "Debug"
            return
        }
        
        # Send to admin channel (detailed embed)
        if ($script:Config.AdminEnabled -and $script:Config.AdminChannel) {        
            if (Get-Command "Send-EventKillEmbed" -ErrorAction SilentlyContinue) {
                try {
                    Write-Log "Creating Event kill embed for admin channel" -Level "Debug"
                    $embedData = Send-EventKillEmbed -EventKillAction $Action
                    Write-Log "Event kill embed data created successfully" -Level "Debug"
                
                    if (Get-Command "Send-DiscordMessage" -ErrorAction SilentlyContinue) {
                        Write-Log "Sending event kill embed to admin channel..." -Level "Debug"
                        $result = Send-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:Config.AdminChannel -Embed $embedData
                        if ($result -and $result.success) {
                            Write-Log "Event kill action embed sent to admin channel successfully" -Level "Info"
                        } else {
                            Write-Log "Event kill action embed failed to send to admin channel: $($result | ConvertTo-Json)" -Level "Warning"
                        }
                    } else {
                        Write-Log "Send-DiscordMessage command not found" -Level "Warning"
                    }
                } catch {
                    Write-Log "Error creating event kill embed for admin channel: $($_.Exception.Message)" -Level "Warning"
                }
            } else {
                Write-Log "Send-EventKillEmbed function not found" -Level "Warning"
            }
        }        
        
        # Send to players channel (simple embed) if enabled
        if ($script:Config.PlayersEnabled -and $script:Config.PlayersChannel) {
            try {
                if (Get-Command "Send-EventKillEmbedSimple" -ErrorAction SilentlyContinue) {
                    Write-Log "Creating simple event kill embed for players channel" -Level "Debug"
                    $simpleEmbedData = Send-EventKillEmbedSimple -EventKillAction $Action
                    Write-Log "Simple event kill embed data created successfully" -Level "Debug"
                    
                    if (Get-Command "Send-DiscordMessage" -ErrorAction SilentlyContinue) {
                        Write-Log "Sending simple event kill embed to players channel..." -Level "Debug"
                        $result = Send-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:Config.PlayersChannel -Embed $simpleEmbedData
                        if ($result -and $result.success) {
                            Write-Log "Simple event kill embed sent to players channel" -Level "Info"
                        } else {
                            Write-Log "Failed to send simple event kill embed to players channel" -Level "Warning"
                        }
                    } else {
                        Write-Log "Send-DiscordMessage command not found" -Level "Warning"
                    }
                } else {
                    Write-Log "Send-EventKillEmbedSimple function not found" -Level "Warning"
                }
            } catch {
                Write-Log "Error sending simple event kill embed to players channel: $($_.Exception.Message)" -Level "Warning"
            }
        }
        
    } catch {
        Write-Log "Error in Send-EventKillActionToDiscord: $($_.Exception.Message)" -Level "Error"
    }
}

function Apply-MessageFilter {
    param([string]$Message)
    
    # Start with the original message
    $result = $Message
    
    # Remove excessive repeated characters (only for spam prevention)
    $result = $result -replace '(.)\1{4,}', '$1$1$1'
    
    # Remove excessive caps (convert to title case if too many caps)
    if ($result -cmatch '[A-Z]{10,}') {
        $result = $result.ToLower()
        $result = (Get-Culture).TextInfo.ToTitleCase($result)
    }
    
    # Remove only dangerous control characters (keep Unicode printable chars)
    $result = $result -replace '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', ''
    
    # Escape Discord special sequences to prevent exploits
    $result = $result -replace '```', '`‌`‌`'
    $result = $result -replace '@everyone', '@‌everyone'
    $result = $result -replace '@here', '@‌here'
    
    # Keep all Unicode characters (Czech, Russian, etc.)
    # Discord supports Unicode, so we don't need to replace them
    
    # Ensure not empty
    if ([string]::IsNullOrWhiteSpace($result)) {
        $result = "[filtered message]"
    }
    
    return $result
}

# ===============================================================
# EXPORTS
# ===============================================================
Export-ModuleMember -Function @(
    'Initialize-EventKillLogModule',
    'ConvertFrom-EventKillLine',
    'Update-EventKillLogProcessing',
    'Get-NewEventKillActions',
    'Get-LatestEventKillLogFile',
    'Send-EventKillActionToDiscord',
    'Apply-MessageFilter',
    'Save-EventKillState',
    'Load-EventKillState'
)



