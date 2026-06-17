'use strict';

// ════════════════════════════════════════════════════════════════════════
// Central Discord branding + emoji handling.
//
// Discord does NOT convert `:shortcode:` emoji in bot-sent embeds or message
// content — they render as literal text (e.g. ":rocket:"). We keep the
// readable shortcodes in the source and convert them to real Unicode at send
// time via emojify(), and stamp every embed with one consistent branded
// footer + logo via applyBranding().
// ════════════════════════════════════════════════════════════════════════

const BRAND_NAME = 'SCUM Server Automation';
const LOGO_URL = 'https://playhub.cz/scum/manager/server_automation_discord.png';

// Shortcode → Unicode map for every emoji used across the bot.
const EMOJI = {
  x: '❌',
  white_check_mark: '✅',
  no_entry: '⛔',
  medal: '🏅',
  warning: '⚠️',
  information_source: 'ℹ️',
  green_circle: '🟢',
  trophy: '🏆',
  link: '🔗',
  key: '🔑',
  arrows_counterclockwise: '🔄',
  arrow_up: '⬆️',
  red_circle: '🔴',
  mag: '🔍',
  clock1: '🕐',
  clock3: '🕒',
  clock8: '🕗',
  zap: '⚡',
  skull: '💀',
  satellite: '🛰️',
  hourglass: '⌛',
  hourglass_flowing_sand: '⏳',
  floppy_disk: '💾',
  busts_in_silhouette: '👥',
  bust_in_silhouette: '👤',
  alarm_clock: '⏰',
  video_game: '🎮',
  triangular_flag_on_post: '🚩',
  timer: '⏲️',
  star: '⭐',
  shield: '🛡️',
  octagonal_sign: '🛑',
  stop_sign: '🛑',
  moneybag: '💰',
  id: '🆔',
  calendar: '📅',
  calendar_spiral: '🗓️',
  boom: '💥',
  zombie: '🧟',
  scroll: '📜',
  round_pushpin: '📍',
  rotating_light: '🚨',
  robot: '🤖',
  red_car: '🚗',
  package: '📦',
  lock: '🔒',
  unlock: '🔓',
  knife: '🔪',
  hammer: '🔨',
  gun: '🔫',
  game_die: '🎲',
  crossed_swords: '⚔️',
  coin: '🪙',
  broken_chain: '⛓️',
  wrench: '🔧',
  wastebasket: '🗑️',
  thermometer: '🌡️',
  shopping_cart: '🛒',
  scales: '⚖️',
  rocket: '🚀',
  outbox_tray: '📤',
  inbox_tray: '📥',
  loudspeaker: '📢',
  grey_question: '❔',
  gift: '🎁',
  fast_forward: '⏩',
  european_castle: '🏰',
  earth_americas: '🌎',
  door: '🚪',
  desktop: '🖥️',
  dart: '🎯',
  credit_card: '💳',
  cloud: '☁️',
  broom: '🧹',
  boot: '👢',
  bomb: '💣',
  black_circle: '⚫',
  bell: '🔔',
  bar_chart: '📊',
  bank: '🏦',
  atm: '🏧',
  arrow_forward: '▶️',
  gear: '⚙️',
  '1234': '🔢',
};

/**
 * Replace known `:shortcode:` tokens with Unicode emoji. Unknown tokens
 * (and things like timestamps "12:30:45") are left untouched.
 */
function emojify(text) {
  if (typeof text !== 'string' || text.indexOf(':') === -1) return text;
  return text.replace(/:([a-z0-9_+]+):/g, (match, code) => (EMOJI[code] !== undefined ? EMOJI[code] : match));
}

/** The single canonical footer used by every embed. */
function standardFooter() {
  return { text: BRAND_NAME, iconURL: LOGO_URL };
}

/**
 * Finalize an EmbedBuilder for sending: convert shortcodes in all text to
 * Unicode, stamp the consistent branded footer + logo, and ensure a timestamp.
 * Idempotent — safe to call more than once.
 */
function applyBranding(embed) {
  if (!embed || !embed.data) return embed;
  const d = embed.data;

  if (d.title) d.title = emojify(d.title);
  if (d.description) d.description = emojify(d.description);
  if (d.author && d.author.name) d.author.name = emojify(d.author.name);
  if (Array.isArray(d.fields)) {
    for (const f of d.fields) {
      if (f.name) f.name = emojify(f.name);
      if (f.value) f.value = emojify(f.value);
    }
  }

  embed.setFooter(standardFooter());
  if (!d.timestamp) embed.setTimestamp(new Date());
  return embed;
}

/**
 * Brand an outgoing message payload: emojify string content and apply branding
 * to every embed. Returns the (mutated) payload, or the emojified string.
 */
function brandPayload(payload) {
  if (typeof payload === 'string') return emojify(payload);
  if (payload && typeof payload === 'object') {
    if (typeof payload.content === 'string') payload.content = emojify(payload.content);
    if (Array.isArray(payload.embeds)) {
      payload.embeds.forEach((e) => { if (e && e.data) applyBranding(e); });
    }
  }
  return payload;
}

module.exports = { BRAND_NAME, LOGO_URL, EMOJI, emojify, standardFooter, applyBranding, brandPayload };
