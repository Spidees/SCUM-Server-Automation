# ===============================================================
# SCUM Server Automation - Discord Account Linking
# ===============================================================
# Discord account linking system with registration codes and chat integration
# ===============================================================

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
    
    # Import Discord Integration module (instead of old discord-api)
    $discordIntegrationPath = Join-Path $PSScriptRoot "discord-integration.psm1"
    if (Test-Path $discordIntegrationPath) {
        if (-not (Get-Module "discord-integration" -ErrorAction SilentlyContinue)) {
            Import-Module $discordIntegrationPath -ErrorAction SilentlyContinue
        }
    }
    
    # Import embed persistence module
    $embedPersistencePath = Join-Path $PSScriptRoot "embed-persistence.psm1"
    if (Test-Path $embedPersistencePath) {
        if (-not (Get-Module "embed-persistence" -ErrorAction SilentlyContinue)) {
            Import-Module $embedPersistencePath -ErrorAction SilentlyContinue
        }
    }
    
    # Import database module
    $databasePath = Join-Path $PSScriptRoot "..\..\database\server-database.psm1"
    if (Test-Path $databasePath) {
        if (-not (Get-Module "server-database" -ErrorAction SilentlyContinue)) {
            Import-Module $databasePath -ErrorAction SilentlyContinue
        }
    }
} catch {
    Write-Log "Common module not available for account-linking module" -Level "Warning"
}

# Global variables
$script:Config = $null
$script:DiscordConfig = $null
$script:Database = $null
$script:AccountLinkingActive = $false
$script:StateFilePath = $null

# ===============================================================
# STATE MANAGEMENT FUNCTIONS
# ===============================================================
function Get-AccountLinkingStateFilePath {
    if (-not $script:Config) {
        return $null
    }
    
    $stateDir = Join-Path $script:Config.rootDir "state"
    if (-not (Test-Path $stateDir)) {
        New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
    }
    
    return Join-Path $stateDir "account-linking.json"
}

function Save-AccountLinkingState {
    param(
        [string]$MessageId,
        [string]$ChannelId
    )
    
    try {
        $stateFile = Get-AccountLinkingStateFilePath
        if (-not $stateFile) {
            return $false
        }
        
        $state = @{
            MessageId = $MessageId
            ChannelId = $ChannelId
            LastUpdated = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        }
        
        $state | ConvertTo-Json | Set-Content $stateFile -Encoding UTF8
        Write-Log "Account linking state saved: MessageId=$MessageId" -Level "Debug"
        return $true
        
    } catch {
        Write-Log "Error saving account linking state: $($_.Exception.Message)" -Level "Warning"
        return $false
    }
}

function Get-AccountLinkingState {
    try {
        $stateFile = Get-AccountLinkingStateFilePath
        if (-not $stateFile -or -not (Test-Path $stateFile)) {
            return $null
        }
        
        $state = Get-Content $stateFile -Encoding UTF8 | ConvertFrom-Json
        Write-Log "Account linking state loaded: MessageId=$($state.MessageId)" -Level "Debug"
        return $state
        
    } catch {
        Write-Log "Error loading account linking state: $($_.Exception.Message)" -Level "Warning"
        return $null
    }
}

function Test-DiscordMessageExists {
    param(
        [string]$ChannelId,
        [string]$MessageId
    )
    
    try {
        $endpoint = "channels/$ChannelId/messages/$MessageId"
        $result = Invoke-DiscordAPI -Endpoint $endpoint -Method "GET" -Token $script:DiscordConfig.Token
        
        return $result -ne $null
        
    } catch {
        Write-Log "Message $MessageId does not exist in channel $ChannelId" -Level "Debug"
        return $false
    }
}
$script:AccountLinkingMessageId = $null

# State file for persistent storage
$script:StateFile = $null

# ===============================================================
# DATABASE HELPER FUNCTIONS
# ===============================================================
function Invoke-SQLiteQuery {
    param(
        [string]$Query,
        [array]$Parameters = @()
    )
    
    try {
        if (-not $script:Config) {
            throw "Database not initialized"
        }
        
        $serverDbPath = Join-Path $script:Config.dataDir "server_database.db"
        $sqlitePath = Join-Path $script:Config.rootDir "sqlite-tools\sqlite3.exe"
        
        if (-not (Test-Path $serverDbPath)) {
            throw "Server database not found: $serverDbPath"
        }
        
        if (-not (Test-Path $sqlitePath)) {
            throw "SQLite executable not found: $sqlitePath"
        }
        
        # Create temporary SQL file with query
        $tempSqlFile = [System.IO.Path]::GetTempFileName() + ".sql"
        
        # Handle parameters by replacing ? with actual values
        $processedQuery = $Query
        for ($i = 0; $i -lt $Parameters.Count; $i++) {
            $param = $Parameters[$i]
            if ($param -is [string]) {
                $param = "'$($param.Replace("'", "''"))'"  # Escape single quotes
            }
            $processedQuery = $processedQuery -replace '\?', $param, 1
        }
        
        Set-Content -Path $tempSqlFile -Value $processedQuery -Encoding UTF8
        
        try {
            # Execute query and capture output
            $result = & $sqlitePath $serverDbPath ".read $tempSqlFile" 2>&1
            
            if ($LASTEXITCODE -eq 0) {
                # Parse results if any
                if ($result -and $result.Count -gt 0) {
                    return $result
                } else {
                    return @()
                }
            } else {
                throw "SQLite error (exit code: $LASTEXITCODE): $result"
            }
            
        } finally {
            if (Test-Path $tempSqlFile) {
                Remove-Item $tempSqlFile -Force -ErrorAction SilentlyContinue
            }
        }
        
    } catch {
        Write-Log "SQLite query error: $($_.Exception.Message)" -Level "Warning"
        return $null
    }
}

function Test-DatabaseConnection {
    try {
        $result = Invoke-SQLiteQuery -Query "SELECT 1 as test"
        return $result -ne $null
    } catch {
        return $false
    }
}

# ===============================================================
# INITIALIZATION
# ===============================================================
function Initialize-AccountLinking {
    param(
        [hashtable]$Configuration,
        [hashtable]$DiscordConfiguration
    )
    
    try {
        $script:Config = $Configuration
        $script:DiscordConfig = $DiscordConfiguration
        
        # Check if account linking is enabled
        if (-not $script:DiscordConfig.AccountLinking.Enabled) {
            Write-Log "Account linking is disabled in configuration" -Level "Info"
            return $false
        }
        
        # Verify required configuration
        if (-not $script:DiscordConfig.AccountLinking.Channel) {
            Write-Log "AccountLinking Channel not configured" -Level "Warning"
            return $false
        }
        
        if (-not $script:DiscordConfig.Token) {
            Write-Log "Discord token not configured" -Level "Warning"
            return $false
        }
        
        # Verify database connection
        if (-not (Test-DatabaseConnection)) {
            Write-Log "Database connection failed" -Level "Warning"
            return $false
        }
        
        # Verify database tables exist
        if (-not (Test-DatabaseTables)) {
            Write-Log "Required database tables not found" -Level "Warning"
            return $false
        }
        
        $script:AccountLinkingActive = $true
        Write-Log "Account linking system initialized" -Level "Info"
        
        # Send initial embed to account linking channel
        Send-AccountLinkingEmbed
        
        return $true
        
    } catch {
        Write-Log "Error initializing account linking: $($_.Exception.Message)" -Level "Error"
        return $false
    }
}

# ===============================================================
# DATABASE OPERATIONS
# ===============================================================
function Test-DatabaseTables {
    try {
        # Check if required tables exist
        $tables = @(
            "a_discord_profiles",
            "a_pending_registrations"
        )
        
        foreach ($table in $tables) {
            $query = "SELECT name FROM sqlite_master WHERE type='table' AND name='$table'"
            $result = Invoke-SQLiteQuery -Query $query
            
            if (-not $result -or $result.Count -eq 0) {
                Write-Log "Required table '$table' not found in database" -Level "Warning"
                return $false
            }
        }
        
        return $true
        
    } catch {
        Write-Log "Error checking database tables: $($_.Exception.Message)" -Level "Warning"
        return $false
    }
}

function Generate-RegistrationCode {
    try {
        # Generate random 8-character code
        $chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        $code = ""
        for ($i = 0; $i -lt 8; $i++) {
            $code += $chars[(Get-Random -Minimum 0 -Maximum $chars.Length)]
        }
        
        # Ensure code is unique
        $query = "SELECT COUNT(*) as count FROM a_pending_registrations WHERE registration_code = ? AND used = 0"
        $result = Invoke-SQLiteQuery -Query $query -Parameters @($code)
        
        if ($result -and $result -match "^\d+$" -and [int]$result -gt 0) {
            # Code already exists, try again
            return Generate-RegistrationCode
        }
        
        return $code
        
    } catch {
        Write-Log "Error generating registration code: $($_.Exception.Message)" -Level "Warning"
        return $null
    }
}

function Create-PendingRegistration {
    param(
        [string]$DiscordUserId,
        [string]$RegistrationCode
    )
    
    try {
        # Check if user already has pending registration
        $existingQuery = "SELECT id FROM a_pending_registrations WHERE discord_user_id = ? AND used = 0"
        $existing = Invoke-SQLiteQuery -Query $existingQuery -Parameters @($DiscordUserId)
        
        if ($existing -and $existing.Count -gt 0) {
            # Update existing registration with new code
            $updateQuery = "UPDATE a_pending_registrations SET registration_code = ?, created_at = CURRENT_TIMESTAMP WHERE discord_user_id = ? AND used = 0"
            $result = Invoke-SQLiteQuery -Query $updateQuery -Parameters @($RegistrationCode, $DiscordUserId)
            
            if ($result -ne $null) {
                Write-Log "Updated pending registration for Discord user $DiscordUserId with new code $RegistrationCode" -Level "Info"
                return $true
            }
        } else {
            # Create new pending registration
            $insertQuery = "INSERT INTO a_pending_registrations (discord_user_id, registration_code, created_at, used) VALUES (?, ?, CURRENT_TIMESTAMP, 0)"
            $result = Invoke-SQLiteQuery -Query $insertQuery -Parameters @($DiscordUserId, $RegistrationCode)
            
            if ($result -ne $null) {
                Write-Log "Created pending registration for Discord user $DiscordUserId with code $RegistrationCode" -Level "Info"
                return $true
            }
        }
        
        return $false
        
    } catch {
        Write-Log "Error creating pending registration: $($_.Exception.Message)" -Level "Warning"
        return $false
    }
}

function Get-PendingRegistration {
    param([string]$RegistrationCode)
    
    try {
        $query = "SELECT * FROM a_pending_registrations WHERE registration_code = ? AND used = 0"
        $result = Invoke-DatabaseQuery -Query $query -Parameters @($RegistrationCode) -Database $script:Database
        
        if ($result -and $result.Count -gt 0) {
            return $result[0]
        }
        
        return $null
        
    } catch {
        Write-Log "Error getting pending registration: $($_.Exception.Message)" -Level "Warning"
        return $null
    }
}

function Complete-AccountLinking {
    param(
        [string]$RegistrationCode,
        [string]$SteamId,
        [string]$UserId,
        [string]$PlayerName
    )
    
    try {
        # Get pending registration
        $pending = Get-PendingRegistration -RegistrationCode $RegistrationCode
        if (-not $pending) {
            Write-Log "No pending registration found for code $RegistrationCode" -Level "Warning"
            return $false
        }
        
        # Check if account is already linked
        $existingQuery = "SELECT id FROM a_discord_profiles WHERE steam_id = ? OR user_id = ?"
        $existing = Invoke-DatabaseQuery -Query $existingQuery -Parameters @($SteamId, $UserId) -Database $script:Database
        
        if ($existing -and $existing.Count -gt 0) {
            Write-Log "Account already linked for SteamID $SteamId or UserID $UserId" -Level "Warning"
            return $false
        }
        
        # Create Discord profile
        $insertQuery = "INSERT INTO a_discord_profiles (discord_user_id, steam_id, user_id, player_name, linked_at, notifications_enabled) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 1)"
        $result = Invoke-DatabaseQuery -Query $insertQuery -Parameters @($pending.discord_user_id, $SteamId, $UserId, $PlayerName) -Database $script:Database
        
        if ($result) {
            # Mark registration as used
            $updateQuery = "UPDATE a_pending_registrations SET used = 1, used_at = CURRENT_TIMESTAMP WHERE registration_code = ?"
            Invoke-DatabaseQuery -Query $updateQuery -Parameters @($RegistrationCode) -Database $script:Database
            
            Write-Log "Account linked successfully: Discord=$($pending.discord_user_id), Steam=$SteamId, User=$UserId, Player=$PlayerName" -Level "Info"
            
            # Send success message to Discord user
            Send-AccountLinkingSuccess -DiscordUserId $pending.discord_user_id -PlayerName $PlayerName
            
            return $true
        }
        
        return $false
        
    } catch {
        Write-Log "Error completing account linking: $($_.Exception.Message)" -Level "Warning"
        return $false
    }
}

# ===============================================================
# DISCORD INTERACTION HANDLING
# ===============================================================
function Handle-AccountLinkingButton {
    param([hashtable]$InteractionData)
    
    try {
        $discordUserId = $InteractionData.member.user.id
        
        # Generate registration code
        $registrationCode = Generate-RegistrationCode
        if (-not $registrationCode) {
            Write-Log "Failed to generate registration code" -Level "Warning"
            return
        }
        
        # Create pending registration
        $success = Create-PendingRegistration -DiscordUserId $discordUserId -RegistrationCode $registrationCode
        if (-not $success) {
            Write-Log "Failed to create pending registration" -Level "Warning"
            return
        }
        
        # Send ephemeral response with registration code (visible only to the user)
        $responseEmbed = @{
            title = "Your Registration Code"
            description = @"
Your registration code is: **``$registrationCode``**

**Next steps:**
1. Join the SCUM server
2. Open the chat (Enter key)
3. Type exactly: ``connect:$registrationCode``
4. Press Enter to send

**Important:**
• The code is case-sensitive
• You have 24 hours to complete linking
• If you make a mistake, just click the button again

*This message is only visible to you.*
"@
            color = 16776960  # Yellow/Gold
            footer = @{
                text = "SCUM Server Automation • Registration Code"
            }
        }
        
        Send-DiscordInteractionResponse -InteractionId $InteractionData.id -InteractionToken $InteractionData.token -Embed $responseEmbed -Ephemeral $true
        
    } catch {
        Write-Log "Error handling account linking button: $($_.Exception.Message)" -Level "Warning"
    }
}

function Process-ConnectCommand {
    param(
        [string]$PlayerName,
        [string]$SteamId,
        [string]$UserId,
        [string]$RegistrationCode
    )
    
    try {
        Write-Log "Processing connect command: Player=$PlayerName, Steam=$SteamId, User=$UserId, Code=$RegistrationCode" -Level "Info"
        
        # Validate registration code format  
        if ($RegistrationCode.Length -ne 6 -or $RegistrationCode -notmatch "^[A-Z0-9]+$") {
            Write-Log "Invalid registration code format: $RegistrationCode" -Level "Warning"
            return @{ Success = $false; Message = "Invalid registration code format" }
        }

        # Get Discord integration module and communicate with Node.js bot
        if (Get-Command "Invoke-NodeJsApiRequest" -ErrorAction SilentlyContinue) {
            $requestBody = @{
                steamId = $SteamId
                playerName = $PlayerName
                userId = $UserId
                registrationCode = $RegistrationCode
            }

            $result = Invoke-NodeJsApiRequest -Endpoint "/account-linking/process-connect" -Method "POST" -Body $requestBody
            
            if ($result.Success -and $result.Data.success) {
                Write-Log "Account linking completed successfully via Node.js API" -Level "Info"
                return @{ Success = $true; Message = $result.Data.message }
            } else {
                Write-Log "Account linking failed via Node.js API: $($result.Data.message)" -Level "Warning"
                return @{ Success = $false; Message = $result.Data.message }
            }
        } else {
            Write-Log "Discord integration module not available" -Level "Error"
            return @{ Success = $false; Message = "Discord integration not available" }
        }
        
    } catch {
        Write-Log "Error processing connect command: $($_.Exception.Message)" -Level "Warning"
        return $false
    }
}

# ===============================================================
# DISCORD MESSAGE FUNCTIONS
# ===============================================================
function Send-AccountLinkingEmbed {
    try {
        if (-not $script:DiscordConfig.AccountLinking.Channel) {
            Write-Log "AccountLinking Channel not configured" -Level "Warning"
            return
        }
        
        # Initialize persistence system if not already done
        if (Get-Command "Initialize-EmbedPersistence" -ErrorAction SilentlyContinue) {
            Initialize-EmbedPersistence | Out-Null
        }
        
        # Check if embed already exists in persistence
        $storedEmbed = $null
        if (Get-Command "Get-EmbedMessageId" -ErrorAction SilentlyContinue) {
            $storedEmbed = Get-EmbedMessageId -EmbedType "account-linking" -ChannelId $script:DiscordConfig.AccountLinking.Channel
        }
        
        $shouldUpdate = $false
        if ($storedEmbed) {
            # Verify the message still exists in Discord
            $messageExists = $false
            if (Get-Command "Test-EmbedMessageExists" -ErrorAction SilentlyContinue) {
                $messageExists = Test-EmbedMessageExists -ChannelId $storedEmbed.ChannelId -MessageId $storedEmbed.MessageId
            }
            
            if ($messageExists) {
                $shouldUpdate = $true
                Write-Log "Updating existing account linking embed: MessageId=$($storedEmbed.MessageId)" -Level "Info"
            } else {
                Write-Log "Stored message no longer exists, creating new one" -Level "Warning"
                if (Get-Command "Remove-EmbedMessageId" -ErrorAction SilentlyContinue) {
                    Remove-EmbedMessageId -EmbedType "account-linking" -ChannelId $script:DiscordConfig.AccountLinking.Channel
                }
            }
        } else {
            Write-Log "No stored account linking embed found, creating new one" -Level "Info"
        }
        
        $embed = @{
            title = "Link Your Discord Account"
            description = @"
Connect your Discord account with your in-game SCUM character to receive personalized notifications and access exclusive features.

**Benefits:**
• Personal kill/death notifications
• Raid protection alerts
• Leaderboard tracking
• Exclusive Discord roles

**How to link:**
1. Click the **Connect Account** button below
2. You'll receive a registration code (visible only to you)
3. In the game chat, type: ``connect:YOUR_CODE``
4. Your accounts will be linked automatically!

*Your data is safe and only used for Discord integration.*
"@
            color = 35418  # Green (#00863A)
            image = @{
                url = $script:DiscordConfig.AccountLinking.Image
            }
            footer = @{
                text = "SCUM Server Automation • Account Linking"
                icon_url = "https://playhub.cz/scum/manager/server_automation_discord.png"
            }
            timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        }
        
        $components = @(
            @{
                type = 1  # Action Row
                components = @(
                    @{
                        type = 2  # Button
                        style = 3  # Success (green)
                        label = "Connect Account"
                        custom_id = "account_linking_connect"
                    }
                )
            }
        )
        
        if ($shouldUpdate) {
            # Update existing message
            $result = Update-DiscordMessage -ChannelId $storedEmbed.ChannelId -MessageId $storedEmbed.MessageId -Embeds @($embed) -Components $components
            
            if ($result -and $result.Success) {
                Write-Log "Account linking embed updated successfully in channel $($storedEmbed.ChannelId)" -Level "Info"
            } else {
                Write-Log "Failed to update account linking embed: $($result.Error)" -Level "Warning"
                $shouldUpdate = $false
            }
        }
        
        if (-not $shouldUpdate) {
            # Create new message
            $result = Send-DiscordMessage -ChannelId $script:DiscordConfig.AccountLinking.Channel -Embeds @($embed) -Components $components
            
            if ($result -and $result.Success) {
                Write-Log "Account linking embed sent successfully to channel $($script:DiscordConfig.AccountLinking.Channel)" -Level "Info"
                
                # Store the new message ID in persistence
                if (Get-Command "Set-EmbedMessageId" -ErrorAction SilentlyContinue) {
                    Set-EmbedMessageId -EmbedType "account-linking" -MessageId $result.MessageId -ChannelId $script:DiscordConfig.AccountLinking.Channel
                }
            } else {
                Write-Log "Failed to send account linking embed: $($result.Error)" -Level "Warning"
            }
        }
        
    } catch {
        Write-Log "Error sending account linking embed: $($_.Exception.Message)" -Level "Warning"
    }
}

function Send-RegistrationInstructions {
    param(
        [string]$DiscordUserId,
        [string]$RegistrationCode
    )
    
    try {
        $embed = @{
            title = "Account Linking Instructions"
            description = @"
Your registration code is: **``$RegistrationCode``**

**Next steps:**
1. Join the SCUM server
2. Open the chat (Enter key)
3. Type exactly: ``connect:$RegistrationCode``
4. Press Enter to send

**Important notes:**
• The code is case-sensitive
• You have 24 hours to complete linking
• If you make a mistake, just click the Connect Account button again

*Need help? Contact our support team.*
"@
            color = 16776960  # Yellow/Gold
            thumbnail = @{
                url = "https://playhub.cz/scum/manager/registration_code.png"
            }
            footer = @{
                text = "SCUM Server Automation • Registration Code"
                icon_url = "https://playhub.cz/scum/manager/server_automation_discord.png"
            }
            timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        }
        
        $result = Send-DirectMessage -Token $script:DiscordConfig.Token -UserId $DiscordUserId -Embed $embed
        
        if ($result -and $result.success) {
            Write-Log "Registration instructions sent to Discord user $DiscordUserId" -Level "Info"
        } else {
            Write-Log "Failed to send registration instructions to Discord user $DiscordUserId" -Level "Warning"
        }
        
    } catch {
        Write-Log "Error sending registration instructions: $($_.Exception.Message)" -Level "Warning"
    }
}

function Send-AccountLinkingSuccess {
    param(
        [string]$DiscordUserId,
        [string]$PlayerName
    )
    
    try {
        $embed = @{
            title = "Account Successfully Linked!"
            description = @"
Congratulations! Your Discord account has been successfully linked to your SCUM character: **$PlayerName**

**You now have access to:**
• Personal kill/death notifications
• Raid protection alerts
• Leaderboard tracking
• Exclusive Discord features

**Manage your settings:**
Use the ``/notify`` command to customize your notification preferences.

*Welcome to the enhanced SCUM experience!*
"@
            color = 65280  # Green
            thumbnail = @{
                url = "https://playhub.cz/scum/manager/account_linked_success.png"
            }
            footer = @{
                text = "SCUM Server Automation • Account Linked"
                icon_url = "https://playhub.cz/scum/manager/server_automation_discord.png"
            }
            timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        }
        
        $result = Send-DirectMessage -Token $script:DiscordConfig.Token -UserId $DiscordUserId -Embed $embed
        
        if ($result -and $result.success) {
            Write-Log "Account linking success message sent to Discord user $DiscordUserId" -Level "Info"
        } else {
            Write-Log "Failed to send success message to Discord user $DiscordUserId" -Level "Warning"
        }
        
    } catch {
        Write-Log "Error sending account linking success message: $($_.Exception.Message)" -Level "Warning"
    }
}

# ===============================================================
# UTILITY FUNCTIONS
# ===============================================================
function Get-AccountLinkingStatus {
    return @{
        Active = $script:AccountLinkingActive
        Enabled = $script:DiscordConfig.AccountLinking.Enabled
        Config = $script:Config
        DiscordConfig = $script:DiscordConfig
        Database = $null -ne $script:Database
        AccountLinkingChannel = $script:DiscordConfig.AccountLinking.Channel
    }
}

function Clean-ExpiredRegistrations {
    try {
        # Remove registrations older than 24 hours
        $query = "DELETE FROM a_pending_registrations WHERE created_at < datetime('now', '-24 hours')"
        $result = Invoke-DatabaseQuery -Query $query -Database $script:Database
        
        if ($result) {
            Write-Log "Cleaned up expired registration codes" -Level "Debug"
        }
        
    } catch {
        Write-Log "Error cleaning expired registrations: $($_.Exception.Message)" -Level "Warning"
    }
}

function Stop-AccountLinking {
    try {
        $script:AccountLinkingActive = $false
        Write-Log "Account linking system stopped" -Level "Info"
        
    } catch {
        Write-Log "Error stopping account linking: $($_.Exception.Message)" -Level "Warning"
    }
}

# ===============================================================
# EXPORTS
# ===============================================================
Export-ModuleMember -Function @(
    'Initialize-AccountLinking',
    'Handle-AccountLinkingButton',
    'Process-ConnectCommand',
    'Send-AccountLinkingEmbed',
    'Get-AccountLinkingStatus',
    'Clean-ExpiredRegistrations',
    'Stop-AccountLinking'
)
