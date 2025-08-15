# ===============================================================
# SCUM Server Automation - Log Parser
# ===============================================================
# SCUM server log file monitoring and event parsing
# Tracks player events, server status, and game activities
# ===============================================================

#Requires -Version 5.1

# Standard import of common module
try {
    $helperPath = Join-Path $PSScriptRoot "..\module-helper.psm1"
    if (Test-Path $helperPath) {
        # MEMORY LEAK FIX: Check if module already loaded before importing
        if (-not (Get-Module "module-helper" -ErrorAction SilentlyContinue)) {
            Import-Module $helperPath -ErrorAction SilentlyContinue
        }
        Import-CommonModule | Out-Null
    }

    # MEMORY LEAK FIX: Import log streaming helper - check if already loaded
    $streamingPath = Join-Path $PSScriptRoot "..\log-streaming.psm1"
    if (Test-Path $streamingPath) {
        if (-not (Get-Module "log-streaming" -ErrorAction SilentlyContinue)) {
            Import-Module $streamingPath -ErrorAction SilentlyContinue
        }
    }
    
} catch {
    Write-Host "[WARNING] Common module not available for parser module" -ForegroundColor Yellow
}

# Module variables
$script:LogLinePosition = 0
$script:LastLogFileSize = $null
$script:LogMonitoringEnabled = $false
$script:LogFilePath = $null
$script:LogReaderConfig = $null

# Event tracking for parsed data
# Module variables - MEMORY LEAK FIX: Use ArrayList instead of @() array
$script:LastParsedEvents = New-Object System.Collections.ArrayList
$script:MaxEventHistory = 100

# Cache for latest performance stats to always provide current data
$script:LastKnownPerformanceStats = $null

# State tracking to prevent duplicate logging
$script:LastLoggedEventType = $null
$script:LastEventTimestamp = $null
$script:EventCount = @{}

function Initialize-LogReaderModule {
    <#
    .SYNOPSIS
    Initialize log reader module for parsing logs only
    .PARAMETER Config
    Configuration object
    .PARAMETER LogPath
    Path to SCUM server log file
    #>
    param(
        [Parameter(Mandatory)]
        [object]$Config,
        
        [Parameter()]
        [string]$LogPath
    )
    
    $script:LogReaderConfig = $Config
    
    if ($LogPath -and (Test-PathExists $LogPath)) {
        $script:LogMonitoringEnabled = $true
        $script:LogFilePath = $LogPath
        
        # Initialize file position - start from end to avoid replaying old events
        $fileInfo = Get-ItemSafe $LogPath
        if ($fileInfo) {
            $script:LastLogFileSize = $fileInfo.Length
            # Count lines using streaming instead of loading entire file
            try {
                $lineCount = 0
                $streamReader = $null
                $fileStream = $null
                try {
                    $fileStream = [System.IO.FileStream]::new($LogPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
                    $streamReader = [System.IO.StreamReader]::new($fileStream)
                    
                    while (-not $streamReader.EndOfStream) {
                        $streamReader.ReadLine() | Out-Null
                        $lineCount++
                    }
                } finally {
                    if ($streamReader) { $streamReader.Close(); $streamReader.Dispose() }
                    if ($fileStream) { $fileStream.Close(); $fileStream.Dispose() }
                }
                $script:LogLinePosition = $lineCount
            } catch {
                $script:LogLinePosition = 0
            }
        }
        
        Write-Log "[LogReader] Log monitoring initialized for: $LogPath"
        
        # Reset state to prevent spam on initialization
        $script:LastLoggedEventType = $null
        $script:LastEventTimestamp = $null
        $script:EventCount = @{}
    } else {
        $script:LogMonitoringEnabled = $false
        $script:LogFilePath = $null
        Write-Log "[LogReader] Log file not found, monitoring disabled: $LogPath" -Level Warning
    }
    
    Write-Log "[LogReader] Module initialized - focused on log parsing only"
}

function Read-NewLogLines {
    <#
    .SYNOPSIS
    Read new lines from log file since last check
    .PARAMETER LogPath
    Path to log file
    .RETURNS
    Array of new log lines
    #>
    param(
        [Parameter(Mandatory)]
        [string]$LogPath
    )
    
    if (-not $script:LogMonitoringEnabled -or -not (Test-PathExists $LogPath)) {
        return @()
    }
    
    try {
        $fileInfo = Get-ItemSafe $LogPath
        if (-not $fileInfo) {
            return @()
        }
        
        $currentSize = $fileInfo.Length
        
        # Check for log rotation (file got smaller)
        if ($script:LastLogFileSize -and $currentSize -lt $script:LastLogFileSize) {
            Write-Log "[LogReader] Log rotation detected, resetting position"
            $script:LogLinePosition = 0
            $script:LastLogFileSize = $currentSize
            
            # CRITICAL FIX: Clear event history to prevent old events from causing false notifications
            $script:LastParsedEvents = New-Object System.Collections.ArrayList
            $script:LastKnownPerformanceStats = $null
            Write-Log "[LogReader] Event history cleared due to log rotation" -Level Info
        }
        
        # No new content
        if ($currentSize -eq $script:LastLogFileSize) {
            return @()
        }
        
        # MEMORY LEAK FIX: Use streaming approach instead of loading entire file
        $newLines = @()
        $streamReader = $null
        $fileStream = $null
        
        try {
            $fileStream = [System.IO.FileStream]::new($LogPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
            $streamReader = [System.IO.StreamReader]::new($fileStream)
            
            $currentLineNumber = 0
            
            # Skip lines we've already processed
            while ($currentLineNumber -lt $script:LogLinePosition -and -not $streamReader.EndOfStream) {
                $streamReader.ReadLine() | Out-Null
                $currentLineNumber++
            }
            
            # Read new lines
            while (-not $streamReader.EndOfStream) {
                $line = $streamReader.ReadLine()
                if ($line -ne $null) {
                    # MEMORY LEAK FIX: Use ArrayList instead of array +=
                    if (-not $newLines) {
                        $newLines = New-Object System.Collections.ArrayList
                    }
                    $null = $newLines.Add($line)
                    $currentLineNumber++
                }
            }
            
            # Update our position
            $script:LogLinePosition = $currentLineNumber
            
        } finally {
            if ($streamReader) { $streamReader.Close(); $streamReader.Dispose() }
            if ($fileStream) { $fileStream.Close(); $fileStream.Dispose() }
        }
        
        $script:LastLogFileSize = $currentSize
        return $newLines
        
    } catch {
        Write-Log "[LogReader] Error reading log file: $($_.Exception.Message)" -Level Error
        return @()
    }
}

function Parse-LogLine {
    <#
    .SYNOPSIS
    Parse a single log line and extract event data
    .PARAMETER LogLine
    Log line to parse
    .PARAMETER Silent
    If true, suppresses event logging
    .RETURNS
    Hashtable with parsed event data or $null if no relevant data
    #>
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$LogLine,
        
        [Parameter()]
        [switch]$Silent
    )
    
    # Skip empty or whitespace-only lines
    if ([string]::IsNullOrWhiteSpace($LogLine)) { 
        return $null
    }

    $parsedEvent = @{
        RawLine = $LogLine
        Timestamp = $null
        EventType = "Unknown"
        Data = @{}
    }
    
    # Extract timestamp if available
    if ($LogLine -match '^[\[](\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}:\d{3})') {
        try {
            $timeStr = $matches[1] -replace '\.', '/' -replace '-', ' ' -replace ':', '.'
            $parsedEvent.Timestamp = [datetime]::ParseExact($timeStr, 'yyyy/MM/dd HH.mm.ss.fff', $null)
        } catch {
            # If parsing fails, use current time
            $parsedEvent.Timestamp = Get-Date
        }
    } else {
        $parsedEvent.Timestamp = Get-Date
    }
    
    # Identify event types and extract relevant data
    if ($LogLine -match 'Log file open' -or $LogLine -match 'LogInit: Display: Starting Game') {
        $parsedEvent.EventType = "ServerStarting"
        $parsedEvent.Data.Phase = "Initializing"
        
    } elseif ($LogLine -match 'LogGameState: Match State Changed from EnteringMap to WaitingToStart') {
        $parsedEvent.EventType = "ServerLoading"
        $parsedEvent.Data.Phase = "Loading World"
    
    } elseif ($LogLine -match 'LogSCUM: Global Stats:') {
        $parsedEvent.EventType = "ServerOnline"
        $parsedEvent.Data.Phase = "Online"
        
        # Parse performance data
        $perfStats = Parse-GlobalStatsLine $LogLine
        if ($perfStats) {
            $parsedEvent.Data.PerformanceStats = $perfStats
            $parsedEvent.Data.PlayerCount = $perfStats.PlayerCount
            
            # Cache the latest performance stats for always-available data
            $script:LastKnownPerformanceStats = $perfStats
            $script:LastKnownPerformanceStats.Timestamp = $parsedEvent.Timestamp
        }
        
    } elseif ($LogLine -match 'LogCore: Warning: \*\*\* INTERRUPTED \*\*\*.*SHUTTING DOWN') {
        $parsedEvent.EventType = "ServerShuttingDown"
        $parsedEvent.Data.Phase = "Shutting Down"
    
    } elseif (($LogLine -match 'LogWorld: UWorld::CleanupWorld.*bSessionEnded=true' -and 
               $LogLine -notmatch 'for Untitled') -or  # Ignore cleanup of "Untitled" during startup
              $LogLine -match 'LogExit: Exiting\.' -or 
              $LogLine -match 'Log file closed') {
        $parsedEvent.EventType = "ServerOffline"
        $parsedEvent.Data.Phase = "Offline"
        
    } else {
        # Return null for lines that don't contain relevant events
        return $null
    }
    
    # Add to event history - MEMORY LEAK FIX: Use ArrayList.Add() instead of +=
    $null = $script:LastParsedEvents.Add($parsedEvent)
    if ($script:LastParsedEvents.Count -gt $script:MaxEventHistory) {
        # Remove oldest events to maintain limit
        while ($script:LastParsedEvents.Count -gt $script:MaxEventHistory) {
            $script:LastParsedEvents.RemoveAt(0)
        }
    }
    
    # Only log significant events if not in silent mode and reduce spam
    if (-not $Silent -and $parsedEvent.EventType -in @("ServerOnline", "ServerOffline", "ServerShuttingDown", "ServerRestarting", "ServerStarting", "ServerLoading")) {
        # Implement state change detection to prevent spam
        $shouldLog = $false
        $isStateChange = $false
        
        # Log if this is a different event type than the last logged one
        if ($script:LastLoggedEventType -ne $parsedEvent.EventType) {
            $shouldLog = $true
            $isStateChange = $true
            $script:LastLoggedEventType = $parsedEvent.EventType
            $script:LastEventTimestamp = $parsedEvent.Timestamp
        }
        # For repeated events, only log if significant time has passed (e.g., 5 minutes)
        elseif ($script:LastEventTimestamp -and 
                $parsedEvent.Timestamp.Subtract($script:LastEventTimestamp).TotalMinutes -gt 5) {
            # Count occurrences
            if (-not $script:EventCount.ContainsKey($parsedEvent.EventType)) {
                $script:EventCount[$parsedEvent.EventType] = 0
            }
            $script:EventCount[$parsedEvent.EventType]++
            
            # Only log summary of repeated events occasionally
            if ($script:EventCount[$parsedEvent.EventType] % 10 -eq 0) {
                Write-Log "[LogReader] Event summary: $($parsedEvent.EventType) occurred $($script:EventCount[$parsedEvent.EventType]) times" -Level Info
            }
            $script:LastEventTimestamp = $parsedEvent.Timestamp
        }
        
        # Add the IsStateChange property to the event
        $parsedEvent.IsStateChange = $isStateChange
        
        if ($shouldLog) {
            Write-Log "[LogReader] Server state change detected: $($parsedEvent.EventType)" -Level Info
        }
    } else {
        # For non-server events, mark as not a state change
        $parsedEvent.IsStateChange = $false
    }
    
    return $parsedEvent
}

function Parse-GlobalStatsLine {
    <#
    .SYNOPSIS
    Parse Global Stats line for performance data
    .PARAMETER Line
    Log line containing global stats
    .RETURNS
    Hashtable with performance statistics
    #>
    param(
        [Parameter(Mandatory)]
        [string]$Line
    )
    
    try {
        $stats = @{
            AverageFPS = 0
            MinFPS = 0
            MaxFPS = 0
            AverageFrameTime = 0
            PlayerCount = 0
            PerformanceStatus = "Unknown"
            Entities = @{
                Characters = 0
                Zombies = 0
                Vehicles = 0
            }
        }
        
        # Parse FPS values from Global Stats format: (  5.0FPS)
        if ($Line -match '\(\s*([0-9.]+)FPS\)') {
            $stats.AverageFPS = [Math]::Round([double]$matches[1], 1)
            $stats.MinFPS = $stats.AverageFPS  # Using same value for all since Global Stats shows current FPS
            $stats.MaxFPS = $stats.AverageFPS
        }
        
        # Parse frame time from: 199.2ms
        if ($Line -match '([0-9.]+)ms\s*\(\s*[0-9.]+FPS\)') {
            $stats.AverageFrameTime = [Math]::Round([double]$matches[1], 2)
        }
        
        # Parse player count from: P:   0 (  0)
        if ($Line -match 'P:\s*(\d+)\s*\(\s*\d+\)') {
            $stats.PlayerCount = [int]$matches[1]
        }
        
        # Parse entity counts from Global Stats format
        if ($Line -match 'C:\s*(\d+)\s*\(\s*\d+\)') {
            $stats.Entities.Characters = [int]$matches[1]
        }
        if ($Line -match 'Z:\s*(\d+)\s*\(\s*\d+\)') {
            $stats.Entities.Zombies = [int]$matches[1]
        }
        if ($Line -match 'V:\s*(\d+)') {
            $stats.Entities.Vehicles = [int]$matches[1]
        }
        
        # Determine performance status
        $stats.PerformanceStatus = Get-PerformanceStatus $stats.AverageFPS
        
        return $stats
        
    } catch {
        Write-Log "[LogReader] Error parsing global stats: $($_.Exception.Message)" -Level Error
        return $null
    }
}

function Get-PerformanceStatus {
    <#
    .SYNOPSIS
    Determine performance status based on FPS
    .PARAMETER Fps
    Average FPS value
    .RETURNS
    Performance status string
    #>
    param(
        [Parameter(Mandatory)]
        [double]$Fps
    )
    
    if ($Fps -le 0) { 
        return "Unknown" 
    }
    
    $thresholds = @{
        excellent = 30
        good = 20
        fair = 15
        poor = 10
    }
    
    # Use config if available
    if ($script:LogReaderConfig) {
        $thresholds = Get-SafeConfigValue $script:LogReaderConfig "performanceThresholds" $thresholds
    }
    
    if ($Fps -ge $thresholds.excellent) {
        return "Excellent"
    } elseif ($Fps -ge $thresholds.good) {
        return "Good"
    } elseif ($Fps -ge $thresholds.fair) {
        return "Fair"
    } elseif ($Fps -ge $thresholds.poor) {
        return "Poor"
    } else {
        return "Critical"
    }
}

function Analyze-RecentLogLines {
    <#
    .SYNOPSIS
    Analyze recent log lines to determine current server state
    .PARAMETER LogLines
    Array of recent log lines
    .RETURNS
    Hashtable with analysis results
    #>
    param(
        [Parameter(Mandatory)]
        [string[]]$LogLines
    )
    
    $analysis = @{
        LastEventType = "Unknown"
        HasGlobalStats = $false
        HasShutdown = $false
        HasExit = $false
        LatestPerformanceStats = $null
        EventsDetected = @()
    }
    
    # Check recent lines for status indicators
    foreach ($line in $LogLines) {
        $parsedEvent = Parse-LogLine -LogLine $line -Silent
        if ($parsedEvent) {
            # MEMORY LEAK FIX: Use ArrayList instead of array +=
            if (-not ($analysis.EventsDetected)) {
                $analysis.EventsDetected = New-Object System.Collections.ArrayList
            }
            $null = $analysis.EventsDetected.Add($parsedEvent)
            $analysis.LastEventType = $parsedEvent.EventType
            
            if ($parsedEvent.EventType -eq "ServerOnline" -and $parsedEvent.Data.PerformanceStats) {
                $analysis.LatestPerformanceStats = $parsedEvent.Data.PerformanceStats
            }
        }
        
        # Legacy checks for compatibility
        if ($line -match 'LogSCUM: Global Stats:') {
            $analysis.HasGlobalStats = $true
        }
        if ($line -match 'SHUTTING DOWN' -or $line -match 'INTERRUPTED') {
            $analysis.HasShutdown = $true
        }
        if ($line -match 'LogWorld: UWorld::CleanupWorld.*bSessionEnded=true' -or 
            $line -match 'LogExit: Exiting\.' -or 
            $line -match 'Log file closed') {
            $analysis.HasExit = $true
        }
    }
    
    return $analysis
}

function Get-LatestPerformanceStats {
    <#
    .SYNOPSIS
    Get the latest known performance stats from cache
    .RETURNS
    Hashtable with latest performance statistics or $null if none available or too old
    #>
    
    # Return null if no stats cached
    if (-not $script:LastKnownPerformanceStats) {
        return $null
    }
    
    # Check if stats have timestamp and are not too old (max 5 minutes)
    if ($script:LastKnownPerformanceStats.Timestamp) {
        $age = (Get-Date) - $script:LastKnownPerformanceStats.Timestamp
        if ($age.TotalMinutes -gt 5) {
            Write-Log "[LogReader] Performance stats too old ($([Math]::Round($age.TotalMinutes, 1)) min) - returning null" -Level Info
            return $null
        }
    }
    
    # Additional validation: Check if SCUM process is actually running
    $scumProcess = Get-Process -Name "SCUMServer" -ErrorAction SilentlyContinue
    if (-not $scumProcess) {
        Write-Log "[LogReader] Performance stats available but SCUMServer process not running - returning null" -Level Info
        return $null
    }
    
    return $script:LastKnownPerformanceStats
}

function Get-ParsedEvents {
    <#
    .SYNOPSIS
    Get recently parsed events from log
    .PARAMETER Count
    Number of recent events to return (default: all)
    .RETURNS
    Array of parsed event objects
    #>
    param(
        [Parameter()]
        [int]$Count = 0
    )
    
    if ($Count -gt 0 -and $script:LastParsedEvents.Count -gt $Count) {
        # MEMORY LEAK FIX: Convert ArrayList to array and get last N items
        $startIndex = [Math]::Max(0, $script:LastParsedEvents.Count - $Count)
        return $script:LastParsedEvents.ToArray()[$startIndex..($script:LastParsedEvents.Count - 1)]
    }
    
    return $script:LastParsedEvents.ToArray()
}

function Read-GameLogs {
    <#
    .SYNOPSIS
    Read new lines from SCUM game log since last check and parse them
    .RETURNS
    Array of parsed event objects
    #>
    
    if (-not $script:LogMonitoringEnabled -or -not $script:LogFilePath) {
        return @()
    }
    
    try {
        $newLines = Read-NewLogLines -LogPath $script:LogFilePath
        
        # Parse each new line into events
        $parsedEvents = @()
        foreach ($line in $newLines) {
            $parsedEvent = Parse-LogLine -LogLine $line
            if ($parsedEvent) {
                # MEMORY LEAK FIX: Use ArrayList instead of array +=
                if (-not $parsedEvents) {
                    $parsedEvents = New-Object System.Collections.ArrayList
                }
                $null = $parsedEvents.Add($parsedEvent)
            }
        }
        
        return $parsedEvents
        
    } catch {
        Write-Log "[LogReader] Error in Read-GameLogs: $($_.Exception.Message)" -Level Warning
        return @()
    }
}

function Get-LogReaderStats {
    <#
    .SYNOPSIS
    Get statistics about log reader operation
    .RETURNS
    Hashtable with statistics
    #>
    
    return @{
        LogMonitoringEnabled = $script:LogMonitoringEnabled
        LogFilePath = $script:LogFilePath
        CurrentPosition = $script:LogLinePosition
        LastFileSize = $script:LastLogFileSize
        EventsInHistory = $script:LastParsedEvents.Count
        MaxEventHistory = $script:MaxEventHistory
        LastLoggedEventType = $script:LastLoggedEventType
        EventCounts = $script:EventCount
    }
}

function Reset-LogParserState {
    <#
    .SYNOPSIS
    Reset parser state to prevent log spam on restart
    #>
    
    $script:LastLoggedEventType = $null
    $script:LastEventTimestamp = $null
    $script:EventCount = @{}
    Write-Log "[LogReader] Parser state reset - event tracking cleared" -Level Info
}

# Export functions - focused on log parsing only
Export-ModuleMember -Function @(
    'Initialize-LogReaderModule',
    'Read-NewLogLines',
    'Parse-LogLine',
    'Parse-GlobalStatsLine',
    'Get-PerformanceStatus',
    'Analyze-RecentLogLines',
    'Get-ParsedEvents',
    'Get-LatestPerformanceStats',
    'Read-GameLogs',
    'Get-LogReaderStats',
    'Reset-LogParserState'
)
