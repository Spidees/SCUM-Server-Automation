'use strict';

const { sendToChannel } = require('../notifications');
const { buildKillEmbed, buildKillEmbedSimple } = require('./embeds');

const TIMESTAMP_RE = /^([\d.-]+):\s+(.+)/;

const SUICIDE_RE = /^Comitted suicide\.\s+User:\s+([^(]+)\s+\((\d+),\s+(\d+)\),\s+\[([^\]]+)\]\.\s+Location:\s+X=([^\s]+)\s+Y=([^\s]+)\s+Z=([^.]+)\./;
const PVP_RE = /^Died:\s+([^(]+)\s+\((\d+)\),\s+Killer:\s+([^(]+)\s+\((\d+)\)\s+Weapon:\s+([^\s]+)\s+\[([^\]]+)\]\s+S\[(.+?)\]\s+C\[(.+?)\]/;
const PVP_ALT_RE = /^Died:\s+([^(]+)\s+\((\d+)\),\s+Killer:\s+([^(]+)\s+\((\d+)\)\s+Weapon:\s*\s+S:\[(.+?)\]/;
const PVP_EXPLOSIVE_RE = /^Died:\s+([^(]+)\s+\((\d+)\),\s+Killer:\s+([^(]+)\s+\((\d+)\)\s+Weapon:\s+([^\s]+)\s+\[([^\]]+)\]\s+S:\[\s*VictimLoc:\s*([-\d.,\s]+)\s*Distance:\s*([\d.]+)\s*m\]/;

const DISTANCE_RE = /Distance:\s+([\d.]+)\s+m/;
const KILLER_LOC_RE = /KillerLoc\s*:\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)/;
const VICTIM_LOC_RE = /VictimLoc\s*:\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)/;

/**
 * Extract a clean item id from a weapon-name string for display/icon lookup.
 * Mirrors the cleanWeaponId extraction in Format-WeaponName/Get-WeaponImage.
 */
function cleanWeaponId(weaponName) {
  if (!weaponName) return null;
  let m = /^(.+?)_C_\d+\s+\[(.*?)\]$/.exec(weaponName);
  if (m) return `${m[1]}_C`;
  m = /^(.+?)\s+\[(.*?)\]$/.exec(weaponName);
  if (m) return m[1];
  return weaponName;
}

function extractDistance(locationString) {
  const m = DISTANCE_RE.exec(locationString || '');
  if (!m) return 0;
  return Math.round(parseFloat(m[1]) * 10) / 10;
}

function extractLocations(serverLocs) {
  const km = KILLER_LOC_RE.exec(serverLocs || '');
  const vm = VICTIM_LOC_RE.exec(serverLocs || '');
  const killerLoc = km ? `X=${parseFloat(km[1])} Y=${parseFloat(km[2])} Z=${parseFloat(km[3])}` : null;
  const victimLoc = vm ? `X=${parseFloat(vm[1])} Y=${parseFloat(vm[2])} Z=${parseFloat(vm[3])}` : null;
  if (killerLoc && victimLoc) return `Killer: ${killerLoc} | Victim: ${victimLoc}`;
  if (killerLoc) return `Killer: ${killerLoc}`;
  if (victimLoc) return `Victim: ${victimLoc}`;
  return null;
}

function parseTextLine(line) {
  const tm = TIMESTAMP_RE.exec(line);
  if (!tm) return null;
  const content = tm[2];

  let m;
  if ((m = SUICIDE_RE.exec(content))) {
    return {
      type: 'suicide',
      playerName: m[1].trim(),
      steamId: m[3],
      playerId: m[2],
      location: { x: parseFloat(m[5]), y: parseFloat(m[6]), z: parseFloat(m[7]) },
    };
  }

  if ((m = PVP_RE.exec(content))) {
    const weaponName = m[5];
    const weaponType = m[6];
    return {
      type: 'kill',
      victimName: m[1].trim(),
      victimSteamId: m[2],
      killerName: m[3].trim(),
      killerSteamId: m[4],
      weaponName: cleanWeaponId(weaponName),
      weaponType: weaponType.toLowerCase(),
      distance: extractDistance(m[7]),
      locationText: extractLocations(m[7]),
    };
  }

  if ((m = PVP_ALT_RE.exec(content))) {
    return {
      type: 'kill',
      victimName: m[1].trim(),
      victimSteamId: m[2],
      killerName: m[3].trim(),
      killerSteamId: m[4],
      weaponName: 'Unknown Weapon',
      weaponType: 'unknown',
      distance: extractDistance(m[5]),
      locationText: extractLocations(m[5]),
    };
  }

  if ((m = PVP_EXPLOSIVE_RE.exec(content))) {
    const weaponName = m[5];
    const weaponType = m[6];
    const victimLoc = m[7];
    let locationText = null;
    const lm = /([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)/.exec(victimLoc);
    if (lm) locationText = `Victim at X=${parseFloat(lm[1])} Y=${parseFloat(lm[2])} Z=${parseFloat(lm[3])}`;
    return {
      type: 'kill',
      victimName: m[1].trim(),
      victimSteamId: m[2],
      killerName: m[3].trim(),
      killerSteamId: m[4],
      weaponName: cleanWeaponId(`${weaponName} [${weaponType}]`),
      weaponType: weaponType.toLowerCase(),
      distance: Math.round(parseFloat(m[8]) * 10) / 10,
      locationText,
    };
  }

  return null;
}

function parseJsonLine(line) {
  let data;
  try {
    data = JSON.parse(line);
  } catch {
    return null;
  }
  if (!data.Killer || !data.Victim) return null;

  const killerName = data.Killer.ProfileName || 'Unknown';
  const killerSteamId = data.Killer.UserId || '';
  const victimName = data.Victim.ProfileName || 'Unknown';
  const victimSteamId = data.Victim.UserId || '';

  const isSuicide = killerSteamId === victimSteamId || killerName === victimName;

  let weaponName = null;
  let weaponType = 'unknown';
  if (data.Weapon) {
    weaponName = cleanWeaponId(data.Weapon);
    const wm = /\[(.*?)\]/.exec(data.Weapon);
    if (wm) weaponType = wm[1].toLowerCase();
  }

  let distance = 0;
  let killerLoc = null;
  let victimLoc = null;
  if (data.Killer.ServerLocation) {
    const l = data.Killer.ServerLocation;
    killerLoc = `X=${l.X} Y=${l.Y} Z=${l.Z}`;
  }
  if (data.Victim.ServerLocation) {
    const l = data.Victim.ServerLocation;
    victimLoc = `X=${l.X} Y=${l.Y} Z=${l.Z}`;
  }
  if (data.Killer.ServerLocation && data.Victim.ServerLocation) {
    const k = data.Killer.ServerLocation;
    const v = data.Victim.ServerLocation;
    distance = Math.round((Math.sqrt((k.X - v.X) ** 2 + (k.Y - v.Y) ** 2 + (k.Z - v.Z) ** 2) / 100) * 10) / 10;
  }

  let locationText = null;
  if (killerLoc && victimLoc) locationText = `Killer: ${killerLoc} | Victim: ${victimLoc}`;
  else if (killerLoc) locationText = `Killer: ${killerLoc}`;
  else if (victimLoc) locationText = `Victim: ${victimLoc}`;

  if (isSuicide) {
    return {
      type: 'suicide',
      playerName: victimName,
      steamId: victimSteamId,
      playerId: null,
      location: null,
      locationText,
    };
  }

  return {
    type: 'kill',
    victimName,
    victimSteamId,
    killerName,
    killerSteamId,
    weaponName: weaponName || 'Unknown Weapon',
    weaponType,
    distance,
    locationText,
  };
}

/**
 * Parse one kill log line. Mirrors ConvertFrom-KillLine from kill-log.psm1.
 */
function parseLine(line) {
  if (/^\{.*\}$/.test(line)) return parseJsonLine(line);
  return parseTextLine(line);
}

// In-memory delay queue for players-channel kill announcements.
const playersDelayQueue = [];

async function handle(event, client, config) {
  const feedCfg = config.SCUMLogFeatures.KillFeed;

  if (feedCfg.AdminEnabled && feedCfg.AdminChannel) {
    const embed = buildKillEmbed(event);
    await sendToChannel(client, feedCfg.AdminChannel, [], embed);
  }

  if (feedCfg.PlayersEnabled && feedCfg.PlayersChannel) {
    if (feedCfg.PlayersDelayEnabled && feedCfg.PlayersDelaySeconds > 0) {
      playersDelayQueue.push({ event, queuedAt: Date.now() });
    } else {
      const embed = buildKillEmbedSimple(event, null, !!feedCfg.PlayersShowLocation);
      await sendToChannel(client, feedCfg.PlayersChannel, [], embed);
    }
  }
}

/**
 * Send any queued kill events whose delay has elapsed. Mirrors
 * Process-PlayersDelayQueue from kill-log.psm1.
 */
async function processDelayQueue(client, config) {
  const feedCfg = config.SCUMLogFeatures.KillFeed;
  if (!feedCfg.PlayersEnabled || !feedCfg.PlayersChannel || !feedCfg.PlayersDelayEnabled) return;

  const delayMs = (feedCfg.PlayersDelaySeconds || 0) * 1000;
  const now = Date.now();
  const ready = [];
  for (let i = playersDelayQueue.length - 1; i >= 0; i--) {
    if (now - playersDelayQueue[i].queuedAt >= delayMs) {
      ready.unshift(playersDelayQueue.splice(i, 1)[0]);
    }
  }

  for (const item of ready) {
    const delaySeconds = Math.round((now - item.queuedAt) / 1000);
    const embed = buildKillEmbedSimple(item.event, { delaySeconds }, !!feedCfg.PlayersShowLocation);
    await sendToChannel(client, feedCfg.PlayersChannel, [], embed);
  }
}

module.exports = {
  name: 'kill',
  logPrefix: 'kill_',
  isEnabled: (config) => !!(config.SCUMLogFeatures.KillFeed && (config.SCUMLogFeatures.KillFeed.AdminEnabled || config.SCUMLogFeatures.KillFeed.PlayersEnabled)),
  parseLine,
  handle,
  processDelayQueue,
};
