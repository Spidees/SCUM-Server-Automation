const { EmbedBuilder } = require('discord.js');
const { checkAdminPermission, getDb } = require('../utils/database');
const { writeLog, makeEphemeral, makeEphemeralDefer } = require('../utils/utils');

// Handle button interactions
async function handleButtonInteraction(interaction) {
    try {
        const { customId } = interaction;
        
        // Debug logging
        writeLog(`Button interaction received: customId="${customId}", user=${interaction.user.tag}`, 'Debug');
        
        if (customId.startsWith('confirm_') || customId.startsWith('cancel_')) {
            await handleAdminConfirmation(interaction);
        } else if (customId === 'link_account' || customId === 'account_linking_connect' || customId === 'connect_account') {
            await handleAccountLinkingButton(interaction);
        } else if (customId === 'check_status' || customId === 'account_linking_status' || customId === 'status_account') {
            await handleAccountStatusButton(interaction);
        } else {
            writeLog(`Unknown button customId: "${customId}"`, 'Warning');
            await interaction.reply(makeEphemeral({ 
                content: ':x: Unknown button interaction.'
            }));
        }
    } catch (error) {
        writeLog(`Button interaction error: ${error.message}`, 'Error');
        await interaction.reply(makeEphemeral({ 
            content: ':x: An error occurred while processing the button interaction.'
        }));
    }
}

// Handle admin confirmation buttons
async function handleAdminConfirmation(interaction) {
    const { customId } = interaction;
    
    // Check if user has admin permission
    const hasPermission = await checkAdminPermission(interaction.user.id);
    if (!hasPermission) {
        await interaction.reply(makeEphemeral({ 
            content: ':lock: You do not have permission to perform this action.'
        }));
        return;
    }
    
    if (customId.startsWith('cancel_')) {
        await interaction.update({ 
            content: ':x: Operation cancelled.',
            embeds: [],
            components: []
        });
        return;
    }
    
    // Handle specific confirmation types
    switch (customId) {
        case 'confirm_restart':
        case 'confirm_stop':
        case 'confirm_update':
        case 'confirm_backup':
        case 'confirm_validate':
            // These are handled by their respective command functions
            break;
        default:
            await interaction.reply(makeEphemeral({ 
                content: ':x: Unknown confirmation action.'
            }));
    }
}

// Handle account linking button
async function handleAccountLinkingButton(interaction) {
    await interaction.deferReply(makeEphemeralDefer());
    
    try {
        const db = getDb();
        
        // Check if user is already linked
        db.get('SELECT * FROM a_discord_profiles WHERE discord_user_id = ?', [interaction.user.id], async (err, existingLink) => {
            if (err) {
                writeLog(`Account linking check error: ${err.message}`, 'Error');
                await interaction.followUp(makeEphemeral({ content: ':x: Failed to check account linking status.' }));
                return;
            }
            
            if (existingLink) {
                await interaction.followUp(makeEphemeral({ 
                    content: ':information_source: Your Discord account is already linked to a SCUM character.'
                }));
                return;
            }
            
            // Generate registration code
            const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
            let code = "";
            for (let i = 0; i < 6; i++) {
                code += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            
            // Set expiration time (15 minutes from now)
            const expiresAt = new Date();
            expiresAt.setMinutes(expiresAt.getMinutes() + 15);
            
            // Store registration code in database
            db.run(`
                INSERT OR REPLACE INTO a_pending_registrations 
                (discord_user_id, discord_username, registration_code, expires_at, used, created_at)
                VALUES (?, ?, ?, ?, 0, datetime('now'))
            `, [interaction.user.id, interaction.user.tag, code, expiresAt.toISOString()], async (err) => {
                if (err) {
                    writeLog(`Registration code storage error: ${err.message}`, 'Error');
                    await interaction.followUp(makeEphemeral({ content: ':x: Failed to generate registration code.' }));
                    return;
                }
                
                const embed = new EmbedBuilder()
                    .setTitle(':link: Account Linking')
                    .setDescription('To link your Discord account with your SCUM character, follow these steps:')
                    .addFields(
                        { 
                            name: ':one: Copy the code below', 
                            value: `\`\`\`connect:${code}\`\`\``, 
                            inline: false 
                        },
                        { 
                            name: ':two: Go to SCUM game', 
                            value: 'Open the in-game chat (Enter key)', 
                            inline: false 
                        },
                        { 
                            name: ':three: Send the code', 
                            value: `Type the code **exactly** as shown above into the game chat`, 
                            inline: false 
                        },
                        { 
                            name: ':alarm_clock: Expires', 
                            value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`, 
                            inline: true 
                        }
                    )
                    .setColor('#00FF00')
                    .setFooter({ text: 'The code will expire in 15 minutes' })
                    .setTimestamp();
                
                await interaction.followUp(makeEphemeral({ embeds: [embed] }));
                writeLog(`Registration code generated for ${interaction.user.tag}: ${code}`, 'Info');
            });
        });
        
    } catch (error) {
        writeLog(`Account linking button error: ${error.message}`, 'Error');
        await interaction.followUp(makeEphemeral({ 
            content: ':x: An error occurred while processing account linking.'
        }));
    }
}

// Handle account status check button
async function handleAccountStatusButton(interaction) {
    await interaction.deferReply(makeEphemeralDefer());
    
    try {
        const db = getDb();
        
        // Check if user is linked
        db.get('SELECT * FROM a_discord_profiles WHERE discord_user_id = ?', [interaction.user.id], async (err, linkedAccount) => {
            if (err) {
                writeLog(`Account status check error: ${err.message}`, 'Error');
                await interaction.followUp(makeEphemeral({ content: ':x: Failed to check account status.' }));
                return;
            }
            
            if (linkedAccount) {
                const embed = new EmbedBuilder()
                    .setTitle(':white_check_mark: Account Linked')
                    .setDescription('Your Discord account is successfully linked!')
                    .addFields(
                        { name: ':id: Player Name', value: linkedAccount.player_name || 'Unknown', inline: true },
                        { name: ':calendar: Linked At', value: `<t:${Math.floor(new Date(linkedAccount.linked_at).getTime() / 1000)}:F>`, inline: true },
                        { name: ':bell: Notifications', value: linkedAccount.notifications_enabled ? ':white_check_mark: Enabled' : ':x: Disabled', inline: true }
                    )
                    .setColor('#00FF00')
                    .setTimestamp();
                
                await interaction.followUp(makeEphemeral({ embeds: [embed] }));
            } else {
                // Check for pending registration
                db.get('SELECT * FROM a_pending_registrations WHERE discord_user_id = ? AND used = 0 AND expires_at > datetime("now") ORDER BY created_at DESC LIMIT 1', [interaction.user.id], async (err, pendingReg) => {
                    if (err) {
                        writeLog(`Pending registration check error: ${err.message}`, 'Error');
                        await interaction.followUp(makeEphemeral({ content: ':x: Failed to check registration status.' }));
                        return;
                    }
                    
                    if (pendingReg) {
                        const expiresAt = new Date(pendingReg.expires_at);
                        const embed = new EmbedBuilder()
                            .setTitle(':hourglass: Pending Registration')
                            .setDescription('You have an active registration code waiting to be used.')
                            .addFields(
                                { name: ':key: Code', value: `\`connect:${pendingReg.registration_code}\``, inline: false },
                                { name: ':alarm_clock: Expires', value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`, inline: true }
                            )
                            .setColor('#FFD700')
                            .setTimestamp();
                        
                        await interaction.followUp(makeEphemeral({ embeds: [embed] }));
                    } else {
                        const embed = new EmbedBuilder()
                            .setTitle(':x: Not Linked')
                            .setDescription('Your Discord account is not linked to any SCUM character.\n\nClick the ":link: Link Account" button to start the linking process.')
                            .setColor('#FF0000')
                            .setTimestamp();
                        
                        await interaction.followUp(makeEphemeral({ embeds: [embed] }));
                    }
                });
            }
        });
        
    } catch (error) {
        writeLog(`Account status check error: ${error.message}`, 'Error');
        await interaction.followUp(makeEphemeral({ 
            content: ':x: An error occurred while checking account status.'
        }));
    }
}

module.exports = {
    handleButtonInteraction,
    handleAdminConfirmation,
    handleAccountLinkingButton,
    handleAccountStatusButton
};
