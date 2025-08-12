# ===============================================================
# SCUM Server Monitoring Module
# Modern monitoring system with clean integration
# ===============================================================

#Requires -Version 5.1

# Standard import of common module
try {
    $helperPath = Join-Path $PSScriptRoot "..\..\core\module-helper.psm1"
    if (Test-Path $helperPath) {
        Import-Module $helperPath -Force -ErrorAction SilentlyContinue
        Import-CommonModule | Out-Null
    }
} catch {
    Write-Host "[WARNING] Common module not available for monitoring module" -ForegroundColor Yellow
}

# ===============================================================
# MODULE STATE
# ===============================================================

$script:Config = $null
$script:ServiceName = $null
$script:ServerSettingsPath = $null
$script:Initialized = $false

# Current server state - the source of truth
$script:ServerState = @{
    ServiceStatus = 'Unknown'
    ProcessId = $null
    ProcessName = $null
    IsRunning = $false
    OnlinePlayers = 0
    MaxPlayers = 64
    LastUpdate = Get-Date
    Performance = @{
        CPU = 0
        Memory = 0
        FPS = 0
        Entities = 0
        LastUpdate = Get-Date
    }
    LastPerformanceAlert = (Get-Date).AddHours(-1)  # Start with 1 hour ago to allow immediate alerts
}

# Process tracking to reduce verbose logging
$script:LastKnownProcessId = $null

# ===============================================================
# INITIALIZATION
# ===============================================================

function Initialize-MonitoringModule {
    <#
    .SYNOPSIS
    Initialize the monitoring module
    #>
    param(
        [Parameter(Mandatory=$true)]
        [hashtable]$Config,
        
        [Parameter()]
        [string]$LogPath  # For compatibility
    )
    
    try {
        Write-Log "[Monitoring] Initializing monitoring system..." -Level Info
        
        # Store configuration
        $script:Config = $Config
        $script:ServiceName = if ($Config.serviceName) { $Config.serviceName } else { "SCUMDedicatedServer" }
        
        # Determine server settings path
        $serverPath = if ($Config.serverDir) { $Config.serverDir } else { "C:\SCUMServer\server" }
        $script:ServerSettingsPath = Join-Path $serverPath "SCUM\Saved\Config\WindowsServer\ServerSettings.ini"
        
        # Validate server settings file
        if (-not (Test-Path $script:ServerSettingsPath)) {
            Write-Log "[Monitoring] ServerSettings.ini not found at $script:ServerSettingsPath - using defaults" -Level Warning
        }
        
        # Initial state update
        Update-ServerState
        
        # Populate performance cache from recent log data
        Initialize-PerformanceCache
        
        # Set initial performance alert cooldown to prevent startup spam
        $script:ServerState.LastPerformanceAlert = Get-Date
        
        # Check Discord integration availability
        if (Get-Command "Update-DiscordServerStatus" -ErrorAction SilentlyContinue) {
            Write-Verbose "[Monitoring] Discord integration available"
        } else {
            Write-Log "[Monitoring] Discord Gateway functions not available - Discord notifications may be limited" -Level Warning
        }
        
        $script:Initialized = $true
        Write-Log "[Monitoring] Monitoring initialized successfully" -Level Info
        
        return $true
        
    } catch {
        Write-Log "[Monitoring] Failed to initialize: $($_.Exception.Message)" -Level Error
        return $false
    }
}

# ===============================================================
# CORE STATE MANAGEMENT
# ===============================================================

function Update-ServerState {
    <#
    .SYNOPSIS
    Update the current server state by checking service, process AND log parser events
    #>
    
    try {
        # Ensure we have a service name
        if (-not $script:ServiceName) {
            $script:ServiceName = "SCUMDedicatedServer"
        }
        
        # Get service status
        $service = Get-Service -Name $script:ServiceName -ErrorAction SilentlyContinue
        $serviceStatus = if ($service) { $service.Status.ToString() } else { 'Not Found' }
        
        Write-Verbose "[Monitoring] Service '$script:ServiceName' status: $serviceStatus"
        
        # Get process information
        $processInfo = Get-ServiceProcess -ServiceName $script:ServiceName
        Write-Verbose "[Monitoring] Process info: PID=$($processInfo.ProcessId), Name=$($processInfo.ProcessName)"
        
        # Get max players from config
        $maxPlayers = Get-MaxPlayersFromConfig
        Write-Verbose "[Monitoring] MaxPlayers read from config: $maxPlayers"
        
        # Get current player count from database
        $currentPlayers = Get-CurrentPlayerCount
        
        # ENHANCED: Check actual server state from log parser events
        $actualServerState = Get-ActualServerStateFromLogs
        
        # IMPORTANT: Separate Service Status from Server Status
        # Service Running = Windows service is running (but server might not be ready)
        # Server Online = Server is actually accepting players and working
        
        $serviceRunning = ($serviceStatus -eq 'Running' -and $null -ne $processInfo.ProcessId)
        
        # Server is truly online only when logs confirm it (not just service running)
        $isRunning = switch ($actualServerState) {
            "Online" { 
                # ENHANCED: Even if logs say "Online", double-check service status
                # If service is stopped, server CANNOT be online
                if ($serviceStatus -eq 'Stopped') {
                    Write-Verbose "[Monitoring] Logs say Online but service is STOPPED - overriding to IsRunning=false"
                    $false
                } else {
                    $true
                }
            }
            "Starting" { $false }        # Service running but server still starting
            "Loading" { $false }         # Service running but server loading world  
            "ShuttingDown" { $false }    # Service might be running but server shutting down
            "Offline" { $false }         # Server confirmed offline
            "Unknown" { 
                # ENHANCED: If server state is unknown from logs, use service status as reliable fallback
                # If service is stopped and no process exists, server is definitely offline
                if ($serviceStatus -eq 'Stopped' -or $null -eq $processInfo.ProcessId) {
                    Write-Verbose "[Monitoring] Server state unknown from logs but service stopped or no process - IsRunning=false"
                    $false
                } else {
                    # Service running but no log confirmation - conservative approach: assume NOT ready
                    Write-Verbose "[Monitoring] Server state unknown from logs, service running - conservatively assuming NOT ready (IsRunning=false)"
                    $false
                }
            }
            default { $false }
        }
        
        Write-Verbose "[Monitoring] Status: Service='$serviceStatus' (Running=$serviceRunning), Server='$actualServerState' (Online=$isRunning)"
        
        # Update state
        $script:ServerState.ServiceStatus = $serviceStatus
        $script:ServerState.ProcessId = $processInfo.ProcessId
        $script:ServerState.ProcessName = $processInfo.ProcessName
        $script:ServerState.IsRunning = $isRunning
        $script:ServerState.OnlinePlayers = $currentPlayers
        $script:ServerState.MaxPlayers = $maxPlayers
        $script:ServerState.LastUpdate = Get-Date
        
        # Get performance data if process is running
        if ($processInfo.ProcessId) {
            $script:ServerState.Performance = Get-ProcessPerformance -ProcessId $processInfo.ProcessId
        } else {
            # Even without a process, try to get cached performance data from parser
            $defaultPerformance = @{ CPU = 0; Memory = 0; FPS = 0; Entities = 0 }
            
            # Try to get cached performance stats from parser
            if (Get-Command "Get-LatestPerformanceStats" -ErrorAction SilentlyContinue) {
                try {
                    $cachedStats = Get-LatestPerformanceStats
                    if ($cachedStats) {
                        $defaultPerformance.FPS = if ($cachedStats.AverageFPS) { $cachedStats.AverageFPS } else { 0 }
                        
                        # Get entity count from cached stats if available
                        if ($cachedStats.Entities) {
                            $entityTotal = 0
                            if ($cachedStats.Entities.Characters) { $entityTotal += $cachedStats.Entities.Characters }
                            if ($cachedStats.Entities.Zombies) { $entityTotal += $cachedStats.Entities.Zombies }
                            if ($cachedStats.Entities.Vehicles) { $entityTotal += $cachedStats.Entities.Vehicles }
                            $defaultPerformance.Entities = $entityTotal
                        }
                        
                        Write-Verbose "[Monitoring] Using cached performance data (no process): FPS=$($defaultPerformance.FPS), Entities=$($defaultPerformance.Entities), CPU=0 (no process)"
                    }
                } catch {
                    Write-Verbose "[Monitoring] Failed to get cached performance data: $($_.Exception.Message)"
                }
            }
            
            $script:ServerState.Performance = $defaultPerformance
        }
        
        Write-Verbose "[Monitoring] State updated: IsOnline=$($script:ServerState.IsRunning), Players=$($script:ServerState.OnlinePlayers)/$($script:ServerState.MaxPlayers)"
        
    } catch {
        Write-Log "[Monitoring] Error updating server state: $($_.Exception.Message)" -Level Error
    }
}

function Get-ActualServerStateFromLogs {
    <#
    .SYNOPSIS
    Get actual server state based on log parser events - this is the TRUE server status
    .DESCRIPTION
    Returns server state independent of Windows service status:
    - Online: Server is running and accepting players (Global Stats detected)  
    - Starting: Server process started but not ready yet
    - Loading: Server loading world/map
    - ShuttingDown: Server shutting down gracefully
    - Offline: Server process stopped/crashed
    - Unknown: No recent log data available
    #>
    
    try {
        # Get recent parsed events from log parser
        if (Get-Command "Get-ParsedEvents" -ErrorAction SilentlyContinue) {
            $recentEvents = Get-ParsedEvents -Count 20  # Check more events for better accuracy
            
            if ($recentEvents -and $recentEvents.Count -gt 0) {
                # Find all state-changing events
                $stateEvents = $recentEvents | Where-Object { $_.EventType -in @("ServerOnline", "ServerOffline", "ServerShuttingDown", "ServerStarting", "ServerLoading") }
                
                if ($stateEvents -and $stateEvents.Count -gt 0) {
                    # SIMPLE FIX: Check for ServerOffline events first (highest priority)
                    $offlineEvents = $stateEvents | Where-Object { $_.EventType -eq "ServerOffline" }
                    if ($offlineEvents -and $offlineEvents.Count -gt 0) {
                        # Find most recent ServerOffline event
                        $lastOfflineEvent = $offlineEvents | Sort-Object Timestamp -Descending | Select-Object -First 1
                        
                        # Check how recent this offline event is
                        $eventAge = (Get-Date) - $lastOfflineEvent.Timestamp
                        if ($eventAge.TotalMinutes -le 10) {
                            Write-Verbose "[Monitoring] Server state from logs: 'Offline' (recent ServerOffline event found, age: $([Math]::Round($eventAge.TotalSeconds, 0))s)"
                            return "Offline"
                        }
                    }
                    
                    # SIMPLE FIX: Check for ServerShuttingDown events 
                    $shutdownEvents = $stateEvents | Where-Object { $_.EventType -eq "ServerShuttingDown" }
                    if ($shutdownEvents -and $shutdownEvents.Count -gt 0) {
                        $lastShutdownEvent = $shutdownEvents | Sort-Object Timestamp -Descending | Select-Object -First 1
                        $eventAge = (Get-Date) - $lastShutdownEvent.Timestamp
                        if ($eventAge.TotalMinutes -le 10) {
                            Write-Verbose "[Monitoring] Server state from logs: 'ShuttingDown' (recent shutdown event found, age: $([Math]::Round($eventAge.TotalSeconds, 0))s)"
                            return "ShuttingDown"
                        }
                    }
                    
                    # Original complex logic for other states
                    $sortedEvents = $stateEvents | Sort-Object Timestamp -Descending
                    $latestTimestamp = ($sortedEvents | Select-Object -First 1).Timestamp
                    $eventsAtLatestTime = $sortedEvents | Where-Object { $_.Timestamp -eq $latestTimestamp }
                    
                    $lastStateEvent = $eventsAtLatestTime | Sort-Object @{
                        Expression = {
                            switch ($_.EventType) {
                                "ServerShuttingDown" { 1 }  # Highest priority
                                "ServerOffline" { 2 }
                                "ServerStarting" { 3 }
                                "ServerLoading" { 4 }
                                "ServerOnline" { 5 }        # Lowest priority
                                default { 9 }
                            }
                        }
                    } | Select-Object -First 1
                    
                    if ($lastStateEvent) {
                        $state = switch ($lastStateEvent.EventType) {
                            "ServerOnline" { "Online" }              # Global Stats detected = truly online
                            "ServerOffline" { "Offline" }            # Log file closed = truly offline
                            "ServerShuttingDown" { "ShuttingDown" }  # Shutdown initiated
                            "ServerStarting" { "Starting" }         # Process started
                            "ServerLoading" { "Loading" }           # Loading world
                            default { "Unknown" }
                        }
                        
                        # Check how recent this event is
                        $eventAge = (Get-Date) - $lastStateEvent.Timestamp
                        if ($eventAge.TotalMinutes -le 10) {  # Increased from 5 to 10 minutes
                            Write-Verbose "[Monitoring] Server state from logs: '$state' (event: $($lastStateEvent.EventType), age: $([Math]::Round($eventAge.TotalSeconds, 0))s)"
                            return $state
                        } else {
                            Write-Verbose "[Monitoring] Last log event too old ($([Math]::Round($eventAge.TotalMinutes, 1)) min ago): $($lastStateEvent.EventType)"
                            # Continue to fallback logic below only if event is too old
                        }
                    } else {
                        Write-Verbose "[Monitoring] No state-changing events found in recent logs"
                    }
                } else {
                    Write-Verbose "[Monitoring] No state-changing events found"
                }
            } else {
                Write-Verbose "[Monitoring] No recent events found from parser"
            }
        } else {
            Write-Verbose "[Monitoring] Get-ParsedEvents command not available"
        }
        
        # Fallback: Check if we have recent Global Stats (performance stats)
        # This can indicate server is running even if we missed log events
        if (Get-Command "Get-LatestPerformanceStats" -ErrorAction SilentlyContinue) {
            $perfStats = Get-LatestPerformanceStats
            if ($perfStats) {
                Write-Verbose "[Monitoring] Found recent performance stats - fallback suggests Online"
                return "Online"
            }
        }
        
        # Final fallback: Check service status and process to determine state
        try {
            $service = Get-Service -Name $script:ServiceName -ErrorAction SilentlyContinue
            $scumProcess = Get-Process -Name "SCUMServer" -ErrorAction SilentlyContinue
            
            if ($service -and $service.Status -eq 'Running' -and $scumProcess) {
                Write-Verbose "[Monitoring] No recent log data but service running and process exists - returning Unknown (could be starting)"
                return "Unknown"
            } elseif ($service -and $service.Status -eq 'Stopped') {
                Write-Verbose "[Monitoring] No recent log data and service is STOPPED - definitely Offline"
                return "Offline"
            } elseif (-not $scumProcess) {
                Write-Verbose "[Monitoring] No recent log data and no SCUMServer process - definitely Offline"
                return "Offline"
            } else {
                Write-Verbose "[Monitoring] No recent log data and service is $($service.Status) - returning Offline"
                return "Offline"
            }
        } catch {
            Write-Verbose "[Monitoring] Error checking service status for final fallback: $($_.Exception.Message)"
        }
        
        Write-Verbose "[Monitoring] No recent log data available for server state detection - assuming Offline"
        return "Offline"
        
    } catch {
        Write-Log "[Monitoring] Error getting log-based server state: $($_.Exception.Message)" -Level Error
        return "Unknown"
    }
}

function Get-ServiceProcess {
    <#
    .SYNOPSIS
    Get the process associated with a Windows service
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$ServiceName
    )
    
    try {
        # Get service information via WMI
        $service = Get-WmiObject -Class Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
        
        if (-not $service) {
            Write-Verbose "[Monitoring] Service '$ServiceName' not found via WMI"
            return @{ ProcessId = $null; ProcessName = $null; StartTime = $null }
        }
        
        # Only log service details if there's an issue or change
        if ($service.State -ne 'Running' -or -not $service.ProcessId -or $service.ProcessId -eq 0) {
            Write-Verbose "[Monitoring] Service '$ServiceName' issue: State=$($service.State), ProcessId=$($service.ProcessId)"
        }
        
        if (-not $service.ProcessId -or $service.ProcessId -eq 0) {
            Write-Verbose "[Monitoring] Service '$ServiceName' has no ProcessId or ProcessId is 0"
            return @{ ProcessId = $null; ProcessName = $null; StartTime = $null }
        }
        
        # Get the service process (could be nssm.exe or direct)
        $serviceProcess = Get-Process -Id $service.ProcessId -ErrorAction SilentlyContinue
        if (-not $serviceProcess) {
            Write-Verbose "[Monitoring] Process with ID $($service.ProcessId) not found"
            return @{ ProcessId = $null; ProcessName = $null; StartTime = $null }
        }
        
        # If service process is nssm.exe, find the child SCUMServer process
        if ($serviceProcess.ProcessName -eq "nssm") {
            # Find SCUMServer process that could be a child of nssm
            $scumProcesses = Get-Process -Name "SCUMServer" -ErrorAction SilentlyContinue
            if ($scumProcesses) {
                # Take the SCUMServer process with highest memory usage (most likely the server)
                $mainProcess = $scumProcesses | Sort-Object WorkingSet64 -Descending | Select-Object -First 1
                
                # Store previous process ID to detect changes
                if (-not $script:LastKnownProcessId -or $script:LastKnownProcessId -ne $mainProcess.Id) {
                    Write-Verbose "[Monitoring] SCUM server process detected: PID=$($mainProcess.Id), Memory=$([Math]::Round($mainProcess.WorkingSet64 / 1MB, 0))MB"
                    $script:LastKnownProcessId = $mainProcess.Id
                }
                
                return @{
                    ProcessId = $mainProcess.Id
                    ProcessName = $mainProcess.ProcessName
                    StartTime = $mainProcess.StartTime
                }
            } else {
                Write-Verbose "[Monitoring] No SCUMServer child process found"
                return @{ ProcessId = $null; ProcessName = $null; StartTime = $null }
            }
        } else {
            # Direct service process (not using nssm) - only log if PID changed
            if (-not $script:LastKnownProcessId -or $script:LastKnownProcessId -ne $serviceProcess.Id) {
                Write-Verbose "[Monitoring] Direct service process: PID=$($serviceProcess.Id), Name=$($serviceProcess.ProcessName), Memory=$([Math]::Round($serviceProcess.WorkingSet64 / 1MB, 0))MB"
                $script:LastKnownProcessId = $serviceProcess.Id
            }
            
            return @{
                ProcessId = $serviceProcess.Id
                ProcessName = $serviceProcess.ProcessName
                StartTime = $serviceProcess.StartTime
            }
        }
        
    } catch {
        Write-Log "[Monitoring] Error getting service process: $($_.Exception.Message)" -Level Warning
        return @{ ProcessId = $null; ProcessName = $null; StartTime = $null }
    }
}

function Get-MaxPlayersFromConfig {
    <#
    .SYNOPSIS
    Read MaxPlayers from ServerSettings.ini
    #>
    
    try {
        if (-not (Test-Path $script:ServerSettingsPath)) {
            Write-Verbose "[Monitoring] ServerSettings.ini not found, using default MaxPlayers=64"
            return 64
        }
        
        $content = Get-Content $script:ServerSettingsPath -ErrorAction SilentlyContinue
        $maxPlayersLine = $content | Where-Object { $_ -match '^scum\.MaxPlayers\s*=\s*(\d+)' }
        
        if ($maxPlayersLine -and $matches[1]) {
            return [int]$matches[1]
        } else {
            Write-Verbose "[Monitoring] MaxPlayers not found in config, using default: 64"
            return 64
        }
        
    } catch {
        Write-Log "[Monitoring] Error reading MaxPlayers from config: $($_.Exception.Message)" -Level Warning
        return 64
    }
}

function Get-CurrentPlayerCount {
    <#
    .SYNOPSIS
    Get current player count ONLY from centralized database service - NO DIRECT DATABASE CALLS
    #>
    
    try {
        # Use centralized database service EXCLUSIVELY - NO FALLBACK
        if (Get-Command "Get-DatabaseServiceStats" -ErrorAction SilentlyContinue) {
            $dbStats = Get-DatabaseServiceStats
            if ($null -ne $dbStats -and $dbStats.ContainsKey('OnlinePlayers')) {
                Write-Log "Monitoring: Using centralized database service for online players: $($dbStats.OnlinePlayers)" -Level Debug
                return [int]$dbStats.OnlinePlayers
            }
        }
        
        # NO FALLBACK - centralized service should always be available
        Write-Log "Monitoring: Centralized database service not available - returning 0" -Level Warning
        return 0
    } catch {
        Write-Log "Monitoring: Error getting player count: $($_.Exception.Message)" -Level Warning
        return 0
    }
}

function Get-ProcessPerformance {
    <#
    .SYNOPSIS
    Get performance metrics from log parser and database instead of direct process monitoring
    #>
    param(
        [Parameter(Mandatory=$true)]
        [int]$ProcessId
    )
    
    $performance = @{
        CPU = 0
        Memory = 0
        FPS = 0
        Entities = 0
    }
    
    try {
        # Get basic memory and CPU from process
        $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
        if ($process) {
            $performance.Memory = [Math]::Round($process.WorkingSet64 / 1MB, 0)
            
            # Get actual CPU usage percentage - only real values, no fallback
            try {
                $cpuCounter = Get-Counter "\Process($($process.ProcessName))\% Processor Time" -ErrorAction SilentlyContinue
                if ($cpuCounter -and $cpuCounter.CounterSamples) {
                    $cpuValue = $cpuCounter.CounterSamples[0].CookedValue
                    # Convert to percentage and round
                    $performance.CPU = [Math]::Round($cpuValue, 0)
                    Write-Verbose "[Monitoring] Real CPU usage: $($performance.CPU)%"
                } else {
                    Write-Verbose "[Monitoring] CPU counter not available, keeping CPU at 0"
                }
            } catch {
                Write-Verbose "[Monitoring] Failed to get CPU counter: $($_.Exception.Message)"
            }
        }
        
        # Get FPS and performance data from log parser (use already parsed events)
        if (Get-Command "Get-ParsedEvents" -ErrorAction SilentlyContinue) {
            try {
                $parsedEvents = Get-ParsedEvents
                $perfStats = $null
                
                if ($parsedEvents -and $parsedEvents.Count -gt 0) {
                    # Find the most recent ServerOnline event with performance stats
                    $recentPerfEvent = $parsedEvents | 
                        Where-Object { $_.EventType -eq "ServerOnline" -and $_.Data.PerformanceStats } |
                        Sort-Object Timestamp -Descending |
                        Select-Object -First 1
                    
                    if ($recentPerfEvent -and $recentPerfEvent.Data.PerformanceStats) {
                        $perfStats = $recentPerfEvent.Data.PerformanceStats
                    }
                }
                
                # If no recent performance data from events, try to get cached data
                if (-not $perfStats -and (Get-Command "Get-LatestPerformanceStats" -ErrorAction SilentlyContinue)) {
                    $perfStats = Get-LatestPerformanceStats
                    if ($perfStats) {
                        Write-Verbose "[Monitoring] Using cached performance stats (no new events)"
                    }
                }
                
                # Apply performance stats if we have them
                if ($perfStats) {
                    $performance.FPS = if ($perfStats.AverageFPS) { $perfStats.AverageFPS } else { 0 }
                    
                    # Get entity count from performance stats if available
                    if ($perfStats.Entities) {
                        $entityTotal = 0
                        if ($perfStats.Entities.Characters) { $entityTotal += $perfStats.Entities.Characters }
                        if ($perfStats.Entities.Zombies) { $entityTotal += $perfStats.Entities.Zombies }
                        if ($perfStats.Entities.Vehicles) { $entityTotal += $perfStats.Entities.Vehicles }
                        $performance.Entities = $entityTotal
                    }
                    
                    Write-Verbose "[Monitoring] Performance data applied: FPS=$($performance.FPS), Entities=$($performance.Entities), CPU=$($performance.CPU)% (real)"
                } else {
                    Write-Verbose "[Monitoring] No performance data available from parser"
                }
            } catch {
                Write-Verbose "[Monitoring] Failed to get performance from parsed events: $($_.Exception.Message)"
            }
        }
        
        # Get entity count from centralized database service instead of direct database calls
        if (Get-Command "Get-DatabaseServiceStats" -ErrorAction SilentlyContinue) {
            try {
                $dbStats = Get-DatabaseServiceStats
                if ($dbStats -and $dbStats.ContainsKey('EntityCount') -and $dbStats.EntityCount) {
                    $performance.Entities = $dbStats.EntityCount
                }
                Write-Verbose "[Monitoring] Using centralized database service for entity count: $($performance.Entities)"
            } catch {
                Write-Verbose "[Monitoring] Failed to get centralized database stats: $($_.Exception.Message)"
            }
        }
        
        return $performance
        
    } catch {
        Write-Log "[Monitoring] Error getting performance metrics: $($_.Exception.Message)" -Level Warning
        return $performance
    }
}

# ===============================================================
# PUBLIC INTERFACE FUNCTIONS
# ===============================================================

function Get-ServerStatus {
    <#
    .SYNOPSIS
    Get comprehensive server status information
    #>
    
    if (-not $script:Initialized) {
        Write-Log "[Monitoring] Module not initialized" -Level Warning
        return $null
    }
    
    # Update state before returning
    Update-ServerState
    
    # Get fresh server state from logs
    $currentLogState = Get-ActualServerStateFromLogs
    
    # Get database statistics from centralized service - NO DIRECT DB CALLS
    $dbStats = @{}
    $gameTime = "N/A"
    $temperature = "N/A"
    
    try {
        # Use centralized database service EXCLUSIVELY - NO FALLBACK
        if (Get-Command "Get-DatabaseServiceStats" -ErrorAction SilentlyContinue) {
            $centralStats = Get-DatabaseServiceStats
            $dbStats.TotalPlayers = [int]$centralStats.TotalPlayers
            $dbStats.ActiveSquads = [int]$centralStats.ActiveSquads
            $gameTime = $centralStats.GameTime
            $temperature = $centralStats.Temperature
            Write-Log "Monitoring: Using centralized database service for all stats" -Level Debug
        } else {
            # NO FALLBACK - centralized service should always be available
            Write-Log "Monitoring: Centralized service not available - using defaults" -Level Warning
            $dbStats.TotalPlayers = 0
            $dbStats.ActiveSquads = 0
            $gameTime = "N/A"
            $temperature = "N/A"
        }
    } catch {
        Write-Log "Monitoring: Database stats unavailable: $($_.Exception.Message)" -Level Debug
    }
    
    return @{
        # Main status - SERVER state (based on logs, not service)
        IsRunning = $script:ServerState.IsRunning  # TRUE = server accepting players
        OnlinePlayers = $script:ServerState.OnlinePlayers
        MaxPlayers = $script:ServerState.MaxPlayers
        LastUpdate = $script:ServerState.LastUpdate
        
        # Service info - WINDOWS SERVICE state (can differ from server state)
        ServiceStatus = $script:ServerState.ServiceStatus  # "Running", "Stopped", etc.
        ProcessId = $script:ServerState.ProcessId
        ProcessName = $script:ServerState.ProcessName
        
        # Server state details from logs (use current fresh state)
        ActualServerState = $currentLogState  # "Online", "Starting", "Loading", etc.
        
        # Performance
        Performance = $script:ServerState.Performance
        
        # Database stats
        DatabaseStats = $dbStats
        
        # Game data
        GameTime = $gameTime
        Temperature = $temperature
        
        # Legacy compatibility - now based on actual server state, not service
        Status = if ($script:ServerState.IsRunning) { "Online" } else { "Offline" }
        PlayerCount = $script:ServerState.OnlinePlayers
        IsOnline = $script:ServerState.IsRunning
    }
}

function Update-ServerMonitoring {
    <#
    .SYNOPSIS
    Update server monitoring using log parser events for accurate state detection
    ENHANCED: Now includes automatic crash detection and recovery
    #>
    
    if (-not $script:Initialized) {
        Write-Log "[Monitoring] Module not initialized" -Level Warning
        return @{
            IsRunning = $false
            OnlinePlayers = 0
            MaxPlayers = 64
            LastUpdate = (Get-Date)
        }
    }
    
    try {
        # Store previous state for change detection
        $previousState = @{
            IsRunning = $script:ServerState.IsRunning
            OnlinePlayers = $script:ServerState.OnlinePlayers
            ServiceStatus = $script:ServerState.ServiceStatus
        }
        
        Write-Verbose "[Monitoring] Update-ServerMonitoring called - Previous state: IsRunning=$($previousState.IsRunning)"
        
        # NEW: Check for crashed server process (service running but process dead)
        $healthCheckResult = $null
        if (Get-Command "Test-GameProcessHealth" -ErrorAction SilentlyContinue) {
            $serverDir = if ($script:Config -and $script:Config.serverDir) { $script:Config.serverDir } else { ".\server" }
            $healthCheckResult = Test-GameProcessHealth -ServiceName $script:ServiceName -ServerDirectory $serverDir
            
            if ($healthCheckResult -and -not $healthCheckResult.IsHealthy) {
                Write-Log "[Monitoring] Server health check FAILED: $($healthCheckResult.Reason)" -Level Warning
                Write-Log "[Monitoring] Service Status: $($healthCheckResult.ServiceStatus), Process Found: $($healthCheckResult.ProcessFound)" -Level Warning
                
                # Check if this is the "zombie service" problem (service running but process dead)
                if ($healthCheckResult.ServiceStatus -eq "Running" -and -not $healthCheckResult.ProcessFound) {
                    Write-Log "[Monitoring] DETECTED: Service running but server process is DEAD - automatic crash detected!" -Level Error
                    
                    # Check if auto-restart is enabled in config
                    $autoRestartEnabled = if ($script:Config -and $null -ne $script:Config.autoRestart) { 
                        $script:Config.autoRestart 
                    } else { 
                        $true  # Default to enabled
                    }
                    
                    if ($autoRestartEnabled) {
                        Write-Log "[Monitoring] Auto-restart is ENABLED - triggering automatic repair..." -Level Info
                        
                        # Trigger automatic repair
                        if (Get-Command "Repair-GameService" -ErrorAction SilentlyContinue) {
                            Write-Log "[Monitoring] Starting automatic server repair..." -Level Info
                            $repairResult = Repair-GameService -ServiceName $script:ServiceName -Reason "automatic crash recovery"
                            
                            if ($repairResult) {
                                Write-Log "[Monitoring] Automatic server repair completed successfully!" -Level Info
                                # Send admin-only notification about auto-recovery
                                if (Get-Command 'Send-DiscordNotification' -ErrorAction SilentlyContinue) {
                                    $recoveryData = @{
                                        timestamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
                                        service_name = $script:ServiceName
                                        message = "Server automatically restarted after crash detection"
                                        reason = "Process crashed but service remained running"
                                        type = "auto-recovery"
                                        severity = "high"
                                    }
                                    Send-DiscordNotification -Type 'admin.alert' -Data $recoveryData
                                }
                            } else {
                                Write-Log "[Monitoring] Automatic server repair FAILED - manual intervention required!" -Level Error
                                # Send critical admin-only alert
                                if (Get-Command 'Send-DiscordNotification' -ErrorAction SilentlyContinue) {
                                    $alertData = @{
                                        timestamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
                                        service_name = $script:ServiceName
                                        error = "Auto-repair failed - manual intervention required"
                                        reason = $healthCheckResult.Reason
                                        type = "auto-repair-failed"
                                        message = "Server crashed and automatic repair failed. Manual intervention required!"
                                        severity = "critical"
                                    }
                                    Send-DiscordNotification -Type 'admin.alert' -Data $alertData
                                }
                            }
                        } else {
                            Write-Log "[Monitoring] Repair-GameService function not available - cannot auto-repair!" -Level Error
                        }
                    } else {
                        Write-Log "[Monitoring] Auto-restart is DISABLED in config - crash detected but no action taken" -Level Warning
                        # Send admin-only notification about the crash
                        if (Get-Command 'Send-DiscordNotification' -ErrorAction SilentlyContinue) {
                            $crashData = @{
                                timestamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
                                service_name = $script:ServiceName
                                error = "Server process crashed (auto-restart disabled)"
                                reason = $healthCheckResult.Reason
                                type = "crash-detected"
                                message = "Server process crashed but auto-restart is disabled. Manual intervention required!"
                                severity = "critical"
                            }
                            Send-DiscordNotification -Type 'admin.alert' -Data $crashData
                        }
                    }
                }
            } else {
                Write-Verbose "[Monitoring] Server health check PASSED: $($healthCheckResult.Reason)"
            }
        }
        
        # Check for new log events first (this is the primary source of truth for SERVER state)
        $stateChangedViaLogs = $false
        if (Get-Command "Read-GameLogs" -ErrorAction SilentlyContinue) {
            try {
                $newLogEvents = Read-GameLogs
                foreach ($event in $newLogEvents) {
                    if ($event.IsStateChange -and $event.EventType -in @("ServerOnline", "ServerOffline", "ServerShuttingDown", "ServerStarting", "ServerLoading")) {
                        Write-Verbose "[Monitoring] Log parser detected SERVER state change: $($event.EventType)"
                        
                        # Send notification based on log parser event (these are ACCURATE server states)
                        $notificationType = switch ($event.EventType) {
                            "ServerOnline" { 
                                # Server truly online - Global Stats detected - READY FOR PLAYERS
                                'server.online' 
                            }
                            "ServerOffline" { 
                                # Server truly offline - log file closed - COMPLETELY STOPPED
                                'server.offline' 
                            }
                            "ServerShuttingDown" { 
                                # Server is shutting down - still running but shutting down
                                'server.shutting_down'  # Specific notification for shutdown process
                            }
                            "ServerStarting" { 
                                # Server is starting up - not ready yet
                                'server.starting'  # Specific notification for startup process
                            }
                            "ServerLoading" {
                                # Server loading world - not ready for players yet
                                'server.loading'  # Specific notification for loading phase
                            }
                            default { $null }
                        }
                        
                        if ($notificationType) {
                            # Anti-spam logic - allow normal sequences but prevent duplicates
                            $shouldSkip = $false
                            
                            # Normal sequence: shutting_down → offline is ALLOWED
                            # Only skip TRUE DUPLICATES (same notification type)
                            if ($notificationType -eq $script:ServerState.LastNotificationType) {
                                Write-Verbose "[Monitoring] Skipping duplicate $notificationType notification"
                                $shouldSkip = $true
                            }
                            # Don't send offline during startup sequence (false positive)
                            elseif ($notificationType -eq 'server.offline' -and $script:ServerState.LastNotificationType -in @('server.starting', 'service.started')) {
                                Write-Verbose "[Monitoring] Skipping server.offline during startup sequence - likely false positive"
                                $shouldSkip = $true
                            }
                            # EXTRA: Don't send server.offline immediately after server.online during restart sequence
                            elseif ($notificationType -eq 'server.offline' -and $script:ServerState.LastNotificationType -eq 'server.online') {
                                $timeSinceLastNotification = if ($script:ServerState.LastNotificationTime) { 
                                    (Get-Date) - $script:ServerState.LastNotificationTime 
                                } else { 
                                    [TimeSpan]::FromMinutes(10) 
                                }
                                if ($timeSinceLastNotification.TotalSeconds -lt 30) {
                                    Write-Verbose "[Monitoring] Skipping server.offline too soon after server.online ($([Math]::Round($timeSinceLastNotification.TotalSeconds, 1))s) - likely restart artifacts"
                                    $shouldSkip = $true
                                }
                            }
                            
                            if (-not $shouldSkip) {
                                # Update our internal state immediately based on log event
                                $script:ServerState.IsRunning = ($event.EventType -eq "ServerOnline")
                                
                                Send-StateNotification -Type $notificationType
                                $stateChangedViaLogs = $true
                            }
                        } else {
                            Write-Verbose "[Monitoring] Server state event $($event.EventType) detected but no notification sent (transitional state)"
                        }
                    }
                }
            } catch {
                Write-Log "[Monitoring] Error reading log events: $($_.Exception.Message)" -Level Warning
            }
        }
        
        # Update current state (combines service + log data)
        Update-ServerState
        
        Write-Verbose "[Monitoring] Update-ServerMonitoring - Current state: IsRunning=$($script:ServerState.IsRunning)"
        
        # Only check for service-based state changes if logs didn't already handle it
        # AND avoid duplicate notifications when server state changes were already handled by logs
        if (-not $stateChangedViaLogs -and $previousState.IsRunning -ne $script:ServerState.IsRunning) {
            Write-Verbose "[Monitoring] Service-based state change detected: $($previousState.IsRunning) -> $($script:ServerState.IsRunning)"
            
            # Double-check: Don't send server.online if we just sent it via logs
            # Don't send duplicate or inappropriate notifications 
            $skipNotification = $false
            if ($script:ServerState.IsRunning -and $script:ServerState.LastNotificationType -eq 'server.online') {
                Write-Verbose "[Monitoring] Skipping duplicate server.online notification (already sent via logs)"
                $skipNotification = $true
            } elseif (-not $script:ServerState.IsRunning -and $script:ServerState.LastNotificationType -in @('service.stopped')) {
                Write-Verbose "[Monitoring] Skipping redundant server.offline notification (service already stopped)"
                $skipNotification = $true
            }
            
            if (-not $skipNotification) {
                $notificationType = if ($script:ServerState.IsRunning) { 'server.online' } else { 'server.offline' }
                Send-StateNotification -Type $notificationType
            }
        } elseif (-not $stateChangedViaLogs) {
            # Only log this in verbose mode to reduce spam
            Write-Verbose "[Monitoring] No state change detected (IsRunning=$($script:ServerState.IsRunning))"
        }
        
        # Check for Windows service status changes (admin notifications)
        if ($previousState.ServiceStatus -ne $script:ServerState.ServiceStatus) {
            Write-Verbose "[Monitoring] Windows service status changed: $($previousState.ServiceStatus) -> $($script:ServerState.ServiceStatus)"
            
            $serviceNotificationType = switch ($script:ServerState.ServiceStatus) {
                'Running' { 'service.started' }
                'Stopped' { 'service.stopped' }
                'StartPending' { 'service.starting' }
                'StopPending' { 'service.stopping' }
                default { $null }
            }
            
            if ($serviceNotificationType) {
                Send-StateNotification -Type $serviceNotificationType
                
                # Note: Don't send additional server.offline here - log parser handles server state notifications
                # Service notifications are about Windows service state, server notifications are about actual server state
            }
        }
        
        # Check performance alerts
        Test-PerformanceAlerts
        
        # AUTO-UPDATE DISCORD INTEGRATION
        # This ensures Discord status is always current when server state changes
        Update-DiscordIntegration
        
        # Return current state for Discord updates
        return @{
            IsRunning = $script:ServerState.IsRunning
            OnlinePlayers = $script:ServerState.OnlinePlayers
            MaxPlayers = $script:ServerState.MaxPlayers
            LastUpdate = $script:ServerState.LastUpdate
        }
        
    } catch {
        Write-Log "[Monitoring] Error in server monitoring update: $($_.Exception.Message)" -Level Error
        return @{
            IsRunning = $false
            OnlinePlayers = 0
            MaxPlayers = 64
            LastUpdate = (Get-Date)
        }
    }
}

function Get-ServerPlayers {
    <#
    .SYNOPSIS
    Get current list of players on the server
    #>
    
    try {
        if (Get-Command "Get-OnlinePlayers" -ErrorAction SilentlyContinue) {
            $dbPlayers = Get-OnlinePlayers -ErrorAction SilentlyContinue
            if ($dbPlayers -and $dbPlayers.Count -gt 0) {
                return $dbPlayers | ForEach-Object {
                    @{
                        Name = $_.PlayerName
                        SteamID = $_.SteamID
                        ConnectedTime = $_.LoginTime
                        IsOnline = $true
                        Level = $_.Level
                        Location = "$($_.LocationX), $($_.LocationY)"
                    }
                }
            }
        }
        return @()
    } catch {
        Write-Log "[Monitoring] Error getting player list: $($_.Exception.Message)" -Level Warning
        return @()
    }
}

# ===============================================================
# NOTIFICATION SYSTEM
# ===============================================================

function Send-StateNotification {
    <#
    .SYNOPSIS
    Send notification for state changes
    #>
    param(
        [Parameter(Mandatory=$true)]
        [ValidateSet('server.started','server.stopped','server.online','server.offline','server.starting','server.shutting_down','server.loading','service.started','service.stopped','service.starting','service.stopping','performance.poor','performance.critical')]
        [string]$Type
    )
    
    try {
        # Create notification data
        $now = Get-Date
        
        # Get fresh performance data for critical alerts
        $freshPerformanceData = @{
            CPU = $script:ServerState.Performance.CPU  # Use cached CPU if available
            Memory = 0
            FPS = $script:ServerState.Performance.FPS
            Entities = $script:ServerState.Performance.Entities
        }
        
        # Get current process data for more accurate Memory and try CPU
        $scumProcess = Get-Process -Name "SCUMServer" -ErrorAction SilentlyContinue
        if ($scumProcess) {
            # Get memory in MB
            $freshPerformanceData.Memory = [Math]::Round($scumProcess.WorkingSet64 / 1MB, 0)
            
            # Try to get CPU usage using WMI if available
            try {
                $processWMI = Get-WmiObject -Query "SELECT * FROM Win32_PerfRawData_PerfProc_Process WHERE IDProcess = $($scumProcess.Id)" -ErrorAction SilentlyContinue
                if ($processWMI -and $processWMI.PercentProcessorTime) {
                    # This is a raw counter, we would need two samples to calculate percentage
                    # For now, use cached value or 0
                    Write-Verbose "[Monitoring] WMI process data found but raw counter calculation complex"
                }
            } catch {
                Write-Verbose "[Monitoring] Could not get WMI data for CPU"
            }
            
            # Alternative: Use cached CPU from last performance update if it's recent
            if ($script:ServerState.Performance.CPU -and $script:ServerState.Performance.CPU -gt 0) {
                $freshPerformanceData.CPU = $script:ServerState.Performance.CPU
            }
        }
        
        # Get current player count from ServerState or database
        $currentPlayers = $script:ServerState.OnlinePlayers
        $maxPlayers = $script:ServerState.MaxPlayers
        
        # Try to get fresh player data from centralized service if available
        if ((-not $currentPlayers -or $currentPlayers -le 0) -and (Get-Command "Get-DatabaseServiceStats" -ErrorAction SilentlyContinue)) {
            try {
                $dbStats = Get-DatabaseServiceStats
                if ($dbStats.TotalPlayers -and $dbStats.TotalPlayers -gt 0) {
                    $currentPlayers = [int]$dbStats.TotalPlayers
                    Write-Verbose "[Monitoring] Got fresh player count from centralized service: $currentPlayers"
                }
            } catch {
                Write-Verbose "[Monitoring] Could not get player count from centralized service"
                $currentPlayers = 0
            }
        }
        
        $data = @{
            timestamp = $now.ToString('yyyy-MM-dd HH:mm:ss')
            service_name = $script:ServiceName
            players = $currentPlayers
            max_players = $maxPlayers
            cpu = $freshPerformanceData.CPU
            memory = $freshPerformanceData.Memory
            fps = $freshPerformanceData.FPS
            entities = $freshPerformanceData.Entities
        }
        
        # Send to Discord via unified notification system
        if (Get-Command 'Send-DiscordNotification' -ErrorAction SilentlyContinue) {
            Write-Verbose "[Monitoring] Sending $Type notification..."
            $result = Send-DiscordNotification -Type $Type -Data $data
            if ($result.Success) {
                Write-Verbose "[Monitoring] $Type notification sent successfully"
                $script:ServerState.LastNotificationType = $Type  # Track last sent notification
                $script:ServerState.LastNotificationTime = $now   # Track notification time for anti-spam logic
            } else {
                Write-Log "[Monitoring] Failed to send $Type notification: $($result.Error)" -Level Warning
            }
        } else {
            Write-Log "[Monitoring] Discord not available for $Type notification" -Level Warning
        }
        
    } catch {
        Write-Log "[Monitoring] Error sending $Type notification: $($_.Exception.Message)" -Level Warning
    }
}

function Test-PerformanceAlerts {
    <#
    .SYNOPSIS
    Check performance metrics and send alerts if needed based on FPS thresholds from config
    #>
    
    try {
        # FIRST: Check if server is actually running (multiple checks)
        if (-not $script:ServerState.IsRunning) {
            Write-Verbose "[Monitoring] Skipping performance alerts - ServerState.IsRunning=false"
            return
        }
        
        # SECOND: Double-check with actual service and process status
        $service = Get-Service -Name $script:ServiceName -ErrorAction SilentlyContinue
        if (-not $service -or $service.Status -ne 'Running') {
            Write-Verbose "[Monitoring] Skipping performance alerts - Service not running: $($service.Status)"
            return
        }
        
        # THIRD: Verify process exists
        $process = Get-Process -Name "SCUMServer" -ErrorAction SilentlyContinue
        if (-not $process) {
            Write-Verbose "[Monitoring] Skipping performance alerts - SCUMServer process not found"
            return
        }
        
        # FOURTH: Check actual server state from logs
        $actualServerState = Get-ActualServerStateFromLogs
        if ($actualServerState -ne "Online") {
            Write-Verbose "[Monitoring] Skipping performance alerts - Server state from logs: $actualServerState (not Online)"
            return
        }
        
        # FIFTH: Smart check - don't alert on low FPS when no players are connected
        # When server has no players, it's normal and expected to have low FPS for power saving
        $currentPlayers = $script:ServerState.OnlinePlayers
        if (-not $currentPlayers -or $currentPlayers -le 0) {
            # Double-check with centralized service if cached value is 0
            if (Get-Command "Get-DatabaseServiceStats" -ErrorAction SilentlyContinue) {
                try {
                    $dbStats = Get-DatabaseServiceStats
                    if ($dbStats.TotalPlayers -and $dbStats.TotalPlayers -gt 0) {
                        $currentPlayers = [int]$dbStats.TotalPlayers
                    }
                } catch {
                    Write-Verbose "[Monitoring] Could not get player count from centralized service"
                    $currentPlayers = 0
                }
            }
        }
        
        # Default behavior: Only monitor performance when players are connected
        # Empty server naturally reduces FPS for power saving - this is normal and expected
        if ($currentPlayers -le 0) {
            Write-Verbose "[Monitoring] Skipping performance alerts - no players connected ($currentPlayers). Server naturally reduces FPS when empty to save resources."
            return
        } else {
            Write-Verbose "[Monitoring] Players connected ($currentPlayers), performance monitoring active"
        }
        
        Write-Verbose "[Monitoring] Performance alert checks passed - server is truly online, proceeding with performance monitoring"
        
        # Skip if we don't have config
        if (-not $script:Config) {
            return
        }
        
        # Get performance thresholds from config
        $thresholds = $script:Config.performanceThresholds
        if (-not $thresholds) {
            Write-Verbose "[Monitoring] No performance thresholds configured, skipping alerts"
            return
        }
        
        # Get alert threshold level from config
        $alertThreshold = if ($script:Config.performanceAlertThreshold) { 
            $script:Config.performanceAlertThreshold.ToLower() 
        } else { 
            "critical" 
        }
        
        # Get cooldown from config
        $cooldownMinutes = if ($script:Config.performanceAlertCooldownMinutes) {
            $script:Config.performanceAlertCooldownMinutes
        } else {
            30  # Default 30 minutes
        }
        
        # Check if we're still in cooldown period
        if ($script:ServerState.LastPerformanceAlert) {
            $timeSinceLastAlert = (Get-Date) - $script:ServerState.LastPerformanceAlert
            if ($timeSinceLastAlert.TotalMinutes -lt $cooldownMinutes) {
                Write-Verbose "[Monitoring] Performance alert in cooldown (remaining: $([Math]::Round($cooldownMinutes - $timeSinceLastAlert.TotalMinutes, 1)) min)"
                return
            }
        }
        
        $currentFPS = $script:ServerState.Performance.FPS
        $alertType = $null
        
        # Only send alerts if FPS data is available (> 0)
        if ($currentFPS -le 0) {
            Write-Verbose "[Monitoring] No FPS data available, skipping performance alerts"
            return
        }
        
        # Determine alert type based on FPS and configured threshold
        if ($currentFPS -le $thresholds.critical) {
            $alertType = 'performance.critical'
        } elseif ($currentFPS -le $thresholds.poor -and $alertThreshold -in @('poor', 'fair')) {
            # Only send poor alerts if threshold is set to 'poor' or 'fair'
            $alertType = 'performance.poor'
        } elseif ($currentFPS -le $thresholds.fair -and $alertThreshold -eq 'fair') {
            # Only send 'fair' alerts if threshold is specifically set to 'fair'
            # For now, we'll skip 'fair' as it's not in our notification types
            Write-Verbose "[Monitoring] Fair performance detected (FPS: $currentFPS), but no 'fair' alert type configured"
        }
        
        # Send performance alert if needed
        if ($alertType) {
            Write-Log "[Monitoring] Performance alert triggered: $alertType (FPS: $currentFPS, Threshold: $alertThreshold)" -Level Warning
            
            # Get FRESH performance data for the alert - no cached values, no fallbacks
            $currentMemory = 0
            $currentCPU = 0
            $currentPlayers = 0
            $currentEntities = 0
            
            # Get fresh memory from process
            $scumProcess = Get-Process -Name "SCUMServer" -ErrorAction SilentlyContinue
            if ($scumProcess) {
                $currentMemory = [Math]::Round($scumProcess.WorkingSet64 / 1MB, 0)
                Write-Verbose "[Monitoring] Fresh memory data: $currentMemory MB"
            }
            
            # Get REAL CPU usage - calculate from process CPU time over a 2-second interval
            try {
                $cpu1 = Get-Process -Name "SCUMServer" -ErrorAction SilentlyContinue
                if ($cpu1) {
                    $time1 = Get-Date
                    Start-Sleep -Milliseconds 1000  # 1 second sample
                    $cpu2 = Get-Process -Name "SCUMServer" -ErrorAction SilentlyContinue
                    $time2 = Get-Date
                    
                    if ($cpu2) {
                        $timeDiff = ($time2 - $time1).TotalMilliseconds
                        $cpuTimeDiff = ($cpu2.TotalProcessorTime - $cpu1.TotalProcessorTime).TotalMilliseconds
                        $currentCPU = [Math]::Round(($cpuTimeDiff / $timeDiff) * 100 / [Environment]::ProcessorCount, 1)
                        Write-Verbose "[Monitoring] Real CPU calculation: $currentCPU% (time diff: $timeDiff ms, cpu diff: $cpuTimeDiff ms)"
                    }
                }
            } catch {
                Write-Verbose "[Monitoring] CPU calculation failed: $($_.Exception.Message)"
                # If we can't get real CPU, don't show fake data
                $currentCPU = 0
            }
            
            # Get ONLINE player count only - not total registered players
            if ($script:ServerState.OnlinePlayers) {
                $currentPlayers = $script:ServerState.OnlinePlayers
                Write-Verbose "[Monitoring] Using cached online players: $currentPlayers"
            } else {
                # Try to get ONLINE players from centralized service first
                if (Get-Command "Get-DatabaseServiceStats" -ErrorAction SilentlyContinue) {
                    try {
                        $dbStats = Get-DatabaseServiceStats
                        if ($dbStats.TotalPlayers -and $dbStats.TotalPlayers -ge 0) {
                            $currentPlayers = [int]$dbStats.TotalPlayers
                            Write-Verbose "[Monitoring] Fresh player count from centralized service: $currentPlayers"
                        }
                    } catch {
                        Write-Verbose "[Monitoring] Could not get player count from centralized service"
                        $currentPlayers = 0
                    }
                } else {
                    $currentPlayers = 0
                }
            }
            $maxPlayers = if ($script:ServerState.MaxPlayers) { $script:ServerState.MaxPlayers } else { 64 }
            
            # Get entities count
            if ($script:ServerState.Performance.Entities -and $script:ServerState.Performance.Entities -gt 0) {
                $currentEntities = $script:ServerState.Performance.Entities
            } else {
                $currentEntities = 0
            }
            
            # Create notification data with FRESH real values only
            $alertData = @{
                timestamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
                service_name = $script:ServiceName
                fps = $currentFPS
                cpu = $currentCPU
                memory = $currentMemory
                players = $currentPlayers
                max_players = $maxPlayers
                entities = $currentEntities
            }
            
            # Send to Discord
            if (Get-Command 'Send-DiscordNotification' -ErrorAction SilentlyContinue) {
                Write-Verbose "[Monitoring] Sending $alertType notification with fresh data..."
                $result = Send-DiscordNotification -Type $alertType -Data $alertData
                if ($result -and $result.Success) {
                    Write-Verbose "[Monitoring] $alertType notification sent successfully"
                } else {
                    Write-Log "[Monitoring] Failed to send $alertType notification: $($result.Error)" -Level Warning
                }
            } else {
                Write-Log "[Monitoring] Discord not available for $alertType notification" -Level Warning
            }
            
            # Update last alert time to start cooldown
            $script:ServerState.LastPerformanceAlert = Get-Date
        } else {
            Write-Verbose "[Monitoring] Performance OK: FPS=$currentFPS (Threshold: $alertThreshold)"
        }
        
    } catch {
        Write-Log "[Monitoring] Error checking performance alerts: $($_.Exception.Message)" -Level Warning
    }
}

# ===============================================================
# CLEANUP AND UTILITY FUNCTIONS
# ===============================================================

function Stop-MonitoringModule {
    <#
    .SYNOPSIS
    Stop the monitoring module
    #>
    
    try {
        $script:Initialized = $false
        Write-Log "[Monitoring] Monitoring stopped" -Level Info
        
    } catch {
        Write-Log "[Monitoring] Error stopping monitoring: $($_.Exception.Message)" -Level Warning
    }
}

function Update-MonitoringMetrics {
    <#
    .SYNOPSIS
    Update monitoring metrics - triggers immediate state update
    #>
    
    try {
        Update-ServerState
        Test-PerformanceAlerts
    } catch {
        Write-Log "[Monitoring] Error updating monitoring metrics: $($_.Exception.Message)" -Level Warning
    }
}

# ===============================================================
# PERFORMANCE CACHE INITIALIZATION
# ===============================================================

function Initialize-PerformanceCache {
    <#
    .SYNOPSIS
    Initialize performance cache by processing recent log lines on startup
    #>
    
    try {
        # Check if parser functions are available
        if (-not (Get-Command "Parse-LogLine" -ErrorAction SilentlyContinue)) {
            Write-Verbose "[Monitoring] Parser functions not available for performance cache initialization"
            return
        }
        
        # Determine log file path
        $logPath = $null
        if ($script:Config -and $script:Config.serverDir) {
            $logPath = Join-Path $script:Config.serverDir "SCUM\Saved\Logs\SCUM.log"
        } else {
            $logPath = ".\server\SCUM\Saved\Logs\SCUM.log"
        }
        
        if (-not (Test-Path $logPath)) {
            Write-Verbose "[Monitoring] Log file not found at $logPath - skipping performance cache initialization"
            return
        }
        
        Write-Verbose "[Monitoring] Initializing performance cache from recent log data..."
        
        # Read recent log lines and process Global Stats entries
        $allLines = Get-Content $logPath -ErrorAction SilentlyContinue
        if ($allLines -and $allLines.Count -gt 0) {
            # Process last 50 lines looking for Global Stats
            $recentLines = $allLines | Select-Object -Last 50
            $globalStatsProcessed = 0
            
            foreach ($line in $recentLines) {
                if ($line -match "LogSCUM: Global Stats:") {
                    try {
                        $null = Parse-LogLine -LogLine $line
                        $globalStatsProcessed++
                        # Process a few recent entries to get current data
                        if ($globalStatsProcessed -ge 3) { break }
                    } catch {
                        Write-Verbose "[Monitoring] Error parsing log line: $($_.Exception.Message)"
                    }
                }
            }
            
            if ($globalStatsProcessed -gt 0) {
                Write-Verbose "[Monitoring] Processed $globalStatsProcessed Global Stats entries for performance cache"
            } else {
                Write-Verbose "[Monitoring] No recent Global Stats entries found in log"
            }
        }
        
    } catch {
        Write-Verbose "[Monitoring] Error initializing performance cache: $($_.Exception.Message)"
    }
}

# ===============================================================
# DISCORD INTEGRATION HELPER
# ===============================================================

function Update-DiscordIntegration {
    <#
    .SYNOPSIS
    Update Discord bot activity and status embed when server state changes
    .DESCRIPTION
    This function ensures Discord always reflects current server state.
    Called automatically from Update-ServerMonitoring on every monitoring cycle.
    #>
    
    try {
        # Check if Discord bot is connected
        $botConnected = $false
        if (Get-Command "Test-DiscordBotStatus" -ErrorAction SilentlyContinue) {
            $botConnected = Test-DiscordBotStatus
        }
        
        # If bot not connected, try to reconnect
        if (-not $botConnected) {
            Write-Verbose "[Monitoring] Discord bot disconnected, attempting reconnect..."
            
            # Try to reinitialize Discord integration if config is available
            if ($script:Config -and $script:Config.Discord) {
                try {
                    # Initialize Discord API if not already done
                    if (Get-Command "Initialize-DiscordAPI" -ErrorAction SilentlyContinue) {
                        Initialize-DiscordAPI -Token $script:Config.Discord.Token | Out-Null
                    }
                    
                    # Initialize full Discord integration  
                    if (Get-Command "Initialize-DiscordIntegration" -ErrorAction SilentlyContinue) {
                        Initialize-DiscordIntegration -Config $script:Config | Out-Null
                        Write-Verbose "[Monitoring] Discord integration reconnected"
                    }
                } catch {
                    Write-Verbose "[Monitoring] Failed to reconnect Discord: $($_.Exception.Message)"
                }
            }
        }
        
        # Update bot activity if bot is connected
        if (Get-Command "Update-BotActivity" -ErrorAction SilentlyContinue) {
            $currentStatus = Get-ServerStatus
            if ($currentStatus) {
                Update-BotActivity -ServerStatus $currentStatus | Out-Null
                Write-Verbose "[Monitoring] Discord bot activity updated"
            }
        }
        
        # Update server status embed if available
        if (Get-Command "Update-DiscordServerStatus" -ErrorAction SilentlyContinue) {
            $currentStatus = Get-ServerStatus  
            if ($currentStatus) {
                Update-DiscordServerStatus -ServerStatus $currentStatus | Out-Null
                Write-Verbose "[Monitoring] Discord server status embed updated"
            }
        }
        
    } catch {
        Write-Verbose "[Monitoring] Error updating Discord integration: $($_.Exception.Message)"
    }
}

# ===============================================================
# MODULE EXPORTS
# ===============================================================

Export-ModuleMember -Function @(
    'Initialize-MonitoringModule',
    'Get-ServerStatus',
    'Get-ServerPlayers', 
    'Get-CurrentPlayerCount',
    'Update-MonitoringMetrics',
    'Update-ServerMonitoring',
    'Update-DiscordIntegration',
    'Stop-MonitoringModule'
)
