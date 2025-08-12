# ===============================================================
# SCUM Server Automation - Server Status Embed
# ===============================================================
# Live-updating Discord embed showing server status and statistics
# Displays player count, performance, and server information
# ===============================================================

using module "..\core\discord-api.psm1"
using module "..\templates\embed-styles.psm1"

# Global variables
$script:ServerStatusEmbed = $null
$script:DiscordConfig = $null
$script:TimezoneOffset = 1  # Default timezone offset (+1 for Central Europe)
$script:LastUpdate = Get-Date
$script:LastKnownState = $null  # Track last known server state for change detection

function Get-RandomServerStatusImageUrl {
    <#
    .SYNOPSIS
    Get the static image URL from configuration for server status
    #>
    
    try {
        if (-not $script:DiscordConfig) {
            return $null
        }
        
        # Check if the config path exists and get the image URL
        if ($script:DiscordConfig.LiveEmbeds -and 
            $script:DiscordConfig.LiveEmbeds.Images -and 
            $script:DiscordConfig.LiveEmbeds.Images.ServerStatus) {
            
            $imageUrl = $script:DiscordConfig.LiveEmbeds.Images.ServerStatus
            
            # Validate that it's a string and a valid image URL
            if ($imageUrl -is [string] -and $imageUrl -match '^https?://.*\.(gif|jpg|jpeg|png|webp|bmp|svg)$') {
                return [string]$imageUrl
            } else {
                return $null
            }
        } else {
            return $null
        }
        
    } catch {
        Write-Log "Failed to get server status image URL: $($_.Exception.Message)" -Level Error
        return $null
    }
}

function Initialize-ServerStatusEmbed {
    <#
    .SYNOPSIS
    Initialize server status embed
    #>
    param(
        [Parameter(Mandatory=$true)]
        [hashtable]$Config
    )
    
    # Store full config for restart times and server info access
    $script:DiscordConfig = $Config.Discord
    if ($Config.restartTimes) {
        $script:DiscordConfig.restartTimes = $Config.restartTimes
    }
    # Store server info for embed display
    if ($Config.publicIP) {
        $script:DiscordConfig.publicIP = $Config.publicIP
    }
    if ($Config.publicPort) {
        $script:DiscordConfig.publicPort = $Config.publicPort
    }
    
    # Store timezone offset (default to +1 if not specified)
    $script:TimezoneOffset = 1  # Default to +1 (Central Europe)
    if ($script:DiscordConfig.LiveEmbeds -and $script:DiscordConfig.LiveEmbeds.TimezoneOffset) {
        try {
            $offsetStr = $script:DiscordConfig.LiveEmbeds.TimezoneOffset.ToString()
            if ($offsetStr -match '^[+-]?\d+$') {
                $script:TimezoneOffset = [int]$offsetStr
                Write-Log "Timezone offset set to: $($script:TimezoneOffset)" -Level "Debug"
            } else {
                Write-Log "Invalid timezone offset format '$offsetStr', using default +1" -Level "Warning"
            }
        } catch {
            Write-Log "Failed to parse timezone offset, using default +1: $($_.Exception.Message)" -Level "Warning"
        }
    }
    
    if (-not $script:DiscordConfig.LiveEmbeds -or -not $script:DiscordConfig.LiveEmbeds.StatusChannel) {
        Write-Log "Server status embed not configured" -Level "Debug"
        return $false
    }
    
    try {
        # Check if embed already exists in memory
        if ($script:ServerStatusEmbed -and $script:ServerStatusEmbed.MessageId) {
            Write-Log "Server status embed already exists (ID: $($script:ServerStatusEmbed.MessageId))" -Level "Info"
            return $true
        }
        
        # Try to find existing embed in channel
        $existingEmbed = Find-ExistingServerStatusEmbed -Token $script:DiscordConfig.Token -ChannelId $script:DiscordConfig.LiveEmbeds.StatusChannel
        
        if ($existingEmbed) {
            Write-Log "Found existing server status embed (ID: $($existingEmbed.id))" -Level "Info"
            $script:ServerStatusEmbed = @{
                ChannelId = $script:DiscordConfig.LiveEmbeds.StatusChannel
                MessageId = $existingEmbed.id
                LastUpdate = Get-Date
            }
            return $true
        }
        
        # Create new embed if none found
        Write-Log "Creating new server status embed..." -Level "Info"
        $embed = New-ServerStatusEmbed
        $message = Send-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:DiscordConfig.LiveEmbeds.StatusChannel -Embed $embed
        
        if ($message) {
            $script:ServerStatusEmbed = @{
                ChannelId = $script:DiscordConfig.LiveEmbeds.StatusChannel
                MessageId = $message.id
                LastUpdate = Get-Date
            }
            Write-Log "âś… Server status embed created: $($message.id)" -Level "Info"
            return $true
        }
        
        return $false
        
    } catch {
        Write-Log "Failed to initialize server status embed: $($_.Exception.Message)" -Level Error
        return $false
    }
}

function Update-ServerStatusEmbed {
    <#
    .SYNOPSIS
    Update server status embed with current server information
    #>
    param(
        [hashtable]$ServerStatus = @{}
    )
    
    try {
        if (-not $script:ServerStatusEmbed) {
            Write-Log "Server status embed not initialized" -Level "Debug"
            return
        }
        
        # Restore reasonable update interval to prevent Discord rate limiting
        $updateInterval = if ($script:DiscordConfig.LiveEmbeds.UpdateInterval) { $script:DiscordConfig.LiveEmbeds.UpdateInterval } else { 15 }
        $timeSinceUpdate = (Get-Date) - $script:LastUpdate
        
        # Allow immediate update if server state changed, otherwise respect interval
        $forceUpdate = $false
        if ($ServerStatus.ActualServerState -in @("Online", "Offline", "ShuttingDown")) {
            # Check if this is a significant state change
            if (-not $script:LastKnownState -or $script:LastKnownState -ne $ServerStatus.ActualServerState) {
                $forceUpdate = $true
                $script:LastKnownState = $ServerStatus.ActualServerState
                Write-Log "[EMBED] Force updating due to state change: $($ServerStatus.ActualServerState)" -Level "Debug"
            }
        }
        
        # If Force flag is used, reset the update timer to allow immediate update
        if ($Force.IsPresent) {
            $script:LastUpdate = (Get-Date).AddSeconds(-$updateInterval - 1)
            Write-Log "[EMBED] Force flag used - resetting rate limit timer" -Level "Debug"
            $forceUpdate = $true
        }
        
        if (-not $forceUpdate -and $timeSinceUpdate.TotalSeconds -lt $updateInterval) {
            Write-Log "[EMBED] Rate limit active - skipping update (${timeSinceUpdate.TotalSeconds}s < ${updateInterval}s)" -Level "Debug"
            return
        }
        
        # Update embed
        $embed = New-ServerStatusEmbed -ServerStatus $ServerStatus
        
        $result = Update-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:ServerStatusEmbed.ChannelId -MessageId $script:ServerStatusEmbed.MessageId -Embed $embed
        
        if ($result) {
            $script:LastUpdate = Get-Date
            Write-Log "Server status embed updated" -Level "Debug"
        }
        
        # Explicitly return nothing to prevent any output
        return
        
    } catch {
        Write-Log "Failed to update server status embed: $($_.Exception.Message)" -Level Error
    }
}

function New-ServerStatusEmbed {
    <#
    .SYNOPSIS
    Create simplified server status embed with essential information only
    #>
    param(
        [hashtable]$ServerStatus = @{}
    )
    
    # Server basic info - Get fresh data if needed
    if (-not $ServerStatus -or $ServerStatus.Count -eq 0 -or $null -eq $ServerStatus.IsRunning) {
        Write-Log "[EMBED] No ServerStatus data provided, getting fresh data from Get-ServerStatus" -Level "Debug"
        if (Get-Command "Get-ServerStatus" -ErrorAction SilentlyContinue) {
            $ServerStatus = Get-ServerStatus
        }
    }
    
    $isOnline = if ($null -ne $ServerStatus.IsRunning) { $ServerStatus.IsRunning } else { $false }
    
    # Get server IP and port from config first, fallback to ServerStatus
    $serverIP = "N/A"
    
    # Try to load from config file if not available in memory
    if (-not $script:DiscordConfig.publicIP -and (Test-Path "SCUM-Server-Automation.config.json")) {
        try {
            $configContent = Get-Content "SCUM-Server-Automation.config.json" -Raw | ConvertFrom-Json
            if ($configContent.publicIP) {
                $script:DiscordConfig.publicIP = $configContent.publicIP
            }
            if ($configContent.publicPort) {
                $script:DiscordConfig.publicPort = $configContent.publicPort
            }
        } catch {
            Write-Log "Failed to load server IP from config file: $($_.Exception.Message)" -Level "Debug"
        }
    }
    
    # Build server IP string
    if ($script:DiscordConfig.publicIP -and $script:DiscordConfig.publicPort) {
        $serverIP = "$($script:DiscordConfig.publicIP):$($script:DiscordConfig.publicPort)"
    } elseif ($script:DiscordConfig.publicIP) {
        $serverIP = $script:DiscordConfig.publicIP
    } elseif ($ServerStatus.ServerIP -and $ServerStatus.ServerIP -ne "N/A") {
        $serverIP = $ServerStatus.ServerIP
    }
    
    $onlinePlayers = if ($ServerStatus.OnlinePlayers) { $ServerStatus.OnlinePlayers } else { "0" }
    $maxPlayers = if ($ServerStatus.MaxPlayers) { $ServerStatus.MaxPlayers } else { "128" }
    
    # Game info
    $gameTime = if ($ServerStatus.GameTime) { $ServerStatus.GameTime } else { "N/A" }
    $temperature = if ($ServerStatus.Temperature) { $ServerStatus.Temperature } else { "A: N/A C | W: N/A C" }
    
    # Format performance data properly
    $performance = "N/A"
    if ($ServerStatus.Performance) {
        if ($ServerStatus.Performance -is [hashtable]) {
            # Extract FPS from hashtable
            if ($ServerStatus.Performance.FPS -and $ServerStatus.Performance.FPS -gt 0) {
                $performance = "$($ServerStatus.Performance.FPS) FPS"
            } else {
                $performance = "N/A"
            }
        } elseif ($ServerStatus.Performance -is [string] -and $ServerStatus.Performance -ne "N/A") {
            # Already formatted string
            $performance = $ServerStatus.Performance
        }
    }
    
    # Database stats
    $totalPlayers = "N/A"
    $activeSquads = "N/A"
    if ($ServerStatus.DatabaseStats) {
        if ($ServerStatus.DatabaseStats.TotalPlayers) { $totalPlayers = $ServerStatus.DatabaseStats.TotalPlayers }
        if ($ServerStatus.DatabaseStats.ActiveSquads) { $activeSquads = $ServerStatus.DatabaseStats.ActiveSquads }
    }
    
    # Next restart calculation
    $nextRestart = Get-NextRestartTime
    
    # Status indicators
    $statusEmoji = if ($isOnline) { ":green_circle:" } else { ":red_circle:" }
    $statusText = if ($isOnline) { "Online" } else { "Offline" }
    $color = if ($isOnline) { 65280 } else { 15158332 } # Green or Red
    
    # Create simplified fields layout
    $fields = @(
        # Row 1
        @{
            name = ":earth_americas: Status"
            value = "$statusEmoji $statusText"
            inline = $true
        },
        @{
            name = ":round_pushpin: Server"
            value = "``$serverIP``"
            inline = $true
        },
        @{
            name = ":busts_in_silhouette: Online Players"
            value = "$onlinePlayers / $maxPlayers"
            inline = $true
        },
        # Row 2
        @{
            name = ":arrows_counterclockwise: Next Restart"
            value = $nextRestart
            inline = $true
        },
        @{
            name = ":clock8: Game Time"
            value = "$gameTime"
            inline = $true
        },
        @{
            name = ":thermometer: Temperature"
            value = $temperature
            inline = $true
        },
        # Row 3
        @{
            name = ":zap: Performance"
            value = $performance
            inline = $true
        },
        @{
            name = ":bust_in_silhouette: Total Players"
            value = "$totalPlayers"
            inline = $true
        },
        @{
            name = ":triangular_flag_on_post: Active Squads"
            value = "$activeSquads"
            inline = $true
        }
    )
    
    # Create embed
    $footer = @{
        text = "SCUM Server Automation"
        icon_url = "https://playhub.cz/scum/manager/server_automation_discord.png"
    }
    
    $embed = @{
        title = "SCUM Server Status"
        color = $color
        fields = $fields
        footer = $footer
        timestamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    }
    
    # Add random image as main embed image (not footer icon) - only if valid URL found
    $imageUrl = Get-RandomServerStatusImageUrl
    
    if ($imageUrl -and $imageUrl -is [string] -and $imageUrl.Trim() -ne "") {
        $embed.image = @{
            url = $imageUrl.Trim()
        }
    }
    
    return $embed
}

function Get-NextRestartTime {
    <#
    .SYNOPSIS
    Calculate next scheduled restart time with Discord timestamp format
    #>
    
    # Check if next restart will be skipped
    $skipStatus = $false
    try {
        # Import scheduling module to access skip functions - use absolute path
        Write-Log "Attempting to import scheduling module..." -Level "Debug"
        $schedulingModulePath = Join-Path $PSScriptRoot "..\..\automation\scheduling\scheduling.psm1"
        Write-Log "Using scheduling module path: $schedulingModulePath" -Level "Debug"
        
        # Import with Global scope to ensure functions are available
        Import-Module $schedulingModulePath -Force -Global -ErrorAction Stop
        Write-Log "Scheduling module imported successfully" -Level "Debug"
        
        if (Get-Command "Get-RestartSkipStatus" -ErrorAction SilentlyContinue) {
            Write-Log "Get-RestartSkipStatus command found, calling it..." -Level "Debug"
            $skipStatus = Get-RestartSkipStatus
            Write-Log "Skip status checked: $skipStatus" -Level "Debug"
        } else {
            Write-Log "Get-RestartSkipStatus command not found after import" -Level "Debug"
        }
    } catch {
        Write-Log "Could not check restart skip status: $($_.Exception.Message)" -Level "Debug"
        Write-Log "Error details: $($_.Exception.ToString())" -Level "Debug"
    }
    
    # No default fallback times - must load from configuration
    $restartTimes = @()
    
    try {
        # Try multiple sources for restart times, prioritize config file
        $configLoaded = $false
        
        # Source 1: Direct config file (highest priority)
        if (Test-Path "SCUM-Server-Automation.config.json") {
            try {
                $configContent = Get-Content "SCUM-Server-Automation.config.json" -Raw | ConvertFrom-Json
                if ($configContent.restartTimes -and $configContent.restartTimes.Count -gt 0) {
                    $restartTimes = $configContent.restartTimes
                    $configLoaded = $true
                    Write-Log "Loaded restart times from config file: $($restartTimes -join ', ')" -Level "Debug"
                }
            } catch {
                Write-Log "Failed to read config file: $($_.Exception.Message)" -Level "Debug"
            }
        }
        
        # Source 2: Discord config (if file loading failed)
        if (-not $configLoaded -and $script:DiscordConfig -and $script:DiscordConfig.restartTimes) {
            $restartTimes = $script:DiscordConfig.restartTimes
            $configLoaded = $true
            Write-Log "Using restart times from Discord config: $($restartTimes -join ', ')" -Level "Debug"
        }
        
        # Source 3: Global config variable (last resort)
        if (-not $configLoaded -and (Get-Variable -Name "originalConfig" -Scope Global -ErrorAction SilentlyContinue)) {
            $globalConfig = Get-Variable -Name "originalConfig" -Scope Global -ValueOnly
            if ($globalConfig.restartTimes -and $globalConfig.restartTimes.Count -gt 0) {
                $restartTimes = $globalConfig.restartTimes
                $configLoaded = $true
                Write-Log "Using restart times from global config: $($restartTimes -join ', ')" -Level "Debug"
            }
        }
        
    } catch {
        Write-Log "Error loading restart times: $($_.Exception.Message)" -Level "Debug"
    }
    
    $now = Get-Date
    $today = $now.Date
    
    Write-Log "Current time: $($now.ToString('yyyy-MM-dd HH:mm:ss'))" -Level "Debug"
    Write-Log "Available restart times: $($restartTimes -join ', ')" -Level "Debug"
    
    # Convert restart times to string array and validate
    $timeArray = @()
    foreach ($time in $restartTimes) {
        if ($time -and $time.ToString().Trim() -ne "" -and $time.ToString().Trim() -match '^\d{1,2}:\d{2}$') {
            $timeArray += $time.ToString().Trim()
        } else {
            Write-Log "Skipping invalid restart time: '$time'" -Level "Debug"
        }
    }
    
    if ($timeArray.Count -eq 0) {
        Write-Log "No valid restart times found" -Level "Debug"
        return "Not scheduled"
    }
    
    Write-Log "Valid restart times: $($timeArray -join ', ')" -Level "Debug"
    
    # Find next restart time TODAY
    $foundToday = $false
    foreach ($timeStr in $timeArray) {
        try {
            $restartTime = [DateTime]::ParseExact("$($today.ToString('yyyy-MM-dd')) $timeStr", "yyyy-MM-dd HH:mm", $null)
            Write-Log "Checking: $($restartTime.ToString('HH:mm')) vs current: $($now.ToString('HH:mm'))" -Level "Debug"
            
            if ($restartTime -gt $now) {
                Write-Log "Next restart TODAY: $($restartTime.ToString('yyyy-MM-dd HH:mm:ss'))" -Level "Debug"
                
                # If this restart will be skipped, find the next one after it
                if ($skipStatus) {
                    Write-Log "Current restart will be skipped, looking for next restart after $($restartTime.ToString('HH:mm'))" -Level "Debug"
                    
                    # Look for next restart today after the skipped one
                    foreach ($nextTimeStr in $timeArray) {
                        try {
                            $nextRestartTime = [DateTime]::ParseExact("$($today.ToString('yyyy-MM-dd')) $nextTimeStr", "yyyy-MM-dd HH:mm", $null)
                            if ($nextRestartTime -gt $restartTime) {
                                Write-Log "Found next restart today after skip: $($nextRestartTime.ToString('HH:mm'))" -Level "Debug"
                                $utcTime = $nextRestartTime.ToUniversalTime().AddHours(-$script:TimezoneOffset)
                                $unixTimestamp = [int64](($utcTime - (Get-Date "1970-01-01 00:00:00").ToUniversalTime()).TotalSeconds)
                                return "<t:$unixTimestamp`:R>"
                            }
                        } catch {
                            Write-Log "Failed to parse next restart time '$nextTimeStr': $($_.Exception.Message)" -Level "Debug"
                        }
                    }
                    
                    # No more restarts today after the skipped one, use tomorrow's first restart
                    Write-Log "No more restarts today after skipped one, using tomorrow's first restart" -Level "Debug"
                    $sortedTimes = $timeArray | Sort-Object { [DateTime]::ParseExact($_, "HH:mm", $null) }
                    $tomorrow = $today.AddDays(1)
                    $firstRestartTomorrow = [DateTime]::ParseExact("$($tomorrow.ToString('yyyy-MM-dd')) $($sortedTimes[0])", "yyyy-MM-dd HH:mm", $null)
                    $utcTime = $firstRestartTomorrow.ToUniversalTime().AddHours(-$script:TimezoneOffset)
                    $unixTimestamp = [int64](($utcTime - (Get-Date "1970-01-01 00:00:00").ToUniversalTime()).TotalSeconds)
                    return "<t:$unixTimestamp`:R>"
                } else {
                    # Normal case - no skip
                    $utcTime = $restartTime.ToUniversalTime().AddHours(-$script:TimezoneOffset)
                    $unixTimestamp = [int64](($utcTime - (Get-Date "1970-01-01 00:00:00").ToUniversalTime()).TotalSeconds)
                    return "<t:$unixTimestamp`:R>"
                }
            }
        } catch {
            Write-Log "Failed to parse restart time '$timeStr': $($_.Exception.Message)" -Level "Debug"
        }
    }
    
    # If no restart found today, check TOMORROW
    Write-Log "No restart found today, checking tomorrow..." -Level "Debug"
    if ($timeArray.Count -gt 0) {
        try {
            # Sort times to get the earliest one tomorrow
            $sortedTimes = $timeArray | Sort-Object { [DateTime]::ParseExact($_, "HH:mm", $null) }
            $tomorrow = $today.AddDays(1)
            $firstRestartTomorrow = [DateTime]::ParseExact("$($tomorrow.ToString('yyyy-MM-dd')) $($sortedTimes[0])", "yyyy-MM-dd HH:mm", $null)
            
            Write-Log "Next restart TOMORROW: $($firstRestartTomorrow.ToString('yyyy-MM-dd HH:mm:ss'))" -Level "Debug"
            # Convert to Unix timestamp - adjust for Discord timezone interpretation issue
            $utcTime = $firstRestartTomorrow.ToUniversalTime().AddHours(-$script:TimezoneOffset)
            $unixTimestamp = [int64](($utcTime - (Get-Date "1970-01-01 00:00:00").ToUniversalTime()).TotalSeconds)
            
            # Note: Skip status is only for next immediate restart, not tomorrow's
            return "<t:$unixTimestamp`:R>"
        } catch {
            Write-Log "Failed to calculate tomorrow's restart time: $($_.Exception.Message)" -Level "Debug"
        }
    }
    
    # Ultimate fallback
    Write-Log "No valid restart times found for today or tomorrow" -Level "Debug"
    return "Not scheduled"
}

function Reset-ServerStatusEmbed {
    <#
    .SYNOPSIS
    Reset server status embed (force recreation)
    #>
    
    try {
        if ($script:ServerStatusEmbed) {
            Write-Log "Resetting server status embed..." -Level "Info"
            $script:ServerStatusEmbed = $null
            $script:LastUpdate = Get-Date
            Write-Log "âś… Server status embed reset" -Level "Info"
            return $true
        }
        
        Write-Log "No server status embed to reset" -Level "Debug"
        return $false
        
    } catch {
        Write-Log "Failed to reset server status embed: $($_.Exception.Message)" -Level Error
        return $false
    }
}

function Find-ExistingServerStatusEmbed {
    <#
    .SYNOPSIS
    Find existing server status embed in channel
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$Token,
        
        [Parameter(Mandatory=$true)]
        [string]$ChannelId
    )
    
    try {
        $headers = @{
            "Authorization" = "Bot $Token"
            "Content-Type" = "application/json"
            "User-Agent" = "SCUM-Server-Manager/1.0"
        }
        
        # Get recent messages from channel
        $uri = "https://discord.com/api/v10/channels/$ChannelId/messages?limit=20"
        $messages = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers
        
        # Look for embed with server status characteristics
        foreach ($message in $messages) {
            if ($message.embeds -and $message.embeds.Count -gt 0) {
                $embed = $message.embeds[0]
                
                # Check if this is a server status embed
                if ($embed.title -like "*Server Status*" -or 
                    ($embed.fields -and ($embed.fields | Where-Object { $_.name -like "*Status*" })) -or
                    $embed.footer.text -like "*Server Status*") {
                    
                    Write-Log "Found existing server status embed: $($message.id)" -Level "Debug"
                    return $message
                }
            }
        }
        
        Write-Log "No existing server status embed found" -Level "Debug"
        return $null
        
    } catch {
        Write-Log "Failed to find existing server status embed: $($_.Exception.Message)" -Level Error
        return $null
    }
}

Export-ModuleMember -Function @(
    'Initialize-ServerStatusEmbed',
    'Update-ServerStatusEmbed',
    'New-ServerStatusEmbed',
    'Get-NextRestartTime',
    'Reset-ServerStatusEmbed',
    'Find-ExistingServerStatusEmbed',
    'Get-RandomServerStatusImageUrl'
)


