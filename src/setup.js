'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const ROOT_PATH = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT_PATH, '.env');
const CONFIG_FILE = path.join(ROOT_PATH, 'config', 'config.json');

function isSetupNeeded() {
  if (!fs.existsSync(ENV_FILE)) return true;
  try {
    const env = fs.readFileSync(ENV_FILE, 'utf8');
    if (env.includes('WEB_ADMIN_PASSWORD=changeme') || env.includes('SESSION_SECRET=changeme')) return true;
  } catch { return true; }
  return false;
}

function saveSetup({ serverDir, backupRoot, publicIP, serviceName, serverPort, queryPort, maxPlayers, noBattleye, customArgs, webPort, webPassword, discordToken, guildId }) {
  // Preserve the existing SESSION_SECRET so the already-running server's sessions stay valid
  let sessionSecret = null;
  try {
    const existing = fs.readFileSync(ENV_FILE, 'utf8');
    const m = existing.match(/^SESSION_SECRET=(.+)$/m);
    if (m && m[1].trim() && m[1].trim() !== 'changeme') sessionSecret = m[1].trim();
  } catch {}
  if (!sessionSecret) sessionSecret = crypto.randomBytes(32).toString('hex');

  fs.writeFileSync(ENV_FILE, [
    `DISCORD_TOKEN=${discordToken || ''}`,
    `WEB_ADMIN_PASSWORD=${webPassword}`,
    `SESSION_SECRET=${sessionSecret}`,
    '',
  ].join(os.EOL), 'utf8');

  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch {}

  cfg.serverDir = serverDir;
  cfg.savedDir = path.join(serverDir, 'SCUM', 'Saved');
  // Windows service name (no spaces — used as the NSSM service key). Default to existing or SCUMSERVER.
  const cleanService = (serviceName || '').trim().replace(/\s+/g, '');
  cfg.serviceName = cleanService || cfg.serviceName || 'SCUMSERVER';
  cfg.backupRoot = backupRoot || path.join(path.dirname(serverDir), 'Backups');
  if (publicIP) cfg.publicIP = publicIP;
  cfg.serverArgs = {
    port: parseInt(serverPort, 10) || 7042,
    queryPort: parseInt(queryPort, 10) || 7043,
    maxPlayers: parseInt(maxPlayers, 10) || 64,
    noBattleye: noBattleye === true || noBattleye === 'true',
    customArgs: (customArgs || '').trim(),
  };
  if (!cfg.web) cfg.web = {};
  cfg.web.port = parseInt(webPort, 10) || 8080;
  if (!cfg.Discord) cfg.Discord = {};
  if (guildId) cfg.Discord.GuildId = guildId;

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

module.exports = { isSetupNeeded, saveSetup };
