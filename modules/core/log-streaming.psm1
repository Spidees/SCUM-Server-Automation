# ===============================================================
# SCUM Server Automation - Log Streaming Helper
# ===============================================================
# Memory-efficient streaming log reader - eliminates memory leaks
# from Get-Content usage on large log files
# ===============================================================

function Read-LogStreamLines {
    <#
    .SYNOPSIS
    Memory-efficient streaming reader for SCUM log files
    
    .DESCRIPTION
    Reads only new lines from log files without loading entire file into memory.
    Prevents massive memory leaks from Get-Content usage.
    
    .PARAMETER FilePath
    Path to the log file
    
    .PARAMETER LastLineNumber
    Starting line number (lines already processed)
    
    .PARAMETER Encoding
    File encoding (default: Unicode for SCUM logs)
    
    .OUTPUTS
    Hashtable with NewLines array and TotalLines count
    #>
    param(
        [string]$FilePath,
        [int]$LastLineNumber = 0,
        [System.Text.Encoding]$Encoding = [System.Text.Encoding]::Unicode
    )
    
    $result = @{
        NewLines = @()
        TotalLines = $LastLineNumber
        Success = $false
    }
    
    if (-not (Test-Path $FilePath)) {
        return $result
    }
    
    $streamReader = $null
    $fileStream = $null
    
    try {
        # Open file with proper sharing to allow SCUM to continue writing
        $fileStream = [System.IO.FileStream]::new($FilePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $streamReader = [System.IO.StreamReader]::new($fileStream, $Encoding)
        
        $currentLineNumber = 0
        # MEMORY LEAK FIX: Use ArrayList instead of array +=
        $newLinesList = [System.Collections.ArrayList]::new()
        
        # Skip lines we've already processed
        while ($currentLineNumber -lt $LastLineNumber -and -not $streamReader.EndOfStream) {
            $streamReader.ReadLine() | Out-Null
            $currentLineNumber++
        }
        
        # Read new lines
        while (-not $streamReader.EndOfStream) {
            $line = $streamReader.ReadLine()
            if ($line -ne $null) {
                [void]$newLinesList.Add($line)
                $currentLineNumber++
            }
        }
        
        $result.NewLines = $newLinesList.ToArray()
        $result.TotalLines = $currentLineNumber
        $result.Success = $true
        
    } catch {
        Write-Log "Error reading log stream $FilePath : $($_.Exception.Message)" -Level "Warning"
    } finally {
        if ($streamReader) { 
            $streamReader.Close()
            $streamReader.Dispose()
        }
        if ($fileStream) { 
            $fileStream.Close()
            $fileStream.Dispose()
        }
        
        # Force cleanup
        [System.GC]::Collect()
        [System.GC]::WaitForPendingFinalizers()
    }
    
    return $result
}

function Get-LogFileLineCount {
    <#
    .SYNOPSIS
    Get total line count of a log file using streaming
    
    .DESCRIPTION
    Counts lines in a log file without loading entire file into memory.
    Used for initialization of log position.
    
    .PARAMETER FilePath
    Path to the log file
    
    .PARAMETER Encoding
    File encoding (default: Unicode for SCUM logs)
    
    .OUTPUTS
    Integer line count
    #>
    param(
        [string]$FilePath,
        [System.Text.Encoding]$Encoding = [System.Text.Encoding]::Unicode
    )
    
    if (-not (Test-Path $FilePath)) {
        return 0
    }
    
    $streamReader = $null
    $fileStream = $null
    $lineCount = 0
    
    try {
        $fileStream = [System.IO.FileStream]::new($FilePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $streamReader = [System.IO.StreamReader]::new($fileStream, $Encoding)
        
        while (-not $streamReader.EndOfStream) {
            $streamReader.ReadLine() | Out-Null
            $lineCount++
        }
        
    } catch {
        Write-Log "Error counting lines in $FilePath : $($_.Exception.Message)" -Level "Warning"
    } finally {
        if ($streamReader) { 
            $streamReader.Close()
            $streamReader.Dispose()
        }
        if ($fileStream) { 
            $fileStream.Close()
            $fileStream.Dispose()
        }
        
        # Force cleanup
        [System.GC]::Collect()
        [System.GC]::WaitForPendingFinalizers()
    }
    
    return $lineCount
}

# Export functions
Export-ModuleMember -Function @(
    'Read-LogStreamLines',
    'Get-LogFileLineCount'
)
