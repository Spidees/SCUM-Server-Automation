'use strict';

const fs = require('fs');
const si = require('systeminformation');
const logger = require('../core/logger');
const events = require('../core/events');
const { config, paths } = require('../core/config');

const MAX_PARSED_EVENTS = 100;
const SAME_EVENT_LOG_INTERVAL_MS = 5 * 60 * 1000;
const PERF_CACHE_VALIDITY_MS = 5 * 60 * 1000;

// Module state - mirrors script-scoped variables in parser.psm1
let logLinePosition = 0;
let lastLogFileSize = 0;
let logFilePath = null;
let lastParsedEvents = [];
let lastKnownPerformanceStats = null;
let lastLoggedEventType = null;
let lastEventTimestamp = null;
let eventCount = 0;

const TIMESTAMP_RE = /^\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):(\d{3})\]/;

function parseLineTimestamp(line) {
  const m = line.match(TIMESTAMP_RE);
  if (!m) return null;
  const [, year, month, day, hour, minute, second, ms] = m;
  // SCUM writes log timestamps in UTC (e.g. a file created at 16:00 local / UTC+2 is named
  // ...140025...). Parse as UTC so comparisons against Date.now() (local epoch) are correct —
  // otherwise events land hours in the past and the <=10min "recent" checks in monitoring.js
  // always fail, breaking log-based state detection.
  return new Date(Date.UTC(
    Number(year), Number(month) - 1, Number(day),
    Number(hour), Number(minute), Number(second), Number(ms),
  ));
}

/**
 * Mirrors Initialize-LogReaderModule. Starts reading from the end of the
 * file so existing history isn't replayed as "new" events.
 */
function initializeLogReaderModule(logPath = paths.logPath) {
  logFilePath = logPath;
  lastParsedEvents = [];
  lastKnownPerformanceStats = null;
  lastLoggedEventType = null;
  lastEventTimestamp = null;
  eventCount = 0;

  try {
    if (fs.existsSync(logPath)) {
      const stat = fs.statSync(logPath);
      lastLogFileSize = stat.size;
      const content = fs.readFileSync(logPath, 'utf8');
      logLinePosition = content.split(/\r?\n/).length - 1; // number of complete lines so far
    } else {
      lastLogFileSize = 0;
      logLinePosition = 0;
    }
  } catch (err) {
    logger.warn(`[LogParser] Failed to initialize log reader: ${err.message}`);
    lastLogFileSize = 0;
    logLinePosition = 0;
  }

  logger.info(`[LogParser] Initialized at line ${logLinePosition} (file size ${lastLogFileSize} bytes)`);
}

/**
 * Read any new lines appended to the log file since the last read.
 * Detects log rotation via a shrinking file size and resets state.
 * Mirrors Read-NewLogLines.
 */
function readNewLogLines(logPath = logFilePath) {
  if (!logPath) return [];

  try {
    if (!fs.existsSync(logPath)) return [];

    const stat = fs.statSync(logPath);
    const currentSize = stat.size;

    if (currentSize < lastLogFileSize) {
      logger.info('[LogParser] Detected log rotation (file size shrank), resetting state');
      logLinePosition = 0;
      lastParsedEvents = [];
      lastKnownPerformanceStats = null;
    }

    lastLogFileSize = currentSize;

    const content = fs.readFileSync(logPath, 'utf8');
    const allLines = content.split(/\r?\n/);
    // Drop trailing empty element caused by a final newline
    if (allLines.length > 0 && allLines[allLines.length - 1] === '') {
      allLines.pop();
    }

    if (logLinePosition >= allLines.length) {
      return [];
    }

    const newLines = allLines.slice(logLinePosition);
    logLinePosition = allLines.length;
    return newLines;
  } catch (err) {
    logger.warn(`[LogParser] Error reading log file: ${err.message}`);
    return [];
  }
}

/**
 * Determine performance status from FPS using configured thresholds.
 * Mirrors Get-PerformanceStatus.
 */
function getPerformanceStatus(fps) {
  if (!fps || fps <= 0) return 'Unknown';

  const thresholds = (config.performanceThresholds) || {
    excellent: 30, good: 20, fair: 15, poor: 10,
  };

  if (fps >= thresholds.excellent) return 'Excellent';
  if (fps >= thresholds.good) return 'Good';
  if (fps >= thresholds.fair) return 'Fair';
  if (fps >= thresholds.poor) return 'Poor';
  return 'Critical';
}

/**
 * Parse a "LogSCUM: Global Stats:" line into performance stats.
 * Mirrors Parse-GlobalStatsLine.
 */
function parseGlobalStatsLine(line) {
  const stats = {
    AverageFPS: 0,
    MinFPS: 0,
    MaxFPS: 0,
    AverageFrameTime: 0,
    PlayerCount: 0,
    Entities: { Characters: 0, Zombies: 0, Vehicles: 0 },
    PerformanceStatus: 'Unknown',
  };

  const fpsMatch = line.match(/\(\s*([0-9.]+)FPS\)/);
  if (fpsMatch) {
    const fps = Math.round(parseFloat(fpsMatch[1]) * 10) / 10;
    stats.AverageFPS = fps;
    stats.MinFPS = fps;
    stats.MaxFPS = fps;
  }

  const frameTimeMatch = line.match(/([0-9.]+)ms\s*\(\s*[0-9.]+FPS\)/);
  if (frameTimeMatch) {
    stats.AverageFrameTime = Math.round(parseFloat(frameTimeMatch[1]) * 100) / 100;
  }

  const playerMatch = line.match(/P:\s*(\d+)\s*\(\s*\d+\)/);
  if (playerMatch) stats.PlayerCount = parseInt(playerMatch[1], 10);

  const charMatch = line.match(/C:\s*(\d+)\s*\(\s*\d+\)/);
  if (charMatch) stats.Entities.Characters = parseInt(charMatch[1], 10);

  const zombieMatch = line.match(/Z:\s*(\d+)\s*\(\s*\d+\)/);
  if (zombieMatch) stats.Entities.Zombies = parseInt(zombieMatch[1], 10);

  const vehicleMatch = line.match(/V:\s*(\d+)/);
  if (vehicleMatch) stats.Entities.Vehicles = parseInt(vehicleMatch[1], 10);

  stats.PerformanceStatus = getPerformanceStatus(stats.AverageFPS);

  return stats;
}

const SHUTTING_DOWN_RE = /LogCore: Warning: \*\*\* INTERRUPTED \*\*\*.*SHUTTING DOWN/;

/**
 * Parse a single log line into a state event, or null if it doesn't match
 * any known pattern. Mirrors Parse-LogLine.
 */
function parseLogLine(line, silent = false) {
  let eventType = null;
  let data = {};

  if (line.includes('Log file open') || line.includes('LogInit: Display: Starting Game')) {
    eventType = 'ServerStarting';
  } else if (line.includes('LogGameState: Match State Changed from EnteringMap to WaitingToStart')) {
    eventType = 'ServerLoading';
  } else if (line.includes('LogSCUM: Global Stats:')) {
    eventType = 'ServerOnline';
    const performanceStats = parseGlobalStatsLine(line);
    data.PerformanceStats = performanceStats;
    lastKnownPerformanceStats = { stats: performanceStats, timestamp: new Date() };
  } else if (SHUTTING_DOWN_RE.test(line)) {
    eventType = 'ServerShuttingDown';
  } else if (line.includes('LogExit: Exiting.') || line.includes('Log file closed')) {
    // NOTE: do NOT treat "LogWorld: UWorld::CleanupWorld ... bSessionEnded=true" as Offline.
    // SCUM emits CleanupWorld during normal world transitions while the server is fully online,
    // so it created fresh ServerOffline events that overrode the real Online state until the next
    // "Global Stats" line (~60s later) arrived — making the dashboard/Discord show OFFLINE.
    // Real shutdowns log "LogExit: Exiting." / "Log file closed"; crashes are caught by the
    // process-health check in service.js.
    eventType = 'ServerOffline';
  }

  if (!eventType) return null;

  const timestamp = parseLineTimestamp(line) || new Date();
  const event = {
    EventType: eventType,
    Timestamp: timestamp,
    Line: line,
    Data: data,
    IsStateChange: false,
  };

  const now = Date.now();
  const sameType = eventType === lastLoggedEventType;
  const timeSinceLast = lastEventTimestamp ? (now - lastEventTimestamp) : Infinity;

  if (!sameType || timeSinceLast > SAME_EVENT_LOG_INTERVAL_MS) {
    event.IsStateChange = true;
    lastLoggedEventType = eventType;
    lastEventTimestamp = now;
    eventCount = 0;

    if (!silent) {
      logger.info(`[LogParser] State change detected: ${eventType}`);
    }
  } else {
    eventCount += 1;
    if (!silent && eventCount % 10 === 0) {
      logger.debug(`[LogParser] ${eventType} occurred ${eventCount} times since last state change`);
    }
  }

  lastParsedEvents.push(event);
  if (lastParsedEvents.length > MAX_PARSED_EVENTS) {
    lastParsedEvents.shift();
  }

  return event;
}

/**
 * Read and parse all new lines since the last call.
 * Mirrors Read-GameLogs.
 */
function readGameLogs() {
  const newLines = readNewLogLines();
  const parsedEvents = [];
  for (const line of newLines) {
    events.emit('logline', line);
    const event = parseLogLine(line);
    if (event) parsedEvents.push(event);
  }
  return parsedEvents;
}

/**
 * Batch-analyze a set of log lines (used for diagnostics).
 * Mirrors Analyze-RecentLogLines.
 */
function analyzeRecentLogLines(lines) {
  const result = {
    LastEventType: null,
    HasGlobalStats: false,
    HasShutdown: false,
    HasExit: false,
    LatestPerformanceStats: null,
    EventsDetected: [],
  };

  for (const line of lines) {
    const event = parseLogLine(line, true);
    if (!event) continue;

    result.EventsDetected.push(event);
    result.LastEventType = event.EventType;

    if (event.EventType === 'ServerOnline') {
      result.HasGlobalStats = true;
      result.LatestPerformanceStats = event.Data.PerformanceStats;
    }
    if (event.EventType === 'ServerShuttingDown') result.HasShutdown = true;
    if (event.EventType === 'ServerOffline') result.HasExit = true;
  }

  return result;
}

/**
 * Return the most recently cached performance stats, but only if recent
 * and the SCUMServer process is still running. Mirrors Get-LatestPerformanceStats.
 */
async function getLatestPerformanceStats() {
  if (!lastKnownPerformanceStats) return null;

  if (Date.now() - lastKnownPerformanceStats.timestamp.getTime() > PERF_CACHE_VALIDITY_MS) {
    return null;
  }

  try {
    const list = await si.processes();
    const running = list.list.some((p) => /^SCUMServer/i.test(p.name));
    if (!running) return null;
  } catch {
    return null;
  }

  return lastKnownPerformanceStats.stats;
}

/**
 * Mirrors Get-ParsedEvents.
 */
function getParsedEvents(count = MAX_PARSED_EVENTS) {
  if (count >= lastParsedEvents.length) return lastParsedEvents.slice();
  return lastParsedEvents.slice(-count);
}

/**
 * Mirrors Get-LogReaderStats.
 */
function getLogReaderStats() {
  return {
    LogFilePath: logFilePath,
    LogLinePosition: logLinePosition,
    LastLogFileSize: lastLogFileSize,
    ParsedEventsCount: lastParsedEvents.length,
    LastLoggedEventType: lastLoggedEventType,
  };
}

/**
 * Mirrors Reset-LogParserState.
 */
function resetLogParserState() {
  logLinePosition = 0;
  lastLogFileSize = 0;
  lastParsedEvents = [];
  lastKnownPerformanceStats = null;
  lastLoggedEventType = null;
  lastEventTimestamp = null;
  eventCount = 0;
}

module.exports = {
  initializeLogReaderModule,
  readNewLogLines,
  readGameLogs,
  parseLogLine,
  parseGlobalStatsLine,
  getPerformanceStatus,
  analyzeRecentLogLines,
  getLatestPerformanceStats,
  getParsedEvents,
  getLogReaderStats,
  resetLogParserState,
};
