'use strict';

const fs = require('fs');
const fsExtra = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const https = require('https');
const AdmZip = require('adm-zip');
const logger = require('../core/logger');
const { config, paths } = require('../core/config');
const service = require('./service');

const STEAMCMD_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip';

/**
 * Check whether this looks like a first install (any required component missing).
 * Mirrors Test-FirstInstall from modules/server/installation/installation.psm1.
 * Returns true if a (re)install is required.
 */
function testFirstInstall(serverDir = paths.serverDir, appId = config.appId) {
  const manifestPath = path.join(serverDir, 'steamapps', `appmanifest_${appId}.acf`);
  const serverExePath = path.join(serverDir, 'SCUM', 'Binaries', 'Win64', 'SCUMServer.exe');
  const savedDirPath = path.join(serverDir, 'SCUM', 'Saved');
  const steamappsDir = path.join(serverDir, 'steamapps');
  const steamCmdPath = paths.steamCmd;

  const checks = {
    manifest: fs.existsSync(manifestPath),
    serverExe: fs.existsSync(serverExePath),
    savedDir: fs.existsSync(savedDirPath),
    steamappsDir: fs.existsSync(steamappsDir),
    steamCmd: steamCmdPath ? fs.existsSync(steamCmdPath) : false,
  };

  const isComplete = Object.values(checks).every(Boolean);

  if (!isComplete) {
    logger.info(`[Installation] First-install check: ${JSON.stringify(checks)}`);
  }

  return !isComplete;
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const request = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlinkSync(destPath);
        downloadFile(response.headers.location, destPath).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        file.close();
        reject(new Error(`Download failed: HTTP ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
    });
    request.on('error', (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

/**
 * Ensure SteamCMD is present and runnable, downloading it if necessary.
 * Mirrors Install-SteamCmd.
 */
async function installSteamCmd(steamCmdPath = paths.steamCmd) {
  if (fs.existsSync(steamCmdPath)) {
    logger.info('[Installation] SteamCMD already present');
    return true;
  }

  logger.info('[Installation] SteamCMD not found, downloading...');
  const steamCmdDir = path.dirname(steamCmdPath);
  fsExtra.ensureDirSync(steamCmdDir);

  const zipPath = path.join(steamCmdDir, 'steamcmd.zip');
  await downloadFile(STEAMCMD_URL, zipPath);

  const zip = new AdmZip(zipPath);
  zip.extractAllTo(steamCmdDir, true);
  fs.unlinkSync(zipPath);

  if (!fs.existsSync(steamCmdPath)) {
    throw new Error(`SteamCMD extraction did not produce ${steamCmdPath}`);
  }

  logger.info('[Installation] SteamCMD installed successfully');
  return true;
}

/**
 * Mirrors Initialize-ServerDirectory.
 */
function initializeServerDirectory(serverDir = paths.serverDir) {
  fsExtra.ensureDirSync(serverDir);
}

/**
 * Run SteamCMD once and return the exit code.
 * lineCallback (optional) is called with each stdout line for live progress reporting.
 */
function runSteamCmd(steamCmdPath, args, lineCallback = null) {
  return new Promise((resolve, reject) => {
    const proc = spawn(steamCmdPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let buf = '';
    const handleLine = (line) => {
      const clean = line.trim();
      if (!clean) return;
      logger.debug(`[SteamCMD] ${clean}`);
      if (lineCallback) lineCallback(clean);
    };

    proc.stdout.on('data', (data) => {
      buf += data.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      lines.forEach(handleLine);
    });
    let buf2 = '';
    proc.stderr.on('data', (data) => {
      buf2 += data.toString();
      const lines = buf2.split('\n');
      buf2 = lines.pop();
      lines.forEach((line) => {
        const clean = line.trim();
        if (!clean) return;
        logger.warn(`[SteamCMD] ${clean}`);
        if (lineCallback) lineCallback(clean);
      });
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (buf.trim()) handleLine(buf);
      if (buf2.trim()) {
        const clean = buf2.trim();
        logger.warn(`[SteamCMD] ${clean}`);
        if (lineCallback) lineCallback(clean);
      }
      resolve(code);
    });
  });
}

/**
 * Run SteamCMD to install/update the SCUM dedicated server.
 * lineCallback (optional) receives interesting stdout lines for live progress.
 * Retries up to 3 times: on a fresh SteamCMD download the first run always
 * self-updates (exit code 7) before downloading any game files.
 * Mirrors the core of Update-GameServer.
 */
async function updateGameServer(steamCmdPath = paths.steamCmd, serverDir = paths.serverDir, appId = config.appId, lineCallback = null) {
  const args = [
    '+force_install_dir', serverDir,
    '+login', 'anonymous',
    '+app_update', appId, 'validate',
    '+quit',
  ];

  logger.info(`[Installation] Running SteamCMD: ${steamCmdPath} ${args.join(' ')}`);

  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      logger.info(`[Installation] SteamCMD attempt ${attempt}/${MAX_ATTEMPTS}...`);
      if (lineCallback) lineCallback(`[Attempt ${attempt}/${MAX_ATTEMPTS}] Running SteamCMD...`);
    }

    const code = await runSteamCmd(steamCmdPath, args, lineCallback);

    if (code === 0) {
      logger.info('[Installation] SteamCMD completed successfully');
      return true;
    }

    if (code === 7 && attempt < MAX_ATTEMPTS) {
      // Exit code 7 means SteamCMD just updated itself; re-run to do the actual download
      logger.info(`[Installation] SteamCMD self-updated (exit code 7), retrying in 3s...`);
      if (lineCallback) lineCallback('SteamCMD self-update finished. Starting actual SCUM server download now...');
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }

    throw new Error(`SteamCMD exited with code ${code} after ${attempt} attempt(s)`);
  }
}

/**
 * Launch SCUMServer.exe directly (not via the service) so it generates its
 * default config/ini files, then kill it once generation looks complete.
 * onProgress (optional) receives { step, message } updates for live browser display.
 * Mirrors Start-FirstTimeServerGeneration.
 */
function startFirstTimeServerGeneration(serverDir = paths.serverDir, timeoutSeconds = 120, onProgress = null) {
  return new Promise((resolve) => {
    const exePath = path.join(serverDir, 'SCUM', 'Binaries', 'Win64', 'SCUMServer.exe');
    if (!fs.existsSync(exePath)) {
      logger.warn('[Installation] SCUMServer.exe not found, cannot generate initial config');
      resolve(false);
      return;
    }

    const configDir = path.join(serverDir, 'SCUM', 'Saved', 'Config', 'WindowsServer');
    const logFile = path.join(serverDir, 'SCUM', 'Saved', 'Logs', 'SCUM.log');
    const saveFilesDir = path.join(serverDir, 'SCUM', 'Saved', 'SaveFiles');
    const essentialFiles = ['ServerSettings.ini', 'GameUserSettings.ini', 'AdminUsers.ini', 'BannedUsers.ini'];

    logger.info('[Installation] Launching SCUMServer.exe for initial config generation...');
    const proc = spawn(exePath, ['-log', '-ServerName=Initial Config Generation'], {
      cwd: path.dirname(exePath),
      stdio: 'ignore',
      detached: true,
    });

    let elapsed = 0;
    const intervalMs = 3000;
    const finish = (success) => {
      clearInterval(timer);
      try { proc.kill(); } catch {}
      logger.info(`[Installation] Initial config generation ${success ? 'completed' : 'timed out'}`);
      resolve(success);
    };

    proc.on('error', (err) => {
      logger.error(`[Installation] Failed to launch SCUMServer.exe: ${err.message}`);
      finish(false);
    });

    const timer = setInterval(() => {
      elapsed += intervalMs / 1000;

      const configReady = fs.existsSync(configDir)
        && essentialFiles.every((f) => fs.existsSync(path.join(configDir, f)))
        && fs.existsSync(logFile)
        && fs.existsSync(saveFilesDir);

      if (configReady) {
        finish(true);
        return;
      }

      // Emit periodic progress so the browser shows something is happening
      if (elapsed % 15 === 0 || elapsed === intervalMs / 1000) {
        const msg = `Waiting for SCUM to generate config files... (${elapsed}s / max ${timeoutSeconds}s)`;
        logger.info(`[Installation] ${msg}`);
        if (onProgress) onProgress({ step: 'config', message: msg });
      }

      if (elapsed >= timeoutSeconds) {
        finish(false);
      }
    }, intervalMs);
  });
}

/**
 * Full first-install flow: SteamCMD -> server files -> service -> initial config generation.
 * Accepts an options object so callers can pass an onProgress callback for live browser updates.
 * Mirrors Invoke-FirstInstall.
 */
async function invokeFirstInstall({ steamCmdPath, serverDir, appId, onProgress } = {}) {
  steamCmdPath = steamCmdPath || paths.steamCmd;
  serverDir = serverDir || paths.serverDir;
  appId = appId || config.appId;

  const emit = (step, message, extra = {}) => {
    logger.info(`[Installation] ${message}`);
    if (onProgress) onProgress({ step, message, ...extra });
  };

  emit('start', 'Starting first-time installation...');

  emit('steamcmd', 'Checking SteamCMD...');
  await installSteamCmd(steamCmdPath);
  emit('steamcmd', 'SteamCMD ready', { done: true });

  initializeServerDirectory(serverDir);

  emit('download', 'Preparing to download SCUM server files...');
  emit('download', 'NOTE: On first run, SteamCMD must update itself before downloading the game.');
  emit('download', '      This silent phase downloads ~50 MB and can take 5–15 minutes on slow connections.');
  emit('download', '      Do not close this window — this only happens once.');

  // Heartbeat: show elapsed time every 15s so the user always sees something
  const downloadStart = Date.now();
  let heartbeat = onProgress ? setInterval(() => {
    const secs = Math.floor((Date.now() - downloadStart) / 1000);
    const m = Math.floor(secs / 60), s = secs % 60;
    const elapsed = m > 0 ? `${m}m ${s}s` : `${s}s`;
    let hint = '';
    if (secs < 180) hint = 'SteamCMD is updating itself...';
    else if (secs < 600) hint = 'Still updating — please be patient...';
    else hint = 'Taking longer than expected — check your internet / firewall if stuck.';
    onProgress({ step: 'download', message: `  [${elapsed} elapsed] ${hint}` });
  }, 15000) : null;

  // Forward all SteamCMD stdout/stderr lines to the browser as-is
  const steamLineCallback = onProgress ? (line) => {
    onProgress({ step: 'download', message: `  ${line}` });
  } : null;

  try {
    await updateGameServer(steamCmdPath, serverDir, appId, steamLineCallback);
  } finally {
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  }

  emit('download', 'Server files downloaded successfully', { done: true });

  const serverExePath = path.join(serverDir, 'SCUM', 'Binaries', 'Win64', 'SCUMServer.exe');
  if (!fs.existsSync(serverExePath)) {
    throw new Error(`Installation failed: ${serverExePath} not found after SteamCMD update`);
  }

  emit('service', 'Installing Windows service via NSSM...');
  const serverBinDir = path.dirname(serverExePath);
  const serviceInstalled = await service.installService(config.serviceName, serverExePath, serverBinDir);
  if (serviceInstalled) {
    emit('service', 'Windows service installed', { done: true });
  } else {
    emit('service', 'NSSM not found — Windows service not installed. Configure NSSM manually.', { warning: true });
  }

  emit('config', 'Starting SCUM once to generate initial config files (may take a few minutes)...');
  await startFirstTimeServerGeneration(serverDir, (config.serverStartupTimeoutMinutes || 10) * 12, onProgress);
  emit('config', 'Config files generated', { done: true });

  emit('done', 'Installation complete! Restart the app (close console and run Start.bat) to begin server management.', { done: true });

  logger.info('[Installation] First-time installation completed');
  return { requireRestart: true };
}

/**
 * Update an existing installation in place.
 * Mirrors Invoke-InstallationUpdate (service stop/start is handled by the caller).
 */
async function invokeInstallationUpdate(steamCmdPath = paths.steamCmd, serverDir = paths.serverDir, appId = config.appId) {
  logger.info('[Installation] Starting server update...');
  await updateGameServer(steamCmdPath, serverDir, appId);
  logger.info('[Installation] Server update completed');
  return true;
}

module.exports = {
  testFirstInstall,
  installSteamCmd,
  initializeServerDirectory,
  runSteamCmd,
  updateGameServer,
  startFirstTimeServerGeneration,
  invokeFirstInstall,
  invokeInstallationUpdate,
};
