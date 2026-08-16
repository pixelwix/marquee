const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');

// Owner-only Web Push subscriptions — deliberately a fresh file/table, not a
// resurrection of the old (removed in v1.5.0) family-wide push.sqlite. That
// file was left untouched on disk when the feature was pulled, so its rows
// are stale, unowned-scoped subscriptions from whoever in the family had
// notifications on at the time — wrong shape for this feature anyway (only
// the owner subscribes now, gated by requireOwner on every route in
// routes/push.js, so there's no need for a per-user column here at all).
// Opened lazily (not at module load, matching lib/notice.js and lib/alerts.js
// — SESSION_DB_DIR only actually exists inside the container, and eagerly
// mkdir-ing at require() time broke `npm test` running outside one).
//
// `ready` is awaited by every query below before touching the connection —
// db.run(CREATE TABLE...) with no callback, immediately followed by another
// .run()/.all() on the same fresh connection, has no ordering guarantee and
// can genuinely race on a truly cold file (hit live in lib/recapUnsubscribes.js
// and lib/streamOrigins.js, which this mirrors).
let db = null;
let ready = null;
function getDb() {
  if (db) return db;
  const dbDir = process.env.SESSION_DB_DIR || '/app/data';
  fs.mkdirSync(dbDir, { recursive: true });
  db = new sqlite3.Database(path.join(dbDir, 'owner-push.sqlite'));
  ready = new Promise((resolve, reject) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS owner_push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at INTEGER
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

// Upsert on endpoint — re-subscribing (e.g. after clearing browser data, or a
// push service rotating the endpoint) just refreshes the row instead of
// accumulating duplicates for what's really the same device.
async function save(subscription) {
  const conn = await withDb();
  return new Promise((resolve, reject) => {
    conn.run(
      `INSERT INTO owner_push_subscriptions (endpoint, p256dh, auth, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
      [subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, Date.now()],
      err => (err ? reject(err) : resolve())
    );
  });
}

async function remove(endpoint) {
  const conn = await withDb();
  return new Promise((resolve, reject) => {
    conn.run('DELETE FROM owner_push_subscriptions WHERE endpoint = ?', [endpoint], err => (err ? reject(err) : resolve()));
  });
}

async function all() {
  const conn = await withDb();
  return new Promise((resolve, reject) => {
    conn.all('SELECT endpoint, p256dh, auth FROM owner_push_subscriptions', [], (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

module.exports = { save, remove, all };
