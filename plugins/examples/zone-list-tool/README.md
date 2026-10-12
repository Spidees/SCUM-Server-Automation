# SCUM Zone List

A small command-line tool that lists the **custom zones** saved on a SCUM server: each zone's name,
shape, size, position and the configuration it uses, plus the zone configurations themselves. It reads
the server's save, `SCUM.db`, in **read-only** mode and never changes it, so it is safe to run while the
server is running.

It is also the reference example for sharing a **tool** on [scumsa.com/tools](https://scumsa.com/tools/).

## Running it

You need Python 3.8 or newer. Nothing else: it uses only Python's standard library, on Windows, Linux
and macOS.

```
python scum_zones.py "C:\SCUMServer"
python scum_zones.py "C:\SCUMServer\SCUM\Saved\SaveFiles\SCUM.db"
python scum_zones.py "C:\SCUMServer" --json
```

Give it the server folder (the one that holds `SCUM/Saved/SaveFiles/SCUM.db`) or the `SCUM.db` file
itself. A copy of a save works too.

```
Zones (2)
  id  name                                    shape   size       x        y        configuration
  --  --------------------------------------  ------  ---------  -------  -------  -------------
  1   Admin Base                              circle  r 150.0 m  -861287  -767895  Admin Outpost
  2   Outpost A0  (game default: Outpost A0)  circle  r 500.0 m  -610818  -556433  Outposts
```

## What it shows

- **Configurations**: every zone configuration with its colour. `#0`, `#1` and so on are the positions
  zones refer to; `server-wide` is the game's Global configuration, which no zone picks.
- **Zones**: a circle shows its radius, a rectangle its full width and height, in metres. `x` and `y`
  are the zone's centre in the game's own coordinates, the same numbers a teleport command uses.
- **game default** marks the zones SCUM itself creates, such as the outposts, with the game's own name
  for them. Default zones a server owner deleted are listed at the end.
- `--json` prints the same as JSON, for a script or a spreadsheet of your own.

## Good to know

- The tool reads what the game has **saved**. A change made in game appears once the server has written
  it to the save.
- It never writes to the save and needs no admin rights beyond reading the file.
- If it says there are no zone tables, the file is not a SCUM server save, or comes from a game build
  older than custom zones.

## Sharing a tool like this one

A tool is something people download and run on their own computer. Nothing installs it for them.

1. Put everything the tool needs in one `.zip`, up to 200 MB. Here that is `scum_zones.py` and this
   `README.md`.
2. Do not put a `plugin.json` at the top of the zip: that is a manager plugin, and the library refuses it
   as a tool.
3. Sign in on scumsa.com, choose **Submit a tool**, upload the zip, pick who it is for (this one is
   **For admins**) and choose a licence. Link your source code if it is public.

Every upload is checked by machine, VirusTotal included. The rules are on
[Publishing to the library](https://scumsa.com/docs/dev/publishing) and
[Sharing a tool](https://scumsa.com/docs/dev/tools).
