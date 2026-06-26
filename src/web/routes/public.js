'use strict';

// Public, unauthenticated read-only API for anonymous visitors. Mounted at
// /api/public BEFORE the admin (requireAuth) router. Everything here must be
// safe to expose to the internet: no SteamIDs, no PIDs/paths, no control actions.
// Leaderboards are served from the in-memory snapshot so SCUM.db is never queried
// per request.

const fs = require('fs');
const path = require('path');
const express = require('express');
const logger = require('../../core/logger');
const database = require('../../database');
const monitoring = require('../../server/monitoring');
const bunkerState = require('../../discord/bunkerState');
const recentKills = require('../../discord/recentKills');
const economyState = require('../../discord/economyState');
const { config, paths } = require('../../core/config');
const common = require('../../core/common');

// Server name from ServerSettings.ini (scum.ServerName), cached briefly.
let serverNameCache = { ts: 0, val: null };
function getServerName() {
  if (Date.now() - serverNameCache.ts < 60000) return serverNameCache.val;
  let name = null;
  try {
    const file = path.join(paths.savedDir, 'Config', 'WindowsServer', 'ServerSettings.ini');
    const buf = fs.readFileSync(file);
    const isUtf16 = buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE;
    const text = buf.toString(isUtf16 ? 'utf16le' : 'utf8');
    const m = /scum\.ServerName\s*=\s*(.+)/i.exec(text);
    if (m) name = m[1].trim();
  } catch { name = null; }
  serverNameCache = { ts: Date.now(), val: name };
  return name;
}

// Public connect address: SCUM clients connect on the game port + 2.
function getServerAddress() {
  if (!config.publicIP) return null;
  const gamePort = parseInt((config.serverArgs && config.serverArgs.port) || config.publicPort, 10);
  const connectPort = Number.isFinite(gamePort) ? gamePort + 2 : null;
  return `${config.publicIP}:${connectPort != null ? connectPort : '-'}`;
}

const router = express.Router();

const MAX_LIMIT = 100;

function clampLimit(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return 10;
  return Math.min(Math.max(n, 1), MAX_LIMIT);
}

function isWeekly(req) {
  return req.query.weekly === '1' || req.query.weekly === 'true';
}

function sliceLeaderboards(board, limit) {
  const out = {};
  for (const [key, entry] of Object.entries(board || {})) {
    out[key] = { label: entry.label, data: (entry.data || []).slice(0, limit) };
  }
  return out;
}

// Consolidated server overview, cached so a burst of anonymous visitors triggers
// at most one rebuild per TTL regardless of traffic. Combines status + counts +
// time + weather into a single response so the page makes one request, not six.
const OVERVIEW_TTL_MS = 15000;
let overviewCache = { ts: 0, data: null };

async function buildOverview() {
  let status = null;
  try {
    const s = await monitoring.getServerStatus();
    status = {
      online: !!s.IsOnline,
      players: s.OnlinePlayers != null ? s.OnlinePlayers : 0,
      maxPlayers: s.MaxPlayers || null,
      lastUpdate: s.LastUpdate || null,
      fps: (s.Performance && s.Performance.FPS != null) ? s.Performance.FPS : null,
      state: s.ActualServerState || s.Status || null,
    };
  } catch { status = { online: false, players: 0, maxPlayers: null, lastUpdate: null, fps: null, state: null }; }

  const server = { name: getServerName(), address: getServerAddress() };

  let nextRestart = null;
  try {
    const d = common.getNextScheduledRestart(config.restartTimes || []);
    nextRestart = d ? d.toISOString() : null;
  } catch { nextRestart = null; }

  if (!database.isScumDbAvailable()) {
    return { available: false, status, server, world: null, counts: null, nextRestart, topSquads: [] };
  }

  let topSquads = [];
  try {
    const entry = (database.getSnapshot().allTime || {}).squad_score;
    topSquads = ((entry && entry.data) || []).slice(0, 5).map((r) => ({ name: r.Name, value: r.FormattedValue != null ? r.FormattedValue : r.Value }));
  } catch { topSquads = []; }

  const stats = database.getServerStatistics();
  return {
    available: true,
    status,
    server,
    counts: {
      players: stats.TotalPlayers,
      online: stats.OnlinePlayers,
      squads: database.getActiveSquadCount(),
      vehicles: database.getVehicleCount(),
      bases: database.getBaseCount(),
    },
    world: {
      time: (database.getGameTimeData() || {}).FormattedTime || null,
      temperature: (database.getWeatherData() || {}).FormattedTemperature || null,
    },
    nextRestart,
    topSquads,
  };
}

router.get('/overview', async (req, res) => {
  try {
    if (!overviewCache.data || Date.now() - overviewCache.ts > OVERVIEW_TTL_MS) {
      overviewCache = { ts: Date.now(), data: await buildOverview() };
    }
    return res.json(overviewCache.data);
  } catch (err) {
    logger.error(`[API/public] /overview error: ${err.message}`);
    return res.status(500).json({ error: 'overview_unavailable' });
  }
});

// Slim, non-sensitive status. Omits ProcessId/ProcessName/ServiceStatus and the
// performance internals that the admin /status exposes.
router.get('/status', async (req, res) => {
  try {
    const s = await monitoring.getServerStatus();
    res.json({
      Status: s.Status,
      IsOnline: s.IsOnline,
      OnlinePlayers: s.OnlinePlayers,
      MaxPlayers: s.MaxPlayers,
      LastUpdate: s.LastUpdate,
    });
  } catch (err) {
    logger.error(`[API/public] /status error: ${err.message}`);
    res.status(500).json({ error: 'status_unavailable' });
  }
});

router.get('/game-stats', (req, res) => {
  if (!database.isScumDbAvailable()) return res.json({ available: false });
  try {
    const stats = database.getServerStatistics();
    return res.json({
      available: true,
      // Re-shaped to drop DatabaseSize / file paths that the admin view carries.
      statistics: {
        TotalPlayers: stats.TotalPlayers,
        OnlinePlayers: stats.OnlinePlayers,
        TotalVehicles: stats.TotalVehicles,
      },
      gameTime: database.getGameTimeData(),
      weather: database.getWeatherData(),
      activeSquads: database.getActiveSquadCount(),
      vehicles: database.getVehicleCount(),
      bases: database.getBaseCount(),
    });
  } catch (err) {
    logger.error(`[API/public] /game-stats error: ${err.message}`);
    return res.status(500).json({ error: 'stats_unavailable' });
  }
});

// Online players — names only. SteamIDs from getOnlinePlayers() are stripped.
router.get('/players', (req, res) => {
  if (!database.isScumDbAvailable()) return res.json({ available: false, players: [] });
  try {
    const players = (database.getOnlinePlayers() || []).map((p) => ({ name: p.PlayerName }));
    return res.json({ available: true, players });
  } catch (err) {
    logger.error(`[API/public] /players error: ${err.message}`);
    return res.status(500).json({ error: 'players_unavailable' });
  }
});

router.get('/leaderboards', (req, res) => {
  const limit = clampLimit(req.query.limit);
  const snap = database.getSnapshot();
  res.json({
    available: snap.available,
    generatedAt: snap.generatedAt,
    categories: snap.categories,
    leaderboards: sliceLeaderboards(isWeekly(req) ? snap.weekly : snap.allTime, limit),
  });
});

router.get('/leaderboards/:category', (req, res) => {
  const limit = clampLimit(req.query.limit);
  const snap = database.getSnapshot();
  const board = (isWeekly(req) ? snap.weekly : snap.allTime) || {};
  const entry = board[req.params.category];
  if (!entry) return res.json({ available: snap.available, data: [] });
  return res.json({ available: snap.available, generatedAt: snap.generatedAt, data: (entry.data || []).slice(0, limit) });
});

// Abandoned bunker state (sector + active/locked + activation/eta timestamps).
// Sourced from the in-memory bunker tracker — no DB, no raw coordinates exposed.
router.get('/bunkers', (req, res) => {
  try {
    bunkerState.seedFromLog();
    const bunkers = (bunkerState.getBunkers() || []).map((b) => ({
      sector: b.sector,
      state: b.state || 'unknown',
      activeSince: b.activationUnix || null,
      nextActivation: b.etaUnix || null,
    }));
    return res.json({ bunkers });
  } catch (err) {
    logger.error(`[API/public] /bunkers error: ${err.message}`);
    return res.status(500).json({ error: 'bunkers_unavailable' });
  }
});

// Economy snapshot: special deals, gold capacity and rotation/restock timing.
// All underlying queries are memoized (~30s), so this stays cheap on SCUM.db.
router.get('/economy', (req, res) => {
  if (!database.isScumDbAvailable()) return res.json({ available: false });
  try {
    let traders = [];
    try {
      economyState.seedFromLog();
      traders = (economyState.getTraderFunds() || []).map((t) => ({ location: t.location, type: t.type, funds: t.funds }));
    } catch { traders = []; }
    return res.json({
      available: true,
      deals: database.getSpecialDeals(12),
      traders,
      gold: database.getGoldCapacity(),
      timing: database.getEconomyTiming(),
    });
  } catch (err) {
    logger.error(`[API/public] /economy error: ${err.message}`);
    return res.status(500).json({ error: 'economy_unavailable' });
  }
});

// Live kill feed from the in-memory ring buffer (requires the kill feed feature
// to be polling). Names + weapon + distance only — never coordinates.
router.get('/killfeed', (req, res) => {
  const limit = clampLimit(req.query.limit);
  return res.json({ kills: recentKills.getRecent(limit) });
});

// Squad list (name, score, member count) — no per-member data.
router.get('/squads', (req, res) => {
  if (!database.isScumDbAvailable()) return res.json({ available: false, squads: [] });
  try {
    return res.json({ available: true, squads: database.getSquadList(60) });
  } catch (err) {
    logger.error(`[API/public] /squads error: ${err.message}`);
    return res.status(500).json({ error: 'squads_unavailable' });
  }
});

// Squad detail: members are name + rank only (no online status / last-seen).
router.get('/squads/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'invalid_id' });
  if (!database.isScumDbAvailable()) return res.json({ available: false });
  try {
    const squad = database.getSquadDetailById(id);
    if (!squad) return res.status(404).json({ error: 'not_found' });
    return res.json({ available: true, squad });
  } catch (err) {
    logger.error(`[API/public] /squads/:id error: ${err.message}`);
    return res.status(500).json({ error: 'squad_unavailable' });
  }
});

module.exports = router;
