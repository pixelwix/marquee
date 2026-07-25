const express = require('express');
const axios = require('axios');
const requireAuth = require('./requireAuth');
const router = express.Router();

// Uses the signed-in user's own Plex token (not the admin token) so each family
// member sees their own in-progress/up-next list, not the server owner's.
router.get('/on-deck', requireAuth, async (req, res) => {
  try {
    const { data } = await axios.get(`${process.env.PLEX_SERVER_URL}/library/onDeck`, {
      headers: { 'X-Plex-Token': req.session.user.plexToken, Accept: 'application/json' }
    });
    const items = (data.MediaContainer.Metadata || []).map(i => ({
      title: i.grandparentTitle || i.title,
      subtitle: i.type === 'episode' ? `S${i.parentIndex}E${i.index}` : i.year,
      episodeTitle: i.type === 'episode' ? i.title : null,
      overview: i.summary || '',
      // For episodes, show the series poster (grandparentThumb) rather than the
      // individual episode still.
      thumb: (i.grandparentThumb || i.thumb) ? `/api/plex/image?path=${encodeURIComponent(i.grandparentThumb || i.thumb)}` : null,
      art: (i.grandparentArt || i.art) ? `/api/plex/image?path=${encodeURIComponent(i.grandparentArt || i.art)}` : null,
      progress: i.viewOffset && i.duration ? Math.round((i.viewOffset / i.duration) * 100) : 0
    }));
    res.json(items);
  } catch (err) {
    console.error('plex on-deck error:', err.code || err.response?.status, err.message);
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
