const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-session-secret-for-encryption-tests';
const { encrypt, decrypt } = require('../lib/sessionEncryption');

test('decrypt(encrypt(x)) round-trips to the original value', () => {
  const original = 'real-plex-token-abc123XYZ';
  assert.equal(decrypt(encrypt(original)), original);
});

test('encrypted output does not contain the plaintext', () => {
  const original = 'real-plex-token-abc123XYZ';
  assert.equal(encrypt(original).includes(original), false);
});

test('encrypting the same value twice produces different ciphertext (random IV)', () => {
  const original = 'same-token-every-time';
  assert.notEqual(encrypt(original), encrypt(original));
});

test('decrypt passes through a value with no enc:v1: prefix unchanged (pre-fix plaintext sessions)', () => {
  assert.equal(decrypt('old-plaintext-token-never-encrypted'), 'old-plaintext-token-never-encrypted');
});

test('decrypt passes through tampered ciphertext unchanged rather than throwing', () => {
  const tampered = encrypt('some-token').slice(0, -4) + 'AAAA';
  assert.doesNotThrow(() => decrypt(tampered));
  assert.equal(decrypt(tampered), tampered);
});
