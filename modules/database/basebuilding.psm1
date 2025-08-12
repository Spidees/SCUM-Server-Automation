# ===============================================================
# SCUM Server Automation - Base Building Database Module
# ===============================================================

#Requires -Version 5.1

# Standard import of common module
try {
    $helperPath = Join-Path $PSScriptRoot "..\core\module-helper.psm1"
    if (Test-Path $helperPath) {
        Import-Module $helperPath -Force -ErrorAction SilentlyContinue
        Import-CommonModule | Out-Null
    }
} catch {
    Write-Host "[WARNING] Common module not available for basebuilding database module" -ForegroundColor Yellow
}

# Module variables
$script:DatabasePath = $null
$script:SqliteExePath = $null

# Module initialization function
function Initialize-BaseBuildingModule {
    param([string]$DatabasePath, [string]$SqliteExePath)
    
    try {
        $script:DatabasePath = $DatabasePath
        $script:SqliteExePath = $SqliteExePath
        
        Write-Log "[BaseBuilding] Module initialized successfully"
        Write-Log "[BaseBuilding] Database: $DatabasePath"
        return @{ Success = $true }
    } catch {
        Write-Log "[BaseBuilding] Failed to initialize: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

# Get total base count
function Get-BaseCount {
    try {
        $result = Invoke-DatabaseQuery -Query "SELECT COUNT(*) as BaseCount FROM base"
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            return [int]$result.Data[0].BaseCount
        }
        return 0
    } catch {
        return 0
    }
}

# Get total base elements count
function Get-BaseElementCount {
    try {
        $result = Invoke-DatabaseQuery -Query "SELECT COUNT(*) as ElementCount FROM base_element"
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            return [int]$result.Data[0].ElementCount
        }
        return 0
    } catch {
        return 0
    }
}

# Get base information
function Get-BaseInfo {
    try {
        $query = "SELECT b.id, b.name, b.location_x, b.location_y, b.size_x, b.size_y, 
                         u.name as OwnerName, b.is_owned_by_player 
                  FROM base b 
                  LEFT JOIN user_profile u ON b.owner_user_profile_id = u.id 
                  WHERE u.type != 2 OR u.type IS NULL 
                  ORDER BY b.id"
        
        $result = Invoke-DatabaseQuery -Query $query
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            return @{
                Success = $true
                Data = $result.Data
                Count = $result.Data.Count
                TotalBases = $result.Data.Count
            }
        }
        
        return @{ Success = $false; Error = "No base data found"; Count = 0 }
    } catch {
        return @{ Success = $false; Error = "Failed to retrieve base info"; Count = 0 }
    }
}

# Get top base builders by element count
function Get-TopBaseBuilders {
    param([int]$Limit = 10)
    
    try {
        $query = "SELECT u.name as Name, COUNT(be.element_id) as ElementCount 
                  FROM user_profile u 
                  JOIN base_element be ON u.id = be.owner_profile_id 
                  WHERE u.type != 2 
                  GROUP BY u.id, u.name 
                  ORDER BY ElementCount DESC 
                  LIMIT $Limit"
        
        $result = Invoke-DatabaseQuery -Query $query
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.ElementCount
                    FormattedValue = "$([int]$_.ElementCount) elements built"
                }
            }
        }
        return @()
    } catch {
        return @()
    }
}

# Get base statistics by owner
function Get-BaseStatsByOwner {
    param([int]$Limit = 10)
    
    try {
        $query = "SELECT u.name as OwnerName, 
                         COUNT(b.id) as BaseCount, 
                         AVG(b.size_x * b.size_y) as AvgSize 
                  FROM base b 
                  JOIN user_profile u ON b.owner_user_profile_id = u.id 
                  WHERE u.type != 2 AND b.is_owned_by_player = 1 
                  GROUP BY u.id, u.name 
                  ORDER BY BaseCount DESC 
                  LIMIT $Limit"
        
        $result = Invoke-DatabaseQuery -Query $query
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    OwnerName = $_.OwnerName
                    BaseCount = [int]$_.BaseCount
                    AvgSize = [math]::Round([double]$_.AvgSize, 2)
                    FormattedStats = "$([int]$_.BaseCount) bases, avg size: $([math]::Round([double]$_.AvgSize, 2))"
                }
            }
        }
        return @()
    } catch {
        return @()
    }
}

# Get largest bases by size
function Get-LargestBases {
    param([int]$Limit = 10)
    
    try {
        $query = "SELECT b.name as BaseName, 
                         u.name as OwnerName, 
                         (b.size_x * b.size_y) as TotalSize, 
                         b.size_x, 
                         b.size_y 
                  FROM base b 
                  LEFT JOIN user_profile u ON b.owner_user_profile_id = u.id 
                  WHERE (u.type != 2 OR u.type IS NULL) 
                  ORDER BY TotalSize DESC 
                  LIMIT $Limit"
        
        $result = Invoke-DatabaseQuery -Query $query
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    BaseName = if ($_.BaseName) { $_.BaseName } else { "Unnamed Base" }
                    OwnerName = if ($_.OwnerName) { $_.OwnerName } else { "Unknown" }
                    TotalSize = [math]::Round([double]$_.TotalSize, 2)
                    Dimensions = "$([math]::Round([double]$_.size_x, 1)) x $([math]::Round([double]$_.size_y, 1))"
                    FormattedSize = "$([math]::Round([double]$_.TotalSize, 2)) unitsÂ˛"
                }
            }
        }
        return @()
    } catch {
        return @()
    }
}

# Get base element statistics by type
function Get-BaseElementStats {
    param([int]$Limit = 10)
    
    try {
        $query = "SELECT asset, COUNT(*) as ElementCount 
                  FROM base_element 
                  WHERE asset IS NOT NULL 
                  GROUP BY asset 
                  ORDER BY ElementCount DESC 
                  LIMIT $Limit"
        
        $result = Invoke-DatabaseQuery -Query $query
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    AssetType = $_.asset
                    Count = [int]$_.ElementCount
                    FormattedCount = "$([int]$_.ElementCount) elements"
                }
            }
        }
        return @()
    } catch {
        return @()
    }
}

# Get raid protection statistics
function Get-RaidProtectionStats {
    try {
        $query = "SELECT COUNT(*) as ProtectedBases FROM base_raid_protection"
        $result = Invoke-DatabaseQuery -Query $query
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            $protectedBases = [int]$result.Data[0].ProtectedBases
            $totalBases = Get-BaseCount
            
            return @{
                ProtectedBases = $protectedBases
                UnprotectedBases = $totalBases - $protectedBases
                TotalBases = $totalBases
                ProtectionPercentage = if ($totalBases -gt 0) { [math]::Round(($protectedBases / $totalBases) * 100, 1) } else { 0 }
                Success = $true
            }
        }
        
        return @{ ProtectedBases = 0; UnprotectedBases = 0; TotalBases = 0; ProtectionPercentage = 0; Success = $false }
    } catch {
        return @{ ProtectedBases = 0; UnprotectedBases = 0; TotalBases = 0; ProtectionPercentage = 0; Success = $false }
    }
}

# Get comprehensive base building summary
function Get-BaseBuildingSummary {
    $baseCount = Get-BaseCount
    $elementCount = Get-BaseElementCount
    $protectionStats = Get-RaidProtectionStats
    $topBuilders = Get-TopBaseBuilders -Limit 5
    $largestBases = Get-LargestBases -Limit 3
    
    return @{
        Overview = @{
            TotalBases = $baseCount
            TotalElements = $elementCount
            AvgElementsPerBase = if ($baseCount -gt 0) { [math]::Round($elementCount / $baseCount, 1) } else { 0 }
        }
        Protection = @{
            ProtectedBases = $protectionStats.ProtectedBases
            UnprotectedBases = $protectionStats.UnprotectedBases
            ProtectionPercentage = $protectionStats.ProtectionPercentage
        }
        TopBuilders = $topBuilders
        LargestBases = $largestBases
        LastUpdated = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    }
}

# Export functions
Export-ModuleMember -Function @(
    'Initialize-BaseBuildingModule',
    'Get-BaseCount',
    'Get-BaseElementCount',
    'Get-BaseInfo',
    'Get-TopBaseBuilders',
    'Get-BaseStatsByOwner',
    'Get-LargestBases',
    'Get-BaseElementStats',
    'Get-RaidProtectionStats',
    'Get-BaseBuildingSummary'
)
