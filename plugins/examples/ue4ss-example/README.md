# UE4SS Example Mod

A small, safe reference **UE4SS (Lua) mod** for a SCUM dedicated server. It runs inside the game process
and reads a live Unreal object that nothing outside the game can reach. It only reads: every few seconds
it counts the connected players and prints the number to the UE4SS console when it changes. Copy it as a
skeleton.

> A UE4SS mod is for what only in-process code can do: reading and changing live game objects. For config
> screens, Discord, scheduling and storage, pair it with a manager plugin (see `../hello-plugin`).

## What it shows

- The layout of a UE4SS mod, both as a plain mod folder and wrapped as a manager plugin.
- Reading a config file (`example.txt`) beside the mod, again on every pass, so an edit needs no restart.
- Doing the engine work on the **game thread** with `ExecuteInGameThread`, never from `LoopAsync`.
- Looking the game state up **once**, keeping it, and counting `GameState.PlayerArray` instead of walking
  the world on a timer.
- Treating an invalid object and an unreadable list as "nothing learned", not as "no players".

## Anatomy

```
ue4ss-example/
  plugin.json                  manifest (type "ue4ss"), only for the manager-plugin form
  README.md                    shown in the card's Readme viewer
  icon.png                     209x209 card icon
  payload/
    Mods/
      SSAExample/              the mod folder; its name is "modName" in plugin.json
        enabled.txt            UE4SS starts a mod that carries this file
        example.txt            the mod's config
        Scripts/
          main.lua             the entry point UE4SS loads
```

`enabled.txt` is what makes UE4SS start the mod without anybody editing `mods.txt`. Its content does not
matter; this one is empty. A C++ mod has `dlls/main.dll` in place of `Scripts/main.lua`.

## Rules to code by

- **`LoopAsync` does not run on the game thread.** Touching a UObject from it races the engine, and
  `pcall` cannot catch the crash that follows. Hand every engine touch to `ExecuteInGameThread`, and keep
  file reads outside it. If the hook is not available, stand down.
- **A lookup holds the frame.** `FindAllOf` and `FindFirstOf` walk every object in the game, which takes
  well over 100 ms on a SCUM server. `FindFirstOf` stops early only on an exact class name, and the live
  objects are Blueprint subclasses, so asking for the native name always walks everything. Look a
  singleton up once, keep it, and check it with `IsValid()` each time.
- **A failed lookup returns an invalid object, not `nil`.** Test both.
- **Never index a `TArray` past its length.** UE4SS grows the game's own array to make the slot exist.
  Read `#arr` and stay inside it.
- **Mods load when the game starts.** A change to the Lua applies on the next server start.
- **Stay in your own folder.** Read and write only inside `Mods/<YourMod>/`.

## Two ways to ship it

**As a manager plugin.** Zip the contents of this folder, so `plugin.json` is at the top of the zip and
the mod sits under `payload/Mods/`. The manager installs it from admin, Plugins, gives it a card with a
switch, the readme and a config editor, and keeps it across manager updates. `dependencies: ["ue4ss"]`
makes it wait for the UE4SS runtime.

**As a plain mod.** Zip only the `Mods` folder from `payload/`, so the zip holds `Mods/SSAExample/` and
nothing else beside it but an optional readme. An owner without the manager extracts it into the
folder that holds UE4SS's `Mods` folder, which is `SCUM/Binaries/Win64/` in the usual install.

## Publish your own

Upload either zip to the [mod library](https://scumsa.com/mods/) as a **UE4SS mod**, after renaming
`SSAExample` (the folder, and `modName` and `config` in `plugin.json`) and giving the plugin its own `id`.

- A plain mod zip holds **one** mod folder, optionally under `Mods/`. It needs `Scripts/main.lua` or
  `dlls/main.dll`, and `enabled.txt`. A readme may sit beside the folder. Any other loose file, or a
  second mod folder, is refused.
- A zip with `plugin.json` at the top follows the plugin rules instead: `"type": "ue4ss"`, a version like
  `1.0.0`, and the mod under `payload/Mods/<modName>/`.
- Up to 100 MB.

Every check and every refusal is on [Publishing to the library](https://scumsa.com/docs/dev/publishing).

## Pairing with a manager plugin

- The **mod** does what only in-process code can: read and change live game objects.
- A **manager plugin** does config screens, Discord, scheduling and storage, and runs in-game commands
  through the **SSA Bridge** (`host.server.command(...)`). List the mod in the plugin's `dependencies`
  when it really needs it.

## Full documentation

The guide to UE4SS mods and the Plugin SDK is at [scumsa.com/docs](https://scumsa.com/docs). The UE4SS
Lua API is at [docs.ue4ss.com](https://docs.ue4ss.com/).
