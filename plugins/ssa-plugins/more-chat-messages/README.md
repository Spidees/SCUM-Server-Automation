# More Chat Messages

Tell your players what is happening, **in the game's own chat**. Kills, players joining and leaving, cargo drops, secret and abandoned bunkers opening, and bases being raided — **each one switched on separately**, sent to **whichever chat channel you choose**, and **worded however you like**. Everything ships **off**, so your server says nothing new until you decide it should.

## How it works

- **Six announcements, six switches.** Kills, joins, leaves, cargo drops, secret bunkers, abandoned bunkers and raids are all independent — turn on the two you want and leave the rest silent.
- **You pick the channel.** Every announcement goes to **local, global, squad, admin or server**, chosen per announcement. A kill feed in global and raid alerts in admin is a perfectly ordinary setup.
- **You write the words.** Each message is a text box with **placeholders** — `{killer}`, `{victim}`, `{weapon}`, `{distance}`, `{name}`, `{sector}`, `{owner}` — listed under the box you are typing in.
- **Kills come from the manager's own kill feed**, so a weapon and an actor are named the way the game names them rather than as a blueprint class. A death the game could not attribute to anybody gets its **own wording**, and so does a suicide.
- **Cargo is asked for, not waited for.** A drop exists only in the running game, so the plugin **asks the SSA Bridge on a timer and announces the difference** — while it is still in the air, when it lands, and when it is gone.
- **Bunkers come from the server's own log**, so they need no bridge. The two kinds are separate switches because they are separate things: the **abandoned** ones open and lock on their own rota, and a **secret** one only ever opens because a player used a key card on it.

## Requirements

- The **SSA Bridge**, for the cargo announcements only. Kills, joins, leaves, bunkers and raids work without it.
- In the bridge's **World events** module: `enabled` and `cargo`. The plugin's card offers to switch them on for you.
- Manager **5.14.8** for the secret-bunker announcement. Everything else works from 5.13.0.
- Manager **5.13.0** or newer.

## Configuration

Everything is configured from the plugin's **admin tab** (💬 Chat Messages):

- Every setting can be written **with the server stopped** and goes live the moment it starts. Only the counters wait for a running game.
- Each card has the same three questions: **is it on**, **which chat**, and **what does it say**.
- The recent list shows what was actually said, and says when nobody was online to hear it.

## Good to know

- **Everything is off out of the box.** Installing this plugin changes nothing until you switch an announcement on.
- **Naming a raided base's owner is off on purpose.** On a PVP server, announcing whose base is being hit and where is a raid advertisement rather than news. Turn it on if your server wants it.
- **A bridge that is not answering is not an empty island.** If the cargo poll fails, the plugin says nothing rather than announcing every crate as gone — and the screen tells you which of the two it is.
- **A secret bunker has no position and no closing line.** The game gives it neither, so `{x}` and `{y}` stay empty in those two messages and the close is announced when its key card window runs out.
- **Nothing is announced from the first poll after a restart.** The plugin has to see the world twice before it can tell what changed, so it will not announce every open bunker as newly open when the server comes up.
- **Chat goes to whoever is online.** A message sent while the server is empty reaches nobody and is not resent.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
