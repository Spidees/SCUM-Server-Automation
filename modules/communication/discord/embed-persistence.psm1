# ===============================================================
# DISCORD EMBED PERSISTENCE SYSTEM
# ===============================================================
# Manages persistent storage of Discord message IDs for embeds
# Ensures embeds are updated rather than recreated after restart
# ===============================================================

# Standard import of common module
try {
    $helperPath = Join-Path $PSScriptRoot "..\..\core\module-helper.psm1"
    if (Test-Path $helperPath) {
        if (-not (Get-Module "module-helper" -ErrorAction SilentlyContinue)) {
            Import-Module $helperPath -ErrorAction SilentlyContinue
        }
        Import-CommonModule | Out-Null
    }
} catch {
    Write-Warning "[WARNING] Common module not available for embed-persistence module"
}

# Module variables
$script:PersistenceFile = $null
$script:EmbedState = @{}

# ===============================================================
# INITIALIZATION
# ===============================================================

function Initialize-EmbedPersistence {
    <#
    .SYNOPSIS
    Initialize embed persistence system
    #>
    param(
        [Parameter(Mandatory=$false)]
        [string]$StateFilePath = ".\state\discord-embeds.json"
    )
    
    try {
        $script:PersistenceFile = $StateFilePath
        
        # Ensure state directory exists
        $stateDir = Split-Path $StateFilePath -Parent
        if (-not (Test-Path $stateDir)) {
            New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
            Write-Log "[EmbedPersistence] Created state directory: $stateDir" -Level Debug
        }
        
        # Load existing state
        if (Test-Path $script:PersistenceFile) {
            $stateContent = Get-Content -Path $script:PersistenceFile -Raw | ConvertFrom-Json
            $script:EmbedState = @{}
            $stateContent.psobject.properties | ForEach-Object {
                $script:EmbedState[$_.Name] = $_.Value
            }
            Write-Log "[EmbedPersistence] Loaded embed state: $($script:EmbedState.Keys -join ', ')" -Level Debug
        } else {
            $script:EmbedState = @{}
            Write-Log "[EmbedPersistence] No existing state found, starting fresh" -Level Debug
        }
        
        Write-Log "[EmbedPersistence] Persistence system initialized" -Level Debug
        return $true
        
    } catch {
        Write-Log "[EmbedPersistence] Failed to initialize: $($_.Exception.Message)" -Level Error
        return $false
    }
}

# ===============================================================
# STATE MANAGEMENT
# ===============================================================

function Get-EmbedMessageId {
    <#
    .SYNOPSIS
    Get stored message ID for an embed type
    #>
    param(
        [Parameter(Mandatory=$true)]
        [ValidateSet("server-status", "account-linking", "leaderboards-weekly", "leaderboards-alltime")]
        [string]$EmbedType,
        
        [Parameter(Mandatory=$false)]
        [string]$ChannelId = $null
    )
    
    $key = if ($ChannelId) { "$EmbedType-$ChannelId" } else { $EmbedType }
    
    if ($script:EmbedState.ContainsKey($key)) {
        $embedInfo = $script:EmbedState[$key]
        Write-Log "[EmbedPersistence] Found stored message ID for $key`: $($embedInfo.MessageId)" -Level Debug
        return @{
            MessageId = $embedInfo.MessageId
            ChannelId = $embedInfo.ChannelId
            LastUpdated = $embedInfo.LastUpdated
            EmbedType = $EmbedType
        }
    }
    
    Write-Log "[EmbedPersistence] No stored message ID for $key" -Level Debug
    return $null
}

function Set-EmbedMessageId {
    <#
    .SYNOPSIS
    Store message ID for an embed type
    #>
    param(
        [Parameter(Mandatory=$true)]
        [ValidateSet("server-status", "account-linking", "leaderboards-weekly", "leaderboards-alltime")]
        [string]$EmbedType,
        
        [Parameter(Mandatory=$true)]
        [string]$MessageId,
        
        [Parameter(Mandatory=$true)]
        [string]$ChannelId
    )
    
    $key = "$EmbedType-$ChannelId"
    
    $script:EmbedState[$key] = @{
        MessageId = $MessageId
        ChannelId = $ChannelId
        LastUpdated = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        EmbedType = $EmbedType
    }
    
    Save-EmbedState
    Write-Log "[EmbedPersistence] Stored message ID for $key`: $MessageId" -Level Debug
}

function Remove-EmbedMessageId {
    <#
    .SYNOPSIS
    Remove stored message ID for an embed type
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$EmbedType,
        
        [Parameter(Mandatory=$false)]
        [string]$ChannelId = $null
    )
    
    $key = if ($ChannelId) { "$EmbedType-$ChannelId" } else { $EmbedType }
    
    if ($script:EmbedState.ContainsKey($key)) {
        $script:EmbedState.Remove($key)
        Save-EmbedState
        Write-Log "[EmbedPersistence] Removed stored message ID for $key" -Level Debug
    }
}

function Get-AllEmbedStates {
    <#
    .SYNOPSIS
    Get all stored embed states
    #>
    return $script:EmbedState.Clone()
}

function Clear-EmbedState {
    <#
    .SYNOPSIS
    Clear all stored embed states
    #>
    $script:EmbedState = @{}
    Save-EmbedState
    Write-Log "[EmbedPersistence] Cleared all embed states" -Level Debug
}

# ===============================================================
# PERSISTENCE
# ===============================================================

function Save-EmbedState {
    <#
    .SYNOPSIS
    Save current embed state to file
    #>
    try {
        if (-not $script:PersistenceFile) {
            Write-Log "[EmbedPersistence] Persistence not initialized" -Level Warning
            return
        }
        
        $stateJson = $script:EmbedState | ConvertTo-Json -Depth 10 -Compress
        Set-Content -Path $script:PersistenceFile -Value $stateJson -Encoding UTF8
        
        Write-Log "[EmbedPersistence] State saved to: $script:PersistenceFile" -Level Debug
        
    } catch {
        Write-Log "[EmbedPersistence] Failed to save state: $($_.Exception.Message)" -Level Error
    }
}

function Test-EmbedMessageExists {
    <#
    .SYNOPSIS
    Test if a stored message ID still exists in Discord
    #>
    param(
        [Parameter(Mandatory=$true)]
        [string]$ChannelId,
        
        [Parameter(Mandatory=$true)]
        [string]$MessageId
    )
    
    try {
        # Use Node.js Discord API to check if message exists
        if (Get-Command "Invoke-NodeJsApiRequest" -ErrorAction SilentlyContinue) {
            $body = @{
                channelId = $ChannelId
                messageId = $MessageId
                limit = 1
            }
            
            $response = Invoke-NodeJsApiRequest -Endpoint "/api/search-messages" -Method "POST" -Body $body
            
            if ($response.Success -and $response.Data.success -and $response.Data.messages -and $response.Data.messages.Count -gt 0) {
                Write-Log "[EmbedPersistence] Message $MessageId exists in channel $ChannelId" -Level Debug
                return $true
            }
        }
        
        Write-Log "[EmbedPersistence] Message $MessageId not found in channel $ChannelId" -Level Debug
        return $false
        
    } catch {
        Write-Log "[EmbedPersistence] Failed to check message existence: $($_.Exception.Message)" -Level Warning
        return $false
    }
}

# ===============================================================
# EXPORTS
# ===============================================================

Export-ModuleMember -Function @(
    'Initialize-EmbedPersistence',
    'Get-EmbedMessageId',
    'Set-EmbedMessageId', 
    'Remove-EmbedMessageId',
    'Get-AllEmbedStates',
    'Clear-EmbedState',
    'Test-EmbedMessageExists'
)
