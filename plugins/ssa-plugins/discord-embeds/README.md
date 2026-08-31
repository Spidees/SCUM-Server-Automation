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
- **A player's own figures say where they come from.** `{money}`, `{fame}`, `{gold}`, `{squad}` and
  every `{stat_…}` are read from the **game database** — the state as of the last save — so the picker
  marks them *the last game save* and says so on hover. They are not the running game's numbers, and
  on an embed about somebody who is online right now that difference is real.
- **Fields and buttons** can be reordered and duplicated; `Ctrl/Cmd+B`, `I`, `U` and `K` work in every
  text box.
- **Type instead of scrolling.** Every list has a search box — the manager's ~80 built-in embeds,
  your saved templates, your custom live embeds, the sent-message history, and the emoji, token and
  game-item pickers. The one you are editing stays visible no matter what you type.
- **A confirm before `@everyone`.** Mentions in the message text really do notify the whole channel
  (the same text inside an embed never does), so that one is worth a second look.
- **Sent messages are editable.** Every post is recorded with its message id, so you can correct one
  in place — keeping its pins, reactions and position — copy it, or delete it.
- **Any of the bot's messages can be adopted.** Paste a message link (right-click → Copy Message
  Link) and the editor loads it — embed, buttons and text — ready to edit, even if it was posted
  before this plugin existed or by another feature.
- **Up to ten embeds in one message**, plus **select menus** alongside buttons — Discord allows
  both, and the preview shows how they will stack.
- **Buttons and menu choices do things.** On a custom live embed, every button and every option in a
  select menu can run an in-game command, reply privately, or post to the channel. `{picked}` carries
  the option a player chose, and a menu can have one catch-all action instead of one per option.
- **Send it later.** Book a date and time; the queue survives a manager restart, and tokens resolve
  when it actually goes out, not when you wrote it.
- **Undo and redo** (`Ctrl+Z` / `Ctrl+Shift+Z`) across the whole embed, not just the box you are in.
- **Size limits are checked first.** Discord refuses an over-long message outright; this names the
  part that is too long before you send. It counts the way Discord counts — the 6000 characters are
  across *every* embed in the message, not each one — and checks the buttons and select menus too:
  their row budget, their labels, and a menu left with no options.
- **One footer, on everything.** The footer and timestamp come from your bot's branding and are
  applied to every embed as it is sent — the manager's own and every one from a plugin — so the
  channel reads as one bot rather than several. They are not per-embed settings; change them by
  changing the branding. The preview shows exactly what Discord will show.

## Requirements
- The Discord bot must be configured and running.
- Manager **5.11.0+**. That is what the manifest enforces, so it is what the panel will let you enable.
- The **SSA Bridge**, for click actions that run an in-game command. Without it those buttons answer
  "command failed" with nothing explaining why, so it is a declared dependency and installs with the
  plugin. Everything else — posting, editing, live embeds — works without it.
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
- **The trade feed and the economy board are two separate entries now.** They were both listed as
  *Economy*, so the editor showed one and styled the other. Anything you had saved stays on the trade
  feed, where it was already being applied; the board is *Economy Overview* and honours its styling
  for the first time.
- **No token here is the running game, and none can be.** The manager hands a plugin an embed and
  takes one straight back, in the same breath — so every token has to resolve without waiting for
  anything, while every read from the game itself is a round trip that takes a moment. Server-wide
  numbers like `{online}` are as current as the manager is. A player's own — money, fame, gold, squad,
  every `{stat_…}` — are from the last **save**, which on a busy server is a real gap: somebody can
  spend their money and the embed announcing it will still show the old balance. The picker marks
  those, so you can decide whether a number belongs in that message at all. Nothing here would be
  improved by polling the game on a timer to keep a fresher copy — that costs the server continuously
  to make a line of text a little less wrong.
- **`{killerName}` and `{victimName}` name the thing, not its class.** A kill event carries either a
  player's name or a spawn class with its instance number attached — `BP_Guard_Lvl_5_C_2146943462` —
  and a styled kill feed used to print the second one verbatim, which made it read worse than the
  manager's own feed. Both are now put through the same name rule the built-in feed uses, so a
  puppet reads *Guard (Lvl 5)* and a player's name is left exactly as it came. On a manager older
  than **5.2** there is no such rule and the raw class comes through as it always did.
- The sent-message history keeps the last **100** messages. Clearing the list never touches Discord.
- Mentions inside an **embed** never ping; only mentions in the message text above it do. That is
  Discord's own behaviour, and a useful way to write a safe announcement.
- A message deleted in Discord can no longer be edited — the editor says so rather than quietly
  posting a new one.
- **What the editor offers, the message gets.** Live data `{tokens}` resolve everywhere you can type
  one — the text above the embed, button labels, select options, even image URLs — and buttons,
  select menus and extra embeds are delivered on the manager's own embeds as well as your own.
- **Picking a built-in embed loads its TEMPLATE, not last night's numbers.** The manager's own embeds
  come back with their live values turned into `{tokens}`, so a title reads `{online}/{max}` and not
  `43/64` — save the second and the embed says 43 for ever. This covers the title, description,
  author and every field, and it holds for the live boards (Server Status, Online Players, Bunkers,
  Leaderboards, Economy) which previously had no tokens at all.
- **Labels are left alone.** A value is only written back into a title or a field name when it *is*
  that text, or when it carries a digit — otherwise a status embed titled "Admin Action" would turn
  the word *Admin* into whichever admin last acted. Field values and descriptions are data, so a
  token is recognised inside them: `134 m` becomes `{distance} m`.
- **Clearing something removes it.** Emptying the text above an embed, or deleting the last button,
  takes it off the message on the next save or refresh instead of leaving the old one behind.
- **A token that grows past Discord's limits is trimmed, not dropped.** `{onlineList}` is thirteen
  characters while you are writing and around two thousand on a full server, so an embed that fits
  in the editor can be too long by the time it is sent. Anything over the limit ends in `…` and the
  message still goes out — on every path: a manual send, an edit, a scheduled announcement and a
  live embed alike. Before this, each of those failed differently and none of them said so.
- **The editor warns you first.** It measures your text with the tokens filled in from live server
  data, so you find out that `{onlineList}` will overflow the description while you are still
  writing it — not from a message that came out cut. It is a notice, not a block: the embed is still
  perfectly sendable.
- **One bad value no longer costs you the rest.** A malformed image URL used to skip the description,
  the fields and the buttons along with it. Each part is now applied on its own and the manager log
  names the one that failed.
- **Two browser tabs cannot overwrite each other.** If someone else saves while you have the page
  open, your save is refused with a message telling you to reload — rather than silently replacing
  their work with yours, which left nothing to restore from.
- **A button that runs an in-game command runs it for whoever clicks it.** That is the point, and it
  is also the risk: in a public channel it is every member, as often as they like. Each command or
  announce action now takes an optional **role** and an optional **cooldown**, and says in the editor
  what "no restriction" means. Double-clicking never counts twice, whatever you set.
- **Buttons on the manager's own embeds are wired up here too.** The editor always let you add one;
  until now only your own embeds had anywhere to say what it should do, so a button on a built-in
  embed could only ever answer "nothing is set up for that button yet".

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
