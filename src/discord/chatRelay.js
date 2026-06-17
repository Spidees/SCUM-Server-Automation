'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../core/logger');
const { config, paths } = require('../core/config');

const STATE_FILE = path.join(paths.root, 'data', 'discord_chat_state.json');

const CHAT_LINE_RE = /^([\d.-]+):\s+'(\d+):([^(]+)\((\d+)\)'\s+'([^:]+):\s*(.+)'$/;
const CONNECT_CODE_RE = /^connect:[A-Z0-9]{6}$/;

let chatLogDir = null;
let currentLogFile = null;
let lastLineNumber = 0;
let tickTimer = null;

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      currentLogFile = state.currentLogFile || null;
      lastLineNumber = state.lastLineNumber || 0;
      if (currentLogFile && !fs.existsSync(currentLogFile)) {
        currentLogFile = null;
        lastLineNumber = 0;
      }
    }
  } catch (err) {
    logger.warn(`[Discord] Failed to load chat relay state: ${err.message}`);
    currentLogFile = null;
    lastLineNumber = 0;
  }
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ currentLogFile, lastLineNumber, lastUpdate: new Date().toISOString() }, null, 2));
  } catch (err) {
    logger.warn(`[Discord] Failed to save chat relay state: ${err.message}`);
  }
}

/**
 * Find the most recently created chat_*.log file. Mirrors Get-LatestChatLogFile.
 */
function getLatestChatLogFile() {
  try {
    const files = fs.readdirSync(chatLogDir)
      .filter((f) => /^chat_.*\.log$/i.test(f))
      .map((f) => {
        const full = path.join(chatLogDir, f);
        return { full, ctime: fs.statSync(full).ctimeMs };
      });
    if (!files.length) return null;
    files.sort((a, b) => b.ctime - a.ctime);
    return files[0].full;
  } catch (err) {
    logger.warn(`[Discord] Failed to list chat log directory: ${err.message}`);
    return null;
  }
}

/**
 * Parse one chat log line. Mirrors Parse-ChatLine.
 * Example: 2025.07.13-10.47.24: '76561198079911047:Nikynka(51)' 'Local: local'
 */
function parseChatLine(line) {
  const m = CHAT_LINE_RE.exec(line);
  if (!m) return null;
  return {
    timestamp: m[1],
    steamId: m[2],
    nickname: m[3].trim(),
    playerId: m[4],
    type: m[5].trim().toLowerCase(),
    message: m[6],
  };
}

/**
 * Apply Discord-safety filtering to a chat message/nickname. Mirrors
 * Apply-MessageFilter.
 */
function applyMessageFilter(text) {
  let result = text;
  // Collapse runs of 5+ repeated characters down to 3
  result = result.replace(/(.)\1{4,}/g, '$1$1$1');
  // Excessive caps -> title case
  if (/[A-Z]{10,}/.test(result)) {
    result = result.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }
  // Strip dangerous control chars (keep Unicode)
  // eslint-disable-next-line no-control-regex
  result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Escape Discord special sequences
  result = result.replace(/```/g, '`‌`‌`');
  result = result.replace(/@everyone/g, '@‌everyone');
  result = result.replace(/@here/g, '@‌here');

  result = result.trim();
  if (!result) result = '[filtered message]';
  return result;
}

/**
 * Read any new lines appended to the current chat log file since last check.
 * Mirrors Get-NewChatMessages.
 */
function getNewChatMessages() {
  const latest = getLatestChatLogFile();
  if (!latest) return [];

  if (currentLogFile !== latest) {
    logger.info(`[Discord] Switching to new chat log: ${latest}`);
    currentLogFile = latest;
    lastLineNumber = 0;
  }

  if (!fs.existsSync(currentLogFile)) return [];

  let content;
  try {
    content = fs.readFileSync(currentLogFile, 'utf16le');
  } catch (err) {
    logger.warn(`[Discord] Failed to read chat log: ${err.message}`);
    return [];
  }

  // Strip BOM and split into lines
  const allLines = content.replace(/^﻿/, '').split(/\r?\n/).filter((_, i, arr) => !(i === arr.length - 1 && arr[arr.length - 1] === ''));

  if (lastLineNumber >= allLines.length) return [];

  const newLines = allLines.slice(lastLineNumber);
  lastLineNumber = allLines.length;

  const chatTypes = (config.Discord && config.Discord.ChatRelay && config.Discord.ChatRelay.ChatTypes) || {};

  const messages = [];
  for (const line of newLines) {
    if (!line.trim() || line.includes('Game version:')) continue;
    const parsed = parseChatLine(line);
    if (!parsed) continue;
    if (CONNECT_CODE_RE.test(parsed.message.trim())) continue; // handled by connect code poller
    if (chatTypes[parsed.type]) messages.push(parsed);
  }
  return messages;
}

/**
 * Format and send a single chat message to the admin/player channels.
 * Mirrors Send-ChatMessageToDiscord.
 */
async function relayMessage(client, chatCfg, message) {
  const maxLength = chatCfg.MaxMessageLength || 500;
  let text = message.message;
  if (text.length > maxLength) text = `${text.slice(0, maxLength - 3)}...`;

  const nickname = applyMessageFilter(message.nickname);
  let body = applyMessageFilter(text).trim();
  if (!body) return;
  if (body.length > 2000) body = `${body.slice(0, 1997)}...`;

  const prefixByType = { squad: '[SQUAD] ', local: '[LOCAL] ', global: '[GLOBAL] ' };
  const adminContent = `${prefixByType[message.type] || ''}**${nickname}**: ${body}`;
  const playerContent = `**${nickname}**: ${body}`;

  const channels = chatCfg.Channels || {};

  if (channels.Admin) {
    try {
      const channel = await client.channels.fetch(channels.Admin);
      if (channel) await channel.send({ content: adminContent });
    } catch (err) {
      logger.warn(`[Discord] Failed to relay chat to admin channel: ${err.message}`);
    }
  }

  if (message.type === 'global' && channels.Players) {
    try {
      const channel = await client.channels.fetch(channels.Players);
      if (channel) await channel.send({ content: playerContent });
    } catch (err) {
      logger.warn(`[Discord] Failed to relay chat to players channel: ${err.message}`);
    }
  }
}

/**
 * Start the chat relay polling loop. Mirrors Initialize-ChatManager +
 * Update-ChatManager from chat/chat-manager.psm1.
 */
function startChatRelay(client) {
  const chatCfg = (config.Discord && config.Discord.ChatRelay) || {};
  if (!chatCfg.Enabled) {
    logger.info('[Discord] Chat relay disabled in config');
    return;
  }

  chatLogDir = path.join(paths.savedDir, 'SaveFiles', 'Logs');
  if (!fs.existsSync(chatLogDir)) {
    logger.warn(`[Discord] Chat log directory not found: ${chatLogDir} - chat relay disabled`);
    return;
  }

  loadState();

  const intervalMs = (chatCfg.UpdateInterval || 5) * 1000;
  tickTimer = setInterval(async () => {
    try {
      const messages = getNewChatMessages();
      if (!messages.length) return;
      for (const message of messages) {
        await relayMessage(client, chatCfg, message);
      }
      saveState();
    } catch (err) {
      logger.error(`[Discord] Chat relay tick failed: ${err.message}`);
    }
  }, intervalMs);

  logger.info(`[Discord] Chat relay started (polling every ${chatCfg.UpdateInterval || 5}s)`);
}

function stopChatRelay() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

module.exports = { startChatRelay, stopChatRelay, parseChatLine, applyMessageFilter };
