# ===============================================================
# SCUM Server Automation - Discord Embed Templates
# ===============================================================
# Standardized Discord embed styles and formatting templates
# Provides consistent visual styling across all Discord messages
# Now with Node.js API integration support
# ===============================================================

# Import discord integration module for Node.js API access
try {
    $discordIntegrationPath = Join-Path $PSScriptRoot "..\discord-integration.psm1"
    if (Test-Path $discordIntegrationPath) {
        # MEMORY LEAK FIX: Conditional import instead of -Force
        if (-not (Get-Module "discord-integration" -ErrorAction SilentlyContinue)) {
            Import-Module $discordIntegrationPath -ErrorAction SilentlyContinue
        }
    }
} catch {
    Write-Warning "[WARNING] Could not load discord-integration module for embed-styles"
}

function New-StandardEmbed {
    <#
    .SYNOPSIS
    Create standard embed with consistent styling - supports both PowerShell and Node.js creation
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$Title,
        
        [string]$Description,
        [int]$Color = 3447003,  # Blue
        [array]$Fields = @(),
        [hashtable]$Footer = @{ 
            text = "SCUM Server Automation"
            icon_url = "https://playhub.cz/scum/manager/server_automation_discord.png"
        },
        
        # Node.js API parameters
        [switch]$UseNodeJs,
        [string]$ChannelId,
        [hashtable[]]$Components = @()
    )
    
    if ($UseNodeJs -and $ChannelId -and (Get-Command "Send-DiscordMessage" -ErrorAction SilentlyContinue)) {
        # Use Node.js API to send embed directly
        $embed = @{
            title = $Title
            color = $Color
            timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
            footer = $Footer
        }
        
        if ($Description) {
            $embed.description = $Description
        }
        
        if ($Fields.Count -gt 0) {
            $embed.fields = $Fields
        }
        
        return Send-DiscordMessage -ChannelId $ChannelId -Embeds @($embed) -Components $Components
    } else {
        # Return embed object for manual sending
        $embed = @{
            title = $Title
            color = $Color
            timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
            footer = $Footer
        }
        
        if ($Description) {
            $embed.description = $Description
        }
        
        if ($Fields.Count -gt 0) {
            $embed.fields = $Fields
        }
        
        return $embed
    }
}

function Get-ColorCode {
    <#
    .SYNOPSIS
    Get color code for embed type
    #>
    param([string]$Type)
    
    switch ($Type.ToLower()) {
        "success" { return 65280 }      # Green
        "error" { return 15158332 }     # Red
        "warning" { return 16776960 }   # Yellow
        "info" { return 3447003 }       # Blue
        "critical" { return 16711680 }  # Bright Red
        default { return 3447003 }      # Blue
    }
}

function New-EmbedField {
    <#
    .SYNOPSIS
    Create embed field
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$Name,
        
        [Parameter(Mandatory=$true)]
        [string]$Value,
        
        [bool]$Inline = $false
    )
    
    return @{
        name = $Name
        value = $Value
        inline = $Inline
    }
}

# Notification embed helper functions with Node.js API support
function New-SuccessEmbed {
    <#
    .SYNOPSIS
    Create success embed with green color - supports Node.js API
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$Title,
        
        [string]$Description,
        [array]$Fields = @(),
        
        # Node.js API parameters
        [switch]$UseNodeJs,
        [string]$ChannelId,
        [hashtable[]]$Components = @()
    )
    
    if ($UseNodeJs -and $ChannelId -and (Get-Command "Send-NodeJsEmbed" -ErrorAction SilentlyContinue)) {
        # Use Node.js API for consistent embed creation
        $data = @{
            title = $Title
            description = $Description
            fields = $Fields
        }
        return Send-NodeJsEmbed -ChannelId $ChannelId -Type "success" -Data $data -Components $Components
    } else {
        return New-StandardEmbed -Title $Title -Description $Description -Color (Get-ColorCode "success") -Fields $Fields
    }
}

function New-WarningEmbed {
    <#
    .SYNOPSIS
    Create warning embed with yellow color - supports Node.js API
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$Title,
        
        [string]$Description,
        [array]$Fields = @(),
        
        # Node.js API parameters
        [switch]$UseNodeJs,
        [string]$ChannelId,
        [hashtable[]]$Components = @()
    )
    
    if ($UseNodeJs -and $ChannelId -and (Get-Command "Send-NodeJsEmbed" -ErrorAction SilentlyContinue)) {
        # Use Node.js API for consistent embed creation
        $data = @{
            title = $Title
            description = $Description
            fields = $Fields
        }
        return Send-NodeJsEmbed -ChannelId $ChannelId -Type "warning" -Data $data -Components $Components
    } else {
        return New-StandardEmbed -Title $Title -Description $Description -Color (Get-ColorCode "warning") -Fields $Fields
    }
}

function New-ErrorEmbed {
    <#
    .SYNOPSIS
    Create error embed with red color - supports Node.js API
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$Title,
        
        [string]$Description,
        [array]$Fields = @(),
        
        # Node.js API parameters
        [switch]$UseNodeJs,
        [string]$ChannelId,
        [hashtable[]]$Components = @()
    )
    
    if ($UseNodeJs -and $ChannelId -and (Get-Command "Send-NodeJsEmbed" -ErrorAction SilentlyContinue)) {
        # Use Node.js API for consistent embed creation
        $data = @{
            title = $Title
            description = $Description
            fields = $Fields
        }
        return Send-NodeJsEmbed -ChannelId $ChannelId -Type "error" -Data $data -Components $Components
    } else {
        return New-StandardEmbed -Title $Title -Description $Description -Color (Get-ColorCode "error") -Fields $Fields
    }
}

function New-InfoEmbed {
    <#
    .SYNOPSIS
    Create info embed with blue color - supports Node.js API
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$Title,
        
        [string]$Description,
        [array]$Fields = @(),
        
        # Node.js API parameters
        [switch]$UseNodeJs,
        [string]$ChannelId,
        [hashtable[]]$Components = @()
    )
    
    if ($UseNodeJs -and $ChannelId -and (Get-Command "Send-NodeJsEmbed" -ErrorAction SilentlyContinue)) {
        # Use Node.js API for consistent embed creation
        $data = @{
            title = $Title
            description = $Description
            fields = $Fields
        }
        return Send-NodeJsEmbed -ChannelId $ChannelId -Type "info" -Data $data -Components $Components
    } else {
        return New-StandardEmbed -Title $Title -Description $Description -Color (Get-ColorCode "info") -Fields $Fields
    }
}

Export-ModuleMember -Function @(
    'New-StandardEmbed',
    'Get-ColorCode',
    'New-EmbedField',
    'New-SuccessEmbed',
    'New-WarningEmbed',
    'New-ErrorEmbed',
    'New-InfoEmbed'
)
