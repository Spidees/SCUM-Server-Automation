'use strict';

const { sendToChannel } = require('../notifications');
const { buildLoginEmbed } = require('./embeds');
const { upsertLoginEvent, upsertLogoutEvent } = require('../../database/serverDb');

const LOGIN_LINE_RE = /^(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\s+'([^\s]+)\s+(\d+):([^']+)'\s+(logged\s+(?:in|out))\s+at:\s+(.+)/;

/**
 * Parse one login log line. Mirrors ConvertFrom-LoginLine from login-log.psm1.
 */
function parseLine(line) {
  const m = LOGIN_LINE_RE.exec(line);
  if (!m) return null;

  const timestamp = m[1];
  const ipAddress = m[2];
  const steamId = m[3];
  let playerName = m[4].trim();
  const action = m[5].trim();
  const location = m[6].trim();

  let playerId = null;
  const nameMatch = /^(.+?)\((\d+)\)$/.exec(playerName);
  if (nameMatch) {
    playerName = nameMatch[1].trim();
    playerId = nameMatch[2];
  }

  const isLogin = /logged in/.test(action);
  const isDrone = /\(as drone\)/.test(location);
  const type = isLogin ? 'LOGIN' : 'LOGOUT';

  let coordinates = null;
  const coordMatch = /X=([0-9.-]+)\s+Y=([0-9.-]+)\s+Z=([0-9.-]+)/.exec(location);
  if (coordMatch) {
    coordinates = { x: parseFloat(coordMatch[1]), y: parseFloat(coordMatch[2]), z: parseFloat(coordMatch[3]) };
  }

  return {
    timestamp,
    ipAddress,
    steamId,
    playerName,
    playerId,
    type,
    isDrone,
    location: coordinates,
  };
}

/**
 * Convert SCUM timestamp "2025.07.19-10.01.13" to "2025-07-19 10:01:13".
 */
function formatTimestamp(timestamp) {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})$/.exec(timestamp);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
}

async function handle(event, client, config) {
  const feedCfg = (config.SCUMLogFeatures || {}).LoginFeed || {};

  const userId = event.playerId || event.steamId;
  const formattedTime = formatTimestamp(event.timestamp);
  if (userId && formattedTime) {
    if (event.type === 'LOGIN') {
      upsertLoginEvent(userId, { steamId: event.steamId, userName: event.playerName, userIp: event.ipAddress, loginTime: formattedTime });
    } else {
      upsertLogoutEvent(userId, { steamId: event.steamId, userName: event.playerName, userIp: event.ipAddress, logoutTime: formattedTime });
    }
  }

  if (!feedCfg.Enabled || !feedCfg.Channel) return;
  const embed = buildLoginEmbed(event);
  await sendToChannel(client, feedCfg.Channel, [], embed);
}

module.exports = {
  name: 'login',
  logPrefix: 'login_',
  isEnabled: (config) => !!(config.SCUMLogFeatures),
  parseLine,
  handle,
};
