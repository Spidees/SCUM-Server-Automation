'use strict';

// The styler half of this plugin: restyling the manager's OWN embeds, and the custom live embeds
// that keep themselves updated in a channel.
//
// This was a separate plugin (embed-styler) until the two were merged. They were already mutually
// dependent — it mounted the editor's UI, and the editor takes its live-data catalog from the
// `server-data` service registered here — which is a strong sign they were one thing all along.
// Kept as its own FILE rather than folded into index.js: it is the most-iterated code here and
// reads better whole; index.js just hands it the same host.

function clean(v) { return (typeof v === 'string' && v.trim() !== '') ? v : undefined; }

module.exports = {
  async register(host) {
    // discord.js deprecated the `ephemeral: true` reply option in favour of the flag; the old one
    // still works but warns on every reply. 64 is the flag's fixed value in Discord's API.
    const EPHEMERAL = (() => {
      try { return { flags: host.discord.js.MessageFlags.Ephemeral }; } catch { return { flags: 64 }; }
    })();
    const editor = host.consume('embed-editor');

    // ── token helpers ───────────────────────────────────────────────────────────
    function locText(ctx) {
      const loc = ctx.location || (ctx.locationX != null ? { x: ctx.locationX, y: ctx.locationY, z: ctx.locationZ } : null);
      if (loc && loc.x != null && loc.y != null) return `X=${Math.round(loc.x)} Y=${Math.round(loc.y)} Z=${Math.round(loc.z || 0)}`;
      return ctx.locationText || null;
    }
    function enrich(sid, out) {
      if (!sid) return;
      try { const sq = host.players.squad(sid); if (sq) { out.squad = sq.name || sq.squadName || sq.squad || null; out.squadSize = sq.memberCount != null ? sq.memberCount : (Array.isArray(sq.members) ? sq.members.length : null); } } catch { /* optional */ }
      try {
        const st = host.players.stats(sid);
        if (st) {
          // Every stat field becomes {stat_<Field>} (Kills, Deaths, Headshots, FamePoints, LongestKill, …).
          for (const k of Object.keys(st)) { const v = st[k]; if (typeof v === 'number' || typeof v === 'string') out['stat_' + k] = String(v); }
          out.fame = out.stat_FamePoints != null ? out.stat_FamePoints : (st.fame != null ? st.fame : st.famePoints);
          out.money = out.stat_Money != null ? out.stat_Money : (st.money != null ? st.money : st.account);
          out.playerKills = out.stat_Kills != null ? out.stat_Kills : st.kills;
          out.playerDeaths = out.stat_Deaths != null ? out.stat_Deaths : st.deaths;
        }
      } catch { /* optional */ }
    }
    // Every scalar property of the ctx becomes a token, plus a readable location.
    function base(ctx) {
      const m = {};
      for (const k of Object.keys(ctx || {})) { const v = ctx[k]; if (v == null) continue; if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') m[k] = String(v); }
      const lt = locText(ctx); if (lt) m.location = lt;
      return m;
    }
    const itemName = (code) => (code ? (host.items.name(code) || String(code)) : null);
    function topPlayer() {
      try {
        const all = host.leaderboards.all(1) || {};
        const cat = Object.keys(all)[0];
        const row = cat && Array.isArray(all[cat]) && all[cat][0];
        if (row) return { name: row.Name || row.name || row.playerName || null, score: row.FormattedValue != null ? row.FormattedValue : (row.value != null ? row.value : null) };
      } catch { /* optional */ }
      return {};
    }
    function lbCategories() {
      try {
        return (host.leaderboards.categories() || []).map((c) => (typeof c === 'string' ? { key: c, label: c } : { key: c.key, label: c.label || c.name || c.key, emoji: c.emoji })).filter((c) => c.key);
      } catch { return []; }
    }

    const T = (t, label, sample) => ({ t: t, label: label, sample: sample });
    const T2 = (t, label, sample, group) => ({ t: t, label: label, sample: sample, group: group });
    const F = (name, token, inline) => ({ name: name, value: '{' + token + '}', inline: inline !== false });
    const TOK = {
      playerName: T('playerName', 'Player name', 'Jaruna'), steamId: T('steamId', 'Steam ID', '76561198000000000'),
      playerId: T('playerId', 'Player ID', '12'), location: T('location', 'Location (X Y Z)', 'X=-177569 Y=-161794 Z=1200'),
      squad: T('squad', 'Squad name', 'Wolves'), squadSize: T('squadSize', 'Squad size', '5'),
      fame: T('fame', 'Fame points', '18420'), money: T('money', 'Bank balance', '9500'),
      playerKills: T('playerKills', 'Player total kills', '142'), playerDeaths: T('playerDeaths', 'Player total deaths', '37'),
    };

    // ── per-kind catalogs (feeds are event-driven; live embeds use the ctx the manager now passes) ──
    const CATALOG = {
      login: {
        tokens: [TOK.playerName, TOK.playerId, TOK.steamId, T('ipAddress', 'IP address', '192.0.2.10'), T('isDrone', 'Drone mode', 'false'), TOK.location, TOK.squad, TOK.squadSize, TOK.fame, TOK.money],
        player: true,
        defaults: [F('👤 Player', 'playerName'), F('🆔 Player ID', 'playerId'), F('🎮 Steam ID', 'steamId'), F('🌐 IP', 'ipAddress'), F('📍 Location', 'location', false)],
        resolve: (c) => { const m = base(c); enrich(c.steamId, m); return m; },
      },
      kill: {
        tokens: [T('killerName', 'Killer name', 'Jaruna'), T('victimName', 'Victim name', 'Bandit'), T('weapon', 'Weapon (name)', 'M16A4'), T('weaponImage', 'Weapon image URL', 'https://…/Weapon_M16A4__vicinity.png'), T('weaponType', 'Weapon type', 'ranged'), T('distance', 'Distance', '134 m'), T('killerSteamId', 'Killer Steam ID', '76561198000000000'), T('victimSteamId', 'Victim Steam ID', '76561198999999999'), TOK.location, T('squad', "Killer's squad", 'Wolves'), T('fame', "Killer's fame", '18420'), TOK.playerName, TOK.steamId],
        defaults: [F('🔪 Killer', 'killerName'), F('💀 Victim', 'victimName'), F('🔫 Weapon', 'weapon'), F('📏 Distance', 'distance'), F('📍 Location', 'location', false)],
        resolve: (c) => { const m = base(c); if (c.weaponName) { m.weapon = itemName(c.weaponName); m.weaponImage = host.items.image(c.weaponName, 'vicinity') || ''; } if (c.distance != null) m.distance = `${c.distance} m`; enrich(c.killerSteamId || c.steamId, m); return m; },
      },
      eventkill: {
        tokens: [T('killerName', 'Killer name', 'Jaruna'), T('victimName', 'Victim name', 'Bandit'), T('weapon', 'Weapon (name)', 'M16A4'), T('weaponImage', 'Weapon image URL', 'https://…/Weapon_M16A4__vicinity.png'), T('distance', 'Distance', '134 m'), T('killerSteamId', 'Killer Steam ID', '76561198000000000'), T('victimSteamId', 'Victim Steam ID', '76561198999999999'), TOK.location],
        defaults: [F('🔪 Killer', 'killerName'), F('💀 Victim', 'victimName'), F('🔫 Weapon', 'weapon'), F('📏 Distance', 'distance'), F('📍 Location', 'location', false)],
        resolve: (c) => { const m = base(c); if (c.weaponName) { m.weapon = itemName(c.weaponName); m.weaponImage = host.items.image(c.weaponName, 'vicinity') || ''; } if (c.distance != null) m.distance = `${c.distance} m`; enrich(c.killerSteamId, m); return m; },
      },
      economy: {
        tokens: [TOK.playerName, TOK.steamId, T('type', 'Activity type', 'sell'), T('item', 'Item (name)', 'Bandage'), T('itemImage', 'Item image URL', 'https://…/Bandage.png'), T('itemsList', 'Items (list)', 'Bandage x3 — 500\n7.62mm x60 — 1200'), T('quantity', 'Quantity', '3'), T('amount', 'Amount', '1500'), T('unitPrice', 'Price / item', '500'), T('totalAmount', 'Total credits', '4500'), T('health', 'Item condition', '87'), T('trader', 'Trader', 'Armory (A1)'), T('cardType', 'Card type', 'Gold'), T('beforeCash', 'Cash before', '2000'), T('afterCash', 'Cash after', '500'), T('beforeAccount', 'Account before', '8000'), T('afterAccount', 'Account after', '9500'), T('beforeGold', 'Gold before', '30'), T('afterGold', 'Gold after', '35'), T('beforeTraderFunds', 'Trader funds before', '50000'), T('afterTraderFunds', 'Trader funds after', '48500'), TOK.squad],
        defaults: [F('👤 Player', 'playerName'), F('🎮 Steam ID', 'steamId'), F('📦 Item', 'item'), F('💵 Amount', 'amount')],
        resolve: (c) => { const m = base(c); if (c.item || c.code) { m.item = itemName(c.code || c.item); m.itemImage = host.items.image(c.code || c.item) || ''; } if (Array.isArray(c.items) && c.items.length) m.itemsList = c.items.map((it) => (itemName(it.item || it.Item || it.code) || '?') + ' x' + (it.quantity || 1) + (it.amount != null ? ' — ' + it.amount : (it.Amount != null ? ' — ' + it.Amount : ''))).join('\n'); enrich(c.steamId, m); return m; },
      },
      chest: {
        tokens: [TOK.playerName, TOK.playerId, TOK.steamId, T('entityId', 'Entity ID', '844213'), T('action', 'Action', 'Claimed'), TOK.location, TOK.squad],
        defaults: [F('👤 Player', 'playerName'), F('🆔 Player ID', 'playerId'), F('🎮 Steam ID', 'steamId'), F('🆔 Entity ID', 'entityId'), F('📍 Location', 'location', false)],
        resolve: (c) => { const m = base(c); enrich(c.steamId, m); return m; },
      },
      raid: {
        tokens: [T('flagId', 'Flag ID', '5521'), T('ownerId', 'Owner ID', '12'), T('eventType', 'Event type', 'ProtectionActivated'), T('duration', 'Duration (s)', '7200'), T('startDelay', 'Starts in (s)', '600'), T('userId', 'Triggered by', '9'), T('reason', 'Reason', 'Owner offline'), TOK.location],
        defaults: [F('🚩 Flag ID', 'flagId'), F('👑 Owner ID', 'ownerId'), F('📍 Location', 'location', false)],
        resolve: (c) => base(c),
      },
      admin: {
        tokens: [T('adminName', 'Admin name', 'Spidees'), T('type', 'Action type', 'teleport'), TOK.playerId, TOK.steamId, T('command', 'Command', '#Teleport 100 200 300')],
        defaults: [F('🛡️ Admin', 'adminName'), F('🆔 Player ID', 'playerId'), F('🎮 Steam ID', 'steamId'), F('⌨️ Command', 'command', false)],
        resolve: (c) => base(c),
      },
      fame: {
        tokens: [TOK.playerName, TOK.steamId, T('amount', 'Amount', '+250'), T('type', 'Type', 'kill'), T('action', 'Action', 'Kill'), T('reason', 'Reason', 'PvP kill'), TOK.squad],
        defaults: [F('👤 Player', 'playerName'), F('🎮 Steam ID', 'steamId'), F('💵 Amount', 'amount'), F('⚡ Action', 'action')],
        resolve: (c) => { const m = base(c); enrich(c.steamId, m); return m; },
      },
      quest: {
        tokens: [TOK.playerName, TOK.steamId, T('questName', 'Quest name', 'Hunt the Boars'), T('questId', 'Quest ID', 'Q_12'), T('tier', 'Tier', '2'), T('action', 'Action', 'completed'), TOK.location],
        defaults: [F('👤 Player', 'playerName'), F('🎮 Steam ID', 'steamId'), F('📜 Quest', 'questName'), F('📍 Location', 'location', false)],
        resolve: (c) => { const m = base(c); m.questName = c.displayQuestName || c.questName; enrich(c.steamId, m); return m; },
      },
      vehicle: {
        tokens: [T('vehicleName', 'Vehicle name', 'Laika'), T('vehicleId', 'Vehicle ID', '77213'), T('ownerName', 'Owner name', 'Jaruna'), T('ownerSteamId', 'Owner Steam ID', '76561198000000000'), T('ownerPlayerId', 'Owner Player ID', '12'), T('eventType', 'Event type', 'Destroyed'), TOK.location],
        defaults: [F('🚗 Vehicle', 'vehicleName'), F('🆔 Vehicle ID', 'vehicleId'), F('👑 Owner', 'ownerName'), F('📍 Location', 'location', false)],
        resolve: (c) => base(c),
      },
      violation: {
        tokens: [TOK.playerName, TOK.playerId, TOK.steamId, T('type', 'Type', 'BAN'), T('violationType', 'Violation type', 'AmmoCountMismatch'), T('action', 'Action', 'Kicked'), T('reason', 'Reason', 'Ammo count mismatch'), T('weapon', 'Weapon', 'AK-47'), T('distance', 'Distance', '54 m'), TOK.location],
        defaults: [F('👤 Player', 'playerName'), F('🆔 Player ID', 'playerId'), F('🎮 Steam ID', 'steamId'), F('📝 Reason', 'reason', false)],
        resolve: (c) => { const m = base(c); if (c.distance != null) m.distance = `${c.distance} m`; enrich(c.steamId, m); return m; },
      },
      gameplay: {
        tokens: [TOK.playerName, TOK.steamId, T('type', 'Event type', 'lockpicking'), T('success', 'Success', 'true'), T('source', 'Source', 'PLAYER'), TOK.location],
        defaults: [],
        resolve: (c) => { const m = base(c); enrich(c.steamId, m); return m; },
      },
      // ── live embeds — the manager now passes their full display data as ctx ──
      status: {
        title: '🛰️ Server Status',
        tokens: [
          T('statusText', 'Server state', 'Online'), T('onlinePlayers', 'Online players', '24'), T('maxPlayers', 'Max players', '64'), T('onlineMax', 'Online / max', '24 / 64'),
          T('fps', 'Server FPS', '58'), T('serverAddress', 'Server address', '203.0.113.5:7044'), T('nextRestart', 'Next restart', 'in 3 hours'),
          T('gameTime', 'In-game time', '14:32'), T('temperature', 'Temperature', '18°C'), T('totalPlayers', 'Registered players', '1043'),
          T('activeSquads', 'Active squads', '37'), T('topPlayer', 'Top player (name)', 'Jaruna'), T('topPlayerScore', 'Top player score', '142 kills'),
        ],
        defaults: [F('🌎 Status', 'statusText'), F('👥 Online', 'onlineMax'), F('📡 Address', 'serverAddress'), F('🔄 Next restart', 'nextRestart'), F('🎮 FPS', 'fps'), F('🕗 Game time', 'gameTime'), F('🌡️ Temperature', 'temperature'), F('🚩 Active squads', 'activeSquads'), F('🏆 Top player', 'topPlayer')],
        resolve: (c) => {
          const m = base(c); const tp = topPlayer();
          m.onlineMax = `${c.onlinePlayers != null ? c.onlinePlayers : '-'} / ${c.maxPlayers != null ? c.maxPlayers : '-'}`;
          m.topPlayer = tp.name || '-'; m.topPlayerScore = tp.score != null ? String(tp.score) : '-';
          return m;
        },
      },
      players: {
        title: '👥 Online Players',
        tokens: [T('count', 'Online count', '24'), T('max', 'Max players', '64'), T('onlineMax', 'Online / max', '24 / 64'), T('list', 'Numbered player list', '`01.` Jaruna\n`02.` Bandit\n`03.` Wolf\n`04.` Nomad'), T('namesCsv', 'Names (comma list)', 'Jaruna, Bandit, Wolf')],
        description: '{list}',
        defaults: [],
        resolve: (c) => { const m = base(c); m.onlineMax = `${c.count != null ? c.count : '-'} / ${c.max != null ? c.max : '-'}`; return m; },
      },
      bunker: {
        title: '🚪 Bunker Status',
        tokens: [T('activeCount', 'Open bunkers', '2'), T('lockedCount', 'Locked bunkers', '6'), T('activeSectors', 'Open sectors', 'A1, C3'), T('lockedSectors', 'Locked sectors', 'B2, D4'), T('activeList', 'Open list (all)', '🟢 `A1` — open since 2h ago\n🟢 `C3` — open since 40m ago'), T('lockedList', 'Locked list (all)', '🔒 `B2` — opens in 1h\n🔒 `D4` — opens in 3h\n🔒 `Z0` — locked')],
        defaults: [F('🟢 Open', 'activeList', false), F('🔒 Locked', 'lockedList', false)],
        resolve: (c) => base(c),
      },
      leaderboard: {
        title: '🏆 Leaderboard',
        dynamic: true,   // tokens/defaults built per request from the live categories
        resolve: (c) => {
          const m = base(c);   // weekly, scope
          for (const cat of (c.categories || [])) { if (cat && cat.key) { m['lb_' + cat.key] = cat.value; m['lb_' + cat.key + '_top'] = cat.top || '-'; } }
          return m;
        },
      },
    };

    // The kill / event-kill feeds ship in two flavours: an admin feed (with Steam IDs) and a
    // player-facing feed (no IDs). The manager tags them as separate kinds so each is styled on its own.
    CATALOG.kill_public = CATALOG.kill;
    CATALOG.eventkill_public = CATALOG.eventkill;

    const KIND_META = [
      { key: 'kill', label: 'Player Kill (admin)', group: 'feeds' }, { key: 'kill_public', label: 'Player Kill (public)', group: 'feeds' },
      { key: 'eventkill', label: 'Event Kill (admin)', group: 'feeds' }, { key: 'eventkill_public', label: 'Event Kill (public)', group: 'feeds' },
      { key: 'economy', label: 'Economy', group: 'feeds' }, { key: 'chest', label: 'Chest', group: 'feeds' },
      { key: 'raid', label: 'Raid Protection', group: 'feeds' }, { key: 'login', label: 'Login / Logout', group: 'feeds' },
      { key: 'admin', label: 'Admin', group: 'feeds' }, { key: 'gameplay', label: 'Gameplay', group: 'feeds' },
      { key: 'fame', label: 'Fame Points', group: 'feeds' }, { key: 'quest', label: 'Quest', group: 'feeds' },
      { key: 'vehicle', label: 'Vehicle', group: 'feeds' }, { key: 'violation', label: 'Violation', group: 'feeds' },
      { key: 'status', label: 'Server Status', group: 'live' }, { key: 'leaderboard', label: 'Leaderboard', group: 'live' },
      { key: 'players', label: 'Players', group: 'live' }, { key: 'bunker', label: 'Bunkers', group: 'live' },
    ];

    // ── what the manager's embeds REALLY look like ──────────────────────────────
    // The manager can hand over the actual shape of every embed it sends — the last one it really
    // sent, or one built by its own builder. That is the only description that is translated like
    // the real thing, carries the conditional fields, and formats values the way they go out
    // ("2.0 hours", not 7200). Anything written here instead would be an English-only copy that
    // drifts the moment a builder changes, so the manager wins wherever it can answer.
    function realKinds() {
      try {
        if (!host.discord || typeof host.discord.embedKinds !== 'function') return null;   // older manager
        const list = host.discord.embedKinds();
        return Array.isArray(list) && list.length ? list : null;
      } catch (e) { host.logger.debug('embedKinds unavailable: ' + e.message); return null; }
    }

    /**
     * Turn a real embed into an editable template: where a field's text is exactly the value of a
     * token, write the token back in so the owner can edit it as `{playerName}` rather than a frozen
     * name. Only whole-value matches, and only values long enough to be unambiguous — a partial
     * substitution would corrupt text that merely happens to contain "1".
     */
    function templateFromSample(sample, tokens) {
      if (!sample || !Array.isArray(sample.fields)) return [];
      const byValue = new Map();
      for (const tk of (tokens || [])) {
        const v = tk && tk.value != null ? String(tk.value) : '';
        if (v.length >= 3 && !byValue.has(v)) byValue.set(v, tk.t);
      }
      return sample.fields.map((f) => {
        const val = String(f.value == null ? '' : f.value);
        const tok = byValue.get(val);
        return { name: f.name, value: tok ? '{' + tok + '}' : val, inline: !!f.inline };
      });
    }

    /** Kinds as the UI needs them, sourced from the manager. */
    function kindsFromManager(list) {
      const GROUP_LABEL = { feeds: 'Feeds', live: 'Live embeds', notifications: 'Notifications', dm: 'Player DM alerts', intel: 'Player Intel' };
      return list.map((k) => {
        const own = (k.tokens || []).map((tk) => ({ t: tk.t, label: tk.label || tk.t, sample: tk.value, group: 'This embed' }));
        const seen = {}; own.forEach((tk) => { seen[tk.t] = 1; });
        // The manager's registry already carries the whole {stat_*} set, so there is nothing to
        // prepend here — a local copy would only shadow it with the same names.
        const extra = globalTokenCatalog().filter((tk) => { if (seen[tk.t]) return false; seen[tk.t] = 1; return true; });
        return {
          key: k.key,
          label: k.label,
          group: k.group,
          groupLabel: GROUP_LABEL[k.group] || k.group,
          live: !!k.live,                       // shape came from an embed the manager really sent
          seenAt: k.at || null,
          tokens: own.concat(extra),
          defaults: templateFromSample(k.sample, k.tokens),
          sample: k.sample || null,             // the real embed, for the preview
          description: (k.sample && k.sample.description) || null,
          title: (k.sample && k.sample.title) || null,
          styleOnly: false,
        };
      });
    }

    // Build the serialisable kind list for the UI (leaderboard is expanded from live categories).
    function kindsForConfig() {
      const real = realKinds();
      if (real) return kindsFromManager(real);
      // Fallback for a manager without the introspection API: the local descriptions below. Less
      // accurate by construction — kept only so the tab still works rather than going blank.
      return KIND_META.map((k) => {
        const c = CATALOG[k.key] || {};
        let tokens = c.tokens || [];
        let defaults = c.defaults || [];
        if (c.dynamic && k.key === 'leaderboard') {
          const cats = lbCategories();
          tokens = [T('scope', 'Scope (Weekly / All-time)', 'All-time')];
          defaults = [];
          for (const cat of cats) {
            tokens.push(T('lb_' + cat.key, (cat.label || cat.key) + ' — top 5', '`1.` Jaruna — 142\n`2.` Bandit — 98\n`3.` Wolf — 76\n`4.` Nomad — 51\n`5.` Rex — 33'));
            tokens.push(T('lb_' + cat.key + '_top', (cat.label || cat.key) + ' — #1', 'Jaruna'));
            defaults.push(F((cat.emoji ? cat.emoji + ' ' : '') + (cat.label || cat.key), 'lb_' + cat.key, false));
          }
        }
        // This embed's own event tokens (grouped) + the full global data set, so anything is insertable.
        const evtToks = (tokens || []).map((tk) => Object.assign({}, tk, { group: tk.group || 'This embed' }));
        const seen = {}; evtToks.forEach((tk) => { seen[tk.t] = 1; });
        // The per-player stat set ({stat_*}) comes from the manager's registry along with
        // everything else, so every kind gets it without a list here.
        const extra = globalTokenCatalog();
        const allToks = evtToks.concat(extra.filter((tk) => { if (seen[tk.t]) return false; seen[tk.t] = 1; return true; }));
        return { key: k.key, label: k.label, group: k.group, tokens: allToks, defaults: defaults, description: c.description || null, title: c.title || null, styleOnly: false };
      });
    }

    // ── resolution + apply ──────────────────────────────────────────────────────
    const loadStyles = () => host.store.get('styles', {});
    function tokenMapFor(kind, ctx) {
      try {
        const c = CATALOG[kind];
        const evt = (c && c.resolve) ? (c.resolve(ctx || {}) || {}) : base(ctx || {});
        return Object.assign(globalMapCached(), evt);   // every embed can use the global data too; event data wins on overlap
      } catch (e) { host.logger.warn(`resolve(${kind}) failed: ${e.message}`); return {}; }
    }
    function resolveTpl(tpl, m) {
      return String(tpl == null ? '' : tpl)
        // item helpers with a parameter: {img:<itemId>} → image URL, {itemName:<itemId>} → display name
        .replace(/\{img:([^}]+)\}/g, (_, code) => { try { return host.items.image(code.trim()) || ''; } catch { return ''; } })
        .replace(/\{itemName:([^}]+)\}/g, (_, code) => { try { return host.items.name(code.trim()) || code.trim(); } catch { return code.trim(); } })
        // any player's stat: {pstat:<name>:<field>} e.g. {pstat:Jaruna:Kills}
        .replace(/\{pstat:([^:}]+):([^}]+)\}/g, (_, name, field) => {
          try { const s = host.players.statsByName(name.trim()); if (!s) return ''; const f = field.trim().toLowerCase(); const key = Object.keys(s).find((k) => k.toLowerCase() === f); return (key != null && s[key] != null) ? String(s[key]) : ''; } catch { return ''; }
        })
        .replace(/\{(\w+)\}/g, (_, k) => (m[k] != null ? m[k] : ''));
    }
    function resolveModel(model, m) {
      const r = JSON.parse(JSON.stringify(model || {}));
      if (r.title) r.title = resolveTpl(r.title, m);
      if (r.description) r.description = resolveTpl(r.description, m);
      if (r.author && r.author.name) r.author.name = resolveTpl(r.author.name, m);
      if (Array.isArray(r.fields)) r.fields = r.fields.map((f) => ({ name: resolveTpl(f && f.name, m), value: resolveTpl(f && f.value, m), inline: !!(f && f.inline) }));
      return r;
    }

    function applyStyle(embed, kind, ctx) {
      const entry = loadStyles()[kind];
      if (!entry || !entry.enabled || !entry.model || !editor) return embed;
      const m = tokenMapFor(kind, ctx);
      const e = editor.apiEmbed(resolveModel(entry.model, m));
      if (!e) return embed;
      try {
        if (typeof e.color === 'number') embed.setColor(e.color);
        if (clean(e.title)) embed.setTitle(e.title);
        if (clean(e.description)) embed.setDescription(e.description);
        if (e.author && clean(e.author.name)) embed.setAuthor({ name: e.author.name, url: clean(e.author.url), iconURL: clean(e.author.icon_url) });
        if (e.thumbnail && clean(e.thumbnail.url)) embed.setThumbnail(e.thumbnail.url);
        if (e.image && clean(e.image.url)) embed.setImage(e.image.url);
        if (entry.fields) {
          embed.setFields((Array.isArray(e.fields) ? e.fields : []).filter((f) => clean(f.value)).slice(0, 25));
        }
      } catch (err) { host.logger.warn(`applyStyle(${kind}) failed: ${err.message}`); }
      return embed;
    }

    // Live embeds carry the image you configured in the manager. Remember it (per kind) so the
    // editor preview can show it — the manager sets it on the embed, we just read it back.
    const LIVE = ['status', 'leaderboard', 'players', 'bunker'];
    function captureImage(kind, embed) {
      if (LIVE.indexOf(kind) < 0) return;
      try {
        const url = embed && embed.data && embed.data.image && embed.data.image.url;
        if (!url) return;
        const im = host.store.get('liveImages', {});
        if (im[kind] !== url) { im[kind] = url; host.store.set('liveImages', im); }
      } catch { /* best-effort */ }
    }

    // Register a transform for EVERY kind the manager reports, not a list kept here. The two used
    // to be the same 18 entries; the moment the manager gained notification, DM-alert and intel
    // kinds, a style saved against one of those would have been listed in the UI, saved to the
    // store, and then silently never applied — the failure would look like "the plugin ignores me".
    const styleable = (() => {
      const real = realKinds();
      if (real) return real.map((k) => k.key);
      return KIND_META.map((k) => k.key);
    })();
    styleable.forEach((key) => host.discord.onEmbed(key, (embed, ctx) => { captureImage(key, embed); return applyStyle(embed, key, ctx); }));
    host.logger.info(`embed styling active for ${styleable.length} embed kind(s)`);

    host.routes.get('/config', (req, res) => {
      let configured = {}; try { configured = host.discord.liveEmbedImages() || {}; } catch { /* optional */ }
      res.json({ kinds: kindsForConfig(), styles: loadStyles(), liveImages: host.store.get('liveImages', {}), configuredImages: configured });
    });
    host.routes.post('/config', (req, res) => {
      const body = req.body || {};
      if (body.styles && typeof body.styles === 'object') host.store.set('styles', body.styles);
      res.json({ ok: true });
    });

    // ── Custom live embeds ──────────────────────────────────────────────────────
    // Design your own embed, point it at a channel + refresh interval, and the plugin keeps ONE
    // message there up to date (edits it in place) with live server data — just like the built-in
    // status embed. Tokens resolve from a GLOBAL data map (all sources), so you can put anything in.

    // Short cache so a burst of feed embeds (e.g. many kills) doesn't re-query the DB each time.
    let _gm = null; let _gmAt = 0;
    /**
     * Token name → current value.
     *
     * Prefers the manager's registry (host.data), which is the same set the picker lists, so a
     * token that appears in the picker always resolves.
     * fallback for a manager that predates it — it resolves fewer names, which is precisely the
     * drift this replaced.
     */
    function globalMapCached() {
      const now = Date.now();
      if (_gm && (now - _gmAt) < 5000) return _gm;
      const m = {};
      try {
        for (const t of host.data.catalog({})) { if (!t.parametric) m[t.key] = t.value; }
      } catch (e) {
        host.logger.error('host.data is unavailable — tokens cannot resolve: ' + e.message);
      }
      _gm = m;
      _gmAt = now;
      return _gm;
    }
    /**
     * Every token the MANAGER knows about, with its current value.
     *
     * This used to be a hand-written list of ~50 names with invented sample text, kept in step with
     * a second hand-written function that resolved them — two lists, in this plugin, that any other
     * plugin wanting the same data would have had to copy. The manager now owns one registry
     * (host.data), so a token is declared once, the value shown in the picker is the real current
     * one, and anything a plugin publishes shows up here too.
     */
    function globalTokenCatalog() {
      try {
        return host.data.catalog({})
          .map((t) => ({ t: t.key, label: t.label, sample: t.value, group: t.group, live: t.live !== false }));
      } catch (e) {
        // No local copy to fall back to, on purpose: a second list is what this replaced, and a
        // silent half-catalog is worse than an empty one that says why.
        host.logger.error('host.data is unavailable — this plugin needs a manager that provides it: ' + e.message);
        return [];
      }
    }


    const loadCustom = () => host.store.get('custom', []);
    const lastPost = {};
    async function refreshCustom(ce, force) {
      if (!ce || !ce.channelId || !ce.model || ce.enabled === false || !editor) return;
      const interval = Math.max(15, ce.intervalSec || 60) * 1000;
      if (!force && lastPost[ce.id] && (Date.now() - lastPost[ce.id]) < interval) return;
      lastPost[ce.id] = Date.now();
      try {
        const e = editor.apiEmbed(resolveModel(ce.model, globalMapCached()));
        if (!e) return;
        const embed = host.discord.js.EmbedBuilder.from(e);
        const comps = (editor.components && ce.model.buttons && ce.model.buttons.length) ? editor.components(ce.model.buttons) : [];
        const payload = { embeds: [embed] }; if (comps.length) payload.components = comps;
        const ch = await host.discord.channel(ce.channelId);
        if (!ch || !ch.send) return;
        const ids = host.store.get('customMsg', {});
        if (ids[ce.id]) {
          try { const msg = await ch.messages.fetch(ids[ce.id]); await msg.edit(payload); return; }
          catch { /* message deleted → repost below */ }
        }
        const sent = await ch.send(payload);
        if (sent && sent.id) { ids[ce.id] = sent.id; host.store.set('customMsg', ids); }
      } catch (err) { host.logger.warn(`custom embed "${ce.id}" failed: ${err.message}`); }
    }
    host.schedule.every(15000, () => { for (const ce of loadCustom()) refreshCustom(ce, false); });

    // ── button actions: a custom-embed button can run an in-game command or reply ────────────────
    // One dispatcher (no double-registration): match the clicked button's custom_id to a configured
    // action across all custom embeds. In-game commands go through host.server.command (SSA Bridge,
    // Premium + server-authorised) — a button cannot bypass that.
    host.discord.onInteraction(async (i) => {
      try {
        if (!i.isButton || !i.isButton()) return;
        const cid = i.customId;
        let act = null;
        for (const ce of loadCustom()) { if (ce.actions && ce.actions[cid]) { act = ce.actions[cid]; break; } }
        if (!act || !act.type) return;
        const m = globalMapCached();
        if (act.type === 'command') {
          await i.reply({ content: '⏳ Running…', ...EPHEMERAL });
          let ok = false; try { const r = await host.server.command(resolveTpl(act.value || '', m)); ok = !(r && r.ok === false); } catch { ok = false; }
          try { await i.editReply({ content: ok ? '✅ Done.' : '❌ Command failed (server / bridge?).' }); } catch {}
        } else if (act.type === 'message') {
          await i.reply({ content: resolveTpl(act.value || '…', m) || '…', ephemeral: act.ephemeral !== false });
        } else if (act.type === 'announce') {
          const ch = await host.discord.channel(act.channelId || i.channelId);
          if (ch && ch.send) await ch.send(resolveTpl(act.value || '', m) || '…');
          await i.reply({ content: '✅ Sent.', ...EPHEMERAL });
        }
      } catch (e) { try { if (i && !i.replied && i.reply) await i.reply({ content: 'Action error.', ...EPHEMERAL }); } catch {} }
    });

    host.routes.get('/custom', (req, res) => res.json({ items: loadCustom(), tokens: globalTokenCatalog() }));
    host.routes.post('/custom', (req, res) => {
      const b = req.body || {};
      if (Array.isArray(b.items)) {
        // drop message-ids for removed embeds so they can be re-created cleanly
        const keep = {}; b.items.forEach((x) => { keep[x.id] = 1; });
        const ids = host.store.get('customMsg', {}); for (const k of Object.keys(ids)) if (!keep[k]) delete ids[k];
        host.store.set('customMsg', ids);
        host.store.set('custom', b.items);
      }
      res.json({ ok: true });
    });
    host.routes.post('/custom/post', async (req, res) => {
      const id = (req.body || {}).id;
      const ce = loadCustom().find((x) => x.id === id);
      if (!ce) return res.status(404).json({ error: 'not_found' });
      await refreshCustom(ce, true);
      res.json({ ok: true });
    });

    // Expose the live server-data resolver so ANY other plugin can reuse it (host.consume('server-data')):
    //   const sd = host.consume('server-data');
    //   sd.data();                 → { token: value } snapshot (online, gameTime, topPlayer, lb_*, …)
    //   sd.resolve('Online: {online}/{max} · {gameTime}')   → filled string
    //   sd.catalog();              → [{ t, label, sample, group }] for building a token picker
    host.provide('server-data', {
      data: () => globalMapCached(),
      resolve: (tpl) => resolveTpl(tpl, globalMapCached()),
      catalog: () => globalTokenCatalog(),
    });

    host.logger.info(`styling half ready (${KIND_META.length} embed kinds + custom live embeds + server-data service)`);
  },
};
