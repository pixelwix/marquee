const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderWelcomeEmail, esc } = require('../lib/welcomeEmailTemplate');

function baseData(overrides = {}) {
  return {
    recipientName: 'sarah',
    inviterName: 'Michael',
    siteName: 'skyn3t',
    requestUrl: 'https://example.com',
    libraries: [{ id: '1', title: 'Movies' }, { id: '3', title: 'TV Shows' }],
    stats: { movies: 4917, series: 1369, addedThisWeek: 66 },
    ...overrides,
  };
}

test('esc escapes the five HTML-significant characters', () => {
  assert.equal(esc(`<script>&"'`), '&lt;script&gt;&amp;&quot;&#39;');
});

test('esc treats null/undefined as an empty string, not the literal text "null"', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('renders the real stats numbers, not placeholders', () => {
  const html = renderWelcomeEmail(baseData());
  assert.match(html, /4,917/);
  assert.match(html, /1,369/);
  assert.match(html, />66</);
});

test('renders the granted library names as the header badge', () => {
  const html = renderWelcomeEmail(baseData());
  assert.match(html, /Access granted: <b>Movies, TV Shows<\/b>/);
});

test('a recipient name containing HTML is escaped, not injected raw', () => {
  const html = renderWelcomeEmail(baseData({ recipientName: '<img src=x onerror=alert(1)>' }));
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('a library title containing HTML is escaped in the header badge', () => {
  const html = renderWelcomeEmail(baseData({ libraries: [{ id: '1', title: '<b>evil</b>' }] }));
  assert.doesNotMatch(html, /Access granted: <b>Movies.*<b>evil<\/b>/);
  assert.match(html, /&lt;b&gt;evil&lt;\/b&gt;/);
});

test('no libraries at all renders no header badge, not a broken empty one', () => {
  const html = renderWelcomeEmail(baseData({ libraries: [] }));
  assert.doesNotMatch(html, /Access granted/);
});

test('the site-check callout links to the real requestUrl, not a hardcoded domain', () => {
  const html = renderWelcomeEmail(baseData({ requestUrl: 'https://example.com' }));
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.match(html, />example\.com</);
});
