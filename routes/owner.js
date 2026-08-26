const express = require('express');
const requireAuth = require('./requireAuth');
const requireOwner = require('./requireOwner');
const settle = require('../lib/settle');
const uptimeKuma = require('../lib/uptimeKuma');
const ups = require('../lib/ups');
const loginLog = require('../lib/loginLog');
const streamOrigins = require('../lib/streamOrigins');
const auditLog = require('../lib/auditLog');
const dbBackup = require('../lib/dbBackup');
const mediaCache = require('../lib/mediaCache');
const diskSpaceHistory = require('../lib/diskSpaceHistory');
const cleanupCandidates = require('../lib/cleanupCandidates');
const { annotateAndSort } = require('../lib/stuckRequests');
const { fetchMissingMovies, searchMissingMovies } = require('../lib/radarrClient');
const { fetchMissingEpisodes, searchMissingEpisodes } = require('../lib/sonarrClient');
const router = express.Router();

router.get('/status', requireAuth, requireOwner, async (req, res) => {
  const [monitors, upsStatus] = await Promise.all([
    settle('uptime-kuma read', uptimeKuma.getMonitors(), []),
    settle('UPS query', ups.getStatus(), null)
  ]);
  res.json({ monitors, ups: upsStatus });
});

router.get('/logins', requireAuth, requireOwner, async (req, res) => {
  try {
    const logins = await loginLog.recent(20);
    res.json(logins.map(l => ({ username: l.username, thumb: l.thumb, isOwner: !!l.is_owner, at: l.at })));
  } catch (err) {
    console.error('login log read error', err.message);
    res.status(500).json({ error: 'Could not read sign-in history' });
  }
});

const STREAM_ORIGINS_RANGES = new Set(['30d', '90d', 'ytd', 'all']);

router.get('/stream-origins', requireAuth, requireOwner, async (req, res) => {
  const range = STREAM_ORIGINS_RANGES.has(req.query.range) ? req.query.range : 'ytd';
  try {
    const locations = await streamOrigins.topLocations({ range });
    // SERVER_LAT/SERVER_LON are optional (Settings -> Edit Deployment Settings, same
    // generic mechanism as any other unclaimed .env field — no dedicated route/UI
    // needed). Unset entirely is a real, supported state: the panel falls back to the
    // original heat-point rendering with no server point to draw arcs to.
    const lat = Number(process.env.SERVER_LAT);
    const lon = Number(process.env.SERVER_LON);
    const server = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    res.json({ locations, server });
  } catch (err) {
    console.error('stream origins read error', err.message);
    res.status(500).json({ error: 'Could not read stream origins' });
  }
});

router.get('/audit', requireAuth, requireOwner, async (req, res) => {
  try {
    res.json(await auditLog.recent(req.query.limit));
  } catch (err) {
    console.error('audit log read error', err.message);
    res.status(500).json({ error: 'Could not read audit history' });
  }
});

router.get('/db-backups', requireAuth, requireOwner, async (req, res) => {
  try {
    res.json({ backups: dbBackup.listRecentBackups(req.query.limit), retentionDays: dbBackup.RETENTION_DAYS });
  } catch (err) {
    console.error('db backup list error', err.message);
    res.status(500).json({ error: 'Could not read backup history' });
  }
});

// Runs the same backup+prune pass the daily scheduler runs (lib/dbBackup.js)
// on demand — useful right before a risky change, or just to confirm the
// pipeline is actually healthy rather than waiting up to 24h to find out.
router.post('/db-backups/run', requireAuth, requireOwner, async (req, res) => {
  try {
    const result = await dbBackup.runBackupAndPrune();
    auditLog.record({ kind: 'admin', action: 'POST /api/owner/db-backups/run', actorId: req.session.user.id,
      actorName: req.session.user.username, success: true, statusCode: 200,
      detail: { results: result.results }, ...auditLog.requestContext(req) })
      .catch((err) => console.error('audit log write error:', err.message));
    res.json(result);
  } catch (err) {
    console.error('db backup run error', err.message);
    res.status(500).json({ error: err.message || 'Backup failed' });
  }
});

router.get('/media-cache', requireAuth, requireOwner, async (req, res) => {
  try {
    await mediaCache.ensureIndex();
    res.json(mediaCache.stats());
  } catch (err) {
    console.error('media cache stats error', err.message);
    res.status(500).json({ error: 'Could not read cache stats' });
  }
});

router.post('/media-cache/flush', requireAuth, requireOwner, async (req, res) => {
  try {
    const result = await mediaCache.flush();
    auditLog.record({ kind: 'admin', action: 'POST /api/owner/media-cache/flush', actorId: req.session.user.id,
      actorName: req.session.user.username, success: true, statusCode: 200,
      detail: result, ...auditLog.requestContext(req) })
      .catch((err) => console.error('audit log write error:', err.message));
    res.json(result);
  } catch (err) {
    console.error('media cache flush error', err.message);
    res.status(500).json({ error: err.message || 'Flush failed' });
  }
});

// Monitored movies/episodes that have actually been released but still have no
// file — i.e. things genuinely worth manually searching for, not stuff that's
// simply not out yet. Fetch logic lives in lib/radarrClient.js/lib/
// sonarrClient.js — shared with lib/issueWatchdog.js, which feeds stuck items
// into the Alerts panel/push pipeline. The shape returned matches exactly
// what the release-search modal expects (mediaType/tmdbId or
// tvdbId+season+episode/title), so "Search" on a row can open it directly
// with no translation step.
//
// Sorted most-overdue-first with a `stuck` flag (see lib/stuckRequests.js)
// on releases that have been out long enough with no file to be worth
// flagging, rather than a separate list the owner has to think to check.
router.get('/wanted', requireAuth, requireOwner, async (req, res) => {
  const [movies, episodes] = await Promise.all([
    settle('radarr wanted', fetchMissingMovies(), []),
    settle('sonarr wanted', fetchMissingEpisodes(), [])
  ]);
  res.json(annotateAndSort([...movies, ...episodes]));
});

// Triggers Radarr's/Sonarr's own automatic search — the same action their own
// native "Search All Missing" buttons trigger — for every item currently on
// the Wanted/Missing list, rather than the per-row "Search" button above
// (which opens the interactive release-search modal for one item at a time).
// Re-fetches the list itself server-side instead of trusting ids from the
// client, so this always searches what's actually still missing right now,
// not a possibly-stale client-side snapshot. One service being unreachable
// doesn't block the other (settle), so a Sonarr hiccup still lets movies search.
router.post('/wanted/search-all', requireAuth, requireOwner, async (req, res) => {
  const [movies, episodes] = await Promise.all([
    settle('radarr wanted', fetchMissingMovies(), []),
    settle('sonarr wanted', fetchMissingEpisodes(), [])
  ]);
  const movieIds = movies.map(m => m.id).filter(Number.isInteger);
  const episodeIds = episodes.map(e => e.id).filter(Number.isInteger);

  const [radarrOk, sonarrOk] = await Promise.all([
    settle('radarr search-all', searchMissingMovies(movieIds), false),
    settle('sonarr search-all', searchMissingEpisodes(episodeIds), false)
  ]);

  auditLog.record({ kind: 'admin', action: 'POST /api/owner/wanted/search-all', actorId: req.session.user.id,
    actorName: req.session.user.username, success: radarrOk && sonarrOk, statusCode: 200,
    detail: { movies: movieIds.length, episodes: episodeIds.length, radarrOk, sonarrOk }, ...auditLog.requestContext(req) })
    .catch((err) => console.error('audit log write error:', err.message));

  res.json({ movies: movieIds.length, episodes: episodeIds.length, radarrOk, sonarrOk });
});

// Prefers real physical-volume data read directly off MEDIA_MOUNT_DIR (see
// lib/mediaStorage.js) when configured — independent of Radarr/Sonarr, whose
// diskspace API only reflects whatever root folders those two apps happen to
// have configured, not the NAS's actual storage pools. Falls back to the
// Radarr/Sonarr diskspace API for deployments with no NAS mount available.
router.get('/diskspace', requireAuth, requireOwner, async (req, res) => {
  res.json(await diskSpaceHistory.getCurrentRows());
});

// Trend line + "days until full" projection per volume, from the hourly
// snapshots lib/diskSpaceHistory.js has been recording — see that module
// for why this reuses the exact same current-rows logic as /diskspace
// above instead of a second copy.
router.get('/diskspace/history', requireAuth, requireOwner, async (req, res) => {
  res.json(await diskSpaceHistory.getHistoryWithProjection());
});

// Movies sitting on disk that are quietly never (or barely) watched — see
// lib/cleanupCandidates.js for exactly what qualifies and why this is
// movies-only for now.
router.get('/cleanup-candidates', requireAuth, requireOwner, async (req, res) => {
  try {
    res.json(await cleanupCandidates.getCandidates());
  } catch (err) {
    console.error('cleanup candidates error:', err.message);
    res.status(502).json({ error: 'Could not check for cleanup candidates' });
  }
});

module.exports = router;
