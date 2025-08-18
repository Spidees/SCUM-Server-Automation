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

# Initial console output before logging is available
Write-Host "=== SCUM Server Automation - Starting ===" -ForegroundColor Green
Write-Host "Loading complete system with all modules..." -ForegroundColor Cyan

# ===============================================================
# CLEANUP HANDLER
# ===============================================================
$CleanupHandler = {
    Write-Log "Shutting down gracefully..." -Level Warning
    
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
Write-Host "Loading configuration..." -ForegroundColor Yellow

if (-not (Test-Path $ConfigPath)) {
    Write-Host "Configuration file not found: $ConfigPath" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

try {
    $config = Get-Content $ConfigPath | ConvertFrom-Json
    Write-Host "Configuration loaded: $ConfigPath" -ForegroundColor Green
    
    # Keep original config for array parsing (before hashtable conversion)
    $originalConfig = $config
} catch {
    Write-Host "Failed to load configuration: $($_.Exception.Message)" -ForegroundColor Red
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
# GLOBAL LOG PATH SETUP (MUST BE BEFORE MODULE LOADING)
# ===============================================================
# Set global automation log path BEFORE loading any modules
# This prevents parser module from using server log path
$global:AutomationLogPath = Join-Path $PSScriptRoot "SCUM-Server-Automation.log"
Write-Host "Global automation log path: $global:AutomationLogPath" -ForegroundColor Cyan

# ===============================================================
# MODULE LOADING
# ===============================================================
Write-Host "`nLoading system modules..." -ForegroundColor Yellow

$modules = @(
    "core\common\common.psm1",
    "core\database-service.psm1",
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
    "logs\kill-log.psm1",
    "logs\eventkill-log.psm1",
    "logs\admin-log.psm1",
    "logs\violations-log.psm1",
    "logs\famepoints-log.psm1",
    "logs\gameplay-log.psm1",
    "logs\quest-log.psm1",
    "logs\chest-log.psm1",
    "logs\login-log.psm1",
    "logs\economy-log.psm1",
    "logs\vehicle-log.psm1",
    "logs\raidprotection-log.psm1",
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
            $moduleName = (Split-Path $module -Leaf) -replace '\.psm1$', ''
            # MEMORY LEAK FIX: Check if module already loaded before importing
            if (-not (Get-Module $moduleName -ErrorAction SilentlyContinue)) {
                Import-Module $modulePath -Global -WarningAction SilentlyContinue -ErrorAction Stop
            }
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
        $logPath = Join-Path $PSScriptRoot "SCUM-Server-Automation.log"
        
        # Set global log path before initializing any modules
        Set-Variable -Name "AutomationLogPath" -Value $logPath -Scope Global -Force
        
        Initialize-CommonModule -Config $configHash -LogPath $logPath -RootPath $PSScriptRoot
        
        # NOW Write-Log is available - switch from Write-Host to Write-Log
        Write-Log "[OK] Common module (logging, paths) initialized"
        
        # Write-Log is now available globally from common module - no need to override
        
    } catch {
        Write-Host "[WARN] Common module failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
} else {
    Write-Host "[ERROR] Common module not available" -ForegroundColor Red
}

# ===============================================================
# PHASE 1: SERVER INSTALLATION & SETUP
# ===============================================================
Write-Log "Phase 1: Server Installation & Setup..." -Level Info

# Initialize installation system FIRST
if (Get-Command "Initialize-InstallationModule" -ErrorAction SilentlyContinue) {
    try {
        Initialize-InstallationModule -Config $configHash
        Write-Log "[OK] Installation system initialized"
        
        # Check if server is installed
        $serverDir = if ($configHash.serverDir) { $configHash.serverDir } else { ".\server" }
        $steamCmdPath = if ($configHash.steamCmd) { $configHash.steamCmd } else { ".\steamcmd\steamcmd.exe" }
        $appId = if ($configHash.appId) { $configHash.appId } else { "3792580" }
        
        # Check if SteamCMD exists
        if (-not (Test-Path $steamCmdPath)) {
            Write-Log "[INSTALL] SteamCMD not found, installing..." -Level Warning
            try {
                if (Get-Command "Install-SteamCmd" -ErrorAction SilentlyContinue) {
                    $steamResult = Install-SteamCmd -SteamCmdPath $steamCmdPath
                    if ($steamResult.Success) {
                        Write-Log "[OK] SteamCMD installed successfully"
                    } else {
                        Write-Log "[ERROR] SteamCMD installation failed: $($steamResult.Error)" -Level Error
                    }
                } else {
                    Write-Log "[ERROR] Install-SteamCmd function not available" -Level Error
                }
            } catch {
                Write-Log "[ERROR] SteamCMD installation failed: $($_.Exception.Message)" -Level Error
            }
        } else {
            Write-Log "[OK] SteamCMD found"
        }
        
        # Check and install SQLite tools
        $sqliteToolsPath = ".\sqlite-tools"
        $sqliteExe = Join-Path $sqliteToolsPath "sqlite3.exe"
        if (-not (Test-Path $sqliteExe)) {
            Write-Log "[INSTALL] SQLite tools not found, installing..." -Level Warning
            try {
                if (Get-Command "Install-SqliteTools" -ErrorAction SilentlyContinue) {
                    $sqliteResult = Install-SqliteTools -SqliteToolsPath $sqliteToolsPath
                    if ($sqliteResult.Success) {
                        Write-Log "[OK] SQLite tools installed successfully" -Level Info
                    } else {
                        Write-Log "[ERROR] SQLite tools installation failed: $($sqliteResult.Error)" -Level Error
                    }
                } else {
                    Write-Log "[ERROR] Install-SqliteTools function not available" -Level Error
                }
            } catch {
                Write-Log "[ERROR] SQLite tools installation failed: $($_.Exception.Message)" -Level Error
            }
        } else {
            Write-Log "[OK] SQLite tools found" -Level Info
        }
        
        # Check if server is installed
        if (Get-Command "Test-FirstInstall" -ErrorAction SilentlyContinue) {
            $needsInstall = Test-FirstInstall -ServerDirectory $serverDir -AppId $appId
            if ($needsInstall) {
                Write-Log "[INSTALL] Server not found, installing SCUM Dedicated Server..." -Level Warning
                try {
                    if (Get-Command "Invoke-FirstInstall" -ErrorAction SilentlyContinue) {
                        $installResult = Invoke-FirstInstall -SteamCmdPath (Split-Path $steamCmdPath -Parent) -ServerDirectory $serverDir -AppId $appId -ServiceName $serviceName
                        if ($installResult.Success) {
                            Write-Log "[OK] SCUM Server installed successfully" -Level Info
                            
                            # Check if restart is required for service configuration
                            if ($installResult.RequireRestart) {
                                Write-Log "" -Level Info
                                Write-Log "================================================================" -Level Info
                                Write-Log "                    INSTALLATION COMPLETE" -Level Info
                                Write-Log "================================================================" -Level Info
                                Write-Log "The SCUM server has been successfully installed!" -Level Info
                                Write-Log "" -Level Info
                                Write-Log "NEXT STEP:" -Level Info
                                Write-Log "Please configure the Windows service using NSSM and then" -Level Info
                                Write-Log "restart this automation script." -Level Info
                                Write-Log "" -Level Info
                                Write-Log "Service details for your reference:" -Level Info
                                Write-Log "- Service name: $serviceName" -Level Info
                                Write-Log "- Executable: $(Join-Path $serverDir "SCUM\Binaries\Win64\SCUMServer.exe")" -Level Info
                                Write-Log "" -Level Info
                                Write-Log "================================================================" -Level Info
                                Write-Log "Press any key to exit automation script..." -Level Info
                                $null = Read-Host
                                exit 0
                            }
                        } else {
                            Write-Log "[ERROR] Server installation failed: $($installResult.Error)" -Level Error
                        }
                    } else {
                        Write-Log "[ERROR] Invoke-FirstInstall function not available" -Level Error
                    }
                } catch {
                    Write-Log "[ERROR] Server installation failed: $($_.Exception.Message)" -Level Error
                }
            } else {
                Write-Log "[OK] SCUM Server installation found" -Level Info
            }
        }
        
    } catch {
        Write-Log "[WARN] Installation system failed: $($_.Exception.Message)" -Level Warning
    }
} else {
    Write-Log "[WARN] Installation module not available" -Level Warning
}

# Initialize update system SECOND
if (Get-Command "Initialize-UpdateModule" -ErrorAction SilentlyContinue) {
    try {
        Initialize-UpdateModule -Config $configHash
        Write-Log "[OK] Update system initialized" -Level Info
        
        # Check for updates if configured
        if ($configHash.runUpdateOnStart -eq $true) {
            Write-Log "[UPDATE] Checking for server updates..." -Level Warning
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
                        Write-Log "[UPDATE] Update available (Local: $($updateCheck.InstalledBuild), Latest: $($updateCheck.LatestBuild))" -Level Warning
                        if (Get-Command "Update-GameServer" -ErrorAction SilentlyContinue) {
                            Write-Log "[UPDATE] Installing server update..." -Level Warning
                            $updateResult = & $updateModule { 
                                param($steamPath, $serverPath, $appIdValue, $serviceNameValue)
                                Update-GameServer -SteamCmdPath $steamPath -ServerDirectory $serverPath -AppId $appIdValue -ServiceName $serviceNameValue
                            } $steamCmdPath $serverDirectory $appId $serviceName
                            
                            if ($updateResult.Success) {
                                Write-Log "[OK] Server updated successfully" -Level Info
                            } else {
                                Write-Log "[WARN] Server update failed: $($updateResult.Error)" -Level Warning
                            }
                        }
                    } else {
                        Write-Log "[OK] Server is up to date (Build: $($updateCheck.InstalledBuild))" -Level Info
                    }
                } else {
                    Write-Log "[WARN] Update check function not available" -Level Warning
                }
            } catch {
                Write-Log "[WARN] Update check failed: $($_.Exception.Message)" -Level Warning
            }
        } else {
            Write-Log "[SKIP] Startup update check disabled" -Level Info
        }
        
    } catch {
        Write-Log "[WARN] Update system failed: $($_.Exception.Message)" -Level Warning
    }
} else {
    Write-Log "[WARN] Update module not available" -Level Warning
}

# Initialize backup system THIRD
if (Get-Command "Initialize-BackupModule" -ErrorAction SilentlyContinue) {
    try {
        Initialize-BackupModule -Config $configHash
        Write-Log "[OK] Backup system initialized" -Level Info
        
        # Create startup backup if configured
        if ($configHash.runBackupOnStart -eq $true) {
            Write-Log "[BACKUP] Creating startup backup..." -Level Warning
            try {
                if (Get-Command "Invoke-GameBackup" -ErrorAction SilentlyContinue) {
                    $backupParams = @{
                        SourcePath = if ($configHash.savedDir) { $configHash.savedDir } else { ".\server\SCUM\Saved" }
                        BackupRoot = if ($configHash.backupRoot) { $configHash.backupRoot } else { ".\backups" }
                        MaxBackups = if ($configHash.maxBackups) { $configHash.maxBackups } else { 10 }
                        CompressBackups = if ($configHash.compressBackups -ne $null) { $configHash.compressBackups } else { $true }
                        Type = "startup"
                    }
                    
                    $backupResult = Invoke-GameBackup @backupParams
                    if ($backupResult) {
                        Write-Log "[OK] Startup backup completed" -Level Info
                    } else {
                        Write-Log "[WARN] Startup backup failed" -Level Warning
                    }
                } else {
                    Write-Log "[WARN] Backup function not available" -Level Warning
                }
            } catch {
                Write-Log "[WARN] Startup backup failed: $($_.Exception.Message)" -Level Warning
            }
        } else {
            Write-Log "[SKIP] Startup backup disabled" -Level Info
        }
        
    } catch {
        Write-Log "[WARN] Backup system failed: $($_.Exception.Message)" -Level Warning
    }
} else {
    Write-Log "[WARN] Backup module not available" -Level Warning
}

# ===============================================================
# PHASE 2: SERVER MONITORING & COMMUNICATION
# ===============================================================
Write-Log "Phase 2: Server Monitoring & Communication..." -Level Info

# Initialize log parser
if (Get-Command "Initialize-LogReaderModule" -ErrorAction SilentlyContinue) {
    try {
        $logPath = if ($configHash.serverDir) { Join-Path $configHash.serverDir "SCUM\Saved\Logs\SCUM.log" } else { $null }
        $null = Initialize-LogReaderModule -Config $configHash -LogPath $logPath
        Write-Log "[OK] Log parser system" -Level Info
    } catch {
        Write-Log "[WARN] Log parser failed: $($_.Exception.Message)" -Level Warning
    }
} else {
    Write-Log "[WARN] Log parser module not available" -Level Warning
}

# Initialize database
if (Get-Command "Initialize-DatabaseModule" -ErrorAction SilentlyContinue) {
    try {
        $databasePath = if ($configHash.serverDir) { Join-Path $configHash.serverDir "SCUM\Saved\SaveFiles\SCUM.db" } else { $null }
        $dbResult = Initialize-DatabaseModule -Config $configHash -DatabasePath $databasePath
        if ($dbResult.Success) {
            Write-Log "[OK] Database connection" -Level Info
            
            # Initialize centralized database service
            $statusInterval = if ($configHash.Discord.LiveEmbeds.StatusUpdateInterval) { $configHash.Discord.LiveEmbeds.StatusUpdateInterval } else { 60 }
            Initialize-DatabaseService -CacheIntervalSeconds $statusInterval
            Write-Log "[OK] Centralized database service initialized (cache: $statusInterval seconds)" -Level Info
        } else {
            Write-Log "[WARN] Database limited: $($dbResult.Error)" -Level Warning
        }
    } catch {
        Write-Log "[WARN] Database failed: $($_.Exception.Message)" -Level Warning
    }
} else {
    Write-Log "[WARN] Database module not available" -Level Warning
}

# Initialize leaderboards module
if (Get-Command "Initialize-LeaderboardsModule" -ErrorAction SilentlyContinue) {
    try {
        $databasePath = if ($configHash.serverDir) { Join-Path $configHash.serverDir "SCUM\Saved\SaveFiles\SCUM.db" } else { $null }
        $sqlitePath = ".\sqlite-tools\sqlite3.exe"
        $lbResult = Initialize-LeaderboardsModule -DatabasePath $databasePath -SqliteExePath $sqlitePath
        if ($lbResult.Success) {
            Write-Log "[OK] Leaderboards module" -Level Info
        } else {
            Write-Log "[WARN] Leaderboards limited: $($lbResult.Error)" -Level Warning
        }
    } catch {
        Write-Log "[WARN] Leaderboards failed: $($_.Exception.Message)" -Level Warning
    }
} else {
    Write-Log "[WARN] Leaderboards module not available" -Level Warning
}

# Initialize monitoring (depends on database being initialized first)
if (Get-Command "Initialize-MonitoringModule" -ErrorAction SilentlyContinue) {
    try {
        $null = Initialize-MonitoringModule -Config $configHash
        Write-Log "[OK] Server monitoring system" -Level Info
    } catch {
        Write-Log "[WARN] Monitoring failed: $($_.Exception.Message)" -Level Warning
    }
} else {
    Write-Log "[WARN] Monitoring module not available" -Level Warning
}

# Initialize scheduling
if (Get-Command "Initialize-SchedulingModule" -ErrorAction SilentlyContinue) {
    try {
        Initialize-SchedulingModule -Config $configHash
        Write-Log "[OK] Scheduling system" -Level Info
    } catch {
        Write-Log "[WARN] Scheduling failed: $($_.Exception.Message)" -Level Warning
    }
} else {
    Write-Log "[WARN] Scheduling module not available" -Level Warning
}

# Function to update Discord leaderboards
function Update-ManagerDiscordLeaderboards {
    try {
        # Call the Discord integration leaderboard update function
        if (Get-Command "Update-DiscordLeaderboards" -ErrorAction SilentlyContinue) {
            $result = Update-DiscordLeaderboards -Type "player_stats"
            # Only log completion, not start
        } else {
            Write-Log "Discord leaderboards function not available" -Level Debug
        }
    } catch {
        Write-Log "Discord leaderboards update failed: $($_.Exception.Message)" -Level Warning
    }
}

# Initialize Discord integration
if (Get-Command "Initialize-DiscordIntegration" -ErrorAction SilentlyContinue) {
    try {
        $null = Initialize-DiscordIntegration -Config $configHash
        Write-Log "[OK] Discord integration initialized successfully" -Level Info
        
        # Note: Leaderboard updates will start after monitoring begins
        
    } catch {
        Write-Log "[WARN] Discord failed: $($_.Exception.Message)" -Level Warning
    }
} else {
    Write-Log "[WARN] Discord integration not available" -Level Warning
}

# Initialize Discord notification manager
if (Get-Command "Initialize-NotificationManager" -ErrorAction SilentlyContinue) {
    try {
        $null = Initialize-NotificationManager -Config $configHash
        Write-Log "[OK] Discord notification manager initialized successfully" -Level Info
    } catch {
        Write-Log "[WARN] Discord notification manager failed: $($_.Exception.Message)" -Level Warning
    }
} else {
    Write-Log "[WARN] Discord notification manager not available" -Level Warning
}

# Initialize Discord scheduled tasks module
if (Get-Command "Initialize-ScheduledTasksModule" -ErrorAction SilentlyContinue) {
    try {
        Initialize-ScheduledTasksModule -Config $configHash
        Write-Log "[OK] Discord scheduled tasks initialized successfully" -Level Info
    } catch {
        Write-Log "[WARN] Discord scheduled tasks failed: $($_.Exception.Message)" -Level Warning
    }
} else {
    Write-Log "[WARN] Discord scheduled tasks not available" -Level Warning
}

# Initialize Discord chat relay
if (Get-Command "Initialize-ChatManager" -ErrorAction SilentlyContinue) {
    try {
        $chatManagerResult = Initialize-ChatManager -Config $configHash
        if ($chatManagerResult) {
            Write-Log "[OK] Discord chat manager initialized successfully" -Level Info
        } else {
            Write-Log "[INFO] Discord chat manager not enabled or configured" -Level Info
        }
    } catch {
        Write-Log "[WARN] Discord chat manager failed: $($_.Exception.Message)" -Level Warning
    }
} else {
    Write-Log "[WARN] Discord chat manager not available" -Level Warning
}

# ===============================================================
# PHASE 3: LOG MONITORING MODULES
# ===============================================================
Write-Log "Phase 3: Log Monitoring Modules..." -Level Info

# Initialize admin log monitoring
if (Get-Command "Initialize-AdminLogModule" -ErrorAction SilentlyContinue) {
    try {
        $adminLogResult = Initialize-AdminLogModule -Config $configHash
        if ($adminLogResult) {
            Write-Log "[OK] Admin log monitoring initialized successfully" -Level Info
        } else {
            Write-Log "[INFO] Admin log monitoring not enabled or configured" -Level Info
        }
    } catch {
        Write-Log "[WARN] Admin log monitoring failed: $($_.Exception.Message)" -Level Warning
    }
} else {
    Write-Log "[WARN] Admin log module not available" -Level Warning
}

# Initialize kill log monitoring
if (Get-Command "Initialize-KillLogModule" -ErrorAction SilentlyContinue) {
    try {
        $killLogResult = Initialize-KillLogModule -Config $configHash
        if ($killLogResult) {
            Write-Log "[OK] Kill log monitoring initialized successfully" -Level Info
        } else {
            Write-Log "[INFO] Kill log monitoring not enabled or configured" -Level Info
        }
    } catch {
        Write-Log "[WARN] Kill log monitoring failed: $($_.Exception.Message)" -Level Warning
    }
} else {
    Write-Log "[WARN] Kill log module not available" -Level Warning
}

# Initialize eventkill log monitoring
if (Get-Command "Initialize-EventKillLogModule" -ErrorAction SilentlyContinue) {
    try {
        $eventKillLogResult = Initialize-EventKillLogModule -Config $configHash
        if ($eventKillLogResult) {
            Write-Log "[OK] Event kill log monitoring initialized successfully" -Level Info
        } else {
            Write-Log "[INFO] Event kill log monitoring not enabled or configured" -Level Info
        }
    } catch {
        Write-Log "[WARN] Event kill log monitoring failed: $($_.Exception.Message)" -Level Warning
    }
} else {
    Write-Log "[WARN] Event kill log module not available" -Level Warning
}

# Initialize violations log monitoring
if (Get-Command "Initialize-ViolationsLogModule" -ErrorAction SilentlyContinue) {
    try {
        $violationsLogResult = Initialize-ViolationsLogModule -Config $configHash
        if ($violationsLogResult) {
            Write-Log "[OK] Violations log monitoring initialized successfully" -Level Info
        } else {
            Write-Log "[INFO] Violations log monitoring not enabled or configured" -Level Info
        }
    } catch {
        Write-Log "[WARN] Violations log monitoring failed: $($_.Exception.Message)" -Level Warning
    }
} else {
    Write-Log "[WARN] Violations log module not available" -Level Warning
}

# Initialize famepoints log monitoring
if (Get-Command "Initialize-FamePointsLogModule" -ErrorAction SilentlyContinue) {
    try {
        $famePointsLogResult = Initialize-FamePointsLogModule -Config $configHash
        if ($famePointsLogResult) {
            Write-Log "[OK] Fame points log monitoring initialized successfully" -Level Info
        } else {
            Write-Log "[INFO] Fame points log monitoring not enabled or configured" -Level Info
        }
    } catch {
        Write-Log "[WARN] Fame points log monitoring failed: $($_.Exception.Message)" -Level Warning
    }
} else {
    Write-Log "[WARN] Fame points log module not available" -Level Warning
}

# Initialize login log monitoring
if (Get-Command "Initialize-LoginLogModule" -ErrorAction SilentlyContinue) {
    try {
        $loginLogResult = Initialize-LoginLogModule -Config $configHash
        if ($loginLogResult) {
            Write-Log "[OK] Login log monitoring initialized successfully" -Level Info
        } else {
            Write-Log "[INFO] Login log monitoring not enabled or configured" -Level Info
        }
    } catch {
        Write-Log "[WARN] Login log monitoring failed: $($_.Exception.Message)" -Level Warning
    }
} else {
    Write-Log "[WARN] Login log module not available" -Level Warning
}

# Initialize economy log monitoring
if (Get-Command "Initialize-EconomyLogModule" -ErrorAction SilentlyContinue) {
    try {
        $economyLogResult = Initialize-EconomyLogModule -Config $configHash
        if ($economyLogResult) {
            Write-Log "[OK] Economy log monitoring initialized successfully" -Level Info
        } else {
            Write-Log "[INFO] Economy log monitoring not enabled or configured" -Level Info
        }
    } catch {
        Write-Log "[WARN] Economy log monitoring failed: $($_.Exception.Message)" -Level Warning
    }
} else {
    Write-Log "[WARN] Economy log module not available" -Level Warning
}

# Initialize vehicle log monitoring
if (Get-Command "Initialize-VehicleLogModule" -ErrorAction SilentlyContinue) {
    try {
        $vehicleLogResult = Initialize-VehicleLogModule -Config $configHash
        if ($vehicleLogResult) {
            Write-Log "[OK] Vehicle log monitoring initialized successfully" -Level Info
        } else {
            Write-Log "[INFO] Vehicle log monitoring not enabled or configured" -Level Info
        }
    } catch {
        Write-Log "[WARN] Vehicle log monitoring failed: $($_.Exception.Message)" -Level Warning
    }
} else {
    Write-Log "[WARN] Vehicle log module not available" -Level Warning
}

# Initialize raid protection log monitoring
if (Get-Command "Initialize-RaidProtectionLogModule" -ErrorAction SilentlyContinue) {
    try {
        $raidProtectionLogResult = Initialize-RaidProtectionLogModule -Config $configHash
        if ($raidProtectionLogResult) {
            Write-Log "[OK] Raid protection log monitoring initialized successfully" -Level Info
        } else {
            Write-Log "[INFO] Raid protection log monitoring not enabled or configured" -Level Info
        }
    } catch {
        Write-Log "[WARN] Raid protection log monitoring failed: $($_.Exception.Message)" -Level Warning
    }
} else {
    Write-Log "[WARN] Raid protection log module not available" -Level Warning
}

# Initialize gameplay log monitoring
if (Get-Command "Initialize-GameplayLogModule" -ErrorAction SilentlyContinue) {
    try {
        $gameplayLogResult = Initialize-GameplayLogModule -Config $configHash
        if ($gameplayLogResult) {
            Write-Log "[OK] Gameplay log monitoring initialized successfully" -Level Info
        } else {
            Write-Log "[INFO] Gameplay log monitoring not enabled or configured" -Level Info
        }
    } catch {
        Write-Log "[WARN] Gameplay log monitoring failed: $($_.Exception.Message)" -Level Warning
    }
} else {
    Write-Log "[WARN] Gameplay log module not available" -Level Warning
}

# Initialize quest log monitoring
if (Get-Command "Initialize-QuestLogModule" -ErrorAction SilentlyContinue) {
    try {
        $questLogResult = Initialize-QuestLogModule -Config $configHash
        if ($questLogResult) {
            Write-Log "[OK] Quest log monitoring initialized successfully" -Level Info
        } else {
            Write-Log "[INFO] Quest log monitoring not enabled or configured" -Level Info
        }
    } catch {
        Write-Log "[WARN] Quest log monitoring failed: $($_.Exception.Message)" -Level Warning
    }
} else {
    Write-Log "[WARN] Quest log module not available" -Level Warning
}

# Initialize chest log monitoring
if (Get-Command "Initialize-ChestLogModule" -ErrorAction SilentlyContinue) {
    try {
        $chestLogResult = Initialize-ChestLogModule -Config $configHash
        if ($chestLogResult) {
            Write-Log "[OK] Chest log monitoring initialized successfully" -Level Info
        } else {
            Write-Log "[INFO] Chest log monitoring not enabled or configured" -Level Info
        }
    } catch {
        Write-Log "[WARN] Chest log monitoring failed: $($_.Exception.Message)" -Level Warning
    }
} else {
    Write-Log "[WARN] Chest log module not available" -Level Warning
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
            
            # Get cached database statistics from centralized service - NO DIRECT DB CALLS
            $dbStats = Get-DatabaseServiceStats
            
            Write-Log "Using centralized database cache: Total=$($dbStats.TotalPlayers), Online=$($dbStats.OnlinePlayers), Squads=$($dbStats.ActiveSquads)" -Level Debug
            
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
                ServerIP = "N/A"
                GameTime = $dbStats.GameTime
                Temperature = $dbStats.Temperature
                Performance = if ($monitoringStatus.Performance.FPS -gt 0) { "$($monitoringStatus.Performance.FPS) FPS" } else { "N/A" }
                Version = "N/A"
                LastUpdate = $monitoringStatus.LastUpdate.ToString("yyyy-MM-dd HH:mm:ss")
                # Add database stats for Discord embed
                DatabaseStats = @{
                    TotalPlayers = $dbStats.TotalPlayers.ToString()
                    ActiveSquads = $dbStats.ActiveSquads.ToString()
                }
            }
            
            # Update script state to match monitoring data
            $script:State.IsRunning = $monitoringStatus.IsRunning
            
            Write-Log "Using monitoring module data: IsRunning=$($status.IsRunning), Players=$($status.OnlinePlayers), Total=$($dbStats.TotalPlayers)" -Level Debug
            return $status
            
        } catch {
            Write-Log "Failed to get monitoring status: $($_.Exception.Message)" -Level Debug
            # Fall back to basic status
        }
    }
    
    # Fallback to basic status check with cached data
    $currentServiceStatus = Test-ServiceStatus
    $dbStats = Get-DatabaseServiceStats
    
    $status = @{
        IsRunning = $currentServiceStatus
        OnlinePlayers = $dbStats.OnlinePlayers.ToString()
        MaxPlayers = "64"
        Uptime = "N/A"
        CPUUsage = "N/A"
        MemoryUsage = "N/A"
        DiskUsage = "N/A"
        NetworkIn = "N/A"
        NetworkOut = "N/A"
        ServerIP = "N/A"
        GameTime = $dbStats.GameTime
        Temperature = $dbStats.Temperature
        Performance = "Unknown"
        Version = "N/A"
        LastUpdate = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        DatabaseStats = @{
            TotalPlayers = $dbStats.TotalPlayers.ToString()
            ActiveSquads = $dbStats.ActiveSquads.ToString()
        }
    }
    
    Write-Log "Using fallback status with cached data: IsRunning=$($status.IsRunning), Total=$($dbStats.TotalPlayers)" -Level Debug
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
                    Write-Log "Server state changed: $($event.EventType)" -Level Info
                    
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
                                Write-Log "Sending Discord notification: $eventType" -Level Info
                                $result = Send-DiscordNotification -Type $eventType -Data @{
                                    service_name = $script:ServiceName
                                    timestamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
                                }
                                
                                if ($result.Success) {
                                    Write-Log "Discord notification sent successfully: $eventType" -Level Info
                                } else {
                                    Write-Log "Discord notification failed: $($result.Error)" -Level Warning
                                }
                            }
                        } catch {
                            Write-Log "Discord notification error: $($_.Exception.Message)" -Level Warning
                        }
                    } else {
                        Write-Log "Discord notification function not available" -Level Warning
                    }
                    
                    # IMMEDIATE Discord status update on state change
                    if ((Get-Command "Update-BotActivity" -ErrorAction SilentlyContinue) -and 
                        (Get-Command "Update-DiscordServerStatus" -ErrorAction SilentlyContinue)) {
                        try {
                            # Get server status from monitoring module
                            $currentServerStatus = Get-ServerStatus
                            Write-Log "Updating Discord status immediately due to state change: IsRunning=$($currentServerStatus.IsRunning)" -Level Debug
                            
                            # Update bot activity
                            Update-BotActivity -ServerStatus $currentServerStatus | Out-Null
                            
                            # Update server status embed  
                            Update-DiscordServerStatus -ServerStatus $currentServerStatus | Out-Null
                            
                            Write-Log "Discord status updated immediately after state change" -Level Debug
                        } catch {
                            Write-Log "Immediate Discord status update failed: $($_.Exception.Message)" -Level Warning
                        }
                    }
                }
            }
            
            # Update internal state from monitoring module
            if (Get-Command "Get-ServerStatus" -ErrorAction SilentlyContinue) {
                $serverStatus = Get-ServerStatus
                $script:State.IsRunning = $serverStatus.IsOnline
                $script:State.LastStatusCheck = Get-Date
                Write-Log "Internal state updated from monitoring: IsRunning=$($serverStatus.IsOnline)" -Level Debug
            }
            
        } catch {
            Write-Log "Monitoring module update failed: $($_.Exception.Message)" -Level Warning
            # Fall back to basic monitoring
            Update-ServiceMonitoringBasic
        }
    } else {
        Write-Log "Monitoring module not available, using basic monitoring" -Level Warning
        # Fallback to basic monitoring if module not available
        Update-ServiceMonitoringBasic
    }
    
    # Force update Discord status periodically (using config interval)
    $timeSinceLastUpdate = (Get-Date) - $script:State.LastDiscordUpdate
    if ($timeSinceLastUpdate.TotalSeconds -ge $discordStatusIntervalSeconds) {
        if (Get-Command "Update-DiscordServerStatus" -ErrorAction SilentlyContinue) {
            try {
                # Pass null - let Update-DiscordServerStatus get status only if needed
                Write-Log "Sending Discord update..." -Level Debug
                Update-DiscordServerStatus -ServerStatus $null
                $script:State.LastDiscordUpdate = Get-Date
                Write-Log "Discord status updated (periodic)" -Level Debug
            } catch {
                Write-Log "Periodic Discord update failed: $($_.Exception.Message)" -Level Debug
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
    Write-Log "Service status check: $statusText" -Level Debug
    
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
                Write-Log "Discord notification failed: $($_.Exception.Message)" -Level Warning
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
            # MEMORY LEAK FIX: Use ArrayList instead of array +=
            $timeList = [System.Collections.ArrayList]::new()
            foreach ($time in $originalConfig.restartTimes) {
                if ($time -and $time.ToString().Trim() -ne "") {
                    [void]$timeList.Add($time.ToString().Trim())
                }
            }
            $timeList.ToArray()
        } else { 
            @() 
        }
        
        if ($restartTimes.Count -eq 0) {
            Write-Log "No restart times configured, scheduling disabled" -Level Debug
            return
        }
        
        Write-Log "Raw restart times from config: $($restartTimes -join ', ')" -Level Debug
        
        # Initialize restart warning system from scheduling module
        if (Get-Command "Initialize-RestartWarningSystem" -ErrorAction SilentlyContinue) {
            try {
                # Use explicit hashtable conversion to prevent array conversion
                $initResult = Initialize-RestartWarningSystem -RestartTimes $restartTimes
                
                # Accept the result regardless of type as long as it has NextRestartTime
                if ($initResult -and $initResult.NextRestartTime) {
                    $script:SchedulingState = $initResult
                    Write-Log "Scheduling system initialized with restart times: $($restartTimes -join ', ')" -Level Info
                } else {
                    Write-Log "Initialize-RestartWarningSystem returned invalid state" -Level Warning
                    return
                }
            } catch {
                Write-Log "Failed to initialize scheduling system: $($_.Exception.Message)" -Level Warning
                return
            }
        } else {
            Write-Log "Scheduling module functions not available" -Level Warning
            return
        }
    }
    
    if (-not $script:SchedulingState) {
        return
    }
    
    # Validate SchedulingState type - if Object[] but has NextRestartTime, keep using it
    $stateType = if ($script:SchedulingState) { $script:SchedulingState.GetType().Name } else { "null" }
    $hasNextRestart = if ($script:SchedulingState -and $script:SchedulingState.NextRestartTime) { $true } else { $false }
    
    Write-Log "SchedulingState validation: Type='$stateType', HasNextRestart=$hasNextRestart" -Level Debug
    
    # Accept both hashtable and Object[] as long as it has NextRestartTime
    if (-not $script:SchedulingState -or -not $hasNextRestart) {
        Write-Log "SchedulingState invalid (Type: $stateType, HasNextRestart: $hasNextRestart), reinitializing..." -Level Warning
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
                Write-Log "Update-RestartWarnings returned invalid state" -Level Warning
            }
        } catch {
            Write-Log "Failed to update restart warnings: $($_.Exception.Message)" -Level Warning
        }
    }
    
    # Check if scheduled restart is due
    if (Get-Command "Test-ScheduledRestartDue" -ErrorAction SilentlyContinue) {
        try {
            $restartDue = Test-ScheduledRestartDue -WarningState $script:SchedulingState -CurrentTime $now
            
            if ($restartDue) {
                Write-Log "Scheduled restart is due at $($script:SchedulingState.NextRestartTime.ToString('HH:mm:ss'))" -Level Info
                
                # Execute scheduled restart using scheduling module
                if (Get-Command "Invoke-ScheduledRestart" -ErrorAction SilentlyContinue) {
                    try {
                        $serviceName = if ($script:State.ServiceName) { $script:State.ServiceName } else { "SCUMSERVER" }
                        
                        $restartResult = Invoke-ScheduledRestart -WarningState $script:SchedulingState -ServiceName $serviceName
                        
                        # Accept the result regardless of type as long as it has NextRestartTime
                        if ($restartResult -and $restartResult.NextRestartTime) {
                            $script:SchedulingState = $restartResult
                            Write-Log "Scheduled restart completed, next restart: $($script:SchedulingState.NextRestartTime.ToString('yyyy-MM-dd HH:mm:ss'))" -Level Info
                        } else {
                            Write-Log "Invoke-ScheduledRestart returned invalid state" -Level Warning
                        }
                    } catch {
                        Write-Log "Failed to execute scheduled restart: $($_.Exception.Message)" -Level Error
                    }
                } else {
                    # Fallback to manual restart execution
                    Write-Log "Scheduling module restart function not available, using fallback" -Level Warning
                    
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
            Write-Log "Failed to check restart due: $($_.Exception.Message)" -Level Warning
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
        Write-Log "Failed to start service: $($_.Exception.Message)" -Level Error
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
        Write-Log "Failed to stop service: $($_.Exception.Message)" -Level Error
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
            Write-Log "Scheduling system restart failed: $($_.Exception.Message)" -Level Error
            throw "Restart failed: $($_.Exception.Message)"
        }
    } else {
        Write-Log "Scheduling module not available - restart cannot proceed" -Level Error
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
                Type = $Type
            }
            
            $backupResult = Invoke-GameBackup @backupParams
            if ($backupResult) {
                $script:State.LastBackup = Get-Date
                Write-Log "Backup completed successfully"
                return $true
            } else {
                throw "Backup operation failed"
            }
        } else {
            Write-Log "Backup module not available" -Level Warning
            return $false
        }
    } catch {
        Write-Log "Backup failed: $($_.Exception.Message)" -Level Error
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
        Write-Log "Periodic backup is due (interval: $backupInterval minutes)" -Level Info
        
        try {
            $backupResult = Invoke-Backup -Type "periodic"
            if ($backupResult) {
                Write-Log "Periodic backup completed successfully" -Level Info
            } else {
                Write-Log "Periodic backup failed" -Level Warning
            }
        } catch {
            Write-Log "Periodic backup error: $($_.Exception.Message)" -Level Warning
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
        Write-Log "Update check is due (interval: $updateCheckInterval minutes)" -Level Debug
        
        try {
            $updateAvailable = Test-ManagerUpdateAvailable
            $script:State.LastUpdateCheck = $now
            
            if ($updateAvailable) {
                Write-Log "Server update available!" -Level Info
                
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
                            Write-Log "Failed to send update notification: $($_.Exception.Message)" -Level Warning
                        }
                    }
                    
                    # Start automatic update process
                    Write-Log "Starting automatic update process" -Level Info
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
                            Write-Log "Automatic update completed successfully" -Level Info
                        } else {
                            Write-Log "Automatic update failed: $($updateResult.Error)" -Level Error
                        }
                        
                    } catch {
                        Write-Log "Automatic update process failed: $($_.Exception.Message)" -Level Error
                    } finally {
                        $script:State.UpdateInProgress = $false
                    }
                }
            } else {
                Write-Log "Server is up to date" -Level Debug
            }
            
        } catch {
            Write-Log "Update check failed: $($_.Exception.Message)" -Level Warning
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
            Write-Log "Update module not available" -Level Debug
            return $false
        }
    } catch {
        Write-Log "Update check failed: $($_.Exception.Message)" -Level Warning
        return $false
    }
}

# ===============================================================
# INTERACTIVE COMMANDS
# ===============================================================
function Show-Menu {
    Write-Log "=== SCUM Server Automation Commands ===" -Level Info
    Write-Log "1. Show Status" -Level Info
    Write-Log "2. Start Server" -Level Info
    Write-Log "3. Stop Server" -Level Info
    Write-Log "4. Restart Server" -Level Info
    Write-Log "5. Create Backup" -Level Info
    Write-Log "6. Check for Updates" -Level Info
    Write-Log "7. Show Player Stats" -Level Info
    Write-Log "Q. Quit" -Level Info
    Write-Log "=====================================" -Level Info
}

function Show-Status {
    $serviceStatus = if ($script:State.IsRunning) { "RUNNING" } else { "STOPPED" }
    $serviceColor = if ($script:State.IsRunning) { "Green" } else { "Red" }
    
    Write-Log "=== Server Status ===" -Level Info
    Write-Log "Service: $($script:State.ServiceName)" -Level Info
    Write-Log "Status: $serviceStatus" -Level Info
    
    if ($script:State.IsRunning) {
        $serverStatus = Get-CompleteServerStatus
        Write-Log "Players: $($serverStatus.OnlinePlayers) / $($serverStatus.MaxPlayers)" -Level Info
        Write-Log "Uptime: $($serverStatus.Uptime)" -Level Info
        Write-Log "CPU: $($serverStatus.CPUUsage)" -Level Info
        Write-Log "Memory: $($serverStatus.MemoryUsage)" -Level Info
        Write-Log "Performance: $($serverStatus.Performance)" -Level Info
    }
    
    Write-Log "Last Backup: $($script:State.LastBackup.ToString('yyyy-MM-dd HH:mm:ss'))" -Level Info
    Write-Log "Last Update Check: $($script:State.LastUpdateCheck.ToString('yyyy-MM-dd HH:mm:ss'))" -Level Info
    Write-Log "====================" -Level Info
}

function Show-PlayerStats {
    if (Get-Command "Get-PlayerLeaderboard" -ErrorAction SilentlyContinue) {
        try {
            Write-Log "=== Top Players ===" -Level Info
            $leaderboard = Get-PlayerLeaderboard -Top 10
            if ($leaderboard) {
                for ($i = 0; $i -lt $leaderboard.Count; $i++) {
                    $player = $leaderboard[$i]
                    Write-Log "$($i + 1). $($player.Name) - Score: $($player.Score)" -Level Info
                }
            } else {
                Write-Log "No player data available" -Level Warning
            }
            Write-Log "===================" -Level Info
        } catch {
            Write-Log "Failed to get player stats: $($_.Exception.Message)" -Level Error
        }
    } else {
        Write-Log "Player stats not available (database module not loaded)" -Level Warning
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
        Write-Log "Windows service '$serviceName' not found!" -Level Warning
        Write-Log "You may need to create the service first using nssm.exe" -Level Warning
    } else {
        Write-Log "Service '$serviceName' found"
    }
} catch {
    Write-Log "Error checking service: $($_.Exception.Message)" -Level Error
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
            Write-Log "Startup notification failed: $($result.Error)" -Level Warning
        }
    } catch {
        Write-Log "Startup notification failed: $($_.Exception.Message)" -Level Warning
    }
}

# ===============================================================
# MAIN EXECUTION LOOP - AUTOMATIC MODE ONLY
# ===============================================================

# Always start in automatic monitoring mode
Write-Log "Starting automatic monitoring mode..."
Write-Log "Press Ctrl+C to stop"

# Show monitoring configuration
Write-Log "=== Monitoring Configuration ===" -Level Info
Write-Log "[OK] Service Status Monitoring" -Level Info

if ($configHash.periodicBackupEnabled -eq $true) {
    $interval = if ($configHash.backupIntervalMinutes) { $configHash.backupIntervalMinutes } else { 60 }
    Write-Log "[OK] Automatic Backups (every $interval minutes)" -Level Info
} else {
    Write-Log "[SKIP] Automatic Backups (disabled)" -Level Warning
}

if ($configHash.restartTimes -and $configHash.restartTimes.Count -gt 0) {
    # Get restart times from the original JSON content to avoid hashtable conversion issues
    try {
        $originalConfig = Get-Content $ConfigPath | ConvertFrom-Json
        # MEMORY LEAK FIX: Use ArrayList instead of array +=
        $restartTimesList = [System.Collections.ArrayList]::new()
        
        if ($originalConfig.restartTimes) {
            foreach ($time in $originalConfig.restartTimes) {
                if ($time -and $time.ToString().Trim() -ne "") {
                    [void]$restartTimesList.Add($time.ToString())
                }
            }
        }
        
        $restartTimes = $restartTimesList.ToArray()
        
        if ($restartTimes.Count -gt 0) {
            $times = $restartTimes -join ", "
            Write-Log "[OK] Scheduled Restarts ($times)" -Level Info
        } else {
            Write-Log "[SKIP] Scheduled Restarts (no valid times)" -Level Warning
        }
    } catch {
        Write-Log "[SKIP] Scheduled Restarts (configuration error)" -Level Warning
    }
} else {
    Write-Log "[SKIP] Scheduled Restarts (none configured)" -Level Warning
}

Write-Log "[OK] Update Checking" -Level Info

$discordStatus = if (Get-Command "Send-DiscordNotification" -ErrorAction SilentlyContinue) { "[OK] Available" } else { "[SKIP] Module not loaded" }
Write-Log "$discordStatus Discord Integration" -Level Info

$databaseStatus = if (Get-Command "Get-TotalPlayerCount" -ErrorAction SilentlyContinue) { "[OK] Connected" } else { "[SKIP] Not available" }
Write-Log "$databaseStatus Database Access" -Level Info

Write-Log "=================================" -Level Info

# Start kill log monitoring if available
if (Get-Command "Start-KillLogMonitoring" -ErrorAction SilentlyContinue) {
    try {
        Start-KillLogMonitoring
        Write-Log "[OK] Kill log monitoring started" -Level Info
    } catch {
        Write-Log "[WARN] Failed to start kill log monitoring: $($_.Exception.Message)" -Level Warning
    }
}
    
    try {
        $loopCount = 0
        
        # Get monitoring interval from config (default 2 seconds)
        # MEMORY LEAK FIX: Increased default monitoring interval from 2s to 10s to reduce frequency
        $monitoringInterval = if ($configHash.monitoringIntervalSeconds) { $configHash.monitoringIntervalSeconds } else { 10 }
        
        # Get leaderboard update interval from Discord LiveEmbeds config (in seconds)
        $leaderboardIntervalSeconds = if ($configHash.Discord.LiveEmbeds.LeaderboardUpdateInterval) { 
            $configHash.Discord.LiveEmbeds.LeaderboardUpdateInterval # Already in seconds
        } else { 600 } # Default 10 minutes
        $leaderboardInterval = [math]::Round($leaderboardIntervalSeconds / 60) # Convert to minutes for display
        $leaderboardLoops = [math]::Max(1, [math]::Round($leaderboardIntervalSeconds / $monitoringInterval))
        
        # Get Discord status update interval from Discord LiveEmbeds config (in seconds)
        $discordStatusIntervalSeconds = if ($configHash.Discord.LiveEmbeds.UpdateInterval) { 
            $configHash.Discord.LiveEmbeds.UpdateInterval # Already in seconds
        } else { 60 } # Default 60 seconds
        
        Write-Log "Monitoring interval: $monitoringInterval seconds" -Level Info
        Write-Log "Discord status updates: every $discordStatusIntervalSeconds seconds" -Level Info
        Write-Log "Leaderboard updates: every $leaderboardInterval minutes ($leaderboardLoops loops)" -Level Info
        
        # MEMORY LEAK FIX: Calculate log processing interval to reduce overhead
        $logProcessingIntervalSeconds = 30 # Process logs every 30 seconds instead of every 2 seconds
        $logProcessingLoops = [math]::Max(1, [math]::Round($logProcessingIntervalSeconds / $monitoringInterval))
        Write-Log "Log processing: every $logProcessingIntervalSeconds seconds ($logProcessingLoops loops)" -Level Info
        
        while (-not $script:State.ShouldStop) {
            $loopCount++
            
            # Update centralized database cache - SINGLE POINT for all database calls
            Update-DatabaseServiceCache
            
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
                    Write-Log "Scheduled tasks processing failed: $($_.Exception.Message)" -Level Warning
                }
            }
            
            # Update chat manager (check for new messages every loop - critical for real-time)
            if (Get-Command "Update-ChatManager" -ErrorAction SilentlyContinue) {
                try {
                    Update-ChatManager
                } catch {
                    Write-Log "Chat manager update failed: $($_.Exception.Message)" -Level Warning
                }
            }
            
            # MEMORY LEAK FIX: Process logs less frequently to reduce overhead (every 30 seconds)
            if ($loopCount % $logProcessingLoops -eq 0) {
                # Update admin log processing 
                if (Get-Command "Update-AdminLogProcessing" -ErrorAction SilentlyContinue) {
                    try {
                        Update-AdminLogProcessing
                    } catch {
                        Write-Log "Admin log processing failed: $($_.Exception.Message)" -Level Warning
                    }
                }

                # Update kill log processing
                if (Get-Command "Update-KillLogProcessing" -ErrorAction SilentlyContinue) {
                    try {
                        Update-KillLogProcessing
                    } catch {
                        Write-Log "Kill log processing failed: $($_.Exception.Message)" -Level Warning
                    }
                }

                # Update eventkill log processing
                if (Get-Command "Update-EventKillLogProcessing" -ErrorAction SilentlyContinue) {
                    try {
                        Update-EventKillLogProcessing
                    } catch {
                        Write-Log "Event kill log processing failed: $($_.Exception.Message)" -Level Warning
                    }
                }

                # Update violations log processing
                if (Get-Command "Update-ViolationsLogProcessing" -ErrorAction SilentlyContinue) {
                    try {
                        Update-ViolationsLogProcessing
                    } catch {
                        Write-Log "Violations log processing failed: $($_.Exception.Message)" -Level Warning
                    }
                }

                # Update famepoints log processing
                if (Get-Command "Update-FamePointsLogProcessing" -ErrorAction SilentlyContinue) {
                    try {
                        Update-FamePointsLogProcessing
                    } catch {
                        Write-Log "Fame points log processing failed: $($_.Exception.Message)" -Level Warning
                    }
                }

                # Update login log processing
                if (Get-Command "Update-LoginLogProcessing" -ErrorAction SilentlyContinue) {
                    try {
                        Update-LoginLogProcessing
                    } catch {
                        Write-Log "Login log processing failed: $($_.Exception.Message)" -Level Warning
                    }
                }

                # Update economy log processing
                if (Get-Command "Update-EconomyLogProcessing" -ErrorAction SilentlyContinue) {
                    try {
                        Update-EconomyLogProcessing
                    } catch {
                        Write-Log "Economy log processing failed: $($_.Exception.Message)" -Level Warning
                    }
                }

                # Update vehicle log processing
                if (Get-Command "Update-VehicleLogProcessing" -ErrorAction SilentlyContinue) {
                    try {
                        Update-VehicleLogProcessing
                    } catch {
                        Write-Log "Vehicle log processing failed: $($_.Exception.Message)" -Level Warning
                    }
                }

                # Update raid protection log processing
                if (Get-Command "Update-RaidProtectionLogProcessing" -ErrorAction SilentlyContinue) {
                    try {
                        Update-RaidProtectionLogProcessing
                    } catch {
                        Write-Log "Raid protection log processing failed: $($_.Exception.Message)" -Level Warning
                    }
                }

                # Update gameplay log processing
                if (Get-Command "Update-GameplayLogProcessing" -ErrorAction SilentlyContinue) {
                    try {
                        Update-GameplayLogProcessing
                    } catch {
                        Write-Log "Gameplay log processing failed: $($_.Exception.Message)" -Level Warning
                    }
                }

                # Update quest log processing
                if (Get-Command "Update-QuestLogProcessing" -ErrorAction SilentlyContinue) {
                    try {
                        Update-QuestLogProcessing
                    } catch {
                        Write-Log "Quest log processing failed: $($_.Exception.Message)" -Level Warning
                    }
                }

                # Update chest log processing
                if (Get-Command "Update-ChestLogProcessing" -ErrorAction SilentlyContinue) {
                    try {
                        Update-ChestLogProcessing
                    } catch {
                        Write-Log "Chest log processing failed: $($_.Exception.Message)" -Level Warning
                    }
                }
            }

            # Update Discord text commands (check for new command messages every loop)
            if (Get-Command "Update-DiscordTextCommands" -ErrorAction SilentlyContinue) {
                try {
                    Update-DiscordTextCommands
                } catch {
                    Write-Log "Discord text commands update failed: $($_.Exception.Message)" -Level Warning
                }
            }
            
            # Perform Discord connection maintenance (every 10 loops to avoid spam)
            if ($loopCount % 10 -eq 0) {
                if (Get-Command "Maintenance-DiscordConnection" -ErrorAction SilentlyContinue) {
                    try {
                        Maintenance-DiscordConnection | Out-Null
                    } catch {
                        Write-Log "Discord connection maintenance failed: $($_.Exception.Message)" -Level Warning
                    }
                }
            }
            
            # Update Discord leaderboards based on config interval
            # First update after 30 seconds, then every normal interval from config
            if (($loopCount -eq 30) -or ($loopCount -gt 30 -and ($loopCount - 30) % $leaderboardLoops -eq 0)) {
                Write-Log "[$(Get-Date -Format 'HH:mm:ss')] Updating leaderboards..." -Level Info
                try {
                    Update-ManagerDiscordLeaderboards
                } catch {
                    Write-Log "Discord leaderboards update failed: $($_.Exception.Message)" -Level Warning
                }
                
                # Also show server status embed update (happens automatically every 15s, but we show message every 5 min)
                Write-Log "[$(Get-Date -Format 'HH:mm:ss')] Updating server status embed..." -Level Info
                
                # Check for weekly leaderboard reset (every 5 minutes)
                if (Get-Command "Test-WeeklyResetNeeded" -ErrorAction SilentlyContinue) {
                    try {
                        if (Test-WeeklyResetNeeded) {
                            Write-Log "[$(Get-Date -Format 'HH:mm:ss')] Weekly reset triggered" -Level Warning
                            if (Get-Command "Invoke-WeeklyReset" -ErrorAction SilentlyContinue) {
                                $resetResult = Invoke-WeeklyReset
                                if ($resetResult.Success) {
                                    Write-Log "[$(Get-Date -Format 'HH:mm:ss')] Weekly reset completed" -Level Info
                                } else {
                                    Write-Log "Weekly leaderboard reset failed: $($resetResult.Error)" -Level Warning
                                }
                            }
                        }
                    } catch {
                        Write-Log "Weekly reset check failed: $($_.Exception.Message)" -Level Warning
                    }
                }
            }
            
            # Show periodic status based on monitoring interval (every 5 minutes)
            $statusLoops = [math]::Max(1, [math]::Round((5 * 60) / $monitoringInterval))
            if ($loopCount % $statusLoops -eq 0) {
                $status = if ($script:State.IsRunning) { "RUNNING" } else { "STOPPED" }
                $color = if ($script:State.IsRunning) { "Green" } else { "Yellow" }
                $serverStatus = Get-CompleteServerStatus
                Write-Log "[$(Get-Date -Format 'HH:mm:ss')] Server: $status | Players: $($serverStatus.OnlinePlayers)/$($serverStatus.MaxPlayers) | Last Backup: $($script:State.LastBackup.ToString('HH:mm:ss'))" -Level Info
            }
            
            # Maintain Discord heartbeat for stable connection
            if (Get-Command "Maintain-DiscordHeartbeat" -ErrorAction SilentlyContinue) {
                try {
                    Maintain-DiscordHeartbeat | Out-Null
                } catch {
                    # Ignore heartbeat errors to prevent loop disruption
                }
            }
            
            # Discord connection maintenance DISABLED - heartbeats handle connectivity
            # Maintenance causes unnecessary restarts due to HTTP API rate limits
            # Uncomment below line only if WebSocket issues persist:
            # if ($loopCount % 1200 -eq 0) { Maintenance-DiscordConnection | Out-Null }
            
            # Sleep for configured monitoring interval
            Start-Sleep -Seconds $monitoringInterval
            
            # Force garbage collection every 10 loops to prevent memory leaks
            if ($loopCount % 10 -eq 0) {
                [System.GC]::Collect()
                [System.GC]::WaitForPendingFinalizers()
                [System.GC]::Collect()
                Write-Log "[GC] Forced garbage collection (Loop: $loopCount)" -Level Debug
            }
        }
    } catch {
        Write-Log "Error in monitoring loop: $($_.Exception.Message)" -Level Error
    }

# Final cleanup
Write-Log "SCUM Server Automation shutting down..."
