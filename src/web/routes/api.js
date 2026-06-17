'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const logger = require('../../core/logger');
const events = require('../../core/events');
const { config, paths } = require('../../core/config');
const { schedulingState } = require('../../core/state');
const service = require('../../server/service');
const monitoring = require('../../server/monitoring');
const backup = require('../../automation/backup');
const scheduling = require('../../automation/scheduling');
const update = require('../../automation/update');
const database = require('../../database');

const router = express.Router();

function readLastLines(filePath, count) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
  return lines.slice(-count);
}

router.get('/status', async (req, res) => {
  try {
    const status = await monitoring.getServerStatus();
    res.json(status);
  } catch (err) {
    logger.error(`[API] /status error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.post('/control/start', async (req, res) => {
  try {
    const ok = await service.startGameService(config.serviceName, 'manual start via web panel');
    res.json({ success: ok });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/control/stop', async (req, res) => {
  try {
    const ok = await service.stopGameService(config.serviceName, 'manual stop via web panel');
    res.json({ success: ok });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/control/restart', async (req, res) => {
  try {
    const ok = await service.restartGameService(config.serviceName, 'manual restart via web panel');
    res.json({ success: ok });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/control/backup', async (req, res) => {
  try {
    const fileName = await backup.createBackup();
    res.json({ success: true, fileName });
  } catch (err) {
    logger.error(`[API] Backup failed: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/backups', (req, res) => {
  try {
    res.json(backup.listBackups());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/backups/stats', (req, res) => {
  try {
    res.json(backup.getBackupStatistics());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/scheduling', (req, res) => {
  try {
    res.json(scheduling.getSchedulingStats(schedulingState.restartWarningState));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/control/restart-skip', (req, res) => {
  try {
    const skip = req.body && typeof req.body.skip === 'boolean'
      ? req.body.skip
      : !scheduling.getRestartSkipStatus();

    let cancelledManual = false;
    if (skip) {
      // "Skip next restart" cancels whichever restart is next: if a manual
      // /server-restart is pending, that's the next one — cancel it. Otherwise
      // flag the next scheduled restart to be skipped.
      cancelledManual = scheduling.cancelPendingManual('restart');
      if (cancelledManual) {
        events.emit('notification', {
          type: 'server.scheduledRestart',
          data: { event: 'The pending restart was cancelled by an admin.' },
        });
      } else {
        scheduling.setRestartSkip();
      }
    } else {
      scheduling.clearRestartSkip();
    }

    res.json({ success: true, skip: scheduling.getRestartSkipStatus(), cancelledManual });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/update/status', async (req, res) => {
  try {
    if (schedulingState.updateStatus) {
      res.json({ ...schedulingState.updateStatus, LastCheck: schedulingState.lastUpdateCheck, InProgress: schedulingState.updateInProgress });
      return;
    }
    const status = await update.getUpdateStatus(paths.steamCmd, paths.serverDir, config.appId);
    res.json({ ...status, InProgress: schedulingState.updateInProgress });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/control/update', async (req, res) => {
  if (schedulingState.updateInProgress) {
    res.status(409).json({ success: false, error: 'Update already in progress' });
    return;
  }

  res.json({ success: true, started: true });

  schedulingState.updateInProgress = true;
  try {
    const result = await update.invokeImmediateUpdate(paths.steamCmd, paths.serverDir, config.appId, config.serviceName);
    if (!result.Success && result.Error !== 'No update available') {
      logger.error(`[API] Manual update failed: ${result.Error}`);
    }
  } catch (err) {
    logger.error(`[API] Manual update failed: ${err.message}`);
  } finally {
    schedulingState.updateInProgress = false;
    schedulingState.updateStatus = await update.getUpdateStatus(paths.steamCmd, paths.serverDir, config.appId).catch(() => null);
  }
});

router.post('/control/validate', async (req, res) => {
  try {
    const result = await update.invokeServerValidation(paths.steamCmd, paths.serverDir, config.appId, config.serviceName);
    res.json(result);
  } catch (err) {
    res.status(500).json({ Success: false, Error: err.message });
  }
});

router.get('/leaderboards', (req, res) => {
  try {
    if (!database.isScumDbAvailable()) {
      res.json({ available: false, categories: database.listCategories(), leaderboards: {} });
      return;
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const weekly = req.query.weekly === '1' || req.query.weekly === 'true';
    res.json({ available: true, categories: database.listCategories(), leaderboards: database.getAllLeaderboards(limit, weekly) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/leaderboards/:category', (req, res) => {
  try {
    if (!database.isScumDbAvailable()) {
      res.json({ available: false, data: [] });
      return;
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const weekly = req.query.weekly === '1' || req.query.weekly === 'true';
    res.json({ available: true, data: database.getLeaderboard(req.params.category, limit, weekly) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/players', (req, res) => {
  try {
    if (!database.isScumDbAvailable()) {
      res.json({ available: false, players: [] });
      return;
    }
    res.json({ available: true, players: database.getOnlinePlayers() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/players/search', (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) { res.json({ players: [] }); return; }
    if (!database.isScumDbAvailable()) { res.json({ available: false, players: [] }); return; }
    res.json({ available: true, players: database.searchPlayersByName(q) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/players/:name', (req, res) => {
  try {
    if (!database.isScumDbAvailable()) { res.json({ available: false }); return; }
    const stats = database.getPlayerStatsByName(req.params.name);
    if (!stats) { res.status(404).json({ error: 'Player not found' }); return; }
    const profile = database.getPlayerProfileByName(req.params.name);
    res.json({ available: true, stats, profile: profile || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/game-stats', (req, res) => {
  try {
    if (!database.isScumDbAvailable()) {
      res.json({ available: false });
      return;
    }
    res.json({
      available: true,
      statistics: database.getServerStatistics(),
      gameTime: database.getGameTimeData(),
      weather: database.getWeatherData(),
      activeSquads: database.getActiveSquadCount(),
      vehicles: database.getVehicleCount(),
      bases: database.getBaseCount(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/logs/tail', (req, res) => {
  const lines = Math.min(parseInt(req.query.lines, 10) || 200, 2000);
  const source = req.query.source === 'app' ? paths.appLogFile : paths.logPath;
  res.json({ lines: readLastLines(source, lines) });
});

router.get('/config', (req, res) => {
  // Discord token and web/session secrets live in .env, not here.
  res.json(config);
});

/**
 * Recursively merge `source` into `target`, in place. Plain objects are
 * merged key-by-key; arrays and primitives overwrite.
 */
function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

router.post('/config', (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return res.status(400).json({ error: 'Request body must be a JSON object' });
  }

  try {
    deepMerge(config, updates);
    const configFile = path.join(paths.root, 'config', 'config.json');
    fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
    logger.info('[API] config.json updated via web panel');

    // If the SCUM launch arguments changed, push them to the NSSM service now so
    // they apply on the next server restart without any manual nssm edit.
    if (updates.serverArgs) {
      service.updateServiceAppParameters()
        .catch((err) => logger.warn(`[API] Failed to sync service launch args: ${err.message}`));
    }

    res.json({ success: true, restartRequired: true, config });
  } catch (err) {
    logger.error(`[API] Failed to save config: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.get('/account-linking/profiles', (req, res) => {
  try {
    const db = database.getServerDb();
    const rows = db.prepare(
      `SELECT discord_user_id, discord_username, steam_id, player_name, linked_at
       FROM a_discord_profiles ORDER BY linked_at DESC LIMIT 200`
    ).all();
    res.json({ profiles: rows });
  } catch (err) {
    logger.error(`[API] account-linking/profiles error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.post('/account-linking/panel', async (req, res) => {
  try {
    const { peekClient } = require('../../discord/client');
    const client = peekClient();
    if (!client) return res.status(503).json({ error: 'Discord bot not ready' });

    const { channelId, updateMessageId } = req.body || {};
    if (!channelId) return res.status(400).json({ error: 'channelId is required' });

    const { sendLinkingPanel } = require('../../discord/slashCommands');
    const result = await sendLinkingPanel(client, channelId, updateMessageId || null);
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error(`[API] account-linking/panel error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
