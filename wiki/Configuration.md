# Configuration

Two files: **`config/config.json`** (non-secret, editable from the dashboard Settings screen) and
**`.env`** (secrets, never committed).

## `config/config.json`

### Core / server

| Key | Default | Description |
|---|---|---|
| `serviceName` | `SCUMSERVER` | Windows service name (NSSM) |
| `appId` | `3792580` | SCUM dedicated-server Steam AppID |
| `publicIP` | `""` | Public IP, used for the connect address shown to players |
| `serverArgs` | `{port, queryPort, maxPlayers, noBattleye, customArgs}` | SCUM launch arguments |
| `serverDir` / `savedDir` / `backupRoot` / `steamCmd` / `nssmPath` | *(wizard)* | Paths |

> Players connect on **game port + 2** (e.g. `-port=7042` → connect on `7044`). The status embed and
> the Field Console overview compute this automatically.

### Restarts, backups, updates

| Key | Default | Description |
|---|---|---|
| `restartTimes` | `["03:00","09:00","15:00","21:00"]` | Scheduled daily restarts (warnings at 15/5/1 min) |
| `autoRestart` | `true` | Restart on crash detection |
| `periodicBackupEnabled` / `backupIntervalMinutes` | `true` / `60` | Periodic backups |
| `maxBackups` / `compressBackups` | `10` / `true` | Retention + zip |
| `runBackupOnStart` / `preRestartBackupEnabled` | `false` | Extra backup triggers |
| `updateCheckIntervalMinutes` / `updateDelayMinutes` | `15` / `10` | Steam update check + delay |

### Monitoring / performance

`monitoringIntervalSeconds`, `logMonitoringEnabled`, `performanceAlertThreshold`,
`performanceThresholds` (FPS bands: excellent/good/fair/poor/critical) and logging options.

### `web` block

| Key | Default | Description |
|---|---|---|
| `web.port` | `8080` | Web server port — serves `/` (Field Console) and `/admin` (dashboard) |
| `web.enabled` | `true` | Start the web server |
| `web.publicUrl` | `""` | Public URL of the Field Console; when set, the Discord embeds link to it |
| `web.bindAddress` | `0.0.0.0` | Interface to bind. Use a LAN IP / `127.0.0.1` to keep the panel off the open net |
| `web.trustProxy` | `false` | `true` behind a reverse proxy so `req.ip` is the real client (rate-limit / allowlist) |
| `web.cookieSecure` | `false` | `true` when served over HTTPS |
| `web.adminAllowlist` | `[]` | Optional IP / IPv4-CIDR allowlist applied to admin requests (loopback always allowed) |
| `web.httpRedirectPort` | `null` | With built-in TLS, an HTTP port (e.g. `80`) that 301-redirects to HTTPS |
| `web.ssl` | `{enabled:false, keyFile:"", certFile:""}` | Serve HTTPS directly (no reverse proxy) |
| `web.fieldConsole` | `{showOnlinePlayers:true, tabs:{…}}` | Field Console visibility: show the online-players list, and each tab (`leaderboards`, `squads`, `myStats`, `bunkers`, `economy`, `killFeed`, `events`). All default `true`; disabled tabs are hidden and their data isn't served |

See [Exposing to the Internet](Exposing-to-the-Internet) for how these fit together.

### `Discord` block

Bot `GuildId`, `Presence`, `Notifications` (admin/player channels per event type),
`LiveEmbeds` (status / players / bunkers / leaderboards channels + intervals + images),
`ChatRelay`, `SlashCommands.AdminRoles`, and `SCUMLogFeatures` (the 13 log feeds + their channels).
See [Discord Bot](Discord-Bot).

## `.env`

```env
DISCORD_TOKEN=          # bot token — empty disables the Discord bot
WEB_ADMIN_PASSWORD=     # admin dashboard (/admin) password — CHANGE from "changeme"
SESSION_SECRET=         # random string — CHANGE from "changeme"

# Optional: "Login with Discord" for the public Field Console (OAuth2)
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_OAUTH_REDIRECT= # e.g. https://your-domain/api/auth/discord/callback
```

`.env` is re-read on config reload. The OAuth values enable the public site's **Login with Discord**
(see [Public Field Console](Public-Field-Console)). Leave them blank to disable player login.

> ⚠️ Always set strong `WEB_ADMIN_PASSWORD` and `SESSION_SECRET` before exposing the panel.
