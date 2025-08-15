# ===============================================================
# SCUM Server Automation - Discord Violations Log Manager
# ===============================================================
# Real-time violations log monitoring and Discord relay system
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
    Write-Host "[WARNING] Common module not available for violations-log module" -ForegroundColor Yellow
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
function Initialize-ViolationsLogModule {
    param([hashtable]$Config)
    
    try {
        Write-Log "Initializing violations log management system..." -Level "Info"
        
        # Initialize configuration
        $script:DiscordConfig = $Config.Discord
        if (-not $script:DiscordConfig -or -not $script:DiscordConfig.Token) {
            Write-Log "Discord not configured, violations log relay disabled" -Level "Info"
            return $false
        }
        
        # Look for ViolationsFeed in Features section
        if ($Config.SCUMLogFeatures -and $Config.SCUMLogFeatures.ViolationsFeed) {
            $script:Config = $Config.SCUMLogFeatures.ViolationsFeed
        }
        else {
            Write-Log "Violations log relay not enabled in configuration" -Level "Info"
            return $false
        }
        
        if (-not $script:Config.Enabled) {
            Write-Log "Violations log relay not enabled in configuration" -Level "Info"
            return $false
        }
        
        # Initialize violations log directory
        $serverDir = $Config.serverDir
        if (-not $serverDir) {
            Write-Log "Server directory not configured" -Level "Info"
            return $false
        }
        
        $script:LogDirectory = Join-Path $serverDir "SCUM\Saved\SaveFiles\Logs"
        Write-Log "Violations log directory: $script:LogDirectory" -Level "Info"
        
        if (-not (Test-Path $script:LogDirectory)) {
            Write-Log "Violations log directory not found: $script:LogDirectory" -Level "Info"
            return $false
        }
        
        # Initialize state persistence
        $stateDir = ".\state"
        if (-not (Test-Path $stateDir)) {
            New-Item -Path $stateDir -ItemType Directory -Force | Out-Null
        }
        $script:StateFile = Join-Path $stateDir "violations-log-manager.json"
        
        # Load previous state
        Load-ViolationsState
        
        # Mark as active
        $script:IsMonitoring = $true
        $script:IsRelayActive = $true
        
        return $true
    } catch {
        Write-Log "Failed to initialize violations log manager: $($_.Exception.Message)" -Level "Info"
        return $false
    }
}

# ===============================================================
# VIOLATIONS LOG MONITORING
# ===============================================================
function Update-ViolationsLogProcessing {
    if (-not $script:IsMonitoring -or -not $script:IsRelayActive) {
        return
    }
    
    try {
        $newViolations = Get-NewViolationsEvents
        
        if (-not $newViolations -or $newViolations.Count -eq 0) {
            return
        }
        
        foreach ($violation in $newViolations) {
            # Clean format: VIOLATION [Reason] SteamID: Action
            Write-Log "VIOLATION [$($violation.Reason)] $($violation.SteamId): $($violation.Action)" -Level "Info"
            Send-ViolationEventToDiscord -Event $violation
        }
        
        # Save state after processing
        Save-ViolationsState
        
    } catch {
        Write-Log "Error during violations log update: $($_.Exception.Message)" -Level "Info"
    }
}

function Get-NewViolationsEvents {
    # Get the latest violations log file
    $latestLogFile = Get-LatestViolationsLogFile
    if (-not $latestLogFile) {
        return @()
    }
    
    # Check if we're monitoring a different file now
    if ($script:CurrentLogFile -ne $latestLogFile) {
        Write-Log "Switched to new violations log file" -Level "Debug"
        $script:CurrentLogFile = $latestLogFile
        $script:LastLineNumber = 0  # Reset line counter for new file
    }
    
    if (-not (Test-Path $script:CurrentLogFile)) {
        Write-Log "Violations log file not found: $script:CurrentLogFile" -Level "Info"
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
        
        # Parse violations events from new lines
        $newViolations = @()
        foreach ($line in $newLines) {
            if (-not [string]::IsNullOrWhiteSpace($line) -and $line -notmatch "Game version:") {
                $parsedViolation = ConvertFrom-ViolationsLine -LogLine $line
                if ($parsedViolation) {
                    # All violations events are enabled by default when ViolationsFeed is enabled
                # MEMORY LEAK FIX: Use ArrayList instead of array +=
                if (-not $newViolations) {
                    $newViolations = New-Object System.Collections.ArrayList
                }
                $null = $newViolations.Add($parsedViolation)
                }
            }
        }
        
        return $newViolations
        
    } catch {
        Write-Log "Error reading violations log: $($_.Exception.Message)" -Level "Info"
        return @()
    }
}

function Get-LatestViolationsLogFile {
    try {
        # Get all violations log files
        $LogFiles = Get-ChildItem -Path $script:LogDirectory -Filter "violations_*.log" -ErrorAction SilentlyContinue
        
        if (-not $LogFiles -or $LogFiles.Count -eq 0) {
            Write-Log "No violations log files found in $script:LogDirectory" -Level "Info"
            return $null
        }
        
        # Sort by creation time and get the latest
        $latestFile = $LogFiles | Sort-Object CreationTime -Descending | Select-Object -First 1
        return $latestFile.FullName
        
    } catch {
        Write-Log "Error finding latest violations log: $($_.Exception.Message)" -Level "Info"
        return $null
    }
}

# ===============================================================
# STATE PERSISTENCE
# ===============================================================
function Save-ViolationsState {
    try {
        $state = @{
            CurrentLogFile = $script:CurrentLogFile
            LastLineNumber = $script:LastLineNumber
            LastUpdate = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        }
        
        $stateJson = $state | ConvertTo-Json
        Set-Content -Path $script:StateFile -Value $stateJson -Encoding UTF8
        
    } catch {
        Write-Log "Failed to save violations log state: $($_.Exception.Message)" -Level "Info"
    }
}

function Load-ViolationsState {
    try {
        if (Test-Path $script:StateFile) {
            $stateJson = Get-Content -Path $script:StateFile -Raw -Encoding UTF8
            $state = $stateJson | ConvertFrom-Json
            
            $script:CurrentLogFile = if ($state.CurrentLogFile) { $state.CurrentLogFile } else { $null }
            $script:LastLineNumber = if ($state.LastLineNumber) { $state.LastLineNumber } else { 0 }
            
            # Verify the saved log file still exists, if not reset
            if ($script:CurrentLogFile -and -not (Test-Path $script:CurrentLogFile)) {
                Write-Log "Previous violations log file no longer exists, resetting state" -Level "Info"
                $script:CurrentLogFile = $null
                $script:LastLineNumber = 0
            } else {
                Write-Log "Loaded violations log state: File=$($script:CurrentLogFile), Line=$($script:LastLineNumber)" -Level "Info"
            }
        } else {
            Write-Log "No previous violations log state found, starting from current log end" -Level "Info"
            # Initialize to current log file and skip to end to avoid spam
            $latestLogFile = Get-LatestViolationsLogFile
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
        Write-Log "Failed to load violations log state, starting fresh: $($_.Exception.Message)" -Level "Info"
        $script:CurrentLogFile = $null
        $script:LastLineNumber = 0
    }
}

# ===============================================================
# VIOLATIONS LOG PARSING
# ===============================================================
function ConvertFrom-ViolationsLine {
    param([string]$LogLine)
    
    try {
        # Violations log formats:
        # 1. KickPlayer: 2025.07.18-16.04.13: AConZGameMode::KickPlayer: User id: '76561198965109776', Reason: NetErrorUnauthorized
        # 2. BanPlayer: 2025.07.21-17.03.20: AConZGameMode::BanPlayerById: User id: '76561198144694578'
        # 3. Ammo violations: 2025.07.17-16.28.15: [AmmoCountMismatch] Ammo count violation detected: Weapon: Weapon_M16A4, PrisonerLocation: X=-695492.125 Y=-794276.438 Z=10668.420, Count: 1, SuspiciousCount: 23, BanCount: 70, User: Calvitieux (1753, 76561197995957622),
        # 4. Interaction violations: 2025.07.17-22.00.20: [OutOfInteractionRange] Request character action violation detected: Action: PrisonerVehicleAction_Unmount, ... Distance: 9.143 m, User: MISS SuSucreee (1908, 76561198427044872),
        
        # KickPlayer events
        if ($LogLine -match '^(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\s+AConZGameMode::KickPlayer:\s+User id:\s+''(\d+)'',\s+Reason:\s+(.+)$') {
            $dateStr = $matches[1]
            $steamId = $matches[2]
            $reason = $matches[3].Trim()
            
            # Parse timestamp
            try {
                $timestamp = [DateTime]::ParseExact($dateStr, "yyyy.MM.dd-HH.mm.ss", $null)
            } catch {
                $timestamp = Get-Date
                Write-Log "Could not parse timestamp from: $LogLine, using current time" -Level "Debug"
            }
            
            # Determine action based on reason
            $action = switch ($reason) {
                "NetErrorUnauthorized" { "kicked (unauthorized)" }
                "NetErrorTimeout" { "kicked (timeout)" }
                "NetErrorPingTooHigh" { "kicked (high ping)" }
                "Request character action violation detected" { "kicked (violation)" }
                "GenericKickReason" { "kicked (generic)" }
                default { "kicked ($reason)" }
            }
            
            return @{
                Timestamp = $timestamp
                Type = "KICK"
                SteamId = $steamId
                PlayerName = $null
                PlayerId = $null
                Reason = $reason
                Action = $action
                ViolationType = $null
                Weapon = $null
                LocationX = $null
                LocationY = $null
                LocationZ = $null
                Distance = $null
                RawLine = $LogLine
            }
        }
        
        # BanPlayer events
        elseif ($LogLine -match '^(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\s+AConZGameMode::BanPlayerById:\s+User id:\s+''(\d+)''') {
            $dateStr = $matches[1]
            $steamId = $matches[2]
            
            # Parse timestamp
            try {
                $timestamp = [DateTime]::ParseExact($dateStr, "yyyy.MM.dd-HH.mm.ss", $null)
            } catch {
                $timestamp = Get-Date
                Write-Log "Could not parse timestamp from: $LogLine, using current time" -Level "Debug"
            }
            
            return @{
                Timestamp = $timestamp
                Type = "BAN"
                SteamId = $steamId
                PlayerName = $null
                PlayerId = $null
                Reason = "Banned"
                Action = "banned permanently"
                ViolationType = $null
                Weapon = $null
                LocationX = $null
                LocationY = $null
                LocationZ = $null
                Distance = $null
                RawLine = $LogLine
            }
        }
        
        # Ammo count violations
        elseif ($LogLine -match '^(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\s+\[AmmoCountMismatch\]\s+Ammo count violation detected:\s+Weapon:\s+([^,]+),\s+PrisonerLocation:\s+X=([^\s]+)\s+Y=([^\s]+)\s+Z=([^,]+),\s+.*User:\s+([^(]+)\((\d+),\s*(\d+)\)') {
            $dateStr = $matches[1]
            $weapon = $matches[2].Trim()
            $locationX = $matches[3]
            $locationY = $matches[4] 
            $locationZ = $matches[5]
            $playerName = $matches[6].Trim()
            $playerId = $matches[7]
            $steamId = $matches[8]
            
            # Parse timestamp
            try {
                $timestamp = [DateTime]::ParseExact($dateStr, "yyyy.MM.dd-HH.mm.ss", $null)
            } catch {
                $timestamp = Get-Date
                Write-Log "Could not parse timestamp from: $LogLine, using current time" -Level "Debug"
            }
            
            # Clean weapon name
            $cleanWeapon = $weapon -replace "Weapon_", "" -replace "_", " "
            
            # Format coordinates
            try {
                $x = [double]$locationX
                $y = [double]$locationY
                $z = [double]$locationZ
                $locationDesc = "at X=$x Y=$y Z=$z"
            } catch {
                $locationDesc = "at coordinates"
            }
            
            return @{
                Timestamp = $timestamp
                Type = "VIOLATION"
                SteamId = $steamId
                PlayerName = $playerName
                PlayerId = $playerId
                Reason = "Ammo violation"
                Action = "ammo count violation with $cleanWeapon $locationDesc"
                ViolationType = "AmmoCountMismatch"
                Weapon = $cleanWeapon
                LocationX = $locationX
                LocationY = $locationY
                LocationZ = $locationZ
                Distance = $null
                RawLine = $LogLine
            }
        }
        
        # Interaction range violations
        elseif ($LogLine -match '^(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\s+\[(OutOfInteractionRange[^]]*)\]\s+.*Distance:\s+([^\s]+)\s+m,\s+User:\s+([^(]+)\((\d+),\s*(\d+)\)') {
            $dateStr = $matches[1]
            $violationType = $matches[2]
            $distance = $matches[3]
            $playerName = $matches[4].Trim()
            $playerId = $matches[5]
            $steamId = $matches[6]
            
            # Parse timestamp
            try {
                $timestamp = [DateTime]::ParseExact($dateStr, "yyyy.MM.dd-HH.mm.ss", $null)
            } catch {
                $timestamp = Get-Date
                Write-Log "Could not parse timestamp from: $LogLine, using current time" -Level "Debug"
            }
            
            # Format distance
            try {
                $distanceNum = [math]::Round([double]$distance, 2)
                $distanceDesc = "${distanceNum}m away"
            } catch {
                $distanceDesc = "too far away"
            }
            
            return @{
                Timestamp = $timestamp
                Type = "VIOLATION"
                SteamId = $steamId
                PlayerName = $playerName
                PlayerId = $playerId
                Reason = "Interaction violation"
                Action = "interaction range violation $distanceDesc"
                ViolationType = $violationType
                Weapon = $null
                LocationX = $null
                LocationY = $null
                LocationZ = $null
                Distance = $distance
                RawLine = $LogLine
            }
        }
        
        return $null
        
    } catch {
        Write-Log "Error parsing violations line: $($_.Exception.Message)" -Level "Error"
        return $null
    }
}    
# ===============================================================
# DISCORD INTEGRATION
# ===============================================================
function Send-ViolationEventToDiscord {
    param($Event)
    
    try {
        # Validate event data
        if (-not $Event -or -not $Event.Action) {
            Write-Log "Invalid violation event data, skipping Discord notification" -Level "Debug"
            return
        }
        
        # Try to use embed format
        if (Get-Command "Send-ViolationsEmbed" -ErrorAction SilentlyContinue) {
            try {
                Write-Log "Creating violations embed for $($Event.PlayerName)" -Level "Debug"
                $embedData = Send-ViolationsEmbed -ViolationAction $Event
                Write-Log "Violations embed data created successfully" -Level "Debug"
                
                if (Get-Command "Send-DiscordMessage" -ErrorAction SilentlyContinue) {
                    Write-Log "Sending violations embed to Discord..." -Level "Debug"
                    $result = Send-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:Config.Channel -Embed $embedData
                    if ($result -and $result.success) {
                        Write-Log "Violation event embed sent successfully" -Level "Info"
                        return
                    } else {
                        Write-Log "Violation event embed failed to send: $($result | ConvertTo-Json)" -Level "Warning"
                    }
                } else {
                    Write-Log "Send-DiscordMessage command not found" -Level "Warning"
                }
            } catch {
                Write-Log "Error creating violations embed: $($_.Exception.Message)" -Level "Warning"
            }
        } else {
            Write-Log "Send-ViolationsEmbed function not found" -Level "Warning"
        }
        
    } catch {
        Write-Log "Error in Send-ViolationEventToDiscord: $($_.Exception.Message)" -Level "Error"
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
    'Initialize-ViolationsLogModule',
    'ConvertFrom-ViolationsLine',
    'Update-ViolationsLogProcessing',
    'Get-NewViolationsEvents',
    'Get-LatestViolationsLogFile',
    'Send-ViolationEventToDiscord',
    'Apply-MessageFilter',
    'Save-ViolationsState',
    'Load-ViolationsState'
)


