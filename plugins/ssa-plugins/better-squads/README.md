# Better Squads

Gives a squad its own layer of in-game chat. **Squad-only alerts** when one of their people connects,
dies, gets a kill or has their base raided — plus a **command set players run themselves** to see who
is online, where they are and how far away. Nobody outside the squad ever sees a word of it.

## How it works
- Alerts go out through the **SSA Bridge**, addressed to **individual recipients**. The bridge walks the
  live players and asks each one for its own Steam ID, so a line can only reach the people named — that
  targeting is what makes "squad-only" real rather than cosmetic.
- Squad membership is read from the **game database**, so it is always the real roster.
- **Reader-relative messages.** A line containing `{distance}` or `{direction}` is rendered **once per
  recipient**, so every squadmate is told how far the event is from where *they* are standing:
  *"Petr was killed by Raven in B3 — AK, 84 m. 340 m NE of you."*
- **Sectors and bearings** use the manager's own map calibration — the same one the live map draws with
  — so they match what the player is looking at. Without calibration they render empty rather than
  pointing somewhere invented.
- **Names come from the database.** The bridge cannot name a player who has already disconnected (its
  leave event carries an empty name), so the name is resolved from the database instead. If nobody can
  name them, **nothing is sent** — a 17-digit Steam ID in front of the whole squad is worse than silence.
- **Squad joins and leaves** have no game event, so the roster is diffed on a timer, only for squads
  that have somebody online. A squad seen for the first time becomes a silent baseline, so a restart
  never floods anyone.
- **Volume is capped.** Past a threshold a reader-relative message is sent once to everyone instead of
  one copy each, and a per-minute ceiling protects a live server from any burst.
- **Join/leave use the bridge's live player events**, which fire the moment a player is actually in
  game — the log-derived equivalent can be many seconds late, because SCUM writes its log in batches.

## Requirements
- The **SSA Bridge** plugin (for targeted chat and `/command` interception). It's a dependency.
- Manager **4.0.0+**. `{sector}` and `{direction}` additionally need a manager build that exposes the
  map calibration; on an older one those tokens render empty and the panel's status strip says so.

## Configuration
Everything is configured from the plugin's **admin tab** (👥 Better Squads):

- **Events** — eight independent switches, each with its own message template: *connected*,
  *disconnected*, *killed*, *died*, *got a kill*, *base raided*, *joined squad*, *left squad*. Clicking
  a token inserts it at the cursor; amber tokens are the reader-relative ones. Emptying a message
  silences that event without turning it off.
- **Optional parts** — anything inside `[ ]` disappears when a token in it has no value, so
  `{player} died[ in {sector}].` reads *"Petr died in B3."* normally and *"Petr died."* when the
  position is unknown. Every shipped default uses it.
- **Delivery** — which chat channel the lines appear in (recipients are always the squad regardless), a
  per-player per-event **cooldown**, the **roster check interval**, **quiet hours**, whether the subject
  also gets their own alert, the **per-reader limit** and the **messages-per-minute ceiling**.
- **In-game commands** — the root command and every subcommand can be renamed, with a live preview of
  exactly what players will type. Ships as `/squad` (roster with sectors and distances), plus `help`,
  `here` (rally), `msg`, `base`, `info`, `off` / `on` and `mute <events>`.
- **Command replies** — every player-facing line, grouped by area, in any language.
- **Silenced by players** — what squad members turned off for themselves in game, with a reset button
  for when someone asks.
- **Muted by an admin** — players who receive nothing and cannot undo it in game. Kept separate from the
  players' own preferences so neither side overwrites the other.
- **Activity** — a live feed of every message delivered, plus **Send a test**, which delivers a real
  message to a real squad so the whole chain can be confirmed without waiting for someone to die.

## Good to know
- Players not in a squad generate nothing — there is nobody to tell.
- On friendly fire only the *killed* line is sent: it already names the killer, so the *got a kill* line
  would be the same event told twice to the same people.
- `/squad off` and `/squad mute` are the player's own switches and silence **alerts**, not their
  squadmates talking — a rally or a squad message still reaches them. An admin mute blocks everything.
- A player's `/squad msg` is stripped of braces and control characters and capped at 200 characters, so
  one player cannot push tokens or layout into another player's chat.
- SCUM reuses squad IDs after a disband, so a roster whose squad **name** changed is treated as a new
  group and re-baselined instead of announcing a burst of joins and leaves that never happened.
- Someone who leaves a squad stops receiving its messages immediately.
- The status header shows, live: how many players are online, how many squads have 2+ members online
  (i.e. how many could actually receive anything), and how much has been sent or suppressed.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
