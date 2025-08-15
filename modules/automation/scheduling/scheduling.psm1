# ===============================================================
# SCUM Server Automation - Scheduling System
# ===============================================================
# Automated task scheduling for server restarts and maintenance
# Provides restart warnings, timed execution, and player notifications
# ===============================================================

#Requires -Version 5.1

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
    Write-Host "[WARNING] Common module not available for scheduling module" -ForegroundColor Yellow
}

# Module variables
$script:SchedulingConfig = $null
$script:SkipNextRestart = $false
$script:SkipFlagFile = "data\scum_restart_skip.flag"
$script:RestartWarningDefs = @(
    @{ key = 'restartWarning15'; minutes = 15 },
    @{ key = 'restartWarning5'; minutes = 5 },
    @{ key = 'restartWarning1'; minutes = 1 }
)

# ===============================================================
# INITIALIZATION
# ===============================================================

function Initialize-SchedulingModule {
    <#
    .SYNOPSIS
    Initialize the scheduling module
    .PARAMETER Config
    Configuration object
    #>
    param(
        [Parameter(Mandatory)]
        [object]$Config
    )
    
    $script:SchedulingConfig = $Config
    Write-Log "[Scheduling] Module initialized"
}

function Initialize-RestartWarningSystem {
    <#
    .SYNOPSIS
    Initialize restart warning system with tracking
    .PARAMETER RestartTimes
    Array of restart times in HH:mm format
    .RETURNS
    Hashtable with warning system state
    #>
    param(
        [Parameter(Mandatory)]
        [string[]]$RestartTimes
    )
    
    $nextRestartTime = Get-NextScheduledRestart -RestartTimes $RestartTimes
    $restartWarningSent = @{}
    
    foreach ($def in $script:RestartWarningDefs) { 
        $restartWarningSent[$def.key] = $false 
    }
    
    # Check if restart will be skipped and adjust display accordingly
    $skipStatus = Get-RestartSkipStatus
    if ($skipStatus) {
        # Calculate what the actual next restart will be after skip
        $now = Get-Date
        $today = $now.Date
        $foundNextAfterSkip = $false
        
        # Look for next restart after the one that will be skipped
        foreach ($timeStr in $RestartTimes) {
            $restartTime = [DateTime]::ParseExact("$($today.ToString('yyyy-MM-dd')) $timeStr", "yyyy-MM-dd HH:mm", $null)
            if ($restartTime -gt $nextRestartTime) {
                $nextRestartTime = $restartTime
                $foundNextAfterSkip = $true
                break
            }
        }
        
        # If no restart found today after the skipped one, use tomorrow's first restart
        if (-not $foundNextAfterSkip) {
            $sortedTimes = $RestartTimes | Sort-Object { [DateTime]::ParseExact($_, "HH:mm", $null) }
            $tomorrow = $today.AddDays(1)
            $nextRestartTime = [DateTime]::ParseExact("$($tomorrow.ToString('yyyy-MM-dd')) $($sortedTimes[0])", "yyyy-MM-dd HH:mm", $null)
        }
        
        Write-Log "[Scheduling] Next restart will be skipped, actual next restart: $($nextRestartTime.ToString('yyyy-MM-dd HH:mm:ss'))"
    } else {
        Write-Log "[Scheduling] Next scheduled restart: $($nextRestartTime.ToString('yyyy-MM-dd HH:mm:ss'))"
    }
    
    $initialState = @{
        NextRestartTime = $nextRestartTime
        WarningSent = $restartWarningSent
        RestartPerformedTime = $null
        RestartTimes = $RestartTimes
    }
    
    # Use Write-Output with -NoEnumerate to prevent pipeline from converting to array
    Write-Output $initialState -NoEnumerate
}

# ===============================================================
# WARNING SYSTEM
# ===============================================================

function Update-RestartWarnings {
    <#
    .SYNOPSIS
    Process restart warnings and check if any should be sent
    .PARAMETER WarningState
    Warning system state hashtable
    .PARAMETER CurrentTime
    Current date/time
    .RETURNS
    Updated warning state
    #>
    param(
        [Parameter(Mandatory)]
        [object]$WarningState,
        
        [Parameter()]
        [datetime]$CurrentTime = (Get-Date)
    )
    
    foreach ($def in $script:RestartWarningDefs) {
        $warnTime = $WarningState.NextRestartTime.AddMinutes(-$def.minutes)
        
        if (-not $WarningState.WarningSent[$def.key] -and 
            $CurrentTime -ge $warnTime -and 
            $CurrentTime -lt $warnTime.AddSeconds(30)) {
            
            $timeStr = $WarningState.NextRestartTime.ToString('HH:mm')
            
            # Send Discord notification if available
            if (Get-Command "Send-DiscordNotification" -ErrorAction SilentlyContinue) {
                try {
                    Send-DiscordNotification -Type $def.key -Data @{ time = $timeStr }
                    Write-Log "[Scheduling] Sent restart warning: $($def.key) for restart at $timeStr"
                } catch {
                    Write-Log "[Scheduling] Failed to send restart warning: $($_.Exception.Message)" -Level Warning
                }
            } else {
                Write-Log "[Scheduling] Restart warning would be sent: $($def.key) for restart at $timeStr"
            }
            
            $WarningState.WarningSent[$def.key] = $true
        }
    }
    
    # Ensure we return a proper hashtable by creating a new one using New-Object
    $newWarningState = New-Object System.Collections.Hashtable
    $newWarningState.NextRestartTime = $WarningState.NextRestartTime
    $newWarningState.WarningSent = $WarningState.WarningSent
    $newWarningState.RestartPerformedTime = $WarningState.RestartPerformedTime
    $newWarningState.RestartTimes = $WarningState.RestartTimes
    
    # Use Write-Output with -NoEnumerate to prevent pipeline from converting to array
    Write-Output $newWarningState -NoEnumerate
}

function Test-ScheduledRestartDue {
    <#
    .SYNOPSIS
    Check if scheduled restart is due
    .PARAMETER WarningState
    Warning system state hashtable
    .PARAMETER CurrentTime
    Current date/time
    .RETURNS
    Boolean indicating if restart should be executed
    #>
    param(
        [Parameter(Mandatory)]
        [object]$WarningState,
        
        [Parameter()]
        [datetime]$CurrentTime = (Get-Date)
    )
    
    return ($WarningState.RestartPerformedTime -ne $WarningState.NextRestartTime) -and 
           $CurrentTime -ge $WarningState.NextRestartTime -and 
           $CurrentTime -lt $WarningState.NextRestartTime.AddMinutes(1)
}

# ===============================================================
# RESTART EXECUTION
# ===============================================================

function Invoke-ScheduledRestart {
    <#
    .SYNOPSIS
    Execute scheduled restart with backup
    .PARAMETER WarningState
    Warning system state hashtable
    .PARAMETER ServiceName
    Windows service name
    .PARAMETER SkipRestart
    Skip this restart if requested
    .RETURNS
    Updated warning state
    #>
    param(
        [Parameter(Mandatory)]
        [object]$WarningState,
        
        [Parameter(Mandatory)]
        [string]$ServiceName,
        
        [Parameter()]
        [bool]$SkipRestart = $false
    )
    
    # Check both parameter and script variable for skip flag
    $shouldSkip = $SkipRestart -or $script:SkipNextRestart
    
    # Only process skip if restart is actually due (not during regular monitoring)
    $restartDue = Test-ScheduledRestartDue -WarningState $WarningState
    
    if ($shouldSkip -and $restartDue) {
        Write-Log "[Scheduling] Skipping scheduled restart as requested (parameter: $SkipRestart, flag: $script:SkipNextRestart)"
        
        # Send Discord notification about skipped restart
        if (Get-Command "Send-DiscordNotification" -ErrorAction SilentlyContinue) {
            try {
                $null = Send-DiscordNotification -Type "server.scheduledRestart" -Data @{ 
                    event = ":fast_forward: Scheduled restart at $($WarningState.NextRestartTime.ToString('HH:mm:ss')) was skipped as requested" 
                }
            } catch {
                Write-Log "[Scheduling] Failed to send skip notification: $($_.Exception.Message)" -Level Warning
            }
        }
        
        # Note: In-game notification was already sent immediately when skip was requested
        # No need to send another notification here
        
        # Update restart tracking - mark this restart as performed (skipped)
        $WarningState.RestartPerformedTime = $WarningState.NextRestartTime
        
        # Calculate and set next restart time (same logic as after normal restart)
        $nextRestart = Get-NextScheduledRestart -RestartTimes $WarningState.RestartTimes
        Write-Log "[Scheduling] Next restart calculation: Type='$($nextRestart.GetType().Name)', Value='$nextRestart'" -Level Debug
        $WarningState.NextRestartTime = $nextRestart
        
        # Clear warnings for the new restart time
        $WarningState.WarningsSent = @{}
        Write-Log "[Scheduling] Next scheduled restart: $($WarningState.NextRestartTime.ToString('yyyy-MM-dd HH:mm:ss'))"
        
        # Clear the skip flag ONLY after successfully processing the skip
        Clear-RestartSkip
        
        # Return the hashtable directly for skip case
        Write-Log "[Scheduling] Returning WarningState from Invoke-ScheduledRestart (skip): Type='$($WarningState.GetType().Name)'" -Level Debug
        Write-Output $WarningState -NoEnumerate
        return
    } elseif ($restartDue) {
        Write-Log "[Scheduling] Executing scheduled restart"
        
        if (Get-Command "Send-DiscordNotification" -ErrorAction SilentlyContinue) {
            try {
                Send-DiscordNotification -Type "server.scheduledRestart" -Data @{ time = $WarningState.NextRestartTime.ToString('HH:mm:ss') }
            } catch {
                Write-Log "[Scheduling] Failed to send restart notification: $($_.Exception.Message)" -Level Warning
            }
        }
        
        # Create backup before restart (if enabled)
        try {
            $preRestartBackupEnabled = Get-SafeConfigValue $script:SchedulingConfig "preRestartBackupEnabled" $false
            
            if ($preRestartBackupEnabled) {
                # Use direct config values instead of Get-ConfigPath
                $savedDir = if ($script:SchedulingConfig.savedDir) { $script:SchedulingConfig.savedDir } else { $null }
                $backupRoot = if ($script:SchedulingConfig.backupRoot) { $script:SchedulingConfig.backupRoot } else { $null }
                $maxBackups = Get-SafeConfigValue $script:SchedulingConfig "maxBackups" 10
                $compressBackups = Get-SafeConfigValue $script:SchedulingConfig "compressBackups" $true
                
                if ($savedDir -and $backupRoot -and (Get-Command "Invoke-GameBackup" -ErrorAction SilentlyContinue)) {
                    Write-Log "[Scheduling] Creating backup: $savedDir -> $backupRoot" -Level Info
                    $null = Invoke-GameBackup -SourcePath $savedDir -BackupRoot $backupRoot -MaxBackups $maxBackups -CompressBackups $compressBackups
                    Write-Log "[Scheduling] Pre-restart backup completed"
                } else {
                    Write-Log "[Scheduling] Backup skipped - savedDir: '$savedDir', backupRoot: '$backupRoot', function available: $(if (Get-Command "Invoke-GameBackup" -ErrorAction SilentlyContinue) { 'Yes' } else { 'No' })" -Level Warning
                }
            } else {
                Write-Log "[Scheduling] Pre-restart backup disabled by configuration" -Level Info
            }
        } catch {
            Write-Log "[Scheduling] Backup failed: $($_.Exception.Message)" -Level Warning
        }
        
        # Restart service
        try {
            if (Get-Command "Restart-GameService" -ErrorAction SilentlyContinue) {
                $null = Restart-GameService -ServiceName $ServiceName -Reason "scheduled restart"
                Write-Log "[Scheduling] Service restart command executed"
            } else {
                Write-Log "[Scheduling] Restart-GameService function not available" -Level Warning
            }
        } catch {
            Write-Log "[Scheduling] Service restart failed: $($_.Exception.Message)" -Level Error
        }
        
        # Update restart tracking and move to next restart
        $WarningState.RestartPerformedTime = $WarningState.NextRestartTime
        
        # Get next restart time and debug its type
        $nextRestart = Get-NextScheduledRestart -RestartTimes $WarningState.RestartTimes
        Write-Log "[Scheduling] Next restart calculation: Type='$($nextRestart.GetType().Name)', Value='$nextRestart'" -Level Debug
        $WarningState.NextRestartTime = $nextRestart
        
        # Reset warning flags
        foreach ($def in $script:RestartWarningDefs) { 
            $WarningState.WarningSent[$def.key] = $false 
        }
        
        Write-Log "[Scheduling] Next scheduled restart: $($WarningState.NextRestartTime.ToString('yyyy-MM-dd HH:mm:ss'))"
    } else {
        # Restart not due yet - just return current state
        Write-Log "[Scheduling] Restart not due yet, returning current state" -Level Debug
    }
    
    # Return the original hashtable directly to avoid type conversion issues
    Write-Log "[Scheduling] Returning WarningState from Invoke-ScheduledRestart: Type='$($WarningState.GetType().Name)'" -Level Debug
    
    # Use Write-Output with -NoEnumerate to prevent pipeline from converting to array
    Write-Output $WarningState -NoEnumerate
}

function Get-RestartWarningDefinitions {
    <#
    .SYNOPSIS
    Get restart warning definitions
    .RETURNS
    Array of warning definitions
    #>
    
    return $script:RestartWarningDefs
}

function Set-RestartSkip {
    <#
    .SYNOPSIS
    Set flag to skip the next scheduled restart with persistent storage
    #>
    param()
    
    $script:SkipNextRestart = $true
    
    # Save to persistent file
    try {
        Set-Content -Path $script:SkipFlagFile -Value "true" -Force
    } catch {
        Write-Log "Failed to save skip flag to file: $($_.Exception.Message)" -Level Warning
    }
    
    # Log the skip action
    Write-Log "[Scheduling] Next scheduled restart will be skipped" -Level Info
    
    return $true
}

function Clear-RestartSkip {
    <#
    .SYNOPSIS
    Clear the restart skip flag with persistent storage
    #>
    param()
    
    $script:SkipNextRestart = $false
    
    # Remove persistent file
    try {
        if (Test-Path $script:SkipFlagFile) {
            Remove-Item -Path $script:SkipFlagFile -Force
        }
    } catch {
        Write-Log "Failed to remove skip flag file: $($_.Exception.Message)" -Level Warning
    }
    
    # Log the clear action
    Write-Log "[Scheduling] Restart skip flag cleared" -Level Info
    
    return $true
}

function Get-RestartSkipStatus {
    <#
    .SYNOPSIS
    Get current restart skip status with persistent storage check
    #>
    param()
    
    # Check persistent file first
    try {
        if (Test-Path $script:SkipFlagFile) {
            # MEMORY LEAK FIX: Use simple file read instead of Get-Content for small files
            $fileContent = [System.IO.File]::ReadAllText($script:SkipFlagFile).Trim()
            if ($fileContent -eq "true") {
                $script:SkipNextRestart = $true
            }
        } else {
            $script:SkipNextRestart = $false
        }
    } catch {
        Write-Log "Failed to read skip flag file: $($_.Exception.Message)" -Level Debug
    }
    
    return $script:SkipNextRestart
}

function Set-RestartWarningDefinitions {
    <#
    .SYNOPSIS
    Set custom restart warning definitions
    .PARAMETER Definitions
    Array of warning definitions
    #>
    param(
        [Parameter(Mandatory)]
        [array]$Definitions
    )
    
    $script:RestartWarningDefs = $Definitions
    Write-Log "[Scheduling] Updated restart warning definitions: $($Definitions.Count) warnings configured"
}

function Get-SchedulingStats {
    <#
    .SYNOPSIS
    Get scheduling statistics and information
    .PARAMETER WarningState
    Warning system state hashtable
    .RETURNS
    Hashtable with scheduling information
    #>
    param(
        [Parameter()]
        [hashtable]$WarningState
    )
    
    if (-not $WarningState) {
        return @{
            Initialized = $false
            NextRestart = $null
            WarningsConfigured = $script:RestartWarningDefs.Count
        }
    }
    
    $now = Get-Date
    $timeToRestart = if ($WarningState.NextRestartTime) {
        ($WarningState.NextRestartTime - $now).TotalMinutes
    } else { $null }
    
    return @{
        Initialized = $true
        NextRestart = $WarningState.NextRestartTime
        TimeToRestartMinutes = $timeToRestart
        WarningsConfigured = $script:RestartWarningDefs.Count
        WarningSentStatus = $WarningState.WarningSent
        LastRestartPerformed = $WarningState.RestartPerformedTime
    }
}

function Invoke-ManualRestart {
    <#
    .SYNOPSIS
    Execute manual restart with backup (respects preRestartBackupEnabled setting)
    .PARAMETER ServiceName
    Windows service name
    .PARAMETER Config
    Configuration object (optional - will use script config if not provided)
    #>
    param(
        [Parameter(Mandatory)]
        [string]$ServiceName,
        
        [Parameter()]
        [object]$Config = $null
    )
    
    Write-Log "[Scheduling] Executing manual restart for service: $ServiceName"
    
    # Use provided config or script config
    $configToUse = if ($Config) { $Config } else { $script:SchedulingConfig }
    
    # Create backup before restart (if enabled)
    try {
        # Check if config is available
        if (-not $configToUse) {
            Write-Log "[Scheduling] Pre-restart backup disabled (config not available)" -Level Info
        } else {
            $preRestartBackupEnabled = Get-SafeConfigValue $configToUse "preRestartBackupEnabled" $false
            
            if ($preRestartBackupEnabled) {
                # Use direct config values instead of Get-ConfigPath
                $savedDir = if ($configToUse.savedDir) { $configToUse.savedDir } else { $null }
                $backupRoot = if ($configToUse.backupRoot) { $configToUse.backupRoot } else { $null }
                $maxBackups = Get-SafeConfigValue $configToUse "maxBackups" 10
                $compressBackups = Get-SafeConfigValue $configToUse "compressBackups" $true
                
                if ($savedDir -and $backupRoot -and (Get-Command "Invoke-GameBackup" -ErrorAction SilentlyContinue)) {
                    Write-Log "[Scheduling] Creating backup: $savedDir -> $backupRoot" -Level Info
                    $null = Invoke-GameBackup -SourcePath $savedDir -BackupRoot $backupRoot -MaxBackups $maxBackups -CompressBackups $compressBackups
                    Write-Log "[Scheduling] Pre-restart backup completed"
                } else {
                    Write-Log "[Scheduling] Backup skipped - savedDir: '$savedDir', backupRoot: '$backupRoot', function available: $(if (Get-Command "Invoke-GameBackup" -ErrorAction SilentlyContinue) { 'Yes' } else { 'No' })" -Level Warning
                }
            } else {
                Write-Log "[Scheduling] Pre-restart backup disabled by configuration" -Level Info
            }
        }
    } catch {
        Write-Log "[Scheduling] Backup failed: $($_.Exception.Message)" -Level Warning
    }
    
    # Restart service
    try {
        if (Get-Command "Restart-GameService" -ErrorAction SilentlyContinue) {
            $null = Restart-GameService -ServiceName $ServiceName -Reason "manual restart"
            Write-Log "[Scheduling] Service restart command executed"
        } else {
            Write-Log "[Scheduling] Restart-GameService function not available" -Level Warning
        }
    } catch {
        Write-Log "[Scheduling] Service restart failed: $($_.Exception.Message)" -Level Error
    }
}

# Export module functions
Export-ModuleMember -Function @(
    'Initialize-SchedulingModule',
    'Get-NextScheduledRestart',
    'Initialize-RestartWarningSystem',
    'Update-RestartWarnings',
    'Test-ScheduledRestartDue',
    'Invoke-ScheduledRestart',
    'Invoke-ManualRestart',
    'Get-RestartWarningDefinitions',
    'Set-RestartWarningDefinitions',
    'Set-RestartSkip',
    'Clear-RestartSkip',
    'Get-RestartSkipStatus',
    'Get-SchedulingStats'
)
