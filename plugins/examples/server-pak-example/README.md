# Server pak example

How to make, pack and publish a **server pak**: a `.pak` the SCUM dedicated server loads. This folder
holds no pak, because a real one is built from your own cooked content and cannot be built from source
here. It describes exactly what the library expects, so your own pak goes up on the first try.

For a pak that goes on players' games, see `../client-pak-example`. A mod can have both halves.

## What a server pak is

A `.pak` is an Unreal Engine archive of **cooked** game files: data tables, blueprints, meshes and the
like. When the server starts it mounts every pak it finds, and a file in a mounted pak replaces the
game's own file at the same path. That is how a pak mod changes the game.

A server pak changes what the **server** reads. Players do not download it, and a player's game never
sees it.

The game's own server paks show the shape to match:

- SCUM runs on **Unreal Engine 4.27**, and its paks are **version 11**.
- The server's paks are cooked for the **`WindowsServer`** platform (`pakchunk0-WindowsServer.pak`).
- Their files sit under the mount point `../../../SCUM/Content/`, so the game's asset
  `/Game/ConZ_Files/...` is the pak path `SCUM/Content/ConZ_Files/...`.

## Making one

1. **Cook** your changed assets with Unreal Engine 4.27, for `WindowsServer`. A replacement asset must
   keep the path and the class of the game asset it replaces. An asset cooked against classes the game
   does not have can break the game.
2. **Pack** them with UnrealPak from the same engine. A response file lists what goes in and where it
   mounts, one line per folder or file:

   ```
   "C:\MyMod\Saved\Cooked\WindowsServer\SCUM\Content\ConZ_Files\*.*" "../../../SCUM/Content/ConZ_Files/"
   ```

   ```
   UnrealPak.exe "C:\out\MyMod_P.pak" -create="C:\MyMod\filelist.txt"
   ```

3. Do **not** sign or encrypt it. A mod pak has no signature, and no `.sig` file goes with it.
4. End the file name in `_P` (`MyMod_P.pak`) when it has to win over the game's own files: the engine
   gives a patch pak a higher priority.

## How the server loads it

The game's own paks are signed, and SCUM refuses an unsigned pak unless the server process starts with
**`-fileopenlog`**.

- **With the manager**, install the pak from the library under admin, Plugins. The manager puts it in
  `SCUM/Content/Paks/~mods/` and adds `-fileopenlog` to the server's launch while a server pak it
  installed is there.
- **By hand**, put the pak in `SCUM/Content/Paks/~mods/` yourself and add `-fileopenlog` to the
  server's launch arguments. On a manager server, a pak you placed by hand needs that argument in the
  server's custom launch arguments too.

Inside `~mods`, the manager names each pak `NN-<your file>.pak`, where `NN` is the load order from 01
to 99. Name your file without that prefix. How the load order works is on
[Paks](https://scumsa.com/docs/dev/paks).

## Publishing it

Upload to the [mod library](https://scumsa.com/mods/) as a **Server pak**: one `.pak`, or a `.zip` that
holds only `.pak` files, up to 1 GB.

```
MyMod_P.pak                     a single pak, uploaded as it is

MyMod.zip                       or a zip of paks
  MyMod_P.pak
  MyMod_Maps_P.pak
  README.md                     a readme (.md or .txt) may go in the zip
```

A mod with a part for players carries both halves in one zip. A pak under `server/` is the server's, a
pak under `client/` goes on players' games, and the library lists one mod with two halves:

```
MyMod.zip
  server/
    MyMod_P.pak
  client/
    MyMod_P.pak
  README.md
```

The library checks every `.pak` before it accepts the upload. It refuses:

- a file that is not a real Unreal pak (the pak's own footer is read);
- a file named `pakchunk...`, which belongs to the game;
- a `.sig` file, because a mod pak is unsigned;
- any other file type in the zip;
- a file name that does not start with a letter or digit, or uses characters other than letters,
  digits, spaces and `. _ ( ) + -`;
- two paks with the same name on the same side.

On the form you also set the **load order** (default 50) and the mods yours needs. Every check and
every refusal is on [Publishing to the library](https://scumsa.com/docs/dev/publishing).
