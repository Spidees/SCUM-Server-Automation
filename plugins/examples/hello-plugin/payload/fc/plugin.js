/* Hello Plugin — public Field Console frontend. Talks only to window.FC.
 *
 * This runs on your players' PUBLIC stats site (not the admin panel). The API mirrors window.SSA minus
 * the admin-only parts, and it is served only while Premium is active. Feed it with a PUBLIC backend
 * route (host.routes.public.*) or a signed-in one (host.routes.player.*); never expose admin data here.
 *
 * Full reference: the Plugin SDK docs (scumsa.com/docs).
 */

// The client to hold, captured while this script loads. It rejects on an error status, so a refusal
// is never mistaken for data. FC.api is the older call: it never rejects, and from a click handler it
// no longer knows which plugin is asking. Feature-detect, because an older manager has only FC.api.
const api = (typeof FC.apiClient === 'function') ? FC.apiClient() : FC.api;
const why = (err) => (typeof FC.apiError === 'function' ? FC.apiError(err) : 'Something went wrong.');

// The console loads web/i18n (the same files as the admin panel) before this script runs, so FC.t()
// is translated already. FC.i18n.add() merges strings by hand: these two lines only matter on a manager
// too old to load the files. English needs nothing, it is the second argument of every FC.t().
FC.i18n.add('cs', { 'pl.hello-plugin.tab': 'Ahoj', 'pl.hello-plugin.signIn': 'Přihlaste se a uvidíte svůj vlastní pozdrav.', 'pl.hello-plugin.wave': 'Zamávat' });
FC.i18n.add('de', { 'pl.hello-plugin.tab': 'Hallo', 'pl.hello-plugin.signIn': 'Melde dich an, um deinen eigenen Gruß zu sehen.', 'pl.hello-plugin.wave': 'Zurückwinken' });

FC.ready(() => {
  // A public tab. Namespace the id: one the console already ships takes that screen over instead.
  // `icon` is a sprite id of the console. To keep a tab for signed-in visitors only, add
  // "requireLogin": true to "fc" in plugin.json; the signed-in ROUTE is what protects the data.
  FC.registerTab({
    id: 'hello-plugin', label: FC.t('pl.hello-plugin.tab', 'Hello'), icon: 'i-star', order: 50,
    render: async (el) => {
      el.innerHTML = '';
      const card = FC.el('div', { class: 'card' }, [FC.el('h2', { text: FC.t('pl.hello-plugin.tab', 'Hello') })]);
      FC.mount(el, card);
      let hello = 'Hello';
      try { hello = (await api('/hello')).hello || hello; } catch (err) { card.appendChild(FC.el('p', { text: why(err) })); }
      // FC.visitor() is who is signed in on this page, read from the session it already has (no
      // request); null for nobody. Only then ask the signed-in route.
      const me = FC.visitor() ? await api('/me').catch(() => null) : null;
      card.appendChild(FC.el('p', { text: me && me.name ? `${hello}, ${me.name}!` : FC.t('pl.hello-plugin.signIn', 'Sign in to see your own greeting.') }));
      card.appendChild(FC.el('button', { class: 'btn', text: FC.t('pl.hello-plugin.wave', 'Wave back'), onclick: async () => {
        if (await FC.confirm(`${hello}?`)) FC.toast(`${hello}!`);
      } }));
    },
  });

  // Add a card to a built-in screen, and restyle only your own corner of the console.
  FC.views.mount('overview', (el) => el.appendChild(FC.el('div', { class: 'card hello-fc' }, ['Hello Plugin'])));
  FC.theme.injectCss('.hello-fc{border-left:3px solid var(--accent)}');

  // Who is signed in can change while the page is open: redraw on every answer.
  FC.on('visitor', () => { if (location.hash === '#hello-plugin') FC.go('hello-plugin'); });
  // A service other Field Console plugins can use, and your own events on the page's bus.
  FC.provide('hello', { modal: (text) => FC.modal({ title: 'Hello', body: FC.el('p', { text }), actions: [{ label: 'OK', primary: true }] }) });
  FC.emit('hello:ready', { lang: FC.lang() });
});
