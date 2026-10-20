/* Raid Window — admin tab.
 *
 * Four screens, named once in `navLabels()`: Raids (the bases under raid now, what is due next and
 * the raids that ended), Protection (what counts as a raid, how protection is held back, the bases
 * and flags never to touch), Activity (everything the plugin did, with the reason for every refusal)
 * and Settings (the master switch, how often it looks, the Bridge box and the flag check). Above them
 * a lead line, a first-run note and a stat header that says when it needs a running game.
 *
 * Every setting is editable with the server stopped. The live half only adds to the page, and a poll
 * patches only the cards whose content changed, so nothing half typed is redrawn away. Talks only to
 * its own backend, plus the manager's own route for turning bridge switches on.
 *
 * Every word on this screen goes through the panel's translator, with the English written beside the
 * key: a language nobody has translated yet renders exactly what it renders today. */
(function () {
  'use strict';

  var PLUGIN = 'raid-window';
  var T = SSA.t;
  /* WHERE THE BRIDGE'S SETTINGS REALLY ARE, IN THE PANEL'S OWN WORDS.
   *
   * Three sentences here used to send an owner to "Settings → Bridge", and that menu entry has
   * never existed: the bridge's module cards live under Plugins on a tab called SSA Bridge. Both
   * halves are looked up in the PANEL's dictionary, `nav.plugins` and `plugins.viewInGame` being the
   * keys the nav and the tab strip render themselves from, so the sentence stays right in every
   * language and on the day somebody renames that tab. The locale files carry `{where}` only. */
  function bridgeWhere() {
    return T('nav.plugins', 'Plugins') + ' → ' + T('plugins.viewInGame', 'SSA Bridge');
  }
  var DEF = {
    enabled: true, pollSeconds: 20, pushSeconds: 3600, reapplySeconds: 600, holdSeconds: 3600,
    minHits: 3, destroyedOpens: true, acceptDeclared: false, useOwnerAlerts: true, resetCooldownFirst: false,
    durationSeconds: null, allowDecodedDuration: true, maxPushesPerRaid: 24, countFromLastHit: false,
    exemptBaseIds: [], exemptFlagIds: [],
  };

  // The manager's own client: a 404, a dead backend and an expired session reject with words in
  // them instead of resolving to `{}`, which every list below would draw as "nothing is happening".
  var api = SSA.apiClient();
  function why(err) { return SSA.apiError(err); }
  // An address for each screen (`#plugins/p/raid-window/activity`) on a manager that has one. An
  // older manager draws the same screens with no address; nothing else depends on it.
  var route = (SSA.route && typeof SSA.route.client === 'function') ? SSA.route.client() : null;

  /* THE FOUR SCREEN NAMES, IN ONE PLACE. The nav buttons, the first-run note and every sentence that
   * sends an owner to a screen read the SAME key, so the route in a sentence cannot drift from the
   * button it names, in any language. */
  function navLabels() {
    return {
      raids: T('pl.raid-window.nav.raids', 'Raids'),
      protect: T('pl.raid-window.nav.protect', 'Protection'),
      activity: T('pl.raid-window.nav.activity', 'Activity'),
      settings: T('pl.raid-window.nav.settings', 'Settings'),
    };
  }
  var VIEWS = ['raids', 'protect', 'activity', 'settings'];
  var VIEW_ICON = { raids: 'shield', protect: 'base', activity: 'pulse', settings: 'sliders' };

  /** The row's label is the control's NAME too: a dropdown reading only its value says nothing
   *  about what it chooses to a screen reader. */
  function nameCtl(ctl, label) {
    if (typeof label !== 'string' || !label || !ctl || !ctl.tagName) return;
    var f = /^(SELECT|INPUT|TEXTAREA)$/.test(ctl.tagName) ? ctl : (ctl.querySelector ? ctl.querySelector('select, input') : null);
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
  function confirmAsk(text, okLabel) {
    return Promise.resolve(SSA.confirm ? SSA.confirm(text, okLabel ? { okLabel: okLabel } : {}) : false);
  }

  // ── the clock ─────────────────────────────────────────────────────────────────────────────────
  //
  // The backend sends its own `now` with every answer, and "ago" and "in" are measured from THAT, so
  // a browser clock minutes off does not move a countdown. `skew` is server minus browser.
  var skew = 0;
  function serverNow() { return Date.now() + skew; }
  function takeClock(answer) {
    var n = answer && Number(answer.now);
    if (isFinite(n) && n > 0) skew = n - Date.now();
  }

  /* A length of time in words. Minutes are rounded BEFORE hours are split off: rounding the
   * remainder alone printed 7170 s as "1 h 60 min" and 3599 s as "60 min". */
  function dur(n) {
    if (n == null || !isFinite(n)) return '';
    n = Math.max(0, Math.round(n));
    if (n < 60) return T('pl.raid-window.dur.seconds', '{n} s', { n: n });
    var mins = Math.round(n / 60);
    if (mins < 60) return T('pl.raid-window.dur.minutes', '{n} min', { n: mins });
    var hh = Math.floor(mins / 60), mm = mins % 60;
    if (hh < 48) {
      return mm ? T('pl.raid-window.dur.hoursMinutes', '{h} h {m} min', { h: hh, m: mm })
        : T('pl.raid-window.dur.hours', '{h} h', { h: hh });
    }
    return T('pl.raid-window.dur.hours', '{h} h', { h: Math.round(n / 3600) });
  }
  function ago(ms) { return ms ? T('pl.raid-window.ago', '{t} ago', { t: dur((serverNow() - ms) / 1000) }) : ''; }
  function inTime(ms) { return T('pl.raid-window.inTime', 'in {t}', { t: dur((ms - serverNow()) / 1000) }); }

  function lang() { try { return (SSA.lang && SSA.lang()) || undefined; } catch (e) { return undefined; } }
  /** The calendar day an instant falls on, in a time zone (the reader's own when none is given). */
  function dayKey(ms, tz) {
    try {
      // `timeZone: undefined` is the reader's own zone.
      var p = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz || undefined })
        .formatToParts(new Date(ms));
      var get = function (t) { for (var i = 0; i < p.length; i++) if (p[i].type === t) return p[i].value; return ''; };
      return get('year') + '-' + get('month') + '-' + get('day');
    } catch (e) { var d = new Date(ms); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  }
  /* "Yesterday" is the calendar day before today, found by asking which day 12, 24 and 36 hours ago
   * fell on. Subtracting one day of milliseconds is not that: on the night the clocks go back the day
   * is 25 hours long, and on the night they go forward 23, so a fixed 24 h lands on today or skips
   * a whole day. */
  function yesterdayKey(now, tz) {
    var today = dayKey(now, tz);
    var hrs = [12, 24, 36];
    for (var i = 0; i < hrs.length; i++) {
      var k = dayKey(now - hrs[i] * 3600000, tz);
      if (k !== today) return k;
    }
    return dayKey(now - 86400000, tz);
  }
  /** When something happened, in the reader's clock: the time today, "yesterday" and the time, or
   *  the date and the time. `tz` is for the check; the tab passes none and gets the reader's zone. */
  function fmtWhen(ms, now, tz) {
    if (!ms) return '';
    var zone = tz || undefined;
    var d = new Date(ms);
    var time, full;
    try {
      time = d.toLocaleTimeString(lang(), { hour: '2-digit', minute: '2-digit', timeZone: zone });
      full = d.toLocaleString(lang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: zone });
    } catch (e) { time = d.toLocaleTimeString(); full = d.toLocaleString(); }
    var k = dayKey(ms, tz);
    if (k === dayKey(now, tz)) return time;
    if (k === yesterdayKey(now, tz)) {
      // The browser's own word for "yesterday", in the reader's language, so no locale file carries one.
      var word = null;
      try { word = (typeof Intl.RelativeTimeFormat === 'function') ? new Intl.RelativeTimeFormat(lang(), { numeric: 'auto' }).format(-1, 'day') : null; }
      catch (e) { word = null; }
      return word ? word + ' ' + time : full;
    }
    return full;
  }
  /** The reader's time zone, named: "Europe/Prague (UTC+2)". */
  function zoneText() {
    var name = '';
    try { name = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { name = ''; }
    var m = -new Date().getTimezoneOffset();
    var sign = m >= 0 ? '+' : '-';
    m = Math.abs(m);
    var off = 'UTC' + sign + Math.floor(m / 60) + (m % 60 ? ':' + (m % 60 < 10 ? '0' : '') + (m % 60) : '');
    return name ? name + ' (' + off + ')' : off;
  }

  // Where a protection length came from, in words.
  function sourceText(k) {
    if (k === 'configured') return T('pl.raid-window.source.configured', 'your fixed length');
    if (k === 'saved') return T('pl.raid-window.source.saved', 'from the save');
    if (k === 'decoded') return T('pl.raid-window.source.decoded', 'from the running game');
    return null;
  }

  // What each outcome means, in words. "No change" is the one that matters: the game took the push
  // and the base did not move, which is not a success and must never read as one.
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
      opened: ['on', T('pl.raid-window.verdict.opened', 'Raid seen'), null],
      resumed: ['good', T('pl.raid-window.verdict.resumed', 'Resumed'), null],
      exempt: ['flat', T('pl.raid-window.verdict.exempt', 'Left alone'), null],
      noflag: ['flat', T('pl.raid-window.verdict.noflag', 'No flag'), null],
      blocked: ['bad', T('pl.raid-window.verdict.blocked', 'Blocked'), null],
    };
  }
  function verdictOf(state) {
    return verdicts()[state] || ['flat', T('pl.raid-window.verdict.waiting', 'Waiting'), null];
  }

  /* THE BACKEND SENDS CODES, AND THE WORDS ARE MADE HERE. Its English `text` is kept only for a code
   * this tab does not know (an older or newer backend) and for the bridge's own refusal, which is the
   * bridge's words and shown as they are. */
  function fixedLengthHint() {
    return T('pl.raid-window.why.setFixedOn', 'To push it anyway, set a fixed protection length on {screen}.',
      { screen: navLabels().protect });
  }
  /** A source that could not answer: `{ code, module, text }`. */
  function whyText(n) {
    if (!n) return '';
    var mod = n.module || '';
    if (n.code === 'module_off') return T('pl.raid-window.why.moduleOffOn', 'The bridge\'s {module} module is switched off. The Bridge box on {screen} turns it on.',
      { module: mod, screen: navLabels().settings });
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
    if (/^mode_/.test(v.code)) {
      return T('pl.raid-window.why.blockedMode', 'Nothing is pushed while this lasts.') + ' '
        + modeText({ code: v.code.slice(5), cls: p.cls, cause: p.cause, text: v.text });
    }
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
        return sentence(v.text || '') + ' ' + T('pl.raid-window.why.rangeOn',
          'Raise "{setting}"{limit} on the {module} card in {where}, or set a shorter fixed length on {screen}.',
          { setting: p.setting || '', limit: p.limit != null ? ' (' + p.limit + ')' : '', module: p.module || '', where: bridgeWhere(),
            screen: navLabels().protect });
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
      case 'admin_resumed':
        return T('pl.raid-window.why.adminResumed', 'Pushing started again by an admin.');
      case 'capped':
        return T('pl.raid-window.why.capped', 'Pushed {n} times, the most "{setting}" allows. Nothing more is pushed until the raid ends.',
          { n: p.pushes, setting: T('pl.raid-window.set.maxPushes', 'Most pushes for one raid') });
      case 'opened':
        return T('pl.raid-window.why.opened', 'Raid damage seen (hits: {hits}, destroyed: {destroyed}). Protection is kept from starting while it lasts.',
          { hits: p.hits || 0, destroyed: p.destroyed || 0 });
      case 'exempt_base':
        return T('pl.raid-window.why.exemptBase', 'Raid damage on a base set to never be touched, so nothing was pushed.');
      case 'exempt_flag':
        return T('pl.raid-window.why.exemptFlag', 'This flag is set to never be touched, so it was not pushed.');
      case 'no_flag':
        return T('pl.raid-window.why.noFlag', 'This base has no flag, so it has no protection to push.');
      case 'save_unreadable':
        return T('pl.raid-window.why.blockedSave', 'The save could not be read, so no flag could be found. Nothing is pushed while this lasts.');
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
      case 'destroyedOpens': return T('pl.raid-window.set.destroyedOpens', 'A destroyed building part counts as a raid');
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
  /** What a bridge switch is FOR, in the reader's language. The backend's English is the fallback. */
  function forWhatText(x) {
    switch (x.module + '.' + x.key) {
      case 'raid.enabled': return T('pl.raid-window.bridge.for.raid', 'Seeing raid damage');
      case 'protect.enabled': return T('pl.raid-window.bridge.for.protect', 'Pushing protection back');
      case 'protect.postpone': return T('pl.raid-window.bridge.for.postpone', 'Pushing offline protection back');
      case 'protect.set': return T('pl.raid-window.bridge.for.set', 'Pushing flag protection back');
      case 'protect.reset': return T('pl.raid-window.bridge.for.reset', 'Clearing the cooldown first');
    }
    return x.forWhat || x.key;
  }
  /** Which kind of line a feed entry is, for the Activity filter. */
  function kindOf(e) {
    var s = e && e.state;
    if (s === 'opened' || s === 'closed' || s === 'resumed' || s === 'capped') return 'windows';
    if (s === 'moved' || s === 'unchanged' || s === 'later' || s === 'unconfirmed') return 'pushes';
    return 'refusals';
  }

  // One poll timer for the whole tab, however often it is opened.
  var timer = null;
  var active = null;

  function editor(el) {
    var cfg = null;          // the working copy the forms edit
    var saved = null;        // what the backend last said is stored
    var status = null;
    var statusErr = null;
    var bridge = null;
    var feed = null;         // the whole feed, for Activity
    var feedErr = null;
    var names = { bases: {}, flags: {}, readable: null };
    var tick = 0;
    var view = 'raids';
    var actKind = 'all';
    var ticks = { exemptBaseIds: {}, exemptFlagIds: {} };   // bulk ticks, read at the press
    var keepFolds = {};

    el.innerHTML = '';
    var root = h('div', { class: 'rw' });
    el.appendChild(root);
    root.appendChild(h('p', { class: 'rw-lead' },
      T('pl.raid-window.lead',
        'While a base takes raid damage, this keeps pushing its offline protection back.')));
    var firstRun = h('div', { class: 'rw-firstrun' });
    var nav = h('div', { class: 'rw-nav', role: 'tablist' });
    var dirtyTag = h('span', { class: 'rw-dirty' });
    var top = h('div', { class: 'rw-top' }, [nav, dirtyTag]);
    var figs = h('div', { class: 'rw-figs' });
    var figNote = h('div', { class: 'rw-notes' });
    var body = h('div', { class: 'rw-view' });
    [firstRun, top, figs, figNote, body].forEach(function (x) { root.appendChild(x); });
    body.appendChild(h('p', { class: 'rw-empty' }, T('pl.raid-window.loading', 'Loading…')));

    // ── the screens ───────────────────────────────────────────────────────────────────────────────
    function viewFromRoute() {
      var s = route ? String(route.get() || '').split('/')[0] : '';
      return VIEWS.indexOf(s) >= 0 ? s : null;
    }
    view = viewFromRoute() || 'raids';
    if (route) route.onChange(function () { var v = viewFromRoute() || 'raids'; if (v !== view) { view = v; paintNav(); render(); } });

    function go(v) {
      if (VIEWS.indexOf(v) < 0 || v === view) return;
      view = v;
      if (route) route.go(v === 'raids' ? '' : v);
      paintNav();
      render();
      if (v === 'activity') loadFeed();
      if (v === 'protect') loadNames();
    }
    function paintNav() {
      nav.innerHTML = '';
      var L = navLabels();
      VIEWS.forEach(function (v) {
        nav.appendChild(h('button', {
          type: 'button', class: 'rw-tab' + (view === v ? ' active' : ''), role: 'tab',
          'aria-selected': view === v ? 'true' : 'false', 'data-view': v,
          onclick: function () { go(v); },
        }, [icon(VIEW_ICON[v]), h('span', {}, L[v])]));
      });
    }

    function load() {
      Promise.all([api('/config'), api('/status')]).then(function (r) {
        saved = Object.assign({}, DEF, r[0] || {});
        cfg = JSON.parse(JSON.stringify(saved));
        status = r[1] || null;
        takeClock(status);
        paintNav();
        render();
        refreshBridge();
        bindTimer();
        if (view === 'activity') loadFeed();
        if (view === 'protect') loadNames();
      }).catch(function (err) {
        body.innerHTML = '';
        body.appendChild(h('div', { class: 'rw-note bad' }, [
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
        // Nobody is looking: the browser tab is hidden, or the panel has switched to another screen
        // (the tab is still in the document then, only not drawn, so it has no box).
        if (document.hidden || !el.getClientRects().length) return;
        refresh();
      }, 10000);
    }
    function refresh() {
      tick++;
      api('/status').then(function (s) { statusErr = null; status = s || status; takeClock(status); live(); })
        .catch(function (err) { statusErr = why(err); renderHead(); });
      if (view === 'activity') loadFeed();
      if (tick % 6 === 0) refreshBridge();
    }
    /** What a poll redraws: the head, and the screen only where it shows live data. */
    function live() {
      renderHead();
      if (view === 'raids') renderRaids();
      else if (view === 'settings') renderBridge();
    }

    // ── head: first-run note, stat header ───────────────────────────────────────────────────────
    function renderFirstRun() {
      var kids = [];
      var empty = status && !(status.open || []).length && !(status.recent || []).length && !(status.historyTotal || (status.history || []).length);
      if (empty) {
        var L = navLabels();
        kids.push(h('div', { class: 'rw-note flat' }, [
          h('strong', {}, T('pl.raid-window.first.title', 'New here? ')),
          T('pl.raid-window.first.settings', 'On {screen}, the Bridge box lists what to switch on.', { screen: L.settings }) + ' ',
          T('pl.raid-window.first.protect', 'On {screen}, choose how long a raid holds protection back.', { screen: L.protect }) + ' ',
          T('pl.raid-window.first.activity', '{screen} then lists everything the plugin does.', { screen: L.activity }),
        ]));
      }
      swap(firstRun, kids);
    }
    function fig(cls, value, label) {
      // A number and its unit ("24 h") are one value: the space between them must not break a line.
      return h('div', { class: 'rw-fig' + (cls ? ' ' + cls : '') }, [h('b', {}, String(value)),
        h('span', {}, String(label).replace(/(\d) (?=\S)/g, '$1 '))]);
    }
    function renderHead() {
      renderFirstRun();
      if (!cfg) return;
      var on = status ? status.enabled !== false : cfg.enabled;
      var open = status ? (status.open || []).length : 0;
      var day = (status && status.day) || { pushes: 0, refusals: 0, full: false };
      var plus = day.full ? '+' : '';
      var next = status && status.enabled !== false && status.nextPassAt
        ? (status.nextPassAt <= serverNow() ? T('pl.raid-window.fig.now', 'now') : dur((status.nextPassAt - serverNow()) / 1000))
        : T('pl.raid-window.fig.never', '—');
      swap(figs, [
        fig(on ? 'good' : '', on ? T('pl.raid-window.fig.on', 'On') : T('pl.raid-window.fig.off', 'Off'), T('pl.raid-window.fig.plugin', 'plugin')),
        fig(open ? 'wait' : '', open, T('pl.raid-window.fig.underRaidNow', 'under raid now')),
        fig('', day.pushes + plus, T('pl.raid-window.fig.pushesDay', 'pushes, 24 h')),
        fig(day.refusals ? 'bad' : '', day.refusals + plus, T('pl.raid-window.fig.refusedDay', 'refused, 24 h')),
        fig('', next, T('pl.raid-window.fig.nextLook', 'next look')),
      ]);
      var notes = [];
      // Everything on the four screens can be set with the server stopped; only the figures above,
      // the raid list and Activity wait for a running game. Said out loud, because zeroes and an
      // empty list otherwise read as "it has not started working yet".
      if (status && status.serverRunning === false && status.save !== 'unreadable') {
        notes.push(h('div', { class: 'rw-note flat' }, [
          h('strong', {}, T('pl.raid-window.stat.stoppedTitle', 'The server is not running. ')),
          T('pl.raid-window.stat.stoppedText', 'Everything here can be set now. Raids, pushes and these figures need a running game.'),
        ]));
      }
      if (statusErr) {
        notes.push(h('div', { class: 'rw-note bad' }, [
          h('strong', {}, T('pl.raid-window.stat.errTitle', 'These figures have stopped updating. ')), statusErr,
        ]));
      }
      swap(figNote, notes);
      dirtyTag.textContent = isDirty() ? T('pl.raid-window.save.unsaved', 'Unsaved changes') : '';
      dirtyTag.className = 'rw-dirty' + (isDirty() ? ' unsaved' : '');
    }

    /* A redraw that keeps what did not change. Each child is compared with the one already there by
     * its markup, and only a different one is replaced, so an open "Details", a focused button and
     * the node an owner is reading all survive a poll that changed nothing about them. */
    function swap(box, kids) {
      var have = Array.prototype.slice.call(box.childNodes);
      kids = kids.filter(Boolean);
      for (var i = 0; i < kids.length; i++) {
        var cur = have[i];
        if (cur && cur.nodeType === 1 && cur.outerHTML === sigOf(kids[i])) continue;
        if (cur) box.replaceChild(kids[i], cur); else box.appendChild(kids[i]);
        reopen(kids[i]);
      }
      for (var j = kids.length; j < have.length; j++) if (have[j].parentNode === box) box.removeChild(have[j]);
    }
    function sigOf(n) { return n && n.outerHTML; }
    function noteFolds(box) {
      Array.prototype.forEach.call(box.querySelectorAll('details[data-k]'), function (d) {
        keepFolds[d.getAttribute('data-k')] = d.open;
      });
    }
    function reopen(n) {
      if (!n || !n.querySelectorAll) return;
      var list = n.matches && n.matches('details[data-k]') ? [n] : [];
      list = list.concat(Array.prototype.slice.call(n.querySelectorAll('details[data-k]')));
      list.forEach(function (d) { if (keepFolds[d.getAttribute('data-k')]) d.open = true; });
      list.forEach(function (d) { d.addEventListener('toggle', function () { keepFolds[d.getAttribute('data-k')] = d.open; }); });
    }

    // ── little parts ──────────────────────────────────────────────────────────────────────────────
    function note(kind, kids) { return h('div', { class: 'rw-note ' + (kind || 'flat') }, kids); }
    function card(ico, title, kids, key, sub) {
      return h('section', { class: 'card rw-card', 'data-card': key || null }, [h('h3', {}, [icon(ico), title]),
        sub ? h('p', { class: 'rw-card-sub' }, sub) : null].concat(kids));
    }
    function badge(kind, text) { return h('span', { class: 'rw-badge ' + kind }, text); }
    function baseLabel(id, name) { return name || T('pl.raid-window.base.named', 'Base {id}', { id: id }); }

    // ── settings controls ─────────────────────────────────────────────────────────────────────────
    function isDirty() { return !!(cfg && saved && JSON.stringify(cfg) !== JSON.stringify(saved)); }
    function changed() { renderHead(); saveState(); }
    function toggle(key) {
      var b = h('input', { type: 'checkbox' });
      b.checked = cfg[key] === true;
      b.addEventListener('change', function () { cfg[key] = b.checked; changed(); hints(); });
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
    function sub(title) { return h('h4', { class: 'rw-sub' }, title); }

    var saveMsg = null, saveBtn = null, reapplyWarn = null, capHint = null;
    function saveState() {
      if (!saveMsg) return;
      var d = isDirty();
      saveMsg.textContent = d ? T('pl.raid-window.save.unsaved', 'Unsaved changes') : T('pl.raid-window.save.allSaved', 'All changes saved');
      saveMsg.className = 'rw-dirty' + (d ? ' unsaved' : '');
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
    function saveBar() {
      saveBtn = h('button', { type: 'button', onclick: function () { save(); } }, [icon('check'), T('pl.raid-window.save.button', 'Save')]);
      saveMsg = h('span', { class: 'rw-dirty' });
      var undo = h('button', { type: 'button', class: 'secondary', onclick: function () {
        cfg = JSON.parse(JSON.stringify(saved));
        render();
      } }, [icon('refresh'), T('pl.raid-window.save.undo', 'Undo changes')]);
      var bar = h('div', { class: 'rw-save' }, [saveBtn, undo, saveMsg]);
      setTimeout(saveState, 0);
      return bar;
    }

    /** Store `body` (the whole working copy, or one key of it). `then` runs on success. */
    function save(body, then) {
      var whole = !body;
      if (saveBtn && whole) saveBtn.disabled = true;
      if (saveMsg && whole) saveMsg.textContent = T('pl.raid-window.save.saving', 'Saving…');
      return api('/config', { method: 'POST', body: body || cfg }).then(function (r) {
        if (saveBtn) saveBtn.disabled = false;
        if (r && r.ok) {
          saved = Object.assign({}, DEF, r.config || saved);
          if (whole) cfg = JSON.parse(JSON.stringify(saved));
          else Object.keys(body).forEach(function (k) { cfg[k] = JSON.parse(JSON.stringify(saved[k])); });
          var ignored = (r.ignored && r.ignored.length)
            ? T('pl.raid-window.save.notKept', ' (not kept: {list})', { list: r.ignored.join(', ') }) : '';
          toast(T('pl.raid-window.save.saved', 'Saved') + ignored);
          if (then) then();
          render();
          refreshBridge();
          api('/status').then(function (s) { status = s || status; takeClock(status); live(); }).catch(function () {});
          return true;
        }
        var w = (r && Array.isArray(r.invalid) && r.invalid.length)
          ? r.invalid.map(invalidText).join(' ')
          : sentence((r && (r.reason || r.error)) || T('pl.raid-window.save.noReason', 'the manager did not say why'));
        var msg = T('pl.raid-window.save.notSaved', 'Not saved. {why}', { why: w });
        if (saveMsg) { saveMsg.textContent = msg; saveMsg.className = 'rw-dirty unsaved'; }
        toast(msg, 'error');
        return false;
      }).catch(function (err) {
        if (saveBtn) saveBtn.disabled = false;
        var msg = T('pl.raid-window.save.notSaved', 'Not saved. {why}', { why: why(err) });
        if (saveMsg) { saveMsg.textContent = msg; saveMsg.className = 'rw-dirty unsaved'; }
        toast(msg, 'error');
        return false;
      });
    }

    // ── render ────────────────────────────────────────────────────────────────────────────────────
    function render() {
      if (!cfg) return;
      saveMsg = null; saveBtn = null; reapplyWarn = null; capHint = null;
      noteFolds(body);
      body.innerHTML = '';
      body.setAttribute('data-view', view);
      renderHead();
      if (view === 'raids') { raidsBox = h('div', { class: 'rw-stack' }); body.appendChild(raidsBox); renderRaids(); }
      else if (view === 'protect') renderProtect();
      else if (view === 'activity') renderActivity();
      else renderSettings();
    }

    // ── Raids ─────────────────────────────────────────────────────────────────────────────────────
    var raidsBox = null;
    function noteList() {
      var out = [];
      if (!status) return out;
      var L = navLabels();
      if (status.enabled === false) {
        out.push(note('flat', T('pl.raid-window.note.offOn',
          'The plugin is switched off, so nothing is pushed. Turn on "{setting}" on {screen}.',
          { setting: labelOf('enabled'), screen: L.settings })));
        return out;
      }
      var saveUnreadable = status.save === 'unreadable';
      if (saveUnreadable) {
        out.push(note('wait', [T('pl.raid-window.note.saveUnreadable', 'The save cannot be read right now (the server is stopping, starting or restarting).'),
          T('pl.raid-window.note.stillPushed', ' A raid that is already being pushed is not ended because of this.')]));
      }
      if (status.idle && (status.idle.code || status.idle.text)) {
        var idleSaid = status.idle.code === 'nobody_online'
          ? T('pl.raid-window.idle.nobodyOnline', 'nobody is online, so nobody can be raiding. It starts again when somebody connects.')
          : sentence(status.idle.text || '');
        out.push(note('flat', [h('strong', {}, T('pl.raid-window.note.idle', 'Not looking right now: ')), idleSaid]));
        return out;
      }
      var n = status.notes || {};
      if (n.mode && (n.mode.code || n.mode.text)) {
        out.push(note('wait', [h('strong', {}, T('pl.raid-window.note.nothingPushed', 'Nothing is pushed: ')), modeText(n.mode)]));
      }
      [['raid', T('pl.raid-window.note.raidDamage', 'Raid damage')],
        ['protect', T('pl.raid-window.note.protection', 'Protection')],
        ['db', T('pl.raid-window.note.gameDatabase', 'Game database')]].forEach(function (k) {
        var one = n[k[0]];
        if (!one || !(one.code || one.text)) return;
        if (k[0] === 'db' && saveUnreadable) return;            // said once, above
        var said = whyText(one);
        if (!said) return;
        out.push(note('wait', [h('strong', {}, k[1] + ': '), said,
          T('pl.raid-window.note.stillPushed', ' A raid that is already being pushed is not ended because of this.')]));
      });
      // Something the bridge needs is off: the box that turns it on is on Settings, so say where.
      if (bridge && Array.isArray(bridge.items) && bridge.items.some(function (x) { return x.state === 'off' || x.state === 'missing'; })) {
        out.push(note('wait', [T('pl.raid-window.note.bridgeOff', 'Something this plugin needs is off in the SSA Bridge.') + ' ',
          h('button', { type: 'button', class: 'secondary rw-link', onclick: function () { go('settings'); } },
            T('pl.raid-window.note.openScreen', 'Open {screen}', { screen: L.settings }))]));
      }
      return out;
    }

    function closeBase(base) {
      api('/close', { method: 'POST', body: { base: base } }).then(function (r) {
        if (r && r.ok) { toast(T('pl.raid-window.stopped', 'Stopped pushing that base')); refresh(); }
        else if (r && r.code === 'not_open') toast(T('pl.raid-window.close.notOpen', 'That base has no open raid window here.'), 'error');
        else toast(sentence((r && r.reason) || T('pl.raid-window.notDone', 'that could not be done')), 'error');
      }).catch(function (err) { toast(why(err), 'error'); });
    }
    function resumeBase(base) {
      api('/resume', { method: 'POST', body: { base: base } }).then(function (r) {
        if (r && r.ok) { toast(T('pl.raid-window.resumed', 'Pushing that base again')); refresh(); }
        else if (r && r.code === 'not_resumable') toast(T('pl.raid-window.resume.notLive', 'That raid is over, so there is nothing to resume.'), 'error');
        else toast(sentence((r && r.reason) || T('pl.raid-window.notDone', 'that could not be done')), 'error');
      }).catch(function (err) { toast(why(err), 'error'); });
    }
    function neverTouch(base, name) {
      confirmAsk(T('pl.raid-window.never.confirm', 'Never touch {base} again?\n\nIts raids are then left alone. You can undo this on {screen}.',
        { base: baseLabel(base, name), screen: navLabels().protect }), T('pl.raid-window.never.ok', 'Never touch it')).then(function (yes) {
        if (!yes) return;
        var list = (saved.exemptBaseIds || []).slice();
        if (list.indexOf(base) < 0) list.push(base);
        save({ exemptBaseIds: list });
      });
    }

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
        h('div', { class: 'rw-flag-head' }, [f.exempt ? badge('flat', T('pl.raid-window.verdict.exempt', 'Left alone')) : badge(meta[0], meta[1]),
          h('span', { class: 'rw-small' }, f.pushes
            ? (f.pushes === 1
              ? T('pl.raid-window.flag.pushedOne', 'Flag {flag}, pushed {n} time, last {ago}', { flag: f.flag, n: f.pushes, ago: ago(f.lastPushAt) })
              : T('pl.raid-window.flag.pushedMany', 'Flag {flag}, pushed {n} times, last {ago}', { flag: f.flag, n: f.pushes, ago: ago(f.lastPushAt) }))
            : T('pl.raid-window.flag.plain', 'Flag {flag}', { flag: f.flag }))]),
        said ? h('p', { class: 'rw-say' }, said) : null,
        detail.length ? h('details', { class: 'rw-detail', 'data-k': 'flag:' + base + ':' + f.flag }, [h('summary', {}, T('pl.raid-window.details', 'Details'))].concat(detail)) : null,
      ]);
    }

    function openCard() {
      var open = (status && status.open) || [];
      var kids = [];
      if (!open.length) kids.push(note('flat', T('pl.raid-window.live.none', 'No base is under raid now. One appears when a base takes raid damage.')));
      open.forEach(function (r) {
        var bits = [];
        if (r.lastHitAt) bits.push(T('pl.raid-window.live.lastHit', 'last hit {ago}', { ago: ago(r.lastHitAt) }));
        bits.push(r.hits === 1 ? T('pl.raid-window.live.hitOne', '{n} hit', { n: r.hits })
          : T('pl.raid-window.live.hitMany', '{n} hits', { n: r.hits || 0 }));
        if (r.destroyed) bits.push(T('pl.raid-window.live.destroyed', '{n} destroyed', { n: r.destroyed }));
        if (r.endsInSeconds != null) bits.push(T('pl.raid-window.live.stopsIn', 'stops in {t} if it stays quiet', { t: dur(r.endsInSeconds) }));
        var state = r.exempt ? badge('flat', T('pl.raid-window.badge.exempt', 'Never touched'))
          : (r.capped ? badge('wait', T('pl.raid-window.badge.capped', 'Limit reached')) : badge('on', T('pl.raid-window.badge.pushing', 'Pushing')));
        var block = [
          h('div', { class: 'rw-base-head' }, [
            h('strong', {}, baseLabel(r.base, r.name)),
            r.name ? h('span', { class: 'rw-small' }, T('pl.raid-window.base.id', 'base id {id}', { id: r.base })) : null,
            state,
            h('span', { class: 'rw-base-acts' }, [
              r.exempt ? null : h('button', { type: 'button', class: 'secondary', onclick: function () { neverTouch(r.base, r.name); } },
                T('pl.raid-window.never.button', 'Never touch')),
              h('button', { type: 'button', class: 'secondary rw-stop', onclick: function () { closeBase(r.base); } },
                T('pl.raid-window.stopPushing', 'Stop pushing')),
            ]),
          ]),
          h('p', { class: 'rw-small' }, cap(bits.join(' · '))),
        ];
        if (r.exempt) block.push(note('flat', T('pl.raid-window.live.exemptNote', 'This base is on the never-touch list, so nothing is pushed. It stays here until it is quiet.')));
        if (r.capped) block.push(note('wait', T('pl.raid-window.live.cappedNote', 'This raid reached "Most pushes for one raid". Nothing more is pushed until it ends.')));
        if (Array.isArray(r.knownFlags) && !r.knownFlags.length) block.push(note('flat', T('pl.raid-window.live.noFlag', 'This base has no flag, so there is no protection to push.')));
        (r.flags || []).forEach(function (f) { block.push(flagRow(f, r.base)); });
        kids.push(h('div', { class: 'rw-base' }, block));
      });
      return card('shield', T('pl.raid-window.card.underRaid', 'Under raid now'), kids, 'open');
    }

    /** What happens next, by the rule the backend pushes by. Shared by Raids and Activity. */
    function dueCard() {
      var lines = [];
      var L = navLabels();
      if (status) {
        var look;
        if (status.enabled === false) look = T('pl.raid-window.due.off', 'The plugin is off, so it does not look for raid damage.');
        else if (status.idle && status.idle.code === 'nobody_online') look = T('pl.raid-window.due.idle', 'Nobody is online. It looks again when somebody connects.');
        else if (status.nextPassAt) {
          look = status.nextPassAt <= serverNow()
            ? T('pl.raid-window.due.lookNow', 'Next look for raid damage: now.')
            : T('pl.raid-window.due.lookIn', 'Next look for raid damage: {when}.', { when: inTime(status.nextPassAt) });
          if (status.lastPassAt) look += ' ' + T('pl.raid-window.due.lastLook', 'Last look {ago}.', { ago: ago(status.lastPassAt) });
        }
        if (look) lines.push(h('div', { class: 'rw-due' }, [icon('clock'), h('span', {}, look)]));
        (status.open || []).forEach(function (r) {
          var who = baseLabel(r.base, r.name);
          var parts = [];
          if (r.dueBlocked === 'exempt') parts.push(T('pl.raid-window.due.exempt', 'never touched'));
          else if (r.dueBlocked === 'capped') parts.push(T('pl.raid-window.due.capped', 'limit reached, no more pushes'));
          else if (r.dueBlocked === 'mode') parts.push(T('pl.raid-window.due.mode', 'nothing can be pushed on this server'));
          else if (!Array.isArray(r.due) || !r.due.length) {
            parts.push(Array.isArray(r.knownFlags) && !r.knownFlags.length ? T('pl.raid-window.due.noFlag', 'no flag')
              : T('pl.raid-window.due.firstLook', 'flags are read on the next look'));
          } else {
            r.due.forEach(function (d) {
              var w;
              if (d.exempt) w = T('pl.raid-window.due.flagExempt', 'flag {flag}: never touched', { flag: d.flag });
              else if (d.ending) w = T('pl.raid-window.due.flagEnding', 'flag {flag}: protection starts within a minute, no more pushes', { flag: d.flag });
              else if (d.at == null || d.at <= serverNow()) w = T('pl.raid-window.due.flagNext', 'flag {flag}: pushed on the next look', { flag: d.flag });
              else w = T('pl.raid-window.due.flagIn', 'flag {flag}: next push {when}', { flag: d.flag, when: inTime(d.at) });
              parts.push(w);
            });
          }
          if (r.endsAt) parts.push(T('pl.raid-window.due.ends', 'over {when} if it stays quiet', { when: inTime(r.endsAt) }));
          lines.push(h('div', { class: 'rw-due' }, [icon('base'), h('span', {}, [h('b', {}, who + ': '), parts.join(' · ')])]));
        });
      }
      if (!lines.length) lines.push(note('flat', T('pl.raid-window.due.none', 'Nothing is due. The plugin waits for raid damage.')));
      return card('clock', T('pl.raid-window.card.due', 'What happens next'), lines, 'due',
        T('pl.raid-window.card.due.sub', 'Times are counted on the server. Full history is on {screen}.', { screen: L.activity }));
    }

    function endedCard() {
      var recent = (status && status.recent) || [];
      if (!recent.length) return null;
      var rows = recent.map(function (r) {
        var how = r.closedByAdmin ? T('pl.raid-window.ended.admin', 'stopped by an admin') : T('pl.raid-window.ended.quiet', 'went quiet');
        var pushes = r.pushes === 1 ? T('pl.raid-window.ended.pushOne', '{n} push', { n: r.pushes })
          : T('pl.raid-window.ended.pushMany', '{n} pushes', { n: r.pushes || 0 });
        return h('div', { class: 'rw-ended' }, [
          h('span', { class: 'rw-h-who' }, baseLabel(r.base, r.name)),
          h('span', { class: 'rw-small' }, cap([T('pl.raid-window.ended.when', 'ended {ago}', { ago: ago(r.closedAt) }), how, pushes].join(' · '))),
          r.resumable ? h('button', { type: 'button', class: 'secondary', onclick: function () { resumeBase(r.base); } },
            T('pl.raid-window.resume.button', 'Push again')) : null,
        ]);
      });
      return card('archive', T('pl.raid-window.card.ended', 'Ended in the last 7 days'), rows, 'ended',
        T('pl.raid-window.card.ended.sub', 'A raid stopped by an admin can be pushed again while it is still going on.'));
    }

    function renderRaids() {
      if (!raidsBox) return;
      noteFolds(raidsBox);
      swap(raidsBox, [h('div', { class: 'rw-notes', 'data-card': 'notes' }, noteList()), openCard(), dueCard(), endedCard()]);
    }

    // ── Protection ────────────────────────────────────────────────────────────────────────────────
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

    function loadNames() {
      if (!cfg) return;
      var bases = (cfg.exemptBaseIds || []).filter(function (x) { return typeof x === 'number'; });
      var flags = (cfg.exemptFlagIds || []).filter(function (x) { return typeof x === 'number'; });
      if (!bases.length && !flags.length) return;
      api('/names', { method: 'POST', body: { bases: bases, flags: flags } }).then(function (r) {
        if (!r) return;
        names.readable = r.readable;
        Object.keys(r.bases || {}).forEach(function (k) { names.bases[k] = r.bases[k]; });
        Object.keys(r.flags || {}).forEach(function (k) { names.flags[k] = r.flags[k]; });
        Object.keys(lists).forEach(function (k) { if (lists[k]) lists[k].refresh(); });
      }).catch(function () { names.readable = null; });
    }

    /* A never-touch list that stays usable with a hundred entries: search, pages, a tick per row and
     * one action on the ticks, which reads them at the moment of the press. */
    var lists = {};
    function idList(key, kind) {
      var tickSet = ticks[key];
      var addIn = h('input', { type: 'text', class: 'rw-in rw-add', inputmode: 'numeric',
        placeholder: kind === 'base' ? T('pl.raid-window.ids.addBase', 'base ids, e.g. 12, 40') : T('pl.raid-window.ids.addFlag', 'flag ids, e.g. 540') });
      nameCtl(addIn, labelOf(key));
      var msg = h('span', { class: 'rw-small' });
      function add() {
        var toks = addIn.value.split(/[\s,;]+/).map(function (s) { return s.trim(); }).filter(Boolean);
        var bad = toks.filter(function (s) { return !/^[0-9]+$/.test(s) || Number(s) <= 0; });
        if (bad.length) { msg.textContent = T('pl.raid-window.ids.bad', 'Not an id: {list}', { list: bad.join(', ') }); return; }
        var list = (cfg[key] || []).slice();
        var added = 0;
        toks.forEach(function (s) { var n = Number(s); if (list.indexOf(n) < 0) { list.push(n); added++; } });
        cfg[key] = list;
        addIn.value = '';
        msg.textContent = added ? T('pl.raid-window.ids.added', 'Added {n}. Save to keep it.', { n: added }) : T('pl.raid-window.ids.already', 'Already on the list.');
        changed();
        table.refresh();
        loadNames();
      }
      addIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); add(); } });
      var addBtn = h('button', { type: 'button', class: 'secondary', onclick: add }, T('pl.raid-window.ids.add', 'Add'));
      var removeTicked = h('button', { type: 'button', class: 'secondary', onclick: function () {
        // AT THE PRESS: the ticks as they stand now, not as they stood when the button was drawn.
        var pick = Object.keys(tickSet).filter(function (k) { return tickSet[k]; }).map(Number);
        if (!pick.length) { msg.textContent = T('pl.raid-window.ids.tickFirst', 'Tick the rows to remove first.'); return; }
        cfg[key] = (cfg[key] || []).filter(function (x) { return pick.indexOf(Number(x)) < 0; });
        pick.forEach(function (k) { delete tickSet[k]; });
        msg.textContent = T('pl.raid-window.ids.removed', 'Removed {n}. Save to keep it.', { n: pick.length });
        changed();
        table.refresh();
      } }, T('pl.raid-window.ids.removeTicked', 'Remove ticked'));
      function nameOf(id) {
        if (kind === 'base') {
          var n = names.bases[id];
          return n ? n : null;
        }
        var f = names.flags[id];
        return f ? T('pl.raid-window.ids.flagOf', 'on {base}', { base: baseLabel(f.base, f.name) }) : null;
      }
      var table = SSA.table({
        rows: function () { return (cfg[key] || []).map(function (x) { return { id: x }; }); },
        search: function (r) { return String(r.id) + ' ' + (nameOf(r.id) || ''); },
        searchPlaceholder: T('pl.raid-window.ids.search', 'Search ids and names'),
        pageSize: 10,
        sort: { key: 'id', dir: 'asc' },
        toolbar: [removeTicked],
        empty: kind === 'base' ? T('pl.raid-window.ids.emptyBases', 'No base is on this list. Every raided base is pushed.')
          : T('pl.raid-window.ids.emptyFlags', 'No flag is on this list. Every flag of a raided base is pushed.'),
        columns: [
          { key: 'tick', label: '', render: function (r) {
            var b = h('input', { type: 'checkbox', 'aria-label': T('pl.raid-window.ids.tick', 'Tick {id}', { id: r.id }) });
            b.checked = !!tickSet[r.id];
            b.addEventListener('change', function () { tickSet[r.id] = b.checked; });
            return b;
          } },
          { key: 'id', label: kind === 'base' ? T('pl.raid-window.ids.colBase', 'Base id') : T('pl.raid-window.ids.colFlag', 'Flag id'),
            sort: true, sortVal: function (r) { return typeof r.id === 'number' ? r.id : 0; },
            render: function (r) { return document.createTextNode(String(r.id)); } },
          { key: 'name', label: T('pl.raid-window.ids.colName', 'In the save'), render: function (r) {
            var n = nameOf(r.id);
            if (n) return document.createTextNode(n);
            return h('span', { class: 'rw-small' }, names.readable === false
              ? T('pl.raid-window.ids.unreadable', 'save not readable now')
              : T('pl.raid-window.ids.unknown', 'not found in the save'));
          } },
          { key: 'del', label: '', render: function (r) {
            return h('button', { type: 'button', class: 'secondary btn-icon', title: T('pl.raid-window.ids.remove', 'Remove {id}', { id: r.id }),
              onclick: function () { cfg[key] = (cfg[key] || []).filter(function (x) { return x !== r.id; }); delete tickSet[r.id]; changed(); table.refresh(); } },
            icon('close'));
          } },
        ],
      });
      lists[key] = table;
      table.refresh();
      return h('div', { class: 'rw-idlist' }, [h('div', { class: 'rw-inline' }, [addIn, addBtn, msg]), table.el]);
    }

    function renderProtect() {
      reapplyWarn = h('p', { class: 'rw-small rw-warn', hidden: true },
        T('pl.raid-window.warn.reapply', 'This is not shorter than the push, so protection can switch on between pushes.'));
      capHint = h('p', { class: 'rw-small' });
      var counts = [
        row(labelOf('minHits'), num('minHits', 1, T('pl.raid-window.unit.hits', 'hits'), 1, 1000),
          T('pl.raid-window.set.minHits.hint2', 'Hits on one base before it counts as a raid.')),
        row(labelOf('destroyedOpens'), toggle('destroyedOpens'),
          T('pl.raid-window.set.destroyedOpens.hint', 'On: a part that comes down counts at once, however few hits. Off: only the hit count decides.')),
        row(labelOf('useOwnerAlerts'), toggle('useOwnerAlerts'),
          T('pl.raid-window.set.ownerAlerts.hint', 'Base attack alerts can keep a raid going, but never start one.')),
        row(labelOf('acceptDeclared'), toggle('acceptDeclared'),
          T('pl.raid-window.set.acceptDeclared.hint', 'Lets other tools declare a raid without damage. Off: only real damage counts.')),
      ];
      var hold = [
        row(labelOf('pushSeconds'), num('pushSeconds', 60, T('pl.raid-window.unit.minutes', 'minutes'), 1, 1440),
          T('pl.raid-window.set.push.hint', 'During raid damage, offline protection is set to start this long from now, again and again.')),
        row(labelOf('countFromLastHit'), toggle('countFromLastHit'),
          T('pl.raid-window.set.countFromLastHit.hint', 'On: the wait restarts at every hit. Off: each push counts from the moment it is sent.')),
        row(labelOf('reapplySeconds'), num('reapplySeconds', 60, T('pl.raid-window.unit.minutes', 'minutes'), 0.5, 1440),
          T('pl.raid-window.set.reapply.hint', 'How often the push repeats during a raid. Keep it shorter than the push.'), reapplyWarn),
        row(labelOf('holdSeconds'), num('holdSeconds', 60, T('pl.raid-window.unit.minutes', 'minutes'), 1, 1440),
          T('pl.raid-window.set.hold.hint', 'After this long with no damage, pushing stops and protection starts as last set.')),
        row(labelOf('maxPushesPerRaid'), num('maxPushesPerRaid', 1, T('pl.raid-window.unit.pushes', 'pushes'), 1, 1000),
          T('pl.raid-window.set.maxPushes.hint', 'A safety limit: after this many pushes in one raid, nothing more is pushed.'), capHint),
      ];
      var flagOnly = [
        row(labelOf('durationSeconds'), lengthControl(),
          T('pl.raid-window.set.duration.hint', 'Flag-specific protection only. Each base\'s own length gives players back exactly what they had.')),
        row(labelOf('allowDecodedDuration'), toggle('allowDecodedDuration'),
          T('pl.raid-window.set.allowDecoded.hint', 'Flag-specific protection only, for a base the save has no length for. The game\'s figure is approximate.')),
        row(labelOf('resetCooldownFirst'), toggle('resetCooldownFirst'),
          T('pl.raid-window.set.resetCooldown.hint', 'Flag-specific only. Buys the game\'s cooldown skip before each push, possibly charging an online player.')),
      ];
      body.appendChild(card('alert', T('pl.raid-window.card.counts', 'What counts as a raid'), counts, 'counts'));
      body.appendChild(card('hourglass', T('pl.raid-window.card.hold', 'How protection is held back'), hold, 'hold'));
      body.appendChild(card('flag', T('pl.raid-window.card.flagOnly', 'Flag-specific protection'), flagOnly, 'flag',
        T('pl.raid-window.card.flagOnly.sub', 'Used only on a server that runs flag-specific raid protection.')));
      body.appendChild(card('ban', T('pl.raid-window.card.never', 'Never touch'), [
        sub(labelOf('exemptBaseIds')), idList('exemptBaseIds', 'base'),
        sub(labelOf('exemptFlagIds')), idList('exemptFlagIds', 'flag'),
      ], 'never', T('pl.raid-window.card.never.sub', 'A base or flag here is never pushed. Every base under raid shows its id on {screen}.', { screen: navLabels().raids })));
      body.appendChild(saveBar());
      hints();
    }

    // ── Activity ──────────────────────────────────────────────────────────────────────────────────
    var actTable = null;
    function loadFeed() {
      return api('/activity', { method: 'POST', body: {} }).then(function (r) {
        takeClock(r);
        feed = (r && Array.isArray(r.history)) ? r : { history: [] };
        feedErr = null;
        if (view === 'activity') { if (actTable) actTable.refresh(); renderActHead(); }
      }).catch(function (err) {
        feedErr = why(err);
        if (view === 'activity') renderActHead();
      });
    }
    var actHead = null, actDue = null;
    function renderActHead() {
      if (actDue) swap(actDue, [dueCard()]);
      if (!actHead) return;
      var kids = [];
      if (feedErr) kids.push(note('bad', [h('strong', {}, T('pl.raid-window.act.failed', 'The activity list could not be read. ')), feedErr]));
      kids.push(h('p', { class: 'rw-small' }, T('pl.raid-window.act.zone', 'Times are in your time zone: {zone}.', { zone: zoneText() })));
      swap(actHead, kids);
    }
    function renderActivity() {
      actDue = h('div', {});
      body.appendChild(actDue);
      actHead = h('div', { class: 'rw-notes' });
      var kindSel = h('select', { class: 'rw-in rw-kind' }, [
        h('option', { value: 'all' }, T('pl.raid-window.act.kind.all', 'Everything')),
        h('option', { value: 'windows' }, T('pl.raid-window.act.kind.windows', 'Raids seen and ended')),
        h('option', { value: 'pushes' }, T('pl.raid-window.act.kind.pushes', 'Pushes')),
        h('option', { value: 'refusals' }, T('pl.raid-window.act.kind.refusals', 'Refusals and skips')),
      ]);
      nameCtl(kindSel, T('pl.raid-window.act.kind', 'Show'));
      kindSel.value = actKind;
      kindSel.addEventListener('change', function () { actKind = kindSel.value; actTable.refresh(); });
      var clear = h('button', { type: 'button', class: 'secondary', onclick: function () {
        confirmAsk(T('pl.raid-window.hist.clearConfirm', 'Clear the whole activity list?\n\nNothing in the game changes.'), T('pl.raid-window.hist.clear', 'Clear the list')).then(function (yes) {
          if (!yes) return;
          api('/clear-history', { method: 'POST', body: {} }).then(function () {
            toast(T('pl.raid-window.hist.cleared', 'List cleared'));
            loadFeed(); refresh();
          }).catch(function (err) { toast(T('pl.raid-window.hist.clearFailed', 'The list was NOT cleared. {why}', { why: why(err) }), 'error'); });
        });
      } }, [icon('close'), T('pl.raid-window.hist.clear', 'Clear the list')]);
      actTable = SSA.table({
        rows: function () {
          var all = (feed && feed.history) || [];
          return actKind === 'all' ? all : all.filter(function (e) { return kindOf(e) === actKind; });
        },
        search: function (e) { return [e.baseName, e.base, e.flag, verdictOf(e.state)[1], textOf(e)].join(' '); },
        searchPlaceholder: T('pl.raid-window.act.search', 'Search bases, flags, results'),
        sort: { key: 'at', dir: 'desc' }, pageSize: 25,
        toolbar: [kindSel, clear],
        onRefresh: function () { loadFeed(); },
        empty: function () {
          if (!feed) return T('pl.raid-window.loading', 'Loading…');
          return actKind === 'all' ? T('pl.raid-window.hist.none2', 'Nothing yet. Every raid seen, every push and every refusal is listed here.')
            : T('pl.raid-window.act.noneOfKind', 'Nothing of this kind yet.');
        },
        columns: [
          { key: 'at', label: T('pl.raid-window.col.when', 'When'), sort: true, sortVal: function (e) { return e.at || 0; }, tdClass: 'dim',
            render: function (e) { return h('span', { class: 'rw-when', title: ago(e.at) }, fmtWhen(e.at, serverNow())); } },
          { key: 'base', label: T('pl.raid-window.col.base', 'Base'), sort: true, sortVal: function (e) { return String(e.baseName || e.base || '').toLowerCase(); },
            render: function (e) {
              if (e.base == null) return h('span', { class: 'rw-small' }, T('pl.raid-window.hist.allRaids', 'Every raid'));
              var who = baseLabel(e.base, e.baseName);
              return h('span', {}, [who, e.flag ? h('span', { class: 'rw-small' }, ' · ' + T('pl.raid-window.flag.plain', 'Flag {flag}', { flag: e.flag })) : null]);
            } },
          { key: 'state', label: T('pl.raid-window.col.what', 'What'), sort: true, sortVal: function (e) { return kindOf(e) + e.state; },
            render: function (e) { var m = verdictOf(e.state); return badge(m[0], m[1]); } },
          { key: 'text', label: T('pl.raid-window.col.detail', 'Detail'), render: function (e) { return h('span', { class: 'rw-h-t' }, textOf(e)); } },
        ],
      });
      body.appendChild(card('pulse', T('pl.raid-window.card.activity', 'Activity'), [actHead, actTable.el], 'activity',
        T('pl.raid-window.card.activity.sub', 'Every raid seen or ended, every push and every refusal, with its reason.')));
      renderActHead();
      actTable.refresh();
    }
    function textOf(e) {
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
      return text;
    }

    // ── Settings ──────────────────────────────────────────────────────────────────────────────────
    var bridgeBox = null;
    function refreshBridge() {
      return Promise.resolve(api('/bridge-check'))
        .then(function (r) { bridge = (r && Array.isArray(r.items)) ? r : null; })
        .catch(function () { bridge = null; })
        .then(function () { renderBridge(); if (view === 'raids') renderRaids(); });
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

    function bridgeCard() {
      var kids = [];
      if (!bridge) {
        kids.push(note('flat', T('pl.raid-window.bridge.checking', 'Reading the bridge settings…')));
        return card('check-shield', T('pl.raid-window.card.bridge', 'Bridge'), kids, 'bridge');
      }
      var items = bridge.items;
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
          h('span', {}, [h('b', {}, forWhatText(x) + ': '),
            T('pl.raid-window.bridge.isOff', '{module}, "{label}" is off', { module: x.moduleName, label: x.label })])]));
      });
      byHand.forEach(function (x) {
        kids.push(h('div', { class: 'rw-need' }, [icon('alert'),
          h('span', {}, [h('b', {}, forWhatText(x) + ': '),
            T('pl.raid-window.bridge.byHand', 'turn on "{label}" on the {module} card in {where}', { label: x.label, module: x.moduleName, where: bridgeWhere() })
            + (x.state === 'unknown' ? T('pl.raid-window.bridge.byHand.unknown', ' (the server is not running, so it cannot be checked from here)') : '')])]));
      });
      gone.forEach(function (x) {
        kids.push(h('div', { class: 'rw-need' }, [icon('close'),
          h('span', {}, [h('b', {}, forWhatText(x) + ': '),
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
      return card('check-shield', T('pl.raid-window.card.bridge', 'Bridge'), kids, 'bridge');
    }
    function renderBridge() { if (bridgeBox && view === 'settings') swap(bridgeBox, [bridgeCard()]); }

    function lookup() {
      var inp = h('input', { type: 'number', class: 'rw-in rw-num', placeholder: T('pl.raid-window.lookup.placeholder', 'flag id'), min: 1 });
      var out = h('span', { class: 'rw-small' });
      var btn = h('button', { type: 'button', class: 'secondary' }, T('pl.raid-window.lookup.check', 'Check'));
      btn.addEventListener('click', function () {
        var v = Number(inp.value);
        if (!(isFinite(v) && v > 0)) { out.textContent = T('pl.raid-window.lookup.needId', 'Type a flag id first.'); return; }
        out.textContent = T('pl.raid-window.lookup.reading', 'Reading…');
        api('/flag', { method: 'POST', body: { id: v } }).then(function (r) {
          var savedLen = r.savedDurationSeconds;
          var parts = [savedLen == null ? T('pl.raid-window.lookup.noLengthAtAll', 'The save has no length for it')
            : (savedLen === 0 ? T('pl.raid-window.lookup.noLengthNow', 'The save holds no length right now')
              : T('pl.raid-window.lookup.savedLength', 'Saved length {t}', { t: dur(savedLen) }))];
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
      body.appendChild(card('sliders', T('pl.raid-window.card.settings', 'Settings'), [
        row(labelOf('enabled'), toggle('enabled'),
          T('pl.raid-window.set.enabled.hint', 'Off stops all pushing. A push already made is left as it is.')),
        row(labelOf('pollSeconds'), num('pollSeconds', 1, T('pl.raid-window.unit.seconds', 'seconds'), 5, 300),
          T('pl.raid-window.set.poll.hint', 'How often the plugin checks the bridge for new raid damage.')),
      ], 'settings'));
      bridgeBox = h('div', {});
      body.appendChild(bridgeBox);
      renderBridge();
      body.appendChild(card('flag', T('pl.raid-window.set.checkFlag', 'Check a flag'), [
        h('p', { class: 'rw-small' }, T('pl.raid-window.set.checkFlag.hint', 'Shows what the save and the running game say about one flag\'s protection right now.')),
        lookup(),
      ], 'lookup'));
      body.appendChild(card('chat', T('pl.raid-window.card.players', 'Players and time'), [
        h('p', { class: 'rw-small' }, T('pl.raid-window.players.none', 'This plugin sends no message to players. It only moves when offline protection starts, on a base under raid.')),
        h('p', { class: 'rw-small' }, T('pl.raid-window.time.zone', 'Times on this tab are in your time zone: {zone}.', { zone: zoneText() })),
        h('p', { class: 'rw-small' }, T('pl.raid-window.time.lengths', 'The plugin counts only lengths of time, so midnight or a clock change never shortens a raid.')),
      ], 'players'));
      body.appendChild(saveBar());
    }

    load();
  }

  SSA.ready(function () {
    SSA.registerTab({ id: PLUGIN, label: T('pl.raid-window.tab', 'Raid Window'), icon: '#i-hourglass', premium: true, render: editor });
  });
}());
