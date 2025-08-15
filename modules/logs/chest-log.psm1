# ===============================================================
# SCUM Server Automation - Discord Chest Log Manager
# ===============================================================
# Real-time chest log monitoring and Discord relay system
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
    Write-Host "[WARNING] Common module not available for chest-log module" -ForegroundColor Yellow
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
function Initialize-ChestLogModule {
    param([hashtable]$Config)
    
    try {
        Write-Log "Initializing chest log management system..." -Level "Info"
        
        # Initialize configuration
        $script:DiscordConfig = $Config.Discord
        if (-not $script:DiscordConfig -or -not $script:DiscordConfig.Token) {
            Write-Log "Discord not configured, chest log relay disabled" -Level "Info"
            return $false
        }
        
        # Look for ChestFeed in Features section
        if ($Config.SCUMLogFeatures -and $Config.SCUMLogFeatures.ChestFeed) {
            $script:Config = $Config.SCUMLogFeatures.ChestFeed
        }
        else {
            Write-Log "Chest log relay not enabled in configuration" -Level "Info"
            return $false
        }
        
        if (-not $script:Config.Enabled) {
            Write-Log "Chest log relay not enabled in configuration" -Level "Info"
            return $false
        }
        
        # Initialize chest log directory
        $serverDir = $Config.serverDir
        if (-not $serverDir) {
            Write-Log "Server directory not configured" -Level "Info"
            return $false
        }
        
        $script:LogDirectory = Join-Path $serverDir "SCUM\Saved\SaveFiles\Logs"
        Write-Log "Chest log directory: $script:LogDirectory" -Level "Info"
        
        if (-not (Test-Path $script:LogDirectory)) {
            Write-Log "Chest log directory not found: $script:LogDirectory" -Level "Info"
            return $false
        }
        
        # Initialize state persistence
        $stateDir = ".\state"
        if (-not (Test-Path $stateDir)) {
            New-Item -Path $stateDir -ItemType Directory -Force | Out-Null
        }
        $script:StateFile = Join-Path $stateDir "chest-log-manager.json"
        
        # Load previous state
        Load-ChestState
        
        # Mark as active
        $script:IsMonitoring = $true
        $script:IsRelayActive = $true
        
        return $true
    } catch {
        Write-Log "Failed to initialize chest log manager: $($_.Exception.Message)" -Level "Info"
        return $false
    }
}

# ===============================================================
# CHEST LOG MONITORING
# ===============================================================
function Update-ChestLogProcessing {
    if (-not $script:IsMonitoring -or -not $script:IsRelayActive) {
        return
    }
    
    try {
        $newActions = Get-NewChestActions
        
        if (-not $newActions -or $newActions.Count -eq 0) {
            return
        }
        
        foreach ($action in $newActions) {
            # Clean format: CHEST [Type] Player: Action
            Write-Log "CHEST [$($action.Type)] $($action.PlayerName): $($action.Action)" -Level "Info"
            Send-ChestActionToDiscord -Action $action
        }
        
        # Save state after processing
        Save-ChestState
        
    } catch {
        Write-Log "Error during chest log update: $($_.Exception.Message)" -Level "Info"
    }
}

function Get-NewChestActions {
    # Get the latest chest log file
    $latestLogFile = Get-LatestChestLogFile
    if (-not $latestLogFile) {
        return @()
    }
    
    # Check if we're monitoring a different file now
    if ($script:CurrentLogFile -ne $latestLogFile) {
        $script:CurrentLogFile = $latestLogFile
        $script:LastLineNumber = 0  # Reset line counter for new file
    }
    
    if (-not (Test-Path $script:CurrentLogFile)) {
        Write-Log "Chest log file not found: $script:CurrentLogFile" -Level "Info"
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
        
        # Parse chest actions from new lines
        $newActions = @()
        foreach ($line in $newLines) {
            if (-not [string]::IsNullOrWhiteSpace($line) -and $line -notmatch "Game version:") {
                $parsedAction = ConvertFrom-ChestLine -LogLine $line
                if ($parsedAction) {
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
        Write-Log "Error reading chest log: $($_.Exception.Message)" -Level "Info"
        return @()
    }
}

function Get-LatestChestLogFile {
    try {
        # Get all chest log files
        $LogFiles = Get-ChildItem -Path $script:LogDirectory -Filter "chest_ownership_*.log" -ErrorAction SilentlyContinue
        
        if (-not $LogFiles -or $LogFiles.Count -eq 0) {
            Write-Log "No chest log files found in $script:LogDirectory" -Level "Info"
            return $null
        }
        
        # Sort by creation time and get the latest
        $latestFile = $LogFiles | Sort-Object CreationTime -Descending | Select-Object -First 1
        return $latestFile.FullName
        
    } catch {
        Write-Log "Error finding latest chest log: $($_.Exception.Message)" -Level "Info"
        return $null
    }
}

# ===============================================================
# STATE PERSISTENCE
# ===============================================================
function Save-ChestState {
    try {
        $state = @{
            CurrentLogFile = $script:CurrentLogFile
            LastLineNumber = $script:LastLineNumber
            LastUpdate = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        }
        
        $stateJson = $state | ConvertTo-Json
        Set-Content -Path $script:StateFile -Value $stateJson -Encoding UTF8
        
    } catch {
        Write-Log "Failed to save chest log state: $($_.Exception.Message)" -Level "Info"
    }
}

function Load-ChestState {
    try {
        if (Test-Path $script:StateFile) {
            $stateJson = Get-Content -Path $script:StateFile -Raw -Encoding UTF8
            $state = $stateJson | ConvertFrom-Json
            
            $script:CurrentLogFile = if ($state.CurrentLogFile) { $state.CurrentLogFile } else { $null }
            $script:LastLineNumber = if ($state.LastLineNumber) { $state.LastLineNumber } else { 0 }
            
            # Verify the saved log file still exists, if not reset
            if ($script:CurrentLogFile -and -not (Test-Path $script:CurrentLogFile)) {
                Write-Log "Previous chest log file no longer exists, resetting state" -Level "Info"
                $script:CurrentLogFile = $null
                $script:LastLineNumber = 0
            } else {
                Write-Log "Loaded chest log state: File=$($script:CurrentLogFile), Line=$($script:LastLineNumber)" -Level "Info"
            }
        } else {
            Write-Log "No previous chest log state found, starting from current log end" -Level "Info"
            # Initialize to current log file and skip to end to avoid spam
            $latestLogFile = Get-LatestChestLogFile
            if ($latestLogFile -and (Test-Path $latestLogFile)) {
                $script:CurrentLogFile = $latestLogFile
                # MEMORY LEAK FIX: Use streaming to count lines instead of loading entire file
                try {
                    $script:LastLineNumber = Get-LogFileLineCount -FilePath $script:CurrentLogFile -Encoding ([System.Text.Encoding]::Unicode)
                    Write-Log "Initialized chest log state: File=$($script:CurrentLogFile), Starting from line $($script:LastLineNumber)" -Level "Info"
                } catch {
                    $script:LastLineNumber = 0
                }
            } else {
                $script:CurrentLogFile = $null
                $script:LastLineNumber = 0
            }
        }
    } catch {
        Write-Log "Failed to load chest log state, starting fresh: $($_.Exception.Message)" -Level "Info"
        $script:CurrentLogFile = $null
        $script:LastLineNumber = 0
    }
}

# ===============================================================
# CHEST LOG PARSING
# ===============================================================
function ConvertFrom-ChestLine {
    param([string]$LogLine)
    
    # Real chest ownership log patterns:
    # 2025.07.19-22.28.36: Chest (entity id: 13179507) ownership claimed. Owner: 76561197976302913 (2360, MaxiTete). Location: X=-2120.121094 Y=-101037.570312 Z=34604.792969
    # 2025.07.19-22.52.35: Chest (entity id: 12778595) ownership changed. Old owner: 76561199195092049 (2480, MartoMartin) -> New owner: 76561197996755243 (1756, THE NOTORIOUS). Location: X=582791.500000 Y=-102999.195312 Z=125.022675
    # 2025.07.18-22.03.34: Chest (entity id: 4481928) ownership changed. Old owner: NULL, (727, NULL) -> New owner: NULL, (-1, NULL). Location: X=-457403.531250 Y=-251701.062500 Z=17346.951172
    
    if ($LogLine -match "^([\d.-]+):\s+(.+)$") {
        $date = $matches[1]
        $content = $matches[2].Trim()
        
        try {
            # Parse date: 2025.07.19-22.28.36 -> 2025/07/19 22:28:36
            $datePart = $date -replace '\.', '/' -replace '-', ' '
            $timestamp = [datetime]::ParseExact($datePart, "yyyy/MM/dd HH.mm.ss", $null)
        } catch {
            $timestamp = Get-Date
        }
        
        # Chest ownership claimed
        if ($content -match "^Chest\s+\(entity\s+id:\s+(\d+)\)\s+ownership\s+claimed\.\s+Owner:\s+(\d+)\s+\((\d+),\s+(.+?)\)\.\s+Location:\s+X=([-\d.]+)\s+Y=([-\d.]+)\s+Z=([-\d.]+)") {
            $entityId = $matches[1]
            $steamId = $matches[2]
            $playerId = $matches[3]
            $playerName = $matches[4].Trim()
            $x = $matches[5]
            $y = $matches[6]
            $z = $matches[7]
            
            return @{
                Timestamp = $timestamp
                PlayerName = $playerName
                SteamId = $steamId
                PlayerId = $playerId
                Action = "claimed ownership of chest (ID: $entityId)"
                Type = "claim"
                EntityId = $entityId
                Location = "X=$x Y=$y Z=$z"
                RawLine = $LogLine
            }
        }
        
        # Chest ownership changed - normal transfer
        elseif ($content -match "^Chest\s+\(entity\s+id:\s+(\d+)\)\s+ownership\s+changed\.\s+Old\s+owner:\s+(\d+)\s+\((\d+),\s+(.+?)\)\s+->\s+New\s+owner:\s+(\d+)\s+\((\d+),\s+(.+?)\)\.\s+Location:\s+X=([-\d.]+)\s+Y=([-\d.]+)\s+Z=([-\d.]+)") {
            $entityId = $matches[1]
            $oldSteamId = $matches[2]
            $oldPlayerId = $matches[3]
            $oldPlayerName = $matches[4].Trim()
            $newSteamId = $matches[5]
            $newPlayerId = $matches[6]
            $newPlayerName = $matches[7].Trim()
            $x = $matches[8]
            $y = $matches[9]
            $z = $matches[10]
            
            return @{
                Timestamp = $timestamp
                PlayerName = $newPlayerName
                SteamId = $newSteamId
                PlayerId = $newPlayerId
                Action = "took ownership of chest (ID: $entityId) from $oldPlayerName"
                Type = "transfer"
                EntityId = $entityId
                OldOwner = $oldPlayerName
                Location = "X=$x Y=$y Z=$z"
                RawLine = $LogLine
            }
        }
        
        # Handle NULL to player ownership (claiming unclaimed chest)
        elseif ($content -match "^Chest\s+\(entity\s+id:\s+(\d+)\)\s+ownership\s+changed\.\s+Old\s+owner:\s+NULL,\s+\((\d+),\s+NULL\)\s+->\s+New\s+owner:\s+(\d+)\s+\((\d+),\s+(.+?)\)\.\s+Location:\s+X=([-\d.]+)\s+Y=([-\d.]+)\s+Z=([-\d.]+)") {
            $entityId = $matches[1]
            $newSteamId = $matches[3]
            $newPlayerId = $matches[4]
            $newPlayerName = $matches[5].Trim()
            $x = $matches[6]
            $y = $matches[7]
            $z = $matches[8]
            
            return @{
                Timestamp = $timestamp
                PlayerName = $newPlayerName
                SteamId = $newSteamId
                PlayerId = $newPlayerId
                Action = "claimed unclaimed chest (ID: $entityId)"
                Type = "claim_unclaimed"
                EntityId = $entityId
                Location = "X=$x Y=$y Z=$z"
                RawLine = $LogLine
            }
        }
        
        # Handle player to NULL ownership (chest becoming unclaimed/destroyed)
        elseif ($content -match "^Chest\s+\(entity\s+id:\s+(\d+)\)\s+ownership\s+changed\.\s+Old\s+owner:\s+(\d+)\s+\((\d+),\s+(.+?)\)\s+->\s+New\s+owner:\s+NULL,\s+\((-?\d+),\s+NULL\)\.\s+Location:\s+X=([-\d.]+)\s+Y=([-\d.]+)\s+Z=([-\d.]+)") {
            $entityId = $matches[1]
            $oldSteamId = $matches[2]
            $oldPlayerId = $matches[3]
            $oldPlayerName = $matches[4].Trim()
            $x = $matches[6]
            $y = $matches[7]
            $z = $matches[8]
            
            return @{
                Timestamp = $timestamp
                PlayerName = $oldPlayerName
                SteamId = $oldSteamId
                PlayerId = $oldPlayerId
                Action = "lost ownership of chest (ID: $entityId) - chest destroyed or unclaimed"
                Type = "unclaim"
                EntityId = $entityId
                Location = "X=$x Y=$y Z=$z"
                RawLine = $LogLine
            }
        }
        
        # Handle NULL to NULL ownership (system cleanup/reset)
        elseif ($content -match "^Chest\s+\(entity\s+id:\s+(\d+)\)\s+ownership\s+changed\.\s+Old\s+owner:\s+NULL,\s+\((\d+),\s+NULL\)\s+->\s+New\s+owner:\s+NULL,\s+\((-?\d+),\s+NULL\)\.\s+Location:\s+X=([-\d.]+)\s+Y=([-\d.]+)\s+Z=([-\d.]+)") {
            # System cleanup events - usually not important for Discord relay
            # Return null to skip these events
            return $null
        }
    }
    
    return $null
}

# ===============================================================
# DISCORD INTEGRATION
# ===============================================================
function Send-ChestActionToDiscord {
    param($Action)
    
    try {
        # Validate action data
        if (-not $Action -or -not $Action.Action) {
            Write-Log "Invalid chest action data, skipping Discord notification" -Level "Debug"
            return
        }
        
        # Try to use embed format
        if (Get-Command "Send-ChestEmbed" -ErrorAction SilentlyContinue) {
            try {
                Write-Log "Creating chest embed for $($Action.PlayerName)" -Level "Debug"
                $embedData = Send-ChestEmbed -ChestAction $Action
                Write-Log "Chest embed data created successfully" -Level "Debug"
                
                if (Get-Command "Send-DiscordMessage" -ErrorAction SilentlyContinue) {
                    Write-Log "Sending chest embed to Discord..." -Level "Debug"
                    $result = Send-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:Config.Channel -Embed $embedData
                    if ($result -and $result.success) {
                        Write-Log "Chest action embed sent successfully" -Level "Info"
                        return
                    } else {
                        Write-Log "Chest action embed failed to send: $($result | ConvertTo-Json)" -Level "Warning"
                    }
                } else {
                    Write-Log "Send-DiscordMessage command not found" -Level "Warning"
                }
            } catch {
                Write-Log "Error creating chest embed: $($_.Exception.Message)" -Level "Warning"
            }
        } else {
            Write-Log "Send-ChestEmbed function not found" -Level "Warning"
        }
        
    } catch {
        Write-Log "Error in Send-ChestActionToDiscord: $($_.Exception.Message)" -Level "Error"
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
    'Initialize-ChestLogModule',
    'ConvertFrom-ChestLine',
    'Update-ChestLogProcessing',
    'Get-NewChestActions',
    'Get-LatestChestLogFile',
    'Send-ChestActionToDiscord',
    'Apply-MessageFilter',
    'Save-ChestState',
    'Load-ChestState'
)