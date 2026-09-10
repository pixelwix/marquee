const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeStreak, computeTopWatched, computeRank, parseActivitySeries, extractWatchedTvTitles,
  computeMonthDeltas, projectAnnualHours, computeDailyActivity, computeRecords, computeThisWeek,
  computeTypeSplit, longestDailyRun
} = require('../lib/myStats');

const NOW = new Date('2026-07-27T18:00:00Z').getTime(); // a Monday, 18:00 UTC
const daysAgoTs = n => Math.floor((NOW - n * 86400000) / 1000); // Tautulli's `date` is unix seconds
const HOUR = 3600;

test('computeStreak counts today + consecutive prior days when today already has a play', () => {
  const rows = [{ date: daysAgoTs(0) }, { date: daysAgoTs(1) }, { date: daysAgoTs(2) }];
  assert.equal(computeStreak(rows, NOW), 3);
});

test('computeStreak still counts an ongoing streak when today has no plays yet', () => {
  const rows = [{ date: daysAgoTs(1) }, { date: daysAgoTs(2) }];
  assert.equal(computeStreak(rows, NOW), 2);
});

test('computeStreak stops at the first gap', () => {
  const rows = [{ date: daysAgoTs(0) }, { date: daysAgoTs(1) }, { date: daysAgoTs(5) }];
  assert.equal(computeStreak(rows, NOW), 2);
});

test('computeStreak is 0 when neither today nor yesterday has a play', () => {
  const rows = [{ date: daysAgoTs(3) }];
  assert.equal(computeStreak(rows, NOW), 0);
});

test('computeStreak is 0 for no history at all', () => {
  assert.equal(computeStreak([], NOW), 0);
});

test('computeTopWatched groups episodes under their show and counts each play', () => {
  const rows = [
    { grandparent_rating_key: 10, grandparent_title: 'Hana-Kimi' },
    { grandparent_rating_key: 10, grandparent_title: 'Hana-Kimi' },
    { rating_key: 20, title: 'Supergirl' }
  ];
  const result = computeTopWatched(rows);
  assert.deepEqual(result, [
    { title: 'Hana-Kimi', plays: 2 },
    { title: 'Supergirl', plays: 1 }
  ]);
});

test('computeTopWatched sorts by plays descending and respects the limit', () => {
  const rows = [
    { rating_key: 1, title: 'A' },
    { rating_key: 2, title: 'B' }, { rating_key: 2, title: 'B' },
    { rating_key: 3, title: 'C' }, { rating_key: 3, title: 'C' }, { rating_key: 3, title: 'C' }
  ];
  const result = computeTopWatched(rows, 2);
  assert.deepEqual(result.map(r => r.title), ['C', 'B']);
});

test('computeRank finds a 1-based position by user_id', () => {
  const rows = [{ user_id: 5, total_plays: 40 }, { user_id: 9, total_plays: 22 }, { user_id: 3, total_plays: 10 }];
  assert.equal(computeRank(rows, 9), 2);
  assert.equal(computeRank(rows, '3'), 3);
});

test('computeRank returns null when the user has no plays in the window', () => {
  const rows = [{ user_id: 5, total_plays: 40 }];
  assert.equal(computeRank(rows, 99), null);
});

test('parseActivitySeries converts seconds to hours and pairs by category index', () => {
  const categories = ['Sunday', 'Monday'];
  const series = [
    { name: 'TV', data: [5046, 17055] },
    { name: 'Movies', data: [0, 3600] },
    { name: 'Live TV', data: [0, 0] }
  ];
  assert.deepEqual(parseActivitySeries(categories, series), [
    { label: 'Sunday', movies: 0, tv: 1.4 },
    { label: 'Monday', movies: 1, tv: 4.7 }
  ]);
});

test('parseActivitySeries defaults to 0 when a series is missing entirely', () => {
  const categories = ['00', '01'];
  const series = [{ name: 'TV', data: [3600, 0] }];
  assert.deepEqual(parseActivitySeries(categories, series), [
    { label: '00', movies: 0, tv: 1 },
    { label: '01', movies: 0, tv: 0 }
  ]);
});

test('extractWatchedTvTitles returns each distinct show once, in no particular guaranteed order', () => {
  const rows = [
    { grandparent_title: 'Hana-Kimi' },
    { grandparent_title: 'Hana-Kimi' },
    { grandparent_title: 'Fruits Basket' }
  ];
  const titles = extractWatchedTvTitles(rows);
  assert.equal(titles.length, 2);
  assert.ok(titles.includes('Hana-Kimi'));
  assert.ok(titles.includes('Fruits Basket'));
});

test('extractWatchedTvTitles skips movie rows (no grandparent_title)', () => {
  const rows = [{ title: 'Oppenheimer' }, { grandparent_title: 'Fruits Basket' }];
  assert.deepEqual(extractWatchedTvTitles(rows), ['Fruits Basket']);
});

test('extractWatchedTvTitles returns an empty array for no history', () => {
  assert.deepEqual(extractWatchedTvTitles([]), []);
});

// ---- richer My Stats tab (v1.59.0) ----

test('computeMonthDeltas compares this calendar month against last', () => {
  // NOW is 2026-07-27. July rows: 3 plays / 3h. June rows: 2 plays / 1h.
  const rows = [
    { date: daysAgoTs(1), duration: HOUR }, { date: daysAgoTs(2), duration: HOUR }, { date: daysAgoTs(3), duration: HOUR },
    { date: daysAgoTs(40), duration: HOUR }, { date: daysAgoTs(41), duration: 0 }
  ];
  const d = computeMonthDeltas(rows, NOW);
  assert.deepEqual(d.plays, { current: 3, previous: 2, deltaPct: 50 });
  assert.equal(d.hours.current, 3);
  assert.equal(d.hours.previous, 1);
  assert.equal(d.hours.deltaPct, 200);
});

test('computeMonthDeltas returns a null percentage when last month had nothing', () => {
  const rows = [{ date: daysAgoTs(1), duration: HOUR }];
  const d = computeMonthDeltas(rows, NOW);
  assert.equal(d.plays.current, 1);
  assert.equal(d.plays.previous, 0);
  assert.equal(d.plays.deltaPct, null);
  assert.equal(d.hours.deltaPct, null);
});

test('projectAnnualHours extrapolates year-to-date pace to a full year', () => {
  // 2026-07-27 is day 208 of the year; 104h so far -> 0.5h/day -> 182.5 -> 183.
  assert.equal(projectAnnualHours(104, NOW), 183);
});

test('projectAnnualHours on Jan 1 just returns the hours so far (no divide blow-up)', () => {
  const jan1 = new Date('2026-01-01T06:00:00Z').getTime();
  assert.equal(projectAnnualHours(2, jan1), 730); // day 1 -> 2 * 365
});

test('computeDailyActivity zero-fills a fixed-length window, oldest first, newest last', () => {
  const rows = [
    { date: daysAgoTs(0), duration: HOUR }, { date: daysAgoTs(0), duration: HOUR }, // today: 2 plays / 2h
    { date: daysAgoTs(2), duration: 1800 } // 2 days ago: 1 play / 0.5h
  ];
  const grid = computeDailyActivity(rows, { now: NOW, days: 4 });
  assert.equal(grid.length, 4);
  assert.deepEqual(grid[3], { date: '2026-07-27', plays: 2, hours: 2 }); // today, last cell
  assert.deepEqual(grid[1], { date: '2026-07-25', plays: 1, hours: 0.5 });
  assert.deepEqual(grid[0], { date: '2026-07-24', plays: 0, hours: 0 }); // empty day still present
});

test('longestDailyRun finds the longest consecutive-day streak anywhere in the rows', () => {
  const rows = [
    { date: daysAgoTs(20) }, { date: daysAgoTs(19) }, { date: daysAgoTs(18) }, { date: daysAgoTs(17) }, // run of 4
    { date: daysAgoTs(10) }, { date: daysAgoTs(9) } // run of 2
  ];
  assert.equal(longestDailyRun(rows), 4);
});

test('longestDailyRun counts multiple plays on one day as a single day', () => {
  const rows = [{ date: daysAgoTs(5) }, { date: daysAgoTs(5) }, { date: daysAgoTs(5) }];
  assert.equal(longestDailyRun(rows), 1);
});

test('computeRecords surfaces the biggest day, best month and longest run', () => {
  const rows = [
    // 2026-07-27 (today): 3 plays  <- biggest day
    { date: daysAgoTs(0) }, { date: daysAgoTs(0) }, { date: daysAgoTs(0) },
    // July also has these -> July is the best month
    { date: daysAgoTs(1) }, { date: daysAgoTs(2) },
    // June: a single play
    { date: daysAgoTs(40) }
  ];
  const r = computeRecords(rows);
  assert.deepEqual(r.biggestDay, { date: '2026-07-27', plays: 3 });
  assert.deepEqual(r.bestMonth, { month: '2026-07', plays: 5 });
  assert.equal(r.longestStreak, 3); // 2 days ago, 1 day ago, today
});

test('computeRecords returns null day/month for empty history', () => {
  assert.deepEqual(computeRecords([]), { longestStreak: 0, biggestDay: null, bestMonth: null });
});

test('computeThisWeek totals only the last 7 rolling days', () => {
  const rows = [
    { date: daysAgoTs(0), duration: HOUR }, { date: daysAgoTs(6), duration: 1800 }, // in window
    { date: daysAgoTs(8), duration: HOUR } // out of window
  ];
  assert.deepEqual(computeThisWeek(rows, NOW), { plays: 2, hours: 1.5 });
});

test('computeTypeSplit derives TV as the remainder and never goes negative', () => {
  assert.deepEqual(computeTypeSplit({ totalPlays: 100, moviePlays: 20, animePlays: 55 }), { movies: 20, tv: 25, anime: 55 });
  // counts drifting past the authoritative total clamp to 0 rather than a negative bar
  assert.deepEqual(computeTypeSplit({ totalPlays: 10, moviePlays: 8, animePlays: 8 }), { movies: 8, tv: 0, anime: 8 });
  assert.deepEqual(computeTypeSplit(), { movies: 0, tv: 0, anime: 0 });
});
