/* Vehicle Rental — admin configuration UI. Configure vehicles, durations, money/gold prices, the
   channel and the in-game commands, design the menu embed (via the embed-editor plugin), post it,
   and watch active rentals. */
(function () {
  var API = '/api/plugin-host/vehicle-rental';
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
    return h('label', { class: 'vr-f' }, [h('span', {}, label), ctl]);
  }
  function chk(label, get, set) {
    var box = h('input', { type: 'checkbox', onchange: function () { set(box.checked); } });
    box.checked = get() !== false;
    return h('label', { class: 'vr-chk' }, [box, label]);
  }

  // Vehicle spawn-code field with a live typeahead sourced from the item database
  // (same catalog + images the admin console's vehicle picker uses). Picking a
  // result fills the code (BPC_… blueprint id) and, if empty, the name/image too.
  function vehField(v, refresh) {
    var input = h('input', { type: 'text', placeholder: 'Search vehicles… or type a code', autocomplete: 'off' });
    input.value = v.code || '';
    var menu = h('div', { class: 'vr-ac-menu' });
    var tmr = null;
    function hide() { menu.style.display = 'none'; menu.innerHTML = ''; }
    function search() {
      fetch('/api/public/items?domain=vehicles&q=' + encodeURIComponent(input.value.trim()), { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var items = (d && d.items) || [];
          menu.innerHTML = '';
          if (!items.length) { hide(); return; }
          items.slice(0, 24).forEach(function (it) {
            var id = it.code || it.id || it.name || '';
            var code = /^BPC_/.test(id) ? id : 'BPC_' + id;
            var nm = it.name || id;
            var img = it.image || '';
            var row = h('div', { class: 'vr-ac-row' }, [
              img ? h('img', { src: img, alt: '', loading: 'lazy' }) : h('span', { class: 'vr-ac-ph' }),
              h('span', { class: 'vr-ac-n' }, nm),
              h('span', { class: 'vr-ac-c' }, code),
            ]);
            row.addEventListener('mousedown', function (e) {
              e.preventDefault();
              v.code = code; if (!v.name) v.name = nm; if (!v.image && img) v.image = img;
              refresh();
            });
            menu.appendChild(row);
          });
          menu.style.display = 'block';
        }).catch(hide);
    }
    input.addEventListener('input', function () { v.code = input.value; clearTimeout(tmr); tmr = setTimeout(search, 220); });
    input.addEventListener('focus', search);
    input.addEventListener('blur', function () { setTimeout(hide, 160); });
    return h('label', { class: 'vr-f' }, [h('span', {}, 'Spawn code'), h('div', { class: 'vr-ac' }, [input, menu])]);
  }

  function editor(el) {
    var config = null;
    el.innerHTML = '<div class="vr-head"><p class="muted" style="font-size:.86rem;margin:0">Players rent vehicles through the Discord bot. Configure everything below, design the menu embed, then post it.</p></div><div id="vr-body" class="muted">Loading…</div>';
    var body = el.querySelector('#vr-body');

    api('/config').then(function (c) { config = c || {}; if (!Array.isArray(config.vehicles)) config.vehicles = []; render(); });

    function render() {
      body.className = '';
      body.innerHTML = '';

      // ── general settings ──
      var chanSel = h('select', {}, [h('option', { value: config.channelId || '' }, config.channelId ? '(current)' : '— pick a channel —')]);
      api('/channels').then(function (list) {
        chanSel.innerHTML = ''; chanSel.appendChild(h('option', { value: '' }, '— pick a channel —'));
        (list || []).forEach(function (ch) { chanSel.appendChild(h('option', { value: ch.id, selected: ch.id === config.channelId }, '#' + ch.name)); });
        chanSel.value = config.channelId || '';
      });
      chanSel.addEventListener('change', function () { config.channelId = chanSel.value; });

      body.appendChild(card('Settings', [
        h('div', { class: 'vr-checks' }, [
          chk('Rentals enabled', function () { return config.enabled; }, function (v) { config.enabled = v; }),
          h('label', { class: 'vr-chk' }, [(function () { var b = h('input', { type: 'checkbox', onchange: function () { config.free = b.checked; render(); } }); b.checked = config.free === true; return b; })(), 'Free rentals (no charge)']),
          chk('Only when player is online', function () { return config.requireOnline; }, function (v) { config.requireOnline = v; }),
          chk('Allow extensions', function () { return config.allowExtend; }, function (v) { config.allowExtend = v; }),
        ]),
        h('div', { class: 'vr-grid' }, [
          h('label', { class: 'vr-f' }, [h('span', {}, 'Rental menu channel'), chanSel]),
          inp('Button label', function () { return config.buttonLabel; }, function (v) { config.buttonLabel = v; }, { ph: '🚗 Rent a vehicle' }),
          inp('Max active rentals / player', function () { return config.maxPerPlayer; }, function (v) { config.maxPerPlayer = v; }, { type: 'number' }),
          inp('Cooldown between rentals (min)', function () { return config.cooldownMinutes; }, function (v) { config.cooldownMinutes = v; }, { type: 'number' }),
          inp('Daily limit / player (0 = ∞)', function () { return config.dailyLimit; }, function (v) { config.dailyLimit = v; }, { type: 'number' }),
          inp('Max extensions / rental (0 = ∞)', function () { return config.maxExtensions; }, function (v) { config.maxExtensions = v; }, { type: 'number' }),
          inp('Remind before expiry (min)', function () { return config.reminderMinutes; }, function (v) { config.reminderMinutes = v; }, { type: 'number' }),
        ]),
        h('div', { class: 'vr-stack' }, [
          inp('Spawn command template', function () { return config.spawnCmd; }, function (v) { config.spawnCmd = v; }, { ph: '#SpawnVehicle {code} 1 Location "X={x} Y={y} Z={z}"' }),
          inp('Remove command template', function () { return config.removeCmd; }, function (v) { config.removeCmd = v; }, { ph: '#DestroyVehicle {vehId}' }),
        ]),
        h('p', { class: 'muted', style: 'font-size:.78rem;margin-top:6px' }, 'Command placeholders: {code} {x} {y} {z} {steamid} {vehId}. Set these to match your server / bridge. Payment is charged automatically with #ChangeCurrencyBalance.'),
      ]));

      // ── vehicles ──
      var vehBox = h('div', {});
      function renderVeh() {
        vehBox.innerHTML = '';
        config.vehicles.forEach(function (v, vi) {
          if (!Array.isArray(v.options)) v.options = [];
          var optBox = h('div', { class: 'vr-opts' });
          function renderOpts() {
            optBox.innerHTML = '';
            v.options.forEach(function (o, oi) {
              var row = [inp('Minutes', function () { return o.minutes; }, function (x) { o.minutes = x; }, { type: 'number' })];
              if (!config.free) {
                row.push(inp('Currency', function () { return o.currency || 'money'; }, function (x) { o.currency = x; }, { type: 'select', options: [['money', 'Money'], ['gold', 'Gold']] }));
                row.push(inp('Amount', function () { return o.amount; }, function (x) { o.amount = x; }, { type: 'number' }));
              }
              row.push(h('button', { class: 'vr-x', title: 'Remove plan', onclick: function () { v.options.splice(oi, 1); renderOpts(); } }, '✕'));
              optBox.appendChild(h('div', { class: config.free ? 'vr-opt vr-opt-free' : 'vr-opt' }, row));
            });
            if (!v.options.length) optBox.appendChild(h('div', { class: 'muted', style: 'font-size:.8rem' }, 'No plans yet.'));
          }
          renderOpts();
          vehBox.appendChild(h('div', { class: 'vr-veh' }, [
            h('button', { class: 'vr-x vr-x-top', title: 'Remove vehicle', onclick: function () { config.vehicles.splice(vi, 1); renderVeh(); } }, '✕'),
            h('div', { class: 'vr-grid' }, [
              inp('Vehicle name', function () { return v.name; }, function (x) { v.name = x; }, { ph: 'Quad Bike' }),
              vehField(v, renderVeh),
              inp('Image URL (optional)', function () { return v.image; }, function (x) { v.image = x; }),
            ]),
            h('div', { class: 'vr-opt-hd' }, 'Per-vehicle limits (leave blank = use the global setting)'),
            h('div', { class: 'vr-grid' }, [
              inp('Max active / player', function () { return v.maxPerPlayer; }, function (x) { v.maxPerPlayer = x; }, { ph: 'global' }),
              inp('Cooldown (min)', function () { return v.cooldownMinutes; }, function (x) { v.cooldownMinutes = x; }, { ph: 'global' }),
              inp('Daily limit', function () { return v.dailyLimit; }, function (x) { v.dailyLimit = x; }, { ph: 'global' }),
              inp('Max extensions / rental (0 = ∞)', function () { return v.maxExtensions; }, function (x) { v.maxExtensions = x; }, { ph: 'global' }),
              inp('Remind before expiry (min)', function () { return v.reminderMinutes; }, function (x) { v.reminderMinutes = x; }, { ph: 'global' }),
            ]),
            h('div', { class: 'vr-opt-hd' }, 'Rental plans (duration' + (config.free ? '' : ' + price') + ')'),
            optBox,
            h('button', { class: 'vr-btn add', onclick: function () { v.options.push({ minutes: 60, currency: 'money', amount: 5000 }); renderOpts(); } }, '+ Add plan'),
          ]));
        });
        if (!config.vehicles.length) vehBox.appendChild(h('div', { class: 'muted', style: 'font-size:.85rem;padding:8px' }, 'No vehicles yet — add one.'));
      }
      renderVeh();
      body.appendChild(card('Vehicles', [vehBox, h('button', { class: 'vr-btn add', onclick: function () { config.vehicles.push({ name: '', code: '', image: '', options: [{ minutes: 60, currency: 'money', amount: 5000 }] }); renderVeh(); } }, '+ Add vehicle')]));

      // ── menu embed (via embed-editor) ──
      var embDiv = h('div', {});
      var ed = SSA.consume('embed-editor');
      if (ed) ed.mount(embDiv, { value: config.menuEmbed || {}, onChange: function (json) { config.menuEmbed = json; } });
      else embDiv.appendChild(h('div', { class: 'muted', style: 'font-size:.85rem' }, 'Enable the "Discord Embed Editor" plugin to design the menu embed here.'));
      body.appendChild(card('Rental menu embed', [embDiv]));

      // ── save + post + rentals ──
      var status = h('span', { class: 'muted', style: 'font-size:.85rem' });
      body.appendChild(h('div', { class: 'vr-actions' }, [
        h('button', { class: 'vr-btn primary', onclick: function () { status.textContent = 'Saving…'; api('/config', { method: 'POST', body: config }).then(function () { status.textContent = 'Saved ✓'; }); } }, 'Save configuration'),
        h('button', { class: 'vr-btn', onclick: function () { status.textContent = 'Posting…'; api('/config', { method: 'POST', body: config }).then(function () { return api('/post-menu', { method: 'POST' }); }).then(function (r) { status.textContent = r && r.ok ? 'Menu posted ✓' : 'Post failed (channel / bot?)'; }); } }, 'Save & post menu'),
        status,
      ]));

      var rentBox = h('div', { class: 'muted', style: 'font-size:.85rem' }, 'Loading…');
      api('/rentals').then(function (list) {
        rentBox.innerHTML = '';
        if (!list || !list.length) { rentBox.textContent = 'No active rentals.'; return; }
        var tbl = h('table', { class: 'data-table' }, [h('thead', {}, h('tr', {}, [h('th', {}, 'Player'), h('th', {}, 'Vehicle'), h('th', {}, 'Expires')]))]);
        var tb = h('tbody', {});
        list.forEach(function (r) { tb.appendChild(h('tr', {}, [h('td', {}, r.playerName || r.steamId || '—'), h('td', {}, r.vehName || '—'), h('td', {}, new Date(r.expiresAt).toLocaleString())])); });
        tbl.appendChild(tb); rentBox.appendChild(tbl);
      });
      body.appendChild(card('Active rentals', [rentBox]));
    }

    function card(title, kids) { return h('div', { class: 'card vr-card' }, [h('h3', { class: 'vr-card-t' }, title)].concat(kids)); }
  }

  SSA.ready(function () {
    SSA.registerTab({ id: 'vehicle-rental', label: 'Rentals', icon: '🚗', premium: true, render: editor });
  });
}());
