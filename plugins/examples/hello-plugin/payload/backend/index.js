'use strict';

/**
 * Hello Plugin — a complete, well-commented reference MANAGER plugin.
 *
 * Read it top-to-bottom: every numbered block is one capability, with a short comment saying what it
 * demonstrates and how to use it. Copy this folder, rename it in plugin.json, delete what you don't
 * need. In a real plugin you'd split these into separate files under backend/ — it's one file here so
 * the whole surface is in one place.
 *
 * You only ever touch `host` — the public plugin API. You never require the manager's own modules.
 * Full reference: the Plugin SDK docs at https://scumsa.com/docs · typings in examples/ssa-plugin-sdk.d.ts.
 *
 * Contract:
 *   • register(host)   — called once when the plugin loads (enabled + Premium active).
 *   • unregister(host) — optional; on disable/shutdown. Everything made through host.* (timers,
 *                        listeners, routes, chat commands, the sqlite handle) is cleaned up for you.
 */

module.exports = {
  /** @param {import('../../../ssa-plugin-sdk').Host} host */
  async register(host) {
    // ── 0) Identity + logging ────────────────────────────────────────────────
    // host.info = { id, dir, libDir, dataDir, version, apiVersion }. The logger is auto-prefixed with
    // your id. host.info.dataDir is your writable folder (survives manager updates).
    host.logger.info(`ready — v${host.info.version}`);

    // ── 1) Config (editable on the card's "Config" button) ───────────────────
    // get() parses your config.json; set(patch) merges + persists; onChange fires when an admin saves.
    // Re-read live values in onChange rather than caching cfg once at startup.
    let cfg = host.config.get();                       // { greeting, reportChannelId, welcomeChat }
    host.config.onChange((next) => { cfg = next; host.logger.info(`config saved — greeting "${cfg.greeting}"`); });

    // ── 2) Events: manager lifecycle + parsed game events ────────────────────
    // Listeners are auto-removed on unload. Log a payload once to see its shape.
    host.events.on('server:online',  () => host.logger.info('server came online'));
    host.events.on('server:offline', () => host.logger.info('server went offline'));
    host.events.on('kill',        (e) => host.logger.debug(`kill: ${e.killerName} -> ${e.victimName}`));
    host.events.on('economy',     (e) => host.logger.debug(`economy event: ${JSON.stringify(e).slice(0, 120)}`));
    host.events.on('player:chat', (e) => { if (/\bhello\b/i.test(e.text || '')) host.logger.debug(`${e.name} said hello`); });
    host.events.on('player:intel',(e) => { if (e.riskLevel === 'high') host.logger.warn(`high-risk join: ${e.name} (${e.riskLevel})`); });
    host.events.on('raid:alert',  (e) => host.logger.debug(`raid alert: ${e.type} @ ${JSON.stringify(e.location)}`));

    // ── 3) Databases: the game DB (read-only) + the manager's own data ───────
    // host.db.scum = live SCUM.db (better-sqlite3). Returns null/[] while the server is stopped, so
    // ALWAYS check available() / tolerate empties, and treat it as READ-ONLY.
    // host.db.manager = curated reads over the manager's own data (kills / trades).
    host.routes.get('/players', (req, res) => {
      if (!host.db.scum.available()) return res.json({ online: false, players: [] });
      const rows = host.db.scum.all('SELECT name FROM user_profile LIMIT 20');
      res.json({ online: true, count: rows.length, players: rows.map((r) => r.name) });
    });
    host.routes.get('/recent', (req, res) => res.json({
      kills:  host.db.manager.kills(10),
      trades: host.db.manager.trades(10),
    }));

    // ── 4) Players: resolve who someone is + read their data ─────────────────
    // linked() maps a Discord user to their SCUM character (e.g. from a button click). There are
    // lookups for stats, finances, skills, squad, vehicles, online list, and the Premium risk verdict.
    host.routes.get('/whois/:steamId', (req, res) => {
      const id = String(req.params.steamId);
      res.json({
        profile:  host.players.bySteamId(id),
        stats:    host.players.stats(id),
        finances: host.players.finances(id),          // { cash, bank, gold, accountNumber, cards }
        squad:    host.players.squad(id),
        vehicles: host.players.vehicles(id),
        intel:    host.players.intel(id),             // Player Intelligence (Premium) or null
      });
    });

    // ── 5) Item / vehicle / animal database (names + images, like the manager) ──
    // host.items fronts the same item/vehicle database the manager uses. name(code) → a localized
    // display name; image(code) → an icon URL from the scumsa item DB (Premium — null on the free
    // tier); image(code, 'vicinity') → the cleaner ground-view icon (weapons/vehicles). Works for
    // items, vehicles, animals, zombies and NPCs by class code. Feed the URL straight into an embed's
    // setThumbnail()/setImage() (see §12), exactly like the kill feed shows a weapon image.
    host.routes.get('/item/:code', (req, res) => {
      const code = String(req.params.code);
      res.json({
        name:  host.items.name(code),
        image: host.items.image(code),
        icon:  host.items.image(code, 'vicinity'),
        resolved: host.items.resolve(code),          // { name, image, imageVicinity }
      });
    });

    // ── 6) Live map + world data ─────────────────────────────────────────────
    // world() = positions of players/vehicles/bases/chests; container(id) = a chest's contents;
    // isInOwnerArea() = is a point inside a player's (or their squad's) base flag rectangle.
    host.routes.get('/world', (req, res) => res.json(host.map.world() || { players: [], vehicles: [] }));

    // ── 7) Leaderboards, economy, server stats ───────────────────────────────
    host.routes.get('/top', (req, res) => res.json(host.leaderboards.get('top_players', 10)));
    host.routes.get('/eco', (req, res) => res.json({ trader: host.economy.traderFunds(), gold: host.economy.goldCapacity() }));
    host.routes.get('/stats', (req, res) => res.json({
      online: host.stats.onlineCount(), vehicles: host.stats.vehicleCount(),
      bases: host.stats.baseCount(), squads: host.stats.squadCount(), weather: host.stats.weather(),
    }));

    // ── 8) A PUBLIC route (no login) for your Field Console frontend ─────────
    host.routes.public.get('/hello', (req, res) => res.json({ hello: host.config.get().greeting }));

    // ── 9) Persistence: key/value store + a real SQLite DB ───────────────────
    // store = tiny JSON survives restarts. sqlite(name) = full read/write DB in your dataDir (prepared
    // statements, no native module to bundle). Both are kept across manager updates.
    const boots = host.store.get('boots', 0) + 1;
    host.store.set('boots', boots);
    const db = host.sqlite('greets.db');               // dataDir/greets.db, closed for you on unload
    if (db) db.prepare('CREATE TABLE IF NOT EXISTS greets (steamId TEXT, name TEXT, at INTEGER)').run();

    // ── 10) In-game chat + a /command (via the SSA Bridge) ───────────────────
    // Greet players the instant they spawn in (live, no log lag). send/broadcast/dm push chat lines;
    // pass { name } for a "Nick: text" prefix; { targets } / { exclude } are SteamID arrays; { channel }
    // ∈ local/global/squad/admin/server. onCommand registers a /command — hidden in-game, kept out of
    // the Discord relay, and it replies only to its sender.
    host.players.onJoin(({ steamId, playerName }) => {
      if (db) db.prepare('INSERT INTO greets VALUES (?,?,?)').run(steamId, playerName, boots);
      if (cfg.welcomeChat) host.chat.dm(steamId, `${cfg.greeting}, ${playerName}!`, { name: 'SERVER' });
    });
    host.chat.onCommand('online', (ctx) => {
      // ctx = { steamId, name, channel, command, args, argString, reply(text, {channel?}) }
      ctx.reply(`Players online: ${host.stats.onlineCount()}`);
    });

    // ── 11) In-game control through the SSA Bridge ───────────────────────────
    // host.server.command(cmd) runs an admin command in-game. Pre-check host.server.bridge() and check
    // the returned { ok, error }. For a command with no Location arg (spawns on the caller), pass an
    // executor SteamID so it runs THROUGH that online player. The Bridge is a UE4SS mod — a manager
    // plugin "uses the Bridge" simply by calling this. For a hard requirement add
    // "dependencies": ["ssa-bridge"] to plugin.json (see README).
    host.routes.post('/announce', async (req, res) => {
      const health = await host.server.bridge();       // { available, licensed, players, version }
      if (!health.available) return res.status(503).json({ error: 'SSA Bridge is offline' });
      const r = await host.server.command(`#Announce ${String((req.body && req.body.text) || 'Hello')}`);
      res.json(r.ok ? { ok: true } : { error: r.error || 'command failed' });
    });
    host.chat.onCommand('kit', async (ctx) => {        // /kit — spawns on the sender via executor
      const r = await host.server.command('#SpawnItem 1_9mm_Handgun 1', { executor: ctx.steamId });
      ctx.reply(r.ok ? 'Kit delivered.' : 'The bridge is offline right now.');
    });

    // ── 12) Discord: your own message, a button, a slash command, DMs ────────
    // You get the whole of discord.js via host.discord.js. Namespace your customIds with your id.
    if (host.discord.enabled() && cfg.reportChannelId) {
      const { ButtonStyle } = host.discord.js;
      const embed = host.discord.embed().setTitle(`${host.info.id} online`).setColor(0xff6a1a)
        .addFields({ name: 'Greeting', value: String(cfg.greeting) }).setTimestamp();
      // Load an item/vehicle image the same way the manager does and show it in the embed:
      const img = host.items.image('BPC_Kar98', 'vicinity');   // → an icon URL (Premium), or null
      if (img) embed.setThumbnail(img);
      const row = host.discord.row(
        host.discord.button({ id: `${host.info.id}:ping`, label: 'Who is online', style: ButtonStyle.Secondary }),
      );
      await host.discord.send(cfg.reportChannelId, { embeds: [embed], components: [row] });
    }
    // Only the clicker sees this. Use the flag, not the old `ephemeral: true` option — discord.js
    // deprecated it and logs a warning on every reply.
    host.discord.onButton(`${host.info.id}:ping`, (i) => i.reply({
      content: `Online: ${host.stats.onlineCount()}`,
      flags: host.discord.js.MessageFlags.Ephemeral,
    }));
    host.discord.registerSlash({ name: 'hello', description: 'Say hello' }, (i) => i.reply(`${cfg.greeting}!`));
    host.discord.onMessage((m) => { if (!m.author.bot && /ping/i.test(m.content)) m.reply('pong'); });

    // ── 12b) Add a field to the manager's OWN feed embeds ────────────────────
    // kind ∈ kill/economy/login/gameplay/chest/vehicle/raid/quest/fame/violation/eventkill/admin and
    // the live embeds status/leaderboard/players/bunker. Mutate the EmbedBuilder or return a new one.
    host.discord.onEmbed('kill', (embed) => embed.addFields({ name: 'via', value: host.info.id, inline: true }));

    // ── 13) Scheduling, notifications, live data to admin panels ─────────────
    // Timers auto-clear on unload. notify() rides the manager's own pipeline (Discord + admin panels).
    // realtime.toAdmins pushes a live event your web/plugin.js receives with SSA.socket.on(...).
    host.schedule.every(6 * 60 * 60 * 1000, () => host.notify('admin.alert', { level: 'info', message: `Hello tick — ${host.stats.onlineCount()} online` }));
    host.schedule.every(30 * 1000, () => host.realtime.toAdmins('hello:tick', { online: host.stats.onlineCount() }));

    // ── 14) Expose a service other plugins can consume ───────────────────────
    // Another plugin's backend calls host.consume('hello').greet(name). Keep it small + stable.
    host.provide('hello', { greet: (name) => `${host.config.get().greeting}, ${name}!` });

    host.logger.info(`registered (start #${boots}) — click Open on the card, and try /online in game`);
  },

  async unregister(host) {
    // Only undo things you set up OUTSIDE host.* — the rest is torn down for you.
    host.logger.info('goodbye');
  },
};
