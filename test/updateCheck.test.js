const test = require('node:test');
const assert = require('node:assert/strict');
const { extractVersion, isNewer, fromArrUpdateList } = require('../lib/updateCheck');

// Pure logic only — the live network calls (Sonarr/Radarr/Prowlarr's own
// update endpoint, Overseerr's status, Tautulli's get_pms_update/
// get_tautulli_info, GitHub releases) aren't covered here, same split as
// lib/serviceHealth.js and the rest of this app's tests.

test('extractVersion pulls the dotted numeric version out of real-world tag formats', () => {
  assert.equal(extractVersion('v2.18.0'), '2.18.0');
  assert.equal(extractVersion('release-5.2.3'), '5.2.3');
  assert.equal(extractVersion('5.1.2'), '5.1.2');
  assert.equal(extractVersion('4.0.19.2979'), '4.0.19.2979');
});

test('extractVersion returns null for missing or non-numeric input', () => {
  assert.equal(extractVersion(undefined), null);
  assert.equal(extractVersion(''), null);
  assert.equal(extractVersion('nightly'), null);
});

test('isNewer compares numeric segments, not string order', () => {
  assert.equal(isNewer('2.18.0', '2.17.2'), true);
  assert.equal(isNewer('2.9.0', '2.10.0'), false); // string compare would get this backwards
  assert.equal(isNewer('5.1.1', '5.1.1'), false);
});

test('isNewer treats a missing trailing segment as 0, not a length mismatch error', () => {
  assert.equal(isNewer('4.0.19.2979', '4.0.19'), true);
  assert.equal(isNewer('4.0.19', '4.0.19.2979'), false);
});

test('fromArrUpdateList reports no update when the installed entry is also the latest', () => {
  const list = [{ version: '4.0.19.2979', installed: true, latest: true }];
  assert.deepEqual(fromArrUpdateList(list), {
    currentVersion: '4.0.19.2979', latestVersion: '4.0.19.2979', updateAvailable: false
  });
});

test('fromArrUpdateList reports an update when the newest entry differs from the installed one', () => {
  const list = [
    { version: '4.0.20.3001', installed: false, latest: true },
    { version: '4.0.19.2979', installed: true, latest: false }
  ];
  assert.deepEqual(fromArrUpdateList(list), {
    currentVersion: '4.0.19.2979', latestVersion: '4.0.20.3001', updateAvailable: true
  });
});

test('fromArrUpdateList returns null for an empty or malformed list', () => {
  assert.equal(fromArrUpdateList([]), null);
  assert.equal(fromArrUpdateList(null), null);
  // No entry flagged installed — the *arr app's own update list should always
  // have one, but this shouldn't crash if it somehow doesn't.
  assert.equal(fromArrUpdateList([{ version: '1.0.0', installed: false, latest: true }]), null);
});
