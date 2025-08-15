# ===============================================================
# SCUM Server Automation - Module Helper
# ===============================================================
# Shared initialization functions for all modules
# Provides centralized logging and common functionality import
# ===============================================================

#Requires -Version 5.1

function Import-CommonModule {
    <#
    .SYNOPSIS
    Import common module with fallback logging if not available
    #>
    param()
    
    try {
        # Try to find common module relative to current module
        $commonModulePath = $null
        $currentPath = $PSScriptRoot
        
        # Search up the directory tree for common module
        while ($currentPath -and -not $commonModulePath) {
            $testPath = Join-Path $currentPath "core\common\common.psm1"
            if (Test-Path $testPath) {
                $commonModulePath = $testPath
                break
            }
            
            $testPath = Join-Path $currentPath "..\core\common\common.psm1"
            if (Test-Path $testPath) {
                $commonModulePath = $testPath
                break
            }
            
            $testPath = Join-Path $currentPath "..\..\core\common\common.psm1"
            if (Test-Path $testPath) {
                $commonModulePath = $testPath
                break
            }
            
            $parentPath = Split-Path $currentPath -Parent
            if ($parentPath -eq $currentPath) { break }
            $currentPath = $parentPath
        }
        
        if ($commonModulePath -and (Test-Path $commonModulePath)) {
            # Only import if Write-Log is not available to avoid resetting log configuration
            if (-not (Get-Command "Write-Log" -ErrorAction SilentlyContinue)) {
                # MEMORY LEAK FIX: Check if common module already loaded before importing
                if (-not (Get-Module "common" -ErrorAction SilentlyContinue)) {
                    Import-Module $commonModulePath -Global -ErrorAction SilentlyContinue
                }
            }
            return $true
        }
    } catch {
        # Ignore import errors
    }
    
    # Create fallback logging functions
    if (-not (Get-Command "Write-Log" -ErrorAction SilentlyContinue)) {
        function global:Write-Log {
            param(
                [Parameter(Mandatory)]
                [string]$Message,
                [string]$Level = "Info"
            )
            
            $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
            $levelPrefix = switch ($Level) {
                'Error' { '[ERROR]' }
                'Warning' { '[WARN]' }
                'Debug' { '[DEBUG]' }
                default { '[INFO]' }
            }
            Write-Host "$timestamp $levelPrefix $Message"
        }
    }
    
    return $false
}

# Export the function
Export-ModuleMember -Function 'Import-CommonModule'
