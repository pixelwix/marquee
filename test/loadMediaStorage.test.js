const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadMediaStorage, FALLBACK } = require('../lib/loadMediaStorage');

// A clean GitHub checkout has no lib/mediaStorage.js; v1.78.1's first Git-stack deploy crashed on
// start because lib/serviceHealth.js required it directly.
test('missing everywhere: falls back to no NAS volumes instead of throwing', async () => {
  const missing = path.join(os.tmpdir(), 'marquee-no-such-mediaStorage');
  const loaded = loadMediaStorage([missing, undefined, '']);
  assert.strictEqual(loaded, FALLBACK);
  assert.deepStrictEqual(await loaded.getVolumes(), []);
});

test('uses the first candidate that exists (e.g. MEDIA_STORAGE_MODULE in data/)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marquee-ms-'));
  const file = path.join(dir, 'mediaStorage.js');
  fs.writeFileSync(file, "module.exports = { getVolumes: async () => [{ label: 'vol1' }] };");
  const loaded = loadMediaStorage([path.join(dir, 'absent'), file]);
  assert.deepStrictEqual(await loaded.getVolumes(), [{ label: 'vol1' }]);
});

test('a module that exists but is broken still fails loudly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marquee-ms-'));
  const file = path.join(dir, 'mediaStorage.js');
  fs.writeFileSync(file, "require('./not-there');");
  assert.throws(() => loadMediaStorage([file]), /not-there/);
});

test('no tracked module requires ./mediaStorage directly', () => {
  const libDir = path.join(__dirname, '..', 'lib');
  for (const name of fs.readdirSync(libDir)) {
    if (!name.endsWith('.js') || name === 'mediaStorage.js' || name === 'loadMediaStorage.js') continue;
    const src = fs.readFileSync(path.join(libDir, name), 'utf8');
    assert.ok(!/require\(\s*['"]\.\/mediaStorage['"]\s*\)/.test(src), `${name} requires ./mediaStorage directly`);
  }
});
