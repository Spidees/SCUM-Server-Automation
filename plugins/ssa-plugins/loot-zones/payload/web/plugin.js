/* Loot Zones — admin tab.
 *
 * Every control on this page is editable with the server stopped; the live half (what the game
 * currently holds) is drawn as a note beside them and never gates anything. That is the rule the
 * whole plugin section of this product follows: an owner sets a server up before they start it.
 *
 * Where a control needs something switched on in the bridge that no plugin may ask for on an
 * owner's behalf, this page names that switch by its own label — the words on the card they have to
 * go and find — rather than saying the feature is unavailable.
 */
(function () {
  'use strict';

  var API = SSA.apiClient ? SSA.apiClient('loot-zones') : null;
  /**
   * ⚠ A BODY IS AN OBJECT, NEVER A STRING.
   *
   * The SDK stringifies an object body and sets `Content-Type: application/json` in the same breath
   * — and only in that branch. Hand it a string that has already been stringified and the branch is
   * skipped, the header never goes out, and `express.json()` parses nothing without one: the route
   * receives `{}`. A save then stores what was already there, answers with it, and the screen draws
   * that back over everything the owner just typed. Nothing fails and nothing is saved.
   *
   * The fallback below sets the header itself, which is why driving this through a fallback proves
   * nothing about the real path. Both take an object.
   */
  var api = function (p, opts) {
    var o = opts || {};
    if (API) return API(p, o);
    var url = '/api/plugins/loot-zones' + p;
    // Built rather than mutated: the request init is assembled in one place, and an assignment onto
    // an object that looks like a config root reads to the plugin checker as a setting being saved.
    var init = (o.body && typeof o.body === 'object')
      ? Object.assign({}, o, {
        headers: Object.assign({ 'Content-Type': 'application/json' }, o.headers || {}),
        body: JSON.stringify(o.body),
      })
      : Object.assign({}, o);
    return fetch(url, init).then(function (r) { return r.json(); }).catch(function () { return {}; });
  };

  // ⚠ `SSA.el`, and it is not a preference. There is no `SSA.h` on the SDK — this line read
  // `SSA.h || …` and therefore took its own fallback on every render this tab has ever done, which
  // is a second element helper living beside the real one and drifting from it for free.
  var h = SSA.el || function (t, a, c) {
    var e = document.createElement(t);
    if (a) Object.keys(a).forEach(function (k) {
      if (k === 'class') e.className = a[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), a[k]);
      else if (a[k] != null) e.setAttribute(k, a[k]);
    });
    (Array.isArray(c) ? c : [c]).forEach(function (x) {
      if (x == null || x === false) return;
      e.appendChild(typeof x === 'string' ? document.createTextNode(x) : x);
    });
    return e;
  };
  var icon = function (n) { return SSA.icon ? SSA.icon(n) : h('span', {}, ''); };

  var state = { cfg: null, sets: null, status: null, clock: null, bridge: null };
  // Which explanations and which "More options" folds a viewer has opened. Per visit, never saved.
  var openHints = {};
  var openMore = {};
  // Whether the settings could be READ is UI state, not a setting — so it does not live on the
  // object the config lives on. Anything assigned there reads as something the backend ought to
  // know about, which is the same reading `unsaved` was moved out for.
  var broken = false;
  // Unsaved-ness is UI state, not a setting, so it does NOT live on the object the config lives on:
  // anything assigned there reads as a setting the backend ought to know about, and rightly so.
  var unsaved = false;
  // Which blocks a viewer has folded away. Per viewer and per visit, deliberately — it is not a
  // server setting and has no business being saved as one.
  var shut = {};
  var root = null;
  var poll = null;

  function markDirty() { unsaved = true; render(); }

  function save() {
    return api('/config', { method: 'POST', body: state.cfg })
      .then(function (r) {
        if (!r || !r.config) { SSA.toast('Save failed'); return; }
        state.cfg = r.config; unsaved = false;
        if ((r.warnings || []).length) r.warnings.forEach(function (w) { SSA.toast(w); });
        else SSA.toast('Saved');
        render();
      });
  }

  /**
   * Did this answer come from the plugin, or from `api()` giving up?
   *
   * `api()` turns any failed fetch into `{}` — which is TRUTHY, so "the backend never answered"
   * and "the backend answered with nothing" arrive here as the same value. They are opposites, and
   * telling them apart is the difference between a screen that says what is wrong and a blank tab.
   */
  var OWN_KEYS = ['enabled', 'rotation', 'zone', 'zones', 'messages', 'sentries', 'setsDir',
    'maxActive', 'minMinutesBetweenSwitches', 'chatChannel'];
  function looksLikeConfig(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    // The WEAKER claim on purpose. Asking for the newest keys turned a config from an older deployed
    // backend — an ordinary state while an update lands — into "this tab could not read its
    // settings", which is a different fault with a different fix. An empty object carries none of
    // these, and an empty object is exactly what `api()` makes of a fetch that failed.
    for (var i = 0; i < OWN_KEYS.length; i++) if (OWN_KEYS[i] in v) return true;
    return false;
  }

  /**
   * Which clock a window is read on. "From 20:00" means two different things and this page must
   * never leave which one to a guess.
   *
   * ⚠ ON ITS OWN, and never inside the `Promise.all` the page is drawn from. A backend deployed
   * before this route existed does not answer it, and an update lands in two steps — so folding it
   * in made the whole tab depend on it and report "could not read its own settings", which is a
   * different fault with a different fix. A nicety on one note may not be able to take a page down.
   */
  function refreshClock() {
    return Promise.resolve(api('/clock'))
      .then(function (r) { state.clock = (r && r.now) ? r : null; })
      .catch(function () { state.clock = null; });
  }

  /**
   * ⚠ **A RE-RENDER EMPTIES THE ROOT, AND AN INPUT COMMITS ON `change`.**
   *
   * So anything typed and not yet blurred is not in `state.cfg` and is destroyed by a redraw, along
   * with focus and the caret — and this page redraws on a 15-second poll. `unsaved` already protects
   * the CONFIG from being overwritten; it has to protect the DOM too, which it did not.
   *
   * Live status stops updating while there are unsaved edits. That is the right way round: the
   * status is a few seconds stale and the owner's half-typed message is not recoverable.
   */
  function refresh(opts) {
    var quiet = !!(opts && opts.quiet);
    // Never on its own. Folding the clock into the page's own load made the whole tab depend on a
    // route older backends do not have; giving it its own render made every refresh redraw twice.
    refreshClock();
    refreshBridge();
    return Promise.all([api('/config'), api('/sets'), api('/status')]).then(function (r) {
      if (!unsaved) {
        state.cfg = looksLikeConfig(r[0]) ? r[0] : null;
        broken = !looksLikeConfig(r[0]);
      }
      state.sets = r[1];
      state.status = r[2];
      if (!(quiet && unsaved)) render();
    }).catch(function () {
      broken = true;
      render();
    });
  }

  /**
   * What this configuration needs switched on in the bridge, and whether it is. On its own for the same
   * reason as the clock: a backend older than the route must not take the page down.
   */
  function refreshBridge() {
    return Promise.resolve(api('/bridge-check'))
      .then(function (r) { state.bridge = (r && Array.isArray(r.items)) ? r : null; })
      .catch(function () { state.bridge = null; });
  }

  /**
   * Turn on, in the bridge, exactly the switches listed — after saying what each one does.
   *
   * The manager's own route, reached with the owner's session: `confirm: true` with the names shown
   * is what lets it switch on what a plugin may only name. Nothing here runs without the click.
   */
  function turnOnInBridge(items) {
    var lines = items.map(function (x) {
      return '• ' + x.moduleName + ' → ' + x.label + (x.danger ? '  (changes the running world)' : '');
    });
    return Promise.resolve(SSA.confirm('Turn these on in the SSA Bridge?\n\n' + lines.join('\n')
      + '\n\nEach one can be switched off again on its card in Settings → Bridge.'))
      .then(function (yes) {
        if (!yes) return null;
        return fetch('/api/plugins/loot-zones/bridge-needs/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: true, only: items.map(function (x) { return x.module + '.' + x.key; }) }),
        }).then(function (r) { return r.json(); }).catch(function () { return null; });
      })
      .then(function (r) {
        if (r === null) return;
        if (!r || r.ok === false) {
          SSA.toast(r && r.error === 'bridge_ui_disabled'
            ? 'In-game control is switched off for this panel, so nothing was changed'
            : 'The bridge settings could not be changed' + (r && r.error ? ' (' + r.error + ')' : ''));
          return;
        }
        var n = (r.applied || []).reduce(function (k, a) { return k + (a.keys || []).length; }, 0);
        SSA.toast(n ? 'Switched on ' + n + ' setting(s) in the bridge' : 'Nothing needed changing');
        refreshBridge().then(render);
      });
  }

  // ── little controls ────────────────────────────────────────────────────────────────────────────
  /**
   * The panel's own switch.
   *
   * ⚠ It used to be `.lz-tg`, whose whole `on` state was `background: var(--accent)` — a token the
   * panel does not define, so the declaration never applied and a switch that was ON looked exactly
   * like a switch that was OFF. Every "this is enabled" on this page was invisible.
   *
   * `.switch` is a real checkbox underneath, so it keeps the keyboard, the label and the form
   * semantics that a `<button><span></span></button>` had none of.
   */
  function toggle(v, on, label) {
    var box = h('input', { type: 'checkbox' });
    box.checked = !!v;
    box.addEventListener('change', function () { on(box.checked); });
    return h('label', { class: 'switch' }, [box, label ? h('span', {}, label) : null]);
  }
  function txt(v, ph, on, cls) {
    var i = h('input', { class: cls || 'lz-in', type: 'text', value: v == null ? '' : String(v), placeholder: ph || '' });
    i.addEventListener('change', function () { on(i.value); });
    return i;
  }
  function area(v, on) {
    var t = h('textarea', { class: 'lz-in lz-area', rows: '2' }, v == null ? '' : String(v));
    t.addEventListener('change', function () { on(t.value); });
    return t;
  }
  function num(v, on, min, max) {
    var i = h('input', { class: 'lz-in lz-num', type: 'number', value: v == null ? '' : String(v) });
    if (min != null) i.min = String(min);
    if (max != null) i.max = String(max);
    i.addEventListener('change', function () { on(Number(i.value)); });
    return i;
  }
  /**
   * A number shown in the unit a person thinks in, with that unit written beside the box.
   *
   * ⚠ **WHAT IS STORED KEEPS ITS OWN UNIT.** Distances are saved in centimetres and durations in
   * seconds, as every configuration already written has them, so `scale` converts on the way to the
   * screen and back. A box nobody touched writes nothing, so opening and saving the page never
   * rewrites a stored value.
   */
  function numIn(v, on, min, max, unit, scale) {
    var k = scale || 1;
    var shown = (v == null || v === '') ? '' : String(Math.round((Number(v) / k) * 100) / 100);
    var i = h('input', { class: 'lz-in lz-num', type: 'number', step: 'any', value: shown });
    if (min != null) i.min = String(min);
    if (max != null) i.max = String(max);
    i.addEventListener('change', function () {
      if (i.value === '' || !isFinite(Number(i.value))) return;
      on(Math.round(Number(i.value) * k));
    });
    return h('span', { class: 'lz-unitbox' }, [i, unit ? h('small', { class: 'lz-unit' }, unit) : null]);
  }
  var M = 100;      // centimetres in a metre
  var MIN = 60;     // seconds in a minute

  /**
   * The game's colour is four numbers from 0 to 1; a person picks a colour and an opacity. A value
   * over 1 is a configuration written against the old 0..255 shape and is read as what it meant.
   */
  function colourIn(col, onChange) {
    var to255 = function (v, d) { var n = (v == null ? d : Number(v)); if (!(n >= 0)) n = d; if (n > 1) n = n / 255; return Math.round(Math.max(0, Math.min(1, n)) * 255); };
    var hex = '#' + [to255(col.r, 1), to255(col.g, 0.64), to255(col.b, 0.1)]
      .map(function (n) { return ('0' + n.toString(16)).slice(-2); }).join('');
    var pick = h('input', { class: 'lz-in lz-colour', type: 'color', value: hex });
    pick.addEventListener('change', function () {
      var v = pick.value;
      col.r = Math.round(parseInt(v.slice(1, 3), 16) / 255 * 1000) / 1000;
      col.g = Math.round(parseInt(v.slice(3, 5), 16) / 255 * 1000) / 1000;
      col.b = Math.round(parseInt(v.slice(5, 7), 16) / 255 * 1000) / 1000;
      onChange();
    });
    var a = col.a == null ? 1 : Number(col.a);
    if (a > 1) a = a / 255;
    var op = h('input', { class: 'lz-in lz-num', type: 'number', min: '0', max: '100', step: '1', value: String(Math.round(a * 100)) });
    op.addEventListener('change', function () {
      if (op.value === '' || !isFinite(Number(op.value))) return;
      col.a = Math.round(Math.max(0, Math.min(100, Number(op.value)))) / 100;
      onChange();
    });
    return h('div', { class: 'lz-routes' }, [pick, h('small', {}, 'Opacity'),
      h('span', { class: 'lz-unitbox' }, [op, h('small', { class: 'lz-unit' }, '%')])]);
  }

  function sel(v, opts, on) {
    var s = h('select', { class: 'lz-in' }, opts.map(function (o) {
      var e = h('option', { value: o[0] }, o[1]);
      if (String(o[0]) === String(v)) e.selected = true;
      return e;
    }));
    s.addEventListener('change', function () { on(s.value); });
    return s;
  }
  /** A choice that reads as a word rather than as a bare box. */
  function check(label, v, on) {
    var b = h('button', { class: 'lz-chk' + (v ? ' on' : ''), type: 'button' }, [icon(v ? 'check' : 'close'), h('span', {}, label)]);
    b.addEventListener('click', function () { on(!v); });
    return b;
  }
  // Spawn code -> class path for the build this was packaged against, fetched once. A code that is
  // not in it is answered as not in it: the box stays typeable and nothing is guessed.
  var classTable = null;
  function guardClasses() {
    if (classTable) return Promise.resolve(classTable);
    return api('/guard-classes').then(function (r) {
      classTable = (r && r.classes) ? r : { classes: {}, kinds: {} };
      return classTable;
    });
  }

  function canPick() {
    return typeof SSA.pickItem === 'function' && (!SSA.canPickItem || SSA.canPickItem());
  }



  /**
   * One settings row: the label, the sentence that explains it, and the control.
   *
   * The hint sits under the LABEL, which is where the panel's own settings screens put it. Under the
   * control it pushes the next row's control out of line with this one, and a column of controls
   * that does not line up is most of what "everything runs together" looks like.
   */
  function row(label, control, hint) {
    // The explanation is one click away rather than always open: a page where every control carries a
    // paragraph is a page nobody can find a control on. The label is the key, so it stays open across
    // the redraws a change causes.
    var open = !!openHints[label];
    return h('div', { class: 'lz-row' }, [
      h('label', {}, [label, hint ? h('button', {
        class: 'lz-q' + (open ? ' on' : ''), type: 'button', title: open ? 'Hide the explanation' : 'What does this do?',
        onclick: function () { openHints[label] = !open; render(); },
      }, '?') : null]),
      (hint && open) ? h('p', { class: 'lz-hint' }, hint) : null,
      h('div', { class: 'lz-ctl' }, [control]),
    ]);
  }
  /** Rows an owner rarely needs, folded under one line that stays open across redraws once opened. */
  function more(key, title, kids) {
    var d = h('details', { class: 'lz-more' }, [h('summary', {}, title)].concat(kids.filter(Boolean)));
    if (openMore[key]) d.open = true;
    d.addEventListener('toggle', function () { openMore[key] = d.open; });
    return d;
  }
  /** '' is a plain fact and gets no wash, so 'good' / 'bad' / 'wait' keep their meaning. */
  function note(kind, text) { return h('div', { class: 'lz-note ' + (kind || 'flat') }, text); }
  /**
   * A section.
   *
   * `class="card lz-card"` — the panel's own box, which is what five of the other six plugins do and
   * what the panel's own comment asks for. Its ground, border, radius and padding are then the ones
   * every other box on the screen has, rather than a set of pixel values of this plugin's own that
   * came out a third tighter than everything around them.
   *
   * `lead` is one sentence saying what the section is for. A page of sections reads; a page of rows
   * does not.
   */
  function card(ico, title, lead, kids) {
    return h('section', { class: 'card lz-card' },
      [h('h3', {}, [icon(ico), title]), lead ? h('p', { class: 'lz-lead' }, lead) : null]
        .concat(kids.filter(Boolean)));
  }
  var metres = function (cm) { return Math.round((cm || 0) / 100); };

  // ── the four messages ──────────────────────────────────────────────────────────────────────────
  //
  // They differ in two ways only — which tokens they carry, and whether they go to one player or to
  // everybody — so this is one renderer with those two facts passed in, rather than four blocks that
  // drift apart the first time somebody edits one of them.
  var MESSAGES = [
    { key: 'activate', title: 'When a zone opens', broadcast: true, tokens: ['zone', 'set'],
      hint: 'Sent once, the moment the loot changes.' },
    { key: 'deactivate', title: 'When a zone closes', broadcast: true, tokens: ['zone', 'set'],
      hint: 'Sent as the loot goes back to normal.' },
    { key: 'join', title: 'To a player logging in', broadcast: false, tokens: ['player', 'zones', 'zone', 'count'],
      hint: 'Reaches that player alone, and only while something is really live.' },
    { key: 'reminder', title: 'While a zone is running', broadcast: true, tokens: ['zones', 'zone', 'count'],
      hint: 'For anyone who was not on when it opened.' },
  ];

  function messageBlock(def, c) {
    var m = (c.messages || {})[def.key] || {};
    var folded = !!shut['m-' + def.key];
    var head = h('div', { class: 'lz-zhead' }, [
      toggle(!!m.enabled, function (v) { m.enabled = v; markDirty(); }),
      h('button', {
        class: 'lz-link', type: 'button',
        onclick: function () { shut['m-' + def.key] = !folded; render(); },
      }, def.title),
      h('span', { class: 'lz-badge' + (m.enabled ? ' on' : '') }, m.enabled ? 'on' : 'off'),
    ]);
    if (folded) return h('div', { class: 'lz-zone' }, [head]);

    return h('div', { class: 'lz-zone' }, [
      head,
      row('What it says', area(m.text, function (v) { m.text = v; markDirty(); }),
        'Leave it empty to switch this message off however the routes are set. You can use '
        + def.tokens.map(function (t) { return '{' + t + '}'; }).join(', ') + '.'),
      row('Where it goes', h('div', { class: 'lz-routes' }, [
        check('Chat', !!m.chat, function (v) { m.chat = v; markDirty(); }),
        check('On screen', !!m.hud, function (v) { m.hud = v; markDirty(); }),
        check('With a sound', !!m.alert, function (v) { m.alert = v; markDirty(); }),
        check('Kill feed', !!m.killFeed, function (v) { m.killFeed = v; markDirty(); }),
        // ⚠ Not offered for the join message: that one goes to ONE player and the history is public.
        def.broadcast ? check('Chat history', !!m.history, function (v) { m.history = v; markDirty(); }) : null,
      ]),
        (def.broadcast
          ? 'On screen is a line in the HUD, which scrolls away with the rest of the feed. The kill feed is '
            + 'the one that stays, and a sound comes with the HUD line.'
          : 'On screen and the kill feed reach that one player. A sound for ONE player rides on the kill-feed '
            + 'entry — the game has no other per-player sound — so ticking it sends that entry, once, with '
            + 'the notification noise.')
        + ' There is no banner and no colour — the game has neither, and a colour code arrives as text.'
        + (def.broadcast
          ? ' Chat history puts the line in the admin chat view, the field console and your Discord '
            + 'chat channel. It is a separate route because the game does not log what a plugin sends '
            + '— which is why an announcement is visible in game and nowhere else until you tick it.'
          : ' There is no chat-history option here: this message goes to one player and the history is '
            + 'public, so recording it would publish something meant for them.')),
      def.key === 'join' ? row('Wait before sending',
        numIn(m.delaySeconds, function (v) { m.delaySeconds = v; markDirty(); }, 0, 300, 'seconds'),
        'Somebody who has just joined is still on a loading screen, and a line sent then is a line nobody reads.') : null,
      def.key === 'reminder' ? row('How often',
        numIn(m.everyMinutes, function (v) { m.everyMinutes = v; markDirty(); }, 1, 1440, 'minutes'),
        'Counted from the moment a zone went live, and never less than one.') : null,
      h('div', { class: 'lz-actions' }, [
        h('button', {
          class: 'secondary', type: 'button', onclick: function () {
            api('/test-message', { method: 'POST', body: { which: def.key } })
              .then(function () { SSA.toast('Sent, exactly as it is written now'); });
          },
        }, [icon('play'), 'Try it in game']),
        h('small', {}, def.hint),
      ]),
    ]);
  }

  /**
   * ⚠ **1 IS MONDAY AND 7 IS SUNDAY.**
   *
   * These are the numbers `timeWindows.js` reads, and this screen wrote 0..6 for as long as it
   * existed — placeholder, filter and the list "Add a time" seeded, all three. A Sunday written as 0
   * is a window the evaluator REFUSES, and it treats a refused window as CLOSED: the zone never came
   * on and nothing said why. A weekend written "5,6" was Friday and Saturday.
   *
   * Buttons rather than a typed list, so the vocabulary is not something an owner can be wrong about.
   */
  var DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];

  /** Every day, in the evaluator's numbers. Used by "Add a time" and by "All week". */
  function allDays() { return DAYS.map(function (d) { return d[0]; }); }

  function dayPicker(win) {
    var listed = Array.isArray(win.days) ? win.days.map(Number).filter(function (n) { return n >= 1 && n <= 7; }) : [];
    // ⚠ AN EMPTY LIST MEANS EVERY DAY. That is the evaluator's rule — `days.length === 0` is
    // unrestricted — so seven grey buttons were a zone open all week, with nothing to say so. Drawing
    // empty as all-on makes the picker say what the setting means; turning one off then writes the
    // other six, and turning the last one off comes back round to every day, which is the only other
    // thing "no days" can honestly be.
    var on = listed.length ? listed : DAYS.map(function (d) { return d[0]; });
    return h('div', { class: 'lz-days' }, DAYS.map(function (d) {
      var picked = on.indexOf(d[0]) >= 0;
      return h('button', {
        class: 'lz-day' + (picked ? ' on' : ''), type: 'button',
        title: picked ? 'Not on ' + d[1] : 'Also on ' + d[1],
        onclick: function () {
          var next = picked ? on.filter(function (x) { return x !== d[0]; }) : on.concat([d[0]]);
          next.sort(function (a, b) { return a - b; });
          // All seven, and none at all, are the same thing to the evaluator. Storing the empty form
          // keeps the config honest about "not restricted" rather than listing every day.
          win.days = (next.length === 0 || next.length === 7) ? [] : next;
          markDirty();
        },
      }, d[1]);
    }));
  }

  /**
   * A zone's schedule, plus what the evaluator makes of it right now.
   *
   * The verdict is READ from the backend rather than worked out here: `host.time` is the manager's
   * one evaluator, it already knows what "Friday 22:00 to 02:00" means at one in the morning, and a
   * second reading of that on this screen would be a second set of edge cases to get wrong.
   */
  function scheduleBlock(z, st) {
    var w = Array.isArray(z.windows) ? z.windows : (z.windows = []);
    var v = (st.schedule || {})[String(z.id)] || null;

    var verdict = null;
    if (v && (v.errors || []).length) {
      verdict = note('bad', 'This zone stays OFF: ' + v.errors.join(' '));
    } else if (v && v.unscheduled) {
      verdict = note('', 'No times set, so this zone is on whenever rotation is running. An empty '
        + 'schedule means "not scheduled", never "never".');
    } else if (v) {
      verdict = note(v.open ? 'good' : 'wait', (v.open ? 'Open now' : 'Closed now')
        + (v.text ? ' — ' + v.text : '')
        + (v.open && v.closesInMinutes != null ? '. It closes in ' + humanMins(v.closesInMinutes) + '.'
          : (!v.open && v.opensInMinutes != null ? '. It opens in ' + humanMins(v.opensInMinutes) + '.' : '')));
    }

    return h('div', { class: 'lz-when' }, [
      verdict,
      h('small', {}, 'By the SERVER\'S clock — not the game\'s day cycle, which has no day of the week '
        + 'and runs at your own speed multiplier. A time that crosses midnight belongs to the day it '
        + 'STARTS, so Friday 22:00 to 02:00 is Friday night.'),
    ].concat(w.map(function (win, wi) {
      return h('div', { class: 'lz-win' }, [
        dayPicker(win),
        txt(win.from, '20:00', function (val) { win.from = val; markDirty(); }),
        h('span', { class: 'lz-win-sep' }, 'to'),
        txt(win.to, '23:00', function (val) { win.to = val; markDirty(); }),
        h('button', {
          class: 'lz-del', type: 'button', title: 'Remove this time',
          onclick: function () { w.splice(wi, 1); markDirty(); },
        }, [icon('close')]),
      ]);
    })).concat([
      h('div', { class: 'lz-actions' }, [
        h('button', {
          class: 'secondary', type: 'button', onclick: function () {
            w.push({ days: allDays(), from: '20:00', to: '23:00' });
            markDirty();
          },
        }, [icon('clock'), 'Add a time']),
        // All day is what an owner asks for by name, and 00:00 to 00:00 is exactly the shape the
        // evaluator refuses as ambiguous — so the button writes the one that works.
        h('button', {
          class: 'secondary', type: 'button', onclick: function () {
            w.push({ days: allDays(), from: '00:00', to: '23:59' });
            markDirty();
          },
        }, [icon('clock'), 'Add a whole day']),
      ]),
    ]));
  }

  /** A unix time as something a person reads: "at 04:00, in about 3 hours". */
  function whenPhrase(unix) {
    var d = new Date(Number(unix) * 1000);
    if (!(d.getTime() > 0)) return 'scheduled';
    var mins = Math.round((d.getTime() - Date.now()) / 60000);
    var at = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return 'at ' + at + (mins > 0 ? ', in about ' + humanMins(mins) : '');
  }

  /** "40 minutes", "3 hours", "2 days" — the same shape the evaluator's own sentences use. */
  function humanMins(m) {
    var n = Math.max(0, Math.round(Number(m) || 0));
    if (n < 60) return n + ' minute' + (n === 1 ? '' : 's');
    if (n < 1440) { var hrs = Math.round(n / 60); return hrs + ' hour' + (hrs === 1 ? '' : 's'); }
    var d = Math.round(n / 1440);
    return d + ' day' + (d === 1 ? '' : 's');
  }

  // ── one zone ───────────────────────────────────────────────────────────────────────────────────
  function zoneBlock(z, i, c, sets, st) {
    var live = (st.active || []).filter(function (a) { return String(a.id) === String(z.id); })[0];
    var set = sets.filter(function (s) { return s.name === z.set; })[0];
    var folded = !!shut['z-' + z.id];

    var head = h('div', { class: 'lz-zhead' }, [
      toggle(z.enabled !== false, function (v) { z.enabled = v; markDirty(); }),
      txt(z.name, 'a name players will read', function (v) { z.name = v; markDirty(); }, 'lz-in lz-name'),
      sel(z.set, [['', '— pick a loot set —']].concat(sets.map(function (s) {
        return [s.name, s.name + (s.ok ? '' : '  (unusable)')];
      })), function (v) { z.set = v; markDirty(); }),
      live ? h('span', { class: 'lz-badge on' }, live.drawn === false ? 'live, not drawn' : 'live') : null,
      h('button', {
        class: 'lz-link', type: 'button',
        onclick: function () { shut['z-' + z.id] = !folded; render(); },
      }, folded ? 'more' : 'less'),
      h('button', {
        class: 'lz-link', type: 'button', title: 'Add a copy of this zone with all its settings, right below it',
        onclick: function () {
          // Everything the zone carries — its guards, schedule, messages and loot set — under a new id.
          // The copy starts switched off, so two zones never go live on the same set by accident.
          var copy = JSON.parse(JSON.stringify(z));
          copy.id = 'z' + Date.now().toString(36);
          copy.name = (z.name || z.set || 'Zone') + ' (copy)';
          copy.enabled = false;
          c.zones.splice(i + 1, 0, copy);
          markDirty();
        },
      }, 'duplicate'),
      h('button', {
        class: 'lz-del', type: 'button', title: 'Remove this zone',
        onclick: function () {
          SSA.confirm('Remove "' + (z.name || z.set || 'this zone') + '" from the list?').then(function (yes) {
            if (!yes) return;
            c.zones.splice(i, 1); markDirty();
          });
        },
      }, [icon('close')]),
    ]);
    if (folded) return h('div', { class: 'lz-zone' + (live ? ' on' : '') }, [head]);

    var meta = [];
    if (!z.set) meta.push('No loot set chosen yet, so this zone cannot be switched on.');
    else if (!set) meta.push('The set "' + z.set + '" is not in the sets folder any more.');
    else if (!set.ok) meta.push(set.why);
    else {
      var r = set.rects[0] || {};
      meta.push(set.presets + ' loot files, area ' + metres(r.width) + ' x ' + metres(r.height) + ' m'
        + (set.rects.length > 1 ? ' (+' + (set.rects.length - 1) + ' more)' : '') + '.');
    }
    if (live && live.drawn === false) meta.push('The loot is live; the rectangle is not on the map yet. ' + (live.drawnWhy || ''));
    // ⚠ A PATROL THAT COULD NOT DO ITS WORK IS THE ANSWER TO "WHY IS NOTHING HAPPENING", so it gets its
    // own note and names the thing to press rather than being the last clause of a muted paragraph.
    var zoneNotes = [];
    var pat = (st.patrols || {})[String(z.id)];
    var sm0 = z.sentries || c.sentries || {};
    var guarding = sm0.mode === 'remove' || sm0.mode === 'replace';
    if (pat && guarding) {
      if ((pat.refusals || []).length) {
        zoneNotes.push(note('bad', 'The last patrol could not do everything: ' + (pat.refusals || []).join(' — ')));
      } else if (pat.awake === true && pat.reached === 0 && (sm0.kinds || []).length) {
        zoneNotes.push(note('wait', 'A player is near and nothing to clear was found here. Press '
          + '"What is in this zone?" below to see what the game has in the rectangle.'));
      }
    }
    /**
     * ⚠ **ASLEEP IS THE ORDINARY STATE, AND THE CARD SAYS SO RATHER THAN SHOWING ZEROS.** SCUM puts
     * sentries, NPCs, animals and puppets into the world only around a player, so a zone nobody is
     * near has nothing in it to count and the plugin does not look. Three states, because "nobody is
     * near" and "where the players are could not be read" are opposite things to tell an owner.
     */
    if (pat && guarding) {
      var ago = Math.max(0, Math.round((Date.now() - pat.at) / 1000));
      var agoText = ago < 90 ? ago + 's' : Math.round(ago / 60) + ' min';
      if (pat.awake === false) {
        meta.push('Waiting for players: nobody within ' + metres(pat.wakeDistance) + ' m'
          + (pat.nearest != null ? ' (nearest ' + metres(pat.nearest) + ' m)'
            : (pat.playersOnline === 0 ? ' (nobody online)' : '')) + '.');
      } else if (pat.awake === null || pat.awake === undefined) {
        meta.push('Where the players are could not be read ' + agoText + ' ago, so nothing was done in '
          + 'this zone.');
      } else {
        var did = [];
        if (pat.stowed) did.push(pat.stowed + ' sentr' + (pat.stowed === 1 ? 'y' : 'ies') + ' put away');
        if (pat.removed) did.push(pat.removed + ' removed');
        if (pat.puppets) did.push(pat.puppets + ' zombie(s) removed');
        if (pat.spawned) did.push(pat.spawned + ' guard(s) sent');
        if (pat.inZone != null) {
          did.push(pat.inZone + (pat.maxGuards ? ' of at most ' + pat.maxGuards : '') + ' guard(s) standing');
        } else if (pat.posts) {
          did.push(pat.held + ' of ' + pat.posts + ' guard spot(s) held');
        }
        if (pat.killed) did.push(pat.killed + ' killed, back after the respawn time');
        meta.push('Active, a player is ' + (pat.nearest ? metres(pat.nearest) + ' m away' : 'inside')
          + (did.length ? ': ' + did.join(', ') : '') + ' (' + agoText + ' ago).');
      }
    } else if (guarding && live) {
      meta.push('The patrol has not run here yet.');
    }

    var when = (c.rotation === 'time') ? scheduleBlock(z, st) : null;

    // The zone's OWN guards, or the page's default. Asking for its own copies the current default
    // into it — an owner starts from what they already had, not from the shipped values — and giving
    // it up removes the block, which is what makes "falls back to the default" true rather than a
    // sentence about it.
    // ⚠ ONE PLACE. A zone used to fall back to a page-wide default unless it was switched to settings
    // of its own, which put the same controls on the screen twice. A zone with no settings of its own
    // now starts from a copy of that default — exactly what it was already following, so nothing about
    // it changes — and the zone is the only place they are edited.
    if (!z.sentries) z.sentries = JSON.parse(JSON.stringify(c.sentries || {}));
    var guards = h('div', { class: 'lz-when' }, guardControls(z.sentries, z.name || z.set));

    return h('div', { class: 'lz-zone' + (live ? ' on' : '') }, [
      head,
      h('div', { class: 'lz-zmeta' }, meta.join(' ')),
      zoneNotes.length ? h('div', { class: 'lz-live' }, zoneNotes) : null,
      when,
      guards,
      h('div', { class: 'lz-actions' }, [
        h('button', {
          class: 'secondary', type: 'button', onclick: function () {
            api('/activate', { method: 'POST', body: { id: z.id } }).then(function (r) {
              if (r && r.ok === false) SSA.toast(r.why || 'Refused');
              else if (r && r.unchanged) SSA.toast('That one is already on');
              else SSA.toast('Switched on');
              refresh();
            });
          },
        }, [icon('play'), 'Switch this one on now']),
        ((z.sentries || c.sentries || {}).mode !== 'leave') ? h('button', {
          class: 'secondary', type: 'button', onclick: function () {
            api('/guard-preview', { method: 'POST', body: { id: z.id } }).then(function (r) {
              if (r && r.error) return SSA.toast(r.error);
              var NAME = { sentry: 'Deployed sentries', mapsentry: 'Fixed map sentries', puppet: 'Puppets (zombies)' };
              // ⚠ BEFORE the counts, because it decides what they mean. A survey taken with
              // nobody in the zone reports zero of everything on a base full of sentries.
              var nobody = r.playersKnown === true && r.playersOnline === 0;
              var lines = (r.kinds || []).map(function (k) {
                var who = NAME[k.kind] || k.kind;
                if (k.error) return who + ': ' + k.error;
                return who + ': ' + k.inside + ' inside this zone — the search itself reached '
                  + k.found + ', and the ones outside the rectangle are left alone'
                  + (k.stowed ? '. ' + k.stowed + ' of those inside are already put away' : '')
                  // A fixed sentry is put away, which has its own switch; the removal switch the
                  // preview reports on does not decide it.
                  + (k.kind === 'mapsentry'
                    ? (r.stow && r.stow.allowed ? ''
                      : '. The bridge will not put this kind away yet — turn on "Put fixed map sentries '
                        + 'away instead of removing them" on its Removal card')
                    : (k.allowed ? '' : '. The bridge will not remove this kind yet'))
                  // ⚠ THE SENTENCE THAT WAS IMPOSSIBLE BEFORE. This button used to survey only the
                  // kinds already ticked, so the kind an owner had NOT chosen — which is the one
                  // they need to hear about — could never be reported. A naval base carries fixed
                  // emplacements and no deployed sentries at all.
                  + (k.inside > 0 && !k.ticked
                    ? '. ⚠ This zone is not set to clear these — switch on "'
                      + (k.kind === 'puppet' ? 'Keep zombies out' : 'Keep sentries out') + '".'
                    : '')
                  // ⚠ "THERE ARE NONE" IS A CLAIM ABOUT THE WORLD, and with nobody in the zone
                  // the world has not been asked. SCUM only puts sentries, NPCs, animals and
                  // puppets in around a player, so on a quiet server every kind reads zero on a
                  // base full of them.
                  + (k.inside === 0 && k.ticked && !nobody
                    ? '. This zone is set to clear that kind and there are none.' : '');
              });
              // Built as nodes, never as a string: a string body goes through innerHTML, and this
              // text is the bridge's own words rather than ours.
              SSA.modal({
                title: 'What is in this zone',
                body: h('div', { class: 'lz-lines' }, [
                  nobody ? h('p', { class: 'lz-note wait' }, 'Nobody is online. SCUM only puts '
                    + 'sentries, NPCs, animals and puppets into the world around a player — so every '
                    + 'count below is a zero about an empty server rather than about this zone. Ask '
                    + 'again while somebody is standing in it.') : null,
                  r.playersKnown === false ? h('p', { class: 'lz-note wait' }, 'Where the players '
                    + 'are could not be read, so it is not known whether anybody was near enough for '
                    + 'the game to have put anything here. Treat a zero below as unanswered.') : null,
                ].concat(lines.length
                  ? lines.map(function (t) { return h('p', {}, t); })
                  : [h('p', {}, nobody ? 'Nothing was in the world to find.' : 'Nothing found.')])),
              });
            });
          },
        }, [icon('eye'), 'What is in this zone?']) : null,
      ]),
    ]);
  }

  /** The entries that really name something to send. The same test the backend makes. */
  function chosenGuards(rp) {
    var list = (Array.isArray(rp.types) && rp.types.length) ? rp.types : [rp];
    return list.filter(function (t) {
      return t && String((t.route === 'persistent' ? t.spawnName : t.classPath) || '').trim();
    });
  }

  /**
   * Lift a pre-list configuration into the list, without changing what it means.
   *
   * Every configuration written before the list existed carries the single `route`/`classPath`/
   * `spawnName` beside it, and the backend reads an EMPTY list as exactly that — so seeding the list
   * from those fields changes no behaviour at all, and the screen can then have one shape instead of
   * two. Nothing is seeded when nothing was chosen: an empty list is an owner who has not picked a
   * guard, which is a real state and has its own sentence.
   */
  function normaliseGuards(sm) {
    if (!sm || typeof sm !== 'object') return;
    var rp = sm.replace || (sm.replace = {});
    if (!Array.isArray(rp.types)) rp.types = [];
    if (rp.types.length) return;
    if (!String((rp.route === 'persistent' ? rp.spawnName : rp.classPath) || '').trim()) return;
    rp.types = [{
      route: rp.route === 'persistent' ? 'persistent' : 'spawn',
      kind: rp.kind || 'npc', classPath: rp.classPath || '',
      spawnKind: rp.spawnKind || 'armednpc', spawnName: rp.spawnName || '',
      count: rp.count || 1, weight: 1, label: '',
    }];
  }


  /** The guard's own name, as the game spells it, for the line at the top of its entry. */
  function guardWordOf(t) {
    var raw = String((t.route === 'persistent' ? t.spawnName : t.classPath) || '').trim();
    if (!raw) return '';
    return raw.split('/').pop().split('.').pop().replace(/_C$/, '');
  }

  /** A guard's name as a person reads it: the catalogue's own name when it was picked, else the code tidied. */
  function prettyGuard(t) {
    var w = guardWordOf(t);
    return String(t.label || '').trim() || w.replace(/^BP_/, '').replace(/_/g, ' ') || 'nothing chosen';
  }

  /**
   * Who guards the zone: a row of names with a cross each, and one place to add another — an armed NPC,
   * a zombie or an animal through the game's own spawn, or a boss or other creature (Brenner, Razor,
   * drone, shark) put there directly, which is the only route the game leaves for those. This is the
   * ONLY guard list on the page; a guard someone set more than one to a spot shows that on its name.
   */
  var addKind = 'npcs';
  var ADD_KINDS = [['npcs', 'NPC'], ['zombies', 'Zombie'], ['animals', 'Animal'], ['creatures', 'Boss or creature']];
  var PERSISTENT_KIND = { npcs: 'armednpc', zombies: 'zombie', animals: 'animal' };
  function guardChips(rp) {
    var types = rp.types || (rp.types = []);
    var kids = types.map(function (t, i) {
      var n = Number(t.count) || 1;
      return h('span', { class: 'lz-chip' }, [prettyGuard(t) + (n > 1 ? ' \u00d7' + n : ''), h('button', {
        class: 'lz-chip-x', type: 'button', title: 'Remove ' + prettyGuard(t),
        onclick: function () { types.splice(i, 1); markDirty(); },
      }, '\u00d7')]);
    });
    var addPersistent = function (code, name) {
      types.push({ route: 'persistent', kind: 'npc', classPath: '', spawnKind: PERSISTENT_KIND[addKind] || 'armednpc',
        spawnName: code, count: 1, weight: 1, label: name || '' });
      markDirty();
    };
    var addDirect = function (code, name) {
      guardClasses().then(function (table) {
        var cls = (table.classes || {})[code];
        if (!cls) { SSA.toast('"' + (name || code) + '" cannot be placed as a guard in this build.'); return; }
        types.push({ route: 'spawn', kind: (table.kinds || {})[code] || 'npc', classPath: cls, spawnKind: 'armednpc',
          spawnName: '', count: 1, weight: 1, label: name || '' });
        markDirty();
      });
    };
    var add = function (code, name) { if (addKind === 'creatures') addDirect(code, name); else addPersistent(code, name); };
    var kindSel = sel(addKind, ADD_KINDS, function (v) { addKind = v; });
    kids.push(h('span', { class: 'lz-chips' }, [kindSel, canPick()
      ? h('button', {
        class: 'secondary', type: 'button', onclick: function () {
          Promise.resolve(SSA.pickItem({ domain: addKind, title: 'Add a guard' })).then(function (picked) {
            if (picked && picked.id) add(picked.id, picked.name);
          });
        },
      }, [icon('users'), 'Add'])
      : txt('', 'spawn name, e.g. BP_Guard_Lvl_5', function (v) { v = String(v || '').trim(); if (v) add(v, ''); })]));
    return h('div', { class: 'lz-chips' }, kids);
  }

  /**
   * The guard controls, for ONE settings object.
   *
   * The page's default and a zone's own override are the same screen over a different object, so
   * they are the same function. Two copies would be two screens to keep in step and the less-edited
   * one would quietly stop matching — which for a control that clears things out of a running world
   * is the wrong thing to be relaxed about.
   */
  function guardControls(sm, zoneName) {
    normaliseGuards(sm);
    var rp = sm.replace || (sm.replace = {});
    var gr = sm.globalRespawn || (sm.globalRespawn = {});
    var kinds = (sm.kinds || []).filter(Boolean);
    var has = function (k) { return kinds.indexOf(k) >= 0; };
    var sentriesOut = has('mapsentry') || has('sentry');
    var zombiesOut = has('puppet');
    var guardsOn = sm.mode === 'replace';
    /**
     * The three questions an owner actually has, and the mode follows from the answers.
     *
     * "What to do here" used to be a choice of three words that meant nothing until the rest of the
     * section had been read — and choosing "only clear" hid the guard list while a guard stayed
     * chosen, so a zone set up for guards sent none and the screen gave no clue why.
     */
    function apply(nextSentries, nextZombies, nextGuards) {
      var list = [];
      if (nextSentries) { list.push('mapsentry'); list.push('sentry'); }
      if (nextZombies) list.push('puppet');
      sm.kinds = list;
      sm.mode = nextGuards ? 'replace' : (list.length ? 'remove' : 'leave');
      markDirty();
    }
    var noSpot = guardsOn && !sentriesOut && !(Number(sm.ownPosts) > 0);
    return [
      row('Keep sentries out', toggle(sentriesOut, function (v) { apply(v, zombiesOut, guardsOn); }),
        'Sentries are put away while players are near, so the game does not build new ones.'),
      row('Keep zombies out', toggle(zombiesOut, function (v) { apply(sentriesOut, v, guardsOn); }),
        'Zombies do not spawn inside the zone, and any that walk in are removed.'),
      row('Guards of my own', toggle(guardsOn, function (v) { apply(sentriesOut, zombiesOut, v); }),
        'Your guards stand where the sentries stood.'),
      guardsOn ? row('Who', guardChips(rp)) : null,
      guardsOn ? row('At most in the zone at once', numIn(rp.maxGuards || 0, function (v) { rp.maxGuards = v; markDirty(); }, 0, 50, 'guards'),
        'Living guards of every kind together. 0 means no limit.') : null,
      guardsOn ? row('Respawn after a kill', numIn(rp.afterDeathSeconds, function (v) { rp.afterDeathSeconds = v; markDirty(); }, 0, 1440, 'minutes', MIN),
        'Only a guard somebody killed waits. One the game removed because nobody was near comes back as soon as somebody is.') : null,
      guardsOn && !chosenGuards(rp).length ? note('wait', 'Add a guard, or nobody is sent.') : null,
      noSpot ? note('bad', 'No sentries stand in this zone, so there is nowhere for a guard yet. Set "Extra guard spots" under More options.') : null,
      guardsOn && state.status && state.status.npcLimit === 0 ? note('', 'This server allows no NPCs, so guards exist only within about 150 m of a player.') : null,
      (sentriesOut || zombiesOut || guardsOn) ? more('guards:' + (zoneName || 'default'), 'More options', [
        guardsOn ? row('Extra guard spots', numIn(sm.ownPosts, function (v) { sm.ownPosts = v; markDirty(); }, 0, 60, 'spots'),
          'Spots laid out evenly in the rectangle, besides the places sentries stood.') : null,
        guardsOn ? row('Never appear within', numIn(rp.keepAwayFromPlayers, function (v) { rp.keepAwayFromPlayers = v; markDirty(); }, 0, 1000, 'm', M),
          'A spot this close to a player waits until they move on. 0 switches it off.') : null,
        guardsOn ? row('Wait between guards', numIn(rp.cooldownSeconds, function (v) { rp.cooldownSeconds = v; markDirty(); }, 0, 3600, 'seconds'),
          'How long the zone waits after sending one guard.') : null,
        guardsOn ? row('At most this many spots', numIn(rp.maxPosts, function (v) { rp.maxPosts = v; markDirty(); }, 1, 60, 'spots')) : null,
        guardsOn ? row('A spot counts as held within', numIn(rp.postRadius, function (v) { rp.postRadius = v; markDirty(); }, 2, 200, 'm', M),
          'Guards that walk, such as Drifters, are counted anywhere in the zone.') : null,
        row('Wake up within', numIn(sm.wakeDistance == null ? 40000 : sm.wakeDistance, function (v) { sm.wakeDistance = v; markDirty(); }, 50, 2000, 'm', M),
          'The zone is looked after only while a player is this close. Keep it over 300 m.'),
        row('Look every', numIn(sm.nearbyPatrolSeconds == null ? 5 : sm.nearbyPatrolSeconds, function (v) { sm.nearbyPatrolSeconds = v; markDirty(); }, 3, 60, 'seconds')),
        row('Where to search', h('div', { class: 'lz-routes' }, [
          h('small', {}, 'Height'),
          numIn(sm.centreZ, function (v) { sm.centreZ = v; markDirty(); }, null, null, 'm', M),
          h('small', {}, 'Up and down'),
          numIn(sm.reachZ, function (v) { sm.reachZ = v; markDirty(); }, 0, null, 'm', M),
        ]), 'The defaults suit any zone on the map.'),
        row('Also slow SCUM\'s own sentry respawn', toggle(!!gr.enabled, function (v) { gr.enabled = v; markDirty(); }),
          'For the whole island, not just this zone.'),
        gr.enabled ? row('Sentry respawn delay', numIn(gr.seconds, function (v) { gr.seconds = v; markDirty(); }, 0, 1440, 'minutes', MIN),
          'The game ships 10 minutes.') : null,
      ]) : null,
    ];
  }

  // ── the page ───────────────────────────────────────────────────────────────────────────────────
  /**
   * ⚠ `render()` EMPTIES THE ROOT BEFORE IT BUILDS ANYTHING, so anything it throws leaves a blank
   * tab — no error, no half-drawn form, nothing an owner can act on. That is what a report of "the
   * panel is empty" was, and a guard against the one cause found is not a guard against the next
   * one, so the whole of it is wrapped.
   */
  function render() {
    try { draw(); } catch (e) {
      try {
        root.innerHTML = '';
        root.appendChild(h('div', { class: 'lz-note bad' },
          'This tab could not draw itself: ' + ((e && e.message) || 'unknown error')
          + '. That is a fault in the plugin rather than in your settings — nothing has been changed.'));
      } catch (ignored) { /* nothing left to draw on */ }
      if (typeof console !== 'undefined' && console.error) console.error('[loot-zones]', e);
    }
  }

  function draw() {
    if (!root) return;
    root.innerHTML = '';
    var c = state.cfg;
    if (!c) {
      // Drawing a settings form out of nothing would let an owner "save" that nothing over what they
      // had, so this is reported instead — by name, with the two places the answer really comes from.
      root.appendChild(broken
        ? h('div', { class: 'lz-note bad' },
          'This tab could not read its own settings. The plugin\'s own routes answered nothing, which '
          + 'means its backend is not running rather than that anything is misconfigured — the tab '
          + 'itself is drawn from the installed manifest, so it appears either way. Check the manager '
          + 'log for a line naming loot-zones, and that the plugin is switched on and your licence is '
          + 'active: a plugin whose licence check has not come back is loaded as off, and its tab '
          + 'looks exactly like this.')
        : h('div', { class: 'lz-note' }, 'Loading…'));
      root.appendChild(h('div', { class: 'lz-actions' }, [
        h('button', { class: 'secondary', type: 'button', onclick: function () { refresh(); } },
          [icon('refresh'), 'Try again']),
      ]));
      return;
    }
    // Every nested read below is defended: the backend merges its own defaults, so a complete answer
    // is what a working install sends, and this is about the answers a broken one sends. One missing
    // key must cost that row, never the whole page.
    if (!c.zone) c.zone = {};
    if (!c.zone.colour) c.zone.colour = {};
    if (!c.messages) c.messages = {};
    if (!c.sentries) c.sentries = {};
    if (!Array.isArray(c.zones)) c.zones = [];
    var st = state.status || {};
    var sets = (state.sets && state.sets.sets) || [];

    // ── what is true right now ───────────────────────────────────────────────────────────────────
    var live = [];
    if (state.sets && state.sets.serverConfigured === false) {
      live.push(note('bad', 'No server directory is configured yet, so there is nowhere to put the loot files. '
        + 'Everything on this page can still be set up now.'));
    }
    if (state.sets && state.sets.readable === false) {
      live.push(note('bad', 'The sets folder does not exist yet: ' + (state.sets.root || '')
        + ' — create it and put one folder per zone in it, each with its own Zones.json.'));
    }
    if (st.zonesKnown === false) {
      live.push(note('', st.zonesUnknownWhy
        || 'The game has not sent the bridge its zone list yet, so nothing can be drawn on the map.'));
    }
    if (st.active && st.active.length) {
      live.push(note('good', 'Switched on: ' + st.active.map(function (a) {
        // Which of the two routes drew it, because "players can see this now" and "players will see
        // this when the server starts" are different facts and a rectangle looks the same either way.
        return (a.name || a.set) + (a.drawn === false ? ' (loot only — the rectangle is waiting)'
          : (a.drawnBy === 'save' ? ' (rectangle written into the save — visible when the server starts)' : ''));
      }).join(', ')));
    } else if (st.zonesKnown) {
      live.push(note('', 'No loot zone is switched on.'));
    }

    // ⚠ THE MOST IMPORTANT SENTENCE ON THIS PAGE. The rectangle appears at once and the loot behind
    // it does not: SCUM reads its Loot folder when it STARTS and at no other time, and the one
    // command that would make a running server re-read it crashes the game every time — so there is
    // nothing to offer instead of saying when it really lands.
    if (st.lootPending === true) {
      live.push(note('wait', 'The loot is WAITING. The files are on disk and the running game has not '
        + 'read them yet, so players still see the normal loot in there. Press "Reload loot now" '
        + '(needs SSA Bridge 2.22.2 or newer), or it lands when the server next starts. '
        + 'The rectangle on the map is already up.'
        + (st.nextRestartUnix ? ' The next restart the manager has scheduled is '
          + whenPhrase(st.nextRestartUnix) + ', and the loot lands then.'
          : ' Restart the server when it suits you and it lands then.')));
    } else if (st.lootPending === null && (st.active || []).length) {
      // Not knowing is its own answer. Saying "it is live" here would tell an owner their loot is
      // in when it may be waiting; saying "it is waiting" would send them to restart a server that
      // needs nothing.
      live.push(note('', 'Whether this loot is already live cannot be told from here: the manager was '
        + 'started while the server was already running, so it never saw the game read its Loot '
        + 'folder. If you switched this zone on since the last server start, the loot lands at the '
        + 'next one; the rectangle is up either way.'));
    }
    if (st.nextSwitchInMs > 0) {
      live.push(note('', 'The next switch is held for ' + Math.ceil(st.nextSwitchInMs / 60000)
        + ' more minute(s): every switch resets the searchable containers on the whole map, not just in the zone.'));
    }
    root.appendChild(h('div', { class: 'lz-live' }, live));

    // ── what this configuration needs in the bridge ──────────────────────────────────────────────
    var br = state.bridge;
    if (br) {
      var off = br.items.filter(function (x) { return x.state === 'off'; });
      var canOn = off.filter(function (x) { return x.ownerMay; });
      var gone = br.items.filter(function (x) { return x.state === 'missing'; });
      var kidsB = [];
      if (!br.items.length) {
        kidsB.push(note('', 'Nothing on this page needs the bridge yet.'));
      } else if (!off.length && !gone.length) {
        kidsB.push(note('good', 'Everything this page uses is switched on in the bridge.'));
      } else {
        off.forEach(function (x) {
          kidsB.push(h('div', { class: 'lz-need' }, [icon('alert'),
            h('span', {}, [h('b', {}, x.forWhat + ': '), x.moduleName + ' → ' + x.label
              + (x.manual ? ' (turn it on by hand in Settings, Bridge, SSA Bridge card, group In game, then restart the server)' : '')])]));
        });
        gone.forEach(function (x) {
          kidsB.push(h('div', { class: 'lz-need' }, [icon('close'),
            h('span', {}, [h('b', {}, x.forWhat + ': '), 'this bridge has no "' + x.label + '" — update the bridge'])]));
        });
        if (canOn.length) {
          kidsB.push(h('div', { class: 'lz-actions' }, [
            h('button', { type: 'button', onclick: function () { turnOnInBridge(canOn); } },
              [icon('check'), 'Turn ' + (canOn.length === 1 ? 'it' : 'them') + ' on in the bridge']),
          ]));
        }
        if (br.online === false) {
          kidsB.push(note('', 'The server is not running, so this is what the bridge will start with.'));
        }
      }
      root.appendChild(card('check-shield', 'Bridge', null, kidsB));
    }

    // The figures an owner opens this tab to see. They were in prose inside each zone, which is the
    // right place for the detail and the wrong place for the answer to "is this working at all".
    var held = 0; var postsAll = 0; var guardsUp = 0;
    Object.keys(st.patrols || {}).forEach(function (k) {
      var p = st.patrols[k] || {};
      held += Number(p.held) || 0;
      postsAll += Number(p.posts) || 0;
      guardsUp += Number(p.spawned) || 0;
    });
    var enabledZones = (c.zones || []).filter(function (z) { return z.enabled !== false; }).length;
    root.appendChild(h('div', { class: 'lz-figs' }, [
      h('div', { class: 'lz-fig' }, [h('b', {}, String((c.zones || []).length)), h('span', {}, 'zones')]),
      h('div', { class: 'lz-fig' }, [h('b', {}, String(enabledZones)), h('span', {}, 'in rotation')]),
      h('div', { class: 'lz-fig' + ((st.active || []).length ? ' good' : '') },
        [h('b', {}, String((st.active || []).length)), h('span', {}, 'live now')]),
      postsAll ? h('div', { class: 'lz-fig' + (held < postsAll ? ' wait' : ' good') },
        [h('b', {}, held + '/' + postsAll), h('span', {}, 'posts held')]) : null,
      guardsUp ? h('div', { class: 'lz-fig' }, [h('b', {}, String(guardsUp)), h('span', {}, 'guards sent')]) : null,
    ].filter(Boolean)));

    // ── the zones ────────────────────────────────────────────────────────────────────────────────
    var kids = (c.zones || []).map(function (z, i) { return zoneBlock(z, i, c, sets, st); });
    if (!(c.zones || []).length) {
      kids.push(note('', sets.length
        ? 'No zones yet. Add one and pick a loot set for it.'
        : 'No loot sets found. Put one folder per zone into the sets folder above, each with its own '
          + 'Zones.json — the same folders SCUM\'s own #ExportItemSpawnerPresetsInZone writes.'));
    }
    kids.push(h('div', { class: 'lz-actions' }, [
      h('button', {
        type: 'button', onclick: function () {
          c.zones = (c.zones || []).concat([{
            id: 'z' + Date.now().toString(36), name: '', set: sets.length ? sets[0].name : '',
            enabled: true, windows: [],
          }]);
          markDirty();
        },
      }, [icon('box'), 'Add a zone']),
    ]));
    root.appendChild(card('list', 'Zones',
      'One entry per loot set. The rectangle comes from that set\'s own Zones.json and is never '
      + 'copied here, so the two cannot disagree.', kids));

    // ── what players are told ────────────────────────────────────────────────────────────────────
    root.appendChild(card('chat', 'What players are told',
      'Four messages. Leave one empty to switch it off.', [
      row('Chat channel', sel(c.chatChannel, [
        ['global', 'Global'], ['local', 'Local'], ['squad', 'Squad'],
        ['admin', 'Admin'], ['server', 'Server'],
      ], function (v) { c.chatChannel = v; markDirty(); }),
        'Used by every message below that goes to chat. Server is the channel the game keeps for the '
        + 'server\'s own voice, which is what an announcement about the loot is; Local only reaches '
        + 'players standing near whoever the line is sent through.'),
    ].concat(MESSAGES.map(function (d) { return messageBlock(d, c); }))));

    // ── the zone as players meet it ──────────────────────────────────────────────────────────────
    var own = c.zone.configMode === 'own';
    root.appendChild(card('map', 'The rectangle players see',
      'Its name, its colour and whether players see it. It appears straight away; the loot behind it waits for a restart.', [
      row('Zone name prefix', txt(c.zone.namePrefix, 'Loot ', function (v) { c.zone.namePrefix = v; markDirty(); }),
        'The zone\'s own name follows it. ⚠ This is also the ONLY thing that tells this plugin\'s zones '
        + 'apart from the ones you drew yourself, so it can never be empty — with it blank every zone '
        + 'on the server would count as ours. No colon either: the bridge\'s zone commands are '
        + 'colon-separated and the name comes first. Changing it while something is live orphans that '
        + 'zone, so switch everything off first.'),
      row('Colour and visibility', sel(c.zone.configMode, [
        ['existing', 'Use one of my existing zone configurations'],
        ['own', 'Keep a configuration of its own'],
      ], function (v) { c.zone.configMode = v; markDirty(); }),
        'A zone\'s colour, whether players see it and whether walking in tells them all belong to a '
        + 'CONFIGURATION rather than to the zone. That is the game\'s own shape; this only chooses '
        + 'which one to point at.'),
      !own ? row('Configuration number', numIn(c.zone.configIndex, function (v) { c.zone.configIndex = v; markDirty(); }, 0, 99, ''),
        st.configs && st.configs.length
          ? 'This server has: ' + st.configs.map(function (x) { return x.index + ' = ' + (x.name || '(unnamed)'); }).join(', ')
          : 'The list appears here once the game has sent its zones.') : null,
      own ? row('Its name', txt(c.zone.ownConfigName, 'Loot Zones', function (v) { c.zone.ownConfigName = v; markDirty(); }),
        'Created once if it is not there, and found by this name every time after — never by a '
        + 'remembered number, because deleting a configuration renumbers every one above it.') : null,
      own ? row('Players can see it on the map', toggle(!!c.zone.visibleOnMap, function (v) { c.zone.visibleOnMap = v; markDirty(); })) : null,
      own ? row('Walking in tells them', toggle(!!c.zone.notifyOnEntry, function (v) { c.zone.notifyOnEntry = v; markDirty(); }),
        'The game\'s own entry notification, which is separate from the messages below.') : null,
      own ? row('Colour', colourIn(c.zone.colour, function () { markDirty(); render(); }),
        'The colour players see the zone in on the map, and how see-through it is.') : null,
    ]));

    // ── settings ─────────────────────────────────────────────────────────────────────────────────
    root.appendChild(card('sliders', 'How zones are chosen',
      'Which loot zone is live, and what may change it.', [
      row('Rotation on', toggle(!!c.enabled, function (v) { c.enabled = v; markDirty(); }),
        'Off leaves whatever is switched on exactly as it is; it does not remove a live zone.'),
      row('How zones change', sel(c.rotation, [
        ['manual', 'Only by hand, from this page'],
        ['time', 'On a schedule, per zone'],
        ['restart', 'One zone per server restart'],
      ], function (v) { c.rotation = v; markDirty(); }),
        c.rotation === 'time'
          ? 'Each zone below carries its own days and hours. A zone with no schedule is always on.'
          : (c.rotation === 'restart'
            ? 'One zone is taken in turn, and it is chosen the moment the SERVER STOPS — its own '
              + 'restart, not the manager\'s. SCUM only reads its Loot folder as it starts, so putting '
              + 'the files there while the game runs would mean the zone went live a whole session '
              + 'late. A manager that restarts while the game keeps running re-applies the zone this '
              + 'session already has rather than moving the loot under your players.'
            : '')),
      c.rotation === 'time' && state.clock ? note('', 'Times below are read on the MANAGER\'S clock, '
        + 'which says ' + state.clock.now.hhmm + ' right now'
        + ((state.clock.zone && state.clock.zone.label) ? ' (' + state.clock.zone.label + ')' : '')
        + '. Not the game\'s day cycle: that has no day of the week and runs at your own speed '
        + 'multiplier, so a two-hour window in it would open several times a night.') : null,
      c.rotation === 'restart' ? row('Which one', sel(c.restartPick, [
        ['order', 'In turn, down the list'],
        ['random', 'At random'],
      ], function (v) { c.restartPick = v; markDirty(); })) : null,
      more('rotation', 'More options', [
      row('Zones at once', numIn(c.maxActive, function (v) { c.maxActive = v; markDirty(); }, 1, 10, 'zones'),
        'The game allows several. Each one is another folder the game reads when it starts.'),
      row('Time between switches', numIn(c.minMinutesBetweenSwitches, function (v) { c.minMinutesBetweenSwitches = v; markDirty(); }, 0, 1440, 'minutes'),
        'A floor under how often the loot files may be swapped. Switching a zone off counts as a '
        + 'switch. It matters most on a server that is restarting over and over: without it, a crash '
        + 'loop would walk through every zone you have.'),
      row('Reload loot after a switch', toggle(c.reloadOnSwitch !== false, function (v) { c.reloadOnSwitch = v; markDirty(); }),
        'On a running server the zone\'s loot goes live at once. The game resets every searchable container on the whole map when it reloads. Needs SSA Bridge 2.22.2 or newer.'),
      row('Check every', numIn(c.checkEverySeconds, function (v) { c.checkEverySeconds = v; markDirty(); }, 15, 3600, 'seconds'),
        'How often the schedule is looked at, and how often a rectangle that could not be drawn is tried again.'),
      row('Loot sets folder', txt(c.setsDir, (state.sets && state.sets.root) || '', function (v) { c.setsDir = v; markDirty(); }, 'lz-in lz-wide'),
        'Leave it empty for the plugin\'s own folder'
        + ((state.sets && state.sets.root) ? ': ' + state.sets.root : '.')),
      ]),
    ]));

    // ── everything else ──────────────────────────────────────────────────────────────────────────
    root.appendChild(card('cog', 'Actions',
      'Nothing here is a setting — each one does something to the server now.', [
      h('div', { class: 'lz-actions' }, [
        h('button', {
          class: 'secondary', type: 'button', onclick: function () {
            SSA.confirm('Switch every loot zone off and put the loot back to normal?').then(function (yes) {
              if (!yes) return;
              api('/deactivate', { method: 'POST', body: { force: true } }).then(function () {
                SSA.toast('Everything is off'); refresh();
              });
            });
          },
        }, [icon('stop'), 'Switch everything off']),
        // Back since bridge 2.22.2, which runs the command on the game thread. An older bridge is
        // refused by the backend with a sentence, never sent the command that crashed it.
        h('button', {
          class: 'secondary', type: 'button', onclick: function () {
            SSA.confirm('Reload loot now? The running game reads the loot files again and resets every searchable container on the whole map.').then(function (yes) {
              if (!yes) return;
              api('/reload-loot', { method: 'POST', body: {} }).then(function (r) {
                SSA.toast(r && r.ok ? 'Loot reloaded' : ((r && r.why) || 'The reload was not confirmed'));
                refresh();
              });
            });
          },
        }, [icon('refresh'), 'Reload loot now']),
        h('button', {
          class: 'secondary', type: 'button', onclick: function () {
            api('/reconcile', { method: 'POST', body: {} }).then(function (r) {
              if (r && r.skipped) SSA.toast('The game has not sent its zone list yet');
              else {
                var n = ((r && r.strayZones) || []).length + ((r && r.strayFolders) || []).length;
                SSA.toast(n ? ('Cleared ' + n + ' leftover(s)') : 'The game agrees with this page');
              }
              refresh();
            });
          },
        }, [icon('check-shield'), 'Check against the game']),
      ]),
      note('', 'With SSA Bridge 2.22.2 or newer, a switch on a running server reloads the loot at once '
        + '(see "Reload loot after a switch" above). With an older bridge the loot lands at the next '
        + 'server start. The rectangle on the map appears straight away either way.'),
    ]));

    root.appendChild(h('div', { class: 'lz-save' }, [
      h('button', { class: unsaved ? '' : 'secondary', type: 'button', onclick: save }, 'Save'),
      h('span', { class: 'lz-dirty' + (unsaved ? ' unsaved' : '') },
        [icon(unsaved ? 'alert' : 'check'), unsaved ? 'Unsaved changes' : 'Everything is saved']),
    ]));
  }

  // ⚠ The option names are the SDK's, and getting one wrong is SILENT. `registerTab` reads
  // `opts.render` and falls back to an empty function, so a tab passing `mount` registers, appears
  // in the nav, opens, and draws nothing at all — which is exactly what it looks like when a plugin
  // failed to load, and sends whoever is looking at the backend instead. `label` and an icon with
  // its `#i-` prefix are read the same way, each with a quiet fallback of its own.
  //
  // `render(container)` is called EVERY time the tab is opened, and the container is emptied first,
  // so everything that has to survive being reopened is re-armed here.
  SSA.ready(function () {
    SSA.registerTab({
      id: 'loot-zones',
      label: 'Loot Zones',
      icon: '#i-box',
      premium: true,
      render: function (container) {
        root = container;
        root.classList.add('lz');
        refresh();
        // One timer across opens, or reopening the tab stacks them.
        if (poll) clearInterval(poll);
        poll = setInterval(function () {
          // `quiet`: a poll must not redraw over somebody who is halfway through typing. A refresh
          // the OWNER asked for still redraws, because they are not typing when they press a button.
          if (root && document.body.contains(root)) refresh({ quiet: true });
          else { clearInterval(poll); poll = null; }
        }, 15000);
      },
    });
  });
})();
