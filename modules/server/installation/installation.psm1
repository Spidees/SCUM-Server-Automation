# ===============================================================
# SCUM Server Automation - Server Installation
# ===============================================================
# SCUM dedicated server installation and initial configuration
# Manages SteamCMD setup, server download, and config generation
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
    Write-Host "[WARNING] Common module not available for installation module" -ForegroundColor Yellow
}

# Module variables
$script:installationConfig = $null

# No additional helper functions needed - using common module functions

# ===============================================================
# INITIALIZATION
# ===============================================================

function Initialize-InstallationModule {
    <#
    .SYNOPSIS
    Initialize the installation module
    .PARAMETER Config
    Configuration object
    #>
    param(
        [Parameter(Mandatory)]
        [object]$Config
    )
    
    $script:installationConfig = $Config
    Write-Log "[Installation] Module initialized" -Level Debug
}

function Test-FirstInstall {
    <#
    .SYNOPSIS
    Check if this is a first installation
    .PARAMETER ServerDirectory
    Server installation directory
    .PARAMETER AppId
    Steam application ID
    .RETURNS
    Boolean indicating if first install is needed
    #>
    param(
        [Parameter(Mandatory)]
        [string]$ServerDirectory,
        
        [Parameter(Mandatory)]
        [string]$AppId
    )
    
    # Check for Steam manifest file (most important indicator of complete installation)
    $manifestPath = Join-Path $ServerDirectory "steamapps/appmanifest_$AppId.acf"
    $hasManifest = Test-PathExists $manifestPath
    
    # Check for key server files
    $scumExe = Join-Path $ServerDirectory "SCUM\Binaries\Win64\SCUMServer.exe"
    $hasServerExe = Test-PathExists $scumExe
    
    # Check for saved directory structure
    $savedDir = Join-Path $ServerDirectory "SCUM\Saved"
    $hasSavedDir = Test-PathExists $savedDir
    
    # Check for steamapps directory (indicates Steam installation attempt)
    $steamAppsDir = Join-Path $ServerDirectory "steamapps"
    $hasSteamAppsDir = Test-PathExists $steamAppsDir
    
    # Check for SCUM game directory structure
    $scumGameDir = Join-Path $ServerDirectory "SCUM"
    $hasScumGameDir = Test-PathExists $scumGameDir
    
    # Get SteamCMD path from configuration (with fallback logic)
    $steamCmdPath = $null
    $hasSteamCmd = $false
    $steamCmdExe = ""
    
    # Try to get from cached configuration paths first (suppress warnings)
    $steamCmdPath = try { 
        $script:ConfigPaths.steamCmd 
    } catch { 
        $null 
    }
    
    # If not found in cache, try direct config access with backward compatibility
    if (-not $steamCmdPath) {
        $steamCmdPathConfig = if ($script:installationConfig.SteamCmdPath) { 
            $script:installationConfig.SteamCmdPath 
        } elseif ($script:installationConfig.steamCmd) { 
            $script:installationConfig.steamCmd 
        } else { 
            $null 
        }
        
        if ($steamCmdPathConfig) {
            # Resolve relative paths manually
            if ($steamCmdPathConfig -like "./*") {
                $basePath = $PSScriptRoot
                # Go up to find the root directory
                $parentPath = $basePath
                for ($i = 0; $i -lt 5; $i++) {
                    $parentPath = Split-Path $parentPath -Parent
                    if (Test-Path (Join-Path $parentPath "SCUM-Server-Automation.config.json")) {
                        $basePath = $parentPath
                        break
                    }
                }
                $steamCmdPath = Join-Path $basePath ($steamCmdPathConfig -replace "^\./", "")
            } elseif (-not [System.IO.Path]::IsPathRooted($steamCmdPathConfig)) {
                # Handle other relative paths
                $basePath = $PSScriptRoot
                $parentPath = $basePath
                for ($i = 0; $i -lt 5; $i++) {
                    $parentPath = Split-Path $parentPath -Parent
                    if (Test-Path (Join-Path $parentPath "SCUM-Server-Automation.config.json")) {
                        $basePath = $parentPath
                        break
                    }
                }
                $steamCmdPath = Join-Path $basePath $steamCmdPathConfig
            } else {
                $steamCmdPath = $steamCmdPathConfig
            }
        }
    }
    
    if ($steamCmdPath) {
        $steamCmdExe = if ($steamCmdPath -like "*steamcmd.exe") {
            $steamCmdPath
        } else {
            Join-Path $steamCmdPath "steamcmd.exe"
        }
        $hasSteamCmd = Test-PathExists $steamCmdExe
    }
    
    # CRITICAL: Installation is complete ONLY if ALL essential components exist:
    # 1. Steam manifest file (proves Steam installation completed)
    # 2. Server executable (proves game files are present)
    # 3. Steam apps directory (proves Steam installation structure)
    # 4. SCUM Saved directory (proves server has been run and configured)
    # 5. SteamCMD executable (required for updates and maintenance)
    $isComplete = $hasManifest -and $hasServerExe -and $hasSteamAppsDir -and $hasSavedDir -and $hasSteamCmd
    
    if (-not $isComplete) {
        Write-Log "[Installation] First install required - checking installation status:" -Level Debug
        Write-Log "[Installation]   Steam manifest file: $(if($hasManifest){'[OK]'}else{'[MISSING]'}) $manifestPath" -Level Debug
        Write-Log "[Installation]   Steam apps directory: $(if($hasSteamAppsDir){'[OK]'}else{'[MISSING]'}) $steamAppsDir" -Level Debug
        Write-Log "[Installation]   Server executable: $(if($hasServerExe){'[OK]'}else{'[MISSING]'}) $scumExe" -Level Debug
        Write-Log "[Installation]   SCUM game directory: $(if($hasScumGameDir){'[OK]'}else{'[MISSING]'}) $scumGameDir" -Level Debug
        Write-Log "[Installation]   Saved directory: $(if($hasSavedDir){'[OK]'}else{'[MISSING]'}) $savedDir" -Level Debug
        Write-Log "[Installation]   SteamCMD executable: $(if($hasSteamCmd){'[OK]'}else{'[MISSING]'}) $steamCmdExe" -Level Debug
        
        # Analyze the situation and provide user guidance
        if ($hasManifest -and $hasServerExe -and -not $hasSteamCmd) {
            Write-Log "[Installation] DETECTED: Server files exist but SteamCMD is missing" -Level Warning
            Write-Log "[Installation] SteamCMD is required for server updates and maintenance" -Level Warning
        } elseif ($hasSteamCmd -and -not $hasManifest -and -not $hasServerExe -and -not $hasSteamAppsDir) {
            Write-Log "[Installation] DETECTED: SteamCMD exists but no server files found" -Level Warning
            Write-Log "[Installation] SteamCMD is ready - will download SCUM server files" -Level Warning
        } elseif ($hasSavedDir -and -not $hasManifest -and -not $hasServerExe) {
            Write-Log "[Installation] DETECTED: Only user data exists - Steam server installation required" -Level Warning
            Write-Log "[Installation] This appears to be copied user data without game files" -Level Warning
        } elseif ($hasServerExe -and -not $hasManifest) {
            Write-Log "[Installation] DETECTED: Server executable exists but Steam manifest missing" -Level Warning
            Write-Log "[Installation] Incomplete or corrupted Steam installation - will reinstall" -Level Warning
        } elseif ($hasSteamAppsDir -and -not $hasManifest -and -not $hasServerExe) {
            Write-Log "[Installation] DETECTED: Steam apps directory exists but no game files found" -Level Warning
            Write-Log "[Installation] Incomplete Steam installation - will download server files" -Level Warning
        } elseif ($hasScumGameDir -and -not $hasServerExe) {
            Write-Log "[Installation] DETECTED: SCUM directory exists but server executable missing" -Level Warning
            Write-Log "[Installation] Incomplete game installation - will complete download" -Level Warning
        } elseif (Test-PathExists $ServerDirectory) {
            $dirItems = Get-ChildItem $ServerDirectory -ErrorAction SilentlyContinue
            if ($dirItems -and $dirItems.Count -gt 0) {
                Write-Log "[Installation] DETECTED: Server directory contains files but installation incomplete" -Level Warning
                Write-Log "[Installation] Will preserve existing data and complete installation" -Level Warning
            } else {
                Write-Log "[Installation] DETECTED: Empty server directory - will perform fresh installation" -Level Debug
            }
        } else {
            Write-Log "[Installation] DETECTED: No server directory - will perform fresh installation" -Level Debug
        }
    } else {
        Write-Log "[Installation] Server installation found and verified complete" -Level Debug
        Write-Log "[Installation] Steam manifest verified: $manifestPath" -Level Debug
    }
    
    return (-not $isComplete)
}

# ===============================================================
# STEAM INSTALLATION
# ===============================================================

function Install-SteamCmd {
    <#
    .SYNOPSIS
    Download and install SteamCMD if not present
    .PARAMETER SteamCmdPath
    Path to SteamCMD directory or steamcmd.exe
    .RETURNS
    Hashtable with Success and Error properties
    #>
    param(
        [Parameter(Mandatory)]
        [string]$SteamCmdPath
    )
    
    $result = @{ Success = $false; Error = "" }
    
    try {
        # Get the directory part of steamCmd path
        $steamCmdDir = if ($SteamCmdPath -like "*steamcmd.exe") {
            Split-Path $SteamCmdPath -Parent
        } else {
            $SteamCmdPath
        }
        
        $steamCmdExe = Join-Path $steamCmdDir "steamcmd.exe"
        
        # Check if SteamCMD already exists
        if (Test-PathExists $steamCmdExe) {
            Write-Log "[Installation] SteamCMD found at: $steamCmdExe" -Level Debug
            
            # Test if SteamCMD is functional by checking its version
            try {
                $testResult = & $steamCmdExe "+quit" 2>&1
                Write-Log "[Installation] SteamCMD appears to be functional" -Level Debug
                $result.Success = $true
                return $result
            } catch {
                Write-Log "[Installation] WARNING: Existing SteamCMD may be corrupted - will re-download" -Level Warning
                try {
                    Remove-Item $steamCmdExe -Force -ErrorAction SilentlyContinue
                } catch {
                    Write-Log "[Installation] WARNING: Could not remove existing SteamCMD: $($_.Exception.Message)" -Level Warning
                }
            }
        }
        
        Write-Log "[Installation] SteamCMD not found, downloading from Steam..." -Level Debug
        
        # Create SteamCMD directory if it doesn't exist
        if (-not (Test-PathExists $steamCmdDir)) {
            try {
                New-Item -Path $steamCmdDir -ItemType Directory -Force | Out-Null
                Write-Log "[Installation] Created SteamCMD directory: $steamCmdDir" -Level Debug
            } catch {
                $result.Error = "Failed to create SteamCMD directory: $($_.Exception.Message)"
                return $result
            }
        }
        
        # Download SteamCMD
        $steamCmdZipUrl = "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip"
        $steamCmdZipPath = Join-Path $steamCmdDir "steamcmd.zip"
        
        Write-Log "[Installation] Downloading SteamCMD from: $steamCmdZipUrl" -Level Debug
        $webClient = New-Object System.Net.WebClient
        $webClient.DownloadFile($steamCmdZipUrl, $steamCmdZipPath)
        Write-Log "[Installation] SteamCMD downloaded successfully" -Level Debug
        
        # Extract SteamCMD
        Write-Log "[Installation] Extracting SteamCMD..." -Level Debug
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($steamCmdZipPath, $steamCmdDir)
        
        # Remove zip file
        Remove-Item $steamCmdZipPath -Force
        Write-Log "[Installation] SteamCMD extracted and ready" -Level Debug
        
        # Verify steamcmd.exe exists
        if (Test-PathExists $steamCmdExe) {
            Write-Log "[Installation] SteamCMD installation verified at: $steamCmdExe" -Level Debug
            $result.Success = $true
        } else {
            $result.Error = "SteamCMD executable not found after extraction"
        }
        
    } catch {
        $result.Error = "Failed to download/extract SteamCMD: $($_.Exception.Message)"
    }
    
    return $result
}

function Initialize-ServerDirectory {
    <#
    .SYNOPSIS
    Create server directory if it doesn't exist
    .PARAMETER ServerDirectory
    Path to server directory
    .RETURNS
    Hashtable with Success and Error properties
    #>
    param(
        [Parameter(Mandatory)]
        [string]$ServerDirectory
    )
    
    $result = @{ Success = $false; Error = "" }
    
    try {
        if (-not (Test-PathExists $ServerDirectory)) {
            Write-Log "[Installation] Creating server directory: $ServerDirectory" -Level Debug
            New-Item -Path $ServerDirectory -ItemType Directory -Force | Out-Null
            Write-Log "[Installation] Server directory created successfully" -Level Debug
        } else {
            Write-Log "[Installation] Server directory already exists: $ServerDirectory" -Level Debug
        }
        
        $result.Success = $true
        
    } catch {
        $result.Error = "Failed to create server directory: $($_.Exception.Message)"
    }
    
    return $result
}

function Start-FirstTimeServerGeneration {
    <#
    .SYNOPSIS
    Start server briefly to generate configuration files
    .PARAMETER ServerDirectory
    Server installation directory
    .PARAMETER TimeoutSeconds
    Timeout for waiting for config generation
    .RETURNS
    Hashtable with Success and Error properties
    #>
    param(
        [Parameter(Mandatory)]
        [string]$ServerDirectory,
        
        [Parameter()]
        [int]$TimeoutSeconds = 120
    )
    
    $result = @{ Success = $false; Error = "" }
    
    try {
        $scumExe = Join-Path $ServerDirectory "SCUM\Binaries\Win64\SCUMServer.exe"
        
        # Essential configuration files that should be generated
        $configDir = Join-Path $ServerDirectory "SCUM\Saved\Config\WindowsServer"
        $essentialConfigFiles = @(
            "ServerSettings.ini",
            "GameUserSettings.ini",
            "AdminUsers.ini",
            "BannedUsers.ini"
        )
        
        $logFile = Join-Path $ServerDirectory "SCUM\Saved\Logs\SCUM.log"
        $saveFilesDir = Join-Path $ServerDirectory "SCUM\Saved\SaveFiles"
        
        if (-not (Test-PathExists $scumExe)) {
            $result.Error = "SCUMServer.exe not found at: $scumExe"
            return $result
        }
        
        Write-Log "[Installation] Launching SCUMServer.exe to generate configuration files..." -Level Debug
        Write-Log "[Installation] NOTE: This will start the server directly (not as a service) to generate initial configuration" -Level Debug
        
        # Try different approaches for starting the server
        $proc = $null
        try {
            # Method 1: Start with ProcessStartInfo for better control
            $startInfo = New-Object System.Diagnostics.ProcessStartInfo
            $startInfo.FileName = $scumExe
            $startInfo.Arguments = "-log -ServerName=`"Initial Config Generation`""
            $startInfo.WorkingDirectory = Split-Path $scumExe -Parent
            $startInfo.UseShellExecute = $false
            $startInfo.CreateNoWindow = $false  # Allow window to see what's happening
            $startInfo.RedirectStandardOutput = $false
            $startInfo.RedirectStandardError = $false
            
            Write-Log "[Installation] Starting server with command: $($startInfo.FileName) $($startInfo.Arguments)" -Level Debug
            $proc = [System.Diagnostics.Process]::Start($startInfo)
            Write-Log "[Installation] Server process started (PID: $($proc.Id))" -Level Debug
            Write-Log "[Installation] Server is now generating configuration files..." -Level Debug
        } catch {
            Write-Log "[Installation] Failed to start server with ProcessStartInfo: $($_.Exception.Message)" -Level Warning
            
            # Method 2: Try simpler Start-Process 
            try {
                Write-Log "[Installation] Trying alternative start method..." -Level Debug
                $proc = Start-Process -FilePath $scumExe -ArgumentList "-log" -WorkingDirectory (Split-Path $scumExe -Parent) -PassThru
                Write-Log "[Installation] Server process started with alternative method (PID: $($proc.Id))" -Level Debug
            } catch {
                Write-Log "[Installation] Failed to start server with alternative method: $($_.Exception.Message)" -Level Warning
                $result.Error = "Cannot start server process - may be blocked by antivirus or insufficient permissions"
                Write-Log "[Installation] Suggestions:" -Level Warning
                Write-Log "[Installation] 1. Temporarily disable antivirus and try again" -Level Warning  
                Write-Log "[Installation] 2. Run automation script as Administrator" -Level Warning
                Write-Log "[Installation] 3. Manually add SCUMServer.exe to antivirus exceptions" -Level Warning
                return $result
            }
        }
        
        if (-not $proc) {
            $result.Error = "Failed to start server process"
            return $result
        }
        
        $elapsed = 0
        $allConfigsGenerated = $false
        $configCheckInterval = 3  # Check every 3 seconds
        
        Write-Log "[Installation] Waiting for configuration files to be generated (timeout: $TimeoutSeconds seconds)..." -Level Debug
        
        while (-not $allConfigsGenerated -and $elapsed -lt $TimeoutSeconds) {
            Start-Sleep -Seconds $configCheckInterval
            $elapsed += $configCheckInterval
            
            # Check if config directory exists
            $hasConfigDir = Test-PathExists $configDir
            
            # Check essential config files
            $configFilesExist = $true
            $createdConfigs = @()
            if ($hasConfigDir) {
                foreach ($configFile in $essentialConfigFiles) {
                    $configPath = Join-Path $configDir $configFile
                    if (Test-PathExists $configPath) {
                        $createdConfigs += $configFile
                    } else {
                        $configFilesExist = $false
                    }
                }
            } else {
                $configFilesExist = $false
            }
            
            # Check other required items
            $hasLogFile = Test-PathExists $logFile
            $hasSaveFilesDir = Test-PathExists $saveFilesDir
            
            $allConfigsGenerated = $hasConfigDir -and $configFilesExist -and $hasLogFile -and $hasSaveFilesDir
            
            # Progress update every 15 seconds
            if (($elapsed % 15) -eq 0) {
                Write-Log "[Installation] Progress check ($elapsed/$TimeoutSeconds seconds):" -Level Debug
                Write-Log "[Installation]   Config directory: $(if($hasConfigDir){'[OK]'}else{'[MISSING]'})" -Level Debug
                Write-Log "[Installation]   Config files created: $($createdConfigs.Count)/$($essentialConfigFiles.Count) ($($createdConfigs -join ', '))" -Level Debug
                Write-Log "[Installation]   Log file: $(if($hasLogFile){'[OK]'}else{'[MISSING]'})" -Level Debug
                Write-Log "[Installation]   Save files directory: $(if($hasSaveFilesDir){'[OK]'}else{'[MISSING]'})" -Level Debug
                
                if (-not $allConfigsGenerated) {
                    Write-Log "[Installation] Server is still initializing, please wait..." -Level Debug
                }
            }
        }
        
        if ($allConfigsGenerated) {
            Write-Log "[Installation] SUCCESS: All required files and folders have been generated!" -Level Debug
            Write-Log "[Installation]   Config directory: [OK] $configDir" -Level Debug
            foreach ($configFile in $essentialConfigFiles) {
                Write-Log "[Installation]   $configFile : [OK]" -Level Debug
            }
            Write-Log "[Installation]   Log file: [OK] $logFile" -Level Debug
            Write-Log "[Installation]   Save files directory: [OK] $saveFilesDir" -Level Debug
            Write-Log "[Installation] Configuration generation completed successfully" -Level Debug
            $result.Success = $true
        } else {
            Write-Log "[Installation] TIMEOUT: Not all required files/folders were generated within $TimeoutSeconds seconds" -Level Warning
            $configDirStatus = if(Test-PathExists $configDir){"[OK]"}else{"[MISSING]"}
            Write-Log "[Installation]   Config directory: $configDirStatus $configDir" -Level Warning
            foreach ($configFile in $essentialConfigFiles) {
                $configPath = Join-Path $configDir $configFile
                $fileStatus = if(Test-PathExists $configPath){"[OK]"}else{"[MISSING]"}
                Write-Log "[Installation]   $configFile : $fileStatus" -Level Warning
            }
            $logFileStatus = if(Test-PathExists $logFile){"[OK]"}else{"[MISSING]"}
            $saveFilesDirStatus = if(Test-PathExists $saveFilesDir){"[OK]"}else{"[MISSING]"}
            Write-Log "[Installation]   Log file: $logFileStatus $logFile" -Level Warning
            Write-Log "[Installation]   Save files directory: $saveFilesDirStatus $saveFilesDir" -Level Warning
            Write-Log "[Installation] Server may still be initializing - continuing with installation anyway" -Level Warning
            $result.Error = "Configuration generation timeout after $TimeoutSeconds seconds - server may still be initializing"
        }
        
        # Stop the server process
        Write-Log "[Installation] Stopping server process..." -Level Debug
        if (-not $proc.HasExited) {
            try {
                Stop-Process -Id $proc.Id -Force
                Start-Sleep -Seconds 2  # Give it time to stop
                Write-Log "[Installation] Server process stopped successfully" -Level Debug
            } catch {
                Write-Log "[Installation] Failed to stop server process: $($_.Exception.Message)" -Level Warning
                Write-Log "[Installation] Server process may stop on its own" -Level Warning
            }
        } else {
            Write-Log "[Installation] Server process has already exited" -Level Debug
        }
        
        # Dispose of process object to prevent memory leak
        if ($proc) {
            $proc.Dispose()
        }
        
    } catch {
        $result.Error = "Failed to start server for config generation: $($_.Exception.Message)"
    }
    
    return $result
}

function Invoke-FirstInstall {
    <#
    .SYNOPSIS
    Perform complete first installation of SCUM server
    .PARAMETER SteamCmdPath
    Path to SteamCMD directory or executable
    .PARAMETER ServerDirectory
    Server installation directory
    .PARAMETER AppId
    Steam application ID
    .PARAMETER ServiceName
    Windows service name
    .RETURNS
    Hashtable with Success and Error properties
    #>
    param(
        [Parameter(Mandatory)]
        [string]$SteamCmdPath,
        
        [Parameter(Mandatory)]
        [string]$ServerDirectory,
        
        [Parameter(Mandatory)]
        [string]$AppId,
        
        [Parameter(Mandatory)]
        [string]$ServiceName
    )
    
    $result = @{ Success = $false; Error = "" }
    
    try {
        Write-Log "[Installation] Starting first install process" -Level Debug
        
        # Pre-installation cleanup and validation
        Write-Log "[Installation] Performing pre-installation validation..." -Level Debug
        
        # Check if server directory exists and has content
        if (Test-PathExists $ServerDirectory) {
            $serverDirItems = Get-ChildItem $ServerDirectory -ErrorAction SilentlyContinue
            if ($serverDirItems -and $serverDirItems.Count -gt 0) {
                Write-Log "[Installation] Server directory contains existing files - will attempt to preserve and complete installation" -Level Warning
            }
        }
        
        # Step 1: Install SteamCMD
        Write-Log "[Installation] Step 1/4: Installing SteamCMD..." -Level Debug
        $steamCmdResult = Install-SteamCmd -SteamCmdPath $SteamCmdPath
        if (-not $steamCmdResult.Success) {
            $result.Error = "SteamCMD installation failed: $($steamCmdResult.Error)"
            return $result
        }
        
        # Step 2: Create server directory
        Write-Log "[Installation] Step 2/4: Preparing server directory..." -Level Debug
        $serverDirResult = Initialize-ServerDirectory -ServerDirectory $ServerDirectory
        if (-not $serverDirResult.Success) {
            $result.Error = "Server directory setup failed: $($serverDirResult.Error)"
            return $result
        }
        
        # Step 3: Download server files
        Write-Log "[Installation] Step 3/4: Downloading SCUM server files via SteamCMD..." -Level Debug
        
        # Get the directory part of steamCmd path for Update-GameServer
        $steamCmdDirectory = if ($SteamCmdPath -like "*steamcmd.exe") {
            Split-Path $SteamCmdPath -Parent
        } else {
            $SteamCmdPath
        }
        
        $updateResult = Update-GameServer -SteamCmdPath $steamCmdDirectory -ServerDirectory $ServerDirectory -AppId $AppId -ServiceName $ServiceName -SkipServiceStart:$true
        
        if (-not $updateResult.Success) {
            $result.Error = "Server download failed: $($updateResult.Error)"
            
            # Check if partial download occurred
            $scumExe = Join-Path $ServerDirectory "SCUM\Binaries\Win64\SCUMServer.exe"
            if (Test-PathExists $scumExe) {
                Write-Log "[Installation] Server executable found despite download error - installation may have partially succeeded" -Level Warning
                Write-Log "[Installation] You may want to verify installation manually before proceeding" -Level Warning
            }
            
            return $result
        }
        
        # Verify critical files after download
        $scumExe = Join-Path $ServerDirectory "SCUM\Binaries\Win64\SCUMServer.exe"
        if (-not (Test-PathExists $scumExe)) {
            $result.Error = "Server executable not found after download: $scumExe"
            return $result
        }
        
        # Step 4: Generate configuration files
        Write-Log "[Installation] Step 4/4: Generating initial configuration files..." -Level Debug
        $configResult = Start-FirstTimeServerGeneration -ServerDirectory $ServerDirectory
        if (-not $configResult.Success) {
            Write-Log "[Installation] Config generation failed: $($configResult.Error)" -Level Warning
            Write-Log "[Installation] This is not critical - creating basic directory structure manually" -Level Warning
            
            # Create basic directory structure manually if server failed to start
            $savedDir = Join-Path $ServerDirectory "SCUM\Saved"
            $configDir = Join-Path $savedDir "Config\WindowsServer"
            $logsDir = Join-Path $savedDir "Logs"
            $saveFilesDir = Join-Path $savedDir "SaveFiles"
            
            try {
                New-Item -Path $configDir -ItemType Directory -Force -ErrorAction SilentlyContinue | Out-Null
                New-Item -Path $logsDir -ItemType Directory -Force -ErrorAction SilentlyContinue | Out-Null
                New-Item -Path $saveFilesDir -ItemType Directory -Force -ErrorAction SilentlyContinue | Out-Null
                Write-Log "[Installation] Basic directory structure created" -Level Debug
            } catch {
                Write-Log "[Installation] Failed to create basic directories: $($_.Exception.Message)" -Level Warning
            }
        } else {
            Write-Log "[Installation] Configuration files generated successfully" -Level Debug
            Write-Log "[Installation] IMPORTANT: Server configuration complete" -Level Debug
        }
        
        # Final verification
        Write-Log "[Installation] Performing final installation verification..." -Level Debug
        $manifestPath = Join-Path $ServerDirectory "steamapps/appmanifest_$AppId.acf"
        $scumExe = Join-Path $ServerDirectory "SCUM\Binaries\Win64\SCUMServer.exe"
        $savedDir = Join-Path $ServerDirectory "SCUM\Saved"
        
        $finalCheck = @{
            "Steam manifest" = Test-PathExists $manifestPath
            "Server executable" = Test-PathExists $scumExe  
            "Saved directory" = Test-PathExists $savedDir
        }
        
        $failedChecks = $finalCheck.GetEnumerator() | Where-Object { -not $_.Value } | ForEach-Object { $_.Key }
        
        if ($failedChecks.Count -gt 0) {
            Write-Log "[Installation] WARNING: Some components may be missing: $($failedChecks -join ', ')" -Level Warning
            Write-Log "[Installation] Installation completed with warnings - manual verification recommended" -Level Warning
        } else {
            Write-Log "[Installation] All components verified successfully" -Level Debug
        }
        
        Write-Log "[Installation] First install completed successfully" -Level Debug
        Write-Log "[Installation] IMPORTANT: Installation complete - automation script must now be stopped" -Level Debug
        Write-Log "[Installation] NEXT STEP: Configure Windows service using NSSM and restart automation script" -Level Debug
        
        $result.Success = $true
        $result.RequireRestart = $true  # Changed to true - require manual restart after service setup
        
    } catch {
        $result.Error = "First install failed: $($_.Exception.Message)"
        Write-Log "[Installation] $($result.Error)" -Level Error
        Write-Log "[Installation] Error details: $($_.ScriptStackTrace)" -Level Error
        
        # Provide recovery suggestions
        Write-Log "[Installation] Recovery suggestions:" -Level Warning
        Write-Log "[Installation] 1. Check if SteamCMD directory is writable: $(Split-Path $SteamCmdPath -Parent)" -Level Warning
        Write-Log "[Installation] 2. Check if server directory is writable: $ServerDirectory" -Level Warning
        Write-Log "[Installation] 3. Ensure stable internet connection for downloads" -Level Warning
        Write-Log "[Installation] 4. Try running script as Administrator if permission errors occur" -Level Warning
        
    }
    
    return $result
}

function Invoke-InstallationUpdate {
    <#
    .SYNOPSIS
    Execute immediate server update with backup
    .PARAMETER SteamCmdPath
    Path to SteamCMD directory
    .PARAMETER ServerDirectory
    Server installation directory
    .PARAMETER AppId
    Steam application ID
    .PARAMETER ServiceName
    Windows service name
    .PARAMETER BackupSettings
    Hashtable with backup configuration
    .RETURNS
    Hashtable with Success and Error properties
    #>
    param(
        [Parameter(Mandatory)]
        [string]$SteamCmdPath,
        
        [Parameter(Mandatory)]
        [string]$ServerDirectory,
        
        [Parameter(Mandatory)]
        [string]$AppId,
        
        [Parameter(Mandatory)]
        [string]$ServiceName,
        
        [Parameter()]
        [hashtable]$BackupSettings = @{}
    )
    
    $result = @{ Success = $false; Error = "" }
    
    try {
        Write-Log "[Installation] Starting immediate update" -Level Debug
        
        # Ensure SteamCMD path is directory format for Update-GameServer
        $steamCmdDirectory = if ($SteamCmdPath -like "*steamcmd.exe") {
            Split-Path $SteamCmdPath -Parent
        } else {
            $SteamCmdPath
        }
        
        # Create backup before update if settings provided
        if ($BackupSettings.Keys.Count -gt 0) {
            Write-Log "[Installation] Creating backup before update" -Level Debug
            $backupResult = Invoke-GameBackup -SourcePath $BackupSettings.SourcePath -BackupRoot $BackupSettings.BackupRoot -MaxBackups $BackupSettings.MaxBackups -CompressBackups $BackupSettings.CompressBackups
            
            if (-not $backupResult) {
                $result.Error = "Pre-update backup failed"
                return $result
            }
            Write-Log "[Installation] Backup created successfully" -Level Debug
        }
        
        # Stop service if running
        if (Test-ServiceRunning $ServiceName) {
            Stop-GameService -ServiceName $ServiceName -Reason "update"
        }
        
        # Perform update
        $updateResult = Update-GameServer -SteamCmdPath $steamCmdDirectory -ServerDirectory $ServerDirectory -AppId $AppId -ServiceName $ServiceName
        
        if ($updateResult.Success) {
            Write-Log "[Installation] Server updated successfully" -Level Debug
            
            # Start service after update
            Start-GameService -ServiceName $ServiceName -Context "post-update"
            $result.Success = $true
        } else {
            $result.Error = "Update failed: $($updateResult.Error)"
        }
        
    } catch {
        $result.Error = "Update process failed: $($_.Exception.Message)"
        Write-Log "[Installation] $($result.Error)" -Level Error
    }
    
    return $result
}

function Install-SqliteTools {
    <#
    .SYNOPSIS
    Download and install SQLite command line tools if not present
    .PARAMETER SqliteToolsPath
    Path to SQLite tools directory
    .RETURNS
    Hashtable with Success and Error properties
    #>
    param(
        [Parameter(Mandatory)]
        [string]$SqliteToolsPath
    )
    
    $result = @{ Success = $false; Error = "" }
    
    try {
        $sqliteExe = Join-Path $SqliteToolsPath "sqlite3.exe"
        
        # Check if SQLite tools already exist
        if (Test-PathExists $sqliteExe) {
            Write-Log "[Installation] SQLite tools found at: $sqliteExe" -Level Debug
            
            # Test if SQLite is functional
            try {
                $testResult = & $sqliteExe "-version" 2>&1
                if ($testResult) {
                    Write-Log "[Installation] SQLite tools are functional (Version: $testResult)" -Level Debug
                    $result.Success = $true
                    return $result
                }
            } catch {
                Write-Log "[Installation] WARNING: Existing SQLite tools may be corrupted - will re-download" -Level Warning
                try {
                    Remove-Item $sqliteExe -Force -ErrorAction SilentlyContinue
                } catch {
                    Write-Log "[Installation] WARNING: Could not remove existing SQLite tools: $($_.Exception.Message)" -Level Warning
                }
            }
        }
        
        Write-Log "[Installation] SQLite tools not found, downloading from SQLite.org..." -Level Debug
        
        # Create SQLite tools directory if it doesn't exist
        if (-not (Test-PathExists $SqliteToolsPath)) {
            try {
                New-Item -Path $SqliteToolsPath -ItemType Directory -Force | Out-Null
                Write-Log "[Installation] Created SQLite tools directory: $SqliteToolsPath" -Level Debug
            } catch {
                $result.Error = "Failed to create SQLite tools directory: $($_.Exception.Message)"
                return $result
            }
        }
        
        # Download SQLite tools (Windows x64)
        $sqliteZipUrl = "https://www.sqlite.org/2024/sqlite-tools-win-x64-3450300.zip"
        $sqliteZipPath = Join-Path $SqliteToolsPath "sqlite-tools.zip"
        
        Write-Log "[Installation] Downloading SQLite tools from: $sqliteZipUrl" -Level Debug
        $webClient = New-Object System.Net.WebClient
        $webClient.DownloadFile($sqliteZipUrl, $sqliteZipPath)
        Write-Log "[Installation] SQLite tools downloaded successfully" -Level Debug
        
        # Extract SQLite tools
        Write-Log "[Installation] Extracting SQLite tools..." -Level Debug
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        
        # Extract directly to main directory first, then reorganize if needed
        [System.IO.Compression.ZipFile]::ExtractToDirectory($sqliteZipPath, $SqliteToolsPath)
        
        # Check if files were extracted to a subdirectory
        $extractedFiles = Get-ChildItem $SqliteToolsPath -File -ErrorAction SilentlyContinue
        if ($extractedFiles.Count -eq 0) {
            # Files might be in a subdirectory - move them up
            $subdirs = Get-ChildItem $SqliteToolsPath -Directory -ErrorAction SilentlyContinue
            foreach ($subdir in $subdirs) {
                $subFiles = Get-ChildItem $subdir.FullName -File -ErrorAction SilentlyContinue
                foreach ($file in $subFiles) {
                    $destinationPath = Join-Path $SqliteToolsPath $file.Name
                    Move-Item -Path $file.FullName -Destination $destinationPath -Force
                }
                # Remove empty subdirectory
                Remove-Item $subdir.FullName -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
        Remove-Item $sqliteZipPath -Force
        Write-Log "[Installation] SQLite tools extracted and ready" -Level Debug
        
        # Verify sqlite3.exe exists
        if (Test-PathExists $sqliteExe) {
            # Test functionality
            try {
                $versionResult = & $sqliteExe "-version" 2>&1
                Write-Log "[Installation] SQLite tools installation verified (Version: $versionResult)"
                $result.Success = $true
            } catch {
                $result.Error = "SQLite tools installed but not functional"
            }
        } else {
            $result.Error = "SQLite tools executable not found after extraction"
        }
        
    } catch {
        $result.Error = "Failed to download/extract SQLite tools: $($_.Exception.Message)"
    }
    
    return $result
}

<#
.SYNOPSIS
    Installs Node.js LTS for Discord integration.

.DESCRIPTION
    Downloads and installs the latest Node.js LTS version if not already installed.
    Similar to SteamCMD installation but for Node.js ecosystem.

.PARAMETER NodePath
    The path where Node.js should be installed.

.EXAMPLE
    Install-NodeJS -NodePath "C:\SCUMServer\nodejs"
#>
function Install-NodeJS {
    param(
        [Parameter(Mandatory = $true)]
        [string]$NodePath
    )

    $result = @{
        Success = $false
        Message = ""
        Error = ""
        NodeExecutable = ""
        NPMExecutable = ""
    }

    try {
        Write-Host "Checking Node.js installation..." -ForegroundColor Yellow

        # Check if Node.js is already installed in the specified path
        $nodeExe = Join-Path $NodePath "node.exe"
        $npmExe = Join-Path $NodePath "npm.cmd"
        
        if (Test-Path $nodeExe) {
            # Verify Node.js version
            $nodeVersion = & $nodeExe --version 2>$null
            if ($nodeVersion -and $nodeVersion -match "v(\d+)\.(\d+)\.(\d+)") {
                $majorVersion = [int]$matches[1]
                if ($majorVersion -ge 18) {
                    Write-Host "Node.js $nodeVersion already installed and compatible." -ForegroundColor Green
                    $result.Success = $true
                    $result.Message = "Node.js $nodeVersion already installed"
                    $result.NodeExecutable = $nodeExe
                    $result.NPMExecutable = $npmExe
                    return $result
                }
            }
        }

        # Create Node.js directory
        if (-not (Test-Path $NodePath)) {
            New-Item -ItemType Directory -Path $NodePath -Force | Out-Null
        }

        # Download latest LTS Node.js
        Write-Host "Downloading Node.js LTS..." -ForegroundColor Yellow
        
        # Get latest LTS version info
        $ltsPlatform = "win-x64"
        $ltsApiUrl = "https://nodejs.org/dist/index.json"
        
        try {
            $versionsData = Invoke-RestMethod -Uri $ltsApiUrl -UseBasicParsing
            $ltsVersion = ($versionsData | Where-Object { $_.lts -ne $false } | Select-Object -First 1).version
            
            if (-not $ltsVersion) {
                throw "Could not determine latest LTS version"
            }
            
            Write-Host "Latest LTS version: $ltsVersion" -ForegroundColor Green
            
        } catch {
            # Fallback to a known stable LTS version
            $ltsVersion = "v20.11.0"
            Write-Host "Using fallback LTS version: $ltsVersion" -ForegroundColor Yellow
        }

        $nodeArchive = "node-$ltsVersion-$ltsPlatform.zip"
        $downloadUrl = "https://nodejs.org/dist/$ltsVersion/$nodeArchive"
        $zipPath = Join-Path $NodePath $nodeArchive

        # Download with progress
        $webClient = New-Object System.Net.WebClient
        $webClient.DownloadFile($downloadUrl, $zipPath)
        
        if (-not (Test-Path $zipPath)) {
            throw "Failed to download Node.js archive"
        }

        Write-Host "Extracting Node.js..." -ForegroundColor Yellow

        # Extract the archive
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $extractPath = Join-Path $NodePath "temp_extract"
        [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $extractPath)

        # Move files from extracted folder to main Node.js path
        $extractedFolder = Get-ChildItem $extractPath -Directory | Select-Object -First 1
        if ($extractedFolder) {
            $sourceFiles = Join-Path $extractedFolder.FullName "*"
            Copy-Item $sourceFiles $NodePath -Recurse -Force
        }

        # Cleanup
        Remove-Item $extractPath -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

        # Verify installation
        $nodeExe = Join-Path $NodePath "node.exe"
        $npmExe = Join-Path $NodePath "npm.cmd"
        
        if (Test-Path $nodeExe) {
            $nodeVersion = & $nodeExe --version 2>$null
            Write-Host "Node.js $nodeVersion installed successfully!" -ForegroundColor Green
            
            $result.Success = $true
            $result.Message = "Node.js $nodeVersion installed successfully"
            $result.NodeExecutable = $nodeExe
            $result.NPMExecutable = $npmExe
        } else {
            throw "Node.js executable not found after installation"
        }

    } catch {
        $result.Error = "Failed to install Node.js: $($_.Exception.Message)"
        Write-Host "Error installing Node.js: $($_.Exception.Message)" -ForegroundColor Red
    }

    return $result
}

function Install-NSSMService {
    <#
    .SYNOPSIS
    Automatically configure Windows service using NSSM
    .PARAMETER Config
    Configuration object containing service settings
    .PARAMETER ServerDirectory  
    Server installation directory
    .RETURNS
    Result object with Success, Message, and Error properties
    #>
    param(
        [Parameter(Mandatory)]
        [object]$Config,
        
        [Parameter(Mandatory)]
        [string]$ServerDirectory
    )
    
    $result = @{
        Success = $false
        Message = ""
        Error = ""
    }
    
    try {
        Write-Host "Configuring NSSM service..." -ForegroundColor Yellow
        
        # Get configuration values
        $serviceName = if ($Config.serviceName) { $Config.serviceName } else { "SCUMSERVER" }
        $serverPort = if ($Config.serverPort) { $Config.serverPort } else { "7777" }
        $queryPort = if ($Config.publicPort) { $Config.publicPort } else { "7779" }
        
        # Paths
        $nssmExe = Join-Path $PSScriptRoot "..\..\..\nssm.exe"
        $serverExe = Join-Path $ServerDirectory "SCUM\Binaries\Win64\SCUMServer.exe"
        $startupDir = Join-Path $ServerDirectory "SCUM\Binaries\Win64"
        
        # Verify NSSM exists
        if (-not (Test-Path $nssmExe)) {
            throw "NSSM executable not found at: $nssmExe"
        }
        
        # Verify server executable exists
        if (-not (Test-Path $serverExe)) {
            throw "SCUM Server executable not found at: $serverExe"
        }
        
        Write-Host "Service Name: $serviceName" -ForegroundColor Cyan
        Write-Host "Server Port: $serverPort" -ForegroundColor Cyan
        Write-Host "Query Port: $queryPort" -ForegroundColor Cyan
        Write-Host "Executable: $serverExe" -ForegroundColor Cyan
        
        # Remove existing service if it exists
        $existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
        if ($existingService) {
            Write-Host "Removing existing service..." -ForegroundColor Yellow
            & $nssmExe remove $serviceName confirm
            Start-Sleep -Seconds 2
        }
        
        # Install service
        Write-Host "Installing service..." -ForegroundColor Yellow
        & $nssmExe install $serviceName $serverExe
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to install service (Exit code: $LASTEXITCODE)"
        }
        
        # Configure Application Tab
        Write-Host "Configuring application settings..." -ForegroundColor Yellow
        & $nssmExe set $serviceName Application $serverExe
        & $nssmExe set $serviceName AppDirectory $startupDir
        & $nssmExe set $serviceName AppParameters "-port=$serverPort -QueryPort=$queryPort -log"
        
        # Configure Service Tab
        Write-Host "Configuring service settings..." -ForegroundColor Yellow
        & $nssmExe set $serviceName DisplayName $serviceName
        & $nssmExe set $serviceName Description "SCUM Dedicated Server"
        & $nssmExe set $serviceName Start SERVICE_DEMAND_START
        
        # Configure Log On Tab
        Write-Host "Configuring logon settings..." -ForegroundColor Yellow
        & $nssmExe set $serviceName ObjectName LocalSystem
        & $nssmExe set $serviceName Type SERVICE_INTERACTIVE_PROCESS
        
        # Configure Process Tab
        Write-Host "Configuring process settings..." -ForegroundColor Yellow
        & $nssmExe set $serviceName AppPriority REALTIME_PRIORITY_CLASS
        & $nssmExe set $serviceName AppNoConsole 0
        & $nssmExe set $serviceName AppAffinity "All"
        
        # Configure Shutdown Tab
        Write-Host "Configuring shutdown settings..." -ForegroundColor Yellow
        & $nssmExe set $serviceName AppStopMethodSkip 0
        & $nssmExe set $serviceName AppStopMethodConsole 300000
        & $nssmExe set $serviceName AppStopMethodWindow 2000
        & $nssmExe set $serviceName AppStopMethodThreads 2000
        & $nssmExe set $serviceName AppKillConsoleDelay 1500
        & $nssmExe set $serviceName AppKillWindowDelay 1500
        & $nssmExe set $serviceName AppKillThreadsDelay 1500
        & $nssmExe set $serviceName AppThrottle 3000
        
        # Configure Exit Actions Tab (srvany compatible)
        Write-Host "Configuring exit actions..." -ForegroundColor Yellow
        & $nssmExe set $serviceName AppExit Default Ignore
        & $nssmExe set $serviceName AppRestartDelay 3000
        
        # Additional SCUM-specific settings
        & $nssmExe set $serviceName AppStdout $startupDir\service_stdout.log
        & $nssmExe set $serviceName AppStderr $startupDir\service_stderr.log
        & $nssmExe set $serviceName AppRotateFiles 1
        & $nssmExe set $serviceName AppRotateOnline 1
        & $nssmExe set $serviceName AppRotateSeconds 86400
        & $nssmExe set $serviceName AppRotateBytes 10485760
        
        Write-Host "Service configuration completed successfully!" -ForegroundColor Green
        
        # Verify service was created
        $newService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
        if ($newService) {
            $result.Success = $true
            $result.Message = "Service '$serviceName' configured successfully"
            Write-Host "Service '$serviceName' is ready for use!" -ForegroundColor Green
        } else {
            throw "Service was not created successfully"
        }
        
    } catch {
        $result.Error = "Failed to configure NSSM service: $($_.Exception.Message)"
        Write-Host "Error configuring service: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    return $result
}

# Export module functions
Export-ModuleMember -Function @(
    'Initialize-InstallationModule',
    'Test-FirstInstall',
    'Install-SteamCmd',
    'Initialize-ServerDirectory',
    'Start-FirstTimeServerGeneration',
    'Invoke-FirstInstall',
    'Invoke-InstallationUpdate',
    'Install-SqliteTools',
    'Install-NodeJS',
    'Install-NSSMService'
)
