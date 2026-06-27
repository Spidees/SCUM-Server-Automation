'use strict';

// Authenticated player area: a Discord-linked user can see their OWN character
// stats and manage their DM notification preferences. Every route requires a
// linked Discord session (requirePlayer) and is scoped to that user's Steam ID —
// no access to anyone else's data.

const express = require('express');
const logger = require('../../core/logger');
const database = require('../../database');
const { itemImageUrl } = require('../../discord/items');
const { requirePlayer } = require('./discordAuth');

const router = express.Router();

router.use(requirePlayer);

// Attach the bank-card icon URL to each card (Classic/Gold/Starter → <type>_Bank_Card.png).
function withCardImages(finances) {
  if (!finances || !Array.isArray(finances.cards)) return finances;
  return {
    ...finances,
    cards: finances.cards.map((c) => ({ ...c, image: itemImageUrl(`${c.type}_Bank_Card.png`) })),
  };
}

router.get('/me', (req, res) => {
  const p = req.session.player;
  res.json({
    discordUsername: p.discordUsername,
    steamId: p.steamId,
    playerName: p.playerName,
    linked: p.linked,
  });
});

// One call for the whole "My Character" panel: identity + stats + notification
// prefs + leaderboard ranks. Stats are memoized (15s) and ranks come from the
// in-memory leaderboard snapshot, so this stays cheap on SCUM.db.
router.get('/me/overview', (req, res) => {
  const p = req.session.player;
  try {
    const dbAvailable = database.isScumDbAvailable();
    const stats = dbAvailable ? database.getPlayerStatsBySteamId(p.steamId) : null;
    const ranks = database.getPlayerRanks(stats ? stats.Name : p.playerName);
    return res.json({
      identity: {
        discordUsername: p.discordUsername,
        steamId: p.steamId,
        playerName: stats ? stats.Name : p.playerName,
      },
      available: dbAvailable,
      stats: stats || null,
      ranks,
      skills: dbAvailable ? database.getPlayerSkillsBySteamId(p.steamId) : [],
      finances: dbAvailable ? withCardImages(database.getPlayerFinancesBySteamId(p.steamId)) : null,
      squad: dbAvailable ? database.getSquadInfoBySteamId(p.steamId) : null,
      notifications: database.getNotifyPrefs(p.discordUserId),
    });
  } catch (err) {
    logger.error(`[API/player] /me/overview error: ${err.message}`);
    return res.status(500).json({ error: 'overview_unavailable' });
  }
});

// Another player's public profile — only reachable by a linked player (the whole
// router is requirePlayer). Stats + ranks + squad NAME/members, but no Steam ID,
// no last-logout time, and no per-member online/last-seen (raid-sensitive).
router.get('/profile/:name', (req, res) => {
  if (!database.isScumDbAvailable()) return res.json({ available: false });
  try {
    const stats = database.getPlayerStatsByName(req.params.name);
    if (!stats) return res.status(404).json({ error: 'not_found' });
    const ranks = database.getPlayerRanks(stats.Name);
    let squad = null;
    if (stats.SteamID) {
      const full = database.getSquadInfoBySteamId(stats.SteamID);
      if (full) {
        squad = {
          name: full.name,
          score: full.score,
          memberCount: full.memberCount,
          members: (full.members || []).map((m) => ({ name: m.name, rank: m.rank })),
        };
      }
    }
    // Skills (+ attributes) are only revealed to a squadmate of the viewed player.
    let skills = null;
    const viewer = req.session.player;
    if (stats.SteamID && viewer && viewer.steamId) {
      const vSquad = database.getSquadIdBySteamId(viewer.steamId);
      const tSquad = database.getSquadIdBySteamId(stats.SteamID);
      if (vSquad != null && vSquad === tSquad) skills = database.getPlayerSkillsBySteamId(stats.SteamID);
    }
    const safe = { ...stats };
    delete safe.SteamID;
    delete safe.LastLogout;
    return res.json({ available: true, name: stats.Name, stats: safe, ranks, squad, skills });
  } catch (err) {
    logger.error(`[API/player] /profile error: ${err.message}`);
    return res.status(500).json({ error: 'profile_unavailable' });
  }
});

// History of DM alerts sent to this player.
router.get('/me/notifications/history', (req, res) => {
  try {
    return res.json({ history: database.getNotificationHistory(req.session.player.discordUserId, 30) });
  } catch (err) {
    logger.error(`[API/player] /me/notifications/history error: ${err.message}`);
    return res.status(500).json({ error: 'history_unavailable' });
  }
});

// Unlink this player's SCUM character (same as the Discord /unlink-account command).
router.post('/me/unlink', (req, res) => {
  const p = req.session.player;
  try {
    database.unlinkAccount(p.discordUserId);
    p.linked = false;
    p.steamId = null;
    p.playerName = null;
    return req.session.save(() => res.json({ success: true }));
  } catch (err) {
    logger.error(`[API/player] /me/unlink error: ${err.message}`);
    return res.status(500).json({ error: 'unlink_failed' });
  }
});

router.get('/me/stats', (req, res) => {
  if (!database.isScumDbAvailable()) return res.json({ available: false, stats: null });
  try {
    const stats = database.getPlayerStatsBySteamId(req.session.player.steamId);
    return res.json({ available: true, stats: stats || null });
  } catch (err) {
    logger.error(`[API/player] /me/stats error: ${err.message}`);
    return res.status(500).json({ error: 'stats_unavailable' });
  }
});

router.get('/me/notifications', (req, res) => {
  try {
    return res.json(database.getNotifyPrefs(req.session.player.discordUserId));
  } catch (err) {
    logger.error(`[API/player] /me/notifications error: ${err.message}`);
    return res.status(500).json({ error: 'prefs_unavailable' });
  }
});

router.post('/me/notifications', (req, res) => {
  const b = req.body || {};
  try {
    database.setNotifyPrefs(req.session.player.discordUserId, {
      raid: !!b.raid,
      vehicle: !!b.vehicle,
      chest: !!b.chest,
      lock: !!b.lock,
      scope: b.scope === 'squad' ? 'squad' : 'own',
    });
    return res.json({ success: true, prefs: database.getNotifyPrefs(req.session.player.discordUserId) });
  } catch (err) {
    logger.error(`[API/player] POST /me/notifications error: ${err.message}`);
    return res.status(500).json({ error: 'prefs_save_failed' });
  }
});

module.exports = router;
