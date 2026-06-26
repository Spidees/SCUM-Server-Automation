# Exposing to the Internet (domain + HTTPS)

By default the web server binds `0.0.0.0:8080` over **HTTP** and is meant for a local/LAN network.
To put it on a domain with HTTPS, pick **one** of two approaches.

## Option A — Reverse proxy (recommended)

Run **[Caddy](https://caddyserver.com/)** (or nginx) in front. Caddy gets and renews a Let's Encrypt
certificate **and** redirects HTTP→HTTPS automatically.

`Caddyfile`:
```
your-domain.cz {
    reverse_proxy localhost:8080
}
```

Then in `config/config.json`:
```jsonc
"web": {
  "port": 8080,
  "bindAddress": "127.0.0.1",   // only the proxy talks to the app
  "trustProxy": true,           // so rate-limit / allowlist see the real client IP
  "cookieSecure": true,         // cookies only over HTTPS
  "publicUrl": "https://your-domain.cz"
}
```

## Option B — Built-in HTTPS (no proxy)

Provide a key + certificate (e.g. from **win-acme** for Let's Encrypt on Windows, or a Cloudflare
Origin Certificate):

```jsonc
"web": {
  "port": 443,
  "cookieSecure": true,
  "httpRedirectPort": 80,       // 301-redirects HTTP → HTTPS
  "publicUrl": "https://your-domain.cz",
  "ssl": { "enabled": true, "keyFile": "./certs/key.pem", "certFile": "./certs/cert.pem" }
}
```

The app serves TLS directly on `port`, and (if `httpRedirectPort` is set) runs a tiny HTTP listener
that redirects to HTTPS.

> Let's Encrypt certs renew every ~90 days. Caddy renews automatically; with Option B you must renew
> yourself (win-acme can schedule it).

## Keeping admin off the public internet

If you only want the **public Field Console** exposed and the **admin** dashboard private:

- Put admin behind your reverse proxy with an IP allowlist, **and/or** set `web.adminAllowlist`
  (e.g. `["192.168.1.0/24","10.8.0.0/24"]` for LAN/VPN), **and/or**
- bind to a private interface and reach `/admin` only over VPN.

The admin Socket.IO streams (logs/status) are already restricted to authenticated admins.

## Security checklist before going public

- [ ] Strong `WEB_ADMIN_PASSWORD` and `SESSION_SECRET` (not `changeme`).
- [ ] HTTPS in front (Option A or B) and `web.cookieSecure: true`.
- [ ] `web.trustProxy: true` if behind a proxy (else rate-limit/allowlist see the proxy IP).
- [ ] Firewall: only expose the needed ports (80/443, or your proxy's).
- [ ] Optional `web.adminAllowlist` for the admin surface.
- [ ] Set `web.publicUrl` so Discord embeds link to the right address.

## What's already hardened

- Admin login lockout (5 fails → 15 min).
- Per-IP rate limiting on `/api/public`, `/api/player`, `/api/auth/discord`.
- Parameterized SQL (no injection); escaped output (no XSS).
- Player profiles strip Steam IDs / IPs / member online-times.

Next: [Discord Bot](Discord-Bot) · [FAQ](FAQ)
