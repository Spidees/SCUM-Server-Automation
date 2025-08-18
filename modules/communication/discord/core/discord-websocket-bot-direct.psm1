# ===============================================================
# SCUM Server Automation - Discord WebSocket Bot
# ===============================================================
# Real-time Discord bot connection using WebSocket API
# Stable version for production use
# ===============================================================

# Standard import of common module
try {
    $helperPath = Join-Path $PSScriptRoot "..\..\..\core\module-helper.psm1"
    if (Test-Path $helperPath) {
        # MEMORY LEAK FIX: Check if module already loaded before importing
        if (-not (Get-Module "module-helper" -ErrorAction SilentlyContinue)) {
            Import-Module $helperPath -ErrorAction SilentlyContinue
        }
        Import-CommonModule | Out-Null
    }
} catch {
    Write-Host "[WARNING] Common module not available for discord-websocket-bot-direct module" -ForegroundColor Yellow
}

# Global variables - simplified
$script:IsConnected = $false
$script:WebSocket = $null
$script:BotToken = ""
$script:HeartbeatInterval = 0
$script:NextHeartbeat = 0
$script:SequenceNumber = $null
$script:AuthComplete = $false
$script:IsFullyConnected = $false
$script:FragmentBuffer = ""
$script:LastHeartbeatAck = $true
$script:LastHeartbeatAckTime = 0
$script:ConnectionStartTime = 0
$script:CurrentActivity = $null
$script:CurrentStatus = "online"
$script:HeartbeatTimer = $null
$script:UseManualHeartbeatOnly = $false

# Helper function for timer to check connection state
function Test-BotConnection {
    return ($script:IsConnected -and $script:WebSocket -and $script:WebSocket.State -eq 'Open' -and $script:AuthComplete -and $script:IsFullyConnected)
}

function Start-DiscordWebSocketBot {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Token,
        
        [Parameter()]
        [string]$Status = "online",
        
        [Parameter()]
        [string]$Activity = "SCUM Server Automation",
        
        [Parameter()]
        [string]$ActivityType = "Watching"
    )
    
    Write-Log "[DISCORD-BOT] Starting Discord WebSocket bot..." -Level Info
    
    # Check if bot is actually connected and WebSocket is functional
    if ($script:IsConnected -and $script:WebSocket -and $script:WebSocket.State -eq 'Open') {
        Write-Log "[DISCORD-BOT] Bot already connected and functional" -Level Warning
        return $true
    } elseif ($script:IsConnected) {
        Write-Log "[DISCORD-BOT] Bot marked as connected but WebSocket is not functional - reconnecting" -Level Warning
        Stop-DiscordWebSocketBot
    }
    
    try {
        # Get Discord Gateway
        $Gateway = Invoke-RestMethod -Uri "https://discord.com/api/gateway"
        
        # Create WebSocket
        $script:WebSocket = New-Object System.Net.WebSockets.ClientWebSocket
        $CT = New-Object System.Threading.CancellationToken
        
        # Connect
        Write-Log "[DISCORD-BOT] Connecting to Discord Gateway..." -Level Debug
        $ConnTask = $script:WebSocket.ConnectAsync($Gateway.url, $CT)
        while (!$ConnTask.IsCompleted) { Start-Sleep -Milliseconds 50 }
        
        if ($script:WebSocket.State -eq 'Open') {
            Write-Log "[DISCORD-BOT] WebSocket connected, starting handshake..." -Level Info
            
            # Initialize variables
            $script:BotToken = $Token
            $script:IsConnected = $true
            $script:AuthComplete = $false
            $script:IsFullyConnected = $false
            $script:SequenceNumber = $null
            $script:FragmentBuffer = ""  # Clear fragment buffer
            $script:LastHeartbeatAck = $true
            $script:LastHeartbeatAckTime = 0  # Reset ACK time for new connection
            $script:ConnectionStartTime = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            $script:IsConnected = $true
            $script:BotToken = $Token
            
            # Complete handshake
            $handshakeResult = Complete-DiscordHandshake -Token $Token -Activity $Activity -Status $Status
            
            if ($handshakeResult) {
                Write-Log "[DISCORD-BOT] Discord bot started successfully!" -Level Info
                $script:CurrentActivity = $Activity
                $script:CurrentStatus = $Status
                
                # Start continuous heartbeat maintenance in background
                Start-HeartbeatMaintenanceLoop
                
                return $true
            } else {
                Write-Log "[DISCORD-BOT] Handshake failed" -Level Error
                $script:IsConnected = $false
                return $false
            }
        } else {
            Write-Log "[DISCORD-BOT] Failed to connect WebSocket" -Level Error
            return $false
        }
    } catch {
        Write-Log "[DISCORD-BOT] Error starting bot: $($_.Exception.Message)" -Level Error
        $script:IsConnected = $false
        return $false
    }
}

function Complete-DiscordHandshake {
    param($Token, $Activity, $Status)
    
    try {
        $CT = New-Object System.Threading.CancellationToken
        $attempts = 0
        $maxAttempts = 100
        $receivedHello = $false
        $sentAuth = $false
        
        Write-Log "[DISCORD-BOT] Starting handshake process (max attempts: $maxAttempts)..." -Level Debug
        
        while ($script:WebSocket.State -eq 'Open' -and $attempts -lt $maxAttempts -and -not $script:AuthComplete) {
            $attempts++
            
            if ($attempts % 10 -eq 0) {
                Write-Log "[DISCORD-BOT] Handshake attempt $attempts/$maxAttempts - still waiting for Discord..." -Level Debug
            }
            
            # Send heartbeat if needed
            if ($script:HeartbeatInterval -gt 0) {
                $CurrentTime = [int64]((New-TimeSpan -Start (Get-Date "01/01/1970") -End (Get-Date)).TotalMilliseconds)
                if ($CurrentTime -ge $script:NextHeartbeat) {
                    Send-DiscordHeartbeat
                    # Add jitter: random delay between 0-3 seconds to avoid load balancer issues
                    $jitter = Get-Random -Minimum 0 -Maximum 3000
                    $script:NextHeartbeat = $CurrentTime + $script:HeartbeatInterval + $jitter
                }
            }
            
            # Try to receive message
            $message = Receive-DiscordMessage
            if ($message) {
                Write-Log "[DISCORD-BOT] Received message (length: $($message.Length))" -Level Debug
                
                # Skip processing if message is too large (fragments, channel lists, etc.)
                if ($message.Length -gt 3000) {
                    Write-Log "[DISCORD-BOT] Skipping large message during handshake ($($message.Length) chars)" -Level Debug
                    Start-Sleep -Milliseconds 100
                    continue
                }
                
                try {
                    $data = $message | ConvertFrom-Json -ErrorAction Stop
                    Write-Log "[DISCORD-BOT] Received opcode: $($data.op)" -Level Debug
                    
                    # Update sequence number
                    if ($data.s) { $script:SequenceNumber = $data.s }
                    
                    # Handle Hello (opcode 10)
                    if ($data.op -eq 10) {
                        Write-Log "[DISCORD-BOT] Received Hello, setting up heartbeat (interval: $($data.d.heartbeat_interval))..." -Level Info
                        $script:HeartbeatInterval = [int64]$data.d.heartbeat_interval
                        # Add jitter: random delay between 0-3 seconds to avoid load balancer issues
                        $jitter = Get-Random -Minimum 0 -Maximum 3000
                        $script:NextHeartbeat = [int64]((New-TimeSpan -Start (Get-Date "01/01/1970") -End (Get-Date)).TotalMilliseconds) + $script:HeartbeatInterval + $jitter
                        $receivedHello = $true
                        
                        # Send first heartbeat
                        Write-Log "[DISCORD-BOT] Sending first heartbeat..." -Level Debug
                        Send-DiscordHeartbeat
                    }
                    
                    # Handle Heartbeat ACK (opcode 11)
                    if ($data.op -eq 11) {
                        Write-Log "[DISCORD-BOT] Heartbeat ACK received" -Level Debug
                        $script:LastHeartbeatAck = $true
                        $script:LastHeartbeatAckTime = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                        
                        # Send auth after first ACK
                        if ($receivedHello -and -not $sentAuth) {
                            Write-Log "[DISCORD-BOT] Sending authentication..." -Level Info
                            Send-DiscordAuth -Token $Token
                            $sentAuth = $true
                        }
                    }
                    
                    # Handle Ready event
                    if ($data.t -eq "READY") {
                        Write-Log "[DISCORD-BOT] Received READY - authentication complete!" -Level Info
                        $script:AuthComplete = $true
                        $script:IsFullyConnected = $true
                        Write-Log "[DISCORD-BOT] IsFullyConnected flag set to: $script:IsFullyConnected" -Level Debug
                        
                        # Set initial status
                        Write-Log "[DISCORD-BOT] Setting initial status: $Activity" -Level Debug
                        Set-DiscordBotStatus -Status $Status -Activity $Activity -ActivityType "Watching"
                        
                        # Start automatic heartbeat timer
                        Start-AutomaticHeartbeat
                        
                        return $true
                    }
                    
                    # Handle Invalid Session (opcode 9)
                    if ($data.op -eq 9) {
                        Write-Log "[DISCORD-BOT] Invalid session received - token may be invalid" -Level Error
                        return $false
                    }
                } catch {
                    Write-Log "[DISCORD-BOT] JSON parsing error during handshake: $($_.Exception.Message)" -Level Debug
                    # Continue trying - this might be a fragmented message
                }
            }
            
            Start-Sleep -Milliseconds 200
        }
        
        if ($script:AuthComplete) {
            return $true
        } else {
            Write-Log "[DISCORD-BOT] Handshake timeout after $attempts attempts. State: Hello=$receivedHello, Auth=$sentAuth, WebSocket=$($script:WebSocket.State)" -Level Warning
            return $false
        }
        
    } catch {
        Write-Log "[DISCORD-BOT] Handshake error: $($_.Exception.Message)" -Level Error
        return $false
    }
}

function Send-DiscordHeartbeat {
    try {
        if (-not $script:IsConnected -or $script:WebSocket.State -ne 'Open') { 
            Write-Log "[DISCORD-BOT] Cannot send heartbeat - Connected:$script:IsConnected, WebSocket state: $($script:WebSocket.State)" -Level Warning
            $script:IsConnected = $false
            return 
        }
        
        $heartbeat = @{ 'op' = 1; 'd' = $script:SequenceNumber } | ConvertTo-Json
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($heartbeat)
        $segment = New-Object System.ArraySegment[byte] -ArgumentList @(, $bytes)
        $CT = New-Object System.Threading.CancellationToken
        
        Write-Log "[DISCORD-BOT] Sending heartbeat (seq: $script:SequenceNumber)..." -Level Debug
        $sendTask = $script:WebSocket.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $CT)
        
        # Wait with timeout
        $timeout = 10000  # 10 seconds
        $start = Get-Date
        while (!$sendTask.IsCompleted -and ((Get-Date) - $start).TotalMilliseconds -lt $timeout) { 
            Start-Sleep -Milliseconds 10 
        }
        
        if (!$sendTask.IsCompleted) {
            Write-Log "[DISCORD-BOT] Heartbeat send timeout after $timeout ms - marking as disconnected" -Level Warning
            $script:IsConnected = $false
            $script:IsFullyConnected = $false
            return
        }
        
        if ($sendTask.IsFaulted) {
            Write-Log "[DISCORD-BOT] Heartbeat send failed: $($sendTask.Exception.Message) - marking as disconnected" -Level Warning
            $script:IsConnected = $false
            $script:IsFullyConnected = $false
            return
        }
        
        Write-Log "[DISCORD-BOT] Heartbeat sent successfully" -Level Debug
        $script:LastHeartbeatAck = $false
        Write-Log "[DISCORD-BOT] Waiting for heartbeat ACK (LastHeartbeatAck set to false)" -Level Debug
        
    } catch {
        Write-Log "[DISCORD-BOT] Heartbeat send error: $($_.Exception.Message) - marking as disconnected" -Level Warning
        $script:IsConnected = $false
        $script:IsFullyConnected = $false
    }
}

function Send-DiscordAuth {
    param($Token)
    
    try {
        $auth = @{
            'op' = 2
            'd' = @{
                'token' = $Token
                'intents' = 513  # GUILDS + GUILD_MESSAGES
                'properties' = @{
                    '$os' = 'windows'
                    '$browser' = 'SCUM-Server-Manager'
                    '$device' = 'SCUM-Server-Manager'
                }
            }
        } | ConvertTo-Json -Depth 3
        
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($auth)
        $segment = New-Object System.ArraySegment[byte] -ArgumentList @(, $bytes)
        $CT = New-Object System.Threading.CancellationToken
        
        $sendTask = $script:WebSocket.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $CT)
        while (!$sendTask.IsCompleted) { Start-Sleep -Milliseconds 10 }
        
        Write-Log "[DISCORD-BOT] Authentication sent" -Level Debug
        
    } catch {
        Write-Log "[DISCORD-BOT] Auth send error: $($_.Exception.Message)" -Level Error
    }
}

function Receive-DiscordMessage {
    try {
        if (-not $script:WebSocket -or $script:WebSocket.State -ne 'Open') {
            Write-Log "[DISCORD-BOT] Cannot receive - WebSocket not open (State: $($script:WebSocket.State))" -Level Debug
            $script:IsConnected = $false
            $script:AuthComplete = $false
            return $null
        }
        
        $buffer = New-Object byte[] 8192  # Increased buffer size
        $segment = New-Object System.ArraySegment[byte] -ArgumentList @(, $buffer)
        $CT = New-Object System.Threading.CancellationToken
        
        $receiveTask = $script:WebSocket.ReceiveAsync($segment, $CT)
        
        # Timeout for receive operation
        $timeout = 1000  # 1 second
        $startTime = Get-Date
        while (!$receiveTask.IsCompleted -and ((Get-Date) - $startTime).TotalMilliseconds -lt $timeout) {
            Start-Sleep -Milliseconds 50
        }
        
        if ($receiveTask.IsCompleted) {
            $result = $receiveTask.Result
            
            # Check if connection was closed
            if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
                Write-Log "[DISCORD-BOT] WebSocket connection closed by remote" -Level Warning
                $script:IsConnected = $false
                $script:AuthComplete = $false
                return $null
            }
            
            $messageFragment = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)
            
            # Handle fragmented messages
            if (-not $result.EndOfMessage) {
                # This is a fragment, add to buffer
                $script:FragmentBuffer += $messageFragment
                Write-Log "[DISCORD-BOT] Received message fragment, buffering..." -Level Debug
                return $null  # Wait for complete message
            } else {
                # Complete message or final fragment
                if ($script:FragmentBuffer) {
                    # We had fragments, combine with final part
                    $message = $script:FragmentBuffer + $messageFragment
                    $script:FragmentBuffer = ""  # Clear buffer
                    Write-Log "[DISCORD-BOT] Assembled complete message from $([Math]::Round(($script:FragmentBuffer.Length + $messageFragment.Length) / 1024, 1)) KB of fragments" -Level Debug
                } else {
                    # Single complete message
                    $message = $messageFragment
                }
            }
            
            # Basic check for empty messages
            if ([string]::IsNullOrWhiteSpace($message)) {
                return $null
            }
            
            # For very large messages (like guild info), just log and skip
            if ($message.Length -gt 50000) {
                Write-Log "[DISCORD-BOT] Received very large message ($([Math]::Round($message.Length / 1024, 1)) KB), skipping processing" -Level Debug
                return $null
            }
            
            # Try to parse as JSON to validate
            try {
                $null = $message | ConvertFrom-Json -ErrorAction Stop
                return $message
            } catch {
                # If it's not valid JSON, it might be a partial message or non-JSON data
                Write-Log "[DISCORD-BOT] Received non-JSON data (length: $($message.Length)): '$($message.Substring(0, [Math]::Min(200, $message.Length)))...'" -Level Debug
                return $null
            }
            
        } else {
            return $null
        }
        
    } catch {
        Write-Log "[DISCORD-BOT] Receive error: $($_.Exception.Message)" -Level Debug
        # Don't immediately mark as disconnected on receive errors
        return $null
    }
}

function Set-DiscordBotStatus {
    param(
        [Parameter()]
        [string]$Status = "online",
        
        [Parameter()]
        [string]$Activity = "SCUM Server Automation",
        
        [Parameter()]
        [string]$ActivityType = "Watching"
    )
    
    try {
        if (-not $script:IsConnected -or $script:WebSocket.State -ne 'Open') { 
            Write-Log "[DISCORD-BOT] Cannot set status - bot not connected" -Level Warning
            return $false
        }
        
        # Convert ActivityType to Discord type number
        $activityTypeNum = switch ($ActivityType) {
            "Playing" { 0 }
            "Streaming" { 1 }
            "Listening" { 2 }
            "Watching" { 3 }
            "Custom" { 4 }
            "Competing" { 5 }
            default { 3 }  # Watching as default
        }
        
        $presence = @{
            'op' = 3
            'd' = @{
                'since' = $null
                'activities' = @(
                    @{
                        'name' = $Activity
                        'type' = $activityTypeNum
                    }
                )
                'status' = $Status.ToLower()
                'afk' = $false
            }
        } | ConvertTo-Json -Depth 4
        
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($presence)
        $segment = New-Object System.ArraySegment[byte] -ArgumentList @(, $bytes)
        $CT = New-Object System.Threading.CancellationToken
        
        $sendTask = $script:WebSocket.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $CT)
        while (!$sendTask.IsCompleted) { Start-Sleep -Milliseconds 10 }
        
        Write-Log "[DISCORD-BOT] Status updated: $Activity ($ActivityType)" -Level Debug
        $script:CurrentActivity = $Activity
        $script:CurrentStatus = $Status
        return $true
        
    } catch {
        Write-Log "[DISCORD-BOT] Status update error: $($_.Exception.Message)" -Level Warning
        return $false
    }
}

function Maintain-DiscordHeartbeat {
    try {
        if (-not $script:IsConnected) {
            return $false
        }
        
        if ($script:WebSocket.State -ne 'Open') {
            $script:IsConnected = $false
            return $false
        }
        
        if (-not $script:AuthComplete) {
            return $false
        }
        
        $CurrentTime = [int64]((New-TimeSpan -Start (Get-Date "01/01/1970") -End (Get-Date)).TotalMilliseconds)
        
        if (-not $script:LastHeartbeatSent -or $script:LastHeartbeatSent -le 0) {
            $script:LastHeartbeatSent = $CurrentTime - 35000
        }
        
        $timeSinceLastSent = $CurrentTime - $script:LastHeartbeatSent
        if ($timeSinceLastSent -gt 35000) {
            if ($script:WebSocket.State -ne 'Open') {
                $script:IsConnected = $false
                return $false
            }
            
            # Simple WebSocket state check - rely on HTTP API for zombie detection
            if ($script:WebSocket.State -ne 'Open') {
                Write-Log "[DISCORD-BOT] WebSocket state changed to $($script:WebSocket.State) - marking as disconnected" -Level Warning
                $script:IsConnected = $false
                $script:IsFullyConnected = $false
                return $false
            }
            
            Send-DiscordHeartbeat
            $script:LastHeartbeatSent = $CurrentTime
        }
        
        return $true
        
    } catch {
        Write-Log "[DISCORD-BOT] Heartbeat maintenance error: $($_.Exception.Message)" -Level Warning
        return $false
    }
}

function Start-HeartbeatMaintenanceLoop {
    Write-Log "[DISCORD-BOT] Starting polling-based heartbeat maintenance" -Level Info
    Write-Log "[DISCORD-BOT] Heartbeat interval: $script:HeartbeatInterval ms" -Level Debug
    Write-Log "[DISCORD-BOT] Heartbeats will be sent via polling in Maintain-DiscordHeartbeat calls" -Level Info
}

function Test-DiscordConnectionHealth {
    try {
        if (-not $script:IsConnected -or -not $script:WebSocket -or $script:WebSocket.State -ne 'Open') {
            Write-Log "[DISCORD-BOT] Connection health check failed: WebSocket not open" -Level Debug
            return $false
        }
        
        if (-not $script:AuthComplete) {
            Write-Log "[DISCORD-BOT] Connection health check failed: Authentication not complete" -Level Debug
            return $false
        }
        
        if ($script:HeartbeatInterval -le 0) {
            Write-Log "[DISCORD-BOT] Connection health check failed: No heartbeat interval set" -Level Debug
            return $false
        }
        
        Write-Log "[DISCORD-BOT] Connection health check passed (WebSocket: $($script:WebSocket.State))" -Level Debug
        return $true
        
    } catch {
        Write-Log "[DISCORD-BOT] Connection health check error: $($_.Exception.Message)" -Level Debug
        return $false
    }
}

function Restore-DiscordConnection {
    param(
        [Parameter()]
        [string]$Token,
        
        [Parameter()]
        [string]$Activity = "SCUM Server Automation",
        
        [Parameter()]
        [string]$Status = "online"
    )
    
    Write-Log "[DISCORD-BOT] Attempting to restore Discord connection..." -Level Info
    
    # Stop current connection if any
    Stop-DiscordWebSocketBot
    
    # Wait a moment before reconnecting
    Start-Sleep -Seconds 2
    
    # Restart bot
    if ($Token) {
        return Start-DiscordWebSocketBot -Token $Token -Activity $Activity -Status $Status
    } else {
        Write-Log "[DISCORD-BOT] Cannot restore connection - no token provided" -Level Error
        return $false
    }
}

function Start-AutomaticHeartbeat {
    try {
        Stop-AutomaticHeartbeat
        
        Write-Log "[DISCORD-BOT] Using stable heartbeat system (35s intervals)" -Level Info
        
        $script:LastHeartbeatSent = 0
        
        Write-Log "[DISCORD-BOT] Stable heartbeat system initialized" -Level Info
        
    } catch {
        Write-Log "[DISCORD-BOT] Failed to initialize heartbeat: $($_.Exception.Message)" -Level Error
    }
}

function Stop-AutomaticHeartbeat {
    try {
        if ($script:HeartbeatTimer) {
            $script:HeartbeatTimer.Stop()
            $script:HeartbeatTimer.Dispose()
            $script:HeartbeatTimer = $null
            Write-Log "[DISCORD-BOT] Automatic heartbeat timer stopped" -Level Debug
        }
    } catch {
        Write-Log "[DISCORD-BOT] Error stopping heartbeat timer: $($_.Exception.Message)" -Level Debug
    }
}

function Stop-DiscordWebSocketBot {
    try {
        Write-Log "[DISCORD-BOT] Stopping Discord bot..." -Level Info
        
        # Stop automatic heartbeat timer first
        Stop-AutomaticHeartbeat
        
        if ($script:WebSocket) {
            try {
                $script:WebSocket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "Bot shutdown", [System.Threading.CancellationToken]::None)
                $script:WebSocket.Dispose()
            } catch {
                Write-Log "[DISCORD-BOT] Error during WebSocket cleanup: $($_.Exception.Message)" -Level Debug
            }
        }
        
        # Reset all state variables
        $script:IsConnected = $false
        $script:WebSocket = $null
        $script:AuthComplete = $false
        $script:IsFullyConnected = $false
        $script:HeartbeatInterval = 0
        $script:NextHeartbeat = 0
        $script:SequenceNumber = $null
        $script:LastHeartbeatAck = $true
        $script:LastHeartbeatAckTime = 0
        $script:ConnectionStartTime = 0
        $script:CurrentActivity = $null
        $script:FragmentBuffer = ""  # Clear any buffered fragments
        $script:CurrentStatus = "online"
        
        Write-Log "[DISCORD-BOT] Discord bot stopped successfully" -Level Info
        
    } catch {
        Write-Log "[DISCORD-BOT] Error stopping bot: $($_.Exception.Message)" -Level Warning
    }
}

# Legacy compatibility functions for other modules
function Test-DiscordBotConnection {
    return Test-DiscordConnectionHealth
}

function Get-BotConnectionStatus {
    return @{
        IsConnected = $script:IsConnected
        AuthComplete = $script:AuthComplete
        WebSocketState = if ($script:WebSocket) { $script:WebSocket.State } else { "None" }
        CurrentActivity = $script:CurrentActivity
        CurrentStatus = $script:CurrentStatus
        HeartbeatInterval = $script:HeartbeatInterval
        LastHeartbeatAck = $script:LastHeartbeatAck
    }
}

function Set-BotActivity {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Activity,
        
        [Parameter()]
        [string]$Type = "Playing",
        
        [Parameter()]
        [string]$Status = "online"
    )
    
    return Set-DiscordBotStatus -Status $Status -Activity $Activity -ActivityType $Type
}

# Export all the functions that other modules expect
Export-ModuleMember -Function @(
    'Start-DiscordWebSocketBot',
    'Stop-DiscordWebSocketBot',
    'Set-DiscordBotStatus',
    'Test-DiscordBotConnection',
    'Test-DiscordConnectionHealth',
    'Restore-DiscordConnection',
    'Get-BotConnectionStatus',
    'Set-BotActivity',
    'Maintain-DiscordHeartbeat'
)
