/* Loot Zones — admin tab.
 *
 * Every control on this page is editable with the server stopped; the live half (what the game
 * currently holds) is drawn as a note beside them and never gates anything. That is the rule the
 * whole plugin section of this product follows: an owner sets a server up before they start it.
 *
 * Where a control needs something switched on in the bridge that no plugin may ask for on an
 * owner's behalf, this page names that switch by its own label — the words on the card they have to
 * go and find — rather than saying the feature is unavailable.
 *
 * Every word an admin reads on this page goes through the panel's translator, with the English
 * written beside the key at the call site: a language nobody has translated yet renders exactly
 * what it renders today. What is NOT translated is what leaves this page — a zone's name, a message
 * template and its {tokens}, a loot set's folder name, a game class — because those are values the
 * server and the game read back.
 */
(function () {
  'use strict';

  /**
   * ⚠ **`apiClient()` TAKES NO ARGUMENT, AND PASSING ONE READ AS IF IT DID.** It captures whichever
   * plugin the SDK is loading right now and binds it for the life of the tab; the id written here
   * was silently dropped. Harmless today and a lie in the source, which is the shape that gets
   * copied into the next plugin and then into one where the two names differ.
   */
  var API = SSA.apiClient ? SSA.apiClient() : null;
  var T = SSA.t;
  /**
   * WHERE THE BRIDGE'S SETTINGS REALLY ARE, IN THE PANEL'S OWN WORDS.
   *
   * ⚠ Two sentences on this page used to send an owner to "Settings → Bridge" and to "Settings,
   * Bridge, SSA Bridge card", and neither route has ever existed: Settings holds Manager, Discord,
   * Server, Frontend, Game Settings and Translations, and the bridge's module cards live under
   * Plugins on a tab called SSA Bridge. A route nobody can walk is worse than no route at all, and
   * translating one multiplies the wrong sentence by eighteen.
   *
   * So it is not written down here either. Both halves are looked up in the PANEL's own dictionary —
   * `nav.plugins` and `plugins.viewInGame` are the very keys the nav and the tab strip render
   * themselves from — which makes the sentence right in all nineteen languages and keeps it right on
   * the day somebody renames that tab. This plugin's own locale files carry `{where}` and no route.
   */
  function bridgeWhere() {
    return T('nav.plugins', 'Plugins') + ' → ' + T('plugins.viewInGame', 'SSA Bridge');
  }
  /**
   * A COUNT AND ITS NOUN TRAVEL TOGETHER, ALWAYS.
   *
   * `n + ' ' + (n === 1 ? 'place' : 'places')` is a translated word glued to a number, which is the
   * one shape that cannot survive a language whose plural does not work that way — and it was the
   * commonest shape on this page. Each of these is one whole phrase per form, written literally at
   * its own key, so a translator sees the number in the sentence it belongs to.
   */
  function nPlaces(n) {
    return n === 1 ? T('pl.loot-zones.n.place.one', '{n} place', { n: n })
      : T('pl.loot-zones.n.place.many', '{n} places', { n: n });
  }
  function nGuards(n) {
    return n === 1 ? T('pl.loot-zones.n.guard.one', '{n} guard', { n: n })
      : T('pl.loot-zones.n.guard.many', '{n} guards', { n: n });
  }
  function nMinutes(n) {
    return n === 1 ? T('pl.loot-zones.n.minute.one', '{n} minute', { n: n })
      : T('pl.loot-zones.n.minute.many', '{n} minutes', { n: n });
  }
  function nSeconds(n) {
    return n === 1 ? T('pl.loot-zones.n.second.one', '{n} second', { n: n })
      : T('pl.loot-zones.n.second.many', '{n} seconds', { n: n });
  }
  function nHours(n) {
    return n === 1 ? T('pl.loot-zones.n.hour.one', '{n} hour', { n: n })
      : T('pl.loot-zones.n.hour.many', '{n} hours', { n: n });
  }
  function nDays(n) {
    return n === 1 ? T('pl.loot-zones.n.day.one', '{n} day', { n: n })
      : T('pl.loot-zones.n.day.many', '{n} days', { n: n });
  }
  /** A SPAWN PLAN is the game's own word for it on this page: one plan is shared by many places. */
  function nPlans(n) {
    return n === 1 ? T('pl.loot-zones.n.plan.one', '{n} spawn plan', { n: n })
      : T('pl.loot-zones.n.plan.many', '{n} spawn plans', { n: n });
  }
  function nElsewhere(n) {
    return n === 1 ? T('pl.loot-zones.n.elsewhere.one', '{n} other place', { n: n })
      : T('pl.loot-zones.n.elsewhere.many', '{n} other places', { n: n });
  }
  /** A place the OWNER named, which is a different thing from a place the zone laid out. */
  function nPoints(n) {
    return n === 1 ? T('pl.loot-zones.n.point.one', '{n} point', { n: n })
      : T('pl.loot-zones.n.point.many', '{n} points', { n: n });
  }
  /** What a roll of a plan MAKES, which is the half the chance never decides. */
  function nCharacters(n) {
    return n === 1 ? T('pl.loot-zones.n.character.one', '{n} character', { n: n })
      : T('pl.loot-zones.n.character.many', '{n} characters', { n: n });
  }
  /**
   * The same count carrying its VERB, because the sentence it finishes is about a state rather than
   * about a number: "{n} changed right now" needs *is* or *are*, and a language that agrees the verb
   * with the noun cannot be given the two halves separately.
   */
  function nPlansChanged(n) {
    return n === 1 ? T('pl.loot-zones.n.planChanged.one', '{n} spawn plan is', { n: n })
      : T('pl.loot-zones.n.planChanged.many', '{n} spawn plans are', { n: n });
  }
  /** The labels this page quotes at itself, each read from the ONE key that also draws the control. */
  function labSentriesOut() { return T('pl.loot-zones.set.sentriesOut', 'Keep sentries out'); }
  function labZombiesOut() { return T('pl.loot-zones.set.zombiesOut', 'Keep zombies out'); }
  function labMaxGuards() { return T('pl.loot-zones.set.maxGuards', 'Guards at the same time'); }
  function labCooldown() { return T('pl.loot-zones.set.cooldown', 'A new guard at most every'); }
  function labOwnPosts() { return T('pl.loot-zones.set.ownPosts', 'Places spread over the zone'); }
  function labMaxPosts() { return T('pl.loot-zones.set.maxPosts', 'At most this many places'); }
  function labTechnical() { return T('pl.loot-zones.more.technical', 'Technical settings'); }
  function labPerGuard() { return T('pl.loot-zones.ovr.only', 'Only for this guard'); }
  function labRotationOn() { return T('pl.loot-zones.set.rotationOn', 'Rotation on'); }
  function labReloadOnSwitch() { return T('pl.loot-zones.set.reloadOnSwitch', 'Reload loot after a switch'); }
  function labConfigMode() { return T('pl.loot-zones.set.configMode', 'Colour and visibility'); }
  function labSave() { return T('pl.loot-zones.save', 'Save'); }
  function labDiscard() { return T('pl.loot-zones.discard', 'Discard changes'); }
  function labWhatIsIn() { return T('pl.loot-zones.zone.whatIsIn', 'What is in this zone?'); }
  function labReconcile() { return T('pl.loot-zones.act.reconcile', 'Check against the game'); }
  function labActivityMode() { return T('pl.loot-zones.set.activityMode', 'Spawning in this zone'); }
  function cardActivity() { return T('pl.loot-zones.card.activity', 'How busy the zone is'); }
  function cardBridge() { return T('pl.loot-zones.card.bridge', 'Bridge'); }
  function cardActions() { return T('pl.loot-zones.card.actions', 'Actions'); }
  function cardRotation() { return T('pl.loot-zones.card.rotation', 'How zones are chosen'); }
  function cardRectangle() { return T('pl.loot-zones.card.rectangle', 'The rectangle players see'); }
  function optRestart() { return T('pl.loot-zones.rot.restart', 'One zone per server restart'); }
  /**
   * ⚠ A BODY IS AN OBJECT, NEVER A STRING.
   *
   * The SDK stringifies an object body and sets `Content-Type: application/json` in the same breath
   * — and only in that branch. Hand it a string that has already been stringified and the branch is
   * skipped, the header never goes out, and `express.json()` parses nothing without one: the route
   * receives `{}`. A save then stores what was already there, answers with it, and the screen draws
   * that back over everything the owner just typed. Nothing fails and nothing is saved.
   *
   * The fallback below sets the header itself, which is why driving this through a fallback proves
   * nothing about the real path. Both take an object.
   */
  var api = function (p, opts) {
    var o = opts || {};
    if (API) return API(p, o);
    // The plugin's own routes are under /api/plugin-host/; /api/plugins/ is the plugin MANAGEMENT
    // surface and answers none of them.
    var url = '/api/plugin-host/loot-zones' + p;
    // Built rather than mutated: the request init is assembled in one place, and an assignment onto
    // an object that looks like a config root reads to the plugin checker as a setting being saved.
    var init = (o.body && typeof o.body === 'object')
      ? Object.assign({}, o, {
        headers: Object.assign({ 'Content-Type': 'application/json' }, o.headers || {}),
        body: JSON.stringify(o.body),
      })
      : Object.assign({}, o);
    return fetch(url, init).then(function (r) { return r.json(); }).catch(function () { return {}; });
  };

  // ⚠ `SSA.el`, and it is not a preference. There is no `SSA.h` on the SDK — this line read
  // `SSA.h || …` and therefore took its own fallback on every render this tab has ever done, which
  // is a second element helper living beside the real one and drifting from it for free.
  var h = SSA.el || function (t, a, c) {
    var e = document.createElement(t);
    if (a) Object.keys(a).forEach(function (k) {
      if (k === 'class') e.className = a[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), a[k]);
      else if (a[k] != null) e.setAttribute(k, a[k]);
    });
    (Array.isArray(c) ? c : [c]).forEach(function (x) {
      if (x == null || x === false) return;
      e.appendChild(typeof x === 'string' ? document.createTextNode(x) : x);
    });
    return e;
  };
  var icon = function (n) { return SSA.icon ? SSA.icon(n) : h('span', {}, ''); };

  var state = { cfg: null, sets: null, status: null, clock: null, bridge: null, activity: null };
  // Which explanations and which "More options" folds a viewer has opened. Per visit, never saved.
  var openHints = {};
  var openMore = {};
  // Whether the settings could be READ is UI state, not a setting — so it does not live on the
  // object the config lives on. Anything assigned there reads as something the backend ought to
  // know about, which is the same reading `unsaved` was moved out for.
  var broken = false;
  // Unsaved-ness is UI state, not a setting, so it does NOT live on the object the config lives on:
  // anything assigned there reads as a setting the backend ought to know about, and rightly so.
  var unsaved = false;
  // Which blocks a viewer has folded away. Per viewer and per visit, deliberately — it is not a
  // server setting and has no business being saved as one.
  var shut = {};
  /**
   * ── THE ZONE LIST'S OWN STATE, AND NONE OF IT IS A SETTING ─────────────────────────────────────
   *
   * A search box, which zones are ticked and whether the list is folded are all per viewer and per
   * visit. They never reach `state.cfg`: anything written there reads as something the backend ought
   * to store, and a filter somebody typed is not.
   *
   * ⚠ **A TICK IS KEYED ON THE ZONE'S ID AND NEVER ON ITS POSITION.** A zone moved up the list, a
   * zone removed or a copy inserted above it all change the index and none of them change what the
   * reader ticked — and acting on the wrong row here switches off somebody's live zone.
   */
  var zoneFind = '';
  var zoneShow = 'all';
  var zonePick = {};
  var root = null;
  var poll = null;
  /**
   * The ids of the zones the BACKEND last answered with, or `null` while that is unknown.
   *
   * ⚠ **"NOT SAVED YET" IS A REFUSAL THIS PAGE CAN SEE COMING.** `/activate` refuses a zone whose id
   * the saved configuration does not carry — *"this zone is not saved yet. Save, then switch it on"* —
   * which is exactly what a zone just added or just copied is. Knowing which ids are saved turns that
   * from a toast after a click into a sentence beside the button before one.
   */
  var savedIds = null;
  /** The save bar, so a change made inside a control the owner is still typing in can mark the page
   *  dirty without a redraw destroying the caret. */
  var saveBar = null;
  /**
   * Which zone the rows being built belong to, so two zones do not share one explanation.
   *
   * ⚠ `openHints` used to be keyed on the LABEL alone, and every zone draws the same labels — so
   * opening "Keep sentries out" on one zone opened the same paragraph on every zone on the page, and
   * closing it closed them all. Set around the block that builds a zone's rows and cleared after.
   */
  var hintScope = '';

  function markDirty() { unsaved = true; render(); }

  /**
   * ⚠ **`root.innerHTML = ''` IS A RELOAD, NOT A REDRAW — AND THIS PAGE DID IT EVERY FIFTEEN
   * SECONDS.**
   *
   * `domPatch.js` is the manager's answer to that shape and it is deliberately NOT used here, for
   * two reasons that were checked rather than assumed:
   *
   *   · its only entry point is `window.ssaPatchHtml(host, markup)` and it takes **markup**. This
   *     page is built out of NODES with their handlers already on them; handing it a string would
   *     mean putting a zone's name, a server path and the bridge's own words through `innerHTML`,
   *     which is the one thing this file has never done — see the `SSA.modal` call in
   *     "What is in this zone" for the rule.
   *   · its own header forbids patching a container that something else has **enhanced**. The
   *     panel's `enhanceSelect()` runs a `MutationObserver` over `document.body` with
   *     `subtree: true`, so every `<select>` in this tab is wrapped in a `.cdd` and marked
   *     `data-cdd`. Patching strips the marker and re-enhances, stacking a second dropdown button
   *     on each of them on every pass — and this tab draws three to ten selects.
   *
   * So: the narrow honest thing, which is three separate losses with three separate answers.
   *
   *   · **What is half-typed.** An input commits on `change`, which fires on BLUR — so a poll
   *     fifteen seconds in rebuilt the page out of a config the typing had never reached, and the
   *     words went with it. Typing now marks the page unsaved on the FIRST keystroke, and
   *     `refresh({quiet:true})` already refuses to redraw an unsaved page. Same rule, fifteen
   *     seconds earlier. It does not redraw to do it — `dirtyOnly()` swaps the save bar alone.
   *   · **Where the reader was.** Emptying the root takes the content to zero height, so the
   *     scroller CLAMPS its offset to 0 and never gets it back when the content returns. That is
   *     the one case `domPatch.js` measured in Chrome where `scrollTop` really is lost (its own
   *     patches never shrink to nothing, which is exactly why it correctly restores nothing).
   *   · **The caret.** A field still in the same place, of the same kind, is focused again with its
   *     selection. ⚠ **FIELDS ONLY, AND ONLY ON AN EXACT MATCH.** Restoring a BUTTON by position
   *     would, after a guard had been removed, put the keyboard on a different guard's Remove —
   *     which is the key-by-index mistake in the one place where it costs somebody their data.
   */
  function scrollerOf(el) {
    for (var n = el && el.parentNode; n && n.nodeType === 1; n = n.parentNode) {
      var s = null;
      try { s = window.getComputedStyle(n); } catch (ignored) { return null; }
      if (s && /auto|scroll|overlay/.test(s.overflowY) && n.scrollHeight > n.clientHeight) return n;
    }
    return document.scrollingElement || document.documentElement;
  }

  function beforeRedraw() {
    if (!root) return null;
    var sc = scrollerOf(root);
    var keep = { sc: sc, top: sc ? sc.scrollTop : 0, f: null };
    var a = document.activeElement;
    if (!a || !root.contains(a) || !/^(?:INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return keep;
    var path = [];
    for (var n = a; n && n !== root; n = n.parentNode) {
      var p = n.parentNode;
      if (!p) return keep;
      path.unshift(Array.prototype.indexOf.call(p.children, n));
    }
    var f = { path: path, tag: a.tagName, type: a.getAttribute('type') || '', cls: a.className, s: null, e: null };
    // A number box and a colour box have no selection at all and throw when asked for one.
    try { f.s = a.selectionStart; f.e = a.selectionEnd; } catch (ignored) { /* not a text field */ }
    keep.f = f;
    return keep;
  }

  function afterRedraw(keep) {
    if (!keep || !root) return;
    var f = keep.f;
    if (f) {
      var n = root;
      for (var i = 0; i < f.path.length && n; i++) n = n.children[f.path[i]];
      // Every one of the four has to agree, or this is a different control wearing the same
      // position — which is the whole reason the rule is written as a match rather than a lookup.
      if (n && n.tagName === f.tag && (n.getAttribute('type') || '') === f.type && n.className === f.cls) {
        // `preventScroll`, or the browser's own scroll-into-view fights the offset put back below.
        try { n.focus({ preventScroll: true }); } catch (ignored) { try { n.focus(); } catch (e2) { /* gone */ } }
        if (f.s != null) { try { n.selectionStart = f.s; n.selectionEnd = f.e; } catch (ignored) { /* no selection */ } }
      }
    }
    if (keep.sc && keep.top) { try { keep.sc.scrollTop = keep.top; } catch (ignored) { /* detached */ } }
  }

  /**
   * Unsaved from the first keystroke, and NOT from the first blur.
   *
   * ⚠ It deliberately does not redraw and deliberately fires once: `dirtyOnly()` swaps the save bar
   * in place, and doing that on every character would be a node swap per keypress for no change.
   */
  function typed(el) {
    el.addEventListener('input', function () { if (!unsaved) dirtyOnly(); });
    return el;
  }

  /**
   * Mark the page unsaved WITHOUT redrawing it.
   *
   * For a change made from inside a control the owner still has the caret in — the token chips under
   * a message. A full redraw there destroys the textarea, the focus and the selection, which is the
   * `innerHTML =` lesson one control wide.
   */
  function dirtyOnly() {
    unsaved = true;
    if (!saveBar || !saveBar.parentNode) { render(); return; }
    var next = saveBarNode();
    saveBar.parentNode.replaceChild(next, saveBar);
    saveBar = next;
  }

  /**
   * A request that failed, in words. The SDK client REJECTS for a 404, a 500, an expired session and
   * a manager that has stopped, and a button whose promise has no `catch` then does nothing at all:
   * no toast, no change, nothing to act on.
   */
  function failed(what) {
    return function (err) {
      SSA.toast(T('pl.loot-zones.failed', '{what}: {why}', {
        what: what,
        why: (SSA.apiError ? SSA.apiError(err) : ((err && err.message) || T('pl.loot-zones.noAnswer', 'no answer'))),
      }));
    };
  }

  function save() {
    return api('/config', { method: 'POST', body: state.cfg })
      .then(function (r) {
        if (!r || !r.config) {
          var whyNot = r && (r.why || r.reason || r.error);
          SSA.toast(whyNot
            ? T('pl.loot-zones.save.failedWhy', 'Save failed: {why}', { why: whyNot })
            : T('pl.loot-zones.save.failed', 'Save failed'));
          return;
        }
        state.cfg = r.config; unsaved = false;
        if ((r.warnings || []).length) r.warnings.forEach(function (w) { SSA.toast(w); });
        else SSA.toast(T('pl.loot-zones.save.done', 'Saved'));
        render();
      })
      .catch(failed(T('pl.loot-zones.fail.save', 'Not saved')));
  }

  /**
   * Put everything back to the last save.
   *
   * ⚠ **NOTHING ON THIS PAGE COULD BE TAKEN BACK.** A zone removed, a guard removed, a message
   * rewritten — all of them live only in the browser until Save, and the only way out was to know
   * that and reload the page by hand. So the delete confirmations can now honestly say a removal is
   * undoable, which is what makes them safe to press.
   */
  function discard() {
    return Promise.resolve(SSA.confirm(T('pl.loot-zones.discard.confirm',
      'Throw away every change since the last save?\n\nThe server is not affected.')))
      .then(function (yes) {
        if (!yes) return null;
        unsaved = false;
        SSA.toast(T('pl.loot-zones.discard.done', 'Back to the saved settings'));
        return refresh();
      });
  }

  /**
   * Did this answer come from the plugin, or from `api()` giving up?
   *
   * `api()` turns any failed fetch into `{}` — which is TRUTHY, so "the backend never answered"
   * and "the backend answered with nothing" arrive here as the same value. They are opposites, and
   * telling them apart is the difference between a screen that says what is wrong and a blank tab.
   */
  var OWN_KEYS = ['enabled', 'rotation', 'zone', 'zones', 'messages', 'sentries', 'setsDir',
    'maxActive', 'minMinutesBetweenSwitches', 'chatChannel'];
  function looksLikeConfig(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    // The WEAKER claim on purpose. Asking for the newest keys turned a config from an older deployed
    // backend — an ordinary state while an update lands — into "this tab could not read its
    // settings", which is a different fault with a different fix. An empty object carries none of
    // these, and an empty object is exactly what `api()` makes of a fetch that failed.
    for (var i = 0; i < OWN_KEYS.length; i++) if (OWN_KEYS[i] in v) return true;
    return false;
  }

  /**
   * Which clock a window is read on. "From 20:00" means two different things and this page must
   * never leave which one to a guess.
   *
   * ⚠ ON ITS OWN, and never inside the `Promise.all` the page is drawn from. A backend deployed
   * before this route existed does not answer it, and an update lands in two steps — so folding it
   * in made the whole tab depend on it and report "could not read its own settings", which is a
   * different fault with a different fix. A nicety on one note may not be able to take a page down.
   */
  function refreshClock() {
    return Promise.resolve(api('/clock'))
      .then(function (r) { state.clock = (r && r.now) ? r : null; })
      .catch(function () { state.clock = null; });
  }

  /**
   * ⚠ **A RE-RENDER EMPTIES THE ROOT, AND AN INPUT COMMITS ON `change`.**
   *
   * So anything typed and not yet blurred is not in `state.cfg` and is destroyed by a redraw, along
   * with focus and the caret — and this page redraws on a 15-second poll. `unsaved` already protects
   * the CONFIG from being overwritten; it has to protect the DOM too, which it did not.
   *
   * Live status stops updating while there are unsaved edits. That is the right way round: the
   * status is a few seconds stale and the owner's half-typed message is not recoverable.
   */
  function refresh(opts) {
    var quiet = !!(opts && opts.quiet);
    // Never on its own. Folding the clock into the page's own load made the whole tab depend on a
    // route older backends do not have; giving it its own render made every refresh redraw twice.
    refreshClock();
    refreshBridge();
    refreshActivity();
    return Promise.all([api('/config'), api('/sets'), api('/status')]).then(function (r) {
      if (!unsaved) {
        state.cfg = looksLikeConfig(r[0]) ? r[0] : null;
        broken = !looksLikeConfig(r[0]);
      }
      // Taken on every answer, whether or not the screen is being written over: it is a reading of
      // what the SERVER holds, and it stays true while the page is edited. That is the point — a zone
      // added since is exactly a zone whose id is not in it.
      if (looksLikeConfig(r[0])) {
        savedIds = (r[0].zones || []).map(function (z) { return String((z && z.id) || ''); });
      }
      state.sets = r[1];
      state.status = r[2];
      // A poll redraws only when the page would come out DIFFERENT. It used to redraw the whole tab
      // every fifteen seconds whatever the answer was, which shut an open dropdown and repainted
      // every card under the reader on a page where nothing had moved.
      if (!(quiet && unsaved)) render(quiet ? { ifChanged: true } : undefined);
    }).catch(function () {
      broken = true;
      render();
    });
  }

  /**
   * What this configuration needs switched on in the bridge, and whether it is. On its own for the same
   * reason as the clock: a backend older than the route must not take the page down.
   */
  function refreshBridge() {
    return Promise.resolve(api('/bridge-check'))
      .then(function (r) { state.bridge = (r && Array.isArray(r.items)) ? r : null; })
      .catch(function () { state.bridge = null; });
  }

  /**
   * What the island's spawn plans look like, what each zone's rectangle covers and which plans this
   * plugin is holding. On its own for the same reason as the clock and the bridge check: a backend
   * older than the route does not answer it, and a nicety on one note may not take a page down.
   *
   * ⚠ **`null` HERE IS "NOBODY HAS ANSWERED YET", AND IT IS NOT `known: false`.** The route answers
   * `known: false` with a sentence of its own when the bridge could not be asked, which is a fact
   * worth printing; `api()` turns a failed fetch into `{}`, which carries no `known` at all and is
   * silence. The two are told apart here so the screen never prints an empty sentence.
   */
  function refreshActivity() {
    return Promise.resolve(api('/activity'))
      .then(function (r) { state.activity = (r && typeof r.known === 'boolean') ? r : null; })
      .catch(function () { state.activity = null; });
  }

  /**
   * Turn on, in the bridge, exactly the switches listed — after saying what each one does.
   *
   * The manager's own route, reached with the owner's session: `confirm: true` with the names shown
   * is what lets it switch on what a plugin may only name. Nothing here runs without the click.
   */
  function turnOnInBridge(items) {
    var lines = items.map(function (x) {
      return T('pl.loot-zones.bridge.line', '• {module} → {label}{warn}', {
        module: x.moduleName,
        label: x.label,
        warn: x.danger ? T('pl.loot-zones.bridge.line.danger', '  (changes the running world)') : '',
      });
    });
    return Promise.resolve(SSA.confirm(T('pl.loot-zones.bridge.confirm',
      'Turn these on in the SSA Bridge?\n\n{lines}\n\nSwitch any off again in {where}.',
      { lines: lines.join('\n'), where: bridgeWhere() })))
      .then(function (yes) {
        if (!yes) return null;
        return fetch('/api/plugins/loot-zones/bridge-needs/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: true, only: items.map(function (x) { return x.module + '.' + x.key; }) }),
        }).then(function (r) { return r.json(); }).catch(function () { return null; });
      })
      .then(function (r) {
        if (r === null) return;
        if (!r || r.ok === false) {
          SSA.toast(r && r.error === 'bridge_ui_disabled'
            ? T('pl.loot-zones.bridge.uiDisabled', 'In-game control is switched off for this panel, so nothing was changed')
            : (r && r.error
              ? T('pl.loot-zones.bridge.changeFailedWhy', 'The bridge settings could not be changed ({why})', { why: r.error })
              : T('pl.loot-zones.bridge.changeFailed', 'The bridge settings could not be changed')));
          return;
        }
        var n = (r.applied || []).reduce(function (k, a) { return k + (a.keys || []).length; }, 0);
        SSA.toast(n
          ? T('pl.loot-zones.bridge.switched', 'Switched on {n} setting(s) in the bridge', { n: n })
          : T('pl.loot-zones.bridge.nothingNeeded', 'Nothing needed changing'));
        refreshBridge().then(render);
      });
  }

  // ── little controls ────────────────────────────────────────────────────────────────────────────
  /**
   * The panel's own switch.
   *
   * ⚠ It used to be `.lz-tg`, whose whole `on` state was `background: var(--accent)` — a token the
   * panel does not define, so the declaration never applied and a switch that was ON looked exactly
   * like a switch that was OFF. Every "this is enabled" on this page was invisible.
   *
   * `.switch` is a real checkbox underneath, so it keeps the keyboard, the label and the form
   * semantics that a `<button><span></span></button>` had none of.
   */
  function toggle(v, on, label) {
    var box = h('input', { type: 'checkbox' });
    box.checked = !!v;
    box.addEventListener('change', function () { on(box.checked); });
    return h('label', { class: 'switch' }, [box, label ? h('span', {}, label) : null]);
  }
  function txt(v, ph, on, cls) {
    var i = h('input', { class: cls || 'lz-in', type: 'text', value: v == null ? '' : String(v), placeholder: ph || '' });
    i.addEventListener('change', function () { on(i.value); });
    return typed(i);
  }
  function area(v, on) {
    var t = h('textarea', { class: 'lz-in lz-area', rows: '2' }, v == null ? '' : String(v));
    t.addEventListener('change', function () { on(t.value); });
    return typed(t);
  }
  function num(v, on, min, max) {
    var i = h('input', { class: 'lz-in lz-num', type: 'number', value: v == null ? '' : String(v) });
    if (min != null) i.min = String(min);
    if (max != null) i.max = String(max);
    // ⚠ `Number('')` IS 0. An emptied box is somebody deleting a figure, not somebody choosing
    // zero, and writing the zero is how a coordinate field becomes "aimed at the origin" — a
    // defect this tree has already paid for once on the admin console's own builder.
    i.addEventListener('change', function () {
      if (i.value === '' || !isFinite(Number(i.value))) return;
      on(Number(i.value));
    });
    return typed(i);
  }
  /**
   * A number shown in the unit a person thinks in, with that unit written beside the box.
   *
   * ⚠ **WHAT IS STORED KEEPS ITS OWN UNIT.** Distances are saved in centimetres and durations in
   * seconds, as every configuration already written has them, so `scale` converts on the way to the
   * screen and back. A box nobody touched writes nothing, so opening and saving the page never
   * rewrites a stored value.
   */
  function numIn(v, on, min, max, unit, scale, off) {
    var k = scale || 1;
    var shown = (v == null || v === '') ? '' : String(Math.round((Number(v) / k) * 100) / 100);
    var i = typed(h('input', { class: 'lz-in lz-num', type: 'number', step: 'any', value: shown }));
    if (min != null) i.min = String(min);
    if (max != null) i.max = String(max);
    // ⚠ **`off` IS ONLY EVER A PROVEN FACT ABOUT THE GAME, NEVER AN ABSENT READING.** Every caller
    // that passes it passes a confirmed verdict and nothing else, so a bridge that could not answer
    // leaves the box exactly as editable as a stopped server does — the whole page stays configurable
    // with nothing running, and only a number the game itself has made inert is taken away. The
    // reason travels beside it, or this is a control that stopped working with no explanation.
    if (off) { i.disabled = true; i.setAttribute('aria-disabled', 'true'); }
    i.addEventListener('change', function () {
      if (i.value === '' || !isFinite(Number(i.value))) return;
      on(Math.round(Number(i.value) * k));
    });
    return h('span', { class: 'lz-unitbox' }, [i, unit ? h('small', { class: 'lz-unit' }, unit) : null]);
  }
  var M = 100;      // centimetres in a metre
  var MIN = 60;     // seconds in a minute

  /**
   * The game's colour is four numbers from 0 to 1; a person picks a colour and an opacity. A value
   * over 1 is a configuration written against the old 0..255 shape and is read as what it meant.
   */
  function colourIn(col, onChange) {
    var to255 = function (v, d) { var n = (v == null ? d : Number(v)); if (!(n >= 0)) n = d; if (n > 1) n = n / 255; return Math.round(Math.max(0, Math.min(1, n)) * 255); };
    var hex = '#' + [to255(col.r, 1), to255(col.g, 0.64), to255(col.b, 0.1)]
      .map(function (n) { return ('0' + n.toString(16)).slice(-2); }).join('');
    var pick = h('input', { class: 'lz-in lz-colour', type: 'color', value: hex });
    pick.addEventListener('change', function () {
      var v = pick.value;
      col.r = Math.round(parseInt(v.slice(1, 3), 16) / 255 * 1000) / 1000;
      col.g = Math.round(parseInt(v.slice(3, 5), 16) / 255 * 1000) / 1000;
      col.b = Math.round(parseInt(v.slice(5, 7), 16) / 255 * 1000) / 1000;
      onChange();
    });
    var a = col.a == null ? 1 : Number(col.a);
    if (a > 1) a = a / 255;
    var op = h('input', { class: 'lz-in lz-num', type: 'number', min: '0', max: '100', step: '1', value: String(Math.round(a * 100)) });
    op.addEventListener('change', function () {
      if (op.value === '' || !isFinite(Number(op.value))) return;
      col.a = Math.round(Math.max(0, Math.min(100, Number(op.value)))) / 100;
      onChange();
    });
    return h('div', { class: 'lz-routes' }, [pick, h('small', {}, T('pl.loot-zones.colour.opacity', 'Opacity')),
      h('span', { class: 'lz-unitbox' }, [op, h('small', { class: 'lz-unit' }, '%')])]);
  }

  function sel(v, opts, on) {
    var s = h('select', { class: 'lz-in' }, opts.map(function (o) {
      var e = h('option', { value: o[0] }, o[1]);
      if (String(o[0]) === String(v)) e.selected = true;
      return e;
    }));
    s.addEventListener('change', function () { on(s.value); });
    return s;
  }
  /** A choice that reads as a word rather than as a bare box. */
  function check(label, v, on) {
    var b = h('button', { class: 'lz-chk' + (v ? ' on' : ''), type: 'button' }, [icon(v ? 'check' : 'close'), h('span', {}, label)]);
    b.addEventListener('click', function () { on(!v); });
    return b;
  }
  // Spawn code -> class path for the build this was packaged against, fetched once. A code that is
  // not in it is answered as not in it: the box stays typeable and nothing is guessed.
  var classTable = null;
  function guardClasses() {
    if (classTable) return Promise.resolve(classTable);
    return api('/guard-classes').then(function (r) {
      classTable = (r && r.classes) ? r : { classes: {}, kinds: {} };
      return classTable;
    });
  }

  function canPick() {
    return typeof SSA.pickItem === 'function' && (!SSA.canPickItem || SSA.canPickItem());
  }



  /**
   * One settings row: the label, the sentence that explains it, and the control.
   *
   * The hint sits under the LABEL, which is where the panel's own settings screens put it. Under the
   * control it pushes the next row's control out of line with this one, and a column of controls
   * that does not line up is most of what "everything runs together" looks like.
   */
  function row(label, control, hint) {
    // The explanation is one click away rather than always open: a page where every control carries a
    // paragraph is a page nobody can find a control on. The label plus the zone it belongs to is the
    // key, so it stays open across the redraws a change causes and does NOT open the same paragraph
    // on every other zone, which is what keying on the label alone did.
    var key = hintScope + '|' + label;
    var tag = h('label', {}, [label]);
    var node = h('div', { class: 'lz-row' }, [tag, h('div', { class: 'lz-ctl' }, [control])]);
    if (!hint) return node;
    /**
     * ⚠ **OPENING AN EXPLANATION USED TO REBUILD THE WHOLE TAB.** It is the most-pressed control on
     * this page and it changes exactly one paragraph, so a full redraw for it threw away the
     * reader's scroll position and every open dropdown to answer "what does this do?".
     *
     * The paragraph is APPENDED rather than inserted in the middle, and that is safe rather than
     * sloppy: `.lz-row` is a grid and `.lz-hint` names `grid-area: desc`, in both the wide and the
     * narrow layout — so where it sits in the markup decides nothing about where it is drawn.
     */
    var live = null;
    var q = h('button', { class: 'lz-q', type: 'button' }, '?');
    var paint = function () {
      var open = !!openHints[key];
      q.className = 'lz-q' + (open ? ' on' : '');
      q.setAttribute('title', open ? T('pl.loot-zones.hint.hide', 'Hide the explanation')
        : T('pl.loot-zones.hint.show', 'What does this do?'));
      if (open && !live) { live = h('p', { class: 'lz-hint' }, hint); node.appendChild(live); }
      else if (!open && live) { node.removeChild(live); live = null; }
    };
    q.addEventListener('click', function () { openHints[key] = !openHints[key]; paint(); });
    tag.appendChild(q);
    paint();
    return node;
  }
  /**
   * Rows an owner rarely needs, folded under one line that stays open across redraws once opened.
   *
   * `openAt` is what it opens on the FIRST visit, and it exists for one case: a fold whose contents
   * are the reason this row is different from its neighbours. A guard that does not follow its zone
   * is exactly that, and leaving the difference behind a click is leaving an owner to hunt for the
   * thing the block was built to show. A viewer who shuts it keeps it shut — `openMore` is only
   * written by the toggle, so a decision beats a default and absent is not the same as false.
   */
  function more(key, title, kids, openAt) {
    var d = h('details', { class: 'lz-more' }, [h('summary', {}, title)].concat(kids.filter(Boolean)));
    if (openMore[key] === undefined ? !!openAt : openMore[key]) d.open = true;
    d.addEventListener('toggle', function () { openMore[key] = d.open; });
    return d;
  }
  /**
   * A long explanation, one click below the control instead of in front of it.
   *
   * ⚠ **AN EXPLANATION THAT IS ALWAYS ON THE SCREEN IS NOT AN EXPLANATION, IT IS THE SCREEN.** Every
   * paragraph this page used to print above a control pushed the next control further down, and a
   * column of settings nobody can scan is a column nobody configures. What decides something stays
   * visible — a label, a unit, a count, a warning that stops somebody breaking their server. What
   * merely explains goes in here.
   *
   * Strings become paragraphs; nodes are taken as they are, so a list or a note can be folded too.
   */
  function why(key, kids, title) {
    var list = (kids || []).filter(Boolean).map(function (x) {
      return typeof x === 'string' ? h('p', { class: 'lz-lead' }, x) : x;
    });
    if (!list.length) return null;
    var d = more('why:' + key, title || T('pl.loot-zones.why', 'How this works'), list);
    d.className = 'lz-more lz-why';
    return d;
  }
  /**
   * A ⚠ sentence is a warning and stays on the screen; everything else in the same list is working
   * and folds away.
   *
   * ⚠ **THE TEST IS THE SENTENCE'S OWN FIRST CHARACTER, NOT A SECOND LIST SOMEWHERE.** Every one of
   * these strings already opens with the mark where it means it, in all eighteen languages, because
   * the mark is outside the translated part of nothing — it is the first thing the key's own value
   * says. A parallel list of "which of these are warnings" would be the two-lists-of-one-thing shape
   * this project keeps paying for, and it would drift the first time somebody adds a sentence.
   */
  function isWarn(s) { return String(s || '').charAt(0) === '⚠'; }
  /** '' is a plain fact and gets no wash, so 'good' / 'bad' / 'wait' keep their meaning. */
  function note(kind, text) { return h('div', { class: 'lz-note ' + (kind || 'flat') }, text); }
  /**
   * A section.
   *
   * `class="card lz-card"` — the panel's own box, which is what five of the other six plugins do and
   * what the panel's own comment asks for. Its ground, border, radius and padding are then the ones
   * every other box on the screen has, rather than a set of pixel values of this plugin's own that
   * came out a third tighter than everything around them.
   *
   * `lead` is one sentence saying what the section is for. A page of sections reads; a page of rows
   * does not.
   */
  function card(ico, title, lead, kids) {
    return h('section', { class: 'card lz-card' },
      [h('h3', {}, [icon(ico), title]), lead ? h('p', { class: 'lz-lead' }, lead) : null]
        .concat(kids.filter(Boolean)));
  }
  var metres = function (cm) { return Math.round((cm || 0) / 100); };

  // ── the four messages ──────────────────────────────────────────────────────────────────────────
  //
  // They differ in two ways only — which tokens they carry, and whether they go to one player or to
  // everybody — so this is one renderer with those two facts passed in, rather than four blocks that
  // drift apart the first time somebody edits one of them.
  var MESSAGES = [
    { key: 'activate', broadcast: true, tokens: ['zone', 'set'] },
    { key: 'deactivate', broadcast: true, tokens: ['zone', 'set'] },
    { key: 'join', broadcast: false, tokens: ['player', 'zones', 'zone', 'count'] },
    { key: 'reminder', broadcast: true, tokens: ['zones', 'zone', 'count'] },
  ];
  /**
   * ⚠ The title and the hint are FUNCTIONS with a literal key in each branch, not fields on the
   * table above. A key built as `'pl.loot-zones.msg.' + def.key` is invisible to anything reading
   * this file, so every translation of it would be reported as a word nobody asks for — and a
   * missing one would never be reported at all.
   */
  function messageTitle(k) {
    if (k === 'activate') return T('pl.loot-zones.msg.activate', 'When a zone opens');
    if (k === 'deactivate') return T('pl.loot-zones.msg.deactivate', 'When a zone closes');
    if (k === 'join') return T('pl.loot-zones.msg.join', 'To a player logging in');
    return T('pl.loot-zones.msg.reminder', 'While a zone is running');
  }
  function messageHint(k) {
    if (k === 'activate') return T('pl.loot-zones.msg.activate.hint', 'Sent once, the moment the loot changes.');
    if (k === 'deactivate') return T('pl.loot-zones.msg.deactivate.hint', 'Sent as the loot goes back to normal.');
    if (k === 'join') return T('pl.loot-zones.msg.join.hint', 'Reaches that player alone, and only while something is really live.');
    return T('pl.loot-zones.msg.reminder.hint', 'For anyone who was not on when it opened.');
  }

  /** What each token stands in for, in the reader's words rather than as a bare brace. */
  function tokenMeans(tok) {
    if (tok === 'zone') return T('pl.loot-zones.token.zone', 'the zone\'s name');
    if (tok === 'zones') return T('pl.loot-zones.token.zones', 'every zone that is live, listed');
    if (tok === 'set') return T('pl.loot-zones.token.set', 'the loot set behind it');
    if (tok === 'player') return T('pl.loot-zones.token.player', 'the player being written to');
    if (tok === 'count') return T('pl.loot-zones.token.count', 'how many zones are live');
    return null;
  }

  function messageBlock(def, c) {
    var m = (c.messages || {})[def.key] || {};
    /**
     * ⚠ **A MESSAGE THAT IS SWITCHED OFF OPENS FOLDED, AND A DECISION STILL BEATS THAT.** All four
     * drew themselves open — four text boxes, four token strips, four route rows and eight
     * explanations — so the card was a page of its own whether an owner used one message or all of
     * them. The head keeps the switch, the name and the on/off pill, which is everything needed to
     * decide whether to open it. `shut` is written only by the fold control.
     */
    var k = 'm-' + def.key;
    var folded = Object.prototype.hasOwnProperty.call(shut, k) ? !!shut[k] : !m.enabled;
    var head = h('div', { class: 'lz-zhead' }, [
      toggle(!!m.enabled, function (v) { m.enabled = v; markDirty(); }),
      h('button', {
        class: 'lz-link', type: 'button',
        onclick: function () { shut[k] = !folded; render(); },
      }, messageTitle(def.key)),
      h('span', { class: 'lz-badge' + (m.enabled ? ' on' : '') },
        m.enabled ? T('pl.loot-zones.badge.on', 'on') : T('pl.loot-zones.badge.off', 'off')),
    ]);
    if (folded) return h('div', { class: 'lz-zone' }, [head]);

    /**
     * ⚠ **THE TOKENS WERE ONLY EVER WRITTEN IN A PARAGRAPH THAT IS FOLDED AWAY.** `{zone}` and its
     * four siblings are the whole reason this text box is not a plain string, and the only mention of
     * them on the page was inside the `?` explanation, which is shut until somebody opens it. So a
     * message written by anybody who did not press `?` carries no token at all.
     *
     * Each chip puts its token in at the caret, and does it WITHOUT redrawing the page: a redraw
     * destroys the textarea the owner is typing in. `mousedown` is cancelled so the box never loses
     * focus in the first place, which also means its own `change` does not fire and fight this.
     */
    var box = area(m.text, function (v) { m.text = v; markDirty(); });
    var tokenChips = h('div', { class: 'lz-chips' }, [h('small', {}, T('pl.loot-zones.msg.putIn', 'Put in:'))].concat(
      def.tokens.map(function (tok) {
        // ⚠ The token itself is NOT translated: it is written into the message template and the
        // backend substitutes it by name, so a translated brace would reach players as itself.
        var word = '{' + tok + '}';
        var b = h('button', { class: 'lz-chk', type: 'button', title: tokenMeans(tok) || word },
          [h('span', {}, word)]);
        b.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
        b.addEventListener('click', function () {
          var here = document.activeElement === box;
          var s = here ? box.selectionStart : box.value.length;
          var e = here ? box.selectionEnd : s;
          box.value = box.value.slice(0, s) + word + box.value.slice(e);
          try { box.selectionStart = box.selectionEnd = s + word.length; } catch (ignored) { /* not selectable */ }
          box.focus();
          m.text = box.value;
          dirtyOnly();
        });
        return b;
      })));

    return h('div', { class: 'lz-zone' }, [
      head,
      row(T('pl.loot-zones.msg.text', 'What it says'), h('div', { class: 'lz-ctl' }, [box, tokenChips,
        h('small', {}, def.tokens.map(function (t) {
          return T('pl.loot-zones.token.pair', '{token} = {means}', { token: '{' + t + '}', means: tokenMeans(t) || t });
        }).join(' · '))]),
        T('pl.loot-zones.msg.text.hint', 'Leave it empty to switch this message off however the routes are set.')),
      row(T('pl.loot-zones.msg.routes', 'Where it goes'), h('div', { class: 'lz-routes' }, [
        check(T('pl.loot-zones.route.chat', 'Chat'), !!m.chat, function (v) { m.chat = v; markDirty(); }),
        check(T('pl.loot-zones.route.hud', 'On screen'), !!m.hud, function (v) { m.hud = v; markDirty(); }),
        check(T('pl.loot-zones.route.alert', 'With a sound'), !!m.alert, function (v) { m.alert = v; markDirty(); }),
        check(T('pl.loot-zones.route.killFeed', 'Kill feed'), !!m.killFeed, function (v) { m.killFeed = v; markDirty(); }),
        // ⚠ Not offered for the join message: that one goes to ONE player and the history is public.
        def.broadcast ? check(T('pl.loot-zones.route.history', 'Chat history'), !!m.history, function (v) { m.history = v; markDirty(); }) : null,
      ]),
        // ⚠ ONE WHOLE SENTENCE PER CASE, not a shared middle clause bolted onto two different ends.
        // The two differ in what they claim about who receives the line, and a fragment stitched into
        // both is a fragment a translator has to make true of both at once.
        (def.broadcast
          ? T('pl.loot-zones.msg.routes.hint.all',
            'Screen lines scroll away; kill-feed lines stay. No colours. Chat history also logs it.')
          : T('pl.loot-zones.msg.routes.hint.one',
            'Reaches only that player. Sound comes with a kill-feed entry. No colours or history.'))),
      def.key === 'join' ? row(T('pl.loot-zones.msg.delay', 'Wait before sending'),
        numIn(m.delaySeconds, function (v) { m.delaySeconds = v; markDirty(); }, 0, 300, T('pl.loot-zones.unit.seconds', 'seconds')),
        T('pl.loot-zones.msg.delay.hint', 'A player who just joined is still loading and would miss the line.')) : null,
      def.key === 'reminder' ? row(T('pl.loot-zones.msg.every', 'How often'),
        numIn(m.everyMinutes, function (v) { m.everyMinutes = v; markDirty(); }, 1, 1440, T('pl.loot-zones.unit.minutes', 'minutes')),
        T('pl.loot-zones.msg.every.hint', 'Counted from the moment a zone went live, and never less than one.')) : null,
      h('div', { class: 'lz-actions' }, [
        h('button', {
          class: 'secondary', type: 'button', onclick: function () {
            // The backend sends what is SAVED, so an edit not saved yet is not what goes out.
            var saved = unsaved ? T('pl.loot-zones.test.saved', ' This is the saved text: save to try your changes.') : '';
            api('/test-message', { method: 'POST', body: { which: def.key } })
              .then(function (r) {
                if (r && r.sent === false) {
                  SSA.toast(T('pl.loot-zones.test.nothingSent', 'Nothing was sent: {why}.{saved}', {
                    why: r.why || T('pl.loot-zones.test.noRoute', 'no route reached the game'), saved: saved,
                  }));
                  return;
                }
                var bad = (r && r.failed) || [];
                SSA.toast(bad.length
                  ? T('pl.loot-zones.test.partly', 'Sent, but {n} route(s) did not arrive: {list}.{saved}',
                    { n: bad.length, list: bad.join('; '), saved: saved })
                  : T('pl.loot-zones.test.sent', 'Sent.{saved}', { saved: saved }));
              })
              .catch(failed(T('pl.loot-zones.fail.send', 'Not sent')));
          },
        }, [icon('play'), T('pl.loot-zones.test.button', 'Try it in game')]),
        h('small', {}, messageHint(def.key)),
      ]),
    ]);
  }

  /**
   * ⚠ **1 IS MONDAY AND 7 IS SUNDAY.**
   *
   * These are the numbers `timeWindows.js` reads, and this screen wrote 0..6 for as long as it
   * existed — placeholder, filter and the list "Add a time" seeded, all three. A Sunday written as 0
   * is a window the evaluator REFUSES, and it treats a refused window as CLOSED: the zone never came
   * on and nothing said why. A weekend written "5,6" was Friday and Saturday.
   *
   * Buttons rather than a typed list, so the vocabulary is not something an owner can be wrong about.
   */
  var DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];
  /**
   * The day's name on the button. The NUMBER above is the evaluator's and is never translated; only
   * the three letters a reader sees are, and each one is written literally at its own key so the
   * checker can see all seven.
   */
  function dayName(n) {
    if (n === 1) return T('pl.loot-zones.day.1', 'Mon');
    if (n === 2) return T('pl.loot-zones.day.2', 'Tue');
    if (n === 3) return T('pl.loot-zones.day.3', 'Wed');
    if (n === 4) return T('pl.loot-zones.day.4', 'Thu');
    if (n === 5) return T('pl.loot-zones.day.5', 'Fri');
    if (n === 6) return T('pl.loot-zones.day.6', 'Sat');
    return T('pl.loot-zones.day.7', 'Sun');
  }

  /** Every day, in the evaluator's numbers. Used by "Add a time" and by "All week". */
  function allDays() { return DAYS.map(function (d) { return d[0]; }); }

  function dayPicker(win) {
    var listed = Array.isArray(win.days) ? win.days.map(Number).filter(function (n) { return n >= 1 && n <= 7; }) : [];
    // ⚠ AN EMPTY LIST MEANS EVERY DAY. That is the evaluator's rule — `days.length === 0` is
    // unrestricted — so seven grey buttons were a zone open all week, with nothing to say so. Drawing
    // empty as all-on makes the picker say what the setting means; turning one off then writes the
    // other six, and turning the last one off comes back round to every day, which is the only other
    // thing "no days" can honestly be.
    var on = listed.length ? listed : DAYS.map(function (d) { return d[0]; });
    return h('div', { class: 'lz-days' }, DAYS.map(function (d) {
      var picked = on.indexOf(d[0]) >= 0;
      return h('button', {
        class: 'lz-day' + (picked ? ' on' : ''), type: 'button',
        title: picked ? T('pl.loot-zones.day.off', 'Not on {day}', { day: dayName(d[0]) })
          : T('pl.loot-zones.day.on', 'Also on {day}', { day: dayName(d[0]) }),
        onclick: function () {
          var next = picked ? on.filter(function (x) { return x !== d[0]; }) : on.concat([d[0]]);
          next.sort(function (a, b) { return a - b; });
          // All seven, and none at all, are the same thing to the evaluator. Storing the empty form
          // keeps the config honest about "not restricted" rather than listing every day.
          win.days = (next.length === 0 || next.length === 7) ? [] : next;
          markDirty();
        },
      }, dayName(d[0]));
    }));
  }

  /**
   * A zone's schedule, plus what the evaluator makes of it right now.
   *
   * The verdict is READ from the backend rather than worked out here: `host.time` is the manager's
   * one evaluator, it already knows what "Friday 22:00 to 02:00" means at one in the morning, and a
   * second reading of that on this screen would be a second set of edge cases to get wrong.
   */
  function scheduleBlock(z, st) {
    var w = Array.isArray(z.windows) ? z.windows : (z.windows = []);
    var v = (st.schedule || {})[String(z.id)] || null;

    /**
     * ⚠ **"CLOSED" AND "REFUSED" ARE DIFFERENT CLAIMS AND GET DIFFERENT KEYS.** A window that is
     * shut right now is a zone working exactly as it was set up; a window the evaluator could not
     * read at all is a zone that will never come on. Reusing one sentence for both would tell an
     * owner their schedule is running when it has been thrown away, or the reverse.
     */
    var verdict = null;
    if (v && (v.errors || []).length) {
      verdict = note('bad', T('pl.loot-zones.sched.refused', 'This zone stays OFF: {why}', { why: v.errors.join(' ') }));
    } else if (v && v.unscheduled) {
      verdict = note('', T('pl.loot-zones.sched.none',
        'No times set, so this zone is on whenever rotation runs.'));
    } else if (v) {
      var detail = v.text ? T('pl.loot-zones.sched.detail', ' — {text}', { text: v.text }) : '';
      verdict = note(v.open ? 'good' : 'wait', v.open
        ? (v.closesInMinutes != null
          ? T('pl.loot-zones.sched.open.closes', 'Open now{detail}. It closes in {t}.',
            { detail: detail, t: humanMins(v.closesInMinutes) })
          : T('pl.loot-zones.sched.open', 'Open now{detail}', { detail: detail }))
        : (v.opensInMinutes != null
          ? T('pl.loot-zones.sched.closed.opens', 'Closed now{detail}. It opens in {t}.',
            { detail: detail, t: humanMins(v.opensInMinutes) })
          : T('pl.loot-zones.sched.closed', 'Closed now{detail}', { detail: detail })));
    }

    return h('div', { class: 'lz-when' }, [
      h('h4', { class: 'lz-group' }, T('pl.loot-zones.sched.title', 'When it is on')),
      verdict,
      why('sched:' + z.id, [T('pl.loot-zones.sched.clock',
        'Server clock, not the game\'s. A time past midnight belongs to its start day.')]),
    ].concat(w.map(function (win, wi) {
      return h('div', { class: 'lz-win' }, [
        dayPicker(win),
        txt(win.from, '20:00', function (val) { win.from = val; markDirty(); }),
        h('span', { class: 'lz-win-sep' }, T('pl.loot-zones.sched.to', 'to')),
        txt(win.to, '23:00', function (val) { win.to = val; markDirty(); }),
        h('button', {
          class: 'lz-del', type: 'button', title: T('pl.loot-zones.sched.remove', 'Remove this time'),
          onclick: function () { w.splice(wi, 1); markDirty(); },
        }, [icon('close')]),
      ]);
    })).concat([
      h('div', { class: 'lz-actions' }, [
        h('button', {
          class: 'secondary', type: 'button', onclick: function () {
            w.push({ days: allDays(), from: '20:00', to: '23:00' });
            markDirty();
          },
        }, [icon('clock'), T('pl.loot-zones.sched.add', 'Add a time')]),
        // All day is what an owner asks for by name, and 00:00 to 00:00 is exactly the shape the
        // evaluator refuses as ambiguous — so the button writes the one that works.
        h('button', {
          class: 'secondary', type: 'button', onclick: function () {
            w.push({ days: allDays(), from: '00:00', to: '23:59' });
            markDirty();
          },
        }, [icon('clock'), T('pl.loot-zones.sched.addDay', 'Add a whole day')]),
      ]),
    ]));
  }

  /** A unix time as something a person reads: "at 04:00, in about 3 hours". */
  function whenPhrase(unix) {
    var d = new Date(Number(unix) * 1000);
    if (!(d.getTime() > 0)) return T('pl.loot-zones.when.scheduled', 'scheduled');
    var mins = Math.round((d.getTime() - Date.now()) / 60000);
    var at = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return mins > 0 ? T('pl.loot-zones.when.atIn', 'at {at}, in about {t}', { at: at, t: humanMins(mins) })
      : T('pl.loot-zones.when.at', 'at {at}', { at: at });
  }

  /** "40 minutes", "3 hours", "2 days" — the same shape the evaluator's own sentences use. */
  function humanMins(m) {
    var n = Math.max(0, Math.round(Number(m) || 0));
    if (n < 60) return nMinutes(n);
    if (n < 1440) return nHours(Math.round(n / 60));
    return nDays(Math.round(n / 1440));
  }

  // ── copying a zone ─────────────────────────────────────────────────────────────────────────────
  /**
   * A name no other zone on the page has.
   *
   * ⚠ **THE PREFIX PLUS THE NAME IS THE ZONE'S NAME IN THE GAME**, and the plugin finds its own zones
   * by that name — so two zones called the same thing are ONE zone to the server, and whichever is
   * written second is the one that exists. A copy that simply appends "(copy)" collides with itself
   * the second time it is pressed, which is the commonest way to reach that state.
   */
  function uniqueZoneName(zones, stem) {
    var taken = {};
    (zones || []).forEach(function (x) {
      taken[String((x && x.name) || '').trim().toLowerCase()] = true;
    });
    var base = String(stem || '').trim() || 'Zone';
    var want = base + ' (copy)';
    for (var n = 2; taken[want.toLowerCase()]; n++) want = base + ' (copy ' + n + ')';
    return want;
  }

  /**
   * A copy of a zone that is a zone of its own, and nothing it shares with the one it came from.
   *
   * Three things this gets right that a copy usually does not:
   *
   *   **Nothing is shared by reference.** A JSON round trip, so the guard list, every guard's own
   *   settings, the schedule windows and the colour block are all new objects. An edit to the copy
   *   cannot reach back into its source, which is the defect this always ships with — the two look
   *   independent until somebody changes one and both move.
   *
   *   **The guards are MATERIALISED into it.** A zone that has never been opened on this page carries
   *   no `sentries` block of its own; it follows the page's own copy. Copying only what the object
   *   holds would give the copy nothing either — so the two would agree today and drift the moment
   *   the source's own block is written. The copy is given exactly what its source really follows
   *   right now.
   *
   *   **The name cannot collide**, above.
   *
   * ⚠ **WHAT IS DELIBERATELY NOT COPIED: whether it is switched on.** The loot set comes across,
   * which means the copy would draw the SAME RECTANGLE under a second name, and two of those live at
   * once is a zone that fights itself. A copy therefore arrives off, and the toast says the one thing
   * to change before switching it on. Nothing else is held back: a copy that quietly dropped the
   * guards or the schedule would be a copy of the parts somebody happened to think of.
   */
  function duplicateZone(z, i, c) {
    var copy = JSON.parse(JSON.stringify(z));
    copy.sentries = JSON.parse(JSON.stringify(z.sentries || c.sentries || {}));
    // Same reasoning for how busy the zone is: a zone that has never been opened on this page
    // carries no `activity` block of its own and follows the page's copy, so a copy that took only
    // what the object HOLDS would agree today and drift the moment its source's own block is
    // written. The copy is given exactly what its source really follows right now.
    copy.activity = JSON.parse(JSON.stringify(z.activity || c.activity || {}));
    // Two presses inside one millisecond gave one id, and two zones with one id are one zone to every
    // route on the backend.
    copy.id = 'z' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 46656).toString(36);
    copy.name = uniqueZoneName(c.zones, z.name || z.set || 'Zone');
    copy.enabled = false;
    c.zones.splice(i + 1, 0, copy);
    shut['z-' + copy.id] = false;      // opened, so what was copied is in front of whoever pressed it
    markDirty();
    // The two NAMES are values — a zone's name is what the game calls it — so they travel as vars.
    SSA.toast(T('pl.loot-zones.zone.copied',
      'Copied as "{name}", off, sharing "{from}"\'s loot set. Give it its own.',
      { name: copy.name, from: z.name || z.set || T('pl.loot-zones.zone.theOriginal', 'the original') }));
  }

  // ── where the zone is, and how big ─────────────────────────────────────────────────────────────
  /**
   * ⚠ **A RECTANGLE'S SIZE IS HALF ITS SPAN, AND THIS PRODUCT HAS ALREADY SHIPPED EVERY RECTANGLE AT
   * TWICE THE SIZE SOMEBODY ASKED FOR BY FORGETTING IT.** The game stores the distance from the
   * CENTRE to the edge, exactly as a circle stores a radius — so a zone meant to be 400 m across is
   * 20000, not 40000.
   *
   * There is no way to make that safe with a label alone, so the screen says it three ways at once:
   * the label names the half ("centre to the edge"), the unit is on the box, and the caption under
   * every box turns the number back into the span a person measures — *"20000 cm · 400 m across"*.
   * A reader who types the whole width sees 800 m under it immediately.
   */
  /**
   * ⚠ **THE SAME CEILINGS THE BACKEND REFUSES AT, SO A BOX CANNOT ACCEPT WHAT THE SAVE WILL NOT.**
   * A field whose own `max` is tighter than the rule behind it takes a value away that is really
   * allowed; one that is looser lets somebody type a zone the backend then refuses, minutes later,
   * in a sentence about a number they cannot see any more. 20 km is half the island's own span.
   */
  var HALF_MAX = 2000000;   // centimetres, half-span or radius
  function areaOf(z) { return (z.area && typeof z.area === 'object') ? z.area : {}; }
  /** The same object, created to be written into. Never called while merely drawing. */
  function areaWrite(z) {
    if (!z.area || typeof z.area !== 'object') z.area = { mode: 'file' };
    return z.area;
  }
  function areaCustom(z) { return areaOf(z).mode === 'custom'; }
  /**
   * The zone's own numbers as the rest of this page already speaks about a rectangle: a centre and a
   * WHOLE span, which is what the loot set's `Zones.json` reader produces too.
   *
   * ⚠ **THE DOUBLING IS DONE HERE, ONCE.** `sizeX` and `radius` are half-spans, and every reader of
   * a rectangle on this page — the sweep the bridge will accept, the facts line, the summary — wants
   * the whole one. A second place that remembered to double would be a second place that could
   * forget, which is exactly how this product shipped every rectangle at twice its size.
   */
  function customRect(z) {
    var a = areaOf(z);
    if (!isFinite(Number(a.x)) || !isFinite(Number(a.y)) || a.x == null || a.y == null) return null;
    var half = a.shape === 'circle' ? Number(a.radius) : null;
    var w = half != null ? half * 2 : Number(a.sizeX) * 2;
    var hgt = half != null ? half * 2 : Number(a.sizeY) * 2;
    if (!(w > 0) || !(hgt > 0)) return null;
    return { x: Number(a.x), y: Number(a.y), width: w, height: hgt };
  }
  /** The rectangle this zone really covers — the owner's own where they set one, the set's where not. */
  function zoneRectSource(z, set) {
    if (!areaCustom(z)) return set;
    var r = customRect(z);
    if (!r) return { ok: false, why: null, rects: [] };
    return { ok: true, why: null, rects: [r], presets: (set && set.presets) || 0 };
  }
  /** A half-span in centimetres, said as the distance a person would pace out. */
  function acrossText(halfCm) {
    var n = Number(halfCm);
    if (!isFinite(n) || n <= 0) return T('pl.loot-zones.area.acrossNone', 'nothing yet');
    return T('pl.loot-zones.area.across', '{cm} cm · {m} m across', { cm: Math.round(n), m: metres(n * 2) });
  }
  /**
   * ── WHAT THE GAME SAYS ABOUT AN AREA SOMEBODY TYPED ────────────────────────────────────────────
   *
   * ⚠ **A VERDICT BELONGS TO THE NUMBERS IT WAS TAKEN AT.** Keyed on the area's own values, exactly
   * as a guard's spot check is: change a digit and yesterday's answer is simply no longer about this
   * area, rather than sitting under a number nobody has re-checked. Per visit, never saved.
   */
  var areaSaid = {};
  function areaKey(z) {
    var a = areaOf(z);
    return [z.id, a.mode, a.shape, a.x, a.y, a.sizeX, a.sizeY, a.radius].join('|');
  }
  /** Square metres, with a thousands gap a reader can count. */
  function sqm(n) {
    var v = Math.max(0, Math.round(Number(n) || 0));
    return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }
  function areaVerdict(said) {
    if (said === 'asking') return [note('', T('pl.loot-zones.area.checking', 'Asking the game about this area…'))];
    if (!said) return [];
    var out = [];
    /**
     * ⚠ **THREE ANSWERS, AND THE MIDDLE ONE IS NOT A REFUSAL.** `onMap` is true, false, or null for
     * a question the game could not be asked — a server that is not running, a bridge that is off.
     * Painting that third one red tells an owner their correct coordinate is wrong and sends them
     * to change the one thing that was right, which is the rule this page already keeps for a
     * guard's own spot.
     */
    if (said.ok === false) {
      out.push(note('bad', String(said.why || '')));
    } else if (said.onMap === false) {
      out.push(note('bad', T('pl.loot-zones.area.check.off', '⚠ The game says this is off the map. {why}',
        { why: said.why ? String(said.why) : '' })));
    } else if (said.onMap === true) {
      out.push(note('good', T('pl.loot-zones.area.check.ok', 'The game takes this area.')));
    } else {
      out.push(note('wait', T('pl.loot-zones.area.check.unknown',
        'These numbers could not be checked. {why} They are kept as typed.', { why: said.onMapWhy ? String(said.onMapWhy) : '' })));
    }
    /**
     * ⚠ **THE LOOT DOES NOT GROW WITH THE RECTANGLE, AND NOTHING ELSE ON THIS PAGE SAYS SO.** The
     * area decides what players SEE and what the zone sweeps; the loot files still cover whatever
     * ground the set's own Zones.json covers. An area drawn four times the size is four times the
     * circle with the same loot in one corner of it, and the owner should meet that here rather
     * than on the map.
     */
    if (said.drawnSquareMetres != null) {
      out.push(note('', said.lootSquareMetres != null
        ? T('pl.loot-zones.area.check.loot',
          'Drawn: {drawn} m². The loot set covers {loot} m²; the rest gets ordinary loot.',
          { drawn: sqm(said.drawnSquareMetres), loot: sqm(said.lootSquareMetres) })
        : T('pl.loot-zones.area.check.lootUnknown',
          'You have drawn {drawn} m². How much ground the loot itself covers could not be read. {why}',
          { drawn: sqm(said.drawnSquareMetres), why: said.lootWhy ? String(said.lootWhy) : '' })));
    }
    return out;
  }

  /** The zone as the config now holds it, or null while it still follows the loot set. */
  function zoneAgain(id) {
    var c = state.cfg;
    return ((c && c.zones) || []).filter(function (x) { return String(x && x.id) === String(id); })[0] || null;
  }

  function areaBlock(z, set, pat) {
    var a = areaOf(z);
    var custom = a.mode === 'custom';
    var shape = a.shape === 'circle' ? 'circle' : 'rect';
    var fileRect = ((set && set.ok && set.rects) || [])[0] || null;

    /**
     * Switching to numbers of your own SEEDS them from the loot set's own rectangle, so the first
     * thing the boxes say is what the zone already was. An owner then nudges it instead of starting
     * from zeros — and a zone that was 400 m across cannot silently become a point at the origin.
     */
    var toCustom = function () {
      var w = areaWrite(z);
      w.mode = 'custom';
      if (w.shape !== 'circle') w.shape = 'rect';
      if (fileRect) {
        if (w.x == null) w.x = Math.round(Number(fileRect.x) || 0);
        if (w.y == null) w.y = Math.round(Number(fileRect.y) || 0);
        if (!(Number(w.sizeX) > 0)) w.sizeX = Math.round(Math.abs(Number(fileRect.width) || 0) / 2);
        if (!(Number(w.sizeY) > 0)) w.sizeY = Math.round(Math.abs(Number(fileRect.height) || 0) / 2);
        if (!(Number(w.radius) > 0)) {
          w.radius = Math.round(Math.max(Math.abs(Number(fileRect.width) || 0),
            Math.abs(Number(fileRect.height) || 0)) / 2);
        }
      }
      markDirty();
    };

    var rows = [row(T('pl.loot-zones.area.mode', 'Take the area from'), sel(custom ? 'custom' : 'file', [
      ['file', T('pl.loot-zones.area.mode.file', 'From the loot set\'s own Zones.json')],
      ['custom', T('pl.loot-zones.area.mode.custom', 'Numbers of my own')],
    ], function (v) {
      if (v === 'custom') { toCustom(); return; }
      areaWrite(z).mode = 'file';
      markDirty();
    }), T('pl.loot-zones.area.mode.hint',
      'By default players see the loot set\'s rectangle. Your own numbers move or resize it.'))];

    rows.push(areaSourceLine(z, pat));

    if (!custom) {
      rows.push(fileRect
        ? note('', T('pl.loot-zones.area.fromFile',
          'Centre {x}, {y} · {w} m by {h} m, from the loot set.', {
          x: Math.round(Number(fileRect.x) || 0), y: Math.round(Number(fileRect.y) || 0),
          w: metres(fileRect.width), h: metres(fileRect.height),
        }))
        : null);
      return rows.filter(Boolean);
    }

    var centreReady = isFinite(Number(a.x)) && isFinite(Number(a.y)) && a.x != null && a.y != null;
    var cx = Math.round(Number(a.x) || 0);
    var cy = Math.round(Number(a.y) || 0);

    rows.push(row(T('pl.loot-zones.area.shape', 'Shape'), sel(shape, [
      ['rect', T('pl.loot-zones.area.shape.rect', 'Rectangle')],
      ['circle', T('pl.loot-zones.area.shape.circle', 'Circle')],
    ], function (v) { areaWrite(z).shape = v === 'circle' ? 'circle' : 'rect'; markDirty(); })));

    rows.push(row(T('pl.loot-zones.area.centre', 'Centre'), h('div', { class: 'lz-ctl' }, [
      h('div', { class: 'lz-routes' }, [
        guardNum('X', coordIn(a.x, function (v) { areaWrite(z).x = v; markDirty(); })),
        guardNum('Y', coordIn(a.y, function (v) { areaWrite(z).y = v; markDirty(); })),
      ]),
      h('small', {}, T('pl.loot-zones.area.centre.cap',
        'Centimetres — the same numbers the game, the map and the admin console use.')),
    ]), T('pl.loot-zones.area.centre.hint',
      'The zone\'s middle, not a corner. An empty box means no centre, never zero.')));

    if (shape === 'rect') {
      rows.push(row(T('pl.loot-zones.area.sizeX', 'Half-width · centre to the east edge'),
        h('div', { class: 'lz-ctl' }, [
          numIn(a.sizeX, function (v) { areaWrite(z).sizeX = Math.max(0, v); markDirty(); }, 0, HALF_MAX,
            T('pl.loot-zones.unit.cm', 'cm')),
          h('small', {}, acrossText(a.sizeX)),
        ]),
        T('pl.loot-zones.area.half.hint',
          'Half the width, from the centre out. The line below shows the full distance.')));
      rows.push(row(T('pl.loot-zones.area.sizeY', 'Half-depth · centre to the north edge'),
        h('div', { class: 'lz-ctl' }, [
          numIn(a.sizeY, function (v) { areaWrite(z).sizeY = Math.max(0, v); markDirty(); }, 0, HALF_MAX,
            T('pl.loot-zones.unit.cm', 'cm')),
          h('small', {}, acrossText(a.sizeY)),
        ])));
    } else {
      rows.push(row(T('pl.loot-zones.area.radius', 'Radius · centre to the edge'),
        h('div', { class: 'lz-ctl' }, [
          numIn(a.radius, function (v) { areaWrite(z).radius = Math.max(0, v); markDirty(); }, 0, HALF_MAX,
            T('pl.loot-zones.unit.cm', 'cm')),
          h('small', {}, acrossText(a.radius)),
        ]),
        T('pl.loot-zones.area.radius.hint', 'Centre to the edge, in centimetres.')));
    }

    // What those numbers add up to, above the buttons that check it — the one line somebody reads
    // before they believe the boxes.
    rows.push(note(centreReady ? '' : 'wait', centreReady
      ? (shape === 'circle'
        ? T('pl.loot-zones.area.sum.circle', 'A circle {m} m across, centred on {x}, {y}.',
          { m: metres(Number(a.radius) * 2), x: cx, y: cy })
        : T('pl.loot-zones.area.sum.rect', 'A rectangle {w} m by {h} m, centred on {x}, {y}.', {
          w: metres(Number(a.sizeX) * 2), h: metres(Number(a.sizeY) * 2), x: cx, y: cy,
        }))
      : T('pl.loot-zones.area.sum.nocentre',
        'No centre yet, so not drawn. Type X and Y or pick on the map.')));

    var buttons = [];
    /**
     * ⚠ **THE ZONE IS FOUND AGAIN BY ID AFTER THE MAP CLOSES, NEVER HELD ACROSS IT.** Opening the
     * picker re-renders this tab, and a render with nothing unsaved replaces `state.cfg` with what
     * the server holds — so the object a click handler captured is an orphan by the time the answer
     * comes back and a centre written into it is written into nothing at all. Same window
     * `guardAgain` exists for on a guard's own points.
     */
    if (typeof SSA.pickOnMap === 'function' && (!SSA.canPickOnMap || SSA.canPickOnMap())) {
      buttons.push(h('button', {
        class: 'secondary', type: 'button',
        onclick: function () {
          Promise.resolve(SSA.pickOnMap({
            note: T('pl.loot-zones.area.pick.note', 'Tap the middle of {name}.',
              { name: z.name || z.set || T('pl.loot-zones.zone.thisZone', 'this zone') }),
          })).then(function (at) {
            if (!at) return;
            var now = zoneAgain(z.id);
            if (!now) {
              SSA.toast(T('pl.loot-zones.area.pick.gone',
                'That zone is not in the list any more, so nothing was changed.'));
              return;
            }
            var w = areaWrite(now);
            w.mode = 'custom';
            w.x = Math.round(Number(at.x)); w.y = Math.round(Number(at.y));
            markDirty();
            SSA.toast(T('pl.loot-zones.area.pick.took', 'Centre taken from the map.'));
          }).catch(function () { /* the picker settled on its own */ });
        },
      }, [icon('map'), T('pl.loot-zones.area.pick', 'Pick the centre on the map')]));
    }
    buttons.push(h('button', {
      class: 'secondary', type: 'button',
      onclick: function () {
        takePlayerPosition(function () { return zoneAgain(z.id); }, function (now, pl) {
          var w = areaWrite(now);
          w.mode = 'custom';
          w.x = Math.round(Number(pl.x)); w.y = Math.round(Number(pl.y));
          markDirty();
          SSA.toast(T('pl.loot-zones.area.centre.took', 'Centre set to where {name} is standing.',
            { name: String(pl.name || '') }));
        });
      },
    }, [icon('user'), T('pl.loot-zones.area.fromPlayer', 'Centre on a player')]));
    if (typeof SSA.showOnMap === 'function' && centreReady) {
      buttons.push(h('button', {
        class: 'secondary', type: 'button',
        onclick: function () { SSA.showOnMap(cx, cy, 0); },
      }, [icon('eye'), T('pl.loot-zones.area.show', 'Show me where that is')]));
    }
    // ⚠ THE AREA AS IT IS ON THIS PAGE, not the one the server is holding. The route is given the
    // block verbatim, so an owner checks what they just typed rather than what they last saved —
    // which is the whole reason a check button exists before a save button.
    buttons.push(h('button', {
      class: 'secondary', type: 'button',
      onclick: function () {
        var k = areaKey(z);
        areaSaid[k] = 'asking';
        render();
        api('/area-check', { method: 'POST', body: { set: z.set || '', name: z.name || '', area: areaOf(z) } })
          .then(function (r) {
            areaSaid[k] = (r && typeof r === 'object' && ('ok' in r)) ? r
              : { ok: true, onMap: null, onMapWhy: T('pl.loot-zones.at.noRoute',
                'This plugin\'s backend did not answer — it may be older than this screen.') };
            render();
          })
          .catch(function (err) {
            areaSaid[k] = { ok: true, onMap: null,
              onMapWhy: SSA.apiError ? SSA.apiError(err) : ((err && err.message) || '') };
            render();
          });
      },
    }, [icon('check-shield'), T('pl.loot-zones.area.check', 'Check this area')]));
    rows.push(h('div', { class: 'lz-actions' }, buttons.concat([
      h('small', {}, T('pl.loot-zones.area.check.cap',
        'Checking asks the game where this lands. Nothing is drawn and nothing is saved.')),
    ])));
    areaVerdict(areaSaid[areaKey(z)]).forEach(function (n) { rows.push(n); });
    return rows.filter(Boolean);
  }

  // ── what the guard lifecycle DID, per zone ─────────────────────────────────────────────────────
  /**
   * One row of chips — awake or asleep, when the guards go, how many were taken away, how many had
   * walked out — plus ONE ⚠ note, and nothing else. The backend publishes all of it on the zone's
   * patrol row; the tab used to read none of it.
   *
   * ⚠ **"THE ZONE WENT TO SLEEP" IS NOT "THE ZONE IS EMPTY", AND `sleptUnidentified` IS THE
   * DIFFERENCE.** A guard sent through the game's own spawn command comes back with no identifier,
   * so this plugin cannot take it away when the zone sleeps and cannot leash it. The backend counts
   * those rather than implying a clean sweep, and a screen that stayed quiet about the count would
   * put the implication back. It is a warning, so it is a line of its own and never a chip.
   *
   * ⚠ The sweep counts (`slept`, `sleptMissing`, `sleptUnidentified`) are what the zone's last
   * sleep sweep did, and they stay on the row until the zone wakes; `strayed` counts every guard
   * taken back since the zone last woke. So a reader opening the tab at any moment sees them, not
   * only on the one patrol that did the work. A zero is drawn as nothing — a chip reading "0 taken
   * away" on every quiet zone is noise, and noise is how a row like this stops being read.
   */
  function lifeStatus(pat) {
    if (!pat) return [];
    var chips = [];
    var chip = function (cls, text) { chips.push(h('span', { class: 'lz-badge' + (cls ? ' ' + cls : '') }, text)); };
    if (pat.awake === true) chip('good', T('pl.loot-zones.life.chip.awake', 'awake'));
    else if (pat.awake === false) chip('', T('pl.loot-zones.life.chip.asleep', 'asleep'));
    if (pat.sleepInMs != null && Number(pat.sleepInMs) >= 0) {
      chip('wait', T('pl.loot-zones.life.chip.sleepIn', 'guards go in {t}',
        { t: nSeconds(Math.ceil(Number(pat.sleepInMs) / 1000)) }));
    }
    if (Number(pat.slept) > 0) chip('', T('pl.loot-zones.life.chip.slept', '{n} taken away', { n: Number(pat.slept) }));
    if (Number(pat.sleptMissing) > 0) {
      chip('', T('pl.loot-zones.life.chip.missing', '{n} already gone', { n: Number(pat.sleptMissing) }));
    }
    if (Number(pat.strayed) > 0) {
      chip('wait', T('pl.loot-zones.life.chip.strayed', '{n} walked out, taken away', { n: Number(pat.strayed) }));
    }
    var out = chips.length ? [h('div', { class: 'lz-routes lz-lifechips' }, chips)] : [];
    if (Number(pat.sleptUnidentified) > 0) {
      out.push(note('wait', T('pl.loot-zones.life.warn.unidentified',
        '⚠ {n} could not be removed (no id). The game clears them when nobody is near.',
        { n: Number(pat.sleptUnidentified) })));
    } else if (pat.awake === true && Number(pat.untracked) > 0) {
      // A guard placed with no id cannot be followed, leashed or taken away by the zone.
      out.push(note('wait', T('pl.loot-zones.life.warn.untracked',
        '⚠ {n} placed without an id: the zone cannot track or leash them.',
        { n: Number(pat.untracked) })));
    }
    return out;
  }

  /**
   * Which area the RUNNING plugin used on its last patrol — the set's file or the owner's numbers —
   * set against what this page now says. The two differ exactly while an edit is unsaved, and a
   * reader of the map is looking at the server's answer, not at the page's.
   */
  function areaSourceLine(z, pat) {
    var src = pat && pat.areaSource;
    if (src !== 'custom' && src !== 'file') return null;
    var page = areaCustom(z) ? 'custom' : 'file';
    if (src === page) {
      return h('small', {}, src === 'custom'
        ? T('pl.loot-zones.area.src.custom', 'The server is using your own numbers.')
        : T('pl.loot-zones.area.src.file', 'The server is using the loot set\'s own area.'));
    }
    return h('small', { class: 'lz-warn' }, src === 'custom'
      ? T('pl.loot-zones.area.src.customUnsaved', '⚠ Until you save, the server still uses your own numbers.')
      : T('pl.loot-zones.area.src.fileUnsaved', '⚠ Until you save, the server still uses the loot set\'s own area.'));
  }

  // ── the whole list at once ─────────────────────────────────────────────────────────────────────
  /**
   * Does this zone match what the reader typed?
   *
   * Its name, its loot set and its own note are all things somebody would type to find it. The game
   * never reads any of this, so it is a plain case-insensitive substring and nothing cleverer.
   */
  function zoneMatches(z, find) {
    if (!find) return true;
    var hay = [z.name, z.set].join(' ').toLowerCase();
    return hay.indexOf(find) >= 0;
  }
  /** Which zones the list is showing right now — the search and the state filter together. */
  function shownZones(c, st) {
    var find = String(zoneFind || '').trim().toLowerCase();
    var live = {};
    (st.active || []).forEach(function (a) { live[String(a.id)] = true; });
    return (c.zones || []).filter(function (z) {
      if (!zoneMatches(z, find)) return false;
      if (zoneShow === 'on') return z.enabled !== false;
      if (zoneShow === 'off') return z.enabled === false;
      if (zoneShow === 'live') return !!live[String(z.id)];
      return true;
    });
  }

  /**
   * ── BULK ACTIONS OVER THE ZONE LIST ────────────────────────────────────────────────────────────
   *
   * Everything here is something an owner was doing one zone at a time: opening ten folds to find
   * the one they wanted, scrolling past nine to reach the tenth, and flipping the rotation switch
   * down a list by hand.
   *
   * ⚠ **A BUTTON THAT ACTS ON A SET SAYS HOW BIG THE SET IS, IN ITS OWN LABEL.** "Expand all" on a
   * filtered list is ambiguous and "Expand 3" is not — so every count comes from the list as it is
   * drawn right now, and a filtered list is exactly what a bulk action is for.
   *
   * ⚠ **AND THE TICKED ACTIONS ARE THE ONLY ONES THAT CHANGE SETTINGS.** Opening and closing a fold
   * is a viewer's own business and needs no save; rotation and removal go through `markDirty()` and
   * are undone by *Discard changes* like everything else on the page.
   */
  function zoneToolbar(c, st) {
    var zones = c.zones || [];
    if (!zones.length) return null;
    var shown = shownZones(c, st);
    var picked = zones.filter(function (z) { return !!zonePick[z.id]; });
    var nOpen = shown.filter(function (z) { return !zoneFolded(z, zones.length); }).length;

    var search = h('input', { class: 'lz-in lz-find', type: 'search',
      value: zoneFind,
      placeholder: T('pl.loot-zones.bulk.find.ph', 'Find a zone or a loot set') });
    // `input`, not `change`: a filter that only applies when the box loses focus is a filter that
    // looks broken. It redraws the list, and `afterRedraw` puts the caret back in the same box.
    search.addEventListener('input', function () { zoneFind = search.value; render(); });

    var head = h('div', { class: 'lz-bulk' }, [
      search,
      sel(zoneShow, [
        ['all', T('pl.loot-zones.bulk.show.all', 'All zones')],
        ['on', T('pl.loot-zones.bulk.show.on', 'In rotation')],
        ['off', T('pl.loot-zones.bulk.show.off', 'Out of rotation')],
        ['live', T('pl.loot-zones.bulk.show.live', 'Live now')],
      ], function (v) { zoneShow = v; render(); }),
      h('span', { class: 'lz-bulk-n' }, shown.length === zones.length
        ? T('pl.loot-zones.bulk.count', '{n} of {total}', { n: shown.length, total: zones.length })
        : T('pl.loot-zones.bulk.countFiltered', '{n} of {total} shown', { n: shown.length, total: zones.length })),
    ]);

    var setFold = function (list, to) {
      list.forEach(function (z) { shut['z-' + z.id] = to; });
      render();
    };
    var acts = [
      h('button', {
        class: 'secondary', type: 'button', disabled: (nOpen >= shown.length) ? '' : null,
        onclick: function () { setFold(shown, false); },
      }, [icon('list'), T('pl.loot-zones.bulk.expand', 'Expand {n}', { n: shown.length })]),
      h('button', {
        class: 'secondary', type: 'button', disabled: nOpen ? null : '',
        onclick: function () { setFold(shown, true); },
      }, [icon('menu'), T('pl.loot-zones.bulk.collapse', 'Collapse {n}', { n: shown.length })]),
    ];
    if (zones.length > 1) {
      acts.push(h('button', {
        class: 'secondary', type: 'button',
        disabled: shown.every(function (z) { return !!zonePick[z.id]; }) ? '' : null,
        onclick: function () { shown.forEach(function (z) { zonePick[z.id] = true; }); render(); },
      }, [icon('check'), T('pl.loot-zones.bulk.tickAll', 'Tick {n}', { n: shown.length })]));
      if (picked.length) {
        acts.push(h('button', {
          class: 'secondary', type: 'button',
          onclick: function () { zonePick = {}; render(); },
        }, [icon('close'), T('pl.loot-zones.bulk.untick', 'Untick all')]));
      }
    }

    var kids = [head, h('div', { class: 'lz-bulk' }, acts)];
    if (picked.length) {
      var names = function () {
        return picked.map(function (z) { return z.name || z.set || ''; }).filter(Boolean).join(', ');
      };
      kids.push(h('div', { class: 'lz-bulk lz-bulk-sel' }, [
        h('span', { class: 'lz-badge on' },
          T('pl.loot-zones.bulk.picked', '{n} ticked', { n: picked.length })),
        h('button', {
          class: 'secondary', type: 'button',
          disabled: picked.every(function (z) { return z.enabled !== false; }) ? '' : null,
          onclick: function () {
            picked.forEach(function (z) { z.enabled = true; });
            markDirty();
          },
        }, [icon('power'), T('pl.loot-zones.bulk.on', 'Put in the rotation')]),
        h('button', {
          class: 'secondary', type: 'button',
          disabled: picked.every(function (z) { return z.enabled === false; }) ? '' : null,
          onclick: function () {
            picked.forEach(function (z) { z.enabled = false; });
            markDirty();
          },
        }, [icon('ban'), T('pl.loot-zones.bulk.off', 'Take out of the rotation')]),
        h('button', {
          class: 'lz-del', type: 'button',
          title: T('pl.loot-zones.bulk.remove', 'Remove the ticked zones'),
          onclick: function () {
            /**
             * ⚠ **A LIVE ZONE IS NAMED BEFORE IT IS REMOVED, NOT AFTER.** Taking an entry out of
             * this list does NOT switch its loot off: the folder is on the server and the rectangle
             * is in the game, and all the entry does is know about them. One zone at a time that is
             * a sentence in a confirmation; over a selection it is the whole reason to read one.
             */
            var liveIds = {};
            (st.active || []).forEach(function (a) { liveIds[String(a.id)] = true; });
            var stillOn = picked.filter(function (z) { return liveIds[String(z.id)]; });
            SSA.confirm(T('pl.loot-zones.bulk.removeConfirm',
              'Remove {n} zone(s) from the list?{live}\n\n{names}\n\nNothing changes until {save}; "{discard}" undoes it.', {
              n: picked.length,
              names: names(),
              live: stillOn.length
                ? T('pl.loot-zones.bulk.removeLive',
                  '\n\n⚠ {n} are live and stay on the server. Press "{button}" under {card} afterwards.', { n: stillOn.length, button: labReconcile(), card: cardActions() })
                : '',
              save: labSave(), discard: labDiscard(),
            })).then(function (yes) {
              if (!yes) return;
              c.zones = zones.filter(function (z) { return !zonePick[z.id]; });
              zonePick = {};
              markDirty();
            });
          },
        }, [icon('close'), T('pl.loot-zones.bulk.removeButton', 'Remove')]),
      ]));
    }
    if (zoneFind && !shown.length) {
      kids.push(note('', T('pl.loot-zones.bulk.noMatch', 'No zone matches that.')));
    }
    return h('div', { class: 'lz-bulkbar' }, kids);
  }

  // ── one zone ───────────────────────────────────────────────────────────────────────────────────
  /**
   * Is this zone folded?
   *
   * ⚠ **A SHORT LIST OPENS AND A LONG ONE DOES NOT, AND A DECISION BEATS BOTH.** Every zone drew
   * itself open, so a server with ten of them was ten full settings screens stacked one under the
   * other and nothing but scrolling to get past them. `shut` is written only by the fold control and
   * by a copy, so a viewer who opened or closed one keeps that — absent is a default, not a choice.
   */
  function zoneFolded(z, n) {
    var k = 'z-' + z.id;
    return Object.prototype.hasOwnProperty.call(shut, k) ? !!shut[k] : n > 3;
  }
  function zoneBlock(z, i, c, sets, st) {
    var live = (st.active || []).filter(function (a) { return String(a.id) === String(z.id); })[0];
    var set = sets.filter(function (s) { return s.name === z.set; })[0];
    var all = c.zones || [];
    var folded = zoneFolded(z, all.length);

    var head = h('div', { class: 'lz-zhead' }, [
      // The tick that the bulk actions above read. Only where there is more than one zone to act on.
      all.length > 1 ? (function () {
        var box = h('input', { class: 'lz-pick', type: 'checkbox',
          title: T('pl.loot-zones.bulk.pickOne', 'Tick this zone for the actions above') });
        box.checked = !!zonePick[z.id];
        box.addEventListener('change', function () {
          if (box.checked) zonePick[z.id] = true; else delete zonePick[z.id];
          render();
        });
        return box;
      })() : null,
      toggle(z.enabled !== false, function (v) { z.enabled = v; markDirty(); }),
      txt(z.name, T('pl.loot-zones.zone.namePlaceholder', 'a name players will read'), function (v) { z.name = v; markDirty(); }, 'lz-in lz-name'),
      // ⚠ The option VALUE is the set's folder name and is never translated; only the two words
      // around it are.
      sel(z.set, [['', T('pl.loot-zones.zone.pickSet', '— pick a loot set —')]].concat(sets.map(function (s) {
        return [s.name, s.ok ? s.name : T('pl.loot-zones.zone.setUnusable', '{name}  (unusable)', { name: s.name })];
      })), function (v) { z.set = v; markDirty(); }),
      live ? h('span', { class: 'lz-badge on' }, live.drawn === false
        ? T('pl.loot-zones.badge.liveNotDrawn', 'live, not drawn') : T('pl.loot-zones.badge.live', 'live')) : null,
      h('button', {
        class: 'lz-link', type: 'button',
        onclick: function () { shut['z-' + z.id] = !folded; render(); },
      }, folded ? T('pl.loot-zones.zone.more', 'more') : T('pl.loot-zones.zone.less', 'less')),
      // ⚠ THE ORDER IS A SETTING under "One zone per server restart, in turn down the list", and
      // nothing on this page could change it: the only way to move a zone was to retype every field
      // of two of them. Drawn always, because the list is also the reading order.
      (c.zones || []).length > 1 ? h('button', {
        class: 'lz-link lz-move', type: 'button',
        title: i === 0 ? T('pl.loot-zones.zone.alreadyFirst', 'Already first')
          : T('pl.loot-zones.zone.moveUp', 'Move up — the order is the turn order under "{option}"', { option: optRestart() }),
        disabled: i === 0 ? '' : null,
        onclick: function () { if (i === 0) return; c.zones.splice(i - 1, 0, c.zones.splice(i, 1)[0]); markDirty(); },
      }, '↑') : null,
      (c.zones || []).length > 1 ? h('button', {
        class: 'lz-link lz-move', type: 'button',
        title: i === (c.zones.length - 1) ? T('pl.loot-zones.zone.alreadyLast', 'Already last')
          : T('pl.loot-zones.zone.moveDown', 'Move down — the order is the turn order under "{option}"', { option: optRestart() }),
        disabled: i === (c.zones.length - 1) ? '' : null,
        onclick: function () { if (i >= c.zones.length - 1) return; c.zones.splice(i + 1, 0, c.zones.splice(i, 1)[0]); markDirty(); },
      }, '↓') : null,
      h('button', {
        class: 'lz-link', type: 'button', title: T('pl.loot-zones.zone.copyTitle', 'Add a copy of this zone with all its settings, right below it'),
        onclick: function () { duplicateZone(z, i, c); },
      }, T('pl.loot-zones.zone.copy', 'copy')),
      h('button', {
        class: 'lz-del', type: 'button', title: T('pl.loot-zones.zone.removeTitle', 'Remove this zone'),
        onclick: function () {
          // ⚠ **REMOVING A LIVE ZONE FROM THE LIST DOES NOT SWITCH IT OFF.** The loot folder is on
          // the server and the rectangle is in the game; taking the entry away only takes away the
          // thing that knows about them. That is a leftover nobody would look for, so it is said
          // here with the two buttons that clear it — rather than found weeks later on the map.
          SSA.confirm(T('pl.loot-zones.zone.removeConfirm', 'Remove "{name}" from the list?{live}\n\nNothing changes until {save}; "{discard}" beside {save} undoes it.', {
            name: z.name || z.set || T('pl.loot-zones.zone.thisZone', 'this zone'),
            live: live
              ? T('pl.loot-zones.zone.removeLive',
                '\n\n⚠ This zone is live. Switch it off first, or press "{button}" under {card} afterwards.',
                { button: labReconcile(), card: cardActions() })
              : '',
            save: labSave(), discard: labDiscard(),
          })).then(function (yes) {
            if (!yes) return;
            c.zones.splice(i, 1); markDirty();
          });
        },
      }, [icon('close')]),
    ]);
    if (folded) return h('div', { class: 'lz-zone' + (live ? ' on' : '') }, [head]);

    var meta = [];
    if (!z.set) meta.push(T('pl.loot-zones.zone.noSet', 'No loot set chosen yet, so this zone cannot be switched on.'));
    else if (!set) meta.push(T('pl.loot-zones.zone.setGone', 'The set "{name}" is not in the sets folder any more.', { name: z.set }));
    else if (!set.ok) meta.push(set.why);
    else if (areaCustom(z)) {
      // The loot still comes from the set; the ground does not. Saying both in one line stops an
      // owner reading the set's own rectangle as the zone's.
      var own = customRect(z);
      meta.push(own
        ? T('pl.loot-zones.zone.setFactsOwn', '{n} loot files, on an area of your own, {w} x {h} m.',
          { n: set.presets, w: metres(own.width), h: metres(own.height) })
        : T('pl.loot-zones.zone.setFactsOwnEmpty', '{n} loot files. The area of your own is not filled in yet.',
          { n: set.presets }));
    } else {
      var r = set.rects[0] || {};
      meta.push(T('pl.loot-zones.zone.setFacts', '{n} loot files, area {w} x {h} m{more}.', {
        n: set.presets, w: metres(r.width), h: metres(r.height),
        more: set.rects.length > 1
          ? T('pl.loot-zones.zone.setMoreRects', ' (+{n} more)', { n: set.rects.length - 1 }) : '',
      }));
    }
    if (live && live.drawn === false) {
      meta.push(T('pl.loot-zones.zone.lootLiveNotDrawn',
        'The loot is live; the rectangle is not on the map yet. {why}', { why: live.drawnWhy || '' }));
    }
    // ⚠ A PATROL THAT COULD NOT DO ITS WORK IS THE ANSWER TO "WHY IS NOTHING HAPPENING", so it gets its
    // own note and names the thing to press rather than being the last clause of a muted paragraph.
    var zoneNotes = [];
    /**
     * ⚠ **TWO ZONES CAN BE ONE ZONE, AND NOTHING ANYWHERE SAID SO.** The plugin names its zones
     * `<prefix><name>` and finds them again by that name, so a blank name is "just the prefix" and a
     * repeated name is the same zone written twice — the second one wins and the first is orphaned on
     * the map. Both are answerable here, off the page's own values, with the server stopped.
     */
    var myName = String(z.name || '').trim();
    var twinName = (c.zones || []).filter(function (x) {
      return x !== z && String((x && x.name) || '').trim().toLowerCase() === myName.toLowerCase();
    }).length;
    if (!myName) {
      zoneNotes.push(note('wait', T('pl.loot-zones.zone.noName',
        'No name: players see only "{prefix}". Type a name at the top.',
        { prefix: (c.zone || {}).namePrefix || '' })));
    } else if (twinName) {
      zoneNotes.push(note('bad', T('pl.loot-zones.zone.twinName',
        'Another zone is also called "{name}". Both on would clash in game; rename one.', { name: myName })));
    }
    // The rectangle belongs to the SET, so two zones on one set are two names over one rectangle.
    var twinSet = z.set && (c.zones || []).filter(function (x) {
      return x !== z && x && x.set === z.set && x.enabled !== false;
    }).length;
    if (twinSet && z.enabled !== false) {
      zoneNotes.push(note('wait', T('pl.loot-zones.zone.twinSet',
        'Another zone in rotation uses loot set "{set}" — same ground. Give one its own set.', { set: z.set })));
    }
    var pat = (st.patrols || {})[String(z.id)];
    var sm0 = z.sentries || c.sentries || {};
    var guarding = sm0.mode === 'remove' || sm0.mode === 'replace';
    if (pat && guarding) {
      if ((pat.refusals || []).length) {
        zoneNotes.push(note('bad', T('pl.loot-zones.zone.patrolRefused',
          'The last patrol could not do everything: {why}', { why: (pat.refusals || []).join(' — ') })));
      } else if (pat.awake === true && pat.reached === 0 && (sm0.kinds || []).length) {
        zoneNotes.push(note('wait', T('pl.loot-zones.zone.nothingFound',
          'A player is near; nothing to clear. "{button}" shows what is inside.', { button: labWhatIsIn() })));
      }
    }
    /**
     * ⚠ **ASLEEP IS THE ORDINARY STATE, AND THE CARD SAYS SO RATHER THAN SHOWING ZEROS.** SCUM puts
     * sentries, NPCs, animals and puppets into the world only around a player, so a zone nobody is
     * near has nothing in it to count and the plugin does not look. Three states, because "nobody is
     * near" and "where the players are could not be read" are opposite things to tell an owner.
     */
    if (pat && guarding) {
      var ago = Math.max(0, Math.round((Date.now() - pat.at) / 1000));
      var agoText = ago < 90 ? T('pl.loot-zones.ago.seconds', '{n}s', { n: ago })
        : T('pl.loot-zones.ago.minutes', '{n} min', { n: Math.round(ago / 60) });
      if (pat.awake === false) {
        meta.push(T('pl.loot-zones.patrol.asleep', 'Waiting for players: nobody within {m} m{detail}.', {
          m: metres(pat.wakeDistance),
          detail: pat.nearest != null
            ? T('pl.loot-zones.patrol.nearest', ' (nearest {m} m)', { m: metres(pat.nearest) })
            : (pat.playersOnline === 0 ? T('pl.loot-zones.patrol.nobodyOnline', ' (nobody online)') : ''),
        }));
      } else if (pat.awake === null || pat.awake === undefined) {
        meta.push(T('pl.loot-zones.patrol.unknown',
          'Player positions could not be read {ago} ago, so this zone was skipped.', { ago: agoText }));
      } else {
        var did = [];
        if (pat.stowed) {
          did.push(pat.stowed === 1 ? T('pl.loot-zones.did.stowedOne', '{n} sentry put away', { n: pat.stowed })
            : T('pl.loot-zones.did.stowedMany', '{n} sentries put away', { n: pat.stowed }));
        }
        if (pat.removed) did.push(T('pl.loot-zones.did.removed', '{n} removed', { n: pat.removed }));
        if (pat.puppets) did.push(T('pl.loot-zones.did.puppets', '{n} zombie(s) removed', { n: pat.puppets }));
        if (pat.spawned) did.push(T('pl.loot-zones.did.spawned', '{n} guard(s) sent', { n: pat.spawned }));
        if (pat.inZone != null) {
          did.push(pat.maxGuards
            ? T('pl.loot-zones.did.standingOf', '{n} of at most {max} guard(s) standing', { n: pat.inZone, max: pat.maxGuards })
            : T('pl.loot-zones.did.standing', '{n} guard(s) standing', { n: pat.inZone }));
        } else if (pat.posts) {
          did.push(T('pl.loot-zones.did.held', '{n} of {posts} guard spot(s) held', { n: pat.held, posts: pat.posts }));
        }
        // ⚠ A POST LEFT EMPTY ON PURPOSE IS NOT A POST THAT FAILED, and without this it renders as
        // "held 4 of 12" with nothing saying the other eight are outside their guard's hours. Its
        // own key, because this is a window that is CLOSED — not a window nobody could read.
        if (pat.outsideWindow) {
          did.push(T('pl.loot-zones.did.outsideWindow',
            '{n} place(s) left for now: their guard is outside its game hours', { n: pat.outsideWindow }));
        }
        if (pat.killed) did.push(T('pl.loot-zones.did.killed', '{n} killed, back after the respawn time', { n: pat.killed }));
        if (pat.underground) did.push(T('pl.loot-zones.did.underground', '{n} player(s) under the ground', { n: pat.underground }));
        if (pat.underSpots) did.push(T('pl.loot-zones.did.underSpots', '{n} underground spot(s) learned', { n: pat.underSpots }));
        meta.push(T('pl.loot-zones.patrol.active', 'Active, a player is {where}{did} ({ago} ago).', {
          where: pat.nearest ? T('pl.loot-zones.patrol.away', '{m} m away', { m: metres(pat.nearest) })
            : T('pl.loot-zones.patrol.inside', 'inside'),
          did: did.length ? T('pl.loot-zones.patrol.did', ': {list}', { list: did.join(', ') }) : '',
          ago: agoText,
        }));
      }
    } else if (guarding && live) {
      meta.push(T('pl.loot-zones.patrol.never', 'The patrol has not run here yet.'));
    }
    /**
     * ⚠ **THE GAME'S CLOCK, AND WHETHER THE WINDOWS ARE IN FORCE AT ALL.** Three states and the
     * middle one is the whole reason this is a note rather than a number: a clock that could not be
     * read means the windows are deliberately NOT applied and every guard is being sent exactly as
     * it was before anybody set one. A reader who is not told that believes a schedule is running.
     * Absent is the fourth state and is silence — nobody asked for a clock, because no guard in this
     * zone has hours.
     */
    if (pat && pat.clock) {
      if (pat.clock.unknown) {
        /**
         * ⚠ **THIS IS THE "NOT APPLIED" SENTENCE AND IT IS NOT THE "CLOSED" ONE.** A window nobody
         * could read is a window that is being IGNORED — every guard is sent exactly as it was
         * before anybody set hours — while a closed window is a zone deliberately holding back. Its
         * own key, never shared with `pl.loot-zones.gt.closed`, because a language that blurred the
         * two would tell an owner their defences are off when they are running.
         */
        zoneNotes.push(note('bad', T('pl.loot-zones.zone.clockUnreadable',
          'Game clock unreadable{why} Guard hours are ignored for now. Tick {box} at the top.', {
          why: pat.clock.why ? T('pl.loot-zones.zone.clockWhy', ': {why}', { why: pat.clock.why })
            : T('pl.loot-zones.zone.clockStop', '.'),
          box: cardBridge(),
        })));
      } else {
        // The unit travels with the number, always — and so does the speed, because that is what
        // makes a game hour something other than an hour. The unit itself is the backend's own
        // machine word and stays as it is.
        meta.push(T('pl.loot-zones.zone.clockNow', 'The game says it is {t} ({unit}){speed}.', {
          t: gameClockText(pat.clock.hour),
          unit: pat.clock.unit || 'game-hours',
          speed: pat.clock.speed != null
            ? T('pl.loot-zones.zone.clockSpeed', ', running at {n} {unit}',
              { n: pat.clock.speed, unit: pat.clock.speedUnit || 'game-hours-per-real-hour' })
            : '',
        }));
      }
    }

    var when = (c.rotation === 'time') ? scheduleBlock(z, st) : null;

    // The zone's OWN guards, or the page's default. Asking for its own copies the current default
    // into it — an owner starts from what they already had, not from the shipped values — and giving
    // it up removes the block, which is what makes "falls back to the default" true rather than a
    // sentence about it.
    // ⚠ ONE PLACE. A zone used to fall back to a page-wide default unless it was switched to settings
    // of its own, which put the same controls on the screen twice. A zone with no settings of its own
    // now starts from a copy of that default — exactly what it was already following, so nothing about
    // it changes — and the zone is the only place they are edited.
    if (!z.sentries) z.sentries = JSON.parse(JSON.stringify(c.sentries || {}));
    // How busy the zone is follows the same rule, and for the same reason: one place to edit it, and
    // a zone that has never been opened starts from a copy of exactly what it was already following.
    if (!z.activity) z.activity = JSON.parse(JSON.stringify(c.activity || {}));
    // `set` travels in because the RECTANGLE is what decides whether the bridge will sweep this zone
    // at all, and it is known from the set's own `Zones.json` with the server stopped.
    // ⚠ The SCOPE is the zone's id and not its name: a name is typed, so keying a fold on it moves
    // the fold's identity mid-edit, and two zones sharing a name would share their folds.
    hintScope = 'z:' + z.id;
    var where = h('div', { class: 'lz-when' },
      [h('h4', { class: 'lz-group' }, T('pl.loot-zones.area.title', 'Where this zone is'))]
        .concat(areaBlock(z, set, pat)));
    var guards = h('div', { class: 'lz-when' },
      guardControls(z.sentries, z.id, pat, zoneRectSource(z, set)));
    var busy = h('div', { class: 'lz-when' }, [
      h('h4', { class: 'lz-group' }, cardActivity()),
      /**
       * ⚠ **ONE SENTENCE STAYS AND THE PARAGRAPH FOLDS, BECAUSE TWO OF ITS FACTS DECIDE SOMETHING
       * AND THE REST EXPLAINS THEM.** What a reader has to know before touching the dial is that it
       * moves the GAME's own spawn plan rather than placing anything, and that it cannot fill an
       * empty server — one is why nobody has to be online, the other is why nothing appears when
       * nobody is. Folding those away leaves a percentage box with no subject.
       */
      h('p', { class: 'lz-lead' }, T('pl.loot-zones.card.activity.short',
        'Changes what spawns in your zone\'s places. Works offline, but cannot fill an empty server.')),
      why('busy:' + z.id, [T('pl.loot-zones.card.activity.lead',
        'Changes what spawns here, even offline. Spawns still need a player nearby.')]),
    ].concat(activitySummary(z, z.activity)).concat(activityControls(z.activity, z.id, activityInert(z))));
    hintScope = '';

    /**
     * ⚠ **A BUTTON THAT IS ABOUT TO BE REFUSED SAYS SO BEFORE IT IS PRESSED.** `/activate` refuses a
     * zone with no loot set and a zone the saved configuration has never heard of, both in perfectly
     * good sentences — but a sentence that arrives as a toast after a click is a sentence about
     * something that already happened. Both are decidable here.
     */
    var isNew = !!savedIds && savedIds.indexOf(String(z.id)) < 0;
    var onBlocked = !z.set
      ? T('pl.loot-zones.zone.blockedNoSet', 'Pick a loot set for this zone first.')
      : (isNew ? T('pl.loot-zones.zone.blockedNew', 'This zone is not on the server yet. Press {save}, then switch it on.', { save: labSave() }) : null);

    return h('div', { class: 'lz-zone' + (live ? ' on' : '') }, [
      head,
      h('div', { class: 'lz-zmeta' }, meta.join(' ')),
      zoneNotes.length ? h('div', { class: 'lz-live' }, zoneNotes) : null,
      (function () { var ls = guarding ? lifeStatus(pat) : []; return ls.length ? h('div', { class: 'lz-live' }, ls) : null; })(),
      when,
      where,
      guards,
      busy,
      h('div', { class: 'lz-actions' }, [
        h('button', {
          class: 'secondary', type: 'button',
          disabled: onBlocked ? '' : null,
          title: onBlocked || (unsaved ? T('pl.loot-zones.zone.onTitleUnsaved',
            'Switches on the saved settings, not this page\'s changes. Save first to include them.')
            : T('pl.loot-zones.zone.onTitle', 'Put this zone\'s loot on the server now')),
          onclick: function () {
            if (onBlocked) return;
            api('/activate', { method: 'POST', body: { id: z.id } }).then(function (r) {
              if (r && r.ok === false) SSA.toast(r.why || T('pl.loot-zones.refused', 'Refused'));
              else if (r && r.unchanged) SSA.toast(T('pl.loot-zones.zone.alreadyOn', 'That one is already on'));
              else {
                SSA.toast(unsaved
                  ? T('pl.loot-zones.zone.onUnsaved', 'Switched on with the saved settings — this page\'s changes are not in it yet')
                  : T('pl.loot-zones.zone.on', 'Switched on'));
              }
              refresh();
            }).catch(failed(T('pl.loot-zones.fail.activate', 'Not switched on')));
          },
        }, [icon('play'), T('pl.loot-zones.zone.onButton', 'Switch this one on now')]),
        // Beside the button rather than in its tooltip: a reason nobody hovers over is a reason
        // nobody reads, and this is the one that answers "why does the button do nothing".
        onBlocked ? h('small', { class: 'lz-warn' }, onBlocked) : null,
        ((z.sentries || c.sentries || {}).mode !== 'leave') ? h('button', {
          class: 'secondary', type: 'button', onclick: function () {
            api('/guard-preview', { method: 'POST', body: { id: z.id } }).then(function (r) {
              if (r && r.error) return SSA.toast(r.error);
              var kindName = function (kind) {
                if (kind === 'sentry') return T('pl.loot-zones.kind.sentry', 'Deployed sentries');
                if (kind === 'mapsentry') return T('pl.loot-zones.kind.mapsentry', 'Fixed map sentries');
                if (kind === 'puppet') return T('pl.loot-zones.kind.puppet', 'Puppets (zombies)');
                return kind;
              };
              // ⚠ BEFORE the counts, because it decides what they mean. A survey taken with
              // nobody in the zone reports zero of everything on a base full of sentries.
              var nobody = r.playersKnown === true && r.playersOnline === 0;
              var lines = (r.kinds || []).map(function (k) {
                var who = kindName(k.kind);
                if (k.error) return T('pl.loot-zones.preview.error', '{who}: {why}', { who: who, why: k.error });
                return T('pl.loot-zones.preview.line',
                  '{who}: {inside} inside this zone, {found} found in total; those outside are left alone',
                  { who: who, inside: k.inside, found: k.found })
                  + (k.stowed ? T('pl.loot-zones.preview.stowed', '. {n} of those inside are already put away', { n: k.stowed }) : '')
                  // A fixed sentry is put away, which has its own switch; the removal switch the
                  // preview reports on does not decide it.
                  + (k.kind === 'mapsentry'
                    ? (r.stow && r.stow.allowed ? ''
                      // ⚠ **"Remove from the world" IS THE CARD; "Removal" IS A GROUP INSIDE IT.**
                      // Its two siblings in `guardLimits` name the card correctly and this one named
                      // the heading, so one bridge card had two names on one page — and eighteen
                      // translations carried the wrong one.
                      : T('pl.loot-zones.preview.noStow',
                        '. Turn on "Put fixed map sentries away instead of removing them" first'))
                    : (k.allowed ? '' : T('pl.loot-zones.preview.noRemove', '. The bridge will not remove this kind yet')))
                  // ⚠ THE SENTENCE THAT WAS IMPOSSIBLE BEFORE. This button used to survey only the
                  // kinds already ticked, so the kind an owner had NOT chosen — which is the one
                  // they need to hear about — could never be reported. A naval base carries fixed
                  // emplacements and no deployed sentries at all.
                  + (k.inside > 0 && !k.ticked
                    ? T('pl.loot-zones.preview.notTicked', '. ⚠ This zone is not set to clear these — switch on "{switch}".',
                      { switch: k.kind === 'puppet' ? labZombiesOut() : labSentriesOut() })
                    : '')
                  // ⚠ "THERE ARE NONE" IS A CLAIM ABOUT THE WORLD, and with nobody in the zone
                  // the world has not been asked. SCUM only puts sentries, NPCs, animals and
                  // puppets in around a player, so on a quiet server every kind reads zero on a
                  // base full of them.
                  + (k.inside === 0 && k.ticked && !nobody
                    ? T('pl.loot-zones.preview.none', '. This zone is set to clear that kind and there are none.') : '');
              });
              // Built as nodes, never as a string: a string body goes through innerHTML, and this
              // text is the bridge's own words rather than ours.
              SSA.modal({
                title: T('pl.loot-zones.preview.title', 'What is in this zone'),
                body: h('div', { class: 'lz-lines' }, [
                  nobody ? h('p', { class: 'lz-note wait' }, T('pl.loot-zones.preview.nobody',
                    'Nobody is online, so nothing has spawned yet. Ask again with someone inside.')) : null,
                  r.playersKnown === false ? h('p', { class: 'lz-note wait' }, T('pl.loot-zones.preview.unknown',
                    'Player positions unreadable, so a zero below may mean nobody was near.')) : null,
                ].concat(lines.length
                  ? lines.map(function (t) { return h('p', {}, t); })
                  : [h('p', {}, nobody ? T('pl.loot-zones.preview.emptyWorld', 'Nothing was in the world to find.')
                    : T('pl.loot-zones.preview.nothing', 'Nothing found.'))])),
              });
            }).catch(failed(T('pl.loot-zones.fail.look', 'Could not look')));
          },
        }, [icon('eye'), labWhatIsIn()]) : null,
      ]),
    ]);
  }

  /**
   * ── THE GAME'S OWN RANDOM SPAWNS ───────────────────────────────────────────────────────────────
   *
   * A row that names no class at all. `SpawnRandomZombie`, `SpawnRandomZombie2` and
   * `SpawnRandomAnimal` take a count and a place and nothing else, so nothing has to be loaded and
   * nothing has to be looked up — which makes this **the one guard that works on a fresh server
   * whatever the game has ever made**, the single thing a class-named row cannot do. And they AIM:
   * measured 46 cm from the point asked for, the same as the named creature verbs.
   *
   * ⚠ **WHAT IT COSTS IS IDENTITY, AND THAT COST HAS TO BE ON THE SCREEN.** The command hands back
   * no id and what appears is not known in advance, so a post filled this way cannot be asked about
   * and cannot even be recognised by name: it is held by ANY creature of that kind standing on it,
   * the game's own wildlife included. An owner who believes they have placed three zombies and
   * finds the post satisfied by a passing deer should have been told first, so every random row
   * says it and so does the zone's summary.
   */
  var RANDOM_KINDS = {
    zombie: { kindWord: 'zombie' },
    zombie_safe: { kindWord: 'zombie' },
    animal: { kindWord: 'animal' },
  };
  /** The words for one of those three. Literal keys, so nothing here is built out of `t.random`. */
  function randomLabel(k) {
    if (k === 'zombie') return T('pl.loot-zones.random.zombie', 'Random zombie');
    if (k === 'zombie_safe') return T('pl.loot-zones.random.zombieSafe', 'Random zombie (narrower list)');
    return T('pl.loot-zones.random.animal', 'Random animal');
  }
  /**
   * ⚠ **THE BACKTICKS WERE ON THE SCREEN.** These three read `\`SpawnRandomZombie\`` — markdown, in a
   * page that renders every string through `document.createTextNode` and has no markdown renderer
   * and no `innerHTML` anywhere. So an owner read the punctuation, in nineteen languages, because
   * all eighteen translations carried it faithfully. A command's name is a game identifier and
   * travels as itself.
   */
  function randomNote(k) {
    if (k === 'zombie') {
      return T('pl.loot-zones.random.zombie.note',
        'The game\'s own SpawnRandomZombie — any puppet it likes, from the whole list.');
    }
    if (k === 'zombie_safe') {
      return T('pl.loot-zones.random.zombieSafe.note',
        'The game\'s SpawnRandomZombie2: leaves out loot, suicide, hospital and nuclear puppets. The safer choice.');
    }
    return T('pl.loot-zones.random.animal.note',
      'The game\'s own SpawnRandomAnimal — any of the island\'s wildlife.');
  }
  function randomOf(t) {
    var k = t && String(t.random || '').trim();
    return (k && RANDOM_KINDS[k]) ? { key: k, kindWord: RANDOM_KINDS[k].kindWord } : null;
  }

  /**
   * The entries that really name something to send. The same test the backend makes — and a random
   * row names no class on purpose, so asking only about the class read every one of them as "nothing
   * chosen" and would have hidden a zone's whole guard list.
   */
  function chosenGuards(rp) {
    var list = (Array.isArray(rp.types) && rp.types.length) ? rp.types : [rp];
    return list.filter(function (t) {
      if (!t) return false;
      // A misspelt key is dropped here exactly as the backend drops it, rather than counted as a
      // guard that will never be sent.
      if (t.random) return !!randomOf(t);
      return !!String((t.route === 'persistent' ? t.spawnName : t.classPath) || '').trim();
    });
  }

  /**
   * Lift a pre-list configuration into the list, without changing what it means.
   *
   * Every configuration written before the list existed carries the single `route`/`classPath`/
   * `spawnName` beside it, and the backend reads an EMPTY list as exactly that — so seeding the list
   * from those fields changes no behaviour at all, and the screen can then have one shape instead of
   * two. Nothing is seeded when nothing was chosen: an empty list is an owner who has not picked a
   * guard, which is a real state and has its own sentence.
   */
  function normaliseGuards(sm) {
    if (!sm || typeof sm !== 'object') return;
    var rp = sm.replace || (sm.replace = {});
    if (!Array.isArray(rp.types)) rp.types = [];
    if (rp.types.length) return;
    if (!String((rp.route === 'persistent' ? rp.spawnName : rp.classPath) || '').trim()) return;
    rp.types = [{
      route: rp.route === 'persistent' ? 'persistent' : 'spawn',
      kind: rp.kind || 'npc', classPath: rp.classPath || '',
      spawnKind: rp.spawnKind || 'armednpc', spawnName: rp.spawnName || '',
      count: rp.count || 1, weight: 1, label: '',
    }];
  }


  /**
   * The guard's own IDENTITY, as the game spells it — never its display name.
   *
   * ⚠ **THIS IS A WIRE RULE AND NOT A PREFIX STRIP TO BE TIDIED AWAY.** The word it produces is
   * matched against the word the BACKEND publishes on a patrol row (`patWindowOf`) and against the
   * keys of the class table (`firstOneOf`, `routeAlternative`), so both sides have to spell it the
   * same way and the spelling is the game's. What a PERSON reads is `prettyGuard` below, and that
   * one asks the manager's resolver.
   *
   * ⚠ A RANDOM ROW HAS NO CLASS, so it gets the word the backend gives it — `random_<key>` — which
   * matches no actor and is not meant to. It is what a patrol's own row is keyed by, so the two
   * have to spell it the same way.
   */
  function guardWordOf(t) {
    if (t && t.random) return 'random_' + String(t.random).replace(/[^a-z0-9_]/gi, '');
    var raw = String((t.route === 'persistent' ? t.spawnName : t.classPath) || '').trim();
    if (!raw) return '';
    return raw.split('/').pop().split('.').pop().replace(/_C$/, '');
  }

  /**
   * ── WHICH WIRE THIS GUARD REALLY GOES OUT ON ──────────────────────────────────────────────────
   *
   * ⚠ **READ, NEVER RE-DERIVED.** Since bridge 2.27.0 a guard picked from the NPC, Zombie or
   * Animal picker is sent by the ENGINE rather than by the game's own command, because only that
   * way does it survive the encounter manager's 175 m cull. Working that out needs the bridge's
   * version, the shipped class catalogue and the `/Script/` rule, and a copy of it here would be a
   * second rule over three inputs — the six-disagreeing-prefix-strips shape this project already
   * paid for. `/status` publishes the list of guard words that are on the engine route, and this
   * only looks in it.
   *
   * With no status yet — the first paint, an older backend — it falls back to the owner's own
   * choice, which is exactly what this page drew before any of this existed.
   */
  function onEngineRoute(t) {
    if (!t || t.random) return false;
    var sr = state.status && state.status.spawnRoute;
    if (!sr || !Array.isArray(sr.engine)) return t.route !== 'persistent';
    return sr.engine.indexOf(guardWordOf(t)) >= 0;
  }
  /** True only where the plugin moved a guard off the route its own row names. */
  function routeMoved(t) {
    return !!t && !t.random && t.route === 'persistent' && onEngineRoute(t);
  }

  /**
   * ── A GUARD'S NAME AS A PERSON READS IT ────────────────────────────────────────────────────────
   *
   * ⚠ **THIS USED TO BE THE FOURTH COPY OF ONE PREFIX-STRIP RULE, AND THE PROJECT ALREADY KNOWS
   * WHAT THAT COSTS.** `String(cls).replace(/^BP_|_C$/g, '')` had grown six times across the panel
   * and the Discord commands and the copies disagreed — `BP_Fortification_Planks_C` read "Planks"
   * in one place and "Fortification_Planks" in another. There is exactly one resolver for a game
   * code in this product and `SSA.itemInfo` is the way to it from a plugin's frontend: it is the
   * panel's own `/api/item-info`, which answers out of `src/discord/items.js` — the same table the
   * spawn picker, the kill feed and every Discord embed name a class from, in the reader's own
   * language.
   *
   * Three answers, in order, and none of them is a rule of this file's own:
   *
   *   · `label` — the name the PICKER handed over when this guard was chosen. It is the game's own
   *     word, it was stored with the guard, and it needs nobody;
   *   · the resolver's answer, cached, with the row redrawn once when it lands;
   *   · the code itself, unchanged, when the resolver could not be reached at all. A raw code is
   *     honest about that; a tidied one is this file inventing a name.
   */
  var actorName = {};        // word -> the resolver's answer, once it has really come back
  var actorTries = {};       // word -> how many times it has been asked, so this cannot loop
  var actorBusy = {};        // word -> in flight, so one render does not ask five times
  var actorSoon = null;
  /**
   * ⚠ **A LOOKUP THAT FAILED IS NOT AN ANSWER, AND LATCHING IT WOULD LEAVE A RAW CLASS ON THE
   * SCREEN FOR THE WHOLE SESSION.** `SSA.itemInfo` turns a failed fetch into an empty list, which
   * is indistinguishable from "the resolver has no such code" at the call site — so an answer is
   * only remembered when a ROW came back, and an empty one is retried on a later render. Capped at
   * three, because the alternative is one request per guard every fifteen seconds for as long as
   * the route is unhappy, against an API this tree has already watched answer 429.
   */
  function resolveActor(word) {
    if (Object.prototype.hasOwnProperty.call(actorName, word)) return actorName[word];
    if (actorBusy[word]) return null;
    if ((actorTries[word] || 0) >= 3) return null;
    if (typeof SSA.itemInfo !== 'function') { actorName[word] = null; return null; }
    actorBusy[word] = true;
    actorTries[word] = (actorTries[word] || 0) + 1;
    Promise.resolve(SSA.itemInfo([word])).then(function (rows) {
      actorBusy[word] = false;
      var r = (rows || [])[0];
      if (!r) return;                                  // nothing came back — ask again next render
      actorName[word] = r.name ? String(r.name) : null;
      // One redraw for however many names land together, so a zone with eight guards redraws once.
      if (actorSoon) return;
      actorSoon = setTimeout(function () { actorSoon = null; render(); }, 0);
    }).catch(function () { actorBusy[word] = false; });
    return null;
  }
  function prettyGuard(t) {
    var r = randomOf(t);
    if (r) return String(t.label || '').trim() || randomLabel(r.key);
    var w = guardWordOf(t);
    // The catalogue's own name is the GAME's word and stays exactly as it is.
    return String(t.label || '').trim() || (w ? (resolveActor(w) || w) : '')
      || T('pl.loot-zones.guard.nothingChosen', 'nothing chosen');
  }

  var addKind = 'npcs';
  var randomPick = 'zombie_safe';
  // ⚠ The VALUES are the picker's own domains and never move; only the words beside them do.
  var ADD_KINDS = ['npcs', 'zombies', 'animals', 'creatures', 'random'];
  function addKindLabel(k) {
    if (k === 'npcs') return T('pl.loot-zones.add.npcs', 'NPC');
    if (k === 'zombies') return T('pl.loot-zones.add.zombies', 'Zombie');
    if (k === 'animals') return T('pl.loot-zones.add.animals', 'Animal');
    if (k === 'creatures') return T('pl.loot-zones.add.creatures', 'Boss or creature');
    return T('pl.loot-zones.add.random', 'Random — no class');
  }
  var PERSISTENT_KIND = { npcs: 'armednpc', zombies: 'zombie', animals: 'animal' };

  /**
   * Does the BRIDGE read this guard as a boss?
   *
   * ⚠ **THE SAME TEST THE BRIDGE MAKES, ON THE SAME STRING.** Its `looks_like_boss()` reads the class
   * PATH and never the kind a caller asked for — so a Razor added from the creature picker is still a
   * boss, and the spawn is refused unless the boss switch is on. Two different tests either side of
   * the wire would let this screen promise a guard the bridge then refuses, which is exactly the kind
   * of refusal nobody can act on.
   */
  var BOSS_PATH = /brenner|razor|dropship|sentry/i;
  function looksLikeBoss(t) {
    return !!t && t.route !== 'persistent' && BOSS_PATH.test(String(t.classPath || ''));
  }

  /**
   * Which of the two routes a guard takes, in the owner's words — and it decides whether the guard is
   * still there tomorrow.
   *
   * Until now which route you got was a hidden consequence of which picker you happened to open: NPC,
   * Zombie and Animal go through the game's own spawn command, and *Boss or creature* is placed
   * directly because that is the only route the bridge offers for those. One of the two survives a
   * restart and the other does not, and nothing on this page said so.
   */
  function routeOf(t) {
    var r = randomOf(t);
    if (r) {
      return {
        // ⚠ TWO WHOLE SENTENCES rather than one with the creature's noun spliced into the middle:
        // a language that inflects "any puppet standing on it" differently cannot be served by a
        // sentence whose subject arrives as a variable.
        badge: T('pl.loot-zones.badge.random', 'random, no identity'), cls: 'lz-badge wait',
        text: r.kindWord === 'animal'
          ? T('pl.loot-zones.route.random.animal',
            'Random animal; nothing to load. Any animal on the spot counts, so refills may stop.')
          : T('pl.loot-zones.route.random.puppet',
            'Random puppet; nothing to load. Any puppet on the spot counts, so refills may stop.'),
      };
    }
    return t.route === 'persistent'
      ? {
        badge: T('pl.loot-zones.badge.gameSpawn', 'game spawn'), cls: 'lz-badge good',
        text: T('pl.loot-zones.route.persistent',
          'Spawned by the game\'s spawn command, as one of its own. Needs somebody online.'),
      }
      : {
        badge: T('pl.loot-zones.badge.direct', 'gone at restart'), cls: 'lz-badge wait',
        text: T('pl.loot-zones.route.direct',
          'Placed directly. Gone at the next restart; the zone puts it back when players return.'),
      };
  }

  /**
   * ⚠ **A CLASS THE GAME HAS NEVER MADE CANNOT BE PLACED DIRECTLY, AND THAT IS DECIDABLE HERE.**
   *
   * The direct route resolves a blueprint class that is already in memory, and Unreal loads one the
   * first time the game creates it — so on a server that has never had a Razor, a Razor guard is a
   * configuration that is known not to work the moment it is chosen. It used to be found out three
   * patrols later, as a refusal explaining asynchronous asset loading and pointing at a control that
   * is not on this row: the bridge offers NO lasting route for a boss, so "switch it to the game's own
   * spawn" was advice nobody could take.
   *
   * There are three answers and the row says which one this guard has, before it is saved:
   *
   *   null               an ordinary creature — the game makes these all the time, nothing to say
   *   { auto: true }     the game has a command that can be AIMED, so the zone places the first one
   *                      with that and every one after it the direct way
   *   { atPlayer: true } ⚠ **THE COMMAND WORKS AND CANNOT BE AIMED.** Both boss verbs really do
   *                      spawn — `SpawnBrenner` bare put a Brenner 1.1 m from the player — and
   *                      neither takes a place: `SpawnBrenner_C` declares no arguments at all and
   *                      `SpawnRazor_C` declares one it evidently ignores, and four spellings of it
   *                      all landed on the player who ran the command, 100 to 120 m from the post.
   *                      So this is **a capability with a cost**, not a refusal, and it is the only
   *                      thing that brings a boss's class into memory on a server that has never
   *                      made one. It is behind a switch because of where the boss arrives.
   *   { auto: false }    it has no command anywhere in the game's 233, so it can only be placed once
   *                      the game itself has made one
   */
  function firstOneOf(t) {
    // A random row resolves no class at all, so none of this applies to it.
    if (!t || t.random || t.route === 'persistent' || !looksLikeBoss(t)) return null;
    // ⚠ NOT FETCHED YET IS NOT "IT HAS NO COMMAND". The table is fetched when a guard is ADDED, so a
    // saved configuration draws its rows before it has arrived — and answering the pessimistic case
    // from an absent table would tell the owner of a Razor the exact opposite of the truth. Silence
    // until it is here; `guardRows` asks for it and redraws.
    if (!classTable) return null;
    var e = (classTable.gameSpawn || {})[guardWordOf(t)];
    if (e && e.places) return { auto: true, verb: e.verb };
    // ⚠ `atPlayer`, which is the catalogue's own key and the one the backend's refusal branches on.
    // A verb that WORKS and cannot be aimed is a third answer, and reading it as either of the other
    // two is how this row came to promise the opposite of the truth twice running: once that a boss
    // would appear at its post, and once that it would never be sent at all.
    if (e && e.verb && e.atPlayer) return { atPlayer: true, verb: e.verb };
    return { auto: false };
  }

  /* THE PER-GUARD COPY OF THAT SWITCH IS GONE TOO, AND FOR THE SAME REASON.
   *
   * One row could answer the boss question for itself, inheriting the zone's answer when it did
   * not. With the question itself withdrawn there is nothing to answer: the backend reads no such
   * key, so a row drawing it would be offering a choice that changes nothing — which is worse than
   * an absent feature, because somebody sets it, watches nothing happen, and concludes the plugin
   * is broken. The generic overrides fold is what surfaces a leftover value now. */

  /** kind in the class table -> the spawn kind SCUM's own command takes. */
  var LASTING_KIND = { npc: 'armednpc', puppet: 'zombie', animal: 'animal' };

  /**
   * THE OTHER ROUTE, WHERE THE GAME LEAVES ONE — or `null`.
   *
   * ⚠ **THE ROUTE USED TO BE DECIDED BY WHICH ENTRY OF THE ADD MENU A GUARD CAME FROM, AND BY
   * NOTHING ELSE.** NPCs, zombies and animals were always sent through SCUM's own spawn command and
   * a boss or a sentry was always placed directly, because that is the only route the bridge offers
   * for those. That was invisible and it was also unactionable: when a post rests because nothing
   * was ever seen standing on it, the backend's own refusal offers the direct route — which can be
   * asked whether the guard it made is alive — and for an NPC there was no way to take it. A
   * sentence an owner cannot act on is the defect, not the advice.
   *
   * The swap is a lookup in both directions over the one class table, so it can only ever produce a
   * guard the other route really accepts. It answers `null` — and the row keeps its plain badge —
   * for a boss, a sentry, a dropship or a drone, because SCUM's `#SpawnBrenner` takes no arguments
   * at all and `#SpawnRazor` takes a shape nobody here has driven. Offering it would be the same
   * defect wearing the other hat.
   */
  function routeAlternative(t) {
    if (t && t.random) return null;                  // it has no class, so there is no other route
    if (!classTable) return null;                    // not fetched yet; the row shows the badge
    var classes = classTable.classes || {};
    var kinds = classTable.kinds || {};
    if (t.route === 'persistent') {
      var code = String(t.spawnName || '');
      var cls = classes[code];
      if (!cls) return null;
      /**
       * ⚠ **THE `label` THAT USED TO BE HERE IS GONE, AND ITS COMMENT IS WHY IT HAD TO GO.** It
       * said "placed directly" and "through the game's own spawn", excused as reaching no screen —
       * and the backend then quoted *set this guard to "placed directly"* at an owner, naming a
       * control that exists in no language including English: the box on this row is a two-option
       * select reading "game spawn" and "gone at restart". An English control name sitting in a
       * field nothing renders is the precedent that makes the next one look reasonable, so there is
       * nothing here to copy. The two words a reader sees are `badge.gameSpawn` and `badge.direct`.
       */
      return { apply: function () {
        t.route = 'spawn'; t.classPath = cls; t.kind = kinds[code] || 'npc'; t.spawnName = '';
      } };
    }
    var path = String(t.classPath || '');
    if (!path || BOSS_PATH.test(path)) return null;  // no lasting route exists for these
    var found = null;
    Object.keys(classes).forEach(function (k) { if (!found && classes[k] === path) found = k; });
    if (!found) return null;
    var lasting = LASTING_KIND[kinds[found] || t.kind];
    if (!lasting) return null;
    return { apply: function () {
      t.route = 'persistent'; t.spawnName = found; t.spawnKind = lasting; t.classPath = '';
    } };
  }

  /**
   * What this guard DOES once it is standing there.
   *
   * Measured on a live server rather than assumed, because "a guard" and "an NPC that walks at you"
   * are different things to put in a zone and the picker's own names do not say which is which.
   */
  function behaviourOf(t) {
    var rnd = randomOf(t);
    if (rnd) {
      return randomNote(rnd.key) + T('pl.loot-zones.behaviour.random',
        ' What appears is not known in advance, and acts as that creature does.');
    }
    var w = guardWordOf(t);
    var kind = t.route === 'persistent' ? String(t.spawnKind || 'armednpc') : String(t.kind || 'npc');
    if (/drifter/i.test(w)) {
      return T('pl.loot-zones.behaviour.drifter',
        'A Drifter walks towards players and does not stay on its place.');
    }
    if (/guard/i.test(w)) {
      return T('pl.loot-zones.behaviour.guard', 'A Guard stands at its place and returns to it.');
    }
    if (kind === 'zombie' || kind === 'puppet' || /zombie|puppet/i.test(w)) {
      return T('pl.loot-zones.behaviour.puppet', 'A puppet wanders like any zombie and drifts off its place.');
    }
    if (looksLikeBoss(t)) {
      return T('pl.loot-zones.behaviour.boss',
        'Stands where placed. A sentry placed this way may never fire.');
    }
    if (kind === 'animal') {
      return T('pl.loot-zones.behaviour.animal', 'An animal, behaving as the game\'s animals do: it moves about on its own.');
    }
    return T('pl.loot-zones.behaviour.other', 'What it does once it is there is the game\'s own behaviour for that class.');
  }

  /**
   * The ONE bridge switch this guard needs, by the label on the bridge's own card.
   *
   * ⚠ A boss needs the boss switch and NOT *Creatures*: the bridge runs its boss guard first and
   * skips the kind's own switch for it, so asking for both would be asking for a switch the spawn
   * never consults.
   */
  // ⚠ `card` and `label` are the BRIDGE'S OWN captions, on the bridge's own cards — the words an
  // owner has to go and find. They are quoted, never translated, exactly as the labels the
  // /bridge-check route hands back are: a translated copy would send somebody looking for a control
  // that does not carry those words.
  function switchFor(t) {
    // ⚠ A RANDOM ROW GOES THROUGH THE GAME'S OWN ADMIN COMMAND, not through the bridge's spawn
    // module, so none of the three spawn switches governs it. Naming one anyway would send an owner
    // to turn on a control that decides nothing about this row — the refusal-that-points-nowhere
    // defect, in the opposite direction.
    if (t.random) return null;
    // ⚠ THE ROUTE IT IS REALLY ON. A guard the plugin moved onto the engine route no longer goes
    // near `spawn.persistent`, and naming that switch would send an owner to turn on a control
    // this guard's spawn never consults — the refusal-that-points-nowhere defect, in the
    // direction where the control exists and simply governs something else.
    if (!onEngineRoute(t)) {
      return { key: 'spawn.persistent', card: 'Precise spawning',
        label: 'Also spawn things that LAST, through the game\'s admin commands' };
    }
    if (looksLikeBoss(t)) {
      return { key: 'spawn.bosses', card: 'Precise spawning', label: 'Bosses (Brenner, Razor, Dropship, Sentry)' };
    }
    return { key: 'spawn.creatures', card: 'Precise spawning',
      label: 'Creatures (animals, puppets, NPCs, drones, sentries)' };
  }

  /** What the Bridge box at the top of the tab said about one switch, or null if it said nothing. */
  function bridgeStateOf(key) {
    var items = (state.bridge && state.bridge.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].module + '.' + items[i].key === key) return items[i].state;
    }
    return null;
  }

  /** Every guard this whole configuration would really send, across the page default and every zone. */
  function allChosenGuards(c) {
    var out = [];
    [c.sentries || {}].concat((c.zones || []).map(function (z) { return z && z.sentries; }))
      .forEach(function (sm) {
        if (!sm || sm.mode !== 'replace') return;
        chosenGuards(sm.replace || {}).forEach(function (t) { out.push(t); });
      });
    return out;
  }

  /** A small labelled number, for the three that sit side by side on a guard's row. */
  function guardNum(label, control, caption) {
    return h('div', { class: 'lz-ctl' }, [h('small', {}, label), control, caption ? h('small', {}, caption) : null]);
  }

  // ── a guard's own settings, over the zone's ────────────────────────────────────────────────────
  /**
   * ⚠ **ABSENT MEANS INHERIT, SO THE TEST IS KEY PRESENCE AND NEVER TRUTHINESS.** `0` is "no
   * cooldown at all" and `false` is somebody's answer; both are falsy and both are settings. A
   * truthiness test here draws them as inherited, and the next edit writes the zone's value over the
   * choice somebody made. It is the same rule the backend merges a config by, one layer in.
   */
  function hasOwnKey(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  /**
   * What a guard's entry IS, rather than a setting it may have its own copy of.
   *
   * These are never offered as overrides: `classPath` and its siblings are WHICH GUARD this is, and
   * `want` / `count` / `weight` already have their own boxes across the top of the row.
   */
  var GUARD_IDENTITY = ['route', 'kind', 'classPath', 'spawnKind', 'spawnName', 'types',
    'want', 'count', 'weight', 'label',
    // `random` is WHICH GUARD this is — it replaces the class entirely, and is drawn by a control
    // of its own below, so the generic form must not touch it or report it as a leftover.
    //
    // ⚠ `bossAtPlayer` and `_zoneBossAtPlayer` were here for the same reason and are DELIBERATELY
    // GONE. The switch they belonged to has been withdrawn and the backend reads neither, so a
    // value left in somebody's saved config is now exactly what this list is protecting real
    // settings FROM: a key nothing reads. Keeping them here would hide it; letting them through
    // means the overrides fold shows the value, says nothing reads it, and offers Remove it —
    // which is the third state this tab already has for precisely this case.
    'random'];

  /**
   * The words for the keys this page already draws a zone-level row for, so an override reads as the
   * SAME setting rather than as a second one with a different name.
   *
   * A key with no entry here is still offered — humanised, with a control chosen from the value's own
   * kind, which is what the panel's own settings screens do for an ini key nothing declares. So a
   * setting the backend gains is on this screen the day it exists rather than the day somebody
   * remembers this table.
   */
  function guardKey(k) {
    if (k === 'maxGuards') {
      return { label: labMaxGuards(), unit: T('pl.loot-zones.unit.guards', 'guards'), min: 0, max: 50,
        hint: T('pl.loot-zones.gk.maxGuards.hint', 'Every kind of guard together. 0 means as many as there are places.'),
        zoneOnly: T('pl.loot-zones.gk.maxGuards.zoneOnly',
          'Counts every guard in the zone, so it is the zone\'s: "{label}" above.', { label: labMaxGuards() }) };
    }
    if (k === 'cooldownSeconds') {
      return { label: labCooldown(), unit: T('pl.loot-zones.unit.minutes', 'minutes'), scale: MIN, min: 0, max: 60,
        hint: T('pl.loot-zones.gk.cooldown.hint', 'How long the zone waits after sending one before it sends the next.'),
        zoneOnly: T('pl.loot-zones.gk.cooldown.zoneOnly',
          'One guard is sent at a time, so this is the zone\'s: "{label}" above.', { label: labCooldown() }) };
    }
    if (k === 'afterDeathSeconds') {
      return { label: T('pl.loot-zones.set.afterDeath', 'After a guard is killed, wait'),
        unit: T('pl.loot-zones.unit.minutes', 'minutes'), scale: MIN, min: 0, max: 1440,
        hint: T('pl.loot-zones.gk.afterDeath.hint', 'How long this guard\'s place stands empty before its replacement comes.') };
    }
    if (k === 'keepAwayFromPlayers') {
      return { label: T('pl.loot-zones.set.keepAway', 'Never appear closer to a player than'),
        unit: T('pl.loot-zones.unit.metres', 'm'), scale: M, min: 0, max: 1000,
        hint: T('pl.loot-zones.gk.keepAway.hint', 'A place with a player this close waits until they move away.') };
    }
    if (k === 'maxPosts') {
      return { label: labMaxPosts(), unit: T('pl.loot-zones.unit.places', 'places'), min: 1, max: 60,
        zoneOnly: T('pl.loot-zones.gk.maxPosts.zoneOnly',
          'Places are chosen before guards, so this ceiling belongs to the zone: under {fold} above.', { fold: labTechnical() }) };
    }
    if (k === 'postRadius') {
      return { label: T('pl.loot-zones.gk.postRadius', 'How far apart the places are'),
        unit: T('pl.loot-zones.unit.metres', 'm'), scale: M, min: 0, max: 500 };
    }
    return {};
  }

  /** `afterDeathSeconds` -> "After death seconds", for a key nothing here has words for yet. */
  function humanKey(k) {
    var s = String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /**
   * Which zone settings a guard may hold its own copy of.
   *
   * ⚠ **THE BACKEND'S OWN LIST, NEVER ONE DERIVED HERE.** `/status` publishes `guardOverridable`,
   * and it is three of the six this screen used to work out for itself: `maxGuards`,
   * `cooldownSeconds` and `maxPosts` are zone-wide and an entry carrying one is READ AND DISCARDED.
   * Offering a box for those is a setting somebody can set that nothing implements — the defect
   * `check-config-read` exists for, one layer out — so they are named as the zone's instead of being
   * left to be dropped in silence.
   *
   * ⚠ **AND WITH NO LIST, NOTHING IS OFFERED.** An answer that has not arrived and a backend too old
   * to have the field look alike from here, and guessing in that state is guessing in the direction
   * that invents settings. It costs nothing but capability, and it comes back the moment `/status`
   * answers.
   */
  function allowedGuardKeys() {
    var said = state.status && state.status.guardOverridable;
    return Array.isArray(said) ? said.slice() : null;
  }

  /**
   * Every key this guard's row has to DRAW: the ones it may hold, plus any it is already holding.
   *
   * The second half is not a nicety. Nothing strips an unknown key out of a saved configuration, so
   * a `maxGuards` written onto an entry by an older build of this tab sits there for ever, doing
   * nothing, invisible — and a screen that simply stopped showing it would be the reason nobody
   * could ever take it out again. It is drawn as **not used**, with a button that removes it.
   */
  function overridableKeys(rp, t) {
    var allow = allowedGuardKeys() || [];
    var out = [];
    function add(k) {
      if (GUARD_IDENTITY.indexOf(k) >= 0 || out.indexOf(k) >= 0) return;
      var v = hasOwnKey(t, k) ? t[k] : (rp || {})[k];
      // A block of its own is not something one row can edit — `gameTime` is the one that matters
      // and it has its own rows below, built for a window rather than for a number.
      if (v !== null && typeof v === 'object') return;
      out.push(k);
    }
    allow.forEach(add);
    Object.keys(t || {}).forEach(add);
    return out;
  }

  /** A key an entry is carrying that the backend does not read. */
  function isStaleGuardKey(k) {
    var allow = allowedGuardKeys();
    return !!allow && allow.indexOf(k) < 0;
  }

  /** The zone's own value for one key, in the words the box beside it uses. */
  function showGuardValue(k, v) {
    var meta = guardKey(k);
    if (v === undefined) return T('pl.loot-zones.value.unset', 'nothing set');
    if (typeof v === 'boolean') return v ? T('pl.loot-zones.badge.on', 'on') : T('pl.loot-zones.badge.off', 'off');
    if (v === null || v === '') return T('pl.loot-zones.value.empty', 'empty');
    if (typeof v === 'number') {
      var n = meta.scale ? Math.round((v / meta.scale) * 100) / 100 : v;
      return meta.unit ? T('pl.loot-zones.value.withUnit', '{n} {unit}', { n: n, unit: meta.unit }) : String(n);
    }
    return String(v);
  }

  /** The control for one key, chosen from the value's own kind. */
  function guardValueControl(k, v, on) {
    var meta = guardKey(k);
    if (typeof v === 'boolean') return toggle(v, on);
    if (typeof v === 'number') return numIn(v, on, meta.min, meta.max, meta.unit, meta.scale);
    return txt(v == null ? '' : v, '', on);
  }

  /** How many of this zone's guards carry their own value for one key. */
  function ownersOf(rp, key) {
    return (Array.isArray(rp && rp.types) ? rp.types : [])
      .filter(function (t) { return hasOwnKey(t, key); }).length;
  }

  /**
   * The caption that stops a ZONE-LEVEL number from lying.
   *
   * The mirror of the fold below: a zone number with three guards ignoring it is not the number that
   * governs those guards, and a screen showing it alone reads as though it were.
   */
  function overriddenNote(rp, key) {
    var n = ownersOf(rp, key);
    if (!n) return null;
    return n === 1 ? T('pl.loot-zones.ovr.ownersOne', '1 guard uses its own')
      : T('pl.loot-zones.ovr.ownersMany', '{n} guards use their own', { n: n });
  }

  /** Two captions under one control, either of which may be absent. */
  function caps() {
    var bits = [];
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) bits.push(arguments[i]);
    return bits.length ? bits.join('  ·  ') : null;
  }

  /**
   * One guard's own settings — and, the half that is the whole point, WHICH OF THEM ARE ITS OWN.
   *
   * ⚠ **A SCREEN THAT DRAWS AN INHERITED VALUE AS THOUGH IT WERE SET IS THE DEFECT HERE.** An owner
   * editing what looks like a box for this guard, and finding they have moved every guard in the
   * zone, is exactly the kind of "partly working" this plugin is being rebuilt for. So an inherited
   * row is NEVER an editable box: it is the zone's value in words, marked "from the zone", with one
   * button that makes it this guard's. A row that IS its own carries the box, is marked "set here",
   * and carries the button that gives it back. The two states cannot be confused by looking, and
   * nothing can be changed without also changing which of the two it is.
   */
  function guardOverrides(t, rp, scope, i, patRow) {
    var keys = overridableKeys(rp, t);
    var gt = gameTimeRows(t, rp, patRow);
    if (!keys.length && !gt.rows.length) return null;
    var mine = keys.filter(function (k) { return hasOwnKey(t, k); }).concat(gt.mine);
    var rows = keys.map(function (k) {
      var meta = guardKey(k);
      var own = hasOwnKey(t, k);
      var zoneVal = (rp || {})[k];
      /**
       * ⚠ **A KEY THE BACKEND DOES NOT READ IS NOT AN OVERRIDE, AND MUST NOT LOOK LIKE ONE.** It
       * gets no box and no "set here": a value, the sentence naming the zone control that really
       * governs it, and one button that takes it out.
       */
      if (own && isStaleGuardKey(k)) {
        return h('div', { class: 'lz-ovr stale' }, [
          h('div', { class: 'lz-ovr-head' }, [
            h('span', { class: 'lz-ovr-label' }, meta.label || humanKey(k)),
            h('span', { class: 'lz-badge wait' }, T('pl.loot-zones.ovr.notUsed', 'not used')),
          ]),
          h('div', { class: 'lz-routes' }, [
            h('small', { class: 'lz-ovr-from' }, T('pl.loot-zones.ovr.setOnGuard', 'Set on this guard: {value}',
              { value: showGuardValue(k, t[k]) })),
            h('button', {
              class: 'lz-link', type: 'button', title: T('pl.loot-zones.ovr.staleTitle', 'Take this leftover off the guard'),
              onclick: function () { delete t[k]; markDirty(); },
            }, T('pl.loot-zones.ovr.remove', 'Remove it')),
          ]),
          /**
           * ⚠ **A SETTING THE BACKEND NO LONGER READS IS A THIRD STATE**, and it is neither a
           * window that is closed nor a setting that is not being applied for want of a reading:
           * this one is a leftover that ought to be taken out. Its own key, so a translator is not
           * left choosing between the three.
           */
          h('small', { class: 'lz-warn' }, T('pl.loot-zones.ovr.stale',
            '⚠ This one is not read per guard — whatever is set here '
            + 'is ignored. {where}', { where: meta.zoneOnly || T('pl.loot-zones.ovr.stale.zone', 'It belongs to the zone.') })),
        ]);
      }
      return h('div', { class: 'lz-ovr' + (own ? ' own' : '') }, [
        h('div', { class: 'lz-ovr-head' }, [
          h('span', { class: 'lz-ovr-label' }, meta.label || humanKey(k)),
          h('span', { class: 'lz-badge' + (own ? ' on' : '') },
            own ? T('pl.loot-zones.ovr.setHere', 'set here') : T('pl.loot-zones.ovr.fromZone', 'from the zone')),
        ]),
        own
          ? h('div', { class: 'lz-routes' }, [
            guardValueControl(k, t[k], function (v) { t[k] = v; markDirty(); }),
            h('button', {
              class: 'lz-link', type: 'button',
              title: T('pl.loot-zones.ovr.useZoneTitle', 'Drop this guard\'s own value and follow the zone again'),
              // `delete`, never a write of the zone's value: the two are indistinguishable today and
              // opposite the moment the zone's own number is changed.
              onclick: function () { delete t[k]; markDirty(); },
            }, T('pl.loot-zones.ovr.useZone', 'Use the zone\'s')),
          ])
          : h('div', { class: 'lz-routes' }, [
            h('small', { class: 'lz-ovr-from' }, T('pl.loot-zones.ovr.zoneValue', 'The zone\'s: {value}',
              { value: showGuardValue(k, zoneVal) })),
            h('button', {
              class: 'lz-link', type: 'button',
              title: T('pl.loot-zones.ovr.setValueTitle', 'Give this guard a value of its own, starting from the one it is following'),
              onclick: function () {
                // Seeded from what it was ALREADY following, so taking its own value changes nothing
                // until a number is typed — the same rule a zone follows when it takes its own
                // guards. Where the zone has nothing either there is no value to copy, so the row
                // opens on the empty shape its own words imply: a number where this page has a unit
                // for the key, and a box otherwise.
                t[k] = (zoneVal === undefined || zoneVal === null) ? (meta.unit ? 0 : '') : zoneVal;
                markDirty();
              },
            }, T('pl.loot-zones.ovr.setHereButton', 'Set for this guard')),
          ]),
        meta.hint ? h('small', {}, meta.hint) : null,
        (!own && zoneVal === undefined) ? h('small', { class: 'lz-warn' },
          T('pl.loot-zones.ovr.noZoneValue', 'The zone has no value either, so the plugin default applies.')) : null,
      ]);
    });
    var all = rows.concat(gt.rows);
    if (mine.length) {
      all.push(h('div', { class: 'lz-actions' }, [
        h('button', {
          class: 'secondary', type: 'button',
          title: T('pl.loot-zones.ovr.followAllTitle', 'Drop this guard\'s own values and follow the zone for all of them'),
          onclick: function () {
            keys.forEach(function (k) { if (hasOwnKey(t, k)) delete t[k]; });
            delete t.gameTime;
            markDirty();
          },
        }, [icon('refresh'), T('pl.loot-zones.ovr.followAll', 'Follow the zone for all {n}', { n: mine.length })]),
      ]));
    }
    all.push(h('small', {}, T('pl.loot-zones.ovr.foot',
      'Unset values follow the zone; "{maxGuards}", "{cooldown}" and the place limit are zone-wide.',
      { maxGuards: labMaxGuards(), cooldown: labCooldown() })));
    var total = keys.length + gt.rows.length;
    return more('ovr:' + scope + ':' + i,
      T('pl.loot-zones.ovr.fold', '{title}  ·  {state}', {
        title: labPerGuard(),
        state: mine.length
          ? T('pl.loot-zones.ovr.foldSome', '{n} of {total} set here', { n: mine.length, total: total })
          : T('pl.loot-zones.ovr.foldNone', 'all {total} from the zone', { total: total }),
      }),
      all,
      // Open where this guard really differs from its zone — that is the whole thing this fold is
      // for, and a difference behind a click is a difference nobody finds.
      mine.length > 0);
  }

  // ── a guard's own hours, on the GAME'S clock ──────────────────────────────────────────────────
  /**
   * ⚠ **THE UNIT IS GAME HOURS AND IT IS SAID BESIDE EVERY NUMBER.** This tree has shipped three
   * duration bugs from a bare figure on a screen, and this one is the easiest of all to misread: the
   * game's clock runs at the owner's own `TimeOfDaySpeed`, so "from 21 to 5" is a stretch of the
   * game's night rather than eight hours of anybody's evening.
   *
   * The window is three keys — `enabled`, `fromHour`, `toHour` — merged over the zone's ONE KEY AT A
   * TIME by the backend, so they are drawn one at a time here too. `0` is midnight and is a value
   * somebody chose, so every test is key presence.
   */
  var GT_KEY = ['enabled', 'fromHour', 'toHour'];
  /** That window's three labels and their captions, each written literally at its own key. */
  function gtLabel(k) {
    if (k === 'enabled') return T('pl.loot-zones.set.gameHours', 'Only at these game hours');
    if (k === 'fromHour') return T('pl.loot-zones.gt.from', 'From');
    return T('pl.loot-zones.gt.to', 'Until');
  }
  function gtCaption(k) {
    if (k === 'fromHour') return T('pl.loot-zones.gt.from.cap', 'game clock, this hour included');
    if (k === 'toHour') return T('pl.loot-zones.gt.to.cap', 'game clock, this hour NOT included');
    return null;
  }

  function gameTimeRows(t, rp, patRow) {
    var zoneGT = (rp && rp.gameTime && typeof rp.gameTime === 'object') ? rp.gameTime : null;
    var ownGT = (t.gameTime && typeof t.gameTime === 'object') ? t.gameTime : null;
    // The zone has no window block at all on a backend that predates it: nothing to inherit from
    // and nothing to offer, which is not the same as a window that is switched off.
    if (!zoneGT && !ownGT) return { rows: [], mine: [] };
    var mine = [];
    var eff = function (k) { return (ownGT && hasOwnKey(ownGT, k)) ? ownGT[k] : (zoneGT || {})[k]; };
    var rows = GT_KEY.map(function (k) {
      var own = !!(ownGT && hasOwnKey(ownGT, k));
      if (own) mine.push('gameTime.' + k);
      var zoneVal = (zoneGT || {})[k];
      var write = function (v) {
        if (!t.gameTime || typeof t.gameTime !== 'object') t.gameTime = {};
        t.gameTime[k] = v; markDirty();
      };
      var giveBack = function () {
        if (t.gameTime) {
          delete t.gameTime[k];
          if (!Object.keys(t.gameTime).length) delete t.gameTime;
        }
        markDirty();
      };
      return h('div', { class: 'lz-ovr' + (own ? ' own' : '') }, [
        h('div', { class: 'lz-ovr-head' }, [
          h('span', { class: 'lz-ovr-label' }, gtLabel(k)),
          h('span', { class: 'lz-badge' + (own ? ' on' : '') },
            own ? T('pl.loot-zones.ovr.setHere', 'set here') : T('pl.loot-zones.ovr.fromZone', 'from the zone')),
        ]),
        own
          ? h('div', { class: 'lz-routes' }, [
            k === 'enabled'
              ? toggle(!!ownGT[k], function (v) { write(v); })
              : numIn(ownGT[k], function (v) { write(Math.max(0, Math.min(24, v))); }, 0, 24, T('pl.loot-zones.unit.gameHours', 'game hours')),
            h('button', {
              class: 'lz-link', type: 'button', title: T('pl.loot-zones.ovr.useZoneWindowTitle', 'Follow the zone\'s window again'),
              onclick: giveBack,
            }, T('pl.loot-zones.ovr.useZone', 'Use the zone\'s')),
          ])
          : h('div', { class: 'lz-routes' }, [
            h('small', { class: 'lz-ovr-from' }, T('pl.loot-zones.ovr.zoneValue', 'The zone\'s: {value}', {
              value: k === 'enabled'
                ? (zoneVal ? T('pl.loot-zones.badge.on', 'on') : T('pl.loot-zones.badge.off', 'off'))
                : (zoneVal == null ? T('pl.loot-zones.value.unset', 'nothing set')
                  : T('pl.loot-zones.gt.clockValue', '{t} (game clock)', { t: hhmm(zoneVal) })),
            })),
            h('button', {
              class: 'lz-link', type: 'button',
              title: T('pl.loot-zones.ovr.setWindowTitle', 'Give this guard its own, starting from the zone\'s'),
              onclick: function () { write(zoneVal === undefined ? (k === 'enabled' ? false : 0) : zoneVal); },
            }, T('pl.loot-zones.ovr.setHereButton', 'Set for this guard')),
          ]),
        gtCaption(k) ? h('small', {}, gtCaption(k)) : null,
      ]);
    });
    // One sentence under the three, saying what they add up to and what is really happening now.
    rows.push(h('small', {}, gameTimeSentence(eff, patRow, t)));
    return { rows: rows, mine: mine };
  }

  /** A whole game hour as a clock face. The window bounds are whole hours by the backend's own rule. */
  function hhmm(v) {
    var n = Math.max(0, Math.min(24, Math.round(Number(v) || 0)));
    return (n === 24 ? '24' : ('0' + n).slice(-2)) + ':00';
  }
  /**
   * The game's clock READING, which is not a whole hour.
   *
   * ⚠ Rounding it to one loses the half the reader is standing in — 22.5 is half past ten at night
   * and `hhmm` would print it as eleven. Different question, different formatter.
   */
  function gameClockText(v) {
    var n = Math.max(0, Math.min(24, Number(v) || 0));
    var hrs = Math.floor(n);
    var mins = Math.round((n - hrs) * 60);
    if (mins === 60) { hrs += 1; mins = 0; }
    return ('0' + (hrs % 24)).slice(-2) + ':' + ('0' + mins).slice(-2);
  }

  /**
   * What this guard's window means — and, when a patrol has run, whether it is IN FORCE.
   *
   * ⚠ **`applied` IS NOT `open`, AND THAT IS THE WHOLE SENTENCE.** When the game's clock cannot be
   * read the window is deliberately NOT applied and guards go on being sent exactly as they were
   * before anybody set one: closing instead would quietly disarm every zone the moment a bridge
   * switch went off. So a screen that shows only "open" or "closed" is telling a reader a schedule
   * is running when nothing of the sort is happening, and this says which of the three it is, every
   * round.
   */
  function gameTimeSentence(eff, patRow, t) {
    if (!eff('enabled')) {
      return T('pl.loot-zones.gt.noHours', 'No hours set: this guard is sent whenever the zone is being looked after.');
    }
    var from = eff('fromHour'); var to = eff('toHour');
    /**
     * Three whole sentences rather than one with two optional clauses posted into the middle of it.
     * The two conditions cannot both hold — `from > to` and `from === to` are exclusive, and so are
     * `from > to` and 0..24 — so there are exactly three, and each is a sentence a translator can
     * read end to end.
     */
    var wraps = Number(from) > Number(to);
    var always = Number(from) === Number(to) || (Number(from) === 0 && Number(to) === 24);
    var vars = { from: hhmm(from), to: hhmm(to) };
    var base = wraps
      ? T('pl.loot-zones.gt.base.wraps', 'Sent between {from} and {to} game time, across midnight. Guards already standing stay when it closes.', vars)
      : (always
        ? T('pl.loot-zones.gt.base.always', 'Sent between {from} and {to} game time, which covers every hour.', vars)
        : T('pl.loot-zones.gt.base', 'Sent between {from} and {to} game time. Guards already standing stay when it closes.', vars));
    var w = patWindowOf(patRow, t);
    if (!w) return base;
    /**
     * ⚠ **THREE STATES, THREE KEYS, AND THE FIRST TWO ARE OPPOSITES.**
     *
     *   notApplied  the clock could not be read, so the window is being IGNORED and every guard is
     *               sent exactly as it was before anybody set hours. Nothing is disarmed.
     *   closed      the window is in force and shut right now, so these posts are held back.
     *   open        the window is in force and open.
     *
     * A language that used one sentence for the first two would tell an owner their guards are held
     * back when they are all being sent, or that a zone is working when its hours were thrown away.
     */
    if (w.applied === false) {
      return base + T('pl.loot-zones.gt.notApplied',
        ' ⚠ Not applied: game clock unreadable, so guards come at any hour. See note above.');
    }
    return base + (w.open ? T('pl.loot-zones.gt.open', ' It is open right now.')
      : T('pl.loot-zones.gt.closed', ' It is closed right now, so these posts are '
        + 'not being filled.'));
  }

  /** The window row the last patrol published for THIS guard, matched on the game's own word. */
  function patWindowOf(patRow, t) {
    var list = (patRow && Array.isArray(patRow.types)) ? patRow.types : [];
    var word = guardWordOf(t);
    for (var i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].word || '') === word && list[i].window) return list[i].window;
    }
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // WHERE A GUARD STANDS — the owner's own coordinates, per guard
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  //
  // ⚠ **UNTIL NOW THE PLUGIN DECIDED WHERE AND THE OWNER DECIDED HOW MANY, AND THERE WAS NO THIRD
  // OPTION.** A creature could appear in exactly five kinds of place and not one of them could be
  // chosen: where a sentry had just been cleared, at one of a handful of cell centres of a regular
  // grid laid over the rectangle (identical every patrol and every restart — the whole of *"they
  // spawn in the same places"*), in a ring round a player on a server that allows no NPCs, on a
  // floor somebody had personally walked on underground, or shuffled a few metres after repeated
  // failures. None of that is a coordinate and none of it is the owner's.
  //
  // So a guard entry may now carry its own list of points. Absent, or empty, is exactly what every
  // configuration written before today has and behaves exactly as it does today — this is additive
  // by key presence and nothing already saved changes meaning.
  //
  // ⚠ **A POINT THAT CANNOT BE USED IS REFUSED BY NAME AND IS NEVER MOVED.** Somebody who typed a
  // coordinate meant that coordinate, and quietly standing the guard thirty metres away is the
  // sentry-swap failure this project already records for artwork, in the one place where it puts a
  // boss somewhere nobody chose. That is the backend's promise; what this screen owes is the three
  // ways of getting a coordinate that is right in the first place.

  /**
   * What the game said about a point, keyed by the POINT — its three numbers — and never by where
   * it sits in the list.
   *
   * ⚠ A verdict belongs to the coordinate it was taken at. Keying it on a position would leave
   * yesterday's answer sitting under a number somebody has since retyped, which is the one shape
   * that makes a check button worse than no check button. Change a digit and the old answer is
   * simply no longer about this point, which a key of the coordinates gives for nothing.
   */
  var spotSaid = {};
  function spotKey(p) { return [p && p.x, p && p.y, p && p.z].join('|'); }
  function spotReady(p) {
    return !!p && [p.x, p.y, p.z].every(function (v) { return v != null && v !== '' && isFinite(Number(v)); });
  }
  function atList(t) { return Array.isArray(t.at) ? t.at : []; }
  function atUsed(t) { return atList(t).filter(function (p) { return p && p.on !== false; }).length; }

  /**
   * ONE COORDINATE, IN CENTIMETRES.
   *
   * ⚠ **NOT metres, and not through numIn.** Every other distance on this page is a LENGTH and is
   * shown in the unit a person thinks in; this is a POSITION, and the game, the map, the bridge and
   * the console all speak the same centimetres — so converting it would mean an owner reading a
   * number off one screen and typing a different one into this.
   *
   * ⚠ **AN EMPTIED BOX WRITES null, NEVER 0.** Number('') is 0, and 0,0,0 is a real place on the
   * island: the admin console shipped that exact defect once and read an empty form as "aimed at
   * the origin". Deleting a figure is somebody clearing a box, not somebody choosing the map's
   * corner, and the check button refuses an incomplete point rather than guessing at it.
   */
  function coordIn(v, on) {
    var i = typed(h('input', { class: 'lz-in lz-num', type: 'number', step: '1',
      value: (v == null || v === '') ? '' : String(Math.round(Number(v))) }));
    i.addEventListener('change', function () {
      if (i.value === '' || !isFinite(Number(i.value))) { on(null); return; }
      on(Math.round(Number(i.value)));
    });
    return h('span', { class: 'lz-unitbox' }, [i, h('small', { class: 'lz-unit' }, T('pl.loot-zones.unit.cm', 'cm'))]);
  }

  /** The game's own reason, in a word this page has. A code it does not know answers null. */
  function spotKindWord(code) {
    if (code === 'water') return T('pl.loot-zones.at.kind.water', 'it is in water');
    if (code === 'structure') return T('pl.loot-zones.at.kind.structure', 'a structure is in the way');
    if (code === 'indoors') return T('pl.loot-zones.at.kind.indoors', 'it is inside a building');
    if (code === 'outside') return T('pl.loot-zones.at.kind.outside', 'it is outside this zone');
    if (code === 'no_ground') return T('pl.loot-zones.at.kind.noGround', 'there is nothing here to stand on');
    return null;
  }

  /**
   * What the game answered, drawn as one of THREE things.
   *
   * ⚠ **"unknown" IS NOT A REJECTION AND MUST NOT BE PAINTED AS ONE.** A point in a tunnel with
   * nobody down there answers unknown, and so does a point in a level the server has not streamed
   * in — SCUM puts nothing into a place no player is near, which is the ordinary state of most of
   * the island. Drawing that in red tells an owner their correct coordinate is wrong and sends them
   * to change the one thing that was right.
   *
   * ⚠ And the environment word the route can carry is DELIBERATELY NOT PRINTED. It is the game's
   * own token (Indoor_Medium, Outdoor_Large), the manager's one resolver has never heard of it, and
   * a raw identifier in front of an owner is the defect this page already has a rule about. Whether
   * the spot is underground is the half a reader actually wants and it comes back as a boolean.
   */
  function spotVerdict(said) {
    if (said === 'asking') return note('', T('pl.loot-zones.at.checking', 'Asking the game about this spot…'));
    if (!said) return null;
    if (said.ok === true) {
      return note('good', T('pl.loot-zones.at.ok', 'The game takes this spot. The ground under it is at {z} cm.',
        { z: (said.z == null ? '?' : Math.round(Number(said.z))) })
        + (said.underground ? ' ' + T('pl.loot-zones.at.ok.under', 'It is underground.') : '')
        + (said.note ? ' ' + String(said.note) : ''));
    }
    if (said.code === 'unknown' || !said.code) {
      return note('wait', T('pl.loot-zones.at.unknown',
        'The game could not check this spot. {why} Kept as typed; needs a player near.', { why: said.why ? String(said.why) : '' }));
    }
    var kind = spotKindWord(said.code);
    return note('bad', kind
      ? T('pl.loot-zones.at.no', 'The game will not take this spot — {kind}. {why}',
        { kind: kind, why: said.why ? String(said.why) : '' })
      : T('pl.loot-zones.at.no.plain', 'The game will not take this spot: {why}',
        { why: String(said.why || said.code || '') }));
  }

  /**
   * One point on one guard: three numbers, a facing, the owner's own note, a switch, and the
   * game's own verdict.
   *
   * ⚠ The NOTE is the owner's data and is never keyed, never translated and never rewritten — the
   * same rule this file already keeps for a zone's name, a message template and a loot folder.
   */
  function pointRow(t, p, pi, zoneId) {
    var said = spotSaid[spotKey(p)];
    var off = p.on === false;
    return h('div', { class: 'lz-pt' + (off ? ' off' : '') }, [
      h('div', { class: 'lz-ovr-head' }, [
        h('span', { class: 'lz-sub-n' }, String(pi + 1)),
        toggle(!off, function (v) { p.on = v; markDirty(); }, off
          ? T('pl.loot-zones.at.offWord', 'not used') : T('pl.loot-zones.at.onWord', 'in use')),
        h('button', {
          class: 'lz-del', type: 'button', title: T('pl.loot-zones.at.remove', 'Remove this point'),
          onclick: function () {
            var l = atList(t);
            l.splice(pi, 1);
            if (!l.length) delete t.at;
            markDirty();
          },
        }, [icon('close')]),
      ]),
      h('div', { class: 'lz-routes' }, [
        // The axis letters are notation rather than words and are the same in every language SCUM
        // ships, so they are literals. The unit beside each box is translated.
        guardNum('X', coordIn(p.x, function (v) { p.x = v; markDirty(); })),
        guardNum('Y', coordIn(p.y, function (v) { p.y = v; markDirty(); })),
        guardNum('Z', coordIn(p.z, function (v) { p.z = v; markDirty(); })),
        guardNum(T('pl.loot-zones.at.facing', 'Facing'),
          numIn(p.yaw == null ? 0 : p.yaw, function (v) { p.yaw = v; markDirty(); }, 0, 360,
            T('pl.loot-zones.unit.degrees', '°')),
          T('pl.loot-zones.at.facing.cap', 'which way it looks')),
      ]),
      row(T('pl.loot-zones.at.note', 'Your note'),
        txt(p.note, T('pl.loot-zones.at.note.ph', 'e.g. the tunnel mouth'), function (v) { p.note = v; markDirty(); }),
        T('pl.loot-zones.at.note.hint', 'For you, not for the game. It is never shown to players and never translated.')),
      h('div', { class: 'lz-actions' }, [
        h('button', {
          class: 'secondary', type: 'button', onclick: function () {
            if (!spotReady(p)) { SSA.toast(T('pl.loot-zones.at.checkNeeds', 'Type all three numbers first.')); return; }
            var key = spotKey(p);
            spotSaid[key] = 'asking';
            render();
            api('/check-spot', { method: 'POST', body: { id: zoneId, x: p.x, y: p.y, z: p.z } })
              .then(function (r) {
                // ⚠ An answer with no verdict in it at all is the route being absent or the fetch
                // having been turned into {} — which is silence, and silence is "unknown" rather
                // than a refusal of the coordinate.
                spotSaid[key] = (r && typeof r === 'object' && ('ok' in r)) ? r
                  : { ok: false, code: 'unknown', why: T('pl.loot-zones.at.noRoute',
                    'This plugin\'s backend did not answer — it may be older than this screen.') };
                render();
              })
              .catch(function (err) {
                spotSaid[key] = { ok: false, code: 'unknown',
                  why: SSA.apiError ? SSA.apiError(err) : ((err && err.message) || '') };
                render();
              });
          },
        }, [icon('eye'), T('pl.loot-zones.at.check', 'Check this spot')]),
        h('small', {}, T('pl.loot-zones.at.check.cap',
          'Asks the game what is there. Nothing is sent or saved.')),
      ]),
      spotVerdict(said),
    ]);
  }

  /**
   * THE GUARD ENTRY AGAIN, AFTER THE PANEL HAS TAKEN THE READER TO THE MAP AND BROUGHT THEM BACK.
   *
   * ⚠ **COMING BACK RE-RENDERS THIS TAB, AND THIS TAB'S OWN render() CALLS refresh().** On a page
   * with nothing unsaved that REPLACES state.cfg with what the server holds — so the entry a click
   * handler captured before the call is an orphan by the time the answer arrives, and a point
   * written into it is written into nothing at all. Nothing throws and nothing is on screen: the
   * owner picks a spot on the map, comes back, and the list is exactly as they left it. The SDK
   * says so in as many words beside pickOnMap.
   *
   * ⚠ And a POSITION IS NOT AN IDENTITY. The entry is found again by zone and index and then
   * CHECKED against what was there before, because a config re-read in between can carry a
   * different list — and attaching somebody's coordinate to whatever now sits at that index is the
   * swap failure this project already records, in the place where it puts a boss somewhere nobody
   * chose. It refuses and says so rather than guessing.
   */
  function guardAgain(zoneId, i, was) {
    var c = state.cfg;
    var z = ((c && c.zones) || []).filter(function (x) { return String(x && x.id) === String(zoneId); })[0];
    var list = (z && z.sentries && z.sentries.replace && z.sentries.replace.types) || null;
    var t = Array.isArray(list) ? list[i] : null;
    if (!t) return null;
    if (guardWordOf(t) !== guardWordOf(was)) return null;
    if (String(t.route || '') !== String(was.route || '')) return null;
    return t;
  }

  /**
   * The whole fold for one guard: its points, whether the zone may add its own beside them, and
   * the three ways of getting a coordinate.
   */
  function guardPlaces(t, zoneId, i) {
    /**
     * ⚠ **THE EXPLANATIONS IN HERE BELONG TO ONE GUARD, AND THE SCOPE ONLY WENT AS DEEP AS THE
     * ZONE.** `row()` keys an open explanation on `hintScope + '|' + label`, and the scope set
     * around a zone's block is the ZONE — which is right for every other row on this page, because
     * every one of those appears once per zone. These appear once per GUARD and carry the same
     * labels, so opening "Your note" on the first guard opened it on all eight, and closing it
     * closed them all: exactly the defect the scope was introduced for, one level further in.
     *
     * Set around this block and put back after it, which is what the zone's own scope does.
     */
    var outerScope = hintScope;
    hintScope = outerScope + '|g' + i;
    try {
      return guardPlacesInner(t, zoneId, i);
    } finally {
      hintScope = outerScope;
    }
  }
  function guardPlacesInner(t, zoneId, i) {
    var pts = atList(t);
    var used = atUsed(t);
    var addPoint = function (p) {
      if (!Array.isArray(t.at)) t.at = [];
      t.at.push(p);
      markDirty();
    };
    var kids = [];

    kids.push(h('p', { class: 'lz-lead' }, !pts.length
      ? T('pl.loot-zones.at.none',
        'No point set: the zone places this guard. Add one below to choose.')
      : (t.andAuto
        ? T('pl.loot-zones.at.also',
          'This guard stands at {points} of your own and at the zone\'s places.',
          { points: nPoints(used) })
        : T('pl.loot-zones.at.only',
          'Stands only at {points} of your own. A rejected point is refused, never moved nearby.',
          { points: nPoints(used) }))));

    /**
     * ⚠ **THE TWO THINGS A BOSS AT A CHOSEN POINT COSTS, ON THE SCREEN AND NOT ONLY IN THE CODE.**
     * Both are surprises and an owner meets them at the worst possible moment — one of them the
     * morning after a restart, and the other as a server that is no longer running.
     */
    if (looksLikeBoss(t)) {
      kids.push(h('small', { class: 'lz-warn' }, T('pl.loot-zones.at.boss.gone',
        '⚠ A boss at your own point is lost on restart; the zone replaces it.')));
      kids.push(h('small', {}, T('pl.loot-zones.at.boss.class',
        'Placed from the blueprint class you pick; only that kind has behaviour.')));
    }

    pts.forEach(function (p, pi) { kids.push(pointRow(t, p, pi, zoneId)); });

    // Two points with the same three numbers are one place asked for twice — worth a word, since
    // nothing refuses it and the second simply never has anybody standing on it.
    var seen = {};
    var twin = false;
    pts.forEach(function (p) {
      if (!spotReady(p)) return;
      var k = spotKey(p);
      if (seen[k]) twin = true;
      seen[k] = true;
    });
    if (twin) {
      kids.push(note('wait', T('pl.loot-zones.at.twin',
        'Two points are identical. Change or remove one.')));
    }
    if (pts.length && pts.some(function (p) { return !spotReady(p); })) {
      kids.push(note('wait', T('pl.loot-zones.at.incomplete',
        'A point with an empty box is skipped. Fill all three numbers or remove it.')));
    }

    if (pts.length) {
      kids.push(row(T('pl.loot-zones.at.andAuto', 'Also use the places the zone chooses'),
        toggle(!!t.andAuto, function (v) { t.andAuto = v; markDirty(); }),
        T('pl.loot-zones.at.andAuto.hint',
          'Off: only your points above. On: the zone\'s own places too, yours first.')));
    }

    var buttons = [
      h('button', {
        class: 'secondary', type: 'button',
        onclick: function () { addPoint({ x: null, y: null, z: null, yaw: 0, note: '', on: true }); },
      }, [icon('target'), T('pl.loot-zones.at.add', 'Add a point')]),
      h('button', {
        class: 'secondary', type: 'button',
        // ⚠ THE RESOLVER, never `addPoint` — see `takePlayerPosition` for the window this closes.
        onclick: function () { takePlayerPosition(function () { return guardAgain(zoneId, i, t); }); },
      }, [icon('user'), T('pl.loot-zones.at.fromPlayer', 'Take a player\'s position')]),
    ];
    /**
     * ⚠ **FEATURE-DETECTED, AND THE BUTTON IS SIMPLY NOT DRAWN WHERE THE PANEL CANNOT DO IT.** The
     * panel's own map has had a placing mode for a long time and it was never handed to plugins;
     * SSA.showOnMap is one-way. Where the manager offers the other direction this uses it, and on
     * every manager that does not, an owner loses this button and NOTHING else — the typed boxes
     * and the player's position are both whole ways of naming a point on their own. That is what
     * keeps minManagerVersion where it is. Both halves are tested, the way canPickItem() is beside
     * pickItem() above: an SDK that has the function and a panel that cannot open the map are
     * different states and only the second has a capability flag.
     *
     * ⚠ **A MAP IS A PICTURE AND A PICTURE HAS TWO AXES.** The panel deliberately hands back no z,
     * and { ground: true } puts its line trace in a box of its own with three shapes rather than a
     * number: a reading, an explicit null for "asked and nothing could answer", and no key at all
     * for "never asked". The reading starts in the SKY, so indoors it is the ROOF — which is the
     * measured rule this tree already has about tracing from above — and that is said to the owner
     * rather than written into a box as though somebody had stood there.
     */
    if (typeof SSA.pickOnMap === 'function' && (!SSA.canPickOnMap || SSA.canPickOnMap())) {
      buttons.push(h('button', {
        class: 'secondary', type: 'button',
        onclick: function () {
          Promise.resolve(SSA.pickOnMap({
            // The panel puts this on the map as text and translates nothing: only the plugin knows
            // what it is asking for, so the sentence is ours and is already in the reader's words.
            note: T('pl.loot-zones.at.pickMap.note', 'Tap the map where {name} should stand.',
              { name: prettyGuard(t) }),
            ground: true,
          })).then(function (at) {
            if (!at) return;                                   // cancelled, which is an answer
            var now = guardAgain(zoneId, i, t);
            if (!now) {
              SSA.toast(T('pl.loot-zones.at.pickMap.gone',
                'The guard list changed while the map was open. Nothing was added — pick again.'));
              return;
            }
            var g = at.ground;
            var gz = (g && isFinite(Number(g.z))) ? Math.round(Number(g.z)) : null;
            if (!Array.isArray(now.at)) now.at = [];
            now.at.push({ x: Math.round(Number(at.x)), y: Math.round(Number(at.y)), z: gz,
              yaw: 0, note: '', on: true });
            markDirty();
            SSA.toast(gz == null
              ? T('pl.loot-zones.at.pickMap.noHeight',
                'The map gave no height. Type Z, or use a player\'s position.')
              : T('pl.loot-zones.at.pickMap.sky',
                'Height is taken from above: over a building, that is the roof. Check it.'));
          }).catch(function () { /* the picker settled on its own */ });
        },
      }, [icon('map'), T('pl.loot-zones.at.pickMap', 'Pick it on the map')]));
    }
    kids.push(h('div', { class: 'lz-actions' }, buttons));
    kids.push(h('small', {}, T('pl.loot-zones.at.coords.hint',
      'Centimetres, as in game, map and console. In tunnels, stand there and press "{button}".',
      { button: T('pl.loot-zones.at.fromPlayer', 'Take a player\'s position') })));

    return more('at:' + (zoneId || 'default') + ':' + i,
      T('pl.loot-zones.at.fold', '{title}  ·  {state}', {
        title: T('pl.loot-zones.at.title', 'Where it stands'),
        state: used
          ? T('pl.loot-zones.at.foldSome', '{points} of its own', { points: nPoints(used) })
          : T('pl.loot-zones.at.foldNone', 'wherever the zone puts it'),
      }),
      kids,
      // Open where this guard really has points of its own, for the same reason the overrides fold
      // opens on a difference: a difference behind a click is a difference nobody finds.
      used > 0);
  }

  /**
   * WHO IS ONLINE AND WHERE THEY ARE STANDING — the answer to the hardest half of "it does not work
   * in tunnels".
   *
   * ⚠ **AN EMPTY LIST HAS TWO CAUSES AND THEY ARE NOT THE SAME SENTENCE.** "Nobody is on the
   * server" is something an owner fixes by walking somewhere; "the bridge could not be asked" is
   * something they fix by starting a server or switching a module on. One list with one sentence
   * over it sends half of them to do the wrong thing, so the route's own reason is printed word for
   * word where there is one and the ordinary case gets its own words where there is not.
   */
  /**
   * ⚠ **`again()`, AND NOT AN ENTRY CAPTURED BEFORE THE DIALOG OPENED.** This dialog stays open for
   * as long as somebody reads it, and the tab polls every fifteen seconds — a poll on a page with
   * nothing unsaved REPLACES `state.cfg` with what the server holds. So an entry captured when the
   * button was pressed is an orphan by the time the reader picks a player out of the list, and the
   * point is written into an object nothing renders: no error, no toast, and a list exactly as
   * they left it. It is the same window `guardAgain` exists for on the map picker, only far wider,
   * because a dialog waits for a person rather than for a promise.
   */
  /**
   * `use(target, player)` is what the caller does with the position. Absent, it adds a point to a
   * guard, which is what every caller did when this dialog was written; the zone's own centre wants
   * the same list and a different destination, and two copies of a dialog about who is online would
   * be two sets of the three sentences above to keep in step.
   */
  function takePlayerPosition(again, use) {
    Promise.resolve(api('/positions')).then(function (r) {
      var list = (r && Array.isArray(r.players)) ? r.players : [];
      var kids = [];
      var dlg = null;
      if (!list.length) {
        kids.push(h('p', { class: 'lz-note wait' }, (r && r.why)
          ? String(r.why)
          : T('pl.loot-zones.at.players.nobody',
            'Nobody is online. Stand where the guard should go, then press this again.')));
      } else if (r.source === 'saved') {
        // A saved position is where the game last WROTE somebody down, which is not where they are
        // standing. Said before the list rather than after it, because it decides what the numbers
        // in the list mean.
        kids.push(h('p', { class: 'lz-note wait' }, T('pl.loot-zones.at.players.saved',
          'Saved positions, not live ones. Stand still until the server saves, then ask again.')));
      }
      list.forEach(function (pl) {
        kids.push(h('div', { class: 'lz-routes' }, [
          h('b', {}, String(pl.name || '')),
          h('small', {}, T('pl.loot-zones.at.players.at', 'at {x}, {y}, {z}',
            { x: Math.round(Number(pl.x) || 0), y: Math.round(Number(pl.y) || 0), z: Math.round(Number(pl.z) || 0) })),
          // The route's own words about this one player, where it has any. Never re-worded here.
          pl.note ? h('small', {}, String(pl.note)) : null,
          h('button', {
            class: 'secondary', type: 'button',
            onclick: function () {
              var t = again();
              if (dlg && dlg.close) dlg.close();
              if (!t) {
                SSA.toast(T('pl.loot-zones.at.players.gone',
                  'The guard list changed while this was open. Nothing was added — open it again.'));
                return;
              }
              if (typeof use === 'function') { use(t, pl); return; }
              if (!Array.isArray(t.at)) t.at = [];
              t.at.push({ x: Math.round(Number(pl.x)), y: Math.round(Number(pl.y)), z: Math.round(Number(pl.z)),
                yaw: 0, note: pl.note ? String(pl.note) : '', on: true });
              markDirty();
              SSA.toast(T('pl.loot-zones.at.players.took', 'Added the spot {name} is standing on.',
                { name: String(pl.name || '') }));
            },
          }, [icon('check'), T('pl.loot-zones.at.players.use', 'Use where they are standing')]),
        ]));
      });
      dlg = SSA.modal({
        title: T('pl.loot-zones.at.players.title', 'Take a player\'s position'),
        body: h('div', { class: 'lz-lines' }, kids),
      });
    }).catch(failed(T('pl.loot-zones.fail.positions', 'Could not ask who is online')));
  }

  /**
   * Who guards the zone — one ROW per guard, and every number on it editable.
   *
   * ⚠ **THE CHIP THIS REPLACES COULD NOT EXPRESS WHAT WAS BEING ASKED FOR.** `count` and `weight`
   * have been in the configuration since the list existed and nothing on this page could change
   * either: a guard was added with both hard-coded to 1, and the chip only ever DISPLAYED the count.
   * So *how many of these stand in my zone* — the question the whole guard section is for — was a
   * setting an owner could hold and no screen could draw.
   *
   * `want` is the key that answers it: how many of THIS guard the zone should hold. Absent, or 0, is
   * exactly the behaviour every configuration written before it has, so nothing already set changes
   * meaning.
   */
  function guardRows(rp, sm, pat, scope) {
    var types = rp.types || (rp.types = []);
    var addPersistent = function (code, name) {
      types.push({ route: 'persistent', kind: 'npc', classPath: '', spawnKind: PERSISTENT_KIND[addKind] || 'armednpc',
        spawnName: code, count: 1, weight: 1, label: name || '' });
      markDirty();
    };
    var addDirect = function (code, name) {
      guardClasses().then(function (table) {
        var cls = (table.classes || {})[code];
        if (!cls) {
          SSA.toast(T('pl.loot-zones.guard.cannotPlace', '"{name}" cannot be placed as a guard in this build.',
            { name: name || code }));
          return;
        }
        /**
         * ⚠ **A NATIVE CLASS IS A STATUE WITH NO BRAIN, AND ONE TOOK A LIVE SERVER DOWN.** The
         * direct route wants the BLUEPRINT — /Game/.../BP_Razor.BP_Razor_C — and /Script/SCUM.Razor
         * is the other thing entirely. It is refused where a guard is CHOSEN rather than where it
         * is sent, because a configuration that is known not to work the moment it is picked should
         * never reach a save, let alone a patrol three rounds later.
         */
        if (/^\/Script\//i.test(String(cls))) {
          SSA.toast(T('pl.loot-zones.guard.nativeClass',
            '"{name}" is a native class and can crash the server, so it is hidden.', { name: name || code }));
          return;
        }
        types.push({ route: 'spawn', kind: (table.kinds || {})[code] || 'npc', classPath: cls, spawnKind: 'armednpc',
          spawnName: '', count: 1, weight: 1, label: name || '' });
        markDirty();
      });
    };
    var add = function (code, name) { if (addKind === 'creatures') addDirect(code, name); else addPersistent(code, name); };
    /**
     * A row that names no class. It carries a key, a count and a share and nothing else — which is
     * the whole of what the game's own random verbs take, so there is no picker to open and nothing
     * to resolve against a catalogue.
     */
    var addRandom = function (key) {
      types.push({ random: key, count: 1, weight: 1, label: '' });
      markDirty();
    };

    // A boss's row has a sentence that cannot be written without the class table, and a saved
    // configuration reaches this before anything has fetched it. Asked for once, and the row is drawn
    // again when it lands — `guardClasses()` caches, so a redraw costs nothing.
    if (!classTable && types.some(looksLikeBoss)) guardClasses().then(render).catch(function () {});

    var anyWant = types.some(function (t) { return Number(t.want) > 0; });
    var rows = types.map(function (t, i) {
      var r = routeOf(t);
      var sw = switchFor(t);
      var swState = sw ? bridgeStateOf(sw.key) : null;
      var wanted = Number(t.want) > 0;
      // How many settings this guard holds of its own, on the row itself — so "this one is not like
      // the others" is visible without opening anything. The window counts key by key, exactly as
      // the backend merges it.
      var ownCount = overridableKeys(rp, t).filter(function (k) { return hasOwnKey(t, k); }).length
        + ((t.gameTime && typeof t.gameTime === 'object') ? Object.keys(t.gameTime).length : 0);
      return h('div', { class: 'lz-sub' + (ownCount ? ' has-own' : '') }, [
        h('div', { class: 'lz-sub-head' }, [
          h('span', { class: 'lz-sub-n' }, String(i + 1)),
          h('b', {}, prettyGuard(t)),
          ownCount ? h('span', { class: 'lz-badge on',
            title: T('pl.loot-zones.guard.ownCountTitle', 'This guard does not follow the zone for {n} of its settings', { n: ownCount }) },
          T('pl.loot-zones.guard.ownCount', '{n} of its own', { n: ownCount })) : null,
          // Points of its own, on the row, for the same reason the settings count is: "this one is
          // not like the others" has to be visible without opening anything.
          atUsed(t) ? h('span', { class: 'lz-badge on',
            title: T('pl.loot-zones.guard.atBadgeTitle',
              'This guard stands at your points, not where the zone puts it') },
          T('pl.loot-zones.guard.atBadge', '{points} of your own', { points: nPoints(atUsed(t)) })) : null,
          (function () {
            var alt = routeAlternative(t);
            if (!alt) return h('span', { class: r.cls }, r.badge);
            return sel(t.route === 'persistent' ? 'persistent' : 'spawn', [
              ['persistent', T('pl.loot-zones.badge.gameSpawn', 'game spawn')],
              ['spawn', T('pl.loot-zones.badge.direct', 'gone at restart')],
            ], function (v) {
              if (v === (t.route === 'persistent' ? 'persistent' : 'spawn')) return;
              alt.apply(); markDirty();
            });
          })(),
          h('button', {
            class: 'lz-del', type: 'button', title: T('pl.loot-zones.guard.removeTitle', 'Remove {name}', { name: prettyGuard(t) }),
            onclick: function () { types.splice(i, 1); markDirty(); },
          }, [icon('close')]),
        ]),
        h('div', { class: 'lz-routes' }, [
          guardNum(T('pl.loot-zones.guard.want', 'How many in the zone'),
            numIn(t.want == null ? 0 : t.want, function (v) { t.want = Math.max(0, v); markDirty(); }, 0, 100, T('pl.loot-zones.unit.guards', 'guards')),
            wanted ? null : T('pl.loot-zones.guard.want.cap', '0 shares the places out')),
          guardNum(T('pl.loot-zones.guard.count', 'At each place'),
            numIn(t.count == null ? 1 : t.count, function (v) { t.count = Math.max(1, Math.min(10, v)); markDirty(); }, 1, 10),
            T('pl.loot-zones.guard.count.cap', 'standing together')),
          guardNum(T('pl.loot-zones.guard.weight', 'Share of the rest'),
            numIn(t.weight == null ? 1 : t.weight, function (v) { t.weight = Math.max(1, Math.min(100, v)); markDirty(); }, 1, 100),
            wanted ? T('pl.loot-zones.guard.weight.unused', 'not used: a number is set above')
              : (anyWant ? T('pl.loot-zones.guard.weight.leftover', 'of the places left over')
                : T('pl.loot-zones.guard.weight.against', 'against the other guards'))),
        ]),
        /**
         * ⚠ **A WARNING IS ONE LINE, AND THE FOUR SENTENCES BEHIND IT ARE ONE CLICK BELOW.** This
         * row used to print five paragraphs under every guard — what it does, which wire it goes
         * out on, whether the game has ever made one, which bridge switch it needs and whether the
         * plugin moved it — always open, for every guard in the list. A zone with eight guards was
         * forty paragraphs, and the one line that stops a guard being sent was somewhere in the
         * middle of them. Nothing is lost: everything below is in the fold at the end of the row.
         */
        (function () {
          var f = firstOneOf(t);
          var lines = [];
          /**
           * ⚠ **TWO REASONS A GUARD IS NOT SENT, AND THEY ARE NOT THE SAME SENTENCE.** One class
           * has no command anywhere in the game; the other has one that WORKS and cannot be aimed,
           * so the boss would land on whoever the command ran through. Telling an owner the verb
           * does not exist is the most expensive mistake this project makes, so the line that
           * mentions the verb says what is really wrong with it.
           */
          if (f && f.atPlayer) {
            lines.push(h('small', { class: 'lz-warn' }, T('pl.loot-zones.guard.warn.bossAim',
              '⚠ The game\'s {verb} command cannot be aimed; waiting until the game spawns one itself.', { verb: f.verb })));
          } else if (f && f.auto === false) {
            lines.push(h('small', { class: 'lz-warn' }, T('pl.loot-zones.guard.warn.notSent',
              '⚠ Not sent until the game has made one of these on this server itself.')));
          }
          if (swState === 'off' && sw) {
            lines.push(h('small', { class: 'lz-warn' }, T('pl.loot-zones.guard.warn.switchOff',
              '⚠ Needs {card} → {label} in the bridge, and it is off.', { card: sw.card, label: sw.label })));
          } else if (swState === 'missing' && sw) {
            lines.push(h('small', { class: 'lz-warn' }, T('pl.loot-zones.guard.warn.switchMissing',
              '⚠ Needs {card} → {label}, which this bridge does not have.', { card: sw.card, label: sw.label })));
          }
          /**
           * ⚠ **THE SHORT LINE KEEPS THE KEY, AND THAT IS NOT BOOKKEEPING.** This is the one
           * sentence on the tab a gate outside this plugin reads BY KEY — it draws the page in
           * three languages and asserts the value of `guard.movedToEngine` is really on screen,
           * reading it out of these very files. So the key belongs to whatever a reader SEES: a
           * route the plugin chose for them, and what it costs. The four sentences of mechanism
           * behind it moved down into the fold under a key of their own, unchanged.
           */
          if (routeMoved(t)) {
            lines.push(h('small', { class: 'lz-warn' }, T('pl.loot-zones.guard.movedToEngine',
              '⚠ Placed by the bridge: stays with nobody near, gone after a restart.')));
          }
          return lines.length ? h('div', { class: 'lz-warns' }, lines) : null;
        })(),
        why('g:' + (scope || 'default') + ':' + i, [
          behaviourOf(t),
          r.text,
        (function () {
          var f = firstOneOf(t);
          if (!f) return null;
          if (f.auto) {
            return h('small', {}, T('pl.loot-zones.guard.firstAuto',
              'The first one is sent with the game\'s {verb} command; the rest are placed directly.', { verb: f.verb }));
          }
          if (f.atPlayer) {
            /**
             * ⚠ **THE COMMAND WORKS. IT JUST CANNOT BE AIMED.** This row said the opposite twice: once
             * that a boss would appear at its post, and then — correcting that — that it would never
             * be sent at all. Both were wrong in the same way, by turning a measurement about WHERE
             * into a claim about WHETHER. What it is, is a capability with a cost, and the cost is
             * the place.
             */
            /**
             * ⚠ **THERE IS ONE STATE HERE AND THERE USED TO BE TWO.** A switch let the zone send the
             * boss anyway and accept that it landed on whoever ran the command; the owner refused it
             * outright — a boss appearing on a player is not a cost to be accepted — so it is gone,
             * from the backend, the config and this card.
             *
             * What is left has to say three things and keep them apart: the command WORKS (telling
             * an owner it does not exist is the most expensive error this project makes), it cannot
             * be AIMED, and therefore nothing is SENT. "Not sent" is not "cannot". And it has to say
             * what ends the wait and what starts it again, because a wait whose end is unstated
             * reads as a wall.
             */
            return h('small', { class: 'lz-warn' },
              T('pl.loot-zones.guard.bossOff',
                '⚠ {verb} cannot be aimed. Waiting for the game to spawn one; a restart resets it.',
                { verb: f.verb }));
          }
          return h('small', { class: 'lz-warn' }, T('pl.loot-zones.guard.noFirst',
            '⚠ Placed only after the game spawns one itself. Until then this spot stays empty.'));
        })(),
        sw
          ? h('small', {}, swState === 'off'
            ? T('pl.loot-zones.guard.needsOff', '⚠ Needs {card} → {label}, which is off. Turn on {box} at the top of this tab.',
              { card: sw.card, label: sw.label, box: cardBridge() })
            : (swState === 'missing'
              ? T('pl.loot-zones.guard.needsMissing', 'Needs {card} → {label}, which this bridge does not have: update the bridge.',
                { card: sw.card, label: sw.label })
              : T('pl.loot-zones.guard.needs', 'Needs {card} → {label}.', { card: sw.card, label: sw.label })))
          : h('small', {}, T('pl.loot-zones.guard.needsNone',
            'Needs no bridge spawn switch: it uses the game\'s admin command.')),
        /**
         * ⚠ **A ROUTE THE PLUGIN CHOSE HAS TO BE ONE THE OWNER CAN SEE.** On a bridge that can
         * place a humanoid directly, a guard picked from the NPC, Zombie or Animal picker is sent
         * that way instead of by the game's own command — because it is the only way it survives
         * the 175 m cull, which is the thing an owner asks for and no setting in the game gives.
         * It is not a free swap and this says what it costs in the same breath as what it buys.
         */
        routeMoved(t)
          ? h('small', {}, T('pl.loot-zones.guard.moved.why',
            '⚠ Bridge-placed so it stays with nobody near. Lost on restart; the zone replaces it.'))
          : null,
        ]),
        guardOverrides(t, rp, scope || 'default', i, pat),
        guardPlaces(t, scope, i),
      ]);
    });

    var kindSel = sel(addKind, ADD_KINDS.map(function (k) { return [k, addKindLabel(k)]; }),
      function (v) { addKind = v; render(); });
    // ⚠ THE ROUTE IS DECIDED BY THIS BOX AND BY NOTHING ELSE, so it says what it decides BEFORE the
    // pick rather than only on the row afterwards. Somebody reaching for a Razor has to see, at that
    // moment, what that will really do.
    /**
     * ⚠ **THIS LINE HAS BEEN WRONG TWICE, IN OPPOSITE DIRECTIONS, OFF THE SAME MEASUREMENT.** First
     * it said the zone could make a Razor itself and put it at the post; then, correcting that, that
     * a boss was never sent at all. What was measured is WHERE a boss lands, and neither sentence is
     * what that measures: both verbs really do spawn — a bare `SpawnBrenner` put one 1.1 m from the
     * player — and neither takes a place. So it is a capability with a cost, the cost is the place,
     * and the owner decides.
     */
    var addNote = addKind === 'random'
      ? T('pl.loot-zones.add.note.random',
        'Random spawn works anywhere; a wild one of that kind on the post blocks refills.')
      : (addKind === 'creatures'
        ? T('pl.loot-zones.add.note.creatures',
          'Placed directly; gone after a restart. Works only once the game has spawned one itself.')
        : T('pl.loot-zones.add.note.spawn',
          'Sent through the game\'s spawn command, like the game\'s own.'));
    /**
     * A random row is picked from a list rather than from the catalogue, because there is no class
     * to pick: the whole of the choice is which of the game's three random verbs to send.
     */
    var adder = addKind === 'random'
      ? [sel(randomPick, Object.keys(RANDOM_KINDS).map(function (k) { return [k, randomLabel(k)]; }),
        function (v) { randomPick = v; render(); }),
      h('button', {
        class: 'secondary', type: 'button',
        onclick: function () { addRandom(randomPick); },
      }, [icon('users'), T('pl.loot-zones.add.button', 'Add')])]
      : [canPick()
        ? h('button', {
          class: 'secondary', type: 'button', onclick: function () {
            Promise.resolve(SSA.pickItem({ domain: addKind, title: T('pl.loot-zones.add.pickTitle', 'Add a guard') })).then(function (picked) {
              if (picked && picked.id) add(picked.id, picked.name);
            });
          },
        }, [icon('users'), T('pl.loot-zones.add.button', 'Add')])
        : txt('', T('pl.loot-zones.add.placeholder', 'spawn name, e.g. BP_Guard_Lvl_5'), function (v) { v = String(v || '').trim(); if (v) add(v, ''); })];
    rows.push(h('div', { class: 'lz-chips' }, [kindSel].concat(adder)));
    // What the box above decides, folded. It is four or five sentences and it is the same four or
    // five whichever guard is being added, so it is a thing to read once rather than a thing to
    // scroll past every time.
    rows.push(why('add:' + (scope || 'default'), [addNote]));
    var math = guardMathNote(rp, sm, pat, scope);
    if (math) rows.push(math);
    return h('div', { class: 'lz-when' }, rows);
  }

  /**
   * How many places this zone really has, and whether that is known at all.
   *
   * ⚠ **THREE SOURCES, AND ONLY ONE OF THEM IS KNOWN WITH THE SERVER STOPPED.** Places spread over
   * the zone are the owner's own number; places where sentries stood and places learned in tunnels
   * exist only once a patrol has run with somebody near. So a patrol's figure is used where there is
   * one and is SAID to be a reading, and without one the answer names what is missing rather than
   * passing an owner's own number off as the total.
   */
  function placesOf(sm, pat) {
    var rp = sm.replace || {};
    var own = Math.max(0, Number(sm.ownPosts) || 0);
    var cap = Math.max(1, Number(rp.maxPosts == null ? 12 : rp.maxPosts) || 12);
    if (pat && pat.posts != null) return { n: Math.min(Number(pat.posts) || 0, cap), measured: true, own: own, cap: cap };
    return { n: Math.min(own, cap), measured: false, own: own, cap: cap };
  }

  /**
   * How the places are shared out when no guard carries a number of its own — the backend's own rule,
   * which lays the weights out in ORDER and takes position `i`, so the answer is exact rather than a
   * roll. Shown only while every guard is on shares: once one carries a number the assignment is no
   * longer this arithmetic, and claiming it would be inventing one.
   */
  function splitByWeight(types, places) {
    var out = types.map(function () { return 0; });
    var total = types.reduce(function (n, t) { return n + Math.max(1, Number(t.weight) || 1); }, 0);
    if (!total || places <= 0) return out;
    for (var i = 0; i < places; i++) {
      var at = i % total;
      for (var j = 0; j < types.length; j++) {
        var w = Math.max(1, Number(types[j].weight) || 1);
        if (at < w) { out[j]++; break; }
        at -= w;
      }
    }
    return out;
  }

  /**
   * ⚠ **THE ARITHMETIC, SAID OUT LOUD.** Somebody can ask for forty guards in a zone with twelve
   * places and nothing anywhere tells them: the zone fills what it has, the rest never arrive, and
   * the only symptom is a base that looks thinner than the numbers say. Every figure here comes from
   * the settings themselves, so it is answerable with the server stopped.
   */
  function guardMathNote(rp, sm, pat, scope) {
    var types = chosenGuards(rp);
    if (!types.length) return null;
    var p = placesOf(sm, pat);
    var named = types.filter(function (t) { return Number(t.want) > 0; });
    var each = function (t) { return Math.max(1, Number(t.count) || 1); };
    var asked = named.reduce(function (n, t) { return n + Number(t.want); }, 0);
    var needs = named.reduce(function (n, t) { return n + Math.ceil(Number(t.want) / each(t)); }, 0);
    var maxG = Math.max(0, Number(rp.maxGuards) || 0);
    var nTimes = function (n, t) { return T('pl.loot-zones.math.times', '{n} × {name}', { n: n, name: prettyGuard(t) }); };
    var whereFrom = p.measured
      ? T('pl.loot-zones.math.where.measured', '{places} right now, counted by the last patrol', { places: nPlaces(p.n) })
      : (p.own > 0
        ? T('pl.loot-zones.math.where.own', '{places} spread over it, plus sentry spots and tunnels once a patrol has run', { places: nPlaces(p.own) })
        : T('pl.loot-zones.math.where.none', 'no places yet: they come from sentry spots once a patrol has run'));
    /**
     * ⚠ **THE ARITHMETIC IS FOLDED AND THE THINGS THAT WILL NOT FIT ARE NOT.** Both used to sit open
     * under every guard list, so the two lines that say *you have asked for more than this zone can
     * hold* were the fourth and fifth items of a bulleted paragraph. A warning belongs on the screen;
     * the working behind it belongs one click down.
     */
    var lines = [];
    var stops = [];
    if (named.length) {
      lines.push(h('li', {}, T('pl.loot-zones.math.named',
        'You have asked for {list} by name: {guards} standing on {places}.', {
        list: named.map(function (t) { return nTimes(Number(t.want), t); }).join(', '),
        guards: nGuards(asked), places: nPlaces(needs),
      })));
    } else {
      var split = splitByWeight(types, p.n);
      lines.push(h('li', {}, p.n > 0
        ? T('pl.loot-zones.math.shares',
          'No guard has its own number, so places are split by share: {list}.',
          { list: types.map(function (t, i) { return nTimes(split[i], t); }).join(', ') })
        : T('pl.loot-zones.math.sharesOnly',
          'No guard has its own number, so places are split by share.')));
    }
    lines.push(h('li', {}, T('pl.loot-zones.math.total', 'This zone has {where}, and never more than {cap}.',
      { where: whereFrom, cap: nPlaces(p.cap) })));
    if (named.length && needs > p.cap) {
      stops.push(T('pl.loot-zones.math.overCap',
        '⚠ Too many places. Raise "{control}" under {fold}, or use fewer guards.',
        { control: labMaxPosts(), fold: labTechnical() }));
    } else if (named.length && needs > p.n) {
      (p.measured ? stops : lines).push(p.measured
        ? T('pl.loot-zones.math.overNow',
          '⚠ Room for {places} only; the rest wait. Raise "{control}".', { places: nPlaces(p.n), control: labOwnPosts() })
        : h('li', {}, T('pl.loot-zones.math.maybeOver',
          'Room depends on the zone\'s sentry places. Raise "{control}" to be sure.', { control: labOwnPosts() })));
    }
    if (maxG && asked > maxG) {
      stops.push(T('pl.loot-zones.math.overMaxGuards',
        '⚠ "{control}" is {max}, so {max} of those {asked} is all that ever stands.',
        { control: labMaxGuards(), max: maxG, asked: asked }));
    }
    return h('div', {}, stops.map(function (s) { return note('wait', s); }).concat([
      why('math:' + (scope || 'default'), [h('div', { class: 'lz-summary' },
        [h('p', {}, T('pl.loot-zones.math.title', 'How that adds up:')), h('ul', {}, lines)])]),
    ]));
  }

  // ── how long a guard of your own lives ─────────────────────────────────────────────────────────
  /**
   * ⚠ **THE GAME DOES NOT KEEP A CHARACTER IN A PLACE NOBODY IS NEAR, AND A GUARD PLACED DIRECTLY BY
   * THE BRIDGE IS THE EXCEPTION.** That is what an owner asks for — a post that is still held when
   * the next player walks up — and it is also how a server ends up carrying every guard it has ever
   * placed, in villages nobody has visited since.
   *
   * So the zone takes its own guards away again when the last player leaves, and an owner who wants
   * the other behaviour asks for it by name. The default is the one that cleans up after itself.
   *
   * The grace is there because "the last player left" flickers: somebody crossing the edge of the
   * wake distance, a reading that missed a poll, a player logging back in. Taking a zone's guards
   * away and putting them back twice a minute is worse than either answer.
   */
  function ownLifeOf(sm) {
    return (sm.ownLife && typeof sm.ownLife === 'object') ? sm.ownLife : {};
  }
  function ownLifeWrite(sm) {
    if (!sm.ownLife || typeof sm.ownLife !== 'object') sm.ownLife = {};
    return sm.ownLife;
  }
  function ownLifeRows(sm) {
    var ol = ownLifeOf(sm);
    var mode = ol.mode === 'persist' ? 'persist' : 'nearby';
    var leash = ol.leash === 'none' ? 'none' : 'zone';
    var grace = ol.sleepGraceSeconds == null ? 20 : Number(ol.sleepGraceSeconds);
    var slack = ol.leashSlackCm == null ? 2000 : Number(ol.leashSlackCm);
    var out = [
      row(T('pl.loot-zones.life.mode', 'Guards stay'), sel(mode, [
        ['nearby', T('pl.loot-zones.life.mode.nearby', 'Only while a player is near')],
        ['persist', T('pl.loot-zones.life.mode.persist', 'Once placed, they stay')],
      ], function (v) { ownLifeWrite(sm).mode = v === 'persist' ? 'persist' : 'nearby'; markDirty(); }),
      T('pl.loot-zones.life.mode.hint',
        'Guards leave with the last player. "Once placed, they stay" keeps them until killed or restart.')),
    ];
    if (mode === 'nearby') {
      out.push(row(T('pl.loot-zones.life.grace', 'Take them away after'),
        h('div', { class: 'lz-ctl' }, [
          numIn(grace, function (v) { ownLifeWrite(sm).sleepGraceSeconds = Math.max(0, v); markDirty(); },
            0, 3600, T('pl.loot-zones.unit.seconds', 'seconds')),
          h('small', {}, T('pl.loot-zones.life.grace.cap', 'once the last player has left the zone')),
        ]),
        T('pl.loot-zones.life.grace.hint',
          'A delay against guards coming and going at the edge. 0 removes them at once.')));
    }
    out.push(row(T('pl.loot-zones.life.leash', 'If one walks out of the zone'), sel(leash, [
      ['zone', T('pl.loot-zones.life.leash.zone', 'Take it away')],
      ['none', T('pl.loot-zones.life.leash.none', 'Let it walk')],
    ], function (v) { ownLifeWrite(sm).leash = v === 'none' ? 'none' : 'zone'; markDirty(); }),
    T('pl.loot-zones.life.leash.hint',
      'Drifters chase, puppets wander. Remove strays to free their place, or let them chase.')));
    if (leash === 'zone') {
      out.push(row(T('pl.loot-zones.life.slack', 'but let it get this far out first'),
        h('div', { class: 'lz-ctl' }, [
          numIn(slack, function (v) { ownLifeWrite(sm).leashSlackCm = Math.max(0, v); markDirty(); },
            0, 1000, T('pl.loot-zones.unit.metres', 'm'), M),
          h('small', {}, T('pl.loot-zones.life.slack.cap', 'past the edge of the rectangle')),
        ]),
        T('pl.loot-zones.life.slack.hint',
          'A guard fighting just past the line is working. 0 removes it on crossing.')));
    }
    return out;
  }

  /**
   * The guard controls, for ONE settings object.
   *
   * The page's default and a zone's own override are the same screen over a different object, so
   * they are the same function. Two copies would be two screens to keep in step and the less-edited
   * one would quietly stop matching — which for a control that clears things out of a running world
   * is the wrong thing to be relaxed about.
   */
  function guardControls(sm, scope, pat, set) {
    normaliseGuards(sm);
    var rp = sm.replace || (sm.replace = {});
    // The zone's own window. Read only — it is created here so the three boxes have somewhere to
    // write, exactly as `sm.replace` and `sm.globalRespawn` beside it are.
    var gt = (rp.gameTime && typeof rp.gameTime === 'object') ? rp.gameTime : (rp.gameTime = {});
    var gr = sm.globalRespawn || (sm.globalRespawn = {});
    var kinds = (sm.kinds || []).filter(Boolean);
    var has = function (k) { return kinds.indexOf(k) >= 0; };
    var sentriesOut = has('mapsentry') || has('sentry');
    var zombiesOut = has('puppet');
    var guardsOn = sm.mode === 'replace';
    /**
     * The three questions an owner actually has, and the mode follows from the answers.
     *
     * "What to do here" used to be a choice of three words that meant nothing until the rest of the
     * section had been read — and choosing "only clear" hid the guard list while a guard stayed
     * chosen, so a zone set up for guards sent none and the screen gave no clue why.
     */
    function apply(nextSentries, nextZombies, nextGuards) {
      var list = [];
      if (nextSentries) { list.push('mapsentry'); list.push('sentry'); }
      if (nextZombies) list.push('puppet');
      sm.kinds = list;
      sm.mode = nextGuards ? 'replace' : (list.length ? 'remove' : 'leave');
      markDirty();
    }
    var noSpot = guardsOn && !sentriesOut && !(Number(sm.ownPosts) > 0) && !(state.status && state.status.npcLimit === 0);
    var caption = function (t) { return h('small', {}, t); };
    var field = function (control, t) { return h('div', { class: 'lz-ctl' }, [control, t ? caption(t) : null]); };
    return [
      guardSummary(sm, pat, set, scope),
      row(labSentriesOut(), toggle(sentriesOut, function (v) { apply(v, zombiesOut, guardsOn); }),
        T('pl.loot-zones.set.sentriesOut.hint', 'Sentries are put away while players are near, so the game builds no new ones.')),
      row(labZombiesOut(), toggle(zombiesOut, function (v) { apply(sentriesOut, v, guardsOn); }),
        zombiesText()),
      row(T('pl.loot-zones.set.guardsOn', 'Guards of my own'), toggle(guardsOn, function (v) { apply(sentriesOut, zombiesOut, v); }),
        T('pl.loot-zones.set.guardsOn.hint', 'NPCs, zombies, animals or bosses you choose, standing in the zone while players are near.')),
      guardsOn ? h('h4', { class: 'lz-group' }, T('pl.loot-zones.group.who', 'Who and how many')) : null,
      // ⚠ NOT inside a `row()`. That grid gives its control column 22rem at most, which is right for
      // a box and a caption and far too narrow for a guard's three numbers and the sentences beside
      // them — a list of guards is a block of the page, not a setting on the right of a label.
      guardsOn ? why('guards:' + (scope || 'default'), [T('pl.loot-zones.guards.lead',
        'Per guard: count, count per place, share of spare places. Zone-wide: "{group}"; own: "{fold}".',
        { group: T('pl.loot-zones.group.when', 'When they come'), fold: labPerGuard() })]) : null,
      guardsOn ? guardRows(rp, sm, pat, scope) : null,
      guardsOn && !chosenGuards(rp).length ? note('wait', T('pl.loot-zones.guards.none', 'Add a guard, or nobody is sent.')) : null,
      /**
       * ⚠ **THE WORDS ARE THE BACKEND'S REFUSAL'S OWN, AND THEY ARE NOT TO BE IMPROVED.** Its
       * sentence reads *switch on "Let a boss arrive on a player"*, so a label here that said
       * anything else — "Allow unplaced bosses", "Boss first spawn" — would send an owner looking
       * for a control this tab does not have. Drawn while any guard in the list is a boss the game
       * cannot aim, and also whenever it is already on, so a stored yes can always be found again.
       */
      /* THE SWITCH THAT USED TO BE HERE IS GONE AND IS NOT COMING BACK.
       *
       * It let the zone send a boss the game cannot aim and accept that it landed on whoever the
       * command ran through. The owner refused it outright, and `check-loot-zones` now asserts that
       * this card offers no way to do it — so a control here would not merely be dead, it would be
       * the thing that was rejected. The backend no longer reads the key either. A value left in
       * somebody's saved config is handled where every other unread key is: the overrides fold
       * shows it, says nothing reads it, and offers Remove it. */
      guardsOn ? row(labMaxGuards(), field(numIn(rp.maxGuards || 0, function (v) { rp.maxGuards = v; markDirty(); }, 0, 50, T('pl.loot-zones.unit.guards', 'guards')),
        caps(T('pl.loot-zones.set.maxGuards.cap', '0 means as many as there are places'), overriddenNote(rp, 'maxGuards'))),
      T('pl.loot-zones.set.maxGuards.hint', 'All guards together across the zone. A killed guard counts until its replacement is due.')) : null,
      guardsOn ? row(labOwnPosts(), field(numIn(sm.ownPosts, function (v) {
        sm.ownPosts = v;
        // The cap on places must never be what silently stops the number just typed.
        if (Number(v) > Number(rp.maxPosts || 12)) rp.maxPosts = Number(v);
        markDirty();
      }, 0, 60, T('pl.loot-zones.unit.places', 'places')), placesCaption(sentriesOut, pat)),
      T('pl.loot-zones.set.ownPosts.hint2', 'Random places the zone finds; each sentry put away adds one, and a killed guard returns elsewhere.')) : null,
      noSpot ? note('bad', T('pl.loot-zones.guards.noSpot', 'No place for guards yet: no sentries put away, none spread. Set "{control}".',
        { control: labOwnPosts() })) : null,
      guardsOn ? h('h4', { class: 'lz-group' }, T('pl.loot-zones.group.when', 'When they come')) : null,
      guardsOn ? row(labCooldown(), field(numIn(rp.cooldownSeconds, function (v) { rp.cooldownSeconds = v; markDirty(); }, 0, 60, T('pl.loot-zones.unit.minutes', 'minutes'), MIN),
        caps(T('pl.loot-zones.set.cooldown.cap', '0 means a few seconds apart'), overriddenNote(rp, 'cooldownSeconds'))),
      T('pl.loot-zones.set.cooldown.hint', 'The zone waits this long between guards, so it fills gradually.')) : null,
      guardsOn ? row(T('pl.loot-zones.set.afterDeath', 'After a guard is killed, wait'), field(numIn(rp.afterDeathSeconds, function (v) { rp.afterDeathSeconds = v; markDirty(); }, 0, 1440, T('pl.loot-zones.unit.minutes', 'minutes'), MIN),
        caps(T('pl.loot-zones.set.afterDeath.cap', 'before its replacement comes'), overriddenNote(rp, 'afterDeathSeconds'))),
      T('pl.loot-zones.set.afterDeath.hint', 'Gives the killer time to loot. Guards the game removed return when a player nears.')) : null,
      guardsOn ? row(T('pl.loot-zones.set.moveAfter', 'Move a standing guard after'), field(numIn(rp.moveAfterSeconds || 0, function (v) { rp.moveAfterSeconds = v; markDirty(); }, 0, 240, T('pl.loot-zones.unit.minutes', 'minutes'), MIN),
        caps(T('pl.loot-zones.set.moveAfter.cap', '0 means never'), overriddenNote(rp, 'moveAfterSeconds'))),
      T('pl.loot-zones.set.moveAfter.hint', 'Only on the zone\'s own places, and never with a player within 50 m.')) : null,
      guardsOn ? row(T('pl.loot-zones.set.keepAway', 'Never appear closer to a player than'), field(numIn(rp.keepAwayFromPlayers, function (v) { rp.keepAwayFromPlayers = v; markDirty(); }, 0, 1000, T('pl.loot-zones.unit.metres', 'm'), M),
        caps(keepCaption(rp), overriddenNote(rp, 'keepAwayFromPlayers'))),
      T('pl.loot-zones.set.keepAway.hint', 'Places this close to a player wait until they leave, so no guard pops up.')) : null,
      /**
       * ⚠ **THE GAME'S CLOCK, NOT THE SERVER'S, AND NOT THE ONE THE SCHEDULE ABOVE USES.** A zone's
       * days and hours are the manager's own evaluator on the SERVER'S clock, because a game clock
       * has no day of the week. This is the other feature: "guards only after dark" is a sentence
       * about the world a player is standing in. Both are on this page and they must never be read
       * as the same control, so each says whose clock it is in its own words.
       */
      guardsOn ? row(T('pl.loot-zones.set.gameHours', 'Only at these game hours'), field(h('div', { class: 'lz-routes' }, [
        toggle(!!(gt.enabled), function (v) { gt.enabled = v; markDirty(); }),
        h('small', {}, T('pl.loot-zones.gt.from', 'From')),
        numIn(gt.fromHour == null ? 0 : gt.fromHour, function (v) { gt.fromHour = Math.max(0, Math.min(24, v)); markDirty(); }, 0, 24, T('pl.loot-zones.unit.gameHours', 'game hours')),
        h('small', {}, T('pl.loot-zones.gt.until', 'until')),
        numIn(gt.toHour == null ? 24 : gt.toHour, function (v) { gt.toHour = Math.max(0, Math.min(24, v)); markDirty(); }, 0, 24, T('pl.loot-zones.unit.gameHours', 'game hours')),
      ]), caps(gt.enabled
        ? T('pl.loot-zones.set.gameHours.cap', '{from} to {to} on the game clock', { from: hhmm(gt.fromHour), to: hhmm(gt.toHour) })
        : T('pl.loot-zones.set.gameHours.off', 'off: sent at any hour'),
      overriddenNote(rp, 'gameTime'))),
      // ⚠ The last sentence here is the NOT-APPLIED one and it is the only place it appears in this
      // hint. It must never be reworded into "the window closes", which is a different state with
      // its own key (`pl.loot-zones.gt.closed`).
      T('pl.loot-zones.set.gameHours.hint',
        'Game time, not server time. 21–5 crosses midnight. Closing stops refills. Per guard: "{fold}".', { fold: labPerGuard() })) : null,
      row(T('pl.loot-zones.set.wake', 'Only while a player is within'), field(numIn(sm.wakeDistance == null ? 40000 : sm.wakeDistance, function (v) { sm.wakeDistance = v; markDirty(); }, 50, 2000, T('pl.loot-zones.unit.metres', 'm'), M),
        T('pl.loot-zones.set.wake.cap', 'of the zone')),
      T('pl.loot-zones.set.wake.hint', 'Acts only with a player this close. Over 500 m, it acts before sentries appear.')),
    ].concat(guardsOn ? [h('h4', { class: 'lz-group' }, T('pl.loot-zones.group.life', 'How long they stay'))]
      .concat(ownLifeRows(sm)) : []).concat([
      more('guards:' + (scope || 'default'), labTechnical(), [
        guardsOn ? row(labMaxPosts(), field(numIn(rp.maxPosts, function (v) { rp.maxPosts = v; markDirty(); }, 1, 60, T('pl.loot-zones.unit.places', 'places')),
          overriddenNote(rp, 'maxPosts')),
        T('pl.loot-zones.set.maxPosts.hint', 'Ceiling on sentry spots plus spread places. Tunnel places have their own.')) : null,
        row(T('pl.loot-zones.set.patrolEvery', 'Look every'), numIn(sm.nearbyPatrolSeconds == null ? 5 : sm.nearbyPatrolSeconds, function (v) { sm.nearbyPatrolSeconds = v; markDirty(); }, 3, 60, T('pl.loot-zones.unit.seconds', 'seconds')),
          T('pl.loot-zones.set.patrolEvery.hint', 'How often the zone is checked while a player is near.')),
        row(T('pl.loot-zones.set.searchBox', 'Search height and reach'), h('div', { class: 'lz-routes' }, [
          h('small', {}, T('pl.loot-zones.set.searchBox.height', 'Height')),
          numIn(sm.centreZ, function (v) { sm.centreZ = v; markDirty(); }, null, null, T('pl.loot-zones.unit.metres', 'm'), M),
          h('small', {}, T('pl.loot-zones.set.searchBox.reach', 'Up and down')),
          numIn(sm.reachZ, function (v) { sm.reachZ = v; markDirty(); }, 0, null, T('pl.loot-zones.unit.metres', 'm'), M),
        ]), T('pl.loot-zones.set.searchBox.hint', 'Where the zone looks for sentries and zombies. Defaults cover the whole map.')),
        row(T('pl.loot-zones.set.globalRespawn', 'Also slow SCUM\'s own sentry respawn'), toggle(!!gr.enabled, function (v) { gr.enabled = v; markDirty(); }),
          T('pl.loot-zones.set.globalRespawn.hint', 'For the whole island, not just this zone.')),
        gr.enabled ? row(T('pl.loot-zones.set.respawnDelay', 'Sentry respawn delay'), numIn(gr.seconds, function (v) { gr.seconds = v; markDirty(); }, 0, 1440, T('pl.loot-zones.unit.minutes', 'minutes'), MIN),
          T('pl.loot-zones.set.respawnDelay.hint', 'The game ships 10 minutes.')) : null,
      ]),
    ]);
  }

  /**
   * ── HOW BUSY THE ZONE IS ───────────────────────────────────────────────────────────────────────
   *
   * The OTHER creature question on this page, and it must never be read as the guards above. A guard
   * is one character this plugin puts in one place, which needs the spawn route and somebody online.
   * How busy a PLACE is is the game's own spawn plan — SCUM authors the whole population plan in one
   * cooked asset and the running server re-reads it — so this reaches the game with nobody online at
   * all. What it cannot do is put anything into an empty world: the game never places a creature, it
   * authors a place and spawns when a player comes near it. Every sentence here says so.
   *
   * ⚠ **A PLAN IS SHARED BY EVERY PLACE OF ITS KIND**, and no setting on this page can undo that:
   * the plan is the game's, shared by construction. So a zone does not turn up ITS village, it turns
   * up villages — which is why the sentence ABOVE the controls counts the spill before anything has
   * been chosen, and why "Leave a kind of place alone if more than" exists at all.
   */
  /**
   * The bridge's own caption for the switch this needs, in the bridge's own English words.
   *
   * ⚠ **DELIBERATELY NOT A TRANSLATION KEY.** It is the text on a card in the bridge's settings —
   * exactly like `x.label` out of `/bridge-check` beside it — and a translated guess here would send
   * an owner hunting for a control nobody has. The ROUTE to that card is the other half and is built
   * from the PANEL's own keys instead, which is what `bridgeWhere()` is for.
   */
  var ACTIVITY_SWITCH = 'Allow changing how busy a kind of place is';

  /**
   * What this zone covers, what changing it would reach, and what is stopping it — read live.
   *
   * ⚠ **THREE ANSWERS, NOT TWO.** "The bridge could not be asked", "the rectangle covers nothing"
   * and "it covers six places" are different facts that a screen printing a zero runs together — and
   * telling somebody their zone reaches nothing when nobody has looked is the worse half of that.
   * So the first is the BACKEND's own sentence, word for word, and never one written here. Every
   * control below this stays editable in all three.
   */
  function activitySummary(z, a) {
    // ⚠ `act`, and NEVER `st`. `st` and `state.status` are the STATUS object everywhere on this page,
    // and `check-loot-zones` Y5 asserts that every field read off either name is one `GET /status`
    // really publishes — so a local called `st` holding this route's body reports eight of its own
    // fields as status fields the backend has never had.
    var act = state.activity;
    var out = [];
    // Nobody has answered yet, which is silence rather than a fact. A guess here would be a number.
    if (!act) return out;
    if (act.known === false) {
      out.push(note('', T('pl.loot-zones.sum.activity.unknown', '{why}', { why: act.why || '' })));
      return out;
    }
    // Said only while this zone is asking for something: a switch that governs nothing is noise on a
    // zone whose answer is "leave the game alone", and noise is how a note like this stops being read.
    if (act.canChange === false && a && (a.mode === 'busier' || a.mode === 'quieter')) {
      out.push(note('bad', T('pl.loot-zones.sum.activity.off',
        'The bridge will not change a spawn plan until "{switch}" is on, under {where}.',
        { switch: ACTIVITY_SWITCH, where: bridgeWhere() })));
    }
    var zr = (act.zones || {})[String(z.id)];
    if (!zr) return out;
    if (!zr.coverage) {
      out.push(note('', T('pl.loot-zones.sum.activity.unknown', '{why}', { why: zr.why || '' })));
      return out;
    }
    var kinds = zr.coverage.kinds || [];
    /**
     * ⚠ **A SHARE NOTHING COULD READ IS NOT A SHARE OF ZERO.** `elsewhere` is `null` for a plan the
     * island's own list does not carry, and folding that into the total would publish a number
     * smaller than the world as though it had been measured. It is counted apart, and the note
     * underneath is what says the figures are a floor.
     */
    var unknownShare = kinds.filter(function (k) { return k.elsewhere == null; }).length;
    var elsewhere = kinds.reduce(function (n, k) {
      return n + (k.elsewhere == null ? 0 : Math.max(0, Number(k.elsewhere) || 0));
    }, 0);
    var here = Number(zr.coverage.here) || 0;
    var line;
    if (!here) {
      line = T('pl.loot-zones.sum.activity.none',
        'No game spawn places fall inside this zone, so there is nothing to change.');
    } else if (elsewhere > 0) {
      line = T('pl.loot-zones.sum.activity.spread',
        'This zone covers {here} running on {kinds}, shared with {elsewhere} elsewhere. This changes those too.',
        { here: nPlaces(here), kinds: nPlans(kinds.length), elsewhere: nElsewhere(elsewhere) });
    } else {
      line = T('pl.loot-zones.sum.activity.only',
        'This zone covers {here}, and nothing else on the island shares their spawn plan.',
        { here: nPlaces(here) });
    }
    out.push(h('div', { class: 'lz-summary' }, [h('p', {}, line)]));
    // A place whose own plan could not be read is counted in `here` and can never be acted on, so it
    // belongs in the same sentence as a list the bridge had to cut short: the counts are a floor.
    if (act.truncated || act.positionsUnavailable || unknownShare || zr.coverage.unnamed) {
      out.push(note('', T('pl.loot-zones.sum.activity.partial',
        'Some places could not be read, so the counts above are too low.')));
    }
    return out.concat(activityPlanBlock(zr.coverage,
      !!(a && (a.mode === 'busier' || a.mode === 'quieter')), z.id));
  }

  /**
   * ── WHAT THESE PLACES CAN ACTUALLY PRODUCE ───────────────────────────────────────────────────
   *
   * **A plan's chance decides how OFTEN the game rolls; the AMOUNT is on the encounter behind it**,
   * and a plan can be authored to make none. Driven on a dev server: one kind of place authors an
   * encounter whose base amount is zero, and at a hundred percent with a five-to-ten-second roll and
   * a player standing in it, about forty successful rolls over five minutes put nothing in the
   * world. The control group — the same place at 0% and then at 100% — gave nothing and then five
   * characters, so the dial does drive the game. It cannot conjure something out of a plan that
   * makes nothing, and a card reading "busier" over one of those is a promise with no symptom.
   *
   * ⚠ **THREE STATES, AND THEY LOOK DIFFERENT ON THE SCREEN.** *Can spawn* is a fact and carries the
   * number. *Makes nothing* is a fact and carries a refusal. *Could not be read* is NEITHER, carries
   * the bridge's own sentence, and — this is the half that matters — **leaves every control exactly
   * as it was**. Greying a dial out over a reading that failed is how "I could not find out" becomes
   * "the game does not have it", which is the one collapse this whole block exists to prevent.
   */
  function activityPlanBlock(cov, asking, scope) {
    var kinds = (cov && cov.kinds) || [];
    if (!kinds.length) return [];
    /**
     * ⚠ **THE LIST IS ONE LINE PER PLAN AND A ZONE COVERS SIX OF THEM, SO IT IS FOLDED.** The one
     * thing that has to be read before a dial is touched — every plan under this rectangle makes no
     * characters, so turning it up changes nothing — is a refusal and stays on the screen. The rest
     * is a reading, and a reading is what a fold is for.
     */
    var out = [];
    var no = kinds.filter(function (k) { return k.spawns === 'no'; });
    var unknown = kinds.filter(function (k) { return k.spawns !== 'no' && k.spawns !== 'yes'; });
    var yes = kinds.filter(function (k) { return k.spawns === 'yes'; });

    /**
     * One line per plan, because the owner is configuring a rectangle and the rectangle covers
     * several — and "two of these work and one does not" is a sentence a total cannot carry.
     * ⚠ `asset` is the GAME's own name for a plan and travels as a VALUE, never as a key.
     */
    out.push(h('ul', { class: 'lz-plan' }, kinds.map(function (k) {
      var what;
      if (k.spawns === 'yes') {
        what = k.maxBaseAmount != null
          ? T('pl.loot-zones.plan.makes', 'makes up to {n} each time a roll succeeds',
            { n: nCharacters(k.maxBaseAmount) })
          : T('pl.loot-zones.plan.makesSome', 'puts something in the world when a roll succeeds');
      } else if (k.spawns === 'no') {
        what = T('pl.loot-zones.plan.makesNothing',
          'makes no characters at all, however often it is rolled');
      } else {
        what = T('pl.loot-zones.plan.unknown', 'what it makes could not be read');
      }
      return h('li', { class: 'lz-plan-' + (k.spawns === 'yes' ? 'yes' : (k.spawns === 'no' ? 'no' : 'unsure')) }, [
        /**
         * ⚠ **A RAW GAME IDENTIFIER, DRAWN AS ONE RATHER THAN DRESSED UP AS A NAME.** This was
         * `<b>Enc_Puppets_Village</b>` — bold, where every other bold word on this page is
         * something a person wrote. There is nothing to resolve it with and that is a fact about
         * the product rather than a gap in this line: the payload carries no display name for a
         * spawn plan, and the manager's one resolver (`src/discord/items.js`, reached from here as
         * `SSA.itemInfo`) has never heard of an encounter class — the backend says so in its own
         * words where it builds these rows. Tidying it here would be a prefix-strip rule of this
         * file's own, and would turn a class into something that READS like the game's word for
         * the place while being nothing of the kind.
         *
         * So it is the code, in the panel's data face, with the sentence saying what it is.
         */
        h('code', { class: 'lz-code' }, String(k.asset || '')),
        ' — ' + T('pl.loot-zones.plan.isPlan', 'the game\'s own name for this spawn plan') + ', ',
        T('pl.loot-zones.plan.line', '{here} here, {what}.',
          { here: nPlaces(Number(k.here) || 0), what: what }),
        // ⚠ **THE BASE AMOUNT IS NOT THE WHOLE NUMBER**, and saying the first without the second is
        // how a screen is accurate and still wrong. Both are whole sentences of their own rather
        // than clauses glued onto the one above, and both are drawn only where the plan can spawn at
        // all — they say nothing about a plan that makes none.
        (k.spawns === 'yes' && Number(k.extraPerPlayer) > 0)
          ? ' ' + T('pl.loot-zones.plan.perPlayer', 'It adds {n} more for every player nearby.',
            { n: nCharacters(Number(k.extraPerPlayer)) })
          : null,
        // What the game then does with its own curve is not established, so this says that a curve
        // exists and claims no direction for it. A guess here would be this page inventing a number.
        (k.spawns === 'yes' && k.amountCurve === true)
          ? ' ' + T('pl.loot-zones.plan.curve',
            'The game also applies its own curve, so treat this as a starting figure.')
          : null,
        // The spill again, per plan rather than as one total: it is the honest cost of the setting
        // and it is a different number for each of these rows.
        (k.elsewhere == null || !k.elsewhere) ? null
          : ' ' + T('pl.loot-zones.plan.shared', 'Shared with {n} on the island.',
            { n: nElsewhere(Number(k.elsewhere)) }),
      ]);
    })));

    // The headline, and it is a REFUSAL rather than a note when every plan here is a confirmed zero:
    // nothing this setting can do will make that rectangle busier, and the backend leaves those
    // plans alone rather than writing a change that reads as success and does nothing.
    // ⚠ **THE WASH FOLLOWS WHAT THE ZONE ASKED FOR, THE SENTENCE DOES NOT.** The fact is worth
    // knowing before anybody touches a control, so it is on the screen whatever the mode says; the
    // RED is a refusal, and a zone set to leave the game alone has had nothing refused. An alarm on
    // a zone that asked for nothing is how a note like this stops being read at all.
    var loud = [];
    if (no.length && !yes.length && !unknown.length) {
      (asking ? loud : out).push(note(asking ? 'bad' : '', T('pl.loot-zones.plan.allZero',
        'Each plan here makes no characters: nothing here to turn up or down.')));
    } else if (no.length) {
      out.push(note('', T('pl.loot-zones.plan.someZero',
        '{n} here make no characters, so they are left alone: {list}. The rest change as asked.',
        { n: nPlans(no.length), list: no.map(function (k) { return k.asset; }).join(', ') })));
    }
    // ⚠ The bridge's OWN sentence, word for word and once per distinct reason — a reading that
    // failed is not a verdict, and re-wording it here is how a screen starts claiming one.
    var reasons = [];
    unknown.forEach(function (k) {
      var w = String(k.planWhy || '');
      if (w && reasons.indexOf(w) < 0) reasons.push(w);
    });
    if (unknown.length) {
      out.push(note('', T('pl.loot-zones.plan.unsure',
        '{n} could not be read and are changed as asked anyway. {why}',
        { n: nPlans(unknown.length), why: reasons.join(' ') })));
    }
    return loud.concat([why('plans:' + (scope || 'default'), out,
      T('pl.loot-zones.plan.fold', 'What these places can produce'))]);
  }

  /**
   * The rollup the CONTROLS read, and the only thing that may take one away.
   *
   * ⚠ It answers `true` for "confirmed inert" on one shape and one shape only: at least one plan
   * here, every one of them a confirmed `'no'`. An unreadable plan, an empty coverage, a bridge that
   * never answered and a server that is not running all leave it `false`, which is the direction
   * that keeps the page editable.
   */
  function activityInert(z) {
    var act = state.activity;
    if (!act || act.known !== true) return false;
    var zr = (act.zones || {})[String(z && z.id)];
    var kinds = (zr && zr.coverage && zr.coverage.kinds) || [];
    if (!kinds.length) return false;
    return kinds.every(function (k) { return k.spawns === 'no'; });
  }

  /**
   * The activity controls, for ONE settings object — the zone's own copy of them.
   *
   * Every one of them is editable with the server stopped and the bridge absent, which is this
   * page's rule everywhere: only the counts above go away, replaced by the backend's own sentence.
   */
  /**
   * The activity controls, for ONE settings object — the zone's own copy of them.
   *
   * ⚠ **`inert` IS THE ONE THING LIVE DATA MAY TAKE AWAY, AND IT TAKES AWAY EXACTLY ONE BOX.** The
   * mode select, the roll interval and the ceiling stay editable in every state, so a zone is still
   * configured end to end with the server stopped — which is this page's rule everywhere. Only the
   * percentage goes, only when every plan under the rectangle is a CONFIRMED zero, and only with the
   * reason printed beside it. `activityInert()` answers false for a reading that failed, so nothing
   * here is ever taken away because nobody could look.
   */
  function activityControls(a, scope, inert) {
    var mode = (a.mode === 'busier' || a.mode === 'quieter') ? a.mode : 'leave';
    var field = function (control, t) { return h('div', { class: 'lz-ctl' }, [control, t ? h('small', {}, t) : null]); };
    return [
      // ⚠ The VALUES are the backend's own words and are never translated; only the captions are.
      row(labActivityMode(), sel(mode, [
        ['leave', T('pl.loot-zones.actmode.leave', 'Leave the game\'s own spawning alone')],
        ['busier', T('pl.loot-zones.actmode.busier', 'Busier')],
        ['quieter', T('pl.loot-zones.actmode.quieter', 'Quieter')],
      ], function (v) { a.mode = v; markDirty(); }),
      T('pl.loot-zones.set.activityMode.hint',
        'Leaves the game alone until you change it, so existing zones behave as before.')),
      mode === 'leave' ? null
        : row(T('pl.loot-zones.set.activityPercent', 'Of what the game itself spawns here'),
          field(numIn(a.percent == null ? 100 : a.percent, function (v) {
            a.percent = Math.max(0, Math.min(300, v)); markDirty();
          }, 0, 300, T('pl.loot-zones.unit.percent', '%'), 1, inert === true),
          inert === true
            ? T('pl.loot-zones.set.activityPercent.inert',
              'No spawn plan here makes characters. Set the mode back, or move the zone.')
            : null),
          T('pl.loot-zones.set.activityPercent.hint',
            'Percent of the game\'s default (100). Sets how often it rolls, not how many spawn.')),
      more('activity:' + (scope || 'default'), labTechnical(), [
        row(T('pl.loot-zones.set.activityCheck', 'How often the game rolls for a spawn'),
          // 0 or 30 upwards: anything between is a roll so tight it costs the server real work for a
          // change nobody would see, so it is taken to the floor rather than stored as typed.
          field(numIn(a.checkSeconds || 0, function (v) {
            a.checkSeconds = v <= 0 ? 0 : Math.max(30, Math.min(3600, v)); markDirty();
          }, 0, 3600, T('pl.loot-zones.unit.seconds', 'seconds')),
          Number(a.checkSeconds) > 0 ? null
            : T('pl.loot-zones.set.activityCheck.off', 'Left exactly as the game has it')),
          // ⚠ **THE UNIT IS IN THE SENTENCE.** This tree has been bitten three times in one day by a
          // duration published bare — game minutes read as seconds, two intervals on one card at
          // different multiples of the clock. These are REAL seconds and the screen says so.
          T('pl.loot-zones.set.activityCheck.hint',
            'Real seconds; the game\'s own is 5–10 minutes. Shorter shows changes sooner, costs more.')),
        row(T('pl.loot-zones.set.activityMax', 'Leave a kind of place alone if more than'),
          field(numIn(a.maxPlaces || 0, function (v) { a.maxPlaces = Math.max(0, v); markDirty(); },
            0, 999, T('pl.loot-zones.unit.places', 'places')),
          Number(a.maxPlaces) > 0 ? null
            : T('pl.loot-zones.set.activityMax.off', 'No limit — every kind of place your zone covers is changed')),
          T('pl.loot-zones.set.activityMax.hint',
            'Places of one kind share one spawn plan. This caps how far changes reach.')),
      ]),
    ];
  }

  /**
   * The spawn plans this plugin is holding right now, and the one button that gives them back.
   *
   * ⚠ **PAGE LEVEL, AND THAT IS NOT A LAYOUT CHOICE.** A plan belongs to the ISLAND rather than to
   * whichever zone asked for it — two zones can want the same one — so a per-zone button would
   * promise to put back something it does not own. Drawn only while there is something to say.
   */
  function activityHeldBlock() {
    // ⚠ `act`, never `st` — see `activitySummary()` above for what that name costs here.
    var act = state.activity;
    if (!act) return null;
    var held = (act.heldByUs || []).length;
    var refused = act.known === true ? (act.refused || []) : [];
    if (!held && !refused.length) return null;
    var kids = [];
    if (held) {
      // Two whole sentences, each at its own key: the second is true whatever the first counts, and
      // it is the one that makes this safe to have left running.
      kids.push(note('wait',
        T('pl.loot-zones.sum.activity.held', '{n} changed right now.', { n: nPlansChanged(held) })
        + ' ' + T('pl.loot-zones.sum.activity.backs',
          'They revert by themselves, when the zone turns off, and on server restart.')));
    }
    refused.forEach(function (r) {
      // ⚠ `asset` is the GAME's own name for a spawn plan and `zone` is what the owner called their
      // zone: both are values and travel as values. A refusal the backend spelled out itself is
      // printed in its own words rather than being re-derived here.
      var why = r.why === 'shared'
        ? T('pl.loot-zones.fail.activity.shared',
          '{asset} is shared by {usedBy} places, more than the {limit} you allowed, so it was left alone.',
          { asset: r.asset, usedBy: r.usedBy, limit: r.limit })
        : (r.why === 'unreadable'
          ? T('pl.loot-zones.fail.activity.unreadable', '{asset} could not be read, so it was left alone.',
            { asset: r.asset })
          // ⚠ The reason an owner can ACT on, and the act is not "raise a limit": there is nothing
          // in that plan to raise. Said in the same words as the card above it.
          : (r.why === 'nothing'
            ? T('pl.loot-zones.fail.activity.nothing',
              '{asset} makes no characters, so rolling it more often changes nothing. Left alone.', { asset: r.asset })
            : String(r.why || '')));
      if (!why) return;
      kids.push(note('', T('pl.loot-zones.fail.activity.zone', '{zone}: {why}', { zone: r.zone || '', why: why })));
    });
    if (held) {
      kids.push(h('div', { class: 'lz-actions' }, [
        h('button', {
          class: 'secondary', type: 'button', onclick: function () {
            api('/activity-restore', { method: 'POST', body: {} }).then(function (r) {
              var bad = (r && Number(r.failed)) || 0;
              var back = (r && Number(r.restored)) || 0;
              SSA.toast(bad
                ? T('pl.loot-zones.fail.activityRestore',
                  '{n} could not be put back. They revert when their hold ends, or on restart.', { n: nPlans(bad) })
                : T('pl.loot-zones.did.activityRestored', '{n} put back.', { n: nPlans(back) }));
              refresh();
            }).catch(failed(T('pl.loot-zones.fail.restoreActivity', 'Not put back')));
          },
        }, [icon('refresh'), T('pl.loot-zones.act.activityRestore', 'Put the spawn plans back')]),
      ]));
    }
    return h('div', { class: 'lz-live' }, kids);
  }

  // ── what the guard settings add up to, in words ──────────────────────────────────────────────────
  // ⚠ `plural(n, 'place', 'places')` is GONE and must not come back: it glues a translated word to a
  // number, which is the one shape a language whose plural is not "add an s" cannot be given. Every
  // caller now asks `nPlaces` / `nGuards` / `nMinutes` / `nSeconds` / `nHours` / `nDays` at the top
  // of this file, each of which is one whole phrase per form at its own key.
  var minutesText = function (sec) {
    var n = Number(sec) || 0;
    if (n <= 0) return null;
    if (n < 60) return nSeconds(Math.round(n));
    return nMinutes(Math.round((n / 60) * 10) / 10);
  };
  /** The distance "Never appear closer than" really works at: a server with no NPCs caps it at 80 m. */
  function keepEffective(rp) {
    var keep = Math.max(0, Number(rp.keepAwayFromPlayers == null ? 5000 : rp.keepAwayFromPlayers));
    var noNpcs = state.status && state.status.npcLimit === 0;
    return { keep: keep, eff: noNpcs ? Math.min(keep, 8000) : keep, capped: noNpcs && keep > 8000 };
  }
  function keepCaption(rp) {
    var k = keepEffective(rp);
    if (k.keep <= 0) return T('pl.loot-zones.keep.off', 'off: a guard may appear right next to a player');
    return k.capped ? T('pl.loot-zones.keep.capped', 'this server allows no NPCs, so this works at 80 m at most') : null;
  }
  function placesCaption(sentriesOut, pat) {
    if (!pat || pat.posts == null) return null;
    var under = Number(pat.underSpots) || 0;
    var surface = Math.max(0, (Number(pat.posts) || 0) - under);
    var bits = [T('pl.loot-zones.places.surface', '{places} on the surface now', { places: nPlaces(surface) })];
    if (under) bits.push(T('pl.loot-zones.places.tunnels', '{places} learned in tunnels', { places: nPlaces(under) }));
    return bits.join(', ');
  }

  /**
   * ⚠ **THE SETTINGS SAY WHAT THEY ADD UP TO.** The owner, looking at eleven numbers: *"moc mi nedava
   * smysl co co dela ... abych mel predstavu kolik kde ceho kdy jak bude"*. Each number was explained on
   * its own and none of them said what the zone would actually do. This is that sentence, rebuilt from
   * the same values on every change, including the ones the server itself decides.
   *
   * ⚠ **TWO LISTS, AND THE SPLIT IS THE POINT.** The first says what WILL happen; the second says what
   * will STOP it. Every ceiling in the second one used to be met as a refusal after a patrol had run
   * on a live server — or, worse, as nothing happening at all and no refusal anywhere — and most of
   * them are answerable with the server stopped, off the owner's own numbers and the set's rectangle.
   */
  /**
   * What "Keep zombies out" really does, which depends on a setting on a different card: the game's
   * own availability grid rule is written only onto a configuration this plugin keeps itself. On an
   * existing configuration the plugin changes nothing about it, so zombies still spawn there and are
   * removed while a player is near.
   */
  function zombiesText() {
    var own = !!(state.cfg && state.cfg.zone && state.cfg.zone.configMode === 'own');
    return own
      ? T('pl.loot-zones.zombies.own', 'Zombies do not spawn inside the zone, and any that walk in are removed.')
      : T('pl.loot-zones.zombies.shared',
        'Zombies here are removed while a player is near. To stop spawns: {card}, {row}.',
        { card: cardRectangle(), row: labConfigMode() });
  }

  function guardSummary(sm, pat, set, scope) {
    var rp = sm.replace || {};
    var kinds = (sm.kinds || []).filter(Boolean);
    var sentriesOut = kinds.indexOf('mapsentry') >= 0 || kinds.indexOf('sentry') >= 0;
    var zombiesOut = kinds.indexOf('puppet') >= 0;
    var guardsOn = sm.mode === 'replace';
    if (!sentriesOut && !zombiesOut && !guardsOn) {
      return h('div', { class: 'lz-summary' }, [h('p', {},
        T('pl.loot-zones.sum.nothing', 'Nothing changes here: sentries, zombies and NPCs are as the game makes them.'))]);
    }
    var wake = Math.round((sm.wakeDistance == null ? 40000 : Number(sm.wakeDistance)) / 100);
    var chosen = chosenGuards(rp);
    var items = [];
    if (sentriesOut) items.push(T('pl.loot-zones.sum.sentries', 'The sentries are put away.'));
    if (zombiesOut) items.push(zombiesText());
    if (guardsOn) {
      if (!chosen.length) {
        items.push(T('pl.loot-zones.sum.noGuard', 'No guard is chosen yet, so nobody is sent.'));
      } else {
        var max = Number(rp.maxGuards) || 0;
        var anyWant = chosen.some(function (t) { return Number(t.want) > 0; });
        var oneEach = chosen.every(function (t) { return (Number(t.count) || 1) === 1; });
        // The names carry their own numbers where they have one, because "8 Guard (Lvl 5) and 4 Bear"
        // is the sentence that was being asked for and "Guard and Bear" is not.
        var names = chosen.map(function (t) {
          return Number(t.want) > 0
            ? T('pl.loot-zones.math.times', '{n} × {name}', { n: Number(t.want), name: prettyGuard(t) })
            : prettyGuard(t);
        });
        var andList = function (list) {
          return list.length === 1 ? list[0]
            : T('pl.loot-zones.sum.and', '{list} and {last}',
              { list: list.slice(0, -1).join(', '), last: list[list.length - 1] });
        };
        items.push(T('pl.loot-zones.sum.guards', '{who} guard the zone, {how}.', {
          who: andList(names),
          how: max ? T('pl.loot-zones.sum.atMost', 'at most {guards} at the same time', { guards: nGuards(max) })
            : (anyWant ? T('pl.loot-zones.sum.asFar', 'as far as the places allow')
              : (oneEach ? T('pl.loot-zones.sum.oneEach', 'one on every place')
                : T('pl.loot-zones.sum.fillAll', 'filling every place'))),
        }));
        var where = [];
        if (sentriesOut) where.push(T('pl.loot-zones.sum.whereSentries2', 'at one more place for each sentry put away'));
        if (Number(sm.ownPosts) > 0) {
          where.push(T('pl.loot-zones.sum.whereOwn', 'at {places} spread over the zone',
            { places: nPlaces(Number(sm.ownPosts)) }));
        }
        where.push(T('pl.loot-zones.sum.whereTunnels', 'in tunnels players have walked through'));
        items.push(T('pl.loot-zones.sum.theyStand', 'They stand {where}.', { where: andList(where) }));
        if (sentriesOut || Number(sm.ownPosts) > 0) {
          items.push(T('pl.loot-zones.sum.killedMoves', 'A killed guard comes back at another place, never where it fell.'));
          var every = minutesText(rp.moveAfterSeconds);
          if (every) items.push(T('pl.loot-zones.sum.moveAfter', 'A guard nobody touches changes place after {time}.', { time: every }));
        }
      }
    }
    /**
     * ⚠ **TWELVE SENTENCES OF "WHAT WILL STOP IT" USED TO SIT OPEN ABOVE EVERY GUARD SETTING, AND
     * THE TWO THAT MATTER WERE SOMEWHERE IN THE MIDDLE OF THEM.** They are still all here and still
     * all written from the owner's own numbers — a ceiling met as a refusal minutes later on a live
     * server is a ceiling nobody told them about, which is the whole reason the list exists. What
     * changed is which ones are in the way: a ⚠ sentence is a thing that is going wrong and stays
     * on the screen, and the rest are the working.
     */
    var limits = guardLimits(sm, set, chosen, sentriesOut || zombiesOut, guardsOn);
    var loud = limits.filter(isWarn);
    var quiet = limits.filter(function (t) { return !isWarn(t); });
    return h('div', {}, [
      h('div', { class: 'lz-summary' }, [
        h('p', {}, T('pl.loot-zones.sum.head', 'While a player is within {m} m of this zone:', { m: wake })),
        h('ul', {}, items.map(function (t) { return h('li', {}, t); })),
      ]),
    ].concat(loud.map(function (t) { return note('wait', t); })).concat([
      quiet.length ? why('limits:' + (scope || 'default'),
        [h('ul', { class: 'lz-stops' }, quiet.map(function (t) { return h('li', {}, t); }))],
        T('pl.loot-zones.sum.limits', 'What will stop it:')) : null,
    ]));
  }

  /**
   * Every ceiling this zone will really meet, in one place, while the guards are switched on.
   *
   * ⚠ **A LIMIT AN OWNER MEETS AS A REFUSAL IS A LIMIT NOBODY TOLD THEM ABOUT.** Two of these have no
   * refusal at all — a zone nobody is near simply does nothing, and an NPC the game culls leaves no
   * trace on this side — and one of them (the sweep the bridge will accept) is refused after a patrol
   * has run, minutes later, on a screen nobody is looking at. All of them are said here instead.
   */
  function guardLimits(sm, set, chosen, clearing, guardsOn) {
    var rp = sm.replace || {};
    var out = [];
    var wake = Math.round((sm.wakeDistance == null ? 40000 : Number(sm.wakeDistance)) / 100);
    out.push(T('pl.loot-zones.lim.asleep',
      'Nobody within {m} m, so nothing happens here: no creatures exist without a player near.', { m: wake }));

    if (guardsOn) {
      /**
       * ⚠ **THE POSITIVE CASE IS NOT MEASURED AND SAYS SO.** At zero the figure is a measurement —
       * guards at 120, 162 and 173 m stayed and guards at 177 m and beyond were destroyed three to
       * four seconds after they appeared. Above zero nobody has driven it, and quoting the 175 m
       * there would be handing an owner a number this plugin does not have.
       */
      var lim = state.status ? state.status.npcLimit : undefined;
      if (lim === 0) {
        out.push(T('pl.loot-zones.lim.npcZero',
          'NPC limit is 0: a guard with no player within 175 m vanishes in seconds.'));
      } else if (lim > 0) {
        out.push(T('pl.loot-zones.lim.npcSome',
          'This server allows {n} NPCs at once. How far from players guards last is unknown.', { n: lim }));
      } else {
        out.push(T('pl.loot-zones.lim.npcUnknown',
          'The NPC limit could not be read, so how far guards last is unknown.'));
      }

      var k = keepEffective(rp);
      if (k.keep <= 0) {
        out.push(T('pl.loot-zones.lim.keepOff',
          '"{control}" is off, so a guard may appear right in front '
          + 'of somebody.', { control: T('pl.loot-zones.set.keepAway', 'Never appear closer to a player than') }));
      } else {
        out.push(k.capped
          ? T('pl.loot-zones.lim.keepCapped', 'Places within {m} m of a player wait until they leave (80 m max).',
          { m: Math.round(k.eff / 100) })
          : T('pl.loot-zones.lim.keepOn', 'A place within {m} m of a player waits until they move on.', { m: Math.round(k.eff / 100) }));
      }

      var cap = Math.max(1, Number(rp.maxPosts == null ? 12 : rp.maxPosts) || 12);
      out.push(T('pl.loot-zones.lim.places', 'At most {places} here, sentry spots included; extra ones stay unguarded. Tunnels count separately.', { places: nPlaces(cap) }));

      var maxG = Math.max(0, Number(rp.maxGuards) || 0);
      out.push(maxG
        ? T('pl.loot-zones.lim.maxGuards', 'At most {guards} stand here at once, whatever the places '
          + 'would take.', { guards: nGuards(maxG) })
        : T('pl.loot-zones.lim.noMaxGuards', '"{control}" is 0, so nothing caps the total but the places themselves.',
          { control: labMaxGuards() }));

      var cool = minutesText(rp.cooldownSeconds);
      out.push(cool
        ? T('pl.loot-zones.lim.cooldown', 'At most one new guard every {t}; twelve places take twelve of those.', { t: cool })
        : T('pl.loot-zones.lim.noCooldown', 'No cooldown: guards arrive a few seconds apart until every place is taken.'));

      var death = minutesText(rp.afterDeathSeconds);
      out.push(death
        ? T('pl.loot-zones.lim.afterDeath', 'A killed guard\'s place stands empty for {t} before the next one comes.', { t: death })
        : T('pl.loot-zones.lim.noAfterDeath', 'A killed guard is replaced straight away.'));

      /**
       * ⚠ **A GUARD THAT CANNOT BE SENT AT ALL BELONGS IN "WHAT WILL STOP IT", not only in a line on
       * its own row.** This is the list an owner reads to find out why a zone looks thinner than the
       * numbers say, and a boss on a server that has never had one is the strongest answer there is.
       */
      // ⚠ ONE LIST, WHERE THERE USED TO BE TWO. The split was on a switch that let the zone send a
      // boss it cannot aim; the owner refused it, so there is no longer a case in which one arrives
      // beside a player, and a sentence describing that case would describe nothing.
      var noFirst = chosen.filter(function (t) {
        var f = firstOneOf(t);
        return !!f && (f.atPlayer || f.auto === false);
      });
      if (noFirst.length) {
        out.push(noFirst.length === 1
          ? T('pl.loot-zones.lim.noFirstOne',
            '⚠ {list} waits until the game spawns one here itself; its places stay empty meanwhile.',
            { list: noFirst.map(prettyGuard).join(', ') })
          : T('pl.loot-zones.lim.noFirstMany',
            '⚠ {list} wait until the game spawns one here itself; their places stay empty meanwhile.',
            { list: noFirst.map(prettyGuard).join(', ') }));
      }

      /**
       * ⚠ **A RANDOM POST IS HELD BY ANYTHING OF ITS KIND, AND THIS IS THE LIST THAT HAS TO SAY SO.**
       * It is not a refusal and it produces no message anywhere: the post simply reads as held and
       * is not refilled. The owner who finds a deer standing in for a guard should have read it here.
       */
      var rnd = chosen.filter(randomOf);
      if (rnd.length) {
        out.push(rnd.length === 1
          ? T('pl.loot-zones.lim.randomOne',
            '⚠ {list}: any creature of that kind, wildlife included, holds its post, so it may not refill.', { list: rnd.map(prettyGuard).join(', ') })
          : T('pl.loot-zones.lim.randomMany',
            '⚠ {list}: any creature of that kind, wildlife included, holds their posts, so they may not refill.', { list: rnd.map(prettyGuard).join(', ') }));
      }

      // ⚠ THE ROUTE EACH ONE IS REALLY ON, not the one its row names. Since bridge 2.27.0 an
      // ordinary guard is placed by the engine, so this used to promise that a guard "goes through
      // the game's own spawn command" about one that does not — and the two differ in exactly the
      // things this sentence is about: an id, a facing, and whether it is there tomorrow.
      var direct = chosen.filter(onEngineRoute);
      var lasting = chosen.filter(function (t) { return !t.random && !onEngineRoute(t); });
      if (direct.length) {
        var lastingText = !lasting.length ? ''
          : (lasting.length === 1
            ? T('pl.loot-zones.lim.lastingOne', ' {list} uses the game\'s spawn command; whether it survives a restart is unknown.', { list: lasting.map(prettyGuard).join(', ') })
            : T('pl.loot-zones.lim.lastingMany', ' {list} use the game\'s spawn command; whether they survive a restart is unknown.', { list: lasting.map(prettyGuard).join(', ') }));
        out.push(direct.length === 1
          ? T('pl.loot-zones.lim.directOne', '{list} is gone after a restart; the zone puts it back when players return.{lasting}', { list: direct.map(prettyGuard).join(', '), lasting: lastingText })
          : T('pl.loot-zones.lim.directMany', '{list} are gone after a restart; the zone puts them back when players return.{lasting}', { list: direct.map(prettyGuard).join(', '), lasting: lastingText }));
      }
    }

    /**
     * ⚠ **THE SWEEP THE BRIDGE WILL ACCEPT, AGAINST THE ONE THIS ZONE NEEDS.** The removal module
     * REFUSES a radius over its own "Largest radius one call may use" rather than narrowing to it, so
     * a zone too big for that setting has its sentries left exactly where they are — and the refusal
     * arrives minutes later, after a patrol, on a card nobody is looking at. The rectangle comes from
     * the set's own `Zones.json`, so this is answerable before the server has ever been started.
     */
    if (clearing) {
      var rect = ((set && set.ok && set.rects) || [])[0];
      if (rect) {
        // ⚠ THE RECTANGLE ALONE, the backend's own floor. "Search height and reach" is VERTICAL and is
        // bought out of whatever the ceiling leaves over, never added to the distance — adding it made
        // every zone on an untouched install "need" over a kilometre against a 50 m ceiling, and the
        // backend stopped doing that long before this screen did.
        var need = Math.ceil(Math.sqrt(Math.pow(Number(rect.width) / 2, 2)
          + Math.pow(Number(rect.height) / 2, 2)));
        // Published by the plugin's own status (`despawn.maxRadius`) only where the bridge has
        // answered; absent is absent, and is said as such rather than as the shipped default
        // pretending to be this server's.
        var dsp = state.status && state.status.despawn;
        var said = (dsp && Number(dsp.maxRadius) > 0) ? Number(dsp.maxRadius) : null;
        if (said != null && need > said) {
          out.push(T('pl.loot-zones.lim.sweepTooWide',
            '⚠ Needs a {need} m sweep; the limit is {max} m. Raise "Largest radius one call may use".',
            { need: metres(need), max: metres(said) }));
        } else if (said != null) {
          out.push(T('pl.loot-zones.lim.sweepOk', 'Clearing this zone sweeps {need} m, inside the {max}'
            + ' m the bridge allows.', { need: metres(need), max: metres(said) }));
        } else {
          out.push(T('pl.loot-zones.lim.sweepUnknown',
            'Needs a {need} m sweep. Nothing clears? Raise "Largest radius one call may use" (default 50 m).', { need: metres(need) }));
        }
      }
    }
    return out;
  }

  // ── the page ───────────────────────────────────────────────────────────────────────────────────
  /**
   * ⚠ `render()` EMPTIES THE ROOT BEFORE IT BUILDS ANYTHING, so anything it throws leaves a blank
   * tab — no error, no half-drawn form, nothing an owner can act on. That is what a report of "the
   * panel is empty" was, and a guard against the one cause found is not a guard against the next
   * one, so the whole of it is wrapped.
   */
  /**
   * `opts.ifChanged`: draw into a detached box first and compare it with what the last real draw
   * produced. Equal means nothing on the page would change, so the page is left exactly as it is —
   * same nodes, same open dropdown, same hover. Only `saveBar` is written by `draw()` from outside
   * the box, so it is put back after the trial draw.
   */
  var lastDrawn = null;
  function render(opts) {
    if (opts && opts.ifChanged && root && lastDrawn !== null) {
      var live = root, bar = saveBar, probe = document.createElement('div');
      var same = false;
      root = probe;
      try { draw(); same = probe.innerHTML === lastDrawn; } catch (ignored) { same = false; }
      root = live;
      saveBar = bar;
      if (same) return;
    }
    // ⚠ BEFORE `draw()`, which empties the root — see `beforeRedraw` for what is being kept and
    // why a reconciler is not what is used here.
    var keep = beforeRedraw();
    lastDrawn = null;
    try { draw(); lastDrawn = root ? root.innerHTML : null; } catch (e) {
      try {
        root.innerHTML = '';
        root.appendChild(h('div', { class: 'lz-note bad' },
          T('pl.loot-zones.drawFailed', 'This tab could not draw: {why}. A plugin fault; your settings are unchanged.',
          { why: (e && e.message) || T('pl.loot-zones.unknownError', 'unknown error') })));
      } catch (ignored) { /* nothing left to draw on */ }
      if (typeof console !== 'undefined' && console.error) console.error('[loot-zones]', e);
    }
    afterRedraw(keep);
  }

  function draw() {
    if (!root) return;
    root.innerHTML = '';
    var c = state.cfg;
    if (!c) {
      // Drawing a settings form out of nothing would let an owner "save" that nothing over what they
      // had, so this is reported instead — by name, with the two places the answer really comes from.
      root.appendChild(broken
        ? h('div', { class: 'lz-note bad' }, T('pl.loot-zones.noSettings',
          'Backend not answering. Check the plugin is on, the licence active, and the manager log.'))
        : h('div', { class: 'lz-note' }, T('pl.loot-zones.loading', 'Loading…')));
      root.appendChild(h('div', { class: 'lz-actions' }, [
        h('button', { class: 'secondary', type: 'button', onclick: function () { refresh(); } },
          [icon('refresh'), T('pl.loot-zones.tryAgain', 'Try again')]),
      ]));
      return;
    }
    // Every nested read below is defended: the backend merges its own defaults, so a complete answer
    // is what a working install sends, and this is about the answers a broken one sends. One missing
    // key must cost that row, never the whole page.
    if (!c.zone) c.zone = {};
    if (!c.zone.colour) c.zone.colour = {};
    if (!c.messages) c.messages = {};
    if (!c.sentries) c.sentries = {};
    if (!c.activity) c.activity = {};
    if (!Array.isArray(c.zones)) c.zones = [];
    var st = state.status || {};
    var sets = (state.sets && state.sets.sets) || [];

    // ── what is true right now ───────────────────────────────────────────────────────────────────
    var live = [];
    if (state.sets && state.sets.serverConfigured === false) {
      live.push(note('bad', T('pl.loot-zones.live.noServerDir',
        'No server folder set yet. You can still set up everything here.')));
    }
    /**
     * ⚠ **"IT IS NOT THERE" AND "I COULD NOT OPEN IT" ARE OPPOSITE FACTS AND THIS DREW ONE
     * SENTENCE FOR BOTH.** An owner whose folder is right where they put it — held open by a
     * backup, refused by an ACL, on a share that has gone away — was told to create it. The
     * backend answers `missing` now and each state gets the sentence its reader can act on; the
     * failure's own code travels, because "EPERM" is the whole diagnosis for whoever has to fix it.
     */
    if (state.sets && state.sets.readable === false) {
      if (state.sets.missing === false) {
        live.push(note('bad', T('pl.loot-zones.live.setsUnreadable',
          'Sets folder unreadable: {path} ({why}). No zone can be switched on until it opens.',
        { path: state.sets.root || '', why: state.sets.why || '' })));
      } else if (state.sets.missing === true) {
        live.push(note('bad', T('pl.loot-zones.live.noSetsFolder', 'Sets folder missing: {path}. Create it with one folder per zone, each with a Zones.json.',
        { path: state.sets.root || '' })));
      } else {
        live.push(note('bad', T('pl.loot-zones.live.noSetsRoot',
          'No sets folder: the manager gave no data folder and none is set below.')));
      }
    }
    if (st.zonesKnown === false) {
      live.push(note('', st.zonesUnknownWhy
        || T('pl.loot-zones.live.noZoneList', 'The game has not sent its zone list yet; nothing to draw.')));
    }
    if (st.active && st.active.length) {
      live.push(note('good', T('pl.loot-zones.live.on', 'Switched on: {list}', {
        list: st.active.map(function (a) {
          // Which of the two routes drew it, because "players can see this now" and "players will see
          // this when the server starts" are different facts and a rectangle looks the same either way.
          if (a.drawn === false) {
            return T('pl.loot-zones.live.on.waiting', '{name} (loot only — the rectangle is waiting)', { name: a.name || a.set });
          }
          if (a.drawnBy === 'save') {
            return T('pl.loot-zones.live.on.save', '{name} (rectangle written into the save — visible when the server starts)', { name: a.name || a.set });
          }
          return a.name || a.set;
        }).join(', '),
      })));
    } else if (st.zonesKnown) {
      live.push(note('', T('pl.loot-zones.live.none', 'No loot zone is switched on.')));
    }

    // ⚠ THE MOST IMPORTANT SENTENCE ON THIS PAGE. The rectangle appears at once and the loot behind
    // it does not: SCUM reads its Loot folder when it STARTS, and a running server re-reads it only
    // through the reload command, which is sent only through bridge 2.22.2 or newer (through an
    // older bridge it crashed the game) — so where it was not sent, say when the loot really lands.
    if (st.lootPending === true) {
      // WHICH WAY the waiting change goes. After "Switch everything off" the files are GONE and the
      // zone's loot is what players still see, so the sentence for a switch-on is false in every
      // clause there — the backend has published which one it is all along.
      var goingOff = st.lootPendingKind === 'off';
      var reloadBtn = T('pl.loot-zones.act.reloadLoot', 'Reload loot now');
      var whenLands = st.nextRestartUnix
        ? T('pl.loot-zones.live.nextRestart', ' The next restart the manager has scheduled is {when}, and the loot lands then.',
          { when: whenPhrase(st.nextRestartUnix) })
        : T('pl.loot-zones.live.restartWhenever', ' Restart the server when it suits you and it lands then.');
      live.push(note('wait', (goingOff
        ? T('pl.loot-zones.live.pendingOff',
          'Zone loot stays until reload. Press "{button}" (Bridge 2.22.2+) or restart the server.', { button: reloadBtn })
        : T('pl.loot-zones.live.pendingOn',
          'Loot waits for a reload: press "{button}" (Bridge 2.22.2+) or restart. Rectangle already shown.', { button: reloadBtn }))
        + whenLands));
    } else if (st.lootPending === null && (st.active || []).length) {
      // Not knowing is its own answer. Saying "it is live" here would tell an owner their loot is
      // in when it may be waiting; saying "it is waiting" would send them to restart a server that
      // needs nothing.
      live.push(note('', T('pl.loot-zones.live.pendingUnknown',
        'Live status unknown. Switched on since the last start? It lands at the next restart.')));
    }
    /**
     * ⚠ **A SCHEDULE THAT WILL NEVER RUN LOOKED EXACTLY LIKE A SCHEDULE THAT WORKS.** Rotation ships
     * OFF, and every zone's days and hours draw, verdict and all, whether or not anything will ever
     * read them. That is one switch on a card further down the page, and it is the first thing to
     * check when the answer to "why does nothing happen" is "nothing is meant to".
     */
    if (c.enabled === false && c.rotation !== 'manual') {
      live.push(note('bad', c.rotation === 'time'
        ? T('pl.loot-zones.live.rotationOffTime', 'Rotation off: zone times ignored. Turn on "{control}" under "{card}". Manual switches work.', { control: labRotationOn(), card: cardRotation() })
        : T('pl.loot-zones.live.rotationOffRestart', 'Rotation off: no zone per restart. Turn on "{control}" under "{card}". Manual switches work.', { control: labRotationOn(), card: cardRotation() })));
    }
    if (st.nextSwitchInMs > 0) {
      live.push(note('', T('pl.loot-zones.live.held', 'Next switch waits {n} more minute(s): each switch resets containers across the whole map.',
      { n: Math.ceil(st.nextSwitchInMs / 60000) })));
    }
    root.appendChild(h('div', { class: 'lz-live' }, live));

    // ── what this configuration needs in the bridge ──────────────────────────────────────────────
    var br = state.bridge;
    if (br) {
      var off = br.items.filter(function (x) { return x.state === 'off'; });
      var canOn = off.filter(function (x) { return x.ownerMay; });
      var gone = br.items.filter(function (x) { return x.state === 'missing'; });
      /**
       * ⚠ **A BOSS IS DECIDED BY THE CLASS NAME, NOT BY THE KIND**, and this list is built from what
       * the configuration asks for — so a switch nothing in it names cannot appear in it at all. A
       * Razor or a Sentry added from the creature picker needs the BOSS switch and is refused without
       * it, which is the one refusal on this page whose fix was nowhere on this page.
       *
       * Said only while the list does not carry it already: once the switch is named there it comes
       * with its real state, which is more than this line can say, and two lines about one switch is
       * how a box like this stops being read.
       */
      var bossGap = allChosenGuards(c).some(looksLikeBoss)
        && !br.items.some(function (x) { return x.module === 'spawn' && x.key === 'bosses'; });
      var kidsB = [];
      if (!br.items.length && !bossGap) {
        kidsB.push(note('', T('pl.loot-zones.bridge.notNeeded', 'Nothing on this page needs the bridge yet.')));
      } else if (!off.length && !gone.length && !bossGap) {
        kidsB.push(note('good', T('pl.loot-zones.bridge.allOn', 'Everything this page uses is switched on in the bridge.')));
      } else {
        off.forEach(function (x) {
          // ⚠ `forWhat`, `moduleName` and `label` are the backend's and the bridge's own words and
          // travel as values. The ROUTE is not written here: it used to read "Settings, Bridge, SSA
          // Bridge card", and there is no Bridge under Settings — the cards live under Plugins.
          kidsB.push(h('div', { class: 'lz-need' }, [icon('alert'),
            h('span', {}, [h('b', {}, T('pl.loot-zones.bridge.forWhat', '{what}: ', { what: x.forWhat })),
              T('pl.loot-zones.bridge.need', '{module} → {label}{byHand}', {
                module: x.moduleName, label: x.label,
                byHand: x.manual ? T('pl.loot-zones.bridge.byHand',
                  ' (turn it on by hand in {where}, on that module\'s card, then restart the server)',
                  { where: bridgeWhere() }) : '',
              })])]));
        });
        gone.forEach(function (x) {
          kidsB.push(h('div', { class: 'lz-need' }, [icon('close'),
            h('span', {}, [h('b', {}, T('pl.loot-zones.bridge.forWhat', '{what}: ', { what: x.forWhat })),
              T('pl.loot-zones.bridge.missing', 'this bridge has no "{label}" — update the bridge', { label: x.label })])]));
        });
        if (canOn.length) {
          kidsB.push(h('div', { class: 'lz-actions' }, [
            h('button', { type: 'button', onclick: function () { turnOnInBridge(canOn); } },
              [icon('check'), canOn.length === 1
                ? T('pl.loot-zones.bridge.turnOnOne', 'Turn it on in the bridge')
                : T('pl.loot-zones.bridge.turnOnMany', 'Turn them on in the bridge')]),
          ]));
        }
        if (br.online === false) {
          kidsB.push(note('', T('pl.loot-zones.bridge.startsWith', 'The server is not running, so this is what the bridge will start with.')));
        }
      }
      if (bossGap) {
        kidsB.push(h('div', { class: 'lz-need' }, [icon('alert'),
          h('span', {}, [h('b', {}, T('pl.loot-zones.bridge.sendingGuards', 'Sending guards: ')),
            T('pl.loot-zones.bridge.bossGap',
              'One guard is a boss, so turn on Precise spawning → Bosses (Brenner, Razor, Dropship, Sentry).')])]));
      }
      root.appendChild(card('check-shield', cardBridge(), null, kidsB));
    }

    // The figures an owner opens this tab to see. They were in prose inside each zone, which is the
    // right place for the detail and the wrong place for the answer to "is this working at all".
    var held = 0; var postsAll = 0; var guardsUp = 0;
    Object.keys(st.patrols || {}).forEach(function (k) {
      var p = st.patrols[k] || {};
      held += Number(p.held) || 0;
      postsAll += Number(p.posts) || 0;
      guardsUp += Number(p.spawned) || 0;
    });
    var enabledZones = (c.zones || []).filter(function (z) { return z.enabled !== false; }).length;
    root.appendChild(h('div', { class: 'lz-figs' }, [
      h('div', { class: 'lz-fig' }, [h('b', {}, String((c.zones || []).length)), h('span', {}, T('pl.loot-zones.fig.zones', 'zones'))]),
      h('div', { class: 'lz-fig' }, [h('b', {}, String(enabledZones)), h('span', {}, T('pl.loot-zones.fig.inRotation', 'in rotation'))]),
      h('div', { class: 'lz-fig' + ((st.active || []).length ? ' good' : '') },
        [h('b', {}, String((st.active || []).length)), h('span', {}, T('pl.loot-zones.fig.liveNow', 'live now'))]),
      postsAll ? h('div', { class: 'lz-fig' + (held < postsAll ? ' wait' : ' good') },
        [h('b', {}, held + '/' + postsAll), h('span', {}, T('pl.loot-zones.fig.postsHeld', 'posts held'))]) : null,
      guardsUp ? h('div', { class: 'lz-fig' }, [h('b', {}, String(guardsUp)), h('span', {}, T('pl.loot-zones.fig.guardsSent', 'guards sent'))]) : null,
    ].filter(Boolean)));

    // ── the zones ────────────────────────────────────────────────────────────────────────────────
    // ⚠ THE INDEX PASSED IN IS THE ZONE'S PLACE IN `c.zones`, never its place in the filtered list:
    // the move arrows and the copy button splice that array, and handing them a filtered position
    // would move a different zone. The filter decides what is DRAWN and nothing else.
    var shownList = shownZones(c, st);
    var kids = [zoneToolbar(c, st)].concat(shownList.map(function (z) {
      return zoneBlock(z, (c.zones || []).indexOf(z), c, sets, st);
    }));
    if (!(c.zones || []).length) {
      kids.push(note('', sets.length
        ? T('pl.loot-zones.zones.none', 'No zones yet. Add one and pick a loot set for it.')
        : T('pl.loot-zones.zones.noSets', 'No loot sets. Add one folder per zone, each with a Zones.json from #ExportItemSpawnerPresetsInZone.')));
    }
    kids.push(h('div', { class: 'lz-actions' }, [
      h('button', {
        type: 'button', onclick: function () {
          var fresh = {
            id: 'z' + Date.now().toString(36), name: '', set: sets.length ? sets[0].name : '',
            enabled: true, windows: [],
          };
          c.zones = (c.zones || []).concat([fresh]);
          // ⚠ A ZONE ADDED WHILE A FILTER IS ON IS A ZONE THE READER CANNOT SEE, and the button then
          // reads as doing nothing. The filter is theirs, so it is cleared rather than fought with,
          // and the new zone is opened however long the list is.
          zoneFind = ''; zoneShow = 'all';
          shut['z-' + fresh.id] = false;
          markDirty();
        },
      }, [icon('box'), T('pl.loot-zones.zones.add', 'Add a zone')]),
    ]));
    // ⚠ **THE LEAD THAT USED TO BE HERE WAS ALSO ABOUT TO BECOME UNTRUE.** It said the rectangle
    // always comes from the loot set and is never copied here, which is right until a zone is given
    // an area of its own — and a card-wide sentence contradicting a control inside it is worse than
    // no sentence. Where the zone is now says so on the zone, in the row that decides it.
    root.appendChild(card('list', T('pl.loot-zones.card.zones', 'Zones'), null, kids));

    // ── what players are told ────────────────────────────────────────────────────────────────────
    root.appendChild(card('chat', T('pl.loot-zones.card.messages', 'What players are told'),
      T('pl.loot-zones.card.messages.lead', 'Four messages. Leave one empty to switch it off.'), [
      // ⚠ The VALUES are the game's own chat channels and are sent on the wire; only their captions
      // are translated.
      row(T('pl.loot-zones.set.chatChannel', 'Chat channel'), sel(c.chatChannel, [
        ['global', T('pl.loot-zones.chan.global', 'Global')], ['local', T('pl.loot-zones.chan.local', 'Local')],
        ['squad', T('pl.loot-zones.chan.squad', 'Squad')],
        ['admin', T('pl.loot-zones.chan.admin', 'Admin')], ['server', T('pl.loot-zones.chan.server', 'Server')],
      ], function (v) { c.chatChannel = v; markDirty(); }),
      T('pl.loot-zones.set.chatChannel.hint',
        'Channel for chat messages below. Server suits announcements; Local reaches only nearby players.')),
    ].concat(MESSAGES.map(function (d) { return messageBlock(d, c); }))));

    // ── the zone as players meet it ──────────────────────────────────────────────────────────────
    var own = c.zone.configMode === 'own';
    root.appendChild(card('map', cardRectangle(),
      T('pl.loot-zones.card.rectangle.lead', 'Name, colour and visibility. Shows at once; loot goes live on reload or next start.'), [
      // ⚠ The two placeholders here are VALUES — the prefix is written into the zone's name in the
      // game and the configuration name is what the zone set is found by — so neither is translated.
      row(T('pl.loot-zones.set.namePrefix', 'Zone name prefix'), txt(c.zone.namePrefix, 'Loot ', function (v) { c.zone.namePrefix = v; markDirty(); }),
        T('pl.loot-zones.set.namePrefix.hint',
          'Marks this plugin\'s zones: never empty, no colon. Switch all off before changing.')),
      row(labConfigMode(), sel(c.zone.configMode, [
        ['existing', T('pl.loot-zones.cfgmode.existing', 'Use one of my existing zone configurations')],
        ['own', T('pl.loot-zones.cfgmode.own', 'Keep a configuration of its own')],
      ], function (v) { c.zone.configMode = v; markDirty(); }),
      T('pl.loot-zones.set.configMode.hint',
        'Colour, visibility and entry notice belong to a configuration; this picks which one.')),
      !own ? row(T('pl.loot-zones.set.configIndex', 'Configuration number'), numIn(c.zone.configIndex, function (v) { c.zone.configIndex = v; markDirty(); }, 0, 99, ''),
        st.configs && st.configs.length
          ? T('pl.loot-zones.set.configIndex.list', 'This server has: {list}', {
            list: st.configs.map(function (x) {
              return T('pl.loot-zones.set.configIndex.entry', '{index} = {name}',
                { index: x.index, name: x.name || T('pl.loot-zones.set.configIndex.unnamed', '(unnamed)') });
            }).join(', '),
          })
          : T('pl.loot-zones.set.configIndex.hint', 'The list appears here once the game has sent its zones.')) : null,
      own ? row(T('pl.loot-zones.set.ownConfigName', 'Its name'), txt(c.zone.ownConfigName, 'Loot Zones', function (v) { c.zone.ownConfigName = v; markDirty(); }),
        T('pl.loot-zones.set.ownConfigName.hint',
          'Created once if missing, then always found by this name.')) : null,
      own ? row(T('pl.loot-zones.set.visibleOnMap', 'Players can see it on the map'), toggle(!!c.zone.visibleOnMap, function (v) { c.zone.visibleOnMap = v; markDirty(); })) : null,
      own ? row(T('pl.loot-zones.set.notifyOnEntry', 'Walking in tells them'), toggle(!!c.zone.notifyOnEntry, function (v) { c.zone.notifyOnEntry = v; markDirty(); }),
        T('pl.loot-zones.set.notifyOnEntry.hint', 'The game\'s own entry notification, which is separate from the messages below.')) : null,
      own ? row(T('pl.loot-zones.set.colour', 'Colour'), colourIn(c.zone.colour, function () { markDirty(); render(); }),
        T('pl.loot-zones.set.colour.hint', 'The colour players see the zone in on the map, and how see-through it is.')) : null,
    ]));

    // ── settings ─────────────────────────────────────────────────────────────────────────────────
    root.appendChild(card('sliders', cardRotation(),
      T('pl.loot-zones.card.rotation.lead', 'Which loot zone is live, and what may change it.'), [
      row(labRotationOn(), toggle(!!c.enabled, function (v) { c.enabled = v; markDirty(); }),
        T('pl.loot-zones.set.rotationOn.hint', 'Off keeps whatever is switched on; it does not remove a live zone.')),
      row(T('pl.loot-zones.set.rotation', 'How zones change'), sel(c.rotation, [
        ['manual', T('pl.loot-zones.rot.manual', 'Only by hand, from this page')],
        ['time', T('pl.loot-zones.rot.time', 'On a schedule, per zone')],
        ['restart', optRestart()],
      ], function (v) { c.rotation = v; markDirty(); }),
      c.rotation === 'time'
        ? T('pl.loot-zones.set.rotation.hint.time', 'Each zone below has its own days and hours; no schedule means always on.')
        : (c.rotation === 'restart'
          ? T('pl.loot-zones.set.rotation.hint.restart',
            'Zones take turns, one per server restart, chosen when the server stops.')
          : '')),
      c.rotation === 'time' && state.clock ? why('clock', [T('pl.loot-zones.set.managerClock',
        'Times use the manager\'s clock, now {t}{zone} — not the game\'s day cycle.', {
        t: state.clock.now.hhmm,
        zone: (state.clock.zone && state.clock.zone.label)
          ? T('pl.loot-zones.set.managerClock.zone', ' ({label})', { label: state.clock.zone.label }) : '',
      })]) : null,
      c.rotation === 'restart' ? row(T('pl.loot-zones.set.restartPick', 'Which one'), sel(c.restartPick, [
        ['order', T('pl.loot-zones.pick.order', 'In turn, down the list')],
        ['random', T('pl.loot-zones.pick.random', 'At random')],
      ], function (v) { c.restartPick = v; markDirty(); })) : null,
      more('rotation', T('pl.loot-zones.more.options', 'More options'), [
        row(T('pl.loot-zones.set.maxActive', 'Zones at once'), numIn(c.maxActive, function (v) { c.maxActive = v; markDirty(); }, 1, 10, T('pl.loot-zones.unit.zones', 'zones')),
          T('pl.loot-zones.set.maxActive.hint', 'The game allows several. Each one is another folder the game reads when it starts.')),
        row(T('pl.loot-zones.set.minBetween', 'Time between switches'), numIn(c.minMinutesBetweenSwitches, function (v) { c.minMinutesBetweenSwitches = v; markDirty(); }, 0, 1440, T('pl.loot-zones.unit.minutes', 'minutes')),
          T('pl.loot-zones.set.minBetween.hint',
            'Minimum time between loot swaps; switching off counts. Stops a crash loop cycling every zone.')),
        row(labReloadOnSwitch(), toggle(c.reloadOnSwitch !== false, function (v) { c.reloadOnSwitch = v; markDirty(); }),
          T('pl.loot-zones.set.reloadOnSwitch.hint', 'Loot goes live at once; resets every searchable container on the map. Needs Bridge 2.22.2+.')),
        row(T('pl.loot-zones.set.checkEvery', 'Check every'), numIn(c.checkEverySeconds, function (v) { c.checkEverySeconds = v; markDirty(); }, 15, 3600, T('pl.loot-zones.unit.seconds', 'seconds')),
          T('pl.loot-zones.set.checkEvery.hint', 'How often the schedule is checked and failed rectangles are retried.')),
        row(T('pl.loot-zones.set.setsDir', 'Loot sets folder'), txt(c.setsDir, (state.sets && state.sets.root) || '', function (v) { c.setsDir = v; markDirty(); }, 'lz-in lz-wide'),
          (state.sets && state.sets.root)
            ? T('pl.loot-zones.set.setsDir.hintPath', 'Leave it empty for the plugin\'s own folder: {path}', { path: state.sets.root })
            : T('pl.loot-zones.set.setsDir.hint', 'Leave it empty for the plugin\'s own folder.')),
      ]),
    ]));

    // ── everything else ──────────────────────────────────────────────────────────────────────────
    root.appendChild(card('cog', cardActions(),
      T('pl.loot-zones.card.actions.lead', 'Nothing here is a setting — each one does something to the server now.'), [
      h('div', { class: 'lz-actions' }, [
        h('button', {
          class: 'secondary', type: 'button', onclick: function () {
            SSA.confirm(T('pl.loot-zones.act.offConfirm', 'Switch every loot zone off and put the loot back to normal?')).then(function (yes) {
              if (!yes) return;
              api('/deactivate', { method: 'POST', body: { force: true } }).then(function (r) {
                SSA.toast(r && r.ok === false ? (r.why || T('pl.loot-zones.refused', 'Refused'))
                  : T('pl.loot-zones.act.offDone', 'Everything is off'));
                refresh();
              }).catch(failed(T('pl.loot-zones.fail.deactivate', 'Not switched off')));
            });
          },
        }, [icon('stop'), T('pl.loot-zones.act.off', 'Switch everything off')]),
        // Back since bridge 2.22.2, which runs the command on the game thread. An older bridge is
        // refused by the backend with a sentence, never sent the command that crashed it.
        h('button', {
          class: 'secondary', type: 'button', onclick: function () {
            SSA.confirm(T('pl.loot-zones.act.reloadConfirm', 'Reload loot now? Every searchable container on the whole map resets.')).then(function (yes) {
              if (!yes) return;
              api('/reload-loot', { method: 'POST', body: {} }).then(function (r) {
                SSA.toast(r && r.ok ? T('pl.loot-zones.act.reloadDone', 'Loot reloaded')
                  : ((r && r.why) || T('pl.loot-zones.act.reloadUnconfirmed', 'The reload was not confirmed')));
                refresh();
              }).catch(failed(T('pl.loot-zones.fail.reload', 'Not reloaded')));
            });
          },
        }, [icon('refresh'), T('pl.loot-zones.act.reloadLoot', 'Reload loot now')]),
        h('button', {
          class: 'secondary', type: 'button', onclick: function () {
            api('/reconcile', { method: 'POST', body: {} }).then(function (r) {
              if (r && r.skipped) SSA.toast(T('pl.loot-zones.act.noZoneList', 'The game has not sent its zone list yet'));
              else if (r && r.error) SSA.toast(T('pl.loot-zones.act.checkFailed', 'The check did not finish: {why}', { why: r.error }));
              // A leftover FOUND is not a leftover REMOVED. Counting what was found told an owner the
              // map was clean while the rectangle was still on it.
              else if (r && (r.stubborn || []).length) {
                SSA.toast(T('pl.loot-zones.act.stuck', '{n} leftover zone(s) could not be removed: {why}',
                  { n: r.stubborn.length, why: r.why || '' }));
              } else {
                var n = ((r && r.removed) || (r && r.strayZones) || []).length + ((r && r.strayFolders) || []).length;
                SSA.toast(n ? T('pl.loot-zones.act.cleared', 'Cleared {n} leftover(s)', { n: n })
                  : T('pl.loot-zones.act.agrees', 'The game agrees with this page'));
              }
              refresh();
            }).catch(failed(T('pl.loot-zones.fail.check', 'Not checked')));
          },
        }, [icon('check-shield'), labReconcile()]),
      ]),
      // The spawn plans held right now, the refusals, and the button that gives them back. Here
      // rather than inside a zone because a plan is the island's and not one zone's.
      activityHeldBlock(),
      why('actions', [T('pl.loot-zones.act.note',
        'Bridge 2.22.2+ reloads loot on switch (see "{control}"); older bridges at next start.',
        { control: labReloadOnSwitch() })]),
    ]));

    saveBar = saveBarNode();
    root.appendChild(saveBar);
  }

  /**
   * The bar that says whether anything on this page has reached the server, and the one way back.
   *
   * Its own function because `dirtyOnly()` swaps it in place — a change made from inside a control
   * the owner is still typing in must not redraw the page under them.
   */
  function saveBarNode() {
    return h('div', { class: 'lz-save' }, [
      h('button', { class: unsaved ? '' : 'secondary', type: 'button', onclick: save }, labSave()),
      unsaved ? h('button', {
        class: 'secondary', type: 'button', onclick: discard,
        title: T('pl.loot-zones.discard.title', 'Put every zone, message and guard back to the settings the server is holding'),
      }, [icon('refresh'), labDiscard()]) : null,
      h('span', {
        class: 'lz-dirty' + (unsaved ? ' unsaved' : ''),
        title: unsaved
          ? T('pl.loot-zones.dirty.title',
            'Not sent to the server yet. Live figures are paused until you save.')
          : T('pl.loot-zones.clean.title', 'Everything on this page is what the server is holding'),
      }, [icon(unsaved ? 'alert' : 'check'),
        unsaved ? T('pl.loot-zones.dirty', 'Unsaved — nothing here is on the server yet')
          : T('pl.loot-zones.clean', 'Everything is saved')]),
    ]);
  }

  // ⚠ The option names are the SDK's, and getting one wrong is SILENT. `registerTab` reads
  // `opts.render` and falls back to an empty function, so a tab passing `mount` registers, appears
  // in the nav, opens, and draws nothing at all — which is exactly what it looks like when a plugin
  // failed to load, and sends whoever is looking at the backend instead. `label` and an icon with
  // its `#i-` prefix are read the same way, each with a quiet fallback of its own.
  //
  // `render(container)` is called EVERY time the tab is opened, and the container is emptied first,
  // so everything that has to survive being reopened is re-armed here.
  SSA.ready(function () {
    /**
     * ⚠ **THE TAB PILL CARRIES THE SAME WORDS IN EVERY LANGUAGE, AND THAT IS A DECISION RATHER
     * THAN AN OVERSIGHT.** The manifest field that names this plugin — what the installed-plugins
     * list, the install dialog and the site all show — has no translation anywhere, so a
     * translated pill above an untranslated card makes an owner work out that the two are one
     * plugin. Three languages had translated it and fifteen had not, which is the worst of both.
     * The key stays, so the decision can be reversed in one place if the manifest ever gains a
     * translation of its own.
     *
     * ⚠ **AND THE COMMENT LIVES OUT HERE RATHER THAN INSIDE THE CALL.** `check-plugins` reads the
     * options handed to `registerTab` with a brace-and-quote scanner that has no comment phase, so
     * one apostrophe in a note between two keys opens a string literal that swallows the rest of
     * the object — and the run then reports this tab as having no `render` at all, which is a
     * finding about correct code. Same family as every other scanner in this tree that loses its
     * string phase; keep prose about these options above them.
     */
    SSA.registerTab({
      id: 'loot-zones',
      label: T('pl.loot-zones.tab', 'Loot Zones'),
      icon: '#i-box',
      premium: true,
      render: function (container) {
        root = container;
        root.classList.add('lz');
        refresh();
        // One timer across opens, or reopening the tab stacks them.
        if (poll) clearInterval(poll);
        poll = setInterval(function () {
          // `quiet`: a poll must not redraw over somebody who is halfway through typing. A refresh
          // the OWNER asked for still redraws, because they are not typing when they press a button.
          if (root && document.body.contains(root)) refresh({ quiet: true });
          else { clearInterval(poll); poll = null; }
        }, 15000);
      },
    });
  });
})();
