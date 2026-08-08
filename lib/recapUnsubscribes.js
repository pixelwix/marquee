const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');

// Who's opted out of the monthly recap email. Own dedicated sqlite file,
// same base pattern as lib/pushSubscriptions.js (opened lazily, not at
// module load — SESSION_DB_DIR only actually exists inside the container,
// and eagerly mkdir-ing at require() time broke `npm test` running outside
// one), but with one deliberate difference: this waits for the CREATE TABLE
// to actually finish before running any query against it. Found live, on a
// genuinely fresh (never-before-created) sqlite file, that `db.run(CREATE
// TABLE...)` immediately followed by another `.run()` on the same
// just-constructed Database object is a real race, not just a theoretical
// one — the very first real request through the unsubscribe route hit
// "SQLITE_ERROR: no such table" this way. lib/pushSubscriptions.js has the
// identical unguarded pattern; it's just apparently never been exercised
// against a truly cold file in practice. Worth fixing there too at some
// point, not done here since that's a separate, already-shipped feature.
let db = null;
let ready = null;

function getDb() {
  if (db) return db;
  const dbDir = process.env.SESSION_DB_DIR || '/app/data';
  fs.mkdirSync(dbDir, { recursive: true });
  db = new sqlite3.Database(path.join(dbDir, 'recap-unsubscribes.sqlite'));
  ready = new Promise((resolve, reject) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS recap_unsubscribes (
        user_id TEXT PRIMARY KEY,
        unsubscribed_at INTEGER
      )`,
      (err) => (err ? reject(err) : resolve())
    );
  });
  return db;
}

async function withDb() {
  const conn = getDb();
  await ready;
  return conn;
}

async function unsubscribe(userId) {
  const conn = await withDb();
  return new Promise((resolve, reject) => {
    conn.run(
      `INSERT INTO recap_unsubscribes (user_id, unsubscribed_at) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET unsubscribed_at = excluded.unsubscribed_at`,
      [String(userId), Date.now()],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

async function resubscribe(userId) {
  const conn = await withDb();
  return new Promise((resolve, reject) => {
    conn.run('DELETE FROM recap_unsubscribes WHERE user_id = ?', [String(userId)], (err) => (err ? reject(err) : resolve()));
  });
}

async function isUnsubscribed(userId) {
  const conn = await withDb();
  return new Promise((resolve, reject) => {
    conn.get('SELECT 1 FROM recap_unsubscribes WHERE user_id = ?', [String(userId)], (err, row) => (err ? reject(err) : resolve(Boolean(row))));
  });
}

async function all() {
  const conn = await withDb();
  return new Promise((resolve, reject) => {
    conn.all('SELECT user_id, unsubscribed_at FROM recap_unsubscribes', [], (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

module.exports = { unsubscribe, resubscribe, isUnsubscribed, all };
