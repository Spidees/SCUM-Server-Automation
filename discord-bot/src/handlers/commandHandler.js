const { EmbedBuilder } = require('discord.js');
const { checkAdminPermission } = require('../utils/database');
const { writeLog, makeEphemeral, makeEphemeralDefer } = require('../utils/utils');

// Import command modules
const serverCommands = require('../commands/serverCommands');
const adminCommands = require('../commands/adminCommands');
const linkingCommands = require('../commands/linkingCommands');

// Handle slash command interactions
async function handleSlashCommand(interaction, client) {
    const { commandName } = interaction;
    
    try {
        switch (commandName) {
            // Server management commands
            case 'server-info':
                await serverCommands.handleServerInfoCommand(interaction);
                break;
            case 'server-status':
                await serverCommands.handleServerStatusCommand(interaction);
                break;
            case 'server-restart':
                await serverCommands.handleServerRestartCommand(interaction);
                break;
            case 'server-stop':
                await serverCommands.handleServerStopCommand(interaction);
                break;
            case 'server-start':
                await serverCommands.handleServerStartCommand(interaction);
                break;
            case 'server-update':
                await serverCommands.handleServerUpdateCommand(interaction);
                break;
            case 'server-validate':
                await serverCommands.handleServerValidateCommand(interaction);
                break;
            case 'server-backup':
                await serverCommands.handleServerBackupCommand(interaction);
                break;
            case 'server-cancel':
                await serverCommands.handleServerCancelCommand(interaction);
                break;
            case 'bot-status':
                await serverCommands.handleBotStatusCommand(interaction, client);
                break;
                
            // Player management commands (Admin only)
            case 'player-search':
                await adminCommands.handlePlayerSearchCommand(interaction);
                break;
            case 'player-online':
                await adminCommands.handlePlayerOnlineCommand(interaction);
                break;
                
            // Account linking commands
            case 'link-account':
                await linkingCommands.handleLinkAccountCommand(interaction);
                break;
            case 'unlink-account':
                await linkingCommands.handleUnlinkAccountCommand(interaction);
                break;
                
            default:
                await interaction.reply(makeEphemeral({ 
                    content: ':x: Unknown command.'
                }));
        }
    } catch (error) {
        writeLog(`Slash command error (${commandName}): ${error.message}`, 'Error');
        
        const errorResponse = makeEphemeral({ 
            content: ':x: An error occurred while processing your command.'
        });
        
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorResponse);
        } else {
            await interaction.reply(errorResponse);
        }
    }
}

module.exports = {
    handleSlashCommand
};
