const test = require('node:test');
const assert = require('node:assert/strict');
const { trimIncompleteTrailingStep } = require('../lib/cliproxyClient');

test('trimIncompleteTrailingStep drops a truncated trailing line', () => {
  const truncated = '1. Check the connection first.\n2. Verify credentials match.\n3. Also check qBittorrent temporarily bans an';
  assert.equal(
    trimIncompleteTrailingStep(truncated),
    '1. Check the connection first.\n2. Verify credentials match.'
  );
});

test('trimIncompleteTrailingStep drops the last line even if it happens to look complete — the cut point is untrustworthy either way', () => {
  const text = '1. Check the connection first.\n2. Verify credentials match.\n3. Restart the container.';
  assert.equal(
    trimIncompleteTrailingStep(text),
    '1. Check the connection first.\n2. Verify credentials match.'
  );
});

test('trimIncompleteTrailingStep leaves a single-line response untouched rather than returning empty', () => {
  const oneLine = '1. Check the connection firs';
  assert.equal(trimIncompleteTrailingStep(oneLine), oneLine);
});

test('trimIncompleteTrailingStep ignores blank lines between steps', () => {
  const withBlanks = '1. Check the connection first.\n\n2. Verify credentials match.\n\n3. Restart the containe';
  assert.equal(
    trimIncompleteTrailingStep(withBlanks),
    '1. Check the connection first.\n2. Verify credentials match.'
  );
});
