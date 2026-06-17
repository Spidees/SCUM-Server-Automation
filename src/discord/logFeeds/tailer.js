'use strict';

const fs = require('fs');
const path = require('path');
const fsExtra = require('fs-extra');
const logger = require('../../core/logger');
const { paths } = require('../../core/config');

/**
 * Directory containing SCUM's per-feature log files. Same directory used by
 * the chat relay (chatRelay.js).
 */
function getLogsDir() {
  return path.join(paths.savedDir, 'SaveFiles', 'Logs');
}

/**
 * Find the most recently created `{prefix}*.log` file in dir, or null.
 * Mirrors Get-ChildItem | Sort-Object CreationTime -Descending | Select -First 1.
 */
function findLatestLogFile(dir, prefix) {
  try {
    const files = fs.readdirSync(dir)
      .filter((f) => f.toLowerCase().startsWith(prefix.toLowerCase()) && f.toLowerCase().endsWith('.log'))
      .map((f) => {
        const full = path.join(dir, f);
        return { full, ctime: fs.statSync(full).ctimeMs };
      });
    if (!files.length) return null;
    files.sort((a, b) => b.ctime - a.ctime);
    return files[0].full;
  } catch {
    return null;
  }
}

/**
 * Read a UTF-16LE log file and return all lines (BOM stripped, trailing
 * empty line from the final newline removed).
 */
function readAllLines(filePath) {
  const content = fs.readFileSync(filePath, 'utf16le');
  const lines = content.replace(/^﻿/, '').split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function stateFilePath(name) {
  return path.join(paths.root, 'data', `logfeed_${name}_state.json`);
}

function loadFeedState(name) {
  const file = stateFilePath(name);
  try {
    if (fs.existsSync(file)) {
      const state = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {
        currentLogFile: state.currentLogFile || null,
        lastLineNumber: state.lastLineNumber || 0,
      };
    }
  } catch (err) {
    logger.warn(`[LogFeeds:${name}] Failed to load state: ${err.message}`);
  }
  return { currentLogFile: null, lastLineNumber: 0 };
}

function saveFeedState(name, state) {
  try {
    const file = stateFilePath(name);
    fsExtra.ensureDirSync(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify({
      currentLogFile: state.currentLogFile,
      lastLineNumber: state.lastLineNumber,
      lastUpdate: new Date().toISOString(),
    }, null, 2));
  } catch (err) {
    logger.warn(`[LogFeeds:${name}] Failed to save state: ${err.message}`);
  }
}

const liveStates = new Map();

/**
 * Poll one feed: find its latest log file, read any new lines, parse and
 * dispatch events. Mirrors the per-module Update-* loops backed by
 * Read-LogStreamLines / Get-LogFileLineCount in log-streaming.psm1.
 */
async function pollFeed(feedDef, client, config) {
  const dir = getLogsDir();
  const latest = findLatestLogFile(dir, feedDef.logPrefix);
  if (!latest) return;

  let state = liveStates.get(feedDef.name);
  if (!state) {
    state = loadFeedState(feedDef.name);
    liveStates.set(feedDef.name, state);
  }

  let allLines;
  try {
    allLines = readAllLines(latest);
  } catch (err) {
    logger.warn(`[LogFeeds:${feedDef.name}] Failed to read ${latest}: ${err.message}`);
    return;
  }

  if (state.currentLogFile === null) {
    // First run ever for this feed: skip existing content, only react to new lines.
    state.currentLogFile = latest;
    state.lastLineNumber = allLines.length;
    saveFeedState(feedDef.name, state);
    return;
  }

  if (state.currentLogFile !== latest) {
    logger.info(`[LogFeeds:${feedDef.name}] Switching to new log file: ${latest}`);
    state.currentLogFile = latest;
    state.lastLineNumber = 0;
  }

  if (state.lastLineNumber >= allLines.length) {
    saveFeedState(feedDef.name, state);
    return;
  }

  const newLines = allLines.slice(state.lastLineNumber);
  state.lastLineNumber = allLines.length;

  for (const line of newLines) {
    if (!line.trim() || line.includes('Game version:')) continue;
    let event = null;
    try {
      event = feedDef.parseLine(line);
    } catch (err) {
      logger.warn(`[LogFeeds:${feedDef.name}] Failed to parse line: ${err.message}`);
      continue;
    }
    if (!event) continue;
    try {
      await feedDef.handle(event, client, config);
    } catch (err) {
      logger.error(`[LogFeeds:${feedDef.name}] Failed to handle event: ${err.message}`);
    }
  }

  saveFeedState(feedDef.name, state);
}

module.exports = {
  getLogsDir,
  findLatestLogFile,
  readAllLines,
  loadFeedState,
  saveFeedState,
  pollFeed,
};
