# ===============================================================
# SCUM Server Automation - Discord Integration
# ===============================================================
# Main Discord system coordinator and orchestrator
# Manages all Discord functionality including bot, commands, and embeds
# ===============================================================

#Requires -Version 5.1

# Standard import of common module
try {
    $helperPath = Join-Path $PSScriptRoot "..\..\core\module-helper.psm1"
    if (Test-Path $helperPath) {
        # MEMORY LEAK FIX: Check if module already loaded before importing
        if (-not (Get-Module "module-helper" -ErrorAction SilentlyContinue)) {
            Import-Module $helperPath -ErrorAction SilentlyContinue
        }
        Import-CommonModule | Out-Null
    }
} catch {
    Write-Host "[WARNING] Common module not available for discord-integration module" -ForegroundColor Yellow
}

# Import required modules
$moduleRoot = $PSScriptRoot

# MEMORY LEAK FIX: Conditional imports instead of -Force
if (-not (Get-Module "notification-manager" -ErrorAction SilentlyContinue)) {
    Import-Module (Join-Path $moduleRoot "notifications\notification-manager.psm1") -Global -ErrorAction Stop
}
if (-not (Get-Module "live-embeds-manager" -ErrorAction SilentlyContinue)) {
    Import-Module (Join-Path $moduleRoot "live-embeds\live-embeds-manager.psm1") -Global -ErrorAction Stop
}
if (-not (Get-Module "discord-api" -ErrorAction SilentlyContinue)) {
    Import-Module (Join-Path $moduleRoot "core\discord-api.psm1") -Global -ErrorAction Stop
}

# Import Discord WebSocket Bot - with detailed error reporting
$botModulePath = Join-Path $moduleRoot "core\discord-websocket-bot-direct.psm1"

# Initialize rate limiting variables
$script:LastActivityUpdate = $null
$script:LastEmbedUpdate = $null

if (Test-Path $botModulePath) {
    try {
        # MEMORY LEAK FIX: Conditional import instead of -Force
        if (-not (Get-Module "discord-websocket-bot-direct" -ErrorAction SilentlyContinue)) {
            Import-Module $botModulePath -Global -WarningAction SilentlyContinue -ErrorAction Stop
        }
        Write-Host "  [OK] discord-websocket-bot" -ForegroundColor Green
    } catch {
        Write-Log "[ERROR] Failed to import Discord bot module: $($_.Exception.Message)" -Level Error
        throw
    }
} else {
    Write-Log "[ERROR] Discord bot module not found at: $botModulePath" -Level Error
    throw "Discord bot module file missing"
}

# Global state
$script:BotStarted = $false

# Initialize Discord integration
function Initialize-DiscordIntegration {
    <#
    .SYNOPSIS
    Initialize complete Discord integration
    #>
    param(
        [Parameter(Mandatory=$true)]
        [hashtable]$Config
    )
    
    try {
        # Store config for later use
        $script:DiscordConfig = $Config.Discord
        
        # Initialize notifications
        $notificationsOk = Initialize-NotificationManager -Config $Config
        
        # Initialize live embeds if configured
        $liveEmbedsOk = $false
        if ($Config.Discord.LiveEmbeds -and $Config.Discord.LiveEmbeds.StatusChannel) {
            $liveEmbedsOk = Initialize-LiveEmbeds -Config $Config
        }
        
        if ($notificationsOk) {
            Write-Log "Discord integration initialized successfully" -Level "Debug"
            
            # Start Discord WebSocket bot (message handled by core module)
            
            # Determine initial activity based on configuration
            $initialActivity = "OFFLINE"  # Default offline activity
            $activityType = "Playing"  # Always use Playing type
            $status = "online"  # Bot is always online when manager is running
            
            if ($Config.Discord.Presence) {
                $presence = $Config.Discord.Presence
                $activityType = "Playing"  # Force Playing type for consistent display
                $status = "online"  # Always online when manager is running
                
                if ($presence.DynamicActivity -eq $true) {
                    $initialActivity = if ($presence.OfflineActivity) { $presence.OfflineActivity } else { "OFFLINE" }
                } else {
                    $initialActivity = if ($presence.Activity) { $presence.Activity } else { "OFFLINE" }
                }
            }
            
            # Check if Discord bot function is available
            if (Get-Command "Start-DiscordWebSocketBot" -ErrorAction SilentlyContinue) {
                Write-Log "Discord bot function available, starting bot..." -Level "Debug"
                # Bot always starts with "online" status when manager is running
                $botStarted = Start-DiscordWebSocketBot -Token $Config.Discord.Token -Status "online" -Activity $initialActivity -ActivityType $activityType
            } else {
                Write-Log "Discord bot function 'Start-DiscordWebSocketBot' not found!" -Level Error
                Write-Log "Available Discord functions:" -Level Warning
                Get-Command "*Discord*" | Select-Object Name | Format-Table -AutoSize
                throw "Discord bot function not available"
            }
            
            if ($botStarted) {
                $script:BotStarted = $true
                
                # Start persistent heartbeat mechanism immediately after authentication
                Write-Log "Starting persistent heartbeat mechanism..." -Level "Debug"
                if (Get-Command "Start-PersistentHeartbeat" -ErrorAction SilentlyContinue) {
                    Start-PersistentHeartbeat
                } else {
                    Write-Log "Persistent heartbeat function not available" -Level Warning
                }
                
                # Set initial bot activity based on current server status if dynamic activity is enabled
                if ($Config.Discord.Presence.DynamicActivity -eq $true) {
                    # Wait for bot to be fully ready after authentication
                    Write-Log "Waiting for bot to be fully ready before setting activity..." -Level "Debug"
                    Start-Sleep -Seconds 5
                    
                    # Get initial server status from monitoring module if available
                    $initialServerStatus = @{
                        IsRunning = $false
                        OnlinePlayers = "0"
                        MaxPlayers = "64"
                    }
                    
                    # Try to get actual server status from monitoring module (preferred)
                    if (Get-Command "Get-ServerStatus" -ErrorAction SilentlyContinue) {
                        try {
                            $monitoringStatus = Get-ServerStatus
                            if ($monitoringStatus) {
                                $initialServerStatus.IsRunning = $monitoringStatus.IsRunning
                                $initialServerStatus.OnlinePlayers = $monitoringStatus.OnlinePlayers
                                $initialServerStatus.MaxPlayers = $monitoringStatus.MaxPlayers
                                Write-Log "Using actual server status from monitoring: IsRunning=$($initialServerStatus.IsRunning)" -Level "Debug"
                            }
                        } catch {
                            Write-Log "Failed to get monitoring status, using fallback" -Level "Debug"
                        }
                    }
                    # Fallback to service check if monitoring not available
                    elseif (Get-Command "Test-ServiceRunning" -ErrorAction SilentlyContinue) {
                        try {
                            $serviceName = if ($Config.serviceName) { $Config.serviceName } else { "SCUMSERVER" }
                            $initialServerStatus.IsRunning = Test-ServiceRunning $serviceName
                        } catch {
                            # Use default offline status
                        }
                    }
                    
                    Write-Log "Setting initial bot activity after authentication..." -Level "Debug"
                    Update-BotActivity -ServerStatus $initialServerStatus
                }
                
                # Initialize Discord text commands
                if (Get-Command "Initialize-DiscordTextCommands" -ErrorAction SilentlyContinue) {
                    try {
                        $textCommandsOk = Initialize-DiscordTextCommands -Config $Config
                        if ($textCommandsOk) {
                            Write-Log "[OK] Discord text commands initialized"
                        } else {
                            Write-Log "[SKIP] Discord text commands not configured" -Level Warning
                        }
                    } catch {
                        Write-Log "Failed to initialize Discord text commands: $($_.Exception.Message)" -Level Error
                    }
                } else {
                    Write-Log "Discord text commands module not available" -Level "Debug"
                }
            } else {
                Write-Log "Failed to start Discord WebSocket bot" -Level Error
                # Still send notification manually
                Send-DiscordNotification -Type "manager.started"
            }
            
            return $true
        } else {
            Write-Log "Discord integration initialization failed" -Level Error
            return $false
        }
        
    } catch {
        Write-Log "Failed to initialize Discord integration: $($_.Exception.Message)" -Level Error
        return $false
    }
}

# Send Discord notification - delegate to notification manager
function Send-NotificationMessage {
    <#
    .SYNOPSIS
    Send a Discord notification with the specified type and data
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$Type,
        
        [Parameter()]
        [hashtable]$Data = @{}
    )
    
    try {
        # Call notification manager directly
        Send-DiscordNotification -Type $Type -Data $Data
        Write-Log "Notification sent: $Type" -Level "Debug"
        return @{ Success = $true }
        
    } catch {
        Write-Log "Failed to send Discord notification: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

# Update Discord leaderboards
function Update-DiscordLeaderboards {
    <#
    .SYNOPSIS
    Update Discord leaderboards with current database data
    #>
    param(
        [Parameter()]
        [string]$Type = "player_stats"
    )
    
    try {
        Write-Log "Updating Discord leaderboards: $Type" -Level "Debug"
        
        # Get leaderboard data from database
        $leaderboardData = @{
            TopPlayers = @()
            TopKillers = @()
            TopSurvivors = @()
            ServerStats = @{
                TotalKills = "N/A"
                TotalDeaths = "N/A"
                TotalPlayTime = "N/A"
                ActiveClans = "N/A"
                TotalEvents = "N/A"
            }
            RecentActivity = @()
            Achievements = @()
        }
        
        # Get real leaderboard data from database
        if (Get-Command "Get-LeaderboardData" -ErrorAction SilentlyContinue) {
            $leaderboardData = Get-LeaderboardData -ErrorAction SilentlyContinue
            if (-not $leaderboardData) {
                Write-Log "Failed to get leaderboard data from database" -Level Warning
                # Use empty structure as fallback
                $leaderboardData = @{
                    TopPlayers = @()
                    TopKillers = @()
                    TopSurvivors = @()
                    ServerStats = @{
                        TotalKills = "N/A"
                        TotalDeaths = "N/A"
                        TotalPlayTime = "N/A"
                        ActiveClans = "N/A"
                        TotalEvents = "N/A"
                    }
                    RecentActivity = @()
                    Achievements = @()
                }
            }
        }
        
        # Update live leaderboards embed
        if (Get-Command "Update-LiveLeaderboards" -ErrorAction SilentlyContinue) {
            Update-LiveLeaderboards -LeaderboardData $leaderboardData | Out-Null
            Write-Log "Leaderboard embed updated successfully" -Level "Debug"
            return @{ Success = $true }
        } else {
            Write-Log "Live leaderboards system not available" -Level Warning
            return @{ Success = $false; Error = "Live embeds not available" }
        }
        
    } catch {
        Write-Log "Failed to update Discord leaderboards: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

# Test Discord connection
function Test-DiscordConnection {
    <#
    .SYNOPSIS
    Test Discord API connectivity
    #>
    
    try {
        if (Get-Command "Test-DiscordAPI" -ErrorAction SilentlyContinue) {
            return Test-DiscordAPI
        } else {
            Write-Log "Discord API test function not available" -Level Warning
            return $false
        }
    } catch {
        Write-Log "Discord connection test failed: $($_.Exception.Message)" -Level Error
        return $false
    }
}

# Start Discord bot connection
function Start-DiscordBotConnection {
    <#
    .SYNOPSIS
    Start Discord bot WebSocket connection
    #>
    param(
        [Parameter()]
        [string]$Token,
        
        [Parameter()]
        [string]$Activity = "OFFLINE",
        
        [Parameter()]
        [string]$ActivityType = "Playing"
    )
    
    try {
        if (Get-Command "Start-DiscordWebSocketBot" -ErrorAction SilentlyContinue) {
            $result = Start-DiscordWebSocketBot -Token $Token -Activity $Activity -ActivityType $ActivityType
            if ($result) {
                $script:BotStarted = $true
                Write-Log "[ONLINE] Discord bot connection started"
            }
            return $result
        } else {
            Write-Log "Discord WebSocket bot not available" -Level Warning
            return $false
        }
    } catch {
        Write-Log "Failed to start Discord bot: $($_.Exception.Message)" -Level Error
        return $false
    }
}

# Stop Discord bot connection
function Stop-DiscordBotConnection {
    <#
    .SYNOPSIS
    Stop Discord bot WebSocket connection
    #>
    
    try {
        if (Get-Command "Stop-DiscordWebSocketBot" -ErrorAction SilentlyContinue) {
            # Before stopping, set bot status to offline (invisible)
            if (Get-Command "Set-BotActivity" -ErrorAction SilentlyContinue) {
                Write-Log "[SETTING] Setting bot status to offline before shutdown..." -Level Warning
                Set-BotActivity -Activity "Manager Offline" -Type "Playing" -Status "invisible"
                Start-Sleep -Seconds 1  # Give time for status to update
            }
            
            $result = Stop-DiscordWebSocketBot
            $script:BotStarted = $false
            Write-Log "[STOPPED] Discord bot connection stopped" -Level Warning
            return $result
        } else {
            Write-Log "Discord WebSocket bot not available" -Level Warning
            return $false
        }
    } catch {
        Write-Log "Failed to stop Discord bot: $($_.Exception.Message)" -Level Error
        return $false
    }
}

# Test Discord bot status
function Test-DiscordBotStatus {
    <#
    .SYNOPSIS
    Test if Discord bot is running
    #>
    
    try {
        if (Get-Command "Test-DiscordBotConnection" -ErrorAction SilentlyContinue) {
            return Test-DiscordBotConnection
        } else {
            return $script:BotStarted
        }
    } catch {
        return $false
    }
}

# Set Discord bot activity
function Set-DiscordBotActivity {
    <#
    .SYNOPSIS
    Set Discord bot activity/status - DEPRECATED! Use Update-BotActivity instead!
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$Activity,
        
        [Parameter()]
        [string]$Type = "Playing",
        
        [Parameter()]
        [string]$Status = "online"
    )
    
    Write-Log "[DEPRECATED] Set-DiscordBotActivity is deprecated! Use Update-BotActivity instead!" -Level Warning
    Write-Log "This function bypasses the centralized activity management." -Level Warning
    
    try {
        if (Get-Command "Set-BotActivity" -ErrorAction SilentlyContinue) {
            return Set-BotActivity -Activity $Activity -Type $Type -Status $Status
        } else {
            Write-Log "Bot activity function not available" -Level Warning
            return $false
        }
    } catch {
        Write-Log "Failed to set bot activity: $($_.Exception.Message)" -Level Error
        return $false
    }
}

# Update bot activity based on server status
function Update-BotActivity {
    <#
    .SYNOPSIS
    Update Discord bot activity based on server status - ONLY FUNCTION THAT CHANGES ACTIVITY!
    #>
    param(
        [Parameter(Mandatory=$false)]
        [hashtable]$ServerStatus = $null
    )
    
    try {
        if (-not $script:BotStarted) {
            Write-Log "Discord bot not started, skipping activity update" -Level "Debug"
            return
        }
        
        # Rate limiting - read ActivityUpdateInterval from config, default to 30 seconds if not configured
        if (-not $script:LastActivityUpdate) {
            $script:LastActivityUpdate = (Get-Date).AddSeconds(-31) # Initialize to force first update
        }
        
        # Get activity update interval from config
        $activityUpdateIntervalSeconds = if ($script:DiscordConfig -and $script:DiscordConfig.Presence -and $script:DiscordConfig.Presence.ActivityUpdateInterval) {
            $script:DiscordConfig.Presence.ActivityUpdateInterval
        } else { 30 }
        
        $timeSinceLastUpdate = (Get-Date) - $script:LastActivityUpdate
        if ($timeSinceLastUpdate.TotalSeconds -lt $activityUpdateIntervalSeconds) {
            Write-Log "[ACTIVITY] Rate limit active - skipping update ($([math]::Round($timeSinceLastUpdate.TotalSeconds))s < $activityUpdateIntervalSeconds s)" -Level "Debug"
            return
        }
        
        $script:LastActivityUpdate = Get-Date
        
        # Get server status only if we passed rate limiting check
        if ($null -eq $ServerStatus -and (Get-Command "Get-ServerStatus" -ErrorAction SilentlyContinue)) {
            $ServerStatus = Get-ServerStatus
        }
        
        # HEARTBEAT MAINTENANCE - Ensure bot stays connected
        if (Get-Command "Maintain-DiscordHeartbeat" -ErrorAction SilentlyContinue) {
            Maintain-DiscordHeartbeat | Out-Null
        }
        
        # Create activity string based on server status
        $activity = if ($ServerStatus.IsRunning) {
            # Use OnlineActivityFormat from config if available
            if ($script:DiscordConfig -and $script:DiscordConfig.Presence -and $script:DiscordConfig.Presence.OnlineActivityFormat) {
                $format = $script:DiscordConfig.Presence.OnlineActivityFormat
                $format -replace '\{players\}', $ServerStatus.OnlinePlayers -replace '\{maxPlayers\}', $ServerStatus.MaxPlayers
            } else {
                # Fallback to default format
                "$($ServerStatus.OnlinePlayers) / $($ServerStatus.MaxPlayers) players"
            }
        } else {
            # Use OfflineActivity from config if available
            if ($script:DiscordConfig -and $script:DiscordConfig.Presence -and $script:DiscordConfig.Presence.OfflineActivity) {
                $script:DiscordConfig.Presence.OfflineActivity
            } else {
                "OFFLINE"
            }
        }
        
        # Bot always has "online" status when manager is running
        # Only the activity changes based on server state
        $status = "online"
        $activityType = "Playing"  # Always Playing
        
        Write-Log "[ACTIVITY] Setting Discord activity: 'Playing $activity'" -Level "Debug"
        
        if (Get-Command "Set-BotActivity" -ErrorAction SilentlyContinue) {
            $result = Set-BotActivity -Activity $activity -Type $activityType -Status $status
            if ($result) {
                Write-Log "[SUCCESS] Discord activity updated -> Playing '$activity'" -Level "Debug"
            } else {
                Write-Log "[FAILED] Discord activity update failed" -Level Error
            }
            return $result
        } else {
            Write-Log "Bot activity function not available" -Level Warning
            return $false
        }
        
    } catch {
        Write-Log "Failed to update bot activity: $($_.Exception.Message)" -Level Error
        return $false
    }
}

function Update-DiscordServerStatus {
    <#
    .SYNOPSIS
    Update Discord server status embeds and bot activity
    #>
    param(
        [Parameter(Mandatory=$false)]
        [hashtable]$ServerStatus = $null
    )
    
    try {
        # Rate limiting for embed updates - only update every 30 seconds to reduce database queries
        if (-not $script:LastEmbedUpdate) {
            $script:LastEmbedUpdate = (Get-Date).AddSeconds(-31) # Initialize to force first update
        }
        
        $timeSinceLastEmbedUpdate = (Get-Date) - $script:LastEmbedUpdate
        # Use StatusUpdateInterval from config, default to 30 seconds if not configured
        $updateIntervalSeconds = if ($script:DiscordConfig -and $script:DiscordConfig.LiveEmbeds -and $script:DiscordConfig.LiveEmbeds.StatusUpdateInterval) {
            $script:DiscordConfig.LiveEmbeds.StatusUpdateInterval
        } else { 30 }
        $embedUpdateNeeded = $timeSinceLastEmbedUpdate.TotalSeconds -ge $updateIntervalSeconds
        
        # Check Discord connection health first and attempt recovery if needed
        if (Get-Command "Test-DiscordConnectionHealth" -ErrorAction SilentlyContinue) {
            $connectionHealthy = Test-DiscordConnectionHealth
            if (-not $connectionHealthy) {
                Write-Log "Discord connection health check failed - some Discord features may not work" -Level Warning
            }
        }
        
        # Update live status embed (with rate limiting)
        if (Get-Command "Update-LiveServerStatus" -ErrorAction SilentlyContinue) {
            if ($embedUpdateNeeded) {
                # Get server status only if we need to update embed
                if ($null -eq $ServerStatus -and (Get-Command "Get-ServerStatus" -ErrorAction SilentlyContinue)) {
                    $ServerStatus = Get-ServerStatus
                }
                # Update server status embed (silently)
                Update-LiveServerStatus -ServerStatus $ServerStatus | Out-Null
                $script:LastEmbedUpdate = Get-Date
            } else {
                Write-Log "[EMBED] Rate limit active - skipping update ($([math]::Round($timeSinceLastEmbedUpdate.TotalSeconds))s < $updateIntervalSeconds s)" -Level "Debug"
            }
        } else {
            Write-Log "Live server status update not available" -Level "Debug"
        }

        # Update bot activity - has its own rate limiting and will get ServerStatus if needed
        Update-BotActivity | Out-Null    } catch {
        Write-Log "Failed to update Discord server status: $($_.Exception.Message)" -Level Error
    }
}

function Maintenance-DiscordConnection {
    <#
    .SYNOPSIS
    Perform Discord connection maintenance
    .DESCRIPTION
    This function should be called periodically to check Discord connection health
    and attempt automatic recovery if the connection is lost
    #>
    try {
        if (Get-Command "Test-DiscordConnectionHealth" -ErrorAction SilentlyContinue) {
            $healthStatus = Test-DiscordConnectionHealth
            
            if ($healthStatus) {
                Write-Log "[MAINTENANCE] Discord connection health check passed" -Level "Debug"
            } else {
                Write-Log "[MAINTENANCE] Discord connection health check failed - recovery attempted" -Level Warning
            }
            
            return $healthStatus
        } else {
            Write-Log "[MAINTENANCE] Discord health check function not available" -Level "Debug"
            return $false
        }
        
    } catch {
        Write-Log "[MAINTENANCE] Error during Discord connection maintenance: $($_.Exception.Message)" -Level Error
        return $false
    }
}

Export-ModuleMember -Function @(
    'Initialize-DiscordIntegration',
    'Send-NotificationMessage',
    'Update-DiscordServerStatus',
    'Update-DiscordLeaderboards',
    'Update-BotActivity',
    'Test-DiscordConnection',
    'Start-DiscordBotConnection',
    'Stop-DiscordBotConnection',
    'Test-DiscordBotStatus',
    'Maintenance-DiscordConnection'
)
