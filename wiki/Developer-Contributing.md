# Developer — Contributing

## Dev setup

```bat
git clone https://github.com/Spidees/SCUM-Server-Automation.git
cd SCUM-Server-Automation
npm install
copy .env.example .env   :: fill in values
node src/index.js
```

- Node.js 22+ (24 recommended). CommonJS modules.
- You don't need a real SCUM server to work on the web/DB layers if you point `serverDir` at an
  existing save (the app opens `SCUM.db` read-only).
- There's no build step for the frontends — `web/public` (admin) and `web/public-site` (Field
  Console) are plain HTML/CSS/JS served statically.
- **Never commit runtime data.** `.gitignore` excludes `node_modules/`, `.env`, `server/` (the SCUM
  install + saves + `SCUM.db`, which holds player Steam IDs / IPs), `backups/`, `steamcmd/`,
  `nssm.exe`, `data/*.db` and `data/*_state.json`. Only `data/scum_items.json` is tracked under `data/`.

## Conventions

- Match the surrounding code: small focused modules, `'use strict'`, early returns, terse comments
  that explain **why**.
- **Security first:** parameterize all SQL; `esc()`/`escHtml()` any user data rendered into HTML;
  never expose Steam IDs / IPs on public/player routes; keep admin routes behind `requireAuth`.
- **Performance:** wrap hot `SCUM.db` reads in `memo(key, ttl, fn)`; prefer the snapshot / in-memory
  sources for anything the public site polls.
- Frontends share a palette/icon set; reuse the existing CSS variables and inline `<symbol>` icons.

## Common tasks

### Add a public API endpoint
1. Add the route in `web/routes/public.js` (or `player.js` for logged-in-only).
2. Back it with a memoized DB function in `database/*`.
3. It's automatically rate-limited (mounted under the limiter in `server.js`).

### Add a leaderboard category
Add an entry to `database/leaderboardDefs.js` (`allTime.sql` + optional `weekly`). It flows into the
web snapshot, the API, and the Discord leaderboard embed automatically.

### Add a Discord log feed
Create a module in `discord/logFeeds/` exporting `{ name, logPrefix, isEnabled, parseLine, handle }`
and register it in `discord/logFeeds/index.js`. Use the shared `tailer` + `embeds` builders. If it
should drive player DMs, keep `isEnabled` always-on so it polls even when the public channel is off.

### Add a slash command
Define it in `discord/slashCommands.js` (command def + handler) and gate admin commands via
`Discord.SlashCommands.AdminRoles`.

### Add a config option
Add it to `config/config.json`; it appears in the dashboard **Settings** automatically. Read it via
`require('./core/config').config`.

## Checks before a PR

```bat
:: syntax-check changed JS files
node -c path\to\file.js
```

There's no automated test suite yet. Manually verify: admin dashboard loads & streams logs, the
Field Console gates correctly, and any new query is cached. Keep changes backward-compatible with
existing `config.json`/`.env`.

## Useful entry points

`src/index.js` (entry) · `src/app.js` (bootstrap) · `src/web/server.js` (HTTP/WS) ·
`src/database/index.js` (DB facade) · `src/discord/client.js` (bot).
