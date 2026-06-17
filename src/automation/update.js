'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('../core/logger');
const events = require('../core/events');
const { config, paths } = require('../core/config');
const service = require('../server/service');
const backup = require('./backup');

const UPDATE_WARNING_DEFS = [
  { key: 'updateWarning15', minutes: 15 },
  { key: 'updateWarning5', minutes: 5 },
  { key: 'updateWarning1', minutes: 1 },
];

const BUILDID_RE = /"buildid"\s+"(\d+)"/;

/**
 * Mirrors Initialize-UpdateWarningSystem.
 */
function initializeUpdateWarningSystem() {
  const warningSent = {};
  for (const def of UPDATE_WARNING_DEFS) warningSent[def.key] = false;
  return { UpdateTime: null, WarningSent: warningSent };
}

/**
 * Mirrors Update-UpdateWarnings.
 */
function updateUpdateWarnings(warningState, currentTime = new Date()) {
  if (!warningState.UpdateTime) return warningState;

  const warningSent = { ...warningState.WarningSent };

  for (const def of UPDATE_WARNING_DEFS) {
    const warnTime = new Date(warningState.UpdateTime.getTime() - def.minutes * 60000);
    const windowEnd = new Date(warnTime.getTime() + 30000);

    if (!warningSent[def.key] && currentTime >= warnTime && currentTime < windowEnd) {
      events.emit('notification', {
        type: def.key,
        data: { time: formatHHmm(warningState.UpdateTime) },
      });
      warningSent[def.key] = true;
    }
  }

  return { ...warningState, WarningSent: warningSent };
}

function formatHHmm(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatHHmmss(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Read the installed buildid from steamapps/appmanifest_<appId>.acf.
 * Mirrors Get-InstalledBuildId.
 */
function getInstalledBuildId(serverDir = paths.serverDir, appId = config.appId) {
  const manifestPath = path.join(serverDir, 'steamapps', `appmanifest_${appId}.acf`);
  if (!fs.existsSync(manifestPath)) {
    logger.warn(`[Update] App manifest not found: ${manifestPath}`);
    return null;
  }

  try {
    const content = fs.readFileSync(manifestPath, 'utf8');
    const match = BUILDID_RE.exec(content);
    if (match) return match[1];
    logger.warn(`[Update] Could not find buildid in ${manifestPath}`);
    return null;
  } catch (err) {
    logger.warn(`[Update] Failed to read app manifest: ${err.message}`);
    return null;
  }
}

function resolveSteamCmdExe(steamCmdPath) {
  let resolved = steamCmdPath;
  if (!resolved.toLowerCase().endsWith('steamcmd.exe')) {
    resolved = path.join(resolved, 'steamcmd.exe');
  }
  return path.resolve(resolved);
}

function runSteamCmd(steamCmdExe, args, cwd) {
  return new Promise((resolve) => {
    const proc = spawn(steamCmdExe, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    proc.stdout.on('data', (d) => { output += d.toString(); });
    proc.stderr.on('data', (d) => { output += d.toString(); });
    proc.on('error', (err) => resolve({ code: -1, output: output + err.message }));
    proc.on('close', (code) => resolve({ code, output }));
  });
}

/**
 * Query Steam for the latest buildid of an app via an anonymous SteamCMD
 * +app_info_print, falling back to the cached appinfo.vdf if SteamCMD
 * can't reach Steam. Mirrors Get-LatestBuildId.
 */
async function getLatestBuildId(steamCmdPath = paths.steamCmd, appId = config.appId) {
  const steamCmdExe = resolveSteamCmdExe(steamCmdPath);

  if (!fs.existsSync(steamCmdExe)) {
    logger.warn(`[Update] steamcmd.exe not found at ${steamCmdExe}`);
    return null;
  }

  const steamCmdDir = path.dirname(steamCmdExe);
  const result = await runSteamCmd(steamCmdExe, ['+login', 'anonymous', '+app_info_print', String(appId), '+quit'], steamCmdDir);

  const match = BUILDID_RE.exec(result.output) || /"buildid"[\s\t]+"(\d+)"/.exec(result.output);
  if (match) return match[1];

  logger.warn('[Update] Failed to parse buildid from SteamCMD output, trying cached appinfo.vdf');

  const fallbackPaths = [
    path.join(steamCmdDir, 'steamapps', 'appinfo.vdf'),
    path.join(paths.root, 'steamcmd', 'steamapps', 'appinfo.vdf'),
  ];

  for (const vdfPath of fallbackPaths) {
    if (fs.existsSync(vdfPath)) {
      try {
        const content = fs.readFileSync(vdfPath, 'latin1');
        const m = BUILDID_RE.exec(content);
        if (m) {
          logger.warn('[Update] Using cached appinfo.vdf buildid - this may not be the latest');
          return m[1];
        }
      } catch {
        // ignore and try next path
      }
    }
  }

  return null;
}

/**
 * Compare installed vs. latest buildid. Mirrors Test-UpdateAvailable.
 */
async function testUpdateAvailable(steamCmdPath = paths.steamCmd, serverDir = paths.serverDir, appId = config.appId) {
  try {
    const installedBuild = getInstalledBuildId(serverDir, appId);
    const latestBuild = await getLatestBuildId(steamCmdPath, appId);

    if (latestBuild === null && installedBuild !== null) {
      return { InstalledBuild: installedBuild, LatestBuild: installedBuild, UpdateAvailable: false, SteamApiUnavailable: true };
    }

    if (installedBuild !== null && latestBuild !== null) {
      return { InstalledBuild: installedBuild, LatestBuild: latestBuild, UpdateAvailable: installedBuild !== latestBuild, SteamApiUnavailable: false };
    }

    if (installedBuild === null && latestBuild !== null) {
      return { InstalledBuild: null, LatestBuild: latestBuild, UpdateAvailable: true, SteamApiUnavailable: false };
    }

    return { InstalledBuild: null, LatestBuild: null, UpdateAvailable: false, SteamApiUnavailable: true, Error: 'Cannot determine update status' };
  } catch (err) {
    return { InstalledBuild: null, LatestBuild: null, UpdateAvailable: false, Error: err.message };
  }
}

const RECOVERABLE_EXIT_CODES = [8, 1, 6];

/**
 * Run SteamCMD `+app_update <appId> validate` with retry on recoverable exit
 * codes (0/7 = success). Shared by Invoke-ServerValidation and Update-GameServer.
 */
async function runSteamCmdAppUpdate(steamCmdExe, serverDir, appId, maxRetries) {
  const steamCmdDir = path.dirname(steamCmdExe);
  const args = [
    '+force_install_dir', serverDir,
    '+login', 'anonymous',
    '+app_update', String(appId), 'validate',
    '+quit',
  ];

  let attempt = 0;
  let lastExitCode = -1;

  while (attempt <= maxRetries) {
    attempt++;
    if (attempt > 1) {
      logger.info(`[Update] Retry attempt ${attempt} of ${maxRetries + 1} for SteamCMD`);
      await sleep(5000);
    }

    logger.info(`[Update] Executing SteamCMD (attempt ${attempt})`);
    const result = await runSteamCmd(steamCmdExe, args, steamCmdDir);
    lastExitCode = result.code;

    if (lastExitCode === 0 || lastExitCode === 7) {
      return { success: true, exitCode: lastExitCode };
    }

    if (!RECOVERABLE_EXIT_CODES.includes(lastExitCode) || attempt > maxRetries) {
      break;
    }

    logger.warn(`[Update] SteamCMD failed with recoverable exit code ${lastExitCode}, will retry`);
  }

  return { success: false, exitCode: lastExitCode };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Validate/repair the server installation via SteamCMD, stopping/restarting
 * the service around it if it was running. Mirrors Invoke-ServerValidation.
 */
async function invokeServerValidation(steamCmdPath = paths.steamCmd, serverDir = paths.serverDir, appId = config.appId, serviceName = config.serviceName, maxRetries = 2) {
  const wasRunning = await service.testServiceRunning(serviceName);
  if (wasRunning) {
    await service.stopGameService(serviceName, 'validation');
    await sleep(10000);
  }

  try {
    const steamCmdExe = resolveSteamCmdExe(steamCmdPath);
    const resolvedServerDir = path.resolve(serverDir);

    if (!fs.existsSync(steamCmdExe)) throw new Error(`SteamCMD not found at: ${steamCmdExe}`);
    if (!fs.existsSync(resolvedServerDir)) throw new Error(`Server directory not found: ${resolvedServerDir}`);

    const { success, exitCode } = await runSteamCmdAppUpdate(steamCmdExe, resolvedServerDir, appId, maxRetries);

    if (!success) {
      if (wasRunning) await service.startGameService(serviceName, 'validation-failed');
      return { Success: false, Error: `SteamCMD validation failed with exit code: ${exitCode}`, ExitCode: exitCode, WasRunning: wasRunning };
    }

    await sleep(2000);

    const scumExePath = path.join(resolvedServerDir, 'SCUM', 'Binaries', 'Win64', 'SCUMServer.exe');
    if (!fs.existsSync(scumExePath)) {
      logger.warn(`[Update] Server executable not found at expected path: ${scumExePath}`);
    }

    if (wasRunning) await service.startGameService(serviceName, 'validation');

    return { Success: true, Error: null, FilesChecked: 'Unknown', FilesFixed: exitCode === 7 ? 'Some' : 0, ExitCode: exitCode, WasRunning: wasRunning };
  } catch (err) {
    if (wasRunning) await service.startGameService(serviceName, 'validation-error');
    return { Success: false, Error: err.message, WasRunning: wasRunning };
  }
}

/**
 * Run SteamCMD app_update with retry and verify the server executable
 * afterwards, optionally starting the service. Mirrors Update-GameServer.
 */
async function updateGameServer(steamCmdPath = paths.steamCmd, serverDir = paths.serverDir, appId = config.appId, serviceName = config.serviceName, skipServiceStart = false, maxRetries = 2) {
  try {
    if (!skipServiceStart) {
      if (await service.testServiceRunning(serviceName)) {
        logger.info('[Update] Stopping server service before update');
        await service.stopGameService(serviceName, 'update');
        await sleep(10000);
      } else {
        logger.info('[Update] Service is not running, proceeding with update');
      }
    }

    const steamCmdExe = resolveSteamCmdExe(steamCmdPath);
    const resolvedServerDir = path.resolve(serverDir);

    if (!fs.existsSync(steamCmdExe)) throw new Error(`SteamCMD not found at: ${steamCmdExe}`);

    fs_ensureDir(resolvedServerDir);

    const { success, exitCode } = await runSteamCmdAppUpdate(steamCmdExe, resolvedServerDir, appId, maxRetries);

    if (!success) {
      logger.error(`[Update] Server update failed with exit code: ${exitCode}`);
      events.emit('notification', { type: 'update.failed', data: { error: `SteamCMD failed with exit code: ${exitCode} (after ${maxRetries + 1} attempts)` } });
      return { Success: false, Error: `SteamCMD failed with exit code: ${exitCode} (after ${maxRetries + 1} attempts)` };
    }

    if (exitCode === 7) {
      logger.info('[Update] Server update completed with warnings (exit code 7)');
    } else {
      logger.info('[Update] Server update completed successfully');
    }

    await sleep(2000);

    const scumExePath = path.join(resolvedServerDir, 'SCUM', 'Binaries', 'Win64', 'SCUMServer.exe');
    if (fs.existsSync(scumExePath)) {
      logger.info(`[Update] Server executable found: ${scumExePath}`);
    } else {
      logger.warn(`[Update] Server executable not found at expected path: ${scumExePath}`);
    }

    if (!skipServiceStart) {
      logger.info('[Update] Starting server service after update');
      await service.startGameService(serviceName, 'update');
    } else {
      logger.info('[Update] Skipping service start due to SkipServiceStart flag');
    }

    return { Success: true, Error: null };
  } catch (err) {
    logger.error(`[Update] Update process failed: ${err.message}`);
    events.emit('notification', { type: 'update.failed', data: { error: err.message } });
    return { Success: false, Error: err.message };
  }
}

function fs_ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Full immediate-update flow: check, optional delay-with-warnings, backup,
 * update, restart service. Mirrors Invoke-ImmediateUpdate.
 */
async function invokeImmediateUpdate(steamCmdPath = paths.steamCmd, serverDir = paths.serverDir, appId = config.appId, serviceName = config.serviceName) {
  const result = { Success: false, Error: null, BackupCreated: false, UpdateCompleted: false, ServiceRestarted: false };

  try {
    const updateCheck = await testUpdateAvailable(steamCmdPath, serverDir, appId);

    if (!updateCheck.UpdateAvailable) {
      logger.info('[Update] No update available, aborting immediate update');
      result.Success = true;
      result.Error = 'No update available';
      return result;
    }

    logger.info(`[Update] Update available: ${updateCheck.InstalledBuild} -> ${updateCheck.LatestBuild}`);

    const updateDelayMinutes = config.updateDelayMinutes || 0;
    if (updateDelayMinutes > 0) {
      logger.info(`[Update] Setting up update warning system for ${updateDelayMinutes} minute delay`);

      let warningState = initializeUpdateWarningSystem();
      const updateTime = new Date(Date.now() + updateDelayMinutes * 60000);
      warningState.UpdateTime = updateTime;

      logger.info(`[Update] Update scheduled for: ${formatHHmmss(updateTime)}`);

      const startTime = Date.now();
      while (Date.now() < updateTime.getTime()) {
        warningState = updateUpdateWarnings(warningState, new Date());
        await sleep(15000);

        if ((Date.now() - startTime) / 60000 > updateDelayMinutes + 5) {
          logger.warn('[Update] Warning loop safety timeout reached, proceeding with update');
          break;
        }
      }

      logger.info('[Update] Update delay completed, starting update process');
    }

    logger.info('[Update] Starting server update process');
    events.emit('notification', {
      type: 'update.started',
      data: { currentVersion: updateCheck.InstalledBuild, targetVersion: updateCheck.LatestBuild },
    });

    if (paths.savedDir && paths.backupRoot) {
      logger.info('[Update] Creating backup before update');
      const backupResult = await backup.createBackup('automatic');
      if (backupResult.success) {
        logger.info('[Update] Backup created successfully');
        result.BackupCreated = true;
      } else {
        logger.warn('[Update] Backup failed, continuing with update anyway');
      }
    } else {
      logger.warn('[Update] Backup paths not available, skipping backup');
    }

    if (await service.testServiceRunning(serviceName)) {
      logger.info('[Update] Stopping service for update');
      await service.stopGameService(serviceName, 'update');
      await sleep(3000);
    }

    logger.info('[Update] Performing server update');
    const updateResult = await updateGameServer(steamCmdPath, serverDir, appId, serviceName, true);

    if (updateResult.Success) {
      logger.info('[Update] Server updated successfully');
      const newBuild = getInstalledBuildId(serverDir, appId);

      events.emit('notification', {
        type: 'update.completed',
        data: { version: newBuild, previousVersion: updateCheck.InstalledBuild, duration: 'N/A' },
      });
      result.UpdateCompleted = true;

      logger.info('[Update] Starting service after update');
      await service.startGameService(serviceName, 'post-update');
      result.ServiceRestarted = true;
      result.Success = true;
    } else {
      result.Error = updateResult.Error;
      logger.error(`[Update] Update failed: ${result.Error}`);
      events.emit('notification', { type: 'update.failed', data: { error: result.Error } });

      if (!(await service.testServiceRunning(serviceName))) {
        logger.info('[Update] Attempting to start service after failed update');
        await service.startGameService(serviceName, 'post-failed-update');
      }
    }
  } catch (err) {
    result.Error = err.message;
    logger.error(`[Update] Immediate update failed: ${result.Error}`);
    events.emit('notification', { type: 'update.failed', data: { error: result.Error } });

    if (!(await service.testServiceRunning(serviceName))) {
      logger.info('[Update] Attempting to start service after update exception');
      await service.startGameService(serviceName, 'post-exception');
    }
  }

  return result;
}

/**
 * Mirrors Get-UpdateStatus.
 */
async function getUpdateStatus(steamCmdPath = paths.steamCmd, serverDir = paths.serverDir, appId = config.appId) {
  try {
    const updateCheck = await testUpdateAvailable(steamCmdPath, serverDir, appId);
    return {
      InstalledBuild: updateCheck.InstalledBuild,
      LatestBuild: updateCheck.LatestBuild,
      UpdateAvailable: updateCheck.UpdateAvailable,
      LastCheck: new Date(),
      Status: updateCheck.UpdateAvailable ? 'Update Available' : 'Up to Date',
    };
  } catch (err) {
    return { Status: 'Error', Error: err.message, LastCheck: new Date() };
  }
}

module.exports = {
  getUpdateWarningDefinitions: () => UPDATE_WARNING_DEFS,
  initializeUpdateWarningSystem,
  updateUpdateWarnings,
  getInstalledBuildId,
  getLatestBuildId,
  testUpdateAvailable,
  invokeServerValidation,
  updateGameServer,
  invokeImmediateUpdate,
  getUpdateStatus,
};
