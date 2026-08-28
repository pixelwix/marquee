const parseTimeleft = require('./parseTimeleft');

// Classifies a single Radarr/Sonarr queue record into the stage the
// post-grab tracking UI shows. Uses the same trackedDownloadStatus/status
// fields the existing Import Issues queue endpoint already keys off — this
// just maps them into a friendlier state machine (downloading -> importing
// -> done/failed) shown live on the row that was just grabbed, instead of
// only surfacing a problem after the fact in a separate panel.
function classifyQueueRecord(rec) {
  if (rec.trackedDownloadStatus && rec.trackedDownloadStatus !== 'ok') {
    return {
      stage: 'failed',
      reason: (rec.statusMessages || []).flatMap(s => s.messages || []).join('; ') || rec.errorMessage || 'Import issue',
      downloadId: rec.downloadId || null
    };
  }
  // The download itself is done but Radarr/Sonarr hasn't run its import pass
  // yet — a normal, usually brief, in-between state, not a problem.
  if (rec.status === 'completed') {
    return { stage: 'importing' };
  }
  const progress = rec.size ? Math.round(((rec.size - rec.sizeleft) / rec.size) * 100) : null;
  return { stage: 'downloading', progress, eta: parseTimeleft(rec.timeleft) };
}

// A file already existing when grab-status is polled isn't automatically
// confirmation THIS grab succeeded — the whole point of the "resolve an
// issue" flow is replacing a file that's already there, so hasFile is true
// both before and after a real replace. Only treat it as done once the
// file's own dateAdded is at/after the grab's start time — sinceMs is
// captured client-side the moment the grab was fired, with a small buffer
// for clock skew between this server and Radarr/Sonarr's own host clock.
const CLOCK_SKEW_BUFFER_MS = 10000;
function isFileFromThisGrab(file, sinceMs) {
  if (!sinceMs) return true; // no baseline given (e.g. an older caller) — can't tell, assume yes
  if (!file?.dateAdded) return false;
  return new Date(file.dateAdded).getTime() >= sinceMs - CLOCK_SKEW_BUFFER_MS;
}

// Groups raw Sonarr queue records by episode before lib/sonarrClient.js's
// fetchImportQueue maps them for display. A batch of newly-aired episodes
// all hitting the same "TBA title" rejection at once (see TBA_REJECTION_RE
// in routes/sonarr.js) can leave Sonarr's own queue with several simultaneous
// records for the SAME episode — the original pack's file, plus another
// release Sonarr's automatic search grabbed later because the episode still
// looked missing while the first one stayed stuck. Without this, both the
// owner-facing Import Issues list and the Alerts panel showed the identical
// episode repeated once per competing download — verified live against a
// real "Beauty in Black" S3 pack drop (2026-08-27) that produced exactly
// this (the same 8 episodes, several 2-3x over).
//
// Pure — takes and returns plain records, no network/filesystem access, so
// this is testable directly rather than only through a live Sonarr call.
function groupQueueRecordsByEpisode(records) {
  const groups = new Map();
  for (const r of records) {
    // Falls back to the record's own id when there's genuinely no episode
    // (shouldn't normally happen for a Sonarr queue record) so it still gets
    // its own group instead of colliding with an unrelated one.
    const groupKey = r.episodeId ?? `queue-${r.id}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(r);
  }

  return [...groups.values()].map(group => {
    const r = group[0];
    const reasons = [...new Set(group.flatMap(rec => (rec.statusMessages || []).flatMap(s => s.messages || [])))];
    const reason = reasons.join('; ') || r.errorMessage || 'Import issue';
    return {
      record: r,
      queueIds: group.map(rec => rec.id),
      episodeId: r.episodeId ?? null,
      reason: group.length > 1 ? `${reason} (${group.length} pending downloads)` : reason
    };
  });
}

module.exports = { classifyQueueRecord, isFileFromThisGrab, groupQueueRecordsByEpisode };
