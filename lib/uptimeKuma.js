const sqlite3 = require('sqlite3');
const fs = require('fs');

// Uptime Kuma has no lightweight read API for this without first setting up a
// public status page in its own UI — so this reads its SQLite database directly
// instead (read-only open, bind-mounted from its data directory). Standard SQLite
// WAL semantics make this safe to read concurrently while Kuma itself is writing.
const STATUS_LABELS = { 0: 'down', 1: 'up', 2: 'pending', 3: 'maintenance' };

function query(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, err => {
      if (err) return reject(err);
    });
    db.all(`
      SELECT m.name,
        (SELECT status FROM heartbeat WHERE monitor_id = m.id ORDER BY time DESC LIMIT 1) AS status
      FROM monitor m
      WHERE m.active = 1
      ORDER BY m.name
    `, (err, rows) => {
      db.close();
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function getMonitors() {
  const dbPath = process.env.UPTIME_KUMA_DB_PATH;
  if (!dbPath || !fs.existsSync(dbPath)) return [];
  const rows = await query(dbPath);
  return rows.map(r => ({ name: r.name, status: STATUS_LABELS[r.status] || 'unknown' }));
}

module.exports = { getMonitors };
