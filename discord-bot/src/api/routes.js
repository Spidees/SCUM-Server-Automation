const express = require('express');
const { exec } = require('child_process');
const { writeLog, addScheduledOperation, getScheduledOperations, removeScheduledOperations, removeScheduledOperationByScheduleId } = require('../utils/utils');
const { getDb } = require('../utils/database');
const CONFIG = require('../config/config');

const router = express.Router();

// Bot status endpoint
router.get('/status', async (req, res) => {
    try {
        // Check if Discord client is available and ready
        const discordReady = global.discordClient && global.discordClient.isReady();
        
        res.json({
            status: discordReady ? 'online' : 'offline',
            ready: discordReady,
            uptime: global.discordClient ? process.uptime() : 0,
            timestamp: new Date().toISOString()
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
        
        writeLog(`Discord notification received: ${type}`, 'Info');
        
        // Handle notification based on type
        switch (type) {
            case 'manager.started':
                writeLog(`Server manager started - version ${data.version || 'unknown'}`, 'Info');
                // Here you can add Discord channel posting logic
                break;
            case 'manager.stopped':
                writeLog('Server manager stopped', 'Info');
                break;
            case 'server.started':
            case 'server.stopped':
            case 'server.online':
            case 'server.offline':
                writeLog(`Server status change: ${type}`, 'Info');
                break;
            case 'backup.started':
            case 'backup.completed':
            case 'backup.failed':
                writeLog(`Backup event: ${type}`, 'Info');
                break;
            case 'update.available':
            case 'update.started':
            case 'update.completed':
            case 'update.failed':
                writeLog(`Update event: ${type}`, 'Info');
                break;
            default:
                writeLog(`Unknown notification type: ${type}`, 'Debug');
        }
        
        res.json({ 
            success: true, 
            message: 'Notification processed',
            type: type,
            receivedAt: new Date().toISOString()
        });
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

// Set bot activity endpoint
router.post('/set-activity', async (req, res) => {
    try {
        const { activity, status = 'online', type = 3 } = req.body;
        
        writeLog(`Set activity request: "${activity}" (${status}, type ${type})`, 'Debug');
        
        // Get the Discord client from global scope
        if (!global.discordClient || !global.discordClient.isReady()) {
            return res.status(503).json({ error: 'Discord bot not ready' });
        }
        
        try {
            // Map activity types (same as Discord.js ActivityType)
            const activityTypeMap = {
                0: 'Playing',     // ActivityType.Playing
                1: 'Streaming',   // ActivityType.Streaming  
                2: 'Listening',   // ActivityType.Listening
                3: 'Watching',    // ActivityType.Watching
                4: 'Custom',      // ActivityType.Custom
                5: 'Competing'    // ActivityType.Competing
            };
            
            // Set presence
            await global.discordClient.user.setPresence({
                activities: activity ? [{
                    name: activity,
                    type: type
                }] : [],
                status: status
            });
            
            const activityName = activityTypeMap[type] || 'Unknown';
            writeLog(`Bot activity set: ${activityName} "${activity}" (${status})`, 'Info');
            
            res.json({ 
                success: true, 
                message: 'Activity updated',
                activity: activity,
                activityType: activityName,
                status: status
            });
            
        } catch (discordError) {
            writeLog(`Discord activity error: ${discordError.message}`, 'Error');
            res.status(500).json({ error: `Discord API error: ${discordError.message}` });
        }
        
    } catch (error) {
        writeLog(`Set activity API error: ${error.message}`, 'Error');
        res.status(500).json({ error: 'Failed to set activity' });
    }
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

                        writeLog(`Account linked via API: Discord ${discordUserId} -> Steam ${pending.steam_id}`, 'Info');
                        
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

module.exports = router;
