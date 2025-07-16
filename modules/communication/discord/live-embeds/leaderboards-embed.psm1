# ===============================================================
# SCUM Server Automation - Discord Leaderboards
# ===============================================================
# Generates and manages live leaderboard embeds for Discord
# Supports 19 categories with weekly and all-time statistics
# ===============================================================

# Note: Database module must be imported globally before using this module

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
        Write-Host "[WARN] Leaderboards embed not configured properly" -ForegroundColor Red
        return $false
    }
    
    try {
        # Check for weekly reset first
        if (Test-WeeklyResetNeeded) {
            Write-Host "Weekly reset needed - performing reset..." -ForegroundColor Yellow
            Invoke-WeeklyReset
        }
        
        # For production stability, we'll find existing embeds and set them up for updates
        # rather than trying to create new ones during initialization
        Write-Host "Searching for existing leaderboard embeds..." -ForegroundColor Yellow
        
        # Try to find existing embeds
        $existingWeekly = Find-ExistingEmbed -Token $script:DiscordConfig.Token -ChannelId $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel -EmbedType "Weekly"
        $existingAllTime = Find-ExistingEmbed -Token $script:DiscordConfig.Token -ChannelId $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel -EmbedType "All-Time"
        
        if ($existingWeekly) {
            Write-Host "Found existing weekly leaderboards embed (ID: $($existingWeekly.id))" -ForegroundColor Green
            $script:WeeklyEmbed = @{
                ChannelId = $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel
                MessageId = $existingWeekly.id
                LastUpdate = Get-Date
            }
        }
        
        if ($existingAllTime) {
            Write-Host "Found existing all-time leaderboards embed (ID: $($existingAllTime.id))" -ForegroundColor Green
            $script:AllTimeEmbed = @{
                ChannelId = $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel
                MessageId = $existingAllTime.id
                LastUpdate = Get-Date
            }
        }
        
        # If no existing embeds found, they will be created during the first update cycle
        if (-not $existingWeekly) {
            Write-Host "No existing weekly embed found - will be created during first update" -ForegroundColor Yellow
        }
        
        if (-not $existingAllTime) {
            Write-Host "No existing all-time embed found - will be created during first update" -ForegroundColor Yellow
        }
        
        # Always return success - embeds will be created/updated during monitoring
        Write-Host "[OK] Leaderboard system initialized successfully" -ForegroundColor Green
        Write-Host "   Weekly embed: $($existingWeekly -ne $null)" -ForegroundColor White
        Write-Host "   All-time embed: $($existingAllTime -ne $null)" -ForegroundColor White
        Write-Host "   Missing embeds will be created during first update cycle" -ForegroundColor White
        
        return $true
        
    } catch {
        Write-Warning "Failed to initialize leaderboards embeds: $($_.Exception.Message)"
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
            Write-Host "Weekly leaderboards embed already exists (ID: $($script:WeeklyEmbed.MessageId))" -ForegroundColor Yellow
            return $true
        }
        
        # Try to find existing embed in channel
        $existingEmbed = Find-ExistingEmbed -Token $script:DiscordConfig.Token -ChannelId $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel -EmbedType "Weekly"
        
        if ($existingEmbed) {
            Write-Host "Found existing weekly leaderboards embed (ID: $($existingEmbed.id))" -ForegroundColor Cyan
            $script:WeeklyEmbed = @{
                ChannelId = $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel
                MessageId = $existingEmbed.id
                LastUpdate = Get-Date
            }
            return $true
        }
        
        # Create new weekly embed
        Write-Host "Creating new weekly leaderboards embed..." -ForegroundColor Yellow
        $embed = New-WeeklyLeaderboardsEmbed
        
        if (-not $embed) {
            Write-Warning "Failed to create weekly leaderboard embed"
            return $false
        }
        
        # Check embed size before sending
        $embedJson = $embed | ConvertTo-Json -Depth 10
        
        if ($embedJson.Length -gt 6000) {
            Write-Warning "Weekly embed too large: $($embedJson.Length) characters"
            return $false
        }
        
        $message = Send-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel -Embed $embed
        
        if ($message) {
            $script:WeeklyEmbed = @{
                ChannelId = $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel
                MessageId = $message.id
                LastUpdate = Get-Date
            }
            Write-Host ":white_check_mark: Weekly leaderboards embed created: $($message.id)" -ForegroundColor Green
            return $true
        }
        
        return $false
        
    } catch {
        Write-Warning "Failed to initialize weekly embed: $($_.Exception.Message)"
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
            Write-Host "Found existing all-time leaderboards embed (ID: $($existingEmbed.id))" -ForegroundColor Cyan
            $script:AllTimeEmbed = @{
                ChannelId = $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel
                MessageId = $existingEmbed.id
                LastUpdate = Get-Date
            }
            return $true
        }
        
        # Create new all-time embed
        Write-Host "Creating new all-time leaderboards embed..." -ForegroundColor Yellow
        
        # Add small delay to avoid rate limiting
        Start-Sleep -Seconds 2
        
        $embed = New-AllTimeLeaderboardsEmbed
        
        if (-not $embed) {
            Write-Warning "Failed to create all-time embed data"
            return $false
        }
        
        # Check embed size before sending
        $embedJson = $embed | ConvertTo-Json -Depth 10
        
        if ($embedJson.Length -gt 6000) {
            Write-Warning "All-time embed too large: $($embedJson.Length) characters"
            return $false
        }
        
        $message = Send-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel -Embed $embed
        
        if ($message) {
            $script:AllTimeEmbed = @{
                ChannelId = $script:DiscordConfig.LiveEmbeds.LeaderboardsChannel
                MessageId = $message.id
                LastUpdate = Get-Date
            }
            Write-Host ":white_check_mark: All-time leaderboards embed created: $($message.id)" -ForegroundColor Green
            return $true
        }
        
        Write-Warning "Send-DiscordMessage returned null for all-time embed"
        return $false
        
    } catch {
        Write-Warning "Failed to initialize all-time embed: $($_.Exception.Message)"
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
            Write-Host "Weekly reset needed - performing reset..." -ForegroundColor Yellow
            Invoke-WeeklyReset
        }
        
        # Create missing embeds if needed
        if (-not $script:WeeklyEmbed -or -not $script:WeeklyEmbed.MessageId) {
            Write-Host "Creating missing weekly leaderboard embed..." -ForegroundColor Yellow
            Initialize-WeeklyEmbed
        }
        
        if (-not $script:AllTimeEmbed -or -not $script:AllTimeEmbed.MessageId) {
            Write-Host "Creating missing all-time leaderboard embed..." -ForegroundColor Yellow
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
        Write-Warning "Failed to update leaderboards embeds: $($_.Exception.Message)"
    }
}

function Update-WeeklyEmbed {
    <#
    .SYNOPSIS
    Update the weekly leaderboards embed
    #>
    
    try {
        if (-not $script:WeeklyEmbed -or -not $script:WeeklyEmbed.MessageId) {
            Write-Verbose "Weekly embed not initialized"
            return
        }
        
        $embed = New-WeeklyLeaderboardsEmbed
        
        if (-not $embed) {
            Write-Warning "Failed to create weekly leaderboard embed"
            return
        }
        
        $result = Update-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:WeeklyEmbed.ChannelId -MessageId $script:WeeklyEmbed.MessageId -Embed $embed
        
        if ($result) {
            $script:LastWeeklyUpdate = Get-Date
            Write-Verbose "Weekly leaderboards embed updated"
        }
        
    } catch {
        Write-Warning "Failed to update weekly embed: $($_.Exception.Message)"
    }
}

function Update-AllTimeEmbed {
    <#
    .SYNOPSIS
    Update the all-time leaderboards embed
    #>
    
    try {
        if (-not $script:AllTimeEmbed -or -not $script:AllTimeEmbed.MessageId) {
            Write-Verbose "All-time embed not initialized"
            return
        }
        
        $embed = New-AllTimeLeaderboardsEmbed
        
        if (-not $embed) {
            Write-Warning "Failed to create all-time leaderboard embed"
            return
        }
        
        $result = Update-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:AllTimeEmbed.ChannelId -MessageId $script:AllTimeEmbed.MessageId -Embed $embed
        
        if ($result) {
            $script:LastAllTimeUpdate = Get-Date
            Write-Verbose "All-time leaderboards embed updated"
        }
        
    } catch {
        Write-Warning "Failed to update all-time embed: $($_.Exception.Message)"
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
        Write-Warning "Failed to get random $Type image URL: $($_.Exception.Message)"
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
        $fields += Format-LeaderboardField -Title ":busts_in_silhouette: TOP SQUADS" -Data (Get-TopSquads -Limit 5 -WeeklyOnly $true) -Inline $false
        $fields += Format-LeaderboardField -Title ":stopwatch: TOP SURVIVORS" -Data (Get-TopSurvivors -Limit 5 -WeeklyOnly $true) -Inline $false
        $fields += Format-LeaderboardField -Title ":star: TOP FAME POINTS" -Data (Get-TopFame -Limit 5 -WeeklyOnly $true) -Inline $false
        $fields += Format-LeaderboardField -Title ":moneybag: TOP MONEY" -Data (Get-TopMoney -Limit 5 -WeeklyOnly $true) -Inline $false
        $fields += Format-LeaderboardField -Title ":zombie: TOP PUPPET KILLERS" -Data (Get-TopPuppetKills -Limit 5 -WeeklyOnly $true) -Inline $false
        $fields += Format-LeaderboardField -Title ":deer: TOP ANIMAL HUNTERS" -Data (Get-TopAnimalKills -Limit 5 -WeeklyOnly $true) -Inline $false
        $fields += Format-LeaderboardField -Title ":crossed_swords: TOP MELEE WARRIORS" -Data (Get-TopMeleeWarriors -Limit 5 -WeeklyOnly $true) -Inline $false
        $fields += Format-LeaderboardField -Title ":bow_and_arrow: TOP ARCHERS" -Data (Get-TopArchers -Limit 5 -WeeklyOnly $true) -Inline $false
        $fields += Format-LeaderboardField -Title ":gun: TOP SNIPER" -Data (Get-TopSniper -Limit 5 -WeeklyOnly $true) -Inline $false
        $fields += Format-LeaderboardField -Title ":dart: TOP HEADSHOT MASTERS" -Data (Get-TopHeadshots -Limit 5 -WeeklyOnly $true) -Inline $false
        $fields += Format-LeaderboardField -Title ":unlock: TOP LOCKPICKERS" -Data (Get-TopLockpickers -Limit 5 -WeeklyOnly $true) -Inline $false
        $fields += Format-LeaderboardField -Title ":package: TOP LOOTERS" -Data (Get-TopLooters -Limit 5 -WeeklyOnly $true) -Inline $false
        
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
        Write-Warning "Failed to create weekly leaderboards embed: $($_.Exception.Message)"
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
        Write-Warning "Failed to create all-time leaderboards embed: $($_.Exception.Message)"
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
        $validData = $Data | Where-Object { $_.Name -and ($_.Value -or $_.FormattedValue) }
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
        
        # Less aggressive name truncation - allow longer names
        $playerName = if ($player.Name -and $player.Name.Length -gt 16) { 
            $player.Name.Substring(0, 14) + ".." 
        } else { 
            $player.Name
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
                    Write-Verbose "Found existing weekly leaderboards embed: $($message.id)"
                    return $message
                } elseif ($EmbedType -eq "All-Time" -and $embed.title -like "*All-Time*") {
                    Write-Verbose "Found existing all-time leaderboards embed: $($message.id)"
                    return $message
                }
            }
        }
        
        Write-Verbose "No existing $EmbedType leaderboards embed found"
        return $null
        
    } catch {
        Write-Warning "Failed to find existing $EmbedType leaderboards embed: $($_.Exception.Message)"
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
        Write-Warning "Failed to get $Type leaderboard embed: $($_.Exception.Message)"
        return $null
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
    'Get-RandomImageUrl'
)
