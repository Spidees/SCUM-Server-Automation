# ===============================================================
# SCUM Server Automation - Kill Log Manager
# ===============================================================
# Real-time kill log monitoring and Discord relay system
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
    Write-Host "[WARNING] Common module not available for kill-log module" -ForegroundColor Yellow
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
function Initialize-KillLogModule {
    param([hashtable]$Config)
    
    try {
        Write-Log "Initializing kill log management system..." -Level "Info"
        
        # Initialize configuration
        $script:DiscordConfig = $Config.Discord
        if (-not $script:DiscordConfig -or -not $script:DiscordConfig.Token) {
            Write-Log "Discord not configured, kill log relay disabled" -Level "Info"
            return $false
        }
        
        # Look for KillFeed in Features section
        if ($Config.SCUMLogFeatures -and $Config.SCUMLogFeatures.KillFeed) {
            $script:Config = $Config.SCUMLogFeatures.KillFeed
        }
        else {
            Write-Log "Kill log relay not enabled in configuration" -Level "Info"
            return $false
        }
        
        if (-not $script:Config.Enabled) {
            Write-Log "Kill log relay not enabled in configuration" -Level "Info"
            return $false
        }
        
        # Initialize kill log directory
        $serverDir = $Config.serverDir
        if (-not $serverDir) {
            Write-Log "Server directory not configured" -Level "Info"
            return $false
        }
        
        $script:LogDirectory = Join-Path $serverDir "SCUM\Saved\SaveFiles\Logs"
        Write-Log "Kill log directory: $script:LogDirectory" -Level "Info"
        
        if (-not (Test-Path $script:LogDirectory)) {
            Write-Log "Kill log directory not found: $script:LogDirectory" -Level "Info"
            return $false
        }
        
        # Initialize state persistence
        $stateDir = ".\state"
        if (-not (Test-Path $stateDir)) {
            New-Item -Path $stateDir -ItemType Directory -Force | Out-Null
        }
        $script:StateFile = Join-Path $stateDir "kill-log-manager.json"
        
        # Load previous state
        Load-KillState
        
        # Mark as active
        $script:IsMonitoring = $true
        $script:IsRelayActive = $true
        
        return $true
    } catch {
        Write-Log "Failed to initialize kill log manager: $($_.Exception.Message)" -Level "Info"
        return $false
    }
}

# ===============================================================
# KILL LOG MONITORING
# ===============================================================
function Update-KillLogProcessing {
    if (-not $script:IsMonitoring -or -not $script:IsRelayActive) {
        return
    }
    
    try {
        $newKills = Get-NewKillEvents
        
        if (-not $newKills -or $newKills.Count -eq 0) {
            return
        }
        
        foreach ($kill in $newKills) {
            # Clean format: KILL [Type] Event description
            if ($kill.Type -eq "suicide") {
                Write-Log "KILL [SUICIDE] $($kill.VictimName) committed suicide" -Level "Info"
            } else {
                Write-Log "KILL [PVP] $($kill.KillerName) killed $($kill.VictimName) with $($kill.WeaponName)" -Level "Info"
            }
            Send-KillEventToDiscord -Kill $kill
        }
        
        # Save state after processing
        Save-KillState
        
    } catch {
        Write-Log "Error during kill log update: $($_.Exception.Message)" -Level "Info"
    }
}

function Get-NewKillEvents {
    # Get the latest kill log file
    $latestLogFile = Get-LatestKillLogFile
    if (-not $latestLogFile) {
        return @()
    }
    
    # Check if we're monitoring a different file now
    if ($script:CurrentLogFile -ne $latestLogFile) {
        Write-Log "Switched to new kill log file" -Level "Debug"
        $script:CurrentLogFile = $latestLogFile
        $script:LastLineNumber = 0  # Reset line counter for new file
    }
    
    if (-not (Test-Path $script:CurrentLogFile)) {
        Write-Log "Kill log file not found: $script:CurrentLogFile" -Level "Info"
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
        
        # Parse kill events from new lines
        $newKills = @()
        foreach ($line in $newLines) {
            if (-not [string]::IsNullOrWhiteSpace($line) -and $line -notmatch "Game version:") {
                $parsedKill = ConvertFrom-KillLine -LogLine $line
                if ($parsedKill) {
                    # All kill events are enabled by default when KillFeed is enabled
                # MEMORY LEAK FIX: Use ArrayList instead of array +=
                if (-not $newKills) {
                    $newKills = New-Object System.Collections.ArrayList
                }
                $null = $newKills.Add($parsedKill)
                }
            }
        }
        
        return $newKills
        
    } catch {
        Write-Log "Error reading kill log: $($_.Exception.Message)" -Level "Info"
        return @()
    }
}

function Get-LatestKillLogFile {
    try {
        # Get all kill log files
        $LogFiles = Get-ChildItem -Path $script:LogDirectory -Filter "kill_*.log" -ErrorAction SilentlyContinue
        
        if (-not $LogFiles -or $LogFiles.Count -eq 0) {
            Write-Log "No kill log files found in $script:LogDirectory" -Level "Info"
            return $null
        }
        
        # Sort by creation time and get the latest
        $latestFile = $LogFiles | Sort-Object CreationTime -Descending | Select-Object -First 1
        return $latestFile.FullName
        
    } catch {
        Write-Log "Error finding latest kill log: $($_.Exception.Message)" -Level "Info"
        return $null
    }
}

# ===============================================================
# STATE PERSISTENCE
# ===============================================================
function Save-KillState {
    try {
        $state = @{
            CurrentLogFile = $script:CurrentLogFile
            LastLineNumber = $script:LastLineNumber
            LastUpdate = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        }
        
        $stateJson = $state | ConvertTo-Json
        Set-Content -Path $script:StateFile -Value $stateJson -Encoding UTF8
        
    } catch {
        Write-Log "Failed to save kill log state: $($_.Exception.Message)" -Level "Info"
    }
}

function Load-KillState {
    try {
        if (Test-Path $script:StateFile) {
            $stateJson = Get-Content -Path $script:StateFile -Raw -Encoding UTF8
            $state = $stateJson | ConvertFrom-Json
            
            $script:CurrentLogFile = if ($state.CurrentLogFile) { $state.CurrentLogFile } else { $null }
            $script:LastLineNumber = if ($state.LastLineNumber) { $state.LastLineNumber } else { 0 }
            
            # Verify the saved log file still exists, if not reset
            if ($script:CurrentLogFile -and -not (Test-Path $script:CurrentLogFile)) {
                Write-Log "Previous kill log file no longer exists, resetting state" -Level "Info"
                $script:CurrentLogFile = $null
                $script:LastLineNumber = 0
            } else {
                Write-Log "Loaded kill log state: File=$($script:CurrentLogFile), Line=$($script:LastLineNumber)" -Level "Info"
            }
        } else {
            Write-Log "No previous kill log state found, starting from current log end" -Level "Info"
            # Initialize to current log file and skip to end to avoid spam
            $latestLogFile = Get-LatestKillLogFile
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
        Write-Log "Failed to load kill log state, starting fresh: $($_.Exception.Message)" -Level "Info"
        $script:CurrentLogFile = $null
        $script:LastLineNumber = 0
    }
}

# ===============================================================
# KILL LOG PARSING
# ===============================================================
function ConvertFrom-KillLine {
    param([string]$LogLine)
    
    # Handle JSON format kills first
    if ($LogLine -match "^{.*}$") {
        return ConvertFrom-KillJSON -JSONLine $LogLine
    }
    
    # Kill log patterns:
    # 2025.07.19-18.35.44: Died: Urrgence (76561198086065370), Killer: Slang (76561197987224276) Weapon: Weapon_AS_Val_C [Projectile] S[KillerLoc : -47875.42, -319777.94, 16448.08 VictimLoc: -46187.92, -320285.81, 16447.89, Distance: 17.62 m] C[KillerLoc: -47875.84, -319779.28, 16448.08, VictimLoc: -46187.92, -320285.81, 16447.89, Distance: 17.62 m]
    # 2025.07.19-18.48.52: Comitted suicide. User: Actual Casual Gamer (2678, 76561198004241450), [Actual Casual Gamer]. Location: X=406461.625 Y=-754581.125 Z=82424.172.
    
    # Extract timestamp
    if ($LogLine -match "^([\d.-]+):\s+(.+)") {
        $dateString = $matches[1]
        $logContent = $matches[2]
        
        try {
            # Parse date: 2025.07.19-18.35.44 -> 2025/07/19 18:35:44
            $datePart = $dateString -replace '\.', '/' -replace '-', ' '
            $timestamp = [datetime]::ParseExact($datePart, "yyyy/MM/dd HH.mm.ss", $null)
        } catch {
            $timestamp = Get-Date
        }
        
        # SUICIDE LOGS
        if ($logContent -match "^Comitted suicide\.\s+User:\s+([^(]+)\s+\((\d+),\s+(\d+)\),\s+\[([^\]]+)\]\.\s+Location:\s+X=([^\s]+)\s+Y=([^\s]+)\s+Z=([^\.]+)\.") {
            $playerName = $matches[1].Trim()
            $playerId = $matches[2]
            $steamId = $matches[3]
            $displayName = $matches[4]
            $locX = $matches[5]
            $locY = $matches[6]
            $locZ = $matches[7]
            
            # Round coordinates
            try {
                $x = [double]$locX
                $y = [double]$locY
                $z = [double]$locZ
                $location = "X=$x Y=$y Z=$z"
            } catch {
                $location = "X=$locX Y=$locY Z=$locZ"
            }
            
            return @{
                Timestamp = $timestamp
                Type = "suicide"
                VictimName = $playerName
                VictimSteamId = $steamId
                VictimPlayerId = $playerId
                KillerName = $null
                KillerSteamId = $null
                KillerPlayerId = $null
                WeaponName = "Suicide"
                WeaponType = "suicide"
                Distance = 0
                Location = $location
                RawLine = $LogLine
            }
        }
        
        # PLAYER VS PLAYER KILLS
        elseif ($logContent -match "^Died:\s+([^(]+)\s+\((\d+)\),\s+Killer:\s+([^(]+)\s+\((\d+)\)\s+Weapon:\s+([^\s]+)\s+\[([^\]]+)\]\s+S\[(.+?)\]\s+C\[(.+?)\]") {
            $victimName = $matches[1].Trim()
            $victimSteamId = $matches[2]
            $killerName = $matches[3].Trim()
            $killerSteamId = $matches[4]
            $weaponName = $matches[5]
            $weaponType = $matches[6]
            $serverLocs = $matches[7]
            $clientLocs = $matches[8]
            
            # Clean weapon name
            $cleanWeaponName = Format-WeaponName -WeaponName $weaponName
            
            # Extract distance from server locations
            $distance = Extract-Distance -LocationString $serverLocs
            
            # Extract both locations for display
            $killerLocation = Extract-KillerLocation -LocationString $serverLocs
            $victimLocation = Extract-VictimLocation -LocationString $serverLocs
            
            # Format combined location info
            $location = ""
            if ($killerLocation -and $victimLocation) {
                $location = "Killer: $killerLocation | Victim: $victimLocation"
            } elseif ($killerLocation) {
                $location = "Killer: $killerLocation"
            } elseif ($victimLocation) {
                $location = "Victim: $victimLocation"
            }
            
            return @{
                Timestamp = $timestamp
                Type = "kill"
                VictimName = $victimName
                VictimSteamId = $victimSteamId
                VictimPlayerId = $null
                KillerName = $killerName
                KillerSteamId = $killerSteamId
                KillerPlayerId = $null
                WeaponName = $cleanWeaponName
                WeaponType = $weaponType.ToLower()
                Distance = $distance
                Location = $location
                RawLine = $LogLine
            }
        }
        
        # PLAYER VS PLAYER KILLS (alternative format without weapon details)
        elseif ($logContent -match "^Died:\s+([^(]+)\s+\((\d+)\),\s+Killer:\s+([^(]+)\s+\((\d+)\)\s+Weapon:\s*\s+S:\[(.+?)\]") {
            $victimName = $matches[1].Trim()
            $victimSteamId = $matches[2]
            $killerName = $matches[3].Trim()
            $killerSteamId = $matches[4]
            $serverLocs = $matches[5]
            
            # Extract distance from server locations
            $distance = Extract-Distance -LocationString $serverLocs
            
            # Extract both locations for display
            $killerLocation = Extract-KillerLocation -LocationString $serverLocs
            $victimLocation = Extract-VictimLocation -LocationString $serverLocs
            
            # Format combined location info
            $location = ""
            if ($killerLocation -and $victimLocation) {
                $location = "Killer: $killerLocation | Victim: $victimLocation"
            } elseif ($killerLocation) {
                $location = "Killer: $killerLocation"
            } elseif ($victimLocation) {
                $location = "Victim: $victimLocation"
            }
            
            return @{
                Timestamp = $timestamp
                Type = "kill"
                VictimName = $victimName
                VictimSteamId = $victimSteamId
                VictimPlayerId = $null
                KillerName = $killerName
                KillerSteamId = $killerSteamId
                KillerPlayerId = $null
                WeaponName = "Unknown Weapon"
                WeaponType = "unknown"
                Distance = $distance
                Location = $location
                RawLine = $LogLine
            }
        }
        
        # EXPLOSIVE/TRAP KILLS (mines, traps, etc.)
        elseif ($logContent -match "^Died:\s+([^(]+)\s+\((\d+)\),\s+Killer:\s+([^(]+)\s+\((\d+)\)\s+Weapon:\s+([^\s]+)\s+\[([^\]]+)\]\s+S:\[\s*VictimLoc:\s*([-\d.,\s]+)\s*Distance:\s*([\d.]+)\s*m\]") {
            $victimName = $matches[1].Trim()
            $victimSteamId = $matches[2]
            $killerName = $matches[3].Trim()
            $killerSteamId = $matches[4]
            $weaponName = $matches[5]
            $weaponType = $matches[6]
            $victimLoc = $matches[7]
            $distance = $matches[8]
            
            # Clean weapon name
            $cleanWeaponName = Format-WeaponName -WeaponName "$weaponName [$weaponType]"
            
            # Parse distance
            try {
                $distanceFloat = [math]::Round([double]$distance, 1)
            } catch {
                $distanceFloat = 0
            }
            
            # Parse victim location for display (killer location is 0,0,0 for remote kills)
            $location = ""
            if ($victimLoc -match "([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)") {
                try {
                    $x = [double]$matches[1]
                    $y = [double]$matches[2]
                    $z = [double]$matches[3]
                    $location = "Victim at X=$x Y=$y Z=$z"
                } catch {
                    $location = ""
                }
            }
            
            return @{
                Timestamp = $timestamp
                Type = "kill"
                VictimName = $victimName
                VictimSteamId = $victimSteamId
                VictimPlayerId = $null
                KillerName = $killerName
                KillerSteamId = $killerSteamId
                KillerPlayerId = $null
                WeaponName = $cleanWeaponName
                WeaponType = $weaponType.ToLower()
                Distance = $distanceFloat
                Location = $location
                RawLine = $LogLine
            }
        }
    }
    
    return $null
}

function ConvertFrom-KillJSON {
    param([string]$JSONLine)
    
    try {
        $killData = $JSONLine | ConvertFrom-Json
        
        if (-not $killData.Killer -or -not $killData.Victim) {
            return $null
        }
        
        # Extract basic information
        $killerName = if ($killData.Killer.ProfileName) { $killData.Killer.ProfileName } else { "Unknown" }
        $killerSteamId = if ($killData.Killer.UserId) { $killData.Killer.UserId } else { "" }
        $victimName = if ($killData.Victim.ProfileName) { $killData.Victim.ProfileName } else { "Unknown" }
        $victimSteamId = if ($killData.Victim.UserId) { $killData.Victim.UserId } else { "" }
        
        # Extract weapon information
        $weaponName = if ($killData.Weapon) { Format-WeaponName -WeaponName $killData.Weapon } else { "Unknown Weapon" }
        $weaponType = if ($killData.Weapon -match "\[(.*?)\]") { $matches[1].ToLower() } else { "unknown" }
        
        # Calculate distance if locations available
        $distance = 0
        if ($killData.Killer.ServerLocation -and $killData.Victim.ServerLocation) {
            try {
                $kx = [double]$killData.Killer.ServerLocation.X
                $ky = [double]$killData.Killer.ServerLocation.Y
                $kz = [double]$killData.Killer.ServerLocation.Z
                $vx = [double]$killData.Victim.ServerLocation.X
                $vy = [double]$killData.Victim.ServerLocation.Y
                $vz = [double]$killData.Victim.ServerLocation.Z
                
                $distance = [math]::Round([math]::Sqrt(($kx-$vx)*($kx-$vx) + ($ky-$vy)*($ky-$vy) + ($kz-$vz)*($kz-$vz))/100, 1)
            } catch {
                $distance = 0
            }
        }
        
        # Format location - extract both killer and victim locations
        $location = ""
        $killerLocation = ""
        $victimLocation = ""
        
        # Extract killer location
        if ($killData.Killer.ServerLocation) {
            try {
                $x = [double]$killData.Killer.ServerLocation.X
                $y = [double]$killData.Killer.ServerLocation.Y
                $z = [double]$killData.Killer.ServerLocation.Z
                $killerLocation = "X=$x Y=$y Z=$z"
            } catch {
                $killerLocation = ""
            }
        }
        
        # Extract victim location
        if ($killData.Victim.ServerLocation) {
            try {
                $x = [double]$killData.Victim.ServerLocation.X
                $y = [double]$killData.Victim.ServerLocation.Y
                $z = [double]$killData.Victim.ServerLocation.Z
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
        
        # Determine kill type (suicide vs normal kill)
        $killType = if ($killerSteamId -eq $victimSteamId -or $killerName -eq $victimName) { "suicide" } else { "kill" }
        
        return @{
            Timestamp = Get-Date  # JSON entries don't have explicit timestamps in the content
            Type = $killType
            VictimName = $victimName
            VictimSteamId = $victimSteamId
            VictimPlayerId = $null
            KillerName = if ($killType -eq "suicide") { $null } else { $killerName }
            KillerSteamId = if ($killType -eq "suicide") { $null } else { $killerSteamId }
            KillerPlayerId = $null
            WeaponName = if ($killType -eq "suicide") { "Suicide" } else { $weaponName }
            WeaponType = if ($killType -eq "suicide") { "suicide" } else { $weaponType }
            Distance = if ($killType -eq "suicide") { 0 } else { $distance }
            Location = $location
            RawLine = $JSONLine
        }
        
    } catch {
        Write-Log "Error parsing JSON kill data: $($_.Exception.Message)" -Level "Warning"
        return $null
    }
}

function Format-WeaponName {
    param([string]$WeaponName)
    
    if (-not $WeaponName -or $WeaponName -eq "") {
        return "Unknown Weapon"
    }
    
    # Handle special weapon formats
    if ($WeaponName -match "^(.+?)_C_\d+\s+\[(.*?)\]$") {
        # Format: StakePitTrap_C_2143653934 [Point]
        $baseName = $matches[1]
        $type = $matches[2]
        $cleanName = $baseName -replace "_", " " -replace "^Weapon ", ""
        return "$cleanName ($type)"
    }
    
    if ($WeaponName -match "^(.+?)\s+\[(.*?)\]$") {
        # Format: Weapon_AK47_C [Projectile]
        $baseName = $matches[1]
        $type = $matches[2]
        $cleanName = $baseName -replace "^Weapon_", "" -replace "_C$", "" -replace "_", " "
        return "$cleanName ($type)"
    }
    
    # Simple weapon name cleanup
    $cleanName = $WeaponName -replace "^Weapon_", "" -replace "_C$", "" -replace "_", " "
    if ($cleanName -eq "") { 
        return "Unknown Weapon" 
    }
    
    return $cleanName
}

function Extract-Distance {
    param([string]$LocationString)
    
    if ($LocationString -match "Distance:\s+([\d.]+)\s+m") {
        try {
            return [math]::Round([double]$matches[1], 1)
        } catch {
            return 0
        }
    }
    return 0
}

function Extract-KillerLocation {
    param([string]$LocationString)
    
    if ($LocationString -match "KillerLoc\s*:\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)") {
        try {
            $x = [double]$matches[1]
            $y = [double]$matches[2]
            $z = [double]$matches[3]
            return "X=$x Y=$y Z=$z"
        } catch {
            return ""
        }
    }
    return ""
}

function Extract-VictimLocation {
    param([string]$LocationString)
    
    if ($LocationString -match "VictimLoc\s*:\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)") {
        try {
            $x = [double]$matches[1]
            $y = [double]$matches[2]
            $z = [double]$matches[3]
            return "X=$x Y=$y Z=$z"
        } catch {
            return ""
        }
    }
    return ""
}

# ===============================================================
# DISCORD INTEGRATION
# ===============================================================
function Send-KillEventToDiscord {
    param([hashtable]$Kill)
    
    try {
        # Validate kill data
        if (-not $Kill -or -not $Kill.Type) {
            Write-Log "Invalid kill data, skipping Discord notification" -Level "Debug"
            return
        }
        
        # Try to use embed format
        if (Get-Command "Send-KillEmbed" -ErrorAction SilentlyContinue) {
            try {
                Write-Log "Creating kill embed for $($Kill.VictimName)" -Level "Debug"
                $embedData = Send-KillEmbed -KillAction $Kill
                Write-Log "Kill embed data created successfully" -Level "Debug"
                
                if (Get-Command "Send-DiscordMessage" -ErrorAction SilentlyContinue) {
                    Write-Log "Sending kill embed to Discord..." -Level "Debug"
                    $result = Send-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:Config.Channel -Embed $embedData
                    if ($result -and $result.success) {
                        Write-Log "Kill event embed sent successfully" -Level "Info"
                        return
                    } else {
                        Write-Log "Kill event embed failed to send: $($result | ConvertTo-Json)" -Level "Warning"
                    }
                } else {
                    Write-Log "Send-DiscordMessage command not found" -Level "Warning"
                }
            } catch {
                Write-Log "Error creating kill embed: $($_.Exception.Message)" -Level "Warning"
            }
        } else {
            Write-Log "Send-KillEmbed function not found" -Level "Warning"
        }
        
    } catch {
        Write-Log "Error in Send-KillEventToDiscord: $($_.Exception.Message)" -Level "Error"
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
    'Initialize-KillLogModule',
    'ConvertFrom-KillLine',
    'Update-KillLogProcessing',
    'Get-NewKillEvents',
    'Get-LatestKillLogFile',
    'Send-KillEventToDiscord',
    'Apply-MessageFilter',
    'Save-KillState',
    'Load-KillState'
)


