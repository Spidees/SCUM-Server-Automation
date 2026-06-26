# Player Management & Bans

In the admin dashboard, open the **Players** screen.

## Search

One box, three modes (auto-detected from what you type):

- **Name** — partial match.
- **Steam ID** — exactly 17 digits.
- **IP address** — anything containing a dotted number (matched against known profiles).

You can also reach a player by clicking them in **Online players** (dashboard) or in a **linked
account** row on the **Discord** screen.

## Profile

Clicking a result opens the full profile:

- Identity: Steam ID, **IP**, squad, Discord link, last login / logout, online state, ban badge.
- Full stats: kills, deaths, K/D, PvP kills/deaths, headshots, puppet/animal/firearm/melee/archery
  kills, longest kill, accuracy, survived, distance, looted, locks, crafted, fish, fame, money,
  playtime, wounds patched, events won.

## Banning

- **Ban** writes the player's Steam ID to **`BannedUsers.ini`**, and stores the **name + note +
  timestamp** in the app's own database so the ban list is readable.
- The **Banned players** section lists everyone (name · Steam ID · note · when) with **Unban**.

> ⚠️ Bans are **file-based**: SCUM reads `BannedUsers.ini` at startup, so a ban (or unban) takes
> effect **after the next server restart**. There is no live kick — the UI says so.

## How it maps to game files

- `BannedUsers.ini` lives in `…/SCUM/Saved/Config/WindowsServer/`. It only stores Steam IDs.
- You can also edit it (and the admin / exclusive / whitelist lists) directly on the
  **Game Settings** screen.

Next: [FAQ](FAQ)
