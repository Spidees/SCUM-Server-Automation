# ===============================================================
# SCUM Server Automation - Discord Scheduled Tasks
# ===============================================================
# Handles delayed execution of admin commands (restart, stop, update)
# Provides countdown notifications and task cancellation
# ===============================================================

# Standard import of common module
try {
    $helperPath = Join-Path $PSScriptRoot "..\..\core\module-helper.psm1"
    if (Test-Path $helperPath) {
        Import-Module $helperPath -Force -ErrorAction SilentlyContinue
        Import-CommonModule | Out-Null
    }
} catch {
    Write-Host "[WARNING] Common module not available for discord-scheduled-tasks module" -ForegroundColor Yellow
}

# Module variables
$script:ScheduledTasks = @{}
$script:TaskConfig = $null

function Initialize-ScheduledTasksModule {
    <#
    .SYNOPSIS
    Initialize the scheduled tasks module
    .PARAMETER Config
    Configuration object
    #>
    param(
        [Parameter(Mandatory)]
        [object]$Config
    )
    
    $script:TaskConfig = $Config
    $script:ScheduledTasks = @{}
    Write-Log "Scheduled tasks module initialized" -Level "Info"
}

function Add-ScheduledTask {
    <#
    .SYNOPSIS
    Add a new scheduled task
    .PARAMETER TaskType
    Type of task (stop, restart, update)
    .PARAMETER DelayMinutes
    Minutes to wait before execution
    .PARAMETER ResponseChannelId
    Discord channel to send responses to
    .PARAMETER UserId
    User who scheduled the task
    #>
    param(
        [Parameter(Mandatory)]
        [ValidateSet('stop', 'restart', 'update')]
        [string]$TaskType,
        
        [Parameter(Mandatory)]
        [int]$DelayMinutes,
        
        [Parameter(Mandatory)]
        [string]$ResponseChannelId,
        
        [Parameter(Mandatory)]
        [string]$UserId
    )
    
    # Cancel any existing tasks of the same type
    Cancel-ScheduledTask -TaskType $TaskType -Silent
    
    # Calculate execution time
    $executionTime = (Get-Date).AddMinutes($DelayMinutes)
    
    # Create task object
    $task = @{
        Type = $TaskType
        ExecutionTime = $executionTime
        DelayMinutes = $DelayMinutes
        ResponseChannelId = $ResponseChannelId
        UserId = $UserId
        Created = Get-Date
        WarningSent = @{
            '5min' = $false
            '1min' = $false
        }
    }
    
    $script:ScheduledTasks[$TaskType] = $task
    
    Write-Log "Added $TaskType task for $DelayMinutes minutes (execution: $executionTime)" -Level "Info"
    
    return $task
}

function Cancel-ScheduledTask {
    <#
    .SYNOPSIS
    Cancel a scheduled task
    .PARAMETER TaskType
    Type of task to cancel (optional, cancels all if not specified)
    .PARAMETER Silent
    Don't log cancellation if true
    #>
    param(
        [Parameter()]
        [ValidateSet('stop', 'restart', 'update')]
        [string]$TaskType,
        
        [Parameter()]
        [switch]$Silent
    )
    
    if ($TaskType) {
        if ($script:ScheduledTasks.ContainsKey($TaskType)) {
            $script:ScheduledTasks.Remove($TaskType)
            if (-not $Silent) {
                Write-Log "Cancelled $TaskType task" -Level "Info"
            }
            return $true
        }
        return $false
    } else {
        # Cancel all tasks
        $cancelledCount = $script:ScheduledTasks.Count
        $script:ScheduledTasks.Clear()
        if (-not $Silent) {
            Write-Log "Cancelled $cancelledCount scheduled tasks" -Level "Info"
        }
        return $cancelledCount -gt 0
    }
}

function Process-ScheduledTasks {
    <#
    .SYNOPSIS
    Process all scheduled tasks - check for warnings and executions
    #>
    
    $currentTime = Get-Date
    $tasksToRemove = @()
    
    foreach ($taskType in $script:ScheduledTasks.Keys) {
        $task = $script:ScheduledTasks[$taskType]
        
        # Check if task should be executed
        if ($currentTime -ge $task.ExecutionTime) {
            Execute-ScheduledTask -Task $task
            $tasksToRemove += $taskType
            continue
        }
        
        # Check for warnings (5 minutes and 1 minute before execution)
        $timeUntilExecution = $task.ExecutionTime - $currentTime
        
        # 5 minute warning
        if ($timeUntilExecution.TotalMinutes -le 5 -and $timeUntilExecution.TotalMinutes -gt 4 -and -not $task.WarningSent['5min']) {
            Send-TaskWarning -Task $task -MinutesRemaining 5
            $task.WarningSent['5min'] = $true
        }
        
        # 1 minute warning
        if ($timeUntilExecution.TotalMinutes -le 1 -and $timeUntilExecution.TotalMinutes -gt 0 -and -not $task.WarningSent['1min']) {
            Send-TaskWarning -Task $task -MinutesRemaining 1
            $task.WarningSent['1min'] = $true
        }
    }
    
    # Remove completed tasks
    foreach ($taskType in $tasksToRemove) {
        $script:ScheduledTasks.Remove($taskType)
    }
}

function Send-TaskWarning {
    <#
    .SYNOPSIS
    Send warning notification before task execution
    .PARAMETER Task
    Task object
    .PARAMETER MinutesRemaining
    Minutes remaining until execution
    #>
    param(
        [Parameter(Mandatory)]
        [hashtable]$Task,
        
        [Parameter(Mandatory)]
        [int]$MinutesRemaining
    )
    
    $actionName = switch ($Task.Type) {
        'stop' { 'stop' }
        'restart' { 'restart' }
        'update' { 'update' }
    }
    
    try {
        # Send notification to players channel and role ping (but NOT to admin channel to avoid spam)
        if (Get-Command "Send-DiscordNotification" -ErrorAction SilentlyContinue) {
            $notificationType = switch ($Task.Type) {
                'stop' { 'manualStopWarning' }
                'restart' { 'manualRestartWarning' }
                'update' { 'manualUpdateWarning' }
            }
            
            Send-DiscordNotification -Type $notificationType -Data @{ 
                minutes = $MinutesRemaining
                action = $actionName
            }
        }
        
        Write-Log "Sent $MinutesRemaining minute warning for $($Task.Type) to players" -Level "Info"
        
    } catch {
        Write-Log "[SCHEDULED-TASKS] Failed to send task warning: $($_.Exception.Message)" -Level Error
    }
}

function Execute-ScheduledTask {
    <#
    .SYNOPSIS
    Execute a scheduled task
    .PARAMETER Task
    Task object to execute
    #>
    param(
        [Parameter(Mandatory)]
        [hashtable]$Task
    )
    
    $actionEmoji = switch ($Task.Type) {
        'stop' { ':stop_sign:' }
        'restart' { ':arrows_counterclockwise:' }
        'update' { ':arrow_up:' }
    }
    
    $actionName = switch ($Task.Type) {
        'stop' { 'stopping' }
        'restart' { 'restarting' }
        'update' { 'updating' }
    }
    
    try {
        # Send execution notification
        $executionMessage = "$actionEmoji **Executing** - Server is now $actionName..."
        
        if (Get-Command "Send-DiscordMessage" -ErrorAction SilentlyContinue) {
            Send-DiscordMessage -ChannelId $Task.ResponseChannelId -Content $executionMessage
        }
        
        # Execute the actual command
        switch ($Task.Type) {
            'stop' {
                if (Get-Command "Stop-ServerService" -ErrorAction SilentlyContinue) {
                    Stop-ServerService
                    Write-Log "Executed scheduled server stop" -Level "Info"
                } else {
                    Write-Log "[SCHEDULED-TASKS] Stop-ServerService function not available" -Level Warning
                }
            }
            'restart' {
                if (Get-Command "Restart-ServerService" -ErrorAction SilentlyContinue) {
                    Restart-ServerService
                    Write-Log "Executed scheduled server restart" -Level "Info"
                } else {
                    Write-Log "[SCHEDULED-TASKS] Restart-ServerService function not available" -Level Warning
                }
            }
            'update' {
                if (Get-Command "Update-ServerInstallation" -ErrorAction SilentlyContinue) {
                    Update-ServerInstallation
                    Write-Log "Executed scheduled server update" -Level "Info"
                } else {
                    Write-Log "[SCHEDULED-TASKS] Update-ServerInstallation function not available" -Level Warning
                }
            }
        }
        
    } catch {
        Write-Log "[SCHEDULED-TASKS] Error executing scheduled $($Task.Type): $($_.Exception.Message)" -Level Error
        
        # Send error notification
        if (Get-Command "Send-DiscordMessage" -ErrorAction SilentlyContinue) {
            Send-DiscordMessage -ChannelId $Task.ResponseChannelId -Content ":x: **Error** - Failed to execute scheduled $($Task.Type): $($_.Exception.Message)"
        }
    }
}

function Get-ScheduledTasks {
    <#
    .SYNOPSIS
    Get all scheduled tasks
    .RETURNS
    Hashtable of scheduled tasks
    #>
    
    return $script:ScheduledTasks
}

# Export functions
Export-ModuleMember -Function @(
    'Initialize-ScheduledTasksModule',
    'Add-ScheduledTask',
    'Cancel-ScheduledTask', 
    'Process-ScheduledTasks',
    'Get-ScheduledTasks'
)
