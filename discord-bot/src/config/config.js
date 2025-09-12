// Discord Bot Configuration
const fs = require('fs');
const path = require('path');

// Load configuration from environment variables or config file
function loadConfig() {
    let config = {
        token: process.env.DISCORD_TOKEN,
        guildId: process.env.DISCORD_GUILD_ID,
        httpPort: parseInt(process.env.HTTP_PORT) || 3001,
        debug: process.env.DEBUG === 'true',
        rootDir: process.env.ROOT_DIR || process.cwd(),
        configPath: process.env.CONFIG_PATH || path.join(process.env.ROOT_DIR || process.cwd(), 'SCUM-Server-Automation.config.json')
    };
    
    // If we have a config file path, load additional settings
    if (config.configPath && fs.existsSync(config.configPath)) {
        try {
            const configFile = JSON.parse(fs.readFileSync(config.configPath, 'utf8'));
            
            // Load service name
            config.serviceName = configFile.serviceName;
            
            // Load server directory for chat logs
            config.serverDirectory = path.resolve(config.rootDir, configFile.serverDir || './server');
            
            if (configFile.Discord) {
                config.token = config.token || configFile.Discord.Token;
                config.guildId = config.guildId || configFile.Discord.GuildId;
                if (configFile.Discord.HttpApi) {
                    config.httpPort = config.httpPort || configFile.Discord.HttpApi.Port || 3001;
                }
                
                // Load chat relay configuration
                if (configFile.Discord.ChatRelay) {
                    config.chatRelay = {
                        enabled: configFile.Discord.ChatRelay.Enabled || false,
                        channels: {
                            players: configFile.Discord.ChatRelay.Channels?.Players,
                            admin: configFile.Discord.ChatRelay.Channels?.Admin
                        },
                        chatTypes: configFile.Discord.ChatRelay.ChatTypes || {
                            global: true,
                            squad: true,
                            local: true
                        },
                        maxMessageLength: configFile.Discord.ChatRelay.MaxMessageLength || 500,
                        updateInterval: configFile.Discord.ChatRelay.UpdateInterval || 5
                    };
                }
                
                // Load notification configuration
                if (configFile.Discord.Notifications) {
                    config.notifications = {
                        enabled: configFile.Discord.Notifications.Enabled || false,
                        channels: {
                            players: configFile.Discord.Notifications.Channels?.Players,
                            admin: configFile.Discord.Notifications.Channels?.Admin
                        },
                        roles: {
                            players: configFile.Discord.Notifications.Roles?.Players,
                            admin: configFile.Discord.Notifications.Roles?.Admin
                        }
                    };
                }
            }
        } catch (error) {
            console.warn('Failed to load config file:', error.message);
        }
    }
    
    // Set database path relative to root directory
    config.databasePath = path.join(config.rootDir, 'data', 'server_database.db');
    
    return config;
}

const config = loadConfig();

module.exports = {
    ...config,
    
    // Discord-specific configuration with defaults
    discord: {
        chatRelay: config.chatRelay || {
            enabled: false,
            channels: {},
            chatTypes: { global: true, squad: true, local: true },
            maxMessageLength: 500,
            updateInterval: 5
        },
        notifications: config.notifications || {
            enabled: false,
            channels: {},
            roles: {}
        }
    },
    
    // Validate configuration
    validate() {
        if (!this.token || !this.guildId) {
            console.error('Missing required configuration:');
            console.error('- DISCORD_TOKEN environment variable or Discord.Token in config file');
            console.error('- DISCORD_GUILD_ID environment variable or Discord.GuildId in config file');
            process.exit(1);
        }
        
        // Ensure database directory exists
        const dbDir = path.dirname(this.databasePath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
    }
};
