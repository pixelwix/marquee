const axios = require('axios');

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
async function fetchMissingMovies() {
  const { data } = await axios.get(`${process.env.RADARR_URL}/api/v3/wanted/missing`, {
    params: { pageSize: 50, sortKey: 'releaseDate', sortDirection: 'descending' },
    headers: { 'X-Api-Key': process.env.RADARR_API_KEY }
  });
  return data.records
    .filter(m => m.isAvailable)
    .map(m => ({
      mediaType: 'movie',
      tmdbId: m.tmdbId,
      title: m.title,
      overview: m.overview || '',
      poster: m.images?.find(i => i.coverType === 'poster')?.remoteUrl || null,
      date: m.releaseDate || m.inCinemas || null
    }));
}

module.exports = { fetchImportQueue, fetchMissingMovies };
