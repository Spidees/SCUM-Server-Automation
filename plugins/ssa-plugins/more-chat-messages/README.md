# More Chat Messages

Tells your players what is happening **in the game's own chat**: kills, players joining and leaving,
cargo drops, game events, secret and abandoned bunkers, and bases being raided. **Every announcement
and every moment inside it has its own switch**, shows in **the chat colour you choose** and is
**worded however you like, in every player's language**. Everything ships **off**, so your server says
nothing new until you turn something on.

## How it works
- **Eight announcements, twenty-two moments.** Kills alone has six (a player kill, an NPC kill, a death
  with a cause, a death with nothing named, a suicide, a death inside a game event). Turn on the
  announcement, then pick the moments you want.
- **You pick the channel** per announcement: local, global, squad, admin or server. It sets the
  **colour** of the line; every player online sees it either way.
- **You write the words.** Each message lists the **placeholders** it can use, such as `{killer}`,
  `{victim}`, `{weapon}`, `{distance}`, `{name}`, `{sector}` or `{owner}`. Click one to insert it.
- **Kills, joins, leaves and raids** are announced as soon as the manager reads them from the server
  log, in the kinds the manager's kill feed uses.
- **A raid is a base taking damage.** Raid protection switching on or off, a picked lock, a looted
  chest or a sold vehicle is never announced, though the manager tells the owner about all of them.
- **Bunkers** come from the server log too, so they need no bridge. **Abandoned** bunkers open and lock
  on their own schedule; a **secret** bunker opens when a player uses a key card on it.
- **Cargo drops and game events** exist only in the running game, so the plugin **asks the SSA Bridge
  every 5 seconds** and announces what changed. A cargo drop can be announced on the way down, when it
  lands and when it is gone. A game event can be announced when sign-ups open, for each person who
  signs up, when the sign-up count changes, when it starts and when it ends.
- **Every line is accounted for.** The Activity screen lists what was said, on which channel and to how
  many players, and every line that was **not** said with the reason: switched off, under the minimum
  distance, an empty message, a player the game gave no name.
- **Chat history is optional.** SCUM does not record what a plugin says in chat, so each announcement
  can also be kept in the admin chat view, the Field Console and your Discord chat channel.

## Requirements
- The **SSA Bridge** plugin, for cargo drops and game events. Kills, joins, leaves, bunkers and raids
  work without it.
- In the bridge's **Live world events** module: *Report world events*, *Cargo drops* and
  *Deathmatch, CTF, drop zone*. The plugin's card on the **Plugins** page lists them and offers to
  switch them on. Each sign-up is named from the bridge's *Event players and deaths* switch, which
  is on by default from SSA Bridge 2.41.0; an older bridge needs *Who is in the event* for the names.
- Manager **6.0.0+**.

## Configuration
Everything is configured from the plugin's **admin tab** (💬 Chat Messages), on four screens:

- **Announcements**: the eight announcements, each with its on/off switch, and under each one every
  moment it can announce with its own switch and the words it will say. Search, a filter (on, off,
  needing the bridge, kept in the chat history), ticks and **Switch on / Switch off** for the ticked
  ones.
- **Messages**: every line players read, one editor each with **a tab per language** and its switch
  beside it. Search, filter by announcement or by state (said, not said, your own words) and pages.
  Every player reads the language they chose with `/lang` in game, on the Field Console or on
  Discord; an empty tab sends the built-in line.
- **Activity**: what the plugin is following right now (cargo drops in the air or landed, events with
  sign-ups, open bunkers) and when it looks again, then every line said and not said, with a filter.
- **Settings**: the **master switch** that pauses everything and keeps every choice, the chat channel
  and chat history of each announcement (with one control to set every channel at once), and the
  kill distance under which nothing is said.

A header above the screens counts the announcements that are on, the lines sent, failed and not said,
and says when the server is stopped.

## Good to know
- **Naming the raided base's owner is off by default.** On a PvP server it tells everyone whose base is
  being hit.
- **There is no timing to set.** One check of cargo and events costs the bridge a few milliseconds.
- **What is already happening is not announced.** An event already open or running, a crate already
  down, or an abandoned bunker already active when the manager starts, or when you switch that
  announcement back on, stays quiet; the next change is announced.
- **Each of the 25 event locations is watched on its own**, so the first event of a session is
  announced wherever it is held.
- **While nobody is online** the plugin takes one first reading and then waits for a player, unless
  that announcement keeps its lines in the chat history.
- **Each cargo drop gets each line once, in order**: on its way, landed, gone. A drop is gone when it
  blows up, or after about 20 seconds without it in the bridge's answer.
- **A bridge that does not answer is not an empty island.** The plugin then announces nothing, instead
  of reporting every cargo drop as gone.
- **Kill lines have no sector** (a suicide or a death with a cause does have one), because the kill
  event the manager hands to plugins carries no position. **Secret bunker lines have only
  `{sector}`**, because the log line for a key card opening gives no position.
- **The activity log keeps the last 200 lines** and clears when the manager restarts.
- Everything can be configured with the server stopped; only the counters and the activity need it
  running.
- **A new install already speaks every player's language.** A message you have not changed goes out
  in the plugin's own translation; once you edit it, players read your wording.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
