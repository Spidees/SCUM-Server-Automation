/* eslint-env browser */
'use strict';

// More Chat Messages — the settings screen.
//
// The page is three things in this order: what it is doing right now, the eight announcements, and
// what it has actually said. There is no timing to set: everything polled is checked every five
// seconds, which is cheap enough that an owner has nothing to trade off. The figures an owner
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
    catch (err) { return { ok: false, error: SSA.apiError ? SSA.apiError(err) : SSA.t('pl.more-chat-messages.error.generic', 'that did not work') }; }
  };

  // ⚠ `SSA.el`, the SDK's own element helper. This file used to carry a second one of its own,
  // which is a helper to keep in step with the panel's for no gain. There is no `SSA.h` — a
  // sibling plugin wrote `SSA.h || function …` and took its own fallback on every render it has
  // ever done — so the name is spelled out rather than guarded.
  const el = SSA.el;
  const icon = (name) => (SSA.icon ? SSA.icon(name) : el('span', {}));

  // The panel's own translator, bound once. English stays at the call site as the second argument,
  // so an owner with no locale file for this plugin — which is everybody until one is written —
  // reads exactly what they read before. `{name}` in a sentence is filled from the third argument
  // rather than by joining fragments: word order is not the same in every language.
  const T = SSA.t;

  // One entry per announcement. `fields` is what the card draws; the order is the order an owner
  // reads it in. `seed` names the flag in `/status` that says whether this one has a baseline yet —
  // a polled announcement says nothing from its first reading, which is a real state and not a
  // fault, and without this the card is on, silent, and gives no reason.
  const CARDS = [
    { key: 'kills', icon: 'skull', title: T('pl.more-chat-messages.kills.title', 'Kills'),
      what: T('pl.more-chat-messages.kills.what', 'Every death the kill feed sees, in the game\'s words. Kill lines have no sector.'),
      fields: [
        // No `{sector}`: the kill event carries the two positions only inside a sentence the
        // manager formatted for an embed, so there is nothing here to turn into a sector. It was
        // offered on all three lines and was blank on every kill on every server.
        ['message', T('pl.more-chat-messages.kills.field.message', 'When somebody is killed'), '{killer} {victim} {weapon} {distance}'],
        ['messageNoKiller', T('pl.more-chat-messages.kills.field.nokiller', 'When the kill carries no killer name at all'), '{victim} {weapon}'],
        ['selfMessage', T('pl.more-chat-messages.kills.field.self', 'When somebody kills themselves'), '{victim}'],
      ],
      numbers: [['minDistance', T('pl.more-chat-messages.kills.num.mindistance', 'Say nothing under this many metres'), T('pl.more-chat-messages.kills.num.mindistance.hint', '0 announces every kill.')]] },
    { key: 'joins', icon: 'user', title: T('pl.more-chat-messages.joins.title', 'Players joining'),
      what: T('pl.more-chat-messages.joins.what', 'One line per player joining, with sector and squad (blank for solo players).'),
      fields: [['message', T('pl.more-chat-messages.joins.field.message', 'Message'), '{name} {steamId} {sector} {squad}']] },
    { key: 'leaves', icon: 'logout', title: T('pl.more-chat-messages.leaves.title', 'Players leaving'),
      what: T('pl.more-chat-messages.leaves.what', 'One line when a player disconnects, with the sector they logged out in.'),
      fields: [['message', T('pl.more-chat-messages.leaves.field.message', 'Message'), '{name} {steamId} {sector} {squad}']] },
    { key: 'cargo', icon: 'box', title: T('pl.more-chat-messages.cargo.title', 'Cargo drops'), bridge: true, seed: 'seededCargo',
      what: T('pl.more-chat-messages.cargo.what', 'Announced while still in the air. The only announcement here that needs the SSA Bridge.'),
      toggles: [['announceIncoming', T('pl.more-chat-messages.cargo.toggle.incoming', 'On the way down')],
        ['announceLanded', T('pl.more-chat-messages.cargo.toggle.landed', 'Landing')],
        ['announceGone', T('pl.more-chat-messages.cargo.toggle.gone', 'Gone')]],
      fields: [
        ['incomingMessage', T('pl.more-chat-messages.cargo.field.incoming', 'On the way down'), '{sector} {x} {y}'],
        ['landedMessage', T('pl.more-chat-messages.cargo.field.landed', 'Landed'), '{sector} {x} {y}'],
        ['goneMessage', T('pl.more-chat-messages.cargo.field.gone', 'Gone'), '{sector} {x} {y}'],
      ] },
    // `trophy`, because that is what the panel's own map layer for these events wears. There is no
    // `i-flag` and no `i-flag2` in the sprite, and a sprite id that does not exist draws NOTHING --
    // no error, no broken-image mark, just a card head with a hole where its neighbours have an
    // icon. One vocabulary for one thing, and it is the panel's.
    { key: 'events', icon: 'trophy', title: T('pl.more-chat-messages.events.title', 'Game events'), bridge: true, seed: 'seededEvents',
      what: T('pl.more-chat-messages.events.what', 'Deathmatch, capture the flag and drop zone. Needs the SSA Bridge. Events already running at manager start stay quiet.'),
      toggles: [
        ['announceOpen', T('pl.more-chat-messages.events.toggle.open', 'Sign-ups open')],
        ['announceJoin', T('pl.more-chat-messages.events.toggle.join', 'Each person who signs up')],
        ['announceCount', T('pl.more-chat-messages.events.toggle.count', 'Sign-up count changes')],
        ['announceStart', T('pl.more-chat-messages.events.toggle.start', 'The event starts')],
        ['announceEnd', T('pl.more-chat-messages.events.toggle.end', 'The event ends')],
      ],
      fields: [
        ['openMessage', T('pl.more-chat-messages.events.field.open', 'Sign-ups open'), '{event} {location} {sector} {registered}'],
        ['joinMessage', T('pl.more-chat-messages.events.field.join', 'Someone signed up'), '{player} {event} {location} {sector} {registered}'],
        ['countMessage', T('pl.more-chat-messages.events.field.count', 'Sign-up count'), '{event} {location} {sector} {registered}'],
        ['startMessage', T('pl.more-chat-messages.events.field.start', 'Started'), '{event} {location} {sector} {participants} {teams}'],
        ['endMessage', T('pl.more-chat-messages.events.field.end', 'Ended'), '{event} {location} {sector}'],
      ] },
    { key: 'bunkersSecret', icon: 'lock', title: T('pl.more-chat-messages.bunkers.secret.title', 'Secret bunkers'), seed: 'seededSecretBunkers',
      what: T('pl.more-chat-messages.bunkers.secret.what', 'Key card bunkers: announced when opened, optionally when they close. No bridge; only {sector} is filled.'),
      toggles: [['announceClose', T('pl.more-chat-messages.bunkers.secret.toggle.close', 'Closing as well as opening')]],
      fields: [['openMessage', T('pl.more-chat-messages.bunkers.secret.field.open', 'Opened'), '{sector}'],
        ['closeMessage', T('pl.more-chat-messages.bunkers.secret.field.close', 'Closed'), '{sector}']] },
    { key: 'bunkersAbandoned', icon: 'lock', title: T('pl.more-chat-messages.bunkers.abandoned.title', 'Abandoned bunkers'), seed: 'seededBunkers',
      what: T('pl.more-chat-messages.bunkers.abandoned.what', 'The scheduled bunkers, announced when they open or lock. No bridge needed.'),
      toggles: [['announceClose', T('pl.more-chat-messages.bunkers.abandoned.toggle.close', 'Locking as well as opening')]],
      fields: [['openMessage', T('pl.more-chat-messages.bunkers.abandoned.field.open', 'Active'), '{sector} {x} {y}'],
        ['closeMessage', T('pl.more-chat-messages.bunkers.abandoned.field.close', 'Locked'), '{sector} {x} {y}']] },
    { key: 'raids', icon: 'shield', title: T('pl.more-chat-messages.raids.title', 'Bases being raided'),
      what: T('pl.more-chat-messages.raids.what', 'The same alert the manager sends a base owner, said out loud.'),
      toggles: [['includeOwner', T('pl.more-chat-messages.raids.toggle.owner', 'Name the base owner')]],
      fields: [['message', T('pl.more-chat-messages.raids.field.message', 'Message'), '{sector} {element} {squad}'],
        ['ownerMessage', T('pl.more-chat-messages.raids.field.owner', 'Message when naming the owner'), '{owner} {squad} {sector} {element}']] },
  ];

  // The value the backend stores is the lower-case word; this is only what a reader sees. A channel
  // a future backend adds and this list has never heard of keeps its own spelling rather than
  // vanishing from the dropdown.
  const CHANNEL_LABEL = {
    local: T('pl.more-chat-messages.channel.local', 'Local — heard nearby'),
    global: T('pl.more-chat-messages.channel.global', 'Global — the whole server'),
    squad: T('pl.more-chat-messages.channel.squad', 'Squad'),
    admin: T('pl.more-chat-messages.channel.admin', 'Admin — admins only'),
    server: T('pl.more-chat-messages.channel.server', 'Server'),
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
  /** The row's label is the control's NAME too: a dropdown reading only its value ("Airfield")
   *  says nothing about what it chooses to a screen reader. */
  function nameCtl(ctl, label) {
    if (typeof label !== 'string' || !label || !ctl || !ctl.tagName) return;
    var f = /^(SELECT|INPUT|TEXTAREA)$/.test(ctl.tagName) ? ctl : (ctl.querySelector ? ctl.querySelector('select') : null);
    if (f && !f.getAttribute('aria-label') && !f.id) f.setAttribute('aria-label', label);
  }
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
      const b = el('button', { type: 'button', class: 'mcm-tok', title: T('pl.more-chat-messages.token.title', 'Put {token} in the message', { token: tok }) }, tok);
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
    const sw = el('label', { class: 'switch mcm-sw', title: T('pl.more-chat-messages.card.switch.title', 'Switch this announcement on or off') }, [box, swWord]);

    function paintState() {
      const on = sec.enabled === true;
      root.classList.toggle('on', on);
      badge.className = 'mcm-badge' + (on ? ' on' : '');
      badge.textContent = on ? T('pl.more-chat-messages.card.state.announcing', 'Announcing')
        : T('pl.more-chat-messages.card.state.silent', 'Silent');
      swWord.textContent = on ? T('pl.more-chat-messages.card.switch.on', 'On')
        : T('pl.more-chat-messages.card.switch.off', 'Off');
      // Dimmed, not hidden and never inert: an owner writing the wording before switching the
      // announcement on is the ordinary way round, and a card that empties itself when it is off
      // cannot be prepared.
      body.classList.toggle('mcm-dim', !on);
    }
    box.addEventListener('change', () => { sec.enabled = box.checked; paintState(); touch(); });

    // ── where it goes ────────────────────────────────────────────────────────────────────────────
    //
    // ⚠ THE CHANNEL IS A LOOK, NOT AN AUDIENCE. The bridge sends every line to every online player;
    // the channel only sets the colour and chat tab it shows in. The hint said it decided who sees
    // the line, which an owner using the admin channel for its yellow found to be untrue.
    const where = [row(T('pl.more-chat-messages.card.channel', 'Chat channel'),
      select(channels.includes(String(sec.channel)) ? String(sec.channel) : 'global',
        channels.map((c) => [c, CHANNEL_LABEL[c] || c]),
        (v) => { sec.channel = v; touch(); }),
      T('pl.more-chat-messages.card.channel.hint', 'How the line looks in game (its colour). Every player sees it either way.'))];

    // The other place a line can go, and the reason it is a separate control: the game does not log
    // what a plugin sends, so without this an announcement is visible in game and nowhere else.
    where.push(row(T('pl.more-chat-messages.card.history', 'Keep it in the chat history'),
      choice(T('pl.more-chat-messages.card.history.switch', 'Chat history'), sec.history === true, (v) => { sec.history = v; touch(); }),
      T('pl.more-chat-messages.card.history.hint', 'Also shows the line in the admin chat view, Field Console and Discord chat channel.')));

    (def.numbers || []).forEach(([k, label, hint]) => {
      where.push(row(label, number(sec[k] == null ? 0 : sec[k], (n) => { sec[k] = n; touch(); }, 0), hint));
    });

    body.appendChild(block(T('pl.more-chat-messages.card.block.where', 'Where it goes'), where));

    if ((def.toggles || []).length) {
      body.appendChild(block(T('pl.more-chat-messages.card.block.what', 'What it announces'), [
        el('p', { class: 'mcm-hint' }, T('pl.more-chat-messages.card.block.what.hint', 'Each moment is its own line. Switch off the ones your server does not need.')),
        el('div', { class: 'mcm-chks' }, def.toggles.map(([k, label]) =>
          choice(label, sec[k] === true, (v) => { sec[k] = v; touch(); }))),
      ]));
    }

    body.appendChild(block(T('pl.more-chat-messages.card.block.says', 'What it says'), (def.fields || []).map(([k, label, holders]) =>
      messageField(label, sec[k], holders, (v) => { sec[k] = v; touch(); }))));

    root.appendChild(el('div', { class: 'mcm-head' }, [
      icon(def.icon),
      el('h3', {}, def.title),
      badge,
      def.bridge ? el('span', { class: 'mcm-tag' }, T('pl.more-chat-messages.card.needsbridge', 'Needs the bridge')) : null,
      sw,
    ].filter(Boolean)));
    root.appendChild(el('p', { class: 'mcm-lead' }, def.what));
    root.appendChild(chips);
    root.appendChild(body);
    paintState();

    /**
     * What this one is really doing, from `/status`.
     *
     * The four `seeded*` flags say whether a polled announcement has its first reading yet, so an
     * owner can tell "on and silent because nothing has happened" from "on and silent because it
     * has no baseline yet".
     */
    function live(s) {
      chips.innerHTML = '';
      if (!s || !sec.enabled) return;
      if (def.bridge && s.waitingForPlayers === true && !sec.history) {
        chips.appendChild(el('span', { class: 'mcm-chip wait' },
          T('pl.more-chat-messages.chip.nobody', 'Nobody online, so nothing is checked. It resumes when a player joins')));
      }
      if (def.seed && s.watching && s.watching[def.seed] === false) {
        chips.appendChild(el('span', { class: 'mcm-chip wait' },
          T('pl.more-chat-messages.chip.seeding', 'Waiting for its first readings; nothing is announced until it has two')));
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
      container.appendChild(el('div', { class: 'mcm' }, section('alert', T('pl.more-chat-messages.tab', 'Chat Messages'), null, [
        note('bad', T('pl.more-chat-messages.read.failed', 'The plugin\'s settings could not be read: {error}. Nothing has been changed.',
          { error: (loaded && loaded.error) || T('pl.more-chat-messages.error.noanswer', 'the manager did not answer') })),
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
    page.appendChild(section('pulse', T('pl.more-chat-messages.now.title', 'Right now'),
      T('pl.more-chat-messages.now.lead', 'Since the manager started. Cargo, events and bunkers are checked every 5 s. Settings work with the server stopped.'),
      [figures, live]));

    // ── 2. the announcements ─────────────────────────────────────────────────────────────────────
    let dirty = false;
    const dirtyWord = el('span', { class: 'mcm-dirty' }, T('pl.more-chat-messages.save.clean', 'Nothing to save'));
    const touch = () => {
      if (dirty) return;
      dirty = true;
      dirtyWord.className = 'mcm-dirty unsaved';
      dirtyWord.textContent = T('pl.more-chat-messages.save.unsaved', 'Unsaved changes');
    };

    const cards = CARDS.map((d) => announcement(d, touch));
    cards.forEach((c) => page.appendChild(c.el));

    // ── 3. what it has actually said ─────────────────────────────────────────────────────────────
    let recent = [];
    const table = SSA.table({
      columns: [
        { key: 'at', label: T('pl.more-chat-messages.said.col.when', 'When'), sort: true, sortVal: (r) => -(r.at || 0), tdClass: 'mono',
          render: (r) => document.createTextNode(r.at ? new Date(r.at).toLocaleTimeString() : '') },
        { key: 'kind', label: T('pl.more-chat-messages.said.col.what', 'What'), sort: true, sortVal: (r) => r.kind || '',
          render: (r) => SSA.cell.tag(r.kind || '', r.ok ? 'ok' : 'bad') },
        { key: 'text', label: T('pl.more-chat-messages.said.col.said', 'Said'), render: (r) => document.createTextNode(r.text || '') },
        { key: 'why', label: T('pl.more-chat-messages.said.col.note', 'Note'), tdClass: 'dim', render: (r) => document.createTextNode(r.why || '') },
      ],
      rows: () => recent,
      search: (r) => (r.kind || '') + ' ' + (r.text || '') + ' ' + (r.why || ''),
      searchPlaceholder: T('pl.more-chat-messages.said.search', 'Search what was said…'),
      pageSize: 15,
      sort: { key: 'at', dir: 'asc' },
      empty: T('pl.more-chat-messages.said.empty', 'Nothing announced yet. With an announcement switched on this fills up as the server plays.'),
    });
    page.appendChild(section('list', T('pl.more-chat-messages.said.title', 'What it has said'),
      T('pl.more-chat-messages.said.lead', 'The last 60 lines sent, newest first; undelivered ones marked. Clears on manager restart.'),
      [table.el]));

    // ── the save bar ─────────────────────────────────────────────────────────────────────────────
    // Where a save says what it really did. Under the button rather than in a toast, because a toast
    // is gone before an owner has read which setting did not land.
    const saveNote = el('div', { class: 'mcm-savenote' });
    const save = el('button', { type: 'button' }, [icon('check'), el('span', {}, T('pl.more-chat-messages.save.button', 'Save'))]);
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
        if (SSA.toast) SSA.toast((r && r.error) || T('pl.more-chat-messages.save.failed.toast', 'Could not save — nothing was changed'), 'error');
        saveNote.appendChild(note('bad', T('pl.more-chat-messages.save.failed', 'Nothing was saved: {error}. Your changes are still on the screen.',
          { error: (r && r.error) || T('pl.more-chat-messages.error.noanswer', 'the manager did not answer') })));
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
    page.appendChild(el('div', { class: 'mcm-save' }, [save, dirtyWord]));
    page.appendChild(saveNote);

    // Before anything is typed: a control this card draws that the code behind it has never heard
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
        live.appendChild(note('bad', T('pl.more-chat-messages.counters.stopped', 'These counters have stopped updating: {error}. Every setting below is unaffected and still saves.',
          { error: (s && s.error) || T('pl.more-chat-messages.error.noanswer', 'the manager did not answer') })));
        cards.forEach((c) => c.live(null));
        return;
      }
      const on = CARDS.filter((d) => state[d.key] && state[d.key].enabled === true).length;
      figures.appendChild(figure(T('pl.more-chat-messages.fig.onof', '{n} of {total}', { n: on, total: CARDS.length }),
        T('pl.more-chat-messages.fig.on', 'Announcements on'), on ? 'good' : ''));
      figures.appendChild(figure(s.stats.sent, T('pl.more-chat-messages.fig.sent', 'Sent')));
      figures.appendChild(figure(s.stats.failed, T('pl.more-chat-messages.fig.failed', 'Failed'), s.stats.failed ? 'bad' : ''));
      figures.appendChild(figure(s.stats.skipped, T('pl.more-chat-messages.fig.skipped', 'Skipped'), s.stats.skipped ? 'wait' : ''));

      if (!on) {
        live.appendChild(note('flat', T('pl.more-chat-messages.live.nothingon', 'Nothing is on. Turn an announcement on below and press Save.')));
      }
      // Said out loud, because three zeroes and an empty list read as "this is not working" when
      // the real answer is that there is no game to announce anything about yet. Every setting
      // below can still be written; that is the better moment to write it.
      if (s.serverRunning === false) {
        live.appendChild(note('wait', T('pl.more-chat-messages.live.stopped', 'The server is stopped. Set everything up now; it goes live when it starts.')));
      }
      // A switch that is ON and silent with no explanation is the worst of the three states, and
      // this is the one case where the reason is the manager underneath rather than anything the
      // owner set.
      if (state.events && state.events.enabled && state.events.announceJoin
          && s.watching && s.watching.seededEvents && s.watching.eventPlayersAvailable === false) {
        live.appendChild(note('wait', T('pl.more-chat-messages.live.noparticipants', 'No sign-up names: turn on "Who is in the event" in the bridge\'s World events.')));
      }
      // Nothing before 5.14.8 kept the log line a secret bunker writes, so the announcement could
      // not fire however the card was filled in.
      if (s.watching && s.watching.secretBunkersSupported === false) {
        live.appendChild(note('bad', T('pl.more-chat-messages.live.nosecretbunkers', 'This manager cannot announce secret bunkers; update it. You can still set this up.')));
      }
      // A REQUEST that failed is not a world with nothing in it. Cargo exists only in the running
      // game, so an owner seeing nothing announced needs to know which of the two it is.
      // ⚠ CARGO AND GAME EVENTS, NOT BUNKERS. Only those two ask the bridge, so only they can set this
      // error. Keyed on bunkers it blamed the bridge for a section that reads the manager's own log,
      // and an owner with only game events on was never told why nothing was announced.
      if (s.pollError && s.watching && (s.watching.cargo || s.watching.events)) {
        live.appendChild(note('bad', T('pl.more-chat-messages.live.pollerror', 'Cargo drops and game events cannot be watched: {error}. Everything else here still works.',
          { error: s.pollError })));
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
    SSA.registerTab({ id: ID, label: T('pl.more-chat-messages.tab', 'Chat Messages'), icon: '#i-chat', render: mount });
  });
})();
