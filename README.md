![SCUM Server Automation](http://playhub.cz/scum/manager/repository-open-graph-template.jpg)

# SCUM Server Automation

A complete management tool for a **SCUM dedicated server on Windows**. It handles the full server
lifecycle — installation, Windows-service control, crash recovery, scheduled restarts, backups and
Steam updates — and exposes everything through a themed **web dashboard** and a feature-rich
**Discord bot** (live embeds, log feeds, leaderboards, account linking and per-player raid alerts).

> 🌐 **Live demo** — see the public Field Console running on my own server:
> **[scum.playhub.cz](https://scum.playhub.cz/)**

---

## 📚 Documentation

Full docs live in the **[Wiki](https://github.com/Spidees/SCUM-Server-Automation/wiki)**:

**For users** —
[Installation](https://github.com/Spidees/SCUM-Server-Automation/wiki/Installation) ·
[Configuration](https://github.com/Spidees/SCUM-Server-Automation/wiki/Configuration) ·
[Web Interface](https://github.com/Spidees/SCUM-Server-Automation/wiki/Web-Interface) ·
[Public Field Console](https://github.com/Spidees/SCUM-Server-Automation/wiki/Public-Field-Console) ·
[Exposing to the Internet](https://github.com/Spidees/SCUM-Server-Automation/wiki/Exposing-to-the-Internet) ·
[Discord Bot](https://github.com/Spidees/SCUM-Server-Automation/wiki/Discord-Bot) ·
[Player Management & Bans](https://github.com/Spidees/SCUM-Server-Automation/wiki/Player-Management) ·
[FAQ & Troubleshooting](https://github.com/Spidees/SCUM-Server-Automation/wiki/FAQ)

**For developers** —
[Architecture](https://github.com/Spidees/SCUM-Server-Automation/wiki/Developer-Architecture) ·
[HTTP API & Realtime](https://github.com/Spidees/SCUM-Server-Automation/wiki/Developer-HTTP-API) ·
[Database & Caching](https://github.com/Spidees/SCUM-Server-Automation/wiki/Developer-Database) ·
[Contributing](https://github.com/Spidees/SCUM-Server-Automation/wiki/Developer-Contributing)

---

## Features

### Server management
- One-click install of the SCUM dedicated server via **SteamCMD** on first run
- Start / stop / restart through a Windows service (**NSSM**)
- Configurable launch arguments — game port, query port, max players, BattlEye — set during
  setup and **auto-synced to the service** whenever you change them
- **Crash detection & auto-repair**: if the service is up but the process died, it restarts
- **Scheduled restarts** at configurable times with 15 / 5 / 1-minute warnings
- Skip the next scheduled restart from the dashboard or Discord

### Backups & updates
- Periodic, on-start and pre-restart backups of the `Saved/` directory (zip or plain copy,
  configurable retention)
- Automatic Steam update detection with a configurable delay and countdown warnings
- Manual *validate files* and *check & update* actions (with confirmation on Discord)

### Web interface

The web server (default `http://localhost:8080`) serves **two faces** that share one tactical
"field terminal" theme:

**Admin dashboard — `/admin`** (password-protected, for server staff)
- Live status: state, players, **system CPU & RAM (used / total)**, server FPS, entities, service status
- Server controls (start / stop / restart / backup / validate / check & update)
- Scheduling & backup info, next restart (incl. pending **manual** restarts) and skip toggle
- **Players** screen — search by **name / Steam ID / IP**, open a full player profile (all stats,
  Steam ID, IP, last login/logout, Discord link) and **ban / unban** (writes `BannedUsers.ini`)
- **Settings** — every `config/config.json` option, grouped & searchable
- **Game Settings** — `ServerSettings.ini` editor, user lists (admin / banned / exclusive /
  whitelisted), raw-JSON editors for `EconomyOverride.json`, `RaidTimes.json`, `Notifications.json`
- **Discord** screen — post the account-linking panel, view linked accounts (click → player profile)
- Live server-log tail over WebSocket (admin-only)

![Admin dashboard — overview](http://playhub.cz/scum/manager/admin_overview.png)
![Admin dashboard — settings](http://playhub.cz/scum/manager/admin_settings.png)

**Public Field Console — `/`** (community-facing, optional Discord login) — [live demo: scum.playhub.cz](https://scum.playhub.cz/)
- **Overview** (public): server name, connect address, FPS, next restart, in-game time/weather,
  total players, active squads, top squads
- **Login with Discord** (OAuth) — everything below is gated behind login:
  **Leaderboards** (filterable, click a player → their stats), **Squads** (roster, click for detail),
  **My Stats** (full character sheet + leaderboard ranks + your squad + **DM-alert settings & history**),
  **Bunkers**, **Economy** (mirrors the Discord embed), **Kill Feed**
- Optional **link in the Discord embeds** to the live Field Console (set `web.publicUrl`)

![Field Console — overview](http://playhub.cz/scum/manager/field_console_overview.png)
![Field Console — leaderboards](http://playhub.cz/scum/manager/field_console_leaderboards.png)
![Field Console — my stats](http://playhub.cz/scum/manager/field_console_mystats.png)
![Field Console — economy](http://playhub.cz/scum/manager/field_console_economy.png)

> **Exposing it to the internet?** See **[Exposing to the Internet](https://github.com/Spidees/SCUM-Server-Automation/wiki/Exposing-to-the-Internet)**
> for domain + HTTPS (reverse proxy or built-in TLS), `bindAddress`, rate limiting and the security
> checklist.

### Discord bot (optional)
- **Notifications** — server lifecycle, service status, backups, updates, performance alerts and
  restart/update warnings (admin vs. player channels, configurable per type)
- **Live self-updating embeds** — server status, online players, abandoned-bunker status and
  leaderboards (each with its own channel, interval and optional image)
- **Chat relay** — in-game chat → Discord (global / squad / local)
- **13 real-time log feeds** — Kill, Login, Admin, Chest, Economy, Event-kill, Fame, Gameplay,
  Quest, Raid-protection, Vehicle, Violations, Base-building-destruction — each posts a clean,
  unified embed with **interactive map links** (scum-map.com)
- **Account linking** — link Discord ↔ SCUM character with an in-game code and a persistent panel
- **Per-player raid alerts (DMs)** — opt in via the panel's *Notifications* button to be DM'd when
  your **base protection** changes, your **base is being destroyed**, your **vehicle** is destroyed,
  your **chest** is taken, or your **lock** is picked — for your own property or your squad's
- Slash commands for server control and detailed player stats

![SCUM Server Automation - Dashboard](http://playhub.cz/scum/manager/discordbot.png)

---

## Requirements

| Requirement | Notes |
|---|---|
| **Windows** | Service control uses `sc.exe` + NSSM |
| **NSSM** | Download `nssm.exe` from [nssm.cc](https://nssm.cc/download) and place it in the project root (next to `Start.bat`) |
| **Node.js 22+** | Installed automatically by `Start.bat`, or get it from [nodejs.org](https://nodejs.org) |
| **SteamCMD** | Auto-downloaded into `steamcmd/` on first install |
| **Administrator rights** | `Start.bat` self-elevates (required for service control) |
| **Discord bot** *(optional)* | Create one at [discord.com/developers](https://discord.com/developers/applications) |
| **Visual C++** | from Microsoft ( 2012, 2013 and the 2015-2022 files ) [Download](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170)
| **DirectX End-User Runtimes** | [Download](https://www.microsoft.com/en-gb/download/details.aspx?id=35)

> Native dependency `better-sqlite3` ships prebuilt binaries — no Python or build tools needed on
> supported Node versions.

---

## Quick start

```bat
git clone https://github.com/Spidees/SCUM-Server-Automation.git
cd SCUM-Server-Automation
:: download nssm.exe from https://nssm.cc/download and put it in this folder
Start.bat
```

`Start.bat` self-elevates to administrator, installs Node.js if missing, runs `npm install`, then
launches the app and opens the browser.

On first run the dashboard shows an **interactive setup wizard**:
- SCUM server directory & backup directory
- Windows service name
- Public IP, game port, query port, max players, BattlEye toggle
- Web panel port & admin password
- Discord bot token & Guild ID *(optional — can be added later)*

After saving, the SCUM server is installed (you can watch the progress in the browser) and the app
starts automatically. Subsequent launches skip the wizard.

---

## Configuration

### `config/config.json`
All non-secret settings — editable directly or from the dashboard **Settings** screen.

| Key | Default | Description |
|---|---|---|
| `serviceName` | `SCUMSERVER` | Windows service name (NSSM) |
| `serverDir` / `savedDir` / `backupRoot` | *(wizard)* | Core paths |
| `serverArgs` | `{port, queryPort, maxPlayers, noBattleye}` | SCUM launch arguments |
| `restartTimes` | `["03:00","09:00","15:00","21:00"]` | Scheduled daily restarts |
| `autoRestart` | `true` | Auto-restart on crash detection |
| `backupIntervalMinutes` | `60` | Periodic backup interval |
| `updateCheckIntervalMinutes` | `15` | How often to check for Steam updates |
| `web.port` | `8080` | Web server port (serves both `/` and `/admin`) |
| `web.publicUrl` | `""` | Public URL of the Field Console; when set, Discord embeds link to it |
| `web.bindAddress` | `0.0.0.0` | Interface to bind (set to a LAN IP / `127.0.0.1` to keep it off the open net) |
| `web.trustProxy` | `false` | Set `true` behind a reverse proxy so the real client IP is used |
| `web.cookieSecure` | `false` | Set `true` when served over HTTPS |
| `web.adminAllowlist` | `[]` | Optional IP/CIDR allowlist for admin requests |
| `web.httpRedirectPort` | `null` | With built-in TLS, an HTTP port (e.g. `80`) that 301s to HTTPS |
| `web.ssl` | `{enabled,keyFile,certFile}` | Serve HTTPS directly without a reverse proxy |
| `Discord` | … | Bot presence, notifications, live embeds, chat relay, log feeds |

> Players connect on **game port + 2** (e.g. `-port=7042` → connect on `7042` … the in-game/server
> address shown in the status embed uses the +2 connect port automatically).

### `.env`
Secrets — never commit this file. The wizard generates the first three.

```env
DISCORD_TOKEN=          # bot token — leave empty to disable the Discord bot
WEB_ADMIN_PASSWORD=     # admin dashboard (/admin) login password
SESSION_SECRET=         # random string (auto-generated)

# Optional "Login with Discord" for the public Field Console (OAuth2)
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_OAUTH_REDIRECT= # e.g. https://your-domain/api/auth/discord/callback
```

To reconfigure from scratch, delete `.env` and restart.

---

## Discord

1. [discord.com/developers/applications](https://discord.com/developers/applications) → **New
   Application** → **Bot** → copy the token.
2. Enable **Message Content Intent** (needed for chat relay & account linking).
3. Invite with scopes `bot` + `applications.commands` and permissions: *Send Messages, Embed Links,
   Read Message History, Manage Messages*.
4. Put the token in `.env` and your Guild ID in `config/config.json` (or via the wizard).

### Slash commands

| Command | Who | Description |
|---|---|---|
| `/link-account` · `/unlink-account` | Anyone | Link / unlink your SCUM character |
| `/my-stats` | Linked | Your detailed SCUM stats |
| `/player-stats <name>` · `/player-search <query>` | Anyone | Look up / search players |
| `/server-info` · `/player-online` | Anyone | Current status / online players |
| `/server-status` | Admin | Full live status embed |
| `/server-start` | Admin | Start the server |
| `/server-stop [minutes]` | Admin | Stop (immediate → **confirm button**, or delayed with warnings) |
| `/server-restart [minutes]` | Admin | Restart (confirm or delayed) |
| `/server-update [minutes]` | Admin | Apply Steam update (confirm or delayed) |
| `/server-backup` · `/server-validate` | Admin | Manual backup / file validation |
| `/server-cancel` | Admin | Cancel a pending stop / restart / update |
| `/server-restart-skip` | Admin | Toggle skipping the next scheduled restart |
| `/bot-status` | Admin | Bot uptime, DB status, linked accounts |

Admin commands are restricted to roles in `Discord.SlashCommands.AdminRoles`.

### Account linking & raid alerts

1. `/link-account` → receive a private 6-character code (valid 15 min).
2. Join the server and type `connect:XXXXXX` in chat (the code is hidden from the chat relay).
3. The bot confirms via DM.

From the persistent **linking panel** (post it from the dashboard's *Discord* screen), players use
the **⚙️ Notifications** button to choose what to be DM'd about — *Raid / Base, Vehicles, Chests,
Locks* — and the scope (*my stuff only* or *my squad too*). Owners are resolved from the SCUM
database; lock owners and base owners are matched even when the destroyed object is already gone.

### Live embeds

Configured under `Discord.LiveEmbeds` (channel + interval + optional image each):

| Embed | Channel key |
|---|---|
| Server status | `StatusChannel` |
| Online players | `PlayersChannel` |
| Abandoned bunkers (open/locked + timers + map links) | `BunkerChannel` |
| Leaderboards (weekly + all-time) | `LeaderboardsChannel` |

### Log feeds

Each feed tails its SCUM log every `SCUMLogFeatures.UpdateInterval` seconds and posts an embed.
Enable feeds and set channel IDs under `SCUMLogFeatures` (or via Settings). The **Kill feed**
supports a delay queue so dying players can't immediately see who killed them. Vehicle, chest,
gameplay and base-building feeds always parse the log so **player DM alerts work even when their
public channel is off**.

---

## Project structure

```
├── Start.bat / install-node.ps1   # launcher (admin elevation, Node install, npm install, run)
├── nssm.exe                        # Windows service manager (download from nssm.cc)
├── config/config.json              # all non-secret settings
├── data/                           # runtime DBs, log-feed state, item DB (mostly gitignored)
│   └── scum_items.json             # SCUM item database (names + icons) for embeds
├── src/
│   ├── index.js · setup.js · app.js   # entry, setup wizard, bootstrap
│   ├── core/        # config, logger, event bus, shared state
│   ├── server/      # install, NSSM service, log parser, monitoring, game-config (.ini/.json)
│   ├── automation/  # backups, restart scheduling, Steam updates
│   ├── database/    # SCUM.db (read-only), leaderboards, weekly snapshots, server_database.db
│   ├── discord/     # bot, notifications, live embeds, chat relay, slash commands, raid alerts,
│   │   └── logFeeds/    #   bunker tracker, 13 log-feed modules + tailer & embed builders
│   └── web/         # Express + socket.io web server
│       ├── public/       #   admin dashboard SPA (served at /admin)
│       ├── public-site/  #   public Field Console SPA (served at /)
│       └── routes/       #   auth (admin), discordAuth (player OAuth), api (admin),
│                         #   public, player, game-config, setup
└── package.json
```

### Runtime data (`data/`)

| File / DB | Purpose |
|---|---|
| `SCUM-Server-Automation.log` | Application log |
| `server_database.db` | Player profiles, raid-protection state, account links, notification prefs |
| `weekly_leaderboards.db` | Weekly leaderboard snapshots |
| `logfeed_<name>_state.json` | Last-read position per log feed |
| `scum_restart_skip.flag` | Persistent restart-skip flag |

---

## License

MIT — see [LICENSE](LICENSE).

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