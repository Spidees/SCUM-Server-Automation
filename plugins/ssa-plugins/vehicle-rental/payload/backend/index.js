'use strict';

// Vehicle Rental System — players rent vehicles from Discord OR from in-game chat. Fully
// admin-configurable (vehicles, durations, money/gold prices, channel, spawn/remove commands,
// the menu embed, every in-game line).
//
// In-game spawn/remove are COMMAND TEMPLATES so they match whatever your server/bridge supports;
// placeholders: {code} {x} {y} {z} {steamid} {vehId}. Currency is charged with the known
// #ChangeCurrencyBalance command.
//
// The rental itself lives in ONE place (`rent()` / `endRental()`), which both the Discord flow and
// the chat commands call. Two copies of "check the limits, spawn, charge, record" would drift, and
// the half that drifted would be the one nobody tested.

const OPEN = 'vr:open', VEH = 'vr:veh', OPT = 'vr:opt', EXT = 'vr:ext';

function fill(tpl, vars) { return String(tpl || '').replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : ''; }); }
function fmtDur(min) { min = Math.max(1, parseInt(min, 10) || 0); if (min < 60) return min + ' min'; const h = Math.floor(min / 60), m = min % 60; return h + 'h' + (m ? ' ' + m + 'm' : ''); }
function money(o) { return (o.amount || 0) + ' ' + (o.currency === 'gold' ? 'gold' : 'money'); }
// Minutes left, as something a player reads at a glance in chat.
function fmtLeft(ms) { const m = Math.max(0, Math.round(ms / 60000)); return fmtDur(m || 1); }

module.exports = {
  async register(host) {
    // discord.js deprecated the `ephemeral: true` reply option in favour of the flag; passing the
    // old one still works but logs a warning on every single reply.
    // 64 is the Ephemeral flag's fixed value in Discord's API — the literal is the fallback for a
    // host that cannot hand over the discord.js namespace.
    const EPHEMERAL = (() => {
      try { return { flags: host.discord.js.MessageFlags.Ephemeral }; } catch { return { flags: 64 }; }
    })();
    const db = host.sqlite('rentals.db');
    if (db) db.exec('CREATE TABLE IF NOT EXISTS rentals (id INTEGER PRIMARY KEY AUTOINCREMENT, discordId TEXT, steamId TEXT, playerName TEXT, vehIdx TEXT, vehName TEXT, vehId TEXT, optIdx INTEGER, startedAt INTEGER, expiresAt INTEGER, reminded INTEGER DEFAULT 0, extensions INTEGER DEFAULT 0, active INTEGER DEFAULT 1)');
    // best-effort migrations for older DBs
    if (db) { try { db.exec('ALTER TABLE rentals ADD COLUMN extensions INTEGER DEFAULT 0'); } catch (e) {} }
    // How the rental ended, so /myrent history and the admin list can tell an expiry from an early
    // return. Old rows read as null, which the UI shows as "expired" — the only thing that existed.
    if (db) { try { db.exec('ALTER TABLE rentals ADD COLUMN endedReason TEXT'); } catch (e) {} }

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

        // ── in-game side (all additive; every default keeps the old behaviour or is plainly safe) ──
        inGameNotify: true,     // rental confirmed / ending soon / ended, written into the game chat
        inGameChannel: 'local', // local | global | squad | admin | server
        inGameCommands: true,   // register the chat commands below
        cmdRent: 'rent', cmdMine: 'myrent', cmdExtend: 'extend', cmdReturn: 'return',

        allowReturn: true,      // a player may hand the vehicle back before it expires
        refundPercent: 0,       // % of the price returned on an early return (0 = nothing back)
        verifyVehicle: true,    // don't claim a vehicle was removed when it is already gone
        // Where renting is allowed. Empty = anywhere. Sectors are the map grid ("B2"), and the check
        // is SKIPPED when the manager has no map calibration — refusing on a coordinate we can't
        // place would block rentals for a reason the player cannot see or fix.
        allowedSectors: [],
        blockedSectors: [],

        // Every player-facing in-game line. Tokens: {player} {vehicle} {duration} {price} {left}
        // {sector} {cmd} {list}
        texts: {
          confirmed: '🚗 {vehicle} is yours for {duration}. Type {cmd}myrent to check the time left.',
          endingSoon: '⏳ Your {vehicle} rental ends in {left}. Type {cmd}extend to keep it.',
          ended: '⚠️ Your {vehicle} rental has ended and the vehicle was removed.',
          returned: '✅ {vehicle} returned. Thanks!',
          rentUsage: 'Usage: {cmd}rent <number> <plan> — available now:\n{list}',
          noRentals: 'You have no active rentals.',
          mineLine: '{vehicle} — {left} left',
          extendOk: '🔄 Extended. Your {vehicle} now runs for another {duration}.',
          notAllowedHere: '🚫 Renting is not allowed in sector {sector}.',
          disabled: '🚧 Vehicle rentals are currently disabled.',
        },
      };
    }
    const cfg = () => Object.assign(defaultConfig(), host.store.get('config', {}));
    const setCfg = (c) => host.store.set('config', Object.assign(defaultConfig(), c || {}));
    // texts merge one level deeper, so a config saved before a line existed still gets its default
    // instead of an empty message.
    const txt = (c, key) => Object.assign(defaultConfig().texts, c.texts || {})[key] || '';

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
    // Is that vehicle still in the world? Used before claiming we removed it, and before letting a
    // player "return" something that no longer exists. Unknown (no id / no map data) ⇒ true, so a
    // missing answer never blocks the lifecycle.
    function vehicleExists(vehId) {
      if (!vehId) return true;
      try {
        const w = host.map.world() || {};
        const vs = w.vehicles || [];
        if (!Array.isArray(vs) || !vs.length) return true;
        return vs.some(function (v) { return String(v.id) === String(vehId); });
      } catch (e) { return true; }
    }

    // ── in-game messaging ──────────────────────────────────────────────────────
    // Never let a chat failure break a rental: the Discord side is the record, the game line is a
    // courtesy. Every call is awaited but swallowed.
    async function say(steamId, text) {
      const c = cfg();
      if (c.inGameNotify === false || !text || !steamId) return;
      try { await host.chat.dm(String(steamId), String(text), { channel: c.inGameChannel || 'local' }); }
      catch (e) { host.logger.debug('in-game message failed: ' + e.message); }
    }
    const vars = (c, extra) => Object.assign({ cmd: host.chat.prefix ? host.chat.prefix() : '/' }, extra || {});

    // Sector rule. Async because map calibration is remote; null sector = unknown = allow.
    async function sectorAllowed(loc) {
      const c = cfg();
      const allow = (c.allowedSectors || []).filter(Boolean).map(String);
      const block = (c.blockedSectors || []).filter(Boolean).map(String);
      if (!allow.length && !block.length) return { ok: true, sector: null };
      let sec = null;
      try { sec = host.map.sector ? await host.map.sector(loc.x, loc.y) : null; } catch (e) { sec = null; }
      if (!sec) return { ok: true, sector: null };   // no calibration → don't block on what we can't see
      const up = String(sec).toUpperCase();
      if (block.some(function (s) { return s.toUpperCase() === up; })) return { ok: false, sector: sec };
      if (allow.length && !allow.some(function (s) { return s.toUpperCase() === up; })) return { ok: false, sector: sec };
      return { ok: true, sector: sec };
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

    // ── the rental core, shared by Discord and chat ────────────────────────────

    // Every reason a rental may be refused, in one place. Returns an error string or null.
    // Keyed on STEAM ID, not the Discord id: the same person renting from Discord and from chat is
    // one player, and counting them separately would hand out two vehicles where one is allowed.
    function limitsError(steamId, vehIdx, v, c) {
      if (!db) return null;
      const vi = String(vehIdx);
      const pv = (field) => (v[field] != null && v[field] !== '' ? Number(v[field]) : null);
      const mMax = pv('maxPerPlayer'), mCd = pv('cooldownMinutes'), mDl = pv('dailyLimit');
      const effMax = mMax != null ? mMax : (c.maxPerPlayer || 1);
      const nActive = mMax != null
        ? db.prepare('SELECT COUNT(*) n FROM rentals WHERE active=1 AND steamId=? AND vehIdx=?').get(steamId, vi).n
        : db.prepare('SELECT COUNT(*) n FROM rentals WHERE active=1 AND steamId=?').get(steamId).n;
      if (effMax > 0 && nActive >= effMax) return 'You already have the maximum active rentals (' + effMax + ')' + (mMax != null ? ' for this vehicle' : '') + '.';
      const effCd = mCd != null ? mCd : c.cooldownMinutes;
      if (effCd) {
        const last = mCd != null
          ? db.prepare('SELECT MAX(startedAt) m FROM rentals WHERE steamId=? AND vehIdx=?').get(steamId, vi).m
          : db.prepare('SELECT MAX(startedAt) m FROM rentals WHERE steamId=?').get(steamId).m;
        if (last && (Date.now() - last) < effCd * 60000) return '⏳ You are renting too often — you can rent again in ' + fmtLeft(last + effCd * 60000 - Date.now()) + '.';
      }
      const effDl = mDl != null ? mDl : c.dailyLimit;
      if (effDl) {
        const day = mDl != null
          ? db.prepare('SELECT COUNT(*) n FROM rentals WHERE steamId=? AND vehIdx=? AND startedAt >= ?').get(steamId, vi, Date.now() - 86400000).n
          : db.prepare('SELECT COUNT(*) n FROM rentals WHERE steamId=? AND startedAt >= ?').get(steamId, Date.now() - 86400000).n;
        if (day >= effDl) return '📵 You reached the rental limit (' + effDl + '/day' + (mDl != null ? ' for this vehicle' : '') + ').';
      }
      return null;
    }

    async function charge(steamId, o, factor) {
      if (cfg().free) return true;   // free mode — no in-game charge
      const amount = Math.round(Math.max(0, parseInt(o.amount, 10) || 0) * (factor == null ? 1 : factor));
      const cur = o.currency === 'gold' ? 'Gold' : 'Normal';
      if (!amount) return true;
      // The sign is the whole difference between charging and refunding.
      const res = await host.server.command('#ChangeCurrencyBalance ' + cur + ' ' + (factor < 0 ? '' : '-') + Math.abs(amount) + ' ' + steamId);
      return !(res && res.ok === false);
    }

    function affordError(steamId, o, c) {
      if (c.free) return null;
      const need = Math.max(0, parseInt(o.amount, 10) || 0);
      const unit = o.currency === 'gold' ? 'gold' : 'money';
      const fin = host.players.finances(steamId) || {};
      const have = o.currency === 'gold' ? (fin.gold || 0) : (fin.bank || 0);
      if (have < need) return '💸 Not enough ' + unit + ' — this rental costs ' + need + ' ' + unit + ', you have ' + have + '.';
      return null;
    }

    /**
     * Rent one vehicle. `who` = { steamId, discordId, playerName }.
     * Returns { ok, error, exp, vehId, v, o } — the caller decides how to say it.
     */
    async function rent(who, vehIdx, optIdx) {
      const c = cfg();
      const v = c.vehicles[Number(vehIdx)];
      const o = v && (v.options || [])[Number(optIdx)];
      if (c.enabled === false) return { ok: false, error: txt(c, 'disabled') };
      if (!v || !o) return { ok: false, error: 'Invalid selection.' };
      if (!v.code) return { ok: false, error: '🛠️ This vehicle isn’t fully set up yet (missing spawn code). Please tell an admin.' };

      const limErr = limitsError(who.steamId, vehIdx, v, c);
      if (limErr) return { ok: false, error: limErr };
      if (c.requireOnline && isOnline(who.steamId) === false) return { ok: false, error: '🔌 You must be online in-game to rent a vehicle.' };

      // need a valid in-game position — never spawn a phantom vehicle at 0,0,0
      const loc = playerLoc(who.steamId);
      if (!loc || (!loc.x && !loc.y && !loc.z)) return { ok: false, error: '📍 I couldn’t find you in-game. Get online and fully spawned in, then try again.' };
      const sec = await sectorAllowed(loc);
      if (!sec.ok) return { ok: false, error: fill(txt(c, 'notAllowedHere'), vars(c, { sector: sec.sector })) };

      const affErr = affordError(who.steamId, o, c);
      if (affErr) return { ok: false, error: affErr };

      // spawn FIRST and verify it worked; only charge on success, so an offline/failed bridge never bills the player
      // offset ~3m to the side so the vehicle doesn't spawn on the renter's head (crushing them)
      const spawnRes = await host.server.command(fill(c.spawnCmd, { code: v.code || '', x: loc.x + 300, y: loc.y, z: loc.z, steamid: who.steamId }));
      if (!spawnRes || spawnRes.ok === false) {
        const reason = (spawnRes && /unavailable|offline|refused/i.test(String(spawnRes.error || ''))) ? 'the in-game bridge is offline' : 'the vehicle couldn’t be spawned';
        return { ok: false, error: '⚠️ Rental failed — ' + reason + '. You were not charged.' };
      }
      // A charge that silently fails hands out a free vehicle, so take the vehicle back rather than
      // leave the player with something they didn't pay for.
      const paid = await charge(who.steamId, o, 1);
      const vehId = await captureVehicleId(loc);
      if (!paid) {
        if (vehId && c.removeCmd) { try { await host.server.command(fill(c.removeCmd, { vehId: vehId, steamid: who.steamId })); } catch (e) {} }
        return { ok: false, error: '⚠️ Payment failed, so the rental was cancelled. You were not charged.' };
      }
      if (!vehId) host.logger.warn('rental: could not capture a vehicle id for "' + (v.name || '?') + '" — auto-removal at expiry will be skipped');

      const now = Date.now(), exp = now + (parseInt(o.minutes, 10) || 60) * 60000;
      if (db) db.prepare('INSERT INTO rentals (discordId,steamId,playerName,vehIdx,vehName,vehId,optIdx,startedAt,expiresAt) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(who.discordId || '', who.steamId, who.playerName || '', String(vehIdx), v.name || '', vehId || '', Number(optIdx), now, exp);

      await say(who.steamId, fill(txt(c, 'confirmed'), vars(c, { player: who.playerName || '', vehicle: v.name || 'vehicle', duration: fmtDur(o.minutes), price: c.free ? 'Free' : money(o) })));
      host.notify('admin.alert', { message: 'Vehicle rented: ' + (v.name || '?') + ' by ' + (who.playerName || who.steamId), severity: 'info' });
      return { ok: true, exp: exp, vehId: vehId, v: v, o: o };
    }

    /** Close a rental: remove the vehicle if it is still there, mark the row, tell the player. */
    async function endRental(r, reason) {
      const c = cfg();
      const stillThere = c.verifyVehicle === false ? true : vehicleExists(r.vehId);
      let removed = false;
      if (r.vehId && c.removeCmd && stillThere) {
        try { const res = await host.server.command(fill(c.removeCmd, { vehId: r.vehId, steamid: r.steamId })); removed = !(res && res.ok === false); }
        catch (e) { removed = false; }
      }
      if (db) db.prepare('UPDATE rentals SET active=0, endedReason=? WHERE id=?').run(reason || 'expired', r.id);
      return { removed: removed, stillThere: stillThere };
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
      } catch (e) { host.logger.error('interaction: ' + e.message); try { if (!i.replied && !i.deferred) await i.reply({ content: 'Something went wrong.', ...EPHEMERAL }); } catch (x) {} }
    });

    async function openVehicleMenu(i) {
      const c = cfg();
      if (c.enabled === false) return i.reply({ content: txt(c, 'disabled'), ...EPHEMERAL });
      if (!c.vehicles.length) return i.reply({ content: 'No vehicles are available right now.', ...EPHEMERAL });
      const B = host.discord.js;
      const menu = new B.StringSelectMenuBuilder().setCustomId(VEH).setPlaceholder('Choose a vehicle')
        .addOptions(c.vehicles.slice(0, 25).map(function (v, idx) { return { label: (v.name || ('Vehicle ' + idx)).slice(0, 100), value: String(idx), description: ((v.options || []).length + ' plan(s)').slice(0, 100) }; }));
      return i.reply({ content: 'Pick a vehicle to rent:', components: [host.discord.row(menu)], ...EPHEMERAL });
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
      const prof = host.players.linked(i.user.id);
      if (!prof || !prof.steamId) return i.update({ content: '⚠️ Link your SCUM character to Discord first (on the Field Console), then try again.', components: [] });
      await i.update({ content: '⏳ Processing your rental…', components: [] });
      const res = await rent({ steamId: prof.steamId, discordId: i.user.id, playerName: prof.name || prof.discordUsername || '' }, vehIdx, optIdx);
      if (!res.ok) { try { await i.editReply({ content: res.error, embeds: [] }); } catch (e) {} return; }
      const embed = confirmEmbed(res.v, res.o, res.exp);
      try { await i.editReply({ content: '', embeds: [embed] }); } catch (e) {}
      try { await host.discord.dm(i.user.id, { embeds: [embed] }); } catch (e) {}
    }

    async function doExtend(i, rentalId) {
      if (!db) return;
      const r = db.prepare('SELECT * FROM rentals WHERE id=? AND active=1').get(Number(rentalId));
      if (!r) return i.reply({ content: 'That rental is no longer active.', ...EPHEMERAL });
      const out = await extendRental(r);
      return i.reply({ content: out.ok ? '🔄 Rental extended! New expiry: <t:' + Math.floor(out.exp / 1000) + ':R>' : out.error, ...EPHEMERAL });
    }

    /** Extend one rental. Shared by the Discord button and the chat command. */
    async function extendRental(r) {
      const c = cfg();
      if (c.allowExtend === false) return { ok: false, error: 'Extensions are turned off.' };
      const v = c.vehicles[Number(r.vehIdx)]; const o = v && (v.options || [])[Number(r.optIdx)];
      const effMaxExt = (v && v.maxExtensions != null && v.maxExtensions !== '') ? Number(v.maxExtensions) : c.maxExtensions;
      if (effMaxExt && (r.extensions || 0) >= effMaxExt) return { ok: false, error: 'This rental has reached the maximum number of extensions (' + effMaxExt + ').' };
      if (!o) return { ok: false, error: 'This plan is no longer available.' };
      const affErr = affordError(r.steamId, o, c);
      if (affErr) return { ok: false, error: affErr.replace('this rental costs', 'extending costs') };
      // Same rule as renting: if the charge doesn't land, don't hand out the time.
      const paid = await charge(r.steamId, o, 1);
      if (!paid) return { ok: false, error: '⚠️ Payment failed — the rental was not extended.' };
      const exp = Math.max(Date.now(), r.expiresAt) + (parseInt(o.minutes, 10) || 60) * 60000;
      db.prepare('UPDATE rentals SET expiresAt=?, reminded=0, extensions=extensions+1 WHERE id=?').run(exp, r.id);
      await say(r.steamId, fill(txt(c, 'extendOk'), vars(c, { vehicle: r.vehName || 'vehicle', duration: fmtDur(o.minutes) })));
      return { ok: true, exp: exp, v: v, o: o };
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

    // ── in-game commands ───────────────────────────────────────────────────────
    // Registered only while enabled: the dispatcher turns the whole prefix interception off when no
    // plugin wants a command, so leaving these on for nothing would make the bridge hide chat lines
    // for no reason.
    if (cfg().inGameCommands !== false) {
      const c0 = cfg();
      const activeFor = (steamId) => (db ? db.prepare('SELECT * FROM rentals WHERE active=1 AND steamId=? ORDER BY expiresAt').all(String(steamId)) : []);

      host.chat.onCommand(c0.cmdRent || 'rent', async function (ctx) {
        const c = cfg();
        if (c.enabled === false) return ctx.reply(txt(c, 'disabled'));
        const list = (c.vehicles || []);
        if (!list.length) return ctx.reply('No vehicles are available right now.');
        const n = parseInt(ctx.args[0], 10);
        const p = parseInt(ctx.args[1], 10);
        // No arguments (or nonsense) → show what can be rented, numbered, so the next command is obvious.
        if (!Number.isFinite(n) || n < 1 || n > list.length) {
          const lines = list.map(function (v, idx) {
            const plans = (v.options || []).map(function (o, oi) { return (oi + 1) + ') ' + fmtDur(o.minutes) + (c.free ? '' : ' ' + money(o)); }).join('  ');
            return (idx + 1) + '. ' + (v.name || 'Vehicle') + ' — ' + (plans || 'no plans');
          }).join('\n');
          return ctx.reply(fill(txt(c, 'rentUsage'), vars(c, { list: lines })));
        }
        const v = list[n - 1];
        const opts = v.options || [];
        if (!Number.isFinite(p) || p < 1 || p > opts.length) {
          const plans = opts.map(function (o, oi) { return (oi + 1) + ') ' + fmtDur(o.minutes) + (c.free ? '' : ' ' + money(o)); }).join('  ');
          return ctx.reply((v.name || 'Vehicle') + ' — pick a plan: ' + (plans || 'none configured'));
        }
        const prof = host.players.bySteamId(ctx.steamId);
        const res = await rent({ steamId: ctx.steamId, discordId: (prof && prof.discord_user_id) || (prof && prof.discordUserId) || '', playerName: ctx.name || (prof && prof.player_name) || '' }, String(n - 1), String(p - 1));
        // `confirmed` already went out through say() on success; only a refusal needs a reply here.
        if (!res.ok) return ctx.reply(res.error);
      });

      host.chat.onCommand(c0.cmdMine || 'myrent', async function (ctx) {
        const c = cfg();
        const rows = activeFor(ctx.steamId);
        if (!rows.length) return ctx.reply(txt(c, 'noRentals'));
        const now = Date.now();
        const lines = rows.map(function (r) { return fill(txt(c, 'mineLine'), vars(c, { vehicle: r.vehName || 'vehicle', left: fmtLeft(r.expiresAt - now) })); });
        return ctx.reply(lines.join('\n'));
      });

      host.chat.onCommand(c0.cmdExtend || 'extend', async function (ctx) {
        const c = cfg();
        const rows = activeFor(ctx.steamId);
        if (!rows.length) return ctx.reply(txt(c, 'noRentals'));
        // The one running out first is the one they mean.
        const out = await extendRental(rows[0]);
        if (!out.ok) return ctx.reply(out.error);
        // extendOk already delivered by extendRental's say()
      });

      host.chat.onCommand(c0.cmdReturn || 'return', async function (ctx) {
        const c = cfg();
        if (c.allowReturn === false) return ctx.reply('Returning early is turned off.');
        const rows = activeFor(ctx.steamId);
        if (!rows.length) return ctx.reply(txt(c, 'noRentals'));
        const r = rows[0];
        const out = await endRental(r, 'returned');
        // Refund only what was actually given back: no vehicle to reclaim, no refund.
        const pct = Math.max(0, Math.min(100, Number(c.refundPercent) || 0));
        if (pct && out.removed) {
          const v = c.vehicles[Number(r.vehIdx)]; const o = v && (v.options || [])[Number(r.optIdx)];
          if (o) { try { await charge(r.steamId, o, -(pct / 100)); } catch (e) {} }
        }
        return ctx.reply(fill(txt(c, 'returned'), vars(c, { vehicle: r.vehName || 'vehicle' }))
          + (!out.stillThere ? ' (the vehicle was already gone)' : ''));
      });

      host.logger.info('in-game commands: ' + [c0.cmdRent || 'rent', c0.cmdMine || 'myrent', c0.cmdExtend || 'extend', c0.cmdReturn || 'return'].map(function (n) { return (host.chat.prefix ? host.chat.prefix() : '/') + n; }).join(' '));
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
        if (r.discordId) { try { await host.discord.dm(r.discordId, msg); } catch (e) {} }
        // …and in the game, where the player actually is.
        await say(r.steamId, fill(txt(c, 'endingSoon'), vars(c, { vehicle: r.vehName || 'vehicle', left: fmtLeft(r.expiresAt - now) })));
        db.prepare('UPDATE rentals SET reminded=1 WHERE id=?').run(r.id);
      }
      const expired = db.prepare('SELECT * FROM rentals WHERE active=1 AND expiresAt <= ?').all(now);
      for (const r of expired) {
        const out = await endRental(r, 'expired');
        const em = host.discord.embed().setTitle('⚠️ Rental ended').setColor(0xff5c5c)
          .setDescription('Your **' + (r.vehName || 'vehicle') + '** rental has expired' + (out.removed ? ' and the vehicle has been removed.' : '.'));
        if (r.discordId) { try { await host.discord.dm(r.discordId, { embeds: [em] }); } catch (e) {} }
        await say(r.steamId, fill(txt(c, 'ended'), vars(c, { vehicle: r.vehName || 'vehicle' })));
      }
    });

    host.logger.info('Vehicle Rental System ready');
  },
};
