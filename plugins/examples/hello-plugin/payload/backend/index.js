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
 *
 * Every screen and route here works with the game server STOPPED. Owners set a plugin up before they
 * start the server, so live data may enrich a screen and must never gate one.
 */

// The defaults live HERE. payload/config.json is the owner's copy of them, and the manager hands you
// `{}` for a config file that is missing, half-written or older than this version. Merge by KEY
// PRESENCE, never truthiness: `"greeting": ""` is an owner's choice and must stay empty.
const DEFAULTS = { greeting: 'Hello', reportChannelId: '', welcomeChat: false, happyHour: [] };
const withDefaults = (c) => {
  const out = { ...DEFAULTS };
  for (const k of Object.keys(c || {})) out[k] = c[k];
  return out;
};

module.exports = {
  /** @param {import('../../../ssa-plugin-sdk').Host} host */
  async register(host) {
    // ── 0) Identity + logging ────────────────────────────────────────────────
    // host.info = { id, dir, libDir, dataDir, version, apiVersion }. The logger is auto-prefixed with
    // your id. host.info.dataDir is your writable folder (survives manager updates). host.paths.root is
    // the manager's data root; never write outside your own dataDir.
    host.logger.info(`ready — v${host.info.version} on API ${host.info.apiVersion}, data in ${host.info.dataDir}`);

    // ── 1) Config (editable on the card's "Config" button) ───────────────────
    // get() parses config.json; set(patch) merges + saves (and THROWS if it cannot save); onChange
    // fires on every save. Re-read live values in onChange rather than caching once at startup.
    let cfg = withDefaults(host.config.get());
    host.config.onChange((next) => { cfg = withDefaults(next); host.logger.info(`config saved — greeting "${cfg.greeting}"`); });
    host.routes.get('/config', (req, res) => res.json(cfg));
    host.routes.post('/config', (req, res) => {
      const greeting = req.body && typeof req.body.greeting === 'string' ? req.body.greeting.slice(0, 80) : null;
      if (greeting === null) return res.status(400).json({ error: 'bad_greeting', reason: 'send { greeting: "…" }' });
      try { cfg = withDefaults(host.config.set({ greeting })); res.json(cfg); }
      catch (e) { res.status(500).json({ error: 'save_failed', reason: `the config could not be saved: ${e.message}` }); }
    });

    // ── 2) Events: manager lifecycle + parsed game events ────────────────────
    // Listeners are auto-removed on unload. Log a payload once to see its shape. Kill names are a
    // player's name OR a spawn class: host.items.actorName() tells them apart, the way the kill feed does.
    host.events.on('server:online',  () => host.logger.info('server came online'));
    host.events.on('server:offline', () => host.logger.info('server went offline'));
    host.events.on('kill', (e) => host.logger.debug(`kill: ${host.items.actorName(e.killerName)} -> ${host.items.actorName(e.victimName)}`));
    host.events.on('economy',     (e) => host.logger.debug(`economy event: ${JSON.stringify(e).slice(0, 120)}`));
    // player:chat is a line the MANAGER put in game ({ nickname, message, type, steamId }), not players' chat.
    host.events.on('player:chat', (e) => host.logger.debug(`${e.nickname}: ${e.message}`));
    host.events.on('player:intel',(e) => { if (e.riskLevel === 'high') host.logger.warn(`high-risk join: ${e.name}`); });
    host.events.on('raid:alert',  (e) => host.logger.debug(`raid alert: ${e.type} @ ${JSON.stringify(e.location)}`));
    host.events.once('backup:completed', () => host.logger.info('first backup since load finished'));
    // Your own events: a name without ':' is prefixed with your id ("ready" → "hello-plugin:ready").
    host.events.emit('ready', { at: Date.now() });

    // ── 3) Databases: the game DB (read-only) + the manager's own data ───────
    // host.db.scum = live SCUM.db (better-sqlite3). null/[] while the server is stopped, so check
    // available() and SAY which of the two it was: "not readable" is not "empty".
    host.routes.get('/players', (req, res) => {
      if (!host.db.scum.available()) return res.json({ readable: false, players: [] });
      const rows = host.db.scum.all(host.db.scum.excludeDeleted('SELECT name, user_id AS steamId FROM user_profile LIMIT 50'));
      res.json({ readable: true, players: rows });
    });
    host.routes.get('/recent', (req, res) => res.json({ kills: host.db.manager.kills(10), trades: host.db.manager.trades(10) }));

    // ── 4) Players: resolve who someone is + read their data ─────────────────
    host.routes.get('/whois/:steamId', (req, res) => {
      const id = String(req.params.steamId);
      res.json({
        profile:  host.players.bySteamId(id),         // { steamId, playerName, discordUserId, … } or null
        stats:    host.players.stats(id),
        finances: host.players.finances(id),          // { cash, bank, gold, accountNumber, cards }
        squad:    host.players.squad(id),
        vehicles: host.players.vehicles(id),
        intel:    host.players.intel(id),             // Player Intelligence (Premium) or null
      });
    });

    // ── 5) Item / vehicle / animal database (names + images, like the manager) ──
    // name(code) → the game's own name in the owner's language; image(code) → an icon URL (Premium,
    // null on the free tier). Never print a class code: there is one resolver, and this is it.
    host.routes.get('/item/:code', (req, res) => {
      const code = String(req.params.code);
      res.json({ name: host.items.name(code), image: host.items.image(code), icon: host.items.image(code, 'vicinity'), resolved: host.items.resolve(code) });
    });

    // ── 6) Live map + world data ─────────────────────────────────────────────
    host.routes.get('/world', (req, res) => res.json(host.map.world() || { players: [], vehicles: [] }));
    host.routes.get('/sector', async (req, res) => res.json({ sector: await host.map.sector(Number(req.query.x), Number(req.query.y)) }));

    // ── 7) Leaderboards, economy, server stats, {tokens} ─────────────────────
    host.routes.get('/top', (req, res) => res.json(host.leaderboards.get('top_players', 10)));
    host.routes.get('/eco', (req, res) => res.json({ trader: host.economy.traderFunds(), gold: host.economy.goldCapacity() }));
    host.routes.get('/stats', (req, res) => res.json({
      online: host.stats.onlineCount(), vehicles: host.stats.vehicleCount(),
      bases: host.stats.baseCount(), squads: host.stats.squadCount(), weather: host.stats.weather(),
      running: host.server.isRunning(),
      // host.data renders the same {tokens} the manager's own embeds use.
      line: host.data ? host.data.render('{serverName}: {online} online', {}) : null,
    }));

    // ── 8) A PUBLIC route (no login) for your Field Console frontend ─────────
    host.routes.public.get('/hello', (req, res) => res.json({ hello: cfg.greeting }));

    // ── 8b) A SIGNED-IN route: only a visitor signed in on the Field Console (or an admin) gets in ──
    // Anybody else gets 401 { error: 'login_required', reason } and your handler never runs.
    // req.visitor = { steamId, discordId, name, via, admin, groups }; steamId is null until linked.
    // Feature-detect: a manager older than the signed-in routes has no host.routes.player.
    if (host.routes.player) host.routes.player.get('/me', (req, res) => res.json({ name: req.visitor.name, steamId: req.visitor.steamId }));

    // ── 9) Persistence: key/value store + a real SQLite DB ───────────────────
    const boots = host.store.get('boots', 0) + 1;
    host.store.set('boots', boots);
    const db = host.sqlite('greets.db');               // dataDir/greets.db, closed for you on unload
    if (db) db.prepare('CREATE TABLE IF NOT EXISTS greets (steamId TEXT, name TEXT, at INTEGER)').run();

    // ── 10) In-game chat + a /command (via the SSA Bridge) ───────────────────
    // send/broadcast/dm REJECT when nothing was sent (bridge down, server stopped): always catch.
    // { targets } makes a line private; { channel } only sets how it looks.
    host.players.onJoin(({ steamId, playerName }) => {
      if (db) db.prepare('INSERT INTO greets VALUES (?,?,?)').run(steamId, playerName, boots);
      if (cfg.welcomeChat) {
        host.chat.dm(steamId, `${cfg.greeting}, ${playerName}!`, { name: 'SERVER' })
          .catch((e) => host.logger.debug(`welcome not sent: ${e.message}`));
      }
    });
    host.chat.onCommand('online', (ctx) => ctx.reply(`Players online: ${host.stats.onlineCount()}`), {
      // What /help shows for this command without spending an attempt.
      status: () => ({ ready: true }),
    });

    // ── 10b) Time windows — on the SERVER'S wall clock, not the game's day ───
    // An empty schedule is always open. Show describe() verbatim rather than writing your own caption.
    host.chat.onCommand('happyhour', (ctx) => {
      if (!host.time) return ctx.reply('This manager is too old for time windows.');   // feature-detect
      const st = host.time.isOpen(cfg.happyHour);
      ctx.reply(st.open ? `Happy hour is on. ${st.why}` : `Not now. ${host.time.describe(cfg.happyHour)}`);
    });

    // ── 11) In-game control through the SSA Bridge ───────────────────────────
    // host.server.command(cmd) runs an admin command, WITHOUT the chat '#'. It answers, never throws.
    // `ok` is not success: `confirmed === false` means the line was handed to the game and nothing
    // confirmed it ran. Never charge, consume or announce on that.
    host.routes.post('/announce', async (req, res) => {
      const health = await host.server.bridge();       // { available, licensed, players, version }
      if (!health.available) return res.status(503).json({ error: 'bridge_off', reason: 'the SSA Bridge is not answering, so nothing was sent' });
      const r = await host.server.command(`Announce ${String((req.body && req.body.text) || cfg.greeting)}`);
      if (!r.ok) return res.status(502).json({ error: 'command_failed', reason: r.error || 'the game refused the command' });
      res.json({ ok: true, confirmed: r.confirmed !== false });
    });
    host.chat.onCommand('kit', async (ctx) => {        // /kit — spawns on the sender via executor
      const r = await host.server.command('SpawnItem Weapon_M1911 1', { executor: ctx.steamId });
      if (r.ok && r.confirmed !== false) ctx.reply('Kit delivered.');
      else ctx.reply(r.ok ? 'The game did not confirm the kit, so it may not have arrived.' : 'The bridge is offline right now.');
    });
    // A named bridge read: async, `null` on any failure, never throws. Declare what you need switched
    // on in plugin.json "bridge" so the owner can turn it on in one click.
    host.routes.get('/live', async (req, res) => {
      const up = await host.bridge.available();
      res.json({ bridge: up, players: up ? await host.bridge.livePlayers() : null });
    });

    // ── 12) Discord: your own message, a button, a slash command, DMs ────────
    if (host.discord.enabled() && cfg.reportChannelId) {
      const { ButtonStyle } = host.discord.js;
      const embed = host.discord.embed().setTitle(`${host.info.id} online`).setColor(0xff6a1a)
        .addFields({ name: 'Greeting', value: String(cfg.greeting) }).setTimestamp();
      const img = host.items.image('BPC_Kar98', 'vicinity');   // an icon URL (Premium), or null
      if (img) embed.setThumbnail(img);
      const row = host.discord.row(host.discord.button({ id: `${host.info.id}:ping`, label: 'Who is online', style: ButtonStyle.Secondary }));
      // send() answers with the message, or false; it does not throw, so read the answer.
      const sent = await host.discord.send(cfg.reportChannelId, { embeds: [embed], components: [row] });
      if (!sent) host.logger.warn(`could not post to channel ${cfg.reportChannelId}; check the id and the bot's access`);
    }
    host.discord.onButton(`${host.info.id}:ping`, (i) => i.reply({ content: `Online: ${host.stats.onlineCount()}`, flags: host.discord.js.MessageFlags.Ephemeral }));
    host.discord.registerSlash({ name: 'hello', description: 'Say hello' }, (i) => i.reply(`${cfg.greeting}!`));
    host.discord.onMessage((m) => { if (!m.author.bot && /^ping$/i.test(m.content)) m.reply('pong'); });

    // ── 12b) Add a field to the manager's OWN feed embeds ────────────────────
    host.discord.onEmbed('kill', (embed) => embed.addFields({ name: 'via', value: host.info.id, inline: true }));

    // ── 13) Scheduling, notifications, live data to admin panels ─────────────
    // Timers auto-clear on unload. realtime.toAdmins pushes an event web/plugin.js hears via SSA.socket.on().
    host.schedule.every(6 * 60 * 60 * 1000, () => host.notify('admin.alert', { level: 'info', message: `Hello tick — ${host.stats.onlineCount()} online` }));
    host.schedule.every(30 * 1000, () => host.realtime.toAdmins('hello:tick', { online: host.stats.onlineCount() }));
    host.schedule.after(5000, () => host.logger.debug(`premium is ${host.premium.active() ? 'active' : 'off'}`));

    // ── 14) Services between plugins ─────────────────────────────────────────
    // Another plugin calls host.consume('hello').greet(name). consume() answers null when that plugin
    // is absent, which is what "optionalDependencies" relies on.
    host.provide('hello', { greet: (name) => `${cfg.greeting}, ${name}!` });
    const embeds = host.consume('discord-embeds');
    if (embeds) host.logger.debug('discord-embeds is installed');

    // ── 15) Cleanup for anything you made OUTSIDE host.* ─────────────────────
    host.onUnload(() => host.logger.debug('onUnload ran'));

    host.logger.info(`registered (start #${boots}) — click Open on the card, and try /online in game`);
  },

  async unregister(host) {
    // Only undo things you set up OUTSIDE host.* — the rest is torn down for you.
    host.logger.info('goodbye');
  },
};
