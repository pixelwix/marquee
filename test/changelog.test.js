const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../lib/changelog');

test('parses both "-" and "—" version headings, newest first by semver (not file order)', () => {
  const md = '## v1.9.0 — Older\n- [x] a\n\n## v1.10.0 - Newer\n- [x] b\n';
  assert.deepEqual(parse(md).map(v => v.v), ['1.10.0', '1.9.0']);
});

test('strips bold/code/link markdown and checkbox prefixes from bullets', () => {
  const [v] = parse('## v2.0.0 - T\n- [x] **Verified live**: uses `lib/x.js` per [docs](http://e)\n');
  assert.equal(v.items[0], 'Verified live: uses lib/x.js per docs');
});

test('ignores non-version sections like Ideas and the retroactive "v1.1.0 and earlier" block', () => {
  const md = '## v1.1.0 and earlier\n- old\n## v1.2.0 - Real\n- [x] yes\n## Ideas\n- [ ] someday\n';
  const out = parse(md);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].items, ['yes']);
});

test('joins a wrapped bullet continuation line onto the bullet', () => {
  const [v] = parse('## v1.0.0 - T\n- first part\n  second part\n');
  assert.deepEqual(v.items, ['first part second part']);
});
