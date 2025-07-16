# ===============================================================
# SCUM Server Automation - Discord Embed Templates
# ===============================================================
# Standardized Discord embed styles and formatting templates
# Provides consistent visual styling across all Discord messages
# ===============================================================

function New-StandardEmbed {
    <#
    .SYNOPSIS
    Create standard embed with consistent styling
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
        }
    )
    
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

# Notification embed helper functions
function New-SuccessEmbed {
    <#
    .SYNOPSIS
    Create success embed with green color
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$Title,
        
        [string]$Description,
        [array]$Fields = @()
    )
    
    return New-StandardEmbed -Title $Title -Description $Description -Color (Get-ColorCode "success") -Fields $Fields
}

function New-WarningEmbed {
    <#
    .SYNOPSIS
    Create warning embed with yellow color
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$Title,
        
        [string]$Description,
        [array]$Fields = @()
    )
    
    return New-StandardEmbed -Title $Title -Description $Description -Color (Get-ColorCode "warning") -Fields $Fields
}

function New-ErrorEmbed {
    <#
    .SYNOPSIS
    Create error embed with red color
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$Title,
        
        [string]$Description,
        [array]$Fields = @()
    )
    
    return New-StandardEmbed -Title $Title -Description $Description -Color (Get-ColorCode "error") -Fields $Fields
}

function New-InfoEmbed {
    <#
    .SYNOPSIS
    Create info embed with blue color
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$Title,
        
        [string]$Description,
        [array]$Fields = @()
    )
    
    return New-StandardEmbed -Title $Title -Description $Description -Color (Get-ColorCode "info") -Fields $Fields
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
