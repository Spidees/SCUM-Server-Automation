'use strict';

const fs = require('fs');
const path = require('path');
const { config, paths } = require('./config');

const LEVEL_PRIORITY = { Debug: 0, Info: 1, Warning: 2, Error: 3 };

function timestamp() {
  const d = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fileTimestamp() {
  const d = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function rotateIfNeeded() {
  if (!config.logRotationEnabled) return;
  try {
    if (!fs.existsSync(paths.appLogFile)) return;
    const maxSizeMB = config.maxLogFileSizeMB || 100;
    const sizeMB = fs.statSync(paths.appLogFile).size / (1024 * 1024);
    if (sizeMB > maxSizeMB) {
      const rotated = paths.appLogFile.replace(/\.log$/, `_${fileTimestamp()}.log`);
      fs.renameSync(paths.appLogFile, rotated);
    }
  } catch {
    // Ignore rotation errors to avoid recursive logging issues
  }
}

/**
 * Mirrors Write-Log from modules/core/common/common.psm1
 */
function log(message, level = 'Info') {
  const line = `${timestamp()} ${message}`;

  try {
    fs.mkdirSync(path.dirname(paths.appLogFile), { recursive: true });
    rotateIfNeeded();
    fs.appendFileSync(paths.appLogFile, line + '\n', 'utf8');
  } catch {
    // Silently ignore log file errors to prevent recursion
  }

  const consoleLevel = config.consoleLogLevel || 'Info';
  if (LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[consoleLevel]) {
    switch (level) {
      case 'Error':
        console.error(line);
        break;
      case 'Warning':
        console.warn(line);
        break;
      default:
        console.log(line);
    }
  }
}

module.exports = {
  log,
  debug: (msg) => log(msg, 'Debug'),
  info: (msg) => log(msg, 'Info'),
  warn: (msg) => log(msg, 'Warning'),
  error: (msg) => log(msg, 'Error'),
};
