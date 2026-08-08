const express = require('express');
const axios = require('axios');
const requireAuth = require('./requireAuth');
const requireOwner = require('./requireOwner');
const settle = require('../lib/settle');
const uptimeKuma = require('../lib/uptimeKuma');
const ups = require('../lib/ups');
const loginLog = require('../lib/loginLog');
const auditLog = require('../lib/auditLog');
const mediaStorage = require('../lib/mediaStorage');
const { shortestLabelRows, combinedLabelRows } = require('../lib/diskspace');
const { annotateAndSort } = require('../lib/stuckRequests');
const { fetchMissingMovies } = require('../lib/radarrClient');
const { fetchMissingEpisodes } = require('../lib/sonarrClient');
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

router.get('/audit', requireAuth, requireOwner, async (req, res) => {
  try {
    res.json(await auditLog.recent(req.query.limit));
  } catch (err) {
    console.error('audit log read error', err.message);
    res.status(500).json({ error: 'Could not read audit history' });
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

// Prefers real physical-volume data read directly off MEDIA_MOUNT_DIR (see
// lib/mediaStorage.js) when configured — independent of Radarr/Sonarr, whose
// diskspace API only reflects whatever root folders those two apps happen to
// have configured, not the NAS's actual storage pools. Falls back to the
// Radarr/Sonarr diskspace API for deployments with no NAS mount available.
router.get('/diskspace', requireAuth, requireOwner, async (req, res) => {
  const fsVolumes = await mediaStorage.getVolumes();
  if (fsVolumes.length) {
    return res.json(combinedLabelRows(fsVolumes));
  }

  // Radarr and Sonarr both report every mount point their own container
  // sees — confirmed live that this setup has them sharing several (/,
  // /config, /downloads/completed all report identical byte counts from
  // both services, since they're the same underlying host volumes).
  const [radarr, sonarr] = await Promise.all([
    settle('radarr diskspace', axios.get(`${process.env.RADARR_URL}/api/v3/diskspace`, {
      headers: { 'X-Api-Key': process.env.RADARR_API_KEY }
    }).then(r => r.data), []),
    settle('sonarr diskspace', axios.get(`${process.env.SONARR_URL}/api/v3/diskspace`, {
      headers: { 'X-Api-Key': process.env.SONARR_API_KEY }
    }).then(r => r.data), [])
  ]);
  const volumes = [...radarr, ...sonarr].map(d => ({
    label: d.label || d.path,
    totalBytes: d.totalSpace,
    freeBytes: d.freeSpace
  }));
  res.json(shortestLabelRows(volumes));
});

module.exports = router;
