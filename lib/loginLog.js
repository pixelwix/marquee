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
db.run(`CREATE TABLE IF NOT EXISTS logins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plex_user_id TEXT NOT NULL,
  username TEXT,
  thumb TEXT,
  is_owner INTEGER,
  at INTEGER
)`);

function record(user) {
  db.run(
    'INSERT INTO logins (plex_user_id, username, thumb, is_owner, at) VALUES (?, ?, ?, ?, ?)',
    [String(user.id), user.username, user.thumb, user.isOwner ? 1 : 0, Date.now()],
    err => { if (err) console.error('login log write error', err.message); }
  );
}

// One row per person (their most recent sign-in), not a raw event feed — an
// admin glancing at this wants "who's around", not a noisy log of every
// individual page refresh/re-poll.
function recent(limit = 20) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT username, thumb, is_owner, MAX(at) AS at
       FROM logins GROUP BY plex_user_id ORDER BY at DESC LIMIT ?`,
      [limit],
      (err, rows) => err ? reject(err) : resolve(rows)
    );
  });
}

module.exports = { record, recent };
