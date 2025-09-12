const fs = require('fs');
const path = require('path');

// Global state for scheduled operations
let scheduledOperations = [];
let operationIdCounter = 1;

// Write-Log compatibility function for PowerShell integration
function writeLog(message, level = 'Info') {
    const CONFIG = require('../config/config');
    
    // Filter out Debug messages when debug mode is disabled
    if (level.toLowerCase() === 'debug' && !CONFIG.debug) {
        return;
    }
    
    // Use consistent timestamp format to match PowerShell logs
    const now = new Date();
    const timestamp = now.getFullYear() + '-' + 
                     String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                     String(now.getDate()).padStart(2, '0') + ' ' +
                     String(now.getHours()).padStart(2, '0') + ':' +
                     String(now.getMinutes()).padStart(2, '0') + ':' +
                     String(now.getSeconds()).padStart(2, '0');
    
    const logMessage = `${timestamp} [${level}] ${message}`;
    
    console.log(logMessage);
    
    // Append to log file if it exists - use dynamic path
    const logFile = path.join(CONFIG.rootDir, 'SCUM-Server-Automation.log');
    try {
        fs.appendFileSync(logFile, logMessage + '\n');
    } catch (error) {
        console.warn('Could not write to log file:', error.message);
    }
}

// Get scheduled operations
function getScheduledOperations() {
    // Filter out expired operations
    const currentTime = new Date();
    scheduledOperations = scheduledOperations.filter(op => new Date(op.scheduledTime) > currentTime);
    return scheduledOperations;
}

// Add scheduled operation
function addScheduledOperation(operation) {
    operation.id = operationIdCounter++;
    scheduledOperations.push(operation);
    return operation;
}

// Remove scheduled operations by IDs
function removeScheduledOperations(operationIds) {
    const initialCount = scheduledOperations.length;
    scheduledOperations = scheduledOperations.filter(op => !operationIds.includes(op.id));
    return initialCount - scheduledOperations.length;
}

// Remove scheduled operation by scheduleId
function removeScheduledOperationByScheduleId(scheduleId) {
    scheduledOperations = scheduledOperations.filter(op => op.scheduleId !== scheduleId);
}

// Database connection helper
function getDb() {
    const sqlite3 = require('sqlite3').verbose();
    const CONFIG = require('../config/config');
    return new sqlite3.Database(CONFIG.databasePath);
}

// Helper function for ephemeral responses (Discord.js v14+ compatibility)
function makeEphemeral(options = {}) {
    const { MessageFlags } = require('discord.js');
    return {
        ...options,
        flags: MessageFlags.Ephemeral
    };
}

// Helper function for ephemeral defer
function makeEphemeralDefer() {
    const { MessageFlags } = require('discord.js');
    return {
        flags: MessageFlags.Ephemeral
    };
}

module.exports = {
    writeLog,
    getScheduledOperations,
    addScheduledOperation,
    removeScheduledOperations,
    removeScheduledOperationByScheduleId,
    getDb,
    makeEphemeral,
    makeEphemeralDefer,
    scheduledOperations,
    operationIdCounter
};
