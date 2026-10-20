/* Better Squads — admin UI.
 *
 * Five screens, named in ONE map (`navLabels`): Alerts (the nine squad alerts, each with its own
 * switch and its line in every player language), Squads (every squad in the save, who is on, the
 * manager's squad score, a test per squad, and what players silenced for themselves), Commands (the
 * in-game command set and every reply), Activity (what the plugin did, for whom and how it ended,
 * with the live state beside it) and Settings (the master switch, delivery, every limit with its own
 * switch, the two live game reads and the admin mute list). Nothing is configured as JSON.
 *
 * Icons, tables and cells come from the manager's native SDK so this looks like part of the panel.
 * Talks only to its own backend under /api/plugin-host/better-squads. */
(function () {
  'use strict';
  // The panel's own translator. The English second argument is what renders when a reader's language
  // has no line for that key, so a screen with no locale data reads exactly as it does in English.
  var T = SSA.t;
  // The manager's own client, captured at the top of the script: `SSA.api` resolves the calling
  // plugin at call time, and every real call here is a poll tick, a click or a `.then`, where that
  // binding is gone. A failure arrives as a rejection the catch turns into a sentence (`why`), never
  // as an empty answer that reads as "there is nothing there".
  var api = SSA.apiClient();
  function why(err) { return SSA.apiError(err); }
  // An address for each screen (`#plugins/p/better-squads/<screen>`), so a screen can be linked,
  // opened in a new tab and reached with Back. Bound at call time, so it is asked here, at the top. A
  // manager without it still gets real links; it then opens the plugin's first screen.
  var ROUTE = (SSA.route && typeof SSA.route.client === 'function') ? SSA.route.client() : null;

  // Where the bridge's switches live, built from the PANEL's own keys, so the route is right in every
  // language and after a rename.
  function bridgeWhere() {
    return T('nav.plugins', 'Plugins') + ' → ' + T('plugins.viewInGame', 'SSA Bridge');
  }
  // Where the squad score is chosen: the manager's own Leaderboards settings, in the panel's words.
  function scoreWhere() {
    return T('nav.settings', 'Settings') + ' → ' + T('setthing.leaderboards', 'Leaderboards');
  }

  /* Every label-bearing table below is a FUNCTION rather than a constant: a plugin's locale data is
   * merged only once every plugin script has run, so a table built at the top of this file would be
   * English for ever. The value saved into the config is always the key beside the label. */

  /* THE FIVE SCREEN NAMES, IN ONE PLACE. The nav, the first-run note and every sentence that sends
   * an owner to a screen ("switch them on in Settings") read the same key, so a renamed screen
   * cannot leave a sentence pointing at a screen that is no longer called that. */
  var VIEWS = ['alerts', 'squads', 'commands', 'activity', 'settings'];
  function navLabels() {
    return {
      alerts: T('pl.better-squads.nav.alerts', 'Alerts'),
      squads: T('pl.better-squads.nav.squads', 'Squads'),
      commands: T('pl.better-squads.nav.commands', 'Commands'),
      activity: T('pl.better-squads.nav.activity', 'Activity'),
      settings: T('pl.better-squads.nav.settings', 'Settings'),
    };
  }
  var NAV_ICONS = { alerts: 'bolt', squads: 'users', commands: 'chat', activity: 'pulse', settings: 'sliders' };

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
  // Tokens measured FROM THE READER: using one makes the plugin render the line per recipient.
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
      ['causeDeath', T('pl.better-squads.event.causedeath.title', 'Died of a cause'),
        T('pl.better-squads.event.causedeath.when', 'A squadmate dies with no killer: the cold, a fall, bleeding, a trap'), ['{cause}']],
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
      '{cause}': T('pl.better-squads.token.cause', 'What they died of, empty when not known'),
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

  // [key, title, what it does]: the in-game subcommands.
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

  // Player-facing lines, grouped so the list does not read as one long wall.
  function textGroups() {
    return [
      [T('pl.better-squads.group.roster', 'Roster (the bare command)'), ['rosterHeader', 'rosterLine', 'rosterEmpty']],
      [T('pl.better-squads.group.rally', 'Rally & messages'), ['here', 'hereOk', 'msgLine', 'msgOk', 'msgUsage', 'nobodyOnline']],
      [T('pl.better-squads.group.baseinfo', 'Base & info'), ['base', 'baseNone', 'info', 'infoMotd']],
      [T('pl.better-squads.group.selfservice', 'Self-service switches'), ['mutedOn', 'mutedOff', 'muteUsage', 'muteSet', 'mutedNone']],
      [T('pl.better-squads.group.words', 'Words inside other lines'), ['squadNoName', 'unknownObject']],
      [T('pl.better-squads.group.other', 'Other'), ['help', 'notInSquad', 'testLine']],
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
      mutedNone: T('pl.better-squads.text.mutednone', 'Word for “nothing muted”'),
      squadNoName: T('pl.better-squads.text.squadnoname', 'Word for a squad with no name'),
      unknownObject: T('pl.better-squads.text.unknownobject', 'Raid: word for an unnamed object'),
      testLine: T('pl.better-squads.text.testline', 'Test message from this page'),
    };
  }

  /* What the Activity log shows for a kind: the event's or the command's own title from the tables
   * above, never the key the backend files it under (`squadJoin`, `here`, `msg`). */
  function kindLabel(kind) {
    var all = events().concat(subs());
    for (var i = 0; i < all.length; i++) if (all[i][0] === kind) return all[i][1];
    var other = {
      roster: T('pl.better-squads.kind.roster', 'Roster'),
      test: T('pl.better-squads.kind.test', 'Test message'),
      mute: T('pl.better-squads.kind.mute', 'Muted by an admin'),
      unmute: T('pl.better-squads.kind.unmute', 'Unmuted by an admin'),
      reset: T('pl.better-squads.kind.reset', 'Player’s own choice reset'),
    };
    return other[kind] || humanKey(kind);
  }
  function groupLabels() {
    return {
      alert: T('pl.better-squads.group.kind.alert', 'Alert'),
      command: T('pl.better-squads.group.kind.command', 'Command'),
      admin: T('pl.better-squads.group.kind.admin', 'Admin'),
    };
  }
  /** Which group a log row belongs to. A row an older version wrote carries none: it was an alert
   * that was sent, or a rally or message a player sent, which is all that version recorded. */
  function groupOf(r) {
    if (r && r.group) return r.group;
    return events().some(function (e) { return e[0] === r.kind; }) ? 'alert' : 'command';
  }
  function resultLabels() {
    return {
      sent: [T('pl.better-squads.result.sent', 'Delivered'), 'ok'],
      partial: [T('pl.better-squads.result.partial', 'Partly delivered'), 'warn'],
      failed: [T('pl.better-squads.result.failed', 'Reached nobody'), 'bad'],
      held: [T('pl.better-squads.result.held', 'Held back'), 'warn'],
      refused: [T('pl.better-squads.result.refused', 'Refused'), 'warn'],
      done: [T('pl.better-squads.result.done', 'Done'), 'ok'],
    };
  }
  /** Why a row ended the way it did, in words. An unknown code is shown made readable, never raw. */
  function whyLabel(code) {
    var w = {
      quiet: T('pl.better-squads.why.quiet', 'quiet hours'),
      cooldown: T('pl.better-squads.why.cooldown', 'cooldown'),
      rate: T('pl.better-squads.why.rate', 'messages per minute ceiling'),
      reached_nobody: T('pl.better-squads.why.reachednobody', 'nobody received it'),
      send_error: T('pl.better-squads.why.senderror', 'the line could not be sent'),
      send_failed: T('pl.better-squads.why.senderror', 'the line could not be sent'),
      squad_unknown: T('pl.better-squads.why.squadunknown', 'the squad list could not be read'),
      not_in_squad: T('pl.better-squads.why.notinsquad', 'not in a squad'),
      nobody_online: T('pl.better-squads.why.nobodyonline', 'nobody from the squad online'),
      all_muted: T('pl.better-squads.why.allmuted', 'everyone online is muted by an admin'),
      no_base: T('pl.better-squads.why.nobase', 'no base found'),
      usage: T('pl.better-squads.why.usage', 'typed without what it needs'),
      error: T('pl.better-squads.why.error', 'something failed, see the manager log'),
      no_player: T('pl.better-squads.why.noplayer', 'no player was named'),
    };
    if (!code) return '';
    return w[code] || humanKey(code).toLowerCase();
  }

  // ── helpers ─────────────────────────────────────────────────────────────────
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
  function toast(m, k) { if (window.SSA && SSA.toast) SSA.toast(m, k); }
  function nowhy() { return T('pl.better-squads.nowhy', 'the manager did not say why'); }
  /** A route that answered without `ok` is a refusal too, and it may have said why. */
  function refusal(r) { return (r && (r.reason || (r.error && humanKey(r.error).toLowerCase()))) || nowhy(); }
  function card(title, sub, kids, extra) {
    var head = [h('div', { class: 'bs-card-h' }, [h('h3', { class: 'bs-card-t' }, title)].concat(extra || []))];
    if (sub) head.push(h('p', { class: 'bs-card-sub' }, sub));
    return h('div', { class: 'card bs-card' }, head.concat(kids || []));
  }
  function field(label, ctl, hint) { return h('label', { class: 'bs-f' }, [h('span', {}, label), ctl, hint ? h('small', { class: 'bs-hint' }, hint) : null]); }
  /**
   * The house switch: a real checkbox with `role="switch"`, its title as its label, so the whole row
   * is the click target and a screen reader says "on" or "off". `get` is read once; `set` gets the
   * new state on every change.
   */
  function switchCtl(get, set, label, opts) {
    opts = opts || {};
    var i = h('input', { type: 'checkbox', role: 'switch', checked: !!get(), onchange: function () { set(i.checked); } });
    i.checked = !!get();
    return h('label', { class: 'bs-sw' + (opts.cls ? ' ' + opts.cls : '') }, [i, h('span', { class: 'bs-sw-track', 'aria-hidden': 'true' }), label ? h('span', { class: 'bs-sw-l' }, label) : null]);
  }
  /** A number box where an emptied box means "the default", never 0. */
  function numBox(get, set, min, max) {
    var v = get();
    var i = h('input', { type: 'number', min: min, max: max, step: 1, inputmode: 'numeric', value: v == null ? '' : v });
    i.addEventListener('input', function () { set(i.value === '' ? '' : Number(i.value)); });
    return i;
  }
  /** A clock time in the reader's language: stable markup, so a poll does not redraw every row. */
  function when(ms) {
    if (!ms) return '—';
    var d = new Date(ms), today = new Date();
    var lang = (SSA.lang && SSA.lang()) || undefined;
    try {
      if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString(lang);
      return d.toLocaleString(lang);
    } catch (e) { return d.toISOString().replace('T', ' ').slice(0, 19); }
  }
  function agoS(ms) {
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return T('pl.better-squads.ago.seconds', '{n}s ago', { n: s });
    if (s < 3600) return T('pl.better-squads.ago.minutes', '{n}m ago', { n: Math.floor(s / 60) });
    if (s < 86400) return T('pl.better-squads.ago.hours', '{n}h ago', { n: Math.floor(s / 3600) });
    return T('pl.better-squads.ago.days', '{n}d ago', { n: Math.floor(s / 86400) });
  }

  // ── the address of each screen ──────────────────────────────────────────────
  /** The screen an address names: '' and anything this page cannot draw are the first screen. */
  function viewOfRoute(sub) {
    var p = String(sub || '').split('/')[0];
    return VIEWS.indexOf(p) > 0 ? p : 'alerts';
  }
  function routeOfView(v) { return v === 'alerts' ? '' : v; }
  function routeHref(sub) {
    return ROUTE ? ROUTE.href(sub) : '#plugins/p/better-squads' + (sub ? '/' + sub : '');
  }
  /**
   * A REAL LINK whose plain left click is handled here and whose every other click is the
   * browser's: a middle click, a ctrl/cmd/shift click and "open in new tab" are the reader asking for
   * a second window, and nothing but an unmodified primary click is ever prevented.
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

  // ── the language editor for one text ────────────────────────────────────────
  // The tokens each reply can carry, read off what the backend fills for that line.
  var REPLY_TOKENS = {
    rosterHeader: ['{squad}', '{squadonline}', '{squadsize}'],
    rosterLine: ['{player}', '{sector}', '{distance}', '{direction}', '{squad}', '{squadonline}', '{squadsize}'],
    rosterEmpty: ['{squad}', '{squadonline}', '{squadsize}'],
    help: ['{root}', '{list}'],
    mutedOn: ['{root}', '{on}'],
    muteUsage: ['{root}', '{mute}', '{events}', '{muted}'],
    muteSet: ['{muted}'],
    muteUnknown: ['{unknown}', '{events}'],
    here: ['{player}', '{sector}', '{squad}'],
    msgUsage: ['{root}', '{msg}'],
    msgLine: ['{player}', '{text}', '{squad}'],
    msgOk: ['{count}'],
    base: ['{sector}', '{distance}', '{direction}', '{name}'],
    info: ['{squad}', '{squadonline}', '{squadsize}', '{score}'],
    infoMotd: ['{motd}', '{squad}', '{squadonline}', '{squadsize}', '{score}'],
    testLine: ['{squad}'],
  };
  // The shipped line of every text in every player language (`/text-defaults`), keyed like the
  // backend's slots (`events.join`, `texts.help`), so each language tab shows what its readers get
  // while nobody has written one, and "Reset to default" brings it back. The config keeps storing the
  // shipped ENGLISH line for "built-in", which is what the backend recognises; a box left empty is
  // drawn empty and sends nothing, exactly as before.
  var shippedTexts = null;
  function shippedFor(slot) {
    if (!shippedTexts || !shippedTexts.byLang) return undefined;
    var out = {};
    Object.keys(shippedTexts.byLang).forEach(function (l) {
      var t = shippedTexts.byLang[l] && shippedTexts.byLang[l][slot];
      if (typeof t === 'string' && t) out[l] = t;
    });
    return Object.keys(out).length ? out : undefined;
  }
  // What a blank editor means for the stored text. The SDK reports both "this box reads its built-in
  // line" and "the owner emptied this box" as a blank; only the second is the owner's blank, which
  // this plugin has always treated as silence. The active tab and its box tell the two apart.
  function builtinOrBlank(edEl, value, en) {
    if (String(value || '').trim()) return value;
    var act = edEl && edEl.querySelector('.ssa-lt-tab.is-active');
    var ta = edEl && edEl.querySelector('textarea');
    return (act && act.querySelector('.ssa-lt-def') && ta && !ta.value.trim()) ? '' : en;
  }
  function locEditor(holder, key, label, tokens, slot, onDirty) {
    var help = tokenHelp();
    var en = slot && shippedTexts && shippedTexts.english ? shippedTexts.english[slot] : undefined;
    if (typeof SSA.locText !== 'function') {
      // A manager without the language editor: one plain box, which is what that manager always drew.
      var ta = h('textarea', { rows: 2, class: 'bs-plain', oninput: function () { holder[key] = ta.value; onDirty(); } });
      ta.value = holder[key] == null ? '' : holder[key];
      return h('label', { class: 'bs-f' }, [label ? h('span', {}, label) : null, ta,
        h('small', { class: 'bs-hint' }, (tokens || []).join(' '))]);
    }
    var defs = en && String(holder[key] || '').trim() ? shippedFor(slot) : undefined;
    var ed = SSA.locText({
      label: label, value: defs && holder[key] === en ? '' : holder[key], i18n: holder[key + 'I18n'] || {}, rows: 3,
      defaults: defs,
      // A reader-relative token is filled per reader, which is the SDK's own dashed "player" chip; the
      // chip's hover says so, so the label stays the token's name.
      tokens: (tokens || []).map(function (t) {
        var rel = RELATIVE.indexOf(t) >= 0;
        return { token: t, label: help[t] || t, kind: rel ? 'player' : undefined,
          title: rel ? (help[t] || t) + T('pl.better-squads.token.relative.note', ' — sent individually to each reader') : (help[t] || t) };
      }),
      onChange: function (value, i18n) {
        holder[key] = defs ? builtinOrBlank(ed && ed.el, value, en) : value; holder[key + 'I18n'] = i18n;
        onDirty();
      },
    });
    return ed.el;
  }

  // ── the tab ─────────────────────────────────────────────────────────────────
  // One poll timer for the whole page: a new mount stops the last one's.
  var bsPollTimer = null;

  function editor(root) {
    root.innerHTML = '';
    var st = {
      view: viewOfRoute(ROUTE ? ROUTE.get() : ''),
      cfg: null,
      status: { stats: {}, recent: [], now: null },
      players: [],
      squads: null,             // null until the first answer; { readable, squads }
      squadsErr: null,
      pollErr: null,
      dirty: false,
      pickSquad: {},            // squad id -> true, the ticks on the Squads table
      pickSilenced: {},         // steam id -> true, the ticks on the silenced table
      pickMuted: {},            // steam id -> true, the ticks on the admin-mute table
      logGroup: '', logResult: '', squadFilter: '',
    };
    var tables = {};            // the live tables on the screen now, refreshed by the poll

    var wrap = h('div', { class: 'bs-body' });
    root.appendChild(wrap);
    wrap.appendChild(h('div', { class: 'bs-loading' }, T('pl.better-squads.loading', 'Loading…')));

    // Where a failure goes when the tab itself could not load: a sentence and a retry, never a page
    // that sits on "Loading…" for ever.
    function loadFailed(err) {
      wrap.innerHTML = '';
      var retry = h('button', { type: 'button', class: 'secondary', onclick: function () { wrap.innerHTML = ''; wrap.appendChild(h('div', { class: 'bs-loading' }, T('pl.better-squads.loading', 'Loading…'))); load(); } }, T('pl.better-squads.err.retry', 'Try again'));
      wrap.appendChild(h('div', { class: 'bs-err' }, [
        h('strong', {}, T('pl.better-squads.err.loadfailed', 'This tab could not load its settings. ')),
        h('span', {}, why(err)),
        h('div', { class: 'bs-err-act' }, [retry]),
      ]));
    }

    // ── the frame: lead, first-run note, nav + save, stat header ─────────────
    var navEl = h('nav', { class: 'bs-nav', 'aria-label': T('pl.better-squads.nav.label', 'Better Squads sections') });
    var statusMsg = h('span', { class: 'bs-savemsg', 'aria-live': 'polite' });
    var saveBtn = h('button', { class: 'primary', onclick: save }, [icon('check'), T('pl.better-squads.save', 'Save')]);
    var masterHolder = h('span', { class: 'bs-master' });
    var firstRun = h('div', { class: 'bs-firstrun' });
    var statBar = h('div', { class: 'bs-stats' });
    var body = h('div', { class: 'bs-view' });

    function markDirty() {
      st.dirty = true;
      saveBtn.classList.add('bs-unsaved');
      statusMsg.textContent = T('pl.better-squads.unsaved', 'Unsaved changes');
    }

    function paintNav() {
      navEl.innerHTML = '';
      var L = navLabels();
      VIEWS.forEach(function (v) {
        var on = st.view === v;
        navEl.appendChild(navLink(routeOfView(v), { class: 'bs-tab' + (on ? ' active' : ''), 'aria-current': on ? 'page' : null },
          [icon(NAV_ICONS[v]), h('span', {}, L[v])], function () { go(v); }));
      });
    }
    function go(v, replace) {
      if (VIEWS.indexOf(v) < 0) v = 'alerts';
      st.view = v;
      paintNav(); renderView();
      if (ROUTE) ROUTE.go(routeOfView(v), { replace: !!replace });
      refreshLive(false);
    }
    if (ROUTE) ROUTE.onChange(function (sub) { var v = viewOfRoute(sub); if (v !== st.view && wrap.isConnected) { st.view = v; paintNav(); renderView(); refreshLive(false); } });

    // The master switch posts at once, and ONLY itself: it used to post the whole page, which also
    // saved every unsaved edit on every screen without saying so. A refusal puts the switch back.
    function paintMaster() {
      masterHolder.innerHTML = '';
      masterHolder.appendChild(switchCtl(function () { return st.cfg.enabled; }, function (v) {
        var prev = st.cfg.enabled;
        st.cfg.enabled = v; renderStat();
        api('/config', { method: 'POST', body: { enabled: v } }).then(function (r) {
          if (r && r.ok) { refreshLive(true); return; }
          st.cfg.enabled = prev; paintMaster(); renderStat();
          toast(masterFailed(v, refusal(r)), 'err');
        }).catch(function (err) {
          st.cfg.enabled = prev; paintMaster(); renderStat();
          toast(masterFailed(v, why(err)), 'err');
        });
      }, T('pl.better-squads.master.label', 'Plugin on'), { cls: 'bs-sw-master' }));
    }
    /* The master switch refusing, as one sentence per direction rather than a word glued into the
     * middle of another: which way round "on"/"off" reads is a language's own business. */
    function masterFailed(on, w) {
      return on ? T('pl.better-squads.master.noton', 'NOT turned on — {why}', { why: w })
        : T('pl.better-squads.master.notoff', 'NOT turned off — {why}', { why: w });
    }

    // The first-run note names the screens worth visiting first, by their nav names. It shows only
    // while the plugin has done nothing yet: no line sent, no command run, nothing in the log.
    function renderFirstRun() {
      firstRun.innerHTML = '';
      var s = st.status.stats || {};
      if ((s.sent || 0) + (s.commands || 0) + (s.failed || 0) > 0 || (st.status.recent || []).length) return;
      var L = navLabels();
      firstRun.appendChild(h('div', { class: 'bs-note-off' }, [
        h('b', {}, T('pl.better-squads.first.title', 'New here? Three screens to start with.')),
        T('pl.better-squads.first.on', ' On '), h('b', {}, L.alerts),
        T('pl.better-squads.first.alerts.v2', ' you pick what squads are told and word each line. On '),
        h('b', {}, L.commands),
        T('pl.better-squads.first.commands.v2', ' you name the commands players type. Then send a test from '),
        h('b', {}, L.squads), '.',
      ]));
    }

    // ── the stat header ───────────────────────────────────────────────────────
    // Built off the page and swapped in only when it reads differently, so a poll that changed
    // nothing leaves the header, its focus and its hover exactly where they were.
    function statBadge(val, label, cls) { return h('div', { class: 'bs-stat' + (cls ? ' ' + cls : '') }, [h('span', { class: 'bs-stat-v' }, String(val == null ? '—' : val)), h('span', { class: 'bs-stat-l' }, label)]); }
    function buildStat() {
      var box = h('div', { class: 'bs-stats' });
      var s = st.status.stats || {};
      var c = st.cfg;
      var on = !!c.enabled;
      var alertsOn = events().filter(function (e) { return c.events[e[0]] && c.events[e[0]].enabled; }).length;
      box.appendChild(h('div', { class: 'bs-stat bs-stat-dotted ' + (on ? 'ok' : 'off') }, [h('span', { class: 'bs-stat-dot' }),
        h('span', { class: 'bs-stat-l' }, on ? T('pl.better-squads.stat.on', 'Plugin on') : T('pl.better-squads.stat.off', 'Plugin off'))]));
      box.appendChild(statBadge(T('pl.better-squads.stat.alertsof', '{n} of {total}', { n: alertsOn, total: events().length }), T('pl.better-squads.stat.alerts', 'Alerts on')));
      box.appendChild(statBadge(c.commands.enabled ? T('pl.better-squads.stat.yes', 'On') : T('pl.better-squads.stat.no', 'Off'), T('pl.better-squads.stat.commandson', 'Commands')));
      box.appendChild(statBadge(st.status.online, T('pl.better-squads.stat.online', 'Online')));
      box.appendChild(statBadge(st.status.activeSquads, T('pl.better-squads.stat.activesquads', 'Squads with 2+ online')));
      box.appendChild(statBadge(s.sent || 0, T('pl.better-squads.stat.sent', 'Messages sent')));
      // "Reached nobody" is its own number: the plugin tried and the squad got nothing. Held back
      // is the plugin choosing not to send (quiet hours, cooldown, the ceiling).
      box.appendChild(statBadge(s.failed || 0, T('pl.better-squads.stat.failed', 'Reached nobody'), (s.failed || 0) > 0 ? 'bad' : null));
      box.appendChild(statBadge(s.suppressed || 0, T('pl.better-squads.stat.held', 'Held back')));
      box.appendChild(statBadge(s.commands || 0, T('pl.better-squads.stat.commands', 'Commands run')));
      // Every number above is a photograph of a running world. With the server stopped they are a
      // truthful 0, and every setting on every screen can be written now.
      if (st.status.serverRunning === false) {
        box.appendChild(h('div', { class: 'bs-note-off' }, [
          h('b', {}, T('pl.better-squads.note.serveroff', 'The server is not running.')),
          T('pl.better-squads.note.serveroff.v2', ' Every setting here can be written now. Counters, squads and the log wait for a running game.'),
        ]));
      }
      if (st.pollErr) {
        box.appendChild(h('div', { class: 'bs-live-err' }, [
          h('b', {}, T('pl.better-squads.live.stopped', 'The live figures have stopped updating.')),
          T('pl.better-squads.live.stopped.v2', ' {err} The settings on this page are unaffected and still save.', { err: st.pollErr }),
        ]));
      }
      if (st.status.geography === false) {
        box.appendChild(h('div', { class: 'bs-warn' }, [
          icon('alert'), T('pl.better-squads.warn.nogeography', ' Map calibration unavailable — {sector} and {direction} render empty.'),
        ]));
      }
      // A live read that could not run: the plugin answers from the last save meanwhile, and an
      // owner who is not told cannot tell that apart from everything working.
      var live = st.status.live || {};
      [['players', function (note) { return T('pl.better-squads.warn.savedplayers', ' Squadmate positions are coming from the last save, not the running game: {note}.', { note: note }); }],
        ['squads', function (note) { return T('pl.better-squads.warn.savedsquads', ' Squad membership is coming from the last save, not the running game: {note}.', { note: note }); }],
      ].forEach(function (row) {
        var note = liveNoteText(live[row[0]]);
        if (note) box.appendChild(h('div', { class: 'bs-warn' }, [icon('alert'), row[1](note)]));
      });
      return box;
    }
    /** One live read's note in words, or '' when it answered. Translated per CODE. */
    function liveNoteText(n) {
      if (!n || !n.code) return '';
      if (n.code === 'module_off' && n.switch) {
        return T('pl.better-squads.live.turnOnBoth', 'turn on "{enable}" and "{switch}" on the {module} card in {where}',
          { enable: n.enable || '', switch: n.switch, module: n.module || '', where: bridgeWhere() });
      }
      if (n.code === 'refused') return n.reason || n.text || '';
      if (n.code === 'no_module') return T('pl.better-squads.live.nomodule', 'this server runs an older SSA Bridge that does not have this module');
      return T('pl.better-squads.live.noanswer', 'the SSA Bridge did not answer');
    }
    function renderStat() {
      if (!st.cfg) return;
      var next = buildStat();
      if (next.innerHTML !== statBar.innerHTML) { statBar.innerHTML = ''; while (next.firstChild) statBar.appendChild(next.firstChild); }
      renderFirstRun();
    }

    // ── saving ─────────────────────────────────────────────────────────────────
    // One Save for every screen, with the sentence beside it for as long as it is true: a toast is
    // gone in four seconds while the owner's unsaved edits are still in front of them.
    function save() {
      statusMsg.textContent = T('pl.better-squads.save.saving', 'Saving…'); saveBtn.disabled = true;
      api('/config', { method: 'POST', body: st.cfg }).then(function (r) {
        saveBtn.disabled = false;
        if (!(r && r.ok)) {
          var line = T('pl.better-squads.save.failed', 'NOT saved — {why}', { why: refusal(r) });
          statusMsg.textContent = line; toast(line, 'err');
          return;
        }
        st.dirty = false; saveBtn.classList.remove('bs-unsaved');
        statusMsg.textContent = T('pl.better-squads.save.saved', 'Saved ✓'); toast(T('pl.better-squads.toast.saved', 'Saved'), 'ok');
        setTimeout(function () { if (!st.dirty) statusMsg.textContent = ''; }, 2500);
        // What the backend stored, which it may have tidied (a name cut to 16 letters, a number put
        // back inside its range), so the screen shows what will really happen.
        api('/config').then(function (c) { st.cfg = normal(c); paintMaster(); renderStat(); if (st.view !== 'alerts' && st.view !== 'commands') renderView(); }).catch(function () { /* the save itself landed */ });
      }).catch(function (err) {
        saveBtn.disabled = false;
        var line = T('pl.better-squads.save.failed', 'NOT saved — {why}', { why: why(err) });
        statusMsg.textContent = line; toast(line, 'err');
      });
    }
    /**
     * A one-key save that happens at once (a mute, an unmute), and ONLY that key: the rest of the
     * page may hold edits the owner has not asked to save yet.
     */
    function saveMutes(next, undo, failLine) {
      return api('/config', { method: 'POST', body: { mutedSteamIds: next } }).then(function (r) {
        if (r && r.ok) { st.cfg.mutedSteamIds = next; return true; }
        undo(); toast(failLine(refusal(r)), 'err'); return false;
      }).catch(function (err) { undo(); toast(failLine(why(err)), 'err'); return false; });
    }

    // ── screen: Alerts ─────────────────────────────────────────────────────────
    function alertsView() {
      var c = st.cfg;
      var evRows = events().map(function (def) {
        var key = def[0];
        var ev = c.events[key] || (c.events[key] = { enabled: false, message: '' });
        var head = h('div', { class: 'bs-ev-head' }, [
          switchCtl(function () { return ev.enabled; }, function (v) { ev.enabled = v; markDirty(); renderStat(); }, def[1]),
          h('small', { class: 'bs-ev-sub' }, def[2]),
        ]);
        return h('div', { class: 'bs-ev', 'data-ev': key }, [head, locEditor(ev, 'message', null, COMMON.concat(def[3]).concat(RELATIVE), 'events.' + key, markDirty)]);
      });
      var evNote = h('p', { class: 'bs-note' }, [
        h('b', {}, T('pl.better-squads.note.brackets', 'Square brackets mark an optional part.')),
        T('pl.better-squads.note.brackets.body', ' Anything inside [ ] disappears if a token in it has no value — so '),
        h('code', {}, '{player} died[ in {sector}].'),
        T('pl.better-squads.note.brackets.example', ' reads “Petr died in B3.” normally and “Petr died.” when the position is unknown.'),
      ]);
      var eventDeaths = h('div', { class: 'bs-ev' }, [h('div', { class: 'bs-ev-head' }, [
        switchCtl(function () { return c.eventDeaths === true; }, function (v) { c.eventDeaths = v; markDirty(); }, T('pl.better-squads.event.eventdeaths.title', 'Deaths in game events')),
        h('small', { class: 'bs-ev-sub' }, T('pl.better-squads.event.eventdeaths.when', 'Also announce deaths inside a game event, with the lines above')),
      ])]);
      return [card(T('pl.better-squads.card.events', 'Events'),
        T('pl.better-squads.card.events.sub.v2', 'What gets announced and how. Dashed tokens depend on the reader, so those lines go to each reader separately.'),
        [evNote].concat(evRows).concat([eventDeaths]))];
    }

    // ── screen: Squads ─────────────────────────────────────────────────────────
    function squadRows() {
      var list = (st.squads && st.squads.squads) || [];
      var f = st.squadFilter;
      return list.filter(function (s) { return !f || (f === 'online' ? s.online > 0 : s.online > 1); });
    }
    /** The ticked squads AT THE PRESS: what the ticks say now, among the squads the list still has. */
    function tickedSquads() {
      return ((st.squads && st.squads.squads) || []).filter(function (s) { return st.pickSquad[String(s.id)]; });
    }
    function testSquad(sq) {
      // Any member names the squad; the backend reads its roster the way an alert would.
      var m = sq.members[0];
      if (!m) return Promise.resolve({ ok: false, error: 'nobody_online' });
      return api('/test', { method: 'POST', body: { steamId: m.steamId } }).catch(function (err) { return { ok: false, error: 'send_failed', reason: why(err) }; });
    }
    function testToast(r) {
      if (r && r.ok) {
        toast(r.delivered === 1 ? T('pl.better-squads.test.sent.one', 'Sent to {n} squad member', { n: r.delivered }) : T('pl.better-squads.test.sent', 'Sent to {n} squad members', { n: r.delivered }), 'ok');
        return;
      }
      var code = r && r.error;
      var words = {
        not_in_squad: T('pl.better-squads.test.notinsquad', 'That player is not in a squad'),
        squad_unknown: T('pl.better-squads.test.squadunknown', 'The squad list cannot be read right now. Try again in a minute.'),
        nobody_online: T('pl.better-squads.test.nobodyonline', 'Nobody from that squad is online'),
        all_muted: T('pl.better-squads.test.allmuted', 'Everyone online in that squad is muted by an admin'),
        reached_nobody: T('pl.better-squads.test.reachednobody', 'The test was sent but reached nobody'),
      };
      if (words[code]) { toast(words[code], 'err'); return; }
      // Never a raw code: the route's own sentence, else the code made readable.
      toast(T('pl.better-squads.test.failedwhy', 'Test failed — {why}', { why: (r && r.reason) || whyLabel(code || 'error') }), 'err');
    }
    function squadsView() {
      var out = [];
      var L = navLabels();
      var readable = st.squads ? st.squads.readable !== false : true;
      var bulkCount = h('span', { class: 'bs-bulk-n' });
      function paintBulk() {
        var n = tickedSquads().length;
        bulkCount.textContent = n ? T('pl.better-squads.bulk.ticked', '{n} ticked', { n: n }) : T('pl.better-squads.bulk.none', 'Tick squads to act on several at once.');
      }
      var filterSel = h('select', { class: 'bs-sel', 'aria-label': T('pl.better-squads.squads.filter', 'Show'), onchange: function () { st.squadFilter = filterSel.value; if (tables.squads) tables.squads.refresh(); } },
        [['', T('pl.better-squads.squads.filter.all', 'All squads')], ['online', T('pl.better-squads.squads.filter.online', 'Someone online')], ['two', T('pl.better-squads.squads.filter.multi', '2+ online')]]
          .map(function (o) { return h('option', { value: o[0], selected: st.squadFilter === o[0] }, o[1]); }));
      tables.squads = SSA.table({
        rows: squadRows,
        pageSize: 25,
        search: function (s) { return [s.name].concat(s.members.map(function (m) { return m.name; })).join(' '); },
        searchPlaceholder: T('pl.better-squads.squads.search', 'Search squads or players…'),
        sort: { key: 'online', dir: 'desc' },
        toolbar: [filterSel],
        empty: function () {
          if (!st.squads) return st.squadsErr ? T('pl.better-squads.squads.failed', 'The squad list could not be fetched: {why}', { why: st.squadsErr }) : T('pl.better-squads.loading', 'Loading…');
          if (!readable) return T('pl.better-squads.squads.unreadable', 'Squads come from the game’s save, which cannot be read now. The list fills once the server has run.');
          if (st.squadFilter) return T('pl.better-squads.squads.nofilter', 'No squad matches this filter.');
          return T('pl.better-squads.squads.empty', 'There are no squads in the save yet. They appear here as players form them.');
        },
        columns: [
          { key: 'pick', label: '', thClass: 'bs-col-pick', tdClass: 'bs-col-pick', render: function (s) {
            var id = String(s.id);
            var cb = h('input', { type: 'checkbox', checked: !!st.pickSquad[id], 'aria-label': T('pl.better-squads.bulk.tick', 'Tick {name}', { name: s.name || T('pl.better-squads.squads.noname', 'Unnamed squad') }),
              onchange: function () { if (cb.checked) st.pickSquad[id] = true; else delete st.pickSquad[id]; paintBulk(); } });
            return h('label', { class: 'bs-pick' }, [cb]);
          } },
          { key: 'name', label: T('pl.better-squads.col.squad', 'Squad'), sort: true, sortVal: function (s) { return String(s.name || '').toLowerCase(); },
            render: function (s) { return h('b', {}, s.name || T('pl.better-squads.squads.noname', 'Unnamed squad')); } },
          { key: 'online', label: T('pl.better-squads.col.online', 'Online'), sort: true, sortVal: function (s) { return s.online * 1000 + s.size; },
            render: function (s) { return h('span', { class: s.online > 1 ? 'bs-on' : '' }, T('pl.better-squads.squads.onlineof', '{n} of {size}', { n: s.online, size: s.size })); } },
          { key: 'score', label: T('pl.better-squads.col.score', 'Score'), sort: true, sortVal: function (s) { return s.score == null ? -1e12 : s.score; },
            render: function (s) { return document.createTextNode(s.score == null ? '—' : String(s.score)); } },
          { key: 'members', label: T('pl.better-squads.col.members', 'Members'), render: function (s) {
            var box = h('span', { class: 'bs-members' });
            var shown = s.members.slice().sort(function (a, b) { return (b.online ? 1 : 0) - (a.online ? 1 : 0); }).slice(0, 8);
            shown.forEach(function (m) {
              box.appendChild(h('span', { class: 'bs-mem' + (m.online ? ' on' : '') + (m.muted ? ' muted' : ''), title: m.muted ? T('pl.better-squads.squads.mutedtag', 'muted by an admin') : null },
                [m.name || m.steamId, m.muted ? h('span', { class: 'bs-off-tag' }, T('pl.better-squads.tag.muted', 'muted')) : null]));
            });
            if (s.members.length > shown.length) box.appendChild(h('span', { class: 'bs-mem more' }, T('pl.better-squads.squads.more', '+{n} more', { n: s.members.length - shown.length })));
            return box;
          } },
          { key: 'act', label: '', render: function (s) {
            return h('button', { class: 'secondary', disabled: s.online < 1 ? true : null, title: s.online < 1 ? T('pl.better-squads.test.nobodyonline', 'Nobody from that squad is online') : null,
              onclick: function () { testSquad(s).then(function (r) { testToast(r); refreshLive(true); }); } }, [icon('chat'), T('pl.better-squads.test.short', 'Test')]);
          } },
        ],
      });
      var tickShown = h('button', { class: 'secondary', onclick: function () {
        var q = String((tables.squads.search && tables.squads.search.value) || '').trim().toLowerCase();
        squadRows().forEach(function (s) {
          var hay = [s.name].concat(s.members.map(function (m) { return m.name; })).join(' ').toLowerCase();
          if (!q || hay.indexOf(q) >= 0) st.pickSquad[String(s.id)] = true;
        });
        tables.squads.refresh(); paintBulk();
      } }, T('pl.better-squads.bulk.tickshown', 'Tick all shown'));
      var untick = h('button', { class: 'secondary', onclick: function () { st.pickSquad = {}; tables.squads.refresh(); paintBulk(); } }, T('pl.better-squads.bulk.untick', 'Untick all'));
      var bulkTest = h('button', { class: 'secondary', 'data-act': 'test', onclick: function () {
        var picked = tickedSquads().filter(function (s) { return s.online > 0; });
        if (!picked.length) { toast(T('pl.better-squads.bulk.noneonline', 'None of the ticked squads has anyone online.'), 'err'); return; }
        var ok = 0, bad = 0;
        // One after another, so a hundred squads are a hundred calls in turn, never a hundred at once.
        picked.reduce(function (p, s) { return p.then(function () { return testSquad(s).then(function (r) { if (r && r.ok) ok++; else bad++; }); }); }, Promise.resolve())
          .then(function () {
            toast(bad ? T('pl.better-squads.bulk.tested', 'Test sent to {ok} squads. {bad} could not be reached.', { ok: ok, bad: bad })
              : T('pl.better-squads.bulk.testedall', 'Test sent to {ok} squads.', { ok: ok }), bad ? 'err' : 'ok');
            refreshLive(true);
          });
      } }, T('pl.better-squads.bulk.test', 'Send a test'));
      function bulkMute(on) {
        var ids = [];
        tickedSquads().forEach(function (s) { s.members.forEach(function (m) { ids.push(m.steamId); }); });
        if (!ids.length) { toast(T('pl.better-squads.bulk.pickfirst', 'Tick at least one squad first.'), 'err'); return; }
        var before = (st.cfg.mutedSteamIds || []).slice();
        var set = {}; before.forEach(function (x) { set[x] = 1; });
        ids.forEach(function (x) { if (on) set[x] = 1; else delete set[x]; });
        var next = Object.keys(set);
        saveMutes(next, function () { st.cfg.mutedSteamIds = before; }, function (w) {
          return on ? T('pl.better-squads.bulk.mutefailed', 'The members were NOT muted — {why}', { why: w }) : T('pl.better-squads.bulk.unmutefailed', 'The members were NOT unmuted — {why}', { why: w });
        }).then(function (done) {
          if (!done) return;
          toast(on ? T('pl.better-squads.bulk.muted', '{n} players muted.', { n: ids.length }) : T('pl.better-squads.bulk.unmuted', '{n} players unmuted.', { n: ids.length }), 'ok');
          refreshLive(true);
        });
      }
      var bulkMuteBtn = h('button', { class: 'secondary', 'data-act': 'mute', onclick: function () { bulkMute(true); } }, T('pl.better-squads.bulk.mute', 'Mute their members'));
      var bulkUnmuteBtn = h('button', { class: 'secondary', 'data-act': 'unmute', onclick: function () { bulkMute(false); } }, T('pl.better-squads.bulk.unmute', 'Unmute their members'));
      paintBulk();
      out.push(card(L.squads, T('pl.better-squads.card.squads.sub', 'Every squad in the save, who is online now, and a test line for each.'), [
        h('p', { class: 'bs-note' }, T('pl.better-squads.squads.score', 'Score is the manager’s squad score. Choose what counts in {where}.', { where: scoreWhere() })),
        h('div', { class: 'bs-bulk' }, [bulkCount, tickShown, untick, bulkTest, bulkMuteBtn, bulkUnmuteBtn]),
        tables.squads.el,
      ]));

      // What players silenced for themselves, online or not: their setting keeps working while they
      // are away, and the person asking for a reset is usually asking on Discord.
      var silCount = h('span', { class: 'bs-bulk-n' });
      function silencedRows() { return st.players.filter(function (p) { return p.off || (p.muted && p.muted.length); }); }
      function paintSil() {
        var n = silencedRows().filter(function (p) { return st.pickSilenced[p.steamId]; }).length;
        silCount.textContent = n ? T('pl.better-squads.bulk.ticked', '{n} ticked', { n: n }) : '';
      }
      function resetPrefs(ids, label) {
        return api('/prefs/reset', { method: 'POST', body: { steamIds: ids } }).then(function (res) {
          if (res && res.ok) { toast(T('pl.better-squads.prefs.resetn', 'Reset for {n} players.', { n: res.reset == null ? ids.length : res.reset }), 'ok'); ids.forEach(function (x) { delete st.pickSilenced[x]; }); refreshLive(true); return; }
          toast(T('pl.better-squads.prefs.resetfailed', '{who} was NOT reset — {why}', { who: label, why: refusal(res) }), 'err');
        }).catch(function (err) {
          toast(T('pl.better-squads.prefs.resetfailed', '{who} was NOT reset — {why}', { who: label, why: why(err) }), 'err');
        });
      }
      tables.silenced = SSA.table({
        rows: silencedRows,
        search: function (r) { return [r.name, r.squad, r.steamId].join(' '); },
        empty: T('pl.better-squads.prefs.empty', 'Nobody has silenced anything. Players who turn off their squad alerts in game appear here.'),
        columns: [
          { key: 'pick', label: '', thClass: 'bs-col-pick', tdClass: 'bs-col-pick', render: function (r) {
            var cb = h('input', { type: 'checkbox', checked: !!st.pickSilenced[r.steamId], 'aria-label': T('pl.better-squads.bulk.tick', 'Tick {name}', { name: r.name || r.steamId }),
              onchange: function () { if (cb.checked) st.pickSilenced[r.steamId] = true; else delete st.pickSilenced[r.steamId]; paintSil(); } });
            return h('label', { class: 'bs-pick' }, [cb]);
          } },
          { key: 'name', label: T('pl.better-squads.col.player', 'Player'), sort: true, sortVal: function (r) { return String(r.name || '').toLowerCase(); }, render: function (r) {
            var cell = SSA.cell.player(r.name, r.steamId);
            // Offline is worth seeing: only an admin can undo it for somebody who is not in game.
            if (r.online === false) return h('span', { class: 'bs-pl-off' }, [cell, h('span', { class: 'bs-off-tag' }, T('pl.better-squads.tag.offline', 'offline'))]);
            return cell;
          } },
          { key: 'squad', label: T('pl.better-squads.col.squad', 'Squad'), render: function (r) { return document.createTextNode(r.squad || '—'); } },
          { key: 'state', label: T('pl.better-squads.col.silenced', 'Silenced'), render: function (r) {
            return r.off ? SSA.cell.tag(T('pl.better-squads.tag.alloff', 'all alerts off'), 'bad')
              : document.createTextNode((r.muted || []).map(kindLabel).join(', '));
          } },
          { key: 'act', label: '', render: function (r) {
            return h('button', { class: 'secondary', onclick: function () { resetPrefs([r.steamId], r.name || r.steamId); } }, T('pl.better-squads.prefs.reset', 'Reset'));
          } },
        ],
      });
      var silBulk = h('button', { class: 'secondary', onclick: function () {
        // The ticks as they stand at the press, among the players the list still holds.
        var ids = silencedRows().filter(function (p) { return st.pickSilenced[p.steamId]; }).map(function (p) { return p.steamId; });
        if (!ids.length) { toast(T('pl.better-squads.bulk.pickplayers', 'Tick at least one player first.'), 'err'); return; }
        resetPrefs(ids, T('pl.better-squads.bulk.theticked', 'The ticked players'));
      } }, T('pl.better-squads.bulk.reset', 'Reset the ticked'));
      paintSil();
      out.push(card(T('pl.better-squads.card.silenced', 'Silenced by players'), T('pl.better-squads.card.silenced.sub', 'Alerts squad members turned off for themselves in game. Reset one if asked.'), [
        h('div', { class: 'bs-bulk' }, [silCount, silBulk]),
        tables.silenced.el,
      ]));
      return out;
    }

    // ── screen: Commands ───────────────────────────────────────────────────────
    function commandsView() {
      var c = st.cfg;
      var rootIn = h('input', { type: 'text', class: 'bs-in', maxlength: 16, oninput: function () { c.commands.root = rootIn.value; renderPreview(); markDirty(); } });
      rootIn.value = c.commands.root || '';
      var preview = h('code', { class: 'bs-prev' }, '');
      var SUB_DEFS = subs();
      // The manager's real in-game prefix, which the backend reports; '/' is its default.
      function cmdPrefix() { return (st.status && st.status.prefix) || '/'; }
      function renderPreview() {
        var pfx = cmdPrefix();
        preview.textContent = SUB_DEFS.filter(function (s) { return (c.commands.subs[s[0]] || {}).enabled; })
          .map(function (s) { return pfx + c.commands.root + ' ' + (c.commands.subs[s[0]] || {}).name; })
          .join('   ') || pfx + c.commands.root;
      }
      var subGrid = h('div', { class: 'bs-subs' }, SUB_DEFS.map(function (s) {
        var sc = c.commands.subs[s[0]] || (c.commands.subs[s[0]] = { enabled: false, name: s[0] });
        var nameIn = h('input', { type: 'text', class: 'bs-sub-name', maxlength: 16, 'aria-label': T('pl.better-squads.sub.word', 'Word players type for {name}', { name: s[1] }),
          oninput: function () { sc.name = nameIn.value; renderPreview(); markDirty(); } });
        nameIn.value = sc.name || '';
        return h('div', { class: 'bs-sub' }, [
          h('div', { class: 'bs-sub-head' }, [switchCtl(function () { return sc.enabled; }, function (v) { sc.enabled = v; renderPreview(); markDirty(); }, s[1]), nameIn]),
          h('small', { class: 'bs-hint' }, s[2]),
        ]);
      }));
      renderPreview();

      // ⚠ THE GROUPS ARE THE ORDER, NEVER THE LIST. Anything the backend has and the groups do not
      // name lands in a final group rather than having no field at all.
      var baseGroups = textGroups();
      var grouped = {};
      baseGroups.forEach(function (g) { g[1].forEach(function (k) { grouped[k] = 1; }); });
      var leftover = Object.keys(c.commands.texts || {}).filter(function (k) { return !grouped[k] && !/I18n$/.test(k); });
      var groups = baseGroups.concat(leftover.length ? [[T('pl.better-squads.group.faults', 'Faults & fallbacks'), leftover]] : []);
      var TEXT_LABEL = textLabels();
      var replyFilter = h('input', { type: 'search', class: 'bs-in bs-search', placeholder: T('pl.better-squads.replies.search', 'Find a reply…'), 'aria-label': T('pl.better-squads.replies.search', 'Find a reply…') });
      var noMatch = h('p', { class: 'bs-empty', hidden: true }, T('pl.better-squads.replies.nomatch', 'No reply has that in its name. Clear the box to see them all.'));
      var textCards = groups.map(function (g) {
        return h('div', { class: 'bs-tgroup' }, [h('h4', { class: 'bs-tgroup-t' }, g[0])].concat(g[1].filter(function (k) {
          return c.commands.texts[k] !== undefined;
        }).map(function (k) {
          var label = TEXT_LABEL[k] || humanKey(k);
          return h('div', { class: 'bs-loc', 'data-s': (label + ' ' + g[0]).toLowerCase() }, [locEditor(c.commands.texts, k, label, REPLY_TOKENS[k] || [], 'texts.' + k, markDirty)]);
        })));
      });
      // Filters in place, without a redraw, so typing never steals the box's focus.
      replyFilter.addEventListener('input', function () {
        var q = replyFilter.value.trim().toLowerCase(), shown = 0;
        textCards.forEach(function (gEl) {
          var any = 0;
          Array.prototype.forEach.call(gEl.querySelectorAll('.bs-loc'), function (el) {
            var ok = !q || el.getAttribute('data-s').indexOf(q) >= 0;
            el.hidden = !ok; if (ok) { any++; shown++; }
          });
          gEl.hidden = !any;
        });
        noMatch.hidden = shown > 0;
      });
      var off = !c.commands.enabled ? h('p', { class: 'bs-note' }, T('pl.better-squads.commands.offnote', 'In-game commands are off. A player who types one is told it is not a command here.')) : null;
      return [
        card(T('pl.better-squads.card.commands', 'In-game commands'), T('pl.better-squads.card.commands.sub', 'Players run these from chat. Rename any command; the preview shows what they type.'), [
          h('div', { class: 'bs-checks' }, [switchCtl(function () { return c.commands.enabled; }, function (v) { c.commands.enabled = v; markDirty(); renderStat(); }, T('pl.better-squads.chk.commands', 'Enable in-game commands'))]),
          off,
          h('div', { class: 'bs-grid' }, [field(T('pl.better-squads.field.root', 'Root command'), rootIn, T('pl.better-squads.field.root.hint', 'Typed with the manager’s chat-command prefix.'))]),
          h('div', { class: 'bs-prev-wrap' }, [h('span', { class: 'bs-prev-l' }, T('pl.better-squads.preview.label', 'Players type')), preview]),
          subGrid,
        ]),
        card(T('pl.better-squads.card.replies', 'Command replies'), T('pl.better-squads.card.replies.sub', 'Every line players see. Tokens and [ optional parts ] work as in events.'),
          [h('div', { class: 'bs-bulk' }, [replyFilter]), noMatch].concat(textCards)),
      ];
    }

    // ── screen: Activity ───────────────────────────────────────────────────────
    function liveRow(label, value, cls) {
      return h('div', { class: 'bs-lrow' + (cls ? ' ' + cls : '') }, [h('span', { class: 'bs-lrow-l' }, label), h('span', { class: 'bs-lrow-v' }, value)]);
    }
    function buildLiveBox() {
      var n = st.status.now;
      var box = h('div', { class: 'bs-live' });
      if (!n) {
        box.appendChild(h('p', { class: 'bs-empty' }, T('pl.better-squads.live.older', 'This backend is older than this screen and does not report its live state.')));
        return box;
      }
      var L = navLabels();
      var pfx = st.status.prefix || '/';
      box.appendChild(liveRow(T('pl.better-squads.live.plugin', 'Plugin'), n.enabled ? T('pl.better-squads.stat.on', 'Plugin on') : T('pl.better-squads.stat.off', 'Plugin off'), n.enabled ? 'ok' : 'off'));
      box.appendChild(liveRow(L.alerts, T('pl.better-squads.live.alertson', '{n} of {total} switched on', { n: n.alertsOn, total: n.alertsTotal }), n.alertsOn ? 'ok' : 'off'));
      box.appendChild(liveRow(L.commands, n.commandsOn ? T('pl.better-squads.live.commandson', 'Players can type {cmd}', { cmd: pfx + (st.cfg.commands.root || '') }) : T('pl.better-squads.live.commandsoff', 'Switched off'), n.commandsOn ? 'ok' : 'off'));
      var q = n.quietHours || {};
      box.appendChild(liveRow(T('pl.better-squads.live.quiet', 'Quiet hours'),
        !q.enabled ? T('pl.better-squads.live.quietoff', 'Not used')
          : (n.quiet ? T('pl.better-squads.live.quietnow', 'Holding alerts now, until {to}:00', { to: q.to }) : T('pl.better-squads.live.quietlater', 'From {from}:00 to {to}:00', { from: q.from, to: q.to })),
        n.quiet ? 'warn' : (q.enabled ? 'ok' : 'off')));
      var r = n.rate || {};
      box.appendChild(liveRow(T('pl.better-squads.live.rate', 'Messages this minute'),
        r.limit ? T('pl.better-squads.live.rateof', '{used} of {limit}', { used: r.used || 0, limit: r.limit }) : T('pl.better-squads.live.rateno', '{used}, no ceiling', { used: r.used || 0 }),
        r.limit && r.used >= r.limit ? 'bad' : 'ok'));
      var ro = n.roster || {};
      box.appendChild(liveRow(T('pl.better-squads.live.roster', 'Joined and left squad check'),
        !ro.running ? T('pl.better-squads.live.rosteroff', 'Not running: both squad alerts are off')
          : (ro.last ? T('pl.better-squads.live.rosterlast', 'Every {s}s, last {ago}, {n} squads watched', { s: ro.every, ago: agoS(ro.last), n: ro.watched || 0 })
            : T('pl.better-squads.live.rosterwait', 'Every {s}s, first check pending', { s: ro.every })),
        ro.running ? 'ok' : 'off'));
      var lr = n.liveReads || {};
      var live = st.status.live || {};
      [['players', T('pl.better-squads.live.positions', 'Positions')], ['squads', T('pl.better-squads.live.membership', 'Squad membership')]].forEach(function (x) {
        var note = liveNoteText(live[x[0]]);
        var v = lr[x[0]] === false ? T('pl.better-squads.live.fromsaveset', 'From the last save, as set in {where}', { where: L.settings })
          : (note ? T('pl.better-squads.live.fromsave', 'From the last save: {note}', { note: note }) : T('pl.better-squads.live.fromgame', 'From the running game where it answers'));
        box.appendChild(liveRow(x[1], v, lr[x[0]] === false ? 'off' : (note ? 'warn' : 'ok')));
      });
      box.appendChild(liveRow(T('pl.better-squads.live.mutes', 'Muted by an admin'), String(n.muted || 0), 'off'));
      box.appendChild(liveRow(T('pl.better-squads.live.silenced', 'Players who silenced alerts'), String(n.silenced || 0), 'off'));
      return box;
    }
    var liveHolder = null;
    function renderLiveBox() {
      if (!liveHolder) return;
      var next = buildLiveBox();
      if (!liveHolder.firstChild || liveHolder.firstChild.outerHTML !== next.outerHTML) { liveHolder.innerHTML = ''; liveHolder.appendChild(next); }
    }
    function logRows() {
      return (st.status.recent || []).filter(function (r) {
        if (st.logGroup && groupOf(r) !== st.logGroup) return false;
        if (st.logResult && (r.result || 'sent') !== st.logResult) return false;
        return true;
      });
    }
    function activityView() {
      liveHolder = h('div', {});
      renderLiveBox();
      var gl = groupLabels(), rl = resultLabels();
      var groupSel = h('select', { class: 'bs-sel', 'aria-label': T('pl.better-squads.log.filtergroup', 'Kind'), onchange: function () { st.logGroup = groupSel.value; tables.log.refresh(); } },
        [['', T('pl.better-squads.log.allkinds', 'Every kind')]].concat(Object.keys(gl).map(function (k) { return [k, gl[k]]; }))
          .map(function (o) { return h('option', { value: o[0], selected: st.logGroup === o[0] }, o[1]); }));
      var resultSel = h('select', { class: 'bs-sel', 'aria-label': T('pl.better-squads.log.filterresult', 'Result'), onchange: function () { st.logResult = resultSel.value; tables.log.refresh(); } },
        [['', T('pl.better-squads.log.allresults', 'Every result')]].concat(Object.keys(rl).map(function (k) { return [k, rl[k][0]]; }))
          .map(function (o) { return h('option', { value: o[0], selected: st.logResult === o[0] }, o[1]); }));
      tables.log = SSA.table({
        rows: logRows,
        pageSize: 25,
        search: function (r) { return [r.actor, r.text, kindLabel(r.kind), whyLabel(r.why)].join(' '); },
        searchPlaceholder: T('pl.better-squads.log.search', 'Search players, lines, events…'),
        toolbar: [groupSel, resultSel],
        empty: function () {
          if (st.logGroup || st.logResult) return T('pl.better-squads.log.nofilter', 'Nothing in the log matches these filters.');
          return T('pl.better-squads.log.empty.v2', 'Nothing has happened yet. Every alert, command and admin action appears here as it happens.');
        },
        columns: [
          { key: 'at', label: T('pl.better-squads.col.when', 'When'), sort: true, sortVal: function (r) { return r.at || 0; }, tdClass: 'dim bs-nowrap', render: function (r) { return document.createTextNode(when(r.at)); } },
          { key: 'kind', label: T('pl.better-squads.col.event', 'Event'), render: function (r) {
            return h('span', { class: 'bs-kind' }, [h('span', { class: 'bs-kind-g' }, gl[groupOf(r)] || ''), kindLabel(r.kind)]);
          } },
          { key: 'actor', label: T('pl.better-squads.col.player', 'Player'), render: function (r) {
            if (r.sid && /^\d{15,20}$/.test(r.sid)) return SSA.cell.player(r.actor || r.sid, r.sid);
            return document.createTextNode(r.actor || '—');
          } },
          { key: 'result', label: T('pl.better-squads.col.result', 'Result'), render: function (r) {
            var res = rl[r.result || 'sent'] || [humanKey(r.result), ''];
            var w = whyLabel(r.why);
            return h('span', { class: 'bs-res' }, [SSA.cell.tag(res[0], res[1]), w ? h('small', { class: 'bs-res-why' }, w) : null]);
          } },
          { key: 'recipients', label: T('pl.better-squads.col.sentto', 'Sent to'), render: function (r) {
            if (r.targets != null && r.targets !== r.recipients) return document.createTextNode(T('pl.better-squads.log.nofm', '{n} of {m}', { n: r.recipients || 0, m: r.targets }));
            return document.createTextNode(r.recipients ? String(r.recipients) : '—');
          } },
          { key: 'text', label: T('pl.better-squads.col.message', 'Message'), render: function (r) { return h('span', { class: 'bs-logtext' }, r.text || ''); } },
        ],
      });
      var testBtn = h('button', { class: 'secondary', onclick: function () {
        if (!window.SSA || !SSA.pickPlayer) { toast(T('pl.better-squads.toast.nopicker', 'Player picker unavailable')); return; }
        SSA.pickPlayer().then(function (p) {
          if (!p) return;
          api('/test', { method: 'POST', body: { steamId: String(p.steamId || p.SteamID || '') } })
            .then(function (r) { testToast(r); refreshLive(true); })
            .catch(function (err) { toast(T('pl.better-squads.test.failedwhy', 'Test failed — {why}', { why: why(err) }), 'err'); });
        });
      } }, [icon('chat'), T('pl.better-squads.test.send', 'Send a test')]);
      var resetBtn = h('button', { class: 'secondary', onclick: function () {
        SSA.confirm(T('pl.better-squads.stats.resetconfirm', 'Set the header counters back to zero? The log is kept.')).then(function (ok) {
          if (!ok) return;
          api('/stats/reset', { method: 'POST' }).then(function (r) {
            if (r && r.ok) { st.status.stats = r.stats || {}; renderStat(); return; }
            toast(T('pl.better-squads.stats.resetfailed', 'The counters were NOT reset — {why}', { why: refusal(r) }), 'err');
          }).catch(function (err) { toast(T('pl.better-squads.stats.resetfailed', 'The counters were NOT reset — {why}', { why: why(err) }), 'err'); });
        });
      } }, [icon('refresh'), T('pl.better-squads.stats.reset', 'Reset counters')]);
      var clearBtn = h('button', { class: 'secondary', onclick: function () {
        SSA.confirm(T('pl.better-squads.log.confirmclear', 'Clear the activity log?')).then(function (ok) {
          if (!ok) return;
          // The list on screen is cleared only once the backend confirms: a refusal must never look
          // like a clear that happened.
          api('/clear-log', { method: 'POST' }).then(function (r) {
            if (r && r.ok) { st.status.recent = []; tables.log.refresh(); renderFirstRun(); }
            else toast(T('pl.better-squads.log.clearfailed', 'The log was NOT cleared — {why}', { why: refusal(r) }), 'err');
          }).catch(function (err) {
            toast(T('pl.better-squads.log.clearfailed', 'The log was NOT cleared — {why}', { why: why(err) }), 'err');
          });
        });
      } }, [icon('close'), T('pl.better-squads.log.clear', 'Clear log')]);
      return [
        card(T('pl.better-squads.card.live', 'Right now'), T('pl.better-squads.card.live.sub', 'What the plugin is doing at this moment. Updates on its own.'), [liveHolder]),
        card(T('pl.better-squads.card.activity', 'Activity'), T('pl.better-squads.card.activity.sub.v2', 'Every alert, command and admin action, who it was for and how it ended.'), [
          h('div', { class: 'bs-actions' }, [testBtn, resetBtn, clearBtn]),
          tables.log.el,
        ]),
      ];
    }

    // ── screen: Settings ───────────────────────────────────────────────────────
    /**
     * One rule with its own switch: the switch says whether the rule applies, the number how much.
     * The backend stores "off" as 0 for these, which is what each has always meant, so switching one
     * back on brings the number it had, or its default.
     */
    function ruleRow(o) {
      var c = st.cfg;
      var last = Number(c[o.key]) > 0 ? Number(c[o.key]) : o.def;
      var box = numBox(function () { return Number(c[o.key]) > 0 ? c[o.key] : last; }, function (v) {
        if (v === '' || v > 0) { c[o.key] = v === '' ? o.def : v; if (v !== '') last = v; markDirty(); }
      }, o.min, o.max);
      box.disabled = !(Number(c[o.key]) > 0);
      var sw = switchCtl(function () { return Number(c[o.key]) > 0; }, function (on) {
        c[o.key] = on ? last : 0; box.disabled = !on; markDirty();
      }, o.title);
      return h('div', { class: 'bs-rule' }, [h('div', { class: 'bs-rule-h' }, [sw, h('span', { class: 'bs-rule-ctl' }, [box, h('span', { class: 'bs-unit' }, o.unit)])]), h('small', { class: 'bs-hint' }, o.hint)]);
    }
    function settingsView() {
      var c = st.cfg;
      var out = [];
      var chLab = chLabels();
      var chSel = h('select', { class: 'bs-sel', onchange: function () { c.channel = chSel.value; markDirty(); } },
        Object.keys(chLab).map(function (k) { return h('option', { value: k, selected: c.channel === k }, chLab[k]); }));
      out.push(card(T('pl.better-squads.card.delivery', 'Delivery'), T('pl.better-squads.card.delivery.sub', 'Where the lines land and how often they are allowed to fire.'), [
        h('div', { class: 'bs-grid' }, [
          field(T('pl.better-squads.field.channel', 'Chat channel'), chSel, T('pl.better-squads.field.channel.hint', 'Only changes where the line appears. Recipients are always the squad.')),
        ]),
        h('div', { class: 'bs-checks' }, [
          switchCtl(function () { return c.includeSelf; }, function (v) { c.includeSelf = v; markDirty(); }, T('pl.better-squads.chk.includeself', 'Also send to the player it is about')),
        ]),
      ]));

      // Quiet hours: a switch and a window, both on the server's clock.
      var qFrom = numBox(function () { return c.quietHours.from; }, function (v) { c.quietHours.from = v; markDirty(); }, 0, 23);
      var qTo = numBox(function () { return c.quietHours.to; }, function (v) { c.quietHours.to = v; markDirty(); }, 0, 23);
      qFrom.disabled = qTo.disabled = !c.quietHours.enabled;
      var quiet = h('div', { class: 'bs-rule' }, [
        h('div', { class: 'bs-rule-h' }, [
          switchCtl(function () { return c.quietHours.enabled; }, function (v) { c.quietHours.enabled = v; qFrom.disabled = qTo.disabled = !v; markDirty(); }, T('pl.better-squads.chk.quiethours', 'Respect quiet hours')),
          h('span', { class: 'bs-rule-ctl' }, [h('span', { class: 'bs-unit' }, T('pl.better-squads.field.quietfrom.short', 'from')), qFrom, h('span', { class: 'bs-unit' }, T('pl.better-squads.field.quietto.short', 'to')), qTo]),
        ]),
        h('small', { class: 'bs-hint' }, T('pl.better-squads.field.quiet.hint', 'Server hours, 0 to 23. No alert goes out inside the window. The same hour twice means never.')),
      ]);
      var roster = numBox(function () { return c.rosterPollSeconds; }, function (v) { c.rosterPollSeconds = v === '' ? '' : v; markDirty(); }, 5, 3600);
      out.push(card(T('pl.better-squads.card.limits', 'Limits'), T('pl.better-squads.card.limits.sub', 'Each rule has its own switch. Off means the rule does not apply.'), [
        ruleRow({ key: 'cooldownSeconds', def: 3, min: 1, max: 600, unit: T('pl.better-squads.unit.seconds', 'seconds'),
          title: T('pl.better-squads.rule.cooldown', 'Cooldown per player and event'),
          hint: T('pl.better-squads.field.cooldown.hint', 'Per player, per event. Stops a relog or a firefight from spamming everyone.') }),
        quiet,
        ruleRow({ key: 'maxIndividualSends', def: 12, min: 1, max: 100, unit: T('pl.better-squads.unit.readers', 'readers'),
          title: T('pl.better-squads.rule.perreader', 'One shared copy for big squads'),
          hint: T('pl.better-squads.rule.perreader.hint', 'Above this many readers, a line with distance or direction goes once to all, without them.') }),
        ruleRow({ key: 'maxPerMinute', def: 300, min: 1, max: 5000, unit: T('pl.better-squads.unit.perminute', 'per minute'),
          title: T('pl.better-squads.rule.perminute', 'Ceiling on messages per minute'),
          hint: T('pl.better-squads.field.perminute.hint.v2', 'Across the whole plugin, player commands included. Over it, lines are held back.') }),
        h('div', { class: 'bs-rule' }, [
          h('div', { class: 'bs-rule-h' }, [h('span', { class: 'bs-rule-t' }, T('pl.better-squads.field.roster', 'Roster check (seconds)')), h('span', { class: 'bs-rule-ctl' }, [roster, h('span', { class: 'bs-unit' }, T('pl.better-squads.unit.seconds', 'seconds'))])]),
          h('small', { class: 'bs-hint' }, T('pl.better-squads.field.roster.hint.v2', 'How often the save is read for joined and left squad. Runs only while one of those alerts is on.')),
        ]),
      ]));

      var lr = c.liveReads;
      out.push(card(T('pl.better-squads.card.livereads', 'Live game reads'), T('pl.better-squads.card.livereads.sub', 'Where the plugin asks the running game instead of the last save.'), [
        h('div', { class: 'bs-rule' }, [switchCtl(function () { return lr.players !== false; }, function (v) { lr.players = v; markDirty(); }, T('pl.better-squads.live.readpositions', 'Positions from the running game')),
          h('small', { class: 'bs-hint' }, T('pl.better-squads.live.readpositions.hint', 'For distance and direction. Needs the bridge’s Live player data card in {where}.', { where: bridgeWhere() }))]),
        h('div', { class: 'bs-rule' }, [switchCtl(function () { return lr.squads !== false; }, function (v) { lr.squads = v; markDirty(); }, T('pl.better-squads.live.readsquads', 'Squad membership from the running game')),
          h('small', { class: 'bs-hint' }, T('pl.better-squads.live.readsquads.hint', 'Decides who hears a line. Needs the bridge’s Live squads card in {where}.', { where: bridgeWhere() }))]),
      ]));

      // The admin mute list: a table, so a hundred names stay searchable, with ticks for a bulk unmute.
      var muteCount = h('span', { class: 'bs-bulk-n' });
      function mutedRows() {
        var byId = {};
        st.players.forEach(function (p) { byId[p.steamId] = p; });
        ((st.squads && st.squads.squads) || []).forEach(function (s) { s.members.forEach(function (m) { if (!byId[m.steamId]) byId[m.steamId] = { steamId: m.steamId, name: m.name, squad: s.name, online: m.online }; else if (!byId[m.steamId].squad) byId[m.steamId].squad = s.name; }); });
        return (c.mutedSteamIds || []).map(function (sid) { var p = byId[sid] || {}; return { steamId: sid, name: p.name || '', squad: p.squad || '', online: !!p.online }; });
      }
      function paintMute() {
        var n = mutedRows().filter(function (r) { return st.pickMuted[r.steamId]; }).length;
        muteCount.textContent = n ? T('pl.better-squads.bulk.ticked', '{n} ticked', { n: n }) : '';
      }
      function unmute(ids, label) {
        var before = (c.mutedSteamIds || []).slice();
        var drop = {}; ids.forEach(function (x) { drop[x] = 1; });
        var next = before.filter(function (x) { return !drop[x]; });
        c.mutedSteamIds = next; tables.muted.refresh();
        saveMutes(next, function () { c.mutedSteamIds = before; tables.muted.refresh(); },
          function (w) { return T('pl.better-squads.mute.unmutefailed', '{who} was NOT unmuted — {why}', { who: label, why: w }); })
          .then(function (done) { if (done) { ids.forEach(function (x) { delete st.pickMuted[x]; }); paintMute(); refreshLive(true); } });
      }
      tables.muted = SSA.table({
        rows: mutedRows,
        search: function (r) { return [r.name, r.squad, r.steamId].join(' '); },
        empty: T('pl.better-squads.mute.empty', 'Nobody is muted. A muted player gets none of these messages and cannot undo it.'),
        columns: [
          { key: 'pick', label: '', thClass: 'bs-col-pick', tdClass: 'bs-col-pick', render: function (r) {
            var cb = h('input', { type: 'checkbox', checked: !!st.pickMuted[r.steamId], 'aria-label': T('pl.better-squads.bulk.tick', 'Tick {name}', { name: r.name || r.steamId }),
              onchange: function () { if (cb.checked) st.pickMuted[r.steamId] = true; else delete st.pickMuted[r.steamId]; paintMute(); } });
            return h('label', { class: 'bs-pick' }, [cb]);
          } },
          { key: 'name', label: T('pl.better-squads.col.player', 'Player'), sort: true, sortVal: function (r) { return String(r.name || r.steamId).toLowerCase(); },
            render: function (r) { return SSA.cell.player(r.name || r.steamId, r.steamId); } },
          { key: 'squad', label: T('pl.better-squads.col.squad', 'Squad'), render: function (r) { return document.createTextNode(r.squad || '—'); } },
          { key: 'act', label: '', render: function (r) {
            return h('button', { class: 'secondary', onclick: function () { unmute([r.steamId], r.name || r.steamId); } }, T('pl.better-squads.mute.unmute', 'Unmute'));
          } },
        ],
      });
      var addMute = h('button', { class: 'secondary', onclick: function () {
        if (!window.SSA || !SSA.pickPlayer) { toast(T('pl.better-squads.toast.nopicker', 'Player picker unavailable')); return; }
        SSA.pickPlayer().then(function (p) {
          if (!p) return;
          var sid = String(p.steamId || p.SteamID || '');
          if (!sid || (c.mutedSteamIds || []).indexOf(sid) >= 0) return;
          var label = p.name || sid;
          var before = (c.mutedSteamIds || []).slice();
          var next = before.concat([sid]);
          c.mutedSteamIds = next; tables.muted.refresh();
          saveMutes(next, function () { c.mutedSteamIds = before; tables.muted.refresh(); },
            function (w) { return T('pl.better-squads.mute.mutefailed', '{who} was NOT muted — {why}', { who: label, why: w }); })
            .then(function (done) { if (done) refreshLive(true); });
        });
      } }, T('pl.better-squads.mute.add', 'Mute a player'));
      var unmuteTicked = h('button', { class: 'secondary', onclick: function () {
        // The ticks as they stand at the press.
        var ids = mutedRows().filter(function (r) { return st.pickMuted[r.steamId]; }).map(function (r) { return r.steamId; });
        if (!ids.length) { toast(T('pl.better-squads.bulk.pickplayers', 'Tick at least one player first.'), 'err'); return; }
        unmute(ids, T('pl.better-squads.bulk.theticked', 'The ticked players'));
      } }, T('pl.better-squads.bulk.unmuteticked', 'Unmute the ticked'));
      paintMute();
      out.push(card(T('pl.better-squads.card.muted', 'Muted by an admin'), T('pl.better-squads.card.muted.sub', 'A muted player gets none of these messages; squadmates still do. They cannot undo it.'), [
        h('div', { class: 'bs-bulk' }, [muteCount, addMute, unmuteTicked]),
        tables.muted.el,
      ]));
      return out;
    }

    // ── drawing a screen ───────────────────────────────────────────────────────
    function renderView() {
      tables = {}; liveHolder = null;
      body.innerHTML = '';
      var parts = st.view === 'squads' ? squadsView()
        : st.view === 'commands' ? commandsView()
          : st.view === 'activity' ? activityView()
            : st.view === 'settings' ? settingsView() : alertsView();
      parts.forEach(function (p) { if (p) body.appendChild(p); });
    }

    function build() {
      wrap.innerHTML = '';
      wrap.appendChild(h('div', { class: 'bs-head' }, [
        h('div', { class: 'bs-head-l' }, [
          h('h2', {}, 'Better Squads'),
          h('p', { class: 'bs-intro bs-lead' }, T('pl.better-squads.intro', 'Squad-only chat: alerts about your people and commands to find them. Nobody else sees it.')),
        ]),
      ]));
      wrap.appendChild(firstRun);
      wrap.appendChild(h('div', { class: 'bs-top' }, [navEl, h('div', { class: 'bs-top-r' }, [masterHolder, statusMsg, saveBtn])]));
      wrap.appendChild(statBar);
      wrap.appendChild(body);
      paintNav(); paintMaster(); renderStat(); renderView();
    }

    // ── the live half ──────────────────────────────────────────────────────────
    // `background` is the interval's own tick: a page taken out of the document stops its timer, and
    // one that is merely hidden skips the round. Each screen asks only for what it shows.
    var lastSquadsAt = 0;
    function refreshLive(background) {
      if (background === true) {
        if (!wrap.isConnected) { stopPolling(); return Promise.resolve(); }
        if (document.hidden || !wrap.getClientRects().length) return Promise.resolve();
      }
      var wantPlayers = st.view === 'squads' || st.view === 'settings';
      var wantSquads = (st.view === 'squads' || st.view === 'settings') && (background !== true || Date.now() - lastSquadsAt > 30000);
      var asks = [api('/status'), wantPlayers ? api('/players') : null, wantSquads ? api('/squads').then(function (r) { st.squadsErr = null; return r; }, function (err) { st.squadsErr = why(err); return null; }) : null];
      return Promise.all(asks).then(function (r) {
        st.pollErr = null;
        st.status = r[0] || st.status;
        if (r[1]) st.players = r[1];
        if (r[2]) { st.squads = r[2]; lastSquadsAt = Date.now(); }
        renderStat(); renderLiveBox();
        Object.keys(tables).forEach(function (k) { if (tables[k]) tables[k].refresh(); });
      }).catch(function (err) {
        // The last figures stay on screen, and this says they stopped moving: "I could not ask" is
        // not "there is nothing there".
        st.pollErr = why(err);
        renderStat();
      });
    }
    var ownTimer = null;
    function stopPolling() {
      if (ownTimer) clearInterval(ownTimer);
      if (bsPollTimer === ownTimer) bsPollTimer = null;
      ownTimer = null;
    }

    /** The config as the screens expect it, whatever an older backend or a hand-edited file sent. */
    function normal(c) {
      c = c || {};
      c.events = c.events || {};
      c.commands = c.commands || {};
      c.commands.subs = c.commands.subs || {};
      c.commands.texts = c.commands.texts || {};
      c.quietHours = c.quietHours || { enabled: false, from: 2, to: 8 };
      c.liveReads = c.liveReads || { players: true, squads: true };
      c.mutedSteamIds = Array.isArray(c.mutedSteamIds) ? c.mutedSteamIds.map(String) : [];
      return c;
    }

    function load() {
      // `/text-defaults` is optional: the editors work without it, only without the built-in texts.
      var wantSquads = st.view === 'squads' || st.view === 'settings';
      Promise.all([api('/config'), api('/status'), api('/players'), api('/text-defaults').catch(function () { return null; }),
        wantSquads ? api('/squads').catch(function (err) { st.squadsErr = why(err); return null; }) : null]).then(function (r) {
        shippedTexts = r[3] || null;
        st.cfg = normal(r[0]);
        st.status = r[1] || st.status;
        st.players = r[2] || [];
        if (r[4]) { st.squads = r[4]; lastSquadsAt = Date.now(); }
        build();
        if (!wrap.isConnected) return;
        if (bsPollTimer) clearInterval(bsPollTimer);
        ownTimer = setInterval(function () { refreshLive(true); }, 10000);
        bsPollTimer = ownTimer;
      }).catch(loadFailed);
    }
    load();
  }

  SSA.ready(function () {
    SSA.registerTab({ id: 'better-squads', label: 'Better Squads', icon: '#i-users', premium: true, render: editor });
  });
}());
