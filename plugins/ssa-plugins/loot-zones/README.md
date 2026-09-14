# Loot Zones

**Rotate loot around the island.** Each zone is a rectangle with its own loot: the plugin puts your
loot files into the server's `Loot` folder and draws the same rectangle on the players' map. Zones
change **by hand**, on **days and hours you pick**, or **once per server restart**, and players are
told in your own words. Inside a zone you can also **keep sentries and zombies out** and post a
**garrison of your own**.

## How it works
- **You bring the loot sets.** A set is a folder of spawner presets with a `Zones.json`, exactly as
  SCUM's `#ExportItemSpawnerPresetsInZone` writes it. Put the folders in the sets folder and they
  appear in the tab. The plugin ships none.
- **The rectangle comes from the set's own `Zones.json`**, the same file the game reads, so the zone
  on the map and the loot on the ground always match. A set without a readable `Zones.json` is refused.
- **Your own loot overrides are left alone.** The plugin writes and removes only its own
  `LOOT_ZONES_` folders.
- **A switch reloads the loot while the server runs**, so a new zone is live at once. With the reload
  off, the loot lands at the next server start. With *One zone per server restart* the files are put
  in place as the server stops, so the zone is live for the whole next session.
- **Works with the server stopped.** With the game running the rectangle is drawn live; with it
  stopped, the plugin writes it into the save after taking a backup. The tab says which one happened.
- **Four messages**: when a zone opens, when it closes, while it runs, and to a player logging in.
  Each can go to chat, on screen, with a sound, to the kill feed, or into the chat history (the
  admin chat view, Field Console and your Discord chat channel).
- **Keep sentries out**: fixed map sentries are put away (stopped, hidden and moved under the ground),
  because the game rebuilds a removed one within seconds. Deployed sentries are removed.
- **Keep zombies out**: zombies are removed while a player is near, and with the zone keeping its own
  configuration the game is also told not to spawn them inside it.
- **Guards of my own**: armed NPCs, zombies, animals, or bosses and other creatures, picked from the
  game's catalogue and mixed as you like. They stand where the sentries stood, plus any extra spots
  you add, and a killed guard comes back after the respawn time.
- **A zone is worked only while a player is near it**, because SCUM only puts sentries, NPCs, animals
  and zombies into the world around players. By default a zone wakes up when somebody comes within
  400 m.
- **A guard never appears right next to a player.** A spot with a player within *Never appear within*
  (50 m by default) waits until they move on.

## Requirements
- The **SSA Bridge** plugin, version **2.22.2+** for reloading loot after a switch.
- Manager **5.16.2+**.
- The **Bridge** box at the top of the tab lists every bridge switch your settings use and turns on the
  ones it is allowed to. The rest you switch on yourself on the bridge's cards:
  - Drawing the zone: **Custom zones**, with *Allow creating and changing zones*.
  - On-screen messages: **Server notifications** (*Announce to everyone*, *Write to the kill feed*,
    *Let notifications make a sound*) and **In-game actions** (*Put text on a player's screen, or
    fade it*). Chat needs neither.
  - Knowing who is near a zone: **Live player data**, with *Position, facing and speed*.
  - Keeping sentries and zombies out: **Remove from the world**, with *Put fixed map sentries away
    instead of removing them*, *Remove deployed sentries* and *Remove puppets (zombies)*.
  - Guards: **Precise spawning** and **Placement check**. NPCs, zombies and animals also need *Also
    spawn things that LAST, through the game's own admin commands*, plus *Let in-game mods run admin
    commands* on the **SSA Bridge** card (group *In game*, takes effect after a restart). Bosses and
    creatures need *Creatures* and the **Live world** module, with the guard's kind ticked under
    *What to track*.

## Configuration
Everything is configured from the plugin's **admin tab** (📦 Loot Zones):

- **Bridge**: the switches your settings need, with one button to turn them on.
- **Zones**: one row per zone with its name, loot set, on/off switch and *duplicate*. On a schedule,
  each zone has its own days and times and shows whether it is open now. Each zone also has *Keep
  sentries out*, *Keep zombies out* and *Guards of my own*, with *Who*, *At most in the zone at
  once* and *Respawn after a kill*. *More options* holds extra guard spots, *Never appear within*,
  *Wait between guards*, *Wake up within* and *Also slow SCUM's own sentry respawn*.
- **What players are told**: the *Chat channel* and the four messages, each with its text, where it
  goes and a *Try it in game* button. Tokens such as `{zone}`, `{zones}` and `{player}` are filled in.
- **The rectangle players see**: the *Zone name prefix*, and *Colour and visibility*: use one of your
  existing zone configurations, or keep one of its own with its name, map visibility, entry
  notification and colour.
- **How zones are chosen**: *Rotation on*, *How zones change* (by hand, on a schedule, or one per
  server restart), and under *More options*: *Zones at once*, *Time between switches* (default
  30 minutes), *Reload loot after a switch*, *Check every* and *Loot sets folder*.
- **Actions**: *Switch everything off*, *Reload loot now* and *Check against the game*.

## Good to know
- **A loot reload resets every searchable container on the whole map**, not just in the zone. That is
  why switches are held apart by *Time between switches*. Turn off *Reload loot after a switch* to
  leave the loot for the next server start.
- **Schedules use the server's clock**, not the game's day cycle. A time that crosses midnight belongs
  to the day it starts, so Friday 22:00 to 02:00 is Friday night. A zone with no times set is always on.
- **"One per restart" means the game server's restart**, not the manager's.
- **Turning *Rotation on* off does not remove a live zone.** Use *Switch everything off* for that.
- **The zone name prefix can never be empty**: it is how the plugin tells its zones from yours. Switch
  everything off before changing it.
- *Also slow SCUM's own sentry respawn* applies to every guarded place on the island, not just the zone.
- Bosses and creatures placed as guards are gone after a server restart.
- NPCs, zombies and animals sent through the game's own spawn need a player online, and at most five
  go to one spot.
- On a server with no NPCs allowed, the game keeps armed NPCs only near players, so guards are sent
  only within about 150 m of somebody.
- *Try it in game* sends the message to everyone on the server, exactly as it is written.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
