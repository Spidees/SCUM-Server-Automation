/* Discord Embed Editor — admin UI + a reusable component other plugins mount via
   SSA.consume('embed-editor').mount(container, opts). Talks to its own backend at a fixed base so it
   works no matter which plugin embeds it. */
(function () {
  var EE_API = '/api/plugin-host/embed-editor';
  function api(path, opts) {
    opts = opts || {};
    var init = Object.assign({ credentials: 'same-origin' }, opts);
    if (init.body && typeof init.body === 'object') { init.headers = Object.assign({ 'Content-Type': 'application/json' }, init.headers || {}); init.body = JSON.stringify(init.body); }
    return fetch(EE_API + path, init).then(function (r) { return r.json().catch(function () { return {}; }); });
  }
  function h(tag, props, kids) {
    var e = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      if (k === 'class') e.className = props[k];
      else if (k === 'html') e.innerHTML = props[k];
      else if (k === 'text') e.textContent = props[k];
      else if (k.slice(0, 2) === 'on' && typeof props[k] === 'function') e.addEventListener(k.slice(2), props[k]);
      else if (props[k] != null && props[k] !== false) e.setAttribute(k, props[k] === true ? '' : props[k]);
    });
    (Array.isArray(kids) ? kids : (kids != null ? [kids] : [])).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function defaultModel() {
    return { title: '', url: '', description: '', color: '#ff6a1a',
      author: { name: '', url: '', icon_url: '' }, thumbnail: { url: '' }, image: { url: '' },
      footer: { text: '', icon_url: '' }, timestamp: false, fields: [], buttons: [] };
  }

  // one labelled input
  function inp(label, get, set, o) {
    o = o || {};
    var ctl;
    if (o.type === 'textarea') ctl = h('textarea', { rows: o.rows || 4, oninput: function () { set(ctl.value); } });
    else if (o.type === 'select') { ctl = h('select', { onchange: function () { set(ctl.value); } }, (o.options || []).map(function (op) { return h('option', { value: op[0] }, op[1]); })); }
    else ctl = h('input', { type: o.type || 'text', placeholder: o.ph || '', oninput: function () { set(ctl.value); } });
    if (o.type !== 'select') ctl.value = get() == null ? '' : get(); else ctl.value = String(get());
    return h('label', { class: 'ee-f' }, [h('span', {}, label), ctl]);
  }

  var STYLES = [['1', 'Primary (blurple)'], ['2', 'Secondary (grey)'], ['3', 'Success (green)'], ['4', 'Danger (red)'], ['5', 'Link (URL)']];

  function buildEditor(container, opts) {
    opts = opts || {};
    var model = opts.value ? Object.assign(defaultModel(), clone(opts.value)) : defaultModel();
    container.innerHTML = '';

    // Optional data tokens (any host: styler, vehicle-rental, …). Each is { t, label, sample }.
    // We show an "Insert data" bar and resolve {t} → sample in the live preview so it reads like the
    // real message. The saved model keeps the raw {t} — the caller resolves it for real at send time.
    var tokens = Array.isArray(opts.tokens) ? opts.tokens : [];
    var sampleMap = {}; tokens.forEach(function (tk) { if (tk && tk.t) sampleMap[tk.t] = tk.sample != null ? String(tk.sample) : ''; });
    // Live-preview resolver. Handles {token} (sample values) AND the item helpers {img:CODE} /
    // {itemName:CODE} — those are looked up from the item DB async and cached, then the preview
    // re-renders, so an item's real image/name shows in the preview too (not just literal text).
    var _itemCache = {};
    function _itemLookup(code, key) {
      code = String(code).trim(); var ck = key + ':' + code;
      if (_itemCache[ck] !== undefined) return _itemCache[ck];
      _itemCache[ck] = '';
      fetch('/api/public/items?domain=all&q=' + encodeURIComponent(code), { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var items = (d && d.items) || [], hit = null;
          for (var i = 0; i < items.length; i++) { if ((items[i].code || items[i].id || items[i].name) === code) { hit = items[i]; break; } }
          if (!hit) hit = items[0];
          _itemCache[ck] = hit ? (key === 'img' ? (hit.image || '') : (hit.name || code)) : (key === 'img' ? '' : code);
          renderPreview();
        }).catch(function () {});
      return '';
    }
    function rs(s) {
      return String(s == null ? '' : s)
        .replace(/\{img:([^}]+)\}/g, function (_m, code) { return _itemLookup(code, 'img'); })
        .replace(/\{itemName:([^}]+)\}/g, function (_m, code) { return _itemLookup(code, 'name') || String(code).trim(); })
        .replace(/\{(\w+)\}/g, function (mm, k) { return (k in sampleMap) ? sampleMap[k] : mm; });
    }

    var preview = h('div', { class: 'ee-embed' });
    var pvBtns = h('div', { class: 'ee-pv-btns' });
    var form = h('div', { class: 'ee-col' });
    var pv = h('div', { class: 'ee-col ee-pv-wrap' }, [h('div', { class: 'ee-pv-hd' }, 'Live preview'), h('div', { class: 'ee-pv' }, [preview, pvBtns])]);

    // Insert a {token} into the field box that was focused last (no copy-paste).
    var lastInput = null;
    form.addEventListener('focusin', function (e) { var t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && t.type !== 'color') lastInput = t; });
    function insertTok(tok) {
      var x = lastInput;
      if (!x || !form.contains(x)) return false;
      var s = x.selectionStart != null ? x.selectionStart : (x.value || '').length;
      var e2 = x.selectionEnd != null ? x.selectionEnd : s;
      var v = x.value || '';
      x.value = v.slice(0, s) + tok + v.slice(e2);
      x.focus(); try { x.setSelectionRange(s + tok.length, s + tok.length); } catch (_) {}
      x.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    if (tokens.length) {
      var tokWarn = h('span', { class: 'ee-tokbar-warn' });
      var search = h('input', { class: 'ee-toksearch', type: 'text', placeholder: 'Search ' + tokens.length + ' data tokens…' });
      var noHit = h('div', { class: 'ee-tok-nohit', style: 'display:none' }, 'No match');
      var bar = h('div', { class: 'ee-tokbar' }, [h('span', { class: 'ee-tokbar-l' }, 'Insert data'), search, tokWarn]);
      var grid = h('div', { class: 'ee-tokgrid' });
      var btns = [];
      tokens.forEach(function (tk) {
        var b = h('button', { class: 'ee-tok', type: 'button', title: '{' + tk.t + '}', onclick: function () {
          if (!insertTok('{' + tk.t + '}')) { tokWarn.textContent = 'Click a title / field box first'; setTimeout(function () { tokWarn.textContent = ''; }, 2500); }
        } }, [h('span', { class: 'ee-tok-n' }, tk.label || tk.t), h('span', { class: 'ee-tok-t' }, '{' + tk.t + '}')]);
        b.__s = ((tk.label || '') + ' ' + tk.t).toLowerCase();
        b.__g = tk.group || '';
        btns.push(b); grid.appendChild(b);
      });
      var curGroup = '';
      function applyTokFilter() {
        var q = search.value.trim().toLowerCase(); var any = false;
        btns.forEach(function (b) { var ok = (!q || b.__s.indexOf(q) >= 0) && (!curGroup || b.__g === curGroup); b.style.display = ok ? '' : 'none'; if (ok) any = true; });
        noHit.style.display = any ? 'none' : '';
      }
      search.addEventListener('input', applyTokFilter);
      // category chips (shown only when tokens carry a group)
      var groups = []; tokens.forEach(function (tk) { if (tk.group && groups.indexOf(tk.group) < 0) groups.push(tk.group); });
      var chips = null;
      if (groups.length) {
        chips = h('div', { class: 'ee-tokgroups' });
        var mk = function (label, g) {
          var c = h('button', { class: 'ee-tokg' + (g === '' ? ' active' : ''), type: 'button', onclick: function () {
            curGroup = g; chips.querySelectorAll('.ee-tokg').forEach(function (x) { x.classList.toggle('active', x === c); }); applyTokFilter();
          } }, label);
          return c;
        };
        chips.appendChild(mk('All', ''));
        groups.forEach(function (g) { chips.appendChild(mk(g, g)); });
      }
      container.appendChild(h('details', { class: 'ee-tokwrap', open: true }, [h('summary', {}, 'Data tokens — click a field, then a token to insert it'), h('div', { class: 'ee-tokbody' }, [bar, chips, grid, noHit])]));
    }

    // ── item picker: search the item DB and insert an item's image URL or name into the focused field ──
    if (opts.items !== false) {
      var iSearch = h('input', { class: 'ee-itemsearch', type: 'text', placeholder: 'Search items (weapon, food, vehicle…)' });
      var iWarn = h('span', { class: 'ee-tokbar-warn' });
      var iGrid = h('div', { class: 'ee-itemgrid' });
      var iTmr = null;
      function insertOrWarn(str) { if (!insertTok(str)) { iWarn.textContent = 'Click a field (e.g. Image URL) first'; setTimeout(function () { iWarn.textContent = ''; }, 2600); } }
      function runItems() {
        fetch('/api/public/items?domain=all&q=' + encodeURIComponent(iSearch.value.trim()), { credentials: 'same-origin' })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            var items = (d && d.items) || []; iGrid.innerHTML = '';
            if (!items.length) { iGrid.appendChild(h('div', { class: 'ee-itemrow-empty' }, 'No items found.')); return; }
            items.slice(0, 30).forEach(function (it) {
              var id = it.code || it.id || it.name || ''; var img = it.image || ''; var nm = it.name || id;
              iGrid.appendChild(h('div', { class: 'ee-itemrow' }, [
                img ? h('img', { src: img, alt: '', loading: 'lazy' }) : h('span', { class: 'ee-itemrow-ph' }),
                h('span', { class: 'ee-itemrow-n', title: id }, nm),
                img ? h('button', { class: 'ee-itemrow-b', type: 'button', title: 'Insert image URL', onmousedown: function (e) { e.preventDefault(); insertOrWarn(img); } }, '🖼 Image') : null,
                h('button', { class: 'ee-itemrow-b', type: 'button', title: 'Insert name', onmousedown: function (e) { e.preventDefault(); insertOrWarn(nm); } }, 'Name'),
              ]));
            });
          }).catch(function () { iGrid.innerHTML = ''; });
      }
      iSearch.addEventListener('input', function () { clearTimeout(iTmr); iTmr = setTimeout(runItems, 250); });
      container.appendChild(h('details', { class: 'ee-tokwrap ee-itemwrap' }, [
        h('summary', {}, 'Insert an item — its image or name'),
        h('div', { class: 'ee-tokbody' }, [h('div', { class: 'ee-tokbar' }, [h('span', { class: 'ee-tokbar-l' }, 'Item'), iSearch, iWarn]), iGrid]),
      ]));
    }

    container.appendChild(h('div', { class: 'ee-wrap' }, [form, pv]));

    function changed() { renderPreview(); if (typeof opts.onChange === 'function') { try { opts.onChange(clone(model)); } catch (e) {} } }

    // ── sections ──
    function sec(title, body, open) { return h('details', { class: 'ee-sec', open: open ? true : false }, [h('summary', {}, title), h('div', { class: 'ee-body' }, body)]); }

    form.appendChild(sec('Content', [
      inp('Title', function () { return model.title; }, function (v) { model.title = v; changed(); }, { ph: 'Embed title' }),
      inp('Title URL', function () { return model.url; }, function (v) { model.url = v; changed(); }, { ph: 'https://…' }),
      inp('Description', function () { return model.description; }, function (v) { model.description = v; changed(); }, { type: 'textarea', ph: 'Supports **markdown**' }),
      h('label', { class: 'ee-f' }, [h('span', {}, 'Color'), h('input', { type: 'color', value: model.color, oninput: function (e) { model.color = e.target.value; changed(); } })]),
    ], true));

    form.appendChild(sec('Author', [
      inp('Name', function () { return model.author.name; }, function (v) { model.author.name = v; changed(); }),
      h('div', { class: 'ee-row' }, [
        inp('URL', function () { return model.author.url; }, function (v) { model.author.url = v; changed(); }),
        inp('Icon URL', function () { return model.author.icon_url; }, function (v) { model.author.icon_url = v; changed(); }),
      ]),
    ]));

    form.appendChild(sec('Images', [
      inp('Thumbnail URL', function () { return model.thumbnail.url; }, function (v) { model.thumbnail.url = v; changed(); }),
      inp('Image URL', function () { return model.image.url; }, function (v) { model.image.url = v; changed(); }),
    ]));

    form.appendChild(sec('Footer', [
      inp('Footer text', function () { return model.footer.text; }, function (v) { model.footer.text = v; changed(); }),
      inp('Footer icon URL', function () { return model.footer.icon_url; }, function (v) { model.footer.icon_url = v; changed(); }),
      h('label', { class: 'ee-chk' }, [h('input', { type: 'checkbox', onchange: function (e) { model.timestamp = e.target.checked; changed(); } }), 'Show timestamp']),
    ]));

    // ── fields ──
    var fieldsBox = h('div', {});
    function renderFields() {
      fieldsBox.innerHTML = '';
      model.fields.forEach(function (f, i) {
        fieldsBox.appendChild(h('div', { class: 'ee-item' }, [
          h('button', { class: 'ee-del', title: 'Remove', onclick: function () { model.fields.splice(i, 1); renderFields(); changed(); } }, '✕'),
          inp('Name', function () { return f.name; }, function (v) { f.name = v; changed(); }),
          inp('Value', function () { return f.value; }, function (v) { f.value = v; changed(); }, { type: 'textarea', rows: 2 }),
          h('label', { class: 'ee-chk' }, [h('input', { type: 'checkbox', checked: f.inline ? true : false, onchange: function (e) { f.inline = e.target.checked; changed(); } }), 'Inline']),
        ]));
      });
      if (!model.fields.length) fieldsBox.appendChild(h('div', { class: 'ee-empty' }, 'No fields yet.'));
    }
    renderFields();
    form.appendChild(sec('Fields', [fieldsBox, h('button', { class: 'ee-btn add', onclick: function () { if (model.fields.length < 25) { model.fields.push({ name: '', value: '', inline: false }); renderFields(); changed(); } } }, '+ Add field')]));

    // ── buttons / components ──
    var btnBox = h('div', {});
    function renderBtns() {
      btnBox.innerHTML = '';
      model.buttons.forEach(function (b, i) {
        var isLink = String(b.style) === '5';
        btnBox.appendChild(h('div', { class: 'ee-item' }, [
          h('button', { class: 'ee-del', title: 'Remove', onclick: function () { model.buttons.splice(i, 1); renderBtns(); changed(); } }, '✕'),
          h('div', { class: 'ee-row' }, [
            inp('Label', function () { return b.label; }, function (v) { b.label = v; changed(); }),
            inp('Style', function () { return b.style || '1'; }, function (v) { b.style = v; renderBtns(); changed(); }, { type: 'select', options: STYLES }),
          ]),
          isLink
            ? inp('URL', function () { return b.url; }, function (v) { b.url = v; changed(); }, { ph: 'https://…' })
            : inp('Custom ID (for your onButton handler)', function () { return b.custom_id; }, function (v) { b.custom_id = v; changed(); }, { ph: 'myplugin:action' }),
          inp('Emoji (optional)', function () { return b.emoji; }, function (v) { b.emoji = v; changed(); }, { ph: '🚗 or :name:' }),
        ]));
      });
      if (!model.buttons.length) btnBox.appendChild(h('div', { class: 'ee-empty' }, 'No buttons yet.'));
    }
    renderBtns();
    form.appendChild(sec('Buttons', [btnBox, h('button', { class: 'ee-btn add', onclick: function () { if (model.buttons.length < 25) { model.buttons.push({ label: 'Button', style: '1', custom_id: '', url: '', emoji: '' }); renderBtns(); changed(); } } }, '+ Add button')]));

    // ── standalone extras: send + templates + JSON ──
    if (opts.standalone) {
      var chanSel = h('select', {}, [h('option', { value: '' }, 'Loading channels…')]);
      var sendStatus = h('span', { class: 'ee-empty' });
      api('/channels').then(function (list) {
        chanSel.innerHTML = '';
        chanSel.appendChild(h('option', { value: '' }, list && list.length ? '— pick a channel —' : 'No channels (bot offline?)'));
        (list || []).forEach(function (c) { chanSel.appendChild(h('option', { value: c.id }, '#' + c.name)); });
      });
      form.appendChild(sec('Send', [
        h('label', { class: 'ee-f' }, [h('span', {}, 'Channel'), chanSel]),
        h('div', { class: 'ee-actions' }, [
          h('button', { class: 'ee-btn primary', onclick: function () {
            if (!chanSel.value) { sendStatus.textContent = 'Pick a channel first.'; return; }
            sendStatus.textContent = 'Sending…';
            api('/send', { method: 'POST', body: { channelId: chanSel.value, embed: clone(model), buttons: model.buttons } })
              .then(function (r) { sendStatus.textContent = r && r.ok ? 'Sent ✓' : ('Failed' + (r && r.error ? ': ' + r.error : '')); });
          } }, 'Send to channel'),
          sendStatus,
        ]),
      ], true));

      var tplSel = h('select', {}, [h('option', { value: '' }, '—')]);
      function loadTpls() { api('/templates').then(function (t) { tplSel.innerHTML = ''; tplSel.appendChild(h('option', { value: '' }, '— saved templates —')); Object.keys(t || {}).forEach(function (n) { tplSel.appendChild(h('option', { value: n }, n)); }); tplSel._data = t || {}; }); }
      loadTpls();
      form.appendChild(sec('Templates', [
        h('div', { class: 'ee-row' }, [
          tplSel,
          h('button', { class: 'ee-btn', onclick: function () { var n = tplSel.value; if (n && tplSel._data[n]) editor.setValue(tplSel._data[n]); } }, 'Load'),
        ]),
        h('div', { class: 'ee-actions' }, [
          h('button', { class: 'ee-btn', onclick: function () { var n = prompt('Template name:'); if (n) api('/templates', { method: 'POST', body: { name: n, data: clone(model) } }).then(loadTpls); } }, 'Save current'),
          h('button', { class: 'ee-btn', onclick: function () { var n = tplSel.value; if (n && confirm('Delete "' + n + '"?')) api('/templates/delete', { method: 'POST', body: { name: n } }).then(loadTpls); } }, 'Delete'),
        ]),
      ]));

      var jsonTa = h('textarea', { rows: 6, style: 'width:100%' });
      form.appendChild(sec('JSON (import / export)', [
        jsonTa,
        h('div', { class: 'ee-actions' }, [
          h('button', { class: 'ee-btn', onclick: function () { jsonTa.value = JSON.stringify(clone(model), null, 2); } }, 'Export'),
          h('button', { class: 'ee-btn', onclick: function () { try { editor.setValue(JSON.parse(jsonTa.value)); } catch (e) { alert('Invalid JSON'); } } }, 'Import'),
        ]),
      ]));
    }

    // ── preview render ──
    function renderPreview() {
      preview.style.borderLeftColor = model.color || '#ff6a1a';
      var main = h('div', { class: 'ee-main' });
      if (model.author.name) main.appendChild(h('div', { class: 'ee-author' }, [model.author.icon_url ? h('img', { src: model.author.icon_url, onerror: function () { this.style.display = 'none'; } }) : null, rs(model.author.name)]));
      if (model.title) main.appendChild(h('div', { class: 'ee-title' + (model.url ? '' : ' plain') }, rs(model.title)));
      if (model.description) main.appendChild(h('div', { class: 'ee-desc', text: rs(model.description) }));
      if (model.fields.length) {
        var grid = h('div', { class: 'ee-fields' });
        model.fields.forEach(function (f) { grid.appendChild(h('div', { class: 'ee-field' + (f.inline ? '' : ' wide') }, [h('b', { text: rs(f.name) || '​' }), h('span', { text: rs(f.value) || '​' })])); });
        main.appendChild(grid);
      }
      if (model.image.url) main.appendChild(h('div', { class: 'ee-img' }, h('img', { src: model.image.url, onerror: function () { this.style.display = 'none'; } })));
      if (model.footer.text || model.timestamp) {
        var ft = h('div', { class: 'ee-footer' }, [model.footer.icon_url ? h('img', { src: model.footer.icon_url, onerror: function () { this.style.display = 'none'; } }) : null, rs(model.footer.text || '') + (model.timestamp ? (model.footer.text ? ' • ' : '') + new Date().toLocaleString() : '')]);
        main.appendChild(ft);
      }
      preview.innerHTML = '';
      preview.appendChild(main);
      if (model.thumbnail.url) preview.appendChild(h('div', { class: 'ee-thumb' }, h('img', { src: model.thumbnail.url, onerror: function () { this.style.display = 'none'; } })));
      // buttons preview
      pvBtns.innerHTML = '';
      model.buttons.forEach(function (b) { pvBtns.appendChild(h('button', { class: 'ee-pv-btn s' + (b.style || '1'), type: 'button' }, (b.emoji ? b.emoji + ' ' : '') + (b.label || 'Button'))); });
    }

    var editor = {
      getValue: function () { return clone(model); },
      setValue: function (v) { model = Object.assign(defaultModel(), clone(v || {})); container.innerHTML = ''; buildEditor(container, Object.assign({}, opts, { value: model })); },
      destroy: function () { container.innerHTML = ''; },
    };
    renderPreview();
    return editor;
  }

  // reusable component for OTHER plugins
  SSA.provide('embed-editor', { mount: buildEditor, defaultModel: defaultModel });

  // standalone editor tab
  SSA.ready(function () {
    SSA.registerTab({
      id: 'embed-editor', label: 'Embeds', icon: '📝', premium: true,
      render: function (el) {
        el.innerHTML = '<div style="padding:14px 16px 4px"><h2>Discord Embed Editor</h2><p class="muted" style="font-size:.86rem">Design an embed, preview it live, send it to a channel or save it as a template. Other plugins can embed this editor in their own settings.</p></div>';
        var host = h('div', { style: 'padding:0 16px 16px' });
        el.appendChild(host);
        buildEditor(host, { standalone: true });
      },
    });
  });
}());
