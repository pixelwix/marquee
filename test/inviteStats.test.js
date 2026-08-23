const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeLibraries, countAddedWithin } = require('../lib/inviteStats');

// Real shape confirmed live against Tautulli's get_libraries — this app actually has
// three show-type libraries (TV Shows, Anime, Workouts), which is exactly why this
// sums by section_type instead of hardcoding library names/count.
test('summarizeLibraries sums movie-type and show-type libraries separately', () => {
  const libraries = [
    { section_name: 'Movies', section_type: 'movie', count: '4917' },
    { section_name: 'TV Shows', section_type: 'show', count: '1188' },
    { section_name: 'Anime', section_type: 'show', count: '181' },
    { section_name: 'Workouts', section_type: 'show', count: '2' },
  ];
  assert.deepEqual(summarizeLibraries(libraries), { movies: 4917, series: 1371 });
});

test('summarizeLibraries ignores unrecognized section types instead of miscounting them', () => {
  const libraries = [
    { section_type: 'movie', count: '10' },
    { section_type: 'artist', count: '500' },
    { section_type: 'photo', count: '9000' },
  ];
  assert.deepEqual(summarizeLibraries(libraries), { movies: 10, series: 0 });
});

test('summarizeLibraries treats a missing/non-numeric count as zero, not NaN', () => {
  const libraries = [{ section_type: 'movie', count: undefined }];
  assert.deepEqual(summarizeLibraries(libraries), { movies: 0, series: 0 });
});

test('countAddedWithin only counts items inside the window, not everything returned', () => {
  const now = Date.parse('2026-08-22T00:00:00Z');
  const items = [
    { added_at: String(now / 1000 - 1 * 86400) },   // 1 day ago — in window
    { added_at: String(now / 1000 - 6 * 86400) },   // 6 days ago — in window
    { added_at: String(now / 1000 - 8 * 86400) },   // 8 days ago — outside a 7-day window
    { added_at: String(now / 1000 - 300 * 86400) }, // ~10 months ago — outside
  ];
  assert.equal(countAddedWithin(items, 7, now), 2);
});

test('countAddedWithin with no items is zero, not a throw', () => {
  assert.equal(countAddedWithin([], 7), 0);
});
