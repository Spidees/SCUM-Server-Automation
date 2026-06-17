'use strict';

const express = require('express');
const { env } = require('../../core/config');

const router = express.Router();

router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (password && password === env.webAdminPassword) {
    req.session.authenticated = true;
    return res.json({ success: true });
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
