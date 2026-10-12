# Client pak example

How to make, pack and publish a **client pak**: a `.pak` a player's SCUM game loads. This folder holds
no pak, because a real one is built from your own cooked content and cannot be built from source here.
It describes exactly what the library expects, and what a player needs to run it.

For a pak the dedicated server loads, see `../server-pak-example`. A mod can have both halves.

## What a client pak is

A `.pak` is an Unreal Engine archive of **cooked** game files. The game mounts every pak it finds, and a
file in a mounted pak replaces the game's own file at the same path. A client pak changes what the
**player's game** shows and plays: textures, meshes, sounds, interface. It does not change what the
server decides.

The game's own client paks show the shape to match:

- SCUM runs on **Unreal Engine 4.27**, and its paks are **version 11**.
- The client's paks are cooked for the **`WindowsNoEditor`** platform
  (`pakchunk0-WindowsNoEditor.pak`).
- Their files sit under the mount point `../../../SCUM/Content/`, so the game's asset
  `/Game/ConZ_Files/...` is the pak path `SCUM/Content/ConZ_Files/...`.

## Making one

1. **Cook** your changed assets with Unreal Engine 4.27, for `WindowsNoEditor`. A replacement asset must
   keep the path and the class of the game asset it replaces.
2. **Pack** them with UnrealPak from the same engine, with a response file that says where each folder
   mounts:

   ```
   "C:\MyMod\Saved\Cooked\WindowsNoEditor\SCUM\Content\ConZ_Files\*.*" "../../../SCUM/Content/ConZ_Files/"
   ```

   ```
   UnrealPak.exe "C:\out\MyMod_P.pak" -create="C:\MyMod\filelist.txt"
   ```

3. Do **not** sign or encrypt it, and ship no `.sig` file.
4. End the file name in `_P` when it has to win over the game's own files.

## What a player needs

SCUM does not officially support client mods, and two things stand in the way of one:

- The game's own paks are signed, and the game loads an unsigned pak only when it starts with
  **`-fileopenlog`**.
- **BattlEye** refuses a game that loads unsigned files. A game with a client pak has to start without
  BattlEye, and a game started without BattlEye **cannot join a server that runs BattlEye**.

Starting SCUM from Steam always starts BattlEye. The **SCUMSA Launcher** does the rest for the player:
when they join a server that lists client mods, it downloads them, checks each file against the SHA-256
the library published, puts them in `SCUM/Content/Paks/~mods/`, and starts the game with `-fileopenlog`
and without BattlEye, after asking first. Joining a normal server afterwards takes the mods out and
starts the game with BattlEye again.

So a client pak is for servers whose owner runs **without BattlEye** and lists the mod for their
players. The owner does that in the manager, under admin, Plugins, on the **For players** tab, and the
list appears on the server's page on scumsa.com, where the launcher reads it before a player joins.

## Publishing it

Upload to the [mod library](https://scumsa.com/mods/) as a **Client pak**: one `.pak`, or a `.zip` that
holds only `.pak` files, up to 1 GB.

```
MyMod_P.pak                     a single pak, uploaded as it is

MyMod.zip                       or a zip of paks
  MyMod_P.pak
  README.md                     a readme (.md or .txt) may go in the zip
```

A mod that also needs a server half carries both in one zip. A pak under `client/` goes on players'
games, a pak under `server/` is the server's, and the library lists one mod with two halves:

```
MyMod.zip
  client/
    MyMod_P.pak
  server/
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

On the form you also set the **load order** (default 50), the mods yours needs, and the lowest SCUMSA
Launcher version it needs, if any. Every check and every refusal is on
[Publishing to the library](https://scumsa.com/docs/dev/publishing), and how paks load is on
[Paks](https://scumsa.com/docs/dev/paks).
