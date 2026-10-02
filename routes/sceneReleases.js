const express = require('express');
const axios = require('axios');
const requireAuth = require('./requireAuth');
const { loadItems, findTrackedMatch } = require('../lib/sceneReleases');
const router = express.Router();

// lib/sceneReleases.js polls the feed and writes this file in-process (see
// server.js's require('./lib/sceneReleases').start()) — this route serves
// whatever's currently stored, annotated with whether Radarr already has
// each movie so the admin panel can show "Request" vs "Search" without a
// live TMDB lookup per release.
router.get('/', requireAuth, async (req, res) => {
  const items = loadItems();
  try {
    const { data: radarrMovies } = await axios.get(`${process.env.RADARR_URL}/api/v3/movie`, {
      headers: { 'X-Api-Key': process.env.RADARR_API_KEY },
    });
    res.json(items.map((item) => {
      const match = findTrackedMatch(item.cleanTitle, item.year, radarrMovies);
      return { ...item, tracked: !!match, tmdbId: match?.tmdbId ?? null };
    }));
  } catch (err) {
    console.error('scene-releases tracked-status lookup error:', err.code || err.response?.status, err.message);
    // Radarr being briefly unreachable shouldn't take the whole panel down —
    // fall back to un-annotated items, same non-fatal-degrade spirit as the
    // rest of this app's admin panels.
    res.json(items.map((item) => ({ ...item, tracked: null, tmdbId: null })));
  }
});

module.exports = router;
