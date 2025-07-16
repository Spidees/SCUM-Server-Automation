# ===============================================================
# SCUM Server Automation - Discord Integration
# ===============================================================
# Main Discord system coordinator and orchestrator
# Manages all Discord functionality including bot, commands, and embeds
# ===============================================================

# Import required modules
$moduleRoot = $PSScriptRoot
Import-Module (Join-Path $moduleRoot "notifications\notification-manager.psm1") -Force -Global -ErrorAction Stop
Import-Module (Join-Path $moduleRoot "live-embeds\live-embeds-manager.psm1") -Force -Global -ErrorAction Stop
Import-Module (Join-Path $moduleRoot "core\discord-api.psm1") -Force -Global -ErrorAction Stop

# Import Discord WebSocket Bot - with detailed error reporting
$botModulePath = Join-Path $moduleRoot "core\discord-websocket-bot-direct.psm1"

if (Test-Path $botModulePath) {
    try {
        Import-Module $botModulePath -Force -Global -WarningAction SilentlyContinue -ErrorAction Stop
        Write-Host "  [OK] discord-websocket-bot" -ForegroundColor Green
    } catch {
        Write-Error "[ERROR] Failed to import Discord bot module: $($_.Exception.Message)"
        throw
    }
} else {
    Write-Error "[ERROR] Discord bot module not found at: $botModulePath"
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
        # Initialize notifications
        $notificationsOk = Initialize-NotificationManager -Config $Config
        
        # Initialize live embeds if configured
        $liveEmbedsOk = $false
        if ($Config.Discord.LiveEmbeds -and $Config.Discord.LiveEmbeds.StatusChannel) {
            $liveEmbedsOk = Initialize-LiveEmbeds -Config $Config
        }
        
        if ($notificationsOk) {
            Write-Verbose "Discord integration initialized successfully"
            
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
                Write-Verbose "Discord bot function available, starting bot..."
                # Bot always starts with "online" status when manager is running
                $botStarted = Start-DiscordWebSocketBot -Token $Config.Discord.Token -Status "online" -Activity $initialActivity -ActivityType $activityType
            } else {
                Write-Error "Discord bot function 'Start-DiscordWebSocketBot' not found!"
                Write-Host "Available Discord functions:" -ForegroundColor Yellow
                Get-Command "*Discord*" | Select-Object Name | Format-Table -AutoSize
                throw "Discord bot function not available"
            }
            
            if ($botStarted) {
                $script:BotStarted = $true
                
                # Start persistent heartbeat mechanism immediately after authentication
                Write-Verbose "Starting persistent heartbeat mechanism..."
                if (Get-Command "Start-PersistentHeartbeat" -ErrorAction SilentlyContinue) {
                    Start-PersistentHeartbeat
                } else {
                    Write-Warning "Persistent heartbeat function not available"
                }
                
                # Set initial bot activity based on current server status if dynamic activity is enabled
                if ($Config.Discord.Presence.DynamicActivity -eq $true) {
                    # Wait for bot to be fully ready after authentication
                    Write-Verbose "Waiting for bot to be fully ready before setting activity..."
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
                                Write-Verbose "Using actual server status from monitoring: IsRunning=$($initialServerStatus.IsRunning)"
                            }
                        } catch {
                            Write-Verbose "Failed to get monitoring status, using fallback"
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
                    
                    Write-Verbose "Setting initial bot activity after authentication..."
                    Update-BotActivity -ServerStatus $initialServerStatus
                }
                
                # Initialize Discord text commands
                if (Get-Command "Initialize-DiscordTextCommands" -ErrorAction SilentlyContinue) {
                    try {
                        $textCommandsOk = Initialize-DiscordTextCommands -Config $Config
                        if ($textCommandsOk) {
                            Write-Host "[OK] Discord text commands initialized" -ForegroundColor Green
                        } else {
                            Write-Host "[SKIP] Discord text commands not configured" -ForegroundColor Yellow
                        }
                    } catch {
                        Write-Warning "Failed to initialize Discord text commands: $($_.Exception.Message)"
                    }
                } else {
                    Write-Verbose "Discord text commands module not available"
                }
            } else {
                Write-Warning "Failed to start Discord WebSocket bot"
                # Still send notification manually
                Send-DiscordNotification -Type "manager.started"
            }
            
            return $true
        } else {
            Write-Warning "Discord integration initialization failed"
            return $false
        }
        
    } catch {
        Write-Error "Failed to initialize Discord integration: $($_.Exception.Message)"
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
        Write-Verbose "Notification sent: $Type"
        return @{ Success = $true }
        
    } catch {
        Write-Warning "Failed to send Discord notification: $($_.Exception.Message)"
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
        Write-Verbose "Updating Discord leaderboards: $Type"
        
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
                Write-Warning "Failed to get leaderboard data from database"
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
            Write-Verbose "Leaderboard embed updated successfully"
            return @{ Success = $true }
        } else {
            Write-Warning "Live leaderboards system not available"
            return @{ Success = $false; Error = "Live embeds not available" }
        }
        
    } catch {
        Write-Warning "Failed to update Discord leaderboards: $($_.Exception.Message)"
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
            Write-Warning "Discord API test function not available"
            return $false
        }
    } catch {
        Write-Warning "Discord connection test failed: $($_.Exception.Message)"
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
                Write-Host "[ONLINE] Discord bot connection started" -ForegroundColor Green
            }
            return $result
        } else {
            Write-Warning "Discord WebSocket bot not available"
            return $false
        }
    } catch {
        Write-Warning "Failed to start Discord bot: $($_.Exception.Message)"
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
                Write-Host "[SETTING] Setting bot status to offline before shutdown..." -ForegroundColor Yellow
                Set-BotActivity -Activity "Manager Offline" -Type "Playing" -Status "invisible"
                Start-Sleep -Seconds 1  # Give time for status to update
            }
            
            $result = Stop-DiscordWebSocketBot
            $script:BotStarted = $false
            Write-Host "[STOPPED] Discord bot connection stopped" -ForegroundColor Yellow
            return $result
        } else {
            Write-Warning "Discord WebSocket bot not available"
            return $false
        }
    } catch {
        Write-Warning "Failed to stop Discord bot: $($_.Exception.Message)"
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
    
    Write-Warning "[DEPRECATED] Set-DiscordBotActivity is deprecated! Use Update-BotActivity instead!"
    Write-Warning "This function bypasses the centralized activity management."
    
    try {
        if (Get-Command "Set-BotActivity" -ErrorAction SilentlyContinue) {
            return Set-BotActivity -Activity $Activity -Type $Type -Status $Status
        } else {
            Write-Warning "Bot activity function not available"
            return $false
        }
    } catch {
        Write-Warning "Failed to set bot activity: $($_.Exception.Message)"
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
        [Parameter(Mandatory=$true)]
        [hashtable]$ServerStatus
    )
    
    try {
        if (-not $script:BotStarted) {
            Write-Verbose "Discord bot not started, skipping activity update"
            return
        }
        
        # HEARTBEAT MAINTENANCE - Ensure bot stays connected
        if (Get-Command "Maintain-DiscordHeartbeat" -ErrorAction SilentlyContinue) {
            Maintain-DiscordHeartbeat | Out-Null
        }
        
        # Create activity string based on server status
        $activity = if ($ServerStatus.IsRunning) {
            "$($ServerStatus.OnlinePlayers)/$($ServerStatus.MaxPlayers) players"
        } else {
            "OFFLINE"
        }
        
        # Bot always has "online" status when manager is running
        # Only the activity changes based on server state
        $status = "online"
        $activityType = "Playing"  # Always Playing
        
        Write-Verbose "[ACTIVITY] Setting Discord activity: 'Playing $activity'"
        
        if (Get-Command "Set-BotActivity" -ErrorAction SilentlyContinue) {
            $result = Set-BotActivity -Activity $activity -Type $activityType -Status $status
            if ($result) {
                Write-Verbose "[SUCCESS] Discord activity updated -> Playing '$activity'"
            } else {
                Write-Warning "[FAILED] Discord activity update failed"
            }
            return $result
        } else {
            Write-Warning "Bot activity function not available"
            return $false
        }
        
    } catch {
        Write-Warning "Failed to update bot activity: $($_.Exception.Message)"
        return $false
    }
}

function Update-DiscordServerStatus {
    <#
    .SYNOPSIS
    Update Discord server status embeds and bot activity
    #>
    param(
        [Parameter(Mandatory=$true)]
        [hashtable]$ServerStatus
    )
    
    try {
        # Check Discord connection health first and attempt recovery if needed
        if (Get-Command "Test-DiscordConnectionHealth" -ErrorAction SilentlyContinue) {
            $connectionHealthy = Test-DiscordConnectionHealth
            if (-not $connectionHealthy) {
                Write-Warning "Discord connection health check failed - some Discord features may not work"
            }
        }
        
        # Update live status embed (without EmbedId parameter - handled internally)
        if (Get-Command "Update-LiveServerStatus" -ErrorAction SilentlyContinue) {
            # Update server status embed (silently)
            Update-LiveServerStatus -ServerStatus $ServerStatus | Out-Null
        } else {
            Write-Verbose "Live server status update not available"
        }
        
        # Update bot activity
        Update-BotActivity -ServerStatus $ServerStatus | Out-Null
        
    } catch {
        Write-Warning "Failed to update Discord server status: $($_.Exception.Message)"
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
                Write-Verbose "[MAINTENANCE] Discord connection health check passed"
            } else {
                Write-Warning "[MAINTENANCE] Discord connection health check failed - recovery attempted"
            }
            
            return $healthStatus
        } else {
            Write-Verbose "[MAINTENANCE] Discord health check function not available"
            return $false
        }
        
    } catch {
        Write-Warning "[MAINTENANCE] Error during Discord connection maintenance: $($_.Exception.Message)"
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
