'use strict';

const { EmbedBuilder } = require('discord.js');
const logger = require('../core/logger');
const { config } = require('../core/config');
const { COLORS } = require('./embeds');
const { applyBranding, emojify, addFieldConsole } = require('./branding');
const monitoring = require('../server/monitoring');
const scheduling = require('../automation/scheduling');
const database = require('../database');
const bunkerState = require('./bunkerState');
const economyState = require('./economyState');

// In-memory message refs, keyed by a logical embed name. Mirrors the
// {ChannelId, MessageId, LastUpdate} tracking in live-embeds-manager.psm1.
const trackedMessages = {
  status: { messageId: null, lastUpdate: 0, lastState: null },
  players: { messageId: null, lastUpdate: 0 },
  bunkers: { messageId: null, lastUpdate: 0 },
  economy: { messageId: null, lastUpdate: 0 },
  leaderboardWeekly: { messageId: null, lastUpdate: 0 },
  leaderboardAllTime: { messageId: null, lastUpdate: 0 },
};

const { CATEGORIES_BY_KEY } = require('../database/leaderboardDefs');

// Curated set shown in the live embed (the dashboard browses all categories;
// a Discord embed can't fit them all within the 25-field / 6000-char limits).
// Labels are pulled from leaderboardDefs so they stay in sync with the dashboard.
const LEADERBOARD_KEYS = [
  { key: 'squad_score', emoji: ':triangular_flag_on_post:' },
  { key: 'survivors', emoji: ':medal:' },
  { key: 'fame', emoji: ':medal:' },
  { key: 'money', emoji: ':medal:' },
  { key: 'puppet_kills', emoji: ':medal:' },
  { key: 'animal_kills', emoji: ':medal:' },
  { key: 'melee_warriors', emoji: ':medal:' },
  { key: 'archers', emoji: ':medal:' },
  { key: 'sniper', emoji: ':medal:' },
  { key: 'headshots', emoji: ':medal:' },
  { key: 'locks_picked', emoji: ':medal:' },
  { key: 'looters', emoji: ':medal:' },
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
  addFieldConsole(embed);

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

  // Discord caps embeds at 25 fields / 6000 total characters — track the running
  // size and stop before exceeding either, so the embed never gets rejected.
  let totalChars = (embed.data.title || '').length + (embed.data.description || '').length;
  const MAX_CHARS = 5800;
  const MAX_FIELDS = 25;

  for (const cat of LEADERBOARD_KEYS) {
    if ((embed.data.fields || []).length >= MAX_FIELDS) break;

    const def = CATEGORIES_BY_KEY.get(cat.key);
    const name = `${cat.emoji} ${def ? def.label : cat.key}`;

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
        const playerName = (row.Name || 'Unknown').slice(0, 18);
        return `\`${i + 1}.\` ${playerName} — ${row.FormattedValue}`;
      }).join('\n');
    }
    if (value.length > 1024) value = `${value.slice(0, 1020)}…`;

    if (totalChars + name.length + value.length > MAX_CHARS) break;
    totalChars += name.length + value.length;
    embed.addFields({ name, value, inline: false });
  }

  addFieldConsole(embed);
  return embed;
}

/**
 * Build the online-players live embed (a numbered list of currently connected
 * players). Online players come from SCUM.db (dead profiles already excluded).
 */
function buildPlayersEmbed() {
  const liveCfg = (config.Discord && config.Discord.LiveEmbeds) || {};
  const embed = new EmbedBuilder()
    .setColor(COLORS.green)
    .setTimestamp(new Date());

  if (!database.isScumDbAvailable()) {
    embed.setTitle(':busts_in_silhouette: Online Players');
    embed.setDescription('SCUM database not found yet.');
    return embed;
  }

  let players = [];
  try {
    players = database.getOnlinePlayers() || [];
  } catch (err) {
    logger.warn(`[Discord] Failed to load online players: ${err.message}`);
  }

  const maxPlayers = monitoring.getMaxPlayersFromConfig();
  embed.setTitle(`:busts_in_silhouette: Online Players (${players.length} / ${maxPlayers})`);

  if (!players.length) {
    embed.setDescription('*No players are online right now.*');
  } else {
    const names = players.map((p) => p.PlayerName || p.name || 'Unknown');
    let desc = '';
    let shown = 0;
    for (let i = 0; i < names.length; i += 1) {
      const line = `\`${String(i + 1).padStart(2, '0')}.\` ${names[i]}\n`;
      if (desc.length + line.length > 3900) break; // embed description cap is 4096
      desc += line;
      shown += 1;
    }
    if (shown < names.length) desc += `\n*…and ${names.length - shown} more*`;
    embed.setDescription(desc);
  }

  if (liveCfg.Images && liveCfg.Images.Players) embed.setImage(liveCfg.Images.Players);
  return embed;
}

/**
 * Update (or create) the online-players live embed if its interval has elapsed.
 */
async function updatePlayersEmbed(client) {
  const liveCfg = (config.Discord && config.Discord.LiveEmbeds) || {};
  const channelId = liveCfg.PlayersChannel;
  if (!channelId) return;

  const intervalMs = (liveCfg.PlayersUpdateInterval || liveCfg.UpdateInterval || 30) * 1000;
  const tracked = trackedMessages.players;
  if (tracked.messageId && Date.now() - tracked.lastUpdate < intervalMs) return;

  await upsertEmbed(client, channelId, ':busts_in_silhouette: Online Players', tracked, buildPlayersEmbed());
  tracked.lastUpdate = Date.now();
}

/**
 * Build the abandoned-bunkers live embed (which bunkers are active vs locked).
 * State is tracked from the gameplay log's [LogBunkerLock] lines.
 */
function buildBunkerEmbed() {
  const liveCfg = (config.Discord && config.Discord.LiveEmbeds) || {};
  bunkerState.seedFromLog();
  const bunkers = bunkerState.getBunkers();

  const active = bunkers.filter((b) => b.state === 'active');
  const locked = bunkers.filter((b) => b.state !== 'active');

  const mapLink = (b) => ((b.location && b.location.x != null)
    ? ` \u00b7 [\ud83d\uddfa\ufe0f map](https://scum-map.com/en/shared/scum/island/${Math.round(b.location.x)},${Math.round(b.location.y)},${Math.round(b.location.z)})`
    : '');

  const embed = new EmbedBuilder()
    .setTitle(':european_castle: Abandoned Bunkers')
    .setColor(active.length ? COLORS.green : COLORS.grey)
    .setTimestamp(new Date());

  if (!bunkers.length) {
    embed.setDescription([
      'Abandoned bunkers across the island open on a timer, stay open for a while, then lock again.',
      '',
      '*No bunker data yet \u2014 this updates when the server next reports bunker status.*',
    ].join('\n'));
    if (liveCfg.Images && liveCfg.Images.Bunker) embed.setImage(liveCfg.Images.Bunker);
    return embed;
  }

  embed.setDescription([
    'Loot the **open** bunkers before they lock again \u2014 **locked** ones reopen on the timer shown.',
    '',
    `\ud83d\udfe2 **${active.length}** open  \u00b7  \ud83d\udd12 **${locked.length}** locked`,
  ].join('\n'));

  if (active.length) {
    const value = active
      .map((b) => `\ud83d\udfe2 \`${b.sector}\` \u2014 open${b.activationUnix ? ` since <t:${b.activationUnix}:R>` : ''}${mapLink(b)}`)
      .join('\n')
      .slice(0, 1024);
    embed.addFields({ name: `\ud83d\udfe2 Open  \u00b7  ${active.length}`, value, inline: false });
  }
  if (locked.length) {
    const value = locked
      .map((b) => `\ud83d\udd12 \`${b.sector}\` \u2014 ${b.etaUnix ? `opens <t:${b.etaUnix}:R>` : 'locked'}${mapLink(b)}`)
      .join('\n')
      .slice(0, 1024);
    embed.addFields({ name: `\ud83d\udd12 Locked  \u00b7  ${locked.length}`, value, inline: false });
  }

  if (liveCfg.Images && liveCfg.Images.Bunker) embed.setImage(liveCfg.Images.Bunker);
  addFieldConsole(embed);
  return embed;
}
/**
 * Update (or create) the abandoned-bunkers live embed if its interval has elapsed.
 */
async function updateBunkerEmbed(client) {
  const liveCfg = (config.Discord && config.Discord.LiveEmbeds) || {};
  const channelId = liveCfg.BunkerChannel;
  if (!channelId) return;

  const intervalMs = (liveCfg.BunkerUpdateInterval || liveCfg.UpdateInterval || 60) * 1000;
  const tracked = trackedMessages.bunkers;
  if (tracked.messageId && Date.now() - tracked.lastUpdate < intervalMs) return;

  await upsertEmbed(client, channelId, ':european_castle: Abandoned Bunkers', tracked, buildBunkerEmbed());
  tracked.lastUpdate = Date.now();
}

/**
 * Build the economy live embed: current special deals, per-trader funds (named by
 * location/type from the economy log), gold buy/sell capacity and the restock
 * rotation info. Trader funds come from the log because SCUM.db only stores them
 * under nameless GUIDs.
 */
function buildEconomyOverviewEmbed() {
  const liveCfg = (config.Discord && config.Discord.LiveEmbeds) || {};
  const num = (n) => Number(n || 0).toLocaleString('en-US');
  const money = (n) => `${num(n)} $`;
  const goldAmt = (n) => `${num(n)} gold`;

  const embed = new EmbedBuilder()
    .setTitle(':moneybag: Economy')
    .setColor(COLORS.gold)
    .setTimestamp(new Date());

  if (!database.isScumDbAvailable()) {
    embed.setDescription('SCUM database not found yet.');
    return embed;
  }

  // --- Special deals (what's on sale) ---
  let deals = [];
  try { deals = database.getSpecialDeals(12) || []; } catch { deals = []; }
  if (deals.length) {
    const value = deals.map((d) => {
      const where = [d.location, d.sector, d.trader].filter(Boolean)[0] || '';
      const extras = [
        `💰 ${money(d.price)}`,
        `📦 ${num(d.stock)}`,
        d.fameRequired ? `⭐ ${num(d.fameRequired)}` : '',
        where ? `📍 ${where}` : '',
      ].filter(Boolean).join(' · ');
      return `**${d.item}** — ${extras}`;
    }).join('\n').slice(0, 1024);
    embed.addFields({ name: `🏷️ On Sale  ·  ${deals.length}`, value, inline: false });
  } else {
    embed.addFields({ name: '🏷️ On Sale', value: '*No special deals right now.*', inline: false });
  }

  // --- Trader funds (from the economy log) — one block per outpost ---
  economyState.seedFromLog();
  const traders = economyState.getTraderFunds();
  if (traders.length) {
    const total = traders.reduce((s, t) => s + (t.funds || 0), 0);
    // Header row for the whole section. The note makes clear these are the last known
    // balances from the economy log, refreshed only when a player actually trades.
    embed.addFields({
      name: `💰 Trader Funds  ·  ${money(total)}`,
      value: '*Last known amounts — updated whenever a player makes a trade.*',
      inline: false,
    });

    const byLoc = new Map();
    for (const t of traders) {
      if (!byLoc.has(t.location)) byLoc.set(t.location, []);
      const fundsLabel = t.funds == null ? 'Unknown' : money(t.funds);
      byLoc.get(t.location).push(`${t.type} — ${fundsLabel}`);
    }
    // Each outpost is a full-width field, so they stack vertically (not in columns).
    for (const [loc, list] of byLoc) {
      embed.addFields({ name: `🏪 Outpost ${loc}`, value: list.join('\n').slice(0, 1024) || '​', inline: false });
    }
  } else {
    embed.addFields({
      name: '💰 Trader Funds',
      value: '*No trader activity recorded yet — fills in as players trade.*',
      inline: false,
    });
  }

  // --- Gold (buy capacity is money the outpost pays you; sell capacity is gold stock) ---
  let gold = null;
  try { gold = database.getGoldCapacity(); } catch { gold = null; }
  if (gold && gold.outposts) {
    embed.addFields({
      name: '🪙 Gold',
      value: `Buy capacity: **${money(gold.buyFunds)}**\nSell capacity: **${goldAmt(gold.sellFunds)}**`,
      inline: false,
    });
  }

  // --- Stock rotation / restock (only show what's actually meaningful here) ---
  let timing = null;
  try { timing = database.getEconomyTiming(); } catch { timing = null; }
  if (timing) {
    const parts = [];
    if (timing.rotationEnabled && timing.rotationHoursMin != null && timing.rotationHoursMax != null) {
      parts.push(`🔄 Items rotate every **${timing.rotationHoursMin}–${timing.rotationHoursMax}** in-game hours`);
    }
    if (timing.fullRestockHours != null) parts.push(`📦 Sold-out stock refills in **${timing.fullRestockHours} h**`);
    // A full economy reset only matters when it's actually scheduled (> 0); a value
    // of -1 means it's disabled, so we hide it (and the confusing "last reset" line).
    if (timing.resetTimeHours != null && timing.resetTimeHours > 0) {
      parts.push(`🔁 Full economy reset every **${timing.resetTimeHours} h**`);
      if (timing.secondsSinceReset != null) {
        const h = Math.floor(timing.secondsSinceReset / 3600);
        const m = Math.floor((timing.secondsSinceReset % 3600) / 60);
        parts.push(`⏱️ Last reset **${h}h ${m}m** ago`);
      }
    }
    if (parts.length) embed.addFields({ name: '♻️ Stock Rotation', value: parts.join('\n'), inline: false });
  }

  if (liveCfg.Images && liveCfg.Images.Economy) embed.setImage(liveCfg.Images.Economy);
  addFieldConsole(embed);
  return embed;
}

/**
 * Update (or create) the economy live embed if its interval has elapsed.
 */
async function updateEconomyEmbed(client) {
  const liveCfg = (config.Discord && config.Discord.LiveEmbeds) || {};
  const channelId = liveCfg.EconomyChannel;
  if (!channelId) return;

  const intervalMs = (liveCfg.EconomyUpdateInterval || liveCfg.UpdateInterval || 120) * 1000;
  const tracked = trackedMessages.economy;
  if (tracked.messageId && Date.now() - tracked.lastUpdate < intervalMs) return;

  await upsertEmbed(client, channelId, ':moneybag: Economy', tracked, buildEconomyOverviewEmbed());
  tracked.lastUpdate = Date.now();
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
      await updatePlayersEmbed(client);
    } catch (err) {
      logger.warn(`[Discord] Players embed update failed: ${err.message}`);
    }
    try {
      await updateBunkerEmbed(client);
    } catch (err) {
      logger.warn(`[Discord] Bunker embed update failed: ${err.message}`);
    }
    try {
      await updateEconomyEmbed(client);
    } catch (err) {
      logger.warn(`[Discord] Economy embed update failed: ${err.message}`);
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

module.exports = { startLiveEmbeds, stopLiveEmbeds, buildStatusEmbed, buildLeaderboardEmbed, buildPlayersEmbed, buildBunkerEmbed, buildEconomyOverviewEmbed };
