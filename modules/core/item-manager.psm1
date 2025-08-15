# ===============================================================
# SCUM Server - Item Manager Module
# Handles item name conversion and item-related utilities
# ===============================================================

# Standard import of common module
try {
    $helperPath = Join-Path $PSScriptRoot "..\..\core\module-helper.psm1"
    if (Test-Path $helperPath) {
        # MEMORY LEAK FIX: Check if module already loaded before importing
        if (-not (Get-Module "module-helper" -ErrorAction SilentlyContinue)) {
            Import-Module $helperPath -ErrorAction SilentlyContinue
        }
        Import-CommonModule | Out-Null
    }
} catch {
    Write-Host "[WARNING] Common module not available for discord-integration module" -ForegroundColor Yellow
}

# Global variable to cache item data
$script:ItemsData = $null

function Initialize-ItemsData {
    <#
    .SYNOPSIS
        Initializes the items database from scum_items.json
    
    .DESCRIPTION
        Loads item mappings from JSON file and caches them in memory
        for fast lookup operations
    #>
    
    if ($script:ItemsData -eq $null) {
        try {
            $itemsPath = Join-Path $PSScriptRoot "..\..\data\scum_items.json"
            if (Test-Path $itemsPath) {
                $itemsArray = Get-Content $itemsPath -Raw | ConvertFrom-Json
                
                # Convert array to hashtable for faster lookup  
                $script:ItemsData = @{}
                foreach ($item in $itemsArray) {
                    if ($item.id -and $item.name) {
                        $script:ItemsData[$item.id] = $item.name
                    }
                }
                
                Write-Log "Items database loaded: $($script:ItemsData.Count) items" -Level Info
            } else {
                Write-Log "Items database not found at: $itemsPath" -Level Warning
                $script:ItemsData = @{}
            }
        } catch {
            Write-Log "Failed to load items database: $($_.Exception.Message)" -Level Error
            $script:ItemsData = @{}
        }
    }
}

function Get-ItemDisplayName {
    <#
    .SYNOPSIS
        Converts SCUM item ID to human-readable name
    
    .PARAMETER ItemId
        The SCUM internal item ID (e.g., "1H_ImprovisedKnife")
    
    .RETURNS
        Human-readable item name or original ID if not found
    
    .EXAMPLE
        Get-ItemDisplayName "1H_ImprovisedKnife"
        # Returns: "Stone Knife"
    #>
    param(
        [string]$ItemId
    )
    
    # Initialize items data if not loaded
    Initialize-ItemsData
    
    # Clean up the ItemId (remove quantity info)
    $cleanItemId = $ItemId -replace " \(x\d+\)", ""
    
    # Return readable name if found, otherwise return original ID
    if ($script:ItemsData -and $script:ItemsData.ContainsKey($cleanItemId)) {
        return $script:ItemsData[$cleanItemId]
    } else {
        # Try without _C suffix (common in SCUM blueprints)
        if ($cleanItemId -match "(.+)_C$") {
            $withoutC = $matches[1]
            if ($script:ItemsData.ContainsKey($withoutC)) {
                return $script:ItemsData[$withoutC]
            }
        }
        
        # Fallback: try to make ItemId more readable
        $readable = $cleanItemId -replace "_C$", "" -replace "_", " "
        $readable = $readable -replace "^(1H|2H)\s+", ""  # Remove weapon prefixes
        $readable = $readable -replace "^Weapon\s+", ""  # Remove Weapon prefix
        return $readable.Trim()
    }
}

function Get-ItemInfo {
    <#
    .SYNOPSIS
        Gets comprehensive item information
    
    .PARAMETER ItemId
        The SCUM internal item ID
    
    .RETURNS
        Hashtable with ItemId and DisplayName
    
    .EXAMPLE
        Get-ItemInfo "1H_ImprovisedKnife"
        # Returns: @{ ItemId = "1H_ImprovisedKnife"; DisplayName = "Stone Knife" }
    #>
    param(
        [string]$ItemId
    )
    
    return @{
        ItemId = $ItemId
        DisplayName = Get-ItemDisplayName $ItemId
    }
}

function Test-ItemExists {
    <#
    .SYNOPSIS
        Checks if item exists in database
    
    .PARAMETER ItemId
        The SCUM internal item ID to check
    
    .RETURNS
        $true if item exists in database, $false otherwise
    #>
    param(
        [string]$ItemId
    )
    
    Initialize-ItemsData
    return ($script:ItemsData -and $script:ItemsData.ContainsKey($ItemId))
}

function Get-ItemsCount {
    <#
    .SYNOPSIS
        Gets total count of items in database
    
    .RETURNS
        Number of items in database
    #>
    
    Initialize-ItemsData
    if ($script:ItemsData) {
        return $script:ItemsData.Count
    }
    return 0
}

# Export functions
Export-ModuleMember -Function @(
    'Initialize-ItemsData',
    'Get-ItemDisplayName', 
    'Get-ItemInfo',
    'Test-ItemExists',
    'Get-ItemsCount'
)
