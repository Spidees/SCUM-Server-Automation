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

// SCUM's chat cuts a long line off, and it cuts it off silently — a server with 25 vehicles sent a
// list that ended mid-word and the player had no way to know there was more. Fit what fits, then say
// how much did not. The budget is deliberately conservative; being a little short is harmless,
// being a little long loses the end of the message.
const CHAT_BUDGET = 420;
function fitLines(lines, more) {
  const out = [];
  let used = 0;
  for (const line of lines) {
    if (out.length && used + line.length + 1 > CHAT_BUDGET) break;
    out.push(line);
    used += line.length + 1;
  }
  const left = lines.length - out.length;
  if (left > 0) out.push('… and ' + left + ' more — ' + (more || 'see the rental menu in Discord'));
  return out.join('\n');
}

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
    // What this rental ACTUALLY cost, and which vehicle it actually was.
    //
    // `vehIdx` is a position in the admin's vehicle list, and positions move. Add a vehicle above an
    // existing one and every active rental now points at its neighbour: a 500-money Rager refunded
    // at 50% paid out 45 000 GOLD because position 0 had become a different vehicle in a different
    // currency. Delete one and the refund silently becomes nothing at all. A rental has to carry its
    // own price, because that is the only thing that cannot be edited out from under it.
    if (db) { try { db.exec('ALTER TABLE rentals ADD COLUMN paidAmount INTEGER'); } catch (e) {} }
    if (db) { try { db.exec('ALTER TABLE rentals ADD COLUMN paidCurrency TEXT'); } catch (e) {} }
    if (db) { try { db.exec('ALTER TABLE rentals ADD COLUMN paidMinutes INTEGER'); } catch (e) {} }
    if (db) { try { db.exec('ALTER TABLE rentals ADD COLUMN vehCode TEXT'); } catch (e) {} }

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
    /** Every vehicle id in the world right now, or null when the map cannot say. */
    function vehicleIdSet() {
      try {
        const w = host.map.world() || {};
        const vs = w.vehicles;
        if (!Array.isArray(vs)) return null;
        const s = new Set();
        vs.forEach(function (v) { if (v && v.id != null) s.add(String(v.id)); });
        return s;
      } catch (e) { return null; }
    }

    /**
     * Which vehicle did we just spawn?
     *
     * NOT "the one nearest the spawn point" — the thing nearest a player is usually the player's own
     * parked car, and this id is what gets destroyed when the rental expires. That handed out one
     * rental and took away one vehicle somebody owned, which is the worst thing this plugin could do.
     *
     * The only safe rule is the difference between before and after: consider ONLY ids that were not
     * in the world a moment ago, and among those take the nearest. If the map cannot tell us what was
     * there before, we return nothing and skip auto-removal — a vehicle left standing is a much
     * smaller problem than one destroyed by mistake.
     */
    async function captureVehicleId(loc, before) {
      if (!before) return '';
      try {
        // The manager's world snapshot is memoised for EIGHT seconds, so a poll shorter than that can
        // legitimately observe no change at all and conclude nothing spawned. The deadline outlasts
        // two full cache cycles.
        //
        // But it also stops as soon as the answer is knowable: once the world has visibly MOVED ON
        // twice — a different set of vehicle ids from the one we started with — and still nothing new
        // has appeared near the spawn point, waiting out the rest of the twenty seconds only delays a
        // log line nobody is waiting for.
        const DEADLINE = Date.now() + 20000;
        let refreshes = 0;
        let lastSeen = null;
        while (Date.now() < DEADLINE) {
          await new Promise(function (r) { setTimeout(r, 1500); });
          const w = host.map.world() || {};
          if (!Array.isArray(w.vehicles)) continue;
          const nowIds = w.vehicles.map(function (v) { return v && v.id != null ? String(v.id) : ''; }).sort().join(',');
          if (lastSeen !== null && nowIds !== lastSeen) refreshes++;
          lastSeen = nowIds;
          // Ids some OTHER active rental already owns. `before` can be up to eight seconds stale, so
          // a vehicle another player rented in that window looks new to us — and adopting it would
          // destroy their vehicle when our rental expires. Two guards are not one too many here.
          const taken = new Set();
          if (db) { try { db.prepare('SELECT vehId FROM rentals WHERE active=1 AND vehId IS NOT NULL').all().forEach(function (r) { if (r.vehId) taken.add(String(r.vehId)); }); } catch (e) {} }
          let best = null, bestD = 1e9;
          w.vehicles.forEach(function (v) {
            if (!v || v.id == null) return;
            const id = String(v.id);
            if (before.has(id) || taken.has(id)) return;      // already there, or already someone's
            const d = Math.hypot((v.x || 0) - loc.x, (v.y || 0) - loc.y);
            if (d < bestD) { bestD = d; best = v; }
          });
          if (best && bestD < 3000) return String(best.id);
          if (refreshes >= 2) return '';        // the world moved on twice and nothing of ours showed
        }
        return '';
      } catch (e) { return ''; }
    }

    /**
     * Wire a rental to its vehicle once the world catches up.
     *
     * NOT part of the rental itself. Identifying the vehicle can take twenty seconds — the snapshot
     * it reads is refreshed on its own eight-second clock — and making a player stare at "Processing
     * your rental…" for that long, for something that only matters at expiry, is the wrong trade.
     * The rental is confirmed at once and the id is filled in behind it.
     */
    // Identifications still in flight, so a rental that ends before its own finished can wait for it
    // rather than conclude there is no vehicle. Without this, returning within the first few seconds
    // left the vehicle standing and paid no refund — the fast path became the broken one.
    const pendingCapture = new Map();

    function captureLater(rentalId, loc, before) {
      if (!db || !rentalId) return;
      const p = captureVehicleId(loc, before).then(function (vehId) {
        if (!vehId) {
          // Two very different things look the same from here: the map could not tell us, or NOTHING
          // SPAWNED. The second is what a game update does — blueprint ids move, the configured code
          // stops matching, the bridge still reports success because it did deliver the line, and the
          // player is charged for a vehicle that never existed. Every time, silently.
          //
          // We cannot tell them apart, so we do not guess: the admin is told, once per rental, and
          // the panel already shows the rental as "not captured". Telling the PLAYER their vehicle
          // may not exist when it probably does would be worse than saying nothing.
          host.logger.warn('rental #' + rentalId + ': the spawned vehicle could not be identified — it will NOT be removed automatically, and it may not have spawned at all (a stale spawn code after a game update looks exactly like this)');
          try {
            host.notify('admin.alert', {
              message: 'Vehicle rental #' + rentalId + ': the spawned vehicle could not be found. Check the spawn code is still valid — a game update moves blueprint ids, and the player is charged either way.',
              severity: 'warning',
            });
          } catch (e) { /* notifications are optional */ }
          return '';
        }
        try { db.prepare('UPDATE rentals SET vehId=? WHERE id=? AND active=1').run(vehId, rentalId); } catch (e) { host.logger.warn('rental #' + rentalId + ': could not record the vehicle id: ' + e.message); }
        return vehId;
      }).catch(function () { return ''; });
      pendingCapture.set(rentalId, p);
      p.then(function () { pendingCapture.delete(rentalId); });
    }

    /** The rental's vehicle id, waiting for an identification that has not finished yet. */
    async function vehIdOf(r) {
      if (r.vehId) return r.vehId;
      const p = pendingCapture.get(r.id);
      if (!p) return '';
      try { return (await p) || ''; } catch (e) { return ''; }
    }

    /**
     * Post the rental menu.
     *
     * The menu embed is designed in the FULL embed editor, so an owner can give it text above the
     * embed, their own buttons and select menus, and extra embeds — and all of that used to be saved,
     * previewed, and then dropped here, because this only ever sent `{ embeds: [one] }`.
     *
     * The Rent button is the reason the message exists, so it goes in first and keeps its place even
     * when the owner's own components would otherwise fill Discord's five rows.
     */
    async function postMenu() {
      const c = cfg(); if (!c.channelId) return false;
      const ed = host.consume('embed-editor');
      const m = c.menuEmbed || {};
      const embed = ed ? ed.embed(m) : host.discord.embed().setTitle(m.title || 'Vehicle Rental');
      const B = host.discord.js;
      const rentRow = host.discord.row(new B.ButtonBuilder().setCustomId(OPEN).setLabel(c.buttonLabel || 'Rent a vehicle').setStyle(B.ButtonStyle.Success));

      let mine = [];
      if (ed && ed.components) {
        try { mine = ed.components(m.buttons, m.selects) || []; } catch (e) { host.logger.warn('menu components failed: ' + e.message); }
      }
      const payload = { components: [rentRow].concat(mine).slice(0, 5) };   // Discord's five-row limit

      const embeds = [embed];
      if (ed && Array.isArray(m.extraEmbeds)) {
        m.extraEmbeds.slice(0, 9).forEach(function (x) { if (x) { try { embeds.push(ed.embed(x)); } catch (e) {} } });
      }
      payload.embeds = embeds;
      if (typeof m.content === 'string' && m.content.trim()) payload.content = m.content;
      return host.discord.send(c.channelId, payload);
    }

    // ── admin routes ──
    host.routes.get('/config', function (req, res) { res.json(cfg()); });
    host.routes.post('/config', function (req, res) {
      setCfg(req.body || {});
      // The chat commands are named in this config, so saving it re-registers them. Without this a
      // rename or an on/off toggle needed a manager restart to take effect, and nothing said so.
      try { registerCommands(); } catch (e) { host.logger.warn('re-registering chat commands failed: ' + e.message); }
      res.json({ ok: true });
    });
    host.routes.get('/rentals', function (req, res) { res.json(db ? db.prepare('SELECT * FROM rentals WHERE active=1 ORDER BY expiresAt').all() : []); });
    // The last rentals that have finished, so an admin can see what happened rather than only what
    // is happening. `endedReason` tells an expiry from an early return from an admin's intervention.
    host.routes.get('/history', function (req, res) {
      res.json(db ? db.prepare('SELECT * FROM rentals WHERE active=0 ORDER BY id DESC LIMIT 200').all() : []);
    });
    // End one, from the panel. A rental whose vehicle id was never captured, or one an admin needs to
    // revoke, otherwise sits in the list until it expires with nothing anyone can do about it.
    host.routes.post('/rentals/end', async function (req, res) {
      if (!db) return res.json({ ok: false, error: 'no database' });
      const id = Number((req.body || {}).id);
      const r = db.prepare('SELECT * FROM rentals WHERE id=? AND active=1').get(id);
      if (!r) return res.json({ ok: false, error: 'that rental is not active' });
      const out = await endRental(r, 'admin');
      await say(r.steamId, fill(txt(cfg(), 'ended'), rentalVars(r, cfg())));
      host.logger.info('rental #' + id + ' ended by an admin (' + (r.playerName || r.steamId) + ')');
      res.json({ ok: true, removed: out.removed, stillThere: out.stillThere });
    });
    host.routes.get('/channels', async function (req, res) {
      const c = host.discord.client(); if (!c) return res.json([]);
      try { const g = c.guilds.cache.first(); if (!g) return res.json([]); const all = await g.channels.fetch(); const out = []; all.forEach(function (ch) { if (ch && ch.type === 0) out.push({ id: ch.id, name: ch.name }); }); out.sort(function (a, b) { return a.name.localeCompare(b.name); }); res.json(out); }
      catch (e) { res.json([]); }
    });
    host.routes.post('/post-menu', async function (req, res) { const ok = await postMenu(); res.json({ ok: !!ok }); });

    /**
     * Post the rental menu.
     *
     * The menu embed is designed in the FULL embed editor, so an owner can give it text above the
     * embed, their own buttons and select menus, and extra embeds — and all of that used to be saved,
     * previewed, and then dropped here, because this only ever sent `{ embeds: [one] }`.
     *
     * The Rent button is the reason the message exists, so it goes in first and keeps its place even
     * when the owner's own components would otherwise fill Discord's five rows.
     */
    async function postMenu() {
      const c = cfg(); if (!c.channelId) return false;
      const ed = host.consume('embed-editor');
      const m = c.menuEmbed || {};
      const embed = ed ? ed.embed(m) : host.discord.embed().setTitle(m.title || 'Vehicle Rental');
      const B = host.discord.js;
      const rentRow = host.discord.row(new B.ButtonBuilder().setCustomId(OPEN).setLabel(c.buttonLabel || 'Rent a vehicle').setStyle(B.ButtonStyle.Success));

      let mine = [];
      if (ed && ed.components) {
        try { mine = ed.components(m.buttons, m.selects) || []; } catch (e) { host.logger.warn('menu components failed: ' + e.message); }
      }
      const payload = { components: [rentRow].concat(mine).slice(0, 5) };   // Discord's five-row limit

      const embeds = [embed];
      if (ed && Array.isArray(m.extraEmbeds)) {
        m.extraEmbeds.slice(0, 9).forEach(function (x) { if (x) { try { embeds.push(ed.embed(x)); } catch (e) {} } });
      }
      payload.embeds = embeds;
      if (typeof m.content === 'string' && m.content.trim()) payload.content = m.content;
      return host.discord.send(c.channelId, payload);
    }

    // ── the rental core, shared by Discord and chat ────────────────────────────

    // Every reason a rental may be refused, in one place. Returns an error string or null.
    // Keyed on STEAM ID, not the Discord id: the same person renting from Discord and from chat is
    // one player, and counting them separately would hand out two vehicles where one is allowed.
    // A per-vehicle limit NARROWS the server-wide one; it never replaces it. Both are checked, and
    // the stricter answer wins. Before, setting any per-vehicle limit made the code count only that
    // vehicle's rentals and stop consulting the global cap at all — so two vehicles each capped at 1
    // let a player hold two under a server cap of one. The message says which rule stopped them.
    function limitsError(steamId, vehIdx, v, c) {
      if (!db) return null;
      const vi = String(vehIdx);
      const pv = (field) => {
        const raw = v[field];
        if (raw == null || raw === '') return null;
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;      // "abc" typed into the box is not a limit of NaN
      };
      const nAll = () => db.prepare('SELECT COUNT(*) n FROM rentals WHERE active=1 AND steamId=?').get(steamId).n;
      const nVeh = () => db.prepare('SELECT COUNT(*) n FROM rentals WHERE active=1 AND steamId=? AND vehIdx=?').get(steamId, vi).n;

      const gMax = Number(c.maxPerPlayer) || 0;
      if (gMax > 0 && nAll() >= gMax) return 'You already have the maximum active rentals (' + gMax + ').';
      const mMax = pv('maxPerPlayer');
      if (mMax != null && mMax > 0 && nVeh() >= mMax) return 'You already have the maximum active rentals (' + mMax + ') for this vehicle.';

      const tooSoon = (minutes, last) => (minutes && last && (Date.now() - last) < minutes * 60000)
        ? '⏳ You are renting too often — you can rent again in ' + fmtLeft(last + minutes * 60000 - Date.now()) + '.'
        : null;
      const gCd = Number(c.cooldownMinutes) || 0;
      if (gCd) {
        const e = tooSoon(gCd, db.prepare('SELECT MAX(startedAt) m FROM rentals WHERE steamId=?').get(steamId).m);
        if (e) return e;
      }
      const mCd = pv('cooldownMinutes');
      if (mCd) {
        const e = tooSoon(mCd, db.prepare('SELECT MAX(startedAt) m FROM rentals WHERE steamId=? AND vehIdx=?').get(steamId, vi).m);
        if (e) return e;
      }

      const gDl = Number(c.dailyLimit) || 0;
      if (gDl && db.prepare('SELECT COUNT(*) n FROM rentals WHERE steamId=? AND startedAt >= ?').get(steamId, Date.now() - 86400000).n >= gDl) {
        return '📵 You reached the rental limit (' + gDl + '/day).';
      }
      const mDl = pv('dailyLimit');
      if (mDl && db.prepare('SELECT COUNT(*) n FROM rentals WHERE steamId=? AND vehIdx=? AND startedAt >= ?').get(steamId, vi, Date.now() - 86400000).n >= mDl) {
        return '📵 You reached the rental limit (' + mDl + '/day for this vehicle).';
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

    // The price is taken from the BANK account, which is also what is checked here — money in a
    // player's pocket does not count. Saying so matters: a player carrying the cash and reading
    // "not enough money" has no idea they only need to deposit it.
    function affordError(steamId, o, c) {
      if (c.free) return null;
      const need = Math.max(0, parseInt(o.amount, 10) || 0);
      const unit = o.currency === 'gold' ? 'gold' : 'money';
      // `finances()` answers null for an unknown profile or a failed read. Treating that as zero told
      // a solvent player they were broke and refused the rental; not knowing is a reason to let the
      // charge decide, not a reason to say no.
      const fin = host.players.finances(steamId);
      if (!fin) return null;
      const have = o.currency === 'gold' ? (fin.gold || 0) : (fin.bank || 0);
      if (have >= need) return null;
      let msg = '💸 Not enough ' + unit + ' — this rental costs ' + need + ' ' + unit + ', your bank account has ' + have + '.';
      // The one piece of advice that actually fixes it, and only when it would.
      const cash = Number(fin.cash) || 0;
      if (o.currency !== 'gold' && cash > 0 && (have + cash) >= need) msg += ' You are carrying ' + cash + ' — deposit it at a bank and try again.';
      return msg;
    }

    /**
     * Rent one vehicle. `who` = { steamId, discordId, playerName }.
     * Returns { ok, error, exp, vehId, v, o } — the caller decides how to say it.
     */
    // One rental at a time per player. Double-clicking the plan menu in Discord fires this twice;
    // both calls read the limits before either has written its row, so both used to pass — two
    // vehicles spawned, two charges taken, and the server's own cap quietly ignored.
    const renting = new Set();

    async function rent(who, vehIdx, optIdx) {
      const key = String(who.steamId || '');
      if (renting.has(key)) return { ok: false, error: '⏳ Your rental is still being processed — give it a moment.' };
      renting.add(key);
      try { return await rentInner(who, vehIdx, optIdx); } finally { renting.delete(key); }
    }

    async function rentInner(who, vehIdx, optIdx) {
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

      // What was already parked here, so the vehicle we are about to spawn can be told apart from
      // the player's own. Taken BEFORE the spawn — after it, the two are indistinguishable.
      const before = vehicleIdSet();

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
      if (!paid) {
        // The payment failed, so take the vehicle back rather than leave the player with one they did
        // not pay for. This one CANNOT be deferred — it has to find the vehicle now to remove it.
        const orphan = await captureVehicleId({ x: loc.x + 300, y: loc.y, z: loc.z }, before);
        if (orphan && c.removeCmd) { try { await host.server.command(fill(c.removeCmd, { vehId: orphan, steamid: who.steamId })); } catch (e) {} }
        else if (!orphan) host.logger.warn('rental: payment failed and the spawned vehicle could not be found to remove — check for a stray ' + (v.name || 'vehicle'));
        return { ok: false, error: '⚠️ Payment failed, so the rental was cancelled. You were not charged.' };
      }

      const now = Date.now(), exp = now + (parseInt(o.minutes, 10) || 60) * 60000;
      let rentalId = null;
      if (db) {
        const ins = db.prepare('INSERT INTO rentals (discordId,steamId,playerName,vehIdx,vehName,vehId,optIdx,startedAt,expiresAt,paidAmount,paidCurrency,paidMinutes,vehCode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(who.discordId || '', who.steamId, who.playerName || '', String(vehIdx), v.name || '', '', Number(optIdx), now, exp,
            c.free ? 0 : Math.max(0, parseInt(o.amount, 10) || 0), o.currency === 'gold' ? 'gold' : 'money', parseInt(o.minutes, 10) || 60, v.code || '');
        rentalId = ins.lastInsertRowid;
      }
      // Filled in behind the confirmation — see captureLater.
      captureLater(rentalId, { x: loc.x + 300, y: loc.y, z: loc.z }, before);

      await say(who.steamId, fill(txt(c, 'confirmed'), vars(c, { player: who.playerName || '', vehicle: v.name || 'vehicle', duration: fmtDur(o.minutes), price: c.free ? 'Free' : money(o) })));
      host.notify('admin.alert', { message: 'Vehicle rented: ' + (v.name || '?') + ' by ' + (who.playerName || who.steamId), severity: 'info' });
      return { ok: true, exp: exp, rentalId: rentalId, v: v, o: o };
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
    // The panel advertises {player} {vehicle} {duration} {price} {left} {sector} {cmd} {list} on
    // EVERY line, and `fill` replaces an unsupplied token with an empty string. So a line written
    // as "{player} returned {vehicle} — you get {price} back" arrived as " returned Rager — you
    // get  back": the promise was longer than the delivery. Every line now starts from the whole
    // set, and a caller overrides the parts it actually knows.
    const vars = (c, extra) => Object.assign({
      cmd: host.chat.prefix ? host.chat.prefix() : '/',
      player: '', vehicle: '', duration: '', price: '', left: '', sector: '', list: '',
    }, extra || {});

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


    /**
     * The plan this rental was actually sold on, from the row itself.
     *
     * Falls back to the configured plan for rows written before the price was recorded — those are
     * the only ones that can still be wrong, and only if the list has been reordered since.
     */
    function planOf(r, c) {
      if (r.paidAmount != null && r.paidCurrency) {
        return { amount: r.paidAmount, currency: r.paidCurrency, minutes: r.paidMinutes || 60, fromRow: true };
      }
      const v = (c.vehicles || [])[Number(r.vehIdx)];
      const o = v && (v.options || [])[Number(r.optIdx)];
      return o ? Object.assign({}, o, { fromRow: false }) : null;
    }

    /**
     * Everything a message about a rental can say, from the rental itself.
     *
     * The panel advertises {player} {vehicle} {duration} {price} {left} on every line, and `fill`
     * turns an unsupplied token into an empty string — so a line written as "{player} returned
     * {vehicle} after {duration}" arrived as " returned Rager after ". The promise was longer than
     * the delivery, and only the confirmation was ever handed the full set. Now every line is.
     */
    function rentalVars(r, c, extra) {
      const o = planOf(r, c);
      return vars(c, Object.assign({
        player: r.playerName || '',
        vehicle: r.vehName || 'vehicle',
        duration: o ? fmtDur(o.minutes) : '',
        price: (c.free || !o) ? 'Free' : money(o),
        left: r.expiresAt ? fmtLeft(r.expiresAt - Date.now()) : '',
      }, extra || {}));
    }

    /** Close a rental: remove the vehicle if it is still there, mark the row, tell the player. */
    async function endRental(r, reason) {
      const c = cfg();
      // A rental can end while its vehicle is still being identified — a player who rents and
      // immediately returns, or an admin ending one straight away. Wait for that answer instead of
      // treating "not known yet" as "there is nothing to remove".
      const vehId = await vehIdOf(r);
      const stillThere = c.verifyVehicle === false ? true : vehicleExists(vehId);
      let removed = false;
      if (vehId && c.removeCmd && stillThere) {
        try { const res = await host.server.command(fill(c.removeCmd, { vehId: vehId, steamid: r.steamId })); removed = !(res && res.ok === false); }
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
      if (c.enabled === false) return i.reply({ content: fill(txt(c, 'disabled'), vars(c)), ...EPHEMERAL });
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
      // Returning without replying leaves Discord showing the player "This interaction failed" and
      // no reason at all. Every path out of here answers.
      if (!db) return i.reply({ content: 'Rentals are not available right now (no database).', ...EPHEMERAL });
      const r = db.prepare('SELECT * FROM rentals WHERE id=? AND active=1').get(Number(rentalId));
      if (!r) return i.reply({ content: 'That rental is no longer active.', ...EPHEMERAL });
      const out = await extendRental(r);
      return i.reply({ content: out.ok ? '🔄 Rental extended! New expiry: <t:' + Math.floor(out.exp / 1000) + ':R>' : out.error, ...EPHEMERAL });
    }

    /**
     * Extend one rental. Shared by the Discord button and the chat command.
     *
     * Guarded per rental for the same reason renting is: the Extend button on a reminder DM is easy
     * to hit twice, and both calls would charge before either had written the new expiry.
     */
    const extending = new Set();
    async function extendRental(r) {
      const key = 'r' + r.id;
      if (extending.has(key)) return { ok: false, error: '⏳ That extension is still being processed.' };
      extending.add(key);
      try { return await extendInner(r); } finally { extending.delete(key); }
    }

    async function extendInner(r) {
      const c = cfg();
      if (c.allowExtend === false) return { ok: false, error: 'Extensions are turned off.' };
      const v = c.vehicles[Number(r.vehIdx)];
      const o = planOf(r, c);
      const effMaxExt = (v && v.maxExtensions != null && v.maxExtensions !== '') ? Number(v.maxExtensions) : c.maxExtensions;
      if (effMaxExt && (r.extensions || 0) >= effMaxExt) return { ok: false, error: 'This rental has reached the maximum number of extensions (' + effMaxExt + ').' };
      if (!o) return { ok: false, error: 'This rental has no recorded price, so it cannot be extended. Ask an admin to end it and rent again.' };
      const affErr = affordError(r.steamId, o, c);
      if (affErr) return { ok: false, error: affErr.replace('this rental costs', 'extending costs') };
      // Same rule as renting: if the charge doesn't land, don't hand out the time.
      const paid = await charge(r.steamId, o, 1);
      if (!paid) return { ok: false, error: '⚠️ Payment failed — the rental was not extended.' };
      const exp = Math.max(Date.now(), r.expiresAt) + (parseInt(o.minutes, 10) || 60) * 60000;
      db.prepare('UPDATE rentals SET expiresAt=?, reminded=0, extensions=extensions+1 WHERE id=?').run(exp, r.id);
      await say(r.steamId, fill(txt(c, 'extendOk'), rentalVars(r, c, { duration: fmtDur(o.minutes) })));
      return { ok: true, exp: exp, v: v, o: o };
    }

    function confirmEmbed(v, o, exp) {
      // The image the admin picked. The panel offers the field, fills it in automatically from the
      // item database when a vehicle is chosen, and saves it — and nothing ever read it back, so it
      // appeared nowhere a player could see.
      const e = host.discord.embed().setTitle('✅ Rental confirmed').setColor(0x54c98a);
      if (v && v.image) { try { e.setThumbnail(v.image); } catch (err) { /* bad URL */ } }
      return e
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
    //
    // Registered from the CURRENT config every time it is saved, not once at startup. The names and
    // the on/off switch used to be read at register time, so renaming /rent in the panel left the old
    // command working and the new one doing nothing — with no hint that a manager restart was needed.
    let cmdOffs = [];
    function unregisterCommands() {
      cmdOffs.forEach(function (off) { try { if (typeof off === 'function') off(); } catch (e) {} });
      cmdOffs = [];
    }
    function registerCommands() {
      unregisterCommands();
      const c0 = cfg();
      if (c0.inGameCommands === false) { host.logger.info('in-game commands: off'); return; }
      const activeFor = (steamId) => (db ? db.prepare('SELECT * FROM rentals WHERE active=1 AND steamId=? ORDER BY expiresAt').all(String(steamId)) : []);

      cmdOffs.push(host.chat.onCommand(c0.cmdRent || 'rent', async function (ctx) {
        const c = cfg();
        if (c.enabled === false) return ctx.reply(fill(txt(c, 'disabled'), vars(c)));
        const list = (c.vehicles || []);
        if (!list.length) return ctx.reply('No vehicles are available right now.');
        const n = parseInt(ctx.args[0], 10);
        const p = parseInt(ctx.args[1], 10);
        // No arguments (or nonsense) → show what can be rented, numbered, so the next command is obvious.
        if (!Number.isFinite(n) || n < 1 || n > list.length) {
          const lines = list.map(function (v, idx) {
            const plans = (v.options || []).map(function (o, oi) { return (oi + 1) + ') ' + fmtDur(o.minutes) + (c.free ? '' : ' ' + money(o)); }).join('  ');
            return (idx + 1) + '. ' + (v.name || 'Vehicle') + ' — ' + (plans || 'no plans');
          });
          return ctx.reply(fill(txt(c, 'rentUsage'), vars(c, { list: fitLines(lines) })));
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
      }));

      cmdOffs.push(host.chat.onCommand(c0.cmdMine || 'myrent', async function (ctx) {
        const c = cfg();
        const rows = activeFor(ctx.steamId);
        if (!rows.length) return ctx.reply(fill(txt(c, 'noRentals'), vars(c)));
        const now = Date.now();
        const lines = rows.map(function (r) { return fill(txt(c, 'mineLine'), rentalVars(r, c, { left: fmtLeft(r.expiresAt - now) })); });
        return ctx.reply(fitLines(lines, 'check the rest in Discord'));
      }));

      cmdOffs.push(host.chat.onCommand(c0.cmdExtend || 'extend', async function (ctx) {
        const c = cfg();
        const rows = activeFor(ctx.steamId);
        if (!rows.length) return ctx.reply(fill(txt(c, 'noRentals'), vars(c)));
        // The one running out first is the one they mean.
        const out = await extendRental(rows[0]);
        if (!out.ok) return ctx.reply(out.error);
        // extendOk already delivered by extendRental's say()
      }));

      cmdOffs.push(host.chat.onCommand(c0.cmdReturn || 'return', async function (ctx) {
        const c = cfg();
        if (c.allowReturn === false) return ctx.reply('Returning early is turned off.');
        const rows = activeFor(ctx.steamId);
        if (!rows.length) return ctx.reply(fill(txt(c, 'noRentals'), vars(c)));
        const r = rows[0];
        const out = await endRental(r, 'returned');
        // Refund only what was actually given back: no vehicle to reclaim, no refund.
        const pct = Math.max(0, Math.min(100, Number(c.refundPercent) || 0));
        let refundNote = '';
        if (pct && out.removed) {
          const o = planOf(r, c);
          if (!o) refundNote = ' (no refund — this rental has no recorded price; tell an admin)';
          else {
            // A refund that fails must not be reported as a refund that happened. This used to be a
            // bare `catch {}` around a return value nobody read, so a bridge refusal reached the
            // player as "Thanks!" and nothing in their bank.
            let paid = false;
            try { paid = await charge(r.steamId, o, -(pct / 100)); } catch (e) { paid = false; }
            if (!paid) {
              refundNote = ' (the refund could not be paid out — tell an admin)';
              host.logger.warn('rental #' + r.id + ': refund of ' + pct + '% failed for ' + (r.playerName || r.steamId));
            }
          }
        }
        return ctx.reply(fill(txt(c, 'returned'), rentalVars(r, c))
          + (!out.stillThere ? ' (the vehicle was already gone)' : '') + refundNote);
      }));

      host.logger.info('in-game commands: ' + [c0.cmdRent || 'rent', c0.cmdMine || 'myrent', c0.cmdExtend || 'extend', c0.cmdReturn || 'return'].map(function (n) { return (host.chat.prefix ? host.chat.prefix() : '/') + n; }).join(' '));
    }
    registerCommands();

    // ── lifecycle: reminders + expiry + auto-removal ──
    // `host.schedule.every` does not await an async callback, and one sweep is a bridge round-trip
    // plus a DM plus a chat line PER expired rental. A sweep still running when the next minute ticks
    // re-selected the same rows — the vehicle was destroyed twice and the player told twice.
    let sweeping = false;
    host.schedule.every(60000, async function () {
      if (!db || sweeping) return;
      sweeping = true;
      try { await sweep(); } finally { sweeping = false; }
    });
    async function sweep() {
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
        await say(r.steamId, fill(txt(c, 'endingSoon'), rentalVars(r, c, { left: fmtLeft(r.expiresAt - now) })));
        db.prepare('UPDATE rentals SET reminded=1 WHERE id=?').run(r.id);
      }
      const expired = db.prepare('SELECT * FROM rentals WHERE active=1 AND expiresAt <= ?').all(now);
      for (const r of expired) {
        const out = await endRental(r, 'expired');
        const em = host.discord.embed().setTitle('⚠️ Rental ended').setColor(0xff5c5c)
          .setDescription('Your **' + (r.vehName || 'vehicle') + '** rental has expired' + (out.removed ? ' and the vehicle has been removed.' : '.'));
        if (r.discordId) { try { await host.discord.dm(r.discordId, { embeds: [em] }); } catch (e) {} }
        await say(r.steamId, fill(txt(c, 'ended'), rentalVars(r, c)));
      }
    }

    host.logger.info('Vehicle Rental System ready');
  },
};
