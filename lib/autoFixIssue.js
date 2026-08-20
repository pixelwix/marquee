const { adminClient } = require('./overseerrClient');
const radarrClient = require('./radarrClient');
const sonarrClient = require('./sonarrClient');
const pushNotify = require('./pushNotify');

const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

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
  const checkStatus = mediaType === 'movie' ? radarrClient.checkMovieGrabStatus : sonarrClient.checkEpisodeGrabStatus;

  const poll = async () => {
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      done();
      return notifyNeedsAttention(label, 'Grab is taking a while — check Import Issues');
    }
    let status;
    try {
      status = await checkStatus(trackKey, startedAt);
    } catch (err) {
      setTimeout(poll, POLL_INTERVAL_MS);
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
    setTimeout(poll, POLL_INTERVAL_MS);
  };
  poll();
}

function notifyNeedsAttention(label, reason) {
  return pushNotify.notifyOwners({
    title: 'Auto-fix needs your help',
    body: `${label}: ${reason}`,
    url: '/admin'
  }).catch(err => console.error('auto-fix notify error', err.message));
}

module.exports = { attempt };
