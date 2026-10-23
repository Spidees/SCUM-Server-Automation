# SSA Bridge

The in-game mod that lets the manager, a bot or your own tool talk to a running SCUM server. It is free and runs without the manager.

The download is a file on the [Releases page](https://github.com/Spidees/SCUM-Server-Automation/releases), not in this folder.

## Current release

| | |
|---|---|
| Version | **2.44.0** |
| Download | [SSABridge-v2.44.0.zip](https://github.com/Spidees/SCUM-Server-Automation/releases/download/bridge-v2.44.0/SSABridge-v2.44.0.zip) |
| Size | 10,115,335 bytes (9.65 MiB) |
| SHA-256 | `0443aab3ffbae1943c231e9d77e2576392c133b805fd6a63f454479f5bb26028` |
| Release | [bridge-v2.44.0](https://github.com/Spidees/SCUM-Server-Automation/releases/tag/bridge-v2.44.0) |
| Source commit | `c8fb9c0b8f1d5492d8bc9aa7afffbb3a04237ad1` |

Unpack it into your server's `SCUM/Binaries/Win64/`. UE4SS is in the archive, so there is nothing else to fetch. The SDK for your own tools stays in this folder, in [`sdk/`](sdk).

## Check the download

The SHA-256 of the file you downloaded must be the one above. On Windows:

```
Get-FileHash .\SSABridge-v2.44.0.zip -Algorithm SHA256
```

On Linux: `sha256sum SSABridge-v2.44.0.zip`.

## Older versions

Every earlier version is on the [Releases page](https://github.com/Spidees/SCUM-Server-Automation/releases), and the newest release is always at [releases/latest](https://github.com/Spidees/SCUM-Server-Automation/releases/latest).
