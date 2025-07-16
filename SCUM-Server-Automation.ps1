# ===============================================================
# SCUM Server Automation System
# ===============================================================
# Complete server management automation for SCUM Dedicated Server
# Provides monitoring, backup, updates, Discord integration, and scheduling
# ===============================================================

param(
    [string]$ConfigPath = "SCUM-Server-Automation.config.json"
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "=== SCUM Server Automation - Starting ===" -ForegroundColor Green
Write-Host "Loading complete system with all modules..." -ForegroundColor Cyan

# ===============================================================
# CLEANUP HANDLER
# ===============================================================
$CleanupHandler = {
    Write-Host "`nShutting down gracefully..." -ForegroundColor Yellow
    
    # Send shutdown notification
    if (Get-Command "Send-DiscordNotification" -ErrorAction SilentlyContinue) {
        try {
            $null = Send-DiscordNotification -Type "manager.stopped" -Data @{}
        } catch { }
    }
    
    # Stop chat manager
    if (Get-Command "Stop-ChatManager" -ErrorAction SilentlyContinue) {
        try {
            Stop-ChatManager
        } catch { }
    }
    
    # Stop Discord bot
    if (Get-Command "Stop-DiscordBotConnection" -ErrorAction SilentlyContinue) {
        try {
            Stop-DiscordBotConnection
        } catch { }
    }
    
    exit 0
}

# Register cleanup handlers
try {
    [Console]::CancelKeyPress += $CleanupHandler
} catch {
    Write-Host "Note: Ctrl+C handler not available in this PowerShell version" -ForegroundColor Yellow
}
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action $CleanupHandler

# ===============================================================
# CONFIGURATION LOADING
# ===============================================================
Write-Host "`nLoading configuration..." -ForegroundColor Yellow

if (-not (Test-Path $ConfigPath)) {
    Write-Error "Configuration file not found: $ConfigPath"
    Read-Host "Press Enter to exit"
    exit 1
}

try {
    $config = Get-Content $ConfigPath | ConvertFrom-Json
    Write-Host "Configuration loaded: $ConfigPath" -ForegroundColor Green
    
    # Keep original config for array parsing (before hashtable conversion)
    $originalConfig = $config
} catch {
    Write-Error "Failed to load configuration: $($_.Exception.Message)"
    Read-Host "Press Enter to exit"
    exit 1
}

# Convert PSCustomObject to hashtable recursively
function ConvertTo-Hashtable {
    param([Parameter(ValueFromPipeline)]$InputObject)
    
    if ($InputObject -is [PSCustomObject]) {
        $hash = @{}
        $InputObject.PSObject.Properties | ForEach-Object {
            $hash[$_.Name] = ConvertTo-Hashtable $_.Value
        }
        return $hash
    } elseif ($InputObject -is [Array]) {
        # Convert array elements but keep as array structure
        $result = @()
        foreach ($item in $InputObject) {
            $result += ConvertTo-Hashtable $item
        }
        return $result
    } else {
        # Don't convert basic types like strings, numbers, booleans
        return $InputObject
    }
}

$configHash = ConvertTo-Hashtable $config
Set-Variable -Name "config" -Value $configHash -Scope Global
Set-Variable -Name "originalConfig" -Value $originalConfig -Scope Global

# Get basic configuration
$serviceName = if ($configHash.serviceName) { $configHash.serviceName } else { "SCUMSERVER" }
$savedDir = $configHash.savedDir
$backupRoot = $configHash.backupRoot
$steamCmd = $configHash.steamCmd
$serverDir = $configHash.serverDir

Write-Host "Service: $serviceName" -ForegroundColor Cyan

# ===============================================================
# MODULE LOADING
# ===============================================================
Write-Host "`nLoading system modules..." -ForegroundColor Yellow

$modules = @(
    "core\common\common.psm1",
    "core\logging\parser\parser.psm1",
    "server\service\service.psm1",
    "server\monitoring\monitoring.psm1",
    "server\installation\installation.psm1",
    "communication\discord\core\discord-api.psm1",
    "communication\discord\commands\discord-text-commands.psm1",
    "communication\discord\commands\discord-admin-commands.psm1",
    "communication\discord\commands\discord-player-commands.psm1",
    "communication\discord\commands\discord-scheduled-tasks.psm1",
    "communication\discord\notifications\notification-manager.psm1",
    "communication\discord\chat\chat-manager.psm1",
    "automation\backup\backup.psm1",
    "automation\update\update.psm1",
    "automation\scheduling\scheduling.psm1",
    "database\scum-database.psm1",
    "communication\discord\live-embeds\leaderboards-embed.psm1",
    "communication\discord\discord-integration.psm1"
)

$loadedModules = @()
$modulesPath = ".\modules"

foreach ($module in $modules) {
    $modulePath = Join-Path $modulesPath $module
    if (Test-Path $modulePath) {
        try {
            Import-Module $modulePath -Force -Global -WarningAction SilentlyContinue -ErrorAction Stop
            $moduleName = (Split-Path $module -Leaf) -replace '\.psm1$', ''
            Write-Host "  [OK] $moduleName" -ForegroundColor Green
            $loadedModules += $moduleName
        } catch {
            Write-Host "  [ERROR] $module - $($_.Exception.Message)" -ForegroundColor Red
        }
    } else {
        Write-Host "  [WARN] $module - Not found" -ForegroundColor Yellow
    }
}

Write-Host "Loaded $($loadedModules.Count) modules successfully" -ForegroundColor Green

# ===============================================================
# SYSTEM INITIALIZATION
# ===============================================================
Write-Host "`nInitializing system components..." -ForegroundColor Yellow

# Initialize common module (logging, paths) - MUST BE FIRST
if (Get-Command "Initialize-CommonModule" -ErrorAction SilentlyContinue) {
    try {
        $logPath = "SCUM-Server-Automation.log"
        Initialize-CommonModule -Config $configHash -LogPath $logPath -RootPath $PSScriptRoot
        Write-Host "[OK] Common module (logging, paths)" -ForegroundColor Green
    } catch {
        Write-Host "[WARN] Common module failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# ===============================================================
# PHASE 1: SERVER INSTALLATION & SETUP
# ===============================================================
Write-Host "`nPhase 1: Server Installation & Setup..." -ForegroundColor Cyan

# Initialize installation system FIRST
if (Get-Command "Initialize-InstallationModule" -ErrorAction SilentlyContinue) {
    try {
        Initialize-InstallationModule -Config $configHash
        Write-Host "[OK] Installation system initialized" -ForegroundColor Green
        
        # Check if server is installed
        $serverDir = if ($configHash.serverDir) { $configHash.serverDir } else { ".\server" }
        $steamCmdPath = if ($configHash.steamCmd) { $configHash.steamCmd } else { ".\steamcmd\steamcmd.exe" }
        $appId = if ($configHash.appId) { $configHash.appId } else { "3792580" }
        
        # Check if SteamCMD exists
        if (-not (Test-Path $steamCmdPath)) {
            Write-Host "[INSTALL] SteamCMD not found, installing..." -ForegroundColor Yellow
            try {
                if (Get-Command "Install-SteamCmd" -ErrorAction SilentlyContinue) {
                    $steamResult = Install-SteamCmd -SteamCmdPath $steamCmdPath
                    if ($steamResult.Success) {
                        Write-Host "[OK] SteamCMD installed successfully" -ForegroundColor Green
                    } else {
                        Write-Host "[ERROR] SteamCMD installation failed: $($steamResult.Error)" -ForegroundColor Red
                    }
                } else {
                    Write-Host "[ERROR] Install-SteamCmd function not available" -ForegroundColor Red
                }
            } catch {
                Write-Host "[ERROR] SteamCMD installation failed: $($_.Exception.Message)" -ForegroundColor Red
            }
        } else {
            Write-Host "[OK] SteamCMD found" -ForegroundColor Green
        }
        
        # Check and install SQLite tools
        $sqliteToolsPath = ".\sqlite-tools"
        $sqliteExe = Join-Path $sqliteToolsPath "sqlite3.exe"
        if (-not (Test-Path $sqliteExe)) {
            Write-Host "[INSTALL] SQLite tools not found, installing..." -ForegroundColor Yellow
            try {
                if (Get-Command "Install-SqliteTools" -ErrorAction SilentlyContinue) {
                    $sqliteResult = Install-SqliteTools -SqliteToolsPath $sqliteToolsPath
                    if ($sqliteResult.Success) {
                        Write-Host "[OK] SQLite tools installed successfully" -ForegroundColor Green
                    } else {
                        Write-Host "[ERROR] SQLite tools installation failed: $($sqliteResult.Error)" -ForegroundColor Red
                    }
                } else {
                    Write-Host "[ERROR] Install-SqliteTools function not available" -ForegroundColor Red
                }
            } catch {
                Write-Host "[ERROR] SQLite tools installation failed: $($_.Exception.Message)" -ForegroundColor Red
            }
        } else {
            Write-Host "[OK] SQLite tools found" -ForegroundColor Green
        }
        
        # Check if server is installed
        if (Get-Command "Test-FirstInstall" -ErrorAction SilentlyContinue) {
            $needsInstall = Test-FirstInstall -ServerDirectory $serverDir -AppId $appId
            if ($needsInstall) {
                Write-Host "[INSTALL] Server not found, installing SCUM Dedicated Server..." -ForegroundColor Yellow
                try {
                    if (Get-Command "Invoke-FirstInstall" -ErrorAction SilentlyContinue) {
                        $installResult = Invoke-FirstInstall -SteamCmdPath (Split-Path $steamCmdPath -Parent) -ServerDirectory $serverDir -AppId $appId -ServiceName $serviceName
                        if ($installResult.Success) {
                            Write-Host "[OK] SCUM Server installed successfully" -ForegroundColor Green
                            
                            # Check if restart is required for service configuration
                            if ($installResult.RequireRestart) {
                                Write-Host "" -ForegroundColor White
                                Write-Host "================================================================" -ForegroundColor Yellow
                                Write-Host "                    INSTALLATION COMPLETE" -ForegroundColor Yellow
                                Write-Host "================================================================" -ForegroundColor Yellow
                                Write-Host "The SCUM server has been successfully installed!" -ForegroundColor Green
                                Write-Host "" -ForegroundColor White
                                Write-Host "NEXT STEP:" -ForegroundColor Cyan
                                Write-Host "Please configure the Windows service using NSSM and then" -ForegroundColor White
                                Write-Host "restart this automation script." -ForegroundColor White
                                Write-Host "" -ForegroundColor White
                                Write-Host "Service details for your reference:" -ForegroundColor Gray
                                Write-Host "- Service name: $serviceName" -ForegroundColor Gray
                                Write-Host "- Executable: $(Join-Path $serverDir "SCUM\Binaries\Win64\SCUMServer.exe")" -ForegroundColor Gray
                                Write-Host "" -ForegroundColor White
                                Write-Host "================================================================" -ForegroundColor Yellow
                                Write-Host "Press any key to exit automation script..." -ForegroundColor Cyan
                                $null = Read-Host
                                exit 0
                            }
                        } else {
                            Write-Host "[ERROR] Server installation failed: $($installResult.Error)" -ForegroundColor Red
                        }
                    } else {
                        Write-Host "[ERROR] Invoke-FirstInstall function not available" -ForegroundColor Red
                    }
                } catch {
                    Write-Host "[ERROR] Server installation failed: $($_.Exception.Message)" -ForegroundColor Red
                }
            } else {
                Write-Host "[OK] SCUM Server installation found" -ForegroundColor Green
            }
        }
        
    } catch {
        Write-Host "[WARN] Installation system failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
} else {
    Write-Host "[WARN] Installation module not available" -ForegroundColor Yellow
}

# Initialize update system SECOND
if (Get-Command "Initialize-UpdateModule" -ErrorAction SilentlyContinue) {
    try {
        Initialize-UpdateModule -Config $configHash
        Write-Host "[OK] Update system initialized" -ForegroundColor Green
        
        # Check for updates if configured
        if ($configHash.runUpdateOnStart -eq $true) {
            Write-Host "[UPDATE] Checking for server updates..." -ForegroundColor Yellow
            try {
                if (Get-Command "Test-UpdateAvailable" -ErrorAction SilentlyContinue) {
                    # Resolve paths to absolute paths
                    $steamCmdPath = if ($configHash.steamCmd) { 
                        $rawPath = Split-Path $configHash.steamCmd -Parent
                        [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot $rawPath))
                    } else { 
                        [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "steamcmd"))
                    }
                    $serverDirectory = if ($configHash.serverDir) { 
                        [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot $configHash.serverDir))
                    } else { 
                        [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "server"))
                    }
                    $appId = if ($configHash.appId) { $configHash.appId } else { "3792580" }
                    
                    # Use module scope to avoid name conflicts
                    $updateModule = Get-Module "update"
                    $updateCheck = & $updateModule { 
                        param($steamPath, $serverPath, $appIdValue, $scriptPath)
                        Test-UpdateAvailable -SteamCmdPath $steamPath -ServerDirectory $serverPath -AppId $appIdValue -ScriptRoot $scriptPath
                    } $steamCmdPath $serverDirectory $appId $PSScriptRoot
                    
                    if ($updateCheck.UpdateAvailable) {
                        Write-Host "[UPDATE] Update available (Local: $($updateCheck.InstalledBuild), Latest: $($updateCheck.LatestBuild))" -ForegroundColor Yellow
                        if (Get-Command "Update-GameServer" -ErrorAction SilentlyContinue) {
                            Write-Host "[UPDATE] Installing server update..." -ForegroundColor Yellow
                            $updateResult = & $updateModule { 
                                param($steamPath, $serverPath, $appIdValue, $serviceNameValue)
                                Update-GameServer -SteamCmdPath $steamPath -ServerDirectory $serverPath -AppId $appIdValue -ServiceName $serviceNameValue
                            } $steamCmdPath $serverDirectory $appId $serviceName
                            
                            if ($updateResult.Success) {
                                Write-Host "[OK] Server updated successfully" -ForegroundColor Green
                            } else {
                                Write-Host "[WARN] Server update failed: $($updateResult.Error)" -ForegroundColor Yellow
                            }
                        }
                    } else {
                        Write-Host "[OK] Server is up to date (Build: $($updateCheck.InstalledBuild))" -ForegroundColor Green
                    }
                } else {
                    Write-Host "[WARN] Update check function not available" -ForegroundColor Yellow
                }
            } catch {
                Write-Host "[WARN] Update check failed: $($_.Exception.Message)" -ForegroundColor Yellow
            }
        } else {
            Write-Host "[SKIP] Startup update check disabled" -ForegroundColor Gray
        }
        
    } catch {
        Write-Host "[WARN] Update system failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
} else {
    Write-Host "[WARN] Update module not available" -ForegroundColor Yellow
}

# Initialize backup system THIRD
if (Get-Command "Initialize-BackupModule" -ErrorAction SilentlyContinue) {
    try {
        Initialize-BackupModule -Config $configHash
        Write-Host "[OK] Backup system initialized" -ForegroundColor Green
        
        # Create startup backup if configured
        if ($configHash.runBackupOnStart -eq $true) {
            Write-Host "[BACKUP] Creating startup backup..." -ForegroundColor Yellow
            try {
                if (Get-Command "Invoke-GameBackup" -ErrorAction SilentlyContinue) {
                    $backupParams = @{
                        SourcePath = if ($configHash.savedDir) { $configHash.savedDir } else { ".\server\SCUM\Saved" }
                        BackupRoot = if ($configHash.backupRoot) { $configHash.backupRoot } else { ".\backups" }
                        MaxBackups = if ($configHash.maxBackups) { $configHash.maxBackups } else { 10 }
                        CompressBackups = if ($configHash.compressBackups -ne $null) { $configHash.compressBackups } else { $true }
                    }
                    
                    $backupResult = Invoke-GameBackup @backupParams
                    if ($backupResult) {
                        Write-Host "[OK] Startup backup completed" -ForegroundColor Green
                    } else {
                        Write-Host "[WARN] Startup backup failed" -ForegroundColor Yellow
                    }
                } else {
                    Write-Host "[WARN] Backup function not available" -ForegroundColor Yellow
                }
            } catch {
                Write-Host "[WARN] Startup backup failed: $($_.Exception.Message)" -ForegroundColor Yellow
            }
        } else {
            Write-Host "[SKIP] Startup backup disabled" -ForegroundColor Gray
        }
        
    } catch {
        Write-Host "[WARN] Backup system failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
} else {
    Write-Host "[WARN] Backup module not available" -ForegroundColor Yellow
}

# ===============================================================
# PHASE 2: SERVER MONITORING & COMMUNICATION
# ===============================================================
Write-Host "`nPhase 2: Server Monitoring & Communication..." -ForegroundColor Cyan

# Initialize log parser
if (Get-Command "Initialize-LogReaderModule" -ErrorAction SilentlyContinue) {
    try {
        $logPath = if ($configHash.serverDir) { Join-Path $configHash.serverDir "SCUM\Saved\Logs\SCUM.log" } else { $null }
        $null = Initialize-LogReaderModule -Config $configHash -LogPath $logPath
        Write-Host "[OK] Log parser system" -ForegroundColor Green
    } catch {
        Write-Host "[WARN] Log parser failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
} else {
    Write-Host "[WARN] Log parser module not available" -ForegroundColor Yellow
}

# Initialize database
if (Get-Command "Initialize-DatabaseModule" -ErrorAction SilentlyContinue) {
    try {
        $databasePath = if ($configHash.serverDir) { Join-Path $configHash.serverDir "SCUM\Saved\SaveFiles\SCUM.db" } else { $null }
        $dbResult = Initialize-DatabaseModule -Config $configHash -DatabasePath $databasePath
        if ($dbResult.Success) {
            Write-Host "[OK] Database connection" -ForegroundColor Green
        } else {
            Write-Host "[WARN] Database limited: $($dbResult.Error)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "[WARN] Database failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
} else {
    Write-Host "[WARN] Database module not available" -ForegroundColor Yellow
}

# Initialize monitoring (depends on database being initialized first)
if (Get-Command "Initialize-MonitoringModule" -ErrorAction SilentlyContinue) {
    try {
        $null = Initialize-MonitoringModule -Config $configHash
        Write-Host "[OK] Server monitoring system" -ForegroundColor Green
    } catch {
        Write-Host "[WARN] Monitoring failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
} else {
    Write-Host "[WARN] Monitoring module not available" -ForegroundColor Yellow
}

# Initialize scheduling
if (Get-Command "Initialize-SchedulingModule" -ErrorAction SilentlyContinue) {
    try {
        Initialize-SchedulingModule -Config $configHash
        Write-Host "[OK] Scheduling system" -ForegroundColor Green
    } catch {
        Write-Host "[WARN] Scheduling failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
} else {
    Write-Host "[WARN] Scheduling module not available" -ForegroundColor Yellow
}

# Function to update Discord leaderboards
function Update-ManagerDiscordLeaderboards {
    try {
        # Call the Discord integration leaderboard update function
        if (Get-Command "Update-DiscordLeaderboards" -ErrorAction SilentlyContinue) {
            $result = Update-DiscordLeaderboards -Type "player_stats"
            # Only log completion, not start
        } else {
            Write-Log "Discord leaderboards function not available" -Level "DEBUG"
        }
    } catch {
        Write-Log "Discord leaderboards update failed: $($_.Exception.Message)" -Level "WARN"
    }
}

# Initialize Discord integration
if (Get-Command "Initialize-DiscordIntegration" -ErrorAction SilentlyContinue) {
    try {
        $null = Initialize-DiscordIntegration -Config $configHash
        Write-Host "[OK] Discord integration initialized successfully" -ForegroundColor Green
        
        # Note: Leaderboard updates will start after monitoring begins
        
    } catch {
        Write-Host "[WARN] Discord failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
} else {
    Write-Host "[WARN] Discord integration not available" -ForegroundColor Yellow
}

# Initialize Discord notification manager
if (Get-Command "Initialize-NotificationManager" -ErrorAction SilentlyContinue) {
    try {
        $null = Initialize-NotificationManager -Config $configHash
        Write-Host "[OK] Discord notification manager initialized successfully" -ForegroundColor Green
    } catch {
        Write-Host "[WARN] Discord notification manager failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
} else {
    Write-Host "[WARN] Discord notification manager not available" -ForegroundColor Yellow
}

# Initialize Discord scheduled tasks module
if (Get-Command "Initialize-ScheduledTasksModule" -ErrorAction SilentlyContinue) {
    try {
        Initialize-ScheduledTasksModule -Config $configHash
        Write-Host "[OK] Discord scheduled tasks initialized successfully" -ForegroundColor Green
    } catch {
        Write-Host "[WARN] Discord scheduled tasks failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
} else {
    Write-Host "[WARN] Discord scheduled tasks not available" -ForegroundColor Yellow
}

# Initialize Discord chat relay
if (Get-Command "Initialize-ChatManager" -ErrorAction SilentlyContinue) {
    try {
        $chatManagerResult = Initialize-ChatManager -Config $configHash
        if ($chatManagerResult) {
            Write-Host "[OK] Discord chat manager initialized successfully" -ForegroundColor Green
        } else {
            Write-Host "[INFO] Discord chat manager not enabled or configured" -ForegroundColor Gray
        }
    } catch {
        Write-Host "[WARN] Discord chat manager failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
} else {
    Write-Host "[WARN] Discord chat manager not available" -ForegroundColor Yellow
}

# ===============================================================
# MANAGER STATE
# ===============================================================
$script:State = @{
    ServiceName = $serviceName
    IsRunning = $false
    LastBackup = Get-Date
    LastUpdateCheck = Get-Date
    LastUpdateCompleted = Get-Date
    LastStatusCheck = Get-Date
    LastDiscordUpdate = Get-Date
    UpdateInProgress = $false
    ShouldStop = $false
}

# Initialize scheduling state (will be set up in Update-ScheduleManager)
$script:SchedulingState = $null

# ===============================================================
# LOGGING FUNCTION
# ===============================================================
function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logEntry = "[$timestamp] [$Level] $Message"
    
    $color = switch ($Level.ToUpper()) {
        "ERROR" { "Red" }
        "WARN" { "Yellow" }
        "INFO" { "White" }
        "DEBUG" { "Gray" }
        default { "White" }
    }
    
    # Only show DEBUG messages in verbose mode or if VerbosePreference is set
    $shouldShow = $Level.ToUpper() -ne "DEBUG" -or $VerbosePreference -eq "Continue" -or $PSBoundParameters.ContainsKey('Verbose')
    
    if ($shouldShow) {
        Write-Host $logEntry -ForegroundColor $color
    }
    
    # File logging if available - always log to file regardless of console display
    if (Get-Command "Write-LogFile" -ErrorAction SilentlyContinue) {
        try {
            Write-LogFile -Message $Message -Level $Level
        } catch { }
    }
}

# ===============================================================
# SERVER STATUS FUNCTIONS
# ===============================================================
function Test-ServiceStatus {
    try {
        if (Get-Command "Test-ServiceRunning" -ErrorAction SilentlyContinue) {
            return Test-ServiceRunning $script:State.ServiceName
        } else {
            $service = Get-Service -Name $script:State.ServiceName -ErrorAction SilentlyContinue
            return $service -and $service.Status -eq 'Running'
        }
    } catch {
        return $false
    }
}

function Get-CompleteServerStatus {
    # Use monitoring module if available for accurate data
    if (Get-Command "Get-ServerStatus" -ErrorAction SilentlyContinue) {
        try {
            $monitoringStatus = Get-ServerStatus
            
            # Get additional data from database
            $totalPlayers = "N/A"
            $activeSquads = "N/A"
            
            try {
                # Force re-import database module to ensure functions are available
                $databaseModule = Get-Module "scum-database" -ErrorAction SilentlyContinue
                if ($databaseModule) {
                    $totalPlayersResult = & $databaseModule { Get-TotalPlayerCount }
                    if ($totalPlayersResult -ne $null) {
                        $totalPlayers = $totalPlayersResult.ToString()
                        Write-Verbose "Total players retrieved: $totalPlayers"
                    }
                    
                    $squadResult = & $databaseModule { Get-ActiveSquadCount }
                    if ($squadResult -ne $null) {
                        $activeSquads = $squadResult.ToString()
                        Write-Verbose "Active squads retrieved: $activeSquads"
                    }
                } else {
                    Write-Verbose "Database module not found for stats"
                }
            } catch {
                Write-Verbose "Failed to get database stats: $($_.Exception.Message)"
            }
            
            # Get game time and weather from database
            $gameTime = "N/A"
            $temperature = "N/A"
            
            try {
                # Force re-import database module to ensure functions are available
                $databaseModule = Get-Module "scum-database" -ErrorAction SilentlyContinue
                if ($databaseModule) {
                    $timeData = & $databaseModule { Get-GameTimeData }
                    if ($timeData -and $timeData.Success) {
                        $gameTime = $timeData.FormattedTime
                        Write-Verbose "Game time retrieved: $gameTime"
                    }
                    
                    $weatherData = & $databaseModule { Get-WeatherData }
                    if ($weatherData -and $weatherData.Success) {
                        $temperature = $weatherData.FormattedTemperature
                        Write-Verbose "Temperature retrieved: $temperature"
                    }
                } else {
                    Write-Verbose "Database module not found in session"
                }
            } catch {
                Write-Verbose "Failed to get game time/weather from database: $($_.Exception.Message)"
            }
            
            # Convert monitoring module data to expected format
            $status = @{
                IsRunning = $monitoringStatus.IsRunning
                OnlinePlayers = $monitoringStatus.OnlinePlayers.ToString()
                MaxPlayers = $monitoringStatus.MaxPlayers.ToString()
                Uptime = "N/A"
                CPUUsage = "$($monitoringStatus.Performance.CPU)%"
                MemoryUsage = "$($monitoringStatus.Performance.Memory) MB"
                DiskUsage = "N/A"
                NetworkIn = "N/A"
                NetworkOut = "N/A"
                ServerIP = "N/A"  # Keep as N/A as requested
                GameTime = $gameTime
                Temperature = $temperature
                Performance = if ($monitoringStatus.Performance.FPS -gt 0) { "$($monitoringStatus.Performance.FPS) FPS" } else { "N/A" }
                Version = "N/A"
                LastUpdate = $monitoringStatus.LastUpdate.ToString("yyyy-MM-dd HH:mm:ss")
                # Add database stats for Discord embed
                DatabaseStats = @{
                    TotalPlayers = $totalPlayers
                    ActiveSquads = $activeSquads
                }
            }
            
            # Update script state to match monitoring data
            $script:State.IsRunning = $monitoringStatus.IsRunning
            
            Write-Log "Using monitoring module data: IsRunning=$($status.IsRunning), Players=$($status.OnlinePlayers), Total=$totalPlayers" -Level "DEBUG"
            return $status
            
        } catch {
            Write-Log "Failed to get monitoring status: $($_.Exception.Message)" -Level "DEBUG"
            # Fall back to basic status
        }
    }
    
    # Fallback to basic status check
    $currentServiceStatus = Test-ServiceStatus
    
    $status = @{
        IsRunning = $currentServiceStatus
        OnlinePlayers = "0"
        MaxPlayers = "64"
        Uptime = "N/A"
        CPUUsage = "N/A"
        MemoryUsage = "N/A"
        DiskUsage = "N/A"
        NetworkIn = "N/A"
        NetworkOut = "N/A"
        ServerIP = "N/A"
        GameTime = "N/A"
        Temperature = "N/A"
        Performance = "Good"
        Version = "N/A"
        LastUpdate = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        DatabaseStats = @{
            TotalPlayers = "N/A"
            ActiveSquads = "N/A"
        }
    }
    
    Write-Log "Using fallback status: IsRunning=$($status.IsRunning)" -Level "DEBUG"
    return $status
}

# ===============================================================
# MONITORING FUNCTIONS
# ===============================================================
function Update-ServiceMonitoring {
    # Use monitoring module if available
    if (Get-Command "Update-ServerMonitoring" -ErrorAction SilentlyContinue) {
        try {
            $events = Update-ServerMonitoring
            
            # Process any state change events
            foreach ($event in $events) {
                if ($event.IsStateChange) {
                    Write-Log "Server state changed: $($event.EventType)" -Level "INFO"
                    
                    # Send Discord notification based on event type
                    if (Get-Command "Send-DiscordNotification" -ErrorAction SilentlyContinue) {
                        try {
                            $eventType = switch ($event.EventType) {
                                'ServerOnline' { 'server.online' }
                                'ServerOffline' { 'server.offline' }
                                'ServerStarting' { 'server.starting' }
                                'ServerLoading' { 'server.loading' }
                                default { $null }
                            }
                            
                            if ($eventType) {
                                Write-Log "Sending Discord notification: $eventType" -Level "INFO"
                                $result = Send-DiscordNotification -Type $eventType -Data @{
                                    service_name = $script:ServiceName
                                    timestamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
                                }
                                
                                if ($result.Success) {
                                    Write-Log "Discord notification sent successfully: $eventType" -Level "INFO"
                                } else {
                                    Write-Log "Discord notification failed: $($result.Error)" -Level "WARN"
                                }
                            }
                        } catch {
                            Write-Log "Discord notification error: $($_.Exception.Message)" -Level "WARN"
                        }
                    } else {
                        Write-Log "Discord notification function not available" -Level "WARN"
                    }
                    
                    # IMMEDIATE Discord status update on state change
                    if ((Get-Command "Update-BotActivity" -ErrorAction SilentlyContinue) -and 
                        (Get-Command "Update-DiscordServerStatus" -ErrorAction SilentlyContinue)) {
                        try {
                            # Get server status from monitoring module
                            $currentServerStatus = Get-ServerStatus
                            Write-Log "Updating Discord status immediately due to state change: IsRunning=$($currentServerStatus.IsRunning)" -Level "DEBUG"
                            
                            # Update bot activity
                            Update-BotActivity -ServerStatus $currentServerStatus | Out-Null
                            
                            # Update server status embed  
                            Update-DiscordServerStatus -ServerStatus $currentServerStatus | Out-Null
                            
                            Write-Log "Discord status updated immediately after state change" -Level "DEBUG"
                        } catch {
                            Write-Log "Immediate Discord status update failed: $($_.Exception.Message)" -Level "WARN"
                        }
                    }
                }
            }
            
            # Update internal state from monitoring module
            if (Get-Command "Get-ServerStatus" -ErrorAction SilentlyContinue) {
                $serverStatus = Get-ServerStatus
                $script:State.IsRunning = $serverStatus.IsOnline
                $script:State.LastStatusCheck = Get-Date
                Write-Log "Internal state updated from monitoring: IsRunning=$($serverStatus.IsOnline)" -Level "DEBUG"
            }
            
        } catch {
            Write-Log "Monitoring module update failed: $($_.Exception.Message)" -Level "WARN"
            # Fall back to basic monitoring
            Update-ServiceMonitoringBasic
        }
    } else {
        Write-Log "Monitoring module not available, using basic monitoring" -Level "WARN"
        # Fallback to basic monitoring if module not available
        Update-ServiceMonitoringBasic
    }
    
    # Force update Discord status periodically (every 5 seconds)
    $timeSinceLastUpdate = (Get-Date) - $script:State.LastDiscordUpdate
    if ($timeSinceLastUpdate.TotalSeconds -ge 5) {
        if (Get-Command "Update-DiscordServerStatus" -ErrorAction SilentlyContinue) {
            try {
                # Get server status from monitoring module
                $serverStatus = Get-ServerStatus
                Write-Log "Sending Discord update: IsRunning=$($serverStatus.IsRunning), Players=$($serverStatus.OnlinePlayers)" -Level "DEBUG"
                Update-DiscordServerStatus -ServerStatus $serverStatus
                $script:State.LastDiscordUpdate = Get-Date
                Write-Log "Discord status updated (periodic)" -Level "DEBUG"
            } catch {
                Write-Log "Periodic Discord update failed: $($_.Exception.Message)" -Level "DEBUG"
            }
        }
    }
}

function Update-ServiceMonitoringBasic {
    # Basic fallback monitoring
    $wasRunning = $script:State.IsRunning
    $currentStatus = Test-ServiceStatus
    $script:State.IsRunning = $currentStatus
    $script:State.LastStatusCheck = Get-Date
    
    # Always log current status for debugging
    $statusText = if ($currentStatus) { "RUNNING" } else { "STOPPED" }
    Write-Log "Service status check: $statusText" -Level "DEBUG"
    
    # Detect state changes
    if ($wasRunning -ne $script:State.IsRunning) {
        $status = if ($script:State.IsRunning) { "RUNNING" } else { "STOPPED" }
        Write-Log "Service status changed: $status"
        
        # Send Discord notification
        if (Get-Command "Send-DiscordNotification" -ErrorAction SilentlyContinue) {
            try {
                $eventType = if ($script:State.IsRunning) { "server.started" } else { "server.stopped" }
                $null = Send-DiscordNotification -Type $eventType -Data @{}
                
                # Update Discord server status immediately on change
                if (Get-Command "Update-DiscordServerStatus" -ErrorAction SilentlyContinue) {
                    $serverStatus = Get-CompleteServerStatus
                    Update-DiscordServerStatus -ServerStatus $serverStatus
                }
            } catch {
                Write-Log "Discord notification failed: $($_.Exception.Message)" -Level "WARN"
            }
        }
    }
}

function Update-BackupManager {
    if (-not ($configHash.periodicBackupEnabled -eq $true)) {
        return
    }
    
    $backupInterval = if ($configHash.backupIntervalMinutes) { $configHash.backupIntervalMinutes } else { 60 }
    $timeSinceBackup = (Get-Date) - $script:State.LastBackup
    
    if ($timeSinceBackup.TotalMinutes -ge $backupInterval) {
        Invoke-Backup "periodic"
    }
}

function Update-UpdateManager {
    $updateInterval = if ($configHash.updateCheckIntervalMinutes) { $configHash.updateCheckIntervalMinutes } else { 60 }
    $timeSinceCheck = (Get-Date) - $script:State.LastUpdateCheck
    
    if ($timeSinceCheck.TotalMinutes -ge $updateInterval) {
        if (Test-ManagerUpdateAvailable) {
            Write-Log "Server update available!"
            
            if (Get-Command "Send-DiscordNotification" -ErrorAction SilentlyContinue) {
                try {
                    $null = Send-DiscordNotification -Type "update.available" -Data @{}
                } catch { }
            }
        }
        
        $script:State.LastUpdateCheck = Get-Date
    }
}

function Update-ScheduleManager {
    # Initialize scheduling state if not exists
    if (-not $script:SchedulingState) {
        # Use original config object to get restart times properly
        $restartTimes = if ($originalConfig.restartTimes) { 
            # Convert to proper string array
            $timeArray = @()
            foreach ($time in $originalConfig.restartTimes) {
                if ($time -and $time.ToString().Trim() -ne "") {
                    $timeArray += $time.ToString().Trim()
                }
            }
            $timeArray
        } else { 
            @() 
        }
        
        if ($restartTimes.Count -eq 0) {
            Write-Log "No restart times configured, scheduling disabled" -Level "DEBUG"
            return
        }
        
        Write-Log "Raw restart times from config: $($restartTimes -join ', ')" -Level "DEBUG"
        
        # Initialize restart warning system from scheduling module
        if (Get-Command "Initialize-RestartWarningSystem" -ErrorAction SilentlyContinue) {
            try {
                # Use explicit hashtable conversion to prevent array conversion
                $initResult = Initialize-RestartWarningSystem -RestartTimes $restartTimes
                
                # Accept the result regardless of type as long as it has NextRestartTime
                if ($initResult -and $initResult.NextRestartTime) {
                    $script:SchedulingState = $initResult
                    Write-Log "Scheduling system initialized with restart times: $($restartTimes -join ', ')" -Level "INFO"
                } else {
                    Write-Log "Initialize-RestartWarningSystem returned invalid state" -Level "WARN"
                    return
                }
            } catch {
                Write-Log "Failed to initialize scheduling system: $($_.Exception.Message)" -Level "WARN"
                return
            }
        } else {
            Write-Log "Scheduling module functions not available" -Level "WARN"
            return
        }
    }
    
    if (-not $script:SchedulingState) {
        return
    }
    
    # Validate SchedulingState type - if Object[] but has NextRestartTime, keep using it
    $stateType = if ($script:SchedulingState) { $script:SchedulingState.GetType().Name } else { "null" }
    $hasNextRestart = if ($script:SchedulingState -and $script:SchedulingState.NextRestartTime) { $true } else { $false }
    
    Write-Log "SchedulingState validation: Type='$stateType', HasNextRestart=$hasNextRestart" -Level "DEBUG"
    
    # Accept both hashtable and Object[] as long as it has NextRestartTime
    if (-not $script:SchedulingState -or -not $hasNextRestart) {
        Write-Log "SchedulingState invalid (Type: $stateType, HasNextRestart: $hasNextRestart), reinitializing..." -Level "WARN"
        $script:SchedulingState = $null
        # Trigger reinitialization on next call
        Update-ScheduleManager
        return
    }
    
    $now = Get-Date
    
    # Update restart warnings using scheduling module
    if (Get-Command "Update-RestartWarnings" -ErrorAction SilentlyContinue) {
        try {
            # Don't log type before/after - just accept whatever is returned
            $warningResult = Update-RestartWarnings -WarningState $script:SchedulingState -CurrentTime $now
            
            # Accept the result regardless of type as long as it has NextRestartTime
            if ($warningResult -and $warningResult.NextRestartTime) {
                $script:SchedulingState = $warningResult
            } else {
                Write-Log "Update-RestartWarnings returned invalid state" -Level "WARN"
            }
        } catch {
            Write-Log "Failed to update restart warnings: $($_.Exception.Message)" -Level "WARN"
        }
    }
    
    # Check if scheduled restart is due
    if (Get-Command "Test-ScheduledRestartDue" -ErrorAction SilentlyContinue) {
        try {
            $restartDue = Test-ScheduledRestartDue -WarningState $script:SchedulingState -CurrentTime $now
            
            if ($restartDue) {
                Write-Log "Scheduled restart is due at $($script:SchedulingState.NextRestartTime.ToString('HH:mm:ss'))" -Level "INFO"
                
                # Execute scheduled restart using scheduling module
                if (Get-Command "Invoke-ScheduledRestart" -ErrorAction SilentlyContinue) {
                    try {
                        $serviceName = if ($script:State.ServiceName) { $script:State.ServiceName } else { "SCUMSERVER" }
                        
                        $restartResult = Invoke-ScheduledRestart -WarningState $script:SchedulingState -ServiceName $serviceName
                        
                        # Accept the result regardless of type as long as it has NextRestartTime
                        if ($restartResult -and $restartResult.NextRestartTime) {
                            $script:SchedulingState = $restartResult
                            Write-Log "Scheduled restart completed, next restart: $($script:SchedulingState.NextRestartTime.ToString('yyyy-MM-dd HH:mm:ss'))" -Level "INFO"
                        } else {
                            Write-Log "Invoke-ScheduledRestart returned invalid state" -Level "WARN"
                        }
                    } catch {
                        Write-Log "Failed to execute scheduled restart: $($_.Exception.Message)" -Level "ERROR"
                    }
                } else {
                    # Fallback to manual restart execution
                    Write-Log "Scheduling module restart function not available, using fallback" -Level "WARN"
                    
                    if (Get-Command "Send-DiscordNotification" -ErrorAction SilentlyContinue) {
                        try {
                            $null = Send-DiscordNotification -Type "scheduled.restart" -Data @{ time = $now.ToString("HH:mm") }
                        } catch { }
                    }
                    
                    Invoke-Backup "pre-restart"
                    Restart-ServerService
                    
                    # Update next restart time manually
                    $restartTimes = $script:SchedulingState.RestartTimes
                    if (Get-Command "Get-NextScheduledRestart" -ErrorAction SilentlyContinue) {
                        $script:SchedulingState.NextRestartTime = Get-NextScheduledRestart -RestartTimes $restartTimes
                        $script:SchedulingState.RestartPerformedTime = $now
                    }
                }
            }
        } catch {
            Write-Log "Failed to check restart due: $($_.Exception.Message)" -Level "WARN"
        }
    }
}

# ===============================================================
# SERVER MANAGEMENT FUNCTIONS
# ===============================================================
function Start-ServerService {
    try {
        if (Get-Command "Start-GameService" -ErrorAction SilentlyContinue) {
            Start-GameService -ServiceName $script:State.ServiceName -Context "manual"
        } else {
            Start-Service -Name $script:State.ServiceName
        }
        Write-Log "Service start command issued"
    } catch {
        Write-Log "Failed to start service: $($_.Exception.Message)" -Level "ERROR"
    }
}

function Stop-ServerService {
    try {
        if (Get-Command "Stop-GameService" -ErrorAction SilentlyContinue) {
            Stop-GameService -ServiceName $script:State.ServiceName -Reason "manual"
        } else {
            Stop-Service -Name $script:State.ServiceName -Force
        }
        Write-Log "Service stop command issued"
    } catch {
        Write-Log "Failed to stop service: $($_.Exception.Message)" -Level "ERROR"
    }
}

function Restart-ServerService {
    Write-Log "Restarting server service..."
    
    # Use the proper manual restart system that respects preRestartBackupEnabled
    if (Get-Command "Invoke-ManualRestart" -ErrorAction SilentlyContinue) {
        try {
            $serviceName = if ($script:State.ServiceName) { $script:State.ServiceName } else { "SCUMSERVER" }
            Invoke-ManualRestart -ServiceName $serviceName -Config $configHash
            Write-Log "Server restart completed using scheduling system"
        } catch {
            Write-Log "Scheduling system restart failed: $($_.Exception.Message)" -Level "ERROR"
            throw "Restart failed: $($_.Exception.Message)"
        }
    } else {
        Write-Log "Scheduling module not available - restart cannot proceed" -Level "ERROR"
        throw "Restart failed: Scheduling module not available"
    }
}

function Invoke-Backup {
    param([string]$Type = "manual")
    
    Write-Log "Creating backup (type: $Type)"
    
    try {
        if (Get-Command "Invoke-GameBackup" -ErrorAction SilentlyContinue) {
            $backupParams = @{
                SourcePath = if ($savedDir) { $savedDir } else { ".\server\SCUM\Saved" }
                BackupRoot = if ($backupRoot) { $backupRoot } else { ".\backups" }
                MaxBackups = if ($configHash.maxBackups) { $configHash.maxBackups } else { 10 }
                CompressBackups = if ($configHash.compressBackups -ne $null) { $configHash.compressBackups } else { $true }
            }
            
            $backupResult = Invoke-GameBackup @backupParams
            if ($backupResult) {
                $script:State.LastBackup = Get-Date
                Write-Log "Backup completed successfully"
                
                if (Get-Command "Send-DiscordNotification" -ErrorAction SilentlyContinue) {
                    try {
                        $null = Send-DiscordNotification -Type "backup.completed" -Data @{ type = $Type }
                    } catch { }
                }
                return $true
            } else {
                throw "Backup operation failed"
            }
        } else {
            Write-Log "Backup module not available" -Level "WARN"
            return $false
        }
    } catch {
        Write-Log "Backup failed: $($_.Exception.Message)" -Level "ERROR"
        return $false
    }
}

function Update-BackupManager {
    # Check if periodic backups are enabled
    if ($configHash.periodicBackupEnabled -ne $true) {
        return
    }
    
    $backupInterval = if ($configHash.backupIntervalMinutes) { $configHash.backupIntervalMinutes } else { 60 }
    $now = Get-Date
    
    # Check if backup is due
    $timeSinceLastBackup = $now - $script:State.LastBackup
    if ($timeSinceLastBackup.TotalMinutes -ge $backupInterval) {
        Write-Log "Periodic backup is due (interval: $backupInterval minutes)" -Level "INFO"
        
        try {
            $backupResult = Invoke-Backup -Type "periodic"
            if ($backupResult) {
                Write-Log "Periodic backup completed successfully" -Level "INFO"
            } else {
                Write-Log "Periodic backup failed" -Level "WARN"
            }
        } catch {
            Write-Log "Periodic backup error: $($_.Exception.Message)" -Level "WARN"
        }
    }
}

function Update-UpdateManager {
    # Check if update checking is enabled
    $updateCheckInterval = if ($configHash.updateCheckIntervalMinutes) { $configHash.updateCheckIntervalMinutes } else { 10 }
    $now = Get-Date
    
    # Check if update check is due
    $timeSinceLastCheck = $now - $script:State.LastUpdateCheck
    if ($timeSinceLastCheck.TotalMinutes -ge $updateCheckInterval) {
        Write-Log "Update check is due (interval: $updateCheckInterval minutes)" -Level "DEBUG"
        
        try {
            $updateAvailable = Test-ManagerUpdateAvailable
            $script:State.LastUpdateCheck = $now
            
            if ($updateAvailable) {
                Write-Log "Server update available!" -Level "INFO"
                
                # Send update available notification only if we haven't already started an update
                if (-not $script:State.UpdateInProgress) {
                    if (Get-Command "Send-DiscordNotification" -ErrorAction SilentlyContinue) {
                        try {
                            $updateParams = @{
                                SteamCmdPath = if ($steamCmd) { Split-Path $steamCmd -Parent } else { ".\steamcmd" }
                                ServerDirectory = if ($serverDir) { $serverDir } else { ".\server" }
                                AppId = if ($configHash.appId) { $configHash.appId } else { "3792580" }
                                ScriptRoot = $PSScriptRoot
                            }
                            
                            $updateInfo = Test-UpdateAvailable @updateParams
                            
                            $null = Send-DiscordNotification -Type 'update.available' -Data @{
                                currentVersion = $updateInfo.InstalledBuild
                                version = $updateInfo.LatestBuild
                            }
                        } catch {
                            Write-Log "Failed to send update notification: $($_.Exception.Message)" -Level "WARN"
                        }
                    }
                    
                    # Start automatic update process
                    Write-Log "Starting automatic update process" -Level "INFO"
                    $script:State.UpdateInProgress = $true
                    
                    try {
                        $updateParams = @{
                            SteamCmdPath = if ($steamCmd) { $steamCmd } else { ".\steamcmd\steamcmd.exe" }
                            ServerDirectory = if ($serverDir) { $serverDir } else { ".\server" }
                            AppId = if ($configHash.appId) { $configHash.appId } else { "3792580" }
                            ServiceName = if ($script:State.ServiceName) { $script:State.ServiceName } else { "SCUMSERVER" }
                        }
                        
                        $updateResult = Invoke-ImmediateUpdate @updateParams
                        
                        if ($updateResult.Success) {
                            Write-Log "Automatic update completed successfully" -Level "INFO"
                        } else {
                            Write-Log "Automatic update failed: $($updateResult.Error)" -Level "ERROR"
                        }
                        
                    } catch {
                        Write-Log "Automatic update process failed: $($_.Exception.Message)" -Level "ERROR"
                    } finally {
                        $script:State.UpdateInProgress = $false
                    }
                }
            } else {
                Write-Log "Server is up to date" -Level "DEBUG"
            }
            
        } catch {
            Write-Log "Update check failed: $($_.Exception.Message)" -Level "WARN"
            $script:State.LastUpdateCheck = $now  # Still update the check time to avoid spam
        }
    }
}

function Test-ManagerUpdateAvailable {
    try {
        if (Get-Command "Test-UpdateAvailable" -ErrorAction SilentlyContinue) {
            $updateParams = @{
                SteamCmdPath = if ($steamCmd) { Split-Path $steamCmd -Parent } else { ".\steamcmd" }
                ServerDirectory = if ($serverDir) { $serverDir } else { ".\server" }
                AppId = if ($configHash.appId) { $configHash.appId } else { "3792580" }
                ScriptRoot = $PSScriptRoot
            }
            
            $result = Test-UpdateAvailable @updateParams
            return $result.UpdateAvailable
        } else {
            Write-Log "Update module not available" -Level "DEBUG"
            return $false
        }
    } catch {
        Write-Log "Update check failed: $($_.Exception.Message)" -Level "WARN"
        return $false
    }
}

# ===============================================================
# INTERACTIVE COMMANDS
# ===============================================================
function Show-Menu {
    Write-Host "`n=== SCUM Server Automation Commands ===" -ForegroundColor Cyan
    Write-Host "1. Show Status" -ForegroundColor White
    Write-Host "2. Start Server" -ForegroundColor Green
    Write-Host "3. Stop Server" -ForegroundColor Red
    Write-Host "4. Restart Server" -ForegroundColor Yellow
    Write-Host "5. Create Backup" -ForegroundColor Blue
    Write-Host "6. Check for Updates" -ForegroundColor Magenta
    Write-Host "7. Show Player Stats" -ForegroundColor Cyan
    Write-Host "Q. Quit" -ForegroundColor Gray
    Write-Host "=====================================" -ForegroundColor Cyan
}

function Show-Status {
    $serviceStatus = if ($script:State.IsRunning) { "RUNNING" } else { "STOPPED" }
    $serviceColor = if ($script:State.IsRunning) { "Green" } else { "Red" }
    
    Write-Host "`n=== Server Status ===" -ForegroundColor Cyan
    Write-Host "Service: $($script:State.ServiceName)" -ForegroundColor White
    Write-Host "Status: $serviceStatus" -ForegroundColor $serviceColor
    
    if ($script:State.IsRunning) {
        $serverStatus = Get-CompleteServerStatus
        Write-Host "Players: $($serverStatus.OnlinePlayers) / $($serverStatus.MaxPlayers)" -ForegroundColor White
        Write-Host "Uptime: $($serverStatus.Uptime)" -ForegroundColor White
        Write-Host "CPU: $($serverStatus.CPUUsage)" -ForegroundColor White
        Write-Host "Memory: $($serverStatus.MemoryUsage)" -ForegroundColor White
        Write-Host "Performance: $($serverStatus.Performance)" -ForegroundColor White
    }
    
    Write-Host "Last Backup: $($script:State.LastBackup.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor White
    Write-Host "Last Update Check: $($script:State.LastUpdateCheck.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor White
    Write-Host "====================" -ForegroundColor Cyan
}

function Show-PlayerStats {
    if (Get-Command "Get-PlayerLeaderboard" -ErrorAction SilentlyContinue) {
        try {
            Write-Host "`n=== Top Players ===" -ForegroundColor Cyan
            $leaderboard = Get-PlayerLeaderboard -Top 10
            if ($leaderboard) {
                for ($i = 0; $i -lt $leaderboard.Count; $i++) {
                    $player = $leaderboard[$i]
                    Write-Host "$($i + 1). $($player.Name) - Score: $($player.Score)" -ForegroundColor White
                }
            } else {
                Write-Host "No player data available" -ForegroundColor Yellow
            }
            Write-Host "===================" -ForegroundColor Cyan
        } catch {
            Write-Host "Failed to get player stats: $($_.Exception.Message)" -ForegroundColor Red
        }
    } else {
        Write-Host "Player stats not available (database module not loaded)" -ForegroundColor Yellow
    }
}

# ===============================================================
# INITIALIZATION AND STARTUP
# ===============================================================
Write-Log "=== SCUM Server Automation Started ==="

# Check if service exists
try {
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if (-not $service) {
        Write-Log "Windows service '$serviceName' not found!" -Level "WARN"
        Write-Log "You may need to create the service first using nssm.exe" -Level "WARN"
    } else {
        Write-Log "Service '$serviceName' found"
    }
} catch {
    Write-Log "Error checking service: $($_.Exception.Message)" -Level "ERROR"
}

# Initial status check
Update-ServiceMonitoring
Show-Status

# Send startup notification
if (Get-Command "Send-DiscordNotification" -ErrorAction SilentlyContinue) {
    try {
        $result = Send-DiscordNotification -Type "manager.started" -Data @{ version = "2.0" }
        if ($result.Success) {
            Write-Log "Startup notification sent"
        } else {
            Write-Log "Startup notification failed: $($result.Error)" -Level "WARN"
        }
    } catch {
        Write-Log "Startup notification failed: $($_.Exception.Message)" -Level "WARN"
    }
}

# ===============================================================
# MAIN EXECUTION LOOP - AUTOMATIC MODE ONLY
# ===============================================================

# Always start in automatic monitoring mode
Write-Log "Starting automatic monitoring mode..."
Write-Log "Press Ctrl+C to stop"

# Show monitoring configuration
Write-Host "`n=== Monitoring Configuration ===" -ForegroundColor Cyan
Write-Host "[OK] Service Status Monitoring" -ForegroundColor Green

if ($configHash.periodicBackupEnabled -eq $true) {
    $interval = if ($configHash.backupIntervalMinutes) { $configHash.backupIntervalMinutes } else { 60 }
    Write-Host "[OK] Automatic Backups (every $interval minutes)" -ForegroundColor Green
} else {
    Write-Host "[SKIP] Automatic Backups (disabled)" -ForegroundColor Yellow
}

if ($configHash.restartTimes -and $configHash.restartTimes.Count -gt 0) {
    # Get restart times from the original JSON content to avoid hashtable conversion issues
    try {
        $originalConfig = Get-Content $ConfigPath | ConvertFrom-Json
        $restartTimes = @()
        
        if ($originalConfig.restartTimes) {
            foreach ($time in $originalConfig.restartTimes) {
                if ($time -and $time.ToString().Trim() -ne "") {
                    $restartTimes += $time.ToString()
                }
            }
        }
        
        if ($restartTimes.Count -gt 0) {
            $times = $restartTimes -join ", "
            Write-Host "[OK] Scheduled Restarts ($times)" -ForegroundColor Green
        } else {
            Write-Host "[SKIP] Scheduled Restarts (no valid times)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "[SKIP] Scheduled Restarts (configuration error)" -ForegroundColor Yellow
    }
} else {
    Write-Host "[SKIP] Scheduled Restarts (none configured)" -ForegroundColor Yellow
}

Write-Host "[OK] Update Checking" -ForegroundColor Green

$discordStatus = if (Get-Command "Send-DiscordNotification" -ErrorAction SilentlyContinue) { "[OK] Available" } else { "[SKIP] Module not loaded" }
Write-Host "$discordStatus Discord Integration" -ForegroundColor $(if ($discordStatus.StartsWith("[OK]")) { "Green" } else { "Yellow" })

$databaseStatus = if (Get-Command "Get-TotalPlayerCount" -ErrorAction SilentlyContinue) { "[OK] Connected" } else { "[SKIP] Not available" }
Write-Host "$databaseStatus Database Access" -ForegroundColor $(if ($databaseStatus.StartsWith("[OK]")) { "Green" } else { "Yellow" })

Write-Host "=================================" -ForegroundColor Cyan
    Write-Host ""
    
    try {
        $loopCount = 0
        
        # Get monitoring interval from config (default 2 seconds)
        $monitoringInterval = if ($configHash.monitoringIntervalSeconds) { $configHash.monitoringIntervalSeconds } else { 2 }
        
        # Get leaderboard update interval from Discord LiveEmbeds config (in seconds)
        $leaderboardIntervalSeconds = if ($configHash.Discord.LiveEmbeds.LeaderboardUpdateInterval) { 
            $configHash.Discord.LiveEmbeds.LeaderboardUpdateInterval # Already in seconds
        } else { 600 } # Default 10 minutes
        $leaderboardInterval = [math]::Round($leaderboardIntervalSeconds / 60) # Convert to minutes for display
        $leaderboardLoops = [math]::Max(1, [math]::Round($leaderboardIntervalSeconds / $monitoringInterval))
        
        Write-Host "Monitoring interval: $monitoringInterval seconds" -ForegroundColor Gray
        Write-Host "Leaderboard updates: every $leaderboardInterval minutes ($leaderboardLoops loops)" -ForegroundColor Gray
        Write-Host ""
        
        while (-not $script:State.ShouldStop) {
            $loopCount++
            
            # Update all managers
            Update-ServiceMonitoring
            Update-BackupManager
            Update-UpdateManager
            Update-ScheduleManager
            
            # Process scheduled Discord tasks (check for warnings and executions every loop)
            if (Get-Command "Process-ScheduledTasks" -ErrorAction SilentlyContinue) {
                try {
                    Process-ScheduledTasks
                } catch {
                    Write-Log "Scheduled tasks processing failed: $($_.Exception.Message)" -Level "WARN"
                }
            }
            
            # Update chat manager (check for new messages every loop)
            if (Get-Command "Update-ChatManager" -ErrorAction SilentlyContinue) {
                try {
                    Update-ChatManager
                } catch {
                    Write-Log "Chat manager update failed: $($_.Exception.Message)" -Level "WARN"
                }
            }
            
            # Update Discord text commands (check for new command messages every loop)
            if (Get-Command "Update-DiscordTextCommands" -ErrorAction SilentlyContinue) {
                try {
                    Update-DiscordTextCommands
                } catch {
                    Write-Log "Discord text commands update failed: $($_.Exception.Message)" -Level "WARN"
                }
            }
            
            # Perform Discord connection maintenance (every 10 loops to avoid spam)
            if ($loopCount % 10 -eq 0) {
                if (Get-Command "Maintenance-DiscordConnection" -ErrorAction SilentlyContinue) {
                    try {
                        Maintenance-DiscordConnection | Out-Null
                    } catch {
                        Write-Log "Discord connection maintenance failed: $($_.Exception.Message)" -Level "WARN"
                    }
                }
            }
            
            # Update Discord leaderboards based on config interval
            if ($loopCount % $leaderboardLoops -eq 0) {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Updating leaderboards..." -ForegroundColor Cyan
                Update-ManagerDiscordLeaderboards
                
                # Also show server status embed update (happens automatically every 15s, but we show message every 5 min)
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Updating server status embed..." -ForegroundColor Cyan
                
                # Check for weekly leaderboard reset (every 5 minutes)
                if (Get-Command "Test-WeeklyResetNeeded" -ErrorAction SilentlyContinue) {
                    try {
                        if (Test-WeeklyResetNeeded) {
                            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Weekly reset triggered" -ForegroundColor Yellow
                            if (Get-Command "Invoke-WeeklyReset" -ErrorAction SilentlyContinue) {
                                $resetResult = Invoke-WeeklyReset
                                if ($resetResult.Success) {
                                    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Weekly reset completed" -ForegroundColor Green
                                } else {
                                    Write-Log "Weekly leaderboard reset failed: $($resetResult.Error)" -Level "WARN"
                                }
                            }
                        }
                    } catch {
                        Write-Log "Weekly reset check failed: $($_.Exception.Message)" -Level "WARN"
                    }
                }
            }
            
            # Show periodic status based on monitoring interval (every 5 minutes)
            $statusLoops = [math]::Max(1, [math]::Round((5 * 60) / $monitoringInterval))
            if ($loopCount % $statusLoops -eq 0) {
                $status = if ($script:State.IsRunning) { "RUNNING" } else { "STOPPED" }
                $color = if ($script:State.IsRunning) { "Green" } else { "Yellow" }
                $serverStatus = Get-CompleteServerStatus
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Server: $status | Players: $($serverStatus.OnlinePlayers)/$($serverStatus.MaxPlayers) | Last Backup: $($script:State.LastBackup.ToString('HH:mm:ss'))" -ForegroundColor $color
            }
            
            # Sleep for configured monitoring interval
            Start-Sleep -Seconds $monitoringInterval
        }
    } catch {
        Write-Log "Error in monitoring loop: $($_.Exception.Message)" -Level "ERROR"
    }

# Final cleanup
Write-Log "SCUM Server Automation shutting down..."
