<div align="center">

<img src="images/logo.png" width="112" alt="SCUM Server Automation">

# SCUM Server Automation

**The all-in-one manager for SCUM dedicated servers.**

Automated hosting · a full Discord bot · a web admin panel · a live map · leaderboards · an in-game economy · player management · and a real plugin platform.

[**🌐 scumsa.com**](https://scumsa.com) &nbsp;·&nbsp; [**📖 Documentation**](https://scumsa.com/docs) &nbsp;·&nbsp; [**⬇ Download**](#-download) &nbsp;·&nbsp; [**🧩 Plugins**](#-plugins) &nbsp;·&nbsp; [**🛠 Build a plugin**](#-build-your-own)

<br>

<img src="images/admin_live_map.webp" width="900" alt="Live Map — players, vehicles, bases and chests, with in-game spawn/teleport from the panel">

</div>

---

## What is it?

**SCUM Server Automation (SSA)** runs your SCUM dedicated server end-to-end so you don't have to babysit it. It installs and updates the server, keeps it alive with scheduled restarts and backups, and gives you a polished web panel and Discord bot to run everything — plus a plugin platform so the community can extend it.

- **Hands-off hosting** — automated install, game updates, scheduled restarts and backups, crash detection and auto-recovery.
- **Web admin panel** — a modern dashboard for server control, players, configuration and live logs, with a **Live Map** of players, vehicles, bases and chests (and in-game spawn / teleport straight from the map).
- **Discord bot** — status embeds, log feeds (kills, economy, raids, logins…), leaderboards, player linking and admin commands.
- **Players & economy** — stats, skills, leaderboards (weekly + all-time), squads, and the in-game trader economy at a glance.
- **Public Field Console** — a public stats site for your players.
- **Plugin platform** — add whole new features with manager plugins and in-game UE4SS mods (see below).

Everything is at **[scumsa.com](https://scumsa.com)**.

---

## 📸 A look around

<table>
<tr>
<td width="50%"><img src="images/admin_dashboard.webp" alt="Admin dashboard"><br><b>Dashboard</b> — server control, status and quick actions.</td>
<td width="50%"><img src="images/admin_players.webp" alt="Players"><br><b>Players</b> — stats, skills, squads and admin actions.</td>
</tr>
<tr>
<td width="50%"><img src="images/admin_plugins.webp" alt="Plugins"><br><b>Plugins</b> — install, enable and configure, right in the panel.</td>
<td width="50%"><img src="images/field_console_leaderboards.webp" alt="Public Field Console"><br><b>Public Field Console</b> — a public stats site your players can browse.</td>
</tr>
</table>

More screenshots and a live demo on [**scumsa.com**](https://scumsa.com).

---

## ⬇ Download

The latest manager build lives in [**`manager/`**](manager) — grab the `.zip`, unpack it, and follow the [Getting started guide](https://scumsa.com/docs). The always-current release and full changelog are on [scumsa.com](https://scumsa.com).

> **What's in this repository.** This is the public home for the SSA **plugins**, developer **examples**, and the latest manager **release**. The manager's own source is closed — everything you need to *run* a server is the release here plus [scumsa.com](https://scumsa.com).

---

## 🧩 Plugins

Plugins extend the manager — new admin screens, Discord tools, in-game rewards and gameplay tweaks. They're installed from the admin panel's **Plugins** section (a Premium feature) and update themselves from there. The source below is public so you can see exactly what each one does.

| | Plugin | What it does |
|---|---|---|
| <img src="plugins/ssa-plugins/ck-plugin/icon.png" width="34"> | [**Chat Commands & Kits**](plugins/ssa-plugins/ck-plugin) | Custom in-game `/commands` and reward kits & packs — teleports, currency, spawns and full containers, with tokens, costs, cooldowns and per-player limits. |
| <img src="plugins/ssa-plugins/vehicle-rental/icon.png" width="34"> | [**Vehicle Rental System**](plugins/ssa-plugins/vehicle-rental) | Players rent vehicles straight from your Discord bot — pick one, pay in money or gold, and the bot spawns it and runs the whole lifecycle (reminders, extensions, auto-removal). |
| <img src="plugins/ssa-plugins/mine-protection/icon.png" width="34"> | [**Mine Protection**](plugins/ssa-plugins/mine-protection) | Punishes players who arm mines or traps outside their own (or their squad's) flag area — squad-aware, and it teleports the offender onto their own mine. |
| <img src="plugins/ssa-plugins/env-plugin/icon.png" width="34"> | [**Environment Control**](plugins/ssa-plugins/env-plugin) | Tune how fast players get wet, dry off and get dirty with simple multipliers — make survival harsher or more forgiving. *(in-game UE4SS mod)* |
| <img src="plugins/ssa-plugins/embed-editor/icon.png" width="34"> | [**Discord Embed Editor**](plugins/ssa-plugins/embed-editor) | A visual Discord embed & button builder with a live preview — use it standalone, or let other plugins drop it into their own settings. |
| <img src="plugins/ssa-plugins/embed-styler/icon.png" width="34"> | [**Embed Styler**](plugins/ssa-plugins/embed-styler) | Restyle the manager's *own* Discord embeds (kill feed, economy, status, leaderboard…) and build your own auto-updating live embeds. |

Browse and get them in-app, or on the [Plugins page at scumsa.com](https://scumsa.com/plugins.php).

---

## 🛠 Build your own

Anyone can write plugins against a small, documented API — no access to the manager's source needed. Start from the runnable examples in [**`plugins/examples/`**](plugins/examples):

- [**`hello-plugin`**](plugins/examples/hello-plugin) — a complete manager plugin that demonstrates *every* feature end-to-end: config, events, HTTP routes, the game & manager databases, item/vehicle images, in-game chat and `/commands`, the SSA Bridge, Discord, scheduling, an admin workspace tab and a public Field Console tab.
- [**`ue4ss-mod-example`**](plugins/examples/ue4ss-mod-example) — a small, safe UE4SS (Lua) mod skeleton for in-game work.
- [**`ssa-plugin-sdk.d.ts`**](plugins/examples/ssa-plugin-sdk.d.ts) — TypeScript typings for the whole `host` / `SSA` / `FC` surface (editor autocomplete).

The complete **Plugin SDK** — every method, all events, and the UE4SS guide — is at [**scumsa.com/docs**](https://scumsa.com/docs).

---

## 📄 License

The plugins and the manager release are **© SCUM Server Automation — all rights reserved** (see [`LICENSE`](LICENSE)); the source is public for transparency, not for reuse. The developer examples in [`plugins/examples/`](plugins/examples) are **MIT-licensed** — copy them freely as a starting point for your own plugins.

---

## 🔗 Links

- **Website & downloads** — [scumsa.com](https://scumsa.com)
- **Documentation** — [scumsa.com/docs](https://scumsa.com/docs)
- **Plugins** — [scumsa.com/plugins.php](https://scumsa.com/plugins.php)

<div align="center">

Made for the SCUM community · [scumsa.com](https://scumsa.com)

</div>
