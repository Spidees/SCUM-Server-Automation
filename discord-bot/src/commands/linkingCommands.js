const { EmbedBuilder } = require('discord.js');
const { getDb } = require('../utils/database');
const { writeLog } = require('../utils/utils');

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
    await interaction.deferReply({ ephemeral: true });
    
    try {
        const db = getDb();
        
        // Check if user already has an active link
        db.get('SELECT * FROM a_discord_profiles WHERE discord_user_id = ?', [interaction.user.id], (err, existingLink) => {
            if (err) {
                writeLog(`Account linking check error: ${err.message}`, 'Error');
                interaction.followUp({ 
                    content: ':x: Failed to check existing account links.',
                    ephemeral: true 
                });
                return;
            }
            
            if (existingLink) {
                interaction.followUp({ 
                    content: ':information_source: Your Discord account is already linked to a SCUM character.',
                    ephemeral: true 
                });
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
                    interaction.followUp({ 
                        content: ':x: Failed to generate registration code.',
                        ephemeral: true 
                    });
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
                        }
                    )
                    .setColor('#00FF00')
                    .setFooter({ text: 'The code will expire in 15 minutes' })
                    .setTimestamp();
                
                interaction.followUp({ embeds: [embed], ephemeral: true });
                writeLog(`Registration code generated for ${interaction.user.tag}: ${registrationCode}`, 'Info');
            });
        });
        
    } catch (error) {
        writeLog(`Link account command error: ${error.message}`, 'Error');
        await interaction.followUp({ 
            content: ':x: An error occurred while generating registration code.',
            ephemeral: true 
        });
    }
}

module.exports = {
    handleLinkAccountCommand
};
