'use strict';

const { sendToChannel } = require('../notifications');
const { buildEventKillEmbed, buildEventKillEmbedSimple } = require('./embeds');

const TEXT1_RE = /^([\d.-]+):\s+Died:\s+([^(]+)\s+\((\d+)\),\s+Killer:\s+([^(]+)\s+\((\d+)\)\s+Weapon:\s+(.+?)\s+\[(.+?)\].*\(killer participating in game event\).*\(victim participating in game event\)/;
const TEXT2_RE = /\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]\[EVENT\]\s+(\w+)\s+\((\d+)\)\s+killed\s+(\w+)\s+\((\d+)\)\s+with\s+(.+?)\s+at distance\s+(\d+)m\s+\(both in game event\)/;
const JSON_PREFIX_RE = /^[\d\-\s:]+\s*(\{.*\})$/;

const DISTANCE_RE = /Distance:\s+([\d.]+)\s+m/;
const KILLER_LOC_RE = /KillerLoc\s*:\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)/;
const VICTIM_LOC_RE = /VictimLoc\s*:\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)/;

/**
 * Mirrors Format-EventWeaponName from eventkill-log.psm1.
 */
function formatEventWeaponName(weaponName, weaponType) {
  if (!weaponName) return 'Unknown';
  if (/^(Fists|Legs)$/i.test(weaponName)) return 'Bare Hands';
  let name = weaponName;
  name = name.replace(/^Weapon_/, '');
  name = name.replace(/_C$/, '');
  name = name.replace(/_/g, ' ');
  name = name.replace(/\s*\[.*?\]\s*$/, '');
  return name.trim() || weaponType || 'Unknown';
}

/**
 * Mirrors Get-EventActionType from eventkill-log.psm1: maps weapon type/name
 * to one of the EVENT_KILL_TYPE_META keys ('ranged' | 'melee' | 'event_kill').
 */
function getEventActionType(weaponType, weaponName) {
  if (weaponType && /projectile/i.test(weaponType)) return 'ranged';
  if ((weaponType && /melee/i.test(weaponType)) || (weaponName && /fists|legs/i.test(weaponName))) return 'melee';
  return 'event_kill';
}

function extractLocationText(content) {
  const km = KILLER_LOC_RE.exec(content || '');
  const vm = VICTIM_LOC_RE.exec(content || '');
  const killerLoc = km ? `X=${parseFloat(km[1])} Y=${parseFloat(km[2])} Z=${parseFloat(km[3])}` : null;
  const victimLoc = vm ? `X=${parseFloat(vm[1])} Y=${parseFloat(vm[2])} Z=${parseFloat(vm[3])}` : null;
  if (killerLoc && victimLoc) return `Killer: ${killerLoc} | Victim: ${victimLoc}`;
  if (killerLoc) return `Killer: ${killerLoc}`;
  if (victimLoc) return `Victim: ${victimLoc}`;
  return null;
}

function parseJsonLine(line) {
  const pm = JSON_PREFIX_RE.exec(line);
  if (!pm) return null;

  let data;
  try {
    data = JSON.parse(pm[1]);
  } catch {
    return null;
  }

  const killer = data.Killer;
  const victim = data.Killed || data.Victim;
  if (!killer || !victim || !data.Weapon) return null;

  const isInGameEvent = data.IsInGameEvent === true || (killer.IsInGameEvent && victim.IsInGameEvent);
  if (!isInGameEvent) return null;

  const killerName = killer.Name || killer.ProfileName || 'Unknown';
  const killerSteamId = killer.Id || killer.SteamId || '0';
  const victimName = victim.Name || victim.ProfileName || 'Unknown';
  const victimSteamId = victim.Id || victim.SteamId || '0';

  const weaponType = data.DamageType || 'Unknown';
  const weaponName = formatEventWeaponName(data.Weapon, weaponType);

  let distance = 0;
  let locationText = null;
  if (killer.ServerLocation && victim.ServerLocation) {
    const k = killer.ServerLocation;
    const v = victim.ServerLocation;
    distance = Math.round((Math.sqrt((k.X - v.X) ** 2 + (k.Y - v.Y) ** 2 + (k.Z - v.Z) ** 2) / 100) * 10) / 10;
    locationText = `Killer: X=${k.X} Y=${k.Y} Z=${k.Z} | Victim: X=${v.X} Y=${v.Y} Z=${v.Z}`;
  } else if (killer.Location && victim.Location) {
    const k = killer.Location;
    const v = victim.Location;
    distance = Math.round((Math.sqrt((k.X - v.X) ** 2 + (k.Y - v.Y) ** 2) / 100) * 10) / 10;
    locationText = `Killer: X=${k.X} Y=${k.Y} | Victim: X=${v.X} Y=${v.Y}`;
  }

  return {
    type: getEventActionType(weaponType, data.Weapon),
    killerName,
    killerSteamId: String(killerSteamId),
    victimName,
    victimSteamId: String(victimSteamId),
    weaponName,
    weaponType: weaponType.toLowerCase(),
    distance,
    locationText,
    isGameEvent: true,
  };
}

function parseTextLine(line) {
  let m = TEXT1_RE.exec(line);
  if (m) {
    const weaponName = m[6];
    const weaponType = m[7];
    return {
      type: getEventActionType(weaponType, weaponName),
      victimName: m[2].trim(),
      victimSteamId: m[3],
      killerName: m[4].trim(),
      killerSteamId: m[5],
      weaponName: formatEventWeaponName(weaponName, weaponType),
      weaponType: weaponType.toLowerCase(),
      distance: (() => {
        const dm = DISTANCE_RE.exec(line);
        return dm ? Math.round(parseFloat(dm[1]) * 10) / 10 : 0;
      })(),
      locationText: extractLocationText(line),
      isGameEvent: true,
    };
  }

  m = TEXT2_RE.exec(line);
  if (m) {
    const weaponName = m[6];
    return {
      type: 'ranged',
      killerName: m[2].trim(),
      killerSteamId: m[3],
      victimName: m[4].trim(),
      victimSteamId: m[5],
      weaponName: formatEventWeaponName(weaponName, 'Projectile'),
      weaponType: 'projectile',
      distance: parseFloat(m[7]),
      locationText: null,
      isGameEvent: true,
    };
  }

  return null;
}

/**
 * Parse one event-kill log line. Mirrors ConvertFrom-EventKillLine from eventkill-log.psm1.
 */
function parseLine(line) {
  if (JSON_PREFIX_RE.test(line)) {
    const event = parseJsonLine(line);
    if (event) return event;
  }
  return parseTextLine(line);
}

async function handle(event, client, config) {
  const feedCfg = config.SCUMLogFeatures.EventKillFeed;

  if (feedCfg.AdminEnabled && feedCfg.AdminChannel) {
    const embed = buildEventKillEmbed(event);
    await sendToChannel(client, feedCfg.AdminChannel, [], embed);
  }

  if (feedCfg.PlayersEnabled && feedCfg.PlayersChannel) {
    const embed = buildEventKillEmbedSimple(event);
    await sendToChannel(client, feedCfg.PlayersChannel, [], embed);
  }
}

module.exports = {
  name: 'eventkill',
  logPrefix: 'event_kill_',
  isEnabled: (config) => !!(config.SCUMLogFeatures.EventKillFeed && (config.SCUMLogFeatures.EventKillFeed.AdminEnabled || config.SCUMLogFeatures.EventKillFeed.PlayersEnabled)),
  parseLine,
  handle,
};
