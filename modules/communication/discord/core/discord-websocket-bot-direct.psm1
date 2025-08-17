# ===============================================================
# SCUM Server Automation - Discord WebSocket Bot
# ===============================================================
# Real-time Discord bot connection using WebSocket API
# Handles bot presence, status updates, and live communication
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

# Global variables
$script:WebSocket = $null
$script:BotToken = $null
$script:IsConnected = $false
$script:CurrentActivity = $null
$script:CurrentStatus = "online"
$script:AuthComplete = $false

# Heartbeat variables for persistent connection
$script:HeartbeatInterval = 0
$script:NextHeartbeat = 0
$script:SequenceNumber = $null
$script:LastHeartbeatSent = 0
$script:HeartbeatRunning = $false
$script:LastHeartbeatAck = $true
$script:HeartbeatJob = $null

# Recovery rate limiting
$script:LastRecoveryAttempt = $null
$script:RecoveryAttempts = 0

function Start-DiscordWebSocketBot {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Token,
        
        [Parameter()]
        [string]$Status = "online",
        
        [Parameter()]
        [string]$Activity = "SCUM Server Manager",
        
        [Parameter()]
        [string]$ActivityType = "Watching"
    )
    
    if ($script:IsConnected) {
        Write-Log "Discord bot is already connected" -Level Warning
        return $true
    }
    
    $script:BotToken = $Token
    $script:CurrentActivity = $Activity
    $script:CurrentStatus = $Status
    $script:AuthComplete = $false
    
    try {
        # Get gateway session
        $GatewaySession = Invoke-RestMethod -Uri "https://discord.com/api/gateway"
        
        # Create WebSocket 
        $script:WebSocket = New-Object System.Net.WebSockets.ClientWebSocket  
        $CT = New-Object System.Threading.CancellationToken
        
        # Connect
        $Conn = $script:WebSocket.ConnectAsync($GatewaySession.url, $CT)
        while (!$Conn.IsCompleted) { Start-Sleep -Milliseconds 100 }
        
        if ($script:WebSocket.State -eq 'Open') {
            $script:IsConnected = $true
            
            # Process initial handshake synchronously
            $authResult = Complete-DiscordHandshake -Token $Token -Activity $Activity -Status $Status
            
            if ($authResult) {
                return $true
            } else {
                Write-Log "Authentication failed" -Level Error
                return $false
            }
        } else {
            Write-Error "Failed to connect - WebSocket state: $($script:WebSocket.State)"
            return $false
        }
        
    } catch {
        Write-Error "Failed to start Discord bot: $($_.Exception.Message)"
        return $false
    }
}

function Complete-DiscordHandshake {
    param($Token, $Activity, $Status)
    
    try {
        $CT = New-Object System.Threading.CancellationToken
        
        # Bot intents
        $BotIntents = @('DIRECT_MESSAGES', 'GUILD_MESSAGES')
        
        # Intent calculation
        $IntentsKeys = @{
            'GUILDS'                    = 1 -shl 0
            'GUILD_MEMBERS'             = 1 -shl 1
            'GUILD_BANS'                = 1 -shl 2
            'GUILD_EMOJIS_AND_STICKERS' = 1 -shl 3
            'GUILD_INTEGRATIONS'        = 1 -shl 4
            'GUILD_WEBHOOKS'            = 1 -shl 5
            'GUILD_INVITES'             = 1 -shl 6
            'GUILD_VOICE_STATES'        = 1 -shl 7
            'GUILD_PRESENCES'           = 1 -shl 8
            'GUILD_MESSAGES'            = 1 -shl 9
            'GUILD_MESSAGE_REACTIONS'   = 1 -shl 10
            'GUILD_MESSAGE_TYPING'      = 1 -shl 11
            'DIRECT_MESSAGES'           = 1 -shl 12
            'DIRECT_MESSAGE_REACTIONS'  = 1 -shl 13
            'DIRECT_MESSAGE_TYPING'     = 1 -shl 14
            'GUILD_SCHEDULED_EVENTS'    = 1 -shl 16
        }

        $IntentsCalculation = 0
        foreach ($key in $BotIntents) {
            if ($IntentsCalculation -eq $IntentsKeys[$key]) {
                $IntentsCalculation = $IntentsKeys[$key]
            } else {
                $IntentsCalculation = $IntentsCalculation + $IntentsKeys[$key]
            }
        }
        
        # Variables for handshake
        $HeartbeatInterval = 0
        $NextHeartbeat = 0
        $SequenceNumber = $null
        $continueAuth = $false
        $maxAttempts = 100
        $attempts = 0
        
        # Main handshake loop
        while ($script:WebSocket.State -eq 'Open' -and $attempts -lt $maxAttempts -and -not $script:AuthComplete) {
            $attempts++
            
            # Check for heartbeat
            $CurrentEpochMS = [int64]((New-TimeSpan -Start (Get-Date "01/01/1970") -End (Get-Date)).TotalMilliseconds)
            if ($CurrentEpochMS -ge ($NextHeartbeat) -and $HeartbeatInterval -gt 0) {
                
                # Send heartbeat
                $HeartbeatProp = @{ 'op' = 1; 'd' = $SequenceNumber }
                $Message = $HeartbeatProp | ConvertTo-Json
                
                # MEMORY LEAK FIX: Use efficient byte conversion
                $Bytes = [System.Text.Encoding]::UTF8.GetBytes($Message)
                $Message = New-Object System.ArraySegment[byte] -ArgumentList @(, $Bytes)
                $Conn = $script:WebSocket.SendAsync($Message, [System.Net.WebSockets.WebSocketMessageType]::Text, [System.Boolean]::TrueString, $CT)
                while (!$Conn.IsCompleted) { Start-Sleep -Milliseconds 50 }
                
                $NextHeartbeat = (([int64]((New-TimeSpan -Start (Get-Date "01/01/1970") -End (Get-Date)).TotalMilliseconds)) + [int64]$HeartbeatInterval)
            }
            
            # Try to receive data with smaller buffer
            $DiscordData = ""
            $Size = 32768  # MEMORY LEAK FIX: Reduced from 512000 to 32KB
            $Array = [byte[]] @(, 0) * $Size
        
            $Recv = New-Object System.ArraySegment[byte] -ArgumentList @(, $Array)
            $Conn = $script:WebSocket.ReceiveAsync($Recv, $CT) 
            
            # Wait for receive with timeout
            $timeout = 5000 # 5 seconds
            $startTime = Get-Date
            while (!$Conn.IsCompleted -and ((Get-Date) - $startTime).TotalMilliseconds -lt $timeout) {
                Start-Sleep -Milliseconds 50
            }
            
            if ($Conn.IsCompleted) {
                $BytesReceived = $Conn.Result.Count
                $DiscordData = [System.Text.Encoding]::utf8.GetString($Recv.array, 0, $BytesReceived)
                
                if ($DiscordData.Trim()) {
                    try { 
                        # MEMORY LEAK FIX: Use efficient hashtable creation without Select-Object
                        $jsonObj = $DiscordData | ConvertFrom-Json
                        $RecvObj = @{
                            SentOrRecvd = "Received"
                            EventName = $jsonObj.t
                            SequenceNumber = $jsonObj.s
                            Opcode = $jsonObj.op
                            Data = $jsonObj.d
                        }
                    }
                    catch { 
                        Write-Log "ConvertFrom-Json failed: $($_.Exception.Message)" -Level "Debug"
                        $RecvObj = $null
                    }
                
                    if ($RecvObj) {
                        Write-Log "[RECV] Received opcode: $($RecvObj.Opcode)" -Level "Debug"
                        
                        if ($RecvObj.Opcode -eq '10') {
                            $HeartbeatInterval = [int64]$RecvObj.Data.heartbeat_interval
                            Start-Sleep -Milliseconds ($HeartbeatInterval * 0.1)
                            
                            # Send first heartbeat
                            $HeartbeatProp = @{ 'op' = 1; 'd' = $null }
                            $Message = $HeartbeatProp | ConvertTo-Json
                            
                            # MEMORY LEAK FIX: Use efficient byte conversion
                            $Bytes = [System.Text.Encoding]::UTF8.GetBytes($Message)
                            $Message = New-Object System.ArraySegment[byte] -ArgumentList @(, $Bytes)
                            $Conn = $script:WebSocket.SendAsync($Message, [System.Net.WebSockets.WebSocketMessageType]::Text, [System.Boolean]::TrueString, $CT)
                            while (!$Conn.IsCompleted) { Start-Sleep -Milliseconds 50 }
                            
                            $HeartbeatStart = [int64]((New-TimeSpan -Start (Get-Date "01/01/1970") -End (Get-Date)).TotalMilliseconds)
                            $NextHeartbeat = ($HeartbeatStart + [int64]$HeartbeatInterval)
                            $continueAuth = $true
                        }
                        
                        # Sequence number tracking
                        if ([int]$RecvObj.SequenceNumber -eq 1) { 
                            $SequenceNumber = [int]$RecvObj.SequenceNumber 
                        }
                        elseif ([int]$SequenceNumber -eq 1 -Or [int]$RecvObj.SequenceNumber -gt [int]$SequenceNumber) {  
                            $SequenceNumber = [int]$RecvObj.SequenceNumber 
                        }

                        # Handle heartbeat ACK (opcode 11) - both during auth and after
                        if ($RecvObj.Opcode -eq '11') {
                            $script:LastHeartbeatAck = $true
                            Write-Log "[HEARTBEAT] Received heartbeat ACK" -Level "Debug"
                        }

                        # Handle first ACK and send auth
                        if ($RecvObj.Opcode -eq '11' -and $continueAuth -eq $true) {
                            $continueAuth = $false
                            
                            # Send authentication
                            $Prop = @{
                                'op' = 2;
                                'd'  = @{
                                    'token'      = $Token;
                                    'intents'    = [int]$IntentsCalculation;
                                    'properties' = @{
                                        '$os'      = 'windows';
                                        '$browser' = 'SCUM-Server-Manager';
                                        '$device'  = 'SCUM-Server-Manager';
                                    }
                                    # NO PRESENCE in handshake - will be set later
                                }
                            }

                            $Message = $Prop | ConvertTo-Json -Depth 3
                            
                            # MEMORY LEAK FIX: Use efficient byte conversion
                            $Bytes = [System.Text.Encoding]::UTF8.GetBytes($Message)
                            $Message = New-Object System.ArraySegment[byte] -ArgumentList @(, $Bytes)
                            $Conn = $script:WebSocket.SendAsync($Message, [System.Net.WebSockets.WebSocketMessageType]::Text, [System.Boolean]::TrueString, $CT)
                            while (!$Conn.IsCompleted) { Start-Sleep -Milliseconds 50 }
                        }
                        
                        # Handle READY event
                        if ($RecvObj.EventName -eq "READY") {
                            $script:AuthComplete = $true
                            
                            # Store heartbeat parameters for persistent heartbeat
                            $script:HeartbeatInterval = $HeartbeatInterval
                            $script:SequenceNumber = $SequenceNumber
                            $script:NextHeartbeat = [int64]((New-TimeSpan -Start (Get-Date "01/01/1970") -End (Get-Date)).TotalMilliseconds) + [int64]$HeartbeatInterval
                            $script:LastHeartbeatAck = $true  # Initialize ACK state
                            
                            # Don't start background job - we'll handle heartbeats in a different way
                            $script:HeartbeatRunning = $true
                            
                            # Set initial presence after successful authentication
                            if ($Activity -and $Activity.Trim() -ne "") {
                                Write-Log "[HANDSHAKE] Setting initial Discord presence: '$Activity'" -Level "Debug"
                                # Use a small delay to ensure connection is fully ready
                                Start-Sleep -Milliseconds 200
                                $presenceResult = Set-DiscordBotStatus -Status $Status -Activity $Activity -ActivityType "Watching"
                                if ($presenceResult) {
                                    Write-Log "[HANDSHAKE] Initial Discord presence set successfully!" -Level "Debug"
                                } else {
                                    Write-Log "[HANDSHAKE] Failed to set initial Discord presence" -Level Warning
                                }
                            }
                            
                            return $true
                        }
                        
                        # Handle invalid session
                        if ($RecvObj.Opcode -eq '9') { 
                            Write-Log "[ERROR] Session invalidated. This usually means the bot token is invalid or the bot doesn't have proper permissions." -Level Error
                            return $false
                        }
                    }
                }
            } else {
                # No data received within timeout - continue loop silently
            }
            
            Start-Sleep -Milliseconds 100
        }
        
        if ($script:AuthComplete) {
            Write-Log "[HANDSHAKE] Discord authentication completed successfully" -Level "Debug"
            return $true
        } else {
            Write-Log "[HANDSHAKE] Authentication timeout or failed after $attempts attempts - this may be due to Discord API rate limiting or network issues" -Level Warning
            # Don't throw error immediately - let recovery handle it
            return $false
        }
        
    } catch {
        Write-Log "[HANDSHAKE] Handshake error: $($_.Exception.Message)" -Level Error
        # Don't throw error - return false to let recovery handle it
        return $false
    }
}

function Start-PersistentHeartbeat {
    try {
        Write-Log "[HEARTBEAT] Starting lightweight heartbeat mechanism..."
        $script:HeartbeatRunning = $true
        $script:LastHeartbeatAck = $true
        $script:NextHeartbeat = [int64]((New-TimeSpan -Start (Get-Date "01/01/1970") -End (Get-Date)).TotalMilliseconds) + [int64]$script:HeartbeatInterval
        
        # MEMORY LEAK FIX: No Start-Job - heartbeat will be handled in main loop
        Write-Log "[HEARTBEAT] Heartbeat timing configured - interval: $($script:HeartbeatInterval)ms"
        
    } catch {
        Write-Error "[HEARTBEAT] Failed to configure heartbeat: $($_.Exception.Message)"
    }
}

function Get-HeartbeatJobOutput {
    # MEMORY LEAK FIX: No job running - return empty
    Write-Log "No heartbeat job running - using inline heartbeat" -Level "Debug"
    return $null
}

function Stop-PersistentHeartbeat {
    try {
        # MEMORY LEAK FIX: No job to stop - just clear flags
        $script:HeartbeatRunning = $false
        $script:HeartbeatJob = $null
        Write-Log "[HEARTBEAT] Heartbeat mechanism stopped" -Level Warning
    } catch {
        Write-Log "[HEARTBEAT] Error stopping heartbeat: $($_.Exception.Message)" -Level Error
    }
}

function Stop-DiscordWebSocketBot {
    try {
        # Stop persistent heartbeat first
        Stop-PersistentHeartbeat
        
        # Gracefully close WebSocket if possible
        if ($script:WebSocket -and $script:WebSocket.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
            try {
                # Use timeout to prevent hanging on close
                $closeTask = $script:WebSocket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "Bot shutting down", [System.Threading.CancellationToken]::None)
                $timeout = 3000  # 3 seconds
                if (-not $closeTask.Wait($timeout)) {
                    Write-Log "[STOP] WebSocket close timeout, forcing disposal" -Level Warning
                }
            } catch {
                Write-Log "[STOP] Error during graceful close: $($_.Exception.Message)" -Level Warning
            }
        }
        
        # Force cleanup regardless of close result
        try {
            if ($script:WebSocket) {
                $script:WebSocket.Dispose()
            }
        } catch {
            Write-Log "[STOP] Error disposing WebSocket: $($_.Exception.Message)" -Level Debug
        }
        
        $script:IsConnected = $false
        $script:WebSocket = $null
        $script:AuthComplete = $false
        $script:HeartbeatRunning = $false
        $script:LastHeartbeatAck = $true
        $script:LastHeartbeatSent = 0
        
        Write-Log "[STOP] Discord bot disconnected" -Level Warning
        return $true
        
    } catch {
        Write-Log "Error stopping Discord bot: $($_.Exception.Message)" -Level Error
        # Even if cleanup fails, reset connection state
        $script:IsConnected = $false
        $script:WebSocket = $null
        $script:AuthComplete = $false
        $script:HeartbeatRunning = $false
        $script:LastHeartbeatAck = $true
        $script:LastHeartbeatSent = 0
        return $false
    }
}

function Receive-PendingDiscordMessages {
    <#
    .SYNOPSIS
    Check for pending Discord messages including heartbeat ACKs
    .DESCRIPTION
    Non-blocking check for any pending messages from Discord, particularly heartbeat ACKs
    #>
    try {
        if (-not $script:WebSocket -or $script:WebSocket.State -ne [System.Net.WebSockets.WebSocketState]::Open) {
            return $false
        }
        
        $CT = New-Object System.Threading.CancellationToken
        $receivedAck = $false
        
        # Non-blocking check for messages (very short timeout)
        $Size = 8192  # Smaller buffer for quick checks
        $Array = [byte[]] @(, 0) * $Size
        $Recv = New-Object System.ArraySegment[byte] -ArgumentList @(, $Array)
        
        try {
            $Conn = $script:WebSocket.ReceiveAsync($Recv, $CT) 
            
            # Very short timeout for non-blocking check
            $timeout = 100  # 100ms
            $startTime = Get-Date
            while (!$Conn.IsCompleted -and ((Get-Date) - $startTime).TotalMilliseconds -lt $timeout) {
                Start-Sleep -Milliseconds 10
            }
            
            if ($Conn.IsCompleted) {
                $BytesReceived = $Conn.Result.Count
                if ($BytesReceived -gt 0) {
                    $DiscordData = [System.Text.Encoding]::utf8.GetString($Recv.array, 0, $BytesReceived)
                    
                    if ($DiscordData.Trim()) {
                        try { 
                            # Check if JSON string appears complete before parsing
                            if ($DiscordData.Contains('{') -and $DiscordData.TrimEnd().EndsWith('}')) {
                                $jsonObj = $DiscordData | ConvertFrom-Json
                                
                                # Handle heartbeat ACK (opcode 11)
                                if ($jsonObj.op -eq 11) {
                                    $script:LastHeartbeatAck = $true
                                    $receivedAck = $true
                                    Write-Log "[HEARTBEAT] Received heartbeat ACK" -Level "Debug"
                                }
                                
                                # Update sequence number if provided
                                if ($jsonObj.s -and [int]$jsonObj.s -gt [int]$script:SequenceNumber) {
                                    $script:SequenceNumber = [int]$jsonObj.s
                                }
                            } else {
                                # Incomplete or malformed JSON - log but don't crash
                                Write-Log "[JSON] Incomplete Discord message received (likely due to rate limiting), skipping..." -Level "Debug"
                            }
                            
                        } catch {
                            # Check if it's the common rate limiting errors - these are normal and expected
                            if ($_.Exception.Message -like "*Unterminated string*" -or 
                                $_.Exception.Message -like "*Invalid JSON*" -or 
                                $_.Exception.Message -like "*ConvertFrom-Json*" -or
                                $_.Exception.Message -like "*primitive*") {
                                # All of these are normal during Discord rate limiting - don't log
                                # Connection is healthy, just delayed message processing
                            } else {
                                # Only log truly unexpected errors that aren't rate limiting related
                                Write-Log "Unexpected Discord message error: $($_.Exception.Message)" -Level Debug
                            }
                        }
                    }
                }
            }
        } catch {
            # WebSocket receive error - this might indicate connection problems
            if ($_.Exception.Message -like "*WebSocket*" -and ($_.Exception.Message -like "*closed*" -or $_.Exception.Message -like "*aborted*")) {
                Write-Log "[WEBSOCKET] Connection lost during message receive: $($_.Exception.Message)" -Level Warning
            } else {
                # Other errors are less critical
                Write-Log "[WEBSOCKET] Temporary receive error: $($_.Exception.Message)" -Level Debug
            }
        }
        
        return $receivedAck
        
    } catch {
        Write-Log "Error receiving Discord messages: $($_.Exception.Message)" -Level Debug
        return $false
    }
}

function Maintain-DiscordHeartbeat {
    try {
        if (-not $script:IsConnected -or -not $script:WebSocket -or $script:WebSocket.State -ne [System.Net.WebSockets.WebSocketState]::Open -or -not $script:AuthComplete) {
            return $false
        }
        
        # First, try to receive any pending messages (including ACKs)
        $receivedAck = Receive-PendingDiscordMessages
        
        # Check if we need to send a heartbeat first
        $CurrentEpochMS = [int64]((New-TimeSpan -Start (Get-Date "01/01/1970") -End (Get-Date)).TotalMilliseconds)
        
        if ($script:HeartbeatInterval -gt 0 -and $CurrentEpochMS -ge $script:NextHeartbeat) {
            Write-Log "[HEARTBEAT] Sending maintenance heartbeat..." -Level "Debug"
            
            # Check for missed heartbeat ACK (zombie connection detection) ONLY if we've sent at least one heartbeat
            if (-not $script:LastHeartbeatAck -and $script:LastHeartbeatSent -gt 0) {
                $timeSinceLastHeartbeat = $CurrentEpochMS - $script:LastHeartbeatSent
                # Only consider it a zombie connection if we haven't received ACK for more than 3 heartbeat intervals (more tolerant)
                if ($timeSinceLastHeartbeat -gt ($script:HeartbeatInterval * 3)) {
                    Write-Log "[HEARTBEAT] Missed heartbeat ACK - connection may be zombie, triggering reconnection" -Level Warning
                    # Connection is zombied - trigger reconnection
                    $script:IsConnected = $false
                    return $false
                }
            }
            
            # Mark that we're waiting for ACK
            $script:LastHeartbeatAck = $false
            $script:LastHeartbeatSent = $CurrentEpochMS
            
            # Send heartbeat
            $HeartbeatProp = @{ 'op' = 1; 'd' = $script:SequenceNumber }
            $Message = $HeartbeatProp | ConvertTo-Json
            
            try {
                # MEMORY LEAK FIX: Use efficient byte conversion
                $Bytes = [System.Text.Encoding]::UTF8.GetBytes($Message)
                $Message = New-Object System.ArraySegment[byte] -ArgumentList @(, $Bytes)
                $CT = New-Object System.Threading.CancellationToken
                $Conn = $script:WebSocket.SendAsync($Message, [System.Net.WebSockets.WebSocketMessageType]::Text, [System.Boolean]::TrueString, $CT)
                while (!$Conn.IsCompleted) { Start-Sleep -Milliseconds 50 }
                
                # Update next heartbeat time
                $script:NextHeartbeat = $CurrentEpochMS + [int64]$script:HeartbeatInterval
                Write-Log "[HEARTBEAT] Heartbeat sent, next due at: $($script:NextHeartbeat)" -Level "Debug"
                
                return $true
            } catch {
                Write-Log "[HEARTBEAT] Failed to send heartbeat: $($_.Exception.Message)" -Level Warning
                # Failed to send heartbeat - might indicate connection problems
                if ($_.Exception.Message -like "*WebSocket*" -and ($_.Exception.Message -like "*closed*" -or $_.Exception.Message -like "*aborted*")) {
                    Write-Log "[HEARTBEAT] Critical send failure - connection lost" -Level Error
                    $script:IsConnected = $false
                }
                return $false
            }
        }
        
        return $false  # No heartbeat needed yet
        
    } catch {
        Write-Log "[HEARTBEAT] Error in heartbeat maintenance: $($_.Exception.Message)" -Level Warning
        # Don't immediately disconnect on heartbeat errors - they might be temporary
        # Only disconnect if it's a critical WebSocket error
        if ($_.Exception.Message -like "*WebSocket*" -and $_.Exception.Message -like "*closed*") {
            Write-Log "[HEARTBEAT] Critical WebSocket error - marking connection as unhealthy" -Level Error
            $script:IsConnected = $false
        }
        return $false
    }
}

function Set-DiscordBotStatus {
    param(
        [Parameter()]
        [string]$Status = "online",
        
        [Parameter()]
        [string]$Activity = $null,
        
        [Parameter()]
        [string]$ActivityType = "Playing"
    )
    
    try {
        # Perform heartbeat maintenance first
        Maintain-DiscordHeartbeat | Out-Null
        
        if (-not $script:IsConnected -or -not $script:WebSocket -or $script:WebSocket.State -ne [System.Net.WebSockets.WebSocketState]::Open) {
            Write-Log "Discord bot is not connected" -Level "Debug"
            return $false
        }
        
        # This is a LOW-LEVEL function - no business logic, just send to Discord
        Write-Log "[LOW-LEVEL] Set-DiscordBotStatus called: Status='$Status', Activity='$Activity', Type='$ActivityType'" -Level "Debug"
        
        # Create presence update
        $presence = @{
            op = 3
            d = @{
                since = $null
                activities = @()
                status = $Status.ToLower()
                afk = $false
            }
        }
        
        if ($Activity -and $Activity.Trim() -ne "") {
            $activityType = switch ($ActivityType) {
                "Playing" { 0 }
                "Streaming" { 1 }
                "Listening" { 2 }
                "Watching" { 3 }
                "Custom" { 4 }
                "Competing" { 5 }
                default { 0 }  # Playing as default
            }
            
            $presence.d.activities = @(
                @{
                    name = $Activity
                    type = [int]$activityType  # Force integer type!
                }
            )
            Write-Log "[LOW-LEVEL] Activity created: name='$Activity', type=$activityType" -Level "Debug"
        } else {
            Write-Log "[LOW-LEVEL] NO ACTIVITY - empty or null activity provided" -Level "Debug"
        }
        
        # Send presence update
        $Message = $presence | ConvertTo-Json -Depth 3
        Write-Log "[LOW-LEVEL] Sending presence update to Discord" -Level "Debug"
        
        # MEMORY LEAK FIX: Use efficient byte conversion
        $Bytes = [System.Text.Encoding]::UTF8.GetBytes($Message)
        $Message = New-Object System.ArraySegment[byte] -ArgumentList @(, $Bytes)
        $CT = New-Object System.Threading.CancellationToken
        $Conn = $script:WebSocket.SendAsync($Message, [System.Net.WebSockets.WebSocketMessageType]::Text, [System.Boolean]::TrueString, $CT)
        while (!$Conn.IsCompleted) { Start-Sleep -Milliseconds 50 }
        
        $script:CurrentActivity = $Activity
        $script:CurrentStatus = $Status
        
        Write-Log "[LOW-LEVEL] Message sent to Discord WebSocket successfully" -Level "Debug"
        return $true
        
    } catch {
        Write-Log "Failed to update bot status: $($_.Exception.Message)" -Level Error
        return $false
    }
}

function Test-DiscordBotConnection {
    return ($script:IsConnected -and $script:WebSocket -and $script:WebSocket.State -eq [System.Net.WebSockets.WebSocketState]::Open -and $script:AuthComplete)
}

function Test-DiscordConnectionHealth {
    <#
    .SYNOPSIS
    Check Discord connection health and attempt recovery if needed
    .DESCRIPTION
    Tests the Discord bot connection and attempts automatic reconnection if the connection is lost
    #>
    try {
        # Rate limiting for recovery attempts - only try once per 30 seconds
        if ($script:LastRecoveryAttempt) {
            $timeSinceLastRecovery = (Get-Date) - $script:LastRecoveryAttempt
            if ($timeSinceLastRecovery.TotalSeconds -lt 30) {
                Write-Log "[CONNECTION-HEALTH] Recovery rate limit active - skipping health check ($([math]::Round($timeSinceLastRecovery.TotalSeconds))s < 30s)" -Level "Debug"
                return $false  # Don't claim to be healthy, but don't attempt recovery
            }
        }
        
        # Check basic connection status
        $isHealthy = Test-DiscordBotConnection
        
        if ($isHealthy) {
            # Reset recovery attempts counter on successful health check
            $script:RecoveryAttempts = 0
            return $true
        }
        
        # Connection is unhealthy - check if we should attempt recovery
        if ($script:RecoveryAttempts -ge 3) {
            Write-Log "[CONNECTION-HEALTH] Maximum recovery attempts reached ($($script:RecoveryAttempts)), skipping automatic recovery" -Level Warning
            return $false
        }
        
        Write-Log "[CONNECTION-HEALTH] Discord connection is unhealthy, attempting recovery (attempt $($script:RecoveryAttempts + 1)/3)..." -Level Warning
        $script:LastRecoveryAttempt = Get-Date
        $script:RecoveryAttempts++
        
        $recoveryResult = Restore-DiscordConnection
        if ($recoveryResult) {
            $script:RecoveryAttempts = 0  # Reset on successful recovery
        }
        
        return $recoveryResult
        
    } catch {
        Write-Log "[CONNECTION-HEALTH] Error checking Discord connection health: $($_.Exception.Message)" -Level Error
        return $false
    }
}

function Restore-DiscordConnection {
    <#
    .SYNOPSIS
    Attempt to restore Discord bot connection
    .DESCRIPTION
    Tries to restore a lost Discord connection by cleaning up and reconnecting
    #>
    try {
        Write-Log "[RECOVERY] Attempting to restore Discord connection..." -Level Warning
        
        # Store current settings for restoration
        $savedToken = $script:BotToken
        $savedActivity = $script:CurrentActivity
        $savedStatus = $script:CurrentStatus
        
        if (-not $savedToken) {
            Write-Log "[RECOVERY] No saved bot token available for reconnection" -Level Error
            return $false
        }
        
        # Clean up existing connection
        Write-Log "[RECOVERY] Cleaning up existing connection..." -Level "Debug"
        try {
            Stop-DiscordWebSocketBot | Out-Null
        } catch {
            Write-Log "[RECOVERY] Error during cleanup (continuing): $($_.Exception.Message)" -Level Warning
        }
        
        # Wait longer before reconnecting to avoid rate limits
        Write-Log "[RECOVERY] Waiting before reconnection attempt..." -Level "Debug"
        Start-Sleep -Seconds 5
        
        # Attempt reconnection
        Write-Log "[RECOVERY] Attempting to reconnect..." -Level "Debug"
        $reconnectResult = Start-DiscordWebSocketBot -Token $savedToken -Status $savedStatus -Activity $savedActivity
        
        if ($reconnectResult) {
            Write-Log "[RECOVERY] Discord connection restored successfully!"
            
            # Start persistent heartbeat if it's not running
            if (-not $script:HeartbeatRunning) {
                Write-Log "[RECOVERY] Starting heartbeat mechanism..." -Level "Debug"
                Start-PersistentHeartbeat
            }
            
            # Restore bot activity after successful reconnection
            if ($savedActivity -and $savedActivity.Trim() -ne "") {
                Write-Log "[RECOVERY] Restoring Discord activity: '$savedActivity'" -Level "Debug"
                # Use a small delay to ensure connection is fully established
                Start-Sleep -Milliseconds 500
                $activityResult = Set-DiscordBotStatus -Status $savedStatus -Activity $savedActivity -ActivityType "Watching"
                if ($activityResult) {
                    Write-Log "[RECOVERY] Discord activity restored successfully!" -Level "Debug"
                } else {
                    Write-Log "[RECOVERY] Failed to restore Discord activity" -Level Warning
                }
            }
            
            return $true
        } else {
            Write-Error "[RECOVERY] Failed to restore Discord connection"
            return $false
        }
        
    } catch {
        Write-Error "[RECOVERY] Error during Discord connection recovery: $($_.Exception.Message)"
        return $false
    }
}

function Get-BotConnectionStatus {
    # MEMORY LEAK FIX: Simplified status without job output
    return @{
        IsConnected = $script:IsConnected
        WebSocketState = if ($script:WebSocket) { $script:WebSocket.State.ToString() } else { "None" }
        CurrentActivity = $script:CurrentActivity
        CurrentStatus = $script:CurrentStatus
        AuthComplete = $script:AuthComplete
        HeartbeatRunning = $script:HeartbeatRunning
        HeartbeatInterval = $script:HeartbeatInterval
        HeartbeatJobId = "InlineHeartbeat"
        HeartbeatJobState = if ($script:HeartbeatRunning) { "Running" } else { "Stopped" }
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

Export-ModuleMember -Function @(
    'Start-DiscordWebSocketBot',
    'Stop-DiscordWebSocketBot',
    'Set-DiscordBotStatus',
    'Test-DiscordBotConnection',
    'Test-DiscordConnectionHealth',
    'Restore-DiscordConnection',
    'Get-BotConnectionStatus',
    'Set-BotActivity',
    'Start-PersistentHeartbeat',
    'Stop-PersistentHeartbeat',
    'Get-HeartbeatJobOutput',
    'Maintain-DiscordHeartbeat',
    'Receive-PendingDiscordMessages'
)
