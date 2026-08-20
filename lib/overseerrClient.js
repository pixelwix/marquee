const axios = require('axios');

// Shared by any route that reads Overseerr's TMDB-shaped data (search, discover,
// watchlist, ...). Built once (not a function re-called per request) — the config
// never changes, and some call sites construct one of these per item in a
// Promise.all over a whole list, so recreating it each time was pure waste.
const adminClient = axios.create({
  baseURL: `${process.env.OVERSEERR_URL}/api/v1`,
  headers: { 'X-Api-Key': process.env.OVERSEERR_API_KEY },
  // Explicit rather than relying on server.js's axios.defaults.timeout —
  // axios.create() snapshots defaults at call time, so this stays correct
  // even if this module ever ends up required before that line runs.
  timeout: 15000
});

// Trims an Overseerr movie/tv object (from /search, /discover, or a direct
// /movie/{id} or /tv/{id} lookup) down to what the frontend needs, with the
// same availability computation everywhere. Detail-endpoint responses don't
// carry their own mediaType field (the caller already knows it from the URL
// it fetched), so callers of those must spread `mediaType` in themselves.
function mapDiscoverItem(r) {
  return {
    id: r.id,
    mediaType: r.mediaType,
    title: r.title || r.name,
    year: (r.releaseDate || r.firstAirDate || '').slice(0, 4),
    overview: r.overview,
    poster: r.posterPath ? `https://image.tmdb.org/t/p/w300${r.posterPath}` : null,
    // Wide landscape image — used for the dashboard's cycling hero background,
    // not the request/discover cards (which use the portrait poster above).
    backdrop: r.backdropPath ? `https://image.tmdb.org/t/p/w1280${r.backdropPath}` : null,
    // Overseerr media status: 4 = partially available, 5 = available — i.e.
    // actually already in Plex, distinct from just having been requested
    // (2 = pending, 3 = processing) or never touched (everything else).
    availability: [4, 5].includes(r.mediaInfo?.status) ? 'available'
      : [2, 3].includes(r.mediaInfo?.status) ? 'requested'
      : 'none'
  };
}

// Overseerr's request/issue lists only return tmdbId, not a title — resolved here
// with one lookup per item (parallel at each call site; confirmed there's no bulk
// endpoint). Shared by routes/overseerr.js's /requests/mine, /requests/pending, and
// /issues/open, plus fetchOpenIssues below.
async function resolveMedia(mediaType, tmdbId) {
  if (!tmdbId) return { title: null, poster: null };
  try {
    const { data } = await adminClient.get(`/${mediaType}/${tmdbId}`);
    return {
      title: data.title || data.name,
      poster: data.posterPath ? `https://image.tmdb.org/t/p/w300${data.posterPath}` : null
    };
  } catch (e) {
    // Leave title/poster null rather than failing the whole list over one bad lookup.
    return { title: null, poster: null };
  }
}

const ISSUE_TYPE_LABELS = { 1: "Doesn't play", 2: 'Wrong audio', 3: 'Subtitles', 4: 'Other' };

// Admin-wide open issues, with enough context (title/poster/reporter/message) to act
// on without opening Overseerr separately. Same PII discipline as resolveMedia's other
// call sites — createdBy's email/permissions/quota fields never leave the server.
// Shared by routes/overseerr.js's /issues/open route and lib/issueWatchdog.js.
async function fetchOpenIssues() {
  const { data } = await adminClient.get('/issue', {
    params: { filter: 'open', take: 50, sort: 'added' }
  });

  return Promise.all(data.results.map(async r => {
    const { title, poster } = await resolveMedia(r.media?.mediaType, r.media?.tmdbId);
    return {
      id: r.id,
      title,
      poster,
      issueType: ISSUE_TYPE_LABELS[r.issueType] || 'Other',
      season: r.problemSeason,
      episode: r.problemEpisode,
      message: r.comments?.[0]?.message || '',
      reportedBy: r.createdBy?.displayName || r.createdBy?.plexUsername || 'Unknown',
      reportedByAvatar: r.createdBy?.avatar || null,
      reportedAt: r.createdAt,
      // For the "search Radarr/Sonarr" action — routes to the right service
      // and its own id scheme (Radarr keys movies by tmdbId, Sonarr keys
      // series by tvdbId).
      mediaType: r.media?.mediaType,
      tmdbId: r.media?.tmdbId,
      tvdbId: r.media?.tvdbId
    };
  }));
}

module.exports = { adminClient, mapDiscoverItem, resolveMedia, fetchOpenIssues, ISSUE_TYPE_LABELS };
