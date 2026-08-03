# Hello Plugin

A complete, copy-me **reference plugin** for SCUM Server Automation. Read the code top-to-bottom —
every block is one thing a plugin can do, with a comment saying what it demonstrates.

> Plugins are a **Premium** feature. Without an active subscription the manager loads no plugin — no
> backend and no UI. A running plugin also can't unlock, bypass or fake any Premium feature.

## What it shows

- **Config** you can edit on the card — `host.config.get / set / onChange`
- **Events** — server lifecycle plus parsed game events (`kill`, player join/leave, …)
- **HTTP routes** — an admin-gated API and a public one for the Field Console
- **Game database** — read-only `host.db.scum` (tolerating a stopped server)
- **Persistence** — a key/value `host.store` and a full `host.sqlite()` database
- **In-game chat & a `/command`** — greet players and answer `/online`, `/kit`
- **The SSA Bridge** — run in-game commands with `host.server.command()`
- **Discord** — your own embed + button, and adding a field to the manager's kill feed
- **Scheduling & notifications** — timers and `host.notify()`
- **Admin UI** — a workspace tab, per-player and per-vehicle actions, live updates
- **Field Console UI** — a public tab for your players' stats site

## Install and try it

1. Zip the **contents** of this folder so `plugin.json` sits at the zip root.
2. Admin panel → **Plugins** → **Install…**, choose the zip, then flip the card's switch on.
3. Open `http://<your-server>:8080/api/plugin-public/hello-plugin/hello` — it returns your greeting.
4. Click **Open** on the card to see the plugin's own workspace, and type `/online` in game.

Manager plugins apply instantly — no server or manager restart needed.

## Anatomy

```
hello-plugin/
  plugin.json          manifest (below) — always at the root
  README.md            shown in the card's "Readme" viewer
  icon.svg             1:1 icon on the card (png/jpg/svg)
  payload/             everything that gets deployed and loaded
    backend/index.js   Node entry — exports register(host) / unregister(host)
    web/plugin.js      admin-panel UI (window.SSA)
    web/plugin.css     admin-panel styles
    fc/plugin.js       public Field Console UI (window.FC)
    config.json        your editable config
    state/             created for you — your writable scratch dir (survives updates)
```

`plugin.json`, `README.md` and the icon live at the **root**; everything that runs lives under
**`payload/`**. Manifest paths are relative to `payload/` (except `image`/`readme`, at the root).

## Manifest fields (`plugin.json`)

- `id` — unique slug (letters, digits, `.` `_` `-`); also the folder name. Required.
- `name`, `description`, `author`, `website` — shown on the card.
- `type` — `manager` (this plugin), or `ue4ss` for an in-game mod. Required.
- `version` — bump it to ship a payload update; `updated` — an optional date string.
- `image` — card icon at the root (`png` / `jpg` / `svg`).
- `apiVersion` — the plugin API you target (current: `1`).
- `minManagerVersion` / `maxManagerVersion` — optional manager version range.
- `dependencies` — other plugins that must be active first (with optional versions, below).
- `main` — backend entry under `payload/`; omit for a frontend-only plugin.
- `web` — admin UI: `{ "script": "web/plugin.js", "style": "web/plugin.css" }`.
- `fc` — public Field Console UI: `{ "script": "fc/plugin.js", "style": "fc/plugin.css" }`.
- `config` — your editable config file under `payload/`.
- `readme` — a specific readme file (defaults to a `README.*` at the root).
- `premium` — informational flag for your own plugin.

## Dependencies and versioning

Yes — dependencies support versions, just like the manager gate does. A dependency is either a plain
id or an object with a `min` / `max` range (`major.minor.patch`):

```jsonc
{
  "dependencies": [
    "ssa-bridge",                          // any version, just needs to be active
    { "id": "embed-editor", "min": "1.2.0" },
    { "id": "some-lib", "min": "2.0.0", "max": "2.9.9" }
  ],
  "minManagerVersion": "3.5.0",            // gate against the MANAGER version too
  "apiVersion": 1                          // and against the plugin API version
}
```

If a dependency is missing or out of range (or the manager is too old), the card shows exactly why and
the plugin won't load until it's satisfied. Dependencies also set load order — a plugin loads after the
plugins it depends on.

## Using the SSA Bridge (in-game control)

The **SSA Bridge** is what lets a plugin act inside the game — run admin commands, spawn items,
message players. From a plugin you call it through `host`:

```js
// Always pre-check, and check the { ok, error } you get back.
const health = await host.server.bridge();          // { available, licensed, players, version }
if (!health.available) return;
const r = await host.server.command('#Announce Hello');
if (!r.ok) host.logger.warn(r.error);

// A command that lands on a specific player (no Location arg) — run it through them:
await host.server.command('#SpawnItem 1_9mm_Handgun 1', { executor: steamId });

// In-game chat is bridge-powered too:
host.chat.dm(steamId, 'Welcome!', { name: 'SERVER' });
host.chat.onCommand('online', (ctx) => ctx.reply(`Online: ${host.stats.onlineCount()}`));
```

## Combining UE4SS and manager plugins

A single plugin is **one** type — `manager` **or** `ue4ss`, not both. You combine them by shipping two
plugins with a dependency:

- The **SSA Bridge** (and other in-game features) are `ue4ss` mods that load with the game.
- A `manager` plugin reaches them by listing the mod in `dependencies` and calling `host.server.*` /
  `host.chat.*`, which route through the Bridge.

For guaranteed in-game control add `{ "dependencies": ["ssa-bridge"] }` so your plugin only enables
once the Bridge is on. This example keeps `dependencies` empty and degrades gracefully when the Bridge
is offline, so it installs anywhere.

## The Open button and background menus

- Plugin screens are **not** added to the top navigation. Each plugin with a visible tab gets an
  **Open** button on its card that reveals its own workspace (a back bar plus your tabs). Register
  several tabs and they become sub-tabs there.
- `SSA.actions.player(fn)` and `SSA.actions.entity(kind, fn)` add entries to the **action menus** that
  appear on players and map entities (vehicles, chests, bases, storage). Return `{ label, icon?,
  danger?, run }`, or `null` to add nothing.
- A tab or action is hidden unless it passes its gates (`premium`, `permission`, `when`). If a plugin
  has no visible tab, its Open button doesn't appear.

## Writing your plugin's README

Every plugin should ship a `README.md` — it's shown in the card's **Readme** viewer. Keep it in this
shape so it reads well:

- Start with a `#` title and one plain-language sentence on what the plugin does.
- Use `##` for sections and short `-` bullet lists; put commands and config in fenced ```code``` blocks.
- The viewer renders a focused subset of Markdown: **headings**, **bold** / *italic*, `inline code`,
  [links](https://scumsa.com), bullet and numbered lists, code fences, `>` quotes and `---` rules.
  **Tables and images are not rendered** — use lists instead, and put the icon in `plugin.json`.
- Say what it needs (the Bridge? a Discord channel id? Premium?) and how to configure it.

## Full documentation

The complete Plugin SDK — every `host` and `window.SSA` / `window.FC` method, all events, and more
worked examples — lives at **https://scumsa.com/docs**. Typings for editor autocomplete are in
`examples/ssa-plugin-sdk.d.ts`.
