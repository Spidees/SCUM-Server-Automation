/* global io */
(function () {
  // Inject the shared footer (GitHub / Discord links) into every main screen so
  // the header + footer are consistent across Dashboard, Settings, Game Settings
  // and Discord — defined once here instead of duplicated in the markup.
  (function injectFooters() {
    const html = '<footer class="app-footer">'
      + '<span class="app-footer-brand">SCUM Server Automation</span>'
      + '<nav class="app-footer-links">'
      + '<a href="https://github.com/Spidees/SCUM-Server-Automation" target="_blank" rel="noopener noreferrer">▸ GitHub</a>'
      + '<a href="https://playhub.cz/discord" target="_blank" rel="noopener noreferrer">▸ Discord</a>'
      + '</nav></footer>';
    ['dashboard-screen', 'settings-screen', 'game-settings-screen', 'discord-screen'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && !el.querySelector('.app-footer')) el.insertAdjacentHTML('beforeend', html);
    });
  })();

  const loginScreen = document.getElementById('login-screen');
  const dashboardScreen = document.getElementById('dashboard-screen');
  const settingsScreen = document.getElementById('settings-screen');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const logoutBtn = document.getElementById('logout-btn');
  const controlMessage = document.getElementById('control-message');
  const logTail = document.getElementById('log-tail');

  const setupScreen = document.getElementById('setup-screen');
  const suFormWrap = document.getElementById('su-form-wrap');
  const suInstallWrap = document.getElementById('su-install-wrap');
  const suProgressLog = document.getElementById('su-progress-log');
  const suDoneWrap = document.getElementById('su-done-wrap');
  const suErrorWrap = document.getElementById('su-error-wrap');
  const suInstallError = document.getElementById('su-install-error');

  let socket = null;

  function showDashboard() {
    loginScreen.classList.add('hidden');
    dashboardScreen.classList.remove('hidden');
    if (!socket) initSocket();
    refreshStatus();
    refreshScheduling();
    refreshBackups();
    refreshUpdateStatus();
    refreshGameStats();
    refreshPlayers();
    loadLeaderboardCategories().then(refreshLeaderboard);
    loadLogTail();
  }

  function showLogin() {
    dashboardScreen.classList.add('hidden');
    setupScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
  }

  function showSetup() {
    loginScreen.classList.add('hidden');
    dashboardScreen.classList.add('hidden');
    setupScreen.classList.remove('hidden');
  }

  async function checkSession() {
    try {
      const setupRes = await fetch('/api/setup/status');
      const setupData = await setupRes.json();
      if (setupData.needsSetup) { showSetup(); return; }
    } catch { /* ignore — continue to auth check */ }
    const res = await fetch('/api/auth/session');
    const data = await res.json();
    if (data.authenticated) showDashboard();
    else showLogin();
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    const password = document.getElementById('password').value;
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      showDashboard();
    } else {
      loginError.textContent = 'Invalid password';
    }
  });

  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    showLogin();
  });

  function fmtBadge(status) {
    const el = document.getElementById('status-value');
    el.textContent = status.ActualServerState || status.Status || 'Unknown';
    el.className = 'value badge';
    if (status.IsRunning) el.classList.add('online');
    else if (['Starting', 'Loading', 'ShuttingDown'].includes(status.ActualServerState)) el.classList.add('transitional');
    else el.classList.add('offline');
  }

  function updateStatus(status) {
    fmtBadge(status);
    const perf = status.Performance;
    document.getElementById('players-value').textContent = `${status.OnlinePlayers} / ${status.MaxPlayers}`;
    document.getElementById('fps-value').textContent = perf ? perf.FPS : '-';
    document.getElementById('cpu-value').textContent = perf ? `${perf.CPU}%` : '-';
    if (perf && perf.MemoryTotal) {
      document.getElementById('memory-value').textContent = `${(perf.Memory / 1024).toFixed(1)} / ${(perf.MemoryTotal / 1024).toFixed(1)} GB`;
    } else {
      document.getElementById('memory-value').textContent = perf ? `${perf.Memory} MB` : '-';
    }
    document.getElementById('entities-value').textContent = perf ? perf.Entities : '-';
    document.getElementById('service-value').textContent = status.ServiceStatus || '-';
    document.getElementById('lastupdate-value').textContent = status.LastUpdate ? new Date(status.LastUpdate).toLocaleTimeString() : '-';
  }

  async function refreshStatus() {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) return;
      updateStatus(await res.json());
    } catch {
      // ignore transient errors
    }
  }

  async function refreshScheduling() {
    try {
      const res = await fetch('/api/scheduling');
      if (!res.ok) return;
      const data = await res.json();
      let nextText = data.NextRestart ? new Date(data.NextRestart).toLocaleString() : '-';
      if (data.NextRestart && data.NextRestartIsManual) nextText += ' (manual)';
      else if (data.NextRestart && data.SkipNextRestart) nextText += ' (skipped)';
      document.getElementById('next-restart-value').textContent = nextText;
      const toggle = document.getElementById('skip-restart-toggle');
      const label = document.getElementById('skip-restart-label');
      if (!toggle.matches(':active')) toggle.checked = !!data.SkipNextRestart;
      label.textContent = data.SkipNextRestart ? 'Yes' : 'No';
    } catch {
      // ignore
    }
  }

  async function refreshBackups() {
    try {
      const res = await fetch('/api/backups/stats');
      if (!res.ok) return;
      const data = await res.json();
      document.getElementById('backup-stats-value').textContent = `${data.BackupCount} (${data.TotalSizeText})`;
      document.getElementById('last-backup-value').textContent = data.LatestBackup || '-';
    } catch {
      // ignore
    }
  }

  async function refreshUpdateStatus() {
    try {
      const res = await fetch('/api/update/status');
      if (!res.ok) return;
      const data = await res.json();
      document.getElementById('installed-version-value').textContent = data.InstalledBuild || '-';
      let statusText = data.Status || '-';
      if (data.InProgress) statusText = 'Updating...';
      else if (data.UpdateAvailable) statusText = `Update available (${data.LatestBuild})`;
      document.getElementById('update-status-value').textContent = statusText;
    } catch {
      // ignore
    }
  }

  async function refreshGameStats() {
    try {
      const res = await fetch('/api/game-stats');
      if (!res.ok) return;
      const data = await res.json();
      if (!data.available) return;
      document.getElementById('gametime-value').textContent = data.gameTime && data.gameTime.Success ? data.gameTime.FormattedTime : '-';
      document.getElementById('weather-value').textContent = data.weather && data.weather.Success ? data.weather.FormattedTemperature : '-';
      document.getElementById('totalplayers-value').textContent = data.statistics ? data.statistics.TotalPlayers : '-';
      document.getElementById('squads-value').textContent = data.activeSquads ?? '-';
      document.getElementById('vehicles-value').textContent = data.vehicles ?? '-';
      document.getElementById('bases-value').textContent = data.bases ?? '-';
    } catch {
      // ignore
    }
  }

  async function refreshPlayers() {
    try {
      const res = await fetch('/api/players');
      if (!res.ok) return;
      const data = await res.json();
      const list = document.getElementById('players-list');
      list.innerHTML = '';
      if (!data.available || !data.players.length) {
        list.innerHTML = '<li>No players online</li>';
        return;
      }
      for (const p of data.players) {
        const li = document.createElement('li');
        li.textContent = p.PlayerName || p.name || JSON.stringify(p);
        list.appendChild(li);
      }
    } catch {
      // ignore
    }
  }

  async function loadLeaderboardCategories() {
    try {
      const res = await fetch('/api/leaderboards?limit=1');
      if (!res.ok) return;
      const data = await res.json();
      const select = document.getElementById('leaderboard-category');
      select.innerHTML = '';
      for (const cat of data.categories) {
        const opt = document.createElement('option');
        opt.value = cat.key;
        opt.textContent = cat.label;
        select.appendChild(opt);
      }
    } catch {
      // ignore
    }
  }

  async function refreshLeaderboard() {
    try {
      const select = document.getElementById('leaderboard-category');
      const category = select.value;
      if (!category) return;
      const weekly = document.getElementById('leaderboard-weekly').checked;
      const res = await fetch(`/api/leaderboards/${category}?limit=10&weekly=${weekly ? '1' : '0'}`);
      if (!res.ok) return;
      const data = await res.json();
      const tbody = document.querySelector('#leaderboard-table tbody');
      tbody.innerHTML = '';
      if (!data.available || !data.data.length) {
        tbody.innerHTML = '<tr><td colspan="3">No data</td></tr>';
        return;
      }
      data.data.forEach((row, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${i + 1}</td><td>${row.Name}</td><td>${row.FormattedValue}</td>`;
        tbody.appendChild(tr);
      });
    } catch {
      // ignore
    }
  }

  document.getElementById('leaderboard-category').addEventListener('change', refreshLeaderboard);
  document.getElementById('leaderboard-weekly').addEventListener('change', refreshLeaderboard);

  document.getElementById('skip-restart-toggle').addEventListener('change', async (e) => {
    const skip = e.target.checked;
    try {
      const res = await fetch('/api/control/restart-skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skip }),
      });
      const data = await res.json();
      document.getElementById('skip-restart-label').textContent = data.skip ? 'Yes' : 'No';
    } catch {
      e.target.checked = !skip;
    }
  });

  async function loadLogTail() {
    try {
      const res = await fetch('/api/logs/tail?lines=200');
      const data = await res.json();
      logTail.textContent = data.lines.join('\n');
      logTail.scrollTop = logTail.scrollHeight;
    } catch {
      // ignore
    }
  }

  function appendLogLine(line) {
    logTail.textContent += `\n${line}`;
    logTail.scrollTop = logTail.scrollHeight;
  }

  function appendProgress(message, isError) {
    const line = document.createElement('div');
    line.textContent = message;
    if (isError) line.style.color = '#f87171';
    suProgressLog.appendChild(line);
    suProgressLog.scrollTop = suProgressLog.scrollHeight;
  }

  document.getElementById('su-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const suError = document.getElementById('su-error');
    suError.textContent = '';

    const body = {
      serverDir: document.getElementById('su-serverDir').value.trim(),
      backupRoot: document.getElementById('su-backupRoot').value.trim(),
      serviceName: document.getElementById('su-serviceName').value.trim(),
      publicIP: document.getElementById('su-publicIP').value.trim(),
      serverPort: document.getElementById('su-serverPort').value.trim(),
      queryPort: document.getElementById('su-queryPort').value.trim(),
      maxPlayers: document.getElementById('su-maxPlayers').value.trim(),
      noBattleye: document.getElementById('su-nobattleye').checked,
      customArgs: document.getElementById('su-customArgs').value.trim(),
      webPort: document.getElementById('su-webPort').value.trim(),
      webPassword: document.getElementById('su-webPassword').value,
      discordToken: document.getElementById('su-discordToken').value.trim(),
      guildId: document.getElementById('su-guildId').value.trim(),
    };

    if (!body.serverDir) { suError.textContent = 'Server directory is required.'; return; }
    if (!body.webPassword) { suError.textContent = 'Admin password is required.'; return; }

    const saveBtn = document.getElementById('su-save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    try {
      const saveRes = await fetch('/api/setup/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) {
        suError.textContent = saveData.error || 'Failed to save configuration.';
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save & Install SCUM Server →';
        return;
      }

      // Switch to install progress view
      suFormWrap.classList.add('hidden');
      suInstallWrap.classList.remove('hidden');
      if (!socket) initSocket();

      const statusRes = await fetch('/api/setup/install-status');
      const statusData = await statusRes.json();

      if (statusData.needed) {
        appendProgress('Starting SCUM server installation…');
        await fetch('/api/setup/install', { method: 'POST' });
      } else {
        appendProgress('Server already installed.');
        appendProgress('Configuration saved. Restart the app (Start.bat) to apply changes.');
        suDoneWrap.classList.remove('hidden');
      }
    } catch (err) {
      suError.textContent = `Error: ${err.message}`;
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save & Install SCUM Server →';
    }
  });

  function initSocket() {
    socket = io();
    socket.on('status:update', updateStatus);
    socket.on('log:line', appendLogLine);
    socket.on('install:progress', (data) => {
      appendProgress(data.message, data.error);
      if (data.step === 'done') {
        suDoneWrap.classList.remove('hidden');
      }
      if (data.step === 'redirect') {
        setTimeout(() => window.location.reload(), 3000);
      }
      if (data.error) {
        suInstallError.textContent = data.message;
        suErrorWrap.classList.remove('hidden');
      }
    });
    socket.on('reconnect', async () => {
      try {
        const setupRes = await fetch('/api/setup/status');
        const setupData = await setupRes.json();
        if (!setupData.needsSetup) {
          setupScreen.classList.add('hidden');
          const sessionRes = await fetch('/api/auth/session');
          const sessionData = await sessionRes.json();
          if (sessionData.authenticated) showDashboard();
          else showLogin();
        }
      } catch {}
    });
  }

  async function postControl(action, btn) {
    controlMessage.textContent = `Sending ${action}...`;
    btn.disabled = true;
    try {
      const res = await fetch(`/api/control/${action}`, { method: 'POST' });
      const data = await res.json();
      controlMessage.textContent = data.success
        ? `${action} succeeded${data.fileName ? `: ${data.fileName}` : ''}`
        : `${action} failed: ${data.error || 'unknown error'}`;
    } catch (err) {
      controlMessage.textContent = `${action} failed: ${err.message}`;
    } finally {
      btn.disabled = false;
      refreshStatus();
    }
  }

  document.getElementById('start-btn').addEventListener('click', (e) => postControl('start', e.target));
  document.getElementById('stop-btn').addEventListener('click', (e) => {
    if (confirm('Stop the SCUM server?')) postControl('stop', e.target);
  });
  document.getElementById('restart-btn').addEventListener('click', (e) => {
    if (confirm('Restart the SCUM server?')) postControl('restart', e.target);
  });
  document.getElementById('backup-btn').addEventListener('click', (e) => postControl('backup', e.target).then(refreshBackups));
  document.getElementById('validate-btn').addEventListener('click', (e) => {
    if (confirm('Validate server files via SteamCMD? The server will be stopped during validation.')) postControl('validate', e.target);
  });
  document.getElementById('update-btn').addEventListener('click', (e) => {
    if (confirm('Check for updates and apply if available?')) postControl('update', e.target).then(refreshUpdateStatus);
  });

  function refreshAll() {
    if (dashboardScreen.classList.contains('hidden')) return;
    refreshStatus();
    refreshScheduling();
    refreshBackups();
    refreshUpdateStatus();
    refreshGameStats();
    refreshPlayers();
    refreshLeaderboard();
  }

  checkSession();
  setInterval(refreshAll, 5000);

  // --- Settings editor ---

  function humanize(key) {
    return key
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/^./, (c) => c.toUpperCase());
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isStringArray(value) {
    return Array.isArray(value) && value.every((v) => typeof v !== 'object');
  }

  function buildField(key, value, pathArr) {
    const wrapper = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = humanize(key);

    let input;
    if (typeof value === 'boolean') {
      wrapper.className = 'settings-field checkbox';
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = value;
      input.dataset.type = 'boolean';
      wrapper.appendChild(input);
      wrapper.appendChild(label);
    } else if (isStringArray(value)) {
      wrapper.className = 'settings-field';
      input = document.createElement('textarea');
      input.value = value.join('\n');
      input.dataset.type = 'array';
      wrapper.appendChild(label);
      wrapper.appendChild(input);
    } else if (typeof value === 'number') {
      wrapper.className = 'settings-field';
      input = document.createElement('input');
      input.type = 'number';
      input.value = value;
      input.dataset.type = 'number';
      wrapper.appendChild(label);
      wrapper.appendChild(input);
    } else {
      wrapper.className = 'settings-field';
      input = document.createElement('input');
      input.type = 'text';
      input.value = value === null ? '' : value;
      input.dataset.type = value === null ? 'string-or-null' : 'string';
      wrapper.appendChild(label);
      wrapper.appendChild(input);
    }

    input.dataset.path = JSON.stringify(pathArr);

    if (key === 'restartTimes') {
      const hint = document.createElement('span');
      hint.className = 'ini-desc';
      hint.textContent = 'Generate matching in-game restart warnings (60/45/30/15 min + a 5-min '
        + 'countdown) into Notifications.json. Replaces previous restart warnings; other '
        + 'notifications are kept.';
      wrapper.appendChild(hint);

      const syncBtn = document.createElement('button');
      syncBtn.type = 'button';
      syncBtn.className = 'sync-notify-btn';
      syncBtn.textContent = '⟳ Sync server notifications';
      syncBtn.addEventListener('click', async () => {
        const times = input.value.split('\n').map((s) => s.trim()).filter(Boolean);
        const msgEl = document.getElementById('settings-message');
        if (!times.length) {
          if (msgEl) { msgEl.textContent = 'Add at least one restart time first.'; msgEl.className = 'settings-message error'; }
          return;
        }
        syncBtn.disabled = true;
        try {
          const res = await fetch('/api/game-config/sync-restart-notifications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ times }),
          });
          const data = await res.json().catch(() => ({}));
          if (msgEl) {
            if (res.ok) {
              msgEl.textContent = `Synced ${data.count} restart warning${data.count === 1 ? '' : 's'} to Notifications.json. Applied live — no restart needed.`;
              msgEl.className = 'settings-message success';
            } else {
              msgEl.textContent = `Sync failed: ${data.error || res.statusText}`;
              msgEl.className = 'settings-message error';
            }
          }
        } catch (err) {
          if (msgEl) { msgEl.textContent = `Sync failed: ${err.message}`; msgEl.className = 'settings-message error'; }
        } finally {
          syncBtn.disabled = false;
        }
      });
      wrapper.appendChild(syncBtn);
    }

    return wrapper;
  }

  function buildGroup(title, obj, pathArr) {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'settings-group';
    const legend = document.createElement('legend');
    legend.textContent = title;
    fieldset.appendChild(legend);

    for (const [key, value] of Object.entries(obj)) {
      const childPath = pathArr.concat(key);
      if (isPlainObject(value)) {
        fieldset.appendChild(buildGroup(humanize(key), value, childPath));
      } else {
        fieldset.appendChild(buildField(key, value, childPath));
      }
    }
    return fieldset;
  }

  // Ordered category map: groups the flat config.json keys into readable sections.
  // Any key not listed here is collected into a final "Advanced" section so nothing is lost.
  const SETTINGS_CATEGORIES = [
    { title: 'Server & Paths', desc: 'Core identifiers and install paths — change with care.',
      keys: ['serviceName', 'appId', 'serverDir', 'savedDir', 'backupRoot', 'steamCmd', 'nssmPath'] },
    { title: 'Network & Launch', desc: 'Public address and SCUM server launch arguments.',
      keys: ['publicIP', 'publicPort', 'serverArgs'] },
    { title: 'Restarts & Recovery', desc: 'Scheduled restarts, timeouts and automatic crash recovery.',
      keys: ['restartTimes', 'autoRestart', 'autoRestartCooldownMinutes', 'maxConsecutiveRestartAttempts', 'serverStartupTimeoutMinutes', 'serverShutdownTimeoutMinutes'] },
    { title: 'Backups', desc: 'Automatic, periodic and pre-restart backups.',
      keys: ['periodicBackupEnabled', 'backupIntervalMinutes', 'maxBackups', 'compressBackups', 'runBackupOnStart', 'preRestartBackupEnabled'] },
    { title: 'Updates', desc: 'Game build update checks and apply delay.',
      keys: ['runUpdateOnStart', 'updateCheckIntervalMinutes', 'updateDelayMinutes'] },
    { title: 'Monitoring & Performance', desc: 'Status polling cadence and FPS performance alerts.',
      keys: ['monitoringIntervalSeconds', 'logMonitoringEnabled', 'logMonitoringIntervalSeconds', 'preventStatusRegression', 'performanceAlertThreshold', 'performanceAlertCooldownMinutes', 'performanceLogIntervalMinutes', 'performanceThresholds'] },
    { title: 'Logging', desc: 'Manager log file detail, size and rotation.',
      keys: ['enableDetailedLogging', 'maxLogFileSizeMB', 'logRotationEnabled', 'consoleLogLevel', 'customLogPath'] },
    { title: 'Web Panel', desc: 'This dashboard — port and toggle.',
      keys: ['web'] },
    { title: 'Discord Bot', desc: 'Presence, notifications, live embeds and chat relay.',
      keys: ['Discord'] },
    { title: 'Discord Log Feeds', desc: 'Per-feature SCUM log feeds and their channels.',
      keys: ['SCUMLogFeatures'] },
  ];

  function buildCategory(cat, cfg, openByDefault) {
    const details = document.createElement('details');
    details.className = 'settings-category';
    if (openByDefault) details.open = true;

    const summary = document.createElement('summary');
    summary.className = 'settings-cat-summary';
    const title = document.createElement('span');
    title.className = 'settings-cat-title';
    title.textContent = cat.title;
    summary.appendChild(title);
    if (cat.desc) {
      const desc = document.createElement('span');
      desc.className = 'settings-cat-desc';
      desc.textContent = cat.desc;
      summary.appendChild(desc);
    }
    details.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'settings-cat-body';
    for (const key of cat.present) {
      const value = cfg[key];
      if (isPlainObject(value)) body.appendChild(buildGroup(humanize(key), value, [key]));
      else body.appendChild(buildField(key, value, [key]));
    }
    details.appendChild(body);
    return details;
  }

  async function loadSettings() {
    const form = document.getElementById('settings-form');
    form.innerHTML = '';
    const searchEl = document.getElementById('settings-search');
    if (searchEl) searchEl.value = '';
    const msgEl = document.getElementById('settings-message');
    if (msgEl) { msgEl.textContent = ''; msgEl.className = 'settings-message'; }
    try {
      const res = await fetch('/api/config');
      if (!res.ok) {
        if (msgEl) { msgEl.textContent = 'Could not load settings (not authenticated).'; msgEl.className = 'settings-message error'; }
        return;
      }
      const cfg = await res.json();

      const used = new Set();
      const categories = [];
      for (const cat of SETTINGS_CATEGORIES) {
        const present = cat.keys.filter((k) => k in cfg);
        if (!present.length) continue;
        present.forEach((k) => used.add(k));
        categories.push({ ...cat, present });
      }
      const leftover = Object.keys(cfg).filter((k) => !used.has(k));
      if (leftover.length) {
        categories.push({ title: 'Advanced', desc: 'Other settings not in a category above.', present: leftover });
      }

      categories.forEach((cat, i) => {
        form.appendChild(buildCategory(cat, cfg, i === 0));
      });
    } catch (err) {
      if (msgEl) {
        msgEl.textContent = `Failed to load settings: ${err.message}. The server may not be running on the configured port.`;
        msgEl.className = 'settings-message error';
      }
    }
  }

  // Live filter for any categorized settings form (config or INI): show only
  // fields matching the term, auto-opening the categories that contain them.
  function filterSettingsForm(form, term) {
    if (!form) return;
    const t = (term || '').trim().toLowerCase();

    form.querySelectorAll('.settings-field').forEach((field) => {
      const label = field.querySelector('label');
      const input = field.querySelector('[data-path], [data-ini-key]');
      const keyAttr = input ? (input.dataset.path || input.dataset.iniKey || '') : '';
      const haystack = `${label ? label.textContent : ''} ${keyAttr}`.toLowerCase();
      field.classList.toggle('filtered-hidden', !!t && !haystack.includes(t));
    });

    form.querySelectorAll('.settings-group').forEach((group) => {
      const hasVisible = group.querySelector('.settings-field:not(.filtered-hidden)');
      group.classList.toggle('filtered-hidden', !hasVisible);
    });

    form.querySelectorAll('.settings-category').forEach((cat, i) => {
      const hasVisible = cat.querySelector('.settings-field:not(.filtered-hidden)');
      cat.classList.toggle('filtered-hidden', !!t && !hasVisible);
      cat.open = t ? !!hasVisible : (i === 0);
    });
  }

  function applySettingsFilter(term) {
    filterSettingsForm(document.getElementById('settings-form'), term);
  }

  function setNested(target, pathArr, value) {
    let node = target;
    for (let i = 0; i < pathArr.length - 1; i++) {
      const key = pathArr[i];
      if (!isPlainObject(node[key])) node[key] = {};
      node = node[key];
    }
    node[pathArr[pathArr.length - 1]] = value;
  }

  function collectSettingsForm() {
    const form = document.getElementById('settings-form');
    const result = {};
    form.querySelectorAll('[data-path]').forEach((input) => {
      const pathArr = JSON.parse(input.dataset.path);
      let value;
      switch (input.dataset.type) {
        case 'boolean':
          value = input.checked;
          break;
        case 'number':
          value = input.value === '' ? null : Number(input.value);
          break;
        case 'array':
          value = input.value.split('\n');
          break;
        case 'string-or-null':
          value = input.value === '' ? null : input.value;
          break;
        default:
          value = input.value;
      }
      setNested(result, pathArr, value);
    });
    return result;
  }

  document.getElementById('settings-btn').addEventListener('click', () => {
    dashboardScreen.classList.add('hidden');
    settingsScreen.classList.remove('hidden');
    document.getElementById('settings-message').textContent = '';
    document.getElementById('settings-message').className = 'settings-message';
    loadSettings();
  });

  document.getElementById('settings-close-btn').addEventListener('click', () => {
    settingsScreen.classList.add('hidden');
    dashboardScreen.classList.remove('hidden');
  });

  document.getElementById('settings-search').addEventListener('input', (e) => {
    applySettingsFilter(e.target.value);
  });

  document.getElementById('settings-expand-all').addEventListener('click', () => {
    document.querySelectorAll('#settings-form .settings-category').forEach((c) => { c.open = true; });
  });

  document.getElementById('settings-collapse-all').addEventListener('click', () => {
    document.querySelectorAll('#settings-form .settings-category').forEach((c) => { c.open = false; });
  });

  document.getElementById('settings-form').addEventListener('submit', (e) => e.preventDefault());

  document.getElementById('settings-save-btn').addEventListener('click', async () => {
    const message = document.getElementById('settings-message');
    message.textContent = 'Saving...';
    message.className = 'settings-message';
    try {
      const updates = collectSettingsForm();
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (res.ok) {
        message.textContent = 'Saved. Restart the Node process for changes to take full effect.';
        message.className = 'settings-message success';
      } else {
        message.textContent = `Failed to save: ${data.error || 'unknown error'}`;
        message.className = 'settings-message error';
      }
    } catch (err) {
      message.textContent = `Failed to save: ${err.message}`;
      message.className = 'settings-message error';
    }
  });
  // --- Game Settings editor ---

  const gameSettingsScreen = document.getElementById('game-settings-screen');
  const gameSettingsMessage = document.getElementById('game-settings-message');

  function showGameSettings() {
    dashboardScreen.classList.add('hidden');
    gameSettingsScreen.classList.remove('hidden');
    gameSettingsMessage.textContent = '';
    gameSettingsMessage.className = 'settings-message';
    loadGameSettings();
  }

  function hideGameSettings() {
    gameSettingsScreen.classList.add('hidden');
    dashboardScreen.classList.remove('hidden');
    gameSettingsLoaded = false;
  }

  document.getElementById('game-settings-btn').addEventListener('click', showGameSettings);
  document.getElementById('game-settings-close-btn').addEventListener('click', hideGameSettings);

  // Tab switching
  document.querySelectorAll('.gs-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.gs-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.gs-tab-content').forEach((c) => c.classList.add('hidden'));
      const tabId = `gs-tab-${btn.dataset.tab}`;
      document.getElementById(tabId).classList.remove('hidden');
    });
  });

  function gsShowMessage(text, isError) {
    gameSettingsMessage.textContent = text;
    gameSettingsMessage.className = `settings-message${isError ? ' error' : ' success'}`;
  }

  // Per-setting metadata (type / unit / description / range) parsed from the
  // community ServerSettings reference sheet. Loaded lazily before rendering.
  let serverSettingsMeta = null;
  async function ensureServerSettingsMeta() {
    if (serverSettingsMeta) return;
    try {
      const res = await fetch('serverSettingsMeta.json');
      serverSettingsMeta = res.ok ? await res.json() : {};
    } catch {
      serverSettingsMeta = {};
    }
  }

  // INI rendering
  function buildIniField(flatKey, value) {
    const wrapper = document.createElement('div');
    const sepIdx = flatKey.indexOf('||');
    const rawKey = sepIdx >= 0 ? flatKey.slice(sepIdx + 2) : flatKey;
    // Strip "word." namespace prefix (e.g. "scum." in "scum.MaxPlayers")
    const shortKey = rawKey.replace(/^\w+\./, '');
    const meta = serverSettingsMeta ? (serverSettingsMeta[rawKey] || serverSettingsMeta[shortKey]) : null;

    const label = document.createElement('label');
    label.textContent = humanize(shortKey);
    label.title = rawKey; // show full key on hover
    if (meta && meta.unit) {
      const badge = document.createElement('span');
      badge.className = 'ini-type';
      badge.textContent = meta.unit;
      label.appendChild(badge);
    }

    // Render type comes from the reference metadata when known; otherwise it
    // falls back to the value's own JS type.
    let renderType;
    if (meta) renderType = meta.type;
    else renderType = typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string';

    let input;
    if (renderType === 'boolean') {
      wrapper.className = 'settings-field checkbox';
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = value === true || value === 1 || /^true$/i.test(String(value));
      input.dataset.type = 'boolean';
      wrapper.appendChild(input);
      wrapper.appendChild(label);
    } else if (renderType === 'number') {
      wrapper.className = 'settings-field';
      input = document.createElement('input');
      input.type = 'number';
      input.value = value;
      input.dataset.type = 'number';
      input.step = 'any';
      if (meta && meta.min !== undefined) input.min = meta.min;
      if (meta && meta.max !== undefined) input.max = meta.max;
      wrapper.appendChild(label);
      wrapper.appendChild(input);
    } else {
      wrapper.className = 'settings-field';
      input = document.createElement('input');
      input.type = 'text';
      input.value = value ?? '';
      input.dataset.type = 'string';
      wrapper.appendChild(label);
      wrapper.appendChild(input);
    }

    if (meta && meta.desc) {
      const desc = document.createElement('small');
      desc.className = 'ini-desc';
      let txt = meta.desc;
      if (renderType === 'number' && (meta.min !== undefined || meta.max !== undefined)) {
        const range = [meta.min, meta.max].filter((v) => v !== undefined).join('–');
        if (range) txt += `  ·  range ${range}`;
      }
      desc.textContent = txt;
      wrapper.appendChild(desc);
    }

    input.dataset.iniKey = flatKey;
    return wrapper;
  }

  function renderIniForm(formEl, values) {
    formEl.innerHTML = '';
    const sections = {};
    for (const [flatKey, value] of Object.entries(values)) {
      const sepIdx = flatKey.indexOf('||');
      const sectionName = sepIdx >= 0 ? flatKey.slice(0, sepIdx) : 'General';
      if (!sections[sectionName]) sections[sectionName] = [];
      sections[sectionName].push([flatKey, value]);
    }

    Object.entries(sections).forEach(([sectionName, fields], i) => {
      const details = document.createElement('details');
      details.className = 'settings-category';
      if (i === 0) details.open = true;

      const summary = document.createElement('summary');
      summary.className = 'settings-cat-summary';
      const title = document.createElement('span');
      title.className = 'settings-cat-title';
      // Strip path prefix (e.g. "/Script/SCUM.SGameplaySettings" → "Gameplay Settings")
      const cleanName = sectionName.replace(/^.*[/.]/, '').replace(/^S([A-Z])/, '$1');
      title.textContent = humanize(cleanName) || sectionName;
      summary.appendChild(title);
      const desc = document.createElement('span');
      desc.className = 'settings-cat-desc';
      desc.textContent = `${sectionName} · ${fields.length} setting${fields.length === 1 ? '' : 's'}`;
      summary.appendChild(desc);
      details.appendChild(summary);

      const body = document.createElement('div');
      body.className = 'settings-cat-body';
      for (const [flatKey, value] of fields) {
        body.appendChild(buildIniField(flatKey, value));
      }
      details.appendChild(body);
      formEl.appendChild(details);
    });
  }

  function collectIniForm(formEl) {
    const result = {};
    formEl.querySelectorAll('[data-ini-key]').forEach((input) => {
      const key = input.dataset.iniKey;
      if (input.dataset.type === 'boolean') result[key] = input.checked;
      else if (input.dataset.type === 'number') result[key] = input.value === '' ? null : Number(input.value);
      else result[key] = input.value;
    });
    return result;
  }

  async function loadIniTab(key, formId) {
    try {
      if (key === 'server-settings') await ensureServerSettingsMeta();
      const res = await fetch(`/api/game-config/ini/${key}`);
      const formEl = document.getElementById(formId);
      if (res.status === 404) {
        formEl.innerHTML = '<p class="info">Configuration file not found. Start the SCUM server at least once to generate the default config files, then reload this page.</p>';
        return;
      }
      if (!res.ok) {
        formEl.innerHTML = `<p class="error">Could not load: ${(await res.json()).error || res.status}</p>`;
        return;
      }
      const { values } = await res.json();
      renderIniForm(formEl, values);
      const ssSearch = document.getElementById('gs-ss-search');
      if (formId === 'gs-server-settings-form' && ssSearch) ssSearch.value = '';
    } catch (err) {
      document.getElementById(formId).innerHTML = `<p class="error">Failed to fetch settings: ${err.message}</p>`;
    }
  }

  async function saveIniTab(key, formId) {
    const updates = collectIniForm(document.getElementById(formId));
    try {
      const res = await fetch(`/api/game-config/ini/${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (res.ok) gsShowMessage('Saved. Restart the server for changes to take effect.');
      else gsShowMessage(`Failed to save: ${data.error || 'unknown error'}`, true);
    } catch (err) {
      gsShowMessage(`Failed to save: ${err.message}`, true);
    }
  }

  document.getElementById('gs-server-settings-save').addEventListener('click', () => saveIniTab('server-settings', 'gs-server-settings-form'));

  document.getElementById('gs-ss-search').addEventListener('input', (e) => {
    filterSettingsForm(document.getElementById('gs-server-settings-form'), e.target.value);
  });
  document.getElementById('gs-ss-expand').addEventListener('click', () => {
    document.querySelectorAll('#gs-server-settings-form .settings-category').forEach((c) => { c.open = true; });
  });
  document.getElementById('gs-ss-collapse').addEventListener('click', () => {
    document.querySelectorAll('#gs-server-settings-form .settings-category').forEach((c) => { c.open = false; });
  });

  // User lists
  async function loadList(key, textareaId) {
    try {
      const res = await fetch(`/api/game-config/list/${key}`);
      if (!res.ok) return;
      const { lines } = await res.json();
      document.getElementById(textareaId).value = lines.join('\n');
    } catch {}
  }

  async function saveList(key, textareaId) {
    const lines = document.getElementById(textareaId).value
      .split('\n').map((l) => l.trimEnd()).filter((l) => l !== '');
    try {
      const res = await fetch(`/api/game-config/list/${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines }),
      });
      const data = await res.json();
      if (res.ok) gsShowMessage('User list saved.');
      else gsShowMessage(`Failed to save: ${data.error || 'unknown error'}`, true);
    } catch (err) {
      gsShowMessage(`Failed to save: ${err.message}`, true);
    }
  }

  document.querySelectorAll('.gs-save-btn[data-list]').forEach((btn) => {
    btn.addEventListener('click', () => saveList(btn.dataset.list, `gs-list-${btn.dataset.list}`));
  });

  // Raw-JSON editors (EconomyOverride.json, RaidTimes.json, Notifications.json)
  function jsonEls(key) {
    return {
      ta: document.querySelector(`.gs-json-textarea[data-json="${key}"]`),
      err: document.querySelector(`.gs-json-error[data-json="${key}"]`),
    };
  }

  function setJsonError(err, text, ok) {
    err.textContent = text;
    err.classList.remove('hidden');
    err.classList.toggle('error', !ok);
    err.classList.toggle('success', !!ok);
  }

  async function loadJson(key) {
    const { ta } = jsonEls(key);
    if (!ta) return;
    try {
      const res = await fetch(`/api/game-config/json/${key}`);
      if (!res.ok) {
        ta.value = '{}';
        return;
      }
      ta.value = JSON.stringify(await res.json(), null, '\t');
    } catch {}
  }

  document.querySelectorAll('.gs-json-validate').forEach((btn) => {
    btn.addEventListener('click', () => {
      const { ta, err } = jsonEls(btn.dataset.json);
      try {
        JSON.parse(ta.value);
        setJsonError(err, 'JSON is valid.', true);
      } catch (e) {
        setJsonError(err, `Invalid JSON: ${e.message}`, false);
      }
    });
  });

  document.querySelectorAll('.gs-json-save').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.json;
      const { ta, err } = jsonEls(key);
      err.classList.add('hidden');
      let obj;
      try {
        obj = JSON.parse(ta.value);
      } catch (e) {
        setJsonError(err, `Invalid JSON: ${e.message}`, false);
        return;
      }
      try {
        const res = await fetch(`/api/game-config/json/${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(obj),
        });
        const data = await res.json();
        if (res.ok) gsShowMessage('Saved. Restart the server for changes to take effect.');
        else gsShowMessage(`Failed to save: ${data.error || 'unknown error'}`, true);
      } catch (err2) {
        gsShowMessage(`Failed to save: ${err2.message}`, true);
      }
    });
  });

  let gameSettingsLoaded = false;

  function loadGameSettings() {
    if (gameSettingsLoaded) return;
    gameSettingsLoaded = true;
    loadIniTab('server-settings', 'gs-server-settings-form');
    loadList('admin-users', 'gs-list-admin-users');
    loadList('banned-users', 'gs-list-banned-users');
    loadList('exclusive-users', 'gs-list-exclusive-users');
    loadList('whitelisted-users', 'gs-list-whitelisted-users');
    loadJson('economy');
    loadJson('raid-times');
    loadJson('notifications');
  }

  // --- Discord management screen ---

  const discordScreen = document.getElementById('discord-screen');
  const discordMessage = document.getElementById('discord-message');

  function showDiscordScreen() {
    dashboardScreen.classList.add('hidden');
    discordScreen.classList.remove('hidden');
    discordMessage.textContent = '';
    loadLinkedProfiles();
  }

  function hideDiscordScreen() {
    discordScreen.classList.add('hidden');
    dashboardScreen.classList.remove('hidden');
  }

  document.getElementById('discord-btn').addEventListener('click', showDiscordScreen);
  document.getElementById('discord-close-btn').addEventListener('click', hideDiscordScreen);

  async function loadLinkedProfiles() {
    const countEl = document.getElementById('dc-linked-count');
    const tbody = document.getElementById('dc-linked-tbody');
    tbody.innerHTML = '';
    countEl.textContent = 'Loading…';
    try {
      const res = await fetch('/api/account-linking/profiles');
      if (!res.ok) { countEl.textContent = 'Failed to load.'; return; }
      const { profiles } = await res.json();
      countEl.textContent = `${profiles.length} linked account${profiles.length !== 1 ? 's' : ''}`;
      if (!profiles.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="padding:8px;color:#888">No linked accounts yet.</td></tr>';
        return;
      }
      for (const p of profiles) {
        const tr = document.createElement('tr');
        const ts = p.linked_at ? new Date(p.linked_at).toLocaleString() : '-';
        tr.innerHTML = `<td style="padding:4px 8px">${esc(p.discord_username)}</td><td style="padding:4px 8px">${esc(p.player_name || '-')}</td><td style="padding:4px 8px;font-family:monospace;font-size:.8em">${esc(p.steam_id)}</td><td style="padding:4px 8px;font-size:.8em">${ts}</td>`;
        tbody.appendChild(tr);
      }
    } catch (err) {
      countEl.textContent = `Error: ${err.message}`;
    }
  }

  function esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  document.getElementById('dc-panel-post-btn').addEventListener('click', async () => {
    const channelId = document.getElementById('dc-panel-channel').value.trim();
    const updateMessageId = document.getElementById('dc-panel-msgid').value.trim();
    const resultEl = document.getElementById('dc-panel-result');
    resultEl.textContent = '';
    if (!channelId) { resultEl.textContent = 'Channel ID is required.'; resultEl.style.color = '#ed4245'; return; }
    resultEl.textContent = 'Posting…';
    resultEl.style.color = '#aaa';
    try {
      const body = { channelId };
      if (updateMessageId) body.updateMessageId = updateMessageId;
      const res = await fetch('/api/account-linking/panel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        resultEl.textContent = `Panel ${data.operation} — Message ID: ${data.messageId}`;
        resultEl.style.color = '#57f287';
        document.getElementById('dc-panel-msgid').value = data.messageId;
      } else {
        resultEl.textContent = `Failed: ${data.error || 'unknown error'}`;
        resultEl.style.color = '#ed4245';
      }
    } catch (err) {
      resultEl.textContent = `Error: ${err.message}`;
      resultEl.style.color = '#ed4245';
    }
  });

}());
