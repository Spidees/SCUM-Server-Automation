'use strict';

const { EmbedBuilder } = require('discord.js');
const { FOOTER } = require('../embeds');
const { getItemDisplayName, getItemImageUrl } = require('../items');

// Hex equivalents of $script:EmbedColors from log-embed-templates.psm1
const COLORS = {
  Login: 0x00ff00,
  Logout: 0xff0000,
  AdminPositive: 0x00ff00,
  AdminNeutral: 0x3498db,
  AdminNegative: 0xff0000,
  AdminCommand: 0xf1c40f,
  ChestClaim: 0x00ff00,
  ChestUnclaim: 0xff0000,
  ChestTransfer: 0x3498db,
  ChestGeneral: 0x9b59b6,
  FameGain: 0x00ff00,
  FameLoss: 0xff0000,
  FameAward: 0xffd700,
  FameSkill: 0x3498db,
  FameCombat: 0xffa500,
  GameplaySuccess: 0x00ff00,
  GameplayFailed: 0xff0000,
  GameplayNeutral: 0x3498db,
  GameplaySystem: 0x808080,
  GameplayMinigame: 0x9b59b6,
  GameplayLockpick: 0xffff00,
  EconomySell: 0x00ff00,
  EconomyBuy: 0xff0000,
  EconomyDeposit: 0x3498db,
  EconomyWithdraw: 0xffff00,
  EconomyCard: 0x9b59b6,
  EconomyDestroy: 0xffa500,
  EconomyExchange: 0xf1c40f,
  EconomyPenalty: 0x800000,
  EconomyMechanic: 0x808080,
  EventKillRanged: 0xff0000,
  EventKillMelee: 0xffa500,
  EventKillGeneral: 0x800000,
  KillPvP: 0xff0000,
  KillSuicide: 0x800000,
  KillMelee: 0xffa500,
  KillRanged: 0xff0000,
  KillExplosive: 0xffff00,
  QuestComplete: 0x00ff00,
  QuestFailed: 0xff0000,
  QuestStart: 0x3498db,
  QuestNeutral: 0x9b59b6,
  RaidProtectionSet: 0xffff00,
  RaidProtectionActive: 0x00ff00,
  RaidProtectionEnded: 0xffa500,
  RaidProtectionExpired: 0x808080,
  VehicleDestroyed: 0xff0000,
  VehicleDisappeared: 0x808080,
  VehicleExpired: 0xffff00,
  VehicleForbidden: 0xffa500,
  ViolationBan: 0x800000,
  ViolationKick: 0xffa500,
  ViolationAmmo: 0xff0000,
  ViolationInteraction: 0xffff00,
  ViolationGeneral: 0xffa500,
};

function baseEmbed(title, color) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setFooter(FOOTER)
    .setTimestamp(new Date());
}

function locationField(loc, inline = false) {
  if (!loc) return null;
  const { x, y, z } = loc;
  if (x === undefined || y === undefined || z === undefined) return null;
  return { name: 'Location', value: `X=${x} Y=${y} Z=${z}`, inline };
}

// --- Login / Logout ---------------------------------------------------

function buildLoginEmbed(event) {
  const isLogin = event.type === 'LOGIN';
  const embed = baseEmbed(
    isLogin ? ':green_circle: Player Login' : ':red_circle: Player Logout',
    isLogin ? COLORS.Login : COLORS.Logout,
  );
  const fields = [
    { name: 'Player', value: event.playerName || 'Unknown', inline: true },
    { name: 'Player ID', value: event.playerId || 'N/A', inline: true },
    { name: 'SteamID', value: event.steamId || 'N/A', inline: true },
  ];
  if (event.ipAddress) fields.push({ name: 'IP Address', value: event.ipAddress, inline: true });
  const loc = locationField(event.location);
  if (loc) fields.push(loc);
  if (event.isDrone) fields.push({ name: 'Drone Mode', value: 'Yes', inline: true });
  embed.addFields(fields);
  return embed;
}

// --- Admin ---------------------------------------------------------------

const ADMIN_TYPES = {
  spawn: { emoji: ':package:', title: 'Item Spawn', color: COLORS.AdminPositive },
  vehicle: { emoji: ':red_car:', title: 'Vehicle Spawn', color: COLORS.AdminPositive },
  zombie: { emoji: ':zombie:', title: 'Zombie Spawn', color: COLORS.AdminNeutral },
  teleport: { emoji: ':round_pushpin:', title: 'Player Teleport', color: COLORS.AdminNeutral },
  kill: { emoji: ':skull:', title: 'Player Kill', color: COLORS.AdminNegative },
  ban: { emoji: ':hammer:', title: 'Player Ban', color: COLORS.AdminNegative },
  location: { emoji: ':mag:', title: 'Location Check', color: COLORS.AdminNeutral },
  currency: { emoji: ':coin:', title: 'Currency Adjustment', color: COLORS.AdminPositive },
  fame: { emoji: ':star:', title: 'Fame Points', color: COLORS.AdminPositive },
  time: { emoji: ':clock1:', title: 'Time Control', color: COLORS.AdminNeutral },
  weather: { emoji: ':cloud:', title: 'Weather Change', color: COLORS.AdminNeutral },
  announce: { emoji: ':loudspeaker:', title: 'Server Announcement', color: COLORS.AdminCommand },
  cleanup: { emoji: ':broom:', title: 'Server Cleanup', color: COLORS.AdminCommand },
  info: { emoji: ':information_source:', title: 'Info Request', color: COLORS.AdminNeutral },
  event: { emoji: ':trophy:', title: 'Event Management', color: COLORS.AdminPositive },
  give: { emoji: ':gift:', title: 'Item Give', color: COLORS.AdminPositive },
  command: { emoji: ':zap:', title: 'Admin Command', color: COLORS.AdminCommand },
  default: { emoji: ':shield:', title: 'Admin Action', color: COLORS.AdminCommand },
};

function buildAdminEmbed(event) {
  const meta = ADMIN_TYPES[event.type] || ADMIN_TYPES.default;
  const embed = baseEmbed(`${meta.emoji} ${meta.title}`, meta.color);
  const fields = [
    { name: 'Admin', value: event.adminName || 'Unknown', inline: true },
    { name: 'Player ID', value: event.playerId || 'N/A', inline: true },
    { name: 'SteamID', value: event.steamId || 'N/A', inline: true },
  ];
  if (event.command) fields.push({ name: 'Command', value: event.command, inline: false });
  embed.addFields(fields);
  return embed;
}

// --- Chest ownership -------------------------------------------------------

const CHEST_TYPES = {
  claim: { emoji: ':lock:', title: 'Chest Claimed', color: COLORS.ChestClaim },
  claim_unclaimed: { emoji: ':lock:', title: 'Chest Claimed', color: COLORS.ChestClaim },
  transfer: { emoji: ':arrows_counterclockwise:', title: 'Chest Ownership Transferred', color: COLORS.ChestTransfer },
  unclaim: { emoji: ':unlock:', title: 'Chest Unclaimed', color: COLORS.ChestUnclaim },
  default: { emoji: ':package:', title: 'Chest Ownership Changed', color: COLORS.ChestGeneral },
};

function buildChestEmbed(event) {
  const meta = CHEST_TYPES[event.type] || CHEST_TYPES.default;
  const embed = baseEmbed(`${meta.emoji} ${meta.title}`, meta.color);
  const fields = [
    { name: 'Player', value: event.playerName || 'Unknown', inline: true },
    { name: 'Player ID', value: event.playerId || 'N/A', inline: true },
    { name: 'SteamID', value: event.steamId || 'N/A', inline: true },
    { name: 'Entity ID', value: String(event.entityId ?? 'N/A'), inline: true },
  ];
  if (event.action) fields.push({ name: 'Action', value: event.action, inline: true });
  const loc = locationField(event.location);
  if (loc) fields.push(loc);
  embed.addFields(fields);
  return embed;
}

// --- Economy --------------------------------------------------------------

const TRADER_TYPE_NAMES = {
  Mechanic: 'Mechanic',
  Trader: 'General Store',
  Armory: 'Armory',
  BoatShop: 'Boat Shop',
  TradeSaloon: 'Trade Saloon',
  Bunker: 'Bunker Trader',
};

function formatTrader(trader) {
  if (!trader) return null;
  const m = /^([A-Z])_(\d+)_(.+)$/.exec(trader);
  if (!m) return trader;
  const sector = `${m[1]}${m[2]}`;
  const readable = TRADER_TYPE_NAMES[m[3]] || m[3];
  return `${readable} (${sector})`;
}

function formatItemList(items) {
  return items.map((it) => {
    const name = getItemDisplayName(it.item || it.Item);
    const qty = it.quantity || 1;
    const display = qty > 1 ? `${name} (x${qty})` : name;
    return `${display} - ${it.amount ?? it.Amount} credits`;
  }).join('\n');
}

const ECONOMY_TYPES = {
  sell: { emoji: ':moneybag:', title: 'Item Sale', color: COLORS.EconomySell },
  buy: { emoji: ':shopping_cart:', title: 'Item Purchase', color: COLORS.EconomyBuy },
  mechanic: { emoji: ':wrench:', title: 'Mechanic Service', color: COLORS.EconomyMechanic },
  bank_deposit: { emoji: ':bank:', title: 'Bank Deposit', color: COLORS.EconomyDeposit },
  bank_withdraw: { emoji: ':atm:', title: 'Bank Withdrawal', color: COLORS.EconomyWithdraw },
  bank_card: { emoji: ':credit_card:', title: 'Bank Card Purchase', color: COLORS.EconomyCard },
  bank_card_destroy: { emoji: ':wastebasket:', title: 'Card Destroyed', color: COLORS.EconomyDestroy },
  currency_conversion: { emoji: ':scales:', title: 'Currency Exchange', color: COLORS.EconomyExchange },
  gold_sale: { emoji: ':coin:', title: 'Gold Sale', color: COLORS.EconomyExchange },
  squad_penalty: { emoji: ':warning:', title: 'Squad Penalty', color: COLORS.EconomyPenalty },
  default: { emoji: ':moneybag:', title: 'Economy Activity', color: COLORS.EconomySell },
};

function buildEconomyEmbed(event) {
  const meta = ECONOMY_TYPES[event.type] || ECONOMY_TYPES.default;
  const embed = baseEmbed(`${meta.emoji} ${meta.title}`, meta.color);
  const fields = [
    { name: 'Player', value: event.playerName || 'Unknown', inline: true },
    { name: 'SteamID', value: event.steamId || 'N/A', inline: true },
  ];

  if (event.items && event.items.length) {
    fields.push({ name: event.type === 'sell' ? 'Items Sold' : 'Items', value: formatItemList(event.items), inline: false });
    if (event.totalAmount !== undefined) fields.push({ name: 'Total Credits', value: String(event.totalAmount), inline: true });
  } else if (event.item) {
    fields.push({ name: 'Item', value: getItemDisplayName(event.item), inline: true });
    if (event.amount !== undefined) fields.push({ name: 'Amount', value: String(event.amount), inline: true });
  } else if (event.amount !== undefined) {
    fields.push({ name: 'Amount', value: String(event.amount), inline: true });
  }

  if (event.cardType) fields.push({ name: 'Card Type', value: event.cardType, inline: true });

  const before = {};
  const after = {};
  for (const key of ['Cash', 'Account', 'Gold', 'TraderFunds']) {
    if (event[`before${key}`] !== undefined && event[`after${key}`] !== undefined) {
      fields.push({ name: key, value: `${event[`before${key}`]} -> ${event[`after${key}`]}`, inline: true });
    }
  }
  void before;
  void after;

  const trader = formatTrader(event.trader);
  if (trader) fields.push({ name: 'Trader', value: trader, inline: true });

  embed.addFields(fields);
  return embed;
}

// --- Gameplay ---------------------------------------------------------------

function buildGameplayEmbed(event) {
  let color = COLORS.GameplayNeutral;
  if (event.success === true) color = COLORS.GameplaySuccess;
  else if (event.success === false) color = COLORS.GameplayFailed;
  if (event.source === 'SYSTEM') color = COLORS.GameplaySystem;
  if (event.type === 'minigame' || event.type === 'bunker_minigame' || event.type === 'dialpad' || event.type === 'bomb_defusal') color = COLORS.GameplayMinigame;
  if (event.type === 'lockpicking') color = COLORS.GameplayLockpick;

  const titleByType = {
    bunker: ':european_castle: Bunker Event',
    explosive: ':boom: Explosive Activity',
    trap: ':warning: Trap Activity',
    lockpicking: ':key: Lockpicking',
    quest: ':scroll: Quest Activity',
    bunker_minigame: ':video_game: Bunker Minigame',
    dialpad: ':1234: Dial Pad',
    dialpad_attempt: ':1234: Dial Pad Attempt',
    flag: ':triangular_flag_on_post: Flag Event',
    minigame: ':video_game: Minigame',
    bomb_defusal: ':bomb: Bomb Defusal',
  };
  const title = titleByType[event.type] || ':video_game: Gameplay Event';

  const embed = baseEmbed(title, color);
  const fields = [];
  if (event.source === 'SYSTEM') {
    fields.push({ name: 'Source', value: 'SYSTEM', inline: true });
  } else {
    if (event.playerName) fields.push({ name: 'Player', value: event.playerName, inline: true });
    if (event.playerId) fields.push({ name: 'Player ID', value: String(event.playerId), inline: true });
    if (event.steamId) fields.push({ name: 'SteamID', value: event.steamId, inline: true });
  }
  if (event.activity) fields.push({ name: 'Activity', value: event.activity, inline: true });
  if (event.minigame) fields.push({ name: 'Minigame', value: event.minigame, inline: true });
  if (event.success !== undefined) fields.push({ name: 'Success', value: event.success ? '✅' : '❌', inline: true });
  if (event.elapsedTime !== undefined) fields.push({ name: 'Elapsed Time', value: `${event.elapsedTime}s`, inline: true });
  if (event.failedAttempts !== undefined) fields.push({ name: 'Failed Attempts', value: String(event.failedAttempts), inline: true });
  if (event.targetObject) fields.push({ name: 'Target Object', value: event.targetObject, inline: true });
  if (event.lockType) fields.push({ name: 'Lock Type', value: event.lockType, inline: true });
  if (event.ownerName) fields.push({ name: 'Owner', value: event.ownerName, inline: true });
  if (event.itemName) fields.push({ name: 'Item', value: event.itemName, inline: true });
  if (event.trapName) fields.push({ name: 'Trap', value: event.trapName, inline: true });
  if (event.bombType) fields.push({ name: 'Bomb Type', value: event.bombType, inline: true });
  if (event.flagId) fields.push({ name: 'Flag ID', value: String(event.flagId), inline: true });
  if (event.details) fields.push({ name: 'Details', value: event.details, inline: false });
  const loc = locationField(event.location);
  if (loc) fields.push(loc);
  embed.addFields(fields);
  return embed;
}

// --- Kill / Suicide ---------------------------------------------------------

const KILL_WEAPON_TYPE_META = {
  projectile: { emoji: ':gun:', title: 'Ranged Kill', color: COLORS.KillRanged },
  melee: { emoji: ':knife:', title: 'Melee Kill', color: COLORS.KillMelee },
  explosion: { emoji: ':boom:', title: 'Explosive Kill', color: COLORS.KillExplosive },
  default: { emoji: ':crossed_swords:', title: 'PvP Kill', color: COLORS.KillPvP },
};

function buildKillFields(event, { includeIds }) {
  const fields = [];
  if (event.type === 'suicide') {
    fields.push({ name: 'Player', value: event.playerName || 'Unknown', inline: true });
    if (includeIds) {
      fields.push({ name: 'Player ID', value: String(event.playerId ?? 'N/A'), inline: true });
      fields.push({ name: 'SteamID', value: event.steamId || 'N/A', inline: true });
    }
    const loc = locationField(event.location);
    if (loc) fields.push(loc);
    else if (event.locationText) fields.push({ name: 'Location', value: event.locationText, inline: false });
    return fields;
  }

  fields.push({ name: 'Killer', value: event.killerName || 'Unknown', inline: true });
  fields.push({ name: 'Victim', value: event.victimName || 'Unknown', inline: true });
  if (includeIds) {
    fields.push({ name: 'Killer SteamID', value: event.killerSteamId || 'N/A', inline: true });
    fields.push({ name: 'Victim SteamID', value: event.victimSteamId || 'N/A', inline: true });
  }

  if (event.weaponName) {
    const displayName = getItemDisplayName(event.weaponName);
    fields.push({ name: 'Weapon', value: displayName, inline: true });
    if (includeIds && displayName !== event.weaponName) {
      fields.push({ name: 'Weapon ID', value: event.weaponName, inline: true });
    }
  }
  if (event.weaponType) fields.push({ name: 'Weapon Type', value: event.weaponType, inline: true });
  if (event.distance !== undefined && event.weaponType !== 'explosion') {
    fields.push({ name: 'Distance', value: `${event.distance} m`, inline: true });
  }
  if (event.locationText) fields.push({ name: 'Location', value: event.locationText, inline: false });
  return fields;
}

function buildKillEmbed(event) {
  if (event.type === 'suicide') {
    const embed = baseEmbed(':skull: Suicide', COLORS.KillSuicide);
    embed.addFields(buildKillFields(event, { includeIds: true }));
    return embed;
  }
  const meta = KILL_WEAPON_TYPE_META[(event.weaponType || '').toLowerCase()] || KILL_WEAPON_TYPE_META.default;
  const embed = baseEmbed(`${meta.emoji} ${meta.title}`, meta.color);
  embed.addFields(buildKillFields(event, { includeIds: true }));
  if (event.weaponName) {
    const icon = getItemImageUrl(event.weaponName);
    if (icon) embed.setThumbnail(icon);
  }
  return embed;
}

function buildKillEmbedSimple(event, delayInfo) {
  let embed;
  if (event.type === 'suicide') {
    embed = baseEmbed(':skull: Suicide', COLORS.KillSuicide);
  } else {
    const meta = KILL_WEAPON_TYPE_META[(event.weaponType || '').toLowerCase()] || KILL_WEAPON_TYPE_META.default;
    embed = baseEmbed(`${meta.emoji} ${meta.title}`, meta.color);
  }
  const fields = buildKillFields(event, { includeIds: false });
  if (delayInfo && delayInfo.delaySeconds) {
    fields.push({ name: 'Delay Info', value: `:clock3: Delayed by ${delayInfo.delaySeconds}s`, inline: true });
  }
  embed.addFields(fields);
  if (event.weaponName) {
    const icon = getItemImageUrl(event.weaponName);
    if (icon) embed.setThumbnail(icon);
  }
  return embed;
}

// --- Event kill -----------------------------------------------------------

const EVENT_KILL_TYPE_META = {
  ranged: { emoji: ':gun:', title: 'Event Kill (Ranged)', color: COLORS.EventKillRanged },
  melee: { emoji: ':knife:', title: 'Event Kill (Melee)', color: COLORS.EventKillMelee },
  event_kill: { emoji: ':trophy:', title: 'Event Kill', color: COLORS.EventKillGeneral },
  default: { emoji: ':trophy:', title: 'Event Kill', color: COLORS.EventKillGeneral },
};

function buildEventKillFields(event, { includeIds }) {
  const fields = [
    { name: 'Killer', value: event.killerName || 'Unknown', inline: true },
    { name: 'Victim', value: event.victimName || 'Unknown', inline: true },
  ];
  if (includeIds) {
    fields.push({ name: 'Killer SteamID', value: event.killerSteamId || 'N/A', inline: true });
    fields.push({ name: 'Victim SteamID', value: event.victimSteamId || 'N/A', inline: true });
  }
  if (event.weaponName) {
    const displayName = getItemDisplayName(event.weaponName);
    fields.push({ name: 'Weapon', value: displayName, inline: true });
    if (includeIds && displayName !== event.weaponName) {
      fields.push({ name: 'Weapon ID', value: event.weaponName, inline: true });
    }
  }
  if (event.weaponType) fields.push({ name: 'Weapon Type', value: event.weaponType, inline: true });
  if (event.distance !== undefined) fields.push({ name: 'Distance', value: `${event.distance} m`, inline: true });
  fields.push({ name: 'Event Type', value: 'Game Event Kill', inline: true });
  if (event.locationText) {
    fields.push({ name: 'Location', value: event.locationText, inline: false });
  } else {
    const loc = locationField(event.location);
    if (loc) fields.push(loc);
  }
  return fields;
}

function buildEventKillEmbed(event) {
  const meta = EVENT_KILL_TYPE_META[event.type] || EVENT_KILL_TYPE_META.default;
  const embed = baseEmbed(`${meta.emoji} ${meta.title}`, meta.color);
  embed.addFields(buildEventKillFields(event, { includeIds: true }));
  return embed;
}

function buildEventKillEmbedSimple(event) {
  const meta = EVENT_KILL_TYPE_META[event.type] || EVENT_KILL_TYPE_META.default;
  const embed = baseEmbed(`${meta.emoji} ${meta.title}`, meta.color);
  embed.addFields(buildEventKillFields(event, { includeIds: false }));
  return embed;
}

// --- Fame points ------------------------------------------------------------

function buildFamePointsEmbed(event) {
  let color = event.amount >= 0 ? COLORS.FameGain : COLORS.FameLoss;
  if (event.type === 'admin' || event.type === 'award') color = COLORS.FameAward;
  else if (event.type === 'skill') color = COLORS.FameSkill;
  else if (['deathmatch', 'kill', 'zombie', 'firearm', 'melee'].includes(event.type)) color = COLORS.FameCombat;

  const embed = baseEmbed(':star: Fame Points', color);
  const fields = [
    { name: 'Player', value: event.playerName || 'Unknown', inline: true },
    { name: 'SteamID', value: event.steamId || 'N/A', inline: true },
    { name: 'Amount', value: String(event.amount ?? 0), inline: true },
  ];
  if (event.action) fields.push({ name: 'Action', value: event.action, inline: true });
  if (event.reason) fields.push({ name: 'Reason', value: event.reason, inline: true });
  if (event.details && event.details.length) {
    const breakdown = event.details.map((d) => `${d.label}: ${d.amount}`).join('\n');
    fields.push({ name: 'Breakdown', value: breakdown, inline: false });
  }
  embed.addFields(fields);
  return embed;
}

// --- Quest ------------------------------------------------------------------

const QUEST_ACTION_META = {
  completed: { emoji: ':white_check_mark:', title: 'Quest Completed', color: COLORS.QuestComplete },
  abandoned: { emoji: ':x:', title: 'Quest Abandoned', color: COLORS.QuestFailed },
  started: { emoji: ':arrow_forward:', title: 'Quest Started', color: COLORS.QuestStart },
  failed: { emoji: ':x:', title: 'Quest Failed', color: COLORS.QuestFailed },
  default: { emoji: ':scroll:', title: 'Quest Event', color: COLORS.QuestNeutral },
};

function buildQuestEmbed(event) {
  const meta = QUEST_ACTION_META[event.action] || QUEST_ACTION_META.default;
  const embed = baseEmbed(`${meta.emoji} ${meta.title}`, meta.color);
  const fields = [
    { name: 'Player', value: event.playerName || 'Unknown', inline: true },
    { name: 'Steam ID', value: event.steamId || 'N/A', inline: true },
    { name: 'Quest', value: event.displayQuestName || event.questName || 'Unknown', inline: true },
  ];
  if (event.questId) fields.push({ name: 'Quest ID', value: event.questId, inline: true });
  if (event.tier) fields.push({ name: 'Tier', value: String(event.tier), inline: true });
  if (event.rewards && event.rewards.length) {
    fields.push({ name: 'Rewards', value: event.rewards.map((r) => `${r.quantity > 1 ? `${r.quantity}x ` : ''}${getItemDisplayName(r.item)}`).join('\n'), inline: false });
  }
  const loc = locationField(event.location);
  if (loc) fields.push(loc);
  embed.addFields(fields);
  return embed;
}

// --- Raid protection ----------------------------------------------------------

const RAID_PROTECTION_META = {
  ProtectionScheduled: { emoji: ':hourglass:', title: 'Raid Protection Scheduled', color: COLORS.RaidProtectionSet },
  ProtectionActivated: { emoji: ':shield:', title: 'Raid Protection Activated', color: COLORS.RaidProtectionActive },
  ProtectionEnded: { emoji: ':door:', title: 'Raid Protection Ended', color: COLORS.RaidProtectionEnded },
  ProtectionExpired: { emoji: ':hourglass_flowing_sand:', title: 'Raid Protection Expired', color: COLORS.RaidProtectionExpired },
  default: { emoji: ':shield:', title: 'Raid Protection Event', color: COLORS.RaidProtectionExpired },
};

function buildRaidProtectionEmbed(event) {
  const meta = RAID_PROTECTION_META[event.eventType] || RAID_PROTECTION_META.default;
  const embed = baseEmbed(`${meta.emoji} ${meta.title}`, meta.color);
  const fields = [
    { name: 'Flag ID', value: String(event.flagId ?? 'N/A'), inline: true },
    { name: 'Owner ID', value: event.ownerId ? String(event.ownerId) : 'N/A', inline: true },
  ];
  if (event.duration !== undefined) {
    fields.push({ name: 'Duration', value: `${(event.duration / 3600).toFixed(1)} hours`, inline: true });
  }
  if (event.startDelay !== undefined) {
    fields.push({ name: 'Starts In', value: `${Math.round(event.startDelay / 60)} minutes`, inline: true });
  }
  if (event.userId) fields.push({ name: 'Triggered By', value: String(event.userId), inline: true });
  if (event.reason) fields.push({ name: 'Reason', value: event.reason, inline: true });
  const loc = locationField({ x: event.locationX, y: event.locationY, z: event.locationZ });
  if (loc) fields.push(loc);
  embed.addFields(fields);
  return embed;
}

// --- Vehicle ------------------------------------------------------------------

const VEHICLE_EVENT_META = {
  Destroyed: { emoji: ':boom:', title: 'Vehicle Destroyed', color: COLORS.VehicleDestroyed, details: 'The vehicle was destroyed.' },
  Disappeared: { emoji: ':grey_question:', title: 'Vehicle Disappeared', color: COLORS.VehicleDisappeared, details: 'The vehicle disappeared.' },
  VehicleInactiveTimerReached: { emoji: ':hourglass:', title: 'Vehicle Expired (Inactive)', color: COLORS.VehicleExpired, details: 'The vehicle expired due to inactivity.' },
  ForbiddenZoneTimerExpired: { emoji: ':no_entry:', title: 'Vehicle Expired (Forbidden Zone)', color: COLORS.VehicleForbidden, details: 'The vehicle expired in a forbidden zone.' },
  default: { emoji: ':red_car:', title: 'Vehicle Event', color: COLORS.VehicleDisappeared, details: null },
};

function buildVehicleEmbed(event) {
  const meta = VEHICLE_EVENT_META[event.eventType] || VEHICLE_EVENT_META.default;
  const embed = baseEmbed(`${meta.emoji} ${meta.title}`, meta.color);
  const fields = [
    { name: 'Vehicle', value: event.vehicleName || 'Unknown', inline: true },
    { name: 'Vehicle ID', value: String(event.vehicleId ?? 'N/A'), inline: true },
    { name: 'Owner', value: event.ownerName || 'No Owner', inline: true },
  ];
  if (event.ownerPlayerId) fields.push({ name: 'Player ID', value: String(event.ownerPlayerId), inline: true });
  if (event.ownerSteamId) fields.push({ name: 'Steam ID', value: event.ownerSteamId, inline: true });
  fields.push({ name: 'Details', value: meta.details || event.eventType, inline: false });
  const loc = locationField({ x: event.locationX, y: event.locationY, z: event.locationZ });
  if (loc) fields.push(loc);
  embed.addFields(fields);
  return embed;
}

// --- Violations -----------------------------------------------------------------

const VIOLATION_TYPE_META = {
  BAN: { emoji: ':hammer:', title: 'Player Banned', color: COLORS.ViolationBan },
  KICK: { emoji: ':boot:', title: 'Player Kicked', color: COLORS.ViolationKick },
  VIOLATION: { emoji: ':warning:', title: 'Rule Violation', color: COLORS.ViolationGeneral },
};

function buildViolationsEmbed(event) {
  const meta = VIOLATION_TYPE_META[event.type] || VIOLATION_TYPE_META.VIOLATION;
  let color = meta.color;
  if (event.type === 'VIOLATION') {
    if (event.violationType && event.violationType.startsWith('AmmoCountMismatch')) color = COLORS.ViolationAmmo;
    else if (event.violationType && event.violationType.startsWith('OutOfInteractionRange')) color = COLORS.ViolationInteraction;
  }
  const embed = baseEmbed(`${meta.emoji} ${meta.title}`, color);
  const fields = [
    { name: 'Player', value: event.playerName || 'Unknown Player', inline: true },
  ];
  if (event.playerId) fields.push({ name: 'Player ID', value: String(event.playerId), inline: true });
  if (event.steamId) fields.push({ name: 'Steam ID', value: event.steamId, inline: true });
  if (event.action) fields.push({ name: 'Action', value: event.action, inline: true });
  if (event.reason) fields.push({ name: 'Reason', value: event.reason, inline: true });
  if (event.weapon) fields.push({ name: 'Weapon', value: event.weapon, inline: true });
  if (event.distance !== undefined) fields.push({ name: 'Distance', value: `${event.distance} m`, inline: true });
  const loc = locationField({ x: event.locationX, y: event.locationY, z: event.locationZ });
  if (loc) fields.push(loc);
  embed.addFields(fields);
  return embed;
}

module.exports = {
  COLORS,
  buildLoginEmbed,
  buildAdminEmbed,
  buildChestEmbed,
  buildEconomyEmbed,
  buildGameplayEmbed,
  buildKillEmbed,
  buildKillEmbedSimple,
  buildEventKillEmbed,
  buildEventKillEmbedSimple,
  buildFamePointsEmbed,
  buildQuestEmbed,
  buildRaidProtectionEmbed,
  buildVehicleEmbed,
  buildViolationsEmbed,
};
