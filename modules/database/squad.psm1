# ===============================================================
# SCUM Server Automation - Squad Database Module
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
    Write-Host "[WARNING] Common module not available for squad database module" -ForegroundColor Yellow
}

# Module variables
$script:DatabasePath = $null
$script:SqliteExePath = $null

# Module initialization function
function Initialize-SquadModule {
    param([string]$DatabasePath, [string]$SqliteExePath)
    
    try {
        $script:DatabasePath = $DatabasePath
        $script:SqliteExePath = $SqliteExePath
        
        Write-Log "[Squad] Module initialized successfully"
        Write-Log "[Squad] Database: $DatabasePath"
        return @{ Success = $true }
    } catch {
        Write-Log "[Squad] Failed to initialize: $($_.Exception.Message)" -Level Error
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

# Get active squad count (improved)
function Get-ActiveSquadCount {
    try {
        $result = Invoke-DatabaseQuery -Query "SELECT COUNT(*) as total FROM squad WHERE id IN (SELECT DISTINCT squad_id FROM squad_member)"
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            return $result.Data[0].total
        }
        
        return 0
    } catch {
        return 0
    }
}

# Get top squads
function Get-TopSquads {
    param([int]$Limit = 10, [bool]$WeeklyOnly = $false)
    
    try {
        $query = "SELECT name as Name, score as Score FROM squad WHERE score > 0 ORDER BY score DESC LIMIT $Limit"
        $result = Invoke-DatabaseQuery -Query $query
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = $_.Score
                    FormattedValue = "{0:F0} score" -f $_.Score
                }
            }
        }
        
        return @()
    } catch {
        return @()
    }
}

# Get top squad leaders (corrected - shows squad leaders by their squad's score)
function Get-TopSquadLeaders {
    param([int]$Limit = 10, [bool]$WeeklyOnly = $false)
    
    try {
        # Rank 4 seems to be the leader rank
        $query = "SELECT u.name as Name, s.name as SquadName, s.score as Score FROM user_profile u JOIN squad_member sm ON u.id = sm.user_profile_id JOIN squad s ON sm.squad_id = s.id WHERE sm.rank = 4 AND u.type != 2 ORDER BY s.score DESC LIMIT $Limit"
        $result = Invoke-DatabaseQuery -Query $query
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [math]::Round([double]$_.Score, 0)
                    FormattedValue = "$([math]::Round([double]$_.Score, 0)) score (${_}.SquadName)"
                }
            }
        }
        return @()
    } catch {
        return @()
    }
}

# Get squad details
function Get-SquadDetails {
    param([string]$SquadName)
    
    try {
        $escapedName = $SquadName -replace "'", "''"
        $query = "SELECT s.*, COUNT(sm.user_profile_id) as member_count FROM squad s LEFT JOIN squad_member sm ON s.id = sm.squad_id WHERE s.name = '$escapedName' GROUP BY s.id"
        $result = Invoke-DatabaseQuery -Query $query
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            $squad = $result.Data[0]
            
            # Get members with details
            $memberQuery = "SELECT u.name as PlayerName, u.user_id as SteamID, sm.rank, u.last_login_time FROM user_profile u JOIN squad_member sm ON u.id = sm.user_profile_id JOIN squad s ON sm.squad_id = s.id WHERE s.name = '$escapedName' AND u.type != 2 ORDER BY sm.rank DESC, u.name"
            $memberResult = Invoke-DatabaseQuery -Query $memberQuery
            
            $members = @()
            if ($memberResult.Success -and $memberResult.Data.Count -gt 0) {
                $members = $memberResult.Data | ForEach-Object {
                    $rankName = switch ($_.rank) {
                        4 { "Leader" }
                        3 { "Officer" }
                        2 { "Member" }
                        1 { "Recruit" }
                        default { "Unknown" }
                    }
                    @{
                        Name = $_.PlayerName
                        SteamID = $_.SteamID
                        Rank = $_.rank
                        RankName = $rankName
                        LastLogin = $_.last_login_time
                    }
                }
            }
            
            return @{
                Success = $true
                Data = @{
                    ID = $squad.id
                    Name = $squad.name
                    Message = $squad.message
                    Information = $squad.information
                    Score = $squad.score
                    MemberLimit = $squad.member_limit
                    MemberCount = $squad.member_count
                    LastMemberLogin = $squad.last_member_login_time
                    LastMemberLogout = $squad.last_member_logout_time
                    Members = $members
                }
            }
        }
        
        return @{ Success = $false; Error = "Squad not found" }
    } catch {
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

# Get squads by member count
function Get-SquadsByMemberCount {
    param([int]$Limit = 10, [string]$SortOrder = "DESC")
    
    try {
        $order = if ($SortOrder.ToUpper() -eq "ASC") { "ASC" } else { "DESC" }
        $query = "SELECT s.name as Name, s.score, COUNT(sm.user_profile_id) as member_count FROM squad s LEFT JOIN squad_member sm ON s.id = sm.squad_id LEFT JOIN user_profile u ON sm.user_profile_id = u.id WHERE u.type != 2 OR u.type IS NULL GROUP BY s.id, s.name ORDER BY member_count $order LIMIT $Limit"
        $result = Invoke-DatabaseQuery -Query $query
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Value = [int]$_.member_count
                    FormattedValue = "$([int]$_.member_count) members"
                    Score = if ($_.score) { [math]::Round([double]$_.score, 0) } else { 0 }
                }
            }
        }
        
        return @()
    } catch {
        return @()
    }
}

# Get player's squad info
function Get-PlayerSquad {
    param([string]$PlayerName)
    
    try {
        $escapedName = $PlayerName -replace "'", "''"
        $query = "SELECT s.name as SquadName, s.score, sm.rank, s.member_limit FROM user_profile u JOIN squad_member sm ON u.id = sm.user_profile_id JOIN squad s ON sm.squad_id = s.id WHERE u.name = '$escapedName' AND u.type != 2"
        $result = Invoke-DatabaseQuery -Query $query
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            $data = $result.Data[0]
            $rankName = switch ($data.rank) {
                4 { "Leader" }
                3 { "Officer" }
                2 { "Member" }
                1 { "Recruit" }
                default { "Unknown" }
            }
            
            return @{
                Success = $true
                Data = @{
                    SquadName = $data.SquadName
                    Score = $data.score
                    Rank = $data.rank
                    RankName = $rankName
                    MemberLimit = $data.member_limit
                }
            }
        }
        
        return @{ Success = $false; Error = "Player not found in any squad" }
    } catch {
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

# Get squad statistics
function Get-SquadStatistics {
    try {
        $statsQuery = @"
SELECT 
    COUNT(*) as total_squads,
    AVG(member_count) as avg_members,
    MAX(member_count) as max_members,
    MIN(member_count) as min_members,
    SUM(member_count) as total_squad_members,
    AVG(score) as avg_score,
    MAX(score) as max_score
FROM (
    SELECT s.id, s.score, COUNT(sm.user_profile_id) as member_count 
    FROM squad s 
    LEFT JOIN squad_member sm ON s.id = sm.squad_id 
    LEFT JOIN user_profile u ON sm.user_profile_id = u.id 
    WHERE u.type != 2 OR u.type IS NULL
    GROUP BY s.id
) squad_stats
"@
        
        $result = Invoke-DatabaseQuery -Query $statsQuery
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            $stats = $result.Data[0]
            return @{
                TotalSquads = [int]$stats.total_squads
                AverageMembers = [math]::Round([double]$stats.avg_members, 1)
                MaxMembers = [int]$stats.max_members
                MinMembers = [int]$stats.min_members
                TotalSquadMembers = [int]$stats.total_squad_members
                AverageScore = [math]::Round([double]$stats.avg_score, 1)
                MaxScore = [math]::Round([double]$stats.max_score, 0)
            }
        }
        
        return @{}
    } catch {
        return @{}
    }
}

# Get inactive squads (no recent member activity)
function Get-InactiveSquads {
    param([int]$DaysInactive = 7, [int]$Limit = 20)
    
    try {
        $query = "SELECT s.name as Name, s.score, s.last_member_login_time, COUNT(sm.user_profile_id) as member_count FROM squad s LEFT JOIN squad_member sm ON s.id = sm.squad_id LEFT JOIN user_profile u ON sm.user_profile_id = u.id WHERE u.type != 2 OR u.type IS NULL GROUP BY s.id HAVING datetime(s.last_member_login_time) < datetime('now', '-$DaysInactive days') OR s.last_member_login_time IS NULL ORDER BY s.last_member_login_time ASC LIMIT $Limit"
        $result = Invoke-DatabaseQuery -Query $query
        
        if ($result.Success -and $result.Data.Count -gt 0) {
            return $result.Data | ForEach-Object {
                @{
                    Name = $_.Name
                    Score = if ($_.score) { [math]::Round([double]$_.score, 0) } else { 0 }
                    MemberCount = [int]$_.member_count
                    LastActivity = $_.last_member_login_time
                    FormattedValue = "$([int]$_.member_count) members, last seen: $($_.last_member_login_time)"
                }
            }
        }
        
        return @()
    } catch {
        return @()
    }
}

# Export functions
Export-ModuleMember -Function @(
    'Initialize-SquadModule',
    'Get-ActiveSquadCount',
    'Get-TopSquads',
    'Get-TopSquadLeaders',
    'Get-SquadDetails',
    'Get-SquadsByMemberCount',
    'Get-PlayerSquad',
    'Get-SquadStatistics',
    'Get-InactiveSquads'
)
