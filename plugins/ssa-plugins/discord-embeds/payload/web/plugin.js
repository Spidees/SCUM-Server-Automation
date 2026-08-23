/* Discord Embed Editor — admin UI + a reusable component other plugins mount via
   SSA.consume('embed-editor').mount(container, opts). Talks to its own backend at a fixed base so it
   works no matter which plugin embeds it.

   UI shape, and why:
   • Standalone gets TABS (Editor / Templates / Sent messages). One endless page mixed three
     unrelated jobs — writing a message, managing saved layouts, and fixing something already
     posted — and made all three harder to find.
   • Formatting, emoji, data tokens and the game-DB picker live UNDER THE FIELD they apply to, not in
     one bar at the top. A global toolbar has to ask "which box did you mean?", which is exactly the
     question the user should never have to answer.
   • Embedded in another plugin (no `standalone`), it stays a compact editor: no tabs, no send, no
     history — that host has its own save button and its own page. */
(function () {
  var EE_API = '/api/plugin-host/discord-embeds';
  // Shared by all three tabs (they live in two separate IIFEs), so the module identifies itself the
  // same way wherever you land. Before, one tab had an <h2> and the other two had a bare paragraph,
  // which made the module look like it started and stopped depending on where you clicked.
  window.eeHead = function (tab, sub) {
    return '<div class="ee-head"><div class="ee-head-t"><span class="ee-head-m">Discord Embeds</span>'
      + '<span class="ee-head-sep">/</span><span class="ee-head-s">' + tab + '</span></div>'
      + (sub ? '<p class="ee-head-p">' + sub + '</p>' : '') + '</div>';
  };
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
      footer: { text: '', icon_url: '' }, timestamp: false, fields: [], buttons: [],
      content: '',            // plain text above the embed (pings live here)
      extraEmbeds: [],        // embeds 2..10 (Discord allows ten per message)
      selects: [] };          // select menus, each taking a whole component row
  }

  var STYLES = [['1', 'Primary (blurple)'], ['2', 'Secondary (grey)'], ['3', 'Success (green)'], ['4', 'Danger (red)'], ['5', 'Link (URL)']];
  // Everything the game DB can be searched by. The picker used to query only `items`, so vehicles,
  // animals and the rest were simply unreachable from the editor.
  var DOMAINS = [['items', 'Items'], ['tradeables', 'Tradeables'], ['vehicles', 'Vehicles'],
    ['animals', 'Animals'], ['zombies', 'Zombies'], ['npcs', 'NPCs'], ['building', 'Building']];

  // ── Discord-flavoured markdown, for the preview ──────────────────────────────
  // A small subset renderer rather than a markdown library: it only has to show what Discord itself
  // shows. Everything is escaped FIRST, so a pasted embed can never inject HTML into the panel.
  function mdToHtml(src) {
    var NL = String.fromCharCode(10);
    var t = esc(String(src == null ? '' : src));
    // Fenced code first — nothing inside it may be formatted, so each block is parked behind a
    // placeholder no later rule can match, and restored at the very end.
    var blocks = [];
    var park = function (html) { blocks.push(html); return '␟b' + (blocks.length - 1) + '␟'; };
    t = t.replace(/```(\w+)?\r?\n?([\s\S]*?)```/g, function (_m, lang, code) {
      return park('<pre class="ee-code">' + code.replace(/\s+$/, '') + '</pre>');
    });
    t = t.replace(/`([^`\r\n]+)`/g, function (_m, code) { return park('<code class="ee-inline">' + code + '</code>'); });
    // Discord timestamps render as a real local time — that is the point of using them.
    t = t.replace(/&lt;t:(\d+)(?::([tTdDfFR]))?&gt;/g, function (_m, unix) {
      var d = new Date(Number(unix) * 1000);
      return '<span class="ee-ts">' + (isNaN(d.getTime()) ? '?' : d.toLocaleString()) + '</span>';
    });
    t = t.replace(/&lt;a?:(\w+):(\d+)&gt;/g, '<span class="ee-emojitok" title=":$1:">:$1:</span>');
    t = t.replace(/&lt;@&amp;(\d+)&gt;/g, '<span class="ee-mention">@role</span>');
    t = t.replace(/&lt;@!?(\d+)&gt;/g, '<span class="ee-mention">@user</span>');
    t = t.replace(/&lt;#(\d+)&gt;/g, '<span class="ee-mention">#channel</span>');
    t = t.replace(/(^|\s)(@everyone|@here)\b/g, '$1<span class="ee-mention">$2</span>');
    t = t.replace(/^###\s+(.*)$/gm, '<div class="ee-h3">$1</div>')
         .replace(/^##\s+(.*)$/gm, '<div class="ee-h2">$1</div>')
         .replace(/^#\s+(.*)$/gm, '<div class="ee-h1">$1</div>');
    t = t.replace(/^&gt;\s?(.*)$/gm, '<div class="ee-quote">$1</div>');
    t = t.replace(/^[-*]\s+(.*)$/gm, '<div class="ee-li">• $1</div>');
    t = t.replace(/\|\|([\s\S]+?)\|\|/g, '<span class="ee-spoiler">$1</span>');
    t = t.replace(/\*\*\*([\s\S]+?)\*\*\*/g, '<b><i>$1</i></b>')
         .replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>')
         .replace(/(^|[^*])\*([^*\r\n]+)\*/g, '$1<i>$2</i>')
         .replace(/__([\s\S]+?)__/g, '<u>$1</u>')
         .replace(/_([^_\r\n]+)_/g, '<i>$1</i>')
         .replace(/~~([\s\S]+?)~~/g, '<s>$1</s>');
    t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a class="ee-link" href="$2" target="_blank" rel="noopener">$1</a>');
    t = t.replace(/␟b(\d+)␟/g, function (_m, i) { return blocks[Number(i)]; });
    return t.split(NL).join('<br>');
  }

  // Discord's own size limits. Nothing warned about these before, so an over-long embed was simply
  // rejected at send time with no clue which part was to blame.
  var LIMITS = { title: 256, description: 4096, fieldName: 256, fieldValue: 1024, footer: 2048, author: 256, content: 2000, total: 6000, fields: 25 };

  function buildEditor(container, opts) {
    opts = opts || {};
    var model = opts.value ? Object.assign(defaultModel(), clone(opts.value)) : defaultModel();
    container.innerHTML = '';
    container.classList.add('ee-root');

    // Live data. Two sources, merged: whatever the HOST plugin knows about its own events (a
    // kill's weapon, a rental's price — only it can know those), plus the server-wide catalog the
    // EDITOR fetches for everyone. A plugin that mounts this gets live tokens for free instead of
    // wiring its own picker, and the editor resolves them itself when it sends.
    var tokens = Array.isArray(opts.tokens) ? opts.tokens.slice() : [];
    var sampleMap = {};
    function indexTokens() {
      sampleMap = {};
      tokens.forEach(function (tk) { if (tk && tk.t) sampleMap[tk.t] = tk.sample != null ? String(tk.sample) : ''; });
    }
    indexTokens();
    var tokensReady = false;
    // Re-fetched, not fetched once: the samples carry the server's CURRENT numbers, so a preview
    // left open would otherwise keep showing the online count from when the tab was opened.
    function loadTokens() {
      return api('/tokens').then(function (list) {
        tokensReady = true;
        if (!Array.isArray(list) || !list.length) return;
        var byName = {};
        tokens.forEach(function (t) { if (t && t.t) byName[t.t] = t; });
        list.forEach(function (t) {
          if (!t || !t.t) return;
          // A host token of the same name wins on LABEL (it is the more specific one), but a live
          // value still refreshes the sample — otherwise the preview shows an invented number.
          if (byName[t.t]) { if (t.live) { byName[t.t].sample = t.sample; byName[t.t].live = true; } return; }
          tokens.push(t);
        });
        indexTokens();
        renderPreview();
      }).catch(function () { tokensReady = true; });
    }
    loadTokens();
    var tokTimer = setInterval(loadTokens, 20000);
    // The editor is rebuilt (not unmounted) on setValue, so clear the old timer or they stack up.
    if (container._eeTokTimer) clearInterval(container._eeTokTimer);
    container._eeTokTimer = tokTimer;

    // ── live-preview resolver ───────────────────────────────────────────────────
    // {token} → sample value, plus the item helpers {img:CODE} / {itemName:CODE}, looked up from the
    // game DB async and cached so the preview shows the real image/name instead of literal text.
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

    function changed() {
      renderPreview(); renderLimits(); pushUndo();
      if (typeof opts.onChange === 'function') { try { opts.onChange(clone(model)); } catch (e) {} }
    }

    // ── one shared popover ──────────────────────────────────────────────────────
    // Emoji, tokens and the game-DB picker all borrow it, anchored to the button that opened it and
    // remembering which input to write into. One popover instead of three permanent panels keeps the
    // form short, and insertion is never ambiguous.
    var pop = h('div', { class: 'ee-pop', hidden: true });
    var popBody = h('div', { class: 'ee-pop-body' });
    pop.appendChild(h('button', { class: 'ee-pop-x', type: 'button', title: 'Close', onclick: function () { closePop(); } }, '×'));
    pop.appendChild(popBody);
    container.appendChild(pop);
    var popFor = null, popKind = null;
    function closePop() { pop.hidden = true; popFor = null; popKind = null; }
    document.addEventListener('mousedown', function (e) {
      if (pop.hidden) return;
      if (pop.contains(e.target) || (e.target.closest && e.target.closest('.ee-tool'))) return;
      closePop();
    });
    function openPop(kind, anchor, input, build) {
      if (!pop.hidden && popKind === kind && popFor === input) return closePop();   // the same button closes it
      popKind = kind; popFor = input;
      popBody.innerHTML = '';
      popBody.appendChild(build(input));
      pop.hidden = false;
      // Positioned in container coordinates and clamped, so it can't hang off the panel edge.
      var cr = container.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
      pop.style.left = Math.max(4, Math.min(ar.left - cr.left, container.clientWidth - pop.offsetWidth - 4)) + 'px';
      pop.style.top = (ar.bottom - cr.top + 6) + 'px';
    }

    // Insert text into a SPECIFIC input at its caret.
    function insertInto(x, text) {
      if (!x) return;
      var v = x.value || '';
      var s = x.selectionStart != null ? x.selectionStart : v.length;
      var e = x.selectionEnd != null ? x.selectionEnd : s;
      x.value = v.slice(0, s) + text + v.slice(e);
      x.focus(); try { x.setSelectionRange(s + text.length, s + text.length); } catch (_) {}
      x.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Wrap the selection, or drop the markers in with the caret between them. `line` prefixes each
    // touched line instead (quotes, lists, headings).
    function wrapIn(x, before, after, line) {
      if (!x) return;
      var NL = String.fromCharCode(10);
      var v = x.value || '';
      var s0 = x.selectionStart != null ? x.selectionStart : v.length;
      var e0 = x.selectionEnd != null ? x.selectionEnd : s0;
      var sel = v.slice(s0, e0), out, caret;
      if (line) {
        var from = v.lastIndexOf(NL, s0 - 1) + 1;
        var body = v.slice(from, e0) || sel;
        var pre = body.split(NL).map(function (l) { return before + l; }).join(NL);
        out = v.slice(0, from) + pre + v.slice(e0);
        caret = from + pre.length;
      } else {
        out = v.slice(0, s0) + before + sel + after + v.slice(e0);
        caret = sel ? s0 + before.length + sel.length + after.length : s0 + before.length;
      }
      x.value = out;
      x.focus(); try { x.setSelectionRange(caret, caret); } catch (_) {}
      x.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // ── emoji ───────────────────────────────────────────────────────────────────
    // The standard set is GENERATED from Unicode ranges rather than hand-listed: a curated handful
    // is not "all the emoji", and a hand-list goes stale. Codepoints are filtered through
    // Emoji_Presentation, which drops the unassigned holes inside those blocks.
    var EMOJI_RANGES = {
      Smileys: [[0x1F600, 0x1F64F], [0x1F910, 0x1F93A], [0x1F970, 0x1F97A]],
      People: [[0x1F466, 0x1F487], [0x1F9D0, 0x1F9DF], [0x1F44A, 0x1F450]],
      Animals: [[0x1F400, 0x1F43F], [0x1F980, 0x1F9AE], [0x1F330, 0x1F344]],
      Food: [[0x1F345, 0x1F37F], [0x1F950, 0x1F96F]],
      Travel: [[0x1F680, 0x1F6C5], [0x1F30D, 0x1F32C]],
      Activity: [[0x1F3A0, 0x1F3F0], [0x1F93B, 0x1F94F]],
      Objects: [[0x1F4A0, 0x1F4FF], [0x1F526, 0x1F53D], [0x1F6E0, 0x1F6F9]],
      Symbols: [[0x2600, 0x27BF], [0x1F500, 0x1F525], [0x2B00, 0x2BFF]],
    };
    var _std = null;
    function standardEmoji() {
      if (_std) return _std;
      _std = {};
      var canTest = true;
      try { new RegExp('\\p{Emoji_Presentation}', 'u'); } catch (e) { canTest = false; }
      var re = canTest ? new RegExp('\\p{Emoji_Presentation}', 'u') : null;
      Object.keys(EMOJI_RANGES).forEach(function (cat) {
        var out = [];
        EMOJI_RANGES[cat].forEach(function (r) {
          for (var c = r[0]; c <= r[1]; c++) {
            var ch = String.fromCodePoint(c);
            // Without Unicode property escapes (very old browsers) take the range as-is rather than
            // show nothing at all.
            if (!re || re.test(ch)) out.push(ch);
          }
        });
        _std[cat] = out;
      });
      return _std;
    }

    var _custom = null;
    function emojiPop(input) {
      var wrap = h('div', {});
      var tabs = h('div', { class: 'ee-chips' });
      var body = h('div', {});
      var mode = 'std';
      var cat = 'Smileys';
      var search = h('input', { type: 'text', placeholder: 'Search…', class: 'ee-popsearch' });

      function drawStd() {
        body.innerHTML = '';
        var std = standardEmoji();
        var cats = h('div', { class: 'ee-chips' });
        Object.keys(std).forEach(function (c) {
          cats.appendChild(h('button', { class: 'ee-chip' + (c === cat ? ' active' : ''), type: 'button',
            onclick: function () { cat = c; drawStd(); } }, c));
        });
        body.appendChild(cats);
        var grid = h('div', { class: 'ee-emogrid' });
        std[cat].forEach(function (e) {
          grid.appendChild(h('button', { class: 'ee-emo', type: 'button', onclick: function () { insertInto(input, e); } }, e));
        });
        body.appendChild(grid);
        body.appendChild(h('div', { class: 'ee-empty' }, std[cat].length + ' in ' + cat));
      }

      function drawCustom() {
        body.innerHTML = '';
        body.appendChild(search);
        var grid = h('div', { class: 'ee-emogrid' });
        var q = search.value.trim().toLowerCase();
        var list = (_custom || []).filter(function (c) { return !q || c.name.toLowerCase().indexOf(q) >= 0; });
        list.forEach(function (c) {
          var b = h('button', { class: 'ee-emo', type: 'button', title: ':' + c.name + ':', onclick: function () { insertInto(input, c.text); } });
          if (c.url) b.appendChild(h('img', { src: c.url, alt: c.name })); else b.textContent = ':' + c.name + ':';
          grid.appendChild(b);
        });
        body.appendChild(grid);
        if (!list.length) body.appendChild(h('div', { class: 'ee-empty' }, _custom === null ? 'Loading…' : (q ? 'Nothing matches.' : 'This Discord server has no custom emoji.')));
      }

      function draw() {
        tabs.innerHTML = '';
        [['std', 'Discord'], ['srv', 'Server emoji']].forEach(function (t) {
          tabs.appendChild(h('button', { class: 'ee-chip' + (mode === t[0] ? ' active' : ''), type: 'button',
            onclick: function () { mode = t[0]; draw(); } }, t[1]));
        });
        if (mode === 'std') drawStd(); else drawCustom();
      }
      search.addEventListener('input', function () { if (mode === 'srv') drawCustom(); });
      if (_custom === null) api('/emojis').then(function (l) { _custom = Array.isArray(l) ? l : []; if (mode === 'srv') drawCustom(); });
      draw();
      wrap.appendChild(tabs);
      wrap.appendChild(body);
      return wrap;
    }

    // ── live data ───────────────────────────────────────────────────────────────
    // Wide two-column list with its own search and group chips: the catalog runs to dozens of
    // entries, and a small box made finding one of them a scrolling exercise.
    function tokenPop(input) {
      var grid = h('div', { class: 'ee-tokgrid' });
      var tokPager = h('div', { class: 'ee-pagerbox' });
      var search = h('input', { type: 'text', placeholder: 'Search live data…', class: 'ee-popsearch' });
      var curGroup = '';
      var chips = h('div', { class: 'ee-chips' });
      function draw() {
        var q = search.value.trim().toLowerCase();
        chips.innerHTML = '';
        var groups = [];
        tokens.forEach(function (tk) { if (tk.group && groups.indexOf(tk.group) < 0) groups.push(tk.group); });
        if (groups.length > 1) {
          var mk = function (label, g) {
            return h('button', { class: 'ee-chip' + (g === curGroup ? ' active' : ''), type: 'button',
              onclick: function () { curGroup = g; draw(); } }, label);
          };
          chips.appendChild(mk('All', ''));
          groups.forEach(function (g) { chips.appendChild(mk(g, g)); });
        }
        grid.innerHTML = '';
        tokPager.innerHTML = '';
        var matches = tokens.filter(function (tk) {
          if (curGroup && tk.group !== curGroup) return false;
          return !q || ((tk.label || '') + ' ' + tk.t).toLowerCase().indexOf(q) >= 0;
        });
        tokPager.appendChild(paginate(grid, matches, function (tk) {
          var full = tk.sample != null ? String(tk.sample) : '';
          return h('button', { class: 'ee-tok' + (tk.live ? ' live' : ''), type: 'button',
            // The value can be a whole rendered list, so the chip shows a clipped version and the
            // tooltip carries the token plus what it currently resolves to.
            title: '{' + tk.t + '}' + (full ? '\n' + full : ''),
            onclick: function () { insertInto(input, '{' + tk.t + '}'); } },
          [h('b', {}, tk.label || tk.t), full ? h('span', {}, full.length > 40 ? full.slice(0, 40) + '…' : full) : null]);
        }, { perPage: 60, empty: tokensReady ? 'Nothing matches.' : 'Loading live data…' }));
      }
      search.addEventListener('input', draw);
      draw();
      loadTokens().then(draw);   // opening the picker is a good moment to be current
      return h('div', { class: 'ee-tokpanel' }, [
        h('div', { class: 'ee-tokhint' }, 'Values shown are this server right now. Greyed ones only exist while the event they belong to fires.'),
        search, chips, grid, tokPager]);
    }

    /**
     * Render one page of `list` into `grid` with a pager underneath.
     *
     * Long result sets were previously cut to the first 60 rows with nothing said about it, which
     * reads as "that is everything" when it is not — the item database alone runs to thousands.
     * `drawRow(item)` returns the element for a row.
     */
    function paginate(grid, list, drawRow, opts) {
      var perPage = (opts && opts.perPage) || 50;
      var page = 0;
      var pages = Math.max(1, Math.ceil(list.length / perPage));
      var pager = h('div', { class: 'ee-pager' });
      function draw() {
        grid.innerHTML = '';
        if (!list.length) { grid.appendChild(h('span', { class: 'ee-empty' }, (opts && opts.empty) || 'Nothing found.')); return; }
        var from = page * perPage;
        list.slice(from, from + perPage).forEach(function (it, i) {
          var el = drawRow(it, from + i);
          if (el) grid.appendChild(el);
        });
        pager.innerHTML = '';
        if (pages > 1) {
          var info = h('span', { class: 'ee-pageinfo' },
            (from + 1) + '–' + Math.min(from + perPage, list.length) + ' of ' + list.length);
          var prev = h('button', { class: 'ee-btn xs', type: 'button', disabled: page === 0 ? '' : null,
            onclick: function () { if (page > 0) { page--; draw(); } } }, '‹ Prev');
          var next = h('button', { class: 'ee-btn xs', type: 'button', disabled: page >= pages - 1 ? '' : null,
            onclick: function () { if (page < pages - 1) { page++; draw(); } } }, 'Next ›');
          pager.appendChild(prev);
          pager.appendChild(info);
          pager.appendChild(next);
        } else {
          pager.appendChild(h('span', { class: 'ee-pageinfo' }, list.length + (list.length === 1 ? ' result' : ' results')));
        }
      }
      draw();
      return pager;
    }

    // ── game database ───────────────────────────────────────────────────────────
    // Domains are CHIPS, not a <select>. A native dropdown renders its list outside the DOM, so
    // clicking an option counted as a click outside the popover and closed the whole thing before
    // the choice could take effect.
    function dbPop(input) {
      var domain = 'items';
      var search = h('input', { type: 'text', placeholder: 'Search…', class: 'ee-popsearch' });
      var chips = h('div', { class: 'ee-chips' });
      var grid = h('div', { class: 'ee-dbgrid' });
      var pagerBox = h('div', { class: 'ee-pagerbox' });
      var tmr = null;
      function run() {
        grid.innerHTML = '<span class="ee-empty">Searching…</span>';
        fetch('/api/public/items?domain=' + encodeURIComponent(domain) + '&q=' + encodeURIComponent(search.value.trim()), { credentials: 'same-origin' })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            var list = (d && d.items) || [];
            grid.innerHTML = '';
            if (pagerBox) pagerBox.innerHTML = '';
            var pager = paginate(grid, list, function (it) {
              var nm = it.name || it.code || '?', code = it.code || it.id || '', img = it.image || '';
              return h('div', { class: 'ee-dbrow' }, [
                img ? h('img', { src: img, alt: '', onerror: function () { this.style.display = 'none'; } }) : h('span', { class: 'ee-dbnoimg' }, '□'),
                h('span', { class: 'ee-dbname', title: code }, nm),
                h('button', { class: 'ee-btn xs', type: 'button', title: 'Insert the name', onclick: function () { insertInto(input, nm); } }, 'Name'),
                img ? h('button', { class: 'ee-btn xs', type: 'button', title: 'Insert the image URL', onclick: function () { insertInto(input, img); } }, 'Image') : null,
                code ? h('button', { class: 'ee-btn xs', type: 'button', title: 'Insert {img:CODE} — resolved when the embed is sent', onclick: function () { insertInto(input, '{img:' + code + '}'); } }, '{img}') : null,
              ]);
            }, { empty: 'Nothing found.' });
            if (pagerBox) pagerBox.appendChild(pager);
          }).catch(function () { grid.innerHTML = '<span class="ee-empty">Search failed.</span>'; });
      }
      DOMAINS.forEach(function (d) {
        chips.appendChild(h('button', { class: 'ee-chip' + (d[0] === domain ? ' active' : ''), type: 'button',
          onclick: function () {
            domain = d[0];
            chips.querySelectorAll('.ee-chip').forEach(function (x, i) { x.classList.toggle('active', DOMAINS[i][0] === domain); });
            run();
          } }, d[1]));
      });
      search.addEventListener('input', function () { clearTimeout(tmr); tmr = setTimeout(run, 250); });
      run();
      return h('div', {}, [chips, search, grid, pagerBox]);
    }

    // ── one labelled field, with its own tools underneath ───────────────────────
    var MD = [
      ['B', 'Bold', '**', '**', false], ['I', 'Italic', '*', '*', false],
      ['U', 'Underline', '__', '__', false], ['S', 'Strikethrough', '~~', '~~', false],
      ['&lt;/&gt;', 'Inline code', '`', '`', false], ['▤', 'Code block', '```\n', '\n```', false],
      ['❝', 'Quote', '> ', '', true], ['•', 'List', '- ', '', true], ['H', 'Heading', '## ', '', true],
      ['◼', 'Spoiler', '||', '||', false], ['🔗', 'Link', '[', '](https://)', false],
    ];
    function field(label, get, set, o) {
      o = o || {};
      var ctl;
      if (o.type === 'textarea') ctl = h('textarea', { rows: o.rows || 4, placeholder: o.ph || '', oninput: function () { set(ctl.value); } });
      else if (o.type === 'select') ctl = h('select', { onchange: function () { set(ctl.value); } }, (o.options || []).map(function (op) { return h('option', { value: op[0] }, op[1]); }));
      else ctl = h('input', { type: o.type || 'text', placeholder: o.ph || '', oninput: function () { set(ctl.value); } });
      ctl.value = o.type === 'select' ? String(get()) : (get() == null ? '' : get());

      var kids = [h('span', {}, label), ctl];
      if (o.md) {
        // Ctrl/Cmd+B, I, U, K — what anyone typing into a rich text box already expects. The
        // toolbar stays: shortcuts are for people who know them, buttons are for everyone else.
        ctl.addEventListener('keydown', function (ev) {
          if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
          var k = String(ev.key || '').toLowerCase();
          var map = { b: ['**', '**'], i: ['*', '*'], u: ['__', '__'], k: ['[', '](https://)'] };
          if (!map[k]) return;
          ev.preventDefault();
          wrapIn(ctl, map[k][0], map[k][1], false);
        });
      }
      if (o.md || o.insert) {
        var tools = h('div', { class: 'ee-tools' });
        if (o.md) {
          MD.forEach(function (m) {
            tools.appendChild(h('button', { class: 'ee-tool', type: 'button', title: m[1], html: m[0],
              onclick: function () { wrapIn(ctl, m[2], m[3], m[4]); } }));
          });
          tools.appendChild(h('button', { class: 'ee-tool', type: 'button', title: 'Timestamp — shown in each viewer’s own local time',
            onclick: function () {
              var when = prompt('Timestamp — minutes from now (negative = past):', '60');
              if (when === null) return;
              insertInto(ctl, '<t:' + Math.floor((Date.now() + (Number(when) || 0) * 60000) / 1000) + ':R>');
            } }, '⏱'));
          tools.appendChild(h('button', { class: 'ee-tool', type: 'button', title: 'Mention a user, role, @everyone or @here',
            onclick: function () {
              var id = prompt('Mention — paste a user/role ID, or type everyone / here:', '');
              if (!id) return;
              id = String(id).trim();
              if (/^@?everyone$/i.test(id)) return insertInto(ctl, '@everyone');
              if (/^@?here$/i.test(id)) return insertInto(ctl, '@here');
              if (!/^\d+$/.test(id)) return;
              insertInto(ctl, confirm('OK = role mention, Cancel = user mention') ? '<@&' + id + '>' : '<@' + id + '>');
            } }, '@'));
        }
        var eb = h('button', { class: 'ee-tool', type: 'button', title: 'Emoji' }, '😀');
        eb.addEventListener('click', function () { openPop('emoji', eb, ctl, emojiPop); });
        tools.appendChild(eb);
        var tb = h('button', { class: 'ee-tool', type: 'button', title: 'Insert live data' }, '{ }');
        tb.addEventListener('click', function () { openPop('tok', tb, ctl, tokenPop); });
        tools.appendChild(tb);
        var dbb = h('button', { class: 'ee-tool', type: 'button', title: 'Items, vehicles, animals…' }, '📦');
        dbb.addEventListener('click', function () { openPop('db', dbb, ctl, dbPop); });
        tools.appendChild(dbb);
        kids.push(tools);
      }
      if (o.max) {
        var counter = h('span', { class: 'ee-count' });
        var upd = function () {
          var n = (ctl.value || '').length;
          counter.textContent = n + ' / ' + o.max;
          counter.classList.toggle('over', n > o.max);
        };
        ctl.addEventListener('input', upd); upd();
        kids.push(counter);
      }
      return h('label', { class: 'ee-f' }, kids);
    }

    // ── limits ──────────────────────────────────────────────────────────────────
    function limitProblems() {
      var out = [], len = function (x) { return String(x || '').length; };
      if (len(model.title) > LIMITS.title) out.push('Title is ' + len(model.title) + '/' + LIMITS.title);
      if (len(model.description) > LIMITS.description) out.push('Description is ' + len(model.description) + '/' + LIMITS.description);
      if (len(model.content) > LIMITS.content) out.push('Message text is ' + len(model.content) + '/' + LIMITS.content);
      if (len(model.footer.text) > LIMITS.footer) out.push('Footer is ' + len(model.footer.text) + '/' + LIMITS.footer);
      if (len(model.author.name) > LIMITS.author) out.push('Author is ' + len(model.author.name) + '/' + LIMITS.author);
      if (model.fields.length > LIMITS.fields) out.push(model.fields.length + ' fields (max ' + LIMITS.fields + ')');
      model.fields.forEach(function (f, i) {
        if (len(f.name) > LIMITS.fieldName) out.push('Field ' + (i + 1) + ' name is ' + len(f.name) + '/' + LIMITS.fieldName);
        if (len(f.value) > LIMITS.fieldValue) out.push('Field ' + (i + 1) + ' value is ' + len(f.value) + '/' + LIMITS.fieldValue);
      });
      var total = len(model.title) + len(model.description) + len(model.footer.text) + len(model.author.name)
        + model.fields.reduce(function (a, f) { return a + len(f.name) + len(f.value); }, 0);
      if (total > LIMITS.total) out.push('Embed totals ' + total + '/' + LIMITS.total + ' characters');
      return out;
    }
    var limitBox = h('div', { class: 'ee-limits' });
    function renderLimits() {
      var probs = limitProblems();
      limitBox.innerHTML = '';
      limitBox.className = 'ee-limits' + (probs.length ? ' bad' : '');
      probs.forEach(function (p) { limitBox.appendChild(h('div', {}, '⚠ ' + p)); });
    }

    // ── the editor form ─────────────────────────────────────────────────────────
    var preview = h('div', { class: 'ee-embed' });
    var pvContent = h('div', { class: 'ee-pv-content' });
    var pvExtra = h('div', { class: 'ee-pv-extra' });
    var pvBtns = h('div', { class: 'ee-pv-btns' });
    var form = h('div', { class: 'ee-col' });
    function sec(title, body, open) { return h('details', { class: 'ee-sec', open: open ? true : false }, [h('summary', {}, title), h('div', { class: 'ee-body' }, body)]); }

    form.appendChild(limitBox);
    form.appendChild(sec('Message text (above the embed)', [
      field('Text', function () { return model.content; }, function (v) { model.content = v; changed(); },
        { type: 'textarea', rows: 2, md: true, max: LIMITS.content, ph: 'Optional — only mentions HERE actually ping.' }),
    ]));
    form.appendChild(sec('Content', [
      field('Title', function () { return model.title; }, function (v) { model.title = v; changed(); }, { md: true, max: LIMITS.title, ph: 'Embed title' }),
      field('Title URL', function () { return model.url; }, function (v) { model.url = v; changed(); }, { ph: 'https://…' }),
      field('Description', function () { return model.description; }, function (v) { model.description = v; changed(); }, { type: 'textarea', md: true, max: LIMITS.description, ph: 'Supports **markdown**' }),
      h('label', { class: 'ee-f' }, [h('span', {}, 'Colour'), h('input', { type: 'color', value: model.color, oninput: function (e) { model.color = e.target.value; changed(); } })]),
    ], true));
    form.appendChild(sec('Author', [
      field('Name', function () { return model.author.name; }, function (v) { model.author.name = v; changed(); }, { max: LIMITS.author }),
      field('URL', function () { return model.author.url; }, function (v) { model.author.url = v; changed(); }),
      field('Icon URL', function () { return model.author.icon_url; }, function (v) { model.author.icon_url = v; changed(); }, { insert: true }),
    ]));
    form.appendChild(sec('Images', [
      field('Thumbnail URL', function () { return model.thumbnail.url; }, function (v) { model.thumbnail.url = v; changed(); }, { insert: true }),
      field('Image URL', function () { return model.image.url; }, function (v) { model.image.url = v; changed(); }, { insert: true }),
    ]));
    form.appendChild(sec('Footer', [
      field('Footer text', function () { return model.footer.text; }, function (v) { model.footer.text = v; changed(); }, { max: LIMITS.footer }),
      field('Footer icon URL', function () { return model.footer.icon_url; }, function (v) { model.footer.icon_url = v; changed(); }, { insert: true }),
      h('label', { class: 'ee-chk' }, [(function () { var c = h('input', { type: 'checkbox', onchange: function (e) { model.timestamp = e.target.checked; changed(); } }); c.checked = !!model.timestamp; return c; })(), 'Show timestamp']),
    ]));

    var fieldsBox = h('div', {});
    function renderFields() {
      fieldsBox.innerHTML = '';
      model.fields.forEach(function (f, i) {
        fieldsBox.appendChild(h('div', { class: 'ee-item' }, [
          h('div', { class: 'ee-itemhead' }, [
            h('b', {}, 'Field ' + (i + 1)),
            h('button', { class: 'ee-mini', type: 'button', title: 'Move up', onclick: function () { if (i > 0) { model.fields.splice(i - 1, 0, model.fields.splice(i, 1)[0]); renderFields(); changed(); } } }, '↑'),
            h('button', { class: 'ee-mini', type: 'button', title: 'Move down', onclick: function () { if (i < model.fields.length - 1) { model.fields.splice(i + 1, 0, model.fields.splice(i, 1)[0]); renderFields(); changed(); } } }, '↓'),
            h('button', { class: 'ee-mini', type: 'button', title: 'Duplicate', onclick: function () { model.fields.splice(i + 1, 0, clone(f)); renderFields(); changed(); } }, '⧉'),
            h('button', { class: 'ee-mini danger', type: 'button', title: 'Remove', onclick: function () { model.fields.splice(i, 1); renderFields(); changed(); } }, '✕'),
          ]),
          field('Name', function () { return f.name; }, function (v) { f.name = v; changed(); }, { md: true, max: LIMITS.fieldName }),
          field('Value', function () { return f.value; }, function (v) { f.value = v; changed(); }, { type: 'textarea', rows: 2, md: true, max: LIMITS.fieldValue }),
          h('label', { class: 'ee-chk' }, [(function () { var c = h('input', { type: 'checkbox', onchange: function (e) { f.inline = e.target.checked; changed(); } }); c.checked = !!f.inline; return c; })(), 'Inline']),
        ]));
      });
      if (!model.fields.length) fieldsBox.appendChild(h('div', { class: 'ee-empty' }, 'No fields yet.'));
    }
    renderFields();
    form.appendChild(sec('Fields', [fieldsBox, h('button', { class: 'ee-btn add', type: 'button', onclick: function () { if (model.fields.length < LIMITS.fields) { model.fields.push({ name: '', value: '', inline: false }); renderFields(); changed(); } } }, '+ Add field')]));

    var btnBox = h('div', {});
    function renderBtns() {
      btnBox.innerHTML = '';
      model.buttons.forEach(function (b, i) {
        btnBox.appendChild(h('div', { class: 'ee-item' }, [
          h('div', { class: 'ee-itemhead' }, [
            h('b', {}, 'Button ' + (i + 1)),
            h('button', { class: 'ee-mini', type: 'button', title: 'Move left', onclick: function () { if (i > 0) { model.buttons.splice(i - 1, 0, model.buttons.splice(i, 1)[0]); renderBtns(); changed(); } } }, '←'),
            h('button', { class: 'ee-mini', type: 'button', title: 'Move right', onclick: function () { if (i < model.buttons.length - 1) { model.buttons.splice(i + 1, 0, model.buttons.splice(i, 1)[0]); renderBtns(); changed(); } } }, '→'),
            h('button', { class: 'ee-mini', type: 'button', title: 'Duplicate', onclick: function () { model.buttons.splice(i + 1, 0, clone(b)); renderBtns(); changed(); } }, '⧉'),
            h('button', { class: 'ee-mini danger', type: 'button', title: 'Remove', onclick: function () { model.buttons.splice(i, 1); renderBtns(); changed(); } }, '✕'),
          ]),
          field('Label', function () { return b.label; }, function (v) { b.label = v; changed(); }),
          field('Style', function () { return b.style || '1'; }, function (v) { b.style = v; renderBtns(); changed(); }, { type: 'select', options: STYLES }),
          field(String(b.style) === '5' ? 'URL' : 'Custom id',
            function () { return String(b.style) === '5' ? b.url : b.custom_id; },
            function (v) { if (String(b.style) === '5') b.url = v; else b.custom_id = v; changed(); }),
          field('Emoji', function () { return b.emoji; }, function (v) { b.emoji = v; changed(); }, { insert: true }),
        ]));
      });
      if (!model.buttons.length) btnBox.appendChild(h('div', { class: 'ee-empty' }, 'No buttons yet.'));
    }
    renderBtns();
    form.appendChild(sec('Buttons', [btnBox, h('button', { class: 'ee-btn add', type: 'button', onclick: function () { if (model.buttons.length < 25) { model.buttons.push({ label: 'Button', style: '1', custom_id: '', url: '', emoji: '' }); renderBtns(); changed(); } } }, '+ Add button')]));

    // ── undo / redo ─────────────────────────────────────────────────────────────
    // Snapshots of the model, not of the DOM: setValue already rebuilds the whole editor, so
    // restoring one is just handing it back. Coalesced — one keystroke per undo step would make
    // Ctrl+Z useless in a textarea.
    var undoStack = [], redoStack = [], undoTimer = null, undoBusy = false;
    var UNDO_MAX = 60;
    function pushUndo() {
      if (undoBusy) return;                       // don't record the change an undo itself made
      clearTimeout(undoTimer);
      undoTimer = setTimeout(function () {
        var snap = JSON.stringify(model);
        if (undoStack.length && undoStack[undoStack.length - 1] === snap) return;
        undoStack.push(snap);
        if (undoStack.length > UNDO_MAX) undoStack.shift();
        redoStack.length = 0;                     // a new edit forks the timeline
        syncUndoBtns();
      }, 400);
    }
    function applySnapshot(snap) {
      undoBusy = true;
      try { editor.setValue(JSON.parse(snap)); } finally { undoBusy = false; }
    }
    function doUndo() {
      if (undoStack.length < 2) return;           // the top entry is the current state
      redoStack.push(undoStack.pop());
      applySnapshot(undoStack[undoStack.length - 1]);
    }
    function doRedo() {
      if (!redoStack.length) return;
      var snap = redoStack.pop();
      undoStack.push(snap);
      applySnapshot(snap);
    }
    function syncUndoBtns() {
      if (undoBtn) undoBtn.disabled = undoStack.length < 2;
      if (redoBtn) redoBtn.disabled = !redoStack.length;
    }
    var undoBtn = null, redoBtn = null;

    // ── extra embeds ────────────────────────────────────────────────────────────
    // Discord allows ten embeds in one message. They are kept OUTSIDE the main model shape
    // (`extraEmbeds`), so a plugin that mounts this editor for a single embed is unaffected.
    function renderExtras(box) {
      box.innerHTML = '';
      var list = model.extraEmbeds || (model.extraEmbeds = []);
      list.forEach(function (ex, i) {
        box.appendChild(h('div', { class: 'ee-item' }, [
          h('div', { class: 'ee-itemhead' }, [
            h('b', {}, 'Embed ' + (i + 2)),
            h('button', { class: 'ee-mini', type: 'button', title: 'Move up', onclick: function () { if (i > 0) { list.splice(i - 1, 0, list.splice(i, 1)[0]); renderExtras(box); changed(); } } }, '↑'),
            h('button', { class: 'ee-mini', type: 'button', title: 'Move down', onclick: function () { if (i < list.length - 1) { list.splice(i + 1, 0, list.splice(i, 1)[0]); renderExtras(box); changed(); } } }, '↓'),
            h('button', { class: 'ee-mini danger', type: 'button', title: 'Remove', onclick: function () { list.splice(i, 1); renderExtras(box); changed(); } }, '✕'),
          ]),
          field('Title', function () { return ex.title; }, function (v) { ex.title = v; changed(); }, { md: true, max: LIMITS.title }),
          field('Description', function () { return ex.description; }, function (v) { ex.description = v; changed(); }, { type: 'textarea', rows: 3, md: true, max: LIMITS.description }),
          field('Image URL', function () { return (ex.image || (ex.image = {})).url; }, function (v) { ex.image.url = v; changed(); }, { insert: true }),
          h('label', { class: 'ee-f' }, [h('span', {}, 'Colour'), h('input', { type: 'color', value: ex.color || '#ff6a1a', oninput: function (e) { ex.color = e.target.value; changed(); } })]),
        ]));
      });
      if (!list.length) box.appendChild(h('div', { class: 'ee-empty' }, 'Just the one embed. Discord allows up to 10 in a message.'));
    }

    // ── select menus ────────────────────────────────────────────────────────────
    function renderSelects(box) {
      box.innerHTML = '';
      var list = model.selects || (model.selects = []);
      list.forEach(function (sel, i) {
        var optBox = h('div', {});
        function renderOpts() {
          optBox.innerHTML = '';
          (sel.options || (sel.options = [])).forEach(function (o, oi) {
            optBox.appendChild(h('div', { class: 'ee-optrow' }, [
              field('Label', function () { return o.label; }, function (v) { o.label = v; changed(); }),
              field('Value (id)', function () { return o.value; }, function (v) { o.value = v; changed(); }),
              field('Description', function () { return o.description; }, function (v) { o.description = v; changed(); }),
              h('button', { class: 'ee-mini danger', type: 'button', title: 'Remove option', onclick: function () { sel.options.splice(oi, 1); renderOpts(); changed(); } }, '✕'),
            ]));
          });
          if (!sel.options.length) optBox.appendChild(h('div', { class: 'ee-empty' }, 'A menu needs at least one option, or Discord refuses the message.'));
        }
        renderOpts();
        box.appendChild(h('div', { class: 'ee-item' }, [
          h('div', { class: 'ee-itemhead' }, [
            h('b', {}, 'Menu ' + (i + 1)),
            h('button', { class: 'ee-mini danger', type: 'button', title: 'Remove', onclick: function () { list.splice(i, 1); renderSelects(box); changed(); } }, '✕'),
          ]),
          field('Placeholder', function () { return sel.placeholder; }, function (v) { sel.placeholder = v; changed(); }, { ph: 'Choose…' }),
          field('Custom id', function () { return sel.custom_id; }, function (v) { sel.custom_id = v; changed(); }, { ph: 'another plugin handles this id' }),
          optBox,
          h('button', { class: 'ee-btn add', type: 'button', onclick: function () { if (sel.options.length < 25) { sel.options.push({ label: 'Option', value: '' }); renderOpts(); changed(); } } }, '+ Add option'),
        ]));
      });
      if (!list.length) box.appendChild(h('div', { class: 'ee-empty' }, 'No menus. Each one takes a whole row, and a message allows five rows in total.'));
    }

    var selBox = h('div', {});
    renderSelects(selBox);
    form.appendChild(sec('Select menus', [selBox,
      h('button', { class: 'ee-btn add', type: 'button', onclick: function () {
        if ((model.selects || []).length < 5) { model.selects.push({ placeholder: '', custom_id: '', options: [{ label: 'Option', value: '' }] }); renderSelects(selBox); changed(); }
      } }, '+ Add menu')]));

    var extraBox = h('div', {});
    renderExtras(extraBox);
    form.appendChild(sec('More embeds', [extraBox,
      h('button', { class: 'ee-btn add', type: 'button', onclick: function () {
        if ((model.extraEmbeds || []).length < 9) { model.extraEmbeds.push({ title: '', description: '', color: '#ff6a1a', image: { url: '' } }); renderExtras(extraBox); changed(); }
      } }, '+ Add another embed')]));

    // ── preview ─────────────────────────────────────────────────────────────────
    function renderPreview() {
      pvContent.innerHTML = model.content ? mdToHtml(rs(model.content)) : '';
      pvContent.style.display = model.content ? '' : 'none';
      preview.style.borderLeftColor = model.color || '#ff6a1a';
      var main = h('div', { class: 'ee-main' });
      if (model.author.name) main.appendChild(h('div', { class: 'ee-author' }, [model.author.icon_url ? h('img', { src: model.author.icon_url, onerror: function () { this.style.display = 'none'; } }) : null, rs(model.author.name)]));
      if (model.title) main.appendChild(h('div', { class: 'ee-title' + (model.url ? '' : ' plain'), html: mdToHtml(rs(model.title)) }));
      if (model.description) main.appendChild(h('div', { class: 'ee-desc', html: mdToHtml(rs(model.description)) }));
      if (model.fields.length) {
        var grid = h('div', { class: 'ee-fields' });
        model.fields.forEach(function (f) { grid.appendChild(h('div', { class: 'ee-field' + (f.inline ? '' : ' wide') }, [h('b', { html: mdToHtml(rs(f.name)) || '​' }), h('span', { html: mdToHtml(rs(f.value)) || '​' })])); });
        main.appendChild(grid);
      }
      if (model.image.url) main.appendChild(h('div', { class: 'ee-img' }, h('img', { src: model.image.url, onerror: function () { this.style.display = 'none'; } })));
      if (model.footer.text || model.timestamp) {
        main.appendChild(h('div', { class: 'ee-footer' }, [model.footer.icon_url ? h('img', { src: model.footer.icon_url, onerror: function () { this.style.display = 'none'; } }) : null, rs(model.footer.text || '') + (model.timestamp ? (model.footer.text ? ' • ' : '') + new Date().toLocaleString() : '')]));
      }
      preview.innerHTML = '';
      preview.appendChild(main);
      if (model.thumbnail.url) preview.appendChild(h('div', { class: 'ee-thumb' }, h('img', { src: model.thumbnail.url, onerror: function () { this.style.display = 'none'; } })));
      // Extra embeds render as smaller cards under the first — enough to see their order and
      // colours, which is what goes wrong once there is more than one.
      pvExtra.innerHTML = '';
      (model.extraEmbeds || []).forEach(function (ex) {
        var card = h('div', { class: 'ee-embed ee-embed-x' });
        card.style.borderLeftColor = ex.color || '#ff6a1a';
        var inner = h('div', { class: 'ee-main' });
        if (ex.title) inner.appendChild(h('div', { class: 'ee-title plain', html: mdToHtml(rs(ex.title)) }));
        if (ex.description) inner.appendChild(h('div', { class: 'ee-desc', html: mdToHtml(rs(ex.description)) }));
        if (ex.image && ex.image.url) inner.appendChild(h('div', { class: 'ee-img' }, h('img', { src: ex.image.url, onerror: function () { this.style.display = 'none'; } })));
        card.appendChild(inner);
        pvExtra.appendChild(card);
      });
      pvBtns.innerHTML = '';
      (model.selects || []).forEach(function (sl) {
        pvBtns.appendChild(h('div', { class: 'ee-pv-sel' }, (sl.placeholder || 'Select an option') + '  ▾'));
      });
      model.buttons.forEach(function (b) { pvBtns.appendChild(h('button', { class: 'ee-pv-btn s' + (b.style || '1'), type: 'button' }, (b.emoji ? b.emoji + ' ' : '') + (b.label || 'Button'))); });
    }

    var editorPane = h('div', { class: 'ee-wrap' }, [form, h('div', { class: 'ee-col ee-pv' }, [h('div', { class: 'ee-pvlabel' }, 'Preview'), pvContent, preview, pvExtra, pvBtns])]);

    var editor = {
      getValue: function () { return clone(model); },
      setValue: function (v) { model = Object.assign(defaultModel(), clone(v || {})); container.innerHTML = ''; buildEditor(container, Object.assign({}, opts, { value: model })); },
      destroy: function () { container.innerHTML = ''; },
    };

    // Embedded in another plugin: just the editor. Its host owns saving and its own layout.
    if (!opts.standalone) {
      container.appendChild(editorPane);
      renderPreview(); renderLimits();
      return editor;
    }

    // ── standalone: three pages ─────────────────────────────────────────────────
    var chanSel = h('select', {}, [h('option', { value: '' }, 'Loading channels…')]);
    api('/channels').then(function (list) {
      chanSel.innerHTML = '';
      chanSel.appendChild(h('option', { value: '' }, list && list.length ? '— pick a channel —' : 'No channels (bot offline?)'));
      (list || []).forEach(function (c) { chanSel.appendChild(h('option', { value: c.id }, '#' + c.name)); });
    });

    var sendStatus = h('span', { class: 'ee-empty' });
    var editing = null;
    var sendBtn = h('button', { class: 'ee-btn primary', type: 'button' }, 'Send to channel');
    var newBtn = h('button', { class: 'ee-btn', type: 'button', style: 'display:none' }, 'New message');
    var editNote = h('div', { class: 'ee-empty' });
    function setEditing(entry) {
      editing = entry;
      sendBtn.textContent = entry ? 'Update message' : 'Send to channel';
      newBtn.style.display = entry ? '' : 'none';
      editNote.textContent = entry ? ('Editing the message posted ' + new Date(entry.sentAt).toLocaleString() + (entry.channelName ? ' in #' + entry.channelName : '')) : '';
      if (entry && entry.channelId) chanSel.value = entry.channelId;
    }
    newBtn.addEventListener('click', function () { setEditing(null); });
    sendBtn.addEventListener('click', function () {
      var probs = limitProblems();
      if (probs.length) { sendStatus.textContent = 'Too long: ' + probs[0]; return; }   // Discord would reject it anyway
      if (!chanSel.value && !editing) { sendStatus.textContent = 'Pick a channel first.'; return; }
      // Mentions in the message TEXT really do ping everyone — unlike the same text inside the
      // embed, which never does. One confirm is cheap next to notifying a whole server by accident.
      var ping = /(^|\s)@(everyone|here)\b/.exec(model.content || '');
      if (ping && !confirm('This will ping @' + ping[2] + ' — everyone in the channel gets a notification. Send it?')) {
        sendStatus.textContent = 'Cancelled.';
        return;
      }
      var body = {
        channelId: editing ? editing.channelId : chanSel.value,
        channelName: (chanSel.options[chanSel.selectedIndex] || {}).text || '',
        embed: clone(model), buttons: model.buttons, selects: model.selects || [],
        extraEmbeds: model.extraEmbeds || [], content: model.content || '',
      };
      if (editing) body.messageId = editing.messageId;
      sendStatus.textContent = editing ? 'Updating…' : 'Sending…';
      api(editing ? '/edit' : '/send', { method: 'POST', body: body }).then(function (r) {
        sendStatus.textContent = (r && r.ok) ? (editing ? 'Updated ✓' : 'Sent ✓') : ('Failed' + (r && r.error ? ': ' + r.error : ''));
      });
    });
    // Adopt a message this editor never sent — paste its link (or its id). Right-click a message
    // in Discord → Copy Message Link. Without this, anything posted before this plugin existed, or
    // by another feature, could never be corrected here.
    var loadInp = h('input', { type: 'text', placeholder: 'https://discord.com/channels/…  or a message id', class: 'ee-loadinp' });
    var loadStatus = h('span', { class: 'ee-empty' });
    var loadBtn = h('button', { class: 'ee-btn', type: 'button' }, 'Load message');
    loadBtn.addEventListener('click', function () {
      var v = loadInp.value.trim();
      if (!v) { loadStatus.textContent = 'Paste a message link or id.'; return; }
      // A link carries the channel; a bare id needs the channel picked above.
      var m = /channels\/\d+\/(\d+)\/(\d+)/.exec(v);
      var chId = m ? m[1] : chanSel.value;
      var msgId = m ? m[2] : (/^\d+$/.test(v) ? v : '');
      if (!chId || !msgId) { loadStatus.textContent = m ? 'Could not read that link.' : 'Pick the channel first, or paste the full link.'; return; }
      loadStatus.textContent = 'Loading…';
      api('/fetch', { method: 'POST', body: { channelId: chId, messageId: msgId } }).then(function (r) {
        if (!r || !r.ok) { loadStatus.textContent = (r && r.error) || 'Could not load it.'; return; }
        loadStatus.textContent = 'Loaded — editing it now.';
        setEditing({ messageId: r.messageId, channelId: r.channelId, channelName: '', sentAt: r.sentAt, title: r.embed.title || '' });
        var v2 = r.embed; v2.content = r.content || '';
        editor.setValue(v2);
      });
    });

    undoBtn = h('button', { class: 'ee-btn', type: 'button', title: 'Undo (Ctrl+Z)', onclick: doUndo }, '↶ Undo');
    redoBtn = h('button', { class: 'ee-btn', type: 'button', title: 'Redo (Ctrl+Shift+Z)', onclick: doRedo }, '↷ Redo');
    syncUndoBtns();
    // Ctrl+Z inside a textarea is the browser's own undo, which only knows about that one box —
    // ours restores the whole embed, so it takes over.
    container.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      var k = String(e.key || '').toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); doRedo(); }
    });

    // Scheduling. Kept next to Send because it is the same decision — now, or later.
    var whenInp = h('input', { type: 'datetime-local', class: 'ee-loadinp' });
    var schedStatus = h('span', { class: 'ee-empty' });
    var schedBtn = h('button', { class: 'ee-btn', type: 'button' }, 'Schedule');
    schedBtn.addEventListener('click', function () {
      var probs = limitProblems();
      if (probs.length) { schedStatus.textContent = 'Too long: ' + probs[0]; return; }
      if (!chanSel.value) { schedStatus.textContent = 'Pick a channel first.'; return; }
      if (!whenInp.value) { schedStatus.textContent = 'Pick a date and time.'; return; }
      var at = new Date(whenInp.value).getTime();
      if (!at || isNaN(at)) { schedStatus.textContent = 'That time is not valid.'; return; }
      schedStatus.textContent = 'Scheduling…';
      api('/scheduled', { method: 'POST', body: {
        channelId: chanSel.value, channelName: (chanSel.options[chanSel.selectedIndex] || {}).text || '',
        at: at, embed: clone(model), extraEmbeds: model.extraEmbeds || [],
        buttons: model.buttons, selects: model.selects || [], content: model.content || '',
      } }).then(function (r) {
        schedStatus.textContent = (r && r.ok) ? 'Scheduled ✓' : ('Failed' + (r && r.error ? ': ' + r.error : ''));
        if (r && r.ok) loadScheduled();
      });
    });

    form.appendChild(sec('Send', [
      h('label', { class: 'ee-f' }, [h('span', {}, 'Channel'), chanSel]),
      h('div', { class: 'ee-actions' }, [sendBtn, newBtn, sendStatus]),
      editNote,
      h('div', { class: 'ee-loadrow' }, [whenInp, schedBtn, schedStatus]),
      h('div', { class: 'ee-loadrow' }, [loadInp, loadBtn, loadStatus]),
      h('div', { class: 'ee-actions' }, [undoBtn, redoBtn]),
    ], true));

    // Templates — its own page.
    var tplPane = h('div', { class: 'ee-page' });
    function loadTpls() {
      api('/templates').then(function (t) {
        t = t || {};
        tplPane.innerHTML = '';
        var names = Object.keys(t);
        tplPane.appendChild(h('div', { class: 'ee-actions' }, [
          h('button', { class: 'ee-btn primary', type: 'button', onclick: function () { var n = prompt('Save the current embed as:'); if (n) api('/templates', { method: 'POST', body: { name: n, data: clone(model) } }).then(loadTpls); } }, 'Save current embed'),
          h('span', { class: 'ee-empty' }, names.length + ' saved'),
        ]));
        if (!names.length) { tplPane.appendChild(h('div', { class: 'ee-empty' }, 'No templates yet. Build an embed on the Editor tab, then save it here.')); return; }
        var list = h('div', {});
        names.forEach(function (n) {
          list.appendChild(h('div', { class: 'ee-hrow' }, [
            h('div', { class: 'ee-hmain' }, [h('b', {}, n), h('span', { class: 'ee-hmeta' }, (t[n] && t[n].title) || '(no title)')]),
            h('button', { class: 'ee-btn', type: 'button', onclick: function () { editor.setValue(t[n]); } }, 'Load'),
            h('button', { class: 'ee-btn danger', type: 'button', onclick: function () { if (confirm('Delete "' + n + '"?')) api('/templates/delete', { method: 'POST', body: { name: n } }).then(loadTpls); } }, '✕'),
          ]));
        });
        tplPane.appendChild(list);
        tplPane.appendChild(h('details', { class: 'ee-sec' }, [h('summary', {}, 'JSON (import / export)'), h('div', { class: 'ee-body' }, (function () {
          var ta = h('textarea', { rows: 8, style: 'width:100%' });
          return [ta, h('div', { class: 'ee-actions' }, [
            h('button', { class: 'ee-btn', type: 'button', onclick: function () { ta.value = JSON.stringify(clone(model), null, 2); } }, 'Export current'),
            h('button', { class: 'ee-btn', type: 'button', onclick: function () { try { editor.setValue(JSON.parse(ta.value)); } catch (e) { alert('Invalid JSON'); } } }, 'Import'),
          ])];
        })())]));
      });
    }

    // Sent messages — its own page.
    var histPane = h('div', { class: 'ee-page' });
    var schedBox = h('div', {});
    function loadScheduled() {
      api('/scheduled').then(function (list) {
        schedBox.innerHTML = '';
        if (!list || !list.length) return;   // nothing booked — don't take up room saying so
        schedBox.appendChild(h('div', { class: 'ee-pvlabel' }, 'Waiting to be sent'));
        list.forEach(function (it) {
          schedBox.appendChild(h('div', { class: 'ee-hrow' }, [
            h('div', { class: 'ee-hmain' }, [
              h('b', {}, it.title || '(no title)'),
              h('span', { class: 'ee-hmeta' }, (it.channelName ? '#' + it.channelName + ' · ' : '') + new Date(it.at).toLocaleString()),
            ]),
            h('button', { class: 'ee-btn', type: 'button', title: 'Load a copy into the editor',
              onclick: function () { setEditing(null); editor.setValue(it.data.embed || {}); } }, 'Copy'),
            h('button', { class: 'ee-btn danger', type: 'button', title: 'Cancel it',
              onclick: function () { api('/scheduled/delete', { method: 'POST', body: { id: it.id } }).then(loadScheduled); } }, '✕'),
          ]));
        });
      });
    }
    var histBox = h('div', {});
    function loadHistory() {
      api('/history').then(function (list) {
        histBox.innerHTML = '';
        if (!list || !list.length) { histPane.appendChild(h('div', { class: 'ee-empty' }, 'Nothing sent yet.')); return; }
        histBox.appendChild(h('div', { class: 'ee-actions' }, [
          h('span', { class: 'ee-empty' }, list.length + ' message(s)'),
          h('button', { class: 'ee-btn', type: 'button', onclick: function () { if (confirm('Clear the list? Messages in Discord are not touched.')) api('/history/clear', { method: 'POST', body: {} }).then(loadHistory); } }, 'Clear list'),
        ]));
        var box = h('div', {});
        list.forEach(function (entry) {
          var when = new Date(entry.editedAt || entry.sentAt).toLocaleString();
          box.appendChild(h('div', { class: 'ee-hrow' }, [
            h('div', { class: 'ee-hmain' }, [
              h('b', {}, entry.title || '(no title)'),
              h('span', { class: 'ee-hmeta' }, (entry.channelName ? '#' + entry.channelName + ' · ' : '') + when + (entry.editedAt ? ' · edited' : '')),
            ]),
            h('button', { class: 'ee-btn', type: 'button', title: 'Load it and update the original in place',
              onclick: function () { setEditing(entry); editor.setValue(entry.data.embed || {}); } }, 'Edit'),
            h('button', { class: 'ee-btn', type: 'button', title: 'Load a copy, leaving the original alone',
              onclick: function () { setEditing(null); editor.setValue(entry.data.embed || {}); } }, 'Copy'),
            h('button', { class: 'ee-btn danger', type: 'button', title: 'Delete it in Discord',
              onclick: function () {
                if (!confirm('Delete that message in Discord?')) return;
                api('/delete', { method: 'POST', body: { channelId: entry.channelId, messageId: entry.messageId } })
                  .then(function () { if (editing && editing.messageId === entry.messageId) setEditing(null); loadHistory(); });
              } }, '✕'),
          ]));
        });
        histBox.appendChild(box);
      });
    }

    var PAGES = [['edit', 'Editor', editorPane], ['tpl', 'Templates', tplPane], ['hist', 'Sent messages', histPane]];
    var nav = h('div', { class: 'ee-tabs' });
    function go(id) {
      closePop();
      PAGES.forEach(function (p) { p[2].style.display = p[0] === id ? '' : 'none'; });
      nav.querySelectorAll('.ee-tab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-p') === id); });
      if (id === 'tpl') loadTpls();
      if (id === 'hist') { loadScheduled(); loadHistory(); }
    }
    PAGES.forEach(function (p) {
      nav.appendChild(h('button', { class: 'ee-tab', 'data-p': p[0], type: 'button', onclick: function () { go(p[0]); } }, p[1]));
    });
    container.appendChild(nav);
    histPane.appendChild(schedBox);
    histPane.appendChild(histBox);
    PAGES.forEach(function (p) { container.appendChild(p[2]); });
    go('edit');

    // Start a NEW embed looking like the rest of the bot. Only fills an EMPTY footer — an embed the
    // admin has already worded is never re-branded behind their back, and anything loaded from
    // history or a template keeps exactly what it had.
    api('/branding').then(function (b) {
      if (!b || !b.text || model.footer.text || model.footer.icon_url) return;
      model.footer.text = b.text;
      model.footer.icon_url = b.icon_url || '';
      editor.setValue(clone(model));
    });

    renderPreview(); renderLimits();
    return editor;
  }

  // reusable component for OTHER plugins
  SSA.provide('embed-editor', { mount: buildEditor, defaultModel: defaultModel });

  // standalone editor tab
  SSA.ready(function () {
    SSA.registerTab({
      id: 'embed-editor', label: 'Embeds', icon: '📝', premium: true,
      render: function (el) {
        el.innerHTML = eeHead('Write &amp; send', 'Write a message, preview it exactly as Discord renders it, then send it — or fix one you already posted.');
        var host = h('div', { style: 'padding:0 16px 16px' });
        el.appendChild(host);
        buildEditor(host, { standalone: true });
      },
    });
  });
}());

/* ── styler half — built-in embed restyling + custom live embeds ───────────────────
   Its own IIFE, so nothing here shares a name with the editor above. It must come SECOND:
   it mounts the editor through SSA.consume('embed-editor'), which the editor registers on
   load. */
/* Styler half — admin UI. Pick any built-in manager embed, toggle customization on,
   and design the style overrides with the editor above (same plugin). Saves all
   kinds at once; changes apply to the next embed the manager sends. */
(function () {
  var API = '/api/plugin-host/discord-embeds';
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
    el.innerHTML = eeHead('Built-in embeds', '') + '<div class="es-head"><p class="muted" style="font-size:.86rem;margin:0">Edit the manager\'s own embeds. Pick one to load its default fields as an editable template — change the colour/title, then turn on <b>Replace fields</b> to add, remove or reorder fields. Click a field box and insert a data <code>{token}</code> for live values (e.g. add a Squad field = <code>{squad}</code>).</p></div><div id="es-body" class="muted">Loading…</div>';
    var body = el.querySelector('#es-body');
    var edSvc = SSA.consume('embed-editor');

    api('/config').then(function (cfg) {
      if (!edSvc) { body.innerHTML = '<div class="es-warn">The embed editor did not load — reload the page, and if it persists check the manager log.</div>'; return; }
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
      // Groups come from the manager, not a list here — it now sends notifications, player DM
      // alerts and intel cards as well, and a hardcoded pair would silently hide them.
      var GROUP_ORDER = ['feeds', 'live', 'notifications', 'dm', 'intel'];
      var groupLabels = {};
      kinds.forEach(function (k) { if (!groupLabels[k.group]) groupLabels[k.group] = k.groupLabel || k.group; });
      var groupKeys = Object.keys(groupLabels).sort(function (a, b) {
        var ia = GROUP_ORDER.indexOf(a), ib = GROUP_ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });

      // With every manager embed editable the list runs to dozens, so it needs filtering to stay
      // usable. A native <select> keeps keyboard behaviour and cannot clash with a popover.
      var search = h('input', { class: 'es-search', type: 'search', placeholder: 'Search embeds…' });
      function fillSelect(q) {
        var needle = (q || '').trim().toLowerCase();
        var keep = sel.value;
        sel.innerHTML = '';
        var shown = 0;
        groupKeys.forEach(function (g) {
          var list = kinds.filter(function (k) {
            if (k.group !== g) return false;
            if (!needle) return true;
            return (k.label || '').toLowerCase().indexOf(needle) >= 0 || (k.key || '').toLowerCase().indexOf(needle) >= 0;
          });
          if (!list.length) return;
          var og = h('optgroup', { label: groupLabels[g] + ' (' + list.length + ')' });
          list.forEach(function (k) {
            // A kind the manager has not sent yet has no captured shape — say so rather than
            // letting an empty editor look like a bug.
            og.appendChild(h('option', { value: k.key }, k.label + (k.live ? '' : ' — not seen yet')));
            shown++;
          });
          sel.appendChild(og);
        });
        if (!shown) sel.appendChild(h('option', { value: '' }, 'No embed matches “' + (q || '') + '”'));
        if (keep && sel.querySelector('option[value="' + keep.replace(/"/g, '\\"') + '"]')) sel.value = keep;
        return shown;
      }
      fillSelect('');
      search.addEventListener('input', function () {
        if (fillSelect(search.value) && sel.value) showKind(sel.value);
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
        // Be explicit about where this layout came from. "Not seen yet" is the honest answer for an
        // embed the manager has not sent since it started, and explains an empty field list.
        var origin = !kd ? ''
          : kd.live ? ' This is the layout the manager last actually sent, with its real values.'
            : (kd.sample ? ' Built from the manager’s own builder — it will switch to the real one once this embed fires.'
              : ' The manager hasn’t sent this embed since it started, so there is no captured layout yet. You can still write one.');
        noteEl.textContent = (kd && kd.styleOnly ? NOTE_STYLE : NOTE_NORMAL) + (hasPlayer ? ' ' + NOTE_PLAYER : '') + origin;
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
          h('label', { class: 'es-f es-f-grow' }, [h('span', {}, 'Embed'), sel]),
          h('label', { class: 'es-f' }, [h('span', {}, 'Find'), search]),
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
    el.innerHTML = eeHead('Custom live embeds', '') + '<div class="es-head"><p class="muted" style="font-size:.86rem;margin:0">Create your own embeds that the bot keeps updated in a channel — like the built-in Server Status, but yours. Pick a channel + refresh interval and design it with {tokens} for live data.</p></div><div id="ce-body" class="muted">Loading…</div>';
    var body = el.querySelector('#ce-body');
    var edSvc = SSA.consume('embed-editor');
    var channels = [];
    Promise.all([
      api('/custom').then(function (c) { return c || {}; }),
      fetch('/api/plugin-host/embed-editor/channels', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).catch(function () { return []; }),
    ]).then(function (res) {
      if (!edSvc) { body.innerHTML = '<div class="es-warn">The embed editor did not load — reload the page, and if it persists check the manager log.</div>'; return; }
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
