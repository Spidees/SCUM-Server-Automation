const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const CONFIG = require('../config/config');
const { writeLog } = require('../utils/utils');

let db;
let leaderboardsDb;

// Initialize SQLite database
function initializeDatabase() {
    try {
        db = new sqlite3.Database(CONFIG.databasePath);
        console.log(`Connected to SQLite database: ${CONFIG.databasePath}`);
        
        // Initialize leaderboards database - use dynamic path
        const leaderboardsPath = path.join(CONFIG.rootDir, 'data', 'weekly_leaderboards.db');
        leaderboardsDb = new sqlite3.Database(leaderboardsPath);
        console.log(`Connected to leaderboards database: ${leaderboardsPath}`);
        
        return { db, leaderboardsDb };
    } catch (error) {
        console.error('Failed to connect to database:', error);
        process.exit(1);
    }
}

// Check admin permission
async function checkAdminPermission(userId, interaction = null) {
    try {
        // Use role-based permissions from config
        const fs = require('fs');
        const path = require('path');
        const configPath = path.resolve(__dirname, '../../../SCUM-Server-Automation.config.json');
        
        if (!fs.existsSync(configPath)) {
            console.log('Config file not found, denying permission');
            console.log('Looked for config at:', configPath);
            return false;
        }
        
        const configData = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configData);
        
        if (!config.Discord?.Commands?.Roles?.Admin) {
            console.log('No admin roles configured, denying permission');
            return false;
        }
        
        // If we have interaction context, check roles directly
        if (interaction && interaction.member) {
            const adminRoles = config.Discord.Commands.Roles.Admin;
            const memberRoles = interaction.member.roles.cache;
            
            const hasAdminRole = adminRoles.some(roleId => memberRoles.has(roleId));
            console.log(`Permission check for ${userId}: hasAdminRole=${hasAdminRole}`);
            return hasAdminRole;
        }
        
        // Fallback: try to get member from guild
        if (global.discordClient && global.discordClient.isReady()) {
            const guild = global.discordClient.guilds.cache.get(config.Discord.GuildId);
            if (guild) {
                try {
                    const member = await guild.members.fetch(userId);
                    if (member) {
                        const adminRoles = config.Discord.Commands.Roles.Admin;
                        const hasAdminRole = adminRoles.some(roleId => member.roles.cache.has(roleId));
                        console.log(`Permission check for ${userId}: hasAdminRole=${hasAdminRole}`);
                        return hasAdminRole;
                    }
                } catch (fetchError) {
                    console.log(`Could not fetch member ${userId}:`, fetchError.message);
                }
            }
        }
        
        console.log(`Permission check failed for ${userId}: no valid context`);
        return false;
        
    } catch (error) {
        console.error('Permission check error:', error);
        return false;
    }
}

// Close database connections
function closeDatabases() {
    if (db) {
        db.close((err) => {
            if (err) {
                console.error('Error closing main database:', err);
            }
        });
    }
    if (leaderboardsDb) {
        leaderboardsDb.close((err) => {
            if (err) {
                console.error('Error closing leaderboards database:', err);
            }
        });
    }
}

module.exports = {
    initializeDatabase,
    checkAdminPermission,
    closeDatabases,
    getDb: () => db,
    getLeaderboardsDb: () => leaderboardsDb
};
