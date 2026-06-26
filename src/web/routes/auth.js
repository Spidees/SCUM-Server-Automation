'use strict';

const express = require('express');
const logger = require('../../core/logger');
const { env } = require('../../core/config');

const router = express.Router();

// In-memory brute-force guard for the admin login. Since the admin panel can be
// exposed to the internet, lock out a client IP after too many failed attempts.
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;
const attempts = new Map(); // ip -> { count, lockUntil }

function pruneAttempts(now) {
  for (const [ip, rec] of attempts) {
    if (!rec.lockUntil || rec.lockUntil < now) {
      if (!rec.lockUntil && rec.count === 0) attempts.delete(ip);
    }
  }
}

router.post('/login', (req, res) => {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const rec = attempts.get(ip);

  if (rec && rec.lockUntil && now < rec.lockUntil) {
    const mins = Math.ceil((rec.lockUntil - now) / 60000);
    return res.status(429).json({ success: false, error: `Too many attempts. Try again in ${mins} min.` });
  }

  const { password } = req.body || {};
  if (password && password === env.webAdminPassword) {
    attempts.delete(ip);
    req.session.authenticated = true;
    return res.json({ success: true });
  }

  const count = (rec ? rec.count : 0) + 1;
  const lockUntil = count >= MAX_ATTEMPTS ? now + LOCK_MS : 0;
  attempts.set(ip, { count, lockUntil });
  if (lockUntil) {
    logger.warn(`[Web] Admin login locked for IP ${ip} after ${count} failed attempts`);
    if (attempts.size > 1000) pruneAttempts(now);
    return res.status(429).json({ success: false, error: 'Too many attempts. Locked for 15 minutes.' });
  }
  return res.status(401).json({ success: false, error: 'Invalid password' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

router.get('/session', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

module.exports = { router, requireAuth };
