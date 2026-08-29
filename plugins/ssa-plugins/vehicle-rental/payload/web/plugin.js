/* Vehicle Rental — admin configuration UI. Configure vehicles, durations, money/gold prices, the
   channel and the in-game commands, design the menu embed (via the embed-editor plugin), post it,
   and watch active rentals. */
(function () {
  var API = '/api/plugin-host/vehicle-rental';
  function api(p, opts) {
    opts = opts || {}; var init = Object.assign({ credentials: 'same-origin' }, opts);
    if (init.body && typeof init.body === 'object') { init.headers = Object.assign({ 'Content-Type': 'application/json' }, init.headers || {}); init.body = JSON.stringify(init.body); }
    return fetch(API + p, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        // The HTTP status matters. A 401 after the session expired is valid JSON, so collapsing every
        // response to its body meant a failed save was reported as "Saved ✓" — and the unsaved-changes
        // guard was cleared at the same time, so closing the tab lost the work silently.
        if (!r.ok) return { _httpError: r.status, error: (body && body.error) || ('HTTP ' + r.status) };
        return body;
      });
    });
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
  function inp(label, get, set, o) {
    o = o || {}; var ctl;
    if (o.type === 'select') ctl = h('select', { onchange: function () { set(ctl.value); } }, (o.options || []).map(function (op) { return h('option', { value: op[0] }, op[1]); }));
    else {
      // `min` is passed through AND enforced on the value. The attribute alone only stops the spinner
      // arrows; a number typed straight in still reaches the config, and a negative duration means a
      // rental that is paid for and then expires on the very next sweep.
      ctl = h('input', {
        type: o.type || 'text', placeholder: o.ph || '', min: o.min,
        oninput: function () {
          if (o.type !== 'number') return set(ctl.value);
          var n = Number(ctl.value);
          if (o.min != null && ctl.value !== '' && n < Number(o.min)) { n = Number(o.min); ctl.value = String(n); }
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
  var TW_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var twClock = null;                      // { supported, now, zone } — asked once per tab
  function twClockLine() {
    if (!twClock) return '';
    if (twClock.supported === false) return twClock.why || 'This manager cannot evaluate time windows.';
    var z = twClock.zone || {}, n = twClock.now || {};
    return 'Server clock: ' + (n.hhmm || '??:??') + ' ' + (z.label || 'server time') + '. This is real time, not in-game time.';
  }
  function twLoadClock(then) {
    if (twClock) { then(); return; }
    api('/clock').then(function (c) { twClock = c || { supported: false }; then(); }).catch(function () { twClock = { supported: false }; then(); });
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
    var note = h('p', { class: 'tw-note' }, 'Always available — no time window is set.');
    var clockNote = h('p', { class: 'tw-clock' }, '');
    var add = h('button', {
      type: 'button', class: 'tw-add',
      onclick: function () {
        owner.windows = (owner.windows || []).concat([{ days: [], from: '20:00', to: '22:00' }]);
        onChange(); draw();
      },
    }, '+ Add a time window');

    var seq = 0;
    function preview() {
      var list = owner.windows || [];
      if (!list.length) { note.className = 'tw-note'; note.textContent = 'Always available — no time window is set.'; return; }
      // Every keystroke asks, and only the LAST answer is allowed to paint. Without the token an
      // earlier reply can land after a later one and leave the note describing a window the owner
      // has already changed — which is worse than a stale number, because it reads as authoritative.
      var mine = ++seq;
      api('/clock/preview', { method: 'POST', body: { windows: list } }).then(function (r) {
        if (mine !== seq) return;
        if (!r || r.supported === false) {
          note.className = 'tw-note bad';
          note.textContent = '⚠ This manager cannot evaluate time windows, so anything set here is treated as CLOSED. Update the manager, or remove the windows.';
          return;
        }
        if (r.errors && r.errors.length) { note.className = 'tw-note bad'; note.textContent = '⚠ ' + r.errors.join(' · '); return; }
        note.className = 'tw-note' + (r.open ? ' ok' : '');
        note.textContent = r.text + '  ' + (r.open ? '● Open right now.' : '○ Shut right now.');
      }).catch(function () { /* the note simply keeps its last good text */ });
    }

    function dayChips(w) {
      // An empty list means EVERY DAY, so all seven read as on. Clicking one then has to turn that
      // day off rather than leave six unexplained — which means materialising the full week first.
      var chosen = (w.days && w.days.length) ? w.days.slice() : [1, 2, 3, 4, 5, 6, 7];
      return TW_DAYS.map(function (name, i) {
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
          h('div', { class: 'tw-times' }, [h('span', {}, 'from'), from, h('span', {}, 'to'), to]),
          h('button', {
            type: 'button', class: 'tw-del', title: 'Remove this window',
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
    var input = h('input', { type: 'text', placeholder: 'Search vehicles… or type a code', autocomplete: 'off' });
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
            var id = it.code || it.id || it.name || '';
            var code = /^BPC_/.test(id) ? id : 'BPC_' + id;
            var nm = it.name || id;
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
          menu.style.display = 'block';
        }).catch(hide);
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
          try { SSA.toast('“' + t + '” is a search, not a spawn code — pick a vehicle from the list.', 'error'); } catch (e) { /* toast optional */ }
        }
      }, 160);
    });
    return h('label', { class: 'vr-f' }, [h('span', {}, 'Spawn code'), h('div', { class: 'vr-ac' }, [input, menu])]);
  }

  function editor(el) {
    var config = null;
    // The heading used to open "Players rent vehicles through the Discord bot", which is not true and
    // never was: the whole rental engine runs from in-game chat and Discord is one of two front ends.
    // An owner with no bot read that sentence, then found a channel picker with nothing in it, and
    // concluded the plugin was broken or not for them.
    el.innerHTML = '<div class="vr-head"><p class="muted" style="font-size:.86rem;margin:0">Players rent vehicles from in-game chat — <code>/rent</code>, <code>/myrent</code>, <code>/extend</code>, <code>/return</code> — and, if you run a Discord bot, from a menu there as well. Everything below works either way.</p></div><div id="vr-body" class="muted">Loading…</div>';
    var body = el.querySelector('#vr-body');

    var savedSnapshot = '';
    api('/config').then(function (c) {
      if (c && c._httpError) { body.textContent = 'Could not load the configuration: ' + c.error + '. Reload the page, and if it persists sign in again.'; return; }
      config = c || {};
      if (!Array.isArray(config.vehicles)) config.vehicles = [];
      savedSnapshot = JSON.stringify(config);
      render();
    });

    function render() {
      body.className = '';
      body.innerHTML = '';

      // ── general settings ──
      var chanSel = h('select', {}, [h('option', { value: config.channelId || '' }, config.channelId ? '(current)' : '— pick a channel —')]);
      // An empty channel list has two causes that look the same and mean opposite things. `/channels`
      // answers `[]` both when there is no bot and when there is one with nothing to post in, and the
      // dropdown said nothing at all about either — so this asks which it is first.
      var chanNote = h('p', { class: 'muted', style: 'font-size:.78rem;margin:4px 0 0' }, '');
      api('/discord-state').then(function (d) {
        var hasBot = !!(d && d.enabled);
        if (!hasBot) {
          chanSel.innerHTML = '';
          chanSel.appendChild(h('option', { value: '' }, 'No Discord bot configured'));
          chanSel.disabled = true;
          chanNote.textContent = 'No Discord bot is set up, so the menu, the DM reminders and the Extend button are unavailable. Everything else — renting, prices, limits, reminders in game and auto-removal — works from chat and needs nothing here.';
          return;
        }
        api('/channels').then(function (list) {
          chanSel.innerHTML = ''; chanSel.appendChild(h('option', { value: '' }, '— pick a channel —'));
          (list || []).forEach(function (ch) { chanSel.appendChild(h('option', { value: ch.id, selected: ch.id === config.channelId }, '#' + ch.name)); });
          chanSel.value = config.channelId || '';
          if (!(list || []).length) chanNote.textContent = 'The bot is connected but cannot see any text channels — check its permissions in your server.';
        });
      });
      chanSel.addEventListener('change', function () { config.channelId = chanSel.value; });

      // Live state of sector detection. Silent when no sector rules are set — there is nothing to
      // warn about then, and a permanent status line for an unused feature is just noise.
      var sectorStatus = h('p', { class: 'vr-secstat', style: 'display:none' });
      function refreshSectorStatus() {
        api('/sector-status').then(function (s) {
          if (!s || !s.configured) { sectorStatus.style.display = 'none'; return; }
          sectorStatus.style.display = '';
          if (s.works === true) {
            sectorStatus.className = 'vr-secstat ok';
            sectorStatus.textContent = '✓ Sector detection is working — the rules above are being applied.';
          } else if (s.works === false) {
            sectorStatus.className = 'vr-secstat bad';
            sectorStatus.textContent = '⚠ Sector detection is NOT working right now, so the rules above are being ignored and renting is allowed everywhere. Map calibration comes from scumsa — check the manager can reach it.';
          } else {
            sectorStatus.className = 'vr-secstat';
            sectorStatus.textContent = 'Sector detection has not been tested yet — it is checked the first time someone rents, or when a player is online.';
          }
        }).catch(function () { sectorStatus.style.display = 'none'; });
      }

      body.appendChild(card('Settings', [
        h('div', { class: 'vr-checks' }, [
          chk('Rentals enabled', function () { return config.enabled; }, function (v) { config.enabled = v; }),
          h('label', { class: 'vr-chk' }, [(function () { var b = h('input', { type: 'checkbox', onchange: function () { config.free = b.checked; render(); } }); b.checked = config.free === true; return b; })(), 'Free rentals (no charge)']),
          // Says what it now covers. It applies to renting AND extending; returning is always
          // allowed, so a player is never stuck paying for a vehicle they are trying to give back.
          chk('Must be online to rent or extend', function () { return config.requireOnline; }, function (v) { config.requireOnline = v; }),
          chk('Allow extensions', function () { return config.allowExtend; }, function (v) { config.allowExtend = v; }),
        ]),
        h('div', { class: 'vr-grid' }, [
          h('label', { class: 'vr-f' }, [h('span', {}, 'Rental menu channel (Discord — optional)'), chanSel, chanNote]),
          inp('Button label', function () { return config.buttonLabel; }, function (v) { config.buttonLabel = v; }, { ph: '🚗 Rent a vehicle' }),
          inp('Max active rentals / player (0 = ∞)', function () { return config.maxPerPlayer; }, function (v) { config.maxPerPlayer = v; }, { type: 'number' }),
          inp('Cooldown between rentals (min)', function () { return config.cooldownMinutes; }, function (v) { config.cooldownMinutes = v; }, { type: 'number' }),
          inp('Daily limit / player (0 = ∞)', function () { return config.dailyLimit; }, function (v) { config.dailyLimit = v; }, { type: 'number' }),
          inp('Max extensions / rental (0 = ∞)', function () { return config.maxExtensions; }, function (v) { config.maxExtensions = v; }, { type: 'number' }),
          inp('Remind before expiry (min)', function () { return config.reminderMinutes; }, function (v) { config.reminderMinutes = v; }, { type: 'number' }),
        ]),
        h('div', { class: 'vr-stack' }, [
          inp('Spawn command template', function () { return config.spawnCmd; }, function (v) { config.spawnCmd = v; }, { ph: '#SpawnVehicle {code} 1 Location "X={x} Y={y} Z={z}"' }),
          inp('Remove command template', function () { return config.removeCmd; }, function (v) { config.removeCmd = v; }, { ph: '#DestroyVehicle {vehId}' }),
        ]),
        h('p', { class: 'muted', style: 'font-size:.78rem;margin-top:6px' }, 'Command placeholders: {code} {x} {y} {z} {steamid} {vehId}. Set these to match your server / bridge. Payment is charged automatically with #ChangeCurrencyBalance.'),
        // Rental hours for the whole system. Vehicles and plans can narrow this further; nothing
        // widens it, so a player is never offered something the server-wide hours have shut.
        h('div', { class: 'vr-opt-hd' }, 'Rental hours (leave empty and rentals are always open)'),
        twEditor(config, function () { }),
      ]));

      // ── in-game ──
      // Everything a player can do or see without opening Discord. Kept in its own card because it
      // is the half an owner tunes for their playerbase, separately from prices and limits.
      body.appendChild(card('In-game', [
        h('div', { class: 'vr-checks' }, [
          chk('Send messages in-game', function () { return config.inGameNotify !== false; }, function (v) { config.inGameNotify = v; }),
          chk('Enable in-game commands', function () { return config.inGameCommands !== false; }, function (v) { config.inGameCommands = v; }),
          chk('Allow returning early', function () { return config.allowReturn !== false; }, function (v) { config.allowReturn = v; }),
          chk('Check the vehicle still exists', function () { return config.verifyVehicle !== false; }, function (v) { config.verifyVehicle = v; }),
        ]),
        h('div', { class: 'vr-grid' }, [
          (function () {
            var sel = h('select', {});
            ['local', 'global', 'squad', 'admin', 'server'].forEach(function (ch) {
              sel.appendChild(h('option', { value: ch, selected: (config.inGameChannel || 'local') === ch }, ch));
            });
            sel.addEventListener('change', function () { config.inGameChannel = sel.value; });
            return h('label', { class: 'vr-f' }, [h('span', {}, 'Chat channel'), sel]);
          })(),
          inp('Refund on early return (%)', function () { return config.refundPercent; }, function (v) { config.refundPercent = v; }, { type: 'number' }),
          inp('Rent command', function () { return config.cmdRent; }, function (v) { config.cmdRent = v; }, { ph: 'rent' }),
          inp('My rentals command', function () { return config.cmdMine; }, function (v) { config.cmdMine = v; }, { ph: 'myrent' }),
          inp('Extend command', function () { return config.cmdExtend; }, function (v) { config.cmdExtend = v; }, { ph: 'extend' }),
          inp('Return command', function () { return config.cmdReturn; }, function (v) { config.cmdReturn = v; }, { ph: 'return' }),
        ]),
        h('div', { class: 'vr-grid' }, [
          inp('Allowed sectors (blank = anywhere)', function () { return (config.allowedSectors || []).join(', '); },
            function (v) { config.allowedSectors = String(v).split(',').map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean); }, { ph: 'B2, C3' }),
          inp('Blocked sectors', function () { return (config.blockedSectors || []).join(', '); },
            function (v) { config.blockedSectors = String(v).split(',').map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean); }, { ph: 'A0, Z4' }),
        ]),
        h('p', { class: 'muted', style: 'font-size:.78rem;margin-top:6px' }, 'Sector rules need the live map calibration; while it is unavailable renting is allowed everywhere rather than blocked for a reason players cannot see. Command names are written without the prefix, and renaming one — or turning the commands off — takes effect the moment you save. Prices are taken from the player’s bank account, not the money they are carrying.'),
        // …and whether it is available RIGHT NOW. The sentence above explains the rule; on its own it
        // leaves an owner to guess which side of it they are on, and these are the only settings here
        // that can be filled in correctly and still do nothing.
        sectorStatus,
      ]));
      refreshSectorStatus();

      // ── in-game wording ──
      body.appendChild(card('In-game messages', [
        h('div', { class: 'vr-stack' }, (function () {
          var LINES = [
            ['confirmed', 'Rental confirmed'], ['endingSoon', 'Ending soon'], ['ended', 'Rental ended'],
            ['returned', 'Returned early'], ['rentUsage', 'Rent — usage / list'], ['noRentals', 'No active rentals'],
            ['mineLine', 'One line of "my rentals"'], ['extendOk', 'Extended'], ['notAllowedHere', 'Sector not allowed'],
            ['disabled', 'Rentals disabled'],
          ];
          if (!config.texts) config.texts = {};
          return LINES.map(function (pair) {
            return inp(pair[1], function () { return config.texts[pair[0]] || ''; }, function (v) { config.texts[pair[0]] = v; });
          });
        })()),
        h('p', { class: 'muted', style: 'font-size:.78rem;margin-top:6px' }, 'Tokens: {player} {vehicle} {duration} {price} {left} {sector} {cmd} {list}. Leave a line empty to use the built-in wording.'),
      ]));

      // ── vehicles ──
      var vehBox = h('div', {});
      var vehFind = h('input', { class: 'vr-search', type: 'search', placeholder: 'Search vehicles…' });
      vehFind.addEventListener('input', function () { renderVeh(); });
      // Discord's own limits, stated where they bite. A 26th vehicle or a 26th plan is simply not
      // offered in the Discord menu — it stays rentable from chat, which is exactly the kind of
      // "works for me, not for them" an owner has no way to discover on their own.
      var vehWarn = h('div', { class: 'vr-warn' });
      function renderWarn() {
        var msgs = [];
        if (config.vehicles.length > 25) msgs.push('Discord shows at most 25 options in a menu — the last ' + (config.vehicles.length - 25) + ' vehicle(s) will not appear in the Discord list. They stay rentable with the in-game command.');
        var over = config.vehicles.filter(function (v) { return (v.options || []).length > 25; }).map(function (v) { return v.name || 'unnamed'; });
        if (over.length) msgs.push('More than 25 plans on: ' + over.join(', ') + ' — only the first 25 show in Discord.');
        var noCode = config.vehicles.filter(function (v) { return !v.code; }).map(function (v) { return v.name || 'unnamed'; });
        if (noCode.length) msgs.push('No spawn code on: ' + noCode.join(', ') + ' — renting those fails with a message asking the player to tell an admin.');
        // A code that is present but is not a blueprint id fails exactly the same way, and used to
        // be invisible here because the check only asked whether the field was empty.
        var badCode = config.vehicles.filter(function (v) { return v.code && !/^BPC_[A-Za-z0-9_]+$/.test(String(v.code).trim()); })
          .map(function (v) { return (v.name || 'unnamed') + ' (“' + v.code + '”)'; });
        if (badCode.length) msgs.push('Spawn code doesn’t look like a vehicle blueprint on: ' + badCode.join(', ') + ' — codes start with BPC_. Renting those will fail to spawn.');
        // Two different problems, said differently, because they need different action.
        // A NEGATIVE duration is refused outright by the backend — it would expire the instant it
        // was paid for. A blank or zero one quietly becomes an hour, which is almost certainly not
        // what the owner meant to sell but has been working that way all along.
        var negDur = config.vehicles.filter(function (v) {
          return (v.options || []).some(function (o) { return parseInt(o && o.minutes, 10) < 0; });
        }).map(function (v) { return v.name || 'unnamed'; });
        if (negDur.length) msgs.push('A rental plan with a negative duration on: ' + negDur.join(', ') + ' — that plan is refused when someone tries to rent it, because it would expire the moment it was paid for.');
        var vagueDur = config.vehicles.filter(function (v) {
          return (v.options || []).some(function (o) { var n = parseInt(o && o.minutes, 10); return !(n > 0) && !(n < 0); });
        }).map(function (v) { return v.name || 'unnamed'; });
        if (vagueDur.length) msgs.push('A rental plan with no duration set on: ' + vagueDur.join(', ') + ' — those are sold as 60 minutes. Set the minutes you actually mean.');
        var noPlan = config.vehicles.filter(function (v) { return !(v.options || []).length; }).map(function (v) { return v.name || 'unnamed'; });
        if (noPlan.length) msgs.push('No rental plans on: ' + noPlan.join(', ') + ' — nothing to pick, so they cannot be rented.');
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
              var row = [inp('Minutes', function () { return o.minutes; }, function (x) { o.minutes = x; }, { type: 'number', min: '1' })];
              if (!config.free) {
                row.push(inp('Currency', function () { return o.currency || 'money'; }, function (x) { o.currency = x; }, { type: 'select', options: [['money', 'Money'], ['gold', 'Gold']] }));
                row.push(inp('Amount', function () { return o.amount; }, function (x) { o.amount = x; }, { type: 'number', min: '0' }));
              }
              row.push(h('button', { class: 'vr-x', title: 'Remove plan', onclick: function () { v.options.splice(oi, 1); renderOpts(); } }, '✕'));
              // A window on the PLAN is how a price that changes by time of day is expressed: two
              // plans on the same vehicle, one windowed to the evening and one not. There is
              // deliberately no separate "discount" field — a second plan already says it, and a
              // discount that could disagree with the plan it discounts is a price nobody can see.
              optBox.appendChild(h('div', { class: 'vr-opt-wrap' }, [
                h('div', { class: config.free ? 'vr-opt vr-opt-free' : 'vr-opt' }, row),
                twEditor(o, function () { }),
              ]));
            });
            if (!v.options.length) optBox.appendChild(h('div', { class: 'muted', style: 'font-size:.8rem' }, 'No plans yet.'));
          }
          renderOpts();
          vehBox.appendChild(h('div', { class: 'vr-veh' }, [
            h('button', { class: 'vr-x vr-x-top', title: 'Remove vehicle', onclick: function () { config.vehicles.splice(vi, 1); renderVeh(); } }, '✕'),
            h('div', { class: 'vr-grid' }, [
              inp('Vehicle name', function () { return v.name; }, function (x) { v.name = x; }, { ph: 'Quad Bike' }),
              vehField(v, renderVeh),
              inp('Image URL (optional)', function () { return v.image; }, function (x) { v.image = x; }),
            ]),
            h('div', { class: 'vr-opt-hd' }, 'Per-vehicle limits (leave blank = use the global setting)'),
            h('div', { class: 'vr-grid' }, [
              inp('Max active / player', function () { return v.maxPerPlayer; }, function (x) { v.maxPerPlayer = x; }, { ph: 'global' }),
              inp('Cooldown (min)', function () { return v.cooldownMinutes; }, function (x) { v.cooldownMinutes = x; }, { ph: 'global' }),
              inp('Daily limit', function () { return v.dailyLimit; }, function (x) { v.dailyLimit = x; }, { ph: 'global' }),
              inp('Max extensions / rental (0 = ∞)', function () { return v.maxExtensions; }, function (x) { v.maxExtensions = x; }, { ph: 'global' }),
              inp('Remind before expiry (min)', function () { return v.reminderMinutes; }, function (x) { v.reminderMinutes = x; }, { ph: 'global' }),
            ]),
            h('div', { class: 'vr-opt-hd' }, 'When this vehicle can be rented (empty = whenever rentals are open)'),
            twEditor(v, function () { }),
            h('div', { class: 'vr-opt-hd' }, 'Rental plans (duration' + (config.free ? '' : ' + price') + ')'),
            optBox,
            h('button', { class: 'vr-btn add', onclick: function () { v.options.push({ minutes: 60, currency: 'money', amount: 5000 }); renderOpts(); } }, '+ Add plan'),
          ]));
        });
        if (!config.vehicles.length) vehBox.appendChild(h('div', { class: 'muted', style: 'font-size:.85rem;padding:8px' }, 'No vehicles yet — add one.'));
        else if (!shown) vehBox.appendChild(h('div', { class: 'muted', style: 'font-size:.85rem;padding:8px' }, 'No vehicle matches “' + vehFind.value + '”.'));
      }
      renderVeh();
      body.appendChild(card('Vehicles', [
        h('div', { class: 'vr-vbar' }, [
          h('button', { class: 'vr-btn add', onclick: function () { config.vehicles.push({ name: '', code: '', image: '', options: [{ minutes: 60, currency: 'money', amount: 5000 }] }); vehFind.value = ''; renderVeh(); } }, '+ Add vehicle'),
          vehFind,
        ]),
        vehWarn,
        vehBox,
      ]));

      // ── menu embed (via embed-editor) ──
      var embDiv = h('div', {});
      var ed = SSA.consume('embed-editor');
      if (ed) ed.mount(embDiv, { value: config.menuEmbed || {}, onChange: function (json) { config.menuEmbed = json; } });
      else embDiv.appendChild(h('div', { class: 'muted', style: 'font-size:.85rem' }, 'Enable the "Discord Embed Editor" plugin to design the menu embed here.'));
      body.appendChild(card('Rental menu embed', [embDiv]));

      // ── save + post + rentals ──
      // Nothing on this page takes effect until it is saved, and it is a long page — so it says
      // plainly when there is something unsaved, and warns before the tab is closed on top of it.
      var status = h('span', { class: 'muted', style: 'font-size:.85rem' });
      // The baseline belongs to the last SAVE (or load), not to the last redraw. render() runs again
      // whenever "Free rentals" is toggled, and re-taking it there quietly declared an hour of
      // unsaved edits already saved — the indicator went out and the close warning stopped.
      function dirty() { return JSON.stringify(config) !== savedSnapshot; }
      function markSaved() { savedSnapshot = JSON.stringify(config); status.textContent = 'Saved ✓'; }
      // One timer for the tab, not one per redraw.
      if (window.vrDirtyTick) clearInterval(window.vrDirtyTick);
      window.vrDirtyTick = setInterval(function () {
        if (!body.parentNode) { clearInterval(window.vrDirtyTick); window.vrDirtyTick = null; return; }
        if (dirty() && !/Saving|Posting/.test(status.textContent)) status.textContent = '● Unsaved changes';
      }, 1200);
      if (window.vrBeforeUnload) window.removeEventListener('beforeunload', window.vrBeforeUnload);
      window.vrBeforeUnload = function (e) { if (dirty()) { e.preventDefault(); e.returnValue = ''; } };
      window.addEventListener('beforeunload', window.vrBeforeUnload);

      body.appendChild(h('div', { class: 'vr-actions' }, [
        h('button', { class: 'vr-btn primary', onclick: function () {
          status.textContent = 'Saving…';
          api('/config', { method: 'POST', body: config }).then(function (r) {
            if (r && r._httpError) { status.textContent = '⚠ Not saved — ' + r.error; return; }
            markSaved();
          });
        } }, 'Save configuration'),
        h('button', { class: 'vr-btn', onclick: function () {
          status.textContent = 'Posting…';
          api('/config', { method: 'POST', body: config }).then(function (r) {
            if (r && r._httpError) { status.textContent = '⚠ Not saved — ' + r.error; return null; }
            markSaved();
            return api('/post-menu', { method: 'POST' });
          }).then(function (r) {
            if (!r) return;
            // Say WHICH thing went wrong. One message for three different causes left an owner
            // guessing between "no channel", "bot offline" and "bot cannot post there".
            if (r._httpError) { status.textContent = '⚠ ' + r.error; return; }
            if (r.ok) { status.textContent = 'Menu posted ✓'; return; }
            status.textContent = !config.channelId ? '⚠ Pick a channel first'
              : '⚠ Could not post — check the bot is online and can post in that channel';
          });
        } }, 'Save & post menu'),
        status,
      ]));

      // ── active rentals ──
      // The panel's own table, so it searches, sorts and pages like every other list in the manager
      // — and so an admin can actually DO something. A rental whose vehicle id was never captured,
      // or one that needs revoking, used to sit here read-only until it expired.
      var active = [];
      var activeTbl = SSA.table({
        columns: [
          { key: 'player', label: 'Player', sort: true, sortVal: function (r) { return (r.playerName || r.steamId || '').toLowerCase(); }, render: function (r) { return document.createTextNode(r.playerName || r.steamId || '—'); } },
          { key: 'vehicle', label: 'Vehicle', sort: true, sortVal: function (r) { return (r.vehName || '').toLowerCase(); }, render: function (r) { return document.createTextNode(r.vehName || '—'); } },
          { key: 'left', label: 'Time left', sort: true, sortVal: function (r) { return r.expiresAt; }, render: function (r) { return h('span', { title: new Date(r.expiresAt).toLocaleString() }, left(r.expiresAt)); } },
          // Blank means auto-removal will be skipped for this one — worth seeing before it expires.
          { key: 'veh', label: 'Vehicle id', render: function (r) { return r.vehId ? h('code', {}, r.vehId) : h('span', { class: 'muted', title: 'The spawned vehicle could not be identified, so it will NOT be removed automatically.' }, 'not captured'); } },
          { key: 'ext', label: 'Extended', render: function (r) { return document.createTextNode(String(r.extensions || 0)); } },
          { key: 'act', label: '', render: function (r) {
            return h('button', { class: 'vr-btn danger', title: 'End it now and remove the vehicle', onclick: function () {
              // SSA.confirm resolves to true/false — it takes options as its second argument, not a
              // callback, so a callback there would simply never run.
              // Says NO REFUND, before the click rather than after. A player who returns a rental
              // early gets the configured refund; ending one from here pays nothing, and an admin
              // reaching for this button has no reason to assume the two differ.
              SSA.confirm('End the rental of ' + (r.vehName || 'this vehicle') + ' for ' + (r.playerName || r.steamId) + '?\n\n'
                + 'The vehicle is removed and the player is told in game that an admin ended it. '
                + 'No refund is paid — unlike a player returning it themselves.',
                { title: 'End rental', okLabel: 'End it' }).then(function (yes) {
                if (!yes) return;
                api('/rentals/end', { method: 'POST', body: { id: r.id } }).then(function (out) {
                  // "Ended (the vehicle was already gone)" was the message for BOTH "it really was
                  // gone" and "we could not identify it", and those need different action from an
                  // admin: one is fine, the other leaves a vehicle in the world.
                  if (out && out.ok) SSA.toast(out.removed ? 'Rental ended and the vehicle removed.'
                    : (out.stillThere ? 'Rental ended, but the vehicle could NOT be removed — it may still be out there.'
                      : 'Rental ended (the vehicle was already gone).'),
                  out.removed || !out.stillThere ? undefined : 'error');
                  else SSA.toast('Could not end it: ' + ((out && out.error) || 'unknown'), 'error');
                  loadRentals();
                });
              });
            } }, 'End');
          } },
        ],
        rows: function () { return active; },
        search: function (r) { return (r.playerName || '') + ' ' + (r.steamId || '') + ' ' + (r.vehName || ''); },
        searchPlaceholder: 'Search rentals…',
        empty: 'No active rentals.',
        onRefresh: function () { loadRentals(); },
      });

      var past = [];
      var REASONS = { expired: 'expired', returned: 'returned early', admin: 'ended by an admin' };
      var histTbl = SSA.table({
        columns: [
          { key: 'player', label: 'Player', sort: true, sortVal: function (r) { return (r.playerName || r.steamId || '').toLowerCase(); }, render: function (r) { return document.createTextNode(r.playerName || r.steamId || '—'); } },
          { key: 'vehicle', label: 'Vehicle', sort: true, sortVal: function (r) { return (r.vehName || '').toLowerCase(); }, render: function (r) { return document.createTextNode(r.vehName || '—'); } },
          { key: 'started', label: 'Started', sort: true, sortVal: function (r) { return r.startedAt; }, render: function (r) { return document.createTextNode(new Date(r.startedAt).toLocaleString()); } },
          { key: 'ended', label: 'How it ended', render: function (r) { return document.createTextNode(REASONS[r.endedReason] || 'expired'); } },
          { key: 'ext', label: 'Extended', render: function (r) { return document.createTextNode(String(r.extensions || 0)); } },
        ],
        rows: function () { return past; },
        search: function (r) { return (r.playerName || '') + ' ' + (r.steamId || '') + ' ' + (r.vehName || ''); },
        searchPlaceholder: 'Search past rentals…',
        empty: 'Nothing has finished yet.',
        onRefresh: function () { loadRentals(); },
      });

      function left(ts) {
        var ms = ts - Date.now();
        if (ms <= 0) return 'due now';
        var m = Math.round(ms / 60000);
        return m < 60 ? m + ' min' : (Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : ''));
      }
      function loadRentals() {
        api('/rentals').then(function (l) { active = Array.isArray(l) ? l : []; activeTbl.refresh(); });
        api('/history').then(function (l) { past = Array.isArray(l) ? l : []; histTbl.refresh(); });
      }
      loadRentals();
      // One timer per mount, cleared when the tab is rebuilt, so reopening the tab never stacks them.
      if (window.vrTick) clearInterval(window.vrTick);
      window.vrTick = setInterval(function () { activeTbl.refresh(); }, 30000);

      body.appendChild(card('Active rentals', [activeTbl.el]));
      body.appendChild(card('Finished rentals', [histTbl.el]));
    }

    function card(title, kids) { return h('div', { class: 'card vr-card' }, [h('h3', { class: 'vr-card-t' }, title)].concat(kids)); }
  }

  SSA.ready(function () {
    SSA.registerTab({ id: 'vehicle-rental', label: 'Rentals', icon: '🚗', premium: true, render: editor });
  });
}());
