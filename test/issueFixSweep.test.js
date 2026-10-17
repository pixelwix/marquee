const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Same setup as autoFixIssue.test.js: the clients bind their URLs at require
// time, so these are set before lib/issueFixSweep.js is required.
const OVERSEERR_PORT = 58741;
const RADARR_PORT = 58742;
const SONARR_PORT = 58743;
process.env.OVERSEERR_URL = `http://127.0.0.1:${OVERSEERR_PORT}`;
process.env.RADARR_URL = `http://127.0.0.1:${RADARR_PORT}`;
process.env.RADARR_API_KEY = 'test-radarr-key';
process.env.SONARR_URL = `http://127.0.0.1:${SONARR_PORT}`;
process.env.SONARR_API_KEY = 'test-sonarr-key';

const REPORTED = '2026-10-08T02:36:37.000Z';
const BEFORE = '2026-10-01T00:00:00Z';
const AFTER = '2026-10-09T04:53:00Z';

const openIssues = [
  { id: 1, createdAt: REPORTED, media: { mediaType: 'movie', tmdbId: 100 } },                                   // replaced after the report
  { id: 2, createdAt: REPORTED, media: { mediaType: 'movie', tmdbId: 200 } },                                   // same old file
  { id: 3, createdAt: REPORTED, media: { mediaType: 'movie', tmdbId: 300 } },                                   // no file at all
  { id: 4, createdAt: REPORTED, problemSeason: 2, problemEpisode: 5, media: { mediaType: 'tv', tvdbId: 900 } }, // episode replaced
  { id: 5, createdAt: REPORTED, problemSeason: 2, problemEpisode: 0, media: { mediaType: 'tv', tvdbId: 900 } }  // whole season: skipped
];
let resolved = [];
let comments = [];

function json(res, body) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise(r => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => r(b ? JSON.parse(b) : {})); });
}

const overseerrServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/api/v1/issue') return json(res, { results: openIssues });
  let m = url.pathname.match(/^\/api\/v1\/issue\/(\d+)\/resolved$/);
  if (req.method === 'POST' && m) { resolved.push(Number(m[1])); return json(res, {}); }
  m = url.pathname.match(/^\/api\/v1\/issue\/(\d+)\/comment$/);
  if (req.method === 'POST' && m) { comments.push({ id: Number(m[1]), ...(await readBody(req)) }); return json(res, {}); }
  res.writeHead(404).end();
});

const movieFiles = { 100: { id: 11, dateAdded: AFTER }, 200: { id: 22, dateAdded: BEFORE } };
const radarrServer = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/v3/movie') {
    const tmdbId = Number(url.searchParams.get('tmdbId'));
    const file = movieFiles[tmdbId];
    return json(res, [{ id: tmdbId, hasFile: !!file, movieFileId: file?.id ?? null }]);
  }
  const m = url.pathname.match(/^\/api\/v3\/moviefile\/(\d+)$/);
  if (m) {
    const file = Object.values(movieFiles).find(f => f.id === Number(m[1]));
    return json(res, { dateAdded: file.dateAdded, quality: { quality: { name: 'Bluray-1080p' } } });
  }
  res.writeHead(404).end();
});

const sonarrServer = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/v3/series') return json(res, [{ id: 7 }]);
  if (url.pathname === '/api/v3/episode') return json(res, [{ id: 70, episodeNumber: 5, hasFile: true, episodeFileId: 700 }]);
  if (url.pathname === '/api/v3/episodefile/700') return json(res, { dateAdded: AFTER, quality: { quality: { name: 'WEBDL-1080p' } } });
  res.writeHead(404).end();
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

const { sweepOnce } = require('../lib/issueFixSweep');

test('resolves only issues whose movie or episode was replaced after the report', async () => {
  resolved = []; comments = [];
  const result = await sweepOnce();
  assert.deepEqual(result, [1, 4]);
  assert.deepEqual(resolved, [1, 4]);
});

test('leaves a comment saying what replaced it before resolving', async () => {
  resolved = []; comments = [];
  await sweepOnce();
  assert.deepEqual(comments.map(c => c.id), [1, 4]);
  assert.match(comments[0].message, /new Bluray-1080p copy on Oct 8\b/);   // 04:53 UTC Oct 9 = Oct 8 evening in Chicago
  assert.match(comments[1].message, /new WEBDL-1080p copy/);
});
