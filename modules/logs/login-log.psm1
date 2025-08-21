# ===============================================================
# SCUM Server Automation - Discord Login Log Manager
# ===============================================================
# Real-time login log monitoring and Discord relay system
# ===============================================================

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

    # MEMORY LEAK FIX: Import log streaming helper - check if already loaded
    $streamingPath = Join-Path $PSScriptRoot "..\core\log-streaming.psm1"
    if (Test-Path $streamingPath) {
        if (-not (Get-Module "log-streaming" -ErrorAction SilentlyContinue)) {
            Import-Module $streamingPath -ErrorAction SilentlyContinue
        }
    }
    
    # MEMORY LEAK FIX: Import embed templates - check if already loaded
    $embedPath = Join-Path $PSScriptRoot "..\communication\discord\templates\log-embed-templates.psm1"
    if (Test-Path $embedPath) {
        if (-not (Get-Module "log-embed-templates" -ErrorAction SilentlyContinue)) {
            Import-Module $embedPath -ErrorAction SilentlyContinue
        }
    }
    
    # MEMORY LEAK FIX: Import server database module - check if already loaded
    $serverDbPath = Join-Path $PSScriptRoot "..\database\server-database.psm1"
    if (Test-Path $serverDbPath) {
        if (-not (Get-Module "server-database" -ErrorAction SilentlyContinue)) {
            Import-Module $serverDbPath -ErrorAction SilentlyContinue
        }
    }
} catch {
    Write-Host "[WARNING] Common module not available for login-log module" -ForegroundColor Yellow
}

# Global variables
$script:Config = $null
$script:DiscordConfig = $null
$script:LogDirectory = $null
$script:CurrentLogFile = $null
$script:IsMonitoring = $false
$script:LastLineNumber = 0
$script:StateFile = $null
$script:IsRelayActive = $false
$script:ServerDbPath = $null
$script:SqlitePath = $null

# ===============================================================
# INITIALIZATION
# ===============================================================
function Initialize-LoginLogModule {
    param([hashtable]$Config)
    
    try {
        Write-Log "Initializing login log management system..." -Level "Info"
        
        # Initialize configuration
        $script:DiscordConfig = $Config.Discord
        if (-not $script:DiscordConfig -or -not $script:DiscordConfig.Token) {
            Write-Log "Discord not configured, login log relay disabled" -Level "Info"
            return $false
        }
        
        # Look for LoginFeed in Features section
        if ($Config.SCUMLogFeatures -and $Config.SCUMLogFeatures.LoginFeed) {
            $script:Config = $Config.SCUMLogFeatures.LoginFeed
        }
        else {
            Write-Log "Login log relay not enabled in configuration" -Level "Info"
            return $false
        }
        
        if (-not $script:Config.Enabled) {
            Write-Log "Login log relay not enabled in configuration" -Level "Info"
            return $false
        }
        
        # Initialize login log directory
        $serverDir = $Config.serverDir
        if (-not $serverDir) {
            Write-Log "Server directory not configured" -Level "Info"
            return $false
        }
        
        $script:LogDirectory = Join-Path $serverDir "SCUM\Saved\SaveFiles\Logs"
        Write-Log "Login log directory: $script:LogDirectory" -Level "Info"
        
        if (-not (Test-Path $script:LogDirectory)) {
            Write-Log "Login log directory not found: $script:LogDirectory" -Level "Info"
            return $false
        }
        
        # Initialize database paths
        if ($Config.dataDir) {
            $script:ServerDbPath = Join-Path $Config.dataDir "server_database.db"
            Write-Log "Server database path: $script:ServerDbPath" -Level "Debug"
        }
        
        if ($Config.rootDir) {
            $script:SqlitePath = Join-Path $Config.rootDir "sqlite-tools\sqlite3.exe"
            Write-Log "SQLite executable path: $script:SqlitePath" -Level "Debug"
        }
        
        # Initialize state persistence
        $stateDir = ".\state"
        if (-not (Test-Path $stateDir)) {
            New-Item -Path $stateDir -ItemType Directory -Force | Out-Null
        }
        $script:StateFile = Join-Path $stateDir "login-log-manager.json"
        
        # Load previous state
        Load-LoginState
        
        # Mark as active
        $script:IsMonitoring = $true
        $script:IsRelayActive = $true
        
        return $true
    } catch {
        Write-Log "Failed to initialize login log manager: $($_.Exception.Message)" -Level "Info"
        return $false
    }
}

# ===============================================================
# LOGIN LOG MONITORING
# ===============================================================
function Update-LoginLogProcessing {
    if (-not $script:IsMonitoring -or -not $script:IsRelayActive) {
        return
    }
    
    try {
        $newEvents = Get-NewLoginEvents
        
        if (-not $newEvents -or $newEvents.Count -eq 0) {
            return
        }
        
        foreach ($event in $newEvents) {
            # Clean format: LOGIN [Type] Name: Action
            Write-Log "LOGIN [$($event.Type)] $($event.PlayerName): $($event.Action)" -Level "Info"
            Send-LoginEventToDiscord -LoginEvent $event
            Save-LoginEventToDatabase -LoginEvent $event
        }
        
        # Save state after processing
        Save-LoginState
        
    } catch {
        Write-Log "Error during login log update: $($_.Exception.Message)" -Level "Info"
    }
}

function Get-NewLoginEvents {
    # Get the latest login log file
    $latestLogFile = Get-LatestLoginLogFile
    if (-not $latestLogFile) {
        return @()
    }
    
    # Check if we're monitoring a different file now
    if ($script:CurrentLogFile -ne $latestLogFile) {
        Write-Log "Switched to new login log file" -Level "Debug"
        $script:CurrentLogFile = $latestLogFile
        $script:LastLineNumber = 0  # Reset line counter for new file
    }
    
    if (-not (Test-Path $script:CurrentLogFile)) {
        Write-Log "Login log file not found: $script:CurrentLogFile" -Level "Info"
        return @()
    }
    
    try {
        # MEMORY LEAK FIX: Use streaming instead of Get-Content on entire file
        $result = Read-LogStreamLines -FilePath $script:CurrentLogFile -LastLineNumber $script:LastLineNumber -Encoding ([System.Text.Encoding]::Unicode)
        
        if (-not $result.Success -or $result.NewLines.Count -eq 0) {
            return @()
        }
        
        # Update position and get new lines
        $newLines = $result.NewLines
        $script:LastLineNumber = $result.TotalLines
        
        if ($newLines.Count -eq 0) {
            return @()
        }
        
        # Parse login events from new lines
        $newEvents = @()
        foreach ($line in $newLines) {
            if (-not [string]::IsNullOrWhiteSpace($line) -and $line -notmatch "Game version:") {
                $parsedEvent = ConvertFrom-LoginLine -LogLine $line
                if ($parsedEvent) {
                    # All login events are enabled by default when LoginFeed is enabled
                # MEMORY LEAK FIX: Use ArrayList instead of array +=
                if (-not $newEvents) {
                    $newEvents = New-Object System.Collections.ArrayList
                }
                $null = $newEvents.Add($parsedEvent)
                }
            }
        }
        
        return $newEvents
        
    } catch {
        Write-Log "Error reading login log: $($_.Exception.Message)" -Level "Info"
        return @()
    }
}

function Get-LatestLoginLogFile {
    try {
        # Get all login log files
        $LogFiles = Get-ChildItem -Path $script:LogDirectory -Filter "login_*.log" -ErrorAction SilentlyContinue
        
        if (-not $LogFiles -or $LogFiles.Count -eq 0) {
            Write-Log "No login log files found in $script:LogDirectory" -Level "Info"
            return $null
        }
        
        # Sort by creation time and get the latest
        $latestFile = $LogFiles | Sort-Object CreationTime -Descending | Select-Object -First 1
        return $latestFile.FullName
        
    } catch {
        Write-Log "Error finding latest login log: $($_.Exception.Message)" -Level "Info"
        return $null
    }
}

# ===============================================================
# STATE PERSISTENCE
# ===============================================================
function Save-LoginState {
    try {
        $state = @{
            CurrentLogFile = $script:CurrentLogFile
            LastLineNumber = $script:LastLineNumber
            LastUpdate = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        }
        
        $stateJson = $state | ConvertTo-Json
        Set-Content -Path $script:StateFile -Value $stateJson -Encoding UTF8
        
    } catch {
        Write-Log "Failed to save login log state: $($_.Exception.Message)" -Level "Info"
    }
}

function Load-LoginState {
    try {
        if (Test-Path $script:StateFile) {
            $stateJson = Get-Content -Path $script:StateFile -Raw -Encoding UTF8
            $state = $stateJson | ConvertFrom-Json
            
            $script:CurrentLogFile = if ($state.CurrentLogFile) { $state.CurrentLogFile } else { $null }
            $script:LastLineNumber = if ($state.LastLineNumber) { $state.LastLineNumber } else { 0 }
            
            # Verify the saved log file still exists, if not reset
            if ($script:CurrentLogFile -and -not (Test-Path $script:CurrentLogFile)) {
                Write-Log "Previous login log file no longer exists, resetting state" -Level "Info"
                $script:CurrentLogFile = $null
                $script:LastLineNumber = 0
            } else {
                Write-Log "Loaded login log state: File=$($script:CurrentLogFile), Line=$($script:LastLineNumber)" -Level "Info"
            }
        } else {
            Write-Log "No previous login log state found, starting from current log end" -Level "Info"
            # Initialize to current log file and skip to end to avoid spam
            $latestLogFile = Get-LatestLoginLogFile
            if ($latestLogFile -and (Test-Path $latestLogFile)) {
                $script:CurrentLogFile = $latestLogFile
                # MEMORY LEAK FIX: Use streaming to count lines instead of loading entire file
                try {
                    $script:LastLineNumber = Get-LogFileLineCount -FilePath $script:CurrentLogFile -Encoding ([System.Text.Encoding]::Unicode)
                    Write-Log "Initialized kill log state: File=$($script:CurrentLogFile), Starting from line $($script:LastLineNumber)" -Level "Info"
                } catch {
                    $script:LastLineNumber = 0
                }
            } else {
                $script:CurrentLogFile = $null
                $script:LastLineNumber = 0
            }
        }
    } catch {
        Write-Log "Failed to load login log state, starting fresh: $($_.Exception.Message)" -Level "Info"
        $script:CurrentLogFile = $null
        $script:LastLineNumber = 0
    }
}

# ===============================================================
# LOGIN LOG PARSING
# ===============================================================
function ConvertFrom-LoginLine {
    param([string]$LogLine)
    
    # SCUM Login log format examples:
    # 2025.07.19-10.01.13: '5.179.133.105 76561198207481861:Chris Fenomenez(2341)' logged in at: X=449024.000 Y=-13533.000 Z=12121.000
    # 2025.07.19-10.01.13: '70.81.165.96 76561197963653320:Kaliss de bot 3(29)' logged in at: X=221431.000 Y=573543.000 Z=21246.000 (as drone)
    # 2025.07.19-10.01.15: '70.81.165.96 76561197963653320:Kaliss de bot 3(29)' logged out at: ?
    # 2025.07.19-15.59.58: '37.201.192.246 76561199677416767:Letho(2615)' logged out at: X=-518223.000 Y=-236985.000 Z=15999.710
    
    if ($LogLine -match "^(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\s+'([^\s]+)\s+(\d+):([^']+)'\s+(logged\s+(?:in|out))\s+at:\s+(.+)") {
        $timestamp = $matches[1]
        $ipAddress = $matches[2]
        $steamId = $matches[3]
        $playerName = $matches[4].Trim()
        $action = $matches[5].Trim()
        $location = $matches[6].Trim()
        
        # Extract player ID from name if present (e.g., "Chris Fenomenez(2341)" -> ID: 2341)
        $playerId = $null
        if ($playerName -match "^(.+?)\((\d+)\)$") {
            $playerName = $matches[1].Trim()
            $playerId = $matches[2]
        }
        
        # Determine login type
        $isLogin = $action -match "logged in"
        $isDrone = $location -match "\(as drone\)"
        $type = if ($isLogin) { "LOGIN" } else { "LOGOUT" }
        
        # Parse coordinates if available
        $coordinates = $null
        if ($location -match "X=([0-9.-]+)\s+Y=([0-9.-]+)\s+Z=([0-9.-]+)") {
            $coordinates = @{
                X = [float]$matches[1]
                Y = [float]$matches[2]  
                Z = [float]$matches[3]
            }
        }
        
        # Format action description
        $actionDesc = if ($isLogin) { 
            if ($isDrone) { "logged in as drone" } else { "logged in" }
        } else { 
            if ($coordinates) { "logged out" } else { "logged out (unknown location)" }
        }
        
        return @{
            Timestamp = $timestamp
            IpAddress = $ipAddress  
            SteamId = $steamId
            PlayerName = $playerName
            PlayerId = $playerId
            Type = $type
            Action = $actionDesc
            IsDrone = $isDrone
            Coordinates = $coordinates
            Location = $location
            RawLine = $LogLine
        }
    }
    
    return $null
}

# ===============================================================
# DATABASE INTEGRATION
# ===============================================================
function Save-LoginEventToDatabase {
    param(
        [hashtable]$LoginEvent
    )
    
    try {
        # Check if database is available
        if (-not $script:ServerDbPath -or -not (Test-Path $script:ServerDbPath)) {
            Write-Log "Server database not available, skipping database save" -Level "Debug"
            return
        }
        
        if (-not $script:SqlitePath -or -not (Test-Path $script:SqlitePath)) {
            Write-Log "SQLite executable not available, skipping database save" -Level "Debug"
            return
        }
        
        # Validate event data
        if (-not $LoginEvent -or -not $LoginEvent.PlayerName) {
            Write-Log "Invalid login event data for database save (missing PlayerName)" -Level "Debug"
            return
        }
        
        # Determine which ID to use - prefer PlayerId (SCUM internal), fallback to SteamId
        $userId = $null
        if ($LoginEvent.PlayerId -and $null -ne $LoginEvent.PlayerId) {
            $userId = $LoginEvent.PlayerId
            Write-Log "Using SCUM PlayerId for database: $userId (Player: $($LoginEvent.PlayerName))" -Level "Info"
        } elseif ($LoginEvent.SteamId) {
            $userId = $LoginEvent.SteamId
            Write-Log "Using SteamId as fallback for database: $userId (Player: $($LoginEvent.PlayerName))" -Level "Info"
        } else {
            Write-Log "No valid user ID found (neither PlayerId nor SteamId)" -Level "Debug"
            return
        }
        
        # Convert timestamp to proper format (SCUM uses format: 2025.07.19-10.01.13)
        $loginTime = $null
        $logoutTime = $null
        
        try {
            # Parse SCUM timestamp format to DateTime
            if ($LoginEvent.Timestamp -match "^(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})$") {
                $year = $matches[1]
                $month = $matches[2]
                $day = $matches[3]
                $hour = $matches[4]
                $minute = $matches[5]
                $second = $matches[6]
                
                $dateTime = [DateTime]::new($year, $month, $day, $hour, $minute, $second)
                $formattedTime = $dateTime.ToString("yyyy-MM-dd HH:mm:ss")
                
                if ($LoginEvent.Type -eq "LOGIN") {
                    $loginTime = $formattedTime
                } else {
                    $logoutTime = $formattedTime
                }
            }
        } catch {
            Write-Log "Failed to parse timestamp: $($LoginEvent.Timestamp)" -Level "Debug"
        }
        
        # Update user profile in database
        if ($LoginEvent.Type -eq "LOGIN") {
            # Try UPDATE first, then INSERT if no rows affected
            $updateSql = @"
-- Try to update existing user first
UPDATE a_user_profile 
SET user_name = '$($LoginEvent.PlayerName -replace "'", "''")' ,
    steam_id = '$($LoginEvent.SteamId)',
    user_ip = '$($LoginEvent.IpAddress)',
    last_login_time = '$loginTime',
    user_is_online = 1,
    last_update = CURRENT_TIMESTAMP
WHERE user_id = '$userId';

-- Insert new user only if UPDATE didn't affect any rows
INSERT INTO a_user_profile (
    user_id, 
    steam_id,
    user_name, 
    user_ip, 
    flag_id,
    last_login_time, 
    last_logout_time,
    user_is_online,
    last_update
) 
SELECT 
    '$userId',
    '$($LoginEvent.SteamId)',
    '$($LoginEvent.PlayerName -replace "'", "''")',
    '$($LoginEvent.IpAddress)',
    NULL,
    '$loginTime',
    NULL,
    1,
    CURRENT_TIMESTAMP
WHERE changes() = 0;
"@
        } else {
            # LOGOUT: Try UPDATE first, then INSERT if no rows affected
            $updateSql = @"
-- Try to update existing user first
UPDATE a_user_profile 
SET steam_id = '$($LoginEvent.SteamId)',
    last_logout_time = '$logoutTime',
    user_is_online = 0,
    last_update = CURRENT_TIMESTAMP
WHERE user_id = '$userId';

-- Insert new user only if UPDATE didn't affect any rows
INSERT INTO a_user_profile (
    user_id, 
    steam_id,
    user_name, 
    user_ip, 
    flag_id,
    last_login_time, 
    last_logout_time,
    user_is_online,
    last_update
) 
SELECT 
    '$userId',
    '$($LoginEvent.SteamId)',
    '$($LoginEvent.PlayerName -replace "'", "''")',
    '$($LoginEvent.IpAddress)',
    NULL,
    NULL,
    '$logoutTime',
    0,
    CURRENT_TIMESTAMP
WHERE changes() = 0;
"@
        }
        
        # Execute SQL command
        $tempSqlFile = [System.IO.Path]::GetTempFileName() + ".sql"
        Set-Content -Path $tempSqlFile -Value $updateSql -Encoding UTF8
        
        try {
            $result = & $script:SqlitePath $script:ServerDbPath ".read $tempSqlFile" 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Log "Login event saved to database: $($LoginEvent.PlayerName) $($LoginEvent.Type)" -Level "Debug"
            } else {
                Write-Log "Failed to save login event to database (exit code: $LASTEXITCODE): $result" -Level "Warning"
            }
        } finally {
            # Clean up temp file
            if (Test-Path $tempSqlFile) {
                Remove-Item $tempSqlFile -Force -ErrorAction SilentlyContinue
            }
        }
        
    } catch {
        Write-Log "Error saving login event to database: $($_.Exception.Message)" -Level "Warning"
    }
}

# ===============================================================
# DISCORD INTEGRATION
# ===============================================================
function Send-LoginEventToDiscord {
    param(
        [hashtable]$LoginEvent
    )
    
    try {
        # Validate event data
        if (-not $LoginEvent -or -not $LoginEvent.Type) {
            Write-Log "Invalid login event data, skipping Discord notification" -Level "Debug"
            return
        }
        
        # Try to use embed format
        if (Get-Command "Send-LoginEmbed" -ErrorAction SilentlyContinue) {
            try {
                Write-Log "Creating login embed for $($LoginEvent.PlayerName)" -Level "Debug"
                $embedData = Send-LoginEmbed -LoginEvent $LoginEvent
                Write-Log "Login embed data created successfully" -Level "Debug"
                
                if (Get-Command "Send-DiscordMessage" -ErrorAction SilentlyContinue) {
                    Write-Log "Sending login embed to Discord..." -Level "Debug"
                    $result = Send-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:Config.Channel -Embed $embedData
                    if ($result -and $result.success) {
                        Write-Log "Login event embed sent successfully" -Level "Info"
                        return
                    } else {
                        Write-Log "Login event embed failed to send: $($result | ConvertTo-Json)" -Level "Warning"
                    }
                } else {
                    Write-Log "Send-DiscordMessage command not found" -Level "Warning"
                }
            } catch {
                Write-Log "Error creating login embed: $($_.Exception.Message)" -Level "Warning"
            }
        } else {
            Write-Log "Send-LoginEmbed function not found" -Level "Warning"
        }
        
    } catch {
        Write-Log "Error in Send-LoginEventToDiscord: $($_.Exception.Message)" -Level "Error"
    }
}

function Apply-MessageFilter {
    param([string]$Message)
    
    # Start with the original message
    $result = $Message
    
    # Remove excessive repeated characters (only for spam prevention)
    $result = $result -replace '(.)\1{4,}', '$1$1$1'
    
    # Remove excessive caps (convert to title case if too many caps)
    if ($result -cmatch '[A-Z]{10,}') {
        $result = $result.ToLower()
        $result = (Get-Culture).TextInfo.ToTitleCase($result)
    }
    
    # Remove only dangerous control characters (keep Unicode printable chars)
    $result = $result -replace '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', ''
    
    # Escape Discord special sequences to prevent exploits
    $result = $result -replace '```', '`‌`‌`'
    $result = $result -replace '@everyone', '@‌everyone'
    $result = $result -replace '@here', '@‌here'
    
    # Keep all Unicode characters (Czech, Russian, etc.)
    # Discord supports Unicode, so we don't need to replace them
    
    # Ensure not empty
    if ([string]::IsNullOrWhiteSpace($result)) {
        $result = "[filtered message]"
    }
    
    return $result
}

# ===============================================================
# EXPORTS
# ===============================================================
Export-ModuleMember -Function @(
    'Initialize-LoginLogModule',
    'ConvertFrom-LoginLine',
    'Update-LoginLogProcessing',
    'Get-NewLoginEvents',
    'Get-LatestLoginLogFile',
    'Send-LoginEventToDiscord',
    'Save-LoginEventToDatabase',
    'Apply-MessageFilter',
    'Save-LoginState',
    'Load-LoginState'
)


