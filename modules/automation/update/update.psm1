# ===============================================================
# SCUM Server Automation - Update Management
# ===============================================================
# Automated server update system using SteamCMD
# Checks for updates, downloads, and manages server versions
# ===============================================================

#Requires -Version 5.1

# Import common module during initialization  
function Import-RequiredModules {
    <#
    .SYNOPSIS
    Import required modules for update management
    #>
    $commonPath = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) "core\common\common.psm1"
    if (Test-Path $commonPath) {
        Import-Module $commonPath -Force -Global
    } else {
        throw "Cannot find common module at: $commonPath"
    }
}

# Module variables
$script:updateConfig = $null

# Update warning definitions
$script:UpdateWarningDefs = @(
    @{ key = 'updateWarning15'; minutes = 15 },
    @{ key = 'updateWarning5'; minutes = 5 },
    @{ key = 'updateWarning1'; minutes = 1 }
)

# ===============================================================
# INITIALIZATION
# ===============================================================

function Initialize-UpdateModule {
    <#
    .SYNOPSIS
    Initialize the update module
    .PARAMETER Config
    Configuration object
    #>
    param(
        [Parameter(Mandatory)]
        [object]$Config
    )
    
    # Import required modules
    Import-RequiredModules
    
    $script:updateConfig = $Config
    Write-Log "[Update] Module initialized"
}

function Initialize-UpdateWarningSystem {
    <#
    .SYNOPSIS
    Initialize update warning system with tracking
    .RETURNS
    Hashtable with warning system state
    #>
    
    Write-Log "[Update] Initializing update warning system"
    
    $updateWarningSent = @{}
    
    foreach ($def in $script:UpdateWarningDefs) { 
        $updateWarningSent[$def.key] = $false 
    }
    
    # Return warning state hashtable
    return @{
        UpdateTime = $null
        WarningSent = $updateWarningSent
    }
}

function Update-UpdateWarnings {
    <#
    .SYNOPSIS
    Process update warnings and check if any should be sent
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
    
    if (-not $WarningState.UpdateTime) {
        return $WarningState
    }
    
    foreach ($def in $script:UpdateWarningDefs) {
        $warnTime = $WarningState.UpdateTime.AddMinutes(-$def.minutes)
        
        if (-not $WarningState.WarningSent[$def.key] -and 
            $CurrentTime -ge $warnTime -and 
            $CurrentTime -lt $warnTime.AddSeconds(30)) {
            
            $timeStr = $WarningState.UpdateTime.ToString('HH:mm')
            
            # Send Discord notification if available
            if (Get-Command "Send-DiscordNotification" -ErrorAction SilentlyContinue) {
                try {
                    $null = Send-DiscordNotification -Type $def.key -Data @{ time = $timeStr }
                    Write-Log "[Update] Sent update warning: $($def.key) for update at $timeStr"
                } catch {
                    Write-Log "[Update] Failed to send update warning: $($_.Exception.Message)" -Level Warning
                }
            } else {
                Write-Log "[Update] Update warning would be sent: $($def.key) for update at $timeStr"
            }
            
            $WarningState.WarningSent[$def.key] = $true
        }
    }
    
    return $WarningState
}

# ===============================================================
# UPDATE CHECKING
# ===============================================================

function Get-InstalledBuildId {
    <#
    .SYNOPSIS
    Get installed build ID from Steam manifest
    .PARAMETER ServerDirectory
    Server installation directory
    .PARAMETER AppId
    Steam application ID
    #>
    param(
        [Parameter(Mandatory)]
        [string]$ServerDirectory,
        
        [Parameter(Mandatory)]
        [string]$AppId
    )
    
    $manifestPath = Join-Path $ServerDirectory "steamapps/appmanifest_$AppId.acf"
    
    if (-not (Test-PathExists $manifestPath)) {
        Write-Log "[Update] Manifest file not found: $manifestPath"
        return $null
    }
    
    try {
        $content = Get-Content $manifestPath -Raw
        if ($content -match '"buildid"\s+"(\d+)"') {
            return $matches[1]
        }
        else {
            Write-Log "[Update] buildid not found in manifest" -Level Warning
            return $null
        }
    }
    catch {
        Write-Log "[Update] Failed to read manifest: $($_.Exception.Message)" -Level Error
        return $null
    }
}

function Get-LatestBuildId {
    <#
    .SYNOPSIS
    Get latest build ID from Steam using anonymous access
    .DESCRIPTION
    Uses SteamCMD anonymous login to query Steam for the latest build ID.
    Since anonymous access works for both download and queries, this should be reliable.
    .PARAMETER SteamCmdPath
    Path to steamcmd.exe or directory containing steamcmd.exe
    .PARAMETER AppId
    Steam application ID
    .PARAMETER ScriptRoot
    Script root directory
    #>
    param(
        [Parameter(Mandatory)]
        [string]$SteamCmdPath,
        
        [Parameter(Mandatory)]
        [string]$AppId,
        
        [Parameter(Mandatory)]
        [string]$ScriptRoot
    )
    
    try {
        Write-Log "[Update] Querying Steam for latest build ID (anonymous access)"
        
        # Ensure SteamCMD path includes the executable
        if (-not $SteamCmdPath.EndsWith("steamcmd.exe")) {
            $SteamCmdPath = Join-Path $SteamCmdPath "steamcmd.exe"
        }
        
        # Convert to absolute path
        $SteamCmdPath = [System.IO.Path]::GetFullPath($SteamCmdPath)
        
        # Verify SteamCMD exists
        if (-not (Test-Path $SteamCmdPath)) {
            Write-Log "[Update] SteamCMD not found at: $SteamCmdPath" -Level Warning
            return $null
        }
        
        Write-Log "[Update] Using SteamCMD: $SteamCmdPath"
        
        # Use the most reliable method directly
        Write-Log "[Update] Attempting Steam API query..."
        $cmd = "`"$SteamCmdPath`" +login anonymous +app_info_print $AppId +quit"
        
        try {
            # Execute with proper output capture
            $result = cmd /c $cmd 2>&1
            
            if ($result -and $result.Length -gt 0) {
                # Join all output into single string for regex search
                $allOutput = $result -join "`n"
                
                # Parse for build ID with multiple patterns
                if ($allOutput -match '"buildid"\s+"(\d+)"') {
                    Write-Log "[Update] Successfully retrieved latest build ID from Steam: $($matches[1])"
                    return $matches[1]
                }
                elseif ($allOutput -match '"buildid"[\s\t]+"(\d+)"') {
                    Write-Log "[Update] Successfully retrieved latest build ID (flexible pattern): $($matches[1])"
                    return $matches[1]
                }
                else {
                    Write-Log "[Update] Steam API responded but no build ID found in output" -Level Warning
                    if ($allOutput -match 'buildid') {
                        Write-Log "[Update] Found 'buildid' keyword but pattern didn't match" -Level Warning
                        # Extract lines containing buildid for debugging
                        $buildidLines = $result | Where-Object { $_ -match 'buildid' }
                        if ($buildidLines) {
                            Write-Log "[Update] Buildid lines found: $($buildidLines -join '; ')" -Level Warning
                        }
                    } else {
                        Write-Log "[Update] No 'buildid' keyword found in SteamCMD output" -Level Warning
                        Write-Log "[Update] Output length: $($result.Length) lines" -Level Warning
                        # Show ALL output for debugging when it's short
                        if ($result.Length -le 10) {
                            Write-Log "[Update] Full output: $($result -join ' | ')" -Level Warning
                        } else {
                            # Show sample of output for debugging (just first/last few lines)
                            Write-Log "[Update] Sample output (first 3 lines): $($result[0..2] -join '; ')" -Level Warning
                            Write-Log "[Update] Sample output (last 3 lines): $($result[-3..-1] -join '; ')" -Level Warning
                        }
                    }
                }
            } else {
                Write-Log "[Update] SteamCMD returned no output" -Level Warning
            }
        }
        catch {
            Write-Log "[Update] Error executing SteamCMD: $($_.Exception.Message)" -Level Warning
        }
        
        # Check if we have cached appinfo.vdf as fallback
        if ($SteamCmdPath -and (Test-Path $SteamCmdPath)) {
            $steamCmdDir = Split-Path $SteamCmdPath -Parent
            $vdfPath = Join-Path $steamCmdDir "steamapps\appinfo.vdf"
        } else {
            $vdfPath = Join-Path $ScriptRoot "steamcmd\steamapps\appinfo.vdf"
        }
        
        if (Test-PathExists $vdfPath) {
            Write-Log "[Update] Attempting to use cached appinfo.vdf as fallback"
            try {
                $vdfContent = Get-Content $vdfPath -Raw
                if ($vdfContent -match '"buildid"\s+"(\d+)"') {
                    Write-Log "[Update] Using cached build ID from appinfo.vdf: $($matches[1])" -Level Warning
                    Write-Log "[Update] WARNING: This may not be the latest build - Steam API should be checked manually!" -Level Warning
                    return $matches[1]
                }
            }
            catch {
                Write-Log "[Update] Failed to read cached appinfo.vdf: $($_.Exception.Message)"
            }
        }
        
        # Absolute last resort - return null
        Write-Log "[Update] FAILED: Cannot determine latest build ID from any source!" -Level Warning
        Write-Log "[Update] RECOMMENDATION: Check network connectivity and Steam status manually" -Level Warning
        return $null
    }
    catch {
        Write-Log "[Update] Error getting latest build ID: $($_.Exception.Message)" -Level Error
        return $null
    }
}

function Parse-SteamCmdOutput {
    <#
    .SYNOPSIS
    Parse SteamCMD output for build ID
    #>
    param(
        [array]$Output,
        [string]$Method
    )
    
    if (-not $Output) { 
        Write-Log "[Update] No output received from SteamCMD for $Method" -Level Debug
        return $null 
    }
    
    Write-Log "[Update] Parsing SteamCMD output for $Method (lines: $($Output.Length))" -Level Debug
    
    $allOutput = $Output -join "`n"
    
    # Primary pattern - handle multiple whitespace characters (spaces, tabs)
    if ($allOutput -match '"buildid"\s+"(\d+)"') {
        Write-Log "[Update] Successfully retrieved latest build ID from Steam ($Method): $($matches[1])"
        return $matches[1]
    }
    
    # More flexible pattern for buildid with any amount of whitespace
    if ($allOutput -match '"buildid"[\s\t]+"(\d+)"') {
        Write-Log "[Update] Successfully retrieved latest build ID (flexible pattern, $Method): $($matches[1])"
        return $matches[1]
    }
    
    # Even more flexible - handle cases where there might be different spacing
    if ($allOutput -match 'buildid[^"]*"(\d{8,})"') {
        Write-Log "[Update] Successfully retrieved latest build ID (loose pattern, $Method): $($matches[1])"
        return $matches[1]
    }
    
    # Look for "changelist" as well (sometimes used instead of buildid)
    if ($allOutput -match '"changelist"\s+"(\d+)"') {
        Write-Log "[Update] Successfully retrieved changelist ID from Steam ($Method): $($matches[1])"
        return $matches[1]
    }
    
    # Debug: Log what patterns we're looking for vs what we found
    Write-Log "[Update] No build ID found in SteamCMD output for $Method" -Level Debug
    if ($allOutput -match 'buildid') {
        Write-Log "[Update] Found 'buildid' keyword but pattern didn't match - output may be truncated or formatted differently" -Level Debug
        # Log a sample of the output around buildid
        $buildidLines = $Output | Where-Object { $_ -match 'buildid' }
        if ($buildidLines) {
            Write-Log "[Update] Sample buildid lines found: $($buildidLines -join '; ')" -Level Debug
        }
    } else {
        Write-Log "[Update] No 'buildid' keyword found in output at all" -Level Debug
    }
    
    return $null
}

function Analyze-SteamCmdFailure {
    <#
    .SYNOPSIS
    Analyze why SteamCMD failed and provide helpful diagnostics
    #>
    param(
        [array]$AllResults,
        [int]$Attempt,
        [int]$MaxRetries
    )
    
    $combinedOutput = ($AllResults | Where-Object { $_ }) -join "`n"
    
    if ($combinedOutput -match "No subscription") {
        Write-Log "[Update] Steam reports 'No subscription' - app may require authentication"
    } elseif ($combinedOutput -match "Login Failure") {
        Write-Log "[Update] Steam login failure - anonymous access restricted"
    } elseif ($combinedOutput -match "rate limit|Rate limit") {
        Write-Log "[Update] Steam API rate limited - waiting before retry"
    } elseif ($combinedOutput -match "network|Network|connection|Connection") {
        Write-Log "[Update] Network connectivity issues detected"
    } elseif ($combinedOutput -match "timeout|Timeout") {
        Write-Log "[Update] Steam API timeout - servers may be overloaded"
    } elseif ($combinedOutput -match "failed to connect|connection refused") {
        Write-Log "[Update] Cannot connect to Steam servers"
    } elseif ($combinedOutput -match "invalid app|Invalid app") {
        Write-Log "[Update] Invalid application ID or app not found"
    } else {
        Write-Log "[Update] Steam API returned unexpected format or is unavailable"
    }
    
    if ($Attempt -lt $MaxRetries) {
        Write-Log "[Update] Will retry Steam API query in 5 seconds..."
    }
}

function Test-UpdateAvailable {
    <#
    .SYNOPSIS
    Check if update is available
    .PARAMETER SteamCmdPath
    Path to steamcmd.exe
    .PARAMETER ServerDirectory
    Server installation directory
    .PARAMETER AppId
    Steam application ID
    .PARAMETER ScriptRoot
    Script root directory
    #>
    param(
        [Parameter(Mandatory)]
        [string]$SteamCmdPath,
        
        [Parameter(Mandatory)]
        [string]$ServerDirectory,
        
        [Parameter(Mandatory)]
        [string]$AppId,
        
        [Parameter(Mandatory)]
        [string]$ScriptRoot
    )
    
    try {
        $installedBuild = Get-InstalledBuildId -ServerDirectory $ServerDirectory -AppId $AppId
        $latestBuild = Get-LatestBuildId -SteamCmdPath $SteamCmdPath -AppId $AppId -ScriptRoot $ScriptRoot
        
        # If Steam API failed but we have an installed version, handle gracefully
        if ($null -eq $latestBuild -and $null -ne $installedBuild) {
            Write-Log "[Update] Steam API unavailable - cannot verify if updates are available" -Level Warning
            Write-Log "[Update] Current installed build: $installedBuild (update check skipped)" -Level Info
            return @{
                InstalledBuild = $installedBuild
                LatestBuild = $installedBuild  # Use installed as fallback for display
                UpdateAvailable = $false  # Cannot determine, assume no update
                SteamApiUnavailable = $true
            }
        }
        
        # If Steam API worked and we have both builds
        if ($null -ne $installedBuild -and $null -ne $latestBuild) {
            $updateAvailable = $installedBuild -ne $latestBuild
            if ($updateAvailable) {
                Write-Log "[Update] Update available: $installedBuild -> $latestBuild"
            } else {
                Write-Log "[Update] Server is up to date (Build: $installedBuild)"
            }
            
            return @{
                InstalledBuild = $installedBuild
                LatestBuild = $latestBuild
                UpdateAvailable = $updateAvailable
                SteamApiUnavailable = $false
            }
        }
        
        # If we have no installed build but Steam API worked
        if ($null -eq $installedBuild -and $null -ne $latestBuild) {
            Write-Log "[Update] No server installation found, latest build available: $latestBuild"
            return @{
                InstalledBuild = $null
                LatestBuild = $latestBuild
                UpdateAvailable = $true  # Need to install
                SteamApiUnavailable = $false
            }
        }
        
        # Worst case - neither available
        Write-Log "[Update] Cannot determine update status - no installed build and Steam API unavailable" -Level Warning
        return @{
            InstalledBuild = $installedBuild
            LatestBuild = $latestBuild
            UpdateAvailable = $false
            SteamApiUnavailable = $true
            Error = "Cannot determine update status"
        }
    }
    catch {
        Write-Log "[Update] Error checking for updates: $($_.Exception.Message)" -Level Error
        return @{
            InstalledBuild = $null
            LatestBuild = $null
            UpdateAvailable = $false
            Error = $_.Exception.Message
        }
    }
}

# ===============================================================
# UPDATE EXECUTION
# ===============================================================

function Update-GameServer {
    <#
    .SYNOPSIS
    Update SCUM server using SteamCMD
    .PARAMETER SteamCmdPath
    Path to steamcmd.exe
    .PARAMETER ServerDirectory
    Server installation directory
    .PARAMETER AppId
    Steam application ID
    .PARAMETER ServiceName
    Windows service name
    .PARAMETER SkipServiceStart
    If true, do not start the service or send related notifications after update (used for first install)
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
        [bool]$SkipServiceStart = $false
    )
    
    Write-Log "[Update] Starting server update process"
    
    try {
        if (-not $SkipServiceStart) {
            # Check if service is running and stop it
            if (Test-ServiceRunning $ServiceName) {
                Write-Log "[Update] Stopping server service before update"
                Stop-GameService -ServiceName $ServiceName -Reason "update"
                Start-Sleep -Seconds 10
            }
            else {
                Write-Log "[Update] Service is not running, proceeding with update"
            }
        } else {
            Write-Log "[Update] Skipping service status checks due to SkipServiceStart flag"
        }
        
        # Resolve paths - use provided parameters directly
        $resolvedSteamCmd = $SteamCmdPath
        $resolvedServerDir = $ServerDirectory
        
        # Ensure SteamCMD path includes the executable
        if (-not $resolvedSteamCmd.EndsWith("steamcmd.exe")) {
            $resolvedSteamCmd = Join-Path $resolvedSteamCmd "steamcmd.exe"
        }
        
        # Convert to absolute paths
        $resolvedSteamCmd = [System.IO.Path]::GetFullPath($resolvedSteamCmd)
        $resolvedServerDir = [System.IO.Path]::GetFullPath($resolvedServerDir)
        
        # Verify SteamCMD exists
        if (-not (Test-Path $resolvedSteamCmd)) {
            throw "SteamCMD not found at: $resolvedSteamCmd"
        }
        
        Write-Log "[Update] SteamCMD path verified: $resolvedSteamCmd"
        Write-Log "[Update] Server directory: $resolvedServerDir"
        
        # Create server directory if it doesn't exist
        if (-not (Test-Path $resolvedServerDir)) {
            New-Item -Path $resolvedServerDir -ItemType Directory -Force | Out-Null
            Write-Log "[Update] Created server directory: $resolvedServerDir"
        }
        
        # Build SteamCMD arguments (fix quoting for paths with spaces)
        $steamCmdArgs = @(
            "+force_install_dir"
            $resolvedServerDir
            "+login"
            "anonymous"
            "+app_update"
            $AppId
            "validate"
            "+quit"
        )
        
        Write-Log "[Update] Executing SteamCMD update command"
        Write-Log "[Update] SteamCMD: $resolvedSteamCmd"
        Write-Log "[Update] Arguments: $($steamCmdArgs -join ' ')"
        
        # Check if this is first run of SteamCMD (might need to accept EULA)
        $steamCmdDir = Split-Path $resolvedSteamCmd -Parent
        $steamCmdLogPath = Join-Path $steamCmdDir "logs"
        if (-not (Test-Path $steamCmdLogPath)) {
            Write-Log "[Update] First SteamCMD run detected, may take longer for initialization"
        }
        
        # Execute update directly
        try {
            $process = Start-Process -FilePath $resolvedSteamCmd -ArgumentList $steamCmdArgs -Wait -NoNewWindow -PassThru -WorkingDirectory $steamCmdDir
            $exitCode = $process.ExitCode
        } catch {
            Write-Log "[Update] Failed to start SteamCMD: $($_.Exception.Message)" -Level Error
            throw "Failed to execute SteamCMD: $($_.Exception.Message)"
        }
        
        if ($exitCode -eq 0 -or $exitCode -eq 7) {
            if ($exitCode -eq 7) {
                Write-Log "[Update] Server update completed with warnings (exit code 7)"
            } else {
                Write-Log "[Update] Server update completed successfully"
            }
            
            # Give SteamCMD a moment to finalize file operations
            Start-Sleep -Seconds 2
            
            # Verify installation by checking for server executable in correct path
            $scumExePath = Join-Path $resolvedServerDir "SCUM\Binaries\Win64\SCUMServer.exe"
            $serverFound = Test-Path $scumExePath
            
            if ($serverFound) {
                Write-Log "[Update] Server executable found: $scumExePath"
            } else {
                Write-Log "[Update] Server executable not found at expected path: $scumExePath"
                
                # Fallback - check for legacy locations
                $serverExecutables = @("SCUMServerEXE.exe", "SCUM_Server.exe", "SCUMServer.exe")
                
                foreach ($exe in $serverExecutables) {
                    $exePath = Join-Path $resolvedServerDir $exe
                    if (Test-Path $exePath) {
                        Write-Log "[Update] Server executable found at legacy location: $exePath"
                        $serverFound = $true
                        break
                    }
                }
                
                # If still not found, list what's actually in the directory for diagnostics
                if (-not $serverFound) {
                    $scumBinariesDir = Join-Path $resolvedServerDir "SCUM\Binaries\Win64"
                    if (Test-Path $scumBinariesDir) {
                        $files = Get-ChildItem -Path $scumBinariesDir -Filter "*.exe" -ErrorAction SilentlyContinue
                        if ($files) {
                            Write-Log "[Update] Found executables in SCUM\Binaries\Win64: $($files.Name -join ', ')"
                        } else {
                            Write-Log "[Update] No executables found in SCUM\Binaries\Win64 directory"
                        }
                    } else {
                        Write-Log "[Update] SCUM\Binaries\Win64 directory does not exist"
                    }
                }
            }
            
            if (-not $serverFound) {
                Write-Log "[Update] Warning: No server executable found in installation directory" -Level Warning
                Write-Log "[Update] This may be normal for some installation states - continuing anyway" -Level Info
            }
            
            if (-not $SkipServiceStart) {
                # Start service after successful update
                Write-Log "[Update] Starting server service after update"
                Start-GameService -ServiceName $ServiceName -Context "update"
                
                # Note: Success notification is sent by the calling function (Invoke-ImmediateUpdate)
                # to avoid duplicate notifications when this function is called internally
            } else {
                Write-Log "[Update] Skipping service start and notifications due to SkipServiceStart flag"
            }
            
            return @{ Success = $true; Error = $null }
        }
        else {
            Write-Log "[Update] Server update failed with exit code: $exitCode" -Level Error
            Write-Log "[Update] Common SteamCMD exit codes: 1=General error, 2=Invalid arguments, 5=Cannot write to directory, 6=Steam client not running, 7=Success with warnings" -Level Error
            
            # Check for common issues
            if ($exitCode -eq 5) {
                Write-Log "[Update] Exit code 5 suggests permission or disk space issues" -Level Error
            } elseif ($exitCode -eq 2) {
                Write-Log "[Update] Exit code 2 suggests invalid command arguments" -Level Error
            } elseif ($exitCode -eq 7) {
                Write-Log "[Update] Exit code 7 usually means success with warnings, but treating as error due to context" -Level Error
            }
            
            # Send failure notification
            if (Get-Command "Send-DiscordNotification" -ErrorAction SilentlyContinue) {
                $null = Send-DiscordNotification -Type 'update.failed' -Data @{ 
                    error = "SteamCMD failed with exit code: $exitCode"
                }
            }
            
            return @{ Success = $false; Error = "SteamCMD failed with exit code: $exitCode" }
        }
    }
    catch {
        Write-Log "[Update] Update process failed: $($_.Exception.Message)" -Level Error
        
        # Send failure notification
        if (Get-Command "Send-DiscordNotification" -ErrorAction SilentlyContinue) {
            $null = Send-DiscordNotification -Type 'update.failed' -Data @{ 
                error = $_.Exception.Message
            }
        }
        
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

function Invoke-ImmediateUpdate {
    <#
    .SYNOPSIS
    Execute immediate update with backup and service management
    .PARAMETER SteamCmdPath
    Path to steamcmd.exe directory
    .PARAMETER ServerDirectory
    Server installation directory
    .PARAMETER AppId
    Steam application ID
    .PARAMETER ServiceName
    Windows service name
    .RETURNS
    Hashtable with operation result
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
    
    Write-Log "[Update] Starting immediate update process"
    
    $result = @{
        Success = $false
        Error = $null
        BackupCreated = $false
        UpdateCompleted = $false
        ServiceRestarted = $false
    }
    
    try {
        # Ensure SteamCMD path is directory format for Update-GameServer
        $steamCmdDirectory = if ($SteamCmdPath -like "*steamcmd.exe") {
            Split-Path $SteamCmdPath -Parent
        } else {
            $SteamCmdPath
        }
        
        # Check if update is actually available before proceeding
        Write-Log "[Update] Checking if update is available"
        $updateCheck = Test-UpdateAvailable -SteamCmdPath $steamCmdDirectory -ServerDirectory $ServerDirectory -AppId $AppId -ScriptRoot (Split-Path $PSScriptRoot -Parent)
        
        if (-not $updateCheck.UpdateAvailable) {
            Write-Log "[Update] No update available, aborting immediate update"
            $result.Success = $true
            $result.Error = "No update available"
            return $result
        }
        
        # Send update available notification is sent by the calling script
        Write-Log "[Update] Update available: $($updateCheck.InstalledBuild) -> $($updateCheck.LatestBuild)"
        
        # Apply update delay with warning system if configured
        $updateDelayMinutes = Get-SafeConfigValue $script:updateConfig "updateDelayMinutes" 0
        if ($updateDelayMinutes -gt 0) {
            Write-Log "[Update] Setting up update warning system for $updateDelayMinutes minute delay"
            
            # Initialize warning system
            $warningState = Initialize-UpdateWarningSystem
            $updateTime = (Get-Date).AddMinutes($updateDelayMinutes)
            $warningState.UpdateTime = $updateTime
            
            Write-Log "[Update] Update scheduled for: $($updateTime.ToString('HH:mm:ss'))"
            
            # Process warnings until update time
            $startTime = Get-Date
            while ((Get-Date) -lt $updateTime) {
                $warningState = Update-UpdateWarnings -WarningState $warningState -CurrentTime (Get-Date)
                Start-Sleep -Seconds 15  # Check every 15 seconds for warnings
                
                # Safety check - don't run forever
                $elapsed = (Get-Date) - $startTime
                if ($elapsed.TotalMinutes -gt ($updateDelayMinutes + 5)) {
                    Write-Log "[Update] Warning loop safety timeout reached, proceeding with update" -Level Warning
                    break
                }
            }
            
            Write-Log "[Update] Update delay completed, starting update process"
        }
        
        # Send update started notification
        Write-Log "[Update] Starting server update process"
        if (Get-Command "Send-DiscordNotification" -ErrorAction SilentlyContinue) {
            $null = Send-DiscordNotification -Type 'update.started' -Data @{
                currentVersion = $updateCheck.InstalledBuild
                targetVersion = $updateCheck.LatestBuild
            }
        }
        
        # Get paths from centralized management
        $savedDir = if ($script:updateConfig.savedDir) { $script:updateConfig.savedDir } else { $null }
        $backupRoot = if ($script:updateConfig.backupRoot) { $script:updateConfig.backupRoot } else { $null }
        $maxBackups = Get-SafeConfigValue $script:updateConfig "maxBackups" 10
        $compressBackups = Get-SafeConfigValue $script:updateConfig "compressBackups" $true
        
        # Create backup before update
        if ($savedDir -and $backupRoot) {
            Write-Log "[Update] Creating backup before update"
            $backupResult = Invoke-GameBackup -SourcePath $savedDir -BackupRoot $backupRoot -MaxBackups $maxBackups -CompressBackups $compressBackups
            
            if ($backupResult) {
                Write-Log "[Update] Backup created successfully"
                $result.BackupCreated = $true
            } else {
                Write-Log "[Update] Backup failed, continuing with update anyway" -Level Warning
            }
        } else {
            Write-Log "[Update] Backup paths not available, skipping backup" -Level Warning
            Write-Log "[Update] savedDir: '$savedDir', backupRoot: '$backupRoot'" -Level Warning
        }
        
        # Stop service if running
        if (Test-ServiceRunning $ServiceName) {
            Write-Log "[Update] Stopping service for update"
            Stop-GameService -ServiceName $ServiceName -Reason "update"
            
            # Wait a moment for service to stop
            Start-Sleep -Seconds 3
        }
        
        # Perform update
        Write-Log "[Update] Performing server update"
        $updateResult = Update-GameServer -SteamCmdPath $steamCmdDirectory -ServerDirectory $ServerDirectory -AppId $AppId -ServiceName $ServiceName
        
        if ($updateResult.Success) {
            Write-Log "[Update] Server updated successfully"
            
            # Get new build ID after update
            $newBuild = Get-InstalledBuildId -ServerDirectory $ServerDirectory -AppId $AppId
            
            if (Get-Command "Send-DiscordNotification" -ErrorAction SilentlyContinue) {
                $null = Send-DiscordNotification -Type 'update.completed' -Data @{
                    version = $newBuild
                    previousVersion = $updateCheck.InstalledBuild
                    duration = "N/A"
                }
            }
            $result.UpdateCompleted = $true
            
            # Start service after update
            Write-Log "[Update] Starting service after update"
            Start-GameService -ServiceName $ServiceName -Context "post-update"
            $result.ServiceRestarted = $true
            $result.Success = $true
            
        } else {
            $result.Error = $updateResult.Error
            Write-Log "[Update] Update failed: $($result.Error)" -Level Error
            if (Get-Command "Send-DiscordNotification" -ErrorAction SilentlyContinue) {
                $null = Send-DiscordNotification -Type 'update.failed' -Data @{ 
                    error = $result.Error
                }
            }
            
            # Try to start service anyway
            if (-not (Test-ServiceRunning $ServiceName)) {
                Write-Log "[Update] Attempting to start service after failed update"
                Start-GameService -ServiceName $ServiceName -Context "post-failed-update"
            }
        }
        
    } catch {
        $result.Error = $_.Exception.Message
        Write-Log "[Update] Immediate update failed: $($result.Error)" -Level Error
        if (Get-Command "Send-DiscordNotification" -ErrorAction SilentlyContinue) {
            $null = Send-DiscordNotification -Type 'update.failed' -Data @{ 
                error = $result.Error
            }
        }
        
        # Try to start service if it's not running
        if (-not (Test-ServiceRunning $ServiceName)) {
            Write-Log "[Update] Attempting to start service after update exception"
            Start-GameService -ServiceName $ServiceName -Context "post-exception"
        }
    }
    
    return $result
}

function Get-UpdateStatus {
    <#
    .SYNOPSIS
    Get current update status and information
    .PARAMETER SteamCmdPath
    Path to steamcmd.exe
    .PARAMETER ServerDirectory
    Server installation directory
    .PARAMETER AppId
    Steam application ID
    .PARAMETER ScriptRoot
    Script root directory
    #>
    param(
        [Parameter(Mandatory)]
        [string]$SteamCmdPath,
        
        [Parameter(Mandatory)]
        [string]$ServerDirectory,
        
        [Parameter(Mandatory)]
        [string]$AppId,
        
        [Parameter(Mandatory)]
        [string]$ScriptRoot
    )
    
    try {
        $updateCheck = Test-UpdateAvailable -SteamCmdPath $SteamCmdPath -ServerDirectory $ServerDirectory -AppId $AppId -ScriptRoot $ScriptRoot
        
        return @{
            InstalledBuild = $updateCheck.InstalledBuild
            LatestBuild = $updateCheck.LatestBuild
            UpdateAvailable = $updateCheck.UpdateAvailable
            LastCheck = Get-Date
            Status = if ($updateCheck.UpdateAvailable) { "Update Available" } else { "Up to Date" }
        }
    }
    catch {
        Write-Log "[Update] Failed to get update status: $($_.Exception.Message)" -Level Error
        return @{
            Status = "Error"
            Error = $_.Exception.Message
            LastCheck = Get-Date
        }
    }
}

# Export module functions
Export-ModuleMember -Function @(
    'Initialize-UpdateModule',
    'Initialize-UpdateWarningSystem',
    'Update-UpdateWarnings',
    'Get-InstalledBuildId',
    'Get-LatestBuildId',
    'Test-UpdateAvailable',
    'Update-GameServer',
    'Invoke-ImmediateUpdate',
    'Get-UpdateStatus'
)
