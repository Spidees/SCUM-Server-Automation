'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const ROOT_PATH = path.resolve(__dirname, '..', '..');
const CONFIG_FILE = path.join(ROOT_PATH, 'config', 'config.json');

function resolveConfigPath(p, basePath = ROOT_PATH) {
  if (!p) return null;
  if (p.startsWith('./')) return path.join(basePath, p.slice(2));
  if (p.startsWith('../')) {
    let current = basePath;
    let rest = p;
    while (rest.startsWith('../')) {
      current = path.dirname(current);
      rest = rest.slice(3);
    }
    return rest ? path.join(current, rest) : current;
  }
  if (!path.isAbsolute(p)) return path.join(basePath, p);
  return p;
}

function computePaths(cfg) {
  const p = {
    root: ROOT_PATH,
    savedDir: resolveConfigPath(cfg.savedDir),
    backupRoot: resolveConfigPath(cfg.backupRoot),
    steamCmd: resolveConfigPath(cfg.steamCmd),
    serverDir: resolveConfigPath(cfg.serverDir),
    nssm: resolveConfigPath(cfg.nssmPath),
  };
  if (p.savedDir) {
    p.logPath = path.join(p.savedDir, 'Logs', 'SCUM.log');
    p.serverSavedPath = p.savedDir;
  }
  if (p.backupRoot) p.backupDirectory = p.backupRoot;
  p.appLogFile = path.join(ROOT_PATH, 'data', 'SCUM-Server-Automation.log');
  return p;
}

const _initialConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const config = Object.assign({}, _initialConfig);
const paths = computePaths(config);

const env = {
  discordToken: process.env.DISCORD_TOKEN || '',
  webAdminPassword: process.env.WEB_ADMIN_PASSWORD || 'changeme',
  sessionSecret: process.env.SESSION_SECRET || 'changeme',
  // Discord OAuth2 for the public "Login with Discord" (player) flow.
  discordClientId: process.env.DISCORD_CLIENT_ID || '',
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET || '',
  // Full callback URL registered in the Discord Developer Portal, e.g.
  // https://your-domain/api/auth/discord/callback
  discordOAuthRedirect: process.env.DISCORD_OAUTH_REDIRECT || '',
};

function reloadConfig() {
  try {
    const newCfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    // Mutate objects in-place so all existing references pick up new values
    Object.keys(config).forEach((k) => delete config[k]);
    Object.assign(config, newCfg);
    const newPaths = computePaths(newCfg);
    Object.keys(paths).forEach((k) => delete paths[k]);
    Object.assign(paths, newPaths);
    // Re-read credentials from .env
    try {
      const envContent = fs.readFileSync(path.join(ROOT_PATH, '.env'), 'utf8');
      const readVar = (key) => {
        const m = envContent.match(new RegExp(`^${key}=(.*)$`, 'm'));
        return m ? m[1].trim() : null;
      };
      const pw = readVar('WEB_ADMIN_PASSWORD');
      const tok = readVar('DISCORD_TOKEN');
      if (pw !== null) env.webAdminPassword = pw;
      if (tok !== null) env.discordToken = tok;
      const cid = readVar('DISCORD_CLIENT_ID');
      const csec = readVar('DISCORD_CLIENT_SECRET');
      const credir = readVar('DISCORD_OAUTH_REDIRECT');
      if (cid !== null) env.discordClientId = cid;
      if (csec !== null) env.discordClientSecret = csec;
      if (credir !== null) env.discordOAuthRedirect = credir;
    } catch {}
  } catch { /* keep existing config if reload fails */ }
}

module.exports = { config, paths, env, resolveConfigPath, reloadConfig, rootPath: ROOT_PATH };
