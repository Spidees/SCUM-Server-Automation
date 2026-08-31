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
- **The last save is not good enough to detonate somebody on.** Both facts above come out of the game
  database, which is the state as of the last save — so a mine defused since then still reads *armed*,
  and a player who joined a squad since then is not in it yet. Immediately before a teleport, and only
  then, the plugin asks the **running game**: is this trap still armed, and who is in this player's
  squad now? A live *"no longer armed"* cancels the teleport; a live squadmate whose flag covers the
  mine makes it legal. Neither check can ever create an offence — they can only call one off.
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
- **Two in-game modules are optional but strongly recommended**, because they are what let the plugin
  check the *running game* rather than the last save before it detonates anything. Both are off until
  you turn them on, in **Settings → Bridge**:
  - **Read live inventories** (Inventories) — confirms a mine is **still armed** at the moment of the
    teleport. Without it, `armed` is whatever it was at the last save.
  - **Report live squads** + **Include the member list** (Squads) — confirms who is in the placer's
    squad **right now**, so a player who joined a squad since the last save is not punished for a mine
    inside their new teammate's base.
  With either switched off the plugin behaves exactly as it always has and **says so on its own tab**,
  in the module's own words — it never silently falls back.
- Manager **5.11.0+**, which is what the manifest enforces. The floor is not a formality: before
  5.0.3 the manager answered "is this mine inside its
  placer's flag?" with a plain yes/no, and a moment when the game database could not be read came
  back as **no**. This plugin acts on a no by teleporting somebody onto a live mine. From 5.0.3 that
  question has a third answer — *cannot say* — and the plugin waits for the next scan instead.

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
- **Placed mines (live)** — a table of every watched mine on the server right now: who armed it,
  where, whether it’s inside a flag, its enforcement status and that player’s offence count. Two of
  those can be **unknown** rather than yes or no — *Armed state unknown* and *Flag unknown* — and the
  table says so rather than showing them as “not armed” and “outside the flag”. Those rows are
  exactly the ones the plugin is declining to act on, so reading them as a plain no would look like
  an offence that never got enforced.
- **Recent actions** — a live feed of every warning/teleport, with buttons to reset warnings or clear
  the history.

## Good to know
- **Offences can be forgiven one player at a time.** The count only ever goes up, and *Reset
  warnings* clears everybody, which is rarely what you want. Each row in the mines table has its own
  **Forgive**: it gives that player their warnings back and leaves every other record intact.
- **A warning only counts once it has arrived.** If the player is not there to read it, the mine is
  left for the next scan instead of being marked dealt with — otherwise their *next* mine would get
  the real punishment for a warning they never saw, which is exactly what warning first exists to
  prevent. (Only reachable with **Only act while the placer is online** switched off.)
- **It never punishes on a guess.** Whether a mine sits inside its placer's own flag is answered from
  the game database, while the mine itself comes from the live world scan — so one can be readable
  while the other is not. "Cannot say" is now its own answer and it means *do nothing*: the mine is
  simply re-checked on the next scan. Read as "outside their flag", a database hiccup used to
  teleport a player onto a mine they had legally placed inside their own base. If that state lasts,
  the manager log says so once an hour, because a protection plugin quietly protecting nothing is
  its own kind of failure.
- Pre-existing mines are never punished — only ones armed after the plugin is watching.
- The placer is whoever **armed** the mine, not whoever crafted or placed it unarmed.
- The status header shows, live: whether it's active, the server state, how many mines are tracked and
  how many players have been flagged.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
