const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marquee-audit-'));
process.env.SESSION_DB_DIR = dbDir;
const auditLog = require('../lib/auditLog');

test('maskIp retains a useful network prefix without storing a full address', () => {
  assert.equal(auditLog.maskIp('203.0.113.42'), '203.0.113.0/24');
  assert.equal(auditLog.maskIp('::ffff:192.0.2.9'), '192.0.2.0/24');
  assert.equal(auditLog.maskIp('2001:db8:1234:5678:abcd::1'), '2001:db8:1234:5678::/64');
  assert.equal(auditLog.maskIp('not-an-ip'), null);
});

test('maskIp expands "::" compression before masking, not just splits on ":"', () => {
  // These previously produced malformed output like "fe80::1::/64" (a
  // double-colon, invalid CIDR string) and — worse — didn't actually mask
  // the address at all, since a naive split(':').slice(0,4) on a string
  // compressed *within* its first 4 groups just echoes those groups back
  // verbatim. The existing test above compresses only *after* the 4th
  // group ("...5678:abcd::1"), which never exercises this path.
  assert.equal(auditLog.maskIp('fe80::1'), 'fe80:0:0:0::/64');
  assert.equal(auditLog.maskIp('::1'), '0:0:0:0::/64');
  assert.equal(auditLog.maskIp('2001:db8::1:2:3:4'), '2001:db8:0:0::/64');
});

test('record persists normalized audit fields and structured detail', async () => {
  await auditLog.record({ kind: 'admin', action: 'POST /api/test', actorId: 7,
    actorName: 'owner', success: false, statusCode: 409, ip: '203.0.113.42',
    userAgent: 'test-agent', detail: { target: 'example' }, at: 1234 });
  const rows = await auditLog.recent();
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    id: 1, kind: 'admin', action: 'POST /api/test', actorId: '7', actorName: 'owner',
    success: false, statusCode: 409, ipPrefix: '203.0.113.0/24', userAgent: 'test-agent',
    detail: { target: 'example' }, at: 1234,
  });
});
