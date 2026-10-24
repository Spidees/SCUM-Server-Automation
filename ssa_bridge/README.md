# SSA Bridge

The in-game mod that lets the manager, a bot or your own tool talk to a running SCUM server. It is free and runs without the manager.

The download is a file on the [Releases page](https://github.com/Spidees/SCUM-Server-Automation/releases), not in this folder.

## Current release

| | |
|---|---|
| Version | **2.45.0** |
| Download | [SSABridge-v2.45.0.zip](https://github.com/Spidees/SCUM-Server-Automation/releases/download/bridge-v2.45.0/SSABridge-v2.45.0.zip) |
| Size | 10,162,881 bytes (9.69 MiB) |
| SHA-256 | `db3667e9bb4e46585e66d853f84381a398f005c95b2254d3945ba6cdc6a54bc9` |
| Release | [bridge-v2.45.0](https://github.com/Spidees/SCUM-Server-Automation/releases/tag/bridge-v2.45.0) |
| Source commit | `5a0c48fac1e79199175e4c7b2b721f380c823883` |

Unpack it into your server's `SCUM/Binaries/Win64/`. UE4SS is in the archive, so there is nothing else to fetch. The SDK for your own tools stays in this folder, in [`sdk/`](sdk).

## Check the download

The SHA-256 of the file you downloaded must be the one above. On Windows:

```
Get-FileHash .\SSABridge-v2.45.0.zip -Algorithm SHA256
```

On Linux: `sha256sum SSABridge-v2.45.0.zip`.

## Older versions

Every earlier version is on the [Releases page](https://github.com/Spidees/SCUM-Server-Automation/releases), and the newest release is always at [releases/latest](https://github.com/Spidees/SCUM-Server-Automation/releases/latest).
