const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pushSubscriptions = require('../lib/pushSubscriptions');

// getDb() is lazy — SESSION_DB_DIR only needs to be set before the first real
// query, not before require(). Points this test's first query at a genuinely
// fresh directory (never-before-created owner-push.sqlite) so it actually
// exercises the CREATE TABLE / first-query race, not a warm connection some
// earlier test already initialized.
test('all() on a truly cold, never-before-opened db does not race the CREATE TABLE', async () => {
  process.env.SESSION_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'marquee-pushsubs-cold-'));
  const rows = await pushSubscriptions.all();
  assert.deepEqual(rows, []);
});

test('save then remove round-trips a subscription', async () => {
  process.env.SESSION_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'marquee-pushsubs-'));
  const subscription = {
    endpoint: 'https://push.example/abc',
    keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
  };
  await pushSubscriptions.save(subscription);
  let rows = await pushSubscriptions.all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].endpoint, subscription.endpoint);

  await pushSubscriptions.remove(subscription.endpoint);
  rows = await pushSubscriptions.all();
  assert.deepEqual(rows, []);
});
