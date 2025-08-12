# ===============================================================
# SCUM Server Automation - Discord Fame Points Log Manager
# ===============================================================
# Real-time fame points log monitoring and Discord relay system
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
    Write-Host "[WARNING] Common module not available for famepoints-log module" -ForegroundColor Yellow
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
function Initialize-FamePointsLogModule {
    param([hashtable]$Config)
    
    try {
        Write-Log "Initializing fame points log management system..." -Level "Info"
        
        # Initialize configuration
        $script:DiscordConfig = $Config.Discord
        if (-not $script:DiscordConfig -or -not $script:DiscordConfig.Token) {
            Write-Log "Discord not configured, fame points log relay disabled" -Level "Info"
            return $false
        }
        
        # Look for FamePointsFeed in Features section
        if ($Config.SCUMLogFeatures -and $Config.SCUMLogFeatures.FamePointsFeed) {
            $script:Config = $Config.SCUMLogFeatures.FamePointsFeed
        }
        else {
            Write-Log "Fame points log relay not enabled in configuration" -Level "Info"
            return $false
        }
        
        if (-not $script:Config.Enabled) {
            Write-Log "Fame points log relay not enabled in configuration" -Level "Info"
            return $false
        }
        
        # Initialize fame points log directory
        $serverDir = $Config.serverDir
        if (-not $serverDir) {
            Write-Log "Server directory not configured" -Level "Info"
            return $false
        }
        
        $script:LogDirectory = Join-Path $serverDir "SCUM\Saved\SaveFiles\Logs"
        Write-Log "Fame points log directory: $script:LogDirectory" -Level "Info"
        
        if (-not (Test-Path $script:LogDirectory)) {
            Write-Log "Fame points log directory not found: $script:LogDirectory" -Level "Info"
            return $false
        }
        
        # Initialize state persistence
        $stateDir = ".\state"
        if (-not (Test-Path $stateDir)) {
            New-Item -Path $stateDir -ItemType Directory -Force | Out-Null
        }
        $script:StateFile = Join-Path $stateDir "famepoints-log-manager.json"
        
        # Load previous state
        Load-FamePointsState
        
        # Mark as active
        $script:IsMonitoring = $true
        $script:IsRelayActive = $true
        
        return $true
    } catch {
        Write-Log "Failed to initialize fame points log manager: $($_.Exception.Message)" -Level "Info"
        return $false
    }
}

# ===============================================================
# FAME POINTS LOG MONITORING
# ===============================================================
function Update-FamePointsLogProcessing {
    if (-not $script:IsMonitoring -or -not $script:IsRelayActive) {
        return
    }
    
    try {
        $newActions = Get-NewFamePointsActions
        
        if (-not $newActions -or $newActions.Count -eq 0) {
            return
        }
        
        foreach ($action in $newActions) {
            # Clean format with details count if available
            $detailsInfo = if ($action.Details -and $action.Details.Count -gt 0) { " ($($action.Details.Count) details)" } else { "" }
            Write-Log "FAME POINTS [$($action.Type)] $($action.PlayerName): $($action.Action)$detailsInfo" -Level "Info"
            Send-FamePointsActionToDiscord -Action $action
        }
        
        # Save state after processing
        Save-FamePointsState
        
    } catch {
        Write-Log "Error during fame points log update: $($_.Exception.Message)" -Level "Info"
    }
}

function Get-NewFamePointsActions {
    # Get the latest fame points log file
    $latestLogFile = Get-LatestFamePointsLogFile
    if (-not $latestLogFile) {
        return @()
    }
    
    # Check if we're monitoring a different file now
    if ($script:CurrentLogFile -ne $latestLogFile) {
        Write-Log "Switched to new fame points log file" -Level "Debug"
        $script:CurrentLogFile = $latestLogFile
        $script:LastLineNumber = 0  # Reset line counter for new file
    }
    
    if (-not (Test-Path $script:CurrentLogFile)) {
        Write-Log "Fame points log file not found: $script:CurrentLogFile" -Level "Info"
        return @()
    }
    
    try {
        # Read all lines from the log file - SCUM fame points logs use UTF-16 LE encoding
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
        
        # Parse fame points actions from new lines
        $newActions = @()
        $pendingDetails = @()
        $lastPeriodicAction = $null
        
        foreach ($line in $newLines) {
            if (-not [string]::IsNullOrWhiteSpace($line) -and $line -notmatch "Game version:" -and $line -notmatch "^-+$") {
                $parsedAction = ConvertFrom-FamePointsLine -LogLine $line
                if ($parsedAction) {
                    if ($parsedAction.IsDetail) {
                        # Collect detail lines that come after periodic summary
                        $pendingDetails += $parsedAction
                    } else {
                        # This is a main action
                        if ($parsedAction.Type -eq "periodic") {
                            # If we had a previous periodic action with pending details, finalize it
                            if ($lastPeriodicAction -and $pendingDetails.Count -gt 0) {
                                $lastPeriodicAction.Details = $pendingDetails
                                $pendingDetails = @()
                            }
                            # Store this as the new last periodic action
                            $lastPeriodicAction = $parsedAction
                            $newActions += $parsedAction
                        } else {
                            # Non-periodic action, finalize any pending periodic action
                            if ($lastPeriodicAction -and $pendingDetails.Count -gt 0) {
                                $lastPeriodicAction.Details = $pendingDetails
                                $pendingDetails = @()
                                $lastPeriodicAction = $null
                            }
                            $newActions += $parsedAction
                        }
                    }
                }
            }
        }
        
        # Finalize any remaining periodic action with details
        if ($lastPeriodicAction -and $pendingDetails.Count -gt 0) {
            $lastPeriodicAction.Details = $pendingDetails
        }
        
        return $newActions
        
    } catch {
        Write-Log "Error reading fame points log: $($_.Exception.Message)" -Level "Info"
        return @()
    }
}

function Get-LatestFamePointsLogFile {
    try {
        # Get all fame points log files
        $LogFiles = Get-ChildItem -Path $script:LogDirectory -Filter "famepoints_*.log" -ErrorAction SilentlyContinue
        
        if (-not $LogFiles -or $LogFiles.Count -eq 0) {
            Write-Log "No fame points log files found in $script:LogDirectory" -Level "Info"
            return $null
        }
        
        # Sort by creation time and get the latest
        $latestFile = $LogFiles | Sort-Object CreationTime -Descending | Select-Object -First 1
        return $latestFile.FullName
        
    } catch {
        Write-Log "Error finding latest fame points log: $($_.Exception.Message)" -Level "Info"
        return $null
    }
}

# ===============================================================
# STATE PERSISTENCE
# ===============================================================
function Save-FamePointsState {
    try {
        $state = @{
            CurrentLogFile = $script:CurrentLogFile
            LastLineNumber = $script:LastLineNumber
            LastUpdate = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        }
        
        $stateJson = $state | ConvertTo-Json
        Set-Content -Path $script:StateFile -Value $stateJson -Encoding UTF8
        
    } catch {
        Write-Log "Failed to save fame points log state: $($_.Exception.Message)" -Level "Info"
    }
}

function Load-FamePointsState {
    try {
        if (Test-Path $script:StateFile) {
            $stateJson = Get-Content -Path $script:StateFile -Raw -Encoding UTF8
            $state = $stateJson | ConvertFrom-Json
            
            $script:CurrentLogFile = if ($state.CurrentLogFile) { $state.CurrentLogFile } else { $null }
            $script:LastLineNumber = if ($state.LastLineNumber) { $state.LastLineNumber } else { 0 }
            
            # Verify the saved log file still exists, if not reset
            if ($script:CurrentLogFile -and -not (Test-Path $script:CurrentLogFile)) {
                Write-Log "Previous fame points log file no longer exists, resetting state" -Level "Info"
                $script:CurrentLogFile = $null
                $script:LastLineNumber = 0
            } else {
                Write-Log "Loaded fame points log state: File=$($script:CurrentLogFile), Line=$($script:LastLineNumber)" -Level "Info"
            }
        } else {
            Write-Log "No previous fame points log state found, starting from current log end" -Level "Info"
            # Initialize to current log file and skip to end to avoid spam
            $latestLogFile = Get-LatestFamePointsLogFile
            if ($latestLogFile -and (Test-Path $latestLogFile)) {
                $script:CurrentLogFile = $latestLogFile
                # Read current file and set position to end
                try {
                    $allLines = Get-Content $script:CurrentLogFile -Encoding Unicode -ErrorAction SilentlyContinue
                    $script:LastLineNumber = if ($allLines) { $allLines.Count } else { 0 }
                    Write-Log "Initialized fame points log state: File=$($script:CurrentLogFile), Starting from line $($script:LastLineNumber)" -Level "Info"
                } catch {
                    $script:LastLineNumber = 0
                }
            } else {
                $script:CurrentLogFile = $null
                $script:LastLineNumber = 0
            }
        }
    } catch {
        Write-Log "Failed to load fame points log state, starting fresh: $($_.Exception.Message)" -Level "Info"
        $script:CurrentLogFile = $null
        $script:LastLineNumber = 0
    }
}

# ===============================================================
# FAME POINTS LOG PARSING
# ===============================================================
function ConvertFrom-FamePointsLine {
    param([string]$LogLine)
    
    # Skip separators and empty lines
    if ([string]::IsNullOrWhiteSpace($LogLine) -or $LogLine -match "^-+$" -or $LogLine -match "Game version:") {
        return $null
    }
    
    # Fame points log patterns (based on actual log files):
    
    # Pattern 1: Simple awards with timestamp
    # 2025.07.17-16.20.04: Player Le Raleur(76561197996638197) was awarded 10.500000 fame points for SkillLeveledUp
    if ($LogLine -match "^([\d.-]+):\s+Player\s+([^(]+)\((\d+)\)\s+was awarded\s+([\d.]+)\s+fame points for\s+(.+)$") {
        $date = $matches[1]
        $playerName = $matches[2].Trim()
        $steamId = $matches[3]
        $amount = [float]$matches[4]
        $reason = $matches[5].Trim()
        
        try {
            # Parse date: 2025.07.17-16.20.04 -> 2025/07/17 16:20:04
            $datePart = $date -replace '\.', '/' -replace '-', ' '
            $timestamp = [datetime]::ParseExact($datePart, "yyyy/MM/dd HH.mm.ss", $null)
        } catch {
            $timestamp = Get-Date
        }
        
        # Determine action type and description based on reason
        $actionType = "award"
        $action = "awarded $amount fame points for $reason"
        
        # Categorize different types of awards
        if ($reason -match "AdminCommand") {
            $actionType = "admin"
            $action = "received $amount fame points from admin command"
        } elseif ($reason -match "SkillLeveledUp") {
            $actionType = "skill"
            $action = "gained $amount fame points for leveling up skill"
        } elseif ($reason -match "DeathmatchWon") {
            $actionType = "deathmatch"
            $action = "earned $amount fame points for winning deathmatch"
        } elseif ($reason -match "FameTransferOnKill") {
            $actionType = "kill"
            $action = "gained $amount fame points from killing another player"
        } elseif ($reason -match "PuppetKill") {
            $actionType = "zombie"
            $action = "earned $amount fame points for killing zombies"
        } elseif ($reason -match "FirearmKill|FirearmHeadShotOver200m") {
            $actionType = "firearm"
            $action = "gained $amount fame points for firearm kill"
        } elseif ($reason -match "MeleeKill") {
            $actionType = "melee"
            $action = "earned $amount fame points for melee kill"
        } elseif ($reason -match "ItemCrafted") {
            $actionType = "craft"
            $action = "gained $amount fame points for crafting items"
        } elseif ($reason -match "ItemLooted") {
            $actionType = "loot"
            $action = "earned $amount fame points for looting"
        } elseif ($reason -match "FishCaught|FishKept.*Consecutively") {
            $actionType = "fishing"
            $action = "gained $amount fame points for fishing"
        } elseif ($reason -match "RecoveredFromInfection") {
            $actionType = "recovery"
            $action = "earned $amount fame points for recovering from infection"
        } elseif ($reason -match "WeedsPlucked") {
            $actionType = "farming"
            $action = "gained $amount fame points for farming"
        } elseif ($reason -match "LockPicked") {
            $actionType = "lockpick"
            $action = "earned $amount fame points for lockpicking"
        } elseif ($reason -match "MinigameCompleted") {
            $actionType = "minigame"
            $action = "gained $amount fame points for completing minigame"
        } elseif ($reason -match "PlasticSurgeryCompleted") {
            $actionType = "surgery"
            $action = "earned $amount fame points for plastic surgery"
        } else {
            $action = "awarded $amount fame points for $reason"
        }
        
        return @{
            Timestamp = $timestamp
            PlayerName = $playerName
            SteamId = $steamId
            Amount = $amount
            Reason = $reason
            Action = $action
            Type = $actionType
            RawLine = $LogLine
        }
    }
    
    # Pattern 2: Block summaries (10-minute periodic awards) without timestamp
    # Player Zeltaon(76561198212603353) was awarded 1611.960938 fame points in 10 minutes for a total of 1611.960938
    elseif ($LogLine -match "^Player\s+([^(]+)\((\d+)\)\s+was awarded\s+([\d.]+)\s+fame points in 10 minutes for a total of\s+([\d.]+)") {
        $playerName = $matches[1].Trim()
        $steamId = $matches[2]
        $amount = [float]$matches[3]
        $total = [float]$matches[4]
        
        $timestamp = Get-Date
        $actionType = "periodic"
        $action = "awarded $amount fame points (10-minute period, total: $total)"
        
        return @{
            Timestamp = $timestamp
            PlayerName = $playerName
            SteamId = $steamId
            Amount = $amount
            Total = $total
            Action = $action
            Type = $actionType
            RawLine = $LogLine
        }
    }
    
    # Pattern 3: Detail lines from periodic blocks (BaseFameInflux, OnlineFlagOwnersAwardAwarded, etc.)
    # These are usually part of the periodic summary and can be parsed for detailed analysis
    elseif ($LogLine -match "^(BaseFameInflux|OnlineFlagOwnersAwardAwarded|DistanceTraveledOnFoot|PuppetKill|FirearmKill|MeleeKill|ItemLooted|RecoveredFromInfection|MinigameCompleted|LockPicked|BandageApplied|LandedWithParachute|BlueprintBuilt|BaseElementBuilt|ItemCrafted|KillClaimed|DistanceTraveledWhileMounted):\s+([\d.]+)") {
        $detailType = $matches[1]
        $detailAmount = [float]$matches[2]
        
        # Return detail line as a special type
        return @{
            Timestamp = Get-Date
            DetailType = $detailType
            Amount = $detailAmount
            Action = "earned $detailAmount fame points from $detailType"
            Type = "detail"
            IsDetail = $true
            RawLine = $LogLine
        }
    }
    
    return $null
}

# ===============================================================
# DISCORD INTEGRATION
# ===============================================================
function Send-FamePointsActionToDiscord {
    param($Action)
    
    try {
        # Validate action data
        if (-not $Action -or -not $Action.Action) {
            Write-Log "Invalid fame points action data, skipping Discord notification" -Level "Debug"
            return
        }
        
        # Try to use embed format
        if (Get-Command "Send-FamePointsEmbed" -ErrorAction SilentlyContinue) {
            try {
                Write-Log "Creating fame points embed for $($Action.PlayerName)" -Level "Debug"
                $embedData = Send-FamePointsEmbed -FamePointsAction $Action
                Write-Log "Fame points embed data created successfully" -Level "Debug"
                
                if (Get-Command "Send-DiscordMessage" -ErrorAction SilentlyContinue) {
                    Write-Log "Sending fame points embed to Discord..." -Level "Debug"
                    $result = Send-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:Config.Channel -Embed $embedData
                    if ($result -and $result.success) {
                        Write-Log "Fame points action embed sent successfully" -Level "Info"
                        return
                    } else {
                        Write-Log "Fame points action embed failed to send: $($result | ConvertTo-Json)" -Level "Warning"
                    }
                } else {
                    Write-Log "Send-DiscordMessage command not found" -Level "Warning"
                }
            } catch {
                Write-Log "Error creating fame points embed: $($_.Exception.Message)" -Level "Warning"
            }
        } else {
            Write-Log "Send-FamePointsEmbed function not found" -Level "Warning"
        }
        
    } catch {
        Write-Log "Error in Send-FamePointsActionToDiscord: $($_.Exception.Message)" -Level "Error"
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
    'Initialize-FamePointsLogModule',
    'ConvertFrom-FamePointsLine',
    'Update-FamePointsLogProcessing',
    'Get-NewFamePointsActions',
    'Get-LatestFamePointsLogFile',
    'Send-FamePointsActionToDiscord',
    'Apply-MessageFilter',
    'Save-FamePointsState',
    'Load-FamePointsState'
)


