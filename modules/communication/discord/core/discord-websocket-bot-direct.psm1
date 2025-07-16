# ===============================================================
# SCUM Server Automation - Discord WebSocket Bot
# ===============================================================
# Real-time Discord bot connection using WebSocket API
# Handles bot presence, status updates, and live communication
# ===============================================================

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
        Write-Warning "Discord bot is already connected"
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
                Write-Warning "Authentication failed"
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
                $Array = @()
                $Message.ToCharArray() | ForEach-Object { $Array += [byte]$_ }
                $Message = New-Object System.ArraySegment[byte] -ArgumentList @(, $Array)
                $Conn = $script:WebSocket.SendAsync($Message, [System.Net.WebSockets.WebSocketMessageType]::Text, [System.Boolean]::TrueString, $CT)
                while (!$Conn.IsCompleted) { Start-Sleep -Milliseconds 50 }
                
                $NextHeartbeat = (([int64]((New-TimeSpan -Start (Get-Date "01/01/1970") -End (Get-Date)).TotalMilliseconds)) + [int64]$HeartbeatInterval)
            }
            
            # Try to receive data
            $DiscordData = ""
            $Size = 512000
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
                        $RecvObj = $DiscordData | ConvertFrom-Json | Select-Object @{N = "SentOrRecvd"; E = { "Received" } }, @{N = "EventName"; E = { $_.t } }, @{N = "SequenceNumber"; E = { $_.s } }, @{N = "Opcode"; E = { $_.op } }, @{N = "Data"; E = { $_.d } } 
                    }
                    catch { 
                        Write-Verbose "ConvertFrom-Json failed: $($_.Exception.Message)"
                        $RecvObj = $null
                    }
                
                    if ($RecvObj) {
                        Write-Verbose "[RECV] Received opcode: $($RecvObj.Opcode)"
                        
                        if ($RecvObj.Opcode -eq '10') {
                            $HeartbeatInterval = [int64]$RecvObj.Data.heartbeat_interval
                            Start-Sleep -Milliseconds ($HeartbeatInterval * 0.1)
                            
                            # Send first heartbeat
                            $HeartbeatProp = @{ 'op' = 1; 'd' = $null }
                            $Message = $HeartbeatProp | ConvertTo-Json
                            $Array = @()
                            $Message.ToCharArray() | ForEach-Object { $Array += [byte]$_ }
                            $Message = New-Object System.ArraySegment[byte] -ArgumentList @(, $Array)
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

                            $Message = $Prop | ConvertTo-Json -Depth 10
                            $Array = @()
                            $Message.ToCharArray() | ForEach-Object { $Array += [byte]$_ }
                            $Message = New-Object System.ArraySegment[byte] -ArgumentList @(, $Array)
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
                            Write-Warning "[ERROR] Session invalidated. This usually means the bot token is invalid or the bot doesn't have proper permissions."
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
            Write-Warning "Authentication timeout or failed after $attempts attempts"
            return $false
        }
        
    } catch {
        Write-Error "Handshake error: $($_.Exception.Message)"
        return $false
    }
}

function Start-PersistentHeartbeat {
    try {
        Write-Host "[HEARTBEAT] Starting persistent heartbeat mechanism..." -ForegroundColor Green
        $script:HeartbeatRunning = $true
        $script:LastHeartbeatAck = $true
        $script:NextHeartbeat = [int64]((New-TimeSpan -Start (Get-Date "01/01/1970") -End (Get-Date)).TotalMilliseconds) + [int64]$script:HeartbeatInterval
        
        # Create a background job for persistent heartbeat
        $heartbeatScriptBlock = {
            param($WebSocket, $HeartbeatInterval, $SequenceNumber)
            
            $lastHeartbeat = 0
            $missedHeartbeats = 0
            $maxMissedHeartbeats = 5  # Increased tolerance
            $heartbeatCount = 0
            
            Write-Output "[HEARTBEAT-JOB] Starting heartbeat job with interval: $HeartbeatInterval ms"
            
            while ($true) {
                try {
                    $currentTime = [int64]((New-TimeSpan -Start (Get-Date "01/01/1970") -End (Get-Date)).TotalMilliseconds)
                    $heartbeatCount++
                    
                    # Check if WebSocket is still open
                    if ($WebSocket.State -ne [System.Net.WebSockets.WebSocketState]::Open) {
                        Write-Output "[HEARTBEAT-JOB] WebSocket is no longer open (State: $($WebSocket.State)), stopping heartbeat"
                        break
                    }
                    
                    # Send heartbeat if it's time
                    if ($currentTime -ge ($lastHeartbeat + $HeartbeatInterval)) {
                        Write-Output "[HEARTBEAT-JOB] Sending heartbeat #$heartbeatCount..."
                        
                        $HeartbeatProp = @{ 'op' = 1; 'd' = $SequenceNumber }
                        $Message = $HeartbeatProp | ConvertTo-Json
                        $Array = @()
                        $Message.ToCharArray() | ForEach-Object { $Array += [byte]$_ }
                        $MessageSegment = New-Object System.ArraySegment[byte] -ArgumentList @(, $Array)
                        
                        $CT = New-Object System.Threading.CancellationToken
                        $SendTask = $WebSocket.SendAsync($MessageSegment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $CT)
                        
                        # Wait for send to complete with timeout
                        $timeout = 10000  # 10 seconds
                        $SendTask.Wait($timeout)
                        
                        if ($SendTask.IsCompleted -and $SendTask.Status -eq 'RanToCompletion') {
                            $lastHeartbeat = $currentTime
                            $missedHeartbeats = 0
                            Write-Output "[HEARTBEAT-JOB] Heartbeat #$heartbeatCount sent successfully"
                        } else {
                            $missedHeartbeats++
                            Write-Output "[HEARTBEAT-JOB] Failed to send heartbeat #$heartbeatCount (Status: $($SendTask.Status), Missed: $missedHeartbeats/$maxMissedHeartbeats)"
                            
                            if ($missedHeartbeats -ge $maxMissedHeartbeats) {
                                Write-Output "[HEARTBEAT-JOB] Too many missed heartbeats ($missedHeartbeats), connection may be dead"
                                break
                            }
                        }
                    }
                    
                    # Sleep for a shorter interval to be more responsive
                    Start-Sleep -Milliseconds 2000  # 2 seconds
                    
                } catch {
                    Write-Output "[HEARTBEAT-JOB] Error in heartbeat loop: $($_.Exception.Message)"
                    $missedHeartbeats++
                    
                    if ($missedHeartbeats -ge $maxMissedHeartbeats) {
                        Write-Output "[HEARTBEAT-JOB] Too many heartbeat errors ($missedHeartbeats), stopping"
                        break
                    }
                    
                    # Sleep longer on error
                    Start-Sleep -Milliseconds 5000
                }
            }
            
            Write-Output "[HEARTBEAT-JOB] Persistent heartbeat stopped after $heartbeatCount heartbeats"
        }
        
        # Start the heartbeat job
        $script:HeartbeatJob = Start-Job -ScriptBlock $heartbeatScriptBlock -ArgumentList $script:WebSocket, $script:HeartbeatInterval, $script:SequenceNumber
        
        Write-Host "[HEARTBEAT] Persistent heartbeat job started (ID: $($script:HeartbeatJob.Id))" -ForegroundColor Green
        
    } catch {
        Write-Error "[HEARTBEAT] Failed to start persistent heartbeat: $($_.Exception.Message)"
    }
}

function Get-HeartbeatJobOutput {
    if ($script:HeartbeatJob) {
        $output = Receive-Job -Job $script:HeartbeatJob -Keep
        if ($output) {
            Write-Host "[HEARTBEAT-JOB] Job output:" -ForegroundColor Cyan
            $output | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
        } else {
            Write-Host "[HEARTBEAT-JOB] No job output available" -ForegroundColor Yellow
        }
        return $output
    } else {
        Write-Host "[HEARTBEAT-JOB] No heartbeat job running" -ForegroundColor Red
        return $null
    }
}

function Stop-PersistentHeartbeat {
    try {
        if ($script:HeartbeatJob) {
            Write-Host "[HEARTBEAT] Stopping persistent heartbeat job..." -ForegroundColor Yellow
            Stop-Job -Job $script:HeartbeatJob -PassThru | Remove-Job
            $script:HeartbeatJob = $null
        }
        $script:HeartbeatRunning = $false
        Write-Host "[HEARTBEAT] Persistent heartbeat stopped" -ForegroundColor Yellow
    } catch {
        Write-Warning "[HEARTBEAT] Error stopping heartbeat: $($_.Exception.Message)"
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
        
        Write-Host "[STOP] Discord bot disconnected" -ForegroundColor Yellow
        return $true
        
    } catch {
        Write-Warning "Error stopping Discord bot: $($_.Exception.Message)"
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
            Write-Verbose "[HEARTBEAT] Sending maintenance heartbeat..."
            
            # Send heartbeat
            $HeartbeatProp = @{ 'op' = 1; 'd' = $script:SequenceNumber }
            $Message = $HeartbeatProp | ConvertTo-Json
            $Array = @()
            $Message.ToCharArray() | ForEach-Object { $Array += [byte]$_ }
            $Message = New-Object System.ArraySegment[byte] -ArgumentList @(, $Array)
            $CT = New-Object System.Threading.CancellationToken
            $Conn = $script:WebSocket.SendAsync($Message, [System.Net.WebSockets.WebSocketMessageType]::Text, [System.Boolean]::TrueString, $CT)
            while (!$Conn.IsCompleted) { Start-Sleep -Milliseconds 50 }
            
            # Update next heartbeat time
            $script:NextHeartbeat = $CurrentEpochMS + [int64]$script:HeartbeatInterval
            Write-Verbose "[HEARTBEAT] Heartbeat sent, next due at: $($script:NextHeartbeat)"
            
            return $true
        }
        
        return $false  # No heartbeat needed yet
        
    } catch {
        Write-Warning "[HEARTBEAT] Error in heartbeat maintenance: $($_.Exception.Message)"
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
            Write-Verbose "Discord bot is not connected"
            return $false
        }
        
        # This is a LOW-LEVEL function - no business logic, just send to Discord
        Write-Verbose "[LOW-LEVEL] Set-DiscordBotStatus called: Status='$Status', Activity='$Activity', Type='$ActivityType'"
        
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
            Write-Verbose "[LOW-LEVEL] Activity created: name='$Activity', type=$activityType"
        } else {
            Write-Verbose "[LOW-LEVEL] NO ACTIVITY - empty or null activity provided"
        }
        
        # Send presence update
        $Message = $presence | ConvertTo-Json -Depth 10
        Write-Verbose "[LOW-LEVEL] Sending presence update to Discord"
        
        $Array = @()
        $Message.ToCharArray() | ForEach-Object { $Array += [byte]$_ }
        $Message = New-Object System.ArraySegment[byte] -ArgumentList @(, $Array)
        $CT = New-Object System.Threading.CancellationToken
        $Conn = $script:WebSocket.SendAsync($Message, [System.Net.WebSockets.WebSocketMessageType]::Text, [System.Boolean]::TrueString, $CT)
        while (!$Conn.IsCompleted) { Start-Sleep -Milliseconds 50 }
        
        $script:CurrentActivity = $Activity
        $script:CurrentStatus = $Status
        
        Write-Verbose "[LOW-LEVEL] Message sent to Discord WebSocket successfully"
        return $true
        
    } catch {
        Write-Warning "Failed to update bot status: $($_.Exception.Message)"
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
            # Check heartbeat job status if it exists
            if ($script:HeartbeatJob) {
                $jobState = $script:HeartbeatJob.State
                if ($jobState -eq 'Failed' -or $jobState -eq 'Stopped') {
                    Write-Warning "[CONNECTION-HEALTH] Heartbeat job is in $jobState state, connection may be unhealthy"
                    $isHealthy = $false
                }
            }
        }
        
        if (-not $isHealthy) {
            Write-Warning "[CONNECTION-HEALTH] Discord connection is unhealthy, attempting recovery..."
            return Restore-DiscordConnection
        }
        
        return $true
        
    } catch {
        Write-Warning "[CONNECTION-HEALTH] Error checking Discord connection health: $($_.Exception.Message)"
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
        Write-Host "[RECOVERY] Attempting to restore Discord connection..." -ForegroundColor Yellow
        
        # Store current settings for restoration
        $savedToken = $script:BotToken
        $savedActivity = $script:CurrentActivity
        $savedStatus = $script:CurrentStatus
        
        if (-not $savedToken) {
            Write-Error "[RECOVERY] No saved bot token available for reconnection"
            return $false
        }
        
        # Clean up existing connection
        Write-Verbose "[RECOVERY] Cleaning up existing connection..."
        Stop-DiscordWebSocketBot | Out-Null
        
        # Wait a moment before reconnecting
        Start-Sleep -Seconds 3
        
        # Attempt reconnection
        Write-Verbose "[RECOVERY] Attempting to reconnect..."
        $reconnectResult = Start-DiscordWebSocketBot -Token $savedToken -Status $savedStatus -Activity $savedActivity
        
        if ($reconnectResult) {
            Write-Host "[RECOVERY] Discord connection restored successfully!" -ForegroundColor Green
            
            # Start persistent heartbeat if it's not running
            if (-not $script:HeartbeatJob -or $script:HeartbeatJob.State -ne 'Running') {
                Write-Verbose "[RECOVERY] Starting persistent heartbeat..."
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
    $jobOutput = $null
    if ($script:HeartbeatJob) {
        $jobOutput = Receive-Job -Job $script:HeartbeatJob -Keep | Select-Object -Last 5
    }
    
    return @{
        IsConnected = $script:IsConnected
        WebSocketState = if ($script:WebSocket) { $script:WebSocket.State.ToString() } else { "None" }
        CurrentActivity = $script:CurrentActivity
        CurrentStatus = $script:CurrentStatus
        AuthComplete = $script:AuthComplete
        HeartbeatRunning = $script:HeartbeatRunning
        HeartbeatInterval = $script:HeartbeatInterval
        HeartbeatJobId = if ($script:HeartbeatJob) { $script:HeartbeatJob.Id } else { "None" }
        HeartbeatJobState = if ($script:HeartbeatJob) { $script:HeartbeatJob.State } else { "None" }
        HeartbeatJobOutput = $jobOutput
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
