const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const requireAuth = require('./requireAuth');
const requireOwner = require('./requireOwner');
const { parseFranchiseCollections, computeAllGaps } = require('../lib/collectionGaps');
const router = express.Router();

// Same bind-mount destination lib/notice.js already reads Kometa's config
// from (see KOMETA_CONFIG_DIR in docker-compose.yml) — left unset, the
// compose volume harmlessly re-mounts ./data and this just reports no gaps
// rather than erroring, same no-op-when-unconfigured shape as that feature.
const KOMETA_CONFIG_MOUNT = '/app/kometa-config';
const FRANCHISES_PATH = path.join(KOMETA_CONFIG_MOUNT, 'franchises.yml');

const radarrHeaders = { headers: { 'X-Api-Key': process.env.RADARR_API_KEY } };

function posterFrom(images) {
  return images?.find(i => i.coverType === 'poster')?.remoteUrl || null;
}

// Collections rarely change (hand-edited) and the library doesn't need
// second-by-second freshness for an owner's occasional to-download check —
// a simple in-memory TTL plus a manual refresh button (below) is
// proportionate; no need for sceneReleases.js's always-on background poller.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let cache = null; // { computedAt, gaps }

async function computeGaps() {
  if (!fs.existsSync(FRANCHISES_PATH)) return [];
  const definitions = parseFranchiseCollections(fs.readFileSync(FRANCHISES_PATH, 'utf8'));

  const [{ data: radarrCollections }, { data: libraryMovies }] = await Promise.all([
    axios.get(`${process.env.RADARR_URL}/api/v3/collection`, radarrHeaders),
    axios.get(`${process.env.RADARR_URL}/api/v3/movie`, radarrHeaders)
  ]);
  const radarrCollectionsByTmdbId = new Map(radarrCollections.map(c => [c.tmdbId, c]));
  const libraryByTmdbId = new Map(libraryMovies.map(m => [m.tmdbId, m]));

  const gaps = computeAllGaps(definitions, radarrCollectionsByTmdbId, libraryByTmdbId);

  // Enrich each missing movie with what the "Request"/"Search Radarr"
  // buttons need — same item shape openAddMediaModal/openReleaseModal
  // already expect elsewhere in admin.js. A movie Radarr already tracks
  // (monitored, just no file yet) has everything we need from the library
  // call above; one it's never heard of needs a live lookup for
  // title/year/poster, same call /api/radarr/add makes internally anyway.
  const lookupCache = new Map();
  async function lookupUntracked(tmdbId) {
    if (lookupCache.has(tmdbId)) return lookupCache.get(tmdbId);
    const promise = axios.get(`${process.env.RADARR_URL}/api/v3/movie/lookup`, {
      ...radarrHeaders,
      params: { term: `tmdb:${tmdbId}` }
    }).then(r => r.data[0] || null).catch(() => null);
    lookupCache.set(tmdbId, promise);
    return promise;
  }

  for (const gap of gaps) {
    if (gap.unknown) continue;
    gap.missing = await Promise.all(gap.missingTmdbIds.map(async tmdbId => {
      const inLibrary = libraryByTmdbId.get(tmdbId);
      if (inLibrary) {
        return {
          // Radarr's own API returns year as a number — stringified here so
          // this matches Scene Releases' item shape (year always a string),
          // the one other place admin.js renders a release card. A raw
          // number reaching escapeHtml() (which calls .replace() directly)
          // throws, and since that throw happens outside fetchCollectionGaps'
          // try/catch, it silently leaves the panel stuck on "Loading..."
          // forever — a real bug this shipped with and user-reported.
          mediaType: 'movie', tmdbId, title: inLibrary.title, year: inLibrary.year != null ? String(inLibrary.year) : null,
          poster: posterFrom(inLibrary.images), tracked: true
        };
      }
      const found = await lookupUntracked(tmdbId);
      return {
        mediaType: 'movie', tmdbId,
        title: found?.title || `TMDB #${tmdbId}`,
        year: found?.year != null ? String(found.year) : null,
        poster: found ? posterFrom(found.images) : null,
        overview: found?.overview || null,
        tracked: false
      };
    }));
    delete gap.missingTmdbIds;
  }
  return gaps;
}

async function getGaps(forceRefresh) {
  if (!forceRefresh && cache && Date.now() - cache.computedAt < CACHE_TTL_MS) return cache.gaps;
  const gaps = await computeGaps();
  cache = { computedAt: Date.now(), gaps };
  return gaps;
}

router.get('/', requireAuth, requireOwner, async (req, res) => {
  try {
    res.json(await getGaps(false));
  } catch (err) {
    console.error('collection-gaps error:', err.code || err.response?.status, err.message);
    res.status(502).json({ error: 'Could not check collections' });
  }
});

router.post('/refresh', requireAuth, requireOwner, async (req, res) => {
  try {
    res.json(await getGaps(true));
  } catch (err) {
    console.error('collection-gaps refresh error:', err.code || err.response?.status, err.message);
    res.status(502).json({ error: 'Could not check collections' });
  }
});

module.exports = router;
