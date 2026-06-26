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
  const num = (v) => (typeof v === 'number' ? Math.round(v).toLocaleString() : (v == null ? '0' : v));

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
  const GATED = ['leaderboards', 'squads', 'mystats', 'bunkers', 'economy', 'killfeed'];
  let currentView = 'overview';
  function switchView(name) {
    if (!document.getElementById(`view-${name}`)) name = 'overview';
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

    // Top squads
    const squads = o.topSquads || [];
    $('ov-squads').innerHTML = squads.length ? squads.map((sq) => `<li><span class="sq-name">${esc(sq.name)}</span><span class="sq-val">${esc(num(sq.value))}</span></li>`).join('') : '<li class="muted small">No squads yet.</li>';
  }

  // ── Leaderboards ─────────────────────────────────────────────────────────
  let lbCache = null, lbRows = [];
  async function loadLeaderboards(weekly) {
    const list = $('lb-list');
    list.innerHTML = '<li class="lb-empty">Loading…</li>';
    try {
      const data = await getJSON(`/api/public/leaderboards?weekly=${weekly || 0}&limit=100`);
      lbCache = data;
      if (!$('lb-category').options.length) {
        $('lb-category').innerHTML = (data.categories || []).map((c) => `<option value="${c.key}">${esc(c.label)}</option>`).join('');
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

  // ── My Stats (dossier) ───────────────────────────────────────────────────
  const show = (id, on) => { const el = $(id); if (el) el.hidden = !on; };
  // Kept in sync with the Discord /player-stats embed (slashCommands.js).
  const COMBAT = [
    ['Kills', 'Kills', 'i-skull', 'int'], ['Deaths', 'Deaths', 'i-grave', 'int'], ['__kd', 'K/D', 'i-target', 'raw'],
    ['PvpKills', 'PvP kills', 'i-gun', 'int'], ['PvpDeaths', 'PvP deaths', 'i-grave', 'int'], ['Headshots', 'Headshots', 'i-crosshair', 'int'],
    ['ZombieKills', 'Puppet kills', 'i-skull', 'int'], ['AnimalKills', 'Animal kills', 'i-target', 'int'], ['LongestKill', 'Longest kill', 'i-target', 'meters'],
    ['FirearmKills', 'Firearm kills', 'i-gun', 'int'], ['MeleeKills', 'Melee kills', 'i-crosshair', 'int'], ['ArcheryKills', 'Archery kills', 'i-crosshair', 'int'],
  ];
  const SURVIVAL = [
    ['MinutesSurvived', 'Survived', 'i-clock', 'hmin'], ['Distance', 'On foot', 'i-foot', 'km'], ['Looted', 'Looted', 'i-box', 'int'],
    ['LocksPicked', 'Locks picked', 'i-lock', 'int'], ['Crafted', 'Crafted', 'i-box', 'int'], ['FishCaught', 'Fish caught', 'i-target', 'int'],
    ['FamePoints', 'Fame', 'i-star', 'int'], ['Money', 'Money', 'i-coins', 'int'], ['PlayTime', 'Playtime', 'i-clock', 'hsec'],
  ];
  function statGridHtml(fields, s) {
    return fields.map(([k, label, ic, kind]) =>
      `<div class="ds">${icon(ic)}<div class="ds-txt"><span class="ds-v">${esc(fmtStat(s[k] != null ? s[k] : 0, kind))}</span><span class="ds-k">${label}</span></div></div>`).join('');
  }
  function statGrid(elId, fields, s) { $(elId).innerHTML = statGridHtml(fields, s); }

  function ranksHtml(ranks) {
    if (!ranks || !ranks.length) return '<li class="muted small">No leaderboard placements yet.</li>';
    return ranks.slice(0, 8).map((r) => {
      const pc = r.rank === 1 ? 'g' : r.rank === 2 ? 's' : r.rank === 3 ? 'b' : '';
      return `<li class="rank-chip"><span class="rank-pos ${pc}">#${r.rank}</span><span class="rank-label">${esc(r.label)}</span><span class="rank-val">${esc(num(r.value))}</span></li>`;
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
      openModal(
        `<div class="record"><div class="record-id"><span class="record-label">Inmate</span><span class="record-name">${esc(d.name)}</span></div></div>`
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
    $('me-ranks').innerHTML = ranks.length
      ? ranks.slice(0, 8).map((r) => { const pc = r.rank === 1 ? 'g' : r.rank === 2 ? 's' : r.rank === 3 ? 'b' : ''; return `<li class="rank-chip"><span class="rank-pos ${pc}">#${r.rank}</span><span class="rank-label">${esc(r.label)}</span><span class="rank-val">${esc(num(r.value))}</span></li>`; }).join('')
      : '<li class="muted small">Not in any leaderboard top 100 yet.</li>';

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
    let t = new Date(s).getTime();
    if (Number.isNaN(t)) t = new Date(`${String(s).replace(' ', 'T')}Z`).getTime();
    return Number.isNaN(t) ? '' : ago(t);
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
        ? history.map((h) => `<li class="nh-row"><div class="nh-main"><span class="nh-title">${esc(h.title || 'Alert')}</span><span class="nh-body">${esc(h.body || '')}</span></div><span class="nh-time">${agoDate(h.sentAt)}</span></li>`).join('')
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

      // On sale
      const deals = e.deals || [];
      $('econ-deals-count').textContent = deals.length ? `· ${deals.length}` : '';
      dealsEl.innerHTML = deals.length ? deals.map((d) => {
        const where = d.sector || d.trader || '';
        const extras = [`💰 ${money(d.price)}`, `📦 ${num(d.stock)}`, d.fameRequired ? `⭐ ${num(d.fameRequired)}` : '', where ? `📍 ${esc(where)}` : ''].filter(Boolean).join(' · ');
        return `<li class="ed"><span class="ed-item">${esc(d.item)}</span><span class="ed-extras">${extras}</span></li>`;
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

      // Stock rotation
      const t = e.timing || {};
      const parts = [];
      if (t.rotationEnabled && t.rotationHoursMin != null && t.rotationHoursMax != null) parts.push(`🔄 Items rotate every <b>${t.rotationHoursMin}–${t.rotationHoursMax}</b> in-game hours`);
      if (t.fullRestockHours != null) parts.push(`📦 Sold-out stock refills in <b>${t.fullRestockHours} h</b>`);
      if (t.resetTimeHours != null && t.resetTimeHours > 0) {
        parts.push(`🔁 Full economy reset every <b>${t.resetTimeHours} h</b>`);
        if (t.secondsSinceReset != null) parts.push(`⏱️ Last reset <b>${dur(t.secondsSinceReset)}</b> ago`);
      }
      rotEl.innerHTML = parts.length ? parts.map((p) => `<li>${p}</li>`).join('') : '<li class="muted small">No rotation info.</li>';
    } catch {
      $('econ-deals').innerHTML = '<li class="muted small">Could not load economy.</li>';
    }
  }

  // ── Kill feed ────────────────────────────────────────────────────────────
  async function loadKillfeed() {
    const list = $('killfeed-list');
    list.innerHTML = '<li class="muted">Loading…</li>';
    try {
      const { kills } = await getJSON('/api/public/killfeed?limit=40');
      if (!kills || !kills.length) { list.innerHTML = '<li class="muted">No kills recorded yet.</li>'; return; }
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

  // ── Wiring ───────────────────────────────────────────────────────────────
  loaders.leaderboards = () => loadLeaderboards(0);
  loaders.mystats = loadMyStats;
  loaders.bunkers = loadBunkers;
  loaders.economy = loadEconomy;
  loaders.killfeed = loadKillfeed;
  loaders.squads = loadSquads;

  document.querySelectorAll('.nav-btn, .jump-card').forEach((el) => el.addEventListener('click', () => switchView(el.dataset.view)));
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
  document.querySelectorAll('[data-refresh]').forEach((btn) => btn.addEventListener('click', () => {
    const v = btn.dataset.refresh; loaded[v] = true;
    ({ bunkers: loadBunkers, economy: loadEconomy, killfeed: loadKillfeed, squads: loadSquads }[v] || (() => {}))();
  }));

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
  $('modal-close').addEventListener('click', closeModal);
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  // Any player name marked [data-player] (squad members in My Stats / modals) opens
  // that player's profile — same as clicking a leaderboard row.
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-player]');
    if (el) { e.preventDefault(); openPlayerProfile(el.dataset.player); }
  });

  // ── Init ─────────────────────────────────────────────────────────────────
  loadOverview();
  loadSession();
  setInterval(loadOverview, 30000);
  const initial = (location.hash || '').replace('#', '') || 'overview';
  switchView(initial);
})();
