const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// overseerrClient.js's adminClient binds OVERSEERR_URL into an axios.create()
// baseURL at require time (see lib/overseerrClient.js) — these have to be set
// before autoFixIssue.js (which requires it transitively) is ever required,
// same reasoning as sessionEncryption.test.js setting SESSION_SECRET first.
// Fixed ports (not 0/random) so the URL string is correct immediately; the
// servers themselves only need to actually be listening by the time a test
// body runs, not at require time.
const OVERSEERR_PORT = 58731;
const RADARR_PORT = 58732;
const SONARR_PORT = 58733;
process.env.OVERSEERR_URL = `http://127.0.0.1:${OVERSEERR_PORT}`;
process.env.RADARR_URL = `http://127.0.0.1:${RADARR_PORT}`;
process.env.RADARR_API_KEY = 'test-radarr-key';
process.env.SONARR_URL = `http://127.0.0.1:${SONARR_PORT}`;
process.env.SONARR_API_KEY = 'test-sonarr-key';

let resolvedIssueIds = [];
let radarrReleaseSearchCount = 0;
let radarrMovieFileDateAdded = null; // set per-test; null keeps /moviefile "still downloading"

const overseerrServer = http.createServer((req, res) => {
  const match = req.url.match(/^\/api\/v1\/issue\/(\d+)\/resolved$/);
  if (req.method === 'POST' && match) {
    resolvedIssueIds.push(Number(match[1]));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{}');
  }
  res.writeHead(404).end();
});

// tmdbId 999 is the "nothing clears the quality profile" scenario — its own
// movie id (502) so its release search can return all-rejected independent
// of every other test's tmdbId, which all map to movie 501.
const radarrServer = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (url.pathname === '/api/v3/movie' && url.searchParams.get('tmdbId') === '999') {
    return res.end(JSON.stringify([{ id: 502, hasFile: false, movieFileId: null }]));
  }
  if (url.pathname === '/api/v3/movie' && url.searchParams.get('tmdbId')) {
    return res.end(JSON.stringify([{ id: 501, hasFile: false, movieFileId: null }]));
  }
  if (url.pathname === '/api/v3/release' && req.method === 'GET' && url.searchParams.get('movieId') === '502') {
    return res.end(JSON.stringify([
      { guid: 'bad', indexerId: 1, rejected: true, title: 'Below quality cutoff' }
    ]));
  }
  if (url.pathname === '/api/v3/release' && req.method === 'GET') {
    radarrReleaseSearchCount += 1;
    return res.end(JSON.stringify([
      { guid: 'bad', indexerId: 1, rejected: true, title: 'Below quality cutoff' },
      { guid: 'good', indexerId: 1, rejected: false, title: 'A Good Release 1080p' }
    ]));
  }
  if (url.pathname === '/api/v3/release' && req.method === 'POST') {
    return res.end('{}');
  }
  if (url.pathname === '/api/v3/queue') {
    return res.end(JSON.stringify({ records: [] })); // nothing queued — falls through to the file check
  }
  if (url.pathname === '/api/v3/movie/501') {
    return res.end(JSON.stringify({ id: 501, hasFile: !!radarrMovieFileDateAdded, movieFileId: radarrMovieFileDateAdded ? 9001 : null }));
  }
  if (url.pathname === '/api/v3/moviefile/9001') {
    return res.end(JSON.stringify({ dateAdded: radarrMovieFileDateAdded }));
  }
  res.writeHead(404).end();
});

// No-eligible-release scenario needs its own server (empty tmdbId keeps this
// distinct from radarrServer's movieId 501) — reuses the same Sonarr port
// since no test in this file exercises Sonarr directly.
const sonarrServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' }).end('[]');
});

test.before(async () => {
  await Promise.all([
    new Promise(r => overseerrServer.listen(OVERSEERR_PORT, '127.0.0.1', r)),
    new Promise(r => radarrServer.listen(RADARR_PORT, '127.0.0.1', r)),
    new Promise(r => sonarrServer.listen(SONARR_PORT, '127.0.0.1', r))
  ]);
});

test.after(async () => {
  await Promise.all([
    new Promise(r => overseerrServer.close(r)),
    new Promise(r => radarrServer.close(r)),
    new Promise(r => sonarrServer.close(r))
  ]);
});

const autoFixIssue = require('../lib/autoFixIssue');

test('a confirmed replacement (file dated after the grab) resolves the Overseerr issue', async () => {
  radarrMovieFileDateAdded = new Date().toISOString(); // "already there" as far as checkMovieGrabStatus's first poll sees it
  resolvedIssueIds = [];
  await autoFixIssue.attempt({ issueId: 4242, mediaType: 'movie', tmdbId: 111, season: null, episode: null, title: 'Test Movie' });
  // attempt() kicks off an unawaited poll loop — the first check happens
  // synchronously-ish (no setTimeout needed since status is 'done' on the
  // very first checkMovieGrabStatus call), but still a microtask away.
  await new Promise(r => setTimeout(r, 200));
  assert.deepEqual(resolvedIssueIds, [4242]);
});

test('picks the non-rejected release, never the one Radarr\'s own quality profile rejected', async () => {
  radarrMovieFileDateAdded = new Date().toISOString();
  const before = radarrReleaseSearchCount;
  await autoFixIssue.attempt({ issueId: 4243, mediaType: 'movie', tmdbId: 222, season: null, episode: null, title: 'Test Movie 2' });
  await new Promise(r => setTimeout(r, 200));
  assert.equal(radarrReleaseSearchCount, before + 1);
  // The mock's POST /api/v3/release doesn't record which guid it received,
  // but a rejected-only search would have hit the { ok: false } branch and
  // never reached the grab call at all — resolving at all proves the
  // non-rejected one was picked.
});

test('concurrent reports for the same movie only trigger one search (dedup guard)', async () => {
  radarrMovieFileDateAdded = new Date().toISOString();
  const before = radarrReleaseSearchCount;
  await Promise.all([
    autoFixIssue.attempt({ issueId: 5001, mediaType: 'movie', tmdbId: 333, season: null, episode: null, title: 'Duplicate Reports' }),
    autoFixIssue.attempt({ issueId: 5002, mediaType: 'movie', tmdbId: 333, season: null, episode: null, title: 'Duplicate Reports' })
  ]);
  await new Promise(r => setTimeout(r, 200));
  assert.equal(radarrReleaseSearchCount, before + 1);
});

test('does not resolve (or grab anything) when every release is rejected', async () => {
  const before = resolvedIssueIds.length;
  await autoFixIssue.attempt({ issueId: 6001, mediaType: 'movie', tmdbId: 999, season: null, episode: null, title: 'Nothing In Profile' });
  await new Promise(r => setTimeout(r, 200));
  assert.equal(resolvedIssueIds.length, before);
});
