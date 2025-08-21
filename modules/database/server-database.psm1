# ===============================================================
# Server Database Module - SQLite Based
# ===============================================================

# Standard import of common module
try {
    $helperPath = Join-Path $PSScriptRoot "..\core\module-helper.psm1"
    if (Test-Path $helperPath) {
        if (-not (Get-Module "module-helper" -ErrorAction SilentlyContinue)) {
            Import-Module $helperPath -Global
        }
        Import-CommonModule | Out-Null
    }
} catch {
    Write-Host "[WARNING] Common module not available for server-database module" -ForegroundColor Yellow
}

# Basic variables
$script:ServerDbPath = $null
$script:ScumDbPath = $null
$script:SqlitePath = $null
$script:Config = $null

### ===============================================================
# CUSTOM TABLES/COLUMNS/DATA FUNCTIONS
### ===============================================================

function Add-CustomDatabaseObjects {
    param([hashtable]$Config)
    <#
    .SYNOPSIS
    Add custom tables, columns, or data from install.sql
    #>
    try {
        $installSqlPath = Join-Path $Config.dataDir "sql\install.sql"
        if (-not (Test-Path $installSqlPath)) {
            Write-Log "[ServerDB] No custom install.sql found: $installSqlPath" -Level Info
            return
        }
        Write-Log "[ServerDB] Running custom install.sql: $installSqlPath" -Level Info
        & $script:SqlitePath $script:ServerDbPath ".read $installSqlPath" | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Log "[ServerDB] Custom SQL applied successfully" -Level Info
        } else {
            Write-Log "[ServerDB] Error applying custom SQL (exit code: $LASTEXITCODE)" -Level Error
        }
    } catch {
        Write-Log "[ServerDB] Error running custom SQL: $($_.Exception.Message)" -Level Error
    }
}

# ===============================================================
# FIRST STEP - Create database when it doesn't exist
# ===============================================================

function Initialize-ServerDatabase {
    param([hashtable]$Config)
    
    try {
        # Validate configuration
        if (-not $Config) {
            throw "Configuration is null"
        }
        
        if (-not $Config.dataDir) {
            throw "dataDir not found in configuration"
        }
        
        if (-not $Config.savedDir) {
            throw "savedDir not found in configuration"
        }
        
        if (-not $Config.rootDir) {
            throw "rootDir not found in configuration"
        }
        
        # Set paths from configuration
        $script:Config = $Config
        $script:ServerDbPath = Join-Path $Config.dataDir "server_database.db"
        $script:ScumDbPath = Join-Path $Config.savedDir "SaveFiles\SCUM.db"
        $script:SqlitePath = Join-Path $Config.rootDir "sqlite-tools\sqlite3.exe"
        
        Write-Log "[ServerDB] Paths configured:" -Level Debug
        Write-Log "[ServerDB]   Server DB: $script:ServerDbPath" -Level Debug
        Write-Log "[ServerDB]   SCUM DB: $script:ScumDbPath" -Level Debug
        Write-Log "[ServerDB]   SQLite: $script:SqlitePath" -Level Debug
        
        # Check if paths are valid before using Test-Path
        if ([string]::IsNullOrEmpty($script:SqlitePath)) {
            throw "SQLite path is null or empty"
        }
        
        if ([string]::IsNullOrEmpty($script:ScumDbPath)) {
            throw "SCUM database path is null or empty"
        }
        
        if ([string]::IsNullOrEmpty($script:ServerDbPath)) {
            throw "Server database path is null or empty"
        }
        
        # Check SQLite tools existence
        if (-not (Test-Path $script:SqlitePath)) {
            Write-Log "[ServerDB] SQLite tools not found: $script:SqlitePath" -Level Error
            return $false
        }
        
        # Check SCUM.db existence
        if (-not (Test-Path $script:ScumDbPath)) {
            Write-Log "[ServerDB] SCUM.db not found: $script:ScumDbPath" -Level Error
            return $false
        }
        
        # If server database doesn't exist, create it
        if (-not (Test-Path $script:ServerDbPath)) {
            Write-Log "[ServerDB] Creating new server database..." -Level Info
            New-ServerDatabase
        } else {
            Write-Log "[ServerDB] Server database already exists" -Level Info
        }
        
        return $true
        
    } catch {
        Write-Log "[ServerDB] Error during initialization: $($_.Exception.Message)" -Level Error
        return $false
    }
}

function New-ServerDatabase {
    Write-Log "[ServerDB] Creating server_database.db using SQLite..." -Level Info
    
    # Simply copy SCUM.db as server_database.db
    Copy-Item $script:ScumDbPath $script:ServerDbPath -Force
    
    if (Test-Path $script:ServerDbPath) {
        Write-Log "[ServerDB] Server database created successfully" -Level Info
        # Run custom SQL for columns/tables/data
        Add-CustomDatabaseObjects -Config $script:Config
    } else {
        throw "Error creating database"
    }
}

# ===============================================================
# UPDATE FUNCTIONS
# ===============================================================

function Update-ServerDatabase {
    <#
    .SYNOPSIS
    Update server database with latest data from SCUM.db
    #>
    
    try {
        Write-Log "[ServerDB] Starting database update from SCUM.db..." -Level Info
        
        # Check if both databases exist
        if (-not (Test-Path $script:ScumDbPath)) {
            Write-Log "[ServerDB] SCUM.db not found: $script:ScumDbPath" -Level Error
            return $false
        }
        
        if (-not (Test-Path $script:ServerDbPath)) {
            Write-Log "[ServerDB] Server database not found: $script:ServerDbPath" -Level Error
            return $false
        }
        
        # Get list of tables from SCUM.db
        $tables = & $script:SqlitePath $script:ScumDbPath ".tables"
        $tableList = $tables -split '\s+' | Where-Object { $_ -ne '' -and $_ -notlike 'custom_*' }
        
        Write-Log "[ServerDB] Found $($tableList.Count) tables to update" -Level Debug
        
        # Update each table using SQLite ATTACH and INSERT OR REPLACE
        $updateSql = @"
ATTACH DATABASE '$script:ScumDbPath' AS scum_source;
"@
        
        foreach ($table in $tableList) {
            if ($table.Trim() -ne '') {
                $updateSql += "`nINSERT OR REPLACE INTO $table SELECT * FROM scum_source.$table;"
            }
        }
        
        $updateSql += "`nDETACH DATABASE scum_source;"
        
        # Execute update
        $tempSqlFile = Join-Path $env:TEMP "update_server_db.sql"
        $updateSql | Out-File -FilePath $tempSqlFile -Encoding UTF8
        
        & $script:SqlitePath $script:ServerDbPath ".read $tempSqlFile" | Out-Null
        Remove-Item $tempSqlFile -Force -ErrorAction SilentlyContinue
        
        if ($LASTEXITCODE -eq 0) {
            Write-Log "[ServerDB] Database updated successfully" -Level Info
            return $true
        } else {
            Write-Log "[ServerDB] Error during database update (exit code: $LASTEXITCODE)" -Level Error
            return $false
        }
        
    } catch {
        Write-Log "[ServerDB] Error updating database: $($_.Exception.Message)" -Level Error
        return $false
    }
}

# ===============================================================
# UTILITY FUNCTIONS
# ===============================================================

function Get-ServerDatabasePath {
    <#
    .SYNOPSIS
    Get the path to the server database
    .RETURNS
    Path to server_database.db
    #>
    # Return the configured path even if the file doesn't exist yet
    if ($script:ServerDbPath) {
        return $script:ServerDbPath
    } else {
        # Fallback if not initialized yet
        return ".\data\server_database.db"
    }
}

function Set-AllPlayersOffline {
    <#
    .SYNOPSIS
    Mark all players as offline in the database (for server restart)
    #>
    try {
        if (-not $script:ServerDbPath -or -not (Test-Path $script:ServerDbPath)) {
            Write-Log "[ServerDB] Database not available for setting players offline" -Level Warning
            return $false
        }
        
        if (-not $script:SqlitePath -or -not (Test-Path $script:SqlitePath)) {
            Write-Log "[ServerDB] SQLite executable not available" -Level Warning
            return $false
        }
        
        Write-Log "[ServerDB] Setting all players offline before server start..." -Level Info
        
        $updateSql = @"
UPDATE a_user_profile 
SET user_is_online = 0,
    last_logout_time = datetime('now'),
    last_update = CURRENT_TIMESTAMP
WHERE user_is_online = 1;
"@
        
        # Execute SQL command
        $tempSqlFile = [System.IO.Path]::GetTempFileName() + ".sql"
        Set-Content -Path $tempSqlFile -Value $updateSql -Encoding UTF8
        
        try {
            $result = & $script:SqlitePath $script:ServerDbPath ".read $tempSqlFile" 2>&1
            if ($LASTEXITCODE -eq 0) {
                # Count how many players were updated
                $countSql = "SELECT changes();"
                $countResult = & $script:SqlitePath $script:ServerDbPath $countSql 2>&1
                if ($LASTEXITCODE -eq 0 -and $countResult -match "^\d+$") {
                    $playersUpdated = [int]$countResult
                    if ($playersUpdated -gt 0) {
                        Write-Log "[ServerDB] Set $playersUpdated players offline" -Level Info
                    } else {
                        Write-Log "[ServerDB] No online players found to update" -Level Debug
                    }
                } else {
                    Write-Log "[ServerDB] All players set offline (count unknown)" -Level Info
                }
                return $true
            } else {
                Write-Log "[ServerDB] Failed to set players offline (exit code: $LASTEXITCODE): $result" -Level Error
                return $false
            }
        } finally {
            # Clean up temp file
            if (Test-Path $tempSqlFile) {
                Remove-Item $tempSqlFile -Force -ErrorAction SilentlyContinue
            }
        }
        
    } catch {
        Write-Log "[ServerDB] Error setting players offline: $($_.Exception.Message)" -Level Error
        return $false
    }
}

Export-ModuleMember -Function @('Initialize-ServerDatabase', 'Update-ServerDatabase', 'Get-ServerDatabasePath', 'Set-AllPlayersOffline')
