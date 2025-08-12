# ===============================================================
# SCUM Server Automation - Discord Leaderboards
# ===============================================================
# Generates and manages live leaderboard embeds for Discord
# Supports 19 categories with weekly and all-time statistics
# ===============================================================

# Note: Database module must be imported globally before using this module

# Standard import of common module
try {
    $helperPath = Join-Path $PSScriptRoot "..\..\core\module-helper.psm1"
    if (Test-Path $helperPath) {
        Import-Module $helperPath -Force -ErrorAction SilentlyContinue
        Import-CommonModule | Out-Null
    }
} catch {
    Write-Host "[WARNING] Common module not available for leaderboards-embed module" -ForegroundColor Yellow
}

# Global variables
$script:WeeklyEmbed = $null
$script:AllTimeEmbed = $null
$script:DiscordConfig = $null
$script:LastWeeklyUpdate = Get-Date
$script:LastAllTimeUpdate = Get-Date

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
        Write-Log "[WARN] Leaderboards embed not configured properly" -Level "Info"
        return $false
    }
    
    try {
        # Check for weekly reset first
        if (Test-WeeklyResetNeeded) {
            Write-Log "Weekly reset needed - performing reset..." -Level "Info"
            Invoke-WeeklyReset
        }
        
        # For production stability, we'll find existing embeds and set them up for updates
        # rather than trying to create new ones during initialization
        Write-Log "Searching for existing leaderboard embeds..." -Level "Info"
        
        # Try to find existing embeds
        $existingWeekly = Find-ExistingEmbed -Token $script:DiscordConfig.Token -ChannelId $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel -EmbedType "Weekly"
        $existingAllTime = Find-ExistingEmbed -Token $script:DiscordConfig.Token -ChannelId $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel -EmbedType "All-Time"
        
        if ($existingWeekly) {
            Write-Log "Found existing weekly leaderboards embed (ID: $($existingWeekly.id))" -Level "Info"
            $script:WeeklyEmbed = @{
                ChannelId = $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel
                MessageId = $existingWeekly.id
                LastUpdate = Get-Date
            }
        }
        
        if ($existingAllTime) {
            Write-Log "Found existing all-time leaderboards embed (ID: $($existingAllTime.id))" -Level "Info"
            $script:AllTimeEmbed = @{
                ChannelId = $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel
                MessageId = $existingAllTime.id
                LastUpdate = Get-Date
            }
        }
        
        # If no existing embeds found, they will be created during the first update cycle
        if (-not $existingWeekly) {
            Write-Log "No existing weekly embed found - will be created during first update" -Level "Info"
        }
        
        if (-not $existingAllTime) {
            Write-Log "No existing all-time embed found - will be created during first update" -Level "Info"
        }
        
        # Always return success - embeds will be created/updated during monitoring
        Write-Log "[OK] Leaderboard system initialized successfully" -Level "Info"
        Write-Log "   Weekly embed: $($existingWeekly -ne $null)" -Level "Info"
        Write-Log "   All-time embed: $($existingAllTime -ne $null)" -Level "Info"
        Write-Log "   Missing embeds will be created during first update cycle" -Level "Info"
        
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
            Write-Log "Weekly leaderboards embed already exists (ID: $($script:WeeklyEmbed.MessageId))" -Level "Info"
            return $true
        }
        
        # Try to find existing embed in channel
        $existingEmbed = Find-ExistingEmbed -Token $script:DiscordConfig.Token -ChannelId $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel -EmbedType "Weekly"
        
        if ($existingEmbed) {
            Write-Log "Found existing weekly leaderboards embed (ID: $($existingEmbed.id))" -Level "Info"
            $script:WeeklyEmbed = @{
                ChannelId = $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel
                MessageId = $existingEmbed.id
                LastUpdate = Get-Date
            }
            return $true
        }
        
        # Create new weekly embed
        Write-Log "Creating new weekly leaderboards embed..." -Level "Info"
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
        
        $message = Send-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel -Embed $embed
        
        if ($message) {
            $script:WeeklyEmbed = @{
                ChannelId = $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel
                MessageId = $message.id
                LastUpdate = Get-Date
            }
            Write-Log ":white_check_mark: Weekly leaderboards embed created: $($message.id)" -Level "Info"
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
            Write-Log "Found existing all-time leaderboards embed (ID: $($existingEmbed.id))" -Level "Info"
            $script:AllTimeEmbed = @{
                ChannelId = $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel
                MessageId = $existingEmbed.id
                LastUpdate = Get-Date
            }
            return $true
        }
        
        # Create new all-time embed
        Write-Log "Creating new all-time leaderboards embed..." -Level "Info"
        
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
        
        $message = Send-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel -Embed $embed
        
        if ($message) {
            $script:AllTimeEmbed = @{
                ChannelId = $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel
                MessageId = $message.id
                LastUpdate = Get-Date
            }
            Write-Log ":white_check_mark: All-time leaderboards embed created: $($message.id)" -Level "Info"
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
    Update both weekly and all-time leaderboard embeds
    #>
    
    try {
        # Check for weekly reset
        if (Test-WeeklyResetNeeded) {
            Write-Log "Weekly reset needed - performing reset..." -Level "Info"
            Invoke-WeeklyReset
        }
        
        # Create missing embeds if needed
        if (-not $script:WeeklyEmbed -or -not $script:WeeklyEmbed.MessageId) {
            Write-Log "Creating missing weekly leaderboard embed..." -Level "Info"
            Initialize-WeeklyEmbed
        }
        
        if (-not $script:AllTimeEmbed -or -not $script:AllTimeEmbed.MessageId) {
            Write-Log "Creating missing all-time leaderboard embed..." -Level "Info"
            Initialize-AllTimeEmbed
        }
        
        # Update intervals
        $weeklyInterval = if ($script:DiscordConfig.LiveEmbeds.WeeklyLeaderboardUpdateInterval) { $script:DiscordConfig.LiveEmbeds.WeeklyLeaderboardUpdateInterval } else { 300 }
        $allTimeInterval = if ($script:DiscordConfig.LiveEmbeds.AllTimeLeaderboardUpdateInterval) { $script:DiscordConfig.LiveEmbeds.AllTimeLeaderboardUpdateInterval } else { 600 }
        
        # Update weekly embed
        $weeklyTimeSinceUpdate = (Get-Date) - $script:LastWeeklyUpdate
        if ($weeklyTimeSinceUpdate.TotalSeconds -ge $weeklyInterval) {
            Update-WeeklyEmbed
        }
        
        # Update all-time embed
        $allTimeTimeSinceUpdate = (Get-Date) - $script:LastAllTimeUpdate
        if ($allTimeTimeSinceUpdate.TotalSeconds -ge $allTimeInterval) {
            Update-AllTimeEmbed
        }
        
    } catch {
        Write-Log "Failed to update leaderboards embeds: $($_.Exception.Message)" -Level Error
    }
}

function Update-WeeklyEmbed {
    <#
    .SYNOPSIS
    Update the weekly leaderboards embed
    #>
    
    try {
        if (-not $script:WeeklyEmbed -or -not $script:WeeklyEmbed.MessageId) {
            Write-Log "Weekly embed not initialized" -Level "Debug"
            return
        }
        
        $embed = New-WeeklyLeaderboardsEmbed
        
        if (-not $embed) {
            Write-Log "Failed to create weekly leaderboard embed" -Level Error
            return
        }
        
        $result = Update-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:WeeklyEmbed.ChannelId -MessageId $script:WeeklyEmbed.MessageId -Embed $embed
        
        if ($result) {
            $script:LastWeeklyUpdate = Get-Date
            Write-Log "Weekly leaderboards embed updated" -Level "Debug"
        }
        
    } catch {
        Write-Log "Failed to update weekly embed: $($_.Exception.Message)" -Level Error
    }
}

function Update-AllTimeEmbed {
    <#
    .SYNOPSIS
    Update the all-time leaderboards embed
    #>
    
    try {
        if (-not $script:AllTimeEmbed -or -not $script:AllTimeEmbed.MessageId) {
            Write-Log "All-time embed not initialized" -Level "Debug"
            return
        }
        
        $embed = New-AllTimeLeaderboardsEmbed
        
        if (-not $embed) {
            Write-Log "Failed to create all-time leaderboard embed" -Level Error
            return
        }
        
        $result = Update-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:AllTimeEmbed.ChannelId -MessageId $script:AllTimeEmbed.MessageId -Embed $embed
        
        if ($result) {
            $script:LastAllTimeUpdate = Get-Date
            Write-Log "All-time leaderboards embed updated" -Level "Debug"
        }
        
    } catch {
        Write-Log "Failed to update all-time embed: $($_.Exception.Message)" -Level Error
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
        $fields = @()
        
        # Get weekly leaderboard data for 12 categories in 2 columns
        $fields += Format-LeaderboardField -Title ":busts_in_silhouette: TOP SQUADS" -Data (Get-WeeklyLeaderboard -Category "squads" -Limit 5) -Inline $false
        $fields += Format-LeaderboardField -Title ":stopwatch: TOP SURVIVORS" -Data (Get-WeeklyLeaderboard -Category "minutes_survived" -Limit 5) -Inline $false
        $fields += Format-LeaderboardField -Title ":star: TOP FAME POINTS" -Data (Get-WeeklyLeaderboard -Category "fame" -Limit 5) -Inline $false
        $fields += Format-LeaderboardField -Title ":moneybag: TOP MONEY" -Data (Get-WeeklyLeaderboard -Category "money" -Limit 5) -Inline $false
        $fields += Format-LeaderboardField -Title ":zombie: TOP PUPPET KILLERS" -Data (Get-WeeklyLeaderboard -Category "puppet_kills" -Limit 5) -Inline $false
        $fields += Format-LeaderboardField -Title ":deer: TOP ANIMAL HUNTERS" -Data (Get-WeeklyLeaderboard -Category "animal_kills" -Limit 5) -Inline $false
        $fields += Format-LeaderboardField -Title ":crossed_swords: TOP MELEE WARRIORS" -Data (Get-WeeklyLeaderboard -Category "melee_kills" -Limit 5) -Inline $false
        $fields += Format-LeaderboardField -Title ":bow_and_arrow: TOP ARCHERS" -Data (Get-WeeklyLeaderboard -Category "archery_kills" -Limit 5) -Inline $false
        $fields += Format-LeaderboardField -Title ":gun: TOP SNIPER" -Data (Get-WeeklyLeaderboard -Category "longest_kill_distance" -Limit 5) -Inline $false
        $fields += Format-LeaderboardField -Title ":dart: TOP HEADSHOT MASTERS" -Data (Get-WeeklyLeaderboard -Category "headshots" -Limit 5) -Inline $false
        $fields += Format-LeaderboardField -Title ":unlock: TOP LOCKPICKERS" -Data (Get-WeeklyLeaderboard -Category "locks_picked" -Limit 5) -Inline $false
        $fields += Format-LeaderboardField -Title ":package: TOP LOOTERS" -Data (Get-WeeklyLeaderboard -Category "containers_looted" -Limit 5) -Inline $false
        
        $weekStart = (Get-Date).AddDays(-(Get-Date).DayOfWeek.value__+1)
        $weekEnd = $weekStart.AddDays(6)
        
        $footer = @{
            text = "SCUM Server Automation - Weekly stats reset every Monday"
            icon_url = "https://playhub.cz/scum/manager/server_automation_discord.png"
        }
        
        $embed = @{
            title = ":calendar_spiral: Weekly Leaderboards"
            description = "**This Week's Top Performers** ($($weekStart.ToString('dd.MM.yyyy')) - $($weekEnd.ToString('dd.MM.yyyy')))"
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
        $fields = @()
        
        # Get all-time leaderboard data for 12 categories in 2 columns
        $fields += Format-LeaderboardField -Title ":busts_in_silhouette: TOP SQUADS" -Data (Get-TopSquads -Limit 5) -Inline $false
        $fields += Format-LeaderboardField -Title ":stopwatch: TOP SURVIVORS" -Data (Get-TopSurvivors -Limit 5) -Inline $false
        $fields += Format-LeaderboardField -Title ":star: TOP FAME POINTS" -Data (Get-TopFame -Limit 5) -Inline $false
        $fields += Format-LeaderboardField -Title ":moneybag: TOP MONEY" -Data (Get-TopMoney -Limit 5) -Inline $false
        $fields += Format-LeaderboardField -Title ":zombie: TOP PUPPET KILLERS" -Data (Get-TopPuppetKills -Limit 5) -Inline $false
        $fields += Format-LeaderboardField -Title ":deer: TOP ANIMAL HUNTERS" -Data (Get-TopAnimalKills -Limit 5) -Inline $false
        $fields += Format-LeaderboardField -Title ":crossed_swords: TOP MELEE WARRIORS" -Data (Get-TopMeleeWarriors -Limit 5) -Inline $false
        $fields += Format-LeaderboardField -Title ":bow_and_arrow: TOP ARCHERS" -Data (Get-TopArchers -Limit 5) -Inline $false
        $fields += Format-LeaderboardField -Title ":gun: TOP SNIPER" -Data (Get-TopSniper -Limit 5) -Inline $false
        $fields += Format-LeaderboardField -Title ":dart: TOP HEADSHOT MASTERS" -Data (Get-TopHeadshots -Limit 5) -Inline $false
        $fields += Format-LeaderboardField -Title ":unlock: TOP LOCKPICKERS" -Data (Get-TopLockpickers -Limit 5) -Inline $false
        $fields += Format-LeaderboardField -Title ":package: TOP LOOTERS" -Data (Get-TopLooters -Limit 5) -Inline $false
        
        $footer = @{
            text = "SCUM Server Automation - All-time server statistics"
            icon_url = "https://playhub.cz/scum/manager/server_automation_discord.png"
        }
        
        $embed = @{
            title = ":trophy: All-Time Leaderboards"
            description = "**Hall of Fame - Server Legends**"
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
    Find existing leaderboard embed in channel
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
        $headers = @{
            "Authorization" = "Bot $Token"
            "Content-Type" = "application/json"
            "User-Agent" = "SCUM-Server-Manager/1.0"
        }
        
        # Get recent messages from channel
        $uri = "https://discord.com/api/v10/channels/$ChannelId/messages?limit=20"
        $messages = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers
        
        # Look for embed with leaderboards characteristics
        foreach ($message in $messages) {
            if ($message.embeds -and $message.embeds.Count -gt 0) {
                $embed = $message.embeds[0]
                
                # Check if this is the correct type of leaderboards embed
                if ($EmbedType -eq "Weekly" -and $embed.title -like "*Weekly*") {
                    Write-Log "Found existing weekly leaderboards embed: $($message.id)" -Level "Debug"
                    return $message
                } elseif ($EmbedType -eq "All-Time" -and $embed.title -like "*All-Time*") {
                    Write-Log "Found existing all-time leaderboards embed: $($message.id)" -Level "Debug"
                    return $message
                }
            }
        }
        
        Write-Log "No existing $EmbedType leaderboards embed found" -Level "Debug"
        return $null
        
    } catch {
        Write-Log "Failed to find existing $EmbedType leaderboards embed: $($_.Exception.Message)" -Level Error
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
        Write-Log "Error checking weekly reset: $($_.Exception.Message)" -Level "Debug"
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
        Write-Log "Error getting last reset: $($_.Exception.Message)" -Level "Debug"
        return (Get-Date).AddDays(-7) # Default to week ago
    }
}

# Export functions
Export-ModuleMember -Function @(
    'Initialize-LeaderboardsEmbed',
    'Update-LeaderboardsEmbed',
    'New-WeeklyLeaderboardsEmbed',
    'New-AllTimeLeaderboardsEmbed',
    'Update-WeeklyEmbed',
    'Update-AllTimeEmbed',
    'Get-LeaderboardEmbed',
    'Get-RandomImageUrl',
    'Format-LeaderboardField'
)

