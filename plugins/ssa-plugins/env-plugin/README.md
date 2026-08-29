# Environment Control — Wetness & Dirt

Tunes how **wet** and **dirty** players get and how fast they **dry off**, so survival feels the way
you want it. A brutal, always-soaked server, or a comfortable one where people dry quickly and stay
clean — a handful of numbers decides. Runs on the **server**, applies to **everyone**, and every
change takes effect **live**, without a restart.

## How it works
- Every setting is a **multiplier of the game's own value**, not an absolute number. `1.0` changes
  nothing, `2.0` doubles, `0.5` halves.
- The game's own values are **recorded to a file the first time the mod runs**
  (`Mods/SSAEnv.defaults.txt`) and every multiplier is applied to *that* from then on. Without it a
  mod like this drifts: it re-reads a value it wrote itself, multiplies again, and the number climbs
  every time until the weather simulation stops making sense.
- Multipliers are **capped at 50**. Beyond that you aren't tuning the simulation, you're breaking it,
  and the game gives no sign that it happened.
- `env.txt` is re-read every few seconds, so edits apply while the server runs.
- Everything the mod touches is done on the game thread, which is where the engine expects it.

## Requirements
- **UE4SS** (installed automatically as a dependency).
- No manager version requirement to *run* — this is a game-side mod, not a manager plugin, and it
  calls nothing in the manager.
- **Manager 5.2.0+ to keep your `env.txt` across a plugin update.** Before 5.2.0 the manager copied a
  plugin's whole payload onto the server on every update, `env.txt` included, so an update put the
  shipped defaults back over whatever you had tuned — silently, because the copy succeeded. From
  5.2.0 the file named in the plugin's manifest is *merged* instead: your lines are kept and any new
  setting an update adds is appended. On an older manager, keep a copy of your numbers before
  updating.

## Configuration
There is no admin tab for this one. Everything lives in a single text file on the server:

```
<server>\SCUM\Binaries\Win64\Mods\SSAEnv\env.txt
```

| Setting | What it does |
|---|---|
| `enabled` | `1` = on. `0` = put the game's own values back and stop changing anything |
| `drying_multiplier` | how fast players and clothes dry. Higher = dries **faster** |
| `wetting_multiplier` | getting wet from water and wet ground. Lower = wet **slower** |
| `rain_multiplier` | getting wet from **rain**. Lower = wet **slower** |
| `dirtiness_multiplier` | how fast you get dirty. Lower = slower, `0` = never |
| `surface_wetness_multiplier` | how much wet ground adds wetness. Higher = more |
| `debug` | `1` writes diagnostics to the UE4SS log, `0` = silent |

### More forgiving survival (the shipped default)
```
drying_multiplier = 3.0
wetting_multiplier = 0.5
rain_multiplier = 0.5
dirtiness_multiplier = 0.3
surface_wetness_multiplier = 1.0
```
Players dry three times faster, get wet at half speed and get dirty much more slowly.

### Stay clean and dry
```
drying_multiplier = 6.0
wetting_multiplier = 0.25
rain_multiplier = 0.25
dirtiness_multiplier = 0.0
```

### Harsh and miserable
```
drying_multiplier = 0.5
wetting_multiplier = 2.0
rain_multiplier = 2.0
dirtiness_multiplier = 2.0
```

### Turning it off

**Usually you don't have to do anything.** Part of what this mod changes lives in a shared game
asset that is loaded fresh on every server start, so disabling the mod and letting the server
restart normally already puts the game back the way it was.

Only if you want it back to normal **without** restarting the server:

```
enabled = 0
```

Wait about ten seconds — that's one poll — and the game's own values are back. Then you can disable
or remove the mod. (`restore = 1` does exactly the same and is kept for older setups.)

The order matters because disabling a plugin in the panel **deletes its files immediately**, and a
mod that no longer exists cannot undo anything. That is the whole reason this switch exists.

**If you later switch the plugin back on, set `enabled = 1` again.** From manager 5.2.0 your
`env.txt` is kept when the plugin is disabled and handed straight back when it is re-enabled —
which is what you want for your multipliers and is a trap for this one line, because the `enabled =
0` you typed to hand the game back comes with it. The mod would install, run, change nothing, and
give no sign why.

## Good to know
- Applies to every player. It touches no save files and no database.
- `Mods/SSAEnv.defaults.txt` holds the game's original values. **Don't delete it while the mod is
  running**: the next start would record the mod's own numbers as if they were the game's. If you do
  need a clean slate, disable the mod, restart the server, then delete the file.
- The defaults file sits *next to* the mod folder on purpose, so updating the plugin can't wipe it —
  that has always been true, because an update only ever touches the mod folder itself. Your
  `env.txt` lives *inside* it and is a different case: it survives an update from manager **5.2.0**
  onwards, and was overwritten by every update before that. See Requirements.
- After a SCUM update changes the game's own balance, delete the defaults file the safe way above so
  the new values get recorded.
- With `debug = 1` the first pass reports whether the settings actually reached the game — worth
  checking once after installing. It covers the drying, wetting and dirt values, each of which is
  written and then **read back**. It does **not** cover `rain_multiplier`: that one rescales the
  points of a curve asset, and there is no read-back for it, so a rain write that did not land looks
  the same as one that did. If rain feels unchanged, that is where to look first.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
