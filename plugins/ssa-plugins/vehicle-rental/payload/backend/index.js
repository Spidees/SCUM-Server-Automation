'use strict';

// Vehicle Rental System — players rent vehicles via the Discord bot. Fully admin-configurable
// (vehicles, durations, money/gold prices, channel, spawn/remove commands, the menu embed).
// In-game spawn/remove are COMMAND TEMPLATES so they match whatever your server/bridge supports;
// placeholders: {code} {x} {y} {z} {steamid} {vehId}. Currency is charged with the known
// #ChangeCurrencyBalance command.

const OPEN = 'vr:open', VEH = 'vr:veh', OPT = 'vr:opt', EXT = 'vr:ext';

function fill(tpl, vars) { return String(tpl || '').replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : ''; }); }
function fmtDur(min) { min = Math.max(1, parseInt(min, 10) || 0); if (min < 60) return min + ' min'; const h = Math.floor(min / 60), m = min % 60; return h + 'h' + (m ? ' ' + m + 'm' : ''); }
function money(o) { return (o.amount || 0) + ' ' + (o.currency === 'gold' ? 'gold' : 'money'); }

module.exports = {
  async register(host) {
    const db = host.sqlite('rentals.db');
    if (db) db.exec('CREATE TABLE IF NOT EXISTS rentals (id INTEGER PRIMARY KEY AUTOINCREMENT, discordId TEXT, steamId TEXT, playerName TEXT, vehIdx TEXT, vehName TEXT, vehId TEXT, optIdx INTEGER, startedAt INTEGER, expiresAt INTEGER, reminded INTEGER DEFAULT 0, extensions INTEGER DEFAULT 0, active INTEGER DEFAULT 1)');
    // best-effort migration for older DBs
    if (db) { try { db.exec('ALTER TABLE rentals ADD COLUMN extensions INTEGER DEFAULT 0'); } catch (e) {} }

    function defaultConfig() {
      return {
        enabled: true,
        free: false,            // free rentals — no in-game charge; hides/ignores all prices
        channelId: '', buttonLabel: '🚗 Rent a vehicle',
        menuEmbed: { title: '🚗 Vehicle Rental', description: 'Rent a vehicle directly through the bot — no admin needed.\nClick the button below to choose a vehicle, pick how long you want it, and pay in-game.', color: '#ff6a1a' },
        maxPerPlayer: 1,        // max simultaneously active rentals per player
        cooldownMinutes: 0,     // how often a player may rent (wait after their last rental started; 0 = no limit)
        dailyLimit: 0,          // max rentals per player per 24h (0 = unlimited)
        requireOnline: false,   // only allow renting while the player is online in-game
        allowExtend: true,      // show the Extend button on reminders
        maxExtensions: 0,       // cap extensions per rental (0 = unlimited)
        reminderMinutes: 10,
        // Real SCUM admin-command syntax (verified in-game): quantity 1 + a Location arg in the
        // quoted `Location "X=.. Y=.. Z=.."` form. (The bare `Location 1 2 3` form crashes the server.)
        spawnCmd: '#SpawnVehicle {code} 1 Location "X={x} Y={y} Z={z}"',
        removeCmd: '#DestroyVehicle {vehId}',
        vehicles: [],
      };
    }
    const cfg = () => Object.assign(defaultConfig(), host.store.get('config', {}));
    const setCfg = (c) => host.store.set('config', Object.assign(defaultConfig(), c || {}));

    function playerLoc(steamId) {
      try {
        const w = host.map.world() || {};
        const list = w.players || w.player || [];
        const p = (Array.isArray(list) ? list : []).find(function (pl) { return String(pl.steamId || pl.steamid || pl.SteamID) === String(steamId); });
        if (p) return { x: Math.round(p.x || 0), y: Math.round(p.y || 0), z: Math.round(p.z || 0) };
      } catch (e) {}
      return { x: 0, y: 0, z: 0 };
    }
    // true / false / null(unknown) — best-effort online check
    function isOnline(steamId) {
      try {
        const list = host.players.online();
        if (!Array.isArray(list) || !list.length) return null;
        return list.some(function (p) { return String(p.steamId || p.steamid || p.SteamID || p.steam_id) === String(steamId); });
      } catch (e) { return null; }
    }
    // best-effort: the newest vehicle nearest the spawn point (so auto-removal can target it)
    async function captureVehicleId(loc) {
      try {
        await new Promise(function (r) { setTimeout(r, 1500); });
        const w = host.map.world() || {};
        const vs = w.vehicles || [];
        let best = null, bestD = 1e9;
        (Array.isArray(vs) ? vs : []).forEach(function (v) { const d = Math.hypot((v.x || 0) - loc.x, (v.y || 0) - loc.y); if (d < bestD) { bestD = d; best = v; } });
        return (best && bestD < 3000) ? String(best.id != null ? best.id : '') : '';
      } catch (e) { return ''; }
    }

    // ── admin routes ──
    host.routes.get('/config', function (req, res) { res.json(cfg()); });
    host.routes.post('/config', function (req, res) { setCfg(req.body || {}); res.json({ ok: true }); });
    host.routes.get('/rentals', function (req, res) { res.json(db ? db.prepare('SELECT * FROM rentals WHERE active=1 ORDER BY expiresAt').all() : []); });
    host.routes.get('/channels', async function (req, res) {
      const c = host.discord.client(); if (!c) return res.json([]);
      try { const g = c.guilds.cache.first(); if (!g) return res.json([]); const all = await g.channels.fetch(); const out = []; all.forEach(function (ch) { if (ch && ch.type === 0) out.push({ id: ch.id, name: ch.name }); }); out.sort(function (a, b) { return a.name.localeCompare(b.name); }); res.json(out); }
      catch (e) { res.json([]); }
    });
    host.routes.post('/post-menu', async function (req, res) { const ok = await postMenu(); res.json({ ok: !!ok }); });

    async function postMenu() {
      const c = cfg(); if (!c.channelId) return false;
      const ed = host.consume('embed-editor');
      const embed = ed ? ed.embed(c.menuEmbed) : host.discord.embed().setTitle((c.menuEmbed && c.menuEmbed.title) || 'Vehicle Rental');
      const B = host.discord.js;
      const row = host.discord.row(new B.ButtonBuilder().setCustomId(OPEN).setLabel(c.buttonLabel || 'Rent a vehicle').setStyle(B.ButtonStyle.Success));
      return host.discord.send(c.channelId, { embeds: [embed], components: [row] });
    }

    // ── Discord flow ──
    host.discord.onInteraction(async function (i) {
      try {
        if (i.isButton && i.isButton()) {
          if (i.customId === OPEN) return openVehicleMenu(i);
          if (i.customId.indexOf(EXT + ':') === 0) return doExtend(i, i.customId.slice((EXT + ':').length));
        }
        if (i.isStringSelectMenu && i.isStringSelectMenu()) {
          if (i.customId === VEH) return openDurationMenu(i, i.values[0]);
          if (i.customId.indexOf(OPT + ':') === 0) return processRental(i, i.customId.slice((OPT + ':').length), i.values[0]);
        }
      } catch (e) { host.logger.error('interaction: ' + e.message); try { if (!i.replied && !i.deferred) await i.reply({ content: 'Something went wrong.', ephemeral: true }); } catch (x) {} }
    });

    async function openVehicleMenu(i) {
      const c = cfg();
      if (c.enabled === false) return i.reply({ content: '🚧 Vehicle rentals are currently disabled.', ephemeral: true });
      if (!c.vehicles.length) return i.reply({ content: 'No vehicles are available right now.', ephemeral: true });
      const B = host.discord.js;
      const menu = new B.StringSelectMenuBuilder().setCustomId(VEH).setPlaceholder('Choose a vehicle')
        .addOptions(c.vehicles.slice(0, 25).map(function (v, idx) { return { label: (v.name || ('Vehicle ' + idx)).slice(0, 100), value: String(idx), description: ((v.options || []).length + ' plan(s)').slice(0, 100) }; }));
      return i.reply({ content: 'Pick a vehicle to rent:', components: [host.discord.row(menu)], ephemeral: true });
    }
    async function openDurationMenu(i, vehIdx) {
      const c = cfg(); const v = c.vehicles[Number(vehIdx)];
      if (!v || !(v.options || []).length) return i.update({ content: 'That vehicle has no rental plans.', components: [] });
      const B = host.discord.js;
      const menu = new B.StringSelectMenuBuilder().setCustomId(OPT + ':' + vehIdx).setPlaceholder('Choose a plan')
        .addOptions(v.options.slice(0, 25).map(function (o, oi) { return { label: (fmtDur(o.minutes) + ' — ' + (c.free ? 'Free' : money(o))).slice(0, 100), value: String(oi) }; }));
      return i.update({ content: 'Renting **' + (v.name || 'vehicle') + '** — choose a plan:', components: [host.discord.row(menu)] });
    }

    async function processRental(i, vehIdx, optIdx) {
      const c = cfg(); const v = c.vehicles[Number(vehIdx)]; const o = v && (v.options || [])[Number(optIdx)];
      if (!v || !o) return i.update({ content: 'Invalid selection.', components: [] });
      if (c.enabled === false) return i.update({ content: '🚧 Vehicle rentals are currently disabled.', components: [] });
      if (!v.code) return i.update({ content: '🛠️ This vehicle isn’t fully set up yet (missing spawn code). Please tell an admin.', components: [] });
      const prof = host.players.linked(i.user.id);
      if (!prof || !prof.steamId) return i.update({ content: '⚠️ Link your SCUM character to Discord first (on the Field Console), then try again.', components: [] });
      if (db) {
        const vi = String(vehIdx);
        // per-vehicle overrides (blank = use the global limit); when a vehicle sets its own limit,
        // the count is scoped to THAT vehicle, otherwise it counts across all vehicles.
        const pv = (field) => (v[field] != null && v[field] !== '' ? Number(v[field]) : null);
        const mMax = pv('maxPerPlayer'), mCd = pv('cooldownMinutes'), mDl = pv('dailyLimit');
        const effMax = mMax != null ? mMax : (c.maxPerPlayer || 1);
        const nActive = mMax != null
          ? db.prepare('SELECT COUNT(*) n FROM rentals WHERE active=1 AND discordId=? AND vehIdx=?').get(i.user.id, vi).n
          : db.prepare('SELECT COUNT(*) n FROM rentals WHERE active=1 AND discordId=?').get(i.user.id).n;
        if (effMax > 0 && nActive >= effMax) return i.update({ content: 'You already have the maximum active rentals (' + effMax + ')' + (mMax != null ? ' for this vehicle' : '') + '.', components: [] });
        const effCd = mCd != null ? mCd : c.cooldownMinutes;
        if (effCd) {
          const last = mCd != null
            ? db.prepare('SELECT MAX(startedAt) m FROM rentals WHERE discordId=? AND vehIdx=?').get(i.user.id, vi).m
            : db.prepare('SELECT MAX(startedAt) m FROM rentals WHERE discordId=?').get(i.user.id).m;
          if (last && (Date.now() - last) < effCd * 60000) return i.update({ content: '⏳ You are renting too often — you can rent again <t:' + Math.floor((last + effCd * 60000) / 1000) + ':R>.', components: [] });
        }
        const effDl = mDl != null ? mDl : c.dailyLimit;
        if (effDl) {
          const day = mDl != null
            ? db.prepare('SELECT COUNT(*) n FROM rentals WHERE discordId=? AND vehIdx=? AND startedAt >= ?').get(i.user.id, vi, Date.now() - 86400000).n
            : db.prepare('SELECT COUNT(*) n FROM rentals WHERE discordId=? AND startedAt >= ?').get(i.user.id, Date.now() - 86400000).n;
          if (day >= effDl) return i.update({ content: '📵 You reached the rental limit (' + effDl + '/day' + (mDl != null ? ' for this vehicle' : '') + ').', components: [] });
        }
      }
      if (c.requireOnline && isOnline(prof.steamId) === false) return i.update({ content: '🔌 You must be online in-game to rent a vehicle.', components: [] });
      // need a valid in-game position — never spawn a phantom vehicle at 0,0,0
      const loc = playerLoc(prof.steamId);
      if (!loc || (!loc.x && !loc.y && !loc.z)) return i.update({ content: '📍 I couldn’t find you in-game. Get online and fully spawned in, then try again.', components: [] });
      // funds pre-check — refuse (and don’t spawn) if the player can’t afford it
      if (!c.free) {
        const need = Math.max(0, parseInt(o.amount, 10) || 0);
        const unit = o.currency === 'gold' ? 'gold' : 'money';
        const fin = host.players.finances(prof.steamId) || {};
        const have = o.currency === 'gold' ? (fin.gold || 0) : (fin.bank || 0);
        if (have < need) return i.update({ content: '💸 Not enough ' + unit + ' — this rental costs **' + need + ' ' + unit + '**, you have **' + have + '**.', components: [] });
      }
      await i.update({ content: '⏳ Processing your rental…', components: [] });
      // spawn FIRST and verify it worked; only charge on success, so an offline/failed bridge never bills the player
      // offset ~3m to the side so the vehicle doesn't spawn on the renter's head (crushing them)
      const spawnRes = await host.server.command(fill(c.spawnCmd, { code: v.code || '', x: loc.x + 300, y: loc.y, z: loc.z, steamid: prof.steamId }));
      if (!spawnRes || spawnRes.ok === false) {
        const reason = (spawnRes && /unavailable|offline|refused/i.test(String(spawnRes.error || ''))) ? 'the in-game bridge is offline' : 'the vehicle couldn’t be spawned';
        try { await i.editReply({ content: '⚠️ Rental failed — ' + reason + '. You were **not** charged.', embeds: [] }); } catch (e) {}
        return;
      }
      await charge(prof.steamId, o);
      const vehId = await captureVehicleId(loc);
      if (!vehId) host.logger.warn('rental: could not capture a vehicle id for "' + (v.name || '?') + '" — auto-removal at expiry will be skipped');
      const now = Date.now(), exp = now + (parseInt(o.minutes, 10) || 60) * 60000;
      if (db) db.prepare('INSERT INTO rentals (discordId,steamId,playerName,vehIdx,vehName,vehId,optIdx,startedAt,expiresAt) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(i.user.id, prof.steamId, prof.name || prof.discordUsername || '', String(vehIdx), v.name || '', vehId || '', Number(optIdx), now, exp);
      const embed = confirmEmbed(v, o, exp);
      try { await i.editReply({ content: '', embeds: [embed] }); } catch (e) {}
      try { await host.discord.dm(i.user.id, { embeds: [embed] }); } catch (e) {}
      host.notify('admin.alert', { message: 'Vehicle rented: ' + (v.name || '?') + ' by ' + (prof.name || i.user.id), severity: 'info' });
    }

    async function charge(steamId, o) {
      if (cfg().free) return;   // free mode — no in-game charge
      const amount = Math.max(0, parseInt(o.amount, 10) || 0);
      const cur = o.currency === 'gold' ? 'Gold' : 'Normal';
      if (amount > 0) await host.server.command('#ChangeCurrencyBalance ' + cur + ' -' + amount + ' ' + steamId);
    }

    async function doExtend(i, rentalId) {
      if (!db) return;
      const r = db.prepare('SELECT * FROM rentals WHERE id=? AND active=1').get(Number(rentalId));
      if (!r) return i.reply({ content: 'That rental is no longer active.', ephemeral: true });
      const c = cfg();
      if (c.allowExtend === false) return i.reply({ content: 'Extensions are turned off.', ephemeral: true });
      const v = c.vehicles[Number(r.vehIdx)]; const o = v && (v.options || [])[Number(r.optIdx)];
      const effMaxExt = (v && v.maxExtensions != null && v.maxExtensions !== '') ? Number(v.maxExtensions) : c.maxExtensions;
      if (effMaxExt && (r.extensions || 0) >= effMaxExt) return i.reply({ content: 'This rental has reached the maximum number of extensions (' + effMaxExt + ').', ephemeral: true });
      if (!o) return i.reply({ content: 'This plan is no longer available.', ephemeral: true });
      if (!c.free) {
        const need = Math.max(0, parseInt(o.amount, 10) || 0);
        const unit = o.currency === 'gold' ? 'gold' : 'money';
        const fin = host.players.finances(r.steamId) || {};
        const have = o.currency === 'gold' ? (fin.gold || 0) : (fin.bank || 0);
        if (have < need) return i.reply({ content: '💸 Not enough ' + unit + ' to extend — needs ' + need + ' ' + unit + ', you have ' + have + '.', ephemeral: true });
      }
      await charge(r.steamId, o);
      const exp = Math.max(Date.now(), r.expiresAt) + (parseInt(o.minutes, 10) || 60) * 60000;
      db.prepare('UPDATE rentals SET expiresAt=?, reminded=0, extensions=extensions+1 WHERE id=?').run(exp, r.id);
      return i.reply({ content: '🔄 Rental extended! New expiry: <t:' + Math.floor(exp / 1000) + ':R>', ephemeral: true });
    }

    function confirmEmbed(v, o, exp) {
      return host.discord.embed().setTitle('✅ Rental confirmed').setColor(0x54c98a)
        .addFields(
          { name: 'Vehicle', value: v.name || '—', inline: true },
          { name: 'Duration', value: fmtDur(o.minutes), inline: true },
          { name: 'Price', value: cfg().free ? 'Free' : money(o), inline: true },
          { name: 'Expires', value: '<t:' + Math.floor(exp / 1000) + ':R>' },
        );
    }

    // ── lifecycle: reminders + expiry + auto-removal ──
    host.schedule.every(60000, async function () {
      if (!db) return;
      const c = cfg(), now = Date.now();
      const B = host.discord.js;
      const perVehRems = (c.vehicles || []).map((v) => (v && v.reminderMinutes != null && v.reminderMinutes !== '') ? Number(v.reminderMinutes) : 0).filter((x) => x > 0);
      const maxRem = Math.max.apply(null, [c.reminderMinutes || 10].concat(perVehRems));
      const soon = db.prepare('SELECT * FROM rentals WHERE active=1 AND reminded=0 AND (expiresAt - ?) <= ?').all(now, maxRem * 60000);
      for (const r of soon) {
        const rv = c.vehicles[Number(r.vehIdx)];
        const effRem = (rv && rv.reminderMinutes != null && rv.reminderMinutes !== '') ? Number(rv.reminderMinutes) : (c.reminderMinutes || 10);
        if ((r.expiresAt - now) > effRem * 60000) continue; // not within this rental's own reminder window yet
        const effMaxExt = (rv && rv.maxExtensions != null && rv.maxExtensions !== '') ? Number(rv.maxExtensions) : c.maxExtensions;
        const canExtend = c.allowExtend !== false && (!effMaxExt || (r.extensions || 0) < effMaxExt);
        const em = host.discord.embed().setTitle('⏳ Rental ending soon').setColor(0xe6b23a)
          .setDescription('Your **' + (r.vehName || 'vehicle') + '** rental expires <t:' + Math.floor(r.expiresAt / 1000) + ':R>.' + (canExtend ? ' Extend it to keep the vehicle.' : ''));
        const msg = { embeds: [em] };
        if (canExtend) msg.components = [host.discord.row(new B.ButtonBuilder().setCustomId(EXT + ':' + r.id).setLabel('Extend').setStyle(B.ButtonStyle.Primary).setEmoji('🔄'))];
        try { await host.discord.dm(r.discordId, msg); } catch (e) {}
        db.prepare('UPDATE rentals SET reminded=1 WHERE id=?').run(r.id);
      }
      const expired = db.prepare('SELECT * FROM rentals WHERE active=1 AND expiresAt <= ?').all(now);
      for (const r of expired) {
        if (r.vehId && c.removeCmd) { try { await host.server.command(fill(c.removeCmd, { vehId: r.vehId, steamid: r.steamId })); } catch (e) {} }
        db.prepare('UPDATE rentals SET active=0 WHERE id=?').run(r.id);
        const em = host.discord.embed().setTitle('⚠️ Rental ended').setColor(0xff5c5c)
          .setDescription('Your **' + (r.vehName || 'vehicle') + '** rental has expired' + (r.vehId ? ' and the vehicle has been removed.' : '.'));
        try { await host.discord.dm(r.discordId, { embeds: [em] }); } catch (e) {}
      }
    });

    host.logger.info('Vehicle Rental System ready');
  },
};
