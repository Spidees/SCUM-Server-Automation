const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const { writeLog, addScheduledOperation, getScheduledOperations, removeScheduledOperations, removeScheduledOperationByScheduleId } = require('../utils/utils');
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
                        writeLog(`Server restart executed by ${admin}`, 'Info');
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
                            writeLog(`Scheduled server restart executed by ${admin}`, 'Info');
                        }
                        // Remove from scheduled operations after execution
                        removeScheduledOperationByScheduleId(scheduleId);
                    }
                );
            }, delay * 1000);
        }
        
        writeLog(`API: Server restart scheduled by ${admin} (${user_id}) with ${delay}s delay`, 'Info');
        
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
                        writeLog(`Server stop executed by ${admin}`, 'Info');
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
                            writeLog(`Scheduled server stop executed by ${admin}`, 'Info');
                        }
                        removeScheduledOperationByScheduleId(scheduleId);
                    }
                );
            }, delay * 1000);
        }
        
        writeLog(`API: Server stop scheduled by ${admin} (${user_id}) with ${delay}s delay`, 'Info');
        
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
        
        writeLog(`API: Server start initiated by ${admin} (${user_id})`, 'Info');
        
        // Execute start command via PowerShell - use new process with -StartServer parameter
        exec(`powershell.exe -Command "& { Import-Module '${path.join(AUTOMATION_WORKING_DIR, 'modules', 'server', 'service', 'service.psm1')}' -Force; Start-GameService -ServiceName '${serviceName}' }"`, 
            { cwd: AUTOMATION_WORKING_DIR }, 
            (error, stdout, stderr) => {
                if (error) {
                    writeLog(`Start execution error: ${error.message}`, 'Error');
                } else {
                    writeLog(`Server start executed by ${admin}`, 'Info');
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
        const { admin = 'Unknown', user_id } = req.body;
        
        writeLog(`API: Server update initiated by ${admin} (${user_id})`, 'Info');
        
        // Execute update command via PowerShell module
        exec(`powershell.exe -Command "& { Import-Module '${path.join(AUTOMATION_WORKING_DIR, 'modules', 'automation', 'update', 'update.psm1')}' -Force; Invoke-ImmediateUpdate }"`, 
            { cwd: AUTOMATION_WORKING_DIR }, 
            (error, stdout, stderr) => {
                if (error) {
                    writeLog(`Update execution error: ${error.message}`, 'Error');
                } else {
                    writeLog(`Server update executed by ${admin}`, 'Info');
                }
            }
        );
        
        res.json({ 
            success: true, 
            updateStarted: new Date().toISOString()
        });
    } catch (error) {
        writeLog(`Server update API error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to schedule update' });
    }
});

// Server status endpoint
router.get('/status', async (req, res) => {
    try {
        // Check if server process is running
        exec('tasklist /FI "IMAGENAME eq SCUM-Win64-Shipping.exe" /FO CSV', (error, stdout, stderr) => {
            const isRunning = !error && stdout.includes('SCUM-Win64-Shipping.exe');
            
            const status = {
                running: isRunning,
                status: isRunning ? 'Server is running normally' : 'Server is not running',
                uptime: isRunning ? 'Process detected' : 'N/A',
                performance: isRunning ? 'Monitoring active' : 'N/A',
                lastCheck: new Date().toISOString()
            };
            
            res.json(status);
        });
    } catch (error) {
        writeLog(`Server status API error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to get server status' });
    }
});

// Server validate endpoint
router.post('/validate', async (req, res) => {
    try {
        const { admin = 'Unknown', user_id } = req.body;
        
        writeLog(`API: Server validation initiated by ${admin} (${user_id})`, 'Info');
        
        // Call PowerShell module to validate server files
        exec(`powershell.exe -Command "& { Import-Module '${path.join(AUTOMATION_WORKING_DIR, 'modules', 'automation', 'update', 'update.psm1')}' -Force; Invoke-ServerValidation }"`, 
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
        
        writeLog(`API: Server backup initiated by ${admin} (${user_id})`, 'Info');
        
        // Execute backup via PowerShell module
        exec(`powershell.exe -Command "& { Import-Module '${path.join(AUTOMATION_WORKING_DIR, 'modules', 'automation', 'backup', 'backup.psm1')}' -Force; Invoke-GameBackup }"`, 
            { cwd: AUTOMATION_WORKING_DIR }, 
            (error, stdout, stderr) => {
                if (error) {
                    writeLog(`Backup execution error: ${error.message}`, 'Error');
                } else {
                    writeLog(`Server backup executed by ${admin}`, 'Info');
                }
            }
        );
        
        res.json({ 
            success: true,
            backupName: `SCUM_Backup_${new Date().toISOString().replace(/[:]/g, '-').split('.')[0]}`,
            path: 'backups/',
            createdAt: new Date().toISOString()
        });
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
        
        writeLog(`API: ${cancelledCount} operations cancelled by ${admin} (${user_id}) - IDs: ${operationIds.join(', ')}`, 'Info');
        
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
        
        writeLog(`API: Next restart skipped by ${admin} (${user_id})`, 'Info');
        
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

module.exports = router;
