const { test } = require('node:test');
const assert = require('node:assert/strict');
const s = require('../lib/bookSuggestions');

const b = (title, extra = {}) => ({ asin: title.replace(/\W/g, '').slice(0, 10).toUpperCase(), title, author: 'Pierce Brown',
  narrator: 'One', narratorCount: 1, availability: 'none', language: 'english', hours: 10, ...extra });

test('readLibrary collects series parts, author counts and owned titles', () => {
  const lib = s.readLibrary([
    { title: 'Red Rising', author: 'Pierce Brown', series: 'Red Rising #1', asin: 'A1' },
    { title: 'Golden Son', author: 'Pierce Brown', series: 'Red Rising #2', asin: 'A2' },
    { title: 'House of Earth and Blood', author: 'Sarah J. Maas', series: 'Crescent City #1', asin: 'A3' }
  ]);
  assert.deepEqual([...lib.series.get('Red Rising').parts], [1, 2]);
  assert.equal(lib.authors.get('Pierce Brown'), 2);
  assert.ok(lib.ownedTitles.has('golden son'));
  assert.ok(lib.ownedAsins.has('A3'));
});

test('bestEdition prefers the dramatized edition and folds split parts into one suggestion', () => {
  const pick = s.bestEdition([
    b('Dark Age'),
    b('Dark Age (2 of 3) [Dramatized Adaptation]', { narratorCount: 12, asin: 'P2' }),
    b('Dark Age (1 of 3) [Dramatized Adaptation]', { narratorCount: 12, asin: 'P1' }),
    b('Dark Age (3 of 3) [Dramatized Adaptation]', { narratorCount: 12, asin: 'P3' })
  ]);
  assert.equal(pick.produced, true);
  assert.equal(pick.title, 'Dark Age [Dramatized Adaptation]');
  assert.deepEqual(pick.parts.map(p => p.asin), ['P1', 'P2', 'P3']);
  assert.equal(pick.complete, true);
});

test('an explicitly dramatized edition beats a multi-narrator standard reading', () => {
  const pick = s.bestEdition([
    b('Dark Age', { narratorCount: 5, asin: 'STD' }),
    b('Dark Age (1 of 2) [Dramatized Adaptation]', { narratorCount: 12, asin: 'P1' }),
    b('Dark Age (2 of 2) [Dramatized Adaptation]', { narratorCount: 12, asin: 'P2' })
  ]);
  assert.deepEqual(pick.parts.map(p => p.asin), ['P1', 'P2']);
});

test('a standard edition of a book owned as full cast is not suggested', () => {
  const lib = s.readLibrary([{ title: 'Harry Potter and the Chamber of Secrets (Full-Cast Edition)', author: 'J.K. Rowling', series: '', asin: 'FC2' }]);
  assert.equal(s.eligible(b('Harry Potter and the Chamber of Secrets, Book 2'), lib), false);
  assert.equal(s.eligible(b('Harry Potter and the Order of the Phoenix (Full-Cast Edition)'), lib), true);
});

test('UK and US titles of the same book count as owned', () => {
  const lib = s.readLibrary([{ title: 'Harry Potter and the Sorcerer’s Stone (Full-Cast Edition)', author: 'J.K. Rowling', series: '', asin: 'SS' }]);
  assert.equal(s.eligible(b("Harry Potter and the Philosopher's Stone (Narrated by Stephen Fry)"), lib), false);
});

test('bestEdition falls back to the standard reading when no produced edition exists', () => {
  const pick = s.bestEdition([b('Mythos', { hours: 9 })]);
  assert.equal(pick.produced, false);
  assert.equal(pick.parts.length, 1);
});

test('eligible drops owned, requested, foreign-language and summary/bundle titles', () => {
  const lib = s.readLibrary([{ title: 'Red Rising', author: 'Pierce Brown', series: '', asin: 'OWN' }]);
  assert.equal(s.eligible(b('Dark Age'), lib), true);
  assert.equal(s.eligible(b('Red Rising'), lib), false);
  assert.equal(s.eligible(b('Dark Age', { availability: 'requested' }), lib), false);
  assert.equal(s.eligible(b('Threshing Day - Edizione Italiana'), lib), false);
  assert.equal(s.eligible(b('Dark Age', { language: 'german' }), lib), false);
  assert.equal(s.eligible(b('Mythos University Omnibus: Books 1-3'), lib), false);
});
