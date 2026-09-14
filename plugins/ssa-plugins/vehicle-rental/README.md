# Vehicle Rental System

Players **rent a vehicle straight from in-game chat**, or from a **Discord menu** if you run a bot, pay
with their **in-game money or gold**, and get it **spawned next to them**. The plugin runs the whole
rental: reminders, extensions, early return and **removing the vehicle when the time is up**. No admin
has to be online.

## How it works
- **Chat commands** do everything: `/rent`, `/myrent`, `/extend` and `/return`. `/rent` on its own
  lists the vehicles and plans by number.
- **Discord is optional.** A bot adds a button, vehicle and plan menu, a confirmation DM and a reminder
  DM with an **Extend** button. Both share the same limits, prices and rentals.
- **The vehicle is spawned first, then charged.** If the spawn fails or the game cannot confirm it,
  nobody pays. If the charge fails, the vehicle is taken back.
- **Limits count per player**, across chat and Discord: active rentals, a cooldown and a daily cap.
  A per-vehicle limit narrows the server-wide one; the stricter rule wins.
- **Time windows** limit when rentals, a vehicle or a single plan are available, such as a happy hour
  or a weekend price. They run on the **server's real clock**, not in-game time.
- **Sector rules** allow or block renting in chosen map sectors.
- The rented vehicle is identified as **the one that just appeared**, never simply the nearest, so a
  player's own parked car is never removed at expiry.

## Requirements
- The **SSA Bridge** plugin, for spawning, charging, chat messages and the commands.
- Optional: the bridge module **Live player data** with *Read live player data* and *Money, gold and
  account number*, so the balance check uses the running game instead of the last save. The plugin's
  card on the **Plugins** page lists them and offers to switch them on.
- Optional: the **Discord Embeds** plugin, to design the Discord menu embed.
- Manager **5.16.2+**.

## Configuration
Everything is configured from the plugin's **admin tab** (🚗 Rentals):

- **Settings**: *Rentals enabled*, *Free rentals (no charge)*, *Must be online to rent or extend*,
  *Allow extensions*, the Discord *Rental menu channel* and *Button label*, *Max active rentals /
  player* (default 1), *Cooldown between rentals (min)*, *Daily limit / player*, *Max extensions /
  rental*, *Remind before expiry (min)* (default 10), the spawn and remove command templates, and
  *Rental hours*.
- **In-game**: *Send messages in-game*, *Enable in-game commands*, *Allow returning early*, *Check the
  vehicle still exists*, *Chat channel*, *Refund on early return (%)* (default 0), the four command
  names, and *Allowed sectors* / *Blocked sectors*.
- **In-game messages**: every line a player sees, with `{player} {vehicle} {duration} {price} {left}
  {sector} {cmd} {list}` tokens.
- **Vehicles**: each vehicle's name, spawn code, image, its rental plans (minutes plus a price in
  money or gold), its own time window and per-vehicle limits.
- **Rental menu embed**: the Discord menu message, with **Save & post menu**.
- **Active rentals** and **Finished rentals**: who has what, how long is left, and how each one ended.
  An active rental can be ended from here.

## Good to know
- **A rented vehicle is not locked to the renter.** Anyone who reaches it first can drive it away.
- Money is taken from the player's **bank account**, gold from their gold balance.
- **Nobody in the world means no rental**: without a player to confirm the spawn, the rental is
  refused rather than charged.
- If the vehicle cannot be identified after the spawn, the rental still runs but the vehicle is **not
  removed** at expiry. The table shows *not captured* and an admin alert goes out. A spawn code that
  stopped working after a game update looks the same, so check the code.
- **Ending a rental from the panel pays no refund**; a player returning one with `/return` does. The
  player is told in game that an admin ended it.
- `/extend` and `/return` act on the rental that runs out first.
- **Must be online** covers renting and extending. Returning is always allowed.
- Renting from Discord needs a **linked** account; renting from chat does not.
- Discord menus show at most **25 vehicles** and **25 plans**; the rest stay rentable from chat. The
  tab warns about this, and about vehicles with no spawn code or no plans.
- A plan with no duration is sold as **60 minutes**.
- Sector rules need the map calibration. While it is unavailable, renting is allowed everywhere and
  the tab says so.
- Changing a command name or switching the commands off takes effect when you save.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
