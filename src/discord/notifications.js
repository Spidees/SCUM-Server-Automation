'use strict';

const logger = require('../core/logger');
const events = require('../core/events');
const { config } = require('../core/config');
const { buildNotificationEmbed } = require('./embeds');
const { applyBranding } = require('./branding');

const STATUS_CHANGE_TYPES = new Set([
  'server.online',
  'server.offline',
  'server.starting',
  'server.shutting_down',
  'server.loading',
]);

function roleMentions(roleIds) {
  return (roleIds || [])
    .filter((id) => id && id.trim())
    .map((id) => `<@&${id}>`)
    .join(' ');
}

/**
 * Send a notification embed to a channel, with role mentions for the given roles.
 */
async function sendToChannel(client, channelId, roleIds, embed) {
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return;
    const content = roleMentions(roleIds);
    await channel.send({ content: content || undefined, embeds: [applyBranding(embed)] });
  } catch (err) {
    logger.warn(`[Discord] Failed to send notification to channel ${channelId}: ${err.message}`);
  }
}

/**
 * Subscribe to the internal event bus and route notifications to the
 * configured admin/player Discord channels. Mirrors
 * notifications/notification-manager.psm1.
 */
function registerNotifications(client) {
  const discordCfg = config.Discord || {};
  const notifCfg = discordCfg.Notifications || {};
  const types = notifCfg.NotificationTypes || {};
  const adminTypes = new Set(types.AdminOnly || []);
  const playerTypes = new Set(types.Player || []);
  const channels = notifCfg.Channels || {};
  const roles = notifCfg.Roles || {};

  events.on('notification', async ({ type, data }) => {
    try {
      if (notifCfg.SuppressStatusChanges && STATUS_CHANGE_TYPES.has(type)) return;

      const embed = buildNotificationEmbed(type, data || {});
      if (!embed) return;

      if (adminTypes.has(type)) {
        await sendToChannel(client, channels.Admin, roles.Admin, embed);
      }
      if (playerTypes.has(type)) {
        await sendToChannel(client, channels.Players, roles.Players, embed);
      }
    } catch (err) {
      logger.error(`[Discord] Notification handling failed for type ${type}: ${err.message}`);
    }
  });

  logger.info('[Discord] Notification routing registered');
}

module.exports = { registerNotifications, sendToChannel };
