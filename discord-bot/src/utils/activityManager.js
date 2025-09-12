const { writeLog } = require('./utils');
const CONFIG = require('../config/config');
const fs = require('fs');

class ActivityManager {
    constructor() {
        this.client = null;
        this.config = null;
        this.updateInterval = null;
        this.isInitialized = false;
    }

    initialize(client) {
        this.client = client;
        this.loadConfiguration();
        
        if (this.config && this.config.DynamicActivity) {
            this.startActivityUpdates();
            writeLog('Activity manager initialized with dynamic activity', 'Debug');
        } else {
            writeLog('Activity manager initialized with static activity', 'Debug');
        }
        
        this.isInitialized = true;
    }

    loadConfiguration() {
        try {
            const configPath = CONFIG.configPath;
            if (configPath && fs.existsSync(configPath)) {
                const configFile = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                if (configFile.Discord && configFile.Discord.Presence) {
                    this.config = configFile.Discord.Presence;
                    writeLog(`Activity config loaded: Dynamic=${this.config.DynamicActivity}, Interval=${this.config.ActivityUpdateInterval}`, 'Debug');
                }
            }
        } catch (error) {
            writeLog(`Failed to load activity configuration: ${error.message}`, 'Warning');
        }
    }

    startActivityUpdates() {
        if (!this.config.DynamicActivity) return;

        const interval = (this.config.ActivityUpdateInterval || 120) * 1000;
        
        // Set initial activity
        this.updateActivity();
        
        // Set up periodic updates
        this.updateInterval = setInterval(() => {
            this.updateActivity();
        }, interval);
        
        writeLog(`Started dynamic activity updates (interval: ${interval/1000}s)`, 'Debug');
    }

    async updateActivity() {
        if (!this.client || !this.client.isReady()) {
            return;
        }

        try {
            const serverStatus = await this.getServerStatus();
            const activityData = this.generateActivityData(serverStatus);
            
            await this.client.user.setPresence({
                activities: [{
                    name: activityData.activity,
                    type: activityData.type
                }],
                status: activityData.status
            });

            writeLog(`Activity updated: "${activityData.activity}" (${activityData.status})`, 'Debug');
            
        } catch (error) {
            writeLog(`Failed to update activity: ${error.message}`, 'Warning');
        }
    }

    async getServerStatus() {
        try {
            // Get server running status
            const statusResponse = await fetch('http://localhost:3001/api/server/status');
            const playersResponse = await fetch('http://localhost:3001/api/server/players');
            
            if (!statusResponse.ok || !playersResponse.ok) {
                throw new Error(`API responses: ${statusResponse.status}, ${playersResponse.status}`);
            }
            
            const statusData = await statusResponse.json();
            const playersData = await playersResponse.json();
            
            return {
                isOnline: statusData.running === true,
                players: playersData.online || 0,
                maxPlayers: playersData.maxPlayers || 128
            };
            
        } catch (error) {
            writeLog(`Failed to get server status from API: ${error.message}`, 'Debug');
            return {
                isOnline: false,
                players: 0,
                maxPlayers: 128
            };
        }
    }

    generateActivityData(serverStatus) {
        if (!this.config) {
            return {
                activity: 'SCUM Server',
                type: 3,
                status: 'online'
            };
        }

        let activity = this.config.Activity || 'SCUM Server';
        let type = this.getActivityType(this.config.Type || 'Watching');
        let status = this.config.Status || 'online';

        if (this.config.DynamicActivity) {
            if (serverStatus.isOnline) {
                // Server is online - always show player count
                if (this.config.OnlineActivityFormat) {
                    activity = this.config.OnlineActivityFormat
                        .replace('{players}', serverStatus.players.toString())
                        .replace('{maxPlayers}', serverStatus.maxPlayers.toString());
                } else {
                    activity = `${serverStatus.players} / ${serverStatus.maxPlayers} players`;
                }
                status = 'online';
            } else {
                // Server is actually offline
                activity = this.config.OfflineActivity || 'OFFLINE';
                status = 'dnd';
            }
        }

        return {
            activity: activity,
            type: type,
            status: status
        };
    }

    getActivityType(typeString) {
        const typeMap = {
            'Playing': 0,
            'Streaming': 1,
            'Listening': 2,
            'Watching': 3,
            'Custom': 4,
            'Competing': 5
        };
        
        return typeMap[typeString] || 3;
    }

    setActivity(activity, type = 3, status = 'online') {
        if (!this.client || !this.client.isReady()) {
            writeLog('Cannot set activity - client not ready', 'Warning');
            return false;
        }

        try {
            this.client.user.setPresence({
                activities: activity ? [{
                    name: activity,
                    type: type
                }] : [],
                status: status
            });

            writeLog(`Manual activity set: "${activity}" (type: ${type}, status: ${status})`, 'Debug');
            return true;
            
        } catch (error) {
            writeLog(`Failed to set manual activity: ${error.message}`, 'Warning');
            return false;
        }
    }

    stop() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
            writeLog('Activity manager stopped', 'Debug');
        }
    }

    getStatus() {
        return {
            initialized: this.isInitialized,
            dynamicActivity: this.config ? this.config.DynamicActivity : false,
            updateInterval: this.config ? this.config.ActivityUpdateInterval : null,
            hasInterval: !!this.updateInterval
        };
    }
}

module.exports = new ActivityManager();
