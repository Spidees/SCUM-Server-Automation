const fs = require('fs');
const path = require('path');
const { writeLog } = require('./utils');
const CONFIG = require('../config/config');

class ChatManager {
    constructor() {
        this.isInitialized = false;
        this.isMonitoring = false;
        this.chatLogDirectory = null;
        this.currentLogFile = null;
        this.lastLineNumber = 0;
        this.stateFile = null;
        this.discordClient = null;
        this.chatConfig = null;
        this.monitoringInterval = null;
        this.lastDebugTime = null;
    }

    initialize(client) {
        try {
            writeLog('Initializing chat management system...', 'Debug');
            
            this.discordClient = client;
            
            // Get chat configuration
            this.chatConfig = CONFIG.chatRelay;
            if (!this.chatConfig || !this.chatConfig.enabled) {
                writeLog('Chat relay not enabled in configuration', 'Debug');
                return false;
            }

            // Initialize chat log directory
            const serverDir = CONFIG.serverDirectory;
            if (!serverDir) {
                writeLog('Server directory not configured', 'Error');
                return false;
            }

            this.chatLogDirectory = path.join(serverDir, 'SCUM', 'Saved', 'SaveFiles', 'Logs');
            writeLog(`Chat log directory: ${this.chatLogDirectory}`, 'Debug');

            if (!fs.existsSync(this.chatLogDirectory)) {
                writeLog(`Chat log directory not found: ${this.chatLogDirectory}`, 'Debug');
                return false;
            }

            // Initialize state persistence
            const stateDir = path.join(process.cwd(), 'state');
            if (!fs.existsSync(stateDir)) {
                fs.mkdirSync(stateDir, { recursive: true });
            }
            this.stateFile = path.join(stateDir, 'chat-manager.json');

            // Load previous state
            this.loadChatState();

            // Start monitoring
            this.startMonitoring();

            this.isInitialized = true;
            writeLog('Chat management system initialized successfully', 'Debug');
            writeLog(`Players channel: ${this.chatConfig.channels.players}`, 'Debug');
            writeLog(`Admin channel: ${this.chatConfig.channels.admin}`, 'Debug');
            writeLog(`Update interval: ${this.chatConfig.updateInterval} seconds`, 'Debug');

            return true;
        } catch (error) {
            writeLog(`Failed to initialize chat manager: ${error.message}`, 'Error');
            return false;
        }
    }

    startMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
        }

        this.isMonitoring = true;
        const updateInterval = (this.chatConfig.updateInterval || 5) * 1000;

        this.monitoringInterval = setInterval(() => {
            this.updateChatManager();
        }, updateInterval);

        writeLog(`Chat monitoring started with ${updateInterval/1000}s interval`, 'Debug');
    }

    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        
        this.isMonitoring = false;
        this.saveChatState();
        writeLog('Chat monitoring stopped', 'Debug');
    }

    updateChatManager() {
        if (!this.isMonitoring) {
            return;
        }

        // Debug log every 5 minutes
        const currentTime = new Date();
        if (!this.lastDebugTime || (currentTime - this.lastDebugTime) >= 300000) {
            writeLog('Chat monitoring active', 'Debug');
            this.lastDebugTime = currentTime;
        }

        try {
            const newMessages = this.getNewChatMessages();
            
            if (!newMessages || newMessages.length === 0) {
                return;
            }

            for (const message of newMessages) {
                writeLog(`[${message.type}] ${message.nickname}: ${message.message}`, 'Debug');
                
                // Process connect commands first
                const isConnectCommand = this.processConnectCommand(message);
                
                // Only relay to Discord if it's not a connect command (to keep registration codes private)
                if (!isConnectCommand) {
                    this.sendChatMessageToDiscord(message);
                }
            }

            // Save state after processing
            this.saveChatState();

        } catch (error) {
            writeLog(`Error during chat update: ${error.message}`, 'Error');
        }
    }

    getNewChatMessages() {
        try {
            // Get the latest chat log file
            const latestChatLog = this.getLatestChatLogFile();
            if (!latestChatLog) {
                return [];
            }

            // Check if we're monitoring a different file now
            if (this.currentLogFile !== latestChatLog) {
                writeLog(`Switching to new chat log: ${latestChatLog}`, 'Debug');
                this.currentLogFile = latestChatLog;
                this.lastLineNumber = 0; // Reset line counter for new file
            }

            if (!fs.existsSync(this.currentLogFile)) {
                writeLog(`Chat log file not found: ${this.currentLogFile}`, 'Debug');
                return [];
            }

            // Read file content
            const content = fs.readFileSync(this.currentLogFile, 'utf16le');
            const lines = content.split(/\r?\n/);

            // Get new lines since last check
            const newLines = lines.slice(this.lastLineNumber);
            this.lastLineNumber = lines.length;

            // Parse chat messages from new lines
            const newMessages = [];
            for (const line of newLines) {
                if (line && line.trim() && !line.includes('Game version:')) {
                    const parsedMessage = this.parseChatLine(line);
                    if (parsedMessage) {
                        // Check if this chat type is enabled
                        if (this.chatConfig.chatTypes && this.chatConfig.chatTypes[parsedMessage.type]) {
                            newMessages.push(parsedMessage);
                        }
                    }
                }
            }

            return newMessages;

        } catch (error) {
            writeLog(`Error reading chat log: ${error.message}`, 'Error');
            return [];
        }
    }

    getLatestChatLogFile() {
        try {
            const files = fs.readdirSync(this.chatLogDirectory);
            const chatFiles = files.filter(file => file.startsWith('chat_') && file.endsWith('.log'));

            if (chatFiles.length === 0) {
                writeLog(`No chat log files found in ${this.chatLogDirectory}`, 'Debug');
                return null;
            }

            // Sort by creation time and get the latest
            const fullPaths = chatFiles.map(file => {
                const fullPath = path.join(this.chatLogDirectory, file);
                const stats = fs.statSync(fullPath);
                return { path: fullPath, ctime: stats.ctime };
            });

            fullPaths.sort((a, b) => b.ctime - a.ctime);
            return fullPaths[0].path;

        } catch (error) {
            writeLog(`Error finding latest chat log: ${error.message}`, 'Error');
            return null;
        }
    }

    parseChatLine(line) {
        // SCUM chat log pattern: 2025.07.13-10.47.24: '76561198079911047:Nikynka(51)' 'Local: local'
        const match = line.match(/^([\d.-]+):\s+'([\d]+):([^(]+)\((\d+)\)'\s+'([^:]+):\s*(.+)'$/);
        
        if (match) {
            const [, dateStr, steamId, nickname, playerId, chatType, message] = match;
            
            let timestamp;
            try {
                // Parse date: 2025.06.21-08.51.51 -> 2025/06/21 08:51:51
                const datePart = dateStr.replace(/\./g, '/').replace('-', ' ');
                timestamp = new Date(datePart.replace(/\.(\d{2})$/, ':$1'));
            } catch {
                timestamp = new Date();
            }

            return {
                timestamp,
                steamId,
                nickname: nickname.trim(),
                playerId,
                message,
                type: chatType.toLowerCase(),
                rawLine: line
            };
        }

        return null;
    }

    processConnectCommand(chatMessage) {
        try {
            // Check if message is a connect command
            const connectMatch = chatMessage.message.match(/^connect:([A-Z0-9]{6})$/);
            if (connectMatch) {
                const registrationCode = connectMatch[1];
                writeLog(`Connect command detected from player: ${chatMessage.nickname} with code: ${registrationCode}`, 'Debug');
                
                // Call connect API endpoint
                this.callConnectAPI(chatMessage.steamId, chatMessage.nickname, registrationCode);
                
                return true;
            }
            
            return false;
        } catch (error) {
            writeLog(`Error processing chat message for connect commands: ${error.message}`, 'Error');
            return false;
        }
    }

    async callConnectAPI(steamId, playerName, registrationCode) {
        try {
            const http = require('http');
            
            const postData = JSON.stringify({
                steamId: steamId,
                playerName: playerName,
                registrationCode: registrationCode
            });

            const options = {
                hostname: 'localhost',
                port: CONFIG.httpPort,
                path: '/api/connect',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const req = http.request(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const result = JSON.parse(data);
                        
                        if (result.success) {
                            writeLog(`Account linking successful via connect command: ${playerName} (${steamId})`, 'Debug');
                        } else {
                            writeLog(`Account linking failed via connect command: ${result.message}`, 'Warning');
                        }
                    } catch (parseError) {
                        writeLog(`Error parsing connect API response: ${parseError.message}`, 'Error');
                    }
                });
            });

            req.on('error', (error) => {
                writeLog(`Error calling connect API: ${error.message}`, 'Error');
            });

            req.write(postData);
            req.end();
            
        } catch (error) {
            writeLog(`Error calling connect API: ${error.message}`, 'Error');
        }
    }

    async sendChatMessageToDiscord(message) {
        try {
            // Check if this chat type is enabled
            if (!this.chatConfig.chatTypes[message.type]) {
                return;
            }

            // Check message length
            const maxLength = this.chatConfig.maxMessageLength || 500;
            let messageText = message.message;
            if (messageText.length > maxLength) {
                messageText = messageText.substring(0, maxLength - 3) + '...';
            }

            // Filter message for Discord compatibility
            const filteredNickname = this.applyMessageFilter(message.nickname);
            const filteredMessage = this.applyMessageFilter(messageText);

            // Ensure message isn't empty after filtering
            if (!filteredMessage.trim()) {
                writeLog('Message is empty after filtering, skipping', 'Debug');
                return;
            }

            // Ensure message doesn't exceed Discord's limit (2000 characters)
            const finalMessage = filteredMessage.length > 2000 
                ? filteredMessage.substring(0, 1997) + '...' 
                : filteredMessage;

            // Format message based on chat type
            let adminFormatTemplate;
            switch (message.type) {
                case 'squad':
                    adminFormatTemplate = '[SQUAD] **{nickname}**: {message}';
                    break;
                case 'local':
                    adminFormatTemplate = '[LOCAL] **{nickname}**: {message}';
                    break;
                case 'global':
                    adminFormatTemplate = '[GLOBAL] **{nickname}**: {message}';
                    break;
                default:
                    adminFormatTemplate = '[{type}] **{nickname}**: {message}';
            }

            const playerFormatTemplate = '**{nickname}**: {message}';

            // Send to Admin channel (all message types)
            const adminFormattedMessage = adminFormatTemplate
                .replace('{nickname}', filteredNickname)
                .replace('{message}', finalMessage)
                .replace('{type}', message.type.toUpperCase());

            try {
                const adminChannel = await this.discordClient.channels.fetch(this.chatConfig.channels.admin);
                if (adminChannel) {
                    await adminChannel.send(adminFormattedMessage);
                    writeLog('Chat message sent to admin channel', 'Debug');
                } else {
                    writeLog('Admin channel not found', 'Warning');
                }
            } catch (error) {
                writeLog(`Error sending to admin channel: ${error.message}`, 'Error');
            }

            // Send to Players channel only for global messages
            if (message.type === 'global') {
                try {
                    const playerFormattedMessage = playerFormatTemplate
                        .replace('{nickname}', filteredNickname)
                        .replace('{message}', finalMessage);

                    const playersChannel = await this.discordClient.channels.fetch(this.chatConfig.channels.players);
                    if (playersChannel) {
                        await playersChannel.send(playerFormattedMessage);
                        writeLog('Chat message sent to players channel', 'Debug');
                    } else {
                        writeLog('Players channel not found', 'Warning');
                    }
                } catch (error) {
                    writeLog(`Error sending to players channel: ${error.message}`, 'Error');
                }
            }

        } catch (error) {
            writeLog(`Error sending message to Discord: ${error.message}`, 'Error');
        }
    }

    applyMessageFilter(message) {
        // Start with the original message
        let result = message;

        // Remove excessive repeated characters (only for spam prevention)
        result = result.replace(/(.)\1{4,}/g, '$1$1$1');

        // Remove excessive caps (convert to title case if too many caps)
        if (result.match(/[A-Z]{10,}/)) {
            result = result.toLowerCase();
            result = result.charAt(0).toUpperCase() + result.slice(1);
        }

        // Remove only dangerous control characters (keep Unicode printable chars)
        result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

        // Escape Discord special sequences to prevent exploits
        result = result.replace(/```/g, '`‌`‌`');
        result = result.replace(/@everyone/g, '@‌everyone');
        result = result.replace(/@here/g, '@‌here');

        // Ensure not empty
        if (!result.trim()) {
            result = '[filtered message]';
        }

        return result;
    }

    saveChatState() {
        try {
            const state = {
                currentLogFile: this.currentLogFile,
                lastLineNumber: this.lastLineNumber,
                lastUpdate: new Date().toISOString()
            };

            fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));

        } catch (error) {
            writeLog(`Failed to save chat state: ${error.message}`, 'Error');
        }
    }

    loadChatState() {
        try {
            if (fs.existsSync(this.stateFile)) {
                const stateData = fs.readFileSync(this.stateFile, 'utf8');
                const state = JSON.parse(stateData);

                // Support both old (PascalCase) and new (camelCase) format
                this.currentLogFile = state.currentLogFile || state.CurrentLogFile || null;
                this.lastLineNumber = state.lastLineNumber || state.LastLineNumber || 0;

                // Verify the saved log file still exists, if not reset
                if (this.currentLogFile && !fs.existsSync(this.currentLogFile)) {
                    writeLog('Previous log file no longer exists, resetting state', 'Debug');
                    this.currentLogFile = null;
                    this.lastLineNumber = 0;
                } else {
                    writeLog(`Loaded previous state: File=${this.currentLogFile}, Line=${this.lastLineNumber}`, 'Debug');
                }
            } else {
                writeLog('No previous state found, starting fresh', 'Debug');
                this.currentLogFile = null;
                this.lastLineNumber = 0;
            }
        } catch (error) {
            writeLog(`Failed to load chat state, starting fresh: ${error.message}`, 'Error');
            this.currentLogFile = null;
            this.lastLineNumber = 0;
        }
    }

    getStatus() {
        return {
            isInitialized: this.isInitialized,
            isMonitoring: this.isMonitoring,
            currentLogFile: this.currentLogFile,
            lastLineNumber: this.lastLineNumber,
            chatLogDirectory: this.chatLogDirectory
        };
    }

    stop() {
        this.stopMonitoring();
        writeLog('Chat management system stopped', 'Debug');
    }
}

module.exports = new ChatManager();
