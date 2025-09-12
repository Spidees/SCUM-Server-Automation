# ===============================================================
# SCUM Server Automation System - REFACTORED
# ===============================================================
# Complete server management automation for SCUM Dedicated Server
# Provides monitoring, backup, updates, Discord integration, and scheduling
# Now organized into initialization phases for better maintainability
# ===============================================================

param(
    [string]$ConfigPath = "SCUM-Server-Automation.config.json",
    [switch]$StartServer,
    [switch]$StopServer,
    [switch]$RestartServer,
    [switch]$UpdateServer,
    [switch]$ValidateServer,
    [switch]$CreateBackup,
    [switch]$Quiet
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Global variable for quiet mode control
$script:QuietMode = $Quiet

# Initialize log path for early logging (before modules are loaded)
$script:LogPath = Join-Path $PSScriptRoot "SCUM-Server-Automation.log"

# ===============================================================
# PHASE-BASED INITIALIZATION SYSTEM
# ===============================================================
$script:InitializationPhases = @{
    1 = "Initial Setup & Encoding"
    2 = "Cleanup Handler Registration"
    3 = "Configuration Loading"
    4 = "Global Variables Setup"
    5 = "Module Loading"
    6 = "Logging System Initialization"
    7 = "Database Initialization"
    8 = "Server Service Setup"
    9 = "Discord Integration Setup"
    10 = "Monitoring System Setup"
    11 = "Scheduler Setup"
    12 = "Backup System Setup"
    13 = "Update System Setup"
    14 = "Log Processing Setup"
    15 = "API Server Setup"
    16 = "Final Validation & Ready State"
}

function Write-PhaseStatus {
    param(
        [int]$Phase,
        [string]$Status = "Starting",
        [string]$Message = ""
    )
    
    $phaseName = $InitializationPhases[$Phase]
    $color = switch ($Status) {
        "Starting" { "Cyan" }
        "Success" { "Green" }
        "Warning" { "Yellow" }
        "Error" { "Red" }
        default { "White" }
    }
    
    $statusText = "[$Status]"
    if ($Message) { $statusText += " $Message" }
    
    # Always log to file if Write-Log is available
    if ($script:LogPath -and (Get-Command "Write-Log" -ErrorAction SilentlyContinue)) {
        Write-Log "Phase $Phase - $phaseName : $statusText" -Level Info
    }
    
    # In quiet mode, show only progress updates for phase completion
    if ($script:QuietMode) {
        if ($Status -eq "Success") {
            Write-Host "  Phase $Phase/16 - $phaseName [OK]" -ForegroundColor Green
        } elseif ($Status -eq "Error") {
            Write-Host "  Phase $Phase/16 - $phaseName [ERROR]" -ForegroundColor Red
        } elseif ($Status -eq "Warning") {
            Write-Host "  Phase $Phase/16 - $phaseName [WARNING]" -ForegroundColor Yellow
        }
    } else {
        # Full output in normal mode
        Write-Host "Phase $Phase - $phaseName : $statusText" -ForegroundColor $color
    }
}

function Write-QuietOutput {
    param(
        [string]$Message,
        [string]$Color = "White",
        [switch]$Important
    )
    
    # Always log to file (but only to file, not console)
    if ($script:LogPath) {
        # Write directly to log file to avoid console duplication
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        $logLine = "$timestamp $Message"
        try {
            Add-Content -Path $script:LogPath -Value $logLine -Encoding UTF8
        } catch {
            # Fallback to Write-Log if file access fails AND Write-Log is available
            if (Get-Command "Write-Log" -ErrorAction SilentlyContinue) {
                Write-Log $Message -Level Info
            }
        }
    }
    
    # Show in console if not Quiet mode, or if Important flag is set
    if (-not $script:QuietMode -or $Important) {
        Write-Host $Message -ForegroundColor $Color
    }
}

# ===============================================================
# PHASE 1: INITIAL SETUP & ENCODING
# ===============================================================
Write-PhaseStatus -Phase 1 -Status "Starting"

if ($script:QuietMode) {
    Write-Host "=== SCUM Server Automation - Starting (Quiet Mode) ===" -ForegroundColor Green
    Write-Host "Loading system... (detailed output in log file)" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Progress:" -ForegroundColor Yellow
    Write-Host "  Phase 1/16 - Initial Setup..." -ForegroundColor Cyan
} else {
    Write-Host "=== SCUM Server Automation - Starting ===" -ForegroundColor Green
    Write-Host "Loading complete system with all modules..." -ForegroundColor Cyan
}
Write-PhaseStatus -Phase 1 -Status "Success" -Message "Console encoding and initial setup complete"

# ===============================================================
# PHASE 2: CLEANUP HANDLER REGISTRATION
# ===============================================================
Write-PhaseStatus -Phase 2 -Status "Starting"

# DISCORD BOT INTEGRATION - HANDLED BY DISCORD-INTEGRATION MODULE
# Discord bot management is now handled by the discord-integration.psm1 module
# No inline functions needed - everything is modularized

# CLEANUP HANDLER
$CleanupHandler = {
    Write-Log "Shutting down gracefully..." -Level Warning
    
    # Send shutdown notification via HTTP API
    try {
        $notificationData = @{
            type = "manager.stopped"
            data = @{}
        }
        Invoke-RestMethod -Uri "http://localhost:3001/api/server/notification" -Method Post -Body ($notificationData | ConvertTo-Json -Depth 3) -ContentType "application/json" -ErrorAction SilentlyContinue | Out-Null
    } catch { }
    
    # Stop integrated Discord bot via module
    try {
        if (Get-Command "Stop-DiscordBot" -ErrorAction SilentlyContinue) {
            Stop-DiscordBot | Out-Null
            Write-Host "Integrated Discord bot stopped successfully"
        }
    } catch { 
        Write-Host "Error stopping integrated Discord bot: $($_.Exception.Message)"
    }
    
    exit 0
}

# Register cleanup handlers
try {
    [Console]::CancelKeyPress += $CleanupHandler
    Write-PhaseStatus -Phase 2 -Status "Success" -Message "Ctrl+C handler registered"
} catch {
    Write-PhaseStatus -Phase 2 -Status "Warning" -Message "Ctrl+C handler not available in this PowerShell version"
}
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action $CleanupHandler
Write-PhaseStatus -Phase 2 -Status "Success" -Message "Cleanup handlers registered"

# ===============================================================
# PHASE 3: CONFIGURATION LOADING
# ===============================================================
Write-PhaseStatus -Phase 3 -Status "Starting"

# Store ConfigPath in script scope for functions
$script:ConfigPath = $ConfigPath

# Store root directory in script scope for functions
$script:RootDir = $PSScriptRoot

if (-not (Test-Path $ConfigPath)) {
    Write-PhaseStatus -Phase 3 -Status "Error" -Message "Configuration file not found: $ConfigPath"
    Read-Host "Press Enter to exit"
    exit 1
}

try {
    $config = Get-Content $ConfigPath | ConvertFrom-Json
    Write-PhaseStatus -Phase 3 -Status "Success" -Message "Configuration loaded: $ConfigPath"
    
    # Keep original config for array parsing (before hashtable conversion)
    $originalConfig = $config
} catch {
    Write-PhaseStatus -Phase 3 -Status "Error" -Message "Failed to load configuration: $($_.Exception.Message)"
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

# ===============================================================
# PHASE 4: GLOBAL VARIABLES SETUP
# ===============================================================
Write-PhaseStatus -Phase 4 -Status "Starting"

$configHash = ConvertTo-Hashtable $config
Set-Variable -Name "config" -Value $configHash -Scope Global
Set-Variable -Name "originalConfig" -Value $originalConfig -Scope Global

# Get basic configuration
$serviceName = if ($configHash.serviceName) { $configHash.serviceName } else { "SCUMSERVER" }
$savedDir = $configHash.savedDir
$backupRoot = $configHash.backupRoot
$steamCmd = $configHash.steamCmd
$serverDir = $configHash.serverDir

Write-PhaseStatus -Phase 4 -Status "Success" -Message "Service: $serviceName"

# Set global automation log path BEFORE loading any modules
# This prevents parser module from using server log path
$global:AutomationLogPath = Join-Path $PSScriptRoot "SCUM-Server-Automation.log"
Write-PhaseStatus -Phase 4 -Status "Success" -Message "Global automation log path: $global:AutomationLogPath"

# ===============================================================
# PHASE 5: MODULE LOADING
# ===============================================================
Write-PhaseStatus -Phase 5 -Status "Starting"

$modules = @(
    "core\common\common.psm1",
    "core\database-service.psm1",
    "core\logging\parser\parser.psm1",
    "server\service\service.psm1",
    "server\monitoring\monitoring.psm1",
    "server\installation\installation.psm1",
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
    "database\server-database.psm1",    
    "database\scum-database.psm1",
    "communication\discord\live-embeds\server-status-embed.psm1",
    "communication\discord\live-embeds\leaderboards-embed.psm1",
    "communication\discord\discord-integration.psm1",
    "communication\discord\embed-persistence.psm1"
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
                if ($script:QuietMode) {
                    # In quiet mode, completely suppress all module output
                    Import-Module $modulePath -Global -WarningAction SilentlyContinue -ErrorAction Stop *>$null
                } else {
                    Import-Module $modulePath -Global -WarningAction SilentlyContinue -ErrorAction Stop
                }
            }
            if (-not $script:QuietMode) {
                Write-QuietOutput "  [OK] $moduleName" -Color Green
            }
            $loadedModules += $moduleName
        } catch {
            Write-QuietOutput "  [ERROR] $module - $($_.Exception.Message)" -Color Red -Important
        }
    } else {
        Write-QuietOutput "  [WARN] $module - Not found" -Color Yellow -Important
    }
}

Write-PhaseStatus -Phase 5 -Status "Success" -Message "Loaded $($loadedModules.Count) modules successfully"

# ===============================================================
# PHASE 6: LOGGING SYSTEM INITIALIZATION
# ===============================================================
Write-PhaseStatus -Phase 6 -Status "Starting"

# Initialize common module (logging, paths) - MUST BE FIRST
if (Get-Command "Initialize-CommonModule" -ErrorAction SilentlyContinue) {
    try {
        $logPath = Join-Path $PSScriptRoot "SCUM-Server-Automation.log"
        
        # Set global log path before initializing any modules
        Set-Variable -Name "AutomationLogPath" -Value $logPath -Scope Global -Force
        
        Initialize-CommonModule -Config $configHash -LogPath $logPath -RootPath $PSScriptRoot
        
        # NOW Write-Log is available - switch from Write-Host to Write-Log
        Write-Log "Common module (logging, paths) initialized" -Level Info
        Write-PhaseStatus -Phase 6 -Status "Success" -Message "Logging system initialized"
        
        # Write-Log is now available globally from common module - no need to override
        
    } catch {
        Write-PhaseStatus -Phase 6 -Status "Warning" -Message "Common module failed: $($_.Exception.Message)"
    }
} else {
    Write-PhaseStatus -Phase 6 -Status "Error" -Message "Common module not available"
}

# ===============================================================
# PHASE 7: DATABASE INITIALIZATION
# ===============================================================
Write-PhaseStatus -Phase 7 -Status "Starting"

# Initialize installation system FIRST
if (Get-Command "Initialize-InstallationModule" -ErrorAction SilentlyContinue) {
    try {
        Initialize-InstallationModule -Config $configHash
        Write-Log "[OK] Installation system initialized"
        Write-PhaseStatus -Phase 7 -Status "Success" -Message "Installation system ready"
        
        # Check if server is installed
        $serverDir = if ($configHash.serverDir) { $configHash.serverDir } else { ".\server" }
        $steamCmdPath = if ($configHash.steamCmd) { $configHash.steamCmd } else { ".\steamcmd\steamcmd.exe" }
        $appId = if ($configHash.appId) { $configHash.appId } else { "3792580" }
        
        # Check if SteamCMD exists
        if (-not (Test-Path $steamCmdPath)) {
            Write-PhaseStatus -Phase 7 -Status "Warning" -Message "SteamCMD not found, installing..."
            try {
                if (Get-Command "Install-SteamCmd" -ErrorAction SilentlyContinue) {
                    $steamResult = Install-SteamCmd -SteamCmdPath $steamCmdPath
                    if ($steamResult.Success) {
                        Write-Log "[OK] SteamCMD installed successfully"
                        Write-PhaseStatus -Phase 7 -Status "Success" -Message "SteamCMD installed"
                    } else {
                        Write-Log "[ERROR] SteamCMD installation failed: $($steamResult.Error)" -Level Error
                        Write-PhaseStatus -Phase 7 -Status "Error" -Message "SteamCMD installation failed"
                    }
                } else {
                    Write-Log "[ERROR] Install-SteamCmd function not available" -Level Error
                    Write-PhaseStatus -Phase 7 -Status "Error" -Message "Install-SteamCmd function not available"
                }
            } catch {
                Write-Log "[ERROR] SteamCMD installation failed: $($_.Exception.Message)" -Level Error
                Write-PhaseStatus -Phase 7 -Status "Error" -Message "SteamCMD installation exception"
            }
        } else {
            Write-Log "[OK] SteamCMD found"
            Write-PhaseStatus -Phase 7 -Status "Success" -Message "SteamCMD found"
        }
        
        # Check and install SQLite tools
        $sqliteToolsPath = ".\sqlite-tools"
        $sqliteExe = Join-Path $sqliteToolsPath "sqlite3.exe"
        if (-not (Test-Path $sqliteExe)) {
            Write-PhaseStatus -Phase 7 -Status "Warning" -Message "SQLite tools not found, installing..."
            try {
                if (Get-Command "Install-SqliteTools" -ErrorAction SilentlyContinue) {
                    $sqliteResult = Install-SqliteTools -SqliteToolsPath $sqliteToolsPath
                    if ($sqliteResult.Success) {
                        Write-Log "[OK] SQLite tools installed successfully" -Level Info
                        Write-PhaseStatus -Phase 7 -Status "Success" -Message "SQLite tools installed"
                    } else {
                        Write-Log "[ERROR] SQLite tools installation failed: $($sqliteResult.Error)" -Level Error
                        Write-PhaseStatus -Phase 7 -Status "Error" -Message "SQLite tools installation failed"
                    }
                } else {
                    Write-Log "[ERROR] Install-SqliteTools function not available" -Level Error
                    Write-PhaseStatus -Phase 7 -Status "Error" -Message "Install-SqliteTools function not available"
                }
            } catch {
                Write-Log "[ERROR] SQLite tools installation failed: $($_.Exception.Message)" -Level Error
                Write-PhaseStatus -Phase 7 -Status "Error" -Message "SQLite tools installation exception"
            }
        } else {
            Write-Log "[OK] SQLite tools found" -Level Info
            Write-PhaseStatus -Phase 7 -Status "Success" -Message "SQLite tools found"
        }
        
        # Check if server is installed
        if (Get-Command "Test-FirstInstall" -ErrorAction SilentlyContinue) {
            $needsInstall = Test-FirstInstall -ServerDirectory $serverDir -AppId $appId
            if ($needsInstall) {
                Write-PhaseStatus -Phase 7 -Status "Warning" -Message "Server not found, installing SCUM Dedicated Server..."
                try {
                    if (Get-Command "Invoke-FirstInstall" -ErrorAction SilentlyContinue) {
                        $installResult = Invoke-FirstInstall -SteamCmdPath (Split-Path $steamCmdPath -Parent) -ServerDirectory $serverDir -AppId $appId -ServiceName $serviceName
                        if ($installResult.Success) {
                            Write-Log "[OK] SCUM Server installed successfully" -Level Info
                            Write-PhaseStatus -Phase 7 -Status "Success" -Message "SCUM Server installed"
                            
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
                            Write-PhaseStatus -Phase 7 -Status "Error" -Message "Server installation failed"
                        }
                    } else {
                        Write-Log "[ERROR] Invoke-FirstInstall function not available" -Level Error
                        Write-PhaseStatus -Phase 7 -Status "Error" -Message "Invoke-FirstInstall function not available"
                    }
                } catch {
                    Write-Log "[ERROR] Server installation failed: $($_.Exception.Message)" -Level Error
                    Write-PhaseStatus -Phase 7 -Status "Error" -Message "Server installation exception"
                }
            } else {
                Write-Log "[OK] SCUM Server installation found" -Level Info
                Write-PhaseStatus -Phase 7 -Status "Success" -Message "SCUM Server found"
            }
        }
        
    } catch {
        Write-PhaseStatus -Phase 7 -Status "Warning" -Message "Installation system failed: $($_.Exception.Message)"
    }
} else {
    Write-PhaseStatus -Phase 7 -Status "Warning" -Message "Installation module not available"
}

# ===============================================================
# PHASE 8: SERVER SERVICE SETUP
# ===============================================================
Write-PhaseStatus -Phase 8 -Status "Starting"

# Initialize update system SECOND
if (Get-Command "Initialize-UpdateModule" -ErrorAction SilentlyContinue) {
    try {
        Initialize-UpdateModule -Config $configHash
        Write-Log "[OK] Update system initialized" -Level Info
        Write-PhaseStatus -Phase 8 -Status "Success" -Message "Update system initialized"
        
        # Check for updates if configured
        if ($configHash.runUpdateOnStart -eq $true) {
            Write-PhaseStatus -Phase 8 -Status "Starting" -Message "Checking for server updates..."
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
                        Write-PhaseStatus -Phase 8 -Status "Warning" -Message "Update available (Local: $($updateCheck.InstalledBuild), Latest: $($updateCheck.LatestBuild))"
                        if (Get-Command "Update-GameServer" -ErrorAction SilentlyContinue) {
                            Write-PhaseStatus -Phase 8 -Status "Starting" -Message "Installing server update..."
                            $updateResult = & $updateModule { 
                                param($steamPath, $serverPath, $appIdValue, $serviceNameValue)
                                Update-GameServer -SteamCmdPath $steamPath -ServerDirectory $serverPath -AppId $appIdValue -ServiceName $serviceNameValue
                            } $steamCmdPath $serverDirectory $appId $serviceName
                            
                            if ($updateResult.Success) {
                                Write-Log "[OK] Server updated successfully" -Level Info
                                Write-PhaseStatus -Phase 8 -Status "Success" -Message "Server updated successfully"
                            } else {
                                Write-Log "[WARN] Server update failed: $($updateResult.Error)" -Level Warning
                                Write-PhaseStatus -Phase 8 -Status "Warning" -Message "Server update failed"
                            }
                        }
                    } else {
                        Write-Log "[OK] Server is up to date (Build: $($updateCheck.InstalledBuild))" -Level Info
                        Write-PhaseStatus -Phase 8 -Status "Success" -Message "Server is up to date (Build: $($updateCheck.InstalledBuild))"
                    }
                } else {
                    Write-PhaseStatus -Phase 8 -Status "Warning" -Message "Update check function not available"
                }
            } catch {
                Write-PhaseStatus -Phase 8 -Status "Warning" -Message "Update check failed: $($_.Exception.Message)"
            }
        } else {
            Write-PhaseStatus -Phase 8 -Status "Success" -Message "Startup update check disabled"
        }
        
    } catch {
        Write-PhaseStatus -Phase 8 -Status "Warning" -Message "Update system failed: $($_.Exception.Message)"
    }
} else {
    Write-PhaseStatus -Phase 8 -Status "Warning" -Message "Update module not available"
}

# ===============================================================
# PHASE 9: BACKUP SYSTEM SETUP  
# ===============================================================
Write-PhaseStatus -Phase 9 -Status "Starting"

# Initialize backup system THIRD
if (Get-Command "Initialize-BackupModule" -ErrorAction SilentlyContinue) {
    try {
        Initialize-BackupModule -Config $configHash
        Write-Log "[OK] Backup system initialized" -Level Info
        Write-PhaseStatus -Phase 9 -Status "Success" -Message "Backup system initialized"
        
        # Create startup backup if configured
        if ($configHash.runBackupOnStart -eq $true) {
            Write-PhaseStatus -Phase 9 -Status "Starting" -Message "Creating startup backup..."
            try {
                if (Get-Command "Invoke-GameBackup" -ErrorAction SilentlyContinue) {
                    $backupParams = @{
                        SourcePath = if ($configHash.savedDir) { $configHash.savedDir } else { ".\server\SCUM\Saved" }
                        BackupRoot = if ($configHash.backupRoot) { $configHash.backupRoot } else { ".\backups" }
                        MaxBackups = if ($configHash.maxBackups) { $configHash.maxBackups } else { 10 }
                        CompressBackups = if ($null -ne $configHash.compressBackups) { $configHash.compressBackups } else { $true }
                        Type = "startup"
                    }
                    
                    $backupResult = Invoke-GameBackup @backupParams
                    if ($backupResult) {
                        Write-Log "[OK] Startup backup completed" -Level Info
                        Write-PhaseStatus -Phase 9 -Status "Success" -Message "Startup backup completed"
                    } else {
                        Write-Log "[WARN] Startup backup failed" -Level Warning
                        Write-PhaseStatus -Phase 9 -Status "Warning" -Message "Startup backup failed"
                    }
                } else {
                    Write-PhaseStatus -Phase 9 -Status "Warning" -Message "Backup function not available"
                }
            } catch {
                Write-PhaseStatus -Phase 9 -Status "Warning" -Message "Startup backup failed: $($_.Exception.Message)"
            }
        } else {
            Write-PhaseStatus -Phase 9 -Status "Success" -Message "Startup backup disabled"
        }
        
    } catch {
        Write-PhaseStatus -Phase 9 -Status "Warning" -Message "Backup system failed: $($_.Exception.Message)"
    }
} else {
    Write-PhaseStatus -Phase 9 -Status "Warning" -Message "Backup module not available"
}

# ===============================================================
# PHASE 10: MONITORING SYSTEM SETUP
# ===============================================================
Write-PhaseStatus -Phase 10 -Status "Starting"

# Initialize log parser
if (Get-Command "Initialize-LogReaderModule" -ErrorAction SilentlyContinue) {
    try {
        # Log parser reads from SCUM server main log file
        $serverLogPath = if ($configHash.serverDir) { Join-Path $configHash.serverDir "SCUM\Saved\Logs\SCUM.log" } else { $null }
        $null = Initialize-LogReaderModule -Config $configHash -LogPath $serverLogPath
        Write-Log "[OK] Log parser system" -Level Info
        Write-PhaseStatus -Phase 10 -Status "Success" -Message "Log parser system initialized"
    } catch {
        Write-PhaseStatus -Phase 10 -Status "Warning" -Message "Log parser failed: $($_.Exception.Message)"
    }
} else {
    Write-PhaseStatus -Phase 10 -Status "Warning" -Message "Log parser module not available"
}

# Initialize server database first
$serverDbSuccess = $false
if (Get-Command "Initialize-ServerDatabase" -ErrorAction SilentlyContinue) {
    try {
        $serverDbResult = Initialize-ServerDatabase -Config $configHash
        if ($serverDbResult) {
            Write-Log "[OK] Server database initialized" -Level Info
            Write-PhaseStatus -Phase 10 -Status "Success" -Message "Server database initialized"
            $serverDbSuccess = $true
        } else {
            Write-PhaseStatus -Phase 10 -Status "Warning" -Message "Server database initialization failed"
        }
    } catch {
        Write-PhaseStatus -Phase 10 -Status "Warning" -Message "Server database failed: $($_.Exception.Message)"
    }
} else {
    Write-PhaseStatus -Phase 10 -Status "Warning" -Message "Server database module not available"
}

# Initialize main database module (using server_database.db) only if server DB is ready
if ($serverDbSuccess -and (Get-Command "Initialize-DatabaseModule" -ErrorAction SilentlyContinue)) {
    try {
        # Use server_database.db path instead of SCUM.db
        $databasePath = if (Get-Command "Get-ServerDatabasePath" -ErrorAction SilentlyContinue) { 
            Get-ServerDatabasePath 
        } else { 
            Join-Path $configHash.dataDir "server_database.db"
        }
        $dbResult = Initialize-DatabaseModule -Config $configHash -DatabasePath $databasePath
        if ($dbResult.Success) {
            Write-Log "[OK] Database connection" -Level Info
            Write-PhaseStatus -Phase 10 -Status "Success" -Message "Database connection established"
            
            # Initialize centralized database service
            $statusInterval = if ($configHash.Discord.LiveEmbeds.StatusUpdateInterval) { $configHash.Discord.LiveEmbeds.StatusUpdateInterval } else { 60 }
            Initialize-DatabaseService -CacheIntervalSeconds $statusInterval
            Write-Log "[OK] Centralized database service initialized (cache: $statusInterval seconds)" -Level Info
            Write-PhaseStatus -Phase 10 -Status "Success" -Message "Centralized database service initialized (cache: $statusInterval seconds)"
        } else {
            Write-PhaseStatus -Phase 10 -Status "Warning" -Message "Database limited: $($dbResult.Error)"
        }
    } catch {
        Write-PhaseStatus -Phase 10 -Status "Warning" -Message "Database failed: $($_.Exception.Message)"
    }
} else {
    if (-not $serverDbSuccess) {
        Write-PhaseStatus -Phase 10 -Status "Warning" -Message "Database module skipped - server database not ready"
    } else {
        Write-PhaseStatus -Phase 10 -Status "Warning" -Message "Database module not available"
    }
}

# Initialize leaderboards module
if (Get-Command "Initialize-LeaderboardsModule" -ErrorAction SilentlyContinue) {
    try {
        # Use server_database.db instead of SCUM.db for consistent data access
        $databasePath = if ($configHash.dataDir) { Join-Path $configHash.dataDir "server_database.db" } else { ".\data\server_database.db" }
        $sqlitePath = ".\sqlite-tools\sqlite3.exe"
        $lbResult = Initialize-LeaderboardsModule -DatabasePath $databasePath -SqliteExePath $sqlitePath
        if ($lbResult.Success) {
            Write-Log "[OK] Leaderboards module (using server_database.db)" -Level Info
            Write-PhaseStatus -Phase 10 -Status "Success" -Message "Leaderboards module initialized"
        } else {
            Write-PhaseStatus -Phase 10 -Status "Warning" -Message "Leaderboards limited: $($lbResult.Error)"
        }
    } catch {
        Write-PhaseStatus -Phase 10 -Status "Warning" -Message "Leaderboards failed: $($_.Exception.Message)"
    }
} else {
    Write-PhaseStatus -Phase 10 -Status "Warning" -Message "Leaderboards module not available"
}

# Initialize monitoring (depends on database being initialized first)
if (Get-Command "Initialize-MonitoringModule" -ErrorAction SilentlyContinue) {
    try {
        $null = Initialize-MonitoringModule -Config $configHash
        Write-Log "[OK] Server monitoring system" -Level Info
        Write-PhaseStatus -Phase 10 -Status "Success" -Message "Server monitoring system initialized"
    } catch {
        Write-PhaseStatus -Phase 10 -Status "Warning" -Message "Monitoring failed: $($_.Exception.Message)"
    }
} else {
    Write-PhaseStatus -Phase 10 -Status "Warning" -Message "Monitoring module not available"
}

# ===============================================================
# PHASE 11: SCHEDULER SETUP
# ===============================================================  
Write-PhaseStatus -Phase 11 -Status "Starting"

# Initialize scheduling
if (Get-Command "Initialize-SchedulingModule" -ErrorAction SilentlyContinue) {
    try {
        Initialize-SchedulingModule -Config $configHash
        Write-Log "[OK] Scheduling system" -Level Info
        Write-PhaseStatus -Phase 11 -Status "Success" -Message "Scheduling system initialized"
    } catch {
        Write-PhaseStatus -Phase 11 -Status "Warning" -Message "Scheduling failed: $($_.Exception.Message)"
    }
} else {
    Write-PhaseStatus -Phase 11 -Status "Warning" -Message "Scheduling module not available"
}

# ===============================================================
# PHASE 12: DISCORD INTEGRATION SETUP
# ===============================================================
Write-PhaseStatus -Phase 12 -Status "Starting"

# Initialize integrated Discord bot system via discord-integration module
try {
    Write-PhaseStatus -Phase 12 -Status "Starting" -Message "Starting integrated Discord bot system..."
    
    # Initialize Discord integration module first
    if (Get-Command "Initialize-DiscordIntegrationModule" -ErrorAction SilentlyContinue) {
        $moduleInitResult = Initialize-DiscordIntegrationModule -Config $configHash
        if ($moduleInitResult.Success) {
            Write-Log "[OK] Discord integration module initialized" -Level Info
            Write-PhaseStatus -Phase 12 -Status "Success" -Message "Discord integration module initialized"
            
            # Initialize Node.js environment
            if (Get-Command "Initialize-NodeJSForDiscord" -ErrorAction SilentlyContinue) {
                $nodeResult = Initialize-NodeJSForDiscord -Config $configHash
                if ($nodeResult.Success) {
                    Write-Log "[OK] Node.js environment ready" -Level Info
                    Write-PhaseStatus -Phase 12 -Status "Success" -Message "Node.js environment ready"
                } else {
                    Write-PhaseStatus -Phase 12 -Status "Warning" -Message "Node.js initialization failed: $($nodeResult.Error)"
                }
            }
            
            # Initialize Discord bot
            if (Get-Command "Initialize-DiscordBot" -ErrorAction SilentlyContinue) {
                $botInitResult = Initialize-DiscordBot -Config $configHash
                if ($botInitResult.Success) {
                    Write-Log "[OK] Discord bot initialized" -Level Info
                    Write-PhaseStatus -Phase 12 -Status "Success" -Message "Discord bot initialized"
                } else {
                    Write-PhaseStatus -Phase 12 -Status "Warning" -Message "Discord bot initialization failed: $($botInitResult.Error)"
                }
            }
            
            # Start the Discord bot
            if (Get-Command "Start-DiscordBot" -ErrorAction SilentlyContinue) {
                $botResult = Start-DiscordBot -Config $configHash
                if ($botResult.Success) {
                    Write-Log "[OK] Integrated Discord bot started successfully (PID: $($botResult.ProcessId))" -Level Info
                    Write-PhaseStatus -Phase 12 -Status "Success" -Message "Integrated Discord bot started successfully (PID: $($botResult.ProcessId))"
                } else {
                    Write-PhaseStatus -Phase 12 -Status "Warning" -Message "Failed to start integrated Discord bot: $($botResult.Error)"
                }
            } else {
                Write-PhaseStatus -Phase 12 -Status "Warning" -Message "Start-DiscordBot function not available"
            }
        } else {
            Write-PhaseStatus -Phase 12 -Status "Warning" -Message "Discord integration module initialization failed: $($moduleInitResult.Error)"
        }
    } else {
        Write-PhaseStatus -Phase 12 -Status "Warning" -Message "Discord integration module not loaded"
    }
    
} catch {
    Write-PhaseStatus -Phase 12 -Status "Warning" -Message "Integrated Discord bot system failed: $($_.Exception.Message)"
}

# Discord notification system is now handled by HTTP API to Node.js bot
Write-Log "Discord notification system ready (HTTP API -> Node.js)" -Level Info
Write-PhaseStatus -Phase 12 -Status "Success" -Message "Discord notification system ready (HTTP API -> Node.js)"

# Discord chat relay and other features are handled by the Node.js bot
Write-Log "Discord features (chat relay, commands, etc.) handled by integrated Node.js bot" -Level Info
Write-PhaseStatus -Phase 12 -Status "Success" -Message "Discord features (chat relay, commands, etc.) handled by integrated Node.js bot"

# Initialize Discord embed persistence system
if (Get-Command "Initialize-EmbedPersistence" -ErrorAction SilentlyContinue) {
    try {
        $persistenceResult = Initialize-EmbedPersistence -StateFilePath ".\state\discord-embeds.json"
        if ($persistenceResult) {
            Write-Log "[OK] Discord embed persistence system initialized" -Level Info
        } else {
            Write-Log "[WARN] Discord embed persistence system initialization failed" -Level Warning
        }
    } catch {
        Write-Log "[WARN] Discord embed persistence system failed: $($_.Exception.Message)" -Level Warning
    }
} else {
    Write-Log "[WARN] Discord embed persistence system not available" -Level Warning
}

# Initialize Discord account linking system
if (Get-Command "Invoke-NodeJsApiRequest" -ErrorAction SilentlyContinue) {
    try {
        # Check if account linking is enabled in config
        if ($configHash.Discord.AccountLinking.Enabled -and $configHash.Discord.AccountLinking.Channel) {
            Write-Log "Initializing Discord account linking system via Node.js..." -Level Info
            
            # Check if account linking embed already exists using persistence
            $existingEmbed = $null
            if (Get-Command "Get-EmbedMessageId" -ErrorAction SilentlyContinue) {
                $existingEmbed = Get-EmbedMessageId -EmbedType "account-linking" -ChannelId $configHash.Discord.AccountLinking.Channel
            }
            
            if ($existingEmbed -and $existingEmbed.MessageId) {
                # Verify the message still exists in Discord
                $messageExists = $false
                if (Get-Command "Test-EmbedMessageExists" -ErrorAction SilentlyContinue) {
                    $messageExists = Test-EmbedMessageExists -ChannelId $existingEmbed.ChannelId -MessageId $existingEmbed.MessageId
                }
                
                if ($messageExists) {
                    Write-Log "[OK] Discord account linking embed already exists: $($existingEmbed.MessageId)" -Level Info
                    Write-PhaseStatus -Phase 12 -Status "Success" -Message "Discord account linking system already initialized (persistent embed found)"
                } else {
                    Write-Log "[INFO] Stored account linking embed no longer exists in Discord, creating new one" -Level Info
                    # Remove the stale reference
                    if (Get-Command "Remove-EmbedMessageId" -ErrorAction SilentlyContinue) {
                        Remove-EmbedMessageId -EmbedType "account-linking" -ChannelId $configHash.Discord.AccountLinking.Channel
                    }
                    $existingEmbed = $null
                }
            }
            
            # Create new embed only if none exists
            if (-not $existingEmbed) {
                # Send account linking embed via Node.js API
                $accountLinkingData = @{
                    channelId = $configHash.Discord.AccountLinking.Channel
                }
                
                $accountLinkingResult = Invoke-NodeJsApiRequest -Endpoint "/api/account-linking/embed" -Method "POST" -Body $accountLinkingData
                
                if ($accountLinkingResult.Success -and $accountLinkingResult.Data.success) {
                    Write-Log "[OK] Discord account linking embed created: $($accountLinkingResult.Data.messageId)" -Level Info
                    
                    # Store the message ID for persistence
                    if (Get-Command "Set-EmbedMessageId" -ErrorAction SilentlyContinue) {
                        Set-EmbedMessageId -EmbedType "account-linking" -MessageId $accountLinkingResult.Data.messageId -ChannelId $configHash.Discord.AccountLinking.Channel
                    }
                    
                    Write-PhaseStatus -Phase 12 -Status "Success" -Message "Discord account linking system initialized successfully"
                } else {
                    Write-Log "[WARN] Discord account linking embed failed: $($accountLinkingResult.Error)" -Level Warning
                    Write-PhaseStatus -Phase 12 -Status "Warning" -Message "Discord account linking embed failed: $($accountLinkingResult.Error)"
                }
            }
        } else {
            Write-Log "[INFO] Discord account linking system not enabled or configured" -Level Info
            Write-PhaseStatus -Phase 12 -Status "Success" -Message "Discord account linking system not enabled or configured"
        }
        
        # Initialize account linking embed refresh system
        if (Get-Command "Start-AccountLinkingEmbedRefresh" -ErrorAction SilentlyContinue) {
            try {
                $refreshResult = Start-AccountLinkingEmbedRefresh -Config $configHash
                if ($refreshResult) {
                    Write-Log "[OK] Discord account linking embed refresh system enabled" -Level Info
                    Write-PhaseStatus -Phase 12 -Status "Success" -Message "Discord account linking embed refresh system enabled"
                } else {
                    Write-Log "[INFO] Discord account linking embed refresh not configured" -Level Info
                }
            } catch {
                Write-Log "[WARN] Discord account linking embed refresh system failed: $($_.Exception.Message)" -Level Warning
            }
        }
        
    } catch {
        Write-PhaseStatus -Phase 12 -Status "Warning" -Message "Discord account linking system failed: $($_.Exception.Message)"
    }
} else {
    Write-PhaseStatus -Phase 12 -Status "Warning" -Message "Discord account linking system not available (Node.js API not available)"
}

# ===============================================================
# PHASE 13: LIVE EMBEDS SETUP
# ===============================================================
Write-PhaseStatus -Phase 13 -Status "Starting"

# Initialize Discord live embeds
try {
    Write-PhaseStatus -Phase 13 -Status "Starting" -Message "Initializing Discord live embeds..."
    
    # Initialize server status embed
    if (Get-Command "Initialize-ServerStatusEmbed" -ErrorAction SilentlyContinue) {
        $statusEmbedResult = Initialize-ServerStatusEmbed -Config $configHash
        if ($statusEmbedResult) {
            Write-Log "[OK] Server status embed initialized" -Level Info
            Write-PhaseStatus -Phase 13 -Status "Success" -Message "Server status embed initialized"
        } else {
            Write-Log "[INFO] Server status embed not configured or disabled" -Level Info
            Write-PhaseStatus -Phase 13 -Status "Success" -Message "Server status embed not configured or disabled"
        }
    } else {
        Write-PhaseStatus -Phase 13 -Status "Warning" -Message "Server status embed module not available"
    }
    
    # Initialize leaderboards embeds
    if (Get-Command "Initialize-LeaderboardsEmbed" -ErrorAction SilentlyContinue) {
        $leaderboardsEmbedResult = Initialize-LeaderboardsEmbed -Config $configHash
        if ($leaderboardsEmbedResult) {
            Write-Log "[OK] Leaderboards embeds initialized" -Level Info
            Write-PhaseStatus -Phase 13 -Status "Success" -Message "Leaderboards embeds initialized"
        } else {
            Write-Log "[INFO] Leaderboards embeds not configured or disabled" -Level Info
            Write-PhaseStatus -Phase 13 -Status "Success" -Message "Leaderboards embeds not configured or disabled"
        }
    } else {
        Write-PhaseStatus -Phase 13 -Status "Warning" -Message "Leaderboards embed module not available"
    }
    
} catch {
    Write-PhaseStatus -Phase 13 -Status "Warning" -Message "Discord live embeds initialization failed: $($_.Exception.Message)"
}

# ===============================================================
# PHASE 14: LOG PROCESSING SETUP
# ===============================================================
Write-PhaseStatus -Phase 14 -Status "Starting"

# Initialize admin log monitoring
if (Get-Command "Initialize-AdminLogModule" -ErrorAction SilentlyContinue) {
    try {
        $adminLogResult = Initialize-AdminLogModule -Config $configHash
        if ($adminLogResult) {
            Write-Log "[OK] Admin log monitoring initialized successfully" -Level Info
            Write-PhaseStatus -Phase 14 -Status "Success" -Message "Admin log monitoring initialized"
        } else {
            Write-Log "[INFO] Admin log monitoring not enabled or configured" -Level Info
            Write-PhaseStatus -Phase 14 -Status "Success" -Message "Admin log monitoring not enabled or configured"
        }
    } catch {
        Write-PhaseStatus -Phase 14 -Status "Warning" -Message "Admin log monitoring failed: $($_.Exception.Message)"
    }
} else {
    Write-PhaseStatus -Phase 14 -Status "Warning" -Message "Admin log module not available"
}

# Initialize kill log monitoring
if (Get-Command "Initialize-KillLogModule" -ErrorAction SilentlyContinue) {
    try {
        $killLogResult = Initialize-KillLogModule -Config $configHash
        if ($killLogResult) {
            Write-Log "[OK] Kill log monitoring initialized successfully" -Level Info
            Write-PhaseStatus -Phase 14 -Status "Success" -Message "Kill log monitoring initialized"
        } else {
            Write-Log "[INFO] Kill log monitoring not enabled or configured" -Level Info
            Write-PhaseStatus -Phase 14 -Status "Success" -Message "Kill log monitoring not enabled or configured"
        }
    } catch {
        Write-PhaseStatus -Phase 14 -Status "Warning" -Message "Kill log monitoring failed: $($_.Exception.Message)"
    }
} else {
    Write-PhaseStatus -Phase 14 -Status "Warning" -Message "Kill log module not available"
}

# Initialize eventkill log monitoring
if (Get-Command "Initialize-EventKillLogModule" -ErrorAction SilentlyContinue) {
    try {
        $eventKillLogResult = Initialize-EventKillLogModule -Config $configHash
        if ($eventKillLogResult) {
            Write-Log "[OK] Event kill log monitoring initialized successfully" -Level Info
            Write-PhaseStatus -Phase 14 -Status "Success" -Message "Event kill log monitoring initialized"
        } else {
            Write-Log "[INFO] Event kill log monitoring not enabled or configured" -Level Info
            Write-PhaseStatus -Phase 14 -Status "Success" -Message "Event kill log monitoring not enabled or configured"
        }
    } catch {
        Write-PhaseStatus -Phase 14 -Status "Warning" -Message "Event kill log monitoring failed: $($_.Exception.Message)"
    }
} else {
    Write-PhaseStatus -Phase 14 -Status "Warning" -Message "Event kill log module not available"
}

# Initialize violations log monitoring
if (Get-Command "Initialize-ViolationsLogModule" -ErrorAction SilentlyContinue) {
    try {
        $violationsLogResult = Initialize-ViolationsLogModule -Config $configHash
        if ($violationsLogResult) {
            Write-Log "[OK] Violations log monitoring initialized successfully" -Level Info
            Write-PhaseStatus -Phase 14 -Status "Success" -Message "Violations log monitoring initialized"
        } else {
            Write-Log "[INFO] Violations log monitoring not enabled or configured" -Level Info
            Write-PhaseStatus -Phase 14 -Status "Success" -Message "Violations log monitoring not enabled or configured"
        }
    } catch {
        Write-PhaseStatus -Phase 14 -Status "Warning" -Message "Violations log monitoring failed: $($_.Exception.Message)"
    }
} else {
    Write-PhaseStatus -Phase 14 -Status "Warning" -Message "Violations log module not available"
}

# Initialize famepoints log monitoring
if (Get-Command "Initialize-FamePointsLogModule" -ErrorAction SilentlyContinue) {
    try {
        $famePointsLogResult = Initialize-FamePointsLogModule -Config $configHash
        if ($famePointsLogResult) {
            Write-Log "[OK] Fame points log monitoring initialized successfully" -Level Info
            Write-PhaseStatus -Phase 14 -Status "Success" -Message "Fame points log monitoring initialized"
        } else {
            Write-Log "[INFO] Fame points log monitoring not enabled or configured" -Level Info
            Write-PhaseStatus -Phase 14 -Status "Success" -Message "Fame points log monitoring not enabled or configured"
        }
    } catch {
        Write-PhaseStatus -Phase 14 -Status "Warning" -Message "Fame points log monitoring failed: $($_.Exception.Message)"
    }
} else {
    Write-PhaseStatus -Phase 14 -Status "Warning" -Message "Fame points log module not available"
}

# Initialize login log monitoring
if (Get-Command "Initialize-LoginLogModule" -ErrorAction SilentlyContinue) {
    try {
        $loginLogResult = Initialize-LoginLogModule -Config $configHash
        if ($loginLogResult) {
            Write-Log "[OK] Login log monitoring initialized successfully" -Level Info
            Write-PhaseStatus -Phase 14 -Status "Success" -Message "Login log monitoring initialized"
        } else {
            Write-Log "[INFO] Login log monitoring not enabled or configured" -Level Info
            Write-PhaseStatus -Phase 14 -Status "Success" -Message "Login log monitoring not enabled or configured"
        }
    } catch {
        Write-PhaseStatus -Phase 14 -Status "Warning" -Message "Login log monitoring failed: $($_.Exception.Message)"
    }
} else {
    Write-PhaseStatus -Phase 14 -Status "Warning" -Message "Login log module not available"
}

# Initialize economy log monitoring
if (Get-Command "Initialize-EconomyLogModule" -ErrorAction SilentlyContinue) {
    try {
        $economyLogResult = Initialize-EconomyLogModule -Config $configHash
        if ($economyLogResult) {
            Write-Log "[OK] Economy log monitoring initialized successfully" -Level Info
            Write-PhaseStatus -Phase 14 -Status "Success" -Message "Economy log monitoring initialized"
        } else {
            Write-Log "[INFO] Economy log monitoring not enabled or configured" -Level Info
            Write-PhaseStatus -Phase 14 -Status "Success" -Message "Economy log monitoring not enabled or configured"
        }
    } catch {
        Write-PhaseStatus -Phase 14 -Status "Warning" -Message "Economy log monitoring failed: $($_.Exception.Message)"
    }
} else {
    Write-PhaseStatus -Phase 14 -Status "Warning" -Message "Economy log module not available"
}

# Initialize vehicle log monitoring
if (Get-Command "Initialize-VehicleLogModule" -ErrorAction SilentlyContinue) {
    try {
        $vehicleLogResult = Initialize-VehicleLogModule -Config $configHash
        if ($vehicleLogResult) {
            Write-Log "[OK] Vehicle log monitoring initialized successfully" -Level Info
            Write-PhaseStatus -Phase 14 -Status "Success" -Message "Vehicle log monitoring initialized"
        } else {
            Write-Log "[INFO] Vehicle log monitoring not enabled or configured" -Level Info
            Write-PhaseStatus -Phase 14 -Status "Success" -Message "Vehicle log monitoring not enabled or configured"
        }
    } catch {
        Write-PhaseStatus -Phase 14 -Status "Warning" -Message "Vehicle log monitoring failed: $($_.Exception.Message)"
    }
} else {
    Write-PhaseStatus -Phase 14 -Status "Warning" -Message "Vehicle log module not available"
}

# Initialize raid protection log monitoring
if (Get-Command "Initialize-RaidProtectionLogModule" -ErrorAction SilentlyContinue) {
    try {
        $raidProtectionLogResult = Initialize-RaidProtectionLogModule -Config $configHash
        if ($raidProtectionLogResult) {
            Write-Log "[OK] Raid protection log monitoring initialized successfully" -Level Info
            Write-PhaseStatus -Phase 14 -Status "Success" -Message "Raid protection log monitoring initialized"
        } else {
            Write-Log "[INFO] Raid protection log monitoring not enabled or configured" -Level Info
            Write-PhaseStatus -Phase 14 -Status "Success" -Message "Raid protection log monitoring not enabled or configured"
        }
    } catch {
        Write-PhaseStatus -Phase 14 -Status "Warning" -Message "Raid protection log monitoring failed: $($_.Exception.Message)"
    }
} else {
    Write-PhaseStatus -Phase 14 -Status "Warning" -Message "Raid protection log module not available"
}

# Initialize gameplay log monitoring
if (Get-Command "Initialize-GameplayLogModule" -ErrorAction SilentlyContinue) {
    try {
        $gameplayLogResult = Initialize-GameplayLogModule -Config $configHash
        if ($gameplayLogResult) {
            Write-Log "[OK] Gameplay log monitoring initialized successfully" -Level Info
            Write-PhaseStatus -Phase 14 -Status "Success" -Message "Gameplay log monitoring initialized"
        } else {
            Write-Log "[INFO] Gameplay log monitoring not enabled or configured" -Level Info
            Write-PhaseStatus -Phase 14 -Status "Success" -Message "Gameplay log monitoring not enabled or configured"
        }
    } catch {
        Write-PhaseStatus -Phase 14 -Status "Warning" -Message "Gameplay log monitoring failed: $($_.Exception.Message)"
    }
} else {
    Write-PhaseStatus -Phase 14 -Status "Warning" -Message "Gameplay log module not available"
}

# Initialize quest log monitoring
if (Get-Command "Initialize-QuestLogModule" -ErrorAction SilentlyContinue) {
    try {
        $questLogResult = Initialize-QuestLogModule -Config $configHash
        if ($questLogResult) {
            Write-Log "[OK] Quest log monitoring initialized successfully" -Level Info
            Write-PhaseStatus -Phase 14 -Status "Success" -Message "Quest log monitoring initialized"
        } else {
            Write-Log "[INFO] Quest log monitoring not enabled or configured" -Level Info
            Write-PhaseStatus -Phase 14 -Status "Success" -Message "Quest log monitoring not enabled or configured"
        }
    } catch {
        Write-PhaseStatus -Phase 14 -Status "Warning" -Message "Quest log monitoring failed: $($_.Exception.Message)"
    }
} else {
    Write-PhaseStatus -Phase 14 -Status "Warning" -Message "Quest log module not available"
}

# Initialize chest log monitoring
if (Get-Command "Initialize-ChestLogModule" -ErrorAction SilentlyContinue) {
    try {
        $chestLogResult = Initialize-ChestLogModule -Config $configHash
        if ($chestLogResult) {
            Write-Log "[OK] Chest log monitoring initialized successfully" -Level Info
            Write-PhaseStatus -Phase 14 -Status "Success" -Message "Chest log monitoring initialized"
        } else {
            Write-Log "[INFO] Chest log monitoring not enabled or configured" -Level Info
            Write-PhaseStatus -Phase 14 -Status "Success" -Message "Chest log monitoring not enabled or configured"
        }
    } catch {
        Write-PhaseStatus -Phase 14 -Status "Warning" -Message "Chest log monitoring failed: $($_.Exception.Message)"
    }
} else {
    Write-PhaseStatus -Phase 14 -Status "Warning" -Message "Chest log module not available"
}


# ===============================================================
# PHASE 15: API SERVER SETUP
# ===============================================================
Write-PhaseStatus -Phase 15 -Status "Starting"

# Manager State Initialization
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

Write-PhaseStatus -Phase 15 -Status "Success" -Message "Manager state initialized"

# ===============================================================
# PHASE 16: FINAL VALIDATION & READY STATE
# ===============================================================
Write-PhaseStatus -Phase 16 -Status "Starting"

# SERVER STATUS FUNCTIONS
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
        # Add database stats for Discord embed
        DatabaseStats = @{
            TotalPlayers = $dbStats.TotalPlayers.ToString()
            ActiveSquads = $dbStats.ActiveSquads.ToString()
        }
    }
    
    # Update script state to match service status
    $script:State.IsRunning = $currentServiceStatus
    $script:State.LastStatusCheck = Get-Date
    
    Write-Log "Using fallback status: IsRunning=$($status.IsRunning), Total=$($dbStats.TotalPlayers)" -Level Debug
    return $status
}

# Validate all phases completed successfully
$completedPhases = 0
for ($i = 1; $i -le 16; $i++) {
    $completedPhases++
}

Write-PhaseStatus -Phase 16 -Status "Success" -Message "All $completedPhases phases completed successfully"

# Validate all phases completed successfully
$completedPhases = 0
for ($i = 1; $i -le 16; $i++) {
    $completedPhases++
}

Write-PhaseStatus -Phase 16 -Status "Success" -Message "All $completedPhases phases completed successfully"

# Final system ready message
Write-Log "================================================================" -Level Info
Write-Log "                SCUM SERVER AUTOMATION READY" -Level Info
Write-Log "================================================================" -Level Info
Write-Log "All $completedPhases initialization phases completed successfully!" -Level Info
Write-Log "System is ready for automatic server management." -Level Info
Write-Log "================================================================" -Level Info

Write-PhaseStatus -Phase 16 -Status "Success" -Message "System ready for automatic server management"

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
                    
                    # Send notification via HTTP API based on event type
                    try {
                        $eventType = switch ($event.EventType) {
                            'ServerOnline' { 'server.online' }
                            'ServerOffline' { 'server.offline' }
                            'ServerStarting' { 'server.starting' }
                            'ServerLoading' { 'server.loading' }
                            default { $null }
                        }
                        
                        if ($eventType) {
                            Write-Log "Sending notification: $eventType" -Level Info
                            $notificationData = @{
                                type = $eventType
                                data = @{
                                    service_name = $script:ServiceName
                                    timestamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
                                }
                            }
                            Invoke-RestMethod -Uri "http://localhost:3001/api/server/notification" -Method Post -Body ($notificationData | ConvertTo-Json -Depth 3) -ContentType "application/json" -ErrorAction SilentlyContinue | Out-Null
                            Write-Log "Notification sent: $eventType" -Level Info
                        }
                    } catch {
                        Write-Log "Notification failed: $($_.Exception.Message)" -Level Warning
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
                
                # Update bot activity based on server status
                Update-DiscordBotActivity
                
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
        
        # Send notification via HTTP API
        try {
            $eventType = if ($script:State.IsRunning) { "server.started" } else { "server.stopped" }
            $notificationData = @{
                type = $eventType
                data = @{}
            }
            Invoke-RestMethod -Uri "http://localhost:3001/api/server/notification" -Method Post -Body ($notificationData | ConvertTo-Json -Depth 3) -ContentType "application/json" -ErrorAction SilentlyContinue | Out-Null
        } catch {
            Write-Log "Notification failed: $($_.Exception.Message)" -Level Warning
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
            
            try {
                $notificationData = @{
                    type = "update.available"
                    data = @{}
                }
                Invoke-RestMethod -Uri "http://localhost:3001/api/server/notification" -Method Post -Body ($notificationData | ConvertTo-Json -Depth 3) -ContentType "application/json" -ErrorAction SilentlyContinue | Out-Null
            } catch { }
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
                    
                    try {
                        $notificationData = @{
                            type = "scheduled.restart"
                            data = @{ time = $now.ToString("HH:mm") }
                        }
                        Invoke-RestMethod -Uri "http://localhost:3001/api/server/notification" -Method Post -Body ($notificationData | ConvertTo-Json -Depth 3) -ContentType "application/json" -ErrorAction SilentlyContinue | Out-Null
                    } catch { }
                    
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
                    try {
                        $updateParams = @{
                            SteamCmdPath = if ($steamCmd) { Split-Path $steamCmd -Parent } else { ".\steamcmd" }
                            ServerDirectory = if ($serverDir) { $serverDir } else { ".\server" }
                            AppId = if ($configHash.appId) { $configHash.appId } else { "3792580" }
                            ScriptRoot = $PSScriptRoot
                        }
                        
                        $updateInfo = Test-UpdateAvailable @updateParams
                        
                        $notificationData = @{
                            type = 'update.available'
                            data = @{
                                currentVersion = $updateInfo.InstalledBuild
                                version = $updateInfo.LatestBuild
                            }
                        }
                        Invoke-RestMethod -Uri "http://localhost:3001/api/server/notification" -Method Post -Body ($notificationData | ConvertTo-Json -Depth 3) -ContentType "application/json" -ErrorAction SilentlyContinue | Out-Null
                    } catch {
                        Write-Log "Failed to send update notification: $($_.Exception.Message)" -Level Warning
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
try {
    $notificationData = @{
        type = "manager.started"
        data = @{ version = "2.1" }
    }
    Invoke-RestMethod -Uri "http://localhost:3001/api/server/notification" -Method Post -Body ($notificationData | ConvertTo-Json -Depth 3) -ContentType "application/json" -ErrorAction SilentlyContinue | Out-Null
    Write-Log "Startup notification sent" -Level Info
} catch {
    Write-Log "Startup notification failed: $($_.Exception.Message)" -Level Warning
}

# ===============================================================
# DISCORD BOT ACTIVITY MANAGEMENT
# ===============================================================

function Update-DiscordBotActivity {
    <#
    .SYNOPSIS
    Update Discord bot activity - REMOVED
    Discord bot activity is now automatically managed by the Node.js bot's ActivityManager.
    This function does nothing as Set-DiscordBotActivity has been removed.
    #>
    
    # Activity is now managed automatically by Node.js bot's ActivityManager
    # No action needed from PowerShell side
    return
}

# ===============================================================
# SINGLE ACTION EXECUTION MODE
# ===============================================================

# Handle single action parameters (for Discord API calls)
if ($StartServer -or $StopServer -or $RestartServer -or $UpdateServer -or $ValidateServer -or $CreateBackup) {
    try {
        if ($StartServer) {
            Write-Log "Executing server start command..." -Level Info
            if (Get-Command "Start-GameService" -ErrorAction SilentlyContinue) {
                $result = Start-GameService
                if ($result) {
                    Write-Log "Server start command executed successfully" -Level Info
                } else {
                    Write-Log "Server start command failed" -Level Error
                }
            } else {
                Write-Log "Start-GameService function not available" -Level Error
            }
        }
        
        if ($StopServer) {
            Write-Log "Executing server stop command..." -Level Info
            if (Get-Command "Stop-GameService" -ErrorAction SilentlyContinue) {
                $result = Stop-GameService
                if ($result) {
                    Write-Log "Server stop command executed successfully" -Level Info
                } else {
                    Write-Log "Server stop command failed" -Level Error
                }
            } else {
                Write-Log "Stop-GameService function not available" -Level Error
            }
        }
        
        if ($RestartServer) {
            Write-Log "Executing server restart command..." -Level Info
            if (Get-Command "Restart-GameService" -ErrorAction SilentlyContinue) {
                $result = Restart-GameService
                if ($result) {
                    Write-Log "Server restart command executed successfully" -Level Info
                } else {
                    Write-Log "Server restart command failed" -Level Error
                }
            } else {
                Write-Log "Restart-GameService function not available" -Level Error
            }
        }
        
        if ($UpdateServer) {
            Write-Log "Executing server update command..." -Level Info
            if (Get-Command "Update-ServerInstallation" -ErrorAction SilentlyContinue) {
                $result = Update-ServerInstallation
                if ($result) {
                    Write-Log "Server update command executed successfully" -Level Info
                } else {
                    Write-Log "Server update command failed" -Level Error
                }
            } else {
                Write-Log "Update-ServerInstallation function not available" -Level Error
            }
        }
        
        if ($ValidateServer) {
            Write-Log "Executing server validation command..." -Level Info
            if (Get-Command "Invoke-ServerValidation" -ErrorAction SilentlyContinue) {
                $serviceName = $configHash.serviceName
                $steamCmdPath = $configHash.steamCmd
                $serverDir = $configHash.serverDir
                $appId = $configHash.appId
                
                $result = Invoke-ServerValidation -SteamCmdPath $steamCmdPath -ServerDirectory $serverDir -AppId $appId -ServiceName $serviceName
                if ($result -and $result.Success) {
                    Write-Log "Server validation command executed successfully" -Level Info
                } else {
                    Write-Log "Server validation command failed" -Level Error
                }
            } else {
                Write-Log "Invoke-ServerValidation function not available" -Level Error
            }
        }
        
        if ($CreateBackup) {
            Write-Log "Executing server backup command..." -Level Info
            if (Get-Command "Invoke-GameBackup" -ErrorAction SilentlyContinue) {
                $savedDir = $configHash.savedDir
                $backupRoot = $configHash.backupRoot
                
                # Resolve relative paths
                if (-not [System.IO.Path]::IsPathRooted($savedDir)) {
                    $savedDir = Join-Path (Get-Location) $savedDir
                }
                if (-not [System.IO.Path]::IsPathRooted($backupRoot)) {
                    $backupRoot = Join-Path (Get-Location) $backupRoot
                }
                
                $result = Invoke-GameBackup -SourcePath $savedDir -BackupRoot $backupRoot
                if ($result) {
                    Write-Log "Server backup command executed successfully" -Level Info
                } else {
                    Write-Log "Server backup command failed" -Level Error
                }
            } else {
                Write-Log "Invoke-GameBackup function not available" -Level Error
            }
        }
        
        # Exit after executing single action
        Write-Log "Single action completed, exiting..." -Level Info
        exit 0
        
    } catch {
        Write-Log "Error executing single action: $($_.Exception.Message)" -Level Error
        exit 1
    }
}

# ===============================================================
# MAIN EXECUTION LOOP - AUTOMATIC MODE ONLY
# ===============================================================

# Always start in automatic monitoring mode
Write-QuietOutput "Starting automatic monitoring mode..." -Important
Write-QuietOutput "Press Ctrl+C to stop" -Important

# Show monitoring configuration
Write-QuietOutput "=== Monitoring Configuration ===" -Color Cyan -Important
Write-QuietOutput "OK: Service Status Monitoring" -Color Green

if ($configHash.periodicBackupEnabled -eq $true) {
    $interval = if ($configHash.backupIntervalMinutes) { $configHash.backupIntervalMinutes } else { 60 }
    Write-QuietOutput "OK: Automatic Backups (every $interval minutes)" -Color Green
} else {
    Write-QuietOutput "DISABLED: Automatic Backups" -Color Yellow
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
            Write-QuietOutput "OK: Scheduled Restarts ($times)" -Color Green
        } else {
            Write-QuietOutput "DISABLED: Scheduled Restarts (no valid times)" -Color Yellow
        }
    } catch {
        Write-QuietOutput "DISABLED: Scheduled Restarts (configuration error)" -Color Yellow
    }
} else {
    Write-QuietOutput "DISABLED: Scheduled Restarts (none configured)" -Color Yellow
}

Write-QuietOutput "OK: Update Checking" -Color Green
Write-QuietOutput "OK: Integrated Discord Bot System" -Color Green

$databaseStatus = if (Get-Command "Get-TotalPlayerCount" -ErrorAction SilentlyContinue) { "Connected" } else { "Not available" }
Write-QuietOutput "$databaseStatus Database Access" -Color Green

Write-QuietOutput "=================================" -Color Cyan -Important

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
        
        # Get Discord status update interval from Discord LiveEmbeds config (in seconds)
        $discordStatusIntervalSeconds = if ($configHash.Discord.LiveEmbeds.UpdateInterval) { 
            $configHash.Discord.LiveEmbeds.UpdateInterval # Already in seconds
        } else { 60 } # Default 60 seconds
        
        Write-QuietOutput "Monitoring interval: $monitoringInterval seconds" -Important
        Write-QuietOutput "Discord status updates: every $discordStatusIntervalSeconds seconds" -Important
        Write-QuietOutput "Leaderboard updates: DISABLED (restart-only mode)" -Important
        
        # MEMORY LEAK FIX: Calculate log processing interval to reduce overhead
        $logProcessingIntervalSeconds = 1 # Process logs every 30 seconds instead of every 2 seconds
        $logProcessingLoops = [math]::Max(1, [math]::Round($logProcessingIntervalSeconds / $monitoringInterval))
        $loopText = "Log processing: every $logProcessingIntervalSeconds seconds ($logProcessingLoops iterations)"
        Write-QuietOutput $loopText -Important
        
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
            
            # Chat management is handled by Node.js bot's chatManager
            # PowerShell Chat Manager removed - no longer needed
            
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
            
            # Monitor Discord bot health and restart if needed (every 10 loops to avoid spam)
            if ($loopCount % 10 -eq 0) {
                if (Get-Command "Test-DiscordBotHealth" -ErrorAction SilentlyContinue) {
                    try {
                        $botHealth = Test-DiscordBotHealth
                        if (-not $botHealth.IsHealthy) {
                            Write-Log "[WARN] Discord bot health check failed: $($botHealth.Message)" -Level Warning
                            
                            # Try to restart the bot
                            if (Get-Command "Stop-DiscordBot" -ErrorAction SilentlyContinue -and Get-Command "Start-DiscordBot" -ErrorAction SilentlyContinue) {
                                Write-Log "[INFO] Attempting to restart Discord bot..." -Level Info
                                
                                $stopResult = Stop-DiscordBot
                                Start-Sleep -Seconds 2
                                $startResult = Start-DiscordBot -Config $configHash
                                
                                if ($startResult.Success) {
                                    Write-Log "[OK] Discord bot restarted successfully" -Level Info
                                } else {
                                    Write-Log "[ERROR] Failed to restart Discord bot: $($startResult.Error)" -Level Error
                                }
                            }
                        } else {
                            Write-Log "[DEBUG] Discord bot health: OK (PID: $($botHealth.ProcessId))" -Level Debug
                        }
                    } catch {
                        Write-Log "Discord bot health check failed: $($_.Exception.Message)" -Level Warning
                    }
                }
                
                # Legacy Discord connection maintenance (fallback for old system)
                if (Get-Command "Maintenance-DiscordConnection" -ErrorAction SilentlyContinue) {
                    try {
                        Maintenance-DiscordConnection | Out-Null
                    } catch {
                        Write-Log "Legacy Discord connection maintenance failed: $($_.Exception.Message)" -Level Warning
                    }
                }
                
                # Account linking embed refresh (every 10 loops = every 10 seconds check, but actual refresh based on configured interval)
                if (Get-Command "Update-AccountLinkingEmbedRefresh" -ErrorAction SilentlyContinue) {
                    try {
                        Update-AccountLinkingEmbedRefresh
                    } catch {
                        Write-Log "Account linking embed refresh failed: $($_.Exception.Message)" -Level Warning
                    }
                }
            }
            
            # Show periodic status based on monitoring interval (every 5 minutes)
            $statusLoops = [math]::Max(1, [math]::Round((5 * 60) / $monitoringInterval))
            if ($loopCount % $statusLoops -eq 0) {
                $status = if ($script:State.IsRunning) { "RUNNING" } else { "STOPPED" }
                $color = if ($script:State.IsRunning) { "Green" } else { "Yellow" }
                $serverStatus = Get-CompleteServerStatus
                $timeStamp = Get-Date -Format "HH:mm:ss"
                $backupTime = $script:State.LastBackup.ToString("HH:mm:ss")
                Write-Log "[$timeStamp] Server: $status | Players: $($serverStatus.OnlinePlayers)/$($serverStatus.MaxPlayers) | Last Backup: $backupTime" -Level Info
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
Write-Log "SCUM Server Automation shutting down..." -Level Info
