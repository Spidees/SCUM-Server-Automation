/* Mine Protection — admin tab.
 *
 * Five screens, named in ONE map (`navLabels`) because the first-run note and several sentences
 * point at them: Overview (what runs, what it needs, the counters), Mines (every placed mine and
 * trap, with filters, ticks and removal by conditions), Flags (fallen flags and the mines outside
 * every flag), Activity (every removed mine, the removal queue, warnings and teleports) and Settings
 * (every switch). Talks only to its own backend under /api/plugin-host/mine-protection. */
(function () {
  var T = SSA.t;
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
    messageI18n: {}, warnMessageI18n: {},
    fallenFlagCleanup: false, fallenFlagDelayMinutes: 10, fallenFlagGraceMinutes: 120, fallenFlagTypes: 'all',
    fallenFlagCancelBy: 'owner', fallenFlagWake: true, fallenFlagAlert: true, fallenFlagAnnounce: false,
    fallenFlagMessage: 'The mines left in a fallen flag\'s area have been removed.', fallenFlagMessageI18n: {},
    punishEnabled: true,
    orphanCleanup: false, orphanTypes: 'watched', orphanGraceMinutes: 60, orphanOfflineOnly: true,
    orphanAlert: true, orphanAnnounce: false,
    orphanMessage: 'Mines left outside every flag area have been removed.', orphanMessageI18n: {},
    removeTryMinutes: 120, keepMineIds: [],
  };

  // ── the five screens, in one place ──────────────────────────────────────────────────────────
  function navLabels() {
    return {
      overview: T('pl.mine-protection.nav.overview', 'Overview'),
      mines: T('pl.mine-protection.nav.mines', 'Mines'),
      flags: T('pl.mine-protection.nav.flags', 'Flags'),
      activity: T('pl.mine-protection.nav.activity', 'Activity'),
      settings: T('pl.mine-protection.nav.settings', 'Settings'),
    };
  }
  var SCREENS = [['overview', 'pulse'], ['mines', 'pk-mine'], ['flags', 'flag'], ['activity', 'list'], ['settings', 'sliders']];
  var SCREEN_IDS = SCREENS.map(function (s) { return s[0]; });

  /**
   * Does one row of the Mines screen match its filters?
   *
   * ⚠ THE BACKEND HAS A COPY OF THIS (`mineMatches` in backend/index.js) and the two must agree:
   * "Remove all matching" names a count worked out here, and the backend works the match out again at
   * the press. A difference is a refusal ("the list changed"), never a different removal from the one
   * confirmed. `check-mine-protection` F1 holds the two to each other. Every unknown matches nothing.
   */
  function mineMatches(r, f, now) {
    f = f || {};
    if (f.type === '*watched') { if (!r.watched) return false; }
    else if (f.type && r.type !== f.type) return false;
    if (f.placer === '*unknown') { if (r.placerSteamId) return false; }
    else if (f.placer && r.placerSteamId !== f.placer) return false;
    if (f.flag === 'inside' && r.insideFlag !== true) return false;
    if (f.flag === 'outside' && r.insideFlag !== false) return false;
    if (f.flag === 'unknown' && r.insideFlag !== null && r.insideFlag !== undefined) return false;
    if (f.armed === 'armed' && r.armed !== true) return false;
    if (f.armed === 'disarmed' && r.armed !== false) return false;
    if (f.armed === 'unknown' && r.armed !== null && r.armed !== undefined) return false;
    if (f.sector && r.sector !== f.sector) return false;
    var days = Number(f.age) || 0;
    if (days > 0 && !(Number.isFinite(r.lastTouched) && now - r.lastTouched >= days * 86400000)) return false;
    var q = String(f.q || '').trim().toLowerCase();
    if (q && mineSearchText(r).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }
  function mineSearchText(r) { return [r.id, r.name, r.type, r.placerName, r.placerSteamId, r.sector].join(' '); }

  // ── backend calls ───────────────────────────────────────────────────────────
  // The manager's own client, captured at the top of the script: `SSA.api` resolves the calling
  // plugin at call time and every call here is a poll tick, a click or a `.then`.
  var api = SSA.apiClient();
  // An address for each screen (`#plugins/p/mine-protection/<screen>`), so a screen can be opened in
  // a new tab, bookmarked and reached with Back. An older panel without it keeps working in place.
  var route = (SSA.route && typeof SSA.route.client === 'function') ? SSA.route.client() : null;
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
  var icon = function (id, cls) { return SSA.icon(id, cls); };
  function card(title, sub, kids, cls) {
    var head = [h('h3', { class: 'mpr-card-t' }, title)];
    if (sub) head.push(h('p', { class: 'mpr-card-sub' }, sub));
    return h('div', { class: 'card mpr-card' + (cls ? ' ' + cls : '') }, head.concat(kids || []));
  }
  function field(label, ctl, hint) { return h('label', { class: 'mpr-f' }, [h('span', {}, label), ctl, hint ? h('small', { class: 'mpr-hint' }, hint) : null]); }
  function ago(ms) {
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return T('pl.mine-protection.ago.seconds', '{n}s ago', { n: s });
    if (s < 3600) return T('pl.mine-protection.ago.minutes', '{n}m ago', { n: Math.floor(s / 60) });
    if (s < 86400) return T('pl.mine-protection.ago.hours', '{n}h ago', { n: Math.floor(s / 3600) });
    return T('pl.mine-protection.ago.days', '{n}d ago', { n: Math.floor(s / 86400) });
  }
  function toast(m, kind) { if (window.SSA && SSA.toast) SSA.toast(m, kind); }
  /**
   * Put fresh children into `parent`, replacing only the ones that changed.
   *
   * Compared with the markup each child was BUILT with, never with the live DOM: the panel decorates
   * what a plugin puts on the page (a select is wrapped, a switch gains attributes), so a live node
   * never equals a freshly built copy and every poll would replace the lot. That is the tab "reloading
   * under the reader" every eight seconds, which an idle render check catches.
   */
  function patch(parent, next) {
    var built = next.map(function (n) { return n.outerHTML; });
    var memo = parent.__mprBuilt || [];
    var cur = [].slice.call(parent.childNodes);
    for (var i = 0; i < next.length; i++) {
      var c = cur[i];
      if (c && c.nodeType === 1 && memo[i] === built[i]) continue;
      if (c) parent.replaceChild(next[i], c); else parent.appendChild(next[i]);
    }
    while (parent.childNodes.length > next.length) parent.removeChild(parent.lastChild);
    parent.__mprBuilt = built;
  }

  // ── the house controls ──────────────────────────────────────────────────────
  function sw(label, get, set, hint) {
    var b = h('input', { type: 'checkbox', role: 'switch', onchange: function () { set(b.checked); } });
    b.checked = get() === true;
    return h('label', { class: 'mpr-sw' }, [b, h('span', { class: 'mpr-sw-t' }, label), hint ? h('small', { class: 'mpr-hint' }, hint) : null]);
  }
  function numInput(get, set, o) {
    o = o || {}; var i = h('input', { type: 'number', min: o.min, max: o.max, step: o.step || 1, oninput: function () { set(Number(i.value)); } });
    i.value = get(); return i;
  }
  function select(opts, value, onChange, label) {
    var s = h('select', { 'aria-label': label || null, onchange: function () { onChange(s.value); } },
      opts.map(function (o) { return h('option', { value: o[0] }, o[1]); }));
    s.value = value;
    return s;
  }
  function textInput(get, set) { var i = h('input', { type: 'text', oninput: function () { set(i.value); } }); i.value = get() || ''; return i; }
  // A text players read: one tab per player language when the manager has the editor for it.
  // The shipped line in every language comes from the backend (`/text-defaults`).
  var shippedTexts = null;
  function shippedFor(key) {
    if (!shippedTexts || !shippedTexts.byLang) return undefined;
    var out = {};
    Object.keys(shippedTexts.byLang).forEach(function (l) {
      var t = shippedTexts.byLang[l] && shippedTexts.byLang[l][key];
      if (typeof t === 'string' && t) out[l] = t;
    });
    return Object.keys(out).length ? out : undefined;
  }
  function messageEditor(cfg, key, label, onDirty) {
    if (typeof SSA.locText === 'function') {
      var en = shippedTexts && shippedTexts.english ? shippedTexts.english[key] : undefined;
      var defs = en ? shippedFor(key) : undefined;
      return SSA.locText({
        label: label, value: defs && (cfg[key] === en || !String(cfg[key] || '').trim()) ? '' : cfg[key], i18n: cfg[key + 'I18n'] || {}, rows: 3,
        defaults: defs,
        onChange: function (value, i18n) { cfg[key] = (defs && !String(value || '').trim()) ? en : value; cfg[key + 'I18n'] = i18n; onDirty(); },
      }).el;
    }
    return field(label, textInput(function () { return cfg[key]; }, function (v) { cfg[key] = v; onDirty(); }));
  }

  // Live state shared across mounts (a tab can be opened and closed many times): ONE poll timer,
  // ONE socket subscription, always driving the most recently mounted editor.
  var mpLiveTimer = null, mpActive = null, mpSocketBound = false;

  function editor(root) {
    var S = {
      screen: 'overview', config: null, catalog: [], status: null, mines: null, minesAt: 0,
      pollErr: null, minesErr: null, dirty: false,
      filter: { type: '*watched', placer: '', flag: '', armed: '', sector: '', age: 0 },
      picked: {}, allRemovals: null,
    };
    if (route) { var sub0 = String(route.get() || '').split('/')[0]; if (SCREEN_IDS.indexOf(sub0) >= 0) S.screen = sub0; }
    var L = navLabels();

    root.innerHTML = '';
    var wrap = h('div', { class: 'mpr-wrap' });
    root.appendChild(wrap);
    wrap.appendChild(h('p', { class: 'mpr-lead' }, T('pl.mine-protection.lead', 'Punishes mines armed outside their flag, and clears the mines no flag protects any more.')));
    var firstRun = h('div', { class: 'mpr-firstrun' });
    var nav = h('div', { class: 'mpr-nav', role: 'tablist' });
    var saveMsg = h('span', { class: 'mpr-savemsg' });
    var saveBtn = h('button', { type: 'button', onclick: save }, T('pl.mine-protection.btn.saveShort', 'Save'));
    var statBar = h('div', { class: 'mpr-stat' });
    var liveBar = h('div', { class: 'mpr-live' });
    var body = h('div', { class: 'mpr-body' }, [h('p', { class: 'mpr-loading' }, T('pl.mine-protection.loading', 'Loading…'))]);
    wrap.appendChild(firstRun);
    wrap.appendChild(h('div', { class: 'mpr-top' }, [nav, h('div', { class: 'mpr-top-r' }, [saveMsg, saveBtn])]));
    wrap.appendChild(statBar);
    wrap.appendChild(liveBar);
    wrap.appendChild(body);

    function markDirty() { S.dirty = true; saveBtn.classList.add('mpr-unsaved'); saveMsg.textContent = T('pl.mine-protection.save.unsaved', 'Unsaved changes'); }

    function go(screen, fromRoute) {
      if (SCREEN_IDS.indexOf(screen) < 0) screen = 'overview';
      S.screen = screen;
      if (route && !fromRoute) route.go(screen === 'overview' ? '' : screen);
      paintNav(); render();
      if (screen === 'mines' && !S.mines) refreshMines();
    }
    if (route) route.onChange(function (sub) { if (mpActive !== editorToken) return; var s = String(sub || '').split('/')[0] || 'overview'; if (s !== S.screen) go(s, true); });
    function paintNav() {
      nav.innerHTML = '';
      SCREENS.forEach(function (sc) {
        var id = sc[0];
        var a = h('a', { class: 'mpr-tab' + (S.screen === id ? ' active' : ''), role: 'tab', 'aria-selected': S.screen === id ? 'true' : 'false',
          href: route ? route.href(id === 'overview' ? '' : id) : '#' }, [icon(sc[1]), h('span', {}, L[id])]);
        a.addEventListener('click', function (e) {
          // A modified or middle click is the browser's: a new tab is the whole point of an address.
          if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
          e.preventDefault(); go(id);
        });
        nav.appendChild(a);
      });
    }

    // ── loading ────────────────────────────────────────────────────────────────
    function loadFailed(err) {
      body.innerHTML = '';
      var retry = h('button', { type: 'button', class: 'secondary', onclick: function () { body.innerHTML = ''; body.appendChild(h('p', { class: 'mpr-loading' }, T('pl.mine-protection.loading', 'Loading…'))); load(); } }, T('pl.mine-protection.btn.tryAgain', 'Try again'));
      body.appendChild(h('div', { class: 'mpr-err' }, [
        h('strong', {}, T('pl.mine-protection.err.loadFailed', 'This tab could not load its settings. ')),
        h('span', {}, why(err)),
        h('div', { class: 'mpr-err-act' }, [retry]),
      ]));
    }
    function load() {
      Promise.all([api('/config'), api('/catalog'), api('/status'), api('/text-defaults').catch(function () { return null; })]).then(function (r) {
        shippedTexts = r[3] || null;
        S.config = Object.assign({}, DEF, r[0] || {});
        S.catalog = (r[1] && r[1].items) || [];
        S.status = r[2] || null;
        paintNav(); render(); bind();
        if (S.screen === 'mines') refreshMines();
      }).catch(loadFailed);
    }

    // ── polling ────────────────────────────────────────────────────────────────
    var editorToken = {};
    function bind() {
      mpActive = editorToken;
      if (!mpSocketBound && SSA.socket) {
        mpSocketBound = true;
        SSA.socket.on('mine-protection:event', function () { if (mpActive && mpActive.onEvent) mpActive.onEvent(); });
      }
      editorToken.onEvent = function () { if (root.isConnected) setTimeout(poll, 300); };
      poll();
    }
    function refreshMines() {
      return api('/mines').then(function (r) {
        S.minesErr = null; S.mines = (r && r.mines) || []; S.minesAt = (r && r.at) || Date.now();
        if (r && r.serverRunning === false) S.mines = [];
        refreshLive();
      }).catch(function (err) { S.minesErr = why(err); refreshLive(); });
    }
    function poll() {
      if (mpActive !== editorToken) return;
      if (mpLiveTimer) { clearTimeout(mpLiveTimer); mpLiveTimer = null; }
      if (!root.isConnected) { mpActive = null; return; }
      // A tab the panel has switched away from is still in the document, only not drawn.
      if (document.hidden || !root.getClientRects().length) { mpLiveTimer = setTimeout(poll, 8000); return; }
      var asks = [api('/status')];
      if (S.screen === 'mines') asks.push(api('/mines'));
      Promise.all(asks).then(function (rr) {
        if (mpActive !== editorToken) return;
        S.pollErr = null;
        if (rr[0] && rr[0].enabled != null) S.status = rr[0];
        if (rr[1]) { S.minesErr = null; S.mines = rr[1].serverRunning === false ? [] : (rr[1].mines || []); S.minesAt = rr[1].at || Date.now(); }
        refreshLive();
        mpLiveTimer = setTimeout(poll, 8000);
      }).catch(function (err) {
        if (mpActive !== editorToken) return;
        // The screen keeps the last figures it had, and says they are stale: clearing them would turn
        // "I could not ask" into "there is nothing there".
        S.pollErr = why(err);
        refreshLive();
        mpLiveTimer = setTimeout(poll, 8000);
      });
    }

    // ── what refreshes on a poll: the header, the notes and the live half of a screen ─────────
    var live = {};                // per-screen live parts: tables and patched blocks
    function refreshLive() {
      renderStat(); renderNotes(); renderFirstRun();
      Object.keys(live).forEach(function (k) { try { live[k](); } catch (e) { /* a part that cannot draw keeps what it had */ } });
    }

    function badge(cls, label, val) { return h('div', { class: 'mpr-badge ' + (cls || '') }, [h('span', { class: 'mpr-badge-v' }, String(val)), h('span', { class: 'mpr-badge-l' }, label)]); }
    function dotBadge(cls, label) { return h('div', { class: 'mpr-badge ' + cls }, [h('span', { class: 'mpr-dot' }), h('span', { class: 'mpr-badge-l' }, label)]); }
    function renderStat() {
      if (!S.config) return;
      var st = S.status || {};
      var c = st.counts || null;
      var on = S.config.enabled;
      var waiting = ((st.fallen && st.fallen.areas) || []).filter(function (a) { return a.state === 'waiting' || a.state === 'removing'; }).length;
      var nodes = [
        dotBadge(on ? 'ok' : 'off', on ? T('pl.mine-protection.status.active', 'Active') : T('pl.mine-protection.status.disabled', 'Disabled')),
        dotBadge(st.serverRunning ? 'ok' : 'warn', st.serverRunning ? T('pl.mine-protection.status.serverOnline', 'Server online') : T('pl.mine-protection.status.serverOffline', 'Server offline')),
        badge('', T('pl.mine-protection.badge.placed', 'Placed'), c ? c.placed : '–'),
        badge('', T('pl.mine-protection.badge.watched', 'Watched'), (S.config.watchedTypes || []).length),
        badge(c && c.outside ? 'warn' : '', T('pl.mine-protection.badge.outside', 'Outside every flag'), c && c.outside != null ? c.outside : '–'),
        badge(waiting ? 'warn' : '', T('pl.mine-protection.badge.fallen', 'Fallen flags waiting'), waiting),
        badge('', T('pl.mine-protection.badge.removed24', 'Removed today'), st.removed24h != null ? st.removed24h : '–'),
        badge('', T('pl.mine-protection.badge.flaggedPlayers', 'Flagged players'), st.warnedPlayers != null ? st.warnedPlayers : '–'),
      ];
      patch(statBar, nodes);
    }
    var LIVE_WHAT = {
      traps: T('pl.mine-protection.live.traps', 'Whether a mine is really still armed is being read from the last save'),
      squads: T('pl.mine-protection.live.squads', 'Who is in a squad is being read from the last save'),
    };
    function note(cls, title, text) { return h('div', { class: 'mpr-note ' + (cls || '') }, [h('strong', {}, title), document.createTextNode(text)]); }
    function renderNotes() {
      var st = S.status || {};
      var c = S.config || DEF;
      var out = [];
      if (S.pollErr) {
        out.push(note('mpr-note-err', T('pl.mine-protection.live.stalledTitle', 'The live figures below have stopped updating. '),
          T('pl.mine-protection.live.stalledDetail', '{err} Showing the last answer received; settings here are unaffected.', { err: S.pollErr })));
      }
      // The server being off is not a fault. The lists are a photograph of the running world; every
      // rule on this tab is the owner's and the best moment to write it is before the first start.
      if (S.status && st.serverRunning === false) {
        out.push(note('mpr-note-off', T('pl.mine-protection.live.serverOffTitle', 'The server is not running. '),
          T('pl.mine-protection.live.serverOffDetail2', 'Set everything up now. The lists, counters and removals wait for it.')));
      }
      if (st.idle === 'manager_too_old') {
        out.push(note('mpr-note-err', T('pl.mine-protection.live.idleTitle', 'Nothing is being enforced. '), T('pl.mine-protection.live.idleOld', 'This manager is too old for this plugin. Update the manager.')));
      }
      var lv = st.live || {};
      Object.keys(LIVE_WHAT).forEach(function (k) {
        var n = lv[k];
        if (!n || !n.code) return;
        var say = n.code === 'module_off' && n.switch
          ? T('pl.mine-protection.live.turnOn', 'turn on "{switch}" in {where}.', { switch: n.switch, where: bridgeWhere() })
          : n.code === 'no_module' ? T('pl.mine-protection.live.noModule', 'this server runs an older SSA Bridge without this module.')
            : n.code === 'bridge_off' ? T('pl.mine-protection.live.bridgeOff', 'the SSA Bridge did not answer.')
              : (n.text ? n.text + '.' : null);
        if (say) out.push(note('', LIVE_WHAT[k] + ': ', say));
      });
      // What a removal needs, said only while a removal could be asked for.
      var b = st.bridge || null;
      var wantsRemoval = c.fallenFlagCleanup || c.orphanCleanup || (st.jobs || []).some(function (j) { return j.state === 'removing'; });
      if (b && wantsRemoval) {
        if (b.items === false || b.destroy === false) {
          out.push(note('mpr-note-err', T('pl.mine-protection.need.destroyTitle', 'Mines cannot be removed yet. '),
            T('pl.mine-protection.need.destroy', 'Turn on "{switch}" in {where}.', { switch: b.items === false ? T('pl.mine-protection.sw.items', 'Read live inventories') : T('pl.mine-protection.sw.destroy', 'Destroy an item'), where: bridgeWhere() })));
        }
        if (c.fallenFlagWake && b.wake === false) {
          out.push(note('', T('pl.mine-protection.need.wakeTitle', 'Empty areas cannot be loaded. '),
            T('pl.mine-protection.need.wake', 'Mines there wait for a player. Turn on "{switch}" in {where}.', { switch: T('pl.mine-protection.sw.wake', 'Work far from players'), where: bridgeWhere() })));
        }
      }
      patch(liveBar, out);
    }
    function renderFirstRun() {
      var c = S.config;
      if (!c) return;
      var st = S.status || {};
      var fresh = !c.fallenFlagCleanup && !c.orphanCleanup && !((st.removals || []).length) && !((st.recent || []).length);
      if (!fresh) { patch(firstRun, []); return; }
      patch(firstRun, [h('div', { class: 'mpr-note mpr-note-off' }, [
        h('b', {}, T('pl.mine-protection.first.title', 'New here? Two screens to start with.')),
        T('pl.mine-protection.first.on', ' On '), h('b', {}, L.settings),
        T('pl.mine-protection.first.settings', ', pick the watched mines and switch on the clean-ups you want. On '),
        h('b', {}, L.flags),
        T('pl.mine-protection.first.flags', ', see which mines no flag protects any more.'),
      ])]);
    }

    // ── render a screen ────────────────────────────────────────────────────────
    function render() {
      body.innerHTML = '';
      live = {};
      renderStat(); renderNotes(); renderFirstRun();
      if (!S.config) return;
      var fn = { overview: renderOverview, mines: renderMines, flags: renderFlags, activity: renderActivity, settings: renderSettings }[S.screen] || renderOverview;
      fn();
    }
    function linkTo(screen, label) {
      return h('button', { type: 'button', class: 'secondary mpr-link', onclick: function () { go(screen); } }, [label || navLabels()[screen], icon('chev-right')]);
    }
    function onOff(on) { return SSA.cell.tag(on ? T('pl.mine-protection.state.on', 'On') : T('pl.mine-protection.state.off', 'Off'), on ? 'ok' : 'muted'); }

    // ── Overview ──
    function renderOverview() {
      var runs = h('div', { class: 'mpr-rows' });
      var ready = h('div', { class: 'mpr-rows' });
      var types = h('div', { class: 'mpr-types' });
      var latest = h('div', { class: 'mpr-rows' });
      function paintRuns() {
        var c = S.config;
        patch(runs, [
          h('div', { class: 'mpr-row' }, [onOff(c.enabled && c.punishEnabled), h('span', { class: 'mpr-row-t' }, T('pl.mine-protection.ov.punish', 'Punishment')),
            h('span', { class: 'mpr-row-s' }, c.action === 'warn' ? T('pl.mine-protection.ov.punishWarn', 'Warns whoever arms a mine outside their flag.')
              : T('pl.mine-protection.ov.punishTeleport', 'Warns first, then teleports the placer onto their own mine.'))]),
          h('div', { class: 'mpr-row' }, [onOff(c.enabled && c.fallenFlagCleanup), h('span', { class: 'mpr-row-t' }, T('pl.mine-protection.ov.fallen', 'Mines of a fallen flag')),
            h('span', { class: 'mpr-row-s' }, T('pl.mine-protection.ov.fallenSay', 'Removed {n} min after the flag falls, unless a new flag stands there.', { n: c.fallenFlagDelayMinutes }))]),
          h('div', { class: 'mpr-row' }, [onOff(c.enabled && c.orphanCleanup), h('span', { class: 'mpr-row-t' }, T('pl.mine-protection.ov.orphan', 'Mines outside every flag')),
            h('span', { class: 'mpr-row-s' }, T('pl.mine-protection.ov.orphanSay', 'Removed once they have sat outside every flag for {n} min.', { n: c.orphanGraceMinutes }))]),
        ]);
      }
      function paintReady() {
        var b = (S.status && S.status.bridge) || null;
        var row = function (state, label) {
          var tag = state === true ? SSA.cell.tag(T('pl.mine-protection.state.on', 'On'), 'ok')
            : state === false ? SSA.cell.tag(T('pl.mine-protection.state.off', 'Off'), 'bad')
              : SSA.cell.tag(T('pl.mine-protection.state.unknown', 'Not known'), 'muted');
          return h('div', { class: 'mpr-row' }, [tag, h('span', { class: 'mpr-row-t' }, label)]);
        };
        patch(ready, [
          row(b ? b.items : null, T('pl.mine-protection.sw.items', 'Read live inventories')),
          row(b ? b.destroy : null, T('pl.mine-protection.sw.destroy', 'Destroy an item')),
          row(b ? b.wake : null, T('pl.mine-protection.sw.wake', 'Work far from players')),
          h('small', { class: 'mpr-hint' }, b ? T('pl.mine-protection.ov.readyWhere', 'These are switches in {where}.', { where: bridgeWhere() })
            : T('pl.mine-protection.ov.readyUnknown', 'The SSA Bridge did not say. It needs a running server.')),
        ]);
      }
      function paintTypes() {
        var by = (S.status && S.status.counts && S.status.counts.byType) || null;
        if (!by) { patch(types, [h('p', { class: 'mpr-empty' }, T('pl.mine-protection.ov.typesNone', 'Counts appear once the server runs.'))]); return; }
        var rows = S.catalog.filter(function (t) { return by[t.type] && by[t.type].placed; }).map(function (t) {
          var n = by[t.type];
          return h('div', { class: 'mpr-type' }, [SSA.cell.item(t.code, t.name || t.type),
            h('span', { class: 'mpr-type-n' }, T('pl.mine-protection.ov.typeCounts', '{placed} placed · {armed} armed · {outside} outside every flag', { placed: n.placed, armed: n.armed || 0, outside: n.outside == null ? '–' : n.outside }))]);
        });
        patch(types, rows.length ? rows : [h('p', { class: 'mpr-empty' }, T('pl.mine-protection.ov.typesEmpty', 'No mine or trap is placed in the last save.'))]);
      }
      function paintLatest() {
        var st = S.status || {};
        var items = [];
        (st.removals || []).slice(0, 5).forEach(function (r) { items.push({ at: r.at, node: h('span', {}, T('pl.mine-protection.ov.removedOne', '{mine} removed: {why}', { mine: r.name || r.type || '', why: kindWord(r.kind) })) }); });
        (st.recent || []).slice(0, 5).forEach(function (r) { items.push({ at: r.at, node: h('span', {}, recentWord(r)) }); });
        items.sort(function (a, b) { return b.at - a.at; });
        var rows = items.slice(0, 6).map(function (x) { return h('div', { class: 'mpr-row' }, [h('span', { class: 'mpr-dim' }, ago(x.at)), x.node]); });
        patch(latest, rows.length ? rows : [h('p', { class: 'mpr-empty' }, T('pl.mine-protection.recent.empty', 'Nothing yet — actions will appear here live.'))]);
      }
      body.appendChild(card(T('pl.mine-protection.ov.runsTitle', 'What runs on this server'), null, [runs, linkTo('settings', T('pl.mine-protection.ov.change', 'Change in Settings'))], 'mpr-ov-card'));
      body.appendChild(card(T('pl.mine-protection.ov.readyTitle', 'What removing a mine needs'), T('pl.mine-protection.ov.readySub', 'A mine is removed by the SSA Bridge, and only while the game has its area loaded.'), [ready], 'mpr-ov-card'));
      body.appendChild(card(T('pl.mine-protection.ov.typesTitle', 'Placed mines and traps'), null, [types, linkTo('mines')], 'mpr-ov-card'));
      body.appendChild(card(T('pl.mine-protection.ov.latestTitle', 'Latest'), null, [latest, linkTo('activity')], 'mpr-ov-card'));
      live.overview = function () { paintRuns(); paintReady(); paintTypes(); paintLatest(); };
      live.overview();
    }
    function kindWord(kind) {
      return kind === 'orphan' ? T('pl.mine-protection.kind.orphan', 'outside every flag')
        : kind === 'manual' ? T('pl.mine-protection.kind.manual', 'asked for by an admin')
          : T('pl.mine-protection.kind.fallen', 'its flag fell');
    }
    function recentWord(r) {
      if (r.action === 'cleared') return T('pl.mine-protection.recent.clearedLine', 'Mines of a fallen flag removed: {n}', { n: r.mine });
      if (r.action === 'orphans') return T('pl.mine-protection.recent.orphansLine', 'Mines outside every flag removed: {n}', { n: r.mine });
      if (r.action === 'removed') return T('pl.mine-protection.recent.removedLine', 'Mines removed by an admin: {n}', { n: r.mine });
      var who = r.player || r.steamId || '';
      return r.action === 'warn' ? T('pl.mine-protection.recent.warnedLine', '{player} warned', { player: who })
        : T('pl.mine-protection.recent.teleportedLine', '{player} teleported onto their mine', { player: who });
    }

    // ── shared cells ──
    function mineCode(r) {
      if (r && r.code) return r.code;
      var t = r && r.type;
      for (var i = 0; i < S.catalog.length; i++) if (S.catalog[i].type === t && S.catalog[i].code) return S.catalog[i].code;
      return t ? t + '_ES' : null;
    }
    // Both `armed` and `inArea` are THREE-valued. Null is not false, and showing it as one is how a
    // table came to describe a mine as an offence the plugin was declining to act on.
    function mineStatus(m) {
      if (!m.watched) return SSA.cell.tag(T('pl.mine-protection.mine.notWatched', 'Not watched'), 'muted');
      return m.armed == null ? SSA.cell.tag(T('pl.mine-protection.mine.armedUnknown', 'Armed state unknown'), 'muted')
        : !m.armed ? SSA.cell.tag(T('pl.mine-protection.mine.notArmed', 'Not armed'), 'muted')
          : m.exempt ? SSA.cell.tag(T('pl.mine-protection.mine.exempt', 'Exempt'), 'muted')
            : m.inArea === true ? SSA.cell.tag(T('pl.mine-protection.mine.insideFlag', 'Inside flag'), 'ok')
              : m.inArea == null ? SSA.cell.tag(T('pl.mine-protection.mine.flagUnknown', 'Flag unknown'), 'muted')
                : !m.handled ? SSA.cell.tag(T('pl.mine-protection.mine.pending', 'Pending'), 'warn')
                  : SSA.cell.tag(T('pl.mine-protection.mine.enforced', 'Enforced'), 'bad');
    }
    function mineStatusRank(m) { return !m.watched ? 7 : m.armed == null ? 6 : !m.armed ? 5 : m.exempt ? 4 : m.inArea === true ? 3 : m.inArea == null ? 2 : !m.handled ? 0 : 1; }
    function flagCell(v) {
      return v === true ? SSA.cell.tag(T('pl.mine-protection.flag.inside', 'Inside a flag'), 'ok')
        : v === false ? SSA.cell.tag(T('pl.mine-protection.flag.outside', 'Outside every flag'), 'warn')
          : SSA.cell.tag(T('pl.mine-protection.flag.unknown', 'Not known'), 'muted');
    }
    function armedCell(v) {
      return v === true ? SSA.cell.tag(T('pl.mine-protection.armed.yes', 'Armed'), 'bad')
        : v === false ? SSA.cell.tag(T('pl.mine-protection.mine.notArmed', 'Not armed'), 'muted')
          : SSA.cell.tag(T('pl.mine-protection.flag.unknown', 'Not known'), 'muted');
    }
    function placerCell(r) { return (r.placerName || r.placerSteamId) ? SSA.cell.player(r.placerName, r.placerSteamId) : h('span', { class: 'mpr-dim' }, T('pl.mine-protection.placer.unknown', 'Not recorded')); }
    function workCell(r) {
      if (r.work) return SSA.cell.tag(r.work === 'sent' ? T('pl.mine-protection.work.sent', 'Being removed') : T('pl.mine-protection.work.queued', 'Queued for removal'), 'warn');
      if (r.kept) return SSA.cell.tag(T('pl.mine-protection.work.kept', 'Kept'), 'muted');
      if (r.orphanSince) return document.createTextNode(T('pl.mine-protection.work.outsideSince', 'Outside a flag since {when}', { when: ago(r.orphanSince) }));
      return document.createTextNode('');
    }

    // ── Mines ──
    function renderMines() {
      var bar = h('div', { class: 'mpr-filters' });
      var countLine = h('div', { class: 'mpr-count' });
      var tbl = null;
      function shown() { return (S.mines || []).filter(function (r) { return mineMatches(r, S.filter, Date.now()); }); }
      // What "matching" means is the table's rows, its own search box included, read at the press.
      function matchingNow() {
        var q = tbl && tbl.search ? String(tbl.search.value || '').trim().toLowerCase() : '';
        var f = Object.assign({}, S.filter, { q: q, at: Date.now() });
        return { f: f, rows: (S.mines || []).filter(function (r) { return mineMatches(r, f, f.at); }) };
      }
      function pickedIds() { return Object.keys(S.picked).filter(function (k) { return S.picked[k]; }); }
      function placers() {
        var by = {};
        (S.mines || []).forEach(function (r) { if (!r.placerSteamId) return; var k = r.placerSteamId; by[k] = by[k] || { sid: k, name: r.placerName || k, n: 0 }; by[k].n++; });
        return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.n - a.n; });
      }
      function sectors() { var s = {}; (S.mines || []).forEach(function (r) { if (r.sector) s[r.sector] = 1; }); return Object.keys(s).sort(); }
      function paintBar() {
        var f = S.filter;
        var set = function (k) { return function (v) { S.filter[k] = k === 'age' ? Number(v) : v; S.picked = {}; paintBar(); paintCount(); if (tbl) tbl.refresh(); }; };
        var typeOpts = [['', T('pl.mine-protection.f.typeAll', 'All types')], ['*watched', T('pl.mine-protection.f.typeWatched', 'Watched types')]]
          .concat(S.catalog.map(function (t) { return [t.type, t.name || t.type]; }));
        var placerOpts = [['', T('pl.mine-protection.f.placerAny', 'Anyone')], ['*unknown', T('pl.mine-protection.f.placerUnknown', 'Placer not recorded')]]
          .concat(placers().map(function (p) { return [p.sid, p.name + ' (' + p.n + ')']; }));
        if (f.placer && f.placer !== '*unknown' && !placerOpts.some(function (o) { return o[0] === f.placer; })) placerOpts.push([f.placer, f.placer]);
        var sectorOpts = [['', T('pl.mine-protection.f.sectorAll', 'All sectors')]].concat(sectors().map(function (s) { return [s, s]; }));
        if (f.sector && !sectorOpts.some(function (o) { return o[0] === f.sector; })) sectorOpts.push([f.sector, f.sector]);
        bar.innerHTML = '';
        [
          field(T('pl.mine-protection.f.type', 'Type'), select(typeOpts, f.type, set('type'))),
          field(T('pl.mine-protection.f.placer', 'Placer'), select(placerOpts, f.placer, set('placer'))),
          field(T('pl.mine-protection.f.flag', 'Flag'), select([['', T('pl.mine-protection.f.flagAny', 'Inside or outside')], ['inside', T('pl.mine-protection.flag.inside', 'Inside a flag')],
            ['outside', T('pl.mine-protection.flag.outside', 'Outside every flag')], ['unknown', T('pl.mine-protection.f.flagUnknown', 'Flag not known')]], f.flag, set('flag'))),
          field(T('pl.mine-protection.f.armed', 'Armed'), select([['', T('pl.mine-protection.f.armedAny', 'Armed or not')], ['armed', T('pl.mine-protection.armed.yes', 'Armed')],
            ['disarmed', T('pl.mine-protection.mine.notArmed', 'Not armed')], ['unknown', T('pl.mine-protection.f.armedUnknown', 'Armed state not known')]], f.armed, set('armed'))),
          field(T('pl.mine-protection.f.sector', 'Sector'), select(sectorOpts, f.sector, set('sector'))),
          field(T('pl.mine-protection.f.age', 'Last handled'), select([['0', T('pl.mine-protection.f.ageAny', 'Any time')], ['1', T('pl.mine-protection.f.age1', 'Over a day ago')],
            ['7', T('pl.mine-protection.f.age7', 'Over a week ago')], ['30', T('pl.mine-protection.f.age30', 'Over 30 days ago')]], String(f.age || 0), set('age')),
            T('pl.mine-protection.f.ageHint', 'When the game last saw anybody handle it.')),
        ].forEach(function (x) { bar.appendChild(x); });
      }
      function paintCount() {
        var all = (S.mines || []).length;
        var m = matchingNow().rows.length;
        var ticks = pickedIds().length;
        var kids = [h('span', { class: 'mpr-count-n' }, T('pl.mine-protection.mines.count', '{n} of {total} mines match.', { n: m, total: all }))];
        kids.push(h('button', { type: 'button', class: 'secondary', disabled: m ? null : true, onclick: function () {
          var rows = matchingNow().rows;
          var every = rows.length && rows.every(function (r) { return S.picked[String(r.id)]; });
          rows.forEach(function (r) { S.picked[String(r.id)] = !every; });
          paintCount(); if (tbl) tbl.refresh();
        } }, [icon('check'), T('pl.mine-protection.mines.tickAll', 'Tick or untick all {n}', { n: m })]));
        if (ticks) {
          kids.push(h('button', { type: 'button', class: 'mpr-danger', onclick: removeTicked }, [icon('close'), T('pl.mine-protection.mines.removeTicked', 'Remove {n} ticked', { n: ticks })]));
        }
        kids.push(h('button', { type: 'button', class: 'mpr-danger', disabled: m ? null : true, onclick: removeMatching }, [icon('close'), T('pl.mine-protection.mines.removeAll', 'Remove all {n} matching', { n: m })]));
        patch(countLine, [h('div', { class: 'mpr-count-in' }, kids)]);
      }
      function afterQueue(r) {
        S.picked = {};
        toast(T('pl.mine-protection.toast.queued', 'Queued for removal: {n}. Progress is on {screen}.', { n: (r && r.queued) || 0, screen: navLabels().activity }));
        refreshMines(); poll();
      }
      function queueFailed(err) { toast(T('pl.mine-protection.toast.notQueued', 'Nothing was queued: {err}', { err: why(err) }), 'error'); refreshMines(); }
      function removeTicked() {
        var ids = pickedIds();
        if (!ids.length) return;
        SSA.confirm(T('pl.mine-protection.confirm.ticked', 'Remove the ticked mines ({n}) from the world? This cannot be undone.', { n: ids.length }),
          { okLabel: T('pl.mine-protection.confirm.ok', 'Remove them') }).then(function (yes) {
          if (!yes) return;
          api('/remove', { method: 'POST', body: { ids: ids } }).then(afterQueue).catch(queueFailed);
        });
      }
      function removeMatching() {
        var m = matchingNow();
        if (!m.rows.length) return;
        SSA.confirm(T('pl.mine-protection.confirm.matching', 'Remove every matching mine ({n})? This cannot be undone.', { n: m.rows.length }),
          { okLabel: T('pl.mine-protection.confirm.ok', 'Remove them') }).then(function (yes) {
          if (!yes) return;
          api('/remove', { method: 'POST', body: { filter: m.f, expect: m.rows.length } }).then(afterQueue).catch(queueFailed);
        });
      }
      tbl = SSA.table({
        rows: shown,
        searchPlaceholder: T('pl.mine-protection.mines.search', 'Search mines, players…'),
        search: mineSearchText,
        empty: function () {
          if (S.minesErr) return T('pl.mine-protection.mines.failed', 'The list could not be read: {err}', { err: S.minesErr });
          if (S.mines === null) return T('pl.mine-protection.loading', 'Loading…');
          return (S.status && S.status.serverRunning === false)
            ? T('pl.mine-protection.mines.emptyServerOff', 'This list fills in once the server starts. Everything else can be set now.')
            : T('pl.mine-protection.mines.emptyAll', 'No mine or trap matches in the server\'s last save.');
        },
        sort: { key: 'status', dir: 'asc' }, pageSize: 25, onRefresh: function () { refreshMines(); },
        columns: [
          { key: 'pick', label: '', render: function (r) {
            var id = String(r.id);
            var b = h('input', { type: 'checkbox', class: 'mpr-tick', 'aria-label': T('pl.mine-protection.mines.tickOne', 'Tick this mine for removal'), onchange: function () { S.picked[id] = b.checked; paintCount(); } });
            b.checked = !!S.picked[id];
            return b;
          } },
          { key: 'type', label: T('pl.mine-protection.col.type', 'Type'), sort: true, sortVal: function (r) { return (r.name || r.type || '').toLowerCase(); }, render: function (r) { return SSA.cell.item(mineCode(r), r.name || r.type); } },
          { key: 'placer', label: T('pl.mine-protection.col.placer', 'Placer'), sort: true, sortVal: function (r) { return (r.placerName || r.placerSteamId || '').toLowerCase(); }, render: placerCell },
          { key: 'loc', label: T('pl.mine-protection.col.location', 'Location'), render: function (r) { return SSA.cell.location(r.x, r.y, r.z); } },
          { key: 'sector', label: T('pl.mine-protection.f.sector', 'Sector'), sort: true, sortVal: function (r) { return r.sector || ''; }, render: function (r) { return document.createTextNode(r.sector || '–'); } },
          { key: 'flag', label: T('pl.mine-protection.col.flag', 'Flag'), sort: true, sortVal: function (r) { return r.insideFlag === false ? 0 : r.insideFlag == null ? 1 : 2; }, render: function (r) { return flagCell(r.insideFlag); } },
          { key: 'armed', label: T('pl.mine-protection.f.armed', 'Armed'), render: function (r) { return armedCell(r.armed); } },
          { key: 'status', label: T('pl.mine-protection.col.status', 'Status'), sort: true, sortVal: mineStatusRank, render: mineStatus },
          { key: 'touched', label: T('pl.mine-protection.f.age', 'Last handled'), sort: true, sortVal: function (r) { return r.lastTouched || 0; }, tdClass: 'dim', render: function (r) { return document.createTextNode(r.lastTouched ? ago(r.lastTouched) : '–'); } },
          { key: 'work', label: T('pl.mine-protection.col.removal', 'Removal'), render: workCell },
          { key: 'offences', label: T('pl.mine-protection.col.offences', 'Offences'), sort: true, sortVal: function (r) { return r.offences || 0; }, tdClass: 'mono', render: function (r) {
            var n = r.offences || 0;
            var txt = document.createTextNode(String(n));
            if (!n || !r.placerSteamId) return txt;
            return h('span', { class: 'mpr-off' }, [txt, h('button', {
              class: 'secondary mpr-off-x', type: 'button',
              title: T('pl.mine-protection.offences.forgiveTitle', 'Forget this player’s offences — they get their warnings back'),
              onclick: function () {
                api('/reset-offenses', { method: 'POST', body: { steamId: r.placerSteamId } })
                  .then(function () { toast(T('pl.mine-protection.toast.offencesCleared', 'Offences cleared for {player}', { player: r.placerName || r.placerSteamId })); refreshMines(); poll(); })
                  .catch(function (err) { toast(T('pl.mine-protection.toast.notCleared', 'Nothing was cleared — {err}', { err: why(err) }), 'error'); });
              },
            }, T('pl.mine-protection.btn.forgive', 'Forgive'))]);
          } },
        ],
      });
      paintBar(); paintCount();
      body.appendChild(card(navLabels().mines, T('pl.mine-protection.mines.sub', 'Every mine and trap in the server\'s last save. Filter, tick, and remove what you choose.'),
        [bar, countLine, tbl.el], 'mpr-mines'));
      // Typing in the table's search box changes what "matching" is, so the count follows it.
      if (tbl.search) tbl.search.addEventListener('input', paintCount);
      // The filter bar is drawn again only when its CHOICES change (a new placer, a new sector), never
      // on every poll: a dropdown somebody has open would close under them.
      var lastSig = JSON.stringify([placers().map(function (p) { return p.sid + p.n; }), sectors()]);
      live.mines = function () {
        var sig = JSON.stringify([placers().map(function (p) { return p.sid + p.n; }), sectors()]);
        if (sig !== lastSig) { lastSig = sig; paintBar(); }
        paintCount(); tbl.refresh();
      };
    }

    // ── Flags ──
    var FF_STATE = {
      waiting: function () { return [T('pl.mine-protection.ff.state.waiting', 'Waiting'), 'warn']; },
      removing: function () { return [T('pl.mine-protection.ff.state.removing', 'Removing'), 'warn']; },
      cleared: function () { return [T('pl.mine-protection.ff.state.cleared', 'Cleared'), 'ok']; },
      partial: function () { return [T('pl.mine-protection.ff.state.partial', 'Partly cleared'), 'bad']; },
      kept: function () { return [T('pl.mine-protection.ff.state.kept', 'Kept'), 'muted']; },
      gaveup: function () { return [T('pl.mine-protection.ff.state.gaveup', 'Gave up'), 'bad']; },
      off: function () { return [T('pl.mine-protection.ff.state.off', 'Switched off'), 'muted']; },
      stopped: function () { return [T('pl.mine-protection.ff.state.stopped', 'Stopped'), 'muted']; },
    };
    function stateCell(r) {
      var m = FF_STATE[r.state] ? FF_STATE[r.state]() : [String(r.state || ''), 'muted'];
      // The reason a pass could not act is the backend's own sentence, shown under the state.
      return h('span', {}, [SSA.cell.tag(m[0], m[1]), r.note ? h('small', { class: 'mpr-hint' }, ' ' + r.note) : null]);
    }
    function whenCell(r) {
      if (r.state === 'waiting') return document.createTextNode(T('pl.mine-protection.ff.inMinutes', 'in {n} min', { n: Math.max(0, Math.ceil(((r.deadline || 0) - Date.now()) / 60000)) }));
      return document.createTextNode(ago(r.endedAt || r.startedAt || r.fellAt || Date.now()));
    }
    function post(req, okText) {
      return req.then(function (res) {
        if (res && res.ok) { if (okText) toast(typeof okText === 'function' ? okText(res) : okText); poll(); return res; }
        toast(T('pl.mine-protection.toast.notKept', 'Nothing changed — {err}', { err: (res && (res.reason || res.error)) || T('pl.mine-protection.save.noReason', 'the manager did not say why') }), 'error');
        return null;
      }).catch(function (err) { toast(T('pl.mine-protection.toast.notKept', 'Nothing changed — {err}', { err: why(err) }), 'error'); return null; });
    }
    function queuedText(res) { return T('pl.mine-protection.toast.queued', 'Queued for removal: {n}. Progress is on {screen}.', { n: (res && res.queued) || 0, screen: navLabels().activity }); }
    function renderFlags() {
      var ffLine = h('div', { class: 'mpr-sumline' });
      var orLine = h('div', { class: 'mpr-sumline' });
      var ffTbl = SSA.table({
        rows: function () { return (S.status && S.status.fallen && S.status.fallen.areas) || []; },
        empty: function () { return S.pollErr ? T('pl.mine-protection.live.stalledTitle', 'The live figures below have stopped updating. ') + S.pollErr : T('pl.mine-protection.ff.empty', 'No flag has fallen since this was switched on.'); },
        pageSize: 10,
        columns: [
          { key: 'flag', label: T('pl.mine-protection.col.flag', 'Flag'), render: function (r) { return document.createTextNode((r.name || ('#' + (r.flagId != null ? r.flagId : r.baseId))) + (r.owner ? ' · ' + r.owner : '')); } },
          { key: 'loc', label: T('pl.mine-protection.col.location', 'Location'), render: function (r) { return SSA.cell.location(r.x, r.y, r.z); } },
          { key: 'when', label: T('pl.mine-protection.col.when', 'When'), sort: true, sortVal: function (r) { return r.deadline || 0; }, tdClass: 'dim', render: whenCell },
          { key: 'state', label: T('pl.mine-protection.col.status', 'Status'), render: stateCell },
          { key: 'mines', label: T('pl.mine-protection.col.removed', 'Removed'), tdClass: 'mono', render: function (r) { return document.createTextNode((r.removed || 0) + ' / ' + (r.total || 0)); } },
          { key: 'act', label: '', render: function (r) {
            var acts = [];
            if (r.state === 'waiting' || r.state === 'removing') acts.push(h('button', { type: 'button', class: 'secondary', onclick: function () { post(api('/fallen-keep', { method: 'POST', body: { id: r.id } }), T('pl.mine-protection.toast.kept', 'The mines stay')); } }, T('pl.mine-protection.btn.keep', 'Keep mines')));
            if (r.state !== 'removing' && r.state !== 'cleared') {
              acts.push(h('button', { type: 'button', class: 'mpr-danger', onclick: function () {
                SSA.confirm(T('pl.mine-protection.confirm.fallenNow', 'Remove the mines in this flag\'s area now? This cannot be undone.'), { okLabel: T('pl.mine-protection.confirm.ok', 'Remove them') })
                  .then(function (yes) { if (yes) post(api('/fallen-now', { method: 'POST', body: { id: r.id } }), function (res) { return res.now ? T('pl.mine-protection.toast.startedNow', 'Removal starts now.') : queuedText(res); }); });
              } }, T('pl.mine-protection.btn.removeNow', 'Remove now')));
            }
            return h('span', { class: 'mpr-acts' }, acts);
          } },
        ],
      });
      var orTbl = SSA.table({
        rows: function () { return ((S.status && S.status.orphans && S.status.orphans.groups) || []).filter(function (g) { return g.n > 0; }); },
        empty: function () {
          var o = S.status && S.status.orphans;
          if (S.status && S.status.serverRunning === false) return T('pl.mine-protection.mines.emptyServerOff', 'This list fills in once the server starts. Everything else can be set now.');
          if (o && o.known === false) return T('pl.mine-protection.or.unknown', 'The flags could not be read, so no mine counts as outside one.');
          return T('pl.mine-protection.or.empty', 'Every mine of the chosen types sits inside a flag.');
        },
        pageSize: 10,
        columns: [
          { key: 'loc', label: T('pl.mine-protection.col.location', 'Location'), render: function (g) { return SSA.cell.location(g.x, g.y, g.z); } },
          { key: 'n', label: T('pl.mine-protection.col.mines', 'Mines'), sort: true, sortVal: function (g) { return g.n; }, tdClass: 'mono', render: function (g) {
            return document.createTextNode(T('pl.mine-protection.or.count', '{n} ({armed} armed)', { n: g.n, armed: g.armed || 0 }));
          } },
          { key: 'types', label: T('pl.mine-protection.col.type', 'Type'), render: function (g) {
            return h('span', { class: 'mpr-chips' }, Object.keys(g.types || {}).map(function (t) {
              var cat = S.catalog.filter(function (x) { return x.type === t; })[0];
              return h('span', { class: 'mpr-chip' }, (cat ? cat.name : t) + ' ×' + g.types[t]);
            }));
          } },
          { key: 'placer', label: T('pl.mine-protection.col.placer', 'Placer'), render: function (g) {
            var p = (g.placers || [])[0];
            if (!p) return document.createTextNode('');
            return (p.name || p.steamId) ? SSA.cell.player(p.name, p.steamId) : h('span', { class: 'mpr-dim' }, T('pl.mine-protection.placer.unknown', 'Not recorded'));
          } },
          { key: 'wait', label: T('pl.mine-protection.col.status', 'Status'), render: orphanState },
          { key: 'act', label: '', render: function (g) {
            return h('span', { class: 'mpr-acts' }, [
              h('button', { type: 'button', class: 'secondary', onclick: function () {
                SSA.confirm(T('pl.mine-protection.confirm.keep', 'Keep the mines here ({n})? The clean-up then never removes them.', { n: g.n }), { okLabel: T('pl.mine-protection.btn.keep', 'Keep mines') })
                  .then(function (yes) { if (yes) post(api('/orphans-keep', { method: 'POST', body: { key: g.key } }), function (res) { return T('pl.mine-protection.toast.keptN', 'Mines kept: {n}.', { n: res.kept || 0 }); }); });
              } }, T('pl.mine-protection.btn.keep', 'Keep mines')),
              h('button', { type: 'button', class: 'mpr-danger', disabled: g.removing >= g.n ? true : null, onclick: function () {
                SSA.confirm(T('pl.mine-protection.confirm.orphanNow', 'Remove the mines here ({n}) now? This cannot be undone.', { n: g.n }), { okLabel: T('pl.mine-protection.confirm.ok', 'Remove them') })
                  .then(function (yes) { if (yes) post(api('/orphans-now', { method: 'POST', body: { key: g.key } }), queuedText); });
              } }, T('pl.mine-protection.btn.removeNow', 'Remove now')),
            ]);
          } },
        ],
      });
      function paintLines() {
        var c = S.config;
        patch(ffLine, [c.enabled && c.fallenFlagCleanup
          ? h('p', { class: 'mpr-card-sub' }, T('pl.mine-protection.ff.lineOn', 'On. A flag that falls starts a {n} min timer.', { n: c.fallenFlagDelayMinutes }))
          : h('p', { class: 'mpr-card-sub' }, [T('pl.mine-protection.ff.lineOff', 'Off. Switch it on in Settings to remove these mines.'), ' ', linkTo('settings')])]);
        var o = S.status && S.status.orphans;
        var n = ((o && o.groups) || []).reduce(function (s, g) { return s + (g.n || 0); }, 0);
        var kept = ((o && o.groups) || []).reduce(function (s, g) { return s + (g.kept || 0); }, 0);
        var kids = [c.enabled && c.orphanCleanup
          ? T('pl.mine-protection.or.lineOn', 'On. A mine outside every flag goes after {n} min.', { n: c.orphanGraceMinutes })
          : T('pl.mine-protection.or.lineOff', 'Off. Once it is on, the mines below ({n}) go after {m} min.', { n: n, m: c.orphanGraceMinutes })];
        if (kept) kids.push(' ' + T('pl.mine-protection.or.keptLine', 'Kept mines left alone: {n}.', { n: kept }));
        if (!(c.enabled && c.orphanCleanup)) kids.push(' ', linkTo('settings'));
        patch(orLine, [h('p', { class: 'mpr-card-sub' }, kids)]);
      }
      body.appendChild(card(T('pl.mine-protection.card.fallen.title', 'Mines of a fallen flag'), T('pl.mine-protection.card.fallen.sub', 'When a flag falls and no new one is built in time, the mines left in its area are removed.'), [ffLine, ffTbl.el]));
      body.appendChild(card(T('pl.mine-protection.card.orphan.title', 'Mines outside every flag'), T('pl.mine-protection.card.orphan.sub', 'Mines no standing flag covers, such as those of a flag that fell before this plugin first looked.'), [orLine, orTbl.el]));
      live.flags = function () { paintLines(); ffTbl.refresh(); orTbl.refresh(); };
      live.flags();
    }
    function orphanState(g) {
      var w = g.waits || {};
      var c = S.config;
      var parts = [];
      if (g.removing) parts.push(SSA.cell.tag(T('pl.mine-protection.work.queued', 'Queued for removal'), 'warn'));
      if (!(c.enabled && c.orphanCleanup)) parts.push(SSA.cell.tag(T('pl.mine-protection.or.wouldGo', 'Would be removed'), 'muted'));
      else {
        if (w.grace && g.dueAt) parts.push(document.createTextNode(T('pl.mine-protection.or.dueIn', 'goes in {n} min', { n: Math.max(0, Math.ceil((g.dueAt - Date.now()) / 60000)) })));
        if (w.online) parts.push(SSA.cell.tag(T('pl.mine-protection.or.online', 'Placer online'), 'muted'));
        if (w.exempt) parts.push(SSA.cell.tag(T('pl.mine-protection.mine.exempt', 'Exempt'), 'muted'));
        if (w.due) parts.push(SSA.cell.tag(T('pl.mine-protection.or.due', 'Due'), 'warn'));
      }
      return h('span', { class: 'mpr-acts' }, parts);
    }

    // ── Activity ──
    function renderActivity() {
      var rmTbl = SSA.table({
        rows: function () { return S.allRemovals || (S.status && S.status.removals) || []; },
        searchPlaceholder: T('pl.mine-protection.act.search', 'Search removed mines…'),
        search: function (r) { return [r.id, r.name, r.type, r.label].join(' '); },
        empty: function () { return S.pollErr ? S.pollErr : T('pl.mine-protection.act.empty', 'No mine has been removed yet.'); },
        sort: { key: 'at', dir: 'desc' }, pageSize: 15,
        toolbar: [
          h('button', { type: 'button', class: 'secondary', onclick: function () { api('/removals').then(function (r) { S.allRemovals = (r && r.removals) || []; rmTbl.refresh(); }).catch(function (err) { toast(why(err), 'error'); }); } }, T('pl.mine-protection.act.showAll', 'Show all')),
          h('button', { type: 'button', class: 'secondary', onclick: function () {
            SSA.confirm(T('pl.mine-protection.act.clearConfirm', 'Clear the list of removed mines? The mines stay removed.')).then(function (yes) {
              if (!yes) return;
              api('/removals-clear', { method: 'POST' }).then(function () { S.allRemovals = []; if (S.status) S.status.removals = []; rmTbl.refresh(); poll(); })
                .catch(function (err) { toast(T('pl.mine-protection.toast.historyNotCleared', 'The history was NOT cleared — {err}', { err: why(err) }), 'error'); });
            });
          } }, T('pl.mine-protection.btn.clearHistory', 'Clear history')),
        ],
        columns: [
          { key: 'at', label: T('pl.mine-protection.col.when', 'When'), sort: true, sortVal: function (r) { return r.at || 0; }, tdClass: 'dim', render: function (r) { return document.createTextNode(ago(r.at)); } },
          { key: 'mine', label: T('pl.mine-protection.col.mine', 'Mine'), render: function (r) { return SSA.cell.item(r.code || mineCode(r), r.name || r.type || T('pl.mine-protection.recent.mineFallback', 'mine')); } },
          { key: 'loc', label: T('pl.mine-protection.col.location', 'Location'), render: function (r) { return SSA.cell.location(r.x, r.y, r.z); } },
          { key: 'why', label: T('pl.mine-protection.col.why', 'Why'), render: function (r) { return document.createTextNode(kindWord(r.kind)); } },
          { key: 'by', label: T('pl.mine-protection.col.confirmed', 'Confirmed by'), render: function (r) { return document.createTextNode(r.by === 'save' ? T('pl.mine-protection.act.bySave', 'the save') : T('pl.mine-protection.act.byGame', 'the game')); } },
        ],
      });
      var jobsTbl = SSA.table({
        rows: function () {
          var st = S.status || {};
          var list = (st.jobs || []).slice();
          ((st.fallen && st.fallen.areas) || []).forEach(function (a) { if (a.state === 'removing') list.push(a); });
          return list;
        },
        empty: T('pl.mine-protection.act.jobsEmpty', 'Nothing is being removed now.'),
        sort: { key: 'when', dir: 'desc' }, pageSize: 10,
        columns: [
          { key: 'when', label: T('pl.mine-protection.col.when', 'When'), sort: true, sortVal: function (r) { return r.startedAt || r.fellAt || 0; }, tdClass: 'dim', render: function (r) { return document.createTextNode(ago(r.endedAt || r.startedAt || r.fellAt || Date.now())); } },
          { key: 'what', label: T('pl.mine-protection.col.why', 'Why'), render: function (r) { return document.createTextNode(kindWord(r.kind)); } },
          { key: 'loc', label: T('pl.mine-protection.col.location', 'Location'), render: function (r) { return SSA.cell.location(r.x, r.y, r.z); } },
          { key: 'state', label: T('pl.mine-protection.col.status', 'Status'), render: stateCell },
          { key: 'n', label: T('pl.mine-protection.col.removed', 'Removed'), tdClass: 'mono', render: function (r) { return document.createTextNode((r.removed || 0) + ' / ' + (r.total || 0)); } },
          { key: 'act', label: '', render: function (r) {
            if (r.kind === 'fallen' || (r.state !== 'removing' && r.state !== 'waiting')) return document.createTextNode('');
            return h('button', { type: 'button', class: 'secondary', onclick: function () { post(api('/job-stop', { method: 'POST', body: { id: r.id } }), T('pl.mine-protection.toast.stopped', 'Stopped. The mines not yet removed stay.')); } }, T('pl.mine-protection.btn.stop', 'Stop'));
          } },
        ],
      });
      var reset = h('button', { type: 'button', class: 'secondary', onclick: function () { api('/reset-offenses', { method: 'POST' }).then(function () { toast(T('pl.mine-protection.toast.warningsReset', 'Warnings reset')); poll(); }).catch(function (err) { toast(T('pl.mine-protection.toast.warningsNotReset', 'Warnings were NOT reset — {err}', { err: why(err) }), 'error'); }); } }, T('pl.mine-protection.btn.resetWarnings', 'Reset warnings'));
      var clear = h('button', { type: 'button', class: 'secondary', onclick: function () { api('/clear-history', { method: 'POST' }).then(function () { if (S.status) S.status.recent = []; recTbl.refresh(); }).catch(function (err) { toast(T('pl.mine-protection.toast.historyNotCleared', 'The history was NOT cleared — {err}', { err: why(err) }), 'error'); }); } }, T('pl.mine-protection.btn.clearHistory', 'Clear history'));
      var recTbl = SSA.table({
        rows: function () { return (S.status && S.status.recent) || []; },
        searchPlaceholder: T('pl.mine-protection.recent.search', 'Search recent actions…'),
        search: function (r) { return [r.player, r.steamId, r.mine, r.type, r.action].join(' '); },
        empty: T('pl.mine-protection.recent.empty', 'Nothing yet — actions will appear here live.'),
        sort: { key: 'at', dir: 'desc' }, pageSize: 12, toolbar: [reset, clear],
        columns: [
          { key: 'at', label: T('pl.mine-protection.col.when', 'When'), sort: true, sortVal: function (r) { return r.at || 0; }, tdClass: 'dim', render: function (r) { return document.createTextNode(ago(r.at)); } },
          { key: 'action', label: T('pl.mine-protection.col.action', 'Action'), sort: true, sortVal: function (r) { return r.action; }, render: function (r) {
            if (r.action === 'cleared' || r.action === 'orphans' || r.action === 'removed') return SSA.cell.tag(T('pl.mine-protection.recent.cleared', 'Mines removed'), 'ok');
            var w = r.action === 'warn';
            return SSA.cell.tag(w ? T('pl.mine-protection.recent.warned', 'Warned') : T('pl.mine-protection.recent.teleported', 'Teleported'), w ? 'warn' : 'bad');
          } },
          { key: 'player', label: T('pl.mine-protection.col.player', 'Player'), sort: true, sortVal: function (r) { return (r.player || r.steamId || '').toLowerCase(); }, render: function (r) { return (r.player || r.steamId) ? SSA.cell.player(r.player, r.steamId) : document.createTextNode(''); } },
          { key: 'mine', label: T('pl.mine-protection.col.mine', 'Mine'), render: function (r) {
            if (r.action === 'cleared' || r.action === 'orphans' || r.action === 'removed') return document.createTextNode(T('pl.mine-protection.ff.removedCount', '{n} removed', { n: r.mine }) + ' · ' + kindWord(r.action === 'orphans' ? 'orphan' : r.action === 'removed' ? 'manual' : 'fallen'));
            return SSA.cell.item(r.code || r.type ? mineCode(r) : null, r.mine || r.type || T('pl.mine-protection.recent.mineFallback', 'mine'));
          } },
          { key: 'loc', label: T('pl.mine-protection.col.location', 'Location'), render: function (r) { return r.loc ? SSA.cell.location(r.loc.x, r.loc.y, r.loc.z) : document.createTextNode(''); } },
        ],
      });
      body.appendChild(card(T('pl.mine-protection.act.rmTitle', 'Removed mines'), T('pl.mine-protection.act.rmSub', 'One line per mine the game confirmed gone.'), [rmTbl.el]));
      body.appendChild(card(T('pl.mine-protection.act.jobsTitle', 'Being removed'), T('pl.mine-protection.act.jobsSub', 'Removals run one place at a time, and only while the game has the area loaded.'), [jobsTbl.el]));
      body.appendChild(card(T('pl.mine-protection.card.recent.title', 'Recent actions'), null, [recTbl.el]));
      live.activity = function () { rmTbl.refresh(); jobsTbl.refresh(); recTbl.refresh(); };
    }

    // ── Settings ──
    function renderSettings() {
      var c = S.config;
      var d = markDirty;
      // the master switch
      body.appendChild(card(T('pl.mine-protection.set.masterTitle', 'Mine Protection'), T('pl.mine-protection.set.masterSub', 'Off stops the punishment and every removal. Settings are kept.'), [
        sw(T('pl.mine-protection.set.master', 'Mine Protection is on'), function () { return c.enabled; }, function (v) { c.enabled = v; d(); }),
      ]));

      // watched types (picker)
      var pickerGrid = h('div', { class: 'mpr-pick-grid' });
      function renderPicker() {
        pickerGrid.innerHTML = '';
        var watched = new Set(c.watchedTypes || []);
        S.catalog.forEach(function (t) {
          var sel = watched.has(t.type);
          var counts = [];
          if (t.placed) counts.push(T('pl.mine-protection.picker.placed', '{n} placed', { n: t.placed }));
          if (t.armed) counts.push(T('pl.mine-protection.picker.armed', '{n} armed', { n: t.armed }));
          var media = t.image ? h('img', { class: 'mpr-pi-img', src: t.image, alt: '', loading: 'lazy' }) : h('span', { class: 'mpr-pi-ph' }, icon('box'));
          var el = h('button', { type: 'button', class: 'mpr-pi' + (sel ? ' on' : ''), title: t.type, 'aria-pressed': sel ? 'true' : 'false' }, [
            h('span', { class: 'mpr-pi-check' }, sel ? icon('check') : null),
            media,
            h('span', { class: 'mpr-pi-name' }, t.name || t.type),
            h('span', { class: 'mpr-pi-meta' }, counts.length ? counts.join(' · ') : (t.explosive ? T('pl.mine-protection.picker.explosive', 'explosive') : T('pl.mine-protection.picker.trap', 'trap'))),
          ]);
          el.addEventListener('click', function () {
            if (watched.has(t.type)) watched.delete(t.type); else watched.add(t.type);
            c.watchedTypes = S.catalog.map(function (x) { return x.type; }).filter(function (x) { return watched.has(x); });
            renderPicker(); d(); renderStat();
          });
          pickerGrid.appendChild(el);
        });
      }
      var quick = h('div', { class: 'mpr-pick-quick' }, [
        h('button', { type: 'button', class: 'secondary', onclick: function () { c.watchedTypes = S.catalog.filter(function (t) { return t.explosive; }).map(function (t) { return t.type; }); renderPicker(); d(); } }, T('pl.mine-protection.btn.explosivesOnly', 'Explosives only')),
        h('button', { type: 'button', class: 'secondary', onclick: function () { c.watchedTypes = S.catalog.map(function (t) { return t.type; }); renderPicker(); d(); } }, T('pl.mine-protection.btn.selectAll', 'Select all')),
        h('button', { type: 'button', class: 'secondary', onclick: function () { c.watchedTypes = []; renderPicker(); d(); } }, T('pl.mine-protection.btn.clear', 'Clear')),
      ]);
      var pickSub = (S.status && S.status.serverRunning === false)
        ? T('pl.mine-protection.card.watched.subServerOff', 'Pick which armed devices are enforced. No server needed; counts appear once it runs.')
        : T('pl.mine-protection.card.watched.sub', 'Pick which armed devices are enforced. Counts show what the server\'s last save holds.');
      body.appendChild(card(T('pl.mine-protection.card.watched.title', 'Watched mines & traps'), pickSub, [quick, pickerGrid]));
      renderPicker();

      // punishment
      body.appendChild(card(T('pl.mine-protection.set.punishTitle', 'Punishment'), T('pl.mine-protection.set.punishSub', 'For a watched mine armed outside the placer\'s own or squad\'s flag.'), [
        sw(T('pl.mine-protection.set.punish', 'Punish mines armed outside a flag'), function () { return c.punishEnabled; }, function (v) { c.punishEnabled = v; d(); }),
        h('div', { class: 'mpr-grid' }, [
          field(T('pl.mine-protection.f.whenViolation', 'When a violation is found'), select([
            ['teleport_to_mine', T('pl.mine-protection.action.teleport', 'Teleport onto their mine (kill)')],
            ['warn', T('pl.mine-protection.action.warn', 'Warn only (never teleport)')]], c.action, function (v) { c.action = v; d(); })),
          field(T('pl.mine-protection.f.warningsBefore', 'Warnings before action'), numInput(function () { return c.warningsBeforeAction; }, function (v) { c.warningsBeforeAction = Math.max(0, Math.min(10, v | 0)); d(); }, { min: 0, max: 10 }), T('pl.mine-protection.f.warningsBefore.hint', '0 = act on the first offence')),
          field(T('pl.mine-protection.f.margin', 'Extra margin around flag (m)'), numInput(function () { return c.marginMeters; }, function (v) { c.marginMeters = Math.max(0, v || 0); d(); }, { min: 0, step: 1 }), T('pl.mine-protection.f.margin.hint', 'Tolerance beyond the exact flag rectangle')),
          field(T('pl.mine-protection.f.scanInterval', 'Scan interval (s)'), numInput(function () { return c.pollSeconds; }, function (v) { c.pollSeconds = Math.max(2, Math.min(120, v | 0)); d(); }, { min: 2, max: 120 }), T('pl.mine-protection.f.scanInterval.hint', 'Applies immediately on save')),
        ]),
        sw(T('pl.mine-protection.chk.requireOnline', 'Only act while the placer is online'), function () { return c.requireOnline; }, function (v) { c.requireOnline = v; d(); }),
      ]));

      // messages
      body.appendChild(card(T('pl.mine-protection.card.messages.title', 'In-game messages'), T('pl.mine-protection.card.messages.sub', 'Sent to the offender via the SSA Bridge — any language.'), [
        h('div', { class: 'mpr-grid' }, [
          field(T('pl.mine-protection.f.channel', 'Chat channel'), select([
            ['local', T('pl.mine-protection.channel.local', 'Local')], ['global', T('pl.mine-protection.channel.global', 'Global')],
            ['squad', T('pl.mine-protection.channel.squad', 'Squad')], ['admin', T('pl.mine-protection.channel.admin', 'Admin')],
            ['server', T('pl.mine-protection.channel.server', 'Server')]], c.channel || 'local', function (v) { c.channel = v; d(); }), T('pl.mine-protection.f.channel.hint', 'Which chat tab the message shows in for the offender')),
        ]),
        h('div', { class: 'mpr-stack' }, [
          messageEditor(c, 'warnMessage', T('pl.mine-protection.f.warnMessage', 'Warning message'), d),
          messageEditor(c, 'message', T('pl.mine-protection.f.penaltyMessage', 'Penalty message'), d),
        ]),
      ]));

      // fallen flags
      body.appendChild(card(T('pl.mine-protection.card.fallen.title', 'Mines of a fallen flag'), T('pl.mine-protection.card.fallen.sub', 'When a flag falls and no new one is built in time, the mines left in its area are removed.'), [
        sw(T('pl.mine-protection.ff.on', 'Remove the mines of a fallen flag'), function () { return c.fallenFlagCleanup; }, function (v) { c.fallenFlagCleanup = v; d(); },
          T('pl.mine-protection.ff.onHint', 'Only flags that fall after this is on. Older ones are under "Mines outside every flag".')),
        h('div', { class: 'mpr-grid' }, [
          field(T('pl.mine-protection.ff.delay', 'Delay before removal (min)'), numInput(function () { return c.fallenFlagDelayMinutes; }, function (v) { c.fallenFlagDelayMinutes = Math.max(1, Math.min(1440, Number(v) || 1)); d(); }, { min: 1, max: 1440 }), T('pl.mine-protection.ff.delay.hint', 'A new flag in the area before then keeps the mines')),
          field(T('pl.mine-protection.ff.grace', 'Keep trying after that (min)'), numInput(function () { return c.fallenFlagGraceMinutes; }, function (v) { c.fallenFlagGraceMinutes = Math.max(5, Math.min(10080, Number(v) || 5)); d(); }, { min: 5, max: 10080 }), T('pl.mine-protection.ff.grace.hint', 'Mines can only be removed while the game has the area loaded')),
          field(T('pl.mine-protection.ff.types', 'What is removed'), select([['all', T('pl.mine-protection.ff.types.all', 'Every mine and trap')], ['watched', T('pl.mine-protection.ff.types.watched', 'Only the watched types above')]], c.fallenFlagTypes === 'watched' ? 'watched' : 'all', function (v) { c.fallenFlagTypes = v; d(); })),
          field(T('pl.mine-protection.ff.cancel', 'Whose new flag keeps the mines'), select([['owner', T('pl.mine-protection.ff.cancel.owner', 'The same owner or their squad')], ['any', T('pl.mine-protection.ff.cancel.any', 'Any new flag')]], c.fallenFlagCancelBy === 'any' ? 'any' : 'owner', function (v) { c.fallenFlagCancelBy = v; d(); })),
        ]),
        sw(T('pl.mine-protection.ff.alert', 'Send an owner alert'), function () { return c.fallenFlagAlert; }, function (v) { c.fallenFlagAlert = v; d(); }),
        sw(T('pl.mine-protection.ff.announce', 'Announce it in game chat'), function () { return c.fallenFlagAnnounce; }, function (v) { c.fallenFlagAnnounce = v; d(); }),
        h('div', { class: 'mpr-stack' }, [messageEditor(c, 'fallenFlagMessage', T('pl.mine-protection.ff.message', 'Chat announcement'), d)]),
      ]));

      // orphans
      body.appendChild(card(T('pl.mine-protection.card.orphan.title', 'Mines outside every flag'), T('pl.mine-protection.card.orphan.sub', 'Mines no standing flag covers, such as those of a flag that fell before this plugin first looked.'), [
        sw(T('pl.mine-protection.or.on', 'Remove mines that sit outside every flag'), function () { return c.orphanCleanup; }, function (v) { c.orphanCleanup = v; d(); },
          T('pl.mine-protection.or.onHint', 'A mine whose flag cannot be read is never counted as outside one.')),
        h('div', { class: 'mpr-grid' }, [
          field(T('pl.mine-protection.ff.types', 'What is removed'), select([['watched', T('pl.mine-protection.ff.types.watched', 'Only the watched types above')], ['all', T('pl.mine-protection.ff.types.all', 'Every mine and trap')]], c.orphanTypes === 'all' ? 'all' : 'watched', function (v) { c.orphanTypes = v; d(); })),
          field(T('pl.mine-protection.or.grace', 'Outside a flag for (min)'), numInput(function () { return c.orphanGraceMinutes; }, function (v) { c.orphanGraceMinutes = Math.max(1, Math.min(10080, Number(v) || 1)); d(); }, { min: 1, max: 10080 }), T('pl.mine-protection.or.grace.hint', 'A flag built there in the meantime keeps the mine')),
        ]),
        sw(T('pl.mine-protection.or.offline', 'Only while the placer is offline'), function () { return c.orphanOfflineOnly; }, function (v) { c.orphanOfflineOnly = v; d(); },
          T('pl.mine-protection.or.offlineHint', 'A placer the save no longer knows counts as offline.')),
        sw(T('pl.mine-protection.ff.alert', 'Send an owner alert'), function () { return c.orphanAlert; }, function (v) { c.orphanAlert = v; d(); }),
        sw(T('pl.mine-protection.ff.announce', 'Announce it in game chat'), function () { return c.orphanAnnounce; }, function (v) { c.orphanAnnounce = v; d(); }),
        h('div', { class: 'mpr-stack' }, [messageEditor(c, 'orphanMessage', T('pl.mine-protection.ff.message', 'Chat announcement'), d)]),
      ]));

      // removal
      var keptN = (c.keepMineIds || []).length;
      body.appendChild(card(T('pl.mine-protection.set.removeTitle', 'Removing mines'), T('pl.mine-protection.ff.needs', 'Needs "Destroy an item" in {where}. Loading an empty area needs "Work far from players".', { where: bridgeWhere() }), [
        sw(T('pl.mine-protection.ff.wake', 'Load the area when nobody is near'), function () { return c.fallenFlagWake; }, function (v) { c.fallenFlagWake = v; d(); },
          T('pl.mine-protection.set.wakeHint', 'For every removal: fallen flags, mines outside every flag, and your own.')),
        h('div', { class: 'mpr-grid' }, [
          field(T('pl.mine-protection.set.tryFor', 'Keep trying a removal for (min)'), numInput(function () { return c.removeTryMinutes; }, function (v) { c.removeTryMinutes = Math.max(5, Math.min(10080, Number(v) || 5)); d(); }, { min: 5, max: 10080 }), T('pl.mine-protection.set.tryForHint', 'For mines outside every flag and the ones you remove.')),
        ]),
        h('div', { class: 'mpr-keptrow' }, [
          h('span', {}, T('pl.mine-protection.set.kept', 'Mines kept from the clean-up: {n}.', { n: keptN })),
          keptN ? h('button', { type: 'button', class: 'secondary', onclick: function () {
            SSA.confirm(T('pl.mine-protection.set.forgetConfirm', 'Forget the kept mines ({n})? The clean-up may then remove them.', { n: keptN })).then(function (yes) {
              if (!yes) return;
              api('/keep-forget', { method: 'POST' }).then(function () { c.keepMineIds = []; S.config.keepMineIds = []; toast(T('pl.mine-protection.set.forgotten', 'Kept mines forgotten.')); render(); })
                .catch(function (err) { toast(why(err), 'error'); });
            });
          } }, T('pl.mine-protection.set.forget', 'Forget kept mines')) : null,
        ]),
      ]));

      // exemptions
      var chips = h('div', { class: 'mpr-chips' });
      function renderExempt() {
        chips.innerHTML = '';
        var ids = c.exemptSteamIds || [];
        if (!ids.length) chips.appendChild(h('span', { class: 'mpr-empty' }, T('pl.mine-protection.exempt.none', 'No exemptions — everyone is enforced.')));
        ids.forEach(function (sid) {
          chips.appendChild(h('span', { class: 'mpr-chip' }, [
            h('code', {}, sid),
            h('button', { type: 'button', class: 'mpr-chip-x', title: T('pl.mine-protection.exempt.remove', 'Remove'), onclick: function () { c.exemptSteamIds = ids.filter(function (x) { return x !== sid; }); renderExempt(); d(); } }, '✕'),
          ]));
        });
      }
      function addExempt(sid) {
        sid = String(sid || '').trim(); if (!sid) return;
        c.exemptSteamIds = c.exemptSteamIds || [];
        if (c.exemptSteamIds.indexOf(sid) < 0) c.exemptSteamIds.push(sid);
        renderExempt(); d();
      }
      var manualIn = h('input', { type: 'text', class: 'mpr-ex-in', placeholder: T('pl.mine-protection.exempt.placeholder', 'Steam ID (17 digits)') });
      manualIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addExempt(manualIn.value); manualIn.value = ''; } });
      body.appendChild(card(T('pl.mine-protection.card.exempt.title', 'Exemptions'), T('pl.mine-protection.card.exempt.sub2', 'These players are never punished, and their mines are never removed by the clean-up.'), [
        chips,
        h('div', { class: 'mpr-ex-add' }, [manualIn,
          h('button', { type: 'button', class: 'secondary', onclick: function () { addExempt(manualIn.value); manualIn.value = ''; } }, T('pl.mine-protection.btn.add', 'Add')),
          h('button', { type: 'button', class: 'secondary', onclick: function () { SSA.pickPlayer({ title: T('pl.mine-protection.exempt.pickTitle', 'Exempt a player') }).then(function (p) { if (p && p.steamId) addExempt(p.steamId); }); } }, T('pl.mine-protection.btn.pickOnline', 'Pick online player…'))]),
      ]));
      renderExempt();
      body.appendChild(h('div', { class: 'mpr-actions' }, [h('button', { type: 'button', onclick: save }, T('pl.mine-protection.btn.save', 'Save configuration'))]));
    }

    function save() {
      saveMsg.textContent = T('pl.mine-protection.save.saving', 'Saving…'); saveBtn.disabled = true;
      api('/config', { method: 'POST', body: S.config }).then(function (r) {
        saveBtn.disabled = false;
        if (r && r.ok) {
          S.config = Object.assign({}, DEF, r.config || S.config);
          S.dirty = false; saveBtn.classList.remove('mpr-unsaved');
          saveMsg.textContent = T('pl.mine-protection.save.saved', 'Saved ✓');
          toast(T('pl.mine-protection.toast.saved', 'Configuration saved'));
          setTimeout(function () { if (!S.dirty) saveMsg.textContent = ''; }, 2500);
          refreshLive(); poll();
        } else {
          // A route that answered 200 without `ok` is a refusal too, and it may have said why.
          var w = (r && r.reason) || (r && r.error) || T('pl.mine-protection.save.noReason', 'the manager did not say why');
          var say = T('pl.mine-protection.save.notSaved', 'NOT saved — {err}', { err: w });
          saveMsg.textContent = say; toast(say, 'error');
        }
      }).catch(function (err) {
        // The sentence STAYS beside the button: the edits are still unsaved in front of the owner.
        saveBtn.disabled = false;
        var say = T('pl.mine-protection.save.notSaved', 'NOT saved — {err}', { err: why(err) });
        saveMsg.textContent = say; toast(say, 'error');
      });
    }

    load();
  }

  SSA.ready(function () {
    SSA.registerTab({ id: 'mine-protection', label: T('pl.mine-protection.tab.label', 'Mine Protection'), icon: '#i-shield', premium: true, render: editor });
  });
}());
