const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { computeStatus, get, buildKometaYaml, buildAnnouncementPosterSvg } = require('../lib/notice');

// getDb() is lazy — SESSION_DB_DIR only needs to be set before the first real
// query, not before require(). Points this test's first query at a genuinely
// fresh directory (never-before-created notice.sqlite) so it actually
// exercises the CREATE TABLE / first-query race, not a warm connection some
// earlier test already initialized.
test('get() on a truly cold, never-before-opened db does not race the CREATE TABLE', async () => {
  process.env.SESSION_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'marquee-notice-cold-'));
  const row = await get();
  assert.equal(row, null);
});

test('no notice is "none"', () => {
  assert.equal(computeStatus(null, 1000), 'none');
});

test('no startsAt/endsAt means active immediately and forever', () => {
  assert.equal(computeStatus({ message: 'hi', startsAt: null, endsAt: null }, 1000), 'active');
});

test('before startsAt is "scheduled"', () => {
  assert.equal(computeStatus({ message: 'hi', startsAt: 2000, endsAt: null }, 1000), 'scheduled');
});

test('at or after startsAt (no end) is "active"', () => {
  assert.equal(computeStatus({ message: 'hi', startsAt: 1000, endsAt: null }, 1000), 'active');
  assert.equal(computeStatus({ message: 'hi', startsAt: 1000, endsAt: null }, 5000), 'active');
});

test('after endsAt is "expired"', () => {
  assert.equal(computeStatus({ message: 'hi', startsAt: null, endsAt: 1000 }, 1001), 'expired');
});

test('between startsAt and endsAt is "active"', () => {
  assert.equal(computeStatus({ message: 'hi', startsAt: 1000, endsAt: 2000 }, 1500), 'active');
});

test('exactly at endsAt is still "active", one ms later is "expired"', () => {
  assert.equal(computeStatus({ message: 'hi', startsAt: null, endsAt: 2000 }, 2000), 'active');
  assert.equal(computeStatus({ message: 'hi', startsAt: null, endsAt: 2000 }, 2001), 'expired');
});

test('buildKometaYaml appends the "visit the domain" line when a domain is given', () => {
  const yaml = buildKometaYaml('Down for maintenance Monday night.', 'example.com');
  assert.match(yaml, /Down for maintenance Monday night\. Visit example\.com for more info\./);
});

test('buildKometaYaml omits the "visit" line entirely with no domain configured', () => {
  const yaml = buildKometaYaml('Down for maintenance Monday night.', undefined);
  assert.match(yaml, /summary: "Down for maintenance Monday night\."/);
  assert.doesNotMatch(yaml, /Visit/);
});

test('buildKometaYaml escapes quotes and backslashes in the message so the YAML stays valid', () => {
  const yaml = buildKometaYaml('Say "hi" to the \\admin\\ team.', undefined);
  assert.match(yaml, /summary: "Say \\"hi\\" to the \\\\admin\\\\ team\."/);
});

test('buildKometaYaml always includes the fixed collection identity Kometa keys off of', () => {
  const yaml = buildKometaYaml('Anything.', undefined);
  assert.match(yaml, /collections:/);
  assert.match(yaml, /"📌 Server Announcement":/);
  assert.match(yaml, /visible_home: true/);
});

// Regression test for a real failure: Kometa's added.gte/.after filter requires
// an actual calendar date, not a bare day-count — the original "added.gte: 30"
// failed Kometa's own validation on every run (verified live 2026-08-27), so the
// announcement collection silently never built despite Marquee reporting success.
test('buildKometaYaml emits a real YYYY-MM-DD date for the "added" filter, not a bare day-count', () => {
  const yaml = buildKometaYaml('Anything.', undefined, new Date('2026-08-27T12:00:00Z'));
  assert.match(yaml, /added\.gte: "2026-07-28"/);
  assert.doesNotMatch(yaml, /added\.gte: 30/);
});

test('buildKometaYaml points file_poster at the generated announcement poster', () => {
  const yaml = buildKometaYaml('Anything.', undefined);
  assert.match(yaml, /file_poster: config\/marquee-announcement-poster\.png/);
});

// A Home hub row only ever shows title + poster, never the collection summary
// — the poster is the only way the actual message is ever readable without
// clicking in, so these lock down that it always contains real text, not an
// empty or truncated card.
test('buildAnnouncementPosterSvg embeds a short message as a single line of real SVG text', () => {
  const svg = buildAnnouncementPosterSvg('Down tonight.', undefined);
  assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1000" height="1500">/);
  assert.match(svg, /<tspan x="50%" dy="0">Down tonight\.<\/tspan>/);
});

test('buildAnnouncementPosterSvg wraps a long message across multiple tspans', () => {
  const longMessage = 'This is a much longer server announcement message that will not fit on a single line of the generated poster card no matter the font size chosen.';
  const svg = buildAnnouncementPosterSvg(longMessage, undefined);
  const tspanCount = (svg.match(/<tspan /g) || []).length;
  assert.ok(tspanCount > 1, `expected multiple wrapped lines, got ${tspanCount}`);
});

test('buildAnnouncementPosterSvg shrinks its font size for a message near the 500-char cap so it still fits the card', () => {
  const maxMessage = 'A'.repeat(490) + ' end.';
  const svg = buildAnnouncementPosterSvg(maxMessage, undefined);
  const fontSizeMatch = svg.match(/font-size="(\d+)" fill="#f4f4f4"/);
  assert.ok(fontSizeMatch, 'expected to find the message font-size in the SVG');
  assert.ok(Number(fontSizeMatch[1]) < 58, 'expected font size to shrink below the default for a near-cap-length message');
});

test('buildAnnouncementPosterSvg escapes XML-significant characters in the message', () => {
  const svg = buildAnnouncementPosterSvg('Down <now> & "soon".', undefined);
  assert.match(svg, /Down &lt;now&gt; &amp; &quot;soon&quot;\./);
  assert.doesNotMatch(svg, /Down <now>/);
});

test('buildAnnouncementPosterSvg appends the "visit the domain" line the same way buildKometaYaml does', () => {
  // The "visit" sentence can legitimately wrap across separate <tspan> lines
  // (it did for this exact input), so this checks the rendered text with tags
  // stripped rather than a single contiguous string match.
  const svg = buildAnnouncementPosterSvg('Down for maintenance.', 'example.com');
  const renderedText = svg.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(renderedText, /Visit example\.com for more info\./);
});
