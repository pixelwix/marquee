const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { computeStatus, get } = require('../lib/notice');

// getDb() is lazy — SESSION_DB_DIR only needs to be set before the first real
// query, not before require(). Points this test's first query at a genuinely
// fresh directory (never-before-created notice.sqlite) so it actually
// exercises the CREATE TABLE / first-query race, not a warm connection some
// earlier test already initialized.
test('get() on a truly cold, never-before-opened db does not race the CREATE TABLE', async () => {
  process.env.SESSION_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'marquee-notice-cold-'));
  const row = await get();
  assert.equal(row, null);
});

test('no notice is "none"', () => {
  assert.equal(computeStatus(null, 1000), 'none');
});

test('no startsAt/endsAt means active immediately and forever', () => {
  assert.equal(computeStatus({ message: 'hi', startsAt: null, endsAt: null }, 1000), 'active');
});

test('before startsAt is "scheduled"', () => {
  assert.equal(computeStatus({ message: 'hi', startsAt: 2000, endsAt: null }, 1000), 'scheduled');
});

test('at or after startsAt (no end) is "active"', () => {
  assert.equal(computeStatus({ message: 'hi', startsAt: 1000, endsAt: null }, 1000), 'active');
  assert.equal(computeStatus({ message: 'hi', startsAt: 1000, endsAt: null }, 5000), 'active');
});

test('after endsAt is "expired"', () => {
  assert.equal(computeStatus({ message: 'hi', startsAt: null, endsAt: 1000 }, 1001), 'expired');
});

test('between startsAt and endsAt is "active"', () => {
  assert.equal(computeStatus({ message: 'hi', startsAt: 1000, endsAt: 2000 }, 1500), 'active');
});

test('exactly at endsAt is still "active", one ms later is "expired"', () => {
  assert.equal(computeStatus({ message: 'hi', startsAt: null, endsAt: 2000 }, 2000), 'active');
  assert.equal(computeStatus({ message: 'hi', startsAt: null, endsAt: 2000 }, 2001), 'expired');
});
