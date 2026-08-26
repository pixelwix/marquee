const axios = require('axios');

// Surfaces movies that are quietly taking up real space without being
// watched — reuses Tautulli's own get_library_media_info, which already
// computes file_size/last_played/play_count per item, rather than cross-
// referencing Radarr's file API with Tautulli's watch history separately.
//
// Movies only for now: the same endpoint against a TV section returns
// show-level rows with file_size/last_played/play_count all blank —
// Tautulli doesn't roll those up per-show the way it does for a movie's
// single file, and aggregating our own totals across every episode under
// each show (by grandparent_rating_key) is enough extra work to leave as a
// known follow-up rather than ship half-verified.
//
// Two flagging rules, mirroring lib/stuckRequests.js's own "give it time
// before flagging" shape:
// - never watched, but old enough that "just hasn't gotten to it yet"
//   stops being the likely explanation
// - watched exactly once, long enough ago that a rewatch isn't obviously
//   imminent
const NEVER_WATCHED_GRACE_DAYS = 60;
const STALE_REWATCH_DAYS = 180;

function tautulliConfigured() {
  return !!(process.env.TAUTULLI_URL && process.env.TAUTULLI_API_KEY);
}

async function fetchMovieLibrary(sectionId) {
  const { data } = await axios.get(`${process.env.TAUTULLI_URL}/api/v2`, {
    params: { apikey: process.env.TAUTULLI_API_KEY, cmd: 'get_library_media_info', section_id: sectionId, length: 10000 },
    timeout: 15000
  });
  if (data.response?.result !== 'success') throw new Error(data.response?.message || 'Unexpected response');
  return data.response.data.data || [];
}

function daysSince(epochSeconds, now) {
  return Math.floor((now - epochSeconds * 1000) / 86400000);
}

function classify(row, now) {
  const size = Number(row.file_size) || 0;
  if (!size) return null; // nothing on disk to reclaim
  const addedDays = daysSince(Number(row.added_at), now);
  const playCount = row.play_count ? Number(row.play_count) : 0;
  if (playCount === 0) {
    if (addedDays < NEVER_WATCHED_GRACE_DAYS) return null;
    return { sizeBytes: size, playCount, reason: `Never watched, added ${addedDays} days ago` };
  }
  if (playCount === 1 && row.last_played) {
    const lastPlayedDays = daysSince(Number(row.last_played), now);
    if (lastPlayedDays < STALE_REWATCH_DAYS) return null;
    return { sizeBytes: size, playCount, reason: `Watched once, ${lastPlayedDays} days ago` };
  }
  return null;
}

async function getCandidates({ now = Date.now() } = {}) {
  if (!tautulliConfigured() || !process.env.TAUTULLI_SECTION_MOVIES) return [];
  const rows = await fetchMovieLibrary(process.env.TAUTULLI_SECTION_MOVIES);
  const candidates = [];
  for (const r of rows) {
    const flagged = classify(r, now);
    if (!flagged) continue;
    candidates.push({
      ratingKey: r.rating_key,
      title: r.title,
      year: r.year || null,
      ...flagged
    });
  }
  candidates.sort((a, b) => b.sizeBytes - a.sizeBytes);
  return candidates;
}

module.exports = { getCandidates, classify, NEVER_WATCHED_GRACE_DAYS, STALE_REWATCH_DAYS };
