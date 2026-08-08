const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { execFileSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marquee-mediacache-'));
process.env.IMAGE_CACHE_DIR = cacheDir;
process.env.IMAGE_CACHE_MAX_BYTES = String(1024 * 1024 * 1024);
process.env.PLEX_ADMIN_TOKEN = 'test-token';

// Stands in for the real Plex server — records how many times it was hit
// (for the in-flight dedupe assertion) and can be pointed at a broken port
// to exercise the upstream-failure path.
let hitCount = 0;
let upstreamDelayMs = 0;
const fakeImage = Buffer.from('fake-jpeg-bytes-for-testing-1234567890');
const upstream = http.createServer((req, res) => {
  hitCount += 1;
  const respond = () => {
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    res.end(fakeImage);
  };
  if (upstreamDelayMs) setTimeout(respond, upstreamDelayMs);
  else respond();
});

test.before(async () => {
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  process.env.PLEX_SERVER_URL = `http://127.0.0.1:${upstream.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => upstream.close(resolve));
});

const mediaCache = require('../lib/mediaCache');

const THUMB_PATH = '/library/metadata/123/thumb/456';

test('cacheKeyFor is a stable hash and distinguishes thumb from art', () => {
  const thumbKey = mediaCache.cacheKeyFor('/library/metadata/123/thumb/456');
  const artKey = mediaCache.cacheKeyFor('/library/metadata/123/art/456');
  assert.equal(thumbKey, mediaCache.cacheKeyFor('/library/metadata/123/thumb/456'));
  assert.notEqual(thumbKey, artKey);
  assert.match(thumbKey, /^[0-9a-f]{64}$/);
});

test('pathsFor spreads entries across a 2-char subdirectory of the cache dir', () => {
  const key = mediaCache.cacheKeyFor(THUMB_PATH);
  const { dir, dataPath, metaPath } = mediaCache.pathsFor(key);
  assert.equal(dir, path.join(mediaCache.CACHE_DIR, key.slice(0, 2)));
  assert.equal(dataPath, path.join(dir, key));
  assert.equal(metaPath, path.join(dir, `${key}.meta.json`));
});

test('getOrFetch downloads on a cold miss and writes a complete, non-truncated file with no leftover .tmp', async () => {
  hitCount = 0;
  const result = await mediaCache.getOrFetch(THUMB_PATH);
  assert.equal(hitCount, 1);
  assert.equal(result.contentType, 'image/jpeg');
  assert.ok(result.buffer.equals(fakeImage));

  const { dataPath, metaPath, dataTmp, metaTmp } = mediaCache.pathsFor(result.key);
  const onDisk = await fsp.readFile(dataPath);
  assert.ok(onDisk.equals(fakeImage));
  const meta = JSON.parse(await fsp.readFile(metaPath, 'utf8'));
  assert.equal(meta.bytes, fakeImage.length);
  assert.equal(meta.contentType, 'image/jpeg');
  await assert.rejects(fsp.access(dataTmp));
  await assert.rejects(fsp.access(metaTmp));
});

test('getOrFetch serves from disk on a warm hit without touching the upstream again', async () => {
  hitCount = 0;
  const result = await mediaCache.getOrFetch(THUMB_PATH);
  assert.equal(hitCount, 0);
  assert.ok(result.buffer.equals(fakeImage));
});

test('ten concurrent requests for the same not-yet-cached image result in exactly one upstream fetch', async () => {
  const freshPath = '/library/metadata/999/thumb/1';
  hitCount = 0;
  upstreamDelayMs = 30; // widen the race window so all 10 land while the first is still in flight
  try {
    const results = await Promise.all(Array.from({ length: 10 }, () => mediaCache.getOrFetch(freshPath)));
    assert.equal(hitCount, 1);
    assert.ok(results.every((r) => r.buffer.equals(fakeImage)));
  } finally {
    upstreamDelayMs = 0;
  }
});

test('a failed fetch does not poison the key — a retry after upstream recovery succeeds', async () => {
  const flakyPath = '/library/metadata/777/thumb/1';
  const realPort = upstream.address().port;
  process.env.PLEX_SERVER_URL = 'http://127.0.0.1:1'; // nothing listens here
  await assert.rejects(mediaCache.getOrFetch(flakyPath));

  process.env.PLEX_SERVER_URL = `http://127.0.0.1:${realPort}`;
  hitCount = 0;
  const result = await mediaCache.getOrFetch(flakyPath);
  assert.equal(hitCount, 1);
  assert.ok(result.buffer.equals(fakeImage));
});

test('flush empties the index, reports what it removed, and getOrFetch after a flush re-fetches from upstream', async () => {
  await mediaCache.getOrFetch(THUMB_PATH); // ensure something is cached
  const before = mediaCache.stats();
  assert.ok(before.count > 0);
  assert.ok(before.bytes > 0);

  const result = await mediaCache.flush();
  assert.equal(result.removed, before.count);
  assert.equal(result.freedBytes, before.bytes);

  const after = mediaCache.stats();
  assert.equal(after.count, 0);
  assert.equal(after.bytes, 0);

  hitCount = 0;
  const refetched = await mediaCache.getOrFetch(THUMB_PATH);
  assert.equal(hitCount, 1);
  assert.ok(refetched.buffer.equals(fakeImage));
});

test('flush reports accurate counts even in a fresh process that never populated its index first', async () => {
  // Regression test: flush() used to read index.size/totalBytes without
  // ensuring the index was populated first, so a process that flushed
  // before any prior /img request or stats read would report removed:0/
  // freedBytes:0 while still actually deleting everything on disk —
  // correct deletion, misleading numbers. Runs in a genuinely separate
  // process (not just a reset of in-memory state) since that's the only
  // way to reproduce "index never touched yet in this process."
  await mediaCache.getOrFetch(THUMB_PATH);
  const { bytes: expectedBytes, count: expectedCount } = mediaCache.stats();
  assert.ok(expectedCount > 0);

  const script = `
    process.env.IMAGE_CACHE_DIR = ${JSON.stringify(cacheDir)};
    const mediaCache = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'mediaCache.js'))});
    mediaCache.flush().then((r) => { console.log(JSON.stringify(r)); });
  `;
  const output = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  const result = JSON.parse(output.trim());
  assert.equal(result.removed, expectedCount);
  assert.equal(result.freedBytes, expectedBytes);
});

test('end-to-end: the mounted route serves bytes, rejects invalid paths, honors If-None-Match, and turns upstream failure into a 404 not a 500', async () => {
  const app = express();
  app.use((req, res, next) => { req.session = { user: { id: 'test-owner' } }; next(); });
  app.use('/img', mediaCache);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  const get = (qs, headers = {}) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: `/img?${qs}`, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });

  try {
    const okPath = '/library/metadata/42/thumb/1';
    const first = await get(`path=${encodeURIComponent(okPath)}`);
    assert.equal(first.status, 200);
    assert.equal(first.headers['content-type'], 'image/jpeg');
    assert.ok(first.headers.etag);
    assert.ok(first.body.equals(fakeImage));

    const conditional = await get(`path=${encodeURIComponent(okPath)}`, { 'If-None-Match': first.headers.etag });
    assert.equal(conditional.status, 304);

    const badPath = await get(`path=${encodeURIComponent('/etc/passwd')}`);
    assert.equal(badPath.status, 400);

    const realPort = upstream.address().port;
    process.env.PLEX_SERVER_URL = 'http://127.0.0.1:1';
    const failedFetch = await get(`path=${encodeURIComponent('/library/metadata/500/thumb/1')}`);
    assert.equal(failedFetch.status, 404);
    process.env.PLEX_SERVER_URL = `http://127.0.0.1:${realPort}`;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('pruneIfNeeded evicts the least-recently-accessed entries first, by total bytes not file count, down to 90% of the cap', async () => {
  // Runs in a genuinely separate process with a tiny MAX_BYTES — the real
  // module fixes MAX_BYTES from env at load time, so exercising real
  // pruning behavior needs its own process rather than reusing the shared
  // 1GB-cap module already loaded above. Reuses this file's shared upstream
  // mock server (real, reachable over loopback from a child process) so the
  // 5 files it seeds are genuine on-disk entries with genuinely distinct
  // mtimes, not synthetic index rows.
  //
  // Uses the async execFile, not execFileSync — execFileSync blocks this
  // process's event loop for as long as the child runs, and the child's
  // getOrFetch() needs to reach the mock server that lives in *this*
  // process's event loop. With execFileSync that's a deadlock: the child's
  // request never gets serviced until this process resumes, which only
  // happens once the child exits, which it can't do until it gets a
  // response — it only ever "resolves" via axios's own 15s client timeout.
  const pruneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marquee-mediacache-prune-'));
  const port = upstream.address().port;
  const imageSize = fakeImage.length;

  const script = `
    process.env.IMAGE_CACHE_DIR = ${JSON.stringify(pruneDir)};
    process.env.IMAGE_CACHE_MAX_BYTES = String(${imageSize} * 3);
    process.env.PLEX_ADMIN_TOKEN = 'test-token';
    process.env.PLEX_SERVER_URL = 'http://127.0.0.1:${port}';
    const mediaCache = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'mediaCache.js'))});

    async function main() {
      // Sequential, with a delay, so each file's mtime is distinctly
      // ordered — pruning sorts by that ordering.
      const paths = [1, 2, 3, 4, 5].map((n) => \`/library/metadata/\${900 + n}/thumb/1\`);
      const keys = [];
      for (const p of paths) {
        const r = await mediaCache.getOrFetch(p);
        keys.push(r.key);
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      const before = mediaCache.stats();
      const result = await mediaCache.pruneIfNeeded();
      const after = mediaCache.stats();
      console.log(JSON.stringify({ before, result, after, oldestThreeKeys: keys.slice(0, 3), newestTwoKeys: keys.slice(3) }));
    }
    main().catch((e) => { console.error(e); process.exit(1); });
  `;
  const { stdout } = await execFileAsync(process.execPath, ['-e', script]);
  const { before, result, after, oldestThreeKeys, newestTwoKeys } = JSON.parse(stdout.trim());

  assert.equal(before.count, 5);
  assert.equal(before.bytes, imageSize * 5);
  // Cap is 3*imageSize; target is 90% of that = 2.7*imageSize. Starting at
  // 5 entries, eviction has to remove the 3 oldest to get under target
  // (removing only 2 would leave 3*imageSize, which is still > target).
  assert.equal(result.pruned.length, 3);
  assert.equal(result.freedBytes, imageSize * 3);
  assert.deepEqual(result.pruned.sort(), oldestThreeKeys.sort());
  assert.equal(after.count, 2);
  assert.ok(after.bytes <= imageSize * 3 * 0.9);
  assert.ok(newestTwoKeys.length === 2); // the 2 keys the child process reported as kept

  // Confirm on disk, independent of the child's own self-report: exactly
  // the 2 newest data files remain, the 3 oldest are gone. Data files are
  // bare 64-char hex hashes with no extension — filters out both the
  // *.meta.json sidecars and the 2-char subdirectory entries themselves.
  const remainingKeys = fs.readdirSync(pruneDir, { recursive: true })
    .map((f) => path.basename(f))
    .filter((f) => f.length === 64 && !f.includes('.'));
  assert.equal(remainingKeys.length, 2);
  for (const key of newestTwoKeys) assert.ok(remainingKeys.includes(key));
  for (const key of oldestThreeKeys) assert.ok(!remainingKeys.includes(key));

  await fsp.rm(pruneDir, { recursive: true, force: true });
});
