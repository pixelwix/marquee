const express = require('express');
const axios = require('axios');
const requireAuth = require('./requireAuth');
const overseerrSession = require('../lib/overseerrSession');
const rateLimit = require('../lib/rateLimit');
const router = express.Router();

// Unlike the read-only endpoints below, this has a real side effect (creates an
// actual request against Sonarr/Radarr) — worth capping independent of who's
// authenticated.
const requestLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, message: 'Too many requests submitted — try again in a few minutes.' });

// Search/discovery has no permission-sensitive behavior in Overseerr, so this
// stays on the simple admin-key client. Request submission does not — see
// requestAsUser below.
const adminClient = () => axios.create({
  baseURL: `${process.env.OVERSEERR_URL}/api/v1`,
  headers: { 'X-Api-Key': process.env.OVERSEERR_API_KEY }
});

router.get('/search', requireAuth, async (req, res) => {
  try {
    // Built manually rather than via axios's `params` — its default serializer
    // encodes spaces as "+", and this Overseerr instance's strict URL-encoding
    // validation rejects that (requires literal %20), so any multi-word query
    // was failing with a 400.
    const { data } = await adminClient().get(`/search?query=${encodeURIComponent(req.query.q)}&page=1`);
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

// Season list for a TV show, so the request UI can offer specific seasons
// instead of defaulting to the whole series. mediaInfo.seasons (present once
// Overseerr knows about the title at all) tells us what's already
// available/requested so those can be shown as already-handled rather than
// offered again.
router.get('/tv/:id', requireAuth, async (req, res) => {
  // TMDB ids are always numeric — reject anything else before it reaches the URL.
  // Without this, a value like "..%2fsettings%2fmain" decodes to a literal "/" in
  // req.params.id (Express only blocks bare "/" from matching :id, not the
  // percent-encoded form), and since this is string-concatenated into the request
  // path (not passed as an axios query param, which would be safely encoded), it
  // lets any signed-in user pivot this admin-keyed request to arbitrary Overseerr
  // API paths — confirmed reachable: GET /api/v1/settings/main, which returns
  // Overseerr's own API key among other config.
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  try {
    const { data } = await adminClient().get(`/tv/${req.params.id}`);
    const seasons = (data.seasons || [])
      .filter(s => s.seasonNumber > 0) // skip "Specials"
      .map(s => {
        const info = data.mediaInfo?.seasons?.find(ms => ms.seasonNumber === s.seasonNumber);
        // Overseerr media status: 4 = partially available, 5 = available
        const available = info?.status === 4 || info?.status === 5;
        // 2 = pending, 3 = processing
        const requested = info?.status === 2 || info?.status === 3;
        return { seasonNumber: s.seasonNumber, name: s.name, episodeCount: s.episodeCount, available, requested };
      });
    res.json({ title: data.name, seasons });
  } catch (err) {
    console.error('overseerr tv details error', err.code || err.response?.status, err.message);
    res.status(502).json({ error: 'Could not reach Overseerr' });
  }
});

// Submits the request through the signed-in user's own Overseerr session (not
// the admin API key) so Overseerr's REQUEST/AUTO_APPROVE permission checks
// apply to them, not to whoever generated the API key. Retries once with a
// fresh session if the cached one has expired.
async function requestAsUser(req, payload, retry = true) {
  const session = await overseerrSession.getSession(req.session.user.id, req.session.user.plexToken);
  try {
    return await axios.post(`${process.env.OVERSEERR_URL}/api/v1/request`, payload, {
      headers: { Cookie: session.cookie, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    if (retry && err.response?.status === 401) {
      overseerrSession.invalidate(req.session.user.id);
      return requestAsUser(req, payload, false);
    }
    throw err;
  }
}

router.post('/request', requireAuth, requestLimiter, async (req, res) => {
  const { id, mediaType, seasons } = req.body;
  try {
    const payload = { mediaId: id, mediaType };
    if (mediaType === 'tv') payload.seasons = (seasons && seasons.length) ? seasons : 'all';
    await requestAsUser(req, payload);
    // The frontend only needs to know it succeeded — Overseerr's response here
    // embeds a full User object (email, permission bitmask, etc.), unused by any
    // caller, so it's not worth forwarding as-is.
    res.json({ status: 'requested' });
  } catch (err) {
    console.error('overseerr request error', err.response?.data || err.message);
    res.status(502).json({ error: err.response?.data?.message || 'Could not submit request' });
  }
});

router.get('/requests/mine', requireAuth, async (req, res) => {
  try {
    const session = await overseerrSession.getSession(req.session.user.id, req.session.user.plexToken);
    const { data } = await axios.get(`${process.env.OVERSEERR_URL}/api/v1/request`, {
      params: { take: 20, sort: 'added', requestedBy: session.overseerrUserId },
      headers: { Cookie: session.cookie }
    });
    res.json(data.results.map(r => ({
      title: r.media?.title,
      mediaType: r.media?.mediaType,
      status: r.status, // 1 pending, 2 approved, 3 declined, 4 available (varies by version)
      requestedAt: r.createdAt
    })));
  } catch (err) {
    console.error('overseerr requests error', err.response?.data || err.message);
    res.status(502).json({ error: 'Could not reach Overseerr' });
  }
});

module.exports = router;
