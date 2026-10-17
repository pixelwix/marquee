const { adminClient } = require('./overseerrClient');
const radarrClient = require('./radarrClient');
const sonarrClient = require('./sonarrClient');

// Safety net behind lib/autoFixIssue.js: every 15 minutes, any open Overseerr
// issue whose movie/episode has a file Radarr/Sonarr added AFTER the report
// came in gets a comment saying so and is resolved. Catches replacements that
// outlasted the auto-fix tracker, ones lost to a container restart, and files
// replaced by hand or by a normal upgrade. The reporter can reopen it in
// Overseerr if the new copy has the same problem.
//
// Only issues pinned to one movie or one episode: a whole-series or
// whole-season report can't be matched to a single file.
const INTERVAL_MS = 15 * 60 * 1000;
const FIRST_RUN_MS = 2 * 60 * 1000;

function log(msg) {
  console.log(`[issueFixSweep] ${msg}`);
}

function replacedOn(file) {
  return new Date(file.dateAdded).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: process.env.TZ || 'America/Chicago'
  });
}

async function currentFile(issue) {
  const media = issue.media || {};
  if (media.mediaType === 'movie' && media.tmdbId) return radarrClient.currentMovieFile(media.tmdbId);
  if (media.mediaType === 'tv' && media.tvdbId && issue.problemSeason > 0 && issue.problemEpisode > 0) {
    return sonarrClient.currentEpisodeFile(media.tvdbId, issue.problemSeason, issue.problemEpisode);
  }
  return null;
}

async function sweepOnce() {
  const { data } = await adminClient.get('/issue', { params: { filter: 'open', take: 100, sort: 'added' } });
  const resolved = [];
  for (const issue of data.results || []) {
    try {
      const file = await currentFile(issue);
      if (!file?.dateAdded || new Date(file.dateAdded).getTime() <= new Date(issue.createdAt).getTime()) continue;
      const copy = file.quality ? `a new ${file.quality} copy` : 'a new copy';
      // The note is for the reporter; resolving matters more, so a failed comment doesn't block it.
      await adminClient.post(`/issue/${issue.id}/comment`, {
        message: `Fixed automatically: replaced with ${copy} on ${replacedOn(file)}. Reopen this if it’s still a problem.`
      }).catch(err => log(`issue ${issue.id} comment failed: ${err.message}`));
      await adminClient.post(`/issue/${issue.id}/resolved`);
      resolved.push(issue.id);
    } catch (err) {
      log(`issue ${issue.id} check failed: ${err.message}`);
    }
  }
  if (resolved.length) log(`resolved ${resolved.length} fixed issue(s): #${resolved.join(', #')}`);
  return resolved;
}

function start() {
  const run = () => sweepOnce().catch(err => log(`sweep failed: ${err.message}`));
  setTimeout(() => { run(); setInterval(run, INTERVAL_MS); }, FIRST_RUN_MS);
}

module.exports = { start, sweepOnce };
