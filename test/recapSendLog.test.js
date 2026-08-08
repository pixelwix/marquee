const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marquee-recap-send-'));
process.env.SESSION_DB_DIR = dbDir;
const sendLog = require('../lib/recapSendLog');

test('first claim succeeds and blocks a concurrent duplicate', async () => {
  const first = await sendLog.claim({ periodKey: '2026-07', userId: 'u1', recipientName: 'One', requestedBy: 'owner', now: 100 });
  assert.equal(first.claimed, true);
  const duplicate = await sendLog.claim({ periodKey: '2026-07', userId: 'u1', recipientName: 'One', requestedBy: 'owner', now: 101 });
  assert.deepEqual({ claimed: duplicate.claimed, reason: duplicate.reason }, { claimed: false, reason: 'send already in progress' });
});

test('completed send is blocked unless resend is explicit', async () => {
  const claim = await sendLog.claim({ periodKey: '2026-07', userId: 'u2', recipientName: 'Two', requestedBy: 'owner', now: 200 });
  await sendLog.finish(claim.attemptId, { ok: true, now: 210 });
  const blocked = await sendLog.claim({ periodKey: '2026-07', userId: 'u2', recipientName: 'Two', requestedBy: 'owner', now: 220 });
  assert.equal(blocked.reason, 'already sent');
  const resend = await sendLog.claim({ periodKey: '2026-07', userId: 'u2', recipientName: 'Two', requestedBy: 'owner', resend: true, now: 230 });
  assert.equal(resend.claimed, true);
  await sendLog.finish(resend.attemptId, { ok: true, now: 240 });
  const rows = await sendLog.history();
  assert.equal(rows.filter((row) => row.userId === 'u2').length, 2);
  assert.equal(Boolean(rows[0].isResend), true);
});

test('failed send can be retried without resend override', async () => {
  const claim = await sendLog.claim({ periodKey: '2026-07', userId: 'u3', recipientName: 'Three', requestedBy: 'owner', now: 300 });
  await sendLog.finish(claim.attemptId, { ok: false, error: 'SMTP unavailable', now: 310 });
  const retry = await sendLog.claim({ periodKey: '2026-07', userId: 'u3', recipientName: 'Three', requestedBy: 'owner', now: 320 });
  assert.equal(retry.claimed, true);
});

test('an abandoned sending claim becomes retryable after the stale window', async () => {
  await sendLog.claim({ periodKey: '2026-07', userId: 'u4', recipientName: 'Four', requestedBy: 'owner', now: 400 });
  const retry = await sendLog.claim({ periodKey: '2026-07', userId: 'u4', recipientName: 'Four', requestedBy: 'owner',
    now: 400 + sendLog.STALE_CLAIM_MS + 1 });
  assert.equal(retry.claimed, true);
});
