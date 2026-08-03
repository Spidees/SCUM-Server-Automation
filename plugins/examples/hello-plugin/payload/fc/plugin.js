/* Hello Plugin — public Field Console frontend. Talks only to window.FC.
 *
 * This runs on your players' PUBLIC stats site (not the admin panel). The API mirrors window.SSA minus
 * the admin-only parts. It is served only while Premium is active. Feed it with a PUBLIC backend route
 * (host.routes.public.*) — never expose admin data here.
 *
 * Full reference: the Plugin SDK docs (scumsa.com/docs).
 */
FC.ready(() => {
  FC.i18n.add('en', { 'hello.fc': 'Hello' });
  FC.i18n.add('cs', { 'hello.fc': 'Ahoj' });

  // A public nav tab that reads the plugin's public route → /api/plugin-public/hello-plugin/hello
  FC.registerTab({
    id: 'hello', label: FC.t('hello.fc', 'Hello'),
    render: async (el) => {
      const data = await FC.api('/hello').catch(() => ({ hello: 'Hello' }));
      el.innerHTML = `<div class="card"><h2>${FC.t('hello.fc', 'Hello')}</h2><p>${data.hello}, survivor!</p></div>`;
    },
  });
});
