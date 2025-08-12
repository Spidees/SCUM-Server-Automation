# ===============================================================
# SCUM Server Automation - Economy Database Module
# ===============================================================

#Requires -Version 5.1

# Standard import of common module
try {
    $helperPath = Join-Path $PSScriptRoot "..\core\module-helper.psm1"
    if (Test-Path $helperPath) {
        Import-Module $helperPath -Force -ErrorAction SilentlyContinue
        Import-CommonModule | Out-Null
    }
} catch {
    Write-Host "[WARNING] Common module not available for economy database module" -ForegroundColor Yellow
}

# Module variables
$script:DatabasePath = $null
$script:SqliteExePath = $null

# Module initialization function
function Initialize-EconomyModule {
    param([string]$DatabasePath, [string]$SqliteExePath)
    
    try {
        $script:DatabasePath = $DatabasePath
        $script:SqliteExePath = $SqliteExePath
        
        Write-Log "[Economy] Module initialized successfully"
        Write-Log "[Economy] Database: $DatabasePath"
        return @{ Success = $true }
    } catch {
        Write-Log "[Economy] Failed to initialize: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

# Get top money holders (enhanced with admin filtering)
function Get-TopMoney {
    param([int]$Limit = 10, [switch]$WeeklyOnly)
    
    try {
        $query = "SELECT u.name as Name, barc.account_balance as Score 
                  FROM user_profile u 
                  JOIN bank_account_registry bar ON u.id = bar.account_owner_user_profile_id 
                  JOIN bank_account_registry_currencies barc ON bar.id = barc.bank_account_id 
                  WHERE u.type != 2 AND barc.currency_type = 1 AND barc.account_balance > 0 
                  ORDER BY barc.account_balance DESC 
                  LIMIT $Limit"
        
        $result = Invoke-DatabaseQuery -Query $query
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "$([int]$_.Score) credits"
                }
            }
        }
        return @()
    } catch {
        return @()
    }
}

# Get top gold holders
function Get-TopGold {
    param([int]$Limit = 10)
    
    try {
        $query = "SELECT u.name as Name, barc.account_balance as Score 
                  FROM user_profile u 
                  JOIN bank_account_registry bar ON u.id = bar.account_owner_user_profile_id 
                  JOIN bank_account_registry_currencies barc ON bar.id = barc.bank_account_id 
                  WHERE u.type != 2 AND barc.currency_type = 2 AND barc.account_balance > 0 
                  ORDER BY barc.account_balance DESC 
                  LIMIT $Limit"
        
        $result = Invoke-DatabaseQuery -Query $query
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.Score
                    FormattedValue = "$([int]$_.Score) gold"
                }
            }
        }
        return @()
    } catch {
        return @()
    }
}

# Get total economy statistics
function Get-EconomyTotals {
    try {
        $creditQuery = "SELECT SUM(barc.account_balance) as total 
                        FROM bank_account_registry_currencies barc 
                        JOIN bank_account_registry bar ON barc.bank_account_id = bar.id 
                        JOIN user_profile u ON bar.account_owner_user_profile_id = u.id 
                        WHERE u.type != 2 AND barc.currency_type = 1"
        
        $goldQuery = "SELECT SUM(barc.account_balance) as total 
                      FROM bank_account_registry_currencies barc 
                      JOIN bank_account_registry bar ON barc.bank_account_id = bar.id 
                      JOIN user_profile u ON bar.account_owner_user_profile_id = u.id 
                      WHERE u.type != 2 AND barc.currency_type = 2"
        
        $creditResult = Invoke-DatabaseQuery -Query $creditQuery
        $goldResult = Invoke-DatabaseQuery -Query $goldQuery
        
        $totalCredits = 0
        $totalGold = 0
        
        if ($creditResult.Success -and $creditResult.Data.Count -gt 0) {
            $totalCredits = if ($creditResult.Data[0].total) { [int]$creditResult.Data[0].total } else { 0 }
        }
        
        if ($goldResult.Success -and $goldResult.Data.Count -gt 0) {
            $totalGold = if ($goldResult.Data[0].total) { [int]$goldResult.Data[0].total } else { 0 }
        }
        
        return @{
            TotalCredits = $totalCredits
            TotalGold = $totalGold
            FormattedCredits = "$totalCredits credits"
            FormattedGold = "$totalGold gold"
            Success = $true
        }
    } catch {
        return @{
            TotalCredits = 0
            TotalGold = 0
            FormattedCredits = "0 credits"
            FormattedGold = "0 gold"
            Success = $false
        }
    }
}

# Get bank account statistics
function Get-BankAccountStats {
    try {
        $totalAccountsQuery = "SELECT COUNT(*) as total FROM bank_account_registry"
        $activeAccountsQuery = "SELECT COUNT(DISTINCT bar.id) as total 
                                FROM bank_account_registry bar 
                                JOIN bank_account_registry_currencies barc ON bar.id = barc.bank_account_id 
                                JOIN user_profile u ON bar.account_owner_user_profile_id = u.id 
                                WHERE u.type != 2 AND barc.account_balance > 0"
        
        $totalResult = Invoke-DatabaseQuery -Query $totalAccountsQuery
        $activeResult = Invoke-DatabaseQuery -Query $activeAccountsQuery
        
        $totalAccounts = 0
        $activeAccounts = 0
        
        if ($totalResult.Success -and $totalResult.Data.Count -gt 0) {
            $totalAccounts = [int]$totalResult.Data[0].total
        }
        
        if ($activeResult.Success -and $activeResult.Data.Count -gt 0) {
            $activeAccounts = [int]$activeResult.Data[0].total
        }
        
        return @{
            TotalAccounts = $totalAccounts
            ActiveAccounts = $activeAccounts
            InactiveAccounts = $totalAccounts - $activeAccounts
            Success = $true
        }
    } catch {
        return @{
            TotalAccounts = 0
            ActiveAccounts = 0
            InactiveAccounts = 0
            Success = $false
        }
    }
}

# Get trader information
function Get-TraderStats {
    try {
        $query = "SELECT COUNT(*) as TraderCount, SUM(available_funds) as TotalFunds FROM economy_traders"
        $result = Invoke-DatabaseQuery -Query $query
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            $traderCount = [int]$result.Data[0].TraderCount
            $totalFunds = if ($result.Data[0].TotalFunds) { [int]$result.Data[0].TotalFunds } else { 0 }
            
            return @{
                TraderCount = $traderCount
                TotalTraderFunds = $totalFunds
                AverageTraderFunds = if ($traderCount -gt 0) { [math]::Round($totalFunds / $traderCount, 0) } else { 0 }
                FormattedTotalFunds = "$totalFunds credits"
                Success = $true
            }
        }
        
        return @{ TraderCount = 0; TotalTraderFunds = 0; AverageTraderFunds = 0; Success = $false }
    } catch {
        return @{ TraderCount = 0; TotalTraderFunds = 0; AverageTraderFunds = 0; Success = $false }
    }
}

# Get economy reset information
function Get-EconomyResetInfo {
    try {
        $query = "SELECT time_since_last_economy_reset FROM economy LIMIT 1"
        $result = Invoke-DatabaseQuery -Query $query
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            $timeSinceReset = [int]$result.Data[0].time_since_last_economy_reset
            
            return @{
                TimeSinceReset = $timeSinceReset
                FormattedTime = "$timeSinceReset seconds since last reset"
                Success = $true
            }
        }
        
        return @{ TimeSinceReset = 0; FormattedTime = "No reset data"; Success = $false }
    } catch {
        return @{ TimeSinceReset = 0; FormattedTime = "No reset data"; Success = $false }
    }
}

# Get comprehensive economy summary
function Get-EconomySummary {
    $totals = Get-EconomyTotals
    $accounts = Get-BankAccountStats
    $traders = Get-TraderStats
    $reset = Get-EconomyResetInfo
    
    return @{
        Currency = @{
            TotalCredits = $totals.TotalCredits
            TotalGold = $totals.TotalGold
        }
        Accounts = @{
            Total = $accounts.TotalAccounts
            Active = $accounts.ActiveAccounts
            Inactive = $accounts.InactiveAccounts
        }
        Traders = @{
            Count = $traders.TraderCount
            TotalFunds = $traders.TotalTraderFunds
            AverageFunds = $traders.AverageTraderFunds
        }
        System = @{
            TimeSinceReset = $reset.TimeSinceReset
            ResetStatus = $reset.FormattedTime
        }
    }
}

# Export functions
Export-ModuleMember -Function @(
    'Initialize-EconomyModule',
    'Get-TopMoney',
    'Get-TopGold',
    'Get-EconomyTotals',
    'Get-BankAccountStats',
    'Get-TraderStats',
    'Get-EconomyResetInfo',
    'Get-EconomySummary'
)
