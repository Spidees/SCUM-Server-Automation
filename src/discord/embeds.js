'use strict';

const { EmbedBuilder } = require('discord.js');
const { standardFooter, applyBranding } = require('./branding');

const COLORS = {
  green: 0x57f287,
  red: 0xed4245,
  yellow: 0xfee75c,
  orange: 0xe67e22,
  blue: 0x3498db,
  grey: 0x95a5a6,
  gold: 0xffd700,
};

const FOOTER = standardFooter();

/**
 * Builds the description/fields for a performance alert (Pattern B).
 * Mirrors notification-manager.psm1's performance metrics table.
 */
function performanceFields(data) {
  return [
    { name: ':zap: FPS', value: `${data.fps ?? '-'}`, inline: true },
    { name: ':busts_in_silhouette: Players', value: `${data.players ?? '-'} / ${data.maxPlayers ?? '-'}`, inline: true },
    { name: ':desktop: CPU', value: data.cpu !== undefined ? `${data.cpu}%` : '-', inline: true },
    { name: ':floppy_disk: Memory', value: data.memory !== undefined ? `${data.memory} MB` : '-', inline: true },
    { name: ':game_die: Entities', value: data.entities !== undefined ? `${data.entities}` : '-', inline: true },
  ];
}

/**
 * Notification template table. Each entry returns { title, description, color, fields }.
 * Mirrors the reusable embed templates in templates/embed-styles.psm1 +
 * notifications/notification-manager.psm1.
 */
const TEMPLATES = {
  // Server lifecycle
  'server.started': () => ({ title: ':rocket: Server Started', color: COLORS.green, description: 'The SCUM server process has started.' }),
  'server.stopped': () => ({ title: ':octagonal_sign: Server Stopped', color: COLORS.grey, description: 'The SCUM server process has stopped.' }),
  'server.online': () => ({
    title: ':green_circle: Server Online',
    color: COLORS.green,
    description: 'The SCUM server is online and accepting players.',
  }),
  'server.offline': () => ({ title: ':red_circle: Server Offline', color: COLORS.red, description: 'The SCUM server is offline.' }),
  'server.starting': () => ({ title: ':hourglass_flowing_sand: Server Starting', color: COLORS.yellow, description: 'The SCUM server is starting up.' }),
  'server.shutting_down': () => ({ title: ':warning: Server Shutting Down', color: COLORS.orange, description: 'The SCUM server is shutting down.' }),
  'server.loading': () => ({ title: ':arrows_counterclockwise: Server Loading', color: COLORS.yellow, description: 'The SCUM server is loading the map and world data.' }),

  // Windows service lifecycle
  'service.started': () => ({ title: ':white_check_mark: Service Started', color: COLORS.green, description: 'The Windows service has started.' }),
  'service.stopped': () => ({ title: ':stop_sign: Service Stopped', color: COLORS.grey, description: 'The Windows service has stopped.' }),
  'service.starting': () => ({ title: ':hourglass_flowing_sand: Service Starting', color: COLORS.yellow, description: 'The Windows service is starting.' }),
  'service.stopping': () => ({ title: ':hourglass: Service Stopping', color: COLORS.orange, description: 'The Windows service is stopping.' }),

  // Manager lifecycle
  'manager.started': () => ({ title: ':robot: Automation Manager Started', color: COLORS.green, description: 'SCUM Server Automation is now running.' }),
  'manager.stopped': () => ({ title: ':octagonal_sign: Automation Manager Stopped', color: COLORS.grey, description: 'SCUM Server Automation has stopped.' }),
  'admin.alert': (data) => ({
    title: ':rotating_light: Admin Alert',
    color: data.severity === 'critical' ? COLORS.red : COLORS.orange,
    description: data.message || 'An admin alert was triggered.',
  }),
  error: (data) => ({ title: ':x: Error', color: COLORS.red, description: data.message || 'An error occurred.' }),
  info: (data) => ({ title: ':information_source: Info', color: COLORS.blue, description: data.message || '' }),

  // Backups
  'backup.started': (data) => ({ title: ':floppy_disk: Backup Started', color: COLORS.blue, description: `Starting ${data.type || 'manual'} backup...` }),
  'backup.completed': (data) => ({
    title: ':white_check_mark: Backup Completed',
    color: COLORS.green,
    description: `${(data.type || 'manual')[0].toUpperCase()}${(data.type || 'manual').slice(1)} backup completed successfully.`,
    fields: [
      { name: 'Size', value: data.size || '-', inline: true },
      { name: 'Duration', value: data.duration || '-', inline: true },
    ],
  }),
  'backup.failed': (data) => ({
    title: ':x: Backup Failed',
    color: COLORS.red,
    description: `Backup failed: ${data.error || 'unknown error'}`,
    fields: [{ name: 'Duration', value: data.duration || '-', inline: true }],
  }),

  // Updates
  'update.available': (data) => ({
    title: ':arrow_up: Update Available',
    color: COLORS.blue,
    description: 'A new server build is available.',
    fields: [
      { name: 'Installed', value: `${data.installedVersion ?? '-'}`, inline: true },
      { name: 'Latest', value: `${data.latestVersion ?? '-'}`, inline: true },
    ],
  }),
  'update.started': (data) => ({
    title: ':arrows_counterclockwise: Update Started',
    color: COLORS.yellow,
    description: 'The server update is now installing. The server will be temporarily unavailable.',
    fields: [
      { name: 'Current', value: `${data.currentVersion ?? '-'}`, inline: true },
      { name: 'Target', value: `${data.targetVersion ?? '-'}`, inline: true },
    ],
  }),
  'update.completed': (data) => ({
    title: ':white_check_mark: Update Completed',
    color: COLORS.green,
    description: 'The server has been updated and is back online.',
    fields: [
      { name: 'Previous', value: `${data.previousVersion ?? '-'}`, inline: true },
      { name: 'New', value: `${data.version ?? '-'}`, inline: true },
    ],
  }),
  'update.failed': (data) => ({ title: ':x: Update Failed', color: COLORS.red, description: `Update failed: ${data.error || 'unknown error'}` }),

  // Scheduled restart warnings (player-facing)
  restartWarning15: () => ({ title: ':alarm_clock: Restart Warning', color: COLORS.yellow, description: 'The server will restart in **15 minutes**.' }),
  restartWarning5: () => ({ title: ':alarm_clock: Restart Warning', color: COLORS.orange, description: 'The server will restart in **5 minutes**.' }),
  restartWarning1: () => ({ title: ':alarm_clock: Restart Warning', color: COLORS.red, description: 'The server will restart in **1 minute**!' }),
  'server.scheduledRestart': (data) => ({
    title: ':arrows_counterclockwise: Scheduled Restart',
    color: COLORS.blue,
    description: data.event || 'The server is restarting now.',
  }),

  // Update delay warnings (player-facing)
  updateWarning15: () => ({ title: ':arrow_up: Update Warning', color: COLORS.yellow, description: 'An update will be installed in **15 minutes**.' }),
  updateWarning5: () => ({ title: ':arrow_up: Update Warning', color: COLORS.orange, description: 'An update will be installed in **5 minutes**.' }),
  updateWarning1: () => ({ title: ':arrow_up: Update Warning', color: COLORS.red, description: 'An update will be installed in **1 minute**!' }),

  // Manual admin-command warnings (player-facing)
  manualRestartWarning: (data) => ({ title: ':alarm_clock: Restart Warning', color: COLORS.orange, description: `The server will restart in **${data.minutes} ${data.minutes === 1 ? 'minute' : 'minutes'}**${data.minutes === 1 ? '!' : '.'}` }),
  manualStopWarning: (data) => ({ title: ':octagonal_sign: Stop Warning', color: COLORS.orange, description: `The server will stop in **${data.minutes} ${data.minutes === 1 ? 'minute' : 'minutes'}**${data.minutes === 1 ? '!' : '.'}` }),
  manualUpdateWarning: (data) => ({ title: ':arrow_up: Update Warning', color: COLORS.orange, description: `An update will be installed in **${data.minutes} ${data.minutes === 1 ? 'minute' : 'minutes'}**${data.minutes === 1 ? '!' : '.'}` }),

  // Performance alerts (Pattern B)
  'performance.critical': (data) => ({ title: ':rotating_light: Performance Alert - Critical', color: COLORS.red, description: 'Server FPS has dropped to a critical level.', fields: performanceFields(data) }),
  'performance.poor': (data) => ({ title: ':warning: Performance Alert - Poor', color: COLORS.yellow, description: 'Server FPS is below the acceptable threshold.', fields: performanceFields(data) }),
  'performance.warning': (data) => ({ title: ':warning: Performance Warning', color: COLORS.yellow, description: `${data.metric || 'Performance'}: ${data.value ?? '-'} (threshold: ${data.threshold ?? '-'})`, fields: performanceFields(data) }),
  'performance.alert': (data) => ({ title: ':bell: Performance Alert', color: data.severity === 'critical' ? COLORS.red : COLORS.yellow, description: `${data.metric || 'Performance'}: ${data.value ?? '-'}`, fields: performanceFields(data) }),

  // Player events
  'player.joined': (data) => ({ title: ':inbox_tray: Player Joined', color: COLORS.green, description: `**${data.playerName}** has joined the server.`, fields: [{ name: 'Online players', value: `${data.playerCount ?? '-'}`, inline: true }] }),
  'player.left': (data) => ({ title: ':outbox_tray: Player Left', color: COLORS.grey, description: `**${data.playerName}** has left the server.`, fields: [{ name: 'Online players', value: `${data.playerCount ?? '-'}`, inline: true }] }),
};

/**
 * Build a Discord embed for an internal notification event ({type, data}).
 * Returns null if there is no template for the given type.
 */
function buildNotificationEmbed(type, data = {}) {
  const template = TEMPLATES[type];
  if (!template) return null;

  const { title, description, color, fields } = template(data);
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color || COLORS.blue)
    .setTimestamp(new Date());

  if (description) embed.setDescription(description);
  if (fields && fields.length) embed.addFields(fields);

  return applyBranding(embed);
}

/**
 * Build the ":warning: CONFIRMATION REQUIRED" embed for dangerous admin commands.
 * Mirrors the Pattern C confirmation embed in discord-admin-commands.psm1.
 */
function buildConfirmationEmbed(actionDescription, timeoutSeconds = 30) {
  return new EmbedBuilder()
    .setTitle(':warning: Confirmation Required')
    .setColor(COLORS.orange)
    .setDescription(`${actionDescription}\n\nReact with ✅ to confirm or ❌ to cancel.\nTimeout: ${timeoutSeconds} seconds.`)
    .setFooter(FOOTER)
    .setTimestamp(new Date());
}

module.exports = {
  COLORS,
  FOOTER,
  buildNotificationEmbed,
  buildConfirmationEmbed,
  performanceFields,
};
