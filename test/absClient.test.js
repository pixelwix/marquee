const { test } = require('node:test');
const assert = require('node:assert/strict');
const abs = require('../lib/absClient');

// Shape copied from Audiobookshelf 2.37.1's LibraryItem/Book toOldJSONMinified().
const item = {
  id: 'fe27d655-c8a7-4dc9-8ae4-4a94fd508689',
  addedAt: 1787932853496,
  isMissing: false,
  media: {
    coverPath: '/audiobooks/x/cover.jpg',
    duration: 29520,
    metadata: {
      title: 'The Rise of the Dragon',
      authorName: 'George R. R. Martin, Elio M. García Jr, Linda Antonsson',
      narratorName: 'Harry Lloyd',
      seriesName: 'The Targaryen Dynasty: The House of the Dragon #1',
      publishedYear: '2022',
      description: '<b>This lavish visual history&nbsp;is a stunning</b><br /> <br />introduction to <i>House of the Dragon</i>.'
    }
  }
};

test('mapItem turns a minified ABS item into the dashboard shape', () => {
  const b = abs.mapItem(item, 'https://books.example.test/');
  assert.equal(b.title, 'The Rise of the Dragon');
  assert.equal(b.narrator, 'Harry Lloyd');
  assert.equal(b.series, 'The Targaryen Dynasty: The House of the Dragon #1');
  assert.equal(b.hours, 8.2);
  assert.equal(b.addedAt, 1787932853496);
  assert.equal(b.cover, '/api/audiobooks/cover/fe27d655-c8a7-4dc9-8ae4-4a94fd508689');
  assert.equal(b.link, 'https://books.example.test/item/fe27d655-c8a7-4dc9-8ae4-4a94fd508689');
  assert.equal(b.overview, 'This lavish visual history is a stunning introduction to House of the Dragon.');
});

test('mapItem tolerates missing cover, duration and public URL', () => {
  const b = abs.mapItem({ id: 'a', media: { metadata: {} } }, '');
  assert.equal(b.title, 'Untitled');
  assert.equal(b.cover, null);
  assert.equal(b.hours, null);
  assert.equal(b.link, null);
  assert.equal(b.overview, '');
});

test('isConfigured needs URL, key and library id', () => {
  const saved = { ...process.env };
  delete process.env.ABS_URL; delete process.env.ABS_API_KEY; delete process.env.ABS_LIBRARY_ID;
  assert.equal(abs.isConfigured(), false);
  process.env.ABS_URL = 'http://abs'; process.env.ABS_LIBRARY_ID = 'lib';
  assert.equal(abs.isConfigured(), false);
  process.env.ABS_API_KEY = 'k';
  assert.equal(abs.isConfigured(), true);
  process.env = saved;
});

test('fetchCover rejects anything that is not an ABS item id (no arbitrary upstream paths)', async () => {
  await assert.rejects(abs.fetchCover('../api/users'), /Invalid id/);
});

test('mapItem and isProduced identify dramatized and multi-narrator editions', () => {
  assert.equal(abs.isProduced('Dark Age [Dramatized Adaptation]', 'One'), true);
  assert.equal(abs.isProduced('Harry Potter (Full-Cast Edition)', 'One'), true);
  assert.equal(abs.isProduced('GraphicAudio Series', 'One'), true);
  assert.equal(abs.isProduced('Standard Book', 'A, B, C, D'), true);
  assert.equal(abs.isProduced('Standard Book', 'A, B, C'), false);
  assert.equal(abs.isProduced('Standard Book', 'Stephen Fry'), false);

  const prod = abs.mapItem({ id: '1', media: { metadata: { title: 'Book [Dramatized Adaptation]', narratorName: 'Solo' } } });
  assert.equal(prod.produced, true);
  const std = abs.mapItem({ id: '2', media: { metadata: { title: 'Standard Book', narratorName: 'Stephen Fry' } } });
  assert.equal(std.produced, false);
});
