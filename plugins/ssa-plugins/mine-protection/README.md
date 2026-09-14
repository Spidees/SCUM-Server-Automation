# Mine Protection

Punishes players who **arm a mine or trap outside their own or their squad's flag area**. The first
offences earn a chat **warning**; after that the placer is **teleported onto their own armed mine**.

## How it works
- Every few seconds the plugin reads the manager's **world scan** for placed, **armed** mines and traps
  of the watched types, and **who armed each one**.
- A mine is legal when it sits inside the **flag area of any base owned by the placer or a squadmate**.
  A squad member arming inside a teammate's base is never punished.
- **Before a teleport, the running game is asked** whether the mine is still armed and who is in the
  placer's squad right now. A mine defused since the last save, or a squadmate who joined since then,
  calls the punishment off. These checks can only cancel an offence, never create one.
- **Escalation:** the first offences per player are a warning, then the teleport. The teleport runs
  through the placer, so it does not depend on name or Steam ID targeting.
- **It never punishes on a guess.** When the game database cannot say whether a mine is inside a flag,
  the mine is left alone and checked again on the next scan.
- **Offline placers** are dealt with the moment they reconnect.
- **State survives restarts:** handled mines, offence counts and the action history are saved, so a
  restart never punishes the same mine twice. Mines that were already placed when the plugin first
  ran are never punished.

## Requirements
- The **SSA Bridge** plugin, for the teleport and the chat message.
- Two bridge modules are optional and recommended, because they let the plugin check the running game
  instead of the last save. The plugin's card on the **Plugins** page lists them and offers to switch
  them on:
  - **Live inventories**: *Read live inventories*, which confirms a mine is still armed.
  - **Live squads**: *Read live squads, and allow the changes below* and *Include the member list*,
    which confirm the placer's current squad.
- Manager **5.16.2+**.

## Configuration
Everything is configured from the plugin's **admin tab** (🛡️ Mine Protection):

- **Watched mines & traps**: a picker with an icon per type and how many are placed and armed right
  now. Quick buttons: *Explosives only*, *Select all*, *Clear*. Explosives are watched by default;
  C4 is not, because it is a raiding tool.
- **When a violation is found**: teleport onto their mine, or warn only.
- **Warnings before action**: how many warnings a player gets first (default 1, 0 acts at once).
- **Extra margin around flag (m)**: tolerance beyond the flag area (default 0).
- **Scan interval (s)**: how often to scan (default 6). Applies as soon as you save.
- **Only act while the placer is online** (on by default).
- **In-game messages**: the chat channel, the warning message and the penalty message.
- **Exemptions**: players who are never punished. Type a Steam ID or pick an online player.
- **Placed mines (live)**: every watched mine on the server, who armed it, where, and its status.
- **Recent actions**: every warning and teleport, with *Reset warnings* and *Clear history*.

## Good to know
- **Forgive one player** with the *Forgive* button on their row in the mines table. *Reset warnings*
  clears everybody.
- **A warning counts only once it arrives.** If the player is not online to receive it, the mine is
  checked again later instead of counting as their warning.
- *Armed state unknown* and *Flag unknown* in the mines table mean the plugin could not tell, and it
  does nothing about those mines until it can.
- The placer is whoever **armed** the mine, not whoever crafted or placed it.
- Everything can be configured with the server stopped; only the live lists need it running.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
