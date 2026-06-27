'use strict';

const { sendToChannel } = require('../notifications');
const { buildRaidProtectionEmbed } = require('./embeds');
const { upsertRaidProtection, getRaidProtection, updateUserProfileFlagId, getSteamIdByFlagId } = require('../../database/serverDb');
const database = require('../../database');
const raidNotify = require('../raidNotify');

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

  const newType = protectionTypeMap[event.eventType] || 'unknown';
  const isEndingEvent = event.eventType === 'ProtectionEnded' || event.eventType === 'ProtectionExpired';
  const prevType = (getRaidProtection(event.flagId) || {}).protection_type || null;
  const wasActive = prevType === 'set' || prevType === 'started';

  // Suppress anything that isn't a real state transition, to avoid duplicate DMs:
  //  - SCUM re-emits "Flag protection finished ... user logged in" for every squad
  //    member that logs in (only notify the first one, while protection was active);
  //  - any event whose target state already equals the current state is a duplicate
  //    / re-processed log line — e.g. the same "started" written twice, or the whole
  //    file re-read after a log rotation. `prevType` is read before the upsert below,
  //    so the second of two identical events sees the state the first one set.
  const suppressEndedNotification = (isEndingEvent && !wasActive) || (prevType === newType);

  upsertRaidProtection(event.flagId, {
    ownerUserId: event.ownerId || null,
    x: event.locationX || null,
    y: event.locationY || null,
    z: event.locationZ || null,
    type: newType,
    duration: event.duration !== undefined ? event.duration : null,
    startDelay: event.startDelay !== undefined ? event.startDelay : null,
    lastLoggedInUserId: event.userId || null,
    reason: event.reason || '',
    lastUpdate: new Date().toISOString().replace('T', ' ').slice(0, 19),
  });

  if (event.eventType === 'ProtectionEnded' && event.userId) {
    updateUserProfileFlagId(event.userId, event.flagId);
  }

  // Resolve the player who interrupted protection by logging in (squad member).
  if (event.eventType === 'ProtectionEnded' && event.userId) {
    event.userName = database.getPlayerNameByProfileId(event.userId) || null;
  }

  // Discord relative timestamp (<t:…:R>) — a live countdown that updates in the
  // client, e.g. "in 60 minutes". `offsetSec` is seconds from now.
  const nowSec = Math.floor(Date.now() / 1000);
  const relTs = (offsetSec) => `<t:${nowSec + Math.max(0, Math.round(offsetSec))}:R>`;
  const absTs = (offsetSec) => `<t:${nowSec + Math.max(0, Math.round(offsetSec))}:f>`;

  // DM the flag owner about any raid-protection change to their base.
  const RAID_ALERTS = {
    ProtectionScheduled: {
      title: ':hourglass: Raid Protection Scheduled',
      description: (e) => `Your base protection will activate${e.startDelay ? ` ${absTs(e.startDelay)} (${relTs(e.startDelay)})` : ''} (all owners offline).`,
      color: 0xfee75c,
    },
    ProtectionActivated: {
      title: ':shield: Raid Protection Activated',
      description: (e) => `Your base is now **under raid protection**${e.duration ? ` — active until ${absTs(e.duration)} (${relTs(e.duration)})` : ''}.`,
      color: 0x57f287,
    },
    ProtectionEnded: {
      title: ':door: Raid Protection Ended',
      description: (e) => `Your base **raid protection has ended**${e.userName ? ` — **${e.userName}** logged in` : ''} — your base can now be raided.`,
      color: 0xe67e22,
    },
    ProtectionExpired: {
      title: ':hourglass_flowing_sand: Raid Protection Expired',
      description: () => 'Your base **raid protection expired** — your base can now be raided.',
      color: 0x808080,
    },
  };
  const alert = RAID_ALERTS[event.eventType];
  if (alert && !suppressEndedNotification) {
    // owner id is a SCUM user_profile.id; resolve to its Steam ID.
    const ownerSteam = database.getSteamIdByProfileId(event.ownerId) || getSteamIdByFlagId(event.flagId);
    if (ownerSteam) {
      await raidNotify.dispatchOwnerAlert(client, {
        type: 'raid',
        ownerSteamId: ownerSteam,
        title: alert.title,
        description: alert.description(event),
        color: alert.color,
        location: { x: event.locationX, y: event.locationY, z: event.locationZ },
      });
    }
  }

  if (suppressEndedNotification) return;

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
