'use strict';

const { config } = require('../../core/config');

function getConfig() { return config; }
const { pollFeed } = require('./tailer');
const killFeed = require('./killFeed');

const FEEDS = [
  require('./loginFeed'),
  require('./adminFeed'),
  require('./chestFeed'),
  require('./economyFeed'),
  killFeed,
  require('./eventKillFeed'),
  require('./famePointsFeed'),
  require('./gameplayFeed'),
  require('./questFeed'),
  require('./raidProtectionFeed'),
  require('./vehicleFeed'),
  require('./violationsFeed'),
];

let intervalId = null;

function startLogFeeds(client) {
  const config = getConfig();
  if (!config.SCUMLogFeatures) return;

  const intervalMs = (config.SCUMLogFeatures.UpdateInterval || 10) * 1000;

  intervalId = setInterval(async () => {
    const cfg = getConfig();
    for (const feed of FEEDS) {
      try {
        if (feed.isEnabled(cfg)) {
          await pollFeed(feed, client, cfg);
        }
      } catch (err) {
        // individual feed errors must not stop the loop
      }
    }
    try {
      if (killFeed.isEnabled(cfg)) {
        await killFeed.processDelayQueue(client, cfg);
      }
    } catch {}
  }, intervalMs);
}

function stopLogFeeds() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

module.exports = { startLogFeeds, stopLogFeeds };
