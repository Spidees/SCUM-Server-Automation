'use strict';

const { sendToChannel } = require('../notifications');
const { buildViolationsEmbed } = require('./embeds');

const KICK_RE = /^(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\s+AConZGameMode::KickPlayer:\s+User id:\s+'(\d+)',\s+Reason:\s+(.+)$/;
const BAN_RE = /^(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\s+AConZGameMode::BanPlayerById:\s+User id:\s+'(\d+)'/;
const AMMO_RE = /^(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\s+\[AmmoCountMismatch\]\s+Ammo count violation detected:\s+Weapon:\s+([^,]+),\s+PrisonerLocation:\s+X=([^\s]+)\s+Y=([^\s]+)\s+Z=([^,]+),.*?User:\s+([^(]+)\((\d+),\s*(\d+)\)/;
const INTERACTION_RE = /^(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\s+\[(OutOfInteractionRange[^\]]*)\].*?Distance:\s+([^\s]+)\s+m,\s+User:\s+([^(]+)\((\d+),\s*(\d+)\)/;

const KICK_REASON_MAP = {
  NetErrorUnauthorized: 'kicked (unauthorized)',
  NetErrorTimeout: 'kicked (timeout)',
  NetErrorPingTooHigh: 'kicked (high ping)',
  GenericKickReason: 'kicked (generic)',
};

/**
 * Parse one violations log line. Mirrors ConvertFrom-ViolationsLine from violations-log.psm1.
 */
function parseLine(line) {
  let m;

  if ((m = KICK_RE.exec(line))) {
    const reason = m[3].trim();
    const action = KICK_REASON_MAP[reason] || `kicked (${reason})`;
    return {
      type: 'KICK',
      steamId: m[2],
      playerName: null,
      playerId: null,
      reason,
      action,
      violationType: null,
      weapon: null,
      locationX: null,
      locationY: null,
      locationZ: null,
      distance: undefined,
    };
  }

  if ((m = BAN_RE.exec(line))) {
    return {
      type: 'BAN',
      steamId: m[2],
      playerName: null,
      playerId: null,
      reason: 'Banned',
      action: 'banned permanently',
      violationType: null,
      weapon: null,
      locationX: null,
      locationY: null,
      locationZ: null,
      distance: undefined,
    };
  }

  if ((m = AMMO_RE.exec(line))) {
    const weaponRaw = m[2].trim();
    const weapon = weaponRaw.replace(/^Weapon_/, '').replace(/_/g, ' ');
    const x = parseFloat(m[3]);
    const y = parseFloat(m[4]);
    const z = parseFloat(m[5]);
    return {
      type: 'VIOLATION',
      steamId: m[8],
      playerName: m[6].trim(),
      playerId: m[7],
      reason: 'Ammo violation',
      action: `ammo count violation with ${weapon} at X=${x} Y=${y} Z=${z}`,
      violationType: 'AmmoCountMismatch',
      weapon,
      locationX: String(x),
      locationY: String(y),
      locationZ: String(z),
      distance: undefined,
    };
  }

  if ((m = INTERACTION_RE.exec(line))) {
    const dist = Math.round(parseFloat(m[3]) * 100) / 100;
    return {
      type: 'VIOLATION',
      steamId: m[6],
      playerName: m[4].trim(),
      playerId: m[5],
      reason: 'Interaction violation',
      action: `interaction range violation ${dist}m away`,
      violationType: m[2],
      weapon: null,
      locationX: null,
      locationY: null,
      locationZ: null,
      distance: dist,
    };
  }

  return null;
}

async function handle(event, client, config) {
  const feedCfg = config.SCUMLogFeatures.ViolationsFeed;
  if (!feedCfg.Enabled || !feedCfg.Channel) return;

  const embed = buildViolationsEmbed(event);
  await sendToChannel(client, feedCfg.Channel, [], embed);
}

module.exports = {
  name: 'violations',
  logPrefix: 'violations_',
  isEnabled: (config) => !!(config.SCUMLogFeatures.ViolationsFeed && config.SCUMLogFeatures.ViolationsFeed.Enabled),
  parseLine,
  handle,
};
