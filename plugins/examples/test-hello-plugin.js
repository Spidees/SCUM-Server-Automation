'use strict';

/**
 * Tests for hello-plugin, written on the mock host. Copy it next to your own plugin and change what
 * the plugin is expected to answer. It needs Node 20 or newer and no packages.
 *
 *   node plugins/examples/test-hello-plugin.js [path/to/hello-plugin]
 *
 * It prints one line per check and ends with "N passed, M failed". The exit code is 0 only when
 * nothing failed.
 */

const fs = require('fs');
const path = require('path');
const { createMockHost } = require('./mock-host');

const DIR = path.resolve(process.argv[2] || path.join(__dirname, 'hello-plugin'));
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'plugin.json'), 'utf8'));
const cs = JSON.parse(fs.readFileSync(path.join(DIR, 'payload', 'web', 'i18n', 'cs.json'), 'utf8'));
const fillIn = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => String(vars[k]));

const ANN = { steamId: '76561198000000001', name: 'Ann' };
const BOB = { steamId: '76561198000000002', name: 'Bob' };
const CARA = { steamId: '76561198000000003', playerName: 'Cara' };
const SPAWNED = { ok: true, executor: ANN.steamId, output: ['Spawned 1 item'], confirmed: true, status: 'spawned' };

let passed = 0;
let failed = 0;
const refusals = [];
const errors = [];

function check(name, cond, got) {
  if (cond) { passed++; console.log(`  ok    ${name}`); return; }
  failed++;
  console.log(`  FAIL  ${name}`);
  if (got !== undefined) console.log(`        got: ${typeof got === 'string' ? got : JSON.stringify(got)}`);
}

/** Load the plugin on a fresh mock, run `fn`, and unload it whatever happens. */
async function withPlugin(label, opts, fn) {
  const mock = createMockHost({ online: [ANN, BOB], ...opts, plugin: DIR });
  try {
    try { await mock.load(); } catch (e) {
      check(`${label}: the plugin registers`, false, `${e.name}: ${e.message}`);
      return;
    }
    await fn(mock);
  } finally {
    refusals.push(...mock.refusals);
    errors.push(...mock.errors.map((x) => `${x.where}: ${x.error && x.error.message}`));
    await mock.unload();
  }
}

(async () => {
  console.log(`hello-plugin tests on the mock host (${DIR})`);

  await withPlugin('defaults', { commands: { SpawnItem: SPAWNED } }, async (mock) => {
    const logs = mock.logs.map((l) => l.message);
    check('it logs its version on start', logs.some((l) => l.includes(`v${manifest.version} on API 1`)), logs[0]);
    check('it counts its first start', logs.some((l) => l.includes('registered (start #1)')), logs);
    check('it registers /online, /happyhour and /kit', JSON.stringify(mock.commandNames()) === '["happyhour","kit","online"]', mock.commandNames());
    check('it announces itself on the event bus', mock.emitted.some((e) => e.event === `${manifest.id}:ready`), mock.emitted);
    check('/help reads /online as ready', JSON.stringify(await mock.commandStatus('online', ANN.steamId)) === '{"ready":true}');

    let r = await mock.say('/online', ANN);
    check('/online counts the players in English', JSON.stringify(r.replies) === '["Players online: 2"]', r.replies);
    r = await mock.say('/happyhour', ANN);
    check('/happyhour with no window set is on, in the manager\'s words', r.replies[0] === 'Happy hour is on. no time window is set, so this is always available', r.replies);
    r = await mock.say('/kit', ANN);
    check('/kit says the kit was delivered', r.replies[0] === 'Kit delivered.', r.replies);
    const sent = mock.commandsSent[0] || {};
    check('/kit spawns the pistol on the player who asked', sent.cmd === 'SpawnItem Weapon_M1911 1' && sent.opts.executor === ANN.steamId, sent);

    check('it registers its Discord button and slash command', mock.discord.buttons.some((b) => b.customId === `${manifest.id}:ping`) && mock.discord.slash.some((s) => s.data.name === 'hello'));
    check('it offers the "hello" service', mock.service('hello') && mock.service('hello').greet('Dan') === 'Hello, Dan!');
  });

  await withPlugin('Czech', { playerLangs: { [ANN.steamId]: 'cs' }, commands: { SpawnItem: SPAWNED } }, async (mock) => {
    let r = await mock.say('/online', ANN);
    check('/online answers a Czech player in Czech', r.replies[0] === fillIn(cs['pl.hello-plugin.game.online'], { n: 2 }), r.replies);
    r = await mock.say('/kit', ANN);
    check('/kit answers a Czech player in Czech', r.replies[0] === cs['pl.hello-plugin.game.kitDelivered'], r.replies);
    r = await mock.say('/online', BOB);
    check('/online still answers an English player in English', r.replies[0] === 'Players online: 2', r.replies);
  });

  await withPlugin('unconfirmed', { commands: { SpawnItem: { ok: true, executor: 'none', dispatched: true, confirmed: false, output: null } } }, async (mock) => {
    const r = await mock.say('/kit', ANN);
    check('/kit does not claim an unconfirmed spawn arrived', r.replies[0] === 'The game did not confirm the kit, so it may not have arrived.', r.replies);
  });

  await withPlugin('refused', { commands: { SpawnItem: { ok: false, error: 'no executor' } } }, async (mock) => {
    const r = await mock.say('/kit', ANN);
    check('/kit says so when the command did not run', r.replies[0] === 'The bridge is offline right now.', r.replies);
  });

  await withPlugin('bridge down', { bridgeOnline: false }, async (mock) => {
    let r = await mock.say('/kit', ANN);
    check('/kit with the bridge down says it is offline', r.replies[0] === 'The bridge is offline right now.', r.replies);
    const before = mock.commandsSent.length;
    r = await mock.request('POST', '/announce', { body: { text: 'Hi' } });
    check('/announce with the bridge down answers 503 and sends nothing', r.status === 503 && r.body.error === 'bridge_off' && mock.commandsSent.length === before, r);
  });

  await withPlugin('capabilities enforced', { enforceCapabilities: true, commands: { SpawnItem: SPAWNED } }, async (mock) => {
    const r = await mock.say('/kit', ANN);
    check('/kit still works when the owner enforces capabilities (SpawnItem is declared)', r.replies[0] === 'Kit delivered.', r.replies);
  });

  await withPlugin('routes', { commands: { Announce: { ok: true, executor: 'mock', output: [], confirmed: true } }, bridge: { livePlayers: [{ steamId: ANN.steamId }] } }, async (mock) => {
    let r = await mock.request('GET', '/config');
    check('GET /config answers the shipped greeting', r.status === 200 && r.body.greeting === 'Hello', r);
    r = await mock.request('GET', '/hello', { scope: 'public' });
    check('the public /hello answers the greeting', r.status === 200 && r.body.hello === 'Hello', r);
    r = await mock.request('POST', '/config', { body: { greeting: 'Ahoj', greetingI18n: { cs: 'Nazdar', de: '   ', 'not a code': 'x' } } });
    check('POST /config saves the greeting and keeps only real translations', r.status === 200 && mock.config().greeting === 'Ahoj' && JSON.stringify(mock.config().greetingI18n) === '{"cs":"Nazdar"}', r);
    check('a saved config reaches the plugin through onChange', mock.logs.some((l) => l.message === 'config saved — greeting "Ahoj"'));
    r = await mock.request('GET', '/hello', { scope: 'public' });
    check('the public /hello answers the new greeting', r.body && r.body.hello === 'Ahoj', r);
    r = await mock.request('POST', '/config', { body: { greeting: 5 } });
    check('POST /config refuses a greeting that is not text, with a reason', r.status === 400 && r.body.error === 'bad_greeting' && !!r.body.reason, r);
    r = await mock.request('GET', '/me', { scope: 'player' });
    check('the signed-in /me refuses a visitor who is not signed in', r.status === 401 && r.body.error === 'login_required', r);
    r = await mock.request('GET', '/me', { scope: 'player', visitor: { steamId: ANN.steamId, name: 'Ann' } });
    check('the signed-in /me answers who is signed in', r.status === 200 && r.body.steamId === ANN.steamId, r);
    r = await mock.request('POST', '/announce', { body: { text: 'Hi' } });
    check('/announce sends the text and reports it confirmed', r.status === 200 && r.body.confirmed === true && (mock.commandsSent[0] || {}).cmd === 'Announce Hi', r);
    r = await mock.request('GET', '/live');
    check('/live answers the live players the bridge gave', r.status === 200 && r.body.bridge === true && r.body.players.length === 1, r);
  });

  await withPlugin('save fails', { configSaveFails: true }, async (mock) => {
    const r = await mock.request('POST', '/config', { body: { greeting: 'Ahoj' } });
    check('POST /config says so when the config cannot be saved', r.status === 500 && r.body.error === 'save_failed', r);
  });

  await withPlugin('welcome', { config: { greeting: 'Hello', greetingI18n: {}, welcomeChat: true }, playerLangs: { [BOB.steamId]: 'cs' } }, async (mock) => {
    mock.join(CARA);
    await new Promise((r) => setImmediate(r));
    const line = mock.chat.find((c) => c.to === CARA.steamId) || {};
    check('a joining player gets the welcome in private', line.kind === 'dm' && line.text === 'Hello, Cara!', line);
    mock.join({ steamId: BOB.steamId, playerName: 'Bob' });
    const cz = mock.chat.find((c) => c.to === BOB.steamId) || {};
    check('a Czech player gets the plugin\'s own Czech greeting', cz.text === fillIn(cs['pl.hello-plugin.game.welcome'], { greeting: cs['pl.hello-plugin.default.greeting'], name: 'Bob' }), cz);
  });

  await withPlugin('restart', { store: { boots: 4 } }, async (mock) => {
    check('it counts starts in its store', mock.store().boots === 5 && mock.logs.some((l) => l.message.includes('registered (start #5)')), mock.store());
  });

  await withPlugin('timers', {}, async (mock) => {
    await mock.runTimers();
    check('its timers notify the admins and push the online count', mock.notifications.some((n) => n.type === 'admin.alert') && mock.realtime.some((x) => x.event === 'hello:tick' && x.payload.online === 2), { notifications: mock.notifications, realtime: mock.realtime });
  });

  await withPlugin('older manager', { without: ['i18n', 'time', 'routes.player'], commands: { SpawnItem: SPAWNED } }, async (mock) => {
    let r = await mock.say('/online', ANN);
    check('without host.i18n, /online answers in plain English', r.replies[0] === 'Players online: 2', r.replies);
    r = await mock.say('/happyhour', ANN);
    check('without host.time, /happyhour says the manager is too old', r.replies[0] === 'This manager is too old for time windows.', r.replies);
    r = await mock.request('GET', '/me', { scope: 'player', visitor: { steamId: ANN.steamId, name: 'Ann' } });
    check('without signed-in routes, /me is simply not there', r.status === 404, r);
  });

  await withPlugin('unload', {}, async (mock) => {
    await mock.unload();
    const logs = mock.logs.map((l) => l.message);
    check('unloading says goodbye and runs its onUnload', logs.includes('goodbye') && logs.includes('onUnload ran'), logs.slice(-3));
  });

  check('no handler threw', !errors.length, errors.slice(0, 5));
  check('nothing the plugin read was refused', !refusals.length, refusals.slice(0, 5).map((x) => `${x.code} ${x.member}`).join(', '));

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => {
  console.log(`  FAIL  the tests could not run: ${e.stack || e.message}`);
  console.log(`${passed} passed, ${failed + 1} failed`);
  process.exitCode = 1;
});
