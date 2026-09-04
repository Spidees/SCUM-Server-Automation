# Chat Commands & Kits

A complete **in-game command and reward system**, run entirely from one admin tab. Players type
`/commands` you invent and get a **reply, an admin action, or both**; they claim **kits and reward
packs** — items, vehicles, filled containers — on join, on command, or from a **button in Discord**.
Everything can be **free or priced** in money, gold or fame, with cooldowns, per-player claim limits
and mutually exclusive groups, and **nothing is charged for a delivery that did not happen**.

## How it works
- **Commands are yours to invent.** `/info`, `/discord`, `/kit`, `/heal` — each has an optional reply
  (one message per line, with live tokens), a reply channel, a cooldown, an optional cost, allow/deny
  lists, and **admin actions**: any admin command, each with its own delay. A **shared cooldown
  group** makes several commands block one another, so a player cannot hop between three shop
  teleports.
- **Position is frozen at the moment of use**, so a command can teleport a player away and a second
  one send them back to exactly where they started — `{saved_x} {saved_y} {saved_z}` — or a delayed
  action can return them automatically after N seconds.
- **Kits spawn onto the player**, addressed by their Steam ID, so they only need to be connected.
  Items, vehicles and **containers spawned already filled** with N sets of a chosen item all come
  from the game's own database through the native picker.
- **Fuses decide the money.** The kit spawns FIRST; currency is charged and the claim recorded
  **only after something actually landed**. A pack made only of admin actions is charged only if the
  bridge accepted at least one of them. If nothing can be delivered, the player is told and **nothing
  is taken**.
- **Anything can be limited to a time window** — a weekend kit, a command that stops overnight, an
  event pack. It is not a second cooldown: the cooldown asks how long since this player last had it,
  the window asks whether it is on offer at all. Windows run on the **server's real clock, not in-game
  time**, and the refusal tells the player when to come back.
- **One throttled, retried spawn queue** carries every delivery, globally. A burst of claims used to
  fault items away mid-dispatch and lose them silently; now spawns go out one at a time with a small
  gap and each is retried before it counts as failed.
- **Claim from Discord** posts one message with a button. The kit is delivered in game exactly as if
  the player had typed the command, because it *is* the same delivery — **every rule is the same
  rule**, so there is no second set of conditions to fall out of step. It needs a **linked** account
  and the player to be **in game**, and says so plainly rather than failing quietly.
- **A charge that did not go through is written down.** Items already handed over cannot be taken
  back automatically, so the delivery is marked **NOT PAID** in the log, sorted to the top, and
  raised as an admin alert.

## Requirements
- The **SSA Bridge** plugin — in-game chat, spawning, currency and the live join event. It is a
  declared dependency and installs with the plugin.
- Manager **5.13.0+**, which is what the manifest enforces. Time windows are part of that: they need
  the manager's own window evaluator, and on a manager without it a command or kit that HAS a window
  is treated as closed rather than as unrestricted, with the reason in the manager log.
- **At least one player online** for anything that happens in game. With nobody there the bridge has
  no one to run a command through, so a delivery is not charged and not counted as claimed.

## Configuration
Everything is configured from the plugin's **admin tab** (💬 Commands & Kits), in five sections:

- **Commands** — the command list, each with reply text and channel, *announce to all*, cooldown and
  shared cooldown group, cost, *notify player*, allow/deny (a picker listing all known players,
  online and offline, plus a Steam ID paste box) and its admin actions. A search box appears once the
  list gets long.
  Each command and each kit also carries a **time window** — the days and the hours it is on offer,
  on the server clock, with the exact sentence players will see shown as you edit it.
- **Kits & Packs** — *give when* (on join, or on command), cooldown, **max per player**, **exclusive
  group**, cost, allow/deny, and the contents: **Pick item / Pick vehicle** searches the game
  database, and **full containers** spawn a backpack, vest or crate already filled. Optional admin
  actions, reply channel and message. **Claim from Discord** is off per kit by default, so nothing
  reaches a public channel you did not put there; publish the panel from Settings.
- **Messages** — every player-facing system line (cooldown, already claimed, group locked, limit
  reached, not allowed, cannot afford, not in game, delivery failed), in any language, with tokens.
  Blank means the built-in English.
- **Activity** — the live spawn queue, the delivery log with clickable players and item previews
  (`spawned/total`, sortable so failures surface first), and **player claims**: who claimed what,
  resettable one player at a time or all at once.
- **Settings** — the **command prefix** (set here; it overrides the bridge's own, so you never edit
  the bridge), the default reply channel, the **welcome delay** and message, **delivery reliability**
  (spawn gap and attempts per item), and **advanced** spawn command templates.

**Notify player** is a per-command and per-pack switch, separate from the pack's own chat message.
**Off** (the default) delivers silently, so a big kit never floods the player's feed. **On** runs the
delivery *through* the player, so the game's own "item spawned" messages reach the right person
rather than whichever online player the bridge happened to pick.

**Live tokens** work in any reply, message or action, and the heavy lookups only run when the token
is actually used — hover any token in the **Insert token** palette to see what it shows:

- **Player** `{player}` `{steamid}` `{squad}` `{squadsize}`
- **Server** `{server}` `{online}` `{maxplayers}` `{date}` `{time}`
- **Money** `{money}` `{cash}` `{gold}`
- **Stats** `{fame}` `{kills}` `{deaths}` `{kd}` `{pvpkills}` `{headshots}` `{zombiekills}`
  `{animalkills}` `{longestkill}` `{lockspicked}` `{fishcaught}` `{distance}` `{playtime}` `{survived}`
- **Attributes** `{strength}` `{constitution}` `{dexterity}` `{intelligence}`
- **Position** `{location}` `{x}` `{y}` `{z}` `{saved_x}` `{saved_y}` `{saved_z}`
- **Command args** `{args}` `{arg1}…` `{channel}`

## Good to know
- **"Dispatched" is not "done".** If your bridge has *allow commands with nobody online* switched on,
  a command sent to an empty server goes through the game's static entry point, which reports nothing
  back — so it cannot be counted as delivered. Those never charge, never spend a claim, and say so in
  the log rather than being recorded as a normal success.
- **A partial delivery is charged in full.** A kit has one price and its items are not priced
  individually, so there is nothing to pro-rate. The player is told exactly what did not arrive and
  the row is marked, so you can find it and put it right.
- **Welcome delay `0` is safe.** The greeting is triggered by the bridge's live join, which fires
  only once the player is fully in game — not by the log, which can be many seconds late.
- **Prices are checked against the running game, not the last save.** The saved database is only as
  current as your save interval, which is long enough for a player to be paid and told they are broke
  in the same minute. The check asks the game first — and for that it needs the bridge's **Live
  data → Money, gold and account number** switch, which ships **off**. The plugin **declares** that
  switch, so its card in the panel shows whether it is on and turns it on for you in one click — it
  never switches anything on by itself. With it off everything still works, but affordability falls
  back to the saved figure and the refusal says so, so a player knows to try again shortly.
- **Money means the bank account.** That is the balance a cost is taken from and the balance the
  refusal quotes; `{cash}` is a separate legacy field the game leaves empty on current builds.
- **Being unable to read a balance is not the same as being broke.** A database hiccup used to tell a
  player they could not afford a kit; the charge itself is now left to decide, and that answer was
  already handled.
- Editing your kit list closes menus players already have open in Discord: a menu remembers *which
  kit at which price* it was showing, so re-pricing or deleting one never hands out a different one.
- **Reset counters** zeroes the delivery and failure totals once you have dealt with what they were
  telling you; the delivery log itself is kept.
- Spawn counts are clamped, so a config typo cannot ask the game for a million items.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
