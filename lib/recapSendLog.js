const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');

let db = null;
let ready = null;
const STALE_CLAIM_MS = 15 * 60 * 1000;

function getDb() {
  if (db) return db;
  const dbDir = process.env.SESSION_DB_DIR || '/app/data';
  fs.mkdirSync(dbDir, { recursive: true });
  db = new sqlite3.Database(path.join(dbDir, 'recap-sends.sqlite'));
  ready = new Promise((resolve, reject) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS recap_send_state (
        period_key TEXT NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL,
        last_attempt_at INTEGER NOT NULL,
        last_sent_at INTEGER,
        PRIMARY KEY (period_key, user_id)
      );
      CREATE TABLE IF NOT EXISTS recap_send_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        period_key TEXT NOT NULL,
        user_id TEXT NOT NULL,
        recipient_name TEXT,
        status TEXT NOT NULL,
        error TEXT,
        requested_by TEXT,
        is_resend INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS recap_send_attempts_period_idx
        ON recap_send_attempts(period_key, started_at DESC);
    `, (err) => (err ? reject(err) : resolve()));
  });
  return db;
}

async function withDb() {
  const conn = getDb();
  await ready;
  return conn;
}

function run(conn, sql, params = []) {
  return new Promise((resolve, reject) => {
    conn.run(sql, params, function onRun(err) { err ? reject(err) : resolve(this); });
  });
}

function all(conn, sql, params = []) {
  return new Promise((resolve, reject) => {
    conn.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function claim({ periodKey, userId, recipientName, requestedBy, resend = false, now = Date.now() }) {
  const conn = await withDb();
  const result = await run(conn, `
    INSERT INTO recap_send_state (period_key, user_id, status, last_attempt_at)
    VALUES (?, ?, 'sending', ?)
    ON CONFLICT(period_key, user_id) DO UPDATE SET
      status='sending', last_attempt_at=excluded.last_attempt_at
    WHERE (recap_send_state.status != 'sending' OR recap_send_state.last_attempt_at < ?)
      AND (? = 1 OR recap_send_state.status != 'sent')
  `, [periodKey, String(userId), now, now - STALE_CLAIM_MS, resend ? 1 : 0]);

  if (!result.changes) {
    const rows = await all(conn, 'SELECT status, last_sent_at AS lastSentAt FROM recap_send_state WHERE period_key=? AND user_id=?', [periodKey, String(userId)]);
    return { claimed: false, reason: rows[0]?.status === 'sending' ? 'send already in progress' : 'already sent', lastSentAt: rows[0]?.lastSentAt ?? null };
  }

  await run(conn, `UPDATE recap_send_attempts SET status='failed', error='abandoned send claim expired', completed_at=?
                   WHERE period_key=? AND user_id=? AND status='sending'`, [now, periodKey, String(userId)]);
  const attempt = await run(conn, `
    INSERT INTO recap_send_attempts
      (period_key, user_id, recipient_name, status, requested_by, is_resend, started_at)
    VALUES (?, ?, ?, 'sending', ?, ?, ?)
  `, [periodKey, String(userId), recipientName || null, requestedBy || null, resend ? 1 : 0, now]);
  return { claimed: true, attemptId: attempt.lastID };
}

async function finish(attemptId, { ok, error = null, now = Date.now() }) {
  const conn = await withDb();
  const rows = await all(conn, 'SELECT period_key, user_id FROM recap_send_attempts WHERE id=?', [attemptId]);
  if (!rows.length) throw new Error('Unknown recap send attempt');
  const { period_key: periodKey, user_id: userId } = rows[0];
  const status = ok ? 'sent' : 'failed';
  await run(conn, 'UPDATE recap_send_attempts SET status=?, error=?, completed_at=? WHERE id=?', [status, error, now, attemptId]);
  await run(conn, `UPDATE recap_send_state SET status=?, last_sent_at=CASE WHEN ?='sent' THEN ? ELSE last_sent_at END
                   WHERE period_key=? AND user_id=?`, [status, status, now, periodKey, userId]);
}

async function statusFor(periodKey) {
  const conn = await withDb();
  const rows = await all(conn, `SELECT user_id AS userId, status, last_attempt_at AS lastAttemptAt,
    last_sent_at AS lastSentAt FROM recap_send_state WHERE period_key=?`, [periodKey]);
  return new Map(rows.map((row) => [row.userId, row]));
}

async function history(limit = 50) {
  const conn = await withDb();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  return all(conn, `SELECT id, period_key AS periodKey, user_id AS userId,
    recipient_name AS recipientName, status, error, requested_by AS requestedBy,
    is_resend AS isResend, started_at AS startedAt, completed_at AS completedAt
    FROM recap_send_attempts ORDER BY started_at DESC LIMIT ?`, [safeLimit]);
}

module.exports = { STALE_CLAIM_MS, claim, finish, statusFor, history };
