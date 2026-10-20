'use strict';

// Discord Embed Editor — backend. Turns the editor's JSON into a discord.js embed + button rows,
// lists channels for the picker, sends embeds, and stores named templates. Also exposes a reusable
// service so any other plugin can build/send an editor embed: host.consume('embed-editor').

function clean(v) { return (typeof v === 'string' && v.trim() !== '') ? v : undefined; }

/**
 * Discord's limits, applied to the text AFTER the tokens are resolved.
 *
 * This is the one thing the editor cannot warn about, and the one that matters most. `{onlineList}`
 * is thirteen characters while you are writing it and around two thousand on a full server, so an
 * embed that fits comfortably in the editor is refused the moment it is actually sent. What happened
 * then depended on which path you were on, and all three were bad:
 *
 *   • a custom LIVE embed froze at its old content for ever, retrying and failing every 15s;
 *   • a SCHEDULED embed threw, was logged as failed and dropped from the queue — the announcement
 *     simply never happened;
 *   • a manual send answered with a raw discord.js validation error.
 *
 * Trimming is the lesser loss. A list ending in "…" is obviously a list that was cut; a frozen embed
 * looks like live data.
 *
 * The numbers live HERE ONLY. The styler half asks for them through the editor service rather than
 * keeping its own copy, because two lists of Discord's limits is one list that goes stale.
 */
const LIM = {
  title: 256, description: 4096, fieldName: 256, fieldValue: 1024, footer: 2048,
  authorName: 256, content: 2000, fields: 25, embeds: 10, total: 6000,
  btnLabel: 80, customId: 100, selPlaceholder: 150, optLabel: 100, optDesc: 100, options: 25,
};
function cut(s, n) {
  if (typeof s !== 'string' || s.length <= n) return s;
  const hard = s.slice(0, n - 1);
  // Prefer to end on a line break when there is one reasonably near the end: a list that stops after
  // a whole entry reads as truncated on purpose, one that stops mid-word reads as broken.
  const nl = hard.lastIndexOf('\n');
  return (nl > n * 0.6 ? hard.slice(0, nl) : hard) + '…';
}
// What an embed counts against the 6000-per-message budget. Discord counts the text, not the JSON,
// and not the URLs.
function embedCost(r) {
  if (!r || typeof r !== 'object') return 0;
  let n = (r.title || '').length + (r.description || '').length
    + ((r.author && r.author.name) || '').length + ((r.footer && r.footer.text) || '').length;
  for (const f of (Array.isArray(r.fields) ? r.fields : [])) n += (f.name || '').length + (f.value || '').length;
  return n;
}
function fitEmbed(r) {
  if (!r || typeof r !== 'object') return r;
  r.title = cut(r.title, LIM.title);
  r.description = cut(r.description, LIM.description);
  if (r.author) r.author.name = cut(r.author.name, LIM.authorName);
  if (r.footer) r.footer.text = cut(r.footer.text, LIM.footer);
  if (Array.isArray(r.fields)) {
    r.fields = r.fields.slice(0, LIM.fields).map((f) => Object.assign({}, f, {
      name: cut(f && f.name, LIM.fieldName), value: cut(f && f.value, LIM.fieldValue),
    }));
  }
  // Each value can be legal on its own and the message still be refused: a 4096-character
  // description plus twenty-five 1024-character fields is 29 596 against a 6000 budget. Drop whole
  // fields from the end first (a field is a unit), and only then cut the description.
  while (embedCost(r) > LIM.total && Array.isArray(r.fields) && r.fields.length) r.fields.pop();
  const over = embedCost(r) - LIM.total;
  if (over > 0 && typeof r.description === 'string') r.description = cut(r.description, Math.max(0, r.description.length - over));
  return r;
}
/** The whole editor model: the embed, the text above it, the controls, and the extra embeds. */
function fitModel(r) {
  if (!r || typeof r !== 'object') return r;
  fitEmbed(r);
  r.content = cut(r.content, LIM.content);
  if (Array.isArray(r.buttons)) r.buttons = r.buttons.map((b) => (b ? Object.assign({}, b, { label: cut(b.label, LIM.btnLabel) }) : b));
  if (Array.isArray(r.selects)) {
    r.selects = r.selects.map((sl) => (sl ? Object.assign({}, sl, {
      placeholder: cut(sl.placeholder, LIM.selPlaceholder),
      options: Array.isArray(sl.options)
        ? sl.options.slice(0, LIM.options).map((o) => (o ? Object.assign({}, o, { label: cut(o.label, LIM.optLabel), description: cut(o.description, LIM.optDesc) }) : o))
        : sl.options,
    }) : sl));
  }
  // The 6000 budget is per MESSAGE, across every embed in it — so the extras are spent from whatever
  // the first embed leaves. An extra that no longer fits is dropped whole rather than cut to a stub:
  // half a table is worse than no table.
  if (Array.isArray(r.extraEmbeds) && r.extraEmbeds.length) {
    let left = LIM.total - embedCost(r);
    const keep = [];
    for (const x of r.extraEmbeds.slice(0, LIM.embeds - 1)) {
      const fx = fitEmbed(x);
      const cost = embedCost(fx);
      if (cost > left) break;
      left -= cost; keep.push(fx);
    }
    r.extraEmbeds = keep;
  }
  return r;
}

/**
 * The plugin's own settings: the four master switches, the intervals, the default channel and the
 * owner's wording of every private reply a click action gives.
 *
 * They live in `config.json`, which is the owner's copy of these DEFAULTS, and they are merged by
 * KEY PRESENCE: a config written by 1.9.x has none of these keys, so every switch reads ON and every
 * number reads what the code used before it was a setting. That is what makes an installed plugin
 * open unchanged. `replies` and `repliesI18n` hold only what the owner CHANGED: an empty text is the
 * built-in one, in every language the plugin ships.
 */
const DEFAULTS = {
  styling: { enabled: true },
  liveEmbeds: { enabled: true, defaultIntervalSec: 60, reverifyMinutes: 10 },
  clickActions: { enabled: true },
  scheduler: { enabled: true, lateLimitMinutes: 0 },
  history: { max: 100 },
  activity: { max: 300 },
  defaultChannelId: '',
  replies: {},
  repliesI18n: {},
};
// The floor and ceiling of every number above. A typed 0 or a word falls back to the default rather
// than to a floor: a refresh "every 0 s" is a mistake, not a request to hammer Discord.
const RANGES = {
  'liveEmbeds.defaultIntervalSec': [15, 86400],
  'liveEmbeds.reverifyMinutes': [1, 1440],
  'scheduler.lateLimitMinutes': [0, 10080],
  'history.max': [10, 500],
  'activity.max': [50, 2000],
};
function intIn(v, dflt, range) {
  if (v === '' || v == null || typeof v === 'boolean') return dflt;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  if (n < range[0]) return range[0] === 0 ? 0 : (n <= 0 ? dflt : range[0]);
  return Math.min(range[1], n);
}
/** A per-language map as it is stored: a language code to a text that is not blank. */
function cleanI18n(m) {
  const out = {};
  if (!m || typeof m !== 'object' || Array.isArray(m)) return out;
  for (const k of Object.keys(m)) {
    const code = String(k).toLowerCase();
    if (/^[a-z]{2}(?:-[a-z]{2})?$/.test(code) && typeof m[k] === 'string' && m[k].trim()) out[code] = m[k];
  }
  return out;
}
/** Whatever is stored, made whole: every key present, every number in range, by key presence. */
function normalizeSettings(raw) {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const sec = (name) => ((r[name] && typeof r[name] === 'object' && !Array.isArray(r[name])) ? r[name] : {});
  const on = (name) => sec(name).enabled !== false;
  const num = (name, key) => intIn(sec(name)[key], DEFAULTS[name][key], RANGES[name + '.' + key]);
  const replies = {};
  const rs = (r.replies && typeof r.replies === 'object' && !Array.isArray(r.replies)) ? r.replies : {};
  for (const k of Object.keys(rs)) if (/^\w{1,40}$/.test(k) && typeof rs[k] === 'string' && rs[k].trim()) replies[k] = rs[k];
  const repliesI18n = {};
  const ri = (r.repliesI18n && typeof r.repliesI18n === 'object' && !Array.isArray(r.repliesI18n)) ? r.repliesI18n : {};
  for (const k of Object.keys(ri)) {
    if (!/^\w{1,40}$/.test(k)) continue;
    const m = cleanI18n(ri[k]);
    if (Object.keys(m).length) repliesI18n[k] = m;
  }
  const ch = typeof r.defaultChannelId === 'string' || typeof r.defaultChannelId === 'number' ? String(r.defaultChannelId).trim() : '';
  return {
    styling: { enabled: on('styling') },
    liveEmbeds: { enabled: on('liveEmbeds'), defaultIntervalSec: num('liveEmbeds', 'defaultIntervalSec'), reverifyMinutes: num('liveEmbeds', 'reverifyMinutes') },
    clickActions: { enabled: on('clickActions') },
    scheduler: { enabled: on('scheduler'), lateLimitMinutes: num('scheduler', 'lateLimitMinutes') },
    history: { max: num('history', 'max') },
    activity: { max: num('activity', 'max') },
    defaultChannelId: /^\d{5,25}$/.test(ch) ? ch : '',
    replies,
    repliesI18n,
  };
}
/**
 * A save laid over what is stored, one level deep and by key presence, so a body that names one
 * section never resets the others. A per-language map is sent WHOLE and replaces what is stored,
 * or a language the owner cleared would come back from the stored copy.
 */
function overlaySettings(stored, body) {
  const out = Object.assign({}, (stored && typeof stored === 'object' && !Array.isArray(stored)) ? stored : {});
  if (!body || typeof body !== 'object' || Array.isArray(body)) return out;
  for (const k of Object.keys(body)) {
    const b = body[k]; const cur = out[k];
    if (k === 'replies' || k === 'repliesI18n') out[k] = b;
    else if (b && typeof b === 'object' && !Array.isArray(b) && cur && typeof cur === 'object' && !Array.isArray(cur)) out[k] = Object.assign({}, cur, b);
    else out[k] = b;
  }
  return out;
}

function toApiEmbed(j) {
  j = j || {};
  const e = {};
  if (clean(j.title)) e.title = j.title;
  if (clean(j.description)) e.description = j.description;
  if (clean(j.url)) e.url = j.url;
  if (typeof j.color === 'number') e.color = j.color;
  else if (clean(j.color)) { const n = parseInt(String(j.color).replace('#', ''), 16); if (!isNaN(n)) e.color = n; }
  if (j.timestamp) e.timestamp = (j.timestamp === true ? new Date().toISOString() : j.timestamp);
  if (j.author && clean(j.author.name)) e.author = { name: j.author.name, url: clean(j.author.url), icon_url: clean(j.author.icon_url) };
  if (j.footer && clean(j.footer.text)) e.footer = { text: j.footer.text, icon_url: clean(j.footer.icon_url) };
  if (j.thumbnail && clean(j.thumbnail.url)) e.thumbnail = { url: j.thumbnail.url };
  if (j.image && clean(j.image.url)) e.image = { url: j.image.url };
  if (Array.isArray(j.fields)) e.fields = j.fields.filter(f => f && (clean(f.name) || clean(f.value)))
    .map(f => ({ name: f.name || '​', value: f.value || '​', inline: !!f.inline })).slice(0, 25);
  // Every path that builds an embed goes through here — the editor's own send, an edit, the
  // scheduler, and the styler applying a saved style — so this is the one place that has to hold the
  // limits. Trimming is idempotent, so a caller that has already trimmed loses nothing by it.
  return fitEmbed(e);
}

// Buttons AND select menus, laid out the way Discord requires: a row holds either up to five
// buttons or exactly one select, and a message allows five rows in total. Selects go first, since
// they are the taller control and reading them above the buttons matches how Discord stacks them.
function buildComponents(host, buttons, selects) {
  const { ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = host.discord.js;
  const rows = [];

  (Array.isArray(selects) ? selects : []).forEach((s, si) => {
    if (rows.length >= 5) return;                                   // Discord's row limit
    const opts = (Array.isArray(s.options) ? s.options : [])
      .filter((o) => o && clean(o.label))
      .slice(0, 25)                                                 // Discord's option limit
      .map((o, oi) => {
        const opt = { label: String(o.label).slice(0, 100), value: clean(o.value) || ('opt_' + oi) };
        if (clean(o.description)) opt.description = String(o.description).slice(0, 100);
        if (clean(o.emoji)) opt.emoji = o.emoji;
        if (o.default) opt.default = true;
        return opt;
      });
    // A select with no options is rejected by Discord outright, so drop it rather than fail the send.
    if (!opts.length) return;
    const menu = new StringSelectMenuBuilder()
      .setCustomId(clean(s.custom_id) || clean(s.customId) || ('select_' + si))
      .addOptions(opts);
    if (clean(s.placeholder)) menu.setPlaceholder(String(s.placeholder).slice(0, 150));
    const min = Number(s.min_values); const max = Number(s.max_values);
    if (Number.isFinite(min) && min >= 0) menu.setMinValues(Math.min(min, opts.length));
    if (Number.isFinite(max) && max >= 1) menu.setMaxValues(Math.min(max, opts.length));
    if (s.disabled) menu.setDisabled(true);
    rows.push(host.discord.row(menu));
  });

  const btns = Array.isArray(buttons) ? buttons : [];
  for (let i = 0; i < btns.length && rows.length < 5; i += 5) {
    const slice = btns.slice(i, i + 5).map((b, j) => {
      const bb = new ButtonBuilder();
      const style = b.style || (b.url ? ButtonStyle.Link : ButtonStyle.Primary);
      // A button label is capped at 80 and a custom id at 100. The select menu below has always been
      // truncated; the buttons were not, so a token that grew — `Online: {online}/{max}` on a busy
      // server, or an item name — threw and took the whole message with it.
      bb.setStyle(style).setLabel(cut(clean(b.label) || 'Button', LIM.btnLabel));
      if (String(style) === String(ButtonStyle.Link)) bb.setURL(clean(b.url) || 'https://scumsa.com');
      else bb.setCustomId(String(clean(b.custom_id) || clean(b.customId) || ('btn_' + (i + j))).slice(0, LIM.customId));
      if (clean(b.emoji)) { try { bb.setEmoji(b.emoji); } catch { /* invalid emoji */ } }
      if (b.disabled) bb.setDisabled(true);
      return bb;
    });
    rows.push(host.discord.row(...slice));
  }
  return rows;
}

module.exports = {
  DEFAULTS,
  normalizeSettings,
  async register(host) {
    // ── settings ────────────────────────────────────────────────────────────────────────────
    // Read through the host each time: `host.config.get()` is cached by the manager, and reading it
    // here means a save from the Settings screen applies at the next send without a reload.
    const settings = () => {
      let raw = {};
      try { raw = (host.config && typeof host.config.get === 'function') ? (host.config.get() || {}) : {}; } catch (e) { raw = {}; }
      return normalizeSettings(raw);
    };

    // ── is the bot there at all ─────────────────────────────────────────────────────────────
    // Every Discord call here goes through the bot, and a bot that is not connected answered as if
    // the CHANNEL were the problem ("the bot cannot see that channel"), which sends an owner to fix
    // a channel that is fine. Asked first now, so the answer names the bot.
    const botClient = () => {
      try { return (host.discord && typeof host.discord.client === 'function') ? host.discord.client() : null; } catch (e) { return null; }
    };
    const botUp = () => {
      const c = botClient();
      if (!c) return false;
      try { return typeof c.isReady === 'function' ? !!c.isReady() : true; } catch (e) { return true; }
    };
    const BOT_OFF = { error: 'bot_offline', code: 'bot_offline', reason: 'the Discord bot is not connected' };

    // ── activity: what this plugin did, where and when, and why when it failed ─────────────────
    // Held in memory and written to the store on a five-second tick when something changed, so a
    // burst of clicks costs one write. A restart loses at most those five seconds.
    let activity = [];
    try { const a = host.store.get('activity', []); activity = Array.isArray(a) ? a.slice(0, 2000) : []; } catch (e) { activity = []; }
    let activityDirty = false;
    let activitySeq = 0;
    function record(entry) {
      try {
        const e = Object.assign({ at: Date.now(), ok: true }, entry || {});
        e.id = 'a' + e.at.toString(36) + (activitySeq++).toString(36);
        activity.unshift(e);
        const max = settings().activity.max;
        if (activity.length > max) activity.length = max;
        activityDirty = true;
      } catch (err) { /* bookkeeping never breaks a send */ }
    }
    function flushActivity() {
      if (!activityDirty) return;
      activityDirty = false;
      try { host.store.set('activity', activity); } catch (e) { activityDirty = true; }
    }
    host.schedule.every(5000, flushActivity);
    const channelName = async (id) => {
      try { const ch = id ? await host.discord.channel(String(id)) : null; return (ch && ch.name) ? String(ch.name) : ''; } catch (e) { return ''; }
    };
    /** Why a send that answered false did not go out: no bot, no channel, or Discord refused it. */
    async function whyNotSent(channelId) {
      if (!botUp()) return { code: 'bot_offline', why: BOT_OFF.reason };
      let ch = null;
      try { ch = await host.discord.channel(String(channelId)); } catch (e) { ch = null; }
      if (!ch) return { code: 'channel_not_found', why: 'the bot cannot see that channel' };
      return { code: 'send_failed', why: 'Discord did not accept the message' };
    }
    // Shared with the styler half, which runs the live embeds, the restyled embeds and the clicks.
    const shared = { settings, record, botUp, botClient, liveStatus: null, styleStats: null };

    // Reusable service for OTHER plugins.
    host.provide('embed-editor', {
      apiEmbed: (json) => toApiEmbed(json),
      embed: (json) => host.discord.js.EmbedBuilder.from(toApiEmbed(json)),
      components: (buttons, selects) => buildComponents(host, buttons, selects),
      // Trim a whole editor model — embed, the text above it, controls, extra embeds — to Discord's
      // limits, AFTER its tokens have been resolved. Exposed so the styler half does not keep a
      // second copy of those numbers: two lists of Discord's limits is one list that goes stale.
      fit: (model) => fitModel(model),
      limits: () => Object.assign({}, LIM),
      async send(channelId, json, buttons) {
        const payload = { embeds: [host.discord.js.EmbedBuilder.from(toApiEmbed(json))] };
        const comps = buildComponents(host, buttons, json && json.selects); if (comps.length) payload.components = comps;
        return host.discord.send(channelId, payload);
      },
    });

    host.routes.get('/channels', async (req, res) => {
      const c = host.discord.client();
      if (!c) return res.json([]);
      try {
        const g = c.guilds.cache.first(); if (!g) return res.json([]);
        const all = await g.channels.fetch();
        const out = [];
        all.forEach(ch => { if (ch && ch.type === 0) out.push({ id: ch.id, name: ch.name }); }); // 0 = GuildText
        out.sort((a, b) => a.name.localeCompare(b.name));
        res.json(out);
      } catch (e) { res.json([]); }
    });

    // The guild's roles, so "who may press this button" is a dropdown rather than an id an owner has
    // to go and copy out of Discord's developer mode. `@everyone` is filtered out: it is every member
    // and therefore the same as no restriction, and offering it would read as a restriction.
    host.routes.get('/roles', async (req, res) => {
      const c = host.discord.client();
      if (!c) return res.json([]);
      try {
        const g = c.guilds.cache.first(); if (!g) return res.json([]);
        const all = await g.roles.fetch();
        const out = [];
        all.forEach((r) => { if (r && r.id !== g.id) out.push({ id: r.id, name: r.name }); });
        out.sort((a, b) => a.name.localeCompare(b.name));
        res.json(out);
      } catch (e) { res.json([]); }
    });

    // Everything the editor has sent, newest first. Keeping the message id is what makes editing
    // an already-posted message possible at all — without it a "sent" embed is unreachable.
    // How many it keeps is a setting now (10 to 500); 100 is what it always kept.
    const history = () => { const l = host.store.get('history', []); return Array.isArray(l) ? l : []; };
    function remember(entry) {
      const list = history();
      list.unshift(entry);
      host.store.set('history', list.slice(0, settings().history.max));
    }

    // Live data. The catalog and the resolver come from the `server-data` service; the EDITOR is
    // what plugins talk to, so any plugin that mounts it gets live tokens without wiring its own
    // picker. Kind-specific catalogs (what a kill event carries, what a trade carries) stay with
    // the plugin that owns that knowledge — only it knows the shape of its own events.
    const serverData = () => { try { return host.consume('server-data'); } catch (e) { return null; } };
    function resolveText(v) {
      var sd = serverData();
      if (!sd || typeof sd.resolve !== 'function' || typeof v !== 'string' || v.indexOf('{') < 0) return v;
      try { return sd.resolve(v); } catch (e) { return v; }
    }
    // Walk the embed and fill every {token} in its text. Done at SEND time, so what is stored stays
    // the template and a re-send picks up the numbers as they are then.
    function resolveEmbed(j) {
      if (!j || typeof j !== 'object') return j;
      const out = JSON.parse(JSON.stringify(j));
      ['title', 'description', 'url'].forEach((k) => { if (typeof out[k] === 'string') out[k] = resolveText(out[k]); });
      ['author', 'footer'].forEach((k) => {
        if (!out[k]) return;
        ['name', 'text', 'icon_url', 'url'].forEach((p) => { if (typeof out[k][p] === 'string') out[k][p] = resolveText(out[k][p]); });
      });
      ['thumbnail', 'image'].forEach((k) => { if (out[k] && typeof out[k].url === 'string') out[k].url = resolveText(out[k].url); });
      if (Array.isArray(out.fields)) out.fields.forEach((fd) => {
        if (typeof fd.name === 'string') fd.name = resolveText(fd.name);
        if (typeof fd.value === 'string') fd.value = resolveText(fd.value);
      });
      return out;
    }

    host.routes.get('/tokens', (req, res) => {
      const sd = serverData();
      let list = [];
      try { list = (sd && typeof sd.catalog === 'function') ? (sd.catalog() || []) : []; } catch (e) { list = []; }
      // The catalog's `sample` is an ILLUSTRATION ('24 players', 'My SCUM Server') — fine for a
      // picker, wrong for a preview that claims to show the message. Overlay the live snapshot so
      // what you see is this server right now; entries with no live value (a kill's weapon, a
      // trade's item — they only exist while that event fires) keep the illustration and say so.
      let live = {};
      try { live = (sd && typeof sd.data === 'function') ? (sd.data() || {}) : {}; } catch (e) { live = {}; }
      const out = list.map((t) => {
        if (!t || !t.t) return t;
        const v = live[t.t];
        if (v === undefined || v === null || v === '') return Object.assign({}, t, { live: false });
        return Object.assign({}, t, { sample: String(v), live: true });
      });
      res.json(out);
    });

    // Discord allows up to TEN embeds in one message. `extraEmbeds` is additive on purpose: a
    // caller that knows nothing about it (the styler, vehicle-rental) still sends exactly one embed,
    // and nothing about the stored shape changes for them.
    const EMBED_MAX = 10;
    // Everything that makes up one message, in one place. /send, /edit and the scheduler all
    // store and rebuild through this: three hand-written copies is how extra embeds and select
    // menus silently went missing from anything replayed out of the history.
    function messageData(b) {
      return {
        embed: b.embed || {},
        extraEmbeds: Array.isArray(b.extraEmbeds) ? b.extraEmbeds : [],
        buttons: Array.isArray(b.buttons) ? b.buttons : [],
        selects: Array.isArray(b.selects) ? b.selects : [],
        content: b.content || '',
      };
    }

    /** Every place a {token} can be typed into a button or a select menu. */
    function resolveComponents(list) {
      if (!Array.isArray(list)) return list;
      return list.map((c) => {
        if (!c || typeof c !== 'object') return c;
        const out = Object.assign({}, c);
        ['label', 'placeholder', 'url', 'custom_id', 'customId'].forEach((k) => {
          if (typeof out[k] === 'string') out[k] = resolveText(out[k]);
        });
        if (Array.isArray(out.options)) {
          out.options = out.options.map((o) => {
            if (!o || typeof o !== 'object') return o;
            const oo = Object.assign({}, o);
            ['label', 'description', 'value'].forEach((k) => { if (typeof oo[k] === 'string') oo[k] = resolveText(oo[k]); });
            return oo;
          });
        }
        return out;
      });
    }

    function buildPayload(b) {
      const list = [b.embed].concat(Array.isArray(b.extraEmbeds) ? b.extraEmbeds : [])
        .filter((e) => e && typeof e === 'object')
        .slice(0, EMBED_MAX);
      const api = list.map((e) => toApiEmbed(resolveEmbed(e)));
      // Each embed is within its own limits by now; the 6000 is per MESSAGE, across all of them.
      // An embed that no longer fits is dropped whole rather than cut to a stub.
      let left = LIM.total;
      const fitted = [];
      for (const e of api) {
        const cost = embedCost(e);
        if (cost > left) break;
        left -= cost; fitted.push(e);
      }
      const payload = { embeds: fitted.map((e) => host.discord.js.EmbedBuilder.from(e)) };
      // Plain text above the embed — Discord allows it and people use it for pings.
      //
      // ALWAYS set, empty included, for the same reason the components below are: an edit leaves out
      // what the payload leaves out, so sending nothing when the box was cleared meant deleting the
      // text in the editor did nothing to the message. The components already knew this; the text
      // did not, and the two behaved differently on the same Save.
      payload.content = clean(b.content) ? cut(resolveText(b.content), LIM.content) : '';
      // Always set, so an edit that REMOVES a button or a select actually removes it.
      //
      // RESOLVED first. The editor offers the token picker on a button's label, a menu's placeholder
      // and every option's label and description — and this path handed them to Discord raw, so
      // players read a literal "{online}" on the button while the embed beside it showed the number.
      // The styled built-in embeds already resolved these; /send, /edit and the scheduler did not.
      payload.components = buildComponents(host, resolveComponents(b.buttons), resolveComponents(b.selects));
      return payload;
    }

    // The name the panel sent with the channel is "#rules" as the dropdown drew it; the history and
    // the activity log keep the bare name.
    const bareName = (n) => String(n || '').replace(/^#/, '');
    host.routes.post('/send', async (req, res) => {
      const b = req.body || {};
      if (!b.channelId) return res.status(400).json({ error: 'no_channel', reason: 'no channel was picked' });
      const title = (b.embed && b.embed.title) || '';
      const where = { channelId: String(b.channelId), channelName: bareName(b.channelName) };
      try {
        const msg = await host.discord.send(b.channelId, buildPayload(b));
        if (!msg) {
          const w = await whyNotSent(b.channelId);
          record(Object.assign({ kind: 'send', ok: false, code: w.code, why: w.why, title }, where));
          return res.json({ ok: false, code: w.code, error: w.why });
        }
        const id = msg && msg.id ? String(msg.id) : null;
        if (id) {
          remember({
            messageId: id, channelId: String(b.channelId),
            channelName: bareName(b.channelName), title,
            sentAt: Date.now(), editedAt: null,
            data: messageData(b),
          });
        }
        record(Object.assign({ kind: 'send', ok: true, title, messageId: id }, where));
        res.json({ ok: true, messageId: id });
      } catch (e) {
        record(Object.assign({ kind: 'send', ok: false, code: 'send_failed', why: String(e.message || ''), title }, where));
        res.status(500).json({ error: e.message });
      }
    });

    // Rewrite a message the editor sent earlier, in place.
    host.routes.post('/edit', async (req, res) => {
      const b = req.body || {};
      if (!b.channelId || !b.messageId) return res.status(400).json({ error: 'no_message', reason: 'no message was given' });
      const title = (b.embed && b.embed.title) || '';
      const where = { channelId: String(b.channelId), channelName: bareName(b.channelName), messageId: String(b.messageId) };
      const refuse = (status, code, why) => {
        record(Object.assign({ kind: 'edit', ok: false, code, why, title }, where));
        return res.status(status).json({ error: code, reason: why });
      };
      try {
        const ch = await host.discord.channel(b.channelId);
        if (!ch || !ch.messages) return botUp() ? refuse(404, 'channel_not_found', 'the bot cannot see that channel') : refuse(503, 'bot_offline', BOT_OFF.reason);
        if (!where.channelName && ch.name) where.channelName = String(ch.name);
        const msg = await ch.messages.fetch(String(b.messageId)).catch(() => null);
        // A message deleted in Discord is the common case here, and "not found" is the honest answer —
        // silently re-sending it somewhere would be worse than failing.
        if (!msg) return refuse(404, 'message_gone', 'that message is gone, it may have been deleted in Discord');
        if (!msg.editable) return refuse(403, 'not_ours', 'that message was not posted by this bot, so it cannot be edited');
        // `host.discord.send` attaches an uploaded picture itself; an edit made here has to ask
        // (an older manager has no such helper, and no uploads to attach).
        const pl = buildPayload(b);
        await msg.edit(typeof host.discord.attachUploads === 'function' ? host.discord.attachUploads(pl) : pl);
        const list = history();
        const hit = list.find((x) => x.messageId === String(b.messageId));
        if (hit) {
          hit.editedAt = Date.now();
          hit.title = (b.embed && b.embed.title) || hit.title;
          hit.data = messageData(b);
          host.store.set('history', list);
        }
        record(Object.assign({ kind: 'edit', ok: true, title }, where));
        res.json({ ok: true });
      } catch (e) {
        record(Object.assign({ kind: 'edit', ok: false, code: 'post_failed', why: String(e.message || ''), title }, where));
        res.status(500).json({ error: e.message });
      }
    });

    host.routes.post('/delete', async (req, res) => {
      const b = req.body || {};
      const entry = history().find((x) => x.messageId === String(b.messageId || '')) || {};
      const where = { channelId: String(b.channelId || ''), channelName: bareName(entry.channelName), messageId: String(b.messageId || ''), title: entry.title || '' };
      try {
        let gone = 'deleted';
        if (b.channelId && b.messageId) {
          const ch = await host.discord.channel(b.channelId);
          // With no bot nothing can be deleted in Discord, and dropping the entry anyway (which is
          // what happened) lost the only link to a message that is still up. Refused; the entry stays.
          if (!ch && !botUp()) {
            record(Object.assign({ kind: 'delete', ok: false, code: 'bot_offline', why: BOT_OFF.reason }, where));
            return res.json({ ok: false, code: 'bot_offline', error: BOT_OFF.reason });
          }
          const msg = ch && ch.messages ? await ch.messages.fetch(String(b.messageId)).catch(() => null) : null;
          if (msg) {
            let refused = null;
            await msg.delete().catch((e) => { refused = e; });
            // Discord refusing the delete (no permission) leaves the message up, so the entry stays
            // and the panel says why. It used to vanish from the list while the message stayed.
            if (refused) {
              const why = String((refused && refused.message) || 'Discord refused the delete');
              record(Object.assign({ kind: 'delete', ok: false, code: 'post_failed', why }, where));
              return res.json({ ok: false, code: 'post_failed', detail: why, error: why });
            }
          } else gone = 'already_gone';
        }
        // Drop it from the list whether or not the message was still there — the entry is about a
        // message that no longer exists either way.
        host.store.set('history', history().filter((x) => x.messageId !== String(b.messageId)));
        record(Object.assign({ kind: 'delete', ok: true, code: gone }, where));
        res.json({ ok: true, gone });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Take entries off the list without touching Discord. One body for the whole tick list, so a
    // bulk "Forget" is one write rather than one per message.
    host.routes.post('/history/forget', (req, res) => {
      const ids = Array.isArray((req.body || {}).messageIds) ? req.body.messageIds.map(String) : [];
      if (!ids.length) return res.status(400).json({ error: 'no_message', reason: 'no message was given' });
      const drop = new Set(ids);
      const before = history();
      const after = before.filter((x) => !drop.has(String(x.messageId)));
      host.store.set('history', after);
      res.json({ ok: true, removed: before.length - after.length });
    });

    // The bot's own footer branding, so a new embed starts looking like the rest of the bot
    // instead of blank. The editor only PREFILLS from it — whatever the admin then types is what
    // gets sent, so an edited embed is never re-branded behind their back.
    host.routes.get('/branding', (req, res) => {
      const b = host.discord.branding ? host.discord.branding() : null;
      res.json(b ? { text: b.text || b.name || '', icon_url: b.iconURL || b.icon || '' } : {});
    });

    // Load ANY message this bot posted, by id — not just the ones this editor sent. Covers a
    // message from before this plugin existed, one posted by another feature, or one whose history
    // entry was cleared. Read-only: it returns the message, the admin decides what to do with it.
    host.routes.post('/fetch', async (req, res) => {
      const b = req.body || {};
      if (!b.channelId || !b.messageId) return res.status(400).json({ error: 'no_message', reason: 'no message was given' });
      try {
        const ch = await host.discord.channel(b.channelId);
        if (!ch || !ch.messages) return botUp() ? res.status(404).json({ error: 'channel_not_found', reason: 'the bot cannot see that channel' }) : res.status(503).json(BOT_OFF);
        const msg = await ch.messages.fetch(String(b.messageId)).catch(() => null);
        if (!msg) return res.status(404).json({ error: 'message_not_found', reason: 'that message is not in that channel' });
        // Only our own messages can be edited later, so say so now rather than after the rewrite.
        if (!msg.editable) return res.status(403).json({ error: 'not_ours', reason: 'that message was not posted by this bot, so it cannot be edited' });
        // A message can carry ten embeds; read the first as the main one and the rest as extras,
        // otherwise adopting a multi-embed announcement would quietly throw most of it away.
        const raw = (msg.embeds || []).map((x) => (x && x.toJSON ? x.toJSON() : x)).filter(Boolean);
        const toModel = (e) => ({
          title: e.title || '', url: e.url || '', description: e.description || '',
          color: typeof e.color === 'number' ? '#' + e.color.toString(16).padStart(6, '0') : '#ff6a1a',
          author: { name: (e.author && e.author.name) || '', url: (e.author && e.author.url) || '', icon_url: (e.author && e.author.icon_url) || '' },
          thumbnail: { url: (e.thumbnail && e.thumbnail.url) || '' },
          image: { url: (e.image && e.image.url) || '' },
          footer: { text: (e.footer && e.footer.text) || '', icon_url: (e.footer && e.footer.icon_url) || '' },
          timestamp: !!e.timestamp,
          fields: Array.isArray(e.fields) ? e.fields.map((x) => ({ name: x.name || '', value: x.value || '', inline: !!x.inline })) : [],
        });
        const e = raw[0] || {};
        const embed = {
          title: e.title || '', url: e.url || '', description: e.description || '',
          color: typeof e.color === 'number' ? '#' + e.color.toString(16).padStart(6, '0') : '#ff6a1a',
          author: { name: (e.author && e.author.name) || '', url: (e.author && e.author.url) || '', icon_url: (e.author && e.author.icon_url) || '' },
          thumbnail: { url: (e.thumbnail && e.thumbnail.url) || '' },
          image: { url: (e.image && e.image.url) || '' },
          footer: { text: (e.footer && e.footer.text) || '', icon_url: (e.footer && e.footer.icon_url) || '' },
          timestamp: !!e.timestamp,
          fields: Array.isArray(e.fields) ? e.fields.map((x) => ({ name: x.name || '', value: x.value || '', inline: !!x.inline })) : [],
          buttons: [], selects: [],
          extraEmbeds: raw.slice(1).map(toModel),
        };
        // Buttons come back as raw components; keep the ones the editor can round-trip.
        const rows = msg.components || [];
        rows.forEach((row) => (row.components || []).forEach((c) => {
          if (c.type === 3) {         // 3 = string select
            embed.selects.push({
              custom_id: c.customId || c.custom_id || '', placeholder: c.placeholder || '',
              options: (c.options || []).map((o) => ({ label: o.label || '', value: o.value || '', description: o.description || '' })),
            });
            return;
          }
          if (c.type !== 2) return;   // 2 = button
          embed.buttons.push({
            label: c.label || 'Button', style: String(c.style || 1),
            custom_id: c.customId || c.custom_id || '', url: c.url || '',
            emoji: (c.emoji && (c.emoji.name || c.emoji.id)) ? (c.emoji.id ? '<:' + c.emoji.name + ':' + c.emoji.id + '>' : c.emoji.name) : '',
          });
        }));
        res.json({ ok: true, embed, content: msg.content || '', channelId: String(b.channelId), channelName: ch.name ? String(ch.name) : '', messageId: String(b.messageId), sentAt: msg.createdTimestamp || Date.now() });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── scheduled sending ───────────────────────────────────────────────────────
    // The queue lives in the store, so a manager restart does not lose a post that was booked for
    // tonight. Tokens are deliberately NOT resolved when scheduling — they resolve at send time,
    // which is the whole reason to schedule something ("{online} players online" must mean then,
    // not now).
    const SCHED_MAX = 200;
    const scheduled = () => host.store.get('scheduled', []);
    const saveScheduled = (l) => host.store.set('scheduled', l.slice(0, SCHED_MAX));

    host.routes.get('/scheduled', (req, res) => res.json(scheduled()));

    host.routes.post('/scheduled', (req, res) => {
      const b = req.body || {};
      const at = Number(b.at);
      if (!b.channelId) return res.status(400).json({ error: 'no_channel', reason: 'no channel was picked' });
      if (!Number.isFinite(at)) return res.status(400).json({ error: 'no_time', reason: 'no time was given' });
      // A past time would fire on the very next tick, which is never what someone meant to book.
      if (at < Date.now() - 60000) return res.status(400).json({ error: 'time_past', reason: 'that time is in the past' });
      const list = scheduled();
      // A full queue REFUSES, rather than accepting and dropping.
      //
      // `saveScheduled` keeps the first SCHED_MAX after sorting by time, so booking something
      // further ahead than everything already queued put it last, sliced it off, and still answered
      // `{ok: true}`. The owner scheduled an announcement, was told it was booked, and it never
      // existed — the one failure mode a scheduler must never have.
      if (list.length >= SCHED_MAX) {
        return res.status(400).json({ error: 'schedule_full', max: SCHED_MAX, reason: `the schedule is full (${SCHED_MAX} messages), delete one first` });
      }
      list.push({
        id: 'sch_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
        at, channelId: String(b.channelId), channelName: bareName(b.channelName),
        title: (b.embed && b.embed.title) || '',
        data: messageData(b),
      });
      list.sort((x, y) => x.at - y.at);
      saveScheduled(list);
      res.json({ ok: true });
    });

    // One id, or `ids` for the ticked rows of a bulk cancel.
    host.routes.post('/scheduled/delete', (req, res) => {
      const b = req.body || {};
      const ids = new Set((Array.isArray(b.ids) ? b.ids : [b.id]).filter((x) => x != null && x !== '').map(String));
      const before = scheduled();
      saveScheduled(before.filter((x) => !ids.has(String(x.id))));
      res.json({ ok: true, removed: before.length - scheduled().length });
    });

    // One pass a minute. Anything already due when the manager starts goes out on the first pass —
    // late is better than never for an announcement, and the list shows when it actually went.
    //
    // ⚠ A DUE MESSAGE WAITS FOR THE BOT. The pass used to take every due item off the queue and then
    // send, so a bot that was offline for that one minute (a token refresh, a Discord outage, the
    // manager starting before the bot) turned every booked announcement into a warning in the log
    // and nothing else. With no bot nothing can have been posted, so keeping the item is safe; it
    // goes out on the first pass the bot is back. The same holds with the Scheduler switched off.
    // `lateLimitMinutes` (0 = no limit) drops one that is now too late to mean anything, and says so.
    const schedState = { waitingForBot: false, lastPassAt: 0, paused: false };
    async function schedulePass() {
      const now = Date.now();
      schedState.lastPassAt = now;
      const s = settings();
      const list = scheduled();
      const due = list.filter((x) => x.at <= now);
      schedState.paused = !s.scheduler.enabled;
      if (!due.length) { schedState.waitingForBot = false; return; }
      if (!s.scheduler.enabled) return;
      if (!botUp()) { schedState.waitingForBot = true; return; }
      schedState.waitingForBot = false;
      const late = s.scheduler.lateLimitMinutes > 0 ? s.scheduler.lateLimitMinutes * 60000 : 0;
      // Drop them from the queue FIRST: if the send throws, a retry loop that posts the same
      // announcement every minute would be worse than losing it once, and the log says what failed.
      saveScheduled(list.filter((x) => x.at > now));
      for (const item of due) {
        const where = { channelId: String(item.channelId || ''), channelName: bareName(item.channelName), title: item.title || '', bookedFor: item.at };
        if (late && now - item.at > late) {
          record(Object.assign({ kind: 'scheduled', ok: false, code: 'too_late', why: `it was ${Math.round((now - item.at) / 60000)} minutes late` }, where));
          host.logger.warn(`scheduled embed "${item.title || item.id}" was not posted: it was more than ${s.scheduler.lateLimitMinutes} minutes late.`);
          continue;
        }
        try {
          const msg = await host.discord.send(item.channelId, buildPayload(item.data));
          // `host.discord.send` RETURNS false on failure — it does not throw — so the catch below
          // never ran and a booked announcement that never posted was logged as sent and dropped
          // from the queue. Nothing anywhere said it had not gone out.
          if (!msg) {
            const w = await whyNotSent(item.channelId);
            record(Object.assign({ kind: 'scheduled', ok: false, code: w.code, why: w.why }, where));
            host.logger.warn(`scheduled embed for channel ${item.channelId} was not posted and was dropped (${w.why}). Check the channel, then book it again.`);
            continue;
          }
          if (msg && msg.id) {
            remember({
              messageId: String(msg.id), channelId: item.channelId, channelName: bareName(item.channelName),
              title: item.title, sentAt: Date.now(), editedAt: null, scheduled: true, data: item.data,
            });
          }
          record(Object.assign({ kind: 'scheduled', ok: true, messageId: msg && msg.id ? String(msg.id) : '' }, where));
          host.logger.info(`scheduled embed sent to ${item.channelId}`);
        } catch (e) {
          record(Object.assign({ kind: 'scheduled', ok: false, code: 'post_failed', why: String(e.message || '') }, where));
          host.logger.error(`scheduled embed failed (${item.title || item.id}): ${e.message}`);
        }
      }
    }
    host.schedule.every(60000, schedulePass);

    host.routes.get('/history', (req, res) => res.json(history()));
    host.routes.post('/history/clear', (req, res) => { host.store.set('history', []); res.json({ ok: true }); });

    // The guild's own emoji, in the <:name:id> form Discord needs inside message text.
    host.routes.get('/emojis', async (req, res) => {
      const c = host.discord.client();
      if (!c) return res.json([]);
      try {
        const g = c.guilds.cache.first();
        if (!g) return res.json([]);
        const all = await g.emojis.fetch();
        const out = [];
        all.forEach((e) => out.push({
          name: e.name, id: e.id, animated: !!e.animated,
          text: (e.animated ? '<a:' : '<:') + e.name + ':' + e.id + '>',
          url: e.imageURL ? e.imageURL({ size: 64 }) : null,
        }));
        out.sort((a, b) => a.name.localeCompare(b.name));
        res.json(out);
      } catch (e) { res.json([]); }
    });

    host.routes.get('/templates', (req, res) => res.json(host.store.get('templates', {})));
    host.routes.post('/templates', (req, res) => {
      const b = req.body || {};
      if (!b.name || typeof b.name !== 'string' || !b.name.trim()) return res.status(400).json({ error: 'no_name', reason: 'the template has no name' });
      // A key that is a property of every object would land on the store's own prototype instead.
      if (b.name === '__proto__' || b.name === 'constructor' || b.name === 'prototype') return res.status(400).json({ error: 'bad_name', reason: 'that name cannot be used for a template' });
      const t = host.store.get('templates', {}); t[b.name] = b.data || {}; host.store.set('templates', t);
      res.json({ ok: true });
    });
    // One name, or `names` for the ticked rows of a bulk delete.
    host.routes.post('/templates/delete', (req, res) => {
      const b = req.body || {}; const t = host.store.get('templates', {});
      const names = Array.isArray(b.names) ? b.names.map(String) : [b.name];
      let removed = 0;
      for (const n of names) if (n != null && Object.prototype.hasOwnProperty.call(t, n)) { delete t[n]; removed++; }
      host.store.set('templates', t);
      res.json({ ok: true, removed });
    });

    // The styler half — same host, so its routes land on this plugin's API base and its
    // `server-data` service is visible to the editor's own /tokens route. Failing to load it must
    // not take the editor down with it: writing a message is the more basic of the two jobs.
    let stylerUp = true;
    try {
      await require('./styler').register(host, shared);
    } catch (e) {
      stylerUp = false;
      host.logger.error('embed styling half failed to start: ' + e.message);
    }

    // ── Settings screen ─────────────────────────────────────────────────────────────────────
    // Complete with the server stopped and the bot offline: nothing here asks either.
    host.routes.get('/settings', (req, res) => {
      res.json({ ok: true, settings: settings(), defaults: DEFAULTS, ranges: RANGES });
    });
    host.routes.post('/settings', (req, res) => {
      try {
        const body = (req.body && typeof req.body === 'object') ? (req.body.settings && typeof req.body.settings === 'object' ? req.body.settings : req.body) : {};
        const stored = (host.config && typeof host.config.get === 'function') ? (host.config.get() || {}) : {};
        // Keys this version does not know stay where they are rather than being dropped.
        const next = Object.assign({}, overlaySettings(stored, body), normalizeSettings(overlaySettings(stored, body)));
        host.config.set(next);
        const now = settings();
        if (activity.length > now.activity.max) { activity.length = now.activity.max; activityDirty = true; }
        res.json({ ok: true, settings: now });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── Activity screen ─────────────────────────────────────────────────────────────────────
    host.routes.get('/activity', (req, res) => {
      const day = Date.now() - 86400000;
      res.json({
        ok: true, items: activity, max: settings().activity.max,
        counts: { total: activity.length, failed: activity.filter((a) => !a.ok).length, failedToday: activity.filter((a) => !a.ok && a.at >= day).length },
      });
    });
    host.routes.post('/activity/clear', (req, res) => { activity = []; activityDirty = true; flushActivity(); res.json({ ok: true }); });

    // ── the header every screen draws: is the bot there, is the game running, what is going on ──
    host.routes.get('/status', async (req, res) => {
      const s = settings();
      const c = botClient();
      const bot = { connected: !!c, ready: botUp(), tag: '', guild: null, channels: null };
      try {
        if (c && c.user) bot.tag = String(c.user.tag || c.user.username || '');
        const g = c && c.guilds && c.guilds.cache && typeof c.guilds.cache.first === 'function' ? c.guilds.cache.first() : null;
        if (g) {
          bot.guild = { id: String(g.id), name: String(g.name || '') };
          try { if (g.channels && g.channels.cache) bot.channels = g.channels.cache.filter((ch) => ch && ch.type === 0).size; } catch (e) { bot.channels = null; }
        }
      } catch (e) { /* a half-started client answers what it has */ }
      let serverRunning = null;
      try { if (host.server && typeof host.server.isRunning === 'function') serverRunning = !!host.server.isRunning(); } catch (e) { serverRunning = null; }
      const sch = scheduled();
      const now = Date.now();
      const day = now - 86400000;
      let live = [];
      try { live = typeof shared.liveStatus === 'function' ? (shared.liveStatus() || []) : []; } catch (e) { live = []; }
      let styling = { enabledKinds: 0, kinds: {} };
      try { if (typeof shared.styleStats === 'function') styling = shared.styleStats() || styling; } catch (e) { /* counters optional */ }
      let templates = 0;
      try { templates = Object.keys(host.store.get('templates', {}) || {}).length; } catch (e) { templates = 0; }
      res.json({
        ok: true,
        serverRunning,
        bot,
        stylerUp,
        switches: { styling: s.styling.enabled, liveEmbeds: s.liveEmbeds.enabled, clickActions: s.clickActions.enabled, scheduler: s.scheduler.enabled },
        counts: {
          history: history().length, scheduled: sch.length, scheduledDue: sch.filter((x) => x.at <= now).length,
          templates, custom: live.length, customActive: live.filter((x) => x.enabled).length,
          customFailing: live.filter((x) => x.enabled && x.ok === false).length,
          styled: styling.enabledKinds || 0,
          failedToday: activity.filter((a) => !a.ok && a.at >= day).length,
        },
        scheduler: {
          next: sch.length ? sch.reduce((m, x) => Math.min(m, x.at), Infinity) : null,
          waitingForBot: schedState.waitingForBot, paused: !s.scheduler.enabled, lastPassAt: schedState.lastPassAt || null,
        },
        live,
        styling,
      });
    });

    host.logger.info('Discord Embeds ready (editor + styler)');
  },
};
