# ===============================================================
# SCUM Server Automation - Admin Database Module
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
    Write-Host "[WARNING] Common module not available for admin database module" -ForegroundColor Yellow
}

# Module variables
$script:DatabasePath = $null
$script:SqliteExePath = $null

# Module initialization function
function Initialize-AdminModule {
    param([string]$DatabasePath, [string]$SqliteExePath)
    
    try {
        $script:DatabasePath = $DatabasePath
        $script:SqliteExePath = $SqliteExePath
        
        Write-Log "[Admin] Module initialized successfully"
        Write-Log "[Admin] Database: $DatabasePath"
        return @{ Success = $true }
    } catch {
        Write-Log "[Admin] Failed to initialize: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

# Export functions
Export-ModuleMember -Function @(
    'Initialize-AdminModule'
)
