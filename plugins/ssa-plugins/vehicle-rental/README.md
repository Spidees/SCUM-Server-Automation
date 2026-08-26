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
  rentals and a daily cap. A per-vehicle limit **narrows** the server-wide one — both are checked, and
  the stricter answer wins.
- **One rental at a time is actually one.** Two clicks on the same menu, or Discord and chat at once,
  cannot both slip past the limit before either has been recorded.
- **Where** matters too — rentals can be restricted to certain map **sectors**, or blocked in some.
  While the map calibration is unavailable the rule is skipped rather than enforced blindly.
- Before removing a vehicle the plugin **checks it still exists**, so an expiry never claims to have
  removed something that was already destroyed.
- Everything the player sees in game is a **template you can rewrite** — any language, any wording.
- **Active rentals are yours to manage.** The admin tab lists who has what and how long is left, and
  ends any of them on the spot — the vehicle is removed and the player is told in game. Finished
  rentals stay in a searchable list that says how each one ended.
- **The panel tells you what Discord will drop.** More than 25 vehicles or 25 plans, a vehicle with no
  spawn code, a vehicle with no plans — each is said before a player runs into it.

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
- A rented vehicle is identified by **what appeared that was not there a moment before** — never
  simply "the nearest one", which is usually the player's own parked car. It also never takes a
  vehicle another rental already holds. If it cannot be identified the rental still works, but the
  vehicle is **not** removed at expiry; the panel says *not captured*, the log says why, and an admin
  alert goes out — because that is also what a **stale spawn code** looks like after a game update,
  and in that case the player has paid for a vehicle that never appeared.
- **The rental is confirmed straight away.** Identifying the vehicle reads a world snapshot that
  refreshes on its own clock and can take twenty seconds, so it happens behind the confirmation
  rather than in front of it. Ending a rental before that finishes waits for it, so returning
  immediately still removes the vehicle and still pays the refund.
- Prices are taken from the player's **bank account**, not the money they are carrying. If they have
  enough on them, the refusal says to deposit it.
- The spawn is offset ~3 m to the side, so the vehicle never lands on the player.
- Turning in-game commands **off** stops the plugin registering them at all; the manager then leaves
  the chat prefix alone entirely. Renaming one, or switching them off and on, takes effect **when you
  save** — no manager restart.
- A refund on early return is only paid when a vehicle was actually reclaimed.
- The in-game list fits **the game's chat**, which cuts a long line off without saying so. With more
  vehicles than fit, the reply shows what it can and says how many are left.
- The **rental menu is posted whole**: whatever you gave the menu embed in the editor — text above it,
  your own buttons and menus, extra embeds — goes out with it, and the Rent button always comes first.
- Rentals are keyed to the SCUM character. Renting from Discord needs a **linked** account; renting
  from chat does not.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
