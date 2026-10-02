const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseFranchiseCollections, matchCollectionGaps, computeAllGaps } = require('../lib/collectionGaps');

test('parseFranchiseCollections reads a tmdb_collection-based entry, including a name needing quoting for its colon', () => {
  const yamlText = `
collections:
  Alien Collection:
    tmdb_collection: 8091
    sync_mode: sync
  "Mission: Impossible Collection":
    tmdb_collection: 87359
    sync_mode: sync
`;
  const defs = parseFranchiseCollections(yamlText);
  assert.deepEqual(defs, [
    { name: 'Alien Collection', tmdbCollectionId: 8091, tmdbMovieIds: null },
    { name: 'Mission: Impossible Collection', tmdbCollectionId: 87359, tmdbMovieIds: null }
  ]);
});

test('parseFranchiseCollections reads a tmdb_movie explicit-list entry (real shape: "DC Tomorrowverse" has no real TMDB collection)', () => {
  const yamlText = `
collections:
  DC Tomorrowverse:
    tmdb_movie:
      - 618354
      - 736069
`;
  const defs = parseFranchiseCollections(yamlText);
  assert.deepEqual(defs, [{ name: 'DC Tomorrowverse', tmdbCollectionId: null, tmdbMovieIds: [618354, 736069] }]);
});

test('parseFranchiseCollections skips an entry with neither tmdb_collection nor tmdb_movie rather than crashing the whole file', () => {
  const yamlText = `
collections:
  Broken Entry:
    sync_mode: sync
  Alien Collection:
    tmdb_collection: 8091
`;
  const defs = parseFranchiseCollections(yamlText);
  assert.deepEqual(defs.map(d => d.name), ['Alien Collection']);
});

test('parseFranchiseCollections overrides "James Bond Collection" to just the Daniel Craig films, ignoring franchises.yml\'s own tmdb_collection (the full 27-film TMDB collection) — real user request 2026-10-02, only affects this gap check, not Kometa\'s actual Plex collection', () => {
  const yamlText = `
collections:
  James Bond Collection:
    tmdb_collection: 645
`;
  const defs = parseFranchiseCollections(yamlText);
  assert.deepEqual(defs, [{ name: 'James Bond Collection', tmdbCollectionId: null, tmdbMovieIds: [36557, 10764, 37724, 206647, 370172] }]);
});

test('matchCollectionGaps finds the real one-film gap (Alien³ missing from an otherwise-complete Alien Collection)', () => {
  const def = { name: 'Alien Collection', tmdbCollectionId: 8091, tmdbMovieIds: null };
  const radarrCollections = new Map([[8091, {
    movies: [
      { tmdbId: 348, title: 'Alien', year: 1979 },
      { tmdbId: 679, title: 'Aliens', year: 1986 },
      { tmdbId: 8077, title: 'Alien³', year: 1992 },
      { tmdbId: 8078, title: 'Alien Resurrection', year: 1997 }
    ]
  }]]);
  const library = new Map([
    [348, { hasFile: true }], [679, { hasFile: true }], [8078, { hasFile: true }]
    // 8077 (Alien³) absent entirely — never added to Radarr at all
  ]);
  const result = matchCollectionGaps(def, radarrCollections, library);
  assert.equal(result.totalCount, 4);
  assert.equal(result.ownedCount, 3);
  assert.deepEqual(result.missingTmdbIds, [8077]);
});

test('matchCollectionGaps treats a monitored-but-fileless movie as missing too, not just an untracked one', () => {
  const def = { name: 'Alien Collection', tmdbCollectionId: 8091, tmdbMovieIds: null };
  const radarrCollections = new Map([[8091, { movies: [{ tmdbId: 348 }, { tmdbId: 8077 }] }]]);
  const library = new Map([[348, { hasFile: true }], [8077, { hasFile: false }]]); // tracked, just no file
  const result = matchCollectionGaps(def, radarrCollections, library);
  assert.deepEqual(result.missingTmdbIds, [8077]);
});

test('matchCollectionGaps returns null for a fully-owned collection (nothing to show)', () => {
  const def = { name: 'Alien Collection', tmdbCollectionId: 8091, tmdbMovieIds: null };
  const radarrCollections = new Map([[8091, { movies: [{ tmdbId: 348 }, { tmdbId: 679 }] }]]);
  const library = new Map([[348, { hasFile: true }], [679, { hasFile: true }]]);
  assert.equal(matchCollectionGaps(def, radarrCollections, library), null);
});

test('matchCollectionGaps flags "unknown" for a tmdb_collection Radarr has never cached (real case: Batman Collection, 0/4 owned, so Radarr never discovered it)', () => {
  const def = { name: 'Batman Collection', tmdbCollectionId: 2344, tmdbMovieIds: null };
  const result = matchCollectionGaps(def, new Map(), new Map());
  assert.deepEqual(result, { name: 'Batman Collection', tmdbCollectionId: 2344, unknown: true });
});

test('matchCollectionGaps checks a tmdb_movie explicit list purely against the library, no Radarr collection cache needed', () => {
  const def = { name: 'DC Tomorrowverse', tmdbCollectionId: null, tmdbMovieIds: [618354, 736069] };
  const library = new Map([[618354, { hasFile: true }]]); // 736069 not even present
  const result = matchCollectionGaps(def, new Map(), library);
  assert.equal(result.totalCount, 2);
  assert.equal(result.ownedCount, 1);
  assert.deepEqual(result.missingTmdbIds, [736069]);
});

test('computeAllGaps drops fully-owned collections and sorts biggest-gap-first, with unknown entries last regardless of gap size', () => {
  const defs = [
    { name: 'One Short', tmdbCollectionId: 1, tmdbMovieIds: null },
    { name: 'Complete', tmdbCollectionId: 2, tmdbMovieIds: null },
    { name: 'Four Short', tmdbCollectionId: 3, tmdbMovieIds: null },
    { name: 'Cant Check', tmdbCollectionId: 4, tmdbMovieIds: null }
  ];
  const radarrCollections = new Map([
    [1, { movies: [{ tmdbId: 10 }, { tmdbId: 11 }] }],
    [2, { movies: [{ tmdbId: 20 }] }],
    [3, { movies: [{ tmdbId: 30 }, { tmdbId: 31 }, { tmdbId: 32 }, { tmdbId: 33 }] }]
    // 4 absent -> unknown
  ]);
  const library = new Map([
    [10, { hasFile: true }], [11, { hasFile: false }],
    [20, { hasFile: true }],
    [30, { hasFile: false }], [31, { hasFile: false }], [32, { hasFile: false }], [33, { hasFile: false }]
  ]);
  const result = computeAllGaps(defs, radarrCollections, library);
  assert.deepEqual(result.map(r => r.name), ['Four Short', 'One Short', 'Cant Check']);
});

test('partitionByReleaseStatus separates a released movie from an announced-but-unreleased one (real case: "Untitled Alien: Romulus Sequel")', () => {
  const { partitionByReleaseStatus } = require('../lib/collectionGaps');
  const items = [
    { tmdbId: 8077, title: 'Alien³', status: 'released' },
    { tmdbId: 1434936, title: 'Untitled Alien: Romulus Sequel', status: 'announced' }
  ];
  const { released, unreleased } = partitionByReleaseStatus(items);
  assert.deepEqual(released.map(i => i.title), ['Alien³']);
  assert.deepEqual(unreleased.map(i => i.title), ['Untitled Alien: Romulus Sequel']);
});

test('partitionByReleaseStatus treats a null status (lookup failed) as unreleased rather than assuming it is fine to request', () => {
  const { partitionByReleaseStatus } = require('../lib/collectionGaps');
  const { released, unreleased } = partitionByReleaseStatus([{ tmdbId: 1, status: null }]);
  assert.equal(released.length, 0);
  assert.equal(unreleased.length, 1);
});

test('partitionByReleaseStatus treats inCinemas/tba the same as announced — only a real "released" status counts', () => {
  const { partitionByReleaseStatus } = require('../lib/collectionGaps');
  const { released, unreleased } = partitionByReleaseStatus([
    { tmdbId: 1, status: 'tba' },
    { tmdbId: 2, status: 'inCinemas' },
    { tmdbId: 3, status: 'released' }
  ]);
  assert.equal(released.length, 1);
  assert.equal(unreleased.length, 2);
});
