'use strict';

// Sends DM raid-alerts to linked players when something happens to property they
// own (or their squad's, if they opted into squad scope). Preferences are managed
// via the "⚙️ Notifications" button on the account-linking panel.

const { EmbedBuilder } = require('discord.js');
const logger = require('../core/logger');
const { config } = require('../core/config');
const database = require('../database');
const { applyBranding } = require('./branding');

// Map alert type -> config flag that restricts it to the owner's flag area.
const FLAG_FILTER_TYPE_KEY = { vehicle: 'Vehicles', chest: 'Chests', lock: 'Locks' };

/**
 * When the flag-area filter is enabled, drop alerts for property that is not
 * inside the owner's (or their squad's) territory flag area. Only the property
 * types listed in config are filtered; 'raid' alerts are always delivered.
 */
function passesFlagAreaFilter(alert) {
  const cfg = ((config.SCUMLogFeatures || {}).OwnerAlertFlagFilter) || {};
  if (!cfg.Enabled) return true;
  const key = FLAG_FILTER_TYPE_KEY[alert.type];
  if (!key || !cfg[key]) return true; // type not filtered

  const loc = alert.location || {};
  if (loc.x == null || loc.y == null) return true; // no location -> can't filter, allow
  if (alert.ownerSteamId == null) return true;

  const radiusMeters = Number(cfg.RadiusMeters);
  const radiusCm = (Number.isFinite(radiusMeters) && radiusMeters > 0 ? radiusMeters : 50) * 100;
  try {
    return database.isLocationInOwnerArea(alert.ownerSteamId, Number(loc.x), Number(loc.y), radiusCm);
  } catch (err) {
    logger.warn(`[RaidNotify] Flag-area filter failed, allowing alert: ${err.message}`);
    return true;
  }
}

function mapLink(loc) {
  if (!loc || loc.x == null || loc.y == null || loc.z == null) return null;
  return `https://scum-map.com/en/shared/scum/island/${Math.round(loc.x)},${Math.round(loc.y)},${Math.round(loc.z)}`;
}

// Throttle keys -> last-sent epoch ms, to avoid spamming (e.g. one base-attack
// DM per owner per few minutes even when many walls are destroyed at once).
const cooldowns = new Map();

/**
 * Dispatch a raid alert.
 * @param client discord.js client
 * @param alert { type:'raid'|'vehicle'|'chest'|'lock', ownerSteamId, ownerName, title,
 *                description, color, location:{x,y,z}, cooldownKey?, cooldownMs? }
 */
async function dispatchOwnerAlert(client, alert) {
  if (!client || !alert || !alert.type) return;

  if (!passesFlagAreaFilter(alert)) return;

  if (alert.cooldownKey && alert.cooldownMs) {
    const last = cooldowns.get(alert.cooldownKey) || 0;
    if (Date.now() - last < alert.cooldownMs) return;
    cooldowns.set(alert.cooldownKey, Date.now());
  }

  let recipients = [];
  try {
    recipients = database.getNotifyRecipients(alert.type) || [];
  } catch (err) {
    logger.warn(`[RaidNotify] Failed to read recipients: ${err.message}`);
    return;
  }
  if (!recipients.length) return;

  const ownerSteam = alert.ownerSteamId != null ? String(alert.ownerSteamId) : null;
  const ownerName = alert.ownerName ? alert.ownerName.toLowerCase() : null;

  // Lazily resolve the owner's squad — only needed if a squad-scope recipient exists.
  let squadMembers = null;
  const squadMemberSteamIds = () => {
    if (squadMembers !== null) return squadMembers;
    let squadId = null;
    try { if (ownerSteam) squadId = database.getSquadIdBySteamId(ownerSteam); } catch { /* ignore */ }
    try { squadMembers = squadId != null ? database.getSquadMemberSteamIds(squadId).map(String) : []; } catch { squadMembers = []; }
    return squadMembers;
  };

  const isOwner = (r) =>
    (ownerSteam && String(r.steamId) === ownerSteam)
    || (ownerName && r.playerName && r.playerName.toLowerCase() === ownerName);

  const targets = recipients.filter((r) => {
    if (isOwner(r)) return true;
    if (r.scope === 'squad' && ownerSteam) return squadMemberSteamIds().includes(String(r.steamId));
    return false;
  });
  if (!targets.length) return;

  const embed = applyBranding(new EmbedBuilder()
    .setTitle(alert.title || ':rotating_light: Raid Alert')
    .setColor(alert.color || 0xed4245)
    .setDescription(alert.description || '')
    .setTimestamp(new Date()));

  const url = mapLink(alert.location);
  if (url) embed.addFields({ name: 'Location', value: `[🗺️ View on map](${url})`, inline: false });

  for (const t of targets) {
    try {
      const user = await client.users.fetch(t.discordUserId);
      await user.send({ embeds: [embed] });
    } catch (err) {
      logger.warn(`[RaidNotify] Failed to DM ${t.discordUserId}: ${err.message}`);
    }
  }
}

module.exports = { dispatchOwnerAlert };
