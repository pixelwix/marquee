const express = require('express');
const axios = require('axios');
const requireAuth = require('./requireAuth');
const router = express.Router();

router.get('/now-playing', requireAuth, async (req, res) => {
  try {
    const { data } = await axios.get(`${process.env.PLEX_SERVER_URL}/status/sessions`, {
      headers: { 'X-Plex-Token': process.env.PLEX_ADMIN_TOKEN, Accept: 'application/json' }
    });
    const sessions = (data.MediaContainer.Metadata || []).map(s => ({
      title: s.grandparentTitle ? `${s.grandparentTitle} — ${s.title}` : s.title,
      subtitle: s.type === 'episode' ? `S${s.parentIndex}E${s.index}` : s.year,
      overview: s.summary || '',
      user: s.User?.title,
      thumb: s.thumb ? `/api/plex/image?path=${encodeURIComponent(s.thumb)}` : null,
      art: (s.grandparentArt || s.art) ? `/api/plex/image?path=${encodeURIComponent(s.grandparentArt || s.art)}` : null,
      progress: s.viewOffset && s.duration ? Math.round((s.viewOffset / s.duration) * 100) : 0,
      state: s.Player?.state, // playing | paused | buffering
      quality: s.Media?.[0]?.videoResolution
    }));
    res.json(sessions);
  } catch (err) {
    console.error('plex now-playing error:', err.code || err.response?.status, err.message);
    res.status(502).json({ error: 'Could not reach Plex server' });
  }
});

// Only actual Plex thumb/art paths are allowed through — anything else could be used
// to make arbitrary authenticated GET requests to the Plex server with the admin token.
const IMAGE_PATH_RE = /^\/library\/metadata\/\d+\/(thumb|art)\/\d+$/;

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
