const { test } = require('node:test');
const assert = require('node:assert/strict');
const { groupByTotal, shortestLabelRows, combinedLabelRows, projectDaysUntilFull } = require('../lib/diskspace');

test('groupByTotal collapses multiple mounts sharing the same total capacity into one group', () => {
  const result = groupByTotal([
    { label: 'movies', totalBytes: 100, freeBytes: 40 },
    { label: 'tv', totalBytes: 100, freeBytes: 40 },
    { label: 'tv2', totalBytes: 200, freeBytes: 80 }
  ]);
  assert.equal(result.length, 2);
});

test('shortestLabelRows picks the shortest label as the representative (Radarr/Sonarr mount-path fallback)', () => {
  const result = shortestLabelRows([
    { label: '/downloads/completed', totalBytes: 100, freeBytes: 40 },
    { label: '/config', totalBytes: 100, freeBytes: 40 },
    { label: '/', totalBytes: 100, freeBytes: 40 }
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].path, '/');
});

test('combinedLabelRows joins every share name sharing a volume instead of hiding all but one', () => {
  const result = combinedLabelRows([
    { label: 'workouts', totalBytes: 100, freeBytes: 40 },
    { label: 'movies', totalBytes: 100, freeBytes: 38 },
    { label: 'tv', totalBytes: 100, freeBytes: 40 }
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].path, 'movies, tv, workouts');
  // Minimum across the group, not an arbitrary member's.
  assert.equal(result[0].freeBytes, 38);
});

test('combinedLabelRows keeps genuinely different volumes separate', () => {
  const result = combinedLabelRows([
    { label: 'movies', totalBytes: 100, freeBytes: 40 },
    { label: 'tv2', totalBytes: 200, freeBytes: 80 }
  ]);
  assert.equal(result.length, 2);
});

test('rows compute usedPercent and sort by free space ascending', () => {
  const result = combinedLabelRows([
    { label: 'roomy', totalBytes: 2000, freeBytes: 1800 },
    { label: 'tight', totalBytes: 1000, freeBytes: 100 }
  ]);
  assert.deepEqual(result.map(r => r.path), ['tight', 'roomy']);
  assert.equal(result[0].usedPercent, 90);
  assert.equal(result[1].usedPercent, 10);
});

test('rows treat zero total capacity as 0% used rather than dividing by zero', () => {
  const result = combinedLabelRows([{ label: 'empty', totalBytes: 0, freeBytes: 0 }]);
  assert.equal(result[0].usedPercent, 0);
});

test('projectDaysUntilFull needs at least 2 samples to say anything', () => {
  assert.equal(projectDaysUntilFull([]), null);
  assert.equal(projectDaysUntilFull([{ recordedAt: 0, freeBytes: 1000 }]), null);
});

test('projectDaysUntilFull projects a straight-line shrink to the day it hits zero', () => {
  const day = 86400000;
  const history = [
    { recordedAt: 0, freeBytes: 1000 },
    { recordedAt: 10 * day, freeBytes: 500 }
  ];
  const result = projectDaysUntilFull(history);
  assert.equal(result.daysUntilFull, 10);
  assert.equal(result.bytesPerDay, -50);
});

test('projectDaysUntilFull returns null when free space is flat or growing — nothing to project', () => {
  const day = 86400000;
  assert.equal(projectDaysUntilFull([
    { recordedAt: 0, freeBytes: 1000 },
    { recordedAt: 10 * day, freeBytes: 1000 }
  ]), null);
  assert.equal(projectDaysUntilFull([
    { recordedAt: 0, freeBytes: 1000 },
    { recordedAt: 10 * day, freeBytes: 1500 }
  ]), null);
});

test('projectDaysUntilFull returns null when every sample is from the same instant', () => {
  assert.equal(projectDaysUntilFull([
    { recordedAt: 5000, freeBytes: 1000 },
    { recordedAt: 5000, freeBytes: 900 }
  ]), null);
});

test('projectDaysUntilFull is order-independent and uses least squares across noisy samples', () => {
  const day = 86400000;
  // Roughly -100 bytes/day with one noisy blip; latest sample (day 4) has 620 free.
  const history = [
    { recordedAt: 2 * day, freeBytes: 820 },
    { recordedAt: 0, freeBytes: 1000 },
    { recordedAt: 4 * day, freeBytes: 620 },
    { recordedAt: 1 * day, freeBytes: 950 }, // slightly off-trend
    { recordedAt: 3 * day, freeBytes: 700 }
  ];
  const result = projectDaysUntilFull(history);
  assert.ok(result.daysUntilFull > 0);
  assert.ok(result.bytesPerDay < 0);
});

test('projectDaysUntilFull never returns a negative days-until-full', () => {
  const day = 86400000;
  // Latest sample already at/near zero and still shrinking.
  const history = [
    { recordedAt: 0, freeBytes: 100 },
    { recordedAt: 10 * day, freeBytes: -50 }
  ];
  const result = projectDaysUntilFull(history);
  assert.equal(result.daysUntilFull, 0);
});
