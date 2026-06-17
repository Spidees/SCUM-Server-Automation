'use strict';

const { EmbedBuilder } = require('discord.js');
const logger = require('../core/logger');
const { config } = require('../core/config');
const { COLORS } = require('./embeds');
const { applyBranding, emojify } = require('./branding');
const monitoring = require('../server/monitoring');
const scheduling = require('../automation/scheduling');
const database = require('../database');

// In-memory message refs, keyed by a logical embed name. Mirrors the
// {ChannelId, MessageId, LastUpdate} tracking in live-embeds-manager.psm1.
const trackedMessages = {
  status: { messageId: null, lastUpdate: 0, lastState: null },
  leaderboardWeekly: { messageId: null, lastUpdate: 0 },
  leaderboardAllTime: { messageId: null, lastUpdate: 0 },
};

const LEADERBOARD_CATEGORIES = [
  { key: 'squad_score', label: ':triangular_flag_on_post: Top Squads' },
  { key: 'survivors', label: ':medal: Top Survivors' },
  { key: 'fame', label: ':medal: Top Fame Points' },
  { key: 'money', label: ':medal: Top Money' },
  { key: 'puppet_kills', label: ':medal: Top Puppet Killers' },
  { key: 'animal_kills', label: ':medal: Top Animal Hunters' },
  { key: 'melee_warriors', label: ':medal: Top Melee Warriors' },
  { key: 'archers', label: ':medal: Top Archers' },
  { key: 'sniper', label: ':medal: Top Sniper' },
  { key: 'headshots', label: ':medal: Top Headshot Masters' },
  { key: 'locks_picked', label: ':medal: Top Lockpickers' },
  { key: 'looters', label: ':medal: Top Looters' },
];

/**
 * Find an existing tracked message in a channel by matching embed title prefix,
 * or return null. Mirrors the startup search in server-status-embed.psm1 /
 * leaderboards-embed.psm1.
 */
async function findExistingMessage(channel, titlePrefix) {
  try {
    const messages = await channel.messages.fetch({ limit: 50 });
    const found = messages.find((m) => m.author?.id === channel.client.user.id
      && m.embeds[0]
      && m.embeds[0].title
      && m.embeds[0].title.startsWith(titlePrefix));
    return found || null;
  } catch (err) {
    logger.warn(`[Discord] Failed to search channel ${channel.id} for existing embed: ${err.message}`);
    return null;
  }
}

/**
 * Send a new embed or edit the tracked message in-place. Mirrors
 * Update-DiscordMessage / Send-DiscordMessage from discord-api.psm1.
 */
async function upsertEmbed(client, channelId, titlePrefix, tracked, embed) {
  const channel = await client.channels.fetch(channelId);
  if (!channel) return;

  applyBranding(embed);
  // Branded titles are Unicode, so the search prefix must be emojified to match.
  const searchPrefix = emojify(titlePrefix);

  if (tracked.messageId) {
    try {
      const message = await channel.messages.fetch(tracked.messageId);
      await message.edit({ embeds: [embed] });
      return;
    } catch (err) {
      logger.warn(`[Discord] Tracked message ${tracked.messageId} no longer editable, recreating: ${err.message}`);
      tracked.messageId = null;
    }
  }

  const existing = await findExistingMessage(channel, searchPrefix);
  if (existing) {
    await existing.edit({ embeds: [embed] });
    tracked.messageId = existing.id;
    return;
  }

  const sent = await channel.send({ embeds: [embed] });
  tracked.messageId = sent.id;
}

/**
 * Build the server status embed (9-field 3x3 grid). Mirrors
 * live-embeds/server-status-embed.psm1.
 */
async function buildStatusEmbed() {
  const status = await monitoring.getServerStatus();
  const liveCfg = (config.Discord && config.Discord.LiveEmbeds) || {};

  const statusEmoji = status.IsRunning ? ':green_circle:' : ':red_circle:';
  const statusText = status.ActualServerState || status.Status || 'Unknown';

  // SCUM clients connect on the game port + 2 (e.g. -port=7042 -> connect on 7044).
  const gamePort = parseInt((config.serverArgs && config.serverArgs.port) || config.publicPort, 10);
  const connectPort = Number.isFinite(gamePort) ? gamePort + 2 : '-';
  const serverAddress = `${config.publicIP || '-'}:${connectPort}`;

  let nextRestartText = '-';
  const eff = scheduling.getEffectiveNextRestart();
  if (eff.time) {
    if (!eff.isManual && scheduling.getRestartSkipStatus()) {
      nextRestartText = 'Skipped';
    } else {
      const unixTs = Math.floor(eff.time.getTime() / 1000);
      nextRestartText = `<t:${unixTs}:R>`;
    }
  }

  let gameTime = '-';
  let temperature = '-';
  let totalPlayers = '-';
  let activeSquads = '-';
  if (database.isScumDbAvailable()) {
    try {
      const gt = database.getGameTimeData();
      if (gt && gt.Success) gameTime = gt.FormattedTime;
      const wt = database.getWeatherData();
      if (wt && wt.Success) temperature = wt.FormattedTemperature;
      const stats = database.getServerStatistics();
      if (stats) totalPlayers = `${stats.TotalPlayers}`;
      activeSquads = `${database.getActiveSquadCount()}`;
    } catch (err) {
      logger.warn(`[Discord] Failed to read database stats for status embed: ${err.message}`);
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(':satellite: Server Status')
    .setColor(status.IsRunning ? COLORS.green : COLORS.red)
    .addFields(
      { name: ':earth_americas: Status', value: `${statusEmoji} ${statusText}`, inline: true },
      { name: ':round_pushpin: Server', value: `\`${serverAddress}\``, inline: true },
      { name: ':busts_in_silhouette: Online Players', value: `${status.OnlinePlayers} / ${status.MaxPlayers}`, inline: true },
      { name: ':arrows_counterclockwise: Next Restart', value: nextRestartText, inline: true },
      { name: ':clock8: Game Time', value: gameTime, inline: true },
      { name: ':thermometer: Temperature', value: temperature, inline: true },
      { name: ':zap: Performance', value: `${status.Performance?.FPS ?? '-'} FPS`, inline: true },
      { name: ':bust_in_silhouette: Total Players', value: totalPlayers, inline: true },
      { name: ':triangular_flag_on_post: Active Squads', value: activeSquads, inline: true },
    )
    .setTimestamp(new Date());

  if (liveCfg.Images && liveCfg.Images.ServerStatus) {
    embed.setImage(liveCfg.Images.ServerStatus);
  }

  return { embed, actualServerState: status.ActualServerState };
}

/**
 * Build the weekly or all-time leaderboards embed. Mirrors
 * live-embeds/leaderboards-embed.psm1.
 */
function buildLeaderboardEmbed(weekly) {
  const embed = new EmbedBuilder();
  const liveCfg = (config.Discord && config.Discord.LiveEmbeds) || {};
  const images = (liveCfg.Images && liveCfg.Images.Leaderboards) || {};

  if (weekly) {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

    embed
      .setTitle(':calendar_spiral: Weekly Leaderboards')
      .setDescription(`**This Week's Top Performers** (${fmt(weekStart)} - ${fmt(weekEnd)})`)
      .setColor(COLORS.blue);
    if (images.Weekly) embed.setImage(images.Weekly);
  } else {
    embed
      .setTitle(':trophy: All-Time Leaderboards')
      .setDescription('**Hall of Fame - Server Legends**')
      .setColor(COLORS.gold);
    if (images.AllTime) embed.setImage(images.AllTime);
  }

  embed.setTimestamp(new Date());

  if (!database.isScumDbAvailable()) {
    embed.addFields({ name: ':warning: Unavailable', value: 'SCUM database not found yet.' });
    return embed;
  }

  for (const cat of LEADERBOARD_CATEGORIES) {
    let rows;
    try {
      rows = database.getLeaderboard(cat.key, 5, weekly);
    } catch (err) {
      logger.warn(`[Discord] Failed to load leaderboard ${cat.key}: ${err.message}`);
      rows = [];
    }

    let value;
    if (!rows || !rows.length) {
      value = 'No data yet';
    } else {
      value = rows.map((row, i) => {
        const name = (row.Name || 'Unknown').slice(0, 16);
        return `${i + 1}. ${name} - ${row.FormattedValue}`;
      }).join('\n');
    }

    embed.addFields({ name: cat.label, value, inline: false });
  }

  return embed;
}

/**
 * Update (or create) the server status live embed if its interval has elapsed,
 * or immediately if the actual server state changed. Mirrors
 * Update-ServerStatusEmbed's rate-limit + force-update logic.
 */
async function updateStatusEmbed(client) {
  const liveCfg = (config.Discord && config.Discord.LiveEmbeds) || {};
  const channelId = liveCfg.StatusChannel;
  if (!channelId) return;

  const intervalMs = (liveCfg.UpdateInterval || 30) * 1000;
  const tracked = trackedMessages.status;

  const { embed, actualServerState } = await buildStatusEmbed();
  const stateChanged = tracked.lastState !== null && tracked.lastState !== actualServerState;
  const intervalElapsed = Date.now() - tracked.lastUpdate >= intervalMs;

  if (!stateChanged && !intervalElapsed && tracked.messageId) return;

  await upsertEmbed(client, channelId, ':satellite: Server Status', tracked, embed);
  tracked.lastUpdate = Date.now();
  tracked.lastState = actualServerState;
}

/**
 * Update (or create) the leaderboard live embeds if their intervals have elapsed.
 */
async function updateLeaderboardEmbeds(client) {
  const liveCfg = (config.Discord && config.Discord.LiveEmbeds) || {};
  const channelId = liveCfg.LeaderboardsChannel;
  if (!channelId) return;

  const weeklyIntervalMs = (liveCfg.LeaderboardUpdateInterval || 120) * 1000;
  const allTimeIntervalMs = (liveCfg.AllTimeLeaderboardUpdateInterval || liveCfg.LeaderboardUpdateInterval || 120) * 1000;

  const weekly = trackedMessages.leaderboardWeekly;
  if (Date.now() - weekly.lastUpdate >= weeklyIntervalMs) {
    await upsertEmbed(client, channelId, ':calendar_spiral: Weekly Leaderboards', weekly, buildLeaderboardEmbed(true));
    weekly.lastUpdate = Date.now();
  }

  const allTime = trackedMessages.leaderboardAllTime;
  if (Date.now() - allTime.lastUpdate >= allTimeIntervalMs) {
    await upsertEmbed(client, channelId, ':trophy: All-Time Leaderboards', allTime, buildLeaderboardEmbed(false));
    allTime.lastUpdate = Date.now();
  }
}

let tickTimer = null;

/**
 * Start the live-embeds update loop. Mirrors live-embeds-manager.psm1's
 * periodic update cycle.
 */
function startLiveEmbeds(client) {
  const tick = async () => {
    try {
      await updateStatusEmbed(client);
    } catch (err) {
      logger.warn(`[Discord] Status embed update failed: ${err.message}`);
    }
    try {
      await updateLeaderboardEmbeds(client);
    } catch (err) {
      logger.warn(`[Discord] Leaderboard embed update failed: ${err.message}`);
    }
  };

  tick();
  tickTimer = setInterval(tick, 10 * 1000);
  logger.info('[Discord] Live embeds loop started');
}

function stopLiveEmbeds() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

module.exports = { startLiveEmbeds, stopLiveEmbeds, buildStatusEmbed, buildLeaderboardEmbed };
