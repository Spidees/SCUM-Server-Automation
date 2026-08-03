# Environment Control — Wetness & Dirt

Tune how **wet** and **dirty** your players get, and how fast they **dry off** — so survival feels the
way you want it. Want a brutal, always-soaked-and-filthy server? Or a comfortable one where players dry
off quickly and stay clean? A few simple numbers do it.

Runs on the **server**, applies to **everyone**, and changes take effect **live** (no restart needed).

## Settings
Everything is in one text file: **`Mods/SSAEnv/env.txt`** (inside the server's UE4SS mods folder).
Every value is a **multiplier** of the game's normal behaviour — `1.0` = unchanged.

- `drying_multiplier` — how fast players/clothes dry. Higher = dries **faster**.
- `wetting_multiplier` — getting wet from water & wet ground. Lower = wet **slower**.
- `rain_multiplier` — getting wet from **rain**. Lower = wet **slower**.
- `dirtiness_multiplier` — how fast you get dirty. Lower = dirty **slower** (`0` = never).
- `surface_wetness_multiplier` — how much wet ground adds wetness. Higher = more.
- `debug` — `1` prints diagnostic lines to the log, `0` = silent.

### Example — more forgiving survival (default)
```
drying_multiplier = 3.0
wetting_multiplier = 0.5
rain_multiplier = 0.5
dirtiness_multiplier = 0.3
surface_wetness_multiplier = 1.0
debug = 0
```
Players dry off 3× faster, get wet at half speed, and get dirty much slower.

### Example — stay clean & dry
```
drying_multiplier = 6.0
wetting_multiplier = 0.25
rain_multiplier = 0.25
dirtiness_multiplier = 0.0
debug = 0
```

### Example — harsh & miserable
```
drying_multiplier = 0.5
wetting_multiplier = 2.0
rain_multiplier = 2.0
dirtiness_multiplier = 2.0
```

## Good to know
- Applies globally to all players; it doesn't touch save files or the database.
- Edits are read automatically within a few seconds — no server restart required.
- Requires **UE4SS** (installed automatically as a dependency).

## Requirements
- UE4SS runtime (dependency).

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
