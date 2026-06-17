'use strict';

const logger = require('../core/logger');
const { env } = require('../core/config');
const { getClient, destroyClient, setPresence } = require('./client');
const { registerNotifications } = require('./notifications');
const { startLiveEmbeds, stopLiveEmbeds } = require('./liveEmbeds');
const { startChatRelay, stopChatRelay } = require('./chatRelay');
const { startLogFeeds, stopLogFeeds } = require('./logFeeds/index');
const {
  registerSlashCommands,
  registerInteractionHandler,
  startConnectCodePoller,
  stopConnectCodePoller,
} = require('./slashCommands');
const events = require('../core/events');

let presenceHandler = null;

/**
 * Initialize the Discord bot: login, notifications, live embeds, chat relay,
 * and text commands. Mirrors discord-integration.psm1's
 * Initialize-DiscordIntegration.
 */
async function startDiscordBot() {
  if (!env.discordToken) {
    logger.info('[Discord] DISCORD_TOKEN not set - Discord bot disabled');
    return null;
  }

  try {
    const client = await getClient();

    registerNotifications(client);
    registerInteractionHandler(client);
    startLiveEmbeds(client);
    startChatRelay(client);
    startLogFeeds(client);
    startConnectCodePoller(client);
    await registerSlashCommands(client);

    presenceHandler = (status) => {
      setPresence({
        isRunning: status.IsRunning,
        onlinePlayers: status.OnlinePlayers,
        maxPlayers: status.MaxPlayers,
      }).catch(() => {});
    };
    events.on('status', presenceHandler);

    logger.info('[Discord] Discord bot initialized successfully');
    return client;
  } catch (err) {
    logger.error(`[Discord] Failed to initialize Discord bot: ${err.message}`);
    return null;
  }
}

async function stopDiscordBot() {
  stopConnectCodePoller();
  stopLiveEmbeds();
  stopChatRelay();
  stopLogFeeds();
  if (presenceHandler) {
    events.removeListener('status', presenceHandler);
    presenceHandler = null;
  }
  // Give the manager.stopped notification a moment to be delivered before disconnecting.
  await new Promise((r) => setTimeout(r, 1000));
  await destroyClient();
}

module.exports = { startDiscordBot, stopDiscordBot };
