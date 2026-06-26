# Public Field Console (`/`)

The community-facing site. **Overview is public**; every other tab is gated behind
**Login with Discord**.

> 🌐 **See it live:** **[scum.playhub.cz](https://scum.playhub.cz/)** (the author's own server).

![Field Console — overview](http://playhub.cz/scum/manager/field_console_overview.png)

## Tabs

| Tab | Access | Content |
|---|---|---|
| **Overview** | Public | Server card (name, connect address, FPS, status), next restart, in-game time/weather, total players, active squads, top squads |
| **Leaderboards** | Login | All categories, all-time & weekly, live name filter; **click a player → their stats** |
| **Squads** | Login | Squad list (name / members / score); click → squad detail (members + ranks) |
| **My Stats** | Login + linked | Full character sheet (Combat / Survival), leaderboard ranks, your squad (members, online, last-seen), **DM-alert settings + sent history** |
| **Bunkers** | Login | Abandoned-bunker status (active / locked + timers) |
| **Economy** | Login | Special deals, trader funds per outpost, gold capacity, stock rotation — mirrors the Discord economy embed |
| **Kill Feed** | Login | Recent kills (killer → victim, weapon, distance) |
| **Events** | Login | Event ranking board (from `event_rankings_cached`); empty until an event runs |

Player names are clickable wherever they appear (leaderboards, squad rosters, My Stats) and open
that player's profile in a modal. Profiles never expose Steam IDs, IPs, or per-member online/last-seen.

![Field Console — leaderboards](http://playhub.cz/scum/manager/field_console_leaderboards.png)
![Field Console — my stats](http://playhub.cz/scum/manager/field_console_mystats.png)
![Field Console — economy](http://playhub.cz/scum/manager/field_console_economy.png)

## Login with Discord (OAuth2)

Set up an OAuth2 app and fill `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_OAUTH_REDIRECT`
in `.env` (see [Configuration](Configuration)). Then:

1. Discord Developer Portal → your application → **OAuth2** → add the redirect URI exactly equal to
   `DISCORD_OAUTH_REDIRECT`, e.g. `https://your-domain/api/auth/discord/callback`.
2. Copy the **Client ID** and create a **Client Secret** into `.env`.
3. Restart. The **Login with Discord** button appears; without these values it stays disabled.

Returning players are logged in **without the consent screen** (the app uses `prompt=none` and only
falls back to the consent screen the first time). The scope requested is just `identify`.

### Linking a SCUM character

Discord login identifies the user; to see **My Stats** they must also link a SCUM character.
**You can link right from the web** — the My Stats tab shows a *Link my SCUM account* button that
gives you a `connect:XXXXXX` code to type in the in-game chat; the page links you automatically once
you do (it polls and reloads). The Discord `/link-account` command does the same thing. Logged-in-
but-unlinked users can still browse the other tabs.

## Linking from the Discord embeds

If `web.publicUrl` is set, the live **server status / leaderboards / economy / bunker** embeds and
the **account-linking panel** include a button/field linking to the Field Console.

## Performance & privacy

- Leaderboards are served from an in-memory **snapshot** (rebuilt lazily, max once per 60 s) — viewing
  never hammers `SCUM.db`.
- The overview is cached ~15 s; squad/player lookups are memoized.
- Public APIs are rate-limited per IP. Profiles omit raid-sensitive data (no member online times).

Next: [Exposing to the Internet](Exposing-to-the-Internet)
