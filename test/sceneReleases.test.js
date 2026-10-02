const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('parseSceneTitle splits title/year and reads every quality badge from a real release name, including BOTH the provider and the format tag', () => {
  const { parseSceneTitle } = require('../lib/sceneReleases');
  const p = parseSceneTitle('The Uprising 2026 2160p MA WEB-DL DDP5 1 Atmos DV H 265-UPDOWNING');
  assert.equal(p.cleanTitle, 'The Uprising');
  assert.equal(p.year, '2026');
  assert.equal(p.group, 'UPDOWNING');
  const byType = Object.fromEntries(p.badges.filter((b) => b.type !== 'src').map((b) => [b.type, b.text]));
  assert.equal(byType.res, '2160p');
  assert.equal(byType.audio, 'DDP5.1 Atmos');
  assert.equal(byType.hdr, 'DV');
  assert.equal(byType.video, 'H.265');
  const srcTexts = p.badges.filter((b) => b.type === 'src').map((b) => b.text);
  assert.deepEqual(srcTexts, ['MA', 'WEB-DL']);
});

test('parseSceneTitle does not read "NF" out of a release group name (real bug: "H 264-SYNFM" was mislabeled Netflix)', () => {
  const { parseSceneTitle } = require('../lib/sceneReleases');
  const p = parseSceneTitle('The Uprising 2026 720p MA WEB-DL DDP5 1 Atmos H 264-SYNFM');
  assert.equal(p.group, 'SYNFM');
  const srcTexts = p.badges.filter((b) => b.type === 'src').map((b) => b.text);
  assert.deepEqual(srcTexts, ['MA', 'WEB-DL']);
});

test('parseSceneTitle reads a bare "H264" codec tag with no separator (real bug: only "H 264"/"H.264" were recognized)', () => {
  const { parseSceneTitle } = require('../lib/sceneReleases');
  const p = parseSceneTitle('Coyote vs Acme 2026 AMZN WEB H264-MUSiCANA');
  const byType = Object.fromEntries(p.badges.map((b) => [b.type, b.text]));
  assert.equal(byType.video, 'H.264');
});

test('parseSceneTitle handles a plain HD release with no HDR/Atmos tags', () => {
  const { parseSceneTitle } = require('../lib/sceneReleases');
  const p = parseSceneTitle('The Swan Behind the Mirror 2026 1080p WEB H264-SuckMyNonFict');
  assert.equal(p.cleanTitle, 'The Swan Behind the Mirror');
  assert.equal(p.year, '2026');
  const byType = Object.fromEntries(p.badges.map((b) => [b.type, b.text]));
  assert.equal(byType.res, '1080p');
  assert.equal(byType.src, 'WEB');
  assert.equal(byType.hdr, undefined);
  assert.equal(byType.video, 'H.264');
});

test('parseSceneTitle recognizes "DD+" as the same tag as "DDP" (real gap: some real releases use DD+ instead)', () => {
  const { parseSceneTitle } = require('../lib/sceneReleases');
  const p = parseSceneTitle('Virginia Woolfs Night and Day 2026 720p AMZN WEB-DL DD+5 1 H 264-playWEB');
  const byType = Object.fromEntries(p.badges.map((b) => [b.type, b.text]));
  assert.equal(byType.audio, 'DD+5.1');
});

test('parseSceneTitle falls back to the whole string when no year is found', () => {
  const { parseSceneTitle } = require('../lib/sceneReleases');
  const p = parseSceneTitle('Untitled Project WEB-DL');
  assert.equal(p.cleanTitle, 'Untitled Project WEB-DL');
  assert.equal(p.year, null);
});

test('parseFeedXml extracts title/guid/pubDate/poster from a real feed item shape', () => {
  const { parseFeedXml } = require('../lib/sceneReleases');
  const xml = `<rss><channel>
    <item>
      <title>The Uprising 2026 MA WEB H264-MUSiCANA</title>
      <link>https://www.scnsrc.me/the-uprising-2026-ma-web-h264-musicana/</link>
      <pubDate>Tue, 29 Sep 2026 10:18:26 +0000</pubDate>
      <guid isPermaLink="false">https://www.scnsrc.me/?p=546973</guid>
      <description><![CDATA[<p><a href="..."><img src="https://images.scnsrc.me/images/2026/09/29/abc.jpg" alt="poster" height="240" /></a></p>]]></description>
    </item>
  </channel></rss>`;
  const items = parseFeedXml(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'The Uprising 2026 MA WEB H264-MUSiCANA');
  assert.equal(items[0].guid, 'https://www.scnsrc.me/?p=546973');
  assert.equal(items[0].poster, 'https://images.scnsrc.me/images/2026/09/29/abc.jpg');
});

test('parseFeedXml skips an item missing a poster rather than throwing', () => {
  const { parseFeedXml } = require('../lib/sceneReleases');
  const xml = `<item><title>No Poster 2026 WEB</title><pubDate>Tue, 29 Sep 2026 10:00:00 +0000</pubDate><guid>g1</guid><description><![CDATA[no image here]]></description></item>`;
  const items = parseFeedXml(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].poster, null);
});

test('isLowQualityRelease filters CAM and TELESYNC releases', () => {
  const { isLowQualityRelease } = require('../lib/sceneReleases');
  assert.equal(isLowQualityRelease('Tiny Fugitives 2026 720p CAM H264-CinemaCity'), true);
  assert.equal(isLowQualityRelease('The Uprising 2026 TELESYNC MULTi V3 x264-DKS'), true);
  assert.equal(isLowQualityRelease('The Uprising 2026 1080p AMZN WEB-DL DDP5 1 H 264-KyoGo'), false);
});

test('isLowQualityRelease does not false-positive on an unrelated word containing "cam"', () => {
  const { isLowQualityRelease } = require('../lib/sceneReleases');
  assert.equal(isLowQualityRelease('Camden Story 2026 1080p WEB-DL H264-GROUP'), false);
});

test('findTrackedMatch matches a scene release against Radarr\'s library by normalized title + year', () => {
  const { findTrackedMatch } = require('../lib/sceneReleases');
  const radarrMovies = [
    { title: "Virginia Woolf's Night and Day", originalTitle: null, year: 2026, tmdbId: 111 },
    { title: 'Colony', originalTitle: null, year: 2026, tmdbId: 222 },
  ];
  const match = findTrackedMatch('Virginia Woolfs Night and Day', '2026', radarrMovies);
  assert.ok(match);
  assert.equal(match.tmdbId, 111);
});

test('findTrackedMatch returns null when nothing matches', () => {
  const { findTrackedMatch } = require('../lib/sceneReleases');
  const match = findTrackedMatch('Some Brand New Movie', '2026', [{ title: 'Colony', year: 2026, tmdbId: 222 }]);
  assert.equal(match, null);
});

test('findTrackedMatch does not match the same title in a different year', () => {
  const { findTrackedMatch } = require('../lib/sceneReleases');
  const match = findTrackedMatch('Colony', '2019', [{ title: 'Colony', year: 2026, tmdbId: 222 }]);
  assert.equal(match, null);
});

function withTempDataDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marquee-scene-releases-'));
  process.env.SCENE_RELEASES_DATA_DIR = dir;
  delete require.cache[require.resolve('../lib/sceneReleases')];
  const lib = require('../lib/sceneReleases');
  fn(lib);
  delete process.env.SCENE_RELEASES_DATA_DIR;
  delete require.cache[require.resolve('../lib/sceneReleases')];
}

test('mergeIngested dedupes by guid instead of accumulating duplicates on every poll', () => {
  withTempDataDir((lib) => {
    const item = { guid: 'a', raw: 'Movie A 2026 1080p WEB-DL', pubDate: new Date().toISOString() };
    lib.mergeIngested([item]);
    const merged = lib.mergeIngested([item]);
    assert.equal(merged.length, 1);
  });
});

test('mergeIngested drops items older than the retention window', () => {
  withTempDataDir((lib) => {
    const stale = { guid: 'old', raw: 'Old Movie 2020 1080p WEB-DL', pubDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() };
    const fresh = { guid: 'new', raw: 'New Movie 2026 1080p WEB-DL', pubDate: new Date().toISOString() };
    const merged = lib.mergeIngested([stale, fresh]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].guid, 'new');
  });
});

test('mergeIngested sorts newest first', () => {
  withTempDataDir((lib) => {
    const older = { guid: 'older', raw: 'A 2026 1080p WEB-DL', pubDate: new Date(Date.now() - 60000).toISOString() };
    const newer = { guid: 'newer', raw: 'B 2026 1080p WEB-DL', pubDate: new Date().toISOString() };
    const merged = lib.mergeIngested([older, newer]);
    assert.deepEqual(merged.map((m) => m.guid), ['newer', 'older']);
  });
});

test('mergeIngested purges CAM/TELESYNC items already sitting in storage from before the filter existed, not just new ones', () => {
  withTempDataDir((lib) => {
    const camItem = { guid: 'cam1', raw: 'Tiny Fugitives 2026 720p CAM H264-CinemaCity', pubDate: new Date().toISOString() };
    lib.saveItems([camItem]);
    const merged = lib.mergeIngested([{ guid: 'new1', raw: 'Colony 2026 1080p WEB-DL', pubDate: new Date().toISOString() }]);
    assert.equal(merged.some((m) => m.guid === 'cam1'), false);
  });
});
