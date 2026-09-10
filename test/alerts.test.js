const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { planReconciliation, planPush, listOpen } = require('../lib/alerts');

const NOW = 5000;

// getDb() is lazy — SESSION_DB_DIR only needs to be set before the first real
// query, not before require(). Points this test's first query at a genuinely
// fresh directory (never-before-created alerts.sqlite) so it actually
// exercises the CREATE TABLE / first-query race, not a warm connection some
// earlier test already initialized.
test('listOpen on a truly cold, never-before-opened db does not race the CREATE TABLE', async () => {
  process.env.SESSION_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'marquee-alerts-cold-'));
  const rows = await listOpen();
  assert.deepEqual(rows, []);
});

function alert(overrides) {
  return { key: 'sonarr:health:x:warning', app: 'sonarr', source: 'health', severity: 'warning', title: 'x', ...overrides };
}

test('new alert with no existing row is inserted', () => {
  const plan = planReconciliation([], ['sonarr:health'], [alert()], NOW);
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.reopens.length, 0);
  assert.equal(plan.touches.length, 0);
  assert.equal(plan.resolves.length, 0);
  assert.equal(plan.inserts[0].firstSeenAt, NOW);
});

test('still-open alert is touched, not re-inserted', () => {
  const existing = { key: 'sonarr:health:x:warning', app: 'sonarr', source: 'health', severity: 'warning', status: 'open' };
  const plan = planReconciliation([existing], ['sonarr:health'], [alert()], NOW);
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.touches.length, 1);
  assert.equal(plan.touches[0].lastSeenAt, NOW);
  assert.equal(plan.touches[0].clearAcknowledged, false);
});

test('resolved alert reoccurring is reopened, not touched', () => {
  const existing = { key: 'sonarr:health:x:warning', app: 'sonarr', source: 'health', severity: 'warning', status: 'resolved' };
  const plan = planReconciliation([existing], ['sonarr:health'], [alert()], NOW);
  assert.equal(plan.reopens.length, 1);
  assert.equal(plan.touches.length, 0);
  assert.equal(plan.reopens[0].firstSeenAt, NOW);
});

test('open row whose scope ran but was not reported gets auto-resolved', () => {
  const existing = { key: 'sonarr:health:x:warning', app: 'sonarr', source: 'health', severity: 'warning', status: 'open' };
  const plan = planReconciliation([existing], ['sonarr:health'], [], NOW);
  assert.deepEqual(plan.resolves, ['sonarr:health:x:warning']);
});

test('open row is left alone when its scope did not run this batch (partial failure safety)', () => {
  const existing = { key: 'sonarr:log-triage', app: 'sonarr', source: 'log-triage', severity: 'warning', status: 'open' };
  // sonarr:log-triage scope omitted — e.g. sonarr was unreachable this run
  const plan = planReconciliation([existing], ['sonarr:health'], [], NOW);
  assert.deepEqual(plan.resolves, []);
});

test('escalating severity on a still-open alert clears acknowledgement', () => {
  const existing = { key: 'sonarr:log-triage', app: 'sonarr', source: 'log-triage', severity: 'warning', status: 'open' };
  const plan = planReconciliation([existing], ['sonarr:log-triage'], [alert({ key: 'sonarr:log-triage', source: 'log-triage', severity: 'error' })], NOW);
  assert.equal(plan.touches.length, 1);
  assert.equal(plan.touches[0].clearAcknowledged, true);
});

test('same-or-lower severity on a still-open alert does not clear acknowledgement', () => {
  const existing = { key: 'sonarr:log-triage', app: 'sonarr', source: 'log-triage', severity: 'error', status: 'open' };
  const plan = planReconciliation([existing], ['sonarr:log-triage'], [alert({ key: 'sonarr:log-triage', source: 'log-triage', severity: 'warning' })], NOW);
  assert.equal(plan.touches[0].clearAcknowledged, false);
});

test('duplicate keys within one batch: last one wins', () => {
  const plan = planReconciliation(
    [],
    ['sonarr:health'],
    [alert({ title: 'first' }), alert({ title: 'second' })],
    NOW
  );
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.inserts[0].title, 'second');
});

// --- planPush: per-source push policy (v1.58.1) ---

const IMPORT_GRACE_MS = 10 * 60 * 1000;
const emptyPlan = { inserts: [], reopens: [], touches: [] };

test('a normal source (health) pushes as soon as it is inserted', () => {
  const toPush = planPush({ ...emptyPlan, inserts: [alert()] }, new Map(), NOW);
  assert.equal(toPush.length, 1);
});

test('a normal source pushes on reopen too', () => {
  const toPush = planPush({ ...emptyPlan, reopens: [alert()] }, new Map(), NOW);
  assert.equal(toPush.length, 1);
});

test('silent sources (downloads attention, wanted) are never pushed, even when new', () => {
  const toPush = planPush({
    ...emptyPlan,
    inserts: [
      alert({ key: 'downloads:attention:torrent-1', source: 'attention' }),
      alert({ key: 'sonarr:wanted:e1', source: 'wanted' }),
    ],
  }, new Map(), NOW);
  assert.deepEqual(toPush, []);
});

test('an import alert does not push on first sight', () => {
  const toPush = planPush({
    ...emptyPlan,
    inserts: [alert({ key: 'sonarr:import:1', source: 'import' })],
  }, new Map(), NOW);
  assert.deepEqual(toPush, []);
});

test('an import alert still inside the grace window does not push on a touch', () => {
  const row = { key: 'sonarr:import:1', first_seen_at: NOW - 60_000, pushed_at: null };
  const toPush = planPush({
    ...emptyPlan,
    touches: [alert({ key: 'sonarr:import:1', source: 'import' })],
  }, new Map([[row.key, row]]), NOW);
  assert.deepEqual(toPush, []);
});

test('an import alert pushes once it has stayed open past the grace window', () => {
  const row = { key: 'sonarr:import:1', first_seen_at: NOW - IMPORT_GRACE_MS - 1, pushed_at: null };
  const toPush = planPush({
    ...emptyPlan,
    touches: [alert({ key: 'sonarr:import:1', source: 'import' })],
  }, new Map([[row.key, row]]), NOW);
  assert.equal(toPush.length, 1);
  assert.equal(toPush[0].key, 'sonarr:import:1');
});

test('an import alert that already pushed once does not push again on later touches', () => {
  const row = { key: 'sonarr:import:1', first_seen_at: NOW - IMPORT_GRACE_MS * 5, pushed_at: NOW - IMPORT_GRACE_MS };
  const toPush = planPush({
    ...emptyPlan,
    touches: [alert({ key: 'sonarr:import:1', source: 'import' })],
  }, new Map([[row.key, row]]), NOW);
  assert.deepEqual(toPush, []);
});
