const { adminClient } = require('./overseerrClient');
const radarrClient = require('./radarrClient');
const sonarrClient = require('./sonarrClient');
const pushNotify = require('./pushNotify');

// Fast checks while a grab usually finishes, then once a minute: a 10 GB movie
// routinely takes 10+ minutes from grab to import (Prometheus, 2026-10-08: 11),
// and the old 5-minute cutoff left fixed reports open. lib/issueFixSweep.js
// still catches anything that outlasts even this.
const POLL_INTERVAL_MS = 4000;
const SLOW_POLL_AFTER_MS = 5 * 60 * 1000;
const SLOW_POLL_INTERVAL_MS = 60 * 1000;
const POLL_TIMEOUT_MS = 6 * 60 * 60 * 1000;

// Same search -> grab -> track flow as the admin's manual "Auto Fix" button
// (public/admin.js's runAutoFix/trackAutoFix), just triggered automatically
// the moment a playback-related issue comes in (see routes/overseerr.js's
// POST /issue) instead of waiting for an owner to click anything. Only
// resolves the report on a *confirmed* replacement — anything else (nothing
// eligible, import failure, timeout) notifies the owner instead of silently
// giving up or falsely marking it fixed.
//
// Guards against the same episode/movie getting grabbed multiple times when
// several family members report the same broken file within moments of each
// other — each report is its own Overseerr issue, but they'd all resolve to
// the same underlying media/episode.
const inFlight = new Set();
function keyFor(mediaType, tmdbId, season, episode) {
  return `${mediaType}:${tmdbId}:${season || ''}:${episode || ''}`;
}

async function attempt({ issueId, mediaType, tmdbId, tvdbId, season, episode, title }) {
  const key = keyFor(mediaType, tmdbId, season, episode);
  if (inFlight.has(key)) return;
  inFlight.add(key);
  const done = () => inFlight.delete(key);

  const label = season ? `${title} — S${season}E${episode}` : title;
  const startedAt = Date.now();

  let grabResult;
  try {
    grabResult = mediaType === 'movie'
      ? await radarrClient.autoFixMovie(tmdbId)
      : await sonarrClient.autoFixEpisode(tvdbId, season, episode);
  } catch (err) {
    done();
    return notifyNeedsAttention(label, `Auto-fix search failed: ${err.message}`);
  }

  if (!grabResult.ok) {
    done();
    const reason = grabResult.reason === 'no_eligible_release'
      ? 'No release found that clears your quality profile'
      : 'Title isn’t tracked in Radarr/Sonarr';
    return notifyNeedsAttention(label, reason);
  }

  const trackKey = mediaType === 'movie' ? grabResult.movieId : grabResult.episodeId;
  track({ issueId, label, mediaType, trackKey, startedAt, done });
}

// Polls Radarr/Sonarr until the grab is imported (resolves the issue), fails or
// times out (notifies the owner). Runs on the server, so it no longer matters
// whether the admin page that started a manual Auto Fix stays open.
function track({ issueId, label, mediaType, trackKey, startedAt, done }) {
  const checkStatus = mediaType === 'movie' ? radarrClient.checkMovieGrabStatus : sonarrClient.checkEpisodeGrabStatus;
  const next = () => setTimeout(poll, Date.now() - startedAt > SLOW_POLL_AFTER_MS ? SLOW_POLL_INTERVAL_MS : POLL_INTERVAL_MS);

  const poll = async () => {
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      done();
      return notifyNeedsAttention(label, 'Grab is taking a while — check Import Issues');
    }
    let status;
    try {
      status = await checkStatus(trackKey, startedAt);
    } catch (err) {
      next();
      return;
    }
    if (status.stage === 'failed') {
      done();
      return notifyNeedsAttention(label, status.reason || 'Import failed — force import needed');
    }
    if (status.stage === 'done') {
      done();
      try {
        await adminClient.post(`/issue/${issueId}/resolved`);
      } catch (err) {
        console.error('auto-fix resolve error', err.message);
      }
      return;
    }
    next();
  };
  poll();
}

// The admin's manual Auto Fix button grabs from the browser (public/admin.js's
// runAutoFix), then hands tracking to the server here.
async function trackManual({ issueId, mediaType, tmdbId, tvdbId, season, episode, title, startedAt }) {
  const key = keyFor(mediaType, tmdbId, season, episode);
  if (inFlight.has(key)) return;
  const trackKey = mediaType === 'movie'
    ? await radarrClient.findMovieId(tmdbId)
    : await sonarrClient.findEpisodeId(tvdbId, season, episode);
  if (!trackKey) return;
  inFlight.add(key);
  const label = season ? `${title} — S${season}E${episode}` : title;
  track({ issueId, label, mediaType, trackKey, startedAt, done: () => inFlight.delete(key) });
}

function notifyNeedsAttention(label, reason) {
  return pushNotify.notifyOwners({
    title: 'Auto-fix needs your help',
    body: `${label}: ${reason}`,
    url: '/admin'
  }).catch(err => console.error('auto-fix notify error', err.message));
}

module.exports = { attempt, trackManual };
