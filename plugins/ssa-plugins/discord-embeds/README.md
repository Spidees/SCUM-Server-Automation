# Discord Embeds

Everything embed-shaped in one plugin. **Write a message** with a live preview that renders real
Discord markdown, your server's emoji and live server data, then **send it and edit it in place later**.
**Restyle the manager's own embeds** (kill feed, economy, status, leaderboards), build **custom live
embeds** that keep themselves updated in a channel, and see on the **Activity** screen what was posted
where, what players clicked, and why anything failed.

## How it works
- **An honest preview.** Markdown, mentions, custom emoji and `<t:…>` timestamps render the way
  Discord renders them.
- **Live data tokens** such as `{online}`, `{serverName}` and `{nextRestart}` can go in any text box,
  button, menu option or image URL. They are filled in **when the message is sent**, and the preview
  shows this server's current values.
- **Player figures, the in-game time and the temperatures come from the last game save.** `{money}`,
  `{fame}`, `{gold}`, `{squad}`, every `{stat_…}`, `{gameTime}` and the temperature tokens are marked
  *the last game save* in the picker, because they can lag the running game.
- **Pickers for everything:** formatting, the full emoji set plus your server's own emoji, live data,
  and the game database (items, tradeables, vehicles, animals, zombies, NPCs, building).
- **Sent messages stay editable.** Every post is recorded, so you can update it in place, load a copy
  or delete it. You can also **load any message the bot posted** by pasting its message link.
- **Up to ten embeds in one message**, plus buttons and **select menus**.
- **Schedule a message** for a date and time. The queue survives a restart, and a message that falls
  due while the bot is offline **waits and goes out when the bot is back**.
- **Custom live embeds** are posted once and then edited in place on their refresh interval.
- **Click actions.** On custom live embeds and restyled built-in embeds, each button or menu option can
  **run an in-game command**, reply privately to the player, or post to a channel. `{picked}` carries
  the option a player chose.
- **A master switch for each part:** restyling, live embeds, click actions and scheduled messages can
  each be paused without losing anything you set up.
- **Size limits are checked before you send**, counted the way Discord counts them. A token that grows
  past a limit when sent is trimmed with `…` instead of failing the message.
- **Undo and redo** (`Ctrl+Z` / `Ctrl+Shift+Z`), `Ctrl+B`, `I`, `U` and `K` in text boxes, and search,
  filters, pages and ticks on every list.

## Requirements
- The Discord bot configured and running. Everything can be set up while it is offline.
- Optional: the **SSA Bridge** plugin, only for click actions that run an in-game command.
  Everything else works without it, and the plugin switches on without it.
- Manager **6.0.0+**.

## Configuration
Everything is configured from the plugin's **admin tab**, which has five screens. Each one shows
whether the bot is online and the game is running, and what is switched off.

- **📝 Embeds**: the editor, with *Editor*, *Templates* (saved embeds, JSON import and export) and
  *Sent messages* (scheduled and sent messages, with search, pages and bulk delete).
- **🎨 Built-in Embeds**: every embed the manager sends in one table, each with *Customize this embed*
  and *Replace fields*, filters by group and state, and ticks to switch many at once. Open one to
  design it, then *Save styles*.
- **📡 Custom Live Embeds**: a table of your live embeds with their channel, refresh, *Active* switch
  and last update. Each has a *Name*, *Channel*, *Refresh (sec)* and *Active*. Use *Save & post now*
  to put it in the channel.
- **⚡ Click actions** (on the last two screens): for each button or menu option, the action and its
  text or command. Commands and channel posts also take **who can use it** (a Discord role, or
  anyone), a **Cooldown (s, 0 = none)**, and for a post the channel it goes to.
- **📈 Activity**: the bot, the Discord server and the scheduler right now, every live embed's last
  update, and a log of sends, edits, deletes, scheduled posts, live embeds and clicks, with the reason
  for each failure.
- **⚙️ Settings**: the four master switches, the default refresh for a new live embed, how often an
  unchanged live message is checked again, how late a scheduled message may still go out, how many
  sent messages and activity entries to keep, the default channel, and **every private reply a click
  gives, with a tab per language**.

## Good to know
- **A command button runs its command for whoever clicks it.** In a public channel that is every
  member, so set a role or a cooldown. A double click never runs a command twice.
- **The footer and timestamp come from your bot's branding** and are applied to every embed as it is
  sent. They are not set per embed.
- **Mentions inside an embed never ping.** Only mentions in the message text above it do, and the
  editor asks before sending `@everyone` or `@here`.
- **Only messages this bot posted** can be edited or deleted. A message deleted in Discord cannot be
  edited any more, and the editor says so instead of posting a new one.
- **Another plugin's buttons and menus are left alone.** The plugin only answers clicks on messages it
  put up.
- Clearing the text above an embed, or removing the last button, removes it from the message on the
  next save or refresh.
- `{killerName}`, `{victimName}` and `{causeBy}` show a readable name such as *Guard (Lvl 5)* for NPCs
  and puppets.
- **An embed is one Discord message, written in one language.** A player's **/lang** choice changes what
  they read in game, not what a channel shows, so write each embed in the language your community uses.
- **A private reply is in the clicker's own language.** Give it a text per language; the plugin's own
  answers (cooldown, missing role, done) follow the same language and can be reworded in Settings.
- The sent-message history keeps the last **100** messages by default. Clearing the list never
  touches Discord.
- If someone else saves a screen while you have it open, your save is refused and you are asked to
  reload.
- Other plugins can reuse the editor and the live data through the `embed-editor` and `server-data`
  services.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
