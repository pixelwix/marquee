const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marquee-diskspacehistory-'));
process.env.SESSION_DB_DIR = dbDir;
const diskSpaceHistory = require('../lib/diskSpaceHistory');

// Inserts rows directly rather than going through recordSnapshot(), which
// calls the real getCurrentRows() (mediaStorage/Radarr/Sonarr) — same scope
// split as the rest of this app's tests: pure/DB logic gets covered here,
// live upstream integration doesn't (see TODO.md's automated-tests entry).
// Each helper creates the table itself (IF NOT EXISTS) rather than relying
// on the module's own lazy getDb() having already run on some other
// connection first — same self-contained shape as dbBackup.test.js's
// createSqliteFile, avoids a real race between this file's raw connections
// and the module's internal one.
function withDb(fn) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(path.join(dbDir, 'diskspace-history.sqlite'));
    db.run(`CREATE TABLE IF NOT EXISTS diskspace_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      free_bytes INTEGER NOT NULL,
      total_bytes INTEGER NOT NULL,
      recorded_at INTEGER NOT NULL
    )`, (createErr) => {
      if (createErr) { db.close(); return reject(createErr); }
      fn(db, (err, result) => { db.close(); err ? reject(err) : resolve(result); });
    });
  });
}

function insertRow(label, freeBytes, totalBytes, recordedAt) {
  return withDb((db, done) => {
    db.run(
      `INSERT INTO diskspace_history (label, free_bytes, total_bytes, recorded_at) VALUES (?, ?, ?, ?)`,
      [label, freeBytes, totalBytes, recordedAt],
      (err) => done(err)
    );
  });
}

function countRows() {
  return withDb((db, done) => {
    db.get('SELECT COUNT(*) AS n FROM diskspace_history', (err, row) => done(err, row && row.n));
  });
}

test('pruneOld removes rows past the retention window and keeps recent ones', async () => {
  const day = 86400000;
  const now = Date.UTC(2026, 0, 15);

  await insertRow('movies', 100, 1000, now - 1 * day);
  await insertRow('movies', 100, 1000, now - 89 * day);
  await insertRow('movies', 100, 1000, now - 91 * day);
  await insertRow('movies', 100, 1000, now - 200 * day);

  const removed = await diskSpaceHistory.pruneOld(90, now);
  assert.equal(removed, 2);
  assert.equal(await countRows(), 2);
});
