# ===============================================================
# SCUM Server Automation - Discord Vehicle Log Manager
# ===============================================================
# Real-time vehicle log monitoring and Discord relay system
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
    Write-Host "[WARNING] Common module not available for vehicle-log module" -ForegroundColor Yellow
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
function Initialize-VehicleLogModule {
    param([hashtable]$Config)
    
    try {
        Write-Log "Initializing vehicle log management system..." -Level "Info"
        
        # Initialize configuration
        $script:DiscordConfig = $Config.Discord
        if (-not $script:DiscordConfig -or -not $script:DiscordConfig.Token) {
            Write-Log "Discord not configured, vehicle log relay disabled" -Level "Info"
            return $false
        }
        
        # Look for VehicleFeed in Features section
        if ($Config.SCUMLogFeatures -and $Config.SCUMLogFeatures.VehicleFeed) {
            $script:Config = $Config.SCUMLogFeatures.VehicleFeed
        }
        else {
            Write-Log "Vehicle log relay not enabled in configuration" -Level "Info"
            return $false
        }
        
        if (-not $script:Config.Enabled) {
            Write-Log "Vehicle log relay not enabled in configuration" -Level "Info"
            return $false
        }
        
        # Initialize vehicle log directory
        $serverDir = $Config.serverDir
        if (-not $serverDir) {
            Write-Log "Server directory not configured" -Level "Info"
            return $false
        }
        
        $script:LogDirectory = Join-Path $serverDir "SCUM\Saved\SaveFiles\Logs"
        Write-Log "Vehicle log directory: $script:LogDirectory" -Level "Info"
        
        if (-not (Test-Path $script:LogDirectory)) {
            Write-Log "Vehicle log directory not found: $script:LogDirectory" -Level "Info"
            return $false
        }
        
        # Initialize state persistence
        $stateDir = ".\state"
        if (-not (Test-Path $stateDir)) {
            New-Item -Path $stateDir -ItemType Directory -Force | Out-Null
        }
        $script:StateFile = Join-Path $stateDir "vehicle-log-manager.json"
        
        # Load previous state
        Load-VehicleState
        
        # Mark as active
        $script:IsMonitoring = $true
        $script:IsRelayActive = $true
        
        return $true
    } catch {
        Write-Log "Failed to initialize vehicle log manager: $($_.Exception.Message)" -Level "Info"
        return $false
    }
}

# ===============================================================
# VEHICLE LOG MONITORING
# ===============================================================
function Update-VehicleLogProcessing {
    if (-not $script:IsMonitoring -or -not $script:IsRelayActive) {
        return
    }
    
    try {
        $newEvents = Get-NewVehicleEvents
        
        if (-not $newEvents -or $newEvents.Count -eq 0) {
            return
        }
        
        foreach ($vehicleEvent in $newEvents) {
            # Clean format: VEHICLE [EventType] Vehicle: Action
            Write-Log "VEHICLE [$($vehicleEvent.EventType)] $($vehicleEvent.VehicleName): $($vehicleEvent.Action)" -Level "Info"
            Send-VehicleEventToDiscord -Event $vehicleEvent
        }
        
        # Save state after processing
        Save-VehicleState
        
    } catch {
        Write-Log "Error during vehicle log update: $($_.Exception.Message)" -Level "Info"
    }
}

function Get-NewVehicleEvents {
    # Get the latest vehicle log file
    $latestLogFile = Get-LatestVehicleLogFile
    if (-not $latestLogFile) {
        return @()
    }
    
    # Check if we're monitoring a different file now
    if ($script:CurrentLogFile -ne $latestLogFile) {
        Write-Log "Switched to new vehicle log file" -Level "Debug"
        $script:CurrentLogFile = $latestLogFile
        $script:LastLineNumber = 0  # Reset line counter for new file
    }
    
    if (-not (Test-Path $script:CurrentLogFile)) {
        Write-Log "Vehicle log file not found: $script:CurrentLogFile" -Level "Info"
        return @()
    }
    
    try {
        # Read all lines from the log file - SCUM vehicle logs use UTF-16 LE encoding
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
        
        # Parse vehicle events from new lines
        $newEvents = @()
        foreach ($line in $newLines) {
            if (-not [string]::IsNullOrWhiteSpace($line) -and $line -notmatch "Game version:") {
                $parsedEvent = ConvertFrom-VehicleLine -LogLine $line
                if ($parsedEvent) {
                    # All vehicle events are enabled by default when VehicleFeed is enabled
                    $newEvents += $parsedEvent
                }
            }
        }
        
        return $newEvents
        
    } catch {
        Write-Log "Error reading vehicle log: $($_.Exception.Message)" -Level "Info"
        return @()
    }
}

function Get-LatestVehicleLogFile {
    try {
        # Get all vehicle destruction log files
        $LogFiles = Get-ChildItem -Path $script:LogDirectory -Filter "vehicle_destruction_*.log" -ErrorAction SilentlyContinue
        
        if (-not $LogFiles -or $LogFiles.Count -eq 0) {
            Write-Log "No vehicle log files found in $script:LogDirectory" -Level "Info"
            return $null
        }
        
        # Sort by creation time and get the latest
        $latestFile = $LogFiles | Sort-Object CreationTime -Descending | Select-Object -First 1
        return $latestFile.FullName
        
    } catch {
        Write-Log "Error finding latest vehicle log: $($_.Exception.Message)" -Level "Info"
        return $null
    }
}

# ===============================================================
# STATE PERSISTENCE
# ===============================================================
function Save-VehicleState {
    try {
        $state = @{
            CurrentLogFile = $script:CurrentLogFile
            LastLineNumber = $script:LastLineNumber
            LastUpdate = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        }
        
        $stateJson = $state | ConvertTo-Json
        Set-Content -Path $script:StateFile -Value $stateJson -Encoding UTF8
        
    } catch {
        Write-Log "Failed to save vehicle log state: $($_.Exception.Message)" -Level "Info"
    }
}

function Load-VehicleState {
    try {
        if (Test-Path $script:StateFile) {
            $stateJson = Get-Content -Path $script:StateFile -Raw -Encoding UTF8
            $state = $stateJson | ConvertFrom-Json
            
            $script:CurrentLogFile = if ($state.CurrentLogFile) { $state.CurrentLogFile } else { $null }
            $script:LastLineNumber = if ($state.LastLineNumber) { $state.LastLineNumber } else { 0 }
            
            # Verify the saved log file still exists, if not reset
            if ($script:CurrentLogFile -and -not (Test-Path $script:CurrentLogFile)) {
                Write-Log "Previous vehicle log file no longer exists, resetting state" -Level "Info"
                $script:CurrentLogFile = $null
                $script:LastLineNumber = 0
            } else {
                Write-Log "Loaded vehicle log state: File=$($script:CurrentLogFile), Line=$($script:LastLineNumber)" -Level "Info"
            }
        } else {
            Write-Log "No previous vehicle log state found, starting from current log end" -Level "Info"
            # Initialize to current log file and skip to end to avoid spam
            $latestLogFile = Get-LatestVehicleLogFile
            if ($latestLogFile -and (Test-Path $latestLogFile)) {
                $script:CurrentLogFile = $latestLogFile
                # Read current file and set position to end
                try {
                    $allLines = Get-Content $script:CurrentLogFile -Encoding Unicode -ErrorAction SilentlyContinue
                    $script:LastLineNumber = if ($allLines) { $allLines.Count } else { 0 }
                    Write-Log "Initialized vehicle log state: File=$($script:CurrentLogFile), Starting from line $($script:LastLineNumber)" -Level "Info"
                } catch {
                    $script:LastLineNumber = 0
                }
            } else {
                $script:CurrentLogFile = $null
                $script:LastLineNumber = 0
            }
        }
    } catch {
        Write-Log "Failed to load vehicle log state, starting fresh: $($_.Exception.Message)" -Level "Info"
        $script:CurrentLogFile = $null
        $script:LastLineNumber = 0
    }
}

# ===============================================================
# VEHICLE LOG PARSING
# ===============================================================
function ConvertFrom-VehicleLine {
    param([string]$LogLine)
    
    try {
        # Vehicle destruction log formats - need to handle multiple owner formats:
        # Normal: Owner: 76561198079911047 (1730, Spidees)  
        # N/A: Owner: N/A
        # NULL: Owner: NULL, (2535, NULL)
        
        # First extract basic components
        if ($LogLine -match '^(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\s+\[([^\]]+)\]\s+([^.]+)\.\s+VehicleId:\s+(\d+)\.\s+Owner:\s+(.+?)\.\s+Location:\s+X=([^\s]+)\s+Y=([^\s]+)\s+Z=([^\s]+)') {
            $dateStr = $matches[1]
            $eventType = $matches[2]
            $vehicleName = $matches[3].Trim()
            $vehicleId = $matches[4]
            $ownerPart = $matches[5].Trim()
            $locationX = $matches[6]
            $locationY = $matches[7]
            $locationZ = $matches[8]
            
            # Parse timestamp
            try {
                $timestamp = [DateTime]::ParseExact($dateStr, "yyyy.MM.dd-HH.mm.ss", $null)
            } catch {
                $timestamp = Get-Date
                Write-Log "Could not parse timestamp from: $LogLine, using current time" -Level "Debug"
            }
            
            # Clean vehicle name
            $cleanVehicleName = $vehicleName -replace "_ES$", "" -replace "_", " "
            
            # Parse owner information - handle different formats
            $steamId = $null
            $playerId = $null 
            $playerName = $null
            
            if ($ownerPart -eq "N/A") {
                $playerName = "No Owner"
            } elseif ($ownerPart -match '^NULL,\s*\((\d+),\s*NULL\)') {
                $playerId = $matches[1]
                $playerName = "Unknown Player"
            } elseif ($ownerPart -match '^(\d+)\s+\((\d+),\s*([^)]+)\)') {
                $steamId = $matches[1]
                $playerId = $matches[2]
                $playerName = $matches[3].Trim()
            } else {
                Write-Log "Could not parse owner format: $ownerPart" -Level "Debug"
                $playerName = "Unknown Owner"
            }
            
            # Determine action based on event type with better descriptions
            $action = switch ($eventType) {
                "Destroyed" { "was destroyed" }
                "Disappeared" { "disappeared" }
                "VehicleInactiveTimerReached" { "expired (inactive)" }
                "ForbiddenZoneTimerExpired" { "expired (forbidden zone)" }
                default { "had event: $eventType" }
            }
            
            return @{
                Timestamp = $timestamp
                EventType = $eventType
                VehicleName = $cleanVehicleName
                VehicleId = $vehicleId
                OwnerSteamId = $steamId
                OwnerPlayerId = $playerId
                OwnerName = $playerName
                LocationX = $locationX
                LocationY = $locationY
                LocationZ = $locationZ
                Action = $action
                RawLine = $LogLine
            }
        }
        
        return $null
        
    } catch {
        Write-Log "Error parsing vehicle line: $($_.Exception.Message)" -Level "Error"
        return $null
    }
}

# ===============================================================
# DISCORD INTEGRATION
# ===============================================================
function Send-VehicleEventToDiscord {
    param($Event)
    
    try {
        # Validate event data
        if (-not $Event -or -not $Event.Action) {
            Write-Log "Invalid vehicle event data, skipping Discord notification" -Level "Debug"
            return
        }
        
        # Try to use embed format
        if (Get-Command "Send-VehicleEmbed" -ErrorAction SilentlyContinue) {
            try {
                Write-Log "Creating vehicle embed for $($Event.VehicleName)" -Level "Debug"
                $embedData = Send-VehicleEmbed -VehicleAction $Event
                Write-Log "Vehicle embed data created successfully" -Level "Debug"
                
                if (Get-Command "Send-DiscordMessage" -ErrorAction SilentlyContinue) {
                    Write-Log "Sending vehicle embed to Discord..." -Level "Debug"
                    $result = Send-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:Config.Channel -Embed $embedData
                    if ($result -and $result.success) {
                        Write-Log "Vehicle event embed sent successfully" -Level "Info"
                        return
                    } else {
                        Write-Log "Vehicle event embed failed to send: $($result | ConvertTo-Json)" -Level "Warning"
                    }
                } else {
                    Write-Log "Send-DiscordMessage command not found" -Level "Warning"
                }
            } catch {
                Write-Log "Error creating vehicle embed: $($_.Exception.Message)" -Level "Warning"
            }
        } else {
            Write-Log "Send-VehicleEmbed function not found" -Level "Warning"
        }
        
    } catch {
        Write-Log "Error in Send-VehicleEventToDiscord: $($_.Exception.Message)" -Level "Error"
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
    'Initialize-VehicleLogModule',
    'ConvertFrom-VehicleLine',
    'Update-VehicleLogProcessing',
    'Get-NewVehicleEvents',
    'Get-LatestVehicleLogFile',
    'Send-VehicleEventToDiscord',
    'Apply-MessageFilter',
    'Save-VehicleState',
    'Load-VehicleState'
)


