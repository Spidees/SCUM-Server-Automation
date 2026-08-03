# Discord Embed Editor

An interactive Discord **embed & button builder** with a live preview — as a standalone admin tab,
and as a **reusable component** other plugins drop into their own settings.

## Standalone
Enable the plugin → an **Embeds** tab appears in the admin panel. Design an embed (title, description,
color, author, images, footer, fields, buttons), preview it live, **send it to a channel**, save it as
a **template**, or import/export JSON.

## Use it from YOUR plugin (the point)

Let admins design your plugin's embeds without touching code — e.g. the vehicle-rental announcement.

**Frontend** — mount the editor into any element:
```js
// your web/plugin.js — declare "embed-editor" in your plugin.json `dependencies`
SSA.registerTab({ id: 'my-plugin', label: 'My Plugin', render: (el) => {
  el.innerHTML = '<div class="card"><h3>Rental embed</h3><div id="mp-embed"></div></div>';
  const ed = SSA.consume('embed-editor');
  ed && ed.mount(el.querySelector('#mp-embed'), {
    value: window.__myEmbed,                       // your saved embed JSON (optional)
    onChange: (json) => SSA.api('/embed', { method: 'POST', body: json }),  // save to YOUR backend
  });
}});
```

`mount(container, opts)` returns `{ getValue(), setValue(json), destroy() }`. `opts.onChange(json)` fires
on every edit; `opts.standalone: true` adds the channel-send + templates + JSON panels.

**Data tokens** — pass `opts.tokens: [{ t, label, sample }]` and the editor shows an "Insert data" bar
(click a field, then a token to drop `{t}` into it) and resolves `{t}` → `sample` in the live preview,
so it reads like the real message. The saved model keeps the raw `{t}`; resolve it for real when you
send (e.g. `String(v).replace(/\{(\w+)\}/g, …)`). This is how the **Embed Styler** plugin lets you add
fields like `{squad}` or `{online}` to the manager's embeds.

**Backend** — build/send the saved embed:
```js
// your backend/index.js
const ed = host.consume('embed-editor');
await ed.send(channelId, savedEmbedJson, savedEmbedJson.buttons);   // sends embed + its buttons
// or: const embed = ed.embed(savedEmbedJson); host.discord.send(channelId, { embeds:[embed] });
```

Wire your buttons' `customId`s (set them in the editor as `myplugin:action`) to
`host.discord.onButton('myplugin:action', i => …)` to make them do something in-game.

The embed JSON is a standard Discord APIEmbed (`{ title, description, color, author, footer, image,
thumbnail, fields[], buttons[] }`) — store it wherever you like (`host.store` / `host.sqlite`).

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
