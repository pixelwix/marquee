const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.SESSION_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bookreq-'));
process.env.RMAB_URL = 'http://rmab.test';
process.env.RMAB_API_TOKEN = 'rmab_test';

const rmab = require('../lib/rmabClient');
const abbBridge = require('../lib/abbBridge');
const pushNotify = require('../lib/pushNotify');

// Logged fakes for every outside call: RMAB and Web Push.
const calls = [];
rmab.createRequest = async book => { calls.push(['create', book.asin]); return { ok: true, requestId: 'req-' + book.asin, status: 'pending' }; };
rmab.listRequests = async () => { calls.push(['list']); return ['AAAAAAAAA1', 'AAAAAAAAA2', 'AAAAAAAAA5', 'AAAAAAAAA6'].map(a => ({ id: (a === 'AAAAAAAAA5' ? 'existing-' : 'req-') + a, asin: a, status: 'available', searchAttempts: 3 })); };
pushNotify.notifyOwners = async msg => { calls.push(['owners', msg.body]); };
pushNotify.notifyUser = async (uid, msg) => { calls.push(['user', uid, msg.title]); };
const editions = [];
abbBridge.setEdition = async (title, edition) => { editions.push([title, edition]); return true; };

const bookRequests = require('../lib/bookRequests');
const owner = { id: 1, username: 'Owner', isOwner: true };
const family = { id: 2, username: 'Layla', isOwner: false };
const book = asin => ({ asin, title: 'Book ' + asin, author: 'A. Author', cover: 'https://img.test/c.jpg' });

test('mapSearchResult reads availability, hours, series and strips description HTML', () => {
  const r = rmab.mapSearchResult({ asin: 'B0F14KKPH6', title: 'T', author: 'A', durationMinutes: 1044, releaseDate: '2026-03-01', series: 'Harry Potter', seriesPart: '6', description: '<p>Hi&nbsp;there</p>', isRequested: true });
  assert.equal(r.hours, 17.4);
  assert.equal(r.year, '2026');
  assert.equal(r.series, 'Harry Potter #6');
  assert.equal(r.description, 'Hi there');
  assert.equal(r.availability, 'requested');
  assert.equal(rmab.mapSearchResult({ asin: 'x', isAvailable: true, isRequested: true }).availability, 'available');
});

test('describeStatus: awaiting_search is "searching" at first and "stuck" after two days', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  assert.equal(rmab.describeStatus('awaiting_search', '2026-10-19T12:00:00Z', now), 'searching');
  assert.equal(rmab.describeStatus('awaiting_search', '2026-08-29T12:00:00Z', now), 'stuck');
  assert.equal(rmab.describeStatus('awaiting_search', '2026-10-20T11:00:00Z', now, 52), 'stuck');
  assert.equal(rmab.describeStatus('downloaded'), 'available');
  assert.equal(rmab.describeStatus('awaiting_import'), 'downloading');
  assert.equal(rmab.describeStatus('denied'), 'failed');
});

test('owner requests go straight to ReadMeABook', async () => {
  calls.length = 0;
  const v = await bookRequests.create(owner, book('AAAAAAAAA1'));
  assert.deepEqual(calls, [['create', 'AAAAAAAAA1']]);
  assert.equal(v.state, 'searching');
});

test('family requests wait for the owner (push to owner, nothing sent to RMAB) and do not duplicate', async () => {
  calls.length = 0;
  const v = await bookRequests.create(family, book('AAAAAAAAA2'));
  assert.equal(v.state, 'pending');
  assert.deepEqual(calls, [['owners', 'Layla requested Book AAAAAAAAA2']]);
  const again = await bookRequests.create(family, book('AAAAAAAAA2'));
  assert.equal(again.id, v.id);
  const pending = await bookRequests.listPending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].requestedBy, 'Layla');
  assert.ok((await bookRequests.openAsinsForUser(2)).has('AAAAAAAAA2'));
});

test('approve sends to RMAB and tells the requester; decline only tells them', async () => {
  const [p] = await bookRequests.listPending();
  calls.length = 0;
  const v = await bookRequests.approve(p.id);
  assert.equal(v.state, 'searching');
  assert.deepEqual(calls, [['create', 'AAAAAAAAA2'], ['user', '2', 'Book request approved']]);
  assert.equal(await bookRequests.approve(p.id), null, 'already approved');

  const d = await bookRequests.create(family, book('AAAAAAAAA3'));
  calls.length = 0;
  assert.equal(await bookRequests.decline(d.id), true);
  assert.deepEqual(calls, [['user', '2', 'Book request']]);
  const mine = await bookRequests.listForUser(2);
  assert.equal(mine.find(m => m.id === d.id).state, 'declined');
});

test('an RMAB rejection (already in the library) shows as available, not an error', async () => {
  rmab.createRequest = async () => ({ ok: false, reason: 'AlreadyAvailable' });
  const v = await bookRequests.create(owner, book('AAAAAAAAA4'));
  assert.equal(v.state, 'available');
  rmab.createRequest = async b => ({ ok: true, requestId: 'req-' + b.asin, status: 'pending' });
});

test('an owner request whose first send failed is resent when requested again', async () => {
  rmab.createRequest = async () => { throw Object.assign(new Error('401'), { response: { status: 401 } }); };
  await assert.rejects(bookRequests.create(owner, book('AAAAAAAAA6')));
  calls.length = 0;
  rmab.createRequest = async b => { calls.push(['create', b.asin]); return { ok: true, requestId: 'req-' + b.asin, status: 'pending' }; };
  const v = await bookRequests.create(owner, book('AAAAAAAAA6'));
  assert.equal(v.state, 'searching');
  assert.deepEqual(calls, [['create', 'AAAAAAAAA6']]);
});

test('a duplicate of an existing RMAB request follows that request instead of failing', async () => {
  rmab.createRequest = async () => ({ ok: false, reason: 'DuplicateRequest' });
  rmab.findRequestByAsin = async asin => ({ id: 'existing-' + asin, status: 'awaiting_search', searchAttempts: 52 });
  const v = await bookRequests.create(owner, book('AAAAAAAAA5'));
  assert.equal(v.state, 'stuck');
  assert.equal(v.searchAttempts, 52);
  rmab.createRequest = async b => ({ ok: true, requestId: 'req-' + b.asin, status: 'pending' });
});

test('a stuck request whose releases all failed RMAB quality says it needs a manual pick', () => {
  const base = { id: 9, status: 'sent', rmab_status: 'awaiting_search', search_attempts: 5, created_at: Date.now() };
  assert.equal(bookRequests.toView({ ...base, rmab_error: 'No quality matches found. Will retry automatically.' }).needsPick, true);
  assert.equal(bookRequests.toView({ ...base, rmab_error: 'No torrents/nzbs found. Will retry automatically.' }).needsPick, false);
});

test('the edition choice reaches the AudioBook Bay bridge before ReadMeABook, default full cast', async () => {
  editions.length = 0;
  const order = [];
  const realCreate = rmab.createRequest;
  rmab.createRequest = async b => { order.push('rmab'); return { ok: true, requestId: 'req-' + b.asin, status: 'pending' }; };
  abbBridge.setEdition = async (title, edition) => { order.push('bridge'); editions.push([title, edition]); return true; };
  const v = await bookRequests.create(owner, { ...book('AAAAAAAAA7'), edition: 'narrated' });
  assert.deepEqual(order, ['bridge', 'rmab']);
  assert.deepEqual(editions, [['Book AAAAAAAAA7', 'narrated']]);
  assert.equal(v.edition, 'narrated');
  editions.length = 0;
  await bookRequests.create(owner, book('AAAAAAAAA8'));
  assert.deepEqual(editions, [['Book AAAAAAAAA8', 'produced']]);
  rmab.createRequest = realCreate;
});

test('a bridge failure does not block the request', async () => {
  abbBridge.setEdition = async () => { throw new Error('bridge down'); };
  const v = await bookRequests.create(owner, book('AAAAAAAAA9'));
  assert.equal(v.state, 'searching');
  abbBridge.setEdition = async (title, edition) => { editions.push([title, edition]); return true; };
});

test('sync mirrors RMAB status and notifies each requester exactly once when available', async () => {
  calls.length = 0;
  await bookRequests.sync();
  assert.equal(calls.filter(c => c[0] === 'list').length, 1, 'one list call per sync, not one per request');
  const notified = calls.filter(c => c[0] === 'user').map(c => c[1]).sort();
  assert.deepEqual(notified, ['1', '1', '1', '2']); // owner: AAAAAAAAA1, the retried AAAAAAAAA6, the linked AAAAAAAAA5; family: AAAAAAAAA2
  assert.equal((await bookRequests.listForUser(1)).find(b => b.asin === 'AAAAAAAAA1').state, 'available');
  calls.length = 0;
  await bookRequests.sync();
  assert.equal(calls.filter(c => c[0] === 'user').length, 0, 'nobody is notified twice');
});
