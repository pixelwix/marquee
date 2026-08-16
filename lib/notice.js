const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');

// A single scheduled announcement (e.g. "down Monday night for maintenance"),
// not a list — one row, always id=1, upserted in place. Separate db file from
// sessions/logins. Opened lazily (not at module load, unlike lib/loginLog.js)
// so computeStatus below stays importable/unit-testable without touching the
// filesystem — SESSION_DB_DIR only actually exists inside the container.
// `ready` is awaited by every query below before touching the connection —
// db.run(CREATE TABLE...) with no callback, immediately followed by another
// .run()/.get() on the same fresh connection, has no ordering guarantee and
// can genuinely race on a truly cold file (hit live in lib/recapUnsubscribes.js
// and lib/streamOrigins.js, which this mirrors).
let db = null;
let ready = null;
function getDb() {
  if (db) return db;
  const dbDir = process.env.SESSION_DB_DIR || '/app/data';
  fs.mkdirSync(dbDir, { recursive: true });
  db = new sqlite3.Database(path.join(dbDir, 'notice.sqlite'));
  ready = new Promise((resolve, reject) => {
    db.run(`CREATE TABLE IF NOT EXISTS notice (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      message TEXT NOT NULL,
      starts_at INTEGER,
      ends_at INTEGER,
      updated_at INTEGER
    )`, (err) => (err ? reject(err) : resolve()));
  });
  return db;
}

async function withDb() {
  const conn = getDb();
  await ready;
  return conn;
}

async function get() {
  const conn = await withDb();
  return new Promise((resolve, reject) => {
    conn.get(
      'SELECT message, starts_at AS startsAt, ends_at AS endsAt, updated_at AS updatedAt FROM notice WHERE id = 1',
      (err, row) => err ? reject(err) : resolve(row || null)
    );
  });
}

async function set({ message, startsAt, endsAt }) {
  const conn = await withDb();
  return new Promise((resolve, reject) => {
    conn.run(
      'INSERT OR REPLACE INTO notice (id, message, starts_at, ends_at, updated_at) VALUES (1, ?, ?, ?, ?)',
      [message, startsAt ?? null, endsAt ?? null, Date.now()],
      err => err ? reject(err) : resolve()
    );
  });
}

async function clear() {
  const conn = await withDb();
  return new Promise((resolve, reject) => {
    conn.run('DELETE FROM notice WHERE id = 1', err => err ? reject(err) : resolve());
  });
}

// Pure — testable without touching the DB. A missing startsAt means "show
// immediately", a missing endsAt means "show until cleared".
function computeStatus(notice, now = Date.now()) {
  if (!notice) return 'none';
  if (notice.startsAt && now < notice.startsAt) return 'scheduled';
  if (notice.endsAt && now > notice.endsAt) return 'expired';
  return 'active';
}

module.exports = { get, set, clear, computeStatus };
