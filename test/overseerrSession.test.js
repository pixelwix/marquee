const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Stands in for Overseerr's own /api/v1/auth/plex — records how many times
// it was hit so the caching test can assert a second call within the TTL
// reuses the session instead of re-authenticating.
let authHitCount = 0;
let nextOverseerrUserId = 1;
const upstream = http.createServer((req, res) => {
  authHitCount += 1;
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Set-Cookie': `connect.sid=fake-session-${authHitCount}; Path=/; HttpOnly`,
  });
  res.end(JSON.stringify({ id: nextOverseerrUserId }));
});

test.before(async () => {
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  process.env.OVERSEERR_URL = `http://127.0.0.1:${upstream.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => upstream.close(resolve));
});

const overseerrSession = require('../lib/overseerrSession');

test('getSession authenticates once and reuses the cached session on a second call', async () => {
  const before = authHitCount;
  const first = await overseerrSession.getSession('user-a', 'plex-token-a');
  const second = await overseerrSession.getSession('user-a', 'plex-token-a');
  assert.equal(authHitCount, before + 1);
  assert.equal(second.cookie, first.cookie);
  assert.equal(second.overseerrUserId, first.overseerrUserId);
});

test('invalidate() forces the next getSession() to re-authenticate', async () => {
  const before = authHitCount;
  const first = await overseerrSession.getSession('user-b', 'plex-token-b');
  overseerrSession.invalidate('user-b');
  const second = await overseerrSession.getSession('user-b', 'plex-token-b');
  assert.equal(authHitCount, before + 2);
  assert.notEqual(second.cookie, first.cookie);
});

test('different plexUserIds get independent cache entries', async () => {
  const a = await overseerrSession.getSession('user-c', 'plex-token-c');
  const b = await overseerrSession.getSession('user-d', 'plex-token-d');
  assert.notEqual(a.cookie, b.cookie);
});
