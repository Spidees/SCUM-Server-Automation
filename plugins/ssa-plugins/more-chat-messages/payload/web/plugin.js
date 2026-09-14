/* eslint-env browser */
'use strict';

// More Chat Messages — the settings screen.
//
// The page is four things in this order: what it is doing right now, the eight announcements, the
// timing that governs the four polled ones, and what it has actually said. The figures an owner
// opens this tab for are at the top; the save bar rides at the bottom and says whether there is
// anything to save.
//
// EVERYTHING HERE IS EDITABLE WITH THE SERVER STOPPED, which is the better moment to write it.
// Only the counters and the recent list need a running game, and the screen says so rather than
// showing three zeroes that read as "it is not working".
//
// ── STATE IS SAID TWICE: IN COLOUR AND IN A WORD ────────────────────────────────────────────────
// Every announcement carries a switch, a pill that reads "Announcing" or "Silent", and an amber
// edge down the card when it is on. A reader scrolling picks up the edge; a reader looking at one
// card reads the word. Colour alone is a claim somebody cannot check.

(function () {
  const ID = 'more-chat-messages';

  // ⚠ **THE PLUGIN'S OWN BACKEND IS `/api/plugin-host/<id>/…`, NOT `/api/plugins/…`.** The second
  // is the plugin MANAGEMENT surface — list, install, uninstall — so a hand-rolled fetch there
  // 404s on every read and every save, and a helper that turns that into `{}` leaves the tab saying
  // "the settings could not be read" for ever with nothing in any log. `SSA.apiClient()` builds the
  // right URL, binds this plugin's id at RENDER time (`SSA.api` resolves at CALL time, and every
  // call here is a tick or a click, which the SDK cannot attribute), and refuses to treat a 4xx as
  // an empty answer.
  const client = SSA.apiClient();
  const api = async (path, opts) => {
    try { return await client(path, opts); }
    catch (err) { return { ok: false, error: SSA.apiError ? SSA.apiError(err) : 'that did not work' }; }
  };

  // ⚠ `SSA.el`, the SDK's own element helper. This file used to carry a second one of its own,
  // which is a helper to keep in step with the panel's for no gain. There is no `SSA.h` — a
  // sibling plugin wrote `SSA.h || function …` and took its own fallback on every render it has
  // ever done — so the name is spelled out rather than guarded.
  const el = SSA.el;
  const icon = (name) => (SSA.icon ? SSA.icon(name) : el('span', {}));

  // One entry per announcement. `fields` is what the card draws; the order is the order an owner
  // reads it in. `seed` names the flag in `/status` that says whether this one has a baseline yet —
  // a polled announcement says nothing from its first reading, which is a real state and not a
  // fault, and without this the card is on, silent, and gives no reason.
  const CARDS = [
    { key: 'kills', icon: 'skull', title: 'Kills',
      what: 'Every death the manager\'s kill feed sees, in the words the game itself uses for a weapon and an actor. '
        + 'The kill log carries no position the plugin can read, so a kill line has no sector.',
      fields: [
        // No `{sector}`: the kill event carries the two positions only inside a sentence the
        // manager formatted for an embed, so there is nothing here to turn into a sector. It was
        // offered on all three lines and was blank on every kill on every server.
        ['message', 'When one player kills another', '{killer} {victim} {weapon} {distance}'],
        ['messageNoKiller', 'When the game names no killer — a fall, a mine, a trap', '{victim} {weapon}'],
        ['selfMessage', 'When somebody kills themselves', '{victim}'],
      ],
      numbers: [['minDistance', 'Say nothing under this many metres', '0 announces every kill.']] },
    { key: 'joins', icon: 'user', title: 'Players joining',
      what: 'One line when a player connects. The sector is where the game says they logged in; '
        + 'the squad is empty for a solo player and while the save cannot be read.',
      fields: [['message', 'Message', '{name} {steamId} {sector} {squad}']] },
    { key: 'leaves', icon: 'logout', title: 'Players leaving',
      what: 'One line when a player disconnects, with the sector they logged out in.',
      fields: [['message', 'Message', '{name} {steamId} {sector} {squad}']] },
    { key: 'cargo', icon: 'box', title: 'Cargo drops', bridge: true, seed: 'seededCargo',
      numbers: [['everySeconds', 'Ask every … seconds', '0 uses the shared interval below. ⚠ This one asks the SSA Bridge, and one ask walks every object in the running game - so halving it doubles that work for the server. Never faster than every 30 seconds, and not asked at all while nobody is online unless the line is kept in the chat history.']],
      what: 'A drop exists from the moment the game schedules it, so it can be announced while it is '
        + 'still in the air. This is the only announcement here that needs the SSA Bridge: cargo is '
        + 'in no log and in no save table, and exists only in the running game.',
      toggles: [['announceIncoming', 'On the way down'],
        ['announceLanded', 'Landing'],
        ['announceGone', 'Gone']],
      fields: [
        ['incomingMessage', 'On the way down', '{sector} {x} {y}'],
        ['landedMessage', 'Landed', '{sector} {x} {y}'],
        ['goneMessage', 'Gone', '{sector} {x} {y}'],
      ] },
    // `trophy`, because that is what the panel's own map layer for these events wears. There is no
    // `i-flag` and no `i-flag2` in the sprite, and a sprite id that does not exist draws NOTHING --
    // no error, no broken-image mark, just a card head with a hole where its neighbours have an
    // icon. One vocabulary for one thing, and it is the panel's.
    { key: 'events', icon: 'trophy', title: 'Game events', bridge: true, seed: 'seededEvents',
      numbers: [['everySeconds', 'Ask every … seconds', '0 uses the shared interval below. ⚠ This one asks the SSA Bridge, and one ask walks every object in the running game - so halving it doubles that work for the server. Never faster than every 30 seconds, and not asked at all while nobody is online unless the line is kept in the chat history.']],
      what: 'Deathmatch, capture the flag and drop zone. Announced when sign-ups open, when it '
        + 'starts and when it ends. Needs the SSA Bridge - the game writes nothing about events to '
        + 'any of its logs, so there is no other source. Naming the person who signed up needs one '
        + 'more switch, "Who is in the event", in the bridge\'s World events module; without it the '
        + 'counts still work.',
      toggles: [
        ['announceOpen', 'Sign-ups open'],
        ['announceJoin', 'Each person who signs up'],
        ['announceCount', 'Sign-up count changes'],
        ['announceStart', 'The event starts'],
        ['announceEnd', 'The event ends'],
      ],
      fields: [
        ['openMessage', 'Sign-ups open', '{event} {location} {sector} {registered}'],
        ['joinMessage', 'Someone signed up', '{player} {event} {location} {sector} {registered}'],
        ['countMessage', 'Sign-up count', '{event} {location} {sector} {registered}'],
        ['startMessage', 'Started', '{event} {location} {sector} {participants} {teams}'],
        ['endMessage', 'Ended', '{event} {location} {sector}'],
      ] },
    { key: 'bunkersSecret', icon: 'lock', title: 'Secret bunkers', seed: 'seededSecretBunkers',
      numbers: [['everySeconds', 'Ask every … seconds', '0 uses the shared interval below. Bunkers come from the server\'s own log, so this costs the game nothing and can be as fast as you like.']],
      what: 'The key card ones. Announced the moment a player opens one, and again when its window '
        + 'runs out if you want that. Read from the server\'s own log, so it needs no bridge. '
        + 'The game gives these no position, so only {sector} is filled in here.',
      toggles: [['announceClose', 'Closing as well as opening']],
      fields: [['openMessage', 'Opened', '{sector}'], ['closeMessage', 'Closed', '{sector}']] },
    { key: 'bunkersAbandoned', icon: 'lock', title: 'Abandoned bunkers', seed: 'seededBunkers',
      numbers: [['everySeconds', 'Ask every … seconds', '0 uses the shared interval below. Bunkers come from the server\'s own log, so this costs the game nothing and can be as fast as you like.']],
      what: 'The scheduled ones that open and lock on their own rota. Announced the moment the '
        + 'game writes the change to its log, so it needs no bridge.',
      toggles: [['announceClose', 'Locking as well as opening']],
      fields: [['openMessage', 'Active', '{sector} {x} {y}'], ['closeMessage', 'Locked', '{sector} {x} {y}']] },
    { key: 'raids', icon: 'shield', title: 'Bases being raided',
      what: 'The same alert the manager sends a base owner, said out loud.',
      toggles: [['includeOwner', 'Name the base owner']],
      fields: [['message', 'Message', '{sector} {element} {squad}'],
        ['ownerMessage', 'Message when naming the owner', '{owner} {squad} {sector} {element}']] },
  ];

  // The value the backend stores is the lower-case word; this is only what a reader sees. A channel
  // a future backend adds and this list has never heard of keeps its own spelling rather than
  // vanishing from the dropdown.
  const CHANNEL_LABEL = {
    local: 'Local — heard nearby',
    global: 'Global — the whole server',
    squad: 'Squad',
    admin: 'Admin — admins only',
    server: 'Server',
  };

  let state = null;
  let channels = ['local', 'global', 'squad', 'admin', 'server'];
  let statusTimer = null;

  /**
   * Which of the values we sent are not the values that came back, as `section.key`.
   *
   * Scalars only, and one level deep, because that is the whole shape of this config -- a section
   * of flat switches, words and numbers. A field the backend does not know does not appear in the
   * echo at all, which is `undefined` against something, so it lands here too.
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

  /** Every key the cards draw that the RUNNING backend does not declare in its own defaults. */
  function missingFromBackend(defaults) {
    const out = [];
    if (!defaults || typeof defaults !== 'object') return out;   // an older build sends none
    CARDS.forEach((def) => {
      const d = defaults[def.key];
      if (!d || typeof d !== 'object') { out.push(def.key); return; }
      const keys = ['enabled', 'channel']
        .concat((def.toggles || []).map((x) => x[0]))
        .concat((def.fields || []).map((x) => x[0]))
        .concat((def.numbers || []).map((x) => x[0]));
      keys.forEach((k) => {
        if (!Object.prototype.hasOwnProperty.call(d, k)) out.push(def.key + '.' + k);
      });
    });
    return out;
  }

  // ── small pieces, all of them the panel's own shapes ───────────────────────────────────────────

  /** A section: the panel's `.card`, an amber-ruled heading, and one sentence saying what it is for. */
  function section(ico, title, lead, kids) {
    return el('section', { class: 'card mcm-card' },
      [el('h3', {}, [icon(ico), el('span', {}, title)]),
        lead ? el('p', { class: 'mcm-lead' }, lead) : null]
        .concat((kids || []).filter(Boolean)));
  }

  /** A block inside a card — one surface step up from the card, with a name on it. */
  function block(title, kids) {
    return el('div', { class: 'mcm-block' },
      [title ? el('div', { class: 'mcm-block-t' }, title) : null].concat((kids || []).filter(Boolean)));
  }

  /**
   * A settings row: label and hint on the left, the control on the right.
   *
   * The hint belongs under the LABEL, which is where the panel's own settings screens put it — a
   * hint under the control pushes the next row's control out of line with this one.
   */
  function row(label, control, hint) {
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
   * A dropdown.
   *
   * The current value is set on the SELECT after its options exist rather than by marking one of
   * them — a value the list does not contain then leaves the box empty instead of silently
   * selecting the first entry and reporting it as the owner's choice, and the caller can see it.
   */
  function select(value, options, onPick) {
    const s = el('select', { class: 'mcm-in' }, options.map(([v, label]) => el('option', { value: v }, label)));
    s.value = String(value);
    s.addEventListener('change', () => onPick(s.value));
    return s;
  }

  function number(value, onSet, min, max) {
    const i = el('input', { type: 'number', class: 'mcm-in mcm-num' });
    if (min != null) i.min = String(min);
    if (max != null) i.max = String(max);
    i.value = String(value == null ? 0 : value);
    i.addEventListener('input', () => onSet(Number(i.value)));
    return i;
  }

  /**
   * A switch that reads as a word rather than as a bare tick box.
   *
   * `check-contrast` folds this page into the panel's cascade, so the global `button:hover` — an
   * amber fill with near-black text — applies here too. The pair is retuned on the element in the
   * stylesheet; nothing overrides one half of it in a `:hover` rule.
   */
  function choice(label, value, onSet) {
    const b = el('button', { type: 'button', class: 'mcm-chk' + (value ? ' on' : '') },
      [icon(value ? 'check' : 'close'), el('span', {}, label)]);
    b.addEventListener('click', () => {
      const next = !b.classList.contains('on');
      b.classList.toggle('on', next);
      b.replaceChild(icon(next ? 'check' : 'close'), b.firstChild);
      onSet(next);
    });
    return b;
  }

  /**
   * A message box and the placeholders it can carry.
   *
   * The placeholders are the whole of the documentation an owner needs at the moment they are
   * typing, so they are buttons rather than a run of grey text: clicking one drops it in at the
   * cursor. Nothing else on this page can tell you what `{element}` is called.
   */
  function messageField(label, value, holders, onSet) {
    const input = el('input', { type: 'text', class: 'mcm-in mcm-text', value: value == null ? '' : String(value) });
    input.addEventListener('input', () => onSet(input.value));
    const toks = el('div', { class: 'mcm-toks' }, String(holders || '').split(/\s+/).filter(Boolean).map((tok) => {
      const b = el('button', { type: 'button', class: 'mcm-tok', title: 'Put ' + tok + ' in the message' }, tok);
      b.addEventListener('click', () => {
        // At the cursor where the field has one, appended where it does not — a number field and a
        // field that has never been focused both report no selection.
        const at = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
        const to = typeof input.selectionEnd === 'number' ? input.selectionEnd : at;
        input.value = input.value.slice(0, at) + tok + input.value.slice(to);
        onSet(input.value);
        input.focus();
        try { input.setSelectionRange(at + tok.length, at + tok.length); } catch (e) { /* not a text field */ }
      });
      return b;
    }));
    // The input sits INSIDE its label, which is what associates the two without an id — and ids
    // here would have to be unique across eight cards' worth of fields called `message`.
    return el('div', { class: 'mcm-msg' }, [el('label', {}, [el('span', {}, label), input]), toks]);
  }

  // ── an announcement ────────────────────────────────────────────────────────────────────────────

  /**
   * One announcement card. Returns `{ el, live }` — `live` is handed each `/status` payload so the
   * header can say what this one is really doing, and is the only part of the card a poll redraws.
   *
   * ⚠ **Nothing interactive is rebuilt on a poll.** Every control here is built once and never
   * replaced: a box that is re-created under a reader every ten seconds loses their cursor, and
   * loses a half-typed number with it.
   */
  function announcement(def, touch) {
    // ATTACHED, not `|| {}`. A detached section takes every keystroke in the card and is read by
    // nothing, which looks exactly like a card that works right up until Save.
    if (!state[def.key] || typeof state[def.key] !== 'object') state[def.key] = {};
    const sec = state[def.key];

    const badge = el('span', { class: 'mcm-badge' });
    const chips = el('div', { class: 'mcm-chips' });
    const body = el('div', { class: 'mcm-body' });
    const root = el('section', { class: 'card mcm-card mcm-ann' });

    const box = el('input', { type: 'checkbox' });
    box.checked = sec.enabled === true;
    const swWord = el('span', {}, '');
    const sw = el('label', { class: 'switch mcm-sw', title: 'Switch this announcement on or off' }, [box, swWord]);

    function paintState() {
      const on = sec.enabled === true;
      root.classList.toggle('on', on);
      badge.className = 'mcm-badge' + (on ? ' on' : '');
      badge.textContent = on ? 'Announcing' : 'Silent';
      swWord.textContent = on ? 'On' : 'Off';
      // Dimmed, not hidden and never inert: an owner writing the wording before switching the
      // announcement on is the ordinary way round, and a card that empties itself when it is off
      // cannot be prepared.
      body.classList.toggle('mcm-dim', !on);
    }
    box.addEventListener('change', () => { sec.enabled = box.checked; paintState(); touch(); });

    // ── where it goes, and how often it looks ────────────────────────────────────────────────────
    const where = [row('Chat channel',
      select(channels.includes(String(sec.channel)) ? String(sec.channel) : 'global',
        channels.map((c) => [c, CHANNEL_LABEL[c] || c]),
        (v) => { sec.channel = v; touch(); }),
      'Where the line appears in game. The channel decides who sees it, not who it is about.')];

    // The other place a line can go, and the reason it is a separate control: the game does not log
    // what a plugin sends, so without this an announcement is visible in game and nowhere else.
    where.push(row('Keep it in the chat history',
      choice('Chat history', sec.history === true, (v) => { sec.history = v; touch(); }),
      'Also puts the line in the admin chat view, the Field Console and your Discord chat channel. '
      + 'SCUM does not record what a plugin says, so until this is on the announcement lives only in '
      + 'the game.'));

    (def.numbers || []).forEach(([k, label, hint]) => {
      where.push(row(label, number(sec[k] == null ? 0 : sec[k], (n) => { sec[k] = n; touch(); }, 0), hint));
    });

    body.appendChild(block('Where it goes', where));

    if ((def.toggles || []).length) {
      body.appendChild(block('What it announces', [
        el('p', { class: 'mcm-hint' }, 'Each moment is its own line. Switch off the ones your server does not need.'),
        el('div', { class: 'mcm-chks' }, def.toggles.map(([k, label]) =>
          choice(label, sec[k] === true, (v) => { sec[k] = v; touch(); }))),
      ]));
    }

    body.appendChild(block('What it says', (def.fields || []).map(([k, label, holders]) =>
      messageField(label, sec[k], holders, (v) => { sec[k] = v; touch(); }))));

    root.appendChild(el('div', { class: 'mcm-head' }, [
      icon(def.icon),
      el('h3', {}, def.title),
      badge,
      def.bridge ? el('span', { class: 'mcm-tag' }, 'Needs the bridge') : null,
      sw,
    ].filter(Boolean)));
    root.appendChild(el('p', { class: 'mcm-lead' }, def.what));
    root.appendChild(chips);
    root.appendChild(body);
    paintState();

    /**
     * What this one is really doing, from `/status`.
     *
     * The backend has published `intervals` and the four `seeded*` flags since it was written and
     * nothing read them, so an owner could not tell "this asks every 30 seconds because the shared
     * interval won" from "this asks every 30 seconds because I typed 30", nor "on and silent
     * because nothing has happened" from "on and silent because it has no baseline yet".
     */
    function live(s) {
      chips.innerHTML = '';
      if (!s || !sec.enabled) return;
      const every = s.intervals && s.intervals[def.key];
      if (every) {
        const own = Number(sec.everySeconds) > 0;
        chips.appendChild(el('span', { class: 'mcm-chip' },
          [el('b', {}, 'Asks every ' + every + ' s'), el('span', {}, own ? ' · its own' : ' · shared')]));
      }
      if (def.bridge && s.waitingForPlayers === true && !sec.history) {
        chips.appendChild(el('span', { class: 'mcm-chip wait' },
          'Nobody is online, so the game is not being asked - it starts again when a player joins'));
      }
      if (def.seed && s.watching && s.watching[def.seed] === false) {
        chips.appendChild(el('span', { class: 'mcm-chip wait' },
          'Waiting for its first reading — nothing is announced until it has seen the world twice'));
      }
    }

    return { el: root, live };
  }

  // ── the page ───────────────────────────────────────────────────────────────────────────────────

  async function mount(container) {
    // ONE timer across mounts, stopped BEFORE the new page is built rather than after. Reopening
    // the tab otherwise stacks them, and a tick landing during the await writes counters into the
    // nodes of a page that is no longer on screen.
    if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
    container.innerHTML = '';
    const loaded = await api('/config');
    if (!loaded || loaded.ok === false) {
      container.appendChild(el('div', { class: 'mcm' }, section('alert', 'Chat Messages', null, [
        note('bad', 'The plugin\'s settings could not be read: '
          + ((loaded && loaded.error) || 'the manager did not answer')
          + '. Nothing has been changed.'),
      ])));
      return;
    }
    state = loaded.config;
    if (Array.isArray(loaded.channels) && loaded.channels.length) channels = loaded.channels;

    const page = el('div', { class: 'mcm' });
    container.appendChild(page);

    // ── 1. what it is doing right now ────────────────────────────────────────────────────────────
    const figures = el('div', { class: 'mcm-figs' });
    const live = el('div', { class: 'mcm-live' });
    page.appendChild(section('pulse', 'Right now', 'What this plugin has said since the manager last started. '
      + 'Everything below can be written with the server stopped; only these figures wait for a game.',
    [figures, live]));

    // ── 2. the announcements ─────────────────────────────────────────────────────────────────────
    let dirty = false;
    const dirtyWord = el('span', { class: 'mcm-dirty' }, 'Nothing to save');
    const touch = () => {
      if (dirty) return;
      dirty = true;
      dirtyWord.className = 'mcm-dirty unsaved';
      dirtyWord.textContent = 'Unsaved changes';
    };

    const cards = CARDS.map((d) => announcement(d, touch));
    cards.forEach((c) => page.appendChild(c.el));

    // ── 3. the timing that governs the polled four ───────────────────────────────────────────────
    //
    // Built ONCE, here, rather than inside the ten-second refresh. It used to be rebuilt with the
    // counters, so the box an owner was typing a number into was replaced under them twice while
    // they typed it.
    //
    // It reads on `change` and not on `input`, which is why the helper's own handler is empty: this
    // one is RANGE-CHECKED, and checking on every keystroke rejects the `5` on the way to `50`.
    const poll = number(Number(state.pollSeconds) || 30, () => {}, 5, 3600);
    poll.addEventListener('change', () => {
      const n = Math.round(Number(poll.value));
      state.pollSeconds = (n >= 5 && n <= 3600) ? n : 30;
      poll.value = String(state.pollSeconds);
      touch();
    });
    page.appendChild(section('clock', 'Timing',
      'Only Cargo drops, Game events and the two bunker announcements look at all. Kills, joins, '
      + 'leaves and raids are said the moment the manager reads them out of the log, whatever this says.',
    [
      row('Shared interval', poll,
        'Seconds. Used by any announcement above whose own interval is 0. Two of them falling due '
        + 'at the same moment share one ask rather than making two. Below 5 seconds is refused, and '
        + 'Cargo drops and Game events never ask faster than every 30 seconds whatever is set.'),
      note('flat', 'Cargo and game events reach the running game through the SSA Bridge, and one ask '
        + 'walks every object in it — so those two are the ones worth slowing down rather than '
        + 'speeding up. The two bunker announcements read the manager\'s own parsed log and cost the '
        + 'game nothing.'),
    ]));

    // ── 4. what it has actually said ─────────────────────────────────────────────────────────────
    let recent = [];
    const table = SSA.table({
      columns: [
        { key: 'at', label: 'When', sort: true, sortVal: (r) => -(r.at || 0), tdClass: 'mono',
          render: (r) => document.createTextNode(r.at ? new Date(r.at).toLocaleTimeString() : '') },
        { key: 'kind', label: 'What', sort: true, sortVal: (r) => r.kind || '',
          render: (r) => SSA.cell.tag(r.kind || '', r.ok ? 'ok' : 'bad') },
        { key: 'text', label: 'Said', render: (r) => document.createTextNode(r.text || '') },
        { key: 'why', label: 'Note', tdClass: 'dim', render: (r) => document.createTextNode(r.why || '') },
      ],
      rows: () => recent,
      search: (r) => (r.kind || '') + ' ' + (r.text || '') + ' ' + (r.why || ''),
      searchPlaceholder: 'Search what was said…',
      pageSize: 15,
      sort: { key: 'at', dir: 'asc' },
      empty: 'Nothing announced yet. With an announcement switched on this fills up as the server plays.',
    });
    page.appendChild(section('list', 'What it has said',
      'The last sixty lines this plugin sent, newest first, with the ones that reached nobody marked. '
      + 'It is kept in memory, so it starts empty every time the manager restarts.', [table.el]));

    // ── the save bar ─────────────────────────────────────────────────────────────────────────────
    // Where a save says what it really did. Under the button rather than in a toast, because a toast
    // is gone before an owner has read which setting did not land.
    const saveNote = el('div', { class: 'mcm-savenote' });
    const save = el('button', { type: 'button' }, [icon('check'), el('span', {}, 'Save')]);
    save.addEventListener('click', async () => {
      save.disabled = true;
      const r = await api('/config', { method: 'POST', body: state });
      save.disabled = false;
      saveNote.innerHTML = '';
      // ⚠ **NOT `state = r.config`.** Every card captured its section when it was built, so
      // replacing the object leaves the inputs writing into the old one while the next save sends
      // the new one: edit, save, edit, save, and the second edit is silently gone with "Saved" on
      // screen both times. The echo is READ instead — compared against what was sent, never
      // assigned over it.
      if (!r || r.ok === false) {
        if (SSA.toast) SSA.toast((r && r.error) || 'Could not save — nothing was changed', 'error');
        saveNote.appendChild(note('bad', 'Nothing was saved: '
          + ((r && r.error) || 'the manager did not answer') + '. Your changes are still on the screen.'));
        return;
      }
      // ⚠ **A SAVE THAT ANSWERS `ok` AND STORED SOMETHING ELSE IS THE ONE FAILURE NOBODY CAN
      // SEE.** It was reported from a live server: an interval set to 60, saved, and back to 0 on
      // the next refresh, with "Saved" on screen in between. So the write is read back and the
      // difference is named — the same rule this product enforces on every write it sends the game.
      const lost = disagreements(state, r.config).concat(Array.isArray(r.dropped) ? r.dropped : []);
      const shown = lost.filter((k, i) => lost.indexOf(k) === i).slice(0, 6);
      if (!shown.length) {
        dirty = false;
        dirtyWord.className = 'mcm-dirty';
        dirtyWord.textContent = 'Saved';
        if (SSA.toast) SSA.toast('Saved');
        return;
      }
      if (SSA.toast) SSA.toast('Saved, but ' + shown.length + ' setting(s) did not land', 'error');
      saveNote.appendChild(note('bad', [
        el('b', {}, 'These were not stored: '), el('span', {}, shown.join(', ')), el('span', {}, '. '),
        el('span', {}, 'The manager is running an older copy of this plugin than the screen you are '
          + 'looking at — the panel serves the new card straight from the library and the backend '
          + 'behind it is only reloaded when the plugin is. Restart the manager and set them again.'),
      ]));
    });
    page.appendChild(el('div', { class: 'mcm-save' }, [save, dirtyWord]));
    page.appendChild(saveNote);

    // Before anything is typed: a control this card draws that the code behind it has never heard
    // of cannot be saved, and finding that out after a refresh is the worst way to learn it.
    const unsettable = missingFromBackend(loaded.defaults);
    if (unsettable.length) {
      saveNote.appendChild(note('bad', 'This screen is newer than the plugin the manager is running, so '
        + unsettable.length + ' setting(s) on it cannot be saved yet: ' + unsettable.slice(0, 6).join(', ')
        + '. Restart the manager to pick up the new version. Everything else here saves normally.'));
    }

    // ── the live half ────────────────────────────────────────────────────────────────────────────

    function figure(value, label, kind) {
      return el('div', { class: 'mcm-fig' + (kind ? ' ' + kind : '') },
        [el('b', {}, String(value)), el('span', {}, label)]);
    }

    async function refresh(first) {
      // ⚠ **A TIMER OUTLIVES ITS PAGE.** It used to be cleared only by the next mount, so leaving
      // the tab left it asking the manager every ten seconds for a screen nobody could see, for as
      // long as the panel stayed open. A page that has been taken out of the document stops its own
      // timer; one that is merely hidden (another tab, a minimised window) skips the tick.
      if (!page.isConnected) {
        if (statusTimer === ownTimer) statusTimer = null;
        clearInterval(ownTimer);
        return;
      }
      if (first !== true && (document.hidden || !page.getClientRects().length)) return;
      const s = await api('/status');
      figures.innerHTML = '';
      live.innerHTML = '';
      if (!s || s.ok === false) {
        live.appendChild(note('bad', 'These counters have stopped updating: '
          + ((s && s.error) || 'the manager did not answer')
          + '. Every setting below is unaffected and still saves.'));
        cards.forEach((c) => c.live(null));
        return;
      }
      const on = CARDS.filter((d) => state[d.key] && state[d.key].enabled === true).length;
      figures.appendChild(figure(on + ' of ' + CARDS.length, 'Announcements on', on ? 'good' : ''));
      figures.appendChild(figure(s.stats.sent, 'Sent'));
      figures.appendChild(figure(s.stats.failed, 'Failed', s.stats.failed ? 'bad' : ''));
      figures.appendChild(figure(s.stats.skipped, 'Skipped', s.stats.skipped ? 'wait' : ''));

      if (!on) {
        live.appendChild(note('flat', 'Nothing is switched on, so your server says nothing new. '
          + 'Turn an announcement on below and press Save.'));
      }
      // Said out loud, because three zeroes and an empty list read as "this is not working" when
      // the real answer is that there is no game to announce anything about yet. Every setting
      // below can still be written; that is the better moment to write it.
      if (s.serverRunning === false) {
        live.appendChild(note('wait', 'The server is not running, so there is nothing to announce yet. '
          + 'Every message, channel and switch below can be set up now and goes live the moment it starts.'));
      }
      // A switch that is ON and silent with no explanation is the worst of the three states, and
      // this is the one case where the reason is the manager underneath rather than anything the
      // owner set.
      if (state.events && state.events.enabled && state.events.announceJoin
          && s.watching && s.watching.seededEvents && s.watching.eventPlayersAvailable === false) {
        live.appendChild(note('wait', 'Naming each person who signs up is switched on, but the bridge is '
          + 'not sending the participant list. Turn on "Who is in the event" in the bridge\'s World '
          + 'events module. The counts and the start and end lines are unaffected.'));
      }
      // Nothing before 5.14.8 kept the log line a secret bunker writes, so the announcement could
      // not fire however the card was filled in.
      if (s.watching && s.watching.secretBunkersSupported === false) {
        live.appendChild(note('bad', 'Secret bunkers cannot be announced by this manager: update the '
          + 'manager, which records a key card opening one. The switch and its messages can be set up '
          + 'now, and every other announcement here is unaffected.'));
      }
      // A REQUEST that failed is not a world with nothing in it. Cargo exists only in the running
      // game, so an owner seeing nothing announced needs to know which of the two it is.
      if (s.pollError && s.watching && (s.watching.cargo || s.watching.bunkers)) {
        live.appendChild(note('bad', 'Cargo and bunkers cannot be watched right now: ' + s.pollError
          + '. They live only in the running game, through the SSA Bridge. Kills, joins, leaves and '
          + 'raids are unaffected and every setting below can still be changed.'));
      }

      cards.forEach((c) => c.live(s));
      recent = Array.isArray(s.recent) ? s.recent : [];
      table.refresh();
    }
    // Declared before the first refresh, which can already find the page gone and read it.
    let ownTimer = null;
    await refresh(true);
    // The await above is a window in which this page can have been replaced. A newer mount's page is
    // the one on screen, so it keeps its timer and this one starts none; otherwise whatever is left
    // over is stopped here, so there is only ever one.
    if (!page.isConnected) return;
    if (statusTimer) clearInterval(statusTimer);
    ownTimer = setInterval(refresh, 10000);
    statusTimer = ownTimer;
  }

  // ⚠ `label` and `render`, not `title` and `mount` -- and the tab's own icon is a sprite
  // REFERENCE (`#i-chat`) where `SSA.icon()` above takes the bare name and builds one. Passing the
  // wrong key is not an error: the tab draws with no name and an empty body, which reads as a
  // broken plugin rather than as a typo. `SSA.ready` for the same reason every sibling uses it --
  // the panel's tab bar does not exist yet when a plugin script is evaluated.
  SSA.ready(function () {
    SSA.registerTab({ id: ID, label: 'Chat Messages', icon: '#i-chat', render: mount });
  });
})();
