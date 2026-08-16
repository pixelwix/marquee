const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Unlike the other 3 SQLite libs, loginLog.js opens its db and fires
// CREATE TABLE eagerly at module load (not lazily on first query) — so
// SESSION_DB_DIR must point at a genuinely fresh, never-before-created
// directory BEFORE require() here, not just before the first call, to
// actually exercise the CREATE TABLE / first-query race.
process.env.SESSION_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'marquee-loginlog-cold-'));
const loginLog = require('../lib/loginLog');

test('recent() on a truly cold, never-before-opened db does not race the CREATE TABLE', async () => {
  const rows = await loginLog.recent(20);
  assert.deepEqual(rows, []);
});

test('record() then recent() round-trips a login', async () => {
  await loginLog.record({ id: 42, username: 'alice', thumb: 'thumb-url', isOwner: true });
  const rows = await loginLog.recent(20);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].username, 'alice');
  assert.equal(rows[0].is_owner, 1);
});
