const { EmbedBuilder } = require('discord.js');
const { writeLog } = require('./utils');
const CONFIG = require('../config/config');

class NotificationHandler {
    constructor() {
        this.discordClient = null;
        this.config = null;
    }

    initialize(client) {
        this.discordClient = client;
        this.config = CONFIG.notifications || {};
        writeLog('Notification handler initialized', 'Debug');
    }

    async sendNotification(type, data = {}) {
        try {
            if (!this.discordClient || !this.discordClient.isReady()) {
                writeLog('Discord client not ready for notifications', 'Warning');
                return { success: false, error: 'Discord client not ready' };
            }

            // Get target channels for this notification type
            const channels = this.getNotificationChannels(type);
            if (!channels || channels.length === 0) {
                writeLog(`No channels configured for notification type: ${type}`, 'Warning');
                return { success: false, error: 'No channels configured' };
            }

            // Create embed for this notification
            const embed = this.createNotificationEmbed(type, data);
            if (!embed) {
                writeLog(`Failed to create embed for notification type: ${type}`, 'Error');
                return { success: false, error: 'Failed to create embed' };
            }

            // Send to all applicable channels
            let successCount = 0;
            const results = [];

            for (const channelId of channels) {
                try {
                    const channel = await this.discordClient.channels.fetch(channelId);
                    if (channel) {
                        // Get role mentions for this channel
                        const roleMentions = this.getRoleMentions(type, channelId);
                        const messageOptions = { embeds: [embed] };
                        
                        if (roleMentions && roleMentions.length > 0) {
                            messageOptions.content = roleMentions.join(' ');
                        }

                        await channel.send(messageOptions);
                        successCount++;
                        writeLog(`Notification sent to channel ${channelId}: ${type}`, 'Debug');
                    }
                } catch (channelError) {
                    writeLog(`Failed to send notification to channel ${channelId}: ${channelError.message}`, 'Error');
                    results.push({ channelId, error: channelError.message });
                }
            }

            if (successCount > 0) {
                writeLog(`Notification sent to ${successCount}/${channels.length} channels: ${type}`, 'Debug');
                return { success: true, channelsSent: successCount, totalChannels: channels.length };
            } else {
                writeLog(`Notification failed for all channels: ${type}`, 'Error');
                return { success: false, error: 'Failed to send to any channel', results };
            }

        } catch (error) {
            writeLog(`Notification handler error: ${error.message}`, 'Error');
            return { success: false, error: error.message };
        }
    }

    getNotificationChannels(type) {
        // Load configuration from main config
        const discordConfig = CONFIG.discord || {};
        const notificationConfig = discordConfig.notifications || {};
        
        const channels = [];
        
        // Admin-only notification types
        const adminOnlyTypes = [
            'manager.started', 'manager.stopped', 'backup.started', 'backup.completed', 'backup.failed',
            'update.available', 'update.started', 'update.completed', 'update.failed',
            'performance.critical', 'performance.poor', 'performance.warning', 'performance.alert',
            'admin.alert', 'error', 'Debug',
            'service.started', 'service.stopped', 'service.starting', 'service.stopping',
            'server.started', 'server.stopped', 'server.starting', 'server.shutting_down', 'server.loading', 'server.online', 'server.offline'
        ];

        // Player notification types
        const playerTypes = [
            'server.online', 'server.offline',
            'restartWarning15', 'restartWarning5', 'restartWarning1',
            'updateWarning15', 'updateWarning5', 'updateWarning1',
            'server.scheduledRestart',
            'manualStopWarning', 'manualRestartWarning', 'manualUpdateWarning',
            'player.joined', 'player.left'
        ];

        // Check for warning patterns
        const isRestartWarning = /^restartWarning\d+$/.test(type);
        const isUpdateWarning = /^updateWarning\d+$/.test(type);
        
        const isAdminNotification = adminOnlyTypes.includes(type);
        const isPlayerNotification = playerTypes.includes(type) || isRestartWarning || isUpdateWarning;

        // Add admin channel if it's an admin notification
        if (isAdminNotification && notificationConfig.channels?.admin) {
            channels.push(notificationConfig.channels.admin);
        }

        // Add player channel if it's a player notification
        if (isPlayerNotification && notificationConfig.channels?.players) {
            channels.push(notificationConfig.channels.players);
        }

        // Remove duplicates
        return [...new Set(channels)];
    }

    getRoleMentions(type, channelId) {
        const discordConfig = CONFIG.discord || {};
        const notificationConfig = discordConfig.notifications || {};
        const rolesConfig = notificationConfig.roles || {};

        const adminChannel = notificationConfig.channels?.admin;
        const playerChannel = notificationConfig.channels?.players;

        let roles = [];

        // Determine which roles to use based on channel
        if (channelId === adminChannel && rolesConfig.admin) {
            roles = Array.isArray(rolesConfig.admin) ? rolesConfig.admin : [rolesConfig.admin];
        } else if (channelId === playerChannel && rolesConfig.players) {
            roles = Array.isArray(rolesConfig.players) ? rolesConfig.players : [rolesConfig.players];
        }

        // Format role mentions
        return roles.filter(role => role && role.trim()).map(role => `<@&${role}>`);
    }

    createNotificationEmbed(type, data) {
        const embed = new EmbedBuilder().setTimestamp();

        switch (type) {
            case 'manager.started':
                return embed
                    .setTitle(':white_check_mark: Server Automation Started')
                    .setDescription('SCUM Server Automation is now monitoring the server')
                    .setColor('#00FF00');

            case 'manager.stopped':
                return embed
                    .setTitle(':octagonal_sign: Automation Stopped')
                    .setDescription('SCUM Server Automation has stopped monitoring')
                    .setColor('#FFA500');

            case 'server.started':
                return embed
                    .setTitle(':green_circle: Server Started')
                    .setDescription('SCUM server is now **ONLINE** and ready for players!')
                    .setColor('#00FF00');

            case 'server.stopped':
                return embed
                    .setTitle(':red_circle: Server Stopped')
                    .setDescription('SCUM server is now **OFFLINE**')
                    .setColor('#FF0000');

            case 'server.online':
                return embed
                    .setTitle(':green_circle: Server Online')
                    .setDescription('SCUM server is **ONLINE** and accepting connections')
                    .setColor('#00FF00');

            case 'server.offline':
                return embed
                    .setTitle(':red_circle: Server Offline')
                    .setDescription('SCUM server is **OFFLINE** - players cannot connect')
                    .setColor('#FF0000');

            case 'server.loading':
                return embed
                    .setTitle(':yellow_circle: Server Loading')
                    .setDescription('SCUM server is **LOADING** - please wait...')
                    .setColor('#FFFF00');

            case 'server.starting':
                return embed
                    .setTitle(':yellow_circle: Server Starting')
                    .setDescription('SCUM server is **STARTING UP** - please wait...')
                    .setColor('#FFFF00');

            case 'server.shutting_down':
                return embed
                    .setTitle(':orange_circle: Server Shutting Down')
                    .setDescription('SCUM server is **SHUTTING DOWN** - players should disconnect')
                    .setColor('#FFA500');

            case 'backup.started':
                const backupType = data.type || 'manual';
                return embed
                    .setTitle(':floppy_disk: Backup Started')
                    .setDescription(`Server backup in progress...\n**Type:** ${backupType}`)
                    .setColor('#0099FF');

            case 'backup.completed':
                const completedType = data.type || 'manual';
                const size = data.size ? `\n**Size:** ${data.size}` : '';
                const duration = data.duration ? `\n**Duration:** ${data.duration}` : '';
                return embed
                    .setTitle(':white_check_mark: Backup Completed')
                    .setDescription(`Server backup completed successfully!\n**Type:** ${completedType}${size}${duration}`)
                    .setColor('#00FF00');

            case 'backup.failed':
                const failedType = data.type || 'backup';
                const errorMsg = data.error ? `\n**Error:** ${data.error}` : '';
                return embed
                    .setTitle(':x: Backup Failed')
                    .setDescription(`Server backup failed - **${failedType}**${errorMsg}`)
                    .setColor('#FF0000');

            case 'update.available':
                const version = data.version ? `\n**New Version:** ${data.version}` : '';
                const currentVersion = data.currentVersion ? `\n**Current:** ${data.currentVersion}` : '';
                return embed
                    .setTitle(':arrows_counterclockwise: Update Available')
                    .setDescription(`A new server update is ready for installation!${currentVersion}${version}`)
                    .setColor('#FFA500');

            case 'update.started':
                return embed
                    .setTitle(':gear: Update Started')
                    .setDescription('Server update is being installed - server may be temporarily unavailable')
                    .setColor('#0099FF');

            case 'update.completed':
                const newVersion = data.version ? `\n**Updated to:** ${data.version}` : '';
                const updateMessage = data.message || '';
                
                if (updateMessage.includes('already up to date') || data.version === 'Current') {
                    return embed
                        .setTitle(':information_source: Server Already Updated')
                        .setDescription('Server is already running the latest version!\nNo update was necessary.')
                        .setColor('#00AAFF');
                } else {
                    return embed
                        .setTitle(':white_check_mark: Update Completed')
                        .setDescription(`Server update completed successfully!${newVersion}`)
                        .setColor('#00FF00');
                }

            case 'update.failed':
                const updateError = data.error ? `\n**Error:** ${data.error}` : '';
                return embed
                    .setTitle(':x: Update Failed')
                    .setDescription(`Server update failed - manual intervention may be required${updateError}`)
                    .setColor('#FF0000');

            case 'performance.critical':
                const fps = data.fps !== undefined ? data.fps : 'N/A';
                const cpu = data.cpu !== undefined ? `${data.cpu}%` : 'N/A';
                const memory = data.memory !== undefined ? `${data.memory} MB` : 'N/A';
                const players = (data.players !== undefined && data.max_players !== undefined) ? `${data.players}/${data.max_players}` : 'N/A';
                const entities = data.entities !== undefined ? data.entities : 'N/A';
                
                return embed
                    .setTitle(':rotating_light: Critical Performance Alert')
                    .setDescription(`**CRITICAL:** Server performance issue detected!\n**FPS:** ${fps}\n**CPU:** ${cpu}\n**Memory:** ${memory}\n**Players:** ${players}\n**Entities:** ${entities}\n\nImmediate attention required!`)
                    .setColor('#FF0000');

            case 'performance.poor':
                const poorFps = data.fps !== undefined ? data.fps : 'N/A';
                const poorCpu = data.cpu !== undefined ? `${data.cpu}%` : 'N/A';
                const poorMemory = data.memory !== undefined ? `${data.memory} MB` : 'N/A';
                const poorPlayers = (data.players !== undefined && data.max_players !== undefined) ? `${data.players}/${data.max_players}` : 'N/A';
                const poorEntities = data.entities !== undefined ? data.entities : 'N/A';
                
                return embed
                    .setTitle(':warning: Poor Performance Alert')
                    .setDescription(`**WARNING:** Server performance is degraded!\n**FPS:** ${poorFps}\n**CPU:** ${poorCpu}\n**Memory:** ${poorMemory}\n**Players:** ${poorPlayers}\n**Entities:** ${poorEntities}\n\nPerformance monitoring active.`)
                    .setColor('#FFA500');

            case 'performance.warning':
                const metric = data.metric || 'Unknown';
                const value = data.value || 'N/A';
                const threshold = data.threshold ? ` (threshold: ${data.threshold})` : '';
                return embed
                    .setTitle(':warning: Performance Warning')
                    .setDescription(`Server performance degradation detected:\n**Metric:** ${metric}\n**Current Value:** ${value}${threshold}`)
                    .setColor('#FFA500');

            case 'performance.alert':
                const metricName = data.metric || 'performance';
                const metricValue = data.value || 'unknown';
                const severity = data.severity || 'medium';
                const emoji = severity === 'critical' ? ':rotating_light:' : 
                             severity === 'high' ? ':warning:' : 
                             severity === 'medium' ? ':yellow_circle:' : ':information_source:';
                return embed
                    .setTitle(`${emoji} Performance Alert`)
                    .setDescription(`Performance issue detected:\n**${metricName}:** ${metricValue}`)
                    .setColor('#FFA500');

            case 'service.started':
                return embed
                    .setTitle(':gear: Service Started')
                    .setDescription('Windows service **STARTED** - server is initializing')
                    .setColor('#0099FF');

            case 'service.stopped':
                return embed
                    .setTitle(':stop_sign: Service Stopped')
                    .setDescription('Windows service **STOPPED** - server is completely offline')
                    .setColor('#FF0000');

            case 'service.starting':
                return embed
                    .setTitle(':arrows_clockwise: Service Starting')
                    .setDescription('Windows service is **STARTING UP**')
                    .setColor('#FFA500');

            case 'service.stopping':
                return embed
                    .setTitle(':warning: Service Stopping')
                    .setDescription('Windows service is **STOPPING**')
                    .setColor('#FFA500');

            case 'server.scheduledRestart':
                // Check if this is a skip notification
                if (data.skipped && data.immediate) {
                    const nextRestart = data.nextRestart ? `\n**Next Restart:** ${data.nextRestart}` : '';
                    return embed
                        .setTitle(':fast_forward: Restart Cancelled')
                        .setDescription(`${data.event}${nextRestart}`)
                        .setColor('#0099FF');
                } 
                // Check if this is about a skipped restart during actual restart time
                else if (data.event && data.event.includes('skipped')) {
                    return embed
                        .setTitle(':fast_forward: Restart Skipped')
                        .setDescription(data.event)
                        .setColor('#0099FF');
                }
                // Normal restart notification
                else {
                    const reason = data.reason ? `\n**Reason:** ${data.reason}` : '';
                    const playersInfo = data.players ? `\n**Online Players:** ${data.players}` : '';
                    return embed
                        .setTitle(':arrows_counterclockwise: Scheduled Server Restart')
                        .setDescription(`Scheduled server restart is now in progress${reason}${playersInfo}`)
                        .setColor('#FFA500');
                }

            case 'manualStopWarning':
                const stopMinutes = data.minutes || 'unknown';
                const stopAction = data.action || 'stop';
                const stopDescription = stopMinutes === '1' || stopMinutes === 1
                    ? `**Admin-initiated server ${stopAction} in 1 MINUTE!**\nSave your progress NOW and prepare for disconnection!`
                    : `**Admin-initiated server ${stopAction} in ${stopMinutes} minutes!**\nPlease save your progress and prepare for disconnection.`;
                
                return embed
                    .setTitle(`:stop_sign: Manual Stop Warning (${stopMinutes} min)`)
                    .setDescription(stopDescription)
                    .setColor('#FF0000');

            case 'manualRestartWarning':
                const restartMinutes = data.minutes || 'unknown';
                const restartAction = data.action || 'restart';
                const restartDescription = restartMinutes === '1' || restartMinutes === 1
                    ? `**Admin-initiated server ${restartAction} in 1 MINUTE!**\nSave your progress NOW and prepare for disconnection!`
                    : `**Admin-initiated server ${restartAction} in ${restartMinutes} minutes!**\nPlease save your progress and prepare for disconnection.`;
                
                return embed
                    .setTitle(`:arrows_counterclockwise: Manual Restart Warning (${restartMinutes} min)`)
                    .setDescription(restartDescription)
                    .setColor('#FFA500');

            case 'manualUpdateWarning':
                const updateMinutes = data.minutes || 'unknown';
                const updateAction = data.action || 'update';
                const updateDescription = updateMinutes === '1' || updateMinutes === 1
                    ? `**Admin-initiated server ${updateAction} in 1 MINUTE!**\nSave your progress NOW - server will be temporarily unavailable!`
                    : `**Admin-initiated server ${updateAction} in ${updateMinutes} minutes!**\nPlease save your progress - server will be briefly unavailable for updates.`;
                
                return embed
                    .setTitle(`:arrow_up: Manual Update Warning (${updateMinutes} min)`)
                    .setDescription(updateDescription)
                    .setColor('#FFA500');

            case 'player.joined':
                const playerName = data.playerName || 'Unknown Player';
                const playerCount = data.playerCount ? `\n**Players Online:** ${data.playerCount}` : '';
                return embed
                    .setTitle(':wave: Player Joined')
                    .setDescription(`**${playerName}** joined the server${playerCount}`)
                    .setColor('#00FF00');

            case 'player.left':
                const leftPlayerName = data.playerName || 'Unknown Player';
                const leftPlayerCount = data.playerCount ? `\n**Players Online:** ${data.playerCount}` : '';
                return embed
                    .setTitle(':door: Player Left')
                    .setDescription(`**${leftPlayerName}** left the server${leftPlayerCount}`)
                    .setColor('#0099FF');

            case 'admin.alert':
                const message = data.message || 'Admin attention required';
                const alertSeverity = data.severity || 'medium';
                const alertEmoji = alertSeverity === 'critical' ? ':rotating_light:' : 
                                  alertSeverity === 'high' ? ':warning:' : 
                                  alertSeverity === 'medium' ? ':yellow_circle:' : ':information_source:';
                return embed
                    .setTitle(`${alertEmoji} Admin Alert`)
                    .setDescription(message)
                    .setColor('#FF6600');

            case 'error':
                const errorMessage = data.message || 'An error occurred';
                const errorDetails = data.details ? `\n**Details:** ${data.details}` : '';
                return embed
                    .setTitle(':x: Error')
                    .setDescription(`${errorMessage}${errorDetails}`)
                    .setColor('#FF0000');

            case 'info':
                const infoMsg = data.message || 'Information';
                const infoDetails = data.details ? `\n**Details:** ${data.details}` : '';
                return embed
                    .setTitle(':information_source: Information')
                    .setDescription(`${infoMsg}${infoDetails}`)
                    .setColor('#0099FF');

            // Handle restart warnings
            default:
                if (type.match(/^restartWarning\d+$/)) {
                    const minutes = type.replace('restartWarning', '');
                    
                    const description = minutes === '1' 
                        ? '**Server will restart in 1 MINUTE!**\nSave your progress NOW and prepare for disconnection!'
                        : `**Server will restart in ${minutes} minutes!**\nPlease save your progress and prepare for disconnection.`;
                    
                    return embed
                        .setTitle(`:warning: Restart Warning (${minutes} min)`)
                        .setDescription(description)
                        .setColor('#FFA500');
                }

                if (type.match(/^updateWarning\d+$/)) {
                    const minutes = type.replace('updateWarning', '');
                    
                    const description = minutes === '1'
                        ? '**Server update will start in 1 MINUTE!**\nSave your progress NOW - server will be temporarily unavailable!'
                        : `**Server update will start in ${minutes} minutes!**\nPlease save your progress - server will be temporarily unavailable.`;
                    
                    return embed
                        .setTitle(`:arrows_counterclockwise: Update Warning (${minutes} min)`)
                        .setDescription(description)
                        .setColor('#FFA500');
                }

                // Default fallback
                return embed
                    .setTitle(':information_source: Server Notification')
                    .setDescription(`Notification type: ${type}`)
                    .setColor('#0099FF');
        }
    }
}

module.exports = new NotificationHandler();
