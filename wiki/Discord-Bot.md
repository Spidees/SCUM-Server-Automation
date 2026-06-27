# Discord Bot

Optional but feature-rich: live embeds, log feeds, chat relay, account linking and per-player raid
DMs. Set `DISCORD_TOKEN` in `.env` and the bot starts automatically.

## Setup

1. [discord.com/developers/applications](https://discord.com/developers/applications) → **New
   Application** → **Bot** → copy the token into `.env` (`DISCORD_TOKEN`).
2. Enable **Message Content Intent** (needed for chat relay & account linking).
3. Invite with scopes `bot` + `applications.commands` and permissions: *Send Messages, Embed Links,
   Read Message History, Manage Messages*.
4. Put your **Guild ID** in `config/config.json` → `Discord.GuildId` (or via the wizard).

> The same Discord application can also power the public site's **Login with Discord** — that uses
> OAuth2 (Client ID/Secret + redirect URI), configured separately in `.env`. See
> [Public Field Console](Public-Field-Console).

## Slash commands

| Command | Who | Description |
|---|---|---|
| `/link-account` · `/unlink-account` | Anyone | Link / unlink your SCUM character |
| `/my-stats` | Linked | Your detailed SCUM stats, **skills & attributes** |
| `/player-stats <name>` · `/player-search <query>` | Anyone | Look up / search players (skills shown only to squadmates) |
| `/server-info` · `/player-online` | Anyone | Current status / online players |
| `/server-status` | Admin | Full live status embed |
| `/server-start` · `/server-stop [min]` · `/server-restart [min]` | Admin | Lifecycle (immediate → confirm button, or delayed with warnings) |
| `/server-update [min]` | Admin | Apply Steam update |
| `/server-backup` · `/server-validate` | Admin | Manual backup / file validation |
| `/server-cancel` · `/server-restart-skip` | Admin | Cancel pending action / skip next scheduled restart |
| `/bot-status` | Admin | Bot uptime, DB status, linked accounts |

Admin commands are restricted to roles in `Discord.SlashCommands.AdminRoles`.

## Account linking & raid alerts

1. `/link-account` → receive a private 6-character code (valid 15 min).
2. Join the server and type `connect:XXXXXX` in chat (hidden from the chat relay).
3. The bot confirms via DM.

From the persistent **linking panel** (post it from the dashboard's *Discord* screen), players use
the **⚙️ Notifications** button to choose what to be DM'd about — *Raid / Base, Vehicles, Chests,
Locks* — and the scope (*my stuff only* or *my squad too*). The same preferences and a **history of
sent alerts** are also editable on the Field Console **My Stats** tab.

## Live embeds

Configured under `Discord.LiveEmbeds` (channel + interval + optional image each):

| Embed | Channel key |
|---|---|
| Server status | `StatusChannel` |
| Online players | `PlayersChannel` |
| Abandoned bunkers (open/locked + timers + map links) | `BunkerChannel` |
| Leaderboards (weekly + all-time) | `LeaderboardsChannel` |

When `web.publicUrl` is set, the status / leaderboards / economy / bunker embeds include a link to
the public Field Console.

## Log feeds

Each feed tails its SCUM log every `SCUMLogFeatures.UpdateInterval` seconds and posts a clean embed
with optional **map links** (scum-map.com). Enable feeds and set channel IDs under `SCUMLogFeatures`:

Kill · Login · Admin · Chest · Economy · Event-kill · Fame · Gameplay · Quest · Raid-protection ·
Vehicle · Violations · Base-building-destruction.

The **Kill feed** supports a delay queue so dying players can't immediately see who killed them.
Vehicle / chest / gameplay / base-building feeds always parse the log so **player DM alerts work even
when their public channel is off**.

Next: [Player Management & Bans](Player-Management)
