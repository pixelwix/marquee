const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSharedServersXml } = require('../lib/plexShare');

// Real shape confirmed live against plex.tv/api/servers/{machineId}/shared_servers
// (see lib/plexShare.js's header comment) — this is xml2js's parsed output for that
// exact XML, not a guessed shape.
function fixture(overrides = {}) {
  return {
    MediaContainer: {
      SharedServer: [
        {
          $: {
            id: '36778557', username: 'aaburdash', email: 'aaburdash@gmail.com',
            userID: '2056944', owned: '1', allLibraries: '1',
            invitedAt: '1733093309', acceptedAt: '1733093309', ...overrides,
          },
          Section: [
            { $: { id: '131025742', key: '6', title: 'Anime', type: 'show', shared: '1' } },
            { $: { id: '131025743', key: '1', title: 'Movies', type: 'movie', shared: '1' } },
          ],
        },
      ],
    },
  };
}

test('parseSharedServersXml extracts the fields the invite feature needs', () => {
  const [share] = parseSharedServersXml(fixture());
  assert.equal(share.id, '36778557');
  assert.equal(share.username, 'aaburdash');
  assert.equal(share.email, 'aaburdash@gmail.com');
  assert.equal(share.owned, true);
  assert.equal(share.allLibraries, true);
  assert.deepEqual(share.libraries, [
    { id: '6', title: 'Anime', type: 'show' },
    { id: '1', title: 'Movies', type: 'movie' },
  ]);
});

test('owned="0" and allLibraries="0" parse as real booleans, not truthy strings', () => {
  const [share] = parseSharedServersXml(fixture({ owned: '0', allLibraries: '0' }));
  assert.equal(share.owned, false);
  assert.equal(share.allLibraries, false);
});

test('invitedAt/acceptedAt convert from unix seconds to JS milliseconds', () => {
  const [share] = parseSharedServersXml(fixture());
  assert.equal(share.invitedAt, 1733093309000);
  assert.equal(share.acceptedAt, 1733093309000);
});

test('a pending (not yet accepted) share has no acceptedAt', () => {
  const [share] = parseSharedServersXml(fixture({ acceptedAt: undefined }));
  assert.equal(share.acceptedAt, null);
});

test('no shares at all returns an empty array, not a throw', () => {
  assert.deepEqual(parseSharedServersXml({ MediaContainer: {} }), []);
});
