# Loot Zones

**Rotate loot around the island.** A zone is a rectangle with its own loot: the plugin puts your
loot files into the server's `Loot` folder and draws the same rectangle on the players' map. Zones
change **by hand**, on **days and hours you pick**, or **once per server restart**, and players are
told in your own words. Inside a zone you can also **keep sentries and zombies out**, post a
**garrison of your own — at places you name or places the plugin finds** — and make the whole area
**busier or quieter** by changing the spawn plan the game itself uses.

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
- Manager **5.16.2+**.
- The **Bridge** box at the top of the tab lists every bridge switch your own settings use, shows
  its live state and turns on the ones it is allowed to. The rest you switch on yourself: **Custom
  zones** for the rectangle, **Live player data** for knowing who is near, **Remove from the world**
  for keeping sentries and zombies out, **Precise spawning** and **Placement check** for guards,
  **Live world** for telling a guard from a body, and **Server notifications** or **In-game actions**
  for the messages that are not chat. The box names each one by the caption on the bridge's own card.

## Configuration

Everything is configured from the plugin's **admin tab** (📦 Loot Zones):

- **Bridge**: the switches your settings need, with one button to turn on the ones an owner may.
- **Zones**: one row per zone — name, loot set, on/off, order (which is the turn order under *one
  per restart*), and *copy*, which makes a full independent duplicate under a name nothing else is
  using. Each zone opens onto where it is, its schedule, its guards, how busy it should be, and a
  short list in plain words of what will happen there.
- **The whole list at once**: a search box, a filter for in rotation / out of it / live now, and
  *Expand* and *Collapse* over whatever the filter is showing. Tick several zones and put them in
  or out of the rotation, or remove them, in one press. A list longer than three opens folded.
- **Where this zone is**: the loot set's own rectangle, or a rectangle or circle of your own with
  its centre and half-spans in centimetres. *Pick the centre on the map*, *Centre on a player*,
  *Show me where that is* and *Check this area*, which asks the game whether it lands on the map
  and says how much of what you drew the loot itself covers.
- **When they come**: *A new guard at most every*, *After a guard is killed, wait*, *Move a standing guard
  after* and *Never appear closer to a player than*.
- **Guards**: one row each, with *How many in the zone*, *At each place* and *Share of the rest*;
  *Where it stands* for the places you name; **How long they stay**, which decides whether the zone
  takes its own guards away again and whether one that wanders out is brought back; and **Only for
  this guard**, where any one guard can keep its own wait after a kill, its own distance from
  players, its own spacing and its own game hours. A setting a guard has not been given follows the
  zone, and the screen says which of the two every value is.
- **What players are told**: the chat channel and the four messages, each with its text, where it
  goes, and a *Try it in game* button. Tokens such as `{zone}`, `{zones}` and `{player}` are filled
  in.
- **The rectangle players see**: the zone name prefix, and either one of your existing zone
  configurations or one of the plugin's own with its name, map visibility, entry notification and
  colour.
- **How zones are chosen**: rotation on or off, by hand, on a schedule or one per server restart,
  and under *More options* the zones at once, the time between switches, the reload, the check
  interval and the loot sets folder.
- **Actions**: *Switch everything off*, *Reload loot now* and *Check against the game*.

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
  on the bridge's Spawning card, which is on unless you turned it off. A Dropship, a Sentry and a
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
- **The zone name prefix can never be empty**: it is how the plugin tells its zones from yours.
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
- *Try it in game* sends the message to everyone, exactly as it is **saved**, and says so when
  nothing went out.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
