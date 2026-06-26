'use strict';

// "Login with Discord" (OAuth2) for the public/player area. This is entirely
// separate from the admin password login in routes/auth.js — it only identifies
// a Discord user and, if that user has linked their SCUM account via the bot,
// grants access to their OWN stats/notification prefs. It never grants admin.

const express = require('express');
const { randomBytes } = require('crypto');
const logger = require('../../core/logger');
const { env } = require('../../core/config');
const database = require('../../database');

const router = express.Router();

const AUTHORIZE_URL = 'https://discord.com/api/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/oauth2/token';
const USER_URL = 'https://discord.com/api/users/@me';

function isConfigured() {
  return !!(env.discordClientId && env.discordClientSecret && env.discordOAuthRedirect);
}

router.get('/discord', (req, res) => {
  if (!isConfigured()) return res.status(503).json({ error: 'discord_oauth_not_configured' });
  const state = randomBytes(16).toString('hex');
  req.session.oauthState = state;
  const params = new URLSearchParams({
    client_id: env.discordClientId,
    redirect_uri: env.discordOAuthRedirect,
    response_type: 'code',
    scope: 'identify',
    state,
  });
  // Persist the session (and set the cookie) BEFORE leaving for Discord, so the
  // state survives the round-trip and the player stays logged in on return.
  return req.session.save(() => res.redirect(`${AUTHORIZE_URL}?${params.toString()}`));
});

router.get('/discord/callback', async (req, res) => {
  if (!isConfigured()) return res.status(503).send('Discord login is not configured.');
  const { code, state } = req.query;
  if (!code || !state || state !== req.session.oauthState) {
    return res.status(400).send('Invalid OAuth state.');
  }
  delete req.session.oauthState;

  try {
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.discordClientId,
        client_secret: env.discordClientSecret,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: env.discordOAuthRedirect,
      }),
    });
    if (!tokenRes.ok) {
      logger.warn(`[OAuth] Discord token exchange failed: HTTP ${tokenRes.status}`);
      return res.status(502).send('Discord login failed.');
    }
    const token = await tokenRes.json();

    const userRes = await fetch(USER_URL, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!userRes.ok) {
      logger.warn(`[OAuth] Discord user fetch failed: HTTP ${userRes.status}`);
      return res.status(502).send('Discord login failed.');
    }
    const user = await userRes.json();

    const profile = database.getDiscordProfile(user.id);
    req.session.player = {
      discordUserId: user.id,
      discordUsername: user.username,
      steamId: profile ? profile.steam_id : null,
      playerName: profile ? profile.player_name : null,
      linked: !!profile,
    };
    logger.info(`[OAuth] Discord login: ${user.username} (linked=${!!profile})`);
    return req.session.save(() => res.redirect('/'));
  } catch (err) {
    logger.error(`[OAuth] callback error: ${err.message}`);
    return res.status(500).send('Discord login error.');
  }
});

router.get('/discord/session', (req, res) => {
  const p = req.session && req.session.player;
  res.json({ authenticated: !!p, player: p || null, configured: isConfigured() });
});

router.post('/discord/logout', (req, res) => {
  if (req.session) delete req.session.player;
  res.json({ success: true });
});

// Requires a Discord session that is also linked to a SCUM account.
function requirePlayer(req, res, next) {
  if (req.session && req.session.player && req.session.player.linked) return next();
  return res.status(401).json({ error: 'not_authenticated' });
}

module.exports = { router, requirePlayer, isConfigured };
