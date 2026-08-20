const axios = require('axios');
const { mapFileInfo } = require('./fileInfo');
const { classifyQueueRecord, isFileFromThisGrab } = require('./grabStatus');

// Items Radarr pulled in but couldn't import automatically (bad release, missing
// files, rejected by a custom format rule, etc.) — enough context to review before
// forcing an import or removing it. Shared by routes/radarr.js's /queue route and
// lib/issueWatchdog.js, which feeds these into the Alerts panel/push pipeline.
async function fetchImportQueue() {
  const { data } = await axios.get(`${process.env.RADARR_URL}/api/v3/queue`, {
    params: { includeMovie: true, pageSize: 50 },
    headers: { 'X-Api-Key': process.env.RADARR_API_KEY }
  });
  return (data.records || [])
    .filter(r => r.trackedDownloadStatus && r.trackedDownloadStatus !== 'ok')
    .map(r => ({
      id: r.id,
      title: r.movie?.title || r.title,
      poster: r.movie?.images?.find(i => i.coverType === 'poster')?.remoteUrl || null,
      status: r.trackedDownloadStatus,
      reason: (r.statusMessages || []).flatMap(s => s.messages || []).join('; ') || r.errorMessage || 'Import issue',
      // Needed to look up manual-import candidates for this specific download —
      // Radarr's own /manualimport lookup is keyed by downloadId, not queue id.
      downloadId: r.downloadId || null
    }));
}

// Monitored movies that have actually been released but still have no file — i.e.
// things genuinely worth manually searching for, not stuff that's simply not out
// yet. Shared by routes/owner.js's /wanted route and lib/issueWatchdog.js.
//
// `id` (Radarr's own internal movie id, distinct from tmdbId) is carried through
// so routes/owner.js's /wanted/search-all can hand these straight to Radarr's
// MoviesSearch command below without a second lookup.
async function fetchMissingMovies() {
  const { data } = await axios.get(`${process.env.RADARR_URL}/api/v3/wanted/missing`, {
    params: { pageSize: 50, sortKey: 'releaseDate', sortDirection: 'descending' },
    headers: { 'X-Api-Key': process.env.RADARR_API_KEY }
  });
  return data.records
    .filter(m => m.isAvailable)
    .map(m => ({
      id: m.id,
      mediaType: 'movie',
      tmdbId: m.tmdbId,
      title: m.title,
      overview: m.overview || '',
      poster: m.images?.find(i => i.coverType === 'poster')?.remoteUrl || null,
      date: m.releaseDate || m.inCinemas || null
    }));
}

// Radarr's own automatic search — the same action its own "Search All Missing"
// button triggers, so release selection follows Radarr's real quality-profile/
// indexer rules instead of this app re-implementing that decision logic.
async function searchMissingMovies(movieIds) {
  if (!movieIds.length) return true;
  await axios.post(`${process.env.RADARR_URL}/api/v3/command`,
    { name: 'MoviesSearch', movieIds },
    { headers: { 'X-Api-Key': process.env.RADARR_API_KEY } }
  );
  return true;
}

// Server-side counterpart to routes/radarr.js's /releases + /releases/grab —
// same interactive search Radarr's own indexers run, same pick-the-first-
// non-rejected-release logic as the admin's manual "Auto Fix" button
// (public/admin.js's runAutoFix), just triggered automatically from
// lib/autoFixIssue.js instead of a click. "rejected" already reflects
// whatever quality profile/custom formats/cutoff are actually configured on
// this movie — Radarr's own job, not reimplemented here.
async function autoFixMovie(tmdbId) {
  const { data: movies } = await axios.get(`${process.env.RADARR_URL}/api/v3/movie`, {
    params: { tmdbId },
    headers: { 'X-Api-Key': process.env.RADARR_API_KEY }
  });
  const movie = movies[0];
  if (!movie) return { ok: false, reason: 'not_tracked' };

  const { data: releases } = await axios.get(`${process.env.RADARR_URL}/api/v3/release`, {
    params: { movieId: movie.id },
    headers: { 'X-Api-Key': process.env.RADARR_API_KEY },
    timeout: 60000
  });
  const best = releases.find(r => !r.rejected);
  if (!best) return { ok: false, reason: 'no_eligible_release' };

  await axios.post(`${process.env.RADARR_URL}/api/v3/release`, { guid: best.guid, indexerId: best.indexerId }, {
    headers: { 'X-Api-Key': process.env.RADARR_API_KEY }
  });
  return { ok: true, movieId: movie.id, releaseTitle: best.title };
}

// Same classification as routes/radarr.js's /grab-status, callable directly
// from a background poll loop instead of over HTTP.
async function checkMovieGrabStatus(movieId, sinceMs) {
  const { data: queueData } = await axios.get(`${process.env.RADARR_URL}/api/v3/queue`, {
    params: { pageSize: 200 },
    headers: { 'X-Api-Key': process.env.RADARR_API_KEY }
  });
  const rec = (queueData.records || []).find(r => r.movieId === movieId);
  if (rec) return classifyQueueRecord(rec);

  const { data: movie } = await axios.get(`${process.env.RADARR_URL}/api/v3/movie/${movieId}`, {
    headers: { 'X-Api-Key': process.env.RADARR_API_KEY }
  });
  let file = null;
  if (movie.hasFile && movie.movieFileId) {
    const { data: mf } = await axios.get(`${process.env.RADARR_URL}/api/v3/moviefile/${movie.movieFileId}`, {
      headers: { 'X-Api-Key': process.env.RADARR_API_KEY }
    });
    file = mapFileInfo(mf);
  }
  if (file && !isFileFromThisGrab(file, sinceMs)) return { stage: 'unknown' };
  return { stage: file ? 'done' : 'unknown', file };
}

module.exports = { fetchImportQueue, fetchMissingMovies, searchMissingMovies, autoFixMovie, checkMovieGrabStatus };
