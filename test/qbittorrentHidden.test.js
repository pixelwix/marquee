const { test } = require('node:test');
const assert = require('node:assert/strict');
const { visibleTorrents } = require('../lib/qbittorrent');

const torrents = [
  { hash: 'a', category: 'tv-sonarr' },
  { hash: 'b', category: 'race' },
  { hash: 'c', category: 'RACE' },
  { hash: 'd', category: '' },
  { hash: 'e' }
];

test('visibleTorrents drops hidden categories case-insensitively and keeps uncategorised torrents', () => {
  assert.deepEqual(visibleTorrents(torrents, ['race']).map(t => t.hash), ['a', 'd', 'e']);
});

test('visibleTorrents hides the race category by default', () => {
  const saved = process.env.QBITTORRENT_HIDDEN_CATEGORIES;
  delete process.env.QBITTORRENT_HIDDEN_CATEGORIES;
  try {
    assert.deepEqual(visibleTorrents(torrents).map(t => t.hash), ['a', 'd', 'e']);
  } finally {
    if (saved !== undefined) process.env.QBITTORRENT_HIDDEN_CATEGORIES = saved;
  }
});

test('an empty QBITTORRENT_HIDDEN_CATEGORIES shows everything', () => {
  const saved = process.env.QBITTORRENT_HIDDEN_CATEGORIES;
  process.env.QBITTORRENT_HIDDEN_CATEGORIES = '';
  try {
    assert.equal(visibleTorrents(torrents).length, 5);
  } finally {
    if (saved === undefined) delete process.env.QBITTORRENT_HIDDEN_CATEGORIES;
    else process.env.QBITTORRENT_HIDDEN_CATEGORIES = saved;
  }
});
