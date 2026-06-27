'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  async function getJSON(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (id) => `<svg class="ico"><use href="#${id}"/></svg>`;
  // Leaderboard category key → icon (for the Overview category leaders).
  // Covers EVERY leaderboard category key (see database/leaderboardDefs.js) so none
  // falls back. Same concept uses the same icon as the My Stats grids below.
  const CATEGORY_ICONS = {
    kills: 'i-skull', deaths: 'i-grave', pvp_kills: 'i-gun', pvp_deaths: 'i-grave',
    playtime: 'i-hourglass', fame: 'i-star', money: 'i-coins', events: 'i-trophy',
    kdr: 'i-scale', headshots: 'i-crosshair', team_kills: 'i-team', animal_kills: 'i-paw',
    puppet_kills: 'i-zombie', drone_kills: 'i-drone', sentry_kills: 'i-turret',
    locks_picked: 'i-lock', guns_crafted: 'i-gun', bullets_crafted: 'i-bullet',
    melee_crafted: 'i-anvil', clothing_crafted: 'i-shirt', fish_caught: 'i-fish',
    squad_score: 'i-shield', squad_members: 'i-users',
    distance: 'i-foot', sniper: 'i-scope', melee_warriors: 'i-knife', archers: 'i-bow',
    survivors: 'i-clock', medics: 'i-bandage', looters: 'i-box', all_crafters: 'i-anvil',
  };
  const catIcon = (key) => CATEGORY_ICONS[key] || 'i-trophy';
  const num = (v) => (typeof v === 'number' ? Math.round(v).toLocaleString() : (v == null ? '0' : v));

  // Prisoner skills: DB level 0-4 maps to a tier; experience is in-level progress and
  // the XP needed to reach the next level is 10^(level+4) (10k → 100k → 1M → 10M).
  const SKILL_TIERS = ['No Skill', 'Basic', 'Medium', 'Advanced', 'Advanced+'];
  // Skills grouped under their SCUM attribute (base name = DB name minus "Skill").
  const SKILL_GROUPS = [
    ['Strength', 'i-strength', ['Boxing', 'MeleeWeapons', 'Archery', 'Rifles', 'Handgun']],
    ['Constitution', 'i-heart', ['Running', 'Endurance', 'Resistance']],
    ['Dexterity', 'i-bolt', ['Thievery', 'Demolition', 'Motorcycle', 'Driving', 'Stealth', 'Aviation']],
    ['Intelligence', 'i-bulb', ['Awareness', 'Camouflage', 'Engineering', 'Sniping', 'Survival', 'Medical', 'Tactics', 'Cooking', 'Farming']],
  ];
  const skillLabel = (n) => String(n).replace(/Skill$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  const skillLevel = (sk) => Math.max(0, Math.min(4, sk.Level | 0));
  function skillRow(sk) {
    const lvl = skillLevel(sk);
    const threshold = lvl >= 4 ? 0 : Math.pow(10, lvl + 4);
    const pct = threshold ? Math.max(0, Math.min(100, (sk.Xp / threshold) * 100)) : 100;
    return `<div class="skill-row sk-l${lvl}"><span class="sk-name">${esc(skillLabel(sk.Name))}</span><span class="sk-tier">${esc(SKILL_TIERS[lvl])}</span><span class="sk-bar"><span class="sk-fill" style="width:${pct.toFixed(0)}%"></span></span></div>`;
  }
  // Attribute ring (value out of 5) with the number in the middle.
  function attrRing(value) {
    const r = 24, c = 2 * Math.PI * r;
    const pct = value == null ? 0 : Math.max(0, Math.min(1, value / 5));
    const off = c * (1 - pct);
    return `<svg class="attr-ring" viewBox="0 0 56 56" aria-hidden="true">`
      + `<circle class="ar-bg" cx="28" cy="28" r="${r}"/>`
      + `<circle class="ar-fg" cx="28" cy="28" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>`
      + `<text class="ar-num" x="28" y="28">${value == null ? '–' : value}</text></svg>`;
  }
  function skillsHtml(data) {
    const list = (data && data.list) || [];
    const attrs = (data && data.attributes) || {};
    if (!list.length) return '<p class="muted small">No skill data.</p>';
    const byBase = {};
    list.forEach((sk) => { byBase[String(sk.Name).replace(/Skill$/, '')] = sk; });
    const used = new Set();
    const group = (title, ico, bases) => {
      const items = bases.map((b) => byBase[b]).filter(Boolean);
      if (!items.length) return '';
      items.forEach((sk) => used.add(String(sk.Name).replace(/Skill$/, '')));
      const val = attrs[title.toLowerCase()];
      return `<div class="skill-group"><div class="sg-head">${attrRing(val == null ? null : val)}<div class="sg-titlewrap">${icon(ico)}<span class="sg-title">${title}</span></div></div>${items.map(skillRow).join('')}</div>`;
    };
    let html = SKILL_GROUPS.map(([t, ic, b]) => group(t, ic, b)).join('');
    const rest = list.filter((sk) => !used.has(String(sk.Name).replace(/Skill$/, '')));
    if (rest.length) html += `<div class="skill-group"><div class="sg-head"><div class="sg-titlewrap">${icon('i-star')}<span class="sg-title">Other</span></div></div>${rest.map(skillRow).join('')}</div>`;
    return html;
  }

  function fmtStat(v, kind) {
    const n = Number(v) || 0;
    if (kind === 'meters') return `${Math.round(n)} m`;
    if (kind === 'km') return `${(n / 1000).toFixed(1)} km`;
    if (kind === 'hmin') return `${Math.round(n / 60).toLocaleString()} h`;
    if (kind === 'hsec') return `${Math.round(n / 3600).toLocaleString()} h`;
    if (kind === 'raw') return v;
    return num(n);
  }
  function dur(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    if (h >= 24) { const d = Math.floor(h / 24); return `${d}d ${h % 24}h`; }
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
  function ago(ms) {
    const s = Math.floor((Date.now() - ms) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
  }

  let currentPlayerName = null;
  let isPlayer = false; // logged in via Discord AND linked to a SCUM character
  let isLoggedIn = false; // logged in via Discord (linked or not)

  // ── Tab navigation ───────────────────────────────────────────────────────
  const loaders = {};
  const loaded = {};
  // Only Overview is public; everything else needs a Discord login.
  const GATED = ['leaderboards', 'squads', 'mystats', 'bunkers', 'economy', 'killfeed', 'events'];
  let disabledTabs = new Set(); // tabs hidden by the admin (web.fieldConsole.tabs)
  let currentView = 'overview';
  function switchView(name) {
    if (!document.getElementById(`view-${name}`) || disabledTabs.has(name)) name = 'overview';
    currentView = name;
    const gated = GATED.includes(name) && !isLoggedIn;
    document.querySelectorAll('.view').forEach((v) => { v.hidden = true; });
    $('login-gate').hidden = true;
    if (gated) {
      $('login-gate').hidden = false;
    } else {
      $(`view-${name}`).hidden = false;
      if (loaders[name] && !loaded[name]) { loaded[name] = true; loaders[name](); }
    }
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
    window.scrollTo({ top: 0 });
  }

  // ── Overview ─────────────────────────────────────────────────────────────
  async function loadOverview() {
    let o;
    try { o = await getJSON('/api/public/overview'); }
    catch { $('status-text').textContent = 'UNREACHABLE'; $('status-updated').textContent = 'console offline'; return; }
    const st = o.status || {};
    const ro = $('readout');
    ro.classList.toggle('online', !!st.online);
    ro.classList.toggle('offline', !st.online);
    const max = st.maxPlayers || '—';
    $('status-players').textContent = `${st.online ? (st.players || 0) : 0} / ${max}`;
    $('status-text').textContent = st.online ? 'OPERATIONAL' : 'OFFLINE';
    $('status-updated').textContent = st.online ? `updated ${new Date().toLocaleTimeString()}` : 'server is down';
    const c = o.counts || {}; const w = o.world || {};
    $('tm-players').textContent = c.players != null ? c.players : (st.players || 0);
    $('tm-squads').textContent = c.squads != null ? c.squads : '—';
    $('tm-time').textContent = w.time || '—';
    $('tm-temp').textContent = w.temperature ? w.temperature.replace(/A:\s*/, '').replace(/\s*\|\s*W:\s*/, ' / ') : '—';

    // Online players (admin-toggleable; names are clickable for logged-in players)
    const card = $('online-players-card');
    if (o.onlinePlayers) {
      card.hidden = false;
      const list = o.onlinePlayers;
      $('online-count').textContent = `· ${list.length}`;
      $('online-players').innerHTML = list.length
        ? list.map((n) => `<span class="op-chip pl-click" data-player="${esc(n)}">${esc(n)}</span>`).join('')
        : '<span class="muted small">No one online right now.</span>';
    } else {
      card.hidden = true;
    }

    // Next restart
    if (o.nextRestart) {
      const ms = new Date(o.nextRestart).getTime();
      const diff = ms - Date.now();
      $('ov-restart-rel').textContent = diff > 0 ? `in ${dur(diff / 1000)}` : 'imminent';
      $('ov-restart-abs').textContent = new Date(ms).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    } else { $('ov-restart-rel').textContent = 'Not scheduled'; $('ov-restart-abs').textContent = ''; }

    // Server info
    const srv = o.server || {};
    $('srv-name').textContent = srv.name || 'SCUM Server';
    $('srv-ip').textContent = srv.address || 'n/a';
    $('srv-fps').textContent = (st.fps != null) ? `${st.fps} FPS` : '—';
    $('srv-state').textContent = st.online ? (st.state || 'Online') : 'Offline';

    // Top squads — clickable (when logged in) to open the squad detail.
    const squads = o.topSquads || [];
    $('ov-squads').innerHTML = squads.length
      ? squads.map((sq) => `<li class="ov-squad-row${sq.id ? ' sq-click' : ''}"${sq.id ? ` data-squad-id="${sq.id}"` : ''}><span class="sq-name">${esc(sq.name)}</span><span class="sq-val">${esc(num(sq.value))}</span></li>`).join('')
      : '<li class="muted small">No squads yet.</li>';

    // Category leaders (#1 of each leaderboard category) — names open the profile.
    const leaders = o.categoryLeaders || [];
    $('cat-leaders').innerHTML = leaders.length
      ? leaders.map((c) => `<li class="cl-row cat-click" data-cat="${esc(c.key)}">${icon(catIcon(c.key))}<div class="cl-body"><span class="cl-cat">${esc(c.label)}</span><div class="cl-line"><span class="cl-name pl-click" data-player="${esc(c.name)}">${esc(c.name)}</span><span class="cl-val">${esc(num(c.value))}</span></div></div></li>`).join('')
      : '<li class="muted small">No leaderboard data yet.</li>';
  }

  // ── Leaderboards ─────────────────────────────────────────────────────────
  let lbCache = null, lbRows = [];
  let pendingLbCategory = null; // category to auto-select after the next load
  async function loadLeaderboards(weekly) {
    const list = $('lb-list');
    list.innerHTML = '<li class="lb-empty">Loading…</li>';
    try {
      const data = await getJSON(`/api/public/leaderboards?weekly=${weekly || 0}&limit=100`);
      lbCache = data;
      if (!$('lb-category').options.length) {
        $('lb-category').innerHTML = (data.categories || []).map((c) => `<option value="${c.key}">${esc(c.label)}</option>`).join('');
      }
      if (pendingLbCategory && [...$('lb-category').options].some((o) => o.value === pendingLbCategory)) {
        $('lb-category').value = pendingLbCategory; pendingLbCategory = null;
      }
      buildRows();
      if (data.generatedAt) $('lb-updated').textContent = `SNAPSHOT // ${new Date(data.generatedAt).toLocaleTimeString()}`;
      if (!data.available) list.innerHTML = '<li class="lb-empty">Leaderboards aren\'t available yet.</li>';
    } catch { list.innerHTML = '<li class="lb-empty">Couldn\'t load leaderboards.</li>'; }
  }
  function buildRows() {
    const entry = lbCache && lbCache.leaderboards && lbCache.leaderboards[$('lb-category').value];
    lbRows = ((entry && entry.data) || []).map((r, i) => ({ rank: i + 1, name: r.Name, val: r.FormattedValue != null ? r.FormattedValue : r.Value }));
    renderLeaderboard();
  }
  function renderLeaderboard() {
    const list = $('lb-list');
    const term = $('lb-search').value.trim().toLowerCase();
    const rows = term ? lbRows.filter((r) => String(r.name).toLowerCase().includes(term)) : lbRows;
    if (!rows.length) { list.innerHTML = `<li class="lb-empty">${term ? 'No player matches that filter.' : 'No data.'}</li>`; return; }
    list.innerHTML = rows.map((r) => {
      const cls = ['lb-row', 'lb-click'];
      if (r.rank <= 3) cls.push('top', `r${r.rank}`);
      if (currentPlayerName && r.name === currentPlayerName) cls.push('me');
      return `<li class="${cls.join(' ')}" data-name="${esc(r.name)}"><span class="lb-rank">${r.rank}</span><span class="lb-name">${esc(r.name)}</span><span class="lb-val">${esc(num(r.val))}</span></li>`;
    }).join('');
  }

  // Jump to the Leaderboards tab with a specific category selected (from the
  // Overview category leaders or the My Stats rankings).
  function openLeaderboardCategory(key) {
    if (!isLoggedIn) { switchView('leaderboards'); return; } // gate is shown
    const sel = $('lb-category');
    if (loaded.leaderboards && lbCache && [...sel.options].some((o) => o.value === key)) {
      sel.value = key; pendingLbCategory = null; switchView('leaderboards'); buildRows();
    } else {
      // Not loaded yet: remember the target first, then switchView triggers the
      // load (loadLeaderboards applies pendingLbCategory once the options exist).
      pendingLbCategory = key;
      switchView('leaderboards');
    }
  }

  // ── My Stats (dossier) ───────────────────────────────────────────────────
  const show = (id, on) => { const el = $(id); if (el) el.hidden = !on; };
  // Kept in sync with the Discord /player-stats embed (slashCommands.js).
  const COMBAT = [
    ['Kills', 'Kills', 'i-skull', 'int'], ['Deaths', 'Deaths', 'i-grave', 'int'], ['__kd', 'K/D', 'i-scale', 'raw'],
    ['PvpKills', 'PvP kills', 'i-gun', 'int'], ['PvpDeaths', 'PvP deaths', 'i-grave', 'int'], ['Headshots', 'Headshots', 'i-crosshair', 'int'],
    ['ZombieKills', 'Puppet kills', 'i-zombie', 'int'], ['AnimalKills', 'Animal kills', 'i-paw', 'int'], ['LongestKill', 'Longest kill', 'i-scope', 'meters'],
    ['FirearmKills', 'Firearm kills', 'i-gun', 'int'], ['MeleeKills', 'Melee kills', 'i-knife', 'int'], ['ArcheryKills', 'Archery kills', 'i-bow', 'int'],
  ];
  const SURVIVAL = [
    ['MinutesSurvived', 'Survived', 'i-clock', 'hmin'], ['Distance', 'On foot', 'i-foot', 'km'], ['Looted', 'Looted', 'i-box', 'int'],
    ['LocksPicked', 'Locks picked', 'i-lock', 'int'], ['Crafted', 'Crafted', 'i-anvil', 'int'], ['FishCaught', 'Fish caught', 'i-fish', 'int'],
    ['FamePoints', 'Fame', 'i-star', 'int'], ['Money', 'Money', 'i-coins', 'int'], ['PlayTime', 'Playtime', 'i-hourglass', 'hsec'],
  ];
  function statGridHtml(fields, s) {
    return fields.map(([k, label, ic, kind]) =>
      `<div class="ds">${icon(ic)}<div class="ds-txt"><span class="ds-v">${esc(fmtStat(s[k] != null ? s[k] : 0, kind))}</span><span class="ds-k">${label}</span></div></div>`).join('');
  }

  // Bank / finances for My Stats (own data only): money cards + the bank cards
  // themselves (image, limits, click-to-reveal PIN). Reuses the .ds stat-card look.
  function bankCardHtml(c) {
    const img = c.image ? `<img class="bank-card-img" src="${esc(c.image)}" alt="" loading="lazy" onerror="this.remove()">` : '';
    const amt = (v) => (Number(v) < 0 ? '∞' : `${num(v)} $`); // -1 = unlimited
    const cnt = (v) => (Number(v) < 0 ? '∞' : num(v));
    const rows = [];
    if (c.withdrawLeft != null) rows.push(`<span>Daily withdraw left <b>${amt(c.withdrawLeft)}</b></span>`);
    if (c.depositLeft != null) rows.push(`<span>Daily deposit left <b>${amt(c.depositLeft)}</b></span>`);
    if (c.renewals != null) rows.push(`<span>Free renewals <b>${cnt(c.renewals)}</b></span>`);
    if (c.pinTries != null) rows.push(`<span>PIN tries left <b>${cnt(c.pinTries)}</b></span>`);
    if (c.pin != null && Number(c.pin) >= 0) rows.push(`<span>PIN <button class="pin-btn" data-pin="${esc(String(c.pin))}">•••• <em>reveal</em></button></span>`);
    return `<div class="bank-card">${img}<div class="bank-card-body"><span class="bank-card-type">${esc(c.type)} card</span><div class="bank-card-rows">${rows.join('')}</div></div></div>`;
  }
  function financesHtml(f) {
    if (!f) return '<p class="muted small">No bank account.</p>';
    const card = (ic, label, val) => `<div class="ds">${icon(ic)}<div class="ds-txt"><span class="ds-v">${esc(val)}</span><span class="ds-k">${esc(label)}</span></div></div>`;
    const stats = [card('i-coins', 'Bank balance', `${num(f.bank)} $`), card('i-coins', 'Gold', `${num(f.gold)}`)];
    if (f.cash != null) stats.push(card('i-coins', 'Cash', `${num(f.cash)} $`));
    let html = `<div class="dstats">${stats.join('')}</div>`;
    if (f.accountNumber) html += `<div class="fin-acc">${icon('i-list')}<div class="fin-acc-t"><span class="fin-acc-k">Account number</span><span class="fin-acc-v">${esc(String(f.accountNumber))}</span></div></div>`;
    if ((f.cards || []).length) html += `<div class="bank-cards">${f.cards.map(bankCardHtml).join('')}</div>`;
    return html;
  }
  function statGrid(elId, fields, s) { $(elId).innerHTML = statGridHtml(fields, s); }

  // All rankings, with the category icon, clickable → opens that leaderboard category.
  function ranksHtml(ranks) {
    if (!ranks || !ranks.length) return '<li class="muted small">No leaderboard placements yet.</li>';
    return ranks.map((r) => {
      const pc = r.rank === 1 ? 'g' : r.rank === 2 ? 's' : r.rank === 3 ? 'b' : '';
      return `<li class="rank-chip cat-click" data-cat="${esc(r.key)}">${icon(catIcon(r.key))}<span class="rank-pos ${pc}">#${r.rank}</span><span class="rank-label">${esc(r.label)}</span><span class="rank-val">${esc(num(r.value))}</span></li>`;
    }).join('');
  }

  // ── Modal (player profile / squad detail) ────────────────────────────────
  function openModal(html) { $('modal-body').innerHTML = html; $('modal').hidden = false; }
  function closeModal() { $('modal').hidden = true; }

  function kd(s) { return Number(s.Deaths) > 0 ? (s.Kills / s.Deaths).toFixed(2) : String(Math.trunc(Number(s.Kills) || 0)); }

  async function openPlayerProfile(name) {
    if (!isPlayer) {
      openModal(isLoggedIn
        ? '<p class="muted">Link your SCUM character on the <strong>My Stats</strong> tab to view player profiles.</p>'
        : '<p class="muted">Log in with Discord to view player profiles.</p>');
      return;
    }
    openModal('<p class="muted">Loading…</p>');
    try {
      const d = await getJSON(`/api/player/profile/${encodeURIComponent(name)}`);
      const s = d.stats || {};
      s.__kd = kd(s);
      let squadHtml = '<p class="muted small">Not in a squad.</p>';
      if (d.squad) {
        squadHtml = `<div class="squad-head"><span class="squad-name">${esc(d.squad.name)}</span><span class="squad-meta">${d.squad.memberCount} members · ${num(d.squad.score)} score</span></div>`
          + `<ul class="squad-members">${(d.squad.members || []).map((m) => `<li class="sm-row"><span class="sm-name pl-click" data-player="${esc(m.name)}">${esc(m.name)}</span><span class="sm-rank">${esc(m.rank)}</span></li>`).join('')}</ul>`;
      }
      // Skills are only returned for a squadmate of the viewed player.
      const skillsBlock = (d.skills && (d.skills.list || []).length)
        ? `<h3>${icon('i-star')} Skills</h3><div class="skills">${skillsHtml(d.skills)}</div>`
        : '';
      openModal(
        `<div class="record"><div class="record-id"><span class="record-label">Inmate</span><span class="record-name">${esc(d.name)}</span></div></div>`
        + skillsBlock
        + `<div class="ms-grid"><div><h3>${icon('i-crosshair')} Combat</h3><div class="dstats">${statGridHtml(COMBAT, s)}</div></div>`
        + `<div><h3>${icon('i-foot')} Survival</h3><div class="dstats">${statGridHtml(SURVIVAL, s)}</div></div></div>`
        + `<h3>${icon('i-trophy')} Rankings</h3><ul class="ranks">${ranksHtml(d.ranks)}</ul>`
        + `<h3>${icon('i-shield')} Squad</h3><div class="squad-block">${squadHtml}</div>`,
      );
    } catch { openModal('<p class="muted">Could not load that player.</p>'); }
  }

  async function openSquadDetail(id) {
    openModal('<p class="muted">Loading…</p>');
    try {
      const { squad } = await getJSON(`/api/public/squads/${encodeURIComponent(id)}`);
      if (!squad) { openModal('<p class="muted">Squad not found.</p>'); return; }
      openModal(
        `<div class="record"><div class="record-id"><span class="record-label">Squad</span><span class="record-name">${esc(squad.name)}</span><span class="record-meta">${squad.memberCount} members · ${num(squad.score)} score</span></div></div>`
        + `<h3>${icon('i-users')} Members</h3>`
        + `<ul class="squad-members">${(squad.members || []).map((m) => `<li class="sm-row"><span class="sm-name pl-click" data-player="${esc(m.name)}">${esc(m.name)}</span><span class="sm-rank">${esc(m.rank)}</span></li>`).join('')}</ul>`,
      );
    } catch { openModal('<p class="muted">Could not load that squad.</p>'); }
  }

  async function loadSquads() {
    const list = $('squad-list');
    list.innerHTML = '<li class="muted">Loading…</li>';
    try {
      const data = await getJSON('/api/public/squads');
      const squads = data.squads || [];
      if (!data.available) { list.innerHTML = '<li class="muted">Squads aren\'t available yet.</li>'; return; }
      list.innerHTML = squads.length
        ? squads.map((sq, i) => `<li class="squad-row" data-id="${sq.id}"><span class="sq-rank">${i + 1}</span><span class="sq-list-name">${esc(sq.name)}</span><span class="sq-list-meta">${sq.memberCount} members</span><span class="sq-list-score">${num(sq.score)}</span></li>`).join('')
        : '<li class="muted">No squads yet.</li>';
    } catch { list.innerHTML = '<li class="muted">Couldn\'t load squads.</li>'; }
  }

  async function loadMyStats() {
    let sess;
    try { sess = await getJSON('/api/auth/discord/session'); } catch { return; }
    if (!sess.configured) { $('login-btn').setAttribute('hidden', ''); show('oauth-disabled', true); }
    const p = sess.player;
    if (!sess.authenticated || !p) { show('me-loggedout', true); show('me-unlinked', false); show('me-linked', false); return; }
    if (!p.linked) {
      $('me-discord-unlinked').textContent = p.discordUsername || 'Discord user';
      show('me-loggedout', false); show('me-unlinked', true); show('me-linked', false); return;
    }
    show('me-loggedout', false); show('me-unlinked', false); show('me-linked', true);
    renderDossier(await getJSON('/api/player/me/overview').catch(() => null), p);
  }

  function renderDossier(data, sess) {
    const id = (data && data.identity) || {};
    currentPlayerName = id.playerName || sess.playerName || null;
    $('me-name').textContent = currentPlayerName || '(unknown)';
    const squad = data && data.stats && data.stats.SquadName;
    $('me-meta').textContent = `@${id.discordUsername || sess.discordUsername}${squad ? ` · [${squad}]` : ''}`;

    const s = data && data.stats;
    if (s) {
      s.__kd = (Number(s.Deaths) > 0) ? (s.Kills / s.Deaths).toFixed(2) : String(Math.trunc(Number(s.Kills) || 0));
      statGrid('stats-combat', COMBAT, s);
      statGrid('stats-survival', SURVIVAL, s);
    } else {
      $('stats-combat').innerHTML = '<div class="muted small" style="grid-column:1/-1">No character record yet.</div>';
      $('stats-survival').innerHTML = '';
    }

    const ranks = (data && data.ranks) || [];
    $('me-ranks').innerHTML = ranks.length ? ranksHtml(ranks) : '<li class="muted small">Not in any leaderboard top 100 yet.</li>';

    $('me-skills').innerHTML = skillsHtml((data && data.skills) || {});
    $('me-finances').innerHTML = financesHtml(data && data.finances);

    renderSquad(data && data.squad);

    if (data && data.notifications) {
      const f = $('notif-form');
      ['raid', 'vehicle', 'chest', 'lock'].forEach((k) => { f.elements[k].checked = !!data.notifications[k]; });
      f.elements.scope.value = data.notifications.scope === 'squad' ? 'squad' : 'own';
    }
    renderLeaderboard();
  }

  function agoDate(s) {
    if (!s) return '';
    s = String(s);
    // SQLite CURRENT_TIMESTAMP is UTC "YYYY-MM-DD HH:MM:SS" — JS would parse that
    // space form as LOCAL time, so anchor it to UTC. ISO strings (with T/Z) parse as-is.
    const iso = (s.includes(' ') && !s.includes('T')) ? `${s.replace(' ', 'T')}Z` : s;
    let t = new Date(iso).getTime();
    if (Number.isNaN(t)) t = new Date(s).getTime();
    return Number.isNaN(t) ? '' : ago(t);
  }

  // Discord-formatted notification text → readable web text: drop :emoji: shortcodes
  // and **bold** markers, and turn <t:UNIX:x> tokens into local dates / relatives.
  function relFromNow(ms) {
    const diff = ms - Date.now(); const a = Math.abs(diff); const s = Math.floor(a / 1000);
    const str = s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
    return diff >= 0 ? `in ${str}` : `${str} ago`;
  }
  const NOTIF_EMOJI = {
    shield: '🛡️', hourglass: '⌛', hourglass_flowing_sand: '⏳', door: '🚪',
    package: '📦', red_car: '🚗', rotating_light: '🚨', lock: '🔒', closed_lock_with_key: '🔐',
  };
  function cleanNotifText(s) {
    if (!s) return '';
    return String(s)
      .replace(/<t:(\d+):R>/g, (m, ts) => relFromNow(Number(ts) * 1000))
      .replace(/<t:(\d+):[a-zA-Z]>/g, (m, ts) => new Date(Number(ts) * 1000).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }))
      .replace(/:([a-z0-9_+]+):/g, (m, code) => NOTIF_EMOJI[code] || '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function renderSquad(sq) {
    const el = $('me-squad');
    if (!sq) { el.innerHTML = '<p class="muted small">Not in a squad.</p>'; return; }
    const head = `<div class="squad-head"><span class="squad-name">${esc(sq.name)}</span><span class="squad-meta">${sq.memberCount} members · ${num(sq.score)} score</span></div>`;
    const rows = (sq.members || []).map((m) => `<li class="sm-row">`
      + `<span class="sm-dot ${m.online ? 'on' : 'off'}"></span>`
      + `<span class="sm-name pl-click" data-player="${esc(m.name)}">${esc(m.name)}</span>`
      + `<span class="sm-rank">${esc(m.rank)}</span>`
      + `<span class="sm-seen">${m.online ? 'online' : (m.lastSeen ? `last seen ${agoDate(m.lastSeen)}` : '—')}</span>`
      + `</li>`).join('');
    el.innerHTML = head + `<ul class="squad-members">${rows}</ul>`;
  }

  async function loadNotifHistory() {
    const el = $('notif-history');
    try {
      const { history } = await getJSON('/api/player/me/notifications/history');
      el.innerHTML = (history && history.length)
        ? history.map((h) => `<li class="nh-row"><div class="nh-main"><span class="nh-title">${esc(cleanNotifText(h.title) || 'Alert')}</span><span class="nh-body">${esc(cleanNotifText(h.body))}</span></div><span class="nh-time">${agoDate(h.sentAt)}</span></li>`).join('')
        : '<li class="muted small">No notifications sent yet.</li>';
    } catch { el.innerHTML = '<li class="muted small">Could not load history.</li>'; }
  }

  // player chip in header (independent of which tab is open)
  async function loadSession() {
    let sess;
    try { sess = await getJSON('/api/auth/discord/session'); } catch { return; }
    isPlayer = !!(sess.authenticated && sess.player && sess.player.linked);
    isLoggedIn = !!sess.authenticated;
    // Reflect the now-known auth state on the gate (login disabled when OAuth is off).
    if (!sess.configured) { const gb = $('gate-login'); if (gb) gb.setAttribute('hidden', ''); show('gate-oauth-disabled', true); }
    switchView(currentView); // re-evaluate the gate for whatever tab is open
    const chip = $('player-chip');
    if (sess.authenticated && sess.player) {
      const name = sess.player.linked ? sess.player.playerName : sess.player.discordUsername;
      if (sess.player.linked) currentPlayerName = sess.player.playerName;
      chip.dataset.action = 'mystats';
      chip.href = '#mystats';
      chip.innerHTML = `${icon('i-user')}<span>${esc(name || 'Me')}</span>`;
      chip.hidden = false;
    } else if (sess.configured) {
      chip.dataset.action = 'login';
      chip.href = '/api/auth/discord';
      chip.innerHTML = `${icon('i-discord')}<span>Login</span>`;
      chip.hidden = false;
    } else {
      chip.hidden = true;
    }
  }

  async function saveNotifications(e) {
    e.preventDefault();
    const f = $('notif-form'); const msg = $('notif-msg'); msg.textContent = 'Saving…';
    try {
      const res = await fetch('/api/player/me/notifications', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ raid: f.elements.raid.checked, vehicle: f.elements.vehicle.checked, chest: f.elements.chest.checked, lock: f.elements.lock.checked, scope: f.elements.scope.value }),
      });
      msg.textContent = res.ok ? 'Saved ✓' : 'Save failed';
    } catch { msg.textContent = 'Save failed'; }
    setTimeout(() => { msg.textContent = ''; }, 2500);
  }
  async function logout() {
    try { await fetch('/api/auth/discord/logout', { method: 'POST', credentials: 'same-origin' }); } catch { /* ignore */ }
    window.location.reload();
  }

  // ── Bunkers ──────────────────────────────────────────────────────────────
  async function loadBunkers() {
    const grid = $('bunker-grid');
    grid.innerHTML = '<div class="muted">Loading…</div>';
    try {
      const { bunkers } = await getJSON('/api/public/bunkers');
      if (!bunkers || !bunkers.length) { grid.innerHTML = '<div class="muted">No bunker telemetry yet.</div>'; return; }
      const now = Math.floor(Date.now() / 1000);
      grid.innerHTML = bunkers.map((b) => {
        const active = b.state === 'active';
        let eta = '';
        if (active && b.activeSince) eta = `<span class="bunker-eta">active for <b>${dur(now - b.activeSince)}</b></span>`;
        else if (!active && b.nextActivation) eta = `<span class="bunker-eta">opens in <b>${dur(b.nextActivation - now)}</b></span>`;
        else eta = `<span class="bunker-eta">${esc(b.state)}</span>`;
        return `<div class="bunker ${active ? 'active' : 'locked'}"><div class="bunker-top"><span class="bunker-sector">${esc(b.sector)}</span><span class="badge ${active ? 'active' : 'locked'}">${active ? 'Active' : 'Locked'}</span></div>${eta}</div>`;
      }).join('');
    } catch { grid.innerHTML = '<div class="muted">Couldn\'t load bunkers.</div>'; }
  }

  // ── Economy ──────────────────────────────────────────────────────────────
  async function loadEconomy() {
    const money = (n) => `${num(Number(n) || 0)} $`;
    try {
      const e = await getJSON('/api/public/economy');
      const dealsEl = $('econ-deals'), tradersEl = $('econ-traders'), goldEl = $('econ-gold'), rotEl = $('econ-rotation');
      if (!e.available) {
        dealsEl.innerHTML = '<li class="muted small">Economy data unavailable.</li>';
        tradersEl.innerHTML = ''; goldEl.innerHTML = ''; rotEl.innerHTML = '';
        $('econ-deals-count').textContent = ''; $('econ-traders-total').textContent = '';
        return;
      }

      // Market activity (recent trades + hot items)
      const market = e.market || {};
      const trades = e.recentTrades || [];
      $('econ-market-meta').textContent = market.count ? `· ${money(market.volume)} in ${market.count} trades` : '';
      const pills = [];
      if (market.volume != null && market.count) pills.push(`<div class="econ-pill"><span class="v">${money(market.volume)}</span><span class="k">Recent volume</span></div>`);
      if (market.busiestTrader) pills.push(`<div class="econ-pill"><span class="v">${esc(market.busiestTrader.name)}</span><span class="k">Busiest trader</span></div>`);
      (market.topItems || []).slice(0, 6).forEach((it) => pills.push(`<div class="econ-pill"><span class="v">${esc(it.item)}</span><span class="k">${money(it.value)} · ×${it.count}</span></div>`));
      $('econ-market-stats').innerHTML = pills.join('');
      $('econ-trades').innerHTML = trades.length
        ? trades.map((t) => {
          const thumb = t.image ? `<img class="etr-img" src="${esc(t.image)}" alt="" loading="lazy" onerror="this.remove()">` : `<span class="etr-img etr-img-x">${icon('i-box')}</span>`;
          return `<li class="etr etr-${t.action}">${thumb}<span class="etr-act">${t.action === 'sell' ? '▲ sold' : '▼ bought'}</span><span class="etr-item">${esc(t.item)}</span><span class="etr-price">${money(t.price)}</span><span class="etr-sub">${esc(t.player)} · ${esc(t.trader)} · ${ago(t.ts)}</span></li>`;
        }).join('')
        : '<li class="muted small">No recent trades — fills in as players trade.</li>';

      // On sale
      const deals = e.deals || [];
      $('econ-deals-count').textContent = deals.length ? `· ${deals.length}` : '';
      dealsEl.innerHTML = deals.length ? deals.map((d) => {
        const where = d.sector || d.trader || '';
        const extras = [
          `<span class="ed-x">${icon('i-coins')}${money(d.price)}</span>`,
          `<span class="ed-x">${icon('i-box')}${num(d.stock)}</span>`,
          d.fameRequired ? `<span class="ed-x">${icon('i-star')}${num(d.fameRequired)}</span>` : '',
          where ? `<span class="ed-x">${icon('i-map')}${esc(where)}</span>` : '',
        ].filter(Boolean).join('');
        const thumb = d.image ? `<img class="ed-img" src="${esc(d.image)}" alt="" loading="lazy" onerror="this.remove()">` : `<span class="ed-img ed-img-x">${icon('i-box')}</span>`;
        return `<li class="ed">${thumb}<div class="ed-body"><span class="ed-item">${esc(d.item)}</span><span class="ed-extras">${extras}</span></div></li>`;
      }).join('') : '<li class="muted small">No special deals right now.</li>';

      // Trader funds
      const traders = e.traders || [];
      const total = traders.reduce((a, t) => a + (t.funds || 0), 0);
      $('econ-traders-total').textContent = traders.length ? `· ${money(total)}` : '';
      if (traders.length) {
        const byLoc = {};
        traders.forEach((x) => { (byLoc[x.location || 'Outpost'] = byLoc[x.location || 'Outpost'] || []).push(x); });
        tradersEl.innerHTML = Object.entries(byLoc).map(([loc, list]) =>
          `<div class="trader-card"><div class="trader-loc">Outpost ${esc(loc)}</div>${list.map((x) => `<div class="trader-row"><span>${esc(x.type || 'Trader')}</span><span class="v">${x.funds == null ? 'Unknown' : money(x.funds)}</span></div>`).join('')}</div>`).join('');
      } else {
        tradersEl.innerHTML = '<div class="muted small">No trader activity recorded yet — fills in as players trade.</div>';
      }

      // Gold
      const g = e.gold;
      goldEl.innerHTML = (g && g.outposts)
        ? `<div class="econ-pill"><span class="v">${money(g.buyFunds)}</span><span class="k">Buy capacity</span></div><div class="econ-pill"><span class="v">${num(g.sellFunds)} gold</span><span class="k">Sell capacity</span></div>`
        : '<div class="muted small">No gold outposts.</div>';

      // Economy timing (from EconomyOverride.json) — each line has a hover tooltip.
      const t = e.timing || {};
      const hh = (x) => `${Number.isInteger(x) ? x : Number(x).toFixed(1)} h`;
      const parts = []; // [icon, html, tooltip]
      if (t.rotationEnabled && t.rotationHoursMin != null && t.rotationHoursMax != null) {
        parts.push([icon('i-refresh'), `Offered items rotate every <b>${t.rotationHoursMin}–${t.rotationHoursMax}</b> in-game hours`, 'Which tradeables each trader offers changes on this schedule.']);
      }
      if (t.fullRestockHours != null && t.fullRestockHours > 0) {
        parts.push([icon('i-box'), `Sold-out stock refills in <b>${hh(t.fullRestockHours)}</b>`, 'How long a depleted trader takes to fully restock its stock organically.']);
      }
      if (t.unlimitedStock) parts.push([icon('i-box'), 'Trader stock <b>never runs out</b>', 'traders-unlimited-stock is on — stock never depletes.']);
      if (t.traderFundsRefillHours != null) {
        parts.push([icon('i-coins'), `Depleted trader funds refill in <b>${hh(t.traderFundsRefillHours)}</b>`, 'How fast a trader refills the money it pays out for items.']);
      }
      if (t.unlimitedFunds) parts.push([icon('i-coins'), 'Trader funds <b>never run out</b>', 'traders-unlimited-funds is on — funds never deplete when players sell.']);
      if (t.pricesRandomizationHours != null && t.pricesRandomizationHours > 0) {
        parts.push([icon('i-scale'), `Prices re-roll every <b>${hh(t.pricesRandomizationHours)}</b>`, 'How often store prices are randomized.']);
      }
      if (t.pricesSubjectToPlayerCount) parts.push([icon('i-users'), 'Prices scale with <b>player count</b>', 'Item prices are adjusted based on how many players are online.']);
      if (t.resetTimeHours != null && t.resetTimeHours > 0) {
        parts.push([icon('i-refresh'), `Full economy reset every <b>${hh(t.resetTimeHours)}</b>`, 'The whole economy instantly resets (full restock of stock and money) on this interval.']);
        if (t.secondsSinceReset != null) parts.push([icon('i-clock'), `Last reset <b>${dur(t.secondsSinceReset)}</b> ago`, 'Time since the last full economy reset.']);
      } else {
        parts.push([icon('i-refresh'), 'No scheduled full resets', 'economy-reset-time-hours is -1 — the economy only regenerates organically, never instantly.']);
      }
      rotEl.innerHTML = parts.length
        ? parts.map(([ic, txt, tip]) => `<li title="${esc(tip)}">${ic}<span>${txt}</span></li>`).join('')
        : '<li class="muted small">No economy timing info.</li>';
    } catch {
      $('econ-deals').innerHTML = '<li class="muted small">Could not load economy.</li>';
    }
  }

  // ── Kill feed ────────────────────────────────────────────────────────────
  async function loadKillfeed() {
    const list = $('killfeed-list');
    const note = $('killfeed-note');
    list.innerHTML = '<li class="muted">Loading…</li>';
    try {
      const data = await getJSON('/api/public/killfeed?limit=40');
      const kills = data.kills || [];
      // Only warn about the feature when it's genuinely off.
      if (note) note.hidden = data.enabled !== false;
      if (!kills.length) {
        list.innerHTML = `<li class="muted">${data.enabled === false ? 'The kill feed is turned off.' : 'No kills recorded yet.'}</li>`;
        return;
      }
      list.innerHTML = kills.map((k) => {
        if (k.type === 'suicide') {
          return `<li class="kf">${icon('i-grave')}<div class="kf-main"><span class="kf-victim">${esc(k.victim)}</span> took their own life</div><span class="kf-time">${ago(k.at)}</span></li>`;
        }
        const dist = k.distance ? ` · ${k.distance} m` : '';
        const wpn = k.weapon ? esc(k.weapon) : 'unknown';
        return `<li class="kf">${icon('i-skull')}<div class="kf-main"><div><span class="kf-killer">${esc(k.killer)}</span> → <span class="kf-victim">${esc(k.victim)}</span></div><span class="kf-sub">${wpn}${dist}</span></div><span class="kf-time">${ago(k.at)}</span></li>`;
      }).join('');
    } catch { list.innerHTML = '<li class="muted">Couldn\'t load the kill feed.</li>'; }
  }

  async function loadEvents() {
    const tb = $('events-body');
    tb.innerHTML = '<tr><td colspan="7" class="muted">Loading…</td></tr>';
    try {
      const data = await getJSON('/api/public/events');
      const rows = data.rankings || [];
      if (!data.available) { tb.innerHTML = '<tr><td colspan="7" class="muted">Events aren\'t available yet.</td></tr>'; return; }
      tb.innerHTML = rows.length
        ? rows.map((r, i) => `<tr><td class="rank">${i + 1}</td><td>${esc(r.Name)}</td><td class="num">${num(r.Score)}</td><td class="num">${num(r.Kills)}</td><td class="num">${num(r.Deaths)}</td><td class="num">${num(r.Headshots)}</td><td class="num">${num(r.Wins)}</td></tr>`).join('')
        : '<tr><td colspan="7" class="muted">No events have taken place yet.</td></tr>';
    } catch { tb.innerHTML = '<tr><td colspan="7" class="muted">Couldn\'t load events.</td></tr>'; }
  }

  // ── Wiring ───────────────────────────────────────────────────────────────
  loaders.leaderboards = () => loadLeaderboards(0);
  loaders.mystats = loadMyStats;
  loaders.bunkers = loadBunkers;
  loaders.economy = loadEconomy;
  loaders.killfeed = loadKillfeed;
  loaders.squads = loadSquads;
  loaders.events = loadEvents;

  document.querySelectorAll('.nav-btn, .jump-card').forEach((el) => el.addEventListener('click', () => switchView(el.dataset.view)));
  { const brand = document.querySelector('.brand'); if (brand) brand.addEventListener('click', () => switchView('overview')); }
  $('player-chip').addEventListener('click', (e) => {
    if ($('player-chip').dataset.action === 'login') return; // navigate to Discord OAuth
    e.preventDefault(); switchView('mystats');
  });
  window.addEventListener('hashchange', () => switchView((location.hash || '').replace('#', '') || 'overview'));
  document.querySelectorAll('.seg-btn').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active'); loadLeaderboards(Number(btn.dataset.weekly));
  }));
  $('lb-category').addEventListener('change', buildRows);
  $('lb-search').addEventListener('input', renderLeaderboard);
  $('notif-form').addEventListener('submit', saveNotifications);
  $('notif-toggle').addEventListener('click', () => {
    const p = $('notif-panel');
    p.hidden = !p.hidden;
    if (!p.hidden) { loadNotifHistory(); p.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  });
  $('notif-close').addEventListener('click', () => { $('notif-panel').hidden = true; });
  $('logout-btn').addEventListener('click', logout);
  $('logout-btn-unlinked').addEventListener('click', logout);
  $('unlink-btn').addEventListener('click', async () => {
    if (!window.confirm('Unlink your SCUM character from this Discord account?')) return;
    try { await fetch('/api/player/me/unlink', { method: 'POST', credentials: 'same-origin' }); } catch { /* ignore */ }
    window.location.reload();
  });
  document.querySelectorAll('[data-refresh]').forEach((btn) => btn.addEventListener('click', () => {
    const v = btn.dataset.refresh; loaded[v] = true;
    ({ bunkers: loadBunkers, economy: loadEconomy, killfeed: loadKillfeed, squads: loadSquads, events: loadEvents }[v] || (() => {}))();
  }));

  // Link a SCUM account from the web: get a connect code, then poll until linked.
  let linkPoll = null;
  $('link-start-btn').addEventListener('click', async () => {
    const msg = $('link-msg');
    msg.textContent = 'Generating code…';
    try {
      const res = await fetch('/api/auth/discord/link', { method: 'POST', credentials: 'same-origin' });
      const d = await res.json();
      if (d.alreadyLinked) { window.location.reload(); return; }
      if (!d.code) { msg.textContent = d.error === 'not_authenticated' ? 'Please log in again.' : 'Could not start linking.'; return; }
      $('link-code').textContent = `connect:${d.code}`;
      $('link-instructions').hidden = false;
      $('link-start-btn').setAttribute('hidden', '');
      msg.textContent = '';
      if (linkPoll) clearInterval(linkPoll);
      linkPoll = setInterval(async () => {
        try {
          const s = await getJSON('/api/auth/discord/session');
          if (s.player && s.player.linked) { clearInterval(linkPoll); window.location.reload(); }
        } catch { /* keep polling */ }
      }, 5000);
    } catch { msg.textContent = 'Could not start linking.'; }
  });

  // Click a leaderboard row → that player's profile (logged-in players only).
  $('lb-list').addEventListener('click', (e) => {
    const li = e.target.closest('.lb-row');
    if (li && li.dataset.name) openPlayerProfile(li.dataset.name);
  });
  // Click a squad row → squad detail.
  $('squad-list').addEventListener('click', (e) => {
    const li = e.target.closest('.squad-row');
    if (li && li.dataset.id) openSquadDetail(li.dataset.id);
  });
  // Top squads on the Overview → squad detail (logged-in players only).
  $('ov-squads').addEventListener('click', (e) => {
    const li = e.target.closest('.ov-squad-row');
    if (!li || !li.dataset.squadId) return;
    if (!isLoggedIn) { openModal('<p class="muted">Log in with Discord to view squad details.</p>'); return; }
    openSquadDetail(li.dataset.squadId);
  });
  $('modal-close').addEventListener('click', closeModal);
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  // Delegated clicks: a player name [data-player] → that player's profile (takes
  // priority); a category [data-cat] → that leaderboard category.
  document.addEventListener('click', (e) => {
    const pin = e.target.closest('.pin-btn');
    if (pin) { const show = pin.classList.toggle('revealed'); pin.innerHTML = show ? `${esc(pin.dataset.pin)} <em>hide</em>` : '•••• <em>reveal</em>'; return; }
    const pl = e.target.closest('[data-player]');
    if (pl) { e.preventDefault(); openPlayerProfile(pl.dataset.player); return; }
    const cat = e.target.closest('[data-cat]');
    if (cat) { e.preventDefault(); openLeaderboardCategory(cat.dataset.cat); }
  });

  // Hide tabs the admin disabled (web.fieldConsole.tabs), in the nav + footer.
  async function applySiteConfig() {
    let cfg;
    try { cfg = await getJSON('/api/public/site-config'); } catch { return; }
    const tabs = (cfg.fieldConsole && cfg.fieldConsole.tabs) || {};
    const TAB_MAP = { leaderboards: 'leaderboards', squads: 'squads', myStats: 'mystats', bunkers: 'bunkers', economy: 'economy', killFeed: 'killfeed', events: 'events' };
    disabledTabs = new Set();
    for (const [key, view] of Object.entries(TAB_MAP)) {
      if (tabs[key] === false) {
        disabledTabs.add(view);
        document.querySelectorAll(`.nav-btn[data-view="${view}"], .foot-nav a[href="#${view}"]`).forEach((el) => { el.hidden = true; });
      }
    }
    if (disabledTabs.has(currentView)) switchView('overview');
  }

  // Auto-hide the sticky topbar on scroll-down, reveal on scroll-up (mobile-friendly).
  (function autoHideTopbar() {
    const bar = document.querySelector('.topbar');
    if (!bar) return;
    let last = window.scrollY;
    window.addEventListener('scroll', () => {
      const y = window.scrollY;
      if (y > last && y > 90) bar.classList.add('nav-hidden');
      else if (y < last) bar.classList.remove('nav-hidden');
      last = y;
    }, { passive: true });
  })();

  // ── Init ─────────────────────────────────────────────────────────────────
  applySiteConfig();
  loadOverview();
  loadSession();
  setInterval(loadOverview, 30000);
  const initial = (location.hash || '').replace('#', '') || 'overview';
  switchView(initial);
})();
