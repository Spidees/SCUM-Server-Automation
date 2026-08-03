/* Embed Styler — admin UI. Pick any built-in manager embed, toggle customization on,
   and design the style overrides with the reusable Discord Embed Editor. Saves all
   kinds at once; changes apply to the next embed the manager sends. */
(function () {
  var API = '/api/plugin-host/embed-styler';
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

  function editor(el) {
    el.innerHTML = '<div class="es-head"><p class="muted" style="font-size:.86rem;margin:0">Edit the manager\'s own embeds. Pick one to load its default fields as an editable template — change the colour/title, then turn on <b>Replace fields</b> to add, remove or reorder fields. Click a field box and insert a data <code>{token}</code> for live values (e.g. add a Squad field = <code>{squad}</code>).</p></div><div id="es-body" class="muted">Loading…</div>';
    var body = el.querySelector('#es-body');
    var edSvc = SSA.consume('embed-editor');

    api('/config').then(function (cfg) {
      if (!edSvc) { body.innerHTML = '<div class="es-warn">Enable the “Discord Embed Editor” plugin first — this styler builds on it.</div>'; return; }
      render(cfg || {});
    });

    function render(cfg) {
      var kinds = cfg.kinds || [];
      var styles = cfg.styles || {};
      var liveImages = cfg.liveImages || {};
      var configuredImages = cfg.configuredImages || {};
      function imgFor(key) { return configuredImages[key] || liveImages[key] || null; }   // manager-set first, else captured
      body.className = ''; body.innerHTML = '';
      if (!kinds.length) { body.innerHTML = '<div class="es-warn">The styler backend isn’t loaded yet. Restart the manager (or toggle this plugin off and on) to finish enabling it, then reopen this tab.</div>'; return; }
      var byKey = {}; kinds.forEach(function (k) { byKey[k.key] = k; });

      var sel = h('select', { class: 'es-sel' });
      var groups = { feeds: 'Log feeds', live: 'Live embeds' };
      Object.keys(groups).forEach(function (g) {
        var list = kinds.filter(function (k) { return k.group === g; });
        if (!list.length) return;
        var og = h('optgroup', { label: groups[g] });
        list.forEach(function (k) { og.appendChild(h('option', { value: k.key }, k.label)); });
        sel.appendChild(og);
      });

      var enableChk = h('input', { type: 'checkbox' });
      var fieldsChk = h('input', { type: 'checkbox' });
      var fieldsLabel = h('label', { class: 'es-chk' }, [fieldsChk, 'Replace fields']);
      var edBox = h('div', { class: 'es-editor' });
      var noteEl = h('p', { class: 'es-note' });
      var status = h('span', { class: 'muted', style: 'font-size:.85rem' });
      var NOTE_NORMAL = 'Leave a field blank to keep the manager default. Applied: colour, title, description, author, thumbnail, image. Turn on “Replace fields” to fully control the field list — click a field, then a data token to insert it. Footer, timestamp and buttons stay manager / branding controlled.';
      var NOTE_STYLE = 'This embed shows a generated list, so only its look is editable here (colour, title, author, image). It keeps the image you set in the manager unless you set one here.';
      var NOTE_PLAYER = 'This embed is tied to a player, so the {stat_…} tokens fill in with THAT player’s numbers when it fires. On embeds without a player (server status, leaderboards, custom live embeds) use {pstat:PlayerName:Field} instead to pull a specific player’s stat.';

      // Seed a kind's editor model from its catalog: default field template + (for live embeds) a
      // starting title, so picking a kind loads a real, editable layout — no event needed.
      function seedModel(kd) {
        var m = edSvc.defaultModel();
        if (kd && kd.title) m.title = kd.title;
        if (kd && kd.description) m.description = kd.description;
        if (kd && kd.key && liveImages[kd.key]) m.image = { url: liveImages[kd.key] };   // show the manager's live-embed image
        if (kd && Array.isArray(kd.defaults) && kd.defaults.length) {
          m.fields = kd.defaults.map(function (f) { return { name: f.name || '', value: f.value || '', inline: !!f.inline }; });
        }
        return m;
      }
      function entryFor(key) {
        var e = styles[key];
        if (!e) e = styles[key] = { enabled: false, fields: false, model: null };
        if (!e.model) e.model = seedModel(byKey[key]);
        return e;
      }
      function showKind(key) {
        var kd = byKey[key];
        var entry = entryFor(key);
        enableChk.checked = !!entry.enabled;
        fieldsChk.checked = !!entry.fields;
        fieldsLabel.style.display = (kd && kd.styleOnly) ? 'none' : '';
        var hasPlayer = !!(kd && kd.tokens && kd.tokens.some(function (t) { return t && t.group === 'Player stats'; }));
        noteEl.textContent = (kd && kd.styleOnly ? NOTE_STYLE : NOTE_NORMAL) + (hasPlayer ? ' ' + NOTE_PLAYER : '');
        edBox.classList.toggle('off', !entry.enabled);
        // Prefill the image you set in the manager for this embed (so the preview matches Discord).
        var kimg = imgFor(key);
        if (entry.model && (!entry.model.image || !entry.model.image.url) && kimg) entry.model.image = { url: kimg };
        edBox.innerHTML = '';
        // The token bar + resolved preview live in the embed editor itself (reusable by any plugin).
        edSvc.mount(edBox, { value: entry.model, tokens: (kd && kd.tokens) || [], onChange: function (m) { entry.model = m; } });
      }

      sel.addEventListener('change', function () { showKind(sel.value); });
      enableChk.addEventListener('change', function () {
        var e = entryFor(sel.value); e.enabled = enableChk.checked; edBox.classList.toggle('off', !e.enabled);
      });
      fieldsChk.addEventListener('change', function () { entryFor(sel.value).fields = fieldsChk.checked; });

      body.appendChild(h('div', { class: 'card es-card' }, [
        h('div', { class: 'es-bar' }, [
          h('label', { class: 'es-f' }, [h('span', {}, 'Embed'), sel]),
          h('label', { class: 'es-chk' }, [enableChk, 'Customize this embed']),
          fieldsLabel,
        ]),
        noteEl,
      ]));
      body.appendChild(h('div', { class: 'card es-card' }, [
        edBox,
        h('div', { class: 'es-actions' }, [
          h('button', { class: 'es-btn primary', onclick: function () {
            status.textContent = 'Saving…';
            api('/config', { method: 'POST', body: { styles: styles } })
              .then(function (r) { status.textContent = r && r.ok ? 'Saved ✓ — applies to the next embed' : 'Save failed'; });
          } }, 'Save styles'),
          status,
        ]),
      ]));

      sel.value = kinds[0].key;
      showKind(sel.value);
    }
  }

  // ── Custom Live Embeds — design your own auto-updating embeds ────────────────
  function customEditor(el) {
    el.innerHTML = '<div class="es-head"><p class="muted" style="font-size:.86rem;margin:0">Create your own embeds that the bot keeps updated in a channel — like the built-in Server Status, but yours. Pick a channel + refresh interval and design it with {tokens} for live data.</p></div><div id="ce-body" class="muted">Loading…</div>';
    var body = el.querySelector('#ce-body');
    var edSvc = SSA.consume('embed-editor');
    var channels = [];
    Promise.all([
      api('/custom').then(function (c) { return c || {}; }),
      fetch('/api/plugin-host/embed-editor/channels', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).catch(function () { return []; }),
    ]).then(function (res) {
      if (!edSvc) { body.innerHTML = '<div class="es-warn">Enable the “Discord Embed Editor” plugin first — custom embeds build on it.</div>'; return; }
      channels = res[1] || [];
      render(res[0]);
    });

    function starterModel() {
      var m = edSvc.defaultModel();
      m.title = '🛰️ {serverName}'; m.color = '#f0820c';
      m.fields = [
        { name: '🌎 Status', value: '{state}', inline: true },
        { name: '👥 Online', value: '{onlineMax}', inline: true },
        { name: '🎮 FPS', value: '{fps}', inline: true },
        { name: '🕗 Time', value: '{gameTime}', inline: true },
        { name: '🌡️ Temp', value: '{airTemp} / {waterTemp}', inline: true },
        { name: '🔄 Next restart', value: '{nextRestart}', inline: true },
        { name: '🏆 Top player', value: '{topPlayer} — {topPlayerScore}', inline: false },
        { name: '📡 Connect', value: '`{serverAddress}`', inline: false },
      ];
      return m;
    }
    function render(cfg) {
      var items = cfg.items || [];
      var tokens = cfg.tokens || [];
      body.className = ''; body.innerHTML = '';
      var cur = 0;

      var sel = h('select', { class: 'es-sel' });
      var nameInp = h('input', { type: 'text', placeholder: 'My live status' });
      var chanSel = h('select', {});
      var iv = h('input', { type: 'number', min: '15' });
      var active = h('input', { type: 'checkbox' });
      var edBox = h('div', {});
      var actionsBox = h('div', { class: 'ce-acts' });
      var st = h('span', { class: 'muted', style: 'font-size:.82rem' });

      // Wire each embed button (Custom ID, not a Link) to an action fired when a player clicks it.
      function renderActions() {
        actionsBox.innerHTML = '';
        var ce = items[cur]; if (!ce) return;
        ce.actions = ce.actions || {};
        actionsBox.appendChild(h('div', { class: 'ce-acts-h' }, '⚡ Button actions'));
        actionsBox.appendChild(h('p', { class: 'muted', style: 'font-size:.8rem;margin:0 0 10px' }, 'Step 1: add buttons in the “Buttons” section of the editor above. Step 2: each button shows up here — pick what it does when a player clicks it.'));
        // every non-Link button gets an action row; auto-assign a Custom ID if the user left it blank
        var allBtns = ((ce.model && ce.model.buttons) || []).filter(function (b) { return String(b.style) !== '5'; });
        allBtns.forEach(function (b, i) { if (!(b.custom_id || b.customId)) b.custom_id = 'btn' + (i + 1); });
        if (!allBtns.length) { actionsBox.appendChild(h('p', { class: 'muted', style: 'font-size:.82rem;margin:0' }, 'No buttons yet — add one in the editor’s “Buttons” section (any style except “Link”).')); return; }
        allBtns.forEach(function (b) {
          var cid = b.custom_id || b.customId;
          var act = ce.actions[cid] = ce.actions[cid] || { type: '', value: '' };
          var typeSel = h('select', {}, [['', '— no action —'], ['command', 'Run in-game command'], ['message', 'Reply with a message'], ['announce', 'Post message to this channel']].map(function (o) { return h('option', { value: o[0] }, o[1]); }));
          typeSel.value = act.type || ''; typeSel.addEventListener('change', function () { act.type = typeSel.value; renderActions(); });
          var valInp = h('input', { type: 'text', value: act.value || '', placeholder: act.type === 'command' ? '#SpawnItem BP_... 1  (supports {tokens})' : 'Text (supports {tokens})' });
          valInp.addEventListener('input', function () { act.value = valInp.value; });
          actionsBox.appendChild(h('div', { class: 'ce-act' }, [h('span', { class: 'ce-act-id' }, (b.label || cid) + ' · ' + cid), typeSel, act.type ? valInp : null]));
        });
      }

      function optLabel(ce, i) { return (ce.name || ('Embed ' + (i + 1))) + (ce.enabled === false ? ' · off' : ''); }
      function refreshSel() {
        sel.innerHTML = '';
        items.forEach(function (ce, i) { sel.appendChild(h('option', { value: String(i) }, optLabel(ce, i))); });
        if (!items.length) sel.appendChild(h('option', { value: '' }, '— no embeds —'));
        sel.value = String(cur);
      }
      function showOne() {
        var ce = items[cur];
        edBox.innerHTML = ''; actionsBox.innerHTML = '';
        if (!ce) { nameInp.value = ''; chanSel.value = ''; iv.value = 60; active.checked = true; return; }
        if (!ce.id) ce.id = 'ce_' + Date.now() + '_' + cur;
        if (!ce.model) ce.model = edSvc.defaultModel();
        nameInp.value = ce.name || ''; chanSel.value = ce.channelId || ''; iv.value = ce.intervalSec || 60; active.checked = ce.enabled !== false;
        edSvc.mount(edBox, { value: ce.model, tokens: tokens, onChange: function (m) { ce.model = m; renderActions(); } });
        renderActions();
      }
      function saveAll(cb) { api('/custom', { method: 'POST', body: { items: items } }).then(cb || function () {}); }

      chanSel.appendChild(h('option', { value: '' }, '— pick a channel —'));
      channels.forEach(function (c) { chanSel.appendChild(h('option', { value: c.id }, '#' + c.name)); });

      sel.addEventListener('change', function () { cur = +sel.value || 0; showOne(); });
      nameInp.addEventListener('input', function () { if (items[cur]) { items[cur].name = nameInp.value; if (sel.options[cur]) sel.options[cur].textContent = optLabel(items[cur], cur); } });
      chanSel.addEventListener('change', function () { if (items[cur]) items[cur].channelId = chanSel.value; });
      iv.addEventListener('input', function () { if (items[cur]) items[cur].intervalSec = Number(iv.value) || 60; });
      active.addEventListener('change', function () { if (items[cur]) { items[cur].enabled = active.checked; if (sel.options[cur]) sel.options[cur].textContent = optLabel(items[cur], cur); } });

      body.appendChild(h('div', { class: 'card es-card' }, [
        h('div', { class: 'es-bar' }, [
          h('label', { class: 'es-f', style: 'flex:1 1 180px' }, [h('span', {}, 'Embed'), sel]),
          h('button', { class: 'es-btn', onclick: function () { items.push({ id: 'ce_' + Date.now(), name: 'Live status', channelId: '', intervalSec: 60, enabled: true, model: starterModel() }); cur = items.length - 1; refreshSel(); showOne(); } }, '+ Add'),
          h('button', { class: 'es-btn', onclick: function () { if (items[cur]) { items.splice(cur, 1); cur = Math.max(0, cur - 1); refreshSel(); showOne(); saveAll(); } } }, 'Remove'),
          h('button', { class: 'es-btn primary', onclick: function () { saveAll(function () { SSA.toast('Saved'); }); } }, 'Save all'),
        ]),
        h('div', { class: 'ce-head' }, [
          h('div', { class: 'ce-head-f grow' }, h('label', { class: 'es-f' }, [h('span', {}, 'Name'), nameInp])),
          h('div', { class: 'ce-head-f' }, h('label', { class: 'es-f' }, [h('span', {}, 'Channel'), chanSel])),
          h('div', { class: 'ce-head-f' }, h('label', { class: 'es-f' }, [h('span', {}, 'Refresh (sec)'), iv])),
          h('label', { class: 'es-chk' }, [active, 'Active']),
        ]),
      ]));
      body.appendChild(h('div', { class: 'card es-card' }, [
        edBox,
        actionsBox,
        h('div', { class: 'es-actions' }, [
          h('button', { class: 'es-btn primary', onclick: function () {
            if (!items[cur]) { st.textContent = 'Add an embed first.'; return; }
            st.textContent = 'Posting…';
            saveAll(function () { api('/custom/post', { method: 'POST', body: { id: items[cur].id } }).then(function (r) { st.textContent = r && r.ok ? 'Posted ✓ — keeps updating' : 'Failed (channel / bot?)'; }); });
          } }, 'Save & post now'),
          st,
        ]),
      ]));

      refreshSel(); showOne();
    }
  }

  SSA.ready(function () {
    SSA.registerTab({ id: 'embed-styler', label: 'Built-in Embeds', icon: '🎨', premium: true, render: editor });
    SSA.registerTab({ id: 'embed-custom', label: 'Custom Live Embeds', icon: '📡', premium: true, render: customEditor });
  });
}());
