/* Mine Protection — admin configuration UI. */
(function () {
  var API = '/api/plugin-host/mine-protection';
  var DEF = {
    enabled: true, pollSeconds: 6, marginMeters: 0,
    classes: ['ImprovisedMine', 'Mine_0', 'Claymore', 'ImprovisedClaymore', 'PromTrap', 'PressureCookerBomb'],
    action: 'teleport_to_mine', warnFirst: true, requireOnline: true,
    exemptSteamIds: [],
    message: 'Placing a mine outside your flag is not allowed. Enjoy your own trap.',
    warnMessage: 'Warning: arming a mine outside your flag is not allowed. Next one takes you with it.',
  };

  function api(p, opts) {
    opts = opts || {}; var init = Object.assign({ credentials: 'same-origin' }, opts);
    if (init.body && typeof init.body === 'object') { init.headers = Object.assign({ 'Content-Type': 'application/json' }, init.headers || {}); init.body = JSON.stringify(init.body); }
    return fetch(API + p, init).then(function (r) { return r.json().catch(function () { return {}; }); });
  }
  function h(tag, props, kids) {
    var e = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      if (k === 'class') e.className = props[k]; else if (k === 'html') e.innerHTML = props[k]; else if (k === 'text') e.textContent = props[k];
      else if (k.slice(0, 2) === 'on' && typeof props[k] === 'function') e.addEventListener(k.slice(2), props[k]);
      else if (props[k] != null && props[k] !== false) e.setAttribute(k, props[k] === true ? '' : props[k]);
    });
    (Array.isArray(kids) ? kids : (kids != null ? [kids] : [])).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function inp(label, get, set, o) {
    o = o || {}; var ctl;
    if (o.type === 'select') ctl = h('select', { onchange: function () { set(ctl.value); } }, (o.options || []).map(function (op) { return h('option', { value: op[0] }, op[1]); }));
    else ctl = h('input', { type: o.type || 'text', placeholder: o.ph || '', oninput: function () { set(o.type === 'number' ? Number(ctl.value) : ctl.value); } });
    ctl.value = get() == null ? '' : get();
    return h('label', { class: 'mp-f' }, [h('span', {}, label), ctl]);
  }
  function chk(label, get, set) {
    var box = h('input', { type: 'checkbox', onchange: function () { set(box.checked); } });
    box.checked = get() === true;
    return h('label', { class: 'mp-chk' }, [box, label]);
  }
  function area(label, get, set, hint) {
    var ta = h('textarea', { rows: 3, oninput: function () { set(ta.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean)); } });
    ta.value = (get() || []).join('\n');
    return h('label', { class: 'mp-f' }, [h('span', {}, label), ta, hint ? h('small', { class: 'mp-hint' }, hint) : null]);
  }
  function card(title, kids) { return h('div', { class: 'card mp-card' }, [h('h3', { class: 'mp-card-t' }, title)].concat(kids)); }

  function editor(el) {
    var config = null;
    el.innerHTML = '<div class="mp-head"><p class="muted" style="font-size:.86rem;margin:0">Punish players who arm a mine outside their own or their squad’s flag area.</p></div><div id="mp-body" class="muted">Loading…</div>';
    var body = el.querySelector('#mp-body');
    api('/config').then(function (c) { config = Object.assign({}, DEF, c || {}); render(); });

    function render() {
      body.className = ''; body.innerHTML = '';

      body.appendChild(card('Settings', [
        h('div', { class: 'mp-checks' }, [
          chk('Enabled', function () { return config.enabled; }, function (v) { config.enabled = v; }),
          chk('First offence = warning', function () { return config.warnFirst; }, function (v) { config.warnFirst = v; }),
          chk('Only act while placer is online', function () { return config.requireOnline; }, function (v) { config.requireOnline = v; }),
        ]),
        h('div', { class: 'mp-grid' }, [
          inp('Extra margin around flag (m)', function () { return config.marginMeters; }, function (v) { config.marginMeters = v; }, { type: 'number' }),
          inp('Scan interval (s)', function () { return config.pollSeconds; }, function (v) { config.pollSeconds = v; }, { type: 'number' }),
          inp('Action', function () { return config.action; }, function (v) { config.action = v; }, { type: 'select', options: [['teleport_to_mine', 'Teleport onto their mine (kill)'], ['warn', 'Warn only']] }),
        ]),
        area('Watched mine/trap classes (one per line, matched as prefix%)', function () { return config.classes; }, function (v) { config.classes = v; }, 'e.g. ImprovisedMine, Mine_0, Claymore, PressureCookerBomb'),
      ]));

      body.appendChild(card('Messages & exemptions', [
        h('div', { class: 'mp-stack' }, [
          inp('Punish message', function () { return config.message; }, function (v) { config.message = v; }),
          inp('Warning message', function () { return config.warnMessage; }, function (v) { config.warnMessage = v; }),
          area('Exempt Steam IDs (never punished, one per line)', function () { return config.exemptSteamIds; }, function (v) { config.exemptSteamIds = v; }),
        ]),
      ]));

      var status = h('span', { class: 'muted', style: 'font-size:.85rem' });
      body.appendChild(h('div', { class: 'mp-actions' }, [
        h('button', { class: 'mp-btn primary', onclick: function () {
          status.textContent = 'Saving…';
          api('/config', { method: 'POST', body: config }).then(function (r) { status.textContent = (r && r.ok) ? 'Saved ✓  (interval change needs a manager restart)' : 'Save failed'; });
        } }, 'Save configuration'),
        status,
      ]));
    }
  }

  SSA.ready(function () { SSA.registerTab({ id: 'mine-protection', label: 'Mine Protection', icon: '💣', premium: true, render: editor }); });
}());
