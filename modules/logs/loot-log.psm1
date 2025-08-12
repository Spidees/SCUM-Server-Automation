# ===============================================================
# SCUM Server Automation - Discord Loot Log Manager
# ===============================================================
# Real-time loot log monitoring and Discord relay system
# ===============================================================
# NOTE: This module is currently inactive and does not process logs.
# Loot events are not considered valuable enough for Discord monitoring.
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
    Write-Host "[WARNING] Common module not available for loot-log module" -ForegroundColor Yellow
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
function Initialize-LootLogModule {
    param([hashtable]$Config)
    
    try {
        Write-Log "Initializing loot log management system..." -Level "Info"
        Write-Log "NOTE: Loot log module is currently inactive - no processing will occur" -Level "Info"
        
        # Module initialized but inactive - return false to disable processing
        return $false
        
    } catch {
        Write-Log "Failed to initialize loot log manager: $($_.Exception.Message)" -Level "Info"
        return $false
    }
}

# ===============================================================
# LOOT LOG MONITORING
# ===============================================================
function Update-LootLogProcessing {
    # Module is inactive - no processing
    return
}

function Get-NewLootEvents {
    # Get the latest loot log file
    $latestLogFile = Get-LatestLootLogFile
    if (-not $latestLogFile) {
        return @()
    }
    
    # Check if we're monitoring a different file now
    if ($script:CurrentLogFile -ne $latestLogFile) {
        Write-Log "Switched to new loot log file" -Level "Debug"
        $script:CurrentLogFile = $latestLogFile
        $script:LastLineNumber = 0  # Reset line counter for new file
    }
    
    if (-not (Test-Path $script:CurrentLogFile)) {
        Write-Log "Loot log file not found: $script:CurrentLogFile" -Level "Info"
        return @()
    }
    
    try {
        # Read all lines from the log file - SCUM loot logs use UTF-16 LE encoding
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
        
        # Parse loot events from new lines
        $newEvents = @()
        foreach ($line in $newLines) {
            if (-not [string]::IsNullOrWhiteSpace($line) -and $line -notmatch "Game version:") {
                $parsedEvent = ConvertFrom-LootLine -LogLine $line
                if ($parsedEvent) {
                    # All loot events are enabled by default when LootFeed is enabled
                    $newEvents += $parsedEvent
                }
            }
        }
        
        return $newEvents
        
    } catch {
        Write-Log "Error reading loot log: $($_.Exception.Message)" -Level "Info"
        return @()
    }
}

function Get-LatestLootLogFile {
    try {
        # Get all loot log files
        $LogFiles = Get-ChildItem -Path $script:LogDirectory -Filter "loot_*.log" -ErrorAction SilentlyContinue
        
        if (-not $LogFiles -or $LogFiles.Count -eq 0) {
            Write-Log "No loot log files found in $script:LogDirectory" -Level "Info"
            return $null
        }
        
        # Sort by creation time and get the latest
        $latestFile = $LogFiles | Sort-Object CreationTime -Descending | Select-Object -First 1
        return $latestFile.FullName
        
    } catch {
        Write-Log "Error finding latest loot log: $($_.Exception.Message)" -Level "Info"
        return $null
    }
}

# ===============================================================
# STATE PERSISTENCE
# ===============================================================
function Save-LootState {
    try {
        $state = @{
            CurrentLogFile = $script:CurrentLogFile
            LastLineNumber = $script:LastLineNumber
            LastUpdate = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        }
        
        $stateJson = $state | ConvertTo-Json
        Set-Content -Path $script:StateFile -Value $stateJson -Encoding UTF8
        
    } catch {
        Write-Log "Failed to save loot log state: $($_.Exception.Message)" -Level "Info"
    }
}

function Load-LootState {
    try {
        if (Test-Path $script:StateFile) {
            $stateJson = Get-Content -Path $script:StateFile -Raw -Encoding UTF8
            $state = $stateJson | ConvertFrom-Json
            
            $script:CurrentLogFile = if ($state.CurrentLogFile) { $state.CurrentLogFile } else { $null }
            $script:LastLineNumber = if ($state.LastLineNumber) { $state.LastLineNumber } else { 0 }
            
            # Verify the saved log file still exists, if not reset
            if ($script:CurrentLogFile -and -not (Test-Path $script:CurrentLogFile)) {
                Write-Log "Previous loot log file no longer exists, resetting state" -Level "Info"
                $script:CurrentLogFile = $null
                $script:LastLineNumber = 0
            } else {
                Write-Log "Loaded loot log state: File=$($script:CurrentLogFile), Line=$($script:LastLineNumber)" -Level "Info"
            }
        } else {
            Write-Log "No previous loot log state found, starting from current log end" -Level "Info"
            # Initialize to current log file and skip to end to avoid spam
            $latestLogFile = Get-LatestLootLogFile
            if ($latestLogFile -and (Test-Path $latestLogFile)) {
                $script:CurrentLogFile = $latestLogFile
                # Read current file and set position to end
                try {
                    $allLines = Get-Content $script:CurrentLogFile -Encoding Unicode -ErrorAction SilentlyContinue
                    $script:LastLineNumber = if ($allLines) { $allLines.Count } else { 0 }
                    Write-Log "Initialized loot log state: File=$($script:CurrentLogFile), Starting from line $($script:LastLineNumber)" -Level "Info"
                } catch {
                    $script:LastLineNumber = 0
                }
            } else {
                $script:CurrentLogFile = $null
                $script:LastLineNumber = 0
            }
        }
    } catch {
        Write-Log "Failed to load loot log state, starting fresh: $($_.Exception.Message)" -Level "Info"
        $script:CurrentLogFile = $null
        $script:LastLineNumber = 0
    }
}

# ===============================================================
# LOOT LOG PARSING
# ===============================================================
function ConvertFrom-LootLine {
    param([string]$LogLine)
    
    # Loot log format: YYYY.MM.DD-HH.MM.SS: Log: Message
    # Examples:
    # 2025.08.09-07.48.09: Log: Initializing cooldown groups.
    # 2025.08.09-07.48.09: Log: Cooldown groups duration multiplier is 1.
    # 2025.08.09-07.48.09: Log: Item 'Ammo_Crossbow_Bolt_Wooden' is disabled for spawning: Max occurrences allowed is zero.
    # 2025.08.09-07.48.09: Log: Found '111' spawner presets
    
    if ($LogLine -match '^(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\s+Log:\s+(.+)$') {
        $timestamp = $matches[1]
        $message = $matches[2].Trim()
        
        # Categorize loot events
        $eventType = "INFO"
        $action = $message
        
        # INITIALIZATION EVENTS
        if ($message -match "Initializing (cooldown groups|items|loot tree nodes)") {
            $eventType = "INIT"
            $system = $matches[1]
            $action = "initializing $system"
        } 
        # COOLDOWN EVENTS
        elseif ($message -match "Cooldown groups duration multiplier is (\d+\.?\d*)") {
            $eventType = "CONFIG" 
            $multiplier = $matches[1]
            $action = "cooldown multiplier set to $multiplier"
        }
        elseif ($message -match "Filtered and sorted cooldown groups:") {
            $eventType = "CONFIG"
            $action = "cooldown groups configured"
        }
        # ITEM EVENTS
        elseif ($message -match "Item '([^']+)' is disabled for spawning: (.+)") {
            $eventType = "ITEM"
            $itemName = $matches[1]
            $reason = $matches[2]
            $action = "disabled item: $itemName ($reason)"
        }
        # PRESET EVENTS
        elseif ($message -match "Found '(\d+)' spawner presets") {
            $eventType = "PRESET"
            $count = $matches[1]
            $action = "loaded $count spawner presets"
        }
        elseif ($message -match "Parsing '([^']+)'") {
            $eventType = "PRESET"
            $presetPath = $matches[1]
            # Extract just filename for cleaner display
            $presetName = ($presetPath -split '[/\\]')[-1]
            $action = "parsing preset: $presetName"
        }
        # ZONE EVENTS
        elseif ($message -match "Zone: bIsValid=true, Min=\(X=([\d.-]+) Y=([\d.-]+)\), Max=\(X=([\d.-]+) Y=([\d.-]+)\)") {
            $eventType = "ZONE"
            $minX = $matches[1]
            $minY = $matches[2] 
            $maxX = $matches[3]
            $maxY = $matches[4]
            $action = "zone validated: ($minX,$minY) to ($maxX,$maxY)"
        }
        # OVERRIDE EVENTS
        elseif ($message -match "No (.+) overrides found in '([^']+)'") {
            $eventType = "CONFIG"
            $overrideType = $matches[1]
            $action = "no $overrideType overrides found"
        }
        elseif ($message -match "'([^']+)' does not exist") {
            $eventType = "CONFIG"
            $filename = ($matches[1] -split '[/\\]')[-1]
            $action = "missing config file: $filename"
        }
        
        return @{
            Timestamp = $timestamp
            Type = $eventType
            Action = $action
            Message = $message
            RawLine = $LogLine
        }
    }
    
    return $null
}

# ===============================================================
# DISCORD INTEGRATION
# ===============================================================
function Send-LootEventToDiscord {
    param($Event)
    
    try {
        # Validate event data
        if (-not $Event -or -not $Event.Action) {
            Write-Log "Invalid loot event data, skipping Discord notification" -Level "Debug"
            return
        }
        
        # Filter event description for Discord compatibility
        $filteredAction = if ($Event.Action) { 
            $temp = Apply-MessageFilter -Message $Event.Action
            if ($temp) { $temp } else { "Unknown action" }
        } else { "Unknown action" }
        
        # Additional Discord safety checks
        $filteredAction = $filteredAction.Trim()
        if ($filteredAction.Length -eq 0) {
            Write-Log "Action description is empty after filtering, skipping" -Level "Info"
            return
        }
        
        # Ensure message doesn't exceed Discord's limit (2000 characters)
        if ($filteredAction.Length -gt 1800) {
            $filteredAction = $filteredAction.Substring(0, 1797) + "..."
        }
        
        # Format message with loot event details
        $timestamp = if ($Event.Timestamp) { $Event.Timestamp.ToString() } else { (Get-Date).ToString("HH:mm:ss") }
        
        # Apply different formatting based on event type
        $emoji = ":package:"
        switch ($Event.Type) {
            "INIT" { $emoji = ":gear:" }
            "CONFIG" { $emoji = ":wrench:" }
            "ITEM" { $emoji = ":x:" }
            "PRESET" { $emoji = ":clipboard:" }
            "ZONE" { $emoji = ":world_map:" }
            "INFO" { $emoji = ":information_source:" }
            default { $emoji = ":package:" }
        }
        
        # Use template with dynamic emoji
        $messageTemplate = "{emoji} **LOOT** {action} ``[{time}]``"
        
        $formattedMessage = $messageTemplate -replace '\{action\}', $filteredAction -replace '\{time\}', $timestamp -replace '\{emoji\}', $emoji
        
        if (Get-Command "Send-DiscordMessage" -ErrorAction SilentlyContinue) {
            try {
                $result = Send-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:Config.Channel -Content $formattedMessage
                if ($result -and $result.success) {
                    Write-Log "Discord notification sent successfully" -Level "Debug"
                } else {
                    Write-Log "Discord notification failed to send" -Level "Warning"
                }
            } catch {
                Write-Log "Error sending Discord notification: $($_.Exception.Message)" -Level "Warning"
            }
        } else {
            Write-Log "Send-DiscordMessage command not available" -Level "Info"
        }
        
    } catch {
        Write-Log "Error in Send-LootEventToDiscord: $($_.Exception.Message)" -Level "Error"
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
    'Initialize-LootLogModule',
    'ConvertFrom-LootLine',
    'Update-LootLogProcessing',
    'Get-NewLootEvents',
    'Get-LatestLootLogFile',
    'Send-LootEventToDiscord',
    'Apply-MessageFilter',
    'Save-LootState',
    'Load-LootState'
)


