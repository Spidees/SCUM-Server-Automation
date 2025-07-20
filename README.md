![SCUM Server Automation](http://playhub.cz/scum/manager/repository-open-graph-template.jpg)

# 🎮 SCUM Server Automation v2.1.4

**SCUM Dedicated Server Management for Windows**

This project provides a complete automation solution for running SCUM dedicated servers on Windows. Features include:

- ✅ **Automatic First Install** – Fully automated first-time setup, including SteamCMD download and server installation
- ✅ **Smart Update System** – Intelligent update detection with player notifications and pre-update backups
- ✅ **Scheduled Restarts** – Customizable restart times with advance warnings via Discord
- ✅ **Automated Backups** – Compressed backups with retention management and cleanup
- ✅ **Rich Discord Integration** – Live embeds, comprehensive notifications, and role-based admin commands
- ✅ **Game Chat Relay** – Game chat messages displayed in Discord channels
- ✅ **Live Leaderboards** – Real-time player statistics with weekly and all-time rankings
- ✅ **Crash Recovery** – Automatic server recovery with intelligent health monitoring
- ✅ **Performance Monitoring** – Real-time FPS tracking with configurable alert thresholds
- ✅ **Advanced Log Analysis** – Real-time server state detection and event parsing
- ✅ **Service Management** – Runs as Windows service via NSSM with automatic startup
- ✅ **Database Integration** – SQLite database for player statistics and leaderboards

---

# 📁 Quick Setup Guide

## Prerequisites

Before starting, make sure you have:

- **Windows 10/11** with Administrator access
- **PowerShell 5.1+** (pre-installed on Windows)
- **Discord Bot** (optional, for notifications and admin commands)
- **Visual C++** from Microsoft ( 2012, 2013 and the 2015-2022 files ) [Download](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170)
- **DirectX End-User Runtimes** [Download](https://www.microsoft.com/en-gb/download/details.aspx?id=35)

> 📋 **No manual SCUM server installation required** – the script automatically downloads SteamCMD (if missing) and server files!

## 🚀 Installation Steps

### 1. Download Required Tools

| Tool      | Purpose         | Download Link                       |
|-----------|----------------|-------------------------------------|
| **NSSM**  | Service manager | [Download](https://nssm.cc/download) |


> **Note:** SteamCMD and SQLite tools are downloaded and extracted automatically by the script if not present. No manual download needed!

### 2. Project Structure

Current project structure with modular architecture:

```
📁 SCUMServer/
├── 📄 SCUM-Server-Automation.ps1          # Main automation script
├── 📄 SCUM-Server-Automation.config.json  # Comprehensive configuration file
├── 📄 start_server_manager.bat            # Start server automation system
├── 📄 nssm.exe                            # Service manager
├── 📄 README.md                           # This documentation
├── 📄 SCUM-Server-Automation.log          # Main log file (auto-created)
├── 📄 scum_automation.pid                 # Process ID tracking (auto-created)
├── 📁 server/                             # SCUM server files (auto-created)
│   ├── 📁 SCUM/                           # Main server folder
│   │   ├── 📁 Binaries/Win64/             # Server executable
│   │   ├── 📁 Saved/                      # Save files & configuration
│   │   │   ├── 📁 Config/WindowsServer/   # Server settings (*.ini files)
│   │   │   ├── 📁 SaveFiles/              # Game world saves
│   │   │   └── 📁 Logs/                   # Server logs
│   │   ├── 📁 Content/                    # Game content files
│   │   └── 📁 Shaders/                    # Shader cache
│   ├── 📁 steamapps/                      # Steam manifest files
│   ├── 📁 Engine/                         # Unreal Engine files
│   └── 📁 BattlEye/                       # Anti-cheat system
├── 📁 steamcmd/                           # SteamCMD installation (auto-created)
│   ├── 📄 steamcmd.exe                    # Steam command line tool
│   ├── 📁 steamapps/                      # Steam app cache
│   ├── 📁 logs/                           # SteamCMD logs
│   └── 📁 appcache/                       # Application cache
├── 📁 backups/                            # Automatic backups (auto-created)
├── 📁 data/                               # Database storage (auto-created)
│   └── 📄 weekly_leaderboards.db          # SQLite database for statistics
├── 📁 sqlite-tools/                       # SQLite utilities (auto-downloaded)
│   ├── 📄 sqlite3.exe                     # SQLite command line tool
│   ├── 📄 sqlite3_analyzer.exe            # Database analyzer
│   └── 📄 sqldiff.exe                     # Database diff tool
└── 📁 modules/                            # PowerShell modules (modular architecture)
    ├── 📁 automation/                     # Automation systems
    │   ├── 📁 backup/                     # Backup management
    │   │   └── 📄 backup.psm1             # Backup operations
    │   ├── 📁 scheduling/                 # Scheduled operations
    │   │   └── scheduling.psm1         # Restart scheduling & warnings
    │   └── 📁 update/                     # Update management
    │       └── 📄 update.psm1             # Server update system
    ├── 📁 communication/                  # Communication systems
    │   └── 📁 discord/                    # Discord integration
    │       ├── 📄 discord-integration.psm1 # Main Discord coordinator
    │       ├── 📁 chat/                   # Chat relay system
    │       ├── 📁 commands/               # Discord command handlers
    │       │   ├── 📄 discord-admin-commands.psm1    # Admin commands
    │       │   ├── 📄 discord-player-commands.psm1   # Player commands
    │       │   ├── 📄 discord-scheduled-tasks.psm1   # Task scheduling
    │       │   └── 📄 discord-text-commands.psm1     # Text processing
    │       ├── 📁 core/                   # Discord core functionality
    │       │   ├── 📄 discord-api.psm1    # Discord API wrapper
    │       │   └── 📄 discord-websocket-bot-direct.psm1 # WebSocket bot
    │       ├── 📁 live-embeds/            # Live embed system
    │       │   └── 📄 live-embeds-manager.psm1 # Status & leaderboard embeds
    │       ├── 📁 notifications/          # Notification system
    │       │   ├── 📄 notification-manager.psm1 # Notification coordinator
    │       │   └── 📄 player-notifications.psm1 # Player-specific notifications
    │       └── 📁 templates/              # Message templates
    ├── 📁 core/                           # Core functionality
    │   ├── 📁 common/                     # Common utilities
    │   │   └── 📄 common.psm1             # Shared utility functions
    │   └── 📁 logging/                    # Logging systems
    │       └── 📄 logging.psm1            # Advanced logging & parsing
    ├── 📁 database/                       # Database systems
    │   └── 📄 scum-database.psm1          # SQLite database operations & queries
    └── 📁 server/                         # Server management
        ├── 📁 installation/               # Server installation
        │   └── 📄 installation.psm1       # First-time setup & updates
        ├── 📁 monitoring/                 # Server health monitoring
        │   └── 📄 monitoring.psm1         # Performance & health monitoring
        └── 📁 service/                    # Windows service management
            └── 📄 service.psm1            # NSSM service operations
```

### 3. Setup Instructions

1. **Extract NSSM** and place `nssm.exe` in the root folder
2. **Copy the automation files** to the root folder:
   - `SCUM-Server-Automation.ps1` (main automation script)
   - `SCUM-Server-Automation.config.json` (configuration)
   - `start_server_manager.bat` (startup script)
   - `modules/` folder (complete modular system)

---

# ⚙️ Configuration

All settings are centralized in `SCUM-Server-Automation.config.json` with comprehensive organization:

## Core System Configuration
```json
{
  "serviceName": "SCUMSERVER",           // NSSM service name
  "appId": "3792580",                     // SCUM Steam App ID  
  "publicIP": "99.99.99.99",            // Server public IP
  "publicPort": "7042",                  // Server public port
  "serverDir": "./server",               // Server installation path
  "savedDir": "./server/SCUM/Saved",     // Server save files
  "steamCmd": "./steamcmd/steamcmd.exe", // SteamCMD path (auto-managed)
  "backupRoot": "./backups"              // Backup storage location
}
```

## Automation & Scheduling
```json
{
  "restartTimes": ["23:30", "23:50", "04:55"], // Daily restart schedule
  "periodicBackupEnabled": true,         // Enable automatic backups
  "backupIntervalMinutes": 60,           // Backup frequency
  "maxBackups": 10,                      // Backup retention count
  "compressBackups": true,               // Compress backup files
  "runUpdateOnStart": false,             // Check updates on startup
  "updateCheckIntervalMinutes": 15,      // Update check frequency
  "updateDelayMinutes": 10              // Update delay when server running
}
```

## Performance & Monitoring
```json
{
  "performanceAlertThreshold": "Critical", // Alert sensitivity level
  "performanceAlertCooldownMinutes": 5,   // Alert cooldown period
  "performanceThresholds": {              // Performance level definitions
    "excellent": 30,  // 30+ FPS
    "good": 25,       // 25-29 FPS  
    "fair": 20,       // 20-24 FPS
    "poor": 18,       // 18-19 FPS
    "critical": 17    // <18 FPS (alerts triggered)
  }
}
```

---

# 🔔 Discord Integration Setup

## Comprehensive Discord Bot Integration

The system provides full Discord integration with live embeds, comprehensive notifications, chat relay, and admin commands.

### Discord Configuration Structure
```json
{
  "Discord": {
    "Token": "YOUR_BOT_TOKEN_HERE",
    "GuildId": "YOUR_GUILD_ID_HERE",
    
    "Presence": {
      "Activity": "SCUM Server Automation",
      "Status": "online", 
      "Type": "Watching",
      "DynamicActivity": true,
      "OnlineActivityFormat": "{players} / {maxPlayers} players"
    },
    
    "LiveEmbeds": {
      "StatusChannel": "CHANNEL_ID_FOR_STATUS",
      "LeaderboardsChannel": "CHANNEL_ID_FOR_LEADERBOARDS", 
      "UpdateInterval": 30,
      "LeaderboardUpdateInterval": 120
    },
    
    "Notifications": {
      "Channels": {
        "Admin": "ADMIN_CHANNEL_ID",
        "Players": "PLAYER_CHANNEL_ID" 
      },
      "Roles": {
        "Admin": ["ADMIN_ROLE_ID"],
        "Players": ["PLAYER_ROLE_ID"]
      }
    },
    
    "ChatRelay": {
      "Enabled": true,
      "Channels": {
        "Players": "CHAT_RELAY_CHANNEL_ID",
        "Admin": "ADMIN_CHAT_CHANNEL_ID"
      }
    },
    
    "Commands": {
      "Enabled": true,
      "Channels": {
        "Admin": "ADMIN_COMMANDS_CHANNEL_ID",
        "Players": "PLAYER_COMMANDS_CHANNEL_ID"
      },
      "Roles": {
        "Admin": ["ADMIN_ROLE_ID"],
        "Players": ["PLAYER_ROLE_ID"]
      }
    }
  }
}
```

## Setup Steps

1. **Create Discord Bot:**
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Create New Application → Bot tab → Create Bot
   - Copy the **Bot Token**

2. **Add Bot to Server:**
   - Go to OAuth2 → URL Generator
   - Select scopes: `bot` and permissions: `View Channels`, `Send Messages`, `Manage Messages`, `Read Message History`, `Mention Everyone`, `Use External Emojis`, `Add Reactions`
   - Use generated URL to add bot to your Discord server

3. **Configure Channels and Roles:**
   - Create dedicated channels for different purposes
   - Set up roles for admins and players
   - Copy channel IDs and role IDs to configuration

4. **Features Included:**
   - **Live Status Embeds** - Real-time server status with player count and performance
   - **Live Leaderboards** - Dynamic leaderboards with weekly and all-time statistics  
   - **Chat Relay** - Game chat messages displayed in Discord channels
   - **Rich Notifications** - Comprehensive server event notifications
   - **Admin Commands** - Full server control via Discord
   - **Player Commands** - Information commands for players

---

### First Run

1. **Run `start_server_manager.bat`** (recommended) or `SCUM-Server-Automation.ps1`
2. On first run:
   - The script automatically downloads and extracts SteamCMD if missing
   - SQLite tools are downloaded and configured automatically
   - All required directories are created automatically
   - SCUM server files are downloaded via SteamCMD (no manual installation needed)
   - Database is initialized for leaderboards and statistics
   - After successful install, the script begins monitoring

> 📝 **Note:** The automation system detects missing components and downloads them automatically. Just run the script and it handles everything!

---

# 🔧 NSSM Service Configuration

**NSSM (Non-Sucking Service Manager)** allows your SCUM server to run as a Windows service.

## 1. Install Service

Open **Command Prompt as Administrator** in your SCUM folder and run:

```cmd
nssm.exe install SCUMSERVER
```

## 2. Configure Service Settings

The NSSM GUI will open. Configure each tab as follows:

### 📋 Application Tab
- **Path:** `C:\YourPath\SCUMServer\server\SCUM\Binaries\Win64\SCUMServer.exe`
- **Startup directory:** `C:\YourPath\SCUMServer\server\SCUM\Binaries\Win64`
- **Arguments:** `-port=7777 -log` (adjust port as needed)
  
  > **Known parameters:**
  > - `-port=` (game port)
  > - `-QueryPort=` (query port)
  > - `-MaxPlayers=` (max players)
  > - `-nobattleye` (disable BattlEye)
  > - `-log` (**always required!**)
  >
  > **Note:**
  > - Adding the `-port=7777` argument will start the server on the specified port. When connecting, use the format `IP:port`.
  > - **Important:** The response port for client connections is always the defined port +2. For example, if you start the server with `-port=7777`, players must connect using `IP:7779`.
  > - If no port is defined, the server uses the default port `7779`.
  
### ⚙️ Details Tab
- **Display name:** `SCUMSERVER`
- **Description:** `SCUM Dedicated Server`
- **Startup type:** `Manual` (automation will control it)

### 🔐 Log On Tab
- **Account:** `Local System account`
- ✅ **Allow service to interact with desktop**

### ⚡ Process Tab
- **Priority class:** `Realtime`
- ✅ **Console window**
- **Processor affinity:** `All processors`

### 🛑 Shutdown Tab
- **Shutdown method:** `Generate Ctrl+C`
- **Timeouts:** `300000 ms` for first field
- ✅ **Terminate process**

### 🔄 Exit Actions Tab
- ✅ **On Exit:** `No action (srvany compatible)`
- **Delay restart by:** `3000 ms`

## 3. Install

- Click **"Install service"**

> ⚠️ **Important:** The automation script will control the service – don't set it to "Automatic" startup!

### 📸 Visual Configuration Guide

For visual reference, here are the NSSM configuration screenshots:

| Tab              | Screenshot                                              |
|------------------|--------------------------------------------------------|
| **Application**  | ![Application Tab](https://playhub.cz/scum/manager/nssm1.png) |
| **Details**      | ![Details Tab](https://playhub.cz/scum/manager/nssm6.png)     |
| **Log On**       | ![Log On Tab](https://playhub.cz/scum/manager/nssm2.png)      |
| **Process**      | ![Process Tab](https://playhub.cz/scum/manager/nssm3.png)     |
| **Shutdown**     | ![Shutdown Tab](https://playhub.cz/scum/manager/nssm4.png)    |
| **Exit Actions** | ![Exit Actions Tab](https://playhub.cz/scum/manager/nssm5.png) |

---

# ✅ Server Ready & Advanced Management

Once you have completed the setup, your server provides enterprise-grade management:

## Starting the System
1. **Run `start_server_manager.bat`**
   - Launches the complete automation system
   - Manages server lifecycle automatically
   - Provides Discord integration and live embeds
   - Monitors performance and handles crashes

2. **Monitor via multiple channels:**
   - **Console window** - Real-time status and debug information
   - **Log file** - `SCUM-Server-Automation.log` with detailed operation logs
   - **Discord channels** - Live embeds and notifications
   - **Performance metrics** - Continuous FPS and health monitoring

## Available Management Commands

**System Control Scripts:**
- `start_server_manager.bat` – Launch complete automation system (recommended)
- `SCUM-Server-Automation.ps1` – Direct PowerShell execution

**Discord Admin Commands:**
- `!server_restart [minutes]` – Schedule server restart with optional delay and confirmation
- `!server_stop [minutes]` – Schedule server stop with optional delay and confirmation
- `!server_start` – Start stopped server immediately
- `!server_status` – Comprehensive status report with performance metrics and player info
- `!server_update [minutes]` – Smart update system with delay if server running
- `!server_validate` – Server file validation using SteamCMD
- `!server_backup` – Execute manual backup with compression
- `!server_cancel` – Cancel all scheduled admin actions (restart, stop, update)
- `!server_restart_skip` – Skip the next automatic scheduled restart

> **Security:** All admin commands require configured Discord roles and can only be used in designated channels. Every action is logged and confirmed via Discord reactions.

---

# 🔔 Discord Integration

The system provides comprehensive Discord integration with multiple advanced features:

## Core Features
- **Live Status Embeds** – Real-time server status with performance metrics, player count, and uptime
- **Live Leaderboards** – Dynamic leaderboard displays with weekly and all-time statistics (19 categories)
- **Chat Relay System** – Game chat messages displayed in Discord with multiple chat types
- **Rich Notifications** – Comprehensive event notifications with role-based targeting
- **Admin Command System** – Full server control via Discord with confirmation and security

## Discord Bot Setup
All Discord functionality requires a Discord bot. See the "Discord Integration Setup" section above for complete configuration details.

> **Required Permissions:** `View Channels`, `Send Messages`, `Manage Messages`, `Read Message History`, `Mention Everyone`, `Use External Emojis`, `Add Reactions`

---

# 🛠️ Server Configuration After First Start

After the initial start of your server, the necessary configuration files will be generated. These include all the `.ini` and `.json` files you can edit to customize your server.

To access these files, navigate to:

```
...\server\SCUM\Saved\Config\WindowsServer
```

Below is a summary of the most important files and their purposes:

### AdminUsers.ini
Placing SteamIDs into this file gives players admin rights (basic commands). You can grant access to additional commands by adding arguments in brackets next to the SteamID:

- `[SetGodMode]` — Access to `#SetGodMode True/False` (instant building)
- `[RestartServer]` — Access to `#RestartServer pretty please` (shutdown sequence)

**Examples:**
```
76561199637135087                        # admin commands
76561199637135087[SetGodMode]            # admin + setgodmode  
76561199637135087[SetGodMode,RestartServer] # admin + setgodmode + restartserver
```

### BannedUsers.ini
All banned players are listed here. You can also manually add SteamIDs to ban users.

### EconomyOverride.json
Adjust prices of items and services at traders in safe zones. Examples are included in the file—replace the item/service name and assign to the correct trader.
- More info: [Economy Update News](https://store.steampowered.com/news/app/513710/view/3131696199142015448)
- Tool: [SCUM Trader Economy Tool](https://trader.scum-global.com/)

### ExclusiveUsers.ini
Add SteamIDs of players who should have exclusive access. Only listed players can join. This is active after the first SteamID is added.

### GameUserSettings.ini & Input.ini
These files are not used by the server and can be ignored.

### RaidTimes.json
Set global raid times. More info: [Raid Times Guide](https://store.steampowered.com/news/app/513710/view/4202497395525190702)

### ServerSettings.ini
Contains all server settings. You can manually configure your server here without entering the game.

### ServerSettingsAdminUsers.ini
Add SteamIDs to grant access to in-game server settings configuration.

### SilencedUsers.ini
Lists silenced players and the duration of their silence.

### WhitelistedUsers.ini
Add SteamIDs for players who should have priority access. Whitelisted players can join even if the server is full (one non-whitelisted player will be kicked if needed).

---

## Additional Resources

- **Loot Modification Guide:** [Google Doc](https://docs.google.com/document/d/1TIxj5OUnyrOvnXyEn3aigxLzTUQ-o-695luaaK2PTW0)
- **Custom Quests Guide:** [Google Doc](https://docs.google.com/document/d/1B1qooypdebE2xvJ33cb-BIH5MEEsvi9w4v-vrgcYO1k/edit?tab=t.0#heading=h.o19tfspdpkw9)

---

## Server Logs

- The output from the server window is saved in the `Logs` folder:
  - `...\server\SCUM\Saved\Logs`
- Additional logs:
  - `...\server\SCUM\Saved\SaveFiles\Logs`
- Automation system logs:
  - `SCUM-Server-Automation.log` (in root directory)
- SteamCMD logs:
  - `...\steamcmd\logs\`


# 📝 Best Practices & Troubleshooting

- Always run as Administrator
- Use `start_server_manager.bat` for automated server management
- Use `start_server.bat` and `stop_server.bat` for manual service control
- Configure Discord fields with empty arrays (`[]`) if not used
- Monitor `SCUM-Server-Automation.log` for errors and status
- Test Discord commands and notifications after setup
- Adjust performance thresholds for your community size and hardware
- Configure notification settings to avoid spam

**Common issues:**

| Problem                      | Solution                                                      |
|------------------------------|---------------------------------------------------------------|
| Notifications not sending    | Check bot token/channel IDs, use empty arrays if not used    |
| Server won't start           | Check NSSM/service config, verify paths                      |
| Updates failing              | Run as Admin, check SteamCMD path, check log                 |
| Backups not working          | Check disk space/permissions                                  |
| Commands ignored             | Check Discord role/channel config                            |
| Performance alerts spam     | Adjust performance thresholds and cooldown settings          |
| Log file growing too large   | Enable log rotation in configuration                         |
| Automation not detecting crashes | Check log monitoring settings and server log path        |

---

## 💬 Community & Contact

Got questions, feedback, or just want to hang out?
You can contact me or join the community here:

[![Discord Badge](https://img.shields.io/badge/Join%20us%20on-Discord-5865F2?style=flat&logo=discord&logoColor=white)](https://playhub.cz/discord)

---

## 🙌 Support

If you enjoy this project, consider supporting:

[![Ko-fi Badge](https://img.shields.io/badge/Support%20me%20on-Ko--fi-ff5e5b?style=flat&logo=ko-fi&logoColor=white)](https://ko-fi.com/playhub)
[![PayPal Badge](https://img.shields.io/badge/Donate-PayPal-0070ba?style=flat&logo=paypal&logoColor=white)](https://paypal.me/spidees)

Thanks for your support!
