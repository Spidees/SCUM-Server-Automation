# ===============================================================
# SCUM Server Automation - Service Management
# ===============================================================
# Windows service control and management for SCUM server
# Handles start, stop, restart operations with proper monitoring
# ===============================================================

#Requires -Version 5.1

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

    # MEMORY LEAK FIX: Import log streaming helper - check if already loaded
    $streamingPath = Join-Path $PSScriptRoot "..\..\core\log-streaming.psm1"
    if (Test-Path $streamingPath) {
        if (-not (Get-Module "log-streaming" -ErrorAction SilentlyContinue)) {
            Import-Module $streamingPath -ErrorAction SilentlyContinue
        }
    }
        
} catch {
    Write-Host "[WARNING] Common module not available for services module" -ForegroundColor Yellow
}

# Process tracking to reduce verbose logging
$script:LastKnownScumPid = $null

# ===============================================================
# SERVICE CONTROL
# ===============================================================

function Test-GameProcessHealth {
    <#
    .SYNOPSIS
    Check if SCUM server process is actually running and healthy
    .PARAMETER ServiceName
    Name of the Windows service
    .PARAMETER ServerDirectory
    Path to server directory (for log checking)
    .RETURNS
    Hashtable with health status
    #>
    param(
        [Parameter(Mandatory)]
        [string]$ServiceName,
        
        [Parameter()]
        [string]$ServerDirectory
    )
    
    try {
        # Check if service is running
        $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if (-not $service -or $service.Status -ne 'Running') {
            return @{
                IsHealthy = $false
                Reason = "Service not running"
                ServiceStatus = if ($service) { $service.Status } else { "Not Found" }
                ProcessFound = $false
                DatabaseResponsive = $false
            }
        }
        
        # Get the actual process from the service
        $serviceProcess = $null
        $scumProcess = $null
        $processFound = $false
        $serviceWmi = $null
        $childProcesses = $null
        try {
            # Get the service and its process ID
            $serviceWmi = Get-WmiObject -Class Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
            if ($serviceWmi -and $serviceWmi.ProcessId -and $serviceWmi.ProcessId -gt 0) {
                $serviceProcess = Get-Process -Id $serviceWmi.ProcessId -ErrorAction SilentlyContinue
                
                # Check if this is NSSM (service wrapper)
                if ($serviceProcess -and $serviceProcess.ProcessName -eq "nssm") {
                    # Find the actual SCUM server process (child of NSSM)
                    $childProcesses = Get-WmiObject -Class Win32_Process | Where-Object { $_.ParentProcessId -eq $serviceProcess.Id }
                    $scumChild = $childProcesses | Where-Object { $_.Name -like "*SCUM*" -or $_.Name -like "*Server*" }
                    
                    if ($scumChild) {
                        $scumProcess = Get-Process -Id $scumChild.ProcessId -ErrorAction SilentlyContinue
                        $processFound = $null -ne $scumProcess
                        # Only log SCUM process detection on first discovery or PID change
                        if (-not $script:LastKnownScumPid -or $script:LastKnownScumPid -ne $scumProcess.Id) {
                            Write-Log "[Service] Found SCUM process via NSSM: $($scumProcess.ProcessName) PID $($scumProcess.Id)" -Level Warning
                            $script:LastKnownScumPid = $scumProcess.Id
                        }
                    } else {
                        # Always log when SCUM process is missing (this is important)
                        Write-Log "[Service] NSSM service running but no SCUM child process found" -Level Warning
                        $script:LastKnownScumPid = $null
                    }
                } else {
                    # Direct service process
                    $scumProcess = $serviceProcess
                    $processFound = $null -ne $serviceProcess
                }
            }
        } catch {
            Write-Log "[Service] Could not get process from service: $($_.Exception.Message)" -Level Warning
        }
        
        # Check database responsiveness (if database module is available)
        $databaseResponsive = $false
        if (Get-Command "Test-DatabaseConnection" -ErrorAction SilentlyContinue) {
            try {
                $dbTest = Test-DatabaseConnection
                $databaseResponsive = $dbTest.Success
            } catch {
                Write-Log "[Service] Database connectivity check failed: $($_.Exception.Message)" -Level Warning
            }
        }
        
        # Check server log for recent activity (if server directory provided)
        $logActive = $false
        if ($ServerDirectory) {
            $logPath = Join-Path $ServerDirectory "SCUM\Saved\Logs\SCUM.log"
            if (Test-Path $logPath) {
                try {
                    $logInfo = Get-Item $logPath
                    $lastWrite = $logInfo.LastWriteTime
                    $timeSinceLastWrite = (Get-Date) - $lastWrite
                    $logActive = $timeSinceLastWrite.TotalMinutes -lt 15 # Log active in last 15 minutes
                } catch {
                    Write-Log "[Service] Could not check log file: $($_.Exception.Message)" -Level Warning
                }
            }
        }
        
        # Determine overall health
        $isHealthy = $processFound -and ($databaseResponsive -or $logActive)
        
        $reason = if (-not $processFound) {
            "Service process not found or not running"
        } elseif (-not $databaseResponsive -and -not $logActive) {
            "Server unresponsive (no DB access and no recent log activity)"
        } else {
            "Healthy"
        }
        
        return @{
            IsHealthy = $isHealthy
            Reason = $reason
            ServiceStatus = $service.Status
            ProcessFound = $processFound
            ServiceProcessId = if ($serviceProcess) { $serviceProcess.Id } else { $null }
            ServiceProcessName = if ($serviceProcess) { $serviceProcess.ProcessName } else { $null }
            ScumProcessId = if ($scumProcess) { $scumProcess.Id } else { $null }
            ScumProcessName = if ($scumProcess) { $scumProcess.ProcessName } else { $null }
            DatabaseResponsive = $databaseResponsive
            LogActive = $logActive
        }
        
    } catch {
        Write-Log "[Service] Error checking game process health: $($_.Exception.Message)" -Level Error
        return @{
            IsHealthy = $false
            Reason = "Health check failed: $($_.Exception.Message)"
            ServiceStatus = "Unknown"
            ProcessFound = $false
            DatabaseResponsive = $false
        }
    } finally {
        # Clean up WMI and Process objects to prevent memory leaks
        if ($serviceWmi) { $serviceWmi = $null }
        if ($childProcesses) { $childProcesses = $null }
        if ($serviceProcess) { 
            try { $serviceProcess.Dispose() } catch {}
            $serviceProcess = $null 
        }
        if ($scumProcess) { 
            try { $scumProcess.Dispose() } catch {}
            $scumProcess = $null 
        }
    }
}

function Repair-GameService {
    <#
    .SYNOPSIS
    Repair a service that's running but the game process is dead
    .PARAMETER ServiceName
    Name of the Windows service
    .PARAMETER Reason
    Reason for repair
    .PARAMETER SkipNotifications
    Skip sending repair notifications
    #>
    param(
        [Parameter(Mandatory)]
        [string]$ServiceName,
        
        [Parameter()]
        [string]$Reason = "process health repair",
        
        [Parameter()]
        [switch]$SkipNotifications
    )
    
    Write-Log "[Service] Repairing service '$ServiceName' - $Reason"
    
    try {
        # First try to stop gracefully
        Write-Log "[Service] Attempting graceful service stop..."
        $stopResult = Stop-GameService -ServiceName $ServiceName -Reason $Reason -SkipNotifications:$SkipNotifications
        
        if (-not $stopResult) {
            Write-Log "[Service] Graceful stop failed, forcing process termination..."
            
            # Get the actual process from the service and kill it
            $serviceWmi = $null
            $serviceProcess = $null
            $childProcesses = $null
            try {
                $serviceWmi = Get-WmiObject -Class Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
                if ($serviceWmi -and $serviceWmi.ProcessId -and $serviceWmi.ProcessId -gt 0) {
                    $serviceProcess = Get-Process -Id $serviceWmi.ProcessId -ErrorAction SilentlyContinue
                    
                    if ($serviceProcess -and $serviceProcess.ProcessName -eq "nssm") {
                        # Kill SCUM child processes first
                        $childProcesses = Get-WmiObject -Class Win32_Process | Where-Object { $_.ParentProcessId -eq $serviceProcess.Id }
                        foreach ($child in $childProcesses) {
                            $childProc = Get-Process -Id $child.ProcessId -ErrorAction SilentlyContinue
                            if ($childProc) {
                                Write-Log "[Service] Force stopping child process '$($childProc.ProcessName)' PID $($childProc.Id)"
                                try {
                                    $childProc.Kill()
                                } finally {
                                    $childProc.Dispose()
                                }
                            }
                        }
                        Start-Sleep -Seconds 2
                        
                        # Then kill NSSM itself
                        Write-Log "[Service] Force stopping NSSM service process PID $($serviceProcess.Id)"
                        try {
                            $serviceProcess.Kill()
                        } finally {
                            $serviceProcess.Dispose()
                        }
                    } else {
                        # Direct service process
                        Write-Log "[Service] Force stopping service process '$($serviceProcess.ProcessName)' PID $($serviceProcess.Id)"
                        try {
                            $serviceProcess.Kill()
                        } finally {
                            $serviceProcess.Dispose()
                        }
                    }
                    Start-Sleep -Seconds 3
                } else {
                    Write-Log "[Service] Could not get process ID from service" -Level Warning
                }
            } catch {
                Write-Log "[Service] Failed to force kill service process: $($_.Exception.Message)" -Level Warning
            } finally {
                # Clean up all WMI and Process objects
                if ($serviceWmi) { $serviceWmi = $null }
                if ($childProcesses) { $childProcesses = $null }
                if ($serviceProcess) { 
                    try { $serviceProcess.Dispose() } catch {}
                    $serviceProcess = $null 
                }
            }
            
            # Force stop the service
            try {
                Stop-Service -Name $ServiceName -Force -ErrorAction Stop
                Write-Log "[Service] Service force stopped"
            } catch {
                Write-Log "[Service] Failed to force stop service: $($_.Exception.Message)" -Level Error
            }
        }
        
        # Wait a moment for cleanup
        Start-Sleep -Seconds 5
        
        # Start the service again
        Write-Log "[Service] Starting service after repair..."
        $startResult = Start-GameService -ServiceName $ServiceName -Context "repair restart" -SkipNotifications:$SkipNotifications
        
        if ($startResult) {
            Write-Log "[Service] Service repair completed successfully"
            return $true
        } else {
            Write-Log "[Service] Service repair failed - could not restart" -Level Error
            return $false
        }
        
    } catch {
        Write-Log "[Service] Service repair failed: $($_.Exception.Message)" -Level Error
        return $false
    }
}

function Stop-GameService {
    <#
    .SYNOPSIS
    Stop the SCUM server service
    .PARAMETER ServiceName
    Name of the Windows service
    .PARAMETER Reason
    Reason for stop
    .PARAMETER SkipNotifications
    Skip sending stop notifications (for admin stops that handle their own notifications)
    #>
    param(
        [Parameter(Mandatory)]
        [string]$ServiceName,
        
        [Parameter()]
        [string]$Reason = "manual stop",
        
        [Parameter()]
        [switch]$SkipNotifications
    )
    
    Write-Log "[Service] Stopping service '$ServiceName' ($Reason)"
    
    try {
        $service = Get-Service -Name $ServiceName -ErrorAction Stop
        
        if ($service.Status -eq 'Stopped') {
            Write-Log "[Service] Service '$ServiceName' is already stopped"
            return $true
        }
        
        Stop-Service -Name $ServiceName -Force -ErrorAction Stop
        Write-Log "[Service] Service '$ServiceName' stopped successfully"
        return $true
    }
    catch {
        Write-Log "[Service] Failed to stop service '$ServiceName': $($_.Exception.Message)" -Level Error
        return $false
    }
}

# --- MODULE VARIABLES ---
$script:serviceConfig = $null

# ===============================================================
# INITIALIZATION
# ===============================================================

function Initialize-ServiceModule {
    <#
    .SYNOPSIS
    Initialize the service module
    .PARAMETER Config
    Configuration object
    #>
    param(
        [Parameter(Mandatory)]
        [object]$Config
    )
    
    $script:serviceConfig = $Config
    Write-Log "[Service] Module initialized"
}

function Test-ServiceExists {
    <#
    .SYNOPSIS
    Check if Windows service exists
    .PARAMETER ServiceName
    Name of the Windows service
    .RETURNS
    Boolean indicating if service exists
    #>
    param(
        [Parameter(Mandatory)]
        [string]$ServiceName
    )
    
    try {
        $service = Get-Service -Name $ServiceName -ErrorAction Stop
        return $true
    }
    catch {
        # Service not found or other error
        if ($_.Exception.Message -like "*Cannot find any service*" -or 
            $_.Exception.Message -like "*No service*" -or
            $_.Exception.GetType().Name -like "*ServiceNotFoundException*") {
            return $false
        }
        
        Write-Log "[Service] Error checking if service '$ServiceName' exists: $($_.Exception.Message)" -Level Error
        return $false
    }
}

function Test-ServiceRunning {
    <#
    .SYNOPSIS
    Check if Windows service is running
    .PARAMETER ServiceName
    Name of the Windows service
    #>
    param(
        [Parameter(Mandatory)]
        [string]$ServiceName
    )
    
    try {
        $service = Get-Service -Name $ServiceName -ErrorAction Stop
        return $service.Status -eq 'Running'
    }
    catch [System.ServiceProcess.ServiceController+ServiceNotFoundException], [Microsoft.PowerShell.Commands.ServiceCommandException] {
        # Service doesn't exist - this is expected during first install or before service creation
        Write-Log "[Service] Service '$ServiceName' not found (may not be installed yet)" -Level Warning
        return $false
    }
    catch {
        Write-Log "[Service] Error checking service '$ServiceName': $($_.Exception.Message)" -Level Error
        return $false
    }
}

function Start-GameService {
    <#
    .SYNOPSIS
    Start the SCUM server service
    .PARAMETER ServiceName
    Name of the Windows service
    .PARAMETER Context
    Context description for logging
    .PARAMETER SkipStartupMonitoring
    Skip startup monitoring
    .PARAMETER SkipNotifications
    Skip sending start notifications (for admin restarts that handle their own notifications)
    #>
    param(
        [Parameter(Mandatory)]
        [string]$ServiceName,
        
        [Parameter()]
        [string]$Context = "manual start",
        
        [Parameter()]
        [switch]$SkipStartupMonitoring,
        
        [Parameter()]
        [switch]$SkipNotifications
    )
    
    Write-Log "[Service] Starting service '$ServiceName' ($Context)"
    
    try {
        $service = Get-Service -Name $ServiceName -ErrorAction Stop
        
        if ($service.Status -eq 'Running') {
            Write-Log "[Service] Service '$ServiceName' is already running"
            return $true
        }
        
        Start-Service -Name $ServiceName -ErrorAction Stop
        
        if (-not $SkipStartupMonitoring) {
            Write-Log "[Service] Startup monitoring enabled for service '$ServiceName'" -Level Debug
        }
        
        Write-Log "[Service] Service '$ServiceName' start command sent successfully"
        return $true
    }
    catch [System.ComponentModel.Win32Exception] {
        # Handle Windows service access denied errors
        if ($_.Exception.NativeErrorCode -eq 5) {
            Write-Log "[Service] Access denied starting service '$ServiceName' - run as Administrator" -Level Error
        } else {
            Write-Log "[Service] Windows service error starting '$ServiceName': $($_.Exception.Message)" -Level Error
        }
        return $false
    }
    catch {
        # Handle all other exceptions including InvalidOperationException
        $exceptionType = $_.Exception.GetType().Name
        if ($exceptionType -like "*InvalidOperation*") {
            Write-Log "[Service] Service '$ServiceName' is in invalid state: $($_.Exception.Message)" -Level Error
        } else {
            Write-Log "[Service] Failed to start service '$ServiceName': $($_.Exception.Message)" -Level Error
        }
        return $false
    }
}

function Restart-GameService {
    <#
    .SYNOPSIS
    Restart the SCUM server service
    .PARAMETER ServiceName
    Name of the Windows service
    .PARAMETER Reason
    Reason for restart
    .PARAMETER SkipNotifications
    Skip sending restart notifications (for admin restarts that handle their own notifications)
    #>
    param(
        [Parameter(Mandatory)]
        [string]$ServiceName,
        
        [Parameter()]
        [string]$Reason = "restart",
        
        [Parameter()]
        [switch]$SkipNotifications
    )
    
    Write-Log "[Service] Restarting service '$ServiceName' ($Reason)"
    
    try {
        if (Stop-GameService -ServiceName $ServiceName -Reason $Reason) {
            Start-Sleep -Seconds 5
            return Start-GameService -ServiceName $ServiceName -Context $Reason
        }
        return $false
    }
    catch {
        Write-Log "[Service] Failed to restart service '$ServiceName': $($_.Exception.Message)" -Level Error
        return $false
    }
}

function Get-ServiceInfo {
    <#
    .SYNOPSIS
    Get detailed service information
    .PARAMETER ServiceName
    Name of the Windows service
    #>
    param(
        [Parameter(Mandatory)]
        [string]$ServiceName
    )
    
    try {
        $service = Get-Service -Name $ServiceName -ErrorAction Stop
        
        return @{
            Name = $service.Name
            DisplayName = $service.DisplayName
            Status = $service.Status
            StartType = $service.StartType
            CanStop = $service.CanStop
            CanRestart = $service.CanStop
        }
    }
    catch {
        Write-Log "[Service] Failed to get service info for '$ServiceName': $($_.Exception.Message)" -Level Error
        return @{
            Name = $ServiceName
            Status = "NotFound"
            Error = $_.Exception.Message
        }
    }
}

# ===============================================================
# SERVICE MONITORING
# ===============================================================

function Watch-ServiceStartup {
    <#
    .SYNOPSIS
    Monitor service startup progress
    .PARAMETER ServiceName
    Name of the Windows service
    .PARAMETER TimeoutMinutes
    Startup timeout in minutes
    #>
    param(
        [Parameter(Mandatory)]
        [string]$ServiceName,
        
        [Parameter()]
        [int]$TimeoutMinutes = 10
    )
    
    $startTime = Get-Date
    $timeoutTime = $startTime.AddMinutes($TimeoutMinutes)
    
    Write-Log "[Service] Monitoring startup of '$ServiceName' (timeout: $TimeoutMinutes min)"
    
    while ((Get-Date) -lt $timeoutTime) {
        $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        
        if ($service -and $service.Status -eq 'Running') {
            $elapsed = ((Get-Date) - $startTime).TotalMinutes
            Write-Log "[Service] Service '$ServiceName' started successfully after $([Math]::Round($elapsed, 1)) minutes"
            return $true
        }
        
        Start-Sleep -Seconds 5
    }
    
    Write-Log "[Service] Service '$ServiceName' startup timeout after $TimeoutMinutes minutes" -Level Warning
    return $false
}

function Test-IntentionalStop {
    <#
    .SYNOPSIS
    Check if server was stopped intentionally
    .PARAMETER ServiceName
    Windows service name
    .PARAMETER ServerDirectory
    Server installation directory
    .PARAMETER MinutesToCheck
    How many minutes back to check
    .RETURNS
    Boolean indicating if stop was intentional
    #>
    param(
        [Parameter(Mandatory)]
        [string]$ServiceName,
        
        [Parameter(Mandatory)]
        [string]$ServerDirectory,
        
        [Parameter()]
        [int]$MinutesToCheck = 10
    )
    
    $since = (Get-Date).AddMinutes(-$MinutesToCheck)
    
    try {
        # Method 1: Check Application Event Log for service events
        $serviceEvents = Get-WinEvent -FilterHashtable @{
            LogName = 'Application'
            StartTime = $since
        } -ErrorAction SilentlyContinue | Where-Object {
            $_.Message -like "*$ServiceName*" -and (
                $_.Message -like "*stop*" -or 
                $_.Message -like "*terminate*" -or
                $_.Message -like "*shutdown*"
            )
        }
        
        if ($serviceEvents) {
            Write-Log "[Service] Application log shows service control event - likely intentional stop"
            return $true
        }
        
        # Method 2: Check System Event Log for service state changes
        $systemEvents = Get-WinEvent -FilterHashtable @{
            LogName = 'System'
            ID = @(7036, 7040) # Service state change events
            StartTime = $since
        } -ErrorAction SilentlyContinue | Where-Object {
            $_.Message -like "*$ServiceName*" -and $_.Message -like "*stopped*"
        }
        
        if ($systemEvents) {
            Write-Log "[Service] System log shows service stop event - likely intentional stop"
            return $true
        }
        
        # Method 3: Check for clean shutdown in SCUM log
        $logPath = Join-Path $ServerDirectory "SCUM\Saved\Logs\SCUM.log"
        if (Test-PathExists $logPath) {
            # MEMORY LEAK FIX: Use streaming approach to read last 20 lines
            $recentLines = @()
            $streamReader = $null
            $fileStream = $null
            
            try {
                $fileStream = [System.IO.FileStream]::new($logPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
                $streamReader = [System.IO.StreamReader]::new($fileStream)
                
                # MEMORY LEAK FIX: Use ArrayList instead of array +=
                $allLinesList = [System.Collections.ArrayList]::new()
                while (-not $streamReader.EndOfStream) {
                    $line = $streamReader.ReadLine()
                    if ($line -ne $null) {
                        [void]$allLinesList.Add($line)
                    }
                }
                
                # Get last 20 lines
                if ($allLinesList.Count -gt 0) {
                    $startIndex = [Math]::Max(0, $allLinesList.Count - 20)
                    $allLines = $allLinesList.ToArray()
                    $recentLines = $allLines[$startIndex..($allLines.Count - 1)]
                }
                
            } catch {
                # Fall back to empty array on error
                $recentLines = @()
            } finally {
                if ($streamReader) { $streamReader.Close(); $streamReader.Dispose() }
                if ($fileStream) { $fileStream.Close(); $fileStream.Dispose() }
            }
            $cleanShutdownPatterns = @(
                'LogExit: Exiting\.',
                'SHUTTING DOWN',
                'Log file closed'
            )
            
            foreach ($pattern in $cleanShutdownPatterns) {
                $matches = $recentLines | Where-Object { $_ -match $pattern }
                if ($matches) {
                    Write-Log "[Service] Clean shutdown pattern found in log - intentional stop"
                    return $true
                }
            }
        }
        
        # Method 4: Time-based heuristic
        $currentHour = (Get-Date).Hour
        if ($currentHour -ge 8 -and $currentHour -le 22) {
            Write-Log "[Service] Service stopped during normal hours - more likely intentional"
            # Don't return true based on timing alone, but it's a hint
        }
        
    } catch {
        Write-Log "[Service] Error checking intentional stop: $($_.Exception.Message)" -Level Error
    }
    
    # Default to false - treat as unintentional unless clear evidence
    Write-Log "[Service] No clear evidence of intentional stop - treating as crash"
    return $false
}

# Export module functions
Export-ModuleMember -Function @(
    'Initialize-ServiceModule',
    'Test-ServiceExists',
    'Test-ServiceRunning',
    'Test-GameProcessHealth',
    'Repair-GameService',
    'Start-GameService',
    'Stop-GameService', 
    'Restart-GameService',
    'Get-ServiceInfo',
    'Watch-ServiceStartup',
    'Test-IntentionalStop'
)
