const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeShare } = require('../lib/plexShare');

// Real shapes confirmed live against clients.plex.tv/api/v2/shared_servers (see
// lib/plexShare.js's header comment) — captured from Plex's own web app performing
// a real invite, not guessed.
function sharedServer(overrides = {}) {
  return {
    id: 43670236,
    invitedId: null,
    invitedEmail: null,
    owned: true,
    allLibraries: true,
    acceptedAt: null,
    libraries: [
      { id: 131025742, key: 6, title: 'Anime', type: 'show' },
      { id: 131025743, key: 1, title: 'Movies', type: 'movie' },
    ],
    ...overrides,
  };
}

test('normalizeShare uses the resolved account (username/email/id) when one exists', () => {
  const share = normalizeShare(
    sharedServer({ invitedId: 358470 }),
    { id: 358470, username: 'pixelwix', email: 'pixelwix@gmail.com' },
  );
  assert.equal(share.id, '43670236');
  assert.equal(share.username, 'pixelwix');
  assert.equal(share.email, 'pixelwix@gmail.com');
  assert.equal(share.userId, 358470);
});

// A real bug caught live: the API returns `id` as a number, but the frontend's
// escapeHtml() (public/shared.js) requires a string and throws on anything else
// (`str.replace is not a function`) — that broke the entire shares list in the
// admin UI (GET /api/invite/shares returned 200 with good data, but rendering it
// crashed silently). assert.equal alone won't catch this — 43670236 == "43670236"
// is true under loose equality — so this checks the type explicitly.
test('normalizeShare returns id as a string, not the raw API number — escapeHtml() requires a string', () => {
  const share = normalizeShare(sharedServer({ id: 43670236 }));
  assert.equal(typeof share.id, 'string');
  assert.equal(share.id, '43670236');
});

test('normalizeShare falls back to invitedEmail with no username/id when the recipient has no Plex account yet', () => {
  const share = normalizeShare(sharedServer({ invitedEmail: 'newperson@example.com' }), undefined);
  assert.equal(share.username, null);
  assert.equal(share.email, 'newperson@example.com');
  assert.equal(share.userId, null);
});

test('owned and allLibraries coerce to real booleans', () => {
  const share = normalizeShare(sharedServer({ owned: false, allLibraries: false }));
  assert.equal(share.owned, false);
  assert.equal(share.allLibraries, false);
});

test('libraries map to {id, title, type} using the numeric key as id', () => {
  const share = normalizeShare(sharedServer());
  assert.deepEqual(share.libraries, [
    { id: '6', title: 'Anime', type: 'show' },
    { id: '1', title: 'Movies', type: 'movie' },
  ]);
});

test('acceptedAt converts from an ISO string to a JS timestamp', () => {
  const share = normalizeShare(sharedServer({ acceptedAt: '2024-12-01T23:02:45Z' }));
  assert.equal(share.acceptedAt, Date.parse('2024-12-01T23:02:45Z'));
});

test('a pending (not yet accepted) share has no acceptedAt', () => {
  const share = normalizeShare(sharedServer({ acceptedAt: null }));
  assert.equal(share.acceptedAt, null);
});

test('no libraries at all normalizes to an empty array, not a throw', () => {
  const share = normalizeShare(sharedServer({ libraries: undefined }));
  assert.deepEqual(share.libraries, []);
});
