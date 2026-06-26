'use strict';

const fs = require('fs');
const path = require('path');
const {
  REST, Routes, SlashCommandBuilder,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} = require('discord.js');
const logger = require('../core/logger');
const { config, env, paths } = require('../core/config');
const { schedulingState } = require('../core/state');
const database = require('../database');
const { COLORS, FOOTER } = require('./embeds');
const { applyBranding, brandPayload, getFieldConsoleUrl } = require('./branding');
const { parseChatLine } = require('./chatRelay');
const monitoring = require('../server/monitoring');
const service = require('../server/service');
const backup = require('../automation/backup');
const scheduling = require('../automation/scheduling');
const update = require('../automation/update');
const events = require('../core/events');
const { buildStatusEmbed } = require('./liveEmbeds');

const CONNECT_CODE_RE = /^connect:([A-Z0-9]{6})$/;

// ===========================================================================
// Slash command definitions
// ===========================================================================

const COMMAND_DEFS = [
  // Account linking
  new SlashCommandBuilder()
    .setName('link-account')
    .setDescription('Link your Discord account to your SCUM character')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('unlink-account')
    .setDescription('Unlink your Discord account from your SCUM character')
    .toJSON(),

  // Player stats
  new SlashCommandBuilder()
    .setName('my-stats')
    .setDescription('Show your SCUM character stats (requires a linked account)')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('player-stats')
    .setDescription('Show stats for a player by in-game name')
    .addStringOption((opt) =>
      opt.setName('name').setDescription('In-game player name').setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('player-search')
    .setDescription('Search for players by name or Steam ID')
    .addStringOption((opt) =>
      opt.setName('query').setDescription('Partial player name').setRequired(false))
    .addStringOption((opt) =>
      opt.setName('steamid').setDescription('Steam ID (exact match)').setRequired(false))
    .toJSON(),

  // Server info (public)
  new SlashCommandBuilder()
    .setName('server-info')
    .setDescription('Show current server status')
    .toJSON(),

  // Server management (admin)
  new SlashCommandBuilder()
    .setName('server-status')
    .setDescription('[Admin] Show detailed server status embed')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('server-start')
    .setDescription('[Admin] Start the SCUM server')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('server-stop')
    .setDescription('[Admin] Stop the SCUM server')
    .addIntegerOption((opt) =>
      opt.setName('minutes').setDescription('Delay in minutes (0 = immediate)').setMinValue(0))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('server-restart')
    .setDescription('[Admin] Restart the SCUM server')
    .addIntegerOption((opt) =>
      opt.setName('minutes').setDescription('Delay in minutes (0 = immediate)').setMinValue(0))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('server-update')
    .setDescription('[Admin] Check for and apply game updates')
    .addIntegerOption((opt) =>
      opt.setName('minutes').setDescription('Delay in minutes (0 = immediate)').setMinValue(0))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('server-backup')
    .setDescription('[Admin] Create a manual server backup')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('server-validate')
    .setDescription('[Admin] Validate server files via SteamCMD')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('server-cancel')
    .setDescription('[Admin] Cancel pending scheduled restart / stop / update')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('server-restart-skip')
    .setDescription('[Admin] Toggle skipping the next scheduled restart')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('bot-status')
    .setDescription('[Admin] Show bot and system status')
    .toJSON(),

  // Online players (public)
  new SlashCommandBuilder()
    .setName('player-online')
    .setDescription('Show currently online players')
    .toJSON(),
];

async function registerSlashCommands(client) {
  const guildId = (config.Discord || {}).GuildId;
  if (!guildId) {
    logger.warn('[Discord] Discord.GuildId not set in config — slash commands not registered');
    return;
  }

  try {
    const rest = new REST({ version: '10' }).setToken(env.discordToken);
    await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: COMMAND_DEFS });
    logger.info(`[Discord] Registered ${COMMAND_DEFS.length} slash commands for guild ${guildId}`);
  } catch (err) {
    logger.error(`[Discord] Failed to register slash commands: ${err.message}`);
  }
}

// ===========================================================================
// Shared embed helpers
// ===========================================================================

function fmtPlaytime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtKdr(kills, deaths) {
  if (deaths === 0) return kills > 0 ? kills.toFixed(2) : '0.00';
  return (kills / deaths).toFixed(2);
}

function fmtNum(n) {
  return Math.trunc(Number(n) || 0).toLocaleString('en-US');
}

function buildPlayerStatsEmbed(stats, online, lastSeen) {
  const kdr = fmtKdr(stats.Kills, stats.Deaths);
  const survivedH = (Number(stats.MinutesSurvived || 0) / 60).toFixed(1);
  const distanceKm = (Number(stats.Distance || 0) / 1000).toFixed(1);

  return new EmbedBuilder()
    .setTitle(`${online ? '🟢' : '⚫'} ${stats.Name}`)
    .setColor(online ? COLORS.green : COLORS.grey)
    .setImage('https://playhub.cz/scum/13.gif')
    .setTimestamp()
    // 24 fields (8 rows of 3) — within Discord's 25-field embed limit. Kept in
    // sync with the dashboard "My Stats" panel so both show the same metrics.
    .addFields(
      { name: '🛡️ Squad', value: stats.SquadName || '*No squad*', inline: true },
      { name: '📡 Status', value: online ? 'Online' : 'Offline', inline: true },
      { name: '🕓 Last Seen', value: lastSeen, inline: true },

      { name: '⚔️ Kills', value: fmtNum(stats.Kills), inline: true },
      { name: '💀 Deaths', value: fmtNum(stats.Deaths), inline: true },
      { name: '📊 K/D', value: kdr, inline: true },

      { name: '🔫 PvP Kills', value: fmtNum(stats.PvpKills), inline: true },
      { name: '☠️ PvP Deaths', value: fmtNum(stats.PvpDeaths), inline: true },
      { name: '🎯 Headshots', value: fmtNum(stats.Headshots), inline: true },

      { name: '🧟 Puppet Kills', value: fmtNum(stats.ZombieKills), inline: true },
      { name: '🐾 Animal Kills', value: fmtNum(stats.AnimalKills), inline: true },
      { name: '🔭 Longest Kill', value: `${fmtNum(stats.LongestKill)} m`, inline: true },

      { name: '🔥 Firearm Kills', value: fmtNum(stats.FirearmKills), inline: true },
      { name: '🔪 Melee Kills', value: fmtNum(stats.MeleeKills), inline: true },
      { name: '🏹 Archery Kills', value: fmtNum(stats.ArcheryKills), inline: true },

      { name: '⏱️ Survived', value: `${survivedH} h`, inline: true },
      { name: '👣 Distance', value: `${distanceKm} km`, inline: true },
      { name: '📦 Looted', value: fmtNum(stats.Looted), inline: true },

      { name: '🔓 Locks Picked', value: fmtNum(stats.LocksPicked), inline: true },
      { name: '🔨 Items Crafted', value: fmtNum(stats.Crafted), inline: true },
      { name: '🎣 Fish Caught', value: fmtNum(stats.FishCaught), inline: true },

      { name: '⭐ Fame', value: fmtNum(stats.FamePoints), inline: true },
      { name: '💰 Money', value: fmtNum(stats.Money), inline: true },
      { name: '⏲️ Playtime', value: fmtPlaytime(stats.PlayTime), inline: true },
    );
}

function resolvePlayerStats(playerName) {
  if (!database.isScumDbAvailable()) return { error: 'db_unavailable' };
  const stats = database.getPlayerStatsByName(playerName);
  if (!stats) return { error: 'not_found' };
  // SCUM.db's live login/logout state is authoritative — the a_user_profile row
  // (from the Discord login feed) can be stale/missing. Online status and the
  // last-seen time both come from SCUM.db. Render last-seen as a Discord
  // timestamp so it's shown in each viewer's own local time/zone.
  const online = stats.IsOnline === 1;
  let lastSeen = '-';
  if (online) {
    lastSeen = 'Online now';
  } else if (stats.LastLogout) {
    const ts = Date.parse(stats.LastLogout);
    lastSeen = Number.isNaN(ts) ? stats.LastLogout : `<t:${Math.floor(ts / 1000)}:R>`;
  }
  return { stats, online, lastSeen };
}

// ===========================================================================
// Slash command handlers
// ===========================================================================

async function handleLinkAccount(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const { id: discordUserId, username: discordUsername } = interaction.user;
  const existing = database.getDiscordProfile(discordUserId);

  if (existing) {
    const embed = new EmbedBuilder()
      .setTitle(':link: Already Linked')
      .setDescription('Your Discord account is already linked to a SCUM character.')
      .addFields(
        { name: ':id: Player Name', value: existing.player_name || 'Unknown', inline: true },
        { name: ':key: Steam ID', value: `\`${existing.steam_id}\``, inline: true },
        { name: ':calendar: Linked At', value: `<t:${Math.floor(new Date(existing.linked_at).getTime() / 1000)}:F>`, inline: false },
        { name: ':information_source: Want to relink?', value: 'Use `/unlink-account` first, then run this command again.', inline: false },
      )
      .setColor(COLORS.blue)
      .setFooter(FOOTER)
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const { code, expiresAt } = database.createPendingRegistration(discordUserId, discordUsername);
  const expireTs = Math.floor(new Date(expiresAt).getTime() / 1000);

  const embed = new EmbedBuilder()
    .setTitle(':link: Link Your SCUM Account')
    .setDescription('Type the command below in the in-game chat to link your accounts.')
    .addFields(
      { name: ':key: Your Code', value: `\`\`\`connect:${code}\`\`\``, inline: false },
      { name: ':timer: Expires', value: `<t:${expireTs}:R>`, inline: true },
      { name: ':information_source: Steps', value: '1. Join the SCUM server\n2. Open chat (default key: `T`)\n3. Type the code above and press Enter\n4. Your accounts will be linked automatically!', inline: false },
    )
    .setColor(COLORS.green)
    .setFooter(FOOTER)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleUnlinkAccount(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const profile = database.unlinkAccount(interaction.user.id);
  if (!profile) {
    await interaction.editReply({ content: ':x: Your Discord account is not linked to any SCUM character.' });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(':broken_chain: Account Unlinked')
    .setDescription('Your Discord account has been successfully unlinked from your SCUM character.')
    .addFields(
      { name: ':information_source: Previously linked to', value: `**Player:** ${profile.player_name || 'Unknown'}\n**Steam ID:** \`${profile.steam_id}\``, inline: false },
      { name: ':link: Want to link again?', value: 'Use `/link-account` to create a new connection anytime.', inline: false },
    )
    .setColor(COLORS.orange)
    .setFooter(FOOTER)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleMyStats(interaction) {
  await interaction.deferReply();

  const linked = database.getDiscordProfile(interaction.user.id);
  if (!linked) {
    await interaction.editReply({ content: ':x: Your Discord account is not linked. Use `/link-account` to link it.' });
    return;
  }

  const { error, stats, online, lastSeen } = resolvePlayerStats(linked.player_name);
  if (error === 'db_unavailable') { await interaction.editReply({ content: ':x: Game database is not available.' }); return; }
  if (error === 'not_found') { await interaction.editReply({ content: `:x: Stats for \`${linked.player_name}\` not found in game database.` }); return; }

  await interaction.editReply({ embeds: [buildPlayerStatsEmbed(stats, online, lastSeen)] });
}

async function handleSlashPlayerStats(interaction) {
  await interaction.deferReply();

  const name = interaction.options.getString('name');
  const { error, stats, online, lastSeen } = resolvePlayerStats(name);
  if (error === 'db_unavailable') { await interaction.editReply({ content: ':x: Game database is not available.' }); return; }
  if (error === 'not_found') { await interaction.editReply({ content: `:x: Player \`${name}\` not found.` }); return; }

  await interaction.editReply({ embeds: [buildPlayerStatsEmbed(stats, online, lastSeen)] });
}

async function handleSlashPlayerSearch(interaction) {
  await interaction.deferReply();

  const query = interaction.options.getString('query');
  const steamId = interaction.options.getString('steamid');

  if (!query && !steamId) {
    await interaction.editReply({ content: ':x: Provide either a `query` (partial name) or a `steamid`.' });
    return;
  }

  if (!database.isScumDbAvailable()) {
    await interaction.editReply({ content: ':x: Game database is not available.' });
    return;
  }

  const players = steamId
    ? database.searchPlayersBySteamId(steamId)
    : database.searchPlayersByName(query, 15);

  if (!players.length) {
    const term = steamId ? `Steam ID \`${steamId}\`` : `\`${query}\``;
    await interaction.editReply({ content: `:mag: No players found matching ${term}.` });
    return;
  }

  const lines = players.map((p, i) =>
    `**${i + 1}.** ${p.Name} (${p.SteamID}) — Fame: ${p.FamePoints} | K/D: ${fmtKdr(p.Kills, p.Deaths)}`);
  const title = steamId ? `:mag: Player Search: Steam ID ${steamId}` : `:mag: Player Search: "${query}"`;
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(lines.join('\n'))
    .setColor(COLORS.blue)
    .setFooter(FOOTER)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ===========================================================================
// Admin role check
// ===========================================================================

function checkAdminRole(interaction) {
  const adminRoles = (((config.Discord || {}).SlashCommands || {}).AdminRoles || []).filter(Boolean);
  if (!adminRoles.length) return true; // no restriction configured → everyone is admin
  if (!interaction.member) return false;
  return adminRoles.some((id) => interaction.member.roles.cache.has(id));
}

// ===========================================================================
// Server management slash command handlers (admin)
// ===========================================================================

/**
 * Show a Confirm / Cancel button prompt on the (already-deferred, ephemeral)
 * interaction and wait for the admin's choice. Returns true only if they click
 * Confirm within the timeout. Used to gate immediate destructive actions.
 */
async function confirmAction(interaction, { description, confirmLabel = 'Confirm', timeoutSeconds = 30 }) {
  const nonce = Math.random().toString(36).slice(2, 10);
  const confirmId = `cfm:${nonce}`;
  const cancelId = `cnl:${nonce}`;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(confirmId).setLabel(confirmLabel).setStyle(ButtonStyle.Danger).setEmoji('✅'),
    new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('✖️'),
  );

  const prompt = applyBranding(new EmbedBuilder()
    .setTitle(':warning: Confirmation Required')
    .setColor(COLORS.orange)
    .setDescription(`${description}\n\nThis runs **immediately**. Confirm within ${timeoutSeconds}s.`));

  await interaction.editReply({ embeds: [prompt], components: [row] });

  let message;
  try {
    message = await interaction.fetchReply();
  } catch {
    return false;
  }

  try {
    const click = await message.awaitMessageComponent({
      filter: (i) => i.user.id === interaction.user.id && (i.customId === confirmId || i.customId === cancelId),
      time: timeoutSeconds * 1000,
    });
    const confirmed = click.customId === confirmId;
    await click.update({
      embeds: [applyBranding(new EmbedBuilder()
        .setTitle(confirmed ? ':white_check_mark: Confirmed' : ':octagonal_sign: Cancelled')
        .setColor(confirmed ? COLORS.green : COLORS.grey)
        .setDescription(confirmed ? 'Executing now…' : 'Action cancelled — nothing was changed.'))],
      components: [],
    });
    return confirmed;
  } catch {
    await interaction.editReply({
      embeds: [applyBranding(new EmbedBuilder()
        .setTitle(':hourglass: Confirmation Timed Out')
        .setColor(COLORS.grey)
        .setDescription('No response received — action cancelled.'))],
      components: [],
    }).catch(() => {});
    return false;
  }
}

// Pending manual operations live in the shared schedulingState so the web
// dashboard can show them in "Next restart" and cancel them via the Skip toggle.
function cancelSlashTask(type) {
  return scheduling.cancelPendingManual(type);
}

function scheduleSlashTask(type, minutes, execute) {
  cancelSlashTask(type);
  if (!schedulingState.pendingManual) schedulingState.pendingManual = {};
  const notifKey = { restart: 'manualRestartWarning', stop: 'manualStopWarning', update: 'manualUpdateWarning' };
  const warningTimers = [];
  for (const w of [15, 5, 1]) {
    const delay = (minutes - w) * 60000;
    if (delay > 0) {
      warningTimers.push(setTimeout(() => {
        events.emit('notification', { type: notifKey[type] || type, data: { minutes: w } });
      }, delay));
    }
  }
  const timer = setTimeout(async () => {
    delete schedulingState.pendingManual[type];
    // Announce execution (the warning leading up to it has its own messages above).
    const execNotif = { restart: 'server.scheduledRestart' }[type];
    if (execNotif) events.emit('notification', { type: execNotif, data: {} });
    try { await execute(); } catch (err) {
      logger.error(`[Discord] Scheduled slash ${type} failed: ${err.message}`);
    }
  }, minutes * 60000);
  schedulingState.pendingManual[type] = { at: new Date(Date.now() + minutes * 60000), timer, warningTimers };
}

async function handleServerInfo(interaction) {
  await interaction.deferReply();
  const status = await monitoring.getServerStatus();
  const emoji = status.IsRunning ? ':green_circle:' : ':red_circle:';
  let info = [`${emoji} **${status.ActualServerState || status.Status || 'Unknown'}**`,
    `Players: **${status.OnlinePlayers} / ${status.MaxPlayers}**`];
  if (database.isScumDbAvailable()) {
    try {
      const gt = database.getGameTimeData();
      const wt = database.getWeatherData();
      if (gt && gt.Success) info.push(`Game time: **${gt.FormattedTime}**`);
      if (wt && wt.Success) info.push(`Weather: **${wt.FormattedTemperature}**`);
    } catch { /* best-effort */ }
  }
  await interaction.editReply({ content: info.join('\n') });
}

async function handleServerStatus(interaction) {
  await interaction.deferReply();
  if (!checkAdminRole(interaction)) {
    await interaction.editReply({ content: ':no_entry: Admin only.', ephemeral: true });
    return;
  }
  const { embed } = await buildStatusEmbed();
  await interaction.editReply({ embeds: [embed] });
}

async function handleServerStart(interaction) {
  await interaction.deferReply({ ephemeral: true });
  if (!checkAdminRole(interaction)) {
    await interaction.editReply({ content: ':no_entry: Admin only.' });
    return;
  }
  const ok = await service.startGameService(config.serviceName, `slash command by ${interaction.user.tag}`);
  await interaction.editReply({ content: ok ? ':white_check_mark: Server start command sent.' : ':x: Failed to start server.' });
}

async function handleServerStop(interaction) {
  await interaction.deferReply({ ephemeral: true });
  if (!checkAdminRole(interaction)) {
    await interaction.editReply({ content: ':no_entry: Admin only.' });
    return;
  }
  const minutes = interaction.options.getInteger('minutes') || 0;
  if (minutes > 0) {
    scheduleSlashTask('stop', minutes, () =>
      service.stopGameService(config.serviceName, `slash command scheduled by ${interaction.user.tag}`));
    await interaction.editReply({ content: `:clock1: Server will stop in **${minutes} minutes**. Use \`/server-cancel\` to abort.` });
    return;
  }

  const confirmed = await confirmAction(interaction, {
    description: ':octagonal_sign: **Stop the SCUM server now?** All online players will be disconnected.',
    confirmLabel: 'Stop Server',
  });
  if (!confirmed) return;

  const ok = await service.stopGameService(config.serviceName, `slash command by ${interaction.user.tag}`);
  await interaction.editReply({
    content: ok ? ':white_check_mark: Server stop command sent.' : ':x: Failed to stop server.',
    embeds: [],
    components: [],
  });
}

async function handleServerRestart(interaction) {
  await interaction.deferReply({ ephemeral: true });
  if (!checkAdminRole(interaction)) {
    await interaction.editReply({ content: ':no_entry: Admin only.' });
    return;
  }
  const minutes = interaction.options.getInteger('minutes') || 0;
  if (minutes > 0) {
    scheduleSlashTask('restart', minutes, () =>
      service.restartGameService(config.serviceName, `slash command scheduled by ${interaction.user.tag}`));
    await interaction.editReply({ content: `:clock1: Server will restart in **${minutes} minutes**. Use \`/server-cancel\` to abort.` });
    return;
  }

  const confirmed = await confirmAction(interaction, {
    description: ':arrows_counterclockwise: **Restart the SCUM server now?** All online players will be disconnected while it restarts.',
    confirmLabel: 'Restart Server',
  });
  if (!confirmed) return;

  const ok = await service.restartGameService(config.serviceName, `slash command by ${interaction.user.tag}`);
  await interaction.editReply({
    content: ok ? ':white_check_mark: Server restart command sent.' : ':x: Failed to restart server.',
    embeds: [],
    components: [],
  });
}

async function handleServerUpdate(interaction) {
  await interaction.deferReply({ ephemeral: true });
  if (!checkAdminRole(interaction)) {
    await interaction.editReply({ content: ':no_entry: Admin only.' });
    return;
  }
  if (schedulingState.updateInProgress) {
    await interaction.editReply({ content: ':x: An update is already in progress.' });
    return;
  }
  const minutes = interaction.options.getInteger('minutes') || 0;
  const doUpdate = async () => {
    schedulingState.updateInProgress = true;
    try {
      await update.invokeImmediateUpdate(paths.steamCmd, paths.serverDir, config.appId, config.serviceName);
    } finally {
      schedulingState.updateInProgress = false;
      schedulingState.updateStatus = await update.getUpdateStatus(paths.steamCmd, paths.serverDir, config.appId).catch(() => null);
    }
  };
  if (minutes > 0) {
    scheduleSlashTask('update', minutes, doUpdate);
    await interaction.editReply({ content: `:clock1: Server will update in **${minutes} minutes**.` });
  } else {
    await interaction.editReply({ content: ':arrows_counterclockwise: Checking for updates...' });
    const status = await update.testUpdateAvailable(paths.steamCmd, paths.serverDir, config.appId).catch(() => null);
    if (status && !status.UpdateAvailable) {
      await interaction.editReply({ content: ':white_check_mark: Server is already up to date.' });
      return;
    }
    const confirmed = await confirmAction(interaction, {
      description: ':arrow_up: **An update is available — install it now?** The server will be stopped during the update.',
      confirmLabel: 'Update Now',
    });
    if (!confirmed) return;
    await interaction.editReply({ content: ':arrow_up: Installing update...', embeds: [], components: [] });
    doUpdate().catch((err) => logger.error(`[Discord] Slash update failed: ${err.message}`));
  }
}

async function handleServerBackup(interaction) {
  await interaction.deferReply({ ephemeral: true });
  if (!checkAdminRole(interaction)) {
    await interaction.editReply({ content: ':no_entry: Admin only.' });
    return;
  }
  await interaction.editReply({ content: ':floppy_disk: Creating backup...' });
  try {
    const fileName = await backup.createBackup('manual');
    await interaction.editReply({ content: `:white_check_mark: Backup created: \`${fileName}\`` });
  } catch (err) {
    await interaction.editReply({ content: `:x: Backup failed: ${err.message}` });
  }
}

async function handleServerValidate(interaction) {
  await interaction.deferReply({ ephemeral: true });
  if (!checkAdminRole(interaction)) {
    await interaction.editReply({ content: ':no_entry: Admin only.' });
    return;
  }
  const confirmed = await confirmAction(interaction, {
    description: ':mag: **Validate server files via SteamCMD now?** The server will be stopped during validation.',
    confirmLabel: 'Validate Files',
  });
  if (!confirmed) return;

  await interaction.editReply({ content: ':mag: Validating server files (server will be stopped)...', embeds: [], components: [] });
  try {
    const result = await update.invokeServerValidation(paths.steamCmd, paths.serverDir, config.appId, config.serviceName);
    await interaction.editReply({ content: result && result.Success ? ':white_check_mark: Validation complete.' : `:x: Validation failed: ${result && result.Error ? result.Error : 'unknown error'}` });
  } catch (err) {
    await interaction.editReply({ content: `:x: Validation error: ${err.message}` });
  }
}

async function handleServerCancel(interaction) {
  await interaction.deferReply({ ephemeral: true });
  if (!checkAdminRole(interaction)) {
    await interaction.editReply({ content: ':no_entry: Admin only.' });
    return;
  }
  const cancelled = ['restart', 'stop', 'update'].filter((t) => cancelSlashTask(t));
  await interaction.editReply({
    content: cancelled.length
      ? `:white_check_mark: Cancelled: ${cancelled.join(', ')}`
      : ':information_source: No pending scheduled operations.',
  });
}

async function handleServerRestartSkip(interaction) {
  await interaction.deferReply({ ephemeral: true });
  if (!checkAdminRole(interaction)) {
    await interaction.editReply({ content: ':no_entry: Admin only.' });
    return;
  }
  const current = scheduling.getRestartSkipStatus();
  if (current) {
    scheduling.clearRestartSkip();
    await interaction.editReply({ content: ':white_check_mark: Restart skip **cleared** — the next scheduled restart will proceed as normal.' });
  } else {
    scheduling.setRestartSkip();
    await interaction.editReply({ content: ':fast_forward: Restart skip **enabled** — the next scheduled restart will be skipped.' });
  }
}

async function handlePlayerOnline(interaction) {
  await interaction.deferReply();
  if (!database.isScumDbAvailable()) {
    await interaction.editReply({ content: ':x: Game database is not available.' });
    return;
  }
  const players = database.getOnlinePlayers();
  if (!players.length) {
    await interaction.editReply({ content: ':busts_in_silhouette: **No players online.**' });
    return;
  }
  const list = players.map((p, i) => `**${i + 1}.** ${p.PlayerName || p.name}`).join('\n');
  const embed = new EmbedBuilder()
    .setTitle(`:green_circle: Online Players (${players.length})`)
    .setDescription(list)
    .setColor(COLORS.green)
    .setFooter(FOOTER)
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function handleBotStatus(interaction, client) {
  await interaction.deferReply({ ephemeral: true });
  if (!checkAdminRole(interaction)) {
    await interaction.editReply({ content: ':no_entry: Admin only.' });
    return;
  }
  const uptimeSec = Math.floor(process.uptime());
  const h = Math.floor(uptimeSec / 3600);
  const m = Math.floor((uptimeSec % 3600) / 60);
  const s = uptimeSec % 60;
  const dbAvailable = database.isScumDbAvailable();
  const memMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  const ping = client ? `${client.ws.ping}ms` : '-';
  const embed = new EmbedBuilder()
    .setTitle(':robot: Bot Status')
    .setColor(COLORS.blue)
    .setFooter(FOOTER)
    .setTimestamp()
    .addFields(
      { name: ':clock1: Uptime', value: `${h}h ${m}m ${s}s`, inline: true },
      { name: ':satellite: WS Ping', value: ping, inline: true },
      { name: ':zap: Memory', value: `${memMB} MB`, inline: true },
      { name: ':game_die: Game DB', value: dbAvailable ? ':green_circle: Available' : ':red_circle: Unavailable', inline: true },
      { name: ':link: Account Links', value: (() => {
        try { return `${database.getServerDb().prepare('SELECT COUNT(*) AS c FROM a_discord_profiles').get().c} linked`; } catch { return '-'; }
      })(), inline: true },
      { name: ':floppy_disk: Node.js', value: process.version, inline: true },
      { name: ':satellite: Discord.js', value: require('discord.js').version, inline: true },
    );
  await interaction.editReply({ embeds: [embed] });
}

// ===========================================================================
// Button handlers
// ===========================================================================

async function handleButton_link_account(interaction) {
  return handleLinkAccount(interaction);
}

async function handleButton_check_status(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const linked = database.getDiscordProfile(interaction.user.id);
  if (linked) {
    const embed = new EmbedBuilder()
      .setTitle(':link: Account Linked')
      .setDescription('Your Discord account is linked to a SCUM character.')
      .addFields(
        { name: ':id: Player Name', value: linked.player_name || 'Unknown', inline: true },
        { name: ':key: Steam ID', value: `\`${linked.steam_id}\``, inline: true },
        { name: ':calendar: Linked At', value: `<t:${Math.floor(new Date(linked.linked_at).getTime() / 1000)}:F>`, inline: false },
      )
      .setColor(COLORS.green)
      .setFooter(FOOTER)
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const pending = database.getPendingRegistrationByUserId(interaction.user.id);
  if (pending) {
    const expireTs = Math.floor(new Date(pending.expires_at).getTime() / 1000);
    const embed = new EmbedBuilder()
      .setTitle(':hourglass: Pending Registration')
      .setDescription('You have a pending registration code. Type it in-game to complete linking.')
      .addFields(
        { name: ':key: Your Code', value: `\`\`\`connect:${pending.registration_code}\`\`\``, inline: false },
        { name: ':timer: Expires', value: `<t:${expireTs}:R>`, inline: true },
      )
      .setColor(COLORS.yellow)
      .setFooter(FOOTER)
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  await interaction.editReply({ content: ':broken_chain: Your Discord account is not linked. Click **Link Account** to get started.' });
}

async function handleButton_unlink_account(interaction) {
  return handleUnlinkAccount(interaction);
}

// ===========================================================================
// Interaction dispatcher
// ===========================================================================

function registerInteractionHandler(client) {
  client.on('interactionCreate', async (interaction) => {
    // Auto-brand every outgoing reply: convert :shortcodes: to Unicode and
    // stamp the consistent footer/logo, so no handler has to remember to.
    for (const method of ['reply', 'editReply', 'followUp']) {
      if (typeof interaction[method] === 'function') {
        const original = interaction[method].bind(interaction);
        interaction[method] = (payload) => original(brandPayload(payload));
      }
    }

    try {
      if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;
        // Account linking
        if (commandName === 'link-account') return handleLinkAccount(interaction);
        if (commandName === 'unlink-account') return handleUnlinkAccount(interaction);
        // Player stats
        if (commandName === 'my-stats') return handleMyStats(interaction);
        if (commandName === 'player-stats') return handleSlashPlayerStats(interaction);
        if (commandName === 'player-search') return handleSlashPlayerSearch(interaction);
        // Server info / management
        if (commandName === 'server-info') return handleServerInfo(interaction);
        if (commandName === 'server-status') return handleServerStatus(interaction);
        if (commandName === 'server-start') return handleServerStart(interaction);
        if (commandName === 'server-stop') return handleServerStop(interaction);
        if (commandName === 'server-restart') return handleServerRestart(interaction);
        if (commandName === 'server-update') return handleServerUpdate(interaction);
        if (commandName === 'server-backup') return handleServerBackup(interaction);
        if (commandName === 'server-validate') return handleServerValidate(interaction);
        if (commandName === 'server-cancel') return handleServerCancel(interaction);
        if (commandName === 'server-restart-skip') return handleServerRestartSkip(interaction);
        if (commandName === 'player-online') return handlePlayerOnline(interaction);
        if (commandName === 'bot-status') return handleBotStatus(interaction, client);
      } else if (interaction.isButton()) {
        const { customId } = interaction;
        if (customId === 'link_account') return handleButton_link_account(interaction);
        if (customId === 'check_status') return handleButton_check_status(interaction);
        if (customId === 'setting_account') return handleButton_check_status(interaction);
        if (customId === 'notify_settings') return handleButton_notify_settings(interaction);
        if (customId === 'unlink_account') return handleButton_unlink_account(interaction);
      } else if (interaction.isStringSelectMenu()) {
        const { customId } = interaction;
        if (customId === 'notify_types' || customId === 'notify_scope') return handleNotifySelect(interaction);
      }
    } catch (err) {
      logger.error(`[Discord] Interaction handling failed: ${err.message}`);
      try {
        const reply = interaction.deferred || interaction.replied ? interaction.editReply : interaction.reply;
        await reply.call(interaction, { content: ':x: An error occurred processing your request.', ephemeral: true });
      } catch { /* ignore */ }
    }
  });

  logger.info('[Discord] Interaction handler registered');
}

// ===========================================================================
// Account linking panel (persistent embed with buttons)
// ===========================================================================

function buildLinkingPanelEmbed() {
  return applyBranding(new EmbedBuilder()
    .setTitle(':link: Account Linking')
    .setDescription([
      'Link your Discord account to your in-game SCUM character for exclusive features.',
      '',
      '**How to link:**',
      '1. Click the **Link Account** button below',
      '2. You will receive a registration code (visible only to you)',
      '3. Join the server and type the code in game chat',
      '4. Your accounts will be linked automatically!',
      '',
      '**Benefits:**',
      '• Use `/my-stats` to view your own stats',
      '• Personal raid-protection and DM notifications',
    ].join('\n'))
    .setColor(0x00863a)
    .setImage('https://playhub.cz/scum/11.gif')
    .setTimestamp());
}

function buildLinkingPanelRow() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('link_account').setLabel('Link Account').setStyle(ButtonStyle.Success).setEmoji('🔗'),
    new ButtonBuilder().setCustomId('check_status').setLabel('Check Status').setStyle(ButtonStyle.Secondary).setEmoji('📊'),
    new ButtonBuilder().setCustomId('notify_settings').setLabel('Notifications').setStyle(ButtonStyle.Primary).setEmoji('⚙️'),
    new ButtonBuilder().setCustomId('unlink_account').setLabel('Unlink Account').setStyle(ButtonStyle.Danger).setEmoji('🔓'),
  );
  // Link out to the public web dashboard when it's exposed for players.
  const fcUrl = getFieldConsoleUrl();
  if (fcUrl) {
    row.addComponents(new ButtonBuilder().setLabel('Field Console').setStyle(ButtonStyle.Link).setURL(fcUrl).setEmoji('🖥️'));
  }
  return row;
}

/**
 * Build the ephemeral "Raid Notification Settings" message (embed + two select
 * menus) reflecting the user's current preferences.
 */
function buildNotifySettingsPayload(prefs) {
  const typesMenu = new StringSelectMenuBuilder()
    .setCustomId('notify_types')
    .setPlaceholder('Select what to be notified about (DM)')
    .setMinValues(0)
    .setMaxValues(4)
    .addOptions(
      { label: 'Raid / Base', value: 'raid', description: 'Protection changes & base being destroyed', emoji: '🛡️', default: prefs.raid },
      { label: 'Vehicles', value: 'vehicle', description: 'When your vehicle is destroyed', emoji: '🚗', default: prefs.vehicle },
      { label: 'Chests', value: 'chest', description: 'When your chest is taken or lost', emoji: '📦', default: prefs.chest },
      { label: 'Locks', value: 'lock', description: 'When someone picks your lock / dial pad', emoji: '🔒', default: prefs.lock },
    );

  const scopeMenu = new StringSelectMenuBuilder()
    .setCustomId('notify_scope')
    .setPlaceholder('Whose property to watch')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      { label: 'My stuff only', value: 'own', emoji: '👤', default: prefs.scope !== 'squad' },
      { label: 'My squad too', value: 'squad', emoji: '👥', default: prefs.scope === 'squad' },
    );

  const lines = [
    'Get a **direct message** when something happens to property you own.',
    '',
    `🛡️ Raid Protection — **${prefs.raid ? 'On' : 'Off'}**`,
    `🚗 Vehicles — **${prefs.vehicle ? 'On' : 'Off'}**`,
    `📦 Chests — **${prefs.chest ? 'On' : 'Off'}**`,
    `🔒 Locks — **${prefs.lock ? 'On' : 'Off'}**`,
    `👥 Scope — **${prefs.scope === 'squad' ? 'My squad too' : 'My stuff only'}**`,
  ];

  // Inform the user when the server restricts these alerts to the flag area.
  const flagFilter = ((config.SCUMLogFeatures || {}).OwnerAlertFlagFilter) || {};
  if (flagFilter.Enabled) {
    const typeLabels = [];
    if (flagFilter.Vehicles) typeLabels.push('🚗');
    if (flagFilter.Chests) typeLabels.push('📦');
    if (flagFilter.Locks) typeLabels.push('🔒');
    if (typeLabels.length) {
      const radius = Number(flagFilter.RadiusMeters) > 0 ? Number(flagFilter.RadiusMeters) : 50;
      lines.push(
        '',
        `📍 ${typeLabels.join(' ')} alerts are sent **only inside your flag area** (~${radius} m).`,
      );
    }
  }

  lines.push('', '*Use the menus below — changes save automatically.*');

  const embed = applyBranding(new EmbedBuilder()
    .setTitle('⚙️ Raid Notification Settings')
    .setColor(COLORS.blue)
    .setDescription(lines.join('\n')));

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(typesMenu),
      new ActionRowBuilder().addComponents(scopeMenu),
    ],
  };
}

async function handleButton_notify_settings(interaction) {
  const linked = database.getDiscordProfile(interaction.user.id);
  if (!linked) {
    await interaction.reply({ content: ':link: Link your account first using the **Link Account** button.', ephemeral: true });
    return;
  }
  const prefs = database.getNotifyPrefs(interaction.user.id);
  await interaction.reply({ ...buildNotifySettingsPayload(prefs), ephemeral: true });
}

async function handleNotifySelect(interaction) {
  if (!database.getDiscordProfile(interaction.user.id)) {
    await interaction.reply({ content: ':link: Link your account first.', ephemeral: true });
    return;
  }
  const prefs = database.getNotifyPrefs(interaction.user.id);
  if (interaction.customId === 'notify_types') {
    const vals = interaction.values || [];
    prefs.raid = vals.includes('raid');
    prefs.vehicle = vals.includes('vehicle');
    prefs.chest = vals.includes('chest');
    prefs.lock = vals.includes('lock');
  } else {
    prefs.scope = interaction.values[0] === 'squad' ? 'squad' : 'own';
  }
  database.setNotifyPrefs(interaction.user.id, prefs);
  await interaction.update(buildNotifySettingsPayload(prefs));
}

/**
 * Post (or update) the persistent account linking panel in a channel.
 * Called from the web API endpoint POST /api/account-linking/panel.
 */
async function sendLinkingPanel(client, channelId, updateMessageId) {
  const channel = await client.channels.fetch(channelId);
  if (!channel) throw new Error('Channel not found');

  const opts = { embeds: [buildLinkingPanelEmbed()], components: [buildLinkingPanelRow()] };

  if (updateMessageId) {
    try {
      const msg = await channel.messages.fetch(updateMessageId);
      const updated = await msg.edit(opts);
      return { messageId: updated.id, operation: 'updated' };
    } catch {
      // fall through to create new
    }
  }

  const msg = await channel.send(opts);
  return { messageId: msg.id, operation: 'created' };
}

// ===========================================================================
// Connect code poller — reads chat log, detects connect:CODE, processes links
// ===========================================================================

const POLLER_STATE_FILE = path.join(paths.root, 'data', 'connect_code_state.json');
let pollerTimer = null;
let pollerCurrentLog = null;
let pollerLastLine = 0;

function loadPollerState() {
  try {
    if (fs.existsSync(POLLER_STATE_FILE)) {
      const s = JSON.parse(fs.readFileSync(POLLER_STATE_FILE, 'utf8'));
      pollerCurrentLog = s.currentLogFile || null;
      pollerLastLine = s.lastLineNumber || 0;
      if (pollerCurrentLog && !fs.existsSync(pollerCurrentLog)) {
        pollerCurrentLog = null;
        pollerLastLine = 0;
      }
    }
  } catch { /* start fresh */ }
}

function savePollerState() {
  try {
    fs.mkdirSync(path.dirname(POLLER_STATE_FILE), { recursive: true });
    fs.writeFileSync(POLLER_STATE_FILE, JSON.stringify({
      currentLogFile: pollerCurrentLog,
      lastLineNumber: pollerLastLine,
      lastUpdate: new Date().toISOString(),
    }, null, 2));
  } catch (err) {
    logger.warn(`[Discord] Failed to save connect code poller state: ${err.message}`);
  }
}

function findLatestChatLog(dir) {
  try {
    const files = fs.readdirSync(dir)
      .filter((f) => /^chat_.*\.log$/i.test(f))
      .map((f) => ({ full: path.join(dir, f), ctime: fs.statSync(path.join(dir, f)).ctimeMs }));
    if (!files.length) return null;
    files.sort((a, b) => b.ctime - a.ctime);
    return files[0].full;
  } catch { return null; }
}

async function pollerTick(client) {
  const chatLogDir = path.join(paths.savedDir, 'SaveFiles', 'Logs');
  if (!fs.existsSync(chatLogDir)) return;

  const latest = findLatestChatLog(chatLogDir);
  if (!latest) return;

  if (pollerCurrentLog !== latest) {
    pollerCurrentLog = latest;
    pollerLastLine = 0;
  }

  let content;
  try { content = fs.readFileSync(latest, 'utf16le'); } catch { return; }

  const allLines = content.replace(/^﻿/, '').split(/\r?\n/)
    .filter((_, i, arr) => !(i === arr.length - 1 && arr[arr.length - 1] === ''));

  if (pollerLastLine >= allLines.length) return;

  const newLines = allLines.slice(pollerLastLine);
  pollerLastLine = allLines.length;

  let changed = false;
  for (const line of newLines) {
    if (!line.trim()) continue;
    const parsed = parseChatLine(line);
    if (!parsed) continue;
    const m = CONNECT_CODE_RE.exec(parsed.message.trim());
    if (!m) continue;

    changed = true;
    const code = m[1];
    logger.info(`[Discord] connect:${code} from ${parsed.nickname} (${parsed.steamId})`);

    try {
      const result = database.completeLinking(code, parsed.steamId, parsed.nickname);
      if (result.success) {
        logger.info(`[Discord] Account linked: ${result.discordUsername} <-> Steam ${parsed.steamId}`);
        try {
          const user = await client.users.fetch(result.discordUserId);
          const embed = applyBranding(new EmbedBuilder()
            .setTitle(':white_check_mark: Account Successfully Linked!')
            .setDescription('Your Discord account has been linked to your SCUM character.')
            .addFields(
              { name: ':id: Player Name', value: parsed.nickname, inline: true },
              { name: ':key: Steam ID', value: `\`${parsed.steamId}\``, inline: true },
              { name: ':calendar: Linked At', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
              { name: ':information_source: What now?', value: 'Use `/my-stats` to view your stats. Use `/unlink-account` to unlink.', inline: false },
            )
            .setColor(COLORS.green)
            .setTimestamp());
          await user.send({ embeds: [embed] });
        } catch (dmErr) {
          logger.warn(`[Discord] Failed to send linking DM: ${dmErr.message}`);
        }
      } else {
        logger.info(`[Discord] connect:${code} rejected (${result.reason})`);
      }
    } catch (err) {
      logger.error(`[Discord] Connect code processing error: ${err.message}`);
    }
  }

  if (changed) savePollerState();
  else if (newLines.length > 0) savePollerState();
}

function startConnectCodePoller(client) {
  loadPollerState();
  pollerTimer = setInterval(async () => {
    try { await pollerTick(client); } catch (err) {
      logger.error(`[Discord] Connect code poller error: ${err.message}`);
    }
  }, 10000);
  logger.info('[Discord] Connect code poller started (10s interval)');
}

function stopConnectCodePoller() {
  if (pollerTimer) clearInterval(pollerTimer);
  pollerTimer = null;
}

module.exports = {
  registerSlashCommands,
  registerInteractionHandler,
  startConnectCodePoller,
  stopConnectCodePoller,
  sendLinkingPanel,
};
