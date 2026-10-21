const axios = require('axios');

// Audiobookshelf (the family's audiobook server) — read-only. Used by the
// Books row in Recently Added. Needs ABS_URL (LAN address Marquee can reach),
// ABS_API_KEY (an ABS API key for a read-only user) and ABS_LIBRARY_ID;
// ABS_PUBLIC_URL is where the "Listen" button sends people (the public
// hostname, since ABS_URL is LAN-only). Without the first three the feature
// stays hidden instead of erroring.
const CACHE_MS = 5 * 60 * 1000;
const ITEM_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCED = /dramati[sz]ed|full[- ]?cast|graphic ?audio|audio drama/i;

function isProduced(title, narrator) {
  if (PRODUCED.test(title || '')) return true;
  const count = (narrator || '').split(',').filter(s => s.trim()).length;
  return count >= 4;
}

let cache = { at: 0, items: null };
let libCache = { at: 0, items: null };

function isConfigured() {
  return !!(process.env.ABS_URL && process.env.ABS_API_KEY && process.env.ABS_LIBRARY_ID);
}

// ABS descriptions are publisher HTML (<p>, <b>, <br />, entities) — the info
// card renders plain text, so tags become spaces and the common entities are
// decoded.
function plainText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// One minified ABS library item (GET /api/libraries/:id/items?minified=1) ->
// what the dashboard needs. Duration is seconds in ABS; shown as hours.
function mapItem(item, publicUrl) {
  const media = item.media || {};
  const md = media.metadata || {};
  const base = (publicUrl || '').replace(/\/+$/, '');
  return {
    id: item.id,
    title: md.title || 'Untitled',
    author: md.authorName || '',
    narrator: md.narratorName || '',
    series: md.seriesName || '',
    year: md.publishedYear || '',
    hours: media.duration ? Math.round(media.duration / 360) / 10 : null,
    overview: plainText(md.description),
    addedAt: item.addedAt || null, // epoch ms, same as Tautulli's rows (timeAgo takes either)
    cover: media.coverPath ? `/api/audiobooks/cover/${item.id}` : null,
    link: base ? `${base}/item/${item.id}` : null,
    produced: isProduced(md.title, md.narratorName)
  };
}

async function fetchRecentlyAdded(limit = 10) {
  if (cache.items && Date.now() - cache.at < CACHE_MS) return cache.items;
  const { data } = await axios.get(`${process.env.ABS_URL}/api/libraries/${process.env.ABS_LIBRARY_ID}/items`, {
    params: { sort: 'addedAt', desc: 1, limit, minified: 1 },
    headers: { Authorization: `Bearer ${process.env.ABS_API_KEY}` },
    timeout: 10000
  });
  const items = (data.results || [])
    .filter(i => !i.isMissing && !i.isInvalid)
    .map(i => mapItem(i, process.env.ABS_PUBLIC_URL));
  cache = { at: Date.now(), items };
  return items;
}

async function fetchCover(id) {
  if (!ITEM_ID_RE.test(id)) throw Object.assign(new Error('Invalid id'), { status: 400 });
  const { data, headers } = await axios.get(`${process.env.ABS_URL}/api/items/${id}/cover`, {
    params: { width: 400, format: 'jpeg' },
    headers: { Authorization: `Bearer ${process.env.ABS_API_KEY}` },
    responseType: 'arraybuffer',
    timeout: 10000
  });
  return { buffer: Buffer.from(data), contentType: headers['content-type'] || 'image/jpeg' };
}

// Every book in the library (minified), for suggestions: titles, authors, series, ASINs.
async function fetchLibrary() {
  if (libCache.items && Date.now() - libCache.at < CACHE_MS) return libCache.items;
  const { data } = await axios.get(`${process.env.ABS_URL}/api/libraries/${process.env.ABS_LIBRARY_ID}/items`, {
    params: { limit: 1000, minified: 1 },
    headers: { Authorization: `Bearer ${process.env.ABS_API_KEY}` },
    timeout: 20000
  });
  const items = (data.results || []).filter(i => !i.isMissing && !i.isInvalid).map(i => {
    const md = i.media?.metadata || {};
    return {
      title: md.title || '',
      author: md.authorName || '',
      narrator: md.narratorName || '',
      series: md.seriesName || '',
      asin: md.asin || '',
      produced: isProduced(md.title, md.narratorName)
    };
  });
  libCache = { at: Date.now(), items };
  return items;
}

function _resetCache() {
  cache = { at: 0, items: null };
  libCache = { at: 0, items: null };
}

module.exports = { isConfigured, plainText, mapItem, fetchRecentlyAdded, fetchLibrary, fetchCover, ITEM_ID_RE, PRODUCED, isProduced, _resetCache };
