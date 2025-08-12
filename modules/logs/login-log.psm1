# ===============================================================
# SCUM Server Automation - Discord Login Log Manager
# ===============================================================
# Real-time login log monitoring and Discord relay system
# ===============================================================

# Standard import of common module
try {
    $helperPath = Join-Path $PSScriptRoot "..\core\module-helper.psm1"
    if (Test-Path $helperPath) {
        Import-Module $helperPath -Force -ErrorAction SilentlyContinue
        Import-CommonModule | Out-Null
    }
    
    # Import embed templates
    $embedPath = Join-Path $PSScriptRoot "..\communication\discord\templates\log-embed-templates.psm1"
    if (Test-Path $embedPath) {
        Import-Module $embedPath -Force -ErrorAction SilentlyContinue
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
        # Read all lines from the log file - SCUM login logs use UTF-16 LE encoding
        $allLines = Get-Content $script:CurrentLogFile -Encoding Unicode -ErrorAction SilentlyContinue
        
        if (-not $allLines -or $allLines.Count -eq 0) {
            return @()
        }
        
        # Get only new lines since last check
        $newLines = @()
        if ($script:LastLineNumber -lt $allLines.Count) {
            $newLines = $allLines[$script:LastLineNumber..($allLines.Count - 1)]
            $script:LastLineNumber = $allLines.Count
        }
        
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
                    $newEvents += $parsedEvent
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
                # Read current file and set position to end
                try {
                    $allLines = Get-Content $script:CurrentLogFile -Encoding Unicode -ErrorAction SilentlyContinue
                    $script:LastLineNumber = if ($allLines) { $allLines.Count } else { 0 }
                    Write-Log "Initialized login log state: File=$($script:CurrentLogFile), Starting from line $($script:LastLineNumber)" -Level "Info"
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
    'Apply-MessageFilter',
    'Save-LoginState',
    'Load-LoginState'
)


