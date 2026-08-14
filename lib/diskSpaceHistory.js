const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const settle = require('./settle');
const mediaStorage = require('./mediaStorage');
const { shortestLabelRows, combinedLabelRows, projectDaysUntilFull } = require('./diskspace');

// Own db file, same one-concern-per-file convention as alerts.sqlite/
// notice.sqlite/etc (see lib/dbBackup.js) — lazy-open, same shape.
let db = null;
function getDb() {
  if (db) return db;
  const dbDir = process.env.SESSION_DB_DIR || '/app/data';
  fs.mkdirSync(dbDir, { recursive: true });
  db = new sqlite3.Database(path.join(dbDir, 'diskspace-history.sqlite'));
  // db.serialize() is load-bearing here, not decoration — these two DDL
  // statements are dependent (the index references the table), and plain
  // back-to-back db.run() calls have no ordering guarantee against each
  // other on a brand-new connection/file. Hit exactly this race live on
  // first-ever startup (2026-08-14): the index's own db.run() genuinely
  // executed before the table's had finished, throwing an uncaught
  // 'error' event (no callback given) that crashed the whole process.
  // Every other lazy-getDb() module in this app (alerts.js, notice.js,
  // etc.) only ever issues one schema statement, so none of them were
  // exposed to this. Error callbacks added too, defense-in-depth — an
  // uncallbacked db.run() failing for any other reason must never again
  // be able to bring the whole app down.
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS diskspace_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      free_bytes INTEGER NOT NULL,
      total_bytes INTEGER NOT NULL,
      recorded_at INTEGER NOT NULL
    )`, (err) => { if (err) console.error('[diskSpaceHistory] create table error:', err.message); });
    db.run(`CREATE INDEX IF NOT EXISTS idx_diskspace_history_label_time
      ON diskspace_history (label, recorded_at)`,
      (err) => { if (err) console.error('[diskSpaceHistory] create index error:', err.message); });
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

// The same real-filesystem-first, Radarr/Sonarr-fallback logic that used to
// live inline in routes/owner.js's GET /diskspace — moved here so the live
// route and this module's periodic poll both read current disk space
// through the exact same path instead of two copies drifting apart.
async function getCurrentRows() {
  const fsVolumes = await mediaStorage.getVolumes();
  if (fsVolumes.length) return combinedLabelRows(fsVolumes);

  const [radarr, sonarr] = await Promise.all([
    settle('radarr diskspace', axios.get(`${process.env.RADARR_URL}/api/v3/diskspace`, {
      headers: { 'X-Api-Key': process.env.RADARR_API_KEY }
    }).then(r => r.data), []),
    settle('sonarr diskspace', axios.get(`${process.env.SONARR_URL}/api/v3/diskspace`, {
      headers: { 'X-Api-Key': process.env.SONARR_API_KEY }
    }).then(r => r.data), [])
  ]);
  const volumes = [...radarr, ...sonarr].map(d => ({
    label: d.label || d.path,
    totalBytes: d.totalSpace,
    freeBytes: d.freeSpace
  }));
  return shortestLabelRows(volumes);
}

async function recordSnapshot(now = Date.now()) {
  const rows = await getCurrentRows();
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    await run(
      `INSERT INTO diskspace_history (label, free_bytes, total_bytes, recorded_at) VALUES (?, ?, ?, ?)`,
      [row.path, row.freeBytes, row.totalBytes, now]
    );
  }
  return rows;
}

const RETENTION_DAYS = 90;

async function pruneOld(retentionDays = RETENTION_DAYS, now = Date.now()) {
  const cutoff = now - retentionDays * 86400000;
  const result = await run(`DELETE FROM diskspace_history WHERE recorded_at < ?`, [cutoff]);
  return result.changes;
}

// One entry per label currently reported by getCurrentRows(), each carrying
// its own history + trend projection — a label with no stored history yet
// (freshly added volume, or the poller hasn't run twice yet) just gets an
// empty history and a null projection rather than an error.
async function getHistoryWithProjection() {
  const currentRows = await getCurrentRows();
  const result = {};
  for (const row of currentRows) {
    // eslint-disable-next-line no-await-in-loop
    const history = await all(
      `SELECT free_bytes AS freeBytes, total_bytes AS totalBytes, recorded_at AS recordedAt
       FROM diskspace_history WHERE label = ? ORDER BY recorded_at ASC`,
      [row.path]
    );
    result[row.path] = { history, projection: projectDaysUntilFull(history) };
  }
  return result;
}

// Hourly is plenty for a slow-moving metric like free disk space, and keeps
// 90 days of retention to a trivial row count (~2160 rows/volume) — no need
// for finer granularity than that to get a useful multi-week trend line.
const POLL_INTERVAL_MS = 60 * 60 * 1000;

function start() {
  const tick = () => {
    recordSnapshot()
      .then(() => pruneOld())
      .catch((err) => console.error('[diskSpaceHistory] snapshot failed:', err.message));
  };
  tick();
  setInterval(tick, POLL_INTERVAL_MS);
}

module.exports = { getCurrentRows, recordSnapshot, pruneOld, getHistoryWithProjection, start, RETENTION_DAYS };
