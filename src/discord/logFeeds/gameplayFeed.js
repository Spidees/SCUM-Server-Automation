'use strict';

const { sendToChannel } = require('../notifications');
const { buildGameplayEmbed } = require('./embeds');

const TIMESTAMP_RE = /^([\d.-]+):\s+(.+)/;

const BUNKER_RE = /^\[LogBunkerLock\]\s+(.+)/;
const BUNKER_DETAIL_RE = /^([A-Z]\d+)\s+Bunker\s+(Activated|is Active)\s+(.+)/;
const EXPLOSIVES_RE = /^\[LogExplosives\]\s+(Crafted|Pin pulled|Detonated)\.\s+User:\s+([^(]+)\s+\((\d+),\s+(\d+)\)\.\s+(.+)/;
const DIALPAD_STANDALONE_RE = /^\[LogMinigame\]\s+\[DialPadMinigame\]\s+User:\s+([^(]+)\s+\((\d+),\s+(\d+)\)\.\s+(.+)/;
const TRAP_RE = /^\[LogTrap\]\s+(Crafted|Armed)\.\s+User:\s+([^(]+)\s+\((\d+),\s+(\d+)\)\.\s+(.+)/;
const TRAP_TRIGGERED_RE = /^\[LogTrap\]\s+Triggered\.\s+User:\s+([^(]+)\s+\((\d+),\s+(\d+)\)\.\s+Trap name:\s+(.+?)\.\s+Owner:\s+([^(]+)\s+\((\d+),\s+(\d+)\)\.\s+Location:\s+X=([^Y]+)\s+Y=([^Z]+)\s+Z=(.+)/;
const TRAP_DISARMED_RE = /^\[LogTrap\]\s+(Disarmed)\.\s+User:\s+([^(]+)\s+\((\d+),\s+(\d+)\)\.\s+(.+)/;
const MINIGAME_RE = /^\[LogMinigame\]\s+\[([^\]]+)\]\s+User:\s+([^(]+)\s+\((\d+),\s+(\d+)\)\.\s+Success:\s+(Yes|No)\.(.*)/;
const FLAG_RE = /^\[LogBaseBuilding\]\s+\[Flag\]\s+(Overtaken|Destroyed)\.?\s*(.*)/;
const FLAG_OVERTAKEN_RE = /New owner:\s+(\d+)\s+\((\d+),\s+([^)]+)\)\.\s+Old owner:\s+(\d+)\s+\((\d+),\s+([^)]+)\)/;
const FLAG_DESTROYED_RE = /FlagId:\s+(\d+)\.\s+Owner:\s+(\d+)\s+\((\d+),\s+([^)]+)\)/;
const BOMB_DEFUSAL_RE = /^\[LogMinigame\]\s+\[BP_BombDefusalMinigame_C\]\s+User:\s+([^(]+)\s+\((\d+),\s+(\d+)\)\.\s+Success:\s+(Yes|No)\.\s+Elapsed time:\s+([\d.]+)\.\s+Failed attempts:\s+(\d+)\.\s+Target object:\s+([^.]+)\.\s+User owner:\s+([^.]+)\.\s+Location:\s+(.+)/;

const LOCATION_RE = /X=([-\d.]+)\s+Y=([-\d.]+)\s+Z=([-\d.]+)/;

function parseLocation(text) {
  const m = LOCATION_RE.exec(text || '');
  if (!m) return null;
  return { x: parseFloat(m[1]), y: parseFloat(m[2]), z: parseFloat(m[3]) };
}

/**
 * Parse one gameplay log line. Mirrors ConvertFrom-GameplayLine from gameplay-log.psm1.
 */
function parseLine(line) {
  const tm = TIMESTAMP_RE.exec(line);
  if (!tm) return null;
  const content = tm[2];

  let m;

  if ((m = BUNKER_RE.exec(content))) {
    const dm = BUNKER_DETAIL_RE.exec(m[1]);
    if (!dm) return null;
    return {
      type: 'bunker',
      source: 'SYSTEM',
      playerName: 'SYSTEM',
      activity: `bunker ${dm[1]} ${dm[2].toLowerCase()}`,
      details: dm[3].trim(),
      location: parseLocation(dm[3]),
    };
  }

  if ((m = EXPLOSIVES_RE.exec(content))) {
    const action = m[1];
    const playerName = m[2].trim();
    const playerId = m[3];
    const steamId = m[4];
    const details = m[5];

    let itemName = 'explosive';
    let dm;
    if (action === 'Crafted' && (dm = /Ignitable explosive name:\s+(.+?)\.\s+Location:/.exec(details))) itemName = dm[1];
    else if ((action === 'Pin pulled' || action === 'Detonated') && (dm = /Grenade name:\s+(.+?)\.\s+Location:/.exec(details))) itemName = dm[1];

    const actionDescByAction = { Crafted: `crafted ${itemName}`, 'Pin pulled': `armed ${itemName}`, Detonated: `detonated ${itemName}` };
    const activity = actionDescByAction[action] || `${action.toLowerCase()} ${itemName}`;

    return {
      type: 'explosive',
      playerName,
      playerId,
      steamId,
      activity,
      itemName,
      action,
      details,
      location: parseLocation(details),
    };
  }

  if ((m = DIALPAD_STANDALONE_RE.exec(content))) {
    const playerName = m[1].trim();
    const playerId = m[2];
    const steamId = m[3];
    const details = m[4];

    let combination = '';
    let attempt = '';
    let elapsedTime = null;
    let dm;
    if ((dm = /Guessed Combination:\s+(\d+)\./.exec(details))) combination = dm[1];
    if ((dm = /(First try|Elapsed time since first try:\s+([\d.]+))/.exec(details))) {
      if (dm[1] === 'First try') attempt = 'First attempt';
      else {
        elapsedTime = parseFloat(dm[2]);
        attempt = 'Follow-up attempt';
      }
    }

    let activity = `tried combination ${combination}`;
    if (attempt === 'First attempt') activity += ' (first attempt)';
    else if (elapsedTime) activity += ` (after ${elapsedTime}s)`;

    return {
      type: 'dialpad_attempt',
      playerName,
      playerId,
      steamId,
      activity,
      combination,
      attempt,
      elapsedTime,
      details,
      location: parseLocation(details),
    };
  }

  if ((m = TRAP_TRIGGERED_RE.exec(content))) {
    const playerName = m[1].trim();
    const playerId = m[2];
    const steamId = m[3];
    const trapName = m[4];
    const ownerName = m[5].trim();
    const ownerPlayerId = m[6];
    const ownerSteamId = m[7];
    const x = parseFloat(m[8]);
    const y = parseFloat(m[9]);
    const z = parseFloat(m[10]);

    return {
      type: 'trap',
      playerName,
      playerId,
      steamId,
      activity: 'triggered trap',
      trapName,
      action: 'Triggered',
      ownerName: `${ownerName} (${ownerPlayerId}, ${ownerSteamId})`,
      location: { x, y, z },
    };
  }

  if ((m = TRAP_RE.exec(content)) || (m = TRAP_DISARMED_RE.exec(content))) {
    const action = m[1];
    const playerName = m[2].trim();
    const playerId = m[3];
    const steamId = m[4];
    const details = m[5];

    let trapName = 'trap';
    const dm = /Trap name:\s+(.+?)\.\s+Location:/.exec(details);
    if (dm) trapName = dm[1];

    const verb = action === 'Disarmed' ? 'disarmed trap' : `${action.toLowerCase()} trap`;

    return {
      type: 'trap',
      playerName,
      playerId,
      steamId,
      activity: `${verb}: ${trapName}`,
      trapName,
      action,
      details,
      location: parseLocation(details),
    };
  }

  if ((m = MINIGAME_RE.exec(content))) {
    const minigameType = m[1];
    const playerName = m[2].trim();
    const playerId = m[3];
    const steamId = m[4];
    const success = m[5] === 'Yes';
    const info = m[6];

    let elapsedTime = null;
    let dm;
    if ((dm = /Elapsed time:\s+(\d+(?:\.\d+)?)/.exec(info))) elapsedTime = parseFloat(dm[1]);

    let failedAttempts = null;
    if ((dm = /Failed attempts:\s+(\d+)/.exec(info))) failedAttempts = parseInt(dm[1], 10);

    let targetObject = null;
    let lockType = null;
    if ((dm = /Target object:\s+([^(]+)\([^)]*\)[^.]*\.\s+Lock type:\s+(\w+)/.exec(info))) {
      targetObject = dm[1].trim().replace(/^BP_?/, '').replace(/Lockpick_/, '').replace(/_C$/, '').replace(/_/g, ' ');
      lockType = dm[2];
    }

    let category = 'minigame';
    let activity;
    if (/Lockpicking/.test(minigameType)) {
      category = 'lockpicking';
      activity = success ? 'successfully picked lock' : 'failed to pick lock';
      if (lockType && targetObject) activity += ` (${lockType} on ${targetObject})`;
    } else if (/QuestBook/.test(minigameType)) {
      category = 'quest';
      activity = success ? 'completed quest book puzzle' : 'failed quest book puzzle';
    } else if (/Bunker/.test(minigameType)) {
      category = 'bunker_minigame';
      if (/Voltage/.test(minigameType)) activity = success ? 'solved voltage puzzle' : 'voltage puzzle failed';
      else if (/Switchboard/.test(minigameType)) activity = success ? 'solved switchboard puzzle' : 'switchboard puzzle failed';
      else if (/DialPad/.test(minigameType)) activity = success ? 'cracked dial pad' : 'dial pad attempt failed';
      else activity = success ? 'solved bunker puzzle' : 'bunker puzzle failed';
    } else if (/DialPad|DialLock/.test(minigameType)) {
      category = 'dialpad';
      if (success) {
        activity = 'cracked dial lock';
      } else {
        activity = 'failed to crack dial lock';
        if (failedAttempts > 0) activity += ` (${failedAttempts} attempts)`;
      }
      if ((dm = /Guessed Combination:\s+(\d+)/.exec(info))) activity += ` (tried ${dm[1]})`;
    } else {
      activity = success ? 'completed minigame' : 'failed minigame';
      if (minigameType) {
        const cleanType = minigameType.replace(/^BP_?/, '').replace(/_C$/, '').replace(/_/g, ' ');
        activity += ` (${cleanType})`;
      }
    }

    return {
      type: category,
      playerName,
      playerId,
      steamId,
      activity,
      minigame: minigameType,
      success,
      elapsedTime,
      failedAttempts,
      targetObject,
      lockType,
      details: info,
      location: parseLocation(info),
    };
  }

  if ((m = FLAG_RE.exec(content))) {
    const action = m[1];
    const details = m[2];

    if (action === 'Overtaken') {
      const dm = FLAG_OVERTAKEN_RE.exec(details);
      if (!dm) return null;
      const newOwnerSteamId = dm[1];
      const newOwnerPlayerId = dm[2];
      const newOwnerName = dm[3];
      const oldOwnerName = dm[6];

      let flagId = '';
      const fm = /FlagId:\s+(\d+)/.exec(details);
      if (fm) flagId = fm[1];

      return {
        type: 'flag',
        playerName: newOwnerName,
        playerId: newOwnerPlayerId,
        steamId: newOwnerSteamId,
        activity: `captured flag from ${oldOwnerName}${flagId ? ` (Flag #${flagId})` : ''}`,
        flagId,
        details: `Old owner: ${oldOwnerName} (${dm[4]})`,
        location: parseLocation(details),
      };
    }

    if (action === 'Destroyed') {
      const dm = FLAG_DESTROYED_RE.exec(details);
      if (!dm) return null;
      const flagId = dm[1];
      const ownerSteamId = dm[2];
      const ownerPlayerId = dm[3];
      const ownerName = dm[4];

      return {
        type: 'flag',
        playerName: ownerName,
        playerId: ownerPlayerId,
        steamId: ownerSteamId,
        activity: `lost flag #${flagId} (destroyed)`,
        flagId,
        details: 'Flag destroyed',
        location: parseLocation(details),
      };
    }

    return null;
  }

  if ((m = BOMB_DEFUSAL_RE.exec(content))) {
    const playerName = m[1].trim();
    const playerId = m[2];
    const steamId = m[3];
    const success = m[4] === 'Yes';
    const elapsedTime = parseFloat(m[5]);
    const failedAttempts = parseInt(m[6], 10);
    const targetObject = m[7];
    const ownerName = m[8];
    const locationText = m[9];

    const bombType = targetObject.replace(/_C_\d+$/, '').replace(/_C$/, '').replace(/_/g, ' ');
    const activity = success ? `successfully defused ${bombType}` : `failed to defuse ${bombType}`;

    return {
      type: 'bomb_defusal',
      playerName,
      playerId,
      steamId,
      activity,
      success,
      elapsedTime,
      failedAttempts,
      bombType,
      ownerName,
      targetObject,
      location: parseLocation(locationText),
    };
  }

  return null;
}

async function handle(event, client, config) {
  const feedCfg = config.SCUMLogFeatures.GameplayFeed;
  if (!feedCfg.Enabled || !feedCfg.Channel) return;

  const embed = buildGameplayEmbed(event);
  await sendToChannel(client, feedCfg.Channel, [], embed);
}

module.exports = {
  name: 'gameplay',
  logPrefix: 'gameplay_',
  isEnabled: (config) => !!(config.SCUMLogFeatures.GameplayFeed && config.SCUMLogFeatures.GameplayFeed.Enabled),
  parseLine,
  handle,
};
