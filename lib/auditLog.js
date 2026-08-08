const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');

let db = null;
let ready = null;

function maskIp(value) {
  if (!value) return null;
  const ip = String(value).split(',')[0].trim().replace(/^::ffff:/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return `${ip.split('.').slice(0, 3).join('.')}.0/24`;
  if (ip.includes(':')) return `${ip.split(':').slice(0, 4).join(':')}::/64`;
  return null;
}

function getDb() {
  if (db) return db;
  const dbDir = process.env.SESSION_DB_DIR || '/app/data';
  fs.mkdirSync(dbDir, { recursive: true });
  db = new sqlite3.Database(path.join(dbDir, 'audit.sqlite'));
  ready = new Promise((resolve, reject) => {
    db.exec(`CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_id TEXT,
      actor_name TEXT,
      success INTEGER NOT NULL,
      status_code INTEGER,
      ip_prefix TEXT,
      user_agent TEXT,
      detail TEXT,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_events_at_idx ON audit_events(at DESC);`,
    (err) => (err ? reject(err) : resolve()));
  });
  return db;
}

async function withDb() {
  const conn = getDb();
  await ready;
  return conn;
}

async function record({ kind, action, actorId, actorName, success = true, statusCode, ip, userAgent, detail, at = Date.now() }) {
  const conn = await withDb();
  const safeDetail = detail == null ? null : JSON.stringify(detail).slice(0, 2000);
  return new Promise((resolve, reject) => {
    conn.run(`INSERT INTO audit_events
      (kind, action, actor_id, actor_name, success, status_code, ip_prefix, user_agent, detail, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [kind, action, actorId == null ? null : String(actorId), actorName || null, success ? 1 : 0,
      statusCode ?? null, maskIp(ip), userAgent ? String(userAgent).slice(0, 300) : null, safeDetail, at],
    (err) => {
      if (err) return reject(err);
      conn.run('DELETE FROM audit_events WHERE at < ?', [at - 180 * 86400 * 1000],
        (cleanupErr) => (cleanupErr ? reject(cleanupErr) : resolve()));
    });
  });
}

async function recent(limit = 100) {
  const conn = await withDb();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  return new Promise((resolve, reject) => {
    conn.all(`SELECT id, kind, action, actor_id AS actorId, actor_name AS actorName,
      success, status_code AS statusCode, ip_prefix AS ipPrefix, user_agent AS userAgent,
      detail, at FROM audit_events ORDER BY at DESC LIMIT ?`, [safeLimit], (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map((row) => ({ ...row, success: Boolean(row.success), detail: row.detail ? JSON.parse(row.detail) : null })));
    });
  });
}

function requestContext(req) {
  return {
    actorId: req.session?.user?.id,
    actorName: req.session?.user?.username,
    ip: req.ip || req.socket?.remoteAddress,
    userAgent: req.headers['user-agent'],
  };
}

module.exports = { maskIp, record, recent, requestContext };
