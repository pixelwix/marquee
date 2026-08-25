const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marquee-streamorigins-'));
process.env.SESSION_DB_DIR = dbDir;
const streamOrigins = require('../lib/streamOrigins');

// Same self-contained shape as diskSpaceHistory.test.js's withDb — a raw
// connection to the same file the module's own lazy db opens, so rows
// inserted here are visible to topLocations()/pruneOld() without going
// through record()'s geoip-lite lookup for every fixture row. This app's
// tests don't mock Tautulli's HTTP API (see diskSpaceHistory.test.js's own
// comment on that split) — syncFromHistory() itself isn't covered here for
// the same reason, only the DB-level logic it eventually calls into.
function withDb(fn) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(path.join(dbDir, 'stream-origins.sqlite'));
    db.run(`CREATE TABLE IF NOT EXISTS stream_origins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_id TEXT NOT NULL UNIQUE,
      city TEXT,
      country TEXT,
      lat REAL,
      lon REAL,
      at INTEGER
    )`, (createErr) => {
      if (createErr) { db.close(); return reject(createErr); }
      fn(db, (err, result) => { db.close(); err ? reject(err) : resolve(result); });
    });
  });
}

function insertRow(referenceId, city, country, lat, lon, at) {
  return withDb((db, done) => {
    db.run(
      `INSERT INTO stream_origins (reference_id, city, country, lat, lon, at) VALUES (?, ?, ?, ?, ?, ?)`,
      [referenceId, city, country, lat, lon, at],
      (err) => done(err)
    );
  });
}

function countRows() {
  return withDb((db, done) => {
    db.get('SELECT COUNT(*) AS n FROM stream_origins', (err, row) => done(err, row && row.n));
  });
}

function clearRows() {
  return withDb((db, done) => db.run('DELETE FROM stream_origins', (err) => done(err)));
}

test('record() skips IPs geoip-lite can\'t place (missing or unresolvable)', async () => {
  await clearRows();
  await streamOrigins.record('r1', undefined);
  // RFC 5737 TEST-NET-1 — reserved for documentation, never a real routable
  // address, and geoip-lite returns null for it the same way it would for
  // a private LAN range (which is the real-world case this stands in for).
  await streamOrigins.record('r2', '192.0.2.1');
  assert.equal(await countRows(), 0);
});

test('record() writes a row for a resolvable public IP, at an explicit timestamp', async () => {
  await clearRows();
  const at = Date.UTC(2026, 2, 3);
  await streamOrigins.record('r3', '8.8.8.8', at);
  const rows = await withDb((db, done) => {
    db.all('SELECT reference_id, at FROM stream_origins', (err, r) => done(err, r));
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reference_id, 'r3');
  assert.equal(rows[0].at, at);
});

test('record() is idempotent on a repeated reference_id (INSERT OR IGNORE)', async () => {
  await clearRows();
  await streamOrigins.record('r4', '8.8.8.8');
  await streamOrigins.record('r4', '8.8.8.8'); // syncFromHistory() re-scans the whole window every run
  assert.equal(await countRows(), 1);
});

test('topLocations() aggregates by city/country and computes percentage of the total', async () => {
  await clearRows();
  const now = Date.UTC(2026, 5, 15); // mid-2026, well inside this year's window
  await insertRow('a', 'Los Angeles', 'US', 34.05, -118.24, now);
  await insertRow('b', 'Los Angeles', 'US', 34.06, -118.25, now);
  await insertRow('c', 'Los Angeles', 'US', 34.04, -118.23, now);
  await insertRow('d', 'London', 'UK', 51.51, -0.13, now);

  const top = await streamOrigins.topLocations();
  assert.equal(top.length, 2);
  assert.equal(top[0].place, 'Los Angeles, US');
  assert.equal(top[0].pct, 75);
  assert.equal(top[1].place, 'London, UK');
  assert.equal(top[1].pct, 25);
});

test('topLocations() labels a row with no resolved city as "Unresolved (country)", not just the bare country', async () => {
  await clearRows();
  const now = Date.UTC(2026, 5, 15);
  await insertRow('a', null, 'US', 39.0, -98.0, now);

  const top = await streamOrigins.topLocations();
  assert.equal(top[0].place, 'Unresolved (US)');
});

test('topLocations() with range "all" includes a row older than 90 days but within retention', async () => {
  await clearRows();
  const now = Date.now();
  const old = now - 200 * 24 * 60 * 60 * 1000; // outside 90d, still within ~13-month retention
  await insertRow('a', 'Berlin', 'DE', 52.52, 13.40, old);

  const top90 = await streamOrigins.topLocations({ range: '90d' });
  const topAll = await streamOrigins.topLocations({ range: 'all' });
  assert.equal(top90.length, 0);
  assert.equal(topAll.length, 1);
});

test('pruneOld() removes rows older than the ~13-month retention window, keeps newer ones', async () => {
  // A rolling window, not a calendar-year cutoff — a 90-day range toggle needs raw
  // rows to reach back 90 days even in, say, February, when Jan 1 is much closer
  // than that. See lib/streamOrigins.js's RETENTION_MS comment.
  await clearRows();
  const now = Date.UTC(2026, 5, 15);
  const tooOld = now - 401 * 24 * 60 * 60 * 1000;
  const withinWindow = now - 200 * 24 * 60 * 60 * 1000; // well past Jan 1, still retained
  await insertRow('old', 'Berlin', 'DE', 52.52, 13.40, tooOld);
  await insertRow('new', 'Berlin', 'DE', 52.52, 13.40, withinWindow);

  await streamOrigins.pruneOld(now);
  const remaining = await withDb((db, done) => {
    db.all('SELECT reference_id FROM stream_origins', (err, rows) => done(err, rows));
  });
  const ids = remaining.map((r) => r.reference_id);
  assert.ok(!ids.includes('old'));
  assert.ok(ids.includes('new'));
});

test('topLocations() with range "30d" excludes a row from 60 days ago', async () => {
  await clearRows();
  const now = Date.now();
  const within30d = now - 5 * 24 * 60 * 60 * 1000;
  const outside30d = now - 60 * 24 * 60 * 60 * 1000;
  await insertRow('recent', 'Los Angeles', 'US', 34.05, -118.24, within30d);
  await insertRow('older', 'London', 'UK', 51.51, -0.13, outside30d);

  const top = await streamOrigins.topLocations({ range: '30d' });
  assert.equal(top.length, 1);
  assert.equal(top[0].place, 'Los Angeles, US');
});

test('topLocations() with range "90d" includes a row from 60 days ago that "30d" would exclude', async () => {
  await clearRows();
  const now = Date.now();
  const within90d = now - 60 * 24 * 60 * 60 * 1000;
  await insertRow('a', 'London', 'UK', 51.51, -0.13, within90d);

  const top30 = await streamOrigins.topLocations({ range: '30d' });
  const top90 = await streamOrigins.topLocations({ range: '90d' });
  assert.equal(top30.length, 0);
  assert.equal(top90.length, 1);
});

test('topLocations() includes the raw count alongside the percentage', async () => {
  await clearRows();
  const now = Date.UTC(2026, 5, 15);
  await insertRow('a', 'Los Angeles', 'US', 34.05, -118.24, now);
  await insertRow('b', 'Los Angeles', 'US', 34.06, -118.25, now);
  await insertRow('c', 'London', 'UK', 51.51, -0.13, now);

  const top = await streamOrigins.topLocations();
  assert.equal(top.find((t) => t.place === 'Los Angeles, US').count, 2);
  assert.equal(top.find((t) => t.place === 'London, UK').count, 1);
});

test('getWatermark() is null until setWatermark() has run, then returns the last value written', async () => {
  assert.equal(await streamOrigins.getWatermark(), null);
  await streamOrigins.setWatermark(12345);
  assert.equal(await streamOrigins.getWatermark(), 12345);
  await streamOrigins.setWatermark(67890); // overwrites, doesn't add a second row
  assert.equal(await streamOrigins.getWatermark(), 67890);
});
