# SCUM Server Automation — Wiki

A complete management tool for a **SCUM dedicated server on Windows**: install, run as a Windows
service, recover from crashes, schedule restarts, back up, apply Steam updates — all through a
**web interface** (admin dashboard + public community "Field Console") and a feature-rich
**Discord bot**.

> 🌐 **Live demo** of the public Field Console: **[scum.playhub.cz](https://scum.playhub.cz/)**

---

## 👤 For users

| Page | What's inside |
|---|---|
| [Installation](Installation) | Requirements, quick start, the first-run setup wizard |
| [Configuration](Configuration) | Every `config/config.json` key and `.env` secret |
| [Web Interface](Web-Interface) | The admin dashboard (`/admin`) — status, controls, settings, players, bans |
| [Public Field Console](Public-Field-Console) | The community site (`/`) — leaderboards, squads, stats, Discord login |
| [Exposing to the Internet](Exposing-to-the-Internet) | Domain, HTTPS (reverse proxy **or** built-in), security checklist |
| [Discord Bot](Discord-Bot) | Bot setup, slash commands, live embeds, log feeds, account linking, raid alerts |
| [Player Management & Bans](Player-Management) | Search players, view profiles, ban/unban |
| [FAQ & Troubleshooting](FAQ) | Common problems and fixes |

## 🛠️ For developers

| Page | What's inside |
|---|---|
| [Architecture](Developer-Architecture) | Module map, process model, the two web "faces", data flow |
| [HTTP API & Realtime](Developer-HTTP-API) | Every endpoint (public / player / admin) + Socket.IO events |
| [Database & Caching](Developer-Database) | `SCUM.db` (read-only), `server_database.db`, the leaderboard snapshot & memo caches |
| [Contributing](Developer-Contributing) | Dev setup, conventions, how to add a log feed / leaderboard / endpoint |

---

## At a glance

- **Server lifecycle** — SteamCMD install, NSSM service control, crash auto-repair, scheduled
  restarts with warnings, backups, Steam updates.
- **Admin dashboard** (`/admin`, password) — live status, controls, config & game-config editors,
  player search/ban, log tail.
- **Public Field Console** (`/`, optional Discord login) — overview is public; leaderboards, squads,
  My Stats, bunkers, economy and kill feed are gated behind **Login with Discord**.
- **Discord bot** — live embeds, 13 log feeds, chat relay, account linking, per-player raid DMs.

See the [README](https://github.com/Spidees/SCUM-Server-Automation) for the short version.
