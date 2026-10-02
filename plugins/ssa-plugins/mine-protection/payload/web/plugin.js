/* Mine Protection — admin configuration UI.
 *
 * A self-contained tab: a live status header, an illustrated mine/trap picker (icons + how many are
 * placed/armed right now), escalation rules, per-message text, an exemption player-picker, and a live
 * feed of recent actions. Talks only to its own backend under /api/plugin-host/mine-protection. */
(function () {
  // Where the bridge's switches live, built from the PANEL's own keys (the nav entry and the tab
  // that render themselves from them), so the route is right in every language and after a rename.
  function bridgeWhere() {
    return SSA.t('nav.plugins', 'Plugins') + ' → ' + SSA.t('plugins.viewInGame', 'SSA Bridge');
  }
  var DEF = {
    enabled: true, pollSeconds: 6, marginMeters: 0,
    watchedTypes: ['ImprovisedMine', 'Mine_01', 'Mine_02', 'ImprovisedClaymore', 'Claymore', 'PressureCookerBomb', 'PipeBomb', 'PromTrap'],
    action: 'teleport_to_mine', warningsBeforeAction: 1, requireOnline: true,
    exemptSteamIds: [], channel: 'local',
    message: 'Arming a mine outside your own or your squad\'s flag area is not allowed. Enjoy your own trap.',
    warnMessage: 'Warning: arm mines only inside your own or your squad\'s flag area. The next one takes you with it.',
  };

  // ── backend calls ───────────────────────────────────────────────────────────
  // The manager's own client, not a hand-rolled one. The wrapper this replaces swallowed a failure
  // TWICE — the inner catch ate a body that was not JSON, the outer ate the network failure and
  // every non-2xx — so a backend that was down, a route that 404'd and a session that had expired
  // all arrived as `{}`. Every `(r && r.mines) || []` below then drew an empty table, which is a
  // sentence about the WORLD ("no mines are placed") when the truth was about the REQUEST.
  //
  // `SSA.apiClient()` is captured here, at the top of the script, because `SSA.api` resolves the
  // calling plugin at call time and the panel only knows who is asking inside a render — every call
  // in this file is a poll tick, a click or a `.then`, and would have gone to /api/plugin-host/_/.
  var api = SSA.apiClient();
  // One sentence for a failure, the route's own words first. Used by every catch in this file.
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
    if (s < 60) return SSA.t('pl.mine-protection.ago.seconds', '{n}s ago', { n: s });
    if (s < 3600) return SSA.t('pl.mine-protection.ago.minutes', '{n}m ago', { n: Math.floor(s / 60) });
    if (s < 86400) return SSA.t('pl.mine-protection.ago.hours', '{n}h ago', { n: Math.floor(s / 3600) });
    return SSA.t('pl.mine-protection.ago.days', '{n}d ago', { n: Math.floor(s / 86400) });
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
      h('p', { class: 'mp-intro' }, SSA.t('pl.mine-protection.intro', 'Punish players who arm a mine or trap outside their own or squad’s flag area.')),
    ]));
    var statusBar = h('div', { class: 'mp-status' });
    el.appendChild(statusBar);
    // Said out loud when a live cross-check could not run: the plugin then judges a mine on the
    // LAST SAVE, which is what it always did — but an owner who is not told cannot tell the
    // difference between that and a plugin that is working perfectly.
    var liveBar = h('div', { class: 'mp-live' });
    el.appendChild(liveBar);
    var body = h('div', { class: 'mp-body' }, [h('p', { class: 'mp-loading' }, SSA.t('pl.mine-protection.loading', 'Loading…'))]);
    el.appendChild(body);

    // Where a failure goes. Without a slot, a throwing client only moves the silence: the promise
    // rejects, nothing renders, and the tab sits on "Loading…" for ever — which reads as slow rather
    // than as broken.
    function loadFailed(err) {
      body.innerHTML = '';
      var retry = h('button', { type: 'button', class: 'secondary', onclick: function () { body.innerHTML = ''; body.appendChild(h('p', { class: 'mp-loading' }, SSA.t('pl.mine-protection.loading', 'Loading…'))); load(); } }, SSA.t('pl.mine-protection.btn.tryAgain', 'Try again'));
      body.appendChild(h('div', { class: 'mp-err' }, [
        h('strong', {}, SSA.t('pl.mine-protection.err.loadFailed', 'This tab could not load its settings. ')),
        h('span', {}, why(err)),
        h('div', { class: 'mp-err-act' }, [retry]),
      ]));
    }
    function load() {
      Promise.all([api('/config'), api('/catalog'), api('/status')]).then(function (r) {
        config = Object.assign({}, DEF, r[0] || {});
        catalog = (r[1] && r[1].items) || [];
        status = r[2] || null;
        render();
        bindLive();
      }).catch(loadFailed);
    }
    load();

    // This editor's event handler; installing it as the shared `mpOnEvent` makes this the active mount,
    // which also stops any previous mount's poll loop (it checks it's still the active handler).
    function onEvent(rec) {
      if (!rec) return;
      if (!el.isConnected) { mpOnEvent = null; return; }
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
    // A poll that fails is its own case and must not be treated like the first load. The screen is
    // already drawn and the settings on it are still the owner's; what has stopped is the live half.
    // So the tables keep the last figures they had, and the live bar says the figures are stale —
    // clearing them would turn "I could not ask" into "there is nothing there", which is the exact
    // lie this whole change is about.
    var pollErr = null;
    function pollFailed(err) {
      if (mpOnEvent !== onEvent) return;
      pollErr = why(err);
      renderLiveBar();
      mpLiveTimer = setTimeout(refreshStatusLoop, 8000);   // keep trying; it may be a restart
    }
    function refreshMines() {
      api('/mines').then(function (r) {
        if (mpOnEvent !== onEvent) return;
        pollErr = null; mines = (r && r.mines) || []; renderMines(); renderLiveBar();
      }).catch(function (err) { if (mpOnEvent === onEvent) { pollErr = why(err); renderLiveBar(); } });
    }
    function refreshStatusLoop() {
      if (mpOnEvent !== onEvent) return;                 // a newer mount took over → stop this loop
      if (mpLiveTimer) { clearTimeout(mpLiveTimer); mpLiveTimer = null; }
      // The tab was left: stop for good. Both routes walk the whole world, and nothing was drawing
      // what they answered. Opening the tab again mounts a new editor, which starts its own loop.
      if (!el.isConnected) { mpOnEvent = null; return; }
      // Nobody is looking at the page: ask again later, without asking the server now.
      if (document.hidden) { mpLiveTimer = setTimeout(refreshStatusLoop, 8000); return; }
      Promise.all([api('/status'), api('/mines')]).then(function (rr) {
        if (mpOnEvent !== onEvent) return;               // superseded while the request was in flight
        pollErr = null;
        var s = rr[0]; if (s && s.enabled != null) { status = s; renderStatusBar(); renderRecent(); }
        mines = (rr[1] && rr[1].mines) || []; renderMines();
        mpLiveTimer = setTimeout(refreshStatusLoop, 8000);
      }).catch(pollFailed);
    }

    // ── status header ──
    function badge(cls, label, val) { return h('div', { class: 'mp-badge ' + cls }, [h('span', { class: 'mp-badge-v' }, String(val)), h('span', { class: 'mp-badge-l' }, label)]); }
    function renderStatusBar() {
      statusBar.innerHTML = '';
      var on = config.enabled;
      statusBar.appendChild(h('div', { class: 'mp-badge ' + (on ? 'ok' : 'off') }, [h('span', { class: 'mp-dot' }), h('span', { class: 'mp-badge-l' }, on ? SSA.t('pl.mine-protection.status.active', 'Active') : SSA.t('pl.mine-protection.status.disabled', 'Disabled'))]));
      var srv = status && status.serverRunning;
      statusBar.appendChild(h('div', { class: 'mp-badge ' + (srv ? 'ok' : 'warn') }, [h('span', { class: 'mp-dot' }), h('span', { class: 'mp-badge-l' }, srv ? SSA.t('pl.mine-protection.status.serverOnline', 'Server online') : SSA.t('pl.mine-protection.status.serverOffline', 'Server offline'))]));
      statusBar.appendChild(badge('', SSA.t('pl.mine-protection.badge.watched', 'Watched'), (config.watchedTypes || []).length));
      statusBar.appendChild(badge('', SSA.t('pl.mine-protection.badge.trackedMines', 'Tracked mines'), status ? status.knownMines : '–'));
      statusBar.appendChild(badge('', SSA.t('pl.mine-protection.badge.flaggedPlayers', 'Flagged players'), status ? status.warnedPlayers : '–'));
      renderLiveBar();
    }
    // One line per cross-check that could not run, with the module's own words where it gave any
    // and the name of the switch to turn on where it did not. Nothing is drawn while both are
    // answering — a banner that is always there is a banner nobody reads.
    var LIVE_WHAT = {
      traps: SSA.t('pl.mine-protection.live.traps', 'Whether a mine is really still armed is being read from the last save'),
      squads: SSA.t('pl.mine-protection.live.squads', 'Who is in a squad is being read from the last save'),
    };
    function renderLiveBar() {
      liveBar.innerHTML = '';
      if (pollErr) {
        liveBar.appendChild(h('div', { class: 'mp-live-n mp-live-err' }, [
          h('strong', {}, SSA.t('pl.mine-protection.live.stalledTitle', 'The live figures below have stopped updating. ')),
          document.createTextNode(SSA.t('pl.mine-protection.live.stalledDetail', '{err} Showing the last answer received; settings here are unaffected.', { err: pollErr })),
        ]));
      }
      // The server being off is not a fault and not a reason to stop. Two lists on this page are a
      // photograph of the running world and cannot exist without one; everything else is a rule the
      // owner writes, and the best moment to write it is BEFORE the server comes up. Say which is
      // which, rather than leaving an empty table at the top of the page to be read as "broken".
      if (status && status.serverRunning === false) {
        liveBar.appendChild(h('div', { class: 'mp-live-n mp-live-off' }, [
          h('strong', {}, SSA.t('pl.mine-protection.live.serverOffTitle', 'The server is not running. ')),
          document.createTextNode(SSA.t('pl.mine-protection.live.serverOffDetail', 'Set everything up now. Only the placed-mine list and card counts need the server running.')),
        ]));
      }
      var live = (status && status.live) || {};
      Object.keys(LIVE_WHAT).forEach(function (k) {
        var n = live[k];
        if (!n || !n.text) return;
        liveBar.appendChild(h('div', { class: 'mp-live-n' }, [
          h('strong', {}, LIVE_WHAT[k] + ': '),
          document.createTextNode((n.code === 'module_off' && n.switch)
            ? SSA.t('pl.mine-protection.live.turnOn', 'turn on "{switch}" in {where}.', { switch: n.switch, where: bridgeWhere() })
            : n.text + '.'),
        ]));
      });
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
        if (t.placed) counts.push(SSA.t('pl.mine-protection.picker.placed', '{n} placed', { n: t.placed }));
        if (t.armed) counts.push(SSA.t('pl.mine-protection.picker.armed', '{n} armed', { n: t.armed }));
        var media = t.image
          ? h('img', { class: 'mp-pi-img', src: t.image, alt: '', loading: 'lazy' })
          : h('span', { class: 'mp-pi-ph' }, icon('box'));
        var cardEl = h('button', { type: 'button', class: 'mp-pi' + (sel ? ' on' : ''), title: t.type }, [
          h('span', { class: 'mp-pi-check' }, sel ? icon('check') : null),
          media,
          h('span', { class: 'mp-pi-name' }, t.name || t.type),
          h('span', { class: 'mp-pi-meta' }, counts.length ? counts.join(' · ') : (t.explosive ? SSA.t('pl.mine-protection.picker.explosive', 'explosive') : SSA.t('pl.mine-protection.picker.trap', 'trap'))),
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
      if (!ids.length) exemptWrap.appendChild(h('span', { class: 'mp-empty' }, SSA.t('pl.mine-protection.exempt.none', 'No exemptions — everyone is enforced.')));
      ids.forEach(function (sid) {
        exemptWrap.appendChild(h('span', { class: 'mp-chip' }, [
          h('code', {}, sid),
          h('button', { type: 'button', class: 'mp-chip-x', title: SSA.t('pl.mine-protection.exempt.remove', 'Remove'), onclick: function () { config.exemptSteamIds = ids.filter(function (x) { return x !== sid; }); renderExempt(); } }, '✕'),
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
      SSA.pickPlayer({ title: SSA.t('pl.mine-protection.exempt.pickTitle', 'Exempt a player') }).then(function (p) { if (p && p.steamId) addExempt(p.steamId); });
    }

    // ── placed-mines overview table (live) ──
    var minesTbl = null;
    // Both `armed` and `inArea` are THREE-valued: true, false, or null when the game could not be
    // asked. Null is not false, and showing it as one is how this table came to describe a mine as
    // an offence that the plugin was deliberately declining to act on. Each unknown gets its own
    // label and says what the plugin does about it — which is nothing, on purpose.
    function mineStatus(m) {
      return m.armed == null ? SSA.cell.tag(SSA.t('pl.mine-protection.mine.armedUnknown', 'Armed state unknown'), 'muted')
        : !m.armed ? SSA.cell.tag(SSA.t('pl.mine-protection.mine.notArmed', 'Not armed'), 'muted')
          : m.exempt ? SSA.cell.tag(SSA.t('pl.mine-protection.mine.exempt', 'Exempt'), 'muted')
            : m.inArea === true ? SSA.cell.tag(SSA.t('pl.mine-protection.mine.insideFlag', 'Inside flag'), 'ok')
              : m.inArea == null ? SSA.cell.tag(SSA.t('pl.mine-protection.mine.flagUnknown', 'Flag unknown'), 'muted')
                : !m.handled ? SSA.cell.tag(SSA.t('pl.mine-protection.mine.pending', 'Pending'), 'warn')
                  : SSA.cell.tag(SSA.t('pl.mine-protection.mine.enforced', 'Enforced'), 'bad');
    }
    function mineStatusRank(m) { return m.armed == null ? 6 : !m.armed ? 5 : m.exempt ? 4 : m.inArea === true ? 3 : m.inArea == null ? 2 : !m.handled ? 0 : 1; }
    function mineCode(r) { return r.code || (r.type ? r.type + '_ES' : null); }
    function buildMinesTable() {
      return SSA.table({
        rows: function () { return mines; },
        searchPlaceholder: SSA.t('pl.mine-protection.mines.search', 'Search mines, players…'),
        search: function (r) { return [r.id, r.name, r.type, r.placerName, r.placerSteamId].join(' '); },
        // Not "Game DB not readable", which reads as a fault. A stopped server is the ordinary case
        // for an owner setting this up, and the sentence has to say that the rest of the page is
        // still theirs to write — otherwise an empty table at the top of the screen is read as
        // "this plugin does not work yet".
        empty: function () {
          return (status && status.serverRunning === false)
            ? SSA.t('pl.mine-protection.mines.emptyServerOff', 'This list fills in once the server starts. Everything else can be set now.')
            : SSA.t('pl.mine-protection.mines.empty', 'No watched mines in the server\'s last save.');
        },
        sort: { key: 'status', dir: 'asc' }, pageSize: 12, onRefresh: refreshMines,
        columns: [
          { key: 'id', label: '#', sort: true, sortVal: function (r) { return Number(r.id); }, tdClass: 'mono dim', render: function (r) { return document.createTextNode(String(r.id)); } },
          { key: 'type', label: SSA.t('pl.mine-protection.col.type', 'Type'), sort: true, sortVal: function (r) { return (r.name || r.type || '').toLowerCase(); }, render: function (r) { return SSA.cell.item(mineCode(r), r.name || r.type); } },
          { key: 'placer', label: SSA.t('pl.mine-protection.col.placer', 'Placer'), sort: true, sortVal: function (r) { return (r.placerName || r.placerSteamId || '').toLowerCase(); }, render: function (r) { return SSA.cell.player(r.placerName, r.placerSteamId); } },
          { key: 'loc', label: SSA.t('pl.mine-protection.col.location', 'Location'), render: function (r) { return SSA.cell.location(r.x, r.y, r.z); } },
          { key: 'status', label: SSA.t('pl.mine-protection.col.status', 'Status'), sort: true, sortVal: mineStatusRank, render: mineStatus },
          // The count only ever goes up, and until now the only way to clear it wiped EVERY player's
          // record. Forgiving one person meant forgiving all of them, so in practice nobody was
          // forgiven and a player stayed one mine away from the real punishment over something from
          // months ago.
          { key: 'offences', label: SSA.t('pl.mine-protection.col.offences', 'Offences'), sort: true, sortVal: function (r) { return r.offences || 0; }, tdClass: 'mono', render: function (r) {
            var n = r.offences || 0;
            var txt = document.createTextNode(String(n));
            if (!n || !r.placerSteamId) return txt;
            var wrap = h('span', { class: 'mp-off' }, [txt]);
            wrap.appendChild(h('button', {
              class: 'secondary mp-off-x',
              title: SSA.t('pl.mine-protection.offences.forgiveTitle', 'Forget this player’s offences — they get their warnings back'),
              onclick: function () {
                api('/reset-offenses', { method: 'POST', body: { steamId: r.placerSteamId } })
                  .then(function () { toast(SSA.t('pl.mine-protection.toast.offencesCleared', 'Offences cleared for {player}', { player: r.placerName || r.placerSteamId })); refreshStatusLoop(); })
                  .catch(function (err) { toast(SSA.t('pl.mine-protection.toast.notCleared', 'Nothing was cleared — {err}', { err: why(err) }), 'error'); });
              },
            }, SSA.t('pl.mine-protection.btn.forgive', 'Forgive')));
            return wrap;
          } },
        ],
      });
    }
    function renderMines() { if (minesTbl) minesTbl.refresh(); }

    // ── recent actions table (live) ──
    var recentTbl = null;
    function buildRecentTable() {
      // Both of these are destructive, so a refusal must never look like a success. Clearing the
      // local list on a failed POST is the worse half: the history would come back on the next
      // refresh, and the admin would already have moved on believing it was gone.
      var reset = h('button', { class: 'secondary', onclick: function () { api('/reset-offenses', { method: 'POST' }).then(function () { toast(SSA.t('pl.mine-protection.toast.warningsReset', 'Warnings reset')); refreshStatusLoop(); }).catch(function (err) { toast(SSA.t('pl.mine-protection.toast.warningsNotReset', 'Warnings were NOT reset — {err}', { err: why(err) }), 'error'); }); } }, SSA.t('pl.mine-protection.btn.resetWarnings', 'Reset warnings'));
      var clear = h('button', { class: 'secondary', onclick: function () { api('/clear-history', { method: 'POST' }).then(function () { status = status || {}; status.recent = []; renderRecent(); }).catch(function (err) { toast(SSA.t('pl.mine-protection.toast.historyNotCleared', 'The history was NOT cleared — {err}', { err: why(err) }), 'error'); }); } }, SSA.t('pl.mine-protection.btn.clearHistory', 'Clear history'));
      return SSA.table({
        rows: function () { return (status && status.recent) || []; },
        searchPlaceholder: SSA.t('pl.mine-protection.recent.search', 'Search recent actions…'),
        search: function (r) { return [r.player, r.steamId, r.mine, r.type, r.action].join(' '); },
        empty: SSA.t('pl.mine-protection.recent.empty', 'Nothing yet — actions will appear here live.'),
        sort: { key: 'at', dir: 'desc' }, pageSize: 12, toolbar: [reset, clear],
        columns: [
          { key: 'at', label: SSA.t('pl.mine-protection.col.when', 'When'), sort: true, sortVal: function (r) { return r.at || 0; }, tdClass: 'dim', render: function (r) { return document.createTextNode(ago(r.at)); } },
          { key: 'action', label: SSA.t('pl.mine-protection.col.action', 'Action'), sort: true, sortVal: function (r) { return r.action; }, render: function (r) { var w = r.action === 'warn'; return SSA.cell.tag(w ? SSA.t('pl.mine-protection.recent.warned', 'Warned') : SSA.t('pl.mine-protection.recent.teleported', 'Teleported'), w ? 'warn' : 'bad'); } },
          { key: 'player', label: SSA.t('pl.mine-protection.col.player', 'Player'), sort: true, sortVal: function (r) { return (r.player || r.steamId || '').toLowerCase(); }, render: function (r) { return SSA.cell.player(r.player, r.steamId); } },
          { key: 'mine', label: SSA.t('pl.mine-protection.col.mine', 'Mine'), sort: true, sortVal: function (r) { return (r.mine || r.type || '').toLowerCase(); }, render: function (r) { return SSA.cell.item(r.type ? r.type + '_ES' : null, r.mine || r.type || SSA.t('pl.mine-protection.recent.mineFallback', 'mine')); } },
          { key: 'loc', label: SSA.t('pl.mine-protection.col.location', 'Location'), render: function (r) { return r.loc ? SSA.cell.location(r.loc.x, r.loc.y, r.loc.z) : document.createTextNode(''); } },
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
      body.appendChild(card(SSA.t('pl.mine-protection.card.placedMines.title', 'Placed mines'), SSA.t('pl.mine-protection.card.placedMines.sub', 'Watched mines at last save. Click a mine, player or location to open it.'), [minesTbl.el]));

      // 1) watched types (picker)
      pickerGrid = h('div', { class: 'mp-pick-grid' });
      var quick = h('div', { class: 'mp-pick-quick' }, [
        h('button', { type: 'button', class: 'secondary', onclick: function () { config.watchedTypes = catalog.filter(function (t) { return t.explosive; }).map(function (t) { return t.type; }); renderPicker(); renderStatusBar(); } }, SSA.t('pl.mine-protection.btn.explosivesOnly', 'Explosives only')),
        h('button', { type: 'button', class: 'secondary', onclick: function () { config.watchedTypes = catalog.map(function (t) { return t.type; }); renderPicker(); renderStatusBar(); } }, SSA.t('pl.mine-protection.btn.selectAll', 'Select all')),
        h('button', { type: 'button', class: 'secondary', onclick: function () { config.watchedTypes = []; renderPicker(); renderStatusBar(); } }, SSA.t('pl.mine-protection.btn.clear', 'Clear')),
      ]);
      // The subtitle used to promise counts unconditionally, and with the server off there are none —
      // so the card advertised a feature that was missing rather than one that was waiting.
      var pickSub = (status && status.serverRunning === false)
        ? SSA.t('pl.mine-protection.card.watched.subServerOff', 'Pick which armed devices are enforced. No server needed; counts appear once it runs.')
        : SSA.t('pl.mine-protection.card.watched.sub', 'Pick which armed devices are enforced. Counts show what the server\'s last save holds.');
      body.appendChild(card(SSA.t('pl.mine-protection.card.watched.title', 'Watched mines & traps'), pickSub, [quick, pickerGrid]));
      renderPicker();

      // 2) action & rules
      var actSel = h('select', { onchange: function () { config.action = actSel.value; } }, [
        h('option', { value: 'teleport_to_mine' }, SSA.t('pl.mine-protection.action.teleport', 'Teleport onto their mine (kill)')),
        h('option', { value: 'warn' }, SSA.t('pl.mine-protection.action.warn', 'Warn only (never teleport)')),
      ]);
      actSel.value = config.action;
      body.appendChild(card(SSA.t('pl.mine-protection.card.rules.title', 'Action & rules'), null, [
        h('div', { class: 'mp-grid' }, [
          field(SSA.t('pl.mine-protection.f.whenViolation', 'When a violation is found'), actSel),
          field(SSA.t('pl.mine-protection.f.warningsBefore', 'Warnings before action'), numInput(function () { return config.warningsBeforeAction; }, function (v) { config.warningsBeforeAction = Math.max(0, Math.min(10, v | 0)); }, { min: 0, max: 10 }), SSA.t('pl.mine-protection.f.warningsBefore.hint', '0 = act on the first offence')),
          field(SSA.t('pl.mine-protection.f.margin', 'Extra margin around flag (m)'), numInput(function () { return config.marginMeters; }, function (v) { config.marginMeters = Math.max(0, v || 0); }, { min: 0, step: 1 }), SSA.t('pl.mine-protection.f.margin.hint', 'Tolerance beyond the exact flag rectangle')),
          field(SSA.t('pl.mine-protection.f.scanInterval', 'Scan interval (s)'), numInput(function () { return config.pollSeconds; }, function (v) { config.pollSeconds = Math.max(2, Math.min(120, v | 0)); }, { min: 2, max: 120 }), SSA.t('pl.mine-protection.f.scanInterval.hint', 'Applies immediately on save')),
        ]),
        h('div', { class: 'mp-checks' }, [
          checkbox(SSA.t('pl.mine-protection.chk.requireOnline', 'Only act while the placer is online'), function () { return config.requireOnline; }, function (v) { config.requireOnline = v; }),
        ]),
      ]));

      // 3) messages
      var chanSel = h('select', { onchange: function () { config.channel = chanSel.value; } }, [
        ['local', SSA.t('pl.mine-protection.channel.local', 'Local')], ['global', SSA.t('pl.mine-protection.channel.global', 'Global')],
        ['squad', SSA.t('pl.mine-protection.channel.squad', 'Squad')], ['admin', SSA.t('pl.mine-protection.channel.admin', 'Admin')],
        ['server', SSA.t('pl.mine-protection.channel.server', 'Server')],
      ].map(function (o) { return h('option', { value: o[0], selected: (config.channel || 'local') === o[0] || undefined }, o[1]); }));
      body.appendChild(card(SSA.t('pl.mine-protection.card.messages.title', 'In-game messages'), SSA.t('pl.mine-protection.card.messages.sub', 'Sent to the offender via the SSA Bridge — any language.'), [
        h('div', { class: 'mp-grid' }, [
          field(SSA.t('pl.mine-protection.f.channel', 'Chat channel'), chanSel, SSA.t('pl.mine-protection.f.channel.hint', 'Which chat tab the message shows in for the offender')),
        ]),
        h('div', { class: 'mp-stack' }, [
          field(SSA.t('pl.mine-protection.f.warnMessage', 'Warning message'), textInput(function () { return config.warnMessage; }, function (v) { config.warnMessage = v; })),
          field(SSA.t('pl.mine-protection.f.penaltyMessage', 'Penalty message'), textInput(function () { return config.message; }, function (v) { config.message = v; })),
        ]),
      ]));

      // 4) exemptions
      exemptWrap = h('div', { class: 'mp-chips' });
      var manualIn = h('input', { type: 'text', class: 'mp-ex-in', placeholder: SSA.t('pl.mine-protection.exempt.placeholder', 'Steam ID (17 digits)') });
      var addBtn = h('button', { type: 'button', class: 'secondary', onclick: function () { addExempt(manualIn.value); manualIn.value = ''; } }, SSA.t('pl.mine-protection.btn.add', 'Add'));
      manualIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addExempt(manualIn.value); manualIn.value = ''; } });
      body.appendChild(card(SSA.t('pl.mine-protection.card.exempt.title', 'Exemptions'), SSA.t('pl.mine-protection.card.exempt.sub', 'These players are never punished.'), [
        exemptWrap,
        h('div', { class: 'mp-ex-add' }, [manualIn, addBtn, h('button', { type: 'button', class: 'secondary', onclick: pickOnline }, SSA.t('pl.mine-protection.btn.pickOnline', 'Pick online player…'))]),
      ]));
      renderExempt();

      // 5) recent actions (native SDK table; Reset warnings / Clear history live in its toolbar)
      recentTbl = buildRecentTable();
      body.appendChild(card(SSA.t('pl.mine-protection.card.recent.title', 'Recent actions'), null, [recentTbl.el]));

      // save bar
      var msg = h('span', { class: 'mp-savemsg' });
      var saveBtn = h('button', { type: 'button', class: '', onclick: function () {
        msg.textContent = SSA.t('pl.mine-protection.save.saving', 'Saving…'); saveBtn.disabled = true;
        api('/config', { method: 'POST', body: config }).then(function (r) {
          saveBtn.disabled = false;
          if (r && r.ok) { config = Object.assign({}, DEF, r.config || config); msg.textContent = SSA.t('pl.mine-protection.save.saved', 'Saved ✓'); toast(SSA.t('pl.mine-protection.toast.saved', 'Configuration saved')); renderStatusBar(); setTimeout(function () { msg.textContent = ''; }, 2500); }
          // A route that answered 200 without `ok` is a refusal too, and it may have said why.
          else {
            var w = (r && r.reason) || (r && r.error) || SSA.t('pl.mine-protection.save.noReason', 'the manager did not say why');
            var wsay = SSA.t('pl.mine-protection.save.notSaved', 'NOT saved — {err}', { err: w });
            msg.textContent = wsay; toast(wsay, 'error');
          }
        }).catch(function (err) {
          // The sentence STAYS beside the button until the next attempt. A save that did not happen
          // is not a transient notice — the owner's edits are still sitting unsaved in front of
          // them, and a toast is gone in four seconds.
          saveBtn.disabled = false;
          msg.textContent = SSA.t('pl.mine-protection.save.notSaved', 'NOT saved — {err}', { err: why(err) });
          toast(SSA.t('pl.mine-protection.save.notSaved', 'NOT saved — {err}', { err: why(err) }), 'error');
        });
      } }, SSA.t('pl.mine-protection.btn.save', 'Save configuration'));
      body.appendChild(h('div', { class: 'mp-actions' }, [saveBtn, msg]));
    }

    function checkbox(label, get, set) {
      var b = h('input', { type: 'checkbox', onchange: function () { set(b.checked); } }); b.checked = get() === true;
      return h('label', { class: 'mp-chk' }, [b, label]);
    }
    function toast(m, kind) { if (window.SSA && SSA.toast) SSA.toast(m, kind); }
  }

  SSA.ready(function () {
    SSA.registerTab({ id: 'mine-protection', label: SSA.t('pl.mine-protection.tab.label', 'Mine Protection'), icon: '#i-shield', premium: true, render: editor });
  });
}());
