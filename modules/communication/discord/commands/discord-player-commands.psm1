# ===============================================================
# SCUM Server Automation - Discord Player Commands
# ===============================================================
# Provides public Discord commands for players
# Includes server info and status commands for regular users
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
    Write-Host "[WARNING] Common module not available for discord-player-commands module" -ForegroundColor Yellow
}

function Handle-ServerInfoPlayerCommand {
    <#
    .SYNOPSIS
    Handle !server_info player command (basic server information)
    #>
    param([string]$ResponseChannelId)
    
    try {
        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":information_source: **Server Info** - Gathering basic server information..."
        
        # Get basic server status (limited info for players)
        if (Get-Command "Get-CompleteServerStatus" -ErrorAction SilentlyContinue) {
            $status = Get-CompleteServerStatus
            
            $statusEmoji = if ($status.IsRunning) { ":green_circle:" } else { ":red_circle:" }
            $statusText = if ($status.IsRunning) { "**ONLINE**" } else { "**OFFLINE**" }
            
            $embed = @{
                title = "$statusEmoji SCUM Server Info"
                color = if ($status.IsRunning) { 65280 } else { 16711680 } # Green or Red
                fields = @(
                    @{ name = "Status"; value = $statusText; inline = $true }
                    @{ name = "Players Online"; value = "$($status.OnlinePlayers) / $($status.MaxPlayers)"; inline = $true }
                    @{ name = "Game Time"; value = $status.GameTime; inline = $true }
                    @{ name = "Weather"; value = $status.Temperature; inline = $true }
                )
                footer = @{
                    text = "Server Information"
                }
                timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
            }
            
            Send-CommandResponse -ChannelId $ResponseChannelId -Embed $embed
        } else {
            Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Server info not available"
        }
    } catch {
        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Failed to get server info: $($_.Exception.Message)"
    }
}

function Handle-PlayerStatsPlayerCommand {
    <#
    .SYNOPSIS
    Handle !player_stats player command (show top players)
    #>
    param([string]$ResponseChannelId)
    
    try {
        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":trophy: **Player Stats** - Fetching leaderboard..."
        
        # TODO: Implement player stats functionality
        # This would show top players, kill counts, etc.
        
        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":construction: **Coming Soon** - Player stats feature is under development!"
        
    } catch {
        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Failed to get player stats: $($_.Exception.Message)"
    }
}

function Handle-HelpPlayerCommand {
    <#
    .SYNOPSIS
    Handle !help player command (show available commands)
    #>
    param([string]$ResponseChannelId)
    
    try {
        $embed = @{
            title = ":question: Available Player Commands"
            color = 3447003 # Blue
            description = "Here are the commands you can use:"
            fields = @(
                @{ 
                    name = ":information_source: **!server_info**"
                    value = "Get basic server information and status"
                    inline = $false 
                }
                @{ 
                    name = ":trophy: **!player_stats**"
                    value = "View top players and statistics (coming soon)"
                    inline = $false 
                }
                @{ 
                    name = ":question: **!help**"
                    value = "Show this help message"
                    inline = $false 
                }
            )
            footer = @{
                text = "Player Commands Help"
            }
            timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        }
        
        Send-CommandResponse -ChannelId $ResponseChannelId -Embed $embed
        
    } catch {
        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Failed to show help: $($_.Exception.Message)"
    }
}

function Execute-PlayerCommand {
    <#
    .SYNOPSIS
    Route player command to appropriate handler
    .PARAMETER CommandName
    Name of the player command
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
        Write-Log "Executing player command: $CommandName" -Level "Debug"
        
        switch ($CommandName) {
            'server_info' {
                Handle-ServerInfoPlayerCommand -ResponseChannelId $ResponseChannelId
            }
            'player_stats' {
                Handle-PlayerStatsPlayerCommand -ResponseChannelId $ResponseChannelId
            }
            'help' {
                Handle-HelpPlayerCommand -ResponseChannelId $ResponseChannelId
            }
            default {
                Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Unknown Player Command** - Command `!$CommandName` is not available. Use `!help` to see available commands."
            }
        }
        
    } catch {
        Write-Log "[PLAYER-COMMANDS] Error executing player command '$CommandName': $($_.Exception.Message)" -Level Error
        Send-CommandResponse -ChannelId $ResponseChannelId -Content ":x: **Error** - Failed to execute player command: $($_.Exception.Message)"
    }
}

# Helper function for sending responses (will be imported from main module)
function Send-CommandResponse {
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
            
            $null = Send-DiscordMessage @messageParams
            Write-Log "[PLAYER-COMMANDS] Response sent to channel $ChannelId" -Level "Debug"
        } else {
            Write-Log "[PLAYER-COMMANDS] Send-DiscordMessage function not available" -Level Warning
        }
    } catch {
        Write-Log "[PLAYER-COMMANDS] Failed to send response: $($_.Exception.Message)" -Level Error
    }
}

# Export functions
Export-ModuleMember -Function @(
    'Execute-PlayerCommand'
)
