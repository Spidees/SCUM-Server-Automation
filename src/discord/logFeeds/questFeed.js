'use strict';

const { sendToChannel } = require('../notifications');
const { buildQuestEmbed } = require('./embeds');

const QUEST_RE = /^([\d.-]+):\s+\[LogQuestStatus\]\s+(.+?)\s+\((\d+),\s+(\d+)\)\s+(completed|abandoned)\s+quest\s+(.+)$/;

const CATEGORY_MAP = { GG: 'Goods Trader', AR: 'Armorer', DC: 'Doctor', MC: 'Mechanic' };

const DISPLAY_NAME_MAP = {
  ChocolateCandy: 'Chocolate Candy', HemostaticDressing: 'Hemostatic Dressing', SabotageACs: 'Sabotage ACs',
  FindAPhone: 'Find A Phone', MultiplePuppetParts: 'Multiple Puppet Parts', DirtbikeHeadlights: 'Dirtbike Headlights',
  DirtbikeFrontShield: 'Dirtbike Front Shield', DirtbikeHellriderSkull: 'Dirtbike Hellrider Skull',
  DirtbikeBody: 'Dirtbike Body', DirtbikeWheels: 'Dirtbike Wheels', MotorbikeBattery: 'Motorbike Battery',
  CarBattery: 'Car Battery', CarBatteryCables: 'Car Battery Cables', CarRepairKit: 'Car Repair Kit',
  CarJack: 'Car Jack', AeroplaneRepairKit: 'Aeroplane Repair Kit', BrakeOil: 'Brake Oil',
  MetalScraps: 'Metal Scraps', OilFilter: 'Oil Filter', WrenchPipe: 'Wrench Pipe',
  SmallToolbox: 'Small Toolbox', GrindingStone: 'Grinding Stone', DuctTape: 'Duct Tape',
  BobbyPins: 'Bobby Pins', SexyShorts: 'Sexy Shorts', SewingKit: 'Sewing Kit',
  PaintCans: 'Paint Cans', RebarCutter: 'Rebar Cutter', RedGhoul: 'Red Ghoul',
  PortableElectricStove: 'Portable Electric Stove', TelephoneBooths: 'Telephone Booths',
  AnalyzeFiles: 'Analyze Files', PoliceStationData: 'Police Station Data',
  CheckGraves: 'Check Graves', Puppets: 'Kill Puppets', PuppetsSharp: 'Kill Puppets (Sharp)',
  PuppetsBlunt: 'Kill Puppets (Blunt)',
};

function displayName(raw) {
  if (DISPLAY_NAME_MAP[raw]) return DISPLAY_NAME_MAP[raw];
  return raw.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
}

/**
 * Parse one quest log line. Mirrors ConvertFrom-QuestLine from quest-log.psm1.
 */
function parseLine(line) {
  const m = QUEST_RE.exec(line);
  if (!m) return null;

  const playerName = m[2].trim();
  const playerId = m[3];
  const steamId = m[4];
  const action = m[5];
  const questName = m[6].trim();

  let category = 'Unknown';
  let tier = 'Unknown';
  let displayQuestName = questName;

  let dm;
  if ((dm = /^T(\d)_([A-Z]{2})_([A-Za-z]+)_(.+)/.exec(questName))) {
    tier = `Tier ${dm[1]}`;
    category = CATEGORY_MAP[dm[2]] || dm[2];
    displayQuestName = displayName(dm[4]);
  } else if ((dm = /^Quest_GeneralGoods_Tier0_(.+)/.exec(questName))) {
    tier = 'Tutorial';
    category = 'Tutorial';
    displayQuestName = displayName(dm[1]);
  }

  return {
    playerName,
    playerId,
    steamId,
    action,
    questId: questName,
    questName,
    displayQuestName,
    category,
    tier,
  };
}

async function handle(event, client, config) {
  const feedCfg = config.SCUMLogFeatures.QuestFeed;
  if (!feedCfg.Enabled || !feedCfg.Channel) return;

  const embed = buildQuestEmbed(event);
  await sendToChannel(client, feedCfg.Channel, [], embed);
}

module.exports = {
  name: 'quest',
  logPrefix: 'quests_',
  isEnabled: (config) => !!(config.SCUMLogFeatures.QuestFeed && config.SCUMLogFeatures.QuestFeed.Enabled),
  parseLine,
  handle,
};
