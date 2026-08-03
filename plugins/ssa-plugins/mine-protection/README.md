# Mine Protection

Punishes players who **arm a mine or trap outside their (or their squad's) flag area**. The moment a
mine is armed in the open, the placer is teleported onto their own armed mine — it detonates.

## How it works
- Every few seconds the plugin checks placed **armed** mines/traps of the watched
  classes and finds **who armed each one** (the arming player).
- "Inside the flag" uses the **real flag rectangle**. A mine is legal if it falls inside any base owned by the
  placer **or any squadmate**, so a squad member arming inside a teammate's base is **never** punished.
- Anything armed outside that rectangle triggers the penalty via the SSA Bridge.
- **State survives restarts:** the set of already-handled mines and already-warned players is saved in the
  plugin store, so a restart never re-warns someone who was already warned, and never re-seeds/re-punishes
  mines it already knows about. (Only the very first run seeds — pre-existing mines are never punished.)

## Requirements
- The **SSA Bridge** plugin (for the teleport + chat message). It's a dependency.

## Configuration
Configure everything from the plugin's **admin tab** (💣 Mine Protection). Settings are saved in the
plugin's own store; sensible defaults apply out of the box.

- **Enabled** — master on/off.
- **Scan interval** — how often to scan for new armed mines (default every 6 s).
- **Margin** — extra tolerance around the real flag rectangle (default 0 = exact flag area).
- **Watched classes** — which mine/trap types to watch (e.g. improvised mines, claymores, pressure-cooker bombs).
- **Action** — teleport the placer onto their mine, or just warn them in chat.
- **Warn first** — the first offence per player is a warning; the next one acts.
- **Require online** — only act while the placer is online (needed to teleport them); otherwise the mine is re-checked when they return.
- **Exemptions** — Steam IDs that are never punished.
- **Messages** — the in-game chat lines sent to the offender (warning and penalty), in any language.

## Good to know
- Pre-existing mines are never punished — only ones armed after the plugin is watching.
- The placer is whoever **armed** the mine, not whoever crafted or placed it unarmed.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
