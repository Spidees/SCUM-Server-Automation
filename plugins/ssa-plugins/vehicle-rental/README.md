# Vehicle Rental System

Players rent vehicles through the Discord bot — pick a vehicle, choose a duration, pay in-game
**money or gold**, and the bot spawns it and manages the whole lifecycle. No admin interaction.

## For the admin — configure in the panel
Enable the plugin → a **Rentals** tab appears. Set:
- **Channel** for the rental menu, and the **button label**.
- **Vehicles**: name + spawn code + optional image, each with one or more **plans** (duration +
  money/gold price).
- **Max rentals per player** and **reminder lead time**.
- **Spawn / remove command templates** — placeholders `{code} {x} {y} {z} {steamid} {vehId}`. Set them
  to match your server / bridge (payment itself uses the built-in `#ChangeCurrencyBalance`).
- The **menu embed** — designed with the embedded **Embed Editor**.
Then **Save & post menu**. A live list of active rentals is shown below.

## For players (automatic)
1. Click **Rent a vehicle** on the menu → pick a vehicle → pick a plan.
2. The bot resolves your **linked SCUM character** (link it on the Field Console first), charges the
   price, and **spawns the vehicle at you**.
3. You get a **confirmation** (vehicle, duration, expiry). The bot sends an **expiry reminder** with an
   **Extend** button, and when the rental ends it **removes the vehicle** and notifies you.

## Requirements
Depends on **`embed-editor`** (menu design) and **`ssa-bridge`** (in-game spawn/commands), and needs
active **Premium**. Rentals are stored in the plugin's own SQLite (`host.sqlite`).

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
