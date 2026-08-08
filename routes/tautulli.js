const express = require('express');
const axios = require('axios');
const requireAuth = require('./requireAuth');
const nowPlaying = require('../lib/nowPlaying');
const { imageUrl } = require('../lib/plexImage');
const { computeStreak, computeTopWatched, computeRank, parseActivitySeries } = require('../lib/myStats');
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

// Tautulli logs a "newly added" event at whatever level Plex added it — a
// whole show, a whole season, or one episode at a time — so identifying
// "which show is this about" and "what's its poster" both depend on which of
// the three the row actually is.
function showIdentity(i) {
  if (i.media_type === 'episode') return { key: i.grandparent_rating_key, title: i.grandparent_title, thumb: i.grandparent_thumb };
  if (i.media_type === 'season') return { key: i.parent_rating_key, title: i.parent_title, thumb: i.parent_thumb };
  if (i.media_type === 'show') return { key: i.rating_key, title: i.title, thumb: i.thumb };
  return null; // movies aren't grouped
}
function seasonNumberFor(i) {
  if (i.media_type === 'episode') return i.parent_media_index;
  if (i.media_type === 'season') return i.media_index;
  return null;
}
function singleEventLabel(i) {
  if (i.media_type === 'episode') return `S${i.parent_media_index}E${i.media_index}`;
  if (i.media_type === 'season') return `Season ${i.media_index}`;
  return null;
}

async function fetchRecentlyAdded(sectionId) {
  const params = {
    apikey: process.env.TAUTULLI_API_KEY,
    cmd: 'get_recently_added',
    // Fetched well beyond the ~10 we'll display — grouping episodes of the same
    // show together (below) needs headroom, since a season-pack drop can
    // otherwise fill the whole raw feed with one show's episodes and crowd out
    // everything else before grouping gets a chance to help.
    count: 30
  };
  if (sectionId) params.section_id = sectionId;
  const { data } = await axios.get(`${process.env.TAUTULLI_URL}/api/v2`, { params });
  const rows = data.response.data.recently_added || [];

  // Groups every row belonging to the same show into one entry — a season
  // pack (or a backfill that logs a burst of individual episodes) collapses
  // into a single tile instead of flooding the row with one per episode.
  const groups = new Map();
  for (const i of rows) {
    const show = showIdentity(i);
    const key = show?.key || `solo-${i.rating_key}`;
    if (!groups.has(key)) {
      groups.set(key, {
        title: show ? show.title : i.title,
        thumb: imageUrl(show ? show.thumb : i.thumb),
        year: i.year,
        type: i.media_type,
        overview: i.summary || '',
        addedAt: Number(i.added_at) * 1000,
        singleLabel: singleEventLabel(i),
        seasons: new Set(),
        eventCount: 0
      });
    }
    const g = groups.get(key);
    g.addedAt = Math.max(g.addedAt, Number(i.added_at) * 1000);
    g.eventCount += 1;
    const seasonNum = seasonNumberFor(i);
    if (seasonNum) g.seasons.add(seasonNum);
  }

  const top = [...groups.entries()].slice(0, 10);
  return Promise.all(top.map(async ([key, g]) => {
    let title = g.title;
    if (g.eventCount === 1) {
      if (g.singleLabel) title = `${g.title} — ${g.singleLabel}`;
    } else {
      // Multiple rows collapsed together — name the season if they're all
      // from the same one, otherwise this spans a mixed batch.
      const seasons = [...g.seasons];
      title = seasons.length === 1 ? `${g.title} — Season ${seasons[0]}` : `${g.title} — new episodes`;
    }
    // A freshly-aired episode (or a season entry) often has no synopsis of
    // its own yet — Plex's metadata agent hasn't indexed one within hours of
    // airing, especially for anime. Same fallback Airing Today already uses
    // (episode overview -> series overview) rather than showing nothing.
    let overview = g.overview;
    if (!overview && !key.startsWith('solo-')) overview = await fetchSeriesSummary(key);
    return { title, year: g.year, type: g.type, overview, addedAt: g.addedAt, thumb: g.thumb };
  }));
}

async function fetchSeriesSummary(ratingKey) {
  try {
    const { data } = await axios.get(`${process.env.TAUTULLI_URL}/api/v2`, {
      params: { apikey: process.env.TAUTULLI_API_KEY, cmd: 'get_metadata', rating_key: ratingKey }
    });
    return data.response.data?.summary || '';
  } catch (e) {
    return '';
  }
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

// True calendar-month leaderboard, top 3 (gold/silver/bronze) each: viewer,
// movie, TV show, anime. Tautulli's time_range is "N days back from now", so
// month-to-date is just today's day-of-month number as that N — resets itself
// to 1 on the 1st and grows a day at a time from there, no separate rollover
// logic needed. Tautulli's top_tv stat combines every "show"-type library
// together, so TV and Anime are split out here by section_id rather than two
// separate slices of the same call (anime used to get its own wider/separate
// call — no longer needed now that both share the same month-to-date window,
// one get_home_stats call covers all four leaderboards with a large enough
// pool (50) that anime has a real chance to surface in top_tv alongside
// regular TV). Anime will still run sparse for the first few days of a new
// month — genuinely lower volume, no way around that once it's tied to the
// same shrinking window as everything else.
router.get('/top-of-month', requireAuth, async (req, res) => {
  try {
    const daysElapsedThisMonth = new Date().getDate();
    const { data: main } = await axios.get(`${process.env.TAUTULLI_URL}/api/v2`, {
      params: { apikey: process.env.TAUTULLI_API_KEY, cmd: 'get_home_stats', time_range: daysElapsedThisMonth, stats_type: 'plays', stats_count: 50 }
    });
    const rowsFor = (statId) => (main.response.data || []).find(s => s.stat_id === statId)?.rows || [];
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

// Personal, per-signed-in-user stats behind a "My Stats" tab next to My
// Requests/Watchlist. Hours-this-year, plays-this-month, family rank, and
// Most Watched are all true calendar periods (year-to-date / month-to-date),
// same technique as Top of the Month above: Tautulli's time_range/query_days
// params only mean "N days back from now", so the trick is computing N as
// days-elapsed-since-the-period-started — resets itself on Jan 1 / the 1st,
// no separate rollover logic needed.
//
// Binge streak deliberately stays on its own genuinely-rolling 60-day
// get_history call (see streakHistoryRes below), NOT the calendar-year one
// Most Watched uses — a streak spanning Dec 31 into January would otherwise
// look truncated for the first few days of a new year, since there'd be no
// prior-year data in a Jan-1-onward window to see it continuing. 60 days is
// far more than any realistic streak needs.
//
// hours/plays come from Tautulli's own get_user_watch_time_stats (one call
// covers both windows); streak and most-watched are computed here from raw
// get_history rows (see lib/myStats.js) since Tautulli has no per-user
// equivalent of its own get_home_stats leaderboard. Family rank reuses that
// same get_home_stats call Top of the Month relies on, matched against this
// user's id instead of only taking the top 3.
// Watch Activity (by day of week / hour of day) reuses Tautulli's own Graphs
// page endpoints, scoped to this user and to duration instead of play count —
// their "Live TV" series is dropped in parseActivitySeries since this
// deployment has no live sessions (always all-zero). Deliberately left as a
// genuinely rolling 30-day window rather than calendar-month — "your viewing
// pattern over the last month" is more useful here than year-to-date, and
// stays meaningful even in the first few days of a new month.
router.get('/my-stats', requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  try {
    const now = new Date();
    const daysElapsedThisMonth = now.getDate();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const daysElapsedThisYear = Math.floor((now - startOfYear) / 86400000) + 1;
    const startOfYearIso = startOfYear.toISOString().slice(0, 10);
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    // In January these two are numerically identical (both count from Jan 1) —
    // dedupe rather than send Tautulli a literal "N,N" query_days value.
    const queryDays = [...new Set([daysElapsedThisMonth, daysElapsedThisYear])].join(',');

    const apikey = process.env.TAUTULLI_API_KEY;
    const base = `${process.env.TAUTULLI_URL}/api/v2`;

    const [watchTime, yearHistoryRes, streakHistoryRes, homeStats, dayRes, hourRes] = await Promise.all([
      axios.get(base, { params: { apikey, cmd: 'get_user_watch_time_stats', user_id: userId, query_days: queryDays } }),
      axios.get(base, { params: { apikey, cmd: 'get_history', user_id: userId, after: startOfYearIso, length: 1000, order_column: 'date', order_dir: 'desc' } }),
      axios.get(base, { params: { apikey, cmd: 'get_history', user_id: userId, after: sixtyDaysAgo, length: 1000, order_column: 'date', order_dir: 'desc' } }),
      axios.get(base, { params: { apikey, cmd: 'get_home_stats', time_range: daysElapsedThisYear, stats_type: 'plays', stats_count: 50 } }),
      axios.get(base, { params: { apikey, cmd: 'get_plays_by_dayofweek', user_id: userId, time_range: 30, y_axis: 'duration' } }),
      axios.get(base, { params: { apikey, cmd: 'get_plays_by_hourofday', user_id: userId, time_range: 30, y_axis: 'duration' } })
    ]);

    const windows = watchTime.data.response.data || [];
    const yearStats = windows.find(w => String(w.query_days) === String(daysElapsedThisYear)) || {};
    const monthStats = windows.find(w => String(w.query_days) === String(daysElapsedThisMonth)) || {};

    const streakDays = computeStreak(streakHistoryRes.data.response.data.data || []);
    const topWatched = computeTopWatched(yearHistoryRes.data.response.data.data || []);

    const topUsersRows = (homeStats.data.response.data || []).find(s => s.stat_id === 'top_users')?.rows || [];
    const position = computeRank(topUsersRows, userId);

    const dayData = dayRes.data.response.data;
    const hourData = hourRes.data.response.data;

    res.json({
      hours: Math.round((yearStats.total_time || 0) / 3600),
      playsThisMonth: monthStats.total_plays || 0,
      streakDays,
      rank: position ? { position, of: topUsersRows.length } : null,
      topWatched,
      activity: {
        byDay: parseActivitySeries(dayData.categories, dayData.series),
        byHour: parseActivitySeries(hourData.categories, hourData.series)
      }
    });
  } catch (err) {
    console.error('tautulli my-stats error:', err.code || err.response?.status, err.message);
    res.status(502).json({ error: 'Could not reach Tautulli' });
  }
});

module.exports = router;
