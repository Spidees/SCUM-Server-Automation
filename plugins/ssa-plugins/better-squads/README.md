# Better Squads

Gives a squad its own layer of in-game chat: **squad-only alerts** when one of their people connects,
dies, gets a kill or has their base raided, and **in-game commands** players run themselves to see who
is online, where they are and how far away. Nobody outside the squad sees any of it.

## How it works
- Alerts go out through the **SSA Bridge** to **each squad member individually**, so a line only
  reaches the people it is meant for.
- **Squad membership and positions come from the running game** when the bridge can answer, and from
  the last save when it cannot. Each of the two reads has its own switch.
- **Reader-relative messages:** a line with `{distance}` or `{direction}` is written **once per
  recipient**, so each squadmate is told how far the event is from where *they* stand, for example
  *"340 m NE of you."*
- **Sectors and directions** use the same map calibration as the manager's live map, so they match
  what players see on their map.
- **Squad joins and leaves** are found by checking the roster on a timer, only for squads with someone
  online. A squad seen for the first time is only recorded, so a restart never floods anyone.
- **Volume is capped:** above a set number of recipients a reader-relative line is sent once to
  everyone, and a per-minute ceiling stops any burst. Each limit has its own switch.
- **Everything is logged:** every alert, command and admin action is a row in the Activity screen, with
  who it was for and how it ended.

## Requirements
- The **SSA Bridge** plugin, for targeted chat and the in-game commands.
- Two bridge modules are optional and recommended. The plugin's card on the **Plugins** page lists
  them and offers to switch them on:
  - **Live player data**: *Read live player data* and *Position, facing and speed*, so distances
    and directions use where squadmates are now.
  - **Live squads**: *Read live squads, and allow the changes below* and *Include the member list*,
    so alerts reach the squad as the game holds it now: a player who just left stops hearing it and
    one who just joined starts.
- `{sector}` and `{direction}` need the manager's map calibration, which it downloads from scumsa.
  Without it those tokens stay empty.
- Manager **6.0.0+**.

## Configuration
Everything is configured from the plugin's **admin tab** (👥 Better Squads). It has five screens, and
each has its own address, so a screen can be opened in a new tab:

- **Alerts**: nine switches, each with its own line in every player language: *Connected*,
  *Disconnected*, *Killed*, *Died*, *Died of a cause*, *Got a kill*, *Base raided*, *Joined squad*,
  *Left squad*. Click a token to insert it; dashed tokens are the reader-relative ones. *Got a kill*
  is off by default. *Deaths in game events* is off by default too, so a death inside a tournament is
  not announced.
- **Squads**: every squad in the save, who is online now and the squad's score, with search, filters,
  pages and ticks. Send a test line to one squad or to every ticked one, and mute or unmute the members
  of the ticked squads. Below it, **Silenced by players**: what players turned off for themselves in
  game, with a *Reset* per player or for every ticked one.
- **Commands**: switch the in-game commands on or off, rename the root command and every subcommand
  (each with its own switch), with a preview of what players type, and every reply players can read.
  Ships as `/squad` (the roster with sectors and distances) plus `help`, `here` (rally), `msg`,
  `base`, `info`, `off`, `on` and `mute`.
- **Activity**: what the plugin is doing right now (quiet hours, the per-minute ceiling, the roster
  check, which reads come from the running game) and the log, filtered by kind and result and
  searchable. *Send a test*, *Reset counters* and *Clear log* are here.
- **Settings**: the chat channel, *Also send to the player it is about*, each limit with its own
  switch (*Cooldown per player and event*, *Respect quiet hours*, *One shared copy for big squads*,
  *Ceiling on messages per minute*), the roster check interval, the two live game reads, and
  **Muted by an admin**: players who receive none of these messages and cannot undo it in game.

The plugin's own switch is beside *Save* on every screen.

## Good to know
- **Every player's language**: each message has a tab per language, and every player reads the one
  for the language they chose with `/lang` in game, on the Field Console or on Discord. An empty tab
  sends the default text. A message you have not changed goes out in the plugin's own translation.
- **Optional parts:** text inside `[ ]` disappears when a token in it is empty, so
  `{player} died[ in {sector}].` reads *"Petr died."* when the position is unknown.
- **Died** is a player's own death: the game's suicide, or their own mine or trap. A death at somebody
  else's hands, a player's, an NPC's or an animal's, is **Killed**.
- **Died of a cause** is a death with no killer: the cold, a fall, bleeding out, a trap. `{cause}` is
  empty when the game recorded no cause, so the line then reads *"Petr died in B3."*
- On friendly fire only the *Killed* line is sent, because it already names the killer.
- `/squad off` and `/squad mute` silence **alerts** only. Rallies and squad messages still arrive. An
  admin mute blocks those too.
- `/squad mute` takes event names (`join`, `leave`, `death`, `suicide`, `causeDeath`, `kill`, `raid`,
  `squadJoin`, `squadLeave`), `all` or `none`, and says which words it did not recognise.
- A `/squad msg` is limited to 200 characters and cannot insert tokens.
- A killer that is not a player is shown by name, for example *Guard (Lvl 5)*.
- If a player's name cannot be found, the alert about them is not sent.
- *Reached nobody* in the header counts alerts that were sent but delivered to no one. *Held back*
  counts the ones quiet hours, a cooldown or the ceiling kept from somebody who would have heard them.
- The squad score is the manager's own: choose what counts under *Settings → Leaderboards*.
- *Joined squad* and *Left squad* are read from the saved roster, so they arrive after the game saves.
  With the plugin switched off the roster check does not run and the command word is free.
- Players who are not in a squad generate no alerts. Quiet hours use the server's clock.
- Every setting can be written with the server stopped. Only the counters, the squad list and the log
  wait for a running game.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
