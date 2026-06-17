'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');
const logger = require('../core/logger');
const events = require('../core/events');
const { config, env } = require('../core/config');
const { router: authRouter, requireAuth } = require('./routes/auth');
const setupRouter = require('./routes/setup');
const apiRouter = require('./routes/api');
const gameConfigRouter = require('./routes/gameConfig');

function startWebServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);

  app.use(express.json());
  app.use(session({
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 },
  }));

  app.use('/api/auth', authRouter);
  app.use('/api/setup', setupRouter);
  app.use('/api/game-config', requireAuth, gameConfigRouter);
  app.use('/api', requireAuth, apiRouter);

  app.use(express.static(path.join(__dirname, 'public')));

  io.on('connection', (socket) => {
    logger.debug('[Web] Dashboard client connected');
    socket.on('disconnect', () => logger.debug('[Web] Dashboard client disconnected'));
  });

  events.on('status', (status) => {
    io.emit('status:update', status);
  });

  events.on('logline', (line) => {
    io.emit('log:line', line);
  });

  events.on('notification', (notification) => {
    io.emit('notification', notification);
  });

  events.on('install:progress', (data) => {
    io.emit('install:progress', data);
  });

  const port = (config.web && config.web.port) || 8080;
  server.listen(port, () => {
    logger.info(`[Web] Dashboard listening on http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`[Web] Port ${port} is already in use. Change "web.port" in config.json or stop the other process.`);
    } else {
      logger.error(`[Web] Server error: ${err.message}`);
    }
  });

  return { app, server, io };
}

module.exports = { startWebServer };
