# ===============================================================
# SCUM Server Automation - Live Embeds Manager
# ===============================================================
# Coordinates live Discord embeds for server status and leaderboards
# Manages embed updates, message handling, and display coordination
# ===============================================================

# Standard import of common module
try {
    $helperPath = Join-Path $PSScriptRoot "..\..\..\core\module-helper.psm1"
    if (Test-Path $helperPath) {
        # MEMORY LEAK FIX: Check if module already loaded before importing
        if (-not (Get-Module "module-helper" -ErrorAction SilentlyContinue)) {
            Import-Module $helperPath -ErrorAction SilentlyContinue
        }
        Import-CommonModule | Out-Null
    }
} catch {
    Write-Host "[WARNING] Common module not available for live-embeds-manager module" -ForegroundColor Yellow
}

# Import required modules
$rootPath = Split-Path (Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent) -Parent

# MEMORY LEAK FIX: Conditional imports instead of -Force
if (-not (Get-Module "server-status-embed" -ErrorAction SilentlyContinue)) {
    Import-Module (Join-Path $PSScriptRoot "server-status-embed.psm1") -Global
}
if (-not (Get-Module "leaderboards-embed" -ErrorAction SilentlyContinue)) {
    Import-Module (Join-Path $PSScriptRoot "leaderboards-embed.psm1") -Global -ErrorAction SilentlyContinue
}

# Global state
$script:LiveEmbedsInitialized = $false
$script:MultipleLeaderboardsEmbeds = @{}
$script:DiscordConfig = $null

# ===============================================================
# INITIALIZATION
# ===============================================================

function Initialize-LiveEmbeds {
    <#
    .SYNOPSIS
    Initialize both server status and leaderboards embeds
    #>
    param(
        [Parameter(Mandatory=$true)]
        [hashtable]$Config
    )
    
    try {
        # Store Discord config for later use
        $script:DiscordConfig = $Config.Discord
        
        $results = @()
        
        # Initialize Server Status Embed
        $serverStatusOk = Initialize-ServerStatusEmbed -Config $Config
        $results += $serverStatusOk
        
        # Initialize New Leaderboards System (19 categories, weekly + all-time)
        if ($Config.Discord.LiveEmbeds.LeaderboardsChannel) {
            # Import the new leaderboards embed module
            $leaderboardsModulePath = Join-Path $PSScriptRoot "leaderboards-embed.psm1"
            if (Test-Path $leaderboardsModulePath) {
                # MEMORY LEAK FIX: Conditional import instead of -Force
                if (-not (Get-Module "leaderboards-embed" -ErrorAction SilentlyContinue)) {
                    Import-Module $leaderboardsModulePath -Global
                }
                
                if (Get-Command "Initialize-LeaderboardsEmbed" -ErrorAction SilentlyContinue) {
                    $leaderboardsOk = Initialize-LeaderboardsEmbed -Config $Config
                    $results += $leaderboardsOk
                    # Note: Detailed initialization messages are handled by leaderboards-embed.psm1
                } else {
                    Write-Log "Initialize-LeaderboardsEmbed function not found" -Level Warning
                    $results += $false
                }
            } else {
                Write-Log "Leaderboards embed module not found: $leaderboardsModulePath" -Level Warning
                $results += $false
            }
        } else {
            Write-Verbose "Leaderboards channel not configured"
        }
        
        # Check if at least one embed was initialized
        $script:LiveEmbedsInitialized = ($results -contains $true)
        
        if ($script:LiveEmbedsInitialized) {
            Write-Verbose "Live embeds system initialized successfully"
        } else {
            Write-Log "Failed to initialize any live embeds" -Level Warning
        }
        
        return $script:LiveEmbedsInitialized
        
    } catch {
        Write-Log "Failed to initialize live embeds: $($_.Exception.Message)" -Level Error
        return $false
    }
}

function Initialize-MultipleLeaderboardsEmbeds {
    <#
    .SYNOPSIS
    Initialize multiple category-specific leaderboard embeds
    #>
    param(
        [Parameter(Mandatory=$true)]
        [hashtable]$Config
    )
    
    try {
        Write-Log "Initializing multiple leaderboard embeds..." -Level Info
        
        # Define leaderboard categories and their corresponding functions
        $categories = @{
            'kills' = 'New-KillsLeaderboardEmbed'
            'deaths' = 'New-DeathsLeaderboardEmbed' 
            'playtime' = 'New-PlaytimeLeaderboardEmbed'
            'fame' = 'New-FameLeaderboardEmbed'
            'money' = 'New-MoneyLeaderboardEmbed'
            'events' = 'New-EventsLeaderboardEmbed'
        }
        
        $channelId = $Config.Discord.LiveEmbeds.LeaderboardsChannel
        $token = $Config.Discord.Token
        $successCount = 0
        
        # First, try to find existing embeds in the channel
        $existingEmbeds = Find-ExistingLeaderboardEmbeds -Token $token -ChannelId $channelId
        
        foreach ($category in $categories.Keys) {
            $functionName = $categories[$category]
            
            # Check if the function exists
            if (-not (Get-Command $functionName -ErrorAction SilentlyContinue)) {
                Write-Log "Function $functionName not found - skipping $category leaderboard" -Level Warning
                continue
            }
            
            try {
                # Check if we found an existing embed for this category
                $existingEmbed = $existingEmbeds | Where-Object { 
                    $_.embeds[0].title -like "*$category*" -or
                    $_.embeds[0].title -like "*$(Get-CategoryDisplayName $category)*"
                }
                
                if ($existingEmbed) {
                    # Use existing embed
                    $script:MultipleLeaderboardsEmbeds[$category] = @{
                        MessageId = $existingEmbed.id
                        ChannelId = $channelId
                        LastUpdate = Get-Date
                        Function = $functionName
                    }
                    Write-Log "Found existing $category leaderboard embed (ID: $($existingEmbed.id))" -Level Info
                    $successCount++
                } else {
                    # Create new embed with current data
                    $embedData = & $functionName
                    if (-not $embedData) {
                        Write-Log "Failed to create embed data for $category" -Level Error
                        continue
                    }
                    
                    # Send the embed to Discord
                    $message = Send-DiscordMessage -Token $token -ChannelId $channelId -Embed $embedData
                    if ($message -and $message.id) {
                        $script:MultipleLeaderboardsEmbeds[$category] = @{
                            MessageId = $message.id
                            ChannelId = $channelId
                            LastUpdate = Get-Date
                            Function = $functionName
                        }
                        Write-Log "Created $category leaderboard embed (ID: $($message.id))" -Level Info
                        $successCount++
                    } else {
                        Write-Log "Failed to send $category leaderboard embed to Discord" -Level Error
                    }
                }
                
                # Delay between operations to avoid rate limiting
                Start-Sleep -Milliseconds 1000
                
            } catch {
                Write-Log "Failed to create $category leaderboard embed: $($_.Exception.Message)" -Level Error
            }
        }
        
        Write-Log "Successfully initialized $successCount leaderboard embeds" -Level Info
        return ($successCount -gt 0)
        
    } catch {
        Write-Log "Failed to initialize multiple leaderboard embeds: $($_.Exception.Message)" -Level Error
        return $false
    }
}

# ===============================================================
# EMBED UPDATES
# ===============================================================

function Update-LiveServerStatus {
    <#
    .SYNOPSIS
    Update live server status embed
    #>
    param(
        [hashtable]$ServerStatus = @{}
    )
    
    if (-not $script:LiveEmbedsInitialized) {
        Write-Verbose "Live embeds not initialized"
        return
    }
    
    Update-ServerStatusEmbed -ServerStatus $ServerStatus | Out-Null
}

function Update-LiveLeaderboards {
    <#
    .SYNOPSIS
    Update live leaderboards embeds (New leaderboard system)
    #>
    param(
        [hashtable]$LeaderboardData = @{}
    )
    
    if (-not $script:LiveEmbedsInitialized) {
        Write-Verbose "Live embeds not initialized"
        return
    }
    
    # Call the new leaderboard system
    if (Get-Command "Update-LeaderboardsEmbed" -ErrorAction SilentlyContinue) {
        Write-Verbose "Updating new leaderboards system (19 categories)"
        Update-LeaderboardsEmbed
    } else {
        Write-Log "Update-LeaderboardsEmbed function not available" -Level Warning
    }
}

function Update-MultipleLeaderboardsEmbeds {
    <#
    .SYNOPSIS
    Update all multiple leaderboard embeds
    #>
    param(
        [hashtable]$LeaderboardData = @{}
    )
    
    try {
        if ($script:MultipleLeaderboardsEmbeds.Count -eq 0) {
            Write-Verbose "No multiple leaderboard embeds to update"
            return $false
        }
        
        $updateCount = 0
        
        foreach ($category in $script:MultipleLeaderboardsEmbeds.Keys) {
            $embedInfo = $script:MultipleLeaderboardsEmbeds[$category]
            $functionName = $embedInfo.Function
            
            try {
                # Create updated embed data
                $embedData = & $functionName
                if (-not $embedData) {
                    Write-Log "Failed to create updated embed data for $category" -Level Error
                    continue
                }
                
                # Update the embed in Discord
                if (-not $script:DiscordConfig -or -not $script:DiscordConfig.Token) {
                    Write-Log "Discord config or token not available for updating $category embed" -Level Warning
                    continue
                }
                
                $updated = Update-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $embedInfo.ChannelId -MessageId $embedInfo.MessageId -Embed $embedData
                if ($updated) {
                    $script:MultipleLeaderboardsEmbeds[$category].LastUpdate = Get-Date
                    $updateCount++
                    Write-Verbose "Updated $category leaderboard embed"
                } else {
                    Write-Log "Failed to update $category leaderboard embed" -Level Error
                }
                
                # Delay between updates to avoid rate limiting
                Start-Sleep -Milliseconds 1000
                
            } catch {
                Write-Log "Failed to update $category leaderboard embed: $($_.Exception.Message)" -Level Error
            }
        }
        
        Write-Verbose "Updated $updateCount leaderboard embeds"
        return ($updateCount -gt 0)
        
    } catch {
        Write-Log "Failed to update multiple leaderboard embeds: $($_.Exception.Message)" -Level Error
        return $false
    }
}

function Test-ServerStatusEmbed {
    <#
    .SYNOPSIS
    Test server status embed creation
    #>
    param(
        [hashtable]$ServerStatus = @{}
    )
    
    return New-ServerStatusEmbed -ServerStatus $ServerStatus
}

function Test-LeaderboardsEmbed {
    <#
    .SYNOPSIS
    Test leaderboards embed creation
    #>
    param(
        [hashtable]$LeaderboardData = @{}
    )
    
    return New-LeaderboardsEmbed -LeaderboardData $LeaderboardData
}

function Find-ExistingLeaderboardEmbeds {
    <#
    .SYNOPSIS
    Find all existing leaderboard embeds in channel with rate limiting
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$Token,
        
        [Parameter(Mandatory=$true)]
        [string]$ChannelId,
        [int]$MaxRetries = 3
    )
    
    $retryCount = 0
    
    while ($retryCount -lt $MaxRetries) {
        try {
            $headers = @{
                "Authorization" = "Bot $Token"
                "Content-Type" = "application/json"
                "User-Agent" = "SCUM-Server-Manager/1.0"
            }
            
            # Get recent messages from channel (increase limit to find more embeds)
            $uri = "https://discord.com/api/v10/channels/$ChannelId/messages?limit=50"
            $messages = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers
            
            $leaderboardEmbeds = @()
            
            # Look for embeds with leaderboard characteristics
            foreach ($message in $messages) {
                if ($message.embeds -and $message.embeds.Count -gt 0) {
                    $embed = $message.embeds[0]
                    
                    # Check if this is a leaderboard embed
                    if ($embed.title -like "*TOP 20*" -or $embed.title -like "*Leaderboard*" -or
                        $embed.title -like "*Kills*" -or $embed.title -like "*Deaths*" -or
                        $embed.title -like "*Playtime*" -or $embed.title -like "*Fame*" -or
                        $embed.title -like "*Money*" -or $embed.title -like "*Events*") {
                        
                        $leaderboardEmbeds += $message
                        Write-Verbose "Found existing leaderboard embed: $($message.id) - $($embed.title)"
                    }
                }
            }
            
            Write-Verbose "Found $($leaderboardEmbeds.Count) existing leaderboard embeds"
            return $leaderboardEmbeds
            
        } catch {
            $retryCount++
            
            # Check if it's a rate limit error (429)
            if ($_.Exception.Response -and $_.Exception.Response.StatusCode -eq 429) {
                Write-Log "Discord rate limit hit while finding embeds (attempt $retryCount/$MaxRetries), waiting..." -Level Warning
                
                # Extract retry-after from response if available
                $retryAfter = 1
                try {
                    $errorResponse = $_.Exception.Response.GetResponseStream()
                    $reader = New-Object System.IO.StreamReader($errorResponse)
                    $errorContent = $reader.ReadToEnd() | ConvertFrom-Json
                    if ($errorContent.retry_after) {
                        $retryAfter = [Math]::Max($errorContent.retry_after, 1)
                    }
                } catch {
                    # Use default retry time
                }
                
                Start-Sleep -Seconds ($retryAfter + 1)
                continue
            }
            
            # For non-rate-limit errors, return empty array
            Write-Log "Failed to find existing leaderboard embeds: $($_.Exception.Message)" -Level Error
            return @()
        }
    }
    
    Write-Log "Failed to find existing leaderboard embeds after $MaxRetries attempts due to rate limiting" -Level Error
    return @()
}

function Get-CategoryDisplayName {
    <#
    .SYNOPSIS
    Get display name for category
    #>
    param([string]$Category)
    
    switch ($Category.ToLower()) {
        "kills" { return "Kills" }
        "deaths" { return "Deaths" }
        "playtime" { return "Playtime" }
        "fame" { return "Fame" }
        "money" { return "Money" }
        "events" { return "Events" }
        default { return $Category }
    }
}

Export-ModuleMember -Function @(
    'Initialize-LiveEmbeds',
    'Initialize-MultipleLeaderboardsEmbeds',
    'Update-LiveServerStatus',
    'Update-LiveLeaderboards',
    'Update-MultipleLeaderboardsEmbeds',
    'Test-ServerStatusEmbed',
    'Test-LeaderboardsEmbed',
    'Find-ExistingLeaderboardEmbeds',
    'Get-CategoryDisplayName'
)
