/* Hello Plugin — admin-panel frontend. Talks only to window.SSA.
 *
 * The manager loads this for the enabled plugin. It never adds a top-nav item: your screens live behind
 * the "Open" button on the plugin's card (a back bar plus your tabs). Register several tabs and they
 * become sub-tabs inside that workspace.
 *
 * Every SDK family is used once below. Full reference: the Plugin SDK docs (scumsa.com/docs).
 */

// ── the backend client: captured HERE, at the top of the script ─────────────
// apiClient() remembers which plugin is asking. SSA.api() works out the same thing at call time, and
// from a click handler or a timer it no longer can. The client REJECTS on a non-2xx, so a 403 never
// turns into an empty list: put SSA.apiError(err) on the screen instead.
const api = SSA.apiClient();

// ── translations ────────────────────────────────────────────────────────────
// Your words travel in payload/web/i18n/<lang>.json (declared as web.i18n in plugin.json), one flat
// file per language and NO en.json: English is the second argument of every call. Keys start with
// pl.<your id>. so they cannot collide with the panel's or another plugin's.

// One live label shared by every render of the tab. The socket listener is attached ONCE, here, not
// inside render(): render runs on every visit, and a listener per visit stacks up.
let liveLabel = null;
let lastOnline = null;
SSA.socket.on('hello:tick', (t) => {
  lastOnline = t.online;
  if (liveLabel && liveLabel.isConnected) liveLabel.textContent = SSA.t('pl.hello-plugin.online', 'Online now: {n}', { n: t.online });
});

SSA.ready(() => {
  // ── the main workspace tab ────────────────────────────────────────────────
  // premium / permission / when decide WHETHER it shows. A plugin with no visible tab has no Open button.
  SSA.registerTab({
    id: 'hello',
    label: SSA.t('pl.hello-plugin.tab', 'Hello'),
    icon: '#i-bolt',
    order: 10,
    premium: true,
    when: () => !!SSA.admin(),
    render: (el) => renderHome(el),
  });

  // ── a per-player and a per-entity action (map + player card) ──────────────
  SSA.actions.player((player) => ({
    label: SSA.t('pl.hello-plugin.greet', 'Greet'),
    icon: '#i-chat',
    run: () => SSA.toast(`${SSA.t('pl.hello-plugin.greeting', 'Greeting')}: ${player.name}`, 'ok'),
  }));
  SSA.actions.entity('vehicle', (v) => ({
    label: SSA.t('pl.hello-plugin.pick', 'Pick a place'),
    run: () => SSA.menu(String(v.id), [
      { label: SSA.t('pl.hello-plugin.lookup', 'Look up an item'), run: () => SSA.openRecord(v.code || v.class || '', { domain: 'vehicles' }) },
    ]),
  }));

  // ── add to a built-in screen (re-applied whenever that screen re-renders) ─
  // SSA.views.replace(tabId, render) rebuilds a whole screen instead; this example only adds a card.
  SSA.views.mount('dashboard', (el) => {
    el.appendChild(SSA.el('div', { class: 'card ssa-hello-card' }, [SSA.icon('bolt'), SSA.el('b', { text: ` ${SSA.t('pl.hello-plugin.title', 'Hello Plugin')}` })]));
  });

  // ── styling at run time (static styles belong in web/plugin.css) ──────────
  SSA.theme.setTokens({ '--hello-accent': 'var(--amber)' }, { selector: '.ssa-hello' });

  // ── a frontend service other plugins can use, and the frontend event bus ──
  SSA.provide('hello', { greet: (name) => SSA.toast(`${SSA.t('pl.hello-plugin.greeting', 'Greeting')}: ${name}`, 'ok') });
  SSA.on('hello:refresh', () => SSA.refreshGates());
});

function renderHome(el) {
  el.innerHTML = '';
  const root = SSA.el('div', { class: 'ssa-hello' });
  el.appendChild(root);

  // Live label, fed by the socket listener above.
  liveLabel = SSA.el('p', { class: 'hello-live', text: lastOnline == null ? '' : SSA.t('pl.hello-plugin.online', 'Online now: {n}', { n: lastOnline }) });

  // ── a native data table ───────────────────────────────────────────────────
  // rows is a FUNCTION, so refresh() reads fresh data; empty is a function so it can say WHY.
  let players = [];
  let readable = true;
  let failure = null;
  const table = SSA.table({
    columns: [
      { key: 'name', label: SSA.t('pl.hello-plugin.name', 'Name'), sort: true, render: (r) => SSA.cell.player(r.name, r.steamId) },
      { key: 'steamId', label: SSA.t('pl.hello-plugin.steam', 'Steam ID'), render: (r) => SSA.cell.tag(r.steamId || '?', r.steamId ? 'muted' : 'warn') },
    ],
    rows: () => players,
    search: (r) => r.name || '',
    sort: { key: 'name' },
    pageSize: 10,
    empty: () => failure || (readable ? SSA.t('pl.hello-plugin.empty', 'Nobody has played on this server yet.')
      : SSA.t('pl.hello-plugin.stopped', 'The game database cannot be read while the server is stopped. Everything else here still works.')),
    onRefresh: () => load(),
  });

  const load = () => api('/players').then((d) => {
    players = d.players || []; readable = d.readable !== false; failure = null; table.refresh();
  }, (err) => { failure = SSA.apiError(err); table.refresh(); });

  // ── the config form: works with the server stopped ────────────────────────
  const input = SSA.el('input', { type: 'text', placeholder: SSA.t('pl.hello-plugin.greeting', 'Greeting') });
  const status = SSA.el('span', { class: 'muted' });
  api('/config').then((c) => { input.value = c.greeting || ''; }, (err) => { status.textContent = SSA.apiError(err); });
  const save = SSA.el('button', { class: 'btn', text: SSA.t('pl.hello-plugin.save', 'Save'), onclick: () => {
    api('/config', { method: 'POST', body: { greeting: input.value } })
      .then(() => { status.textContent = SSA.t('pl.hello-plugin.saved', 'Saved.'); SSA.emit('hello:refresh'); },
        (err) => { status.textContent = SSA.apiError(err); });
  } });

  // ── the panel's own affordances: feature-detect, then use ─────────────────
  const tools = SSA.el('div', { class: 'btn-row' });
  if (SSA.canPickItem()) {
    tools.appendChild(SSA.el('button', { class: 'btn', text: SSA.t('pl.hello-plugin.lookup', 'Look up an item'), onclick: async () => {
      const it = await SSA.pickItem({ domain: 'items' });
      if (!it) return;
      if (SSA.canOpenRecord && SSA.canOpenRecord()) SSA.openRecord(it.code);
      else if (SSA.canItemPreview()) SSA.itemPreview(it.code);
    } }));
  }
  if (SSA.canPickOnMap && SSA.canPickOnMap()) {
    tools.appendChild(SSA.el('button', { class: 'btn', text: SSA.t('pl.hello-plugin.pick', 'Pick a place'), onclick: async () => {
      const p = await SSA.pickOnMap({ note: SSA.t('pl.hello-plugin.pickNote', 'Tap the map where you want to look.') });
      if (p && SSA.canShowOnMap()) SSA.showOnMap(p.x, p.y);   // coming back re-rendered this tab: use p, not old nodes
    } }));
  }
  tools.appendChild(SSA.el('button', { class: 'btn', text: SSA.t('pl.hello-plugin.announce', 'Announce in game'), onclick: async () => {
    if (!(await SSA.confirm(SSA.t('pl.hello-plugin.announceAsk', 'Send the greeting to everyone in game?')))) return;
    api('/announce', { method: 'POST', body: {} }).then(() => SSA.toast(SSA.t('pl.hello-plugin.sent', 'Sent.'), 'ok'), (err) => SSA.toast(SSA.apiError(err), 'err'));
  } }));
  tools.appendChild(SSA.el('button', { class: 'btn', text: SSA.t('pl.hello-plugin.players', 'Players'), onclick: async () => {
    const online = await SSA.onlinePlayers();
    const who = await SSA.pickPlayer({ title: SSA.t('pl.hello-plugin.players', 'Players') });
    if (who && SSA.canOpenPlayer()) SSA.openPlayer(who.name, who.steamId);
    else SSA.modal({ title: SSA.t('pl.hello-plugin.players', 'Players'), body: SSA.el('p', { text: SSA.t('pl.hello-plugin.online', 'Online now: {n}', { n: online.length }) }), actions: [{ label: 'OK', primary: true }] });
  } }));

  root.appendChild(SSA.el('div', { class: 'card' }, [
    SSA.el('h2', { text: SSA.t('pl.hello-plugin.title', 'Hello Plugin') }), liveLabel,
    SSA.el('label', { text: SSA.t('pl.hello-plugin.greeting', 'Greeting') }), input, save, status, tools,
  ]));
  root.appendChild(SSA.el('div', { class: 'card' }, [SSA.el('h3', { text: SSA.t('pl.hello-plugin.players', 'Players') }), table.el]));
  load();

  // Go somewhere in the panel, and the admin actions for a player in the list. `nav.map` is the
  // PANEL's own key, borrowed: it is already translated everywhere, so a plugin never ships its own copy.
  tools.appendChild(SSA.el('button', { class: 'btn', text: SSA.t('nav.map', 'Live Map'), onclick: () => SSA.showTab('map') }));
  table.el.addEventListener('contextmenu', (e) => {
    const row = players.find((r) => e.target && e.target.textContent === r.name);
    if (row && row.steamId) { e.preventDefault(); SSA.openPlayerAdmin(row.steamId, row.name); }
  });

  // Premium gates this tab already; SSA.premium() is for wording inside it. SSA.consume() answers
  // null when the other plugin is absent, so always check.
  if (!SSA.premium()) root.appendChild(SSA.el('p', { class: 'muted', text: SSA.t('pl.hello-plugin.noPremium', 'Premium is off, so the in-game tools will not answer.') }));
  const embeds = SSA.consume('discord-embeds');
  if (embeds) root.appendChild(SSA.el('p', { class: 'muted', text: 'discord-embeds' }));

  // Data helpers over the panel's own endpoints, with the item cell that opens the preview.
  SSA.searchItems('kar98', { domain: 'items' })
    .then((list) => SSA.itemInfo(list.slice(0, 1).map((x) => x.code)))
    .then((info) => { if (info && info[0]) root.appendChild(SSA.el('p', {}, [SSA.cell.item(info[0].code, info[0].name), ' ', SSA.cell.location(0, 0)])); })
    .catch(() => {});
}
