# Better Squads

Gives a squad its own layer of in-game chat: **squad-only alerts** when one of their people connects,
dies, gets a kill or has their base raided, and **in-game commands** players run themselves to see who
is online, where they are and how far away. Nobody outside the squad sees any of it.

## How it works
- Alerts go out through the **SSA Bridge** to **each squad member individually**, so a line only
  reaches the people it is meant for.
- **Squad membership and positions come from the running game** when the bridge can answer, and from
  the last save when it cannot.
- **Reader-relative messages:** a line with `{distance}` or `{direction}` is written **once per
  recipient**, so each squadmate is told how far the event is from where *they* stand, for example
  *"340 m NE of you."*
- **Sectors and directions** use the same map calibration as the manager's live map, so they match
  what players see on their map.
- **Squad joins and leaves** are found by checking the roster on a timer, only for squads with someone
  online. A squad seen for the first time is only recorded, so a restart never floods anyone.
- **Volume is capped:** above a set number of recipients a reader-relative line is sent once to
  everyone, and a per-minute ceiling stops any burst.

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
- Manager **5.16.2+**.

## Configuration
Everything is configured from the plugin's **admin tab** (👥 Better Squads):

- **Events**: eight switches, each with its own message: *Connected*, *Disconnected*, *Killed*,
  *Died*, *Got a kill*, *Base raided*, *Joined squad*, *Left squad*. Click a token to insert it; amber
  tokens are the reader-relative ones. *Got a kill* is off by default.
- **Optional parts:** text inside `[ ]` disappears when a token in it is empty, so
  `{player} died[ in {sector}].` reads *"Petr died."* when the position is unknown.
- **Delivery**: *Chat channel* (the recipients are always the squad), *Cooldown (seconds)* per player
  and event, *Roster check (seconds)*, *Quiet hours from* / *to* with *Respect quiet hours*,
  *Per-reader limit*, *Messages per minute* and *Also send to the player it is about*.
- **In-game commands**: rename the root command and every subcommand, with a preview of what players
  type. Ships as `/squad` (the roster with sectors and distances) plus `help`, `here` (rally), `msg`,
  `base`, `info`, `off`, `on` and `mute`.
- **Command replies**: every line players can see, in any language.
- **Silenced by players**: what players turned off for themselves in game, with a *Reset* per player.
- **Muted by an admin**: players who receive none of these messages and cannot undo it in game.
- **Activity**: the messages delivered, plus **Send a test**, which sends a real line to a chosen
  player's squad.

## Good to know
- **Died** is a death with no killer. A death with a killer is **Killed**.
- On friendly fire only the *Killed* line is sent, because it already names the killer.
- `/squad off` and `/squad mute` silence **alerts** only. Rallies and squad messages still arrive. An
  admin mute blocks those too.
- `/squad mute` takes event names (`join`, `leave`, `death`, `suicide`, `kill`, `raid`, `squadJoin`,
  `squadLeave`), `all` or `none`, and says which words it did not recognise.
- A `/squad msg` is limited to 200 characters and cannot insert tokens.
- A killer that is not a player is shown by name, for example *Guard (Lvl 5)*.
- If a player's name cannot be found, the alert about them is not sent.
- *Reached nobody* in the header counts alerts that were sent but delivered to no one. *Suppressed*
  counts the ones held back by quiet hours, a cooldown or the rate limit.
- *Joined squad* and *Left squad* are read from the saved roster, so they arrive after the game saves.
- Players who are not in a squad generate no alerts.
- Quiet hours use the server's clock.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
