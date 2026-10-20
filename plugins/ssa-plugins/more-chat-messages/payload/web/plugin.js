/* eslint-env browser */
'use strict';

// More Chat Messages — the plugin's tab.
//
// Four screens, named in ONE place (`navLabels`), because the first-run note and two hints point at
// them by name:
//
//   Announcements  the eight announcements, each with its switch, and under each one every moment it
//                  can announce with its own switch. Search, a filter, ticks and bulk on/off.
//   Messages       every line players read, one editor each with a tab per language, its own switch
//                  beside it. Search, two filters and pages, because there are twenty-two of them.
//   Activity       every line said, to whom, on which channel and when; every line NOT said with the
//                  reason; what the polled announcements are following and when the next check is.
//   Settings       the master switch, where each announcement goes (channel and chat history) and
//                  the one number an announcement has (the kill distance).
//
// EVERYTHING HERE IS EDITABLE WITH THE SERVER STOPPED, which is the better moment to write it. Only
// the counters, the activity log and what is being followed need a running game, and the stat
// header says so rather than showing zeroes that read as "it is not working".
//
// ── STATE IS SAID TWICE: IN COLOUR AND IN A WORD ────────────────────────────────────────────────
// Every announcement carries a switch, a pill that reads "Announcing" or "Silent", and an amber
// edge down the card when it is on. A reader scrolling picks up the edge; a reader looking at one
// card reads the word. Colour alone is a claim somebody cannot check.

(function () {
  const ID = 'more-chat-messages';

  // ⚠ **THE PLUGIN'S OWN BACKEND IS `/api/plugin-host/<id>/…`, NOT `/api/plugins/…`.** The second
  // is the plugin MANAGEMENT surface, so a hand-rolled fetch there 404s on every read and every
  // save. `SSA.apiClient()` builds the right URL, binds this plugin's id at RENDER time and refuses
  // to treat a 4xx as an empty answer.
  const client = SSA.apiClient();
  const T = SSA.t;
  const api = async (path, opts) => {
    try { return await client(path, opts); }
    catch (err) { return { ok: false, error: SSA.apiError ? SSA.apiError(err) : T('pl.more-chat-messages.error.generic', 'that did not work') }; }
  };
  const el = SSA.el;
  const icon = (name) => (SSA.icon ? SSA.icon(name) : el('span', {}));
  // A deep link per screen (`#plugins/p/more-chat-messages/activity`), on a manager that has the
  // hook. An older one has no `SSA.route`; the screens then simply open on Announcements.
  const ROUTE = (SSA.route && typeof SSA.route.client === 'function') ? SSA.route.client() : null;
  // ONE listener for the life of the script: the hook keeps every function it is handed, so one
  // per mount would keep every page ever drawn. Each mount points it at its own page instead.
  let onRoute = null;
  if (ROUTE && typeof ROUTE.onChange === 'function') ROUTE.onChange((sub) => { if (onRoute) onRoute(sub); });

  /* THE FOUR SCREEN NAMES, IN ONE PLACE, BECAUSE THREE SENTENCES POINT AT THEM. A screen named in a
   * hint and spelled differently on the nav is a route the reader cannot follow. */
  function navLabels() {
    return {
      announcements: T('pl.more-chat-messages.nav.announcements', 'Announcements'),
      messages: T('pl.more-chat-messages.nav.messages', 'Messages'),
      activity: T('pl.more-chat-messages.nav.activity', 'Activity'),
      settings: T('pl.more-chat-messages.nav.settings', 'Settings'),
    };
  }
  const SCREENS = [['announcements', 'chat'], ['messages', 'list'], ['activity', 'pulse'], ['settings', 'sliders']];

  // One entry per announcement. `triggers` is every moment it can announce, each with the message
  // it says and the switch that decides it (`sw: null` is the announcement's own switch, for the
  // ones that say one thing). `seed` names the `/status` flag that says whether a polled
  // announcement has its first reading yet.
  //
  // A FUNCTION, called on every mount: `T()` answers in the language the panel is in at the moment it
  // is called, so a list built once kept the language the page was first opened in.
  let CARDS = [];
  const cardDefs = () => [
    { key: 'kills', icon: 'skull', title: T('pl.more-chat-messages.kills.title', 'Kills'),
      what: T('pl.more-chat-messages.kills.what.v2', 'Every death the manager\'s kill feed sorts, one line per kind. A kind it does not send stays quiet.'),
      // No `{sector}` on a kill: the kill event carries the two positions only inside a sentence the
      // manager formatted for an embed. A suicide and a death with a cause carry the position.
      triggers: [
        { sw: 'announcePvp', field: 'message', label: T('pl.more-chat-messages.kills.toggle.pvp', 'A player kills a player'),
          msg: T('pl.more-chat-messages.kills.field.message', 'When somebody is killed'), toks: '{killer} {victim} {weapon} {distance}' },
        { sw: 'announceNpc', field: 'npcMessage', label: T('pl.more-chat-messages.kills.toggle.npc', 'An NPC, animal, puppet or sentry kills a player'),
          msg: T('pl.more-chat-messages.kills.field.npc', 'When an NPC, animal, puppet or sentry kills somebody'), toks: '{killer} {killerKind} {victim} {weapon} {distance}' },
        { sw: 'announceCause', field: 'causeMessage', label: T('pl.more-chat-messages.kills.toggle.cause', 'A death with no killer, such as a fall or the cold'),
          msg: T('pl.more-chat-messages.kills.field.cause', 'When somebody dies of a cause, with no killer'), toks: '{victim} {cause} {sector}' },
        { sw: 'announceNoKiller', field: 'messageNoKiller', label: T('pl.more-chat-messages.kills.toggle.nokiller', 'A death with nothing named at all'),
          msg: T('pl.more-chat-messages.kills.field.nokiller.v2', 'When nobody and nothing is named at all'), toks: '{victim} {sector}' },
        { sw: 'announceSuicide', field: 'selfMessage', label: T('pl.more-chat-messages.kills.toggle.self', 'A player kills themselves'),
          msg: T('pl.more-chat-messages.kills.field.self', 'When somebody kills themselves'), toks: '{victim} {sector}' },
        { sw: 'announceEvent', field: 'eventMessage', label: T('pl.more-chat-messages.kills.toggle.event', 'A death inside a game event'),
          msg: T('pl.more-chat-messages.kills.field.event', 'When somebody dies inside a game event'), toks: '{killer} {victim} {weapon} {distance}' },
      ] },
    { key: 'joins', icon: 'user', title: T('pl.more-chat-messages.joins.title', 'Players joining'),
      what: T('pl.more-chat-messages.joins.what', 'One line per player joining, with sector and squad (blank for solo players).'),
      triggers: [{ sw: null, field: 'message', label: T('pl.more-chat-messages.joins.toggle', 'A player joins'),
        msg: T('pl.more-chat-messages.joins.field.message', 'Message'), toks: '{name} {steamId} {sector} {squad}' }] },
    { key: 'leaves', icon: 'logout', title: T('pl.more-chat-messages.leaves.title', 'Players leaving'),
      what: T('pl.more-chat-messages.leaves.what', 'One line when a player disconnects, with the sector they logged out in.'),
      triggers: [{ sw: null, field: 'message', label: T('pl.more-chat-messages.leaves.toggle', 'A player leaves'),
        msg: T('pl.more-chat-messages.leaves.field.message', 'Message'), toks: '{name} {steamId} {sector} {squad}' }] },
    { key: 'cargo', icon: 'box', title: T('pl.more-chat-messages.cargo.title', 'Cargo drops'), bridge: true, seed: 'seededCargo',
      what: T('pl.more-chat-messages.cargo.what.v2', 'Announced on the way down, on landing and when gone. Needs the SSA Bridge.'),
      triggers: [
        { sw: 'announceIncoming', field: 'incomingMessage', label: T('pl.more-chat-messages.cargo.toggle.incoming', 'On the way down'),
          msg: T('pl.more-chat-messages.cargo.field.incoming', 'On the way down'), toks: '{sector} {x} {y}' },
        { sw: 'announceLanded', field: 'landedMessage', label: T('pl.more-chat-messages.cargo.toggle.landed', 'Landing'),
          msg: T('pl.more-chat-messages.cargo.field.landed', 'Landed'), toks: '{sector} {x} {y}' },
        { sw: 'announceGone', field: 'goneMessage', label: T('pl.more-chat-messages.cargo.toggle.gone', 'Gone'),
          msg: T('pl.more-chat-messages.cargo.field.gone', 'Gone'), toks: '{sector} {x} {y}' },
      ] },
    // `trophy`, because that is what the panel's own map layer for these events wears.
    { key: 'events', icon: 'trophy', title: T('pl.more-chat-messages.events.title', 'Game events'), bridge: true, seed: 'seededEvents',
      what: T('pl.more-chat-messages.events.what', 'Deathmatch, capture the flag and drop zone. Needs the SSA Bridge. Events already running at manager start stay quiet.'),
      triggers: [
        { sw: 'announceOpen', field: 'openMessage', label: T('pl.more-chat-messages.events.toggle.open', 'Sign-ups open'),
          msg: T('pl.more-chat-messages.events.field.open', 'Sign-ups open'), toks: '{event} {location} {sector} {registered}' },
        { sw: 'announceJoin', field: 'joinMessage', label: T('pl.more-chat-messages.events.toggle.join', 'Each person who signs up'),
          msg: T('pl.more-chat-messages.events.field.join', 'Someone signed up'), toks: '{player} {event} {location} {sector} {registered}' },
        { sw: 'announceCount', field: 'countMessage', label: T('pl.more-chat-messages.events.toggle.count', 'Sign-up count changes'),
          msg: T('pl.more-chat-messages.events.field.count', 'Sign-up count'), toks: '{event} {location} {sector} {registered}' },
        { sw: 'announceStart', field: 'startMessage', label: T('pl.more-chat-messages.events.toggle.start', 'The event starts'),
          msg: T('pl.more-chat-messages.events.field.start', 'Started'), toks: '{event} {location} {sector} {participants} {teams}' },
        { sw: 'announceEnd', field: 'endMessage', label: T('pl.more-chat-messages.events.toggle.end', 'The event ends'),
          msg: T('pl.more-chat-messages.events.field.end', 'Ended'), toks: '{event} {location} {sector}' },
      ] },
    { key: 'bunkersSecret', icon: 'lock', title: T('pl.more-chat-messages.bunkers.secret.title', 'Secret bunkers'), seed: 'seededSecretBunkers',
      what: T('pl.more-chat-messages.bunkers.secret.what.v2', 'Key card bunkers, announced when opened and when closed. No bridge; only {sector} is filled.'),
      triggers: [
        { sw: 'announceOpen', field: 'openMessage', label: T('pl.more-chat-messages.bunkers.secret.toggle.open', 'A secret bunker opens'),
          msg: T('pl.more-chat-messages.bunkers.secret.field.open', 'Opened'), toks: '{sector}' },
        { sw: 'announceClose', field: 'closeMessage', label: T('pl.more-chat-messages.bunkers.secret.toggle.close.v2', 'A secret bunker closes'),
          msg: T('pl.more-chat-messages.bunkers.secret.field.close', 'Closed'), toks: '{sector}' },
      ] },
    { key: 'bunkersAbandoned', icon: 'lock', title: T('pl.more-chat-messages.bunkers.abandoned.title', 'Abandoned bunkers'), seed: 'seededBunkers',
      what: T('pl.more-chat-messages.bunkers.abandoned.what', 'The scheduled bunkers, announced when they open or lock. No bridge needed.'),
      triggers: [
        { sw: 'announceOpen', field: 'openMessage', label: T('pl.more-chat-messages.bunkers.abandoned.toggle.open', 'An abandoned bunker opens'),
          msg: T('pl.more-chat-messages.bunkers.abandoned.field.open', 'Active'), toks: '{sector} {x} {y}' },
        { sw: 'announceClose', field: 'closeMessage', label: T('pl.more-chat-messages.bunkers.abandoned.toggle.close.v2', 'An abandoned bunker locks'),
          msg: T('pl.more-chat-messages.bunkers.abandoned.field.close', 'Locked'), toks: '{sector} {x} {y}' },
      ] },
    { key: 'raids', icon: 'shield', title: T('pl.more-chat-messages.raids.title', 'Bases being raided'),
      what: T('pl.more-chat-messages.raids.what.v2', 'When a base takes damage. Raid protection changes, locks, chests and vehicles stay quiet.'),
      triggers: [
        { sw: null, field: 'message', label: T('pl.more-chat-messages.raids.toggle.attack', 'A base takes damage'),
          msg: T('pl.more-chat-messages.raids.field.message', 'Message'), toks: '{sector} {element} {squad}' },
        // Not a second moment: the same raid, said with the owner's name instead. Off by default; the
        // hint on Settings and the README say why.
        { sw: 'includeOwner', field: 'ownerMessage', label: T('pl.more-chat-messages.raids.toggle.owner', 'Name the base owner'),
          msg: T('pl.more-chat-messages.raids.field.owner', 'Message when naming the owner'), toks: '{owner} {squad} {sector} {element}' },
      ] },
  ];
  const cardOf = (key) => CARDS.filter((d) => d.key === key)[0] || null;
  const triggerOf = (key, field) => {
    const d = cardOf(key);
    return d ? (d.triggers.filter((t) => t.field === field)[0] || null) : null;
  };
  /** Every message, flat, in reading order. */
  const allTriggers = () => {
    const out = [];
    CARDS.forEach((d) => d.triggers.forEach((t) => out.push({ def: d, t })));
    return out;
  };

  // The value the backend stores is the lower-case word; this is only what a reader sees. The
  // channel picks the colour and chat tab, so the label is the channel's name, not an audience.
  const channelLabel = (c) => ({
    local: T('pl.more-chat-messages.channel.local.name', 'Local'),
    global: T('pl.more-chat-messages.channel.global.name', 'Global'),
    squad: T('pl.more-chat-messages.channel.squad', 'Squad'),
    admin: T('pl.more-chat-messages.channel.admin.name', 'Admin'),
    server: T('pl.more-chat-messages.channel.server', 'Server'),
  })[c] || c;

  // What an older activity row was, when it carries no section key. The backend sends the kind as a code.
  const kindLabel = (k) => ({
    kill: T('pl.more-chat-messages.kind.kill', 'Kill'),
    join: T('pl.more-chat-messages.kind.join', 'Join'),
    leave: T('pl.more-chat-messages.kind.leave', 'Leave'),
    cargo: T('pl.more-chat-messages.kind.cargo', 'Cargo'),
    event: T('pl.more-chat-messages.kind.event', 'Event'),
    bunker: T('pl.more-chat-messages.kind.bunker', 'Bunker'),
    raid: T('pl.more-chat-messages.kind.raid', 'Raid'),
  })[k] || String(k || '');

  // A failure the chat call threw, in words. One this list does not know is shown as it came.
  const failText = (code) => ({
    bridge_unavailable: T('pl.more-chat-messages.fail.unavailable', 'the bridge is not running'),
    bridge_timeout: T('pl.more-chat-messages.fail.timeout', 'the bridge did not answer in time'),
    bridge_closed: T('pl.more-chat-messages.fail.closed', 'the bridge closed the connection'),
    bridge_wrong_instance: T('pl.more-chat-messages.fail.instance', 'the bridge belongs to another server'),
    bad_response: T('pl.more-chat-messages.fail.badresponse', 'the bridge gave an unreadable answer'),
    chat_failed: T('pl.more-chat-messages.fail.chat', 'the game did not take the line'),
  })[code] || String(code || '');

  /** The result of one activity row, in words. `why` is a code; an older backend sent English. */
  function whyText(r) {
    if (r.why === 'nobody') return T('pl.more-chat-messages.why.nobody', 'Nobody online to hear it');
    if (r.why === 'failed') {
      return r.detail ? T('pl.more-chat-messages.why.failed.detail', 'Not sent: {error}', { error: failText(r.detail) })
        : T('pl.more-chat-messages.why.failed', 'Not sent');
    }
    if (r.why === 'off') return T('pl.more-chat-messages.why.off', 'Not said: switched off');
    if (r.why === 'short') return T('pl.more-chat-messages.why.short', 'Not said: {m} m is under the minimum distance', { m: r.detail || '0' });
    if (r.why === 'blank') return T('pl.more-chat-messages.why.blank', 'Not said: the message is empty');
    if (r.why === 'noname') return T('pl.more-chat-messages.why.noname', 'Not said: the game gave no name');
    return String(r.why || '');
  }
  /** The result as one word, for the filter and the coloured tag. */
  function resultOf(r) {
    if (r.result) return r.result;
    return r.ok ? (r.why === 'nobody' ? 'nobody' : 'sent') : 'failed';
  }
  const resultLabel = (res) => ({
    sent: T('pl.more-chat-messages.result.sent', 'Sent'),
    nobody: T('pl.more-chat-messages.result.nobody', 'Reached nobody'),
    failed: T('pl.more-chat-messages.result.failed', 'Failed'),
    skipped: T('pl.more-chat-messages.result.skipped', 'Not said'),
  })[res] || res;

  /** Why cargo and events could not be watched. `pollError` is a code; the bridge's words ride beside. */
  function pollErrorText(s) {
    if (s.pollError === 'no_answer') {
      return s.pollErrorDetail ? T('pl.more-chat-messages.poll.refused', 'the bridge refused: {reason}', { reason: s.pollErrorDetail })
        : T('pl.more-chat-messages.poll.noanswer', 'the bridge did not answer');
    }
    if (s.pollError === 'no_cargo_list') return T('pl.more-chat-messages.poll.nocargo', 'the bridge answered without a cargo list');
    return String(s.pollError || '');
  }

  /**
   * Where to switch on the bridge's participant names, BUILT from the panel's own keys and the
   * module schema's own captions, never written out: the day the panel translates the caption,
   * this sentence follows without a release of its own.
   */
  const bridgeCaption = (kind, mod, key, english) => T([kind, mod, key].join('.'), english);
  function participantsWhere() {
    return T('pl.more-chat-messages.live.noparticipants.v2', 'No sign-up names: turn on "{switch}" in {module} ({where}).', {
      switch: bridgeCaption('mod', 'worldevents', 'players', 'Who is in the event'),
      module: bridgeCaption('modname', 'worldevents', 'worldevents', 'Live world events'),
      where: T('nav.plugins', 'Plugins') + ' → ' + T('plugins.viewInGame', 'SSA Bridge'),
    });
  }

  // What each token holds, as the NAME on its chip. The chip shows the token beside it.
  function tokenName(tok) {
    const names = {
      '{cause}': T('pl.more-chat-messages.tok.cause', 'Cause'),
      '{distance}': T('pl.more-chat-messages.tok.distance', 'Distance'),
      '{element}': T('pl.more-chat-messages.tok.element', 'Building part'),
      '{event}': T('pl.more-chat-messages.tok.event', 'Event'),
      '{killerKind}': T('pl.more-chat-messages.tok.killerKind', 'Killer type'),
      '{killer}': T('pl.more-chat-messages.tok.killer', 'Killer'),
      '{location}': T('pl.more-chat-messages.tok.location', 'Place'),
      '{name}': T('pl.more-chat-messages.tok.name', 'Player name'),
      '{owner}': T('pl.more-chat-messages.tok.owner', 'Owner'),
      '{participants}': T('pl.more-chat-messages.tok.participants', 'Participants'),
      '{player}': T('pl.more-chat-messages.tok.player', 'Player'),
      '{registered}': T('pl.more-chat-messages.tok.registered', 'Signed up'),
      '{sector}': T('pl.more-chat-messages.tok.sector', 'Sector'),
      '{squad}': T('pl.more-chat-messages.tok.squad', 'Squad'),
      '{steamId}': T('pl.more-chat-messages.tok.steamId', 'Steam ID'),
      '{teams}': T('pl.more-chat-messages.tok.teams', 'Teams'),
      '{victim}': T('pl.more-chat-messages.tok.victim', 'Victim'),
      '{weapon}': T('pl.more-chat-messages.tok.weapon', 'Weapon'),
      '{x}': T('pl.more-chat-messages.tok.x', 'X position'),
      '{y}': T('pl.more-chat-messages.tok.y', 'Y position'),
    };
    return names[tok] || tok;
  }

  let state = null;
  let channels = ['local', 'global', 'squad', 'admin', 'server'];
  let statusTimer = null;

  /**
   * Which of the values we sent are not the values that came back, as `section.key`. Scalars only,
   * one level deep, because that is the whole shape of this config.
   */
  function disagreements(sent, stored) {
    const out = [];
    if (!sent || !stored) return out;
    Object.keys(sent).forEach((k) => {
      const a = sent[k];
      const b = stored[k];
      if (a && typeof a === 'object' && !Array.isArray(a)) {
        if (!b || typeof b !== 'object') { out.push(k); return; }
        Object.keys(a).forEach((kk) => {
          if (a[kk] !== null && typeof a[kk] === 'object') return;   // nothing nested here today
          if (a[kk] !== b[kk]) out.push(k + '.' + kk);
        });
        return;
      }
      if (a !== b) out.push(k);
    });
    return out;
  }

  /** Every key this screen draws that the RUNNING backend does not declare in its own defaults. */
  function missingFromBackend(defaults) {
    const out = [];
    if (!defaults || typeof defaults !== 'object') return out;   // an older build sends none
    if (!Object.prototype.hasOwnProperty.call(defaults, 'enabled')) out.push('enabled');
    CARDS.forEach((def) => {
      const d = defaults[def.key];
      if (!d || typeof d !== 'object') { out.push(def.key); return; }
      const keys = ['enabled', 'channel', 'history'];
      def.triggers.forEach((t) => { if (t.sw) keys.push(t.sw); keys.push(t.field, t.field + 'I18n'); });
      if (def.key === 'kills') keys.push('minDistance');
      keys.forEach((k) => {
        if (!Object.prototype.hasOwnProperty.call(d, k)) out.push(def.key + '.' + k);
      });
    });
    return out.filter((k, i) => out.indexOf(k) === i);
  }

  // ── small pieces, all of them the panel's own shapes ───────────────────────────────────────────

  /** A section: the panel's `.card`, an amber-ruled heading, and one sentence saying what it is for. */
  function section(ico, title, lead, kids) {
    return el('section', { class: 'card mcm-card' },
      [el('h3', {}, [icon(ico), el('span', {}, title)]),
        lead ? el('p', { class: 'mcm-lead' }, lead) : null]
        .concat((kids || []).filter(Boolean)));
  }

  /** The row's label is the control's NAME too, for a screen reader. */
  function nameCtl(ctl, label) {
    if (typeof label !== 'string' || !label || !ctl || !ctl.tagName) return;
    const f = /^(SELECT|INPUT|TEXTAREA)$/.test(ctl.tagName) ? ctl : (ctl.querySelector ? ctl.querySelector('select, input') : null);
    if (f && !f.getAttribute('aria-label') && !f.id) f.setAttribute('aria-label', label);
  }
  /** A settings row: label and hint on the left, the control on the right. */
  function row(label, control, hint) {
    nameCtl(control, label);
    return el('div', { class: 'mcm-row' }, [
      el('label', {}, label),
      hint ? el('p', { class: 'mcm-hint' }, hint) : null,
      el('div', { class: 'mcm-ctl' }, [control]),
    ]);
  }

  /** '' is a plain fact and gets no wash, so 'good' / 'bad' / 'wait' keep their meaning. */
  function note(kind, kids) {
    return el('div', { class: 'mcm-note ' + (kind || 'flat') }, Array.isArray(kids) ? kids : [kids]);
  }

  /**
   * A dropdown. The value is set on the SELECT after its options exist, so a value the list does
   * not contain leaves the box empty instead of silently reporting the first entry as the choice.
   */
  function select(value, options, onPick, label) {
    const s = el('select', { class: 'mcm-in' }, options.map(([v, l]) => el('option', { value: v }, l)));
    s.value = String(value);
    if (label) s.setAttribute('aria-label', label);
    s.addEventListener('change', () => onPick(s.value));
    return s;
  }

  function number(value, onSet, min) {
    const i = el('input', { type: 'number', class: 'mcm-in mcm-num' });
    if (min != null) i.min = String(min);
    i.value = String(value == null ? 0 : value);
    i.addEventListener('input', () => onSet(Number(i.value)));
    return i;
  }

  /**
   * The panel's own switch (`label.switch` around a checkbox) with its word beside it. `get` is read
   * whenever it is painted, so two switches bound to the same setting on two screens agree.
   */
  function toggle(get, set, title) {
    const box = el('input', { type: 'checkbox' });
    const word = el('span', {}, '');
    const sw = el('label', { class: 'switch mcm-sw' }, [box, word]);
    if (title) { sw.setAttribute('title', title); box.setAttribute('aria-label', title); }
    const paint = () => {
      const on = get() === true;
      box.checked = on;
      word.textContent = on ? T('pl.more-chat-messages.card.switch.on', 'On') : T('pl.more-chat-messages.card.switch.off', 'Off');
    };
    box.addEventListener('change', () => { set(box.checked); paint(); });
    paint();
    sw.paint = paint;
    return sw;
  }

  /**
   * Replace a container's children only when the markup really differs. A poll that redraws an
   * unchanged block throws away whatever the reader was pointing at, and every node the idle check
   * marks would be a new one ten seconds later.
   */
  function swap(box, kids) {
    const next = el('div', {}, (kids || []).filter(Boolean));
    if (box.innerHTML === next.innerHTML) return false;
    while (box.firstChild) box.removeChild(box.firstChild);
    while (next.firstChild) box.appendChild(next.firstChild);
    return true;
  }

  // ── messages: the shipped words in every language ─────────────────────────────────────────────

  // The shipped line of every message in every player language (`/text-defaults`), so each language
  // tab shows what its readers get while nobody has written one, and "Reset to default" brings it
  // back. The config keeps storing the shipped ENGLISH line for "built-in", which is what the backend
  // recognises; a box an older version left empty is drawn empty and stays silent, exactly as before.
  let shippedTexts = null;
  const shippedFor = (k) => {
    if (!shippedTexts || !shippedTexts.byLang) return undefined;
    const out = {};
    for (const l of Object.keys(shippedTexts.byLang)) {
      const t = shippedTexts.byLang[l] && shippedTexts.byLang[l][k];
      if (typeof t === 'string' && t) out[l] = t;
    }
    return Object.keys(out).length ? out : undefined;
  };
  // What a blank editor means for the stored text. The SDK reports both "this box reads its built-in
  // line" and "the owner emptied this box" as a blank; only the second is the owner's blank, which
  // this plugin has always treated as silence. The active tab and its box tell the two apart.
  const builtinOrBlank = (edEl, value, en) => {
    if (String(value || '').trim()) return value;
    const act = edEl && edEl.querySelector('.ssa-lt-tab.is-active');
    const ta = edEl && edEl.querySelector('textarea');
    return (act && act.querySelector('.ssa-lt-def') && ta && !ta.value.trim()) ? '' : en;
  };
  /** Has the owner written their own words for this message, in any language? */
  function ownWording(secKey, field) {
    const sec = state[secKey] || {};
    const en = shippedTexts && shippedTexts.english ? shippedTexts.english[secKey + '.' + field] : undefined;
    const map = sec[field + 'I18n'];
    const hasLang = map && typeof map === 'object' && Object.keys(map).some((k) => String(map[k] || '').trim());
    return hasLang || (en !== undefined && String(sec[field] == null ? '' : sec[field]) !== en);
  }
  function messageEditor(label, sec, key, holders, touch, secKey) {
    // Every player reads this line in their own language (/lang in game, the Field Console or
    // Discord): one tab per language, the server's first. An older manager has no such editor and
    // gets the single box below.
    if (typeof SSA.locText === 'function') {
      const en = shippedTexts && shippedTexts.english ? shippedTexts.english[`${secKey}.${key}`] : undefined;
      const defs = en && String(sec[key] || '').trim() ? shippedFor(`${secKey}.${key}`) : undefined;
      const ed = SSA.locText({
        label, value: defs && sec[key] === en ? '' : sec[key], i18n: sec[key + 'I18n'] || {}, rows: 3, defaults: defs,
        tokens: String(holders || '').split(/\s+/).filter(Boolean).map((tok) => ({
          token: tok, label: tokenName(tok), title: T('pl.more-chat-messages.token.title', 'Put {token} in the message', { token: tok }),
        })),
        onChange: (value, i18n) => { sec[key] = defs ? builtinOrBlank(ed && ed.el, value, en) : value; sec[key + 'I18n'] = i18n; touch(); },
      });
      return el('div', { class: 'mcm-msg' }, [ed.el]);
    }
    const onSet = (v) => { sec[key] = v; touch(); };
    const input = el('input', { type: 'text', class: 'mcm-in mcm-text' });
    input.value = sec[key] == null ? '' : String(sec[key]);
    input.addEventListener('input', () => onSet(input.value));
    const toks = el('div', { class: 'mcm-toks' }, String(holders || '').split(/\s+/).filter(Boolean).map((tok) => {
      const b = el('button', { type: 'button', class: 'mcm-tok', title: T('pl.more-chat-messages.token.title', 'Put {token} in the message', { token: tok }) }, tok);
      b.addEventListener('click', () => {
        const at = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
        const to = typeof input.selectionEnd === 'number' ? input.selectionEnd : at;
        input.value = input.value.slice(0, at) + tok + input.value.slice(to);
        onSet(input.value);
        input.focus();
        try { input.setSelectionRange(at + tok.length, at + tok.length); } catch (e) { /* not a text field */ }
      });
      return b;
    }));
    return el('div', { class: 'mcm-msg' }, [el('label', {}, [el('span', {}, label), input]), toks]);
  }

  // ── the page ───────────────────────────────────────────────────────────────────────────────────

  async function mount(container) {
    // ONE timer across mounts, stopped BEFORE the new page is built. Reopening the tab otherwise
    // stacks them, and a tick landing during the await writes into a page no longer on screen.
    if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
    onRoute = null;
    container.innerHTML = '';
    const loaded = await api('/config');
    if (!loaded || loaded.ok === false) {
      container.appendChild(el('div', { class: 'mcm' }, section('alert', T('pl.more-chat-messages.tab', 'Chat Messages'), null, [
        note('bad', T('pl.more-chat-messages.read.failed', 'The plugin\'s settings could not be read: {error}. Nothing has been changed.',
          { error: (loaded && loaded.error) || T('pl.more-chat-messages.error.noanswer', 'the manager did not answer') })),
      ])));
      return;
    }
    state = loaded.config;
    // Optional: an older backend has no such route, and the editors then simply show no built-in text.
    const shipped = await api('/text-defaults');
    shippedTexts = shipped && shipped.ok !== false ? shipped : null;
    CARDS = cardDefs();
    if (Array.isArray(loaded.channels) && loaded.channels.length) channels = loaded.channels;
    // ATTACHED sections, never `|| {}`: a detached object takes every keystroke and is read by
    // nothing, which looks exactly like a screen that works right up until Save.
    CARDS.forEach((d) => { if (!state[d.key] || typeof state[d.key] !== 'object') state[d.key] = {}; });

    const L = navLabels();
    const page = el('div', { class: 'mcm' });
    container.appendChild(page);
    let status = null;          // the last `/status` that arrived
    let statusErr = '';         // why the last one did not
    let view = 'announcements';
    const views = {};           // screen id -> { el, show() }

    // ── what this tab is, and what to do first ──────────────────────────────────────────────────
    page.appendChild(el('p', { class: 'mcm-lead mcm-top-lead' },
      T('pl.more-chat-messages.lead', 'Announce what happens on your server in the game\'s own chat, in every player\'s language.')));
    const firstRun = el('div', { class: 'mcm-firstrun' });
    page.appendChild(firstRun);
    const anyOn = () => CARDS.some((d) => state[d.key].enabled === true);
    function paintFirstRun() {
      // "Nothing is switched on" is the one state in which this plugin does nothing at all, and the
      // only thing that says so is this sentence. It names the two screens worth visiting first.
      if (anyOn()) { swap(firstRun, []); return; }
      swap(firstRun, [note('flat', [
        el('b', {}, T('pl.more-chat-messages.first.title', 'New here? Nothing is switched on, so your server says nothing new yet.')),
        el('span', {}, ' '),
        el('span', {}, T('pl.more-chat-messages.first.announcements', 'On {screen}, switch on what your players should hear.', { screen: L.announcements })),
        el('span', {}, ' '),
        el('span', {}, T('pl.more-chat-messages.first.messages', 'On {screen}, change the words in each language.', { screen: L.messages })),
      ])]);
    }

    // ── the top bar: the nav, and the save ───────────────────────────────────────────────────────
    let dirty = false;
    const dirtyWord = el('span', { class: 'mcm-dirty' }, T('pl.more-chat-messages.save.clean', 'Nothing to save'));
    const saveBtn = el('button', { type: 'button', class: 'mcm-savebtn' }, [icon('check'), el('span', {}, T('pl.more-chat-messages.save.button', 'Save'))]);
    const saveNote = el('div', { class: 'mcm-savenote' });
    const touch = () => {
      paintStat();
      paintFirstRun();
      if (dirty) return;
      dirty = true;
      dirtyWord.className = 'mcm-dirty unsaved';
      dirtyWord.textContent = T('pl.more-chat-messages.save.unsaved', 'Unsaved changes');
    };
    const nav = el('div', { class: 'mcm-nav', role: 'tablist' });
    const navBtns = {};
    SCREENS.forEach(([id, ico]) => {
      const b = el('button', { type: 'button', class: 'mcm-tab', role: 'tab', 'data-screen': id }, [icon(ico), el('span', {}, L[id])]);
      b.addEventListener('click', () => { show(id); if (ROUTE) ROUTE.go(id); });
      navBtns[id] = b;
      nav.appendChild(b);
    });
    page.appendChild(el('div', { class: 'mcm-top' }, [nav, el('div', { class: 'mcm-top-r' }, [dirtyWord, saveBtn])]));

    // ── the stat header ──────────────────────────────────────────────────────────────────────────
    const statBar = el('div', { class: 'mcm-statbar' });
    const statNotes = el('div', { class: 'mcm-live' });
    page.appendChild(statBar);
    page.appendChild(statNotes);
    page.appendChild(saveNote);
    function stat(value, label, kind) {
      return el('div', { class: 'mcm-stat' + (kind ? ' ' + kind : '') }, [el('span', { class: 'mcm-stat-v' }, String(value)), el('span', { class: 'mcm-stat-l' }, label)]);
    }
    function paintStat() {
      const on = CARDS.filter((d) => state[d.key].enabled === true).length;
      const paused = state.enabled === false;
      const st = (status && status.stats) || {};
      const kids = [
        el('div', { class: 'mcm-stat ' + (paused ? 'warn' : (on ? 'ok' : 'off')) }, [el('span', { class: 'mcm-stat-dot' }),
          el('span', { class: 'mcm-stat-l' }, paused ? T('pl.more-chat-messages.stat.paused', 'Paused')
            : (on ? T('pl.more-chat-messages.card.state.announcing', 'Announcing') : T('pl.more-chat-messages.stat.nothingon', 'Nothing on')))]),
        stat(T('pl.more-chat-messages.fig.onof', '{n} of {total}', { n: on, total: CARDS.length }), T('pl.more-chat-messages.fig.on', 'Announcements on'), on ? 'ok' : ''),
        stat(st.sent || 0, T('pl.more-chat-messages.fig.sent', 'Sent')),
        stat(st.failed || 0, T('pl.more-chat-messages.fig.failed', 'Failed'), st.failed ? 'bad' : ''),
        stat(st.skipped || 0, T('pl.more-chat-messages.result.skipped', 'Not said'), st.skipped ? 'warn' : ''),
      ];
      swap(statBar, kids);
      const notes = [];
      // Said out loud, because zeroes and an empty log read as "this is not working" when the real
      // answer is that there is no game to announce anything about yet.
      if (status && status.serverRunning === false) {
        notes.push(note('wait', T('pl.more-chat-messages.live.stopped', 'The server is stopped. Set everything up now; it goes live when it starts.')));
      }
      if (paused) {
        notes.push(note('wait', T('pl.more-chat-messages.live.paused', 'Paused: the master switch on {screen} is off. Nothing is said, and every choice is kept.', { screen: L.settings })));
      }
      if (statusErr) {
        notes.push(note('bad', T('pl.more-chat-messages.counters.stopped', 'These counters have stopped updating: {error}. Every setting below is unaffected and still saves.', { error: statusErr })));
      }
      swap(statNotes, notes);
    }

    const body = el('div', { class: 'mcm-view' });
    page.appendChild(body);

    function show(id) {
      if (!views[id]) id = 'announcements';
      view = id;
      Object.keys(navBtns).forEach((k) => {
        navBtns[k].classList.toggle('active', k === id);
        navBtns[k].setAttribute('aria-selected', k === id ? 'true' : 'false');
      });
      Object.keys(views).forEach((k) => { views[k].el.hidden = k !== id; });
      if (views[id].show) views[id].show();
    }

    // ══ 1. ANNOUNCEMENTS ═════════════════════════════════════════════════════════════════════════
    views.announcements = (function () {
      const root = el('div', { class: 'mcm-screen' });
      const picks = {};                       // announcement key -> ticked
      const filter = { q: '', show: 'all' };
      const cards = [];                       // { def, el, paint(), live(s), hay() }

      const shownNow = () => cards.filter((c) => c.matches());
      const search = el('input', { type: 'search', class: 'mcm-in mcm-search', placeholder: T('pl.more-chat-messages.ann.search', 'Find an announcement or a moment') });
      search.setAttribute('aria-label', T('pl.more-chat-messages.ann.search', 'Find an announcement or a moment'));
      search.addEventListener('input', () => { filter.q = search.value.trim().toLowerCase(); listChanged(); });
      const showSel = select('all', [
        ['all', T('pl.more-chat-messages.ann.show.all', 'All announcements')],
        ['on', T('pl.more-chat-messages.ann.show.on', 'Switched on')],
        ['off', T('pl.more-chat-messages.ann.show.off', 'Switched off')],
        ['bridge', T('pl.more-chat-messages.ann.show.bridge', 'Needing the bridge')],
        ['history', T('pl.more-chat-messages.ann.show.history', 'Kept in the chat history')],
      ], (v) => { filter.show = v; listChanged(); }, T('pl.more-chat-messages.ann.show.label', 'Show'));
      const countWord = el('span', { class: 'mcm-count' });
      const tickAll = el('button', { type: 'button', class: 'secondary mcm-tickall' });
      // Read at the PRESS: a list narrowed by the search since this button was drawn is the list the
      // reader is looking at, and the one it acts on.
      tickAll.addEventListener('click', () => {
        const now = shownNow();
        const all = now.length && now.every((c) => picks[c.def.key]);
        now.forEach((c) => { if (all) delete picks[c.def.key]; else picks[c.def.key] = true; });
        listChanged();
      });

      // The bulk bar is built ONCE and only its words change: it stays in place under the reader's
      // pointer. ⚠ So every action asks `tickedNow()` at the press and never closes over a list: a
      // bar left in place reads "2 ticked" over whatever two are ticked NOW.
      const tickedNow = () => cards.filter((c) => picks[c.def.key]);
      const bulkWord = el('span', { class: 'mcm-badge on' });
      const bulkOn = el('button', { type: 'button', class: 'secondary' }, [icon('power'), el('span', {}, T('pl.more-chat-messages.bulk.on', 'Switch on'))]);
      const bulkOff = el('button', { type: 'button', class: 'secondary' }, [icon('ban'), el('span', {}, T('pl.more-chat-messages.bulk.off', 'Switch off'))]);
      const bulkNone = el('button', { type: 'button', class: 'secondary' }, [icon('close'), el('span', {}, T('pl.more-chat-messages.bulk.untick', 'Untick all'))]);
      bulkOn.addEventListener('click', () => { tickedNow().forEach((c) => { state[c.def.key].enabled = true; c.paint(); }); touch(); listChanged(); });
      bulkOff.addEventListener('click', () => { tickedNow().forEach((c) => { state[c.def.key].enabled = false; c.paint(); }); touch(); listChanged(); });
      bulkNone.addEventListener('click', () => { Object.keys(picks).forEach((k) => delete picks[k]); listChanged(); });
      const bulkBar = el('div', { class: 'mcm-bulk mcm-bulk-sel' }, [bulkWord, bulkOn, bulkOff, bulkNone]);
      const noMatch = note('flat', T('pl.more-chat-messages.ann.nomatch', 'No announcement matches this search and filter.'));

      root.appendChild(el('div', { class: 'mcm-bulk' }, [search, showSel, countWord, tickAll]));
      root.appendChild(bulkBar);
      root.appendChild(noMatch);

      function listChanged() {
        let shown = 0;
        cards.forEach((c) => {
          const ok = c.matches();
          c.el.hidden = !ok;
          if (ok) shown += 1;
          c.tick.checked = !!picks[c.def.key];
        });
        noMatch.hidden = shown !== 0;
        countWord.textContent = shown === cards.length
          ? T('pl.more-chat-messages.bulk.count', '{n} of {total}', { n: shown, total: cards.length })
          : T('pl.more-chat-messages.bulk.countFiltered', '{n} of {total} shown', { n: shown, total: cards.length });
        const now = shownNow();
        const all = now.length && now.every((c) => picks[c.def.key]);
        tickAll.hidden = !now.length;
        tickAll.textContent = all ? T('pl.more-chat-messages.bulk.untickShown', 'Untick {n}', { n: now.length })
          : T('pl.more-chat-messages.bulk.tickShown', 'Tick {n}', { n: now.length });
        const n = tickedNow().length;
        bulkBar.hidden = !n;
        bulkWord.textContent = T('pl.more-chat-messages.bulk.ticked', 'Ticked: {n}', { n });
      }

      CARDS.forEach((def) => {
        const sec = state[def.key];
        const card = el('section', { class: 'card mcm-card mcm-ann', 'data-ann': def.key });
        const tick = el('input', { type: 'checkbox', class: 'mcm-pick' });
        tick.setAttribute('aria-label', T('pl.more-chat-messages.bulk.pickOne', 'Tick this announcement for the actions above'));
        tick.addEventListener('change', () => { if (tick.checked) picks[def.key] = true; else delete picks[def.key]; listChanged(); });
        const badge = el('span', { class: 'mcm-badge' });
        const chips = el('div', { class: 'mcm-chips' });
        const trigs = el('div', { class: 'mcm-trigs' });
        const switches = [];
        const sw = toggle(() => sec.enabled, (v) => { sec.enabled = v; paint(); touch(); listChanged(); },
          T('pl.more-chat-messages.card.switch.title', 'Switch this announcement on or off'));
        switches.push(sw);
        def.triggers.forEach((t) => {
          const preview = el('p', { class: 'mcm-trig-say' });
          const words = el('button', { type: 'button', class: 'secondary mcm-trig-edit' }, [el('span', {}, T('pl.more-chat-messages.trig.words', 'Words'))]);
          words.setAttribute('aria-label', T('pl.more-chat-messages.trig.wordsFor', 'Change the words of: {what}', { what: t.label }));
          words.addEventListener('click', () => { views.messages.focus(def.key, t.field); show('messages'); if (ROUTE) ROUTE.go('messages'); });
          // One switch per moment. A moment with no switch of its own is the announcement itself, and
          // says so rather than drawing a second switch for the same setting.
          let ctl;
          if (t.sw) {
            const s2 = toggle(() => sec[t.sw], (v) => { sec[t.sw] = v; touch(); paintPreview(); }, t.label);
            switches.push(s2);
            ctl = s2;
          } else {
            ctl = el('span', { class: 'mcm-tag' }, T('pl.more-chat-messages.trig.withcard', 'With the announcement'));
          }
          const line = el('div', { class: 'mcm-trig', 'data-field': t.field }, [ctl,
            el('div', { class: 'mcm-trig-t' }, [el('b', {}, t.label), preview]), words]);
          function paintPreview() {
            line.classList.toggle('off', !!t.sw && sec[t.sw] !== true);
            // The words as players will read them, each {token} in a code span: it is the template,
            // not a sentence with a hole in it.
            const text = String(sec[t.field] == null ? '' : sec[t.field]).trim();
            while (preview.firstChild) preview.removeChild(preview.firstChild);
            if (!text) preview.appendChild(document.createTextNode(T('pl.more-chat-messages.trig.empty', '(empty, so nothing is said)')));
            else text.split(/(\{[a-zA-Z][a-zA-Z0-9_]*\})/).filter((p) => p !== '').forEach((p) => {
              preview.appendChild(/^\{[a-zA-Z][a-zA-Z0-9_]*\}$/.test(p) ? el('code', {}, p) : document.createTextNode(p));
            });
          }
          line.paintPreview = paintPreview;
          paintPreview();
          trigs.appendChild(line);
        });
        card.appendChild(el('div', { class: 'mcm-head' }, [
          tick, icon(def.icon), el('h3', {}, def.title), badge,
          def.bridge ? el('span', { class: 'mcm-tag' }, T('pl.more-chat-messages.card.needsbridge', 'Needs the bridge')) : null,
          sw,
        ].filter(Boolean)));
        card.appendChild(el('p', { class: 'mcm-lead' }, def.what));
        card.appendChild(chips);
        const bodyEl = el('div', { class: 'mcm-body' }, [trigs]);
        card.appendChild(bodyEl);
        function paint() {
          const on = sec.enabled === true;
          card.classList.toggle('on', on);
          badge.className = 'mcm-badge' + (on ? ' on' : '');
          badge.textContent = on ? T('pl.more-chat-messages.card.state.announcing', 'Announcing') : T('pl.more-chat-messages.card.state.silent', 'Silent');
          // Dimmed, not hidden and never inert: setting the moments up before switching the
          // announcement on is the ordinary way round.
          bodyEl.classList.toggle('mcm-dim', !on);
          switches.forEach((s) => s.paint());
          Array.prototype.forEach.call(trigs.children, (ln) => { if (ln.paintPreview) ln.paintPreview(); });
        }
        const hay = () => [def.title, def.what].concat(def.triggers.map((t) => t.label + ' ' + (sec[t.field] || ''))).join(' ').toLowerCase();
        const matches = () => {
          if (filter.q && hay().indexOf(filter.q) < 0) return false;
          if (filter.show === 'on') return sec.enabled === true;
          if (filter.show === 'off') return sec.enabled !== true;
          if (filter.show === 'bridge') return !!def.bridge;
          if (filter.show === 'history') return sec.history === true;
          return true;
        };
        /** What this one is really doing, from `/status`. Only these chips are redrawn by a poll. */
        function live(s) {
          const out = [];
          if (s && sec.enabled === true && state.enabled !== false) {
            if (def.bridge && s.waitingForPlayers === true && sec.history !== true) {
              out.push(el('span', { class: 'mcm-chip wait' },
                T('pl.more-chat-messages.chip.nobody', 'Nobody online, so nothing is checked. It resumes when a player joins')));
            }
            if (def.seed && s.watching && s.watching[def.seed] === false) {
              out.push(el('span', { class: 'mcm-chip wait' },
                T('pl.more-chat-messages.chip.seeding', 'Waiting for its first readings; nothing is announced until it has two')));
            }
          }
          swap(chips, out);
        }
        paint();
        cards.push({ def, el: card, tick, paint, live, matches });
        root.appendChild(card);
      });
      listChanged();
      return {
        el: root,
        show() { cards.forEach((c) => c.paint()); listChanged(); },
        live(s) { cards.forEach((c) => c.live(s)); },
        // For the check: what a reader can press, by name.
        _cards: cards, _picks: picks, _filter: filter, _bulk: { on: bulkOn, off: bulkOff, none: bulkNone, all: tickAll, search, showSel },
      };
    }());

    // ══ 2. MESSAGES ══════════════════════════════════════════════════════════════════════════════
    views.messages = (function () {
      const root = el('div', { class: 'mcm-screen' });
      const PAGE = 6;
      const filter = { q: '', sec: '', state: '', page: 0 };
      const built = new Map();     // `sec.field` -> its item, built the first time it is shown
      root.appendChild(el('p', { class: 'mcm-lead' }, T('pl.more-chat-messages.msg.lead',
        'Every line your players read. Each has a tab per language; an empty tab sends the built-in line.')));
      const search = el('input', { type: 'search', class: 'mcm-in mcm-search', placeholder: T('pl.more-chat-messages.msg.search', 'Find a message or its words') });
      search.setAttribute('aria-label', T('pl.more-chat-messages.msg.search', 'Find a message or its words'));
      search.addEventListener('input', () => { filter.q = search.value.trim().toLowerCase(); filter.page = 0; paint(); });
      const secSel = select('', [['', T('pl.more-chat-messages.msg.filter.all', 'Every announcement')]].concat(CARDS.map((d) => [d.key, d.title])),
        (v) => { filter.sec = v; filter.page = 0; paint(); }, T('pl.more-chat-messages.msg.filter.label', 'Announcement'));
      const stateSel = select('', [
        ['', T('pl.more-chat-messages.msg.state.all', 'On and off')],
        ['on', T('pl.more-chat-messages.msg.state.on', 'Said')],
        ['off', T('pl.more-chat-messages.result.skipped', 'Not said')],
        ['own', T('pl.more-chat-messages.msg.state.own', 'Your own words')],
      ], (v) => { filter.state = v; filter.page = 0; paint(); }, T('pl.more-chat-messages.msg.state.label', 'State'));
      const countWord = el('span', { class: 'mcm-count' });
      root.appendChild(el('div', { class: 'mcm-bulk' }, [search, secSel, stateSel, countWord]));
      const list = el('div', { class: 'mcm-msglist' });
      const pager = el('div', { class: 'mcm-pager' });
      root.appendChild(list);
      root.appendChild(pager);

      /** Is this message really said: its announcement on, and its own moment on. */
      const saidNow = (d, t) => state[d.key].enabled === true && (!t.sw || state[d.key][t.sw] === true);
      function itemOf(d, t) {
        const k = d.key + '.' + t.field;
        if (built.has(k)) return built.get(k);
        const sec = state[d.key];
        const pill = el('span', { class: 'mcm-badge' });
        const set = t.sw ? (v) => { sec[t.sw] = v; touch(); paintItem(); } : (v) => { sec.enabled = v; touch(); paintItem(); };
        const sw = toggle(t.sw ? () => sec[t.sw] : () => sec.enabled, set, t.label);
        const item = el('section', { class: 'card mcm-card mcm-msgitem', 'data-msg': k }, [
          el('div', { class: 'mcm-head' }, [icon(d.icon), el('h3', {}, [el('span', { class: 'mcm-msg-sec' }, d.title + ' · '), el('span', {}, t.label)]), pill, sw]),
          messageEditor(t.msg, sec, t.field, t.toks, () => { touch(); }, d.key),
        ]);
        function paintItem() {
          sw.paint();
          const on = saidNow(d, t);
          pill.className = 'mcm-badge' + (on ? ' on' : '');
          // Off for one of two reasons, and the pill says which: the reader can fix them in two places.
          pill.textContent = on ? T('pl.more-chat-messages.msg.state.on', 'Said')
            : (state[d.key].enabled !== true ? T('pl.more-chat-messages.msg.pill.annoff', 'Announcement off') : T('pl.more-chat-messages.result.skipped', 'Not said'));
          item.classList.toggle('on', on);
        }
        const rec = { el: item, paint: paintItem, d, t };
        built.set(k, rec);
        paintItem();
        return rec;
      }
      const hay = (d, t) => [d.title, t.label, t.msg, state[d.key][t.field] || ''].concat(
        Object.values(state[d.key][t.field + 'I18n'] || {})).join(' ').toLowerCase();
      function shown() {
        return allTriggers().filter(({ def: d, t }) => {
          if (filter.sec && d.key !== filter.sec) return false;
          if (filter.state === 'on' && !saidNow(d, t)) return false;
          if (filter.state === 'off' && saidNow(d, t)) return false;
          if (filter.state === 'own' && !ownWording(d.key, t.field)) return false;
          return !filter.q || hay(d, t).indexOf(filter.q) >= 0;
        });
      }
      function paint() {
        const rows = shown();
        const total = allTriggers().length;
        const pages = Math.max(1, Math.ceil(rows.length / PAGE));
        if (filter.page >= pages) filter.page = pages - 1;
        if (filter.page < 0) filter.page = 0;
        const slice = rows.slice(filter.page * PAGE, filter.page * PAGE + PAGE);
        countWord.textContent = rows.length === total
          ? T('pl.more-chat-messages.bulk.count', '{n} of {total}', { n: rows.length, total })
          : T('pl.more-chat-messages.bulk.countFiltered', '{n} of {total} shown', { n: rows.length, total });
        // Built editors are MOVED, never rebuilt: a box keeps its tab, its caret and its draft.
        while (list.firstChild) list.removeChild(list.firstChild);
        if (!slice.length) list.appendChild(note('flat', T('pl.more-chat-messages.msg.nomatch', 'No message matches this search and these filters.')));
        slice.forEach(({ def: d, t }) => { const it = itemOf(d, t); it.paint(); list.appendChild(it.el); });
        while (pager.firstChild) pager.removeChild(pager.firstChild);
        pager.hidden = pages <= 1;
        if (pages > 1) {
          const prev = el('button', { type: 'button', class: 'secondary' }, T('pl.more-chat-messages.page.prev', '‹ Previous'));
          const next = el('button', { type: 'button', class: 'secondary' }, T('pl.more-chat-messages.page.next', 'Next ›'));
          prev.disabled = filter.page <= 0;
          next.disabled = filter.page >= pages - 1;
          prev.addEventListener('click', () => { filter.page -= 1; paint(); });
          next.addEventListener('click', () => { filter.page += 1; paint(); });
          pager.appendChild(prev);
          for (let i = 0; i < pages; i++) {
            const b = el('button', { type: 'button', class: 'secondary mcm-pg' + (i === filter.page ? ' cur' : '') }, String(i + 1));
            if (i === filter.page) b.setAttribute('aria-current', 'page');
            else b.addEventListener('click', () => { filter.page = i; paint(); });
            pager.appendChild(b);
          }
          pager.appendChild(next);
        }
      }
      return {
        el: root,
        show: paint,
        /** Open on one message: its announcement filtered, its page, nothing else changed. */
        focus(key, field) {
          filter.sec = key; filter.q = ''; filter.state = ''; search.value = ''; secSel.value = key; stateSel.value = '';
          const rows = shown();
          const i = rows.findIndex((r) => r.t.field === field);
          filter.page = i >= 0 ? Math.floor(i / PAGE) : 0;
        },
        _filter: filter, _search: search, _secSel: secSel, _stateSel: stateSel,
      };
    }());

    // ══ 3. ACTIVITY ══════════════════════════════════════════════════════════════════════════════
    views.activity = (function () {
      const root = el('div', { class: 'mcm-screen' });
      const liveBox = el('div', { class: 'mcm-live' });
      root.appendChild(section('pulse', T('pl.more-chat-messages.now.title', 'Right now'),
        T('pl.more-chat-messages.act.now.lead', 'What the plugin is following, and when it looks again. Needs a running game.'), [liveBox]));
      let recent = [];
      let lastSig = '';
      const resFilter = { v: '' };
      const resSel = select('', [
        ['', T('pl.more-chat-messages.act.filter.all', 'Every line')],
        ['sent', T('pl.more-chat-messages.result.sent', 'Sent')],
        ['nobody', T('pl.more-chat-messages.result.nobody', 'Reached nobody')],
        ['failed', T('pl.more-chat-messages.result.failed', 'Failed')],
        ['skipped', T('pl.more-chat-messages.result.skipped', 'Not said')],
      ], (v) => { resFilter.v = v; table.refresh(); }, T('pl.more-chat-messages.act.filter.label', 'Result'));
      const secOf = (r) => r.sec || '';
      const titleOf = (r) => { const d = cardOf(secOf(r)); return d ? d.title : kindLabel(r.kind); };
      const momentOf = (r) => { const t = triggerOf(secOf(r), r.field); return t ? t.label : ''; };
      const when = (at) => {
        if (!at) return '';
        const d = new Date(at);
        const today = new Date();
        // A time alone for today, the date as well for anything older: the log survives midnight.
        return d.toDateString() === today.toDateString() ? d.toLocaleTimeString(SSA.lang())
          : d.toLocaleString(SSA.lang());
      };
      const reached = (r) => {
        if (resultOf(r) === 'skipped' || resultOf(r) === 'failed') return '';
        const n = typeof r.delivered === 'number' ? String(r.delivered) : '';
        return r.history ? (n ? n + ' + ' : '') + T('pl.more-chat-messages.act.history', 'chat history') : n;
      };
      const table = SSA.table({
        columns: [
          { key: 'at', label: T('pl.more-chat-messages.said.col.when', 'When'), sort: true, sortVal: (r) => -(r.at || 0), tdClass: 'mono',
            render: (r) => el('span', { class: 'mcm-nowrap' }, when(r.at)) },
          { key: 'what', label: T('pl.more-chat-messages.said.col.what', 'What'), sort: true, sortVal: (r) => titleOf(r),
            render: (r) => el('div', { class: 'mcm-act-what' }, [SSA.cell.tag(titleOf(r), resultOf(r) === 'sent' ? 'ok' : (resultOf(r) === 'failed' ? 'bad' : '')),
              momentOf(r) ? el('small', {}, momentOf(r)) : null].filter(Boolean)) },
          { key: 'text', label: T('pl.more-chat-messages.said.col.said', 'Said'), render: (r) => document.createTextNode(r.text || '—') },
          { key: 'channel', label: T('pl.more-chat-messages.act.col.channel', 'Channel'), sort: true, sortVal: (r) => r.channel || '',
            render: (r) => document.createTextNode(r.channel ? channelLabel(r.channel) : '') },
          { key: 'reached', label: T('pl.more-chat-messages.act.col.reached', 'Players reached'), tdClass: 'mono', render: (r) => document.createTextNode(reached(r)) },
          { key: 'why', label: T('pl.more-chat-messages.act.col.result', 'Result'), sort: true, sortVal: (r) => resultOf(r),
            render: (r) => document.createTextNode(r.why ? whyText(r) : resultLabel(resultOf(r))) },
        ],
        rows: () => recent.filter((r) => !resFilter.v || resultOf(r) === resFilter.v),
        search: (r) => [titleOf(r), momentOf(r), r.text || '', whyText(r), r.channel ? channelLabel(r.channel) : ''].join(' '),
        searchPlaceholder: T('pl.more-chat-messages.said.search', 'Search what was said…'),
        toolbar: [resSel],
        pageSize: 20,
        sort: { key: 'at', dir: 'asc' },
        empty: () => (resFilter.v ? T('pl.more-chat-messages.act.emptyFiltered', 'No line with this result yet.')
          : T('pl.more-chat-messages.said.empty', 'Nothing announced yet. With an announcement switched on this fills up as the server plays.')),
      });
      const ringWord = el('span', {});
      root.appendChild(section('list', T('pl.more-chat-messages.said.title', 'What it has said'),
        null, [el('p', { class: 'mcm-lead' }, ringWord), table.el]));

      /** One line about what a polled announcement is following, or null when it is off. */
      function watchLines(s) {
        const w = s.watch || {};
        const out = [];
        const on = (k) => state[k] && state[k].enabled === true && state.enabled !== false;
        const phase = (c) => (c.phase === 'down' ? T('pl.more-chat-messages.watch.landed', 'landed')
          : (c.phase === 'air' ? T('pl.more-chat-messages.watch.air', 'in the air') : T('pl.more-chat-messages.watch.unknown', 'state not read yet')));
        const line = (label, items, none) => el('div', { class: 'mcm-watch' }, [el('b', {}, label), el('span', {}, items.length ? items.join(' · ') : none)]);
        if (on('cargo') && Array.isArray(w.cargo)) {
          out.push(line(cardOf('cargo').title, w.cargo.map((c) => (c.sector ? c.sector + ', ' : '') + phase(c)),
            T('pl.more-chat-messages.watch.nocargo', 'No cargo drop on the island')));
        }
        if (on('events') && Array.isArray(w.events)) {
          out.push(line(cardOf('events').title, w.events.map((e) => (e.location ? T('pl.more-chat-messages.watch.eventAt', '{event} at {location}', { event: e.name, location: e.location }) : e.name)
            + ': ' + (e.running ? T('pl.more-chat-messages.watch.running', 'running')
              : T('pl.more-chat-messages.watch.signedUp', 'signed up: {n}', { n: e.registered == null ? '?' : e.registered }))),
            T('pl.more-chat-messages.watch.noevents', 'No sign-ups and no round running')));
        }
        [['bunkersAbandoned', 'bunkersAbandoned'], ['bunkersSecret', 'bunkersSecret']].forEach(([k, wk]) => {
          if (on(k) && Array.isArray(w[wk])) {
            out.push(line(cardOf(k).title, w[wk].map((sct) => T('pl.more-chat-messages.watch.openIn', 'open in {sector}', { sector: sct })),
              T('pl.more-chat-messages.watch.nobunker', 'None open')));
          }
        });
        return out;
      }

      function paintLive() {
        const s = status;
        const out = [];
        if (!s) { swap(liveBox, [note('wait', T('pl.more-chat-messages.act.loading', 'Asking the plugin what it is doing…'))]); return; }
        const polled = ['cargo', 'events', 'bunkersAbandoned', 'bunkersSecret'].filter((k) => state[k] && state[k].enabled === true);
        if (state.enabled === false) {
          out.push(note('wait', T('pl.more-chat-messages.live.paused', 'Paused: the master switch on {screen} is off. Nothing is said, and every choice is kept.', { screen: L.settings })));
        } else if (!polled.length) {
          out.push(note('flat', T('pl.more-chat-messages.act.nopolled', 'Kills, joins, leaves and raids are said the moment the server log has them. Nothing else is due.')));
        } else {
          const nextIn = s.nextCheckAt ? Math.max(0, Math.round((s.nextCheckAt - Date.now()) / 1000)) : null;
          out.push(note('flat', [
            el('span', {}, T('pl.more-chat-messages.act.cadence', 'Cargo drops, game events and bunkers are checked every {s} s.', { s: s.checkSeconds || 5 })),
            el('span', {}, ' '),
            // Rounded to the check period, so a ten-second poll does not redraw a counting number.
            el('span', {}, nextIn == null ? T('pl.more-chat-messages.act.nocheck', 'No check has run yet.')
              : (nextIn <= (s.checkSeconds || 5) ? T('pl.more-chat-messages.act.next.soon', 'The next check is due within {s} s.', { s: s.checkSeconds || 5 })
                : T('pl.more-chat-messages.act.next.late', 'The next check is late; the manager may be busy.'))),
          ]));
          if (s.waitingForPlayers === true) out.push(note('wait', T('pl.more-chat-messages.act.waiting', 'Nobody is online, so cargo drops and game events are not checked. It resumes when a player joins.')));
          const wl = watchLines(s);
          if (wl.length) out.push(el('div', { class: 'mcm-watchlist' }, wl));
        }
        // A switch that is ON and silent with no explanation is the worst of the three states.
        if (state.events && state.events.enabled && state.events.announceJoin
            && s.watching && s.watching.seededEvents && s.watching.eventPlayersAvailable === false) {
          out.push(note('wait', participantsWhere()));
        }
        // Nothing before 5.14.8 kept the log line a secret bunker writes.
        if (s.watching && s.watching.secretBunkersSupported === false) {
          out.push(note('bad', T('pl.more-chat-messages.live.nosecretbunkers', 'This manager cannot announce secret bunkers; update it. You can still set this up.')));
        }
        // A REQUEST that failed is not a world with nothing in it. ⚠ CARGO AND GAME EVENTS, NOT
        // BUNKERS: only those two ask the bridge, so only they can set this error.
        if (s.pollError && s.watching && (s.watching.cargo || s.watching.events)) {
          out.push(note('bad', T('pl.more-chat-messages.live.pollerror', 'Cargo drops and game events cannot be watched: {error}. Everything else here still works.',
            { error: pollErrorText(s) })));
        }
        swap(liveBox, out);
      }
      function apply(s) {
        recent = Array.isArray(s && s.recent) ? s.recent : [];
        ringWord.textContent = T('pl.more-chat-messages.act.log.lead', 'Lines kept: {n}. Newest first, with every line not said and why. Clears on manager restart.',
          { n: (s && s.ring) || 200 });
        // The table redraws only when the log moved: the newest row and the count say whether it did.
        const sig = recent.length + '|' + (recent[0] ? recent[0].at + recent[0].text : '');
        if (sig !== lastSig) { lastSig = sig; table.refresh(); }
        paintLive();
      }
      return { el: root, show: paintLive, apply, _table: table, _resSel: resSel, _rows: () => recent };
    }());

    // ══ 4. SETTINGS ══════════════════════════════════════════════════════════════════════════════
    views.settings = (function () {
      const root = el('div', { class: 'mcm-screen' });
      const master = toggle(() => state.enabled !== false, (v) => { state.enabled = v; touch(); },
        T('pl.more-chat-messages.set.master', 'Announce in chat'));
      root.appendChild(section('power', T('pl.more-chat-messages.set.master.title', 'Master switch'), null, [
        row(T('pl.more-chat-messages.set.master', 'Announce in chat'), master,
          T('pl.more-chat-messages.set.master.hint', 'Off pauses every announcement and keeps what each one is set to.')),
      ]));

      // Where each announcement goes: one row each, and one control that sets every channel at once.
      const rows = [];
      const chanRows = el('div', { class: 'mcm-chanrows' });
      CARDS.forEach((d) => {
        const sec = state[d.key];
        const ch = select(channels.includes(String(sec.channel)) ? String(sec.channel) : 'global',
          channels.map((c) => [c, channelLabel(c)]), (v) => { sec.channel = v; touch(); },
          T('pl.more-chat-messages.set.channelFor', 'Chat channel for {what}', { what: d.title }));
        const hist = toggle(() => sec.history === true, (v) => { sec.history = v; touch(); },
          T('pl.more-chat-messages.set.historyFor', 'Keep {what} in the chat history', { what: d.title }));
        rows.push({ d, ch, hist });
        chanRows.appendChild(el('div', { class: 'mcm-chanrow', 'data-ann': d.key }, [
          el('span', { class: 'mcm-chan-t' }, [icon(d.icon), el('span', {}, d.title)]),
          el('div', { class: 'mcm-chan-c' }, [ch]),
          el('div', { class: 'mcm-chan-h' }, [hist]),
        ]));
      });
      const every = select('global', channels.map((c) => [c, channelLabel(c)]), () => {}, T('pl.more-chat-messages.set.every', 'Every announcement on one channel'));
      const apply = el('button', { type: 'button', class: 'secondary' }, [icon('check'), el('span', {}, T('pl.more-chat-messages.set.every.apply', 'Use for all'))]);
      // The value is read at the press, not when the button was drawn.
      apply.addEventListener('click', () => {
        const v = every.value;
        rows.forEach((r) => { state[r.d.key].channel = v; r.ch.value = v; });
        touch();
      });
      root.appendChild(section('chat', T('pl.more-chat-messages.set.where.title', 'Where each one goes'),
        T('pl.more-chat-messages.card.channel.hint', 'How the line looks in game (its colour). Every player sees it either way.'), [
          el('div', { class: 'mcm-chanhead' }, [el('span', {}, ''), el('span', {}, T('pl.more-chat-messages.card.channel', 'Chat channel')),
            el('span', {}, T('pl.more-chat-messages.card.history', 'Keep it in the chat history'))]),
          chanRows,
          el('p', { class: 'mcm-hint' }, T('pl.more-chat-messages.card.history.hint', 'Also shows the line in the admin chat view, Field Console and Discord chat channel.')),
          el('div', { class: 'mcm-bulk' }, [every, apply]),
        ]));

      const kills = state.kills;
      root.appendChild(section('skull', cardOf('kills').title, null, [
        row(T('pl.more-chat-messages.kills.num.mindistance', 'Say nothing under this many metres'),
          number(kills.minDistance == null ? 0 : kills.minDistance, (n) => { kills.minDistance = n; touch(); }, 0),
          T('pl.more-chat-messages.kills.num.mindistance.hint', '0 announces every kill.')),
      ]));
      return {
        el: root,
        show() { master.paint(); rows.forEach((r) => { r.ch.value = channels.includes(String(state[r.d.key].channel)) ? String(state[r.d.key].channel) : 'global'; r.hist.paint(); }); },
        _every: every, _apply: apply, _rows: rows,
      };
    }());

    SCREENS.forEach(([id]) => body.appendChild(views[id].el));

    // ── save ─────────────────────────────────────────────────────────────────────────────────────
    // Where a save says what it really did: under the bar rather than in a toast, because a toast is
    // gone before an owner has read which setting did not land.
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      const r = await api('/config', { method: 'POST', body: state });
      saveBtn.disabled = false;
      while (saveNote.firstChild) saveNote.removeChild(saveNote.firstChild);
      // ⚠ **NOT `state = r.config`.** Every control captured its section when it was built, so
      // replacing the object leaves the inputs writing into the old one while the next save sends
      // the new one. The echo is READ instead, compared against what was sent.
      if (!r || r.ok === false) {
        if (SSA.toast) SSA.toast((r && r.error) || T('pl.more-chat-messages.save.failed.toast', 'Could not save — nothing was changed'), 'error');
        saveNote.appendChild(note('bad', T('pl.more-chat-messages.save.failed', 'Nothing was saved: {error}. Your changes are still on the screen.',
          { error: (r && r.error) || T('pl.more-chat-messages.error.noanswer', 'the manager did not answer') })));
        return;
      }
      // ⚠ **A SAVE THAT ANSWERS `ok` AND STORED SOMETHING ELSE IS THE ONE FAILURE NOBODY CAN SEE.**
      const lost = disagreements(state, r.config).concat(Array.isArray(r.dropped) ? r.dropped : []);
      const shown = lost.filter((k, i) => lost.indexOf(k) === i).slice(0, 6);
      if (!shown.length) {
        dirty = false;
        dirtyWord.className = 'mcm-dirty';
        dirtyWord.textContent = T('pl.more-chat-messages.save.saved', 'Saved');
        if (SSA.toast) SSA.toast(T('pl.more-chat-messages.save.saved', 'Saved'));
        return;
      }
      if (SSA.toast) SSA.toast((shown.length === 1 ? T('pl.more-chat-messages.save.partial.toast.one', 'Saved, but {n} setting did not land', { n: shown.length }) : T('pl.more-chat-messages.save.partial.toast', 'Saved, but {n} settings did not land', { n: shown.length })), 'error');
      saveNote.appendChild(note('bad', [
        el('b', {}, T('pl.more-chat-messages.save.partial', 'These were not stored: ')), el('span', {}, shown.join(', ')), el('span', {}, '. '),
        el('span', {}, T('pl.more-chat-messages.save.partial.why', 'The manager runs an older copy of this plugin. Restart it and set them again.')),
      ]));
    });

    // Before anything is typed: a control this screen draws that the code behind it has never heard
    // of cannot be saved, and finding that out after a refresh is the worst way to learn it.
    const unsettable = missingFromBackend(loaded.defaults);
    if (unsettable.length) {
      saveNote.appendChild(note('bad', (unsettable.length === 1
        ? T('pl.more-chat-messages.unsettable.one',
          'This screen is newer than the running plugin, so {n} setting cannot be saved: {list}. Restart the manager.',
          { n: unsettable.length, list: unsettable.slice(0, 6).join(', ') })
        : T('pl.more-chat-messages.unsettable',
          'This screen is newer than the running plugin, so {n} settings cannot be saved: {list}. Restart the manager.',
          { n: unsettable.length, list: unsettable.slice(0, 6).join(', ') }))));
    }

    // ── the live half ────────────────────────────────────────────────────────────────────────────
    async function refresh(first) {
      // ⚠ **A TIMER OUTLIVES ITS PAGE.** A page taken out of the document stops its own timer; one
      // that is merely hidden (another tab, a minimised window) skips the tick.
      if (!page.isConnected) {
        if (statusTimer === ownTimer) statusTimer = null;
        clearInterval(ownTimer);
        return;
      }
      if (first !== true && (document.hidden || !page.getClientRects().length)) return;
      const s = await api('/status');
      if (!s || s.ok === false) {
        // The figures keep what last arrived: a stale number is not the same claim as an empty one.
        statusErr = (s && s.error) || T('pl.more-chat-messages.error.noanswer', 'the manager did not answer');
        paintStat();
        return;
      }
      statusErr = '';
      status = s;
      paintStat();
      views.announcements.live(s);
      views.activity.apply(s);
    }

    paintFirstRun();
    paintStat();
    // A deep link opens its screen; Back and Forward move between screens.
    const wanted = ROUTE ? String(ROUTE.get() || '').split('/')[0] : '';
    show(views[wanted] ? wanted : 'announcements');
    onRoute = (sub) => { const id = String(sub || '').split('/')[0]; if (page.isConnected) show(views[id] ? id : 'announcements'); };
    let ownTimer = null;
    await refresh(true);
    // The await above is a window in which this page can have been replaced: a newer mount keeps
    // its own timer and this one starts none.
    if (!page.isConnected) return;
    if (statusTimer) clearInterval(statusTimer);
    ownTimer = setInterval(refresh, 10000);
    statusTimer = ownTimer;
    // For the check rig only: the screens and their handles, never read by the panel.
    container._mcm = { views, show, state: () => state, refresh };
  }

  // ⚠ `label` and `render`, not `title` and `mount`, and the tab's icon is a sprite REFERENCE.
  SSA.ready(function () {
    SSA.registerTab({ id: ID, label: T('pl.more-chat-messages.tab', 'Chat Messages'), icon: '#i-chat', render: mount });
  });
})();
