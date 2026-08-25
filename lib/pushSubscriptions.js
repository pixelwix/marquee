const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');

// Web Push subscriptions — originally owner-only (deliberately a fresh file/
// table, not a resurrection of the old (removed in v1.5.0) family-wide
// push.sqlite, whose rows were stale and unscoped). Now scoped per-user
// (user_id + is_owner columns) so any signed-in family member can subscribe
// to their own notifications (e.g. "your request is available"), not just
// the owner's stack alerts — see routes/push.js and lib/pushNotify.js's
// notifyUser(). is_owner is a denormalized snapshot captured at subscribe
// time (same pattern as lib/loginLog.js's is_owner column) so notifyOwners()
// doesn't need a separate "who is the owner" lookup.
//
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
        user_id TEXT,
        is_owner INTEGER,
        created_at INTEGER
      )`,
      (createErr) => {
        if (createErr) return reject(createErr);
        // Pre-existing rows predate per-user scoping and were only ever
        // created through the old requireOwner-gated /subscribe route, so
        // backfilling is_owner=1 (user_id stays NULL — the real Plex user id
        // was never captured) keeps notifyOwners() working for them exactly
        // as before, while notifyUser() simply never matches an unscoped row.
        db.all(`PRAGMA table_info(owner_push_subscriptions)`, (pragmaErr, cols) => {
          if (pragmaErr) return reject(pragmaErr);
          const names = new Set(cols.map(c => c.name));
          const migrations = [];
          if (!names.has('user_id')) migrations.push(`ALTER TABLE owner_push_subscriptions ADD COLUMN user_id TEXT`);
          if (!names.has('is_owner')) migrations.push(`ALTER TABLE owner_push_subscriptions ADD COLUMN is_owner INTEGER`);
          if (!migrations.length) return resolve();
          const runNext = (i) => {
            if (i >= migrations.length) {
              if (!names.has('is_owner')) {
                return db.run(`UPDATE owner_push_subscriptions SET is_owner = 1 WHERE is_owner IS NULL`, (backfillErr) => (backfillErr ? reject(backfillErr) : resolve()));
              }
              return resolve();
            }
            db.run(migrations[i], (migErr) => (migErr ? reject(migErr) : runNext(i + 1)));
          };
          runNext(0);
        });
      }
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
// accumulating duplicates for what's really the same device. user/isOwner
// are re-stamped on every upsert too, so a subscription made before a login
// (edge case: shouldn't happen, every /subscribe caller is requireAuth'd)
// or a since-revoked owner status never lingers stale.
async function save(subscription, userId, isOwner) {
  const conn = await withDb();
  return new Promise((resolve, reject) => {
    conn.run(
      `INSERT INTO owner_push_subscriptions (endpoint, p256dh, auth, user_id, is_owner, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, user_id = excluded.user_id, is_owner = excluded.is_owner`,
      [subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, String(userId), isOwner ? 1 : 0, Date.now()],
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

async function forOwner() {
  const conn = await withDb();
  return new Promise((resolve, reject) => {
    conn.all('SELECT endpoint, p256dh, auth FROM owner_push_subscriptions WHERE is_owner = 1', [], (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function forUser(userId) {
  const conn = await withDb();
  return new Promise((resolve, reject) => {
    conn.all('SELECT endpoint, p256dh, auth FROM owner_push_subscriptions WHERE user_id = ?', [String(userId)], (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

module.exports = { save, remove, forOwner, forUser };
