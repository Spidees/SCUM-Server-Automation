# ===============================================================
# SCUM Server Automation - Discord Admin Log Manager
# ===============================================================
# Real-time admin log monitoring and Discord relay system
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
    Write-Host "[WARNING] Common module not available for admin-log module" -ForegroundColor Yellow
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
function Initialize-AdminLogModule {
    param([hashtable]$Config)
    
    try {
        Write-Log "Initializing admin log management system..." -Level "Info"
        
        # Initialize configuration
        $script:DiscordConfig = $Config.Discord
        if (-not $script:DiscordConfig -or -not $script:DiscordConfig.Token) {
            Write-Log "Discord not configured, admin log relay disabled" -Level "Info"
            return $false
        }
        
        # Look for AdminFeed in Features section
        if ($Config.SCUMLogFeatures -and $Config.SCUMLogFeatures.AdminFeed) {
            $script:Config = $Config.SCUMLogFeatures.AdminFeed
        }
        else {
            Write-Log "Admin log relay not enabled in configuration" -Level "Info"
            return $false
        }
        
        if (-not $script:Config.Enabled) {
            Write-Log "Admin log relay not enabled in configuration" -Level "Info"
            return $false
        }
        
        # Initialize admin log directory
        $serverDir = $Config.serverDir
        if (-not $serverDir) {
            Write-Log "Server directory not configured" -Level "Info"
            return $false
        }
        
        $script:LogDirectory = Join-Path $serverDir "SCUM\Saved\SaveFiles\Logs"
        Write-Log "Admin log directory: $script:LogDirectory" -Level "Info"
        
        if (-not (Test-Path $script:LogDirectory)) {
            Write-Log "Admin log directory not found: $script:LogDirectory" -Level "Info"
            return $false
        }
        
        # Initialize state persistence
        $stateDir = ".\state"
        if (-not (Test-Path $stateDir)) {
            New-Item -Path $stateDir -ItemType Directory -Force | Out-Null
        }
        $script:StateFile = Join-Path $stateDir "admin-log-manager.json"
        
        # Load previous state
        Load-AdminState
        
        # Mark as active
        $script:IsMonitoring = $true
        $script:IsRelayActive = $true
        
        return $true
    } catch {
        Write-Log "Failed to initialize admin log manager: $($_.Exception.Message)" -Level "Info"
        return $false
    }
}

# ===============================================================
# ADMIN LOG MONITORING
# ===============================================================
function Update-AdminLogProcessing {
    if (-not $script:IsMonitoring -or -not $script:IsRelayActive) {
        return
    }
    
    try {
        $newActions = Get-NewAdminActions
        
        if (-not $newActions -or $newActions.Count -eq 0) {
            return
        }
        
        foreach ($action in $newActions) {
            # Clean format: ADMIN [Type] Name: Action
            Write-Log "ADMIN [$($action.Type)] $($action.AdminName): $($action.Action)" -Level "Info"
            Send-AdminActionToDiscord -Action $action
        }
        
        # Save state after processing
        Save-AdminState
        
    } catch {
        Write-Log "Error during admin log update: $($_.Exception.Message)" -Level "Info"
    }
}

function Get-NewAdminActions {
    # Get the latest admin log file
    $latestLogFile = Get-LatestAdminLogFile
    if (-not $latestLogFile) {
        return @()
    }
    
    # Check if we're monitoring a different file now
    if ($script:CurrentLogFile -ne $latestLogFile) {
        Write-Log "Switched to new admin log file" -Level "Debug"
        $script:CurrentLogFile = $latestLogFile
        $script:LastLineNumber = 0  # Reset line counter for new file
    }
    
    if (-not (Test-Path $script:CurrentLogFile)) {
        Write-Log "Admin log file not found: $script:CurrentLogFile" -Level "Info"
        return @()
    }
    
    try {
        # Read all lines from the log file - SCUM admin logs use UTF-16 LE encoding
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
        
        # Parse admin actions from new lines
        $newActions = @()
        foreach ($line in $newLines) {
            if (-not [string]::IsNullOrWhiteSpace($line) -and $line -notmatch "Game version:") {
                $parsedAction = ConvertFrom-AdminLine -LogLine $line
                if ($parsedAction) {
                    # All admin actions are enabled by default when AdminFeed is enabled
                    $newActions += $parsedAction
                }
            }
        }
        
        return $newActions
        
    } catch {
        Write-Log "Error reading admin log: $($_.Exception.Message)" -Level "Info"
        return @()
    }
}

function Get-LatestAdminLogFile {
    try {
        # Get all admin log files
        $LogFiles = Get-ChildItem -Path $script:LogDirectory -Filter "admin_*.log" -ErrorAction SilentlyContinue
        
        if (-not $LogFiles -or $LogFiles.Count -eq 0) {
            Write-Log "No admin log files found in $script:LogDirectory" -Level "Info"
            return $null
        }
        
        # Sort by creation time and get the latest
        $latestFile = $LogFiles | Sort-Object CreationTime -Descending | Select-Object -First 1
        return $latestFile.FullName
        
    } catch {
        Write-Log "Error finding latest admin log: $($_.Exception.Message)" -Level "Info"
        return $null
    }
}

# ===============================================================
# STATE PERSISTENCE
# ===============================================================
function Save-AdminState {
    try {
        $state = @{
            CurrentLogFile = $script:CurrentLogFile
            LastLineNumber = $script:LastLineNumber
            LastUpdate = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        }
        
        $stateJson = $state | ConvertTo-Json
        Set-Content -Path $script:StateFile -Value $stateJson -Encoding UTF8
        
    } catch {
        Write-Log "Failed to save admin log state: $($_.Exception.Message)" -Level "Info"
    }
}

function Load-AdminState {
    try {
        if (Test-Path $script:StateFile) {
            $stateJson = Get-Content -Path $script:StateFile -Raw -Encoding UTF8
            $state = $stateJson | ConvertFrom-Json
            
            $script:CurrentLogFile = if ($state.CurrentLogFile) { $state.CurrentLogFile } else { $null }
            $script:LastLineNumber = if ($state.LastLineNumber) { $state.LastLineNumber } else { 0 }
            
            # Verify the saved log file still exists, if not reset
            if ($script:CurrentLogFile -and -not (Test-Path $script:CurrentLogFile)) {
                Write-Log "Previous admin log file no longer exists, resetting state" -Level "Info"
                $script:CurrentLogFile = $null
                $script:LastLineNumber = 0
            } else {
                Write-Log "Loaded admin log state: File=$($script:CurrentLogFile), Line=$($script:LastLineNumber)" -Level "Info"
            }
        } else {
            Write-Log "No previous admin log state found, starting from current log end" -Level "Info"
            # Initialize to current log file and skip to end to avoid spam
            $latestLogFile = Get-LatestAdminLogFile
            if ($latestLogFile -and (Test-Path $latestLogFile)) {
                $script:CurrentLogFile = $latestLogFile
                # Read current file and set position to end
                try {
                    $allLines = Get-Content $script:CurrentLogFile -Encoding Unicode -ErrorAction SilentlyContinue
                    $script:LastLineNumber = if ($allLines) { $allLines.Count } else { 0 }
                    Write-Log "Initialized admin log state: File=$($script:CurrentLogFile), Starting from line $($script:LastLineNumber)" -Level "Info"
                } catch {
                    $script:LastLineNumber = 0
                }
            } else {
                $script:CurrentLogFile = $null
                $script:LastLineNumber = 0
            }
        }
    } catch {
        Write-Log "Failed to load admin log state, starting fresh: $($_.Exception.Message)" -Level "Info"
        $script:CurrentLogFile = $null
        $script:LastLineNumber = 0
    }
}

# ===============================================================
# ADMIN LOG PARSING
# ===============================================================
function ConvertFrom-AdminLine {
    param([string]$LogLine)
    
    # Admin log patterns:
    # 2025.08.08-15.17.23: '76561198079911047:Spidees(1730)' Command: 'SpawnItem Mine_01'
    # Pattern: timestamp: 'steamid:nickname(id)' Command: 'command'
    
    if ($LogLine -match "^([\d.-]+):\s+'(\d+):([^(]+)\((\d+)\)'\s+Command:\s+'(.+)'$") {
        $date = $matches[1]
        $steamId = $matches[2]
        $adminName = $matches[3].Trim()
        $playerId = $matches[4]
        $command = $matches[5]
        
        try {
            # Parse date: 2025.08.08-15.17.23 -> 2025/08/08 15:17:23
            $datePart = $date -replace '\.', '/' -replace '-', ' '
            $timestamp = [datetime]::ParseExact($datePart, "yyyy/MM/dd HH.mm.ss", $null)
        } catch {
            $timestamp = Get-Date
        }
        
        # Determine action type based on command
        $actionType = "command"
        $action = "used command: $command"
        
        # SPAWN COMMANDS
        if ($command -match "^SpawnItem\s+(.+)") {
            $actionType = "spawn"
            $item = $matches[1]
            $action = "spawned item: $item"
        } elseif ($command -match "^SpawnVehicle\s+(.+)") {
            $actionType = "vehicle"
            $vehicle = $matches[1] -replace "BPC_", "" -replace "BP_", ""
            $action = "spawned vehicle: $vehicle"
        } elseif ($command -match "^RenameVehicle\s+(.+)") {
            $actionType = "vehicle"
            if ($command -match "unreg") {
                $action = "unregistered vehicle"
            } else {
                $action = "registered/renamed vehicle"
            }
        } elseif ($command -match "^spawnzombie\s+(.+)") {
            $actionType = "zombie"
            $action = "spawned zombies"
        } elseif ($command -match "^spawnanimal\s+(.+)") {
            $actionType = "spawn"
            $animal = $matches[1] -replace "BP_", ""
            $action = "spawned animal: $animal"
        } elseif ($command -match "^SpawnRandomZombie\s+(.+)") {
            $actionType = "zombie"
            $action = "spawned random zombies"
        
        # TELEPORT COMMANDS
        } elseif ($command -match "^Teleport|^teleport") {
            $actionType = "teleport"
            if ($command -match "TeleportTo\s+(.+)") {
                $target = $matches[1]
                $action = "teleported to player: $target"
            } elseif ($command -match "TeleportToMe\s+(.+)") {
                $target = $matches[1]
                $action = "teleported player to self: $target"
            } else {
                $action = "teleported"
            }
        
        # PLAYER MANAGEMENT
        } elseif ($command -match "^Kill\s+(.+)") {
            $actionType = "kill"
            $target = $matches[1]
            $action = "killed player: $target"
        } elseif ($command -match "^ban\s+(.+)") {
            $actionType = "ban"
            $target = $matches[1]
            $action = "banned player: $target"
        } elseif ($command -match "^location\s+(.+)") {
            $actionType = "location"
            $action = "checked player location"
        
        # ECONOMY & CURRENCY
        } elseif ($command -match "^ChangeCurrencyBalance\s+(\w+)\s+(\d+)\s+(.+)") {
            $actionType = "currency"
            $currency = $matches[1]
            $amount = $matches[2]
            $action = "gave $amount $currency coins"
        } elseif ($command -match "^ChangeFamePoints\s+(\d+)\s+(.+)") {
            $actionType = "fame"
            $amount = $matches[1]
            $action = "gave $amount fame points"
        
        # SERVER MANAGEMENT
        } elseif ($command -match "^SetTime|^Vote SetTimeOfDay") {
            $actionType = "time"
            $action = "changed server time"
        } elseif ($command -match "^SetWeather|^Vote SetWeather") {
            $actionType = "weather"
            $action = "changed weather"
        } elseif ($command -match "^Announce|^announce") {
            $actionType = "announce"
            $message = $command -replace "^(Announce|announce)\s+", ""
            if ($message.Length -gt 50) {
                $message = $message.Substring(0, 47) + "..."
            }
            $action = "announced: $message"
        
        # CLEANUP COMMANDS
        } elseif ($command -match "^DestroyZombiesWithinRadius") {
            $actionType = "cleanup"
            $action = "cleared zombies from area"
        } elseif ($command -match "^DestroyCorpsesWithinRadius") {
            $actionType = "cleanup"
            $action = "cleared corpses from area"
        } elseif ($command -match "^DestroyVehicle\s+(.+)") {
            $actionType = "cleanup"
            $action = "destroyed vehicle"
        } elseif ($command -match "^DestroyAllItemsWithinRadius\s+(.+)") {
            $actionType = "cleanup"
            $item = ($matches[1] -split "\s+")[0]
            $action = "cleaned up items: $item"
        
        # INFO COMMANDS
        } elseif ($command -match "^ShowVehicleInfo|^ReloadLoot|^Reload|^ListPlayers|^ListSpawnedVehicles") {
            $actionType = "info"
            if ($command -match "^ShowVehicleInfo") {
                $action = "checked vehicle info"
            } elseif ($command -match "^ReloadLoot|^Reload") {
                $action = "reloaded server data"
            } elseif ($command -match "^ListPlayers") {
                $action = "listed all players"
            } elseif ($command -match "^ListSpawnedVehicles") {
                $action = "listed spawned vehicles"
            } else {
                $action = "executed info command: $command"
            }
        } elseif ($command -match "^ClearFakeName") {
            $actionType = "info"
            $action = "cleared fake names"
        
        # TOURNAMENT/EVENTS
        } elseif ($command -match "^StartTournamentMode") {
            $actionType = "event"
            $action = "started tournament mode"
        
        # GIVE/ITEMS
        } elseif ($command -match "^Give") {
            $actionType = "give"
            $action = "gave items to player"
        }
        
        return @{
            Timestamp = $timestamp
            AdminName = $adminName
            SteamId = $steamId
            PlayerId = $playerId
            Command = $command
            Action = $action
            Type = $actionType
            RawLine = $Line
        }
    }
    
    return $null
}

# ===============================================================
# DISCORD INTEGRATION
# ===============================================================
function Send-AdminActionToDiscord {
    param($Action)
    
    try {
        # Validate action data
        if (-not $Action -or -not $Action.Command) {
            Write-Log "Invalid admin action data, skipping Discord notification" -Level "Debug"
            return
        }
        
        # Try to use embed format
        if (Get-Command "Send-AdminEmbed" -ErrorAction SilentlyContinue) {
            try {
                Write-Log "Creating admin embed for $($Action.AdminName)" -Level "Debug"
                $embedData = Send-AdminEmbed -AdminAction $Action
                Write-Log "Admin embed data created successfully" -Level "Debug"
                
                if (Get-Command "Send-DiscordMessage" -ErrorAction SilentlyContinue) {
                    Write-Log "Sending admin embed to Discord..." -Level "Debug"
                    $result = Send-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:Config.Channel -Embed $embedData
                    if ($result -and $result.success) {
                        Write-Log "Admin action embed sent successfully" -Level "Info"
                        return
                    } else {
                        Write-Log "Admin action embed failed to send: $($result | ConvertTo-Json)" -Level "Warning"
                    }
                } else {
                    Write-Log "Send-DiscordMessage command not found" -Level "Warning"
                }
            } catch {
                Write-Log "Error creating admin embed: $($_.Exception.Message)" -Level "Warning"
            }
        } else {
            Write-Log "Send-AdminEmbed function not found" -Level "Warning"
        }
        
    } catch {
        Write-Log "Error in Send-AdminActionToDiscord: $($_.Exception.Message)" -Level "Error"
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
    'Initialize-AdminLogModule',
    'ConvertFrom-AdminLine',
    'Update-AdminLogProcessing',
    'Get-NewAdminActions',
    'Get-LatestAdminLogFile',
    'Send-AdminActionToDiscord',
    'Apply-MessageFilter',
    'Save-AdminState',
    'Load-AdminState'
)


