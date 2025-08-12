# ===============================================================
# SCUM Server Automation - Discord Notification Manager
# ===============================================================
# Manages automated Discord notifications for server events
# Handles server status, backups, updates, and admin notifications
# ===============================================================

# Standard import of common module
try {
    $helperPath = Join-Path $PSScriptRoot "..\..\core\module-helper.psm1"
    if (Test-Path $helperPath) {
        Import-Module $helperPath -Force -ErrorAction SilentlyContinue
        Import-CommonModule | Out-Null
    }
} catch {
    Write-Host "[WARNING] Common module not available for notification-manager module" -ForegroundColor Yellow
}

# Import required modules
$moduleRoot = Split-Path $PSScriptRoot -Parent
Import-Module (Join-Path $moduleRoot "core\discord-api.psm1") -Force -Global -ErrorAction SilentlyContinue
Import-Module (Join-Path $moduleRoot "templates\embed-styles.psm1") -Force -Global -ErrorAction SilentlyContinue

# Global variables
$script:DiscordConfig = $null
$script:NotificationConfig = $null

# Default notification type configurations - can be overridden in config
$script:DefaultAdminOnlyTypes = @(
    'manager.started', 'manager.stopped', 'backup.started', 'backup.completed', 'backup.failed',
    'update.available', 'update.started', 'update.completed', 'update.failed',
    'performance.critical', 'performance.poor', 'performance.warning', 'performance.alert',
    'admin.alert', 'error',
    'service.started', 'service.stopped', 'service.starting', 'service.stopping',
    'server.started', 'server.stopped', 'server.starting', 'server.shutting_down', 'server.loading'
)

$script:DefaultPlayerNotificationTypes = @(
    'server.online', 'server.offline',
    'updateWarning15', 'updateWarning5', 'updateWarning1',
    'restartWarning15', 'restartWarning5', 'restartWarning1', 'server.scheduledRestart',
    'manualStopWarning', 'manualRestartWarning', 'manualUpdateWarning'
)

# Current active notification types (loaded from config or defaults)
$script:AdminOnlyTypes = $null
$script:PlayerNotificationTypes = $null

# ===============================================================
# INITIALIZATION
# ===============================================================

function Initialize-NotificationManager {
    <#
    .SYNOPSIS
    Initialize notification manager with configuration
    #>
    param(
        [Parameter(Mandatory=$true)]
        [hashtable]$Config
    )
    
    # Use Discord config directly - converting PSCustomObject to hashtable breaks arrays
    $script:DiscordConfig = $Config.Discord
    
    if (-not $script:DiscordConfig -or -not $script:DiscordConfig.Token) {
        Write-Log "Discord not configured, notifications disabled" -Level "Debug"
        return $false
    }
    
    # Use notification config from main config structure
    if ($script:DiscordConfig.Notifications) {
        $script:NotificationConfig = @{
            NotificationChannels = $script:DiscordConfig.Notifications.Channels
            DefaultChannel = $script:DiscordConfig.Notifications.DefaultChannel
            NotificationTemplates = $script:DiscordConfig.Notifications.Templates
        }
        Write-Log "Loaded notification configuration from main config" -Level "Debug"
    } else {
        Write-Log "No notification configuration found in main config" -Level "Debug"
    }
    
    # Initialize notification types from config or use defaults
    if ($script:DiscordConfig.Notifications.NotificationTypes) {
        $script:AdminOnlyTypes = if ($script:DiscordConfig.Notifications.NotificationTypes.AdminOnly) {
            $script:DiscordConfig.Notifications.NotificationTypes.AdminOnly
        } else {
            $script:DefaultAdminOnlyTypes
        }
        
        $script:PlayerNotificationTypes = if ($script:DiscordConfig.Notifications.NotificationTypes.Player) {
            $script:DiscordConfig.Notifications.NotificationTypes.Player
        } else {
            $script:DefaultPlayerNotificationTypes
        }
        
        Write-Log "Loaded notification types from config - Admin: $($script:AdminOnlyTypes.Count), Player: $($script:PlayerNotificationTypes.Count)" -Level "Debug"
    } else {
        $script:AdminOnlyTypes = $script:DefaultAdminOnlyTypes
        $script:PlayerNotificationTypes = $script:DefaultPlayerNotificationTypes
        Write-Log "Using default notification types - Admin: $($script:AdminOnlyTypes.Count), Player: $($script:PlayerNotificationTypes.Count)" -Level "Debug"
    }
    
    Write-Log "Discord notifications initialized successfully" -Level "Debug"
    return $true
}

# ===============================================================
# NOTIFICATION SENDING
# ===============================================================

function Send-DiscordNotification {
    <#
    .SYNOPSIS
    Send notification to Discord channel
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$Type,
        
        [hashtable]$Data = @{}
    )
    
    try {
        if (-not $script:DiscordConfig -or -not $script:DiscordConfig.Token) {
            Write-Log "Discord not configured, skipping notification" -Level "Debug"
            return
        }
        
        # Check if status change notifications should be suppressed
        if ($script:DiscordConfig.Notifications.SuppressStatusChanges -and 
            $Type -in @('server.online', 'server.offline', 'server.starting', 'server.shutting_down', 'server.loading')) {
            Write-Log "Status change notification suppressed: $Type" -Level "Debug"
            return @{ Success = $true; Message = "Notification suppressed by configuration" }
        }
        
        # Get target channels (may be multiple)
        $channels = Get-NotificationChannels -Type $Type
        if (-not $channels -or $channels.Count -eq 0) {
            Write-Log "No channels configured for notification type: $Type" -Level Warning
            return @{ Success = $false; Error = "No channels configured for notification type: $Type" }
        }
        
        # Create embed once
        $embed = New-NotificationEmbed -Type $Type -Data $Data
        
        # Send to all applicable channels
        $results = @()
        $successCount = 0
        
        foreach ($channelId in $channels) {
            Write-Log "Sending to channel: $channelId" -Level "Debug"
            
            # Get role mentions specific to this channel
            $roleMentions = Get-ChannelSpecificRoleMentions -Type $Type -ChannelId $channelId
            
            # Prepare message content with role mentions
            $messageContent = $null
            if ($roleMentions -and $roleMentions.Count -gt 0) {
                # Convert roles to proper mention format
                $roleMentionStrings = @()
                foreach ($role in $roleMentions) {
                    if ($role -and $role.ToString().Trim() -ne '') {
                        $mentionString = "<@&$($role.ToString().Trim())>"
                        $roleMentionStrings += $mentionString
                    }
                }
                if ($roleMentionStrings.Count -gt 0) {
                    $messageContent = $roleMentionStrings -join " "
                }
            }
            $channelResult = $null
            
            if (Get-Command "Send-DiscordMessage" -ErrorAction SilentlyContinue) {
                try {
                    Write-Log "Sending Discord notification: Type=$Type, ChannelId=$channelId, HasContent=$($messageContent -ne $null)" -Level "Debug"
                    if ($messageContent) {
                        Write-Log "Message content: $messageContent" -Level "Debug"
                    }
                    
                    if ($messageContent) {
                        $channelResult = Send-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $channelId -Embed $embed -Content $messageContent
                    } else {
                        $channelResult = Send-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $channelId -Embed $embed
                    }
                    
                    if ($channelResult) {
                        $successCount++
                        $results += @{ ChannelId = $channelId; Success = $true; Result = $channelResult }
                    } else {
                        $results += @{ ChannelId = $channelId; Success = $false; Error = "Discord API call failed" }
                    }
                    
                } catch {
                    Write-Log "Discord API error for $Type to channel $channelId`: $($_.Exception.Message)" -Level Error
                    $results += @{ ChannelId = $channelId; Success = $false; Error = $_.Exception.Message }
                    
                    # Try sending without content as fallback
                    if ($messageContent) {
                        Write-Log "Retrying without role mentions..." -Level "Debug"
                        try {
                            $channelResult = Send-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $channelId -Embed $embed
                            if ($channelResult) {
                                Write-Log "Fallback send successful" -Level "Debug"
                                $successCount++
                                $results[-1] = @{ ChannelId = $channelId; Success = $true; Result = $channelResult; Note = "Sent without role mentions" }
                            }
                        } catch {
                            Write-Log "Fallback send also failed: $($_.Exception.Message)" -Level Error
                        }
                    }
                }
            } else {
                Write-Log "Discord API module not available" -Level Warning
                $results += @{ ChannelId = $channelId; Success = $false; Error = "Discord API module not available" }
            }
        }
        
        if ($successCount -gt 0) {
            Write-Log "Discord notification sent to $successCount/$($channels.Count) channels: $Type" -Level "Debug"
            return @{ 
                Success = $true
                Message = "Notification sent to $successCount/$($channels.Count) channels"
                Results = $results
                ChannelCount = $channels.Count
                SuccessCount = $successCount
            }
        } else {
            Write-Log "Discord notification failed for all channels: $Type" -Level Error
            return @{ 
                Success = $false
                Error = "Failed to send to all channels"
                Results = $results
                ChannelCount = $channels.Count
                SuccessCount = 0
            }
        }
        
    } catch {
        Write-Log "Discord notification error: $($_.Exception.Message)" -Level Error
    }
}

function Get-NotificationChannels {
    <#
    .SYNOPSIS
    Get all applicable channels for notification type - if type is in both AdminOnly and Player lists, send to both channels
    #>
    param([string]$Type)
    
    $channels = @()
    
    # Use configured notification types or defaults
    $adminOnlyTypes = if ($script:AdminOnlyTypes) { $script:AdminOnlyTypes } else { $script:DefaultAdminOnlyTypes }
    $playerNotificationTypes = if ($script:PlayerNotificationTypes) { $script:PlayerNotificationTypes } else { $script:DefaultPlayerNotificationTypes }
    
    # Check if notification type is in each list
    $isAdminNotification = $Type -in $adminOnlyTypes
    $isPlayerNotification = $Type -in $playerNotificationTypes
    
    # Pattern matching for warnings (always player notifications)
    if ($Type -match '^(restart|update)Warning\d+$') {
        $isPlayerNotification = $true
    }
    
    # Add admin channel if it's an admin notification
    if ($isAdminNotification -and $script:DiscordConfig.Notifications.Channels.Admin) {
        $channels += $script:DiscordConfig.Notifications.Channels.Admin
    }
    
    # Add player channel if it's a player notification
    if ($isPlayerNotification -and $script:DiscordConfig.Notifications.Channels.Players) {
        $channels += $script:DiscordConfig.Notifications.Channels.Players
    }
    
    # If no specific channels found, use default
    if ($channels.Count -eq 0 -and $script:DiscordConfig.Notifications.DefaultChannel) {
        $channels += $script:DiscordConfig.Notifications.DefaultChannel
    }
    
    # Remove duplicates (in case both channels are the same)
    $channels = $channels | Select-Object -Unique
    
    Write-Log "[Channels] Type: $Type, Admin: $isAdminNotification, Player: $isPlayerNotification, Channels: $($channels -join ', ')" -Level "Debug"
    
    return $channels
}

function Get-NotificationChannel {
    <#
    .SYNOPSIS
    Get appropriate channel for notification type with admin/player distinction
    #>
    param([string]$Type)
    
    # Determine if this is an admin-only notification
    # Use configured notification types or defaults
    $adminOnlyTypes = if ($script:AdminOnlyTypes) { $script:AdminOnlyTypes } else { $script:DefaultAdminOnlyTypes }
    $playerNotificationTypes = if ($script:PlayerNotificationTypes) { $script:PlayerNotificationTypes } else { $script:DefaultPlayerNotificationTypes }
    
    # Add restartWarning patterns to player notifications
    if ($Type -match '^restartWarning\d+$') {
        $isPlayerNotification = $true
    }
    
    # Add updateWarning patterns to player notifications
    if ($Type -match '^updateWarning\d+$') {
        $isPlayerNotification = $true
    }
    
    $isAdminOnly = $Type -in $adminOnlyTypes
    $isPlayerNotification = $Type -in $playerNotificationTypes
    
    # Try to get specific channel for this notification type
    if ($script:NotificationConfig -and $script:NotificationConfig.NotificationChannels -and $script:NotificationConfig.NotificationChannels[$Type]) {
        return $script:NotificationConfig.NotificationChannels[$Type]
    }
    
    if ($script:DiscordConfig.Notifications.Channels -and $script:DiscordConfig.Notifications.Channels[$Type]) {
        return $script:DiscordConfig.Notifications.Channels[$Type]
    }
    
    # Route to admin or player channels based on notification type
    if ($isAdminOnly) {
        # Admin-only notifications
        if ($script:DiscordConfig.Notifications.Channels.Admin) {
            return $script:DiscordConfig.Notifications.Channels.Admin
        }
        if ($script:DiscordConfig.Channels.Admin) {
            return $script:DiscordConfig.Channels.Admin
        }
    }
    
    if ($isPlayerNotification) {
        # Player notifications
        if ($script:DiscordConfig.Notifications.Channels.Players) {
            return $script:DiscordConfig.Notifications.Channels.Players
        }
        if ($script:DiscordConfig.Channels.Players) {
            return $script:DiscordConfig.Channels.Players
        }
        if ($script:DiscordConfig.Channels.General) {
            return $script:DiscordConfig.Channels.General
        }
    }
    
    # Fall back to default channel
    if ($script:DiscordConfig.Notifications.DefaultChannel) {
        return $script:DiscordConfig.Notifications.DefaultChannel
    }
    
    # Final fallback to general channel
    if ($script:DiscordConfig.Channels.General) {
        return $script:DiscordConfig.Channels.General
    }
    
    Write-Log "No Discord channel configured for notification type: $Type (Admin: $isAdminOnly, Player: $isPlayerNotification)" -Level Warning
    return $null
}

function New-NotificationEmbed {
    <#
    .SYNOPSIS
    Create notification embed based on type with emoji and proper data formatting
    #>
    param(
        [string]$Type,
        [hashtable]$Data
    )
    
    switch ($Type) {
        "manager.started" {
            return New-StandardEmbed -Title ":white_check_mark: Server Automation Started" -Description "SCUM Server Automation is now monitoring the server" -Color (Get-ColorCode "success")
        }
        
        "manager.stopped" {
            return New-StandardEmbed -Title ":octagonal_sign: Automation Stopped" -Description "SCUM Server Automation has stopped monitoring" -Color (Get-ColorCode "warning")
        }
        
        "server.started" {
            return New-StandardEmbed -Title ":green_circle: Server Started" -Description "SCUM server is now **ONLINE** and ready for players!" -Color (Get-ColorCode "success")
        }
        
        "server.stopped" {
            return New-StandardEmbed -Title ":red_circle: Server Stopped" -Description "SCUM server is now **OFFLINE**" -Color (Get-ColorCode "error")
        }
        
        "server.online" {
            return New-StandardEmbed -Title ":green_circle: Server Online" -Description "SCUM server is **ONLINE** and accepting connections" -Color (Get-ColorCode "success")
        }
        
        "server.offline" {
            return New-StandardEmbed -Title ":red_circle: Server Offline" -Description "SCUM server is **OFFLINE** - players cannot connect" -Color (Get-ColorCode "error")
        }
        
        "server.loading" {
            return New-StandardEmbed -Title ":yellow_circle: Server Loading" -Description "SCUM server is **LOADING** - please wait..." -Color (Get-ColorCode "warning")
        }
        
        "server.starting" {
            return New-StandardEmbed -Title ":yellow_circle: Server Starting" -Description "SCUM server is **STARTING UP** - please wait..." -Color (Get-ColorCode "warning")
        }
        
        "server.shutting_down" {
            return New-StandardEmbed -Title ":orange_circle: Server Shutting Down" -Description "SCUM server is **SHUTTING DOWN** - players should disconnect" -Color (Get-ColorCode "warning")
        }
        
        "service.started" {
            return New-StandardEmbed -Title ":gear: Service Started" -Description "Windows service **STARTED** - server is initializing" -Color (Get-ColorCode "info")
        }
        
        "service.stopped" {
            return New-StandardEmbed -Title ":stop_sign: Service Stopped" -Description "Windows service **STOPPED** - server is completely offline" -Color (Get-ColorCode "error")
        }
        
        "service.starting" {
            return New-StandardEmbed -Title ":arrows_clockwise: Service Starting" -Description "Windows service is **STARTING UP**" -Color (Get-ColorCode "warning")
        }
        
        "service.stopping" {
            return New-StandardEmbed -Title ":warning: Service Stopping" -Description "Windows service is **STOPPING**" -Color (Get-ColorCode "warning")
        }
        
        "backup.started" {
            $backupType = if ($Data.type) { $Data.type } else { "manual" }
            return New-StandardEmbed -Title ":floppy_disk: Backup Started" -Description "Server backup in progress...`n**Type:** $backupType" -Color (Get-ColorCode "info")
        }
        
        "backup.completed" {
            $backupType = if ($Data.type) { $Data.type } else { "manual" }
            $size = if ($Data.size) { "`n**Size:** $($Data.size)" } else { "" }
            $duration = if ($Data.duration) { "`n**Duration:** $($Data.duration)" } else { "" }
            return New-StandardEmbed -Title ":white_check_mark: Backup Completed" -Description "Server backup completed successfully!`n**Type:** $backupType$size$duration" -Color (Get-ColorCode "success")
        }
        
        "backup.failed" {
            $errorMsg = if ($Data.error) { "`n**Error:** $($Data.error)" } else { "" }
            $backupType = if ($Data.type) { $Data.type } else { "backup" }
            return New-StandardEmbed -Title ":x: Backup Failed" -Description "Server backup failed - **$backupType**$errorMsg" -Color (Get-ColorCode "error")
        }
        
        "update.available" {
            $version = if ($Data.version) { "`n**New Version:** $($Data.version)" } else { "" }
            $currentVersion = if ($Data.currentVersion) { "`n**Current:** $($Data.currentVersion)" } else { "" }
            return New-StandardEmbed -Title ":arrows_counterclockwise: Update Available" -Description "A new server update is ready for installation!$currentVersion$version" -Color (Get-ColorCode "warning")
        }
        
        "update.started" {
            return New-StandardEmbed -Title ":gear: Update Started" -Description "Server update is being installed - server may be temporarily unavailable" -Color (Get-ColorCode "info")
        }
        
        "update.completed" {
            $version = if ($Data.version) { "`n**Updated to:** $($Data.version)" } else { "" }
            return New-StandardEmbed -Title ":white_check_mark: Update Completed" -Description "Server update completed successfully!$version" -Color (Get-ColorCode "success")
        }
        
        "update.failed" {
            $errorMsg = if ($Data.error) { "`n**Error:** $($Data.error)" } else { "" }
            return New-StandardEmbed -Title ":x: Update Failed" -Description "Server update failed - manual intervention may be required$errorMsg" -Color (Get-ColorCode "error")
        }
        
        "server.scheduledRestart" {
            # Check if this is a skip notification
            if ($Data.skipped -and $Data.immediate) {
                $nextRestart = if ($Data.nextRestart) { "`n**Next Restart:** $($Data.nextRestart)" } else { "" }
                return New-StandardEmbed -Title ":fast_forward: Restart Cancelled" -Description "$($Data.event)$nextRestart" -Color (Get-ColorCode "info")
            } 
            # Check if this is about a skipped restart during actual restart time
            elseif ($Data.event -and $Data.event.Contains("skipped")) {
                return New-StandardEmbed -Title ":fast_forward: Restart Skipped" -Description "$($Data.event)" -Color (Get-ColorCode "info")
            }
            # Normal restart notification
            else {
                $reason = if ($Data.reason) { "`n**Reason:** $($Data.reason)" } else { "" }
                $players = if ($Data.players) { "`n**Online Players:** $($Data.players)" } else { "" }
                return New-StandardEmbed -Title ":arrows_counterclockwise: Scheduled Server Restart" -Description "Scheduled server restart is now in progress$reason$players" -Color (Get-ColorCode "warning")
            }
        }
        
        # Handle restartWarning15, restartWarning5, restartWarning1, etc.
        { $_ -match '^restartWarning\d+$' } {
            # Extract minutes directly from the warning type name
            $minutes = $Type -replace '^restartWarning(\d+)$', '$1'
            
            $players = if ($Data.players) { "`n**Online Players:** $($Data.players)" } else { "" }
            
            $description = if ($minutes -eq "1") {
                "**Server will restart in 1 MINUTE!**`nSave your progress NOW and prepare for disconnection!"
            } else {
                "**Server will restart in $minutes minutes!**`nPlease save your progress and prepare for disconnection."
            }
            
            return New-StandardEmbed -Title ":warning: Restart Warning ($minutes min)" -Description "$description$players" -Color (Get-ColorCode "warning")
        }
        
        # Handle updateWarning15, updateWarning5, updateWarning1, etc.
        { $_ -match '^updateWarning\d+$' } {
            # Extract minutes directly from the warning type name
            $minutes = $Type -replace '^updateWarning(\d+)$', '$1'
            
            $players = if ($Data.players) { "`n**Online Players:** $($Data.players)" } else { "" }
            
            $description = if ($minutes -eq "1") {
                "**Server update will start in 1 MINUTE!**`nSave your progress NOW - server will be temporarily unavailable!"
            } else {
                "**Server update will start in $minutes minutes!**`nPlease save your progress - server will be briefly unavailable for updates."
            }
            
            return New-StandardEmbed -Title ":arrows_counterclockwise: Update Warning ($minutes min)" -Description "$description$players" -Color (Get-ColorCode "warning")
        }
        
        # Handle manual admin action warnings
        "manualStopWarning" {
            $minutes = if ($Data.minutes) { $Data.minutes } else { "unknown" }
            $action = if ($Data.action) { $Data.action } else { "stop" }
            
            $description = if ($minutes -eq "1") {
                "**Admin-initiated server $action in 1 MINUTE!**`nSave your progress NOW and prepare for disconnection!"
            } else {
                "**Admin-initiated server $action in $minutes minutes!**`nPlease save your progress and prepare for disconnection."
            }
            
            return New-StandardEmbed -Title ":stop_sign: Manual Stop Warning ($minutes min)" -Description $description -Color (Get-ColorCode "error")
        }
        
        "manualRestartWarning" {
            $minutes = if ($Data.minutes) { $Data.minutes } else { "unknown" }
            $action = if ($Data.action) { $Data.action } else { "restart" }
            
            $description = if ($minutes -eq "1") {
                "**Admin-initiated server $action in 1 MINUTE!**`nSave your progress NOW and prepare for disconnection!"
            } else {
                "**Admin-initiated server $action in $minutes minutes!**`nPlease save your progress and prepare for disconnection."
            }
            
            return New-StandardEmbed -Title ":arrows_counterclockwise: Manual Restart Warning ($minutes min)" -Description $description -Color (Get-ColorCode "warning")
        }
        
        "manualUpdateWarning" {
            $minutes = if ($Data.minutes) { $Data.minutes } else { "unknown" }
            $action = if ($Data.action) { $Data.action } else { "update" }
            
            $description = if ($minutes -eq "1") {
                "**Admin-initiated server $action in 1 MINUTE!**`nSave your progress NOW - server will be temporarily unavailable!"
            } else {
                "**Admin-initiated server $action in $minutes minutes!**`nPlease save your progress - server will be briefly unavailable for updates."
            }
            
            return New-StandardEmbed -Title ":arrow_up: Manual Update Warning ($minutes min)" -Description $description -Color (Get-ColorCode "warning")
        }
        
        "performance.critical" {
            # Show real values, including 0 - only use N/A if data is truly missing
            $fps = if ($Data.fps -ne $null) { $Data.fps } else { "N/A" }
            $cpu = if ($Data.cpu -ne $null) { "$($Data.cpu)%" } else { "N/A" }
            $memory = if ($Data.memory -ne $null) { "$($Data.memory) MB" } else { "N/A" }
            $entities = if ($Data.entities -ne $null) { $Data.entities } else { "N/A" }
            $players = if ($Data.players -ne $null -and $Data.max_players -ne $null) { "$($Data.players)/$($Data.max_players)" } else { "N/A" }
            
            return New-StandardEmbed -Title ":rotating_light: Critical Performance Alert" -Description "**CRITICAL:** Server performance issue detected!`n**FPS:** $fps`n**CPU:** $cpu`n**Memory:** $memory`n**Players:** $players`n**Entities:** $entities`n`nImmediate attention required!" -Color 15158332
        }
        
        "performance.poor" {
            # Show real values, including 0 - only use N/A if data is truly missing
            $fps = if ($Data.fps -ne $null) { $Data.fps } else { "N/A" }
            $cpu = if ($Data.cpu -ne $null) { "$($Data.cpu)%" } else { "N/A" }
            $memory = if ($Data.memory -ne $null) { "$($Data.memory) MB" } else { "N/A" }
            $entities = if ($Data.entities -ne $null) { $Data.entities } else { "N/A" }
            $players = if ($Data.players -ne $null -and $Data.max_players -ne $null) { "$($Data.players)/$($Data.max_players)" } else { "N/A" }
            
            return New-StandardEmbed -Title ":warning: Poor Performance Alert" -Description "**WARNING:** Server performance is degraded!`n**FPS:** $fps`n**CPU:** $cpu`n**Memory:** $memory`n**Players:** $players`n**Entities:** $entities`n`nPerformance monitoring active." -Color (Get-ColorCode "warning")
        }
        
        "performance.warning" {
            $metric = if ($Data.metric) { $Data.metric } else { "Unknown" }
            $value = if ($Data.value) { $Data.value } else { "N/A" }
            $threshold = if ($Data.threshold) { " (threshold: $($Data.threshold))" } else { "" }
            return New-StandardEmbed -Title ":warning: Performance Warning" -Description "Server performance degradation detected:`n**Metric:** $metric`n**Current Value:** $value$threshold" -Color (Get-ColorCode "warning")
        }
        
        "performance.alert" {
            $metricName = if ($Data.metric) { $Data.metric } else { "performance" }
            $metricValue = if ($Data.value) { $Data.value } else { "unknown" }
            $severity = if ($Data.severity) { $Data.severity } else { "medium" }
            $emoji = switch ($severity) {
                "critical" { ":rotating_light:" }
                "high" { ":warning:" }
                "medium" { ":yellow_circle:" }
                default { ":information_source:" }
            }
            return New-StandardEmbed -Title "$emoji Performance Alert" -Description "Performance issue detected:`n**${metricName}:** $metricValue" -Color (Get-ColorCode "warning")
        }
        
        "player.joined" {
            $playerName = if ($Data.playerName) { $Data.playerName } else { "Unknown Player" }
            $playerCount = if ($Data.playerCount) { "`n**Players Online:** $($Data.playerCount)" } else { "" }
            return New-StandardEmbed -Title ":wave: Player Joined" -Description "**$playerName** joined the server$playerCount" -Color (Get-ColorCode "success")
        }
        
        "player.left" {
            $playerName = if ($Data.playerName) { $Data.playerName } else { "Unknown Player" }
            $playerCount = if ($Data.playerCount) { "`n**Players Online:** $($Data.playerCount)" } else { "" }
            return New-StandardEmbed -Title ":door: Player Left" -Description "**$playerName** left the server$playerCount" -Color (Get-ColorCode "info")
        }
        
        "admin.alert" {
            $message = if ($Data.message) { $Data.message } else { "Admin attention required" }
            $severity = if ($Data.severity) { $Data.severity } else { "medium" }
            $emoji = switch ($severity) {
                "critical" { ":rotating_light:" }
                "high" { ":warning:" }
                default { ":information_source:" }
            }
            return New-StandardEmbed -Title "$emoji Admin Alert" -Description "**Admin Attention Required**`n$message" -Color (Get-ColorCode "error")
        }
        
        "error" {
            $message = if ($Data.message) { $Data.message } else { "Unknown error occurred" }
            $component = if ($Data.component) { "`n**Component:** $($Data.component)" } else { "" }
            return New-StandardEmbed -Title ":x: System Error" -Description "**Error:** $message$component" -Color (Get-ColorCode "error")
        }
        
        "info" {
            $message = if ($Data.message) { $Data.message } else { "Information" }
            $category = if ($Data.category) { " - $($Data.category)" } else { "" }
            return New-StandardEmbed -Title ":information_source: Information$category" -Description $message -Color (Get-ColorCode "info")
        }
        
        default {
            Write-Log "Unknown notification type: $Type, creating generic notification" -Level "Debug"
            $message = if ($Data.message) { $Data.message } else { "Event: **$Type**" }
            
            # Build additional info
            $additionalInfo = @()
            if ($Data.time -and $Data.time -ne (Get-Date).ToString('HH:mm:ss')) {
                $additionalInfo += "**Time:** $($Data.time)"
            }
            if ($Data.players) {
                $additionalInfo += "**Players:** $($Data.players)"
            }
            if ($Data.reason) {
                $additionalInfo += "**Reason:** $($Data.reason)"
            }
            
            $infoText = if ($additionalInfo.Count -gt 0) { "`n`n" + ($additionalInfo -join "`n") } else { "" }
            
            return New-StandardEmbed -Title ":information_source: Server Event" -Description "$message$infoText" -Color (Get-ColorCode "info")
        }
    }
}

function Get-ChannelSpecificRoleMentions {
    <#
    .SYNOPSIS
    Get role mentions specific to a channel - admin roles for admin channel, player roles for player channel
    #>
    param(
        [string]$Type,
        [string]$ChannelId
    )
    
    $roles = @()
    
    # Get roles from configuration
    if (-not $script:DiscordConfig.Notifications -or -not $script:DiscordConfig.Notifications.Roles) {
        return $roles
    }
    
    $rolesConfig = $script:DiscordConfig.Notifications.Roles
    $adminChannel = $script:DiscordConfig.Notifications.Channels.Admin
    $playerChannel = $script:DiscordConfig.Notifications.Channels.Players
    
    # Determine which roles to use based on channel
    if ($ChannelId -eq $adminChannel -and $rolesConfig.Admin) {
        # Admin channel gets admin roles
        $targetRoles = $rolesConfig.Admin
        Write-Log "Using Admin roles for channel $ChannelId" -Level "Debug"
    } elseif ($ChannelId -eq $playerChannel -and $rolesConfig.Players) {
        # Player channel gets player roles  
        $targetRoles = $rolesConfig.Players
        Write-Log "Using Player roles for channel $ChannelId" -Level "Debug"
    } else {
        # Unknown channel or no roles configured
        Write-Log "No specific roles for channel $ChannelId" -Level "Debug"
        return $roles
    }
    
    # Handle array properly - check for Object[] from JSON
    if ($targetRoles -is [array] -or $targetRoles.GetType().Name -eq "Object[]") {
        foreach ($role in $targetRoles) {
            if ($role -and $role.ToString().Trim() -ne '') {
                $roles += $role.ToString().Trim()
            }
        }
    } else {
        if ($targetRoles -and $targetRoles.ToString().Trim() -ne '') {
            $roles += $targetRoles.ToString().Trim()
        }
    }
    
    return $roles
}

function Get-NotificationRoleMentions {
    <#
    .SYNOPSIS
    Get role mentions for notification type
    #>
    param([string]$Type)
    
    # Determine if this is an admin or player notification
    # Use configured notification types or defaults
    $adminOnlyTypes = if ($script:AdminOnlyTypes) { $script:AdminOnlyTypes } else { $script:DefaultAdminOnlyTypes }
    $playerNotificationTypes = if ($script:PlayerNotificationTypes) { $script:PlayerNotificationTypes } else { $script:DefaultPlayerNotificationTypes }
    
    # Check for restart warning patterns
    $isPlayerNotification = $false
    if ($Type -match '^restartWarning\d+$') {
        $isPlayerNotification = $true
    }
    
    # Check for update warning patterns
    if ($Type -match '^updateWarning\d+$') {
        $isPlayerNotification = $true
    }
    
    $isAdminOnly = $Type -in $adminOnlyTypes
    if (-not $isPlayerNotification) {
        $isPlayerNotification = $Type -in $playerNotificationTypes
    }
    
    $roles = @()
    
    # Get roles from configuration
    if ($script:DiscordConfig.Notifications -and $script:DiscordConfig.Notifications.Roles) {
        $rolesConfig = $script:DiscordConfig.Notifications.Roles
        
        if ($isAdminOnly -and $rolesConfig.Admin) {
            $adminRoles = $rolesConfig.Admin
            
            # Handle array properly - check for Object[] from JSON
            if ($adminRoles -is [array] -or $adminRoles.GetType().Name -eq "Object[]") {
                foreach ($role in $adminRoles) {
                    if ($role -and $role.ToString().Trim() -ne '') {
                        $roles += $role.ToString().Trim()
                    }
                }
            } else {
                if ($adminRoles -and $adminRoles.ToString().Trim() -ne '') {
                    $roles += $adminRoles.ToString().Trim()
                }
            }
        }
        
        if ($isPlayerNotification -and $rolesConfig.Players) {
            $playerRoles = $rolesConfig.Players
            
            # Handle array properly - check for Object[] from JSON
            if ($playerRoles -is [array] -or $playerRoles.GetType().Name -eq "Object[]") {
                foreach ($role in $playerRoles) {
                    if ($role -and $role.ToString().Trim() -ne '') {
                        $roles += $role.ToString().Trim()
                    }
                }
            } else {
                if ($playerRoles -and $playerRoles.ToString().Trim() -ne '') {
                    $roles += $playerRoles.ToString().Trim()
                }
            }
        }
    }
    
    return $roles
}

Export-ModuleMember -Function @(
    'Initialize-NotificationManager',
    'Send-DiscordNotification',
    'Get-NotificationChannels',
    'Get-NotificationChannel',
    'Get-NotificationRoleMentions',
    'New-NotificationEmbed'
)
