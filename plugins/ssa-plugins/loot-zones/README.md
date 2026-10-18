# Loot Zones

**Rotate loot around the island.** A zone is a rectangle with its own loot: the plugin puts your
loot files into the server's `Loot` folder and draws the same rectangle on the players' map. Zones
change **by hand**, on **days and hours you pick**, or **once per server restart**, and players are
told in your own words. Inside a zone you can also **keep sentries and zombies out**, post a
**garrison of your own — at places you name or places the plugin finds** — and make the whole area
**busier or quieter** by changing the spawn plan the game itself uses. A zone can carry **variants**,
one picked at random every server restart, built in one click from **presets**, and the whole list,
a hundred zones or more, is set up from the tab: **create one zone per loot set in one go**, filter,
tick and change many at once.

## How it works

- **You bring the loot sets.** A set is a folder of spawner presets with a `Zones.json`, exactly as
  the game's own `#ExportItemSpawnerPresetsInZone` writes it. Drop the folders in the sets folder
  and they appear in the tab. The plugin ships none.
- **The rectangle comes from the set's own `Zones.json`**, the same file the game reads, so the zone
  on the map and the loot on the ground always match. A set without a readable one is refused.
- **Or give a zone an area of your own.** A rectangle or a circle anywhere on the island, centred
  where you like — picked off the map, taken from where a player is standing, or typed. The loot
  files stay the set's, so a larger area is the same loot inside a bigger circle, and the tab says
  how much ground each of the two covers. Sizes are **half-spans in centimetres**, the way the game
  itself stores them, and every box shows the distance you would pace out underneath it.
- **A zone can have variants, and a new one is picked at every server restart.** Each variant is
  its own set of guards, protection and spawn settings for the same place and the same loot, so
  players know where the loot is and not what is waiting there. The pick is made as the server
  stops, by each variant's share, written in the manager's log by zone and variant, and kept if only
  the manager restarts. Variants are built and edited in the tab, from **presets** or by hand, and
  **Pick a new one now** swaps a zone's variant during a session.
- **Every zone and every variant is held to four rules**, and a save that breaks one is refused with
  a sentence naming it: **NPC guards never stand with sentries** (with NPC guards, the sentries are
  kept out), **keep zombies out goes only with NPC guards**, with the place's own sentries standing
  or as clean PvP, and **keep sentries out only where the area has sentries**. What an area holds
  comes from the game's own map data, shipped with the plugin: the fixed sentry posts and the
  abandoned bunkers whose alarm brings a dropship with sentries.
- **Your own loot overrides are never touched.** The plugin writes and removes only its own
  `LOOT_ZONES_` folders.
- **Works with the server stopped.** Running, the rectangle is drawn live and the loot can be
  reloaded straight away; stopped, the rectangle is written into the save after a verified backup
  and the loot lands at the next start. The tab always says which of the two happened.
- **Four messages** — a zone opening, a zone closing, a reminder while it runs, and a line for a
  player logging in — each to chat, the screen, a sound, the kill feed or the chat history.
- **Sentries and zombies can be kept out.** Fixed map sentries are **put away** rather than removed,
  because the game rebuilds a removed one within seconds; deployed sentries are removed, and zombies
  are both removed and told not to spawn inside that zone's own configuration.
- **Guards of your own**: armed NPCs, zombies, animals, bosses and other creatures from the game's
  catalogue, or the game's **random** spawns, which name no class and so work on any server whatever
  it has ever made. Each guard carries **how many of it the zone holds**, **how many stand together**
  and its **share** of whatever places are left, and the tab works that out against the places the
  zone really has before you save.
- **You can name the exact places.** Type coordinates, **take a player's position** — the only
  practical way to name a spot in a tunnel — or **pick it off the map** where your manager offers
  that. A guard with places of its own stands only there; with none, the zone finds its own.
  **Also use the places the zone chooses** lets it stand on the zone's places too, and on a zone set
  to no places of its own it brings as many as it has points.
- **Places the zone finds itself keep changing.** They do not depend on sentries: *Places spread
  over the zone* sets how many, and each sentry it clears adds one more guard, never on the sentry's
  spot. The zone picks from a pool of about three times the places it needs, each visit stands on
  the least used ones, and part of the pool is swapped for new ground every visit.
- **A killed guard comes back somewhere else.** Its replacement stands on another place of the
  zone's own, never where it fell, and never closer to a player than the zone allows. With nowhere
  else free it waits two minutes, then refills where it was. *Move a standing guard after* moves
  untouched guards too, one per round and never with a player within 50 m.
- **A place the game will not take is refused by name, never moved.** Every point is checked against
  the running game and answered in the game's own words: in water, inside a structure, indoors with
  no room to stand, outside the rectangle, no ground within reach. **A point the plugin cannot reach
  yet is a fourth answer and not a rejection** — a tunnel nobody is standing in simply has not been
  built by the game, and the zone asks again rather than moving the guard somewhere else.
- **Where the plugin chooses for itself, it stops choosing the same spots.** It builds a pool of
  standable places inside the rectangle by reading the real ground — through roofs, into buildings
  and down into tunnels — keeps what it learns, and picks least-recently-used first, so waves land
  in different places without a post wandering away from where a player last saw it.
- **Guards stand on real ground**: never on a roof, inside something solid, or in water.
- **A zone clears up after itself.** Its own guards are taken away again once the last player has
  left it, after a short grace so somebody pacing the edge does not make them come and go, and one
  that walks out of the rectangle is taken away and its place freed. The zone keeps the id of every
  guard it placed until that guard is dead or gone: one that runs far off is found by its id and
  taken away where it stands, and it still counts while it lives, so its place is not filled twice. Both are settings: a zone that
  wants a permanent garrison, or guards that chase, says so.
- **A zone is worked only while a player is near it** (400 m by default), because the game only puts
  sentries, NPCs, animals and zombies into the world around players. **A guard never appears right
  next to somebody** — 50 m by default.
- **A zone can be made busier or quieter using the game's own spawn plan.** SCUM keeps a plan per
  place — how likely a spawn is and how often it rolls — and reads it while the server runs, so this
  needs nobody online. **One plan is shared by every place of its kind**, so turning up "this
  village" turns up villages, and the tab counts the spill before you choose anything.
- **The tab says what each plan can actually produce.** A chance decides how **often** the game
  rolls, never how many characters a roll makes, and a few places on the island are written to make
  none at all. *Makes up to five each time* and *makes none at all* are two different lines.
- **Everything it changes, it puts back**: when the zone goes off, when the plugin is switched off,
  by itself after a while even if the manager stops running, and at the next server restart.

## Requirements

- The **SSA Bridge** plugin. **2.22.2+** to reload loot without a restart, and **2.27.0+** for the
  route that places an ordinary guard directly.
- Manager **6.0.0+**.
- The **Bridge** box at the top of the tab lists every bridge switch your own settings use, shows
  its live state and turns on the ones it is allowed to. The rest you switch on yourself: **Custom
  zones** for the rectangle, **Live player data** for knowing who is near, **Remove from the world**
  for keeping sentries and zombies out, **Precise spawning** and **Placement check** for guards,
  **Live world** for telling a guard from a body, **Allow changing how busy a kind of place is** on
  **Encounters and spawn waves** for a busier or quieter zone, and **Server notifications** or
  **In-game actions** for the messages that are not chat. The box names each one by the caption on the bridge's own card.

## Configuration

Everything is configured from the plugin's **admin tab** (📦 Loot Zones). Nothing needs `config.json`.
The tab has three parts:

- **Zones**: the whole list on one page, one row per zone with its name and loot set, its sector,
  its shape and size, what is in the area (sentry posts, an abandoned bunker, or no sentries), the
  variant running this session, whether anything needs fixing, and its rotation switch. Search it,
  filter it by sector, by place or by state (in rotation, live now, with variants, with something
  to fix), sort it by any column, and page through it 25 rows at a time. Tick zones to put them in
  or out of the rotation, **give them variants**, remove their variants, pick a new variant now, or
  remove them, all in one press. Above the list:
  - **Create zones from loot sets** lists every set in the sets folder that has no zone yet and
    makes one zone per ticked set, named after its folder, with the set's own box from `Zones.json`
    **grown by the margin you choose**, as a rectangle, a circle or whichever suits the place, and,
    if you like, a mix of 3 to 5 variants each.
  - **Add a zone** and **New variants for every zone now**.
- **One zone**: press a zone's name or **Edit** to open it, and step to the previous or next zone
  without going back to the list. The zone is split into five sections:
  - **General**: its name, its loot set, what the zone is doing right now, its days and hours,
    *Switch this one on now*, *What is in this zone?*, its place in the turn order, copy and remove.
  - **Area**: the loot set's own rectangle or numbers of your own (shape, centre, half-sizes or
    radius), *Pick the centre on the map*, *Centre on a player*, *Show me where that is* and *Check
    this area*. **Take the box from Zones.json, grown by** puts the set's own box plus a margin into
    the numbers. Under it the sector, what the area holds and how far the nearest other zone is.
  - **Guards and protection**: *Keep sentries out*, *Keep zombies out*, *Guards of my own* with one
    row per guard, when they come, how long they stay and the technical settings. *Keep sentries
    out* is offered only where the area really has sentries.
  - **How busy the zone is**: the game's own spawn plan for the places in the zone.
  - **Variants**: a bar showing how often each variant comes up and which one runs now, then one
    row per variant with its name, its share, on or off, a sentence saying what it does, and *Edit*,
    *Copy*, move up or down and remove. **Add a variant from a preset** (NPC guards of level 4 and 5
    with no zombies, NPC guards among the zombies, Razors, a horde, only the sentries with no
    zombies, clean PvP, NPC guards by day and Razors at night, quiet by day and Razors at night),
    one that starts as the zone, or **replace them with a mix**. A variant opens onto the same guard
    and busy sections as the zone, above a list of every setting saying whether the variant sets it
    itself or **inherits the zone's value**, with a button to go back to the zone's. *Pick a new one
    now* swaps this session's variant.
- **Messages**: the chat channel and the four messages, each with its text per language, where it
  goes, and a *Try it in game* button. Tokens such as `{zone}`, `{zones}` and `{player}` are filled in.
- **Settings and actions**: the zone name prefix and the rectangle players see (one of your zone
  configurations, or the plugin's own with its visibility, entry notice and colour), how zones are
  chosen (by hand, on a schedule or one per restart, and under *More options* the zones at once, the
  time between switches, the reload, the check interval and the loot sets folder), and *Switch
  everything off*, *Reload loot now* and *Check against the game*.
- **Bridge**: at the top of the zone list, the switches your settings need, with one button to turn
  on the ones an owner may.

## Good to know

- **Nothing reaches the server until you press Save**, and *Discard changes* puts everything back to
  what the server is holding — including a zone or a guard you removed.
- **The rectangle belongs to the loot set unless you give the zone one of its own**, so two zones
  on one set cover exactly the same ground. That is why a copy arrives switched off.
- **An area of your own moves the zone, never the loot.** The files still cover whatever ground the
  set's `Zones.json` covers, so a bigger area is more map and the same loot; *Check this area* puts
  both figures side by side before you save.
- **Every explanation on the tab opens on demand.** What decides something is on the screen — a
  label, a unit, a count, a warning; the paragraph behind it is one click down under *How this
  works*. Nothing has been taken away.
- **A zone's own guards leave when the players do.** About 20 seconds after the last player has
  gone, the zone takes back the guards it placed, and only those; one that wanders more than 20 m out
  of the zone is taken back too. For a permanent garrison set *Guards stay* to **Once placed, they
  stay**, and *If one walks out of the zone* to **Let it walk**.
- **One zone per server restart is decided as the server stops.** The old rectangle is taken out
  of the save and the new one written in, and the restart waits for that before the next server
  starts.
- **Removing a live zone from the list does not switch it off.** Its loot folder stays on the server
  and its rectangle stays on the map: switch it off first, or press *Check against the game*.
- **A guard placed directly is not registered with the game.** It has no entity id and no save row,
  so it is **gone at the next server restart** and the zone puts it back when players return. **For
  a boss at a place you named that is the whole of the deal** — it may be exactly what an event
  wants, and it is not a permanent fixture.
- **That is also what keeps a guard in its zone.** The game removes an admin-spawned guard once
  every player is more than about 175 m away; one placed directly is not on that list at all, so it
  stays.
- **Every class is loaded by the bridge when the zone first needs it**, bosses included: a Razor or a
  Brenner is placed at its post with nobody having met one first. Loading pauses the server for
  about a fifth of a second, once per kind. It needs **Load a class the game has not made yet**
  on the bridge's **Precise spawning** card, which the bridge ships **off**; the Bridge box at the top of
  the tab lists it. Without it an armed NPC's first one comes through the game's own command, and a
  Razor waits until the game has made one or you name a point for it. A Dropship, a Sentry and a
  drone are still placed only once the game has made one.
- **Only places the zone chose ever move.** A point you named stays exactly where you typed it, and
  a random guard or one placed without an id is not moved by *Move a standing guard after*, because
  the zone cannot tell which one it is.
- **A guard placed without an id cannot be followed.** The card says how many there are. The game
  removes them itself once nobody is near.
- **A random guard works on any server and costs you identity.** It names no class, so nothing has
  to be loaded — and the command hands back no id, so **any creature of that kind standing on that
  place holds it**, the game's own wildlife included. A random-animal place in a field with deer in
  it reads as held and is not refilled.
- **Busier is a share, never a total.** *200%* is twice what the game authored for that kind of
  place, and it is always taken against what the game authored rather than against whatever the
  plan says now, so leaving it on does not compound. 100% is the game's own balance and is a real
  choice.
- **A plan that makes nothing is left alone, and a plan that could not be read is not one of those.**
  There are three answers and the tab keeps them apart; only the middle one takes the percentage box
  away, with the reason beside it.
- **Guards and how busy a zone is are two different things.** A guard is one character in one place
  and still needs somebody online; how busy a place is does not.
- **A loot reload resets every searchable container on the whole map**, not just in the zone. That is
  why switches are held apart by *Time between switches*.
- **Schedules use the server's clock**; **guard hours use the game's**, which runs at your own day
  speed. A schedule that crosses midnight belongs to the day it starts. A guard window decides when
  a guard is *sent* — one that closes never removes a guard already standing — and if the game's
  clock cannot be read the window is not applied at all, which the zone says every round.
- **A variant changes only the guards, what is kept out and how busy the zone is.** The loot set,
  the name and the area stay the zone's own. A setting a variant does not set follows the zone's own
  Guards and How busy sections, so changing the zone changes every variant that inherits it. A zone
  without variants behaves exactly as before. Since "Keep zombies out" belongs to the zone's
  configuration, a variant that turns it on or off moves the rectangle to the other configuration
  before the next server start.
- **Pick a new one now takes the old variant's guards away** first, by their ids, inside the zone;
  the new variant's guards arrive with the next patrol while a player is near. A guard placed without
  an id is left to the game. The loot and the area do not change.
- **A zone saved before the rules existed is not refused**: a save that leaves it as it was stores,
  and the list shows what it breaks in red until you fix it.
- **Zones made from loot sets grow the set's box, never the loot.** The margin makes the area
  players see larger; the loot files still cover only the set's own box. Two neighbouring zones can
  overlap after growing, and the list says so.
- **The live map cannot draw an area for a plugin yet**, so the Area section shows the sector and
  the nearest other zone in numbers, and *Show me where that is* puts the map on the centre.
- **Night-only guards use the game's clock.** Give a guard game hours from 21 to 5 and it is sent
  only at night; it needs "Time of day and day length" on the bridge's Live player data card, and
  without it the window is open all day. A guard already standing when the window closes stays
  until players leave.
- **The zone name prefix can never be empty**: it is how the plugin tells its zones from yours, so
  a save with an empty one is refused.
- **Two zones with the same full name are one zone to the game**, so a repeated name orphans a
  rectangle on the map.
- *Also slow SCUM's own sentry respawn* applies to every guarded place on the island, not just the
  zone.
- **With `scum.MaxAllowedNPCs` at 0 the game destroys any armed NPC with no player within about
  175 m**, a few seconds after it appears. Above 0 the distance is not established and the tab says
  so rather than guessing.
- **A zone too big to sweep has its sentries left alone.** The bridge refuses a radius over its own
  ceiling rather than narrowing it, and that ceiling ships at 50 m; the tab works out what your
  rectangle needs and names the setting when it is over.
- **Underground places exist only while a player is near them**, so a point down there answers
  *unknown* until somebody is, and the zone keeps asking.
- *Try it in game* sends the message to everyone, exactly as it is **saved**, with a sample name
  in `{player}`, and says so when nothing went out.
- **Each player reads the chat line in the language they chose** with `/lang`, on the Field Console
  or on Discord, else the Default tab; the built-in wording comes in all 21 languages. Zone names are
  yours and stay as you wrote them, and the on-screen, sound and kill-feed lines sent to everyone use
  the server's language.
---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
