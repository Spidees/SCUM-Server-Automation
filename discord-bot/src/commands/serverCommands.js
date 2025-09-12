const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { checkAdminPermission, getDb } = require('../utils/database');
const { writeLog, getScheduledOperations } = require('../utils/utils');
const CONFIG = require('../config/config');

// Server Info Command
async function handleServerInfoCommand(interaction) {
    await interaction.deferReply();
    
    try {
        const db = getDb();
        // Get basic server info from database
        db.get(`
            SELECT 
                COUNT(*) as total_players,
                SUM(CASE WHEN user_is_online = 1 THEN 1 ELSE 0 END) as online_players,
                MAX(last_login_time) as last_activity
            FROM a_user_profile 
            WHERE steam_id IS NOT NULL AND steam_id != ''
        `, async (err, stats) => {
            if (err) {
                writeLog(`Server info query error: ${err.message}`, 'Error');
                await interaction.followUp({ content: ':x: Failed to get server information.' });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle(':desktop: SCUM Server Information')
                .setDescription('**Server Details and Statistics**')
                .addFields(
                    { name: ':busts_in_silhouette: Total Players', value: `${stats?.total_players || 0}`, inline: true },
                    { name: ':green_circle: Online Players', value: `${stats?.online_players || 0}`, inline: true },
                    { name: ':clock3: Last Activity', value: stats?.last_activity ? `<t:${Math.floor(new Date(stats.last_activity).getTime() / 1000)}:R>` : 'Never', inline: true },
                    { name: ':gear: Server Version', value: 'Latest', inline: true },
                    { name: ':globe_with_meridians: Region', value: 'EU', inline: true },
                    { name: ':shield: Anti-Cheat', value: 'BattlEye Enabled', inline: true }
                )
                .setColor('#00FF00')
                .setFooter({ 
                    text: 'SCUM Server Automation',
                    iconURL: 'https://playhub.cz/scum/manager/server_automation_discord.png'
                })
                .setTimestamp();

            await interaction.followUp({ embeds: [embed] });
            writeLog('Server info command completed successfully', 'Debug');
        });
        
    } catch (error) {
        writeLog(`Server info command error: ${error.message}`, 'Error');
        await interaction.followUp({ content: ':x: An error occurred while getting server information.' });
    }
}

// Server Status Command
async function handleServerStatusCommand(interaction) {
    await interaction.deferReply();
    
    try {
        const db = getDb();
        db.get(`
            SELECT 
                COUNT(*) as total_players,
                SUM(CASE WHEN user_is_online = 1 THEN 1 ELSE 0 END) as online_players
            FROM a_user_profile 
            WHERE steam_id IS NOT NULL AND steam_id != ''
        `, async (err, stats) => {
            if (err) {
                writeLog(`Server status query error: ${err.message}`, 'Error');
                await interaction.followUp({ content: ':x: Failed to get server status.' });
                return;
            }

            // Try to get server process info from PowerShell automation system
            let serverRunning = false;
            let serverDetails = 'Status unknown';
            
            try {
                const response = await fetch(`http://localhost:${CONFIG.httpPort}/api/server/status`, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                if (response.ok) {
                    const result = await response.json();
                    serverRunning = result.running;
                    serverDetails = result.status;
                }
            } catch (apiError) {
                writeLog(`Server status API error: ${apiError.message}`, 'Warning');
            }

            const embed = new EmbedBuilder()
                .setTitle(':satellite: SCUM Server Status')
                .setDescription('**Current Server State**')
                .addFields(
                    { name: ':electric_plug: Server Status', value: serverRunning ? ':green_circle: Online' : ':red_circle: Offline', inline: true },
                    { name: ':busts_in_silhouette: Players Online', value: `${stats?.online_players || 0}/${stats?.total_players || 0}`, inline: true },
                    { name: ':gear: Performance', value: serverDetails, inline: true },
                    { name: ':clock3: Uptime', value: serverRunning ? 'Active' : 'N/A', inline: true },
                    { name: ':chart_with_upwards_trend: Resources', value: 'Monitoring...', inline: true },
                    { name: ':shield: Security', value: ':white_check_mark: Protected', inline: true }
                )
                .setColor(serverRunning ? '#00FF00' : '#FF0000')
                .setFooter({ 
                    text: 'SCUM Server Automation',
                    iconURL: 'https://playhub.cz/scum/manager/server_automation_discord.png'
                })
                .setTimestamp();

            await interaction.followUp({ embeds: [embed] });
            writeLog('Server status command completed successfully', 'Debug');
        });
        
    } catch (error) {
        writeLog(`Server status command error: ${error.message}`, 'Error');
        await interaction.followUp({ content: ':x: An error occurred while getting server status.' });
    }
}

// Server Restart Command
async function handleServerRestartCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
        const hasPermission = await checkAdminPermission(interaction.user.id, interaction);
        if (!hasPermission) {
            await interaction.followUp({ 
                content: ':lock: You do not have permission to restart the server.',
                ephemeral: true 
            });
            return;
        }

        const action = interaction.options.getString('action') || 'now';
        const delayMinutes = interaction.options.getInteger('minutes') || 0;
        
        // Handle skip action
        if (action === 'skip') {
            const response = await fetch(`http://localhost:${CONFIG.httpPort}/api/server/restart-skip`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    admin: interaction.user.tag,
                    user_id: interaction.user.id
                })
            });

            if (response.ok) {
                const result = await response.json();
                
                const embed = new EmbedBuilder()
                    .setTitle(':fast_forward: Next Restart Skipped')
                    .setDescription('The next scheduled restart has been skipped.')
                    .addFields(
                        { name: ':bust_in_silhouette: Admin', value: interaction.user.tag, inline: true },
                        { name: ':clock3: Skipped Time', value: result.skippedTime ? `<t:${Math.floor(new Date(result.skippedTime).getTime() / 1000)}:R>` : 'N/A', inline: true },
                        { name: ':arrows_counterclockwise: Next Restart', value: result.nextRestart ? `<t:${Math.floor(new Date(result.nextRestart).getTime() / 1000)}:R>` : 'N/A', inline: true }
                    )
                    .setColor('#00FF00')
                    .setTimestamp();

                await interaction.followUp({ embeds: [embed], ephemeral: true });
                writeLog(`Next restart skipped by ${interaction.user.tag} (ID: ${interaction.user.id})`, 'Debug');
            } else {
                throw new Error(`PowerShell API returned ${response.status}`);
            }
            return;
        }
        
        // Handle cancel action (existing logic)
        if (action === 'cancel') {
            // Add cancel logic here if needed
            await interaction.followUp({ 
                content: ':information_source: Cancel functionality for restart not yet implemented.',
                ephemeral: true 
            });
            return;
        }
        
        // Handle restart action (existing logic)
        const confirmEmbed = new EmbedBuilder()
            .setTitle(':warning: Server Restart Confirmation')
            .setDescription(`Are you sure you want to restart the server${delayMinutes > 0 ? ` in ${delayMinutes} minutes` : ' immediately'}?`)
            .setColor('#FF9900')
            .addFields(
                { name: ':clock3: Delay', value: delayMinutes > 0 ? `${delayMinutes} minutes` : 'Immediate', inline: true },
                { name: ':exclamation: Warning', value: 'This will disconnect all players!', inline: true }
            )
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('confirm_restart')
                    .setLabel('Confirm Restart')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('cancel_restart')
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary)
            );

        await interaction.followUp({ 
            embeds: [confirmEmbed], 
            components: [row],
            ephemeral: true 
        });

        const filter = i => ['confirm_restart', 'cancel_restart'].includes(i.customId) && i.user.id === interaction.user.id;
        
        try {
            const confirmation = await interaction.channel.awaitMessageComponent({ 
                filter, 
                time: 30000 
            });

            if (confirmation.customId === 'confirm_restart') {
                const response = await fetch(`http://localhost:${CONFIG.httpPort}/api/server/restart`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        delay: delayMinutes * 60,
                        admin: interaction.user.tag,
                        user_id: interaction.user.id
                    })
                });

                if (response.ok) {
                    const result = await response.json();
                    
                    const successEmbed = new EmbedBuilder()
                        .setTitle(':arrows_counterclockwise: Server Restart Scheduled')
                        .setDescription(`Server restart has been scheduled${delayMinutes > 0 ? ` for ${delayMinutes} minutes` : ' immediately'}.`)
                        .setColor('#00FF00')
                        .addFields(
                            { name: ':id: Schedule ID', value: result.scheduleId || 'N/A', inline: true },
                            { name: ':clock3: Execution Time', value: delayMinutes > 0 ? `<t:${Math.floor((Date.now() + delayMinutes * 60000) / 1000)}:R>` : 'Now', inline: true },
                            { name: ':bust_in_silhouette: Admin', value: interaction.user.tag, inline: true }
                        )
                        .setTimestamp();

                    await confirmation.update({ embeds: [successEmbed], components: [] });
                    writeLog(`Server restart scheduled by ${interaction.user.tag} (ID: ${interaction.user.id}) with ${delayMinutes} minute delay`, 'Debug');
                } else {
                    throw new Error(`PowerShell API returned ${response.status}`);
                }
            } else {
                await confirmation.update({ 
                    content: ':x: Server restart cancelled.',
                    embeds: [],
                    components: []
                });
            }
        } catch (timeoutError) {
            await interaction.editReply({ 
                content: ':clock3: Command timed out. Server restart cancelled.',
                embeds: [],
                components: []
            });
        }
        
    } catch (error) {
        writeLog(`Server restart command error: ${error.message}`, 'Error');
        await interaction.followUp({ 
            content: ':x: Failed to schedule server restart.',
            ephemeral: true 
        });
    }
}

// Server Stop Command
async function handleServerStopCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
        const hasPermission = await checkAdminPermission(interaction.user.id, interaction);
        if (!hasPermission) {
            await interaction.followUp({ 
                content: ':lock: You do not have permission to stop the server.',
                ephemeral: true 
            });
            return;
        }

        const delayMinutes = interaction.options.getInteger('minutes') || 0;
        
        const confirmEmbed = new EmbedBuilder()
            .setTitle(':warning: Server Stop Confirmation')
            .setDescription(`Are you sure you want to stop the server${delayMinutes > 0 ? ` in ${delayMinutes} minutes` : ' immediately'}?`)
            .setColor('#FF0000')
            .addFields(
                { name: ':clock3: Delay', value: delayMinutes > 0 ? `${delayMinutes} minutes` : 'Immediate', inline: true },
                { name: ':warning: Warning', value: 'Server will be completely stopped!', inline: true }
            )
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('confirm_stop')
                    .setLabel('Confirm Stop')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('cancel_stop')
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary)
            );

        await interaction.followUp({ 
            embeds: [confirmEmbed], 
            components: [row],
            ephemeral: true 
        });

        const filter = i => ['confirm_stop', 'cancel_stop'].includes(i.customId) && i.user.id === interaction.user.id;
        
        try {
            const confirmation = await interaction.channel.awaitMessageComponent({ 
                filter, 
                time: 30000 
            });

            if (confirmation.customId === 'confirm_stop') {
                const response = await fetch(`http://localhost:${CONFIG.httpPort}/api/server/stop`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        delay: delayMinutes * 60,
                        admin: interaction.user.tag,
                        user_id: interaction.user.id
                    })
                });

                if (response.ok) {
                    const result = await response.json();
                    
                    const successEmbed = new EmbedBuilder()
                        .setTitle(':octagonal_sign: Server Stop Scheduled')
                        .setDescription(`Server stop has been scheduled${delayMinutes > 0 ? ` for ${delayMinutes} minutes` : ' immediately'}.`)
                        .setColor('#FF0000')
                        .addFields(
                            { name: ':id: Schedule ID', value: result.scheduleId || 'N/A', inline: true },
                            { name: ':clock3: Execution Time', value: delayMinutes > 0 ? `<t:${Math.floor((Date.now() + delayMinutes * 60000) / 1000)}:R>` : 'Now', inline: true },
                            { name: ':bust_in_silhouette: Admin', value: interaction.user.tag, inline: true }
                        )
                        .setTimestamp();

                    await confirmation.update({ embeds: [successEmbed], components: [] });
                    writeLog(`Server stop scheduled by ${interaction.user.tag} (ID: ${interaction.user.id}) with ${delayMinutes} minute delay`, 'Debug');
                } else {
                    throw new Error(`PowerShell API returned ${response.status}`);
                }
            } else {
                await confirmation.update({ 
                    content: ':x: Server stop cancelled.',
                    embeds: [],
                    components: []
                });
            }
        } catch (timeoutError) {
            await interaction.editReply({ 
                content: ':clock3: Command timed out. Server stop cancelled.',
                embeds: [],
                components: []
            });
        }
        
    } catch (error) {
        writeLog(`Server stop command error: ${error.message}`, 'Error');
        await interaction.followUp({ 
            content: ':x: Failed to schedule server stop.',
            ephemeral: true 
        });
    }
}

// Server Start Command
async function handleServerStartCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
        const hasPermission = await checkAdminPermission(interaction.user.id, interaction);
        if (!hasPermission) {
            await interaction.followUp({ 
                content: ':lock: You do not have permission to start the server.',
                ephemeral: true 
            });
            return;
        }

        const response = await fetch(`http://localhost:${CONFIG.httpPort}/api/server/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                admin: interaction.user.tag,
                user_id: interaction.user.id
            })
        });

        if (response.ok) {
            const result = await response.json();
            
            const embed = new EmbedBuilder()
                .setTitle(':arrow_forward: Server Start Initiated')
                .setDescription('Server start command has been executed.')
                .setColor('#00FF00')
                .addFields(
                    { name: ':bust_in_silhouette: Admin', value: interaction.user.tag, inline: true },
                    { name: ':clock3: Started At', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true },
                    { name: ':information_source: Status', value: 'Starting...', inline: true }
                )
                .setFooter({ text: 'Server should be online within a few minutes.' })
                .setTimestamp();

            await interaction.followUp({ embeds: [embed], ephemeral: true });
            writeLog(`Server start initiated by ${interaction.user.tag} (ID: ${interaction.user.id})`, 'Debug');
        } else {
            throw new Error(`PowerShell API returned ${response.status}`);
        }
        
    } catch (error) {
        writeLog(`Server start command error: ${error.message}`, 'Error');
        await interaction.followUp({ 
            content: ':x: Failed to start server.',
            ephemeral: true 
        });
    }
}

// Additional server commands would go here...
// (handleServerUpdateCommand, handleServerValidateCommand, etc.)

// Server Update Command
async function handleServerUpdateCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
        const hasPermission = await checkAdminPermission(interaction.user.id, interaction);
        if (!hasPermission) {
            await interaction.followUp({ 
                content: ':lock: You do not have permission to update the server.',
                ephemeral: true 
            });
            return;
        }

        const confirmEmbed = new EmbedBuilder()
            .setTitle(':warning: Server Update Confirmation')
            .setDescription('Are you sure you want to update the server? This will restart the server!')
            .setColor('#FF9900')
            .addFields(
                { name: ':exclamation: Warning', value: 'Server will be restarted during update!', inline: true },
                { name: ':clock3: Duration', value: 'May take several minutes', inline: true }
            )
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('confirm_update')
                    .setLabel('Confirm Update')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('cancel_update')
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary)
            );

        await interaction.followUp({ 
            embeds: [confirmEmbed], 
            components: [row],
            ephemeral: true 
        });

        const filter = i => ['confirm_update', 'cancel_update'].includes(i.customId) && i.user.id === interaction.user.id;
        
        try {
            const confirmation = await interaction.channel.awaitMessageComponent({ 
                filter, 
                time: 30000 
            });

            if (confirmation.customId === 'confirm_update') {
                const response = await fetch(`http://localhost:${CONFIG.httpPort}/api/server/update`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        admin: interaction.user.tag,
                        user_id: interaction.user.id
                    })
                });

                if (response.ok) {
                    const result = await response.json();
                    
                    const successEmbed = new EmbedBuilder()
                        .setTitle(':arrows_counterclockwise: Server Update Initiated')
                        .setDescription('Server update has been started.')
                        .setColor('#00FF00')
                        .addFields(
                            { name: ':bust_in_silhouette: Admin', value: interaction.user.tag, inline: true },
                            { name: ':clock3: Started At', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true },
                            { name: ':information_source: Status', value: 'Updating...', inline: true }
                        )
                        .setFooter({ text: 'Server will restart automatically after update.' })
                        .setTimestamp();

                    await confirmation.update({ embeds: [successEmbed], components: [] });
                    writeLog(`Server update initiated by ${interaction.user.tag} (ID: ${interaction.user.id})`, 'Debug');
                } else {
                    throw new Error(`PowerShell API returned ${response.status}`);
                }
            } else {
                await confirmation.update({ 
                    content: ':x: Server update cancelled.',
                    embeds: [],
                    components: []
                });
            }
        } catch (timeoutError) {
            await interaction.editReply({ 
                content: ':clock3: Command timed out. Server update cancelled.',
                embeds: [],
                components: []
            });
        }
        
    } catch (error) {
        writeLog(`Server update command error: ${error.message}`, 'Error');
        await interaction.followUp({ 
            content: ':x: Failed to initiate server update.',
            ephemeral: true 
        });
    }
}

// Server Validate Command
async function handleServerValidateCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
        const hasPermission = await checkAdminPermission(interaction.user.id, interaction);
        if (!hasPermission) {
            await interaction.followUp({ 
                content: ':lock: You do not have permission to validate the server.',
                ephemeral: true 
            });
            return;
        }

        const response = await fetch(`http://localhost:${CONFIG.httpPort}/api/server/validate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                admin: interaction.user.tag,
                user_id: interaction.user.id
            })
        });

        if (response.ok) {
            const result = await response.json();
            
            const embed = new EmbedBuilder()
                .setTitle(':white_check_mark: Server Validation')
                .setDescription('Server file validation completed.')
                .addFields(
                    { name: ':bust_in_silhouette: Admin', value: interaction.user.tag, inline: true },
                    { name: ':file_folder: Files Checked', value: result.filesChecked || 'Completed', inline: true },
                    { name: ':shield: Status', value: result.valid ? ':white_check_mark: Valid' : ':x: Issues Found', inline: true },
                    { name: ':clock3: Validated At', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true }
                )
                .setColor(result.valid ? '#00FF00' : '#FF9900')
                .setTimestamp();

            if (result.issues && result.issues.length > 0) {
                embed.addFields({ 
                    name: ':warning: Issues Found', 
                    value: result.issues.slice(0, 3).join('\n') || 'Check logs for details',
                    inline: false 
                });
            }

            await interaction.followUp({ embeds: [embed], ephemeral: true });
            writeLog(`Server validation completed by ${interaction.user.tag} (ID: ${interaction.user.id})`, 'Debug');
        } else {
            throw new Error(`PowerShell API returned ${response.status}`);
        }
        
    } catch (error) {
        writeLog(`Server validate command error: ${error.message}`, 'Error');
        await interaction.followUp({ 
            content: ':x: Failed to validate server.',
            ephemeral: true 
        });
    }
}

// Server Backup Command
async function handleServerBackupCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
        const hasPermission = await checkAdminPermission(interaction.user.id, interaction);
        if (!hasPermission) {
            await interaction.followUp({ 
                content: ':lock: You do not have permission to create server backups.',
                ephemeral: true 
            });
            return;
        }

        const response = await fetch(`http://localhost:${CONFIG.httpPort}/api/server/backup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                admin: interaction.user.tag,
                user_id: interaction.user.id
            })
        });

        if (response.ok) {
            const result = await response.json();
            
            const embed = new EmbedBuilder()
                .setTitle(':floppy_disk: Server Backup Created')
                .setDescription('Server backup has been created successfully.')
                .addFields(
                    { name: ':bust_in_silhouette: Admin', value: interaction.user.tag, inline: true },
                    { name: ':file_folder: Backup Name', value: result.backupName || 'Generated', inline: true },
                    { name: ':clock3: Created At', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true },
                    { name: ':file_cabinet: Location', value: result.path || 'backups/', inline: true }
                )
                .setColor('#00FF00')
                .setFooter({ text: 'Backup saved to server backup directory' })
                .setTimestamp();

            await interaction.followUp({ embeds: [embed], ephemeral: true });
            writeLog(`Server backup created by ${interaction.user.tag} (ID: ${interaction.user.id})`, 'Debug');
        } else {
            throw new Error(`PowerShell API returned ${response.status}`);
        }
        
    } catch (error) {
        writeLog(`Server backup command error: ${error.message}`, 'Error');
        await interaction.followUp({ 
            content: ':x: Failed to create server backup.',
            ephemeral: true 
        });
    }
}

// Server Cancel Command
async function handleServerCancelCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
        const hasPermission = await checkAdminPermission(interaction.user.id, interaction);
        if (!hasPermission) {
            await interaction.followUp({ 
                content: ':lock: You do not have permission to cancel scheduled operations.',
                ephemeral: true 
            });
            return;
        }

        const response = await fetch(`http://localhost:${CONFIG.httpPort}/api/server/scheduled`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
            const result = await response.json();
            
            if (!result.scheduled || result.scheduled.length === 0) {
                await interaction.followUp({ 
                    content: ':information_source: No scheduled operations to cancel.',
                    ephemeral: true 
                });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle(':x: Cancel Scheduled Operations')
                .setDescription('Select operations to cancel:')
                .setColor('#FF9900')
                .setTimestamp();

            const options = result.scheduled.slice(0, 25).map((op, index) => ({
                label: `${op.type} - ${op.admin}`,
                description: `Scheduled for ${new Date(op.scheduledTime).toLocaleString()}`,
                value: op.id.toString()
            }));

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('cancel_operations')
                .setPlaceholder('Select operations to cancel...')
                .setMinValues(1)
                .setMaxValues(Math.min(options.length, 10))
                .addOptions(options);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await interaction.followUp({ 
                embeds: [embed], 
                components: [row],
                ephemeral: true 
            });

            const filter = i => i.customId === 'cancel_operations' && i.user.id === interaction.user.id;
            
            try {
                const selection = await interaction.channel.awaitMessageComponent({ 
                    filter, 
                    time: 30000 
                });

                const cancelResponse = await fetch(`http://localhost:${CONFIG.httpPort}/api/server/cancel`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        operationIds: selection.values,
                        admin: interaction.user.tag,
                        user_id: interaction.user.id
                    })
                });

                if (cancelResponse.ok) {
                    const cancelResult = await cancelResponse.json();
                    
                    await selection.update({ 
                        content: `:white_check_mark: Successfully cancelled ${cancelResult.cancelled || selection.values.length} scheduled operation(s).`,
                        embeds: [],
                        components: []
                    });
                    
                    writeLog(`Scheduled operations cancelled by ${interaction.user.tag} (ID: ${interaction.user.id}) - IDs: ${selection.values.join(', ')}`, 'Debug');
                } else {
                    throw new Error(`Cancel API returned ${cancelResponse.status}`);
                }
            } catch (timeoutError) {
                await interaction.editReply({ 
                    content: ':clock3: Selection timed out. No operations cancelled.',
                    embeds: [],
                    components: []
                });
            }
        } else {
            throw new Error(`PowerShell API returned ${response.status}`);
        }
        
    } catch (error) {
        writeLog(`Server cancel command error: ${error.message}`, 'Error');
        await interaction.followUp({ 
            content: ':x: Failed to cancel scheduled operations.',
            ephemeral: true 
        });
    }
}

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
        
        let query = '';
        let params = [];
        
        if (steamId) {
            query = 'SELECT * FROM a_user_profile WHERE steam_id = ?';
            params = [steamId];
        } else if (playerName) {
            query = 'SELECT * FROM a_user_profile WHERE user_name LIKE ?';
            params = [`%${playerName}%`];
        } else {
            await interaction.followUp({ content: ':x: Please provide either a Steam ID or player name.', ephemeral: true });
            return;
        }
        
        const db = getDb();
        db.all(query, params, async (err, players) => {
            if (err) {
                writeLog(`Player search error: ${err.message}`, 'Error');
                await interaction.followUp({ content: ':x: Failed to search for players.', ephemeral: true });
                return;
            }
            
            if (!players || players.length === 0) {
                await interaction.followUp({ content: ':information_source: No players found matching your search.', ephemeral: true });
                return;
            }
            
            const embed = new EmbedBuilder()
                .setTitle(':mag: Player Search Results')
                .setDescription(`Found ${players.length} player(s)`)
                .setColor('#00FF00')
                .setTimestamp();
            
            // Show up to 10 players
            players.slice(0, 10).forEach((player, index) => {
                embed.addFields({
                    name: `${index + 1}. ${player.user_name || 'Unknown'}`,
                    value: `**Steam ID:** ${player.steam_id}\n**Online:** ${player.user_is_online ? ':green_circle: Yes' : ':red_circle: No'}\n**Last Login:** ${player.last_login_time ? new Date(player.last_login_time).toLocaleString() : 'Never'}`,
                    inline: true
                });
            });
            
            if (players.length > 10) {
                embed.setFooter({ text: `Showing 10 of ${players.length} results` });
            }
            
            await interaction.followUp({ embeds: [embed], ephemeral: true });
            writeLog(`Player search completed by admin ${interaction.user.tag}: ${players.length} results`, 'Debug');
        });
        
    } catch (error) {
        writeLog(`Player search command error: ${error.message}`, 'Error');
        await interaction.followUp({ content: ':x: An error occurred while searching for players.', ephemeral: true });
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
                writeLog(`Online players query error: ${err.message}`, 'Error');
                await interaction.followUp({ content: ':x: Failed to get online players.', ephemeral: true });
                return;
            }
            
            if (!players || players.length === 0) {
                await interaction.followUp({ content: ':information_source: No players are currently online.', ephemeral: true });
                return;
            }
            
            const embed = new EmbedBuilder()
                .setTitle(':green_circle: Online Players')
                .setDescription(`${players.length} player(s) currently online`)
                .setColor('#00FF00')
                .setTimestamp();
            
            // Show up to 15 players
            players.slice(0, 15).forEach((player, index) => {
                embed.addFields({
                    name: `${index + 1}. ${player.user_name || 'Unknown'}`,
                    value: `**Steam ID:** ${player.steam_id}\n**Login:** ${player.last_login_time ? new Date(player.last_login_time).toLocaleString() : 'Unknown'}`,
                    inline: true
                });
            });
            
            if (players.length > 15) {
                embed.setFooter({ text: `Showing 15 of ${players.length} online players` });
            }
            
            await interaction.followUp({ embeds: [embed], ephemeral: true });
            writeLog(`Online players command completed by admin ${interaction.user.tag}: ${players.length} online`, 'Debug');
        });
        
    } catch (error) {
        writeLog(`Online players command error: ${error.message}`, 'Error');
        await interaction.followUp({ content: ':x: An error occurred while getting online players.', ephemeral: true });
    }
}

// Bot Status Command
async function handleBotStatusCommand(interaction, client) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
        const hasPermission = await checkAdminPermission(interaction.user.id, interaction);
        if (!hasPermission) {
            await interaction.followUp({ 
                content: ':lock: You do not have permission to view bot status.',
                ephemeral: true 
            });
            return;
        }

        // Get bot statistics
        const db = getDb();
        db.get(`
            SELECT 
                COUNT(*) as total_players,
                SUM(CASE WHEN user_is_online = 1 THEN 1 ELSE 0 END) as online_players
            FROM a_user_profile 
            WHERE steam_id IS NOT NULL AND steam_id != ''
        `, async (err, stats) => {
            const uptime = process.uptime();
            const uptimeFormatted = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;
            const memoryUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

            const embed = new EmbedBuilder()
                .setTitle(':robot: Bot Status')
                .setDescription('**Discord Bot System Status**')
                .addFields(
                    { name: ':green_circle: Status', value: 'Online & Healthy', inline: true },
                    { name: ':clock3: Uptime', value: uptimeFormatted, inline: true },
                    { name: ':zap: Memory Usage', value: `${memoryUsage} MB`, inline: true },
                    { name: ':satellite: Ping', value: `${client.ws.ping}ms`, inline: true },
                    { name: ':homes: Guilds', value: `${client.guilds.cache.size}`, inline: true },
                    { name: ':busts_in_silhouette: Users', value: `${client.users.cache.size}`, inline: true },
                    { name: ':electric_plug: Database', value: err ? ':red_circle: Error' : ':green_circle: Connected', inline: true },
                    { name: ':chart_with_upwards_trend: Total Players', value: `${stats?.total_players || 0}`, inline: true },
                    { name: ':green_circle: Online Players', value: `${stats?.online_players || 0}`, inline: true },
                    { name: ':gear: API Port', value: `${CONFIG.httpPort}`, inline: true },
                    { name: ':file_folder: Database', value: CONFIG.databasePath, inline: true },
                    { name: ':shield: Admin Check', value: ':white_check_mark: Working', inline: true }
                )
                .setColor('#00FF00')
                .setFooter({ 
                    text: 'SCUM Server Automation v2.0',
                    iconURL: 'https://playhub.cz/scum/manager/server_automation_discord.png'
                })
                .setTimestamp();

            await interaction.followUp({ embeds: [embed], ephemeral: true });
            writeLog(`Bot status command completed for: ${interaction.user.username}`, 'Debug');
        });
        
    } catch (error) {
        writeLog(`Bot status command error: ${error.message}`, 'Error');
        await interaction.followUp({ 
            content: ':x: Failed to get bot status.',
            ephemeral: true 
        });
    }
}

module.exports = {
    handleServerInfoCommand,
    handleServerStatusCommand,
    handleServerRestartCommand,
    handleServerStopCommand,
    handleServerStartCommand,
    handleServerUpdateCommand,
    handleServerValidateCommand,
    handleServerBackupCommand,
    handleServerCancelCommand,
    handleBotStatusCommand
};
