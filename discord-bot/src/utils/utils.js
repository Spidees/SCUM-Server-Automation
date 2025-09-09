const fs = require('fs');
const path = require('path');

// Global state for scheduled operations
let scheduledOperations = [];
let operationIdCounter = 1;

// Write-Log compatibility function for PowerShell integration
function writeLog(message, level = 'Info') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}`;
    
    console.log(logMessage);
    
    // Append to log file if it exists - use dynamic path
    const CONFIG = require('../config/config');
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
    try {
        const { InteractionResponseFlags } = require('discord.js');
        return {
            ...options,
            flags: InteractionResponseFlags.Ephemeral
        };
    } catch (error) {
        // Fallback to old method if InteractionResponseFlags not available
        return {
            ...options,
            ephemeral: true
        };
    }
}

// Helper function for ephemeral defer
function makeEphemeralDefer() {
    try {
        const { InteractionResponseFlags } = require('discord.js');
        return {
            flags: InteractionResponseFlags.Ephemeral
        };
    } catch (error) {
        // Fallback to old method if InteractionResponseFlags not available
        return {
            ephemeral: true
        };
    }
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
