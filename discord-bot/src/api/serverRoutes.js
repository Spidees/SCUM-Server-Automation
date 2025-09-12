const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { writeLog, addScheduledOperation, getScheduledOperations, removeScheduledOperations, removeScheduledOperationByScheduleId } = require('../utils/utils');
const { getDb } = require('../utils/database');
const CONFIG = require('../config/config');

const router = express.Router();

// Get paths from configuration
const AUTOMATION_SCRIPT = path.join(CONFIG.rootDir, 'SCUM-Server-Automation.ps1');
const AUTOMATION_WORKING_DIR = CONFIG.rootDir;

// Function to get service name from config file
function getServiceName() {
    try {
        const fs = require('fs');
        const configPath = path.join(CONFIG.rootDir, 'SCUM-Server-Automation.config.json');
        const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return configData.serviceName || 'SCUMSERVER'; // fallback to default
    } catch (error) {
        writeLog(`Error reading service name from config: ${error.message}`, 'Error');
        return 'SCUMSERVER'; // fallback to default
    }
}

// Server restart endpoint
router.post('/restart', async (req, res) => {
    try {
        const { delay = 0, admin = 'Unknown', user_id } = req.body;
        const serviceName = getServiceName();
        
        const scheduleId = `restart_${Date.now()}`;
        const scheduledTime = new Date(Date.now() + delay * 1000);
        
        // Add to scheduled operations
        const operation = addScheduledOperation({
            type: 'restart',
            admin: admin,
            user_id: user_id,
            scheduleId: scheduleId,
            scheduledTime: scheduledTime.toISOString(),
            delay: delay
        });
        
        // If immediate, execute now, otherwise schedule
        if (delay === 0) {
            exec(`powershell.exe -Command "& { Import-Module '${path.join(AUTOMATION_WORKING_DIR, 'modules', 'server', 'service', 'service.psm1')}' -Force; Restart-GameService -ServiceName '${serviceName}' }"`, 
                { cwd: AUTOMATION_WORKING_DIR }, 
                (error, stdout, stderr) => {
                    if (error) {
                        writeLog(`Restart execution error: ${error.message}`, 'Error');
                    } else {
                        writeLog(`Server restart executed by ${admin}`, 'Debug');
                    }
                }
            );
        } else {
            // Schedule for later execution
            setTimeout(() => {
                exec(`powershell.exe -Command "& { Import-Module '${path.join(AUTOMATION_WORKING_DIR, 'modules', 'server', 'service', 'service.psm1')}' -Force; Restart-GameService -ServiceName '${serviceName}' }"`, 
                    { cwd: AUTOMATION_WORKING_DIR }, 
                    (error, stdout, stderr) => {
                        if (error) {
                            writeLog(`Scheduled restart error: ${error.message}`, 'Error');
                        } else {
                            writeLog(`Scheduled server restart executed by ${admin}`, 'Debug');
                        }
                        // Remove from scheduled operations after execution
                        removeScheduledOperationByScheduleId(scheduleId);
                    }
                );
            }, delay * 1000);
        }
        
        writeLog(`API: Server restart scheduled by ${admin} (${user_id}) with ${delay}s delay`, 'Debug');
        
        res.json({ 
            success: true, 
            scheduleId,
            delay,
            scheduledTime: scheduledTime.toISOString()
        });
    } catch (error) {
        writeLog(`Server restart API error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to schedule restart' });
    }
});

// Server stop endpoint  
router.post('/stop', async (req, res) => {
    try {
        const { delay = 0, admin = 'Unknown', user_id } = req.body;
        const serviceName = getServiceName();
        
        const scheduleId = `stop_${Date.now()}`;
        const scheduledTime = new Date(Date.now() + delay * 1000);
        
        // Add to scheduled operations
        const operation = addScheduledOperation({
            type: 'stop',
            admin: admin,
            user_id: user_id,
            scheduleId: scheduleId,
            scheduledTime: scheduledTime.toISOString(),
            delay: delay
        });
        
        // If immediate, execute now, otherwise schedule
        if (delay === 0) {
            exec(`powershell.exe -Command "& { Import-Module '${path.join(AUTOMATION_WORKING_DIR, 'modules', 'server', 'service', 'service.psm1')}' -Force; Stop-GameService -ServiceName '${serviceName}' }"`, 
                { cwd: AUTOMATION_WORKING_DIR }, 
                (error, stdout, stderr) => {
                    if (error) {
                        writeLog(`Stop execution error: ${error.message}`, 'Error');
                    } else {
                        writeLog(`Server stop executed by ${admin}`, 'Debug');
                    }
                }
            );
        } else {
            setTimeout(() => {
                exec(`powershell.exe -Command "& { Import-Module '${path.join(AUTOMATION_WORKING_DIR, 'modules', 'server', 'service', 'service.psm1')}' -Force; Stop-GameService -ServiceName '${serviceName}' }"`, 
                    { cwd: AUTOMATION_WORKING_DIR }, 
                    (error, stdout, stderr) => {
                        if (error) {
                            writeLog(`Scheduled stop error: ${error.message}`, 'Error');
                        } else {
                            writeLog(`Scheduled server stop executed by ${admin}`, 'Debug');
                        }
                        removeScheduledOperationByScheduleId(scheduleId);
                    }
                );
            }, delay * 1000);
        }
        
        writeLog(`API: Server stop scheduled by ${admin} (${user_id}) with ${delay}s delay`, 'Debug');
        
        res.json({ 
            success: true, 
            scheduleId,
            delay,
            scheduledTime: scheduledTime.toISOString()
        });
    } catch (error) {
        writeLog(`Server stop API error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to schedule stop' });
    }
});

// Server start endpoint
router.post('/start', async (req, res) => {
    try {
        const { admin = 'Unknown', user_id } = req.body;
        const serviceName = getServiceName();
        
        writeLog(`API: Server start initiated by ${admin} (${user_id})`, 'Debug');
        
        // Execute start command via PowerShell - use new process with -StartServer parameter
        exec(`powershell.exe -Command "& { Import-Module '${path.join(AUTOMATION_WORKING_DIR, 'modules', 'server', 'service', 'service.psm1')}' -Force; Start-GameService -ServiceName '${serviceName}' }"`, 
            { cwd: AUTOMATION_WORKING_DIR }, 
            (error, stdout, stderr) => {
                if (error) {
                    writeLog(`Start execution error: ${error.message}`, 'Error');
                } else {
                    writeLog(`Server start executed by ${admin}`, 'Debug');
                }
            }
        );
        
        res.json({ 
            success: true, 
            startedAt: new Date().toISOString()
        });
    } catch (error) {
        writeLog(`Server start API error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to start server' });
    }
});

// Server update endpoint
router.post('/update', async (req, res) => {
    try {
        const { delay = 0, admin = 'Unknown', user_id } = req.body;
        
        writeLog(`API: Server update scheduled by ${admin} (${user_id}) with ${delay}s delay`, 'Debug');
        
        // Get configuration for update parameters
        let config;
        try {
            const configPath = path.join(AUTOMATION_WORKING_DIR, 'SCUM-Server-Automation.config.json');
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (error) {
            writeLog(`Failed to read configuration: ${error.message}`, 'Error');
            res.status(500).json({ error: 'Configuration file not accessible' });
            return;
        }
        
        // Prepare parameters for update
        const steamCmdPath = path.join(AUTOMATION_WORKING_DIR, config.steamCmd);
        const serverDirectory = path.join(AUTOMATION_WORKING_DIR, config.serverDir);
        const appId = config.appId;
        const serviceName = config.serviceName;
        
        const scheduleId = `update_${Date.now()}`;
        const scheduledTime = new Date(Date.now() + delay * 1000);
        
        // Add to scheduled operations
        const operation = addScheduledOperation({
            type: 'update',
            admin: admin,
            user_id: user_id,
            scheduleId: scheduleId,
            scheduledTime: scheduledTime.toISOString(),
            delay: delay
        });
        
        // Return immediate response
        res.json({ 
            success: true, 
            scheduleId,
            delay,
            scheduledTime: scheduledTime.toISOString(),
            updateStarted: new Date().toISOString()
        });
        
        // Function to execute update
        const executeUpdate = () => {
            const psCommand = `
                Import-Module '${path.join(AUTOMATION_WORKING_DIR, 'modules', 'core', 'common', 'common.psm1')}' -Force;
                Import-Module '${path.join(AUTOMATION_WORKING_DIR, 'modules', 'server', 'service', 'service.psm1')}' -Force;
                Import-Module '${path.join(AUTOMATION_WORKING_DIR, 'modules', 'automation', 'update', 'update.psm1')}' -Force;
                $result = Invoke-ImmediateUpdate -SteamCmdPath '${steamCmdPath}' -ServerDirectory '${serverDirectory}' -AppId '${appId}' -ServiceName '${serviceName}';
                $result | ConvertTo-Json -Depth 2
            `.replace(/\s+/g, ' ').trim();
            
            // Send update started notification
            const notificationHandler = require('../utils/notificationHandler');
            notificationHandler.sendNotification('update.started', {
                currentVersion: 'Unknown',
                targetVersion: 'Latest'
            });
            
            // Execute update in background with completion notification
            exec(`powershell.exe -Command "& { ${psCommand} }"`, 
                { cwd: AUTOMATION_WORKING_DIR, timeout: 600000 }, // 10 minute timeout
                (error, stdout, stderr) => {
                    // Remove from scheduled operations after execution
                    removeScheduledOperationByScheduleId(scheduleId);
                    
                    if (error) {
                        writeLog(`Update execution error: ${error.message}`, 'Error');
                        // Send failure notification if not already sent by PowerShell
                        notificationHandler.sendNotification('update.failed', {
                            error: error.message,
                            admin: admin
                        });
                    } else {
                        writeLog(`Server update completed by ${admin}`, 'Debug');
                        try {
                            const result = JSON.parse(stdout);
                            if (result && result.Success) {
                                if (result.Error === "No update available") {
                                    writeLog('No update available - server is already up to date', 'Debug');
                                    // Send info notification instead of success
                                    notificationHandler.sendNotification('update.completed', {
                                        version: 'Current',
                                        previousVersion: 'Current',
                                        duration: 'N/A',
                                        message: 'Server is already up to date'
                                    });
                                } else {
                                    writeLog(`Update successful - backup: ${result.BackupCreated}, update: ${result.UpdateCompleted}, service: ${result.ServiceRestarted}`, 'Debug');
                                    // Send success notification
                                    notificationHandler.sendNotification('update.completed', {
                                        version: 'Latest',
                                        previousVersion: 'Previous',
                                        duration: 'N/A'
                                    });
                                }
                            } else {
                                writeLog(`Update failed: ${result?.Error || 'Unknown error'}`, 'Error');
                                // Send failure notification
                                notificationHandler.sendNotification('update.failed', {
                                    error: result?.Error || 'Unknown error',
                                    admin: admin
                                });
                            }
                        } catch (parseError) {
                            writeLog(`Update result parsing error: ${parseError.message}`, 'Warning');
                            writeLog(`PowerShell output: ${stdout}`, 'Debug');
                            // Send completion notification even if parsing failed
                            notificationHandler.sendNotification('update.completed', {
                                version: 'Latest',
                                previousVersion: 'Previous', 
                                duration: 'N/A'
                            });
                        }
                    }
                }
            );
        };
        
        // If immediate, execute now, otherwise schedule with warnings
        if (delay === 0) {
            executeUpdate();
        } else {
            // Get player count for warnings
            const db = getDb();
            db.get('SELECT COUNT(*) as count FROM a_user_profile WHERE user_is_online = 1', (err, playerCount) => {
                
                // Schedule warning notifications
                const notificationHandler = require('../utils/notificationHandler');
                const delayMinutes = Math.floor(delay / 60);
                
                // Warning at 15 minutes if delay is >= 15 minutes
                if (delayMinutes >= 15) {
                    setTimeout(() => {
                        notificationHandler.sendNotification('updateWarning15', {});
                    }, (delay - 15 * 60) * 1000);
                }
                
                // Warning at 5 minutes if delay is >= 5 minutes
                if (delayMinutes >= 5) {
                    setTimeout(() => {
                        notificationHandler.sendNotification('updateWarning5', {});
                    }, (delay - 5 * 60) * 1000);
                }
                
                // Warning at 1 minute if delay is >= 1 minute
                if (delayMinutes >= 1) {
                    setTimeout(() => {
                        notificationHandler.sendNotification('updateWarning1', {});
                    }, (delay - 60) * 1000);
                }
                
                // Schedule the actual update
                setTimeout(() => {
                    executeUpdate();
                }, delay * 1000);
            });
        }
        
    } catch (error) {
        writeLog(`Server update API error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to schedule update' });
    }
});

// Server status endpoint
router.get('/status', async (req, res) => {
    try {
        // Get service name from config
        const serviceName = CONFIG.serviceName || 'SCUMSERVER2';
        
        // Check if SCUM server service is running via NSSM
        exec(`sc query ${serviceName}`, (error, stdout, stderr) => {
            const isRunning = !error && stdout.includes('RUNNING');
            
            const status = {
                running: isRunning,
                status: isRunning ? 'Server is running normally' : 'Server is not running',
                uptime: isRunning ? 'Service active' : 'N/A',
                performance: isRunning ? 'Monitoring active' : 'N/A',
                serviceName: serviceName,
                lastCheck: new Date().toISOString()
            };
            
            res.json(status);
        });
    } catch (error) {
        writeLog(`Server status API error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to get server status' });
    }
});

// Server player count endpoint
router.get('/players', async (req, res) => {
    try {
        const db = getDb();
        
        db.get('SELECT COUNT(*) as count FROM a_user_profile WHERE user_is_online = 1', (err, row) => {
            if (err) {
                writeLog(`Player count query error: ${err.message}`, 'Error');
                return res.status(500).json({ error: 'Database error' });
            }
            
            res.json({
                online: row.count || 0,
                maxPlayers: 128,
                timestamp: new Date().toISOString()
            });
        });
    } catch (error) {
        writeLog(`Player count API error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to get player count' });
    }
});

// Server validate endpoint
router.post('/validate', async (req, res) => {
    try {
        const { admin = 'Unknown', user_id } = req.body;
        
        writeLog(`API: Server validation initiated by ${admin} (${user_id})`, 'Debug');
        
        // Get configuration for validation parameters
        let config;
        try {
            const configPath = path.join(AUTOMATION_WORKING_DIR, 'SCUM-Server-Automation.config.json');
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (error) {
            writeLog(`Failed to read configuration: ${error.message}`, 'Error');
            res.status(500).json({ error: 'Configuration file not accessible' });
            return;
        }
        
        // Prepare parameters for validation
        const steamCmdPath = path.join(AUTOMATION_WORKING_DIR, config.steamCmd);
        const serverDirectory = path.join(AUTOMATION_WORKING_DIR, config.serverDir);
        const appId = config.appId;
        const serviceName = config.serviceName;
        
        // Call PowerShell module to validate server files
        const psCommand = `
            Import-Module '${path.join(AUTOMATION_WORKING_DIR, 'modules', 'core', 'common', 'common.psm1')}' -Force;
            Import-Module '${path.join(AUTOMATION_WORKING_DIR, 'modules', 'server', 'service', 'service.psm1')}' -Force;
            Import-Module '${path.join(AUTOMATION_WORKING_DIR, 'modules', 'automation', 'update', 'update.psm1')}' -Force;
            Invoke-ServerValidation -SteamCmdPath '${steamCmdPath}' -ServerDirectory '${serverDirectory}' -AppId '${appId}' -ServiceName '${serviceName}'
        `.replace(/\s+/g, ' ').trim();
        exec(`powershell.exe -Command "& { ${psCommand} }"`, 
            { cwd: AUTOMATION_WORKING_DIR }, 
            (error, stdout, stderr) => {
                if (error) {
                    writeLog(`Server validation error: ${error.message}`, 'Error');
                    res.status(500).json({ error: 'Validation script failed' });
                    return;
                }
                
                const result = {
                    valid: !stderr && !error,
                    filesChecked: 'Completed',
                    issues: stderr ? [stderr] : [],
                    output: stdout,
                    validatedAt: new Date().toISOString()
                };
                
                res.json(result);
            }
        );
        
    } catch (error) {
        writeLog(`Server validate API error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to validate server' });
    }
});

// Server backup endpoint
router.post('/backup', async (req, res) => {
    try {
        const { admin = 'Unknown', user_id } = req.body;
        
        writeLog(`API: Server backup initiated by ${admin} (${user_id})`, 'Debug');
        
        // Get configuration for backup parameters
        let config;
        try {
            const configPath = path.join(AUTOMATION_WORKING_DIR, 'SCUM-Server-Automation.config.json');
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (error) {
            writeLog(`Failed to read configuration: ${error.message}`, 'Error');
            res.status(500).json({ error: 'Configuration file not accessible' });
            return;
        }
        
        // Prepare backup parameters from configuration
        const savedDir = path.join(AUTOMATION_WORKING_DIR, config.savedDir || 'server/Saved');
        const backupRoot = path.join(AUTOMATION_WORKING_DIR, config.backupRoot || 'backups');
        const maxBackups = config.maxBackups || 10;
        const compressBackups = config.compressBackups !== false; // default true
        
        // Return immediate response and run backup in background
        res.json({ 
            success: true,
            backupName: `SCUM_Backup_${new Date().toISOString().replace(/[:]/g, '-').split('.')[0]}`,
            path: 'backups/',
            createdAt: new Date().toISOString()
        });
        
        // Send backup started notification
        const notificationHandler = require('../utils/notificationHandler');
        notificationHandler.sendNotification('backup.started', {
            type: 'manual'
        });
        
        // Execute backup via PowerShell module with proper result handling
        const psCommand = `
            Import-Module '${path.join(AUTOMATION_WORKING_DIR, 'modules', 'core', 'common', 'common.psm1')}' -Force;
            Import-Module '${path.join(AUTOMATION_WORKING_DIR, 'modules', 'automation', 'backup', 'backup.psm1')}' -Force;
            $startTime = Get-Date;
            $result = Invoke-GameBackup -SourcePath '${savedDir}' -BackupRoot '${backupRoot}' -MaxBackups ${maxBackups} -CompressBackups $${compressBackups} -Type 'manual' 6>$null;
            $endTime = Get-Date;
            $duration = ($endTime - $startTime).ToString('mm\\:ss');
            $output = @{
                Success = $result;
                Duration = $duration;
                StartTime = $startTime.ToString('yyyy-MM-dd HH:mm:ss');
                EndTime = $endTime.ToString('yyyy-MM-dd HH:mm:ss');
            };
            if ($result) {
                $latestBackup = Get-ChildItem '${backupRoot}' -Filter '*BACKUP*.zip' | Sort-Object LastWriteTime -Descending | Select-Object -First 1;
                if ($latestBackup) {
                    $sizeMB = [Math]::Round($latestBackup.Length / 1MB, 2);
                    $output.Size = $sizeMB.ToString() + ' MB';
                    $output.BackupFile = $latestBackup.Name;
                }
            }
            $output | ConvertTo-Json -Depth 2
        `.replace(/\s+/g, ' ').trim();
        
        exec(`powershell.exe -Command "& { ${psCommand} }"`, 
            { cwd: AUTOMATION_WORKING_DIR, timeout: 300000 }, // 5 minute timeout
            (error, stdout, stderr) => {
                if (error) {
                    writeLog(`Backup execution error: ${error.message}`, 'Error');
                    // Send failure notification
                    const notificationHandler = require('../utils/notificationHandler');
                    notificationHandler.sendNotification('backup.failed', {
                        error: error.message,
                        admin: admin
                    });
                } else {
                    writeLog(`Server backup completed by ${admin}`, 'Debug');
                    const notificationHandler = require('../utils/notificationHandler');
                    try {
                        // Extract JSON from output (PowerShell may include log messages)
                        let jsonString = stdout;
                        const jsonStart = stdout.indexOf('{');
                        const jsonEnd = stdout.lastIndexOf('}');
                        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                            jsonString = stdout.substring(jsonStart, jsonEnd + 1);
                        }
                        
                        const result = JSON.parse(jsonString);
                        if (result && result.Success) {
                            writeLog(`Backup completed successfully - Size: ${result.Size || 'Unknown'}, Duration: ${result.Duration || 'Unknown'}`, 'Debug');
                            // Send success notification with real data
                            notificationHandler.sendNotification('backup.completed', {
                                type: 'manual',
                                size: result.Size || 'Unknown',
                                duration: result.Duration || 'Unknown'
                            });
                        } else {
                            writeLog('Backup failed (PowerShell returned false)', 'Error');
                            // Send failure notification
                            notificationHandler.sendNotification('backup.failed', {
                                error: 'Backup operation failed',
                                admin: admin
                            });
                        }
                    } catch (parseError) {
                        writeLog(`Backup result parsing error: ${parseError.message}`, 'Warning');
                        writeLog(`PowerShell output: ${stdout}`, 'Debug');
                        // Send generic completion notification
                        notificationHandler.sendNotification('backup.completed', {
                            type: 'manual',
                            size: 'Unknown',
                            duration: 'Unknown'
                        });
                    }
                }
                if (stderr) {
                    writeLog(`Backup stderr: ${stderr}`, 'Warning');
                }
            }
        );
    } catch (error) {
        writeLog(`Server backup API error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to create backup' });
    }
});

// Get scheduled operations
router.get('/scheduled', async (req, res) => {
    try {
        const scheduled = getScheduledOperations();
        res.json({ scheduled });
    } catch (error) {
        writeLog(`Scheduled operations API error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to get scheduled operations' });
    }
});

// Cancel scheduled operations
router.post('/cancel', async (req, res) => {
    try {
        const { operationIds = [], admin = 'Unknown', user_id } = req.body;
        
        const cancelledCount = removeScheduledOperations(operationIds);
        
        writeLog(`API: ${cancelledCount} operations cancelled by ${admin} (${user_id}) - IDs: ${operationIds.join(', ')}`, 'Debug');
        
        res.json({ 
            success: true,
            cancelled: cancelledCount
        });
    } catch (error) {
        writeLog(`Cancel operations API error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to cancel operations' });
    }
});

// Skip next restart
router.post('/restart-skip', async (req, res) => {
    try {
        const { admin = 'Unknown', user_id } = req.body;
        
        writeLog(`API: Next restart skipped by ${admin} (${user_id})`, 'Debug');
        
        res.json({ 
            success: true,
            skippedTime: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
            nextRestart: new Date(Date.now() + 7200000).toISOString()   // 2 hours from now
        });
    } catch (error) {
        writeLog(`Restart skip API error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to skip restart' });
    }
});

// Notification endpoint for PowerShell modules
router.post('/notification', (req, res) => {
    try {
        const { type, data } = req.body;
        
        if (!type) {
            return res.status(400).json({ error: 'Notification type is required' });
        }
        
        writeLog(`Received notification from PowerShell: ${type}`, 'Debug');
        
        // Send notification via notification handler
        const notificationHandler = require('../utils/notificationHandler');
        notificationHandler.sendNotification(type, data || {});
        
        res.json({ success: true });
        
    } catch (error) {
        writeLog(`Notification API error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to process notification' });
    }
});

// Debug endpoint to refresh slash commands
router.post('/commands/refresh', async (req, res) => {
    try {
        writeLog('Manual command refresh requested', 'Debug');
        
        // We need access to the Discord client to refresh commands
        if (global.discordClient && global.refreshSlashCommands) {
            const result = await global.refreshSlashCommands();
            writeLog(`Command refresh result: ${JSON.stringify(result)}`, 'Debug');
            res.json(result);
        } else {
            writeLog('Discord client not available for command refresh', 'Warning');
            res.status(503).json({ error: 'Discord client not available' });
        }
    } catch (error) {
        writeLog(`Command refresh error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to refresh commands' });
    }
});

// Debug endpoint to test Discord API connectivity
router.get('/debug/discord-api', async (req, res) => {
    try {
        if (!global.discordClient || !global.discordClient.isReady()) {
            return res.status(503).json({ error: 'Discord client not ready' });
        }

        const { REST, Routes } = require('discord.js');
        const CONFIG = require('../config/config');
        
        const rest = new REST({ version: '10' }).setToken(CONFIG.token);
        
        // Test basic API connectivity by getting current user
        try {
            const user = await global.discordClient.user.fetch();
            writeLog(`Discord API test - Bot user: ${user.tag} (${user.id})`, 'Debug');
            
            // Test if we can reach the guild
            const guild = await global.discordClient.guilds.fetch(CONFIG.guildId);
            writeLog(`Discord API test - Guild: ${guild.name} (${guild.id})`, 'Debug');
            
            // Check bot's permissions in the guild
            const member = await guild.members.fetch(user.id);
            const permissions = member.permissions.toArray();
            writeLog(`Discord API test - Bot permissions: ${permissions.join(', ')}`, 'Debug');
            
            res.json({
                success: true,
                bot: {
                    id: user.id,
                    tag: user.tag,
                    ready: global.discordClient.isReady()
                },
                guild: {
                    id: guild.id,
                    name: guild.name,
                    memberCount: guild.memberCount
                },
                permissions: permissions,
                canManageCommands: member.permissions.has('ManageGuild') || member.permissions.has('Administrator')
            });
            
        } catch (apiError) {
            writeLog(`Discord API test failed: ${apiError.message}`, 'Error');
            res.status(500).json({ 
                error: 'Discord API test failed', 
                details: apiError.message,
                status: apiError.status,
                code: apiError.code 
            });
        }
        
    } catch (error) {
        writeLog(`Discord API debug error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to test Discord API' });
    }
});

// Debug endpoint to list current slash commands
router.get('/debug/commands/list', async (req, res) => {
    try {
        if (!global.discordClient || !global.discordClient.isReady()) {
            return res.status(503).json({ error: 'Discord client not ready' });
        }

        const CONFIG = require('../config/config');
        
        try {
            // Get current guild commands
            const guildCommands = await global.discordClient.application.commands.fetch({ guildId: CONFIG.guildId });
            
            // Get global commands
            const globalCommands = await global.discordClient.application.commands.fetch();
            
            const guildCommandList = Array.from(guildCommands.values()).map(cmd => ({
                id: cmd.id,
                name: cmd.name,
                description: cmd.description,
                options: cmd.options?.length || 0
            }));
            
            const globalCommandList = Array.from(globalCommands.values()).map(cmd => ({
                id: cmd.id,
                name: cmd.name,
                description: cmd.description,
                options: cmd.options?.length || 0
            }));
            
            writeLog(`Current commands - Guild: ${guildCommandList.length}, Global: ${globalCommandList.length}`, 'Debug');
            
            res.json({
                success: true,
                guild: {
                    id: CONFIG.guildId,
                    commands: guildCommandList,
                    count: guildCommandList.length
                },
                global: {
                    commands: globalCommandList,
                    count: globalCommandList.length
                }
            });
            
        } catch (commandError) {
            writeLog(`Failed to fetch commands: ${commandError.message}`, 'Error');
            res.status(500).json({ 
                error: 'Failed to fetch commands', 
                details: commandError.message 
            });
        }
        
    } catch (error) {
        writeLog(`Command list debug error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to list commands' });
    }
});

module.exports = router;
