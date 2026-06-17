'use strict';

const { sendToChannel } = require('../notifications');
const { buildChestEmbed } = require('./embeds');

const CLAIM_RE = /^Chest\s+\(entity\s+id:\s+(\d+)\)\s+ownership\s+claimed\.\s+Owner:\s+(\d+)\s+\((\d+),\s+(.+?)\)\.\s+Location:\s+X=([-\d.]+)\s+Y=([-\d.]+)\s+Z=([-\d.]+)/;
const TRANSFER_RE = /^Chest\s+\(entity\s+id:\s+(\d+)\)\s+ownership\s+changed\.\s+Old\s+owner:\s+(\d+)\s+\((\d+),\s+(.+?)\)\s+->\s+New\s+owner:\s+(\d+)\s+\((\d+),\s+(.+?)\)\.\s+Location:\s+X=([-\d.]+)\s+Y=([-\d.]+)\s+Z=([-\d.]+)/;
const CLAIM_UNCLAIMED_RE = /^Chest\s+\(entity\s+id:\s+(\d+)\)\s+ownership\s+changed\.\s+Old\s+owner:\s+NULL,\s+\((\d+),\s+NULL\)\s+->\s+New\s+owner:\s+(\d+)\s+\((\d+),\s+(.+?)\)\.\s+Location:\s+X=([-\d.]+)\s+Y=([-\d.]+)\s+Z=([-\d.]+)/;
const UNCLAIM_RE = /^Chest\s+\(entity\s+id:\s+(\d+)\)\s+ownership\s+changed\.\s+Old\s+owner:\s+(\d+)\s+\((\d+),\s+(.+?)\)\s+->\s+New\s+owner:\s+NULL,\s+\((-?\d+),\s+NULL\)\.\s+Location:\s+X=([-\d.]+)\s+Y=([-\d.]+)\s+Z=([-\d.]+)/;
const NULL_TO_NULL_RE = /^Chest\s+\(entity\s+id:\s+(\d+)\)\s+ownership\s+changed\.\s+Old\s+owner:\s+NULL,\s+\((\d+),\s+NULL\)\s+->\s+New\s+owner:\s+NULL,\s+\((-?\d+),\s+NULL\)\.\s+Location:\s+X=([-\d.]+)\s+Y=([-\d.]+)\s+Z=([-\d.]+)/;

const TIMESTAMP_RE = /^([\d.-]+):\s+(.+)$/;

/**
 * Parse one chest ownership log line. Mirrors ConvertFrom-ChestLine from chest-log.psm1.
 */
function parseLine(line) {
  const tm = TIMESTAMP_RE.exec(line);
  if (!tm) return null;
  const content = tm[2].trim();

  let m;
  if ((m = CLAIM_RE.exec(content))) {
    return {
      type: 'claim',
      playerName: m[4].trim(),
      steamId: m[2],
      playerId: m[3],
      entityId: m[1],
      action: `claimed ownership of chest (ID: ${m[1]})`,
      location: { x: m[5], y: m[6], z: m[7] },
    };
  }

  if ((m = TRANSFER_RE.exec(content))) {
    return {
      type: 'transfer',
      playerName: m[7].trim(),
      steamId: m[5],
      playerId: m[6],
      entityId: m[1],
      oldOwner: m[4].trim(),
      action: `took ownership of chest (ID: ${m[1]}) from ${m[4].trim()}`,
      location: { x: m[8], y: m[9], z: m[10] },
    };
  }

  if ((m = CLAIM_UNCLAIMED_RE.exec(content))) {
    return {
      type: 'claim_unclaimed',
      playerName: m[5].trim(),
      steamId: m[3],
      playerId: m[4],
      entityId: m[1],
      action: `claimed unclaimed chest (ID: ${m[1]})`,
      location: { x: m[6], y: m[7], z: m[8] },
    };
  }

  if ((m = UNCLAIM_RE.exec(content))) {
    return {
      type: 'unclaim',
      playerName: m[4].trim(),
      steamId: m[2],
      playerId: m[3],
      entityId: m[1],
      action: `lost ownership of chest (ID: ${m[1]}) - chest destroyed or unclaimed`,
      location: { x: m[6], y: m[7], z: m[8] },
    };
  }

  if (NULL_TO_NULL_RE.exec(content)) {
    return null;
  }

  return null;
}

async function handle(event, client, config) {
  const feedCfg = config.SCUMLogFeatures.ChestFeed;
  if (!feedCfg.Enabled || !feedCfg.Channel) return;

  const embed = buildChestEmbed(event);
  await sendToChannel(client, feedCfg.Channel, [], embed);
}

module.exports = {
  name: 'chest',
  logPrefix: 'chest_ownership_',
  isEnabled: (config) => !!(config.SCUMLogFeatures.ChestFeed && config.SCUMLogFeatures.ChestFeed.Enabled),
  parseLine,
  handle,
};
