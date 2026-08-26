'use strict';

// Discord Embed Editor — backend. Turns the editor's JSON into a discord.js embed + button rows,
// lists channels for the picker, sends embeds, and stores named templates. Also exposes a reusable
// service so any other plugin can build/send an editor embed: host.consume('embed-editor').

function clean(v) { return (typeof v === 'string' && v.trim() !== '') ? v : undefined; }

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
  return e;
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
      bb.setStyle(style).setLabel(clean(b.label) || 'Button');
      if (String(style) === String(ButtonStyle.Link)) bb.setURL(clean(b.url) || 'https://scumsa.com');
      else bb.setCustomId(clean(b.custom_id) || clean(b.customId) || ('btn_' + (i + j)));
      if (clean(b.emoji)) { try { bb.setEmoji(b.emoji); } catch { /* invalid emoji */ } }
      if (b.disabled) bb.setDisabled(true);
      return bb;
    });
    rows.push(host.discord.row(...slice));
  }
  return rows;
}

module.exports = {
  async register(host) {
    // Reusable service for OTHER plugins.
    host.provide('embed-editor', {
      apiEmbed: (json) => toApiEmbed(json),
      embed: (json) => host.discord.js.EmbedBuilder.from(toApiEmbed(json)),
      components: (buttons, selects) => buildComponents(host, buttons, selects),
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

    // Everything the editor has sent, newest first. Keeping the message id is what makes editing
    // an already-posted message possible at all — without it a "sent" embed is unreachable.
    const HISTORY_MAX = 100;
    const history = () => host.store.get('history', []);
    function remember(entry) {
      const list = history();
      list.unshift(entry);
      host.store.set('history', list.slice(0, HISTORY_MAX));
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

    function buildPayload(b) {
      const list = [b.embed].concat(Array.isArray(b.extraEmbeds) ? b.extraEmbeds : [])
        .filter((e) => e && typeof e === 'object')
        .slice(0, EMBED_MAX);
      const payload = { embeds: list.map((e) => host.discord.js.EmbedBuilder.from(toApiEmbed(resolveEmbed(e)))) };
      // Plain text above the embed — Discord allows it and people use it for pings.
      //
      // ALWAYS set, empty included, for the same reason the components below are: an edit leaves out
      // what the payload leaves out, so sending nothing when the box was cleared meant deleting the
      // text in the editor did nothing to the message. The components already knew this; the text
      // did not, and the two behaved differently on the same Save.
      payload.content = clean(b.content) ? resolveText(b.content) : '';
      // Always set, so an edit that REMOVES a button or a select actually removes it.
      payload.components = buildComponents(host, b.buttons, b.selects);
      return payload;
    }

    host.routes.post('/send', async (req, res) => {
      const b = req.body || {};
      if (!b.channelId) return res.status(400).json({ error: 'no channel' });
      try {
        const msg = await host.discord.send(b.channelId, buildPayload(b));
        if (!msg) return res.json({ ok: false, error: 'send failed' });
        const id = msg && msg.id ? String(msg.id) : null;
        if (id) {
          remember({
            messageId: id, channelId: String(b.channelId),
            channelName: b.channelName || '', title: (b.embed && b.embed.title) || '',
            sentAt: Date.now(), editedAt: null,
            data: messageData(b),
          });
        }
        res.json({ ok: true, messageId: id });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Rewrite a message the editor sent earlier, in place.
    host.routes.post('/edit', async (req, res) => {
      const b = req.body || {};
      if (!b.channelId || !b.messageId) return res.status(400).json({ error: 'no message' });
      try {
        const ch = await host.discord.channel(b.channelId);
        if (!ch || !ch.messages) return res.status(404).json({ error: 'channel not found' });
        const msg = await ch.messages.fetch(String(b.messageId)).catch(() => null);
        // A message deleted in Discord is the common case here, and "not found" is the honest answer —
        // silently re-sending it somewhere would be worse than failing.
        if (!msg) return res.status(404).json({ error: 'message not found — it may have been deleted' });
        if (!msg.editable) return res.status(403).json({ error: 'that message was not posted by this bot' });
        await msg.edit(buildPayload(b));
        const list = history();
        const hit = list.find((x) => x.messageId === String(b.messageId));
        if (hit) {
          hit.editedAt = Date.now();
          hit.title = (b.embed && b.embed.title) || hit.title;
          hit.data = messageData(b);
          host.store.set('history', list);
        }
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    host.routes.post('/delete', async (req, res) => {
      const b = req.body || {};
      try {
        if (b.channelId && b.messageId) {
          const ch = await host.discord.channel(b.channelId);
          const msg = ch && ch.messages ? await ch.messages.fetch(String(b.messageId)).catch(() => null) : null;
          if (msg) await msg.delete().catch(() => {});
        }
        // Drop it from the list whether or not the message was still there — the entry is about a
        // message that no longer exists either way.
        host.store.set('history', history().filter((x) => x.messageId !== String(b.messageId)));
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
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
      if (!b.channelId || !b.messageId) return res.status(400).json({ error: 'need a channel and message id' });
      try {
        const ch = await host.discord.channel(b.channelId);
        if (!ch || !ch.messages) return res.status(404).json({ error: 'channel not found (or the bot cannot see it)' });
        const msg = await ch.messages.fetch(String(b.messageId)).catch(() => null);
        if (!msg) return res.status(404).json({ error: 'message not found in that channel' });
        // Only our own messages can be edited later, so say so now rather than after the rewrite.
        if (!msg.editable) return res.status(403).json({ error: 'that message was not posted by this bot, so it cannot be edited' });
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
        res.json({ ok: true, embed, content: msg.content || '', channelId: String(b.channelId), messageId: String(b.messageId), sentAt: msg.createdTimestamp || Date.now() });
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
      if (!b.channelId) return res.status(400).json({ error: 'no channel' });
      if (!Number.isFinite(at)) return res.status(400).json({ error: 'no time' });
      // A past time would fire on the very next tick, which is never what someone meant to book.
      if (at < Date.now() - 60000) return res.status(400).json({ error: 'that time is in the past' });
      const list = scheduled();
      list.push({
        id: 'sch_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
        at, channelId: String(b.channelId), channelName: b.channelName || '',
        title: (b.embed && b.embed.title) || '',
        data: messageData(b),
      });
      list.sort((x, y) => x.at - y.at);
      saveScheduled(list);
      res.json({ ok: true });
    });

    host.routes.post('/scheduled/delete', (req, res) => {
      const id = String((req.body || {}).id || '');
      saveScheduled(scheduled().filter((x) => x.id !== id));
      res.json({ ok: true });
    });

    // One pass a minute. Anything already due when the manager starts goes out on the first pass —
    // late is better than never for an announcement, and the list shows when it actually went.
    host.schedule.every(60000, async () => {
      const now = Date.now();
      const list = scheduled();
      const due = list.filter((x) => x.at <= now);
      if (!due.length) return;
      // Drop them from the queue FIRST: if the send throws, a retry loop that posts the same
      // announcement every minute would be worse than losing it once, and the log says what failed.
      saveScheduled(list.filter((x) => x.at > now));
      for (const item of due) {
        try {
          const msg = await host.discord.send(item.channelId, buildPayload(item.data));
          if (msg && msg.id) {
            remember({
              messageId: String(msg.id), channelId: item.channelId, channelName: item.channelName,
              title: item.title, sentAt: Date.now(), editedAt: null, scheduled: true, data: item.data,
            });
          }
          host.logger.info(`scheduled embed sent to ${item.channelId}`);
        } catch (e) {
          host.logger.error(`scheduled embed failed (${item.title || item.id}): ${e.message}`);
        }
      }
    });

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
      if (!b.name || typeof b.name !== 'string') return res.status(400).json({ error: 'no name' });
      const t = host.store.get('templates', {}); t[b.name] = b.data || {}; host.store.set('templates', t);
      res.json({ ok: true });
    });
    host.routes.post('/templates/delete', (req, res) => {
      const b = req.body || {}; const t = host.store.get('templates', {}); delete t[b.name]; host.store.set('templates', t);
      res.json({ ok: true });
    });

    // The styler half — same host, so its routes land on this plugin's API base and its
    // `server-data` service is visible to the editor's own /tokens route. Failing to load it must
    // not take the editor down with it: writing a message is the more basic of the two jobs.
    try {
      await require('./styler').register(host);
    } catch (e) {
      host.logger.error('embed styling half failed to start: ' + e.message);
    }

    host.logger.info('Discord Embeds ready (editor + styler)');
  },
};
