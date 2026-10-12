# Examples

One example for every kind of thing you can publish in the [scumsa.com library](https://scumsa.com/mods/).
Copy one, make it yours, and upload it under the kind in the second column.

| Example | Upload as | What it is |
|---|---|---|
| [`hello-plugin`](hello-plugin) | Manager plugin | A complete manager plugin: config, events, routes, the game database, in-game chat, Discord, an admin tab and a Field Console tab. |
| [`ue4ss-mod-example`](ue4ss-mod-example) | UE4SS mod | A small, safe Lua mod that reads a live game object on the game thread. Ships as a plain mod folder or wrapped as a manager plugin. |
| [`server-pak-example`](server-pak-example) | Server pak | How to cook, pack and publish a `.pak` the dedicated server loads. |
| [`client-pak-example`](client-pak-example) | Client pak | How to cook, pack and publish a `.pak` a player's game loads, and what players need the SCUMSA Launcher for. |
| [`zone-list-tool`](zone-list-tool) | Tool | A Python script that lists the custom zones in a server's save, read-only. |
| [`ssa-plugin-sdk.d.ts`](ssa-plugin-sdk.d.ts) | | TypeScript typings for the plugin `host`, `SSA` and `FC` APIs, for editor autocomplete. |

The pak examples hold no pak: a real one comes from your own cooked content.

## Uploading

Sign in on scumsa.com and choose **Submit** in the mod library, or **Submit a tool** for a tool. Every
upload is checked by machine, VirusTotal included, and a clean one is public at once. What each kind
must contain, and what every refusal means, is on
[Publishing to the library](https://scumsa.com/docs/dev/publishing).

Give your copy its own name and id before you upload it: an id belongs to the first account that uploads it.

## Licence

The examples are MIT-licensed (see [`LICENSE`](LICENSE)). Copy them freely as a starting point.
