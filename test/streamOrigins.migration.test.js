const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');

// Separate file/temp dir/fresh require from streamOrigins.test.js on purpose —
// this exercises the one-time migration path in lib/streamOrigins.js's
// migrate(), which only runs once per module instance (guarded by the
// module-level `ready` promise), so it needs its own untouched db file and
// its own require() rather than sharing the other file's already-initialized
// module singleton.
test('migrate() drops and recreates a table left over from the old session_key schema', async () => {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marquee-streamorigins-migration-'));
  const dbPath = path.join(dbDir, 'stream-origins.sqlite');

  await new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath);
    db.run(`CREATE TABLE stream_origins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT NOT NULL,
      city TEXT,
      country TEXT,
      lat REAL,
      lon REAL,
      at INTEGER
    )`, (createErr) => {
      if (createErr) { db.close(); return reject(createErr); }
      db.run(
        `INSERT INTO stream_origins (session_key, city, country, lat, lon, at) VALUES (?, ?, ?, ?, ?, ?)`,
        ['old-live-session', 'Manassas', 'US', 38.77, -77.63, Date.now()],
        (insertErr) => { db.close(); insertErr ? reject(insertErr) : resolve(); }
      );
    });
  });

  process.env.SESSION_DB_DIR = dbDir;
  delete require.cache[require.resolve('../lib/streamOrigins')];
  const streamOrigins = require('../lib/streamOrigins');

  // Any call goes through whenReady() -> migrate() first.
  const before = await streamOrigins.topLocations();
  assert.deepEqual(before, []); // old row is gone, not migrated forward

  const cols = await new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath);
    db.all(`PRAGMA table_info(stream_origins)`, (err, rows) => {
      db.close();
      err ? reject(err) : resolve(rows);
    });
  });
  const names = cols.map((c) => c.name);
  assert.ok(names.includes('reference_id'));
  assert.ok(!names.includes('session_key'));
});
