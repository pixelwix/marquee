const express = require('express');
const requireAuth = require('./requireAuth');
const abs = require('../lib/absClient');
const router = express.Router();

// Books row in Recently Added. { configured: false } (not an error) when ABS
// isn't set up, so the dashboard just leaves the row out.
router.get('/recently-added', requireAuth, async (req, res) => {
  if (!abs.isConfigured()) return res.json({ configured: false, items: [] });
  try {
    res.json({ configured: true, items: await abs.fetchRecentlyAdded() });
  } catch (err) {
    console.error('audiobookshelf error:', err.code || err.response?.status, err.message);
    res.status(502).json({ error: 'Could not reach Audiobookshelf' });
  }
});

// Covers go through Marquee because ABS_URL is LAN-only — family members
// outside the house couldn't load them directly.
router.get('/cover/:id', requireAuth, async (req, res) => {
  if (!abs.isConfigured()) return res.status(404).end();
  if (!abs.ITEM_ID_RE.test(req.params.id)) return res.status(400).end();
  try {
    const { buffer, contentType } = await abs.fetchCover(req.params.id);
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'private, max-age=86400');
    res.send(buffer);
  } catch (err) {
    res.status(err.response?.status === 404 ? 404 : 502).end();
  }
});

module.exports = router;
