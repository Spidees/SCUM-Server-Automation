# Contributing

Thank you for helping. This page says what lives here, how to build a plugin, how to propose a change and how a change is reviewed.

## What is in this repository

- **Releases.** The manager in `manager/`, the SSA Bridge in `ssa_bridge/`, the SSA Reporter in `ssa_reporter/` and the SCUMSA Launcher in `launcher/`. These are built and published by the maintainer.
- **Official plugins.** The source of every official plugin in `plugins/ssa-plugins/`, with its packed zip in `plugins/ssa-plugins/dist/`.
- **Examples and the SDK.** Starting points for your own work in `plugins/examples/`, and the typings in `plugins/examples/ssa-plugin-sdk.d.ts`. The bridge SDK is in `ssa_bridge/sdk/`.
- **Tools.** The plugin validator in `plugins/tools/`.

The manager's own source is private. You do not need it: plugins are written against a documented API, and everything here works with the released manager.

## Build a plugin

1. **Start from [`hello-plugin`](plugins/examples/hello-plugin).** Copy the folder and give it your own `id`, `name` and `author` in `plugin.json`. The folder name must match the `id`.
2. **Read the developer docs.** [Start a plugin](https://scumsa.com/docs/dev/plugins-start) covers the folder layout and every field of `plugin.json`. The [Plugin SDK](https://scumsa.com/docs/dev/plugin-sdk) lists every page. The [backend](https://scumsa.com/docs/dev/plugin-backend) and [frontend](https://scumsa.com/docs/dev/plugin-frontend) pages cover the `host` and `SSA` APIs.
3. **Point your editor at the typings.** [`ssa-plugin-sdk.d.ts`](plugins/examples/ssa-plugin-sdk.d.ts) gives you autocomplete for `host`, `SSA` and `FC`.
4. **Run the validator.** It needs Node 20 or newer and no packages:

   ```
   node plugins/tools/validate-plugins.js path/to/your-plugin
   ```

   It checks the manifest, the files it names, every locale file and a packed zip if there is one. Fix every error it prints. See [`plugins/tools/`](plugins/tools) for the full list.
5. **Test it in your own manager.** Zip the contents of the folder so `plugin.json` sits at the top of the zip. In the admin panel, open **Plugins**, choose **Install…** and pick the zip, then switch the plugin on. Try every screen with the game server running and with it stopped.

Ship any npm packages your plugin needs inside the plugin. The manager does not install them.

## Propose a change

- **Open an issue first** for anything beyond a plugin: the manager, the bridge, the launcher or the API. Say what you need and why. The code for those is not here, so the issue is how the change happens.
- **Open a pull request** against `main` of this repository for a fix to an example or to an official plugin.

A pull request needs:

- the validator green: `node plugins/tools/validate-plugins.js plugins/ssa-plugins plugins/examples` (the same check runs on every pull request);
- every locale file updated when you add or change text. A new key goes into all of the plugin's languages. If you cannot translate one, say so in the pull request and the maintainer will get it translated;
- a line in the plugin's `README.md` when something an owner sees changes.

Do not change a plugin's `version` or the zips in `dist/`. The maintainer packs and versions every release, because a new version is what sends a plugin to every server that runs it.

## Publish your own plugin

Your own plugins do not need to come here. Publish them in the [mod library on scumsa.com](https://scumsa.com/mods/): sign in, choose **Submit** and upload the zip as a **Manager plugin**. Every upload is checked by machine, VirusTotal included, and you choose whether it is public, unlisted or private. What the library accepts and what each refusal means is on [Publishing to the library](https://scumsa.com/docs/dev/publishing).

An `id` belongs to the first account that publishes it, so pick one that is yours.

## How changes are reviewed

A change is reviewed for what an owner will see and what a player will see. It has to work with the game server stopped, and it must not fail silently: a refused action says why. Text is shown in the reader's own language, so it goes through the locale files and never sits in the code. A change does what it says and nothing else. The maintainer runs further checks against the manager itself before a change ships, and may ask for changes or make small ones before merging.

## Releases

Releases of the manager, the bridge, the Reporter, the launcher and the official plugins are made by the maintainer. A merged fix reaches owners with the next release of that plugin.

## Licence

Contributions to `plugins/examples/` are under that folder's MIT licence. Contributions to anything else here are under the repository's [licence](LICENSE), so that they can be shipped as part of the product.
