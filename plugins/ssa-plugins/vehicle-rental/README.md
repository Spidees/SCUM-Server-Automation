# Vehicle Rental System

Players **rent a vehicle straight from in-game chat**, or from a **Discord menu** if you run a bot, pay
with their **in-game money or gold**, and get it **spawned next to them**. The plugin runs the whole
rental: reminders, extensions, early return and **removing the vehicle when the time is up**. No admin
has to be online, and an **Activity screen** shows every rental, refusal and refund as it happens.

## How it works
- **Chat commands** do everything: `/rent`, `/myrent`, `/extend` and `/return`. `/rent` on its own
  lists the vehicles and plans on offer by number.
- **Every vehicle and every plan has its own switch.** A switched-off one is not listed in chat or in
  Discord and cannot be rented or extended; rentals already running are left alone.
- **Discord is optional.** A bot adds a button, vehicle and plan menu, a confirmation DM and a reminder
  DM with an **Extend** button. Both share the same limits, prices and rentals.
- **The vehicle is spawned first, then charged.** If the spawn fails or the game cannot confirm it,
  nobody pays. If the charge fails, the vehicle is taken back.
- **Limits count per player**, across chat and Discord: active rentals, a wait between rentals and a
  daily cap. A per-vehicle limit narrows the server-wide one; the stricter rule wins.
- **Time windows** limit when rentals, a vehicle or a single plan are available, such as a happy hour
  or a weekend price. They run on the **server's real clock**, not in-game time.
- **Sector rules** allow or block renting in chosen map sectors.
- The vehicle is spawned **where the player stands now**, read from the running game; the last
  server save is used only when the game cannot say.
- The rented vehicle is identified as **the one that just appeared**, never simply the nearest, so a
  player's own parked car is never removed at expiry.
- **A rental that runs out while the game is down waits**, and its vehicle is removed as soon as the
  game answers again.

## Requirements
- The **SSA Bridge** plugin, for spawning, charging, chat messages and the commands.
- Optional: the bridge module **Live player data** with *Read live player data*, *Money, gold and
  account number* and *Position, facing and speed*, so the balance check and the spawn position use
  the running game instead of the last save.
- Optional: the bridge module **Live vehicles** with *Report live vehicle state*, so the spawned
  vehicle is identified, and found again at return or expiry, in the running game. The plugin's card
  on the **Plugins** page lists these switches and offers to switch them on.
- Optional: the **Discord Embeds** plugin, to design the Discord menu embed.
- Manager **6.0.0+**.

## Configuration
Everything is configured from the plugin's **admin tab** (🚗 Rentals), in five screens. All of it can
be set with the server stopped; only the live counts, the rentals and the log wait for a running game.

- **Fleet**: every vehicle with its switch, name, spawn code and picture, its plans (minutes and a
  price in money or gold, each with its own switch and time window), its own limits and its hours.
  Search, filter by on, off or needs attention, pages, and ticks to switch on, switch off or remove
  several vehicles at once.
- **Rentals**: what is out now, with time left, price paid and whether the vehicle was identified,
  and the finished rentals with how each ended. Tick rentals to end several at once.
- **Activity**: the live status (game server, SSA Bridge, what is being processed, the expiry check)
  and a log of every rental, extension, return, expiry and admin ending, each refusal with its
  reason and the sentence the player read, and the money that moved. Filters, search and pages.
- **Messages**: every line a player sees, in chat and in Discord, with a tab per language. Search,
  groups, and a filter for the lines you changed. An empty line uses the built-in wording.
- **Settings**: *Rentals enabled*, *Free rentals*, *Must be online to rent or extend*, *Allow
  extensions*, *Allow returning early* and *Check the vehicle still exists*; each limit with its own
  switch (active rentals per player, wait between rentals, rentals per day, extensions per rental,
  reminder before the end, refund on early return); rental hours; the in-game messages switch, chat
  channel, commands switch and the four command words; map sectors; the Discord channel, button,
  menu embed and **Save & post menu**; and the spawn and remove command templates.

## Good to know
- **A rented vehicle is not locked to the renter.** Anyone who reaches it first can drive it away.
- Money is taken from the player's **bank account**, gold from their gold balance.
- **Nobody in the world means no rental**: without a player to confirm the spawn, the rental is
  refused rather than charged.
- If the vehicle cannot be identified after the spawn, the rental still runs but the vehicle is **not
  removed** at expiry. The Rentals screen shows *not captured*, the Activity log records it and an
  admin alert goes out. A spawn code that stopped working after a game update looks the same.
- **Ending a rental from the panel pays no refund.** A player returning one with `/return` gets the
  *Refund on early return* percentage, which is off by default. The player is told an admin ended it.
- **Rentals enabled** off stops renting and extending. Returning is always allowed.
- `/extend` and `/return` act on the running rental that runs out first.
- A command renamed in Settings is the word every message names, in every language.
- Two commands cannot share a word, and a command is one word; the save says so.
- Renting from Discord needs a **linked** account; renting from chat does not.
- Discord menus show at most **25 vehicles** and **25 plans**; the rest stay rentable from chat. The
  Fleet screen warns about this, and about vehicles with no spawn code or no plans.
- A plan with no duration is sold as **60 minutes**. A reminder set to off sends no reminder.
- Sector rules need the map calibration. While it is unavailable, renting is allowed everywhere and
  the tab says so.
- **Each player reads every line in the language they chose** with `/lang`, on the Field Console or
  on Discord, else the Default tab. The channel's menu and button stay in one language.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
