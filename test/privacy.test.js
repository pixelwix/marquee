const { test } = require('node:test');
const assert = require('node:assert/strict');
const { maskUsername, sanitizeSession, sanitizeLeaderboard, DEFAULT_PRIVACY_CONFIG } = require('../lib/privacy');

function session(overrides = {}) {
  return {
    sessionKey: '1', title: 'Fruits Basket — First Meeting', subtitle: 'S1E1', user: 'BobSmith',
    thumb: 'https://example.com/poster.jpg', progress: 40,
    stream: { player: 'Living Room TV', product: 'Plex for Android', platform: 'Android', decision: 'transcode', bitrateKbps: 8000 },
    ...overrides,
  };
}

test('maskUsername masks cleanly, including edge cases', () => {
  assert.equal(maskUsername('JohnDoe'), 'J***e');
  assert.equal(maskUsername('Al'), 'A***');
  assert.equal(maskUsername(''), 'User ***');
  assert.equal(maskUsername(null), 'User ***');
});

test('sanitizeSession returns the session unchanged for the owner', () => {
  const s = session();
  const owner = { isOwner: true, username: 'Michael' };
  const config = { ...DEFAULT_PRIVACY_CONFIG, streamUserIdentity: 'hide_identity' };
  assert.deepEqual(sanitizeSession(s, owner, config), s);
});

test('sanitizeSession returns the session unchanged for the person actually streaming it', () => {
  const s = session({ user: 'Carol' });
  const self = { isOwner: false, username: 'Carol' };
  const config = { ...DEFAULT_PRIVACY_CONFIG, streamUserIdentity: 'hide_identity' };
  assert.deepEqual(sanitizeSession(s, self, config), s);
});

test('mask_usernames masks the username but leaves the poster (thumb) alone', () => {
  const nonOwner = { isOwner: false, username: 'Carol' };
  const config = { ...DEFAULT_PRIVACY_CONFIG, streamUserIdentity: 'mask_usernames' };
  const result = sanitizeSession(session(), nonOwner, config);
  assert.equal(result.user, 'B***h');
  assert.equal(result.thumb, 'https://example.com/poster.jpg');
});

test('generic_labels replaces the username, still leaves the poster alone', () => {
  const nonOwner = { isOwner: false, username: 'Carol' };
  const config = { ...DEFAULT_PRIVACY_CONFIG, streamUserIdentity: 'generic_labels' };
  const result = sanitizeSession(session(), nonOwner, config);
  assert.equal(result.user, 'Family Member');
  assert.equal(result.thumb, 'https://example.com/poster.jpg');
});

test('hide_identity removes the user field entirely', () => {
  const nonOwner = { isOwner: false, username: 'Carol' };
  const config = { ...DEFAULT_PRIVACY_CONFIG, streamUserIdentity: 'hide_identity' };
  const result = sanitizeSession(session(), nonOwner, config);
  assert.equal(result.user, undefined);
});

test('show_name_only strips the episode title, keeping just the series', () => {
  const nonOwner = { isOwner: false, username: 'Carol' };
  const config = { ...DEFAULT_PRIVACY_CONFIG, streamMediaContent: 'show_name_only' };
  const result = sanitizeSession(session(), nonOwner, config);
  assert.equal(result.title, 'Fruits Basket');
});

test('show_name_only leaves a movie title (no " — " separator) untouched', () => {
  const nonOwner = { isOwner: false, username: 'Carol' };
  const config = { ...DEFAULT_PRIVACY_CONFIG, streamMediaContent: 'show_name_only' };
  const result = sanitizeSession(session({ title: 'The Matrix', subtitle: '1999' }), nonOwner, config);
  assert.equal(result.title, 'The Matrix');
});

test('category_only reduces to a generic Movie/TV label using the subtitle shape', () => {
  const nonOwner = { isOwner: false, username: 'Carol' };
  const config = { ...DEFAULT_PRIVACY_CONFIG, streamMediaContent: 'category_only' };
  const tv = sanitizeSession(session({ subtitle: 'S1E1' }), nonOwner, config);
  const movie = sanitizeSession(session({ title: 'The Matrix', subtitle: '1999' }), nonOwner, config);
  assert.equal(tv.title, 'Watching a TV Show');
  assert.equal(movie.title, 'Watching a Movie');
});

test('blur_artwork keeps the real title but flags blurArtwork for the frontend to blur the poster', () => {
  const nonOwner = { isOwner: false, username: 'Carol' };
  const config = { ...DEFAULT_PRIVACY_CONFIG, streamMediaContent: 'blur_artwork' };
  const result = sanitizeSession(session(), nonOwner, config);
  assert.equal(result.title, session().title);
  assert.equal(result.blurArtwork, true);
});

test('hide_device_info clears player/product/platform but keeps other stream detail', () => {
  const nonOwner = { isOwner: false, username: 'Carol' };
  const config = { ...DEFAULT_PRIVACY_CONFIG, streamTechnical: 'hide_device_info' };
  const result = sanitizeSession(session(), nonOwner, config);
  assert.equal(result.stream.player, null);
  assert.equal(result.stream.product, null);
  assert.equal(result.stream.platform, null);
  assert.equal(result.stream.bitrateKbps, 8000);
});

test('hide_all_technical drops the whole stream object', () => {
  const nonOwner = { isOwner: false, username: 'Carol' };
  const config = { ...DEFAULT_PRIVACY_CONFIG, streamTechnical: 'hide_all_technical' };
  const result = sanitizeSession(session(), nonOwner, config);
  assert.equal(result.stream, undefined);
});

test('sanitizeSession passes through null/undefined without throwing', () => {
  assert.equal(sanitizeSession(null, { isOwner: false }), null);
  assert.equal(sanitizeSession(undefined, { isOwner: false }), undefined);
});

test('sanitizeLeaderboard leaves the list alone for the owner', () => {
  const list = [{ name: 'Alice', plays: 40, avatar: 'a.jpg' }];
  const owner = { isOwner: true };
  const config = { ...DEFAULT_PRIVACY_CONFIG, statsLeaderboard: 'anonymous_leaderboard' };
  assert.deepEqual(sanitizeLeaderboard(list, owner, config), list);
});

test('anonymous_leaderboard replaces names and avatars but keeps play counts', () => {
  const list = [{ name: 'Alice', plays: 40, avatar: 'a.jpg' }, { name: 'Bob', plays: 30, avatar: 'b.jpg' }];
  const nonOwner = { isOwner: false };
  const config = { ...DEFAULT_PRIVACY_CONFIG, statsLeaderboard: 'anonymous_leaderboard' };
  const result = sanitizeLeaderboard(list, nonOwner, config);
  assert.equal(result[0].name, 'User #1');
  assert.equal(result[0].avatar, null);
  assert.equal(result[0].plays, 40);
  assert.equal(result[1].name, 'User #2');
});

test('disable_leaderboard returns an empty list for non-owners', () => {
  const list = [{ name: 'Alice', plays: 40 }];
  const nonOwner = { isOwner: false };
  const config = { ...DEFAULT_PRIVACY_CONFIG, statsLeaderboard: 'disable_leaderboard' };
  assert.deepEqual(sanitizeLeaderboard(list, nonOwner, config), []);
});

test('sanitizeLeaderboard passes non-arrays through unchanged rather than throwing', () => {
  assert.equal(sanitizeLeaderboard(null, { isOwner: false }), null);
});
