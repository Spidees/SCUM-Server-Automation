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
        requireOnline: false,   // must be online in-game to rent or extend (returning is always allowed)
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

        // When renting is open at all, server-wide. An EMPTY list means always, which is what every
        // config written before this existed says, so nothing changes for anybody.
        //
        // Windows also live on each vehicle (`v.windows`) and on each plan (`o.windows`). A plan is
        // where a price lives, so a plan window is how "the same vehicle costs less on a weekday
        // evening" is expressed: two plans, one windowed to the evening and one not. There is
        // deliberately no separate "discount" concept — a second plan already says it, and a discount
        // that could disagree with the plan it discounts is a second price nobody can see.
        //
        // The clock is the SERVER'S, never the game's day/night cycle. `host.time.describe()` puts
        // that sentence on the panel and in the refusal, because "from 20:00" means two things.
        windows: [],

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
          // {window} is filled with the manager's own sentence for the window that refused, which
          // always names the clock — a player reading "from 20:00" has no way to know otherwise
          // whether that is the server's evening or the game's.
          closedNow: '⏳ {vehicle} is not available right now — {window}',
        },
      };
    }
    const cfg = () => Object.assign(defaultConfig(), host.store.get('config', {}));
    const setCfg = (c) => host.store.set('config', Object.assign(defaultConfig(), c || {}));
    // texts merge one level deeper, so a config saved before a line existed still gets its default
    // instead of an empty message.
    const txt = (c, key) => Object.assign(defaultConfig().texts, c.texts || {})[key] || '';

    // ── time windows ───────────────────────────────────────────────────────────
    //
    // ONE evaluator, `host.time`, shared with every other plugin that offers this — so "Fri
    // 22:00–02:00" cannot mean one thing on this tab and another on the Chat Commands tab. It runs on
    // the SERVER'S WALL CLOCK; the reasoning is in the manager's own `timeWindows.js` and the short
    // version is on the panel and in every refusal.
    //
    // On a manager too old to have it, a CONFIGURED window is treated as CLOSED rather than ignored.
    // That is the safe direction and it is not the comfortable one: the alternative is a happy-hour
    // price quietly running all day and nobody noticing until the month's economy is wrong, where
    // this produces a player complaint on the first evening and a log line saying exactly why.
    let _warnedNoTimeApi = false;
    function timeApi() {
      const t = host.time;
      if (t && typeof t.isOpen === 'function') return t;
      if (!_warnedNoTimeApi) {
        _warnedNoTimeApi = true;
        host.logger.warn('this manager is too old to evaluate time windows (host.time is missing), so every vehicle or plan that has one is treated as CLOSED. Update the manager, or clear the time windows in the plugin\'s admin tab.');
      }
      return null;
    }
    const hasWindows = (w) => Array.isArray(w) && w.length > 0;

    /**
     * Is this vehicle/plan rentable at this moment? `null` to allow, or the line the player sees.
     *
     * Three levels, checked outermost first so the message names the rule that actually stopped
     * them: the server's own rental hours, then the vehicle, then the plan. Naming the innermost
     * rule when an outer one is what shut the door is how a player ends up waiting for a window that
     * was never going to help.
     */
    function windowError(c, v, o) {
      const levels = [
        [c.windows, 'Rentals'],
        [v && v.windows, (v && v.name) || 'This vehicle'],
        [o && o.windows, `${(v && v.name) || 'This vehicle'} at this plan`],
      ];
      for (const [w, what] of levels) {
        if (!hasWindows(w)) continue;
        const t = timeApi();
        if (!t) return fill(txt(c, 'closedNow'), vars(c, { vehicle: what, window: 'time windows need a newer manager, so this is switched off until an admin updates it' }));
        const r = t.isOpen(w);
        if (!r.open) return fill(txt(c, 'closedNow'), vars(c, { vehicle: what, window: r.why }));
      }
      return null;
    }

    /** The same question with no message attached — for listing what a player can rent right now. */
    function windowOpen(c, v, o) { return windowError(c, v, o) === null; }

    /**
     * Tidy a window list on the way IN, before it is stored.
     *
     * Not the same job as `host.time.validate()`, which refuses what cannot be read. This fixes what
     * is merely untidy — `days` out of order, a day listed twice, `"3"` where a number was meant,
     * whitespace around a time — so it never reaches the store at all. The panel already sends clean
     * data; a config edited by hand, written by an older panel or copied between servers does not,
     * and every one of those defects would otherwise present to an owner as a vehicle that quietly
     * stopped being rentable.
     *
     * All seven days is the same as none: both mean every day, and storing the empty form keeps one
     * representation instead of two that have to agree.
     */
    function normalizeWindows(list) {
      if (!Array.isArray(list)) return [];
      return list.map(function (w) {
        if (!w || typeof w !== 'object') return w;
        const days = [];
        (Array.isArray(w.days) ? w.days : []).forEach(function (d) {
          const n = Number(d);
          // Positive form: every comparison against NaN is false, so `n < 1 || n > 7` would let one
          // straight through. That shape has cost this project six separate bugs elsewhere.
          if (Number.isInteger(n) && n >= 1 && n <= 7 && days.indexOf(n) < 0) days.push(n);
        });
        days.sort(function (a, b) { return a - b; });
        return {
          days: days.length === 7 ? [] : days,
          from: String(w.from == null ? '' : w.from).trim(),
          to: String(w.to == null ? '' : w.to).trim(),
          tz: w.tz || null,
        };
      });
    }

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

    // ── admin routes ──
    host.routes.get('/config', function (req, res) { res.json(cfg()); });
    /**
     * Does sector detection actually work right now?
     *
     * The allowed/blocked sector fields are the only settings here that can be filled in correctly
     * and still do nothing: they depend on map calibration, which is fetched from scumsa, and when
     * that is unavailable `host.map.sector()` returns null and every rule quietly stops applying.
     * The panel asks this so it can say so beside the fields instead of showing settings that look
     * live and are not.
     *
     * It probes with a real online player when there is one — that is the same call a rental makes,
     * so it answers the question that matters rather than a similar one.
     */
    host.routes.get('/sector-status', async function (req, res) {
      const c = cfg();
      const configured = ((c.allowedSectors || []).filter(Boolean).length + (c.blockedSectors || []).filter(Boolean).length) > 0;
      let works = sectorWorks;
      if (works === null) {
        // Nothing has asked yet. Probe with any player we can see; with nobody online there is
        // nothing honest to say, so say that.
        const w = (function () { try { return host.map.world() || {}; } catch (e) { return {}; } }());
        const p = (w.players || [])[0];
        if (p && host.map.sector) {
          try { works = !!(await host.map.sector(p.x, p.y)); } catch (e) { works = false; }
        }
      }
      res.json({ configured, works });
    });
    /**
     * What the server's clock says, and how this manager will read the windows that are configured.
     *
     * The panel draws its window editor from this and nothing else, so both plugins that offer time
     * windows show the SAME sentence about the SAME clock. It answers with the server stopped and
     * with no bridge — a window is a wall-clock question and nothing about it is live data.
     *
     * `supported: false` is the honest answer on a manager too old to evaluate one, and the panel
     * says so beside the fields rather than drawing controls that quietly do nothing.
     */
    host.routes.get('/clock', function (req, res) {
      const t = host.time;
      if (!t || typeof t.now !== 'function') {
        return res.json({ supported: false, why: 'This manager is too old to evaluate time windows. Any window set here is treated as CLOSED until it is updated.' });
      }
      res.json({ supported: true, now: t.now(), zone: t.zone() });
    });
    /**
     * What a window an owner is EDITING right now would do — the sentence, whether it is open, and
     * anything wrong with it.
     *
     * It takes the windows in the request rather than reading the saved config, because the question
     * is about the edit in progress. That is the whole reason this route exists: the panel could
     * render "Mon–Fri 20:00–22:00" itself in about six lines, and then there would be two
     * implementations of the wrap rule, the day names and the clock caption — and the one in the
     * browser would be the one that quietly disagreed.
     */
    host.routes.post('/clock/preview', function (req, res) {
      const t = host.time;
      if (!t || typeof t.describe !== 'function') return res.json({ supported: false, text: '', errors: [] });
      const w = (req.body && Array.isArray(req.body.windows)) ? req.body.windows : [];
      const v = t.validate(w);
      const state = t.isOpen(w);
      res.json({ supported: true, text: t.describe(w), open: !!state.open, why: state.why, errors: v.errors });
    });
    host.routes.post('/config', function (req, res) {
      // A window nobody can read must not reach a price. `validate()` is the same rule `isOpen()`
      // applies, asked before the save rather than after, so the panel can refuse with the reason
      // instead of the owner finding out from a player that a kit vanished.
      const t = host.time;
      if (t && typeof t.validate === 'function') {
        const body = req.body || {};
        // Tidy first, judge second: a duplicate or unsorted day is not a reason to refuse a save.
        if (Array.isArray(body.windows)) body.windows = normalizeWindows(body.windows);
        (body.vehicles || []).forEach(function (v) {
          if (v && Array.isArray(v.windows)) v.windows = normalizeWindows(v.windows);
          ((v && v.options) || []).forEach(function (o) { if (o && Array.isArray(o.windows)) o.windows = normalizeWindows(o.windows); });
        });
        const problems = [];
        const collect = (w, where) => {
          if (!Array.isArray(w) || !w.length) return;
          const v = t.validate(w);
          if (!v.ok) v.errors.forEach((e) => problems.push(`${where}: ${e}`));
        };
        collect(body.windows, 'Rental hours');
        (body.vehicles || []).forEach((v, i) => {
          collect(v && v.windows, `${(v && v.name) || `Vehicle ${i + 1}`} — availability`);
          ((v && v.options) || []).forEach((o, oi) => collect(o && o.windows, `${(v && v.name) || `Vehicle ${i + 1}`} — plan ${oi + 1}`));
        });
        if (problems.length) return res.json({ ok: false, error: problems.join('\n') });
      }
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
      try { return await endRoute(req, res); } catch (e) {
        host.logger.warn('ending a rental failed: ' + e.message);
        return res.json({ ok: false, error: e.message });
      }
    });
    async function endRoute(req, res) {
      if (!db) return res.json({ ok: false, error: 'no database' });
      const id = Number((req.body || {}).id);
      const r = db.prepare('SELECT * FROM rentals WHERE id=? AND active=1').get(id);
      if (!r) return res.json({ ok: false, error: 'that rental is not active' });
      const out = await endRental(r, 'admin');
      // Two things the player has to be told, and neither was said here.
      //
      // That an ADMIN ended it: the wording is "your rental has ended", which reads as expiry, so a
      // player whose hour was cut to ten minutes goes looking for a bug that is not there.
      //
      // And whether the vehicle actually went. The default text claims "the vehicle was removed"
      // unconditionally; the expiry sweep corrects that when it could not, and this path did not —
      // so the one case where a player needs to know their vehicle is still out there was the one
      // case they were told the opposite.
      await say(r.steamId, fill(txt(cfg(), 'ended'), rentalVars(r, cfg()))
        + ' (ended by an admin)'
        + (out.removed ? '' : ' — it could not be removed, so it may still be there'));
      host.logger.info('rental #' + id + ' ended by an admin (' + (r.playerName || r.steamId) + ')'
        + (out.removed ? '' : ' — the vehicle could NOT be removed')
        + '. No refund was paid: ending a rental from the panel does not refund, unlike a player returning one.');
      res.json({ ok: true, removed: out.removed, stillThere: out.stillThere });
    }
    /**
     * Is there a Discord bot at all?
     *
     * The panel needs this because an empty channel list has two causes that look identical and read
     * completely differently: a bot that is connected to a guild with no text channels, and no bot.
     * The tab used to answer both with a dropdown containing one placeholder and nothing else, under
     * a heading that said "Players rent vehicles through the Discord bot" — so an owner running a
     * chat-only server was told they needed something they did not, and shown a broken-looking
     * control to prove it.
     *
     * Its own route rather than a key on `/config`, because the panel POSTs the config object back
     * and anything that rides along in it would be saved as a setting.
     */
    host.routes.get('/discord-state', function (req, res) {
      let enabled = false;
      try { enabled = !!(host.discord && typeof host.discord.enabled === 'function' && host.discord.enabled()); } catch (e) { enabled = false; }
      res.json({ enabled });
    });
    host.routes.get('/channels', async function (req, res) {
      const c = host.discord.client(); if (!c) return res.json([]);
      try { const g = c.guilds.cache.first(); if (!g) return res.json([]); const all = await g.channels.fetch(); const out = []; all.forEach(function (ch) { if (ch && ch.type === 0) out.push({ id: ch.id, name: ch.name }); }); out.sort(function (a, b) { return a.name.localeCompare(b.name); }); res.json(out); }
      catch (e) { res.json([]); }
    });
    // The host wraps a SYNC throw for you; an async one escapes as an unhandled rejection and the
    // browser never gets a reply at all — the panel sits on "Posting…" for ever. An over-long button
    // label is enough to cause it, because discord.js validates at the setter.
    host.routes.post('/post-menu', async function (req, res) {
      try {
        const done = await postMenu();
        if (done) return res.json({ ok: true });
        return res.json({ ok: false, error: !cfg().channelId ? 'no channel is set' : 'the bot could not post there' });
      } catch (e) {
        host.logger.warn('post-menu failed: ' + e.message);
        return res.json({ ok: false, error: e.message });
      }
    });

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
      // Trimmed to Discord's limits BEFORE anything is built from it. Each embed here was already
      // clamped individually, but the 6000-character budget is per MESSAGE and nothing checked it:
      // one main embed plus nine extras can legally sum to sixty thousand. Discord then refuses the
      // whole post, `discord.send` returns false, and the panel reports "the bot could not post
      // there" — sending the owner to fix a permission that was never the problem.
      //
      // `ed.fit()` is the editor's own implementation of exactly this, so there is no second copy of
      // Discord's limits here to go stale.
      const m = (ed && ed.fit) ? ed.fit(JSON.parse(JSON.stringify(c.menuEmbed || {}))) : (c.menuEmbed || {});
      // Without the embed editor, build what we can from the model ourselves rather than posting a
      // bare title. The owner configured a description and a colour before they ever installed the
      // editor — dropping them silently makes the menu look broken and blames nothing.
      let embed;
      if (ed) {
        embed = ed.embed(m);
      } else {
        embed = host.discord.embed();
        try {
          if (m.title) embed.setTitle(String(m.title).slice(0, 256));
          if (m.description) embed.setDescription(String(m.description).slice(0, 4096));
          const col = typeof m.color === 'string' ? parseInt(m.color.replace('#', ''), 16) : m.color;
          if (Number.isFinite(col)) embed.setColor(col);
          if (m.image && m.image.url) embed.setImage(m.image.url);
          if (m.thumbnail && m.thumbnail.url) embed.setThumbnail(m.thumbnail.url);
        } catch (e) { host.logger.warn('menu embed: ' + e.message); }
        if (Array.isArray(m.buttons) && m.buttons.length) {
          host.logger.info('the Discord Embeds plugin is off, so the menu embed keeps its text but loses its extra buttons and menus');
        }
      }
      const B = host.discord.js;
      // 80 characters, and discord.js throws at the setter — an owner with a long label got an error
      // rather than a shortened button.
      const rentRow = host.discord.row(new B.ButtonBuilder().setCustomId(OPEN).setLabel(String(c.buttonLabel || 'Rent a vehicle').slice(0, 80)).setStyle(B.ButtonStyle.Success));

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

    /**
     * Did an in-game command actually happen?
     *
     * `ok !== false` is not the whole test any more. Since SSA Bridge 2.0.0 the bridge can run a
     * command with NOBODY on the server — the owner switches `allowNoExecutor` on and it dispatches
     * through the game's static entry point, which returns void. The reply then carries
     * `executor: 'none', confirmed: false, output: null`, and `ok` is still true, because the bridge
     * did hand the line over. It does not mean the game accepted it, or even recognised it.
     *
     * Every command this plugin runs decides whether somebody's money moves: a spawn that is charged
     * for, a charge, a refund, a removal it tells the player about. So all four ask this instead of
     * `ok`, and an unconfirmed dispatch is treated as "it did not happen" — the direction that costs
     * a stray vehicle rather than a player's balance.
     *
     * `confirmed` is simply absent on the ordinary executor path, so `!== false` is the whole guard
     * and nothing changes for a server that has an executor (or an older bridge that never sends it).
     */
    function ran(res) { return !!res && res.ok !== false && res.confirmed !== false; }

    async function charge(steamId, o, factor) {
      const refund = factor != null && factor < 0;
      // Free mode stops CHARGING. It must not stop a refund: someone who paid 500 yesterday and is
      // owed 250 today is owed it whether or not new rentals are free now. Skipping it silently
      // closed the rental, told the player "Thanks!" and paid nothing.
      if (cfg().free && !refund) return true;
      const raw = Math.max(0, parseInt(o.amount, 10) || 0) * (factor == null ? 1 : Math.abs(factor));
      const amount = Math.round(raw);
      const cur = o.currency === 'gold' ? 'Gold' : 'Normal';
      // A payout that rounds to nothing is not a payout. `Math.round(-0.4)` is `-0`, which is falsy,
      // so a 40% refund on a 1-gold rental reported success and moved no gold.
      if (!amount) return !refund;
      // The sign is the whole difference between charging and refunding. Both are DELTAS, which is
      // what keeps a stale balance out of the amount: the game applies ±N to whatever the balance
      // really is at that instant, so a refund is never computed from a figure read minutes ago.
      const res = await host.server.command('#ChangeCurrencyBalance ' + cur + ' ' + (refund ? '' : '-') + Math.abs(amount) + ' ' + steamId);
      if (res && res.confirmed === false) {
        host.logger.warn(`the bridge dispatched #ChangeCurrencyBalance for ${steamId} with no executor, so the game never confirmed it — treating the ${refund ? 'refund' : 'charge'} of ${amount} ${o.currency === 'gold' ? 'gold' : 'money'} (their ${poolWord(o.currency)}) as NOT made`);
      }
      const done = ran(res);
      // Which pool the money moved in, so an owner reconciling by hand knows which balance to look
      // at — "500 money" does not say whether that is the bank account or gold.
      if (done) host.logger.debug(`${refund ? 'refunded' : 'took'} ${amount} ${refund ? 'to' : 'from'} ${steamId}'s ${poolWord(o.currency)}`);
      return done;
    }

    /**
     * WHICH POOL a rental is paid from, said once so the log and the player's message agree.
     *
     * The game's `ECurrencyType` is `{ None=0, Normal=1, Gold=2 }` and a player carries exactly one
     * balance per value — `_moneyBalanceRep` for Normal, `_goldBalanceRep` for Gold, both written by
     * the one setter `SetCurrencyBalanceRep(ECurrencyType, int64)`. The save keys the same two
     * values the same way: `bank_account_registry_currencies.currency_type` is 1 for money, 2 for
     * gold. So `#ChangeCurrencyBalance Normal`, the bridge's live `money` reading and the manager's
     * `finances().bank` are all ONE pool — the bank account — and this plugin charges and checks the
     * same one it names.
     */
    const poolWord = (cur) => (cur === 'gold' ? 'gold balance' : 'bank account');
    const finite = (v) => ((typeof v === 'number' && Number.isFinite(v)) ? v : null);

    // The bridge's live `money` group ships OFF, so "the game answered but said nothing about money"
    // is the commonest reason this falls back to the save. Once per boot, not once per rental.
    let _warnedLiveOff = false;
    function warnLiveOff() {
      if (_warnedLiveOff) return;
      _warnedLiveOff = true;
      host.logger.warn('the SSA Bridge answered about this player but not about their money — turn on Bridge → Live data → "Money, gold and account number" (that group ships OFF). Until then a rental is priced against the LAST SAVE, which is as old as your save interval.');
    }

    /**
     * What they have, and WHERE the figure came from: `{ have, source }` with `source` of `'live'`,
     * `'db'` or `null`, and `have === null` whenever nothing could answer.
     *
     * **The running game first, the save only as a fallback.** `finances()` reads `SCUM.db`, which
     * lags by the save interval — long enough for a player to send their money to a friend and rent
     * a vehicle against a balance that no longer exists. `host.players.live()` asks the game and
     * falls back on its own, which is the only correct order: the save is never MORE current.
     *
     * A live answer can still be silent about money, because the bridge's `money` group is off by
     * default and the key is then simply ABSENT. Absent is not zero — reading it as zero would tell
     * every player on a default install they are broke — so this drops through to the save and says
     * `'db'` rather than dressing a saved figure up as a live one.
     */
    async function balanceOf(steamId, currency) {
      let p = null;
      try { p = await host.players.live(steamId); } catch (e) { p = null; }
      if (p && p.source === 'live') {
        const v = currency === 'gold' ? finite(p.gold) : finite(p.money);
        if (v != null) return { have: v, source: 'live', cash: null };
        warnLiveOff();
      } else if (p && p.source === 'db') {
        const v = currency === 'gold' ? finite(p.gold) : finite(p.bank);
        return { have: v, source: v == null ? null : 'db', cash: finite(p.cash) };
      }
      const fin = host.players.finances(steamId) || {};
      const v = currency === 'gold' ? finite(fin.gold) : finite(fin.bank);
      return { have: v, source: v == null ? null : 'db', cash: finite(fin.cash) };
    }

    /**
     * Can they pay? `null` lets the rental through; a string is the refusal the player sees.
     *
     * The price comes out of the pool named by `poolWord` and that is the pool checked here — a
     * check against anything else would refuse a rich player or approve a broke one.
     *
     * `have === null` means nothing could answer — an unknown profile, a failed read, the bridge and
     * the database both silent. That is ABSENT, not a balance of nothing: treating it as zero once
     * told a solvent player they were broke, so not knowing lets the charge decide instead.
     *
     * A SAVED figure that is short still refuses, and says so. The charge is a delta
     * (`#ChangeCurrencyBalance`), so a stale reading can never make this take the wrong AMOUNT — it
     * can only open or close the gate wrongly, and those two mistakes do not cost the same. Letting
     * a stale-poor player through spawns the vehicle and drives the bank account negative, which the
     * game permits; refusing a stale-rich one costs a retry after the next save. So it refuses, and
     * the message names the figure it used so nobody has to guess which it was.
     */
    async function affordError(steamId, o, c) {
      if (c.free) return null;
      const need = Math.max(0, parseInt(o.amount, 10) || 0);
      const unit = o.currency === 'gold' ? 'gold' : 'money';
      const bal = await balanceOf(steamId, o.currency);
      if (bal.have == null) return null;
      if (bal.have >= need) return null;
      let msg = '💸 Not enough ' + unit + ' — this rental costs ' + need + ' ' + unit + ', your ' + poolWord(o.currency) + ' has ' + bal.have + '.';
      if (bal.source === 'db') msg += ' (That is your balance as of the last server save — if you have just been paid, try again shortly.)';
      // The one piece of advice that actually fixes it, and only when it would. `cash` is
      // `user_profile.money_balance`, which this build of the game leaves NULL for every profile —
      // so in practice this never fires. It is kept rather than deleted because it costs nothing and
      // is correct the day the column starts carrying a figure again.
      const cash = bal.cash || 0;
      if (o.currency !== 'gold' && cash > 0 && (bal.have + cash) >= need) msg += ' You are carrying ' + cash + ' — deposit it at a bank and try again.';
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
      // Without the database there are no limits, no expiry and no removal — every rental would be
      // permanent and uncapped, while still charging. Refusing is the only honest answer; the log
      // says why so an owner can fix it rather than wonder where the vehicles came from.
      if (!db) {
        host.logger.error('rental refused: the plugin has no database, so limits and expiry cannot work');
        return { ok: false, error: '🛠️ Rentals are temporarily unavailable (storage problem). Please tell an admin.' };
      }
      const v = c.vehicles[Number(vehIdx)];
      const o = v && (v.options || [])[Number(optIdx)];
      if (c.enabled === false) return { ok: false, error: txt(c, 'disabled') };
      if (!v || !o) return { ok: false, error: 'Invalid selection.' };
      if (!v.code) return { ok: false, error: '🛠️ This vehicle isn’t fully set up yet (missing spawn code). Please tell an admin.' };
      // A NEGATIVE duration puts the expiry in the past: the player is charged and the very next
      // sweep destroys the vehicle. Refusing is the only answer that does not cost someone money.
      //
      // Zero, blank and nonsense are deliberately NOT refused. `parseInt(…) || 60` has always turned
      // those into an hour, so an owner who typed 0 has been selling working hour-long rentals for as
      // long as this plugin has existed — breaking that would be a change made at their players'
      // expense to tidy up a value that works. The panel warns about them instead, where fixing one
      // costs nothing.
      if (parseInt(o.minutes, 10) < 0) {
        host.logger.warn(`rental refused: plan ${optIdx} on "${v.name || 'vehicle'}" has a NEGATIVE duration (${JSON.stringify(o.minutes)}), which would expire the moment it is paid for`);
        return { ok: false, error: '🛠️ That rental plan isn’t set up correctly (its duration is negative). Please tell an admin.' };
      }

      // Before the limits, because "you already have one" is the wrong complaint to hand somebody
      // whose real problem is that the shop is shut.
      const winErr = windowError(c, v, o);
      if (winErr) return { ok: false, error: winErr };

      const limErr = limitsError(who.steamId, vehIdx, v, c);
      if (limErr) return { ok: false, error: limErr };
      if (c.requireOnline && isOnline(who.steamId) === false) return { ok: false, error: '🔌 You must be online in-game to rent a vehicle.' };

      // need a valid in-game position — never spawn a phantom vehicle at 0,0,0
      const loc = playerLoc(who.steamId);
      if (!loc || (!loc.x && !loc.y && !loc.z)) return { ok: false, error: '📍 I couldn’t find you in-game. Get online and fully spawned in, then try again.' };
      const sec = await sectorAllowed(loc);
      if (!sec.ok) return { ok: false, error: fill(txt(c, 'notAllowedHere'), vars(c, { sector: sec.sector })) };

      // Asks the RUNNING GAME for the balance, not the last save (see `affordError`). This used to
      // read `SCUM.db` only, so for as long as the save interval a player who had just been paid was
      // refused and one who had just spent it all was let through.
      const affErr = await affordError(who.steamId, o, c);
      if (affErr) return { ok: false, error: affErr };

      // What was already parked here, so the vehicle we are about to spawn can be told apart from
      // the player's own. Taken BEFORE the spawn — after it, the two are indistinguishable.
      const before = vehicleIdSet();

      // spawn FIRST and verify it worked; only charge on success, so an offline/failed bridge never bills the player
      // offset ~3m to the side so the vehicle doesn't spawn on the renter's head (crushing them)
      const spawnRes = await host.server.command(fill(c.spawnCmd, { code: v.code || '', x: loc.x + 300, y: loc.y, z: loc.z, steamid: who.steamId }));
      if (!ran(spawnRes)) {
        // Three different failures, and the player should not have to tell them apart.
        //
        // The third one is new since SSA Bridge 2.0.0 and is the reason this is not `ok === false`:
        // with `allowNoExecutor` on and nobody in the world, the bridge dispatches the spawn through
        // the game's static entry point, gets nothing back, and reports `ok` with
        // `confirmed: false`. Charging on that is charging for a vehicle nobody can say exists —
        // and this plugin's whole promise is that the spawn is verified before the money moves.
        const unconfirmed = !!(spawnRes && spawnRes.ok !== false && spawnRes.confirmed === false);
        if (unconfirmed) {
          host.logger.warn(`rental refused: the bridge dispatched the spawn with no executor (nobody in the world), so the game could not confirm the ${v.name || 'vehicle'} exists. Nobody was charged.`);
        }
        const reason = unconfirmed ? 'the server could not confirm the vehicle was spawned (is anyone online?)'
          : (spawnRes && /unavailable|offline|refused/i.test(String(spawnRes.error || ''))) ? 'the in-game bridge is offline'
            : 'the vehicle couldn’t be spawned';
        return { ok: false, error: '⚠️ Rental failed — ' + reason + '. You were not charged.' };
      }
      // A charge that silently fails hands out a free vehicle, so take the vehicle back rather than
      // leave the player with something they didn't pay for.
      const paid = await charge(who.steamId, o, 1);
      if (!paid) {
        // The payment failed, so take the vehicle back rather than leave the player with one they did
        // not pay for. This one CANNOT be deferred — it has to find the vehicle now to remove it.
        const orphan = await captureVehicleId({ x: loc.x + 300, y: loc.y, z: loc.z }, before);
        if (orphan && c.removeCmd) {
          // The removal can fail too, and it fails by RETURNING — so an empty catch here covered a
          // case that never happens while missing the one that does. Either way the player is left
          // with a vehicle they did not pay for, which is worth saying out loud: it is the one
          // outcome of this branch that needs a human.
          let removed = false;
          try {
            const r = await host.server.command(fill(c.removeCmd, { vehId: orphan, steamid: who.steamId }));
            removed = ran(r);
          } catch (e) { removed = false; }
          if (!removed) host.logger.warn(`rental: payment failed and the vehicle (${orphan}) could NOT be removed — ${who.playerName || who.steamId} has a ${v.name || 'vehicle'} they did not pay for`);
        } else if (!orphan) host.logger.warn('rental: payment failed and the spawned vehicle could not be found to remove — check for a stray ' + (v.name || 'vehicle'));
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
      player: '', vehicle: '', duration: '', price: '', left: '', sector: '', list: '', window: '',
    }, extra || {});

    // Sector rule. Async because map calibration is remote; null sector = unknown = allow.
    // Whether the map could name a sector the last time we asked. `null` = never asked yet, which
    // the panel reports as "unknown" rather than guessing either way.
    let sectorWorks = null;
    let lastSectorWarn = 0;
    async function sectorAllowed(loc) {
      const c = cfg();
      const allow = (c.allowedSectors || []).filter(Boolean).map(String);
      const block = (c.blockedSectors || []).filter(Boolean).map(String);
      if (!allow.length && !block.length) return { ok: true, sector: null };
      let sec = null;
      try { sec = host.map.sector ? await host.map.sector(loc.x, loc.y) : null; } catch (e) { sec = null; }
      if (!sec) {
        // No calibration → don't block on what we can't see. Refusing every rental because the map
        // is unreachable would be worse than letting them through.
        //
        // But it must not be SILENT. Map calibration is fetched remotely, so an outage turns every
        // sector rule off with nothing on screen and nothing in the log — an owner who blocked the
        // safe zone would find out from players renting inside it. Once an hour is enough to be
        // findable without burying the log, and the panel says the same thing where the rule is set.
        if (Date.now() - lastSectorWarn > 3600000) {
          lastSectorWarn = Date.now();
          host.logger.warn('sector restrictions are configured but the map could not say which sector the player is in, so they are NOT being applied. Map calibration comes from scumsa — check the manager can reach it.');
        }
        sectorWorks = false;
        return { ok: true, sector: null };
      }
      sectorWorks = true;
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
      // CLAIM THE ROW BEFORE DOING ANYTHING.
      //
      // Three separate money bugs came from closing it at the end instead: two `/return`s typed 50ms
      // apart both read `active=1`, both destroyed the vehicle and both paid the refund; the expiry
      // sweep and a player's Extend could act on the same rental at the same moment; and a rental
      // that had already expired could still be "returned" for a full refund because the sweep only
      // runs once a minute. `WHERE active=1` makes the close atomic — exactly one caller gets
      // `changes === 1`, and that one owns the vehicle, the refund and the message.
      if (db) {
        const claim = db.prepare('UPDATE rentals SET active=0, endedReason=? WHERE id=? AND active=1').run(reason || 'expired', r.id);
        if (!claim || claim.changes !== 1) return { removed: false, stillThere: true, alreadyClosed: true };
      }
      // A rental can end while its vehicle is still being identified — a player who rents and
      // immediately returns, or an admin ending one straight away. Wait for that answer instead of
      // treating "not known yet" as "there is nothing to remove".
      const vehId = await vehIdOf(r);
      const stillThere = c.verifyVehicle === false ? true : vehicleExists(vehId);
      let removed = false;
      if (vehId && c.removeCmd && stillThere) {
        try { const res = await host.server.command(fill(c.removeCmd, { vehId: vehId, steamid: r.steamId })); removed = ran(res); }
        catch (e) { removed = false; }
      }
      return { removed: removed, stillThere: stillThere };
    }

    // ── Discord flow ──
    host.discord.onInteraction(async function (i) {
      // `return somePromise()` inside a try does NOT put its rejection through the catch — the
      // function returns before the promise settles, so the rejection escapes as an unhandled one
      // and the catch below was unreachable for every branch. The player then got Discord's own
      // "This interaction failed" instead of the message written here, and the manager log got an
      // unattributed unhandled rejection. `await` is the whole fix.
      try {
        if (i.isButton && i.isButton()) {
          if (i.customId === OPEN) return await openVehicleMenu(i);
          if (i.customId.indexOf(EXT + ':') === 0) return await doExtend(i, i.customId.slice((EXT + ':').length));
        }
        if (i.isStringSelectMenu && i.isStringSelectMenu()) {
          if (i.customId === VEH) return await openDurationMenu(i, i.values[0]);
          if (i.customId.indexOf(OPT + ':') === 0) return await processRental(i, i.customId.slice((OPT + ':').length), i.values[0]);
        }
      } catch (e) { host.logger.error('interaction: ' + e.message); try { if (!i.replied && !i.deferred) await i.reply({ content: 'Something went wrong.', ...EPHEMERAL }); } catch (x) {} }
    });

    /**
     * A menu option carries WHAT it meant, not just where it sat.
     *
     * Every value in this flow was a bare list position. The menu is drawn from the admin's live
     * vehicle list, and that list is edited while players have menus open — the panel saves it, the
     * open menu keeps its old numbers. Delete the second vehicle while someone is choosing a plan
     * and their click rents the third one, at the third one's price, in the third one's currency,
     * and the confirmation names it correctly, so nothing about the outcome looks wrong except the
     * vehicle that appears next to them.
     *
     * The fingerprint is of the fields that decide what the player agreed to: what it spawns and
     * what it is called; how long and how much. An edit to any of those invalidates the open menu
     * instead of silently re-pointing it. Reordering alone still works, which is the common edit.
     */
    function sigOf(s) {
      let h = 5381; const str = String(s);
      for (let k = 0; k < str.length; k++) h = ((h * 33) ^ str.charCodeAt(k)) >>> 0;
      return h.toString(36);
    }
    const vehSig = (v) => sigOf((v && v.code) + '|' + (v && v.name));
    // `amount`, not `price` — there is no `price` field anywhere in this plugin, so this read
    // `undefined` every time and the signature collapsed to `minutes|undefined|currency`. The
    // comment above promises the fingerprint covers "how long and how much"; it covered how long.
    // An owner re-pricing a plan while a player had the menu open charged them the NEW price for the
    // plan they agreed to at the OLD one, with no stale warning — the exact thing this exists to
    // prevent, silently not doing it.
    const optSig = (o) => sigOf((o && o.minutes) + '|' + (o && o.amount) + '|' + (o && o.currency));
    const STALE = '🔄 The vehicle list changed while that menu was open, so nothing was rented and you were not charged. Open the rental menu again.';
    // "3.1f9x" → { idx: 3, sig: '1f9x' }
    function splitRef(raw) {
      const s = String(raw == null ? '' : raw);
      const dot = s.indexOf('.');
      return dot < 0 ? { idx: s, sig: '' } : { idx: s.slice(0, dot), sig: s.slice(dot + 1) };
    }

    async function openVehicleMenu(i) {
      const c = cfg();
      if (c.enabled === false) return i.reply({ content: fill(txt(c, 'disabled'), vars(c)), ...EPHEMERAL });
      if (!c.vehicles.length) return i.reply({ content: 'No vehicles are available right now.', ...EPHEMERAL });
      const B = host.discord.js;
      const menu = new B.StringSelectMenuBuilder().setCustomId(VEH).setPlaceholder('Choose a vehicle')
        // Out-of-hours vehicles stay in the menu with the reason in their description, for the same
        // reason the chat listing keeps them: a menu that changes shape through the evening teaches
        // players that things vanish, and the one question they have — when? — goes unanswered.
        .addOptions(c.vehicles.slice(0, 25).map(function (v, idx) {
          const shut = windowError(c, v, null);
          return {
            label: (v.name || ('Vehicle ' + idx)).slice(0, 100),
            value: (idx + '.' + vehSig(v)).slice(0, 100),
            description: (shut || ((v.options || []).length + ' plan(s)')).slice(0, 100),
          };
        }));
      return i.reply({ content: 'Pick a vehicle to rent:', components: [host.discord.row(menu)], ...EPHEMERAL });
    }
    async function openDurationMenu(i, vehRef) {
      const c = cfg(); const ref = splitRef(vehRef); const v = c.vehicles[Number(ref.idx)];
      if (!v || (ref.sig && vehSig(v) !== ref.sig)) return i.update({ content: STALE, components: [] });
      if (!(v.options || []).length) return i.update({ content: 'That vehicle has no rental plans.', components: [] });
      const B = host.discord.js;
      const menu = new B.StringSelectMenuBuilder().setCustomId((OPT + ':' + ref.idx + '.' + vehSig(v)).slice(0, 100)).setPlaceholder('Choose a plan')
        .addOptions(v.options.slice(0, 25).map(function (o, oi) {
          const shut = windowError(c, v, o);
          const opt = {
            label: (fmtDur(o.minutes) + ' — ' + (c.free ? 'Free' : money(o))).slice(0, 100),
            value: (oi + '.' + optSig(o)).slice(0, 100),
          };
          // The key is OMITTED rather than set to `undefined`. discord.js validates option objects at
          // the setter, and an explicitly-present key holding `undefined` is not the same input as an
          // absent one — the difference is a thrown error on the whole menu, for the plans that are
          // perfectly fine.
          if (shut) opt.description = shut.slice(0, 100);
          return opt;
        }));
      const shutNow = windowError(c, v, null);
      return i.update({ content: 'Renting **' + (v.name || 'vehicle') + '** — choose a plan:' + (shutNow ? '\n' + shutNow : ''), components: [host.discord.row(menu)] });
    }

    async function processRental(i, vehRef, optRef) {
      const prof = host.players.linked(i.user.id);
      if (!prof || !prof.steamId) return i.update({ content: '⚠️ Link your SCUM character to Discord first (on the Field Console), then try again.', components: [] });
      // Check BEFORE the "Processing…" edit and before any money moves: a stale menu is not a
      // failed rental, it is a rental that must not start.
      const c0 = cfg(); const vr = splitRef(vehRef); const or = splitRef(optRef);
      const v0 = c0.vehicles[Number(vr.idx)];
      const o0 = v0 && (v0.options || [])[Number(or.idx)];
      if (!v0 || !o0 || (vr.sig && vehSig(v0) !== vr.sig) || (or.sig && optSig(o0) !== or.sig)) {
        return i.update({ content: STALE, components: [] });
      }
      await i.update({ content: '⏳ Processing your rental…', components: [] });
      const res = await rent({ steamId: prof.steamId, discordId: i.user.id, playerName: prof.name || prof.discordUsername || '' }, vr.idx, or.idx);
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

      // ACKNOWLEDGE FIRST. Discord kills an unacknowledged interaction after THREE SECONDS, and
      // extending is slower than that on purpose: it can wait on a vehicle identification (up to
      // 20s), then charge through the bridge, then send an in-game line — and the bridge's own
      // timeout is 6s, double the window on its own.
      //
      // So the player clicked Extend, was charged, the rental WAS extended — and Discord told them
      // the interaction failed. They click again; the second click is refused by the in-flight lock
      // with a message they also never see. Deferring buys 15 minutes, which is longer than any of
      // that can take.
      try { await i.deferReply(EPHEMERAL); } catch (e) { /* already acknowledged */ }
      const out = await extendRental(r);
      const said = out.ok ? '🔄 Rental extended! New expiry: <t:' + Math.floor(out.exp / 1000) + ':R>' : out.error;
      try { return await i.editReply({ content: said }); }
      catch (e) {
        // The edit window is gone (or the defer never landed). The player is in game, which is where
        // the vehicle is — tell them there instead of silently swallowing the outcome of a payment.
        try { await say(r.steamId, said); } catch (x) { /* nothing left to try */ }
        return null;
      }
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
      // An extension is a fresh purchase at the same price, so it has to obey the same window. Without
      // this the happy hour has a hole you can drive through: rent at 20:30 for the cheap plan, then
      // top it up at that price all night. The rental itself is NOT cut short — what a player already
      // paid for runs to its end; they simply cannot buy more time while the window is shut.
      //
      // The window is read off the CONFIGURED plan, not off `planOf()`: the row carries the price it
      // was sold at (which is the point of `paidAmount`) and no windows at all, and a window is a
      // question about what may be bought NOW. Positions move, so this can name the wrong plan on a
      // list that has been reordered — and the cost of that is an extension refused or allowed a
      // little wrongly, never a wrong amount charged, because the amount still comes from the row.
      const extWinErr = windowError(c, v, v && (v.options || [])[Number(r.optIdx)]);
      if (extWinErr) return { ok: false, error: extWinErr };
      // Extending is the same transaction as renting — more time on a vehicle, more money — so the
      // "must be in-game" rule has to cover it. Checking it only on rent left the whole point of the
      // setting open: park the car, log out, and keep buying time from Discord indefinitely.
      //
      // RETURNING deliberately does NOT check this. Handing the vehicle back is how a player stops
      // paying, and refusing it while they are offline would trap them in a rental they are trying
      // to end — the opposite of what the setting is for.
      if (c.requireOnline && isOnline(r.steamId) === false) return { ok: false, error: '🔌 You must be online in-game to extend a rental.' };
      // `endRental` checks this before claiming to have removed something; extending has to check it
      // before taking money for more time on it. Someone else blowing the car up at minute 50 should
      // not cost the renter another full price at minute 55.
      const liveId = await vehIdOf(r);
      if (c.verifyVehicle !== false && liveId && !vehicleExists(liveId)) {
        return { ok: false, error: '💥 That vehicle is gone, so there is nothing to extend. Use the return command to close the rental.' };
      }
      const affErr = await affordError(r.steamId, o, c);
      if (affErr) return { ok: false, error: affErr.replace('this rental costs', 'extending costs') };
      // Same rule as renting: if the charge doesn't land, don't hand out the time.
      const paid = await charge(r.steamId, o, 1);
      if (!paid) return { ok: false, error: '⚠️ Payment failed — the rental was not extended.' };
      const exp = Math.max(Date.now(), r.expiresAt) + (parseInt(o.minutes, 10) || 60) * 60000;
      // `AND active=1`, and check it landed. Without it a player could click Extend on the reminder
      // DM at the exact moment the sweep expired the rental: they were charged, the row was already
      // closed, and the vehicle had just been destroyed. The charge has already happened by this
      // point, so a lost race is refunded rather than pocketed.
      const upd = db.prepare('UPDATE rentals SET expiresAt=?, reminded=0, extensions=extensions+1 WHERE id=? AND active=1').run(exp, r.id);
      if (!upd || upd.changes !== 1) {
        try { await charge(r.steamId, o, -1); } catch (e) { host.logger.warn(`rental #${r.id}: extension lost the race AND the refund failed — check ${r.playerName || r.steamId}`); }
        return { ok: false, error: '⌛ That rental ended while you were extending it. You have not been charged.' };
      }
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
          // A plan that is out of hours is LISTED and marked, not hidden. Hiding it makes a menu that
          // changes shape through the evening, and a player who was told about a cheap night plan
          // yesterday cannot find it or learn when it comes back.
          const lines = list.map(function (v, idx) {
            const plans = (v.options || []).map(function (o, oi) {
              return (oi + 1) + ') ' + fmtDur(o.minutes) + (c.free ? '' : ' ' + money(o)) + (windowOpen(c, v, o) ? '' : ' ⏳');
            }).join('  ');
            return (idx + 1) + '. ' + (v.name || 'Vehicle') + ' — ' + (plans || 'no plans') + (windowOpen(c, v, null) ? '' : ' ⏳');
          });
          const anyShut = list.some(function (v) { return !windowOpen(c, v, null) || (v.options || []).some(function (o) { return !windowOpen(c, v, o); }); });
          return ctx.reply(fill(txt(c, 'rentUsage'), vars(c, { list: fitLines(lines) + (anyShut ? '\n⏳ = not available right now; ask again for the times.' : '') })));
        }
        const v = list[n - 1];
        const opts = v.options || [];
        if (!Number.isFinite(p) || p < 1 || p > opts.length) {
          const plans = opts.map(function (o, oi) { return (oi + 1) + ') ' + fmtDur(o.minutes) + (c.free ? '' : ' ' + money(o)) + (windowOpen(c, v, o) ? '' : ' ⏳'); }).join('  ');
          // Asking about one vehicle is specific enough to be told the actual times rather than a
          // symbol — this is the reply that answers "well, when then?".
          const shut = windowError(c, v, null);
          return ctx.reply((v.name || 'Vehicle') + ' — pick a plan: ' + (plans || 'none configured') + (shut ? '\n' + shut : ''));
        }
        const prof = host.players.bySteamId(ctx.steamId);
        const res = await rent({ steamId: ctx.steamId, discordId: (prof && prof.discord_user_id) || (prof && prof.discordUserId) || '', playerName: ctx.name || (prof && prof.player_name) || '' }, String(n - 1), String(p - 1));
        if (!res.ok) return ctx.reply(res.error);
        // The confirmation normally arrives through say(). With "Send messages in-game" switched OFF
        // that never fires, and this reply used to stay silent too — so the player was charged and
        // told nothing at all, and typed the command again. A command always answers.
        if (c.inGameNotify === false) {
          return ctx.reply(fill(txt(c, 'confirmed'), vars(c, { player: ctx.name || '', vehicle: (res.v && res.v.name) || 'vehicle', duration: res.o ? fmtDur(res.o.minutes) : '', price: (c.free || !res.o) ? 'Free' : money(res.o) })));
        }
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
        // Same as /rent: with in-game messages off, extendRental's say() is silent, so this is the
        // only thing that can tell the player their money bought more time.
        if (c.inGameNotify === false) {
          return ctx.reply(fill(txt(c, 'extendOk'), rentalVars(rows[0], c, { duration: out.o ? fmtDur(out.o.minutes) : '' })));
        }
      }));

      cmdOffs.push(host.chat.onCommand(c0.cmdReturn || 'return', async function (ctx) {
        const c = cfg();
        if (c.allowReturn === false) return ctx.reply('Returning early is turned off.');
        const rows = activeFor(ctx.steamId);
        if (!rows.length) return ctx.reply(fill(txt(c, 'noRentals'), vars(c)));
        const r = rows[0];
        // An expired rental is not returnable. The sweep runs once a minute, so between expiry and
        // the next tick a player could hand back a rental that had already run out and collect the
        // full early-return refund — every single time, and for the whole backlog after a restart.
        if (r.expiresAt && r.expiresAt <= Date.now()) {
          return ctx.reply('⌛ That rental has already run out — there is nothing to return.');
        }
        const out = await endRental(r, 'returned');
        if (out.alreadyClosed) return ctx.reply('⌛ That rental was just closed. Nothing to return.');
        // Refund only what was actually given back: no vehicle to reclaim, no refund.
        const pct = Math.max(0, Math.min(100, Number(c.refundPercent) || 0));
        let refundNote = '';
        // `out.removed` is NOT the test. A bridge that drops between the spawn and the return leaves
        // the vehicle standing and `removed` false — and the old rule then skipped the refund
        // entirely, closed the rental, and replied "Thanks!". The player handed the rental back; the
        // server failing to collect it is not their fault. What matters is that the rental is closed,
        // which by this point it is.
        if (pct && !out.stillThere) refundNote = ' (the vehicle was already gone)';
        if (pct) {
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
        if (!out.removed && out.stillThere) {
          refundNote += ' (heads up: the vehicle could not be removed — tell an admin)';
          host.logger.warn(`rental #${r.id}: returned but the vehicle could not be removed — it is still in the world untracked`);
        }
        return ctx.reply(fill(txt(c, 'returned'), rentalVars(r, c)) + refundNote);
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
      // `finally` alone let a throw escape the callback as an unhandled rejection — which on some
      // Node versions takes the whole manager down. The sweep is best-effort by nature.
      try { await sweep(); }
      catch (e) { host.logger.warn('rental sweep failed this tick: ' + e.message); }
      finally { sweeping = false; }
    });
    async function sweep() {
      if (!db) return;
      const c = cfg(), now = Date.now();
      const B = host.discord.js;
      const perVehRems = (c.vehicles || []).map((v) => (v && v.reminderMinutes != null && v.reminderMinutes !== '') ? Number(v.reminderMinutes) : 0).filter((x) => x > 0);
      const maxRem = Math.max.apply(null, [(c.reminderMinutes != null && c.reminderMinutes !== '' ? Number(c.reminderMinutes) : 10)].concat(perVehRems));
      const soon = db.prepare('SELECT * FROM rentals WHERE active=1 AND reminded=0 AND (expiresAt - ?) <= ?').all(now, maxRem * 60000);
      for (const r of soon) {
        const rv = c.vehicles[Number(r.vehIdx)];
        const effRem = (rv && rv.reminderMinutes != null && rv.reminderMinutes !== '') ? Number(rv.reminderMinutes) : (c.reminderMinutes != null && c.reminderMinutes !== '' ? Number(c.reminderMinutes) : 10);
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
        // The Discord embed already says only "expired" when the vehicle could not be removed; the
        // in-game line claimed it was removed either way.
        await say(r.steamId, fill(txt(c, 'ended'), rentalVars(r, c))
          + (out.removed ? '' : ' (it could not be removed — tell an admin if it is still there)'));
      }
    }

    /**
     * Rentals whose vehicle was never identified, reported once at startup.
     *
     * Identification is a before/after diff of the world, and the "before" set lives only in memory
     * while it runs. A manager restart inside that window — a scheduled restart, a crash, an update —
     * takes the pending capture with it, and the row keeps `vehId=''` for ever: the vehicle is never
     * removed at expiry, the player keeps it, and the warning that would have said so died with the
     * process. Nothing ever mentioned it again.
     *
     * The id cannot be recovered afterwards. Guessing at "the nearest vehicle" is exactly the rule
     * this plugin refuses everywhere else, because it is usually the player's own car. So this does
     * the one honest thing left: it says which rentals are in that state, once, where an admin will
     * see it — the panel already marks them "not captured", but only if someone opens it.
     */
    if (db) {
      try {
        const orphans = db.prepare("SELECT id, playerName, steamId, vehName FROM rentals WHERE active=1 AND (vehId IS NULL OR vehId='')").all();
        if (orphans.length) {
          const who = orphans.map((r) => '#' + r.id + ' ' + (r.vehName || 'vehicle') + ' (' + (r.playerName || r.steamId) + ')').join(', ');
          host.logger.warn(`${orphans.length} active rental(s) have no identified vehicle, so those vehicles will NOT be removed when they expire: ${who}. This happens when the manager restarts in the ~20s after a spawn. End them from the panel and remove the vehicle by hand if it is still there.`);
          try {
            host.notify('admin.alert', {
              message: `Vehicle rental: ${orphans.length} active rental(s) have no identified vehicle and will not be cleaned up automatically. See the manager log for which.`,
              severity: 'warning',
            });
          } catch (e) { /* notifications are optional */ }
        }
      } catch (e) { host.logger.warn('could not check for rentals with no identified vehicle: ' + e.message); }
    }

    host.logger.info('Vehicle Rental System ready');
  },
};
