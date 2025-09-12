# ===============================================================
# SCUM Server Automation - Discord Leaderboards
# ===============================================================
# Generates and manages live leaderboard embeds for Discord
# Supports 19 categories with weekly and all-time statistics
# ===============================================================

# Note: Database module must be imported globally before using this module

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
    Write-Host "[WARNING] Common module not available for leaderboards-embed module" -ForegroundColor Yellow
}

# Import required modules
$moduleRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

# MEMORY LEAK FIX: Conditional imports instead of -Force
if (-not (Get-Module "discord-integration" -ErrorAction SilentlyContinue)) {
    Import-Module (Join-Path $moduleRoot "discord-integration.psm1") -Global -ErrorAction SilentlyContinue
}
if (-not (Get-Module "embed-persistence" -ErrorAction SilentlyContinue)) {
    Import-Module (Join-Path $moduleRoot "embed-persistence.psm1") -Global -ErrorAction SilentlyContinue
}

# Global variables
$script:WeeklyEmbed = $null
$script:AllTimeEmbed = $null
$script:DiscordConfig = $null
$script:LastWeeklyUpdate = Get-Date
$script:LastAllTimeUpdate = Get-Date
$script:EmbedStateFile = ".\state\leaderboard-embeds.json"

function Save-EmbedState {
    <#
    .SYNOPSIS
    Save current embed IDs to state file
    #>
    try {
        $stateDir = Split-Path $script:EmbedStateFile -Parent
        if (-not (Test-Path $stateDir)) {
            New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
        }
        
        $state = @{
            WeeklyEmbed = $script:WeeklyEmbed
            AllTimeEmbed = $script:AllTimeEmbed
            LastSaved = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        }
        
        $state | ConvertTo-Json -Depth 3 | Out-File -FilePath $script:EmbedStateFile -Encoding UTF8
        Write-Log "[Leaderboards] Embed state saved" -Level Debug
    } catch {
        Write-Log "[Leaderboards] Failed to save embed state: $($_.Exception.Message)" -Level Warning
    }
}

function Load-EmbedState {
    <#
    .SYNOPSIS
    Load embed IDs from state file
    #>
    try {
        if (Test-Path $script:EmbedStateFile) {
            $state = Get-Content $script:EmbedStateFile | ConvertFrom-Json
            if ($state.WeeklyEmbed) {
                $script:WeeklyEmbed = @{
                    MessageId = $state.WeeklyEmbed.MessageId
                    ChannelId = $state.WeeklyEmbed.ChannelId
                }
            }
            if ($state.AllTimeEmbed) {
                $script:AllTimeEmbed = @{
                    MessageId = $state.AllTimeEmbed.MessageId
                    ChannelId = $state.AllTimeEmbed.ChannelId
                }
            }
            Write-Log "[Leaderboards] Embed state loaded from: $($state.LastSaved)" -Level Debug
        }
    } catch {
        Write-Log "[Leaderboards] Failed to load embed state: $($_.Exception.Message)" -Level Warning
    }
}

function Initialize-LeaderboardsEmbed {
    <#
    .SYNOPSIS
    Initialize both weekly and all-time leaderboard embeds
    #>
    param(
        [Parameter(Mandatory=$true)]
        [hashtable]$Config
    )
    
    $script:DiscordConfig = $Config.Discord
    
    if (-not $script:DiscordConfig.LiveEmbeds -or -not $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel) {
        Write-Log "[WARN] Leaderboards embed not configured properly" -Level Debug
        return $false
    }
    
    try {
        # Initialize persistence system if not already done
        if (Get-Command "Initialize-EmbedPersistence" -ErrorAction SilentlyContinue) {
            Initialize-EmbedPersistence | Out-Null
        }
        
        # Check for weekly reset first
        if (Test-WeeklyResetNeeded) {
            Write-Log "Weekly reset needed - performing reset..." -Level Debug
            Invoke-WeeklyReset
        }
        
        Write-Log "Initializing leaderboard embeds with persistence system..." -Level Debug
        
        # Initialize Weekly Leaderboards Embed
        $weeklyStored = $null
        if (Get-Command "Get-EmbedMessageId" -ErrorAction SilentlyContinue) {
            $weeklyStored = Get-EmbedMessageId -EmbedType "leaderboards-weekly" -ChannelId $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel
        }
        
        if ($weeklyStored) {
            # Verify the message still exists in Discord
            $messageExists = $false
            if (Get-Command "Test-EmbedMessageExists" -ErrorAction SilentlyContinue) {
                $messageExists = Test-EmbedMessageExists -ChannelId $weeklyStored.ChannelId -MessageId $weeklyStored.MessageId
            }
            
            if ($messageExists) {
                $script:WeeklyEmbed = @{
                    ChannelId = $weeklyStored.ChannelId
                    MessageId = $weeklyStored.MessageId
                    LastUpdate = Get-Date
                }
                Write-Log "Using existing weekly leaderboards embed: $($weeklyStored.MessageId)" -Level Debug
            } else {
                Write-Log "Stored weekly message no longer exists, will create new one" -Level Warning
                if (Get-Command "Remove-EmbedMessageId" -ErrorAction SilentlyContinue) {
                    Remove-EmbedMessageId -EmbedType "leaderboards-weekly" -ChannelId $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel
                }
            }
        }
        
        # Create weekly embed if none found
        if (-not $script:WeeklyEmbed) {
            Write-Log "Creating new weekly leaderboards embed..." -Level Debug
            $weeklyEmbedData = New-WeeklyLeaderboardsEmbed
            $weeklyMessage = Send-DiscordMessage -ChannelId $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel -Embeds @($weeklyEmbedData)
            
            if ($weeklyMessage -and $weeklyMessage.Success) {
                $script:WeeklyEmbed = @{
                    ChannelId = $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel
                    MessageId = $weeklyMessage.MessageId
                    LastUpdate = Get-Date
                }
                
                # Store the new message ID in persistence
                if (Get-Command "Set-EmbedMessageId" -ErrorAction SilentlyContinue) {
                    Set-EmbedMessageId -EmbedType "leaderboards-weekly" -MessageId $weeklyMessage.MessageId -ChannelId $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel
                }
                
                Write-Log "Weekly leaderboards embed created: $($weeklyMessage.MessageId)" -Level Debug
            }
        }
        
        # Initialize All-Time Leaderboards Embed
        $allTimeStored = $null
        if (Get-Command "Get-EmbedMessageId" -ErrorAction SilentlyContinue) {
            $allTimeStored = Get-EmbedMessageId -EmbedType "leaderboards-alltime" -ChannelId $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel
        }
        
        if ($allTimeStored) {
            # Verify the message still exists in Discord
            $messageExists = $false
            if (Get-Command "Test-EmbedMessageExists" -ErrorAction SilentlyContinue) {
                $messageExists = Test-EmbedMessageExists -ChannelId $allTimeStored.ChannelId -MessageId $allTimeStored.MessageId
            }
            
            if ($messageExists) {
                $script:AllTimeEmbed = @{
                    ChannelId = $allTimeStored.ChannelId
                    MessageId = $allTimeStored.MessageId
                    LastUpdate = Get-Date
                }
                Write-Log "Using existing all-time leaderboards embed: $($allTimeStored.MessageId)" -Level Debug
            } else {
                Write-Log "Stored all-time message no longer exists, will create new one" -Level Warning
                if (Get-Command "Remove-EmbedMessageId" -ErrorAction SilentlyContinue) {
                    Remove-EmbedMessageId -EmbedType "leaderboards-alltime" -ChannelId $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel
                }
            }
        }
        
        # Create all-time embed if none found
        if (-not $script:AllTimeEmbed) {
            Write-Log "Creating new all-time leaderboards embed..." -Level Debug
            $allTimeEmbedData = New-AllTimeLeaderboardsEmbed
            $allTimeMessage = Send-DiscordMessage -ChannelId $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel -Embeds @($allTimeEmbedData)
            
            if ($allTimeMessage -and $allTimeMessage.Success) {
                $script:AllTimeEmbed = @{
                    ChannelId = $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel
                    MessageId = $allTimeMessage.MessageId
                    LastUpdate = Get-Date
                }
                
                # Store the new message ID in persistence
                if (Get-Command "Set-EmbedMessageId" -ErrorAction SilentlyContinue) {
                    Set-EmbedMessageId -EmbedType "leaderboards-alltime" -MessageId $allTimeMessage.MessageId -ChannelId $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel
                }
                
                Write-Log "All-time leaderboards embed created: $($allTimeMessage.MessageId)" -Level Debug
            }
        }
        
        # Always return success - embeds will be created/updated during monitoring
        Write-Log "[OK] Leaderboard system initialized successfully" -Level Debug        
        return $true
        
    } catch {
        Write-Log "Failed to initialize leaderboards embeds: $($_.Exception.Message)" -Level Error
        return $false
    }
}

function Initialize-WeeklyEmbed {
    <#
    .SYNOPSIS
    Initialize the weekly leaderboards embed
    #>
    
    try {
        # Check if embed already exists in memory
        if ($script:WeeklyEmbed -and $script:WeeklyEmbed.MessageId) {
            Write-Log "Weekly leaderboards embed already exists (ID: $($script:WeeklyEmbed.MessageId))" -Level Debug
            return $true
        }
        
        # Try to find existing embed in channel
        $existingEmbed = Find-ExistingEmbed -Token $script:DiscordConfig.Token -ChannelId $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel -EmbedType "Weekly"
        
        if ($existingEmbed) {
            Write-Log "Found existing weekly leaderboards embed (ID: $($existingEmbed.id))" -Level Debug
            $script:WeeklyEmbed = @{
                ChannelId = $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel
                MessageId = $existingEmbed.id
                LastUpdate = Get-Date
            }
            return $true
        }
        
        # Create new weekly embed
        Write-Log "Creating new weekly leaderboards embed..." -Level Debug
        $embed = New-WeeklyLeaderboardsEmbed
        
        if (-not $embed) {
            Write-Log "Failed to create weekly leaderboard embed" -Level Error
            return $false
        }
        
        # Check embed size before sending
        $embedJson = $embed | ConvertTo-Json -Depth 10
        
        if ($embedJson.Length -gt 6000) {
            Write-Log "Weekly embed too large: $($embedJson.Length) characters" -Level Warning
            return $false
        }
        
        $message = Send-DiscordMessage -ChannelId $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel -Embeds @($embed)
        
        if ($message -and $message.Success) {
            $script:WeeklyEmbed = @{
                ChannelId = $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel
                MessageId = $message.MessageId
                LastUpdate = Get-Date
            }
            Write-Log "Weekly leaderboards embed created: $($message.MessageId)" -Level Debug
            Save-EmbedState  # Save state after creating new embed
            return $true
        }
        
        return $false
        
    } catch {
        Write-Log "Failed to initialize weekly embed: $($_.Exception.Message)" -Level Error
        return $false
    }
}

function Initialize-AllTimeEmbed {
    <#
    .SYNOPSIS
    Initialize the all-time leaderboards embed
    #>
    
    try {
        # Try to find existing embed in channel
        $existingEmbed = Find-ExistingEmbed -Token $script:DiscordConfig.Token -ChannelId $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel -EmbedType "All-Time"
        
        if ($existingEmbed) {
            Write-Log "Found existing all-time leaderboards embed (ID: $($existingEmbed.id))" -Level Debug
            $script:AllTimeEmbed = @{
                ChannelId = $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel
                MessageId = $existingEmbed.id
                LastUpdate = Get-Date
            }
            return $true
        }
        
        # Create new all-time embed
        Write-Log "Creating new all-time leaderboards embed..." -Level Debug
        
        # Add small delay to avoid rate limiting
        Start-Sleep -Seconds 2
        
        $embed = New-AllTimeLeaderboardsEmbed
        
        if (-not $embed) {
            Write-Log "Failed to create all-time embed data" -Level Error
            return $false
        }
        
        # Check embed size before sending
        $embedJson = $embed | ConvertTo-Json -Depth 10
        
        if ($embedJson.Length -gt 6000) {
            Write-Log "All-time embed too large: $($embedJson.Length) characters" -Level Warning
            return $false
        }
        
        $message = Send-DiscordMessage -ChannelId $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel -Embeds @($embed)
        
        if ($message -and $message.Success) {
            $script:AllTimeEmbed = @{
                ChannelId = $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel
                MessageId = $message.MessageId
                LastUpdate = Get-Date
            }
            Write-Log "All-time leaderboards embed created: $($message.MessageId)" -Level Debug
            Save-EmbedState  # Save state after creating new embed
            return $true
        }
        
        Write-Log "Send-DiscordMessage returned null for all-time embed" -Level Warning
        return $false
        
    } catch {
        Write-Log "Failed to initialize all-time embed: $($_.Exception.Message)" -Level Error
        return $false
    }
}

function Update-LeaderboardsEmbed {
    <#
    .SYNOPSIS
    Update both weekly and all-time leaderboard embeds (time-based, deprecated)
    .DESCRIPTION
    This function is now deprecated for time-based updates.
    Use Update-LeaderboardsOnRestart for restart-based updates instead.
    #>
    
    Write-Log "[Leaderboards] Time-based updates disabled - use Update-LeaderboardsOnRestart for restart-based updates" -Level Debug
    
    # Only create missing embeds if needed, but don't update based on time
    try {
        # Create missing embeds if needed
        if (-not $script:WeeklyEmbed -or -not $script:WeeklyEmbed.MessageId) {
            Write-Log "Creating missing weekly leaderboard embed..." -Level Debug
            Initialize-WeeklyEmbed
        }
        
        if (-not $script:AllTimeEmbed -or -not $script:AllTimeEmbed.MessageId) {
            Write-Log "Creating missing all-time leaderboard embed..." -Level Debug
            Initialize-AllTimeEmbed
        }
        
    } catch {
        Write-Log "Failed to initialize missing leaderboards embeds: $($_.Exception.Message)" -Level Error
    }
}

function Update-LeaderboardsOnRestart {
    <#
    .SYNOPSIS
    Update both weekly and all-time leaderboard embeds on server restart
    .DESCRIPTION
    This function updates leaderboards when called explicitly during server restarts,
    ensuring fresh data is displayed since database updates only happen during restarts.
    #>
    
    try {
        Write-Log "[Leaderboards] Updating leaderboards after server restart..." -Level Debug
        
        # Check for weekly reset first
        if (Test-WeeklyResetNeeded) {
            Write-Log "Weekly reset needed - performing reset..." -Level Debug
            Invoke-WeeklyReset
        }
        
        # Create missing embeds if needed
        if (-not $script:WeeklyEmbed -or -not $script:WeeklyEmbed.MessageId) {
            Write-Log "Creating missing weekly leaderboard embed..." -Level Debug
            Initialize-WeeklyEmbed
        }
        
        if (-not $script:AllTimeEmbed -or -not $script:AllTimeEmbed.MessageId) {
            Write-Log "Creating missing all-time leaderboard embed..." -Level Debug
            Initialize-AllTimeEmbed
        }
        
        # Force update both embeds (ignore time intervals)
        Write-Log "[Leaderboards] Force updating weekly embed..." -Level Debug
        Update-WeeklyEmbed
        
        # Small delay between updates to avoid Discord rate limiting
        Start-Sleep -Seconds 2
        
        Write-Log "[Leaderboards] Force updating all-time embed..." -Level Debug
        Update-AllTimeEmbed
        
        Write-Log "[Leaderboards] Leaderboard update completed successfully" -Level Debug
        
    } catch {
        Write-Log "Failed to update leaderboards embeds on restart: $($_.Exception.Message)" -Level Error
    }
}

function Update-WeeklyEmbed {
    <#
    .SYNOPSIS
    Update the weekly leaderboards embed
    #>
    
    try {
        if (-not $script:WeeklyEmbed -or -not $script:WeeklyEmbed.MessageId) {
            Write-Log "Weekly embed not initialized, creating new one..." -Level Debug
            Initialize-WeeklyEmbed
            return
        }
        
        $embed = New-WeeklyLeaderboardsEmbed
        
        if (-not $embed) {
            Write-Log "Failed to create weekly leaderboard embed" -Level Error
            return
        }
        
        $result = $null
        try {
            $result = Update-DiscordMessage -ChannelId $script:WeeklyEmbed.ChannelId -MessageId $script:WeeklyEmbed.MessageId -Embeds @($embed) -ErrorAction SilentlyContinue
        } catch {
            # Ignore 404 errors, they're expected when embeds don't exist
            $result = $null
        }
        
        if ($result -and $result.Success) {
            $script:LastWeeklyUpdate = Get-Date
            Write-Log "Weekly leaderboards embed updated" -Level Debug
        } else {
            # Message might not exist (404), try to create new one
            Write-Log "Creating new weekly embed (previous not found)" -Level Debug
            $script:WeeklyEmbed = $null
            $initResult = Initialize-WeeklyEmbed
            if ($initResult) {
                Save-EmbedState  # Save new embed state
                Write-Log "New weekly embed created" -Level Debug
            }
        }
        
    } catch {
        Write-Log "Failed to update weekly embed: $($_.Exception.Message)" -Level Error
        # Try to create new embed if update failed
        Write-Log "Creating new weekly embed after error" -Level Debug
        $script:WeeklyEmbed = $null
        $initResult = Initialize-WeeklyEmbed
        if ($initResult) {
            Save-EmbedState  # Save new embed state
            Write-Log "New weekly embed created after error recovery" -Level Debug
        }
    }
}

function Update-AllTimeEmbed {
    <#
    .SYNOPSIS
    Update the all-time leaderboards embed
    #>
    
    try {
        if (-not $script:AllTimeEmbed -or -not $script:AllTimeEmbed.MessageId) {
            Write-Log "All-time embed not initialized, creating new one..." -Level Debug
            Initialize-AllTimeEmbed
            return
        }
        
        $embed = New-AllTimeLeaderboardsEmbed
        
        if (-not $embed) {
            Write-Log "Failed to create all-time leaderboard embed" -Level Error
            return
        }
        
        $result = $null
        try {
            $result = Update-DiscordMessage -ChannelId $script:AllTimeEmbed.ChannelId -MessageId $script:AllTimeEmbed.MessageId -Embeds @($embed) -ErrorAction SilentlyContinue
        } catch {
            # Ignore 404 errors, they're expected when embeds don't exist
            $result = $null
        }
        
        if ($result -and $result.Success) {
            $script:LastAllTimeUpdate = Get-Date
            Write-Log "All-time leaderboards embed updated" -Level Debug
        } else {
            # Message might not exist (404), try to create new one
            Write-Log "Creating new all-time embed (previous not found)" -Level Debug
            $script:AllTimeEmbed = $null
            $initResult = Initialize-AllTimeEmbed
            if ($initResult) {
                Save-EmbedState  # Save new embed state
                Write-Log "New all-time embed created" -Level Debug
            }
        }
        
    } catch {
        Write-Log "Failed to update all-time embed: $($_.Exception.Message)" -Level Error
        # Try to create new embed if update failed
        Write-Log "Creating new all-time embed after error" -Level Debug
        $script:AllTimeEmbed = $null
        $initResult = Initialize-AllTimeEmbed
        if ($initResult) {
            Save-EmbedState  # Save new embed state
            Write-Log "New all-time embed created after error recovery" -Level Debug
        }
    }
}

function Get-RandomImageUrl {
    <#
    .SYNOPSIS
    Get a random image URL from configuration for the specified type
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$Type  # "Weekly" or "AllTime"
    )
    
    try {
        if (-not $script:DiscordConfig) {
            return $null
        }
        
        # Try direct regex extraction from JSON as robust fallback
        try {
            $configJson = $script:DiscordConfig | ConvertTo-Json -Depth 10
            $pattern = '"' + $Type + '"\s*:\s*\[(.*?)\]'
            $match = [regex]::Match($configJson, $pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
            
            if ($match.Success) {
                # Support all common image formats
                $urlPattern = '"(https://[^"]*\.(gif|jpg|jpeg|png|webp))"'
                $urlMatches = [regex]::Matches($match.Groups[1].Value, $urlPattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
                
                if ($urlMatches.Count -gt 0) {
                    $urls = @()
                    foreach ($urlMatch in $urlMatches) {
                        $url = $urlMatch.Groups[1].Value
                        $urls += $url
                    }
                    
                    $randomIndex = Get-Random -Minimum 0 -Maximum $urls.Count
                    $selectedUrl = $urls[$randomIndex]
                    return [string]$selectedUrl
                }
            }
        } catch {
            # Silently continue to fallback approach
        }
        
        # Fallback to original hashtable approach
        if (-not $script:DiscordConfig.LiveEmbeds -or -not $script:DiscordConfig.LiveEmbeds.Images -or -not $script:DiscordConfig.LiveEmbeds.Images.Leaderboards) {
            return $null
        } else {
            $imageArray = $null
            if ($Type -eq "Weekly") {
                $imageArray = $script:DiscordConfig.LiveEmbeds.Images.Leaderboards.Weekly
            } elseif ($Type -eq "AllTime") {
                $imageArray = $script:DiscordConfig.LiveEmbeds.Images.Leaderboards.AllTime
            }
            
            if ($imageArray) {
                # Handle case where JSON single element becomes string instead of array
                if ($imageArray -is [string]) {
                    # Validate it's an image URL
                    if ($imageArray -match '^https?://.*\.(gif|jpg|jpeg|png|webp)$') {
                        return [string]$imageArray
                    }
                } elseif ($imageArray.Count -gt 0) {
                    # Try to extract valid image URLs
                    $validUrls = @()
                    for ($i = 0; $i -lt $imageArray.Count; $i++) {
                        $item = $imageArray[$i]
                        # Support all common image formats
                        if ($item -is [string] -and $item -match '^https?://.*\.(gif|jpg|jpeg|png|webp)$') {
                            $validUrls += $item
                        }
                    }
                    
                    if ($validUrls.Count -gt 0) {
                        $randomIndex = Get-Random -Minimum 0 -Maximum $validUrls.Count
                        $selectedUrl = $validUrls[$randomIndex]
                        return [string]$selectedUrl
                    }
                }
            }
        }
        
        # No fallback URLs - if configuration fails, return null (no image)
        return $null
        
    } catch {
        Write-Log "Failed to get random $Type image URL: $($_.Exception.Message)" -Level Error
        return $null
    }
}

function New-WeeklyLeaderboardsEmbed {
    <#
    .SYNOPSIS
    Create weekly leaderboards embed with top 10 players per category
    #>
    
    try {
        # MEMORY LEAK FIX: Use ArrayList instead of array += operations
        $fields = New-Object System.Collections.ArrayList
        
        # Get weekly leaderboard data for 12 categories in 2 columns
        $null = $fields.Add((Format-LeaderboardField -Title ":busts_in_silhouette: TOP SQUADS" -Data (Get-WeeklyLeaderboard -Category "squads" -Limit 5) -Inline $false))
        $null = $fields.Add((Format-LeaderboardField -Title ":stopwatch: TOP SURVIVORS" -Data (Get-WeeklyLeaderboard -Category "minutes_survived" -Limit 5) -Inline $false))
        $null = $fields.Add((Format-LeaderboardField -Title ":star: TOP FAME POINTS" -Data (Get-WeeklyLeaderboard -Category "fame" -Limit 5) -Inline $false))
        $null = $fields.Add((Format-LeaderboardField -Title ":moneybag: TOP MONEY" -Data (Get-WeeklyLeaderboard -Category "money" -Limit 5) -Inline $false))
        $null = $fields.Add((Format-LeaderboardField -Title ":zombie: TOP PUPPET KILLERS" -Data (Get-WeeklyLeaderboard -Category "puppet_kills" -Limit 5) -Inline $false))
        $null = $fields.Add((Format-LeaderboardField -Title ":deer: TOP ANIMAL HUNTERS" -Data (Get-WeeklyLeaderboard -Category "animal_kills" -Limit 5) -Inline $false))
        $null = $fields.Add((Format-LeaderboardField -Title ":crossed_swords: TOP MELEE WARRIORS" -Data (Get-WeeklyLeaderboard -Category "melee_kills" -Limit 5) -Inline $false))
        $null = $fields.Add((Format-LeaderboardField -Title ":bow_and_arrow: TOP ARCHERS" -Data (Get-WeeklyLeaderboard -Category "archery_kills" -Limit 5) -Inline $false))
        $null = $fields.Add((Format-LeaderboardField -Title ":gun: TOP SNIPER" -Data (Get-WeeklyLeaderboard -Category "longest_kill_distance" -Limit 5) -Inline $false))
        $null = $fields.Add((Format-LeaderboardField -Title ":dart: TOP HEADSHOT MASTERS" -Data (Get-WeeklyLeaderboard -Category "headshots" -Limit 5) -Inline $false))
        $null = $fields.Add((Format-LeaderboardField -Title ":unlock: TOP LOCKPICKERS" -Data (Get-WeeklyLeaderboard -Category "locks_picked" -Limit 5) -Inline $false))
        $null = $fields.Add((Format-LeaderboardField -Title ":package: TOP LOOTERS" -Data (Get-WeeklyLeaderboard -Category "containers_looted" -Limit 5) -Inline $false))
        
        $weekStart = (Get-Date).AddDays(-(Get-Date).DayOfWeek.value__+1)
        $weekEnd = $weekStart.AddDays(6)
        
        $footer = @{
            text = "SCUM Server Automation - Weekly server statistics"
            icon_url = "https://playhub.cz/scum/manager/server_automation_discord.png"
        }
        
        $embed = @{
            title = ":chart_with_upwards_trend: Weekly Leaderboards"
            description = "**:calendar: Week** ($($weekStart.ToString('dd.MM.yyyy')) - $($weekEnd.ToString('dd.MM.yyyy')))`n:arrows_counterclockwise: Updated every server restart`n:information_source: Weekly stats reset every Monday"
            color = 3447003 # Blue
            fields = $fields
            footer = $footer
            timestamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        }
        
        # Add random image as main embed image (not footer icon)
        $imageUrl = Get-RandomImageUrl -Type "Weekly"
        if ($imageUrl -and $imageUrl -is [string] -and $imageUrl.Trim() -ne "") {
            $embed.image = @{
                url = $imageUrl.ToString()
            }
        }
        
        return $embed
        
    } catch {
        Write-Log "Failed to create weekly leaderboards embed: $($_.Exception.Message)" -Level Error
        return $null
    }
}

function New-AllTimeLeaderboardsEmbed {
    <#
    .SYNOPSIS
    Create all-time leaderboards embed with top 10 players per category
    #>
    
    try {
        # MEMORY LEAK FIX: Use ArrayList instead of array += operations
        $fields = New-Object System.Collections.ArrayList
        
        # Get all-time leaderboard data for 12 categories in 2 columns
        $null = $fields.Add((Format-LeaderboardField -Title ":busts_in_silhouette: TOP SQUADS" -Data (Get-TopSquads -Limit 5) -Inline $false))
        $null = $fields.Add((Format-LeaderboardField -Title ":stopwatch: TOP SURVIVORS" -Data (Get-TopSurvivors -Limit 5) -Inline $false))
        $null = $fields.Add((Format-LeaderboardField -Title ":star: TOP FAME POINTS" -Data (Get-TopFame -Limit 5) -Inline $false))
        $null = $fields.Add((Format-LeaderboardField -Title ":moneybag: TOP MONEY" -Data (Get-TopMoney -Limit 5) -Inline $false))
        $null = $fields.Add((Format-LeaderboardField -Title ":zombie: TOP PUPPET KILLERS" -Data (Get-TopPuppetKills -Limit 5) -Inline $false))
        $null = $fields.Add((Format-LeaderboardField -Title ":deer: TOP ANIMAL HUNTERS" -Data (Get-TopAnimalKills -Limit 5) -Inline $false))
        $null = $fields.Add((Format-LeaderboardField -Title ":crossed_swords: TOP MELEE WARRIORS" -Data (Get-TopMeleeWarriors -Limit 5) -Inline $false))
        $null = $fields.Add((Format-LeaderboardField -Title ":bow_and_arrow: TOP ARCHERS" -Data (Get-TopArchers -Limit 5) -Inline $false))
        $null = $fields.Add((Format-LeaderboardField -Title ":gun: TOP SNIPER" -Data (Get-TopSniper -Limit 5) -Inline $false))
        $null = $fields.Add((Format-LeaderboardField -Title ":dart: TOP HEADSHOT MASTERS" -Data (Get-TopHeadshots -Limit 5) -Inline $false))
        $null = $fields.Add((Format-LeaderboardField -Title ":unlock: TOP LOCKPICKERS" -Data (Get-TopLockpickers -Limit 5) -Inline $false))
        $null = $fields.Add((Format-LeaderboardField -Title ":package: TOP LOOTERS" -Data (Get-TopLooters -Limit 5) -Inline $false))
        
        $footer = @{
            text = "SCUM Server Automation - All-time server statistics"
            icon_url = "https://playhub.cz/scum/manager/server_automation_discord.png"
        }
        
        $embed = @{
            title = ":trophy: All-Time Leaderboards"
            description = "**Hall of Fame - Server Legends**`n:arrows_counterclockwise: Updated every server restart"
            color = 16766720 # Gold
            fields = $fields
            footer = $footer
            timestamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        }
        
        # Add random image as main embed image (not footer icon)
        $imageUrl = Get-RandomImageUrl -Type "AllTime"
        if ($imageUrl -and $imageUrl -is [string] -and $imageUrl.Trim() -ne "") {
            $embed.image = @{
                url = $imageUrl.ToString()
            }
        }
        
        return $embed
        
    } catch {
        Write-Log "Failed to create all-time leaderboards embed: $($_.Exception.Message)" -Level Error
        return $null
    }
}

function Format-LeaderboardField {
    <#
    .SYNOPSIS
    Format a leaderboard field for Discord embed
    #>
    param(
        [string]$Title,
        [array]$Data,
        [string]$Emoji = ":medal:",
        [bool]$Inline = $true
    )
    
    # Check if data is empty or contains only empty/null values
    $validData = @()
    if ($Data -and $Data.Count -gt 0) {
        foreach ($item in $Data) {
            if ($item -and $item.Name -and ($item.Value -or $item.FormattedValue)) {
                $validData += $item
            }
        }
    }
    
    if (-not $validData -or $validData.Count -eq 0) {
        return @{
            name = $Title
            value = "No data yet"
            inline = $Inline
        }
    }
    
    $text = ""
    $maxPlayers = [Math]::Min(5, $validData.Count)
    
    for ($i = 0; $i -lt $maxPlayers; $i++) {
        $player = $validData[$i]
        $position = $i + 1
        
        # Use normal numbers for all positions
        $positionEmoji = "$position."
        
        # Clean and sanitize player name for Discord compatibility
        $cleanName = Clean-PlayerNameForDiscord -Name $player.Name
        
        # Truncate if still too long after cleaning
        $playerName = if ($cleanName -and $cleanName.Length -gt 16) { 
            $cleanName.Substring(0, 14) + ".." 
        } else { 
            $cleanName
        }
        
        $value = if ($player.FormattedValue) { $player.FormattedValue } else { $player.Value }
        
        $text += "$positionEmoji $playerName - $value`n"
    }
    
    return @{
        name = $Title
        value = $text.TrimEnd("`n")
        inline = $Inline
    }
}

function Clean-PlayerNameForDiscord {
    <#
    .SYNOPSIS
    Ensure player names are properly encoded for Discord without changing the characters
    Preserves all Unicode characters including Thai, Chinese, Japanese, Arabic, etc.
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$Name
    )
    
    if (-not $Name -or $Name.Trim() -eq "") {
        return "Unknown Player"
    }
    
    try {
        # Start with the original name
        $cleanName = $Name.Trim()
        
        # Only remove characters that break Discord formatting, keep all Unicode
        # Remove Discord markdown characters that could break formatting
        $cleanName = $cleanName -replace '[`]', "'"  # Replace backticks with single quotes
        $cleanName = $cleanName -replace '[\*_~|\\]', ''  # Remove other markdown chars
        
        # Ensure we don't have an empty name
        if ($cleanName.Trim() -eq "") {
            return "Player #" + ($Name.GetHashCode() -band 0x7FFFFFFF).ToString().Substring(0, 4)
        }
        
        # Return the name with all original Unicode characters preserved
        return $cleanName.Trim()
        
    } catch {
        Write-Log "Failed to process player name '$Name': $($_.Exception.Message)" -Level Warning
        # Fallback to original name if cleaning fails
        return $Name.Trim()
    }
}

function Find-ExistingEmbed {
    <#
    .SYNOPSIS
    Find existing leaderboard embed in channel using Node.js API
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$Token,
        
        [Parameter(Mandatory=$true)]
        [string]$ChannelId,
        
        [Parameter(Mandatory=$true)]
        [string]$EmbedType  # "Weekly" or "All-Time"
    )
    
    try {
        # Use Node.js bot to search for existing leaderboard embed
        if (Get-Command "Invoke-NodeJsApiRequest" -ErrorAction SilentlyContinue) {
            $searchText = "$EmbedType Leaderboards"
            $searchData = @{
                channelId = $ChannelId
                searchText = $searchText
                limit = 20
            }
            
            $response = Invoke-NodeJsApiRequest -Endpoint "/api/search-messages" -Method "POST" -Body $searchData
            
            if ($response.success -and $response.messages) {
                foreach ($message in $response.messages) {
                    if ($message.embeds -and $message.embeds.Count -gt 0) {
                        foreach ($embed in $message.embeds) {
                            if ($embed.title -and $embed.title -match $EmbedType) {
                                Write-Log "Found existing $EmbedType leaderboard embed: $($message.id)" -Level Debug
                                return @{
                                    id = $message.id
                                    embed = $embed
                                }
                            }
                        }
                    }
                }
            }
        }
        
        Write-Log "No existing $EmbedType leaderboard embed found" -Level Debug
        return $null
        
    } catch {
        Write-Log "Failed to find existing $EmbedType leaderboard embed: $($_.Exception.Message)" -Level Error
        return $null
    }
}

function Get-LeaderboardEmbed {
    <#
    .SYNOPSIS
    Get a leaderboard embed for testing purposes
    .PARAMETER Type
    Type of embed: "weekly" or "all-time"
    #>
    param(
        [Parameter(Mandatory)]
        [ValidateSet("weekly", "all-time")]
        [string]$Type
    )
    
    try {
        if ($Type -eq "weekly") {
            return New-WeeklyLeaderboardsEmbed
        } else {
            return New-AllTimeLeaderboardsEmbed
        }
    } catch {
        Write-Log "Failed to get $Type leaderboard embed: $($_.Exception.Message)" -Level Error
        return $null
    }
}

function Test-WeeklyResetNeeded {
    <#
    .SYNOPSIS
    Test if weekly leaderboard reset is needed
    #>
    
    try {
        $now = Get-Date
        $lastReset = Get-LastWeeklyReset
        
        # Reset every Monday at 00:00
        $lastMonday = $now.Date
        while ($lastMonday.DayOfWeek -ne [DayOfWeek]::Monday) {
            $lastMonday = $lastMonday.AddDays(-1)
        }
        
        return $lastReset -lt $lastMonday
    } catch {
        Write-Log "Error checking weekly reset: $($_.Exception.Message)" -Level Debug
        return $false
    }
}

function Get-LastWeeklyReset {
    <#
    .SYNOPSIS
    Get timestamp of last weekly reset
    #>
    
    try {
        $resetFile = "weekly_reset.txt"
        if (Test-Path $resetFile) {
            $content = Get-Content $resetFile -Raw
            return [DateTime]::Parse($content)
        } else {
            # Default to last Monday if no reset file
            $lastMonday = (Get-Date).Date
            while ($lastMonday.DayOfWeek -ne [DayOfWeek]::Monday) {
                $lastMonday = $lastMonday.AddDays(-1)
            }
            return $lastMonday
        }
    } catch {
        Write-Log "Error getting last reset: $($_.Exception.Message)" -Level Debug
        return (Get-Date).AddDays(-7) # Default to week ago
    }
}

# Export functions
Export-ModuleMember -Function @(
    'Initialize-LeaderboardsEmbed',
    'Update-LeaderboardsEmbed',
    'Update-LeaderboardsOnRestart',
    'New-WeeklyLeaderboardsEmbed',
    'New-AllTimeLeaderboardsEmbed',
    'Update-WeeklyEmbed',
    'Update-AllTimeEmbed',
    'Get-LeaderboardEmbed',
    'Get-RandomImageUrl',
    'Format-LeaderboardField',
    'Save-EmbedState',
    'Load-EmbedState'
)

