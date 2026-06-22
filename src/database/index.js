'use strict';

const db = require('./db');
const leaderboards = require('./leaderboards');
const playerStats = require('./playerStats');
const weekly = require('./weekly');
const serverDb = require('./serverDb');
const economy = require('./economy');

function closeAll() {
  db.closeAll();
  serverDb.closeAll();
}

module.exports = {
  ...db,
  ...leaderboards,
  ...playerStats,
  ...weekly,
  ...serverDb,
  ...economy,
  closeAll,
};
