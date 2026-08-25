const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');

// Separate from express-session's own sessions.sqlite (owned by connect-sqlite3) —
// this is a small durable sign-in history, independent of session lifetime, so an
// entry stays visible in the admin panel after the session itself expires or the
// user signs out.
const dbDir = process.env.SESSION_DB_DIR || '/app/data';
fs.mkdirSync(dbDir, { recursive: true });
const db = new sqlite3.Database(path.join(dbDir, 'logins.sqlite'));
// db.run(CREATE TABLE...) with no callback, immediately followed by another
// .run()/.all() on the same fresh connection, has no ordering guarantee and
// can genuinely race on a truly cold file (hit live in lib/recapUnsubscribes.js
// and lib/streamOrigins.js, which this mirrors) — record()/recent() below both
// await this before touching the connection, even though the connection
// itself is still opened eagerly at module load like before.
const ready = new Promise((resolve, reject) => {
  db.run(`CREATE TABLE IF NOT EXISTS logins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plex_user_id TEXT NOT NULL,
    username TEXT,
    thumb TEXT,
    is_owner INTEGER,
    at INTEGER
  )`, (err) => (err ? reject(err) : resolve()));
});

// Callers don't await this (fire-and-forget, same as before) — the internal
// try/catch keeps a rejected `ready` from becoming an unhandled rejection.
async function record(user) {
  try {
    await ready;
  } catch (err) {
    console.error('login log write error', err.message);
    return;
  }
  db.run(
    'INSERT INTO logins (plex_user_id, username, thumb, is_owner, at) VALUES (?, ?, ?, ?, ?)',
    [String(user.id), user.username, user.thumb, user.isOwner ? 1 : 0, Date.now()],
    err => { if (err) console.error('login log write error', err.message); }
  );
}

// One row per person (their most recent sign-in), not a raw event feed — an
// admin glancing at this wants "who's around", not a noisy log of every
// individual page refresh/re-poll.
async function recent(limit = 20) {
  await ready;
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT username, thumb, is_owner, MAX(at) AS at
       FROM logins GROUP BY plex_user_id ORDER BY at DESC LIMIT ?`,
      [limit],
      (err, rows) => err ? reject(err) : resolve(rows)
    );
  });
}

// Resolves a Plex username back to their Plex user id (Marquee's session
// user id) — used to correlate Overseerr's webhook payload (which only ever
// gives us request.requestedBy_username, a display string) back to a real
// push-subscription target in routes/overseerr.js's /webhook. Most recent
// login wins on a username collision (shouldn't happen — Plex usernames are
// globally unique — but MAX(at) matches recent()'s own tie-break above).
async function findUserIdByUsername(username) {
  if (!username) return null;
  await ready;
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT plex_user_id FROM logins WHERE username = ? ORDER BY at DESC LIMIT 1`,
      [username],
      (err, row) => err ? reject(err) : resolve(row?.plex_user_id || null)
    );
  });
}

module.exports = { record, recent, findUserIdByUsername };
