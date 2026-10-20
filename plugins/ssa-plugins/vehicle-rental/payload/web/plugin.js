/* Vehicle Rental — the admin tab.

   Five screens under one nav: Fleet (the vehicles and their plans, each with its own switch),
   Rentals (what is out now, and what has finished), Activity (everything the plugin did or refused,
   and what it is doing now), Messages (every line a player reads, a tab per language) and Settings
   (the master switches, the limits, the chat words, Discord). Everything here can be set with the
   server stopped; only the live counts, the rentals and the log wait for a running game.

   Every word an ADMIN reads on this screen goes through the panel's translator, with the English
   written beside the key: a language nobody has translated yet renders exactly what it renders
   today. What an OWNER TYPES is deliberately not translated — the in-game message templates and
   their {tokens}, the command names, the spawn and remove templates, plan names and sector codes
   are their data and the game's, not our chrome. Only the labels in front of those boxes are. */
(function () {
  // The panel's translator, bound once. Every key is written out in full at its call site: a key
  // built from a variable cannot be seen by anything that checks the catalogue against the screen,
  // so a table of labels is a FUNCTION returning literal calls rather than an array of strings.
  var T = SSA.t;
  // The manager's own client, captured at the top of the script: `SSA.api` resolves the calling
  // plugin at call time, and every real call here is a poll tick, a click or a `.then`, where that
  // binding is already gone. A failed request rejects, and every catch below says so in words.
  var api = SSA.apiClient();
  function why(err) { return SSA.apiError(err); }
  /**
   * The address of each screen: `#plugins/p/vehicle-rental/<screen>`, and `…/vehicle/<id>` for one
   * vehicle's editor. The nav and every Edit are real links, so a middle click opens a screen in a
   * new tab and Back walks back through what was opened. A manager older than the hook has no
   * `SSA.route`: the links still carry an address and a plain click still works in place.
   */
  var ROUTE = (SSA.route && typeof SSA.route.client === 'function') ? SSA.route.client() : null;
  var onRoute = null;
  if (ROUTE) ROUTE.onChange(function (sub) { if (onRoute) onRoute(sub); });

  function h(tag, props, kids) {
    var e = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      if (k === 'class') e.className = props[k]; else if (k === 'html') e.innerHTML = props[k]; else if (k === 'text') e.textContent = props[k];
      else if (k.slice(0, 2) === 'on' && typeof props[k] === 'function') e.addEventListener(k.slice(2), props[k]);
      else if (props[k] != null && props[k] !== false) e.setAttribute(k, props[k] === true ? '' : props[k]);
    });
    (Array.isArray(kids) ? kids : (kids != null ? [kids] : [])).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    // An icon button is named by aria-label; its title is the localised name, so it is that too.
    if (tag === 'button' && e.title && !e.hasAttribute('aria-label') && !e.textContent.trim()) e.setAttribute('aria-label', e.title);
    return e;
  }
  function icon(id) { return SSA.icon ? SSA.icon(id) : null; }
  function escHtml(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var markDirty = function () {};

  function inp(label, get, set, o) {
    o = o || {}; var ctl;
    if (o.type === 'select') ctl = h('select', { onchange: function () { set(ctl.value); markDirty(); } }, (o.options || []).map(function (op) { return h('option', { value: op[0] }, op[1]); }));
    else {
      // `min` and `max` are passed through AND enforced on the value. The attribute alone only stops
      // the spinner arrows; a number typed straight in still reaches the config.
      ctl = h('input', {
        type: o.type || 'text', placeholder: o.ph || '', min: o.min, max: o.max,
        oninput: function () {
          if (o.type !== 'number') { set(ctl.value); markDirty(); return; }
          var n = Number(ctl.value);
          if (o.min != null && ctl.value !== '' && n < Number(o.min)) { n = Number(o.min); ctl.value = String(n); }
          if (o.max != null && ctl.value !== '' && n > Number(o.max)) { n = Number(o.max); ctl.value = String(n); }
          set(n);
          markDirty();
        },
      });
    }
    ctl.value = get() == null ? '' : get();
    // A picture address gets the manager's own control: an Upload button and a preview beside the
    // box. An older manager has no `SSA.imageField` and keeps the plain box.
    if (o.image && window.SSA && typeof SSA.imageField === 'function') {
      return h('div', { class: 'vr-f' }, [h('span', {}, label), SSA.imageField({ input: ctl, label: label }).el]);
    }
    return h('label', { class: 'vr-f' }, [h('span', {}, label), ctl]);
  }
  /** A text everyone reads in one language (a channel's button), as a box that grows with its words. */
  function area(label, get, set, o) {
    o = o || {};
    var ta = h('textarea', { class: 'vr-area', rows: 1, placeholder: o.ph || '', maxlength: o.max || null });
    function grow() { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; }
    ta.addEventListener('input', function () { set(ta.value); markDirty(); grow(); });
    ta.value = get() == null ? '' : get();
    setTimeout(grow, 0);
    return h('label', { class: 'vr-f vr-f-wide' }, [h('span', {}, label), ta]);
  }
  /** The house on/off switch: a real checkbox under a track, named by the label beside it. */
  function switchEl(on, onchange, label) {
    var b = h('input', { type: 'checkbox', 'aria-label': label || null, onchange: function () { onchange(b.checked); markDirty(); } });
    b.checked = !!on;
    return h('label', { class: 'vr-switch', title: label || null }, [b, h('span', { class: 'vr-switch-t' })]);
  }
  /** A setting that is a switch: the switch, its name, and one line saying what it does. */
  function switchRow(label, hint, get, set) {
    return h('div', { class: 'vr-row' }, [
      switchEl(get(), set, label),
      h('div', { class: 'vr-row-t' }, [h('b', {}, label), hint ? h('span', {}, hint) : null]),
    ]);
  }
  /**
   * A limit with its own switch. The number is the setting and 0 has always meant "no limit", so the
   * switch is that rule made visible: off stores 0, on puts back the number it had (or a sensible
   * first one). Nothing new is stored, so every config written before this opens exactly as it was.
   */
  function limitRow(label, hint, unit, get, set, o) {
    o = o || {};
    var last = Number(get()) > 0 ? Number(get()) : (o.def || 1);
    var num = h('input', { type: 'number', class: 'vr-num', min: o.min != null ? o.min : 1, max: o.max, step: 1 });
    num.value = Number(get()) > 0 ? String(get()) : String(last);
    var sw;
    function paint() { var on = Number(get()) > 0; num.disabled = !on; sw.querySelector('input').checked = on; }
    num.addEventListener('input', function () {
      var n = Math.round(Number(num.value));
      if (!Number.isFinite(n)) return;
      if (o.max != null && n > o.max) { n = o.max; num.value = String(n); }
      if (n < 1) return;
      last = n; set(n); markDirty();
    });
    sw = switchEl(Number(get()) > 0, function (on) { set(on ? last : 0); paint(); }, label);
    var row = h('div', { class: 'vr-row' }, [
      sw,
      h('div', { class: 'vr-row-t' }, [h('b', {}, label), hint ? h('span', {}, hint) : null]),
      h('label', { class: 'vr-row-n' }, [num, unit ? h('span', {}, unit) : null]),
    ]);
    paint();
    return row;
  }
  function card(title, kids, sub, tools) {
    return h('div', { class: 'card vr-card' }, [
      h('div', { class: 'vr-card-hd' }, [h('h3', { class: 'vr-card-t' }, title), tools ? h('div', { class: 'vr-card-tools' }, tools) : null]),
      sub ? h('p', { class: 'vr-card-sub' }, sub) : null,
    ].concat(kids));
  }

  // ── Time windows ────────────────────────────────────────────────────────────────────────────────
  //
  // "From when to when is this available." The same control, the same words and the same evaluator
  // as every other plugin that offers it — the manager owns the rule (`host.time`) and this draws
  // what it says rather than working it out again. The clock is the SERVER'S, and the note under
  // every editor says so: SCUM's day has no weekday and runs at the server's own speed.
  function twDayNames() {
    return [T('pl.vehicle-rental.tw.mon', 'Mon'), T('pl.vehicle-rental.tw.tue', 'Tue'),
      T('pl.vehicle-rental.tw.wed', 'Wed'), T('pl.vehicle-rental.tw.thu', 'Thu'),
      T('pl.vehicle-rental.tw.fri', 'Fri'), T('pl.vehicle-rental.tw.sat', 'Sat'),
      T('pl.vehicle-rental.tw.sun', 'Sun')];
  }
  var twClock = null;                      // { supported, now, zone } — asked once per tab
  function twClockLine() {
    if (!twClock) return '';
    if (twClock.supported === false) return twClock.why || T('pl.vehicle-rental.tw.unsupported', 'This manager cannot evaluate time windows.');
    var z = twClock.zone || {}, n = twClock.now || {};
    return T('pl.vehicle-rental.tw.clockLine', 'Server clock: {time} {zone}. This is real time, not in-game time.',
      { time: n.hhmm || '??:??', zone: z.label || T('pl.vehicle-rental.tw.serverTime', 'server time') });
  }
  function twLoadClock(then) {
    if (twClock) { then(); return; }
    api('/clock').then(function (c) { twClock = c || { supported: false }; then(); })
      .catch(function (err) { twClock = { supported: false, why: why(err) }; then(); });
  }
  /** The editor for one `windows` list: on the whole system, a vehicle or a plan. */
  function twEditor(owner) {
    var box = h('div', { class: 'tw' });
    var rows = h('div', { class: 'tw-rows' });
    var note = h('p', { class: 'tw-note' }, T('pl.vehicle-rental.tw.always', 'Always available — no time window is set.'));
    var clockNote = h('p', { class: 'tw-clock' }, '');
    var add = h('button', {
      type: 'button', class: 'tw-add',
      onclick: function () {
        owner.windows = (owner.windows || []).concat([{ days: [], from: '20:00', to: '22:00' }]);
        markDirty(); draw();
      },
    }, T('pl.vehicle-rental.tw.add', '+ Add a time window'));
    var seq = 0;
    function preview() {
      var list = owner.windows || [];
      if (!list.length) { note.className = 'tw-note'; note.textContent = T('pl.vehicle-rental.tw.always', 'Always available — no time window is set.'); return; }
      // Only the LAST answer may paint, or an earlier reply describes a window already changed.
      var mine = ++seq;
      api('/clock/preview', { method: 'POST', body: { windows: list } }).then(function (r) {
        if (mine !== seq) return;
        if (!r || r.supported === false) {
          note.className = 'tw-note bad';
          note.textContent = T('pl.vehicle-rental.tw.cannotEvaluate',
            '⚠ This manager cannot check time windows, so they count as closed. Update or remove them.');
          return;
        }
        if (r.errors && r.errors.length) { note.className = 'tw-note bad'; note.textContent = '⚠ ' + r.errors.join(' · '); return; }
        note.className = 'tw-note' + (r.open ? ' ok' : '');
        note.textContent = r.text + '  ' + (r.open ? T('pl.vehicle-rental.tw.openNow', '● Open right now.') : T('pl.vehicle-rental.tw.shutNow', '○ Shut right now.'));
      }).catch(function () { /* the note simply keeps its last good text */ });
    }
    function dayChips(w) {
      // An empty list means EVERY DAY, so all seven read as on; clicking one turns that day off.
      var chosen = (w.days && w.days.length) ? w.days.slice() : [1, 2, 3, 4, 5, 6, 7];
      return twDayNames().map(function (name, i) {
        var d = i + 1, on = chosen.indexOf(d) >= 0;
        return h('button', {
          type: 'button', class: 'tw-day' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false',
          onclick: function () {
            var next = chosen.slice();
            var at = next.indexOf(d);
            if (at >= 0) next.splice(at, 1); else next.push(d);
            next.sort(function (a, b) { return a - b; });
            // All seven and none at all are the same thing — every day — stored as an empty list.
            w.days = (next.length === 7 || next.length === 0) ? [] : next;
            markDirty(); draw();
          },
        }, name);
      });
    }
    function draw() {
      rows.innerHTML = '';
      (owner.windows || []).forEach(function (w, idx) {
        var from = h('input', { type: 'time', class: 'tw-t', value: w.from || '' });
        from.addEventListener('input', function () { w.from = from.value; markDirty(); preview(); });
        var to = h('input', { type: 'time', class: 'tw-t', value: w.to || '' });
        to.addEventListener('input', function () { w.to = to.value; markDirty(); preview(); });
        rows.appendChild(h('div', { class: 'tw-row' }, [
          h('div', { class: 'tw-days' }, dayChips(w)),
          h('div', { class: 'tw-times' }, [h('span', {}, T('pl.vehicle-rental.tw.from', 'from')), from, h('span', {}, T('pl.vehicle-rental.tw.to', 'to')), to]),
          h('button', {
            type: 'button', class: 'tw-del', title: T('pl.vehicle-rental.tw.removeWindow', 'Remove this window'),
            onclick: function () { owner.windows.splice(idx, 1); if (!owner.windows.length) delete owner.windows; markDirty(); draw(); },
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

  // Vehicle spawn-code field with a live typeahead sourced from the item database. Picking a result
  // fills the code (the record's own BPC_ blueprint id) and, if empty, the name and image too.
  var CODE_RX = /^BPC_[A-Za-z0-9_]+$/;
  function vehField(v, refresh) {
    var input = h('input', { type: 'text', placeholder: T('pl.vehicle-rental.veh.searchPh', 'Search vehicles… or type a code'), autocomplete: 'off' });
    input.value = v.code || '';
    var menu = h('div', { class: 'vr-ac-menu' });
    var tmr = null;
    function hide() { menu.style.display = 'none'; menu.innerHTML = ''; }
    function search() {
      fetch('/api/public/items?domain=vehicles&q=' + encodeURIComponent(input.value.trim()), { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var items = (d && d.items) || [];
          menu.innerHTML = '';
          if (!items.length) { hide(); return; }
          items.slice(0, 24).forEach(function (it) {
            // The record's OWN spawn blueprint; a record that names none cannot be picked.
            var code = String(it.spawn_code || '');
            if (!CODE_RX.test(code)) return;
            var nm = it.name || code;
            var img = it.image || '';
            var row = h('div', { class: 'vr-ac-row' }, [
              img ? h('img', { src: img, alt: '', loading: 'lazy' }) : h('span', { class: 'vr-ac-ph' }),
              h('span', { class: 'vr-ac-n' }, nm),
              h('span', { class: 'vr-ac-c' }, code),
            ]);
            // pointerdown, not mousedown: a touch device synthesises mousedown only after the finger
            // lifts, which races the blur that hides this list.
            row.addEventListener('pointerdown', function (e) {
              e.preventDefault();
              v.code = code; if (!v.name) v.name = nm; if (!v.image && img) v.image = img;
              markDirty(); refresh();
            });
            menu.appendChild(row);
          });
          if (!menu.children.length) { hide(); return; }
          menu.style.display = 'block';
        }).catch(function () {
          // The search never ran, which is not the same thing as "no vehicle matched".
          menu.innerHTML = '';
          menu.appendChild(h('div', { class: 'vr-ac-msg' }, T('pl.vehicle-rental.veh.searchFailed', 'Could not search — check the connection and try again.')));
          menu.style.display = 'block';
        });
    }
    // A SEARCH BOX and a value at once: only a real blueprint id is committed, and search text that
    // resolves to nothing reverts to the last good code on blur.
    input.addEventListener('input', function () {
      var t = input.value.trim();
      if (!t || CODE_RX.test(t)) { v.code = t; input.classList.remove('vr-ac-bad'); markDirty(); }
      else input.classList.add('vr-ac-bad');
      clearTimeout(tmr); tmr = setTimeout(search, 220);
    });
    input.addEventListener('focus', search);
    input.addEventListener('blur', function () {
      setTimeout(function () {
        hide();
        var t = input.value.trim();
        if (t && !CODE_RX.test(t)) {
          input.value = v.code || '';
          input.classList.remove('vr-ac-bad');
          try {
            SSA.toast(T('pl.vehicle-rental.veh.notACode', '“{text}” is a search, not a spawn code. Pick a vehicle from the list.', { text: t }), 'error');
          } catch (e) { /* toast optional */ }
        }
      }, 160);
    });
    return h('label', { class: 'vr-f' }, [h('span', {}, T('pl.vehicle-rental.veh.spawnCode', 'Spawn code')), h('div', { class: 'vr-ac' }, [input, menu])]);
  }

  /* THE FIVE SCREEN NAMES, IN ONE PLACE. The nav, the first-run note and every sentence that sends
   * an owner to a screen read the SAME key, so none of them can point at a screen that is not there. */
  function navLabels() {
    return {
      fleet: T('pl.vehicle-rental.nav.fleet', 'Fleet'),
      rentals: T('pl.vehicle-rental.nav.rentals', 'Rentals'),
      activity: T('pl.vehicle-rental.nav.activity', 'Activity'),
      messages: T('pl.vehicle-rental.nav.messages', 'Messages'),
      settings: T('pl.vehicle-rental.nav.settings', 'Settings'),
    };
  }
  var VIEWS = ['fleet', 'rentals', 'activity', 'messages', 'settings'];

  /**
   * Every line a player can read: [config key, label, group]. THIS LIST IS THE ORDER AND THE LABEL,
   * NEVER THE SET — the Messages screen draws every key the backend has, and one this build has no
   * label for gets its key humanised rather than disappearing. The same labels name a refusal's
   * reason on the Activity screen, so a reason there and the line that said it share one name.
   */
  function messageLines() {
    return [
      ['confirmed', T('pl.vehicle-rental.text.confirmed', 'Rental confirmed'), 'chat'],
      ['endingSoon', T('pl.vehicle-rental.text.endingSoon', 'Ending soon'), 'chat'],
      ['ended', T('pl.vehicle-rental.text.ended', 'Rental ended'), 'chat'],
      ['returned', T('pl.vehicle-rental.text.returned', 'Returned early'), 'chat'],
      ['rentUsage', T('pl.vehicle-rental.text.rentUsage', 'Rent — usage / list'), 'chat'],
      ['noRentals', T('pl.vehicle-rental.text.noRentals', 'No active rentals'), 'chat'],
      ['mineLine', T("pl.vehicle-rental.text.mineLine", "One line of \"my rentals\""), 'chat'],
      ['extendOk', T('pl.vehicle-rental.text.extendOk', 'Extended'), 'chat'],
      ['pickPlan', T('pl.vehicle-rental.text.pickPlan', 'Pick a plan'), 'chat'],
      ['notAllowedHere', T('pl.vehicle-rental.text.notAllowedHere', 'Sector not allowed'), 'refusal'],
      ['disabled', T('pl.vehicle-rental.text.disabled', 'Rentals disabled'), 'refusal'],
      ['offerOff', T('pl.vehicle-rental.text.offerOff', 'Vehicle or plan switched off'), 'refusal'],
      ['closedNow', T('pl.vehicle-rental.text.closedNow', 'Outside its hours'), 'refusal'],
      ['noVehicles', T('pl.vehicle-rental.text.noVehicles', 'Nothing to rent yet'), 'refusal'],
      ['returnOff', T('pl.vehicle-rental.text.returnOff', 'Early return is off'), 'refusal'],
      ['nothingToReturn', T('pl.vehicle-rental.text.nothingToReturn', 'Nothing to return'), 'refusal'],
      ['extendOff', T('pl.vehicle-rental.text.extendOff', 'Extending is off'), 'refusal'],
      ['extendMaxed', T('pl.vehicle-rental.text.extendMaxed', 'Extension limit reached'), 'refusal'],
      ['returnNoBridge', T('pl.vehicle-rental.text.returnNoBridge', 'Return could not be carried out'), 'refusal'],
      ['limitActive', T('pl.vehicle-rental.text.limitActive', 'Limit — too many active rentals'), 'refusal'],
      ['limitActiveVehicle', T('pl.vehicle-rental.text.limitActiveVehicle', 'Limit — too many of this vehicle'), 'refusal'],
      ['tooOften', T('pl.vehicle-rental.text.tooOften', 'Limit — cooldown not over'), 'refusal'],
      ['limitDaily', T('pl.vehicle-rental.text.limitDaily', 'Limit — daily limit reached'), 'refusal'],
      ['limitDailyVehicle', T('pl.vehicle-rental.text.limitDailyVehicle', 'Limit — daily limit for this vehicle'), 'refusal'],
      ['busy', T('pl.vehicle-rental.text.busy', 'Rent — still being processed'), 'refusal'],
      ['noStorage', T('pl.vehicle-rental.text.noStorage', 'Rent — storage problem'), 'refusal'],
      ['badChoice', T('pl.vehicle-rental.text.badChoice', 'Rent — invalid choice'), 'refusal'],
      ['noSpawnCode', T('pl.vehicle-rental.text.noSpawnCode', 'Rent — vehicle has no spawn code'), 'refusal'],
      ['badDuration', T('pl.vehicle-rental.text.badDuration', 'Rent — plan duration is negative'), 'refusal'],
      ['mustBeOnline', T('pl.vehicle-rental.text.mustBeOnline', 'Rent — must be online'), 'refusal'],
      ['notFound', T('pl.vehicle-rental.text.notFound', 'Rent — player not found in game'), 'refusal'],
      ['extendBusy', T('pl.vehicle-rental.text.extendBusy', 'Extend — still being processed'), 'refusal'],
      ['extendNoPrice', T('pl.vehicle-rental.text.extendNoPrice', 'Extend — no recorded price'), 'refusal'],
      ['extendMustBeOnline', T('pl.vehicle-rental.text.extendMustBeOnline', 'Extend — must be online'), 'refusal'],
      ['extendGone', T('pl.vehicle-rental.text.extendGone', 'Extend — the vehicle is gone'), 'refusal'],
      ['balanceListCut', T('pl.vehicle-rental.text.balanceListCut', 'The list of who is online was cut'), 'refusal'],
      // The money outcomes, and there are THREE of them rather than two: a command dispatched with
      // nobody in the world is never confirmed, so the "…Unknown" lines must not read like the
      // definite ones.
      ['notEnough', T('pl.vehicle-rental.text.notEnough', 'Rent — not enough money'), 'money'],
      ['notEnoughExtend', T('pl.vehicle-rental.text.notEnoughExtend', 'Extend — not enough money'), 'money'],
      ['spawnRefused', T('pl.vehicle-rental.text.spawnRefused', 'The game refused the spawn (stale code)'), 'money'],
      ['rentFailedSpawn', T('pl.vehicle-rental.text.rentFailedSpawn', 'Rent failed — the spawn did not work'), 'money'],
      ['rentFailedNoBridge', T('pl.vehicle-rental.text.rentFailedNoBridge', 'Rent failed — the bridge is offline'), 'money'],
      ['rentFailedUnconfirmed', T('pl.vehicle-rental.text.rentFailedUnconfirmed', 'Rent failed — the spawn was not confirmed'), 'money'],
      ['chargeFailed', T('pl.vehicle-rental.text.chargeFailed', 'Payment refused — definitely not charged'), 'money'],
      ['chargeUnknown', T('pl.vehicle-rental.text.chargeUnknown', 'Payment UNKNOWN — we cannot say whether it was taken'), 'money'],
      ['extendFailed', T('pl.vehicle-rental.text.extendFailed', 'Extend — payment refused'), 'money'],
      ['extendUnknown', T('pl.vehicle-rental.text.extendUnknown', 'Extend — payment UNKNOWN'), 'money'],
      ['extendRace', T('pl.vehicle-rental.text.extendRace', 'Extend lost the race — refunded'), 'money'],
      ['extendRaceUnknown', T('pl.vehicle-rental.text.extendRaceUnknown', 'Extend lost the race — refund UNKNOWN'), 'money'],
      ['extendRaceFailed', T('pl.vehicle-rental.text.extendRaceFailed', 'Extend lost the race — refund failed'), 'money'],
      ['refundGone', T('pl.vehicle-rental.text.refundGone', 'Note — the vehicle was already gone'), 'money'],
      ['refundFailed', T('pl.vehicle-rental.text.refundFailed', 'Note — the refund did not go out'), 'money'],
      ['refundUnknown', T('pl.vehicle-rental.text.refundUnknown', 'Note — the refund could not be confirmed'), 'money'],
      ['refundNoPrice', T('pl.vehicle-rental.text.refundNoPrice', 'Note — no recorded price'), 'money'],
      ['returnStuck', T('pl.vehicle-rental.text.returnStuck', 'Note — the vehicle could not be removed'), 'money'],
      ['savedBalance', T('pl.vehicle-rental.text.savedBalance', 'Note — balance is from the last save'), 'money'],
      ['depositCash', T('pl.vehicle-rental.text.depositCash', 'Advice — deposit carried cash'), 'money'],
      ['endedByAdmin', T('pl.vehicle-rental.text.endedByAdmin', 'Note — ended by an admin'), 'words'],
      ['endedStuck', T('pl.vehicle-rental.text.endedStuck', 'Note — ended, vehicle not removed'), 'words'],
      ['expiredStuck', T('pl.vehicle-rental.text.expiredStuck', 'Note — expired, vehicle not removed'), 'words'],
      ['moreElsewhere', T('pl.vehicle-rental.text.moreElsewhere', 'Tail on a list too long for chat'), 'words'],
      ['free', T('pl.vehicle-rental.text.free', 'Word for “free”'), 'words'],
      ['unitMoney', T('pl.vehicle-rental.text.unitMoney', 'Word for money'), 'words'],
      ['unitGold', T('pl.vehicle-rental.text.unitGold', 'Word for gold'), 'words'],
      ['poolBank', T('pl.vehicle-rental.text.poolBank', 'Name of the bank balance'), 'words'],
      ['poolGold', T('pl.vehicle-rental.text.poolGold', 'Name of the gold balance'), 'words'],
      ['noPlans', T('pl.vehicle-rental.text.noPlans', 'List — vehicle with no plans'), 'words'],
      ['noPlansPick', T('pl.vehicle-rental.text.noPlansPick', 'Plan list — none set up'), 'words'],
      ['closedMark', T('pl.vehicle-rental.text.closedMark', 'List — what ⏳ means'), 'words'],
      ['windowsNeedManager', T('pl.vehicle-rental.text.windowsNeedManager', 'Hours — manager too old'), 'words'],
      ['winRentals', T('pl.vehicle-rental.text.winRentals', 'Hours — name for all rentals'), 'words'],
      ['winVehicle', T('pl.vehicle-rental.text.winVehicle', 'Hours — name for a vehicle'), 'words'],
      ['winPlan', T('pl.vehicle-rental.text.winPlan', 'Hours — name for a plan'), 'words'],
      ['dcError', T('pl.vehicle-rental.text.dcError', 'Discord — something went wrong'), 'discord'],
      ['dcPickVehicle', T('pl.vehicle-rental.text.dcPickVehicle', 'Discord — pick a vehicle'), 'discord'],
      ['dcChooseVehicle', T('pl.vehicle-rental.text.dcChooseVehicle', 'Discord — vehicle menu hint'), 'discord'],
      ['dcPlanCount', T('pl.vehicle-rental.text.dcPlanCount', 'Discord — number of plans'), 'discord'],
      ['dcNoPlans', T('pl.vehicle-rental.text.dcNoPlans', 'Discord — vehicle has no plans'), 'discord'],
      ['dcChoosePlan', T('pl.vehicle-rental.text.dcChoosePlan', 'Discord — plan menu hint'), 'discord'],
      ['dcRenting', T('pl.vehicle-rental.text.dcRenting', 'Discord — choose a plan'), 'discord'],
      ['dcStale', T('pl.vehicle-rental.text.dcStale', 'Discord — menu out of date'), 'discord'],
      ['dcLinkFirst', T('pl.vehicle-rental.text.dcLinkFirst', 'Discord — link your character first'), 'discord'],
      ['dcProcessing', T('pl.vehicle-rental.text.dcProcessing', 'Discord — processing'), 'discord'],
      ['dcNoStorage', T('pl.vehicle-rental.text.dcNoStorage', 'Discord — storage problem'), 'discord'],
      ['dcNotActive', T('pl.vehicle-rental.text.dcNotActive', 'Discord — rental no longer active'), 'discord'],
      ['dcExtended', T('pl.vehicle-rental.text.dcExtended', 'Discord — extended'), 'discord'],
      ['dcExtendButton', T('pl.vehicle-rental.text.dcExtendButton', 'Discord — Extend button'), 'discord'],
      ['embConfirmed', T('pl.vehicle-rental.text.embConfirmed', 'Embed — confirmed, title'), 'discord'],
      ['embVehicle', T('pl.vehicle-rental.text.embVehicle', 'Embed — Vehicle field'), 'discord'],
      ['embDuration', T('pl.vehicle-rental.text.embDuration', 'Embed — Duration field'), 'discord'],
      ['embPrice', T('pl.vehicle-rental.text.embPrice', 'Embed — Price field'), 'discord'],
      ['embExpires', T('pl.vehicle-rental.text.embExpires', 'Embed — Expires field'), 'discord'],
      ['embSoonTitle', T('pl.vehicle-rental.text.embSoonTitle', 'Embed — ending soon, title'), 'discord'],
      ['embSoon', T('pl.vehicle-rental.text.embSoon', 'Embed — ending soon'), 'discord'],
      ['embSoonExtend', T('pl.vehicle-rental.text.embSoonExtend', 'Embed — ending soon, can extend'), 'discord'],
      ['embEndedTitle', T('pl.vehicle-rental.text.embEndedTitle', 'Embed — ended, title'), 'discord'],
      ['embEnded', T('pl.vehicle-rental.text.embEnded', 'Embed — ended'), 'discord'],
      ['embEndedRemoved', T('pl.vehicle-rental.text.embEndedRemoved', 'Embed — ended and removed'), 'discord'],
    ];
  }
  function humanKey(k) { return String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, function (ch) { return ch.toUpperCase(); }); }
  /** A refusal's or a problem's reason, by its code: the message label where one said it. */
  function reasonLabel(code) {
    if (!code) return '';
    if (code === 'notCaptured') return T('pl.vehicle-rental.reason.notCaptured', 'Vehicle not identified, so it is not removed at the end');
    if (code === 'commandWords') return T('pl.vehicle-rental.reason.commandWords', 'Two commands share a word');
    var all = messageLines();
    for (var i = 0; i < all.length; i++) if (all[i][0] === code) return all[i][1];
    return humanKey(code);
  }

  // The tokens a line really fills, as chips on its editor.
  function tokenLabel(t) {
    if (t === 'player') return T('pl.vehicle-rental.tok.player', 'Player name');
    if (t === 'vehicle') return T('pl.vehicle-rental.tok.vehicle', 'Vehicle name');
    if (t === 'duration') return T('pl.vehicle-rental.tok.duration', 'Rental length');
    if (t === 'price') return T('pl.vehicle-rental.tok.price', 'Price');
    if (t === 'left') return T('pl.vehicle-rental.tok.left', 'Time left');
    if (t === 'sector') return T('pl.vehicle-rental.tok.sector', 'Map sector');
    if (t === 'cmd') return T('pl.vehicle-rental.tok.cmd', 'Command prefix');
    if (t === 'list') return T('pl.vehicle-rental.tok.list', 'The list');
    if (t === 'window') return T('pl.vehicle-rental.tok.window', 'Opening hours');
    if (t === 'max') return T('pl.vehicle-rental.tok.max', 'The limit');
    if (t === 'n') return T('pl.vehicle-rental.tok.n', 'How many');
    if (t === 'need') return T('pl.vehicle-rental.tok.need', 'Amount to pay');
    if (t === 'have') return T('pl.vehicle-rental.tok.have', 'Current balance');
    if (t === 'unit') return T('pl.vehicle-rental.tok.unit', 'Currency word');
    if (t === 'pool') return T('pl.vehicle-rental.tok.pool', 'Balance name');
    if (t === 'expires') return T('pl.vehicle-rental.tok.expires', 'When it ends');
    return T('pl.vehicle-rental.tok.cash', 'Cash carried');
  }
  var RENTAL_TOKENS = ['player', 'vehicle', 'duration', 'price', 'left', 'cmd'];
  function textTokens(key) {
    var names;
    if (/^(confirmed|endingSoon|ended|returned|mineLine|extendOk|extendRace|extendRaceUnknown|extendRaceFailed|extendUnknown|extendFailed|extendNoPrice|extendMustBeOnline|extendGone)$/.test(key)) names = RENTAL_TOKENS;
    else if (key === 'extendMaxed') names = RENTAL_TOKENS.concat(['max']);
    else if (key === 'offerOff') names = ['vehicle', 'cmd'];
    else if (key === 'rentUsage') names = ['cmd', 'list'];
    else if (key === 'pickPlan') names = ['vehicle', 'list', 'cmd'];
    else if (key === 'notAllowedHere') names = ['sector', 'cmd'];
    else if (key === 'closedNow') names = ['vehicle', 'window'];
    else if (/^limit/.test(key)) names = ['max'];
    else if (key === 'tooOften') names = ['left'];
    else if (/^notEnough/.test(key)) names = ['unit', 'need', 'have', 'pool'];
    else if (key === 'depositCash') names = ['cash'];
    else if (key === 'moreElsewhere') names = ['n'];
    else if (key === 'winPlan') names = ['vehicle'];
    else if (/^(chargeUnknown|chargeFailed)$/.test(key)) names = ['vehicle', 'price', 'cmd'];
    else if (/^(rentFailed|spawnRefused|noSpawnCode|badDuration)/.test(key)) names = ['vehicle', 'cmd'];
    else if (/^(dcChooseVehicle|dcChoosePlan|dcExtendButton|embConfirmed|embVehicle|embDuration|embPrice|embExpires|embSoonTitle|embEndedTitle)$/.test(key)) names = [];
    else if (key === 'dcPlanCount') names = ['n'];
    else if (/^(dcRenting|dcNoPlans)$/.test(key)) names = ['vehicle'];
    else if (/^(dcExtended|embSoon|embSoonExtend)$/.test(key)) names = RENTAL_TOKENS.concat(['expires']);
    else if (/^(embEnded|embEndedRemoved)$/.test(key)) names = RENTAL_TOKENS;
    else names = ['cmd'];
    return names.map(function (t) { return { token: '{' + t + '}', label: tokenLabel(t) }; });
  }

  // The in-game chat channel a message goes to. The VALUE is the bridge's own id, never translated.
  function chatChannelLabel(ch) {
    if (ch === 'global') return T('pl.vehicle-rental.chat.global', 'Global');
    if (ch === 'squad') return T('pl.vehicle-rental.chat.squad', 'Squad');
    if (ch === 'admin') return T('pl.vehicle-rental.chat.admin', 'Admin');
    if (ch === 'server') return T('pl.vehicle-rental.chat.server', 'Server');
    return T('pl.vehicle-rental.chat.local', 'Local');
  }
  // How a finished rental ended. A reason this build does not know reads as "expired".
  function endedReasonText(reason) {
    if (reason === 'returned') return T('pl.vehicle-rental.hist.returned', 'returned early');
    if (reason === 'admin') return T('pl.vehicle-rental.hist.admin', 'ended by an admin');
    return T('pl.vehicle-rental.hist.expired', 'expired');
  }
  function actionText(a) {
    if (a === 'rent') return T('pl.vehicle-rental.act.rent', 'Rent');
    if (a === 'extend') return T('pl.vehicle-rental.act.extend', 'Extension');
    if (a === 'return') return T('pl.vehicle-rental.act.return', 'Return');
    if (a === 'expire') return T('pl.vehicle-rental.act.expire', 'Expiry');
    if (a === 'end') return T('pl.vehicle-rental.act.end', 'Ended by an admin');
    return a || '';
  }
  function viaText(v) {
    if (v === 'chat') return T('pl.vehicle-rental.via.chat', 'chat');
    if (v === 'discord') return T('pl.vehicle-rental.via.discord', 'Discord');
    if (v === 'panel') return T('pl.vehicle-rental.via.panel', 'this panel');
    return T('pl.vehicle-rental.via.auto', 'automatic');
  }
  function unitText(cur) { return cur === 'gold' ? T('pl.vehicle-rental.plan.gold', 'Gold') : T('pl.vehicle-rental.plan.money', 'Money'); }
  function fmtLeft(ms) {
    if (ms <= 0) return T('pl.vehicle-rental.left.due', 'due now');
    var m = Math.round(ms / 60000);
    if (m < 60) return T('pl.vehicle-rental.left.minutes', '{n} min', { n: m });
    return m % 60
      ? T('pl.vehicle-rental.left.hoursMinutes', '{h}h {m}m', { h: Math.floor(m / 60), m: m % 60 })
      : T('pl.vehicle-rental.left.hours', '{h}h', { h: Math.floor(m / 60) });
  }
  function fmtAgo(ms) {
    var s = Math.max(0, Math.floor((Date.now() - (ms || 0)) / 1000));
    if (s < 60) return T('pl.vehicle-rental.ago.now', 'just now');
    var m = Math.floor(s / 60); if (m < 60) return T('pl.vehicle-rental.ago.minutes', '{n}m ago', { n: m });
    var hr = Math.floor(m / 60); if (hr < 24) return T('pl.vehicle-rental.ago.hours', '{n}h ago', { n: hr });
    return T('pl.vehicle-rental.ago.days', '{n}d ago', { n: Math.floor(hr / 24) });
  }
  function when(ts) {
    var d = new Date(ts);
    return h('span', { title: d.toLocaleString(SSA.lang()) }, [h('span', { class: 'vr-nowrap' }, d.toLocaleDateString(SSA.lang())), ' ', h('span', { class: 'vr-nowrap' }, d.toLocaleTimeString(SSA.lang()))]);
  }
  function playerCell(name, sid) {
    if (SSA.cell && typeof SSA.cell.player === 'function') return SSA.cell.player(name || sid || '—', sid);
    return document.createTextNode(name || sid || '—');
  }
  function tag(text, kind) {
    if (SSA.cell && typeof SSA.cell.tag === 'function') return SSA.cell.tag(text, kind);
    return h('span', { class: 'vr-tag ' + (kind || '') }, text);
  }

  /** A small pager over a list the plugin draws itself (the fleet, the messages). */
  function pager(total, size, st, redraw) {
    var pages = Math.max(1, Math.ceil(total / size));
    if (st.page >= pages) st.page = pages - 1;
    if (st.page < 0) st.page = 0;
    if (pages <= 1) return null;
    return h('div', { class: 'vr-pager' }, [
      h('button', { type: 'button', class: 'secondary', disabled: st.page <= 0 ? true : null, onclick: function () { st.page--; redraw(); } }, T('pl.vehicle-rental.page.prev', '‹ Prev')),
      h('span', { class: 'vr-pager-i' }, T('pl.vehicle-rental.page.of', '{from}–{to} of {total}', { from: st.page * size + 1, to: Math.min(total, (st.page + 1) * size), total: total })),
      h('button', { type: 'button', class: 'secondary', disabled: st.page >= pages - 1 ? true : null, onclick: function () { st.page++; redraw(); } }, T('pl.vehicle-rental.page.next', 'Next ›')),
    ]);
  }

  /**
   * THE TICKED, AT THE PRESS. A bulk button reads which rows are ticked when it is pressed, never
   * when its bar was drawn: a bar a redraw left in place would otherwise act on a list the reader
   * has since changed. `pick` holds the ticked rows themselves; `pool()` is every row a tick can
   * still mean (a row deleted since it was ticked is not acted on).
   */
  function tickedNow(pick, pool) { return pool().filter(function (x) { return pick.has(x); }); }

  function editor(root) {
    var config = null, savedSnapshot = '';
    var shippedTexts = null, shippedByLang = null;
    var chatPrefix = '/';
    var view = 'fleet', openVeh = null;
    var status = null, statusErr = null;
    var act = [], actErr = null, actMax = 0, actLoaded = false;
    var past = [], pastErr = null;
    var fleetSt = { q: '', filter: 'all', page: 0 }, fleetPick = new Set();
    var rentSt = { filter: 'all' }, rentPick = new Set();
    var histSt = { filter: 'all' }, actSt = { action: 'all', result: 'all' };
    var msgSt = { q: '', group: 'all', changed: false, page: 0 };
    var activeTbl = null, histTbl = null, actTbl = null, liveBox = null, rentBulk = null;

    root.innerHTML = '';
    var wrap = h('div', { class: 'vr-wrap' });
    root.appendChild(wrap);
    // The lead names the commands the way a player types them: the OWNER's words and prefix.
    var leadEl = h('p', { class: 'muted vr-lead' });
    function drawLead() {
      var c = config || {};
      var names = [c.cmdRent || 'rent', c.cmdMine || 'myrent', c.cmdExtend || 'extend', c.cmdReturn || 'return'];
      leadEl.innerHTML = T('pl.vehicle-rental.lead',
        'Players rent vehicles with {cmds} in game chat, and from a Discord menu if you run a bot.',
        { cmds: names.map(function (n) { return '<code>' + escHtml(chatPrefix + n) + '</code>'; }).join(', ') });
    }
    drawLead();
    api('/chat-state').then(function (r) { if (r && typeof r.prefix === 'string' && r.prefix) { chatPrefix = r.prefix; drawLead(); } })
      .catch(function () { /* the shipped prefix stays */ });
    var firstRun = h('div', { class: 'vr-firstrun' });
    var nav = h('nav', { class: 'vr-nav', 'aria-label': T('pl.vehicle-rental.nav.label', 'Vehicle Rental sections') });
    var saveStatus = h('span', { class: 'vr-save-st' });
    var saveBtn = h('button', { type: 'button', class: 'vr-btn primary', onclick: function () { save(); } }, T('pl.vehicle-rental.save.button', 'Save configuration'));
    var statBar = h('div', { class: 'vr-statbar' });
    var body = h('div', { id: 'vr-body', class: 'muted' }, T('pl.vehicle-rental.loading', 'Loading…'));
    wrap.appendChild(h('div', { class: 'vr-head' }, [leadEl]));
    wrap.appendChild(firstRun);
    wrap.appendChild(h('div', { class: 'vr-top' }, [nav, h('div', { class: 'vr-top-r' }, [saveStatus, saveBtn])]));
    wrap.appendChild(statBar);
    wrap.appendChild(body);

    // ── saving ──────────────────────────────────────────────────────────────────────────────────
    var busy = false, statusHold = false;
    function dirty() { return config && JSON.stringify(config) !== savedSnapshot; }
    markDirty = function () { if (!busy && !statusHold) paintSave(); };
    function paintSave() {
      var d = dirty();
      saveBtn.classList.toggle('vr-unsaved', !!d);
      if (!statusHold && !busy) saveStatus.textContent = d ? T('pl.vehicle-rental.save.unsaved', '● Unsaved changes') : '';
    }
    /**
     * Save, and say plainly what happened. ⚠ A refused save used to read as a saved one: the route
     * answers `200 { ok: false, error }` for a time window it cannot read, the client resolves on
     * any 200, and the tab painted "Saved ✓" over edits that had not been stored.
     */
    function save(then, failed) {
      if (!config) return;
      var fail = function () { if (typeof failed === 'function') failed(); };
      var problem = commandWordProblem();
      if (problem) { statusHold = true; saveStatus.textContent = T('pl.vehicle-rental.save.notSaved', '⚠ Not saved — {why}', { why: problem }); fail(); return; }
      busy = true; statusHold = false;
      saveStatus.textContent = T('pl.vehicle-rental.save.saving', 'Saving…');
      api('/config', { method: 'POST', body: config }).then(function (r) {
        busy = false;
        if (!r || r.ok !== true) {
          statusHold = true;
          var w = (r && r.error) || T('pl.vehicle-rental.save.noReason', 'the manager did not say why');
          saveStatus.textContent = T('pl.vehicle-rental.save.notSaved', '⚠ Not saved — {why}', { why: w });
          try { SSA.toast(T('pl.vehicle-rental.save.notSavedToast', 'Not saved — {why}', { why: w }), 'error'); } catch (e) { /* toast optional */ }
          fail();
          return;
        }
        // The ids the backend gave the vehicles, so this copy names each one as the stored one does.
        if (Array.isArray(r.ids)) r.ids.forEach(function (id, i) { if (id && config.vehicles[i] && !config.vehicles[i].id) config.vehicles[i].id = id; });
        savedSnapshot = JSON.stringify(config);
        saveStatus.textContent = T('pl.vehicle-rental.save.saved', 'Saved ✓');
        saveBtn.classList.remove('vr-unsaved');
        drawLead();
        refreshStatus();
        if (typeof then === 'function') then();
      }).catch(function (err) {
        busy = false; statusHold = true;
        saveStatus.textContent = T('pl.vehicle-rental.save.notSaved', '⚠ Not saved — {why}', { why: why(err) });
        try { SSA.toast(T('pl.vehicle-rental.save.notSavedToast', 'Not saved — {why}', { why: why(err) }), 'error'); } catch (e) { /* toast optional */ }
        fail();
      });
    }
    if (window.vrBeforeUnload) window.removeEventListener('beforeunload', window.vrBeforeUnload);
    window.vrBeforeUnload = function (e) { if (dirty()) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', window.vrBeforeUnload);

    /** The four chat words, judged the way the backend judges them: one word each, all different. */
    function cmdWordOf(raw, fallback) { var w = String(raw == null ? '' : raw).trim().replace(/^[/!.#\\]+/, '').split(/\s+/)[0].toLowerCase(); return w || fallback; }
    function commandWordProblem() {
      var c = config || {};
      var keys = [['cmdRent', 'rent'], ['cmdMine', 'myrent'], ['cmdExtend', 'extend'], ['cmdReturn', 'return']];
      var seen = {};
      for (var i = 0; i < keys.length; i++) {
        var raw = String(c[keys[i][0]] == null ? '' : c[keys[i][0]]).trim();
        if (/\s/.test(raw)) return T('pl.vehicle-rental.cmd.space', 'the command “{word}” has a space in it. A command is one word.', { word: raw });
        var w = cmdWordOf(raw, keys[i][1]);
        if (seen[w]) return T('pl.vehicle-rental.cmd.twice', 'two commands are both called “{word}”. Give each its own word.', { word: w });
        seen[w] = true;
      }
      return null;
    }

    // ── addresses ───────────────────────────────────────────────────────────────────────────────
    function vehKey(v, i) { return (v && v.id) ? String(v.id) : ('n' + (i + 1)); }
    function routeNow() {
      if (openVeh) { var i = config ? config.vehicles.indexOf(openVeh) : -1; if (i >= 0) return 'vehicle/' + encodeURIComponent(vehKey(openVeh, i)); }
      return view === 'fleet' ? '' : view;
    }
    function routeHref(sub) { return ROUTE ? ROUTE.href(sub) : '#plugins/p/vehicle-rental' + (sub ? '/' + sub : ''); }
    /** Read an address into the screen state. Answers false for one this page cannot draw. */
    function applyRoute(sub) {
      var p = String(sub || '').split('/');
      if (VIEWS.indexOf(p[0]) > 0) { view = p[0]; openVeh = null; return true; }
      if (p[0] === 'vehicle' && p[1] && config) {
        var key; try { key = decodeURIComponent(p[1]); } catch (e) { key = p[1]; }
        var list = config.vehicles || [];
        var found = null;
        for (var i = 0; i < list.length; i++) if (vehKey(list[i], i) === key) { found = list[i]; break; }
        view = 'fleet'; openVeh = found;
        if (found) jumpTo(found);
        return !!found;
      }
      view = 'fleet'; openVeh = null;
      return !p[0];
    }
    function noteRoute(replace) { if (ROUTE) ROUTE.go(routeNow(), { replace: !!replace }); }
    /**
     * A REAL LINK whose plain left click is handled here and whose every other click is the
     * browser's: a middle click or a ctrl/cmd/shift click is the reader asking for a new tab.
     */
    function navLink(sub, attrs, kids, onPlain) {
      var a = h('a', Object.assign({ href: routeHref(sub) }, attrs || {}), kids);
      a.addEventListener('click', function (ev) {
        if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        ev.preventDefault();
        onPlain();
      });
      return a;
    }
    function go(next) { view = next; openVeh = null; render(); noteRoute(); }
    function paintNav() {
      nav.innerHTML = '';
      var L = navLabels();
      [['fleet', 'car'], ['rentals', 'clock'], ['activity', 'pulse'], ['messages', 'chat'], ['settings', 'sliders']].forEach(function (t) {
        var on = view === t[0];
        nav.appendChild(navLink(t[0] === 'fleet' ? '' : t[0], { class: 'vr-tab' + (on ? ' active' : ''), 'aria-current': on ? 'page' : null },
          [icon(t[1]), h('span', {}, L[t[0]])], function () { go(t[0]); }));
      });
    }
    onRoute = function (sub) {
      if (!root.isConnected) return;
      applyRoute(sub);
      if (config) render();
    };

    // ── the stat header ─────────────────────────────────────────────────────────────────────────
    function statBadge(val, label, cls) { return h('div', { class: 'vr-stat' + (cls ? ' ' + cls : '') }, [h('span', { class: 'vr-stat-v' }, String(val)), h('span', { class: 'vr-stat-l' }, label)]); }
    var lastStat = '';
    function renderStat() {
      var c = config || {};
      var s = status || {};
      var d = s.day || {};
      var next = h('div', {}, []);
      var on = c.enabled !== false;
      next.appendChild(h('div', { class: 'vr-stat ' + (on ? 'ok' : 'off') }, [h('span', { class: 'vr-stat-dot' }),
        h('span', { class: 'vr-stat-l' }, on ? T('pl.vehicle-rental.stat.on', 'Rentals on') : T('pl.vehicle-rental.stat.off', 'Rentals off'))]));
      var vehicles = (c.vehicles || []);
      var offeredN = vehicles.filter(function (v) { return v && v.enabled !== false && (v.options || []).some(function (o) { return o && o.enabled !== false; }); }).length;
      next.appendChild(statBadge(offeredN + ' / ' + vehicles.length, T('pl.vehicle-rental.stat.offered', 'On offer')));
      next.appendChild(statBadge(s.running != null ? s.running : '—', T('pl.vehicle-rental.stat.active', 'Rented now'), s.running ? 'ok' : null));
      next.appendChild(statBadge(d.rented != null ? d.rented : '—', T('pl.vehicle-rental.stat.day', 'Rentals, 24 h')));
      next.appendChild(statBadge(d.refused != null ? d.refused : '—', T('pl.vehicle-rental.stat.refused', 'Refused, 24 h')));
      var earned = [];
      if (d.money) earned.push(d.money + ' ' + unitText('money'));
      if (d.gold) earned.push(d.gold + ' ' + unitText('gold'));
      next.appendChild(statBadge(earned.length ? earned.join(' · ') : (status ? '0' : '—'), T('pl.vehicle-rental.stat.earned', 'Taken in, 24 h')));
      if (s.notCaptured) next.appendChild(statBadge(s.notCaptured, T('pl.vehicle-rental.stat.notCaptured', 'Not identified'), 'warn'));
      if (s.awaitingRemoval) next.appendChild(statBadge(s.awaitingRemoval, T('pl.vehicle-rental.stat.waiting', 'Waiting for the game'), 'warn'));
      if (d.problems) next.appendChild(statBadge(d.problems, T('pl.vehicle-rental.stat.problems', 'Problems, 24 h'), 'warn'));
      // Everything on the screens below is editable with the server stopped, and that is the better
      // moment to write it. Only the counts, the rentals and the log wait for a running game.
      if (s.serverRunning === false) {
        next.appendChild(h('div', { class: 'vr-note-off' }, [
          h('b', {}, T('pl.vehicle-rental.stat.stoppedTitle', 'The server is not running.')),
          ' ', T('pl.vehicle-rental.stat.stoppedText', 'Set everything up now. Renting and the live counts need a running game.'),
        ]));
      }
      if (statusErr) {
        next.appendChild(h('div', { class: 'vr-note-err' }, [
          h('b', {}, T('pl.vehicle-rental.stat.errTitle', 'The live counts have stopped updating.')),
          ' ', T('pl.vehicle-rental.stat.errText', '{why} Settings are unaffected; it keeps retrying.', { why: statusErr }),
        ]));
      }
      // A tick redraws the header only when something in it changed.
      var html = next.innerHTML;
      if (html === lastStat) return;
      lastStat = html;
      statBar.innerHTML = '';
      while (next.firstChild) statBar.appendChild(next.firstChild);
    }
    function renderFirstRun() {
      firstRun.innerHTML = '';
      if (!config || (config.vehicles || []).some(function (v) { return v && v.code && (v.options || []).length; })) return;
      var L = navLabels();
      firstRun.appendChild(h('div', { class: 'vr-note-off' }, [
        h('b', {}, T('pl.vehicle-rental.first.title', 'New here? Two screens to start with.')),
        ' ', T('pl.vehicle-rental.first.fleetLine', 'On {fleet}, add a vehicle and give it a plan with a length and a price.', { fleet: L.fleet }),
        ' ', T('pl.vehicle-rental.first.settingsLine', 'On {settings}, set the limits and the chat words players type.', { settings: L.settings }),
      ]));
    }

    // ── live data ───────────────────────────────────────────────────────────────────────────────
    function refreshStatus() {
      return api('/status').then(function (s) {
        status = s || {}; statusErr = null;
        renderStat();
        if (view === 'rentals' && activeTbl) { activeTbl.refresh(); paintRentBulk(); }
        if (view === 'activity') {
          paintLive();
          if (status.lastActivity && status.lastActivity > actMax) loadActivity(true);
        }
      }).catch(function (err) { statusErr = why(err); renderStat(); if (view === 'activity') paintLive(); });
    }
    function loadActivity(newer) {
      var ask = (newer && actMax) ? api('/activity/since', { method: 'POST', body: { after: actMax } }) : api('/activity');
      return ask.then(function (r) {
        var rows = (r && Array.isArray(r.rows)) ? r.rows : [];
        act = newer && actMax ? rows.concat(act).slice(0, 5000) : rows;
        act.forEach(function (x) { if (x.id > actMax) actMax = x.id; });
        actErr = null; actLoaded = true;
        if (actTbl) actTbl.refresh();
      }).catch(function (err) { actErr = why(err); actLoaded = true; if (actTbl) actTbl.refresh(); });
    }
    function loadHistory() {
      return api('/history/all').then(function (l) { past = Array.isArray(l) ? l : []; pastErr = null; if (histTbl) histTbl.refresh(); })
        .catch(function (err) { pastErr = why(err); if (histTbl) histTbl.refresh(); });
    }
    // One timer for the tab, cleared when the tab is rebuilt or left, and idle while it is hidden.
    if (window.vrTick) clearInterval(window.vrTick);
    if (window.vrDirtyTick) { clearInterval(window.vrDirtyTick); window.vrDirtyTick = null; }
    var myTick = window.vrTick = setInterval(function () {
      if (!root.isConnected) { clearInterval(myTick); if (window.vrTick === myTick) window.vrTick = null; return; }
      if (document.hidden || !root.getClientRects().length) return;
      refreshStatus();
    }, 10000);

    // ── loading ─────────────────────────────────────────────────────────────────────────────────
    function loadFailed(err) {
      body.className = '';
      body.innerHTML = '';
      var retry = h('button', { type: 'button', class: 'vr-btn', onclick: function () {
        body.className = 'muted'; body.textContent = T('pl.vehicle-rental.loading', 'Loading…'); load();
      } }, T('pl.vehicle-rental.tryAgain', 'Try again'));
      body.appendChild(h('div', { class: 'vr-err' }, [
        h('strong', {}, T('pl.vehicle-rental.load.failed', 'This tab could not load its settings. ')),
        h('span', {}, why(err)),
        h('div', { class: 'vr-err-act' }, [retry]),
      ]));
    }
    function load() {
      var shipped = api('/text-defaults').then(function (r) { shippedTexts = (r && r.texts) || null; shippedByLang = (r && r.byLang) || null; })
        .catch(function () { /* the help line is a courtesy */ });
      api('/config').then(function (c) { return shipped.then(function () { return c; }); }).then(function (c) {
        config = c || {};
        if (!Array.isArray(config.vehicles)) config.vehicles = [];
        config.vehicles.forEach(function (v) { if (v && !Array.isArray(v.options)) v.options = []; });
        if (!config.texts) config.texts = {};
        savedSnapshot = JSON.stringify(config);
        drawLead();
        if (ROUTE) applyRoute(ROUTE.get());
        render();
        refreshStatus();
      }).catch(loadFailed);
    }

    function render() {
      paintNav();
      renderFirstRun();
      renderStat();
      paintSave();
      activeTbl = null; histTbl = null; actTbl = null; liveBox = null; rentBulk = null;
      body.className = '';
      body.innerHTML = '';
      body.appendChild(view === 'rentals' ? rentalsView()
        : view === 'activity' ? activityView()
          : view === 'messages' ? messagesView()
            : view === 'settings' ? settingsView()
              : fleetView());
    }

    // ── FLEET ───────────────────────────────────────────────────────────────────────────────────
    function unnamed() { return T('pl.vehicle-rental.veh.unnamed', 'unnamed'); }
    function vehProblems(v) {
      var out = [];
      if (!v.code) out.push(T('pl.vehicle-rental.badge.noCode', 'no spawn code'));
      else if (!CODE_RX.test(String(v.code).trim())) out.push(T('pl.vehicle-rental.badge.badCode', 'not a vehicle blueprint'));
      if (!(v.options || []).length) out.push(T('pl.vehicle-rental.badge.noPlans', 'no plans'));
      if ((v.options || []).some(function (o) { return parseInt(o && o.minutes, 10) < 0; })) out.push(T('pl.vehicle-rental.badge.negative', 'negative duration'));
      return out;
    }
    // Discord's own limits and the setup gaps, said where they bite.
    function fleetWarnings() {
      var msgs = [];
      var vs = config.vehicles;
      if (vs.length > 25) {
        msgs.push(T('pl.vehicle-rental.warn.tooManyVehicles',
          'Discord lists only 25: the last {n} vehicle(s) are missing there but still rentable in game.', { n: vs.length - 25 }));
      }
      var over = vs.filter(function (v) { return (v.options || []).length > 25; }).map(function (v) { return v.name || unnamed(); });
      if (over.length) msgs.push(T('pl.vehicle-rental.warn.tooManyPlans', 'More than 25 plans on: {list} — only the first 25 show in Discord.', { list: over.join(', ') }));
      var noCode = vs.filter(function (v) { return !v.code; }).map(function (v) { return v.name || unnamed(); });
      if (noCode.length) msgs.push(T('pl.vehicle-rental.warn.noCode', 'No spawn code on: {list}. Renting those fails and asks the player to tell an admin.', { list: noCode.join(', ') }));
      var badCode = vs.filter(function (v) { return v.code && !CODE_RX.test(String(v.code).trim()); })
        .map(function (v) { return T('pl.vehicle-rental.warn.badCodeItem', '{name} (“{code}”)', { name: v.name || unnamed(), code: v.code }); });
      if (badCode.length) msgs.push(T('pl.vehicle-rental.warn.badCode', 'Not a vehicle blueprint (codes start with BPC_) on: {list}. Those will fail to spawn.', { list: badCode.join(', ') }));
      var negDur = vs.filter(function (v) { return (v.options || []).some(function (o) { return parseInt(o && o.minutes, 10) < 0; }); }).map(function (v) { return v.name || unnamed(); });
      if (negDur.length) msgs.push(T('pl.vehicle-rental.warn.negativeDuration', 'Negative duration on: {list}. That plan is refused; it would expire the moment it is paid.', { list: negDur.join(', ') }));
      var vague = vs.filter(function (v) { return (v.options || []).some(function (o) { var n = parseInt(o && o.minutes, 10); return !(n > 0) && !(n < 0); }); }).map(function (v) { return v.name || unnamed(); });
      if (vague.length) msgs.push(T('pl.vehicle-rental.warn.noDuration', 'No duration on: {list}. Those sell as 60 minutes; set the minutes you mean.', { list: vague.join(', ') }));
      var noPlan = vs.filter(function (v) { return !(v.options || []).length; }).map(function (v) { return v.name || unnamed(); });
      if (noPlan.length) msgs.push(T('pl.vehicle-rental.warn.noPlans', 'No rental plans on: {list} — nothing to pick, so they cannot be rented.', { list: noPlan.join(', ') }));
      if (!msgs.length) return null;
      return h('div', { class: 'vr-warn' }, msgs.map(function (m) { return h('p', {}, '⚠ ' + m); }));
    }
    function planSummary(v) {
      var plans = (v.options || []).filter(function (o) { return o && o.enabled !== false; });
      if (!(v.options || []).length) return T('pl.vehicle-rental.veh.noPlansShort', 'no plans');
      if (config.free) return T('pl.vehicle-rental.veh.plansFree', '{n} plan(s), free', { n: plans.length });
      var low = null;
      plans.forEach(function (o) { var a = Math.max(0, parseInt(o.amount, 10) || 0); if (low == null || a < low.a) low = { a: a, c: o.currency }; });
      if (!low) return T('pl.vehicle-rental.veh.plansOff', 'every plan switched off');
      return T('pl.vehicle-rental.veh.plansFrom', '{n} plan(s), from {price}', { n: plans.length, price: low.a + ' ' + unitText(low.c) });
    }
    function fleetShown() {
      var q = fleetSt.q.trim().toLowerCase();
      return config.vehicles.filter(function (v) {
        if (!v) return false;
        if (q && ((v.name || '') + ' ' + (v.code || '')).toLowerCase().indexOf(q) < 0) return false;
        if (fleetSt.filter === 'on') return v.enabled !== false;
        if (fleetSt.filter === 'off') return v.enabled === false;
        if (fleetSt.filter === 'attention') return vehProblems(v).length > 0;
        return true;
      });
    }
    /** Open one vehicle's editor on the page it is on. */
    function jumpTo(v) {
      var shown = fleetShown();
      var at = shown.indexOf(v);
      if (at < 0) { fleetSt.q = ''; fleetSt.filter = 'all'; shown = fleetShown(); at = shown.indexOf(v); }
      if (at >= 0) fleetSt.page = Math.floor(at / 10);
    }
    function fleetView() {
      var out = h('div', { class: 'vr-view' });
      var warn = fleetWarnings();
      var listBox = h('div', { class: 'vr-vlist' });
      var bulkBox = h('div', { class: 'vr-bulk' });
      var find = h('input', { class: 'vr-search', type: 'search', placeholder: T('pl.vehicle-rental.veh.searchList', 'Search vehicles…') });
      find.value = fleetSt.q;
      find.addEventListener('input', function () { fleetSt.q = find.value; fleetSt.page = 0; drawList(); });
      var filter = h('select', { class: 'vr-filter', 'aria-label': T('pl.vehicle-rental.fleet.filter', 'Show') }, [
        h('option', { value: 'all' }, T('pl.vehicle-rental.fleet.all', 'All vehicles')),
        h('option', { value: 'on' }, T('pl.vehicle-rental.fleet.onlyOn', 'On offer')),
        h('option', { value: 'off' }, T('pl.vehicle-rental.fleet.onlyOff', 'Switched off')),
        h('option', { value: 'attention' }, T('pl.vehicle-rental.fleet.attention', 'Needs attention')),
      ]);
      filter.value = fleetSt.filter;
      filter.addEventListener('change', function () { fleetSt.filter = filter.value; fleetSt.page = 0; drawList(); });
      var add = h('button', { type: 'button', class: 'vr-btn add', onclick: function () {
        var v = { name: '', code: '', image: '', options: [{ minutes: 60, currency: 'money', amount: 5000 }] };
        config.vehicles.push(v);
        fleetSt.q = ''; fleetSt.filter = 'all'; find.value = ''; filter.value = 'all';
        openVeh = v; jumpTo(v);
        markDirty(); drawList(); noteRoute();
      } }, T('pl.vehicle-rental.veh.add', '+ Add vehicle'));

      function drawBulk() {
        bulkBox.innerHTML = '';
        var n = tickedNow(fleetPick, function () { return config.vehicles; }).length;
        var shown = fleetShown();
        var pageRows = shown.slice(fleetSt.page * 10, fleetSt.page * 10 + 10);
        var all = h('input', { type: 'checkbox', class: 'vr-pick', 'aria-label': T('pl.vehicle-rental.bulk.tickPage', 'Tick every vehicle on this page') });
        all.checked = pageRows.length > 0 && pageRows.every(function (v) { return fleetPick.has(v); });
        all.addEventListener('change', function () { pageRows.forEach(function (v) { if (all.checked) fleetPick.add(v); else fleetPick.delete(v); }); drawList(); });
        var act = function (label, fn, cls) {
          return h('button', { type: 'button', class: 'vr-btn' + (cls ? ' ' + cls : ''), disabled: n ? null : true, onclick: function () {
            // Read at the press, never at the draw.
            var picked = tickedNow(fleetPick, function () { return config.vehicles; });
            if (picked.length) fn(picked);
          } }, label);
        };
        bulkBox.appendChild(h('label', { class: 'vr-bulk-all' }, [all, h('span', {}, n
          ? T('pl.vehicle-rental.bulk.ticked', '{n} ticked', { n: n })
          : T('pl.vehicle-rental.bulk.none', 'Tick vehicles to change several at once'))]));
        bulkBox.appendChild(act(T('pl.vehicle-rental.bulk.on', 'Offer them'), function (picked) { picked.forEach(function (v) { delete v.enabled; }); markDirty(); drawList(); }));
        bulkBox.appendChild(act(T('pl.vehicle-rental.bulk.off', 'Switch them off'), function (picked) { picked.forEach(function (v) { v.enabled = false; }); markDirty(); drawList(); }));
        bulkBox.appendChild(act(T('pl.vehicle-rental.bulk.remove', 'Remove them'), function (picked) {
          SSA.confirm(T('pl.vehicle-rental.bulk.removeConfirm', 'Remove {n} vehicle(s) from the fleet? Rentals already running are not affected.', { n: picked.length }),
            { title: T('pl.vehicle-rental.bulk.removeTitle', 'Remove vehicles'), okLabel: T('pl.vehicle-rental.bulk.removeOk', 'Remove') }).then(function (yes) {
            if (!yes) return;
            config.vehicles = config.vehicles.filter(function (v) { return picked.indexOf(v) < 0; });
            picked.forEach(function (v) { fleetPick.delete(v); if (openVeh === v) openVeh = null; });
            markDirty(); drawList();
          });
        }, 'danger'));
        if (n) bulkBox.appendChild(h('button', { type: 'button', class: 'vr-link', onclick: function () { fleetPick.clear(); drawList(); } }, T('pl.vehicle-rental.bulk.clear', 'Clear ticks')));
      }
      function drawList() {
        listBox.innerHTML = '';
        var shown = fleetShown();
        var pg = pager(shown.length, 10, fleetSt, drawList);
        var slice = shown.slice(fleetSt.page * 10, fleetSt.page * 10 + 10);
        if (!config.vehicles.length) listBox.appendChild(h('div', { class: 'vr-empty' }, T('pl.vehicle-rental.veh.none', 'No vehicles yet — add one.')));
        else if (!shown.length) listBox.appendChild(h('div', { class: 'vr-empty' }, T('pl.vehicle-rental.veh.noMatch', 'No vehicle matches “{q}”.', { q: fleetSt.q || '…' })));
        slice.forEach(function (v) { listBox.appendChild(vehicleRow(v, drawList)); });
        if (pg) listBox.appendChild(pg);
        drawBulk();
      }
      out.appendChild(card(navLabels().fleet, [
        warn,
        h('div', { class: 'vr-vbar' }, [add, find, filter]),
        bulkBox,
        listBox,
      ], T('pl.vehicle-rental.fleet.sub', 'Each vehicle and each plan has its own switch. A switched-off one is not offered.')));
      drawList();
      return out;
    }
    function vehicleRow(v, redraw) {
      var i = config.vehicles.indexOf(v);
      var open = openVeh === v;
      var tick = h('input', { type: 'checkbox', class: 'vr-pick', 'aria-label': T('pl.vehicle-rental.bulk.tickOne', 'Tick {name}', { name: v.name || unnamed() }) });
      tick.checked = fleetPick.has(v);
      tick.addEventListener('change', function () { if (tick.checked) fleetPick.add(v); else fleetPick.delete(v); redraw(); });
      var probs = vehProblems(v);
      var head = h('div', { class: 'vr-vrow' + (v.enabled === false ? ' off' : '') + (open ? ' open' : '') }, [
        tick,
        switchEl(v.enabled !== false, function (on) { if (on) delete v.enabled; else v.enabled = false; redraw(); }, T('pl.vehicle-rental.veh.offer', 'Offer this vehicle')),
        h('div', { class: 'vr-vrow-t' }, [
          h('b', {}, v.name || unnamed()),
          h('span', { class: 'vr-vrow-s' }, [v.code ? h('code', {}, v.code) : null, ' ', planSummary(v)]),
          probs.length ? h('span', { class: 'vr-vrow-p' }, probs.map(function (p) { return h('span', { class: 'vr-badge warn' }, p); })) : null,
          v.enabled === false ? h('span', { class: 'vr-badge' }, T('pl.vehicle-rental.badge.off', 'switched off')) : null,
        ]),
        navLink(open ? '' : 'vehicle/' + encodeURIComponent(vehKey(v, i)), { class: 'vr-btn vr-edit' }, open ? T('pl.vehicle-rental.veh.close', 'Close') : T('pl.vehicle-rental.veh.edit', 'Edit'),
          function () { openVeh = open ? null : v; redraw(); noteRoute(); }),
      ]);
      var box = h('div', { class: 'vr-veh' + (open ? ' open' : '') }, [head]);
      if (open) box.appendChild(vehicleEditor(v, redraw));
      return box;
    }
    function vehicleEditor(v, redraw) {
      var optBox = h('div', { class: 'vr-opts' });
      function renderOpts() {
        optBox.innerHTML = '';
        v.options.forEach(function (o, oi) {
          // A negative or zero duration is refused or sold as an hour; `min` keeps it from being typed.
          var row = [
            switchEl(o.enabled !== false, function (on) { if (on) delete o.enabled; else o.enabled = false; }, T('pl.vehicle-rental.plan.offer', 'Offer this plan')),
            inp(T('pl.vehicle-rental.plan.minutes', 'Minutes'), function () { return o.minutes; }, function (x) { o.minutes = x; }, { type: 'number', min: '1' }),
          ];
          if (!config.free) {
            row.push(inp(T('pl.vehicle-rental.plan.currency', 'Currency'), function () { return o.currency || 'money'; }, function (x) { o.currency = x; },
              { type: 'select', options: [['money', T('pl.vehicle-rental.plan.money', 'Money')], ['gold', T('pl.vehicle-rental.plan.gold', 'Gold')]] }));
            row.push(inp(T('pl.vehicle-rental.plan.amount', 'Amount'), function () { return o.amount; }, function (x) { o.amount = x; }, { type: 'number', min: '0' }));
          }
          row.push(h('button', { type: 'button', class: 'vr-x', title: T('pl.vehicle-rental.plan.remove', 'Remove plan'), onclick: function () { v.options.splice(oi, 1); markDirty(); renderOpts(); } }, '✕'));
          // A window on the PLAN is how a price that changes by time of day is expressed: two plans,
          // one windowed to the evening and one not.
          optBox.appendChild(h('div', { class: 'vr-opt-wrap' + (o.enabled === false ? ' off' : '') }, [
            h('div', { class: config.free ? 'vr-opt vr-opt-free' : 'vr-opt' }, row),
            twEditor(o),
          ]));
        });
        if (!v.options.length) {
          optBox.appendChild(h('div', { class: 'vr-empty' }, T('pl.vehicle-rental.plan.none', 'No plans yet. Add one (length and price) before this vehicle can be rented.')));
        }
      }
      renderOpts();
      var i = config.vehicles.indexOf(v);
      var move = function (d) {
        var at = config.vehicles.indexOf(v), to = at + d;
        if (at < 0 || to < 0 || to >= config.vehicles.length) return;
        config.vehicles.splice(at, 1); config.vehicles.splice(to, 0, v);
        jumpTo(v); markDirty(); redraw();
      };
      return h('div', { class: 'vr-veh-ed' }, [
        h('div', { class: 'vr-grid' }, [
          inp(T('pl.vehicle-rental.veh.name', 'Vehicle name'), function () { return v.name; }, function (x) { v.name = x; }, { ph: 'Quad Bike' }),
          vehField(v, redraw),
          inp(T('pl.vehicle-rental.veh.image', 'Image URL (optional)'), function () { return v.image; }, function (x) { v.image = x; }, { image: true }),
        ]),
        h('div', { class: 'vr-opt-hd' }, config.free
          ? T('pl.vehicle-rental.veh.plansHd', 'Rental plans (duration)')
          : T('pl.vehicle-rental.veh.plansHdPriced', 'Rental plans (duration + price)')),
        optBox,
        h('button', { type: 'button', class: 'vr-btn add', onclick: function () { v.options.push({ minutes: 60, currency: 'money', amount: 5000 }); markDirty(); renderOpts(); } }, T('pl.vehicle-rental.veh.addPlan', '+ Add plan')),
        h('div', { class: 'vr-opt-hd' }, T('pl.vehicle-rental.veh.limitsHd', 'Per-vehicle limits (leave blank = use the global setting)')),
        h('div', { class: 'vr-grid' }, [
          inp(T('pl.vehicle-rental.veh.maxPerPlayer', 'Max active / player'), function () { return v.maxPerPlayer; }, function (x) { v.maxPerPlayer = x; }, { ph: T('pl.vehicle-rental.veh.phGlobal', 'global') }),
          inp(T('pl.vehicle-rental.veh.cooldown', 'Cooldown (min)'), function () { return v.cooldownMinutes; }, function (x) { v.cooldownMinutes = x; }, { ph: T('pl.vehicle-rental.veh.phGlobal', 'global') }),
          inp(T('pl.vehicle-rental.veh.dailyLimit', 'Daily limit'), function () { return v.dailyLimit; }, function (x) { v.dailyLimit = x; }, { ph: T('pl.vehicle-rental.veh.phGlobal', 'global') }),
          inp(T('pl.vehicle-rental.set.maxExtensions', 'Max extensions / rental (0 = ∞)'), function () { return v.maxExtensions; }, function (x) { v.maxExtensions = x; }, { ph: T('pl.vehicle-rental.veh.phGlobal', 'global') }),
          inp(T('pl.vehicle-rental.set.reminder', 'Remind before expiry (min)'), function () { return v.reminderMinutes; }, function (x) { v.reminderMinutes = x; }, { ph: T('pl.vehicle-rental.veh.phGlobal', 'global') }),
        ]),
        h('div', { class: 'vr-opt-hd' }, T('pl.vehicle-rental.veh.hoursHd', 'When this vehicle can be rented (empty = whenever rentals are open)')),
        twEditor(v),
        h('div', { class: 'vr-veh-act' }, [
          h('button', { type: 'button', class: 'vr-btn', disabled: i <= 0 ? true : null, onclick: function () { move(-1); } }, T('pl.vehicle-rental.veh.up', 'Move up')),
          h('button', { type: 'button', class: 'vr-btn', disabled: i >= config.vehicles.length - 1 ? true : null, onclick: function () { move(1); } }, T('pl.vehicle-rental.veh.down', 'Move down')),
          h('button', { type: 'button', class: 'vr-btn', onclick: function () {
            var copy = JSON.parse(JSON.stringify(v)); delete copy.id;
            copy.name = T('pl.vehicle-rental.veh.copyName', '{name} (copy)', { name: v.name || unnamed() });
            config.vehicles.splice(config.vehicles.indexOf(v) + 1, 0, copy);
            openVeh = copy; jumpTo(copy); markDirty(); redraw(); noteRoute();
          } }, T('pl.vehicle-rental.veh.duplicate', 'Duplicate')),
          h('button', { type: 'button', class: 'vr-btn danger', onclick: function () {
            SSA.confirm(T('pl.vehicle-rental.veh.removeConfirm', 'Remove {name} from the fleet? Rentals already running are not affected.', { name: v.name || unnamed() }),
              { title: T('pl.vehicle-rental.veh.remove', 'Remove vehicle'), okLabel: T('pl.vehicle-rental.bulk.removeOk', 'Remove') }).then(function (yes) {
              if (!yes) return;
              var at = config.vehicles.indexOf(v);
              if (at >= 0) config.vehicles.splice(at, 1);
              fleetPick.delete(v); openVeh = null; markDirty(); redraw(); noteRoute();
            });
          } }, T('pl.vehicle-rental.veh.remove', 'Remove vehicle')),
        ]),
      ]);
    }

    // ── RENTALS ─────────────────────────────────────────────────────────────────────────────────
    function activeRows() {
      var rows = (status && Array.isArray(status.rentals)) ? status.rentals : [];
      var now = Date.now();
      return rows.filter(function (r) {
        if (rentSt.filter === 'soon') return r.expiresAt > now && r.expiresAt - now <= 600000;
        if (rentSt.filter === 'unknown') return !r.vehId;
        if (rentSt.filter === 'waiting') return r.expiresAt && r.expiresAt <= now;
        return true;
      });
    }
    function paidText(r) {
      if (r.paidAmount == null) return '—';
      if (!r.paidAmount) return T('pl.vehicle-rental.rent.free', 'free');
      return r.paidAmount + ' ' + unitText(r.paidCurrency);
    }
    function endOne(r) {
      SSA.confirm(T('pl.vehicle-rental.rent.endConfirm',
        'End the rental of {vehicle} for {player}?\n\nThe vehicle is removed and the player is told. No refund.',
      { vehicle: r.vehName || T('pl.vehicle-rental.rent.thisVehicle', 'this vehicle'), player: r.playerName || r.steamId }),
      { title: T('pl.vehicle-rental.rent.endDialog', 'End rental'), okLabel: T('pl.vehicle-rental.rent.endOk', 'End it') }).then(function (yes) {
        if (!yes) return;
        api('/rentals/end', { method: 'POST', body: { id: r.id } }).then(function (out) {
          if (out && out.ok) {
            SSA.toast(out.removed ? T('pl.vehicle-rental.rent.endedRemoved', 'Rental ended and the vehicle removed.')
              : (out.stillThere ? T('pl.vehicle-rental.rent.endedStuck', 'Rental ended, but the vehicle could NOT be removed. It may still be out there.')
                : T('pl.vehicle-rental.rent.endedGone', 'Rental ended (the vehicle was already gone).')),
            out.removed || !out.stillThere ? undefined : 'error');
          } else {
            SSA.toast(T('pl.vehicle-rental.rent.endFailed', 'Could not end it: {why}', { why: (out && out.error) || T('pl.vehicle-rental.rent.unknownReason', 'unknown') }), 'error');
          }
          rentPick.delete(r.id);
          refreshStatus(); loadHistory();
        }).catch(function (err) {
          SSA.toast(T('pl.vehicle-rental.rent.notEnded', 'The rental was NOT ended — {why}', { why: why(err) }), 'error');
        });
      });
    }
    function paintRentBulk() {
      if (!rentBulk) return;
      var live = ((status && status.rentals) || []).map(function (r) { return r.id; });
      rentPick.forEach(function (id) { if (live.indexOf(id) < 0) rentPick.delete(id); });
      var n = rentPick.size;
      rentBulk.innerHTML = '';
      rentBulk.appendChild(h('span', { class: 'vr-bulk-n' }, n ? T('pl.vehicle-rental.bulk.rentTicked', '{n} rental(s) ticked', { n: n }) : T('pl.vehicle-rental.bulk.rentNone', 'Tick rentals to end several at once')));
      rentBulk.appendChild(h('button', { type: 'button', class: 'vr-btn danger', disabled: n ? null : true, onclick: function () {
        // The ids ticked at the press, of rentals still running.
        var ids = tickedNow(rentPick, function () { return ((status && status.rentals) || []).map(function (r) { return r.id; }); });
        if (!ids.length) return;
        SSA.confirm(T('pl.vehicle-rental.bulk.endConfirm', 'End {n} rental(s) now? Their vehicles are removed and each player is told. No refund.', { n: ids.length }),
          { title: T('pl.vehicle-rental.rent.endDialog', 'End rental'), okLabel: T('pl.vehicle-rental.rent.endOk', 'End it') }).then(function (yes) {
          if (!yes) return;
          api('/rentals/end-many', { method: 'POST', body: { ids: ids } }).then(function (out) {
            var res = (out && out.results) || [];
            var done = res.filter(function (x) { return x.ok; }).length;
            var stuck = res.filter(function (x) { return x.ok && !x.removed && x.stillThere; }).length;
            if (!out || !out.ok) SSA.toast(T('pl.vehicle-rental.rent.endFailed', 'Could not end it: {why}', { why: (out && out.error) || T('pl.vehicle-rental.rent.unknownReason', 'unknown') }), 'error');
            else SSA.toast(T('pl.vehicle-rental.bulk.ended', '{done} of {n} ended. {stuck} vehicle(s) could not be removed.', { done: done, n: ids.length, stuck: stuck }), stuck || done < ids.length ? 'error' : undefined);
            ids.forEach(function (id) { rentPick.delete(id); });
            refreshStatus(); loadHistory();
          }).catch(function (err) { SSA.toast(T('pl.vehicle-rental.bulk.notEnded', 'Nothing was ended — {why}', { why: why(err) }), 'error'); });
        });
      } }, T('pl.vehicle-rental.bulk.end', 'End the ticked')));
    }
    function rentalsView() {
      var out = h('div', { class: 'vr-view' });
      var filter = h('select', { class: 'vr-filter', 'aria-label': T('pl.vehicle-rental.fleet.filter', 'Show') }, [
        h('option', { value: 'all' }, T('pl.vehicle-rental.rent.fAll', 'Every rental out now')),
        h('option', { value: 'soon' }, T('pl.vehicle-rental.rent.fSoon', 'Ending within 10 minutes')),
        h('option', { value: 'unknown' }, T('pl.vehicle-rental.rent.fUnknown', 'Vehicle not identified')),
        h('option', { value: 'waiting' }, T('pl.vehicle-rental.rent.fWaiting', 'Ran out, waiting for the game')),
      ]);
      filter.value = rentSt.filter;
      filter.addEventListener('change', function () { rentSt.filter = filter.value; activeTbl.refresh(); });
      rentBulk = h('div', { class: 'vr-bulk' });
      activeTbl = SSA.table({
        columns: [
          { key: 'tick', label: '', render: function (r) {
            var b = h('input', { type: 'checkbox', class: 'vr-pick', 'aria-label': T('pl.vehicle-rental.bulk.tickRental', 'Tick this rental') });
            b.checked = rentPick.has(r.id);
            b.addEventListener('change', function () { if (b.checked) rentPick.add(r.id); else rentPick.delete(r.id); paintRentBulk(); });
            return b;
          } },
          { key: 'player', label: T('pl.vehicle-rental.col.player', 'Player'), sort: true, sortVal: function (r) { return (r.playerName || r.steamId || '').toLowerCase(); }, render: function (r) { return playerCell(r.playerName, r.steamId); } },
          { key: 'vehicle', label: T('pl.vehicle-rental.col.vehicle', 'Vehicle'), sort: true, sortVal: function (r) { return (r.vehName || '').toLowerCase(); }, render: function (r) { return document.createTextNode(r.vehName || '—'); } },
          { key: 'left', label: T('pl.vehicle-rental.col.left', 'Time left'), sort: true, sortVal: function (r) { return r.expiresAt; }, render: function (r) { return h('span', { title: new Date(r.expiresAt).toLocaleString(SSA.lang()) }, fmtLeft(r.expiresAt - Date.now())); } },
          { key: 'paid', label: T('pl.vehicle-rental.col.paid', 'Paid'), render: function (r) { return document.createTextNode(paidText(r)); } },
          // Blank means auto-removal will be skipped for this one — worth seeing before it expires.
          { key: 'veh', label: T('pl.vehicle-rental.col.vehId', 'Vehicle id'), render: function (r) { return r.vehId ? h('code', {}, r.vehId) : h('span', { class: 'muted', title: T('pl.vehicle-rental.rent.notCapturedTitle', 'The spawned vehicle could not be identified, so it will NOT be removed automatically.') }, T('pl.vehicle-rental.rent.notCaptured', 'not captured')); } },
          { key: 'ext', label: T('pl.vehicle-rental.col.extended', 'Extended'), render: function (r) { return document.createTextNode(String(r.extensions || 0)); } },
          { key: 'act', label: '', render: function (r) {
            return h('button', { type: 'button', class: 'vr-btn danger', title: T('pl.vehicle-rental.rent.endTitle', 'End it now and remove the vehicle'), onclick: function () { endOne(r); } }, T('pl.vehicle-rental.rent.endButton', 'End'));
          } },
        ],
        rows: activeRows,
        search: function (r) { return (r.playerName || '') + ' ' + (r.steamId || '') + ' ' + (r.vehName || ''); },
        searchPlaceholder: T('pl.vehicle-rental.rent.search', 'Search rentals…'),
        toolbar: [filter],
        sort: { key: 'left', dir: 'asc' }, pageSize: 20,
        // A failed request is not an empty list.
        empty: function () {
          if (statusErr && !status) return T('pl.vehicle-rental.list.failed', 'This list could not be read — {why}', { why: statusErr });
          if (!status) return T('pl.vehicle-rental.loading', 'Loading…');
          return T('pl.vehicle-rental.rent.empty', 'No active rentals. A rental shows here when a player rents; you can end it here.');
        },
        onRefresh: function () { refreshStatus(); },
      });
      var hFilter = h('select', { class: 'vr-filter', 'aria-label': T('pl.vehicle-rental.fleet.filter', 'Show') }, [
        h('option', { value: 'all' }, T('pl.vehicle-rental.hist.fAll', 'Every finished rental')),
        h('option', { value: 'expired' }, T('pl.vehicle-rental.hist.fExpired', 'Expired')),
        h('option', { value: 'returned' }, T('pl.vehicle-rental.hist.fReturned', 'Returned early')),
        h('option', { value: 'admin' }, T('pl.vehicle-rental.hist.fAdmin', 'Ended by an admin')),
      ]);
      hFilter.value = histSt.filter;
      hFilter.addEventListener('change', function () { histSt.filter = hFilter.value; histTbl.refresh(); });
      histTbl = SSA.table({
        columns: [
          { key: 'player', label: T('pl.vehicle-rental.col.player', 'Player'), sort: true, sortVal: function (r) { return (r.playerName || r.steamId || '').toLowerCase(); }, render: function (r) { return playerCell(r.playerName, r.steamId); } },
          { key: 'vehicle', label: T('pl.vehicle-rental.col.vehicle', 'Vehicle'), sort: true, sortVal: function (r) { return (r.vehName || '').toLowerCase(); }, render: function (r) { return document.createTextNode(r.vehName || '—'); } },
          { key: 'started', label: T('pl.vehicle-rental.col.started', 'Started'), sort: true, sortVal: function (r) { return r.startedAt; }, render: function (r) { return when(r.startedAt); } },
          { key: 'ended', label: T('pl.vehicle-rental.col.ended', 'How it ended'), render: function (r) { return document.createTextNode(endedReasonText(r.endedReason)); } },
          { key: 'paid', label: T('pl.vehicle-rental.col.paid', 'Paid'), render: function (r) { return document.createTextNode(paidText(r)); } },
          { key: 'ext', label: T('pl.vehicle-rental.col.extended', 'Extended'), render: function (r) { return document.createTextNode(String(r.extensions || 0)); } },
        ],
        rows: function () {
          return past.filter(function (r) {
            if (histSt.filter === 'all') return true;
            if (histSt.filter === 'expired') return r.endedReason !== 'returned' && r.endedReason !== 'admin';
            return r.endedReason === histSt.filter;
          });
        },
        search: function (r) { return (r.playerName || '') + ' ' + (r.steamId || '') + ' ' + (r.vehName || ''); },
        searchPlaceholder: T('pl.vehicle-rental.hist.search', 'Search past rentals…'),
        toolbar: [hFilter],
        sort: { key: 'started', dir: 'desc' }, pageSize: 20,
        empty: function () {
          if (pastErr) return T('pl.vehicle-rental.list.failed', 'This list could not be read — {why}', { why: pastErr });
          return T('pl.vehicle-rental.hist.empty', 'Nothing finished yet. Rentals move here when they expire, are returned, or you end them.');
        },
        onRefresh: function () { loadHistory(); },
      });
      out.appendChild(card(T('pl.vehicle-rental.card.active', 'Active rentals'), [rentBulk, activeTbl.el],
        T('pl.vehicle-rental.rent.sub', 'Ending a rental here removes the vehicle and pays no refund.')));
      out.appendChild(card(T('pl.vehicle-rental.card.finished', 'Finished rentals'), [histTbl.el]));
      paintRentBulk();
      loadHistory();
      return out;
    }

    // ── ACTIVITY ────────────────────────────────────────────────────────────────────────────────
    function paintLive() {
      if (!liveBox) return;
      var s = status || {};
      var lines = [];
      var row = function (label, value, kind) { lines.push(h('div', { class: 'vr-live-row' }, [h('span', { class: 'vr-live-l' }, label), tag(value, kind)])); };
      if (!status) { liveBox.innerHTML = ''; liveBox.appendChild(h('p', { class: 'muted' }, statusErr ? T('pl.vehicle-rental.list.failed', 'This list could not be read — {why}', { why: statusErr }) : T('pl.vehicle-rental.loading', 'Loading…'))); return; }
      row(T('pl.vehicle-rental.live.server', 'Game server'), s.serverRunning === false ? T('pl.vehicle-rental.live.notRunning', 'not running') : (s.serverRunning ? T('pl.vehicle-rental.live.running', 'running') : T('pl.vehicle-rental.live.unknown', 'unknown')), s.serverRunning === false ? 'warn' : (s.serverRunning ? 'ok' : 'muted'));
      row(T('pl.vehicle-rental.live.bridge', 'SSA Bridge'), s.bridge === false ? T('pl.vehicle-rental.live.bridgeDown', 'not answering') : (s.bridge ? T('pl.vehicle-rental.live.bridgeUp', 'answering') : T('pl.vehicle-rental.live.unknown', 'unknown')), s.bridge === false ? 'warn' : (s.bridge ? 'ok' : 'muted'));
      var f = s.inFlight || {};
      row(T('pl.vehicle-rental.live.now', 'Being processed now'), T('pl.vehicle-rental.live.nowValue', '{r} rental(s), {e} extension(s), {i} vehicle(s) being identified', { r: f.renting || 0, e: f.extending || 0, i: f.identifying || 0 }), (f.renting || f.extending || f.identifying) ? 'ok' : 'muted');
      row(T('pl.vehicle-rental.live.sweep', 'Expiry check'), s.sweep && s.sweep.at ? T('pl.vehicle-rental.live.sweepAt', 'last ran {ago}', { ago: fmtAgo(s.sweep.at) }) : T('pl.vehicle-rental.live.sweepNot', 'has not run yet'), 'muted');
      if (s.awaitingRemoval) lines.push(h('p', { class: 'vr-note-warn' }, T('pl.vehicle-rental.live.waiting', '{n} rental(s) ran out while the game could not take the vehicle back. They are removed as soon as it can.', { n: s.awaitingRemoval })));
      if (s.storage === false) lines.push(h('p', { class: 'vr-note-warn' }, T('pl.vehicle-rental.live.noStorage', 'The plugin has no database, so it refuses every rental. The manager log says why.')));
      var next = h('div', {}, lines);
      if (liveBox.innerHTML !== next.innerHTML) { liveBox.innerHTML = ''; while (next.firstChild) liveBox.appendChild(next.firstChild); }
    }
    function moneyCell(r) {
      if (!r.amount) return document.createTextNode('');
      var s = (r.amount > 0 ? '+' : '−') + Math.abs(r.amount) + ' ' + unitText(r.currency);
      return h('span', { class: 'vr-money ' + (r.amount > 0 ? 'in' : 'out') }, s);
    }
    function resultCell(r) {
      var kind = r.result === 'ok' ? 'ok' : (r.result === 'refused' ? 'warn' : 'bad');
      var word = r.result === 'ok' ? T('pl.vehicle-rental.res.ok', 'done') : (r.result === 'refused' ? T('pl.vehicle-rental.res.refused', 'refused') : T('pl.vehicle-rental.res.problem', 'problem'));
      var box = h('div', { class: 'vr-result' }, [tag(word, kind)]);
      if (r.code) box.appendChild(h('span', { class: 'vr-reason' }, reasonLabel(r.code)));
      if (r.said) box.appendChild(h('span', { class: 'vr-said', title: r.said }, r.said));
      return box;
    }
    function whatCell(r) {
      var parts = [h('b', {}, actionText(r.action))];
      if (r.vehName) parts.push(' · ' + r.vehName);
      if (r.minutes && (r.action === 'rent' || r.action === 'extend') && r.result === 'ok') parts.push(' · ' + fmtLeft(r.minutes * 60000));
      parts.push(h('span', { class: 'vr-via' }, viaText(r.via)));
      return h('span', { class: 'vr-what' }, parts);
    }
    function activityView() {
      var out = h('div', { class: 'vr-view' });
      liveBox = h('div', { class: 'vr-live' });
      out.appendChild(card(T('pl.vehicle-rental.live.title', 'Live status'), [liveBox], null,
        [h('button', { type: 'button', class: 'secondary btn-icon', title: T('pl.vehicle-rental.refresh', 'Refresh'), onclick: function () { refreshStatus(); } }, icon('refresh'))]));
      paintLive();
      var fAct = h('select', { class: 'vr-filter', 'aria-label': T('pl.vehicle-rental.act.filter', 'Which events') }, [
        h('option', { value: 'all' }, T('pl.vehicle-rental.act.all', 'Every event')),
        h('option', { value: 'rent' }, T('pl.vehicle-rental.act.fRent', 'Rentals')),
        h('option', { value: 'extend' }, T('pl.vehicle-rental.act.fExtend', 'Extensions')),
        h('option', { value: 'return' }, T('pl.vehicle-rental.act.fReturn', 'Returns')),
        h('option', { value: 'expire' }, T('pl.vehicle-rental.act.fExpire', 'Expiries')),
        h('option', { value: 'end' }, T('pl.vehicle-rental.act.end', 'Ended by an admin')),
      ]);
      fAct.value = actSt.action;
      fAct.addEventListener('change', function () { actSt.action = fAct.value; actTbl.refresh(); });
      var fRes = h('select', { class: 'vr-filter', 'aria-label': T('pl.vehicle-rental.res.filter', 'Which results') }, [
        h('option', { value: 'all' }, T('pl.vehicle-rental.res.all', 'Every result')),
        h('option', { value: 'ok' }, T('pl.vehicle-rental.res.fOk', 'Done')),
        h('option', { value: 'refused' }, T('pl.vehicle-rental.res.fRefused', 'Refused')),
        h('option', { value: 'problem' }, T('pl.vehicle-rental.res.fProblem', 'Problems')),
      ]);
      fRes.value = actSt.result;
      fRes.addEventListener('change', function () { actSt.result = fRes.value; actTbl.refresh(); });
      actTbl = SSA.table({
        columns: [
          { key: 'at', label: T('pl.vehicle-rental.col.when', 'When'), sort: true, sortVal: function (r) { return r.at || 0; }, render: function (r) { return h('span', { class: 'vr-nowrap', title: new Date(r.at).toLocaleString(SSA.lang()) }, fmtAgo(r.at)); } },
          { key: 'player', label: T('pl.vehicle-rental.col.player', 'Player'), sort: true, sortVal: function (r) { return (r.playerName || r.steamId || '').toLowerCase(); }, render: function (r) { return r.steamId || r.playerName ? playerCell(r.playerName, r.steamId) : document.createTextNode('—'); } },
          { key: 'what', label: T('pl.vehicle-rental.col.what', 'What'), render: whatCell },
          { key: 'result', label: T('pl.vehicle-rental.col.result', 'Result'), sort: true, sortVal: function (r) { return r.result === 'problem' ? 0 : (r.result === 'refused' ? 1 : 2); }, render: resultCell },
          { key: 'money', label: T('pl.vehicle-rental.col.money', 'Money'), render: moneyCell },
        ],
        rows: function () {
          return act.filter(function (r) {
            return (actSt.action === 'all' || r.action === actSt.action) && (actSt.result === 'all' || r.result === actSt.result);
          });
        },
        search: function (r) { return [r.playerName, r.steamId, r.vehName, reasonLabel(r.code), r.said, actionText(r.action)].join(' '); },
        searchPlaceholder: T('pl.vehicle-rental.act.search', 'Search players, vehicles, reasons…'),
        toolbar: [fAct, fRes],
        sort: { key: 'at', dir: 'desc' }, pageSize: 25,
        empty: function () {
          if (actErr) return T('pl.vehicle-rental.list.failed', 'This list could not be read — {why}', { why: actErr });
          if (!actLoaded) return T('pl.vehicle-rental.loading', 'Loading…');
          return T('pl.vehicle-rental.act.empty', 'Nothing yet. Every rental, extension, return and refusal shows here as it happens.');
        },
        onRefresh: function () { loadActivity(false); },
      });
      var clear = h('button', { type: 'button', class: 'secondary', onclick: function () {
        SSA.confirm(T('pl.vehicle-rental.act.clearConfirm', 'Clear the activity log? Rentals and their history are kept.'),
          { title: T('pl.vehicle-rental.act.clear', 'Clear log'), okLabel: T('pl.vehicle-rental.act.clearOk', 'Clear') }).then(function (yes) {
          if (!yes) return;
          api('/activity/clear', { method: 'POST' }).then(function (r) {
            if (!r || !r.ok) { SSA.toast(T('pl.vehicle-rental.act.clearFailed', 'The log was NOT cleared — {why}', { why: (r && r.error) || T('pl.vehicle-rental.rent.unknownReason', 'unknown') }), 'error'); return; }
            act = []; actTbl.refresh(); refreshStatus();
          }).catch(function (err) { SSA.toast(T('pl.vehicle-rental.act.clearFailed', 'The log was NOT cleared — {why}', { why: why(err) }), 'error'); });
        });
      } }, T('pl.vehicle-rental.act.clear', 'Clear log'));
      out.appendChild(card(T('pl.vehicle-rental.act.title', 'Activity log'), [actTbl.el],
        T('pl.vehicle-rental.act.sub', 'What the plugin did and refused, with the reason the player was given.'), [clear]));
      loadActivity(false);
      return out;
    }

    // ── MESSAGES ────────────────────────────────────────────────────────────────────────────────
    function perLangDefault(key) {
      if (!shippedByLang || typeof shippedByLang !== 'object') return undefined;
      var out = {};
      Object.keys(shippedByLang).forEach(function (l) {
        var t = shippedByLang[l] && shippedByLang[l][key];
        if (typeof t === 'string' && t) out[l] = t;
      });
      return Object.keys(out).length ? out : undefined;
    }
    function messagesView() {
      var out = h('div', { class: 'vr-view' });
      var listBox = h('div', { class: 'vr-stack vr-msglist' });
      var named = {};
      var lines = messageLines();
      lines.forEach(function (p) { named[p[0]] = 1; });
      var rest = Object.keys(config.texts).filter(function (k) { return !named[k]; }).map(function (k) { return [k, humanKey(k), 'words']; });
      var all = lines.concat(rest).filter(function (pair) { return config.texts[pair[0]] !== undefined; });
      var multi = typeof SSA.locText === 'function';
      if (!config.textsI18n || typeof config.textsI18n !== 'object') config.textsI18n = {};
      var find = h('input', { class: 'vr-search', type: 'search', placeholder: T('pl.vehicle-rental.msg.search', 'Search messages…') });
      find.value = msgSt.q;
      find.addEventListener('input', function () { msgSt.q = find.value; msgSt.page = 0; drawList(); });
      var group = h('select', { class: 'vr-filter', 'aria-label': T('pl.vehicle-rental.msg.group', 'Which messages') }, [
        h('option', { value: 'all' }, T('pl.vehicle-rental.msg.gAll', 'Every message')),
        h('option', { value: 'chat' }, T('pl.vehicle-rental.msg.gChat', 'Chat replies')),
        h('option', { value: 'refusal' }, T('pl.vehicle-rental.msg.gRefusal', 'Refusals and limits')),
        h('option', { value: 'money' }, T('pl.vehicle-rental.msg.gMoney', 'Money and payment')),
        h('option', { value: 'words' }, T('pl.vehicle-rental.msg.gWords', 'Words inside other lines')),
        h('option', { value: 'discord' }, T('pl.vehicle-rental.msg.gDiscord', 'Discord replies and embeds')),
      ]);
      group.value = msgSt.group;
      group.addEventListener('change', function () { msgSt.group = group.value; msgSt.page = 0; drawList(); });
      var changed = h('label', { class: 'vr-chk' }, [(function () {
        var b = h('input', { type: 'checkbox', onchange: function () { msgSt.changed = b.checked; msgSt.page = 0; drawList(); } });
        b.checked = msgSt.changed; return b;
      })(), T('pl.vehicle-rental.msg.changed', 'Only lines I changed')]);
      function isShipped(key) { return !!(shippedTexts && shippedTexts[key] === config.texts[key]); }
      function shownLines() {
        var q = msgSt.q.trim().toLowerCase();
        return all.filter(function (pair) {
          if (msgSt.group !== 'all' && pair[2] !== msgSt.group) return false;
          if (msgSt.changed && isShipped(pair[0])) return false;
          if (q && (pair[1] + ' ' + pair[0] + ' ' + (config.texts[pair[0]] || '')).toLowerCase().indexOf(q) < 0) return false;
          return true;
        });
      }
      function editorFor(pair) {
        var key = pair[0];
        if (!multi) return inp(pair[1], function () { return config.texts[key] || ''; }, function (v) { config.texts[key] = v; });
        var ed = SSA.locText({
          label: pair[1],
          value: config.texts[key] || '',
          i18n: config.textsI18n[key] || {},
          tokens: textTokens(key),
          rows: 2,
          // What each language reads while the box holds the shipped wording.
          defaults: perLangDefault(key),
          help: isShipped(key) ? T('pl.vehicle-rental.text.shipped', 'Shipped wording: every player reads it in their own language until you change it.') : '',
          onChange: function (value, i18n) {
            config.texts[key] = value;
            // A language that was cleared is written as empty, so the save replaces it.
            var prev = config.textsI18n[key] || {};
            var next = {};
            Object.keys(prev).forEach(function (l) { next[l] = ''; });
            Object.keys(i18n || {}).forEach(function (l) { next[l] = i18n[l]; });
            config.textsI18n[key] = next;
            markDirty();
          },
        });
        return ed.el;
      }
      function drawList() {
        listBox.innerHTML = '';
        var shown = shownLines();
        var pg = pager(shown.length, 12, msgSt, drawList);
        if (!shown.length) listBox.appendChild(h('div', { class: 'vr-empty' }, T('pl.vehicle-rental.msg.none', 'No message matches.')));
        shown.slice(msgSt.page * 12, msgSt.page * 12 + 12).forEach(function (pair) { listBox.appendChild(editorFor(pair)); });
        if (pg) listBox.appendChild(pg);
      }
      out.appendChild(card(navLabels().messages, [
        multi ? h('p', { class: 'muted vr-langs' }, T('pl.vehicle-rental.text.langs', 'A player reads the tab for their language (/lang in game), else Default.')) : null,
        h('div', { class: 'vr-vbar' }, [find, group, changed]),
        listBox,
        h('p', { class: 'muted vr-small' }, T('pl.vehicle-rental.text.tokens',
          'Tokens: {player} {vehicle} {duration} {price} {left} {sector} {cmd} {list} {window} {max} {n}. Some lines have their own. Leave a line empty for the default.')),
        h('p', { class: 'muted vr-small' }, T('pl.vehicle-rental.msg.cmdWords', 'A command named in a message, like {example}, follows the word you set in {settings}.',
          { example: chatPrefix + 'myrent', settings: navLabels().settings })),
      ], T('pl.vehicle-rental.msg.sub', 'Every line a player reads, in game and on Discord.')));
      drawList();
      return out;
    }

    // ── SETTINGS ────────────────────────────────────────────────────────────────────────────────
    function settingsView() {
      var out = h('div', { class: 'vr-view' });
      var L = navLabels();
      out.appendChild(card(T('pl.vehicle-rental.set.master', 'Rentals'), [
        switchRow(T('pl.vehicle-rental.set.enabled', 'Rentals enabled'), T('pl.vehicle-rental.set.enabledHint', 'Off: nobody can rent or extend. Returning still works.'),
          function () { return config.enabled !== false; }, function (v) { config.enabled = v; renderStat(); }),
        switchRow(T('pl.vehicle-rental.set.free', 'Free rentals (no charge)'), T('pl.vehicle-rental.set.freeHint', 'Nobody pays; prices are kept and hidden.'),
          function () { return config.free === true; }, function (v) { config.free = v; }),
        switchRow(T('pl.vehicle-rental.set.requireOnline', 'Must be online to rent or extend'), T('pl.vehicle-rental.set.requireOnlineHint', 'Stops renting from Discord while the player is offline.'),
          function () { return config.requireOnline === true; }, function (v) { config.requireOnline = v; }),
        switchRow(T('pl.vehicle-rental.set.allowExtend', 'Allow extensions'), T('pl.vehicle-rental.set.allowExtendHint', 'Players buy more time at the price they paid.'),
          function () { return config.allowExtend !== false; }, function (v) { config.allowExtend = v; }),
        switchRow(T('pl.vehicle-rental.ig.allowReturn', 'Allow returning early'), T('pl.vehicle-rental.set.allowReturnHint', 'Players hand the vehicle back before the time is up.'),
          function () { return config.allowReturn !== false; }, function (v) { config.allowReturn = v; }),
        switchRow(T('pl.vehicle-rental.ig.verify', 'Check the vehicle still exists'), T('pl.vehicle-rental.set.verifyHint', 'Nobody pays to extend a vehicle that was destroyed.'),
          function () { return config.verifyVehicle !== false; }, function (v) { config.verifyVehicle = v; }),
      ], T('pl.vehicle-rental.set.masterSub', 'Each vehicle and plan has its own switch on the {fleet} screen.', { fleet: L.fleet })));

      var minWord = T('pl.vehicle-rental.unit.min', 'min');
      out.appendChild(card(T('pl.vehicle-rental.set.limits', 'Limits'), [
        limitRow(T('pl.vehicle-rental.set.maxPerPlayerL', 'Active rentals per player'), T('pl.vehicle-rental.set.maxPerPlayerHint', 'How many one player may hold at once.'), '',
          function () { return config.maxPerPlayer; }, function (v) { config.maxPerPlayer = v; }, { def: 1 }),
        limitRow(T('pl.vehicle-rental.set.cooldownL', 'Wait between rentals'), T('pl.vehicle-rental.set.cooldownHint', 'Counted from the start of their last rental.'), minWord,
          function () { return config.cooldownMinutes; }, function (v) { config.cooldownMinutes = v; }, { def: 15 }),
        limitRow(T('pl.vehicle-rental.set.dailyL', 'Rentals per player per day'), T('pl.vehicle-rental.set.dailyHint', 'Counted over the last 24 hours.'), '',
          function () { return config.dailyLimit; }, function (v) { config.dailyLimit = v; }, { def: 3 }),
        limitRow(T('pl.vehicle-rental.set.maxExtL', 'Extensions per rental'), T('pl.vehicle-rental.set.maxExtHint', 'Off means no limit.'), '',
          function () { return config.maxExtensions; }, function (v) { config.maxExtensions = v; }, { def: 2 }),
        limitRow(T('pl.vehicle-rental.set.reminderL', 'Reminder before the end'), T('pl.vehicle-rental.set.reminderHint', 'In game and by Discord DM, with an Extend button.'), minWord,
          function () { return config.reminderMinutes; }, function (v) { config.reminderMinutes = v; }, { def: 10 }),
        limitRow(T('pl.vehicle-rental.ig.refund', 'Refund on early return (%)'), T('pl.vehicle-rental.set.refundHint', 'Part of the price paid back on an early return.'), '%',
          function () { return config.refundPercent; }, function (v) { config.refundPercent = v; }, { def: 50, max: 100 }),
      ], T('pl.vehicle-rental.set.limitsSub', 'A vehicle can set its own limits on the {fleet} screen; the stricter one wins.', { fleet: L.fleet })));

      out.appendChild(card(T('pl.vehicle-rental.set.hoursT', 'Rental hours'), [twEditor(config)],
        T('pl.vehicle-rental.set.hours', 'Rental hours (leave empty and rentals are always open)')));

      // In-game chat: messages, the channel, the commands and their words.
      var words = h('div', { class: 'vr-grid' });
      var wordNote = h('p', { class: 'vr-note-warn', style: 'display:none' });
      function checkWords() {
        var p = commandWordProblem();
        wordNote.style.display = p ? '' : 'none';
        wordNote.textContent = p ? ('⚠ ' + p) : '';
      }
      [['cmdRent', T('pl.vehicle-rental.ig.cmdRent', 'Rent command'), 'rent'], ['cmdMine', T('pl.vehicle-rental.ig.cmdMine', 'My rentals command'), 'myrent'],
        ['cmdExtend', T('pl.vehicle-rental.ig.cmdExtend', 'Extend command'), 'extend'], ['cmdReturn', T('pl.vehicle-rental.ig.cmdReturn', 'Return command'), 'return']].forEach(function (w) {
        words.appendChild(inp(w[1], function () { return config[w[0]]; }, function (v) { config[w[0]] = v; checkWords(); drawLead(); }, { ph: w[2] }));
      });
      var chan = h('select', {});
      ['local', 'global', 'squad', 'admin', 'server'].forEach(function (ch) {
        chan.appendChild(h('option', { value: ch, selected: (config.inGameChannel || 'local') === ch ? true : null }, chatChannelLabel(ch)));
      });
      chan.addEventListener('change', function () { config.inGameChannel = chan.value; markDirty(); });
      out.appendChild(card(T('pl.vehicle-rental.card.inGame', 'In-game'), [
        switchRow(T('pl.vehicle-rental.ig.notify', 'Send messages in-game'), T('pl.vehicle-rental.set.notifyHint', 'Confirmations, reminders and endings in the game chat.'),
          function () { return config.inGameNotify !== false; }, function (v) { config.inGameNotify = v; }),
        switchRow(T('pl.vehicle-rental.ig.commands', 'Enable in-game commands'), T('pl.vehicle-rental.set.commandsHint', 'Off: renting works from Discord only.'),
          function () { return config.inGameCommands !== false; }, function (v) { config.inGameCommands = v; }),
        h('div', { class: 'vr-grid' }, [h('label', { class: 'vr-f' }, [h('span', {}, T('pl.vehicle-rental.ig.channel', 'Chat channel')), chan])]),
        words,
        wordNote,
        h('p', { class: 'muted vr-small' }, T('pl.vehicle-rental.ig.note', 'Command names have no prefix and apply on save. Rent is paid from the player\'s bank account.')),
      ]));
      checkWords();

      // Sectors, with the live state of sector detection beside them.
      var sectorStatus = h('p', { class: 'vr-secstat', style: 'display:none' });
      function sectorsConfigured() { return !!((config.allowedSectors || []).length || (config.blockedSectors || []).length); }
      function refreshSectorStatus() {
        if (!sectorsConfigured()) { sectorStatus.style.display = 'none'; return; }
        api('/sector-status').then(function (s) {
          sectorStatus.style.display = '';
          if (s && s.works === true) {
            sectorStatus.className = 'vr-secstat ok';
            sectorStatus.textContent = T('pl.vehicle-rental.sector.ok', '✓ Sector detection is working — the rules above are being applied.');
          } else if (s && s.works === false) {
            sectorStatus.className = 'vr-secstat bad';
            sectorStatus.textContent = T('pl.vehicle-rental.sector.bad', '⚠ Sector detection is down, so renting is allowed everywhere. Check the manager can reach scumsa.');
          } else {
            sectorStatus.className = 'vr-secstat';
            sectorStatus.textContent = T('pl.vehicle-rental.sector.untested', 'Sector detection is untested; it is checked at the first rental or when someone is online.');
          }
        }).catch(function (err) {
          sectorStatus.style.display = '';
          sectorStatus.className = 'vr-secstat bad';
          sectorStatus.textContent = T('pl.vehicle-rental.sector.checkFailed', '⚠ Could not check sector detection: {why}. Until then, renting is allowed everywhere.', { why: why(err) });
        });
      }
      out.appendChild(card(T('pl.vehicle-rental.set.sectors', 'Map sectors'), [
        h('div', { class: 'vr-grid' }, [
          inp(T('pl.vehicle-rental.ig.allowedSectors', 'Allowed sectors (blank = anywhere)'), function () { return (config.allowedSectors || []).join(', '); },
            function (v) { config.allowedSectors = String(v).split(',').map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean); }, { ph: 'B2, C3' }),
          inp(T('pl.vehicle-rental.ig.blockedSectors', 'Blocked sectors'), function () { return (config.blockedSectors || []).join(', '); },
            function (v) { config.blockedSectors = String(v).split(',').map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean); }, { ph: 'A0, Z4' }),
        ]),
        sectorStatus,
      ]));
      refreshSectorStatus();

      // Discord: the menu channel, its button and embed, and posting it.
      var chanSel = h('select', {}, [h('option', { value: config.channelId || '' }, config.channelId
        ? T('pl.vehicle-rental.chan.current', '(current)')
        : T('pl.vehicle-rental.chan.pick', '— pick a channel —'))]);
      var chanNote = h('p', { class: 'muted vr-small' }, '');
      api('/discord-state').then(function (d) {
        if (!(d && d.enabled)) {
          chanSel.innerHTML = '';
          chanSel.appendChild(h('option', { value: '' }, T('pl.vehicle-rental.chan.noBot', 'No Discord bot configured')));
          chanSel.disabled = true;
          chanNote.textContent = T('pl.vehicle-rental.chan.noBotNote', 'No Discord bot: the menu, DM reminders and Extend button are off. Renting in game still works.');
          return;
        }
        api('/channels').then(function (list) {
          chanSel.innerHTML = ''; chanSel.appendChild(h('option', { value: '' }, T('pl.vehicle-rental.chan.pick', '— pick a channel —')));
          (list || []).forEach(function (ch) { chanSel.appendChild(h('option', { value: ch.id, selected: ch.id === config.channelId ? true : null }, '#' + ch.name)); });
          chanSel.value = config.channelId || '';
          if (!(list || []).length) chanNote.textContent = T('pl.vehicle-rental.chan.noChannels', 'The bot is connected but sees no text channels. Check its permissions.');
        }).catch(function (err) {
          chanNote.textContent = T('pl.vehicle-rental.chan.listFailed', 'Could not load the channel list — {why}', { why: why(err) });
        });
      }).catch(function (err) {
        chanNote.textContent = T('pl.vehicle-rental.chan.stateFailed', 'Could not check whether a Discord bot is set up — {why}', { why: why(err) });
      });
      chanSel.addEventListener('change', function () { config.channelId = chanSel.value; markDirty(); });
      var embDiv = h('div', {});
      var ed = SSA.consume('embed-editor');
      if (ed) ed.mount(embDiv, { value: config.menuEmbed || {}, onChange: function (json) { config.menuEmbed = json; markDirty(); } });
      else embDiv.appendChild(h('div', { class: 'muted vr-small' }, T("pl.vehicle-rental.embed.needPlugin", "Enable the \"Discord Embeds\" plugin to design the menu embed here.")));
      var postSt = h('span', { class: 'muted vr-small' });
      var postBtn = h('button', { type: 'button', class: 'vr-btn', onclick: function () {
        postSt.textContent = T('pl.vehicle-rental.post.posting', 'Posting…');
        save(function () {
          api('/post-menu', { method: 'POST' }).then(function (r) {
            if (r && r.ok) { postSt.textContent = T('pl.vehicle-rental.post.done', 'Menu posted ✓'); return; }
            postSt.textContent = !config.channelId
              ? T('pl.vehicle-rental.post.pickChannel', '⚠ Pick a channel first')
              : T('pl.vehicle-rental.post.failed', '⚠ Could not post. Check the bot is online and can post in that channel.');
          }).catch(function (err) {
            postSt.textContent = T('pl.vehicle-rental.post.savedNotPosted', '⚠ Saved, but the menu could not be posted — {why}', { why: why(err) });
          });
        }, function () {
          // Not saved, so not posted: the reason stays beside the Save button.
          postSt.textContent = T('pl.vehicle-rental.post.notPosted', '⚠ Not posted, because the settings were not saved.');
        });
      } }, T('pl.vehicle-rental.post.button', 'Save & post menu'));
      out.appendChild(card(T('pl.vehicle-rental.set.discord', 'Discord'), [
        h('div', { class: 'vr-grid' }, [
          h('label', { class: 'vr-f' }, [h('span', {}, T('pl.vehicle-rental.set.channel', 'Rental menu channel (Discord — optional)')), chanSel, chanNote]),
          area(T('pl.vehicle-rental.set.buttonLabel', 'Button label'), function () { return config.buttonLabel; }, function (v) { config.buttonLabel = v; }, { ph: '🚗 Rent a vehicle', max: 80 }),
        ]),
        h('div', { class: 'vr-opt-hd' }, T('pl.vehicle-rental.card.embed', 'Rental menu embed')),
        embDiv,
        h('div', { class: 'vr-actions' }, [postBtn, postSt]),
      ], T('pl.vehicle-rental.set.discordSub', 'A menu message with a Rent button. Players need a linked account to rent from it.')));

      out.appendChild(h('details', { class: 'card vr-card vr-adv' }, [
        h('summary', {}, T('pl.vehicle-rental.set.advanced', 'Advanced — spawn and remove commands')),
        h('div', { class: 'vr-stack' }, [
          inp(T('pl.vehicle-rental.set.spawnCmd', 'Spawn command template'), function () { return config.spawnCmd; }, function (v) { config.spawnCmd = v; }, { ph: '#SpawnVehicle {code} 1 Location "X={x} Y={y} Z={z}"' }),
          inp(T('pl.vehicle-rental.set.removeCmd', 'Remove command template'), function () { return config.removeCmd; }, function (v) { config.removeCmd = v; }, { ph: '#DestroyVehicle {vehId}' }),
        ]),
        h('p', { class: 'muted vr-small' }, T('pl.vehicle-rental.set.cmdTokens', 'Placeholders: {code} {x} {y} {z} {steamid} {vehId}. Payment is taken automatically with #ChangeCurrencyBalance.')),
      ]));
      return out;
    }

    paintNav();
    load();
  }

  SSA.ready(function () {
    SSA.registerTab({ id: 'vehicle-rental', label: T('pl.vehicle-rental.tab', 'Rentals'), icon: '#i-car', premium: true, render: editor });
  });
}());
