// Real library stats for the welcome email — same Tautulli API surface
// lib/monthlyRecap.js already uses, just two different cmds. Pure data-gathering,
// no rendering (see lib/welcomeEmailTemplate.js).
const axios = require('axios');

function tautulliBase() {
  return { base: `${process.env.TAUTULLI_URL}/api/v2`, apikey: process.env.TAUTULLI_API_KEY };
}

/** Pure — sums Tautulli's own per-library item counts by section type, rather than
 * hardcoding which library names count as "movies" vs "shows" (this app has three
 * show-type libraries — TV Shows, Anime, Workouts — see TAUTULLI_SECTION_* in
 * .env.example). Testable without a network call. */
function summarizeLibraries(libraries) {
  let movies = 0;
  let series = 0;
  for (const lib of libraries) {
    if (lib.section_type === 'movie') movies += Number(lib.count) || 0;
    else if (lib.section_type === 'show') series += Number(lib.count) || 0;
  }
  return { movies, series };
}

async function fetchLibraryCounts() {
  const { base, apikey } = tautulliBase();
  const { data } = await axios.get(base, { params: { apikey, cmd: 'get_libraries' } });
  return summarizeLibraries(data.response.data || []);
}

// Grounds the "gets new stuff all the time" claim in a real number instead of just
// asserting it — counts items actually added within the window rather than trusting
// get_recently_added's own ordering/paging to stop at the right place, since it
// returns newest-first with no date filter param, only a count.
const RECENT_WINDOW_DAYS = 7;
const RECENT_FETCH_COUNT = 500;

function countAddedWithin(items, days, now = Date.now()) {
  const cutoff = now / 1000 - days * 86400;
  return items.filter((i) => Number(i.added_at) >= cutoff).length;
}

async function fetchRecentAddCount() {
  const { base, apikey } = tautulliBase();
  const { data } = await axios.get(base, {
    params: { apikey, cmd: 'get_recently_added', count: RECENT_FETCH_COUNT },
  });
  const items = data.response.data.recently_added || [];
  return countAddedWithin(items, RECENT_WINDOW_DAYS);
}

async function fetchInviteStats() {
  const [{ movies, series }, addedThisWeek] = await Promise.all([
    fetchLibraryCounts(),
    fetchRecentAddCount(),
  ]);
  return { movies, series, addedThisWeek };
}

module.exports = {
  summarizeLibraries,
  countAddedWithin,
  fetchLibraryCounts,
  fetchRecentAddCount,
  fetchInviteStats,
  RECENT_WINDOW_DAYS,
};
