/* Raid Window — admin tab.
 *
 * Top to bottom: a short line saying what the plugin does and whether it is working, a Bridge box
 * that lists what the configuration needs switched on and turns it on with one confirmed click, the
 * few settings an owner actually chooses (everything else folded under "More options", every
 * explanation behind a "?"), the bases under raid right now, and the pushes it has made.
 *
 * Every setting is editable with the server stopped. The live half only adds to the page, and it
 * is redrawn on its own, so a poll never throws away something half typed. Talks only to its own
 * backend, plus the manager's own route for turning bridge switches on.
 *
 * Every word on this screen goes through the panel's translator, with the English written beside
 * the key: a language nobody has translated yet renders exactly what it renders today. */
(function () {
  'use strict';

  var PLUGIN = 'raid-window';
  var T = SSA.t;
  /* WHERE THE BRIDGE'S SETTINGS REALLY ARE, IN THE PANEL'S OWN WORDS.
   *
   * Three sentences here used to send an owner to "Settings → Bridge", and that menu entry has
   * never existed: Settings holds Manager, Discord, Server, Frontend, Game Settings and
   * Translations, and the bridge's module cards live under Plugins on a tab called SSA Bridge.
   * A route nobody can walk is worse than no route at all, and translating it multiplied three
   * wrong sentences into fifty-four.
   *
   * So it is not written down here either. Both halves are looked up in the PANEL's dictionary —
   * `nav.plugins` and `plugins.viewInGame` are the very keys the nav and the tab strip render
   * themselves from — which makes the sentence correct in all nineteen languages and, more to the
   * point, keeps it correct on the day somebody renames that tab. The plugin's own locale files
   * carry `{where}` and no route of their own. */
  function bridgeWhere() {
    return T('nav.plugins', 'Plugins') + ' → ' + T('plugins.viewInGame', 'SSA Bridge');
  }
  var DEF = {
    enabled: true, pollSeconds: 20, pushSeconds: 3600, reapplySeconds: 600, holdSeconds: 3600,
    minHits: 3, acceptDeclared: false, useOwnerAlerts: true, resetCooldownFirst: false,
    durationSeconds: null, allowDecodedDuration: true, maxPushesPerRaid: 24, countFromLastHit: false,
    exemptBaseIds: [], exemptFlagIds: [],
  };

  // The manager's own client: a 404, a dead backend and an expired session reject with words in
  // them instead of resolving to `{}`, which every list below would draw as "nothing is happening".
  var api = SSA.apiClient();
  function why(err) { return SSA.apiError(err); }

  /** The row's label is the control's NAME too: a dropdown reading only its value ("Airfield")
   *  says nothing about what it chooses to a screen reader. */
  function nameCtl(ctl, label) {
    if (typeof label !== 'string' || !label || !ctl || !ctl.tagName) return;
    var f = /^(SELECT|INPUT|TEXTAREA)$/.test(ctl.tagName) ? ctl : (ctl.querySelector ? ctl.querySelector('select') : null);
    if (f && !f.getAttribute('aria-label') && !f.id) f.setAttribute('aria-label', label);
  }
  function h(tag, props, kids) {
    var e = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v);
    });
    (Array.isArray(kids) ? kids : (kids != null ? [kids] : [])).forEach(function (c) {
      if (c != null && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    // An icon button is named by aria-label; its title is the localised name, so it is that too.
    if (tag === 'button' && e.title && !e.hasAttribute('aria-label') && !e.textContent.trim()) e.setAttribute('aria-label', e.title);
    return e;
  }
  function icon(n) { return SSA.icon ? SSA.icon(n) : h('span', {}); }
  function toast(m, kind) { if (SSA.toast) SSA.toast(m, kind); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function sentence(s) { s = cap(s).trim(); return s && !/[.!?]$/.test(s) ? s + '.' : s; }

  // ── time in words ─────────────────────────────────────────────────────────────────────────────
  function dur(n) {
    if (n == null || !isFinite(n)) return '';
    n = Math.max(0, Math.round(n));
    if (n < 60) return T('pl.raid-window.dur.seconds', '{n} s', { n: n });
    if (n < 3600) return T('pl.raid-window.dur.minutes', '{n} min', { n: Math.round(n / 60) });
    var hh = Math.floor(n / 3600), mm = Math.round((n % 3600) / 60);
    if (hh < 48) {
      return mm ? T('pl.raid-window.dur.hoursMinutes', '{h} h {m} min', { h: hh, m: mm })
        : T('pl.raid-window.dur.hours', '{h} h', { h: hh });
    }
    return T('pl.raid-window.dur.hours', '{h} h', { h: Math.round(n / 3600) });
  }
  function ago(ms) { return ms ? T('pl.raid-window.ago', '{t} ago', { t: dur((Date.now() - ms) / 1000) }) : ''; }
  // Where a protection length came from, in words. Resolved at render time so the dictionary the
  // panel loaded is the one that answers.
  function sourceText(k) {
    if (k === 'configured') return T('pl.raid-window.source.configured', 'your fixed length');
    if (k === 'saved') return T('pl.raid-window.source.saved', 'from the save');
    if (k === 'decoded') return T('pl.raid-window.source.decoded', 'from the running game');
    return null;
  }

  // What each push outcome means, in words. "No change" is the one that matters: the game took the
  // push and the base did not move, which is not a success and must never read as one.
  function verdicts() {
    return {
      moved: ['good', T('pl.raid-window.verdict.moved', 'Pushed'),
        T('pl.raid-window.verdict.moved.text', 'Protection now starts later.')],
      unchanged: ['wait', T('pl.raid-window.verdict.unchanged', 'No change'),
        T('pl.raid-window.verdict.unchanged.text', 'The game took the push, but nothing changed. Normal while a defender is online.')],
      unconfirmed: ['wait', T('pl.raid-window.verdict.unconfirmed', 'Sent'),
        T('pl.raid-window.verdict.unconfirmed.text', 'The game took the push, but the result could not be read back.')],
      later: ['good', T('pl.raid-window.verdict.later', 'Already later'),
        T('pl.raid-window.verdict.later.text', 'Protection already starts later than this push, so it was left alone.')],
      running: ['bad', T('pl.raid-window.verdict.running', 'Already protected'),
        T('pl.raid-window.verdict.running.text', 'Protection had already started, and the plugin never takes protection away.')],
      refused: ['bad', T('pl.raid-window.verdict.refused', 'Refused'), null],
      no_duration: ['bad', T('pl.raid-window.verdict.skipped', 'Skipped'), null],
      closed: ['flat', T('pl.raid-window.verdict.ended', 'Ended'), null],
      capped: ['wait', T('pl.raid-window.verdict.capped', 'Limit reached'), null],
    };
  }
  function verdictOf(state) {
    return verdicts()[state] || ['flat', T('pl.raid-window.verdict.waiting', 'Waiting'), null];
  }

  /* THE BACKEND SENDS CODES, AND THE WORDS ARE MADE HERE.
   *
   * Every sentence below used to arrive from the backend in English and was shown as it came, so a
   * German owner read German labels around English explanations. The backend now sends a code and
   * its numbers; its English `text` is kept only for a code this tab does not know (an older or
   * newer backend) and for the bridge's own refusal, which is the bridge's words and shown as is. */
  function fixedLengthHint() {
    return T('pl.raid-window.why.setFixed', 'To push it anyway, set a fixed protection length under {more}.',
      { more: T('pl.raid-window.moreOptions', 'More options') });
  }
  /** A source that could not answer: `{ code, module, text }`. */
  function whyText(n) {
    if (!n) return '';
    var mod = n.module || '';
    if (n.code === 'module_off') return T('pl.raid-window.why.moduleOff', 'The bridge\'s {module} module is switched off. The {box} box on this tab turns it on.',
      { module: mod, box: T('pl.raid-window.card.bridge', 'Bridge') });
    if (n.code === 'no_module') return T('pl.raid-window.why.noModule', 'This server runs an older SSA Bridge with no {module} module. Update the SSA Bridge.', { module: mod });
    if (n.code === 'bridge_off') return T('pl.raid-window.why.bridgeOff', 'The SSA Bridge did not answer.');
    if (n.code === 'save_unreadable') return T('pl.raid-window.why.saveUnreadable', 'The save cannot be read right now, so the base\'s flag cannot be found yet.');
    return sentence(n.text || '');
  }
  /** Why nothing is pushed for the protection mode: `{ code, cls, cause, text }`. */
  function modeText(m) {
    if (!m) return '';
    if (m.code === 'global') return T('pl.raid-window.mode.global', 'This server runs global raid protection, which goes by the clock. There is nothing to push.');
    if (m.code === 'none') return T('pl.raid-window.mode.none', 'The game has no raid protection right now: it is off, or the server is still starting.');
    if (m.code === 'unknown_class') return T('pl.raid-window.mode.unknownClass', 'This server runs a raid protection the plugin does not know ({cls}).', { cls: m.cls || '?' });
    if (m.code === 'unreadable') {
      var cause = m.cause ? whyText(m.cause) : '';
      return (cause ? cause + ' ' : '') + T('pl.raid-window.mode.unreadable', 'So the plugin cannot tell which raid protection this server runs.');
    }
    return sentence(m.text || '');
  }
  /** A push verdict or a feed entry with a `code`, in words. Null when it carries none this tab knows. */
  function codeText(v) {
    if (!v || !v.code) return null;
    var p = v.params || {};
    switch (v.code) {
      case 'no_length_now':
        return T('pl.raid-window.why.noLengthNow', 'The save holds no protection length for this base right now, and the running game gave none.') + ' ' + fixedLengthHint();
      case 'no_length':
        return T('pl.raid-window.why.noLength', 'Neither the save nor the running game could say how long this base\'s protection lasts.') + ' ' + fixedLengthHint();
      case 'too_long':
        return (p.from === 'save'
          ? T('pl.raid-window.why.tooLongSave', 'The save says this base\'s protection lasts {h} hours, more than the {max} hours the SSA Bridge will send.', { h: p.hours, max: p.max })
          : T('pl.raid-window.why.tooLongGame', 'The running game says this base\'s protection lasts {h} hours, more than the {max} hours the SSA Bridge will send.', { h: p.hours, max: p.max }))
          + ' ' + fixedLengthHint();
      case 'range':
        return sentence(v.text || '') + ' ' + T('pl.raid-window.why.range',
          'Raise "{setting}"{limit} on the {module} card in {where}, or set a shorter fixed length under {more}.',
          { setting: p.setting || '', limit: p.limit != null ? ' (' + p.limit + ')' : '', module: p.module || '', where: bridgeWhere(),
            more: T('pl.raid-window.moreOptions', 'More options') });
      case 'bridge':
        return v.text ? sentence(v.text) : T('pl.raid-window.why.noReason', 'The bridge did not say why.');
      case 'bridge_too_old':
        return T('pl.raid-window.why.bridgeTooOld', 'This SSA Bridge cannot postpone offline protection yet. Update the SSA Bridge.');
      case 'note':
        return whyText({ code: p.note, module: p.module, text: v.text });
      case 'quiet':
        return T('pl.raid-window.why.quiet', 'No damage for {n} minutes, so the raid is over. Protection starts when the last push set it.', { n: p.minutes });
      case 'admin':
        return T('pl.raid-window.why.admin', 'Stopped by an admin. Nothing was written to the game.');
      case 'capped':
        return T('pl.raid-window.why.capped', 'Pushed {n} times, the most "{setting}" allows. Nothing more is pushed until the raid ends.',
          { n: p.pushes, setting: T('pl.raid-window.set.maxPushes', 'Most pushes for one raid') });
    }
    return null;
  }
  /** A settings box by its config key, in the words its row is labelled with. */
  function labelOf(k) {
    switch (k) {
      case 'enabled': return T('pl.raid-window.set.enabled', 'Keep raids going when defenders log out');
      case 'pollSeconds': return T('pl.raid-window.set.poll', 'Look for raid damage every');
      case 'pushSeconds': return T('pl.raid-window.set.push', 'Push protection back by');
      case 'reapplySeconds': return T('pl.raid-window.set.reapply', 'Repeat the push every');
      case 'holdSeconds': return T('pl.raid-window.set.hold', 'A raid is over after no damage for');
      case 'minHits': return T('pl.raid-window.set.minHits', 'Hits needed to count as a raid');
      case 'acceptDeclared': return T('pl.raid-window.set.acceptDeclared', 'Accept raids declared by other tools');
      case 'useOwnerAlerts': return T('pl.raid-window.set.ownerAlerts', 'Base attack alerts keep a raid going');
      case 'resetCooldownFirst': return T('pl.raid-window.set.resetCooldown', 'Clear the protection cooldown before each push');
      case 'durationSeconds': return T('pl.raid-window.set.duration', 'Protection length');
      case 'allowDecodedDuration': return T('pl.raid-window.set.allowDecoded', 'If the save has no length, ask the running game');
      case 'maxPushesPerRaid': return T('pl.raid-window.set.maxPushes', 'Most pushes for one raid');
      case 'countFromLastHit': return T('pl.raid-window.set.countFromLastHit', 'Every hit restarts the countdown');
      case 'exemptBaseIds': return T('pl.raid-window.set.exemptBases', 'Never touch these bases');
      case 'exemptFlagIds': return T('pl.raid-window.set.exemptFlags', 'Never touch these flags');
    }
    return k;
  }
  function unitWord(u) {
    if (u === 'seconds') return T('pl.raid-window.unit.seconds', 'seconds');
    if (u === 'minutes') return T('pl.raid-window.unit.minutes', 'minutes');
    if (u === 'hours') return T('pl.raid-window.unit.hours', 'hours');
    return '';
  }
  /** One refused box: `{ key, rule, lo, hi, unit, max }`. */
  function invalidText(d) {
    var label = labelOf(d.key);
    if (d.rule === 'range' && d.unit) return T('pl.raid-window.invalid.rangeUnit', '"{label}" must be from {lo} to {hi} {unit}.', { label: label, lo: d.lo, hi: d.hi, unit: unitWord(d.unit) });
    if (d.rule === 'range') return T('pl.raid-window.invalid.range', '"{label}" must be a number from {lo} to {hi}.', { label: label, lo: d.lo, hi: d.hi });
    if (d.rule === 'bool') return T('pl.raid-window.invalid.bool', '"{label}" must be on or off.', { label: label });
    if (d.rule === 'duration') return T('pl.raid-window.invalid.duration', '"{label}" must be empty, or up to {max} hours.', { label: label, max: d.max });
    if (d.rule === 'ids') return T('pl.raid-window.invalid.ids', '"{label}" must be id numbers, separated by commas.', { label: label });
    return label;
  }

  // One poll timer for the whole tab, however often it is opened.
  var timer = null;
  var active = null;

  function editor(el) {
    var cfg = null;          // the working copy the form edits
    var status = null;
    var bridge = null;
    var dirty = false;
    var tick = 0;

    el.innerHTML = '';
    var root = h('div', { class: 'rw' });
    el.appendChild(root);
    root.appendChild(h('p', { class: 'rw-lead' },
      T('pl.raid-window.lead',
        'While a base takes raid damage, this keeps pushing its offline protection back.')));
    var figs = h('div', { class: 'rw-figs' });
    var notes = h('div', { class: 'rw-notes' });
    var bridgeBox = h('div');
    var settingsBox = h('div');
    var liveBox = h('div');
    var histBox = h('div');
    [figs, notes, bridgeBox, settingsBox, liveBox, histBox].forEach(function (x) { root.appendChild(x); });
    settingsBox.appendChild(h('p', { class: 'rw-empty' }, T('pl.raid-window.loading', 'Loading…')));

    function load() {
      Promise.all([api('/config'), api('/status')]).then(function (r) {
        cfg = Object.assign({}, DEF, r[0] || {});
        status = r[1] || null;
        dirty = false;
        renderSettings();
        renderLive();
        refreshBridge();
        bindTimer();
      }).catch(function (err) {
        settingsBox.innerHTML = '';
        settingsBox.appendChild(h('div', { class: 'rw-note bad' }, [
          h('strong', {}, T('pl.raid-window.load.failed', 'This tab could not load its settings. ')), why(err),
          h('div', { class: 'rw-actions' }, [h('button', { type: 'button', class: 'secondary', onclick: load },
            T('pl.raid-window.tryAgain', 'Try again'))]),
        ]));
      });
    }

    function bindTimer() {
      active = refresh;
      if (timer) clearInterval(timer);
      timer = setInterval(function () {
        if (active !== refresh) return;
        if (!el.isConnected) { clearInterval(timer); timer = null; return; }
        refresh();
      }, 10000);
    }
    function refresh() {
      tick++;
      api('/status').then(function (s) { status = s || status; renderLive(); })
        .catch(function () { /* a failed poll leaves the last reading on screen */ });
      if (tick % 6 === 0) refreshBridge();
    }

    // ── little controls ─────────────────────────────────────────────────────────────────────────
    function changed() {
      dirty = true;
      saveState();
    }
    function toggle(key) {
      var b = h('input', { type: 'checkbox' });
      b.checked = cfg[key] === true;
      b.addEventListener('change', function () { cfg[key] = b.checked; changed(); if (key === 'resetCooldownFirst' || key === 'enabled') renderFigs(); });
      return h('label', { class: 'switch' }, [b]);
    }
    /** A number shown in `unit` and stored in seconds (`per` seconds to one unit). */
    function num(key, per, unit, min, max) {
      var v = cfg[key];
      var i = h('input', { type: 'number', class: 'rw-in rw-num', min: min, max: max, step: 'any' });
      // Enough decimals that retyping the figure shown stores the same whole second again: two for
      // minutes, four for hours (86528 s is 24.0356 h; at two decimals it would come back 16 s off).
      var places = per >= 3600 ? 10000 : 100;
      i.value = v == null ? '' : String(Math.round((v / per) * places) / places);
      i.addEventListener('input', function () {
        // An empty box is sent as empty, and the backend refuses it by the box's name. Guessing a
        // number here would save something nobody typed.
        cfg[key] = i.value === '' ? null : Math.round(Number(i.value) * per);
        changed();
        hints();
      });
      return h('span', { class: 'rw-unit' }, [i, unit ? h('span', {}, unit) : null]);
    }
    function ids(key) {
      var i = h('input', { type: 'text', class: 'rw-in', placeholder: T('pl.raid-window.ids.placeholder', 'none') });
      i.value = (cfg[key] || []).join(', ');
      i.addEventListener('input', function () {
        // Every entry is sent as typed, so "12, abc" is refused by name rather than saved as [12].
        cfg[key] = i.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
          .map(function (s) { return /^[0-9]+$/.test(s) ? Number(s) : s; });
        changed();
      });
      return i;
    }
    /** One settings row. The explanation opens on "?", in place, so nothing typed is redrawn away. */
    function row(label, control, hint, extra) {
      nameCtl(control, label);
      var text = hint ? h('p', { class: 'rw-hint', hidden: true }, hint) : null;
      var q = null;
      if (hint) {
        q = h('button', { type: 'button', class: 'rw-q', title: T('pl.raid-window.whatDoesThisDo', 'What does this do?'), 'aria-expanded': 'false' }, '?');
        q.addEventListener('click', function () {
          var open = text.hidden;
          text.hidden = !open;
          q.classList.toggle('on', open);
          q.setAttribute('aria-expanded', String(open));
        });
      }
      return h('div', { class: 'rw-row' }, [
        h('div', { class: 'rw-lab' }, [h('span', {}, label), q]),
        text,
        h('div', { class: 'rw-ctl' }, [control, extra || null]),
      ]);
    }
    function note(kind, kids) { return h('div', { class: 'rw-note ' + (kind || 'flat') }, kids); }
    function card(ico, title, kids) {
      return h('section', { class: 'card rw-card' }, [h('h3', {}, [icon(ico), title])].concat(kids));
    }

    // ── figures and notes ───────────────────────────────────────────────────────────────────────
    function renderFigs() {
      figs.innerHTML = '';
      if (!cfg) return;
      var on = status ? status.enabled !== false : cfg.enabled;
      var open = status ? (status.open || []).length : 0;
      var pushed = status ? (status.history || []).filter(function (e) { return e.state === 'moved'; }).length : 0;
      figs.appendChild(h('div', { class: 'rw-fig' + (on ? ' good' : '') }, [
        h('b', {}, on ? T('pl.raid-window.fig.on', 'On') : T('pl.raid-window.fig.off', 'Off')),
        h('span', {}, T('pl.raid-window.fig.plugin', 'plugin'))]));
      figs.appendChild(h('div', { class: 'rw-fig' + (open ? ' wait' : '') }, [h('b', {}, String(open)),
        h('span', {}, T('pl.raid-window.fig.underRaidNow', 'under raid now'))]));
      figs.appendChild(h('div', { class: 'rw-fig' }, [h('b', {}, String(pushed)),
        h('span', {}, T('pl.raid-window.fig.recentPushes', 'recent pushes'))]));
    }

    function renderNotes() {
      notes.innerHTML = '';
      if (!status) return;
      if (status.enabled === false) {
        // The route to the switch is built from the row's own label and the card's own title.
        notes.appendChild(note('flat', T('pl.raid-window.note.offWhere',
          'The plugin is switched off, so nothing is pushed. Turn on "{setting}" in the {card} box below.',
          { setting: T('pl.raid-window.set.enabled', 'Keep raids going when defenders log out'), card: T('pl.raid-window.card.settings', 'Settings') })));
        return;
      }
      var saveUnreadable = status.save === 'unreadable';
      if (saveUnreadable) {
        // The save is there and cannot be read: a stop, a start or a restart. Not "server stopped",
        // and not a reason to end anything.
        notes.appendChild(note('wait', [T('pl.raid-window.note.saveUnreadable', 'The save cannot be read right now (the server is stopping, starting or restarting).'),
          T('pl.raid-window.note.stillPushed', ' A raid that is already being pushed is not ended because of this.')]));
      } else if (status.serverRunning === false) {
        notes.appendChild(note('flat', T('pl.raid-window.note.serverStopped', 'Server stopped: no raids yet. Everything here can be set now.')));
        return;
      }
      if (status.idle && (status.idle.code || status.idle.text)) {
        var idleSaid = status.idle.code === 'nobody_online'
          // Nothing the bridge saw while idle is lost: the raid module keeps counting either way.
          ? T('pl.raid-window.idle.nobodyOnline', 'nobody is online, so nobody can be raiding. It starts again when somebody connects.')
          : sentence(status.idle.text || '');
        notes.appendChild(note('flat', [h('strong', {}, T('pl.raid-window.note.idle', 'Not looking right now: ')), idleSaid]));
        return;
      }
      var n = status.notes || {};
      if (n.mode && (n.mode.code || n.mode.text)) {
        notes.appendChild(note('wait', [h('strong', {}, T('pl.raid-window.note.nothingPushed', 'Nothing is pushed: ')), modeText(n.mode)]));
      }
      [['raid', T('pl.raid-window.note.raidDamage', 'Raid damage')],
        ['protect', T('pl.raid-window.note.protection', 'Protection')],
        ['db', T('pl.raid-window.note.gameDatabase', 'Game database')]].forEach(function (k) {
        var one = n[k[0]];
        if (!one || !(one.code || one.text)) return;
        if (k[0] === 'db' && saveUnreadable) return;            // said once, above
        var said = whyText(one);
        if (!said) return;
        notes.appendChild(note('wait', [h('strong', {}, k[1] + ': '), said,
          T('pl.raid-window.note.stillPushed', ' A raid that is already being pushed is not ended because of this.')]));
      });
    }

    // ── the bridge box ──────────────────────────────────────────────────────────────────────────
    function refreshBridge() {
      return Promise.resolve(api('/bridge-check'))
        .then(function (r) { bridge = (r && Array.isArray(r.items)) ? r : null; })
        .catch(function () { bridge = null; })
        .then(renderBridge);
    }

    function turnOnInBridge(items) {
      var lines = items.map(function (x) {
        var warn = x.key === 'postpone' ? T('pl.raid-window.bridge.warn.postpone', ' (it only ever moves the start of offline protection later)')
          : (x.noUndo ? T('pl.raid-window.bridge.warn.noUndo', ' (a changed protection window cannot be undone)') : '');
        return T('pl.raid-window.bridge.line', '• {module}: {label}{warn}', { module: x.moduleName, label: x.label, warn: warn });
      });
      return Promise.resolve(SSA.confirm(
        T('pl.raid-window.bridge.confirm',
          'Turn these on in the SSA Bridge?\n\n{lines}\n\nYou can switch each one off again on its card in {where}.',
          { lines: lines.join('\n'), where: bridgeWhere() }),
        { okLabel: T('pl.raid-window.bridge.confirmOk', 'Turn on') }))
        .then(function (yes) {
          if (!yes) return null;
          return fetch('/api/plugins/' + PLUGIN + '/bridge-needs/apply', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: true, only: items.map(function (x) { return x.module + '.' + x.key; }) }),
          }).then(function (r) { return r.json().catch(function () { return { ok: false, error: 'http_' + r.status }; }); })
            .catch(function () { return { ok: false, error: T('pl.raid-window.bridge.unreachable', 'the manager could not be reached') }; });
        })
        .then(function (r) {
          if (r === null) return;
          if (!r || r.ok === false) {
            // A sentence for every refusal the manager's route can give, never its raw code.
            var e = r && r.error ? String(r.error) : '';
            var msg;
            if (e === 'bridge_ui_disabled') msg = T('pl.raid-window.bridge.uiDisabled', 'In-game control is switched off for this panel, so nothing was changed');
            else if (e === 'premium_required' || e === 'http_402') msg = T('pl.raid-window.bridge.premium', 'Nothing was changed: this manager has no active premium licence.');
            else if (e === 'http_401' || e === 'http_403') msg = T('pl.raid-window.bridge.signIn', 'Nothing was changed: sign in to the panel again.');
            else msg = sentence(T('pl.raid-window.bridge.changeFailed', 'The bridge settings could not be changed'));
            toast(msg, 'error');
            return;
          }
          var n = (r.applied || []).reduce(function (k, a) { return k + (a.keys || []).length; }, 0);
          toast(n
            ? (n === 1 ? T('pl.raid-window.bridge.switchedOne', 'Switched on {n} setting in the bridge', { n: n })
              : T('pl.raid-window.bridge.switchedMany', 'Switched on {n} settings in the bridge', { n: n }))
            : T('pl.raid-window.bridge.nothingNeeded', 'Nothing needed changing'));
          refreshBridge();
        });
    }

    function renderBridge() {
      bridgeBox.innerHTML = '';
      if (!bridge) return;
      var items = bridge.items;
      var kids = [];
      var off = items.filter(function (x) { return x.state === 'off'; });
      var canOn = off.filter(function (x) { return x.ownerMay && !x.byHand; });
      var byHand = items.filter(function (x) { return x.state !== 'on' && x.state !== 'missing' && (x.byHand || (x.state === 'off' && !x.ownerMay)); });
      var gone = items.filter(function (x) { return x.state === 'missing'; });
      var unknown = items.filter(function (x) { return x.state === 'unknown' && !x.byHand; });

      if (unknown.length && !bridge.known) {
        kids.push(note('wait', T('pl.raid-window.bridge.cannotRead',
          'Cannot read bridge settings. In {where}, turn on Raid detection and Raid protection control.', { where: bridgeWhere() })));
      } else if (!off.length && !gone.length && !byHand.length) {
        kids.push(note('good', T('pl.raid-window.bridge.allOn', 'Everything this plugin needs is switched on in the bridge.')));
      }
      off.filter(function (x) { return canOn.indexOf(x) >= 0; }).forEach(function (x) {
        kids.push(h('div', { class: 'rw-need' }, [icon('alert'),
          h('span', {}, [h('b', {}, x.forWhat + ': '),
            T('pl.raid-window.bridge.isOff', '{module}, "{label}" is off', { module: x.moduleName, label: x.label })])]));
      });
      byHand.forEach(function (x) {
        kids.push(h('div', { class: 'rw-need' }, [icon('alert'),
          h('span', {}, [h('b', {}, x.forWhat + ': '),
            T('pl.raid-window.bridge.byHand', 'turn on "{label}" on the {module} card in {where}', { label: x.label, module: x.moduleName, where: bridgeWhere() })
            + (x.state === 'unknown' ? T('pl.raid-window.bridge.byHand.unknown', ' (the server is not running, so it cannot be checked from here)') : '')])]));
      });
      gone.forEach(function (x) {
        kids.push(h('div', { class: 'rw-need' }, [icon('close'),
          h('span', {}, [h('b', {}, x.forWhat + ': '),
            T('pl.raid-window.bridge.missing', 'this bridge has no "{label}". Update the SSA Bridge', { label: x.label })])]));
      });
      if (canOn.length) {
        kids.push(h('div', { class: 'rw-actions' }, [
          h('button', { type: 'button', onclick: function () { turnOnInBridge(canOn); } },
            [icon('check'), canOn.length === 1 ? T('pl.raid-window.bridge.turnOnOne', 'Turn it on in the bridge')
              : T('pl.raid-window.bridge.turnOnMany', 'Turn them on in the bridge')]),
        ]));
      }
      if (bridge.online === false && (off.length || byHand.length)) {
        kids.push(h('p', { class: 'rw-small' }, T('pl.raid-window.bridge.startsWith', 'The server is not running, so this is what the bridge will start with.')));
      }
      bridgeBox.appendChild(card('check-shield', T('pl.raid-window.card.bridge', 'Bridge'), kids));
    }

    // ── settings ────────────────────────────────────────────────────────────────────────────────
    var saveMsg = null, saveBtn = null, reapplyWarn = null, capHint = null;

    function saveState() {
      if (!saveMsg) return;
      saveMsg.textContent = dirty ? T('pl.raid-window.save.unsaved', 'Unsaved changes') : T('pl.raid-window.save.allSaved', 'All changes saved');
      saveMsg.className = 'rw-dirty' + (dirty ? ' unsaved' : '');
    }
    /** The two things worth saying about the numbers as they are typed, without a save. */
    function hints() {
      if (reapplyWarn) {
        var bad = cfg.reapplySeconds != null && cfg.pushSeconds != null && cfg.reapplySeconds >= cfg.pushSeconds;
        reapplyWarn.hidden = !bad;
      }
      if (capHint) {
        var total = (cfg.maxPushesPerRaid || 0) * (cfg.reapplySeconds || 0);
        capHint.textContent = total > 0
          ? T('pl.raid-window.hint.totalPush', 'With these settings one raid is pushed for up to about {t}.', { t: dur(total) })
          : '';
      }
    }

    function save() {
      saveBtn.disabled = true;
      saveMsg.textContent = T('pl.raid-window.save.saving', 'Saving…');
      api('/config', { method: 'POST', body: cfg }).then(function (r) {
        saveBtn.disabled = false;
        if (r && r.ok) {
          cfg = Object.assign({}, DEF, r.config || cfg);
          dirty = false;
          var ignored = (r.ignored && r.ignored.length)
            ? T('pl.raid-window.save.notKept', ' (not kept: {list})', { list: r.ignored.join(', ') }) : '';
          toast(T('pl.raid-window.save.saved', 'Saved') + ignored);
          renderSettings();
          refreshBridge();
          api('/status').then(function (s) { status = s || status; renderLive(); }).catch(function () {});
        } else {
          var w = (r && Array.isArray(r.invalid) && r.invalid.length)
            ? r.invalid.map(invalidText).join(' ')
            : sentence((r && (r.reason || r.error)) || T('pl.raid-window.save.noReason', 'the manager did not say why'));
          saveMsg.textContent = T('pl.raid-window.save.notSaved', 'Not saved. {why}', { why: w });
          saveMsg.className = 'rw-dirty unsaved';
          toast(T('pl.raid-window.save.notSaved', 'Not saved. {why}', { why: w }), 'error');
        }
      }).catch(function (err) {
        saveBtn.disabled = false;
        saveMsg.textContent = T('pl.raid-window.save.notSaved', 'Not saved. {why}', { why: why(err) });
        saveMsg.className = 'rw-dirty unsaved';
        toast(T('pl.raid-window.save.notSaved', 'Not saved. {why}', { why: why(err) }), 'error');
      });
    }

    function lengthControl() {
      var fixed = cfg.durationSeconds != null;
      var hours = num('durationSeconds', 3600, T('pl.raid-window.unit.hours', 'hours'), 0.1, 168);
      hours.hidden = !fixed;
      var s = h('select', { class: 'rw-in' }, [
        h('option', { value: 'own' }, T('pl.raid-window.length.own', 'Keep each base\'s own length')),
        h('option', { value: 'fixed' }, T('pl.raid-window.length.fixed', 'Use a fixed length')),
      ]);
      s.value = fixed ? 'fixed' : 'own';
      s.addEventListener('change', function () {
        var f = s.value === 'fixed';
        if (f && cfg.durationSeconds == null) {
          cfg.durationSeconds = 86400;
          hours.querySelector('input').value = '24';
        }
        if (!f) cfg.durationSeconds = null;
        hours.hidden = !f;
        changed();
      });
      return h('div', { class: 'rw-stack' }, [s, hours]);
    }

    function lookup() {
      var inp = h('input', { type: 'number', class: 'rw-in rw-num', placeholder: T('pl.raid-window.lookup.placeholder', 'flag id'), min: 1 });
      var out = h('span', { class: 'rw-small' });
      var btn = h('button', { type: 'button', class: 'secondary' }, T('pl.raid-window.lookup.check', 'Check'));
      btn.addEventListener('click', function () {
        var v = Number(inp.value);
        if (!(isFinite(v) && v > 0)) { out.textContent = T('pl.raid-window.lookup.needId', 'Type a flag id first.'); return; }
        out.textContent = T('pl.raid-window.lookup.reading', 'Reading…');
        api('/flag', { method: 'POST', body: { id: v } }).then(function (r) {
          var saved = r.savedDurationSeconds;
          var parts = [saved == null ? T('pl.raid-window.lookup.noLengthAtAll', 'The save has no length for it')
            : (saved === 0 ? T('pl.raid-window.lookup.noLengthNow', 'The save holds no length right now')
              : T('pl.raid-window.lookup.savedLength', 'Saved length {t}', { t: dur(saved) }))];
          // On offline protection the reading below is the running game's answer; "did not answer"
          // beside it contradicted the next clause.
          if (r.live && r.live.durationSeconds != null) {
            parts.push(T('pl.raid-window.lookup.liveSays', 'the running game says {t}', { t: dur(r.live.durationSeconds) }));
          } else if (!r.offline) parts.push(T('pl.raid-window.lookup.liveSilent', 'the running game did not answer'));
          if (r.live && r.live.active != null) {
            parts.push(r.live.active ? T('pl.raid-window.lookup.protectionOn', 'protection is on')
              : T('pl.raid-window.lookup.protectionOff', 'protection is not on'));
          }
          if (r.offline) {
            if (r.offline.armed === false) parts.push(T('pl.raid-window.lookup.offline.notArmed', 'offline protection is not armed (a defender is online)'));
            else if (r.offline.running === true) parts.push(T('pl.raid-window.lookup.offline.running', 'offline protection is running now'));
            else if (r.offline.startsInSeconds != null) parts.push(T('pl.raid-window.lookup.offline.startsIn', 'offline protection starts in {t}', { t: dur(r.offline.startsInSeconds) }));
          }
          out.textContent = parts.join(', ') + '.';
        }).catch(function (err) { out.textContent = why(err); });
      });
      return h('span', { class: 'rw-inline' }, [inp, btn, out]);
    }

    function renderSettings() {
      settingsBox.innerHTML = '';
      reapplyWarn = h('p', { class: 'rw-small rw-warn', hidden: true },
        T('pl.raid-window.warn.reapply', 'This is not shorter than the push, so protection can switch on between pushes.'));
      capHint = h('p', { class: 'rw-small' });

      var main = [
        row(T('pl.raid-window.set.enabled', 'Keep raids going when defenders log out'), toggle('enabled'),
          T('pl.raid-window.set.enabled.hint', 'Off stops all pushing. A push already made is left as it is.')),
        row(T('pl.raid-window.set.push', 'Push protection back by'), num('pushSeconds', 60, T('pl.raid-window.unit.minutes', 'minutes'), 1, 1440),
          T('pl.raid-window.set.push.hint', 'During raid damage, offline protection is set to start this long from now, again and again.')),
        row(T('pl.raid-window.set.hold', 'A raid is over after no damage for'), num('holdSeconds', 60, T('pl.raid-window.unit.minutes', 'minutes'), 1, 1440),
          T('pl.raid-window.set.hold.hint', 'After this long with no damage, pushing stops and protection starts as last set.')),
        row(T('pl.raid-window.set.countFromLastHit', 'Every hit restarts the countdown'), toggle('countFromLastHit'),
          T('pl.raid-window.set.countFromLastHit.hint', 'On: the wait restarts at every hit. Off: each push counts from the moment it is sent.')),
        row(T('pl.raid-window.set.minHits', 'Hits needed to count as a raid'), num('minHits', 1, T('pl.raid-window.unit.hits', 'hits'), 1, 1000),
          T('pl.raid-window.set.minHits.hint', 'Hits on one base before it counts as a raid. A destroyed part always counts.')),
      ];

      var extra = h('details', { class: 'rw-more' }, [h('summary', {}, T('pl.raid-window.moreOptions', 'More options')),
        row(T('pl.raid-window.set.reapply', 'Repeat the push every'), num('reapplySeconds', 60, T('pl.raid-window.unit.minutes', 'minutes'), 0.5, 1440),
          T('pl.raid-window.set.reapply.hint', 'How often the push repeats during a raid. Keep it shorter than the push.'), reapplyWarn),
        row(T('pl.raid-window.set.maxPushes', 'Most pushes for one raid'), num('maxPushesPerRaid', 1, T('pl.raid-window.unit.pushes', 'pushes'), 1, 1000),
          T('pl.raid-window.set.maxPushes.hint', 'A safety limit: after this many pushes in one raid, nothing more is pushed.'), capHint),
        row(T('pl.raid-window.set.duration', 'Protection length'), lengthControl(),
          T('pl.raid-window.set.duration.hint', 'Flag-specific protection only. Each base\'s own length gives players back exactly what they had.')),
        row(T('pl.raid-window.set.allowDecoded', 'If the save has no length, ask the running game'), toggle('allowDecodedDuration'),
          T('pl.raid-window.set.allowDecoded.hint', 'Flag-specific protection only, for a base the save has no length for. The game\'s figure is approximate.')),
        row(T('pl.raid-window.set.ownerAlerts', 'Base attack alerts keep a raid going'), toggle('useOwnerAlerts'),
          T('pl.raid-window.set.ownerAlerts.hint', 'Base attack alerts can keep a raid going, but never start one.')),
        row(T('pl.raid-window.set.acceptDeclared', 'Accept raids declared by other tools'), toggle('acceptDeclared'),
          T('pl.raid-window.set.acceptDeclared.hint', 'Lets other tools declare a raid without damage. Off: only real damage counts.')),
        row(T('pl.raid-window.set.resetCooldown', 'Clear the protection cooldown before each push'), toggle('resetCooldownFirst'),
          T('pl.raid-window.set.resetCooldown.hint', 'Flag-specific only. Buys the game\'s cooldown skip before each push, possibly charging an online player.')),
        row(T('pl.raid-window.set.poll', 'Look for raid damage every'), num('pollSeconds', 1, T('pl.raid-window.unit.seconds', 'seconds'), 5, 300),
          T('pl.raid-window.set.poll.hint', 'How often the plugin checks the bridge for new raid damage.')),
        row(T('pl.raid-window.set.exemptBases', 'Never touch these bases'), ids('exemptBaseIds'),
          T('pl.raid-window.set.exemptBases.hint', 'Base ids, separated by commas. Each base under raid shows its id below.')),
        row(T('pl.raid-window.set.exemptFlags', 'Never touch these flags'), ids('exemptFlagIds'),
          T('pl.raid-window.set.exemptFlags.hint', 'Flag ids, separated by commas. Each push below shows the flag it went to.')),
        row(T('pl.raid-window.set.checkFlag', 'Check a flag'), lookup(),
          T('pl.raid-window.set.checkFlag.hint', 'Shows what the save and the running game say about one flag\'s protection right now.')),
      ]);

      saveBtn = h('button', { type: 'button', onclick: save }, [icon('check'), T('pl.raid-window.save.button', 'Save')]);
      saveMsg = h('span', { class: 'rw-dirty' });
      settingsBox.appendChild(card('hourglass', T('pl.raid-window.card.settings', 'Settings'), main.concat([extra,
        h('div', { class: 'rw-save' }, [saveBtn, saveMsg])])));
      saveState();
      hints();
      renderFigs();
    }

    // ── live: the bases under raid, and what was pushed ─────────────────────────────────────────
    function closeBase(base) {
      api('/close', { method: 'POST', body: { base: base } }).then(function (r) {
        if (r && r.ok) { toast(T('pl.raid-window.stopped', 'Stopped pushing that base')); refresh(); }
        else if (r && r.code === 'not_open') toast(T('pl.raid-window.close.notOpen', 'That base has no open raid window here.'), 'error');
        else toast(sentence((r && r.reason) || T('pl.raid-window.notDone', 'that could not be done')), 'error');
      }).catch(function (err) { toast(why(err), 'error'); });
    }
    function badge(kind, text) { return h('span', { class: 'rw-badge ' + kind }, text); }

    function flagRow(f, base) {
      var v = f.lastVerdict || {};
      var meta = verdictOf(v.state);
      var said = meta[2] || codeText(v) || sentence(v.text || '');
      var detail = [];
      if (meta[2] && v.text) detail.push(h('p', {}, T('pl.raid-window.bridgeSaid', 'The bridge said: {text}', { text: sentence(v.text) })));
      if (f.before && f.before.mode === 'offline') {
        var o = f.before;
        detail.push(h('p', {}, o.armed === false
          ? T('pl.raid-window.before.offline.notArmed', 'Before the first push, offline protection was not armed: a defender was online.')
          : (o.running === true
            ? T('pl.raid-window.before.offline.running', 'Before the first push the base\'s offline protection was already on.')
            : (o.startsInSeconds != null
              ? T('pl.raid-window.before.offline.startsIn', 'Before the first push the base\'s offline protection was due to start in {t}.', { t: dur(o.startsInSeconds) })
              : T('pl.raid-window.before.offline.unreadable', 'Before the first push the base\'s offline protection could not be read.')))));
      } else if (f.before) {
        var b = f.before;
        var held = b.savedDurationSeconds == null ? T('pl.raid-window.before.held.unreadable', 'no readable length')
          : (b.savedDurationSeconds === 0 ? T('pl.raid-window.before.held.none', 'no length') : dur(b.savedDurationSeconds));
        detail.push(h('p', {}, b.liveDurationSeconds != null
          ? T('pl.raid-window.before.heldAndLive', 'Before the first push the save held {held}, and the running game said {live}.',
            { held: held, live: dur(b.liveDurationSeconds) })
          : T('pl.raid-window.before.held', 'Before the first push the save held {held}.', { held: held })));
      }
      return h('div', { class: 'rw-flag' }, [
        h('div', { class: 'rw-flag-head' }, [badge(meta[0], meta[1]),
          h('span', { class: 'rw-small' }, f.pushes
            ? (f.pushes === 1
              ? T('pl.raid-window.flag.pushedOne', 'Flag {flag}, pushed {n} time, last {ago}', { flag: f.flag, n: f.pushes, ago: ago(f.lastPushAt) })
              : T('pl.raid-window.flag.pushedMany', 'Flag {flag}, pushed {n} times, last {ago}', { flag: f.flag, n: f.pushes, ago: ago(f.lastPushAt) }))
            : T('pl.raid-window.flag.plain', 'Flag {flag}', { flag: f.flag }))]),
        said ? h('p', { class: 'rw-say' }, said) : null,
        detail.length ? h('details', { class: 'rw-detail', 'data-k': 'flag:' + base + ':' + f.flag }, [h('summary', {}, T('pl.raid-window.details', 'Details'))].concat(detail)) : null,
      ]);
    }

    /* The two live boxes are redrawn every ten seconds, and a redraw used to shut every
     * "Details" and "Show more" somebody had opened to read. Each fold carries a key, the open
     * ones are remembered across the redraw, and they come back open. */
    function openFolds() {
      var keep = {};
      [liveBox, histBox].forEach(function (box) {
        Array.prototype.forEach.call(box.querySelectorAll('details[data-k]'), function (d) {
          if (d.open) keep[d.getAttribute('data-k')] = true;
        });
      });
      return keep;
    }
    function reopenFolds(keep) {
      [liveBox, histBox].forEach(function (box) {
        Array.prototype.forEach.call(box.querySelectorAll('details[data-k]'), function (d) {
          if (keep[d.getAttribute('data-k')]) d.open = true;
        });
      });
    }

    function renderLive() {
      renderFigs();
      renderNotes();
      var keep = openFolds();
      liveBox.innerHTML = '';
      histBox.innerHTML = '';
      if (!status) return;

      var open = status.open || [];
      var kids = [];
      if (!open.length) kids.push(note('flat', T('pl.raid-window.live.none', 'No base is under raid now. One appears when a base takes raid damage.')));
      open.forEach(function (r) {
        var bits = [];
        if (r.lastHitAt) bits.push(T('pl.raid-window.live.lastHit', 'last hit {ago}', { ago: ago(r.lastHitAt) }));
        bits.push(r.hits === 1 ? T('pl.raid-window.live.hitOne', '{n} hit', { n: r.hits })
          : T('pl.raid-window.live.hitMany', '{n} hits', { n: r.hits }));
        if (r.destroyed) bits.push(T('pl.raid-window.live.destroyed', '{n} destroyed', { n: r.destroyed }));
        if (r.endsInSeconds != null) bits.push(T('pl.raid-window.live.stopsIn', 'stops in {t} if it stays quiet', { t: dur(r.endsInSeconds) }));
        var block = [
          h('div', { class: 'rw-base-head' }, [
            h('strong', {}, r.name || T('pl.raid-window.base.named', 'Base {id}', { id: r.base })),
            r.name ? h('span', { class: 'rw-small' }, T('pl.raid-window.base.id', 'base id {id}', { id: r.base })) : null,
            r.capped ? badge('wait', T('pl.raid-window.badge.capped', 'Limit reached')) : badge('on', T('pl.raid-window.badge.pushing', 'Pushing')),
            h('button', { type: 'button', class: 'secondary rw-stop', onclick: function () { closeBase(r.base); } },
              T('pl.raid-window.stopPushing', 'Stop pushing')),
          ]),
          h('p', { class: 'rw-small' }, cap(bits.join(' · '))),
        ];
        if (r.capped) block.push(note('wait', T('pl.raid-window.live.cappedNote', 'This raid reached "Most pushes for one raid". Nothing more is pushed until it ends.')));
        if (Array.isArray(r.knownFlags) && !r.knownFlags.length) block.push(note('flat', T('pl.raid-window.live.noFlag', 'This base has no flag, so there is no protection to push.')));
        (r.flags || []).forEach(function (f) { block.push(flagRow(f, r.base)); });
        kids.push(h('div', { class: 'rw-base' }, block));
      });
      liveBox.appendChild(card('shield', T('pl.raid-window.card.underRaid', 'Under raid now'), kids));

      var hist = status.history || [];
      var lines = hist.map(function (e) {
        var meta = verdictOf(e.state);
        var text = meta[2] || codeText(e) || sentence(e.text || '');
        if (e.state === 'moved' && e.mode === 'offline' && e.delaySeconds) {
          text = T('pl.raid-window.hist.offlineMoved', 'Offline protection now starts {t} after this push. Its length was not changed.', { t: dur(e.delaySeconds) });
        } else if (e.state === 'moved' && e.durationSeconds) {
          var src = sourceText(e.durationSource);
          text = src
            ? T('pl.raid-window.hist.movedSource', 'Protection pushed back by {delay}. Length {len} ({source}).',
              { delay: dur(e.delaySeconds), len: dur(e.durationSeconds), source: src })
            : T('pl.raid-window.hist.moved', 'Protection pushed back by {delay}. Length {len}.',
              { delay: dur(e.delaySeconds), len: dur(e.durationSeconds) });
        }
        var who = e.baseName || T('pl.raid-window.base.named', 'Base {id}', { id: e.base });
        if (e.flag) who = T('pl.raid-window.hist.whoFlag', '{who}, flag {flag}', { who: who, flag: e.flag });
        return h('div', { class: 'rw-h' }, [
          badge(meta[0], meta[1]),
          h('span', { class: 'rw-small' }, ago(e.at)),
          h('span', { class: 'rw-h-who' }, who),
          h('span', { class: 'rw-h-t' }, text),
        ]);
      });
      var hk = [];
      if (!lines.length) hk.push(note('flat', T('pl.raid-window.hist.none', 'Nothing pushed yet. Every push and every finished raid is listed here.')));
      else {
        lines.slice(0, 10).forEach(function (l) { hk.push(l); });
        if (lines.length > 10) {
          hk.push(h('details', { class: 'rw-more', 'data-k': 'hist-more' }, [h('summary', {},
            T('pl.raid-window.hist.showMore', 'Show {n} more', { n: lines.length - 10 }))].concat(lines.slice(10))));
        }
        hk.push(h('div', { class: 'rw-actions' }, [h('button', {
          type: 'button', class: 'secondary', onclick: function () {
            api('/clear-history', { method: 'POST', body: {} }).then(function () { toast(T('pl.raid-window.hist.cleared', 'List cleared')); refresh(); })
              .catch(function (err) { toast(why(err), 'error'); });
          },
        }, T('pl.raid-window.hist.clear', 'Clear the list'))]));
      }
      histBox.appendChild(card('list', T('pl.raid-window.card.recent', 'Recent activity'), hk));
      reopenFolds(keep);
    }

    load();
  }

  SSA.ready(function () {
    SSA.registerTab({ id: PLUGIN, label: T('pl.raid-window.tab', 'Raid Window'), icon: '#i-hourglass', premium: true, render: editor });
  });
}());
