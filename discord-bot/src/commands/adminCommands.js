const { EmbedBuilder } = require('discord.js');
const { getDb } = require('../utils/database');
const { writeLog } = require('../utils/utils');
const { checkAdminPermission } = require('../utils/database');

// Player Search Command (Admin only)
async function handlePlayerSearchCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
        const hasPermission = await checkAdminPermission(interaction.user.id, interaction);
        if (!hasPermission) {
            await interaction.followUp({ 
                content: ':lock: You do not have permission to search for players.',
                ephemeral: true 
            });
            return;
        }

        const steamId = interaction.options.getString('steamid');
        const playerName = interaction.options.getString('name');
        
        if (!steamId && !playerName) {
            await interaction.followUp({ 
                content: ':x: Please provide either a Steam ID or player name to search for.',
                ephemeral: true 
            });
            return;
        }
        
        const db = getDb();
        let query;
        let params;
        
        if (steamId) {
            query = 'SELECT * FROM a_user_profile WHERE steam_id LIKE ? ORDER BY last_login_time DESC LIMIT 10';
            params = [`%${steamId}%`];
        } else {
            query = 'SELECT * FROM a_user_profile WHERE user_name LIKE ? ORDER BY last_login_time DESC LIMIT 10';
            params = [`%${playerName}%`];
        }
        
        db.all(query, params, async (err, players) => {
            if (err) {
                writeLog(`Player search error: ${err.message}`, 'Error');
                await interaction.followUp({ 
                    content: ':x: Failed to search for players.',
                    ephemeral: true 
                });
                return;
            }
            
            if (!players || players.length === 0) {
                await interaction.followUp({ 
                    content: ':information_source: No players found matching your search.',
                    ephemeral: true 
                });
                return;
            }
            
            const embed = new EmbedBuilder()
                .setTitle(':mag: Player Search Results')
                .setDescription(`Found ${players.length} player(s)`)
                .setColor('#00FF00')
                .setTimestamp();
            
            players.forEach((player, index) => {
                embed.addFields({
                    name: `${index + 1}. ${player.user_name || 'Unknown'}`,
                    value: `**Steam ID:** ${player.steam_id}\n**Online:** ${player.user_is_online ? 'Yes' : 'No'}\n**Last Login:** ${player.last_login_time ? new Date(player.last_login_time).toLocaleString() : 'Never'}`,
                    inline: false
                });
            });
            
            await interaction.followUp({ embeds: [embed], ephemeral: true });
            writeLog(`Player search completed by admin: ${interaction.user.tag}`, 'Debug');
        });
        
    } catch (error) {
        writeLog(`Player search command error: ${error.message}`, 'Error');
        await interaction.followUp({ 
            content: ':x: An error occurred while searching for players.',
            ephemeral: true 
        });
    }
}

// Player Online Command (Admin only)
async function handlePlayerOnlineCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
        const hasPermission = await checkAdminPermission(interaction.user.id, interaction);
        if (!hasPermission) {
            await interaction.followUp({ 
                content: ':lock: You do not have permission to view online players.',
                ephemeral: true 
            });
            return;
        }

        const db = getDb();
        db.all('SELECT * FROM a_user_profile WHERE user_is_online = 1 ORDER BY last_login_time DESC', async (err, players) => {
            if (err) {
                writeLog(`Online players error: ${err.message}`, 'Error');
                await interaction.followUp({ 
                    content: ':x: Failed to get online players.',
                    ephemeral: true 
                });
                return;
            }
            
            if (!players || players.length === 0) {
                await interaction.followUp({ 
                    content: ':information_source: No players are currently online.',
                    ephemeral: true 
                });
                return;
            }
            
            const embed = new EmbedBuilder()
                .setTitle(':green_circle: Online Players')
                .setDescription(`${players.length} player(s) currently online`)
                .setColor('#00FF00')
                .setTimestamp();
            
            players.forEach((player, index) => {
                embed.addFields({
                    name: `${index + 1}. ${player.user_name || 'Unknown'}`,
                    value: `**Steam ID:** ${player.steam_id}\n**Login Time:** ${player.last_login_time ? new Date(player.last_login_time).toLocaleString() : 'Unknown'}`,
                    inline: true
                });
            });
            
            await interaction.followUp({ embeds: [embed], ephemeral: true });
            writeLog(`Online players viewed by admin: ${interaction.user.tag}`, 'Debug');
        });
        
    } catch (error) {
        writeLog(`Online players command error: ${error.message}`, 'Error');
        await interaction.followUp({ 
            content: ':x: An error occurred while getting online players.',
            ephemeral: true 
        });
    }
}

module.exports = {
    handlePlayerSearchCommand,
    handlePlayerOnlineCommand
};
