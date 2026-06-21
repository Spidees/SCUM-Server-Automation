'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const si = require('systeminformation');
const logger = require('../core/logger');
const { config, paths } = require('../core/config');

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true }, (error, stdout, stderr) => {
      resolve({
        code: error ? (error.code ?? 1) : 0,
        stdout: stdout || '',
        stderr: stderr || '',
        error,
      });
    });
  });
}

function nssm(args) {
  return run(paths.nssm, args);
}

function sc(args) {
  return run('sc', args);
}

/**
 * Mirrors Test-ServiceExists.
 */
async function testServiceExists(serviceName = config.serviceName) {
  const result = await sc(['query', serviceName]);
  return !/1060/.test(result.stdout) && result.code === 0;
}

function parseServiceState(stdout) {
  const match = stdout.match(/STATE\s*:\s*\d+\s+(\w+)/i);
  return match ? match[1].toUpperCase() : 'UNKNOWN';
}

function mapState(state) {
  switch (state) {
    case 'RUNNING': return 'Running';
    case 'STOPPED': return 'Stopped';
    case 'START_PENDING': return 'StartPending';
    case 'STOP_PENDING': return 'StopPending';
    case 'PAUSED': return 'Paused';
    default: return 'Unknown';
  }
}

/**
 * Mirrors Test-ServiceRunning.
 */
async function testServiceRunning(serviceName = config.serviceName) {
  const result = await sc(['query', serviceName]);
  return mapState(parseServiceState(result.stdout)) === 'Running';
}

/**
 * Mirrors Get-ServiceInfo.
 */
async function getServiceInfo(serviceName = config.serviceName) {
  const queryResult = await sc(['query', serviceName]);
  if (/1060/.test(queryResult.stdout) || queryResult.code !== 0) {
    return { Name: serviceName, Status: 'NotFound' };
  }

  const status = mapState(parseServiceState(queryResult.stdout));

  const qcResult = await sc(['qc', serviceName]);
  const displayMatch = qcResult.stdout.match(/DISPLAY_NAME\s*:\s*(.+)/i);
  const startTypeMatch = qcResult.stdout.match(/START_TYPE\s*:\s*\d+\s+(\w+)/i);

  return {
    Name: serviceName,
    DisplayName: displayMatch ? displayMatch[1].trim() : serviceName,
    Status: status,
    StartType: startTypeMatch ? startTypeMatch[1] : 'Unknown',
    CanStop: status === 'Running',
    CanRestart: status === 'Running',
  };
}

/**
 * Find the SCUMServer.exe process, whether it runs directly under the service
 * or as a child of nssm.exe. Mirrors Get-ServiceProcess from monitoring.psm1.
 */
async function getScumProcess() {
  try {
    const list = await si.processes();
    const candidates = list.list.filter((p) => /^SCUMServer/i.test(p.name));
    if (candidates.length === 0) return null;
    // Pick the one using the most memory (most likely the real server process)
    candidates.sort((a, b) => (b.memRss || 0) - (a.memRss || 0));
    return candidates[0];
  } catch (err) {
    logger.warn(`[Service] Error listing processes: ${err.message}`);
    return null;
  }
}

/**
 * Start the SCUM server service via NSSM.
 * Mirrors Start-GameService.
 */
async function startGameService(serviceName = config.serviceName, reason = '') {
  if (await testServiceRunning(serviceName)) {
    logger.info(`[Service] ${serviceName} already running`);
    return true;
  }

  // Apply current launch arguments (port/query port/max players/BattlEye) so
  // dashboard Settings changes take effect on this start without manual nssm edits.
  await updateServiceAppParameters(serviceName, config.serverArgs);

  logger.info(`[Service] Starting ${serviceName}${reason ? ` (${reason})` : ''}`);
  const result = await nssm(['start', serviceName]);
  if (result.code !== 0) {
    logger.error(`[Service] Failed to start ${serviceName}: ${result.stderr || result.stdout}`);
    return false;
  }
  return true;
}

/**
 * Stop the SCUM server service via NSSM.
 * Mirrors Stop-GameService.
 */
async function stopGameService(serviceName = config.serviceName, reason = '') {
  if (!(await testServiceExists(serviceName))) {
    return true;
  }
  if (!(await testServiceRunning(serviceName))) {
    logger.info(`[Service] ${serviceName} already stopped`);
    return true;
  }

  logger.info(`[Service] Stopping ${serviceName}${reason ? ` (${reason})` : ''}`);
  const result = await nssm(['stop', serviceName]);
  if (result.code !== 0) {
    logger.error(`[Service] Failed to stop ${serviceName}: ${result.stderr || result.stdout}`);
    return false;
  }
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mirrors Restart-GameService.
 */
async function restartGameService(serviceName = config.serviceName, reason = '') {
  await stopGameService(serviceName, reason);
  await sleep(5000);
  return startGameService(serviceName, reason);
}

/**
 * Poll until the service reports Running or the timeout elapses.
 * Mirrors Watch-ServiceStartup.
 */
async function watchServiceStartup(serviceName = config.serviceName, timeoutMinutes = 10) {
  const deadline = Date.now() + timeoutMinutes * 60 * 1000;
  while (Date.now() < deadline) {
    if (await testServiceRunning(serviceName)) {
      return true;
    }
    await sleep(5000);
  }
  return false;
}

/**
 * Check overall health of the running server: service status, process presence,
 * and recent log activity. Mirrors Test-GameProcessHealth.
 */
async function testGameProcessHealth(serviceName = config.serviceName, serverDir = paths.serverDir) {
  const info = await getServiceInfo(serviceName);

  if (info.Status !== 'Running') {
    return {
      IsHealthy: false,
      Reason: `Service status is ${info.Status}`,
      ServiceStatus: info.Status,
      ProcessFound: false,
      LogActive: false,
    };
  }

  const scumProcess = await getScumProcess();
  const processFound = !!scumProcess;

  let logActive = false;
  try {
    const stat = fs.statSync(paths.logPath);
    logActive = (Date.now() - stat.mtimeMs) < 15 * 60 * 1000;
  } catch {
    logActive = false;
  }

  const isHealthy = processFound && logActive;

  return {
    IsHealthy: isHealthy,
    Reason: isHealthy
      ? 'Service running, process found, log active'
      : !processFound
        ? 'Service running but SCUMServer.exe process not found'
        : 'Process found but log file is stale',
    ServiceStatus: info.Status,
    ProcessFound: processFound,
    ScumProcessId: scumProcess ? scumProcess.pid : null,
    ScumProcessName: scumProcess ? scumProcess.name : null,
    LogActive: logActive,
  };
}

/**
 * Force-stop (killing the process if necessary) and restart the service.
 * Mirrors Repair-GameService.
 */
async function repairGameService(serviceName = config.serviceName, reason = 'automatic crash recovery') {
  logger.warn(`[Service] Repairing ${serviceName}: ${reason}`);

  const stopped = await stopGameService(serviceName, reason);
  if (!stopped || await testServiceRunning(serviceName)) {
    logger.warn('[Service] Graceful stop failed, force-killing SCUMServer.exe');
    const scumProcess = await getScumProcess();
    if (scumProcess) {
      try {
        process.kill(scumProcess.pid, 'SIGKILL');
      } catch (err) {
        logger.warn(`[Service] Failed to kill SCUMServer.exe: ${err.message}`);
      }
    }
    await sc(['stop', serviceName]);
    await sleep(5000);
  }

  return startGameService(serviceName, reason);
}

function buildServerAppParameters(serverArgs) {
  const args = serverArgs || {};
  const parts = ['-log'];
  if (args.port) parts.push(`-port=${args.port}`);
  if (args.queryPort) parts.push(`-QueryPort=${args.queryPort}`);
  if (args.maxPlayers) parts.push(`-MaxPlayers=${args.maxPlayers}`);
  if (args.noBattleye) parts.push('-nobattleye');
  if (args.fileopenlog) parts.push('-fileopenlog');
  return parts.join(' ');
}

/**
 * Sync the NSSM service's launch arguments (AppParameters) from config.serverArgs.
 * SCUM reads these only at process start, so calling this before each start means
 * changes made in the dashboard's Settings take effect on the next restart without
 * any manual `nssm set` — returns true if the parameters were (re)applied.
 */
async function updateServiceAppParameters(serviceName = config.serviceName, serverArgs = config.serverArgs) {
  if (!paths.nssm || !fs.existsSync(paths.nssm)) return false;
  if (!(await testServiceExists(serviceName))) return false;

  const params = buildServerAppParameters(serverArgs);
  const result = await nssm(['set', serviceName, 'AppParameters', params]);
  if (result.code !== 0) {
    logger.warn(`[Service] Failed to update launch arguments: ${result.stderr || result.stdout}`);
    return false;
  }
  logger.info(`[Service] Launch arguments synced: ${params}`);
  return true;
}

/**
 * Install the SCUM server as a Windows service via NSSM.
 * Safe to call multiple times — skips silently if the service already exists.
 * Mirrors Install-GameService / Register-NssmService.
 */
async function installService(serviceName = config.serviceName, exePath, appDir) {
  if (await testServiceExists(serviceName)) {
    logger.info(`[Service] Service '${serviceName}' already exists — skipping install`);
    return true;
  }

  if (!paths.nssm || !fs.existsSync(paths.nssm)) {
    logger.warn('[Service] nssm.exe not found — cannot install Windows service automatically.');
    logger.warn(`[Service] Download NSSM from https://nssm.cc and set "nssmPath" in config.json.`);
    logger.warn(`[Service] Then run manually: nssm install ${serviceName} "${exePath}"`);
    return false;
  }

  logger.info(`[Service] Installing Windows service '${serviceName}' via NSSM...`);

  const steps = [
    ['install',  serviceName, exePath],
    ['set', serviceName, 'AppDirectory',    appDir],
    ['set', serviceName, 'AppParameters',   buildServerAppParameters(config.serverArgs)],
    ['set', serviceName, 'DisplayName',     serviceName],
    ['set', serviceName, 'Description',     'SCUM Dedicated Server — managed by SCUM Server Automation'],
    ['set', serviceName, 'Start',           'SERVICE_AUTO_START'],
    ['set', serviceName, 'AppRestartDelay', '5000'],
    ['set', serviceName, 'AppStdout',       path.join(appDir, 'nssm_stdout.log')],
    ['set', serviceName, 'AppStderr',       path.join(appDir, 'nssm_stderr.log')],
  ];

  for (const args of steps) {
    const result = await nssm(args);
    if (result.code !== 0) {
      logger.error(`[Service] nssm ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
      return false;
    }
  }

  logger.info(`[Service] Windows service '${serviceName}' installed successfully`);
  return true;
}

/**
 * Best-effort check for whether the last service stop was intentional
 * (clean shutdown logged) vs. a crash. Mirrors Test-IntentionalStop.
 * Defaults to false (treat as crash) when evidence is inconclusive.
 */
async function testIntentionalStop() {
  try {
    const data = fs.readFileSync(paths.logPath, 'utf8');
    const lines = data.split(/\r?\n/).filter(Boolean).slice(-20);
    const cleanShutdownPatterns = [/LogExit: Exiting\./, /SHUTTING DOWN/, /Log file closed/];
    return lines.some((line) => cleanShutdownPatterns.some((re) => re.test(line)));
  } catch {
    return false;
  }
}

module.exports = {
  testServiceExists,
  testServiceRunning,
  getServiceInfo,
  getScumProcess,
  installService,
  buildServerAppParameters,
  updateServiceAppParameters,
  startGameService,
  stopGameService,
  restartGameService,
  watchServiceStartup,
  testGameProcessHealth,
  repairGameService,
  testIntentionalStop,
};
