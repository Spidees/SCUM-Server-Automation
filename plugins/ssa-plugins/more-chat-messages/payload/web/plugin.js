/* eslint-env browser */
'use strict';

// More Chat Messages — the settings screen.
//
// Six announcements, one card each, and every card is the same three questions: is it on, which
// chat does it go to, and what does it say. The wording is a text box rather than a set of
// toggles because a server's voice is its own — and the placeholders under each box are the whole
// of the documentation an owner needs at the moment they are typing.
//
// EVERYTHING HERE IS EDITABLE WITH THE SERVER STOPPED, which is the better moment to write it.
// Only the counters and the recent list need a running game, and the screen says so rather than
// showing three zeroes that read as "it is not working".

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

  // One entry per announcement. `fields` is what the card draws; the order is the order an owner
  // reads it in.
  const CARDS = [
    { key: 'kills', icon: 'skull', title: 'Kills',
      what: 'Every death the manager\'s kill feed sees, in the words the game itself uses for a weapon and an actor.',
      fields: [
        ['message', 'When one player kills another', '{killer} {victim} {weapon} {distance} {sector}'],
        ['messageNoKiller', 'When the game names no killer — a fall, a mine, a trap', '{victim} {weapon} {sector}'],
        ['selfMessage', 'When somebody kills themselves', '{victim} {sector}'],
      ],
      numbers: [['minDistance', 'Say nothing under this many metres', '0 announces every kill.']] },
    { key: 'joins', icon: 'user', title: 'Players joining',
      what: 'One line when a player connects. The sector is where the game says they logged in; '
        + 'the squad is empty for a solo player and while the save cannot be read.',
      fields: [['message', 'Message', '{name} {steamId} {sector} {squad}']] },
    { key: 'leaves', icon: 'logout', title: 'Players leaving',
      what: 'One line when a player disconnects, with the sector they logged out in.',
      fields: [['message', 'Message', '{name} {steamId} {sector} {squad}']] },
    { key: 'cargo', icon: 'box', title: 'Cargo drops',
      what: 'A drop exists from the moment the game schedules it, so it can be announced while it is '
        + 'still in the air. This is the only announcement here that needs the SSA Bridge: cargo is '
        + 'in no log and in no save table, and exists only in the running game.',
      toggles: [['announceIncoming', 'Announce it on the way down'],
        ['announceLanded', 'Announce it landing'],
        ['announceGone', 'Announce it being gone']],
      fields: [
        ['incomingMessage', 'On the way down', '{sector} {x} {y}'],
        ['landedMessage', 'Landed', '{sector} {x} {y}'],
        ['goneMessage', 'Gone', '{sector} {x} {y}'],
      ] },
    { key: 'bunkersSecret', icon: 'lock', title: 'Secret bunkers',
      what: 'The key card ones. Announced when the game opens it, and again when its window runs '
        + 'out if you want that. Read from the server\'s own log, so it needs no bridge.',
      toggles: [['announceClose', 'Announce it closing as well as opening']],
      fields: [['openMessage', 'Opened', '{sector} {x} {y}'], ['closeMessage', 'Closed', '{sector} {x} {y}']] },
    { key: 'bunkersAbandoned', icon: 'lock', title: 'Abandoned bunkers',
      what: 'The scheduled ones that open and lock on their own rota. Announced the moment the '
        + 'game writes the change to its log, so it needs no bridge.',
      toggles: [['announceClose', 'Announce it locking as well as opening']],
      fields: [['openMessage', 'Active', '{sector} {x} {y}'], ['closeMessage', 'Locked', '{sector} {x} {y}']] },
    { key: 'raids', icon: 'shield', title: 'Bases being raided',
      what: 'The same alert the manager sends a base owner, said out loud.',
      toggles: [['includeOwner', 'Name the base owner']],
      fields: [['message', 'Message', '{sector} {element} {squad}'],
        ['ownerMessage', 'Message when naming the owner', '{owner} {squad} {sector} {element}']] },
  ];

  let state = null;
  let channels = ['local', 'global', 'squad', 'admin', 'server'];
  let statusTimer = null;

  function h(tag, attrs, kids) {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) el.setAttribute(k, v);
    });
    (Array.isArray(kids) ? kids : kids ? [kids] : []).forEach((c) => {
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  function card(def) {
    // ATTACHED, not `|| {}`. A detached section takes every keystroke in the card and is read by
    // nothing, which looks exactly like a card that works right up until Save.
    if (!state[def.key] || typeof state[def.key] !== 'object') state[def.key] = {};
    const sec = state[def.key];
    const body = h('div', { class: 'mcm-body' });

    const on = h('input', { type: 'checkbox', class: 'mcm-on' });
    on.checked = sec.enabled === true;
    on.addEventListener('change', () => { sec.enabled = on.checked; body.classList.toggle('mcm-off', !on.checked); });

    const chan = h('select', { class: 'mcm-chan' });
    channels.forEach((c) => {
      const o = h('option', { value: c }, c);
      if (String(sec.channel) === c) o.setAttribute('selected', 'selected');
      chan.appendChild(o);
    });
    chan.value = channels.includes(String(sec.channel)) ? String(sec.channel) : 'global';
    chan.addEventListener('change', () => { sec.channel = chan.value; });

    body.appendChild(h('label', { class: 'mcm-row' }, [h('span', {}, 'Chat channel'), chan]));

    (def.toggles || []).forEach(([k, label]) => {
      const t = h('input', { type: 'checkbox' });
      t.checked = sec[k] === true;
      t.addEventListener('change', () => { sec[k] = t.checked; });
      body.appendChild(h('label', { class: 'mcm-row mcm-toggle' }, [t, h('span', {}, label)]));
    });

    (def.fields || []).forEach(([k, label, holders]) => {
      const inp = h('input', { type: 'text', class: 'mcm-msg', value: sec[k] == null ? '' : String(sec[k]) });
      inp.addEventListener('input', () => { sec[k] = inp.value; });
      body.appendChild(h('div', { class: 'mcm-field' }, [
        h('label', {}, label), inp, h('div', { class: 'mcm-holders' }, holders),
      ]));
    });

    (def.numbers || []).forEach(([k, label, note]) => {
      const inp = h('input', { type: 'number', class: 'mcm-num', min: '0', value: String(sec[k] == null ? 0 : sec[k]) });
      inp.addEventListener('input', () => { sec[k] = Number(inp.value); });
      body.appendChild(h('div', { class: 'mcm-field' }, [
        h('label', {}, label), inp, h('div', { class: 'mcm-holders' }, note),
      ]));
    });

    if (!on.checked) body.classList.add('mcm-off');
    return h('div', { class: 'mcm-card' }, [
      h('div', { class: 'mcm-head' }, [
        SSA.icon ? SSA.icon(def.icon) : h('span', {}),
        h('b', {}, def.title),
        h('label', { class: 'mcm-switch' }, [on, h('span', {}, 'On')]),
      ]),
      h('div', { class: 'mcm-what' }, def.what),
      body,
    ]);
  }

  async function mount(container) {
    container.innerHTML = '';
    const loaded = await api('/config');
    if (!loaded || loaded.ok === false) {
      container.appendChild(h('div', { class: 'mcm-note mcm-err' },
        'The plugin\'s settings could not be read: '
        + ((loaded && loaded.error) || 'the manager did not answer')
        + '. Nothing has been changed.'));
      return;
    }
    state = loaded.config;
    if (Array.isArray(loaded.channels) && loaded.channels.length) channels = loaded.channels;

    const status = h('div', { class: 'mcm-status' }, 'Loading…');
    const save = h('button', { class: 'primary' }, 'Save');
    save.addEventListener('click', async () => {
      save.disabled = true;
      const r = await api('/config', { method: 'POST', body: state });
      save.disabled = false;
      // ⚠ **NOT `state = r.config`.** Every card captured its section when it was built, so
      // replacing the object leaves the inputs writing into the old one while the next save sends
      // the new one: edit, save, edit, save, and the second edit is silently gone with "Saved" on
      // screen both times. The server echoes what it stored and it is what we sent, so there is
      // nothing to take from it — and if there ever is, this has to re-render rather than reassign.
      if (r && r.ok) { if (SSA.toast) SSA.toast('Saved'); }
      else if (SSA.toast) SSA.toast((r && r.error) || 'Could not save — nothing was changed', 'error');
    });

    container.appendChild(h('div', { class: 'mcm-top' }, [
      h('div', { class: 'mcm-intro' },
        'Everything here can be set up with the server stopped and goes live the moment it starts. '
        + 'Only the counters below wait for a running game.'),
      save,
    ]));
    container.appendChild(status);
    const grid = h('div', { class: 'mcm-grid' });
    CARDS.forEach((d) => grid.appendChild(card(d)));
    container.appendChild(grid);

    async function refresh() {
      const s = await api('/status');
      status.innerHTML = '';
      if (!s || s.ok === false) {
        status.appendChild(h('span', { class: 'mcm-err' },
          'The counters below have stopped updating. Every setting above is unaffected.'));
        return;
      }
      status.appendChild(h('span', {}, `${s.stats.sent} sent · ${s.stats.failed} failed · `
        + `${s.stats.skipped} skipped · asking the game every ${s.pollSeconds}s`));
      // Said out loud, because three zeroes and an empty list read as "this is not working" when
      // the real answer is that there is no game to announce anything about yet. Every setting
      // above can still be written; that is the better moment to write it.
      if (s.serverRunning === false) {
        status.appendChild(h('div', { class: 'mcm-note' },
          'The server is not running, so there is nothing to announce yet. Every message, channel '
          + 'and switch above can be set up now and goes live the moment it starts.'));
      }
      // A REQUEST that failed is not a world with nothing in it. Cargo and bunkers exist only in
      // the running game, so an owner seeing nothing announced needs to know which of the two it is.
      if (s.pollError && s.watching && (s.watching.cargo || s.watching.bunkers)) {
        status.appendChild(h('div', { class: 'mcm-note mcm-err' },
          `Cargo and bunkers cannot be watched right now: ${s.pollError}. `
          + 'They live only in the running game, through the SSA Bridge. Kills, joins, leaves and '
          + 'raids are unaffected and every setting above can still be changed.'));
      }
      if (Array.isArray(s.recent) && s.recent.length) {
        const list = h('div', { class: 'mcm-recent' });
        s.recent.slice(0, 12).forEach((r) => {
          list.appendChild(h('div', { class: 'mcm-line' + (r.ok ? '' : ' mcm-err') }, [
            h('span', { class: 'mcm-kind' }, r.kind),
            h('span', { class: 'mcm-text' }, r.text),
            h('span', { class: 'mcm-why' }, r.why || ''),
          ]));
        });
        status.appendChild(list);
      } else {
        status.appendChild(h('div', { class: 'mcm-note' },
          'Nothing announced yet. With everything switched on this fills up as the server plays.'));
      }
    }
    await refresh();
    // ONE timer across mounts. Reopening the tab otherwise stacks them, and the screen then asks
    // the backend several times a second for the rest of the session.
    if (statusTimer) clearInterval(statusTimer);
    statusTimer = setInterval(refresh, 10000);
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
