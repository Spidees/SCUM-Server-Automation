# SSA Bridge SDK

**Talk to a running SCUM server from your own code.** The SSA Bridge is a free mod inside the server that answers JSON on a TCP socket. This folder is everything a bot, a website or a tool on another machine needs to use it **without the manager**: typings for the whole interface, and a small reference client for Node and for Python.

| File | What it is |
|---|---|
| [`ssa-bridge-sdk.d.ts`](ssa-bridge-sdk.d.ts) | The interface, typed: connection, frame, replies, every refusal code, and every module's reads, writes and settings. Generated from the bridge itself. |
| [`ssa-bridge-client.js`](ssa-bridge-client.js) | A Node client with no dependencies. Works with `require` and `import`. |
| [`python/ssa_bridge_client.py`](python/ssa_bridge_client.py) | The same client for Python 3.8 or newer, standard library only. |
| [`package.json`](package.json), [`python/pyproject.toml`](python/pyproject.toml) | Package files, so you can install the SDK from a checkout (`npm install ./ssa_bridge/sdk`, `pip install ./ssa_bridge/sdk/python`). Neither is published to npm or PyPI. Their version is the bridge version the SDK was written for. |

Full protocol: [scumsa.com/docs/dev/ssa-bridge-protocol](https://scumsa.com/docs/dev/ssa-bridge-protocol). Every module's vocabulary: [scumsa.com/docs/reference/bridge-verbs](https://scumsa.com/docs/reference/bridge-verbs).

## Reading a verb's fields

Each line in the [module reference](https://scumsa.com/docs/reference/bridge-verbs) is the `what` string a module takes, generated from the mod itself:

- `<name>` is a field you fill in. Everything else is typed as shown.
- `<x>,<y>,<z>` is one field: three numbers separated by commas.
- `[:<name>]` is an optional field. Leave it out together with its separator.
- `a|b` means one of the words shown.

Send a wrong shape and the module refuses with `bad_request` or a sentence. That answer spells the
shape it expected.

Under each module, every read lists the properties its answer can carry, with their types. A
property is absent when the game did not give it. Absent never means zero or false.

In `ssa-bridge-sdk.d.ts` every verb is a type of its own, such as `SpawnRead_Spawn`, and its doc
comment carries the usage line and a note per field. Hover it in your editor. The keys a read can
carry are in `ModuleReadings`, so `ReadingOf<'zones', 'zones'>` types an answer.

## Turning on remote access

Everything happens in `SCUM/Binaries/Win64/Mods/SSABridge/` on the server. The bridge writes its config there on first start.

From the server's own machine nothing is needed: loopback is trusted. From anywhere else, edit `SSABridge.config.json` and restart the server:

```json
{ "host": "0.0.0.0", "port": 27717, "token": "a long random secret" }
```

- **`token` is the switch.** While it is empty, remote control is off and the bridge binds loopback whatever `host` says.
- **`host`** is the interface to listen on. `0.0.0.0` accepts every interface.
- **The clients log in without sending the token** when the bridge offers it (`status` lists `hmac` in `authModes`, bridge 2.44.0 and newer). They ask `auth_nonce` and answer with a proof made from the token. To an older bridge they send the token itself.
- **There is no TLS.** Commands and replies cross the network in clear, and so does the token sent to an older bridge, so use a VPN or an SSH tunnel on a network you do not trust.

**Never guess the port.** If the configured port is taken, the bridge moves to the next free one. It writes the port it really bound into `SSABridge.status.json`, with an `instance` that changes on every start. On the server's machine, read that file (`discover()` does). From elsewhere, ask the owner for the port.

## The protocol in one page

One JSON object per line, both ways, each ending in `\n`.

```json
{"id":"1","action":"module_data","module":"live","what":"players","instance":"…"}
{"id":"1","ok":true,"result":[{"steamid":"7656119…","name":"Nikolka"}]}
```

- **A request** names an `action` and an `id` of your choosing. The reply carries the same `id`. Replies can arrive out of order, so match them by `id`.
- **Send `instance`** from the status file on every line when you have it. A line meant for another run is refused with `wrong_instance`.
- **A remote client sends `auth` first**, with the token. It has ten seconds.
- **A success** is `{"ok":true,"result":…}`. Module replies can carry `changed`, `note` and `reach` beside `result`.
- **A refusal** is `{"ok":false,"error":…}`. The bridge's own refusals carry a stable code in `error` and a sentence in `reason`. A module's refusal carries its sentence in `error`. The clients fold both into `code` and `reason`: switch on `code`, show `reason`.
- **An event** has an `event` key and no `id`. You get them after `subscribe`.

Most of the interface is four actions: `modules` lists every module with its settings, `module_config` replaces a module's settings, `module_data` asks a module for a report, and `module_command` tells it to do something. **Every module ships switched off**, and one that is off refuses with a sentence naming the setting to turn on.

## Rate limits

The bridge allows **15 cost units a second with a burst of 30**, and at most **24 connections**. The owner can change both rates.

- **Over budget is not an error.** The request waits in a queue and runs later. Use your own timeout and treat expiry as unknown, because the request may still run.
- **Keep one connection open.** Every request goes through one queue, so more connections add nothing.
- **`rate_limited`** answers too many `auth` attempts. The clients wait and send again. When the refusal carries `retryAfterMs`, they wait exactly that long, and hand the refusal back at once if that is longer than your timeout.
- **`rate_limited` with `reasonCode` `locked_out`** means too many wrong tokens came from your address. The bridge closes the connection, so the clients do not resend: `connect()` fails with `retryAfterMs`, the time until that address may try again.
- **`busy` with `reasonCode` `queue_full`** means the bridge holds 1024 unanswered requests and dropped this one without running it. The clients wait and send it again. A module that answers `busy` in `reasonCode` is a different thing: the module refused, and the clients hand that back.

## Timeouts and dropped connections

Every request has a timeout: `timeoutMs` in Node (20 seconds unless you set it on `connect()`), `timeout` in seconds in Python. Each call also takes its own, for example `bridge.players({ timeoutMs: 5000 })` or `bridge.players(timeout=5)`.

- **`timeout` means unknown.** The request may still run. An admin command that timed out keeps the admin slot until the bridge answers it, so the next one never overlaps it.
- **`reasonCode` `not_sent`** on `timeout` or `closed` means the line never left: it did not run, and sending it again is safe.
- **`closed` without `not_sent`** means the connection dropped while the request was out. It may have run. The clients never resend it for you.
- **The clients notice a dead link.** TCP keepalive is on, and after 30 seconds of silence the client sends `status`. No answer closes the connection. Set `heartbeatMs` (Node) or `heartbeat` (Python, seconds) to change that, `0` to switch it off.

Reconnecting is off unless you ask for it:

```js
const bridge = await connect({
  ...where,
  reconnect: { minMs: 1000, maxMs: 30000 },
  rediscover: () => discover({ serverDir: 'C:/SCUM-Server' }),   // the port and instance change when the game restarts
});
bridge.on('disconnect', (why) => console.log('lost the bridge:', why.code));
bridge.on('reconnect', (info) => console.log('back after', info.attempt, 'attempt(s)'));
bridge.on('close', () => console.log('gone for good:', bridge.closeReason));
```

In Python, pass `reconnect=True` or `reconnect=(1, 30)` and `rediscover=lambda: discover(server_dir=...)`, and set `on_disconnect`, `on_reconnect` and `on_close`. A reconnected client logs in and subscribes again. While it is away, a request comes back at once as `closed` with `not_sent`. It stops trying, and closes for good, on a refusal a new connection would only meet again, such as a wrong token or a bridge below `minProtocol`; `closeReason` (`close_reason`) says which.

## Examples

Node:

```js
const { connect, discover } = require('./ssa-bridge-client.js');

// On the server's machine, from the status file. No file means the bridge has not started:
const where = discover({ serverDir: 'C:/SCUM-Server' });
if (!where) throw new Error('the bridge is not running on this server');
const bridge = await connect({ ...where, caller: 'my-bot' });
// From another machine:
// const bridge = await connect({ host: '203.0.113.5', port: 27717, token: 'a long random secret' });

const players = await bridge.players();                         // who is on, and where
const live = await bridge.query('live', 'players');             // the live module's readings
await bridge.chat('Restart in 5 minutes', { channel: 'global' });
await bridge.chat('Your kit is ready', { targets: ['76561190000000001'] });
const out = await bridge.cmd('ListVehicles');                   // a SCUM admin command, no '#'
const deaths = await bridge.query('medical', 'deaths');         // the last deaths, with their cause

if (!out.ok) console.log(out.code, out.reason);
bridge.on('event', (e) => console.log(e.event, e.steamid));
await bridge.subscribe(['player_join', 'player_leave']);
```

Python:

```python
from ssa_bridge_client import connect, discover

where = discover(server_dir=r"C:\SCUM-Server")
if where is None:
    raise SystemExit("the bridge is not running on this server")
bridge = connect(**where, caller="my-bot")
r = bridge.query("live", "players")
print(r["result"] if r["ok"] else (r["code"], r["reason"]))
bridge.chat("Restart in 5 minutes", channel="global")
```

An event handler that throws does not break the client: Node reports it as a `listenerError` event, Python logs it to the `ssa_bridge_client` logger. In Python the handlers run on a thread of their own, never the one reading the socket, so a handler may call the client.

A module answers only once its own settings are on. `live` needs **Read live player data** and **Position, facing and speed** for positions. `deaths` needs **Record deaths and their cause** in the medical module.

## Rules every client must follow

- **One admin command on the wire at a time.** Wait for the reply before sending the next `cmd`, `spawn` or `batch`. Both clients do this for you. Two at once can crash the server while it loads game files.
- **Send admin commands without the `#`.** The `#` is the chat prefix. Sent with it, the game answers *Unrecognized command*.
- **Never send `SpawnBrenner`.** It takes no position and always spawns the boss on the player running it.
- **Never spawn a bare controller class.** A controller with no character takes the server down within a second.
- **Name things by entity id**, as `eid:<id>`. A slot or list index changes when the world streams, and then names a different object.
- **Act on `confirmed`, never on `ok` alone**, when an admin command charges somebody or gives them something.
- **Ignore what you do not recognise**: unknown keys, events and codes. The interface grows, and the `protocol` number in `status` only moves on a breaking change.

## Protocol versions

`status` and the status file carry `protocol`, the wire version, and `protocolMin`, the oldest one the bridge still answers. An absent `protocol` means 1.

| `protocol` | Bridge | What changed |
|---|---|---|
| 1 | up to 2.24.1 | the protocol as published |
| 2 | 2.25.0 and newer | `zones` `delete:<name>:CONFIRM` and `squads` `disband:<squadId>:CONFIRM` need the confirmation word. Nothing else changed |

- **A newer bridge still answers an older client.** Only those two verbs refuse the old spelling, with a sentence naming the new one.
- **Talking to a protocol 1 bridge**, send `delete:<name>` and `disband:<squadId>` without the word. An older bridge reads it as part of the name.
- **A higher number than you know** is fine: proceed and ignore what you do not recognise. Both clients expose it as `protocol` and refuse to connect only below `minProtocol` (`min_protocol` in Python).

## Licence

MIT, see [`LICENSE`](LICENSE).

---

*Part of [SCUM Server Automation](https://scumsa.com). Get the bridge, the manager and the docs at [scumsa.com](https://scumsa.com).*
