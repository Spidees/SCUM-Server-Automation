# FAQ & Troubleshooting

### `/admin` redirects too many times (ERR_TOO_MANY_REDIRECTS)
Fixed in current versions (the `/admin` → `/admin/` redirect no longer loops). Clear cookies and
hard-refresh; make sure you're on the latest build.

### "Login with Discord" keeps asking me to authorize ("read profile")
That's Discord's default consent screen. The app uses `prompt=none`, so **returning** players skip
it — the consent screen only appears the **first** time. If it still repeats, you're probably being
**logged out** between visits (see next item).

### I keep getting logged out of the Field Console
Sessions are stored in memory and are lost when the **manager app** restarts (not the game server).
Keep the app running, or ask for a persistent session store.

### Discord login button is missing / disabled
Set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_OAUTH_REDIRECT` in `.env` and make sure the
redirect URI **exactly** matches the one registered in the Discord Developer Portal. The login button
hides itself when OAuth isn't configured.

### My Stats says "no SCUM character linked"
You're logged in with Discord but haven't linked a character. Run `/link-account` in Discord and
follow the steps (see [Discord Bot](Discord-Bot)).

### A ban isn't taking effect
Bans are written to `BannedUsers.ini` and apply **after the next server restart**
(see [Player Management & Bans](Player-Management)).

### Leaderboards / kills / deaths are empty
On current SCUM saves the live combat stats are in `survival_stats`, not `events_stats`. The app
already sources kills/deaths from `survival_stats`. If a category is still empty, no player has a
non-zero value for it yet.

### Economy or stats look stale
Leaderboards use a 60 s snapshot; the overview is cached ~15 s; trader funds update only when a
player actually trades. This is by design to keep load off `SCUM.db`.

### Rate limited (HTTP 429)
The public/player API is rate-limited per IP. Behind a reverse proxy, set `web.trustProxy: true` so
each client is counted separately (otherwise everyone shares the proxy's IP).

### Server won't start / service issues
- Make sure `nssm.exe` is in the project root and the app runs **as administrator**.
- Check the application log: `data/SCUM-Server-Automation.log`.
- Verify `serverDir`, `serviceName` and launch args in **Settings**.

### Where are the logs and data?
`data/SCUM-Server-Automation.log` (app log), `data/server_database.db` (links, prefs, bans, raid
state), `data/weekly_leaderboards.db` (weekly snapshots). The SCUM game DB is opened **read-only**.

Still stuck? Ask on [Discord](https://playhub.cz/discord).
