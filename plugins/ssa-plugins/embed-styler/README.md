# Embed Styler

Restyle the manager's **own** embeds — the kill feed, economy, chest, raid protection,
login, status, leaderboard, players, bunkers and more — using the **Discord Embed Editor**.

## What it does

Open the **Embed Styler** tab and pick an embed — it loads that embed's **default fields as an
editable template** straight away (no waiting for an event). Edit it in the familiar embed editor
(live preview included), save, and the next embed picks up your design.

**Data tokens.** Each embed comes with a catalog of `{tokens}` — the live data you can drop into any
title or field. They're listed with plain-English labels; **click a field box, then a token to
insert it** (no copy-paste). Values resolve live when the embed is sent — straight from the event
plus DB-enriched extras like `{squad}`, `{squadSize}`, `{fame}` and `{money}`, and, for the server
status embed, live figures like `{online}`, `{gameTime}`, `{temperature}` and `{activeSquads}`.

**Two levels of control:**

- **Customize this embed** — apply your colour, title, description, author, thumbnail and image over the default.
- **Replace fields** — take full control of the field list: add, remove and reorder fields, e.g. add **Squad** = `{squad}` to the login embed. Off = the manager's fields are kept.

Footer, timestamp and buttons stay manager / branding controlled and can't be changed here.

**Live embeds too.** Server Status, Players, Leaderboard and Bunkers now expose their full live data as
tokens — e.g. `{onlinePlayers}`, `{serverAddress}`, `{nextRestart}`, `{gameTime}`, `{topPlayer}` for
status; `{list}`/`{count}` for players; every category (`{lb_<category>}`) for the leaderboard;
`{activeList}`/`{lockedList}` for bunkers — so you can rebuild them however you like. They keep the
image you set in the manager unless you set one here.

## Requires

- **Discord Embed Editor** plugin (enable it first — this styler is built on it).
- An active premium subscription (like every manager plugin).

## Covered embeds

**Log feeds:** Player Kill, Event Kill, Economy, Chest, Raid Protection, Login/Logout,
Admin, Gameplay, Fame Points, Quest, Vehicle, Violation.

**Live embeds:** Server Status, Leaderboard, Players, Bunkers.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
