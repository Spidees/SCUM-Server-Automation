const { Client, GatewayIntentBits, ActivityType, REST, Routes, InteractionResponseFlags } = require('discord.js');
const express = require('express');
const path = require('path');

// Import modules
const CONFIG = require('./src/config/config');
const { initializeDatabase, closeDatabases } = require('./src/utils/database');
const { writeLog } = require('./src/utils/utils');
const { handleSlashCommand } = require('./src/handlers/commandHandler');
const { handleButtonInteraction } = require('./src/handlers/buttonHandler');

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
    writeLog(`Discord bot started as ${client.user.tag}`, 'Info');
    
    // Set bot activity
    client.user.setActivity('SCUM Server', { type: ActivityType.Watching });
    
    // Make client available globally for API routes
    global.discordClient = client;
    
    // Register slash commands
    await registerSlashCommands();
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
        
        const errorResponse = { 
            content: ':x: An error occurred while processing your interaction.',
            ephemeral: true 
        };
        
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorResponse);
        } else {
            await interaction.reply(errorResponse);
        }
    }
});

// Register slash commands
async function registerSlashCommands() {
    const commands = [
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
        }
    ];

    const rest = new REST({ version: '10' }).setToken(CONFIG.token);

    try {
        console.log('🔄 Registering slash commands...');
        
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, CONFIG.guildId),
            { body: commands }
        );
        
        console.log('✅ Successfully registered slash commands');
        writeLog('Slash commands registered successfully', 'Info');
    } catch (error) {
        console.error('❌ Error registering slash commands:', error);
        writeLog(`Slash command registration error: ${error.message}`, 'Error');
    }
}

// Graceful shutdown handling
process.on('SIGINT', () => {
    console.log('\n🔄 Gracefully shutting down...');
    
    try {
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
        closeDatabases();
        client.destroy();
    } catch (error) {
        console.error('Cleanup error:', error);
    }
    
    process.exit(0);
});

// Start HTTP server
app.listen(CONFIG.httpPort, () => {
    console.log(`🌐 HTTP API listening on port ${CONFIG.httpPort}`);
    writeLog(`HTTP API server started on port ${CONFIG.httpPort}`, 'Info');
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