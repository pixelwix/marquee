const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const pushNotify = require('./pushNotify');

// Open problems reported by the arr-stack health watchdog (see
// /mnt/docker/scripts/arr-health-watchdog.mjs on docker-host), reconciled against
// what's currently open on every ingest. The watchdog itself carries no notion of
// "already alerted" — this table is the single source of truth for open/resolved
// state, so a fresh/stateless watchdog run always reconciles correctly. Separate db
// file from sessions/notice, same lazy-open pattern as lib/notice.js.
// `ready` is awaited by run()/all() below before touching the connection —
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
  db = new sqlite3.Database(path.join(dbDir, 'alerts.sqlite'));
  ready = new Promise((resolve, reject) => {
    db.run(`CREATE TABLE IF NOT EXISTS alerts (
      key TEXT PRIMARY KEY,
      app TEXT NOT NULL,
      source TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      wiki_url TEXT,
      action_data TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      resolved_at INTEGER,
      acknowledged_at INTEGER,
      pushed_at INTEGER,
      updated_at INTEGER NOT NULL
    )`, (err) => {
      if (err) return reject(err);
      // Added 2026-08-21 for the qbit-remove-torrents auto-fix action; pushed_at
      // added 2026-09-09 for the persist-gated push policy (see planPush).
      // CREATE TABLE IF NOT EXISTS above only covers a brand-new db file — an
      // already-migrated install needs each column added by hand. SQLite has no
      // "ADD COLUMN IF NOT EXISTS", so the duplicate-column error on a db that
      // already has it is expected and ignored rather than checked up front.
      db.run(`ALTER TABLE alerts ADD COLUMN action_data TEXT`, (alterErr) => {
        if (alterErr && !/duplicate column/i.test(alterErr.message)) return reject(alterErr);
        db.run(`ALTER TABLE alerts ADD COLUMN pushed_at INTEGER`, (alterErr2) => {
          if (alterErr2 && !/duplicate column/i.test(alterErr2.message)) return reject(alterErr2);
          resolve();
        });
      });
    });
  });
  return db;
}

async function run(sql, params = []) {
  const conn = getDb();
  await ready;
  return new Promise((resolve, reject) => {
    conn.run(sql, params, function (err) { err ? reject(err) : resolve(this); });
  });
}

async function all(sql, params = []) {
  const conn = getDb();
  await ready;
  return new Promise((resolve, reject) => {
    conn.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}

const SEVERITY_RANK = { notice: 0, warning: 1, error: 2 };

// Pure — testable without touching the DB, same split as notice.js's computeStatus.
// allRows: every row currently in the table (open AND resolved — a resolved row can
// still match an incoming key and needs to be reopened, not re-inserted).
// scopes/alerts: this run's payload from the watchdog.
function planReconciliation(allRows, scopes, incomingAlerts, now) {
  const rowsByKey = new Map(allRows.map((r) => [r.key, r]));
  const incomingByKey = new Map();
  for (const a of incomingAlerts) incomingByKey.set(a.key, a); // later entries win on duplicate keys within a batch

  const inserts = [];
  const reopens = [];
  const touches = [];

  for (const a of incomingByKey.values()) {
    const existing = rowsByKey.get(a.key);
    if (!existing) {
      inserts.push({ ...a, firstSeenAt: now, lastSeenAt: now });
    } else if (existing.status === 'resolved') {
      reopens.push({ ...a, firstSeenAt: now, lastSeenAt: now });
    } else {
      // Still open — touch last_seen + refresh content; escalate severity (and
      // un-acknowledge) if this occurrence is worse than what's on file, so a
      // worsening problem resurfaces even if the owner already dismissed the
      // milder version. Matters mainly for log-triage alerts, whose key stays
      // constant across occurrences (unlike per-source health alert keys).
      const escalated = (SEVERITY_RANK[a.severity] ?? 0) > (SEVERITY_RANK[existing.severity] ?? 0);
      touches.push({ ...a, lastSeenAt: now, clearAcknowledged: escalated });
    }
  }

  // Auto-resolve: an open row whose scope genuinely ran this batch but whose key
  // wasn't reported is exactly a cleared problem — but only when the scope actually
  // ran (an unreachable-app or LLM-failure run omits the scope entirely, so it can
  // never wrongly auto-resolve a real open alert it simply couldn't re-check).
  const scopeSet = new Set(scopes);
  const resolves = allRows
    .filter((r) => r.status === 'open' && scopeSet.has(`${r.app}:${r.source}`) && !incomingByKey.has(r.key))
    .map((r) => r.key);

  return { inserts, reopens, touches, resolves };
}

// Per-source push policy. Reconciliation (open/resolved state, the /admin
// Alerts panel, auto-resolve) is unaffected by any of this — it only governs
// whether a *push notification* fires.
//   - not listed     -> push as soon as it's new/reopened, as before (health,
//                       log-triage, proxmox cluster, disk-guard, error-torrents,
//                       overseerr issues, uptime-kuma, sabnzbd cleanup)
//   - 'silent'       -> reconciled + shown in /admin, never pushed. downloads
//                       "attention" and Wanted/Missing are ongoing *status*, not
//                       incidents — a torrent parked for 20 min or an episode the
//                       internet doesn't have yet shouldn't page. Owner asked for
//                       this 2026-09-09; genuinely broken downloads are still
//                       caught by qbit-error-torrents / qbit-disk-guard, which
//                       are not silenced.
//   - {persistMs}    -> push only once the same item has stayed open at least
//                       that long. *:import — a lot of stuck imports clear on
//                       their own within a poll or two (competing grabs, a file
//                       mid-copy); this keeps the ones that genuinely wedge
//                       without paging over every transient race.
const PUSH_POLICY = {
  attention: 'silent',
  wanted: 'silent',
  import: { persistMs: 10 * 60 * 1000 },
};

// Pure — decides which of this run's insert/reopen/touch items warrant a push,
// given the pre-update rows (needed for first_seen_at / pushed_at on the
// persist-gated sources). Whatever it returns is exactly what pushNotify fires
// for, and what reconcile() then stamps pushed_at on so it can't re-fire.
function planPush({ inserts, reopens, touches }, rowsByKey, now) {
  const out = [];
  for (const a of [...inserts, ...reopens]) {
    const policy = PUSH_POLICY[a.source];
    if (policy === 'silent') continue;
    if (policy && policy.persistMs) continue; // gated sources never push on first sight
    out.push(a);
  }
  for (const a of touches) {
    const policy = PUSH_POLICY[a.source];
    if (!policy || !policy.persistMs) continue;
    const row = rowsByKey.get(a.key);
    if (row && row.pushed_at == null && (now - row.first_seen_at) >= policy.persistMs) out.push(a);
  }
  return out;
}

// Prettier label for the single-item push body — falls back to the raw source
// name for anything not mapped (webhook-fed sources like uptime-kuma monitors).
const SOURCE_LABEL = {
  'log-triage': 'Log triage',
  health: 'Health check',
  import: 'Stuck import',
  'error-torrents': 'Torrent errors',
  'disk-guard': 'Disk space',
  cluster: 'Proxmox cluster',
  issue: 'Overseerr issue',
  'completed-cleanup': 'Cleanup',
};

async function reconcile({ scopes, alerts }) {
  const now = Date.now();
  const allRows = await all('SELECT * FROM alerts');
  const rowsByKey = new Map(allRows.map((r) => [r.key, r]));
  const plan = planReconciliation(allRows, scopes, alerts, now);

  for (const a of plan.inserts) {
    await run(
      `INSERT INTO alerts (key, app, source, severity, title, detail, wiki_url, action_data, status, first_seen_at, last_seen_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
      [a.key, a.app, a.source, a.severity, a.title, a.detail ?? null, a.wikiUrl ?? null, a.actionData ? JSON.stringify(a.actionData) : null, a.firstSeenAt, a.lastSeenAt, now]
    );
  }
  for (const a of plan.reopens) {
    // pushed_at cleared on reopen so a persist-gated source has to re-qualify
    // (stay open past its window again) before it re-pushes — a non-gated
    // source gets re-stamped a moment later in the push block below anyway.
    await run(
      `UPDATE alerts SET app=?, source=?, severity=?, title=?, detail=?, wiki_url=?, action_data=?, status='open',
         first_seen_at=?, last_seen_at=?, resolved_at=NULL, acknowledged_at=NULL, pushed_at=NULL, updated_at=?
       WHERE key=?`,
      [a.app, a.source, a.severity, a.title, a.detail ?? null, a.wikiUrl ?? null, a.actionData ? JSON.stringify(a.actionData) : null, a.firstSeenAt, a.lastSeenAt, now, a.key]
    );
  }
  for (const a of plan.touches) {
    await run(
      `UPDATE alerts SET severity=?, title=?, detail=?, wiki_url=?, action_data=?, last_seen_at=?, updated_at=?
         ${a.clearAcknowledged ? ', acknowledged_at=NULL' : ''}
       WHERE key=?`,
      [a.severity, a.title, a.detail ?? null, a.wikiUrl ?? null, a.actionData ? JSON.stringify(a.actionData) : null, a.lastSeenAt, now, a.key]
    );
  }
  if (plan.resolves.length) {
    const placeholders = plan.resolves.map(() => '?').join(',');
    await run(
      `UPDATE alerts SET status='resolved', resolved_at=?, updated_at=? WHERE key IN (${placeholders})`,
      [now, now, ...plan.resolves]
    );
  }

  // Housekeeping — cheap, done inline rather than as a separate job.
  await run(`DELETE FROM alerts WHERE status='resolved' AND resolved_at < ?`, [now - 30 * 86400 * 1000]);

  // Push only for genuinely new, push-worthy information — see planPush /
  // PUSH_POLICY. Never for a still-open alert simply still being open on this
  // cycle (that nagging is what made the previous, unscoped version go unused
  // before its v1.5.0 removal); never for the silent sources; and for the
  // persist-gated ones, only once they've stayed open past their window. One
  // batched notification per ingest, not one per alert, so N things breaking
  // at once is a single ping, not a burst.
  const toPush = planPush(plan, rowsByKey, now);
  if (toPush.length) {
    const title = toPush.length === 1 ? toPush[0].title : `${toPush.length} new stack alerts`;
    const body = toPush.length === 1
      ? `${toPush[0].app} · ${SOURCE_LABEL[toPush[0].source] || toPush[0].source}`
      : toPush.slice(0, 3).map((a) => a.title).join('; ') + (toPush.length > 3 ? '…' : '');
    try {
      await pushNotify.notifyOwners({ title, body, url: '/admin' });
    } catch (err) {
      console.error('alerts push notify error', err.message);
    }
    // Stamp pushed_at so a persist-gated alert doesn't re-push on its next
    // touch, and so this run's push can't repeat if reconcile somehow runs
    // twice for the same batch.
    const keys = toPush.map((a) => a.key);
    await run(
      `UPDATE alerts SET pushed_at=?, updated_at=? WHERE key IN (${keys.map(() => '?').join(',')})`,
      [now, now, ...keys]
    );
  }

  const openCount = await all(`SELECT COUNT(*) AS n FROM alerts WHERE status='open'`);
  return { open: openCount[0]?.n ?? 0 };
}

function listOpen() {
  return all(
    `SELECT key, app, source, severity, title, detail, wiki_url AS wikiUrl, action_data AS actionData,
            first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt
     FROM alerts WHERE status='open' AND acknowledged_at IS NULL`
  ).then((rows) => rows
    .map((r) => ({ ...r, actionData: r.actionData ? JSON.parse(r.actionData) : null }))
    .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) || b.lastSeenAt - a.lastSeenAt));
}

async function acknowledge(key) {
  const result = await run(`UPDATE alerts SET acknowledged_at=?, updated_at=? WHERE key=? AND status='open'`, [Date.now(), Date.now(), key]);
  return result.changes > 0;
}

// Bulk version of acknowledge() for the admin panel's "Dismiss All" — same
// soft-dismiss semantics (acknowledged, not deleted), so a dismissed alert
// still reappears on its own if reconcile() later sees it escalate or get
// reopened after resolving. Scoped to status='open' the same way listOpen()
// reads it, so this only ever touches what's actually showing right now.
async function acknowledgeAll() {
  const result = await run(`UPDATE alerts SET acknowledged_at=?, updated_at=? WHERE status='open' AND acknowledged_at IS NULL`, [Date.now(), Date.now()]);
  return result.changes;
}

// Used by routes/alerts.js's suggest-fix endpoint to pull the context (title/
// detail) a CLIProxyAPI prompt is built from. Any status, not just open — no
// reason to block a suggestion just because the alert got touched/resolved a
// moment before the request landed.
function getByKey(key) {
  return new Promise((resolve, reject) => {
    getDb().get(
      `SELECT key, app, source, severity, title, detail, action_data AS actionData FROM alerts WHERE key = ?`,
      [key], (err, row) => {
        if (err) return reject(err);
        resolve(row ? { ...row, actionData: row.actionData ? JSON.parse(row.actionData) : null } : null);
      }
    );
  });
}

module.exports = { reconcile, listOpen, acknowledge, acknowledgeAll, getByKey, planReconciliation, planPush };
