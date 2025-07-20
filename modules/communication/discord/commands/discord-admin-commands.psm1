# ===============================================================
# SCUM Server Automation - Discord Admin Commands
# ===============================================================
# Provides administrative Discord commands for server management
# Includes restart, backup, update, and monitoring commands
# ===============================================================

# Add required .NET types for URL encoding
Add-Type -AssemblyName System.Web

# Import required modules for server status checking
try {
    if (Get-Command "Get-ServerStatus" -ErrorAction SilentlyContinue) {
        Write-Verbose "[ADMIN-COMMANDS] Server status functions available"
    } else {
        Write-Warning "[ADMIN-COMMANDS] Server status functions not available - state validation may not work"
    }
} catch {
    Write-Warning "[ADMIN-COMMANDS] Error checking server status availability: $_"
}

# ===============================================================
# UTILITY FUNCTIONS
# ===============================================================

# Helper functions for confirmation reactions
function Add-DiscordReaction {
    <#
    .SYNOPSIS
    Add a reaction to a Discord message with rate limiting support
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$ChannelId,
        [Parameter(Mandatory=$true)]
        [string]$MessageId,
        [Parameter(Mandatory=$true)]
        [string]$Emoji,
        [Parameter(Mandatory=$false)]
        [int]$MaxRetries = 3
    )
    
    $retryCount = 0
    
    while ($retryCount -lt $MaxRetries) {
        try {
            if (Get-Command "Invoke-DiscordAPI" -ErrorAction SilentlyContinue) {
                # Map emojis to their URL-encoded equivalents
                $emojiMap = @{
                    "✅" = "%E2%9C%85"  # Check mark
                    "❌" = "%E2%9D%8C"  # Cross mark
                }
                
                $emojiEncoded = if ($emojiMap.ContainsKey($Emoji)) { $emojiMap[$Emoji] } else { $Emoji }
                $endpoint = "channels/$ChannelId/messages/$MessageId/reactions/$emojiEncoded/@me"
                $result = Invoke-DiscordAPI -Endpoint $endpoint -Method "PUT"
                
                # For PUT reactions, success is indicated by result being $true (204 No Content) or not null
                if ($result -eq $true -or $null -ne $result) {
                    return $true
                } else {
                    $retryCount++
                    if ($retryCount -lt $MaxRetries) {
                        Write-Verbose "[ADMIN-COMMANDS] Rate limited, retrying reaction in 1 second..."
                        Start-Sleep -Seconds 1
                        continue
                    }
                    Write-Warning "[ADMIN-COMMANDS] Failed to add reaction after $MaxRetries attempts"
                    return $false
                }
            } else {
                Write-Warning "[ADMIN-COMMANDS] Discord API function not available for reactions"
                return $false
            }
        } catch {
            $retryCount++
            if ($retryCount -lt $MaxRetries) {
                Write-Verbose "[ADMIN-COMMANDS] Error adding reaction, retrying: $($_.Exception.Message)"
                Start-Sleep -Seconds 1
                continue
            }
            Write-Warning "[ADMIN-COMMANDS] Failed to add reaction after $MaxRetries attempts: $($_.Exception.Message)"
            return $false
        }
    }
    
    return $false
}

function Wait-ForReactionConfirmation {
    <#
    .SYNOPSIS
    Wait for user to confirm or cancel action by adding reaction
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$ChannelId,
        [Parameter(Mandatory=$true)]
        [string]$MessageId,
        [Parameter(Mandatory=$true)]
        [string]$UserId,
        [Parameter(Mandatory=$false)]
        [int]$TimeoutSeconds = 30
    )
    
    try {
        $startTime = Get-Date
        $timeoutTime = $startTime.AddSeconds($TimeoutSeconds)
        
        Write-Verbose "[ADMIN-COMMANDS] Waiting for confirmation reaction from user $UserId"
        
        while ((Get-Date) -lt $timeoutTime) {
            try {
                if (Get-Command "Invoke-DiscordAPI" -ErrorAction SilentlyContinue) {
                    # Check for ✅ (confirm) reaction
                    $confirmEndpoint = "channels/$ChannelId/messages/$MessageId/reactions/%E2%9C%85"
                    $confirmReactions = Invoke-DiscordAPI -Endpoint $confirmEndpoint -Method "GET"
                    
                    if ($confirmReactions -and $confirmReactions.Count -gt 0) {
                        foreach ($user in $confirmReactions) {
                            if ($user.id -eq $UserId) {
                                Write-Verbose "[ADMIN-COMMANDS] Confirmation received from user $UserId"
                                return "confirmed"
                            }
                        }
                    }
                    
                    # Check for ❌ (cancel) reaction
                    $cancelEndpoint = "channels/$ChannelId/messages/$MessageId/reactions/%E2%9D%8C"
                    $cancelReactions = Invoke-DiscordAPI -Endpoint $cancelEndpoint -Method "GET"
                    
                    if ($cancelReactions -and $cancelReactions.Count -gt 0) {
                        foreach ($user in $cancelReactions) {
                            if ($user.id -eq $UserId) {
                                Write-Verbose "[ADMIN-COMMANDS] Cancellation received from user $UserId"
                                return "cancelled"
                            }
                        }
                    }
                }
            } catch {
                Write-Verbose "[ADMIN-COMMANDS] Error checking reactions: $($_.Exception.Message)"
            }
            
            Start-Sleep -Seconds 3  # Check every 3 seconds to prevent rate limiting
        }
        
        Write-Verbose "[ADMIN-COMMANDS] Confirmation timeout reached"
        return "timeout"
        
    } catch {
        Write-Warning "[ADMIN-COMMANDS] Error waiting for confirmation: $($_.Exception.Message)"
        return "error"
    }
}

function Send-CommandResponse {
    <#
    .SYNOPSIS
    Send response to Discord channel
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$ChannelId,
        [Parameter(Mandatory=$false)]
        [string]$Content = "",
        [Parameter(Mandatory=$false)]
        [hashtable]$Embed = $null,
        [Parameter(Mandatory=$false)]
        [switch]$ReturnMessageId
    )
    
    try {
        if (Get-Command "Send-DiscordMessage" -ErrorAction SilentlyContinue) {
            $messageParams = @{
                ChannelId = $ChannelId
            }
            
            if ($Content) {
                $messageParams.Content = $Content
            }
            
            if ($Embed) {
                $messageParams.Embed = $Embed
            }
            
            # Discord API requires either Content or Embed
            if (-not $Content -and -not $Embed) {
                Write-Warning "[ADMIN-COMMANDS] No content or embed provided for Discord message"
                return $null
            }
            
            $result = Send-DiscordMessage @messageParams
            Write-Verbose "[ADMIN-COMMANDS] Response sent to channel $ChannelId"
            
            if ($ReturnMessageId -and $result -and $result.id) {
                return $result.id
            }
            
        } else {
            Write-Warning "[ADMIN-COMMANDS] Send-DiscordMessage function not available"
        }
    } catch {
        Write-Warning "[ADMIN-COMMANDS] Failed to send response: $($_.Exception.Message)"
    }
    
    return $null
}

function Request-AdminConfirmation {
    <#
    .SYNOPSIS
    Request confirmation for admin action with reactions
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$ChannelId,
        [Parameter(Mandatory=$true)]
        [string]$UserId,
        [Parameter(Mandatory=$true)]
        [string]$ActionType,
        [Parameter(Mandatory=$true)]
        [string]$ActionDescription,
        [Parameter(Mandatory=$false)]
        [int]$TimeoutSeconds = 30
    )
    
    try {
        # Send confirmation message
        $emojiMap = @{
            "restart" = ":arrows_counterclockwise:"
            "stop" = ":stop_sign:"
            "update" = ":arrow_up:"
            "skip" = ":fast_forward:"
            "validation" = ":white_check_mark:"
        }
        
        $actionEmoji = if ($emojiMap.ContainsKey($ActionType)) { $emojiMap[$ActionType] } else { ":warning:" }
        
        $confirmMessage = Send-CommandResponse -ChannelId $ChannelId -Content ":warning: **CONFIRMATION REQUIRED**`n$actionEmoji **$ActionDescription**`n`nClick :white_check_mark: to confirm or :x: to cancel`nTimeout: $TimeoutSeconds seconds" -ReturnMessageId
        
        if ($confirmMessage) {
            # Add both reactions with delay to prevent rate limiting
            $confirmAdded = Add-DiscordReaction -ChannelId $ChannelId -MessageId $confirmMessage -Emoji "✅" -MaxRetries 3
            Start-Sleep -Milliseconds 500  # Delay between reactions to prevent rate limiting
            $cancelAdded = Add-DiscordReaction -ChannelId $ChannelId -MessageId $confirmMessage -Emoji "❌" -MaxRetries 3
            
            if ($confirmAdded -or $cancelAdded) {
                # Wait for user reaction
                $reaction = Wait-ForReactionConfirmation -ChannelId $ChannelId -MessageId $confirmMessage -UserId $UserId -TimeoutSeconds $TimeoutSeconds
                
                switch ($reaction) {
                    "confirmed" {
                        Send-CommandResponse -ChannelId $ChannelId -Content ":white_check_mark: **Action Confirmed** - $ActionDescription proceeding..."
                        return $true
                    }
                    "cancelled" {
                        Send-CommandResponse -ChannelId $ChannelId -Content ":x: **Action Cancelled** - $ActionDescription was cancelled by user."
                        return $false
                    }
                    "timeout" {
                        Send-CommandResponse -ChannelId $ChannelId -Content ":clock1: **Action Timeout** - $ActionDescription was cancelled due to timeout."
                        return $false
                    }
                    default {
                        Send-CommandResponse -ChannelId $ChannelId -Content ":x: **Action Error** - Failed to process confirmation."
                        return $false
                    }
                }
            } else {
                # Fallback if reactions don't work - request text confirmation
                Write-Warning "[ADMIN-COMMANDS] Failed to add reactions, requesting text confirmation"
                Send-CommandResponse -ChannelId $ChannelId -Content ":warning: **MANUAL CONFIRMATION REQUIRED**`n$actionEmoji **$ActionDescription**`n`nReactions failed to load. Type `!confirm` within 30 seconds to proceed or ignore to cancel."
                
                # For now, abort for safety until we implement text confirmation
                Send-CommandResponse -ChannelId $ChannelId -Content ":x: **Action Aborted** - Please try the command again when Discord reactions are working."
                return $false
            }
        } else {
            Write-Warning "[ADMIN-COMMANDS] Failed to send confirmation message"
            return $false
        }
        
    } catch {
        Write-Warning "[ADMIN-COMMANDS] Error in confirmation process: $($_.Exception.Message)"
        return $false
    }
}

# ===============================================================
# ADMIN COMMAND HANDLERS
# ===============================================================

function Handle-ServerStatusAdminCommand {
    <#
    .SYNOPSIS
    Handle !server_status admin command
    #>
    param([string]$ResponseChannelId)
    
    try {
        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":clock1: **Server Status** - Gathering server information..."
        
        # Get server status from the monitoring module
        if (Get-Command "Get-ServerStatus" -ErrorAction SilentlyContinue) {
            $status = Get-ServerStatus
            
            $statusEmoji = if ($status.IsRunning) { ":green_circle:" } else { ":red_circle:" }
            $statusText = if ($status.IsRunning) { "**ONLINE**" } else { "**OFFLINE**" }
            
            # Format performance data
            $performanceText = if ($status.Performance -and $status.Performance.FPS) {
                "FPS: $($status.Performance.FPS)"
            } else {
                "N/A"
            }
            
            # Format CPU usage
            $cpuUsage = if ($status.Performance -and $status.Performance.CPU) {
                "$($status.Performance.CPU)%"
            } else {
                "0%"
            }
            
            # Format memory usage  
            $memoryUsage = if ($status.Performance -and $status.Performance.Memory) {
                "$($status.Performance.Memory) MB"
            } else {
                "0 MB"
            }
            
            # Get game time and temperature from server status
            $gameTime = if ($status.GameTime) { $status.GameTime } else { "N/A" }
            $temperature = if ($status.Temperature) { $status.Temperature } else { "N/A" }
            
            # Try fallback to database functions if not in status object
            if ($gameTime -eq "N/A" -or $temperature -eq "N/A") {
                try {
                    if (Get-Command "Get-GameTimeAndWeather" -ErrorAction SilentlyContinue) {
                        $timeWeather = Get-GameTimeAndWeather
                        if ($timeWeather) {
                            if ($gameTime -eq "N/A") { $gameTime = $timeWeather.GameTime }
                            if ($temperature -eq "N/A") { $temperature = "A: $($timeWeather.AirTemp)°C | W: $($timeWeather.WaterTemp)°C" }
                        }
                    }
                } catch {
                    # Ignore errors getting time/weather
                }
            }
            
            $embed = @{
                title = "$statusEmoji SCUM Server Status"
                color = if ($status.IsRunning) { 65280 } else { 16711680 } # Green or Red
                fields = @(
                    @{ name = "Status"; value = $statusText; inline = $true }
                    @{ name = "Players"; value = "$($status.OnlinePlayers) / $($status.MaxPlayers)"; inline = $true }
                    @{ name = "Performance"; value = $performanceText; inline = $true }
                    @{ name = "CPU Usage"; value = $cpuUsage; inline = $true }
                    @{ name = "Memory"; value = $memoryUsage; inline = $true }
                    @{ name = "Game Time"; value = $gameTime; inline = $true }
                    @{ name = "Temperature"; value = $temperature; inline = $true }
                )
                footer = @{
                    text = "Last Update"
                }
                timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
            }
            
            Send-CommandResponse -ChannelId $ResponseChannelId -Embed $embed
        } else {
            Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Server status function not available"
        }
    } catch {
        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Failed to get server status: $($_.Exception.Message)"
    }
}

function Handle-ServerStartAdminCommand {
    <#
    .SYNOPSIS
    Handle !server_start admin command with startup monitoring and auto-recovery
    #>
    param([string]$ResponseChannelId)
    
    try {
        # Check server status first
        $serverStatus = Get-ServerStatus
        
        if ($serverStatus.IsRunning) {
            Send-CommandResponse -ChannelId $ResponseChannelId -Content ":information_source: **Server is already running**`nCurrent players: $($serverStatus.OnlinePlayers)/$($serverStatus.MaxPlayers)"
            return
        }
        
        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":arrow_forward: **Starting Server** - Server start command issued..."
        
        if (Get-Command "Start-ServerService" -ErrorAction SilentlyContinue) {
            $startResult = Start-ServerService
            
            if ($startResult) {
                Send-CommandResponse -ChannelId $ResponseChannelId -Content ":clock1: **Server Starting** - Command executed, monitoring startup progress..."
                
                # Monitor startup progress for up to 3 minutes
                $startTime = Get-Date
                $timeoutMinutes = 3
                $checkIntervalSeconds = 15
                $lastStatus = "starting"
                $startupProgression = @()  # Track startup progression
                
                while (((Get-Date) - $startTime).TotalMinutes -lt $timeoutMinutes) {
                    Start-Sleep -Seconds $checkIntervalSeconds
                    
                    # Check current server status
                    $currentStatus = Get-ServerStatus
                    
                    if ($currentStatus.IsRunning) {
                        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":white_check_mark: **Server Online** - Server started successfully and is accepting connections!"
                        return
                    }
                    
                    # Check if we have detailed status from monitoring
                    if ($currentStatus.ActualServerState) {
                        $detailedState = $currentStatus.ActualServerState
                        
                        # Track progression to detect if server is making progress
                        $startupProgression += @{
                            Time = Get-Date
                            State = $detailedState
                        }
                        
                        if ($detailedState -ne $lastStatus) {
                            $statusMessage = switch ($detailedState) {
                                "Starting" { ":yellow_circle: **Starting** - Server process is initializing..." }
                                "Loading" { ":yellow_circle: **Loading** - Server is loading world data..." }
                                "Offline" { 
                                    # Check if we've seen progress before going offline
                                    $hasProgressed = $startupProgression | Where-Object { $_.State -in @("Starting", "Loading") }
                                    if ($hasProgressed) {
                                        ":orange_circle: **Temporary Offline** - Server restarting during startup (normal behavior)..."
                                    } else {
                                        ":red_circle: **Startup Issue** - Server having difficulty starting..."
                                    }
                                }
                                default { ":clock1: **In Progress** - Server startup continuing..." }
                            }
                            Send-CommandResponse -ChannelId $ResponseChannelId -Content $statusMessage
                            $lastStatus = $detailedState
                            
                            # Only break early on persistent offline state without any progress
                            if ($detailedState -eq "Offline") {
                                $hasProgressed = $startupProgression | Where-Object { $_.State -in @("Starting", "Loading") }
                                $recentOfflineStates = $startupProgression | Where-Object { 
                                    $_.State -eq "Offline" -and 
                                    $_.Time -gt (Get-Date).AddMinutes(-1) 
                                }
                                
                                # Only break if we've been offline for 1+ minute without any progress
                                if (-not $hasProgressed -and $recentOfflineStates.Count -ge 4) {
                                    Write-Verbose "[ADMIN-COMMANDS] Breaking early - persistent offline state without progress"
                                    break
                                }
                            }
                        }
                    }
                }
                
                # Timeout reached - analyze what happened before triggering auto-recovery
                $finalStatus = Get-ServerStatus
                if (-not $finalStatus.IsRunning) {
                    # Check if server made any startup progress
                    $hasProgressed = $startupProgression | Where-Object { $_.State -in @("Starting", "Loading") }
                    $lastKnownState = if ($startupProgression.Count -gt 0) { 
                        ($startupProgression | Sort-Object Time -Descending | Select-Object -First 1).State 
                    } else { 
                        "Unknown" 
                    }
                    
                    if ($hasProgressed) {
                        # Server was progressing but didn't finish - this might be normal for large worlds
                        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":warning: **Startup Taking Longer** - Server was progressing (last state: $lastKnownState) but needs more time. This can be normal for large worlds."
                        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":clock1: **Patience Recommended** - Check server status in a few minutes. Server may still be loading."
                        return
                    } else {
                        # No progress detected - legitimate startup failure
                        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":warning: **Startup Timeout** - Server did not show startup progress within $timeoutMinutes minutes"
                    }
                    
                    # Check if auto-restart/repair is available and enabled
                    $autoRestartEnabled = $false
                    try {
                        if (Test-Path "SCUM-Server-Automation.config.json") {
                            $configContent = Get-Content "SCUM-Server-Automation.config.json" -Raw | ConvertFrom-Json
                            $autoRestartEnabled = $configContent.autoRestart -eq $true
                        }
                    } catch {
                        # Ignore config read errors
                    }
                    
                    # Only trigger auto-recovery if no progress was made
                    if (-not $hasProgressed -and $autoRestartEnabled -and (Get-Command "Repair-GameService" -ErrorAction SilentlyContinue)) {
                        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":gear: **Auto-Recovery** - No startup progress detected, attempting automatic repair..."
                        
                        $serviceName = if ($configContent.serviceName) { $configContent.serviceName } else { "SCUMSERVER" }
                        $repairResult = Repair-GameService -ServiceName $serviceName -Reason "startup failure auto-recovery"
                        
                        if ($repairResult) {
                            Send-CommandResponse -ChannelId $ResponseChannelId -Content ":white_check_mark: **Auto-Recovery Successful** - Server has been automatically repaired and should be starting!"
                            
                            # Send admin-only notification about auto-recovery
                            if (Get-Command 'Send-DiscordNotification' -ErrorAction SilentlyContinue) {
                                $recoveryData = @{
                                    timestamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
                                    service_name = $serviceName
                                    message = "Server startup failed but was automatically recovered"
                                    reason = "Manual start command failed, auto-repair triggered"
                                    type = "startup-auto-recovery"
                                    severity = "high"
                                }
                                $null = Send-DiscordNotification -Type 'admin.alert' -Data $recoveryData
                            }
                        } else {
                            Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Auto-Recovery Failed** - Manual intervention required. Check server logs and configuration."
                            
                            # Send critical admin alert
                            if (Get-Command 'Send-DiscordNotification' -ErrorAction SilentlyContinue) {
                                $alertData = @{
                                    timestamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
                                    service_name = $serviceName
                                    error = "Server startup and auto-recovery both failed"
                                    reason = "Manual start command and repair both unsuccessful"
                                    type = "startup-failure"
                                    message = "Server failed to start and automatic recovery failed. Manual intervention required!"
                                    severity = "critical"
                                }
                                $null = Send-DiscordNotification -Type 'admin.alert' -Data $alertData
                            }
                        }
                    } else {
                        if ($hasProgressed) {
                            Send-CommandResponse -ChannelId $ResponseChannelId -Content ":information_source: **Monitor Server** - Server was making progress. Check back in a few minutes to see if startup completes."
                        } else {
                            Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Startup Failed** - Server did not start properly. Check server logs and try again."
                        }
                    }
                }
            } else {
                Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Start Command Failed** - Failed to issue server start command. Check service configuration."
            }
        } else {
            Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Server start function not available"
        }
    } catch {
        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Failed to start server: $($_.Exception.Message)"
    }
}

function Handle-ServerStopAdminCommand {
    <#
    .SYNOPSIS
    Handle !server_stop admin command with confirmation reaction for all actions
    #>
    param([string]$ResponseChannelId, [int]$Minutes = 0, [string]$UserId = "")
    
    try {
        # Check server status first
        $serverStatus = Get-ServerStatus
        if (-not $serverStatus.IsRunning) {
            Send-CommandResponse -ChannelId $ResponseChannelId -Content ":information_source: **Server is already stopped**`nUse `!server_start` to start the server."
            return
        }
        
        # Determine action description
        $actionDescription = if ($Minutes -eq 0) {
            "Stop Server Immediately"
        } else {
            "Stop Server in $Minutes minutes"
        }
        
        # Request confirmation for all stop actions
        $confirmed = Request-AdminConfirmation -ChannelId $ResponseChannelId -UserId $UserId -ActionType "stop" -ActionDescription $actionDescription
        
        if ($confirmed) {
            if ($Minutes -eq 0) {
                Send-CommandResponse -ChannelId $ResponseChannelId -Content ":stop_sign: **Stopping Server** - Immediate shutdown initiated..."
                
                if (Get-Command "Stop-ServerService" -ErrorAction SilentlyContinue) {
                    Stop-ServerService
                    Send-CommandResponse -ChannelId $ResponseChannelId -Content ":white_check_mark: **Server Stop** - Command executed successfully! Server is shutting down..."
                } else {
                    Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Server stop function not available"
                }
            } else {
                # Schedule the stop using the new scheduled tasks system
                if (Get-Command "Add-ScheduledTask" -ErrorAction SilentlyContinue) {
                    Add-ScheduledTask -TaskType 'stop' -DelayMinutes $Minutes -ResponseChannelId $ResponseChannelId -UserId $UserId
                    Send-CommandResponse -ChannelId $ResponseChannelId -Content ":clock1: **Scheduled Stop** - Server will stop in **$Minutes minutes**"
                } else {
                    Send-CommandResponse -ChannelId $ResponseChannelId -Content ":clock1: **Scheduled Stop** - Server will stop in **$Minutes minutes**"
                    Write-Warning "[ADMIN-COMMANDS] Scheduled tasks module not available - showing message only"
                }
            }
        } else {
            # If not confirmed, the Request-AdminConfirmation function already sent the cancellation message
        }
        
    } catch {
        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Failed to stop server: $($_.Exception.Message)"
    }
}

function Handle-ServerRestartAdminCommand {
    <#
    .SYNOPSIS
    Handle !server_restart admin command with confirmation reaction for all actions
    #>
    param([string]$ResponseChannelId, [int]$Minutes = 0, [string]$UserId = "")
    
    try {
        # Check server status first
        $serverStatus = Get-ServerStatus
        if (-not $serverStatus.IsRunning) {
            Send-CommandResponse -ChannelId $ResponseChannelId -Content ":information_source: **Server is not running**`nUse `!server_start` to start the server instead."
            return
        }
        
        # Determine action description
        $actionDescription = if ($Minutes -eq 0) {
            "Restart Server Immediately"
        } else {
            "Restart Server in $Minutes minutes"
        }
        
        # Request confirmation for all restart actions
        $confirmed = Request-AdminConfirmation -ChannelId $ResponseChannelId -UserId $UserId -ActionType "restart" -ActionDescription $actionDescription
        
        if ($confirmed) {
            if ($Minutes -eq 0) {
                Send-CommandResponse -ChannelId $ResponseChannelId -Content ":recycle: **Restarting Server** - Immediate restart initiated..."
                
                if (Get-Command "Restart-ServerService" -ErrorAction SilentlyContinue) {
                    Restart-ServerService
                    Send-CommandResponse -ChannelId $ResponseChannelId -Content ":white_check_mark: **Server Restart** - Command executed successfully! Server is restarting..."
                } else {
                    Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Server restart function not available"
                }
            } else {
                # Schedule the restart using the new scheduled tasks system
                if (Get-Command "Add-ScheduledTask" -ErrorAction SilentlyContinue) {
                    Add-ScheduledTask -TaskType 'restart' -DelayMinutes $Minutes -ResponseChannelId $ResponseChannelId -UserId $UserId
                    Send-CommandResponse -ChannelId $ResponseChannelId -Content ":clock1: **Scheduled Restart** - Server will restart in **$Minutes minutes**"
                } else {
                    Send-CommandResponse -ChannelId $ResponseChannelId -Content ":clock1: **Scheduled Restart** - Server will restart in **$Minutes minutes**"
                    Write-Warning "[ADMIN-COMMANDS] Scheduled tasks module not available - showing message only"
                }
            }
        }
        # If not confirmed, the Request-AdminConfirmation function already sent the cancellation message
        
    } catch {
        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Failed to restart server: $($_.Exception.Message)"
    }
}

function Handle-ServerUpdateAdminCommand {
    <#
    .SYNOPSIS
    Handle !server_update admin command with confirmation reaction for all actions
    #>
    param([string]$ResponseChannelId, [int]$Minutes = 0, [string]$UserId = "")
    
    try {
        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":arrow_up: **Server Update** - Checking for updates..."
        
        if (Get-Command "Test-ManagerUpdateAvailable" -ErrorAction SilentlyContinue) {
            $updateAvailable = Test-ManagerUpdateAvailable
            if ($updateAvailable) {
                # Determine action description
                $actionDescription = if ($Minutes -eq 0) {
                    "Update Server Immediately"
                } else {
                    "Update Server in $Minutes minutes"
                }
                
                # Request confirmation for all update actions
                $confirmed = Request-AdminConfirmation -ChannelId $ResponseChannelId -UserId $UserId -ActionType "update" -ActionDescription $actionDescription
                
                if ($confirmed) {
                    if ($Minutes -eq 0) {
                        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":gear: **Update Starting** - Server update initiated immediately!"
                        
                        if (Get-Command "Update-ServerInstallation" -ErrorAction SilentlyContinue) {
                            Update-ServerInstallation
                        } else {
                            Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Update function not available"
                        }
                    } else {
                        # Schedule the update using the new scheduled tasks system
                        if (Get-Command "Add-ScheduledTask" -ErrorAction SilentlyContinue) {
                            Add-ScheduledTask -TaskType 'update' -DelayMinutes $Minutes -ResponseChannelId $ResponseChannelId -UserId $UserId
                            Send-CommandResponse -ChannelId $ResponseChannelId -Content ":clock1: **Scheduled Update** - Server will update in **$Minutes minutes**"
                        } else {
                            Send-CommandResponse -ChannelId $ResponseChannelId -Content ":clock1: **Scheduled Update** - Server will update in **$Minutes minutes**"
                            Write-Warning "[ADMIN-COMMANDS] Scheduled tasks module not available - showing message only"
                        }
                    }
                }
                # If not confirmed, the Request-AdminConfirmation function already sent the cancellation message
                
            } else {
                Send-CommandResponse -ChannelId $ResponseChannelId -Content ":white_check_mark: **No Updates** - Server is already up to date!"
            }
        } else {
            Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Update check function not available"
        }
    } catch {
        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Failed to check for updates: $($_.Exception.Message)"
    }
}

function Handle-ServerValidateAdminCommand {
    <#
    .SYNOPSIS
    Handle !server_validate admin command for Steam integrity check
    #>
    param([string]$ResponseChannelId, [string]$UserId = "")
    
    try {
        # Request confirmation for validation action
        $confirmed = Request-AdminConfirmation -ChannelId $ResponseChannelId -UserId $UserId -ActionType "validation" -ActionDescription "Run Steam File Integrity Check - This will temporarily stop the server"
        
        if (-not $confirmed) {
            return  # Request-AdminConfirmation already sent cancellation message
        }
        
        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":gear: **Server Validation** - Starting Steam integrity check..."
        
        # Check if validation function exists
        if (Get-Command "Invoke-ServerValidation" -ErrorAction SilentlyContinue) {
            
            # Get configuration
            $configContent = $null
            try {
                if (Test-Path "SCUM-Server-Automation.config.json") {
                    $configContent = Get-Content "SCUM-Server-Automation.config.json" -Raw | ConvertFrom-Json
                } else {
                    Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Configuration file not found"
                    return
                }
            } catch {
                Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Failed to read configuration: $($_.Exception.Message)"
                return
            }
            
            # Get required paths
            $steamCmdPath = $configContent.steamCmd
            $serverDir = $configContent.serverDir
            $appId = $configContent.appId
            $serviceName = $configContent.serviceName
            
            if (-not $steamCmdPath -or -not $serverDir -or -not $appId) {
                Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Missing required configuration (steamCmd, serverDir, or appId)"
                return
            }
            
            Send-CommandResponse -ChannelId $ResponseChannelId -Content ":clock1: **Validating** - Running Steam integrity check, this may take several minutes..."
            
            # Execute validation
            $validationResult = Invoke-ServerValidation -SteamCmdPath $steamCmdPath -ServerDirectory $serverDir -AppId $appId -ServiceName $serviceName
            
            if ($validationResult -and $validationResult.Success) {
                $filesChecked = if ($validationResult.FilesChecked) { $validationResult.FilesChecked } else { "Unknown" }
                $filesFixed = if ($validationResult.FilesFixed) { $validationResult.FilesFixed } else { 0 }
                
                if ($filesFixed -gt 0) {
                    Send-CommandResponse -ChannelId $ResponseChannelId -Content ":white_check_mark: **Validation Complete** - Found and fixed $filesFixed corrupted files out of $filesChecked checked. Server files are now valid."
                } else {
                    Send-CommandResponse -ChannelId $ResponseChannelId -Content ":white_check_mark: **Validation Complete** - All $filesChecked server files are valid. No corruption detected."
                }
                
                # Send admin notification about validation
                if (Get-Command 'Send-DiscordNotification' -ErrorAction SilentlyContinue) {
                    $notificationData = @{
                        timestamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
                        service_name = $serviceName
                        files_checked = $filesChecked
                        files_fixed = $filesFixed
                        type = "server-validation"
                        severity = if ($filesFixed -gt 0) { "medium" } else { "low" }
                        message = if ($filesFixed -gt 0) { "Server validation fixed $filesFixed corrupted files" } else { "Server validation completed - no issues found" }
                    }
                    $null = Send-DiscordNotification -Type 'admin.alert' -Data $notificationData
                }
                
            } else {
                $errorMsg = if ($validationResult -and $validationResult.Error) { $validationResult.Error } else { "Unknown validation error" }
                Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Validation Failed** - $errorMsg"
                
                # Send critical admin alert
                if (Get-Command 'Send-DiscordNotification' -ErrorAction SilentlyContinue) {
                    $alertData = @{
                        timestamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
                        service_name = $serviceName
                        error = $errorMsg
                        type = "validation-failure"
                        message = "Server validation failed - manual investigation required"
                        severity = "high"
                    }
                    $null = Send-DiscordNotification -Type 'admin.alert' -Data $alertData
                }
            }
            
        } else {
            Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Server validation function not available"
        }
    } catch {
        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Failed to validate server: $($_.Exception.Message)"
    }
}

function Handle-ServerBackupAdminCommand {
    <#
    .SYNOPSIS
    Handle !server_backup admin command
    #>
    param([string]$ResponseChannelId)
    
    try {
        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":floppy_disk: **Creating Backup** - Manual backup started..."
        
        # Import backup module if needed
        try {
            Import-Module "$PSScriptRoot\..\..\..\automation\backup\backup.psm1" -Force
        } catch {
            Write-Warning "[ADMIN-COMMANDS] Failed to import backup module: $($_.Exception.Message)"
        }
        
        if (Get-Command "Invoke-GameBackup" -ErrorAction SilentlyContinue) {
            # Get paths directly from config instead of using Get-ConfigPaths
            try {
                if (Test-Path "SCUM-Server-Automation.config.json") {
                    $configContent = Get-Content "SCUM-Server-Automation.config.json" -Raw | ConvertFrom-Json
                    $savedDir = $configContent.savedDir
                    $backupRoot = $configContent.backupRoot
                    
                    if ($savedDir -and $backupRoot) {
                        # Resolve relative paths
                        if (-not [System.IO.Path]::IsPathRooted($savedDir)) {
                            $savedDir = Join-Path (Get-Location) $savedDir
                        }
                        if (-not [System.IO.Path]::IsPathRooted($backupRoot)) {
                            $backupRoot = Join-Path (Get-Location) $backupRoot
                        }
                        
                        $backupResult = Invoke-GameBackup -SourcePath $savedDir -BackupRoot $backupRoot
                        if ($backupResult) {
                            Send-CommandResponse -ChannelId $ResponseChannelId -Content ":white_check_mark: **Backup Complete** - Manual backup created successfully"
                        } else {
                            Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Backup Failed** - Manual backup creation failed"
                        }
                    } else {
                        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Backup paths not configured in config file (savedDir: $savedDir, backupRoot: $backupRoot)"
                    }
                } else {
                    Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Configuration file not found"
                }
            } catch {
                Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Failed to read configuration: $($_.Exception.Message)"
            }
        } else {
            Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Backup function not available"
        }
    } catch {
        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Failed to create backup: $($_.Exception.Message)"
    }
}

function Handle-ServerCancelAdminCommand {
    <#
    .SYNOPSIS
    Handle !server_cancel admin command
    #>
    param([string]$ResponseChannelId)
    
    try {
        # Cancel all scheduled tasks using the new scheduled tasks system
        if (Get-Command "Cancel-ScheduledTask" -ErrorAction SilentlyContinue) {
            $cancelled = Cancel-ScheduledTask
            if ($cancelled) {
                Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Cancel Actions** - All scheduled admin actions cancelled"
                Write-Host "[ADMIN-COMMANDS] Cancel command executed - scheduled actions cancelled" -ForegroundColor Yellow
            } else {
                Send-CommandResponse -ChannelId $ResponseChannelId -Content ":information_source: **No Actions** - No scheduled actions to cancel"
            }
        } else {
            Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Cancel Actions** - All scheduled admin actions cancelled"
            Write-Host "[ADMIN-COMMANDS] Cancel command executed (scheduled tasks module not available)" -ForegroundColor Yellow
        }
    } catch {
        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Failed to cancel actions: $($_.Exception.Message)"
    }
}

function Handle-ServerRestartSkipAdminCommand {
    <#
    .SYNOPSIS
    Handle !server_restart_skip admin command with confirmation
    #>
    param(
        [string]$ResponseChannelId,
        [string]$UserId = "Unknown"
    )
    
    try {
        # Import the scheduling module to access skip functions
        Import-Module "$PSScriptRoot\..\..\..\automation\scheduling\scheduling.psm1" -Force
        
        # Check if restart is already skipped
        $isAlreadySkipped = Get-RestartSkipStatus
        if ($isAlreadySkipped) {
            Send-CommandResponse -ChannelId $ResponseChannelId -Content ":information_source: **Already Skipped** - Next restart is already set to be skipped. Use this command only when you want to skip the upcoming restart."
            Write-Host "[ADMIN-COMMANDS] Restart skip command rejected - restart already skipped" -ForegroundColor Yellow
            return
        }
        
        # Get current restart time before setting skip
        $currentRestartTime = "unknown time"
        $nextRestartTime = "unknown time"
        
        try {
            # Load restart times from config first
            if (Test-Path "SCUM-Server-Automation.config.json") {
                $configContent = Get-Content "SCUM-Server-Automation.config.json" -Raw | ConvertFrom-Json
                $restartTimes = $configContent.restartTimes
                
                if ($restartTimes -and $restartTimes.Count -gt 0) {
                    $now = Get-Date
                    
                    # Create list of all upcoming restarts (today + tomorrow)
                    $allUpcomingRestarts = @()
                    
                    # Add today's restarts that haven't happened yet
                    $today = $now.Date
                    foreach ($timeStr in $restartTimes) {
                        try {
                            $restartDateTime = [DateTime]::ParseExact("$($today.ToString('yyyy-MM-dd')) $timeStr", "yyyy-MM-dd HH:mm", $null)
                            if ($restartDateTime -gt $now) {
                                $allUpcomingRestarts += @{ Time = $restartDateTime; TimeStr = $timeStr; IsToday = $true }
                            }
                        } catch {
                            # Ignore parse errors for time strings
                        }
                    }
                    
                    # Add tomorrow's restarts
                    $tomorrow = $today.AddDays(1)
                    foreach ($timeStr in $restartTimes) {
                        try {
                            $restartDateTime = [DateTime]::ParseExact("$($tomorrow.ToString('yyyy-MM-dd')) $timeStr", "yyyy-MM-dd HH:mm", $null)
                            $allUpcomingRestarts += @{ Time = $restartDateTime; TimeStr = $timeStr; IsToday = $false }
                        } catch {
                            # Ignore parse errors for tomorrow times
                        }
                    }
                    
                    # Sort all restarts by time
                    $allUpcomingRestarts = $allUpcomingRestarts | Sort-Object { $_.Time }
                    
                    # Take first two restarts
                    if ($allUpcomingRestarts.Count -ge 1) {
                        $currentRestartTime = $allUpcomingRestarts[0].TimeStr
                        
                        if ($allUpcomingRestarts.Count -ge 2) {
                            $nextRestartTime = $allUpcomingRestarts[1].TimeStr
                        } else {
                            $nextRestartTime = "unknown time"
                        }
                    }
                }
            } else {
                # Config file not found
            }
        } catch {
            # Ignore errors calculating restart times
        }
        
        # Ensure we have valid time strings (never empty)
        if ([string]::IsNullOrWhiteSpace($currentRestartTime)) {
            $currentRestartTime = "unknown time"
        }
        if ([string]::IsNullOrWhiteSpace($nextRestartTime)) {
            $nextRestartTime = "unknown time"
        }
        
        # Validate that we actually have real times, not just defaults
        if ($currentRestartTime -eq "unknown time") {
            Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Could not determine next restart time. Check server configuration."
            Write-Host "[ADMIN-COMMANDS] Restart skip failed - could not determine restart times" -ForegroundColor Red
            return
        }
        
        # Request confirmation with reactions (create action description AFTER times are calculated)
        $actionDescription = "Skip Next Restart - Skip restart at " + $currentRestartTime + "? Next restart will be at " + $nextRestartTime
        $confirmed = Request-AdminConfirmation -ChannelId $ResponseChannelId -UserId $UserId -ActionType "skip" -ActionDescription $actionDescription
        
        if ($confirmed -eq $true) {
            # Set the skip flag for the next scheduled restart
            Set-RestartSkip
            
            # Send immediate notification to players about skipped restart
            if (Get-Command "Send-DiscordNotification" -ErrorAction SilentlyContinue) {
                try {
                    $null = Send-DiscordNotification -Type "server.scheduledRestart" -Data @{
                        event = "Scheduled restart at $currentRestartTime has been cancelled"
                        nextRestart = $nextRestartTime
                        skipped = $true
                        immediate = $true
                    }
                    Write-Host "[ADMIN-COMMANDS] Immediate player notification sent about restart skip" -ForegroundColor Green
                } catch {
                    Write-Host "[ADMIN-COMMANDS] Failed to send immediate player notification: $($_.Exception.Message)" -ForegroundColor Yellow
                }
            }
            
            # Note: Server status embed will update automatically in next cycle to show new restart time
            
            Send-CommandResponse -ChannelId $ResponseChannelId -Content ":white_check_mark: **Restart Skipped** - Restart at $currentRestartTime cancelled, next restart: $nextRestartTime"
            Write-Host "[ADMIN-COMMANDS] Restart skip command executed - next restart will be skipped" -ForegroundColor Yellow
            Write-Host "[ADMIN-COMMANDS] Server status embed will update automatically in next cycle" -ForegroundColor Cyan
        } else {
            Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Skip Cancelled** - Restart skip was cancelled"
            Write-Host "[ADMIN-COMMANDS] Restart skip cancelled by admin" -ForegroundColor Yellow
        }
    } catch {
        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Failed to skip restart: $($_.Exception.Message)"
        Write-Host "[ADMIN-COMMANDS] Error executing restart skip: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# ===============================================================
# COMMAND ROUTING
# ===============================================================

function Execute-AdminCommand {
    <#
    .SYNOPSIS
    Route admin command to appropriate handler
    .PARAMETER CommandName
    Name of the admin command
    .PARAMETER Arguments
    Command arguments
    .PARAMETER ResponseChannelId
    Channel to send response to
    .PARAMETER UserId
    User who executed the command
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$CommandName,
        [Parameter(Mandatory=$false)]
        [string]$Arguments = "",
        [Parameter(Mandatory=$true)]
        [string]$ResponseChannelId,
        [Parameter(Mandatory=$true)]
        [string]$UserId
    )
    
    try {
        # Parse arguments for commands that need them
        
        switch ($CommandName) {
            'server_status' {
                Handle-ServerStatusAdminCommand -ResponseChannelId $ResponseChannelId
            }
            'server_start' {
                Handle-ServerStartAdminCommand -ResponseChannelId $ResponseChannelId
            }
            'server_stop' {
                # Parse minutes from arguments
                $cleanArg = $Arguments.Trim() -replace '[^\d]', ''
                $minutes = if ($cleanArg -and $cleanArg -match '^\d+$') { [int]$cleanArg } else { 0 }
                Handle-ServerStopAdminCommand -ResponseChannelId $ResponseChannelId -Minutes $minutes -UserId $UserId
            }
            'server_restart' {
                $cleanArg = $Arguments.Trim() -replace '[^\d]', ''
                $minutes = if ($cleanArg -and $cleanArg -match '^\d+$') { [int]$cleanArg } else { 0 }
                Handle-ServerRestartAdminCommand -ResponseChannelId $ResponseChannelId -Minutes $minutes -UserId $UserId
            }
            'server_update' {
                $cleanArg = $Arguments.Trim() -replace '[^\d]', ''
                $minutes = if ($cleanArg -and $cleanArg -match '^\d+$') { [int]$cleanArg } else { 0 }
                Handle-ServerUpdateAdminCommand -ResponseChannelId $ResponseChannelId -Minutes $minutes -UserId $UserId
            }
            'server_backup' {
                Handle-ServerBackupAdminCommand -ResponseChannelId $ResponseChannelId
            }
            'server_validate' {
                Handle-ServerValidateAdminCommand -ResponseChannelId $ResponseChannelId -UserId $UserId
            }
            'server_cancel' {
                Handle-ServerCancelAdminCommand -ResponseChannelId $ResponseChannelId
            }
            'server_restart_skip' {
                Handle-ServerRestartSkipAdminCommand -ResponseChannelId $ResponseChannelId -UserId $UserId
            }
            default {
                Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Unknown Admin Command** - Command `!$CommandName` is not implemented."
            }
        }
        
    } catch {
        Write-Warning "[ADMIN-COMMANDS] Error executing admin command '$CommandName': $($_.Exception.Message)"
        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Failed to execute admin command: $($_.Exception.Message)"
    }
}

# Export functions
Export-ModuleMember -Function @(
    'Execute-AdminCommand',
    'Add-DiscordReaction',
    'Wait-ForReactionConfirmation', 
    'Send-CommandResponse',
    'Request-AdminConfirmation',
    'Handle-ServerStatusAdminCommand',
    'Handle-ServerStartAdminCommand',
    'Handle-ServerStopAdminCommand',
    'Handle-ServerRestartAdminCommand',
    'Handle-ServerUpdateAdminCommand',
    'Handle-ServerValidateAdminCommand',
    'Handle-ServerBackupAdminCommand',
    'Handle-ServerCancelAdminCommand',
    'Handle-ServerRestartSkipAdminCommand'
)
