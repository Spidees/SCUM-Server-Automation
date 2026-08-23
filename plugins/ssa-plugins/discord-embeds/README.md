# Discord Embeds

Everything embed-shaped in one plugin. **Write** a message with a live preview that renders real
Discord markdown, your server's own emoji and live server data — then **send it, and fix it later
in place**. **Restyle the manager's own embeds** (kill feed, economy, status, leaderboards) so they
look like your server. And build **custom live embeds** that keep themselves updated in a channel,
like the built-in status board but yours.

## How it works
- **Three tabs, one plugin.** ✉️ *Embeds* writes and sends messages, 🎨 *Built-in Embeds* restyles
  the ones the manager sends on its own, 📡 *Custom Live Embeds* builds self-refreshing ones.
- **The preview is honest.** Bold, italics, code blocks, quotes, lists, headings, spoilers, links,
  mentions, custom emoji and `<t:…>` timestamps render as Discord will render them — not as raw
  asterisks.
- **Tools sit under the field they apply to.** Formatting, emoji, live data and the game-database
  picker each write into the box you are working in, so nothing has to guess what you meant.
- **All the emoji.** The standard set is generated from the Unicode ranges (not a hand-picked
  handful), split from your server's own custom emoji, which insert in the `<:name:id>` form Discord
  needs.
- **The whole game database** — items, tradeables, vehicles, animals, zombies, NPCs, building — with
  the name, the image URL, or a `{img:CODE}` that resolves when the embed is sent.
- **Live data everywhere, with real numbers.** `{online}`, `{serverName}`, `{gameTime}`, leaderboard
  and map tokens are offered in every text box and filled in at send time — and the preview shows
  **this server's current values**, refreshed while you work, not invented samples. Tokens that only
  exist while an event fires (a kill's weapon, a trade's item) are shown greyed, as illustrations.
  Other plugins that mount this editor get all of it for free.
- **Fields and buttons** can be reordered and duplicated; `Ctrl/Cmd+B`, `I`, `U` and `K` work in every
  text box.
- **A confirm before `@everyone`.** Mentions in the message text really do notify the whole channel
  (the same text inside an embed never does), so that one is worth a second look.
- **Sent messages are editable.** Every post is recorded with its message id, so you can correct one
  in place — keeping its pins, reactions and position — copy it, or delete it.
- **Any of the bot's messages can be adopted.** Paste a message link (right-click → Copy Message
  Link) and the editor loads it — embed, buttons and text — ready to edit, even if it was posted
  before this plugin existed or by another feature.
- **Up to ten embeds in one message**, plus **select menus** alongside buttons — Discord allows
  both, and the preview shows how they will stack.
- **Send it later.** Book a date and time; the queue survives a manager restart, and tokens resolve
  when it actually goes out, not when you wrote it.
- **Undo and redo** (`Ctrl+Z` / `Ctrl+Shift+Z`) across the whole embed, not just the box you are in.
- **Size limits are checked first.** Discord rejects an over-long embed outright; this tells you
  which part is too long before you send.
- **Branding by default.** A new embed starts with the footer your bot uses everywhere else. Change
  it and your wording is what goes out.

## Requirements
- The Discord bot must be configured and running.
- Manager **4.0.5+** (reads the bot's branding).
- Editing or deleting a message only works for messages **this bot posted**.

## Configuration
Nothing to configure — open the tabs and build. Other plugins reuse the editor through
`SSA.consume('embed-editor').mount(el, opts)` on the front end, and the live-data catalog through
`host.consume('server-data')` on the back end; both service names are unchanged, so plugins written
against the old pair keep working.

## Good to know
- **This replaces the separate `embed-editor` and `embed-styler` plugins.** They were already
  mutually dependent. Their saved settings are **not** carried over — set the new plugin up once and
  remove the old two.
- The sent-message history keeps the last **100** messages. Clearing the list never touches Discord.
- Mentions inside an **embed** never ping; only mentions in the message text above it do. That is
  Discord's own behaviour, and a useful way to write a safe announcement.
- A message deleted in Discord can no longer be edited — the editor says so rather than quietly
  posting a new one.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
