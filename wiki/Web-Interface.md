# Web Interface

The web server serves **two SPAs** on the same port (default `8080`), sharing one "field terminal"
theme (amber on dark, mono readouts):

- **`/admin`** — the admin dashboard (password-protected) — this page.
- **`/`** — the public Field Console — see [Public Field Console](Public-Field-Console).

A **Field Console** link in the admin header jumps to the public site, and the public footer links
back to `/admin`.

## Admin dashboard (`/admin`)

Log in with `WEB_ADMIN_PASSWORD`. After **5 failed attempts** an IP is locked out for 15 minutes.

### Dashboard
- **Vitals** — state, players, server FPS, system CPU & RAM (used/total), entities, service status.
- **Controls** — Start / Stop / Restart / Backup now / Validate files / Check & update.
- **Operations** — next restart (incl. pending **manual** restarts), skip-next-restart toggle,
  last backup, backup stats, installed version, update status.
- **World State** — game time, weather, total players, active squads, vehicles, bases.
- **Online players** — click a name to open that player in the Players screen.
- **Live server log** — streamed over WebSocket (admin-only; not exposed publicly).

### Players
- Search by **name**, **Steam ID** (17 digits) or **IP address**.
- Click a result → full profile: all stats, Steam ID, IP, last login/logout, online state, Discord
  link, ban status.
- **Ban** (with an optional note) or **Unban**. See [Player Management & Bans](Player-Management).

### Settings
Every `config/config.json` option, grouped into collapsible categories with search and expand/
collapse. Saving rewrites `config.json`; launch-argument changes are pushed to the NSSM service.

### Game Settings
- `ServerSettings.ini` editor with correct field types and descriptions from a community reference.
- User lists — admin / banned / exclusive / whitelisted (`*.ini` line lists).
- Raw-JSON editors for `EconomyOverride.json`, `RaidTimes.json`, `Notifications.json`.

### Discord
Post / update the **account-linking panel** to a channel and view linked accounts (click a linked
row → that player's profile).

## Realtime

The dashboard uses Socket.IO. Sensitive streams (`log:line`, full `status:update`, `notification`,
`install:progress`) are emitted **only to the authenticated admin room** — anonymous sockets never
receive them.

## Security notes

- Admin routes are behind session auth; the public API is separate.
- Optional `web.adminAllowlist` adds an IP allowlist on top of the password.
- Set `web.bindAddress` to a private interface if you only want admin on the LAN/VPN.

Next: [Public Field Console](Public-Field-Console) · [Player Management & Bans](Player-Management)
