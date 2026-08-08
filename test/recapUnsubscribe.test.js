const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-for-recap-unsubscribe';
const { sign, verify, buildUnsubscribeUrl } = require('../lib/recapUnsubscribe');

test('verify accepts a token this app actually signed for that user', () => {
  const token = sign('44751');
  assert.equal(verify('44751', token), true);
});

test('verify rejects a token signed for a different user', () => {
  const token = sign('44751');
  assert.equal(verify('99999', token), false);
});

test('verify rejects a tampered/garbage token', () => {
  assert.equal(verify('44751', 'not-a-real-token'), false);
});

test('verify rejects a missing token', () => {
  assert.equal(verify('44751', undefined), false);
});

test('buildUnsubscribeUrl embeds a user id and a token that verifies for that user', () => {
  const url = buildUnsubscribeUrl('44751', 'https://media.example.com');
  const parsed = new URL(url);
  assert.equal(parsed.pathname, '/api/recap/unsubscribe');
  const user = parsed.searchParams.get('user');
  const token = parsed.searchParams.get('token');
  assert.equal(user, '44751');
  assert.equal(verify(user, token), true);
});
