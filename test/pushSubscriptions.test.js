const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// getDb() is lazy but caches its connection after the first real query — so
// SESSION_DB_DIR must be set once, before that first query, to a genuinely
// fresh directory. Setting it again later in this file would have no effect
// (same reason lib/loginLog.js's own test sets it once at module scope) —
// every test below shares one db and must use its own unique endpoint(s)
// rather than relying on a fresh table per test.
process.env.SESSION_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'marquee-pushsubs-'));
const pushSubscriptions = require('../lib/pushSubscriptions');

test('forOwner() on a truly cold, never-before-opened db does not race the CREATE TABLE', async () => {
  const rows = await pushSubscriptions.forOwner();
  assert.deepEqual(rows, []);
});

test('save then remove round-trips an owner subscription', async () => {
  const subscription = {
    endpoint: 'https://push.example/round-trip',
    keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
  };
  await pushSubscriptions.save(subscription, '42', true);
  let rows = await pushSubscriptions.forOwner();
  assert.ok(rows.some(r => r.endpoint === subscription.endpoint));

  await pushSubscriptions.remove(subscription.endpoint);
  rows = await pushSubscriptions.forOwner();
  assert.ok(!rows.some(r => r.endpoint === subscription.endpoint));
});

test('forUser() only returns that user\'s own subscriptions, not other users\' or the owner\'s', async () => {
  await pushSubscriptions.save({ endpoint: 'https://push.example/owner-device', keys: { p256dh: 'a', auth: 'a' } }, '101', true);
  await pushSubscriptions.save({ endpoint: 'https://push.example/drake-device', keys: { p256dh: 'b', auth: 'b' } }, '102', false);
  await pushSubscriptions.save({ endpoint: 'https://push.example/lauren-device', keys: { p256dh: 'c', auth: 'c' } }, '103', false);

  const drakeRows = await pushSubscriptions.forUser('102');
  assert.equal(drakeRows.length, 1);
  assert.equal(drakeRows[0].endpoint, 'https://push.example/drake-device');

  const ownerRows = await pushSubscriptions.forOwner();
  assert.ok(ownerRows.some(r => r.endpoint === 'https://push.example/owner-device'));
  assert.ok(!ownerRows.some(r => r.endpoint === 'https://push.example/drake-device'));
});

test('re-subscribing the same endpoint under a different user re-scopes it, not duplicates', async () => {
  const sub = { endpoint: 'https://push.example/shared-device', keys: { p256dh: 'x', auth: 'x' } };
  await pushSubscriptions.save(sub, '201', true);
  await pushSubscriptions.save(sub, '202', false);

  const ownerRows = await pushSubscriptions.forOwner();
  assert.ok(!ownerRows.some(r => r.endpoint === sub.endpoint));
  const userRows = await pushSubscriptions.forUser('202');
  assert.equal(userRows.length, 1);
});
