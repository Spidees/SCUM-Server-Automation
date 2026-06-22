'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const events = require('../../core/events');

const router = express.Router();

let installRunning = false;

router.get('/status', (req, res) => {
  const { isSetupNeeded } = require('../../setup');
  res.json({ needsSetup: isSetupNeeded() });
});

router.post('/save', (req, res) => {
  try {
    const { saveSetup } = require('../../setup');
    const { reloadConfig, env } = require('../../core/config');
    const {
      serverDir, backupRoot, publicIP, serviceName, serverPort, queryPort, maxPlayers, noBattleye, customArgs,
      webPort, webPassword, discordToken, guildId,
    } = req.body || {};

    if (!serverDir) return res.status(400).json({ error: 'Server directory is required.' });
    if (!webPassword) return res.status(400).json({ error: 'Admin password is required.' });

    saveSetup({
      serverDir, backupRoot, publicIP, serviceName, serverPort, queryPort, maxPlayers, noBattleye, customArgs,
      webPort, webPassword, discordToken, guildId,
    });
    reloadConfig();

    // Auto-authenticate the current browser session
    req.session.authenticated = true;

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/install-status', (req, res) => {
  const { paths } = require('../../core/config');
  const serverExePath = path.join(paths.serverDir || '', 'SCUM', 'Binaries', 'Win64', 'SCUMServer.exe');
  res.json({
    needed: !fs.existsSync(serverExePath),
    running: installRunning,
  });
});

router.post('/install', (req, res) => {
  if (installRunning) return res.json({ alreadyRunning: true });

  installRunning = true;
  res.json({ started: true });

  const installation = require('../../server/installation');
  installation.invokeFirstInstall({
    onProgress: (data) => events.emit('install:progress', data),
  }).then(() => {
    events.emit('install:complete');
  }).catch((err) => {
    events.emit('install:progress', { step: 'error', message: `Installation failed: ${err.message}`, error: true });
  }).finally(() => {
    installRunning = false;
  });
});

module.exports = router;
