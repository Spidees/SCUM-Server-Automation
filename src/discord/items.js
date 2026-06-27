'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../core/logger');
const { paths } = require('../core/config');

const ITEMS_FILE = path.join(paths.root, 'data', 'scum_items.json');
const ICON_BASE_URL = 'https://playhub.cz/scum/items/scum_images/';

let itemsById = null;

function loadItems() {
  if (itemsById) return itemsById;
  itemsById = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(ITEMS_FILE, 'utf8'));
    for (const item of raw) {
      if (item && item.id) itemsById.set(item.id, item);
    }
    logger.info(`[Items] Loaded ${itemsById.size} item definitions`);
  } catch (err) {
    logger.warn(`[Items] Failed to load ${ITEMS_FILE}: ${err.message}`);
  }
  return itemsById;
}

/**
 * Strip a trailing " (xN)" quantity suffix, e.g. "Bandage (x3)" -> "Bandage".
 */
function stripQuantity(itemId) {
  return itemId.replace(/\s*\(x\d+\)\s*$/i, '');
}

/**
 * Resolve a weapon/item id to a human-readable display name.
 * Mirrors Get-ItemDisplayName from item-manager.psm1.
 */
function getItemDisplayName(itemId) {
  if (!itemId) return itemId;
  const items = loadItems();

  let id = stripQuantity(itemId);

  let item = items.get(id);
  if (item) return item.name;

  if (id.endsWith('_C')) {
    const stripped = id.slice(0, -2);
    item = items.get(stripped);
    if (item) return item.name;
    id = stripped;
  }

  let fallback = id.replace(/_/g, ' ');
  fallback = fallback.replace(/^(1H|2H)\s+/, '');
  fallback = fallback.replace(/^Weapon\s+/, '');
  return fallback.trim();
}

/**
 * Resolve a weapon/item id to a full icon URL, or null if unknown.
 * Mirrors Get-ItemImage from item-manager.psm1.
 */
function getItemImageUrl(itemId) {
  if (!itemId) return null;
  const items = loadItems();

  let id = stripQuantity(itemId);

  let item = items.get(id);
  if (!item && id.endsWith('_C')) {
    item = items.get(id.slice(0, -2));
  }

  if (item && item.image) return `${ICON_BASE_URL}${item.image}`;
  return null;
}

/** Full icon URL for a raw image filename (e.g. "Gold_Bank_Card.png"), or null. */
function itemImageUrl(filename) {
  return filename ? `${ICON_BASE_URL}${filename}` : null;
}

module.exports = {
  getItemDisplayName,
  getItemImageUrl,
  itemImageUrl,
};
