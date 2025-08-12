# ===============================================================
# SCUM Server Automation - Discord Quest Log Manager
# ===============================================================
# Real-time quest log monitoring and Discord relay system
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
    Write-Host "[WARNING] Common module not available for quest-log module" -ForegroundColor Yellow
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
function Initialize-QuestLogModule {
    param([hashtable]$Config)
    
    try {
        Write-Log "Initializing quest log management system..." -Level "Info"
        
        # Initialize configuration
        $script:DiscordConfig = $Config.Discord
        if (-not $script:DiscordConfig -or -not $script:DiscordConfig.Token) {
            Write-Log "Discord not configured, quest log relay disabled" -Level "Info"
            return $false
        }
        
        # Look for QuestFeed in Features section
        if ($Config.SCUMLogFeatures -and $Config.SCUMLogFeatures.QuestFeed) {
            $script:Config = $Config.SCUMLogFeatures.QuestFeed
        }
        else {
            Write-Log "Quest log relay not enabled in configuration" -Level "Info"
            return $false
        }
        
        if (-not $script:Config.Enabled) {
            Write-Log "Quest log relay not enabled in configuration" -Level "Info"
            return $false
        }
        
        # Initialize quest log directory
        $serverDir = $Config.serverDir
        if (-not $serverDir) {
            Write-Log "Server directory not configured" -Level "Info"
            return $false
        }
        
        $script:LogDirectory = Join-Path $serverDir "SCUM\Saved\SaveFiles\Logs"
        Write-Log "Quest log directory: $script:LogDirectory" -Level "Info"
        
        if (-not (Test-Path $script:LogDirectory)) {
            Write-Log "Quest log directory not found: $script:LogDirectory" -Level "Info"
            return $false
        }
        
        # Initialize state persistence
        $stateDir = ".\state"
        if (-not (Test-Path $stateDir)) {
            New-Item -Path $stateDir -ItemType Directory -Force | Out-Null
        }
        $script:StateFile = Join-Path $stateDir "quest-log-manager.json"
        
        # Load previous state
        Load-QuestState
        
        # Mark as active
        $script:IsMonitoring = $true
        $script:IsRelayActive = $true
        
        return $true
    } catch {
        Write-Log "Failed to initialize quest log manager: $($_.Exception.Message)" -Level "Info"
        return $false
    }
}

# ===============================================================
# QUEST LOG MONITORING
# ===============================================================
function Update-QuestLogProcessing {
    if (-not $script:IsMonitoring -or -not $script:IsRelayActive) {
        return
    }
    
    try {
        $newQuests = Get-NewQuestEvents
        
        if (-not $newQuests -or $newQuests.Count -eq 0) {
            return
        }
        
        foreach ($quest in $newQuests) {
            # Clean format: QUEST [Action] Player: Quest (Category - Tier)
            Write-Log "QUEST [$($quest.Action.ToUpper())] $($quest.Player): $($quest.DisplayQuestName) ($($quest.Category) - $($quest.Tier))" -Level "Info"
            Send-QuestEventToDiscord -Event $quest
        }
        
        # Save state after processing
        Save-QuestState
        
    } catch {
        Write-Log "Error during quest log update: $($_.Exception.Message)" -Level "Info"
    }
}

function Get-NewQuestEvents {
    # Get the latest quest log file
    $latestLogFile = Get-LatestQuestLogFile
    if (-not $latestLogFile) {
        return @()
    }
    
    # Check if we're monitoring a different file now
    if ($script:CurrentLogFile -ne $latestLogFile) {
        Write-Log "Switched to new quest log file" -Level "Debug"
        $script:CurrentLogFile = $latestLogFile
        $script:LastLineNumber = 0  # Reset line counter for new file
    }
    
    if (-not (Test-Path $script:CurrentLogFile)) {
        Write-Log "Quest log file not found: $script:CurrentLogFile" -Level "Info"
        return @()
    }
    
    try {
        # Read all lines from the log file - SCUM quest logs use UTF-16 LE encoding
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
        
        # Parse quest events from new lines
        $newQuests = @()
        foreach ($line in $newLines) {
            if (-not [string]::IsNullOrWhiteSpace($line) -and $line -notmatch "Game version:") {
                $parsedQuest = ConvertFrom-QuestLine -LogLine $line
                if ($parsedQuest) {
                    # All quest events are enabled by default when QuestFeed is enabled
                    $newQuests += $parsedQuest
                }
            }
        }
        
        return $newQuests
        
    } catch {
        Write-Log "Error reading quest log: $($_.Exception.Message)" -Level "Info"
        return @()
    }
}

function Get-LatestQuestLogFile {
    try {
        # Get all quest log files
        $LogFiles = Get-ChildItem -Path $script:LogDirectory -Filter "quests_*.log" -ErrorAction SilentlyContinue
        
        if (-not $LogFiles -or $LogFiles.Count -eq 0) {
            Write-Log "No quest log files found in $script:LogDirectory" -Level "Info"
            return $null
        }
        
        # Sort by creation time and get the latest
        $latestFile = $LogFiles | Sort-Object CreationTime -Descending | Select-Object -First 1
        return $latestFile.FullName
        
    } catch {
        Write-Log "Error finding latest quest log: $($_.Exception.Message)" -Level "Info"
        return $null
    }
}

# ===============================================================
# STATE PERSISTENCE
# ===============================================================
function Save-QuestState {
    try {
        $state = @{
            CurrentLogFile = $script:CurrentLogFile
            LastLineNumber = $script:LastLineNumber
            LastUpdate = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        }
        
        $stateJson = $state | ConvertTo-Json
        Set-Content -Path $script:StateFile -Value $stateJson -Encoding UTF8
        
    } catch {
        Write-Log "Failed to save quest log state: $($_.Exception.Message)" -Level "Info"
    }
}

function Load-QuestState {
    try {
        if (Test-Path $script:StateFile) {
            $stateJson = Get-Content -Path $script:StateFile -Raw -Encoding UTF8
            $state = $stateJson | ConvertFrom-Json
            
            $script:CurrentLogFile = if ($state.CurrentLogFile) { $state.CurrentLogFile } else { $null }
            $script:LastLineNumber = if ($state.LastLineNumber) { $state.LastLineNumber } else { 0 }
            
            # Verify the saved log file still exists, if not reset
            if ($script:CurrentLogFile -and -not (Test-Path $script:CurrentLogFile)) {
                Write-Log "Previous quest log file no longer exists, resetting state" -Level "Info"
                $script:CurrentLogFile = $null
                $script:LastLineNumber = 0
            } else {
                Write-Log "Loaded quest log state: File=$($script:CurrentLogFile), Line=$($script:LastLineNumber)" -Level "Info"
            }
        } else {
            Write-Log "No previous quest log state found, starting from current log end" -Level "Info"
            # Initialize to current log file and skip to end to avoid spam
            $latestLogFile = Get-LatestQuestLogFile
            if ($latestLogFile -and (Test-Path $latestLogFile)) {
                $script:CurrentLogFile = $latestLogFile
                # Read current file and set position to end
                try {
                    $allLines = Get-Content $script:CurrentLogFile -Encoding Unicode -ErrorAction SilentlyContinue
                    $script:LastLineNumber = if ($allLines) { $allLines.Count } else { 0 }
                    Write-Log "Initialized quest log state: File=$($script:CurrentLogFile), Starting from line $($script:LastLineNumber)" -Level "Info"
                } catch {
                    $script:LastLineNumber = 0
                }
            } else {
                $script:CurrentLogFile = $null
                $script:LastLineNumber = 0
            }
        }
    } catch {
        Write-Log "Failed to load quest log state, starting fresh: $($_.Exception.Message)" -Level "Info"
        $script:CurrentLogFile = $null
        $script:LastLineNumber = 0
    }
}

# ===============================================================
# QUEST LOG PARSING
# ===============================================================
function ConvertFrom-QuestLine {
    param([string]$LogLine)
    
    # Quest log patterns:
    # 2025.07.17-21.54.36: [LogQuestStatus] Le Raleur (2563, 76561197996638197) abandoned quest T1_GG_Fetch_ChocolateCandy
    # 2025.07.18-10.51.01: [LogQuestStatus] Le retour du Jaguar (1982, 76561197988910902) completed quest T2_DC_Fetch_HemostaticDressing
    # 2025.07.17-20.22.06: [LogQuestStatus] lioO (1153, 76561197965232009) completed quest Quest_GeneralGoods_Tier0_FindAPhone
    
    if ($LogLine -match "^([\d.-]+):\s+\[LogQuestStatus\]\s+(.+?)\s+\((\d+),\s+(\d+)\)\s+(completed|abandoned)\s+quest\s+(.+)$") {
        $date = $matches[1]
        $playerName = $matches[2].Trim()
        $playerId = $matches[3]
        $steamId = $matches[4]
        $action = $matches[5]
        $questName = $matches[6].Trim()
        
        try {
            # Parse date: 2025.07.17-21.54.36 -> 2025/07/17 21:54:36
            $datePart = $date -replace '\.', '/' -replace '-', ' '
            $timestamp = [datetime]::ParseExact($datePart, "yyyy/MM/dd HH.mm.ss", $null)
        } catch {
            $timestamp = Get-Date
        }
        
        # Determine quest category and tier
        $category = "Unknown"
        $tier = "Unknown"
        $questType = "Unknown"
        $displayQuestName = $questName
        
        # Parse quest name for category and tier
        if ($questName -match "^T(\d)_([A-Z]{2})_([A-Za-z]+)_(.+)") {
            $tierNum = $matches[1]
            $categoryCode = $matches[2]
            $questTypeRaw = $matches[3]
            $questItem = $matches[4]
            
            $tier = "Tier $tierNum"
            
            # Map category codes
            switch ($categoryCode) {
                "GG" { $category = "Goods Trader" }
                "AR" { $category = "Armorer" }
                "DC" { $category = "Doctor" }
                "MC" { $category = "Mechanic" }
                default { $category = $categoryCode }
            }
            
            # Map quest types
            switch ($questTypeRaw) {
                "Fetch" { $questType = "Fetch" }
                "Kill" { $questType = "Combat" }
                "Interact" { $questType = "Interaction" }
                default { $questType = $questTypeRaw }
            }
            
            # Create display name from quest item - handle common patterns
            $displayQuestName = $questItem
            
            # Handle common quest item patterns
            switch -Regex ($questItem) {
                "ChocolateCandy" { $displayQuestName = "Chocolate Candy" }
                "HemostaticDressing" { $displayQuestName = "Hemostatic Dressing" }
                "SabotageACs" { $displayQuestName = "Sabotage ACs" }
                "FindAPhone" { $displayQuestName = "Find A Phone" }
                "MultiplePuppetParts" { $displayQuestName = "Multiple Puppet Parts" }
                "DirtbikeHeadlights" { $displayQuestName = "Dirtbike Headlights" }
                "DirtbikeFrontShield" { $displayQuestName = "Dirtbike Front Shield" }
                "DirtbikeHellriderSkull" { $displayQuestName = "Dirtbike Hellrider Skull" }
                "DirtbikeBody" { $displayQuestName = "Dirtbike Body" }
                "DirtbikeWheels" { $displayQuestName = "Dirtbike Wheels" }
                "MotorbikeBattery" { $displayQuestName = "Motorbike Battery" }
                "CarBattery" { $displayQuestName = "Car Battery" }
                "CarBatteryCables" { $displayQuestName = "Car Battery Cables" }
                "CarRepairKit" { $displayQuestName = "Car Repair Kit" }
                "CarJack" { $displayQuestName = "Car Jack" }
                "AeroplaneRepairKit" { $displayQuestName = "Aeroplane Repair Kit" }
                "BrakeOil" { $displayQuestName = "Brake Oil" }
                "MetalScraps" { $displayQuestName = "Metal Scraps" }
                "OilFilter" { $displayQuestName = "Oil Filter" }
                "WrenchPipe" { $displayQuestName = "Wrench Pipe" }
                "SmallToolbox" { $displayQuestName = "Small Toolbox" }
                "GrindingStone" { $displayQuestName = "Grinding Stone" }
                "DuctTape" { $displayQuestName = "Duct Tape" }
                "BobbyPins" { $displayQuestName = "Bobby Pins" }
                "SexyShorts" { $displayQuestName = "Sexy Shorts" }
                "SewingKit" { $displayQuestName = "Sewing Kit" }
                "PaintCans" { $displayQuestName = "Paint Cans" }
                "RebarCutter" { $displayQuestName = "Rebar Cutter" }
                "RedGhoul" { $displayQuestName = "Red Ghoul" }
                "PortableElectricStove" { $displayQuestName = "Portable Electric Stove" }
                "TelephoneBooths" { $displayQuestName = "Telephone Booths" }
                "AnalyzeFiles" { $displayQuestName = "Analyze Files" }
                "PoliceStationData" { $displayQuestName = "Police Station Data" }
                "CheckGraves" { $displayQuestName = "Check Graves" }
                "Puppets" { $displayQuestName = "Kill Puppets" }
                "PuppetsSharp" { $displayQuestName = "Kill Puppets (Sharp)" }
                "PuppetsBlunt" { $displayQuestName = "Kill Puppets (Blunt)" }
                default {
                    # Fallback: replace underscores and try basic CamelCase
                    $displayQuestName = $displayQuestName -replace "_", " "
                    $displayQuestName = $displayQuestName -replace "([a-z])([A-Z])", '$1 $2'
                    $displayQuestName = ($displayQuestName -replace "\s+", " ").Trim()
                }
            }
            
        } elseif ($questName -match "^Quest_GeneralGoods_Tier0_(.+)") {
            $category = "Tutorial"
            $tier = "Tutorial"
            $questType = "Tutorial"
            $questItem = $matches[1]
            $displayQuestName = $questItem
            
            # Handle common quest item patterns
            switch -Regex ($questItem) {
                "FindAPhone" { $displayQuestName = "Find A Phone" }
                default {
                    # Fallback: replace underscores and try basic CamelCase
                    $displayQuestName = $displayQuestName -replace "_", " "
                    $displayQuestName = $displayQuestName -replace "([a-z])([A-Z])", '$1 $2'
                    $displayQuestName = ($displayQuestName -replace "\s+", " ").Trim()
                }
            }
        }
        
        # Determine event type
        $eventType = if ($action -eq "completed") { "QuestCompleted" } else { "QuestAbandoned" }
        
        return @{
            Timestamp = $timestamp
            PlayerName = $playerName
            PlayerId = $playerId
            PlayerSteamId = $steamId 
            Action = $action
            QuestId = $questName
            QuestName = $questName
            DisplayQuestName = $displayQuestName
            Category = $category
            Tier = $tier
            Type = $questType
            EventType = $eventType
            RawLine = $LogLine
        }
    }
    
    return $null
}

# ===============================================================
# DISCORD INTEGRATION
# ===============================================================
function Send-QuestEventToDiscord {
    param($Event)
    
    try {
        # Validate event data
        if (-not $Event -or -not $Event.Player) {
            Write-Log "Invalid quest event data, skipping Discord notification" -Level "Debug"
            return
        }
        
        # Try to use embed format
        if (Get-Command "Send-QuestEmbed" -ErrorAction SilentlyContinue) {
            try {
                Write-Log "Creating quest embed for $($Event.Player): $($Event.DisplayQuestName)" -Level "Debug"
                $embedData = Send-QuestEmbed -QuestAction $Event
                Write-Log "Quest embed data created successfully" -Level "Debug"
                
                if (Get-Command "Send-DiscordMessage" -ErrorAction SilentlyContinue) {
                    Write-Log "Sending quest embed to Discord..." -Level "Debug"
                    $result = Send-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:Config.Channel -Embed $embedData
                    if ($result -and $result.success) {
                        Write-Log "Quest event embed sent successfully" -Level "Info"
                        return
                    } else {
                        Write-Log "Quest event embed failed to send: $($result | ConvertTo-Json)" -Level "Warning"
                    }
                } else {
                    Write-Log "Send-DiscordMessage command not found" -Level "Warning"
                }
            } catch {
                Write-Log "Error creating quest embed: $($_.Exception.Message)" -Level "Warning"
            }
        } else {
            Write-Log "Send-QuestEmbed function not found" -Level "Warning"
        }
        
    } catch {
        Write-Log "Error in Send-QuestEventToDiscord: $($_.Exception.Message)" -Level "Error"
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
    'Initialize-QuestLogModule',
    'ConvertFrom-QuestLine',
    'Update-QuestLogProcessing',
    'Get-NewQuestEvents',
    'Get-LatestQuestLogFile',
    'Send-QuestEventToDiscord',
    'Apply-MessageFilter',
    'Save-QuestState',
    'Load-QuestState'
)

