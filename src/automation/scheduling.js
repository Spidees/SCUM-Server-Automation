'use strict';

const fs = require('fs');
const path = require('path');
const fsExtra = require('fs-extra');
const logger = require('../core/logger');
const events = require('../core/events');
const { config, paths } = require('../core/config');
const { schedulingState } = require('../core/state');
const { getNextScheduledRestart } = require('../core/common');
const service = require('../server/service');
const backup = require('./backup');

const SKIP_FLAG_FILE = path.join(paths.root, 'data', 'scum_restart_skip.flag');

const RESTART_WARNING_DEFS = [
  { key: 'restartWarning15', minutes: 15 },
  { key: 'restartWarning5', minutes: 5 },
  { key: 'restartWarning1', minutes: 1 },
];

let skipNextRestart = false;

/**
 * Mirrors Get-RestartWarningDefinitions.
 */
function getRestartWarningDefinitions() {
  return RESTART_WARNING_DEFS;
}

/**
 * Mirrors Get-RestartSkipStatus.
 */
function getRestartSkipStatus() {
  try {
    if (fs.existsSync(SKIP_FLAG_FILE)) {
      const content = fs.readFileSync(SKIP_FLAG_FILE, 'utf8').trim();
      skipNextRestart = content === 'true';
    } else {
      skipNextRestart = false;
    }
  } catch (err) {
    logger.warn(`[Scheduling] Failed to read restart-skip flag: ${err.message}`);
  }
  return skipNextRestart;
}

/**
 * Mirrors Set-RestartSkip.
 */
function setRestartSkip() {
  skipNextRestart = true;
  fsExtra.ensureDirSync(path.dirname(SKIP_FLAG_FILE));
  fs.writeFileSync(SKIP_FLAG_FILE, 'true');
  logger.info('[Scheduling] Next scheduled restart will be skipped');
  return true;
}

/**
 * Mirrors Clear-RestartSkip.
 */
function clearRestartSkip() {
  skipNextRestart = false;
  if (fs.existsSync(SKIP_FLAG_FILE)) {
    try {
      fs.unlinkSync(SKIP_FLAG_FILE);
    } catch (err) {
      logger.warn(`[Scheduling] Failed to remove restart-skip flag: ${err.message}`);
    }
  }
  logger.info('[Scheduling] Restart-skip cleared');
  return true;
}

/**
 * Build the initial restart-warning state, applying any pending skip request.
 * Mirrors Initialize-RestartWarningSystem.
 */
function initializeRestartWarningSystem(restartTimes = config.restartTimes || []) {
  let nextRestartTime = getNextScheduledRestart(restartTimes);

  const warningSent = {};
  for (const def of RESTART_WARNING_DEFS) warningSent[def.key] = false;

  if (getRestartSkipStatus() && nextRestartTime) {
    nextRestartTime = nextAfter(restartTimes, nextRestartTime);
  }

  return {
    NextRestartTime: nextRestartTime,
    WarningSent: warningSent,
    RestartPerformedTime: null,
    RestartTimes: restartTimes,
  };
}

/**
 * Find the next configured restart time strictly after `after`.
 */
function nextAfter(restartTimes, after) {
  const sameDayCandidates = [];
  for (const t of restartTimes) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) continue;
    const candidate = new Date(after);
    candidate.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
    if (candidate.getTime() > after.getTime()) sameDayCandidates.push(candidate);
  }

  if (sameDayCandidates.length > 0) {
    sameDayCandidates.sort((a, b) => a - b);
    return sameDayCandidates[0];
  }

  // Nothing later today - tomorrow's earliest configured time.
  return getNextScheduledRestart(restartTimes, new Date(after.getFullYear(), after.getMonth(), after.getDate(), 23, 59, 59, 999));
}

/**
 * Send 15/5/1-minute pre-restart warnings as their windows are reached.
 * Mirrors Update-RestartWarnings.
 */
function updateRestartWarnings(warningState, currentTime = new Date()) {
  if (!warningState.NextRestartTime) return warningState;

  const warningSent = { ...warningState.WarningSent };

  for (const def of RESTART_WARNING_DEFS) {
    const warnTime = new Date(warningState.NextRestartTime.getTime() - def.minutes * 60000);
    const windowEnd = new Date(warnTime.getTime() + 30000);

    if (!warningSent[def.key] && currentTime >= warnTime && currentTime < windowEnd) {
      events.emit('notification', {
        type: def.key,
        data: { time: formatHHmm(warningState.NextRestartTime) },
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
 * Mirrors Test-ScheduledRestartDue.
 */
function testScheduledRestartDue(warningState, currentTime = new Date()) {
  if (!warningState.NextRestartTime) return false;
  if (warningState.RestartPerformedTime
    && warningState.RestartPerformedTime.getTime() === warningState.NextRestartTime.getTime()) {
    return false;
  }

  const windowEnd = new Date(warningState.NextRestartTime.getTime() + 60000);
  return currentTime >= warningState.NextRestartTime && currentTime < windowEnd;
}

/**
 * Perform (or skip) the scheduled restart if due. Mirrors Invoke-ScheduledRestart.
 */
async function invokeScheduledRestart(warningState, serviceName = config.serviceName, skipRestart = false) {
  const shouldSkip = skipRestart || skipNextRestart;
  const restartDue = testScheduledRestartDue(warningState);

  if (!restartDue) return warningState;

  if (shouldSkip) {
    events.emit('notification', {
      type: 'server.scheduledRestart',
      data: { event: `:fast_forward: Scheduled restart at ${formatHHmmss(warningState.NextRestartTime)} was skipped as requested` },
    });

    const performedTime = warningState.NextRestartTime;
    const nextRestartTime = getNextScheduledRestart(warningState.RestartTimes);
    const warningSent = {};
    for (const def of RESTART_WARNING_DEFS) warningSent[def.key] = false;

    clearRestartSkip();

    return {
      ...warningState,
      RestartPerformedTime: performedTime,
      NextRestartTime: nextRestartTime,
      WarningSent: warningSent,
    };
  }

  events.emit('notification', {
    type: 'server.scheduledRestart',
    data: { time: formatHHmmss(warningState.NextRestartTime) },
  });

  if (config.preRestartBackupEnabled && paths.savedDir && paths.backupRoot) {
    logger.info('[Scheduling] Running pre-restart backup');
    await backup.createBackup('automatic');
  }

  await service.restartGameService(serviceName, 'scheduled restart');

  const performedTime = warningState.NextRestartTime;
  const nextRestartTime = getNextScheduledRestart(warningState.RestartTimes);
  const warningSent = {};
  for (const def of RESTART_WARNING_DEFS) warningSent[def.key] = false;

  return {
    ...warningState,
    RestartPerformedTime: performedTime,
    NextRestartTime: nextRestartTime,
    WarningSent: warningSent,
  };
}

/**
 * Mirrors Invoke-ManualRestart.
 */
async function invokeManualRestart(serviceName = config.serviceName) {
  if (config.preRestartBackupEnabled && paths.savedDir && paths.backupRoot) {
    logger.info('[Scheduling] Running pre-restart backup');
    await backup.createBackup('automatic');
  }

  return service.restartGameService(serviceName, 'manual restart');
}

/**
 * The next restart that will actually happen: the soonest of the next scheduled
 * restart and any pending manual restart (from /server-restart minutes:X).
 */
function getEffectiveNextRestart() {
  const ws = schedulingState.restartWarningState;
  const scheduled = ws && ws.NextRestartTime ? ws.NextRestartTime : null;
  const pm = schedulingState.pendingManual && schedulingState.pendingManual.restart;
  const manual = pm && pm.at ? pm.at : null;

  if (manual && scheduled) {
    return manual.getTime() <= scheduled.getTime()
      ? { time: manual, isManual: true }
      : { time: scheduled, isManual: false };
  }
  if (manual) return { time: manual, isManual: true };
  if (scheduled) return { time: scheduled, isManual: false };
  return { time: null, isManual: false };
}

/**
 * Cancel a pending manual operation (restart/stop/update) and clear its timers.
 * Returns true if something was actually pending.
 */
function cancelPendingManual(type) {
  const pending = schedulingState.pendingManual || {};
  const p = pending[type];
  if (!p) return false;
  if (p.timer) clearTimeout(p.timer);
  if (Array.isArray(p.warningTimers)) p.warningTimers.forEach((t) => clearTimeout(t));
  delete pending[type];
  return true;
}

/**
 * Mirrors Get-SchedulingStats.
 */
function getSchedulingStats(warningState) {
  const eff = getEffectiveNextRestart();
  const timeToRestartMinutes = eff.time ? (eff.time.getTime() - Date.now()) / 60000 : null;

  return {
    Initialized: !!warningState,
    NextRestart: eff.time,
    NextRestartIsManual: eff.isManual,
    TimeToRestartMinutes: timeToRestartMinutes,
    WarningsConfigured: RESTART_WARNING_DEFS.length,
    WarningSentStatus: warningState ? warningState.WarningSent : null,
    LastRestartPerformed: warningState ? warningState.RestartPerformedTime : null,
    SkipNextRestart: getRestartSkipStatus(),
  };
}

module.exports = {
  getRestartWarningDefinitions,
  getRestartSkipStatus,
  setRestartSkip,
  clearRestartSkip,
  initializeRestartWarningSystem,
  updateRestartWarnings,
  testScheduledRestartDue,
  invokeScheduledRestart,
  invokeManualRestart,
  getSchedulingStats,
  getEffectiveNextRestart,
  cancelPendingManual,
};
