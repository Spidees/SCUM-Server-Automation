/* Better Squads — admin UI.
 *
 * One workspace: a live status header, per-event toggles with editable templates and a
 * click-to-insert token palette, delivery rules, the in-game command set (root + subcommands +
 * every player-facing line), what players have silenced for themselves, and a feed of what was
 * actually sent. Icons, tables and cells come from the manager's native SDK so this looks like part
 * of the panel, not a bolt-on. Talks only to its own backend under /api/plugin-host/better-squads. */
(function () {
  'use strict';
  // The panel's own translator. The English second argument is what renders when a reader's language
  // has no line for that key, so a screen with no locale data reads exactly as it does in English.
  var T = SSA.t;
  // Where the bridge's switches live, built from the PANEL's own keys (the nav entry and the tab
  // that render themselves from them), so the route is right in every language and after a rename.
  function bridgeWhere() {
    return T('nav.plugins', 'Plugins') + ' → ' + T('plugins.viewInGame', 'SSA Bridge');
  }

  /* Every label-bearing table below is a FUNCTION rather than a constant, and that is not a style
   * choice: a plugin's locale data is merged only once every plugin script has run, so a table built
   * at the top of this file would be English for ever. The value saved into the config is always the
   * key beside the label, never the label itself. */
  function chLabels() {
    return {
      squad: T('pl.better-squads.channel.squad', 'Squad'),
      local: T('pl.better-squads.channel.local', 'Local'),
      global: T('pl.better-squads.channel.global', 'Global'),
      admin: T('pl.better-squads.channel.admin', 'Admin'),
    };
  }

  // Tokens every message can use.
  var COMMON = ['{player}', '{squad}', '{squadonline}', '{squadsize}', '{sector}'];
  // Tokens measured FROM THE READER — using one makes the plugin render the line per recipient.
  var RELATIVE = ['{distance}', '{direction}'];

  // [key, title, when it fires, extra tokens beyond COMMON]
  function events() {
    return [
      ['join', T('pl.better-squads.event.join.title', 'Connected'),
        T('pl.better-squads.event.join.when', 'A squadmate comes online'), []],
      ['leave', T('pl.better-squads.event.leave.title', 'Disconnected'),
        T('pl.better-squads.event.leave.when', 'A squadmate goes offline'), []],
      ['death', T('pl.better-squads.event.death.title', 'Killed'),
        T('pl.better-squads.event.death.when', 'A squadmate is killed by a player or an NPC'), ['{killer}', '{weapon}', '{shotdistance}']],
      ['suicide', T('pl.better-squads.event.suicide.title', 'Died'),
        T('pl.better-squads.event.suicide.when', 'Suicide, or their own mine or trap'), []],
      ['kill', T('pl.better-squads.event.kill.title', 'Got a kill'),
        T('pl.better-squads.event.kill.when', 'A squadmate kills someone'), ['{victim}', '{weapon}', '{shotdistance}']],
      ['raid', T('pl.better-squads.event.raid.title', 'Base raided'),
        T('pl.better-squads.event.raid.when', 'An owner/raid alert fires for a squadmate'), ['{object}']],
      ['squadJoin', T('pl.better-squads.event.squadjoin.title', 'Joined squad'),
        T('pl.better-squads.event.squadjoin.when', 'Someone is added to the squad'), []],
      ['squadLeave', T('pl.better-squads.event.squadleave.title', 'Left squad'),
        T('pl.better-squads.event.squadleave.when', 'Someone leaves or is removed from the squad'), []],
    ];
  }

  function tokenHelp() {
    return {
      '{player}': T('pl.better-squads.token.player', 'Who the message is about'),
      '{killer}': T('pl.better-squads.token.killer', 'Who killed them'),
      '{victim}': T('pl.better-squads.token.victim', 'Who they killed'),
      '{weapon}': T('pl.better-squads.token.weapon', 'Weapon used'),
      '{shotdistance}': T('pl.better-squads.token.shotdistance', 'How far the shot was, in metres'),
      '{object}': T('pl.better-squads.token.object', 'What was attacked (vehicle, chest, lock…)'),
      '{squad}': T('pl.better-squads.token.squad', 'The squad’s name'),
      '{squadonline}': T('pl.better-squads.token.squadonline', 'Squad members online right now'),
      '{squadsize}': T('pl.better-squads.token.squadsize', 'Total squad members'),
      '{sector}': T('pl.better-squads.token.sector', 'Map sector where it happened, e.g. B3'),
      '{distance}': T('pl.better-squads.token.distance', 'Metres from the player reading it'),
      '{direction}': T('pl.better-squads.token.direction', 'Compass direction from the player reading it'),
    };
  }

  // [key, title, what it does] — the in-game subcommands.
  function subs() {
    return [
      ['help', T('pl.better-squads.sub.help.title', 'Help'),
        T('pl.better-squads.sub.help.desc', 'Lists the available subcommands')],
      ['off', T('pl.better-squads.sub.off.title', 'Alerts off'),
        T('pl.better-squads.sub.off.desc', 'Player silences every alert for themselves')],
      ['on', T('pl.better-squads.sub.on.title', 'Alerts on'),
        T('pl.better-squads.sub.on.desc', 'Turns their alerts back on')],
      ['mute', T('pl.better-squads.sub.mute.title', 'Mute'),
        T('pl.better-squads.sub.mute.desc', 'Silences individual events, e.g. “mute kill,join”')],
      ['here', T('pl.better-squads.sub.here.title', 'Rally'),
        T('pl.better-squads.sub.here.desc', 'Tells the squad which sector they are in')],
      ['msg', T('pl.better-squads.sub.msg.title', 'Message'),
        T('pl.better-squads.sub.msg.desc', 'Sends a line to every online squadmate')],
      ['base', T('pl.better-squads.sub.base.title', 'Base'),
        T('pl.better-squads.sub.base.desc', 'Direction and distance to the nearest squad base')],
      ['info', T('pl.better-squads.sub.info.title', 'Info'),
        T('pl.better-squads.sub.info.desc', 'Squad name, online count, score and MOTD')],
    ];
  }

  // Player-facing lines, grouped so the list doesn't read as one long wall.
  function textGroups() {
    return [
      [T('pl.better-squads.group.roster', 'Roster (the bare command)'), ['rosterHeader', 'rosterLine', 'rosterEmpty']],
      [T('pl.better-squads.group.rally', 'Rally & messages'), ['here', 'hereOk', 'msgLine', 'msgOk', 'msgUsage', 'nobodyOnline']],
      [T('pl.better-squads.group.baseinfo', 'Base & info'), ['base', 'baseNone', 'info', 'infoMotd']],
      [T('pl.better-squads.group.selfservice', 'Self-service switches'), ['mutedOn', 'mutedOff', 'muteUsage', 'muteSet']],
      [T('pl.better-squads.group.other', 'Other'), ['help', 'notInSquad']],
    ];
  }
  /** A key with no label of its own, made readable rather than left as a camel-case identifier. */
  function humanKey(k) {
    var s = String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function textLabels() {
    return {
      rosterHeader: T('pl.better-squads.text.rosterheader', 'Roster header'),
      rosterLine: T('pl.better-squads.text.rosterline', 'One line per squadmate'),
      rosterEmpty: T('pl.better-squads.text.rosterempty', 'Nobody else online'),
      notInSquad: T('pl.better-squads.text.notinsquad', 'Not in a squad'),
      squadUnknown: T('pl.better-squads.text.squadunknown', 'Squad list could not be read'),
      sendFailed: T('pl.better-squads.text.sendfailed', 'Nothing reached the squad'),
      muteUnknown: T('pl.better-squads.text.muteunknown', 'Mute — word not recognised'),
      help: T('pl.better-squads.text.help', 'Help line'),
      mutedOn: T('pl.better-squads.text.mutedon', 'Alerts turned off'),
      mutedOff: T('pl.better-squads.text.mutedoff', 'Alerts turned on'),
      muteUsage: T('pl.better-squads.text.muteusage', 'Mute — how to use it'),
      muteSet: T('pl.better-squads.text.muteset', 'Mute — confirmation'),
      here: T('pl.better-squads.text.here', 'Rally, sent to the squad'),
      hereOk: T('pl.better-squads.text.hereok', 'Rally — confirmation'),
      msgUsage: T('pl.better-squads.text.msgusage', 'Message — how to use it'),
      msgLine: T('pl.better-squads.text.msgline', 'Message, sent to the squad'),
      msgOk: T('pl.better-squads.text.msgok', 'Message — confirmation'),
      base: T('pl.better-squads.text.base', 'Base found'),
      baseNone: T('pl.better-squads.text.basenone', 'No base found'),
      info: T('pl.better-squads.text.info', 'Squad info'),
      infoMotd: T('pl.better-squads.text.infomotd', 'Squad MOTD'),
      nobodyOnline: T('pl.better-squads.text.nobodyonline', 'Nobody else online'),
    };
  }

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
  /* The master switch refusing, as one sentence per direction rather than a word glued into the
   * middle of another: which way round "on"/"off" reads is a language's own business. */
  function masterFailed(on, w) {
    return on ? T('pl.better-squads.master.noton', 'NOT turned on — {why}', { why: w })
      : T('pl.better-squads.master.notoff', 'NOT turned off — {why}', { why: w });
  }
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
    if (s < 60) return T('pl.better-squads.ago.seconds', '{n}s ago', { n: s });
    if (s < 3600) return T('pl.better-squads.ago.minutes', '{n}m ago', { n: Math.floor(s / 60) });
    if (s < 86400) return T('pl.better-squads.ago.hours', '{n}h ago', { n: Math.floor(s / 3600) });
    return T('pl.better-squads.ago.days', '{n}d ago', { n: Math.floor(s / 86400) });
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
    var help = tokenHelp();
    return h('div', { class: 'bs-tokens' }, tokens.map(function (t) {
      var rel = RELATIVE.indexOf(t) >= 0;
      return h('button', {
        type: 'button', class: 'bs-token' + (rel ? ' bs-token-rel' : ''),
        title: (help[t] || '') + (rel ? T('pl.better-squads.token.relative.note', ' — sent individually to each reader') : ''),
        onclick: function () {
          var el = lastFocused;
          if (!el) { toast(T('pl.better-squads.toast.focusfield', 'Click into a message field first')); return; }
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
    wrap.appendChild(h('div', { class: 'bs-loading' }, T('pl.better-squads.loading', 'Loading…')));

    // Where a failure goes when the tab itself could not load. Without a slot, a throwing client only
    // moves the silence: the promise rejects, nothing renders, and the tab sits on "Loading…" for
    // ever — which reads as slow rather than as broken.
    function loadFailed(err) {
      wrap.innerHTML = '';
      var retry = h('button', { type: 'button', class: 'secondary', onclick: function () { wrap.innerHTML = ''; wrap.appendChild(h('div', { class: 'bs-loading' }, T('pl.better-squads.loading', 'Loading…'))); load(); } }, T('pl.better-squads.err.retry', 'Try again'));
      wrap.appendChild(h('div', { class: 'bs-err' }, [
        h('strong', {}, T('pl.better-squads.err.loadfailed', 'This tab could not load its settings. ')),
        h('span', {}, why(err)),
        h('div', { class: 'bs-err-act' }, [retry]),
      ]));
    }

    // This mount's own poll timer. The page-wide `bsPollTimer` only remembers the newest one.
    var ownTimer = null;
    function stopPolling() {
      if (ownTimer) clearInterval(ownTimer);
      if (bsPollTimer === ownTimer) bsPollTimer = null;
      ownTimer = null;
    }

    // `background` is the interval's own tick. A timer outlives its page: it used to be cleared only
    // by the next mount, so leaving the tab left it asking the manager for two lists every ten
    // seconds for as long as the panel stayed open. A page taken out of the document stops its own
    // timer; one that is merely hidden (another tab, a minimised window) skips the tick.
    function refreshStatus(background) {
      if (background === true) {
        if (!wrap.isConnected) { stopPolling(); return Promise.resolve(); }
        if (document.hidden || !wrap.getClientRects().length) return Promise.resolve();
      }
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
      [[T('pl.better-squads.stat.online', 'Online'), statusData.online],
       [T('pl.better-squads.stat.activesquads', 'Squads with 2+ online'), statusData.activeSquads],
       [T('pl.better-squads.stat.sent', 'Messages sent'), st.sent || 0],
       [T('pl.better-squads.stat.failed', 'Reached nobody'), st.failed || 0, (st.failed || 0) > 0],
       [T('pl.better-squads.stat.suppressed', 'Suppressed'), st.suppressed || 0],
       [T('pl.better-squads.stat.commands', 'Commands run'), st.commands || 0],
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
          h('b', {}, T('pl.better-squads.live.stopped', 'The live figures have stopped updating.')),
          T('pl.better-squads.live.stopped.body', ' {err} The settings on this page are unaffected — you can keep editing and saving them.', { err: pollErr }),
        ]));
      }
      // Six zeroes and no explanation is how "nothing has happened yet" gets read as "nothing works".
      // Every message, command name and reply on this page is editable right now; the counters are the
      // only part that has to wait, and the best time to write the texts is before anyone is on.
      if (statusData.serverRunning === false) {
        statusBar.appendChild(h('div', { class: 'bs-note-off' }, [
          h('b', {}, T('pl.better-squads.note.serveroff', 'The server is not running.')),
          T('pl.better-squads.note.serveroff.body', ' Messages, command names and replies can be written now. Only counters and player lists wait.'),
        ]));
      }
      if (statusData.geography === false) {
        statusBar.appendChild(h('div', { class: 'bs-warn' }, [
          icon('alert'), T('pl.better-squads.warn.nogeography', ' Map calibration unavailable — {sector} and {direction} render empty.'),
        ]));
      }
      // A live read that could not run. The plugin then answers from the last save, which is what it
      // always did — but an owner who is not told cannot tell that apart from everything working, and
      // "my squad was told someone is 40 m away and he was two kilometres off" has no other
      // explanation on this screen. Drawn only when there is something to say.
      var live = statusData.live || {};
      [['players', function (note) { return T('pl.better-squads.warn.savedplayers', ' Squadmate positions are coming from the last save, not the running game: {note}.', { note: note }); }],
        ['squads', function (note) { return T('pl.better-squads.warn.savedsquads', ' Squad membership is coming from the last save, not the running game: {note}.', { note: note }); }],
      ].forEach(function (row) {
        var n = live[row[0]];
        if (!n || !n.text) return;
        var note = (n.code === 'module_off' && n.switch)
          ? T('pl.better-squads.live.turnOn', 'turn on "{switch}" in {where}', { switch: n.switch, where: bridgeWhere() })
          : n.text;
        statusBar.appendChild(h('div', { class: 'bs-warn' }, [icon('alert'), row[1](note)]));
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
          msg.textContent = T('pl.better-squads.save.saving', 'Saving…'); btn.disabled = true;
          api('/config', { method: 'POST', body: cfg }).then(function (r) {
            btn.disabled = false;
            if (r && r.ok) {
              msg.textContent = T('pl.better-squads.save.saved', 'Saved ✓'); toast(T('pl.better-squads.toast.saved', 'Saved'), 'ok');
              setTimeout(function () { msg.textContent = ''; }, 2500);
            } else {
              // A route that answered 200 without `ok` is a refusal too, and it may have said why.
              var w = (r && (r.reason || r.error)) || T('pl.better-squads.nowhy', 'the manager did not say why');
              var line = T('pl.better-squads.save.failed', 'NOT saved — {why}', { why: w });
              msg.textContent = line; toast(line, 'err');
            }
          }).catch(function (err) {
            btn.disabled = false;
            var line = T('pl.better-squads.save.failed', 'NOT saved — {why}', { why: why(err) });
            msg.textContent = line;
            toast(line, 'err');
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
            var w = (r && (r.reason || r.error)) || T('pl.better-squads.nowhy', 'the manager did not say why');
            toast(masterFailed(v, w), 'err');
          }
        }).catch(function (err) {
          cfg.enabled = prev; masterInput.checked = prev;
          toast(masterFailed(v, why(err)), 'err');
        });
      } });
      masterInput.checked = !!cfg.enabled;
      var master = h('label', { class: 'bs-chk' }, [masterInput, h('span', {}, T('pl.better-squads.enabled', 'Enabled'))]);
      statusBar = h('div', { class: 'bs-stats' });
      wrap.appendChild(h('div', { class: 'bs-head' }, [
        h('div', { class: 'bs-head-l' }, [
          h('h2', {}, 'Better Squads'),
          h('p', { class: 'bs-intro' }, T('pl.better-squads.intro', 'Squad-only chat: alerts about your people and commands to find them. Nobody else sees it.')),
        ]),
        h('div', { class: 'bs-head-r' }, [master]),
      ]));
      wrap.appendChild(statusBar);
      renderStatusBar();

      // events ---------------------------------------------------------------
      var evRows = events().map(function (def) {
        var key = def[0];
        var ev = cfg.events[key] || (cfg.events[key] = { enabled: false, message: '' });
        var msg = textField(function () { return ev.message; }, function (v) { ev.message = v; }, { multiline: true, placeholder: T('pl.better-squads.event.placeholder', 'Message sent to the squad…') });
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
        h('b', {}, T('pl.better-squads.note.brackets', 'Square brackets mark an optional part.')),
        T('pl.better-squads.note.brackets.body', ' Anything inside [ ] disappears if a token in it has no value — so '),
        h('code', {}, '{player} died[ in {sector}].'),
        T('pl.better-squads.note.brackets.example', ' reads “Petr died in B3.” normally and “Petr died.” when the position is unknown.'),
      ]);
      wrap.appendChild(card(T('pl.better-squads.card.events', 'Events'), T('pl.better-squads.card.events.sub', 'What gets announced and how. Amber tokens depend on the reader, so those send individually.'),
        [evNote].concat(evRows).concat([saveBar(T('pl.better-squads.save.messages', 'Save messages'))])));

      // delivery -------------------------------------------------------------
      var chLab = chLabels();
      var chSel = h('select', { onchange: function () { cfg.channel = chSel.value; } },
        Object.keys(chLab).map(function (k) { return h('option', { value: k, selected: cfg.channel === k }, chLab[k]); }));
      var cool = h('input', { type: 'number', min: 0, max: 600, value: cfg.cooldownSeconds, oninput: function () { cfg.cooldownSeconds = Number(cool.value); } });
      var roster = h('input', { type: 'number', min: 5, max: 3600, value: cfg.rosterPollSeconds, oninput: function () { cfg.rosterPollSeconds = Number(roster.value); } });
      var maxIndiv = h('input', { type: 'number', min: 0, max: 100, value: cfg.maxIndividualSends, oninput: function () { cfg.maxIndividualSends = Number(maxIndiv.value); } });
      var maxMin = h('input', { type: 'number', min: 0, max: 5000, value: cfg.maxPerMinute, oninput: function () { cfg.maxPerMinute = Number(maxMin.value); } });
      var qFrom = h('input', { type: 'number', min: 0, max: 23, value: cfg.quietHours.from, oninput: function () { cfg.quietHours.from = Number(qFrom.value); } });
      var qTo = h('input', { type: 'number', min: 0, max: 23, value: cfg.quietHours.to, oninput: function () { cfg.quietHours.to = Number(qTo.value); } });

      wrap.appendChild(card(T('pl.better-squads.card.delivery', 'Delivery'), T('pl.better-squads.card.delivery.sub', 'Where the lines land and how often they are allowed to fire.'), [
        h('div', { class: 'bs-grid' }, [
          field(T('pl.better-squads.field.channel', 'Chat channel'), chSel, T('pl.better-squads.field.channel.hint', 'Only changes where the line appears. Recipients are always the squad.')),
          field(T('pl.better-squads.field.cooldown', 'Cooldown (seconds)'), cool, T('pl.better-squads.field.cooldown.hint', 'Per player, per event. Stops a relog or a firefight from spamming everyone.')),
          field(T('pl.better-squads.field.roster', 'Roster check (seconds)'), roster, T('pl.better-squads.field.roster.hint', 'How often squad membership is re-read, for the joined/left events.')),
          field(T('pl.better-squads.field.quietfrom', 'Quiet hours from'), qFrom, T('pl.better-squads.field.quietfrom.hint', 'Server hour, 0–23.')),
          field(T('pl.better-squads.field.quietto', 'Quiet hours to'), qTo, T('pl.better-squads.field.quietto.hint', 'Nothing is sent inside this window.')),
          field(T('pl.better-squads.field.perreader', 'Per-reader limit'), maxIndiv, T('pl.better-squads.field.perreader.hint', 'Above this many recipients, a per-reader message goes once to all. 0 = never.')),
          field(T('pl.better-squads.field.perminute', 'Messages per minute'), maxMin, T('pl.better-squads.field.perminute.hint', 'Hard ceiling across the whole plugin. 0 = unlimited.')),
        ]),
        h('div', { class: 'bs-checks' }, [
          toggle(function () { return cfg.includeSelf; }, function (v) { cfg.includeSelf = v; }, T('pl.better-squads.chk.includeself', 'Also send to the player it is about')),
          toggle(function () { return cfg.quietHours.enabled; }, function (v) { cfg.quietHours.enabled = v; }, T('pl.better-squads.chk.quiethours', 'Respect quiet hours')),
        ]),
        saveBar(T('pl.better-squads.save.delivery', 'Save delivery')),
      ]));

      // commands -------------------------------------------------------------
      var rootIn = textField(function () { return cfg.commands.root; }, function (v) { cfg.commands.root = v; });
      var preview = h('code', { class: 'bs-prev' }, '');
      var SUB_DEFS = subs();
      function renderPreview() {
        preview.textContent = SUB_DEFS.filter(function (s) { return (cfg.commands.subs[s[0]] || {}).enabled; })
          .map(function (s) { return '/' + cfg.commands.root + ' ' + (cfg.commands.subs[s[0]] || {}).name; })
          .join('   ') || '/' + cfg.commands.root;
      }
      var subGrid = h('div', { class: 'bs-subs' }, SUB_DEFS.map(function (s) {
        var sc = cfg.commands.subs[s[0]] || (cfg.commands.subs[s[0]] = { enabled: false, name: s[0] });
        var nameIn = textField(function () { return sc.name; }, function (v) { sc.name = v; renderPreview(); });
        nameIn.className = 'bs-sub-name';
        return h('div', { class: 'bs-sub' }, [
          h('div', { class: 'bs-sub-head' }, [toggle(function () { return sc.enabled; }, function (v) { sc.enabled = v; renderPreview(); }, s[1]), nameIn]),
          h('small', { class: 'bs-hint' }, s[2]),
        ]);
      }));
      renderPreview();

      // ⚠ **THE GROUPS ARE THE ORDER, NEVER THE LIST.** The screen used to draw exactly the keys
      // named in textGroups(), so a line added in the backend had no field at all — `sendFailed`,
      // `muteUnknown` and `squadUnknown` were shipped English that no owner could see or change, on
      // a screen whose own heading promises every line a player reads. Anything the backend has and
      // the groups do not name lands in a final group rather than disappearing.
      var baseGroups = textGroups();
      var grouped = {};
      baseGroups.forEach(function (g) { g[1].forEach(function (k) { grouped[k] = 1; }); });
      var leftover = Object.keys(cfg.commands.texts || {}).filter(function (k) { return !grouped[k]; });
      var groups = baseGroups.concat(leftover.length ? [[T('pl.better-squads.group.faults', 'Faults & fallbacks'), leftover]] : []);
      var TEXT_LABEL = textLabels();
      var textCards = groups.map(function (g) {
        return h('div', { class: 'bs-tgroup' }, [h('h4', { class: 'bs-tgroup-t' }, g[0])].concat(g[1].filter(function (k) {
          return cfg.commands.texts[k] !== undefined;
        }).map(function (k) {
          var input = textField(function () { return cfg.commands.texts[k]; }, function (v) { cfg.commands.texts[k] = v; });
          return field(TEXT_LABEL[k] || humanKey(k), input);
        })));
      });

      wrap.appendChild(card(T('pl.better-squads.card.commands', 'In-game commands'), T('pl.better-squads.card.commands.sub', 'Players run these from chat. Rename any command; the preview shows what they type.'), [
        h('div', { class: 'bs-checks' }, [toggle(function () { return cfg.commands.enabled; }, function (v) { cfg.commands.enabled = v; }, T('pl.better-squads.chk.commands', 'Enable in-game commands'))]),
        h('div', { class: 'bs-grid' }, [field(T('pl.better-squads.field.root', 'Root command'), rootIn, T('pl.better-squads.field.root.hint', 'Typed with the manager’s chat-command prefix.'))]),
        h('div', { class: 'bs-prev-wrap' }, [h('span', { class: 'bs-prev-l' }, T('pl.better-squads.preview.label', 'Players type')), preview]),
        subGrid,
        saveBar(T('pl.better-squads.save.commands', 'Save commands')),
      ]));

      wrap.appendChild(card(T('pl.better-squads.card.replies', 'Command replies'), T('pl.better-squads.card.replies.sub', 'Every line players see. Tokens and [ optional parts ] work as in events.'),
        textCards.concat([
          tokenBar(['{player}', '{squad}', '{squadonline}', '{squadsize}', '{sector}', '{distance}', '{direction}', '{text}', '{count}', '{score}', '{motd}', '{list}', '{muted}', '{root}']),
          saveBar(T('pl.better-squads.save.replies', 'Save replies')),
        ])));

      // what players silenced themselves ------------------------------------
      prefTable = SSA.table({
        rows: function () { return players.filter(function (p) { return p.off || (p.muted && p.muted.length); }); },
        // Not "nobody ONLINE" any more: the list now includes players who silenced something and
        // then logged off. Their setting keeps working while they are away, so leaving them out
        // meant "reset it if someone asks" was impossible for the very person most likely to ask —
        // they are asking on Discord, not standing in game.
        empty: T('pl.better-squads.prefs.empty', 'Nobody has silenced anything. Players who turn off their squad alerts in game appear here.'),
        columns: [
          { key: 'name', label: T('pl.better-squads.col.player', 'Player'), sort: true, sortVal: function (r) { return String(r.name || '').toLowerCase(); }, render: function (r) {
            var cell = SSA.cell.player(r.name, r.steamId);
            // Offline is worth seeing: it explains why they are not in the squad list above, and it
            // is the difference between "they can undo it themselves" and "only you can".
            if (r.online === false) {
              var wrap = h('span', { class: 'bs-pl-off' }, [cell, h('span', { class: 'bs-off-tag' }, T('pl.better-squads.tag.offline', 'offline'))]);
              return wrap;
            }
            return cell;
          } },
          { key: 'squad', label: T('pl.better-squads.col.squad', 'Squad'), render: function (r) { return document.createTextNode(r.squad || '—'); } },
          { key: 'state', label: T('pl.better-squads.col.silenced', 'Silenced'), render: function (r) { return r.off ? SSA.cell.tag(T('pl.better-squads.tag.alloff', 'all alerts off'), 'bad') : document.createTextNode((r.muted || []).join(', ')); } },
          { key: 'act', label: '', render: function (r) {
            return h('button', { class: 'secondary', onclick: function () {
              api('/prefs/reset', { method: 'POST', body: { steamId: r.steamId } }).then(function (res) {
                if (res && res.ok) { toast(T('pl.better-squads.prefs.resetok', 'Reset')); refreshStatus(); }
                else {
                  var w = (res && (res.reason || res.error)) || T('pl.better-squads.nowhy', 'the manager did not say why');
                  toast(T('pl.better-squads.prefs.resetfailed', '{who} was NOT reset — {why}', { who: r.name || r.steamId, why: w }), 'err');
                }
              }).catch(function (err) {
                toast(T('pl.better-squads.prefs.resetfailed', '{who} was NOT reset — {why}', { who: r.name || r.steamId, why: why(err) }), 'err');
              });
            } }, T('pl.better-squads.prefs.reset', 'Reset'));
          } },
        ],
      });
      wrap.appendChild(card(T('pl.better-squads.card.silenced', 'Silenced by players'), T('pl.better-squads.card.silenced.sub', 'Alerts squad members turned off for themselves in game. Reset one if asked.'), [prefTable.el]));

      // admin mute -----------------------------------------------------------
      var muteBox = h('div', { class: 'bs-chips' });
      function renderMutes() {
        muteBox.innerHTML = '';
        if (!cfg.mutedSteamIds.length) { muteBox.appendChild(h('span', { class: 'bs-empty' }, T('pl.better-squads.mute.empty', 'Nobody is muted. A muted player gets none of these messages and cannot undo it.'))); return; }
        cfg.mutedSteamIds.forEach(function (sid) {
          var p = players.filter(function (x) { return x.steamId === sid; })[0];
          var label = (p && p.name) || sid;
          muteBox.appendChild(h('span', { class: 'bs-chip' }, [
            label,
            h('button', { class: 'bs-chip-x', title: T('pl.better-squads.mute.unmute', 'Unmute'), onclick: function () {
              // Applied to the chip list right away so the click feels instant, but this is exactly
              // the "never clear a local list on a failed POST" case: if the save is refused, the
              // chip comes back rather than leaving the admin believing the player is still muted.
              var before = cfg.mutedSteamIds;
              cfg.mutedSteamIds = cfg.mutedSteamIds.filter(function (x) { return x !== sid; });
              renderMutes();
              api('/config', { method: 'POST', body: cfg }).then(function (r) {
                if (!(r && r.ok)) {
                  cfg.mutedSteamIds = before; renderMutes();
                  var w = (r && (r.reason || r.error)) || T('pl.better-squads.nowhy', 'the manager did not say why');
                  toast(T('pl.better-squads.mute.unmutefailed', '{who} was NOT unmuted — {why}', { who: label, why: w }), 'err');
                }
              }).catch(function (err) {
                cfg.mutedSteamIds = before; renderMutes();
                toast(T('pl.better-squads.mute.unmutefailed', '{who} was NOT unmuted — {why}', { who: label, why: why(err) }), 'err');
              });
            } }, '×'),
          ]));
        });
      }
      renderMutes();
      var addMute = h('button', { class: 'secondary', onclick: function () {
        if (!window.SSA || !SSA.pickPlayer) { toast(T('pl.better-squads.toast.nopicker', 'Player picker unavailable')); return; }
        SSA.pickPlayer().then(function (p) {
          if (!p) return;
          var sid = String(p.steamId || p.SteamID || '');
          if (!sid || cfg.mutedSteamIds.indexOf(sid) >= 0) return;
          var label = p.name || sid;
          cfg.mutedSteamIds.push(sid); renderMutes();
          api('/config', { method: 'POST', body: cfg }).then(function (r) {
            if (!(r && r.ok)) {
              cfg.mutedSteamIds = cfg.mutedSteamIds.filter(function (x) { return x !== sid; }); renderMutes();
              var w = (r && (r.reason || r.error)) || T('pl.better-squads.nowhy', 'the manager did not say why');
              toast(T('pl.better-squads.mute.mutefailed', '{who} was NOT muted — {why}', { who: label, why: w }), 'err');
            }
          }).catch(function (err) {
            cfg.mutedSteamIds = cfg.mutedSteamIds.filter(function (x) { return x !== sid; }); renderMutes();
            toast(T('pl.better-squads.mute.mutefailed', '{who} was NOT muted — {why}', { who: label, why: why(err) }), 'err');
          });
        });
      } }, [icon('ban'), T('pl.better-squads.mute.add', 'Mute a player')]);
      wrap.appendChild(card(T('pl.better-squads.card.muted', 'Muted by an admin'), T('pl.better-squads.card.muted.sub', 'A muted player gets none of these messages; squadmates still do. They cannot undo it.'), [muteBox, h('div', { class: 'bs-actions' }, [addMute])]));

      // test + log -----------------------------------------------------------
      var testBtn = h('button', { class: 'secondary', onclick: function () {
        if (!window.SSA || !SSA.pickPlayer) { toast(T('pl.better-squads.toast.nopicker', 'Player picker unavailable')); return; }
        SSA.pickPlayer().then(function (p) {
          if (!p) return;
          api('/test', { method: 'POST', body: { steamId: String(p.steamId || p.SteamID || '') } }).then(function (r) {
            if (r && r.ok) toast(T('pl.better-squads.test.sent', 'Sent to {n} squad member(s)', { n: r.delivered }), 'ok');
            else if (r && r.error === 'not_in_squad') toast(T('pl.better-squads.test.notinsquad', 'That player is not in a squad'), 'err');
            else if (r && r.error === 'nobody_online') toast(T('pl.better-squads.test.nobodyonline', 'Nobody from that squad is online'), 'err');
            else if (r && r.error) toast(T('pl.better-squads.test.failedwhy', 'Test failed — {why}', { why: r.error }), 'err');
            else toast(T('pl.better-squads.test.failed', 'Test failed'), 'err');
          }).catch(function (err) {
            toast(T('pl.better-squads.test.failedwhy', 'Test failed — {why}', { why: why(err) }), 'err');
          });
        });
      } }, [icon('chat'), T('pl.better-squads.test.send', 'Send a test')]);
      var clearBtn = h('button', { class: 'secondary', onclick: function () {
        SSA.confirm(T('pl.better-squads.log.confirmclear', 'Clear the activity log?')).then(function (ok) {
          if (!ok) return;
          // The local list is cleared only after the backend confirms it — a refusal must never look
          // like a successful clear, since the log has already gone once the admin sees an empty table.
          api('/clear-log', { method: 'POST' }).then(function (r) {
            if (r && r.ok) { statusData.recent = []; if (logTable) logTable.refresh(); }
            else toast(T('pl.better-squads.log.clearfailed', 'The log was NOT cleared — {why}', { why: (r && (r.reason || r.error)) || T('pl.better-squads.nowhy', 'the manager did not say why') }), 'err');
          }).catch(function (err) {
            toast(T('pl.better-squads.log.clearfailed', 'The log was NOT cleared — {why}', { why: why(err) }), 'err');
          });
        });
      } }, [icon('close'), T('pl.better-squads.log.clear', 'Clear log')]);

      // rows as a getter, so refresh() always re-reads the latest poll result
      logTable = SSA.table({
        rows: function () { return statusData.recent || []; },
        empty: T('pl.better-squads.log.empty', 'Nothing sent yet. Messages appear here as they go out.'),
        columns: [
          { key: 'at', label: T('pl.better-squads.col.when', 'When'), sort: true, sortVal: function (r) { return r.at || 0; }, render: function (r) { return document.createTextNode(ago(r.at)); } },
          { key: 'kind', label: T('pl.better-squads.col.event', 'Event'), render: function (r) { return SSA.cell.tag(r.kind, 'ok'); } },
          { key: 'actor', label: T('pl.better-squads.col.player', 'Player'), render: function (r) { return document.createTextNode(r.actor || '—'); } },
          { key: 'text', label: T('pl.better-squads.col.message', 'Message'), render: function (r) { return document.createTextNode(r.text || ''); } },
          { key: 'recipients', label: T('pl.better-squads.col.sentto', 'Sent to'), render: function (r) { return document.createTextNode(String(r.recipients || 0)); } },
        ],
      });
      wrap.appendChild(card(T('pl.better-squads.card.activity', 'Activity'), T('pl.better-squads.card.activity.sub', 'The latest messages delivered. Per-reader messages show the first copy sent.'), [
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
        if (!wrap.isConnected) return;
        if (bsPollTimer) clearInterval(bsPollTimer);
        ownTimer = setInterval(function () { refreshStatus(true); }, 10000);
        bsPollTimer = ownTimer;
      }).catch(loadFailed);
    }
    load();
  }

  SSA.ready(function () {
    SSA.registerTab({ id: 'better-squads', label: 'Better Squads', icon: '#i-users', premium: true, render: editor });
  });
}());
