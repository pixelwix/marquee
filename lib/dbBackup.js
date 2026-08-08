const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');

// This app owns 9+ sqlite files (sessions, notices, alerts, login history,
// push subscriptions, recap unsubscribes/reminders/sends, audit log) and,
// before this, had no backup path for any of them — a lost/corrupted volume
// meant losing all of it with no recovery option. Runs daily, in-process,
// same setInterval scheduler shape as lib/issueWatchdog.js/lib/recapReminder.js
// (this app has no external cron to hook into).
//
// Uses `VACUUM INTO` for the actual backup, not a plain file copy — a raw
// copy of a live SQLite file (especially in WAL mode, where recent writes
// may still be sitting in a separate -wal file) risks capturing an
// inconsistent snapshot. `VACUUM INTO` goes through SQLite's own
// transactional machinery and is specifically documented as safe to run
// against a live, open database. Confirmed working against this exact
// driver/version before relying on it.
const DATA_DIR = process.env.SESSION_DB_DIR || '/app/data';
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const RETENTION_DAYS = 14;
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Excludes the backups directory itself from being treated as a database to
// back up, and only ever looks at the top level of DATA_DIR — every module
// in this app puts its .sqlite file directly there, none nest in
// subdirectories.
function listDatabases() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.sqlite'))
    .map((f) => path.join(DATA_DIR, f))
    .filter((p) => fs.statSync(p).isFile());
}

function integrityCheck(dbPath) {
  return new Promise((resolve) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (openErr) => {
      if (openErr) return resolve({ ok: false, detail: openErr.message });
      db.get('PRAGMA integrity_check', (err, row) => {
        db.close();
        if (err) return resolve({ ok: false, detail: err.message });
        const result = row && row.integrity_check;
        resolve({ ok: result === 'ok', detail: result || 'unknown result' });
      });
    });
  });
}

function backupOne(dbPath, destPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
    db.run('VACUUM INTO ?', [destPath], (err) => {
      db.close();
      if (err) return reject(err);
      resolve();
    });
  });
}

// One dated subdirectory per run, holding every db's backup copy plus a
// manifest.json — the manifest is what listRecentBackups() reads later, so
// backup *history* survives container restarts without needing yet another
// database to track it in (this app just gained enough of those already).
async function runBackup(now = new Date()) {
  const startedAt = now.toISOString();
  const stamp = startedAt.replace(/[:.]/g, '-');
  const destDir = path.join(BACKUP_DIR, stamp);
  fs.mkdirSync(destDir, { recursive: true });

  const results = [];
  for (const dbPath of listDatabases()) {
    const name = path.basename(dbPath);
    // eslint-disable-next-line no-await-in-loop
    const integrity = await integrityCheck(dbPath);
    if (!integrity.ok) {
      // Deliberately not backed up — copying a file already known to be
      // corrupt would just preserve the corruption under a reassuring
      // "backup completed" label instead of surfacing the real problem.
      results.push({ name, ok: false, reason: `integrity check failed: ${integrity.detail}` });
      continue;
    }
    try {
      const destPath = path.join(destDir, name);
      // eslint-disable-next-line no-await-in-loop
      await backupOne(dbPath, destPath);
      results.push({ name, ok: true, bytes: fs.statSync(destPath).size });
    } catch (err) {
      results.push({ name, ok: false, reason: err.message });
    }
  }

  const manifest = { startedAt, completedAt: new Date().toISOString(), results };
  fs.writeFileSync(path.join(destDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { stamp, dir: destDir, ...manifest };
}

// Pure given a directory listing + mtimes — the actual fs calls are kept
// separate (pruneOldBackups below) so this logic is testable without
// touching disk.
function backupsToRemove(entries, retentionDays, now) {
  const cutoff = now - retentionDays * 86400000;
  return entries.filter((e) => e.isDirectory && e.mtimeMs < cutoff).map((e) => e.name);
}

function pruneOldBackups(retentionDays = RETENTION_DAYS, now = Date.now()) {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  const entries = fs.readdirSync(BACKUP_DIR).map((name) => {
    const full = path.join(BACKUP_DIR, name);
    const stat = fs.statSync(full);
    return { name, isDirectory: stat.isDirectory(), mtimeMs: stat.mtimeMs };
  });
  const toRemove = backupsToRemove(entries, retentionDays, now);
  for (const name of toRemove) {
    fs.rmSync(path.join(BACKUP_DIR, name), { recursive: true, force: true });
  }
  return toRemove;
}

async function runBackupAndPrune(now = new Date()) {
  const result = await runBackup(now);
  const pruned = pruneOldBackups(RETENTION_DAYS, now.getTime());
  return { ...result, pruned };
}

// Derived entirely from the manifest files on disk — see runBackup's own
// comment on why history isn't tracked in yet another database.
function listRecentBackups(limit = 10) {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  const dirs = fs.readdirSync(BACKUP_DIR)
    .filter((name) => fs.statSync(path.join(BACKUP_DIR, name)).isDirectory())
    .sort()
    .reverse()
    .slice(0, Math.max(1, Math.min(Number(limit) || 10, 50)));
  return dirs.map((name) => {
    const manifestPath = path.join(BACKUP_DIR, name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return { stamp: name, startedAt: null, completedAt: null, results: [] };
    try {
      return { stamp: name, ...JSON.parse(fs.readFileSync(manifestPath, 'utf8')) };
    } catch {
      return { stamp: name, startedAt: null, completedAt: null, results: [], error: 'manifest unreadable' };
    }
  });
}

function start() {
  runBackupAndPrune().catch((err) => console.error('[dbBackup] initial run failed:', err.message));
  setInterval(() => {
    runBackupAndPrune().catch((err) => console.error('[dbBackup] scheduled run failed:', err.message));
  }, BACKUP_INTERVAL_MS);
}

module.exports = {
  listDatabases, integrityCheck, runBackup, backupsToRemove, pruneOldBackups,
  runBackupAndPrune, listRecentBackups, start, BACKUP_DIR, RETENTION_DAYS,
};
