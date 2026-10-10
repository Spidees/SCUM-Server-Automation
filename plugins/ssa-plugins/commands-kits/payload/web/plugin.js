/* Chat Commands & Kits — admin UI.
 *
 * A cohesive, design-system-matched workspace with five views: Commands, Kits & Packs, Messages,
 * Players (claims), and Settings. Every backend feature is exposed: reply text + admin actions with a
 * click-to-insert token palette, cost / cooldown / groups / allow-deny, welcome message + packs, item /
 * vehicle / full-container pickers, per-player claim management. Talks only to its own backend under
 * /api/plugin-host/commands-kits. */
(function () {
  'use strict';

  /* The panel's own translator. The English second argument is what renders when a reader's
   * language has no line for that key, so this screen with no locale data at all reads exactly as
   * it reads today.
   *
   * Every label-bearing table below is a FUNCTION rather than a constant, and that is not a style
   * choice: a plugin's locale data is merged only once every plugin script has run, so a table
   * built at the top of this file would be English for ever.
   *
   * ⚠ NOTHING AN OWNER TYPES OR A PLAYER READS IN GAME GOES THROUGH IT. A command word, a reply
   * template, a kit name, a `{token}` and every spawn command are the owner's own data, saved and
   * sent to the game exactly as written; only the words this panel puts on the screen are keyed. */
  var T = SSA.t;
  // The words for "Offers 2 kits: …" — the same for its singular and its plural form.
  function offersVars(kits) {
    return {
      n: kits.length,
      list: kits.map(function (p) { return p.name || p.command || T('pl.commands-kits.unnamed', 'unnamed'); }).join(', '),
      switch: T('pl.commands-kits.kit.discord', 'Claim from Discord'),
    };
  }

  // Filled from /meta (with sane fallbacks so the UI works even if the call fails).
  var META = {
    channels: ['local', 'global', 'squad', 'admin', 'server'],
    currencies: ['free', 'money', 'gold', 'fame'],
    defaultMessages: {},
    messageGroups: {},
  };
  // Where the bridge's switches live, built from the PANEL's own keys (the nav entry and the tab
  // that render themselves from them), so the route is right in every language and after a rename.
  function bridgeWhere() {
    return T('nav.plugins', 'Plugins') + ' → ' + T('plugins.viewInGame', 'SSA Bridge');
  }
  // The live module's two switches the game clock needs, in the words the bridge card shows.
  function noGameClockText() {
    return T('pl.commands-kits.gw.noClockRoute', 'the game clock cannot be read. Turn on "{read}" and "{time}" in {where}.',
      { read: switchCaption('live', 'enabled', 'Read live player data'), time: switchCaption('live', 'time', 'Time of day and day length'), where: bridgeWhere() });
  }
  // A bridge switch's caption exactly as its card on the panel draws it: the panel's own
  // `mod.<module>.<key>` line when it has one, else the caption the bridge ships, which is English.
  function switchCaption(mod, key, english) {
    var k = ['mod', mod, key].join('.');
    return SSA.t(k, english);
  }
  // A failed spawn or a queued one, drawn from the parts the backend sends: the game's own name, the
  // count, and for a full container the item it is filled with. An older row is a plain string.
  function spawnLabel(v) {
    if (!v) return '';
    if (typeof v === 'string') return v;
    var base = v.fillName || v.fill
      ? T('pl.commands-kits.log.containerOf', '{container} filled with {fill}', { container: v.name || v.code || '', fill: v.fillName || v.fill })
      : (v.name || v.code || v.label || '') + (Number(v.count) > 1 ? ' ×' + v.count : '');
    return base;
  }
  function triggers() {
    return [['welcome', T('pl.commands-kits.trigger.welcome', 'On join (welcome)')],
      ['command', T('pl.commands-kits.trigger.command', 'Chat command')]];
  }
  function chLabels() {
    return {
      local: T('pl.commands-kits.channel.local', 'Local'),
      global: T('pl.commands-kits.channel.global', 'Global'),
      squad: T('pl.commands-kits.channel.squad', 'Squad'),
      admin: T('pl.commands-kits.channel.admin', 'Admin'),
      server: T('pl.commands-kits.channel.server', 'Server'),
    };
  }
  function curLabels() {
    return {
      free: T('pl.commands-kits.currency.free', 'Free'),
      money: T('pl.commands-kits.currency.money', 'Money'),
      gold: T('pl.commands-kits.currency.gold', 'Gold'),
      fame: T('pl.commands-kits.currency.fame', 'Fame'),
    };
  }
  /* THE FIVE SCREEN NAMES, IN ONE PLACE, BECAUSE THREE SENTENCES POINT AT THEM.
   *
   * "Switch it on for a kit in the Kits & Packs tab", "Watch it live on the Activity tab" and the
   * first-run note all name a screen this tab really has. A route written out a second time is a
   * route free to be wrong, and translating a written-out one multiplies one wrong sentence into
   * eighteen — so the buttons and the sentences that point at them read the SAME key. */
  function navLabels() {
    return {
      commands: T('pl.commands-kits.nav.commands', 'Commands'),
      packs: T('pl.commands-kits.nav.packs', 'Kits & Packs'),
      messages: T('pl.commands-kits.nav.messages', 'Messages'),
      activity: T('pl.commands-kits.nav.activity', 'Activity'),
      settings: T('pl.commands-kits.nav.settings', 'Settings'),
    };
  }
  // ⚠ THIS MAP IS THE LABEL, NEVER THE LIST. The screen used to draw exactly the keys named here,
  // so a message added in the backend had no field at all — `emptyKit` and `closed` were shipped
  // English that no owner could see or change, on a screen whose own heading promises every line a
  // player reads. The fields are drawn from the backend's own defaults now (`META.defaultMessages`),
  // and a key with no entry here gets its name humanised rather than disappearing.
  function msgLabels() {
    return {
      cooldown: T('pl.commands-kits.msglabel.cooldown', 'Cooldown not elapsed'),
      alreadyClaimed: T('pl.commands-kits.msglabel.alreadyClaimed', 'Already claimed (one-time)'),
      groupLocked: T('pl.commands-kits.msglabel.groupLocked', 'Locked by an exclusive group'),
      maxClaims: T('pl.commands-kits.msglabel.maxClaims', 'Claim limit reached'),
      notAllowed: T('pl.commands-kits.msglabel.notAllowed', 'Player not allowed'),
      insufficient: T('pl.commands-kits.msglabel.insufficient', "Can't afford it"),
      notInGame: T('pl.commands-kits.msglabel.notInGame', 'Not fully spawned in'),
      spawnFailed: T('pl.commands-kits.msglabel.spawnFailed', 'Delivery / spawn failed'),
      notLinked: T('pl.commands-kits.msglabel.notLinked', 'Account not linked to Discord'),
      emptyKit: T('pl.commands-kits.msglabel.emptyKit', 'Kit has nothing in it yet'),
      closed: T('pl.commands-kits.msglabel.closed', 'Outside its time window'),
      // Two windows, two lines, and they must stay two when this is translated: one is the clock on
      // the player's wall and the other is the hour it is inside the game, which on a server running
      // at eight game hours to the real one are nothing like each other.
      closedGame: T('pl.commands-kits.msglabel.closedGame', 'Outside its in-game time window'),
      partial: T('pl.commands-kits.msglabel.partial', 'Part of the kit did not arrive'),
      // The charge has THREE outcomes, so the sentence about it does too. Keep them apart when you
      // translate: one says the money definitely moved, one says it definitely did not, and one says
      // nobody can tell — and a player reading the wrong one goes to an admin for the wrong thing.
      partialUnpaid: T('pl.commands-kits.msglabel.partialUnpaid', 'Part did not arrive AND the payment was refused'),
      partialUnknown: T('pl.commands-kits.msglabel.partialUnknown', 'Part did not arrive AND the payment is unconfirmed'),
      spawnRefused: T('pl.commands-kits.msglabel.spawnRefused', 'The game refused the spawn (stale code)'),
      listCut: T('pl.commands-kits.msglabel.listCut', 'The list of who is online was cut'),
      // The words that go INSIDE the sentences above.
      poolMoney: T('pl.commands-kits.msglabel.poolMoney', '{pool} for a money price'),
      poolGold: T('pl.commands-kits.msglabel.poolGold', '{pool} for a gold price'),
      poolFame: T('pl.commands-kits.msglabel.poolFame', '{pool} for a fame price'),
      asofSave: T('pl.commands-kits.msglabel.asofSave', '{asof} when only the last save could answer'),
      curMoney: T('pl.commands-kits.msglabel.curMoney', '{currency} for money'),
      curGold: T('pl.commands-kits.msglabel.curGold', '{currency} for gold'),
      curFame: T('pl.commands-kits.msglabel.curFame', '{currency} for fame'),
      curFree: T('pl.commands-kits.msglabel.curFree', '{currency} for free'),
      windowGame: T('pl.commands-kits.msglabel.windowGame', '{window} for an in-game window'),
      windowGameSpeed: T('pl.commands-kits.msglabel.windowGameSpeed', '{speed} inside that line'),
      windowNeedsUpdate: T('pl.commands-kits.msglabel.windowNeedsUpdate', '{window} when the manager is too old'),
      // The Discord claim panel.
      discordLink: T('pl.commands-kits.msglabel.discordLink', 'Account not linked'),
      discordNone: T('pl.commands-kits.msglabel.discordNone', 'No kit can be claimed from Discord'),
      discordPick: T('pl.commands-kits.msglabel.discordPick', 'Text above the kit menu'),
      discordChoose: T('pl.commands-kits.msglabel.discordChoose', 'Kit menu placeholder'),
      discordFree: T('pl.commands-kits.msglabel.discordFree', 'Price of a free kit'),
      discordStale: T('pl.commands-kits.msglabel.discordStale', 'The kit list changed'),
      discordOffline: T('pl.commands-kits.msglabel.discordOffline', 'Player not in game'),
      discordDelivering: T('pl.commands-kits.msglabel.discordDelivering', 'Delivery in progress'),
      discordDone: T('pl.commands-kits.msglabel.discordDone', 'Kit delivered'),
      discordFailed: T('pl.commands-kits.msglabel.discordFailed', 'Claim failed'),
      discordError: T('pl.commands-kits.msglabel.discordError', 'Something went wrong'),
      discordNotAllowed: T('pl.commands-kits.msglabel.discordNotAllowed', 'Menu: player not allowed'),
      discordGroupLocked: T('pl.commands-kits.msglabel.discordGroupLocked', 'Menu: locked by a group'),
      discordMaxClaims: T('pl.commands-kits.msglabel.discordMaxClaims', 'Menu: claim limit reached'),
      discordCooldown: T('pl.commands-kits.msglabel.discordCooldown', 'Menu: on cooldown'),
      discordAlreadyClaimed: T('pl.commands-kits.msglabel.discordAlreadyClaimed', 'Menu: already claimed'),
      discordNotLinked: T('pl.commands-kits.msglabel.discordNotLinked', 'Menu: linked players only'),
      discordInflight: T('pl.commands-kits.msglabel.discordInflight', 'Menu: already on its way'),
      discordClosed: T('pl.commands-kits.msglabel.discordClosed', 'Menu: outside its time window'),
      discordClosedGame: T('pl.commands-kits.msglabel.discordClosedGame', 'Menu: outside its in-game window'),
      discordUnavailable: T('pl.commands-kits.msglabel.discordUnavailable', 'Menu: any other reason'),
    };
  }
  function msgLabel(key) {
    var labels = msgLabels();
    if (labels[key]) return labels[key];
    var s = String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  // Token palette, grouped — [token, what it shows] so the button can explain itself on hover.
  // Click to insert into the last-focused text field. The TOKEN is never translated: it is written
  // into the owner's own message and read back by the backend. Only the explanation beside it is.
  function tokenGroups() {
    return [
      [T('pl.commands-kits.tokgrp.player', 'Player'), [
        ['{player}', T('pl.commands-kits.tok.player', 'The player’s in-game name')],
        ['{steamid}', T('pl.commands-kits.tok.steamid', 'Their 17-digit SteamID')],
        ['{squad}', T('pl.commands-kits.tok.squad', 'Their squad’s name')],
        ['{squadsize}', T('pl.commands-kits.tok.squadsize', 'Number of members in their squad')],
        ['{ping}', T('pl.commands-kits.tok.ping', 'Their ping')],
        ['{health}', T('pl.commands-kits.tok.health', 'Their health, in percent')],
        ['{sector}', T('pl.commands-kits.tok.sector', 'The map sector they are in, like B2')],
      ]],
      [T('pl.commands-kits.tokgrp.server', 'Server'), [
        ['{server}', T('pl.commands-kits.tok.server', 'The server’s name')],
        ['{online}', T('pl.commands-kits.tok.online', 'Players online right now')],
        ['{maxplayers}', T('pl.commands-kits.tok.maxplayers', 'Server slot limit')],
        ['{date}', T('pl.commands-kits.tok.date', 'Today’s date')],
        ['{time}', T('pl.commands-kits.tok.time', 'Current time')],
        ['{gametime}', T('pl.commands-kits.tok.gametime', 'The time of day in game')],
        ['{temperature}', T('pl.commands-kits.tok.temperature', 'Air temperature in game, in °C')],
        ['{nextrestart}', T('pl.commands-kits.tok.nextrestart', 'Time of the next scheduled restart')],
        ['{restartin}', T('pl.commands-kits.tok.restartin', 'Time left until that restart')],
      ]],
      [T('pl.commands-kits.tokgrp.money', 'Money'), [
        ['{money}', T('pl.commands-kits.tok.money', 'Bank account balance — the pool a cost is taken from')],
        ['{cash}', T('pl.commands-kits.tok.cash', 'Cash on hand — a legacy field the game leaves empty on current builds')],
        ['{gold}', T('pl.commands-kits.tok.gold', 'Gold balance')],
      ]],
      [T('pl.commands-kits.tokgrp.stats', 'Stats'), [
        ['{fame}', T('pl.commands-kits.tok.fame', 'Fame points')],
        ['{kills}', T('pl.commands-kits.tok.kills', 'Total kills')],
        ['{deaths}', T('pl.commands-kits.tok.deaths', 'Total deaths')],
        ['{kd}', T('pl.commands-kits.tok.kd', 'Kill / death ratio')],
        ['{pvpkills}', T('pl.commands-kits.tok.pvpkills', 'Players killed (PvP)')],
        ['{headshots}', T('pl.commands-kits.tok.headshots', 'Headshot kills')],
        ['{zombiekills}', T('pl.commands-kits.tok.zombiekills', 'Puppets killed')],
        ['{animalkills}', T('pl.commands-kits.tok.animalkills', 'Animals killed')],
        ['{longestkill}', T('pl.commands-kits.tok.longestkill', 'Longest kill, in metres')],
        ['{lockspicked}', T('pl.commands-kits.tok.lockspicked', 'Locks picked')],
        ['{fishcaught}', T('pl.commands-kits.tok.fishcaught', 'Fish caught')],
        ['{distance}', T('pl.commands-kits.tok.distance', 'Distance travelled, in metres')],
        ['{playtime}', T('pl.commands-kits.tok.playtime', 'Total time played (e.g. 3d 4h)')],
        ['{survived}', T('pl.commands-kits.tok.survived', 'Longest time survived')],
      ]],
      [T('pl.commands-kits.tokgrp.attributes', 'Attributes'), [
        ['{strength}', T('pl.commands-kits.tok.strength', 'Strength attribute')],
        ['{constitution}', T('pl.commands-kits.tok.constitution', 'Constitution attribute')],
        ['{dexterity}', T('pl.commands-kits.tok.dexterity', 'Dexterity attribute')],
        ['{intelligence}', T('pl.commands-kits.tok.intelligence', 'Intelligence attribute')],
      ]],
      [T('pl.commands-kits.tokgrp.position', 'Position'), [
        ['{location}', T('pl.commands-kits.tok.location', 'Current position as “X, Y”')],
        ['{x}', T('pl.commands-kits.tok.x', 'Current X coordinate')],
        ['{y}', T('pl.commands-kits.tok.y', 'Current Y coordinate')],
        ['{z}', T('pl.commands-kits.tok.z', 'Current Z coordinate')],
        ['{saved_x}', T('pl.commands-kits.tok.savedx', 'Saved X (needs “Remember position”)')],
        ['{saved_y}', T('pl.commands-kits.tok.savedy', 'Saved Y coordinate')],
        ['{saved_z}', T('pl.commands-kits.tok.savedz', 'Saved Z coordinate')],
      ]],
      [T('pl.commands-kits.tokgrp.args', 'Command args'), [
        ['{args}', T('pl.commands-kits.tok.args', 'Everything the player typed after the command')],
        ['{arg1}', T('pl.commands-kits.tok.arg1', 'The first word after the command')],
        ['{channel}', T('pl.commands-kits.tok.channel', 'The chat channel they used')],
        ['{prefix}', T('pl.commands-kits.tok.prefix', 'The command prefix players type, like /')],
      ]],
    ];
  }
  // What this reward costs, so a paid kit can say so on the way OUT rather than only in the refusal
  // read by somebody who cannot afford it. Offered on the Commands and Kits screens, where a price
  // exists; the welcome message belongs to no kit, so it is not offered there.
  function costTokens() {
    return [
      ['{pack}', T('pl.commands-kits.tok.pack', 'The name of this kit / command')],
      ['{cost}', T('pl.commands-kits.tok.cost', 'What it costs')],
      ['{currency}', T('pl.commands-kits.tok.currency', 'money, gold or fame')],
    ];
  }
  function msgTokens() {
    return [
      ['{pack}', T('pl.commands-kits.mtok.pack', 'The reward / command this message is about')],
      ['{cmd}', T('pl.commands-kits.mtok.cmd', 'The command that was typed')],
      ['{h}', T('pl.commands-kits.mtok.h', 'Hours left on the cooldown, rounded up')],
      ['{left}', T('pl.commands-kits.mtok.left', 'How long is left, in words — “25m”, “3h 10m”')],
      ['{cost}', T('pl.commands-kits.mtok.cost', 'The cost amount')],
      ['{currency}', T('pl.commands-kits.mtok.currency', 'The cost currency (money / gold / fame)')],
      ['{have}', T('pl.commands-kits.mtok.have', 'What they actually have — “Can’t afford it” only')],
      ['{pool}', T('pl.commands-kits.mtok.pool', 'Which balance that is — “Can’t afford it” only')],
      ['{asof}', T('pl.commands-kits.mtok.asof', 'Says so when only the last save could answer — “Can’t afford it” only')],
      ['{window}', T('pl.commands-kits.mtok.window', 'When it is available again — “Outside its time window” only')],
      ['{missing}', T('pl.commands-kits.mtok.missing', 'What did not arrive — “Part of the kit did not arrive” only')],
    ];
  }

  // ── fetch + dom helpers ─────────────────────────────────────────────────────
  // The manager's own client, not a hand-rolled one. The wrapper this replaces swallowed a failure
  // TWICE — the inner catch ate a body that was not JSON, the outer ate the network failure and
  // every non-2xx — so a backend that was down, a route that 404'd and a session that had expired
  // all arrived as `{}`. Every `(r && r.x) || []` after it then drew an empty screen, which is a
  // sentence about the DATA ("nothing is configured") when the truth was about the REQUEST.
  //
  // `SSA.apiClient()` is captured here, at the top of the script, because `SSA.api` resolves the
  // calling plugin at call time and the SDK only knows who is asking inside a synchronous stretch
  // it started (script load, a `ready()` callback, a tab render). Every real call in this file is a
  // poll tick, a click handler or a `.then` continuation, which is exactly where that binding is
  // already gone — so `SSA.api` would have gone to /api/plugin-host/_/… on every one of them.
  var api = SSA.apiClient();
  // One sentence for a failure, the route's own words first. Used by every catch below.
  function why(err) { return SSA.apiError(err); }
  function h(tag, props, kids) {
    var e = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      if (k === 'class') e.className = props[k];
      else if (k === 'html') e.innerHTML = props[k];
      else if (k === 'text') e.textContent = props[k];
      else if (k === 'style' && typeof props[k] === 'object') Object.assign(e.style, props[k]);
      else if (k.slice(0, 2) === 'on' && typeof props[k] === 'function') e.addEventListener(k.slice(2), props[k]);
      else if (props[k] != null && props[k] !== false) e.setAttribute(k, props[k] === true ? '' : props[k]);
    });
    (Array.isArray(kids) ? kids : (kids != null ? [kids] : [])).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    // An icon button is named by aria-label; its title is the localised name, so it is that too.
    if (tag === 'button' && e.title && !e.hasAttribute('aria-label') && !e.textContent.trim()) e.setAttribute('aria-label', e.title);
    return e;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // Icons, pickers, tables and cells come from the manager's native SDK so the UI matches the panel.
  var icon = function (id, cls) { return SSA.icon(id, cls); };
  // The sprite has no chevron, so the collapse arrow is a small inline SVG (rotated via CSS when closed).
  function chevIcon() { var s = document.createElement('span'); s.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'; return s.firstChild; }

  var markDirty = function () {};   // wired up in editor()
  // Module-scoped so re-mounting the tab reuses ONE socket subscription + poll timer (no duplicates).
  var ckOnEvent = null, ckSocketBound = false, ckPollTimer = null;

  function sel(value, options, onchange) {
    var opts = options.map(function (o) { var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; return h('option', { value: v, selected: value === v || undefined }, l); });
    var s = h('select', { class: 'ck-in', onchange: function () { onchange(s.value); markDirty(); } }, opts);
    return s;
  }
  function txt(value, ph, oninput, cls) { var i = h('input', { class: cls || 'ck-in', type: 'text', placeholder: ph || '', oninput: function () { oninput(i.value); markDirty(); } }); i.value = value == null ? '' : value; return i; }
  function numf(value, oninput, o) { o = o || {}; var i = h('input', { class: 'ck-in ck-num', type: 'number', min: o.min != null ? o.min : 0, step: o.step || 1, oninput: function () { oninput(Number(i.value) || 0); markDirty(); } }); i.value = value == null ? 0 : value; return i; }
  function area(value, ph, oninput) { var t = h('textarea', { class: 'ck-area', rows: 2, placeholder: ph || '', oninput: function () { oninput(t.value); markDirty(); } }); t.value = value || ''; return t; }
  function toggle(checked, onchange) {
    var b = h('input', { type: 'checkbox', onchange: function () { onchange(b.checked); markDirty(); } }); b.checked = checked !== false;
    return h('label', { class: 'ck-switch' }, [b, h('span', { class: 'ck-switch-t' })]);
  }
  // ── Time windows ────────────────────────────────────────────────────────────────────────────────
  //
  // "From when to when is this available." The same control, the same words and the same evaluator
  // as every other plugin that offers it — the manager owns the rule (`host.time`) and this draws
  // what it says rather than working it out again. That matters more than it looks: "22:00 to 02:00"
  // has a wrap rule, "no days chosen" has a meaning, and a second copy of either in a browser is a
  // copy that will disagree with the one that decides whether somebody is charged.
  //
  // The clock is the SERVER'S, and the note under every editor says so. It is not the game's
  // day/night cycle: SCUM has a time of day but no day of the week, and its day runs at whatever
  // multiplier the server is set to, so a "20:00–22:00" window in game time would open several times
  // a night for a few real minutes each. An owner cannot be left to guess which of those we meant.
  function twDays() {
    return [T('pl.commands-kits.day.mon', 'Mon'), T('pl.commands-kits.day.tue', 'Tue'), T('pl.commands-kits.day.wed', 'Wed'),
      T('pl.commands-kits.day.thu', 'Thu'), T('pl.commands-kits.day.fri', 'Fri'), T('pl.commands-kits.day.sat', 'Sat'),
      T('pl.commands-kits.day.sun', 'Sun')];
  }
  var twClock = null;                      // { supported, now, zone } — asked once per tab
  function twClockLine() {
    if (!twClock) return '';
    if (twClock.supported === false) {
      if (twClock.code === 'managerTooOld') return T('pl.commands-kits.tw.tooOld', 'This manager is too old for time windows. Entries with one stay closed until you update.');
      return twClock.why || T('pl.commands-kits.tw.unsupported', 'This manager cannot evaluate time windows.');
    }
    var z = twClock.zone || {}, n = twClock.now || {};
    return T('pl.commands-kits.tw.clock', 'Server clock: {time} {zone}. This is real time, not in-game time.',
      { time: n.hhmm || '??:??', zone: z.label || T('pl.commands-kits.tw.zoneUnknown', 'server time') });
  }
  function twLoadClock(then) {
    if (twClock) { then(); return; }
    api('/clock').then(function (c) { twClock = c || { supported: false }; then(); })
      // A failed check is not "this manager cannot evaluate time windows" — it may well be able to,
      // and the request just did not land. Carry the real reason rather than the generic sentence.
      .catch(function (err) { twClock = { supported: false, why: why(err) }; then(); });
  }

  /**
   * The editor for one `windows` list.
   *
   * `owner` is whatever carries the list — a command, a pack, a vehicle, a plan, or the config
   * itself. `onChange` is the host page's dirty-marker. An owner with no windows sees one line
   * saying it is always available and a button; nothing else appears until they ask for it, because
   * this is an advanced setting on a screen that already has plenty.
   */
  function twEditor(owner, onChange) {
    var box = h('div', { class: 'tw' });
    var rows = h('div', { class: 'tw-rows' });
    var note = h('p', { class: 'tw-note' }, T('pl.commands-kits.tw.always', 'Always available — no time window is set.'));
    var clockNote = h('p', { class: 'tw-clock' }, '');
    var add = h('button', {
      type: 'button', class: 'tw-add',
      onclick: function () {
        owner.windows = (owner.windows || []).concat([{ days: [], from: '20:00', to: '22:00' }]);
        onChange(); draw();
      },
    }, T('pl.commands-kits.tw.add', '+ Add a time window'));

    var seq = 0;
    // Whether a preview has ever come back for THIS window list. Without it a failed first check
    // leaves the note on its initial "Always available" text even though the owner has windows
    // set — a request failure silently reading as the one answer it can never actually be.
    var everGood = false;
    function preview() {
      var list = owner.windows || [];
      if (!list.length) { note.className = 'tw-note'; note.textContent = T('pl.commands-kits.tw.always', 'Always available — no time window is set.'); return; }
      // Every keystroke asks, and only the LAST answer is allowed to paint. Without the token an
      // earlier reply can land after a later one and leave the note describing a window the owner
      // has already changed — which is worse than a stale number, because it reads as authoritative.
      var mine = ++seq;
      api('/clock/preview', { method: 'POST', body: { windows: list } }).then(function (r) {
        if (mine !== seq) return;
        everGood = true;
        if (!r || r.supported === false) {
          note.className = 'tw-note bad';
          note.textContent = T('pl.commands-kits.tw.closedNote', '⚠ This manager can\'t read time windows; they count as closed. Update or remove them.');
          return;
        }
        if (r.errors && r.errors.length) { note.className = 'tw-note bad'; note.textContent = '⚠ ' + r.errors.join(' · '); return; }
        note.className = 'tw-note' + (r.open ? ' ok' : '');
        note.textContent = r.text + '  ' + (r.open ? T('pl.commands-kits.tw.openNow', '● Open right now.') : T('pl.commands-kits.tw.shutNow', '○ Shut right now.'));
      }).catch(function (err) {
        if (mine !== seq) return;
        // A request that failed after a good answer already painted keeps that answer — it is
        // stale, not wrong, and clearing it would say "always available" about a window that is not.
        // Before any good answer has ever arrived there is nothing honest to keep, so say so instead.
        if (everGood) return;
        note.className = 'tw-note bad';
        note.textContent = T('pl.commands-kits.tw.checkFailed',
          '⚠ Could not check this window — {why} It is still saved.', { why: why(err) });
      });
    }

    function dayChips(w) {
      // An empty list means EVERY DAY, so all seven read as on. Clicking one then has to turn that
      // day off rather than leave six unexplained — which means materialising the full week first.
      var chosen = (w.days && w.days.length) ? w.days.slice() : [1, 2, 3, 4, 5, 6, 7];
      return twDays().map(function (name, i) {
        var d = i + 1, on = chosen.indexOf(d) >= 0;
        return h('button', {
          type: 'button', class: 'tw-day' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false',
          onclick: function () {
            var next = chosen.slice();
            var at = next.indexOf(d);
            if (at >= 0) next.splice(at, 1); else next.push(d);
            next.sort(function (a, b) { return a - b; });
            // All seven and none at all are the same thing — every day — and an empty list is how
            // that is stored. Turning the last day off therefore turns them all back on, which is
            // the honest answer to "a window on no days": there is no such window.
            w.days = (next.length === 7 || next.length === 0) ? [] : next;
            onChange(); draw();
          },
        }, name);
      });
    }

    function draw() {
      rows.innerHTML = '';
      (owner.windows || []).forEach(function (w, idx) {
        var from = h('input', { type: 'time', class: 'tw-t', value: w.from || '' });
        from.addEventListener('input', function () { w.from = from.value; onChange(); preview(); });
        var to = h('input', { type: 'time', class: 'tw-t', value: w.to || '' });
        to.addEventListener('input', function () { w.to = to.value; onChange(); preview(); });
        rows.appendChild(h('div', { class: 'tw-row' }, [
          h('div', { class: 'tw-days' }, dayChips(w)),
          h('div', { class: 'tw-times' }, [h('span', {}, T('pl.commands-kits.tw.from', 'from')), from, h('span', {}, T('pl.commands-kits.tw.to', 'to')), to]),
          h('button', {
            type: 'button', class: 'tw-del', title: T('pl.commands-kits.tw.remove', 'Remove this window'),
            onclick: function () { owner.windows.splice(idx, 1); if (!owner.windows.length) delete owner.windows; onChange(); draw(); },
          }, '×'),
        ]));
      });
      preview();
      clockNote.textContent = twClockLine();
    }

    box.appendChild(rows);
    box.appendChild(h('div', { class: 'tw-foot' }, [add, note]));
    box.appendChild(clockNote);
    twLoadClock(draw);
    return box;
  }

  // ── …and the OTHER clock: the hour it is INSIDE THE GAME ──────────────────────────────────────
  //
  // A second, independent window that answers what the one above cannot. The server's wall clock has
  // days of the week and dates and knows nothing about a world running at eight game hours to the
  // real one; the game's clock is the only way to say "only at night", and has no weekend at all.
  // They are ANDed, and the screen says so rather than leaving an owner to find out by testing.
  //
  // ⚠ **AND THE TWO FAIL IN OPPOSITE DIRECTIONS, WHICH IS THE THING THIS EDITOR EXISTS TO SHOW.**
  // A wall-clock window that cannot be read is treated as CLOSED, because a clock that is not there
  // means something is broken. A game-clock window that cannot be read is NOT APPLIED — the kit goes
  // on being handed out exactly as it was — because the reading comes from a bridge module that
  // ships OFF, so "cannot be read" is the ordinary state of a server nobody has switched it on for,
  // and closing would silently disarm every night kit on the day an owner updated.
  //
  // So this editor has THREE states and never two, and "shut right now" and "not being applied"
  // never share a sentence. The second one names the switch to turn on.
  var gwClock = null;                      // { known, hhmm, speed } — asked once per tab
  // ⚠ **ONE REQUEST, AND EVERY EDITOR ON THE PAGE REPAINTS WHEN IT LANDS.** A screen with several
  // kits open draws several of these at once, and the obvious shape — a flag that says "somebody is
  // already asking" — leaves every editor but the first holding the answer it had before the reply
  // arrived, which here is the NOT-APPLIED sentence. So the callbacks are collected: the first one
  // through sends the request and the rest queue behind it, and all of them are called.
  var gwWaiting = null;
  function gwLoadClock(then) {
    if (gwClock) { then(); return; }
    if (gwWaiting) { gwWaiting.push(then); return; }
    gwWaiting = [then];
    var done = function (c) {
      gwClock = c;
      var list = gwWaiting; gwWaiting = null;
      list.forEach(function (fn) { try { fn(); } catch (e) { /* one editor's paint must not stop the rest */ } });
    };
    api('/game-clock').then(function (c) { done(c || { known: false }); })
      // A request that did not land is not "the clock is off" — it may well be on. Carry the real
      // reason rather than the generic one, the same rule the wall-clock editor follows above.
      .catch(function (err) { done({ known: false, why: why(err) }); });
  }
  /** Whole game hours, 0–24, as the number an <input type="number"> gives back. */
  function gwHour(v, d) { var n = Number(v); return Math.max(0, Math.min(24, Math.round(isFinite(n) ? n : d))); }
  function gwHHMM(v) { return String(gwHour(v, 0) % 24).padStart(2, '0') + ':00'; }
  function gwEditor(owner, onChange) {
    var box = h('div', { class: 'tw gw' });
    var body = h('div', { class: 'tw-rows' });
    var note = h('p', { class: 'tw-note' }, '');
    var clockNote = h('p', { class: 'tw-clock' }, '');

    function on() { return !!(owner.gameTime && owner.gameTime.enabled === true); }
    function g() {
      if (!owner.gameTime || typeof owner.gameTime !== 'object') owner.gameTime = { enabled: false, fromHour: 21, toHour: 5 };
      return owner.gameTime;
    }

    function paint() {
      body.innerHTML = '';
      var sw = toggle(on(), function (v) {
        g().enabled = !!v;
        // An owner switching it OFF keeps their hours: they are what they will switch back on to,
        // and clearing them would make the toggle a destructive control. The backend reads
        // `enabled === true` and ignores the rest, so nothing acts on them meanwhile.
        onChange(); paint();
      });
      body.appendChild(h('div', { class: 'ck-inl' }, [
        h('span', {}, T('pl.commands-kits.gw.enable', 'Only at certain hours IN GAME')), sw,
      ]));
      if (on()) {
        var from = h('input', { class: 'ck-in ck-num', type: 'number', min: 0, max: 24, step: 1 });
        from.value = gwHour(g().fromHour, 21);
        from.addEventListener('input', function () { g().fromHour = gwHour(from.value, 0); onChange(); describe(); });
        var to = h('input', { class: 'ck-in ck-num', type: 'number', min: 0, max: 24, step: 1 });
        to.value = gwHour(g().toHour, 5);
        to.addEventListener('input', function () { g().toHour = gwHour(to.value, 24); onChange(); describe(); });
        body.appendChild(h('div', { class: 'tw-times' }, [
          h('span', {}, T('pl.commands-kits.gw.from', 'from game hour')), from,
          h('span', {}, T('pl.commands-kits.gw.to', 'to')), to,
        ]));
      }
      describe();
    }

    /**
     * The three states, in words. Nothing here is composed out of a boolean: "shut" and "not being
     * applied" are different facts, and an owner who reads the second as the first goes looking for
     * a window that is not running.
     */
    function describe() {
      if (!on()) {
        note.className = 'tw-note';
        note.textContent = T('pl.commands-kits.gw.off', 'Any hour of the game day — no in-game window is set.');
        clockNote.textContent = '';
        return;
      }
      var a = gwHour(g().fromHour, 21), b = gwHour(g().toHour, 5);
      var span = (a === b || (a === 0 && b === 24))
        ? T('pl.commands-kits.gw.whole', 'Every hour of the game day — a window from {from} to {to} covers all of it.', { from: gwHHMM(a), to: gwHHMM(b) })
        : T('pl.commands-kits.gw.span', 'In game, between {from} and {to}{wrap}.',
          { from: gwHHMM(a), to: gwHHMM(b), wrap: b < a ? T('pl.commands-kits.gw.wrap', ' (across midnight)') : '' });
      if (!gwClock || gwClock.known !== true) {
        // ⚠ **NOT "CLOSED", AND NOT "OPEN" EITHER.** The window is set and is not being used, the
        // command or kit runs as though it had none, and the owner is told which switch changes
        // that. This is the one sentence on the screen that must never be collapsed into the two
        // states beside it. This editor serves BOTH surfaces, so the sentence names neither.
        note.className = 'tw-note bad';
        note.textContent = T('pl.commands-kits.gw.blind',
          '⚠ {span} — not applied: {why} Until then it works at any hour.',
          { span: span, why: (gwClock && gwClock.code === 'noGameClock') ? noGameClockText()
            : ((gwClock && gwClock.why) || T('pl.commands-kits.gw.noClock', 'the game\'s own clock could not be read.')) });
        clockNote.textContent = '';
        return;
      }
      var open = (a === b || (a === 0 && b === 24))
        || (a < b ? (gwClock.hour >= a && gwClock.hour < b) : (gwClock.hour >= a || gwClock.hour < b));
      note.className = 'tw-note' + (open ? ' ok' : '');
      note.textContent = span + '  ' + (open
        ? T('pl.commands-kits.gw.openNow', '● Open right now.')
        : T('pl.commands-kits.gw.shutNow', '○ Shut right now.'));
      // The speed is what turns "21:00 in game" into something an owner can plan around, so it is
      // beside the hour rather than left for them to work out. It is also the number that makes the
      // difference between the two clocks concrete on the one screen that has both.
      clockNote.textContent = Number(gwClock.speed) > 0
        ? T('pl.commands-kits.gw.clockSpeed', 'Game clock: {time}. {n} game hours per real hour; one game hour ≈ {mins} real minutes.',
          { time: gwClock.hhmm || '??:00', n: gwClock.speed, mins: Math.round(600 / Number(gwClock.speed)) / 10 })
        : T('pl.commands-kits.gw.clock', 'Game clock: {time}. This is the hour inside the game, not the server\'s own clock.',
          { time: gwClock.hhmm || '??:00' });
    }

    box.appendChild(body);
    box.appendChild(h('div', { class: 'tw-foot' }, [note]));
    box.appendChild(clockNote);
    gwLoadClock(paint);
    paint();
    return box;
  }

  // A label or a note that NAMES a token (`{window} for an in-game window`) shows the token as code,
  // the way a token chip does: it is the thing typed into the box, not a hole in the sentence.
  function withCode(text) {
    return String(text == null ? '' : text).split(/(\{[a-zA-Z][a-zA-Z0-9_]*\})/).filter(function (p) { return p !== ''; })
      .map(function (p) { return /^\{[a-zA-Z][a-zA-Z0-9_]*\}$/.test(p) ? h('code', {}, p) : p; });
  }
  function field(label, ctl, hint) { return h('label', { class: 'ck-f' }, [h('span', {}, label), ctl, hint ? h('small', { class: 'ck-hint' }, hint) : null]); }
  function inlineField(label, ctl, title) { return h('label', { class: 'ck-inl', title: title || undefined }, [h('span', {}, label), ctl]); }
  // A compact quantity control — the “×” is glued to the number (× 3) so it reads as one unit, not a
  // stray floating symbol next to the item.
  function qty(value, oninput) { return h('label', { class: 'ck-qty', title: T('pl.commands-kits.qty.title', 'How many of this to give') }, [h('span', { class: 'ck-qty-x' }, '×'), numf(value, oninput)]); }
  // A titled section card — identical structure to the mine-protection plugin (native .card + title +
  // muted subtitle), so every section reads the same across plugins. `head` = extra nodes on the title row.
  function ckSection(title, sub, kids, head) {
    var titleRow = h('div', { class: 'ck-sect-h' }, [h('h3', { class: 'ck-card-t' }, title)].concat(head ? [h('span', { class: 'ck-spacer' })].concat(head) : []));
    var top = [titleRow];
    if (sub) top.push(h('p', { class: 'ck-card-sub' }, sub));
    return h('div', { class: 'card ck-sect' }, top.concat(kids || []));
  }

  // ── item / vehicle / player pickers — the manager's NATIVE ones via the SDK ──────────────────
  // The native item picker adds category/subcategory filters + images; onPick keeps the old { id, name,
  // image } shape the callers expect.
  function openPicker(domain, onPick) { SSA.pickItem({ domain: domain }).then(function (it) { if (it) onPick(it); }); }
  /**
   * …and the same picker kept OPEN, so ten items are one gesture instead of ten trips through a menu
   * three levels deep. `count` puts the quantity in the picker's own footer, which is what makes
   * staying open a better deal than closing rather than a worse one.
   *
   * ⚠ **NOTHING GOES ON THE WIRE HERE, AND THAT IS WHY THIS IS SAFE.** The panel's own multi-pick
   * spawns an item into the running game on every click, which is how a burst of `#SpawnItem` took a
   * server down, and it is serialised for that reason. This one appends a row to a list in a
   * browser: nothing is sent until Save, and Save is one request. Do not "fix" it by putting a
   * throttle in front of it — there is no dispatch to throttle.
   *
   * ⚠ **AND IT RE-RENDERS ON EVERY PICK RATHER THAN ONCE AT THE END.** Two reasons, and the second
   * is the one that decided it. The overlay is appended to the document's own body, not into this
   * tab, so a re-render cannot disturb it or the search box somebody is typing in. And a panel whose
   * picker predates `multi` closes on the first pick and never calls `onDone` at all — under a
   * render-once-at-the-end design that pick would be added to the list and never drawn, which is
   * exactly the kind of silent half-working that needs no capability detection to avoid.
   */
  function openMultiPicker(domain, onEach, onDone) {
    var taken = 0;
    SSA.pickItem({
      domain: domain, multi: true, count: true,
      onPick: function (it) { if (it) { taken++; onEach(it); } },
      onDone: function () { if (onDone) onDone(taken); },
    });
  }

  // ── copying things ─────────────────────────────────────────────────────────────────────────────
  /**
   * An id nothing else on this page has.
   *
   * ⚠ **`'pack' + Date.now()` GIVES TWO PRESSES IN ONE MILLISECOND THE SAME ID**, and a pack's id is
   * the key its claims, its cooldowns and its place in a variant rotation are recorded under — so two
   * packs with one id are one pack to every one of those. It is not a rare shape either: it is what
   * "copy, copy" does, which is the commonest way anybody makes two kits at once.
   */
  function newId(stem) {
    return String(stem || 'id') + Date.now().toString(36) + '-' + Math.floor(Math.random() * 46656).toString(36);
  }
  /** A value no sibling already has, as `X (copy)`, then `X (copy 2)`. Case-insensitive. */
  function uniqueAmong(list, read, stem, fallback) {
    var taken = {};
    (list || []).forEach(function (x) { taken[String(read(x) || '').trim().toLowerCase()] = true; });
    var base = String(stem || '').trim() || fallback;
    var want = base + ' (copy)';
    for (var n = 2; taken[want.toLowerCase()]; n++) want = base + ' (copy ' + n + ')';
    return want;
  }
  /** The same, for a chat WORD — no spaces or brackets, because a player has to type it. */
  function uniqueWord(list, read, stem, fallback) {
    var taken = {};
    (list || []).forEach(function (x) { taken[String(read(x) || '').trim().toLowerCase()] = true; });
    var base = String(stem || '').trim().replace(/^[/!.#]+/, '').replace(/\s+/g, '') || fallback;
    var want = base + '2';
    for (var n = 3; taken[want.toLowerCase()]; n++) want = base + n;
    return want;
  }
  /**
   * A deep copy of whatever was handed over, sharing nothing with it.
   *
   * A JSON round trip rather than a spread: a spread copies the top level and leaves every list and
   * every nested object shared, which reads as two independent things right up until somebody edits
   * one and both move. That defect ships with almost every copy button ever written.
   */
  function deepCopy(v) { return JSON.parse(JSON.stringify(v == null ? null : v)); }
  // The native SSA.pickPlayer only lists players who are ONLINE. Admins need to allow/deny anyone —
  // including offline players — so this is our own picker over /players/all (the full game-DB roster),
  // with search, an online marker, and a SteamID paste box for someone not in the DB yet.
  function openPlayerPicker(onPick) {
    var picked = false;
    var search = h('input', { class: 'ck-in', type: 'text', placeholder: T('pl.commands-kits.pp.search', 'Search all players…') });
    var manual = h('input', { class: 'ck-in', type: 'text', placeholder: T('pl.commands-kits.pp.paste', 'or paste a SteamID (17 digits)…') });
    var list = h('div', { class: 'ssa-pp-list' }, [h('p', { class: 'ck-empty' }, T('pl.commands-kits.pp.loading', 'Loading players…'))]);
    var all = [];
    var loadErr = null;    // set when the roster itself could not be read — never "no players found"
    function pick(p) { if (picked) return; picked = true; m.close(); onPick(p); }
    function paint() {
      list.innerHTML = '';
      // An admin looking for a player they KNOW exists must never be told the roster is empty when
      // the truth is that this request failed. The SteamID box above stays usable either way, so
      // say that too — it is the one thing that still works when the roster cannot be read.
      if (loadErr && !all.length) { list.appendChild(h('p', { class: 'ck-empty ck-pp-err' }, T('pl.commands-kits.pp.readFailed', 'Player list unreadable — {why} Paste a SteamID above instead.', { why: loadErr }))); return; }
      var q = (search.value || '').trim().toLowerCase();
      var rows = all.filter(function (p) { return !q || (String(p.name || '') + ' ' + p.steamId).toLowerCase().indexOf(q) >= 0; });
      if (!rows.length) { list.appendChild(h('p', { class: 'ck-empty' }, all.length ? T('pl.commands-kits.noMatches', 'No matches.') : T('pl.commands-kits.pp.none', 'No players found yet — paste a SteamID above.'))); return; }
      rows.slice(0, 300).forEach(function (p) {
        list.appendChild(h('button', { class: 'secondary ssa-pp-row', onclick: function () { pick({ steamId: p.steamId, name: p.name || '' }); } }, [
          h('span', { class: 'ck-pp-name' }, [h('span', { class: 'ck-pp-dot' + (p.online ? ' on' : ''), title: p.online ? T('pl.commands-kits.pp.onlineNow', 'Online now') : T('pl.commands-kits.pp.offline', 'Offline') }), h('span', {}, p.name || p.steamId)]),
          h('code', { class: 'mono dim' }, p.steamId),
        ]));
      });
      if (rows.length > 300) list.appendChild(h('p', { class: 'ck-hint' }, T('pl.commands-kits.pp.first300', 'Showing the first 300 — type to narrow it down.')));
    }
    var addManual = h('button', { class: 'secondary', onclick: function () { var v = (manual.value || '').trim(); if (/^\d{17}$/.test(v)) pick({ steamId: v, name: '' }); else manual.style.borderColor = 'var(--alarm,#e5443f)'; } }, T('pl.commands-kits.pp.add', 'Add'));
    search.addEventListener('input', paint);
    var body = h('div', {}, [
      h('label', { class: 'player-search ck-pp-search' }, [icon('search'), search]),
      list,
      h('div', { class: 'ssa-pp-manual' }, [manual, addManual]),
    ]);
    var m = SSA.modal({ title: T('pl.commands-kits.pp.title', 'Choose a player'), body: body });
    var ov = m.el.parentNode; if (ov) ov.addEventListener('click', function (e) { if (e.target === ov) picked = true; });
    api('/players/all').then(function (d) {
      loadErr = null; all = (d && d.players) || [];
      all.sort(function (a, b) { return (b.online ? 1 : 0) - (a.online ? 1 : 0); });
      paint();
    }).catch(function (err) { loadErr = why(err); all = []; paint(); });
  }

  // allow/deny chip editor
  function idList(entry, key) { return (Array.isArray(entry[key]) ? entry[key] : []).map(function (e) { return (e && typeof e === 'object') ? e : { steamId: String(e), name: '' }; }); }
  function playerChips(label, entry, key, rerender) {
    entry[key] = idList(entry, key);
    var chips = entry[key].map(function (p, i) {
      return h('span', { class: 'ck-chip', title: p.steamId }, [h('span', {}, p.name || p.steamId), h('button', { class: 'ck-chip-x', onclick: function () { entry[key].splice(i, 1); markDirty(); rerender(); } }, [icon('close')])]);
    });
    chips.push(h('button', { class: 'secondary', onclick: function () { openPlayerPicker(function (p) { if (!entry[key].some(function (x) { return x.steamId === p.steamId; })) entry[key].push({ steamId: p.steamId, name: p.name || '' }); markDirty(); rerender(); }); } }, [icon('user'), T('pl.commands-kits.addPlayer', 'Add player')]));
    return h('div', { class: 'ck-f' }, [h('span', {}, label), h('div', { class: 'ck-chips' }, chips)]);
  }

  // admin-actions editor (commands run when a command/pack fires)
  function actionsBlock(entry, rerender) {
    entry.actions = Array.isArray(entry.actions) ? entry.actions : [];
    var rows = entry.actions.map(function (a, i) {
      return h('div', { class: 'ck-actrow' }, [
        txt(a.cmd, '#Teleport {x} {y} {z}', function (v) { a.cmd = v; }, 'ck-in ck-grow'),
        inlineField(T('pl.commands-kits.act.after', 'after (s)'), numf(a.delaySeconds, function (v) { a.delaySeconds = v; })),
        h('button', { class: 'ck-del', title: T('pl.commands-kits.remove', 'Remove'), onclick: function () { entry.actions.splice(i, 1); markDirty(); rerender(); } }, [icon('close')]),
      ]);
    });
    return h('div', { class: 'ck-sub' }, [
      h('div', { class: 'ck-sub-h' }, T('pl.commands-kits.act.title', 'Admin actions')),
      rows.length ? h('div', { class: 'ck-stack' }, rows) : h('p', { class: 'ck-empty' }, T('pl.commands-kits.act.none', 'No actions. Add e.g. a teleport, currency change or buff command.')),
      h('button', { class: 'secondary', onclick: function () { entry.actions.push({ cmd: '', delaySeconds: 0 }); markDirty(); rerender(); } }, [icon('bolt'), T('pl.commands-kits.act.add', 'Add action')]),
      // The `{x} {y} {z}` in this sentence are the plugin's own tokens, shown to an owner as an
      // example of what to type — they are not variables of the sentence and must survive a
      // translation exactly as they are.
      h('p', { class: 'ck-hint' }, T('pl.commands-kits.act.hint', 'Any admin command with tokens, e.g. “#Teleport {x} {y} {z}” with after=60 returns them where they were.')),
    ]);
  }
  function costRow(obj, rerender) {
    obj.cost = obj.cost || { currency: 'free', amount: 0 };
    var cur = curLabels();
    var out = [inlineField(T('pl.commands-kits.cost', 'Cost'), sel(obj.cost.currency || 'free', META.currencies.map(function (c) { return [c, cur[c] || c]; }), function (v) { obj.cost.currency = v; rerender(); }))];
    if (obj.cost.currency && obj.cost.currency !== 'free') out.push(inlineField(T('pl.commands-kits.amount', 'Amount'), numf(obj.cost.amount, function (v) { obj.cost.amount = v; })));
    return out;
  }

  // ── main editor ─────────────────────────────────────────────────────────────
  function editor(root) {
    root.innerHTML = '';
    var state = { commands: [], welcome: {}, packs: [], messages: {}, replyChannel: 'local', commandPrefix: '/', itemSpawnCmd: '', vehicleSpawnCmd: '', invSpawnCmd: '', joinDelaySeconds: 0, spawnGapMs: 180, spawnTries: 3, view: 'commands' };
    // Live delivery status (queue depth + counters + activity log), refreshed from /status + realtime.
    var statusData = { queue: 0, current: null, queueItems: [], stats: { deliveries: 0, ok: 0, failed: 0 }, recent: [] };
    // A poll that failed. The counters and queue above keep the last figures that DID arrive — a
    // stale number is not the same claim as an empty one — and this says the live half has stopped
    // updating rather than letting three zeroes read as "it has not started working yet".
    var statusErr = null;
    var actTable = null;       // delivery-log table (Activity view)
    var claimsTable = null;    // player-claims table (Activity view)
    var claimsData = [];       // rows for the claims table
    var claimsErr = null;      // set when the claims list itself could not be read
    var queueBox = null;       // live-queue container (Activity view)
    var expanded = new WeakSet();     // which command/pack cards are open (UI-only, never saved)
    var cmdFilter = '', packFilter = '';   // live search filters for long command/pack lists
    var dirty = false;

    // Show/hide cards in a list by a search string (matched against each card's data-s), without a full
    // re-render — so typing in the search box never steals focus. Returns nothing.
    function filterCards(listEl, q) {
      q = (q || '').trim().toLowerCase();
      var shown = 0, total = 0;
      Array.prototype.forEach.call(listEl.children, function (el) {
        var s = el.getAttribute && el.getAttribute('data-s'); if (s == null) return;
        total++; var ok = !q || s.indexOf(q) >= 0; el.style.display = ok ? '' : 'none'; if (ok) shown++;
      });
      var empty = listEl.querySelector('.ck-nomatch');
      if (q && shown === 0 && total) { if (!empty) { empty = h('p', { class: 'ck-empty ck-nomatch' }, T('pl.commands-kits.noMatches', 'No matches.')); listEl.appendChild(empty); } }
      else if (empty) empty.remove();
    }
    // A search box for a card list — only worth showing once a list gets long.
    function listSearch(getVal, setVal, listRef, placeholder) {
      var inp = h('input', { class: 'ck-in ck-search', type: 'text', placeholder: placeholder });
      inp.value = getVal();
      inp.addEventListener('input', function () { setVal(inp.value); filterCards(listRef.el, inp.value); });
      return inp;
    }

    var container = h('div', { class: 'ck-wrap' });
    root.appendChild(container);

    // last-focused text field, for the token palette
    var lastField = null;
    container.addEventListener('focusin', function (e) { var t = e.target; if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t.type === 'text' || t.type === '')))) lastField = t; });
    function insertToken(tok) {
      var f = lastField; if (!f) { toast(T('pl.commands-kits.tok.clickFirst', 'Click a text field first, then a token')); return; }
      var s = f.selectionStart == null ? f.value.length : f.selectionStart, e = f.selectionEnd == null ? f.value.length : f.selectionEnd;
      f.value = f.value.slice(0, s) + tok + f.value.slice(e);
      f.selectionStart = f.selectionEnd = s + tok.length;
      f.dispatchEvent(new Event('input', { bubbles: true })); f.focus();
    }

    var status = h('span', { class: 'ck-status' });
    var saveBtn = h('button', { class: '', onclick: save }, T('pl.commands-kits.save', 'Save'));
    markDirty = function () { dirty = true; saveBtn.classList.add('ck-unsaved'); status.textContent = T('pl.commands-kits.unsaved', 'Unsaved changes'); };

    var body = h('div', { class: 'ck-view' }, [h('p', { class: 'ck-loading' }, T('pl.commands-kits.loading', 'Loading…'))]);

    // ── WHAT THIS TAB IS, AND WHAT TO DO FIRST ───────────────────────────────────────────────────
    //
    // This is the largest plugin in the library and it used to open on a row of five tab buttons and
    // a stat bar reading zeroes, with no sentence anywhere saying what any of it was for. Every other
    // plugin here opens with a line of its own; this one did not, so the screen a first-time owner
    // met was the one that explained least.
    //
    // The lead says what the plugin does. The line under it appears only while nothing has been
    // filled in, and names the two screens in the order they are worth visiting — the shipped
    // commands work straight away, and a kit does nothing until something is put in it.
    container.appendChild(h('p', { class: 'ck-lead' },
      T('pl.commands-kits.lead',
        'Chat commands that reply, run admin actions or give kits, free or for a price.')));
    var firstRun = h('div', { class: 'ck-firstrun' });
    container.appendChild(firstRun);
    function renderFirstRun() {
      firstRun.innerHTML = '';
      var packs = state.packs || [];
      // "Nothing in any kit" is the state worth speaking to: a kit with no items, no vehicles, no
      // containers and no actions gives a player nothing, so the plugin cannot do its better half yet.
      var anyFilled = packs.some(function (p) {
        return (p.items || []).some(function (x) { return x && x.item; })
          || (p.vehicles || []).some(function (x) { return x && x.code; })
          || (p.inventories || []).some(function (x) { return x && x.container && x.fill; })
          || (p.actions || []).some(function (a) { return String((a && (a.cmd || a.command)) || (typeof a === 'string' ? a : '')).trim(); });
      });
      if (anyFilled) return;
      var L = navLabels();
      firstRun.appendChild(h('div', { class: 'ck-note-off' }, [
        h('b', {}, T('pl.commands-kits.first.title', 'New here? Two screens to start with.')),
        T('pl.commands-kits.first.on', ' On '), h('b', {}, L.commands),
        T('pl.commands-kits.first.commands', ', edit what /info and /rules say to your players and add your own. On '),
        h('b', {}, L.packs),
        T('pl.commands-kits.first.packs', ', put items in a kit and switch it on. Empty kits are never given.'),
      ]));
    }

    // top bar: sub-nav + save
    var nav = h('div', { class: 'ck-nav' });
    function navBtn(id, label, ic) { return h('button', { class: 'ck-tab' + (state.view === id ? ' active' : ''), onclick: function () { state.view = id; paintNav(); render(); } }, [icon(ic), h('span', {}, label)]); }
    function paintNav() {
      nav.innerHTML = '';
      var L = navLabels();
      [['commands', L.commands, 'chat'], ['packs', L.packs, 'box'], ['messages', L.messages, 'list'], ['activity', L.activity, 'pulse'], ['settings', L.settings, 'sliders']]
        .forEach(function (t) { nav.appendChild(navBtn(t[0], t[1], t[2])); });
    }
    container.appendChild(h('div', { class: 'ck-top' }, [nav, h('div', { class: 'ck-top-r' }, [status, saveBtn])]));

    // Status header — a clean row of badges (matches the mine-protection plugin + the panel).
    var statBar = h('div', { class: 'ck-statbar' });
    container.appendChild(statBar);
    function statBadge(val, label, cls) { return h('div', { class: 'ck-stat' + (cls ? ' ' + cls : '') }, [h('span', { class: 'ck-stat-v' }, String(val)), h('span', { class: 'ck-stat-l' }, label)]); }
    function renderStat() {
      statBar.innerHTML = '';
      var w = !!(state.welcome && state.welcome.enabled);
      var L = navLabels();
      statBar.appendChild(h('div', { class: 'ck-stat ' + (w ? 'ok' : 'off') }, [h('span', { class: 'ck-stat-dot' }), h('span', { class: 'ck-stat-l' }, w ? T('pl.commands-kits.stat.welcomeOn', 'Welcome on') : T('pl.commands-kits.stat.welcomeOff', 'Welcome off'))]));
      statBar.appendChild(statBadge((state.commands || []).length, L.commands));
      statBar.appendChild(statBadge((state.packs || []).length, L.packs));
      // Live operational counters from the backend queue.
      var st = statusData.stats || {};
      statBar.appendChild(statBadge(st.deliveries || 0, T('pl.commands-kits.stat.deliveries', 'Deliveries')));
      statBar.appendChild(statBadge(st.failed || 0, T('pl.commands-kits.stat.failed', 'Failed'), (st.failed || 0) > 0 ? 'warn' : null));
      statBar.appendChild(statBadge(statusData.queue || 0, T('pl.commands-kits.stat.inQueue', 'In queue'), (statusData.queue || 0) > 0 ? 'ok' : null));
      // Everything on the five screens below — commands, kits, prices, cooldowns, every player-facing
      // line — is editable with the server stopped, and that is the better moment to write it. Only
      // the three counters and the activity log wait for a running game. Said out loud, because three
      // zeroes and an empty log otherwise read as "it has not started working yet".
      if (statusData.serverRunning === false) {
        statBar.appendChild(h('div', { class: 'ck-note-off' }, [
          h('b', {}, T('pl.commands-kits.stat.stoppedTitle', 'The server is not running.')),
          T('pl.commands-kits.stat.stoppedText', ' Set up everything now; it goes live on start. Only counters and log wait.'),
        ]));
      }
      // A REQUEST that failed, not a world with nothing in it — the whole reason this plugin no
      // longer swallows a failure into `{}`. The counters above are whatever they last were; this
      // says they have stopped moving, and that everything else on the page is unaffected.
      if (statusErr) {
        statBar.appendChild(h('div', { class: 'ck-note-err' }, [
          h('b', {}, T('pl.commands-kits.stat.errTitle', 'The counters and queue above have stopped updating.')),
          T('pl.commands-kits.stat.errText', ' {why} Commands, kits and every message are unaffected.', { why: statusErr }),
        ]));
      }
    }

    // Pull live status (queue depth + counters + recent log) and reflect it in the header + activity table.
    function applyStatus(s) {
      if (!s) return;
      if (s.stats) statusData.stats = s.stats;
      // Copied explicitly, like every other field: `applyStatus` builds its own object rather than
      // replacing `statusData`, so a key it does not name never reaches the header — which is how a
      // note that is rendered on this flag would silently never draw.
      if (s.serverRunning !== undefined) statusData.serverRunning = s.serverRunning;
      if (s.queue != null) statusData.queue = s.queue;
      if (s.current !== undefined) statusData.current = s.current;
      if (Array.isArray(s.queueItems)) statusData.queueItems = s.queueItems;
      if (Array.isArray(s.recent)) statusData.recent = s.recent;
      renderStat(); renderQueue();
      if (state.view === 'activity' && actTable) actTable.refresh();
    }
    // A poll tick, not the first load — the screen is already drawn and the settings on it are still
    // the owner's. A failure here keeps whatever `statusData` last held and says so beside it, and
    // the interval below keeps calling this every 4s regardless, so it recovers on its own.
    function refreshStatus() {
      api('/status').then(function (s) { statusErr = null; applyStatus(s); })
        .catch(function (err) { statusErr = why(err); renderStat(); });
    }
    // Live queue panel — what's being delivered right now + what's waiting. Written into the Activity view.
    function renderQueue() {
      if (!queueBox) return;
      queueBox.innerHTML = '';
      var items = statusData.queueItems || [], cur = statusData.current, depth = statusData.queue || 0;
      if (!cur && !items.length && depth <= 0) { queueBox.appendChild(h('p', { class: 'ck-empty' }, T('pl.commands-kits.queue.empty', 'Queue is empty — every delivery is up to date.'))); return; }
      // A queued spawn is sent as its parts; an older backend sent a finished string.
      var qText = function (v) { return typeof v === 'string' ? v : spawnLabel(v) + (v && v.player ? ' → ' + v.player : ''); };
      if (cur) queueBox.appendChild(h('div', { class: 'ck-q-cur' }, [h('span', { class: 'ck-q-spin' }), h('span', { class: 'ck-q-lbl' }, [h('strong', {}, T('pl.commands-kits.queue.now', 'Delivering now: ')), qText(cur)])]));
      items.forEach(function (lbl) { queueBox.appendChild(h('div', { class: 'ck-q-row' }, [h('span', { class: 'ck-q-dot' }), h('span', {}, qText(lbl))])); });
      var extra = depth - items.length;
      if (extra > 0) queueBox.appendChild(h('p', { class: 'ck-hint' }, T('pl.commands-kits.queue.more', '+ {n} more waiting…', { n: extra })));
    }
    // Realtime push from the backend on every delivery — update instantly, no waiting for the poll.
    ckOnEvent = function (ev) {
      if (!ev) return;
      if (ev.stats) statusData.stats = ev.stats;
      if (ev.queue != null) statusData.queue = ev.queue;
      if (ev.rec) { statusData.recent.unshift(ev.rec); if (statusData.recent.length > 150) statusData.recent = statusData.recent.slice(0, 150); }
      renderStat(); renderQueue();
      if (state.view === 'activity' && actTable) actTable.refresh();
    };
    if (!ckSocketBound && window.SSA && SSA.socket) { ckSocketBound = true; SSA.socket.on('commands-kits:event', function (ev) { if (ckOnEvent) ckOnEvent(ev); }); }
    if (ckPollTimer) clearInterval(ckPollTimer);
    // One timer for the whole page. It stops for good once this tab has been left (opening it again
    // mounts a new editor with its own timer) and skips a round while the browser tab is hidden.
    var myPoll = ckPollTimer = setInterval(function () {
      if (!root.isConnected) {
        clearInterval(myPoll);
        if (ckPollTimer === myPoll) { ckPollTimer = null; ckOnEvent = null; }
        return;
      }
      if (document.hidden) return;
      refreshStatus();
    }, 4000);

    // "3h ago" style from a Unix-epoch (ms) timestamp.
    function fmtAgo(ms) {
      var s = Math.max(0, Math.floor((Date.now() - (ms || 0)) / 1000));
      if (s < 60) return T('pl.commands-kits.ago.now', 'just now');
      var m = Math.floor(s / 60); if (m < 60) return T('pl.commands-kits.ago.minutes', '{n}m ago', { n: m });
      var hr = Math.floor(m / 60); if (hr < 24) return T('pl.commands-kits.ago.hours', '{n}h ago', { n: hr });
      return T('pl.commands-kits.ago.days', '{n}d ago', { n: Math.floor(hr / 24) });
    }

    // Token palette (collapsible), shown on text-heavy views. Each button carries a tooltip
    // explaining exactly what it will show, so admins don't have to guess.
    //
    // ⚠ A TOOLTIP IS A HOVER, AND A PHONE HAS NO HOVER. Every one of these explanations was
    // therefore unreachable on a touch screen, and the palette's own caption said "hover a token to
    // see what it shows" — an instruction the reader cannot carry out. So the description is REAL
    // TEXT beside the token as well, hidden by the stylesheet on the wide screens where the tooltip
    // works and shown where it does not, and the caption says whichever of the two is true.
    //
    // Gated on WIDTH rather than on `(hover: none)` deliberately. A pointer media query splits the
    // layout along a line nothing can see from outside the device it happens on, and a rule nobody
    // can look at is a rule that quietly stops being true. A narrow desktop window showing the
    // descriptions inline costs nobody anything.
    function tokenBar(extra) {
      var groups = tokenGroups();
      if (extra) groups = groups.concat([[T('pl.commands-kits.tokgrp.message', 'Message'), extra]]);
      var pal = h('div', { class: 'ck-tok-pal' });
      groups.forEach(function (g) {
        pal.appendChild(h('div', { class: 'ck-tok-grp' }, [h('span', { class: 'ck-tok-lbl' }, g[0])].concat(
          g[1].map(function (tk) {
            var tok = Array.isArray(tk) ? tk[0] : tk, desc = Array.isArray(tk) ? tk[1] : '';
            var btn = h('button', { type: 'button', class: 'ck-tokbtn', title: desc ? T('pl.commands-kits.tok.title', '{token} — {what}', { token: tok, what: desc }) : tok, onclick: function () { insertToken(tok); } }, tok);
            return h('span', { class: 'ck-tokwrap' }, desc ? [btn, h('span', { class: 'ck-tokdesc' }, desc)] : [btn]);
          }))));
      });
      return h('details', { class: 'ck-tok' }, [h('summary', {}, [icon('bulb'), h('span', {}, T('pl.commands-kits.tok.insert', 'Insert token')),
        h('span', { class: 'ck-tok-tip ck-tok-tip-wide' }, T('pl.commands-kits.tok.tipWide', 'click a text field first · hover a token to see what it shows')),
        h('span', { class: 'ck-tok-tip ck-tok-tip-narrow' }, T('pl.commands-kits.tok.tipNarrow', 'click a text field first · each token says what it shows'))]), pal]);
    }
    container.appendChild(body);

    // ── card scaffolding (collapsible) ──
    function cardHead(entry, opts) {
      var chevron = h('button', { class: 'ck-chev' + (expanded.has(entry) ? ' open' : ''), title: expanded.has(entry) ? T('pl.commands-kits.collapse', 'Collapse') : T('pl.commands-kits.expand', 'Expand'), onclick: function () { if (expanded.has(entry)) expanded.delete(entry); else expanded.add(entry); render(); } }, [chevIcon()]);
      return h('div', { class: 'ck-card-h' }, [chevron, opts.enable, opts.title, h('span', { class: 'ck-badges' }, opts.badges || []), h('span', { class: 'ck-spacer' }), opts.del]);
    }
    function badge(text, cls) { return text ? h('span', { class: 'ck-badge ' + (cls || '') }, text) : null; }

    /** Has an owner really switched a game-hours window on here? Key presence, then `=== true`. */
    function gameWindowSet(e) { return !!(e && e.gameTime && e.gameTime.enabled === true); }

    // ── COPYING A COMMAND OR A KIT ─────────────────────────────────────────────────────────────
    //
    // Three things a copy button usually gets wrong, all three of which have really happened in this
    // product inside the last day, and all three of which are silent:
    //
    //   **A copy that is not deep.** A spread copies the top level and leaves every list shared, so
    //   the two look independent until somebody edits one and both move. `deepCopy` is a JSON round
    //   trip, so the items, the vehicles, the containers, the actions, the allow and deny lists,
    //   every variant and both windows are all new objects.
    //
    //   **An id from the clock alone.** Two presses inside one millisecond gave one id, and a pack's
    //   id is the key its claims, its cooldowns and each player's place in its variant rotation are
    //   recorded under — so two packs with one id share all three.
    //
    //   **A name that collides.** For a kit the NAME is what a player reads; for a command and for a
    //   kit's chat word the name IS the word, and `reload()` in the backend registers the first
    //   command of a given name and silently skips every later one — so a copy keeping its word
    //   would not merely be confusing, it would never run at all.
    //
    // ⚠ **AND A COPY ARRIVES SWITCHED OFF.** Not out of caution: a copied command's word is one this
    // owner has not chosen, and a live server answering `/info2` in chat within a second of somebody
    // pressing "copy" is not what they pressed it for. The toast says the one thing to change.
    //
    // ⚠ **WHAT IS DELIBERATELY NOT COPIED, AND IS NOT IN THE OBJECT AT ALL: who has already claimed
    // it.** That lives in the backend's ledger under the kit's id, and the copy has a new one — so
    // the copy starts with nobody having had it, and every player can claim it once more. That is
    // almost always what somebody copying a kit wants and it is never what they would guess, so it
    // is said rather than left to be discovered on the first evening.
    function duplicateCommand(cmd, i) {
      var copy = deepCopy(cmd);
      copy.name = uniqueWord(state.commands, function (x) { return x && x.name; }, cmd.name, 'command');
      copy.enabled = false;
      state.commands.splice(i + 1, 0, copy);
      expanded.add(copy);
      markDirty(); render();
      toast(T('pl.commands-kits.cmd.copied',
        'Copied as “{prefix}{name}” with all settings. It is off: set its word, then switch on.',
        { prefix: state.commandPrefix || '/', name: copy.name }));
    }
    function duplicatePack(pack, idx) {
      var copy = deepCopy(pack);
      copy.id = newId('pack');
      copy.name = uniqueAmong(state.packs, function (x) { return x && x.name; }, pack.name, T('pl.commands-kits.kit.newName', 'New Pack'));
      // Only a command-triggered kit has a word to collide over. A welcome kit has none, and
      // inventing one for it would put a chat command on the server that nobody asked for.
      if (copy.trigger === 'command') {
        copy.command = uniqueWord(state.packs, function (x) { return x && x.command; }, pack.command, 'kit');
      }
      copy.enabled = false;
      state.packs.splice(idx + 1, 0, copy);
      expanded.add(copy);
      markDirty(); render();
      toast(T('pl.commands-kits.kit.copied',
        'Copied as “{name}” with everything; nobody has claimed it yet. It is off{word}.',
        { name: copy.name,
          word: copy.trigger === 'command'
            ? T('pl.commands-kits.kit.copiedWord', ' and its command is now “{prefix}{cmd}”', { prefix: state.commandPrefix || '/', cmd: copy.command })
            : '' }));
    }

    // ── Commands view ──
    function cmdCard(cmd, i) {
      var open = expanded.has(cmd);
      var s = ((cmd.name || '') + ' ' + (cmd.response || '') + ' ' + (cmd.group || '')).toLowerCase();
      var nameIn = txt(cmd.name, 'info', function (v) { cmd.name = v.replace(/^[\/!.#]+/, '').replace(/\s+/g, ''); }, 'ck-in ck-name');
      var head = cardHead(cmd, {
        enable: toggle(cmd.enabled, function (v) { cmd.enabled = v; }),
        title: h('span', { class: 'ck-card-title' }, [h('span', { class: 'ck-cmdfield' }, [h('span', { class: 'ck-slash' }, state.commandPrefix || '/'), nameIn])]),
        badges: [
          cmd.broadcast ? badge(T('pl.commands-kits.badge.announce', 'announce'), 'mut') : null,
          cmd.requireLinked ? badge(T('pl.commands-kits.badge.linkedOnly', 'linked only'), 'mut') : null,
          gameWindowSet(cmd) ? badge(T('pl.commands-kits.badge.gameHours', 'game hours'), 'mut') : null,
          Number(cmd.cooldownHours) > 0 ? badge(T('pl.commands-kits.badge.cooldown', '{n}h CD', { n: cmd.cooldownHours }), 'mut') : null,
          (cmd.cost && cmd.cost.currency && cmd.cost.currency !== 'free' && Number(cmd.cost.amount) > 0) ? badge(cmd.cost.amount + ' ' + cmd.cost.currency, 'cost') : null,
          (cmd.actions && cmd.actions.length) ? badge(cmd.actions.length > 1
            ? T('pl.commands-kits.badge.actionsMany', '{n} actions', { n: cmd.actions.length })
            : T('pl.commands-kits.badge.actionsOne', '{n} action', { n: cmd.actions.length }), 'mut') : null,
        ],
        del: h('span', { class: 'ck-headbtns' }, [
          h('button', {
            class: 'ck-link', type: 'button',
            title: T('pl.commands-kits.cmd.copy.title', 'Add a copy of this command, with all its settings, right below'),
            onclick: function () { duplicateCommand(cmd, i); },
          }, T('pl.commands-kits.copy', 'copy')),
          h('button', { class: 'ck-del', title: T('pl.commands-kits.cmd.delete', 'Delete command'), onclick: function () { state.commands.splice(i, 1); markDirty(); render(); } }, [icon('close')]),
        ]),
      });
      if (!open) return h('div', { class: 'ck-card', 'data-s': s }, [head]);
      return h('div', { class: 'ck-card open', 'data-s': s }, [head, h('div', { class: 'ck-card-b' }, [
        h('div', { class: 'ck-grid' }, [
          inlineField(T('pl.commands-kits.replyIn', 'Reply in'), sel(cmd.channel || 'local', META.channels.map(function (c) { return [c, chLabels()[c] || c]; }), function (v) { cmd.channel = v; })),
          h('div', { class: 'ck-inl', title: T('pl.commands-kits.cmd.announce.hint', 'On = everyone sees the reply. Off = only the player who typed it.') }, [h('span', {}, T('pl.commands-kits.cmd.announce', 'Announce to all')), toggle(!!cmd.broadcast, function (v) { cmd.broadcast = v; render(); })]),
          h('div', { class: 'ck-inl', title: T('pl.commands-kits.linkedOnly.hint', 'On = only players with a character linked to Discord (Field Console). Off = anybody.') }, [h('span', {}, T('pl.commands-kits.linkedOnly', 'Linked players only')), toggle(!!cmd.requireLinked, function (v) { cmd.requireLinked = v; render(); })]),
          inlineField(T('pl.commands-kits.cooldownH', 'Cooldown (h)'), numf(cmd.cooldownHours, function (v) { cmd.cooldownHours = v; render(); }), T('pl.commands-kits.cmd.cooldown.hint', 'Hours before the same player can reuse it. 0 = none.')),
          inlineField(T('pl.commands-kits.cmd.group', 'Shared CD group'), txt(cmd.group, T('pl.commands-kits.cmd.group.ph', 'e.g. shops'), function (v) { cmd.group = v.trim(); }), T('pl.commands-kits.cmd.group.hint', 'Commands with the same group share ONE cooldown.')),
          h('div', { class: 'ck-inl', title: T('pl.commands-kits.cmd.savePos.hint', 'Remember the player’s position now so another command can teleport them back with {saved_x/y/z}.') }, [h('span', {}, T('pl.commands-kits.cmd.savePos', 'Remember position')), toggle(!!cmd.savePosition, function (v) { cmd.savePosition = v; })]),
          h('div', { class: 'ck-inl', title: T('pl.commands-kits.cmd.notify.hint', 'On = the player sees the game\'s feedback. Off = runs silently via the bridge.') }, [h('span', {}, T('pl.commands-kits.notify', 'Notify player')), toggle(!!cmd.notify, function (v) { cmd.notify = v; })]),
        ].concat(costRow(cmd, render).map(function (n) { return n; }))),
        h('div', { class: 'ck-grid2' }, [playerChips(T('pl.commands-kits.allowOnly', 'Allow only'), cmd, 'allow', render), playerChips(T('pl.commands-kits.deny', 'Deny'), cmd, 'deny', render)]),
        field(T('pl.commands-kits.cmd.reply', 'Reply text'), area(cmd.response, T('pl.commands-kits.cmd.reply.ph', 'Reply text (optional). One message per line. Leave empty for an action-only command.'), function (v) { cmd.response = v; })),
        field(T('pl.commands-kits.cmd.when', 'When this command works'), twEditor(cmd, markDirty), T('pl.commands-kits.cmd.when.hint', 'Empty = always works. Outside the window the command replies with its times.')),
        field(T('pl.commands-kits.cmd.whenGame', '…and at what time of day IN GAME'), gwEditor(cmd, markDirty),
          T('pl.commands-kits.cmd.whenGame.hint', 'Window on the in-game clock; both windows must allow it. Needs the bridge\'s live time.')),
        actionsBlock(cmd, render),
      ])]);
    }
    function commandsView() {
      var wrap = h('div', { class: 'ck-viewbody' });
      wrap.appendChild(tokenBar(costTokens()));
      var list = h('div', { class: 'ck-list' });
      if (!state.commands.length) list.appendChild(h('p', { class: 'ck-empty' }, T('pl.commands-kits.cmd.none', 'No commands yet — add one to get started.')));
      state.commands.forEach(function (c, i) { list.appendChild(cmdCard(c, i)); });
      var listRef = { el: list };
      var head = [
        h('button', { class: 'secondary', onclick: function () { state.commands.forEach(function (c) { expanded.add(c); }); render(); } }, T('pl.commands-kits.expandAll', 'Expand all')),
        h('button', { class: 'secondary', onclick: function () { state.commands.forEach(function (c) { expanded.delete(c); }); render(); } }, T('pl.commands-kits.collapseAll', 'Collapse all')),
        h('button', { class: 'secondary', onclick: function () { var c = { name: '', enabled: true, channel: 'local', broadcast: false, response: '', cooldownHours: 0, group: '', requireLinked: false, cost: { currency: 'free', amount: 0 }, allow: [], deny: [], actions: [] }; state.commands.push(c); expanded.add(c); markDirty(); render(); } }, T('pl.commands-kits.cmd.add', 'Add command')),
      ];
      // Once the list gets long, add a live search so admins can find a command fast.
      if (state.commands.length > 6) head.unshift(listSearch(function () { return cmdFilter; }, function (v) { cmdFilter = v; }, listRef, T('pl.commands-kits.cmd.search', 'Search commands…'))); else cmdFilter = '';
      wrap.appendChild(ckSection(T('pl.commands-kits.cmd.section', 'Chat commands'), T('pl.commands-kits.cmd.sectionSub', 'Custom /commands players type in chat — reply text and/or admin actions, with cost, cooldown, groups and allow/deny.'), [list], head));
      if (cmdFilter) filterCards(list, cmdFilter);
      return wrap;
    }

    // ── Kits & Packs view ──
    function pickedRow(entry, arr, i, domain) {
      var isVeh = domain === 'vehicles';
      var codeKey = isVeh ? 'code' : 'item', nameKey = isVeh ? 'codeName' : 'itemName', imgKey = isVeh ? 'codeImage' : 'itemImage';
      var media = entry[imgKey] ? h('img', { class: 'ck-thumb', src: entry[imgKey] }) : h('span', { class: 'ck-thumb ck-noimg' }, icon(isVeh ? 'car' : 'box'));
      return h('div', { class: 'ck-itemrow' }, [
        h('div', { class: 'ck-item-main' }, [media, h('span', { class: 'ck-picked' }, entry[codeKey] ? (entry[nameKey] || entry[codeKey]) : T('pl.commands-kits.nothingPicked', '(nothing picked)'))]),
        h('div', { class: 'ck-item-ctl' }, [
          qty(entry.count, function (v) { entry.count = v; }),
          h('button', { class: 'secondary', onclick: function () { openPicker(domain, function (it) { var id = it.spawn_code || it.id || it.code || it.name; entry[codeKey] = isVeh ? (/^BPC?_/.test(id) ? id : 'BPC_' + id) : id; entry[nameKey] = it.name; entry[imgKey] = it.image; markDirty(); render(); }); } }, entry[codeKey] ? T('pl.commands-kits.change', 'Change') : (isVeh ? T('pl.commands-kits.pickVehicle', 'Pick vehicle') : T('pl.commands-kits.pickItem', 'Pick item'))),
          h('button', { class: 'ck-del', title: T('pl.commands-kits.remove', 'Remove'), onclick: function () { arr.splice(i, 1); markDirty(); render(); } }, [icon('close')]),
        ]),
      ]);
    }
    function itemsGroup(title, arr, domain, addLabel) {
      var g = h('div', { class: 'ck-sub' }, [h('div', { class: 'ck-sub-h' }, title)]);
      if (arr.length) arr.forEach(function (entry, i) { g.appendChild(pickedRow(entry, arr, i, domain)); });
      else g.appendChild(h('p', { class: 'ck-empty' }, domain === 'vehicles' ? T('pl.commands-kits.kit.noVehicles', 'No vehicles in this kit.') : T('pl.commands-kits.kit.noItems', 'No items in this kit.')));
      var isVeh = domain === 'vehicles';
      // ── ADDING SEVERAL AT ONCE ────────────────────────────────────────────────────────────────
      //
      // This button used to append an EMPTY row, which somebody then filled with the picker — so a
      // twenty-item kit was twenty trips through a menu three levels deep, and a row nobody got back
      // to sat in the kit giving the player nothing. The picker stays open now and each pick lands
      // as a finished row with the quantity typed in the picker's own footer.
      //
      // The empty row is gone rather than kept beside it: there is no way to fill one except with
      // the same picker (the row shows a name, not a text box), so it was never an alternative route
      // to anything — only a way to leave a kit with a blank entry in it.
      g.appendChild(h('button', {
        class: 'secondary', type: 'button',
        onclick: function () {
          openMultiPicker(domain, function (it) {
            var id = it.spawn_code || it.id || it.code || it.name;
            var row = { count: Math.max(1, Number(it.count) || 1) };
            if (isVeh) {
              // The same normalisation the single picker does, and in the same shape: some records
              // give a bare id and some a prefixed one, and the game wants the prefix.
              row.code = /^BPC?_/.test(id) ? id : 'BPC_' + id;
              row.codeName = it.name; row.codeImage = it.image;
            } else {
              row.item = id; row.itemName = it.name; row.itemImage = it.image;
            }
            arr.push(row);
            markDirty(); render();
          }, function (n) {
            if (n > 1) {
              toast(isVeh
                ? T('pl.commands-kits.kit.addedVehicles', 'Added {n} vehicles.', { n: n })
                : T('pl.commands-kits.kit.addedItems', 'Added {n} items.', { n: n }));
            }
          });
        },
      }, [icon(isVeh ? 'truck' : 'box'), addLabel]));
      return g;
    }
    function invRow(entry, arr, i) {
      var cImg = entry.containerImage ? h('img', { class: 'ck-thumb', src: entry.containerImage }) : h('span', { class: 'ck-thumb ck-noimg' }, icon('box'));
      var fImg = entry.fillImage ? h('img', { class: 'ck-thumb', src: entry.fillImage }) : h('span', { class: 'ck-thumb ck-noimg' }, icon('box'));
      function pick(kId, kName, kImg) { openPicker('items', function (it) { entry[kId] = it.spawn_code || it.id || it.code || it.name; entry[kName] = it.name; entry[kImg] = it.image; markDirty(); render(); }); }
      return h('div', { class: 'ck-itemrow ck-invrow' }, [
        cImg, h('span', { class: 'ck-picked' }, entry.container ? (entry.containerName || entry.container) : T('pl.commands-kits.inv.container.none', '(container)')),
        h('button', { class: 'secondary', onclick: function () { pick('container', 'containerName', 'containerImage'); } }, entry.container ? T('pl.commands-kits.change', 'Change') : T('pl.commands-kits.inv.container', 'Container')),
        h('span', { class: 'ck-times' }, '×'), numf(entry.sets, function (v) { entry.sets = v; }),
        h('span', { class: 'ck-times' }, T('pl.commands-kits.inv.of', 'of')), fImg, h('span', { class: 'ck-picked' }, entry.fill ? (entry.fillName || entry.fill) : T('pl.commands-kits.inv.fill.none', '(fill item)')),
        h('button', { class: 'secondary', onclick: function () { pick('fill', 'fillName', 'fillImage'); } }, entry.fill ? T('pl.commands-kits.change', 'Change') : T('pl.commands-kits.inv.fill', 'Fill')),
        h('button', { class: 'ck-del', title: T('pl.commands-kits.remove', 'Remove'), onclick: function () { arr.splice(i, 1); markDirty(); render(); } }, [icon('close')]),
      ]);
    }
    function invGroup(pack) {
      pack.inventories = pack.inventories || [];
      var g = h('div', { class: 'ck-sub' }, [h('div', { class: 'ck-sub-h' }, T('pl.commands-kits.inv.title', 'Full containers (backpack / vest / crate filled with an item)'))]);
      if (pack.inventories.length) pack.inventories.forEach(function (entry, i) { g.appendChild(invRow(entry, pack.inventories, i)); });
      else g.appendChild(h('p', { class: 'ck-empty' }, T('pl.commands-kits.inv.none', 'No full containers in this kit.')));
      g.appendChild(h('button', { class: 'secondary', onclick: function () { pack.inventories.push({ sets: 1 }); markDirty(); render(); } }, [icon('box'), T('pl.commands-kits.inv.add', 'Add full container')]));
      return g;
    }

    // ── variants ───────────────────────────────────────────────────────────────────────────────
    //
    // "Once it gives this, then that" and "what the chance is of what it gives" were asked for in
    // one sentence, and they are two mechanisms — so there is ONE list with TWO modes rather than
    // two features an owner has to choose between before they know what either does.
    //
    // ⚠ **A VARIANT IS ADDED TO THE KIT, NEVER INSTEAD OF IT**, and that is written on the screen
    // rather than left to be discovered. The alternative reading would empty an existing kit the
    // moment somebody added their first variant, on a live server, with nothing saying so — and
    // "alternatives" is still perfectly expressible by leaving the kit's own lists empty, which is
    // what somebody who wants alternatives does anyway.
    function variantModes() {
      return [['random', T('pl.commands-kits.var.mode.random', 'At random, by chance')],
        ['rotate', T('pl.commands-kits.var.mode.rotate', 'In turn — each player gets the next one')]];
    }
    /**
     * The weight as a share of the pool — THE SAME READING THE BACKEND'S `readWeight` MAKES, and it
     * has to stay that way.
     *
     * ⚠ **THREE PLACES READ THIS NUMBER AND THEY BRIEFLY DISAGREED ON TWO INPUTS.** The panel draws
     * the percentage, the save route tidies what is stored, and the roll shares the pool out, and a
     * weight of `-3` read as "never comes up" here, as an equal share on save, and as "never" again
     * at the roll. A number that means one thing on the screen and another to the thing the screen
     * is a picture of is a screen nobody can act on, and it is not visible from either side alone.
     *
     * The rule, which lives in `readWeight` in the backend with its reasoning: a key nobody wrote,
     * one holding nothing, and one holding something that is not a number are all 1 — an equal
     * share; a 0 somebody typed is kept and means never; and a negative is a typo rather than a
     * decision, so it is 1 and not 0, because reading it as "never" switches a variant off over a
     * slip of the keyboard.
     *
     * `check-plugin-balance` drives this function and the backend's against the same inputs, so the
     * two cannot drift apart again.
     */
    function varWeight(v) {
      if (!v || typeof v !== 'object') return 1;
      var said = Object.prototype.hasOwnProperty.call(v, 'weight')
        && v.weight !== null && v.weight !== undefined
        && !(typeof v.weight === 'string' && String(v.weight).trim() === '');
      if (!said) return 1;
      var n = Number(v.weight);
      // Positive form: every comparison against NaN is false, so this answers 1 for one, which is
      // the "not a number at all" case rather than a special one.
      return (isFinite(n) && n >= 0) ? Math.min(Math.round(n), 1e6) : 1;
    }
    function liveVariants(pack) { return (pack.variants || []).filter(function (v) { return v && v.enabled !== false; }); }

    function variantRow(pack, v, i, mode, total) {
      var openV = expanded.has(v);
      var w = varWeight(v);
      /**
       * ⚠ **THE PERCENTAGE IS THE POINT, NOT THE WEIGHT.** A weight on its own is a number with no
       * meaning — 3 is 75% beside a 1 and 3% beside a 97 — so an owner typing weights with no total
       * in front of them is guessing. It is computed here, live, off the same rule the backend rolls
       * with, and it is the only thing on the row that makes the box usable.
       */
      var odds;
      if (mode === 'rotate') {
        var pos = liveVariants(pack).indexOf(v);
        odds = pos < 0
          ? T('pl.commands-kits.var.turnOff', 'switched off — skipped in the rotation')
          : T('pl.commands-kits.var.turn', 'turn {n} of {total}', { n: pos + 1, total: liveVariants(pack).length });
      } else if (v.enabled === false) {
        odds = T('pl.commands-kits.var.offNever', 'switched off — never comes up');
      } else if (!(total > 0)) {
        odds = T('pl.commands-kits.var.noneCanCome', 'nothing can come up');
      } else if (!(w > 0)) {
        odds = T('pl.commands-kits.var.never', 'never — its chance is 0');
      } else {
        odds = T('pl.commands-kits.var.pct', '{pct}% of claims', { pct: Math.round((w / total) * 1000) / 10 });
      }

      var head = h('div', { class: 'ck-varhead' }, [
        h('button', {
          class: 'ck-chev' + (openV ? ' open' : ''), type: 'button',
          title: openV ? T('pl.commands-kits.collapse', 'Collapse') : T('pl.commands-kits.expand', 'Expand'),
          onclick: function () { if (openV) expanded.delete(v); else expanded.add(v); render(); },
        }, [chevIcon()]),
        toggle(v.enabled !== false, function (on) { v.enabled = on; render(); }),
        txt(v.name, T('pl.commands-kits.var.namePh', 'Variant name'), function (val) { v.name = val; }, 'ck-in ck-name'),
        mode === 'rotate' ? null : inlineField(T('pl.commands-kits.var.chance', 'Chance'),
          numf(v.weight == null ? 1 : v.weight, function (val) { v.weight = val; render(); }),
          T('pl.commands-kits.var.chance.title', 'A share, not a percent: 7 and 3 means 70% and 30%.')),
        h('span', { class: 'ck-varodds' + ((mode !== 'rotate' && (v.enabled === false || !(w > 0))) ? ' bad' : '') }, odds),
        h('span', { class: 'ck-spacer' }),
        h('button', {
          class: 'ck-link', type: 'button',
          title: T('pl.commands-kits.var.copy.title', 'Add a copy of this variant, with everything in it, right below'),
          onclick: function () { duplicateVariant(pack, v, i); },
        }, T('pl.commands-kits.var.copy', 'copy')),
        h('button', {
          class: 'ck-del', type: 'button', title: T('pl.commands-kits.var.delete', 'Remove this variant'),
          onclick: function () { pack.variants.splice(i, 1); expanded.delete(v); markDirty(); render(); },
        }, [icon('close')]),
      ]);
      if (!openV) return h('div', { class: 'ck-var' }, [head]);
      v.items = v.items || []; v.vehicles = v.vehicles || []; v.inventories = v.inventories || [];
      return h('div', { class: 'ck-var open' }, [head, h('div', { class: 'ck-var-b' }, [
        h('div', { class: 'ck-cols' }, [
          itemsGroup(T('pl.commands-kits.kit.items', 'Items'), v.items, 'items', T('pl.commands-kits.kit.addItem', 'Add item')),
          itemsGroup(T('pl.commands-kits.kit.vehicles', 'Vehicles'), v.vehicles, 'vehicles', T('pl.commands-kits.kit.addVehicle', 'Add vehicle')),
        ]),
        invGroup(v),
        actionsBlock(v, render),
        field(T('pl.commands-kits.var.message', 'Message to player'),
          area(v.message, T('pl.commands-kits.var.message.ph', 'Leave empty to use the kit\'s own message.'), function (val) { v.message = val; }),
          T('pl.commands-kits.var.message.hint', 'Replaces the kit\'s message when this variant comes up. Empty uses the kit\'s message.')),
      ])]);
    }

    function variantsBlock(pack) {
      pack.variants = Array.isArray(pack.variants) ? pack.variants : [];
      var mode = (pack.variantMode === 'rotate') ? 'rotate' : 'random';
      var live = liveVariants(pack);
      var total = live.reduce(function (a, v) { return a + varWeight(v); }, 0);

      var kids = [h('div', { class: 'ck-sub-h' }, T('pl.commands-kits.var.title', 'Variants'))];
      // The sentence that stops the commonest wrong assumption about this whole feature, drawn
      // whether or not any variant exists yet — an owner reads it BEFORE they build one, which is
      // the only time it can save them anything.
      kids.push(h('p', { class: 'ck-hint' }, T('pl.commands-kits.var.intro',
        'Kit items always come, plus one variant. For either-or, leave the kit\'s items empty.')));

      if (pack.variants.length) {
        kids.push(inlineField(T('pl.commands-kits.var.mode', 'Pick one'),
          sel(mode, variantModes(), function (val) { pack.variantMode = val; render(); })));
        kids.push(h('p', { class: 'ck-hint' }, mode === 'rotate'
          ? T('pl.commands-kits.var.mode.rotate.hint', 'Each player goes down the list in turn. Failed deliveries use no turn.')
          : T('pl.commands-kits.var.mode.random.hint', 'Rolled once per claim, by each variant\'s share of the total.')));
        pack.variants.forEach(function (v, i) { kids.push(variantRow(pack, v, i, mode, total)); });
        // ⚠ **THE STATE AN OWNER CANNOT OTHERWISE SEE.** Every variant switched off, or every chance
        // typed as 0, leaves a kit that looks fully configured and quietly gives only its own
        // contents. The backend says so in the log when it happens; this says so before it does.
        if (mode !== 'rotate' && !(total > 0)) {
          kids.push(h('p', { class: 'ck-warn' }, T('pl.commands-kits.var.noneWarn',
            '⚠ No variant can come up. Switch one on with a chance above 0.')));
        } else if (mode === 'rotate' && !live.length) {
          kids.push(h('p', { class: 'ck-warn' }, T('pl.commands-kits.var.noneOnWarn',
            '⚠ Every variant is off, so only the kit\'s own items are given.')));
        } else if (mode !== 'rotate') {
          kids.push(h('p', { class: 'ck-hint' }, T('pl.commands-kits.var.totalLine',
            'The chances add up to {total}; each variant gets its share of that.', { total: Math.round(total * 100) / 100 })));
        }
      } else {
        kids.push(h('p', { class: 'ck-empty' }, T('pl.commands-kits.var.none',
          'No variants. The kit always gives exactly what is in it.')));
      }
      kids.push(h('button', {
        class: 'secondary', type: 'button',
        onclick: function () {
          var v = { id: newId('v'), name: T('pl.commands-kits.var.newName', 'New variant'), enabled: true, weight: 1,
            items: [], vehicles: [], inventories: [], actions: [], message: '' };
          pack.variants.push(v); expanded.add(v); markDirty(); render();
        },
      }, [icon('box'), T('pl.commands-kits.var.add', 'Add variant')]));
      return h('div', { class: 'ck-sub ck-vars' }, kids);
    }

    /**
     * A copy of a variant, sharing nothing with the one it came from.
     *
     * Its CHANCE comes across unchanged, deliberately: a chance is a share of the pool, so copying a
     * variant with a chance of 7 beside a 3 correctly makes it 7 : 3 : 7 — halving it on the way
     * would be a decision about somebody's odds that nobody asked for, and the row shows the new
     * percentages the moment it lands.
     */
    function duplicateVariant(pack, v, i) {
      var copy = deepCopy(v);
      copy.id = newId('v');
      copy.name = uniqueAmong(pack.variants, function (x) { return x && x.name; }, v.name, T('pl.commands-kits.var.newName', 'New variant'));
      pack.variants.splice(i + 1, 0, copy);
      expanded.add(copy);
      markDirty(); render();
      toast(T('pl.commands-kits.var.copied', 'Copied as “{name}”, with the same contents and chance.', { name: copy.name }));
    }
    function packCard(pack, idx) {
      pack.cost = pack.cost || { currency: 'free', amount: 0 }; pack.items = pack.items || []; pack.vehicles = pack.vehicles || [];
      var open = expanded.has(pack);
      var s = ((pack.name || '') + ' ' + (pack.command || '') + ' ' + (pack.group || '')).toLowerCase();
      var counts = (pack.items.length + pack.vehicles.length + (pack.inventories ? pack.inventories.length : 0));
      // ── A KIT WITH NOTHING IN IT, SAID ON THE ROW RATHER THAN ONLY INSIDE IT ─────────────────────
      //
      // The backend refuses to hand out a kit that has nothing to give, so a player is never thanked
      // for an empty parcel — but until the owner opens the kit, nothing on the list said which one
      // it was. The reward badge is simply ABSENT when the count is zero, and an absent badge reads
      // as a tidy row, not as a kit that cannot work. This is the same fact stated the other way up.
      //
      // It counts a bare entry as nothing: a row added with the picker never used has no `item` and
      // gives the player nothing, which is exactly the case an owner is most likely to leave behind.
      var hasReward = pack.items.some(function (x) { return x && x.item; })
        || pack.vehicles.some(function (x) { return x && x.code; })
        || (pack.inventories || []).some(function (x) { return x && x.container && x.fill; })
        || (pack.actions || []).some(function (a) { return String((a && (a.cmd || a.command)) || (typeof a === 'string' ? a : '')).trim(); });
      var head = cardHead(pack, {
        enable: toggle(pack.enabled, function (v) { pack.enabled = v; }),
        title: h('span', { class: 'ck-card-title' }, [h('span', { class: 'ck-cmdfield' }, [h('span', { class: 'ck-slash ck-kiticon', title: T('pl.commands-kits.kit.nameTitle', 'Kit / pack name') }, icon('box')), txt(pack.name, T('pl.commands-kits.kit.namePh', 'Kit name'), function (v) { pack.name = v; }, 'ck-in ck-name')])]),
        badges: [
          badge(pack.trigger === 'welcome' ? T('pl.commands-kits.badge.onJoin', 'on join') : ('/' + (pack.command || '?')), 'trig'),
          counts ? badge(counts > 1
            ? T('pl.commands-kits.badge.rewardsMany', '{n} rewards', { n: counts })
            : T('pl.commands-kits.badge.rewardsOne', '{n} reward', { n: counts }), 'mut') : null,
          hasReward ? null : badge(T('pl.commands-kits.badge.empty', 'nothing in it'), 'empty'),
          pack.requireLinked ? badge(T('pl.commands-kits.badge.linkedOnly', 'linked only'), 'mut') : null,
          (pack.cost && pack.cost.currency !== 'free' && Number(pack.cost.amount) > 0) ? badge(pack.cost.amount + ' ' + pack.cost.currency, 'cost') : null,
          Number(pack.cooldownHours) > 0 ? badge(T('pl.commands-kits.badge.cooldown', '{n}h CD', { n: pack.cooldownHours }), 'mut') : null,
          // On the ROW, because a kit that hands out something different every time is the one fact
          // about it that changes what every other badge means — "3 rewards" on a kit with variants
          // is not what a player gets.
          (pack.variants && pack.variants.length)
            ? badge((pack.variantMode === 'rotate')
              ? T('pl.commands-kits.badge.variantsTurn', '{n} variants, in turn', { n: pack.variants.length })
              : T('pl.commands-kits.badge.variantsChance', '{n} variants, by chance', { n: pack.variants.length }), 'trig')
            : null,
          gameWindowSet(pack) ? badge(T('pl.commands-kits.badge.gameHours', 'game hours'), 'mut') : null,
        ],
        del: h('span', { class: 'ck-headbtns' }, [
          h('button', {
            class: 'ck-link', type: 'button',
            title: T('pl.commands-kits.kit.copy.title', 'Add a copy of this kit, with everything in it, right below'),
            onclick: function () { duplicatePack(pack, idx); },
          }, T('pl.commands-kits.copy', 'copy')),
          h('button', { class: 'ck-del', title: T('pl.commands-kits.kit.delete', 'Delete pack'), onclick: function () { state.packs.splice(idx, 1); markDirty(); render(); } }, [icon('close')]),
        ]),
      });
      if (!open) return h('div', { class: 'ck-card', 'data-s': s }, [head]);
      return h('div', { class: 'ck-card open', 'data-s': s }, [head, h('div', { class: 'ck-card-b' }, [
        h('div', { class: 'ck-grid' }, [
          inlineField(T('pl.commands-kits.kit.giveWhen', 'Give when'), sel(pack.trigger || 'welcome', triggers(), function (v) { pack.trigger = v; render(); })),
          pack.trigger === 'command' ? inlineField(T('pl.commands-kits.kit.command', 'Command'), h('span', { class: 'ck-cmdwrap' }, [h('span', { class: 'ck-slash' }, state.commandPrefix || '/'), txt(pack.command, 'daily', function (v) { pack.command = v.replace(/^\/+/, '').replace(/\s+/g, ''); }, 'ck-in ck-name')])) : null,
          inlineField(T('pl.commands-kits.replyIn', 'Reply in'), sel(pack.replyChannel || 'local', META.channels.map(function (c) { return [c, chLabels()[c] || c]; }), function (v) { pack.replyChannel = v; })),
          inlineField(T('pl.commands-kits.cooldownH', 'Cooldown (h)'), numf(pack.cooldownHours, function (v) { pack.cooldownHours = v; render(); }), T('pl.commands-kits.kit.cooldown.hint', '0 = welcome once ever / command no cooldown.')),
          inlineField(T('pl.commands-kits.kit.maxPer', 'Max / player'), numf(pack.maxClaims, function (v) { pack.maxClaims = v; }), T('pl.commands-kits.kit.maxPer.hint', '0 = unlimited (subject to cooldown).')),
          inlineField(T('pl.commands-kits.kit.group', 'Exclusive group'), txt(pack.group, T('pl.commands-kits.kit.group.ph', 'e.g. starter'), function (v) { pack.group = v.trim(); }), T('pl.commands-kits.kit.group.hint', 'Packs in the same group are mutually exclusive.')),
          h('div', { class: 'ck-inl', title: T('pl.commands-kits.linkedOnly.hint', 'On = only players with a character linked to Discord (Field Console). Off = anybody.') }, [h('span', {}, T('pl.commands-kits.linkedOnly', 'Linked players only')), toggle(!!pack.requireLinked, function (v) { pack.requireLinked = v; render(); })]),
          h('div', { class: 'ck-inl', title: T('pl.commands-kits.kit.notify.hint', 'On: the player sees the game\'s spawn messages. Off: silent; your message still sends.') }, [h('span', {}, T('pl.commands-kits.notify', 'Notify player')), toggle(!!pack.notify, function (v) { pack.notify = v; })]),
          // Discord claiming is per-kit and OFF by default: turning it on for everything the moment
          // an owner updates would put kits in a public channel they never chose to publish there.
          h('div', { class: 'ck-inl', title: T('pl.commands-kits.kit.discord.hint', 'On: the kit appears in the Discord claim panel, under the same rules.') }, [h('span', {}, T('pl.commands-kits.kit.discord', 'Claim from Discord')), toggle(!!pack.discord, function (v) { pack.discord = v; render(); })]),
        ].concat(costRow(pack, render))),
        h('div', { class: 'ck-grid2' }, [playerChips(T('pl.commands-kits.allowOnly', 'Allow only'), pack, 'allow', render), playerChips(T('pl.commands-kits.deny', 'Deny'), pack, 'deny', render)]),
        h('div', { class: 'ck-cols' }, [itemsGroup(T('pl.commands-kits.kit.items', 'Items'), pack.items, 'items', T('pl.commands-kits.kit.addItem', 'Add item')), itemsGroup(T('pl.commands-kits.kit.vehicles', 'Vehicles'), pack.vehicles, 'vehicles', T('pl.commands-kits.kit.addVehicle', 'Add vehicle'))]),
        invGroup(pack),
        actionsBlock(pack, render),
        variantsBlock(pack),
        // A weekend kit, or one that only exists during an event. It is a window, not a second
        // cooldown: the cooldown asks "how long since this player last had it", the window asks
        // "is it on offer at all right now", and a kit needs both to say "once a day, evenings only".
        field(T('pl.commands-kits.kit.when', 'When this kit can be claimed'), twEditor(pack, markDirty), T('pl.commands-kits.kit.when.hint', 'Empty means any time. Outside the window a claim is refused with the times.')),
        // The second clock, beside the first and never merged with it. They are ANDed — each is a
        // restriction — and the hint says so, because "evenings only" and "at night in game" are
        // both true of a kit that has both and neither on its own explains why it is shut.
        field(T('pl.commands-kits.kit.whenGame', '…and at what time of day IN GAME'), gwEditor(pack, markDirty),
          T('pl.commands-kits.kit.whenGame.hint', 'An in-game clock window; both windows must allow it. Needs the bridge\'s live time.')),
        field(T('pl.commands-kits.kit.message', 'Message to player'), area(pack.message, T('pl.commands-kits.kit.message.ph', 'Message to the player (optional).'), function (v) { pack.message = v; })),
      ])]);
    }
    function packsView() {
      var wrap = h('div', { class: 'ck-viewbody' });
      wrap.appendChild(tokenBar(costTokens()));
      var list = h('div', { class: 'ck-list' });
      if (!state.packs.length) list.appendChild(h('p', { class: 'ck-empty' }, T('pl.commands-kits.kit.none', 'No kits yet. Add one players claim on join or by command.')));
      state.packs.forEach(function (p, i) { list.appendChild(packCard(p, i)); });
      var listRef = { el: list };
      var head = [
        h('button', { class: 'secondary', onclick: function () { state.packs.forEach(function (p) { expanded.add(p); }); render(); } }, T('pl.commands-kits.expandAll', 'Expand all')),
        h('button', { class: 'secondary', onclick: function () { state.packs.forEach(function (p) { expanded.delete(p); }); render(); } }, T('pl.commands-kits.collapseAll', 'Collapse all')),
        // ⚠ `newId`, not `'pack' + Date.now()`. Two of these pressed inside one millisecond produced
        // ONE id, and a kit's id is the key its claims, its cooldown and each player's place in its
        // variant rotation live under — so the two kits shared all three and neither screen showed
        // anything wrong. Same fix as the copy button beside it, and for the same reason.
        h('button', { class: 'secondary', onclick: function () { var p = { id: newId('pack'), name: T('pl.commands-kits.kit.newName', 'New Pack'), enabled: true, trigger: 'command', command: '', cooldownHours: 0, maxClaims: 0, group: '', requireLinked: false, cost: { currency: 'free', amount: 0 }, allow: [], deny: [], items: [], vehicles: [], inventories: [], actions: [], message: '', replyChannel: 'local' }; state.packs.push(p); expanded.add(p); markDirty(); render(); } }, T('pl.commands-kits.kit.add', 'Add pack')),
      ];
      if (state.packs.length > 6) head.unshift(listSearch(function () { return packFilter; }, function (v) { packFilter = v; }, listRef, T('pl.commands-kits.kit.search', 'Search kits…'))); else packFilter = '';
      wrap.appendChild(ckSection(navLabels().packs, T('pl.commands-kits.kit.sectionSub', 'Reward bundles — items, vehicles and full containers — claimable on join or via a command, with cost, cooldown, claim limit and groups.'), [list], head));
      if (packFilter) filterCards(list, packFilter);
      return wrap;
    }

    // ── Messages view ──
    function messagesView() {
      var wrap = h('div', { class: 'ck-viewbody' });
      wrap.appendChild(tokenBar(msgTokens()));
      var keys = Object.keys(META.defaultMessages || {});
      Object.keys(msgLabels()).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
      // Which section a key is drawn in comes from the backend; a key it does not place lands in
      // the first section, so a message added later still gets a field.
      var groups = META.messageGroups || {};
      var inGroup = {};
      Object.keys(groups).forEach(function (g) { (groups[g] || []).forEach(function (k) { inGroup[k] = g; }); });
      function grid(list) {
        var g = h('div', { class: 'ck-msggrid' });
        list.forEach(function (key) {
          g.appendChild(field(withCode(msgLabel(key)), txt(state.messages[key], (META.defaultMessages || {})[key] || '', function (v) { state.messages[key] = v; }, 'ck-in ck-grow')));
        });
        return g;
      }
      var pick = function (g) { return keys.filter(function (k) { return (inGroup[k] || '') === g; }); };
      wrap.appendChild(ckSection(T('pl.commands-kits.sysmsg.section', 'System messages'), T('pl.commands-kits.sysmsg.sectionSub', 'Shown to players in these cases. Any language, tokens work; blank uses the default.'), [grid(pick(''))]));
      if (pick('words').length) wrap.appendChild(ckSection(T('pl.commands-kits.sysmsg.words', 'Words inside those messages'), withCode(T('pl.commands-kits.sysmsg.wordsSub', 'Filled into the lines above. The in-game window line takes {from}, {to}, {now} and {speed}.')), [grid(pick('words'))]));
      if (pick('discord').length) wrap.appendChild(ckSection(T('pl.commands-kits.sysmsg.discord', 'Discord claim panel'), withCode(T('pl.commands-kits.sysmsg.discordSub', 'What players read in the private kit menu. {pack}, {left} and {window} work.')), [grid(pick('discord'))]));
      return wrap;
    }

    // What a claim is for. `null` is an entry the config no longer has.
    function kindLabel(k) {
      return k === 'kit' ? T('pl.commands-kits.kind.kit', 'Kit')
        : k === 'command' ? T('pl.commands-kits.kind.command', 'Command')
          : k === 'group' ? T('pl.commands-kits.kind.group', 'Shared cooldown group')
            : T('pl.commands-kits.kind.removed', 'No longer configured');
    }
    function loadClaims() {
      api('/claims').then(function (d) { claimsErr = null; claimsData = (d && d.claims) || []; if (claimsTable) claimsTable.refresh(); })
        // Keep whatever rows are already on screen — a request failure is not "nobody has claimed
        // anything", and the table's own `empty` text below says which of the two this is.
        .catch(function (err) { claimsErr = why(err); if (claimsTable) claimsTable.refresh(); });
    }

    // ── Activity view — one complete operational dashboard: live queue + delivery log + player claims ──
    function activityView() {
      var wrap = h('div', { class: 'ck-viewbody' });

      // 1) Live queue — what the throttled spawn queue is delivering right now + what's waiting.
      queueBox = h('div', { class: 'ck-queue' });
      var refreshQ = h('button', { class: 'secondary btn-icon', title: T('pl.commands-kits.refresh', 'Refresh'), onclick: refreshStatus }, icon('refresh'));
      wrap.appendChild(ckSection(T('pl.commands-kits.queue.section', 'Live queue'), T('pl.commands-kits.queue.sectionSub', 'Kits being delivered right now. Spawns are queued and retried so nothing is dropped.'), [queueBox], [refreshQ]));
      renderQueue();

      // 2) Delivery log — every kit/reward handed out, with clickable players + failed items.
      var clearLog = h('button', { class: 'secondary', onclick: function () { SSA.confirm(T('pl.commands-kits.log.clearConfirm', 'Clear the delivery log?')).then(function (ok) { if (!ok) return; api('/clear-history', { method: 'POST' }).then(function () { statusData.recent = []; if (actTable) actTable.refresh(); })
        // A refusal must never read like a success, and the log must not be cleared locally on a
        // failed request — it would come back on the next refresh with the admin already believing
        // it was gone.
        .catch(function (err) { toast(T('pl.commands-kits.log.clearFailed', 'The delivery log was NOT cleared — {why}', { why: why(err) }), 'error'); }); }); } }, [icon('close'), T('pl.commands-kits.log.clear', 'Clear log')]);
      // The Deliveries / Failed counters in the header only ever go up. The backend has always been
      // able to reset them and there was no way to ask it to, so an owner who fixed a broken kit was
      // left reading "Failed: 47" for ever — a number that no longer described anything.
      //
      // Next to Clear log because the two are the same act: putting the history straight after you
      // have dealt with what it was telling you.
      var resetStats = h('button', { class: 'secondary', onclick: function () {
        SSA.confirm(T('pl.commands-kits.stats.resetConfirm', 'Reset the delivery counters to zero?\n\nThe log is kept; only the header totals clear.'),
          { title: T('pl.commands-kits.stats.reset', 'Reset counters'), okLabel: T('pl.commands-kits.reset', 'Reset') }).then(function (ok) {
          if (!ok) return;
          api('/reset-stats', { method: 'POST' }).then(function () {
            statusData.stats = { deliveries: 0, ok: 0, failed: 0 };
            renderStat();
            SSA.toast(T('pl.commands-kits.stats.resetDone', 'Counters reset.'));
          }).catch(function (err) { toast(T('pl.commands-kits.stats.resetFailed', 'The counters were NOT reset — {why}', { why: why(err) }), 'error'); });
        });
      } }, [icon('refresh'), T('pl.commands-kits.stats.reset', 'Reset counters')]);
      actTable = SSA.table({
        rows: function () { return statusData.recent || []; },
        searchPlaceholder: T('pl.commands-kits.log.search', 'Search players, rewards, items…'),
        search: function (r) { return [r.player, r.steamId, r.reward].concat((r.failedItems || []).map(function (f) { return (f && f.name ? spawnLabel(f) + ' ' + (f.code || '') : (f && f.label)) || f; })).join(' '); },
        empty: T('pl.commands-kits.log.empty', 'No deliveries yet — kits and rewards handed out will show here.'),
        sort: { key: 'at', dir: 'desc' }, pageSize: 20, onRefresh: refreshStatus,
        columns: [
          { key: 'at', label: T('pl.commands-kits.col.when', 'When'), sort: true, sortVal: function (r) { return r.at || 0; }, tdClass: 'dim', render: function (r) { return document.createTextNode(fmtAgo(r.at)); } },
          { key: 'player', label: T('pl.commands-kits.col.player', 'Player'), sort: true, sortVal: function (r) { return String(r.player || r.steamId || '').toLowerCase(); }, render: function (r) { return SSA.cell.player(r.player, r.steamId); } },
          // ⚠ **THE VARIANT IS ON THE ROW BECAUSE NOTHING ELSE CAN SHOW IT.** A weighted roll is
          // invisible from every other screen: the kit's name is the same whichever variant came
          // up, so "it always gives me the same one" is a report an owner has no way to answer.
          // This column IS the answer, and it is also the only place the chances can be checked
          // against what really went out.
          { key: 'reward', label: T('pl.commands-kits.col.reward', 'Reward'), sort: true,
            sortVal: function (r) { return String(r.reward || '').toLowerCase(); },
            render: function (r) {
              var box = document.createElement('span');
              box.appendChild(document.createTextNode(r.reward || ''));
              if (r.variant) box.appendChild(h('span', { class: 'ck-varpill', title: T('pl.commands-kits.log.variant.title', 'Which variant of this kit was given') }, r.variant));
              return box;
            } },
          // Sortable by failures so you can click the header to surface the problem deliveries first.
          // Sorting puts UNPAID above merely-failed: a kit that partly failed to spawn is a bad
          // evening, one that was handed over for free is money.
          { key: 'result', label: T('pl.commands-kits.col.result', 'Result'), sort: true, sortVal: function (r) { return (r.unpaid ? 100 : 0) + (r.failed || 0); }, render: function (r) {
            var bad = (r.failed || 0) > 0;
            var tag = SSA.cell.tag((r.spawned || 0) + '/' + (r.total || 0), bad || r.unpaid ? 'bad' : 'ok');
            // The charge can fail after the items have already landed — they cannot be taken back,
            // so the only thing left is to make it visible. Without this an unpaid delivery sat in
            // this log looking exactly like a paid one.
            if (r.unpaid) {
              var ub = h('div', { class: 'ck-result' }, [tag, SSA.cell.tag(T('pl.commands-kits.tag.notPaid', 'NOT PAID') + (r.priceCurrency ? ' · ' + r.priceAmount + ' ' + (curLabels()[r.priceCurrency] || r.priceCurrency) : (r.price ? ' · ' + r.price : '')), 'bad')]);
              if (bad && (r.failedItems || []).length) {
                (r.failedItems || []).forEach(function (fi) {
                  var c = (fi && fi.code) || (typeof fi === 'string' ? fi : '');
                  ub.appendChild(SSA.cell.item(c, (fi && fi.name ? spawnLabel(fi) : (fi && fi.label)) || c));
                });
              }
              return ub;
            }
            if (!bad) return tag;
            var box = h('div', { class: 'ck-result' }, [tag]);
            // A kit is priced as a whole, so a partial delivery is charged in full. That is a
            // decision for the owner to make case by case — which they can only do if they can SEE
            // it, hence its own tag rather than a number in a column.
            if (r.partial) box.appendChild(SSA.cell.tag(T('pl.commands-kits.tag.paidInFull', 'PAID IN FULL'), 'bad'));
            if (r.actionsRefused) box.appendChild(SSA.cell.tag(T('pl.commands-kits.tag.actionsRefused', 'actions refused — not charged'), 'warn'));
            var items = r.failedItems || [];
            if (items.length) {
              items.forEach(function (fi) {
                var code = (fi && fi.code) || (typeof fi === 'string' ? fi : '');
                var label = (fi && fi.name ? spawnLabel(fi) : (fi && fi.label)) || code;
                // Native clickable item preview — same popover as the mine-protection table / Log Viewer.
                box.appendChild(SSA.cell.item(code, label));
              });
            } else {
              box.appendChild(h('span', { class: 'ck-failed' }, T('pl.commands-kits.tag.failed', '{n} failed', { n: r.failed })));
            }
            return box;
          } },
        ],
      });
      // The sentence names the Result column, so it is built from that column's own label rather
      // than written out a second time.
      wrap.appendChild(ckSection(T('pl.commands-kits.log.section', 'Delivery log'), T('pl.commands-kits.log.sectionSub', 'Every kit and reward given. Click a player to open them, {column} to sort failures first.', { column: T('pl.commands-kits.col.result', 'Result') }), [actTable.el], [resetStats, clearLog]));

      // 3) Player claims — who has claimed what; reset a row to let a player use a one-time reward again.
      var clearAll = h('button', { class: 'secondary', onclick: function () { SSA.confirm(T('pl.commands-kits.claims.clearConfirm', 'Clear ALL claims for everyone? Every player can then use every reward again.'), { okLabel: T('pl.commands-kits.claims.clearOk', 'Clear all') }).then(function (ok) { if (!ok) return; api('/claims/clear', { method: 'POST', body: {} }).then(function () { toast(T('pl.commands-kits.claims.cleared', 'All claims cleared')); loadClaims(); }).catch(function (err) { toast(T('pl.commands-kits.claims.clearFailed', 'Claims were NOT cleared — {why}', { why: why(err) }), 'error'); }); }); } }, [icon('close'), T('pl.commands-kits.claims.clear', 'Clear all claims')]);
      claimsTable = SSA.table({
        rows: function () { return claimsData; },
        searchPlaceholder: T('pl.commands-kits.claims.search', 'Search players, rewards…'),
        search: function (r) { return [r.name, r.steamId, r.reward || r.packId, kindLabel(r.rewardKind)].join(' '); },
        // A function, not a string, so "this could not be read" and "nobody has claimed anything"
        // stay two different sentences — the first is about the request, the second about the world.
        empty: function () { return claimsErr ? T('pl.commands-kits.claims.readFailed', 'This list could not be read — {why}', { why: claimsErr }) : T('pl.commands-kits.claims.empty', 'Nobody has claimed anything yet. Players appear here after their first kit.'); },
        sort: { key: 'at', dir: 'desc' }, pageSize: 10, onRefresh: loadClaims,
        columns: [
          { key: 'player', label: T('pl.commands-kits.col.player', 'Player'), sort: true, sortVal: function (r) { return (r.name || r.steamId || '').toLowerCase(); }, render: function (r) { return SSA.cell.player(r.name, r.steamId); } },
          { key: 'packId', label: T('pl.commands-kits.col.reward', 'Reward'), sort: true, sortVal: function (r) { return String(r.reward || r.packId || '').toLowerCase(); },
            render: function (r) { return h('span', {}, [document.createTextNode(r.reward || r.packId || ''), h('span', { class: 'ck-kind' + (r.rewardKind ? '' : ' gone') }, kindLabel(r.rewardKind))]); } },
          { key: 'count', label: T('pl.commands-kits.col.uses', 'Uses'), sort: true, sortVal: function (r) { return r.count || 1; }, tdClass: 'mono', render: function (r) { return document.createTextNode(String(r.count || 1)); } },
          { key: 'at', label: T('pl.commands-kits.col.lastUsed', 'Last used'), sort: true, sortVal: function (r) { return r.at || 0; }, tdClass: 'dim', render: function (r) { return document.createTextNode(r.at ? new Date(r.at).toLocaleString() : '—'); } },
          { key: 'reset', label: '', render: function (r) { return h('button', { class: 'secondary', title: T('pl.commands-kits.claims.resetTitle', 'Let this player use it again'), onclick: function () { api('/claims/reset', { method: 'POST', body: { packId: r.packId, steamId: r.steamId } }).then(function () { toast(T('pl.commands-kits.reset', 'Reset')); loadClaims(); }).catch(function (err) { toast(T('pl.commands-kits.claims.resetFailed', 'NOT reset — {why}', { why: why(err) }), 'error'); }); } }, T('pl.commands-kits.reset', 'Reset')); } },
        ],
      });
      wrap.appendChild(ckSection(T('pl.commands-kits.claims.section', 'Player claims'), T('pl.commands-kits.claims.sectionSub', 'Who claimed which reward. Reset a row to allow a one-time reward again.'), [claimsTable.el], [clearAll]));

      loadClaims();
      refreshStatus();
      return wrap;
    }

    // ── Settings view ──
    function settingsView() {
      var wrap = h('div', { class: 'ck-viewbody' });
      var w = state.welcome;
      wrap.appendChild(h('div', { class: 'card ck-card ck-open-card' }, [
        h('h3', { class: 'ck-card-t' }, T('pl.commands-kits.set.general', 'General')),
        h('div', { class: 'ck-grid' }, [
          inlineField(T('pl.commands-kits.set.prefix', 'Command prefix'), txt(state.commandPrefix || '/', '/', function (v) { state.commandPrefix = (v || '/').trim().slice(0, 3) || '/'; }), T('pl.commands-kits.set.prefix.hint', 'What players type before a command. Set here — overrides the bridge.')),
          inlineField(T('pl.commands-kits.set.replyChannel', 'Default reply channel'), sel(state.replyChannel || 'local', META.channels.map(function (c) { return [c, chLabels()[c] || c]; }), function (v) { state.replyChannel = v; }), T('pl.commands-kits.set.replyChannel.hint', 'Used when a command/pack has no channel of its own.')),
          inlineField(T('pl.commands-kits.set.welcomeDelay', 'Welcome delay (s)'), numf(state.joinDelaySeconds, function (v) { state.joinDelaySeconds = v; }), T('pl.commands-kits.set.welcomeDelay.hint', '0 = greet instantly on spawn-in.')),
        ]),
      ]));
      wrap.appendChild(h('div', { class: 'card ck-card ck-open-card' }, [
        h('h3', { class: 'ck-card-t' }, T('pl.commands-kits.set.delivery', 'Delivery reliability')),
        // "…on the Activity tab" names one of this tab's own five screens, so the name comes from
        // the button's own key rather than being written out here a second time.
        h('p', { class: 'ck-card-sub' }, T('pl.commands-kits.set.delivery.sub', 'Spawns are queued and retried so every item arrives. Watch it on the {where} tab.', { where: navLabels().activity })),
        h('div', { class: 'ck-grid' }, [
          inlineField(T('pl.commands-kits.set.spawnGap', 'Spawn gap (seconds)'), numf(Number(state.spawnGapMs) / 1000, function (v) { state.spawnGapMs = Math.round(v * 1000); }, { min: 0, max: 3, step: 0.01 }), T('pl.commands-kits.set.spawnGap.hint', 'Delay between spawns. Higher = gentler on the server during mass events.')),
          inlineField(T('pl.commands-kits.set.spawnTries', 'Spawn attempts'), numf(state.spawnTries, function (v) { state.spawnTries = v; }, { min: 1, max: 6 }), T('pl.commands-kits.set.spawnTries.hint', 'Tries per item before giving up (1 = no retry). Recovers transient bridge faults.')),
        ]),
      ]));
      // ── Discord claim panel ───────────────────────────────────────────────────
      state.discord = state.discord || {};
      var d = state.discord;
      // The route answers a code; the sentence is this panel's, in the reader's language.
      var postRefusal = function (r) {
        var c = r && r.code;
        if (c === 'noChannel') return T('pl.commands-kits.dc.err.noChannel', 'no channel is set for the Discord panel');
        if (c === 'noKits') return T('pl.commands-kits.dc.err.noKits', 'no kit has "{switch}" on yet', { switch: T('pl.commands-kits.kit.discord', 'Claim from Discord') });
        if (c === 'postFailed') return T('pl.commands-kits.dc.err.postFailed', 'the bot could not post there (missing channel or permission)');
        return (r && r.reason) || (r && r.error) || T('pl.commands-kits.dc.unknown', 'unknown');
      };
      var dChan = h('select', { class: 'ck-in' }, [h('option', { value: d.channelId || '' }, d.channelId ? T('pl.commands-kits.dc.current', '(current)') : T('pl.commands-kits.dc.pick', '— pick a channel —'))]);
      api('/discord-channels').then(function (list) {
        dChan.innerHTML = '';
        dChan.appendChild(h('option', { value: '' }, (list && list.length) ? T('pl.commands-kits.dc.pick', '— pick a channel —') : T('pl.commands-kits.dc.noChannels', 'No channels (bot offline?)')));
        (list || []).forEach(function (ch) { dChan.appendChild(h('option', { value: ch.id }, '#' + ch.name)); });
        dChan.value = d.channelId || '';
      }).catch(function (err) {
        // "No channels (bot offline?)" is a guess about the WORLD and is wrong here — the request
        // itself failed, so say that instead of leaving an owner to read a guess as the answer.
        dChan.innerHTML = '';
        dChan.appendChild(h('option', { value: '' }, T('pl.commands-kits.dc.loadFailed', 'Could not load channels — {why}', { why: why(err) })));
        dChan.value = '';
      });
      dChan.addEventListener('change', function () { d.channelId = dChan.value; markDirty(); });
      var postStatus = h('span', { class: 'muted', style: 'font-size:.82rem' });
      var claimable = state.packs.filter(function (p) { return p.discord && p.enabled !== false; });
      var postBtn = h('button', { class: 'primary', onclick: function () {
        postStatus.textContent = T('pl.commands-kits.dc.posting', 'Posting…');
        api('/post-panel', { method: 'POST', body: { channelId: d.channelId } }).then(function (r) {
          // Say WHY when nothing was posted. "Posted ✓" for a missing channel or a kit list with
          // nothing marked claimable is the sort of answer that sends an owner looking in Discord
          // for a message that was never sent. A 200 without `ok` is a refusal too, and the route's
          // own `reason` is worth more than its bare `error` code when it sent one.
          postStatus.textContent = (r && r.ok) ? T('pl.commands-kits.dc.posted', 'Posted ✓')
            : T('pl.commands-kits.dc.notPosted', 'Not posted — {why}', { why: postRefusal(r) });
        }).catch(function (err) { postStatus.textContent = T('pl.commands-kits.dc.notPosted', 'Not posted — {why}', { why: why(err) }); });
      // `i-discord`, not `i-send`: there is no send icon in the panel's sprite, and a missing one
      // renders NOTHING — no error, no broken-image mark, just a button that looks unfinished.
      } }, [icon('discord'), T('pl.commands-kits.dc.post', 'Post the panel')]);
      wrap.appendChild(h('div', { class: 'card ck-card ck-open-card' }, [
        h('h3', { class: 'ck-card-t' }, T('pl.commands-kits.dc.section', 'Discord claim panel')),
        h('p', { class: 'ck-card-sub' }, T('pl.commands-kits.dc.sectionSub', 'Post a button so players claim kits from Discord; the in-game rules still apply.')),
        h('div', { class: 'ck-grid' }, [
          inlineField(T('pl.commands-kits.dc.channel', 'Channel'), dChan, T('pl.commands-kits.dc.channel.hint', 'Where the panel message is posted.')),
          inlineField(T('pl.commands-kits.dc.button', 'Button label'), txt(d.buttonLabel || '', '🎁 Claim a kit', function (v) { d.buttonLabel = v; })),
          inlineField(T('pl.commands-kits.dc.title', 'Title'), txt(d.title || '', '🎁 Claim a kit', function (v) { d.title = v; })),
        ]),
        field(T('pl.commands-kits.dc.description', 'Description'), area(d.description, T('pl.commands-kits.dc.description.ph', 'Text inside the panel embed (optional).'), function (v) { d.description = v; })),
        // Which kits it will actually offer — the setting that decides this lives on each kit, so
        // saying it here saves an owner opening every card to find out why the menu is empty. Both
        // sentences name the switch and the screen it is on, and both names are read off the very
        // keys those controls render from, so neither can be pointing somewhere that is not there.
        h('p', { class: claimable.length ? 'ck-card-sub' : 'ck-warn' }, claimable.length
          ? (claimable.length === 1
            ? T('pl.commands-kits.dc.offers.one', 'Offers {n} kit: {list}. Turn "{switch}" on a kit to add it.', offersVars(claimable))
            : T('pl.commands-kits.dc.offers', 'Offers {n} kits: {list}. Turn "{switch}" on a kit to add it.', offersVars(claimable)))
          : T('pl.commands-kits.dc.offersNone', '⚠ No kit has "{switch}" on. Turn it on for one in the {where} tab.',
            { switch: T('pl.commands-kits.kit.discord', 'Claim from Discord'), where: navLabels().packs })),
        h('div', { class: 'ck-actions' }, [postBtn, postStatus]),
      ]));

      wrap.appendChild(h('div', { class: 'card ck-card ck-open-card' }, [
        h('h3', { class: 'ck-card-t' }, T('pl.commands-kits.welcome.section', 'Welcome message')),
        h('div', { class: 'ck-grid' }, [
          h('div', { class: 'ck-inl' }, [h('span', {}, T('pl.commands-kits.enabled', 'Enabled')), toggle(w.enabled, function (v) { w.enabled = v; })]),
          inlineField(T('pl.commands-kits.dc.channel', 'Channel'), sel(w.channel || 'local', META.channels.map(function (c) { return [c, chLabels()[c] || c]; }), function (v) { w.channel = v; })),
        ]),
        tokenBar(),
        field(T('pl.commands-kits.welcome.message', 'Message'), area(w.message, T('pl.commands-kits.welcome.message.ph', 'Message sent to a player when they join.'), function (v) { w.message = v; })),
      ]));
      wrap.appendChild(h('details', { class: 'card ck-card ck-adv' }, [
        h('summary', {}, T('pl.commands-kits.adv.section', 'Advanced — spawn command templates')),
        // The braces in this sentence are the plugin's own tokens, listed for an owner to copy —
        // they are not variables of the sentence and must come through a translation untouched.
        h('p', { class: 'ck-hint' }, T('pl.commands-kits.adv.hint', 'Placeholders: {item} {code} {count} {container} {sets} {fill} {steamid} {x} {y} {z}. Defaults spawn on the player by SteamID; the full-container command runs through the player.')),
        field(T('pl.commands-kits.adv.item', 'Item spawn command'), txt(state.itemSpawnCmd, '', function (v) { state.itemSpawnCmd = v; }, 'ck-in ck-grow')),
        field(T('pl.commands-kits.adv.vehicle', 'Vehicle spawn command'), txt(state.vehicleSpawnCmd, '', function (v) { state.vehicleSpawnCmd = v; }, 'ck-in ck-grow')),
        field(T('pl.commands-kits.adv.container', 'Full container command'), txt(state.invSpawnCmd, '', function (v) { state.invSpawnCmd = v; }, 'ck-in ck-grow')),
      ]));
      return wrap;
    }

    function render() {
      renderStat();
      renderFirstRun();
      // Drop references to the previous view's live widgets so realtime updates don't touch detached nodes.
      actTable = null; claimsTable = null; queueBox = null;
      body.innerHTML = '';
      body.appendChild(state.view === 'commands' ? commandsView()
        : state.view === 'packs' ? packsView()
          : state.view === 'messages' ? messagesView()
            : state.view === 'activity' ? activityView()
              : settingsView());
    }

    function save() {
      status.textContent = T('pl.commands-kits.saving', 'Saving…'); saveBtn.disabled = true;
      var clean = {
        commands: state.commands.filter(function (c) { return (c.name || '').trim(); }),
        welcome: state.welcome, packs: state.packs, messages: state.messages,
        replyChannel: state.replyChannel, commandPrefix: state.commandPrefix || '/',
        itemSpawnCmd: state.itemSpawnCmd, vehicleSpawnCmd: state.vehicleSpawnCmd, invSpawnCmd: state.invSpawnCmd, joinDelaySeconds: state.joinDelaySeconds,
        spawnGapMs: state.spawnGapMs, spawnTries: state.spawnTries,
        // The save builds an EXPLICIT object rather than sending `state`, so anything not listed
        // here is silently dropped on every save — the Discord panel settings would have looked
        // like they saved and been gone on the next reload.
        discord: state.discord || {},
      };
      api('/config', { method: 'POST', body: clean }).then(function (r) {
        saveBtn.disabled = false;
        if (r && r.ok) { dirty = false; saveBtn.classList.remove('ck-unsaved'); status.textContent = T('pl.commands-kits.savedTick', 'Saved ✓'); toast(T('pl.commands-kits.saved', 'Saved')); setTimeout(function () { if (!dirty) status.textContent = ''; }, 2500); }
        else {
          // A 200 without `ok` is a refusal too, and it may have said why.
          var w = (r && r.reason) || (r && r.error) || T('pl.commands-kits.noReason', 'the manager did not say why');
          status.textContent = T('pl.commands-kits.notSaved', 'NOT saved — {why}', { why: w }); toast(T('pl.commands-kits.notSaved', 'NOT saved — {why}', { why: w }), 'error');
        }
      }).catch(function (err) {
        // The sentence STAYS beside the Save button until the next attempt — a toast is gone in
        // four seconds and the owner's unsaved edits are still sitting right there in front of them.
        saveBtn.disabled = false;
        status.textContent = T('pl.commands-kits.notSaved', 'NOT saved — {why}', { why: why(err) });
        toast(T('pl.commands-kits.notSaved', 'NOT saved — {why}', { why: why(err) }), 'error');
      });
    }
    function toast(m, k) { if (window.SSA && SSA.toast) SSA.toast(m, k); }
    function normCh(v) { return META.channels.indexOf(v) >= 0 ? v : 'local'; }

    // Where the first load's failure goes. Without a slot, a throwing client only moves the
    // silence: the promise rejects, `render()` never runs, and the tab sits on "Loading…" for
    // ever — which reads as slow rather than as broken.
    function loadFailed(err) {
      body.innerHTML = '';
      var retry = h('button', { type: 'button', class: 'secondary', onclick: function () { body.innerHTML = ''; body.appendChild(h('p', { class: 'ck-loading' }, T('pl.commands-kits.loading', 'Loading…'))); load(); } }, T('pl.commands-kits.tryAgain', 'Try again'));
      body.appendChild(h('div', { class: 'ck-err' }, [
        h('strong', {}, T('pl.commands-kits.loadFailed', 'This tab could not load its settings. ')),
        h('span', {}, why(err)),
        h('div', { class: 'ck-err-act' }, [retry]),
      ]));
    }
    function load() {
      Promise.all([api('/meta'), api('/config')]).then(function (r) {
        var m = r[0] || {};
        if (m.channels) META.channels = m.channels;
        if (m.currencies) META.currencies = m.currencies;
        if (m.defaultMessages) META.defaultMessages = m.defaultMessages;
        if (m.messageGroups && typeof m.messageGroups === 'object') META.messageGroups = m.messageGroups;
        var cfg = r[1] || {};
        state.commands = (Array.isArray(cfg.commands) ? cfg.commands : []).map(function (c) { c.channel = normCh(c.channel); return c; });
        state.welcome = (cfg.welcome && typeof cfg.welcome === 'object') ? cfg.welcome : {}; state.welcome.channel = normCh(state.welcome.channel);
        state.packs = (Array.isArray(cfg.packs) ? cfg.packs : []).map(function (p) { p.replyChannel = normCh(p.replyChannel); return p; });
        state.messages = (cfg.messages && typeof cfg.messages === 'object') ? cfg.messages : {};
        state.replyChannel = normCh(cfg.replyChannel || 'local');
        state.commandPrefix = cfg.commandPrefix || '/';
        state.itemSpawnCmd = cfg.itemSpawnCmd || '#SpawnItem {item} {count} Location {steamid}';
        state.vehicleSpawnCmd = cfg.vehicleSpawnCmd || '#SpawnVehicle {code} {count} Location {steamid}';
        state.invSpawnCmd = (!cfg.invSpawnCmd || cfg.invSpawnCmd === '#SpawnInventoryFullOf {container} {sets} {fill}') ? '#SpawnInventoryFullOf {container} {fill}' : cfg.invSpawnCmd;
        state.joinDelaySeconds = cfg.joinDelaySeconds != null ? cfg.joinDelaySeconds : 0;
        state.spawnGapMs = cfg.spawnGapMs != null ? cfg.spawnGapMs : 180;
        state.spawnTries = cfg.spawnTries != null ? cfg.spawnTries : 3;
        render();
        refreshStatus();   // pull live queue/counters for the header + activity log
      }).catch(loadFailed);
    }
    paintNav();
    load();
  }

  SSA.ready(function () { SSA.registerTab({ id: 'commands-kits', label: T('pl.commands-kits.tab', 'Commands & Kits'), icon: '#i-chat', premium: true, render: editor }); });
})();
