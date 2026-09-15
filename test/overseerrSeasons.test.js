const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mapTvSeasons } = require('../lib/overseerrSeasons');

test('mapTvSeasons: a freshly-made pending request (mediaInfo.seasons still empty) is correctly marked requested — real bug caught live 2026-09-15 ("Release that Witch" showed "No pending seasons found" in the admin approval modal despite Overseerr itself showing a real Pending Season 1 request)', () => {
  const data = {
    name: 'Release that Witch',
    seasons: [{ seasonNumber: 1, name: 'Season 1', episodeCount: 8 }],
    mediaInfo: {
      status: 2, // pending, at the media level
      seasons: [], // <- empty, exactly as Overseerr returns for a brand-new request
      requests: [
        { status: 1, seasons: [{ seasonNumber: 1, status: 1 }] }, // request itself is pending
      ],
    },
  };
  const result = mapTvSeasons(data);
  assert.equal(result.length, 1);
  assert.equal(result[0].requested, true);
  assert.equal(result[0].available, false);
});

test('mapTvSeasons: a season already in progress (mediaInfo.seasons populated) is still marked requested even with no matching pending request', () => {
  const data = {
    seasons: [{ seasonNumber: 1, name: 'Season 1', episodeCount: 10 }],
    mediaInfo: { seasons: [{ seasonNumber: 1, status: 3 }], requests: [] }, // processing
  };
  const result = mapTvSeasons(data);
  assert.equal(result[0].requested, true);
});

test('mapTvSeasons: a season already available is not marked requested even if a stale/declined request also names it', () => {
  const data = {
    seasons: [{ seasonNumber: 1, name: 'Season 1', episodeCount: 10 }],
    mediaInfo: {
      seasons: [{ seasonNumber: 1, status: 5 }], // available
      requests: [{ status: 3, seasons: [{ seasonNumber: 1, status: 1 }] }], // status 3 = declined, not pending
    },
  };
  const result = mapTvSeasons(data);
  assert.equal(result[0].available, true);
  assert.equal(result[0].requested, false);
});

test('mapTvSeasons: a declined-only request contributes no requested seasons (only status === 1 requests count as pending)', () => {
  const data = {
    seasons: [{ seasonNumber: 2, name: 'Season 2', episodeCount: 6 }],
    mediaInfo: { seasons: [], requests: [{ status: 3, seasons: [{ seasonNumber: 2, status: 1 }] }] },
  };
  const result = mapTvSeasons(data);
  assert.equal(result[0].requested, false);
});

test('mapTvSeasons: multiple seasons across multiple pending requests are all picked up', () => {
  const data = {
    seasons: [
      { seasonNumber: 1, name: 'Season 1', episodeCount: 8 },
      { seasonNumber: 2, name: 'Season 2', episodeCount: 8 },
      { seasonNumber: 3, name: 'Season 3', episodeCount: 8 },
    ],
    mediaInfo: {
      seasons: [],
      requests: [
        { status: 1, seasons: [{ seasonNumber: 1, status: 1 }] },
        { status: 1, seasons: [{ seasonNumber: 3, status: 1 }] },
      ],
    },
  };
  const result = mapTvSeasons(data);
  assert.deepEqual(result.map((s) => s.requested), [true, false, true]);
});

test('mapTvSeasons: "Specials" (season 0) is always excluded', () => {
  const data = {
    seasons: [
      { seasonNumber: 0, name: 'Specials', episodeCount: 3 },
      { seasonNumber: 1, name: 'Season 1', episodeCount: 8 },
    ],
    mediaInfo: { seasons: [], requests: [{ status: 1, seasons: [{ seasonNumber: 1, status: 1 }] }] },
  };
  const result = mapTvSeasons(data);
  assert.equal(result.length, 1);
  assert.equal(result[0].seasonNumber, 1);
});

test('mapTvSeasons: no mediaInfo at all (never requested) — every season is neither available nor requested', () => {
  const data = { seasons: [{ seasonNumber: 1, name: 'Season 1', episodeCount: 8 }] };
  const result = mapTvSeasons(data);
  assert.equal(result[0].available, false);
  assert.equal(result[0].requested, false);
});
