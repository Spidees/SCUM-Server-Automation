# Developer — HTTP API & Realtime

All under the single web server (`web.port`). Responses are JSON unless noted.

## Public API — `/api/public/*` (no auth, rate-limited ~240/min/IP)

| Method · Path | Returns |
|---|---|
| `GET /overview` | `{ status, server, counts, world, nextRestart, topSquads, categoryLeaders, onlinePlayers }` (cached ~15 s; `onlinePlayers` is `null` when disabled) |
| `GET /site-config` | `{ fieldConsole:{showOnlinePlayers, tabs{…}} }` — read on load to hide disabled tabs / the online list |
| `GET /status` | slim status `{Status,IsOnline,OnlinePlayers,MaxPlayers,LastUpdate}` |
| `GET /game-stats` | aggregate counts + time/weather |
| `GET /players` | online player **names** only (empty when `web.fieldConsole.showOnlinePlayers` is off) |
| `GET /leaderboards?weekly=&limit=` | `{available,generatedAt,categories,leaderboards}` from the snapshot |
| `GET /leaderboards/:category?weekly=&limit=` | one category |
| `GET /squads` | `{available,squads:[{id,name,score,memberCount}]}` |
| `GET /squads/:id` | `{available,squad:{name,score,memberCount,members:[{name,rank}]}}` (id validated) |
| `GET /bunkers` | `{bunkers:[{sector,state,activeSince,nextActivation}]}` |
| `GET /economy` | `{available,deals,traders,gold,timing,recentTrades,market}` — deals/trades carry item name+image (from `scum_items.json`); `market`/`recentTrades` from the in-memory trade buffer |
| `GET /killfeed?limit=` | `{kills:[…]}` from the in-memory ring buffer |

No Steam IDs, IPs or coordinates are exposed here.

## Auth — `/api/auth/*`

| Method · Path | Notes |
|---|---|
| `POST /login` · `POST /logout` · `GET /session` | Admin password session (login has a 5-try/15-min lockout) |
| `GET /discord` | Start OAuth (`prompt=none`; `?consent=1` forces the consent screen) |
| `GET /discord/callback` | OAuth callback; on error retries once with consent |
| `GET /discord/session` · `POST /discord/logout` | Player session state / logout |

## Player API — `/api/player/*` (`requirePlayer`: Discord session linked to a SCUM account)

| Method · Path | Returns |
|---|---|
| `GET /me` | identity |
| `GET /me/overview` | identity + stats + ranks + **skills** (+attributes) + **finances** (bank/cards/gold/account) + squad + notification prefs |
| `GET /me/stats` | full stat sheet (own) |
| `GET /me/notifications` · `POST` | DM-alert prefs |
| `GET /me/notifications/history` | recent DM alerts sent to this player |
| `GET /profile/:name` | another player's profile — **strips** Steam ID, last-logout, member online/last-seen; **skills are included only if the caller is a squadmate**; no finances |

## Admin API — `/api/*` (`requireAuth`) & `/api/game-config/*`

Server controls (`/control/start|stop|restart|backup|validate|update|restart-skip`), `status`,
`scheduling`, `backups`, `update/status`, `config` (GET/POST), `logs/tail`, `players/search`,
`players/:name` (everything: stats, Steam ID/IP/discord/ban, **skills, finances incl. card PINs,
and squad with members**), `bans` (GET/POST, `DELETE /bans/:steamId`),
`account-linking/*`, and the game-config INI/JSON/list editors. These are admin-only; never mount
them publicly.

## Realtime (Socket.IO)

Shares the Express session via `io.engine.use(sessionMiddleware)`. On connect, authenticated admin
sockets join the **`admin`** room. Emitted **only to `admin`**:

| Event | Payload |
|---|---|
| `status:update` | full server status |
| `log:line` | a server-log line |
| `notification` | internal notification |
| `install:progress` | first-install progress |

Anonymous/public sockets receive nothing.

## Rate limiting & validation

`makeRateLimiter` (per-IP fixed window) guards `/api/public` and `/api/player` (240/min) and
`/api/auth/discord` (30/min). `:id`/inputs are validated before hitting the DB. Behind a proxy set
`web.trustProxy`.

Next: [Database & Caching](Developer-Database)
