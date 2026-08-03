'use strict';

// Embed Styler — a real editor for the manager's OWN embeds.
//
// Each embed "kind" has a CATALOG: data tokens (friendly label + a sample value used only for the
// live preview) and a default template (fields and/or a description). The catalog is available
// immediately — no waiting for an event — so picking a kind loads an editable layout that mirrors
// the real embed. Change colour/title, and (with "Replace fields" on) add / remove / reorder fields
// using {tokens}; the editor's preview shows the sample values so it reads like the real message.
//
// At send time each kind's resolver turns {tokens} into live values — from the event/live ctx the
// manager passes AND from the manager itself (squad/fame by Steam id, top player, etc.). Footer,
// timestamp and buttons stay manager-controlled — nothing here can bypass a premium feature.

function clean(v) { return (typeof v === 'string' && v.trim() !== '') ? v : undefined; }

module.exports = {
  async register(host) {
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
    // The full set of per-player stat fields (survival, combat, fishing, animals, crafting, money,
    // gold…). Every one becomes {stat_<Field>} on a player-centric embed. Used as a fallback list
    // for the token picker; the live fields are read from a real player when one is available.
    const STAT_FIELDS = ['FamePoints', 'Money', 'cash', 'bank', 'gold', 'Level', 'Xp', 'Score', 'PlayTime', 'MinutesSurvived', 'LastLogin', 'LastLogout',
      'Kills', 'Deaths', 'PvpKills', 'PvpDeaths', 'FirearmKills', 'MeleeKills', 'ArcheryKills', 'BareHandedKills', 'DroneKills', 'SentryKills', 'TeamKills',
      'EventKills', 'EventDeaths', 'EventsWon', 'EventsLost', 'Wins', 'Headshots', 'Assists', 'Captures', 'CtfCaptures', 'ZombieKills', 'PuppetsKO',
      'AnimalKills', 'AnimalsSkinned', 'LongestKill', 'LongestAnimalKill', 'ShotsFired', 'ShotsHit', 'MeleeHits', 'MeleeSwings', 'KnockedOut', 'Looted',
      'ItemsPickedUp', 'ItemsStored', 'LocksPicked', 'DoorsClaimed', 'FoliageCut', 'LinesBroken', 'Crafted', 'ArrowsCrafted', 'BulletsCrafted', 'GunsCrafted',
      'MeleeCrafted', 'ClothingCrafted', 'Distance', 'SwimDistance', 'VehicleDistance', 'BoatDistance', 'Calories', 'FoodEaten', 'LiquidDrank', 'AlcoholDrank',
      'MushroomsEaten', 'Starvations', 'Overdoses', 'HeartAttacks', 'Diarrheas', 'Vomits', 'Defecations', 'Urinations', 'TeethLost', 'WoundsPatched',
      'FishCaught', 'FishKept', 'FishReleased', 'HeaviestFish', 'LongestFish', 'AmurCaught', 'BassCaught', 'BleakCaught', 'CarpCaught', 'CatfishCaught',
      'ChubCaught', 'CrucianCarpCaught', 'DentexCaught', 'OrataCaught', 'PikeCaught', 'PrussianCarpCaught', 'RuffeCaught', 'SardineCaught', 'TunaCaught',
      'BearsKilled', 'BearMaulings', 'BoarsKilled', 'ChickensKilled', 'CrowsKilled', 'DeersKilled', 'DonkeysKilled', 'GoatsKilled', 'HorsesKilled',
      'RabbitsKilled', 'SeagullsKilled', 'WolvesKilled', 'SharkBites', 'SharkEscapes'];
    function humanizeField(k) { return String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (ch) => ch.toUpperCase()); }
    function sampleSteamId() {
      try { const on = host.players.online() || []; for (const p of on) { const s = p.SteamID || p.steamId || p.UserId || p.user_id; if (s) return String(s); } } catch {}
      return null;
    }
    // Player-stat tokens for the picker: the LIVE fields (with real sample values) of a real player
    // when one exists, else the full fallback list.
    const STAT_SKIP = /^(Name|SteamID|Id|Class|Information|Message|Squad|SquadId|SquadName|OwnerProfileId|IsOnline|online|alive|x|y|z|type|pin|pinTries|rank|record|renewals|memberCount|MemberLimit|accountNumber|depositLeft|withdrawLeft|lastLogin|lastLogout|LastLogin|LastLogout)$/i;
    function statTokens() {
      let stats = null;
      try { const sid = sampleSteamId(); if (sid) stats = host.players.stats(sid); } catch {}
      const keys = (stats ? Object.keys(stats).filter((k) => (typeof stats[k] === 'number' || typeof stats[k] === 'string') && !STAT_SKIP.test(k)) : STAT_FIELDS);
      return keys.map((k) => T2('stat_' + k, humanizeField(k) + ' (this embed’s player)', stats && stats[k] != null ? String(stats[k]) : '0', 'Player stats'));
    }

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

    // Build the serialisable kind list for the UI (leaderboard is expanded from live categories).
    function kindsForConfig() {
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
        // player-centric embeds also get the FULL per-player stat set (survival, combat, gold…)
        const PLAYER_KINDS = ['login', 'kill', 'eventkill', 'chest', 'fame', 'quest', 'violation', 'economy'];
        let extra = globalTokenCatalog();
        if (PLAYER_KINDS.indexOf(k.key) >= 0) extra = statTokens().concat(extra);
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

    KIND_META.forEach((k) => host.discord.onEmbed(k.key, (embed, ctx) => { captureImage(k.key, embed); return applyStyle(embed, k.key, ctx); }));

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

    function globalMap() {
      const m = {};
      try {
        const s = host.server.status() || {};
        const online = s.OnlinePlayers != null ? s.OnlinePlayers : (host.stats.onlineCount() || 0);
        m.state = s.ActualServerState || s.Status || (s.IsRunning ? 'Online' : 'Offline');
        m.running = s.IsRunning ? 'Online' : 'Offline';
        m.online = String(online); m.max = s.MaxPlayers != null ? String(s.MaxPlayers) : '-';
        m.onlineMax = `${online} / ${s.MaxPlayers != null ? s.MaxPlayers : '-'}`;
        const p = s.Performance || {};
        if (p.FPS != null) { m.fps = `${p.FPS} FPS`; m.fpsNum = String(p.FPS); }
        if (p.CPU != null) m.cpu = `${p.CPU}%`;
        if (p.Memory != null) m.memory = `${p.Memory} MB`;
        if (p.MemoryTotal != null) m.memoryTotal = `${p.MemoryTotal} MB`;
        if (p.Entities != null) m.entities = String(p.Entities);
      } catch { /* optional */ }
      try { const gt = host.stats.gameTime(); if (gt) { m.gameTime = gt.FormattedTime || '-'; if (gt.TimeOfDay != null) m.timeOfDay = String(Math.round(gt.TimeOfDay * 10) / 10); } } catch {}
      try { const wt = host.stats.weather(); if (wt) { m.temperature = wt.FormattedTemperature || '-'; if (wt.AirTemperature != null) m.airTemp = `${wt.AirTemperature}°C`; if (wt.WaterTemperature != null) m.waterTemp = `${wt.WaterTemperature}°C`; } } catch {}
      try { const st = host.stats.server(); if (st) { if (st.TotalPlayers != null) m.totalPlayers = String(st.TotalPlayers); if (st.DatabaseSize != null) m.dbSize = `${st.DatabaseSize} MB`; } } catch {}
      try { m.activeSquads = String(host.stats.squadCount() || 0); m.vehicles = String(host.stats.vehicleCount() || 0); m.bases = String(host.stats.baseCount() || 0); } catch {}
      try { const tp = topPlayer(); m.topPlayer = tp.name || '-'; m.topPlayerScore = tp.score != null ? String(tp.score) : '-'; } catch {}
      try {
        const online = host.players.online() || [];
        const names = online.map((p) => p.PlayerName || p.name || '?');
        m.onlineCount = String(names.length); m.onlineNames = names.join(', ') || '—';
        m.onlineList = names.map((n, i) => '`' + String(i + 1).padStart(2, '0') + '.` ' + n).join('\n') || '—';
      } catch {}
      try {
        const all = host.leaderboards.all(10) || {};
        for (const key of Object.keys(all)) {
          const rows = all[key] || [];
          m['lb_' + key] = rows.map((r, i) => '`' + (i + 1) + '.` ' + (r.Name || r.name || '?') + ' — ' + (r.FormattedValue != null ? r.FormattedValue : (r.value != null ? r.value : ''))).join('\n') || '—';
          m['lb_' + key + '_top'] = (rows[0] && (rows[0].Name || rows[0].name)) || '-';
        }
      } catch {}
      try {
        const si = host.server.info() || {};
        if (si.name) m.serverName = si.name;
        if (si.address) m.serverAddress = si.address;
        if (si.publicIP) m.publicIP = si.publicIP;
        if (si.port != null) m.port = String(si.port);
        if (si.connectPort != null) m.connectPort = String(si.connectPort);
        if (si.version) m.managerVersion = 'v' + si.version;
        if (si.nextRestartUnix) { m.nextRestart = `<t:${si.nextRestartUnix}:R>`; m.nextRestartAt = `<t:${si.nextRestartUnix}:t>`; }
      } catch {}
      try {
        const w = host.map.world() || {};
        if (Array.isArray(w.players)) m.mapPlayers = String(w.players.length);
        if (Array.isArray(w.vehicles)) m.mapVehicles = String(w.vehicles.length);
        if (Array.isArray(w.bases)) m.mapBases = String(w.bases.length);
        if (Array.isArray(w.chests)) m.mapChests = String(w.chests.length);
        if (Array.isArray(w.flags)) m.mapFlags = String(w.flags.length);
      } catch {}
      try {
        const e = host.economy;
        if (e) {
          if (e.traderFunds) { const v = e.traderFunds(); if (typeof v === 'number' || typeof v === 'string') m.traderFunds = String(v); }
          if (e.goldCapacity) { const g = e.goldCapacity(); if (typeof g === 'number' || typeof g === 'string') m.goldCapacity = String(g); }
          if (e.specialDeals) { const sd = e.specialDeals(10); if (Array.isArray(sd) && sd.length) m.specialDeals = sd.map((d) => '• ' + (d.name || d.item || d.Item || d.itemName || '?') + (d.price != null ? ' — ' + d.price : (d.Price != null ? ' — ' + d.Price : ''))).join('\n'); }
        }
      } catch {}
      try {
        const bk = (host.map.bunkers && host.map.bunkers()) || [];
        const active = bk.filter((b) => b.state === 'active');
        const locked = bk.filter((b) => b.state !== 'active');
        m.bunkerActive = String(active.length); m.bunkerLocked = String(locked.length);
        m.bunkerActiveSectors = active.map((b) => b.sector).join(', ') || '—';
        m.bunkerLockedSectors = locked.map((b) => b.sector).join(', ') || '—';
        m.bunkerActiveList = active.map((b) => '🟢 `' + b.sector + '`' + (b.activationUnix ? ' — open since <t:' + b.activationUnix + ':R>' : '')).join('\n') || '—';
        m.bunkerLockedList = locked.map((b) => '🔒 `' + b.sector + '`' + ((b.etaUnix || b.eta) ? ' — opens <t:' + (b.etaUnix || b.eta) + ':R>' : ' — locked')).join('\n') || '—';
      } catch {}
      try {
        const kills = (host.db && host.db.manager && host.db.manager.kills(10)) || [];
        if (kills.length) {
          m.recentKills = kills.map((k) => '💀 ' + (k.killer || '?') + ' → ' + (k.victim || '?') + (k.weapon ? ' (' + (host.items.name(k.weapon) || k.weapon) + ')' : '')).join('\n');
          m.lastKiller = kills[0].killer || '-'; m.lastVictim = kills[0].victim || '-';
        }
      } catch {}
      try {
        const trades = (host.db && host.db.manager && host.db.manager.trades(10)) || [];
        if (trades.length) m.recentTrades = trades.map((t) => '💰 ' + (t.player || '?') + ' ' + (t.action || '') + ' ' + (host.items.name(t.item || t.code) || t.item || t.code || '?') + (t.price != null ? ' — ' + t.price : '')).join('\n');
      } catch {}
      return m;
    }
    // Short cache so a burst of feed embeds (e.g. many kills) doesn't re-query the DB each time.
    let _gm = null; let _gmAt = 0;
    function globalMapCached() { const now = Date.now(); if (_gm && (now - _gmAt) < 5000) return _gm; _gm = globalMap(); _gmAt = now; return _gm; }
    function globalTokenCatalog() {
      const toks = [
        T2('state', 'Server state', 'Online', 'Server'), T2('running', 'Online / Offline', 'Online', 'Server'), T2('online', 'Online players', '24', 'Server'), T2('max', 'Max players', '64', 'Server'),
        T2('onlineMax', 'Online / max', '24 / 64', 'Server'), T2('fps', 'Server FPS', '58 FPS', 'Server'), T2('fpsNum', 'Server FPS (number)', '58', 'Server'),
        T2('cpu', 'CPU load', '34%', 'Server'), T2('memory', 'Memory used', '9200 MB', 'Server'), T2('memoryTotal', 'Memory total', '16384 MB', 'Server'),
        T2('entities', 'Entities (world)', '18450', 'Server'), T2('dbSize', 'Database size', '512 MB', 'Server'),
        T2('gameTime', 'In-game time', '14:32', 'Time & Weather'), T2('timeOfDay', 'Time of day (hours)', '14.5', 'Time & Weather'),
        T2('temperature', 'Temperature (A | W)', 'A: 18 | W: 12', 'Time & Weather'), T2('airTemp', 'Air temperature', '18°C', 'Time & Weather'), T2('waterTemp', 'Water temperature', '12°C', 'Time & Weather'),
        T2('totalPlayers', 'Registered players', '1043', 'Counts'), T2('activeSquads', 'Active squads', '37', 'Counts'), T2('vehicles', 'Vehicles', '312', 'Counts'), T2('bases', 'Bases', '184', 'Counts'),
        T2('topPlayer', 'Top player', 'Jaruna', 'Top'), T2('topPlayerScore', 'Top player score', '142', 'Top'),
        T2('onlineCount', 'Online count', '24', 'Players'), T2('onlineList', 'Online list (numbered)', '`01.` Jaruna\n`02.` Bandit', 'Players'), T2('onlineNames', 'Online names (CSV)', 'Jaruna, Bandit', 'Players'),
        T2('serverName', 'Server name', 'My SCUM Server', 'Server info'), T2('serverAddress', 'Connect address', '203.0.113.5:7044', 'Server info'), T2('publicIP', 'Public IP', '203.0.113.5', 'Server info'),
        T2('port', 'Game port', '7042', 'Server info'), T2('connectPort', 'Connect port', '7044', 'Server info'), T2('managerVersion', 'Manager version', 'v3.1.1', 'Server info'),
        T2('nextRestart', 'Next restart (relative)', 'in 3 hours', 'Server info'), T2('nextRestartAt', 'Next restart (time)', '18:00', 'Server info'),
        T2('mapPlayers', 'Players on map', '24', 'Map'), T2('mapVehicles', 'Vehicles on map', '312', 'Map'), T2('mapBases', 'Bases on map', '184', 'Map'), T2('mapChests', 'Chests on map', '540', 'Map'), T2('mapFlags', 'Flags on map', '96', 'Map'),
        T2('traderFunds', 'Trader funds', '1.2M', 'Economy'), T2('goldCapacity', 'Gold capacity', '5000', 'Economy'), T2('specialDeals', 'Special deals (list)', '• Bandage — 500\n• Ammo — 1200', 'Economy'),
        T2('bunkerActive', 'Open bunkers (count)', '2', 'Bunkers'), T2('bunkerLocked', 'Locked bunkers (count)', '6', 'Bunkers'),
        T2('bunkerActiveSectors', 'Open sectors', 'A1, C3', 'Bunkers'), T2('bunkerLockedSectors', 'Locked sectors', 'B2, D4', 'Bunkers'),
        T2('bunkerActiveList', 'Open bunkers (list)', '🟢 `A1` — open', 'Bunkers'), T2('bunkerLockedList', 'Locked bunkers (list)', '🔒 `B2` — opens soon', 'Bunkers'),
        T2('recentKills', 'Recent kills (list)', '💀 Jaruna → Bandit (M16A4)\n💀 Wolf → Nomad (AK-47)\n💀 Rex → Ghost (Crossbow)\n💀 Ace → Kilo (M9)\n💀 Zed → Vex (Katana)', 'Activity'), T2('lastKiller', 'Last killer', 'Jaruna', 'Activity'), T2('lastVictim', 'Last victim', 'Bandit', 'Activity'),
        T2('recentTrades', 'Recent trades (list)', '💰 Jaruna bought Bandage — 500\n💰 Wolf sold Gold Bar — 12000\n💰 Rex bought 7.62mm — 1200', 'Activity'),
        T2('img:ITEM_ID', 'Item image URL — replace ITEM_ID (e.g. Weapon_AK47)', 'https://…/Weapon_AK47.png', 'Items'),
        T2('itemName:ITEM_ID', 'Item name — replace ITEM_ID', 'AK-47', 'Items'),
        T2('pstat:PLAYER:FIELD', 'Any player stat — e.g. {pstat:Jaruna:Kills}', '142', 'Player stats'),
      ];
      for (const c of lbCategories()) {
        toks.push(T2('lb_' + c.key, (c.label || c.key) + ' — top 5', '`1.` Jaruna — 142\n`2.` Bandit — 98\n`3.` Wolf — 76\n`4.` Nomad — 51\n`5.` Rex — 33', 'Leaderboard'));
        toks.push(T2('lb_' + c.key + '_top', (c.label || c.key) + ' — #1', 'Jaruna', 'Leaderboard'));
      }
      return toks;
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
          await i.reply({ content: '⏳ Running…', ephemeral: true });
          let ok = false; try { const r = await host.server.command(resolveTpl(act.value || '', m)); ok = !(r && r.ok === false); } catch { ok = false; }
          try { await i.editReply({ content: ok ? '✅ Done.' : '❌ Command failed (server / bridge?).' }); } catch {}
        } else if (act.type === 'message') {
          await i.reply({ content: resolveTpl(act.value || '…', m) || '…', ephemeral: act.ephemeral !== false });
        } else if (act.type === 'announce') {
          const ch = await host.discord.channel(act.channelId || i.channelId);
          if (ch && ch.send) await ch.send(resolveTpl(act.value || '', m) || '…');
          await i.reply({ content: '✅ Sent.', ephemeral: true });
        }
      } catch (e) { try { if (i && !i.replied && i.reply) await i.reply({ content: 'Action error.', ephemeral: true }); } catch {} }
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

    host.logger.info(`Embed Styler ready (${KIND_META.length} embed kinds + custom live embeds + server-data service)`);
  },
};
