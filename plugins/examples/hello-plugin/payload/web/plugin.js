/* Hello Plugin — admin-panel frontend. Talks only to window.SSA.
 *
 * The manager loads this automatically for the enabled plugin. It never adds a top-nav item: your
 * screens live behind the "Open" button on the plugin's card (a self-contained workspace — a back bar
 * plus your tabs). Register several tabs and they become sub-tabs inside that workspace.
 *
 * Full reference: the Plugin SDK docs (scumsa.com/docs).
 */
SSA.ready(() => {
  // ── i18n: ship your strings for every language the panel supports, then use ─
  //    SSA.t(key, fallback) everywhere. Missing languages fall back to the key's
  //    English string, so at least ship 'en'. The panel ships en/cs/de/es/ru.
  SSA.i18n.add('en', { 'hello.tab': 'Hello', 'hello.greet': 'Greet', 'hello.title': 'Hello Plugin' });
  SSA.i18n.add('cs', { 'hello.tab': 'Ahoj', 'hello.greet': 'Pozdravit', 'hello.title': 'Hello Plugin' });
  SSA.i18n.add('de', { 'hello.tab': 'Hallo', 'hello.greet': 'Begrüßen', 'hello.title': 'Hello Plugin' });
  SSA.i18n.add('es', { 'hello.tab': 'Hola', 'hello.greet': 'Saludar', 'hello.title': 'Hello Plugin' });
  SSA.i18n.add('ru', { 'hello.tab': 'Привет', 'hello.greet': 'Поприветствовать', 'hello.title': 'Hello Plugin' });

  // ── a workspace tab (opened from the card's "Open" button) ────────────────
  // premium/permission/when gate WHETHER it shows. A tab that fails every gate is hidden, and if a
  // plugin has no visible tabs its Open button doesn't appear.
  SSA.registerTab({
    id: 'hello', label: SSA.t('hello.tab', 'Hello'), icon: '#i-bolt', premium: true,
    render: async (el) => {
      el.innerHTML = `<div class="card"><h2>${SSA.t('hello.title', 'Hello Plugin')}</h2>`
        + `<p class="muted">Loading…</p><div class="hello-live"></div></div>`;
      // Call your own backend route, bound to this plugin → /api/plugin-host/hello-plugin/players
      const data = await SSA.api('/players').catch(() => ({ players: [] }));
      el.querySelector('p').textContent = data.online
        ? `${data.count} known players: ${(data.players || []).join(', ')}`
        : 'Server is offline — no player data right now.';
      // Live updates pushed from the backend via host.realtime.toAdmins('hello:tick', …)
      const live = el.querySelector('.hello-live');
      SSA.socket.on('hello:tick', (t) => { live.textContent = `Online right now: ${t.online}`; });
    },
  });

  // ── a per-player action (the background action menu on map + profile) ─────
  // Return an entry (or null to show nothing). run() executes when the player picks it.
  SSA.actions.player((player) => ({
    label: SSA.t('hello.greet', 'Greet'),
    icon: '#i-bolt',
    run: () => SSA.toast(`👋 ${player.name}`, 'ok'),
  }));

  // ── a per-entity action (here: map vehicles) ──────────────────────────────
  SSA.actions.entity('vehicle', (v) => ({
    label: 'Ping vehicle',
    run: () => SSA.confirm(`Ping vehicle #${v.id}?`).then((ok) => { if (ok) SSA.toast('pinged'); }),
  }));

  // ── inject a card into an existing view (survives re-renders) ──────────────
  SSA.views.mount('dashboard', (el) => {
    el.appendChild(SSA.el('div', { class: 'card', html: `<b>${SSA.t('hello.title', 'Hello Plugin')}</b> is active.` }));
  });

  // ── styling ───────────────────────────────────────────────────────────────
  // Ship static styles in web/plugin.css (manifest web.style — see .hello-live there). At runtime you
  // can also SSA.theme.injectCss('…') or SSA.theme.setTokens({ '--amber': '#e0562d' }) to recolour.

  // ── share a service with other plugin frontends (optional) ────────────────
  SSA.provide('hello', { greet: (name) => SSA.toast(`👋 ${name}`, 'ok') });
});
