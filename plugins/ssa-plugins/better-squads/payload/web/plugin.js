/* Better Squads — admin UI.
 *
 * One workspace: a live status header, per-event toggles with editable templates and a
 * click-to-insert token palette, delivery rules, the in-game command set (root + subcommands +
 * every player-facing line), what players have silenced for themselves, and a feed of what was
 * actually sent. Icons, tables and cells come from the manager's native SDK so this looks like part
 * of the panel, not a bolt-on. Talks only to its own backend under /api/plugin-host/better-squads. */
(function () {
  'use strict';
  var CH_LABEL = { squad: 'Squad', local: 'Local', global: 'Global', admin: 'Admin' };

  // Tokens every message can use.
  var COMMON = ['{player}', '{squad}', '{squadonline}', '{squadsize}', '{sector}'];
  // Tokens measured FROM THE READER — using one makes the plugin render the line per recipient.
  var RELATIVE = ['{distance}', '{direction}'];

  // [key, title, when it fires, extra tokens beyond COMMON]
  var EVENTS = [
    ['join',       'Connected',    'A squadmate comes online',                    []],
    ['leave',      'Disconnected', 'A squadmate goes offline',                    []],
    ['death',      'Killed',       'A squadmate is killed by another player',     ['{killer}', '{weapon}', '{shotdistance}']],
    ['suicide',    'Died',         'A squadmate dies with no killer',             []],
    ['kill',       'Got a kill',   'A squadmate kills someone',                   ['{victim}', '{weapon}', '{shotdistance}']],
    ['raid',       'Base raided',  'An owner/raid alert fires for a squadmate',   ['{object}']],
    ['squadJoin',  'Joined squad', 'Someone is added to the squad',               []],
    ['squadLeave', 'Left squad',   'Someone leaves or is removed from the squad', []],
  ];

  var TOKEN_HELP = {
    '{player}': 'Who the message is about',
    '{killer}': 'Who killed them',
    '{victim}': 'Who they killed',
    '{weapon}': 'Weapon used',
    '{shotdistance}': 'How far the shot was, in metres',
    '{object}': 'What was attacked (vehicle, chest, lock…)',
    '{squad}': 'The squad’s name',
    '{squadonline}': 'Squad members online right now',
    '{squadsize}': 'Total squad members',
    '{sector}': 'Map sector where it happened, e.g. B3',
    '{distance}': 'Metres from the player reading it',
    '{direction}': 'Compass direction from the player reading it',
  };

  // [key, title, what it does] — the in-game subcommands.
  var SUBS = [
    ['help', 'Help',      'Lists the available subcommands'],
    ['off',  'Alerts off', 'Player silences every alert for themselves'],
    ['on',   'Alerts on',  'Turns their alerts back on'],
    ['mute', 'Mute',      'Silences individual events, e.g. “mute kill,join”'],
    ['here', 'Rally',     'Tells the squad which sector they are in'],
    ['msg',  'Message',   'Sends a line to every online squadmate'],
    ['base', 'Base',      'Direction and distance to the nearest squad base'],
    ['info', 'Info',      'Squad name, online count, score and MOTD'],
  ];

  // Player-facing lines, grouped so the list doesn't read as one long wall.
  var TEXT_GROUPS = [
    ['Roster (the bare command)', ['rosterHeader', 'rosterLine', 'rosterEmpty']],
    ['Rally & messages', ['here', 'hereOk', 'msgLine', 'msgOk', 'msgUsage', 'nobodyOnline']],
    ['Base & info', ['base', 'baseNone', 'info', 'infoMotd']],
    ['Self-service switches', ['mutedOn', 'mutedOff', 'muteUsage', 'muteSet']],
    ['Other', ['help', 'notInSquad']],
  ];
  var TEXT_LABEL = {
    rosterHeader: 'Roster header', rosterLine: 'One line per squadmate', rosterEmpty: 'Nobody else online',
    notInSquad: 'Not in a squad', help: 'Help line', mutedOn: 'Alerts turned off', mutedOff: 'Alerts turned on',
    muteUsage: 'Mute — how to use it', muteSet: 'Mute — confirmation', here: 'Rally, sent to the squad',
    hereOk: 'Rally — confirmation', msgUsage: 'Message — how to use it', msgLine: 'Message, sent to the squad',
    msgOk: 'Message — confirmation', base: 'Base found', baseNone: 'No base found',
    info: 'Squad info', infoMotd: 'Squad MOTD', nobodyOnline: 'Nobody else online',
  };

  // ── helpers ─────────────────────────────────────────────────────────────────
  // The manager's own client, not a hand-rolled one. The wrapper this replaces swallowed a failure
  // TWICE — the inner catch ate a body that was not JSON, the outer ate the network failure and every
  // non-2xx — so a backend that was down, a route that 404'd and a session that had expired all
  // arrived as `{}`. Every `(r && r.x) || []` after it then drew an empty screen that says "there is
  // nothing configured", which is a sentence about the DATA when the truth was about the REQUEST.
  //
  // `SSA.apiClient()` is captured here, at the top of the script, because `SSA.api` resolves the
  // calling plugin at call time and the panel only knows who is asking inside a render — every real
  // call in this file is a poll tick, a click or a `.then`, and would have gone to /api/plugin-host/_/.
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
  var icon = function (id, cls) { return SSA.icon(id, cls); };
  function toast(m, k) { if (window.SSA && SSA.toast) SSA.toast(m, k); }
  function card(title, sub, kids) {
    var head = [h('h3', { class: 'bs-card-t' }, title)];
    if (sub) head.push(h('p', { class: 'bs-card-sub' }, sub));
    return h('div', { class: 'card bs-card' }, head.concat(kids || []));
  }
  function field(label, ctl, hint) { return h('label', { class: 'bs-f' }, [h('span', {}, label), ctl, hint ? h('small', { class: 'bs-hint' }, hint) : null]); }
  function toggle(get, set, label) {
    var i = h('input', { type: 'checkbox', onchange: function () { set(i.checked); } });
    i.checked = !!get();
    return h('label', { class: 'bs-chk' }, [i, h('span', {}, label)]);
  }
  function ago(ms) {
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  // The last text field that had focus — token buttons insert at its caret.
  var lastFocused = null;
  function textField(get, set, opts) {
    opts = opts || {};
    var el = h(opts.multiline ? 'textarea' : 'input', {
      type: opts.multiline ? null : 'text',
      rows: opts.multiline ? 2 : null,
      placeholder: opts.placeholder || '',
      oninput: function () { set(el.value); },
      onfocus: function () { lastFocused = el; },
    });
    el.value = get() == null ? '' : get();
    return el;
  }
  function tokenBar(tokens) {
    return h('div', { class: 'bs-tokens' }, tokens.map(function (t) {
      var rel = RELATIVE.indexOf(t) >= 0;
      return h('button', {
        type: 'button', class: 'bs-token' + (rel ? ' bs-token-rel' : ''),
        title: (TOKEN_HELP[t] || '') + (rel ? ' — sent individually to each reader' : ''),
        onclick: function () {
          var el = lastFocused;
          if (!el) { toast('Click into a message field first'); return; }
          var s = el.selectionStart == null ? el.value.length : el.selectionStart;
          var e = el.selectionEnd == null ? s : el.selectionEnd;
          el.value = el.value.slice(0, s) + t + el.value.slice(e);
          el.dispatchEvent(new Event('input'));
          el.focus();
          el.selectionStart = el.selectionEnd = s + t.length;
        },
      }, t);
    }));
  }

  // ── the tab ─────────────────────────────────────────────────────────────────
  var bsPollTimer = null;

  function editor(root) {
    root.innerHTML = '';
    var cfg = null, statusData = { stats: {}, recent: [] }, players = [];
    var logTable = null, prefTable = null, statusBar = null;
    // A poll that fails is its own case, not a load failure: the screen is already drawn and the
    // settings on it are still the owner's. So it is a NOTE inside the status strip, not a page
    // replacement, and it never clears statusData/players — the tables keep showing the last answer
    // that arrived while this says the live half has stopped.
    var pollErr = null;

    var wrap = h('div', { class: 'bs-body' });
    root.appendChild(wrap);
    wrap.appendChild(h('div', { class: 'bs-loading' }, 'Loading…'));

    // Where a failure goes when the tab itself could not load. Without a slot, a throwing client only
    // moves the silence: the promise rejects, nothing renders, and the tab sits on "Loading…" for
    // ever — which reads as slow rather than as broken.
    function loadFailed(err) {
      wrap.innerHTML = '';
      var retry = h('button', { type: 'button', class: 'secondary', onclick: function () { wrap.innerHTML = ''; wrap.appendChild(h('div', { class: 'bs-loading' }, 'Loading…')); load(); } }, 'Try again');
      wrap.appendChild(h('div', { class: 'bs-err' }, [
        h('strong', {}, 'This tab could not load its settings. '),
        h('span', {}, why(err)),
        h('div', { class: 'bs-err-act' }, [retry]),
      ]));
    }

    function refreshStatus() {
      return Promise.all([api('/status'), api('/players')]).then(function (r) {
        pollErr = null;
        statusData = r[0] || statusData;
        players = r[1] || players;
        if (statusBar) renderStatusBar();
        if (logTable) logTable.refresh();
        if (prefTable) prefTable.refresh();
      }).catch(function (err) {
        // Keep the last figures on screen — clearing them would turn "I could not ask" into "there
        // is nothing there", which is the exact lie this whole change is about. Retrying is
        // automatic: the interval that calls refreshStatus keeps ticking.
        pollErr = why(err);
        if (statusBar) renderStatusBar();
      });
    }

    function renderStatusBar() {
      statusBar.innerHTML = '';
      var st = statusData.stats || {};
      // "Reached nobody" is its own number. Suppressed means the plugin CHOSE not to send (quiet
      // hours, cooldown, rate limit); this one means it tried and the squad got nothing — a
      // different problem needing a different fix, and it used to be counted as sent.
      [['Online', statusData.online], ['Squads with 2+ online', statusData.activeSquads],
       ['Messages sent', st.sent || 0], ['Reached nobody', st.failed || 0, (st.failed || 0) > 0],
       ['Suppressed', st.suppressed || 0], ['Commands run', st.commands || 0],
      ].forEach(function (b) {
        statusBar.appendChild(h('div', { class: 'bs-stat' + (b[2] ? ' bad' : '') }, [
          h('span', { class: 'bs-stat-v' }, String(b[1] == null ? '—' : b[1])),
          h('span', { class: 'bs-stat-l' }, b[0]),
        ]));
      });
      // A REQUEST that failed — a different thing from a world with nothing in it. What is on screen
      // is the last answer that arrived; the settings below are unaffected and still save normally.
      if (pollErr) {
        statusBar.appendChild(h('div', { class: 'bs-live-err' }, [
          h('b', {}, 'The live figures have stopped updating.'),
          ' ' + pollErr + ' The settings on this page are unaffected — you can keep editing and saving them.',
        ]));
      }
      // Six zeroes and no explanation is how "nothing has happened yet" gets read as "nothing works".
      // Every message, command name and reply on this page is editable right now; the counters are the
      // only part that has to wait, and the best time to write the texts is before anyone is on.
      if (statusData.serverRunning === false) {
        statusBar.appendChild(h('div', { class: 'bs-note-off' }, [
          h('b', {}, 'The server is not running.'),
          ' Every message, command name and reply below can be written now — it all takes effect the moment it starts. Only the counters and the two player lists wait for it.',
        ]));
      }
      if (statusData.geography === false) {
        statusBar.appendChild(h('div', { class: 'bs-warn' }, [
          icon('alert'), ' Map calibration unavailable — {sector} and {direction} render empty.',
        ]));
      }
      // A live read that could not run. The plugin then answers from the last save, which is what it
      // always did — but an owner who is not told cannot tell that apart from everything working, and
      // "my squad was told someone is 40 m away and he was two kilometres off" has no other
      // explanation on this screen. Drawn only when there is something to say.
      var live = statusData.live || {};
      [['players', 'Squadmate positions are coming from the last save, not the running game'],
        ['squads', 'Squad membership is coming from the last save, not the running game'],
      ].forEach(function (row) {
        var n = live[row[0]];
        if (!n || !n.text) return;
        statusBar.appendChild(h('div', { class: 'bs-warn' }, [icon('alert'), ' ' + row[1] + ': ' + n.text + '.']));
      });
    }

    // A save bar: a primary button plus a status span that carries the sentence for as long as it is
    // true. A toast is gone in four seconds and the owner's unedited fields would still be sitting in
    // front of them — this is what makes a refused save look different from a slow one. There are
    // four of these (messages / delivery / commands / replies), so it is a function rather than four
    // copies that would drift.
    function saveBar(btnLabel) {
      var msg = h('span', { class: 'bs-savemsg' });
      var btn = h('button', {
        class: 'primary',
        onclick: function () {
          msg.textContent = 'Saving…'; btn.disabled = true;
          api('/config', { method: 'POST', body: cfg }).then(function (r) {
            btn.disabled = false;
            if (r && r.ok) {
              msg.textContent = 'Saved ✓'; toast('Saved', 'ok');
              setTimeout(function () { msg.textContent = ''; }, 2500);
            } else {
              // A route that answered 200 without `ok` is a refusal too, and it may have said why.
              var w = (r && (r.reason || r.error)) || 'the manager did not say why';
              msg.textContent = 'NOT saved — ' + w; toast('NOT saved — ' + w, 'err');
            }
          }).catch(function (err) {
            btn.disabled = false;
            msg.textContent = 'NOT saved — ' + why(err);
            toast('NOT saved — ' + why(err), 'err');
          });
        },
      }, [icon('check'), btnLabel]);
      return h('div', { class: 'bs-actions' }, [btn, msg]);
    }

    function build() {
      wrap.innerHTML = '';

      // The master switch posts immediately rather than waiting for a Save button, so a refused
      // write must undo the checkbox too — otherwise the screen reads "on" while the server still has
      // it off, which is worse than the toast being the only place the failure shows.
      var masterInput = h('input', { type: 'checkbox', onchange: function () {
        var v = masterInput.checked, prev = cfg.enabled;
        cfg.enabled = v;
        api('/config', { method: 'POST', body: cfg }).then(function (r) {
          if (!(r && r.ok)) {
            cfg.enabled = prev; masterInput.checked = prev;
            var w = (r && (r.reason || r.error)) || 'the manager did not say why';
            toast('NOT turned ' + (v ? 'on' : 'off') + ' — ' + w, 'err');
          }
        }).catch(function (err) {
          cfg.enabled = prev; masterInput.checked = prev;
          toast('NOT turned ' + (v ? 'on' : 'off') + ' — ' + why(err), 'err');
        });
      } });
      masterInput.checked = !!cfg.enabled;
      var master = h('label', { class: 'bs-chk' }, [masterInput, h('span', {}, 'Enabled')]);
      statusBar = h('div', { class: 'bs-stats' });
      wrap.appendChild(h('div', { class: 'bs-head' }, [
        h('div', { class: 'bs-head-l' }, [
          h('h2', {}, 'Better Squads'),
          h('p', { class: 'bs-intro' }, 'Squad-only chat: alerts about your own people, and in-game commands to ask where they are. Nobody outside the squad sees any of it.'),
        ]),
        h('div', { class: 'bs-head-r' }, [master]),
      ]));
      wrap.appendChild(statusBar);
      renderStatusBar();

      // events ---------------------------------------------------------------
      var evRows = EVENTS.map(function (def) {
        var key = def[0];
        var ev = cfg.events[key] || (cfg.events[key] = { enabled: false, message: '' });
        var msg = textField(function () { return ev.message; }, function (v) { ev.message = v; }, { multiline: true, placeholder: 'Message sent to the squad…' });
        return h('div', { class: 'bs-ev' }, [
          h('div', { class: 'bs-ev-head' }, [
            toggle(function () { return ev.enabled; }, function (v) { ev.enabled = v; }, def[1]),
            h('small', { class: 'bs-ev-sub' }, def[2]),
          ]),
          msg,
          tokenBar(COMMON.concat(def[3]).concat(RELATIVE)),
        ]);
      });
      var evNote = h('p', { class: 'bs-note' }, [
        h('b', {}, 'Square brackets mark an optional part.'),
        ' Anything inside [ ] disappears if a token in it has no value — so ',
        h('code', {}, '{player} died[ in {sector}].'),
        ' reads “Petr died in B3.” normally and “Petr died.” when the position is unknown.',
      ]);
      wrap.appendChild(card('Events', 'What gets announced and exactly how it reads. Amber tokens are measured from whoever is reading the line, so those messages go out individually.',
        [evNote].concat(evRows).concat([saveBar('Save messages')])));

      // delivery -------------------------------------------------------------
      var chSel = h('select', { onchange: function () { cfg.channel = chSel.value; } },
        Object.keys(CH_LABEL).map(function (k) { return h('option', { value: k, selected: cfg.channel === k }, CH_LABEL[k]); }));
      var cool = h('input', { type: 'number', min: 0, max: 600, value: cfg.cooldownSeconds, oninput: function () { cfg.cooldownSeconds = Number(cool.value); } });
      var roster = h('input', { type: 'number', min: 5, max: 3600, value: cfg.rosterPollSeconds, oninput: function () { cfg.rosterPollSeconds = Number(roster.value); } });
      var maxIndiv = h('input', { type: 'number', min: 0, max: 100, value: cfg.maxIndividualSends, oninput: function () { cfg.maxIndividualSends = Number(maxIndiv.value); } });
      var maxMin = h('input', { type: 'number', min: 0, max: 5000, value: cfg.maxPerMinute, oninput: function () { cfg.maxPerMinute = Number(maxMin.value); } });
      var qFrom = h('input', { type: 'number', min: 0, max: 23, value: cfg.quietHours.from, oninput: function () { cfg.quietHours.from = Number(qFrom.value); } });
      var qTo = h('input', { type: 'number', min: 0, max: 23, value: cfg.quietHours.to, oninput: function () { cfg.quietHours.to = Number(qTo.value); } });

      wrap.appendChild(card('Delivery', 'Where the lines land and how often they are allowed to fire.', [
        h('div', { class: 'bs-grid' }, [
          field('Chat channel', chSel, 'Only changes where the line appears. Recipients are always the squad.'),
          field('Cooldown (seconds)', cool, 'Per player, per event. Stops a relog or a firefight from spamming everyone.'),
          field('Roster check (seconds)', roster, 'How often squad membership is re-read, for the joined/left events.'),
          field('Quiet hours from', qFrom, 'Server hour, 0–23.'),
          field('Quiet hours to', qTo, 'Nothing is sent inside this window.'),
          field('Per-reader limit', maxIndiv, 'Above this many recipients, a reader-relative message is sent once to everyone instead of one copy each. 0 = never.'),
          field('Messages per minute', maxMin, 'Hard ceiling across the whole plugin. 0 = unlimited.'),
        ]),
        h('div', { class: 'bs-checks' }, [
          toggle(function () { return cfg.includeSelf; }, function (v) { cfg.includeSelf = v; }, 'Also send to the player it is about'),
          toggle(function () { return cfg.quietHours.enabled; }, function (v) { cfg.quietHours.enabled = v; }, 'Respect quiet hours'),
        ]),
        saveBar('Save delivery'),
      ]));

      // commands -------------------------------------------------------------
      var rootIn = textField(function () { return cfg.commands.root; }, function (v) { cfg.commands.root = v; });
      var preview = h('code', { class: 'bs-prev' }, '');
      function renderPreview() {
        preview.textContent = SUBS.filter(function (s) { return (cfg.commands.subs[s[0]] || {}).enabled; })
          .map(function (s) { return '/' + cfg.commands.root + ' ' + (cfg.commands.subs[s[0]] || {}).name; })
          .join('   ') || '/' + cfg.commands.root;
      }
      var subGrid = h('div', { class: 'bs-subs' }, SUBS.map(function (s) {
        var sc = cfg.commands.subs[s[0]] || (cfg.commands.subs[s[0]] = { enabled: false, name: s[0] });
        var nameIn = textField(function () { return sc.name; }, function (v) { sc.name = v; renderPreview(); });
        nameIn.className = 'bs-sub-name';
        return h('div', { class: 'bs-sub' }, [
          h('div', { class: 'bs-sub-head' }, [toggle(function () { return sc.enabled; }, function (v) { sc.enabled = v; renderPreview(); }, s[1]), nameIn]),
          h('small', { class: 'bs-hint' }, s[2]),
        ]);
      }));
      renderPreview();

      var textCards = TEXT_GROUPS.map(function (g) {
        return h('div', { class: 'bs-tgroup' }, [h('h4', { class: 'bs-tgroup-t' }, g[0])].concat(g[1].map(function (k) {
          var input = textField(function () { return cfg.commands.texts[k]; }, function (v) { cfg.commands.texts[k] = v; });
          return field(TEXT_LABEL[k] || k, input);
        })));
      });

      wrap.appendChild(card('In-game commands', 'Players run this from chat. Rename the root or any subcommand — the preview shows exactly what they will type.', [
        h('div', { class: 'bs-checks' }, [toggle(function () { return cfg.commands.enabled; }, function (v) { cfg.commands.enabled = v; }, 'Enable in-game commands')]),
        h('div', { class: 'bs-grid' }, [field('Root command', rootIn, 'Typed with the manager’s chat-command prefix.')]),
        h('div', { class: 'bs-prev-wrap' }, [h('span', { class: 'bs-prev-l' }, 'Players type'), preview]),
        subGrid,
        saveBar('Save commands'),
      ]));

      wrap.appendChild(card('Command replies', 'Every line a player can see, in any language. Tokens and [ optional parts ] work exactly as they do in the event messages.',
        textCards.concat([
          tokenBar(['{player}', '{squad}', '{squadonline}', '{squadsize}', '{sector}', '{distance}', '{direction}', '{text}', '{count}', '{score}', '{motd}', '{list}', '{muted}', '{root}']),
          saveBar('Save replies'),
        ])));

      // what players silenced themselves ------------------------------------
      prefTable = SSA.table({
        rows: function () { return players.filter(function (p) { return p.off || (p.muted && p.muted.length); }); },
        // Not "nobody ONLINE" any more: the list now includes players who silenced something and
        // then logged off. Their setting keeps working while they are away, so leaving them out
        // meant "reset it if someone asks" was impossible for the very person most likely to ask —
        // they are asking on Discord, not standing in game.
        empty: 'Nobody has silenced anything.',
        columns: [
          { key: 'name', label: 'Player', sort: true, sortVal: function (r) { return String(r.name || '').toLowerCase(); }, render: function (r) {
            var cell = SSA.cell.player(r.name, r.steamId);
            // Offline is worth seeing: it explains why they are not in the squad list above, and it
            // is the difference between "they can undo it themselves" and "only you can".
            if (r.online === false) {
              var wrap = h('span', { class: 'bs-pl-off' }, [cell, h('span', { class: 'bs-off-tag' }, 'offline')]);
              return wrap;
            }
            return cell;
          } },
          { key: 'squad', label: 'Squad', render: function (r) { return document.createTextNode(r.squad || '—'); } },
          { key: 'state', label: 'Silenced', render: function (r) { return r.off ? SSA.cell.tag('all alerts off', 'bad') : document.createTextNode((r.muted || []).join(', ')); } },
          { key: 'act', label: '', render: function (r) {
            return h('button', { class: 'secondary', onclick: function () {
              api('/prefs/reset', { method: 'POST', body: { steamId: r.steamId } }).then(function (res) {
                if (res && res.ok) { toast('Reset'); refreshStatus(); }
                else { var w = (res && (res.reason || res.error)) || 'the manager did not say why'; toast((r.name || r.steamId) + ' was NOT reset — ' + w, 'err'); }
              }).catch(function (err) {
                toast((r.name || r.steamId) + ' was NOT reset — ' + why(err), 'err');
              });
            } }, 'Reset');
          } },
        ],
      });
      wrap.appendChild(card('Silenced by players', 'What squad members turned off for themselves with the in-game commands. Reset it if someone asks.', [prefTable.el]));

      // admin mute -----------------------------------------------------------
      var muteBox = h('div', { class: 'bs-chips' });
      function renderMutes() {
        muteBox.innerHTML = '';
        if (!cfg.mutedSteamIds.length) { muteBox.appendChild(h('span', { class: 'bs-empty' }, 'Nobody is muted.')); return; }
        cfg.mutedSteamIds.forEach(function (sid) {
          var p = players.filter(function (x) { return x.steamId === sid; })[0];
          var label = (p && p.name) || sid;
          muteBox.appendChild(h('span', { class: 'bs-chip' }, [
            label,
            h('button', { class: 'bs-chip-x', title: 'Unmute', onclick: function () {
              // Applied to the chip list right away so the click feels instant, but this is exactly
              // the "never clear a local list on a failed POST" case: if the save is refused, the
              // chip comes back rather than leaving the admin believing the player is still muted.
              var before = cfg.mutedSteamIds;
              cfg.mutedSteamIds = cfg.mutedSteamIds.filter(function (x) { return x !== sid; });
              renderMutes();
              api('/config', { method: 'POST', body: cfg }).then(function (r) {
                if (!(r && r.ok)) {
                  cfg.mutedSteamIds = before; renderMutes();
                  var w = (r && (r.reason || r.error)) || 'the manager did not say why';
                  toast(label + ' was NOT unmuted — ' + w, 'err');
                }
              }).catch(function (err) {
                cfg.mutedSteamIds = before; renderMutes();
                toast(label + ' was NOT unmuted — ' + why(err), 'err');
              });
            } }, '×'),
          ]));
        });
      }
      renderMutes();
      var addMute = h('button', { class: 'secondary', onclick: function () {
        if (!window.SSA || !SSA.pickPlayer) { toast('Player picker unavailable'); return; }
        SSA.pickPlayer().then(function (p) {
          if (!p) return;
          var sid = String(p.steamId || p.SteamID || '');
          if (!sid || cfg.mutedSteamIds.indexOf(sid) >= 0) return;
          var label = p.name || sid;
          cfg.mutedSteamIds.push(sid); renderMutes();
          api('/config', { method: 'POST', body: cfg }).then(function (r) {
            if (!(r && r.ok)) {
              cfg.mutedSteamIds = cfg.mutedSteamIds.filter(function (x) { return x !== sid; }); renderMutes();
              var w = (r && (r.reason || r.error)) || 'the manager did not say why';
              toast(label + ' was NOT muted — ' + w, 'err');
            }
          }).catch(function (err) {
            cfg.mutedSteamIds = cfg.mutedSteamIds.filter(function (x) { return x !== sid; }); renderMutes();
            toast(label + ' was NOT muted — ' + why(err), 'err');
          });
        });
      } }, [icon('ban'), 'Mute a player']);
      wrap.appendChild(card('Muted by an admin', 'A muted player receives none of these messages. Their squadmates still do, and they cannot undo this in game.', [muteBox, h('div', { class: 'bs-actions' }, [addMute])]));

      // test + log -----------------------------------------------------------
      var testBtn = h('button', { class: 'secondary', onclick: function () {
        if (!window.SSA || !SSA.pickPlayer) { toast('Player picker unavailable'); return; }
        SSA.pickPlayer().then(function (p) {
          if (!p) return;
          api('/test', { method: 'POST', body: { steamId: String(p.steamId || p.SteamID || '') } }).then(function (r) {
            if (r && r.ok) toast('Sent to ' + r.delivered + ' squad member(s)', 'ok');
            else if (r && r.error === 'not_in_squad') toast('That player is not in a squad', 'err');
            else if (r && r.error === 'nobody_online') toast('Nobody from that squad is online', 'err');
            else toast('Test failed' + ((r && r.error) ? ' — ' + r.error : ''), 'err');
          }).catch(function (err) {
            toast('Test failed — ' + why(err), 'err');
          });
        });
      } }, [icon('chat'), 'Send a test']);
      var clearBtn = h('button', { class: 'secondary', onclick: function () {
        SSA.confirm('Clear the activity log?').then(function (ok) {
          if (!ok) return;
          // The local list is cleared only after the backend confirms it — a refusal must never look
          // like a successful clear, since the log has already gone once the admin sees an empty table.
          api('/clear-log', { method: 'POST' }).then(function (r) {
            if (r && r.ok) { statusData.recent = []; if (logTable) logTable.refresh(); }
            else toast('The log was NOT cleared — ' + ((r && (r.reason || r.error)) || 'the manager did not say why'), 'err');
          }).catch(function (err) {
            toast('The log was NOT cleared — ' + why(err), 'err');
          });
        });
      } }, [icon('close'), 'Clear log']);

      // rows as a getter, so refresh() always re-reads the latest poll result
      logTable = SSA.table({
        rows: function () { return statusData.recent || []; },
        empty: 'Nothing sent yet. Messages appear here as they go out.',
        columns: [
          { key: 'at', label: 'When', sort: true, sortVal: function (r) { return r.at || 0; }, render: function (r) { return document.createTextNode(ago(r.at)); } },
          { key: 'kind', label: 'Event', render: function (r) { return SSA.cell.tag(r.kind, 'ok'); } },
          { key: 'actor', label: 'Player', render: function (r) { return document.createTextNode(r.actor || '—'); } },
          { key: 'text', label: 'Message', render: function (r) { return document.createTextNode(r.text || ''); } },
          { key: 'recipients', label: 'Sent to', render: function (r) { return document.createTextNode(String(r.recipients || 0)); } },
        ],
      });
      wrap.appendChild(card('Activity', 'The last messages this plugin delivered. For a per-reader message this shows the first copy that went out.', [
        h('div', { class: 'bs-actions' }, [testBtn, clearBtn]),
        logTable.el,
      ]));
    }

    function load() {
      Promise.all([api('/config'), api('/status'), api('/players')]).then(function (r) {
        cfg = r[0] || {};
        cfg.events = cfg.events || {};
        cfg.commands = cfg.commands || {};
        cfg.commands.subs = cfg.commands.subs || {};
        cfg.commands.texts = cfg.commands.texts || {};
        cfg.quietHours = cfg.quietHours || { enabled: false, from: 0, to: 0 };
        cfg.mutedSteamIds = cfg.mutedSteamIds || [];
        statusData = r[1] || statusData;
        players = r[2] || [];
        build();
        // The tab can be mounted many times; keep exactly ONE poll timer, always driving the most
        // recent mount, or the timers stack up and the panel polls faster and faster.
        if (bsPollTimer) clearInterval(bsPollTimer);
        bsPollTimer = setInterval(refreshStatus, 10000);
      }).catch(loadFailed);
    }
    load();
  }

  SSA.ready(function () {
    SSA.registerTab({ id: 'better-squads', label: 'Better Squads', icon: '#i-users', premium: true, render: editor });
  });
}());
