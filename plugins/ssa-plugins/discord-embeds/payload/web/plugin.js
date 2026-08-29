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
    return fetch(EE_API + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        // The STATUS matters. Collapsing every response to its body turned a 401 after the session
        // expired into an empty object, which the styler tab then reported as "the backend isn't
        // loaded yet — restart the manager". That is advice to take a live server down over a cookie.
        if (!r.ok) return { _httpError: r.status, error: (body && body.error) || ('HTTP ' + r.status) };
        return body;
      });
    });
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
      // Tappable, not hover-only. A touch screen has no hover, so a spoiler in the preview could
      // never be read on a phone at all — the preview claimed to show what Discord shows and then
      // permanently hid part of it. The reveal class is toggled by the delegated handler below.
    t = t.replace(/\|\|([\s\S]+?)\|\|/g, '<span class="ee-spoiler" role="button" tabindex="0">$1</span>');
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
  // Discord's own limits. `total` is per MESSAGE — every embed in it added together — and `rows`
  // is the five component rows a message gets, where a select menu costs a whole row and
  // buttons pack five to a row.
  var LIMITS = { title: 256, description: 4096, fieldName: 256, fieldValue: 1024, footer: 2048, author: 256,
    content: 2000, total: 6000, fields: 25, embeds: 10, rows: 5, buttonLabel: 80,
    selectPlaceholder: 150, optionLabel: 100, optionDescription: 100, options: 25 };

  // What the bot stamps on EVERY embed it sends. Module state, not per-editor: the Built-in Embeds
  // tab rebuilds its editor on every kind you click, and a per-instance copy meant one HTTP request
  // per click and a preview that was briefly wrong each time.
  var brandFooter = { text: '', icon_url: '' };
  var brandingReq = null;
  function withBranding(then) {
    if (brandFooter.text) { then(); return; }
    if (!brandingReq) brandingReq = api('/branding');
    brandingReq.then(function (b) {
      if (b && b.text) brandFooter = { text: b.text, icon_url: b.icon_url || '' };
      then();
    });
  }

  function buildEditor(container, opts) {
    opts = opts || {};
    var model = opts.value ? Object.assign(defaultModel(), clone(opts.value)) : defaultModel();
    container.innerHTML = '';
    container.classList.add('ee-root');
    // Delegated once on the root: the preview is rebuilt on every keystroke, so a listener
    // attached to a spoiler span would be thrown away with it.
    container.addEventListener('click', function (ev) {
      var sp = ev.target && ev.target.closest && ev.target.closest('.ee-spoiler');
      if (sp) sp.classList.toggle('revealed');
    });

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
        // `[\w.]` and not `\w`: dotted tokens like {location.x} are offered by the picker, so the
        // preview has to recognise them too — otherwise the box says "{location.x}" and the message
        // says "148230", and the preview is lying about the one thing it exists to show.
        .replace(/\{([\w.]+)\}/g, function (mm, k) { return (k in sampleMap) ? sampleMap[k] : mm; });
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
    // Per-player figures that are read out of the game database — i.e. the last SAVE, not the running
    // game. They are the ones most likely to be wrong at the exact moment an embed is sent, because
    // an embed about a player is usually sent while that player is online and doing something.
    //
    // Marked rather than replaced, and that is not laziness: every one of these is resolved inside a
    // SYNCHRONOUS embed transform (the manager hands a plugin an embed and takes one straight back),
    // and every live read is asynchronous. There is no live value to put here without polling the
    // game on a timer, which costs more than the staleness it fixes for text on a screen. What an
    // owner needs instead is to know which numbers they are writing into their message.
    var SAVED_TOKENS = ['money', 'fame', 'gold', 'cash', 'bank', 'accountNumber',
      'squad', 'squadSize', 'playerKills', 'playerDeaths'];
    function isSaved(t) {
      var k = String(t || '');
      return SAVED_TOKENS.indexOf(k) >= 0 || k.indexOf('stat_') === 0;
    }

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
          var saved = isSaved(tk.t);
          var note = saved ? ' — the last game save' : '';
          return h('button', { class: 'ee-tok' + (tk.live ? ' live' : ''), type: 'button',
            // The value can be a whole rendered list, so the chip shows a clipped version and the
            // tooltip carries the token plus what it currently resolves to.
            title: '{' + tk.t + '}' + (full ? '\n' + full : '')
              + (saved ? '\n\nThis figure comes from the game database, which is the state as of the last SAVE. For a player who is online it can be minutes behind what the game itself holds — they can spend money, gain fame or change squad and this will still show the old number until the server saves.' : ''),
            onclick: function () { insertInto(input, '{' + tk.t + '}'); } },
          [h('b', {}, tk.label || tk.t),
            (full || note) ? h('span', {}, (full.length > 40 ? full.slice(0, 40) + '…' : full) + note) : null]);
        }, { perPage: 60, empty: tokensReady ? 'Nothing matches.' : 'Loading live data…' }));
      }
      search.addEventListener('input', draw);
      draw();
      loadTokens().then(draw);   // opening the picker is a good moment to be current
      return h('div', { class: 'ee-tokpanel' }, [
        h('div', { class: 'ee-tokhint' }, 'Values shown are this server as the manager reads it now. Greyed ones only exist while the event they belong to fires, and ones marked “the last game save” are a player’s saved figures — they can lag the running game.'),
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
      // Discord counts the 6000 across EVERY embed in the message, not per embed. Counting only the
      // first one meant a message with extra embeds passed here and was refused by Discord, with
      // nothing on screen having warned about it.
      function embedChars(e) {
        if (!e) return 0;
        return len(e.title) + len(e.description) + len((e.footer || {}).text) + len((e.author || {}).name)
          + (Array.isArray(e.fields) ? e.fields.reduce(function (a, f) { return a + len(f.name) + len(f.value); }, 0) : 0);
      }
      var total = embedChars(model) + (model.extraEmbeds || []).reduce(function (a, e) { return a + embedChars(e); }, 0);
      if (total > LIMITS.total) {
        out.push('All embeds total ' + total + '/' + LIMITS.total + ' characters');
      }
      if (1 + (model.extraEmbeds || []).length > LIMITS.embeds) {
        out.push((1 + model.extraEmbeds.length) + ' embeds (max ' + LIMITS.embeds + ' per message)');
      }

      // Components. The backend silently drops whatever will not fit, which is the right thing for a
      // send that must not fail — but the editor is where it can still be fixed, so it says so.
      var btns = model.buttons || [];
      var sels = model.selects || [];
      var rows = sels.length + Math.ceil(btns.length / 5);
      if (rows > LIMITS.rows) {
        out.push(rows + ' component rows (max ' + LIMITS.rows + ') — a select takes a whole row, buttons go five to a row');
      }
      btns.forEach(function (b, i) {
        if (len(b.label) > LIMITS.buttonLabel) out.push('Button ' + (i + 1) + ' label is ' + len(b.label) + '/' + LIMITS.buttonLabel);
      });
      sels.forEach(function (sl, i) {
        if (len(sl.placeholder) > LIMITS.selectPlaceholder) out.push('Select ' + (i + 1) + ' placeholder is ' + len(sl.placeholder) + '/' + LIMITS.selectPlaceholder);
        var opts = sl.options || [];
        if (opts.length > LIMITS.options) out.push('Select ' + (i + 1) + ' has ' + opts.length + ' options (max ' + LIMITS.options + ')');
        if (!opts.length) out.push('Select ' + (i + 1) + ' has no options — Discord refuses an empty menu');
        opts.forEach(function (o, j) {
          if (len(o.label) > LIMITS.optionLabel) out.push('Select ' + (i + 1) + ' option ' + (j + 1) + ' label is ' + len(o.label) + '/' + LIMITS.optionLabel);
          if (len(o.description) > LIMITS.optionDescription) out.push('Select ' + (i + 1) + ' option ' + (j + 1) + ' description is ' + len(o.description) + '/' + LIMITS.optionDescription);
        });
      });
      return out;
    }
    /**
     * What the limits look like once the TOKENS ARE FILLED IN.
     *
     * Everything above measures the template as typed, where `{onlineList}` is thirteen characters.
     * On a full server it is around two thousand, so an embed that is comfortably legal while you
     * write it is over the limit the moment it goes out — the one thing about these fields that
     * cannot be seen by looking at them.
     *
     * These are NOTICES, not problems: they never block a save. The backend trims rather than fails,
     * so the embed still posts; this is what tells you it is going to be cut, while you can still
     * decide to shorten it yourself. The numbers come from the same live samples the preview draws
     * with, so they are this server's real values, not invented ones.
     */
    function limitNotices() {
      var out = [];
      var grew = function (raw) { var a = String(raw || ''); var b = rs(a); return b.length !== a.length ? b.length : 0; };
      var check = function (raw, cap, what) {
        var n = grew(raw);
        if (n > cap) out.push(what + ' fits now, but with live data it is ' + n + '/' + cap + ' — it will be trimmed when sent.');
      };
      check(model.title, LIMITS.title, 'Title');
      check(model.description, LIMITS.description, 'Description');
      check(model.content, LIMITS.content, 'Message text');
      (model.fields || []).forEach(function (f, i) {
        check(f.name, LIMITS.fieldName, 'Field ' + (i + 1) + ' name');
        check(f.value, LIMITS.fieldValue, 'Field ' + (i + 1) + ' value');
      });
      (model.buttons || []).forEach(function (b, i) { check(b.label, LIMITS.buttonLabel, 'Button ' + (i + 1) + ' label'); });
      // And the 6000 across the whole message, which is the one that bites without any single field
      // looking wrong.
      var chars = function (e) {
        if (!e) return 0;
        var l = function (x) { return rs(String(x || '')).length; };
        return l(e.title) + l(e.description) + l((e.footer || {}).text) + l((e.author || {}).name)
          + (Array.isArray(e.fields) ? e.fields.reduce(function (a, f) { return a + l(f.name) + l(f.value); }, 0) : 0);
      };
      var total = chars(model) + (model.extraEmbeds || []).reduce(function (a, e) { return a + chars(e); }, 0);
      if (total > LIMITS.total) out.push('With live data all embeds total ' + total + '/' + LIMITS.total + ' characters — the message will be trimmed when sent.');
      return out;
    }

    var limitBox = h('div', { class: 'ee-limits' });
    function renderLimits() {
      var probs = limitProblems();
      var notes = [];
      // A notice is worked out from live sample values, so it must never take the editor down with
      // it if one of them is missing.
      try { notes = limitNotices(); } catch (e) { notes = []; }
      limitBox.innerHTML = '';
      limitBox.className = 'ee-limits' + (probs.length ? ' bad' : (notes.length ? ' warn' : ''));
      probs.forEach(function (p) { limitBox.appendChild(h('div', {}, '⚠ ' + p)); });
      notes.forEach(function (p) { limitBox.appendChild(h('div', { class: 'ee-lim-note' }, '✂ ' + p)); });
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
      field('Title URL', function () { return model.url; }, function (v) { model.url = v; changed(); }, { insert: true, ph: 'https://…' }),
      field('Description', function () { return model.description; }, function (v) { model.description = v; changed(); }, { type: 'textarea', md: true, max: LIMITS.description, ph: 'Supports **markdown**' }),
      h('label', { class: 'ee-f' }, [h('span', {}, 'Colour'), h('input', { type: 'color', value: model.color, oninput: function (e) { model.color = e.target.value; changed(); } })]),
    ], true));
    form.appendChild(sec('Author', [
      field('Name', function () { return model.author.name; }, function (v) { model.author.name = v; changed(); }, { insert: true, max: LIMITS.author }),
      field('URL', function () { return model.author.url; }, function (v) { model.author.url = v; changed(); }, { insert: true }),
      field('Icon URL', function () { return model.author.icon_url; }, function (v) { model.author.icon_url = v; changed(); }, { insert: true }),
    ]));
    form.appendChild(sec('Images', [
      field('Thumbnail URL', function () { return model.thumbnail.url; }, function (v) { model.thumbnail.url = v; changed(); }, { insert: true }),
      field('Image URL', function () { return model.image.url; }, function (v) { model.image.url = v; changed(); }, { insert: true }),
    ]));
    // The footer is not editable, on ANY embed, and saying so is the whole point of this section.
    //
    // The manager stamps its branded footer and a timestamp on every embed as it goes out — its own
    // and every one a plugin sends. A footer typed here was overwritten a moment later: the field
    // looked like it worked, the preview even showed it, and Discord never did. It used to be worse
    // than that — the same field DID survive on embeds this plugin sent, so whether it worked
    // depended on which screen you were on, with nothing telling you which. Branding applies
    // everywhere now, and the field is gone everywhere with it.
    //
    // The preview still draws the footer, because that IS what Discord will show.
    form.appendChild(sec('Footer', [
      h('p', { class: 'ee-note' },
        'The footer and the timestamp come from your bot’s branding and are applied to every '
        + 'embed as it is sent, so they cannot be set per embed — that is what keeps every '
        + 'message the bot posts looking like the same bot. Change them by changing the branding '
        + '(name and icon, with Premium). The preview below shows what Discord will show.'),
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
          field('Label', function () { return b.label; }, function (v) { b.label = v; changed(); }, { insert: true, max: LIMITS.buttonLabel }),
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
              field('Label', function () { return o.label; }, function (v) { o.label = v; changed(); }, { insert: true, max: LIMITS.optionLabel }),
              field('Value (id)', function () { return o.value; }, function (v) { o.value = v; changed(); }),
              field('Description', function () { return o.description; }, function (v) { o.description = v; changed(); }, { insert: true, max: LIMITS.optionDescription }),
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
          field('Placeholder', function () { return sel.placeholder; }, function (v) { sel.placeholder = v; changed(); }, { insert: true, max: LIMITS.selectPlaceholder, ph: 'Choose…' }),
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
    // Discord groups CONSECUTIVE inline fields into rows of up to three, and a row shares its width
    // between however many it holds — two inline fields are two half-width columns, not two thirds
    // of a row with a gap where the third would be. A non-inline field breaks the run and takes a
    // row to itself.
    //
    // One function, because the main embed and the extra embeds must lay out identically: two copies
    // of this rule would disagree the first time one of them was corrected.
    function fieldGrid(fields) {
      var grid = h('div', { class: 'ee-fields' });
      var rows = [];
      var run = null;
      (fields || []).forEach(function (f) {
        if (!f.inline) { rows.push([f]); run = null; return; }
        if (!run || run.length >= 3) { run = []; rows.push(run); }
        run.push(f);
      });
      rows.forEach(function (r) {
        var rowEl = h('div', { class: 'ee-frow' });
        rowEl.style.gridTemplateColumns = 'repeat(' + r.length + ', 1fr)';
        r.forEach(function (f) {
          rowEl.appendChild(h('div', { class: 'ee-field' }, [
            h('b', { html: mdToHtml(rs(f.name)) || '​' }),
            h('span', { html: mdToHtml(rs(f.value)) || '​' }),
          ]));
        });
        grid.appendChild(rowEl);
      });
      return grid;
    }

    function renderPreview() {
      pvContent.innerHTML = model.content ? mdToHtml(rs(model.content)) : '';
      pvContent.style.display = model.content ? '' : 'none';
      preview.style.borderLeftColor = model.color || '#ff6a1a';
      var main = h('div', { class: 'ee-main' });
      if (model.author.name) main.appendChild(h('div', { class: 'ee-author' }, [model.author.icon_url ? h('img', { src: model.author.icon_url, onerror: function () { this.style.display = 'none'; } }) : null, rs(model.author.name)]));
      if (model.title) main.appendChild(h('div', { class: 'ee-title' + (model.url ? '' : ' plain'), html: mdToHtml(rs(model.title)) }));
      if (model.description) main.appendChild(h('div', { class: 'ee-desc', html: mdToHtml(rs(model.description)) }));
      if (model.fields.length) main.appendChild(fieldGrid(model.fields));
      if (model.image.url) main.appendChild(h('div', { class: 'ee-img' }, h('img', { src: model.image.url, onerror: function () { this.style.display = 'none'; } })));
      // Discord stamps the branded footer and a timestamp on EVERY embed as it goes out, so the
      // preview shows them unconditionally. It used to draw them only when the model happened to
      // carry a footer, which is why the same built-in embed showed one here and not there — the
      // preview was describing the model instead of describing the message.
      var pvFoot = (model.footer.text || brandFooter.text || '');
      var pvIcon = (model.footer.icon_url || brandFooter.icon_url || '');
      main.appendChild(h('div', { class: 'ee-footer' }, [
        pvIcon ? h('img', { src: pvIcon, onerror: function () { this.style.display = 'none'; } }) : null,
        rs(pvFoot) + (pvFoot ? ' • ' : '') + new Date().toLocaleString(),
      ]));
      preview.innerHTML = '';
      preview.appendChild(main);
      if (model.thumbnail.url) preview.appendChild(h('div', { class: 'ee-thumb' }, h('img', { src: model.thumbnail.url, onerror: function () { this.style.display = 'none'; } })));
      // Extra embeds render as smaller cards under the first — enough to see their order and
      // colours, which is what goes wrong once there is more than one.
      pvExtra.innerHTML = '';
      // An extra embed can carry MORE than the four things its editor offers: adopting an existing
      // multi-embed message with /fetch brings its author and fields along, and they are sent. The
      // preview draws them for the same reason it draws the footer — it is supposed to show the
      // message, not the subset of the message this editor happens to have inputs for.
      (model.extraEmbeds || []).forEach(function (ex) {
        var card = h('div', { class: 'ee-embed ee-embed-x' });
        card.style.borderLeftColor = ex.color || '#ff6a1a';
        var inner = h('div', { class: 'ee-main' });
        if (ex.author && ex.author.name) {
          inner.appendChild(h('div', { class: 'ee-author' }, [
            ex.author.icon_url ? h('img', { src: ex.author.icon_url, onerror: function () { this.style.display = 'none'; } }) : null,
            rs(ex.author.name),
          ]));
        }
        if (ex.title) inner.appendChild(h('div', { class: 'ee-title' + (ex.url ? '' : ' plain'), html: mdToHtml(rs(ex.title)) }));
        if (ex.description) inner.appendChild(h('div', { class: 'ee-desc', html: mdToHtml(rs(ex.description)) }));
        if (Array.isArray(ex.fields) && ex.fields.length) inner.appendChild(fieldGrid(ex.fields));
        if (ex.image && ex.image.url) inner.appendChild(h('div', { class: 'ee-img' }, h('img', { src: ex.image.url, onerror: function () { this.style.display = 'none'; } })));
        card.appendChild(inner);
        if (ex.thumbnail && ex.thumbnail.url) card.appendChild(h('div', { class: 'ee-thumb' }, h('img', { src: ex.thumbnail.url, onerror: function () { this.style.display = 'none'; } })));
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
      // What Discord would refuse about this message right now. Send and Schedule already checked
      // it; SAVING did not, so an over-long title stored cleanly and the damage only surfaced the
      // next time that embed fired, with nothing connecting it to the edit that caused it.
      problems: function () { return limitProblems(); },
      setValue: function (v) { model = Object.assign(defaultModel(), clone(v || {})); container.innerHTML = ''; buildEditor(container, Object.assign({}, opts, { value: model })); },
      destroy: function () { container.innerHTML = ''; },
    };

    // Embedded in another plugin: just the editor. Its host owns saving and its own layout.
    //
    // The branding load has to happen HERE too, not only on the standalone path further down. This
    // return used to come first, so Built-in Embeds and Custom Live Embeds — the two tabs that mount
    // the editor this way — never learned the bot's footer and drew one containing nothing but a
    // date. Which is exactly the "sometimes there is a footer, sometimes not" the preview was
    // reported for: the ones that showed it were the kinds whose own sample happened to carry one.
    if (!opts.standalone) {
      container.appendChild(editorPane);
      renderPreview(); renderLimits();
      withBranding(renderPreview);
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
        // Templates accumulate the way saved files do, and are found by a name somebody half
        // remembers — so the list gets the same search the embed picker has.
        var tq = h('input', { class: 'es-search', type: 'search', placeholder: 'Search templates…' });
        var tCount = h('span', { class: 'ee-empty' }, names.length + ' saved');
        tplPane.appendChild(h('div', { class: 'ee-actions' }, [
          h('button', { class: 'ee-btn primary', type: 'button', onclick: function () { var n = prompt('Save the current embed as:'); if (n) api('/templates', { method: 'POST', body: { name: n, data: clone(model) } }).then(loadTpls); } }, 'Save current embed'),
          tq,
          tCount,
        ]));
        if (!names.length) { tplPane.appendChild(h('div', { class: 'ee-empty' }, 'No templates yet. Build an embed on the Editor tab, then save it here.')); return; }
        var list = h('div', {});
        names.forEach(function (n) {
          var row = h('div', { class: 'ee-hrow' }, [
            h('div', { class: 'ee-hmain' }, [h('b', {}, n), h('span', { class: 'ee-hmeta' }, (t[n] && t[n].title) || '(no title)')]),
            h('button', { class: 'ee-btn', type: 'button', onclick: function () { editor.setValue(t[n]); } }, 'Load'),
            h('button', { class: 'ee-btn danger', type: 'button', onclick: function () { if (confirm('Delete "' + n + '"?')) api('/templates/delete', { method: 'POST', body: { name: n } }).then(loadTpls); } }, '✕'),
          ]);
          // The name AND the embed's own title: people look for either.
          row.dataset.find = (n + ' ' + ((t[n] && t[n].title) || '')).toLowerCase();
          list.appendChild(row);
        });
        tq.addEventListener('input', function () {
          var q = tq.value.trim().toLowerCase();
          var shown = 0;
          Array.prototype.forEach.call(list.children, function (row) {
            var hit = !q || (row.dataset.find || '').indexOf(q) >= 0;
            row.style.display = hit ? '' : 'none';
            if (hit) shown++;
          });
          tCount.textContent = q ? (shown + ' of ' + names.length + ' saved') : (names.length + ' saved');
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
        // This list only grows, and it is the one place an owner comes to find a message they sent
        // last week. Scrolling for it is not a way to find anything. Matches the title and the
        // channel, which is how somebody actually remembers a message.
        var hq = h('input', { class: 'es-search', type: 'search', placeholder: 'Search sent messages…' });
        var hCount = h('span', { class: 'ee-empty' }, list.length + ' message(s)');
        histBox.appendChild(h('div', { class: 'ee-actions' }, [
          hCount,
          hq,
          h('button', { class: 'ee-btn', type: 'button', onclick: function () { if (confirm('Clear the list? Messages in Discord are not touched.')) api('/history/clear', { method: 'POST', body: {} }).then(loadHistory); } }, 'Clear list'),
        ]));
        hq.addEventListener('input', function () {
          var n = hq.value.trim().toLowerCase();
          var shown = 0;
          Array.prototype.forEach.call(box.children, function (row) {
            var hit = !n || (row.dataset.find || '').indexOf(n) >= 0;
            row.style.display = hit ? '' : 'none';
            if (hit) shown++;
          });
          hCount.textContent = n ? (shown + ' of ' + list.length + ' message(s)') : (list.length + ' message(s)');
        });
        var box = h('div', {});
        list.forEach(function (entry) {
          var when = new Date(entry.editedAt || entry.sentAt).toLocaleString();
          var row = h('div', { class: 'ee-hrow' }, [
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
          ]);
          // What the row can be found by — title and channel, lower-cased once here rather than on
          // every keystroke.
          row.dataset.find = ((entry.title || '') + ' ' + (entry.channelName || '')).toLowerCase();
          box.appendChild(row);
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

    // The bot's footer, for the PREVIEW only. It is no longer written into the model: the manager
    // stamps it at send time on every embed, so storing a copy in the template would just be a stale
    // duplicate that goes wrong the moment the branding changes.
    withBranding(renderPreview);

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
    return fetch(API + p, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        // The STATUS matters. Collapsing every response to its body turned a 401 after the session
        // expired into an empty object, which the styler tab then reported as "the backend isn't
        // loaded yet — restart the manager". That is advice to take a live server down over a cookie.
        if (!r.ok) return { _httpError: r.status, error: (body && body.error) || ('HTTP ' + r.status) };
        return body;
      });
    });
  }
  // What to put next to the Save button. A refused save must not read like a saved one — and the one
  // refusal that costs work (another tab saved first) says what to do about it in a toast as well,
  // because the small grey status line beside the button is easy to miss.
  function saveResult(r, okText) {
    if (r && r.ok) return okText;
    if (r && r.stale) {
      try { SSA.toast(r.error, 'error'); } catch (e) { /* toast optional */ }
      return 'NOT saved — another tab saved first. Reload the page.';
    }
    var why = (r && r.error) ? String(r.error) : '';
    return why ? ('Save failed — ' + why) : 'Save failed';
  }

  // Saving runs the same limit check Send does — and always answers with a promise, so a caller can
  // chain `.then()` whether or not the save was allowed. Returning `null` on refusal (the first
  // attempt at this) made the refusal itself throw.
  //
  // `mountedEditor` is the editor INSTANCE, not the service: `problems()` lives on what `mount()`
  // returns, and the service only has `mount` and `defaultModel`.
  //
  // THESE THREE LIVE HERE, in the same IIFE as the Save buttons. They were first written in the
  // editor-component IIFE above, which shares nothing with this one: `saveGuard` was simply not
  // defined at the call site, so both Save buttons threw and sat on "Saving…" for ever, and
  // `mountedEditor = …` quietly created a global that the real `mountedEditor` never saw — so the
  // limit check silently passed everything too. One file, two scopes, no error until it ran.
  /**
   * The "what happens when someone clicks this" panel.
   *
   * `owner` is whatever holds the buttons: a custom live embed, or one of the manager's own embeds
   * in the Built-in tab. Both keep their actions in the same shape (`owner.actions[key]`) and the
   * backend looks them up in both places, so one panel serves both. It used to live inside the
   * Custom tab, which is why a button on a built-in embed could be drawn, saved and delivered and
   * never wired to anything: the best it could ever answer was "nothing is set up for that button
   * yet", with no way anywhere to set anything up.
   */
  /**
   * Custom ids that two embeds share.
   *
   * The backend looks an action up by custom id across EVERY embed and takes the first hit, so a
   * duplicate means one embed's button silently runs another's command. New ids are scoped per
   * embed now, but an id already in a config cannot be renamed here: it is baked into the messages
   * already posted in Discord, and changing it would kill every live button on them. So the panel
   * reports it and the owner decides \u2014 repost the message, or leave it and accept the collision.
   */
  function collidingIds(all, me) {
    const seen = {};
    const dup = [];
    (all || []).forEach(function (o) {
      const label = (o && (o.name || o.id)) || 'an embed';
      const m = (o && o.model) || {};
      [].concat(m.buttons || [], m.selects || []).forEach(function (b) {
        const cid = b && (b.custom_id || b.customId);
        if (!cid) return;
        if (seen[cid] && seen[cid] !== label) dup.push({ cid: cid, a: seen[cid], b: label });
        else seen[cid] = label;
      });
    });
    const mine = (me && (me.name || me.id)) || null;
    return dup.filter(function (d) { return !mine || d.a === mine || d.b === mine; });
  }

  function renderActionsInto(actionsBox, owner, roles, redraw, siblings) {
    actionsBox.innerHTML = '';
    if (!owner) return;
    owner.actions = owner.actions || {};
    actionsBox.appendChild(h('div', { class: 'ce-acts-h' }, '\u26a1 Click actions'));
    collidingIds(siblings, owner).forEach(function (d) {
      actionsBox.appendChild(h('p', { class: 'ce-act-note' },
        '\u26a0 Custom ID \u201c' + d.cid + '\u201d is used by both \u201c' + d.a + '\u201d and \u201c' + d.b + '\u201d. '
        + 'Whichever was saved first wins for BOTH, so one of these buttons runs the other one\u2019s action. '
        + 'Give one of them a different Custom ID \u2014 note that doing so kills that button on any message already posted, so repost it afterwards.'));
    });
    actionsBox.appendChild(h('p', { class: 'muted', style: 'font-size:.8rem;margin:0 0 10px' }, 'Step 1: add buttons or a select menu in the editor above. Step 2: each one shows up here \u2014 pick what it does when a player uses it.'));

    // One action row, wherever it came from. `key` is what the backend looks the action up by:
    // a button's Custom ID, or MENU_ID::OPTION_VALUE for one choice in a menu.
    function actRow(key, label, hint) {
      var act = owner.actions[key] = owner.actions[key] || { type: '', value: '' };
      var typeSel = h('select', {}, [['', '\u2014 no action \u2014'], ['command', 'Run in-game command'], ['message', 'Reply with a message'], ['announce', 'Post message to this channel']].map(function (o) { return h('option', { value: o[0] }, o[1]); }));
      typeSel.value = act.type || ''; typeSel.addEventListener('change', function () { act.type = typeSel.value; redraw(); });
      var valInp = h('input', { type: 'text', value: act.value || '', placeholder: act.type === 'command' ? '#SpawnItem BP_... 1  (supports {tokens})' : (hint || 'Text (supports {tokens})') });
      valInp.addEventListener('input', function () { act.value = valInp.value; });
      actionsBox.appendChild(h('div', { class: 'ce-act' }, [h('span', { class: 'ce-act-id' }, label), typeSel, act.type ? valInp : null]));

      // Who may press it, and how often. Only for the two actions that DO something outside the
      // clicker's own screen \u2014 a "reply with a message" is private to whoever clicked and needs
      // no guard. Both are off by default: owners already run these buttons, and quietly locking
      // them would break what they built. The line below says what "off" means, because "anyone in
      // the channel can run this in-game command" is not what an owner pictures when they type a
      // spawn command into a text box.
      if (act.type !== 'command' && act.type !== 'announce') return;

      var roleSel = h('select', {}, [h('option', { value: '' }, 'Anyone can use it')]);
      (roles || []).forEach(function (r) { roleSel.appendChild(h('option', { value: r.id }, '@' + r.name + ' only')); });
      // A role that no longer exists must still be visible, or saving this row would silently drop
      // the restriction the owner set.
      if (act.roleId && !(roles || []).some(function (r) { return r.id === act.roleId; })) {
        roleSel.appendChild(h('option', { value: act.roleId }, 'role ' + act.roleId + ' (not found)'));
      }
      roleSel.value = act.roleId || '';
      roleSel.addEventListener('change', function () { act.roleId = roleSel.value; redraw(); });

      var cdInp = h('input', { type: 'number', min: '0', step: '1', value: act.cooldownSec || 0, style: 'width:6.5rem' });
      cdInp.addEventListener('input', function () { act.cooldownSec = Math.max(0, parseInt(cdInp.value, 10) || 0); });

      actionsBox.appendChild(h('div', { class: 'ce-act ce-act-guard' }, [
        h('span', { class: 'ce-act-id' }, ''),
        h('label', { class: 'ce-act-g' }, [h('span', {}, 'Who'), roleSel]),
        h('label', { class: 'ce-act-g' }, [h('span', {}, 'Cooldown (s, 0 = none)'), cdInp]),
      ]));
      if (!act.roleId) {
        actionsBox.appendChild(h('p', { class: 'ce-act-note' },
          act.type === 'command'
            ? '\u26a0 Anyone who can see this message can run that in-game command. Pick a role, or set a cooldown, if that is not what you want.'
            : '\u26a0 Anyone who can see this message can make the bot post that. Pick a role, or set a cooldown, if that is not what you want.'));
      }
    }

    // every non-Link button gets an action row; auto-assign a Custom ID if the user left it blank
    var model = owner.model || {};
    var allBtns = (model.buttons || []).filter(function (b) { return String(b.style) !== '5'; });
    // Scoped to the embed. Numbering from 1 inside each embed meant two embeds both minted `btn1`,
    // and the backend looks an action up across ALL embeds — so the second embed's button ran the
    // first one's command. Already-assigned ids are never touched: they are baked into messages
    // already posted in Discord, and renaming one kills that live button.
    var idScope = String(owner.id || owner.__kind || 'e').replace(/[^\w-]/g, '').slice(0, 24);
    allBtns.forEach(function (b, i) { if (!(b.custom_id || b.customId)) b.custom_id = idScope + '_btn' + (i + 1); });
    allBtns.forEach(function (b) {
      var cid = b.custom_id || b.customId;
      actRow(cid, (b.label || cid) + ' \u00b7 ' + cid);
    });

    // Select menus. The editor has always offered them here; until an option could be given an
    // action, picking one answered a player with Discord's own "This interaction failed".
    var sels = model.selects || [];
    sels.forEach(function (sl, si) {
      if (!(sl.custom_id || sl.customId)) sl.custom_id = idScope + '_menu' + (si + 1);
      var scid = sl.custom_id || sl.customId;
      var opts = (sl.options || []).filter(function (o) { return o && o.label; });
      actionsBox.appendChild(h('div', { class: 'ce-acts-sub' }, '\u25be Menu \u00b7 ' + scid + (sl.placeholder ? ' \u2014 \u201c' + sl.placeholder + '\u201d' : '')));
      if (!opts.length) { actionsBox.appendChild(h('p', { class: 'muted', style: 'font-size:.8rem;margin:0 0 8px' }, 'This menu has no options yet \u2014 add some in the editor\u2019s \u201cSelect menus\u201d section.')); return; }
      opts.forEach(function (o, oi) {
        var val = o.value || ('opt_' + oi);
        actRow(scid + '::' + val, o.label + ' \u00b7 ' + val);
      });
      // The catch-all, so a long menu does not need an entry per option.
      actRow(scid, 'Any other choice \u00b7 ' + scid, 'Text \u2014 {picked} is the chosen option');
    });

    if (!allBtns.length && !sels.length) {
      actionsBox.appendChild(h('p', { class: 'muted', style: 'font-size:.82rem;margin:0' }, 'Nothing clickable yet \u2014 add a button (any style except \u201cLink\u201d) or a select menu in the editor above.'));
    }
  }
  var mountedEditor = null;
  function saveGuard(doSave) {
    var bad = [];
    try { bad = (mountedEditor && mountedEditor.problems) ? mountedEditor.problems() : []; } catch (e) { bad = []; }
    if (bad.length) {
      try { SSA.toast('Not saved — ' + bad[0], 'error'); } catch (e) { /* toast optional */ }
      return Promise.resolve({ ok: false, error: bad[0] });
    }
    return Promise.resolve(doSave());
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
      // The revision this page loaded. Sent back on save so a second tab cannot silently overwrite
      // what this one is looking at — see `staleSave` in the backend.
      var rev = (typeof cfg.rev === 'number') ? cfg.rev : null;
      function imgFor(key) { return configuredImages[key] || liveImages[key] || null; }   // manager-set first, else captured
      body.className = ''; body.innerHTML = '';
      if (!kinds.length) { (function () {
        // An expired session answers 401 with valid JSON, which used to land here and advise
        // restarting the manager — advice that would take a live server down over a cookie.
        body.innerHTML = '';
        var w = h('div', { class: 'es-warn' });
        w.textContent = (cfg && cfg._httpError)
          ? 'Could not load: ' + cfg.error + '. Reload the page, and sign in again if it persists.'
          : 'The styler backend isn’t loaded yet. Restart the manager (or toggle this plugin off and on) to finish enabling it, then reopen this tab.';
        body.appendChild(w);
      }()); return; }
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
            // "not seen yet" read as a fault. For most kinds the manager can now describe the embed
            // without ever having sent one; what is left is the property alerts and intel cards,
            // whose text only exists once a real event supplies it. Say that, not "not seen".
            var note = '';
            if (!k.live && !k.sample) note = (k.group === 'dm' || k.group === 'intel')
              ? ' — shape after the first alert'
              : ' — not captured yet';
            og.appendChild(h('option', { value: k.key }, k.label + note));
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
      // The click-actions panel for buttons added to a MANAGER embed. Same panel, same storage shape
      // and same backend lookup as the custom embeds' one.
      var actionsBox = h('div', {});
      var roles = [];
      api('/roles').then(function (l) { roles = Array.isArray(l) ? l : []; drawActions(); }).catch(function () { /* no guild → "Anyone" only */ });
      // This text has to match what applyStyle() really does. It used to end “buttons stay manager
      // controlled”, which stopped being true the moment the send started delivering them — and a note
      // that contradicts the behaviour is worse than no note, because it stops people trying.
      var NOTE_NORMAL = 'Leave a field blank to keep the manager default. Applied: colour, title (and its link), description, author, thumbnail, image, the text above the embed, buttons, select menus and any extra embeds. Turn on “Replace fields” to fully control the field list — click a field, then a data token to insert it. The footer and timestamp come from your bot’s branding on every embed, so they are not editable here.';
      var NOTE_STYLE = 'This embed shows a generated list, so its fields are not editable here — but everything around them is: colour, title, author, image, the text above the embed, buttons, select menus and extra embeds. It keeps the image you set in the manager unless you set one here.';
      var NOTE_PLAYER = 'This embed is tied to a player, so the {stat_…} tokens fill in with THAT player’s numbers when it fires. On embeds without a player (server status, leaderboards, custom live embeds) use {pstat:PlayerName:Field} instead to pull a specific player’s stat.';

      // Seed a kind's editor model from its catalog: default field template + (for live embeds) a
      // starting title, so picking a kind loads a real, editable layout — no event needed.
      // Seed the editor from the kind's TEMPLATE — the captured embed with its live values turned
      // back into {tokens}. Seeding from the raw sample is what made the editor open full of the
      // numbers the manager happened to send last: a title reading "43/64" instead of
      // "{online}/{max}", which saved as a literal and froze the embed at that moment forever.
      function seedModel(kd) {
        var m = edSvc.defaultModel();
        var t = (kd && kd.template) || null;
        // `title`/`description`/`defaults` are the same template under their old names — kept so a
        // manager serving the older shape still seeds something sensible.
        var title = t ? t.title : (kd && kd.title);
        var desc = t ? t.description : (kd && kd.description);
        var fields = (t && t.fields) || (kd && kd.defaults) || [];
        if (title) m.title = title;
        if (desc) m.description = desc;
        if (t && t.url) m.url = t.url;
        if (t && t.color) m.color = t.color;
        if (t && t.author && t.author.name) m.author = { name: t.author.name, url: t.author.url || '', icon_url: t.author.icon_url || '' };
        if (t && t.thumbnail && t.thumbnail.url) m.thumbnail = { url: t.thumbnail.url };
        if (t && t.image && t.image.url) m.image = { url: t.image.url };
        if (kd && kd.key && liveImages[kd.key]) m.image = { url: liveImages[kd.key] };   // the manager's own live-embed image wins
        if (fields.length) {
          m.fields = fields.map(function (f) { return { name: f.name || '', value: f.value || '', inline: !!f.inline }; });
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
        // Buttons and menus added here now get the SAME click-actions panel the custom embeds have —
        // until they did, a button on a manager embed was drawn, saved and delivered, and there was
        // nowhere in the whole panel to say what it should do.
        mountedEditor = edSvc.mount(edBox, {
          value: entry.model, tokens: (kd && kd.tokens) || [],
          onChange: function (m) { entry.model = m; drawActions(); },
        });
        drawActions();
      }
      // The styles keyed by embed kind are siblings in the same custom-id space as each other.
      function drawActions() {
        var sibs = Object.keys(styles).map(function (k) { return Object.assign({ name: k }, styles[k]); });
        renderActionsInto(actionsBox, entryFor(sel.value), roles, drawActions, sibs);
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
        h('div', { class: 'ce-acts' }, [actionsBox]),
        h('div', { class: 'es-actions' }, [
          h('button', { class: 'es-btn primary', onclick: function () {
            status.textContent = 'Saving…';
            saveGuard(function () { return api('/config', { method: 'POST', body: { styles: styles, rev: rev } }); })
              .then(function (r) { status.textContent = saveResult(r, 'Saved ✓ — applies to the next embed'); if (r && typeof r.rev === 'number' && !r.stale) rev = r.rev; });
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
    var roles = [];
    Promise.all([
      api('/custom').then(function (c) { return c || {}; }),
      // `api('/channels')`, not a hand-written URL. Routes mount under the MANIFEST id, which is
      // `discord-embeds`; the old path pointed at `embed-editor`, the plugin this one replaced. It
      // 404'd, the .catch() swallowed it, and the channel dropdown on this tab was permanently
      // empty — so no custom live embed could ever be given a channel, and none of them posted.
      api('/channels').then(function (l) { return Array.isArray(l) ? l : []; }),
      // Roles for the "who may press this" dropdown. An empty list is fine — the row then offers
      // only "Anyone can use it", which is what it did before there was a choice at all.
      api('/roles').then(function (l) { return Array.isArray(l) ? l : []; }),
    ]).then(function (res) {
      if (!edSvc) { body.innerHTML = '<div class="es-warn">The embed editor did not load — reload the page, and if it persists check the manager log.</div>'; return; }
      channels = res[1] || [];
      roles = res[2] || [];
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
      // See `staleSave` in the backend — the revision this page loaded, sent back on every save.
      var rev = (typeof cfg.rev === 'number') ? cfg.rev : null;
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
      // Clicking through a dropdown is fine for three embeds and hopeless for thirty.
      var search = h('input', { class: 'es-search', type: 'search', placeholder: 'Search embeds…' });

      // Wire each embed button (Custom ID, not a Link) to an action fired when a player clicks it.
      function renderActions() { renderActionsInto(actionsBox, items[cur], roles, renderActions, items); }

      function optLabel(ce, i) { return (ce.name || ('Embed ' + (i + 1))) + (ce.enabled === false ? ' · off' : ''); }
      // Find the option belonging to an item by its VALUE, never by position: once the list can be
      // filtered, the nth option is no longer the nth embed, and renaming one would relabel another.
      function optFor(i) { return sel.querySelector('option[value="' + i + '"]'); }
      function refreshSel() {
        var q = (search.value || '').trim().toLowerCase();
        sel.innerHTML = '';
        var shown = 0;
        items.forEach(function (ce, i) {
          var label = optLabel(ce, i);
          if (q && label.toLowerCase().indexOf(q) < 0) return;
          sel.appendChild(h('option', { value: String(i) }, label));
          shown++;
        });
        if (!items.length) sel.appendChild(h('option', { value: '' }, '— no embeds —'));
        else if (!shown) sel.appendChild(h('option', { value: '' }, 'No embed matches “' + search.value + '”'));
        // Keep showing whatever is open even when the filter hides it — a search box that silently
        // switched you to a different embed while you were editing one would lose work.
        if (shown && !optFor(cur) && items[cur]) sel.appendChild(h('option', { value: String(cur) }, optLabel(items[cur], cur) + ' · editing'));
        sel.value = String(cur);
      }
      function showOne() {
        var ce = items[cur];
        edBox.innerHTML = ''; actionsBox.innerHTML = '';
        if (!ce) { nameInp.value = ''; chanSel.value = ''; iv.value = 60; active.checked = true; return; }
        if (!ce.id) ce.id = 'ce_' + Date.now() + '_' + cur;
        if (!ce.model) ce.model = edSvc.defaultModel();
        nameInp.value = ce.name || ''; chanSel.value = ce.channelId || ''; iv.value = ce.intervalSec || 60; active.checked = ce.enabled !== false;
        mountedEditor = edSvc.mount(edBox, { value: ce.model, tokens: tokens, onChange: function (m) { ce.model = m; renderActions(); } });
        renderActions();
      }
      function saveAll(cb) {
        return saveGuard(function () { return api('/custom', { method: 'POST', body: { items: items, rev: rev } }); })
          .then(function (r) {
            if (r && typeof r.rev === 'number' && !r.stale) rev = r.rev;
            // A refused save must not run the "…and now post it" continuation: posting an embed the
            // server never accepted would publish a version nobody has.
            if (r && r.ok === false) { try { SSA.toast(saveResult(r, ''), 'error'); } catch (e) {} return r; }
            if (cb) cb(r);
            return r;
          });
      }

      chanSel.appendChild(h('option', { value: '' }, '— pick a channel —'));
      channels.forEach(function (c) { chanSel.appendChild(h('option', { value: c.id }, '#' + c.name)); });

      sel.addEventListener('change', function () { if (sel.value === '') return; cur = +sel.value || 0; showOne(); });
      search.addEventListener('input', refreshSel);
      nameInp.addEventListener('input', function () { if (items[cur]) { items[cur].name = nameInp.value; var o = optFor(cur); if (o) o.textContent = optLabel(items[cur], cur); } });
      chanSel.addEventListener('change', function () { if (items[cur]) items[cur].channelId = chanSel.value; });
      iv.addEventListener('input', function () { if (items[cur]) items[cur].intervalSec = Number(iv.value) || 60; });
      active.addEventListener('change', function () { if (items[cur]) { items[cur].enabled = active.checked; var o = optFor(cur); if (o) o.textContent = optLabel(items[cur], cur); } });

      body.appendChild(h('div', { class: 'card es-card' }, [
        h('div', { class: 'es-bar' }, [
          h('label', { class: 'es-f', style: 'flex:1 1 180px' }, [h('span', {}, 'Embed'), sel]),
          h('label', { class: 'es-f', style: 'flex:1 1 150px' }, [h('span', {}, 'Find'), search]),
          h('button', { class: 'es-btn', onclick: function () { items.push({ id: 'ce_' + Date.now(), name: 'Live status', channelId: '', intervalSec: 60, enabled: true, model: starterModel() }); cur = items.length - 1; search.value = ''; refreshSel(); showOne(); } }, '+ Add'),
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
            saveAll(function () { api('/custom/post', { method: 'POST', body: { id: items[cur].id } }).then(function (r) {
              // Say WHICH thing went wrong — the backend now tells us. "Failed (channel / bot?)"
              // covered four different causes and pointed at none of them.
              st.textContent = (r && r.ok) ? 'Posted ✓ — keeps updating' : ('⚠ ' + ((r && r.error) || 'could not post'));
            }); });
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
