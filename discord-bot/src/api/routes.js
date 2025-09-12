const express = require('express');
const { exec } = require('child_process');
const { writeLog, addScheduledOperation, getScheduledOperations, removeScheduledOperations, removeScheduledOperationByScheduleId } = require('../utils/utils');
const { getDb } = require('../utils/database');
const CONFIG = require('../config/config');
const activityManager = require('../utils/activityManager');
const notificationHandler = require('../utils/notificationHandler');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const router = express.Router();

// Bot status endpoint
router.get('/status', async (req, res) => {
    try {
        // Check if Discord client is available and ready
        const discordReady = global.discordClient && global.discordClient.isReady();
        const activityStatus = activityManager.getStatus();
        
        res.json({
            status: discordReady ? 'online' : 'offline',
            ready: discordReady,
            uptime: global.discordClient ? process.uptime() : 0,
            timestamp: new Date().toISOString(),
            activityManager: activityStatus
        });
    } catch (error) {
        writeLog(`Status API error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to get status' });
    }
});

// Notification endpoint
router.post('/notification', async (req, res) => {
    try {
        const { type, data, timestamp } = req.body;
        
        if (!type) {
            return res.status(400).json({ error: 'Missing notification type' });
        }
        
        writeLog(`Discord notification received: ${type}`, 'Debug');
        
        // Send notification using notification handler
        const result = await notificationHandler.sendNotification(type, data || {});
        
        if (result.success) {
            writeLog(`Notification sent successfully: ${type} to ${result.channelsSent}/${result.totalChannels} channels`, 'Debug');
            res.json({ 
                success: true, 
                message: 'Notification sent to Discord',
                type: type,
                channelsSent: result.channelsSent,
                totalChannels: result.totalChannels,
                receivedAt: new Date().toISOString()
            });
        } else {
            writeLog(`Notification failed: ${type} - ${result.error}`, 'Error');
            res.status(500).json({ 
                success: false, 
                message: 'Failed to send notification to Discord',
                type: type,
                error: result.error 
            });
        }
        
    } catch (error) {
        writeLog(`Notification API error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to process notification' });
    }
});

// Send message endpoint for compatibility with PowerShell scripts
router.post('/send-message', async (req, res) => {
    try {
        const { channelId, content, embeds, components, files, updateMessageId } = req.body;
        
        if (!channelId) {
            return res.status(400).json({ error: 'Missing channelId' });
        }
        
        writeLog(`Send message request for channel: ${channelId}`, 'Debug');
        
        // Get the Discord client from global scope (set by main bot file)
        if (!global.discordClient || !global.discordClient.isReady()) {
            return res.status(503).json({ error: 'Discord bot not ready' });
        }
        
        try {
            const channel = await global.discordClient.channels.fetch(channelId);
            
            if (!channel) {
                return res.status(404).json({ error: 'Channel not found' });
            }
            
            // Prepare message options
            const messageOptions = {};
            
            if (content && content.trim()) {
                messageOptions.content = content;
            }
            
            if (embeds && embeds.length > 0) {
                messageOptions.embeds = embeds;
            }
            
            if (components && components.length > 0) {
                messageOptions.components = components;
            }
            
            let message;
            if (updateMessageId) {
                // Update existing message
                const existingMessage = await channel.messages.fetch(updateMessageId);
                message = await existingMessage.edit(messageOptions);
            } else {
                // Send new message
                message = await channel.send(messageOptions);
            }
            
            res.json({ 
                success: true, 
                messageId: message.id,
                channelId: channel.id
            });
            
        } catch (discordError) {
            writeLog(`Discord API error: ${discordError.message}`, 'Error');
            res.status(500).json({ error: `Discord API error: ${discordError.message}` });
        }
        
    } catch (error) {
        writeLog(`Send message API error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Set bot activity endpoint - DISABLED - Activity manager handles this automatically
router.post('/set-activity', async (req, res) => {
    // Activity is now managed automatically by activity manager
    // This endpoint is disabled to prevent conflicts
    res.json({ 
        success: false, 
        message: 'Activity is managed automatically. Use dynamic activity configuration instead.',
        info: 'Configure Discord.Presence.DynamicActivity in config file'
    });
});

// Account linking endpoint
router.post('/link', async (req, res) => {
    try {
        const { discordUserId, registrationCode } = req.body;
        
        const db = getDb();
        
        // Validate registration code
        db.get(`
            SELECT * FROM a_discord_registration_codes 
            WHERE registration_code = ? AND used = 0 AND expires_at > datetime('now')
        `, [registrationCode], function(err, pending) {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            if (!pending) {
                return res.json({ 
                    success: false, 
                    message: 'Invalid or expired registration code.' 
                });
            }

            // Check if Steam ID is already linked
            db.get(`
                SELECT * FROM a_discord_profiles WHERE steam_id = ?
            `, [pending.steam_id], function(err, existing) {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Database error' });
                }

                if (existing) {
                    return res.json({ 
                        success: false, 
                        message: 'This Steam account is already linked to another Discord account.' 
                    });
                }

                // Mark code as used
                db.run(`
                    UPDATE a_discord_registration_codes 
                    SET used = 1, used_at = datetime('now') 
                    WHERE registration_code = ?
                `, [registrationCode], function(err) {
                    if (err) {
                        console.error('Database error:', err);
                        return res.status(500).json({ error: 'Database error' });
                    }

                    // Create Discord profile link
                    db.run(`
                        INSERT INTO a_discord_profiles (discord_user_id, steam_id, linked_at, is_active)
                        VALUES (?, ?, datetime('now'), 1)
                    `, [discordUserId, pending.steam_id], function(err) {
                        if (err) {
                            console.error('Database error:', err);
                            return res.status(500).json({ error: 'Database error' });
                        }

                        writeLog(`Account linked via API: Discord ${discordUserId} -> Steam ${pending.steam_id}`, 'Debug');
                        
                        res.json({ 
                            success: true, 
                            steamId: pending.steam_id,
                            message: 'Account successfully linked!' 
                        });
                    });
                });
            });
        });
    } catch (error) {
        writeLog(`Account linking API error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to link account' });
    }
});

// Connect command endpoint (for in-game chat)
router.post('/connect', async (req, res) => {
    try {
        const { steamId, playerName, registrationCode } = req.body;
        
        if (!steamId || !registrationCode) {
            return res.status(400).json({ error: 'Missing steamId or registrationCode' });
        }
        
        const db = getDb();
        
        // Find pending registration with this code
        db.get(`
            SELECT * FROM a_pending_registrations 
            WHERE registration_code = ? AND used = 0 AND expires_at > datetime('now')
        `, [registrationCode], function(err, pending) {
            if (err) {
                writeLog(`Database error: ${err.message}`, 'Error');
                return res.status(500).json({ error: 'Database error' });
            }

            if (!pending) {
                writeLog(`Invalid or expired registration code: ${registrationCode}`, 'Warning');
                return res.json({ 
                    success: false, 
                    message: 'Invalid or expired registration code.' 
                });
            }

            // Check if Steam ID is already linked
            db.get(`
                SELECT * FROM a_discord_profiles WHERE steam_id = ?
            `, [steamId], function(err, existing) {
                if (err) {
                    writeLog(`Database error: ${err.message}`, 'Error');
                    return res.status(500).json({ error: 'Database error' });
                }

                if (existing) {
                    return res.json({ 
                        success: false, 
                        message: 'This Steam account is already linked to another Discord account.' 
                    });
                }

                // Check if Discord user is already linked to another Steam account
                db.get(`
                    SELECT * FROM a_discord_profiles WHERE discord_user_id = ?
                `, [pending.discord_user_id], function(err, existingDiscord) {
                    if (err) {
                        writeLog(`Database error: ${err.message}`, 'Error');
                        return res.status(500).json({ error: 'Database error' });
                    }

                    if (existingDiscord) {
                        return res.json({ 
                            success: false, 
                            message: 'This Discord account is already linked to another Steam account.' 
                        });
                    }

                    // Mark pending registration as used and clean up
                    db.run(`
                        DELETE FROM a_pending_registrations 
                        WHERE registration_code = ?
                    `, [registrationCode], function(err) {
                        if (err) {
                            writeLog(`Database error: ${err.message}`, 'Error');
                            return res.status(500).json({ error: 'Database error' });
                        }

                        // Create Discord profile link
                        db.run(`
                            INSERT INTO a_discord_profiles (discord_user_id, discord_username, steam_id, player_name, linked_at)
                            VALUES (?, ?, ?, ?, datetime('now'))
                        `, [pending.discord_user_id, pending.discord_username, steamId, playerName], async function(err) {
                            if (err) {
                                writeLog(`Database error: ${err.message}`, 'Error');
                                return res.status(500).json({ error: 'Database error' });
                            }

                            writeLog(`Account linked via connect command: Discord ${pending.discord_user_id} (${pending.discord_username}) -> Steam ${steamId} (${playerName})`, 'Debug');
                            
                            // Send DM to the user about successful linking
                            try {
                                if (global.discordClient && global.discordClient.isReady()) {
                                    const user = await global.discordClient.users.fetch(pending.discord_user_id);
                                    if (user) {
                                        const { EmbedBuilder } = require('discord.js');
                                        const embed = new EmbedBuilder()
                                            .setTitle(':white_check_mark: Account Successfully Linked!')
                                            .setDescription('Your Discord account has been successfully linked to your SCUM character.')
                                            .addFields(
                                                { 
                                                    name: ':id: Player Name', 
                                                    value: playerName, 
                                                    inline: true 
                                                },
                                                { 
                                                    name: ':key: Steam ID', 
                                                    value: `\`${steamId}\``, 
                                                    inline: true 
                                                },
                                                { 
                                                    name: ':calendar: Linked At', 
                                                    value: `<t:${Math.floor(Date.now() / 1000)}:F>`, 
                                                    inline: false 
                                                },
                                                { 
                                                    name: ':information_source: What now?', 
                                                    value: 'You can now use Discord commands and receive notifications. Use `/unlink-account` if you ever want to unlink.', 
                                                    inline: false 
                                                }
                                            )
                                            .setColor('#00FF00')
                                            .setTimestamp();

                                        await user.send({ embeds: [embed] });
                                        writeLog(`Account linking DM sent to ${pending.discord_username}`, 'Debug');
                                    }
                                }
                            } catch (dmError) {
                                writeLog(`Failed to send account linking DM to ${pending.discord_username}: ${dmError.message}`, 'Warning');
                                // Don't fail the whole operation if DM fails
                            }
                            
                            res.json({ 
                                success: true, 
                                steamId: steamId,
                                discordUserId: pending.discord_user_id,
                                message: 'Account successfully linked!' 
                            });
                        });
                    });
                });
            });
        });
    } catch (error) {
        writeLog(`Connect command API error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to process connect command' });
    }
});

// Unlink account endpoint
router.post('/unlink', async (req, res) => {
    try {
        const { discordUserId } = req.body;
        
        if (!discordUserId) {
            return res.status(400).json({ error: 'Missing discordUserId' });
        }
        
        const db = getDb();
        
        // Check if account is linked
        db.get(`
            SELECT * FROM a_discord_profiles WHERE discord_user_id = ?
        `, [discordUserId], function(err, profile) {
            if (err) {
                writeLog(`Database error: ${err.message}`, 'Error');
                return res.status(500).json({ error: 'Database error' });
            }

            if (!profile) {
                return res.json({ 
                    success: false, 
                    message: 'No linked account found.' 
                });
            }

            // Remove the Discord profile link
            db.run(`
                DELETE FROM a_discord_profiles WHERE discord_user_id = ?
            `, [discordUserId], function(err) {
                if (err) {
                    writeLog(`Database error: ${err.message}`, 'Error');
                    return res.status(500).json({ error: 'Database error' });
                }

                // Also clean up any pending registrations for this user
                db.run(`
                    DELETE FROM a_pending_registrations WHERE discord_user_id = ?
                `, [discordUserId], async function(cleanupErr) {
                    if (cleanupErr) {
                        writeLog(`Warning: Failed to clean up pending registrations for user ${discordUserId}: ${cleanupErr.message}`, 'Warning');
                    }

                    writeLog(`Account unlinked: Discord ${discordUserId} -> Steam ${profile.steam_id}`, 'Debug');
                    
                    // Send DM to the user about successful unlinking
                    try {
                        if (global.discordClient && global.discordClient.isReady()) {
                            const user = await global.discordClient.users.fetch(discordUserId);
                            if (user) {
                                const { EmbedBuilder } = require('discord.js');
                                const embed = new EmbedBuilder()
                                    .setTitle(':broken_chain: Account Successfully Unlinked')
                                    .setDescription('Your Discord account has been successfully unlinked from your SCUM character.')
                                    .addFields(
                                        { 
                                            name: ':information_source: Previously linked to', 
                                            value: `**Player:** ${profile.player_name || 'Unknown'}\n**Steam ID:** \`${profile.steam_id}\``, 
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

                                await user.send({ embeds: [embed] });
                                writeLog(`Account unlinking DM sent to user ${discordUserId}`, 'Debug');
                            }
                        }
                    } catch (dmError) {
                        writeLog(`Failed to send account unlinking DM to user ${discordUserId}: ${dmError.message}`, 'Warning');
                        // Don't fail the whole operation if DM fails
                    }
                    
                    res.json({ 
                        success: true, 
                        steamId: profile.steam_id,
                        message: 'Account successfully unlinked!' 
                    });
                });
            });
        });
    } catch (error) {
        writeLog(`Account unlinking API error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to unlink account' });
    }
});

// Get player profile
router.get('/profile/:discordUserId', async (req, res) => {
    try {
        const { discordUserId } = req.params;
        
        const db = getDb();
        
        db.get(`
            SELECT dp.*, up.user_name, up.user_is_online, up.last_login_time, up.first_login_time
            FROM a_discord_profiles dp
            LEFT JOIN a_user_profile up ON dp.steam_id = up.steam_id
            WHERE dp.discord_user_id = ? AND dp.is_active = 1
        `, [discordUserId], (err, profile) => {
            if (err) {
                writeLog(`Profile API error: ${err.message}`, 'Error');
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (!profile) {
                return res.json({ linked: false });
            }
            
            res.json({
                linked: true,
                steamId: profile.steam_id,
                playerName: profile.user_name,
                isOnline: profile.user_is_online === 1,
                lastLogin: profile.last_login_time,
                firstLogin: profile.first_login_time,
                linkedAt: profile.linked_at
            });
        });
    } catch (error) {
        writeLog(`Profile API error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to get profile' });
    }
});

// Search messages endpoint
router.post('/search-messages', async (req, res) => {
    try {
        const { channelId, searchText, messageId, limit = 20 } = req.body;
        
        if (!channelId) {
            return res.status(400).json({ error: 'Missing channelId' });
        }
        
        writeLog(`Search messages request: channel ${channelId}, text: "${searchText}", messageId: ${messageId}`, 'Debug');
        
        // Get the Discord client from global scope
        if (!global.discordClient || !global.discordClient.isReady()) {
            return res.status(503).json({ error: 'Discord bot not ready' });
        }
        
        try {
            const channel = await global.discordClient.channels.fetch(channelId);
            if (!channel) {
                return res.status(404).json({ error: 'Channel not found' });
            }
            
            // If searching for specific message ID, try to fetch it directly
            if (messageId) {
                try {
                    const message = await channel.messages.fetch(messageId);
                    if (message) {
                        return res.json({
                            success: true,
                            messages: [{
                                id: message.id,
                                content: message.content,
                                embeds: message.embeds.map(embed => ({
                                    title: embed.title,
                                    description: embed.description,
                                    color: embed.color,
                                    fields: embed.fields
                                })),
                                createdAt: message.createdAt.toISOString()
                            }]
                        });
                    }
                } catch (messageError) {
                    // Message not found or deleted
                    return res.json({ success: true, messages: [] });
                }
            }
            
            // Fetch recent messages for text search
            const messages = await channel.messages.fetch({ limit: limit });
            const searchResults = [];
            
            messages.forEach(message => {
                if (searchText) {
                    // Search in message content or embed titles
                    const contentMatch = message.content && message.content.includes(searchText);
                    const embedMatch = message.embeds && message.embeds.some(embed => 
                        (embed.title && embed.title.includes(searchText)) ||
                        (embed.description && embed.description.includes(searchText))
                    );
                    
                    if (contentMatch || embedMatch) {
                        searchResults.push({
                            id: message.id,
                            content: message.content,
                            embeds: message.embeds.map(embed => ({
                                title: embed.title,
                                description: embed.description,
                                color: embed.color,
                                fields: embed.fields
                            })),
                            createdAt: message.createdAt.toISOString()
                        });
                    }
                } else {
                    // Return all messages if no search text
                    searchResults.push({
                        id: message.id,
                        content: message.content,
                        embeds: message.embeds.map(embed => ({
                            title: embed.title,
                            description: embed.description,
                            color: embed.color,
                            fields: embed.fields
                        })),
                        createdAt: message.createdAt.toISOString()
                    });
                }
            });
            
            res.json({ 
                success: true, 
                messages: searchResults,
                count: searchResults.length
            });
            
        } catch (discordError) {
            writeLog(`Discord API error: ${discordError.message}`, 'Error');
            res.status(500).json({ error: `Discord API error: ${discordError.message}` });
        }
        
    } catch (error) {
        writeLog(`Search messages API error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to search messages' });
    }
});

// Create standard embeds endpoint
router.post('/create-embed', async (req, res) => {
    try {
        const { type, data } = req.body;
        
        if (!type) {
            return res.status(400).json({ error: 'Missing embed type' });
        }
        
        writeLog(`Create embed request: type ${type}`, 'Debug');
        
        let embed = null;
        
        switch (type) {
            case 'account-linking':
                embed = createAccountLinkingEmbed(data);
                break;
            case 'server-status':
                embed = createServerStatusEmbed(data);
                break;
            case 'success':
                embed = createSuccessEmbed(data);
                break;
            case 'warning':
                embed = createWarningEmbed(data);
                break;
            case 'error':
                embed = createErrorEmbed(data);
                break;
            case 'info':
                embed = createInfoEmbed(data);
                break;
            default:
                return res.status(400).json({ error: `Unknown embed type: ${type}` });
        }
        
        if (!embed) {
            return res.status(500).json({ error: 'Failed to create embed' });
        }
        
        res.json({ 
            success: true, 
            embed: embed
        });
        
    } catch (error) {
        writeLog(`Create embed API error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to create embed' });
    }
});

// Send embed with creation endpoint (combines create and send)
router.post('/send-embed', async (req, res) => {
    try {
        const { channelId, type, data, components, updateMessageId } = req.body;
        
        if (!channelId || !type) {
            return res.status(400).json({ error: 'Missing channelId or embed type' });
        }
        
        writeLog(`Send embed request: type ${type} to channel ${channelId}`, 'Debug');
        
        // Get the Discord client from global scope
        if (!global.discordClient || !global.discordClient.isReady()) {
            return res.status(503).json({ error: 'Discord bot not ready' });
        }
        
        // Create the embed
        let embed = null;
        
        switch (type) {
            case 'account-linking':
                embed = createAccountLinkingEmbed(data);
                break;
            case 'server-status':
                embed = createServerStatusEmbed(data);
                break;
            case 'success':
                embed = createSuccessEmbed(data);
                break;
            case 'warning':
                embed = createWarningEmbed(data);
                break;
            case 'error':
                embed = createErrorEmbed(data);
                break;
            case 'info':
                embed = createInfoEmbed(data);
                break;
            default:
                return res.status(400).json({ error: `Unknown embed type: ${type}` });
        }
        
        if (!embed) {
            return res.status(500).json({ error: 'Failed to create embed' });
        }
        
        try {
            const channel = await global.discordClient.channels.fetch(channelId);
            if (!channel) {
                return res.status(404).json({ error: 'Channel not found' });
            }
            
            // Prepare message options
            const messageOptions = {
                embeds: [embed]
            };
            
            if (components && components.length > 0) {
                messageOptions.components = components;
            }
            
            let message;
            if (updateMessageId) {
                // Update existing message
                const existingMessage = await channel.messages.fetch(updateMessageId);
                message = await existingMessage.edit(messageOptions);
            } else {
                // Send new message
                message = await channel.send(messageOptions);
            }
            
            res.json({ 
                success: true, 
                messageId: message.id,
                channelId: channel.id,
                embed: embed
            });
            
        } catch (discordError) {
            writeLog(`Discord API error: ${discordError.message}`, 'Error');
            res.status(500).json({ error: `Discord API error: ${discordError.message}` });
        }
        
    } catch (error) {
        writeLog(`Send embed API error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to send embed' });
    }
});

// Helper functions for creating different embed types
function createAccountLinkingEmbed(data = {}) {
    return {
        title: ':link: Account Linking',
        description: data.description || 'Link your Discord account with your SCUM server profile.\n\n**How to link:**\n1. Click the **Connect Account** button below\n2. You\'ll receive a registration code (visible only to you)\n3. In the game chat, type: `connect:YOUR_CODE`',
        color: 3447003, // Blue
        footer: {
            text: 'SCUM Server Automation',
            icon_url: 'https://playhub.cz/scum/manager/server_automation_discord.png'
        },
        timestamp: new Date().toISOString()
    };
}

function createServerStatusEmbed(data = {}) {
    const statusColor = data.online ? 0x00FF00 : 0xFF0000; // Green if online, red if offline
    const statusEmoji = data.online ? ':green_circle:' : ':red_circle:';
    
    return {
        title: `${statusEmoji} Server Status`,
        description: data.description || 'Current server status and information',
        color: statusColor,
        fields: [
            {
                name: 'Status',
                value: data.online ? 'Online' : 'Offline',
                inline: true
            },
            {
                name: 'Players',
                value: `${data.playerCount || 0}/${data.maxPlayers || 0}`,
                inline: true
            },
            {
                name: 'Uptime',
                value: data.uptime || 'Unknown',
                inline: true
            }
        ],
        footer: {
            text: 'SCUM Server Automation',
            icon_url: 'https://playhub.cz/scum/manager/server_automation_discord.png'
        },
        timestamp: new Date().toISOString()
    };
}

function createSuccessEmbed(data = {}) {
    return {
        title: data.title || ':white_check_mark: Success',
        description: data.description || 'Operation completed successfully',
        color: 0x00FF00, // Green
        fields: data.fields || [],
        footer: {
            text: 'SCUM Server Automation',
            icon_url: 'https://playhub.cz/scum/manager/server_automation_discord.png'
        },
        timestamp: new Date().toISOString()
    };
}

function createWarningEmbed(data = {}) {
    return {
        title: data.title || ':warning: Warning',
        description: data.description || 'Warning message',
        color: 0xFFFF00, // Yellow
        fields: data.fields || [],
        footer: {
            text: 'SCUM Server Automation',
            icon_url: 'https://playhub.cz/scum/manager/server_automation_discord.png'
        },
        timestamp: new Date().toISOString()
    };
}

function createErrorEmbed(data = {}) {
    return {
        title: data.title || ':x: Error',
        description: data.description || 'An error occurred',
        color: 0xFF0000, // Red
        fields: data.fields || [],
        footer: {
            text: 'SCUM Server Automation',
            icon_url: 'https://playhub.cz/scum/manager/server_automation_discord.png'
        },
        timestamp: new Date().toISOString()
    };
}

function createInfoEmbed(data = {}) {
    return {
        title: data.title || ':information_source: Information',
        description: data.description || 'Information message',
        color: 0x3498DB, // Blue
        fields: data.fields || [],
        footer: {
            text: 'SCUM Server Automation',
            icon_url: 'https://playhub.cz/scum/manager/server_automation_discord.png'
        },
        timestamp: new Date().toISOString()
    };
}

// Account linking embed endpoint
router.post('/account-linking/embed', async (req, res) => {
    try {
        const { channelId, updateMessageId } = req.body;
        
        if (!channelId) {
            return res.status(400).json({ error: 'Channel ID is required' });
        }
        
        if (!global.discordClient || !global.discordClient.isReady()) {
            return res.status(503).json({ error: 'Discord bot is not ready' });
        }
        
        // Get the channel
        const channel = await global.discordClient.channels.fetch(channelId);
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }
        
        // Create account linking embed
        const embed = new EmbedBuilder()
            .setTitle(':link: Account Linking')
            .setDescription(`
Welcome to the SCUM server! Link your Discord account to your in-game character for exclusive features and notifications.

**How to link:**
1. Click the **Link Account** button below
2. You'll receive a registration code (visible only to you)
3. In the game chat, type: \`connect:YOUR_CODE\`
4. Your accounts will be linked automatically!

**Benefits:**
• Personal notifications
• Raid protection alerts
• And more ....
            `)
            .setColor('#00863A')
            .setImage('https://playhub.cz/scum/11.gif')
            .setFooter({ 
                text: 'SCUM Server Automation • Account Linking',
                iconURL: 'https://playhub.cz/scum/manager/server_automation_discord.png'
            })
            .setTimestamp();
        
        // Create buttons
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('link_account')
                    .setLabel('Link Account')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🔗'),
                new ButtonBuilder()
                    .setCustomId('check_status')
                    .setLabel('Check Status')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📊'),
                new ButtonBuilder()
                    .setCustomId('setting_account')
                    .setLabel('Settings')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⚙️'),                    
                new ButtonBuilder()
                    .setCustomId('unlink_account')
                    .setLabel('Unlink Account')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔓')
            );
        
        let message;
        let operation = 'created';
        
        // If updateMessageId is provided, try to update existing message
        if (updateMessageId) {
            try {
                const existingMessage = await channel.messages.fetch(updateMessageId);
                message = await existingMessage.edit({
                    embeds: [embed],
                    components: [row]
                });
                operation = 'updated';
                writeLog(`Account linking embed updated in channel ${channelId}: ${message.id}`, 'Debug');
            } catch (updateError) {
                writeLog(`Failed to update message ${updateMessageId}, creating new one: ${updateError.message}`, 'Warning');
                // If update fails, create new message
                message = await channel.send({
                    embeds: [embed],
                    components: [row]
                });
                operation = 'recreated';
                writeLog(`Account linking embed recreated in channel ${channelId}: ${message.id}`, 'Debug');
            }
        } else {
            // Create new message
            message = await channel.send({
                embeds: [embed],
                components: [row]
            });
            writeLog(`Account linking embed created in channel ${channelId}: ${message.id}`, 'Debug');
        }
        
        res.json({
            success: true,
            messageId: message.id,
            channelId: channelId,
            operation: operation,
            message: `Account linking embed ${operation} successfully`
        });
        
    } catch (error) {
        writeLog(`Account linking embed error: ${error.message}`, 'Error');
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

module.exports = router;
