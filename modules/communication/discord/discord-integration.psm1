#Requires -Version 5.1

<#
.SYNOPSIS
    Complete Discord Integration Module for SCUM Server Automation

.DESCRIPTION
    Universal Discord module that handles everything:
    - Node.js Discord bot lifecycle management
    - HTTP API communication with bot
    - Message sending and embed creation
    - Account linking system
    - Chat relay and notifications
    - All Discord functionality in one module

.NOTES
    Author: SCUM Server Automation
    Requires: Node.js LTS, Discord.js v14
    Replaces: discord-api.psm1, discord-websocket-bot-direct.psm1, and all other Discord modules
#>

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
    Write-Warning "[WARNING] Common module not available for discord-integration module"
}

# Import embed persistence module
try {
    $embedPersistencePath = Join-Path $PSScriptRoot "embed-persistence.psm1"
    if (Test-Path $embedPersistencePath) {
        if (-not (Get-Module "embed-persistence" -ErrorAction SilentlyContinue)) {
            Import-Module $embedPersistencePath -ErrorAction SilentlyContinue
        }
    }
} catch {
    Write-Warning "[WARNING] Embed persistence module not available"
}

# Module variables
$script:ModuleConfig = @{
    Name = "DiscordIntegration"
    Version = "2.0.0"
    NodePath = ""
    BotProcess = $null
    BotScriptPath = ""
    IsInitialized = $false
    LastHeartbeat = $null
    BotToken = $null
    HttpApiPort = 3001
    HttpApiHost = "localhost"
    NodeBotApiUrl = "http://localhost:3001"
}

# =============================================================================
# CORE MODULE INITIALIZATION AND BOT MANAGEMENT
# =============================================================================

<#
.SYNOPSIS
    Initializes the Discord integration module.
#>
function Initialize-DiscordIntegrationModule {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Config
    )

    try {
        # Determine root path correctly - discord integration should use main automation root
        $currentModulePath = $PSScriptRoot  # C:\SCUMServer\modules\communication\discord
        $automationRoot = (Get-Item $currentModulePath).Parent.Parent.Parent.FullName  # C:\SCUMServer
        
        # Use automation root regardless of config
        $rootPath = $automationRoot
        
        $script:ModuleConfig.NodePath = Join-Path $rootPath "nodejs"
        $script:ModuleConfig.BotScriptPath = Join-Path $rootPath "discord-bot"
        
        # Configure HTTP API settings from config
        if ($Config.Discord -and $Config.Discord.HttpApi) {
            $script:ModuleConfig.HttpApiPort = $Config.Discord.HttpApi.Port
            $script:ModuleConfig.HttpApiHost = $Config.Discord.HttpApi.Host
            $script:ModuleConfig.NodeBotApiUrl = "http://$($Config.Discord.HttpApi.Host):$($Config.Discord.HttpApi.Port)"
        }
        
        Write-Log "[DiscordIntegration] Universal Discord module initialized" -Level Debug
        Write-Log "[DiscordIntegration] Root path: $rootPath" -Level Debug
        Write-Log "[DiscordIntegration] Node path: $($script:ModuleConfig.NodePath)" -Level Debug
        Write-Log "[DiscordIntegration] Bot path: $($script:ModuleConfig.BotScriptPath)" -Level Debug
        Write-Log "[DiscordIntegration] HTTP API: $($script:ModuleConfig.NodeBotApiUrl)" -Level Debug
        $script:ModuleConfig.IsInitialized = $true
        
        return @{ Success = $true; Message = "Discord integration module initialized" }
    }
    catch {
        Write-Log "[DiscordIntegration] Initialization failed: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

<#
.SYNOPSIS
    Ensures Node.js is installed and ready for Discord bot.
#>
function Initialize-NodeJSForDiscord {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Config
    )

    try {
        # Import installation module - determine root path correctly
        $currentModulePath = $PSScriptRoot  # C:\SCUMServer\modules\communication\discord
        $rootPath = (Get-Item $currentModulePath).Parent.Parent.Parent.FullName  # C:\SCUMServer
        $installationModule = Join-Path $rootPath "modules\server\installation\installation.psm1"
        
        Write-Log "[DiscordIntegration] Looking for installation module at: $installationModule" -Level Debug
        
        if (-not (Test-Path $installationModule)) {
            throw "Installation module not found at: $installationModule"
        }
        
        Import-Module $installationModule -Force

        Write-Log "[DiscordIntegration] Checking Node.js installation..." -Level Debug

        # Install Node.js if needed
        $nodeResult = Install-NodeJS -NodePath $script:ModuleConfig.NodePath
        
        if (-not $nodeResult.Success) {
            throw "Node.js installation failed: $($nodeResult.Error)"
        }

        Write-Log "[DiscordIntegration] Node.js ready: $($nodeResult.Message)" -Level Debug
        return $nodeResult

    } catch {
        Write-Log "[DiscordIntegration] Node.js setup failed: $($_.Exception.Message)" -Level Error
        throw
    }
}

<#
.SYNOPSIS
    Initializes the Discord bot by ensuring package.json exists and bot.js is ready.
#>
function Initialize-DiscordBot {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Config
    )

    try {
        $botPath = $script:ModuleConfig.BotScriptPath
        
        # Create bot directory
        if (-not (Test-Path $botPath)) {
            New-Item -ItemType Directory -Path $botPath -Force | Out-Null
        }

        # Check if our main bot-modular.js exists
        $botScriptPath = Join-Path $botPath "bot-modular.js"
        if (-not (Test-Path $botScriptPath)) {
            Write-Log "[Discord] Bot script not found at: $botScriptPath" -Level Error
            return @{ Success = $false; Error = "Bot script not found. Please ensure bot-modular.js exists in discord-bot directory." }
        }

        # Create package.json only if it doesn't exist
        $packagePath = Join-Path $botPath "package.json"
        if (-not (Test-Path $packagePath)) {
            $packageJson = @{
                name = "scum-discord-bot"
                version = "1.0.0"
                description = "SCUM Server Discord Integration Bot"
                main = "bot-modular.js"
                dependencies = @{
                    "discord.js" = "^14.14.1"
                    "sqlite3" = "^5.1.6"
                    "express" = "^4.18.2"
                }
            } | ConvertTo-Json -Depth 3

            Set-Content -Path $packagePath -Value $packageJson -Encoding UTF8
            Write-Log "[Discord] Package.json created" -Level Debug
        }

        Write-Log "[Discord] Bot script verified successfully" -Level Debug
        return @{ Success = $true; Message = "Discord bot initialized" }

    } catch {
        Write-Log "[Discord] Bot initialization failed: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

<#
.SYNOPSIS
    Installs Node.js dependencies for the Discord bot.
#>
function Install-DiscordDependencies {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Config
    )

    try {
        $nodeExe = Join-Path $script:ModuleConfig.NodePath "node.exe"
        $npmExe = Join-Path $script:ModuleConfig.NodePath "npm.cmd"
        $botPath = $script:ModuleConfig.BotScriptPath

        if (-not (Test-Path $nodeExe)) {
            throw "Node.js executable not found: $nodeExe"
        }

        Write-Log "[Discord] Installing Node.js dependencies..." -Level Debug

        # Set up environment for npm (add Node.js to PATH)
        $originalPath = $env:PATH
        $nodePath = Split-Path $nodeExe -Parent
        $env:PATH = "$nodePath;$originalPath"
        
        try {
            # Install dependencies with environment setup
            $npmArgs = @("install", "--production", "--no-audit", "--no-fund")
            $npmProcess = Start-Process -FilePath $npmExe -ArgumentList $npmArgs -WorkingDirectory $botPath -WindowStyle Hidden -Wait -PassThru

            if ($npmProcess.ExitCode -ne 0) {
                throw "npm install failed with exit code: $($npmProcess.ExitCode)"
            }

            Write-Log "[Discord] Dependencies installed successfully" -Level Debug
            return @{ Success = $true; Message = "Dependencies installed" }
            
        } finally {
            # Restore original PATH
            $env:PATH = $originalPath
        }

    } catch {
        Write-Log "[Discord] Dependency installation failed: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

<#
.SYNOPSIS
    Starts the Discord bot process.
#>
function Start-DiscordBot {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Config
    )

    try {
        Write-Log "[Discord] Starting Discord bot - force killing any existing instances..." -Level Debug
        
        # ALWAYS kill any existing Discord bot processes on our port
        try {
            # Find Node.js processes that are listening on our configured port
            $connections = netstat -ano | Select-String ":$($script:ModuleConfig.HttpApiPort).*LISTENING"
            $processIds = $connections | ForEach-Object { ($_ -split '\s+')[-1] }
            
            if ($processIds) {
                foreach ($pid in $processIds) {
                    try {
                        $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
                        if ($process -and $process.ProcessName -eq "node") {
                            Write-Log "[Discord] Killing existing Node.js process on port $($script:ModuleConfig.HttpApiPort): PID $pid" -Level Debug
                            Stop-Process -Id $pid -Force
                        }
                    } catch {
                        Write-Log "[Discord] Failed to kill process $pid`: $($_.Exception.Message)" -Level Warning
                    }
                }
                Start-Sleep -Seconds 3  # Wait for processes to fully terminate
            }
        } catch {
            Write-Log "[Discord] Error checking for existing processes: $($_.Exception.Message)" -Level Warning
        }
        
        # Also kill any previous bot process we might have stored
        if ($script:ModuleConfig.BotProcess) {
            try {
                if (-not $script:ModuleConfig.BotProcess.HasExited) {
                    Write-Log "[Discord] Killing stored bot process: PID $($script:ModuleConfig.BotProcess.Id)" -Level Debug
                    $script:ModuleConfig.BotProcess.Kill()
                }
            } catch {
                Write-Log "[Discord] Failed to kill stored bot process: $($_.Exception.Message)" -Level Warning
            }
            $script:ModuleConfig.BotProcess = $null
        }

        $nodeExe = Join-Path $script:ModuleConfig.NodePath "node.exe"
        $botScript = Join-Path $script:ModuleConfig.BotScriptPath "bot-modular.js"
        
        # Create absolute path to database
        if ([System.IO.Path]::IsPathRooted($Config.dataDir)) {
            $databasePath = Join-Path $Config.dataDir "server_database.db"
        } else {
            # Convert relative path to absolute path from root directory
            $rootPath = Split-Path $script:ModuleConfig.BotScriptPath -Parent
            $absoluteDataDir = Join-Path $rootPath $Config.dataDir
            $databasePath = Join-Path $absoluteDataDir "server_database.db"
        }

        if (-not (Test-Path $nodeExe)) {
            throw "Node.js executable not found: $nodeExe"
        }

        if (-not (Test-Path $botScript)) {
            throw "Bot script not found: $botScript"
        }

        # Check Discord configuration
        if (-not $Config.Discord -or -not $Config.Discord.Token) {
            throw "Discord bot token not configured"
        }

        Write-Log "[Discord] Starting Discord bot..." -Level Debug
        Write-Log "[Discord] Node.js executable: $nodeExe" -Level Debug
        Write-Log "[Discord] Bot script: $botScript" -Level Debug
        Write-Log "[Discord] Database: $databasePath" -Level Debug

        # Store token for API functions
        $script:ModuleConfig.BotToken = $Config.Discord.Token

        # Get root directory for config
        $configRootDir = if ($Global:Config -and $Global:Config.configPath) { 
            Split-Path $Global:Config.configPath -Parent 
        } else { 
            $PWD.Path 
        }
        
        # Determine config path
        $configPath = if ($Global:Config -and $Global:Config.configPath) { 
            $Global:Config.configPath 
        } else { 
            Join-Path $configRootDir "SCUM-Server-Automation.config.json" 
        }
        
        # Create environment for the process
        $processEnv = @{
            'DISCORD_TOKEN' = $Config.Discord.Token
            'DISCORD_GUILD_ID' = $Config.Discord.GuildId
            'HTTP_PORT' = $script:ModuleConfig.HttpApiPort
            'ROOT_DIR' = $configRootDir
            'CONFIG_PATH' = $configPath
            'DEBUG' = 'false'
        }

        Write-Log "[Discord] Environment variables set - ROOT_DIR: $configRootDir" -Level Debug
        Write-Log "[Discord] Starting bot with config path: $($processEnv['CONFIG_PATH'])" -Level Debug

        # Build PowerShell command to set environment and run bot
        $envCommands = $processEnv.GetEnumerator() | ForEach-Object { "`$env:$($_.Key) = '$($_.Value)'" }
        $envString = $envCommands -join '; '
        $fullCommand = "$envString; & `"$nodeExe`" `"$botScript`""

        Write-Log "[Discord] Starting with command: powershell -Command `"$fullCommand`"" -Level Debug

        # Start the bot process using PowerShell to set environment variables
        $startProcessParams = @{
            FilePath = 'powershell'
            ArgumentList = @('-NoProfile', '-Command', $fullCommand)
            WorkingDirectory = $script:ModuleConfig.BotScriptPath
            PassThru = $true
        }

        # Use Start-Process with NoNewWindow to avoid SIGINT propagation
        $script:ModuleConfig.BotProcess = Start-Process @startProcessParams -NoNewWindow

        if (-not $script:ModuleConfig.BotProcess) {
            throw "Failed to create bot process"
        }

        Write-Log "[Discord] Bot process started with PID: $($script:ModuleConfig.BotProcess.Id)" -Level Debug

        # Wait longer for the bot to fully start
        Start-Sleep -Seconds 5
        
        # Check if process is still alive
        $processStillRunning = Get-Process -Id $script:ModuleConfig.BotProcess.Id -ErrorAction SilentlyContinue
        if (-not $processStillRunning) {
            throw "Bot process exited immediately with code: $($script:ModuleConfig.BotProcess.ExitCode)"
        }

        # Test HTTP API to confirm bot is working
        $apiTestAttempts = 0
        $maxAttempts = 10
        $apiWorking = $false
        
        while ($apiTestAttempts -lt $maxAttempts -and -not $apiWorking) {
            try {
                Start-Sleep -Seconds 2
                $response = Invoke-RestMethod -Uri "$($script:ModuleConfig.NodeBotApiUrl)/api/status" -Method GET -TimeoutSec 3 -ErrorAction SilentlyContinue
                if ($response -and $response.status -eq "online") {
                    $apiWorking = $true
                    Write-Log "[Discord] Bot started successfully (PID: $($script:ModuleConfig.BotProcess.Id)) and HTTP API is responding" -Level Debug
                    Write-Log "[Discord] API Status: $($response.status), Guilds: $($response.guilds), Users: $($response.users)" -Level Debug
                } else {
                    $apiTestAttempts++
                    Write-Log "[Discord] API test attempt $apiTestAttempts/$maxAttempts failed, retrying..." -Level Debug
                }
            } catch {
                $apiTestAttempts++
                Write-Log "[Discord] API test attempt $apiTestAttempts/$maxAttempts failed: $($_.Exception.Message)" -Level Debug
            }
        }

        if (-not $apiWorking) {
            Write-Log "[Discord] Bot process running but HTTP API not responding after $maxAttempts attempts" -Level Warning
            # Don't fail completely, the bot might still work for some functions
        }

        $script:ModuleConfig.LastHeartbeat = Get-Date

        return @{ Success = $true; Message = "Discord bot started"; ProcessId = $script:ModuleConfig.BotProcess.Id; ApiWorking = $apiWorking }

    } catch {
        Write-Log "[Discord] Failed to start bot: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

<#
.SYNOPSIS
    Stops the Discord bot process.
#>
function Stop-DiscordBot {
    try {
        Write-Log "[Discord] Stopping Discord bot - force killing all instances..." -Level Debug
        
        # Kill any stored process reference
        if ($script:ModuleConfig.BotProcess) {
            try {
                if (-not $script:ModuleConfig.BotProcess.HasExited) {
                    Write-Log "[Discord] Killing stored bot process: PID $($script:ModuleConfig.BotProcess.Id)" -Level Debug
                    $script:ModuleConfig.BotProcess.Kill()
                }
            } catch {
                Write-Log "[Discord] Failed to kill stored bot process: $($_.Exception.Message)" -Level Warning
            }
            $script:ModuleConfig.BotProcess = $null
        }
        
        # Kill any Node.js process using our configured port
        try {
            $connections = netstat -ano | Select-String ":$($script:ModuleConfig.HttpApiPort).*LISTENING"
            $processIds = $connections | ForEach-Object { ($_ -split '\s+')[-1] }
            
            if ($processIds) {
                foreach ($pid in $processIds) {
                    try {
                        $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
                        if ($process -and $process.ProcessName -eq "node") {
                            Write-Log "[Discord] Force killing Node.js process on port $($script:ModuleConfig.HttpApiPort): PID $pid" -Level Debug
                            Stop-Process -Id $pid -Force
                        }
                    } catch {
                        Write-Log "[Discord] Failed to kill process $pid`: $($_.Exception.Message)" -Level Warning
                    }
                }
            }
        } catch {
            Write-Log "[Discord] Error checking for processes on port: $($_.Exception.Message)" -Level Warning
        }
        
        Write-Log "[Discord] Bot stopped successfully" -Level Debug
        return @{ Success = $true; Message = "Discord bot stopped" }

    } catch {
        Write-Log "[Discord] Failed to stop bot: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

<#
.SYNOPSIS
    Finds Node.js processes that are running our Discord bot (listening on configured port).
#>
function Get-DiscordBotProcesses {
    try {
        $botProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
            try {
                # Get network connections to check if this process is using our configured port
                $connections = netstat -ano | Select-String ":$($script:ModuleConfig.HttpApiPort).*LISTENING"
                $processIds = $connections | ForEach-Object { ($_ -split '\s+')[-1] }
                return $processIds -contains $_.Id.ToString()
            } catch {
                return $false
            }
        }
        
        return $botProcesses
    } catch {
        Write-Log "[Discord] Error finding bot processes: $($_.Exception.Message)" -Level Warning
        return @()
    }
}

# =============================================================================
# DISCORD API FUNCTIONS (HTTP API COMMUNICATION WITH NODE.JS BOT)
# =============================================================================

<#
.SYNOPSIS
    Send message to Discord channel via Node.js bot HTTP API
#>
function Send-DiscordMessage {
    param(
        [Parameter(Mandatory=$false)]
        [string]$Token,
        
        [Parameter(Mandatory=$true)]
        [string]$ChannelId,
        
        [Parameter(Mandatory=$false)]
        [string]$Content = "",
        
        [Parameter(Mandatory=$false)]
        [hashtable[]]$Embeds = @(),
        
        [Parameter(Mandatory=$false)]
        [hashtable[]]$Components = @(),
        
        [Parameter(Mandatory=$false)]
        [string]$UpdateMessageId = "",
        
        [Parameter(Mandatory=$false)]
        [hashtable[]]$Files = @()
    )

    try {
        # Prepare request body for Node.js bot
        $body = @{
            channelId = $ChannelId
            content = $Content
            embeds = $Embeds
            components = $Components
            files = $Files
        }

        if ($UpdateMessageId) {
            $body.updateMessageId = $UpdateMessageId
        }

        # Convert to JSON and send to Node.js bot
        $jsonBody = $body | ConvertTo-Json -Depth 10 -Compress
        
        # Make HTTP request to Node.js bot
        $response = Invoke-RestMethod -Uri "$($script:ModuleConfig.NodeBotApiUrl)/api/send-message" -Method POST -Body $jsonBody -ContentType "application/json" -TimeoutSec 30

        if ($response.success) {
            Write-Log "[DISCORD-API] Message sent successfully to channel $ChannelId" -Level Debug
            return @{
                Success = $true
                MessageId = $response.messageId
                StatusCode = 200
            }
        } else {
            throw "Bot returned error: $($response.error)"
        }

    } catch {
        $errorMessage = $_.Exception.Message
        Write-Log "[DISCORD-API] Failed to send message: $errorMessage" -Level Error
        
        return @{
            Success = $false
            Error = $errorMessage
            StatusCode = 500
        }
    }
}

<#
.SYNOPSIS
    Update an existing Discord message via Node.js bot
#>
function Update-DiscordMessage {
    param(
        [Parameter(Mandatory=$false)]
        [string]$Token,
        
        [Parameter(Mandatory=$true)]
        [string]$ChannelId,
        
        [Parameter(Mandatory=$true)]
        [string]$MessageId,
        
        [Parameter(Mandatory=$false)]
        [string]$Content = "",
        
        [Parameter(Mandatory=$false)]
        [hashtable[]]$Embeds = @(),
        
        [Parameter(Mandatory=$false)]
        [hashtable[]]$Components = @()
    )

    return Send-DiscordMessage -ChannelId $ChannelId -Content $Content -Embeds $Embeds -Components $Components -UpdateMessageId $MessageId
}

# =============================================================================
# HTTP API HELPER FUNCTIONS
# =============================================================================

<#
.SYNOPSIS
    Checks if the Discord bot is running and healthy using HTTP API.
#>
function Test-DiscordBotHealth {
    try {
        # First check if we have a valid process
        $processRunning = $false
        if ($script:ModuleConfig.BotProcess -and -not $script:ModuleConfig.BotProcess.HasExited) {
            $processRunning = $true
        }

        # Test HTTP API health - this is the primary health check
        try {
            $response = Invoke-RestMethod -Uri "$($script:ModuleConfig.NodeBotApiUrl)/api/status" -Method GET -TimeoutSec 5
            
            if ($response.status -eq "online") {
                return @{ 
                    Success = $true; 
                    Message = "Bot is healthy and responding"; 
                    IsHealthy = $true;
                    ProcessRunning = $processRunning;
                    HeartbeatOk = $true;
                    ApiStatus = $response.status;
                    Uptime = $response.uptime;
                    Guilds = $response.guilds;
                    Users = $response.users;
                    Ping = $response.ping
                }
            } else {
                return @{ 
                    Success = $false; 
                    Message = "Bot API returned unhealthy status: $($response.status)"; 
                    IsHealthy = $false;
                    ProcessRunning = $processRunning;
                    HeartbeatOk = $false
                }
            }
        } catch {
            # If API is not responding, bot is considered unhealthy
            return @{ 
                Success = $false; 
                Message = "Bot API not responding: $($_.Exception.Message)"; 
                IsHealthy = $false;
                ProcessRunning = $processRunning;
                HeartbeatOk = $false
            }
        }

    } catch {
        return @{ 
            Success = $false; 
            Error = $_.Exception.Message;
            IsHealthy = $false;
            ProcessRunning = $false;
            HeartbeatOk = $false
        }
    }
}

# =============================================================================
# ACCOUNT LINKING SYSTEM
# =============================================================================

<#
.SYNOPSIS
    Creates account linking embed with buttons using Node.js API.
#>
function New-AccountLinkingEmbed {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ChannelId,
        [Parameter(Mandatory = $false)]
        [string]$UpdateMessageId
    )

    try {
        # If UpdateMessageId not provided, check persistence system
        if (-not $UpdateMessageId -and (Get-Command "Get-EmbedMessageId" -ErrorAction SilentlyContinue)) {
            $embedInfo = Get-EmbedMessageId -EmbedType "account-linking" -ChannelId $ChannelId
            if ($embedInfo -and $embedInfo.MessageId) {
                $UpdateMessageId = $embedInfo.MessageId
                Write-Log "[Discord] Found existing account linking embed ID: $UpdateMessageId" -Level Debug
            }
        }
        
        # Use dedicated Node.js API endpoint for account linking embed
        $body = @{
            channelId = $ChannelId
        }
        
        # Add message ID if updating existing embed
        if ($UpdateMessageId) {
            $body.updateMessageId = $UpdateMessageId
        }

        $response = Invoke-NodeJsApiRequest -Endpoint "/api/account-linking/embed" -Method "POST" -Body $body

        if ($response.Success -and $response.Data.success) {
            $operation = if ($response.Data.operation) { $response.Data.operation } else { "created" }
            
            # Store message ID in persistence system
            if (Get-Command "Set-EmbedMessageId" -ErrorAction SilentlyContinue) {
                Set-EmbedMessageId -EmbedType "account-linking" -MessageId $response.Data.messageId -ChannelId $ChannelId
                Write-Log "[Discord] Stored account linking embed ID in persistence: $($response.Data.messageId)" -Level Debug
            }
            
            Write-Log "[Discord] Account linking embed $operation successfully in channel $ChannelId" -Level Debug
            return @{
                Success = $true
                MessageId = $response.Data.messageId
                ChannelId = $response.Data.channelId
                Operation = $operation
                Message = $response.Data.message
            }
        } else {
            throw "Failed to create account linking embed: $($response.Data.error)"
        }

    } catch {
        Write-Log "[Discord] Failed to create account linking embed: $($_.Exception.Message)" -Level Error
        return @{
            Success = $false
            Error = $_.Exception.Message
        }
    }
}

<#
.SYNOPSIS
    Updates existing account linking embed to refresh timestamp and content.
#>
function Update-AccountLinkingEmbed {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ChannelId,
        [Parameter(Mandatory = $false)]
        [string]$MessageId
    )

    try {
        # If MessageId not provided, get it from persistence system
        if (-not $MessageId -and (Get-Command "Get-EmbedMessageId" -ErrorAction SilentlyContinue)) {
            $embedInfo = Get-EmbedMessageId -EmbedType "account-linking" -ChannelId $ChannelId
            if ($embedInfo -and $embedInfo.MessageId) {
                $MessageId = $embedInfo.MessageId
                Write-Log "[Discord] Retrieved account linking embed ID from persistence: $MessageId" -Level Debug
            } else {
                Write-Log "[Discord] No stored account linking embed found for channel $ChannelId" -Level Warning
                return @{
                    Success = $false
                    Error = "No stored embed message ID found"
                }
            }
        }
        
        if (-not $MessageId) {
            Write-Log "[Discord] No message ID provided and persistence not available" -Level Warning
            return @{
                Success = $false
                Error = "No message ID available for update"
            }
        }
        
        Write-Log "[Discord] Updating account linking embed in channel $ChannelId (message: $MessageId)" -Level Debug
        
        # Use the same function but with UpdateMessageId parameter
        $result = New-AccountLinkingEmbed -ChannelId $ChannelId -UpdateMessageId $MessageId
        
        if ($result.Success) {
            Write-Log "[Discord] Account linking embed updated successfully" -Level Debug
            return $result
        } else {
            throw "Update failed: $($result.Error)"
        }

    } catch {
        Write-Log "[Discord] Failed to update account linking embed: $($_.Exception.Message)" -Level Warning
        return @{
            Success = $false
            Error = $_.Exception.Message
        }
    }
}

<#
.SYNOPSIS
    Manages automatic refresh of account linking embeds.
#>
function Start-AccountLinkingEmbedRefresh {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Config
    )

    try {
        # Check if account linking is configured
        if (-not $Config.Discord.AccountLinking.Enabled -or -not $Config.Discord.AccountLinking.Channel) {
            Write-Log "[Discord] Account linking embed refresh not configured" -Level Debug
            return $false
        }

        # Set default refresh interval (6 hours)
        $refreshIntervalHours = if ($Config.Discord.AccountLinking.RefreshIntervalHours) { 
            $Config.Discord.AccountLinking.RefreshIntervalHours 
        } else { 6 }

        Write-Log "[Discord] Account linking embed refresh enabled (every $refreshIntervalHours hours)" -Level Info

        # Store refresh configuration in module scope for monitoring loop
        $script:ModuleConfig.AccountLinkingRefresh = @{
            Enabled = $true
            ChannelId = $Config.Discord.AccountLinking.Channel
            IntervalHours = $refreshIntervalHours
            LastRefresh = $null
        }

        return $true

    } catch {
        Write-Log "[Discord] Failed to start account linking embed refresh: $($_.Exception.Message)" -Level Error
        return $false
    }
}

<#
.SYNOPSIS
    Updates account linking embed refresh monitoring (called from main loop).
#>
function Update-AccountLinkingEmbedRefresh {
    try {
        # Check if refresh is enabled
        if (-not $script:ModuleConfig.AccountLinkingRefresh.Enabled) {
            return
        }

        $config = $script:ModuleConfig.AccountLinkingRefresh
        $currentTime = Get-Date

        # Check if it's time to refresh
        if ($config.LastRefresh) {
            $timeSinceLastRefresh = $currentTime - $config.LastRefresh
            if ($timeSinceLastRefresh.TotalHours -lt $config.IntervalHours) {
                return # Not time yet
            }
        }

        Write-Log "[Discord] Refreshing account linking embed..." -Level Debug

        # Try to update existing embed (persistence system will handle finding the message ID)
        $result = Update-AccountLinkingEmbed -ChannelId $config.ChannelId
        
        if ($result.Success) {
            # Update was successful
            $config.LastRefresh = $currentTime
            Write-Log "[Discord] Account linking embed refreshed successfully" -Level Debug
        } else {
            # Update failed, try to create new embed
            Write-Log "[Discord] Account linking embed update failed, creating new one: $($result.Error)" -Level Warning
            
            $createResult = New-AccountLinkingEmbed -ChannelId $config.ChannelId
            
            if ($createResult.Success) {
                $config.LastRefresh = $currentTime
                Write-Log "[Discord] New account linking embed created for refresh" -Level Debug
            } else {
                Write-Log "[Discord] Failed to create account linking embed for refresh: $($createResult.Error)" -Level Warning
            }
        }

    } catch {
        Write-Log "[Discord] Error during account linking embed refresh: $($_.Exception.Message)" -Level Error
    }
}

# =============================================================================
# =============================================================================
# HTTP API HELPER FUNCTIONS
# =============================================================================

function Invoke-NodeJsApiRequest {
    <#
    .SYNOPSIS
        Makes HTTP requests to the Node.js Discord bot API
    .DESCRIPTION
        Universal function for communicating with the Node.js bot HTTP API
    .PARAMETER Endpoint
        API endpoint (e.g., "/send-message", "/account-linking/process-connect")
    .PARAMETER Method
        HTTP method (GET, POST, PUT, DELETE)
    .PARAMETER Body
        Request body as hashtable (will be converted to JSON)
    .PARAMETER Headers
        Additional headers as hashtable
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$Endpoint,
        
        [Parameter(Mandatory=$false)]
        [ValidateSet("GET", "POST", "PUT", "DELETE")]
        [string]$Method = "GET",
        
        [Parameter(Mandatory=$false)]
        [hashtable]$Body = @{},
        
        [Parameter(Mandatory=$false)]
        [hashtable]$Headers = @{}
    )
    
    try {
        # Build URL
        $url = "$($script:ModuleConfig.NodeBotApiUrl)$Endpoint"
        
        # Prepare request parameters
        $requestParams = @{
            Uri = $url
            Method = $Method
            ContentType = "application/json"
            Headers = $Headers
            TimeoutSec = 30
        }
        
        # Add body for POST/PUT requests
        if ($Method -in @("POST", "PUT") -and $Body.Count -gt 0) {
            $requestParams.Body = ($Body | ConvertTo-Json -Depth 10)
        }
        
        Write-Log "[DiscordAPI] Making $Method request to: $url" -Level Debug
        
        # Make the request
        $response = Invoke-RestMethod @requestParams
        
        Write-Log "[DiscordAPI] Request successful" -Level Debug
        return @{
            Success = $true
            Data = $response
            StatusCode = 200
        }
        
    } catch {
        $errorMessage = $_.Exception.Message
        Write-Log "[DiscordAPI] Request failed: $errorMessage" -Level Warning
        
        # Try to extract more details from the response
        $statusCode = $null
        $responseBody = $null
        
        if ($_.Exception -is [System.Net.WebException]) {
            $response = $_.Exception.Response
            if ($response) {
                $statusCode = [int]$response.StatusCode
                try {
                    $stream = $response.GetResponseStream()
                    $reader = New-Object System.IO.StreamReader($stream)
                    $responseBody = $reader.ReadToEnd()
                    $reader.Close()
                    $stream.Close()
                } catch {
                    # Ignore errors reading response body
                }
            }
        }
        
        return @{
            Success = $false
            Error = $errorMessage
            StatusCode = $statusCode
            ResponseBody = $responseBody
        }
    }
}

# ===============================================================
# DISCORD LIVE EMBEDS HELPERS
# ===============================================================

function Update-DiscordServerStatus {
    <#
    .SYNOPSIS
    Update server status embed if module is available
    #>
    param(
        [hashtable]$ServerStatus = @{}
    )
    
    try {
        if (Get-Command "Update-ServerStatusEmbed" -ErrorAction SilentlyContinue) {
            Update-ServerStatusEmbed -ServerStatus $ServerStatus
            Write-Log "[Discord] Server status embed updated" -Level Debug
        } else {
            Write-Log "[Discord] Server status embed module not available" -Level Debug
        }
    } catch {
        Write-Log "[Discord] Failed to update server status embed: $($_.Exception.Message)" -Level Warning
    }
}

function Update-DiscordLeaderboards {
    <#
    .SYNOPSIS
    Update leaderboards embeds on server restart
    #>
    
    try {
        if (Get-Command "Update-LeaderboardsOnRestart" -ErrorAction SilentlyContinue) {
            Update-LeaderboardsOnRestart
            Write-Log "[Discord] Leaderboards embeds updated" -Level Debug
        } else {
            Write-Log "[Discord] Leaderboards embed module not available" -Level Debug
        }
    } catch {
        Write-Log "[Discord] Failed to update leaderboards embeds: $($_.Exception.Message)" -Level Warning
    }
}

# ===============================================================
# EXPORTS
# ===============================================================

Export-ModuleMember -Function @(
    # Core module functions
    'Initialize-DiscordIntegrationModule',
    'Initialize-NodeJSForDiscord',
    'Initialize-DiscordBot',
    'Install-DiscordDependencies',
    'Start-DiscordBot',
    'Stop-DiscordBot',
    'Test-DiscordBotHealth',
    'Test-DiscordBotConnection',
    'Get-DiscordBotProcesses',
    
    # Node.js HTTP API communication
    'Invoke-NodeJsApiRequest',
    'Send-DiscordMessage',
    'Update-DiscordMessage',
    
    # Live embeds helpers
    'Update-DiscordServerStatus',
    'Update-DiscordLeaderboards',
    
    # Account linking
    'New-AccountLinkingEmbed',
    'Update-AccountLinkingEmbed',
    'Start-AccountLinkingEmbedRefresh',
    'Update-AccountLinkingEmbedRefresh'
)
