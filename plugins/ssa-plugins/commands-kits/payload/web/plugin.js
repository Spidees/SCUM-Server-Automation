/* Chat Commands & Kits — admin UI.
 *
 * A cohesive, design-system-matched workspace with five views: Commands, Kits & Packs, Messages,
 * Players (claims), and Settings. Every backend feature is exposed: reply text + admin actions with a
 * click-to-insert token palette, cost / cooldown / groups / allow-deny, welcome message + packs, item /
 * vehicle / full-container pickers, per-player claim management. Talks only to its own backend under
 * /api/plugin-host/commands-kits. */
(function () {
  'use strict';
  var API = '/api/plugin-host/commands-kits';

  // Filled from /meta (with sane fallbacks so the UI works even if the call fails).
  var META = {
    channels: ['local', 'global', 'squad', 'admin', 'server'],
    currencies: ['free', 'money', 'gold', 'fame'],
    triggers: [['welcome', 'On join (welcome)'], ['command', 'Chat command']],
    defaultMessages: {},
  };
  var CH_LABEL = { local: 'Local', global: 'Global', squad: 'Squad', admin: 'Admin', server: 'Server' };
  var CUR_LABEL = { free: 'Free', money: 'Money', gold: 'Gold', fame: 'Fame' };
  var MSG_LABELS = {
    cooldown: 'Cooldown not elapsed', alreadyClaimed: 'Already claimed (one-time)', groupLocked: 'Locked by an exclusive group',
    maxClaims: 'Claim limit reached', notAllowed: 'Player not allowed', insufficient: "Can't afford it",
    notInGame: 'Not fully spawned in', spawnFailed: 'Delivery / spawn failed',
  };
  // Token palette, grouped — [token, what it shows] so the button can explain itself on hover.
  // Click to insert into the last-focused text field.
  var TOKEN_GROUPS = [
    ['Player', [
      ['{player}', 'The player’s in-game name'],
      ['{steamid}', 'Their 17-digit SteamID'],
      ['{squad}', 'Their squad’s name'],
      ['{squadsize}', 'Number of members in their squad'],
    ]],
    ['Server', [
      ['{server}', 'The server’s name'],
      ['{online}', 'Players online right now'],
      ['{maxplayers}', 'Server slot limit'],
      ['{date}', 'Today’s date'],
      ['{time}', 'Current time'],
    ]],
    ['Money', [
      ['{money}', 'Bank account balance'],
      ['{cash}', 'Cash on hand'],
      ['{gold}', 'Gold balance'],
    ]],
    ['Stats', [
      ['{fame}', 'Fame points'],
      ['{kills}', 'Total kills'],
      ['{deaths}', 'Total deaths'],
      ['{kd}', 'Kill / death ratio'],
      ['{pvpkills}', 'Players killed (PvP)'],
      ['{headshots}', 'Headshot kills'],
      ['{zombiekills}', 'Puppets killed'],
      ['{animalkills}', 'Animals killed'],
      ['{longestkill}', 'Longest kill, in metres'],
      ['{lockspicked}', 'Locks picked'],
      ['{fishcaught}', 'Fish caught'],
      ['{distance}', 'Distance travelled, in metres'],
      ['{playtime}', 'Total time played (e.g. 3d 4h)'],
      ['{survived}', 'Longest time survived'],
    ]],
    ['Attributes', [
      ['{strength}', 'Strength attribute'],
      ['{constitution}', 'Constitution attribute'],
      ['{dexterity}', 'Dexterity attribute'],
      ['{intelligence}', 'Intelligence attribute'],
    ]],
    ['Position', [
      ['{location}', 'Current position as “X, Y”'],
      ['{x}', 'Current X coordinate'],
      ['{y}', 'Current Y coordinate'],
      ['{z}', 'Current Z coordinate'],
      ['{saved_x}', 'Saved X (needs “Remember position”)'],
      ['{saved_y}', 'Saved Y coordinate'],
      ['{saved_z}', 'Saved Z coordinate'],
    ]],
    ['Command args', [
      ['{args}', 'Everything the player typed after the command'],
      ['{arg1}', 'The first word after the command'],
      ['{channel}', 'The chat channel they used'],
    ]],
  ];
  var MSG_TOKENS = [
    ['{pack}', 'The reward / command this message is about'],
    ['{cmd}', 'The command that was typed'],
    ['{h}', 'Hours left on the cooldown'],
    ['{cost}', 'The cost amount'],
    ['{currency}', 'The cost currency (money / gold / fame)'],
  ];

  // ── fetch + dom helpers ─────────────────────────────────────────────────────
  function api(p, opts) {
    opts = opts || {}; var init = Object.assign({ credentials: 'same-origin' }, opts);
    if (init.body && typeof init.body === 'object') { init.headers = Object.assign({ 'Content-Type': 'application/json' }, init.headers || {}); init.body = JSON.stringify(init.body); }
    return fetch(API + p, init).then(function (r) { return r.json().catch(function () { return {}; }); }).catch(function () { return {}; });
  }
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
  function field(label, ctl, hint) { return h('label', { class: 'ck-f' }, [h('span', {}, label), ctl, hint ? h('small', { class: 'ck-hint' }, hint) : null]); }
  function inlineField(label, ctl, title) { return h('label', { class: 'ck-inl', title: title || undefined }, [h('span', {}, label), ctl]); }
  // A compact quantity control — the “×” is glued to the number (× 3) so it reads as one unit, not a
  // stray floating symbol next to the item.
  function qty(value, oninput) { return h('label', { class: 'ck-qty', title: 'How many of this to give' }, [h('span', { class: 'ck-qty-x' }, '×'), numf(value, oninput)]); }
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
  // The native SSA.pickPlayer only lists players who are ONLINE. Admins need to allow/deny anyone —
  // including offline players — so this is our own picker over /players/all (the full game-DB roster),
  // with search, an online marker, and a SteamID paste box for someone not in the DB yet.
  function ckApi(p, opts) { return fetch('/api/plugin-host/commands-kits' + p, Object.assign({ credentials: 'same-origin' }, opts || {})).then(function (r) { return r.json().catch(function () { return {}; }); }).catch(function () { return {}; }); }
  function openPlayerPicker(onPick) {
    var picked = false;
    var search = h('input', { class: 'ck-in', type: 'text', placeholder: 'Search all players…' });
    var manual = h('input', { class: 'ck-in', type: 'text', placeholder: 'or paste a SteamID (17 digits)…' });
    var list = h('div', { class: 'ssa-pp-list' }, [h('p', { class: 'ck-empty' }, 'Loading players…')]);
    var all = [];
    function pick(p) { if (picked) return; picked = true; m.close(); onPick(p); }
    function paint() {
      var q = (search.value || '').trim().toLowerCase();
      var rows = all.filter(function (p) { return !q || (String(p.name || '') + ' ' + p.steamId).toLowerCase().indexOf(q) >= 0; });
      list.innerHTML = '';
      if (!rows.length) { list.appendChild(h('p', { class: 'ck-empty' }, all.length ? 'No matches.' : 'No players found yet — paste a SteamID above.')); return; }
      rows.slice(0, 300).forEach(function (p) {
        list.appendChild(h('button', { class: 'secondary ssa-pp-row', onclick: function () { pick({ steamId: p.steamId, name: p.name || '' }); } }, [
          h('span', { class: 'ck-pp-name' }, [h('span', { class: 'ck-pp-dot' + (p.online ? ' on' : ''), title: p.online ? 'Online now' : 'Offline' }), h('span', {}, p.name || p.steamId)]),
          h('code', { class: 'mono dim' }, p.steamId),
        ]));
      });
      if (rows.length > 300) list.appendChild(h('p', { class: 'ck-hint' }, 'Showing the first 300 — type to narrow it down.'));
    }
    var addManual = h('button', { class: 'secondary', onclick: function () { var v = (manual.value || '').trim(); if (/^\d{17}$/.test(v)) pick({ steamId: v, name: '' }); else manual.style.borderColor = 'var(--alarm,#e5443f)'; } }, 'Add');
    search.addEventListener('input', paint);
    var body = h('div', {}, [
      h('label', { class: 'player-search ck-pp-search' }, [icon('search'), search]),
      list,
      h('div', { class: 'ssa-pp-manual' }, [manual, addManual]),
    ]);
    var m = SSA.modal({ title: 'Choose a player', body: body });
    var ov = m.el.parentNode; if (ov) ov.addEventListener('click', function (e) { if (e.target === ov) picked = true; });
    ckApi('/players/all').then(function (d) {
      all = (d && d.players) || [];
      all.sort(function (a, b) { return (b.online ? 1 : 0) - (a.online ? 1 : 0); });
      paint();
    });
  }

  // allow/deny chip editor
  function idList(entry, key) { return (Array.isArray(entry[key]) ? entry[key] : []).map(function (e) { return (e && typeof e === 'object') ? e : { steamId: String(e), name: '' }; }); }
  function playerChips(label, entry, key, rerender) {
    entry[key] = idList(entry, key);
    var chips = entry[key].map(function (p, i) {
      return h('span', { class: 'ck-chip', title: p.steamId }, [h('span', {}, p.name || p.steamId), h('button', { class: 'ck-chip-x', onclick: function () { entry[key].splice(i, 1); markDirty(); rerender(); } }, [icon('close')])]);
    });
    chips.push(h('button', { class: 'secondary', onclick: function () { openPlayerPicker(function (p) { if (!entry[key].some(function (x) { return x.steamId === p.steamId; })) entry[key].push({ steamId: p.steamId, name: p.name || '' }); markDirty(); rerender(); }); } }, [icon('user'), 'Add player']));
    return h('div', { class: 'ck-f' }, [h('span', {}, label), h('div', { class: 'ck-chips' }, chips)]);
  }

  // admin-actions editor (commands run when a command/pack fires)
  function actionsBlock(entry, rerender) {
    entry.actions = Array.isArray(entry.actions) ? entry.actions : [];
    var rows = entry.actions.map(function (a, i) {
      return h('div', { class: 'ck-actrow' }, [
        txt(a.cmd, '#Teleport {x} {y} {z}', function (v) { a.cmd = v; }, 'ck-in ck-grow'),
        inlineField('after (s)', numf(a.delaySeconds, function (v) { a.delaySeconds = v; })),
        h('button', { class: 'ck-del', title: 'Remove', onclick: function () { entry.actions.splice(i, 1); markDirty(); rerender(); } }, [icon('close')]),
      ]);
    });
    return h('div', { class: 'ck-sub' }, [
      h('div', { class: 'ck-sub-h' }, 'Admin actions'),
      rows.length ? h('div', { class: 'ck-stack' }, rows) : h('p', { class: 'ck-empty' }, 'No actions. Add e.g. a teleport, currency change or buff command.'),
      h('button', { class: 'secondary', onclick: function () { entry.actions.push({ cmd: '', delaySeconds: 0 }); markDirty(); rerender(); } }, [icon('bolt'), 'Add action']),
      h('p', { class: 'ck-hint' }, 'Any admin command with tokens. Position is frozen at use — e.g. teleport away now, then “#Teleport {x} {y} {z}” with after=60 sends them back.'),
    ]);
  }
  function costRow(obj, rerender) {
    obj.cost = obj.cost || { currency: 'free', amount: 0 };
    var out = [inlineField('Cost', sel(obj.cost.currency || 'free', META.currencies.map(function (c) { return [c, CUR_LABEL[c] || c]; }), function (v) { obj.cost.currency = v; rerender(); }))];
    if (obj.cost.currency && obj.cost.currency !== 'free') out.push(inlineField('Amount', numf(obj.cost.amount, function (v) { obj.cost.amount = v; })));
    return out;
  }

  // ── main editor ─────────────────────────────────────────────────────────────
  function editor(root) {
    root.innerHTML = '';
    var state = { commands: [], welcome: {}, packs: [], messages: {}, replyChannel: 'local', commandPrefix: '/', itemSpawnCmd: '', vehicleSpawnCmd: '', invSpawnCmd: '', joinDelaySeconds: 0, spawnGapMs: 180, spawnTries: 3, view: 'commands' };
    // Live delivery status (queue depth + counters + activity log), refreshed from /status + realtime.
    var statusData = { queue: 0, current: null, queueItems: [], stats: { deliveries: 0, ok: 0, failed: 0 }, recent: [] };
    var actTable = null;       // delivery-log table (Activity view)
    var claimsTable = null;    // player-claims table (Activity view)
    var claimsData = [];       // rows for the claims table
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
      if (q && shown === 0 && total) { if (!empty) { empty = h('p', { class: 'ck-empty ck-nomatch' }, 'No matches.'); listEl.appendChild(empty); } }
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
      var f = lastField; if (!f) { toast('Click a text field first, then a token'); return; }
      var s = f.selectionStart == null ? f.value.length : f.selectionStart, e = f.selectionEnd == null ? f.value.length : f.selectionEnd;
      f.value = f.value.slice(0, s) + tok + f.value.slice(e);
      f.selectionStart = f.selectionEnd = s + tok.length;
      f.dispatchEvent(new Event('input', { bubbles: true })); f.focus();
    }

    var status = h('span', { class: 'ck-status' });
    var saveBtn = h('button', { class: '', onclick: save }, 'Save');
    markDirty = function () { dirty = true; saveBtn.classList.add('ck-unsaved'); status.textContent = 'Unsaved changes'; };

    var body = h('div', { class: 'ck-view' });

    // top bar: sub-nav + save
    var nav = h('div', { class: 'ck-nav' });
    function navBtn(id, label, ic) { return h('button', { class: 'ck-tab' + (state.view === id ? ' active' : ''), onclick: function () { state.view = id; paintNav(); render(); } }, [icon(ic), h('span', {}, label)]); }
    function paintNav() {
      nav.innerHTML = '';
      [['commands', 'Commands', 'chat'], ['packs', 'Kits & Packs', 'box'], ['messages', 'Messages', 'list'], ['activity', 'Activity', 'pulse'], ['settings', 'Settings', 'sliders']]
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
      statBar.appendChild(h('div', { class: 'ck-stat ' + (w ? 'ok' : 'off') }, [h('span', { class: 'ck-stat-dot' }), h('span', { class: 'ck-stat-l' }, w ? 'Welcome on' : 'Welcome off')]));
      statBar.appendChild(statBadge((state.commands || []).length, 'Commands'));
      statBar.appendChild(statBadge((state.packs || []).length, 'Kits & Packs'));
      // Live operational counters from the backend queue.
      var st = statusData.stats || {};
      statBar.appendChild(statBadge(st.deliveries || 0, 'Deliveries'));
      statBar.appendChild(statBadge(st.failed || 0, 'Failed', (st.failed || 0) > 0 ? 'warn' : null));
      statBar.appendChild(statBadge(statusData.queue || 0, 'In queue', (statusData.queue || 0) > 0 ? 'ok' : null));
    }

    // Pull live status (queue depth + counters + recent log) and reflect it in the header + activity table.
    function applyStatus(s) {
      if (!s) return;
      if (s.stats) statusData.stats = s.stats;
      if (s.queue != null) statusData.queue = s.queue;
      if (s.current !== undefined) statusData.current = s.current;
      if (Array.isArray(s.queueItems)) statusData.queueItems = s.queueItems;
      if (Array.isArray(s.recent)) statusData.recent = s.recent;
      renderStat(); renderQueue();
      if (state.view === 'activity' && actTable) actTable.refresh();
    }
    function refreshStatus() { api('/status').then(applyStatus); }
    // Live queue panel — what's being delivered right now + what's waiting. Written into the Activity view.
    function renderQueue() {
      if (!queueBox) return;
      queueBox.innerHTML = '';
      var items = statusData.queueItems || [], cur = statusData.current, depth = statusData.queue || 0;
      if (!cur && !items.length && depth <= 0) { queueBox.appendChild(h('p', { class: 'ck-empty' }, 'Queue is empty — every delivery is up to date.')); return; }
      if (cur) queueBox.appendChild(h('div', { class: 'ck-q-cur' }, [h('span', { class: 'ck-q-spin' }), h('span', { class: 'ck-q-lbl' }, [h('strong', {}, 'Delivering now: '), cur])]));
      items.forEach(function (lbl) { queueBox.appendChild(h('div', { class: 'ck-q-row' }, [h('span', { class: 'ck-q-dot' }), h('span', {}, lbl)])); });
      var extra = depth - items.length;
      if (extra > 0) queueBox.appendChild(h('p', { class: 'ck-hint' }, '+ ' + extra + ' more waiting…'));
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
    ckPollTimer = setInterval(refreshStatus, 4000);

    // "3h ago" style from a Unix-epoch (ms) timestamp.
    function fmtAgo(ms) {
      var s = Math.max(0, Math.floor((Date.now() - (ms || 0)) / 1000));
      if (s < 60) return 'just now';
      var m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
      var hr = Math.floor(m / 60); if (hr < 24) return hr + 'h ago';
      return Math.floor(hr / 24) + 'd ago';
    }

    // token palette (collapsible), shown on text-heavy views. Each button carries a tooltip explaining
    // exactly what it will show, so admins don't have to guess (hover any token to read it).
    function tokenBar(extra) {
      var groups = TOKEN_GROUPS.slice();
      if (extra) groups = groups.concat([['Message', extra]]);
      var pal = h('div', { class: 'ck-tok-pal' });
      groups.forEach(function (g) {
        pal.appendChild(h('div', { class: 'ck-tok-grp' }, [h('span', { class: 'ck-tok-lbl' }, g[0])].concat(
          g[1].map(function (tk) {
            var tok = Array.isArray(tk) ? tk[0] : tk, desc = Array.isArray(tk) ? tk[1] : '';
            return h('button', { type: 'button', class: 'ck-tokbtn', title: desc ? (tok + ' — ' + desc) : tok, onclick: function () { insertToken(tok); } }, tok);
          }))));
      });
      return h('details', { class: 'ck-tok' }, [h('summary', {}, [icon('bulb'), h('span', {}, 'Insert token'), h('span', { class: 'ck-tok-tip' }, 'click a text field first · hover a token to see what it shows')]), pal]);
    }
    container.appendChild(body);

    // ── card scaffolding (collapsible) ──
    function cardHead(entry, opts) {
      var chevron = h('button', { class: 'ck-chev' + (expanded.has(entry) ? ' open' : ''), title: expanded.has(entry) ? 'Collapse' : 'Expand', onclick: function () { if (expanded.has(entry)) expanded.delete(entry); else expanded.add(entry); render(); } }, [chevIcon()]);
      return h('div', { class: 'ck-card-h' }, [chevron, opts.enable, opts.title, h('span', { class: 'ck-badges' }, opts.badges || []), h('span', { class: 'ck-spacer' }), opts.del]);
    }
    function badge(text, cls) { return text ? h('span', { class: 'ck-badge ' + (cls || '') }, text) : null; }

    // ── Commands view ──
    function cmdCard(cmd, i) {
      var open = expanded.has(cmd);
      var s = ((cmd.name || '') + ' ' + (cmd.response || '') + ' ' + (cmd.group || '')).toLowerCase();
      var nameIn = txt(cmd.name, 'info', function (v) { cmd.name = v.replace(/^[\/!.#]+/, '').replace(/\s+/g, ''); }, 'ck-in ck-name');
      var head = cardHead(cmd, {
        enable: toggle(cmd.enabled, function (v) { cmd.enabled = v; }),
        title: h('span', { class: 'ck-card-title' }, [h('span', { class: 'ck-cmdfield' }, [h('span', { class: 'ck-slash' }, state.commandPrefix || '/'), nameIn])]),
        badges: [
          cmd.broadcast ? badge('announce', 'mut') : null,
          Number(cmd.cooldownHours) > 0 ? badge(cmd.cooldownHours + 'h CD', 'mut') : null,
          (cmd.cost && cmd.cost.currency && cmd.cost.currency !== 'free' && Number(cmd.cost.amount) > 0) ? badge(cmd.cost.amount + ' ' + cmd.cost.currency, 'cost') : null,
          (cmd.actions && cmd.actions.length) ? badge(cmd.actions.length + ' action' + (cmd.actions.length > 1 ? 's' : ''), 'mut') : null,
        ],
        del: h('button', { class: 'ck-del', title: 'Delete command', onclick: function () { state.commands.splice(i, 1); markDirty(); render(); } }, [icon('close')]),
      });
      if (!open) return h('div', { class: 'ck-card', 'data-s': s }, [head]);
      return h('div', { class: 'ck-card open', 'data-s': s }, [head, h('div', { class: 'ck-card-b' }, [
        h('div', { class: 'ck-grid' }, [
          inlineField('Reply in', sel(cmd.channel || 'local', META.channels.map(function (c) { return [c, CH_LABEL[c] || c]; }), function (v) { cmd.channel = v; })),
          h('div', { class: 'ck-inl', title: 'On = everyone sees the reply. Off = only the player who typed it.' }, [h('span', {}, 'Announce to all'), toggle(!!cmd.broadcast, function (v) { cmd.broadcast = v; render(); })]),
          inlineField('Cooldown (h)', numf(cmd.cooldownHours, function (v) { cmd.cooldownHours = v; render(); }), 'Hours before the same player can reuse it. 0 = none.'),
          inlineField('Shared CD group', txt(cmd.group, 'e.g. shops', function (v) { cmd.group = v.trim(); }), 'Commands with the same group share ONE cooldown.'),
          h('div', { class: 'ck-inl', title: 'Remember the player’s position now so another command can teleport them back with {saved_x/y/z}.' }, [h('span', {}, 'Remember position'), toggle(!!cmd.savePosition, function (v) { cmd.savePosition = v; })]),
          h('div', { class: 'ck-inl', title: 'On = run this command’s admin actions through the player, so the game shows THEM its own feedback (e.g. “item spawned”). Off = run them silently via the bridge.' }, [h('span', {}, 'Notify player'), toggle(!!cmd.notify, function (v) { cmd.notify = v; })]),
        ].concat(costRow(cmd, render).map(function (n) { return n; }))),
        h('div', { class: 'ck-grid2' }, [playerChips('Allow only', cmd, 'allow', render), playerChips('Deny', cmd, 'deny', render)]),
        field('Reply text', area(cmd.response, 'Reply text (optional). One message per line. Leave empty for an action-only command.', function (v) { cmd.response = v; })),
        actionsBlock(cmd, render),
      ])]);
    }
    function commandsView() {
      var wrap = h('div', { class: 'ck-viewbody' });
      wrap.appendChild(tokenBar());
      var list = h('div', { class: 'ck-list' });
      if (!state.commands.length) list.appendChild(h('p', { class: 'ck-empty' }, 'No commands yet — add one to get started.'));
      state.commands.forEach(function (c, i) { list.appendChild(cmdCard(c, i)); });
      var listRef = { el: list };
      var head = [
        h('button', { class: 'secondary', onclick: function () { state.commands.forEach(function (c) { expanded.add(c); }); render(); } }, 'Expand all'),
        h('button', { class: 'secondary', onclick: function () { state.commands.forEach(function (c) { expanded.delete(c); }); render(); } }, 'Collapse all'),
        h('button', { class: 'secondary', onclick: function () { var c = { name: '', enabled: true, channel: 'local', broadcast: false, response: '', cooldownHours: 0, group: '', cost: { currency: 'free', amount: 0 }, allow: [], deny: [], actions: [] }; state.commands.push(c); expanded.add(c); markDirty(); render(); } }, [icon('chat'), 'Add command']),
      ];
      // Once the list gets long, add a live search so admins can find a command fast.
      if (state.commands.length > 6) head.unshift(listSearch(function () { return cmdFilter; }, function (v) { cmdFilter = v; }, listRef, 'Search commands…')); else cmdFilter = '';
      wrap.appendChild(ckSection('Chat commands', 'Custom /commands players type in chat — reply text and/or admin actions, with cost, cooldown, groups and allow/deny.', [list], head));
      if (cmdFilter) filterCards(list, cmdFilter);
      return wrap;
    }

    // ── Kits & Packs view ──
    function pickedRow(entry, arr, i, domain) {
      var isVeh = domain === 'vehicles';
      var codeKey = isVeh ? 'code' : 'item', nameKey = isVeh ? 'codeName' : 'itemName', imgKey = isVeh ? 'codeImage' : 'itemImage';
      var media = entry[imgKey] ? h('img', { class: 'ck-thumb', src: entry[imgKey] }) : h('span', { class: 'ck-thumb ck-noimg' }, icon(isVeh ? 'car' : 'box'));
      return h('div', { class: 'ck-itemrow' }, [
        h('div', { class: 'ck-item-main' }, [media, h('span', { class: 'ck-picked' }, entry[codeKey] ? (entry[nameKey] || entry[codeKey]) : '(nothing picked)')]),
        h('div', { class: 'ck-item-ctl' }, [
          qty(entry.count, function (v) { entry.count = v; }),
          h('button', { class: 'secondary', onclick: function () { openPicker(domain, function (it) { var id = it.spawn_code || it.id || it.code || it.name; entry[codeKey] = isVeh ? (/^BPC?_/.test(id) ? id : 'BPC_' + id) : id; entry[nameKey] = it.name; entry[imgKey] = it.image; markDirty(); render(); }); } }, entry[codeKey] ? 'Change' : ('Pick ' + (isVeh ? 'vehicle' : 'item'))),
          h('button', { class: 'ck-del', title: 'Remove', onclick: function () { arr.splice(i, 1); markDirty(); render(); } }, [icon('close')]),
        ]),
      ]);
    }
    function itemsGroup(title, arr, domain, addLabel) {
      var g = h('div', { class: 'ck-sub' }, [h('div', { class: 'ck-sub-h' }, title)]);
      if (arr.length) arr.forEach(function (entry, i) { g.appendChild(pickedRow(entry, arr, i, domain)); });
      else g.appendChild(h('p', { class: 'ck-empty' }, 'None.'));
      g.appendChild(h('button', { class: 'secondary', onclick: function () { arr.push({ count: 1 }); markDirty(); render(); } }, [icon(domain === 'vehicles' ? 'truck' : 'box'), addLabel]));
      return g;
    }
    function invRow(entry, arr, i) {
      var cImg = entry.containerImage ? h('img', { class: 'ck-thumb', src: entry.containerImage }) : h('span', { class: 'ck-thumb ck-noimg' }, icon('box'));
      var fImg = entry.fillImage ? h('img', { class: 'ck-thumb', src: entry.fillImage }) : h('span', { class: 'ck-thumb ck-noimg' }, icon('box'));
      function pick(kId, kName, kImg) { openPicker('items', function (it) { entry[kId] = it.spawn_code || it.id || it.code || it.name; entry[kName] = it.name; entry[kImg] = it.image; markDirty(); render(); }); }
      return h('div', { class: 'ck-itemrow ck-invrow' }, [
        cImg, h('span', { class: 'ck-picked' }, entry.container ? (entry.containerName || entry.container) : '(container)'),
        h('button', { class: 'secondary', onclick: function () { pick('container', 'containerName', 'containerImage'); } }, entry.container ? 'Change' : 'Container'),
        h('span', { class: 'ck-times' }, '×'), numf(entry.sets, function (v) { entry.sets = v; }),
        h('span', { class: 'ck-times' }, 'of'), fImg, h('span', { class: 'ck-picked' }, entry.fill ? (entry.fillName || entry.fill) : '(fill item)'),
        h('button', { class: 'secondary', onclick: function () { pick('fill', 'fillName', 'fillImage'); } }, entry.fill ? 'Change' : 'Fill'),
        h('button', { class: 'ck-del', onclick: function () { arr.splice(i, 1); markDirty(); render(); } }, [icon('close')]),
      ]);
    }
    function invGroup(pack) {
      pack.inventories = pack.inventories || [];
      var g = h('div', { class: 'ck-sub' }, [h('div', { class: 'ck-sub-h' }, 'Full containers (backpack / vest / crate filled with an item)')]);
      if (pack.inventories.length) pack.inventories.forEach(function (entry, i) { g.appendChild(invRow(entry, pack.inventories, i)); });
      else g.appendChild(h('p', { class: 'ck-empty' }, 'None.'));
      g.appendChild(h('button', { class: 'secondary', onclick: function () { pack.inventories.push({ sets: 1 }); markDirty(); render(); } }, [icon('box'), 'Add full container']));
      return g;
    }
    function packCard(pack, idx) {
      pack.cost = pack.cost || { currency: 'free', amount: 0 }; pack.items = pack.items || []; pack.vehicles = pack.vehicles || [];
      var open = expanded.has(pack);
      var s = ((pack.name || '') + ' ' + (pack.command || '') + ' ' + (pack.group || '')).toLowerCase();
      var counts = (pack.items.length + pack.vehicles.length + (pack.inventories ? pack.inventories.length : 0));
      var head = cardHead(pack, {
        enable: toggle(pack.enabled, function (v) { pack.enabled = v; }),
        title: h('span', { class: 'ck-card-title' }, [h('span', { class: 'ck-cmdfield' }, [h('span', { class: 'ck-slash ck-kiticon', title: 'Kit / pack name' }, icon('box')), txt(pack.name, 'Kit name', function (v) { pack.name = v; }, 'ck-in ck-name')])]),
        badges: [
          badge(pack.trigger === 'welcome' ? 'on join' : ('/' + (pack.command || '?')), 'trig'),
          counts ? badge(counts + ' reward' + (counts > 1 ? 's' : ''), 'mut') : null,
          (pack.cost && pack.cost.currency !== 'free' && Number(pack.cost.amount) > 0) ? badge(pack.cost.amount + ' ' + pack.cost.currency, 'cost') : null,
          Number(pack.cooldownHours) > 0 ? badge(pack.cooldownHours + 'h CD', 'mut') : null,
        ],
        del: h('button', { class: 'ck-del', title: 'Delete pack', onclick: function () { state.packs.splice(idx, 1); markDirty(); render(); } }, [icon('close')]),
      });
      if (!open) return h('div', { class: 'ck-card', 'data-s': s }, [head]);
      return h('div', { class: 'ck-card open', 'data-s': s }, [head, h('div', { class: 'ck-card-b' }, [
        h('div', { class: 'ck-grid' }, [
          inlineField('Give when', sel(pack.trigger || 'welcome', META.triggers, function (v) { pack.trigger = v; render(); })),
          pack.trigger === 'command' ? inlineField('Command', h('span', { class: 'ck-cmdwrap' }, [h('span', { class: 'ck-slash' }, state.commandPrefix || '/'), txt(pack.command, 'daily', function (v) { pack.command = v.replace(/^\/+/, '').replace(/\s+/g, ''); }, 'ck-in ck-name')])) : null,
          inlineField('Reply in', sel(pack.replyChannel || 'local', META.channels.map(function (c) { return [c, CH_LABEL[c] || c]; }), function (v) { pack.replyChannel = v; })),
          inlineField('Cooldown (h)', numf(pack.cooldownHours, function (v) { pack.cooldownHours = v; render(); }), '0 = welcome once ever / command no cooldown.'),
          inlineField('Max / player', numf(pack.maxClaims, function (v) { pack.maxClaims = v; }), '0 = unlimited (subject to cooldown).'),
          inlineField('Exclusive group', txt(pack.group, 'e.g. starter', function (v) { pack.group = v.trim(); }), 'Packs in the same group are mutually exclusive.'),
          h('div', { class: 'ck-inl', title: 'On = deliver through the player so the game shows THEM its own “item spawned” messages as the kit lands. Off = deliver silently via the bridge (your own message below still sends).' }, [h('span', {}, 'Notify player'), toggle(!!pack.notify, function (v) { pack.notify = v; })]),
        ].concat(costRow(pack, render))),
        h('div', { class: 'ck-grid2' }, [playerChips('Allow only', pack, 'allow', render), playerChips('Deny', pack, 'deny', render)]),
        h('div', { class: 'ck-cols' }, [itemsGroup('Items', pack.items, 'items', 'Add item'), itemsGroup('Vehicles', pack.vehicles, 'vehicles', 'Add vehicle')]),
        invGroup(pack),
        actionsBlock(pack, render),
        field('Message to player', area(pack.message, 'Message to the player (optional).', function (v) { pack.message = v; })),
      ])]);
    }
    function packsView() {
      var wrap = h('div', { class: 'ck-viewbody' });
      wrap.appendChild(tokenBar());
      var list = h('div', { class: 'ck-list' });
      if (!state.packs.length) list.appendChild(h('p', { class: 'ck-empty' }, 'No packs yet — add a kit players can claim on join or with a command.'));
      state.packs.forEach(function (p, i) { list.appendChild(packCard(p, i)); });
      var listRef = { el: list };
      var head = [
        h('button', { class: 'secondary', onclick: function () { state.packs.forEach(function (p) { expanded.add(p); }); render(); } }, 'Expand all'),
        h('button', { class: 'secondary', onclick: function () { state.packs.forEach(function (p) { expanded.delete(p); }); render(); } }, 'Collapse all'),
        h('button', { class: 'secondary', onclick: function () { var p = { id: 'pack' + Date.now(), name: 'New Pack', enabled: true, trigger: 'command', command: '', cooldownHours: 0, maxClaims: 0, group: '', cost: { currency: 'free', amount: 0 }, allow: [], deny: [], items: [], vehicles: [], inventories: [], actions: [], message: '', replyChannel: 'local' }; state.packs.push(p); expanded.add(p); markDirty(); render(); } }, [icon('box'), 'Add pack']),
      ];
      if (state.packs.length > 6) head.unshift(listSearch(function () { return packFilter; }, function (v) { packFilter = v; }, listRef, 'Search kits…')); else packFilter = '';
      wrap.appendChild(ckSection('Kits & Packs', 'Reward bundles — items, vehicles and full containers — claimable on join or via a command, with cost, cooldown, claim limit and groups.', [list], head));
      if (packFilter) filterCards(list, packFilter);
      return wrap;
    }

    // ── Messages view ──
    function messagesView() {
      var wrap = h('div', { class: 'ck-viewbody' });
      wrap.appendChild(tokenBar(MSG_TOKENS));
      var grid = h('div', { class: 'ck-msggrid' });
      Object.keys(MSG_LABELS).forEach(function (key) {
        grid.appendChild(field(MSG_LABELS[key], txt(state.messages[key], META.defaultMessages[key] || '', function (v) { state.messages[key] = v; }, 'ck-in ck-grow')));
      });
      wrap.appendChild(ckSection('System messages', 'Shown to players in these situations — write them in any language, tokens work. Leave a field blank to use the default.', [grid]));
      return wrap;
    }

    function loadClaims() { api('/claims').then(function (d) { claimsData = (d && d.claims) || []; if (claimsTable) claimsTable.refresh(); }); }

    // ── Activity view — one complete operational dashboard: live queue + delivery log + player claims ──
    function activityView() {
      var wrap = h('div', { class: 'ck-viewbody' });

      // 1) Live queue — what the throttled spawn queue is delivering right now + what's waiting.
      queueBox = h('div', { class: 'ck-queue' });
      var refreshQ = h('button', { class: 'secondary btn-icon', title: 'Refresh', onclick: refreshStatus }, icon('refresh'));
      wrap.appendChild(ckSection('Live queue', 'Kits go out through one throttled, retried queue so a burst never drops an item — this is what is being delivered right now.', [queueBox], [refreshQ]));
      renderQueue();

      // 2) Delivery log — every kit/reward handed out, with clickable players + failed items.
      var clearLog = h('button', { class: 'secondary', onclick: function () { SSA.confirm('Clear the delivery log?').then(function (ok) { if (!ok) return; api('/clear-history', { method: 'POST' }).then(function () { statusData.recent = []; if (actTable) actTable.refresh(); }); }); } }, [icon('close'), 'Clear log']);
      actTable = SSA.table({
        rows: function () { return statusData.recent || []; },
        searchPlaceholder: 'Search players, rewards, items…',
        search: function (r) { return [r.player, r.steamId, r.reward].concat((r.failedItems || []).map(function (f) { return (f && f.label) || f; })).join(' '); },
        empty: 'No deliveries yet — kits and rewards handed out will show here.',
        sort: { key: 'at', dir: 'desc' }, pageSize: 20, onRefresh: refreshStatus,
        columns: [
          { key: 'at', label: 'When', sort: true, sortVal: function (r) { return r.at || 0; }, tdClass: 'dim', render: function (r) { return document.createTextNode(fmtAgo(r.at)); } },
          { key: 'player', label: 'Player', sort: true, sortVal: function (r) { return String(r.player || r.steamId || '').toLowerCase(); }, render: function (r) { return SSA.cell.player(r.player, r.steamId); } },
          { key: 'reward', label: 'Reward', sort: true, sortVal: function (r) { return String(r.reward || '').toLowerCase(); }, render: function (r) { return document.createTextNode(r.reward || ''); } },
          // Sortable by failures so you can click the header to surface the problem deliveries first.
          { key: 'result', label: 'Result', sort: true, sortVal: function (r) { return r.failed || 0; }, render: function (r) {
            var bad = (r.failed || 0) > 0;
            var tag = SSA.cell.tag((r.spawned || 0) + '/' + (r.total || 0), bad ? 'bad' : 'ok');
            if (!bad) return tag;
            var box = h('div', { class: 'ck-result' }, [tag]);
            var items = r.failedItems || [];
            if (items.length) {
              items.forEach(function (fi) {
                var code = (fi && fi.code) || (typeof fi === 'string' ? fi : '');
                var label = (fi && fi.label) || code;
                // Native clickable item preview — same popover as the mine-protection table / Log Viewer.
                box.appendChild(SSA.cell.item(code, label));
              });
            } else {
              box.appendChild(h('span', { class: 'ck-failed' }, r.failed + ' failed'));
            }
            return box;
          } },
        ],
      });
      wrap.appendChild(ckSection('Delivery log', 'Every kit and reward handed out — click a player to open them, click the Result header to surface failures first.', [actTable.el], [clearLog]));

      // 3) Player claims — who has claimed what; reset a row to let a player use a one-time reward again.
      var clearAll = h('button', { class: 'secondary', onclick: function () { SSA.confirm('Clear ALL claims for everyone? Every player can then use every reward again.', { okLabel: 'Clear all' }).then(function (ok) { if (!ok) return; api('/claims/clear', { method: 'POST', body: {} }).then(function () { toast('All claims cleared'); loadClaims(); }); }); } }, [icon('close'), 'Clear all claims']);
      claimsTable = SSA.table({
        rows: function () { return claimsData; },
        searchPlaceholder: 'Search players, rewards…',
        search: function (r) { return [r.name, r.steamId, r.packId].join(' '); },
        empty: 'Nobody has claimed anything yet.',
        sort: { key: 'at', dir: 'desc' }, pageSize: 10, onRefresh: loadClaims,
        columns: [
          { key: 'player', label: 'Player', sort: true, sortVal: function (r) { return (r.name || r.steamId || '').toLowerCase(); }, render: function (r) { return SSA.cell.player(r.name, r.steamId); } },
          { key: 'packId', label: 'Reward', sort: true, sortVal: function (r) { return r.packId; }, render: function (r) { return document.createTextNode(r.packId); } },
          { key: 'count', label: 'Uses', sort: true, sortVal: function (r) { return r.count || 1; }, tdClass: 'mono', render: function (r) { return document.createTextNode(String(r.count || 1)); } },
          { key: 'at', label: 'Last used', sort: true, sortVal: function (r) { return r.at || 0; }, tdClass: 'dim', render: function (r) { return document.createTextNode(r.at ? new Date(r.at).toLocaleString() : '—'); } },
          { key: 'reset', label: '', render: function (r) { return h('button', { class: 'secondary', title: 'Let this player use it again', onclick: function () { api('/claims/reset', { method: 'POST', body: { packId: r.packId, steamId: r.steamId } }).then(function () { toast('Reset'); loadClaims(); }); } }, 'Reset'); } },
        ],
      });
      wrap.appendChild(ckSection('Player claims', 'Who has claimed which reward. Reset a row to let that player use a one-time reward again.', [claimsTable.el], [clearAll]));

      loadClaims();
      refreshStatus();
      return wrap;
    }

    // ── Settings view ──
    function settingsView() {
      var wrap = h('div', { class: 'ck-viewbody' });
      var w = state.welcome;
      wrap.appendChild(h('div', { class: 'card ck-card ck-open-card' }, [
        h('h3', { class: 'ck-card-t' }, 'General'),
        h('div', { class: 'ck-grid' }, [
          inlineField('Command prefix', txt(state.commandPrefix || '/', '/', function (v) { state.commandPrefix = (v || '/').trim().slice(0, 3) || '/'; }), 'What players type before a command. Set here — overrides the bridge.'),
          inlineField('Default reply channel', sel(state.replyChannel || 'local', META.channels.map(function (c) { return [c, CH_LABEL[c] || c]; }), function (v) { state.replyChannel = v; }), 'Used when a command/pack has no channel of its own.'),
          inlineField('Welcome delay (s)', numf(state.joinDelaySeconds, function (v) { state.joinDelaySeconds = v; }), '0 = greet instantly on spawn-in.'),
        ]),
      ]));
      wrap.appendChild(h('div', { class: 'card ck-card ck-open-card' }, [
        h('h3', { class: 'ck-card-t' }, 'Delivery reliability'),
        h('p', { class: 'ck-card-sub' }, 'Spawns are queued and retried so a burst of claims never faults items away — players always get the whole kit. Watch it live on the Activity tab.'),
        h('div', { class: 'ck-grid' }, [
          inlineField('Spawn gap (ms)', numf(state.spawnGapMs, function (v) { state.spawnGapMs = v; }, { min: 0, max: 3000, step: 10 }), 'Delay between spawns. Higher = gentler on the server during mass events.'),
          inlineField('Spawn attempts', numf(state.spawnTries, function (v) { state.spawnTries = v; }, { min: 1, max: 6 }), 'Tries per item before giving up (1 = no retry). Recovers transient bridge faults.'),
        ]),
      ]));
      wrap.appendChild(h('div', { class: 'card ck-card ck-open-card' }, [
        h('h3', { class: 'ck-card-t' }, 'Welcome message'),
        h('div', { class: 'ck-grid' }, [
          h('div', { class: 'ck-inl' }, [h('span', {}, 'Enabled'), toggle(w.enabled, function (v) { w.enabled = v; })]),
          inlineField('Channel', sel(w.channel || 'local', META.channels.map(function (c) { return [c, CH_LABEL[c] || c]; }), function (v) { w.channel = v; })),
        ]),
        tokenBar(),
        field('Message', area(w.message, 'Message sent to a player when they join.', function (v) { w.message = v; })),
      ]));
      wrap.appendChild(h('details', { class: 'card ck-card ck-adv' }, [
        h('summary', {}, 'Advanced — spawn command templates'),
        h('p', { class: 'ck-hint' }, 'Placeholders: {item} {code} {count} {container} {sets} {fill} {steamid} {x} {y} {z}. Defaults spawn on the player by SteamID; the full-container command has no Location (run through the player).'),
        field('Item spawn command', txt(state.itemSpawnCmd, '', function (v) { state.itemSpawnCmd = v; }, 'ck-in ck-grow')),
        field('Vehicle spawn command', txt(state.vehicleSpawnCmd, '', function (v) { state.vehicleSpawnCmd = v; }, 'ck-in ck-grow')),
        field('Full container command', txt(state.invSpawnCmd, '', function (v) { state.invSpawnCmd = v; }, 'ck-in ck-grow')),
      ]));
      return wrap;
    }

    function render() {
      renderStat();
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
      status.textContent = 'Saving…'; saveBtn.disabled = true;
      var clean = {
        commands: state.commands.filter(function (c) { return (c.name || '').trim(); }),
        welcome: state.welcome, packs: state.packs, messages: state.messages,
        replyChannel: state.replyChannel, commandPrefix: state.commandPrefix || '/',
        itemSpawnCmd: state.itemSpawnCmd, vehicleSpawnCmd: state.vehicleSpawnCmd, invSpawnCmd: state.invSpawnCmd, joinDelaySeconds: state.joinDelaySeconds,
        spawnGapMs: state.spawnGapMs, spawnTries: state.spawnTries,
      };
      api('/config', { method: 'POST', body: clean }).then(function (r) {
        saveBtn.disabled = false;
        if (r && r.ok) { dirty = false; saveBtn.classList.remove('ck-unsaved'); status.textContent = 'Saved ✓'; toast('Saved'); setTimeout(function () { if (!dirty) status.textContent = ''; }, 2500); }
        else { status.textContent = 'Save failed'; toast('Save failed', 'error'); }
      });
    }
    function toast(m, k) { if (window.SSA && SSA.toast) SSA.toast(m, k); }
    function normCh(v) { return META.channels.indexOf(v) >= 0 ? v : 'local'; }

    paintNav();
    Promise.all([api('/meta'), api('/config')]).then(function (r) {
      var m = r[0] || {};
      if (m.channels) META.channels = m.channels;
      if (m.currencies) META.currencies = m.currencies;
      if (m.defaultMessages) META.defaultMessages = m.defaultMessages;
      var cfg = r[1] || {};
      state.commands = (Array.isArray(cfg.commands) ? cfg.commands : []).map(function (c) { c.channel = normCh(c.channel); return c; });
      state.welcome = (cfg.welcome && typeof cfg.welcome === 'object') ? cfg.welcome : {}; state.welcome.channel = normCh(state.welcome.channel);
      state.packs = (Array.isArray(cfg.packs) ? cfg.packs : []).map(function (p) { p.replyChannel = normCh(p.replyChannel); return p; });
      state.messages = (cfg.messages && typeof cfg.messages === 'object') ? cfg.messages : {};
      state.replyChannel = normCh(cfg.replyChannel || 'local');
      state.commandPrefix = cfg.commandPrefix || '/';
      state.itemSpawnCmd = cfg.itemSpawnCmd || '#SpawnItem {item} {count} Location {steamid}';
      state.vehicleSpawnCmd = cfg.vehicleSpawnCmd || '#SpawnVehicle {code} {count} Location {steamid}';
      state.invSpawnCmd = cfg.invSpawnCmd || '#SpawnInventoryFullOf {container} {sets} {fill}';
      state.joinDelaySeconds = cfg.joinDelaySeconds != null ? cfg.joinDelaySeconds : 0;
      state.spawnGapMs = cfg.spawnGapMs != null ? cfg.spawnGapMs : 180;
      state.spawnTries = cfg.spawnTries != null ? cfg.spawnTries : 3;
      render();
      refreshStatus();   // pull live queue/counters for the header + activity log
    });
  }

  SSA.ready(function () { SSA.registerTab({ id: 'commands-kits', label: 'Commands & Kits', icon: '#i-chat', premium: true, render: editor }); });
})();
