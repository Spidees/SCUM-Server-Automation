'use strict';

// Small in-memory ring buffer of recent kills/suicides, fed by the kill feed so
// the public site can show a live kill feed without touching SCUM.db or the logs.
// Only non-sensitive fields are kept (names, weapon, distance) — never raw coords.

const RING = [];
const MAX = 50;

function record(event) {
  if (!event) return;
  if (event.type === 'kill') {
    RING.unshift({
      at: Date.now(),
      type: 'kill',
      killer: event.killerName,
      victim: event.victimName,
      weapon: event.weaponName,
      weaponType: event.weaponType,
      distance: event.distance || 0,
    });
  } else if (event.type === 'suicide') {
    RING.unshift({ at: Date.now(), type: 'suicide', victim: event.playerName });
  } else {
    return;
  }
  if (RING.length > MAX) RING.length = MAX;
}

function getRecent(limit = 25) {
  return RING.slice(0, Math.min(Math.max(limit, 1), MAX));
}

module.exports = { record, getRecent };
