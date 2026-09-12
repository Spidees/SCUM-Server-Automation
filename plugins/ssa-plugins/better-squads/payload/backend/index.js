'use strict';

/**
 * Better Squads — a squad layer for in-game chat.
 *
 * Two halves that share one idea: a squad should know what is happening to its own people, and be
 * able to ask, without anyone else on the server hearing a word of it.
 *
 *   NOTIFICATIONS — connect / disconnect / killed / died / got a kill / base raided, plus squad
 *   roster changes. Every line is a template with live tokens, and tokens that are RELATIVE to the
 *   reader ({distance}, {direction}) are rendered per recipient, so each player is told how far the
 *   event is from where THEY are standing.
 *
 *   COMMANDS — players run the whole thing from chat: see the roster with sectors and distances,
 *   call a rally, message the squad, find their base, and silence any part of it for themselves
 *   without an admin touching anything.
 *
 * Everything is delivered through the SSA Bridge, addressed to individual recipients — that
 * targeting is what makes "squad-only" real rather than cosmetic.
 */

const DEFAULTS = {
  enabled: true,
  channel: 'squad',
  includeSelf: false,
  cooldownSeconds: 3,
  maxIndividualSends: 12,
  maxPerMinute: 300,
  quietHours: { enabled: false, from: 2, to: 8 },
  mutedSteamIds: [],
  rosterPollSeconds: 60,
  events: {
    join:       { enabled: true,  message: '{player} just connected.' },
    leave:      { enabled: true,  message: '{player} went offline.' },
    death:      { enabled: true,  message: '{player} was killed by {killer}[ in {sector}] — {weapon}[, {shotdistance} m].[ {distance} m {direction} of you.]' },
    suicide:    { enabled: true,  message: '{player} died[ in {sector}].' },
    kill:       { enabled: false, message: '{player} killed {victim}[ in {sector}] — {weapon}[, {shotdistance} m].' },
    raid:       { enabled: true,  message: 'Base under attack — {object}.[ {sector}.][ {distance} m {direction} of you.]' },
    squadJoin:  { enabled: true,  message: '{player} joined the squad.' },
    squadLeave: { enabled: true,  message: '{player} left the squad.' },
  },
  commands: {
    enabled: true,
    root: 'squad',
    subs: {
      help:  { enabled: true, name: 'help' },
      off:   { enabled: true, name: 'off' },
      on:    { enabled: true, name: 'on' },
      mute:  { enabled: true, name: 'mute' },
      here:  { enabled: true, name: 'here' },
      msg:   { enabled: true, name: 'msg' },
      base:  { enabled: true, name: 'base' },
      info:  { enabled: true, name: 'info' },
    },
    texts: {
      rosterHeader: '{squad} — {squadonline}/{squadsize} online',
      rosterLine:   '  {player}[ — {sector}][, {distance} m {direction}]',
      rosterEmpty:  'Nobody else from {squad} is online.',
      notInSquad:   'You are not in a squad.',
      help:         'Squad commands: {list}',
      mutedOn:      'Squad alerts are OFF for you. Use {root} {on} to turn them back on.',
      mutedOff:     'Squad alerts are ON for you.',
      muteUsage:    'Use: {root} {mute} <{events}|all|none>. Currently muted: {muted}',
      muteSet:      'Muted: {muted}',
      here:         '{player} is[ at {sector}] — rally up.',
      hereOk:       'Told the squad where you are.',
      msgUsage:     'Use: {root} {msg} <your message>',
      msgLine:      '{player}: {text}',
      msgOk:        'Sent to {count} squadmate(s).',
      base:         'Your base is[ in {sector}][, {distance} m {direction} away].',
      baseNone:     'No squad base found on the map.',
      info:         '{squad} — {squadonline}/{squadsize} online, score {score}.',
      infoMotd:     'MOTD: {motd}',
      nobodyOnline: 'Nobody else from the squad is online.',
    },
  },
};

// Channels the client reliably renders for an individually-targeted recipient. ServerMessage and
// CommandsOnly do not, so a line sent there would silently vanish — clamp to a safe one.
const TARGET_OK = { local: 1, global: 1, squad: 1, admin: 1 };
const EVENT_KEYS = Object.keys(DEFAULTS.events);
const SUB_KEYS = Object.keys(DEFAULTS.commands.subs);
// Tokens whose value depends on WHO is reading the line — their presence forces per-recipient
// rendering (and therefore one send per player instead of one send for the whole squad).
const RELATIVE_TOKENS = /\{(distance|direction)\}/i;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

module.exports = {
  async register(host) {
    const offs = [];
    const clear = () => { while (offs.length) { try { offs.pop()(); } catch { /* ignore */ } } };

    function cfg() {
      const c = host.config.get() || {};
      const events = {};
      for (const k of EVENT_KEYS) events[k] = Object.assign({}, DEFAULTS.events[k], (c.events || {})[k]);
      const cc = c.commands || {};
      const subs = {};
      for (const k of SUB_KEYS) subs[k] = Object.assign({}, DEFAULTS.commands.subs[k], (cc.subs || {})[k]);
      return Object.assign({}, DEFAULTS, c, {
        events,
        quietHours: Object.assign({}, DEFAULTS.quietHours, c.quietHours),
        commands: Object.assign({}, DEFAULTS.commands, cc, {
          subs,
          texts: Object.assign({}, DEFAULTS.commands.texts, cc.texts),
        }),
      });
    }

    const sidOf = (pl) => String((pl && (pl.SteamID || pl.steamId || pl.steamid || pl.steam_id || pl.user_id)) || '');
    const nmOf = (pl) => (pl && (pl.PlayerName || pl.name || pl.playerName)) || '';
    const safeChannel = (ch) => (ch && TARGET_OK[ch] ? ch : 'squad');

    // ── persisted state ──────────────────────────────────────────────────────
    // `failed` counts alerts that reached NOBODY. It is listed here rather than only being created
    // on the first failure, so the panel can show a real 0 instead of a blank.
    let stats = Object.assign({ sent: 0, suppressed: 0, commands: 0, failed: 0 }, host.store.get('stats') || {});
    let recent = host.store.get('recent') || [];
    // Per-player preferences set BY THE PLAYER in game: { steamId: { off, muted: {event:true} } }.
    // Kept separate from the admin's mute list so neither side silently overwrites the other.
    let prefs = host.store.get('prefs') || {};
    // Debounced: a busy fight fires many messages a second and each one used to write the store.
    // Coalesce into at most one write per second; flushNow() covers unload so nothing is lost.
    let persistTimer = null;
    const flushNow = () => {
      if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
      try { host.store.set('stats', stats); host.store.set('recent', recent.slice(0, 60)); host.store.set('prefs', prefs); } catch { /* ignore */ }
    };
    const persist = () => { if (!persistTimer) persistTimer = setTimeout(flushNow, 1000); };
    function note(kind, actor, text, recipients) {
      recent.unshift({ at: Date.now(), kind, actor, text, recipients });
      if (recent.length > 60) recent.length = 60;
      persist();
    }
    // Read without creating: this is called for every candidate recipient of every message, and an
    // auto-vivifying getter would quietly persist an empty record for every player who ever played.
    const EMPTY_PREF = Object.freeze({ off: false, muted: Object.freeze({}) });
    const prefOf = (sid) => prefs[String(sid)] || EMPTY_PREF;
    const prefFor = (sid) => prefs[String(sid)] || (prefs[String(sid)] = { off: false, muted: {} });

    // ── squad lookup ─────────────────────────────────────────────────────────
    // host.players.squad() deliberately withholds Steam IDs (it's a player-facing view), but
    // targeting chat needs them — so read membership straight from the game DB.
    //
    // Both halves start FROM user_profile on purpose: excludeDeleted() rewrites exactly that, so
    // written this way the "dead character" filter actually applies. Behind a JOIN it would be a
    // silent no-op and squads would keep listing deleted profiles.
    const SQUAD_SQL = host.db.scum.excludeDeleted(`
      SELECT u.user_id AS steamId, u.name AS name, sm.rank AS rank, s.name AS squadName, s.id AS squadId
      FROM user_profile u
      JOIN squad_member sm ON sm.user_profile_id = u.id
      JOIN squad s ON s.id = sm.squad_id
      WHERE sm.squad_id = (
        SELECT sm2.squad_id
        FROM user_profile u2
        JOIN squad_member sm2 ON sm2.user_profile_id = u2.id
        WHERE u2.user_id = ? LIMIT 1
      )`);

    // The bridge cannot name a player who has already disconnected — its leave event carries an
    // EMPTY name, because the controller it would read is gone. Falling back to the Steam ID put a
    // 17-digit number in front of the whole squad, so names are resolved against the database
    // instead, which still knows them long after they log off.
    const NAME_SQL = host.db.scum.excludeDeleted('SELECT name AS name FROM user_profile WHERE user_id = ? LIMIT 1');
    const nameCache = new Map();   // steamId -> { at, name }
    const looksLikeSteamId = (v) => /^\d{15,20}$/.test(String(v || '').trim());
    function nameFromDb(steamId) {
      const key = String(steamId || '');
      if (!key) return '';
      const hit = nameCache.get(key);
      if (hit && Date.now() - hit.at < 300000) return hit.name;
      const row = host.db.scum.get(NAME_SQL, key);
      const name = (row && row.name) || '';
      nameCache.set(key, { at: Date.now(), name });
      return name;
    }
    // given -> still online -> database. Never a raw Steam ID.
    function displayName(steamId, given) {
      const g = String(given || '').trim();
      if (g && !looksLikeSteamId(g)) return g;
      const on = onlineIndex().get(String(steamId));
      if (on && !looksLikeSteamId(on)) return on;
      return nameFromDb(steamId);
    }
    /**
     * The same, for a name that might not belong to a PLAYER at all.
     *
     * `displayName` hands back anything that is not a Steam ID untouched, which is right for a join,
     * a leave or a squad roster — every one of those is a person. A kill event is the exception: its
     * killer and its victim are a player's name OR a spawn class carrying its runtime instance
     * number (`BP_Guard_Lvl_5_C_2146943462`, `BP_Bear_C_2147201044`). Those went out to the squad
     * exactly like that, so being killed by a puppet read as a line of code — while the manager's
     * own kill feed, reading the same event, said "Guard (Lvl 5)".
     *
     * `items.actorName()` is the one rule that tells a player's name from a class; `items.name()`
     * answers about an ITEM code and is the wrong question for both. Kept separate from
     * `displayName` on purpose: a squad roster must never be run through a class-name rule, because
     * a player is free to call themselves something that looks like one.
     *
     * Guarded — the manifest's floor is manager 4.0.3 and this arrived in 5.2, so an older host has
     * no such method and the value stays exactly what it was.
     */
    function actorDisplayName(steamId, given) {
      const g = String(given || '').trim();
      if (g && !looksLikeSteamId(g)) {
        try {
          if (host.items && typeof host.items.actorName === 'function') return host.items.actorName(g) || g;
        } catch (e) { /* a resolver that threw must not lose the name */ }
        return g;
      }
      return displayName(steamId, given);
    }

    const squadCache = new Map();   // steamId -> { at, squad }
    function squadOf(steamId, fresh) {
      const key = String(steamId || '');
      if (!key) return null;
      const hit = squadCache.get(key);
      if (!fresh && hit && Date.now() - hit.at < 20000) return hit.squad;
      const rows = host.db.scum.all(SQUAD_SQL, key) || [];
      const squad = rows.length
        ? { id: rows[0].squadId, name: rows[0].squadName || 'your squad', members: rows.map((r) => ({ steamId: String(r.steamId), name: r.name })) }
        : null;
      squadCache.set(key, { at: Date.now(), squad });
      return squad;
    }

    function onlineIndex() {
      const byId = new Map();
      try { (host.players.online() || []).forEach((p) => { const s = sidOf(p); if (s) byId.set(s, nmOf(p)); }); } catch { /* server offline */ }
      return byId;
    }

    // ── the running game, where the last save is not good enough ─────────────
    //
    // Everything above reads SCUM.db, which is the state as of the last SAVE. Two of the things this
    // plugin puts in front of a player are simply wrong while that lags:
    //
    //   WHERE a squadmate is. {distance} and {direction} tell somebody which way to walk, and the
    //   roster sorts by it — a saved position can predate the fight they are being told about.
    //
    //   WHO is in the squad. Membership decides who receives a line nobody outside the squad is meant
    //   to hear. A player who joined since the save gets nothing; one who left keeps hearing it.
    //
    // Both are asked of the running game, per event, and fall back to the database when it cannot
    // answer — naming the switch an owner has to find. Neither adds a timer: the live read is
    // memoised for two seconds, the same window the position index already used, so one event costs
    // one read however many recipients it has.
    //
    // Identity stays in the database and has to: no reply from the bridge carries a Steam ID, and the
    // squads module says none ever will. A profile id never changes hands, so that join is identity
    // rather than state and the save is the right place for it.
    const liveNote = { players: null, squads: null };
    const liveSaid = { players: 0, squads: 0 };
    const LIVE_SWITCH = {
      players: "Read live player data, with Position, facing and speed (Settings → Bridge → Live data)",
      squads: "Report live squads, with Include the member list (Settings → Bridge → Squads)",
    };
    function noteLive(key, q) {
      const code = (q && q.code) || 'bridge_off';
      let text;
      if (code === 'refused') text = (q && q.reason) || null;
      else if (code === 'module_off') text = `the in-game module is switched off — turn on '${LIVE_SWITCH[key]}'`;
      else if (code === 'no_module') text = 'this server runs an older SSA Bridge that does not have this module';
      else text = 'the SSA Bridge did not answer';
      liveNote[key] = { code, text, at: Date.now() };
      // `bridge_off` is the ordinary state and deserves silence; the rest are one switch or one
      // update away. Said once an hour, because this sits on the path of every squad message.
      if (code === 'bridge_off' || !text) return;
      if (Date.now() - liveSaid[key] < 3600000) return;
      liveSaid[key] = Date.now();
      host.logger.warn(`the live ${key === 'players' ? 'position' : 'squad'} read could not run: ${text}. Better Squads carries on with the last save, which is what it did before this existed.`);
    }
    const canQuery = () => !!(host.bridge && typeof host.bridge.query === 'function');

    let liveMemo = null, liveMemoAt = 0;
    /** Every online player as the game has them this instant: `{ pos, names }`, or null. */
    async function liveSnapshot() {
      if (liveMemoAt && Date.now() - liveMemoAt < 2000) return liveMemo;
      liveMemoAt = Date.now();
      liveMemo = null;
      if (!canQuery()) return null;
      const q = await host.bridge.query('live', 'players');
      if (!q || !q.ok) { noteLive('players', q); return null; }
      const list = (q.data && Array.isArray(q.data.players)) ? q.data.players : null;
      if (!list) return null;
      liveNote.players = null;
      const pos = new Map(); const names = new Map();
      for (const p of list) {
        // The live payload spells it `steamid`, all lower case — that is the game's own wire key, not
        // the manager's `steamId`. Both are read so this keeps working whichever a bridge sends.
        const sid = String((p && (p.steamid || p.steamId)) || '');
        if (!sid) continue;
        if (p.name) names.set(sid, String(p.name));
        // Position rides on its own owner switch. ABSENT means the game did not send it — never
        // 0,0,0, which is a real place on this map, in the sea.
        if (Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))) pos.set(sid, { x: Number(p.x), y: Number(p.y), z: Number(p.z) });
      }
      liveMemo = { pos, names };
      return liveMemo;
    }

    /**
     * Positions, live where the game could answer and saved where it could not — merged PER PLAYER,
     * not all-or-nothing. Somebody the game has no pawn for (a loading screen) keeps their saved
     * position rather than losing the distance token altogether.
     */
    async function positions() {
      const saved = positionIndex(worldSnapshot());
      const live = await liveSnapshot();
      if (!live || !live.pos.size) return saved;
      const out = new Map(saved);
      for (const [sid, p] of live.pos) out.set(sid, p);
      return out;
    }

    const PROFILE_ID_SQL = host.db.scum.excludeDeleted('SELECT id AS profileId FROM user_profile WHERE user_id = ? LIMIT 1');
    const PROFILE_ROW_SQL = host.db.scum.excludeDeleted('SELECT user_id AS steamId, name AS name FROM user_profile WHERE id = ? LIMIT 1');
    const profileIdCache = new Map();   // steamId -> profile id | null
    const profileRowCache = new Map();  // profile id -> { steamId, name } | null
    function profileIdOf(steamId) {
      const key = String(steamId || '');
      if (!key) return null;
      if (profileIdCache.has(key)) return profileIdCache.get(key);
      let id = null;
      try { const r = host.db.scum.get(PROFILE_ID_SQL, key); id = (r && r.profileId != null) ? Number(r.profileId) : null; }
      catch { return null; }             // a query that failed is not an answer worth caching
      profileIdCache.set(key, id);
      return id;
    }
    function profileRow(profileId) {
      const key = Number(profileId);
      if (!Number.isFinite(key) || key <= 0) return null;
      if (profileRowCache.has(key)) return profileRowCache.get(key);
      let row = null;
      try { const r = host.db.scum.get(PROFILE_ROW_SQL, key); row = (r && r.steamId) ? { steamId: String(r.steamId), name: r.name || '' } : null; }
      catch { return null; }
      profileRowCache.set(key, row);
      return row;
    }

    /**
     * The squad as the GAME holds it, or `undefined` when it could not say.
     *
     * `undefined` and not `null`, because "the game has no squad for this profile" is an answer this
     * deliberately does NOT act on: the module's own wording is "not in any loaded squad", and a
     * squad can be unloaded. Trusting that would silence a real squad, which is worse than the
     * staleness it would fix. So this only ever returns a POSITIVE roster — which is enough, because
     * it is asked about the player the event is about, and their roster is what decides recipients.
     * A member who has left is not in it; one who has just joined is.
     *
     * A roster that could only be half resolved also answers `undefined`. Dropping the members whose
     * profile ids did not resolve would silently drop recipients, which is the exact failure this
     * path exists to prevent.
     */
    async function squadLive(steamId) {
      if (!canQuery()) return undefined;
      const pid = profileIdOf(steamId);
      if (!pid) return undefined;
      const q = await host.bridge.query('squads', `member:${pid}`);
      if (!q || !q.ok) {
        // A solo player is a real answer and not a fault, so it is not worth a note on the panel.
        if (!(q && q.code === 'refused' && /not in any/i.test(String(q.reason || '')))) noteLive('squads', q);
        return undefined;
      }
      // The roster rides on the module's own "Include the member list" switch, which is what carries
      // the profile ids. Counts alone cannot name a recipient.
      const members = (q.data && Array.isArray(q.data.members)) ? q.data.members : null;
      if (!members || !members.length) { noteLive('squads', { code: 'module_off' }); return undefined; }
      liveNote.squads = null;
      const out = [];
      for (const m of members) {
        const row = profileRow(Number(m && m.profileId));
        if (!row) return undefined;      // incomplete → the database has all of them, use that
        out.push({ steamId: row.steamId, name: row.name });
      }
      return { id: q.data.id != null ? q.data.id : null, name: q.data.name || 'your squad', members: out, source: 'live' };
    }

    /** Live membership where the game will say, the database where it will not. */
    async function squadFor(steamId, fresh) {
      const live = await squadLive(steamId);
      return live !== undefined ? live : squadOf(steamId, fresh);
    }

    function worldSnapshot() {
      try { return host.map.world() || {}; } catch { return {}; }
    }
    // One kill event asks for positions three times (victim, killer, then again inside announce).
    // host.map.world() is memoised upstream, but rebuilding the index each time is pure waste.
    let posCache = null, posCacheAt = 0;
    function positionIndex(world) {
      if (posCache && Date.now() - posCacheAt < 2000) return posCache;
      const byId = new Map();
      ((world || {}).players || []).forEach((p) => {
        const s = String(p.steamId || '');
        if (s) byId.set(s, { x: Number(p.x), y: Number(p.y), z: Number(p.z) });
      });
      posCache = byId; posCacheAt = Date.now();
      return byId;
    }

    // ── geography ────────────────────────────────────────────────────────────
    // Calibration comes from the host (maps.json → map_meta) and is what the panel's live map uses.
    // We cache it here because it is asked for on every message; when the host has none we return
    // null and the geography tokens render empty rather than pointing somewhere invented.
    let calib = null, calibAt = 0;
    async function calibration() {
      if (calib && Date.now() - calibAt < 300000) return calib;
      if (!host.map || typeof host.map.calibration !== 'function') return null;   // older manager
      try {
        const meta = await host.map.calibration();
        calib = (meta && meta.world && typeof meta.world.minX === 'number') ? meta.world : null;
        calibAt = Date.now();
      } catch { calib = null; }
      return calib;
    }
    async function sectorOf(x, y) {
      if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return '';
      if (host.map && typeof host.map.sector === 'function') {
        try { return (await host.map.sector(x, y)) || ''; } catch { return ''; }
      }
      return '';
    }
    // Bearing as the player READS IT ON THE MAP: up = the top of the map, not a guess about which
    // world axis is north. Computed in map-percent space so it always matches what they're looking at.
    async function bearing(from, to) {
      const w = await calibration();
      if (!w || !from || !to) return '';
      if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) return '';
      const pctX = (v) => ((v - w.minX) / (w.maxX - w.minX));
      const pctY = (v) => ((v - w.minY) / (w.maxY - w.minY));
      const dx = pctX(to.x) - pctX(from.x);
      const dy = pctY(to.y) - pctY(from.y);
      if (!dx && !dy) return '';
      const deg = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
      return COMPASS[Math.round(deg / 45) % 8];
    }
    const metres = (a, b) => {
      if (!a || !b) return null;
      // A map row can carry a null/undefined coordinate, and Number(undefined) is NaN — which would
      // render as the literal "NaN" in a player's chat. Refuse rather than print nonsense.
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return null;
      return Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 100);
    };

    // ── templating ───────────────────────────────────────────────────────────
    // Two problems with templates: a token can have no value, and the words around it then read as
    // debris ("killed in — AK", "m of you"). So:
    //   [ ... ]  an OPTIONAL segment. If any token inside it is empty the whole segment disappears,
    //            which is how a message drops "in {sector}" cleanly when there is no calibration.
    //   then a tidy pass collapses the gaps, separators and stray punctuation that are left.
    function fill(tpl, vars) {
      const val = (k) => {
        const v = vars[String(k).toLowerCase()];
        return v == null || v === '' ? '' : String(v);
      };
      return String(tpl || '')
        .replace(/\[([^[\]]*)\]/g, (m, inner) => {
          const toks = inner.match(/\{(\w+)\}/g) || [];
          return toks.some((t) => val(t.slice(1, -1)) === '') ? '' : inner;
        })
        .replace(/\{(\w+)\}/g, (m, k) => val(k))
        .replace(/\s{2,}/g, ' ')
        .replace(/([,;:—–-])\s*(?=[,;:—–.!?])/g, '')
        .replace(/\s+([,.!?;:])/g, '$1')
        .replace(/^[\s,;:—–]+/, '')
        .replace(/[\s,;:—–-]+$/, '')
        .trim();
    }

    // ── suppression ──────────────────────────────────────────────────────────
    const lastSent = new Map();
    function onCooldown(key, seconds) {
      if (!seconds) return false;
      const now = Date.now();
      if (now - (lastSent.get(key) || 0) < seconds * 1000) return true;
      lastSent.set(key, now);
      return false;
    }
    // squadCache and lastSent both key on Steam ID, so on a long-running server they would grow with
    // every player who has ever been seen. Neither is worth keeping once it's stale.
    function pruneMaps() {
      const now = Date.now();
      for (const [k, v] of squadCache) if (now - v.at > 300000) squadCache.delete(k);
      for (const [k, at] of lastSent) if (now - at > 900000) lastSent.delete(k);
      for (const [k, v] of nameCache) if (now - v.at > 900000) nameCache.delete(k);
      // The two identity maps hold one entry per player ever seen and their answers never change, so
      // there is nothing to expire — only a ceiling, so a server with years of players cannot grow
      // them without limit. Dropped whole rather than aged: rebuilding one is a single indexed read.
      if (profileIdCache.size > 5000) profileIdCache.clear();
      if (profileRowCache.size > 5000) profileRowCache.clear();
    }
    const maintTimer = setInterval(pruneMaps, 300000);
    if (maintTimer.unref) maintTimer.unref();

    // A hard ceiling on outbound messages. Nothing normal comes close to it; it exists so a
    // pathological burst (a mass event, a runaway loop in a future edit) can never turn into a chat
    // flood on a live server. Over the limit we drop and count it, rather than queue for ever.
    let rateWindow = 0, rateCount = 0;
    function rateOk(n, perMinute) {
      if (!perMinute) return true;
      const now = Date.now();
      if (now - rateWindow > 60000) { rateWindow = now; rateCount = 0; }
      if (rateCount + n > perMinute) return false;
      rateCount += n;
      return true;
    }

    function inQuietHours(c) {
      if (!c.quietHours || !c.quietHours.enabled) return false;
      const h = new Date().getHours(), { from, to } = c.quietHours;
      // A window that wraps past midnight (22 → 6) is the normal case, so handle both orders.
      return from <= to ? (h >= from && h < to) : (h >= from || h < to);
    }

    // ── delivery ─────────────────────────────────────────────────────────────
    // `at` is where the event happened (used for the reader-relative tokens); omit it and those
    // tokens simply render empty.
    // `actorSteamId` picks the squad AND is normally the person the line is about. They differ for
    // "left the squad": the leaver is no longer a member, so the message has to be routed through
    // someone still in it — pass `subjectSteamId` so that router isn't mistaken for the subject and
    // filtered out of its own announcement by `includeSelf`.
    async function announce(kind, actorSteamId, vars, at, subjectSteamId) {
      try { await announceInner(kind, actorSteamId, vars, at, subjectSteamId); }
      catch (e) { host.logger.debug(`announce(${kind}) failed: ${e && e.message}`); }
    }

    async function announceInner(kind, actorSteamId, vars, at, subjectSteamId) {
      const subject = String(subjectSteamId != null ? subjectSteamId : actorSteamId);
      const c = cfg();
      if (!c.enabled) return;
      const evc = c.events[kind];
      if (!evc || !evc.enabled || !evc.message) return;
      if (inQuietHours(c)) { stats.suppressed++; persist(); return; }
      if (onCooldown(`${kind}:${subject}`, c.cooldownSeconds)) { stats.suppressed++; persist(); return; }

      // Live where the game will say who is in this squad, saved where it will not. This is the
      // decision the whole plugin turns on: it is who hears a line nobody else is meant to.
      const squad = await squadFor(actorSteamId);
      if (!squad) return;                                   // solo player — nobody to tell

      // If the line names someone and we could not work out who, say nothing. A message reading
      // "76561198... was killed" is worse to a squad than no message at all.
      if (/\{player\}/i.test(evc.message) && !vars.player) {
        host.logger.debug('no name for ' + actorSteamId + ' - "' + kind + '" not sent');
        return;
      }

      const online = onlineIndex();
      const adminMuted = new Set((c.mutedSteamIds || []).map(String));
      const targets = squad.members.map((m) => m.steamId).filter((sid) => (
        online.has(sid)
        && !adminMuted.has(sid)
        && !prefOf(sid).off
        && !prefOf(sid).muted[kind]
        && (c.includeSelf || sid !== subject)
      ));
      if (!targets.length) return;

      const pos = await positions();
      const base = Object.assign({
        squad: squad.name,
        squadsize: squad.members.length,
        squadonline: squad.members.filter((m) => online.has(m.steamId)).length,
        sector: at ? await sectorOf(at.x, at.y) : '',
        x: at ? Math.round(at.x) : '', y: at ? Math.round(at.y) : '',
      }, vars);

      const channel = safeChannel(c.channel);
      // A reader-relative message costs ONE bridge call per recipient. That is fine for a normal
      // squad and wasteful for a huge one, so past a threshold we send a single shared copy instead
      // — the relative tokens then resolve empty and their optional segments drop out cleanly.
      const maxIndiv = Number(c.maxIndividualSends) || 0;
      const relative = RELATIVE_TOKENS.test(evc.message) && (!maxIndiv || targets.length <= maxIndiv);
      const cost = relative ? targets.length : 1;
      if (!rateOk(cost, Number(c.maxPerMinute) || 0)) {
        stats.suppressed++; persist();
        host.logger.warn(`rate limit hit — dropped a "${kind}" message for ${targets.length} player(s)`);
        return;
      }
      try {
        if (!relative) {
          const text = fill(evc.message, base);
          if (!text) return;
          const res = await host.chat.send(text, { channel, targets });
          // The bridge reports how many players it actually reached. A call can succeed and deliver
          // to nobody — everyone logged off in the same instant, or the channel refused them — and
          // counting that as sent is how the panel ends up disagreeing with what the squad saw.
          const delivered = (res && Number.isFinite(Number(res.delivered))) ? Number(res.delivered) : targets.length;
          if (delivered <= 0) {
            host.logger.warn(`"${kind}" reached none of its ${targets.length} recipient(s) — the bridge accepted it and delivered it to nobody.`);
            stats.failed = (stats.failed || 0) + 1; persist();
            return;
          }
          stats.sent++;
          note(kind, vars.player || actorSteamId, text, delivered);
        } else {
          // One send per reader: {distance}/{direction} mean "from where YOU are".
          let first = '';
          let reached = 0;
          const failedFor = [];
          for (const sid of targets) {
            const me = pos.get(sid);
            const text = fill(evc.message, Object.assign({}, base, {
              distance: at && me ? metres(me, at) : '',
              direction: at && me ? await bearing(me, at) : '',
            }));
            if (!text) continue;
            // Per recipient, so a failure to reach ONE player must not abort the loop and silence
            // everyone after them.
            try { await host.chat.send(text, { channel, targets: [sid] }); reached++; if (!first) first = text; }
            catch (e) { failedFor.push(sid); host.logger.debug(`chat send failed (${kind} → ${sid}): ${e && e.message}`); }
          }
          // `stats.sent++` used to run whatever happened, so a message that reached NOBODY was
          // counted as sent and written into the activity feed with empty text. The squad got
          // nothing, the panel said otherwise, and the only trace was a debug line nobody reads.
          if (!reached) {
            host.logger.warn(`"${kind}" reached none of its ${targets.length} recipient(s) — every individual send failed.`);
            stats.failed = (stats.failed || 0) + 1; persist();
            return;
          }
          if (failedFor.length) host.logger.warn(`"${kind}" reached ${reached} of ${targets.length} — ${failedFor.length} player(s) did not get it.`);
          stats.sent++;
          note(kind, vars.player || actorSteamId, first, reached);
        }
      } catch (e) {
        host.logger.debug(`chat send failed (${kind}): ${e && e.message}`);
      }
    }

    // ── events ───────────────────────────────────────────────────────────────
    // WHERE the event happened. Live for anyone the game can answer for — a player is killed where
    // they were standing, not where they were at the last save — and never allowed to reject: this
    // sits directly on an event handler.
    async function posOf(steamId) {
      try {
        const p = (await positions()).get(String(steamId));
        return p && Number.isFinite(p.x) ? p : null;
      } catch { return null; }
    }

    function onJoin(p) {
      const sid = String((p && (p.steamId || p.SteamID)) || '');
      if (sid) posOf(sid).then((at) => announce('join', sid, { player: displayName(sid, p && (p.playerName || p.name)) }, at));
    }
    function onLeave(p) {
      const sid = String((p && (p.steamId || p.SteamID)) || '');
      if (sid) posOf(sid).then((at) => announce('leave', sid, { player: displayName(sid, p && (p.playerName || p.name)) }, at));
    }
    // Prefer the bridge's live join/leave: it fires the moment the player is actually in-game,
    // where the log-derived event can be many seconds late (SCUM writes its log in batches).
    if (typeof host.players.onJoin === 'function') { host.players.onJoin(onJoin); host.players.onLeave(onLeave); }
    else { host.events.on('player:join', onJoin); host.events.on('player:leave', onLeave); }

    host.events.on('kill', (e) => {
      if (!e) return;
      if (e.type === 'suicide') {
        const sid = String(e.steamId || '');
        posOf(sid).then((at) => announce('suicide', sid, { player: displayName(sid, e.playerName) }, at));
        return;
      }
      const vSquad = squadOf(e.victimSteamId), kSquad = squadOf(e.killerSteamId);
      const sameSquad = vSquad && kSquad && vSquad.id === kSquad.id;
      // The kill event carries the weapon as its raw game code ("Mine_01_C"), which is what the
      // message printed. host.items.name() is the manager's one item resolver — it already knows
      // every shape a code arrives in — so this reads "Anti-personnel mine". The raw code stays as
      // the fallback for anything the item database has never heard of.
      //
      // shotdistance is EMPTY, not 0, when there is no shot: a mine, a fall or an explosion has no
      // distance, and 0 is a value the optional-segment syntax cannot drop (it only drops empty
      // ones), so "— Anti-personnel mine, 0 m." could not be avoided from a template. With this,
      // writing it as `[, {shotdistance} m]` makes the whole clause disappear for those deaths.
      const dist = Number(e.distance);
      const shared = {
        weapon: host.items.name(e.weaponName) || e.weaponName || '',
        shotdistance: Number.isFinite(dist) && dist > 0 ? dist : '',
      };

      posOf(e.victimSteamId).then((at) => announce('death', String(e.victimSteamId || ''), Object.assign({
        player: actorDisplayName(e.victimSteamId, e.victimName), victim: actorDisplayName(e.victimSteamId, e.victimName),
        killer: actorDisplayName(e.killerSteamId, e.killerName),
      }, shared), at));

      // On friendly fire both templates describe the same event to the same people — the death
      // line already names the killer, so the kill line would be it told twice.
      if (!sameSquad) {
        posOf(e.killerSteamId).then((at) => announce('kill', String(e.killerSteamId || ''), Object.assign({
          player: actorDisplayName(e.killerSteamId, e.killerName), killer: actorDisplayName(e.killerSteamId, e.killerName),
          victim: actorDisplayName(e.victimSteamId, e.victimName),
        }, shared), at));
      }
    });

    host.events.on('raid:alert', (e) => {
      if (!e || !e.ownerSteamId) return;
      const obj = e.object || {};
      // raid:alert carries location as an OBJECT {x,y,z} — not the "X=… Y=…" string the log feeds
      // use. Accept both so the sector/distance tokens work either way.
      let at = null;
      const loc = e.location;
      if (loc && typeof loc === 'object' && Number.isFinite(Number(loc.x)) && Number.isFinite(Number(loc.y))) at = { x: Number(loc.x), y: Number(loc.y) };
      else if (typeof loc === 'string') {
        const m = /X=(-?[\d.]+)\s*Y=(-?[\d.]+)/i.exec(loc);
        if (m) at = { x: Number(m[1]), y: Number(m[2]) };
      }
      announce('raid', String(e.ownerSteamId), {
        player: displayName(e.ownerSteamId, e.ownerName),
        object: obj.customName || obj.name || 'something',
        type: e.type || '',
      }, at);
    });

    // ── squad roster changes ─────────────────────────────────────────────────
    // There is no event for "joined/left a squad", so diff the membership of squads that have
    // someone online. Only those: polling every squad on a big server would be pointless work.
    let rosters = new Map();   // squadId -> { name, at, members: Map(steamId -> name) }
    const ROSTER_TTL_MS = 15 * 60 * 1000;
    let rosterTimer = null;
    function pollRosters() {
      try {
        const online = onlineIndex();
        const seen = new Set();
        const handled = new Set();
        const stamp = Date.now();
        for (const sid of online.keys()) {
          if (handled.has(sid)) continue;             // already covered by a squad we just read
          const sq = squadOf(sid, true);              // fresh: a cached read would lag a whole cycle
          if (!sq) { handled.add(sid); continue; }
          // The query returns the WHOLE squad, so mark every member handled — otherwise a five-man
          // squad costs five identical queries every cycle.
          sq.members.forEach((m) => handled.add(m.steamId));
          if (seen.has(sq.id)) continue;
          seen.add(sq.id);
          const members = new Map(sq.members.map((m) => [m.steamId, m.name || m.steamId]));
          const prev = rosters.get(sq.id);
          rosters.set(sq.id, { name: sq.name, at: stamp, members });

          // No baseline, or the name behind this id changed: SCUM reuses squad ids after a disband,
          // and a rename means the snapshot describes a different group. Diffing either against the
          // old membership would announce a flood of joins and leaves that never happened — so the
          // new snapshot simply becomes the baseline and we compare from the next cycle.
          if (!prev || prev.name !== sq.name) continue;

          const joined = sq.members.filter((m) => !prev.members.has(m.steamId));
          const left = [...prev.members].filter(([id]) => !members.has(id));

          // Invalidate BEFORE announcing, not after. announce() resolves the squad through the
          // cache, and someone who just joined is cached as "no squad" from an earlier sweep — so
          // announcing first silently dropped their own join for up to the cache TTL. The leaver is
          // invalidated for the opposite reason: they'd keep receiving this squad's messages.
          if (joined.length || left.length) {
            joined.forEach((m) => squadCache.delete(m.steamId));
            left.forEach(([id]) => squadCache.delete(id));
            sq.members.forEach((m) => squadCache.delete(m.steamId));
          }

          joined.forEach((m) => announce('squadJoin', m.steamId, { player: displayName(m.steamId, m.name) }));
          for (const [id, oldName] of left) {
            // They're gone from this squad, so squadOf(them) no longer resolves here — route the
            // line through someone still in it. The snapshot keeps their name so the message reads
            // "Petr left" rather than a bare 17-digit ID.
            const anchor = sq.members[0];
            if (anchor) announce('squadLeave', anchor.steamId, { player: displayName(id, oldName) }, null, id);
          }
        }
        // Drop snapshots we haven't confirmed in a while — a disbanded squad, or one whose members
        // stopped playing. Without this the map grows for the life of the process, and a reused
        // squad id would be diffed against a dead roster.
        for (const [id, snap] of rosters) if (stamp - snap.at > ROSTER_TTL_MS) rosters.delete(id);
      } catch (e) { host.logger.debug(`roster poll: ${e && e.message}`); }
    }
    function startRosterPoll() {
      if (rosterTimer) clearInterval(rosterTimer);
      const c = cfg();
      const secs = Math.max(5, Number(c.rosterPollSeconds) || 60);
      const anyOn = c.events.squadJoin.enabled || c.events.squadLeave.enabled;
      if (!anyOn) { rosterTimer = null; return; }
      rosterTimer = setInterval(pollRosters, secs * 1000);
      offs.push(() => clearInterval(rosterTimer));
    }

    // ── player commands ──────────────────────────────────────────────────────
    function subName(c, key) { return String((c.commands.subs[key] || {}).name || key).toLowerCase(); }
    function subOn(c, key) { return !!(c.commands.subs[key] || {}).enabled; }

    async function rosterLines(c, me, squad, online, pos) {
      const t = c.commands.texts;
      const mine = pos.get(me);
      const mates = [];
      for (const m of squad.members) {
        if (m.steamId === me || !online.has(m.steamId)) continue;
        const p = pos.get(m.steamId);
        mates.push({
          name: displayName(m.steamId, m.name) || online.get(m.steamId) || '',
          distance: metres(mine, p),
          sector: p ? await sectorOf(p.x, p.y) : '',
          direction: (mine && p) ? await bearing(mine, p) : '',
        });
      }
      mates.sort((a, b) => (a.distance == null ? 1e9 : a.distance) - (b.distance == null ? 1e9 : b.distance));
      const base = {
        squad: squad.name, squadsize: squad.members.length,
        squadonline: squad.members.filter((m) => online.has(m.steamId)).length,
      };
      if (!mates.length) return [fill(t.rosterEmpty, base)];
      return [fill(t.rosterHeader, base)].concat(mates.map((m) => fill(t.rosterLine, Object.assign({
        player: m.name, distance: m.distance == null ? '' : m.distance, sector: m.sector, direction: m.direction,
      }, base))));
    }

    async function handleCommand(ctx) {
      const c = cfg();
      if (!c.enabled) return;
      stats.commands++; persist();
      const t = c.commands.texts;
      const me = String(ctx.steamId || '');
      const sub = String((ctx.args && ctx.args[0]) || '').toLowerCase();
      let rest = (ctx.argString || '').split(/\s+/).slice(1).join(' ').trim();
      const root = c.commands.root;
      const squad = await squadFor(me);

      const reply = (s) => (s ? ctx.reply(s, { channel: safeChannel(c.channel) }) : Promise.resolve());

      // Self-service switches work even without a squad — a player can pre-silence things.
      if (sub && subOn(c, 'off') && sub === subName(c, 'off')) { prefFor(me).off = true; persist(); return reply(fill(t.mutedOn, { root, on: subName(c, 'on') })); }
      if (sub && subOn(c, 'on') && sub === subName(c, 'on')) { prefFor(me).off = false; persist(); return reply(fill(t.mutedOff, {})); }
      if (sub && subOn(c, 'mute') && sub === subName(c, 'mute')) {
        const p = prefFor(me);
        const arg = rest.toLowerCase();
        if (!arg) return reply(fill(t.muteUsage, { root, mute: subName(c, 'mute'), events: EVENT_KEYS.join('|'), muted: Object.keys(p.muted).join(', ') || 'none' }));
        const unknown = [];
        if (arg === 'none') p.muted = {};
        else if (arg === 'all') EVENT_KEYS.forEach((k) => { p.muted[k] = true; });
        else {
          // A list toggles exactly what was named and leaves the rest alone.
          arg.split(/[,\s]+/).filter(Boolean).forEach((k) => {
            const key = EVENT_KEYS.filter((e) => e.toLowerCase() === k)[0];
            // A name we do not recognise used to be dropped in silence, so a typo — `mute kils` —
            // did nothing at all and the confirmation below still listed the unchanged state, which
            // reads exactly like it worked. The player then wonders why they are still being
            // pinged. Say which words were not understood.
            if (key) { if (p.muted[key]) delete p.muted[key]; else p.muted[key] = true; }
            else unknown.push(k);
          });
        }
        persist();
        const done = fill(t.muteSet, { muted: Object.keys(p.muted).join(', ') || 'none' });
        return reply(unknown.length
          ? `${done} (didn't recognise: ${unknown.join(', ')} — try ${EVENT_KEYS.join('|')}, all or none)`
          : done);
      }
      if (sub && subOn(c, 'help') && sub === subName(c, 'help')) {
        const list = SUB_KEYS.filter((k) => subOn(c, k)).map((k) => `${root} ${subName(c, k)}`).join(', ');
        return reply(fill(t.help, { root, list }));
      }

      if (!squad) return reply(fill(t.notInSquad, {}));

      const online = onlineIndex();
      const world = worldSnapshot();
      // "Where is everyone" is the whole point of the roster and of /squad here — live where the
      // game can say, saved where it cannot. `world` is still the source for BASES below, which do
      // not move and have no live equivalent that carries an owner.
      const pos = await positions();
      const mine = pos.get(me);
      const mates = squad.members.filter((m) => m.steamId !== me && online.has(m.steamId));
      const chan = safeChannel(c.channel);

      // Admin mute is a moderation decision, so it applies to player-initiated traffic as well.
      // A player's own /squad off does NOT: they silenced automated alerts, not their squad talking.
      const adminMuted = new Set((c.mutedSteamIds || []).map(String));
      const reachable = mates.filter((m) => !adminMuted.has(m.steamId));

      // Sending to the squad can fail, and `host.chat.send` throws when it does. Uncaught, the throw
      // skipped the confirmation below and was swallowed by the caller's debug catch — so the player
      // saw NOTHING: no "sent", no error, just a command that appeared to be ignored. Both player
      // commands answer either way now.
      const sendToSquad = async (line, targets, kind, who) => {
        try {
          await host.chat.send(line, { channel: chan, targets });
          note(kind, who, line, targets.length);
          return true;
        } catch (e) {
          host.logger.warn(`"${root} ${kind}" from ${who} could not be delivered: ${e && e.message}`);
          return false;
        }
      };

      if (sub && subOn(c, 'here') && sub === subName(c, 'here')) {
        if (!reachable.length) return reply(fill(t.nobodyOnline, {}));
        const who = displayName(me, ctx.name);
        const line = fill(t.here, { player: who, sector: mine ? await sectorOf(mine.x, mine.y) : '', squad: squad.name });
        const sent = await sendToSquad(line, reachable.map((m) => m.steamId), 'here', who);
        return reply(sent ? fill(t.hereOk, {}) : 'Couldn’t reach your squad just now — try again in a moment.');
      }

      if (sub && subOn(c, 'msg') && sub === subName(c, 'msg')) {
        if (!rest) return reply(fill(t.msgUsage, { root, msg: subName(c, 'msg') }));
        // Free text from one player shown to others: keep it to one readable line. Braces are
        // stripped so a message can't smuggle a token into the template it gets rendered into.
        rest = rest.replace(/[\u0000-\u001f{}]/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 200);
        if (!rest) return reply(fill(t.msgUsage, { root, msg: subName(c, 'msg') }));
        if (!reachable.length) return reply(fill(t.nobodyOnline, {}));
        const who = displayName(me, ctx.name);
        const line = fill(t.msgLine, { player: who, text: rest, squad: squad.name });
        const sent = await sendToSquad(line, reachable.map((m) => m.steamId), 'msg', who);
        return reply(sent ? fill(t.msgOk, { count: reachable.length }) : 'Couldn’t reach your squad just now — try again in a moment.');
      }

      if (sub && subOn(c, 'base') && sub === subName(c, 'base')) {
        const names = new Set(squad.members.map((m) => (m.name || '').toLowerCase()));
        const bases = (world.bases || []).filter((b) => (
          (b.squad && squad.name && String(b.squad).toLowerCase() === String(squad.name).toLowerCase())
          || (b.owner && names.has(String(b.owner).toLowerCase()))
        ));
        if (!bases.length) return reply(fill(t.baseNone, {}));
        // Nearest one: a squad often has several, and "your base" means the one you'd walk to.
        let best = bases[0], bestD = mine ? metres(mine, bases[0]) : null;
        for (const b of bases) { const d = mine ? metres(mine, b) : null; if (d != null && (bestD == null || d < bestD)) { best = b; bestD = d; } }
        const bSector = await sectorOf(best.x, best.y);
        // Knowing a base exists but nothing about WHERE would render "Your base is." — say we
        // couldn't locate it instead of sending a sentence with no content in it.
        if (!bSector && bestD == null) return reply(fill(t.baseNone, {}));
        return reply(fill(t.base, {
          sector: bSector,
          distance: bestD == null ? '' : bestD,
          direction: mine ? await bearing(mine, best) : '',
          name: best.name || '',
        }));
      }

      if (sub && subOn(c, 'info') && sub === subName(c, 'info')) {
        let extra = null;
        try { extra = host.players.squad(me); } catch { /* ignore */ }
        const base = {
          squad: squad.name, squadsize: squad.members.length,
          squadonline: squad.members.filter((m) => online.has(m.steamId)).length,
          // squad.score is a float in the database; nobody wants "score 1234.5678".
          score: (extra && extra.score) != null ? Math.round(Number(extra.score)) : '',
        };
        await reply(fill(t.info, base));
        if (extra && extra.message) await reply(fill(t.infoMotd, Object.assign({ motd: extra.message }, base)));
        return undefined;
      }

      // No subcommand (or an unknown one) → the roster, which is what /squad should do by default.
      const lines = await rosterLines(c, me, squad, online, pos);
      for (const line of lines.filter(Boolean)) await reply(line);
      return undefined;
    }

    function registerCommand() {
      const c = cfg();
      if (!c.commands.enabled || !c.commands.root) return;
      offs.push(host.chat.onCommand(c.commands.root, (ctx) => handleCommand(ctx).catch((e) => host.logger.debug(`command: ${e && e.message}`))));
    }

    function wire() { clear(); registerCommand(); startRosterPoll(); }
    wire();
    host.config.onChange(() => { squadCache.clear(); calib = null; wire(); });

    // ── admin API ────────────────────────────────────────────────────────────
    host.routes.get('/config', (req, res) => res.json(cfg()));
    /**
     * A caller's body laid over what is already STORED, one level deep.
     *
     * ⚠ **A SETTING NOBODY SENT IS NOT A SETTING TO RESET.** Every field below is rebuilt from the
     * body with a DEFAULTS fallback, which is what makes an older config safe to read — and it means
     * a body naming ONE key resets all the others. The first line is the worst of them:
     * `enabled: !!b.enabled` on a body with no `enabled` key SWITCHES THE PLUGIN OFF, and the save
     * answers `ok`. The panel POSTs the whole object so nothing has done it yet; a script, a second
     * screen or a future partial save would.
     *
     * By KEY PRESENCE, never truthiness — `"mutedSteamIds": []` is an owner who cleared the list.
     * An ARRAY replaces rather than merging; merging two lists by index is never what was meant.
     */
    function overlay(stored, body) {
      const out = Object.assign({}, (stored && typeof stored === 'object') ? stored : {});
      if (!body || typeof body !== 'object') return out;
      for (const k of Object.keys(body)) {
        const v = body[k]; const cur = out[k];
        if (v && typeof v === 'object' && !Array.isArray(v)
            && cur && typeof cur === 'object' && !Array.isArray(cur)) out[k] = Object.assign({}, cur, v);
        else out[k] = v;
      }
      return out;
    }

    host.routes.post('/config', (req, res) => {
      const b = overlay(host.config.get() || {}, req.body || {});
      const events = {};
      for (const k of EVENT_KEYS) {
        const src = (b.events || {})[k] || {};
        events[k] = { enabled: !!src.enabled, message: String(src.message == null ? DEFAULTS.events[k].message : src.message) };
      }
      const subs = {};
      for (const k of SUB_KEYS) {
        const src = ((b.commands || {}).subs || {})[k] || {};
        subs[k] = {
          enabled: !!src.enabled,
          name: String(src.name || k).toLowerCase().replace(/[^\w-]/g, '').slice(0, 16) || k,
        };
      }
      const texts = {};
      for (const k of Object.keys(DEFAULTS.commands.texts)) {
        const v = ((b.commands || {}).texts || {})[k];
        texts[k] = String(v == null ? DEFAULTS.commands.texts[k] : v);
      }
      host.config.set({
        enabled: !!b.enabled,
        channel: safeChannel(b.channel),
        includeSelf: !!b.includeSelf,
        cooldownSeconds: Math.max(0, Math.min(600, Number(b.cooldownSeconds) || 0)),
        maxIndividualSends: Math.max(0, Math.min(100, Number(b.maxIndividualSends) || 0)),
        maxPerMinute: Math.max(0, Math.min(5000, Number(b.maxPerMinute) || 0)),
        rosterPollSeconds: Math.max(5, Math.min(3600, Number(b.rosterPollSeconds) || 60)),
        quietHours: {
          enabled: !!(b.quietHours && b.quietHours.enabled),
          from: Math.max(0, Math.min(23, Number(b.quietHours && b.quietHours.from) || 0)),
          to: Math.max(0, Math.min(23, Number(b.quietHours && b.quietHours.to) || 0)),
        },
        mutedSteamIds: Array.isArray(b.mutedSteamIds) ? b.mutedSteamIds.map(String).slice(0, 500) : [],
        events,
        commands: {
          enabled: !!(b.commands && b.commands.enabled),
          root: String((b.commands && b.commands.root) || 'squad').toLowerCase().replace(/[^\w-]/g, '').slice(0, 16) || 'squad',
          subs, texts,
        },
      });
      res.json({ ok: true });
    });

    host.routes.get('/status', (req, res) => {
      const online = onlineIndex();
      // How many squads currently have 2+ members online — i.e. how many would actually receive
      // anything. A server full of solo players will legitimately see nothing.
      const seen = new Set();
      let activeSquads = 0;
      for (const sid of online.keys()) {
        const sq = squadOf(sid);
        if (!sq || seen.has(sq.id)) continue;
        seen.add(sq.id);
        if (sq.members.filter((m) => online.has(m.steamId)).length > 1) activeSquads++;
      }
      res.json({
        stats, recent: recent.slice(0, 40), online: online.size, activeSquads,
        geography: !!(host.map && typeof host.map.sector === 'function'),
        // Every number above is a photograph of a running world, so with the server stopped they are
        // all a truthful 0 — and a screenful of zeroes with no caption reads as "this plugin is not
        // working", which is the one thing it does not mean. The panel says so instead of leaving the
        // owner to guess. An older manager has no `isRunning`, so this is a feature-detect, not a call.
        serverRunning: (host.server && typeof host.server.isRunning === 'function') ? !!host.server.isRunning() : null,
        // Which of the two live reads could not run, and why in the module's own words. `null` for a
        // read means it answered last time it was asked. An owner has to be able to tell "live" from
        // "quietly back on the last save"; without this they cannot.
        live: { players: liveNote.players, squads: liveNote.squads },
      });
    });

    host.routes.get('/players', (req, res) => {
      const online = onlineIndex();
      const out = [];
      const seen = new Set();
      online.forEach((name, steamId) => {
        seen.add(String(steamId));
        const sq = squadOf(steamId);
        const p = prefs[steamId] || {};
        out.push({ steamId, name, squad: sq ? sq.name : null, off: !!p.off, muted: Object.keys(p.muted || {}), online: true });
      });
      // …and anyone OFFLINE who has silenced something.
      //
      // A preference is set in game and then persists. Listing only who is online meant a player who
      // muted their alerts and logged off vanished from the panel while their setting kept working —
      // so "reset it if someone asks" was impossible for exactly the person most likely to ask,
      // since they are asking on Discord rather than standing in game. The `/prefs` route was
      // written for this and the panel never called it; folding it in here means one list instead of
      // two, and the reset button already works on any steamId.
      for (const steamId of Object.keys(prefs)) {
        if (seen.has(String(steamId))) continue;
        const p = prefs[steamId] || {};
        const muted = Object.keys(p.muted || {});
        if (!p.off && !muted.length) continue;              // nothing silenced — nothing to show
        const sq = squadOf(steamId);
        // `displayName` already knows the rule for this: whoever is online, else the game database,
        // never a raw Steam ID. An offline player is exactly the case it was written for.
        out.push({ steamId, name: displayName(steamId, '') || steamId, squad: sq ? sq.name : null, off: !!p.off, muted, online: false });
      }
      out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      res.json(out);
    });
    host.routes.post('/prefs/reset', (req, res) => {
      const sid = String((req.body || {}).steamId || '');
      if (sid) delete prefs[sid]; else prefs = {};
      persist();
      res.json({ ok: true });
    });

    host.routes.post('/clear-log', (req, res) => { recent = []; persist(); res.json({ ok: true }); });

    // Fire a real message at one player's squad so an admin can confirm the whole chain works
    // (bridge → squad channel → the right recipients) without waiting for someone to die.
    host.routes.post('/test', async (req, res) => {
      const sid = String((req.body || {}).steamId || '');
      if (!sid) { res.status(400).json({ ok: false, error: 'steamId required' }); return; }
      const squad = squadOf(sid);
      if (!squad) { res.json({ ok: false, error: 'not_in_squad' }); return; }
      const online = onlineIndex();
      const targets = squad.members.map((m) => m.steamId).filter((s) => online.has(s));
      if (!targets.length) { res.json({ ok: false, error: 'nobody_online' }); return; }
      try {
        await host.chat.send(`[${squad.name}] Better Squads test — if you can read this, it works.`,
          { channel: safeChannel(cfg().channel), targets });
        res.json({ ok: true, delivered: targets.length });
      } catch (e) {
        res.json({ ok: false, error: (e && e.message) || 'send_failed' });
      }
    });

    host.onUnload(() => { clear(); clearInterval(maintTimer); flushNow(); });
    host.logger.info('Better Squads ready');
  },
};
