const crypto = require('node:crypto');
const express = require('express');
const axios = require('axios');
const requireAuth = require('./requireAuth');
const requireOwner = require('./requireOwner');
const overseerrSession = require('../lib/overseerrSession');
const rateLimit = require('../lib/rateLimit');
const sse = require('../lib/sse');
const pushNotify = require('../lib/pushNotify');
const tautulliMedia = require('../lib/tautulliMedia');
const autoFixIssue = require('../lib/autoFixIssue');
const { adminClient, mapDiscoverItem, resolveMedia, fetchOpenIssues, ISSUE_TYPE_LABELS } = require('../lib/overseerrClient');
const downloadQueueIds = require('../lib/downloadQueueIds');
const { computeAvailability } = require('../lib/requestAvailability');
const { extractTmdbId } = require('../lib/guid');
const router = express.Router();

// Unlike the read-only endpoints below, these have a real side effect (creates an
// actual request against Sonarr/Radarr, or a real Overseerr issue) — worth capping
// independent of who's authenticated.
const requestLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, message: 'Too many requests submitted — try again in a few minutes.' });
const issueLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, message: 'Too many issues reported — try again in a few minutes.' });

// /discover and /recommendations each make several upstream calls per hit
// (recommendations up to ~20: 2 Tautulli + 1 Overseerr call per distinct
// recent watch it walks through) — both are cached client-side for the rest
// of the page session (see public/app.js's discoverCache), so one real page
// load only ever needs a handful of these; generous enough to comfortably
// cover normal use (page reloads, several family members sharing an IP)
// while still bounding a buggy or abusive client hammering either endpoint.
const discoverLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, message: 'Too many requests — try again in a few minutes.' });
const recommendationsLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, message: 'Too many requests — try again in a few minutes.' });

router.get('/search', requireAuth, async (req, res) => {
  try {
    // Built manually rather than via axios's `params` — its default serializer
    // encodes spaces as "+", and this Overseerr instance's strict URL-encoding
    // validation rejects that (requires literal %20), so any multi-word query
    // was failing with a 400.
    const { data } = await adminClient.get(`/search?query=${encodeURIComponent(req.query.q)}&page=1`);
    const results = data.results
      .filter(r => r.mediaType === 'movie' || r.mediaType === 'tv')
      .map(mapDiscoverItem);
    res.json(results);
  } catch (err) {
    console.error('overseerr search error', err.message);
    res.status(502).json({ error: 'Could not reach Overseerr' });
  }
});

// Powers the request modal's default view (shown before the user types
// anything) — trending + upcoming movies/TV, combined and deduped, filtered
// down to only things not already in the library or already requested, so it
// reads as "things you could actually go request" rather than a raw TMDB
// trending feed full of stuff you already have.
router.get('/discover', requireAuth, discoverLimiter, async (req, res) => {
  try {
    const [trending1, trending2, upMovies, upTv] = await Promise.all([
      adminClient.get('/discover/trending', { params: { page: 1 } }),
      adminClient.get('/discover/trending', { params: { page: 2 } }),
      adminClient.get('/discover/movies/upcoming', { params: { page: 1 } }),
      adminClient.get('/discover/tv/upcoming', { params: { page: 1 } })
    ]);

    const seen = new Set();
    const results = [];
    for (const { data } of [trending1, trending2, upMovies, upTv]) {
      for (const r of data.results) {
        if (r.mediaType !== 'movie' && r.mediaType !== 'tv') continue;
        const key = `${r.mediaType}-${r.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const item = mapDiscoverItem(r);
        if (item.availability === 'none') results.push(item);
      }
    }

    res.json(results.slice(0, 40));
  } catch (err) {
    console.error('overseerr discover error', err.response?.data || err.message);
    res.status(502).json({ error: 'Could not reach Overseerr' });
  }
});

// "Because you watched X" — personalizes the request modal's default view
// (rendered alongside the global Trending feed above, not instead of it)
// using this signed-in user's own most recent watch. Same personalization
// source as My Stats/Recently Watched (Tautulli's get_history filtered by
// user_id — Tautulli uses the Plex account id directly, no separate mapping
// needed), resolved to a TMDB id via Tautulli's get_metadata guids (same
// lib/guid.js extraction, same show-not-episode grouping as
// lib/myStats.js's computeTopWatched), then Overseerr's own recommendations
// endpoint (TMDB's recommendations, proxied — same response shape as
// /discover above, so mapDiscoverItem/the not-owned/not-requested filter
// both apply unchanged).
//
// Walks back through the last few distinct watches rather than only ever
// trying the single most recent one: a title with no Plex-matched guid at
// all (self-added, obscure) would otherwise silently kill this feature for
// however long it stays most recent, and a seed that resolves fine but has
// nothing new to recommend (everything it suggests is already owned) is
// exactly as much a dead end as one that fails to resolve at all.
router.get('/recommendations', requireAuth, recommendationsLimiter, async (req, res) => {
  try {
    const { data } = await axios.get(`${process.env.TAUTULLI_URL}/api/v2`, {
      params: {
        apikey: process.env.TAUTULLI_API_KEY,
        cmd: 'get_history',
        user_id: req.session.user.id,
        length: 10,
        order_column: 'date',
        order_dir: 'desc'
      }
    });
    const rows = data.response.data.data || [];

    const triedKeys = new Set();
    for (const row of rows) {
      const ratingKey = row.grandparent_rating_key || row.rating_key;
      if (triedKeys.has(ratingKey)) continue;
      triedKeys.add(ratingKey);
      const seedTitle = row.grandparent_title || row.title;

      // eslint-disable-next-line no-await-in-loop
      const meta = await axios.get(`${process.env.TAUTULLI_URL}/api/v2`, {
        params: { apikey: process.env.TAUTULLI_API_KEY, cmd: 'get_metadata', rating_key: ratingKey }
      });
      const tmdbId = extractTmdbId(meta.data.response.data?.guids);
      if (!tmdbId) continue;

      const mediaType = meta.data.response.data?.media_type === 'show' ? 'tv' : 'movie';
      // eslint-disable-next-line no-await-in-loop
      const { data: recData } = await adminClient.get(`/${mediaType}/${tmdbId}/recommendations`);
      const items = (recData.results || [])
        .map(r => mapDiscoverItem({ ...r, mediaType }))
        .filter(item => item.availability === 'none')
        .slice(0, 20);

      if (items.length) return res.json({ seedTitle, items });
    }

    res.json({ seedTitle: null, items: [] });
  } catch (err) {
    console.error('overseerr recommendations error', err.response?.data || err.message);
    res.status(502).json({ error: 'Could not build recommendations' });
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
    const { data } = await adminClient.get(`/tv/${req.params.id}`);
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

// Submits through the signed-in user's own Overseerr session (not the admin API
// key) so Overseerr's own permission checks (REQUEST/AUTO_APPROVE, CREATE_ISSUES,
// ...) apply to them, not to whoever generated the API key. Retries once with a
// fresh session if the cached one has expired. Shared by /request and /issue.
async function postAsUser(req, path, payload, retry = true) {
  const session = await overseerrSession.getSession(req.session.user.id, req.session.user.plexToken);
  try {
    return await axios.post(`${process.env.OVERSEERR_URL}/api/v1${path}`, payload, {
      headers: { Cookie: session.cookie, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    if (retry && err.response?.status === 401) {
      overseerrSession.invalidate(req.session.user.id);
      return postAsUser(req, path, payload, false);
    }
    throw err;
  }
}

router.post('/request', requireAuth, requestLimiter, async (req, res) => {
  const { id, mediaType, seasons } = req.body;
  // Same seasons-shape guard as PUT /requests/:id below — omitted/empty still
  // means "all seasons" (unchanged), only a genuinely malformed seasons value
  // is rejected here now, before it reaches postAsUser.
  if (seasons !== undefined && (!Array.isArray(seasons) || !seasons.every(n => Number.isInteger(n) && n > 0))) {
    return res.status(400).json({ error: 'Invalid seasons' });
  }
  try {
    const payload = { mediaId: id, mediaType };
    if (mediaType === 'tv') payload.seasons = (seasons && seasons.length) ? seasons : 'all';
    await postAsUser(req, '/request', payload);
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
    const [{ data }, queued] = await Promise.all([
      axios.get(`${process.env.OVERSEERR_URL}/api/v1/request`, {
        params: { take: 20, sort: 'added', requestedBy: session.overseerrUserId },
        headers: { Cookie: session.cookie }
      }),
      downloadQueueIds.getQueuedIds()
    ]);

    const results = await Promise.all(data.results.map(async r => {
      const mediaType = r.type; // 'movie' | 'tv'
      const { title, poster } = await resolveMedia(mediaType, r.media?.tmdbId);
      const inQueue = mediaType === 'movie'
        ? queued.movieIds.has(r.media?.externalServiceId)
        : queued.seriesIds.has(r.media?.externalServiceId);
      const availability = computeAvailability({ requestStatus: r.status, mediaStatus: r.media?.status, inQueue });
      const etaSeconds = inQueue
        ? (mediaType === 'movie'
          ? queued.movieEta.get(r.media?.externalServiceId)
          : queued.seriesEta.get(r.media?.externalServiceId)) ?? null
        : null;
      return { title, poster, mediaType, availability, etaSeconds, requestedAt: r.createdAt };
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
    const { data } = await adminClient.get('/request', {
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
        tmdbId: r.media?.tmdbId ?? null,
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

// Narrows a pending TV request down to specific seasons before approval — the
// owner may only want to grant some of what was originally requested. Movies
// have no seasons and never call this. mediaType is required by Overseerr's
// own PUT /request/{id} regardless of what's changing.
router.put('/requests/:id', requireAuth, requireOwner, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const { seasons } = req.body;
  if (!Array.isArray(seasons) || !seasons.length || !seasons.every(n => Number.isInteger(n) && n > 0)) {
    return res.status(400).json({ error: 'Invalid seasons' });
  }
  try {
    await adminClient.put(`/request/${req.params.id}`, { mediaType: 'tv', seasons });
    res.json({ status: 'updated' });
  } catch (err) {
    console.error('overseerr update request error', err.response?.data || err.message);
    res.status(502).json({ error: 'Could not update request' });
  }
});

// TMDB/request ids are always numeric — same path-traversal lesson as /tv/:id
// above: reject anything else before it reaches an admin-keyed outbound URL.
router.post('/requests/:id/approve', requireAuth, requireOwner, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    await adminClient.post(`/request/${req.params.id}/approve`);
    res.json({ status: 'approved' });
  } catch (err) {
    console.error('overseerr approve error', err.response?.data || err.message);
    res.status(502).json({ error: 'Could not approve request' });
  }
});

router.post('/requests/:id/decline', requireAuth, requireOwner, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    await adminClient.post(`/request/${req.params.id}/decline`);
    res.json({ status: 'declined' });
  } catch (err) {
    console.error('overseerr decline error', err.response?.data || err.message);
    res.status(502).json({ error: 'Could not decline request' });
  }
});

// A fixed set of problem categories, both for a simpler reporting UI and so this
// can't be used to inject an arbitrary Overseerr issueType value. Matches
// Overseerr's own IssueType enum (VIDEO/AUDIO/SUBTITLES/OTHER = 1-4).
const ISSUE_TYPES = { doesnt_play: 1, wrong_audio: 2, subtitles: 3, other: 4 };
router.post('/issue', requireAuth, issueLimiter, async (req, res) => {
  const { ratingKey, issueType, message } = req.body;
  const type = ISSUE_TYPES[issueType];
  if (!/^\d+$/.test(String(ratingKey)) || !type) {
    return res.status(400).json({ error: 'Invalid issue report' });
  }
  try {
    // Plex rating keys aren't TMDB ids — resolve through Tautulli first (show's
    // own tmdbId + season/episode for an episode, or the movie's own tmdbId)
    // before Overseerr can be told which Media record this issue belongs to.
    const resolved = await tautulliMedia.resolveForIssue(ratingKey);
    if (!resolved.tmdbId) {
      return res.status(502).json({ error: 'Could not identify this title in Overseerr' });
    }
    const { data: media } = await adminClient.get(`/${resolved.mediaType}/${resolved.tmdbId}`);
    const mediaId = media.mediaInfo?.id;
    if (!mediaId) {
      return res.status(502).json({ error: 'This title isn’t tracked in Overseerr yet' });
    }
    const { data: created } = await postAsUser(req, '/issue', {
      issueType: type,
      message: String(message || '').trim().slice(0, 500) || 'No additional details provided.',
      mediaId,
      problemSeason: resolved.season,
      problemEpisode: resolved.episode
    });
    res.json({ status: 'reported' });

    // Fires after the response — a slow/failed auto-fix attempt should never
    // hold up the "Thanks — reported" confirmation the reporter is waiting
    // on. Only for the playback-related categories a bad *file* would
    // actually explain; 'other' is open-ended free text that isn't
    // necessarily a "go get a new file" problem.
    if (type !== ISSUE_TYPES.other) {
      autoFixIssue.attempt({
        issueId: created.id,
        mediaType: resolved.mediaType,
        tmdbId: resolved.tmdbId,
        tvdbId: media.mediaInfo?.tvdbId,
        season: resolved.season,
        episode: resolved.episode,
        title: media.title || media.name
      }).catch(err => console.error('auto-fix issue trigger error', err.message));
    }
  } catch (err) {
    console.error('overseerr issue error', err.response?.data || err.message);
    res.status(502).json({ error: err.response?.data?.message || 'Could not submit issue report' });
  }
});

// A reporter's own history — previously there was no way for a family member to
// tell whether something they flagged ever got looked at, short of asking the
// owner directly. Overseerr's issue list has no per-user filter param (confirmed
// live: passing requestedBy is silently ignored), so this fetches a generous
// page and filters to the caller's own createdBy.id in-process, same pattern as
// fetchOpenIssues but scoped to one person instead of admin-wide.
router.get('/issues/mine', requireAuth, async (req, res) => {
  try {
    const session = await overseerrSession.getSession(req.session.user.id, req.session.user.plexToken);
    const { data } = await adminClient.get('/issue', {
      params: { take: 100, sort: 'added', filter: 'all' }
    });
    const mine = data.results.filter(r => r.createdBy?.id === session.overseerrUserId);

    const results = await Promise.all(mine.map(async r => {
      const { title, poster } = await resolveMedia(r.media?.mediaType, r.media?.tmdbId);
      // Overseerr issues only have two real statuses (open=1 / resolved=2) — no
      // "in progress" state exists in its data model. We infer one: the initial
      // report always creates exactly one comment (see POST /issue below), so a
      // second comment can only have come from an admin replying in Overseerr's
      // own UI — a real signal someone's looked at it, short of marking it done.
      const hasReply = (r.comments?.length || 0) > 1;
      const status = r.status === 2 ? 'resolved' : hasReply ? 'in_progress' : 'open';
      return {
        id: r.id,
        title,
        poster,
        issueType: ISSUE_TYPE_LABELS[r.issueType] || 'Other',
        season: r.problemSeason,
        episode: r.problemEpisode,
        status,
        reportedAt: r.createdAt,
        updatedAt: r.updatedAt
      };
    }));

    results.sort((a, b) => new Date(b.reportedAt) - new Date(a.reportedAt));
    res.json(results);
  } catch (err) {
    console.error('overseerr issues mine error', err.response?.data || err.message);
    res.status(502).json({ error: 'Could not reach Overseerr' });
  }
});

// Admin-wide open issues, with enough context (title/poster/reporter/message) to
// act on without opening Overseerr separately. Same PII discipline as
// /requests/pending — createdBy's email/permissions/quota fields never leave
// the server. Fetch logic lives in lib/overseerrClient.js — shared with
// lib/issueWatchdog.js, which feeds these into the Alerts panel/push pipeline.
router.get('/issues/open', requireAuth, requireOwner, async (req, res) => {
  try {
    res.json(await fetchOpenIssues());
  } catch (err) {
    console.error('overseerr open issues error', err.response?.data || err.message);
    res.status(502).json({ error: 'Could not reach Overseerr' });
  }
});

router.post('/issues/:id/resolve', requireAuth, requireOwner, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    await adminClient.post(`/issue/${req.params.id}/resolved`);
    res.json({ status: 'resolved' });
  } catch (err) {
    console.error('overseerr resolve issue error', err.response?.data || err.message);
    res.status(502).json({ error: 'Could not resolve issue' });
  }
});

// Called by Overseerr itself (Settings -> Notifications -> Webhook), not by a
// signed-in browser — so this can't sit behind requireAuth's session check.
// Overseerr doesn't sign its webhook payloads, so the shared secret configured
// into the webhook agent's "Authorization Header" field is what stops anyone
// else from spoofing availability toasts to the whole family.
router.post('/webhook', (req, res) => {
  const secret = req.headers.authorization;
  const expected = process.env.OVERSEERR_WEBHOOK_SECRET;
  // Constant-time compare, same as lib/recapUnsubscribe.js's token check — a
  // shared-secret webhook auth check is exactly the kind of thing timing
  // attacks target, and crypto.timingSafeEqual is free/built-in here.
  const a = Buffer.from(String(secret ?? ''));
  const b = Buffer.from(String(expected ?? ''));
  if (!expected || !secret || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
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
  } else if (notification_type === 'MEDIA_PENDING') {
    // Fires once per new request that needs approval (auto-approved requests
    // never hit this type) — the owner otherwise had no way to know a request
    // was waiting short of opening the admin page and checking.
    const requestedBy = req.body.request?.requestedBy_username
      || req.body.request?.requestedBy_email
      || 'Someone';
    pushNotify.notifyOwners({
      title: 'New request needs approval',
      body: `${requestedBy} requested ${subject}`,
      icon: image,
      url: '/admin'
    }).catch(err => console.error('overseerr webhook push notify error', err.message));
  }
});

module.exports = router;
