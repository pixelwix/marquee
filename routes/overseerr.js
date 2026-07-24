const express = require('express');
const axios = require('axios');
const requireAuth = require('./requireAuth');
const router = express.Router();

const client = () => axios.create({
  baseURL: `${process.env.OVERSEERR_URL}/api/v1`,
  headers: { 'X-Api-Key': process.env.OVERSEERR_API_KEY }
});

// Maps a signed-in Plex account id to its matching Overseerr user id, so requests and
// "mine" queries can be attributed to the actual family member instead of the API
// key's default account. Cached per-process since this mapping essentially never
// changes; a restart is enough to pick up newly-added Overseerr users.
const overseerrUserIdCache = new Map(); // plexUserId -> overseerrUserId

async function getOverseerrUserId(plexUserId) {
  const key = String(plexUserId);
  if (overseerrUserIdCache.has(key)) return overseerrUserIdCache.get(key);

  const { data } = await client().get('/user', { params: { take: 50, sort: 'created' } });
  for (const u of data.results) {
    if (u.plexId != null) overseerrUserIdCache.set(String(u.plexId), u.id);
  }
  return overseerrUserIdCache.get(key);
}

router.get('/search', requireAuth, async (req, res) => {
  try {
    const { data } = await client().get('/search', { params: { query: req.query.q, page: 1 } });
    const results = data.results
      .filter(r => r.mediaType === 'movie' || r.mediaType === 'tv')
      .map(r => ({
        id: r.id,
        mediaType: r.mediaType,
        title: r.title || r.name,
        year: (r.releaseDate || r.firstAirDate || '').slice(0, 4),
        overview: r.overview,
        poster: r.posterPath ? `https://image.tmdb.org/t/p/w300${r.posterPath}` : null,
        status: r.mediaInfo?.status || 0 // 0 = not requested yet
      }));
    res.json(results);
  } catch (err) {
    console.error('overseerr search error', err.message);
    res.status(502).json({ error: 'Could not reach Overseerr' });
  }
});

router.post('/request', requireAuth, async (req, res) => {
  const { id, mediaType } = req.body;
  try {
    // Ties the request to the signed-in family member for tracking; falls back to the
    // API key's default account if this Plex user has no matching Overseerr user.
    const userId = await getOverseerrUserId(req.session.user.id);
    const { data } = await client().post('/request', { mediaId: id, mediaType, userId });
    res.json({ status: 'requested', data });
  } catch (err) {
    console.error('overseerr request error', err.response?.data || err.message);
    res.status(502).json({ error: err.response?.data?.message || 'Could not submit request' });
  }
});

router.get('/requests/mine', requireAuth, async (req, res) => {
  try {
    const overseerrUserId = await getOverseerrUserId(req.session.user.id);
    const params = { take: 20, sort: 'added' };
    // If this Plex user has no matching Overseerr user, fall back to the previous
    // behavior (everyone's requests) rather than erroring.
    if (overseerrUserId != null) params.requestedBy = overseerrUserId;
    const { data } = await client().get('/request', { params });
    res.json(data.results.map(r => ({
      title: r.media?.title,
      mediaType: r.media?.mediaType,
      status: r.status, // 1 pending, 2 approved, 3 declined, 4 available (varies by version)
      requestedAt: r.createdAt
    })));
  } catch (err) {
    console.error('overseerr requests error', err.message);
    res.status(502).json({ error: 'Could not reach Overseerr' });
  }
});

module.exports = router;
