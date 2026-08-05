# Mine Protection

Punishes players who **arm a mine or trap outside their (or their squad's) flag area**. The moment a
mine is armed in the open, the placer is teleported onto their own armed mine — it detonates.

## How it works
- Every few seconds the plugin reads the manager's own **world scan** for placed **armed** mines/traps
  of the watched types and **who armed each one** (the arming player, including a buried mine's placer).
  This is the same canonical parsing the live map uses, so the armed state and placer are detected
  reliably — no missed offences.
- **"Inside the flag"** uses the **real flag rectangle**. A mine is legal if it falls inside any base
  owned by the placer **or any squadmate**, so a squad member arming inside a teammate's base is
  **never** punished.
- Anything armed outside that rectangle is enforced via the **SSA Bridge**.
- **Escalation:** the first *N* offences per player are a chat **warning**; after that the placer is
  **teleported onto their armed mine**. The teleport runs *through* the placer, so it never depends on
  fragile name/steamid targeting.
- **Offline placers** are retried every scan **and the instant they reconnect**, so an offence is never
  silently dropped while someone is offline.
- **State survives restarts:** handled mines, per-player offence counts and the recent-actions history
  are saved in the plugin store — a restart never re-punishes a mine it already handled. (Only the very
  first scan seeds — pre-existing mines are never punished.)

## Requirements
- The **SSA Bridge** plugin (for the teleport + chat message). It's a dependency.
- Manager **4.0.0+** (uses the live-map world scan for reliable mine detection).

## Configuration
Everything is configured from the plugin's **admin tab** (💣 Mine Protection):

- **Watched mines & traps** — an illustrated picker with an icon per type and how many are **placed /
  armed on your server right now**. Toggle exactly what to enforce (quick buttons for *Explosives only*,
  *Select all*, *Clear*). Explosive traps are watched by default; C4 (a raiding tool) is not.
- **Action** — teleport the placer onto their mine, or warn only.
- **Warnings before action** — how many chat warnings a player gets before the penalty kicks in
  (0 = act on the first offence).
- **Only act while online** — only enforce while the placer is online (needed to teleport them);
  otherwise the mine is enforced the moment they return.
- **Extra margin** — tolerance beyond the exact flag rectangle (default 0).
- **Scan interval** — how often to scan (applies immediately on save, no restart).
- **Messages** — the warning and penalty chat lines sent to the offender, in any language.
- **Exemptions** — players who are never punished; add a Steam ID or pick from the online players.
- **Placed mines (live)** — a table of every armed watched mine on the server right now: who armed it,
  where, whether it’s inside a flag, its enforcement status and that player’s offence count.
- **Recent actions** — a live feed of every warning/teleport, with buttons to reset warnings or clear
  the history.

## Good to know
- Pre-existing mines are never punished — only ones armed after the plugin is watching.
- The placer is whoever **armed** the mine, not whoever crafted or placed it unarmed.
- The status header shows, live: whether it's active, the server state, how many mines are tracked and
  how many players have been flagged.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
