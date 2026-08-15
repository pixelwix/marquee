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
// through record()'s geoip-lite lookup for every fixture row.
function withDb(fn) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(path.join(dbDir, 'stream-origins.sqlite'));
    db.run(`CREATE TABLE IF NOT EXISTS stream_origins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT NOT NULL,
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

function insertRow(sessionKey, city, country, lat, lon, at) {
  return withDb((db, done) => {
    db.run(
      `INSERT INTO stream_origins (session_key, city, country, lat, lon, at) VALUES (?, ?, ?, ?, ?, ?)`,
      [sessionKey, city, country, lat, lon, at],
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
  streamOrigins.record('s1', undefined);
  // RFC 5737 TEST-NET-1 — reserved for documentation, never a real routable
  // address, and geoip-lite returns null for it the same way it would for
  // a private LAN range (which is the real-world case this stands in for).
  streamOrigins.record('s2', '192.0.2.1');
  // record() writes async (fire-and-forget); give its promise chain a tick.
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await countRows(), 0);
});

test('record() writes a row for a resolvable public IP', async () => {
  streamOrigins.record('s3', '8.8.8.8');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await countRows(), 1);
});

test('topLocations() aggregates by city/country and computes percentage of the total', async () => {
  await clearRows(); // isolate from the record()-driven rows the earlier tests left behind
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

test('pruneOld() removes rows from before the current calendar year and keeps this year\'s', async () => {
  await clearRows();
  const lastYear = Date.UTC(2025, 11, 31);
  const thisYear = Date.UTC(new Date().getFullYear(), 3, 1);
  await insertRow('old', 'Berlin', 'DE', 52.52, 13.40, lastYear);
  await insertRow('new', 'Berlin', 'DE', 52.52, 13.40, thisYear);

  await streamOrigins.pruneOld();
  const remaining = await withDb((db, done) => {
    db.all('SELECT session_key FROM stream_origins', (err, rows) => done(err, rows));
  });
  const keys = remaining.map((r) => r.session_key);
  assert.ok(!keys.includes('old'));
  assert.ok(keys.includes('new'));
});
