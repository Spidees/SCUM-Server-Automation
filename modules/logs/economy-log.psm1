# ===============================================================
# SCUM Server Automation - Discord Economy Log Manager
# ===============================================================
# Real-time economy log monitoring and Discord relay system
# ===============================================================

# Standard import of common module
try {
    $helperPath = Join-Path $PSScriptRoot "..\core\module-helper.psm1"
    if (Test-Path $helperPath) {
        # MEMORY LEAK FIX: Check if module already loaded before importing
        if (-not (Get-Module "module-helper" -ErrorAction SilentlyContinue)) {
            Import-Module $helperPath -ErrorAction SilentlyContinue
        }
        Import-CommonModule | Out-Null
    }
    
    # MEMORY LEAK FIX: Import log streaming helper - check if already loaded
    $streamingPath = Join-Path $PSScriptRoot "..\core\log-streaming.psm1"
    if (Test-Path $streamingPath) {
        if (-not (Get-Module "log-streaming" -ErrorAction SilentlyContinue)) {
            Import-Module $streamingPath -ErrorAction SilentlyContinue
        }
    }
    
    # MEMORY LEAK FIX: Import embed templates - check if already loaded
    $embedPath = Join-Path $PSScriptRoot "..\communication\discord\templates\log-embed-templates.psm1"
    if (Test-Path $embedPath) {
        if (-not (Get-Module "log-embed-templates" -ErrorAction SilentlyContinue)) {
            Import-Module $embedPath -ErrorAction SilentlyContinue
        }
    }
} catch {
    Write-Host "[WARNING] Common module not available for economy-log module" -ForegroundColor Yellow
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
function Initialize-EconomyLogModule {
    param([hashtable]$Config)
    
    try {
        Write-Log "Initializing economy log management system..." -Level "Info"
        
        # Initialize configuration
        $script:DiscordConfig = $Config.Discord
        if (-not $script:DiscordConfig -or -not $script:DiscordConfig.Token) {
            Write-Log "Discord not configured, economy log relay disabled" -Level "Info"
            return $false
        }
        
        # Look for EconomyFeed in Features section
        if ($Config.SCUMLogFeatures -and $Config.SCUMLogFeatures.EconomyFeed) {
            $script:Config = $Config.SCUMLogFeatures.EconomyFeed
        }
        else {
            Write-Log "Economy log relay not enabled in configuration" -Level "Info"
            return $false
        }
        
        if (-not $script:Config.Enabled) {
            Write-Log "Economy log relay not enabled in configuration" -Level "Info"
            return $false
        }
        
        # Initialize economy log directory
        $serverDir = $Config.serverDir
        if (-not $serverDir) {
            Write-Log "Server directory not configured" -Level "Info"
            return $false
        }
        
        $script:LogDirectory = Join-Path $serverDir "SCUM\Saved\SaveFiles\Logs"
        Write-Log "Economy log directory: $script:LogDirectory" -Level "Info"
        
        if (-not (Test-Path $script:LogDirectory)) {
            Write-Log "Economy log directory not found: $script:LogDirectory" -Level "Info"
            return $false
        }
        
        # Initialize state persistence
        $stateDir = ".\state"
        if (-not (Test-Path $stateDir)) {
            New-Item -Path $stateDir -ItemType Directory -Force | Out-Null
        }
        $script:StateFile = Join-Path $stateDir "economy-log-manager.json"
        
        # Load previous state
        Load-EconomyState
        
        # Mark as active
        $script:IsMonitoring = $true
        $script:IsRelayActive = $true
        
        return $true
    } catch {
        Write-Log "Failed to initialize economy log manager: $($_.Exception.Message)" -Level "Info"
        return $false
    }
}

# ===============================================================
# ECONOMY LOG MONITORING
# ===============================================================
function Update-EconomyLogProcessing {
    if (-not $script:IsMonitoring -or -not $script:IsRelayActive) {
        return
    }
    
    try {
        $newActions = Get-NewEconomyActions
        
        if (-not $newActions -or $newActions.Count -eq 0) {
            return
        }
        
        # Group actions by timestamp and player to combine multiple transactions
        $groupedActions = $newActions | Group-Object -Property @{Expression={"{0}_{1}_{2}" -f $_.Timestamp.ToString("yyyy-MM-dd HH:mm:ss"), $_.PlayerName, $_.Type}}
        
        foreach ($group in $groupedActions) {
            $actions = $group.Group
            
            if ($actions.Count -eq 1) {
                # Single action - send normally
                $action = $actions[0]
                Write-Log "ECONOMY [$($action.Type)] $($action.PlayerName): $($action.Action)" -Level "Info"
                Send-EconomyActionToDiscord -Action $action
            } else {
                # Multiple actions - combine them
                $firstAction = $actions[0]
                $lastAction = $actions[-1]
                
                $combinedAction = @{
                    Timestamp = $firstAction.Timestamp
                    PlayerName = $firstAction.PlayerName
                    SteamId = $firstAction.SteamId
                    Type = $firstAction.Type
                    Trader = $firstAction.Trader
                    Items = New-Object System.Collections.ArrayList
                    TotalAmount = 0
                }
                
                foreach ($action in $actions) {
                    # MEMORY LEAK FIX: Use ArrayList.Add instead of array +=
                    $null = $combinedAction.Items.Add(@{
                        Item = $action.Item
                        Amount = $action.Amount
                    })
                    $combinedAction.TotalAmount += $action.Amount
                }
                
                # Add financial states if available (find first action that has them)
                $actionWithFinancialStates = $actions | Where-Object { $null -ne $_.BeforeCash -or $null -ne $_.AfterCash } | Select-Object -First 1
                
                if ($actionWithFinancialStates) {
                    if ($null -ne $actionWithFinancialStates.BeforeCash) { $combinedAction.BeforeCash = $actionWithFinancialStates.BeforeCash }
                    if ($null -ne $actionWithFinancialStates.AfterCash) { $combinedAction.AfterCash = $actionWithFinancialStates.AfterCash }
                    if ($null -ne $actionWithFinancialStates.BeforeAccount) { $combinedAction.BeforeAccount = $actionWithFinancialStates.BeforeAccount }
                    if ($null -ne $actionWithFinancialStates.AfterAccount) { $combinedAction.AfterAccount = $actionWithFinancialStates.AfterAccount }
                    if ($null -ne $actionWithFinancialStates.BeforeGold) { $combinedAction.BeforeGold = $actionWithFinancialStates.BeforeGold }
                    if ($null -ne $actionWithFinancialStates.AfterGold) { $combinedAction.AfterGold = $actionWithFinancialStates.AfterGold }
                    if ($null -ne $actionWithFinancialStates.BeforeTraderFunds) { $combinedAction.BeforeTraderFunds = $actionWithFinancialStates.BeforeTraderFunds }
                    if ($null -ne $actionWithFinancialStates.AfterTraderFunds) { $combinedAction.AfterTraderFunds = $actionWithFinancialStates.AfterTraderFunds }
                }
                
                # Create combined action description
                $itemList = ($combinedAction.Items | ForEach-Object { "$($_.Item) ($($_.Amount))" }) -join ", "
                if ($firstAction.Type -eq "sell") {
                    $combinedAction.Action = "sold $itemList to $($firstAction.Trader) for total $($combinedAction.TotalAmount) credits"
                } else {
                    $combinedAction.Action = "bought $itemList from $($firstAction.Trader) for total $($combinedAction.TotalAmount) credits"
                }
                
                Write-Log "ECONOMY [$($combinedAction.Type)] $($combinedAction.PlayerName): $($combinedAction.Action)" -Level "Info"
                Send-EconomyActionToDiscord -Action $combinedAction
            }
        }
        
        # Save state after processing
        Save-EconomyState
        
    } catch {
        Write-Log "Error during economy log update: $($_.Exception.Message)" -Level "Info"
    }
}

function Get-NewEconomyActions {
    # Get the latest economy log file
    $latestLogFile = Get-LatestEconomyLogFile
    if (-not $latestLogFile) {
        return @()
    }
    
    # Check if we're monitoring a different file now
    if ($script:CurrentLogFile -ne $latestLogFile) {
        $script:CurrentLogFile = $latestLogFile
        $script:LastLineNumber = 0  # Reset line counter for new file
    }
    
    if (-not (Test-Path $script:CurrentLogFile)) {
        Write-Log "Economy log file not found: $script:CurrentLogFile" -Level "Info"
        return @()
    }
    
    try {
        # MEMORY LEAK FIX: Use streaming instead of Get-Content on entire file
        $result = Read-LogStreamLines -FilePath $script:CurrentLogFile -LastLineNumber $script:LastLineNumber -Encoding ([System.Text.Encoding]::Unicode)
        
        if (-not $result.Success -or $result.NewLines.Count -eq 0) {
            return @()
        }
        
        # Update position and get new lines
        $newLines = $result.NewLines
        $script:LastLineNumber = $result.TotalLines
        
        if ($newLines.Count -eq 0) {
            return @()
        }
        
        # Parse economy actions from new lines and attach financial states
        $newActions = @()
        $beforeStates = @{}  # Cache for Before states waiting for After states
        
        foreach ($line in $newLines) {
            if (-not [string]::IsNullOrWhiteSpace($line) -and $line -notmatch "Game version:") {
                $parsedAction = ConvertFrom-EconomyLine -LogLine $line
                if ($parsedAction) {
                    # Check if this is a Before/After state line
                    if ($parsedAction.Type -eq "financial_state") {
                        $key = "$($parsedAction.PlayerName)_$($parsedAction.SteamId)"
                        
                        if ($parsedAction.StateType -eq "Before") {
                            # Store Before state
                            $beforeStates[$key] = $parsedAction
                        } elseif ($parsedAction.StateType -eq "After" -and $beforeStates.ContainsKey($key)) {
                            # We have both Before and After - attach to recent transactions
                            $beforeState = $beforeStates[$key]
                            
                            # Find recent transactions for this player to attach financial states
                            for ($i = $newActions.Count - 1; $i -ge 0; $i--) {
                                $action = $newActions[$i]
                                if ($action.PlayerName -eq $parsedAction.PlayerName -and 
                                    $action.SteamId -eq $parsedAction.SteamId -and 
                                    $action.Type -in @("buy", "sell", "currency_conversion", "gold_sale") -and
                                    ($action.Timestamp - $beforeState.Timestamp).TotalSeconds -lt 5) {
                                    
                                    # Attach financial states
                                    $newActions[$i].BeforeCash = $beforeState.Cash
                                    $newActions[$i].AfterCash = $parsedAction.Cash
                                    $newActions[$i].BeforeAccount = $beforeState.Account
                                    $newActions[$i].AfterAccount = $parsedAction.Account
                                    $newActions[$i].BeforeGold = $beforeState.Gold
                                    $newActions[$i].AfterGold = $parsedAction.Gold
                                    $newActions[$i].BeforeTraderFunds = $beforeState.TraderFunds
                                    $newActions[$i].AfterTraderFunds = $parsedAction.TraderFunds
                                    break
                                }
                            }
                            
                            # Clean up the Before state
                            $beforeStates.Remove($key)
                        }
                    } else {
                        # Regular transaction - add to actions
                        $newActions += $parsedAction
                    }
                }
            }
        }
        
        return $newActions
        
    } catch {
        Write-Log "Error reading economy log: $($_.Exception.Message)" -Level "Info"
        return @()
    }
}

function Get-LatestEconomyLogFile {
    try {
        # Get all economy log files
        $LogFiles = Get-ChildItem -Path $script:LogDirectory -Filter "economy_*.log" -ErrorAction SilentlyContinue
        
        if (-not $LogFiles -or $LogFiles.Count -eq 0) {
            Write-Log "No economy log files found in $script:LogDirectory" -Level "Info"
            return $null
        }
        
        # Sort by creation time and get the latest
        $latestFile = $LogFiles | Sort-Object CreationTime -Descending | Select-Object -First 1
        return $latestFile.FullName
        
    } catch {
        Write-Log "Error finding latest economy log: $($_.Exception.Message)" -Level "Info"
        return $null
    }
}

# ===============================================================
# STATE PERSISTENCE
# ===============================================================
function Save-EconomyState {
    try {
        $state = @{
            CurrentLogFile = $script:CurrentLogFile
            LastLineNumber = $script:LastLineNumber
            LastUpdate = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        }
        
        $stateJson = $state | ConvertTo-Json
        Set-Content -Path $script:StateFile -Value $stateJson -Encoding UTF8
        
    } catch {
        Write-Log "Failed to save economy log state: $($_.Exception.Message)" -Level "Info"
    }
}

function Load-EconomyState {
    try {
        if (Test-Path $script:StateFile) {
            $stateJson = Get-Content -Path $script:StateFile -Raw -Encoding UTF8
            $state = $stateJson | ConvertFrom-Json
            
            $script:CurrentLogFile = if ($state.CurrentLogFile) { $state.CurrentLogFile } else { $null }
            $script:LastLineNumber = if ($state.LastLineNumber) { $state.LastLineNumber } else { 0 }
            
            # Verify the saved log file still exists, if not reset
            if ($script:CurrentLogFile -and -not (Test-Path $script:CurrentLogFile)) {
                Write-Log "Previous economy log file no longer exists, resetting state" -Level "Info"
                $script:CurrentLogFile = $null
                $script:LastLineNumber = 0
            } else {
                Write-Log "Loaded economy log state: File=$($script:CurrentLogFile), Line=$($script:LastLineNumber)" -Level "Info"
            }
        } else {
            Write-Log "No previous economy log state found, starting from current log end" -Level "Info"
            # Initialize to current log file and skip to end to avoid spam
            $latestLogFile = Get-LatestEconomyLogFile
            if ($latestLogFile -and (Test-Path $latestLogFile)) {
                $script:CurrentLogFile = $latestLogFile
                # MEMORY LEAK FIX: Use streaming to count lines instead of loading entire file
                try {
                    $script:LastLineNumber = Get-LogFileLineCount -FilePath $script:CurrentLogFile -Encoding ([System.Text.Encoding]::Unicode)
                    Write-Log "Initialized economy log state: File=$($script:CurrentLogFile), Starting from line $($script:LastLineNumber)" -Level "Info"
                } catch {
                    $script:LastLineNumber = 0
                }
            } else {
                $script:CurrentLogFile = $null
                $script:LastLineNumber = 0
            }
        }
    } catch {
        Write-Log "Failed to load economy log state, starting fresh: $($_.Exception.Message)" -Level "Info"
        $script:CurrentLogFile = $null
        $script:LastLineNumber = 0
    }
}

# ===============================================================
# ECONOMY LOG PARSING
# ===============================================================
function ConvertFrom-EconomyLine {
    param([string]$LogLine)
    
    # Skip empty lines and game version lines
    if ([string]::IsNullOrWhiteSpace($LogLine) -or $LogLine -match "Game version:") {
        return $null
    }
    
    # Real economy log patterns with timestamps:
    if ($LogLine -match "^([\d.-]+):\s+(.+)$") {
        $date = $matches[1]
        $content = $matches[2].Trim()
        
        try {
            # Parse date: 2025.07.20-04.00.19 -> 2025/07/20 04:00:19
            $datePart = $date -replace '\.', '/' -replace '-', ' '
            $timestamp = [datetime]::ParseExact($datePart, "yyyy/MM/dd HH.mm.ss", $null)
        } catch {
            $timestamp = Get-Date
        }
        
        # Pattern 1: Trade transactions (buying/selling items)
        if ($content -match "^\[Trade\]\s+Tradeable\s+\((.+?)\)\s+(sold by|purchased by)\s+(.+?)\((\d+)\)\s+for\s+(\d+)\s+.*?(to|from)\s+trader\s+([^,]+)") {
            $item = $matches[1]
            $transactionType = $matches[2]
            $playerName = $matches[3]
            $steamId = $matches[4]
            $amount = [int]$matches[5]
            $direction = $matches[6]
            $trader = if ($matches[7]) { $matches[7].Trim() } else { "Unknown" }
            
            if ($transactionType -eq "sold by") {
                $actionType = "sell"
                $action = "sold $item to $trader for $amount credits"
            } else {
                $actionType = "buy"
                $action = "bought $item from $trader for $amount credits"
            }
            
            return @{
                Timestamp = $timestamp
                PlayerName = $playerName
                SteamId = $steamId
                Action = $action
                Type = $actionType
                Item = $item
                Amount = $amount
                Trader = $trader
                RawLine = $LogLine
            }
        }
        
        # Pattern 2: Trade-Mechanic services
        elseif ($content -match "^\[Trade-Mechanic\]\s+Service\s+\((.+?)\)\s+purchased by\s+(.+?)\((\d+)\)\s+for\s+(\d+)\s+money\s+from\s+trader\s+([^,]+)") {
            $service = $matches[1]
            $playerName = $matches[2]
            $steamId = $matches[3]
            $amount = [int]$matches[4]
            $trader = if ($matches[5]) { $matches[5].Trim() } else { "Unknown" }
            
            return @{
                Timestamp = $timestamp
                PlayerName = $playerName
                SteamId = $steamId
                Action = "purchased $service from $trader for $amount credits"
                Type = "mechanic"
                Service = $service
                Amount = $amount
                Trader = $trader
                RawLine = $LogLine
            }
        }
        
        # Pattern 3: Bank deposits
        elseif ($content -match "^\[Bank\]\s+(.+?)\(ID:(\d+)\).*?deposited\s+(\d+)\((\d+)\s+was\s+added\)") {
            $playerName = $matches[1]
            $steamId = $matches[2]
            $amount = [int]$matches[3]
            $netAmount = [int]$matches[4]
            
            return @{
                Timestamp = $timestamp
                PlayerName = $playerName
                SteamId = $steamId
                Action = "deposited $amount credits (net: $netAmount)"
                Type = "bank_deposit"
                Amount = $amount
                NetAmount = $netAmount
                RawLine = $LogLine
            }
        }
        
        # Pattern 4: Bank withdrawals
        elseif ($content -match "^\[Bank\]\s+(.+?)\(ID:(\d+)\).*?withdrew\s+(\d+)\((\d+)\s+was\s+removed\)") {
            $playerName = $matches[1]
            $steamId = $matches[2]
            $amount = [int]$matches[3]
            $netAmount = [int]$matches[4]
            
            return @{
                Timestamp = $timestamp
                PlayerName = $playerName
                SteamId = $steamId
                Action = "withdrew $amount credits (net: $netAmount)"
                Type = "bank_withdraw"
                Amount = $amount
                NetAmount = $netAmount
                RawLine = $LogLine
            }
        }
        
        # Pattern 5: Bank card purchases
        elseif ($content -match "^\[Bank\]\s+(.+?)\(ID:(\d+)\).*?purchased\s+(.+?)\s+card.*?new\s+account\s+balance\s+is\s+(\d+)\s+credits") {
            $playerName = $matches[1]
            $steamId = $matches[2]
            $cardType = $matches[3]
            $balance = [int]$matches[4]
            
            return @{
                Timestamp = $timestamp
                PlayerName = $playerName
                SteamId = $steamId
                Action = "purchased $cardType card (balance: $balance credits)"
                Type = "bank_card"
                CardType = $cardType
                Balance = $balance
                RawLine = $LogLine
            }
        }
        
        # Pattern 6: Currency conversion (credits to gold purchase)
        elseif ($content -match "^\[Currency Conversion\]\s+(.+?)\(ID:(\d+)\)\(Account Number:\d+\).*?purchased\s+(\d+)\s+gold\s+for\s+(\d+)\s+credits.*?new\s+account\s+balance\s+is\s+(\d+)\s+gold/(\d+)\s+credits") {
            $playerName = $matches[1]
            $steamId = $matches[2]
            $goldAmount = [int]$matches[3]
            $creditsAmount = [int]$matches[4]
            $newGoldBalance = [int]$matches[5]
            $newCreditBalance = [int]$matches[6]
            
            # Calculate Before states (reverse the transaction)
            $beforeGold = $newGoldBalance - $goldAmount
            $beforeCredits = $newCreditBalance + $creditsAmount
            
            return @{
                Timestamp = $timestamp
                PlayerName = $playerName
                SteamId = $steamId
                Action = "converted $creditsAmount credits to $goldAmount gold"
                Type = "currency_conversion"
                GoldAmount = $goldAmount
                CreditsAmount = $creditsAmount
                BeforeGold = $beforeGold
                AfterGold = $newGoldBalance
                BeforeAccount = $beforeCredits
                AfterAccount = $newCreditBalance
                RawLine = $LogLine
            }
        }
        
        # Pattern 6a: Currency conversion (gold to credits sale)
        elseif ($content -match "^\[Currency Conversion\]\s+(.+?)\(ID:(\d+)\)\(Account Number:\d+\).*?sold\s+(\d+)\s+gold\s+for\s+(\d+)\s+credits.*?new\s+account\s+balance\s+is\s+(\d+)\s+gold/(\d+)\s+credits") {
            $playerName = $matches[1]
            $steamId = $matches[2]
            $goldAmount = [int]$matches[3]
            $creditsAmount = [int]$matches[4]
            $newGoldBalance = [int]$matches[5]
            $newCreditBalance = [int]$matches[6]
            
            # Calculate Before states (reverse the transaction)
            $beforeGold = $newGoldBalance + $goldAmount
            $beforeCredits = $newCreditBalance - $creditsAmount
            
            return @{
                Timestamp = $timestamp
                PlayerName = $playerName
                SteamId = $steamId
                Action = "converted $goldAmount gold to $creditsAmount credits"
                Type = "currency_conversion"
                GoldAmount = $goldAmount
                CreditsAmount = $creditsAmount
                BeforeGold = $beforeGold
                AfterGold = $newGoldBalance
                BeforeAccount = $beforeCredits
                AfterAccount = $newCreditBalance
                RawLine = $LogLine
            }
        }
        
        # Pattern 7: Bank card destruction
        elseif ($content -match "^\[Bank\]\s+(.+?)\(ID:(\d+)\).*?manually\s+destroyed\s+(.+?)\s+card") {
            $playerName = $matches[1]
            $steamId = $matches[2]
            $cardType = $matches[3]
            
            return @{
                Timestamp = $timestamp
                PlayerName = $playerName
                SteamId = $steamId
                Action = "destroyed $cardType card"
                Type = "bank_card_destroy"
                CardType = $cardType
                RawLine = $LogLine
            }
        }
        
        # Pattern 8: Squad penalties
        elseif ($content -match "^\[SquadPenalties\]\s+Squad\s+leaving\s+penalty\s+carried\s+out\s+for\s+(.+?)\((\d+)\)\s+for\s+(\d+)\s+money") {
            $playerName = $matches[1]
            $steamId = $matches[2]
            $penaltyAmount = [int]$matches[3]
            
            return @{
                Timestamp = $timestamp
                PlayerName = $playerName
                SteamId = $steamId
                Action = "received squad leaving penalty of $penaltyAmount credits"
                Type = "squad_penalty"
                PenaltyAmount = $penaltyAmount
                RawLine = $LogLine
            }
        }
        
        # Pattern 9: Trade before/after status lines (for financial state tracking)
        elseif ($content -match "^\[Trade\]\s+(Before|After)\s+(.+?)\s+.*?player\s+(.+?)\((\d+)\)\s+.*?(has|had)\s+(\d+)\s+cash.*?(\d+)\s+(account balance|bank account balance).*?(\d+)\s+gold.*?trader.*?(\d+)\s+funds") {
            $stateType = $matches[1]  # Before or After
            $transactionType = $matches[2]  # purchasing/selling/tradeable/etc
            $playerName = $matches[3]
            $steamId = $matches[4]
            $cash = [int]$matches[6]
            $account = [int]$matches[7]
            $gold = [int]$matches[9]
            $traderFunds = [int]$matches[10]
            
            return @{
                Timestamp = $timestamp
                PlayerName = $playerName
                SteamId = $steamId
                Type = "financial_state"
                StateType = $stateType
                TransactionType = $transactionType
                Cash = $cash
                Account = $account
                Gold = $gold
                TraderFunds = $traderFunds
                Action = "$stateType state for $transactionType"
                RawLine = $LogLine
            }
        }
    }
    
    return $null
}

# ===============================================================
# DISCORD INTEGRATION
# ===============================================================
function Send-EconomyActionToDiscord {
    param($Action)
    
    try {
        # Validate action data
        if (-not $Action -or -not $Action.Action) {
            Write-Log "Invalid economy action data, skipping Discord notification" -Level "Debug"
            return
        }
        
        if (Get-Command "Send-EconomyEmbed" -ErrorAction SilentlyContinue) {
            try {
                Write-Log "Creating economy embed for $($Action.PlayerName)" -Level "Debug"
                $embedData = Send-EconomyEmbed -EconomyAction $Action
                Write-Log "Economy embed data created successfully" -Level "Debug"
                
                if (Get-Command "Send-DiscordMessage" -ErrorAction SilentlyContinue) {
                    Write-Log "Sending economy embed to Discord..." -Level "Debug"
                    $result = Send-DiscordMessage -Token $script:DiscordConfig.Token -ChannelId $script:Config.Channel -Embed $embedData
                    if ($result -and $result.success) {
                        Write-Log "Economy embed sent successfully" -Level "Debug"
                        return
                    } else {
                        Write-Log "Economy action embed failed to send: $($result | ConvertTo-Json)" -Level "Warning"
                    }
                } else {
                    Write-Log "Send-DiscordMessage function not found" -Level "Warning"
                }
            } catch {
                Write-Log "Error creating economy embed: $($_.Exception.Message)" -Level "Warning"
            }
        } else {
            Write-Log "Send-EconomyEmbed function not found" -Level "Warning"
        }
        
    } catch {
        Write-Log "Error in Send-EconomyActionToDiscord: $($_.Exception.Message)" -Level "Error"
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
    'Initialize-EconomyLogModule',
    'ConvertFrom-EconomyLine',
    'Update-EconomyLogProcessing',
    'Get-NewEconomyActions',
    'Get-LatestEconomyLogFile',
    'Send-EconomyActionToDiscord',
    'Apply-MessageFilter',
    'Save-EconomyState',
    'Load-EconomyState'
)


