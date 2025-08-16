# ===============================================================
# SCUM Server Automation - Database Management
# ===============================================================
# Main database module that imports all specialized sub-modules
# Provides unified interface for database operations
# ===============================================================

#Requires -Version 5.1

# Standard import of common module
try {
    $helperPath = Join-Path $PSScriptRoot "..\core\module-helper.psm1"
    if (Test-Path $helperPath) {
        # MEMORY LEAK FIX: Check if module already loaded before importing
        if (-not (Get-Module "module-helper" -ErrorAction SilentlyContinue)) {
            Import-Module $helperPath -ErrorAction SilentlyContinue
        }
        Import-CommonModule | Out-Null
    }
} catch {
    Write-Host "[WARNING] Common module not available for vehicle module" -ForegroundColor Yellow
}

# Module variables
$script:DatabaseConfig = $null
$script:DatabasePath = $null
$script:SqliteProvider = "External"  # Always use external sqlite3.exe
$script:SqliteExePath = $null        # Path to sqlite3.exe
$script:LastConnectionTest = [DateTime]::MinValue
$script:ConnectionTestInterval = 300 # 5 minutes
# MEMORY LEAK FIX: Cache expensive file operations
$script:LastSizeCheck = [DateTime]::MinValue
$script:CachedSize = 0
$script:CachedLastWrite = [DateTime]::MinValue

# Sub-module paths
$script:SubModules = @{
    Prisoner = Join-Path $PSScriptRoot "prisoner.psm1"
    Stats = Join-Path $PSScriptRoot "stats.psm1"
    Squad = Join-Path $PSScriptRoot "squad.psm1"
    World = Join-Path $PSScriptRoot "world.psm1"
    Admin = Join-Path $PSScriptRoot "admin.psm1"
    Events = Join-Path $PSScriptRoot "events.psm1"
    Economy = Join-Path $PSScriptRoot "economy.psm1"
    BaseBuilding = Join-Path $PSScriptRoot "basebuilding.psm1"
    Leaderboards = Join-Path $PSScriptRoot "leaderboards.psm1"
}
# ===============================================================
# INITIALIZATION
# ===============================================================

function Initialize-DatabaseModule {
    <#
    .SYNOPSIS
    Initialize the SCUM database module and all sub-modules
    .PARAMETER Config
    Configuration object
    .PARAMETER DatabasePath
    Path to SCUM.db file (optional, auto-detected if not provided)
    #>
    param(
        [Parameter(Mandatory)]
        [object]$Config,
        
        [Parameter()]
        [string]$DatabasePath
    )
    
    try {
        $script:DatabaseConfig = $Config
        
        # Auto-detect database path if not provided
        if (-not $DatabasePath) {
            $serverDir = Get-SafeConfigValue $Config "serverDir" "./server"
            $script:DatabasePath = Join-Path $serverDir "SCUM\Saved\SaveFiles\SCUM.db"
        } else {
            $script:DatabasePath = $DatabasePath
        }
        
        # Verify database exists
        if (-not (Test-PathExists $script:DatabasePath)) {
            throw "SCUM database not found at: $script:DatabasePath"
        }
        
        # Test SQLite availability (only external sqlite3.exe)
        $sqliteTest = Test-SQLiteAvailability
        if (-not $sqliteTest.Available) {
            Write-Log "[Database] External SQLite not available: $($sqliteTest.Error)" -Level Error
            return @{ Success = $false; Error = $sqliteTest.Error }
        }
        
        # Store SQLite information
        $script:SqliteExePath = $sqliteTest.Path
        
        Write-Log "[Database] Using external SQLite: $($script:SqliteExePath)" -Level Info
        Write-Log "[Database] SQLite version: $($sqliteTest.Version)" -Level Info
        
        # Test database connection
        $connectionTest = Test-DatabaseConnection
        if (-not $connectionTest.Success) {
            throw "Failed to connect to database: $($connectionTest.Error)"
        }
        
        # Initialize sub-modules
        $initResults = Initialize-SubModules
        
        Write-Log "[Database] Main module initialized successfully"
        Write-Log "[Database] Database path: $script:DatabasePath"
        # MEMORY LEAK FIX: Only get database size if logging is verbose to avoid frequent Get-Item calls
        if ($VerbosePreference -eq "Continue") {
            Write-Log "[Database] Database size: $([math]::Round((Get-Item $script:DatabasePath).Length / 1MB, 2)) MB"
        }
        Write-Log "[Database] Sub-modules loaded: $($initResults.LoadedModules -join ', ')"
        
        return @{ 
            Success = $true
            LoadedModules = $initResults.LoadedModules
            FailedModules = $initResults.FailedModules
        }
        
    } catch {
        Write-Log "[Database] Failed to initialize: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

function Initialize-SubModules {
    <#
    .SYNOPSIS
    Initialize all available sub-modules
    .RETURNS
    Hashtable with loaded and failed modules
    #>
    
    $loadedModules = @()
    $failedModules = @()
    
    foreach ($moduleName in $script:SubModules.Keys) {
        $modulePath = $script:SubModules[$moduleName]
        
        try {
            if (Test-Path $modulePath) {
                # MEMORY LEAK FIX: Check if sub-module already loaded before importing
                $subModuleName = "scum-database-$moduleName"
                if (-not (Get-Module $subModuleName -ErrorAction SilentlyContinue)) {
                    Import-Module $modulePath -Global
                }
                
                # Initialize the sub-module
                $initFunctionName = "Initialize-${moduleName}Module"
                if (Get-Command $initFunctionName -ErrorAction SilentlyContinue) {
                    $initResult = & $initFunctionName -DatabasePath $script:DatabasePath -SqliteExePath $script:SqliteExePath
                    
                    if ($initResult.Success) {
                        # MEMORY LEAK FIX: Use ArrayList instead of array +=
                        if (-not $loadedModules) {
                            $loadedModules = New-Object System.Collections.ArrayList
                        }
                        $null = $loadedModules.Add($moduleName)
                        Write-Log "[Database] Sub-module '$moduleName' loaded successfully"
                    } else {
                        # MEMORY LEAK FIX: Use ArrayList instead of array +=
                        if (-not $failedModules) {
                            $failedModules = New-Object System.Collections.ArrayList
                        }
                        $null = $failedModules.Add(@{ Module = $moduleName; Error = $initResult.Error })
                        Write-Log "[Database] Sub-module '$moduleName' failed to initialize: $($initResult.Error)" -Level Warning
                    }
                } else {
                    # MEMORY LEAK FIX: Use ArrayList instead of array +=
                    if (-not $loadedModules) {
                        $loadedModules = New-Object System.Collections.ArrayList
                    }
                    $null = $loadedModules.Add($moduleName)
                    Write-Log "[Database] Sub-module '$moduleName' imported (no init function)"
                }
            } else {
                Write-Log "[Database] Sub-module '$moduleName' not found at: $modulePath" -Level Info
            }
        } catch {
            # MEMORY LEAK FIX: Use ArrayList instead of array +=
            if (-not $failedModules) {
                $failedModules = New-Object System.Collections.ArrayList
            }
            $null = $failedModules.Add(@{ Module = $moduleName; Error = $_.Exception.Message })
            Write-Log "[Database] Failed to load sub-module '$moduleName': $($_.Exception.Message)" -Level Warning
        }
    }
    
    return @{
        LoadedModules = $loadedModules
        FailedModules = $failedModules
    }
}

function Test-SQLiteAvailability {
    <#
    .SYNOPSIS
    Test if external sqlite3.exe is available (no .NET fallback)
    .RETURNS
    Hashtable with availability status
    #>
    
    # Always use sqlite3.exe from sqlite-tools directory - no fallbacks
    $rootPath = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    $sqliteExePath = Join-Path $rootPath "sqlite-tools\sqlite3.exe"
    
    if (Test-Path $sqliteExePath) {
        try {
            # Test if sqlite3.exe works
            $testResult = & $sqliteExePath "-version" 2>$null
            if ($LASTEXITCODE -eq 0) {
                Write-Verbose "[Database] Using external SQLite: $sqliteExePath"
                return @{ 
                    Available = $true 
                    Provider = "External" 
                    Path = $sqliteExePath
                    Version = $testResult.Trim()
                }
            } else {
                return @{ 
                    Available = $false 
                    Error = "sqlite3.exe found but failed to execute (exit code: $LASTEXITCODE)"
                }
            }
        } catch {
            return @{ 
                Available = $false 
                Error = "sqlite3.exe found but failed to execute: $($_.Exception.Message)"
            }
        }
    } else {
        return @{ 
            Available = $false 
            Error = "sqlite3.exe not found at expected location: $sqliteExePath"
        }
    }
}

function Test-DatabaseConnection {
    <#
    .SYNOPSIS
    Test connection to SCUM database using external sqlite3.exe only
    .RETURNS
    Hashtable with connection test results
    #>
    
    try {
        if (-not $script:SqliteExePath -or -not (Test-Path $script:SqliteExePath)) {
            return @{ Success = $false; Error = "External SQLite executable not found" }
        }
        
        # Test external SQLite with a simple query directly (avoid recursion)
        $testResult = Invoke-ExternalSQLiteQuery -Query "SELECT name FROM sqlite_master WHERE type='table' LIMIT 1"
        
        if ($testResult.Success) {
            $script:LastConnectionTest = Get-Date
            $testTable = if ($testResult.Data.Count -gt 0) { $testResult.Data[0].name } else { "No tables" }
            return @{ Success = $true; TestTable = $testTable; Provider = "External" }
        } else {
            return @{ Success = $false; Error = $testResult.Error }
        }
        
    } catch {
        Write-Log "[Database] Connection test failed: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

function Test-DatabaseConcurrentAccess {
    <#
    .SYNOPSIS
    Test if database is accessible without blocking SCUM server
    .RETURNS
    Hashtable with test results and recommendations
    #>
    
    try {
        Write-Log "[Database] Testing concurrent access safety..." -Level Info
        
        # MEMORY LEAK FIX: Use ArrayList for recommendations instead of array +=
        $recommendationsList = [System.Collections.ArrayList]::new()
        
        $testResults = @{
            Success = $true
            ReadOnlyMode = $true
            LockTimeout = $true
            Recommendations = $recommendationsList
        }
        
        # Test 1: Quick read access
        $startTime = Get-Date
        $quickTest = Invoke-ExternalSQLiteQuery -Query "SELECT COUNT(*) as count FROM sqlite_master" -TimeoutSeconds 5
        $readTime = (Get-Date) - $startTime
        
        if (-not $quickTest.Success) {
            $testResults.Success = $false
            if ($quickTest.Error -match "locked|busy") {
                [void]$recommendationsList.Add("Database is currently locked - SCUM server is actively writing")
                [void]$recommendationsList.Add("Consider implementing retry logic with exponential backoff")
            }
        }
        
        # Test 2: Check if WAL mode is enabled (better for concurrent access)
        $walTest = Invoke-ExternalSQLiteQuery -Query "PRAGMA journal_mode" -TimeoutSeconds 5
        if ($walTest.Success -and $walTest.Data.Count -gt 0) {
            $journalMode = $walTest.Data[0].journal_mode
            if ($journalMode -ne "wal") {
                [void]$recommendationsList.Add("Database is not in WAL mode (current: $journalMode)")
                [void]$recommendationsList.Add("WAL mode provides better concurrent read access")
                [void]$recommendationsList.Add("However, changing this requires SCUM server restart")
            }
        }
        
        # Test 3: Performance impact assessment
        if ($readTime.TotalMilliseconds -gt 1000) {
            [void]$recommendationsList.Add("Database read took $([math]::Round($readTime.TotalMilliseconds, 0))ms")
            [void]$recommendationsList.Add("Consider implementing caching to reduce database access frequency")
        }
        
        $testResults.ReadTime = $readTime.TotalMilliseconds
        $testResults.JournalMode = if ($walTest.Success) { $walTest.Data[0].journal_mode } else { "Unknown" }
        
        return $testResults
        
    } catch {
        Write-Log "[Database] Concurrent access test failed: $($_.Exception.Message)" -Level Error
        return @{ 
            Success = $false 
            Error = $_.Exception.Message
            Recommendations = @(
                "Database access test failed - this may indicate locking issues",
                "Ensure SCUM server is not under heavy load when running queries",
                "Consider implementing retry logic for failed queries"
            )
        }
    }
}

# ===============================================================
# MAIN DATABASE QUERY FUNCTIONS
# ===============================================================

function Invoke-DatabaseQuery {
    <#
    .SYNOPSIS
    Execute a read-only query against the SCUM database using external sqlite3.exe only
    .PARAMETER Query
    SQL query to execute
    .RETURNS
    Query results or error information
    #>
    param(
        [Parameter(Mandatory)]
        [string]$Query
    )
    
    try {
        # Check if database module is properly initialized
        if (-not $script:DatabasePath -or [string]::IsNullOrEmpty($script:DatabasePath)) {
            throw "Database module not initialized - DatabasePath is empty"
        }
        
        # Check if database is available
        if (-not (Test-PathExists $script:DatabasePath)) {
            throw "Database file not found at: $script:DatabasePath"
        }
        
        # Check if external SQLite is available
        if (-not $script:SqliteExePath -or -not (Test-Path $script:SqliteExePath)) {
            throw "External SQLite executable not found at: $script:SqliteExePath"
        }
        
        # Execute query using external SQLite directly
        return Invoke-ExternalSQLiteQuery -Query $Query
        
    } catch {
        $errorMsg = "Query failed: $($_.Exception.Message)"
        Write-Verbose "[Database] Query Error: $errorMsg"
        return @{ Success = $false; Error = $errorMsg }
    }
}

function Invoke-ExternalSQLiteQuery {
    <#
    .SYNOPSIS
    Execute SQLite query using external sqlite3.exe with enhanced safety measures for concurrent access
    .PARAMETER Query
    SQL query to execute
    .PARAMETER TimeoutSeconds
    Timeout for query execution (default: 10 seconds)
    .RETURNS
    Query results or error information
    #>
    param(
        [Parameter(Mandatory)]
        [string]$Query,
        
        [Parameter()]
        [int]$TimeoutSeconds = 10
    )   
    
    $maxRetries = 3
    $retryDelay = 200  # milliseconds
    
    for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
        try {
            if (-not $script:SqliteExePath -or -not (Test-Path $script:SqliteExePath)) {
                throw "External SQLite executable not found"
            }
            
            # Safety check - ensure we're only doing READ operations
            $queryUpper = $Query.ToUpper().Trim()
            if ($queryUpper -match '^(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|REPLACE|PRAGMA\s+(journal_mode|synchronous)\s*=)') {
                throw "Write operations and critical PRAGMA changes not allowed. This module is read-only for safety."
            }
            
            # Execute sqlite3.exe with enhanced safety parameters for concurrent access
            $arguments = @(
                $script:DatabasePath
                "-separator"
                "`t"
                "-header"
                "-readonly"              # Force read-only mode for safety
                "-cmd"
                ".timeout 1000"          # 1 second timeout for locks (reduced from 5s)
                "-cmd"
                "PRAGMA query_only = ON;" # Additional safety - SQLite 3.8+
                $Query
            )
            
            $processInfo = New-Object System.Diagnostics.ProcessStartInfo
            $processInfo.FileName = $script:SqliteExePath
            $processInfo.Arguments = ($arguments | ForEach-Object { if ($_ -match '\s') { "`"$_`"" } else { $_ } }) -join ' '
            $processInfo.UseShellExecute = $false
            $processInfo.RedirectStandardOutput = $true
            $processInfo.RedirectStandardError = $true
            $processInfo.CreateNoWindow = $true
            
            $startTime = Get-Date
            Write-Log "[Database] Executing READ-ONLY query (attempt ${attempt}/${maxRetries}): $($Query.Substring(0, [Math]::Min(50, $Query.Length)))..." -Level "Debug"
            
            $process = New-Object System.Diagnostics.Process
            $process.StartInfo = $processInfo
            
            try {
                $process.Start() | Out-Null

                # Wait for process completion with timeout
                $completed = $process.WaitForExit($TimeoutSeconds * 1000)
                $executionTime = (Get-Date) - $startTime

                if (-not $completed) {
                    try { $process.Kill() } catch { }
                    throw "Query timed out after $TimeoutSeconds seconds. Database may be locked by SCUM server."
                }

                $stdout = $process.StandardOutput.ReadToEnd()
                $stderr = $process.StandardError.ReadToEnd()
                $exitCode = $process.ExitCode
            } finally {
                # Dispose of process object to prevent memory leak
                if ($process) {
                    $process.Dispose()
                }
            }
            
            if ($exitCode -ne 0) {
                # Check for specific SQLite errors related to locking
                if ($stderr -match "database is locked|locked|busy|SQLITE_BUSY") {
                    if ($attempt -lt $maxRetries) {
                        $delayMs = $retryDelay * [Math]::Pow(2, $attempt - 1) # Exponential backoff
                        Write-Log "[Database] Database locked (attempt ${attempt}/${maxRetries}), retrying in ${delayMs}ms..." -Level "Debug"
                        Start-Sleep -Milliseconds $delayMs
                        continue  # Retry
                    } else {
                        throw "Database is persistently locked by SCUM server after $maxRetries attempts. SCUM server may be under heavy load."
                    }
                } else {
                    throw "SQLite error: $stderr"
                }
            }
            
            # Log performance warning if query took too long
            if ($executionTime.TotalMilliseconds -gt 500) {
                Write-Log "[Database] Query took $([math]::Round($executionTime.TotalMilliseconds, 0))ms - consider caching results" -Level Warning
            }
            
            # Parse tab-separated output from stdout
            if ([string]::IsNullOrWhiteSpace($stdout)) {
                return @{ Success = $true; Data = @(); Count = 0 }
            }
            
            # Parse tab-separated output
            $results = @()
            $lines = $stdout -split "`r?`n" | Where-Object { $_ -and $_.Trim() }
            
            if ($lines.Count -gt 1) {
                $headers = $lines[0] -split "`t"
                
                for ($i = 1; $i -lt $lines.Count; $i++) {
                    $values = $lines[$i] -split "`t"
                    $row = @{}
                    
                    for ($j = 0; $j -lt [Math]::Min($headers.Count, $values.Count); $j++) {
                        $columnName = $headers[$j].Trim('"')
                        $columnValue = $values[$j].Trim('"')
                        
                        # Special handling for SteamID - always keep as string to avoid Int32 overflow
                        if ($columnName -eq "SteamID" -or $columnName -eq "user_id") {
                            $row[$columnName] = $columnValue
                        }
                        # Try to convert other numeric values (but safely)
                        elseif ($columnValue -match '^\d+$') {
                            # For large numbers that might overflow Int32, use Int64
                            try {
                                if ([long]$columnValue -gt [int]::MaxValue) {
                                    $row[$columnName] = [long]$columnValue
                                } else {
                                    $row[$columnName] = [int]$columnValue
                                }
                            } catch {
                                # If conversion fails, keep as string
                                $row[$columnName] = $columnValue
                            }
                        } elseif ($columnValue -match '^\d+\.\d+$') {
                            $row[$columnName] = [double]$columnValue
                        } else {
                            $row[$columnName] = $columnValue
                        }
                    }
                    
                    # MEMORY LEAK FIX: Use ArrayList instead of array +=
                    if (-not $results) {
                        $results = New-Object System.Collections.ArrayList
                    }
                    $null = $results.Add($row)
                }
            } elseif ($lines.Count -eq 1) {
                # Only headers, no data
                return @{ Success = $true; Data = @(); Count = 0 }
            }
            
            Write-Log "[Database] Query completed successfully in $([math]::Round($executionTime.TotalMilliseconds, 0))ms, returned $($results.Count) rows" -Level "Debug"
            return @{ Success = $true; Data = $results; Count = $results.Count }
            
        } catch {
            if ($attempt -lt $maxRetries -and $_.Exception.Message -match "locked|busy") {
                $delayMs = $retryDelay * [Math]::Pow(2, $attempt - 1)
                Write-Log "[Database] Error on attempt ${attempt}: $($_.Exception.Message). Retrying in ${delayMs}ms..." -Level "Debug"
                Start-Sleep -Milliseconds $delayMs
                continue  # Retry
            }
            
            Write-Log "[Database] External SQLite query failed after ${attempt} attempts: $($_.Exception.Message)" -Level Error
            return @{ Success = $false; Error = $_.Exception.Message }
        }
    }
    
    # If we get here, all retries failed
    return @{ Success = $false; Error = "All $maxRetries attempts failed" }
}

# ===============================================================
# UTILITY FUNCTIONS
# ===============================================================

function Get-DatabaseTables {
    <#
    .SYNOPSIS
    Get list of tables in the SCUM database
    .RETURNS
    Array of table names
    #>
    
    try {
        $result = Invoke-DatabaseQuery -Query "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        
        if ($result.Success) {
            $tableNames = $result.Data | ForEach-Object { $_.name }
            Write-Log "[Database] Found $($tableNames.Count) tables in database"
            return @{ Success = $true; Tables = $tableNames }
        } else {
            return $result
        }
        
    } catch {
        Write-Log "[Database] Failed to get table list: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

function Get-ServerStatistics {
    <#
    .SYNOPSIS
    Get basic server statistics from database
    .RETURNS
    Hashtable with server statistics
    #>
    
    try {
        # Check if database module is initialized
        if (-not $script:DatabasePath -or [string]::IsNullOrEmpty($script:DatabasePath)) {
            Write-Verbose "[Database] Module not initialized - cannot get server statistics"
            return @{ Success = $false; Error = "Database module not initialized" }
        }
        
        $stats = @{
            Timestamp = Get-Date
            DatabaseSize = 0
            TotalPlayers = 0
            OnlinePlayers = 0
            LastUpdate = $null
        }
        
        # Get database file size - MEMORY LEAK FIX: Cache this expensive operation
        if (Test-PathExists $script:DatabasePath) {
            # Only check file size every 60 seconds to avoid excessive Get-Item calls
            $now = Get-Date
            if (-not $script:LastSizeCheck -or ($now - $script:LastSizeCheck).TotalSeconds -ge 60) {
                $script:LastSizeCheck = $now
                $script:CachedSize = [math]::Round((Get-Item $script:DatabasePath).Length / 1MB, 2)
                $script:CachedLastWrite = (Get-Item $script:DatabasePath).LastWriteTime
            }
            $stats.DatabaseSize = $script:CachedSize
            $stats.LastUpdate = $script:CachedLastWrite
        }
        
        # Get player counts from prisoner module if available
        if (Get-Command "Get-TotalPlayerCount" -ErrorAction SilentlyContinue) {
            $stats.TotalPlayers = Get-TotalPlayerCount
        }
        
        if (Get-Command "Get-OnlinePlayerCount" -ErrorAction SilentlyContinue) {
            $stats.OnlinePlayers = Get-OnlinePlayerCount
        }
        
        Write-Verbose "[Database] Server statistics compiled"
        return @{ Success = $true; Statistics = $stats }
        
    } catch {
        Write-Log "[Database] Failed to get server statistics: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

function Clear-DatabaseCache {
    <#
    .SYNOPSIS
    Clear all cached database data from all modules
    #>
    
    # Clear main module cache if any
    
    # Clear sub-module caches
    if (Get-Command "Clear-PlayerCache" -ErrorAction SilentlyContinue) {
        Clear-PlayerCache
    }
    
    Write-Log "[Database] All caches cleared"
}

# ===============================================================
# EXPORT FUNCTIONS
# ===============================================================

Export-ModuleMember -Function @(
    'Initialize-DatabaseModule',
    'Invoke-DatabaseQuery',
    'Get-DatabaseTables',
    'Get-ServerStatistics',
    'Clear-DatabaseCache'
)
