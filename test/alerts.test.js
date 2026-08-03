const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planReconciliation } = require('../lib/alerts');

const NOW = 5000;

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
