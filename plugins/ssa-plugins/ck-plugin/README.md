# Chat Commands & Kits

A complete in-game command & reward system, managed entirely from the **Commands & Kits** admin tab
(four sections along the top). Everything runs through the SSA Bridge.

## 💬 Commands
- **Command prefix** — the character players type before a command (default `/`). Set it here; it
  overrides the bridge's own setting, so you never edit the bridge.
- **Welcome delay (s)** — how long after a player spawns in before the welcome is sent. **`0` = instant**
  (safe — the greeting is triggered by the live join, which fires only once the player is fully in-game).
- **Welcome message** — a private message sent to each player when they join.
- **Chat commands** — create commands like `/info`, `/discord`, `/rules`. Per command:
  - **Reply text** (optional) — one message per line, with live `{tokens}`.
  - **Reply channel** — `local` / `global` / `squad` / `admin` / `server`.
  - **Announce to all** — everyone sees the reply, vs. only the player who typed it.
  - **Cooldown (h)** — per-player wait before it can be used again (`0` = none).
  - **Shared CD group** — give several commands the same group name and they share **one** cooldown:
    using any one blocks the rest until it elapses (e.g. `/shopb4`, `/shopc1` teleports a player shouldn't
    hop between — put them in group `shops` with the same cooldown; a separate `/back` stays independent).
  - **Cost** — `free`, or `money` / `gold` / `fame` to charge for using it.
  - **Allow only / Deny** — restrict a command to specific players, or block specific players (pick from
    those online or paste a SteamID).
  - **Admin actions** — run any admin command(s) when the command fires (teleport, give currency, spawn,
    weather…), each with an optional delay. Position is frozen at use, so a `/event` command can teleport
    a player away and a `/back` command can send them home — see **Teleport there & back** below.

## 🎁 Kits & Packs
Reward packs handed straight into the game:
- **Give when** — automatically **on join** (welcome pack) or when the player types a **command**.
- **Cooldown (h)** — welcome `0` = once ever; command `24` = a daily.
- **Max/player** — hard cap on how many times one player can ever claim it (`1` = one-time; `0` = unlimited).
- **Exclusive group** — packs sharing a group name are mutually exclusive: claim one and the others lock
  (e.g. a one-of-three starter choice).
- **Cost** — `free`, or `money` / `gold` / `fame`.
- **Allow only / Deny** — same per-player control as commands.
- **Items & Vehicles** — **Pick item / Pick vehicle** searches the game database (the live-map picker).
- **Full containers** — a backpack / vest / crate spawned **filled** with N sets of a chosen item
  (`#SpawnInventoryFullOf`). Pick the container, the item to fill it with, and the number of sets. (The
  live map has the same "Spawn full container" option on a right-click and on a player.)
- **Admin actions**, **Reply channel** and **Message** — optional, as above.

**Fuses:** items/vehicles spawn on the player through the bridge; currency is charged and the claim is
recorded **only after** something actually spawned. If nothing can be delivered, the player is told and
**nothing is taken**.

## 📝 Messages
Every player-facing system line — cooldown, already-claimed, group-locked, limit reached, not allowed,
can't-afford, not-in-game, delivery-failed — is fully editable, in **any language**, with tokens
(`{player} {pack} {cmd} {h} {cost} {currency}` plus all the usual ones). Leave a field blank for the
built-in English text.

## 👥 Users
See **who has claimed what** (name, SteamID, times, when). **Reset** a player so they can claim a
one-time reward again, or **Clear all** to reset everyone. Managed here in the panel — not with in-game
admin commands.

## Teleport there & back
Turn on **Remember position** for a command, plus an action that teleports the player somewhere
(`#Teleport <x> <y> <z> {steamid}`). A second command with `#Teleport {saved_x} {saved_y} {saved_z}
{steamid}` sends them back to where they started — on demand. Or add a delayed action to return them
automatically after N seconds.

## Live tokens
Use in any reply, message or action — heavy ones are only looked up when used:

`{player}` `{steamid}` `{online}` `{maxplayers}` `{server}` `{channel}` `{args}` `{arg1}…`
`{money}` `{cash}` `{gold}` `{fame}` `{kills}` `{deaths}` `{headshots}` `{playtime}`
`{squad}` `{squadsize}` `{location}` `{x}` `{y}` `{z}` `{saved_x}` `{saved_y}` `{saved_z}` `{date}` `{time}`

## Advanced
Under **Kits & Packs → Advanced** you can change the exact spawn command templates if needed. Default
spawns on the player by SteamID: `#SpawnItem {item} {count} Location {steamid}` (placeholders:
`{item} {code} {count} {steamid} {x} {y} {z}`).

## Requirements
- The **SSA Bridge** plugin (in-game chat, spawning, currency, live join). It's a dependency and installs
  automatically. At least one player must be online for in-game actions.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
