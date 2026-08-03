# UE4SS Example Mod

A minimal, **safe** reference **UE4SS (Lua) mod** for SCUM Server Automation. It runs inside the game
process and reads live Unreal objects the manager can't reach from outside. This one is deliberately
read-only — it counts the player objects each tick and logs the number — so it's a clean skeleton to
copy.

> UE4SS mods are for what only in-process Lua can do — reading/changing live game objects. For config,
> Discord, scheduling and persistence, pair it with a **manager plugin** (see `examples/hello-plugin`).

## What it shows

- The **UE4SS mod layout** the manager deploys and loads.
- Reading a **config file** (`example.txt`) live from Lua.
- A **guarded periodic loop** (`LoopAsync`) that finds live objects (`FindAllOf`) safely.
- Logging to the UE4SS console (`print`).

## Anatomy

```
ue4ss-example/
  plugin.json                       manifest (type "ue4ss") — at the root
  README.md                         shown in the card's "Readme" viewer
  icon.svg                          card icon
  payload/
    Mods/
      SSAExample/                    <- this folder name is "modName" in the manifest
        Scripts/main.lua            the mod entry (UE4SS loads Scripts/main.lua)
        enabled.txt                 present = enabled (UE4SS convention)
        example.txt                 your editable config
```

Everything under `payload/Mods/<modName>/` is deployed into the game's UE4SS `Mods` folder. The manager
manages `enabled.txt` / `mods.txt` for you when you toggle the card.

## Manifest fields for a UE4SS mod

- `type` — `ue4ss` (a game-side mod). Required.
- `modName` — the `Mods/<name>` folder; must match the folder under `payload/Mods/`.
- `dependencies` — `["ue4ss"]` so it only enables once the UE4SS runtime is installed.
- `config` — the editable file, e.g. `Mods/SSAExample/example.txt` (relative to `payload/`).
- `id`, `name`, `version`, `author`, `website`, `image`, `readme`, `description` — as usual.

## Rules to code by

- It **deploys to the game** and applies on the next **server restart** (mods load when the game
  starts). A file the mod reads each tick (like `example.txt`) can pick up simple changes without one.
- **Guard every native access** with `pcall(...)` and `obj:IsValid()`. A bad read crashes the game —
  and that's the whole server. When in doubt, stay read-only.
- **Server-side only.** Never touch files outside your `Mods` folder.

## Pairing with a manager plugin

Split the work by what each side can do:

- The **mod** does what only in-process Lua can (read/change live game objects).
- A **manager plugin** does config UI, Discord, scheduling, persistence — and drives in-game commands
  through the **SSA Bridge** (`host.server.command(...)`). List the mod in the manager plugin's
  `dependencies` if it truly needs it.

## Full documentation

The complete guide to UE4SS mods and the Plugin SDK is at **https://scumsa.com/docs**.
