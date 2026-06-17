'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

const ROOT_PATH = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT_PATH, '.env');

// Ensure .env exists with a valid session secret so the web server can start.
// Setup wizard in the browser will write the real password.
if (!fs.existsSync(ENV_FILE)) {
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(ENV_FILE, [
    'DISCORD_TOKEN=',
    'WEB_ADMIN_PASSWORD=changeme',
    `SESSION_SECRET=${secret}`,
    '',
  ].join(os.EOL), 'utf8');
}

require('./app');
