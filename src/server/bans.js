'use strict';

// Player bans. SCUM bans are file-based: a Steam ID per line in BannedUsers.ini,
// applied by the server at startup — so a ban only takes effect after the next
// server restart. The file stores Steam IDs only, so we keep the player name and
// an optional admin note in our own DB to render a readable ban list.

const gameConfig = require('./gameConfig');
const database = require('../database');
const logger = require('../core/logger');

const STEAMID_RE = /^\d{17}$/;

function banFilePath() {
  const p = gameConfig.resolveListPath('banned-users');
  if (!p) throw new Error('BannedUsers.ini path is unavailable (server not configured yet)');
  return p;
}

function readBanIds() {
  try {
    const { lines } = gameConfig.readLines(banFilePath());
    return lines.map((l) => l.trim()).filter((l) => STEAMID_RE.test(l));
  } catch {
    return [];
  }
}

/** Banned players from the file (source of truth), enriched with DB name/note. */
function getBanList() {
  const ids = readBanIds();
  const meta = {};
  try { for (const m of database.listBannedPlayerMeta()) meta[m.steamId] = m; } catch { /* ignore */ }
  return ids.map((id) => ({
    steamId: id,
    playerName: (meta[id] && meta[id].playerName) || null,
    note: (meta[id] && meta[id].note) || null,
    bannedAt: (meta[id] && meta[id].bannedAt) || null,
    bannedBy: (meta[id] && meta[id].bannedBy) || null,
  }));
}

function banPlayer(steamId, { playerName, note, bannedBy } = {}) {
  const id = String(steamId || '').trim();
  if (!STEAMID_RE.test(id)) throw new Error('Invalid Steam ID (expected 17 digits)');

  const ids = readBanIds();
  if (!ids.includes(id)) {
    ids.push(id);
    gameConfig.writeLines(banFilePath(), ids);
  }
  try { database.addBannedPlayer(id, { playerName, note, bannedBy }); } catch (err) {
    logger.warn(`[Bans] Failed to store ban metadata for ${id}: ${err.message}`);
  }
  logger.info(`[Bans] Banned ${id}${playerName ? ` (${playerName})` : ''} — effective after next restart`);
  return getBanList();
}

function unbanPlayer(steamId) {
  const id = String(steamId || '').trim();
  const ids = readBanIds().filter((x) => x !== id);
  gameConfig.writeLines(banFilePath(), ids);
  try { database.removeBannedPlayer(id); } catch { /* ignore */ }
  logger.info(`[Bans] Unbanned ${id} — effective after next restart`);
  return getBanList();
}

module.exports = { getBanList, banPlayer, unbanPlayer };
