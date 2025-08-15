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
                            
                            # Don't start background job - we'll handle heartbeats in a different way
                            $script:HeartbeatRunning = $true
                            
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
            return $true
        } else {
            Write-Log "Authentication timeout or failed after $attempts attempts" -Level Error
            return $false
        }
        
    } catch {
        Write-Error "Handshake error: $($_.Exception.Message)"
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
        
        if ($script:WebSocket -and $script:WebSocket.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
            $script:WebSocket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "Bot shutting down", [System.Threading.CancellationToken]::None).Wait()
        }
        
        $script:IsConnected = $false
        $script:WebSocket = $null
        $script:AuthComplete = $false
        $script:HeartbeatRunning = $false
        
        Write-Log "[STOP] Discord bot disconnected" -Level Warning
        return $true
        
    } catch {
        Write-Log "Error stopping Discord bot: $($_.Exception.Message)" -Level Error
        return $false
    }
}

function Maintain-DiscordHeartbeat {
    try {
        if (-not $script:IsConnected -or -not $script:WebSocket -or $script:WebSocket.State -ne [System.Net.WebSockets.WebSocketState]::Open -or -not $script:AuthComplete) {
            return $false
        }
        
        # Check if we need to send a heartbeat
        $CurrentEpochMS = [int64]((New-TimeSpan -Start (Get-Date "01/01/1970") -End (Get-Date)).TotalMilliseconds)
        
        if ($script:HeartbeatInterval -gt 0 -and $CurrentEpochMS -ge $script:NextHeartbeat) {
            Write-Log "[HEARTBEAT] Sending maintenance heartbeat..." -Level "Debug"
            
            # Send heartbeat
            $HeartbeatProp = @{ 'op' = 1; 'd' = $script:SequenceNumber }
            $Message = $HeartbeatProp | ConvertTo-Json
            
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
        }
        
        return $false  # No heartbeat needed yet
        
    } catch {
        Write-Log "[HEARTBEAT] Error in heartbeat maintenance: $($_.Exception.Message)" -Level Error
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
        # Check basic connection status
        $isHealthy = Test-DiscordBotConnection
        
        if ($isHealthy) {
            # MEMORY LEAK FIX: No job to check - just check running flag
            if (-not $script:HeartbeatRunning) {
                Write-Log "[CONNECTION-HEALTH] Heartbeat is not running, connection may be unhealthy" -Level Warning
                $isHealthy = $false
            }
        }
        
        if (-not $isHealthy) {
            Write-Log "[CONNECTION-HEALTH] Discord connection is unhealthy, attempting recovery..." -Level Warning
            return Restore-DiscordConnection
        }
        
        return $true
        
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
            Write-Error "[RECOVERY] No saved bot token available for reconnection"
            return $false
        }
        
        # Clean up existing connection
        Write-Log "[RECOVERY] Cleaning up existing connection..." -Level "Debug"
        Stop-DiscordWebSocketBot | Out-Null
        
        # Wait a moment before reconnecting
        Start-Sleep -Seconds 3
        
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
    'Maintain-DiscordHeartbeat'
)
