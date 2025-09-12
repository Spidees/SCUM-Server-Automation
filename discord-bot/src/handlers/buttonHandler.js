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
        } else if (customId === 'unlink_account' || customId === 'account_linking_unlink' || customId === 'unlink_discord_account') {
            await handleAccountUnlinkButton(interaction);
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
                        },
                        { 
                            name: ':envelope: Important', 
                            value: 'Make sure you allow DMs from server members to receive confirmation messages!', 
                            inline: false 
                        }
                    )
                    .setColor('#00FF00')
                    .setFooter({ text: 'The code will expire in 15 minutes' })
                    .setTimestamp();
                
                await interaction.followUp(makeEphemeral({ embeds: [embed] }));
                writeLog(`Registration code generated for ${interaction.user.tag}: ${code}`, 'Debug');
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

// Handle account unlink button
async function handleAccountUnlinkButton(interaction) {
    await interaction.deferReply(makeEphemeralDefer());
    
    try {
        const db = getDb();
        
        // Check if user has an active link
        db.get('SELECT * FROM a_discord_profiles WHERE discord_user_id = ?', [interaction.user.id], async (err, existingLink) => {
            if (err) {
                writeLog(`Account unlinking check error: ${err.message}`, 'Error');
                await interaction.followUp(makeEphemeral({ content: ':x: Failed to check account status.' }));
                return;
            }
            
            if (!existingLink) {
                await interaction.followUp(makeEphemeral({ 
                    content: ':information_source: Your Discord account is not linked to any SCUM character.'
                }));
                return;
            }
            
            // Remove the link
            db.run('DELETE FROM a_discord_profiles WHERE discord_user_id = ?', [interaction.user.id], async function(err) {
                if (err) {
                    writeLog(`Account unlinking error: ${err.message}`, 'Error');
                    await interaction.followUp(makeEphemeral({ content: ':x: Failed to unlink account.' }));
                    return;
                }
                
                // Also clean up any pending registrations for this user
                db.run('DELETE FROM a_pending_registrations WHERE discord_user_id = ?', [interaction.user.id], async function(cleanupErr) {
                    if (cleanupErr) {
                        writeLog(`Warning: Failed to clean up pending registrations for user ${interaction.user.id}: ${cleanupErr.message}`, 'Warning');
                    }

                    // Send DM to the user about successful unlinking
                    try {
                        const dmEmbed = new EmbedBuilder()
                            .setTitle(':broken_chain: Account Successfully Unlinked')
                            .setDescription('Your Discord account has been successfully unlinked from your SCUM character.')
                            .addFields(
                                { 
                                    name: ':information_source: Previously linked to', 
                                    value: `**Player:** ${existingLink.player_name || 'Unknown'}\n**Steam ID:** \`${existingLink.steam_id}\``, 
                                    inline: false 
                                },
                                { 
                                    name: ':calendar: Unlinked At', 
                                    value: `<t:${Math.floor(Date.now() / 1000)}:F>`, 
                                    inline: false 
                                },
                                { 
                                    name: ':link: Want to link again?', 
                                    value: 'You can use `/link-account` command or the Link Account button to create a new connection anytime.', 
                                    inline: false 
                                }
                            )
                            .setColor('#FFA500')
                            .setTimestamp();

                        await interaction.user.send({ embeds: [dmEmbed] });
                        writeLog(`Account unlinking DM sent via button to ${interaction.user.tag}`, 'Debug');
                    } catch (dmError) {
                        writeLog(`Failed to send account unlinking DM to ${interaction.user.tag}: ${dmError.message}`, 'Warning');
                        // Don't fail the whole operation if DM fails
                    }

                    const embed = new EmbedBuilder()
                        .setTitle(':broken_chain: Account Unlinked')
                        .setDescription('Your Discord account has been successfully unlinked from your SCUM character.')
                        .addFields(
                            { 
                                name: ':information_source: Previously linked to', 
                                value: `Steam ID: \`${existingLink.steam_id}\`${existingLink.player_name ? `\nPlayer: \`${existingLink.player_name}\`` : ''}`, 
                                inline: false 
                            },
                            { 
                                name: ':link: Want to link again?', 
                                value: 'Click the "Link Account" button or use `/link-account` command', 
                                inline: false 
                            }
                        )
                        .setColor('#FFA500')
                        .setTimestamp();
                    
                    await interaction.followUp(makeEphemeral({ embeds: [embed] }));
                    writeLog(`Account unlinked via button for ${interaction.user.tag}: Steam ${existingLink.steam_id}`, 'Debug');
                });
            });
        });
        
    } catch (error) {
        writeLog(`Account unlink button error: ${error.message}`, 'Error');
        await interaction.followUp(makeEphemeral({ 
            content: ':x: An error occurred while unlinking account.'
        }));
    }
}

module.exports = {
    handleButtonInteraction,
    handleAdminConfirmation,
    handleAccountLinkingButton,
    handleAccountStatusButton,
    handleAccountUnlinkButton
};
