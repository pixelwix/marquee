const { test } = require('node:test');
const assert = require('node:assert/strict');
const { previousMonthRange, computeLongestStreak, computeMonthlyRank, computeHeadliner, computeCandidates } = require('../lib/monthlyRecap');

const secondsAt = (isoDate) => Math.floor(new Date(`${isoDate}T12:00:00Z`).getTime() / 1000);

test('previousMonthRange gives the full prior calendar month regardless of where in the current month `now` falls', () => {
  const early = previousMonthRange(new Date('2026-08-01T00:00:00Z'));
  const late = previousMonthRange(new Date('2026-08-29T23:00:00Z'));
  assert.equal(early.key, '2026-07');
  assert.equal(early.startIso, '2026-07-01');
  assert.equal(late.startIso, '2026-07-01');
  assert.equal(early.endUnix, late.endUnix);
  assert.equal(early.label, 'July 2026');
});

test('previousMonthRange crosses a year boundary correctly', () => {
  const period = previousMonthRange(new Date('2026-01-15T00:00:00Z'));
  assert.equal(period.startIso, '2025-12-01');
  assert.equal(period.label, 'December 2025');
});

test('computeLongestStreak finds the longest run of consecutive days, not just the most recent one', () => {
  const rows = [
    { date: secondsAt('2026-07-01') }, { date: secondsAt('2026-07-02') }, { date: secondsAt('2026-07-03') },
    { date: secondsAt('2026-07-10') }, { date: secondsAt('2026-07-11') },
  ];
  assert.equal(computeLongestStreak(rows), 3);
});

test('computeLongestStreak dedupes same-day multiple plays before measuring the run', () => {
  const rows = [
    { date: secondsAt('2026-07-01') }, { date: secondsAt('2026-07-01') }, { date: secondsAt('2026-07-01') },
    { date: secondsAt('2026-07-02') },
  ];
  assert.equal(computeLongestStreak(rows), 2);
});

test('computeLongestStreak is 0 for no history', () => {
  assert.equal(computeLongestStreak([]), 0);
});

test('computeMonthlyRank sums duration per user across the whole server and finds a 1-based position', () => {
  const rows = [
    { user_id: 1, duration: 100 }, { user_id: 1, duration: 100 },
    { user_id: 2, duration: 500 },
    { user_id: 3, duration: 50 },
  ];
  const rank = computeMonthlyRank(rows, 1);
  assert.deepEqual(rank, { position: 2, of: 3 });
});

test('computeMonthlyRank returns a null position when the user had no plays that month, but still reports the field size', () => {
  const rows = [{ user_id: 2, duration: 500 }, { user_id: 3, duration: 50 }];
  const rank = computeMonthlyRank(rows, 99);
  assert.deepEqual(rank, { position: null, of: 2 });
});

test('computeHeadliner groups episodes under their show by rating key, not title text', () => {
  const rows = [
    { grandparent_rating_key: 10, grandparent_title: 'Young Justice', duration: 1400 },
    { grandparent_rating_key: 10, grandparent_title: 'Young Justice', duration: 1400 },
    { rating_key: 20, title: 'Obsession', duration: 6600 },
  ];
  const headliner = computeHeadliner(rows);
  assert.equal(headliner.title, 'Young Justice');
  assert.equal(headliner.plays, 2);
  assert.equal(headliner.ratingKey, 10);
  assert.equal(headliner.hours, 0.8);
});

test('computeHeadliner returns null for a quiet month with no plays', () => {
  assert.equal(computeHeadliner([]), null);
});

test('computeCandidates excludes anyone below the play threshold', () => {
  const rows = [
    { user_id: 1, duration: 100 }, { user_id: 1, duration: 100 }, { user_id: 1, duration: 100 },
    { user_id: 2, duration: 50 }, { user_id: 2, duration: 50 },
  ];
  const users = [{ user_id: 1, friendly_name: 'Kwame', email: 'kwame@example.com' }, { user_id: 2, friendly_name: 'Aaron', email: 'aaron@example.com' }];
  const candidates = computeCandidates(rows, users, 3);
  assert.deepEqual(candidates.map((c) => c.name), ['Kwame']);
});

test('computeCandidates sorts by plays descending and carries name/email from the user list', () => {
  const rows = [
    { user_id: 1, duration: 60 },
    { user_id: 2, duration: 60 }, { user_id: 2, duration: 60 },
  ];
  const users = [{ user_id: 1, friendly_name: 'Aaron', email: 'aaron@example.com' }, { user_id: 2, friendly_name: 'Kwame', email: 'kwame@example.com' }];
  const candidates = computeCandidates(rows, users, 1);
  assert.deepEqual(candidates, [
    { userId: '2', name: 'Kwame', email: 'kwame@example.com', plays: 2, hours: 0 },
    { userId: '1', name: 'Aaron', email: 'aaron@example.com', plays: 1, hours: 0 },
  ]);
});

test('computeCandidates falls back to userId when a user has no friendly_name/username, and null when no email', () => {
  const rows = [{ user_id: 1, duration: 0 }];
  const candidates = computeCandidates(rows, [], 1);
  assert.deepEqual(candidates, [{ userId: '1', name: '1', email: null, plays: 1, hours: 0 }]);
});
