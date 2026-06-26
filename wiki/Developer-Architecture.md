# Developer — Architecture

A single Node.js process (CommonJS). Entry: `src/index.js` → `src/app.js` (bootstrap) with
`src/setup.js` for first-run.

## Module map (`src/`)

```
core/        config (config.json + .env + paths), logger, events (event bus), state
server/      installation (SteamCMD), service (NSSM), monitoring, log parsing,
             gameConfig (.ini/.json/list editors), bans (BannedUsers.ini + metadata)
automation/  backup, scheduling (restarts + warnings), update (Steam)
database/    db (connections), playerStats, leaderboards (+ leaderboardDefs),
             leaderboardSnapshot, weekly, serverDb, economy, cache, index
discord/     client, slashCommands, liveEmbeds, chatRelay, raidNotify, branding,
             bunkerState, economyState, recentKills, items, logFeeds/* (tailer + 13 feeds + embeds)
web/         server (Express + Socket.IO), routes/*, public/ (admin SPA), public-site/ (Field Console SPA)
```

## Process model

- **Manager process** = this Node app. Long-running; started by NSSM/`Start.bat`.
- **Game server** = a separate Windows service managed via NSSM (`server/service.js`).
- A monitoring loop (`server/monitoring.js`) tracks state, FPS and process health and emits events;
  scheduling/backup/update loops run on timers.

## Event bus

`core/events` is a small EventEmitter used to decouple producers from consumers. Key events:
`status`, `logline`, `notification`, `install:progress`. The web layer forwards them to Socket.IO;
the Discord layer turns notifications into messages.

## The web layer — two "faces", one server

`web/server.js` builds **one** Express app (`buildAdminServer`) served on `web.port`:

| Mount | Auth | Serves |
|---|---|---|
| `GET /` | public | `public-site/` (Field Console SPA); redirects to `/admin/` during first-run setup |
| `GET /admin` | public assets, API gated | `public/` (admin dashboard SPA) |
| `/api/auth` | — | admin password login (`auth.js`) + Discord OAuth (`discordAuth.js`) |
| `/api/public/*` | public (rate-limited) | overview, leaderboards, squads, players, bunkers, economy, killfeed |
| `/api/player/*` | `requirePlayer` (Discord-linked) | `me/overview`, `me/notifications`, `profile/:name` |
| `/api/setup/*` | first-run | setup wizard |
| `/api/game-config/*`, `/api/*` | `requireAuth` (admin) | game-config editors, controls, bans, config |

Realtime (Socket.IO) shares the session; sensitive events go only to the authenticated **admin
room**. See [HTTP API & Realtime](Developer-HTTP-API).

### Gating model
- The public site shows only **Overview** without login; other tabs are gated **on the frontend**
  behind Discord login. Public APIs stay public by design (rate-limited). Player-only data
  (`/api/player/*`) is enforced server-side by `requirePlayer`.

## Data flow examples

- **Leaderboards (web):** `leaderboardSnapshot` (in-memory, lazy 60 s) ← `leaderboards` (memoized
  queries) ← `SCUM.db` (read-only). The public route serves the snapshot; it never queries per request.
- **Raid DM:** a log feed parses an event → `raidNotify.dispatchOwnerAlert` resolves owners from
  `SCUM.db`, DMs linked recipients, and logs each send to `server_database.db` for the player's history.
- **Ban:** admin → `/api/bans` → `server/bans.js` writes `BannedUsers.ini` + stores metadata in
  `server_database.db`.

Next: [HTTP API & Realtime](Developer-HTTP-API) · [Database & Caching](Developer-Database)
