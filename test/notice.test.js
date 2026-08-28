const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { computeStatus, get, buildKometaYaml, buildAnnouncementPosterSvg, KOMETA_EMPTY_YAML } = require('../lib/notice');

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

// Regression test for two real failures in sequence: (1) added.gte/.after
// requires an actual calendar date, not a bare day-count — "added.gte: 30"
// failed Kometa's own validation on every run (verified live 2026-08-27). (2)
// Even fixed, "match anything recently added" meant Home showed a random
// real movie's poster with none of the actual message on it, because a Home
// hub row always renders the *member item's* own poster/title, never the
// collection's (verified live 2026-08-28 — true for every collection-based
// Home row, not just this one; there's no setting that changes it). Fixed by
// targeting one fixed, dedicated placeholder movie instead of a live search.
test('buildKometaYaml targets the fixed placeholder movie by title, not a live "recently added" search', () => {
  const yaml = buildKometaYaml('Anything.');
  assert.match(yaml, /title: Server Announcement/);
  assert.doesNotMatch(yaml, /added\.gte/);
});

// Regression test for a real, permanent [ERROR] on every single run while no
// notice was active: Kometa treats an empty `collections: {}` dict as invalid
// for any file referenced under collection_files, not as "no collections" —
// it raises "YAML Error: collections or dynamic_collections attribute is
// required" (Failed(...) in Kometa's own meta.py, `not self.collections` on
// an empty dict is true). Verified live 2026-08-28 across every run in
// Kometa's logs while cleared. Fixed by keeping the collection genuinely
// defined but pointed at a plex_search guaranteed to match nothing.
test('KOMETA_EMPTY_YAML defines a real (non-empty) collections block, not collections: {}', () => {
  // Anchored to a whole line so this doesn't false-positive on the doc
  // comment above the constant, which mentions the literal string for context.
  assert.doesNotMatch(KOMETA_EMPTY_YAML, /^collections:\s*\{\}\s*$/m);
  assert.match(KOMETA_EMPTY_YAML, /collections:\s*\n\s+"📌 Server Announcement":/);
  assert.match(KOMETA_EMPTY_YAML, /plex_search:/);
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
