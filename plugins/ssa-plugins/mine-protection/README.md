# Mine Protection

Punishes players who **arm a mine or trap outside their own or their squad's flag area**. The first
offences earn a chat **warning**; after that the placer is **teleported onto their own armed mine**.
It also **clears the mines no flag protects any more**: the ones a fallen flag leaves behind, and the
ones that sit **outside every flag**, and lets you **remove mines by conditions** yourself.

## How it works
- Every few seconds the plugin reads the manager's **world scan** for placed, **armed** mines and traps
  of the watched types, and **who armed each one**.
- A mine is legal when it sits inside the **flag area of any base owned by the placer or a squadmate**.
  A squad member arming inside a teammate's base is never punished.
- **Before a teleport, the running game is asked** whether the mine is still armed and who is in the
  placer's squad right now. These checks can only cancel an offence, never create one.
- **Escalation:** the first offences per player are a warning, then the teleport. **Offline placers**
  are dealt with the moment they reconnect.
- **It never acts on a guess.** When the game database cannot say whether a mine is inside a flag,
  the mine is left alone and checked again later. That holds for the punishment and for every removal.
- **Fallen flags (off until you switch it on):** when a flag disappears, a **timer** starts (10 minutes
  by default). If no new flag of the same owner or squad stands in the **original flag area** when it
  runs out, the mines inside that area are removed.
- **Mines outside every flag (off until you switch it on):** a mine of the chosen types that sits inside
  **no standing flag area** is removed once it has been there for the **grace time** (60 minutes by
  default). This covers what the fallen-flag timer cannot see: a flag that fell **before the plugin
  first looked**, a base that was wiped, a mine armed outside every flag. By default a placer who is
  online keeps their mine until they leave; exempt players and mines you chose to keep are never removed.
- **Remove by conditions:** the **Mines** screen lists every placed mine and trap with filters for
  type, placer, inside or outside a flag, armed, sector and the time it was last handled. Tick rows and
  remove them, or remove everything that matches. The confirmation names the count.
- **A mine counts as removed only when the game confirms it.** Each one is a line in the log and in
  **Activity**. A refusal is logged in the bridge's own words and tried again. Timers survive a restart.

## Requirements
- The **SSA Bridge** plugin, for the teleport and the chat message.
- Two bridge modules are optional and recommended, because they let the plugin check the running game
  instead of the last save. The plugin's card on the **Plugins** page lists them and offers to switch
  them on:
  - **Live inventories**: *Read live inventories*, which confirms a mine is still armed.
  - **Live squads**: *Read live squads, and allow the changes below* and *Include the member list*,
    which confirm the placer's current squad.
- For **any removal**: *Destroy an item* in the **Live inventories** module. It ships off, and the
  Overview says so while it is off. To clear an area with nobody near it, also the **Far from players**
  module (*Work far from players*).
- Manager **6.0.0+**.

## Configuration
Everything is configured from the plugin's **admin tab** (🛡️ Mine Protection), on five screens:

- **Overview**: what runs on this server, what a removal needs from the bridge, the placed mines by
  type and the latest actions.
- **Mines**: every placed mine and trap, with filters, ticks, *Remove ticked* and *Remove all matching*,
  and a *Forgive* button on a player's offences.
- **Flags**: the fallen flags with *Keep mines* and *Remove now*, and the mines outside every flag by
  place, with *Keep mines* and *Remove now*.
- **Activity**: every removed mine, what is being removed now (with *Stop*), and the warnings and
  teleports with *Reset warnings* and *Clear history*.
- **Settings**: every switch.
  - **Watched mines & traps**: a picker with an icon per type. Quick buttons: *Explosives only*,
    *Select all*, *Clear*. The default is the explosives without C4, because C4 is a raiding tool.
  - **Punishment**: its own on/off switch, teleport or warn only, warnings before action, extra margin
    around the flag, scan interval, and only while the placer is online.
  - **In-game messages**: the chat channel, the warning and the penalty message.
  - **Mines of a fallen flag**: the switch, the delay, how long to keep trying, which types, whose new
    flag keeps the mines, an owner alert and a chat announcement.
  - **Mines outside every flag**: the switch, which types, the grace time, only while the placer is
    offline, an owner alert and a chat announcement.
  - **Removing mines**: loading an empty area with the bridge's visitor, how long a removal keeps
    trying, and the mines you chose to keep.
  - **Exemptions**: players who are never punished and whose mines are never cleared.
- **Every player's language**: each message has a tab per language, and every player reads the one
  for the language they chose with `/lang`. An empty tab sends the default text.

## Good to know
- **A mine can only be removed while the game has its area loaded**, which means a player nearby or
  the bridge's *Work far from players* visitor. The visitor loads one place at a time.
- The fallen-flag timer only knows flags it saw standing. Mines of a flag that fell earlier are found
  by **Mines outside every flag**.
- A flag is seen as fallen when the **server's save** (or the game's own flag log) no longer has it,
  so a timer starts up to one autosave after the flag really fell.
- *Last handled* is when the game last saw anybody handle the mine, read from the save.
- The placer is whoever **armed** the mine. A placer the save no longer knows counts as offline.
- *Keep mines* on a fallen flag also keeps those mines from the outside-every-flag clean-up.
- Everything can be configured with the server stopped; only the lists, counters and removals need it.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
