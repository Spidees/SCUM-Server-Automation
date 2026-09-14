/* Raid Window — admin tab.
 *
 * Top to bottom: a short line saying what the plugin does and whether it is working, a Bridge box
 * that lists what the configuration needs switched on and turns it on with one confirmed click, the
 * few settings an owner actually chooses (everything else folded under "More options", every
 * explanation behind a "?"), the bases under raid right now, and the pushes it has made.
 *
 * Every setting is editable with the server stopped. The live half only adds to the page, and it
 * is redrawn on its own, so a poll never throws away something half typed. Talks only to its own
 * backend, plus the manager's own route for turning bridge switches on. */
(function () {
  'use strict';

  var PLUGIN = 'raid-window';
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
    if (n < 60) return n + ' s';
    if (n < 3600) return Math.round(n / 60) + ' min';
    var hh = Math.floor(n / 3600), mm = Math.round((n % 3600) / 60);
    if (hh < 48) return hh + ' h' + (mm ? ' ' + mm + ' min' : '');
    return Math.round(n / 3600) + ' h';
  }
  function ago(ms) { return ms ? dur((Date.now() - ms) / 1000) + ' ago' : ''; }
  var SOURCE = { configured: 'your fixed length', saved: 'from the save', decoded: 'from the running game' };

  // What each push outcome means, in words. "No change" is the one that matters: the game took the
  // push and the base did not move, which is not a success and must never read as one.
  var VERDICT = {
    moved: ['good', 'Pushed', 'Protection now starts later.'],
    unchanged: ['wait', 'No change', 'The game took the push but nothing changed. This is normal while someone from that base is still online.'],
    unconfirmed: ['wait', 'Sent', 'The game took the push, but the result could not be read back.'],
    refused: ['bad', 'Refused', null],
    no_duration: ['bad', 'Skipped', null],
    closed: ['flat', 'Ended', null],
    capped: ['wait', 'Limit reached', null],
  };
  function verdictOf(state) { return VERDICT[state] || ['flat', 'Waiting', null]; }

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
      'When defenders log out during a raid, their base\'s offline protection would switch on and end it. '
      + 'While a base is taking raid damage, this plugin keeps pushing that base\'s protection back until the attack stops.'));
    var figs = h('div', { class: 'rw-figs' });
    var notes = h('div', { class: 'rw-notes' });
    var bridgeBox = h('div');
    var settingsBox = h('div');
    var liveBox = h('div');
    var histBox = h('div');
    [figs, notes, bridgeBox, settingsBox, liveBox, histBox].forEach(function (x) { root.appendChild(x); });
    settingsBox.appendChild(h('p', { class: 'rw-empty' }, 'Loading…'));

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
          h('strong', {}, 'This tab could not load its settings. '), why(err),
          h('div', { class: 'rw-actions' }, [h('button', { type: 'button', class: 'secondary', onclick: load }, 'Try again')]),
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
      var i = h('input', { type: 'text', class: 'rw-in', placeholder: 'none' });
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
      var text = hint ? h('p', { class: 'rw-hint', hidden: true }, hint) : null;
      var q = null;
      if (hint) {
        q = h('button', { type: 'button', class: 'rw-q', title: 'What does this do?', 'aria-expanded': 'false' }, '?');
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
      figs.appendChild(h('div', { class: 'rw-fig' + (on ? ' good' : '') }, [h('b', {}, on ? 'On' : 'Off'), h('span', {}, 'plugin')]));
      figs.appendChild(h('div', { class: 'rw-fig' + (open ? ' wait' : '') }, [h('b', {}, String(open)), h('span', {}, 'under raid now')]));
      figs.appendChild(h('div', { class: 'rw-fig' }, [h('b', {}, String(pushed)), h('span', {}, 'recent pushes')]));
    }

    function renderNotes() {
      notes.innerHTML = '';
      if (!status) return;
      if (status.enabled === false) {
        notes.appendChild(note('flat', 'The plugin is switched off, so nothing is pushed. Switch it on under Settings.'));
        return;
      }
      if (status.serverRunning === false) {
        notes.appendChild(note('flat', 'The server is not running, so no raid can show up here yet. Everything on this tab can be set now.'));
        return;
      }
      if (status.idle && status.idle.text) {
        notes.appendChild(note('flat', [h('strong', {}, 'Not looking right now: '), status.idle.text + '.']));
        return;
      }
      var n = status.notes || {};
      [['raid', 'Raid damage'], ['protect', 'Protection'], ['db', 'Game database']].forEach(function (k) {
        if (!n[k[0]] || !n[k[0]].text) return;
        notes.appendChild(note('wait', [h('strong', {}, k[1] + ': '), sentence(n[k[0]].text),
          ' A raid that is already being pushed is not ended because of this.']));
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
        return '• ' + x.moduleName + ': ' + x.label + (x.noUndo ? ' (a changed protection window cannot be undone)' : '');
      });
      return Promise.resolve(SSA.confirm('Turn these on in the SSA Bridge?\n\n' + lines.join('\n')
        + '\n\nYou can switch each one off again on its card in Settings → Bridge.', { okLabel: 'Turn on' }))
        .then(function (yes) {
          if (!yes) return null;
          return fetch('/api/plugins/' + PLUGIN + '/bridge-needs/apply', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: true, only: items.map(function (x) { return x.module + '.' + x.key; }) }),
          }).then(function (r) { return r.json().catch(function () { return { ok: false, error: 'http_' + r.status }; }); })
            .catch(function () { return { ok: false, error: 'the manager could not be reached' }; });
        })
        .then(function (r) {
          if (r === null) return;
          if (!r || r.ok === false) {
            toast(r && r.error === 'bridge_ui_disabled'
              ? 'In-game control is switched off for this panel, so nothing was changed'
              : 'The bridge settings could not be changed' + (r && r.error ? ' (' + String(r.error).replace(/_/g, ' ') + ')' : ''), 'error');
            return;
          }
          var n = (r.applied || []).reduce(function (k, a) { return k + (a.keys || []).length; }, 0);
          toast(n ? 'Switched on ' + n + ' setting' + (n === 1 ? '' : 's') + ' in the bridge' : 'Nothing needed changing');
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
        kids.push(note('wait', 'This manager cannot read the bridge settings from here. In Settings → Bridge, turn on '
          + 'Raid detection, and Raid protection control with "Set a flag\'s protection window".'));
      } else if (!off.length && !gone.length && !byHand.length) {
        kids.push(note('good', 'Everything this plugin needs is switched on in the bridge.'));
      }
      off.filter(function (x) { return canOn.indexOf(x) >= 0; }).forEach(function (x) {
        kids.push(h('div', { class: 'rw-need' }, [icon('alert'),
          h('span', {}, [h('b', {}, x.forWhat + ': '), x.moduleName + ', "' + x.label + '" is off'])]));
      });
      byHand.forEach(function (x) {
        kids.push(h('div', { class: 'rw-need' }, [icon('alert'),
          h('span', {}, [h('b', {}, x.forWhat + ': '), 'turn on "' + x.label + '" on the ' + x.moduleName + ' card in Settings → Bridge'
            + (x.state === 'unknown' ? ' (the server is not running, so it cannot be checked from here)' : '')])]));
      });
      gone.forEach(function (x) {
        kids.push(h('div', { class: 'rw-need' }, [icon('close'),
          h('span', {}, [h('b', {}, x.forWhat + ': '), 'this bridge has no "' + x.label + '". Update the SSA Bridge'])]));
      });
      if (canOn.length) {
        kids.push(h('div', { class: 'rw-actions' }, [
          h('button', { type: 'button', onclick: function () { turnOnInBridge(canOn); } },
            [icon('check'), 'Turn ' + (canOn.length === 1 ? 'it' : 'them') + ' on in the bridge']),
        ]));
      }
      if (bridge.online === false && (off.length || byHand.length)) {
        kids.push(h('p', { class: 'rw-small' }, 'The server is not running, so this is what the bridge will start with.'));
      }
      bridgeBox.appendChild(card('check-shield', 'Bridge', kids));
    }

    // ── settings ────────────────────────────────────────────────────────────────────────────────
    var saveMsg = null, saveBtn = null, reapplyWarn = null, capHint = null;

    function saveState() {
      if (!saveMsg) return;
      saveMsg.textContent = dirty ? 'Unsaved changes' : 'All changes saved';
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
        capHint.textContent = total > 0 ? 'With these settings one raid is pushed for up to about ' + dur(total) + '.' : '';
      }
    }

    function save() {
      saveBtn.disabled = true;
      saveMsg.textContent = 'Saving…';
      api('/config', { method: 'POST', body: cfg }).then(function (r) {
        saveBtn.disabled = false;
        if (r && r.ok) {
          cfg = Object.assign({}, DEF, r.config || cfg);
          dirty = false;
          var ignored = (r.ignored && r.ignored.length) ? ' (not kept: ' + r.ignored.join(', ') + ')' : '';
          toast('Saved' + ignored);
          renderSettings();
          refreshBridge();
          api('/status').then(function (s) { status = s || status; renderLive(); }).catch(function () {});
        } else {
          var w = sentence((r && (r.reason || r.error)) || 'the manager did not say why');
          saveMsg.textContent = 'Not saved. ' + w;
          saveMsg.className = 'rw-dirty unsaved';
          toast('Not saved. ' + w, 'error');
        }
      }).catch(function (err) {
        saveBtn.disabled = false;
        saveMsg.textContent = 'Not saved. ' + why(err);
        saveMsg.className = 'rw-dirty unsaved';
        toast('Not saved. ' + why(err), 'error');
      });
    }

    function lengthControl() {
      var fixed = cfg.durationSeconds != null;
      var hours = num('durationSeconds', 3600, 'hours', 0.1, 168);
      hours.hidden = !fixed;
      var s = h('select', { class: 'rw-in' }, [
        h('option', { value: 'own' }, 'Keep each base\'s own length'),
        h('option', { value: 'fixed' }, 'Use a fixed length'),
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
      var inp = h('input', { type: 'number', class: 'rw-in rw-num', placeholder: 'flag id', min: 1 });
      var out = h('span', { class: 'rw-small' });
      var btn = h('button', { type: 'button', class: 'secondary' }, 'Check');
      btn.addEventListener('click', function () {
        var v = Number(inp.value);
        if (!(isFinite(v) && v > 0)) { out.textContent = 'Type a flag id first.'; return; }
        out.textContent = 'Reading…';
        api('/flag', { method: 'POST', body: { id: v } }).then(function (r) {
          var saved = r.savedDurationSeconds;
          var parts = [saved == null ? 'The save has no length for it' : (saved === 0 ? 'The save holds no length right now' : 'Saved length ' + dur(saved))];
          if (r.live && r.live.durationSeconds != null) parts.push('the running game says ' + dur(r.live.durationSeconds));
          else parts.push('the running game did not answer');
          if (r.live && r.live.active != null) parts.push(r.live.active ? 'protection is on' : 'protection is not on');
          out.textContent = parts.join(', ') + '.';
        }).catch(function (err) { out.textContent = why(err); });
      });
      return h('span', { class: 'rw-inline' }, [inp, btn, out]);
    }

    function renderSettings() {
      settingsBox.innerHTML = '';
      reapplyWarn = h('p', { class: 'rw-small rw-warn', hidden: true },
        'This is as long as "Push protection back by" or longer, so protection can switch on between two pushes.');
      capHint = h('p', { class: 'rw-small' });

      var main = [
        row('Keep raids going when defenders log out', toggle('enabled'),
          'Off stops all pushing. A push already made is left as it is.'),
        row('Push protection back by', num('pushSeconds', 60, 'minutes', 1, 1440),
          'While a base is taking raid damage, its offline protection is set to start this long from now. The push is repeated, so protection cannot switch on in the middle of a raid.'),
        row('A raid is over after no damage for', num('holdSeconds', 60, 'minutes', 1, 1440),
          'Once the base has taken no damage for this long, the pushing stops. Protection then switches on when the last push said it would.'),
        row('Every hit restarts the countdown', toggle('countFromLastHit'),
          'On: protection starts "Push protection back by" after the LAST hit, and every new hit starts that wait again, as if the owner had only just logged off. Off: each push sets it that far from the moment of the push.'),
        row('Hits needed to count as a raid', num('minHits', 1, 'hits', 1, 1000),
          'How many hits on one base it takes before the plugin treats it as a raid. A destroyed building part always counts, however few hits there were.'),
      ];

      var extra = h('details', { class: 'rw-more' }, [h('summary', {}, 'More options'),
        row('Repeat the push every', num('reapplySeconds', 60, 'minutes', 0.5, 1440),
          'How often the push is repeated while the raid goes on. Keep it shorter than "Push protection back by".', reapplyWarn),
        row('Most pushes for one raid', num('maxPushesPerRaid', 1, 'pushes', 1, 1000),
          'A safety limit, so a raid that never goes quiet cannot keep pushing for ever. Once one raid has been pushed this many times, nothing more is pushed until it ends.', capHint),
        row('Protection length', lengthControl(),
          'Keeping each base\'s own length means players get exactly the protection they had once the raid is over. A fixed length is written on every base the plugin pushes.'),
        row('If the save has no length, ask the running game', toggle('allowDecodedDuration'),
          'Used only when the save holds no length for a base. The game\'s figure can be a minute or two off over a day. With this off, such a base is skipped.'),
        row('Base attack alerts keep a raid going', toggle('useOwnerAlerts'),
          'The manager\'s own base attack alerts can keep a raid going that real damage already started. They never start one on their own.'),
        row('Accept raids declared by other tools', toggle('acceptDeclared'),
          'Other tools can declare a raid without any damage being seen. Off means only real damage counts.'),
        row('Clear the protection cooldown before each push', toggle('resetCooldownFirst'),
          'Sends the game\'s cooldown skip before each push. It is the game\'s paid skip and may charge whoever is online. Leave it off unless pushes keep showing "No change". It needs its own bridge switch, which the Bridge box names when this is on.'),
        row('Look for raid damage every', num('pollSeconds', 1, 'seconds', 5, 300),
          'How often the plugin checks the bridge for new raid damage.'),
        row('Never touch these bases', ids('exemptBaseIds'),
          'Base ids, separated by commas. Each base under raid shows its id below.'),
        row('Never touch these flags', ids('exemptFlagIds'),
          'Flag ids, separated by commas. Each push below shows the flag it went to.'),
        row('Check a flag', lookup(),
          'Shows what the save and the running game say about one flag\'s protection right now.'),
      ]);

      saveBtn = h('button', { type: 'button', onclick: save }, [icon('check'), 'Save']);
      saveMsg = h('span', { class: 'rw-dirty' });
      settingsBox.appendChild(card('hourglass', 'Settings', main.concat([extra,
        h('div', { class: 'rw-save' }, [saveBtn, saveMsg])])));
      saveState();
      hints();
      renderFigs();
    }

    // ── live: the bases under raid, and what was pushed ─────────────────────────────────────────
    function closeBase(base) {
      api('/close', { method: 'POST', body: { base: base } }).then(function (r) {
        if (r && r.ok) { toast('Stopped pushing that base'); refresh(); }
        else toast(sentence((r && r.reason) || 'that could not be done'), 'error');
      }).catch(function (err) { toast(why(err), 'error'); });
    }
    function badge(kind, text) { return h('span', { class: 'rw-badge ' + kind }, text); }

    function flagRow(f) {
      var v = f.lastVerdict || {};
      var meta = verdictOf(v.state);
      var said = meta[2] || sentence(v.text || '');
      var detail = [];
      if (meta[2] && v.text) detail.push(h('p', {}, 'The bridge said: ' + sentence(v.text)));
      if (f.before) {
        var b = f.before;
        detail.push(h('p', {}, 'Before the first push the save held '
          + (b.savedDurationSeconds == null ? 'no readable length' : (b.savedDurationSeconds === 0 ? 'no length' : dur(b.savedDurationSeconds)))
          + (b.liveDurationSeconds != null ? ', and the running game said ' + dur(b.liveDurationSeconds) : '') + '.'));
      }
      return h('div', { class: 'rw-flag' }, [
        h('div', { class: 'rw-flag-head' }, [badge(meta[0], meta[1]),
          h('span', { class: 'rw-small' }, 'Flag ' + f.flag + (f.pushes ? ', pushed ' + f.pushes + (f.pushes === 1 ? ' time' : ' times') + ', last ' + ago(f.lastPushAt) : ''))]),
        said ? h('p', { class: 'rw-say' }, said) : null,
        detail.length ? h('details', { class: 'rw-detail' }, [h('summary', {}, 'Details')].concat(detail)) : null,
      ]);
    }

    function renderLive() {
      renderFigs();
      renderNotes();
      liveBox.innerHTML = '';
      histBox.innerHTML = '';
      if (!status) return;

      var open = status.open || [];
      var kids = [];
      if (!open.length) kids.push(note('flat', 'No base is under raid right now.'));
      open.forEach(function (r) {
        var bits = [];
        if (r.lastHitAt) bits.push('last hit ' + ago(r.lastHitAt));
        bits.push(r.hits + (r.hits === 1 ? ' hit' : ' hits'));
        if (r.destroyed) bits.push(r.destroyed + ' destroyed');
        if (r.endsInSeconds != null) bits.push('stops in ' + dur(r.endsInSeconds) + ' if it stays quiet');
        var block = [
          h('div', { class: 'rw-base-head' }, [
            h('strong', {}, r.name || ('Base ' + r.base)),
            r.name ? h('span', { class: 'rw-small' }, 'base id ' + r.base) : null,
            r.capped ? badge('wait', 'Limit reached') : badge('on', 'Pushing'),
            h('button', { type: 'button', class: 'secondary rw-stop', onclick: function () { closeBase(r.base); } }, 'Stop pushing'),
          ]),
          h('p', { class: 'rw-small' }, cap(bits.join(' · '))),
        ];
        if (r.capped) block.push(note('wait', 'This raid reached "Most pushes for one raid". Nothing more is pushed until it ends.'));
        if (Array.isArray(r.knownFlags) && !r.knownFlags.length) block.push(note('flat', 'This base has no flag, so there is no protection to push.'));
        (r.flags || []).forEach(function (f) { block.push(flagRow(f)); });
        kids.push(h('div', { class: 'rw-base' }, block));
      });
      liveBox.appendChild(card('shield', 'Under raid now', kids));

      var hist = status.history || [];
      var lines = hist.map(function (e) {
        var meta = verdictOf(e.state);
        var text = meta[2] || sentence(e.text || '');
        if (e.state === 'moved' && e.durationSeconds) {
          text = 'Protection pushed back by ' + dur(e.delaySeconds) + '. Length ' + dur(e.durationSeconds)
            + (SOURCE[e.durationSource] ? ' (' + SOURCE[e.durationSource] + ')' : '') + '.';
        }
        return h('div', { class: 'rw-h' }, [
          badge(meta[0], meta[1]),
          h('span', { class: 'rw-small' }, ago(e.at)),
          h('span', { class: 'rw-h-who' }, (e.baseName || ('Base ' + e.base)) + (e.flag ? ', flag ' + e.flag : '')),
          h('span', { class: 'rw-h-t' }, text),
        ]);
      });
      var hk = [];
      if (!lines.length) hk.push(note('flat', 'Nothing has been pushed yet.'));
      else {
        lines.slice(0, 10).forEach(function (l) { hk.push(l); });
        if (lines.length > 10) hk.push(h('details', { class: 'rw-more' }, [h('summary', {}, 'Show ' + (lines.length - 10) + ' more')].concat(lines.slice(10))));
        hk.push(h('div', { class: 'rw-actions' }, [h('button', {
          type: 'button', class: 'secondary', onclick: function () {
            api('/clear-history', { method: 'POST', body: {} }).then(function () { toast('List cleared'); refresh(); })
              .catch(function (err) { toast(why(err), 'error'); });
          },
        }, 'Clear the list')]));
      }
      histBox.appendChild(card('list', 'Recent activity', hk));
    }

    load();
  }

  SSA.ready(function () {
    SSA.registerTab({ id: PLUGIN, label: 'Raid Window', icon: '#i-hourglass', premium: true, render: editor });
  });
}());
