'use strict';

const fs = require('fs');
const si = require('systeminformation');
const logger = require('../core/logger');
const events = require('../core/events');
const { serverState } = require('../core/state');
const { config, paths } = require('../core/config');
const service = require('./service');
const logParser = require('./logParser');

const STATE_AGE_LIMIT_MS = 10 * 60 * 1000;

// Set once the startup baseline has been established (see updateServerMonitoring).
let baselinePrimed = false;

const STATE_PRIORITY = {
  ServerShuttingDown: 1,
  ServerOffline: 2,
  ServerOnline: 3,    // most positive — wins over Loading/Starting on same timestamp
  ServerLoading: 4,
  ServerStarting: 5,
};

const EVENT_TYPE_TO_STATE = {
  ServerOnline: 'Online',
  ServerOffline: 'Offline',
  ServerShuttingDown: 'ShuttingDown',
  ServerStarting: 'Starting',
  ServerLoading: 'Loading',
};

const STATE_CHANGE_EVENT_TYPES = new Set(['ServerOnline', 'ServerOffline', 'ServerShuttingDown', 'ServerStarting', 'ServerLoading']);

/**
 * Determine the actual server state by inspecting recently parsed log events,
 * falling back to performance-stat cache and service/process status.
 * Mirrors Get-ActualServerStateFromLogs.
 */
async function getActualServerStateFromLogs() {
  const recentEvents = logParser.getParsedEvents(20)
    .filter((e) => STATE_CHANGE_EVENT_TYPES.has(e.EventType));

  const now = Date.now();

  const POSITIVE_STATES = ['ServerOnline', 'ServerLoading', 'ServerStarting'];

  const recentOffline = recentEvents
    .filter((e) => e.EventType === 'ServerOffline' && (now - e.Timestamp.getTime()) <= STATE_AGE_LIMIT_MS)
    .sort((a, b) => b.Timestamp - a.Timestamp)[0];
  if (recentOffline) {
    // Only treat as Offline if no positive-state event happened at the same time or later.
    // >= handles same-second timestamps (e.g. log rotation writes both Offline and Loading
    // in the same second; Loading at equal timestamp means server is restarting, not dead).
    const hasNewerPositive = recentEvents.some(
      (e) => POSITIVE_STATES.includes(e.EventType) && e.Timestamp >= recentOffline.Timestamp,
    );
    if (!hasNewerPositive) return 'Offline';
  }

  const recentShuttingDown = recentEvents
    .filter((e) => e.EventType === 'ServerShuttingDown' && (now - e.Timestamp.getTime()) <= STATE_AGE_LIMIT_MS)
    .sort((a, b) => b.Timestamp - a.Timestamp)[0];
  if (recentShuttingDown) {
    const hasNewerPositive = recentEvents.some(
      (e) => POSITIVE_STATES.includes(e.EventType) && e.Timestamp >= recentShuttingDown.Timestamp,
    );
    if (!hasNewerPositive) {
      // Only report ShuttingDown while SCUMServer.exe is genuinely still alive. A service/NSSM
      // stop hard-kills the process before it can write a clean "LogExit: Exiting." line, so the
      // log's last state stays ShuttingDown forever — once the process is gone it's really Offline.
      const stillRunning = await service.getScumProcess();
      return stillRunning ? 'ShuttingDown' : 'Offline';
    }
  }

  if (recentEvents.length > 0) {
    const sorted = recentEvents.slice().sort((a, b) => b.Timestamp - a.Timestamp);
    const latestTimestamp = sorted[0].Timestamp.getTime();
    const latestEvents = sorted.filter((e) => e.Timestamp.getTime() === latestTimestamp);
    latestEvents.sort((a, b) => STATE_PRIORITY[a.EventType] - STATE_PRIORITY[b.EventType]);
    const chosen = latestEvents[0];

    if ((now - chosen.Timestamp.getTime()) <= STATE_AGE_LIMIT_MS) {
      const state = EVENT_TYPE_TO_STATE[chosen.EventType];
      // Liveness cross-check: if the most recent log evidence says the server is
      // up but the SCUMServer process is gone (e.g. /server-stop killed it without
      // a clean "Exiting" log line), it's actually offline — otherwise the stale
      // "Global Stats" events would keep it "Online" for up to STATE_AGE_LIMIT_MS.
      if (state === 'Online' || state === 'Loading' || state === 'Starting') {
        const proc = await service.getScumProcess();
        if (!proc) return 'Offline';
      }
      return state;
    }
  }

  // Fallback 1: recent performance stats imply the server is online
  const perfStats = await logParser.getLatestPerformanceStats();
  if (perfStats) return 'Online';

  // Fallback 2: service/process status
  const info = await service.getServiceInfo();
  const scumProcess = await service.getScumProcess();

  if (info.Status === 'Running' && scumProcess) return 'Unknown';
  return 'Offline';
}

/**
 * Read MaxPlayers from ServerSettings.ini. Mirrors Get-MaxPlayersFromConfig.
 */
function getMaxPlayersFromConfig() {
  const settingsPath = `${paths.savedDir}\\Config\\WindowsServer\\ServerSettings.ini`;
  try {
    if (!fs.existsSync(settingsPath)) return 64;
    // ServerSettings.ini may be UTF-8 or UTF-16LE depending on SCUM version — detect both.
    const buf = fs.readFileSync(settingsPath);
    const isUtf16 = buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE;
    const content = buf.toString(isUtf16 ? 'utf16le' : 'utf8').replace(/^﻿/, '');
    const match = content.match(/^scum\.MaxPlayers\s*=\s*(\d+)/m);
    return match ? parseInt(match[1], 10) : 64;
  } catch (err) {
    logger.warn(`[Monitoring] Error reading MaxPlayers from config: ${err.message}`);
    return 64;
  }
}

function getCurrentPlayerCount() {
  try {
    const db = require('../database');
    if (db.isScumDbAvailable()) return db.getOnlinePlayerCount() || 0;
  } catch { /* DB not ready yet */ }
  return 0;
}

function getServerPlayers() {
  try {
    const db = require('../database');
    if (db.isScumDbAvailable()) return db.getOnlinePlayers() || [];
  } catch { /* DB not ready yet */ }
  return [];
}

// System CPU/memory are read system-wide (per-process pcpu from si.processes()
// is unreliable — typically 0 — on Windows). Cached briefly so the multiple
// updateServerState() calls per monitoring tick don't each sample the CPU.
let systemLoadCache = { ts: 0, data: { CPU: 0, Memory: 0, MemoryTotal: 0 } };

async function getSystemLoad() {
  if (Date.now() - systemLoadCache.ts < 2000) return systemLoadCache.data;
  try {
    const [load, mem] = await Promise.all([si.currentLoad(), si.mem()]);
    systemLoadCache = {
      ts: Date.now(),
      data: {
        CPU: Math.round(load.currentLoad || 0),
        Memory: Math.round((mem.total - mem.available) / 1048576), // used MB (Task-Manager style)
        MemoryTotal: Math.round(mem.total / 1048576),
      },
    };
  } catch (err) {
    logger.warn(`[Monitoring] Error reading system load: ${err.message}`);
  }
  return systemLoadCache.data;
}

/**
 * Build a performance snapshot: system CPU/memory plus log-parsed FPS/entities.
 * Mirrors Get-ProcessPerformance.
 */
async function getProcessPerformance() {
  const performance = { ...(await getSystemLoad()), FPS: 0, Entities: 0 };

  let perfStats = null;
  const recent = logParser.getParsedEvents()
    .filter((e) => e.EventType === 'ServerOnline' && e.Data && e.Data.PerformanceStats)
    .sort((a, b) => b.Timestamp - a.Timestamp)[0];

  if (recent) {
    perfStats = recent.Data.PerformanceStats;
  } else {
    perfStats = await logParser.getLatestPerformanceStats();
  }

  if (perfStats) {
    performance.FPS = perfStats.AverageFPS || 0;
    const entities = perfStats.Entities || {};
    performance.Entities = (entities.Characters || 0) + (entities.Zombies || 0) + (entities.Vehicles || 0);
  }

  return performance;
}

/**
 * Refresh the shared serverState object from service + log parser data.
 * Mirrors Update-ServerState.
 */
async function updateServerState() {
  const info = await service.getServiceInfo();
  const scumProcess = await service.getScumProcess();

  let actualServerState = await getActualServerStateFromLogs();

  // Authoritative override: if the Windows service is not running and there is no
  // SCUMServer process, the server is definitively Offline — regardless of stale
  // "Global Stats" log events that getActualServerStateFromLogs may still consider
  // recent. Without this, a /server-stop can leave the state stuck at Online /
  // ShuttingDown and the "Server Offline" notification never fires.
  if (!scumProcess && ['Stopped', 'StopPending', 'Paused', 'NotFound', 'Unknown'].includes(info.Status)) {
    actualServerState = 'Offline';
  }

  let isRunning;
  switch (actualServerState) {
    case 'Online':
      // Log evidence that Global Stats are being emitted is authoritative — server IS running.
      isRunning = true;
      break;
    case 'Starting':
    case 'Loading':
    case 'ShuttingDown':
    case 'Offline':
    case 'Unknown':
    default:
      isRunning = false;
      break;
  }

  serverState.ServiceStatus = info.Status;
  serverState.ProcessId = scumProcess ? scumProcess.pid : null;
  serverState.ProcessName = scumProcess ? scumProcess.name : null;
  serverState.IsRunning = isRunning;
  serverState.OnlinePlayers = getCurrentPlayerCount();
  serverState.MaxPlayers = getMaxPlayersFromConfig();
  serverState.LastUpdate = new Date();
  serverState.ActualServerState = actualServerState;

  if (scumProcess) {
    serverState.Performance = { ...(await getProcessPerformance()), LastUpdate: new Date() };
  } else {
    const sys = await getSystemLoad();
    const perfStats = await logParser.getLatestPerformanceStats();
    const entities = perfStats && perfStats.Entities
      ? (perfStats.Entities.Characters || 0) + (perfStats.Entities.Zombies || 0) + (perfStats.Entities.Vehicles || 0)
      : 0;
    serverState.Performance = {
      ...sys,
      FPS: perfStats ? (perfStats.AverageFPS || 0) : 0,
      Entities: entities,
      LastUpdate: new Date(),
    };
  }
}

/**
 * Get a comprehensive status snapshot for the dashboard/API.
 * Mirrors Get-ServerStatus (database stats / game time are deferred to Phase 3).
 */
async function getServerStatus() {
  // updateServerState already determines and stores ActualServerState; reuse it
  // instead of recomputing (getActualServerStateFromLogs now does a process check).
  await updateServerState();

  return {
    IsRunning: serverState.IsRunning,
    OnlinePlayers: serverState.OnlinePlayers,
    MaxPlayers: serverState.MaxPlayers,
    LastUpdate: serverState.LastUpdate,

    ServiceStatus: serverState.ServiceStatus,
    ProcessId: serverState.ProcessId,
    ProcessName: serverState.ProcessName,

    ActualServerState: serverState.ActualServerState,

    Performance: serverState.Performance,

    Status: serverState.IsRunning ? 'Online' : 'Offline',
    PlayerCount: serverState.OnlinePlayers,
    IsOnline: serverState.IsRunning,
  };
}

/**
 * Check FPS-based performance thresholds and emit alerts (anti-spammed via cooldown).
 * Mirrors Test-PerformanceAlerts.
 */
async function testPerformanceAlerts() {
  if (!serverState.IsRunning) return;

  const info = await service.getServiceInfo();
  if (info.Status !== 'Running') return;

  const scumProcess = await service.getScumProcess();
  if (!scumProcess) return;

  const actualServerState = await getActualServerStateFromLogs();
  if (actualServerState !== 'Online') return;

  // Empty servers naturally run at lower FPS - only alert when players are connected
  if (!serverState.OnlinePlayers || serverState.OnlinePlayers <= 0) return;

  const thresholds = config.performanceThresholds;
  if (!thresholds) return;

  const alertThreshold = (config.performanceAlertThreshold || 'critical').toLowerCase();
  const cooldownMinutes = config.performanceAlertCooldownMinutes || 30;

  if (serverState.LastPerformanceAlert) {
    const minutesSince = (Date.now() - serverState.LastPerformanceAlert.getTime()) / 60000;
    if (minutesSince < cooldownMinutes) return;
  }

  const currentFPS = serverState.Performance.FPS;
  if (!currentFPS || currentFPS <= 0) return;

  let alertType = null;
  if (currentFPS <= thresholds.critical) {
    alertType = 'performance.critical';
  } else if (currentFPS <= thresholds.poor && ['poor', 'fair'].includes(alertThreshold)) {
    alertType = 'performance.poor';
  }

  if (alertType) {
    serverState.LastPerformanceAlert = new Date();
    events.emit('notification', {
      type: alertType,
      data: {
        timestamp: new Date().toISOString(),
        fps: currentFPS,
        players: serverState.OnlinePlayers,
        maxPlayers: serverState.MaxPlayers,
      },
    });
    logger.warn(`[Monitoring] Performance alert: ${alertType} (FPS=${currentFPS})`);
  }
}

// Only ever receives server.* lifecycle types. Dedupe against the last *lifecycle*
// notification specifically, so interleaving service/warning notifications don't let
// the same state (e.g. the ~5-minute periodic "Server Online" re-confirmation) slip
// through as a fresh notification.
function shouldSkipNotification(notificationType) {
  if (notificationType === serverState.LastServerLifecycleNotification) return true;

  if (notificationType === 'server.offline') {
    // Suppress a spurious offline right after a start sequence...
    if (['server.starting', 'server.loading'].includes(serverState.LastServerLifecycleNotification)) {
      return true;
    }
    // ...or within 30s of coming online (covers brief log gaps during restarts).
    if (serverState.LastServerLifecycleNotification === 'server.online') {
      const since = serverState.LastNotificationTime
        ? (Date.now() - serverState.LastNotificationTime.getTime()) / 1000
        : 600;
      if (since < 30) return true;
    }
  }

  return false;
}

function sendStateNotification(type) {
  const now = new Date();
  events.emit('notification', {
    type,
    data: {
      timestamp: now.toISOString(),
      players: serverState.OnlinePlayers,
      maxPlayers: serverState.MaxPlayers,
      cpu: serverState.Performance.CPU,
      memory: serverState.Performance.Memory,
      fps: serverState.Performance.FPS,
      entities: serverState.Performance.Entities,
    },
  });
  serverState.LastNotificationType = type;
  serverState.LastNotificationTime = now;
  if (type.startsWith('server.')) serverState.LastServerLifecycleNotification = type;
}

/**
 * Main per-tick monitoring update: crash detection/auto-repair, log-driven
 * state-change notifications, service-status notifications, performance alerts.
 * Mirrors Update-ServerMonitoring.
 */
async function updateServerMonitoring() {
  // First tick after the automation starts: establish the current state as the
  // baseline WITHOUT sending notifications. Otherwise an already-running server
  // looks like a fresh "Service Started" + "Server Online" transition at startup,
  // when only "Automation Manager Started" should be announced.
  if (!baselinePrimed) {
    baselinePrimed = true;
    try {
      const info = await service.getServiceInfo();
      const proc = await service.getScumProcess();
      serverState.LastNotifiedServiceStatus = info.Status;
      if (info.Status === 'Running' && proc) {
        serverState.IsRunning = true;
        serverState.LastServerLifecycleNotification = 'server.online';
        serverState.LastNotificationType = 'server.online';
        serverState.LastNotificationTime = new Date();
      }
      await updateServerState();
      // Prime the lifecycle baseline to the current state so the first real tick
      // doesn't re-announce it (e.g. a server that's offline at startup).
      if (!serverState.LastServerLifecycleNotification) {
        const lifecycleMap = {
          Offline: 'server.offline',
          ShuttingDown: 'server.shutting_down',
          Starting: 'server.starting',
          Loading: 'server.loading',
          Online: 'server.online',
        };
        serverState.LastServerLifecycleNotification = lifecycleMap[serverState.ActualServerState] || null;
      }
      events.emit('status', await getServerStatus());
    } catch (err) {
      logger.error(`[Monitoring] Baseline priming failed: ${err.message}`);
    }
    return {
      IsRunning: serverState.IsRunning,
      OnlinePlayers: serverState.OnlinePlayers,
      MaxPlayers: serverState.MaxPlayers,
      LastUpdate: serverState.LastUpdate,
    };
  }

  const previousServiceStatus = serverState.ServiceStatus;

  // Crash detection: service running but process dead
  const health = await service.testGameProcessHealth();
  if (!health.IsHealthy && health.ServiceStatus === 'Running' && !health.ProcessFound) {
    logger.error('[Monitoring] DETECTED: Service running but server process is DEAD - automatic crash detected!');

    if (config.autoRestart) {
      logger.info('[Monitoring] Auto-restart enabled - triggering automatic repair...');
      const repaired = await service.repairGameService(config.serviceName, 'automatic crash recovery');
      if (repaired) {
        logger.info('[Monitoring] Automatic server repair completed successfully');
        events.emit('notification', {
          type: 'admin.alert',
          data: {
            timestamp: new Date().toISOString(),
            message: 'Server automatically restarted after crash detection',
            severity: 'high',
          },
        });
      } else {
        logger.error('[Monitoring] Automatic server repair FAILED - manual intervention required!');
        events.emit('notification', {
          type: 'admin.alert',
          data: {
            timestamp: new Date().toISOString(),
            message: 'Server crashed and automatic repair failed. Manual intervention required!',
            severity: 'critical',
          },
        });
      }
    } else {
      logger.warn('[Monitoring] Auto-restart disabled - crash detected but no action taken');
      events.emit('notification', {
        type: 'admin.alert',
        data: {
          timestamp: new Date().toISOString(),
          message: 'Server process crashed but auto-restart is disabled. Manual intervention required!',
          severity: 'critical',
        },
      });
    }
  }

  // Consume any new log lines so getActualServerStateFromLogs (called inside
  // updateServerState) sees the latest events, and the live log feed gets them.
  // Notifications are sent below from the resulting actual server state — a single
  // source of truth — so transitions can't be lost or duplicated.
  logParser.readGameLogs();

  await updateServerState();

  // Announce the current server lifecycle state if it differs from the last one
  // we announced. Driven by the actual server state (Online/ShuttingDown/Offline/…)
  // and deduped purely via shouldSkipNotification (LastServerLifecycleNotification),
  // NOT gated by stateChangedViaLogs — otherwise a ShuttingDown log event on the
  // same tick the state becomes Offline would swallow the "Server Offline" notice.
  const lifecycleType = {
    Offline: 'server.offline',
    ShuttingDown: 'server.shutting_down',
    Starting: 'server.starting',
    Loading: 'server.loading',
    Online: 'server.online',
  }[serverState.ActualServerState];

  if (lifecycleType && !shouldSkipNotification(lifecycleType)) {
    sendStateNotification(lifecycleType);
  }

  // Windows service status transitions (admin-only). Guard against re-notifying
  // the same status — sc query can briefly flip to Unknown/NotFound and back,
  // which would otherwise resend e.g. "Service Stopping" several times.
  if (previousServiceStatus !== serverState.ServiceStatus
    && serverState.ServiceStatus !== serverState.LastNotifiedServiceStatus) {
    const serviceNotificationType = {
      Running: 'service.started',
      Stopped: 'service.stopped',
      StartPending: 'service.starting',
      StopPending: 'service.stopping',
    }[serverState.ServiceStatus];

    if (serviceNotificationType) {
      sendStateNotification(serviceNotificationType);
      serverState.LastNotifiedServiceStatus = serverState.ServiceStatus;
    }
  }

  await testPerformanceAlerts();

  events.emit('status', await getServerStatus());

  return {
    IsRunning: serverState.IsRunning,
    OnlinePlayers: serverState.OnlinePlayers,
    MaxPlayers: serverState.MaxPlayers,
    LastUpdate: serverState.LastUpdate,
  };
}

module.exports = {
  getActualServerStateFromLogs,
  getMaxPlayersFromConfig,
  getCurrentPlayerCount,
  getServerPlayers,
  getProcessPerformance,
  updateServerState,
  getServerStatus,
  testPerformanceAlerts,
  updateServerMonitoring,
};
