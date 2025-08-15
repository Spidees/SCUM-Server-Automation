# ===============================================================
# SCUM Server Automation - Gameplay Log Manager
# ===============================================================
# Real-time gameplay log monitoring and Discord relay system
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
    Write-Host "[WARNING] Common module not available for gameplay-log module" -ForegroundColor Yellow
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
function Initialize-GameplayLogModule {
    param([hashtable]$Config)
    
    try {
        Write-Log "Initializing gameplay log management system..." -Level "Info"
        
        # Initialize configuration
        $script:DiscordConfig = $Config.Discord
        if (-not $script:DiscordConfig -or -not $script:DiscordConfig.Token) {
            Write-Log "Discord not configured, gameplay log relay disabled" -Level "Info"
            return $false
        }
        
        # Look for GameplayFeed in Features section
        if ($Config.SCUMLogFeatures -and $Config.SCUMLogFeatures.GameplayFeed) {
            $script:Config = $Config.SCUMLogFeatures.GameplayFeed
        }
        else {
            Write-Log "Gameplay log relay not enabled in configuration" -Level "Info"
            return $false
        }
        
        if (-not $script:Config.Enabled) {
            Write-Log "Gameplay log relay not enabled in configuration" -Level "Info"
            return $false
        }
        
        # Initialize gameplay log directory
        $serverDir = $Config.serverDir
        if (-not $serverDir) {
            Write-Log "Server directory not configured" -Level "Info"
            return $false
        }
        
        $script:LogDirectory = Join-Path $serverDir "SCUM\Saved\SaveFiles\Logs"
        Write-Log "Gameplay log directory: $script:LogDirectory" -Level "Info"
        
        if (-not (Test-Path $script:LogDirectory)) {
            Write-Log "Gameplay log directory not found: $script:LogDirectory" -Level "Info"
            return $false
        }
        
        # Initialize state persistence
        $stateDir = ".\state"
        if (-not (Test-Path $stateDir)) {
            New-Item -Path $stateDir -ItemType Directory -Force | Out-Null
        }
        $script:StateFile = Join-Path $stateDir "gameplay-log-manager.json"
        
        # Load previous state
        Load-GameplayState
        
        # Mark as active
        $script:IsMonitoring = $true
        $script:IsRelayActive = $true
        
        return $true
    } catch {
        Write-Log "Failed to initialize gameplay log manager: $($_.Exception.Message)" -Level "Info"
        return $false
    }
}

# ===============================================================
# GAMEPLAY LOG MONITORING
# ===============================================================
function Update-GameplayLogProcessing {
    if (-not $script:IsMonitoring -or -not $script:IsRelayActive) {
        return
    }
    
    try {
        $newActivities = Get-NewGameplayActivities
        
        if (-not $newActivities -or $newActivities.Count -eq 0) {
            return
        }
        
        foreach ($activity in $newActivities) {
            # Clean format: GAMEPLAY [Type] Player: Activity
            Write-Log "GAMEPLAY [$($activity.Type)] $($activity.PlayerName): $($activity.Activity)" -Level "Info"
            Send-GameplayActivityToDiscord -Activity $activity
        }
        
        # Save state after processing
        Save-GameplayState
        
    } catch {
        Write-Log "Error during gameplay log update: $($_.Exception.Message)" -Level "Info"
    }
}

function Get-NewGameplayActivities {
    # Get the latest gameplay log file
    $latestLogFile = Get-LatestGameplayLogFile
    if (-not $latestLogFile) {
        return @()
    }
    
    # Check if we're monitoring a different file now
    if ($script:CurrentLogFile -ne $latestLogFile) {
        Write-Log "Switched to new gameplay log file" -Level "Debug"
        $script:CurrentLogFile = $latestLogFile
        $script:LastLineNumber = 0  # Reset line counter for new file
    }
    
    if (-not (Test-Path $script:CurrentLogFile)) {
        Write-Log "Gameplay log file not found: $script:CurrentLogFile" -Level "Info"
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
        
        # Parse gameplay activities from new lines
        $newActivities = @()
        foreach ($line in $newLines) {
            if (-not [string]::IsNullOrWhiteSpace($line) -and $line -notmatch "Game version:") {
                $parsedActivity = ConvertFrom-GameplayLine -LogLine $line
                if ($parsedActivity) {
                    # All gameplay activities are enabled by default when GameplayFeed is enabled
                # MEMORY LEAK FIX: Use ArrayList instead of array +=
                if (-not $newActivities) {
                    $newActivities = New-Object System.Collections.ArrayList
                }
                $null = $newActivities.Add($parsedActivity)
                }
            }
        }
        
        return $newActivities
        
    } catch {
        Write-Log "Error reading gameplay log: $($_.Exception.Message)" -Level "Info"
        return @()
    }
}

function Get-LatestGameplayLogFile {
    try {
        # Get all gameplay log files
        $LogFiles = Get-ChildItem -Path $script:LogDirectory -Filter "gameplay_*.log" -ErrorAction SilentlyContinue
        
        if (-not $LogFiles -or $LogFiles.Count -eq 0) {
            Write-Log "No gameplay log files found in $script:LogDirectory" -Level "Info"
            return $null
        }
        
        # Sort by creation time and get the latest
        $latestFile = $LogFiles | Sort-Object CreationTime -Descending | Select-Object -First 1
        return $latestFile.FullName
        
    } catch {
        Write-Log "Error finding latest gameplay log: $($_.Exception.Message)" -Level "Info"
        return $null
    }
}

# ===============================================================
# STATE PERSISTENCE
# ===============================================================
function Save-GameplayState {
    try {
        $state = @{
            CurrentLogFile = $script:CurrentLogFile
            LastLineNumber = $script:LastLineNumber
            LastUpdate = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        }
        
        $stateJson = $state | ConvertTo-Json
        Set-Content -Path $script:StateFile -Value $stateJson -Encoding UTF8
        
    } catch {
        Write-Log "Failed to save gameplay log state: $($_.Exception.Message)" -Level "Info"
    }
}

function Load-GameplayState {
    try {
        if (Test-Path $script:StateFile) {
            $stateJson = Get-Content -Path $script:StateFile -Raw -Encoding UTF8
            $state = $stateJson | ConvertFrom-Json
            
            $script:CurrentLogFile = if ($state.CurrentLogFile) { $state.CurrentLogFile } else { $null }
            $script:LastLineNumber = if ($state.LastLineNumber) { $state.LastLineNumber } else { 0 }
            
            # Verify the saved log file still exists, if not reset
            if ($script:CurrentLogFile -and -not (Test-Path $script:CurrentLogFile)) {
                Write-Log "Previous gameplay log file no longer exists, resetting state" -Level "Info"
                $script:CurrentLogFile = $null
                $script:LastLineNumber = 0
            } else {
                Write-Log "Loaded gameplay log state: File=$($script:CurrentLogFile), Line=$($script:LastLineNumber)" -Level "Info"
            }
        } else {
            Write-Log "No previous gameplay log state found, starting from current log end" -Level "Info"
            # Initialize to current log file and skip to end to avoid spam
            $latestLogFile = Get-LatestGameplayLogFile
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
        Write-Log "Failed to load gameplay log state, starting fresh: $($_.Exception.Message)" -Level "Info"
        $script:CurrentLogFile = $null
        $script:LastLineNumber = 0
    }
}

# ===============================================================
# GAMEPLAY LOG PARSING
# ===============================================================
function ConvertFrom-GameplayLine {
    param([string]$LogLine)
    
    # Gameplay log patterns:
    # 2025.07.20-22.03.18: [LogExplosives] Crafted. User: Pleasureman69 (201, 76561199798298898). Ignitable explosive name: Pipe Bomb. Location: X=-165526.094 Y=-669428.750 Z=1234.456
    # 2025.07.20-22.08.00: [LogMinigame] [LockpickingMinigame_C] User: Pleasureman69 (201, 76561199798298898). Success: Yes. Elapsed time: 5.78. Failed attempts: 0. Target object: BPLockpick_Weapon_Locker_Police_C(ID: N/A). Lock type: VeryEasy. User owner: N/A. Location: X=-159735.156 Y=-689309.125 Z=634.765
    # 2025.07.20-22.19.00: [LogTrap] Crafted. User: Le Collecteur (1077, 76561198173425845). Trap name: Improvised Mine. Location: X=-456758.094 Y=-511302.094 Z=933.268
    # 2025.07.20-22.01.09: [LogBunkerLock] A1 Bunker Activated 06h 04m 14s ago
    
    # Extract timestamp
    if ($LogLine -match "^([\d.-]+):\s+(.+)") {
        $dateString = $matches[1]
        $logContent = $matches[2]
        
        try {
            # Parse date: 2025.07.20-22.00.19 -> 2025/07/20 22:00:19
            $datePart = $dateString -replace '\.', '/' -replace '-', ' '
            $timestamp = [datetime]::ParseExact($datePart, "yyyy/MM/dd HH.mm.ss", $null)
        } catch {
            $timestamp = Get-Date
        }
        
        # Parse different log types
        
        # BUNKER LOCK LOGS
        if ($logContent -match "^\[LogBunkerLock\]\s+(.+)") {
            $bunkerInfo = $matches[1]
            
            if ($bunkerInfo -match "^([A-Z]\d+)\s+Bunker\s+(Activated|is Active)\s+(.+)") {
                $bunkerCode = $matches[1]
                $status = $matches[2]
                $timeInfo = $matches[3]
                
                # Extract location if available
                $location = ""
                if ($timeInfo -match "X=([^Y]+)\s+Y=([^Z]+)\s+Z=(.+?)(?:\s|$)") {
                    $x = [double]$matches[1]
                    $y = [double]$matches[2]
                    $z = [double]$matches[3]
                    $location = "X=$x Y=$y Z=$z"
                    # Remove location from timeInfo to keep it clean
                    $timeInfo = $timeInfo -replace "\s*X=[^Y]+\s+Y=[^Z]+\s+Z=.+?(\s|$)", ""
                }
                
                return @{
                    Timestamp = $timestamp
                    PlayerName = "SYSTEM"
                    SteamId = ""
                    PlayerId = ""
                    Type = "bunker"
                    Activity = "bunker $bunkerCode $($status.ToLower())"
                    BunkerName = $bunkerCode
                    Status = $status
                    Details = $timeInfo.Trim()
                    Location = $location
                    RawLine = $LogLine
                }
            }
        }
        
        # EXPLOSIVES LOGS  
        elseif ($logContent -match "^\[LogExplosives\]\s+(Crafted|Pin pulled|Detonated)\.\s+User:\s+([^(]+)\s+\((\d+),\s+(\d+)\)\.\s+(.+)") {
            $action = $matches[1]
            $playerName = $matches[2].Trim()
            $playerId = $matches[3]
            $steamId = $matches[4]
            $details = $matches[5]
            
            # Extract item name based on action
            $itemName = "explosive"
            if ($action -eq "Crafted" -and $details -match "Ignitable explosive name:\s+(.+?)\.\s+Location:") {
                $itemName = $matches[1]
            } elseif ($action -eq "Pin pulled" -and $details -match "Grenade name:\s+(.+?)\.\s+Location:") {
                $itemName = $matches[1]
            } elseif ($action -eq "Detonated" -and $details -match "Grenade name:\s+(.+?)\.\s+Location:") {
                $itemName = $matches[1]
            }
            
            # Format action description
            $actionDesc = switch ($action) {
                "Crafted" { "crafted $itemName" }
                "Pin pulled" { "armed $itemName" }
                "Detonated" { "detonated $itemName" }
                default { "$($action.ToLower()) $itemName" }
            }
            
            # Extract location
            $location = ""
            if ($details -match "Location:\s+X=([^Y]+)\s+Y=([^Z]+)\s+Z=(.+)") {
                $x = [double]$matches[1]
                $y = [double]$matches[2]
                $z = [double]$matches[3]
                $location = "X=$x Y=$y Z=$z"
            }
            
            return @{
                Timestamp = $timestamp
                PlayerName = $playerName
                SteamId = $steamId
                PlayerId = $playerId
                Type = "explosive"
                Activity = $actionDesc
                ItemName = $itemName
                Action = $action
                Details = $details
                Location = $location
                RawLine = $LogLine
            }
        }
        
        # DIALPAD STANDALONE LOGS (detailed combination attempts)
        elseif ($logContent -match "^\[LogMinigame\]\s+\[DialPadMinigame\]\s+User:\s+([^(]+)\s+\((\d+),\s+(\d+)\)\.\s+(.+)") {
            $playerName = $matches[1].Trim()
            $playerId = $matches[2]
            $steamId = $matches[3]
            $details = $matches[4]
            
            # Extract combination and attempt info
            $combination = ""
            $attempt = ""
            $roomId = ""
            $elapsedTime = $null
            
            if ($details -match "Guessed Combination:\s+(\d+)\.") {
                $combination = $matches[1]
            }
            
            if ($details -match "(First try|Elapsed time since first try:\s+([\d.]+))") {
                if ($matches[1] -eq "First try") {
                    $attempt = "First attempt"
                } else {
                    $elapsedTime = [float]$matches[2]
                    $attempt = "Follow-up attempt"
                }
            }
            
            if ($details -match "Room Id:\s+([^.]+)\.") {
                $roomId = $matches[1]
            }
            
            # Extract player location
            $location = ""
            if ($details -match "Location:\s+X=([^Y]+)\s+Y=([^Z]+)\s+Z=([^.]+)\.") {
                $x = [double]$matches[1]
                $y = [double]$matches[2]
                $z = [double]$matches[3]
                $location = "X=$x Y=$y Z=$z"
            }
            
            $activityDescription = "tried combination $combination"
            if ($attempt -eq "First attempt") {
                $activityDescription += " (first attempt)"
            } elseif ($elapsedTime) {
                $activityDescription += " (after ${elapsedTime}s)"
            }
            
            return @{
                Timestamp = $timestamp
                PlayerName = $playerName
                SteamId = $steamId
                PlayerId = $playerId
                Type = "dialpad_attempt"
                Activity = $activityDescription
                Combination = $combination
                Attempt = $attempt
                ElapsedTime = $elapsedTime
                RoomId = $roomId
                Details = $details
                Location = $location
                RawLine = $LogLine
            }
        }
        
        # TRAP LOGS
        elseif ($logContent -match "^\[LogTrap\]\s+(Crafted|Armed)\.\s+User:\s+([^(]+)\s+\((\d+),\s+(\d+)\)\.\s+(.+)") {
            $action = $matches[1]
            $playerName = $matches[2].Trim()
            $playerId = $matches[3]
            $steamId = $matches[4]
            $details = $matches[5]
            
            # Extract trap name
            $trapName = "trap"
            if ($details -match "Trap name:\s+(.+?)\.\s+Location:") {
                $trapName = $matches[1]
            }
            
            # Extract location
            $location = ""
            if ($details -match "Location:\s+X=([^Y]+)\s+Y=([^Z]+)\s+Z=(.+)") {
                $x = [double]$matches[1]
                $y = [double]$matches[2]
                $z = [double]$matches[3]
                $location = "X=$x Y=$y Z=$z"
            }
            
            return @{
                Timestamp = $timestamp
                PlayerName = $playerName
                SteamId = $steamId
                PlayerId = $playerId
                Type = "trap"
                Activity = "$($action.ToLower()) trap: $trapName"
                TrapName = $trapName
                Action = $action
                Details = $details
                Location = $location
                RawLine = $LogLine
            }
        }
        
        # TRAP TRIGGERED LOGS (special case with different format that includes owner info)
        elseif ($logContent -match "^\[LogTrap\]\s+Triggered\.\s+User:\s+([^(]+)\s+\((\d+),\s+(\d+)\)\.\s+Trap name:\s+(.+?)\.\s+Owner:\s+([^(]+)\s+\((\d+),\s+(\d+)\)\.\s+Location:\s+X=([^Y]+)\s+Y=([^Z]+)\s+Z=(.+)") {
            $playerName = $matches[1].Trim()
            $playerId = $matches[2]
            $steamId = $matches[3]
            $trapName = $matches[4]
            $ownerName = $matches[5].Trim()
            $ownerPlayerId = $matches[6]
            $ownerSteamId = $matches[7]
            $x = [double]$matches[8]
            $y = [double]$matches[9] 
            $z = [double]$matches[10]
            
            $location = "X=$x Y=$y Z=$z"
            
            return @{
                Timestamp = $timestamp
                PlayerName = $playerName
                SteamId = $steamId
                PlayerId = $playerId
                Type = "trap"
                Activity = "triggered trap"
                TrapName = $trapName
                Action = "Triggered"
                TrapOwner = "$ownerName ($ownerPlayerId, $ownerSteamId)"
                TrapOwnerName = $ownerName
                TrapOwnerPlayerId = $ownerPlayerId
                TrapOwnerSteamId = $ownerSteamId
                Location = $location
                RawLine = $LogLine
            }
        }
        
        # MINIGAME LOGS
        elseif ($logContent -match "^\[LogMinigame\]\s+\[([^\]]+)\]\s+User:\s+([^(]+)\s+\((\d+),\s+(\d+)\)\.\s+Success:\s+(Yes|No)\.(.*)") {
            $minigameType = $matches[1]
            $playerName = $matches[2].Trim()
            $playerId = $matches[3]
            $steamId = $matches[4]
            $success = $matches[5] -eq "Yes"
            $additionalInfo = $matches[6]
            
            # Extract detailed minigame information
            $elapsedTime = $null
            if ($additionalInfo -match "Elapsed time:\s+(\d+(?:\.\d+)?)") {
                $elapsedTime = [float]$matches[1]
            }
            
            $failedAttempts = $null
            if ($additionalInfo -match "Failed attempts:\s+(\d+)") {
                $failedAttempts = [int]$matches[1]
            }
            
            $targetObject = $null
            $lockType = $null
            if ($additionalInfo -match "Target object:\s+([^(]+)\([^)]*\)[^.]*\.\s+Lock type:\s+(\w+)") {
                $rawTarget = $matches[1].Trim()
                # Clean up target object name - remove Blueprint prefixes but keep readable name
                $targetObject = $rawTarget -replace "^BP_?", "" -replace "Lockpick_", "" -replace "_C$", "" -replace "_", " "
                $lockType = $matches[2]
            }
            
            $userOwner = $null
            $userOwnerName = $null
            $userOwnerPlayerId = $null  
            $userOwnerSteamId = $null
            
            if ($additionalInfo -match "User owner:\s+(.+?)(?:\.\s+Location:|$)") {
                $ownerInfo = $matches[1].Trim()
                if ($ownerInfo -ne "N/A") {
                    # Parse owner info: "1039([76561198089280107] TaRaLeRo TaRaRa)"
                    if ($ownerInfo -match "^(\d+)\(\[(\d+)\]\s+(.+?)\)$") {
                        $userOwnerPlayerId = $matches[1]
                        $userOwnerSteamId = $matches[2] 
                        $userOwnerName = $matches[3].Trim()
                        $userOwner = "$userOwnerName (ID: $userOwnerPlayerId)"
                    } else {
                        $userOwner = $ownerInfo
                    }
                }
            }
            
            # Determine minigame category and create specific activity description
            $category = "minigame"
            
            if ($minigameType -match "Lockpicking") {
                $category = "lockpicking"
                if ($success) {
                    $activityDescription = "successfully picked lock"
                    if ($lockType -and $targetObject) {
                        $activityDescription += " ($lockType on $targetObject)"
                    }
                } else {
                    $activityDescription = "failed to pick lock"
                    if ($lockType -and $targetObject) {
                        $activityDescription += " ($lockType on $targetObject)"
                    }
                }
            }
            elseif ($minigameType -match "QuestBook") {
                $category = "quest"
                $activityDescription = if ($success) { "completed quest book puzzle" } else { "failed quest book puzzle" }
            }
            elseif ($minigameType -match "Bunker") {
                $category = "bunker_minigame"
                if ($minigameType -match "Voltage") {
                    $activityDescription = if ($success) { "solved voltage puzzle" } else { "voltage puzzle failed" }
                } elseif ($minigameType -match "Switchboard") {
                    $activityDescription = if ($success) { "solved switchboard puzzle" } else { "switchboard puzzle failed" }
                } elseif ($minigameType -match "DialPad") {
                    $activityDescription = if ($success) { "cracked dial pad" } else { "dial pad attempt failed" }
                } else {
                    $activityDescription = if ($success) { "solved bunker puzzle" } else { "bunker puzzle failed" }
                }
            }
            elseif ($minigameType -match "DialPad|DialLock") {
                $category = "dialpad" 
                if ($success) {
                    $activityDescription = "cracked dial lock"
                } else {
                    $activityDescription = "failed to crack dial lock"
                    if ($failedAttempts -gt 0) {
                        $activityDescription += " ($failedAttempts attempts)"
                    }
                }
                
                # Extract combination attempts for DialPad specifically
                if ($additionalInfo -match "Guessed Combination:\s+(\d+)") {
                    $combination = $matches[1]
                    $activityDescription += " (tried $combination)"
                }
            }
            else {
                # Generic minigame fallback
                $activityDescription = if ($success) { "completed minigame" } else { "failed minigame" }
                if ($minigameType) {
                    $cleanType = $minigameType -replace "^BP_?", "" -replace "_C$", "" -replace "_", " "
                    $activityDescription += " ($cleanType)"
                }
            }
            
            # Extract location if available
            $location = ""
            if ($additionalInfo -match "Location:\s+X=([^Y]+)\s+Y=([^Z]+)\s+Z=(.+?)(?:\.|$|\s)") {
                $x = [double]$matches[1]
                $y = [double]$matches[2]
                $z = [double]$matches[3]
                $location = "X=$x Y=$y Z=$z"
            }
            
            return @{
                Timestamp = $timestamp
                PlayerName = $playerName
                SteamId = $steamId
                PlayerId = $playerId
                Type = $category
                Activity = $activityDescription
                MinigameType = $minigameType
                Success = $success
                ElapsedTime = $elapsedTime
                FailedAttempts = $failedAttempts
                TargetObject = $targetObject
                LockType = $lockType
                UserOwner = $userOwner
                UserOwnerName = $userOwnerName
                UserOwnerPlayerId = $userOwnerPlayerId
                UserOwnerSteamId = $userOwnerSteamId
                Details = $additionalInfo
                Location = $location
                RawLine = $LogLine
            }
        }
        
        # BASE BUILDING LOGS (Flag operations)
        elseif ($logContent -match "^\[LogBaseBuilding\]\s+\[Flag\]\s+(Overtaken|Destroyed)\.?\s*(.*)") {
            $action = $matches[1]
            $details = $matches[2]
            
            # For overtaken flags, extract player information
            if ($action -eq "Overtaken" -and $details -match "New owner:\s+(\d+)\s+\((\d+),\s+([^)]+)\)\.\s+Old owner:\s+(\d+)\s+\((\d+),\s+([^)]+)\)") {
                $newOwnerSteamId = $matches[1]
                $newOwnerPlayerId = $matches[2]
                $newOwnerName = $matches[3]
                $oldOwnerSteamId = $matches[4]
                $oldOwnerPlayerId = $matches[5]
                $oldOwnerName = $matches[6]
                
                # Extract flag ID and location if available
                $flagId = ""
                $location = ""
                if ($details -match "FlagId:\s+(\d+)") {
                    $flagId = $matches[1]
                }
                if ($details -match "Location:\s+X=([^Y]+)\s+Y=([^Z]+)\s+Z=(.+?)(?:\s|$)") {
                    $x = [double]$matches[1]
                    $y = [double]$matches[2]
                    $z = [double]$matches[3]
                    $location = "X=$x Y=$y Z=$z"
                }
                
                return @{
                    Timestamp = $timestamp
                    PlayerName = $newOwnerName
                    SteamId = $newOwnerSteamId
                    PlayerId = $newOwnerPlayerId
                    Type = "flag"
                    Activity = "captured flag from $oldOwnerName" + $(if ($flagId) { " (Flag #$flagId)" } else { "" })
                    Details = "Old owner: $oldOwnerName ($oldOwnerSteamId)"
                    Location = $location
                    RawLine = $LogLine
                }
            }
            # For destroyed flags
            elseif ($action -eq "Destroyed" -and $details -match "FlagId:\s+(\d+)\.\s+Owner:\s+(\d+)\s+\((\d+),\s+([^)]+)\)") {
                $flagId = $matches[1]
                $ownerSteamId = $matches[2]
                $ownerPlayerId = $matches[3]
                $ownerName = $matches[4]
                
                # Extract location if available
                $location = ""
                if ($details -match "Location:\s+X=([^Y]+)\s+Y=([^Z]+)\s+Z=(.+?)(?:\s|$)") {
                    $x = [double]$matches[1]
                    $y = [double]$matches[2]
                    $z = [double]$matches[3]
                    $location = "X=$x Y=$y Z=$z"
                }
                
                return @{
                    Timestamp = $timestamp
                    PlayerName = $ownerName
                    SteamId = $ownerSteamId
                    PlayerId = $ownerPlayerId
                    Type = "flag"
                    Activity = "lost flag #$flagId (destroyed)"
                    Details = "Flag destroyed"
                    Location = $location
                    RawLine = $LogLine
                }
            }
        }
        
        # TRAP DISARMED LOGS (special case)
        elseif ($logContent -match "^\[LogTrap\]\s+(Disarmed)\.\s+User:\s+([^(]+)\s+\((\d+),\s+(\d+)\)\.\s+(.+)") {
            $action = $matches[1]
            $playerName = $matches[2].Trim()
            $playerId = $matches[3]
            $steamId = $matches[4]
            $details = $matches[5]
            
            # Extract trap name
            $trapName = "trap"
            if ($details -match "Trap name:\s+(.+?)\.\s+Location:") {
                $trapName = $matches[1]
            }
            
            # Extract location
            $location = ""
            if ($details -match "Location:\s+X=([^Y]+)\s+Y=([^Z]+)\s+Z=(.+)") {
                $x = [double]$matches[1]
                $y = [double]$matches[2]
                $z = [double]$matches[3]
                $location = "X=$x Y=$y Z=$z"
            }
            
            return @{
                Timestamp = $timestamp
                PlayerName = $playerName
                SteamId = $steamId
                PlayerId = $playerId
                Type = "trap"
                Activity = "disarmed trap: $trapName"
                TrapName = $trapName
                Action = $action
                Details = $details
                Location = $location
                RawLine = $LogLine
            }
        }
        
        # BOMB DEFUSAL MINIGAME LOGS
        elseif ($logContent -match "^\[LogMinigame\]\s+\[BP_BombDefusalMinigame_C\]\s+User:\s+([^(]+)\s+\((\d+),\s+(\d+)\)\.\s+Success:\s+(Yes|No)\.\s+Elapsed time:\s+([\d.]+)\.\s+Failed attempts:\s+(\d+)\.\s+Target object:\s+([^.]+)\.\s+User owner:\s+([^.]+)\.\s+Location:\s+(.+)") {
            $playerName = $matches[1].Trim()
            $playerId = $matches[2]
            $steamId = $matches[3]
            $success = $matches[4] -eq "Yes"
            $elapsedTime = [float]$matches[5]
            $failedAttempts = [int]$matches[6]
            $targetObject = $matches[7]
            $bombOwner = $matches[8]
            $locationText = $matches[9]
            
            # Extract location
            $location = ""
            if ($locationText -match "X=([^Y]+)\s+Y=([^Z]+)\s+Z=(.+)") {
                $x = [double]$matches[1]
                $y = [double]$matches[2]
                $z = [double]$matches[3]
                $location = "X=$x Y=$y Z=$z"
            }
            
            # Clean target object name
            $bombType = $targetObject -replace "_C_\d+$", "" -replace "_C$", "" -replace "_", " "
            
            $activityDescription = if ($success) {
                "successfully defused $bombType"
            } else {
                "failed to defuse $bombType"
            }
            
            return @{
                Timestamp = $timestamp
                PlayerName = $playerName
                SteamId = $steamId
                PlayerId = $playerId
                Type = "bomb_defusal"
                Activity = $activityDescription
                Success = $success
                ElapsedTime = $elapsedTime
                FailedAttempts = $failedAttempts
                BombType = $bombType
                BombOwner = $bombOwner
                TargetObject = $targetObject
                Location = $location
                RawLine = $LogLine
            }
        }
    }
    
    return $null
}

# ===============================================================
# DISCORD INTEGRATION  
# ===============================================================
function Send-GameplayActivityToDiscord {
    param([hashtable]$Activity)
    
    try {
        # Validate activity data
        if (-not $Activity -or -not $Activity.Activity) {
            Write-Log "Invalid gameplay activity data, skipping Discord notification" -Level "Debug"
            return
        }
        
        # Try to use embed format
        if (Get-Command "Send-GameplayEmbed" -ErrorAction SilentlyContinue) {
            try {
                Write-Log "Creating gameplay embed for $($Activity.PlayerName)" -Level "Debug"
                $embedData = Send-GameplayEmbed -GameplayActivity $Activity
                Write-Log "Gameplay embed data created successfully" -Level "Debug"
                
                if (Get-Command "Send-DiscordMessage" -ErrorAction SilentlyContinue) {
                    Write-Log "Sending gameplay embed to Discord..." -Level "Debug"
                    $result = Send-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:Config.Channel -Embed $embedData
                    if ($result -and $result.success) {
                        Write-Log "Gameplay activity embed sent successfully" -Level "Info"
                        return
                    } else {
                        Write-Log "Gameplay activity embed failed to send: $($result | ConvertTo-Json)" -Level "Warning"
                    }
                } else {
                    Write-Log "Send-DiscordMessage command not found" -Level "Warning"
                }
            } catch {
                Write-Log "Error creating gameplay embed: $($_.Exception.Message)" -Level "Warning"
            }
        } else {
            Write-Log "Send-GameplayEmbed function not found" -Level "Warning"
        }
        
    } catch {
        Write-Log "Error in Send-GameplayActivityToDiscord: $($_.Exception.Message)" -Level "Error"
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
    'Initialize-GameplayLogModule',
    'ConvertFrom-GameplayLine',
    'Update-GameplayLogProcessing',
    'Get-NewGameplayActivities',
    'Get-LatestGameplayLogFile',
    'Send-GameplayActivityToDiscord',
    'Apply-MessageFilter',
    'Save-GameplayState',
    'Load-GameplayState'
)


