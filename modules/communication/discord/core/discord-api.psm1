# ===============================================================
# SCUM Server Automation - Discord API Core
# ===============================================================
# Core Discord REST API communication functions
# Handles message sending, embed posting, and bot activity updates
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
    Write-Host "[WARNING] Common module not available for discord-api module" -ForegroundColor Yellow
}

# Global variables
$script:BotToken = $null

function Initialize-DiscordAPI {
    <#
    .SYNOPSIS
    Initialize the Discord API with bot token
    .PARAMETER Token
    Discord bot token
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$Token
    )
    
    $script:BotToken = $Token
    Write-Log "[DISCORD-API] Bot token initialized successfully"
}

function Send-DiscordMessage {
    <#
    .SYNOPSIS
    Send message to Discord channel via REST API with rate limiting and proper Unicode support
    #>
    param(
        [Parameter(Mandatory=$false)]
        [string]$Token,
        
        [Parameter(Mandatory=$true)]
        [string]$ChannelId,
        
        [hashtable]$Embed,
        [string]$Content,
        [int]$MaxRetries = 3
    )
    
    # Use provided token or fall back to global token
    $botToken = if ($Token) { $Token } else { $script:BotToken }
    
    if (-not $botToken) {
        Write-Log "[DISCORD-API] No bot token available for sending message" -Level Warning
        return $null
    }
    
    $retryCount = 0
    
    while ($retryCount -lt $MaxRetries) {
        try {
            $headers = @{
                "Authorization" = "Bot $botToken"
                "Content-Type" = "application/json; charset=utf-8"
                "User-Agent" = "SCUM-Server-Manager/1.0"
            }
            
            $body = @{}
            
            if ($Content) {
                $body.content = $Content
            }
            
            if ($Embed) {
                $body.embeds = @($Embed)
            }
            
            $uri = "https://discord.com/api/v10/channels/$ChannelId/messages"
            
            # Convert to JSON with proper UTF-8 encoding
            $json = $body | ConvertTo-Json -Depth 10
            
            # Ensure proper UTF-8 byte encoding for international characters
            $utf8Bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
            
            # Use WebRequest instead of Invoke-RestMethod for better encoding control
            $webRequest = [System.Net.WebRequest]::Create($uri)
            $webRequest.Method = "POST"
            $webRequest.ContentType = "application/json; charset=utf-8"
            $webRequest.ContentLength = $utf8Bytes.Length
            
            # Set User-Agent using the proper property
            $webRequest.UserAgent = "SCUM-Server-Manager/1.0"
            
            # Add other headers (skip Content-Type and User-Agent)
            foreach ($key in $headers.Keys) {
                if ($key -eq "Content-Type" -or $key -eq "User-Agent") {
                    # Already set above
                    continue
                }
                $webRequest.Headers.Add($key, $headers[$key])
            }
            
            # Write UTF-8 encoded data
            $requestStream = $webRequest.GetRequestStream()
            $requestStream.Write($utf8Bytes, 0, $utf8Bytes.Length)
            $requestStream.Close()
            
            # Get response
            try {
                $response = $webRequest.GetResponse()
                $responseStream = $response.GetResponseStream()
                $reader = New-Object System.IO.StreamReader($responseStream, [System.Text.Encoding]::UTF8)
                $responseContent = $reader.ReadToEnd()
                $reader.Close()
                $response.Close()
                
                # Parse JSON response
                $responseObject = $responseContent | ConvertFrom-Json
                
                # Return only message ID for success confirmation
                if ($responseObject -and $responseObject.id) {
                    return @{ id = $responseObject.id; success = $true }
                }
                return $responseObject
                
            } catch [System.Net.WebException] {
                # Handle HTTP errors more gracefully
                $webException = $_.Exception
                
                if ($webException.Response) {
                    $errorResponse = $webException.Response
                    $errorStream = $errorResponse.GetResponseStream()
                    $errorReader = New-Object System.IO.StreamReader($errorStream, [System.Text.Encoding]::UTF8)
                    $errorContent = $errorReader.ReadToEnd()
                    $errorReader.Close()
                    $errorResponse.Close()
                    
                    # Parse error response if it's JSON
                    try {
                        $errorObject = $errorContent | ConvertFrom-Json
                        Write-Log "Discord API Error: $($errorObject.message) (Code: $($errorResponse.StatusCode))" -Level Error
                    } catch {
                        Write-Log "Discord API Error: $errorContent (Code: $($errorResponse.StatusCode))" -Level Error
                    }
                }
                
                # Re-throw the exception for retry logic
                throw $webException
            }
            
        } catch {
            $retryCount++
            
            # Check if it's a rate limit error (429)
            if ($_.Exception.Response -and $_.Exception.Response.StatusCode -eq 429) {
                Write-Log "Discord rate limit hit (attempt $retryCount/$MaxRetries), waiting..." -Level Warning
                
                # Extract retry-after from response if available
                $retryAfter = 1
                try {
                    $errorResponse = $_.Exception.Response.GetResponseStream()
                    $reader = New-Object System.IO.StreamReader($errorResponse)
                    $errorContent = $reader.ReadToEnd() | ConvertFrom-Json
                    if ($errorContent.retry_after) {
                        $retryAfter = [Math]::Max($errorContent.retry_after, 1)
                    }
                } catch {
                    # Use default retry time
                }
                
                Start-Sleep -Seconds ($retryAfter + 1)
                continue
            }
            
            # For non-rate-limit errors, show detailed response
            $errorDetails = "Unknown error"
            try {
                if ($_.Exception.Response) {
                    $errorResponse = $_.Exception.Response.GetResponseStream()
                    $reader = New-Object System.IO.StreamReader($errorResponse)
                    $errorContent = $reader.ReadToEnd()
                    $errorDetails = $errorContent
                }
            } catch {
                # Use the original exception message
                $errorDetails = $_.Exception.Message
            }
            
            Write-Error "Failed to send Discord message: $($_.Exception.Message). Response: $errorDetails"
            return $null
        }
    }
    
    Write-Error "Failed to send Discord message after $MaxRetries attempts due to rate limiting"
    return $null
}

function Update-DiscordMessage {
    <#
    .SYNOPSIS
    Update existing Discord message with rate limiting and proper Unicode support
    #>
    param(
        [Parameter(Mandatory=$false)]
        [string]$Token,
        
        [Parameter(Mandatory=$true)]
        [string]$ChannelId,
        
        [Parameter(Mandatory=$true)]
        [string]$MessageId,
        
        [hashtable]$Embed,
        [string]$Content,
        [int]$MaxRetries = 3
    )
    
    # Use provided token or fall back to global token
    $botToken = if ($Token) { $Token } else { $script:BotToken }
    
    if (-not $botToken) {
        Write-Log "[DISCORD-API] No bot token available for updating message" -Level Warning
        return $null
    }
    
    $retryCount = 0
    
    while ($retryCount -lt $MaxRetries) {
        try {
            $headers = @{
                "Authorization" = "Bot $botToken"
                "Content-Type" = "application/json; charset=utf-8"
                "User-Agent" = "SCUM-Server-Manager/1.0"
            }
            
            $body = @{}
            
            if ($Content) {
                $body.content = $Content
            }
            
            if ($Embed) {
                $body.embeds = @($Embed)
            }
            
            $uri = "https://discord.com/api/v10/channels/$ChannelId/messages/$MessageId"
            
            # Convert to JSON with proper UTF-8 encoding (same as Send-DiscordMessage)
            $json = $body | ConvertTo-Json -Depth 10
            
            # Ensure proper UTF-8 byte encoding for international characters
            $utf8Bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
            
            # Use WebRequest instead of Invoke-RestMethod for better encoding control
            $webRequest = [System.Net.WebRequest]::Create($uri)
            $webRequest.Method = "PATCH"
            $webRequest.ContentType = "application/json; charset=utf-8"
            $webRequest.ContentLength = $utf8Bytes.Length
            
            # Set User-Agent using the proper property
            $webRequest.UserAgent = "SCUM-Server-Manager/1.0"
            
            # Add other headers (skip Content-Type and User-Agent)
            foreach ($key in $headers.Keys) {
                if ($key -eq "Content-Type" -or $key -eq "User-Agent") {
                    # Already set above
                    continue
                }
                $webRequest.Headers.Add($key, $headers[$key])
            }
            
            # Write UTF-8 encoded data
            $requestStream = $webRequest.GetRequestStream()
            $requestStream.Write($utf8Bytes, 0, $utf8Bytes.Length)
            $requestStream.Close()
            
            # Get response
            try {
                $response = $webRequest.GetResponse()
                $responseStream = $response.GetResponseStream()
                $reader = New-Object System.IO.StreamReader($responseStream, [System.Text.Encoding]::UTF8)
                $responseContent = $reader.ReadToEnd()
                $reader.Close()
                $responseStream.Close()
                $response.Close()
                
                $responseObject = $responseContent | ConvertFrom-Json
                
                # Return only message ID for success confirmation
                if ($responseObject -and $responseObject.id) {
                    return @{ id = $responseObject.id; success = $true }
                }
                return $responseObject
                
            } catch [System.Net.WebException] {
                $webException = $_.Exception
                
                # Handle rate limiting
                if ($webException.Response -and $webException.Response.StatusCode -eq 429) {
                    Write-Log "Discord rate limit hit during update (attempt $retryCount/$MaxRetries), waiting..." -Level Warning
                    
                    # Extract retry-after from response if available
                    $retryAfter = 1
                    try {
                        $errorResponse = $webException.Response.GetResponseStream()
                        $reader = New-Object System.IO.StreamReader($errorResponse, [System.Text.Encoding]::UTF8)
                        $errorContent = $reader.ReadToEnd() | ConvertFrom-Json
                        if ($errorContent.retry_after) {
                            $retryAfter = [Math]::Max($errorContent.retry_after, 1)
                        }
                    } catch {
                        # Use default retry time
                    }
                    
                    Start-Sleep -Seconds ($retryAfter + 1)
                    continue
                }
                
                # Re-throw for other web exceptions
                throw
            }
            
        } catch {
            $retryCount++
            
            # Check if it's a rate limit error (429)
            if ($_.Exception.Response -and $_.Exception.Response.StatusCode -eq 429) {
                Write-Log "Discord rate limit hit during update (attempt $retryCount/$MaxRetries), waiting..." -Level Warning
                
                # Extract retry-after from response if available
                $retryAfter = 1
                try {
                    $errorResponse = $_.Exception.Response.GetResponseStream()
                    $reader = New-Object System.IO.StreamReader($errorResponse)
                    $errorContent = $reader.ReadToEnd() | ConvertFrom-Json
                    if ($errorContent.retry_after) {
                        $retryAfter = [Math]::Max($errorContent.retry_after, 1)
                    }
                } catch {
                    # Use default retry time
                }
                
                Start-Sleep -Seconds ($retryAfter + 1)
                continue
            }
            
            # For non-rate-limit errors, show detailed response
            $errorDetails = "Unknown error"
            try {
                if ($_.Exception.Response) {
                    $errorResponse = $_.Exception.Response.GetResponseStream()
                    $reader = New-Object System.IO.StreamReader($errorResponse)
                    $errorContent = $reader.ReadToEnd()
                    $errorDetails = $errorContent
                }
            } catch {
                # Use the original exception message
                $errorDetails = $_.Exception.Message
            }
            
            Write-Error "Failed to update Discord message: $($_.Exception.Message). Response: $errorDetails"
            return $null
        }
    }
    
    Write-Error "Failed to update Discord message after $MaxRetries attempts due to rate limiting"
    return $null
}

function Get-DiscordChannel {
    <#
    .SYNOPSIS
    Get Discord channel information
    #>
    param(
        [Parameter(Mandatory=$false)]
        [string]$Token,
        
        [Parameter(Mandatory=$true)]
        [string]$ChannelId
    )
    
    # Use provided token or fall back to global token
    $botToken = if ($Token) { $Token } else { $script:BotToken }
    
    if (-not $botToken) {
        Write-Log "[DISCORD-API] No bot token available for getting channel" -Level Warning
        return $null
    }
    
    try {
        $headers = @{
            "Authorization" = "Bot $botToken"
            "User-Agent" = "SCUM-Server-Manager/1.0"
        }
        
        $uri = "https://discord.com/api/v10/channels/$ChannelId"
        $response = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers
        return $response
        
    } catch {
        Write-Error "Failed to get Discord channel info: $($_.Exception.Message)"
        return $null
    }
}

function Send-DiscordTyping {
    <#
    .SYNOPSIS
    Send typing indicator to Discord channel
    #>
    param(
        [Parameter(Mandatory=$false)]
        [string]$Token,
        
        [Parameter(Mandatory=$true)]
        [string]$ChannelId
    )
    
    # Use provided token or fall back to global token
    $botToken = if ($Token) { $Token } else { $script:BotToken }
    
    if (-not $botToken) {
        Write-Log "[DISCORD-API] No bot token available for typing indicator" -Level Warning
        return $null
    }
    
    try {
        $headers = @{
            "Authorization" = "Bot $botToken"
            "Content-Length" = "0"
            "User-Agent" = "SCUM-Server-Manager/1.0"
        }
        
        $uri = "https://discord.com/api/v10/channels/$ChannelId/typing"
        Invoke-RestMethod -Uri $uri -Method Post -Headers $headers | Out-Null
        
    } catch {
        # Typing indicators are not critical, so we don't throw errors
        Write-Log "Failed to send typing indicator: $($_.Exception.Message)" -Level "Debug"
    }
}

function Get-DiscordChannelMessages {
    <#
    .SYNOPSIS
    Get recent messages from a Discord channel
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$ChannelId,
        
        [Parameter(Mandatory=$false)]
        [int]$Limit = 50,
        
        [Parameter(Mandatory=$false)]
        [string]$Before = $null,
        
        [Parameter(Mandatory=$false)]
        [string]$After = $null
    )
    
    if (-not $script:BotToken) {
        Write-Log "[DISCORD-API] Bot token not available for getting messages" -Level Warning
        return @()
    }
    
    try {
        $headers = @{
            "Authorization" = "Bot $script:BotToken"
            "User-Agent" = "SCUM-Server-Manager/1.0"
        }
        
        $queryParams = @()
        if ($Limit) { $queryParams += "limit=$Limit" }
        if ($Before) { $queryParams += "before=$Before" }
        if ($After) { $queryParams += "after=$After" }
        
        $queryString = if ($queryParams.Count -gt 0) { "?" + ($queryParams -join "&") } else { "" }
        $uri = "https://discord.com/api/v10/channels/$ChannelId/messages$queryString"
        
        $response = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers
        return $response
        
    } catch {
        Write-Log "[DISCORD-API] Failed to get channel messages: $($_.Exception.Message)" -Level Error
        return @()
    }
}

function Remove-DiscordMessage {
    <#
    .SYNOPSIS
    Delete a Discord message
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$ChannelId,
        
        [Parameter(Mandatory=$true)]
        [string]$MessageId
    )
    
    if (-not $script:BotToken) {
        Write-Log "[DISCORD-API] Bot token not available for deleting messages" -Level Warning
        return $false
    }
    
    try {
        $headers = @{
            "Authorization" = "Bot $script:BotToken"
            "User-Agent" = "SCUM-Server-Manager/1.0"
        }
        
        $uri = "https://discord.com/api/v10/channels/$ChannelId/messages/$MessageId"
        Invoke-RestMethod -Uri $uri -Method Delete -Headers $headers | Out-Null
        return $true
        
    } catch {
        Write-Log "[DISCORD-API] Failed to delete message: $($_.Exception.Message)" -Level Error
        return $false
    }
}

function Get-UserGuildRoles {
    <#
    .SYNOPSIS
    Get user's roles in a Discord guild
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$UserId,
        
        [Parameter(Mandatory=$true)]
        [string]$GuildId
    )
    
    if (-not $script:BotToken) {
        Write-Log "[DISCORD-API] Bot token not available for getting user roles" -Level Warning
        return @()
    }
    
    try {
        $headers = @{
            "Authorization" = "Bot $script:BotToken"
            "User-Agent" = "SCUM-Server-Manager/1.0"
        }
        
        $uri = "https://discord.com/api/v10/guilds/$GuildId/members/$UserId"
        $response = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers
        return $response.roles
        
    } catch {
        Write-Log "[DISCORD-API] Failed to get user roles: $($_.Exception.Message)" -Level Error
        return @()
    }
}

function Invoke-DiscordAPI {
    <#
    .SYNOPSIS
    Generic Discord API call function
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$Endpoint,
        [Parameter(Mandatory=$false)]
        [string]$Method = "GET",
        [Parameter(Mandatory=$false)]
        [hashtable]$Body = $null,
        [Parameter(Mandatory=$false)]
        [string]$Token
    )
    
    # Use provided token or fall back to global token
    $botToken = if ($Token) { $Token } else { $script:BotToken }
    
    if (-not $botToken) {
        Write-Log "[DISCORD-API] No bot token available for API call" -Level Warning
        return $null
    }
    
    try {
        $headers = @{
            "Authorization" = "Bot $botToken"
            "User-Agent" = "SCUM-Server-Manager/1.0"
        }
        
        if ($Body) {
            $headers["Content-Type"] = "application/json"
        }
        
        $uri = "https://discord.com/api/v10/$Endpoint"
        
        $params = @{
            Uri = $uri
            Method = $Method
            Headers = $headers
        }
        
        if ($Body) {
            $params.Body = ($Body | ConvertTo-Json -Depth 10)
        }
        
        $response = Invoke-RestMethod @params
        return $response
        
    } catch [System.Net.WebException] {
        $errorResponse = $_.Exception.Response
        if ($errorResponse) {
            $statusCode = [int]$errorResponse.StatusCode
            $statusDescription = $errorResponse.StatusDescription
            
            # For 204 No Content (successful reaction add), don't log as error
            if ($statusCode -eq 204) {
                return $true
            }
            
            Write-Log "[DISCORD-API] API call failed: HTTP $statusCode - $statusDescription" -Level Warning
        } else {
            Write-Log "[DISCORD-API] API call failed: $($_.Exception.Message)" -Level Error
        }
        return $null
    } catch {
        Write-Log "[DISCORD-API] API call failed: $($_.Exception.Message)" -Level Error
        return $null
    }
}

Export-ModuleMember -Function @(
    'Initialize-DiscordAPI',
    'Send-DiscordMessage',
    'Update-DiscordMessage',
    'Get-DiscordChannel',
    'Send-DiscordTyping',
    'Get-DiscordChannelMessages',
    'Remove-DiscordMessage',
    'Get-UserGuildRoles',
    'Invoke-DiscordAPI'
)
