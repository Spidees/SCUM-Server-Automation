const { Client, GatewayIntentBits, ActivityType, REST, Routes, InteractionResponseFlags, MessageFlags } = require('discord.js');
const express = require('express');
const path = require('path');

// Import modules
const CONFIG = require('./src/config/config');
const { initializeDatabase, closeDatabases } = require('./src/utils/database');
const { writeLog } = require('./src/utils/utils');
const { handleSlashCommand } = require('./src/handlers/commandHandler');
const { handleButtonInteraction } = require('./src/handlers/buttonHandler');
const activityManager = require('./src/utils/activityManager');
const chatManager = require('./src/utils/chatManager');
const notificationHandler = require('./src/utils/notificationHandler');

// Import API routes
const apiRoutes = require('./src/api/routes');
const serverRoutes = require('./src/api/serverRoutes');

// Validate configuration
CONFIG.validate();

// Initialize Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Initialize Express app for HTTP API
const app = express();
app.use(express.json({ limit: '10mb' }));

// Setup API routes
app.use('/api', apiRoutes);
app.use('/api/server', serverRoutes);

// Initialize database
const { db, leaderboardsDb } = initializeDatabase();

// Discord client event handlers
client.once('clientReady', async () => {
    console.log(`✅ Discord bot logged in as ${client.user.tag}`);
    writeLog(`Discord bot started as ${client.user.tag}`, 'Debug');
    
    // Initialize activity manager
    activityManager.initialize(client);
    
    // Initialize chat manager
    chatManager.initialize(client);
    
    // Initialize notification handler
    notificationHandler.initialize(client);
    
    // Make client available globally for API routes
    global.discordClient = client;
    
    // Skip automatic slash command registration to test command listing
    console.log('⏭️ Skipping automatic slash command registration');
    writeLog('Bot started without automatic slash command registration', 'Debug');
});

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            await handleSlashCommand(interaction, client);
        } else if (interaction.isButton()) {
            await handleButtonInteraction(interaction);
        } else if (interaction.isStringSelectMenu()) {
            // Handle select menu interactions if needed
            writeLog(`Select menu interaction: ${interaction.customId}`, 'Debug');
        }
    } catch (error) {
        writeLog(`Interaction error: ${error.message}`, 'Error');
        
        // Check if the interaction has expired or already been responded to
        if (error.code === 10062 || error.message.includes('Unknown interaction')) {
            writeLog('Interaction expired or unknown, skipping error response', 'Warning');
            return;
        }
        
        try {
            const errorResponse = { 
                content: ':x: An error occurred while processing your interaction.',
                flags: MessageFlags.Ephemeral
            };
            
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorResponse);
            } else {
                await interaction.reply(errorResponse);
            }
        } catch (replyError) {
            writeLog(`Failed to send error response: ${replyError.message}`, 'Warning');
        }
    }
});

// Define commands array (shared between registration and refresh)
const slashCommands = [
    // Server management commands
    {
        name: 'server-info',
        description: 'Get server information and statistics'
    },
    {
        name: 'server-status',
        description: 'Check current server status'
    },
    {
        name: 'server-restart',
        description: 'Restart the server (Admin only)',
        options: [
            {
                name: 'action',
                description: 'Action to perform',
                type: 3, // STRING
                required: false,
                choices: [
                    { name: 'Restart Now', value: 'now' },
                    { name: 'Cancel Scheduled Restart', value: 'cancel' },
                    { name: 'Skip Next Restart', value: 'skip' }
                ]
            },
            {
                name: 'minutes',
                description: 'Delay in minutes (only for restart)',
                type: 4, // INTEGER
                required: false
            }
        ]
    },
    {
        name: 'server-stop',
        description: 'Stop the server (Admin only)',
        options: [
            {
                name: 'action',
                description: 'Action to perform',
                type: 3, // STRING
                required: false,
                choices: [
                    { name: 'Stop Now', value: 'now' },
                    { name: 'Cancel Scheduled Stop', value: 'cancel' }
                ]
            },
            {
                name: 'minutes',
                description: 'Delay in minutes (only for stop)',
                type: 4, // INTEGER
                required: false
            }
        ]
    },
    {
        name: 'server-start',
        description: 'Start the server (Admin only)'
    },
    {
        name: 'server-update',
        description: 'Update the server (Admin only)',
        options: [
            {
                name: 'action',
                description: 'Action to perform',
                type: 3, // STRING
                required: false,
                choices: [
                    { name: 'Update Now', value: 'now' },
                    { name: 'Cancel Scheduled Update', value: 'cancel' }
                ]
            },
            {
                name: 'minutes',
                description: 'Delay in minutes (only for update)',
                type: 4, // INTEGER
                required: false
            }
        ]
    },
    {
        name: 'server-validate',
        description: 'Validate server files (Admin only)'
    },
    {
        name: 'server-backup',
        description: 'Create server backup (Admin only)'
    },
    {
        name: 'server-cancel',
        description: 'Cancel scheduled operations (Admin only)'
    },
    {
        name: 'bot-status',
        description: 'Get bot status information (Admin only)'
    },
    // Player commands
    {
        name: 'player-search',
        description: 'Search for players (Admin only)',
        options: [
            {
                name: 'steamid',
                description: 'Steam ID to search for',
                type: 3, // STRING
                required: false
            },
            {
                name: 'name',
                description: 'Player name to search for',
                type: 3, // STRING
                required: false
            }
        ]
    },
    {
        name: 'player-online',
        description: 'List online players (Admin only)'
    },
    // Account linking commands
    {
        name: 'link-account',
        description: 'Link your Discord account to your SCUM character'
    },
    {
        name: 'unlink-account',
        description: 'Unlink your Discord account from your SCUM character'
    }
];

// Register slash commands
async function registerSlashCommands() {
    const commands = slashCommands;

    try {
        console.log('🔄 Clearing old slash commands...');
        
        // Use the client's application commands manager instead of REST API
        try {
            // Clear existing guild commands
            await client.application.commands.set([], CONFIG.guildId);
            console.log('✅ Old guild commands cleared');
        } catch (clearError) {
            console.error('❌ Failed to clear guild commands:', clearError.message);
            writeLog(`Failed to clear guild commands: ${clearError.message}`, 'Error');
        }
        
        console.log('🔄 Registering new slash commands...');
        console.log(`📋 Commands to register: ${commands.map(cmd => cmd.name).join(', ')}`);
        
        // Register new commands using client's application commands manager
        try {
            await client.application.commands.set(commands, CONFIG.guildId);
            
            console.log('✅ Successfully registered slash commands');
            console.log(`📋 Registered ${commands.length} commands: ${commands.map(cmd => cmd.name).join(', ')}`);
            writeLog('Slash commands cleared and re-registered successfully', 'Debug');
        } catch (registerError) {
            console.error('❌ Failed to register slash commands:', registerError);
            console.error('Full error details:', {
                message: registerError.message,
                status: registerError.status,
                method: registerError.method,
                url: registerError.url,
                requestBody: registerError.requestBody
            });
            writeLog(`Slash command registration failed: ${registerError.message}`, 'Error');
            
            // Continue bot operation even if commands fail to register
            console.log('⚠️ Bot will continue without slash commands');
        }
    } catch (error) {
        console.error('❌ Error managing slash commands:', error);
        console.error('Full error details:', {
            message: error.message,
            stack: error.stack,
            status: error.status
        });
        writeLog(`Slash command management error: ${error.message}`, 'Error');
        
        // Continue bot operation
        console.log('⚠️ Bot will continue without slash commands');
    }
}

// Function to refresh slash commands (for API endpoint)
async function refreshSlashCommands() {
    if (!client.isReady()) {
        throw new Error('Discord client is not ready');
    }
    
    const commands = slashCommands; // Use the same command array

    try {
        console.log('🔄 Refreshing slash commands...');
        
        // Clear existing guild commands using client's application commands manager
        try {
            await client.application.commands.set([], CONFIG.guildId);
            console.log('✅ Old commands cleared');
        } catch (clearError) {
            console.error('❌ Failed to clear commands:', clearError.message);
            return { success: false, error: `Failed to clear commands: ${clearError.message}` };
        }
        
        // Register new commands using client's application commands manager
        try {
            await client.application.commands.set(commands, CONFIG.guildId);
            
            console.log('✅ Successfully refreshed slash commands');
            console.log(`📋 Refreshed ${commands.length} commands: ${commands.map(cmd => cmd.name).join(', ')}`);
            writeLog('Slash commands refreshed successfully', 'Debug');
            return { success: true, message: 'Commands refreshed successfully', count: commands.length };
        } catch (registerError) {
            console.error('❌ Failed to register commands:', registerError);
            console.error('Full error details:', {
                message: registerError.message,
                status: registerError.status,
                method: registerError.method,
                url: registerError.url
            });
            writeLog(`Slash command registration failed: ${registerError.message}`, 'Error');
            return { success: false, error: `Failed to register commands: ${registerError.message}` };
        }
    } catch (error) {
        console.error('❌ Error refreshing slash commands:', error);
        writeLog(`Slash command refresh error: ${error.message}`, 'Error');
        return { success: false, error: error.message };
    }
}

// Graceful shutdown handling
process.on('SIGINT', () => {
    console.log('\n🔄 Gracefully shutting down...');
    
    try {
        // Stop activity manager
        activityManager.stop();
        
        // Stop chat manager
        chatManager.stop();
        
        // Close database connections
        closeDatabases();
        
        // Destroy Discord client
        client.destroy();
        
    } catch (error) {
        console.error('Cleanup error:', error);
    }
    
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🔄 Received SIGTERM, shutting down...');
    
    try {
        activityManager.stop();
        chatManager.stop();
        closeDatabases();
        client.destroy();
    } catch (error) {
        console.error('Cleanup error:', error);
    }
    
    process.exit(0);
});

// Make client and refresh function available globally for API
global.discordClient = client;
global.refreshSlashCommands = refreshSlashCommands;

// Start HTTP server
app.listen(CONFIG.httpPort, () => {
    console.log(`🌐 HTTP API listening on port ${CONFIG.httpPort}`);
    writeLog(`HTTP API server started on port ${CONFIG.httpPort}`, 'Debug');
});

// Login to Discord
client.login(CONFIG.token).catch(error => {
    console.error('❌ Discord login error:', error);
    writeLog(`Discord login error: ${error.message}`, 'Error');
    process.exit(1);
});

console.log('🚀 SCUM Discord Bot starting...');
console.log(`📊 Database: ${CONFIG.databasePath}`);
console.log(`🌐 HTTP Port: ${CONFIG.httpPort}`);
console.log(`🆔 Guild ID: ${CONFIG.guildId}`);
console.log(`🐛 Debug Mode: ${CONFIG.debug ? 'ON' : 'OFF'}`);

// Export client for use in API routes
module.exports = { client };