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
            if (configFile.Discord) {
                config.token = config.token || configFile.Discord.Token;
                config.guildId = config.guildId || configFile.Discord.GuildId;
                if (configFile.Discord.HttpApi) {
                    config.httpPort = config.httpPort || configFile.Discord.HttpApi.Port || 3001;
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
