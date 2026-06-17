'use strict';

const logger = require('./core/logger');
const events = require('./core/events');
const { config, paths } = require('./core/config');
const { schedulingState } = require('./core/state');
const installation = require('./server/installation');
const service = require('./server/service');
const logParser = require('./server/logParser');
const monitoring = require('./server/monitoring');
const backup = require('./automation/backup');
const scheduling = require('./automation/scheduling');
const update = require('./automation/update');
const database = require('./database');
const discord = require('./discord');
const { startWebServer } = require('./web/server');

let monitorTimer = null;
let schedulingTimer = null;
let backupTimer = null;
let updateCheckTimer = null;
let weeklyResetTimer = null;

/**
 * Re-check the next scheduled restart against the warning state and run/skip
 * the restart if it's due. Mirrors the scheduling loop in the PS main script.
 */
async function schedulingTick() {
  if (!schedulingState.restartWarningState) return;
  try {
    schedulingState.restartWarningState = scheduling.updateRestartWarnings(schedulingState.restartWarningState);
    schedulingState.restartWarningState = await scheduling.invokeScheduledRestart(schedulingState.restartWarningState, config.serviceName);
  } catch (err) {
    logger.error(`[Index] Scheduling tick failed: ${err.message}`);
  }
}

/**
 * Check Steam for a newer build and, if found, apply it (with the configured
 * delay-warning system). Mirrors the update-check loop in the PS main script.
 */
async function checkForUpdates(applyImmediately = true) {
  if (schedulingState.updateInProgress) return;

  try {
    const status = await update.testUpdateAvailable(paths.steamCmd, paths.serverDir, config.appId);
    schedulingState.lastUpdateCheck = new Date();
    schedulingState.updateStatus = status;

    if (status.UpdateAvailable) {
      events.emit('notification', {
        type: 'update.available',
        data: { installedVersion: status.InstalledBuild, latestVersion: status.LatestBuild },
      });

      if (applyImmediately) {
        schedulingState.updateInProgress = true;
        try {
          await update.invokeImmediateUpdate(paths.steamCmd, paths.serverDir, config.appId, config.serviceName);
        } finally {
          schedulingState.updateInProgress = false;
          schedulingState.updateStatus = await update.getUpdateStatus(paths.steamCmd, paths.serverDir, config.appId);
        }
      }
    }
  } catch (err) {
    logger.error(`[Index] Update check failed: ${err.message}`);
  }
}

async function startAllServices() {
  logParser.initializeLogReaderModule(paths.logPath);

  const intervalMs = (config.monitoringIntervalSeconds || 1) * 1000;
  let monitoringBusy = false;
  monitorTimer = setInterval(() => {
    // Skip if the previous tick hasn't finished — a tick makes several slow
    // sc/process queries and can run longer than the interval. Overlapping ticks
    // would each detect the same service transition and send duplicate notifications.
    if (monitoringBusy) return;
    monitoringBusy = true;
    monitoring.updateServerMonitoring()
      .catch((err) => logger.error(`[Index] Monitoring tick failed: ${err.message}`))
      .finally(() => { monitoringBusy = false; });
  }, intervalMs);
  logger.info(`[Index] Monitoring loop started (every ${config.monitoringIntervalSeconds || 1}s)`);

  schedulingState.restartWarningState = scheduling.initializeRestartWarningSystem(config.restartTimes || []);
  if (schedulingState.restartWarningState.NextRestartTime) {
    logger.info(`[Index] Next scheduled restart: ${schedulingState.restartWarningState.NextRestartTime.toLocaleString()}`);
  }
  schedulingTimer = setInterval(() => {
    schedulingTick().catch((err) => logger.error(`[Index] Scheduling tick failed: ${err.message}`));
  }, 15 * 1000);

  if (config.runBackupOnStart) {
    backup.createBackup('automatic').catch((err) => logger.error(`[Index] Startup backup failed: ${err.message}`));
  }
  if (config.periodicBackupEnabled) {
    const backupIntervalMs = (config.backupIntervalMinutes || 60) * 60 * 1000;
    backupTimer = setInterval(() => {
      backup.createBackup('automatic').catch((err) => logger.error(`[Index] Periodic backup failed: ${err.message}`));
    }, backupIntervalMs);
    logger.info(`[Index] Periodic backups enabled (every ${config.backupIntervalMinutes || 60} minutes)`);
  }

  if (config.runUpdateOnStart) {
    checkForUpdates(true).catch((err) => logger.error(`[Index] Startup update check failed: ${err.message}`));
  }
  if (config.updateCheckIntervalMinutes > 0) {
    const updateIntervalMs = config.updateCheckIntervalMinutes * 60 * 1000;
    updateCheckTimer = setInterval(() => {
      checkForUpdates(true).catch((err) => logger.error(`[Index] Update check failed: ${err.message}`));
    }, updateIntervalMs);
    logger.info(`[Index] Update checks enabled (every ${config.updateCheckIntervalMinutes} minutes)`);
  }

  if (database.isScumDbAvailable()) {
    logger.info(`[Index] SCUM database found at: ${database.getScumDbPath()}`);
    if (database.testWeeklyResetNeeded()) {
      database.invokeWeeklyReset();
    }
  } else {
    logger.warn('[Index] SCUM database not found yet - leaderboards will be unavailable until the server has run');
  }
  weeklyResetTimer = setInterval(() => {
    try {
      if (database.isScumDbAvailable() && database.testWeeklyResetNeeded()) {
        database.invokeWeeklyReset();
      }
    } catch (err) {
      logger.error(`[Index] Weekly reset check failed: ${err.message}`);
    }
  }, 60 * 60 * 1000);

  await discord.startDiscordBot().catch((err) => {
    logger.error(`[Index] Discord bot startup failed: ${err.message}`);
    return null;
  });

  events.emit('notification', {
    type: 'manager.started',
    data: { timestamp: new Date().toISOString() },
  });
}

async function bootstrap() {
  logger.info('========================================');
  logger.info('SCUM Server Automation (Node) starting...');
  logger.info('========================================');
  logger.info(`Root path: ${paths.root}`);
  logger.info(`Server dir: ${paths.serverDir}`);
  logger.info(`Saved dir: ${paths.savedDir}`);

  if (config.web && config.web.enabled) {
    startWebServer();
  }

  const { isSetupNeeded } = require('./setup');
  if (isSetupNeeded()) {
    logger.info('[Index] First-time setup required — open browser to configure (browser should open automatically)');
    // When setup + install complete, start all services automatically
    events.once('install:complete', () => {
      logger.info('[Index] Setup and installation complete — starting all services...');
      events.emit('install:progress', { step: 'services', message: 'Starting monitoring, Discord bot and other services...' });
      startAllServices()
        .then(() => {
          events.emit('install:progress', { step: 'redirect', message: 'All services started! Redirecting to dashboard in 3 seconds...' });
        })
        .catch((err) => {
          logger.error(`[Index] startAllServices failed: ${err.message}`);
          events.emit('install:progress', { step: 'error', message: `Failed to start services: ${err.message}`, error: true });
        });
    });
    return;
  }

  if (installation.testFirstInstall()) {
    logger.info('[Index] First install required — starting installation in background');
    installation.invokeFirstInstall({
      onProgress: (data) => events.emit('install:progress', data),
    }).catch((err) => {
      logger.error(`[Index] First install failed: ${err.message}`);
    });
  } else {
    logger.info('[Index] Existing installation found');
  }

  await startAllServices();
}

function shutdown(signal) {
  logger.info(`[Index] Received ${signal}, shutting down...`);
  if (monitorTimer) clearInterval(monitorTimer);
  if (schedulingTimer) clearInterval(schedulingTimer);
  if (backupTimer) clearInterval(backupTimer);
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  if (weeklyResetTimer) clearInterval(weeklyResetTimer);
  database.closeAll();

  events.emit('notification', {
    type: 'manager.stopped',
    data: { timestamp: new Date().toISOString() },
  });

  discord.stopDiscordBot()
    .catch((err) => logger.error(`[Index] Discord bot shutdown failed: ${err.message}`))
    .finally(() => setTimeout(() => process.exit(0), 250));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error(`[Index] Unhandled rejection: ${reason}`);
});

bootstrap().catch((err) => {
  logger.error(`[Index] Fatal error during bootstrap: ${err.stack || err.message}`);
  process.exit(1);
});

module.exports = { service, monitoring, logParser, installation, backup, scheduling, update, database };
