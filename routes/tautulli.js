const express = require('express');
const axios = require('axios');
const requireAuth = require('./requireAuth');
const nowPlaying = require('../lib/nowPlaying');
const { imageUrl } = require('../lib/plexImage');
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

// Served from the shared now-playing cache (see lib/nowPlaying.js) rather than
// hitting Tautulli directly — it's kept fresh by Plex's own push notifications,
// so this is both instant and just as current.
router.get('/now-playing', requireAuth, (req, res) => {
  res.json(nowPlaying.getSnapshot());
});

// Live updates: an initial "full" event on connect, then "full" (session added/
// removed) or "update" (progress/state change on an existing session) events as
// they happen — no polling on the client.
router.get('/now-playing/stream', requireAuth, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  nowPlaying.addClient(res);
  req.on('close', () => nowPlaying.removeClient(res));
});

async function fetchRecentlyAdded(sectionId) {
  const params = {
    apikey: process.env.TAUTULLI_API_KEY,
    cmd: 'get_recently_added',
    count: 6
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
    // For episodes, show the series poster (grandparent_thumb) rather than the
    // individual episode still — matches what a "recently added" grid should read as.
    thumb: imageUrl(i.grandparent_thumb || i.thumb)
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

// Rolling 30-day leaderboard, top 3 (gold/silver/bronze) each: viewer, movie, TV
// show, anime. Tautulli's top_tv stat combines every "show"-type library
// together, so TV and Anime are split out here by section_id from that same
// result rather than two separate API calls.
router.get('/top-of-month', requireAuth, async (req, res) => {
  try {
    const { data } = await axios.get(`${process.env.TAUTULLI_URL}/api/v2`, {
      params: { apikey: process.env.TAUTULLI_API_KEY, cmd: 'get_home_stats', time_range: 30, stats_type: 'plays', stats_count: 20 }
    });
    const stats = data.response.data || [];
    const rowsFor = statId => stats.find(s => s.stat_id === statId)?.rows || [];
    const { TAUTULLI_SECTION_TV, TAUTULLI_SECTION_ANIME } = process.env;

    const tvRows = rowsFor('top_tv');
    const topTv = (TAUTULLI_SECTION_TV
      ? tvRows.filter(r => String(r.section_id) === TAUTULLI_SECTION_TV)
      : tvRows
    ).slice(0, 3);
    const topAnime = (TAUTULLI_SECTION_ANIME
      ? tvRows.filter(r => String(r.section_id) === TAUTULLI_SECTION_ANIME)
      : []
    ).slice(0, 3);
    const topMovies = rowsFor('top_movies').slice(0, 3);
    const topUsers = rowsFor('top_users').slice(0, 3);

    res.json({
      user: topUsers.map(u => ({
        name: u.friendly_name || u.user,
        plays: u.total_plays,
        // Already a public plex.tv avatar URL — no proxying needed.
        avatar: u.user_thumb || null
      })),
      movie: topMovies.map(m => ({ title: m.title, plays: m.total_plays, thumb: imageUrl(m.thumb) })),
      tv: topTv.map(t => ({ title: t.title, plays: t.total_plays, thumb: imageUrl(t.thumb) })),
      anime: topAnime.map(t => ({ title: t.title, plays: t.total_plays, thumb: imageUrl(t.thumb) }))
    });
  } catch (err) {
    console.error('tautulli top-of-month error:', err.code || err.response?.status, err.message);
    res.status(502).json({ error: 'Could not reach Tautulli' });
  }
});

module.exports = router;
