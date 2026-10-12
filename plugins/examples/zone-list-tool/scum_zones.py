#!/usr/bin/env python3
"""List the custom zones saved in a SCUM server's save (SCUM.db).

Read-only. It opens the database in read-only mode and never writes to it, so it is safe to run
while the server is running. Python 3.8 or newer, standard library only.

    python scum_zones.py <SCUM.db or the server folder>
    python scum_zones.py <...> --json
"""

import argparse
import json
import sqlite3
import sys
from pathlib import Path

# The game keeps its server-wide zone configuration at this id. It is not one of the
# configurations a zone picks from, so it is left out when a zone's configuration is resolved.
SERVER_WIDE_CONFIG_ID = 1000

SAVE_IN_SERVER = Path("SCUM") / "Saved" / "SaveFiles" / "SCUM.db"


def find_save(arg):
    """The SCUM.db a path names: the file itself, or the save inside a server folder."""
    p = Path(arg).expanduser()
    if p.is_file():
        return p
    if p.is_dir():
        for cand in (p / SAVE_IN_SERVER, p / "SaveFiles" / "SCUM.db", p / "SCUM.db"):
            if cand.is_file():
                return cand
    return None


def open_read_only(path):
    uri = path.resolve().as_uri() + "?mode=ro"
    con = sqlite3.connect(uri, uri=True)
    con.row_factory = sqlite3.Row
    return con


def has_table(con, name):
    row = con.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone()
    return row is not None


def colour_hex(r, g, b):
    """The game stores a zone colour as three floats from 0 to 1."""
    def byte(v):
        try:
            return max(0, min(255, round(float(v) * 255)))
        except (TypeError, ValueError):
            return 0
    return "#{:02X}{:02X}{:02X}".format(byte(r), byte(g), byte(b))


def read_zones(con):
    maps = {}
    if has_table(con, "map"):
        maps = {r["id"]: r["name"] for r in con.execute("SELECT id, name FROM map")}

    configs = []
    by_position = {}   # (map_id, position) -> configuration
    for r in con.execute("SELECT id, map_id, name, color_red, color_green, color_blue "
                         "FROM custom_zone_configuration ORDER BY map_id, id"):
        configs.append({
            "id": r["id"],
            "map": maps.get(r["map_id"], r["map_id"]),
            "name": r["name"],
            "colour": colour_hex(r["color_red"], r["color_green"], r["color_blue"]),
            "serverWide": r["id"] == SERVER_WIDE_CONFIG_ID,
            "position": None,
            "_map_id": r["map_id"],
        })
    # A zone names its configuration by POSITION among the map's configurations in id order,
    # not by id, and the server-wide one is not counted.
    counters = {}
    for c in configs:
        if c["serverWide"]:
            continue
        n = counters.get(c["_map_id"], 0)
        c["position"] = n
        by_position[(c["_map_id"], n)] = c
        counters[c["_map_id"]] = n + 1

    zones = []
    for r in con.execute("SELECT id, map_id, name, location_x, location_y, size_x, size_y, "
                         "configuration_index, default_region_name FROM custom_zone_region "
                         "ORDER BY map_id, id"):
        sx = float(r["size_x"] or 0)
        sy = float(r["size_y"] or 0)
        # A height of 0 is how the save records a circle. Sizes are half the span, like a radius.
        if sy == 0:
            shape, size = "circle", {"radiusM": round(sx / 100, 1)}
        else:
            shape, size = "rectangle", {"widthM": round(2 * sx / 100, 1), "heightM": round(2 * sy / 100, 1)}
        cfg = by_position.get((r["map_id"], r["configuration_index"]))
        default = r["default_region_name"]
        zones.append({
            "id": r["id"],
            "map": maps.get(r["map_id"], r["map_id"]),
            "name": r["name"],
            "shape": shape,
            "x": round(float(r["location_x"] or 0), 1),
            "y": round(float(r["location_y"] or 0), 1),
            **size,
            "configuration": cfg["name"] if cfg else None,
            "configurationIndex": r["configuration_index"],
            "gameDefault": default if default and default != "None" else None,
        })

    deleted = []
    if has_table(con, "custom_zone_deleted_default_regions"):
        deleted = [r["default_region_name"] for r in
                   con.execute("SELECT default_region_name FROM custom_zone_deleted_default_regions ORDER BY id")]

    for c in configs:
        del c["_map_id"]
    return {"configurations": configs, "zones": zones, "deletedDefaultZones": deleted}


def size_text(z):
    if z["shape"] == "circle":
        return "r {} m".format(z["radiusM"])
    return "{} x {} m".format(z["widthM"], z["heightM"])


def print_table(data, out):
    zones, configs = data["zones"], data["configurations"]
    maps = {z["map"] for z in zones} | {c["map"] for c in configs}
    show_map = len(maps) > 1

    out.write("Configurations ({})\n".format(len(configs)))
    for c in configs:
        tag = "server-wide" if c["serverWide"] else "#{}".format(c["position"])
        prefix = "[{}] ".format(c["map"]) if show_map else ""
        out.write("  {}{:<12} {}  {}\n".format(prefix, tag, c["colour"], c["name"]))

    out.write("\nZones ({})\n".format(len(zones)))
    if zones:
        rows = [("id", "name", "shape", "size", "x", "y", "configuration")]
        for z in zones:
            name = z["name"] + ("  (game default: {})".format(z["gameDefault"]) if z["gameDefault"] else "")
            if show_map:
                name = "[{}] {}".format(z["map"], name)
            cfg = z["configuration"] or "? (position {})".format(z["configurationIndex"])
            rows.append((str(z["id"]), name, z["shape"], size_text(z),
                         "{:.0f}".format(z["x"]), "{:.0f}".format(z["y"]), cfg))
        widths = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
        for i, r in enumerate(rows):
            out.write("  " + "  ".join(v.ljust(widths[j]) for j, v in enumerate(r)).rstrip() + "\n")
            if i == 0:
                out.write("  " + "  ".join("-" * w for w in widths) + "\n")

    if data["deletedDefaultZones"]:
        out.write("\nGame default zones removed on this server: {}\n".format(", ".join(data["deletedDefaultZones"])))


def main(argv=None):
    ap = argparse.ArgumentParser(description="List the custom zones saved in a SCUM server's SCUM.db (read-only).")
    ap.add_argument("path", help="SCUM.db, or the server folder that holds SCUM/Saved/SaveFiles/SCUM.db")
    ap.add_argument("--json", action="store_true", help="print JSON instead of a table")
    args = ap.parse_args(argv)
    # A zone name can carry any character; a console that cannot show one gets a '?' rather than a crash.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass

    save = find_save(args.path)
    if save is None:
        sys.stderr.write("No SCUM.db at {}. Give the file, or the server folder that holds "
                         "SCUM/Saved/SaveFiles/SCUM.db.\n".format(args.path))
        return 1
    try:
        con = open_read_only(save)
        if not (has_table(con, "custom_zone_region") and has_table(con, "custom_zone_configuration")):
            sys.stderr.write("{} has no custom zone tables. Is it a SCUM server save?\n".format(save))
            return 1
        data = read_zones(con)
        con.close()
    except sqlite3.Error as e:
        sys.stderr.write("Could not read {}: {}\n".format(save, e))
        return 1

    if args.json:
        json.dump(data, sys.stdout, indent=2, ensure_ascii=False)
        sys.stdout.write("\n")
    else:
        sys.stdout.write("{}\n\n".format(save))
        print_table(data, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
