/* Chat Commands & Kits — admin UI.
   Four tabs: Commands (reply + admin actions), Kits & Packs (rewards + picker), Messages (all
   player-facing text, any language), Users (who claimed what → reset). Saves the whole config. */
(function () {
  var API = '/api/plugin-host/commands-kits';
  var CHANNELS = ['local', 'global', 'squad', 'admin', 'server'];
  var CURRENCIES = ['free', 'money', 'gold', 'fame'];
  var TRIGGERS = [['welcome', 'On join (welcome)'], ['command', 'Chat command']];
  var TOKENS = ['{player}', '{steamid}', '{online}', '{maxplayers}', '{server}', '{args}', '{arg1}', '{money}', '{gold}', '{fame}', '{kills}', '{deaths}', '{squad}', '{location}', '{x}', '{y}', '{z}', '{saved_x}', '{saved_y}', '{saved_z}', '{date}', '{time}'];
  var MSG_LABELS = {
    cooldown: 'Cooldown not elapsed', alreadyClaimed: 'Already claimed (one-time)', groupLocked: 'Locked by an exclusive group',
    maxClaims: 'Claim limit reached', notAllowed: 'Player not allowed', insufficient: "Can't afford it",
    notInGame: 'Not fully spawned in', spawnFailed: 'Delivery/spawn failed',
  };
  var DEFAULT_MSG = {};

  function api(p, opts) {
    opts = opts || {}; var init = Object.assign({ credentials: 'same-origin' }, opts);
    if (init.body && typeof init.body === 'object') { init.headers = Object.assign({ 'Content-Type': 'application/json' }, init.headers || {}); init.body = JSON.stringify(init.body); }
    return fetch(API + p, init).then(function (r) { return r.json().catch(function () { return {}; }); });
  }
  function h(tag, props, kids) {
    var e = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      if (k === 'class') e.className = props[k]; else if (k === 'html') e.innerHTML = props[k]; else if (k === 'text') e.textContent = props[k];
      else if (k.slice(0, 2) === 'on' && typeof props[k] === 'function') e.addEventListener(k.slice(2), props[k]);
      else if (props[k] != null && props[k] !== false) e.setAttribute(k, props[k] === true ? '' : props[k]);
    });
    (Array.isArray(kids) ? kids : (kids != null ? [kids] : [])).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function sel(value, options, onchange, cls) {
    var s = h('select', { class: cls || 'ck-in', onchange: function () { onchange(s.value); } }, options.map(function (o) { var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; return h('option', { value: v, selected: value === v || undefined }, l); }));
    return s;
  }
  function txt(value, ph, oninput, cls) { var i = h('input', { class: cls || 'ck-in', type: 'text', placeholder: ph || '', oninput: function () { oninput(i.value); } }); i.value = value == null ? '' : value; return i; }
  function numf(value, oninput) { var i = h('input', { class: 'ck-in ck-num', type: 'number', min: 0, oninput: function () { oninput(Number(i.value) || 0); } }); i.value = value == null ? 0 : value; return i; }
  function chk(checked, onchange) { var b = h('input', { type: 'checkbox', onchange: function () { onchange(b.checked); } }); b.checked = checked !== false; return b; }

  // ── item / vehicle picker (same endpoint as the live map) ─────────────────────
  var pickTimer = null;
  function openPicker(domain, onPick) {
    var overlay = h('div', { class: 'ck-overlay', onclick: function (e) { if (e.target === overlay) overlay.remove(); } });
    var q = h('input', { class: 'ck-in', type: 'text', placeholder: 'Search ' + (domain === 'vehicles' ? 'vehicles' : 'items') + '…', oninput: function () { clearTimeout(pickTimer); pickTimer = setTimeout(load, 250); } });
    var results = h('div', { class: 'ck-results' });
    function load() {
      var lang = (localStorage.getItem('admin-lang') || 'en');
      fetch('/api/public/items?domain=' + encodeURIComponent(domain) + '&q=' + encodeURIComponent(q.value.trim()) + '&lang=' + encodeURIComponent(lang), { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          results.innerHTML = '';
          var items = (d && d.items) || [];
          if (!items.length) { results.appendChild(h('p', { class: 'ck-empty' }, d && d.available === false ? 'Item database unavailable.' : 'No matches.')); return; }
          items.forEach(function (it) {
            results.appendChild(h('div', { class: 'ck-pick', onclick: function () { onPick(it); overlay.remove(); } }, [
              it.image ? h('img', { class: 'ck-pick-img', src: it.image, loading: 'lazy' }) : h('span', { class: 'ck-pick-img' }),
              h('span', { class: 'ck-pick-name' }, it.name || it.id || it.code),
            ]));
          });
        }).catch(function () { results.innerHTML = ''; results.appendChild(h('p', { class: 'ck-empty' }, 'Search failed.')); });
    }
    overlay.appendChild(h('div', { class: 'ck-modal' }, [
      h('div', { class: 'ck-modal-h' }, [h('strong', {}, domain === 'vehicles' ? 'Choose a vehicle' : 'Choose an item'), h('button', { class: 'ck-x', onclick: function () { overlay.remove(); } }, '✕')]),
      q, results,
    ]));
    document.body.appendChild(overlay); q.focus(); load();
  }

  // ── player picker (online list + manual SteamID) ──────────────────────────────
  function openPlayerPicker(onPick) {
    var overlay = h('div', { class: 'ck-overlay', onclick: function (e) { if (e.target === overlay) overlay.remove(); } });
    var manual = h('input', { class: 'ck-in', type: 'text', placeholder: 'Paste a SteamID (17 digits)…' });
    var addManual = h('button', { class: 'ck-btn', onclick: function () { var v = (manual.value || '').trim(); if (/^\d{17}$/.test(v)) { onPick({ steamId: v, name: '' }); overlay.remove(); } else { manual.style.borderColor = '#e66'; } } }, 'Add');
    var results = h('div', { class: 'ck-results' });
    api('/players').then(function (d) {
      var list = (d && d.players) || [];
      results.innerHTML = '';
      if (!list.length) { results.appendChild(h('p', { class: 'ck-empty' }, 'No players online — paste a SteamID above.')); return; }
      list.forEach(function (p) {
        results.appendChild(h('div', { class: 'ck-pick', onclick: function () { onPick(p); overlay.remove(); } }, [
          h('span', { class: 'ck-pick-img', text: '👤' }), h('span', { class: 'ck-pick-name' }, (p.name || p.steamId) + (p.name ? ('  ·  ' + p.steamId) : '')),
        ]));
      });
    }).catch(function () { results.appendChild(h('p', { class: 'ck-empty' }, 'Could not load players.')); });
    overlay.appendChild(h('div', { class: 'ck-modal' }, [
      h('div', { class: 'ck-modal-h' }, [h('strong', {}, 'Choose a player'), h('button', { class: 'ck-x', onclick: function () { overlay.remove(); } }, '✕')]),
      h('div', { class: 'ck-row', style: 'margin:12px 14px 6px;' }, [manual, addManual]),
      results,
    ]));
    document.body.appendChild(overlay); manual.focus();
  }

  // allow/deny chip editor. `entry[key]` is an array of {steamId,name} OR bare steamId strings.
  function idList(entry, key) { return (Array.isArray(entry[key]) ? entry[key] : []).map(function (e) { return (e && typeof e === 'object') ? e : { steamId: String(e), name: '' }; }); }
  function playerListRow(label, entry, key, rerender) {
    entry[key] = idList(entry, key);
    var chips = entry[key].map(function (p, i) {
      return h('span', { class: 'ck-chip' }, [h('span', {}, p.name ? (p.name) : p.steamId), h('button', { class: 'ck-chip-x', title: p.steamId, onclick: function () { entry[key].splice(i, 1); rerender(); } }, '✕')]);
    });
    chips.push(h('button', { class: 'ck-add', onclick: function () { openPlayerPicker(function (p) { if (!entry[key].some(function (x) { return x.steamId === p.steamId; })) entry[key].push({ steamId: p.steamId, name: p.name || '' }); rerender(); }); } }, '+ player'));
    return h('label', { class: 'ck-inline ck-players' }, [h('span', {}, label), h('span', { class: 'ck-chips' }, chips)]);
  }

  // actions editor (admin commands run when a command/pack fires). Each: { cmd, delaySeconds }.
  function actionsBlock(entry, rerender) {
    entry.actions = Array.isArray(entry.actions) ? entry.actions : [];
    var rows = entry.actions.map(function (a, i) {
      return h('div', { class: 'ck-row2' }, [
        txt(a.cmd, '#Teleport {x} {y} {z} {steamid}', function (v) { a.cmd = v; }, 'ck-in ck-grow'),
        h('label', { class: 'ck-inline' }, [h('span', {}, 'after (s)'), numf(a.delaySeconds, function (v) { a.delaySeconds = v; })]),
        h('button', { class: 'ck-del', onclick: function () { entry.actions.splice(i, 1); rerender(); } }, '✕'),
      ]);
    });
    return h('div', { class: 'ck-group' }, [
      h('div', { class: 'ck-group-h' }, 'Admin actions (optional)'),
      h('div', {}, rows.length ? rows : [h('p', { class: 'ck-empty' }, 'No actions. Add e.g. a teleport, currency or buff command.')]),
      h('button', { class: 'ck-add', onclick: function () { entry.actions.push({ cmd: '', delaySeconds: 0 }); rerender(); } }, '+ Add action'),
      h('p', { class: 'ck-help' }, 'Runs any admin command with tokens. Position is frozen at use — e.g. teleport away now, then `#Teleport {x} {y} {z} {steamid}` with after=60 sends them back.'),
    ]);
  }

  function costRow(obj, rerender) {
    obj.cost = obj.cost || { currency: 'free', amount: 0 };
    return [
      h('label', { class: 'ck-inline' }, [h('span', {}, 'Cost'), sel(obj.cost.currency || 'free', CURRENCIES, function (v) { obj.cost.currency = v; rerender(); })]),
      obj.cost.currency && obj.cost.currency !== 'free' ? h('label', { class: 'ck-inline' }, [h('span', {}, 'Amount'), numf(obj.cost.amount, function (v) { obj.cost.amount = v; })]) : null,
    ];
  }

  function editor(el) {
    el.innerHTML = '';
    var state = { commands: [], welcome: {}, packs: [], messages: {}, replyChannel: 'local', commandPrefix: '/', itemSpawnCmd: '', vehicleSpawnCmd: '', invSpawnCmd: '', joinDelaySeconds: 0, view: 'commands' };
    var body = h('div', { class: 'ck-body' });
    var status = h('span', { class: 'ck-status' });

    // ---- Commands section ----
    function welcomeCard() {
      var w = state.welcome;
      var msg = h('textarea', { class: 'ck-msg', rows: 2, placeholder: 'Message sent to a player when they join.', oninput: function () { w.message = msg.value; } }); msg.value = w.message || '';
      return h('div', { class: 'ck-card ck-accent' }, [
        h('div', { class: 'ck-row' }, [h('strong', {}, '👋 Welcome message'),
          h('label', { class: 'ck-inline' }, [chk(w.enabled, function (v) { w.enabled = v; }), h('span', {}, 'Enabled')]),
          h('label', { class: 'ck-inline' }, [h('span', {}, 'Channel'), sel(w.channel || 'local', CHANNELS, function (v) { w.channel = v; })]),
        ]), msg,
      ]);
    }
    function cmdCard(cmd, i) {
      var resp = h('textarea', { class: 'ck-msg', rows: 2, placeholder: 'Reply text (optional). One message per line. Leave empty for an action-only command.', oninput: function () { cmd.response = resp.value; } }); resp.value = cmd.response || '';
      return h('div', { class: 'ck-card' }, [
        h('div', { class: 'ck-row' }, [
          h('span', { class: 'ck-slash' }, state.commandPrefix || '/'), txt(cmd.name, 'info', function (v) { cmd.name = v.replace(/^[\/!.#]+/, '').replace(/\s+/g, ''); }, 'ck-in ck-name'),
          h('label', { class: 'ck-inline' }, [h('span', {}, 'Reply in'), sel(cmd.channel || 'local', CHANNELS, function (v) { cmd.channel = v; })]),
          h('label', { class: 'ck-inline' }, [chk(cmd.enabled, function (v) { cmd.enabled = v; }), h('span', {}, 'Enabled')]),
          h('label', { class: 'ck-inline', title: 'On = everyone sees the reply. Off = only the player who typed it.' }, [chk(!!cmd.broadcast, function (v) { cmd.broadcast = v; }), h('span', {}, 'Announce to all')]),
          h('button', { class: 'ck-del', onclick: function () { state.commands.splice(i, 1); render(); } }, '✕'),
        ]),
        h('div', { class: 'ck-row' }, [
          h('label', { class: 'ck-inline', title: 'Hours before the same player can use it again. 0 = no cooldown.' }, [h('span', {}, 'Cooldown (h)'), numf(cmd.cooldownHours, function (v) { cmd.cooldownHours = v; })]),
          h('label', { class: 'ck-inline', title: 'Commands sharing a group share ONE cooldown — using any one starts the cooldown for all of them (e.g. teleport commands a player shouldn\'t spam between shops). Give the grouped commands the same Cooldown value.' }, [h('span', {}, 'Shared CD group'), txt(cmd.group, 'e.g. shops', function (v) { cmd.group = v.trim(); }, 'ck-in ck-cmd')]),
          h('label', { class: 'ck-inline', title: 'Remember the player\'s position when they run this, so another command can teleport them back with {saved_x} {saved_y} {saved_z}.' }, [chk(!!cmd.savePosition, function (v) { cmd.savePosition = v; }), h('span', {}, 'Remember position')]),
        ].concat(costRow(cmd, render)).concat([
          playerListRow('Allow only', cmd, 'allow', render),
          playerListRow('Deny', cmd, 'deny', render),
        ])),
        resp,
        actionsBlock(cmd, render),
      ]);
    }
    function settingsCard() {
      return h('div', { class: 'ck-card' }, [
        h('div', { class: 'ck-row' }, [
          h('label', { class: 'ck-inline', title: 'The character players type before a command in game. This is set HERE and overrides the bridge config — you don\'t need to edit the bridge.' }, [h('span', {}, 'Command prefix'), txt(state.commandPrefix || '/', '/', function (v) { state.commandPrefix = (v || '/').trim().slice(0, 3) || '/'; render(); }, 'ck-in ck-cmd')]),
          h('label', { class: 'ck-inline', title: 'How long after a player spawns in before the welcome is sent. 0 = instant (the live bridge join fires only once they\'re fully in-game, so 0 is safe).' }, [h('span', {}, 'Welcome delay (s)'), numf(state.joinDelaySeconds, function (v) { state.joinDelaySeconds = v; })]),
        ]),
        h('p', { class: 'ck-help' }, 'Prefix is managed here (it overrides the bridge\'s "commandPrefix"). Welcome delay 0 greets players instantly.'),
      ]);
    }
    function commandsView() {
      var wrap = h('div', {});
      wrap.appendChild(settingsCard());
      wrap.appendChild(welcomeCard());
      wrap.appendChild(h('div', { class: 'ck-row ck-barrow' }, [h('h3', {}, 'Chat commands'),
        h('button', { class: 'ck-btn', onclick: function () { state.commands.push({ name: '', enabled: true, channel: 'local', broadcast: false, response: '', cooldownHours: 0, group: '', cost: { currency: 'free', amount: 0 }, allow: [], deny: [], actions: [] }); render(); } }, '+ Add command')]));
      if (!state.commands.length) wrap.appendChild(h('p', { class: 'ck-empty' }, 'No commands yet.'));
      state.commands.forEach(function (c, i) { wrap.appendChild(cmdCard(c, i)); });
      wrap.appendChild(h('p', { class: 'ck-help' }, 'Tokens: ' + TOKENS.join('  ')));
      return wrap;
    }

    // ---- Packs section ----
    function pickedRow(entry, arr, i, domain) {
      var isVeh = domain === 'vehicles';
      var codeKey = isVeh ? 'code' : 'item';
      var nameKey = isVeh ? 'codeName' : 'itemName';
      var imgKey = isVeh ? 'codeImage' : 'itemImage';
      var img = h('img', { class: 'ck-thumb', src: entry[imgKey] || '' }); if (!entry[imgKey]) img.style.visibility = 'hidden';
      var label = h('span', { class: 'ck-picked' }, entry[codeKey] ? (entry[nameKey] || entry[codeKey]) : '(nothing picked)');
      var pick = h('button', { class: 'ck-add', onclick: function () {
        openPicker(domain, function (selItem) {
          var id = selItem.id || selItem.code || selItem.name;
          entry[codeKey] = isVeh ? (/^BPC?_/.test(id) ? id : 'BPC_' + id) : id;
          entry[nameKey] = selItem.name; entry[imgKey] = selItem.image; render();
        });
      } }, entry[codeKey] ? 'Change' : ('Pick ' + (isVeh ? 'vehicle' : 'item')));
      return h('div', { class: 'ck-row2' }, [img, label, numf(entry.count, function (v) { entry.count = v; }), pick, h('button', { class: 'ck-del', onclick: function () { arr.splice(i, 1); render(); } }, '✕')]);
    }
    function packGroup(title, arr, domain, addLabel) {
      var g = h('div', { class: 'ck-group' }, [h('div', { class: 'ck-group-h' }, title)]);
      arr.forEach(function (entry, i) { g.appendChild(pickedRow(entry, arr, i, domain)); });
      g.appendChild(h('button', { class: 'ck-add', onclick: function () { arr.push({ count: 1 }); render(); } }, addLabel));
      return g;
    }
    // A container (backpack/vest/crate) filled with N sets of an item — #SpawnInventoryFullOf.
    function pickInto(entry, keyId, keyName, keyImg, title) {
      openPicker('items', function (selItem) { entry[keyId] = selItem.id || selItem.code || selItem.name; entry[keyName] = selItem.name; entry[keyImg] = selItem.image; render(); }, title);
    }
    function invRow(entry, arr, i) {
      var cImg = h('img', { class: 'ck-thumb', src: entry.containerImage || '' }); if (!entry.containerImage) cImg.style.visibility = 'hidden';
      var fImg = h('img', { class: 'ck-thumb', src: entry.fillImage || '' }); if (!entry.fillImage) fImg.style.visibility = 'hidden';
      return h('div', { class: 'ck-row2 ck-invrow' }, [
        cImg, h('span', { class: 'ck-picked' }, entry.container ? (entry.containerName || entry.container) : '(container)'),
        h('button', { class: 'ck-add', onclick: function () { pickInto(entry, 'container', 'containerName', 'containerImage'); } }, entry.container ? 'Change' : 'Container'),
        h('span', { class: 'ck-invx' }, '× '), numf(entry.sets, function (v) { entry.sets = v; }),
        h('span', { class: 'ck-invx' }, 'of'), fImg, h('span', { class: 'ck-picked' }, entry.fill ? (entry.fillName || entry.fill) : '(fill item)'),
        h('button', { class: 'ck-add', onclick: function () { pickInto(entry, 'fill', 'fillName', 'fillImage'); } }, entry.fill ? 'Change' : 'Fill with'),
        h('button', { class: 'ck-del', onclick: function () { arr.splice(i, 1); render(); } }, '✕'),
      ]);
    }
    function invGroup(pack) {
      pack.inventories = pack.inventories || [];
      var g = h('div', { class: 'ck-group' }, [h('div', { class: 'ck-group-h' }, 'Full containers (backpack / vest / crate filled with an item)')]);
      pack.inventories.forEach(function (entry, i) { g.appendChild(invRow(entry, pack.inventories, i)); });
      g.appendChild(h('button', { class: 'ck-add', onclick: function () { pack.inventories.push({ sets: 1 }); render(); } }, '+ Add full container'));
      return g;
    }
    function packCard(pack, idx) {
      pack.cost = pack.cost || { currency: 'free', amount: 0 };
      pack.items = pack.items || []; pack.vehicles = pack.vehicles || [];
      var msg = h('textarea', { class: 'ck-msg', rows: 2, placeholder: 'Message to the player (optional).', oninput: function () { pack.message = msg.value; } }); msg.value = pack.message || '';
      return h('div', { class: 'ck-card' }, [
        h('div', { class: 'ck-row' }, [txt(pack.name, 'Pack name', function (v) { pack.name = v; }, 'ck-in ck-name'),
          h('label', { class: 'ck-inline' }, [chk(pack.enabled, function (v) { pack.enabled = v; }), h('span', {}, 'Enabled')]),
          h('label', { class: 'ck-inline' }, [h('span', {}, 'Reply in'), sel(pack.replyChannel || 'local', CHANNELS, function (v) { pack.replyChannel = v; })]),
          h('button', { class: 'ck-del', onclick: function () { state.packs.splice(idx, 1); render(); } }, '✕')]),
        h('div', { class: 'ck-row' }, [
          h('label', { class: 'ck-inline' }, [h('span', {}, 'Give when'), sel(pack.trigger || 'welcome', TRIGGERS, function (v) { pack.trigger = v; render(); })]),
          pack.trigger === 'command' ? h('label', { class: 'ck-inline' }, [h('span', {}, 'Command /'), txt(pack.command, 'daily', function (v) { pack.command = v.replace(/^\/+/, '').replace(/\s+/g, ''); }, 'ck-in ck-cmd')]) : null,
          h('label', { class: 'ck-inline', title: 'Hours before it can be claimed again. 0 = welcome once ever / command no cooldown.' }, [h('span', {}, 'Cooldown (h)'), numf(pack.cooldownHours, function (v) { pack.cooldownHours = v; })]),
          h('label', { class: 'ck-inline', title: 'Max times a single player can ever claim it. 0 = unlimited (subject to cooldown).' }, [h('span', {}, 'Max/player'), numf(pack.maxClaims, function (v) { pack.maxClaims = v; })]),
        ].concat(costRow(pack, render))),
        h('div', { class: 'ck-row' }, [
          h('label', { class: 'ck-inline', title: 'Packs sharing a group are mutually exclusive — a player who claims one can\'t claim the others.' }, [h('span', {}, 'Exclusive group'), txt(pack.group, 'e.g. starter', function (v) { pack.group = v.trim(); }, 'ck-in ck-cmd')]),
          playerListRow('Allow only', pack, 'allow', render),
          playerListRow('Deny', pack, 'deny', render),
        ]),
        h('div', { class: 'ck-cols' }, [packGroup('Items', pack.items, 'items', '+ Add item'), packGroup('Vehicles', pack.vehicles, 'vehicles', '+ Add vehicle')]),
        invGroup(pack),
        actionsBlock(pack, render),
        msg,
      ]);
    }
    function packsView() {
      var wrap = h('div', {});
      wrap.appendChild(h('div', { class: 'ck-row ck-barrow' }, [h('h3', {}, 'Kits & Packs'),
        h('button', { class: 'ck-btn', onclick: function () { state.packs.push({ id: 'pack' + Date.now(), name: 'New Pack', enabled: true, trigger: 'command', command: '', cooldownHours: 0, maxClaims: 0, group: '', cost: { currency: 'free', amount: 0 }, allow: [], deny: [], items: [], vehicles: [], inventories: [], actions: [], message: '', replyChannel: 'local' }); render(); } }, '+ Add pack')]));
      if (!state.packs.length) wrap.appendChild(h('p', { class: 'ck-empty' }, 'No packs yet.'));
      state.packs.forEach(function (p, i) { wrap.appendChild(packCard(p, i)); });
      var adv = h('details', { class: 'ck-adv' }, [h('summary', {}, 'Advanced — spawn command templates'),
        h('p', { class: 'ck-help' }, 'Placeholders: {item} {code} {count} {container} {sets} {fill} {steamid} {x} {y} {z}. Default spawns on the player by SteamID.'),
        h('label', { class: 'ck-fld' }, [h('span', {}, 'Item spawn command'), txt(state.itemSpawnCmd, '', function (v) { state.itemSpawnCmd = v; }, 'ck-in ck-grow')]),
        h('label', { class: 'ck-fld' }, [h('span', {}, 'Vehicle spawn command'), txt(state.vehicleSpawnCmd, '', function (v) { state.vehicleSpawnCmd = v; }, 'ck-in ck-grow')]),
        h('label', { class: 'ck-fld' }, [h('span', {}, 'Full container command'), txt(state.invSpawnCmd, '', function (v) { state.invSpawnCmd = v; }, 'ck-in ck-grow')]),
        h('p', { class: 'ck-help' }, 'Full container has no Location — it\'s run through the target player, so it always lands on them.'),
      ]);
      wrap.appendChild(adv);
      return wrap;
    }

    // ---- Messages section (all player-facing system text) ----
    function messagesView() {
      var wrap = h('div', {});
      wrap.appendChild(h('div', { class: 'ck-row ck-barrow' }, [h('h3', {}, 'System messages'), h('span', { class: 'ck-help', style: 'margin:0;' }, 'Shown to players in these situations. Any language. Tokens work.')]));
      var card = h('div', { class: 'ck-card' });
      Object.keys(MSG_LABELS).forEach(function (key) {
        var ta = h('input', { class: 'ck-in ck-grow', type: 'text', value: '', placeholder: DEFAULT_MSG[key] || '', oninput: function () { state.messages[key] = ta.value; } }); ta.value = state.messages[key] || '';
        card.appendChild(h('label', { class: 'ck-fld' }, [h('span', {}, MSG_LABELS[key]), ta]));
      });
      wrap.appendChild(card);
      wrap.appendChild(h('p', { class: 'ck-help' }, 'Tokens: {player} {pack} {cmd} {h} (hours left) {cost} {currency} + all the usual ones.'));
      return wrap;
    }

    // ---- Users section (claims → reset) ----
    function usersView() {
      var wrap = h('div', {});
      var list = h('div', { class: 'ck-card' }, h('p', { class: 'ck-empty' }, 'Loading…'));
      function load() {
        api('/claims').then(function (d) {
          var rows = (d && d.claims) || [];
          list.innerHTML = '';
          if (!rows.length) { list.appendChild(h('p', { class: 'ck-empty' }, 'Nobody has claimed anything yet.')); return; }
          var table = h('table', { class: 'ck-table' }, [h('thead', {}, h('tr', {}, [h('th', {}, 'Player'), h('th', {}, 'Reward'), h('th', {}, 'Uses'), h('th', {}, 'Last used'), h('th', {}, '')]))]);
          var tb = h('tbody', {});
          rows.forEach(function (r) {
            tb.appendChild(h('tr', {}, [
              h('td', {}, [h('div', {}, r.name || '(unknown)'), h('div', { class: 'ck-mono' }, r.steamId)]),
              h('td', {}, r.packId),
              h('td', {}, String(r.count || 1)),
              h('td', {}, r.at ? new Date(r.at).toLocaleString() : '—'),
              h('td', {}, h('button', { class: 'ck-btn', title: 'Let this player use it again', onclick: function () { api('/claims/reset', { method: 'POST', body: { packId: r.packId, steamId: r.steamId } }).then(load); } }, 'Reset')),
            ]));
          });
          table.appendChild(tb); list.innerHTML = ''; list.appendChild(table);
        }).catch(function () { list.innerHTML = ''; list.appendChild(h('p', { class: 'ck-empty' }, 'Could not load claims.')); });
      }
      wrap.appendChild(h('div', { class: 'ck-row ck-barrow' }, [h('h3', {}, 'Player claims'),
        h('div', { class: 'ck-actions' }, [
          h('button', { class: 'ck-btn', onclick: load }, '↻ Refresh'),
          h('button', { class: 'ck-btn', onclick: function () { if (confirm('Clear ALL claims for everyone? This lets every player use every reward again.')) api('/claims/clear', { method: 'POST', body: {} }).then(load); } }, 'Clear all'),
        ])]));
      wrap.appendChild(list); load();
      return wrap;
    }

    function render() {
      body.innerHTML = '';
      body.appendChild(state.view === 'commands' ? commandsView() : state.view === 'packs' ? packsView() : state.view === 'messages' ? messagesView() : usersView());
    }
    function save() {
      status.textContent = 'Saving…';
      var clean = {
        commands: state.commands.filter(function (c) { return (c.name || '').trim(); }),
        welcome: state.welcome, packs: state.packs, messages: state.messages,
        replyChannel: state.replyChannel, commandPrefix: state.commandPrefix || '/',
        itemSpawnCmd: state.itemSpawnCmd, vehicleSpawnCmd: state.vehicleSpawnCmd, invSpawnCmd: state.invSpawnCmd, joinDelaySeconds: state.joinDelaySeconds,
      };
      api('/config', { method: 'POST', body: clean }).then(function (r) { status.textContent = (r && r.ok) ? 'Saved ✓' : 'Save failed'; try { SSA.toast('Saved'); } catch (e) {} });
    }

    function segBtn(id, label) { return h('button', { class: 'ck-seg' + (state.view === id ? ' active' : ''), onclick: function () { state.view = id; render(); paint(); } }, label); }
    var seg = h('div', { class: 'ck-seg-wrap' });
    function paint() { seg.innerHTML = ''; seg.appendChild(segBtn('commands', '💬 Commands')); seg.appendChild(segBtn('packs', '🎁 Kits & Packs')); seg.appendChild(segBtn('messages', '📝 Messages')); seg.appendChild(segBtn('users', '👥 Users')); }

    var header = h('div', { class: 'ck-head' }, [
      h('div', {}, [h('h2', {}, 'Chat Commands & Kits'), h('p', { class: 'ck-sub' }, 'In-game commands & actions, a welcome message, reward packs, and player management. Requires the SSA Bridge.')]),
      h('div', { class: 'ck-actions' }, [h('button', { class: 'ck-btn primary', onclick: save }, 'Save'), status]),
    ]);
    paint();
    el.appendChild(h('div', { class: 'ck-wrap' }, [header, seg, body]));

    // A channel the client can't render for one player (e.g. legacy "server") → clamp to a visible one.
    function normCh(v) { return CHANNELS.indexOf(v) >= 0 ? v : 'local'; }
    api('/meta').then(function (m) { if (m && m.defaultMessages) DEFAULT_MSG = m.defaultMessages; }).catch(function () {});
    api('/config').then(function (cfg) {
      state.commands = (Array.isArray(cfg.commands) ? cfg.commands : []).map(function (c) { c.channel = normCh(c.channel); return c; });
      state.welcome = (cfg.welcome && typeof cfg.welcome === 'object') ? cfg.welcome : {};
      if (state.welcome) state.welcome.channel = normCh(state.welcome.channel);
      state.packs = (Array.isArray(cfg.packs) ? cfg.packs : []).map(function (p) { p.replyChannel = normCh(p.replyChannel); return p; });
      state.messages = (cfg.messages && typeof cfg.messages === 'object') ? cfg.messages : {};
      state.replyChannel = cfg.replyChannel || 'local';
      state.commandPrefix = cfg.commandPrefix || '/';
      state.itemSpawnCmd = cfg.itemSpawnCmd || '#SpawnItem {item} {count} Location {steamid}';
      state.vehicleSpawnCmd = cfg.vehicleSpawnCmd || '#SpawnVehicle {code} {count} Location {steamid}';
      state.invSpawnCmd = cfg.invSpawnCmd || '#SpawnInventoryFullOf {container} {sets} {fill}';
      state.joinDelaySeconds = cfg.joinDelaySeconds != null ? cfg.joinDelaySeconds : 0;
      render();
    });
  }

  SSA.ready(function () { SSA.registerTab({ id: 'commands-kits', label: 'Commands & Kits', icon: '💬', premium: true, render: editor }); });
})();
