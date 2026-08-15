const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const geoip = require('geoip-lite');

// Durable log of where distinct playback sessions originate from, keyed off
// Tautulli's ip_address_public — resolved locally via geoip-lite's own
// bundled database, so no session data ever leaves the server just to plot
// a dot on a map (no per-stream external API call, no rate limit, works
// offline). Owner-only: nowPlaying.js deliberately keeps this field out of
// the shared family dashboard feed, so this is the one place in the app
// that reads it.
// Lazy-open, same shape as lib/diskSpaceHistory.js's getDb() — db.serialize()
// there is load-bearing, not decoration: a plain db.run(CREATE TABLE) with no
// callback, followed immediately by another db.run() on the same connection,
// has no ordering guarantee and can genuinely race (hit exactly this live on
// 2026-08-14 in diskSpaceHistory — see its comment). start() below calls
// pruneOld() right at server startup, the same shape that exposed that race,
// so this module needs the same fix.
let db = null;
function getDb() {
  if (db) return db;
  const dbDir = process.env.SESSION_DB_DIR || '/app/data';
  fs.mkdirSync(dbDir, { recursive: true });
  db = new sqlite3.Database(path.join(dbDir, 'stream-origins.sqlite'));
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS stream_origins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT NOT NULL,
      city TEXT,
      country TEXT,
      lat REAL,
      lon REAL,
      at INTEGER
    )`, (err) => { if (err) console.error('[streamOrigins] create table error:', err.message); });
  });
  return db;
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, function (err) { err ? reject(err) : resolve(this); });
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}

// Local/LAN sessions have no public IP worth mapping, and geoip-lite returns
// null for private ranges anyway — skip rather than storing a null-island
// row every consumer would just have to filter back out.
function record(sessionKey, ipAddressPublic) {
  if (!ipAddressPublic) return;
  const geo = geoip.lookup(ipAddressPublic);
  if (!geo || !geo.ll) return;
  const [lat, lon] = geo.ll;
  run(
    `INSERT INTO stream_origins (session_key, city, country, lat, lon, at) VALUES (?, ?, ?, ?, ?, ?)`,
    [sessionKey, geo.city || null, geo.country || null, lat, lon, Date.now()]
  ).catch(err => console.error('stream-origins write error:', err.message));
}

// Calendar-year window, not a rolling one — the map resets every Jan 1
// rather than always showing "last 90 days", per how the owner wants this
// read (a year-to-date picture, not a moving average). Computed from the
// current date rather than hardcoded, so next year's reset needs no edit.
function yearStart(now = Date.now()) {
  return new Date(new Date(now).getFullYear(), 0, 1).getTime();
}

function pruneOld(now = Date.now()) {
  return run(`DELETE FROM stream_origins WHERE at < ?`, [yearStart(now)]).catch(
    err => console.error('stream-origins prune error:', err.message)
  );
}

// One row per distinct city, most-streamed first, with each place's share of
// the year-to-date total already computed as a percentage — the admin panel
// renders this straight through, no client-side math. Grouping by averaged
// lat/lon (not a raw per-row point) keeps a city that resolved to a handful
// of slightly different ISP coordinates from fragmenting into near-duplicate
// dots on the map.
async function topLocations(limit = 12) {
  const rows = await all(
    `SELECT city, country, AVG(lat) AS lat, AVG(lon) AS lon, COUNT(*) AS count
     FROM stream_origins
     WHERE at >= ?
     GROUP BY city, country
     ORDER BY count DESC
     LIMIT ?`,
    [yearStart(), limit]
  );
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  if (!total) return [];
  return rows.map(r => ({
    place: r.city ? `${r.city}, ${r.country}` : (r.country || 'Unknown'),
    lat: r.lat,
    lon: r.lon,
    pct: Math.round((r.count / total) * 1000) / 10
  }));
}

function start() {
  pruneOld();
  setInterval(() => pruneOld(), 24 * 60 * 60 * 1000);
}

module.exports = { record, pruneOld, topLocations, start, yearStart };
