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

function buildComponents(host, buttons) {
  if (!Array.isArray(buttons) || !buttons.length) return [];
  const { ButtonBuilder, ButtonStyle } = host.discord.js;
  const rows = [];
  for (let i = 0; i < buttons.length && rows.length < 5; i += 5) {
    const slice = buttons.slice(i, i + 5).map((b, j) => {
      const bb = new ButtonBuilder();
      const style = b.style || (b.url ? ButtonStyle.Link : ButtonStyle.Primary);
      bb.setStyle(style).setLabel(clean(b.label) || 'Button');
      if (style === ButtonStyle.Link) bb.setURL(clean(b.url) || 'https://scumsa.com');
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
      components: (buttons) => buildComponents(host, buttons),
      async send(channelId, json, buttons) {
        const payload = { embeds: [host.discord.js.EmbedBuilder.from(toApiEmbed(json))] };
        const comps = buildComponents(host, buttons); if (comps.length) payload.components = comps;
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

    host.routes.post('/send', async (req, res) => {
      const b = req.body || {};
      if (!b.channelId) return res.status(400).json({ error: 'no channel' });
      try {
        const payload = { embeds: [host.discord.js.EmbedBuilder.from(toApiEmbed(b.embed))] };
        const comps = buildComponents(host, b.buttons); if (comps.length) payload.components = comps;
        const ok = await host.discord.send(b.channelId, payload);
        res.json({ ok: !!ok });
      } catch (e) { res.status(500).json({ error: e.message }); }
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

    host.logger.info('Discord Embed Editor ready');
  },
};
