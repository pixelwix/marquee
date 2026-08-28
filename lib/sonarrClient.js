const axios = require('axios');
const { mapFileInfo } = require('./fileInfo');
const { classifyQueueRecord, isFileFromThisGrab, groupQueueRecordsByEpisode } = require('./grabStatus');

// Items Sonarr pulled in but couldn't import automatically (bad release, missing
// files, rejected by a custom format rule, etc.) — enough context to review before
// forcing an import or removing it. Shared by routes/sonarr.js's /queue route and
// lib/issueWatchdog.js, which feeds these into the Alerts panel/push pipeline.
//
// Grouped by episode via groupQueueRecordsByEpisode (see lib/grabStatus.js for
// why) — one row per episode; `queueIds` lets the caller still act on every
// underlying Sonarr queue record.
async function fetchImportQueue() {
  const { data } = await axios.get(`${process.env.SONARR_URL}/api/v3/queue`, {
    params: { includeSeries: true, includeEpisode: true, pageSize: 50 },
    headers: { 'X-Api-Key': process.env.SONARR_API_KEY }
  });
  const stuck = (data.records || []).filter(r => r.trackedDownloadStatus && r.trackedDownloadStatus !== 'ok');

  return groupQueueRecordsByEpisode(stuck).map(({ record: r, queueIds, episodeId, reason }) => {
    const seriesTitle = r.series?.title;
    const epLabel = r.episode ? ` — S${r.episode.seasonNumber}E${r.episode.episodeNumber}` : '';
    return {
      id: r.id,
      queueIds,
      episodeId,
      title: seriesTitle ? `${seriesTitle}${epLabel}` : r.title,
      poster: r.series?.images?.find(i => i.coverType === 'poster')?.remoteUrl || null,
      status: r.trackedDownloadStatus,
      reason,
      // Needed to look up manual-import candidates for this specific download —
      // Sonarr's own /manualimport lookup is keyed by downloadId, not queue id.
      // When grouped, this is only the first record's download — Force Import
      // resolves the episode either way, and Remove clears every queueId.
      downloadId: r.downloadId || null
    };
  });
}

// Monitored episodes that have actually aired but still have no file — i.e. things
// genuinely worth manually searching for, not stuff that's simply not out yet.
// Shared by routes/owner.js's /wanted route and lib/issueWatchdog.js.
//
// `id` (Sonarr's own internal episode id, distinct from tvdbId) is carried
// through so routes/owner.js's /wanted/search-all can hand these straight to
// Sonarr's EpisodeSearch command below without a second lookup.
async function fetchMissingEpisodes() {
  const { data } = await axios.get(`${process.env.SONARR_URL}/api/v3/wanted/missing`, {
    params: { pageSize: 50, includeSeries: true, sortKey: 'airDateUtc', sortDirection: 'descending' },
    headers: { 'X-Api-Key': process.env.SONARR_API_KEY }
  });
  const now = Date.now();
  return data.records
    .filter(e => e.airDateUtc && new Date(e.airDateUtc).getTime() <= now)
    .map(e => ({
      id: e.id,
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

// Sonarr's own automatic search — the same action its own "Search All Missing"
// button triggers, so release selection follows Sonarr's real quality-profile/
// indexer rules instead of this app re-implementing that decision logic.
async function searchMissingEpisodes(episodeIds) {
  if (!episodeIds.length) return true;
  await axios.post(`${process.env.SONARR_URL}/api/v3/command`,
    { name: 'EpisodeSearch', episodeIds },
    { headers: { 'X-Api-Key': process.env.SONARR_API_KEY } }
  );
  return true;
}

// Server-side counterpart to routes/sonarr.js's /releases + /releases/grab —
// see radarrClient.js's autoFixMovie for the full rationale (same pattern,
// two lookups first since release search is per-episode here).
async function autoFixEpisode(tvdbId, season, episode) {
  const { data: seriesList } = await axios.get(`${process.env.SONARR_URL}/api/v3/series`, {
    params: { tvdbId },
    headers: { 'X-Api-Key': process.env.SONARR_API_KEY }
  });
  const series = seriesList[0];
  if (!series) return { ok: false, reason: 'not_tracked' };

  const { data: episodes } = await axios.get(`${process.env.SONARR_URL}/api/v3/episode`, {
    params: { seriesId: series.id, seasonNumber: season },
    headers: { 'X-Api-Key': process.env.SONARR_API_KEY }
  });
  const ep = episodes.find(e => e.episodeNumber === episode);
  if (!ep) return { ok: false, reason: 'not_tracked' };

  const { data: releases } = await axios.get(`${process.env.SONARR_URL}/api/v3/release`, {
    params: { episodeId: ep.id },
    headers: { 'X-Api-Key': process.env.SONARR_API_KEY },
    timeout: 60000
  });
  const best = releases.find(r => !r.rejected);
  if (!best) return { ok: false, reason: 'no_eligible_release' };

  await axios.post(`${process.env.SONARR_URL}/api/v3/release`, { guid: best.guid, indexerId: best.indexerId }, {
    headers: { 'X-Api-Key': process.env.SONARR_API_KEY }
  });
  return { ok: true, episodeId: ep.id, releaseTitle: best.title };
}

// Same classification as routes/sonarr.js's /grab-status, callable directly
// from a background poll loop instead of over HTTP.
async function checkEpisodeGrabStatus(episodeId, sinceMs) {
  const { data: queueData } = await axios.get(`${process.env.SONARR_URL}/api/v3/queue`, {
    params: { pageSize: 200 },
    headers: { 'X-Api-Key': process.env.SONARR_API_KEY }
  });
  const rec = (queueData.records || []).find(r => r.episodeId === episodeId);
  if (rec) return classifyQueueRecord(rec);

  const { data: ep } = await axios.get(`${process.env.SONARR_URL}/api/v3/episode/${episodeId}`, {
    headers: { 'X-Api-Key': process.env.SONARR_API_KEY }
  });
  let file = null;
  if (ep.hasFile && ep.episodeFileId) {
    const { data: epFile } = await axios.get(`${process.env.SONARR_URL}/api/v3/episodefile/${ep.episodeFileId}`, {
      headers: { 'X-Api-Key': process.env.SONARR_API_KEY }
    });
    file = mapFileInfo(epFile);
  }
  if (file && !isFileFromThisGrab(file, sinceMs)) return { stage: 'unknown' };
  return { stage: file ? 'done' : 'unknown', file };
}

module.exports = {
  fetchImportQueue, fetchMissingEpisodes, searchMissingEpisodes,
  autoFixEpisode, checkEpisodeGrabStatus
};
