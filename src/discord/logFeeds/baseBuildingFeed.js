'use strict';

// Player DM alerts when someone destroys part of their base. The destruction log
// has no owner id, so we resolve the owner from SCUM.db: the destroyed element is
// already gone, but the closest surviving base_element of the same base gives the
// owner. Throttled per owner so a multi-wall raid doesn't spam dozens of DMs.

const raidNotify = require('../raidNotify');
const database = require('../../database');

// Header line: "<ts>: Wall Cement (14), {X=.. Y=.. Z=..|..}:" — element name + id + location.
const HEADER_RE = /^[\d.-]+:\s+(.+?)\s+\((\d+)\),\s+\{X=([-\d.]+)\s+Y=([-\d.]+)\s+Z=([-\d.]+)/;

function parseLine(line) {
  const m = HEADER_RE.exec(line);
  if (!m) return null;
  return {
    elementName: m[1].trim(),
    elementId: m[2],
    location: { x: parseFloat(m[3]), y: parseFloat(m[4]), z: parseFloat(m[5]) },
  };
}

async function handle(event, client) {
  const loc = event.location;
  const ownerProfileId = database.getBaseElementOwnerProfileId(loc.x, loc.y, loc.z);
  if (ownerProfileId == null) return;
  const ownerSteam = database.getSteamIdByProfileId(ownerProfileId);
  if (!ownerSteam) return;

  await raidNotify.dispatchOwnerAlert(client, {
    type: 'raid',
    ownerSteamId: ownerSteam,
    title: ':boom: Base Under Attack',
    description: `Your base is being **raided** — structures are being destroyed (e.g. **${event.elementName}**).`,
    color: 0xed4245,
    location: loc,
    // one base-attack DM per owner per 5 minutes
    cooldownKey: `base:${ownerSteam}`,
    cooldownMs: 5 * 60 * 1000,
  });
}

module.exports = {
  name: 'basebuilding',
  logPrefix: 'base_building_destruction_',
  isEnabled: (config) => !!config.SCUMLogFeatures,
  parseLine,
  handle,
};
