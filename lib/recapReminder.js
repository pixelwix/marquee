const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const pushNotify = require('./pushNotify');
const { previousMonthRange, listRecapCandidates } = require('./monthlyRecap');

// Reminds the owner (push notification, same channel as lib/issueWatchdog.js)
// to go review and send last month's recap from the admin Newsletter tab —
// this app has no auto-send (see routes/recap.js: no "send to everyone"
// endpoint exists on purpose), so without this, sending it is easy to
// forget entirely. Same in-process setInterval scheduler shape as
// lib/issueWatchdog.js/lib/nowPlaying.js, not a system cron — this app has
// no external scheduler to hook into.
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // checked a few times a day — this only ever needs to fire once a month, no need for finer precision
// A grace window, not exactly the 1st — if the app or its host happens to
// be down right at the month boundary, this still catches up within a few
// days instead of silently missing the reminder for the whole month.
const REMIND_WITHIN_DAYS = 3;

// Own dedicated sqlite file, same singleton-row pattern as lib/notice.js,
// but with the `ready` promise lib/recapUnsubscribes.js's module comment
// explains — a lazily-opened Database's first query can race its own
// CREATE TABLE on a truly fresh file otherwise (confirmed live, elsewhere
// in this same feature).
let db = null;
let ready = null;
function getDb() {
  if (db) return db;
  const dbDir = process.env.SESSION_DB_DIR || '/app/data';
  fs.mkdirSync(dbDir, { recursive: true });
  db = new sqlite3.Database(path.join(dbDir, 'recap-reminder.sqlite'));
  ready = new Promise((resolve, reject) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS recap_reminder_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_reminded_month TEXT
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

function getLastRemindedMonth() {
  return withDb().then((conn) => new Promise((resolve, reject) => {
    conn.get('SELECT last_reminded_month AS m FROM recap_reminder_state WHERE id = 1', (err, row) => (err ? reject(err) : resolve(row?.m || null)));
  }));
}

function setLastRemindedMonth(monthKey) {
  return withDb().then((conn) => new Promise((resolve, reject) => {
    conn.run(
      `INSERT INTO recap_reminder_state (id, last_reminded_month) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET last_reminded_month = excluded.last_reminded_month`,
      [monthKey],
      (err) => (err ? reject(err) : resolve())
    );
  }));
}

// Pure — testable without touching sqlite or push. Identifies the month
// whose recap is now actually ready to send (previousMonthRange's target
// month), not the current calendar month — those only differ during
// REMIND_WITHIN_DAYS, which is exactly the window this needs.
function monthKeyOf(period) {
  return period.startIso.slice(0, 7); // "YYYY-MM"
}

function shouldRemind(now, lastRemindedMonth, targetMonthKey) {
  return now.getUTCDate() <= REMIND_WITHIN_DAYS && lastRemindedMonth !== targetMonthKey;
}

async function check() {
  try {
    const period = previousMonthRange();
    const targetMonthKey = monthKeyOf(period);
    const lastRemindedMonth = await getLastRemindedMonth();
    if (!shouldRemind(new Date(), lastRemindedMonth, targetMonthKey)) return;

    const candidates = await listRecapCandidates(period);
    await pushNotify.notifyOwners({
      title: 'Monthly recap ready to send',
      body: `${candidates.length} ${candidates.length === 1 ? 'person is' : 'people are'} eligible for ${period.label}'s recap. Review and send from Settings → Newsletter.`,
      url: '/admin',
    });
    await setLastRemindedMonth(targetMonthKey);
    console.log(`[recapReminder] reminded owner for ${period.label} (${candidates.length} eligible)`);
  } catch (err) {
    console.error('[recapReminder] check failed:', err.message);
  }
}

function start() {
  check();
  setInterval(check, CHECK_INTERVAL_MS);
}

module.exports = { start, shouldRemind, monthKeyOf };
