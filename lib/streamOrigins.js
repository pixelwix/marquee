const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const geoip = require('geoip-lite');

// Durable log of where distinct playback sessions originate from, sourced
// from Tautulli's get_history (not the live get_activity feed nowPlaying.js
// polls) — resolved locally via geoip-lite's own bundled database, so no
// session data ever leaves the server just to plot a dot on a map. Owner-
// only: nowPlaying.js's mapSession() deliberately never carries ip_address to
// the shared family dashboard feed, so this is the one place in the app that
// reads it.
//
// get_history, not get_activity: Tautulli's live "session_key" is just an
// ephemeral slot number that gets reused the moment a stream ends, not a
// real per-session identifier — a first pass here recorded straight off
// get_activity keyed by session_key and it only ever showed whatever
// happened to be playing while the server was up, no real year-to-date
// picture (confirmed empirically: 2000 sampled get_activity-driven rows
// collapsed to essentially one session_key). get_history's own
// `reference_id` is the real thing — verified against 2000 real rows:
// every one had a distinct reference_id, and every row sharing a
// reference_id had the exact same ip_address, so it's a safe dedupe key.
//
// Lazy-open. Schema setup (including the one-time migration below) is
// sequenced through a real Promise (`whenReady()`), not sqlite3's own
// implicit per-connection queue — db.run(CREATE TABLE) with no callback
// followed immediately by another db.run() has no ordering guarantee and
// can genuinely race (hit exactly this live on 2026-08-14 in
// diskSpaceHistory.js, and again in this file's first version on
// 2026-08-15). A plain db.serialize() fixes the simple case, but the
// migration here is conditional (check the schema, maybe drop, then
// create) and needs real sequencing, not just a flat statement queue —
// every run()/all() call below awaits whenReady() first, so nothing can
// query ahead of migration finishing regardless of connection internals.
let db = null;
function getDb() {
  if (!db) {
    const dbDir = process.env.SESSION_DB_DIR || '/app/data';
    fs.mkdirSync(dbDir, { recursive: true });
    db = new sqlite3.Database(path.join(dbDir, 'stream-origins.sqlite'));
  }
  return db;
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, function (err) { err ? reject(err) : resolve(this); });
  });
}
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}

// One-time migration: the first version of this table used a non-unique
// `session_key` column (Tautulli's live, reused-slot-number session key —
// see the syncFromHistory()-vs-get_activity comment above). Its handful of
// rows are trivial next to the full year-to-date backfill syncFromHistory()
// does anyway, so on detecting the old shape this just drops and recreates
// rather than migrating data forward.
async function migrate() {
  const cols = await dbAll(`PRAGMA table_info(stream_origins)`);
  if (cols.some(c => c.name === 'session_key')) {
    await dbRun(`DROP TABLE stream_origins`);
  }
  await dbRun(`CREATE TABLE IF NOT EXISTS stream_origins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference_id TEXT NOT NULL UNIQUE,
    city TEXT,
    country TEXT,
    lat REAL,
    lon REAL,
    at INTEGER
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS sync_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_synced_at INTEGER
  )`);
}

let ready = null;
function whenReady() {
  if (!ready) ready = migrate().catch(err => { console.error('[streamOrigins] migration error:', err.message); throw err; });
  return ready;
}

async function run(sql, params = []) {
  await whenReady();
  return dbRun(sql, params);
}
async function all(sql, params = []) {
  await whenReady();
  return dbAll(sql, params);
}

async function getWatermark() {
  const rows = await all(`SELECT last_synced_at FROM sync_state WHERE id = 1`);
  return rows.length ? rows[0].last_synced_at : null;
}

function setWatermark(ts) {
  return run(`INSERT INTO sync_state (id, last_synced_at) VALUES (1, ?)
              ON CONFLICT(id) DO UPDATE SET last_synced_at = excluded.last_synced_at`, [ts]);
}

// Local/LAN sessions have no public IP worth mapping, and geoip-lite returns
// null for private ranges anyway — skip rather than storing a null-island
// row every consumer would just have to filter back out. `UNIQUE` on
// reference_id (plus `OR IGNORE`) makes this safe to call twice for the same
// session — syncFromHistory()'s overlap window (see SYNC_OVERLAP_MS) relies
// on that to re-scan safely without double-counting.
function record(referenceId, ipAddress, at = Date.now()) {
  if (!ipAddress) return Promise.resolve();
  const geo = geoip.lookup(ipAddress);
  if (!geo || !geo.ll) return Promise.resolve();
  const [lat, lon] = geo.ll;
  return run(
    `INSERT OR IGNORE INTO stream_origins (reference_id, city, country, lat, lon, at) VALUES (?, ?, ?, ?, ?, ?)`,
    [String(referenceId), geo.city || null, geo.country || null, lat, lon, at]
  ).catch(err => console.error('stream-origins write error:', err.message));
}

// Calendar-year window, not a rolling one — the map resets every Jan 1
// rather than always showing "last 90 days", per how the owner wants this
// read (a year-to-date picture, not a moving average). Computed from the
// current date rather than hardcoded, so next year's reset needs no edit.
function yearStart(now = Date.now()) {
  return new Date(new Date(now).getFullYear(), 0, 1).getTime();
}

// Retains a rolling ~13 months, not just "since Jan 1" — the year-to-date VIEW
// still computes fresh from yearStart() below, but a 90-day range toggle needs raw
// rows to actually reach back 90 days even in, say, February (when Jan 1 is only
// ~45 days back). Pruning by calendar year start would silently truncate that.
const RETENTION_MS = 400 * 24 * 60 * 60 * 1000;

function pruneOld(now = Date.now()) {
  return run(`DELETE FROM stream_origins WHERE at < ?`, [now - RETENTION_MS]).catch(
    err => console.error('stream-origins prune error:', err.message)
  );
}

function tautulliConfigured() {
  return !!(process.env.TAUTULLI_URL && process.env.TAUTULLI_API_KEY);
}

// Full year-to-date backfill only ever happens once, on the very first run
// (no watermark row yet) — a real one, live-tested against this deployment's
// actual Tautulli history: ~16k raw rows, several minutes. Every run after
// that only re-scans a trailing SYNC_OVERLAP_MS window (comfortably wider
// than the 15-minute interval start() calls this on), which cheaply
// self-heals from a missed run or a Tautulli hiccup without redoing the
// whole year — the expensive backfill surviving restarts (persisted in the
// sync_state table, not in memory) is what actually matters, since restarts
// happen on every deploy. INSERT OR IGNORE (see record()) makes the overlap
// safe either way.
const SYNC_OVERLAP_MS = 2 * 60 * 60 * 1000;

async function syncFromHistory() {
  if (!tautulliConfigured()) return;
  const watermark = await getWatermark();
  // Floor matches RETENTION_MS (see pruneOld) — a fresh deployment's first backfill
  // should reach back as far as data actually gets kept, not just to Jan 1.
  const floor = Date.now() - RETENTION_MS;
  const since = watermark ? Math.max(watermark - SYNC_OVERLAP_MS, floor) : floor;
  const afterIso = new Date(since).toISOString().slice(0, 10);
  const seen = new Map(); // reference_id -> { ip, at } — last-write-wins is fine, ip is constant per session
  const length = 2000;
  let start = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { data } = await axios.get(`${process.env.TAUTULLI_URL}/api/v2`, {
      params: { apikey: process.env.TAUTULLI_API_KEY, cmd: 'get_history', after: afterIso, order_column: 'date', order_dir: 'asc', start, length }
    });
    const rows = data.response.data.data || [];
    for (const r of rows) {
      if (!r.reference_id || !r.ip_address) continue;
      seen.set(r.reference_id, { ip: r.ip_address, at: r.date * 1000 });
    }
    start += rows.length;
    if (rows.length < length) break;
  }
  for (const [referenceId, { ip, at }] of seen) {
    // eslint-disable-next-line no-await-in-loop
    await record(referenceId, ip, at);
  }
  await setWatermark(Date.now());
}

const RANGE_DAYS = { '30d': 30, '90d': 90 };

// 'ytd' resets every Jan 1 (calendar-year window, matching how the owner wants that
// particular view read); '30d'/'90d' are genuine rolling windows — both safe now
// that pruneOld() retains a full ~13 months rather than just since Jan 1.
function rangeStart(range, now = Date.now()) {
  const days = RANGE_DAYS[range];
  return days ? now - days * 24 * 60 * 60 * 1000 : yearStart(now);
}

// One row per distinct city, most-streamed first, with each place's share of the
// window's total already computed as a percentage (plus the raw count) — the admin
// panel renders this straight through, no client-side math. Grouping by averaged
// lat/lon (not a raw per-row point) keeps a city that resolved to a handful of
// slightly different ISP coordinates from fragmenting into near-duplicate dots on
// the map.
async function topLocations({ limit = 12, range = 'ytd' } = {}) {
  const rows = await all(
    `SELECT city, country, AVG(lat) AS lat, AVG(lon) AS lon, COUNT(*) AS count
     FROM stream_origins
     WHERE at >= ?
     GROUP BY city, country
     ORDER BY count DESC
     LIMIT ?`,
    [rangeStart(range), limit]
  );
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  if (!total) return [];
  return rows.map(r => ({
    place: r.city ? `${r.city}, ${r.country}` : (r.country || 'Unknown'),
    lat: r.lat,
    lon: r.lon,
    count: r.count,
    pct: Math.round((r.count / total) * 1000) / 10
  }));
}

const SYNC_INTERVAL_MS = 15 * 60 * 1000;

function start() {
  syncFromHistory().catch(err => console.error('stream-origins sync error:', err.message));
  setInterval(() => syncFromHistory().catch(err => console.error('stream-origins sync error:', err.message)), SYNC_INTERVAL_MS);
  pruneOld();
  setInterval(() => pruneOld(), 24 * 60 * 60 * 1000);
}

module.exports = { record, pruneOld, syncFromHistory, topLocations, start, yearStart, getWatermark, setWatermark };
