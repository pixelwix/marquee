const sqlite3 = require('sqlite3');
const fs = require('fs');

// Uptime Kuma has no lightweight read API for this without first setting up a
// public status page in its own UI — so this reads its SQLite database directly
// instead (read-only open, bind-mounted from its data directory). Standard SQLite
// WAL semantics make this safe to read concurrently while Kuma itself is writing.
const STATUS_LABELS = { 0: 'down', 1: 'up', 2: 'pending', 3: 'maintenance' };

// Opened once and reused — this panel refreshes every 15s for as long as an owner
// has the dashboard open, and re-opening the file on every request is pure waste.
let db = null;

function getDb() {
  const dbPath = process.env.UPTIME_KUMA_DB_PATH;
  if (!dbPath || !fs.existsSync(dbPath)) return null;
  if (!db) db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
  return db;
}

function query(conn) {
  return new Promise((resolve, reject) => {
    // A window function scans heartbeat once and ranks per monitor, rather than a
    // correlated subquery re-run once per monitor row.
    conn.all(`
      SELECT name, status FROM (
        SELECT m.name, h.status,
               ROW_NUMBER() OVER (PARTITION BY m.id ORDER BY h.time DESC) AS rn
        FROM monitor m
        LEFT JOIN heartbeat h ON h.monitor_id = m.id
        WHERE m.active = 1
      ) WHERE rn = 1
      ORDER BY name
    `, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function getMonitors() {
  const conn = getDb();
  if (!conn) return [];
  const rows = await query(conn);
  return rows.map(r => ({ name: r.name, status: STATUS_LABELS[r.status] || 'unknown' }));
}

// Uptime percentage for a single monitor within [startUnix, endUnix) — used by
// the monthly recap's Service Status line. `datetime(?, 'unixepoch')` on the
// bound params sidesteps trusting whatever string format Kuma itself wrote
// heartbeat.time in, comparing on the same unix-epoch basis instead.
function queryUptime(conn, monitorName, startUnix, endUnix) {
  return new Promise((resolve, reject) => {
    conn.get(`
      SELECT COUNT(*) AS total, SUM(CASE WHEN h.status = 0 THEN 1 ELSE 0 END) AS down
      FROM heartbeat h
      JOIN monitor m ON m.id = h.monitor_id
      WHERE m.name = ? AND h.time > datetime(?, 'unixepoch') AND h.time <= datetime(?, 'unixepoch')
    `, [monitorName, startUnix, endUnix], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

async function getMonthlyUptime(monitorName, period) {
  const conn = getDb();
  if (!conn) return null;
  const row = await queryUptime(conn, monitorName, period.startUnix, period.endUnix);
  if (!row || !row.total) return null;
  // A real check interval (even a slow one) logs at least one heartbeat a
  // day — fewer than that means the monitor was barely checking at all for
  // some/all of this window (interval changed, monitor paused, etc.), and a
  // percentage built from a handful of samples would be misleading rather
  // than informative. Found live: this deployment's "plex" monitor had just
  // 8 heartbeats across all of July before its interval was tightened to
  // ~30s in early August — an 8-sample "50% uptime" for the month would
  // have been wrong to put in front of anyone.
  const daysInPeriod = (period.endUnix - period.startUnix) / 86400;
  if (row.total < daysInPeriod) return null;
  return {
    percent: Math.round(((row.total - row.down) / row.total) * 1000) / 10,
    downBeats: row.down,
    totalBeats: row.total,
  };
}

function mapCurrentUptimeRow(row, nowUnix = Math.floor(Date.now() / 1000), staleAfterSeconds = 10 * 60) {
  if (!row || row.currentStatus == null || !row.latestUnix) return null;
  if (nowUnix - row.latestUnix > staleAfterSeconds) return { status: 'unknown' };
  if (row.currentStatus !== 1) return { status: STATUS_LABELS[row.currentStatus] || 'unknown' };
  if (!row.sinceUnix) return { status: 'unknown' };
  return { status: 'up', since: row.sinceUnix * 1000, seconds: Math.max(0, nowUnix - row.sinceUnix) };
}

function queryCurrentUptime(conn, monitorName) {
  return new Promise((resolve, reject) => {
    conn.get(`
      WITH target AS (
        SELECT id FROM monitor WHERE LOWER(name) = LOWER(?) AND active = 1 LIMIT 1
      ), latest AS (
        SELECT status, time FROM heartbeat
        WHERE monitor_id = (SELECT id FROM target)
        ORDER BY time DESC LIMIT 1
      ), boundary AS (
        SELECT MAX(time) AS time FROM heartbeat
        WHERE monitor_id = (SELECT id FROM target) AND status != 1
          AND time <= (SELECT time FROM latest)
      )
      SELECT
        (SELECT status FROM latest) AS currentStatus,
        CAST(strftime('%s', (SELECT time FROM latest)) AS INTEGER) AS latestUnix,
        CAST(strftime('%s', COALESCE(
          (SELECT MIN(time) FROM heartbeat
           WHERE monitor_id = (SELECT id FROM target) AND status = 1
             AND time > (SELECT time FROM boundary)),
          (SELECT MIN(time) FROM heartbeat
           WHERE monitor_id = (SELECT id FROM target) AND status = 1)
        )) AS INTEGER) AS sinceUnix
    `, [monitorName], (err, row) => (err ? reject(err) : resolve(row)));
  });
}

async function getCurrentUptime(monitorName) {
  const conn = getDb();
  if (!conn) return null;
  return mapCurrentUptimeRow(await queryCurrentUptime(conn, monitorName));
}

module.exports = { getMonitors, getMonthlyUptime, getCurrentUptime, mapCurrentUptimeRow };
