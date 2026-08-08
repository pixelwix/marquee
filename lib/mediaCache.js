const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const requireAuth = require('../routes/requireAuth');

// Disk-backed cache sitting in front of Plex's own thumb/art endpoints —
// previously every image request (Now Playing, recently watched, top of
// month, search results) round-tripped to Plex live, for every visitor,
// every time. This makes Plex get hit once per image, ever; everyone after
// that is served from local disk.
//
// Kept in sync with routes/plex.js's own IMAGE_PATH_RE — only real Plex
// thumb/art paths are ever fetched, for the same reason that route
// validates it: an open path here could be used to make arbitrary
// authenticated GET requests to the Plex server with the admin token.
const IMAGE_PATH_RE = /^\/library\/metadata\/\d+\/(thumb|art)\/\d+$/;

const CACHE_DIR = process.env.IMAGE_CACHE_DIR
  || path.join(process.env.SESSION_DB_DIR || '/app/data', 'image-cache');
const MAX_BYTES = Number(process.env.IMAGE_CACHE_MAX_BYTES) || 1024 * 1024 * 1024; // 1GB
const DEFAULT_CONTENT_TYPE = 'image/jpeg';
const PRUNE_INTERVAL_MS = 15 * 60 * 1000;
// Prune down to 90% of the cap rather than exactly to it — pruning to the
// exact limit would put the next single write right back over budget,
// triggering a full re-sort on every following tick until traffic settles.
const PRUNE_TARGET_RATIO = 0.9;

// In-memory index (key -> { bytes, atimeMs, contentType }) is the source of
// truth for size accounting and LRU ordering — rebuilt once at boot by
// walking the cache dir, then kept current on every write/hit so pruning
// (lib/mediaCache.js's own scheduler, wired in separately) never needs a
// fresh directory walk. Access-time tracking is deliberately in-memory only
// (not persisted via utimes on every read) — a restart resets ordering to
// each file's last-write time, which is an acceptable trade for avoiding an
// extra disk syscall on every single cache hit.
const index = new Map();
let totalBytes = 0;
let indexReady = null;

// key -> Promise<{ contentType, buffer }> — concurrent requests for a key
// not yet on disk share one upstream fetch instead of each firing their own.
const inflight = new Map();

function cacheKeyFor(rawPath) {
  return crypto.createHash('sha256').update(rawPath).digest('hex');
}

// <cachedir>/<first2 hex chars>/<hash> — spreads entries across 256
// subdirectories so no single directory ends up holding tens of thousands
// of files.
function pathsFor(key) {
  const dir = path.join(CACHE_DIR, key.slice(0, 2));
  return {
    dir,
    dataPath: path.join(dir, key),
    metaPath: path.join(dir, `${key}.meta.json`),
    dataTmp: path.join(dir, `${key}.tmp`),
    metaTmp: path.join(dir, `${key}.meta.tmp`),
  };
}

async function rebuildIndex() {
  index.clear();
  totalBytes = 0;
  let subdirs;
  try {
    subdirs = await fsp.readdir(CACHE_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') return; // nothing cached yet
    throw err;
  }
  for (const sub of subdirs) {
    const subPath = path.join(CACHE_DIR, sub);
    let entries;
    try {
      entries = await fsp.readdir(subPath);
    } catch {
      continue;
    }
    const keys = entries.filter((f) => f.length === 64 && !f.includes('.'));
    for (const key of keys) {
      const { dataPath, metaPath } = pathsFor(key);
      try {
        // eslint-disable-next-line no-await-in-loop
        const [stat, metaRaw] = await Promise.all([fsp.stat(dataPath), fsp.readFile(metaPath, 'utf8')]);
        const meta = JSON.parse(metaRaw);
        index.set(key, { bytes: stat.size, atimeMs: stat.mtimeMs, contentType: meta.contentType || DEFAULT_CONTENT_TYPE });
        totalBytes += stat.size;
      } catch {
        // Data file with no valid meta (e.g. a crash between the two renames
        // in fetchAndCache) — not safe to serve without knowing its
        // content-type, and not worth repairing. Drop it; the next request
        // for that path just re-fetches.
        // eslint-disable-next-line no-await-in-loop
        await fsp.rm(dataPath, { force: true }).catch(() => {});
        // eslint-disable-next-line no-await-in-loop
        await fsp.rm(metaPath, { force: true }).catch(() => {});
      }
    }
  }
}

// Called lazily on first request rather than at require-time, so importing
// this module (e.g. from a test) never touches disk on its own.
function ensureIndex() {
  if (!indexReady) indexReady = rebuildIndex();
  return indexReady;
}

function updateIndex(key, bytes, contentType) {
  const prev = index.get(key);
  if (prev) totalBytes -= prev.bytes;
  index.set(key, { bytes, atimeMs: Date.now(), contentType });
  totalBytes += bytes;
}

// Writes data+meta to *.tmp, fsyncs each, then renames both into place.
// The data file is only ever observable at its final path once fully
// written and synced — a crash at any point before the final rename leaves
// only an orphaned *.tmp file, never a truncated file at the path a request
// would actually read from.
async function fetchAndCache(key, rawPath) {
  const { dir, dataPath, metaPath, dataTmp, metaTmp } = pathsFor(key);
  await fsp.mkdir(dir, { recursive: true });

  const upstream = await axios.get(`${process.env.PLEX_SERVER_URL}${rawPath}`, {
    headers: { 'X-Plex-Token': process.env.PLEX_ADMIN_TOKEN },
    responseType: 'arraybuffer',
    timeout: 15000,
  });
  const buffer = Buffer.from(upstream.data);
  const contentType = upstream.headers['content-type'] || DEFAULT_CONTENT_TYPE;
  const meta = { contentType, bytes: buffer.length, fetchedAt: Date.now() };

  const dataHandle = await fsp.open(dataTmp, 'w');
  try {
    await dataHandle.writeFile(buffer);
    await dataHandle.sync();
  } finally {
    await dataHandle.close();
  }

  const metaHandle = await fsp.open(metaTmp, 'w');
  try {
    await metaHandle.writeFile(JSON.stringify(meta));
    await metaHandle.sync();
  } finally {
    await metaHandle.close();
  }

  await fsp.rename(dataTmp, dataPath);
  await fsp.rename(metaTmp, metaPath);

  updateIndex(key, meta.bytes, contentType);
  return { contentType, buffer };
}

function serveBuffer(res, buffer, contentType, etag) {
  res.set('Content-Type', contentType);
  // Same reasoning as routes/plex.js's own /image route: the upstream path
  // is content-versioned (Plex changes the trailing id whenever the
  // underlying image does), so this exact path always means these exact
  // bytes — safe to cache indefinitely. "private" keeps it out of any
  // shared/edge cache, matching the requireAuth gate on this route.
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.set('ETag', etag);
  res.send(buffer);
}

// Core engine, deliberately Express-free so it's testable the same way
// every other lib/ module in this app is — as a plain async function —
// rather than needing to spin up real HTTP requests to exercise cache-hit/
// miss/dedupe logic. Assumes rawPath has already been validated by the
// caller (the route below does that before calling in).
async function getOrFetch(rawPath) {
  await ensureIndex();
  const key = cacheKeyFor(rawPath);

  const cached = index.get(key);
  if (cached) {
    const { dataPath } = pathsFor(key);
    try {
      const buffer = await fsp.readFile(dataPath);
      cached.atimeMs = Date.now();
      return { buffer, contentType: cached.contentType, key };
    } catch {
      // Indexed but missing on disk (e.g. removed out-of-band by a flush) —
      // treat as a normal cold miss instead of erroring.
      index.delete(key);
      totalBytes -= cached.bytes;
    }
  }

  if (inflight.has(key)) {
    const result = await inflight.get(key);
    return { ...result, key };
  }
  const promise = fetchAndCache(key, rawPath);
  inflight.set(key, promise);
  try {
    const result = await promise;
    return { ...result, key };
  } finally {
    inflight.delete(key);
  }
}

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const rawPath = req.query.path || '';
  if (!IMAGE_PATH_RE.test(rawPath)) return res.status(400).end();

  const key = cacheKeyFor(rawPath);
  // The key IS the ETag — it's a hash of the exact upstream path, and that
  // path only ever refers to one set of bytes (see serveBuffer's comment).
  // A matching If-None-Match means the client already has these bytes,
  // full stop, no need to touch disk or the upstream to confirm it.
  const etag = `"${key}"`;
  if (req.headers['if-none-match'] === etag) return res.status(304).end();

  try {
    const { buffer, contentType } = await getOrFetch(rawPath);
    serveBuffer(res, buffer, contentType, etag);
  } catch (err) {
    console.error('mediaCache upstream fetch failed:', err.code || err.response?.status, err.message);
    res.status(404).end();
  }
});

function stats() {
  return { bytes: totalBytes, count: index.size, maxBytes: MAX_BYTES, dir: CACHE_DIR };
}

// Manual "empty it out" for the admin panel's flush button — distinct from
// pruneIfNeeded's automatic partial LRU eviction. Any in-flight fetches at
// the moment of a flush are left to finish and will simply repopulate the
// (now-empty) cache when they land, rather than being cancelled.
async function flush() {
  // Without this, a freshly-started process that flushes before any /img
  // request or stats read has ever populated the index would report
  // removed:0/freedBytes:0 while still actually deleting everything on
  // disk — correct deletion, misleading numbers. Ensuring the index first
  // makes the report accurate regardless of call order.
  await ensureIndex();
  const removed = index.size;
  const freedBytes = totalBytes;
  index.clear();
  totalBytes = 0;
  await fsp.rm(CACHE_DIR, { recursive: true, force: true }).catch(() => {});
  indexReady = null; // next access lazily rebuilds against the now-empty dir
  return { removed, freedBytes };
}

// Cap enforcement by total bytes, not file count — a directory of full-res
// backdrops and one of tiny thumbs can have wildly different entry counts
// for the same disk footprint, so bytes is the only cap that means what it
// says. Runs on a timer (see start() below), never inline on a request —
// pruning touches disk for every evicted entry and has no business adding
// latency to whichever unlucky request happens to tip the cache over
// budget.
async function pruneIfNeeded() {
  await ensureIndex();
  if (totalBytes <= MAX_BYTES) return { pruned: [], freedBytes: 0 };

  const target = MAX_BYTES * PRUNE_TARGET_RATIO;
  // Oldest-accessed first — index atimeMs is updated on every cache hit
  // (see getOrFetch), so this evicts genuinely cold entries before hot
  // ones regardless of which was fetched first.
  const entries = [...index.entries()].sort((a, b) => a[1].atimeMs - b[1].atimeMs);

  const pruned = [];
  let freedBytes = 0;
  for (const [key, entry] of entries) {
    if (totalBytes <= target) break;
    const { dataPath, metaPath } = pathsFor(key);
    // eslint-disable-next-line no-await-in-loop
    await fsp.rm(dataPath, { force: true }).catch(() => {});
    // eslint-disable-next-line no-await-in-loop
    await fsp.rm(metaPath, { force: true }).catch(() => {});
    index.delete(key);
    totalBytes -= entry.bytes;
    freedBytes += entry.bytes;
    pruned.push(key);
  }
  return { pruned, freedBytes };
}

function start() {
  pruneIfNeeded().catch((err) => console.error('[mediaCache] initial prune failed:', err.message));
  setInterval(() => {
    pruneIfNeeded().catch((err) => console.error('[mediaCache] scheduled prune failed:', err.message));
  }, PRUNE_INTERVAL_MS);
}

module.exports = router;
module.exports.cacheKeyFor = cacheKeyFor;
module.exports.pathsFor = pathsFor;
module.exports.ensureIndex = ensureIndex;
module.exports.getOrFetch = getOrFetch;
module.exports.stats = stats;
module.exports.flush = flush;
module.exports.pruneIfNeeded = pruneIfNeeded;
module.exports.start = start;
module.exports.CACHE_DIR = CACHE_DIR;
module.exports.MAX_BYTES = MAX_BYTES;
module.exports.PRUNE_TARGET_RATIO = PRUNE_TARGET_RATIO;
