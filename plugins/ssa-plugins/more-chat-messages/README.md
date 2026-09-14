# More Chat Messages

Tells your players what is happening **in the game's own chat**: kills, players joining and leaving,
cargo drops, game events, secret and abandoned bunkers, and bases being raided. **Each announcement is
its own switch**, goes to **the chat channel you choose** and is **worded however you like**.
Everything ships **off**, so your server says nothing new until you turn something on.

## How it works
- **Every announcement is independent.** Turn on the ones you want and leave the rest silent.
- **You pick the channel** per announcement: local, global, squad, admin or server.
- **You write the words.** Each message box lists the **placeholders** it can use, such as `{killer}`,
  `{victim}`, `{weapon}`, `{distance}`, `{name}`, `{sector}` or `{owner}`. Click one to insert it.
- **Kills, joins, leaves and raids** are announced as soon as the manager reads them from the server
  log. Kill lines name weapons and creatures the way the game does, and a suicide has its own message.
- **Bunkers** come from the server log too, so they need no bridge. **Abandoned** bunkers open and lock
  on their own schedule; a **secret** bunker opens when a player uses a key card on it.
- **Cargo drops and game events** exist only in the running game, so the plugin **asks the SSA Bridge**
  on a timer and announces what changed. A cargo drop can be announced on the way down, when it lands
  and when it is gone. A game event can be announced when sign-ups open, for each person who signs up,
  when the sign-up count changes, when it starts and when it ends.
- **Chat history is optional.** SCUM does not record what a plugin says in chat, so each announcement
  can also be kept in the admin chat view, the Field Console and your Discord chat channel.

## Requirements
- The **SSA Bridge** plugin, for cargo drops and game events. Kills, joins, leaves, bunkers and raids
  work without it.
- In the bridge's **Live world events** module: *Report world events*, *Cargo drops* and
  *Deathmatch, CTF, drop zone*. The plugin's card on the **Plugins** page lists them and offers to
  switch them on. *Who is in the event* is optional and puts a name on each sign-up.
- Manager **5.16.2+**.

## Configuration
Everything is configured from the plugin's **admin tab** (💬 Chat Messages):

- **Right now**: how many announcements are on, and how many lines were sent, failed and skipped since
  the manager started.
- **One card per announcement**: Kills, Players joining, Players leaving, Cargo drops, Game events,
  Secret bunkers, Abandoned bunkers and Bases being raided. Each card has its on/off switch, the
  **Chat channel**, **Keep it in the chat history** and its messages.
- **Kills**: **Say nothing under this many metres** skips short-range kills (0 announces every kill).
- **Bases being raided**: **Name the base owner** switches to a message that names whose base it is.
- **Ask every … seconds** on the cargo, event and bunker cards, and a **Shared interval** (default 30)
  used by any card set to 0.
- **What it has said**: the last sixty lines, newest first, with the ones that reached nobody marked.

## Good to know
- **Naming the raided base's owner is off by default.** On a PvP server it tells everyone whose base is
  being hit.
- **Cargo drops and game events never ask faster than every 30 seconds**, because each ask makes the
  game look through the whole world. Bunkers cost the game nothing.
- **Nothing is announced from the first reading after a restart.** The plugin has to see the world
  twice before it can tell what changed.
- **Cargo drops and game events are not checked while nobody is online**, unless that card keeps its
  lines in the chat history.
- **A bridge that does not answer is not an empty island.** The plugin then announces nothing, instead
  of reporting every cargo drop as gone.
- **Kill lines have no sector**, and secret bunker lines have only `{sector}`, because the game gives
  no position for them.
- When the game writes a placeholder such as *Unknown* as the killer, the ordinary kill message is used.
- Chat goes to whoever is online. A line sent to an empty server is not resent.
- Everything can be configured with the server stopped; only the counters need it running.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
