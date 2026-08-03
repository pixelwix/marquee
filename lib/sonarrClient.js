const axios = require('axios');

// Items Sonarr pulled in but couldn't import automatically (bad release, missing
// files, rejected by a custom format rule, etc.) — enough context to review before
// forcing an import or removing it. Shared by routes/sonarr.js's /queue route and
// lib/issueWatchdog.js, which feeds these into the Alerts panel/push pipeline.
async function fetchImportQueue() {
  const { data } = await axios.get(`${process.env.SONARR_URL}/api/v3/queue`, {
    params: { includeSeries: true, includeEpisode: true, pageSize: 50 },
    headers: { 'X-Api-Key': process.env.SONARR_API_KEY }
  });
  return (data.records || [])
    .filter(r => r.trackedDownloadStatus && r.trackedDownloadStatus !== 'ok')
    .map(r => {
      const seriesTitle = r.series?.title;
      const epLabel = r.episode ? ` — S${r.episode.seasonNumber}E${r.episode.episodeNumber}` : '';
      return {
        id: r.id,
        title: seriesTitle ? `${seriesTitle}${epLabel}` : r.title,
        poster: r.series?.images?.find(i => i.coverType === 'poster')?.remoteUrl || null,
        status: r.trackedDownloadStatus,
        reason: (r.statusMessages || []).flatMap(s => s.messages || []).join('; ') || r.errorMessage || 'Import issue',
        // Needed to look up manual-import candidates for this specific download —
        // Sonarr's own /manualimport lookup is keyed by downloadId, not queue id.
        downloadId: r.downloadId || null
      };
    });
}

// Monitored episodes that have actually aired but still have no file — i.e. things
// genuinely worth manually searching for, not stuff that's simply not out yet.
// Shared by routes/owner.js's /wanted route and lib/issueWatchdog.js.
async function fetchMissingEpisodes() {
  const { data } = await axios.get(`${process.env.SONARR_URL}/api/v3/wanted/missing`, {
    params: { pageSize: 50, includeSeries: true, sortKey: 'airDateUtc', sortDirection: 'descending' },
    headers: { 'X-Api-Key': process.env.SONARR_API_KEY }
  });
  const now = Date.now();
  return data.records
    .filter(e => e.airDateUtc && new Date(e.airDateUtc).getTime() <= now)
    .map(e => ({
      mediaType: 'tv',
      tvdbId: e.series?.tvdbId,
      season: e.seasonNumber,
      episode: e.episodeNumber,
      title: e.series?.title,
      // Episodes carry no synopsis of their own from this endpoint — only the
      // series does — and the episode's own title is often still "TBA" for
      // anything not yet announced in detail.
      episodeTitle: e.title || null,
      overview: e.series?.overview || '',
      poster: e.series?.images?.find(i => i.coverType === 'poster')?.remoteUrl || null,
      date: e.airDateUtc
    }));
}

module.exports = { fetchImportQueue, fetchMissingEpisodes };
