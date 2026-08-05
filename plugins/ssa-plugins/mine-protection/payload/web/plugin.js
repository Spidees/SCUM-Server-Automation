/* Mine Protection — admin configuration UI.
 *
 * A self-contained tab: a live status header, an illustrated mine/trap picker (icons + how many are
 * placed/armed right now), escalation rules, per-message text, an exemption player-picker, and a live
 * feed of recent actions. Talks only to its own backend under /api/plugin-host/mine-protection. */
(function () {
  var API = '/api/plugin-host/mine-protection';

  var DEF = {
    enabled: true, pollSeconds: 6, marginMeters: 0,
    watchedTypes: ['ImprovisedMine', 'Mine_01', 'Mine_02', 'ImprovisedClaymore', 'Claymore', 'PressureCookerBomb', 'PipeBomb', 'PromTrap'],
    action: 'teleport_to_mine', warningsBeforeAction: 1, requireOnline: true,
    exemptSteamIds: [], channel: 'local',
    message: 'Placing a mine outside your flag is not allowed. Enjoy your own trap.',
    warnMessage: 'Warning: arming a mine outside your flag is not allowed. Next one takes you with it.',
  };

  // ── tiny fetch + dom helpers ────────────────────────────────────────────────
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
  function card(title, sub, kids) {
    var head = [h('h3', { class: 'mp-card-t' }, title)];
    if (sub) head.push(h('p', { class: 'mp-card-sub' }, sub));
    return h('div', { class: 'card mp-card' }, head.concat(kids || []));
  }
  function field(label, ctl, hint) { return h('label', { class: 'mp-f' }, [h('span', {}, label), ctl, hint ? h('small', { class: 'mp-hint' }, hint) : null]); }
  function numInput(get, set, o) {
    o = o || {}; var i = h('input', { type: 'number', min: o.min, max: o.max, step: o.step || 1, oninput: function () { set(Number(i.value)); } });
    i.value = get(); return i;
  }
  function textInput(get, set) { var i = h('input', { type: 'text', oninput: function () { set(i.value); } }); i.value = get() || ''; return i; }
  function ago(ms) {
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return s + 's ago'; if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago';
  }
  // Icons, tables and clickable cells come from the manager's native SDK (SSA.icon/table/cell) so
  // the plugin's UI is pixel-identical to the panel. This thin alias keeps the local icon() calls.
  var icon = function (id, cls) { return SSA.icon(id, cls); };

  // Live state shared across editor mounts (a tab can be opened/closed many times): ONE status-poll
  // timer and ONE socket subscription, always driving the most recently mounted editor.
  var mpLiveTimer = null, mpOnEvent = null, mpSocketBound = false;

  // ── main editor ─────────────────────────────────────────────────────────────
  function editor(el) {
    var config = null, catalog = [], status = null, mines = [];

    el.innerHTML = '';
    el.appendChild(h('div', { class: 'mp-head' }, [
      h('p', { class: 'mp-intro' }, 'Automatically punish players who arm a mine or trap outside their own or their squad’s flag area.'),
    ]));
    var statusBar = h('div', { class: 'mp-status' });
    el.appendChild(statusBar);
    var body = h('div', { class: 'mp-body' }, [h('p', { class: 'mp-loading' }, 'Loading…')]);
    el.appendChild(body);

    Promise.all([api('/config'), api('/catalog'), api('/status')]).then(function (r) {
      config = Object.assign({}, DEF, r[0] || {});
      catalog = (r[1] && r[1].items) || [];
      status = r[2] || null;
      render();
      bindLive();
    });

    // This editor's event handler; installing it as the shared `mpOnEvent` makes this the active mount,
    // which also stops any previous mount's poll loop (it checks it's still the active handler).
    function onEvent(rec) {
      if (!rec) return;
      status = status || {}; status.recent = ([rec].concat(status.recent || [])).slice(0, 100);
      renderStatusBar(); renderRecent();
      refreshMines();   // an action happened → refresh the placed-mines table right away
    }
    function bindLive() {
      mpOnEvent = onEvent;
      if (!mpSocketBound && window.SSA && SSA.socket) {
        mpSocketBound = true;
        SSA.socket.on('mine-protection:event', function (rec) { if (mpOnEvent) mpOnEvent(rec); });
      }
      refreshStatusLoop();
    }
    function refreshMines() {
      api('/mines').then(function (r) { if (mpOnEvent !== onEvent) return; mines = (r && r.mines) || []; renderMines(); });
    }
    function refreshStatusLoop() {
      if (mpOnEvent !== onEvent) return;                 // a newer mount took over → stop this loop
      if (mpLiveTimer) { clearTimeout(mpLiveTimer); mpLiveTimer = null; }
      Promise.all([api('/status'), api('/mines')]).then(function (rr) {
        if (mpOnEvent !== onEvent) return;               // superseded while the request was in flight
        var s = rr[0]; if (s && s.enabled != null) { status = s; renderStatusBar(); renderRecent(); }
        mines = (rr[1] && rr[1].mines) || []; renderMines();
        mpLiveTimer = setTimeout(refreshStatusLoop, 8000);
      });
    }

    // ── status header ──
    function badge(cls, label, val) { return h('div', { class: 'mp-badge ' + cls }, [h('span', { class: 'mp-badge-v' }, String(val)), h('span', { class: 'mp-badge-l' }, label)]); }
    function renderStatusBar() {
      statusBar.innerHTML = '';
      var on = config.enabled;
      statusBar.appendChild(h('div', { class: 'mp-badge ' + (on ? 'ok' : 'off') }, [h('span', { class: 'mp-dot' }), h('span', { class: 'mp-badge-l' }, on ? 'Active' : 'Disabled')]));
      var srv = status && status.serverRunning;
      statusBar.appendChild(h('div', { class: 'mp-badge ' + (srv ? 'ok' : 'warn') }, [h('span', { class: 'mp-dot' }), h('span', { class: 'mp-badge-l' }, srv ? 'Server online' : 'Server offline')]));
      statusBar.appendChild(badge('', 'Watched', (config.watchedTypes || []).length));
      statusBar.appendChild(badge('', 'Tracked mines', status ? status.knownMines : '–'));
      statusBar.appendChild(badge('', 'Flagged players', status ? status.warnedPlayers : '–'));
    }

    // ── the mine/trap picker (icons + live placed/armed counts) ──
    var pickerGrid = null;
    function renderPicker() {
      if (!pickerGrid) return;
      pickerGrid.innerHTML = '';
      var watched = new Set(config.watchedTypes || []);
      catalog.forEach(function (t) {
        var sel = watched.has(t.type);
        var counts = [];
        if (t.placed) counts.push(t.placed + ' placed');
        if (t.armed) counts.push(t.armed + ' armed');
        var media = t.image
          ? h('img', { class: 'mp-pi-img', src: t.image, alt: '', loading: 'lazy' })
          : h('span', { class: 'mp-pi-ph' }, icon('box'));
        var cardEl = h('button', { type: 'button', class: 'mp-pi' + (sel ? ' on' : ''), title: t.type }, [
          h('span', { class: 'mp-pi-check' }, sel ? icon('check') : null),
          media,
          h('span', { class: 'mp-pi-name' }, t.name || t.type),
          h('span', { class: 'mp-pi-meta' }, counts.length ? counts.join(' · ') : (t.explosive ? 'explosive' : 'trap')),
        ]);
        cardEl.addEventListener('click', function () {
          if (watched.has(t.type)) watched.delete(t.type); else watched.add(t.type);
          config.watchedTypes = catalog.map(function (x) { return x.type; }).filter(function (x) { return watched.has(x); });
          renderPicker(); renderStatusBar();
        });
        pickerGrid.appendChild(cardEl);
      });
    }

    // ── exemptions ──
    var exemptWrap = null;
    function renderExempt() {
      if (!exemptWrap) return;
      exemptWrap.innerHTML = '';
      var ids = config.exemptSteamIds || [];
      if (!ids.length) exemptWrap.appendChild(h('span', { class: 'mp-empty' }, 'No exemptions — everyone is enforced.'));
      ids.forEach(function (sid) {
        exemptWrap.appendChild(h('span', { class: 'mp-chip' }, [
          h('code', {}, sid),
          h('button', { type: 'button', class: 'mp-chip-x', title: 'Remove', onclick: function () { config.exemptSteamIds = ids.filter(function (x) { return x !== sid; }); renderExempt(); } }, '✕'),
        ]));
      });
    }
    function addExempt(sid) {
      sid = String(sid || '').trim(); if (!sid) return;
      config.exemptSteamIds = config.exemptSteamIds || [];
      if (config.exemptSteamIds.indexOf(sid) < 0) config.exemptSteamIds.push(sid);
      renderExempt();
    }
    function pickOnline() {
      // native SDK player picker (online list + manual SteamID)
      SSA.pickPlayer({ title: 'Exempt a player' }).then(function (p) { if (p && p.steamId) addExempt(p.steamId); });
    }

    // ── placed-mines overview table (live) ──
    var minesTbl = null;
    function mineStatus(m) {
      return !m.armed ? SSA.cell.tag('Not armed', 'muted')
        : m.exempt ? SSA.cell.tag('Exempt', 'muted')
          : m.inArea ? SSA.cell.tag('Inside flag', 'ok')
            : !m.handled ? SSA.cell.tag('Pending', 'warn')
              : SSA.cell.tag('Enforced', 'bad');
    }
    function mineStatusRank(m) { return !m.armed ? 5 : m.exempt ? 4 : m.inArea ? 3 : !m.handled ? 0 : 1; }
    function mineCode(r) { return r.code || (r.type ? r.type + '_ES' : null); }
    function buildMinesTable() {
      return SSA.table({
        rows: function () { return mines; },
        searchPlaceholder: 'Search mines, players…',
        search: function (r) { return [r.id, r.name, r.type, r.placerName, r.placerSteamId].join(' '); },
        empty: function () { return (status && status.serverRunning === false) ? 'Game DB not readable (server stopped / restarting).' : 'No watched mines placed on the server right now.'; },
        sort: { key: 'status', dir: 'asc' }, pageSize: 12, onRefresh: refreshMines,
        columns: [
          { key: 'id', label: '#', sort: true, sortVal: function (r) { return Number(r.id); }, tdClass: 'mono dim', render: function (r) { return document.createTextNode(String(r.id)); } },
          { key: 'type', label: 'Type', sort: true, sortVal: function (r) { return (r.name || r.type || '').toLowerCase(); }, render: function (r) { return SSA.cell.item(mineCode(r), r.name || r.type); } },
          { key: 'placer', label: 'Placer', sort: true, sortVal: function (r) { return (r.placerName || r.placerSteamId || '').toLowerCase(); }, render: function (r) { return SSA.cell.player(r.placerName, r.placerSteamId); } },
          { key: 'loc', label: 'Location', render: function (r) { return SSA.cell.location(r.x, r.y, r.z); } },
          { key: 'status', label: 'Status', sort: true, sortVal: mineStatusRank, render: mineStatus },
          { key: 'offences', label: 'Offences', sort: true, sortVal: function (r) { return r.offences || 0; }, tdClass: 'mono', render: function (r) { return document.createTextNode(String(r.offences || 0)); } },
        ],
      });
    }
    function renderMines() { if (minesTbl) minesTbl.refresh(); }

    // ── recent actions table (live) ──
    var recentTbl = null;
    function buildRecentTable() {
      var reset = h('button', { class: 'secondary', onclick: function () { api('/reset-offenses', { method: 'POST' }).then(function () { toast('Warnings reset'); refreshStatusLoop(); }); } }, 'Reset warnings');
      var clear = h('button', { class: 'secondary', onclick: function () { api('/clear-history', { method: 'POST' }).then(function () { status = status || {}; status.recent = []; renderRecent(); }); } }, 'Clear history');
      return SSA.table({
        rows: function () { return (status && status.recent) || []; },
        searchPlaceholder: 'Search recent actions…',
        search: function (r) { return [r.player, r.steamId, r.mine, r.type, r.action].join(' '); },
        empty: 'Nothing yet — actions will appear here live.',
        sort: { key: 'at', dir: 'desc' }, pageSize: 12, toolbar: [reset, clear],
        columns: [
          { key: 'at', label: 'When', sort: true, sortVal: function (r) { return r.at || 0; }, tdClass: 'dim', render: function (r) { return document.createTextNode(ago(r.at)); } },
          { key: 'action', label: 'Action', sort: true, sortVal: function (r) { return r.action; }, render: function (r) { var w = r.action === 'warn'; return SSA.cell.tag(w ? 'Warned' : 'Teleported', w ? 'warn' : 'bad'); } },
          { key: 'player', label: 'Player', sort: true, sortVal: function (r) { return (r.player || r.steamId || '').toLowerCase(); }, render: function (r) { return SSA.cell.player(r.player, r.steamId); } },
          { key: 'mine', label: 'Mine', sort: true, sortVal: function (r) { return (r.mine || r.type || '').toLowerCase(); }, render: function (r) { return SSA.cell.item(r.type ? r.type + '_ES' : null, r.mine || r.type || 'mine'); } },
          { key: 'loc', label: 'Location', render: function (r) { return r.loc ? SSA.cell.location(r.loc.x, r.loc.y, r.loc.z) : document.createTextNode(''); } },
        ],
      });
    }
    function renderRecent() { if (recentTbl) recentTbl.refresh(); }

    // ── full render ──
    function render() {
      body.innerHTML = '';
      renderStatusBar();

      // 0) placed-mines overview (native SDK table: search / sort / pagination + refresh icon in its toolbar)
      minesTbl = buildMinesTable();
      body.appendChild(card('Placed mines (live)', 'Every watched mine on the server right now — click the mine for a preview, a player to open them, a location to show it on the map.', [minesTbl.el]));

      // 1) watched types (picker)
      pickerGrid = h('div', { class: 'mp-pick-grid' });
      var quick = h('div', { class: 'mp-pick-quick' }, [
        h('button', { type: 'button', class: 'secondary', onclick: function () { config.watchedTypes = catalog.filter(function (t) { return t.explosive; }).map(function (t) { return t.type; }); renderPicker(); renderStatusBar(); } }, 'Explosives only'),
        h('button', { type: 'button', class: 'secondary', onclick: function () { config.watchedTypes = catalog.map(function (t) { return t.type; }); renderPicker(); renderStatusBar(); } }, 'Select all'),
        h('button', { type: 'button', class: 'secondary', onclick: function () { config.watchedTypes = []; renderPicker(); renderStatusBar(); } }, 'Clear'),
      ]);
      body.appendChild(card('Watched mines & traps', 'Pick which armed devices are enforced. Counts show what’s placed on the server right now.', [quick, pickerGrid]));
      renderPicker();

      // 2) action & rules
      var actSel = h('select', { onchange: function () { config.action = actSel.value; } }, [
        h('option', { value: 'teleport_to_mine' }, 'Teleport onto their mine (kill)'),
        h('option', { value: 'warn' }, 'Warn only (never teleport)'),
      ]);
      actSel.value = config.action;
      body.appendChild(card('Action & rules', null, [
        h('div', { class: 'mp-grid' }, [
          field('When a violation is found', actSel),
          field('Warnings before action', numInput(function () { return config.warningsBeforeAction; }, function (v) { config.warningsBeforeAction = Math.max(0, Math.min(10, v | 0)); }, { min: 0, max: 10 }), '0 = act on the first offence'),
          field('Extra margin around flag (m)', numInput(function () { return config.marginMeters; }, function (v) { config.marginMeters = Math.max(0, v || 0); }, { min: 0, step: 1 }), 'Tolerance beyond the exact flag rectangle'),
          field('Scan interval (s)', numInput(function () { return config.pollSeconds; }, function (v) { config.pollSeconds = Math.max(2, Math.min(120, v | 0)); }, { min: 2, max: 120 }), 'Applies immediately on save'),
        ]),
        h('div', { class: 'mp-checks' }, [
          checkbox('Only act while the placer is online', function () { return config.requireOnline; }, function (v) { config.requireOnline = v; }),
        ]),
      ]));

      // 3) messages
      var chanSel = h('select', { onchange: function () { config.channel = chanSel.value; } }, [
        ['local', 'Local'], ['global', 'Global'], ['squad', 'Squad'], ['admin', 'Admin'], ['server', 'Server'],
      ].map(function (o) { return h('option', { value: o[0], selected: (config.channel || 'local') === o[0] || undefined }, o[1]); }));
      body.appendChild(card('In-game messages', 'Sent to the offender via the SSA Bridge — any language.', [
        h('div', { class: 'mp-grid' }, [
          field('Chat channel', chanSel, 'Which chat tab the message shows in for the offender'),
        ]),
        h('div', { class: 'mp-stack' }, [
          field('Warning message', textInput(function () { return config.warnMessage; }, function (v) { config.warnMessage = v; })),
          field('Penalty message', textInput(function () { return config.message; }, function (v) { config.message = v; })),
        ]),
      ]));

      // 4) exemptions
      exemptWrap = h('div', { class: 'mp-chips' });
      var manualIn = h('input', { type: 'text', class: 'mp-ex-in', placeholder: 'Steam ID (17 digits)' });
      var addBtn = h('button', { type: 'button', class: 'secondary', onclick: function () { addExempt(manualIn.value); manualIn.value = ''; } }, 'Add');
      manualIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addExempt(manualIn.value); manualIn.value = ''; } });
      body.appendChild(card('Exemptions', 'These players are never punished.', [
        exemptWrap,
        h('div', { class: 'mp-ex-add' }, [manualIn, addBtn, h('button', { type: 'button', class: 'secondary', onclick: pickOnline }, 'Pick online player…')]),
      ]));
      renderExempt();

      // 5) recent actions (native SDK table; Reset warnings / Clear history live in its toolbar)
      recentTbl = buildRecentTable();
      body.appendChild(card('Recent actions', null, [recentTbl.el]));

      // save bar
      var msg = h('span', { class: 'mp-savemsg' });
      var saveBtn = h('button', { type: 'button', class: '', onclick: function () {
        msg.textContent = 'Saving…'; saveBtn.disabled = true;
        api('/config', { method: 'POST', body: config }).then(function (r) {
          saveBtn.disabled = false;
          if (r && r.ok) { config = Object.assign({}, DEF, r.config || config); msg.textContent = 'Saved ✓'; toast('Configuration saved'); renderStatusBar(); }
          else { msg.textContent = 'Save failed'; toast('Save failed', 'error'); }
          setTimeout(function () { msg.textContent = ''; }, 2500);
        });
      } }, 'Save configuration');
      body.appendChild(h('div', { class: 'mp-actions' }, [saveBtn, msg]));
    }

    function checkbox(label, get, set) {
      var b = h('input', { type: 'checkbox', onchange: function () { set(b.checked); } }); b.checked = get() === true;
      return h('label', { class: 'mp-chk' }, [b, label]);
    }
    function toast(m, kind) { if (window.SSA && SSA.toast) SSA.toast(m, kind); }
  }

  SSA.ready(function () {
    SSA.registerTab({ id: 'mine-protection', label: 'Mine Protection', icon: '#i-shield', premium: true, render: editor });
  });
}());
