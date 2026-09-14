# Discord Embeds

Everything embed-shaped in one plugin. **Write a message** with a live preview that renders real
Discord markdown, your server's emoji and live server data, then **send it and edit it in place later**.
**Restyle the manager's own embeds** (kill feed, economy, status, leaderboards) and build **custom live
embeds** that keep themselves updated in a channel.

## How it works
- **An honest preview.** Markdown, mentions, custom emoji and `<t:…>` timestamps render the way
  Discord renders them.
- **Live data tokens** such as `{online}`, `{serverName}` and `{gameTime}` can go in any text box,
  button, menu option or image URL. They are filled in **when the message is sent**, and the preview
  shows this server's current values.
- **Player figures come from the last game save.** `{money}`, `{fame}`, `{gold}`, `{squad}` and every
  `{stat_…}` are marked *the last game save* in the picker, because they can lag the running game.
- **Pickers for everything:** formatting, the full emoji set plus your server's own emoji, live data,
  and the game database (items, tradeables, vehicles, animals, zombies, NPCs, building).
- **Sent messages stay editable.** Every post is recorded, so you can update it in place, load a copy
  or delete it. You can also **load any message the bot posted** by pasting its message link.
- **Up to ten embeds in one message**, plus buttons and **select menus**.
- **Schedule a message** for a date and time. The queue survives a restart.
- **Custom live embeds** are posted once and then edited in place on their refresh interval.
- **Click actions.** On custom live embeds and restyled built-in embeds, each button or menu option can
  **run an in-game command**, reply privately to the player, or post to the channel. `{picked}` carries
  the option a player chose.
- **Size limits are checked before you send**, counted the way Discord counts them. A token that grows
  past a limit when sent is trimmed with `…` instead of failing the message.
- **Undo and redo** (`Ctrl+Z` / `Ctrl+Shift+Z`), `Ctrl+B`, `I`, `U` and `K` in text boxes, and a
  search box on every list.

## Requirements
- The Discord bot configured and running.
- The **SSA Bridge** plugin, for click actions that run an in-game command. Everything else works
  without it.
- Manager **5.16.2+**.

## Configuration
Everything is configured from the plugin's **admin tab** (📝 Embeds), plus two more tabs:

- **📝 Embeds**: the editor, with *Editor*, *Templates* (saved embeds, JSON import and export) and
  *Sent messages* (scheduled and sent messages).
- **🎨 Built-in Embeds**: pick a manager embed, tick *Customize this embed*, optionally *Replace
  fields*, and *Save styles*. The editor loads the embed with its values already turned into tokens.
- **📡 Custom Live Embeds**: each embed has a *Name*, *Channel*, *Refresh (sec)* (default 60, minimum
  15) and *Active*. Use *Save & post now* to put it in the channel.
- **⚡ Click actions** (on the last two tabs): for each button or menu option, the action and its
  text or command. Commands and channel posts also take **who can use it** (a Discord role, or
  anyone) and a **Cooldown (s, 0 = none)**.

## Good to know
- **A command button runs its command for whoever clicks it.** In a public channel that is every
  member, so set a role or a cooldown. A double click never runs a command twice.
- **The footer and timestamp come from your bot's branding** and are applied to every embed as it is
  sent. They are not set per embed.
- **Mentions inside an embed never ping.** Only mentions in the message text above it do, and the
  editor asks before sending `@everyone` or `@here`.
- **Only messages this bot posted** can be edited or deleted. A message deleted in Discord cannot be
  edited any more, and the editor says so instead of posting a new one.
- Clearing the text above an embed, or removing the last button, removes it from the message on the
  next save or refresh.
- `{killerName}` and `{victimName}` show a readable name such as *Guard (Lvl 5)* for NPCs and puppets.
- The sent-message history keeps the last **100** messages. Clearing the list never touches Discord.
- If someone else saves a tab while you have it open, your save is refused and you are asked to reload.
- Other plugins can reuse the editor and the live data through the `embed-editor` and `server-data`
  services.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
