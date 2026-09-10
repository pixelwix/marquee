// Pure helpers for the per-user "My Stats" tab — Tautulli's get_history
// returns raw session-level rows, so the grouping/streak logic that turns
// those into display-ready numbers lives here (testable without hitting the
// API), same split as lib/stuckRequests.js.

function dayKey(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

// Longest run of consecutive calendar days (UTC) with at least one play,
// counted backward from today. A day with zero plays "so far" (i.e. today,
// still in progress) doesn't break an existing streak the way a genuinely
// empty day does — so if nothing's logged yet today but yesterday had a
// play, the streak still counts as live and starts counting from yesterday.
function computeStreak(historyRows, now = Date.now()) {
  const days = new Set(historyRows.map(r => dayKey(r.date)));
  const todayKey = new Date(now).toISOString().slice(0, 10);
  let cursor = days.has(todayKey) ? new Date(now) : new Date(now - 86400000);
  let streak = 0;
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - 86400000);
  }
  return streak;
}

// Groups episode-level rows under their parent show (same idea as
// showIdentity() in routes/tautulli.js) so a season binge counts toward the
// show once, not fragmented into per-episode entries. Movies have no parent,
// so they group by their own rating_key. No poster/thumb is resolved here —
// the Most Watched list is text-only (medal + title + play count), so there's
// no need to round-trip get_metadata per result the way an earlier version did.
function computeTopWatched(historyRows, limit = 3) {
  const groups = new Map();
  for (const r of historyRows) {
    const key = r.grandparent_rating_key || r.rating_key;
    if (!groups.has(key)) {
      groups.set(key, { title: r.grandparent_title || r.title, plays: 0 });
    }
    groups.get(key).plays += 1;
  }
  return [...groups.values()].sort((a, b) => b.plays - a.plays).slice(0, limit);
}

// 1-based position in a plays-sorted leaderboard, or null if this user isn't
// in it at all (e.g. zero plays in the window, so Tautulli never listed them).
function computeRank(topUsersRows, userId) {
  const idx = topUsersRows.findIndex(u => String(u.user_id) === String(userId));
  return idx === -1 ? null : idx + 1;
}

// Tautulli's get_plays_by_dayofweek/get_plays_by_hourofday share this same
// { categories: [...], series: [{ name, data: [...] }] } shape — this reads
// out just the Movies/TV series (Live TV is intentionally dropped; this
// deployment has no live sessions, so that series is always all-zero) and
// converts seconds to hours, rounded to one decimal for display.
function parseActivitySeries(categories, series) {
  const dataFor = name => series.find(s => s.name === name)?.data || [];
  const movies = dataFor('Movies');
  const tv = dataFor('TV');
  const toHours = secs => Math.round(((secs || 0) / 3600) * 10) / 10;
  return categories.map((label, i) => ({ label, movies: toHours(movies[i]), tv: toHours(tv[i]) }));
}

// Every distinct TV show title this user has ever watched, per their raw
// get_history rows — powers the Airing Today "Just Mine" filter (see
// routes/tautulli.js's /my-shows, public/app.js's loadMyShows). Movies are
// deliberately excluded here (see routes/tautulli.js's own comment on why
// Releasing Soon's "Just Mine" uses Overseerr requests instead of watch
// history) — this only ever needs to answer "is this an ongoing show I
// already watch," which only applies to grandparent_title (episode) rows.
function extractWatchedTvTitles(historyRows) {
  const titles = new Set();
  for (const r of historyRows) {
    if (r.grandparent_title) titles.add(r.grandparent_title);
  }
  return [...titles];
}

// "YYYY-MM" calendar-month key (UTC), same basis as dayKey.
function monthKey(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 7);
}

// Plays + watched-seconds grouped by calendar month (UTC) from raw
// get_history rows. A history row's `duration` is the seconds actually
// watched for that session (Tautulli already nets out paused time), so
// summing it per month is a fair "hours that month" without a second API
// call for time stats.
function bucketByMonth(historyRows) {
  const months = new Map();
  for (const r of historyRows) {
    const k = monthKey(r.date);
    if (!months.has(k)) months.set(k, { plays: 0, seconds: 0 });
    const m = months.get(k);
    m.plays += 1;
    m.seconds += r.duration || 0;
  }
  return months;
}

// This-month vs last-month deltas (plays and hours). `now` selects the two
// calendar months to compare; a percentage is only returned when last month
// actually had activity, so a fresh January reads as null (— in the UI)
// rather than a meaningless "+100%". Hours rounded to one decimal to match
// the rest of the tab.
function computeMonthDeltas(historyRows, now = Date.now()) {
  const months = bucketByMonth(historyRows);
  const d = new Date(now);
  const curKey = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 7);
  const prevKey = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const cur = months.get(curKey) || { plays: 0, seconds: 0 };
  const was = months.get(prevKey) || { plays: 0, seconds: 0 };
  const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
  const hrs = s => Math.round((s / 3600) * 10) / 10;
  return {
    plays: { current: cur.plays, previous: was.plays, deltaPct: pct(cur.plays, was.plays) },
    hours: { current: hrs(cur.seconds), previous: hrs(was.seconds), deltaPct: pct(cur.seconds, was.seconds) }
  };
}

// Straight-line projection of full-year hours from hours-so-far and how far
// into the year we are. Deliberately naive (no seasonality) — a "keep this
// pace and you'll hit ~N" nudge under the hero, not a forecast.
function projectAnnualHours(hoursYearToDate, now = Date.now()) {
  const d = new Date(now);
  const dayOfYear = Math.floor((now - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
  if (dayOfYear < 1) return hoursYearToDate;
  return Math.round((hoursYearToDate / dayOfYear) * 365);
}

// Per-day { date, plays, hours } for the last `days` calendar days (UTC),
// oldest first, zero-filled for empty days — the exact shape the 12-week
// heatmap grid renders straight out.
function computeDailyActivity(historyRows, { now = Date.now(), days = 84 } = {}) {
  const byDay = new Map();
  for (const r of historyRows) {
    const k = dayKey(r.date);
    if (!byDay.has(k)) byDay.set(k, { plays: 0, seconds: 0 });
    const e = byDay.get(k);
    e.plays += 1;
    e.seconds += r.duration || 0;
  }
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const k = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
    const e = byDay.get(k) || { plays: 0, seconds: 0 };
    out.push({ date: k, plays: e.plays, hours: Math.round((e.seconds / 3600) * 10) / 10 });
  }
  return out;
}

// Longest run of consecutive calendar days (UTC) with at least one play
// anywhere in the supplied rows — unlike computeStreak, which only measures
// the run ending today/yesterday. Backs the "longest streak" record.
function longestDailyRun(historyRows) {
  const days = [...new Set(historyRows.map(r => dayKey(r.date)))].sort();
  let best = 0, run = 0, prev = null;
  for (const k of days) {
    run = prev && Date.parse(k) - Date.parse(prev) === 86400000 ? run + 1 : 1;
    if (run > best) best = run;
    prev = k;
  }
  return best;
}

// Personal records over whatever window `historyRows` covers (the route
// passes year-to-date rows, so the UI labels it "this year"): the single day
// with the most plays, the calendar month with the most plays, and the
// longest consecutive-day run. Null day/month when there's no history.
function computeRecords(historyRows) {
  const byDay = new Map();
  for (const r of historyRows) {
    const k = dayKey(r.date);
    byDay.set(k, (byDay.get(k) || 0) + 1);
  }
  let biggestDay = null;
  for (const [date, plays] of byDay) {
    if (!biggestDay || plays > biggestDay.plays) biggestDay = { date, plays };
  }
  let bestMonth = null;
  for (const [month, { plays }] of bucketByMonth(historyRows)) {
    if (!bestMonth || plays > bestMonth.plays) bestMonth = { month, plays };
  }
  return { longestStreak: longestDailyRun(historyRows), biggestDay, bestMonth };
}

// Plays + hours over the last 7 days (rolling), from the same rows the
// heatmap uses — a short-horizon number the rest of the tab lacks.
function computeThisWeek(historyRows, now = Date.now()) {
  const cutoff = now - 7 * 86400000;
  let plays = 0, seconds = 0;
  for (const r of historyRows) {
    if (r.date * 1000 >= cutoff) { plays += 1; seconds += r.duration || 0; }
  }
  return { plays, hours: Math.round((seconds / 3600) * 10) / 10 };
}

// Movies / TV / Anime play-count split for the year. Movie and Anime counts
// come from cheap section/media-type-filtered get_history calls in the route
// (Tautulli's raw history rows carry no section_id); TV is whatever's left
// once those are removed from the authoritative year total, clamped so a
// count mismatch can never render a negative bar.
function computeTypeSplit({ totalPlays = 0, moviePlays = 0, animePlays = 0 } = {}) {
  const movies = Math.max(0, moviePlays);
  const anime = Math.max(0, animePlays);
  const tv = Math.max(0, totalPlays - movies - anime);
  return { movies, tv, anime };
}

module.exports = {
  computeStreak, computeTopWatched, computeRank, parseActivitySeries, extractWatchedTvTitles,
  computeMonthDeltas, projectAnnualHours, computeDailyActivity, computeRecords, computeThisWeek,
  computeTypeSplit, longestDailyRun
};
