const test = require('node:test');
const assert = require('node:assert/strict');
const { mapCurrentUptimeRow } = require('../lib/uptimeKuma');

test('current Plex uptime measures from the first up heartbeat after the last interruption', () => {
  assert.deepEqual(mapCurrentUptimeRow({ currentStatus: 1, latestUnix: 10_000, sinceUnix: 1_000 }, 10_100), {
    status: 'up', since: 1_000_000, seconds: 9_100,
  });
});

test('current Plex uptime reports down instead of an uptime duration', () => {
  assert.deepEqual(mapCurrentUptimeRow({ currentStatus: 0, latestUnix: 10_000, sinceUnix: 1_000 }, 10_100), { status: 'down' });
});

test('stale heartbeat data is not presented as current uptime', () => {
  assert.deepEqual(mapCurrentUptimeRow({ currentStatus: 1, latestUnix: 9_000, sinceUnix: 1_000 }, 10_100), { status: 'unknown' });
});

test('missing monitor data returns null', () => {
  assert.equal(mapCurrentUptimeRow(null), null);
});
