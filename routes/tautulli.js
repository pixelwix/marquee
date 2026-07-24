const express = require('express');
const axios = require('axios');
const requireAuth = require('./requireAuth');
const router = express.Router();

// Helper: lists every Plex library Tautulli knows about, with its section_id.
// Hit this once to find the IDs you need for TAUTULLI_SECTION_* in .env.
router.get('/libraries', requireAuth, async (req, res) => {
  try {
    const { data } = await axios.get(`${process.env.TAUTULLI_URL}/api/v2`, {
      params: { apikey: process.env.TAUTULLI_API_KEY, cmd: 'get_libraries' }
    });
    const libraries = (data.response.data || []).map(l => ({
      sectionId: l.section_id,
      name: l.section_name,
      type: l.section_type // movie | show | artist | photo
    }));
    res.json(libraries);
  } catch (err) {
    console.error('tautulli libraries error:', err.code || err.response?.status, err.message);
    res.status(502).json({ error: 'Could not reach Tautulli' });
  }
});

async function fetchRecentlyAdded(sectionId) {
  const params = {
    apikey: process.env.TAUTULLI_API_KEY,
    cmd: 'get_recently_added',
    count: 12
  };
  if (sectionId) params.section_id = sectionId;
  const { data } = await axios.get(`${process.env.TAUTULLI_URL}/api/v2`, { params });
  return (data.response.data.recently_added || []).map(i => ({
    title: i.grandparent_title
      ? `${i.grandparent_title} — S${i.parent_media_index}E${i.media_index}`
      : i.title,
    year: i.year,
    type: i.media_type,
    overview: i.summary || '',
    addedAt: Number(i.added_at) * 1000,
    thumb: i.thumb ? `/api/plex/image?path=${encodeURIComponent(i.thumb)}` : null
  }));
}

router.get('/recently-added', requireAuth, async (req, res) => {
  const { TAUTULLI_SECTION_MOVIES, TAUTULLI_SECTION_TV, TAUTULLI_SECTION_ANIME } = process.env;
  try {
    // If none of the section env vars are set, fall back to one combined list
    // (original behavior) so this doesn't break an existing setup.
    if (!TAUTULLI_SECTION_MOVIES && !TAUTULLI_SECTION_TV && !TAUTULLI_SECTION_ANIME) {
      const all = await fetchRecentlyAdded();
      return res.json({ all });
    }

    const [movies, tv, anime] = await Promise.all([
      TAUTULLI_SECTION_MOVIES ? fetchRecentlyAdded(TAUTULLI_SECTION_MOVIES) : [],
      TAUTULLI_SECTION_TV ? fetchRecentlyAdded(TAUTULLI_SECTION_TV) : [],
      TAUTULLI_SECTION_ANIME ? fetchRecentlyAdded(TAUTULLI_SECTION_ANIME) : []
    ]);
    res.json({ movies, tv, anime });
  } catch (err) {
    console.error('tautulli error:', err.code || err.response?.status, err.message);
    res.status(502).json({ error: 'Could not reach Tautulli' });
  }
});

module.exports = router;
