const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');
const { refusal, shouldStart } = require('../lib/safeMode');

test('reads pass: plain GETs, Tautulli get_* commands, SABnzbd queue/version', () => {
  assert.strictEqual(refusal('get', 'http://sonarr:8989/api/v3/series'), null);
  assert.strictEqual(refusal('get', 'http://tautulli/api/v2', { cmd: 'get_activity' }), null);
  assert.strictEqual(refusal('GET', 'http://tautulli/api/v2?cmd=status'), null);
  assert.strictEqual(refusal('get', 'http://sab/api', { mode: 'queue', output: 'json' }), null);
  assert.strictEqual(refusal('get', 'http://sab/api', { mode: 'version' }), null);
});

test('writes are refused: POST/PUT/DELETE to services', () => {
  assert.match(refusal('post', 'http://radarr:7878/api/v3/command'), /POST/);
  assert.match(refusal('delete', 'http://overseerr/api/v1/request/5'), /DELETE/);
  assert.match(refusal('put', 'https://clients.plex.tv/api/v2/shared_servers/1'), /PUT/);
});

test('GETs that act are refused: Tautulli notify/set_*, SABnzbd pause/delete', () => {
  assert.match(refusal('get', 'http://tautulli/api/v2', { cmd: 'set_notifier_config' }), /cmd=set_notifier_config/);
  assert.match(refusal('get', 'http://tautulli/api/v2?cmd=notify'), /cmd=notify/);
  assert.match(refusal('get', 'http://sab/api', { mode: 'queue', name: 'delete', value: 'x' }), /name=delete/);
  assert.match(refusal('get', 'http://sab/api', { mode: 'addurl' }), /mode=addurl/);
});

test('the few allowed non-GETs: Plex PIN sign-in, qBittorrent login, CLIProxyAPI chat', () => {
  assert.strictEqual(refusal('post', 'https://plex.tv/api/v2/pins?strong=true'), null);
  assert.strictEqual(refusal('post', 'http://qbit:8080/api/v2/auth/login'), null);
  const prev = process.env.CLIPROXY_URL;
  process.env.CLIPROXY_URL = 'http://cliproxy:8317';
  try {
    assert.strictEqual(refusal('post', 'http://cliproxy:8317/v1/chat/completions'), null);
    assert.match(refusal('post', 'http://cliproxy:8318/v1/chat/completions'), /POST/);
  } finally {
    if (prev === undefined) delete process.env.CLIPROXY_URL; else process.env.CLIPROXY_URL = prev;
  }
});

test('acting jobs are skipped only in safe mode', () => {
  const prev = process.env.MARQUEE_SAFE_MODE;
  try {
    delete process.env.MARQUEE_SAFE_MODE;
    assert.strictEqual(shouldStart('issueFixSweep'), true);
    process.env.MARQUEE_SAFE_MODE = '1';
    assert.strictEqual(shouldStart('issueFixSweep'), false);
    assert.strictEqual(shouldStart('recapReminder'), false);
    assert.strictEqual(shouldStart('nowPlaying'), true);
  } finally {
    if (prev === undefined) delete process.env.MARQUEE_SAFE_MODE; else process.env.MARQUEE_SAFE_MODE = prev;
  }
});

// install() patches process-wide objects, so check it in a separate Node process.
test('installed guard blocks writes through axios instances, default axios, fetch and web push', () => {
  const lib = path.join(__dirname, '..', 'lib', 'safeMode.js');
  const script = `
    require(${JSON.stringify(lib)}).install();
    const axios = require('axios');
    const inst = axios.create({ baseURL: 'http://127.0.0.1:9' });
    const results = [];
    const tryIt = (name, p) => p.then(() => results.push(name + ':sent'), (e) => results.push(name + ':' + (e.code || e.message)));
    Promise.all([
      tryIt('instance-post', inst.post('/api/v3/command', {})),
      tryIt('default-delete', axios.delete('http://127.0.0.1:9/x')),
      tryIt('tautulli-notify', axios.get('http://127.0.0.1:9/api/v2', { params: { cmd: 'notify' } })),
      tryIt('fetch-post', fetch('http://127.0.0.1:9/run', { method: 'POST' })),
      require('web-push').sendNotification({}, '').then((r) => results.push('push:' + r.statusCode)),
    ]).then(() => { console.log(JSON.stringify(results.sort())); });
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, MARQUEE_SAFE_MODE: '1' },
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
  });
  const results = JSON.parse(out.trim().split('\n').pop());
  assert.deepStrictEqual(results, [
    'default-delete:MARQUEE_SAFE_MODE',
    'fetch-post:MARQUEE_SAFE_MODE',
    'instance-post:MARQUEE_SAFE_MODE',
    'push:201',
    'tautulli-notify:MARQUEE_SAFE_MODE',
  ]);
});
