'use strict';

// Lightweight micro-cache for read-only SCUM.db lookups.
//
// The SCUM save database is opened read-only and is mutated continuously by the
// game, so we cannot add indexes or invalidate on write. Instead we memoize hot
// reads for a short TTL and clear everything whenever the connection is (re)opened
// or closed. As long as each TTL stays <= the caller's natural refresh cadence the
// observable output is identical to reading every time — we just stop issuing the
// same query dozens of times per minute.

const store = new Map(); // key -> { value, expires }

/**
 * Return the cached value for `key` if it hasn't expired, otherwise compute it
 * with `fn`, cache it for `ttlMs`, and return it.
 */
function memo(key, ttlMs, fn) {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value;
  const value = fn();
  store.set(key, { value, expires: now + ttlMs });
  return value;
}

/**
 * Memoize a value that never changes while the same save file is open (entity
 * class names, profile->steam mappings, ...). Null/undefined results are NOT
 * cached so a lookup that ran before the row existed will retry next time.
 */
function memoPersistent(key, fn) {
  const hit = store.get(key);
  if (hit !== undefined) return hit.value;
  const value = fn();
  if (value != null) store.set(key, { value, expires: Infinity });
  return value;
}

/** Drop everything. Called when the SCUM.db connection is (re)opened or closed. */
function clear() {
  store.clear();
}

module.exports = { memo, memoPersistent, clear };
