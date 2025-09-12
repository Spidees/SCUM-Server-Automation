const { EmbedBuilder } = require('discord.js');
const { getDb } = require('../utils/database');
const { writeLog, makeEphemeral, makeEphemeralDefer } = require('../utils/utils');

// Generate random registration code
function generateRegistrationCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Link Account Command - Generates registration code for player
async function handleLinkAccountCommand(interaction) {
    await interaction.deferReply(makeEphemeralDefer());
    
    try {
        const db = getDb();
        
        // Check if user already has an active link
        db.get('SELECT * FROM a_discord_profiles WHERE discord_user_id = ?', [interaction.user.id], (err, existingLink) => {
            if (err) {
                writeLog(`Account linking check error: ${err.message}`, 'Error');
                interaction.followUp(makeEphemeral({ 
                    content: ':x: Failed to check existing account links.'
                }));
                return;
            }
            
            if (existingLink) {
                interaction.followUp(makeEphemeral({ 
                    content: ':information_source: Your Discord account is already linked to a SCUM character.'
                }));
                return;
            }
            
            // Generate new registration code
            const registrationCode = generateRegistrationCode();
            const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
            
            // Store registration code in database
            db.run(`
                INSERT OR REPLACE INTO a_pending_registrations 
                (discord_user_id, discord_username, registration_code, expires_at, used, created_at)
                VALUES (?, ?, ?, ?, 0, datetime('now'))
            `, [interaction.user.id, interaction.user.tag, registrationCode, expiresAt.toISOString()], function(err) {
                if (err) {
                    writeLog(`Registration code storage error: ${err.message}`, 'Error');
                    interaction.followUp(makeEphemeral({ 
                        content: ':x: Failed to generate registration code.'
                    }));
                    return;
                }
                
                const embed = new EmbedBuilder()
                    .setTitle(':link: Account Linking')
                    .setDescription('To link your Discord account with your SCUM character, follow these steps:')
                    .addFields(
                        { 
                            name: ':one: Copy the code below', 
                            value: `\`\`\`connect:${registrationCode}\`\`\``, 
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
                
                interaction.followUp(makeEphemeral({ embeds: [embed] }));
                writeLog(`Registration code generated for ${interaction.user.tag}: ${registrationCode}`, 'Debug');
            });
        });
        
    } catch (error) {
        writeLog(`Link account command error: ${error.message}`, 'Error');
        await interaction.followUp(makeEphemeral({ 
            content: ':x: An error occurred while generating registration code.'
        }));
    }
}

// Unlink Account Command - Removes existing account link
async function handleUnlinkAccountCommand(interaction) {
    await interaction.deferReply(makeEphemeralDefer());
    
    try {
        const db = getDb();
        
        // Check if user has an active link
        db.get('SELECT * FROM a_discord_profiles WHERE discord_user_id = ?', [interaction.user.id], (err, existingLink) => {
            if (err) {
                writeLog(`Account unlinking check error: ${err.message}`, 'Error');
                interaction.followUp(makeEphemeral({ 
                    content: ':x: Failed to check existing account links.'
                }));
                return;
            }
            
            if (!existingLink) {
                interaction.followUp(makeEphemeral({ 
                    content: ':information_source: Your Discord account is not linked to any SCUM character.'
                }));
                return;
            }
            
            // Remove the link
            db.run('DELETE FROM a_discord_profiles WHERE discord_user_id = ?', [interaction.user.id], function(err) {
                if (err) {
                    writeLog(`Account unlinking error: ${err.message}`, 'Error');
                    interaction.followUp(makeEphemeral({ 
                        content: ':x: Failed to unlink account.'
                    }));
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
                        writeLog(`Account unlinking DM sent to ${interaction.user.tag}`, 'Debug');
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
                                value: 'Use `/link-account` command to create a new link', 
                                inline: false 
                            }
                        )
                        .setColor('#FFA500')
                        .setTimestamp();
                    
                    interaction.followUp(makeEphemeral({ embeds: [embed] }));
                    writeLog(`Account unlinked for ${interaction.user.tag}: Steam ${existingLink.steam_id}`, 'Debug');
                });
            });
        });
        
    } catch (error) {
        writeLog(`Unlink account command error: ${error.message}`, 'Error');
        await interaction.followUp(makeEphemeral({ 
            content: ':x: An error occurred while unlinking account.'
        }));
    }
}

module.exports = {
    handleLinkAccountCommand,
    handleUnlinkAccountCommand
};
