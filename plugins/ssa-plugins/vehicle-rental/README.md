# Vehicle Rental System

Players rent a vehicle **straight from in-game chat** — and from a **Discord menu too, if you run a
bot** — pay with their own in-game money or gold, and get it spawned next to them. The plugin runs the whole rental from there —
reminders before it runs out, extensions, early return, and removing the vehicle when the time is
up. **No admin has to be online**, and a player never has to leave the game to do any of it.

## How it works
- **Discord is optional.** The engine is the chat commands — `/rent`, `/myrent`, `/extend`,
  `/return` — and a bot only adds a second front end: a button → vehicle → plan menu, a DM
  confirmation and a DM reminder with an Extend button. Limits, prices and the lifecycle are shared,
  so the two can't drift apart, and a server with no bot loses nothing else.
- **Vehicles and plans can be limited to time windows** — a happy hour, a weekend rate, a cheap
  overnight plan. A price that changes by time of day is simply two plans on the same vehicle, one
  windowed and one not. Windows run on the **server's real clock, not in-game time**, and every
  screen and refusal says so.
- **The vehicle is spawned first, and only then charged.** If the bridge is offline, the spawn fails,
  or the game **cannot confirm** the spawn happened, nobody is billed. If the *charge* fails, the
  vehicle is **taken back** — a rental never ends with a free vehicle or a payment for nothing.
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
- The **Discord Embed Editor** plugin *only* if you want to design the Discord menu embed — it is an
  **optional** dependency and nothing else needs it. Time windows need manager **5.3.0+**.
- Manager **4.0.0+** (in-game chat commands). Sector rules need the live map calibration; without it
  they simply don't restrict anything.

## Configuration
Everything is configured from the plugin's **admin tab** (🚗 Vehicle Rental):
- **Settings** — on/off, free mode, max active rentals, cooldown, daily limit, extensions, reminder
  time, the spawn/remove command templates, the rental hours, and (if you run a bot) the Discord
  channel and button.
- **In-game** — whether to message players in game and on which chat channel, whether the commands
  are registered and what they're called, early return with an optional refund %, and the allowed or
  blocked sectors.
- **In-game messages** — every player-facing line, with `{player} {vehicle} {duration} {price}
  {left} {sector} {cmd} {list}` tokens.
- **Vehicles** — each vehicle's spawn code, its rental plans (duration + price in money or gold), and
  per-vehicle overrides of the global limits.

## Good to know
- **A rented vehicle is not locked to the renter.** It is spawned next to them, and anybody who
  reaches it first can drive it away — the rental is a timer and a bill, not a claim of ownership.
  The plugin does not try to hand the vehicle over, and that is deliberate: the game's owner and
  access fields on a vehicle are **not saved**, so a handover would hold until the next server
  restart and then quietly revert. Selling something that stops being yours at 04:00 is worse than
  not selling it. Put rentals somewhere players can see their vehicle if that matters on your server.
- **Nobody in the world means no rental.** If the bridge has to dispatch the spawn with no player to
  run it through, the game returns nothing at all — not "it worked" and not "it failed" — so the
  rental is refused rather than charged for a vehicle that may not exist. The same rule covers the
  charge, the refund and the removal: an action the game did not confirm is treated as one that did
  not happen, and the log says which.
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
- Prices are taken from the player's **bank account** — the balance the game's own currency commands
  move — and that is the balance the refusal quotes.
- **The balance is read from the running game, not the last save.** The saved database is only as
  current as your save interval, which is long enough for a player to be paid and refused in the same
  minute. Reading it live needs the bridge's **Live data → Money, gold and account number** switch,
  which ships **off**. The plugin **declares** that switch, so its card in the panel shows whether it
  is on and turns it on for you in one click — it never switches anything on by itself. With it off
  renting still works, but the check falls back to the saved figure and the refusal says plainly that
  it is the saved one.
- The spawn is offset ~3 m to the side, so the vehicle never lands on the player.
- Turning in-game commands **off** stops the plugin registering them at all; the manager then leaves
  the chat prefix alone entirely. Renaming one, or switching them off and on, takes effect **when you
  save** — no manager restart.
- A refund on early return is only paid when a vehicle was actually reclaimed.
- **Ending a rental from the panel pays no refund** — a player returning one themselves does. The
  confirmation says so before you click, and the player is told in game that an admin ended it,
  rather than being left to think their hour ran short.
- The in-game list fits **the game's chat**, which cuts a long line off without saying so. With more
  vehicles than fit, the reply shows what it can and says how many are left.
- The **rental menu is posted whole**: whatever you gave the menu embed in the editor — text above it,
  your own buttons and menus, extra embeds — goes out with it, and the Rent button always comes first.
- Rentals are keyed to the SCUM character. Renting from Discord needs a **linked** account; renting
  from chat does not.
- **Must be online** covers renting *and* extending — otherwise a player could park the vehicle, log
  out and keep buying time from Discord. **Returning is always allowed**, so nobody is ever stuck
  paying for a vehicle they are trying to hand back.
- **Editing the vehicle list closes the menus players already have open.** A Discord menu remembers
  which vehicle and which plan it was showing, so deleting or re-pricing one while someone is
  choosing tells them to reopen the menu instead of quietly renting them the neighbouring vehicle at
  the neighbouring price. Simply **reordering** the list is safe.
- A spawn code has to be a real blueprint id (`BPC_…`). The search box only saves what you **pick
  from the list** — typing a word and clicking away no longer saves that word as the code, and the
  warnings above the vehicle list name any code that does not look like one.
- **Sector rules depend on the live map, and the panel says whether that is working.** Without map
  calibration the plugin cannot tell which sector a player is in, so renting is allowed everywhere
  rather than blocked for a reason players cannot see — the settings page now states which of those
  two you are actually getting, instead of leaving you to guess.
- A plan with a **negative** duration is refused rather than sold — it would expire the instant it
  was paid for. A blank or zero one is still sold as 60 minutes, exactly as it always has been; the
  panel says so rather than changing what your players are already buying.
- **A restart in the ~20 seconds after a spawn loses the vehicle's identity.** That rental's vehicle
  is then never removed automatically. It cannot be recovered — guessing at "the nearest vehicle" is
  what this plugin refuses to do everywhere else — so it is **reported at startup** in the log and as
  an admin alert, naming the rentals concerned, instead of quietly never happening.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
