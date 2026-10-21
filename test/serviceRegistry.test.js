const test = require('node:test');
const assert = require('node:assert/strict');
const { SERVICES } = require('../lib/serviceRegistry');
const { isSecretKey } = require('../lib/envFile');
const { checkAudiobooks, CHECKS } = require('../lib/serviceHealth');

test('serviceRegistry includes audiobooks service with all integration fields', () => {
  const service = SERVICES.find(s => s.key === 'audiobooks');
  assert.ok(service, 'audiobooks service should be registered');
  assert.equal(service.label, 'Audiobooks');

  const expectedKeys = [
    'ABS_URL', 'ABS_API_KEY', 'ABS_LIBRARY_ID', 'ABS_PUBLIC_URL',
    'RMAB_URL', 'RMAB_API_TOKEN',
    'ABB_BRIDGE_URL', 'ABB_BRIDGE_TOKEN'
  ];
  const keys = service.fields.map(f => f.key);
  assert.deepEqual(keys, expectedKeys);
});

test('audiobook API keys and tokens are detected as secret keys', () => {
  assert.equal(isSecretKey('ABS_API_KEY'), true);
  assert.equal(isSecretKey('RMAB_API_TOKEN'), true);
  assert.equal(isSecretKey('ABB_BRIDGE_TOKEN'), true);
  assert.equal(isSecretKey('ABS_URL'), false);
  assert.equal(isSecretKey('ABS_LIBRARY_ID'), false);
  assert.equal(isSecretKey('ABS_PUBLIC_URL'), false);
  assert.equal(isSecretKey('RMAB_URL'), false);
  assert.equal(isSecretKey('ABB_BRIDGE_URL'), false);
});

test('serviceHealth checks registry contains audiobooks check', () => {
  assert.equal(typeof CHECKS.audiobooks, 'function');
});

test('checkAudiobooks returns unconfigured when no audiobook URLs are set', async () => {
  const envBackup = {
    ABS_URL: process.env.ABS_URL,
    RMAB_URL: process.env.RMAB_URL,
    ABB_BRIDGE_URL: process.env.ABB_BRIDGE_URL
  };
  delete process.env.ABS_URL;
  delete process.env.RMAB_URL;
  delete process.env.ABB_BRIDGE_URL;

  try {
    const res = await checkAudiobooks();
    assert.deepEqual(res, { status: 'unconfigured' });
  } finally {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v !== undefined) process.env[k] = v;
    }
  }
});

test('checkAudiobooks reports error if URL is set but credentials are missing', async () => {
  const envBackup = {
    ABS_URL: process.env.ABS_URL,
    ABS_API_KEY: process.env.ABS_API_KEY,
    ABS_LIBRARY_ID: process.env.ABS_LIBRARY_ID,
    RMAB_URL: process.env.RMAB_URL,
    ABB_BRIDGE_URL: process.env.ABB_BRIDGE_URL
  };
  process.env.ABS_URL = 'http://abs.local';
  delete process.env.ABS_API_KEY;
  delete process.env.ABS_LIBRARY_ID;
  delete process.env.RMAB_URL;
  delete process.env.ABB_BRIDGE_URL;

  try {
    const res = await checkAudiobooks();
    assert.equal(res.status, 'error');
    assert.match(res.message, /Audiobookshelf: API key and Library ID required/);
  } finally {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
  }
});
