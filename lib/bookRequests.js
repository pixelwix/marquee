const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const rmab = require('./rmabClient');
const pushNotify = require('./pushNotify');
const abbBridge = require('./abbBridge');

// Book requests made from Marquee. RMAB sees every request as its admin's
// (one shared API token), so this table is what remembers who asked, holds
// family requests until the owner approves them, and tracks RMAB's progress
// so the requester gets "your book is ready".
//
// status: 'pending' (waiting on the owner) | 'declined' | 'sent' (in RMAB;
// rmab_status mirrors RMAB from then on) | 'rejected' (RMAB refused it, e.g.
// already in the library).
//
// Opened lazily like lib/pushSubscriptions.js (SESSION_DB_DIR only exists in
// the container); `ready` orders CREATE TABLE before the first query.
const SYNC_MS = 10 * 60 * 1000;

let db = null;
let ready = null;
function getDb() {
  if (db) return db;
  const dbDir = process.env.SESSION_DB_DIR || '/app/data';
  fs.mkdirSync(dbDir, { recursive: true });
  db = new sqlite3.Database(path.join(dbDir, 'book-requests.sqlite'));
  ready = new Promise((resolve, reject) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS book_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        username TEXT,
        asin TEXT NOT NULL,
        title TEXT NOT NULL,
        author TEXT,
        narrator TEXT,
        description TEXT,
        cover TEXT,
        status TEXT NOT NULL,
        rmab_request_id TEXT,
        rmab_status TEXT,
        rmab_error TEXT,
        search_attempts INTEGER,
        notified INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      err => {
        if (err) return reject(err);
        // v1.75.0: which edition the requester asked for (produced | narrated | any).
        db.all(`PRAGMA table_info(book_requests)`, (e, cols) => {
          if (e) return reject(e);
          if (cols.some(c => c.name === 'edition')) return resolve();
          db.run(`ALTER TABLE book_requests ADD COLUMN edition TEXT`, e2 => (e2 ? reject(e2) : resolve()));
        });
      }
    );
  });
  return db;
}

async function withDb() {
  const d = getDb();
  await ready;
  return d;
}
const run = async (sql, params = []) => {
  const d = await withDb();
  return new Promise((resolve, reject) => d.run(sql, params, function (err) { err ? reject(err) : resolve(this); }));
};
const all = async (sql, params = []) => {
  const d = await withDb();
  return new Promise((resolve, reject) => d.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
};
const get = async (sql, params = []) => (await all(sql, params))[0] || null;

// Shape the requester and the owner see. The owner-only fields (who asked)
// are added by the routes, not here.
function toView(row, now = Date.now()) {
  let state;
  if (row.status === 'pending') state = 'pending';
  else if (row.status === 'declined') state = 'declined';
  else if (row.status === 'rejected') state = row.rmab_error === 'AlreadyAvailable' ? 'available' : 'failed';
  else state = rmab.describeStatus(row.rmab_status, row.created_at, now, row.search_attempts || 0);
  return {
    id: row.id,
    asin: row.asin,
    title: row.title,
    author: row.author,
    cover: row.cover,
    state,
    searchAttempts: row.search_attempts,
    // RMAB found releases but its fixed 50/100 quality cutoff rejected all of
    // them — a manual pick in RMAB's interactive search fixes these.
    needsPick: state === 'stuck' && /no quality matches/i.test(row.rmab_error || ''),
    edition: row.edition || 'produced',
    requestedAt: row.created_at
  };
}

async function sendToRmab(row) {
  // The edition choice has to reach the AudioBook Bay bridge before ReadMeABook searches,
  // which it does as soon as the request is created. A bridge hiccup never blocks the request.
  await abbBridge.setEdition(row.title, row.edition || 'produced')
    .catch(err => console.error('abb bridge edition error:', err.response?.status || err.message));
  const result = await rmab.createRequest(row);
  const now = Date.now();
  if (result.ok) {
    await run(`UPDATE book_requests SET status='sent', rmab_request_id=?, rmab_status=?, rmab_error=NULL, updated_at=? WHERE id=?`,
      [result.requestId, result.status, now, row.id]);
    return result;
  }
  if (result.reason === 'DuplicateRequest' || result.reason === 'BeingProcessed') {
    const existing = await rmab.findRequestByAsin(row.asin).catch(() => null);
    if (existing) {
      await run(`UPDATE book_requests SET status='sent', rmab_request_id=?, rmab_status=?, search_attempts=?, rmab_error=NULL, updated_at=? WHERE id=?`,
        [existing.id, existing.status, existing.searchAttempts, now, row.id]);
      return { ok: true, requestId: existing.id, status: existing.status, linked: true };
    }
  }
  await run(`UPDATE book_requests SET status='rejected', rmab_error=?, updated_at=? WHERE id=?`, [result.reason, now, row.id]);
  return result;
}

// Owner requests go straight to RMAB; family requests wait for the owner,
// who gets a push. A repeat request for a book this person already has open
// returns the existing row instead of a duplicate.
async function create(user, book) {
  const existing = await get(`SELECT * FROM book_requests WHERE user_id=? AND asin=? AND status IN ('pending','sent')`, [String(user.id), book.asin]);
  if (existing) {
    // An owner request still 'pending' means the earlier send to RMAB failed
    // (RMAB down, bad token) — tapping Request again retries it.
    if (user.isOwner && existing.status === 'pending') {
      await sendToRmab(existing);
      return toView(await get(`SELECT * FROM book_requests WHERE id=?`, [existing.id]));
    }
    return toView(existing);
  }
  const now = Date.now();
  const { lastID } = await run(
    `INSERT INTO book_requests (user_id, username, asin, title, author, narrator, description, cover, status, edition, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [String(user.id), user.username || '', book.asin, book.title, book.author || '', book.narrator || '', book.description || '',
      book.cover || '', 'pending', abbBridge.EDITIONS.includes(book.edition) ? book.edition : 'produced', now, now]
  );
  let row = await get(`SELECT * FROM book_requests WHERE id=?`, [lastID]);
  if (user.isOwner) {
    await sendToRmab(row);
    row = await get(`SELECT * FROM book_requests WHERE id=?`, [lastID]);
  } else {
    pushNotify.notifyOwners({ title: 'Book request', body: `${user.username || 'Someone'} requested ${book.title}`, url: '/admin' }).catch(() => {});
  }
  return toView(row);
}

async function listForUser(userId) {
  const rows = await all(`SELECT * FROM book_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 30`, [String(userId)]);
  return rows.map(r => toView(r));
}

async function listPending() {
  const rows = await all(`SELECT * FROM book_requests WHERE status='pending' ORDER BY created_at ASC`);
  return rows.map(r => ({ ...toView(r), requestedBy: r.username || 'Unknown' }));
}

// Asins this person has open, so search results can say "Requested" even
// before RMAB knows about a pending family request.
async function openAsinsForUser(userId) {
  const rows = await all(`SELECT asin FROM book_requests WHERE user_id=? AND status IN ('pending','sent')`, [String(userId)]);
  return new Set(rows.map(r => r.asin));
}

async function approve(id) {
  const row = await get(`SELECT * FROM book_requests WHERE id=? AND status='pending'`, [id]);
  if (!row) return null;
  const result = await sendToRmab(row);
  pushNotify.notifyUser(row.user_id, {
    title: result.ok ? 'Book request approved' : 'Book request',
    body: result.ok ? `${row.title} is being searched for now` : `${row.title}: ${result.reason === 'AlreadyAvailable' ? 'already in the library' : 'could not be requested'}`,
    url: '/'
  }).catch(() => {});
  return toView(await get(`SELECT * FROM book_requests WHERE id=?`, [id]));
}

async function decline(id) {
  const row = await get(`SELECT * FROM book_requests WHERE id=? AND status='pending'`, [id]);
  if (!row) return null;
  await run(`UPDATE book_requests SET status='declined', updated_at=? WHERE id=?`, [Date.now(), id]);
  pushNotify.notifyUser(row.user_id, { title: 'Book request', body: `${row.title} was declined`, url: '/' }).catch(() => {});
  return true;
}

// Mirrors RMAB's status onto every open sent request; tells the requester
// once when their book becomes available.
async function sync() {
  if (!rmab.isConfigured()) return;
  const rows = await all(`SELECT * FROM book_requests WHERE status='sent' AND notified=0 AND rmab_request_id IS NOT NULL`);
  if (!rows.length) return;
  const byId = new Map((await rmab.listRequests()).map(r => [r.id, r]));
  for (const row of rows) {
    try {
      const r = byId.get(row.rmab_request_id);
      if (!r) continue; // older than RMAB's newest 100, or deleted in RMAB
      await run(`UPDATE book_requests SET rmab_status=?, search_attempts=?, rmab_error=?, updated_at=? WHERE id=?`,
        [r.status, r.searchAttempts, r.error, Date.now(), row.id]);
      if (rmab.describeStatus(r.status) === 'available') {
        await run(`UPDATE book_requests SET notified=1 WHERE id=?`, [row.id]);
        pushNotify.notifyUser(row.user_id, { title: 'Your book is ready', body: `${row.title} is in Audiobookshelf`, url: '/' }).catch(() => {});
      }
    } catch (err) {
      console.error('book request sync error:', row.id, err.response?.status || err.message);
    }
  }
}

function start() {
  const tick = () => sync().catch(err => console.error('book request sync failed:', err.message));
  tick();
  setInterval(tick, SYNC_MS);
}

function _resetForTests() { db = null; ready = null; }

module.exports = { create, listForUser, listPending, openAsinsForUser, approve, decline, sync, start, toView, _resetForTests };
