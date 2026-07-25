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

module.exports = { getMonitors };
