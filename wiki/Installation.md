# Installation

## Requirements

| Requirement | Notes |
|---|---|
| **Windows** | Service control uses `sc.exe` + NSSM |
| **NSSM** | Download `nssm.exe` from [nssm.cc](https://nssm.cc/download) and put it in the project root (next to `Start.bat`) |
| **Node.js 22+** | Installed automatically by `Start.bat`, or get it from [nodejs.org](https://nodejs.org) |
| **SteamCMD** | Auto-downloaded into `steamcmd/` on first install |
| **Administrator rights** | `Start.bat` self-elevates (required for service control) |
| **Visual C++ Redistributables** | 2012, 2013 and 2015–2022 — [download](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist) |
| **DirectX End-User Runtimes** | [download](https://www.microsoft.com/en-gb/download/details.aspx?id=35) |
| **Discord bot** *(optional)* | Create one at [discord.com/developers](https://discord.com/developers/applications) |

> `better-sqlite3` ships prebuilt binaries — no Python or build tools needed on supported Node versions.

## Quick start

```bat
git clone https://github.com/Spidees/SCUM-Server-Automation.git
cd SCUM-Server-Automation
:: download nssm.exe from https://nssm.cc/download and put it in this folder
Start.bat
```

`Start.bat` self-elevates to administrator, installs Node.js if missing, runs `npm install`, then
launches the app and opens the browser.

## First-run setup wizard

On first launch the dashboard opens a guided wizard (served at `/admin/`). You provide:

- SCUM server directory & backup directory
- Windows service name
- Public IP, game port, query port, max players, BattlEye toggle
- Web port & **admin password**
- Discord bot token & Guild ID *(optional — can be added later)*

After saving, the SCUM server is installed via SteamCMD (watch progress in the browser) and the app
starts automatically. Subsequent launches skip the wizard.

To reconfigure from scratch: stop the app, delete `.env`, and restart.

## What runs where

- The app is a single Node process (`node src/index.js`) started by NSSM/`Start.bat`.
- It controls the **SCUM server** as a separate Windows service (NSSM).
- The web server listens on `web.port` (default `8080`) and serves `/admin` (dashboard) and `/`
  (public Field Console).

Next: [Configuration](Configuration) · [Web Interface](Web-Interface)
