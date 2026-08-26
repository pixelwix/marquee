const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, NEVER_WATCHED_GRACE_DAYS, STALE_REWATCH_DAYS } = require('../lib/cleanupCandidates');

// Pure logic only — fetchMovieLibrary()'s live Tautulli call isn't covered
// here, same split as the rest of this app's tests (see
// diskSpaceHistory.test.js's own comment on that split).

const DAY_MS = 86400000;
const now = Date.UTC(2026, 5, 15);

function row({ sizeBytes = 1_000_000_000, addedDaysAgo = 0, playCount = 0, lastPlayedDaysAgo = null }) {
  return {
    file_size: String(sizeBytes),
    added_at: String(Math.floor((now - addedDaysAgo * DAY_MS) / 1000)),
    play_count: playCount || null,
    last_played: lastPlayedDaysAgo == null ? null : Math.floor((now - lastPlayedDaysAgo * DAY_MS) / 1000)
  };
}

test('classify skips a row with no file on disk, regardless of watch state', () => {
  assert.equal(classify(row({ sizeBytes: 0, addedDaysAgo: 999, playCount: 0 }), now), null);
});

test('classify does not flag a never-watched movie added within the grace period', () => {
  const result = classify(row({ addedDaysAgo: NEVER_WATCHED_GRACE_DAYS - 1, playCount: 0 }), now);
  assert.equal(result, null);
});

test('classify flags a never-watched movie once it clears the grace period', () => {
  const result = classify(row({ addedDaysAgo: NEVER_WATCHED_GRACE_DAYS, playCount: 0, sizeBytes: 5_000_000_000 }), now);
  assert.equal(result.playCount, 0);
  assert.equal(result.sizeBytes, 5_000_000_000);
  assert.match(result.reason, /Never watched/);
});

test('classify does not flag a movie watched once recently', () => {
  const result = classify(row({ playCount: 1, lastPlayedDaysAgo: STALE_REWATCH_DAYS - 1 }), now);
  assert.equal(result, null);
});

test('classify flags a movie watched exactly once, long enough ago', () => {
  const result = classify(row({ playCount: 1, lastPlayedDaysAgo: STALE_REWATCH_DAYS }), now);
  assert.equal(result.playCount, 1);
  assert.match(result.reason, /Watched once/);
});

test('classify never flags a movie watched more than once, no matter how long ago', () => {
  const result = classify(row({ playCount: 4, lastPlayedDaysAgo: 999 }), now);
  assert.equal(result, null);
});
