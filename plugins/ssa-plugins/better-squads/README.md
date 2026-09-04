# Better Squads

Gives a squad its own layer of in-game chat. **Squad-only alerts** when one of their people connects,
dies, gets a kill or has their base raided — plus a **command set players run themselves** to see who
is online, where they are and how far away. Nobody outside the squad ever sees a word of it.

## How it works
- Alerts go out through the **SSA Bridge**, addressed to **individual recipients**. The bridge walks the
  live players and asks each one for its own Steam ID, so a line can only reach the people named — that
  targeting is what makes "squad-only" real rather than cosmetic.
- **Who is in the squad is asked of the running game**, and only falls back to the game database when
  it cannot answer. The database is the state as of the last **save**, so a player who joined a squad
  minutes ago is not in it yet and one who left is still in it — and membership is exactly what decides
  who hears a line nobody outside the squad is meant to. Identity stays a database lookup and has to:
  the game's own squad record holds a profile id and never a Steam ID.
- **How far away an event is comes from the running game too.** `{distance}` and `{direction}` tell a
  player which way to walk, and a saved position can predate the fight they are being told about. Live
  and saved are merged **per player**, so a squadmate the game has no answer for (still on the loading
  screen) keeps their saved position rather than losing the distance altogether.
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
- Manager **5.13.0+**. That is what the manifest enforces, so it is what the panel will let you enable.
- **Two in-game modules are optional but change what the numbers mean.** Both are off until you turn
  them on, in **Settings → Bridge**:
  - **Read live player data** with **Position, facing and speed** (Live data) — makes `{distance}` and
    `{direction}` where a squadmate is *now* instead of at the last save.
  - **Report live squads** with **Include the member list** (Squads) — makes the roster the one the
    game holds, so a joiner is included and a leaver is not, without waiting for a save.
  With either off the plugin works exactly as it always has and **says so on its own tab**, in the
  module's own words. It never quietly falls back.
- `{sector}` and `{direction}` need the manager's **map calibration**, which is fetched from scumsa
  rather than built in. Without it those tokens render empty — nothing is drawn in an invented place
  — and the panel's status strip says so.

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
- **The in-game commands always answer.** A typo in a mute list (`mute kils`) says which words it
  did not recognise instead of quietly doing nothing, and a rally or squad message that could not be
  delivered says so rather than leaving the player looking at a command that appeared to be ignored.
- **"Reached nobody" is its own number.** *Suppressed* means the plugin chose not to send — quiet
  hours, a cooldown, the rate limit. *Reached nobody* means it tried and the squad got nothing, which
  is a different problem needing a different fix. Counting them together would make the panel
  disagree with what players saw.
- **The "Silenced by players" list includes people who are offline.** A player silences their alerts
  in game and the setting keeps working while they are away — so listing only who was online meant
  the one person most likely to ask you to undo it, from Discord, was the one you could not see.
- **`{killer}` names what killed them, not its class.** A kill by anything that is not a player
  carries a spawn class with its instance number attached — `BP_Guard_Lvl_5_C_2146943462`. The squad
  reads *Guard (Lvl 5)* instead, through the same name rule the manager's own kill feed uses. A **player** name is deliberately left alone by that rule wherever it appears, so
  somebody who calls themselves `Wolf_C_12` is still called that on every line. Needs manager **5.2**;
  older ones print what they always did.
- Players not in a squad generate nothing — there is nobody to tell.
- On friendly fire only the *killed* line is sent: it already names the killer, so the *got a kill* line
  would be the same event told twice to the same people.
- `/squad off` and `/squad mute` are the player's own switches and silence **alerts**, not their
  squadmates talking — a rally or a squad message still reaches them. An admin mute blocks everything.
- A player's `/squad msg` is stripped of braces and control characters and capped at 200 characters, so
  one player cannot push tokens or layout into another player's chat.
- SCUM reuses squad IDs after a disband, so a roster whose squad **name** changed is treated as a new
  group and re-baselined instead of announcing a burst of joins and leaves that never happened.
- **Someone who leaves a squad stops receiving its messages immediately** — with *Report live squads*
  on. Without it "immediately" means the next game save, because the database is where the roster then
  comes from, and until then they keep hearing everything their old squad is told.
- The status header shows, live: how many players are online, how many squads have 2+ members online
  (i.e. how many could actually receive anything), and how much has been sent or suppressed.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
