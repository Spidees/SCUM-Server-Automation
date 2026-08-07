# Chat Commands & Kits

A complete in-game command & reward system, managed entirely from the **Commands & Kits** admin tab.
It has five sections along the top — **Commands**, **Kits & Packs**, **Messages**, **Activity** and
**Settings** — and everything runs through the SSA Bridge.

## 💬 Commands
Create commands like `/info`, `/discord`, `/kit`, `/heal`. Each command has:
- **Reply text** (optional) — one message per line, with live `{tokens}`. Leave empty for an
  action-only command.
- **Reply channel** — `local` / `global` / `squad` / `admin` / `server`.
- **Announce to all** — everyone sees the reply, vs. only the player who typed it.
- **Cooldown (h)** — per-player wait before it can be used again (`0` = none).
- **Shared CD group** — give several commands the same group name and they share **one** cooldown:
  using any one blocks the rest until it elapses (e.g. `/shopb4`, `/shopc1` teleports a player shouldn't
  hop between — put them in group `shops`; a separate `/back` stays independent).
- **Cost** — `free`, or `money` / `gold` / `fame` to charge for using it.
- **Notify player** — see [Notify player](#-notify-player) below.
- **Allow only / Deny** — restrict a command to specific players, or block specific players. The picker
  lists **all known players** (online and offline) with an online marker, plus a SteamID paste box.
- **Admin actions** — run any admin command(s) when the command fires (teleport, give currency, spawn,
  weather…), each with an optional delay. Position is frozen at use, so a command can teleport a player
  away and send them back — see [Teleport there & back](#teleport-there--back).

Once a list gets long a **search box** appears in the section header to filter commands by name.

## 🎁 Kits & Packs
Reward packs handed straight into the game:
- **Give when** — automatically **on join** (welcome pack) or when the player types a **command**.
- **Cooldown (h)** — welcome `0` = once ever; command `24` = a daily.
- **Max/player** — hard cap on how many times one player can ever claim it (`1` = one-time; `0` = unlimited).
- **Exclusive group** — packs sharing a group name are mutually exclusive: claim one and the others lock
  (e.g. a one-of-three starter choice).
- **Cost** — `free`, or `money` / `gold` / `fame`.
- **Notify player** — see [Notify player](#-notify-player) below.
- **Allow only / Deny** — same all-players picker as commands.
- **Items & Vehicles** — **Pick item / Pick vehicle** searches the game database (the native picker), with
  a per-entry quantity.
- **Full containers** — a backpack / vest / crate spawned **filled** with N sets of a chosen item
  (`#SpawnInventoryFullOf`). Pick the container, the item to fill it with, and the number of sets.
- **Admin actions**, **Reply channel** and **Message** — optional, as above.

**Fuses:** items/vehicles spawn on the player through the bridge; currency is charged and the claim is
recorded **only after** something actually spawned. If nothing can be delivered, the player is told and
**nothing is taken**.

## 🔔 Notify player
A per-command / per-pack toggle for the game's **own** in-game feedback (the native "item spawned" style
messages) — this is separate from the pack's own chat **Message**.
- **Off (default)** — deliver silently via the bridge, so a big kit never spams the player's feed. Same
  default as the admin console.
- **On** — deliver **through the player**, so the game shows *that* player its own messages. This matters
  because the game notifies whoever *executes* a command, not the `Location` target — running it through
  the recipient makes the notification (and any location-less command) land on the right person instead
  of a random online player.

## 📝 Messages
Every player-facing system line — cooldown, already-claimed, group-locked, limit reached, not allowed,
can't-afford, not-in-game, delivery-failed — is fully editable, in **any language**, with tokens
(`{player} {pack} {cmd} {h} {cost} {currency}` plus all the usual ones). Leave a field blank for the
built-in English text.

## 📈 Activity
One live operational dashboard:
- **Live queue** — what the throttled spawn queue is delivering right now, and what's still waiting.
- **Delivery log** — every kit/reward handed out, with clickable players and item previews. The result
  column shows `spawned/total`; click the **Result** header to surface failed deliveries first.
- **Player claims** — who has claimed which reward (name, SteamID, uses, when). **Reset** a player so they
  can claim a one-time reward again, or **Clear all claims** to reset everyone.

The status badges at the top of every section show welcome on/off, command & pack counts, total
deliveries, failures and the current queue depth — updated live.

## ⚙️ Settings
- **Command prefix** — the character players type before a command (default `/`). Set it here; it
  overrides the bridge's own setting, so you never edit the bridge.
- **Default reply channel** — used when a command/pack has no channel of its own.
- **Welcome delay (s)** — how long after a player spawns in before the welcome is sent. **`0` = instant**
  (safe — the greeting is triggered by the live join, which fires only once the player is fully in-game).
- **Welcome message** — a private message sent to each player when they join.
- **Delivery reliability** — every spawn goes through **one throttled, retried queue**, so a burst of
  claims never faults items away and players reliably get the whole kit:
  - **Spawn gap (ms)** — delay between spawns (higher = gentler on the server during mass events).
  - **Spawn attempts** — tries per item before giving up (`1` = no retry; recovers transient bridge faults).
- **Advanced** — change the exact spawn command templates if needed. Default spawns on the player by
  SteamID: `#SpawnItem {item} {count} Location {steamid}` (placeholders: `{item} {code} {count}
  {container} {sets} {fill} {steamid} {x} {y} {z}`).

## Teleport there & back
Turn on **Remember position** for a command, plus an action that teleports the player somewhere
(`#Teleport <x> <y> <z> {steamid}`). A second command with `#Teleport {saved_x} {saved_y} {saved_z}
{steamid}` sends them back to where they started — on demand. Or add a delayed action to return them
automatically after N seconds.

## Live tokens
Use in any reply, message or action — heavy lookups only run when the token is actually used. Hover any
token in the panel's **Insert token** palette to see exactly what it shows.

- **Player:** `{player}` `{steamid}` `{squad}` `{squadsize}`
- **Server:** `{server}` `{online}` `{maxplayers}` `{date}` `{time}`
- **Money:** `{money}` `{cash}` `{gold}`
- **Stats:** `{fame}` `{kills}` `{deaths}` `{kd}` `{pvpkills}` `{headshots}` `{zombiekills}`
  `{animalkills}` `{longestkill}` `{lockspicked}` `{fishcaught}` `{distance}` `{playtime}` `{survived}`
- **Attributes:** `{strength}` `{constitution}` `{dexterity}` `{intelligence}`
- **Position:** `{location}` `{x}` `{y}` `{z}` `{saved_x}` `{saved_y}` `{saved_z}`
- **Command args:** `{args}` `{arg1}…` `{channel}`

## Requirements
- The **SSA Bridge** plugin (in-game chat, spawning, currency, live join). It's a dependency and installs
  automatically. At least one player must be online for in-game actions.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
