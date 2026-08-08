const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shouldRemind, monthKeyOf } = require('../lib/recapReminder');

test('monthKeyOf extracts YYYY-MM from a period', () => {
  assert.equal(monthKeyOf({ startIso: '2026-07-01' }), '2026-07');
});

test('shouldRemind is true within the grace window for a month not yet reminded', () => {
  assert.equal(shouldRemind(new Date('2026-08-02T00:00:00Z'), null, '2026-07'), true);
  assert.equal(shouldRemind(new Date('2026-08-02T00:00:00Z'), '2026-06', '2026-07'), true);
});

test('shouldRemind is false once already reminded for that target month', () => {
  assert.equal(shouldRemind(new Date('2026-08-02T00:00:00Z'), '2026-07', '2026-07'), false);
});

test('shouldRemind is false outside the grace window, even if never reminded', () => {
  assert.equal(shouldRemind(new Date('2026-08-15T00:00:00Z'), null, '2026-07'), false);
});
