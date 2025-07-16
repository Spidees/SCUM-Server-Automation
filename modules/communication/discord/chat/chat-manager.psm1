# ===============================================================
# SCUM Server Automation - Discord Chat Manager
# ===============================================================
# Real-time chat monitoring and Discord relay system
# Processes game chat and forwards to Discord channels
# ===============================================================

# Global variables
$script:ChatConfig = $null
$script:DiscordConfig = $null
$script:ChatLogDirectory = $null
$script:CurrentLogFile = $null
$script:IsMonitoring = $false
$script:LastLineNumber = 0
$script:StateFile = $null
$script:IsRelayActive = $false
$script:LastDebugTime = $null
$script:LastFileDebugTime = $null

# ===============================================================
# INITIALIZATION
# ===============================================================
function Initialize-ChatManager {
    param([hashtable]$Config)
    
    try {
        Write-Host "[ChatManager] Initializing chat management system..." -ForegroundColor Cyan
        
        # Initialize configuration
        $script:DiscordConfig = $Config.Discord
        if (-not $script:DiscordConfig -or -not $script:DiscordConfig.Token) {
            Write-Host "[ChatManager] Discord not configured, chat relay disabled" -ForegroundColor Yellow
            return $false
        }
        
        $script:ChatConfig = $script:DiscordConfig.ChatRelay
        if (-not $script:ChatConfig -or -not $script:ChatConfig.Enabled) {
            Write-Host "[ChatManager] Chat relay not enabled in configuration" -ForegroundColor Gray
            return $false
        }
        
        # Initialize chat log directory
        $serverDir = $Config.serverDir
        if (-not $serverDir) {
            Write-Host "[ChatManager] Server directory not configured" -ForegroundColor Red
            return $false
        }
        
        $script:ChatLogDirectory = Join-Path $serverDir "SCUM\Saved\SaveFiles\Logs"
        Write-Host "[ChatManager] Chat log directory: $script:ChatLogDirectory" -ForegroundColor Gray
        
        if (-not (Test-Path $script:ChatLogDirectory)) {
            Write-Host "[ChatManager] Chat log directory not found: $script:ChatLogDirectory" -ForegroundColor Red
            return $false
        }
        
        # Initialize state persistence
        $stateDir = ".\state"
        if (-not (Test-Path $stateDir)) {
            New-Item -Path $stateDir -ItemType Directory -Force | Out-Null
        }
        $script:StateFile = Join-Path $stateDir "chat-manager.json"
        
        # Load previous state
        Load-ChatState
        
        # Mark as active
        $script:IsMonitoring = $true
        $script:IsRelayActive = $true
        
        Write-Host "[ChatManager] Chat management system initialized successfully" -ForegroundColor Green
        Write-Host "[ChatManager] Players channel: $($script:ChatConfig.Channels.Players)" -ForegroundColor Gray
        Write-Host "[ChatManager] Admin channel: $($script:ChatConfig.Channels.Admin)" -ForegroundColor Gray
        Write-Host "[ChatManager] Update interval: $($script:ChatConfig.UpdateInterval) seconds" -ForegroundColor Gray
        
        return $true
    } catch {
        Write-Host "[ChatManager] Failed to initialize: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# ===============================================================
# CHAT LOG PARSING
# ===============================================================
function Parse-ChatLine {
    param([string]$Line)
    
    # SCUM chat log pattern: 2025.07.13-10.47.24: '76561198079911047:Nikynka(51)' 'Local: local'
    if ($Line -match "^([\d.-]+):\s+'([\d]+):([^(]+)\((\d+)\)'\s+'([^:]+):\s*(.+)'$") {
        $date = $matches[1]
        $steamId = $matches[2]
        $nickname = $matches[3].Trim()
        $playerId = $matches[4]
        $chatType = $matches[5].ToLower()
        $message = $matches[6]
        
        try {
            # Parse date: 2025.06.21-08.51.51 -> 2025/06/21 08:51:51
            $datePart = $date -replace '\.', '/' -replace '-', ' '
            $timestamp = [datetime]::ParseExact($datePart, "yyyy/MM/dd HH.mm.ss", $null)
        } catch {
            $timestamp = Get-Date
        }
        
        return @{
            Timestamp = $timestamp
            SteamId = $steamId
            Nickname = $nickname
            PlayerId = $playerId
            Message = $message
            Type = $chatType
            RawLine = $Line
        }
    }
    
    return $null
}

# ===============================================================
# CHAT MONITORING
# ===============================================================
function Update-ChatManager {
    if (-not $script:IsMonitoring -or -not $script:IsRelayActive) {
        return
    }
    
    # Debug: Print every 5 minutes instead of 60 seconds
    $currentTime = Get-Date
    if (-not $script:LastDebugTime -or ($currentTime - $script:LastDebugTime).TotalSeconds -ge 300) {
        Write-Host "[ChatManager] Monitoring active" -ForegroundColor Gray
        $script:LastDebugTime = $currentTime
    }
    
    try {
        $newMessages = Get-NewChatMessages
        
        if (-not $newMessages -or $newMessages.Count -eq 0) {
            return
        }
        
        foreach ($message in $newMessages) {
            Write-Host "[ChatManager] [$($message.Type)] $($message.Nickname): $($message.Message)" -ForegroundColor Yellow
            Send-ChatMessageToDiscord -Message $message
        }
        
        # Save state after processing
        Save-ChatState
        
    } catch {
        Write-Host "[ChatManager] Error during chat update: $($_.Exception.Message)" -ForegroundColor Red
    }
}

function Get-NewChatMessages {
    # Get the latest chat log file
    $latestChatLog = Get-LatestChatLogFile
    if (-not $latestChatLog) {
        return @()
    }
    
    # Check if we're monitoring a different file now
    if ($script:CurrentLogFile -ne $latestChatLog) {
        Write-Host "[ChatManager] Switching to new chat log: $latestChatLog" -ForegroundColor Yellow
        $script:CurrentLogFile = $latestChatLog
        $script:LastLineNumber = 0  # Reset line counter for new file
    }
    
    if (-not (Test-Path $script:CurrentLogFile)) {
        Write-Host "[ChatManager] Chat log file not found: $script:CurrentLogFile" -ForegroundColor Yellow
        return @()
    }
    
    try {
        # Read all lines from the log file - SCUM chat logs use UTF-16 LE encoding
        $allLines = Get-Content $script:CurrentLogFile -Encoding Unicode -ErrorAction SilentlyContinue
        
        if (-not $allLines -or $allLines.Count -eq 0) {
            return @()
        }
        
        # Debug info every 5 minutes instead of 60 seconds
        if (-not $script:LastFileDebugTime -or ((Get-Date) - $script:LastFileDebugTime).TotalSeconds -ge 300) {
            Write-Host "[ChatManager] File: $($allLines.Count) lines, position: $($script:LastLineNumber)" -ForegroundColor Gray
            $script:LastFileDebugTime = Get-Date
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
        
        # Parse chat messages from new lines (with minimal logging)
        $newMessages = @()
        foreach ($line in $newLines) {
            if (-not [string]::IsNullOrWhiteSpace($line) -and $line -notmatch "Game version:") {
                $parsedMessage = Parse-ChatLine -Line $line
                if ($parsedMessage) {
                    # Check if this chat type is enabled
                    if ($script:ChatConfig.ChatTypes -and $script:ChatConfig.ChatTypes[$parsedMessage.Type]) {
                        $newMessages += $parsedMessage
                    }
                }
            }
        }
        
        return $newMessages
        
    } catch {
        Write-Host "[ChatManager] Error reading chat log: $($_.Exception.Message)" -ForegroundColor Red
        return @()
    }
}

function Get-LatestChatLogFile {
    try {
        # Get all chat log files
        $chatFiles = Get-ChildItem -Path $script:ChatLogDirectory -Filter "chat_*.log" -ErrorAction SilentlyContinue
        
        if (-not $chatFiles -or $chatFiles.Count -eq 0) {
            Write-Host "[ChatManager] No chat log files found in $script:ChatLogDirectory" -ForegroundColor Yellow
            return $null
        }
        
        # Sort by creation time and get the latest
        $latestFile = $chatFiles | Sort-Object CreationTime -Descending | Select-Object -First 1
        return $latestFile.FullName
        
    } catch {
        Write-Host "[ChatManager] Error finding latest chat log: $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

# ===============================================================
# DISCORD INTEGRATION
# ===============================================================
function Send-ChatMessageToDiscord {
    param($Message)
    
    try {
        # Check if this chat type is enabled
        if (-not $script:ChatConfig.ChatTypes[$Message.Type]) {
            return
        }
        
        # Check message length
        $maxLength = if ($script:ChatConfig.MaxMessageLength) { $script:ChatConfig.MaxMessageLength } else { 500 }
        $messageText = $Message.Message
        if ($messageText.Length -gt $maxLength) {
            $messageText = $messageText.Substring(0, $maxLength - 3) + "..."
        }
        
        # Filter nickname and message for Discord compatibility
        $filteredNickname = Apply-MessageFilter -Message $Message.Nickname
        $filteredMessage = Apply-MessageFilter -Message $messageText
        
        # Additional Discord safety checks
        # Ensure proper encoding and length
        $filteredMessage = $filteredMessage.Trim()
        if ($filteredMessage.Length -eq 0) {
            Write-Host "[ChatManager] Message is empty after filtering, skipping" -ForegroundColor Yellow
            return
        }
        
        # Ensure message doesn't exceed Discord's limit (2000 characters)
        if ($filteredMessage.Length -gt 2000) {
            $filteredMessage = $filteredMessage.Substring(0, 1997) + "..."
        }
        
        # Format message based on chat type without emoji for admin channel
        $adminFormatTemplate = $script:ChatConfig.MessageFormat.PlayerMessage
        if ($Message.Type -eq "squad") {
            $adminFormatTemplate = "[SQUAD] **{nickname}**: {message}"
        } elseif ($Message.Type -eq "local") {
            $adminFormatTemplate = "[LOCAL] **{nickname}**: {message}"
        } elseif ($Message.Type -eq "global") {
            $adminFormatTemplate = "[GLOBAL] **{nickname}**: {message}"
        }
        
        # Format message for players channel (only global messages)
        $playerFormatTemplate = "**{nickname}**: {message}"
        
        # Send to Admin channel (all message types)
        $adminFormattedMessage = $adminFormatTemplate -replace '\{nickname\}', $filteredNickname -replace '\{message\}', $filteredMessage
        
        if (Get-Command "Send-DiscordMessage" -ErrorAction SilentlyContinue) {
            # Always send to admin channel
            try {
                $result = Send-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:ChatConfig.Channels.Admin -Content $adminFormattedMessage
                if ($result -and $result.success) {
                    Write-Host "[ChatManager] OK Admin" -ForegroundColor Green -NoNewline
                } else {
                    Write-Host "[ChatManager] FAIL Admin" -ForegroundColor Red -NoNewline
                }
            } catch {
                Write-Host "[ChatManager] ERROR Admin: $($_.Exception.Message)" -ForegroundColor Red -NoNewline
            }
            
            # Send to Players channel only for global messages
            if ($Message.Type -eq "global") {
                try {
                    $playerFormattedMessage = $playerFormatTemplate -replace '\{nickname\}', $filteredNickname -replace '\{message\}', $filteredMessage
                    $result = Send-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:ChatConfig.Channels.Players -Content $playerFormattedMessage
                    if ($result -and $result.success) {
                        Write-Host " | OK Players" -ForegroundColor Green
                    } else {
                        Write-Host " | FAIL Players" -ForegroundColor Red
                    }
                } catch {
                    Write-Host " | ERROR Players: $($_.Exception.Message)" -ForegroundColor Red
                }
            } else {
                Write-Host "" # New line for non-global messages
            }
        } else {
            Write-Host "[ChatManager] Discord message function not available" -ForegroundColor Yellow
        }
        
    } catch {
        Write-Host "[ChatManager] Error sending message to Discord: $($_.Exception.Message)" -ForegroundColor Red
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
# STATE PERSISTENCE
# ===============================================================
function Save-ChatState {
    try {
        $state = @{
            CurrentLogFile = $script:CurrentLogFile
            LastLineNumber = $script:LastLineNumber
            LastUpdate = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        }
        
        $stateJson = $state | ConvertTo-Json
        Set-Content -Path $script:StateFile -Value $stateJson -Encoding UTF8
        
    } catch {
        Write-Host "[ChatManager] Failed to save state: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

function Load-ChatState {
    try {
        if (Test-Path $script:StateFile) {
            $stateJson = Get-Content -Path $script:StateFile -Raw -Encoding UTF8
            $state = $stateJson | ConvertFrom-Json
            
            $script:CurrentLogFile = if ($state.CurrentLogFile) { $state.CurrentLogFile } else { $null }
            $script:LastLineNumber = if ($state.LastLineNumber) { $state.LastLineNumber } else { 0 }
            
            # Verify the saved log file still exists, if not reset
            if ($script:CurrentLogFile -and -not (Test-Path $script:CurrentLogFile)) {
                Write-Host "[ChatManager] Previous log file no longer exists, resetting state" -ForegroundColor Yellow
                $script:CurrentLogFile = $null
                $script:LastLineNumber = 0
            } else {
                Write-Host "[ChatManager] Loaded previous state: File=$($script:CurrentLogFile), Line=$($script:LastLineNumber)" -ForegroundColor Gray
            }
        } else {
            Write-Host "[ChatManager] No previous state found, starting fresh" -ForegroundColor Gray
            $script:CurrentLogFile = $null
            $script:LastLineNumber = 0
        }
    } catch {
        Write-Host "[ChatManager] Failed to load state, starting fresh: $($_.Exception.Message)" -ForegroundColor Yellow
        $script:CurrentLogFile = $null
        $script:LastLineNumber = 0
    }
}

# ===============================================================
# DEBUG FUNCTIONS
# ===============================================================
function Debug-ChatManager {
    Write-Host "=== Chat Manager Debug ===" -ForegroundColor Cyan
    Write-Host "IsMonitoring: $script:IsMonitoring" -ForegroundColor White
    Write-Host "IsRelayActive: $script:IsRelayActive" -ForegroundColor White
    Write-Host "CurrentLogFile: $script:CurrentLogFile" -ForegroundColor White
    Write-Host "LastLineNumber: $script:LastLineNumber" -ForegroundColor White
    Write-Host "ChatLogDirectory: $script:ChatLogDirectory" -ForegroundColor White
    
    # Test log file reading
    if ($script:CurrentLogFile -and (Test-Path $script:CurrentLogFile)) {
        $lines = Get-Content $script:CurrentLogFile -Encoding Unicode
        Write-Host "Total lines in current log: $($lines.Count)" -ForegroundColor White
        
        if ($lines.Count -gt $script:LastLineNumber) {
            $newLines = $lines[$script:LastLineNumber..($lines.Count - 1)]
            Write-Host "New lines to process: $($newLines.Count)" -ForegroundColor Yellow
            
            foreach ($line in $newLines) {
                if (-not [string]::IsNullOrWhiteSpace($line) -and $line -notmatch "Game version:") {
                    $parsed = Parse-ChatLine -Line $line
                    if ($parsed) {
                        Write-Host "Parsed: [$($parsed.Type)] $($parsed.Nickname): $($parsed.Message)" -ForegroundColor Green
                        
                        # Check if enabled
                        if ($script:ChatConfig.ChatTypes[$parsed.Type]) {
                            Write-Host "  -> Chat type enabled, would send to Discord" -ForegroundColor Green
                        } else {
                            Write-Host "  -> Chat type disabled, skipping" -ForegroundColor Yellow
                        }
                    } else {
                        Write-Host "Failed to parse: $line" -ForegroundColor Red
                    }
                }
            }
        } else {
            Write-Host "No new lines to process" -ForegroundColor Yellow
        }
    } else {
        Write-Host "Current log file not found!" -ForegroundColor Red
    }
    Write-Host "=========================" -ForegroundColor Cyan
}

# ===============================================================
# STATUS AND CONTROL
# ===============================================================
function Get-ChatManagerStatus {
    return @{
        IsMonitoring = $script:IsMonitoring
        IsRelayActive = $script:IsRelayActive
        CurrentLogFile = $script:CurrentLogFile
        LastLineNumber = $script:LastLineNumber
        ChatLogDirectory = $script:ChatLogDirectory
        StateFile = $script:StateFile
    }
}

function Stop-ChatManager {
    Write-Host "[ChatManager] Stopping chat management system..." -ForegroundColor Yellow
    
    # Save current state
    Save-ChatState
    
    # Mark as inactive
    $script:IsMonitoring = $false
    $script:IsRelayActive = $false
    
    Write-Host "[ChatManager] Chat management system stopped" -ForegroundColor Green
}

# ===============================================================
# EXPORTS
# ===============================================================
Export-ModuleMember -Function @(
    'Initialize-ChatManager',
    'Update-ChatManager', 
    'Get-ChatManagerStatus',
    'Stop-ChatManager',
    'Parse-ChatLine',
    'Get-NewChatMessages',
    'Get-LatestChatLogFile',
    'Debug-ChatManager',
    'Apply-MessageFilter'
)
