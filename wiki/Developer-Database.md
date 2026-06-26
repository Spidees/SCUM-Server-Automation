# Developer — Database & Caching

Three SQLite databases (via `better-sqlite3`), plus in-memory caches.

## Databases

| DB | Mode | Where | What |
|---|---|---|---|
| **SCUM.db** | **read-only** | `…/SCUM/Saved/SaveFiles/SCUM.db` | The game's own DB — players, stats, squads, economy, etc. |
| **server_database.db** | read-write | `data/` | App data: linked accounts, notification prefs, raid-protection state, **ban metadata**, **notification log** |
| **weekly_leaderboards.db** | read-write | `data/` | Weekly leaderboard snapshots (deltas) |

`database/db.js` opens `SCUM.db` `{ readonly: true }` and re-opens if the path changes; it also
applies query rewrites:

- `excludeDeletedProfiles(sql)` — hides `user_profiles_marked_for_deletion` (dead characters).
- `excludeDeletedAndAdmins(sql)` — also hides admins (for leaderboards). Used by `leaderboardDefs`.

## Important data-source note

On current SCUM saves, **`events_stats` is empty** (Events-mode table); real combat stats live in
**`survival_stats`** (`kills`, `deaths`, `prisoner_kills`, `deaths_by_prisoners`, `headshots`, …).
`playerStats.PLAYER_STATS_SELECT`, `leaderboardDefs` (kills/deaths/kdr + PvP categories) and the
weekly snapshot all source from `survival_stats`. Keep this in mind when adding stat queries.

> Inspect the live DB without installing deps:
> `node --experimental-sqlite -e "const {DatabaseSync}=require('node:sqlite'); …"` (read-only).

## Caching strategy (keep load off SCUM.db)

| Layer | TTL | Notes |
|---|---|---|
| `database/cache.js` `memo(key, ttl, fn)` | per-call | Generic memoization for hot read queries |
| `leaderboards.js` | 60 s | Each category's computed rows |
| `leaderboardSnapshot.js` | 60 s, **lazy** | Full snapshot of all categories; rebuilt on access only when stale — **zero DB load while idle** |
| `/api/public/overview` | ~15 s | Combined status+counts+world, one rebuild per TTL |
| `getPlayerStatsBySteamId` / `ByName` | 15 s | Multi-join stat sheet |
| `getSquadInfoBySteamId` | 15 s | Own squad + members |
| `getSquadList` / `getSquadDetailById` | 30 s | Public squad list/detail |
| economy (`getSpecialDeals`, `getGoldCapacity`, `getEconomyTiming`) | 30 s | — |
| `getOnlinePlayers` / `getPlayerCounts` | 5 s | — |

In-memory (no DB): `getPlayerRanks` (scans the snapshot), `bunkerState`, `recentKills`,
`economyState` (trader funds from the log).

Caches are cleared when the `SCUM.db` connection is (re)opened.

## server_database.db tables (created on first use)

`a_user_profile`, `a_raid_protection`, `a_pending_registrations`, `a_discord_profiles`,
`a_notification_prefs`, `a_banned_players` (ban name/note/time), `a_notification_log`
(capped 100/user — the player's DM history).

## Adding a query

1. Put read queries against `SCUM.db` in `database/playerStats.js` (or a sibling), wrapped in `memo`
   with a sensible TTL, and use `excludeDeletedProfiles` where appropriate.
2. Never expose Steam IDs / IPs on public/player endpoints unless it's the caller's own data.
3. Validate any `:param` that reaches a query.

Next: [Contributing](Developer-Contributing)
