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
    count: 10 // desktop shows up to 10 in the scroll row; mobile slices this down to 6
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

// Personalized per signed-in user via Tautulli's user_id filter — Tautulli uses
// the Plex account id directly as its own user_id, so no separate mapping is
// needed (verified against real data). History can contain multiple rows for
// the same item (resumed sessions, rewatches), so this dedupes by rating_key,
// keeping only the most recent (get_history is already newest-first).
router.get('/recently-watched', requireAuth, async (req, res) => {
  try {
    const { data } = await axios.get(`${process.env.TAUTULLI_URL}/api/v2`, {
      params: {
        apikey: process.env.TAUTULLI_API_KEY,
        cmd: 'get_history',
        user_id: req.session.user.id,
        length: 40,
        order_column: 'date',
        order_dir: 'desc'
      }
    });
    const rows = data.response.data.data || [];
    const seen = new Set();
    const items = [];
    for (const r of rows) {
      if (seen.has(r.rating_key)) continue;
      seen.add(r.rating_key);
      items.push({
        ratingKey: r.rating_key,
        title: r.grandparent_title ? `${r.grandparent_title} — S${r.parent_media_index}E${r.media_index}` : r.title,
        thumb: imageUrl(r.thumb),
        progress: Math.round(r.percent_complete) || 0,
        finished: r.watched_status >= 1,
        watchedAt: Number(r.stopped || r.date) * 1000
      });
      if (items.length >= 15) break;
    }
    res.json(items);
  } catch (err) {
    console.error('tautulli recently-watched error:', err.code || err.response?.status, err.message);
    res.status(502).json({ error: 'Could not reach Tautulli' });
  }
});

// get_history doesn't include a synopsis, unlike get_recently_added/get_activity —
// fetched on demand (only when a Recently Watched row is actually clicked) rather
// than upfront for the whole list.
router.get('/metadata/:ratingKey', requireAuth, async (req, res) => {
  try {
    const { data } = await axios.get(`${process.env.TAUTULLI_URL}/api/v2`, {
      params: { apikey: process.env.TAUTULLI_API_KEY, cmd: 'get_metadata', rating_key: req.params.ratingKey }
    });
    res.json({ overview: data.response.data?.summary || '' });
  } catch (err) {
    console.error('tautulli metadata error:', err.code || err.response?.status, err.message);
    res.status(502).json({ error: 'Could not reach Tautulli' });
  }
});

// Rolling 30-day leaderboard, top 3 (gold/silver/bronze) each: viewer, movie, TV
// show, anime. Tautulli's top_tv stat combines every "show"-type library
// together, so TV and Anime are split out here by section_id rather than two
// separate calls. Anime gets its own wider 90-day/larger-pool call — it's much
// lower-volume than regular TV, so a 30-day top-20 combined list usually
// surfaces only one anime title (regular TV dominates the shared ranking).
router.get('/top-of-month', requireAuth, async (req, res) => {
  try {
    const homeStats = (timeRange, statsCount) => axios.get(`${process.env.TAUTULLI_URL}/api/v2`, {
      params: { apikey: process.env.TAUTULLI_API_KEY, cmd: 'get_home_stats', time_range: timeRange, stats_type: 'plays', stats_count: statsCount }
    });
    const [main, animeExtended] = await Promise.all([homeStats(30, 20), homeStats(90, 50)]);
    const rowsFor = (payload, statId) => (payload.data.response.data || []).find(s => s.stat_id === statId)?.rows || [];
    const { TAUTULLI_SECTION_TV, TAUTULLI_SECTION_ANIME } = process.env;

    const tvRows = rowsFor(main, 'top_tv');
    const topTv = (TAUTULLI_SECTION_TV
      ? tvRows.filter(r => String(r.section_id) === TAUTULLI_SECTION_TV)
      : tvRows
    ).slice(0, 3);
    const animeRows = rowsFor(animeExtended, 'top_tv');
    const topAnime = (TAUTULLI_SECTION_ANIME
      ? animeRows.filter(r => String(r.section_id) === TAUTULLI_SECTION_ANIME)
      : []
    ).slice(0, 3);
    const topMovies = rowsFor(main, 'top_movies').slice(0, 3);
    const topUsers = rowsFor(main, 'top_users').slice(0, 3);

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
