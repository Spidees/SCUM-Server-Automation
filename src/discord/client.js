'use strict';

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const logger = require('../core/logger');
const { config, env } = require('../core/config');

let client = null;

/**
 * Create (if needed) and log in the discord.js client.
 * Mirrors Start-DiscordWebSocketBot from core/discord-websocket-bot-direct.psm1.
 */
async function getClient() {
  if (client) return client;

  if (!env.discordToken) {
    throw new Error('DISCORD_TOKEN is not set');
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  });

  client.on('error', (err) => logger.error(`[Discord] Client error: ${err.message}`));
  client.on('warn', (msg) => logger.warn(`[Discord] ${msg}`));

  await client.login(env.discordToken);

  await new Promise((resolve) => {
    if (client.isReady()) return resolve();
    client.once('ready', resolve);
  });

  logger.info(`[Discord] Logged in as ${client.user.tag}`);
  await setPresence({ isRunning: false });

  return client;
}

/**
 * Update the bot's presence/activity. Mirrors Update-BotActivity.
 */
async function setPresence({ isRunning, onlinePlayers, maxPlayers }) {
  if (!client || !client.isReady()) return;

  const presenceCfg = (config.Discord && config.Discord.Presence) || {};
  const status = presenceCfg.Status || 'online';

  let activityText = presenceCfg.Activity || 'SCUM Server Automation';
  if (presenceCfg.DynamicActivity) {
    if (!isRunning) {
      activityText = presenceCfg.OfflineActivity || 'OFFLINE';
    } else {
      const format = presenceCfg.OnlineActivityFormat || '{players} / {maxPlayers} players';
      activityText = format
        .replace('{players}', onlinePlayers ?? 0)
        .replace('{maxPlayers}', maxPlayers ?? 0);
    }
  }

  try {
    client.user.setPresence({
      status,
      activities: [{ name: activityText, type: 3 /* Watching */ }],
    });
  } catch (err) {
    logger.warn(`[Discord] Failed to set presence: ${err.message}`);
  }
}

async function destroyClient() {
  if (client) {
    await client.destroy();
    client = null;
  }
}

/** Returns the client only if it is already connected and ready. */
function peekClient() {
  return client && client.isReady() ? client : null;
}

module.exports = { getClient, setPresence, destroyClient, peekClient };
