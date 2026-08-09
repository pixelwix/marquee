const test = require('node:test');
const assert = require('node:assert/strict');
const { matchDownloadClient } = require('../lib/downloadClientTest');

const clients = [
  { id: 2, name: 'qBittorrent' },
  { id: 1, name: 'SABnzbd' },
];

test('matchDownloadClient matches a client named in the alert detail, case-insensitively', () => {
  const alert = { title: "Recurring issues in sonarr's logs", detail: 'Sonarr is failing to add releases to qbittorrent (HTTP 409 Conflict on connect).' };
  assert.deepEqual(matchDownloadClient(alert, clients), { id: 2, name: 'qBittorrent' });
});

test('matchDownloadClient matches against the title when the detail alone does not name a client', () => {
  const alert = { title: 'SABnzbd connection failing', detail: 'Unable to reach the download client.' };
  assert.deepEqual(matchDownloadClient(alert, clients), { id: 1, name: 'SABnzbd' });
});

test('matchDownloadClient returns null when no configured client is named at all', () => {
  const alert = { title: 'Prowlarr sync failed', detail: 'Indexer sync returned a 500.' };
  assert.equal(matchDownloadClient(alert, clients), null);
});

test('matchDownloadClient never matches a client that is not actually configured, even if it sounds plausible', () => {
  const alert = { title: 'Deluge connection failing', detail: 'Deluge is unreachable.' };
  assert.equal(matchDownloadClient(alert, clients), null);
});

test('matchDownloadClient handles a missing detail field without throwing', () => {
  const alert = { title: 'qBittorrent issue', detail: null };
  assert.deepEqual(matchDownloadClient(alert, clients), { id: 2, name: 'qBittorrent' });
});
