'use strict';

const { sendToChannel } = require('../notifications');
const { buildAdminEmbed } = require('./embeds');
const { applyMessageFilter } = require('../chatRelay');

const ADMIN_LINE_RE = /^([\d.-]+):\s+'(\d+):([^(]+)\((\d+)\)'\s+Command:\s+'(.+)'$/;

/**
 * Parse one admin log line. Mirrors ConvertFrom-AdminLine from admin-log.psm1.
 */
function parseLine(line) {
  const m = ADMIN_LINE_RE.exec(line);
  if (!m) return null;

  const steamId = m[2];
  const adminName = m[3].trim();
  const playerId = m[4];
  const command = m[5];

  let type = 'command';

  let cm;
  if ((cm = /^SpawnItem\s+(.+)/.exec(command))) {
    type = 'spawn';
  } else if (/^SpawnVehicle\s+(.+)/.exec(command)) {
    type = 'vehicle';
  } else if (/^RenameVehicle\s+(.+)/.exec(command)) {
    type = 'vehicle';
  } else if (/^spawnzombie\s+(.+)/.exec(command)) {
    type = 'zombie';
  } else if (/^spawnanimal\s+(.+)/.exec(command)) {
    type = 'spawn';
  } else if (/^SpawnRandomZombie\s+(.+)/.exec(command)) {
    type = 'zombie';
  } else if (/^Teleport|^teleport/.exec(command)) {
    type = 'teleport';
  } else if (/^Kill\s+(.+)/.exec(command)) {
    type = 'kill';
  } else if (/^ban\s+(.+)/.exec(command)) {
    type = 'ban';
  } else if (/^location\s+(.+)/.exec(command)) {
    type = 'location';
  } else if (/^ChangeCurrencyBalance\s+(\w+)\s+(\d+)\s+(.+)/.exec(command)) {
    type = 'currency';
  } else if (/^ChangeFamePoints\s+(\d+)\s+(.+)/.exec(command)) {
    type = 'fame';
  } else if (/^SetTime|^Vote SetTimeOfDay/.exec(command)) {
    type = 'time';
  } else if (/^SetWeather|^Vote SetWeather/.exec(command)) {
    type = 'weather';
  } else if (/^Announce|^announce/.exec(command)) {
    type = 'announce';
  } else if (/^DestroyZombiesWithinRadius/.exec(command)) {
    type = 'cleanup';
  } else if (/^DestroyCorpsesWithinRadius/.exec(command)) {
    type = 'cleanup';
  } else if (/^DestroyVehicle\s+(.+)/.exec(command)) {
    type = 'cleanup';
  } else if (/^DestroyAllItemsWithinRadius\s+(.+)/.exec(command)) {
    type = 'cleanup';
  } else if (/^ShowVehicleInfo|^ReloadLoot|^Reload|^ListPlayers|^ListSpawnedVehicles/.exec(command)) {
    type = 'info';
  } else if (/^ClearFakeName/.exec(command)) {
    type = 'info';
  } else if (/^StartTournamentMode/.exec(command)) {
    type = 'event';
  } else if (/^Give/.exec(command)) {
    type = 'give';
  }
  void cm;

  return {
    adminName,
    steamId,
    playerId,
    command,
    type,
  };
}

async function handle(event, client, config) {
  const feedCfg = config.SCUMLogFeatures.AdminFeed;
  if (!feedCfg.Enabled || !feedCfg.Channel) return;

  const filteredEvent = { ...event, command: applyMessageFilter(event.command) };
  const embed = buildAdminEmbed(filteredEvent);
  await sendToChannel(client, feedCfg.Channel, [], embed);
}

module.exports = {
  name: 'admin',
  logPrefix: 'admin_',
  isEnabled: (config) => !!(config.SCUMLogFeatures.AdminFeed && config.SCUMLogFeatures.AdminFeed.Enabled),
  parseLine,
  handle,
};
