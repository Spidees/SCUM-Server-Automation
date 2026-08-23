# Vehicle Rental System

Players rent a vehicle **from Discord or straight from in-game chat**, pay with their own in-game
money or gold, and get it spawned next to them. The plugin runs the whole rental from there —
reminders before it runs out, extensions, early return, and removing the vehicle when the time is
up. **No admin has to be online**, and a player never has to leave the game to do any of it.

## How it works
- Two front ends, **one rental engine**. Discord gives a button → vehicle → plan flow; in-game
  `/rent`, `/myrent`, `/extend` and `/return` do the same thing from chat. Limits, prices and the
  lifecycle are shared, so the two can't drift apart.
- **The vehicle is spawned first, and only then charged.** If the bridge is offline or the spawn
  fails, nobody is billed. If the *charge* fails, the vehicle is **taken back** — a rental never ends
  with a free vehicle or a payment for nothing.
- Limits count **per player**, not per Discord account: max active rentals, a cooldown between
  rentals and a daily cap, each overridable **per vehicle**.
- **Where** matters too — rentals can be restricted to certain map **sectors**, or blocked in some.
  While the map calibration is unavailable the rule is skipped rather than enforced blindly.
- Before removing a vehicle the plugin **checks it still exists**, so an expiry never claims to have
  removed something that was already destroyed.
- Everything the player sees in game is a **template you can rewrite** — any language, any wording.

## Requirements
- The **SSA Bridge** plugin — spawning, charging, chat messages and the in-game commands all go
  through it. It's a dependency.
- The **Discord Embed Editor** plugin for the rental menu embed. Also a dependency.
- Manager **4.0.0+** (in-game chat commands). Sector rules need the live map calibration; without it
  they simply don't restrict anything.

## Configuration
Everything is configured from the plugin's **admin tab** (🚗 Vehicle Rental):
- **Settings** — on/off, free mode, the Discord channel and button, max active rentals, cooldown,
  daily limit, extensions, reminder time, and the spawn/remove command templates.
- **In-game** — whether to message players in game and on which chat channel, whether the commands
  are registered and what they're called, early return with an optional refund %, and the allowed or
  blocked sectors.
- **In-game messages** — every player-facing line, with `{player} {vehicle} {duration} {price}
  {left} {sector} {cmd} {list}` tokens.
- **Vehicles** — each vehicle's spawn code, its rental plans (duration + price in money or gold), and
  per-vehicle overrides of the global limits.

## Good to know
- A vehicle is matched to the rental by finding the **nearest newly spawned one**. If that lookup
  fails the rental still works, but the vehicle won't be auto-removed at expiry — the log says so.
- The spawn is offset ~3 m to the side, so the vehicle never lands on the player.
- Turning in-game commands **off** stops the plugin registering them at all; the manager then leaves
  the chat prefix alone entirely.
- A refund on early return is only paid when a vehicle was actually reclaimed.
- Rentals are keyed to the SCUM character. Renting from Discord needs a **linked** account; renting
  from chat does not.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
