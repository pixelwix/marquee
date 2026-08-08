const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marquee-dbbackup-'));
process.env.SESSION_DB_DIR = dbDir;
const dbBackup = require('../lib/dbBackup');

function createSqliteFile(name) {
  const dbPath = path.join(dbDir, name);
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) return reject(err);
      db.run('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)', (createErr) => {
        if (createErr) return reject(createErr);
        db.run("INSERT INTO t (val) VALUES ('hello')", (insertErr) => {
          db.close();
          if (insertErr) return reject(insertErr);
          resolve(dbPath);
        });
      });
    });
  });
}

test('backupsToRemove keeps recent directories and flags only ones past the retention window', () => {
  const now = Date.UTC(2026, 0, 15);
  const day = 86400000;
  const entries = [
    { name: 'recent', isDirectory: true, mtimeMs: now - 1 * day },
    { name: 'boundary', isDirectory: true, mtimeMs: now - 14 * day - 1 },
    { name: 'old', isDirectory: true, mtimeMs: now - 30 * day },
    { name: 'not-a-dir.json', isDirectory: false, mtimeMs: now - 30 * day },
  ];
  const removed = dbBackup.backupsToRemove(entries, 14, now);
  assert.deepEqual(removed.sort(), ['boundary', 'old']);
});

test('backupsToRemove keeps everything when nothing is past the cutoff', () => {
  const now = Date.UTC(2026, 0, 15);
  const entries = [{ name: 'fresh', isDirectory: true, mtimeMs: now - 1000 }];
  assert.deepEqual(dbBackup.backupsToRemove(entries, 14, now), []);
});

test('runBackup backs up a healthy database via VACUUM INTO and records it in the manifest', async () => {
  await createSqliteFile('healthy.sqlite');
  const result = await dbBackup.runBackup();
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].name, 'healthy.sqlite');
  assert.equal(result.results[0].ok, true);
  assert.ok(result.results[0].bytes > 0);

  const backedUpPath = path.join(result.dir, 'healthy.sqlite');
  assert.ok(fs.existsSync(backedUpPath));
  const manifest = JSON.parse(fs.readFileSync(path.join(result.dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.results[0].ok, true);
});

test('runBackup skips a database that fails its integrity check instead of copying corruption forward', async () => {
  const corruptPath = path.join(dbDir, 'corrupt.sqlite');
  // A file with the sqlite header but garbage after it — reliably fails
  // PRAGMA integrity_check without needing to hand-craft a valid header
  // then corrupt specific pages.
  fs.writeFileSync(corruptPath, Buffer.concat([
    Buffer.from('SQLite format 3\0'),
    Buffer.from('not a real page'.repeat(50)),
  ]));

  const result = await dbBackup.runBackup();
  const corrupt = result.results.find((r) => r.name === 'corrupt.sqlite');
  assert.equal(corrupt.ok, false);
  assert.match(corrupt.reason, /integrity check failed/);
  assert.equal(fs.existsSync(path.join(result.dir, 'corrupt.sqlite')), false);

  fs.unlinkSync(corruptPath);
});

test('listRecentBackups reads history back from manifest files on disk, newest first', async () => {
  const recent = dbBackup.listRecentBackups(5);
  assert.ok(recent.length >= 1);
  assert.ok(recent[0].stamp >= recent[recent.length - 1].stamp);
});

test('pruneOldBackups removes directories older than the retention window and reports what it removed', () => {
  const staleDir = path.join(dbBackup.BACKUP_DIR, '2000-01-01T00-00-00-000Z');
  fs.mkdirSync(staleDir, { recursive: true });
  const old = new Date('2000-01-01T00:00:00Z');
  fs.utimesSync(staleDir, old, old);

  const removed = dbBackup.pruneOldBackups(14, Date.now());
  assert.ok(removed.includes('2000-01-01T00-00-00-000Z'));
  assert.equal(fs.existsSync(staleDir), false);
});
