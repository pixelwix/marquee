const express = require('express');
const axios = require('axios');
const requireAuth = require('./requireAuth');
const requireOwner = require('./requireOwner');
const overseerrSession = require('../lib/overseerrSession');
const rateLimit = require('../lib/rateLimit');
const sse = require('../lib/sse');
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
        // Overseerr media status: 4 = partially available, 5 = available — i.e.
        // actually already in Plex, distinct from just having been requested
        // (2 = pending, 3 = processing) or never touched (everything else).
        availability: [4, 5].includes(r.mediaInfo?.status) ? 'available'
          : [2, 3].includes(r.mediaInfo?.status) ? 'requested'
          : 'none'
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

// Overseerr's request list only returns tmdbId, not a title — resolved here with
// one lookup per request (parallel at each call site; confirmed there's no bulk
// endpoint). Shared by /requests/mine and /requests/pending below.
async function resolveMedia(mediaType, tmdbId) {
  if (!tmdbId) return { title: null, poster: null };
  try {
    const { data } = await adminClient().get(`/${mediaType}/${tmdbId}`);
    return {
      title: data.title || data.name,
      poster: data.posterPath ? `https://image.tmdb.org/t/p/w300${data.posterPath}` : null
    };
  } catch (e) {
    // Leave title/poster null rather than failing the whole list over one bad lookup.
    return { title: null, poster: null };
  }
}

router.get('/requests/mine', requireAuth, async (req, res) => {
  try {
    const session = await overseerrSession.getSession(req.session.user.id, req.session.user.plexToken);
    const { data } = await axios.get(`${process.env.OVERSEERR_URL}/api/v1/request`, {
      params: { take: 20, sort: 'added', requestedBy: session.overseerrUserId },
      headers: { Cookie: session.cookie }
    });

    const results = await Promise.all(data.results.map(async r => {
      const mediaType = r.type; // 'movie' | 'tv'
      const { title, poster } = await resolveMedia(mediaType, r.media?.tmdbId);
      // Two different things worth showing distinctly: whether the request
      // itself was approved (r.status: 1 pending, 2 approved, 3 declined), and
      // whether the underlying media is actually available yet (r.media.status:
      // 4/5 = available) — an approved request can still be mid-download.
      const mediaStatus = r.media?.status;
      const availability = r.status === 3 ? 'declined'
        : [4, 5].includes(mediaStatus) ? 'available'
        : r.status === 1 ? 'pending'
        : 'downloading';
      return { title, poster, mediaType, availability, requestedAt: r.createdAt };
    }));

    res.json(results);
  } catch (err) {
    console.error('overseerr requests error', err.response?.data || err.message);
    res.status(502).json({ error: 'Could not reach Overseerr' });
  }
});

// Admin-wide view (every family member's pending requests, not just the caller's
// own) so the owner can approve/decline from the dashboard instead of Overseerr's
// own UI. Deliberately drops requestedBy's email/permissions/quota fields before
// they reach the frontend — only what's needed to identify who asked and decide
// on the request.
router.get('/requests/pending', requireAuth, requireOwner, async (req, res) => {
  try {
    const { data } = await adminClient().get('/request', {
      params: { filter: 'pending', take: 50, sort: 'added' }
    });

    const results = await Promise.all(data.results.map(async r => {
      const mediaType = r.type;
      const { title, poster } = await resolveMedia(mediaType, r.media?.tmdbId);
      return {
        id: r.id,
        title,
        poster,
        mediaType,
        requestedBy: r.requestedBy?.displayName || r.requestedBy?.plexUsername || 'Unknown',
        requestedByAvatar: r.requestedBy?.avatar || null,
        requestedAt: r.createdAt
      };
    }));

    res.json(results);
  } catch (err) {
    console.error('overseerr pending requests error', err.response?.data || err.message);
    res.status(502).json({ error: 'Could not reach Overseerr' });
  }
});

// TMDB/request ids are always numeric — same path-traversal lesson as /tv/:id
// above: reject anything else before it reaches an admin-keyed outbound URL.
router.post('/requests/:id/approve', requireAuth, requireOwner, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    await adminClient().post(`/request/${req.params.id}/approve`);
    res.json({ status: 'approved' });
  } catch (err) {
    console.error('overseerr approve error', err.response?.data || err.message);
    res.status(502).json({ error: 'Could not approve request' });
  }
});

router.post('/requests/:id/decline', requireAuth, requireOwner, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    await adminClient().post(`/request/${req.params.id}/decline`);
    res.json({ status: 'declined' });
  } catch (err) {
    console.error('overseerr decline error', err.response?.data || err.message);
    res.status(502).json({ error: 'Could not decline request' });
  }
});

// Called by Overseerr itself (Settings -> Notifications -> Webhook), not by a
// signed-in browser — so this can't sit behind requireAuth's session check.
// Overseerr doesn't sign its webhook payloads, so the shared secret configured
// into the webhook agent's "Authorization Header" field is what stops anyone
// else from spoofing availability toasts to the whole family.
router.post('/webhook', (req, res) => {
  if (!process.env.OVERSEERR_WEBHOOK_SECRET || req.headers.authorization !== process.env.OVERSEERR_WEBHOOK_SECRET) {
    return res.status(401).end();
  }
  res.status(200).end();

  // This endpoint replaces Overseerr's previous webhook target (a pre-existing
  // notify.helmarr.app integration) since Overseerr only supports one webhook URL
  // at a time — forward the untouched payload on so that integration keeps
  // working, independent of whether it's also a MEDIA_AVAILABLE event below.
  if (process.env.OVERSEERR_WEBHOOK_FORWARD_URL) {
    axios.post(process.env.OVERSEERR_WEBHOOK_FORWARD_URL, req.body)
      .catch(err => console.error('overseerr webhook forward error', err.message));
  }

  const { notification_type, subject, image } = req.body;
  if (notification_type === 'MEDIA_AVAILABLE') {
    sse.broadcast('media-available', { title: subject, poster: image });
  }
});

module.exports = router;
