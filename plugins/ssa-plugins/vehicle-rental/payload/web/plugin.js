/* Vehicle Rental — admin configuration UI. Configure vehicles, durations, money/gold prices, the
   channel and the in-game commands, design the menu embed (via the embed-editor plugin), post it,
   and watch active rentals.

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
  // The manager's own client, not a hand-rolled one. The wrapper this replaced was HALF fixed: it
  // read the HTTP status and returned a `{ _httpError, error }` sentinel, but `r.json().catch(() =>
  // ({}))` still ate a body that was not JSON — a proxy's 502, an HTML error page, a truncated
  // response — into an empty object with no sentinel at all, and there was no `.catch` on the fetch
  // itself: a network failure (the manager stopped, the connection dropped) REJECTED and nothing
  // ever handled it — the `.then` never ran, the screen stayed on whatever it was showing, and the
  // rejection was logged to a console nobody had open. And the sentinel was only read at SOME call
  // sites; everywhere else a failed request read as empty data, which is a sentence about the DATA
  // when the truth was about the REQUEST.
  //
  // `SSA.apiClient()` is captured here, at the top of the script, because `SSA.api` resolves the
  // calling plugin at call time and the panel only knows who is asking inside a synchronous stretch
  // it started itself — a poll tick, a click handler and a `.then` continuation, which is every real
  // call in this file, all run after that stretch has ended.
  var api = SSA.apiClient();
  // One sentence for a failure, the route's own words first. Used by every catch below.
  function why(err) { return SSA.apiError(err); }
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
  function inp(label, get, set, o) {
    o = o || {}; var ctl;
    if (o.type === 'select') ctl = h('select', { onchange: function () { set(ctl.value); } }, (o.options || []).map(function (op) { return h('option', { value: op[0] }, op[1]); }));
    else {
      // `min` and `max` are passed through AND enforced on the value. The attribute alone only stops
      // the spinner arrows; a number typed straight in still reaches the config, and a negative
      // duration means a rental that is paid for and then expires on the very next sweep.
      //
      // `max` is here because a ceiling the BACKEND enforces and the screen does not is a screen
      // that disagrees with the server: the early-return refund is clamped to 0..100 where it is
      // paid out, so an owner who typed 500 was shown 500, saved 500, and got 100 back — with
      // nothing anywhere saying which of the two numbers was real.
      ctl = h('input', {
        type: o.type || 'text', placeholder: o.ph || '', min: o.min, max: o.max,
        oninput: function () {
          if (o.type !== 'number') return set(ctl.value);
          var n = Number(ctl.value);
          if (o.min != null && ctl.value !== '' && n < Number(o.min)) { n = Number(o.min); ctl.value = String(n); }
          if (o.max != null && ctl.value !== '' && n > Number(o.max)) { n = Number(o.max); ctl.value = String(n); }
          set(n);
        },
      });
    }
    ctl.value = get() == null ? '' : get();
    return h('label', { class: 'vr-f' }, [h('span', {}, label), ctl]);
  }
  function chk(label, get, set) {
    var box = h('input', { type: 'checkbox', onchange: function () { set(box.checked); } });
    box.checked = get() !== false;
    return h('label', { class: 'vr-chk' }, [box, label]);
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
  //
  // The seven chips are a FUNCTION, not an array: the day a chip stores is its position (1..7) and
  // only its caption is read, so the caption is looked up at draw time in whatever language the
  // panel has loaded, with the key spelled out here rather than built from the day.
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
    // A failed check is not "the manager cannot evaluate time windows" — that is a specific,
    // rarer claim — so it carries the real reason where `twClockLine()` reads it, and falls back
    // to that generic sentence only when there is no `why` to show.
    api('/clock').then(function (c) { twClock = c || { supported: false }; then(); })
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
    var note = h('p', { class: 'tw-note' }, T('pl.vehicle-rental.tw.always', 'Always available — no time window is set.'));
    var clockNote = h('p', { class: 'tw-clock' }, '');
    var add = h('button', {
      type: 'button', class: 'tw-add',
      onclick: function () {
        owner.windows = (owner.windows || []).concat([{ days: [], from: '20:00', to: '22:00' }]);
        onChange(); draw();
      },
    }, T('pl.vehicle-rental.tw.add', '+ Add a time window'));

    var seq = 0;
    function preview() {
      var list = owner.windows || [];
      if (!list.length) { note.className = 'tw-note'; note.textContent = T('pl.vehicle-rental.tw.always', 'Always available — no time window is set.'); return; }
      // Every keystroke asks, and only the LAST answer is allowed to paint. Without the token an
      // earlier reply can land after a later one and leave the note describing a window the owner
      // has already changed — which is worse than a stale number, because it reads as authoritative.
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
      // An empty list means EVERY DAY, so all seven read as on. Clicking one then has to turn that
      // day off rather than leave six unexplained — which means materialising the full week first.
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
          h('div', { class: 'tw-times' }, [h('span', {}, T('pl.vehicle-rental.tw.from', 'from')), from, h('span', {}, T('pl.vehicle-rental.tw.to', 'to')), to]),
          h('button', {
            type: 'button', class: 'tw-del', title: T('pl.vehicle-rental.tw.removeWindow', 'Remove this window'),
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

  // Vehicle spawn-code field with a live typeahead sourced from the item database
  // (same catalog + images the admin console's vehicle picker uses). Picking a
  // result fills the code (BPC_… blueprint id) and, if empty, the name/image too.
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
            // The record's OWN spawn blueprint. This used to glue `BPC_` onto whatever id came back
            // — a second id rule beside the item database's, and a wrong one for any vehicle whose
            // blueprint is not its code with a prefix. A record that names no spawn code cannot be
            // picked: there is nothing honest to fill the box with.
            var code = String(it.spawn_code || '');
            if (!CODE_RX.test(code)) return;
            var nm = it.name || code;
            var img = it.image || '';
            var row = h('div', { class: 'vr-ac-row' }, [
              img ? h('img', { src: img, alt: '', loading: 'lazy' }) : h('span', { class: 'vr-ac-ph' }),
              h('span', { class: 'vr-ac-n' }, nm),
              h('span', { class: 'vr-ac-c' }, code),
            ]);
            // pointerdown, not mousedown: a touch device only synthesises mousedown after the
            // finger lifts, and only if the tap never turned into a scroll — so picking a vehicle
            // from this list raced the blur that hides it and usually did nothing on a phone.
            row.addEventListener('pointerdown', function (e) {
              e.preventDefault();
              v.code = code; if (!v.name) v.name = nm; if (!v.image && img) v.image = img;
              refresh();
            });
            menu.appendChild(row);
          });
          if (!menu.children.length) { hide(); return; }
          menu.style.display = 'block';
        }).catch(function () {
          // This used to just hide the menu, which reads exactly like "no vehicle matched" — the
          // honest difference is that the search never ran at all, and that is worth a sentence
          // rather than a picker that looks like it searched and came up empty.
          menu.innerHTML = '';
          menu.appendChild(h('div', { class: 'vr-ac-msg' }, T('pl.vehicle-rental.veh.searchFailed', 'Could not search — check the connection and try again.')));
          menu.style.display = 'block';
        });
    }
    // This field is a SEARCH BOX and a value at the same time, and it used to save whatever was in
    // it. Typing "quad" and clicking away saved the spawn code "quad": the panel showed a configured
    // vehicle, the list of vehicles with no code stayed empty, and the failure surfaced later as a
    // player being told "the vehicle couldn't be spawned" with nothing pointing at the cause.
    //
    // So only a real blueprint id is committed. Search text that resolves to nothing reverts to the
    // last good code on blur — the ordinary behaviour of a combobox, and it never leaves a half-typed
    // word saved as configuration.
    var CODE_RX = /^BPC_[A-Za-z0-9_]+$/;
    input.addEventListener('input', function () {
      var t = input.value.trim();
      if (!t || CODE_RX.test(t)) { v.code = t; input.classList.remove('vr-ac-bad'); }
      else input.classList.add('vr-ac-bad');            // typing — not a code yet
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

  function editor(el) {
    var config = null;
    // The heading used to open "Players rent vehicles through the Discord bot", which is not true and
    // never was: the whole rental engine runs from in-game chat and Discord is one of two front ends.
    // An owner with no bot read that sentence, then found a channel picker with nothing in it, and
    // concluded the plugin was broken or not for them.
    //
    // The four command names are a {cmds} var rather than four fragments glued to a sentence: a
    // translator moves the whole clause, and `/rent` stays `/rent` wherever it lands in it.
    //
    // ⚠ The four names are the OWNER'S, and so is the prefix in front of them. Hard-coding
    // `/rent /myrent /extend /return` described every server that renamed a command or uses another
    // prefix wrongly, on the first line of the tab. So the sentence is drawn from the configured names
    // and the chat prefix once both are known, and from the shipped names until then.
    el.innerHTML = '<div class="vr-head"><p class="muted vr-lead" style="font-size:.86rem;margin:0"></p></div><div id="vr-body" class="muted">'
      + T('pl.vehicle-rental.loading', 'Loading…') + '</div>';
    var body = el.querySelector('#vr-body');
    var leadEl = el.querySelector('.vr-lead');
    var chatPrefix = '/';
    function escHtml(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
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

    var savedSnapshot = '';
    // Where a failed FIRST load goes. Without a slot, a throwing client only moves the silence: the
    // promise rejects, nothing renders, and the tab sits on "Loading…" for ever — which reads as
    // slow rather than as broken.
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
      api('/config').then(function (c) {
        config = c || {};
        if (!Array.isArray(config.vehicles)) config.vehicles = [];
        savedSnapshot = JSON.stringify(config);
        drawLead();
        render();
      }).catch(loadFailed);
    }
    load();

    // The in-game chat channel a message goes to. The VALUE is the bridge's own channel id and is
    // never translated; only the caption in the list is.
    function chatChannelLabel(ch) {
      if (ch === 'global') return T('pl.vehicle-rental.chat.global', 'Global');
      if (ch === 'squad') return T('pl.vehicle-rental.chat.squad', 'Squad');
      if (ch === 'admin') return T('pl.vehicle-rental.chat.admin', 'Admin');
      if (ch === 'server') return T('pl.vehicle-rental.chat.server', 'Server');
      return T('pl.vehicle-rental.chat.local', 'Local');
    }
    // How a finished rental ended. A reason this build does not know reads as "expired", exactly as
    // the lookup table this replaced did — the table is a function so that every key is written out.
    function endedReasonText(reason) {
      if (reason === 'returned') return T('pl.vehicle-rental.hist.returned', 'returned early');
      if (reason === 'admin') return T('pl.vehicle-rental.hist.admin', 'ended by an admin');
      return T('pl.vehicle-rental.hist.expired', 'expired');
    }

    function render() {
      body.className = '';
      body.innerHTML = '';

      // ── general settings ──
      var chanSel = h('select', {}, [h('option', { value: config.channelId || '' }, config.channelId
        ? T('pl.vehicle-rental.chan.current', '(current)')
        : T('pl.vehicle-rental.chan.pick', '— pick a channel —'))]);
      // An empty channel list has two causes that look the same and mean opposite things. `/channels`
      // answers `[]` both when there is no bot and when there is one with nothing to post in, and the
      // dropdown said nothing at all about either — so this asks which it is first.
      var chanNote = h('p', { class: 'muted', style: 'font-size:.78rem;margin:4px 0 0' }, '');
      api('/discord-state').then(function (d) {
        var hasBot = !!(d && d.enabled);
        if (!hasBot) {
          chanSel.innerHTML = '';
          chanSel.appendChild(h('option', { value: '' }, T('pl.vehicle-rental.chan.noBot', 'No Discord bot configured')));
          chanSel.disabled = true;
          chanNote.textContent = T('pl.vehicle-rental.chan.noBotNote',
            'No Discord bot: the menu, DM reminders and Extend button are off. Renting in game still works.');
          return;
        }
        api('/channels').then(function (list) {
          chanSel.innerHTML = ''; chanSel.appendChild(h('option', { value: '' }, T('pl.vehicle-rental.chan.pick', '— pick a channel —')));
          (list || []).forEach(function (ch) { chanSel.appendChild(h('option', { value: ch.id, selected: ch.id === config.channelId }, '#' + ch.name)); });
          chanSel.value = config.channelId || '';
          if (!(list || []).length) {
            chanNote.textContent = T('pl.vehicle-rental.chan.noChannels',
              'The bot is connected but sees no text channels. Check its permissions.');
          }
        }).catch(function (err) {
          // The list failed to load — that is not "no channels exist" — so the dropdown keeps
          // whatever it already had (the saved channel, if any) rather than reading as unconfigured.
          chanNote.textContent = T('pl.vehicle-rental.chan.listFailed', 'Could not load the channel list — {why}', { why: why(err) });
        });
      }).catch(function (err) {
        chanNote.textContent = T('pl.vehicle-rental.chan.stateFailed', 'Could not check whether a Discord bot is set up — {why}', { why: why(err) });
      });
      chanSel.addEventListener('change', function () { config.channelId = chanSel.value; });

      // Live state of sector detection. Silent when no sector rules are set — there is nothing to
      // warn about then, and a permanent status line for an unused feature is just noise. Whether
      // rules are SET is read off the config already on this page, never off this call, so a failed
      // check can never be mistaken for "no rules configured" and hide a real problem behind it.
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
            sectorStatus.textContent = T('pl.vehicle-rental.sector.bad',
              '⚠ Sector detection is down, so renting is allowed everywhere. Check the manager can reach scumsa.');
          } else {
            sectorStatus.className = 'vr-secstat';
            sectorStatus.textContent = T('pl.vehicle-rental.sector.untested',
              'Sector detection is untested; it is checked at the first rental or when someone is online.');
          }
        }).catch(function (err) {
          // A failed CHECK is not "no rules are set" — the old catch hid this the same way an
          // unused feature is hidden, which is exactly the silent failure this whole pass exists
          // to remove.
          sectorStatus.style.display = '';
          sectorStatus.className = 'vr-secstat bad';
          sectorStatus.textContent = T('pl.vehicle-rental.sector.checkFailed',
            '⚠ Could not check sector detection: {why}. Until then, renting is allowed everywhere.', { why: why(err) });
        });
      }

      body.appendChild(card(T('pl.vehicle-rental.card.settings', 'Settings'), [
        h('div', { class: 'vr-checks' }, [
          chk(T('pl.vehicle-rental.set.enabled', 'Rentals enabled'), function () { return config.enabled; }, function (v) { config.enabled = v; }),
          h('label', { class: 'vr-chk' }, [(function () { var b = h('input', { type: 'checkbox', onchange: function () { config.free = b.checked; render(); } }); b.checked = config.free === true; return b; })(), T('pl.vehicle-rental.set.free', 'Free rentals (no charge)')]),
          // Says what it now covers. It applies to renting AND extending; returning is always
          // allowed, so a player is never stuck paying for a vehicle they are trying to give back.
          chk(T('pl.vehicle-rental.set.requireOnline', 'Must be online to rent or extend'), function () { return config.requireOnline; }, function (v) { config.requireOnline = v; }),
          chk(T('pl.vehicle-rental.set.allowExtend', 'Allow extensions'), function () { return config.allowExtend; }, function (v) { config.allowExtend = v; }),
        ]),
        h('div', { class: 'vr-grid' }, [
          h('label', { class: 'vr-f' }, [h('span', {}, T('pl.vehicle-rental.set.channel', 'Rental menu channel (Discord — optional)')), chanSel, chanNote]),
          inp(T('pl.vehicle-rental.set.buttonLabel', 'Button label'), function () { return config.buttonLabel; }, function (v) { config.buttonLabel = v; }, { ph: '🚗 Rent a vehicle' }),
          inp(T('pl.vehicle-rental.set.maxPerPlayer', 'Max active rentals / player (0 = ∞)'), function () { return config.maxPerPlayer; }, function (v) { config.maxPerPlayer = v; }, { type: 'number' }),
          inp(T('pl.vehicle-rental.set.cooldown', 'Cooldown between rentals (min)'), function () { return config.cooldownMinutes; }, function (v) { config.cooldownMinutes = v; }, { type: 'number' }),
          inp(T('pl.vehicle-rental.set.dailyLimit', 'Daily limit / player (0 = ∞)'), function () { return config.dailyLimit; }, function (v) { config.dailyLimit = v; }, { type: 'number' }),
          inp(T('pl.vehicle-rental.set.maxExtensions', 'Max extensions / rental (0 = ∞)'), function () { return config.maxExtensions; }, function (v) { config.maxExtensions = v; }, { type: 'number' }),
          inp(T('pl.vehicle-rental.set.reminder', 'Remind before expiry (min)'), function () { return config.reminderMinutes; }, function (v) { config.reminderMinutes = v; }, { type: 'number' }),
        ]),
        h('div', { class: 'vr-stack' }, [
          inp(T('pl.vehicle-rental.set.spawnCmd', 'Spawn command template'), function () { return config.spawnCmd; }, function (v) { config.spawnCmd = v; }, { ph: '#SpawnVehicle {code} 1 Location "X={x} Y={y} Z={z}"' }),
          inp(T('pl.vehicle-rental.set.removeCmd', 'Remove command template'), function () { return config.removeCmd; }, function (v) { config.removeCmd = v; }, { ph: '#DestroyVehicle {vehId}' }),
        ]),
        h('p', { class: 'muted', style: 'font-size:.78rem;margin-top:6px' }, T('pl.vehicle-rental.set.cmdTokens',
          'Placeholders: {code} {x} {y} {z} {steamid} {vehId}. Payment is taken automatically with #ChangeCurrencyBalance.')),
        // Rental hours for the whole system. Vehicles and plans can narrow this further; nothing
        // widens it, so a player is never offered something the server-wide hours have shut.
        h('div', { class: 'vr-opt-hd' }, T('pl.vehicle-rental.set.hours', 'Rental hours (leave empty and rentals are always open)')),
        twEditor(config, function () { }),
      ]));

      // ── in-game ──
      // Everything a player can do or see without opening Discord. Kept in its own card because it
      // is the half an owner tunes for their playerbase, separately from prices and limits.
      body.appendChild(card(T('pl.vehicle-rental.card.inGame', 'In-game'), [
        h('div', { class: 'vr-checks' }, [
          chk(T('pl.vehicle-rental.ig.notify', 'Send messages in-game'), function () { return config.inGameNotify !== false; }, function (v) { config.inGameNotify = v; }),
          chk(T('pl.vehicle-rental.ig.commands', 'Enable in-game commands'), function () { return config.inGameCommands !== false; }, function (v) { config.inGameCommands = v; }),
          chk(T('pl.vehicle-rental.ig.allowReturn', 'Allow returning early'), function () { return config.allowReturn !== false; }, function (v) { config.allowReturn = v; }),
          chk(T('pl.vehicle-rental.ig.verify', 'Check the vehicle still exists'), function () { return config.verifyVehicle !== false; }, function (v) { config.verifyVehicle = v; }),
        ]),
        h('div', { class: 'vr-grid' }, [
          (function () {
            var sel = h('select', {});
            ['local', 'global', 'squad', 'admin', 'server'].forEach(function (ch) {
              sel.appendChild(h('option', { value: ch, selected: (config.inGameChannel || 'local') === ch }, chatChannelLabel(ch)));
            });
            sel.addEventListener('change', function () { config.inGameChannel = sel.value; });
            return h('label', { class: 'vr-f' }, [h('span', {}, T('pl.vehicle-rental.ig.channel', 'Chat channel')), sel]);
          })(),
          inp(T('pl.vehicle-rental.ig.refund', 'Refund on early return (%)'), function () { return config.refundPercent; }, function (v) { config.refundPercent = v; }, { type: 'number', min: 0, max: 100 }),
          inp(T('pl.vehicle-rental.ig.cmdRent', 'Rent command'), function () { return config.cmdRent; }, function (v) { config.cmdRent = v; }, { ph: 'rent' }),
          inp(T('pl.vehicle-rental.ig.cmdMine', 'My rentals command'), function () { return config.cmdMine; }, function (v) { config.cmdMine = v; }, { ph: 'myrent' }),
          inp(T('pl.vehicle-rental.ig.cmdExtend', 'Extend command'), function () { return config.cmdExtend; }, function (v) { config.cmdExtend = v; }, { ph: 'extend' }),
          inp(T('pl.vehicle-rental.ig.cmdReturn', 'Return command'), function () { return config.cmdReturn; }, function (v) { config.cmdReturn = v; }, { ph: 'return' }),
        ]),
        h('div', { class: 'vr-grid' }, [
          inp(T('pl.vehicle-rental.ig.allowedSectors', 'Allowed sectors (blank = anywhere)'), function () { return (config.allowedSectors || []).join(', '); },
            function (v) { config.allowedSectors = String(v).split(',').map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean); }, { ph: 'B2, C3' }),
          inp(T('pl.vehicle-rental.ig.blockedSectors', 'Blocked sectors'), function () { return (config.blockedSectors || []).join(', '); },
            function (v) { config.blockedSectors = String(v).split(',').map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean); }, { ph: 'A0, Z4' }),
        ]),
        h('p', { class: 'muted', style: 'font-size:.78rem;margin-top:6px' }, T('pl.vehicle-rental.ig.note',
          'Command names have no prefix and apply on save. Rent is paid from the player\'s bank account.')),
        // …and whether it is available RIGHT NOW. The sentence above explains the rule; on its own it
        // leaves an owner to guess which side of it they are on, and these are the only settings here
        // that can be filled in correctly and still do nothing.
        sectorStatus,
      ]));
      refreshSectorStatus();

      // ── in-game wording ──
      body.appendChild(card(T('pl.vehicle-rental.card.messages', 'In-game messages'), [
        h('div', { class: 'vr-stack' }, (function () {
          // The config KEY and the LABEL in front of the box. The key is the owner's config and the
          // wording they type into the box is their data — neither is translated. The label is.
          var LINES = [
            ['confirmed', T('pl.vehicle-rental.text.confirmed', 'Rental confirmed')],
            ['endingSoon', T('pl.vehicle-rental.text.endingSoon', 'Ending soon')],
            ['ended', T('pl.vehicle-rental.text.ended', 'Rental ended')],
            ['returned', T('pl.vehicle-rental.text.returned', 'Returned early')],
            ['rentUsage', T('pl.vehicle-rental.text.rentUsage', 'Rent — usage / list')],
            ['noRentals', T('pl.vehicle-rental.text.noRentals', 'No active rentals')],
            // Double-quoted on purpose: the English carries "my rentals" in quotes of its own, and
            // escaping them here keeps the fallback one readable literal rather than three pieces.
            ['mineLine', T("pl.vehicle-rental.text.mineLine", "One line of \"my rentals\"")],
            ['extendOk', T('pl.vehicle-rental.text.extendOk', 'Extended')],
            ['notAllowedHere', T('pl.vehicle-rental.text.notAllowedHere', 'Sector not allowed')],
            ['disabled', T('pl.vehicle-rental.text.disabled', 'Rentals disabled')],
            ['closedNow', T('pl.vehicle-rental.text.closedNow', 'Outside its hours')],
            ['noVehicles', T('pl.vehicle-rental.text.noVehicles', 'Nothing to rent yet')],
            ['pickPlan', T('pl.vehicle-rental.text.pickPlan', 'Pick a plan')],
            ['returnOff', T('pl.vehicle-rental.text.returnOff', 'Early return is off')],
            ['nothingToReturn', T('pl.vehicle-rental.text.nothingToReturn', 'Nothing to return')],
            ['extendOff', T('pl.vehicle-rental.text.extendOff', 'Extending is off')],
            ['extendMaxed', T('pl.vehicle-rental.text.extendMaxed', 'Extension limit reached')],
            ['returnNoBridge', T('pl.vehicle-rental.text.returnNoBridge', 'Return could not be carried out')],
            ['refundGone', T('pl.vehicle-rental.text.refundGone', 'Note — the vehicle was already gone')],
            ['refundFailed', T('pl.vehicle-rental.text.refundFailed', 'Note — the refund did not go out')],
            ['refundNoPrice', T('pl.vehicle-rental.text.refundNoPrice', 'Note — no recorded price')],
            ['returnStuck', T('pl.vehicle-rental.text.returnStuck', 'Note — the vehicle could not be removed')],
            ['moreElsewhere', T('pl.vehicle-rental.text.moreElsewhere', 'Tail on a list too long for chat')],
            // The money outcomes, and there are THREE of them rather than two. A command the bridge
            // dispatched with nobody in the world is handed over and never confirmed, so "you were
            // not charged" is a sentence nobody on this side can honestly say — these are what is
            // said instead. Keep the difference when you translate them: the "…Unknown" lines must
            // not read like the definite ones.
            ['spawnRefused', T('pl.vehicle-rental.text.spawnRefused', 'The game refused the spawn (stale code)')],
            ['rentFailedSpawn', T('pl.vehicle-rental.text.rentFailedSpawn', 'Rent failed — the spawn did not work')],
            ['rentFailedNoBridge', T('pl.vehicle-rental.text.rentFailedNoBridge', 'Rent failed — the bridge is offline')],
            ['rentFailedUnconfirmed', T('pl.vehicle-rental.text.rentFailedUnconfirmed', 'Rent failed — the spawn was not confirmed')],
            ['chargeFailed', T('pl.vehicle-rental.text.chargeFailed', 'Payment refused — definitely not charged')],
            ['chargeUnknown', T('pl.vehicle-rental.text.chargeUnknown', 'Payment UNKNOWN — we cannot say whether it was taken')],
            ['extendFailed', T('pl.vehicle-rental.text.extendFailed', 'Extend — payment refused')],
            ['extendUnknown', T('pl.vehicle-rental.text.extendUnknown', 'Extend — payment UNKNOWN')],
            ['extendRace', T('pl.vehicle-rental.text.extendRace', 'Extend lost the race — refunded')],
            ['extendRaceUnknown', T('pl.vehicle-rental.text.extendRaceUnknown', 'Extend lost the race — refund UNKNOWN')],
            ['extendRaceFailed', T('pl.vehicle-rental.text.extendRaceFailed', 'Extend lost the race — refund failed')],
            ['refundUnknown', T('pl.vehicle-rental.text.refundUnknown', 'Note — the refund could not be confirmed')],
            ['balanceListCut', T('pl.vehicle-rental.text.balanceListCut', 'The list of who is online was cut')],
            // Every other sentence a player reads — the limits, the refusals, the balance check, the
            // notes on an ended rental and the whole Discord flow — which used to be English
            // literals in the backend and are the owner's to word now like every line above.
            ['free', T('pl.vehicle-rental.text.free', 'Word for “free”')],
            ['unitMoney', T('pl.vehicle-rental.text.unitMoney', 'Word for money')],
            ['unitGold', T('pl.vehicle-rental.text.unitGold', 'Word for gold')],
            ['poolBank', T('pl.vehicle-rental.text.poolBank', 'Name of the bank balance')],
            ['poolGold', T('pl.vehicle-rental.text.poolGold', 'Name of the gold balance')],
            ['noPlans', T('pl.vehicle-rental.text.noPlans', 'List — vehicle with no plans')],
            ['noPlansPick', T('pl.vehicle-rental.text.noPlansPick', 'Plan list — none set up')],
            ['closedMark', T('pl.vehicle-rental.text.closedMark', 'List — what ⏳ means')],
            ['windowsNeedManager', T('pl.vehicle-rental.text.windowsNeedManager', 'Hours — manager too old')],
            ['winRentals', T('pl.vehicle-rental.text.winRentals', 'Hours — name for all rentals')],
            ['winVehicle', T('pl.vehicle-rental.text.winVehicle', 'Hours — name for a vehicle')],
            ['winPlan', T('pl.vehicle-rental.text.winPlan', 'Hours — name for a plan')],
            ['limitActive', T('pl.vehicle-rental.text.limitActive', 'Limit — too many active rentals')],
            ['limitActiveVehicle', T('pl.vehicle-rental.text.limitActiveVehicle', 'Limit — too many of this vehicle')],
            ['tooOften', T('pl.vehicle-rental.text.tooOften', 'Limit — cooldown not over')],
            ['limitDaily', T('pl.vehicle-rental.text.limitDaily', 'Limit — daily limit reached')],
            ['limitDailyVehicle', T('pl.vehicle-rental.text.limitDailyVehicle', 'Limit — daily limit for this vehicle')],
            ['busy', T('pl.vehicle-rental.text.busy', 'Rent — still being processed')],
            ['noStorage', T('pl.vehicle-rental.text.noStorage', 'Rent — storage problem')],
            ['badChoice', T('pl.vehicle-rental.text.badChoice', 'Rent — invalid choice')],
            ['noSpawnCode', T('pl.vehicle-rental.text.noSpawnCode', 'Rent — vehicle has no spawn code')],
            ['badDuration', T('pl.vehicle-rental.text.badDuration', 'Rent — plan duration is negative')],
            ['mustBeOnline', T('pl.vehicle-rental.text.mustBeOnline', 'Rent — must be online')],
            ['notFound', T('pl.vehicle-rental.text.notFound', 'Rent — player not found in game')],
            ['notEnough', T('pl.vehicle-rental.text.notEnough', 'Rent — not enough money')],
            ['notEnoughExtend', T('pl.vehicle-rental.text.notEnoughExtend', 'Extend — not enough money')],
            ['savedBalance', T('pl.vehicle-rental.text.savedBalance', 'Note — balance is from the last save')],
            ['depositCash', T('pl.vehicle-rental.text.depositCash', 'Advice — deposit carried cash')],
            ['extendBusy', T('pl.vehicle-rental.text.extendBusy', 'Extend — still being processed')],
            ['extendNoPrice', T('pl.vehicle-rental.text.extendNoPrice', 'Extend — no recorded price')],
            ['extendMustBeOnline', T('pl.vehicle-rental.text.extendMustBeOnline', 'Extend — must be online')],
            ['extendGone', T('pl.vehicle-rental.text.extendGone', 'Extend — the vehicle is gone')],
            ['endedByAdmin', T('pl.vehicle-rental.text.endedByAdmin', 'Note — ended by an admin')],
            ['endedStuck', T('pl.vehicle-rental.text.endedStuck', 'Note — ended, vehicle not removed')],
            ['expiredStuck', T('pl.vehicle-rental.text.expiredStuck', 'Note — expired, vehicle not removed')],
            ['dcError', T('pl.vehicle-rental.text.dcError', 'Discord — something went wrong')],
            ['dcPickVehicle', T('pl.vehicle-rental.text.dcPickVehicle', 'Discord — pick a vehicle')],
            ['dcChooseVehicle', T('pl.vehicle-rental.text.dcChooseVehicle', 'Discord — vehicle menu hint')],
            ['dcPlanCount', T('pl.vehicle-rental.text.dcPlanCount', 'Discord — number of plans')],
            ['dcNoPlans', T('pl.vehicle-rental.text.dcNoPlans', 'Discord — vehicle has no plans')],
            ['dcChoosePlan', T('pl.vehicle-rental.text.dcChoosePlan', 'Discord — plan menu hint')],
            ['dcRenting', T('pl.vehicle-rental.text.dcRenting', 'Discord — choose a plan')],
            ['dcStale', T('pl.vehicle-rental.text.dcStale', 'Discord — menu out of date')],
            ['dcLinkFirst', T('pl.vehicle-rental.text.dcLinkFirst', 'Discord — link your character first')],
            ['dcProcessing', T('pl.vehicle-rental.text.dcProcessing', 'Discord — processing')],
            ['dcNoStorage', T('pl.vehicle-rental.text.dcNoStorage', 'Discord — storage problem')],
            ['dcNotActive', T('pl.vehicle-rental.text.dcNotActive', 'Discord — rental no longer active')],
            ['dcExtended', T('pl.vehicle-rental.text.dcExtended', 'Discord — extended')],
            ['dcExtendButton', T('pl.vehicle-rental.text.dcExtendButton', 'Discord — Extend button')],
            ['embConfirmed', T('pl.vehicle-rental.text.embConfirmed', 'Embed — confirmed, title')],
            ['embVehicle', T('pl.vehicle-rental.text.embVehicle', 'Embed — Vehicle field')],
            ['embDuration', T('pl.vehicle-rental.text.embDuration', 'Embed — Duration field')],
            ['embPrice', T('pl.vehicle-rental.text.embPrice', 'Embed — Price field')],
            ['embExpires', T('pl.vehicle-rental.text.embExpires', 'Embed — Expires field')],
            ['embSoonTitle', T('pl.vehicle-rental.text.embSoonTitle', 'Embed — ending soon, title')],
            ['embSoon', T('pl.vehicle-rental.text.embSoon', 'Embed — ending soon')],
            ['embSoonExtend', T('pl.vehicle-rental.text.embSoonExtend', 'Embed — ending soon, can extend')],
            ['embEndedTitle', T('pl.vehicle-rental.text.embEndedTitle', 'Embed — ended, title')],
            ['embEnded', T('pl.vehicle-rental.text.embEnded', 'Embed — ended')],
            ['embEndedRemoved', T('pl.vehicle-rental.text.embEndedRemoved', 'Embed — ended and removed')],
          ];
          if (!config.texts) config.texts = {};
          // ⚠ **THIS LIST IS THE ORDER AND THE LABEL, NEVER THE SET.** The screen used to draw
          // exactly the keys named here, so every line the backend added afterwards had no field at
          // all — and the ones missing were the FRAGMENTS concatenated onto a reply, which the
          // backend's own comment already records as player-facing: a Czech server said "✅ Kolo
          // vráceno. Díky! (the refund could not be paid out — tell an admin)". A screen headed
          // "In-game messages" has to hold the messages, not a subset somebody remembered.
          //
          // A line the backend adds later therefore has no label of ours and no key to translate:
          // its caption is DERIVED from the config key, which is the honest answer — inventing a
          // translation key for a name this build has never seen is not possible.
          var named = {};
          LINES.forEach(function (p) { named[p[0]] = 1; });
          var rest = Object.keys(config.texts).filter(function (k) { return !named[k]; })
            .map(function (k) { return [k, k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, function (ch) { return ch.toUpperCase(); })]; });
          return LINES.concat(rest).filter(function (pair) { return config.texts[pair[0]] !== undefined; }).map(function (pair) {
            return inp(pair[1], function () { return config.texts[pair[0]] || ''; }, function (v) { config.texts[pair[0]] = v; });
          });
        })()),
        h('p', { class: 'muted', style: 'font-size:.78rem;margin-top:6px' }, T('pl.vehicle-rental.text.tokens',
          'Tokens: {player} {vehicle} {duration} {price} {left} {sector} {cmd} {list} {window} {max} {n}. Some lines have their own. Leave a line empty for the default.')),
      ]));

      // ── vehicles ──
      var vehBox = h('div', {});
      var vehFind = h('input', { class: 'vr-search', type: 'search', placeholder: T('pl.vehicle-rental.veh.searchList', 'Search vehicles…') });
      vehFind.addEventListener('input', function () { renderVeh(); });
      // Discord's own limits, stated where they bite. A 26th vehicle or a 26th plan is simply not
      // offered in the Discord menu — it stays rentable from chat, which is exactly the kind of
      // "works for me, not for them" an owner has no way to discover on their own.
      var vehWarn = h('div', { class: 'vr-warn' });
      function unnamed() { return T('pl.vehicle-rental.veh.unnamed', 'unnamed'); }
      function renderWarn() {
        var msgs = [];
        if (config.vehicles.length > 25) {
          msgs.push(T('pl.vehicle-rental.warn.tooManyVehicles',
            'Discord lists only 25: the last {n} vehicle(s) are missing there but still rentable in game.',
            { n: config.vehicles.length - 25 }));
        }
        var over = config.vehicles.filter(function (v) { return (v.options || []).length > 25; }).map(function (v) { return v.name || unnamed(); });
        if (over.length) msgs.push(T('pl.vehicle-rental.warn.tooManyPlans', 'More than 25 plans on: {list} — only the first 25 show in Discord.', { list: over.join(', ') }));
        var noCode = config.vehicles.filter(function (v) { return !v.code; }).map(function (v) { return v.name || unnamed(); });
        if (noCode.length) {
          msgs.push(T('pl.vehicle-rental.warn.noCode',
            'No spawn code on: {list}. Renting those fails and asks the player to tell an admin.', { list: noCode.join(', ') }));
        }
        // A code that is present but is not a blueprint id fails exactly the same way, and used to
        // be invisible here because the check only asked whether the field was empty.
        var badCode = config.vehicles.filter(function (v) { return v.code && !/^BPC_[A-Za-z0-9_]+$/.test(String(v.code).trim()); })
          .map(function (v) { return T('pl.vehicle-rental.warn.badCodeItem', '{name} (“{code}”)', { name: v.name || unnamed(), code: v.code }); });
        if (badCode.length) {
          msgs.push(T('pl.vehicle-rental.warn.badCode',
            'Not a vehicle blueprint (codes start with BPC_) on: {list}. Those will fail to spawn.', { list: badCode.join(', ') }));
        }
        // Two different problems, said differently, because they need different action.
        // A NEGATIVE duration is refused outright by the backend — it would expire the instant it
        // was paid for. A blank or zero one quietly becomes an hour, which is almost certainly not
        // what the owner meant to sell but has been working that way all along.
        var negDur = config.vehicles.filter(function (v) {
          return (v.options || []).some(function (o) { return parseInt(o && o.minutes, 10) < 0; });
        }).map(function (v) { return v.name || unnamed(); });
        if (negDur.length) {
          msgs.push(T('pl.vehicle-rental.warn.negativeDuration',
            'Negative duration on: {list}. That plan is refused; it would expire the moment it is paid.', { list: negDur.join(', ') }));
        }
        var vagueDur = config.vehicles.filter(function (v) {
          return (v.options || []).some(function (o) { var n = parseInt(o && o.minutes, 10); return !(n > 0) && !(n < 0); });
        }).map(function (v) { return v.name || unnamed(); });
        if (vagueDur.length) {
          msgs.push(T('pl.vehicle-rental.warn.noDuration',
            'No duration on: {list}. Those sell as 60 minutes; set the minutes you mean.', { list: vagueDur.join(', ') }));
        }
        var noPlan = config.vehicles.filter(function (v) { return !(v.options || []).length; }).map(function (v) { return v.name || unnamed(); });
        if (noPlan.length) {
          msgs.push(T('pl.vehicle-rental.warn.noPlans', 'No rental plans on: {list} — nothing to pick, so they cannot be rented.', { list: noPlan.join(', ') }));
        }
        vehWarn.innerHTML = '';
        vehWarn.style.display = msgs.length ? '' : 'none';
        msgs.forEach(function (m) { vehWarn.appendChild(h('p', {}, '⚠ ' + m)); });
      }
      function renderVeh() {
        vehBox.innerHTML = '';
        renderWarn();
        var q = (vehFind.value || '').trim().toLowerCase();
        var shown = 0;
        config.vehicles.forEach(function (v, vi) {
          if (!Array.isArray(v.options)) v.options = [];
          if (q && ((v.name || '') + ' ' + (v.code || '')).toLowerCase().indexOf(q) < 0) return;
          shown++;
          var optBox = h('div', { class: 'vr-opts' });
          function renderOpts() {
            optBox.innerHTML = '';
            v.options.forEach(function (o, oi) {
              // `min` on both. A negative price is harmless — the backend clamps it to zero — but a
              // negative or zero duration is not: the rental is paid for and then expires on the very
              // next sweep, so the player is charged and the vehicle is taken away a minute later.
              var row = [inp(T('pl.vehicle-rental.plan.minutes', 'Minutes'), function () { return o.minutes; }, function (x) { o.minutes = x; }, { type: 'number', min: '1' })];
              if (!config.free) {
                row.push(inp(T('pl.vehicle-rental.plan.currency', 'Currency'), function () { return o.currency || 'money'; }, function (x) { o.currency = x; },
                  { type: 'select', options: [['money', T('pl.vehicle-rental.plan.money', 'Money')], ['gold', T('pl.vehicle-rental.plan.gold', 'Gold')]] }));
                row.push(inp(T('pl.vehicle-rental.plan.amount', 'Amount'), function () { return o.amount; }, function (x) { o.amount = x; }, { type: 'number', min: '0' }));
              }
              row.push(h('button', { class: 'vr-x', title: T('pl.vehicle-rental.plan.remove', 'Remove plan'), onclick: function () { v.options.splice(oi, 1); renderOpts(); } }, '✕'));
              // A window on the PLAN is how a price that changes by time of day is expressed: two
              // plans on the same vehicle, one windowed to the evening and one not. There is
              // deliberately no separate "discount" field — a second plan already says it, and a
              // discount that could disagree with the plan it discounts is a price nobody can see.
              optBox.appendChild(h('div', { class: 'vr-opt-wrap' }, [
                h('div', { class: config.free ? 'vr-opt vr-opt-free' : 'vr-opt' }, row),
                twEditor(o, function () { }),
              ]));
            });
            if (!v.options.length) {
              optBox.appendChild(h('div', { class: 'muted', style: 'font-size:.8rem' }, T('pl.vehicle-rental.plan.none',
                'No plans yet. Add one (length and price) before this vehicle can be rented.')));
            }
          }
          renderOpts();
          vehBox.appendChild(h('div', { class: 'vr-veh' }, [
            h('button', { class: 'vr-x vr-x-top', title: T('pl.vehicle-rental.veh.remove', 'Remove vehicle'), onclick: function () { config.vehicles.splice(vi, 1); renderVeh(); } }, '✕'),
            h('div', { class: 'vr-grid' }, [
              inp(T('pl.vehicle-rental.veh.name', 'Vehicle name'), function () { return v.name; }, function (x) { v.name = x; }, { ph: 'Quad Bike' }),
              vehField(v, renderVeh),
              inp(T('pl.vehicle-rental.veh.image', 'Image URL (optional)'), function () { return v.image; }, function (x) { v.image = x; }),
            ]),
            h('div', { class: 'vr-opt-hd' }, T('pl.vehicle-rental.veh.limitsHd', 'Per-vehicle limits (leave blank = use the global setting)')),
            h('div', { class: 'vr-grid' }, [
              inp(T('pl.vehicle-rental.veh.maxPerPlayer', 'Max active / player'), function () { return v.maxPerPlayer; }, function (x) { v.maxPerPlayer = x; }, { ph: T('pl.vehicle-rental.veh.phGlobal', 'global') }),
              inp(T('pl.vehicle-rental.veh.cooldown', 'Cooldown (min)'), function () { return v.cooldownMinutes; }, function (x) { v.cooldownMinutes = x; }, { ph: T('pl.vehicle-rental.veh.phGlobal', 'global') }),
              inp(T('pl.vehicle-rental.veh.dailyLimit', 'Daily limit'), function () { return v.dailyLimit; }, function (x) { v.dailyLimit = x; }, { ph: T('pl.vehicle-rental.veh.phGlobal', 'global') }),
              inp(T('pl.vehicle-rental.set.maxExtensions', 'Max extensions / rental (0 = ∞)'), function () { return v.maxExtensions; }, function (x) { v.maxExtensions = x; }, { ph: T('pl.vehicle-rental.veh.phGlobal', 'global') }),
              inp(T('pl.vehicle-rental.set.reminder', 'Remind before expiry (min)'), function () { return v.reminderMinutes; }, function (x) { v.reminderMinutes = x; }, { ph: T('pl.vehicle-rental.veh.phGlobal', 'global') }),
            ]),
            h('div', { class: 'vr-opt-hd' }, T('pl.vehicle-rental.veh.hoursHd', 'When this vehicle can be rented (empty = whenever rentals are open)')),
            twEditor(v, function () { }),
            // Two whole headings rather than a fragment glued onto one: "+ price" is not a phrase a
            // translator can place, and where it belongs in the sentence is different per language.
            h('div', { class: 'vr-opt-hd' }, config.free
              ? T('pl.vehicle-rental.veh.plansHd', 'Rental plans (duration)')
              : T('pl.vehicle-rental.veh.plansHdPriced', 'Rental plans (duration + price)')),
            optBox,
            h('button', { class: 'vr-btn add', onclick: function () { v.options.push({ minutes: 60, currency: 'money', amount: 5000 }); renderOpts(); } }, T('pl.vehicle-rental.veh.addPlan', '+ Add plan')),
          ]));
        });
        if (!config.vehicles.length) vehBox.appendChild(h('div', { class: 'muted', style: 'font-size:.85rem;padding:8px' }, T('pl.vehicle-rental.veh.none', 'No vehicles yet — add one.')));
        else if (!shown) {
          vehBox.appendChild(h('div', { class: 'muted', style: 'font-size:.85rem;padding:8px' },
            T('pl.vehicle-rental.veh.noMatch', 'No vehicle matches “{q}”.', { q: vehFind.value })));
        }
      }
      renderVeh();
      body.appendChild(card(T('pl.vehicle-rental.card.vehicles', 'Vehicles'), [
        h('div', { class: 'vr-vbar' }, [
          h('button', { class: 'vr-btn add', onclick: function () { config.vehicles.push({ name: '', code: '', image: '', options: [{ minutes: 60, currency: 'money', amount: 5000 }] }); vehFind.value = ''; renderVeh(); } }, T('pl.vehicle-rental.veh.add', '+ Add vehicle')),
          vehFind,
        ]),
        vehWarn,
        vehBox,
      ]));

      // ── menu embed (via embed-editor) ──
      var embDiv = h('div', {});
      var ed = SSA.consume('embed-editor');
      if (ed) ed.mount(embDiv, { value: config.menuEmbed || {}, onChange: function (json) { config.menuEmbed = json; } });
      // Names the plugin the way its own manifest does, and no menu path: enabling a plugin is
      // where the owner already is. A route written into eighteen locale files is a route that
      // survives exactly until somebody renames the screen.
      // Double-quoted for the same reason as the "my rentals" label above: the plugin's own name is
      // quoted inside the sentence, and it is spelled exactly as that plugin's manifest spells it.
      else embDiv.appendChild(h('div', { class: 'muted', style: 'font-size:.85rem' }, T("pl.vehicle-rental.embed.needPlugin", "Enable the \"Discord Embeds\" plugin to design the menu embed here.")));
      body.appendChild(card(T('pl.vehicle-rental.card.embed', 'Rental menu embed'), [embDiv]));

      // ── save + post + rentals ──
      // Nothing on this page takes effect until it is saved, and it is a long page — so it says
      // plainly when there is something unsaved, and warns before the tab is closed on top of it.
      var status = h('span', { class: 'muted', style: 'font-size:.85rem' });
      // The baseline belongs to the last SAVE (or load), not to the last redraw. render() runs again
      // whenever "Free rentals" is toggled, and re-taking it there quietly declared an hour of
      // unsaved edits already saved — the indicator went out and the close warning stopped.
      function dirty() { return JSON.stringify(config) !== savedSnapshot; }
      function markSaved() { savedSnapshot = JSON.stringify(config); status.textContent = T('pl.vehicle-rental.save.saved', 'Saved ✓'); statusHold = false; busy = false; }
      // A failed save's sentence has to STAY beside the button until the next attempt — a toast is
      // gone in four seconds and the owner's edits are still sitting unsaved in front of them. The
      // 1.2s tick below would otherwise paint over it with the milder "unsaved changes" note a
      // moment later, so it is told to leave `status` alone while this is true.
      var statusHold = false;
      // Whether a save or a post is in flight. This was read off `status.textContent` with a
      // /Saving|Posting/ test — a sentence matched against ENGLISH, which stops being true the
      // moment either word is translated, and the tick below would then paint "Unsaved changes"
      // over a save that is still running. A flag says the same thing in every language.
      var busy = false;
      // One timer for the tab, not one per redraw.
      if (window.vrDirtyTick) clearInterval(window.vrDirtyTick);
      window.vrDirtyTick = setInterval(function () {
        // `isConnected`, not `parentNode`: leaving the tab removes the tab's ROOT, and `body` keeps its
        // parent inside that detached root, so a parent test never fired.
        if (!body.isConnected) { clearInterval(window.vrDirtyTick); window.vrDirtyTick = null; return; }
        if (dirty() && !statusHold && !busy) status.textContent = T('pl.vehicle-rental.save.unsaved', '● Unsaved changes');
      }, 1200);
      if (window.vrBeforeUnload) window.removeEventListener('beforeunload', window.vrBeforeUnload);
      window.vrBeforeUnload = function (e) { if (dirty()) { e.preventDefault(); e.returnValue = ''; } };
      window.addEventListener('beforeunload', window.vrBeforeUnload);

      body.appendChild(h('div', { class: 'vr-actions' }, [
        h('button', { class: 'vr-btn primary', onclick: function () {
          statusHold = false;
          busy = true;
          status.textContent = T('pl.vehicle-rental.save.saving', 'Saving…');
          api('/config', { method: 'POST', body: config }).then(function () {
            markSaved();
          }).catch(function (err) {
            busy = false;
            statusHold = true;
            status.textContent = T('pl.vehicle-rental.save.notSaved', '⚠ Not saved — {why}', { why: why(err) });
            try { SSA.toast(T('pl.vehicle-rental.save.notSavedToast', 'Not saved — {why}', { why: why(err) }), 'error'); } catch (e) { /* toast optional */ }
          });
        } }, T('pl.vehicle-rental.save.button', 'Save configuration')),
        h('button', { class: 'vr-btn', onclick: function () {
          statusHold = false;
          busy = true;
          status.textContent = T('pl.vehicle-rental.post.posting', 'Posting…');
          api('/config', { method: 'POST', body: config }).then(function () {
            markSaved();
            busy = true;
            return api('/post-menu', { method: 'POST' }).then(function (r) {
              // Say WHICH thing went wrong. One message for three different causes left an owner
              // guessing between "no channel", "bot offline" and "bot cannot post there".
              busy = false;
              if (r && r.ok) { status.textContent = T('pl.vehicle-rental.post.done', 'Menu posted ✓'); return; }
              statusHold = true;
              status.textContent = !config.channelId
                ? T('pl.vehicle-rental.post.pickChannel', '⚠ Pick a channel first')
                : T('pl.vehicle-rental.post.failed', '⚠ Could not post. Check the bot is online and can post in that channel.');
            }).catch(function (err) {
              // The config DID save — say so, so the owner does not re-save believing their edits
              // were lost, and does not re-click "Save & post" expecting the first half to run again.
              busy = false;
              statusHold = true;
              status.textContent = T('pl.vehicle-rental.post.savedNotPosted', '⚠ Saved, but the menu could not be posted — {why}', { why: why(err) });
              try { SSA.toast(T('pl.vehicle-rental.post.savedNotPostedToast', 'Saved, but the menu could not be posted — {why}', { why: why(err) }), 'error'); } catch (e) { /* toast optional */ }
            });
          }).catch(function (err) {
            busy = false;
            statusHold = true;
            status.textContent = T('pl.vehicle-rental.save.notSaved', '⚠ Not saved — {why}', { why: why(err) });
            try { SSA.toast(T('pl.vehicle-rental.save.notSavedToast', 'Not saved — {why}', { why: why(err) }), 'error'); } catch (e) { /* toast optional */ }
          });
        } }, T('pl.vehicle-rental.post.button', 'Save & post menu')),
        status,
      ]));

      // ── active rentals ──
      // The panel's own table, so it searches, sorts and pages like every other list in the manager
      // — and so an admin can actually DO something. A rental whose vehicle id was never captured,
      // or one that needs revoking, used to sit here read-only until it expired.
      var active = [];
      var activeTbl = SSA.table({
        columns: [
          { key: 'player', label: T('pl.vehicle-rental.col.player', 'Player'), sort: true, sortVal: function (r) { return (r.playerName || r.steamId || '').toLowerCase(); }, render: function (r) { return document.createTextNode(r.playerName || r.steamId || '—'); } },
          { key: 'vehicle', label: T('pl.vehicle-rental.col.vehicle', 'Vehicle'), sort: true, sortVal: function (r) { return (r.vehName || '').toLowerCase(); }, render: function (r) { return document.createTextNode(r.vehName || '—'); } },
          { key: 'left', label: T('pl.vehicle-rental.col.left', 'Time left'), sort: true, sortVal: function (r) { return r.expiresAt; }, render: function (r) { return h('span', { title: new Date(r.expiresAt).toLocaleString() }, left(r.expiresAt)); } },
          // Blank means auto-removal will be skipped for this one — worth seeing before it expires.
          { key: 'veh', label: T('pl.vehicle-rental.col.vehId', 'Vehicle id'), render: function (r) { return r.vehId ? h('code', {}, r.vehId) : h('span', { class: 'muted', title: T('pl.vehicle-rental.rent.notCapturedTitle', 'The spawned vehicle could not be identified, so it will NOT be removed automatically.') }, T('pl.vehicle-rental.rent.notCaptured', 'not captured')); } },
          { key: 'ext', label: T('pl.vehicle-rental.col.extended', 'Extended'), render: function (r) { return document.createTextNode(String(r.extensions || 0)); } },
          { key: 'act', label: '', render: function (r) {
            return h('button', { class: 'vr-btn danger', title: T('pl.vehicle-rental.rent.endTitle', 'End it now and remove the vehicle'), onclick: function () {
              // SSA.confirm resolves to true/false — it takes options as its second argument, not a
              // callback, so a callback there would simply never run.
              // Says NO REFUND, before the click rather than after. A player who returns a rental
              // early gets the configured refund; ending one from here pays nothing, and an admin
              // reaching for this button has no reason to assume the two differ.
              SSA.confirm(T('pl.vehicle-rental.rent.endConfirm',
                'End the rental of {vehicle} for {player}?\n\nThe vehicle is removed and the player is told. No refund.',
              { vehicle: r.vehName || T('pl.vehicle-rental.rent.thisVehicle', 'this vehicle'), player: r.playerName || r.steamId }),
              { title: T('pl.vehicle-rental.rent.endDialog', 'End rental'), okLabel: T('pl.vehicle-rental.rent.endOk', 'End it') }).then(function (yes) {
                if (!yes) return;
                api('/rentals/end', { method: 'POST', body: { id: r.id } }).then(function (out) {
                  // "Ended (the vehicle was already gone)" was the message for BOTH "it really was
                  // gone" and "we could not identify it", and those need different action from an
                  // admin: one is fine, the other leaves a vehicle in the world.
                  if (out && out.ok) {
                    SSA.toast(out.removed ? T('pl.vehicle-rental.rent.endedRemoved', 'Rental ended and the vehicle removed.')
                      : (out.stillThere ? T('pl.vehicle-rental.rent.endedStuck', 'Rental ended, but the vehicle could NOT be removed. It may still be out there.')
                        : T('pl.vehicle-rental.rent.endedGone', 'Rental ended (the vehicle was already gone).')),
                    out.removed || !out.stillThere ? undefined : 'error');
                  } else {
                    SSA.toast(T('pl.vehicle-rental.rent.endFailed', 'Could not end it: {why}',
                      { why: (out && out.error) || T('pl.vehicle-rental.rent.unknownReason', 'unknown') }), 'error');
                  }
                  loadRentals();
                }).catch(function (err) {
                  // A destructive action: the toast begins with what did NOT happen. The rental is
                  // NOT reloaded here — the list on screen is still accurate, and refreshing it after
                  // a request that never landed would only invite a "did it work?" re-click.
                  SSA.toast(T('pl.vehicle-rental.rent.notEnded', 'The rental was NOT ended — {why}', { why: why(err) }), 'error');
                });
              });
            } }, T('pl.vehicle-rental.rent.endButton', 'End'));
          } },
        ],
        rows: function () { return active; },
        search: function (r) { return (r.playerName || '') + ' ' + (r.steamId || '') + ' ' + (r.vehName || ''); },
        searchPlaceholder: T('pl.vehicle-rental.rent.search', 'Search rentals…'),
        empty: T('pl.vehicle-rental.rent.empty', 'No active rentals. A rental shows here when a player rents; you can end it here.'),
        onRefresh: function () { loadRentals(); },
      });

      var past = [];
      var histTbl = SSA.table({
        columns: [
          { key: 'player', label: T('pl.vehicle-rental.col.player', 'Player'), sort: true, sortVal: function (r) { return (r.playerName || r.steamId || '').toLowerCase(); }, render: function (r) { return document.createTextNode(r.playerName || r.steamId || '—'); } },
          { key: 'vehicle', label: T('pl.vehicle-rental.col.vehicle', 'Vehicle'), sort: true, sortVal: function (r) { return (r.vehName || '').toLowerCase(); }, render: function (r) { return document.createTextNode(r.vehName || '—'); } },
          { key: 'started', label: T('pl.vehicle-rental.col.started', 'Started'), sort: true, sortVal: function (r) { return r.startedAt; }, render: function (r) { return document.createTextNode(new Date(r.startedAt).toLocaleString()); } },
          { key: 'ended', label: T('pl.vehicle-rental.col.ended', 'How it ended'), render: function (r) { return document.createTextNode(endedReasonText(r.endedReason)); } },
          { key: 'ext', label: T('pl.vehicle-rental.col.extended', 'Extended'), render: function (r) { return document.createTextNode(String(r.extensions || 0)); } },
        ],
        rows: function () { return past; },
        search: function (r) { return (r.playerName || '') + ' ' + (r.steamId || '') + ' ' + (r.vehName || ''); },
        searchPlaceholder: T('pl.vehicle-rental.hist.search', 'Search past rentals…'),
        empty: T('pl.vehicle-rental.hist.empty', 'Nothing finished yet. Rentals move here when they expire, are returned, or you end them.'),
        onRefresh: function () { loadRentals(); },
      });

      function left(ts) {
        var ms = ts - Date.now();
        if (ms <= 0) return T('pl.vehicle-rental.left.due', 'due now');
        var m = Math.round(ms / 60000);
        if (m < 60) return T('pl.vehicle-rental.left.minutes', '{n} min', { n: m });
        return m % 60
          ? T('pl.vehicle-rental.left.hoursMinutes', '{h}h {m}m', { h: Math.floor(m / 60), m: m % 60 })
          : T('pl.vehicle-rental.left.hours', '{h}h', { h: Math.floor(m / 60) });
      }
      // A failed fetch here used to reject silently — nothing rendered, nothing said so, and the
      // tables simply kept whatever they last had with no sign that the live half had stopped. This
      // is the poll-tick case: keep the last figures on screen, say plainly that they have stopped
      // updating and why, and keep retrying — the 30s tick and every manual refresh already do that,
      // this only has to stop hiding it.
      var rentalsErr = null;
      var rentalsErrBar = h('p', { class: 'vr-live-err', style: 'display:none' });
      function renderRentalsErr() {
        if (!rentalsErr) { rentalsErrBar.style.display = 'none'; return; }
        rentalsErrBar.style.display = '';
        rentalsErrBar.textContent = T('pl.vehicle-rental.live.stopped',
          '⚠ The lists below stopped updating: {why} Settings are unaffected; it keeps retrying.', { why: rentalsErr });
      }
      function loadRentals() {
        api('/rentals').then(function (l) { active = Array.isArray(l) ? l : []; rentalsErr = null; activeTbl.refresh(); renderRentalsErr(); })
          .catch(function (err) { rentalsErr = why(err); renderRentalsErr(); });
        api('/history').then(function (l) { past = Array.isArray(l) ? l : []; histTbl.refresh(); })
          .catch(function (err) { rentalsErr = why(err); renderRentalsErr(); });
      }
      loadRentals();
      // One timer per mount, cleared when the tab is rebuilt, so reopening the tab never stacks them.
      // Every tick RE-FETCHES both lists. It used to only redraw the countdown from data already in
      // hand, so a rental a player started after the tab was opened did not appear until somebody
      // clicked refresh. Fetching also keeps "it keeps retrying" in the message above true.
      if (window.vrTick) clearInterval(window.vrTick);
      // It stops once the tab has been left and skips a round while the browser tab is hidden.
      window.vrTick = setInterval(function () {
        if (!body.isConnected) { clearInterval(window.vrTick); window.vrTick = null; return; }
        if (document.hidden) return;
        loadRentals();
      }, 30000);

      body.appendChild(rentalsErrBar);
      body.appendChild(card(T('pl.vehicle-rental.card.active', 'Active rentals'), [activeTbl.el]));
      body.appendChild(card(T('pl.vehicle-rental.card.finished', 'Finished rentals'), [histTbl.el]));
    }

    function card(title, kids) { return h('div', { class: 'card vr-card' }, [h('h3', { class: 'vr-card-t' }, title)].concat(kids)); }
  }

  SSA.ready(function () {
    SSA.registerTab({ id: 'vehicle-rental', label: T('pl.vehicle-rental.tab', 'Rentals'), icon: '🚗', premium: true, render: editor });
  });
}());
