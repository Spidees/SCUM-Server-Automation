'use strict';

const { sendToChannel } = require('../notifications');
const { buildFamePointsEmbed } = require('./embeds');

const AWARD_RE = /^([\d.-]+):\s+Player\s+([^(]+)\((\d+)\)\s+was awarded\s+([\d.]+)\s+fame points for\s+(.+)$/;
const PERIODIC_RE = /^Player\s+([^(]+)\((\d+)\)\s+was awarded\s+([\d.]+)\s+fame points in 10 minutes for a total of\s+([\d.]+)/;
const DETAIL_RE = /^(BaseFameInflux|OnlineFlagOwnersAwardAwarded|DistanceTraveledOnFoot|PuppetKill|FirearmKill|MeleeKill|ItemLooted|RecoveredFromInfection|MinigameCompleted|LockPicked|BandageApplied|LandedWithParachute|BlueprintBuilt|BaseElementBuilt|ItemCrafted|KillClaimed|DistanceTraveledWhileMounted):\s+([\d.]+)/;

/**
 * Categorize an award reason into an action type + human-readable description.
 * Mirrors the if/elseif chain in ConvertFrom-FamePointsLine.
 */
function categorizeAward(amount, reason) {
  if (/AdminCommand/.test(reason)) return { type: 'admin', action: `received ${amount} fame points from admin command` };
  if (/SkillLeveledUp/.test(reason)) return { type: 'skill', action: `gained ${amount} fame points for leveling up skill` };
  if (/DeathmatchWon/.test(reason)) return { type: 'deathmatch', action: `earned ${amount} fame points for winning deathmatch` };
  if (/FameTransferOnKill/.test(reason)) return { type: 'kill', action: `gained ${amount} fame points from killing another player` };
  if (/PuppetKill/.test(reason)) return { type: 'zombie', action: `earned ${amount} fame points for killing zombies` };
  if (/FirearmKill|FirearmHeadShotOver200m/.test(reason)) return { type: 'firearm', action: `gained ${amount} fame points for firearm kill` };
  if (/MeleeKill/.test(reason)) return { type: 'melee', action: `earned ${amount} fame points for melee kill` };
  if (/ItemCrafted/.test(reason)) return { type: 'craft', action: `gained ${amount} fame points for crafting items` };
  if (/ItemLooted/.test(reason)) return { type: 'loot', action: `earned ${amount} fame points for looting` };
  if (/FishCaught|FishKept.*Consecutively/.test(reason)) return { type: 'fishing', action: `gained ${amount} fame points for fishing` };
  if (/RecoveredFromInfection/.test(reason)) return { type: 'recovery', action: `earned ${amount} fame points for recovering from infection` };
  if (/WeedsPlucked/.test(reason)) return { type: 'farming', action: `gained ${amount} fame points for farming` };
  if (/LockPicked/.test(reason)) return { type: 'lockpick', action: `earned ${amount} fame points for lockpicking` };
  if (/MinigameCompleted/.test(reason)) return { type: 'minigame', action: `gained ${amount} fame points for completing minigame` };
  if (/PlasticSurgeryCompleted/.test(reason)) return { type: 'surgery', action: `earned ${amount} fame points for plastic surgery` };
  return { type: 'award', action: `awarded ${amount} fame points for ${reason}` };
}

/**
 * Parse one fame points log line. Mirrors ConvertFrom-FamePointsLine from famepoints-log.psm1.
 * Detail lines (part of 10-minute periodic breakdowns) are intentionally skipped, since
 * cross-line correlation to their parent periodic event is not performed here.
 */
function parseLine(line) {
  let m;
  if ((m = AWARD_RE.exec(line))) {
    const amount = parseFloat(m[4]);
    const reason = m[5].trim();
    const { type, action } = categorizeAward(amount, reason);
    return {
      type,
      playerName: m[2].trim(),
      steamId: m[3],
      amount,
      reason,
      action,
    };
  }

  if ((m = PERIODIC_RE.exec(line))) {
    const amount = parseFloat(m[3]);
    const total = m[4];
    return {
      type: 'periodic',
      playerName: m[1].trim(),
      steamId: m[2],
      amount,
      action: `awarded ${amount} fame points (10-minute period, total: ${total})`,
    };
  }

  if (DETAIL_RE.test(line)) return null;

  return null;
}

async function handle(event, client, config) {
  const feedCfg = config.SCUMLogFeatures.FamePointsFeed;
  if (!feedCfg.Enabled || !feedCfg.Channel) return;

  const embed = buildFamePointsEmbed(event);
  await sendToChannel(client, feedCfg.Channel, [], embed);
}

module.exports = {
  name: 'famepoints',
  logPrefix: 'famepoints_',
  isEnabled: (config) => !!(config.SCUMLogFeatures.FamePointsFeed && config.SCUMLogFeatures.FamePointsFeed.Enabled),
  parseLine,
  handle,
};
