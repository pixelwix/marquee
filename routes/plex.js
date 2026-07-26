const express = require('express');
const axios = require('axios');
const requireAuth = require('./requireAuth');
const { imageUrl } = require('../lib/plexImage');
const router = express.Router();

// Only actual Plex thumb/art paths are allowed through — anything else could be used
// to make arbitrary authenticated GET requests to the Plex server with the admin token.
const IMAGE_PATH_RE = /^\/library\/metadata\/\d+\/(thumb|art)\/\d+$/;

// Searches the actual Plex library (not TMDB/Overseerr) — used by "Report an
// issue" to find a specific already-in-library movie/episode to report on,
// as opposed to the request flow's search which is about things you don't
// have yet. Read-only, so the admin token is fine here (same reasoning as
// Overseerr's search staying on its own admin-key client).
router.get('/search', requireAuth, async (req, res) => {
  try {
    const { data } = await axios.get(`${process.env.PLEX_SERVER_URL}/hubs/search`, {
      headers: { Accept: 'application/json' },
      params: { query: req.query.q, limit: 8, 'X-Plex-Token': process.env.PLEX_ADMIN_TOKEN }
    });
    const hubs = data.MediaContainer.Hub || [];
    const results = [];
    for (const hub of hubs) {
      if (hub.type !== 'movie' && hub.type !== 'show') continue;
      for (const m of hub.Metadata || []) {
        results.push({ ratingKey: m.ratingKey, title: m.title, year: m.year, type: hub.type, thumb: imageUrl(m.thumb) });
      }
    }
    res.json(results);
  } catch (err) {
    console.error('plex search error', err.code || err.response?.status, err.message);
    res.status(502).json({ error: 'Could not reach Plex' });
  }
});

// Generic parent->children listing: a show's ratingKey returns its seasons, a
// season's ratingKey returns its episodes — same endpoint either way, so the
// frontend can drill down (show -> season -> episode) without needing to know
// which level it's at.
router.get('/children/:ratingKey', requireAuth, async (req, res) => {
  if (!/^\d+$/.test(req.params.ratingKey)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { data } = await axios.get(`${process.env.PLEX_SERVER_URL}/library/metadata/${req.params.ratingKey}/children`, {
      headers: { Accept: 'application/json' },
      params: { 'X-Plex-Token': process.env.PLEX_ADMIN_TOKEN }
    });
    const items = (data.MediaContainer.Metadata || []).map(m => ({
      ratingKey: m.ratingKey,
      title: m.title,
      type: m.type, // 'season' | 'episode'
      index: m.index,
      thumb: imageUrl(m.thumb)
    }));
    res.json(items);
  } catch (err) {
    console.error('plex children error', err.code || err.response?.status, err.message);
    res.status(502).json({ error: 'Could not reach Plex' });
  }
});

// Proxies Plex thumbnail images so we don't expose the admin token to the browser
router.get('/image', requireAuth, async (req, res) => {
  if (!IMAGE_PATH_RE.test(req.query.path || '')) {
    return res.status(400).end();
  }
  try {
    const { data, headers } = await axios.get(`${process.env.PLEX_SERVER_URL}${req.query.path}`, {
      headers: { 'X-Plex-Token': process.env.PLEX_ADMIN_TOKEN },
      responseType: 'arraybuffer'
    });
    res.set('Content-Type', headers['content-type']);
    res.send(data);
  } catch (err) {
    res.status(502).end();
  }
});

module.exports = router;
