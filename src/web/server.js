'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const logger = require('../core/logger');
const events = require('../core/events');
const { config, env, resolveConfigPath } = require('../core/config');
const { router: authRouter, requireAuth } = require('./routes/auth');
const { router: discordAuthRouter } = require('./routes/discordAuth');
const setupRouter = require('./routes/setup');
const apiRouter = require('./routes/api');
const publicRouter = require('./routes/public');
const playerRouter = require('./routes/player');
const gameConfigRouter = require('./routes/gameConfig');
const database = require('../database');

// --- IP allowlist (defense-in-depth for the admin listener) -----------------
// Binding the admin server to a private interface (config.web.bindAddress) is the
// primary control. An optional allowlist rejects anything else that still reaches
// the port. Supports exact IPv4/IPv6 and IPv4 CIDR; loopback is always allowed.

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = ((n << 8) | o) >>> 0;
  }
  return n;
}

function makeAllowlist(entries) {
  const exact = new Set();
  const cidrs = [];
  for (const raw of entries) {
    const e = String(raw).trim();
    if (!e) continue;
    if (e.includes('/')) {
      const [base, bitsStr] = e.split('/');
      const baseInt = ipv4ToInt(base);
      const bits = Number(bitsStr);
      if (baseInt != null && Number.isInteger(bits) && bits >= 0 && bits <= 32) {
        const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
        cidrs.push({ net: (baseInt & mask) >>> 0, mask });
      }
    } else {
      exact.add(e);
    }
  }
  return (rawIp) => {
    if (!rawIp) return false;
    let norm = rawIp;
    if (norm.startsWith('::ffff:')) norm = norm.slice(7);
    if (norm === '127.0.0.1' || norm === '::1') return true; // loopback always allowed
    if (exact.has(norm) || exact.has(rawIp)) return true;
    const asInt = ipv4ToInt(norm);
    if (asInt == null) return false;
    return cidrs.some((c) => ((asInt & c.mask) >>> 0) === c.net);
  };
}

/**
 * Simple per-IP fixed-window rate limiter (no dependency). Protects the public /
 * player API from being hammered to amplify SCUM.db lookups (e.g. /squads/:id,
 * /profile/:name with many distinct keys).
 */
function makeRateLimiter({ windowMs = 60000, max = 240 } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    let rec = hits.get(ip);
    if (!rec || now > rec.reset) { rec = { count: 0, reset: now + windowMs }; hits.set(ip, rec); }
    rec.count += 1;
    if (rec.count > max) {
      res.set('Retry-After', String(Math.ceil((rec.reset - now) / 1000)));
      return res.status(429).json({ error: 'rate_limited' });
    }
    if (hits.size > 5000) { for (const [k, v] of hits) if (now > v.reset) hits.delete(k); }
    return next();
  };
}

function makeSessionMiddleware() {
  return session({
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
      // Set web.cookieSecure: true once you serve over HTTPS (direct or behind a
      // TLS-terminating reverse proxy with web.trustProxy: true).
      secure: !!(config.web && config.web.cookieSecure),
    },
  });
}

/**
 * Create the HTTP(S) server for the app. Serves HTTPS directly when
 * web.ssl.enabled with a key/cert; otherwise plain HTTP (use a reverse proxy for
 * TLS in that case).
 */
function createHttpServer(app) {
  const ssl = (config.web && config.web.ssl) || {};
  if (ssl.enabled && ssl.keyFile && ssl.certFile) {
    try {
      const key = fs.readFileSync(resolveConfigPath(ssl.keyFile));
      const cert = fs.readFileSync(resolveConfigPath(ssl.certFile));
      logger.info('[Web] HTTPS enabled (serving TLS directly)');
      return https.createServer({ key, cert }, app);
    } catch (err) {
      logger.error(`[Web] SSL configured but cert/key failed to load — falling back to HTTP: ${err.message}`);
    }
  }
  return http.createServer(app);
}

function listen(server, port, host, label) {
  const scheme = server instanceof https.Server ? 'https' : 'http';
  server.listen(port, host, () => {
    logger.info(`[Web] ${label} listening on ${scheme}://${host}:${port}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`[Web] Port ${port} is already in use (${label}). Change the port in config.json or stop the other process.`);
    } else {
      logger.error(`[Web] ${label} server error: ${err.message}`);
    }
  });
}

/**
 * The admin listener: full dashboard, control API and admin realtime stream.
 * Intended to be bound to a private interface (LAN/VPN/localhost) when the public
 * listener is exposed to the internet.
 */
function buildAdminServer() {
  const app = express();
  const server = createHttpServer(app);
  const io = new Server(server);
  const sessionMiddleware = makeSessionMiddleware();

  // Behind a reverse proxy (HTTPS termination), trust it so req.ip is the real
  // client — needed for the admin-login rate limiter and the IP allowlist.
  if (config.web && config.web.trustProxy) app.set('trust proxy', config.web.trustProxy);

  app.use(express.json());

  const allowEntries = (config.web && config.web.adminAllowlist) || [];
  const allow = allowEntries.length ? makeAllowlist(allowEntries) : null;
  if (allow) {
    app.use((req, res, next) => {
      if (allow(req.ip)) return next();
      logger.warn(`[Web] Admin request from non-allowlisted IP ${req.ip} blocked`);
      return res.status(403).json({ error: 'forbidden' });
    });
  }

  app.use(sessionMiddleware);
  // Share the HTTP session with Socket.IO so realtime streams can tell an
  // authenticated admin apart from an anonymous visitor. Without this, every
  // connected socket received logs/status/notifications regardless of auth.
  io.engine.use(sessionMiddleware);

  // Per-IP rate limits on the internet-facing surfaces.
  const apiLimiter = makeRateLimiter({ windowMs: 60000, max: 240 });
  const oauthLimiter = makeRateLimiter({ windowMs: 60000, max: 30 });

  app.use('/api/auth', authRouter);
  // Discord OAuth (player login) + player area also work on the single-listener
  // setup. /api/auth/discord/* falls through authRouter to discordAuthRouter.
  app.use('/api/auth/discord', oauthLimiter);
  app.use('/api/auth', discordAuthRouter);
  app.use('/api/setup', setupRouter);
  app.use('/api/public', apiLimiter, publicRouter);
  app.use('/api/player', apiLimiter, playerRouter);
  app.use('/api/game-config', requireAuth, gameConfigRouter);
  app.use('/api', requireAuth, apiRouter);

  // Community/player site at the root; the full admin dashboard under /admin.
  // During first-run (server not configured) the root redirects to the admin
  // setup wizard, since the public site has nothing to show pre-setup.
  app.get('/', (req, res, next) => {
    try {
      const { isSetupNeeded } = require('../setup');
      if (isSetupNeeded()) return res.redirect('/admin/');
    } catch { /* fall through to public site */ }
    return next();
  });
  // Force a trailing slash on /admin so the dashboard's relative asset paths
  // resolve under /admin/. Guard on originalUrl: Express's non-strict routing
  // also matches '/admin/' here, and redirecting that would loop forever.
  app.use('/admin', (req, res, next) => {
    if (req.originalUrl.split('?')[0] === '/admin') return res.redirect(301, '/admin/');
    return next();
  }, express.static(path.join(__dirname, 'public')));
  app.use(express.static(path.join(__dirname, 'public-site')));

  // The 'admin' room holds authenticated dashboard sessions. Sensitive realtime
  // data (logs, full status, notifications, install progress) is emitted only to
  // this room — never broadcast to every socket.
  io.on('connection', (socket) => {
    if (allow && !allow(socket.handshake.address)) {
      socket.disconnect(true);
      return;
    }
    const sess = socket.request.session;
    const isAdmin = !!(sess && sess.authenticated);
    if (isAdmin) socket.join('admin');
    logger.debug(`[Web] Dashboard client connected (admin=${isAdmin})`);
    socket.on('disconnect', () => logger.debug('[Web] Dashboard client disconnected'));
  });

  const adminEmit = (event, payload) => io.to('admin').emit(event, payload);
  events.on('status', (status) => adminEmit('status:update', status));
  events.on('logline', (line) => adminEmit('log:line', line));
  events.on('notification', (notification) => adminEmit('notification', notification));
  events.on('install:progress', (data) => adminEmit('install:progress', data));

  return { app, server, io };
}

/**
 * When serving HTTPS directly, optionally run a tiny HTTP listener that 301s
 * every request to the HTTPS URL. Only used when web.ssl.enabled and
 * web.httpRedirectPort is set (e.g. 80). Behind a reverse proxy, let the proxy
 * do the redirect instead.
 */
function startHttpRedirect(webCfg, bindAddress) {
  const ssl = webCfg.ssl || {};
  const redirectPort = webCfg.httpRedirectPort;
  if (!ssl.enabled || !redirectPort) return;

  const httpsPort = webCfg.port || 8080;
  const suffix = Number(httpsPort) === 443 ? '' : `:${httpsPort}`;
  const srv = http.createServer((req, res) => {
    const host = (req.headers.host || '').split(':')[0] || 'localhost';
    res.writeHead(301, { Location: `https://${host}${suffix}${req.url}` });
    res.end();
  });
  srv.on('error', (err) => logger.error(`[Web] HTTP→HTTPS redirect on port ${redirectPort} failed: ${err.message}`));
  srv.listen(redirectPort, bindAddress, () => logger.info(`[Web] HTTP→HTTPS redirect listening on http://${bindAddress}:${redirectPort}`));
}

function startWebServer() {
  // Keep a warm, in-memory leaderboard snapshot so the public site can serve it
  // without hitting SCUM.db per request.
  database.startSnapshotRefresh();

  const webCfg = config.web || {};
  const port = webCfg.port || 8080;
  // Default 0.0.0.0 listens on every interface. Set this to a LAN IP / 127.0.0.1
  // (behind a VPN or reverse proxy) if you don't want the panel on the open net.
  const bindAddress = webCfg.bindAddress || '0.0.0.0';

  // One listener serves everything: the public community site + Discord-player
  // area at /, and the full admin dashboard at /admin.
  const server = buildAdminServer();
  listen(server.server, port, bindAddress, 'Web');
  startHttpRedirect(webCfg, bindAddress);

  return server;
}

module.exports = { startWebServer };
