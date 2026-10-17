const { test } = require('node:test');
const assert = require('node:assert/strict');
const { describeSchedule, ID_RE, configured } = require('../lib/scriptsAgent');

test('describes the schedule shapes used on arr-stack', () => {
  assert.equal(describeSchedule('* * * * *'), 'Every minute');
  assert.equal(describeSchedule('*/15 * * * *'), 'Every 15 minutes');
  assert.equal(describeSchedule('43 * * * *'), 'Hourly at :43');
  assert.equal(describeSchedule('7,22,37,52 * * * *'), 'Hourly at :07, :22, :37, :52');
  assert.equal(describeSchedule('0 6 * * *'), 'Daily at 6:00 AM');
  assert.equal(describeSchedule('30 18 * * *'), 'Daily at 6:30 PM');
  assert.equal(describeSchedule('0 0 * * *'), 'Daily at 12:00 AM');
  assert.equal(describeSchedule('30 4 * * 0'), 'Weekly on Sunday at 4:30 AM');
  assert.equal(describeSchedule('0 2 */3 * *'), '0 2 */3 * *'); // unusual shape falls back to the raw expression
});

test('only 10-hex-character job ids pass validation', () => {
  assert.ok(ID_RE.test('a1b2c3d4e5'));
  assert.ok(!ID_RE.test('../etc/passwd'));
  assert.ok(!ID_RE.test('A1B2C3D4E5'));
  assert.ok(!ID_RE.test('a1b2c3d4e5f'));
});

test('reports unconfigured when the env vars are missing', () => {
  const saved = { url: process.env.SCRIPTS_AGENT_URL, token: process.env.SCRIPTS_AGENT_TOKEN };
  delete process.env.SCRIPTS_AGENT_URL; delete process.env.SCRIPTS_AGENT_TOKEN;
  assert.equal(configured(), false);
  if (saved.url !== undefined) process.env.SCRIPTS_AGENT_URL = saved.url;
  if (saved.token !== undefined) process.env.SCRIPTS_AGENT_TOKEN = saved.token;
});
