# ===============================================================
# SCUM Server Automation - Discord Text Commands
# ===============================================================
# Core command processing system for Discord text commands
# Handles command parsing, routing, and rate limiting
# ===============================================================

# Standard import of common module
try {
    $helperPath = Join-Path $PSScriptRoot "..\..\core\module-helper.psm1"
    if (Test-Path $helperPath) {
        Import-Module $helperPath -Force -ErrorAction SilentlyContinue
        Import-CommonModule | Out-Null
    }
} catch {
    Write-Host "[WARNING] Common module not available for discord-text-commands module" -ForegroundColor Yellow
}

# Global variables
$script:Config = $null
$script:LastProcessedMessages = @{}
$script:CommandCooldowns = @{}
$script:DebugCounter = 0

# ===============================================================
# INITIALIZATION
# ===============================================================

function Initialize-DiscordTextCommands {
    <#
    .SYNOPSIS
    Initialize the Discord text commands system
    .PARAMETER Config
    Configuration hashtable containing Discord settings
    #>
    param(
        [Parameter(Mandatory=$true)]
        [hashtable]$Config
    )
    
    try {
        $script:Config = $Config
        
        # Initialize Discord API with bot token
        if ($Config.Discord.Token) {
            Initialize-DiscordAPI -Token $Config.Discord.Token
        } else {
            Write-Log "[TEXT-COMMANDS] No Discord bot token found in configuration" -Level Warning
            return $false
        }
        
        # Verify Discord commands are enabled
        if (-not $Config.Discord.Commands.Enabled) {
            Write-Log "Text commands are disabled in configuration" -Level "Warning"
            return $false
        }
        
        # Verify required channels are configured
        if (-not $Config.Discord.Commands.Channels.Admin) {
            Write-Log "[TEXT-COMMANDS] No admin command channel configured" -Level Warning
            return $false
        }
        
        # Initialize message tracking
        $script:LastProcessedMessages = @{}
        foreach ($channelId in $Config.Discord.Commands.Channels.Values) {
            if ($channelId) {
                $script:LastProcessedMessages[$channelId] = Get-Date
            }
        }
        
        # Initialize cooldown tracking
        $script:CommandCooldowns = @{}
        
        Write-Log "Discord text commands initialized successfully" -Level "Info"
        Write-Log "Admin channel: $($Config.Discord.Commands.Channels.Admin)" -Level "Debug"
        Write-Log "Command prefix: $($Config.Discord.Commands.Prefix)" -Level "Debug"
        Write-Log "Available admin commands: $($Config.Discord.Commands.AdminCommands -join ', ')" -Level "Debug"
        
        return $true
        
    } catch {
        Write-Error "[TEXT-COMMANDS] Failed to initialize: $($_.Exception.Message)"
        return $false
    }
}

# ===============================================================
# COMMAND PROCESSING
# ===============================================================

function Update-DiscordTextCommands {
    <#
    .SYNOPSIS
    Check for new Discord messages and process commands
    .DESCRIPTION
    This function should be called periodically to check for new command messages
    #>
    
    if (-not $script:Config -or -not $script:Config.Discord.Commands.Enabled) {
        return
    }
    
    try {
        # Check admin channel for commands
        if ($script:Config.Discord.Commands.Channels.Admin) {
            $adminChannelId = $script:Config.Discord.Commands.Channels.Admin
            Process-ChannelCommands -ChannelId $adminChannelId -CommandType "Admin"
        }
        
        # Check player channel for commands
        if ($script:Config.Discord.Commands.Channels.Players) {
            $playersChannelId = $script:Config.Discord.Commands.Channels.Players
            Process-ChannelCommands -ChannelId $playersChannelId -CommandType "Player"
        }
        
    } catch {
        Write-Log "[TEXT-COMMANDS] Error updating commands: $($_.Exception.Message)" -Level Error
    }
}

function Process-ChannelCommands {
    <#
    .SYNOPSIS
    Process commands from a specific Discord channel
    .PARAMETER ChannelId
    Discord channel ID to check for messages
    .PARAMETER CommandType
    Type of commands (Admin or Player)
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$ChannelId,
        [Parameter(Mandatory=$true)]
        [string]$CommandType
    )
    
    try {
        # Get recent messages from the channel
        $messages = Get-DiscordChannelMessages -ChannelId $ChannelId -Limit 10
        
        if (-not $messages -or $messages.Count -eq 0) {
            return
        }
        
        # Get last processed time for this channel
        $lastProcessed = if ($script:LastProcessedMessages.ContainsKey($ChannelId)) {
            $script:LastProcessedMessages[$ChannelId]
        } else {
            (Get-Date).AddMinutes(-5) # Check last 5 minutes on first run
        }
        
        # Filter messages newer than last processed time
        $newMessages = $messages | Where-Object {
            $messageTime = [DateTime]::Parse($_.timestamp)
            $messageTime -gt $lastProcessed -and 
            $_.content.StartsWith($script:Config.Discord.Commands.Prefix)
            # Temporarily disabled bot filter: -and $_.author.bot -eq $false
        }
        
        if ($newMessages.Count -eq 0) {
            return
        }
        
        # Sort messages by timestamp (oldest first)
        $sortedMessages = $newMessages | Sort-Object timestamp
        
        foreach ($message in $sortedMessages) {
            try {
                Process-CommandMessage -Message $message -CommandType $CommandType -ChannelId $ChannelId
                
                # Update last processed time
                $messageTime = [DateTime]::Parse($message.timestamp)
                $script:LastProcessedMessages[$ChannelId] = $messageTime
                
            } catch {
                Write-Log "[TEXT-COMMANDS] Error processing message: $($_.Exception.Message)" -Level Error
            }
        }
        
    } catch {
        Write-Log "[TEXT-COMMANDS] Error processing channel $ChannelId commands: $($_.Exception.Message)" -Level Error
    }
}

function Process-CommandMessage {
    <#
    .SYNOPSIS
    Process a single command message
    .PARAMETER Message
    Discord message object
    .PARAMETER CommandType
    Type of command (Admin or Player)
    .PARAMETER ChannelId
    Channel ID where the message was sent
    #>
    param(
        [Parameter(Mandatory=$true)]
        [PSCustomObject]$Message,
        [Parameter(Mandatory=$true)]
        [string]$CommandType,
        [Parameter(Mandatory=$true)]
        [string]$ChannelId
    )
    
    try {
        $content = $Message.content.Trim()
        $prefix = $script:Config.Discord.Commands.Prefix
        
        # Remove prefix to get command and arguments
        $commandLine = $content.Substring($prefix.Length).Trim()
        $parts = $commandLine -split '\s+', 2
        $commandName = $parts[0].ToLower()
        $arguments = if ($parts.Length -gt 1) { $parts[1] } else { "" }
        
        # Check if command is allowed for this command type
        $allowedCommands = if ($CommandType -eq "Admin") {
            $script:Config.Discord.Commands.AdminCommands
        } else {
            $script:Config.Discord.Commands.PlayerCommands
        }
        
        if ($commandName -notin $allowedCommands) {
            Write-Log "Command '$commandName' not allowed for $CommandType users" -Level "Warning"
            return
        }
        
        # Check user permissions
        if ($CommandType -eq "Admin") {
            $hasPermission = Test-UserAdminPermissions -UserId $Message.author.id -GuildId $script:Config.Discord.GuildId -Config $script:Config
            if (-not $hasPermission) {
                Send-CommandResponse -ChannelId $ChannelId -Content ":x: **Access Denied** - You don't have admin permissions for this command!"
                return
            }
        }
        elseif ($CommandType -eq "Player") {
            $hasPermission = Test-UserPlayerPermissions -UserId $Message.author.id -GuildId $script:Config.Discord.GuildId -Config $script:Config
            if (-not $hasPermission) {
                Send-CommandResponse -ChannelId $ChannelId -Content ":x: **Access Denied** - You don't have player permissions for this command!"
                return
            }
        }
        
        # Check cooldown
        $userId = $Message.author.id
        $cooldownKey = "$userId-$commandName"
        $cooldownSeconds = $script:Config.Discord.Commands.CommandCooldownSeconds
        
        if ($script:CommandCooldowns.ContainsKey($cooldownKey)) {
            $lastUsed = $script:CommandCooldowns[$cooldownKey]
            $timeSinceLastUse = (Get-Date) - $lastUsed
            if ($timeSinceLastUse.TotalSeconds -lt $cooldownSeconds) {
                $remainingCooldown = [math]::Ceiling($cooldownSeconds - $timeSinceLastUse.TotalSeconds)
                Write-Log "Command on cooldown for $remainingCooldown seconds" -Level "Warning"
                return
            }
        }
        
        # Update cooldown
        $script:CommandCooldowns[$cooldownKey] = Get-Date
        
        # Execute the command
        Execute-TextCommand -CommandName $commandName -Arguments $arguments -ResponseChannelId $ChannelId -UserId $Message.author.id -CommandType $CommandType
        
        # Delete command message if configured
        if ($script:Config.Discord.Commands.DeleteCommandMessage) {
            try {
                Remove-DiscordMessage -ChannelId $ChannelId -MessageId $Message.id
            } catch {
                Write-Log "[TEXT-COMMANDS] Could not delete command message: $($_.Exception.Message)" -Level "Debug"
            }
        }
        
    } catch {
        Write-Log "[TEXT-COMMANDS] Error processing command message: $($_.Exception.Message)" -Level Error
    }
}

function Execute-TextCommand {
    <#
    .SYNOPSIS
    Execute a Discord text command
    .PARAMETER CommandName
    Name of the command to execute
    .PARAMETER Arguments
    Command arguments
    .PARAMETER ResponseChannelId
    Channel ID to send the response to
    .PARAMETER UserId
    User ID who executed the command
    .PARAMETER CommandType
    Type of command (Admin or Player)
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$CommandName,
        [Parameter(Mandatory=$false)]
        [string]$Arguments = "",
        [Parameter(Mandatory=$true)]
        [string]$ResponseChannelId,
        [Parameter(Mandatory=$true)]
        [string]$UserId,
        [Parameter(Mandatory=$true)]
        [string]$CommandType
    )
    
    try {
        if ($CommandType -eq "Admin") {
            # Route to admin commands module
            if (Get-Command "Execute-AdminCommand" -ErrorAction SilentlyContinue) {
                Execute-AdminCommand -CommandName $CommandName -Arguments $Arguments -ResponseChannelId $ResponseChannelId -UserId $UserId
            } else {
                Write-Log "[TEXT-COMMANDS] Admin commands module not available" -Level Warning
                Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Admin commands module not loaded"
            }
        }
        elseif ($CommandType -eq "Player") {
            # Route to player commands module
            if (Get-Command "Execute-PlayerCommand" -ErrorAction SilentlyContinue) {
                Execute-PlayerCommand -CommandName $CommandName -Arguments $Arguments -ResponseChannelId $ResponseChannelId -UserId $UserId
            } else {
                Write-Log "[TEXT-COMMANDS] Player commands module not available" -Level Warning
                Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Player commands module not loaded"
            }
        }
        else {
            Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Unknown command type: $CommandType"
        }
        
    } catch {
        Write-Log "[TEXT-COMMANDS] Error routing command '$CommandName': $($_.Exception.Message)" -Level Error
        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Failed to execute command: $($_.Exception.Message)"
    }
}

# Helper functions
function Send-CommandResponse {
    <#
    .SYNOPSIS
    Send a response message to Discord channel
    .PARAMETER ChannelId
    Discord channel ID
    .PARAMETER Content
    Text content to send
    .PARAMETER Embed
    Embed object to send
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$ChannelId,
        [Parameter(Mandatory=$false)]
        [string]$Content = "",
        [Parameter(Mandatory=$false)]
        [hashtable]$Embed = $null
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
            
            $result = Send-DiscordMessage @messageParams
            Write-Log "[TEXT-COMMANDS] Response sent to channel $ChannelId" -Level "Debug"
        } else {
            Write-Log "[TEXT-COMMANDS] Send-DiscordMessage function not available" -Level Warning
        }
    } catch {
        Write-Log "[TEXT-COMMANDS] Failed to send response: $($_.Exception.Message)" -Level Error
    }
}

# ===============================================================
# PERMISSION SYSTEM
# ===============================================================

function Test-UserAdminPermissions {
    <#
    .SYNOPSIS
    Check if user has admin permissions
    .PARAMETER UserId
    Discord user ID
    .PARAMETER GuildId
    Discord guild ID
    .PARAMETER Config
    Configuration hashtable
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$UserId,
        [Parameter(Mandatory=$true)]
        [string]$GuildId,
        [Parameter(Mandatory=$true)]
        [hashtable]$Config
    )
    
    try {
        # Get user's roles in the guild
        if (Get-Command "Get-UserGuildRoles" -ErrorAction SilentlyContinue) {
            $userRoles = Get-UserGuildRoles -UserId $UserId -GuildId $GuildId
            $adminRoles = $Config.Discord.Commands.Roles.Admin
            
            # Check if user has any admin roles
            foreach ($roleId in $userRoles) {
                if ($roleId -in $adminRoles) {
                    return $true
                }
            }
        }
        
        return $false
        
    } catch {
        Write-Log "[TEXT-COMMANDS] Error checking user admin permissions: $($_.Exception.Message)" -Level Error
        return $false
    }
}

function Test-UserPlayerPermissions {
    <#
    .SYNOPSIS
    Check if user has player permissions
    .PARAMETER UserId
    Discord user ID
    .PARAMETER GuildId
    Discord guild ID
    .PARAMETER Config
    Configuration hashtable
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$UserId,
        [Parameter(Mandatory=$true)]
        [string]$GuildId,
        [Parameter(Mandatory=$true)]
        [hashtable]$Config
    )
    
    try {
        # Get user's roles in the guild
        if (Get-Command "Get-UserGuildRoles" -ErrorAction SilentlyContinue) {
            $userRoles = Get-UserGuildRoles -UserId $UserId -GuildId $GuildId
            $playerRoles = $Config.Discord.Commands.Roles.Players
            $adminRoles = $Config.Discord.Commands.Roles.Admin
            
            # Check if user has any player roles OR admin roles (admins can use player commands too)
            foreach ($roleId in $userRoles) {
                if ($roleId -in $playerRoles -or $roleId -in $adminRoles) {
                    return $true
                }
            }
        }
        
        return $false
        
    } catch {
        Write-Log "[TEXT-COMMANDS] Error checking user player permissions: $($_.Exception.Message)" -Level Error
        return $false
    }
}

# Export functions
Export-ModuleMember -Function @(
    'Initialize-DiscordTextCommands',
    'Update-DiscordTextCommands'
)
