# ===============================================================
# SCUM Server Automation - Discord Raid Protection Log Manager
# ===============================================================
# Real-time raid protection log monitoring and Discord relay system
# ===============================================================

# Standard import of common module
try {
    $helperPath = Join-Path $PSScriptRoot "..\core\module-helper.psm1"
    if (Test-Path $helperPath) {
        Import-Module $helperPath -Force -ErrorAction SilentlyContinue
        Import-CommonModule | Out-Null
    }
    
    # Import embed templates
    $embedPath = Join-Path $PSScriptRoot "..\communication\discord\templates\log-embed-templates.psm1"
    if (Test-Path $embedPath) {
        Import-Module $embedPath -Force -ErrorAction SilentlyContinue
    }
} catch {
    Write-Host "[WARNING] Common module not available for raidprotection-log module" -ForegroundColor Yellow
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
function Initialize-RaidProtectionLogModule {
    param([hashtable]$Config)
    
    try {
        Write-Log "Initializing raid protection log management system..." -Level "Info"
        
        # Initialize configuration
        $script:DiscordConfig = $Config.Discord
        if (-not $script:DiscordConfig -or -not $script:DiscordConfig.Token) {
            Write-Log "Discord not configured, raid protection log relay disabled" -Level "Info"
            return $false
        }
        
        # Look for RaidProtectionFeed in Features section
        if ($Config.SCUMLogFeatures -and $Config.SCUMLogFeatures.RaidProtectionFeed) {
            $script:Config = $Config.SCUMLogFeatures.RaidProtectionFeed
        }
        else {
            Write-Log "Raid protection log relay not enabled in configuration" -Level "Info"
            return $false
        }
        
        if (-not $script:Config.Enabled) {
            Write-Log "Raid protection log relay not enabled in configuration" -Level "Info"
            return $false
        }
        
        # Initialize raid protection log directory
        $serverDir = $Config.serverDir
        if (-not $serverDir) {
            Write-Log "Server directory not configured" -Level "Info"
            return $false
        }
        
        $script:LogDirectory = Join-Path $serverDir "SCUM\Saved\SaveFiles\Logs"
        Write-Log "Raid protection log directory: $script:LogDirectory" -Level "Info"
        
        if (-not (Test-Path $script:LogDirectory)) {
            Write-Log "Raid protection log directory not found: $script:LogDirectory" -Level "Info"
            return $false
        }
        
        # Initialize state persistence
        $stateDir = ".\state"
        if (-not (Test-Path $stateDir)) {
            New-Item -Path $stateDir -ItemType Directory -Force | Out-Null
        }
        $script:StateFile = Join-Path $stateDir "raidprotection-log-manager.json"
        
        # Load previous state
        Load-RaidProtectionState
        
        # Mark as active
        $script:IsMonitoring = $true
        $script:IsRelayActive = $true
        
        return $true
    } catch {
        Write-Log "Failed to initialize raid protection log manager: $($_.Exception.Message)" -Level "Info"
        return $false
    }
}

# ===============================================================
# RAID PROTECTION LOG MONITORING
# ===============================================================
function Update-RaidProtectionLogProcessing {
    if (-not $script:IsMonitoring -or -not $script:IsRelayActive) {
        return
    }
    
    try {
        $newEvents = Get-NewRaidProtectionEvents
        
        if (-not $newEvents -or $newEvents.Count -eq 0) {
            return
        }
        
        foreach ($raidEvent in $newEvents) {
            # Clean format: RAID [EventType] Flag: Action
            Write-Log "RAID [$($raidEvent.EventType)] Flag $($raidEvent.FlagId): $($raidEvent.Action)" -Level "Info"
            Send-RaidProtectionEventToDiscord -Event $raidEvent
        }
        
        # Save state after processing
        Save-RaidProtectionState
        
    } catch {
        Write-Log "Error during raid protection log update: $($_.Exception.Message)" -Level "Info"
    }
}

function Get-NewRaidProtectionEvents {
    # Get the latest raid protection log file
    $latestLogFile = Get-LatestRaidProtectionLogFile
    if (-not $latestLogFile) {
        return @()
    }
    
    # Check if we're monitoring a different file now
    if ($script:CurrentLogFile -ne $latestLogFile) {
        Write-Log "Switched to new raid protection log file" -Level "Debug"
        $script:CurrentLogFile = $latestLogFile
        $script:LastLineNumber = 0  # Reset line counter for new file
    }
    
    if (-not (Test-Path $script:CurrentLogFile)) {
        Write-Log "Raid protection log file not found: $script:CurrentLogFile" -Level "Info"
        return @()
    }
    
    try {
        # Read all lines from the log file - SCUM raid protection logs use UTF-16 LE encoding
        $allLines = Get-Content $script:CurrentLogFile -Encoding Unicode -ErrorAction SilentlyContinue
        
        if (-not $allLines -or $allLines.Count -eq 0) {
            return @()
        }
        
        # Get only new lines since last check
        $newLines = @()
        if ($script:LastLineNumber -lt $allLines.Count) {
            $newLines = $allLines[$script:LastLineNumber..($allLines.Count - 1)]
            $script:LastLineNumber = $allLines.Count
        }
        
        if ($newLines.Count -eq 0) {
            return @()
        }
        
        # Parse raid protection events from new lines
        $newEvents = @()
        foreach ($line in $newLines) {
            if (-not [string]::IsNullOrWhiteSpace($line) -and $line -notmatch "Game version:" -and $line -notmatch "Offline raid protection log enabled" -and $line -notmatch "Protection start delay:" -and $line -notmatch "Max protection duration:") {
                $parsedEvent = ConvertFrom-RaidProtectionLine -LogLine $line
                if ($parsedEvent) {
                    # All raid protection events are enabled by default when RaidProtectionFeed is enabled
                    $newEvents += $parsedEvent
                }
            }
        }
        
        return $newEvents
        
    } catch {
        Write-Log "Error reading raid protection log: $($_.Exception.Message)" -Level "Info"
        return @()
    }
}

function Get-LatestRaidProtectionLogFile {
    try {
        # Get all raid protection log files
        $LogFiles = Get-ChildItem -Path $script:LogDirectory -Filter "raid_protection_*.log" -ErrorAction SilentlyContinue
        
        if (-not $LogFiles -or $LogFiles.Count -eq 0) {
            Write-Log "No raid protection log files found in $script:LogDirectory" -Level "Info"
            return $null
        }
        
        # Sort by creation time and get the latest
        $latestFile = $LogFiles | Sort-Object CreationTime -Descending | Select-Object -First 1
        return $latestFile.FullName
        
    } catch {
        Write-Log "Error finding latest raid protection log: $($_.Exception.Message)" -Level "Info"
        return $null
    }
}

# ===============================================================
# STATE PERSISTENCE
# ===============================================================
function Save-RaidProtectionState {
    try {
        $state = @{
            CurrentLogFile = $script:CurrentLogFile
            LastLineNumber = $script:LastLineNumber
            LastUpdate = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        }
        
        $stateJson = $state | ConvertTo-Json
        Set-Content -Path $script:StateFile -Value $stateJson -Encoding UTF8
        
    } catch {
        Write-Log "Failed to save raid protection log state: $($_.Exception.Message)" -Level "Info"
    }
}

function Load-RaidProtectionState {
    try {
        if (Test-Path $script:StateFile) {
            $stateJson = Get-Content -Path $script:StateFile -Raw -Encoding UTF8
            $state = $stateJson | ConvertFrom-Json
            
            $script:CurrentLogFile = if ($state.CurrentLogFile) { $state.CurrentLogFile } else { $null }
            $script:LastLineNumber = if ($state.LastLineNumber) { $state.LastLineNumber } else { 0 }
            
            # Verify the saved log file still exists, if not reset
            if ($script:CurrentLogFile -and -not (Test-Path $script:CurrentLogFile)) {
                Write-Log "Previous raid protection log file no longer exists, resetting state" -Level "Info"
                $script:CurrentLogFile = $null
                $script:LastLineNumber = 0
            } else {
                Write-Log "Loaded raid protection log state: File=$($script:CurrentLogFile), Line=$($script:LastLineNumber)" -Level "Info"
            }
        } else {
            Write-Log "No previous raid protection log state found, starting from current log end" -Level "Info"
            # Initialize to current log file and skip to end to avoid spam
            $latestLogFile = Get-LatestRaidProtectionLogFile
            if ($latestLogFile -and (Test-Path $latestLogFile)) {
                $script:CurrentLogFile = $latestLogFile
                # Read current file and set position to end
                try {
                    $allLines = Get-Content $script:CurrentLogFile -Encoding Unicode -ErrorAction SilentlyContinue
                    $script:LastLineNumber = if ($allLines) { $allLines.Count } else { 0 }
                    Write-Log "Initialized raid protection log state: File=$($script:CurrentLogFile), Starting from line $($script:LastLineNumber)" -Level "Info"
                } catch {
                    $script:LastLineNumber = 0
                }
            } else {
                $script:CurrentLogFile = $null
                $script:LastLineNumber = 0
            }
        }
    } catch {
        Write-Log "Failed to load raid protection log state, starting fresh: $($_.Exception.Message)" -Level "Info"
        $script:CurrentLogFile = $null
        $script:LastLineNumber = 0
    }
}

# ===============================================================
# RAID PROTECTION LOG PARSING
# ===============================================================
function ConvertFrom-RaidProtectionLine {
    param([string]$LogLine)
    
    try {
        # Raid protection log formats:
        # 2025.07.18-10.01.39:  Flag protection finished, flag id: 38077, location: <X=-120909.008 Y=-460594.000 Z=151.421>, owner id: 2512, protection duration: 0s, user: 2512 logged in
        # 2025.07.18-10.13.19:  Flag protection set, flag id: 21465, location: <X=240788.469 Y=-523812.719 Z=3722.312>, owner id: 1163, protection duration: 57600s, start in: 3600s, all flag owners offline
        # 2025.07.18-10.14.48:  Flag protection started, flag id: 58304, location: <X=43488.062 Y=-107892.875 Z=32080.328>, owner id: 2026, protection duration: 57600s,
        # 2025.07.19-17.15.15:  Flag protection started, flag id: 83345, location: <X=-433901.125 Y=121936.195 Z=38962.145>, owner id: 1908, protection duration: 57600s, abnormal server shutdown, no owner(s) online
        
        if ($LogLine -match '^(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\s+(.+)$') {
            $dateStr = $matches[1]
            $eventData = $matches[2]
            
            # Parse timestamp
            try {
                $timestamp = [DateTime]::ParseExact($dateStr, "yyyy.MM.dd-HH.mm.ss", $null)
            } catch {
                $timestamp = Get-Date
                Write-Log "Could not parse timestamp from: $LogLine, using current time" -Level "Debug"
            }
            
            # Parse different event types with enhanced patterns
            if ($eventData -match 'Flag protection set, flag id: (\d+), location: <X=([^>]+) Y=([^>]+) Z=([^>]+)>, owner id: (\d+), protection duration: (\d+)s, start in: (\d+)s, all flag owners offline') {
                # Protection scheduled to start
                $durationHours = [math]::Round([double]$matches[6] / 3600, 1)
                $delayMinutes = [math]::Round([double]$matches[7] / 60, 0)
                return @{
                    Timestamp = $timestamp
                    EventType = "ProtectionScheduled"
                    FlagId = $matches[1]
                    LocationX = $matches[2]
                    LocationY = $matches[3]
                    LocationZ = $matches[4]
                    OwnerId = $matches[5]
                    Duration = $matches[6]
                    StartDelay = $matches[7]
                    Action = "Protection scheduled (starts in ${delayMinutes}m, duration ${durationHours}h)"
                    RawLine = $LogLine
                }
            }
            elseif ($eventData -match 'Flag protection finished, flag id: (\d+), location: <X=([^>]+) Y=([^>]+) Z=([^>]+)>, owner id: (\d+), protection duration: (\d+)s, user: (\d+) logged in') {
                # Protection ended due to user login
                return @{
                    Timestamp = $timestamp
                    EventType = "ProtectionEnded"
                    FlagId = $matches[1]
                    LocationX = $matches[2]
                    LocationY = $matches[3]
                    LocationZ = $matches[4]
                    OwnerId = $matches[5]
                    Duration = $matches[6]
                    UserId = $matches[7]
                    Reason = "player_login"
                    Action = "Protection ended (player ID $($matches[7]) logged in)"
                    RawLine = $LogLine
                }
            }
            elseif ($eventData -match 'Flag protection finished, flag id: (\d+), location: <X=([^>]+) Y=([^>]+) Z=([^>]+)>, owner id: (\d+), protection duration: (\d+)s,\s*$') {
                # Protection expired naturally
                $durationHours = [math]::Round([double]$matches[6] / 3600, 1)
                return @{
                    Timestamp = $timestamp
                    EventType = "ProtectionExpired"
                    FlagId = $matches[1]
                    LocationX = $matches[2]
                    LocationY = $matches[3]
                    LocationZ = $matches[4]
                    OwnerId = $matches[5]
                    Duration = $matches[6]
                    Reason = "duration_expired"
                    Action = "Protection expired (${durationHours}h duration completed)"
                    RawLine = $LogLine
                }
            }
            elseif ($eventData -match 'Flag protection started, flag id: (\d+), location: <X=([^>]+) Y=([^>]+) Z=([^>]+)>, owner id: (\d+), protection duration: (\d+)s,\s*(.*)') {
                # Protection activated
                $durationHours = [math]::Round([double]$matches[6] / 3600, 1)
                $additionalInfo = $matches[7].Trim()
                
                $reason = "scheduled"
                $actionText = "Protection activated (${durationHours}h duration)"
                
                if ($additionalInfo -match "abnormal server shutdown") {
                    $reason = "server_shutdown"
                    $actionText = "Protection activated after server shutdown (${durationHours}h)"
                }
                
                return @{
                    Timestamp = $timestamp
                    EventType = "ProtectionActivated"
                    FlagId = $matches[1]
                    LocationX = $matches[2]
                    LocationY = $matches[3]
                    LocationZ = $matches[4]
                    OwnerId = $matches[5]
                    Duration = $matches[6]
                    Reason = $reason
                    Action = $actionText
                    RawLine = $LogLine
                }
            }
        }
        
        return $null
        
    } catch {
        Write-Log "Error parsing raid protection line: $($_.Exception.Message)" -Level "Debug"
        return $null
    }
}

# ===============================================================
# DISCORD INTEGRATION
# ===============================================================
function Send-RaidProtectionEventToDiscord {
    param($Event)
    
    try {
        # Validate event data
        if (-not $Event -or -not $Event.Action) {
            Write-Log "Invalid raid protection event data, skipping Discord notification" -Level "Debug"
            return
        }
        
        # Try to use embed format
        if (Get-Command "Send-RaidProtectionEmbed" -ErrorAction SilentlyContinue) {
            try {
                Write-Log "Creating raid protection embed for Flag ID $($Event.FlagId)" -Level "Debug"
                $embedData = Send-RaidProtectionEmbed -RaidProtectionAction $Event
                Write-Log "Raid protection embed data created successfully" -Level "Debug"
                
                if (Get-Command "Send-DiscordMessage" -ErrorAction SilentlyContinue) {
                    Write-Log "Sending raid protection embed to Discord..." -Level "Debug"
                    $result = Send-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:Config.Channel -Embed $embedData
                    if ($result -and $result.success) {
                        Write-Log "Raid protection event embed sent successfully" -Level "Info"
                        return
                    } else {
                        Write-Log "Raid protection event embed failed to send: $($result | ConvertTo-Json)" -Level "Warning"
                    }
                } else {
                    Write-Log "Send-DiscordMessage command not found" -Level "Warning"
                }
            } catch {
                Write-Log "Error creating raid protection embed: $($_.Exception.Message)" -Level "Warning"
            }
        } else {
            Write-Log "Send-RaidProtectionEmbed function not found" -Level "Warning"
        }
        
    } catch {
        Write-Log "Error in Send-RaidProtectionEventToDiscord: $($_.Exception.Message)" -Level "Error"
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
    'Initialize-RaidProtectionLogModule',
    'ConvertFrom-RaidProtectionLine',
    'Update-RaidProtectionLogProcessing',
    'Get-NewRaidProtectionEvents',
    'Get-LatestRaidProtectionLogFile',
    'Send-RaidProtectionEventToDiscord',
    'Apply-MessageFilter',
    'Save-RaidProtectionState',
    'Load-RaidProtectionState'
)


