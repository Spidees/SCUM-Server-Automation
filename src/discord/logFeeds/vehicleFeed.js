'use strict';

const { sendToChannel } = require('../notifications');
const { buildVehicleEmbed } = require('./embeds');

const VEHICLE_RE = /^(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\s+\[([^\]]+)\]\s+([^.]+)\.\s+VehicleId:\s+(\d+)\.\s+Owner:\s+(.+?)\.\s+Location:\s+X=([^\s]+)\s+Y=([^\s]+)\s+Z=([^\s]+)/;

/**
 * Parse one vehicle destruction log line. Mirrors ConvertFrom-VehicleLine from vehicle-log.psm1.
 */
function parseLine(line) {
  const m = VEHICLE_RE.exec(line);
  if (!m) return null;

  const eventType = m[2];
  const vehicleRaw = m[3].trim();
  const vehicleId = m[4];
  const ownerPart = m[5].trim();
  const locationX = m[6];
  const locationY = m[7];
  const locationZ = m[8];

  const vehicleName = vehicleRaw.replace(/_ES$/, '').replace(/_/g, ' ');

  let ownerName = 'Unknown Owner';
  let ownerSteamId = null;
  let ownerPlayerId = null;

  if (ownerPart === 'N/A') {
    ownerName = 'No Owner';
  } else {
    let dm;
    if ((dm = /^NULL,\s*\((\d+),\s*NULL\)/.exec(ownerPart))) {
      ownerPlayerId = dm[1];
      ownerName = 'Unknown Player';
    } else if ((dm = /^(\d+)\s+\((\d+),\s*([^)]+)\)/.exec(ownerPart))) {
      ownerSteamId = dm[1];
      ownerPlayerId = dm[2];
      ownerName = dm[3].trim();
    }
  }

  return {
    eventType,
    vehicleName,
    vehicleId,
    ownerName,
    ownerSteamId,
    ownerPlayerId,
    locationX,
    locationY,
    locationZ,
  };
}

async function handle(event, client, config) {
  const feedCfg = config.SCUMLogFeatures.VehicleFeed;
  if (!feedCfg.Enabled || !feedCfg.Channel) return;

  const embed = buildVehicleEmbed(event);
  await sendToChannel(client, feedCfg.Channel, [], embed);
}

module.exports = {
  name: 'vehicle',
  logPrefix: 'vehicle_destruction_',
  isEnabled: (config) => !!(config.SCUMLogFeatures.VehicleFeed && config.SCUMLogFeatures.VehicleFeed.Enabled),
  parseLine,
  handle,
};
