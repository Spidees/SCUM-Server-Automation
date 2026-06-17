'use strict';

const { sendToChannel } = require('../notifications');
const { buildRaidProtectionEmbed } = require('./embeds');
const { upsertRaidProtection, updateUserProfileFlagId } = require('../../database/serverDb');

const TIMESTAMP_RE = /^(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\s+(.+)$/;

const LOC_RE = /X=([^\s>]+)\s+Y=([^\s>]+)\s+Z=([^\s>]+)/;

const SCHEDULED_RE = /Flag protection set, flag id: (\d+), location: <X=([^>]+) Y=([^>]+) Z=([^>]+)>, owner id: (\d+), protection duration: (\d+)s, start in: (\d+)s, all flag owners offline/;
const ENDED_LOGIN_RE = /Flag protection finished, flag id: (\d+), location: <X=([^>]+) Y=([^>]+) Z=([^>]+)>, owner id: (\d+), protection duration: (\d+)s, user: (\d+) logged in/;
const EXPIRED_RE = /Flag protection finished, flag id: (\d+), location: <X=([^>]+) Y=([^>]+) Z=([^>]+)>, owner id: (\d+), protection duration: (\d+)s,\s*$/;
const ACTIVATED_RE = /Flag protection started, flag id: (\d+), location: <X=([^>]+) Y=([^>]+) Z=([^>]+)>, owner id: (\d+), protection duration: (\d+)s,\s*(.*)/;

/**
 * Parse one raid protection log line. Mirrors ConvertFrom-RaidProtectionLine from raidprotection-log.psm1.
 */
function parseLine(line) {
  const tm = TIMESTAMP_RE.exec(line);
  if (!tm) return null;
  const content = tm[2];

  let m;

  if ((m = SCHEDULED_RE.exec(content))) {
    const duration = parseInt(m[6], 10);
    const startDelay = parseInt(m[7], 10);
    return {
      eventType: 'ProtectionScheduled',
      flagId: m[1],
      locationX: m[2],
      locationY: m[3],
      locationZ: m[4],
      ownerId: m[5],
      duration,
      startDelay,
      reason: 'all_owners_offline',
    };
  }

  if ((m = ENDED_LOGIN_RE.exec(content))) {
    return {
      eventType: 'ProtectionEnded',
      flagId: m[1],
      locationX: m[2],
      locationY: m[3],
      locationZ: m[4],
      ownerId: m[5],
      duration: parseInt(m[6], 10),
      userId: m[7],
      reason: 'player_login',
    };
  }

  if ((m = EXPIRED_RE.exec(content))) {
    return {
      eventType: 'ProtectionExpired',
      flagId: m[1],
      locationX: m[2],
      locationY: m[3],
      locationZ: m[4],
      ownerId: m[5],
      duration: parseInt(m[6], 10),
      reason: 'duration_expired',
    };
  }

  if ((m = ACTIVATED_RE.exec(content))) {
    const additionalInfo = m[7].trim();
    const reason = /abnormal server shutdown/.test(additionalInfo) ? 'server_shutdown' : 'scheduled';
    return {
      eventType: 'ProtectionActivated',
      flagId: m[1],
      locationX: m[2],
      locationY: m[3],
      locationZ: m[4],
      ownerId: m[5],
      duration: parseInt(m[6], 10),
      reason,
    };
  }

  return null;
}

async function handle(event, client, config) {
  const protectionTypeMap = {
    ProtectionScheduled: 'set',
    ProtectionActivated: 'started',
    ProtectionEnded: 'finished',
    ProtectionExpired: 'finished',
  };

  upsertRaidProtection(event.flagId, {
    ownerUserId: event.ownerId || null,
    x: event.locationX || null,
    y: event.locationY || null,
    z: event.locationZ || null,
    type: protectionTypeMap[event.eventType] || 'unknown',
    duration: event.duration !== undefined ? event.duration : null,
    startDelay: event.startDelay !== undefined ? event.startDelay : null,
    lastLoggedInUserId: event.userId || null,
    reason: event.reason || '',
    lastUpdate: new Date().toISOString().replace('T', ' ').slice(0, 19),
  });

  if (event.eventType === 'ProtectionEnded' && event.userId) {
    updateUserProfileFlagId(event.userId, event.flagId);
  }

  const feedCfg = (config.SCUMLogFeatures || {}).RaidProtectionFeed || {};
  if (!feedCfg.Enabled || !feedCfg.Channel) return;

  const embed = buildRaidProtectionEmbed(event);
  await sendToChannel(client, feedCfg.Channel, [], embed);
}

module.exports = {
  name: 'raidprotection',
  logPrefix: 'raid_protection_',
  isEnabled: (config) => !!(config.SCUMLogFeatures),
  parseLine,
  handle,
};
