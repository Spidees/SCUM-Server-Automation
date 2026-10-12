# More Chat Messages

Tells your players what is happening **in the game's own chat**: kills, players joining and leaving,
cargo drops, game events, secret and abandoned bunkers, and bases being raided. **Each announcement is
its own switch**, shows in **the chat colour you choose** and is **worded however you like**.
Everything ships **off**, so your server says nothing new until you turn something on.

## How it works
- **Every announcement is independent.** Turn on the ones you want and leave the rest silent.
- **You pick the channel** per announcement: local, global, squad, admin or server. It sets the
  **colour** of the line; every player online sees it either way.
- **You write the words.** Each message box lists the **placeholders** it can use, such as `{killer}`,
  `{victim}`, `{weapon}`, `{distance}`, `{name}`, `{sector}` or `{owner}`. Click one to insert it.
- **Kills, joins, leaves and raids** are announced as soon as the manager reads them from the server
  log. A kill by a player, a kill by an NPC, animal, puppet or sentry, a death with a cause such as a
  fall or the cold, and a suicide each have their own message, in the kinds the manager's kill feed uses.
- **A raid is a base taking damage.** Raid protection switching on or off, a picked lock, a looted
  chest or a sold vehicle is never announced, though the manager tells the owner about all of them.
- **Bunkers** come from the server log too, so they need no bridge. **Abandoned** bunkers open and lock
  on their own schedule; a **secret** bunker opens when a player uses a key card on it.
- **Cargo drops and game events** exist only in the running game, so the plugin **asks the SSA Bridge
  every 5 seconds** and announces what changed. Bunkers are checked just as often. A cargo drop can be announced on the way down, when it lands
  and when it is gone. A game event can be announced when sign-ups open, for each person who signs up,
  when the sign-up count changes, when it starts and when it ends.
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
Everything is configured from the plugin's **admin tab** (💬 Chat Messages):

- **Right now**: how many announcements are on, and how many lines were sent, failed and skipped since
  the manager started.
- **One card per announcement**: Kills, Players joining, Players leaving, Cargo drops, Game events,
  Secret bunkers, Abandoned bunkers and Bases being raided. Each card has its on/off switch, the
  **Chat channel**, **Keep it in the chat history** and its messages.
- **Kills**: **Say nothing under this many metres** skips short-range kills (0 announces every kill).
  Each kind of death is switched on its own; **A death inside a game event** ships off, as in the manager's feed.
- **Bases being raided**: **Name the base owner** switches to a message that names whose base it is.
- **What it has said**: the last sixty lines, newest first, with the ones that reached nobody marked.
- **Every player's language**: each message has a tab per language, and every player reads the
  one for the language they chose with `/lang` in game, on the Field Console or on Discord. An
  empty tab sends the default text.

## Good to know
- **Naming the raided base's owner is off by default.** On a PvP server it tells everyone whose base is
  being hit.
- **There is no timing to set.** One check of cargo and events costs the bridge a few milliseconds.
- **What is already happening when the manager starts is not announced.** An event already open or
  running, a crate already down, or an abandoned bunker already active when the game first lists
  them, stays quiet; the next change is announced.
- **Each of the 25 event locations is watched on its own**, so the first event of a session is
  announced wherever it is held.
- **While nobody is online** the plugin takes one first reading and then waits for a player, unless
  that card keeps its lines in the chat history.
- **Lines on any channel reach the chat history** when it is on, because every player saw them.
- **Each cargo drop gets each line once, in order**: on its way, landed, gone. It never goes back from
  landed to falling.
- **A cargo drop is gone when it blows up**, or after about 20 seconds without it in the bridge's
  answer. One missed answer says nothing.
- **A bridge that does not answer is not an empty island.** The plugin then announces nothing, instead
  of reporting every cargo drop as gone.
- **Kill lines have no sector** (a suicide or a death with a cause does have one), because the kill event the manager hands to plugins carries no
  position. **Secret bunker lines have only `{sector}`**, because the log line for a key card opening
  gives no position.
- When the game writes a placeholder such as *Unknown* as the killer, the ordinary kill message is used.
- Chat goes to whoever is online. A line sent to an empty server is not resent.
- Everything can be configured with the server stopped; only the counters need it running.
- **A new install already speaks every player's language.** A message you have not changed goes out
  in the plugin's own translation; once you edit it, players read your wording. On a manager without
  per-language chat, everyone gets the one text.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
