const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyQueueRecord, isFileFromThisGrab, groupQueueRecordsByEpisode } = require('../lib/grabStatus');

test('classifyQueueRecord reports failed with the joined statusMessages when tracked status is not ok', () => {
  const rec = {
    trackedDownloadStatus: 'warning',
    statusMessages: [{ title: 'x', messages: ['TheXEM needs manual input.'] }],
    downloadId: 'abc-123'
  };
  const result = classifyQueueRecord(rec);
  assert.equal(result.stage, 'failed');
  assert.equal(result.reason, 'TheXEM needs manual input.');
  assert.equal(result.downloadId, 'abc-123');
});

test('classifyQueueRecord falls back to errorMessage when statusMessages is empty', () => {
  const rec = { trackedDownloadStatus: 'error', statusMessages: [], errorMessage: 'Disk full' };
  const result = classifyQueueRecord(rec);
  assert.equal(result.stage, 'failed');
  assert.equal(result.reason, 'Disk full');
});

test('classifyQueueRecord falls back to a generic reason when nothing else is given', () => {
  const rec = { trackedDownloadStatus: 'warning' };
  const result = classifyQueueRecord(rec);
  assert.equal(result.stage, 'failed');
  assert.equal(result.reason, 'Import issue');
});

test('classifyQueueRecord reports importing once the download itself is complete', () => {
  const rec = { trackedDownloadStatus: 'ok', status: 'completed', size: 1000, sizeleft: 0 };
  assert.deepEqual(classifyQueueRecord(rec), { stage: 'importing' });
});

test('classifyQueueRecord reports downloading with progress and eta while still in progress', () => {
  const rec = { trackedDownloadStatus: 'ok', status: 'downloading', size: 1000, sizeleft: 400, timeleft: '00:05:30' };
  const result = classifyQueueRecord(rec);
  assert.equal(result.stage, 'downloading');
  assert.equal(result.progress, 60);
  assert.equal(result.eta, 330);
});

test('classifyQueueRecord handles a missing size gracefully (no progress rather than a crash)', () => {
  const rec = { trackedDownloadStatus: 'ok', status: 'downloading', size: 0, sizeleft: 0 };
  const result = classifyQueueRecord(rec);
  assert.equal(result.stage, 'downloading');
  assert.equal(result.progress, null);
});

test('isFileFromThisGrab assumes yes when no baseline was given', () => {
  assert.equal(isFileFromThisGrab({ dateAdded: '2020-01-01T00:00:00Z' }, 0), true);
});

test('isFileFromThisGrab rejects a file that predates the grab — the "replace a bad file" case', () => {
  const sinceMs = new Date('2026-07-29T12:00:00Z').getTime();
  const file = { dateAdded: '2026-07-01T00:00:00Z' }; // the old file already on disk, unrelated to this grab
  assert.equal(isFileFromThisGrab(file, sinceMs), false);
});

test('isFileFromThisGrab accepts a file added after the grab started', () => {
  const sinceMs = new Date('2026-07-29T12:00:00Z').getTime();
  const file = { dateAdded: '2026-07-29T12:00:05Z' };
  assert.equal(isFileFromThisGrab(file, sinceMs), true);
});

test('isFileFromThisGrab tolerates a small amount of clock skew', () => {
  const sinceMs = new Date('2026-07-29T12:00:00Z').getTime();
  const file = { dateAdded: '2026-07-29T11:59:55Z' }; // 5s "before", within the buffer
  assert.equal(isFileFromThisGrab(file, sinceMs), true);
});

test('isFileFromThisGrab rejects when there is no file at all', () => {
  assert.equal(isFileFromThisGrab(null, Date.now()), false);
});

// Regression coverage for a real season-pack drop: a batch of newly-aired
// episodes all hitting the same "TBA title" rejection at once left Sonarr's
// own queue with several simultaneous records for the SAME episode (the
// original pack's file, plus a competing re-grab), which showed up as the
// identical episode repeated multiple times in both the Import Issues list
// and the Alerts panel — verified live 2026-08-27 against a real "Beauty in
// Black" S3 drop.
test('groupQueueRecordsByEpisode collapses multiple queue records for the same episode into one group', () => {
  const records = [
    { id: 1, episodeId: 501, series: { title: 'Beauty in Black' }, episode: { seasonNumber: 3, episodeNumber: 3 }, statusMessages: [{ messages: ['Episode has a TBA title and recently aired'] }] },
    { id: 2, episodeId: 501, series: { title: 'Beauty in Black' }, episode: { seasonNumber: 3, episodeNumber: 3 }, statusMessages: [{ messages: ['Episode has a TBA title and recently aired'] }] },
    { id: 3, episodeId: 502, series: { title: 'Beauty in Black' }, episode: { seasonNumber: 3, episodeNumber: 4 }, statusMessages: [{ messages: ['Episode has a TBA title and recently aired'] }] }
  ];
  const groups = groupQueueRecordsByEpisode(records);
  assert.equal(groups.length, 2, 'expected S3E3\'s two records to collapse into one group, S3E4 to stay separate');
  const s3e3 = groups.find(g => g.episodeId === 501);
  assert.deepEqual(s3e3.queueIds, [1, 2]);
  assert.match(s3e3.reason, /\(2 pending downloads\)/);
});

test('groupQueueRecordsByEpisode leaves a single-record episode reason unchanged', () => {
  const records = [{ id: 1, episodeId: 501, statusMessages: [{ messages: ['Episode has a TBA title and recently aired'] }] }];
  const groups = groupQueueRecordsByEpisode(records);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].reason, 'Episode has a TBA title and recently aired');
  assert.doesNotMatch(groups[0].reason, /pending downloads/);
});

test('groupQueueRecordsByEpisode dedupes identical rejection messages instead of repeating them', () => {
  const records = [
    { id: 1, episodeId: 501, statusMessages: [{ messages: ['Episode has a TBA title and recently aired'] }] },
    { id: 2, episodeId: 501, statusMessages: [{ messages: ['Episode has a TBA title and recently aired'] }] }
  ];
  const groups = groupQueueRecordsByEpisode(records);
  const occurrences = groups[0].reason.match(/TBA title and recently aired/g) || [];
  assert.equal(occurrences.length, 1, 'expected the identical message to appear once, not once per record');
});

test('groupQueueRecordsByEpisode gives a record with no episode its own group instead of colliding with another', () => {
  const records = [
    { id: 1, episodeId: null, statusMessages: [] },
    { id: 2, episodeId: null, statusMessages: [] }
  ];
  const groups = groupQueueRecordsByEpisode(records);
  assert.equal(groups.length, 2);
});
