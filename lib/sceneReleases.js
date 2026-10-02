const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');

// Testable the same way lib/alerts.js's SESSION_DB_DIR is: override via env
// before first use to point at a scratch dir in tests, instead of always
// resolving relative to this file.
const DATA_DIR = process.env.SCENE_RELEASES_DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_PATH = path.join(DATA_DIR, 'scene-releases.json');

const FEED_URL = 'https://www.scnsrc.me/category/films/feed/';
// The feed's own <sy:updateFrequency> advertises hourly updates; polling
// every 15 minutes is comfortably inside that without hammering it, same
// spirit as lib/issueWatchdog.js checking faster than the external
// arr-watchdog it complements.
const INTERVAL_MS = 15 * 60 * 1000;
// The feed posts dozens of movie releases a day across every quality variant
// of the same title — the admin panel only ever needs a recent window, not a
// permanent archive.
const MAX_ITEMS = 200;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const RESOLUTIONS = ['2160p', '1080p', '720p', '480p'];
// Real scene names often carry BOTH of these as separate tags on the same
// release ("...2160p MA WEB-DL DDP5 1..." = Movies Anywhere as the provider,
// WEB-DL as the delivery format) — treating them as one slot silently drops
// whichever comes second in a fixed priority list. Extracted independently.
const PROVIDERS = ['AMZN', 'HULU', 'DSNP', 'HMAX', 'ATVP', 'PCOK', 'NF', 'iT', 'MA'];
const FORMATS = ['WEB-DL', 'WEBDL', 'WEB', 'BluRay', 'BDRip', 'HDTV'];
// "DD+" is the same Dolby Digital Plus tag as "DDP", just a different scene
// spelling — found live in real feed data (playWEB's releases use DD+, most
// others use DDP) after the first deploy; without it those releases simply
// showed no audio badge at all.
const AUDIO = [
  'DDP5 1 Atmos', 'DDP5.1 Atmos', 'DDP5 1', 'DDP5.1', 'DDP2 0', 'DDP2.0',
  'DD+5 1', 'DD+5.1', 'DD+2 0', 'DD+2.0',
  'Atmos', 'DTS-HD', 'DTS', 'TrueHD', 'AC3',
];
// The space-separated variants above have the "5 1"/"2 0" in the middle of
// the token ("DDP5 1 Atmos"), not at the end — a trailing-anchored regex
// replace missed them entirely. An explicit map avoids that anchor bug.
const AUDIO_DISPLAY = {
  'DDP5 1 Atmos': 'DDP5.1 Atmos', 'DDP5 1': 'DDP5.1', 'DDP2 0': 'DDP2.0',
  'DD+5 1': 'DD+5.1', 'DD+2 0': 'DD+2.0',
};
const HDR = ['DV HDR', 'HDR10+', 'HDR10', 'HDR', 'DV'];
// Scene names write the codec with a space ("H 265"), a dot ("H.265"), or no
// separator at all ("H264-GROUP") — all three appear in the wild (the bare
// form is common on WEB x264 encodes specifically); missing it left plenty
// of real releases with no video badge at all.
const VIDEO = ['H 265', 'H.265', 'H265', 'x265', 'H 264', 'H.264', 'H264', 'x264', 'AV1'];
const VIDEO_DISPLAY = { 'H 265': 'H.265', H265: 'H.265', 'H 264': 'H.264', H264: 'H.264' };
// Cam/telesync rips are low-effort theater recordings, never something worth
// surfacing here — filtered out entirely at ingest so they never reach the
// admin panel. Kept as a short, explicit list (not a bare "TS", which is
// short enough to risk the same false-positive-substring bug parseSceneTitle
// already hit once with "NF").
const LOW_QUALITY_PATTERNS = ['CAM', 'HDCAM', 'CAMRIP', 'TELESYNC'];

// Maps this file's own FORMATS vocabulary onto the `source` token Radarr's
// quality API uses internally (quality.source, e.g. {resolution:1080,
// source:'bluray'}) — lets matchesAllowedQuality compare a parsed release
// directly against the owner's real, live quality profiles instead of a
// second hardcoded notion of "good quality". WEBRip isn't in FORMATS at all
// (scene names rarely distinguish it from a bare "WEB" tag in practice), so
// a WEBRip release just falls through to the res-only fallback below rather
// than being misclassified as WEBDL.
const FORMAT_TO_SOURCE = {
  BluRay: 'bluray', BDRip: 'bluray',
  'WEB-DL': 'webdl', WEBDL: 'webdl', WEB: 'webdl',
  HDTV: 'tv',
};

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesAny(str, list) {
  return list.some((token) => new RegExp(`(?<![A-Za-z0-9])${escapeRegex(token)}(?![A-Za-z0-9])`).test(str));
}

function isLowQualityRelease(raw) {
  return matchesAny(raw, LOW_QUALITY_PATTERNS);
}

// Real bug caught live: a plain substring check on 'NF' (Netflix) matched
// inside "H 264-SYNFM" (the release GROUP's name), so a release actually
// tagged "MA" got mislabeled as Netflix. Short 2-3 letter provider codes are
// exactly the tokens most likely to collide with an unrelated group name or
// word. Requires non-alphanumeric (or string start/end) on both sides of the
// match instead of a bare substring test.
function extractFirst(str, list) {
  for (const token of list) {
    const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegex(token)}(?![A-Za-z0-9])`);
    if (re.test(str)) return token;
  }
  return null;
}

// Parses a scene-style release name ("The Uprising 2026 2160p MA WEB-DL
// DDP5 1 Atmos DV H 265-UPDOWNING") into a clean title/year plus quality
// badges — pure/testable, no network. Doesn't need to handle every scene
// naming quirk perfectly; good enough to drive the admin panel's display and
// to build a clean Radarr lookup term ("<cleanTitle> <year>").
function parseSceneTitle(raw) {
  const yearMatch = raw.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : null;
  const cleanTitle = year ? raw.slice(0, yearMatch.index).trim() : raw.trim();
  const groupMatch = raw.match(/-([A-Za-z0-9]+)$/);
  const group = groupMatch ? groupMatch[1] : null;

  const res = extractFirst(raw, RESOLUTIONS);
  const provider = extractFirst(raw, PROVIDERS);
  const format = extractFirst(raw, FORMATS);
  const audio = extractFirst(raw, AUDIO);
  const hdr = extractFirst(raw, HDR);
  const video = extractFirst(raw, VIDEO);

  const badges = [
    res && { type: 'res', text: res },
    provider && { type: 'src', text: provider },
    format && { type: 'src', text: format.replace('WEBDL', 'WEB-DL') },
    audio && { type: 'audio', text: AUDIO_DISPLAY[audio] || audio },
    hdr && { type: 'hdr', text: hdr },
    video && { type: 'video', text: VIDEO_DISPLAY[video] || video },
  ].filter(Boolean);

  // res/format ride along separately from badges (which hold display text,
  // post-WEBDL-to-WEB-DL-renaming) — matchesAllowedQuality below needs the
  // raw pre-display values to key into FORMAT_TO_SOURCE.
  return { cleanTitle, year, group, badges, res, format };
}

// Builds the set of "{resolution}-{source}" keys allowed by ANY of the
// owner's Radarr quality profiles (e.g. "1080-bluray", "2160-webdl") — the
// real, current definition of "good enough to grab", read live rather than
// re-encoded as a second hardcoded quality list that could drift out of
// sync with Radarr's own settings. `profiles` is the raw array from
// GET /api/v3/qualityprofile; each profile's `items` mixes individual
// qualities and named groups (a group's own members live in a nested
// `items` array) — both shapes are walked.
function buildAllowedQualitySet(profiles) {
  const allowed = new Set();
  for (const profile of profiles || []) {
    for (const item of profile.items || []) {
      const leaves = item.quality ? [item] : (item.items || []);
      for (const leaf of leaves) {
        if (leaf.allowed && leaf.quality) {
          allowed.add(`${leaf.quality.resolution}-${leaf.quality.source}`);
        }
      }
    }
  }
  return allowed;
}

// Whether a parsed release's resolution+format is actually grabbable under
// at least one of the owner's real quality profiles. A format this file's
// vocabulary didn't recognize (null) doesn't automatically disqualify a
// release — it falls back to "is this resolution allowed under ANY source",
// since hiding a release just because of a parsing-vocabulary gap would be
// a worse failure mode than occasionally showing one that turns out not to
// match exactly.
function matchesAllowedQuality(res, format, allowedQualitySet) {
  if (!allowedQualitySet) return true; // no profiles supplied -- filter disabled
  if (!res) return false; // active filter, but nothing to check it against
  const resolution = parseInt(res, 10);
  const source = format ? FORMAT_TO_SOURCE[format] : null;
  if (source) return allowedQualitySet.has(`${resolution}-${source}`);
  for (const key of allowedQualitySet) {
    if (key.startsWith(`${resolution}-`)) return true;
  }
  return false;
}

// Ranks a release for dedupeByTitle: higher resolution wins outright; within
// the same resolution, Bluray > WebDL/WEB-DL > HDTV > anything unrecognized
// (a reasonable general quality ordering, not pulled from the profile itself
// since Radarr's own profile doesn't expose a single cross-resolution
// ranking to reuse here) — ties broken by whichever was posted most recently.
const SOURCE_RANK = { bluray: 3, webdl: 2, tv: 1 };
function qualityScore(item) {
  const resolution = item.res ? parseInt(item.res, 10) : 0;
  const sourceRank = item.format ? (SOURCE_RANK[FORMAT_TO_SOURCE[item.format]] || 0) : 0;
  return resolution * 10 + sourceRank;
}

// Collapses multiple scene-group releases of the same movie (same title+year
// once normalized) down to the single best one — scnsrc.me routinely posts
// 3-4 variants of one title at different resolutions/groups/sources on the
// same day, which otherwise reads as "too many of the same movie" in the
// panel for no actionable reason once everything shown already passes
// matchesAllowedQuality (any of them would satisfy the owner's profiles). An
// item with no resolved cleanTitle falls back to its own guid as the key —
// never collapsed with anything else — rather than risk conflating two
// genuinely different, merely title-less releases under one blank key.
function dedupeByTitle(items) {
  const bestByKey = new Map();
  for (const item of items) {
    const key = item.cleanTitle ? `${normalizeTitle(item.cleanTitle)}|${item.year || ''}` : item.guid;
    const current = bestByKey.get(key);
    if (!current) {
      bestByKey.set(key, item);
      continue;
    }
    const itemScore = qualityScore(item);
    const currentScore = qualityScore(current);
    if (itemScore > currentScore
      || (itemScore === currentScore && new Date(item.pubDate) > new Date(current.pubDate))) {
      bestByKey.set(key, item);
    }
  }
  return [...bestByKey.values()];
}

// Real bug caught by this file's own test: scene names drop apostrophes
// entirely ("Virginia Woolfs Night and Day" for "Virginia Woolf's..."), not
// replace them with a space — treating them as a generic separator turned
// "Woolf's" into "woolf s" (two words), which never matches the scene
// spelling "woolfs" (one word). Apostrophes are stripped outright, before
// other punctuation gets collapsed to spaces.
function normalizeTitle(str) {
  return str.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Whether this scene release matches a movie Radarr already has, checked
// locally against Radarr's own already-fetched movie list rather than a live
// TMDB search per release — the admin panel can show dozens of releases at
// once, and a real lookup call per one just to decide a button label would
// mean dozens of live TMDB searches on every page load. `radarrMovies` is the
// raw array from GET /api/v3/movie (title, originalTitle, year, tmdbId, ...).
function findTrackedMatch(cleanTitle, year, radarrMovies) {
  const target = normalizeTitle(cleanTitle);
  const targetYear = year ? Number(year) : null;
  for (const m of radarrMovies) {
    if (targetYear != null && m.year && m.year !== targetYear) continue;
    if (normalizeTitle(m.title) === target || (m.originalTitle && normalizeTitle(m.originalTitle) === target)) {
      return m;
    }
  }
  return null;
}

// Minimal regex-based RSS parse — this is a fixed WordPress feed shape (same
// one confirmed live against the real feed before writing this), not
// general-purpose XML, so a full parser dependency isn't worth adding just
// for this one field set.
function parseFeedXml(xml) {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  return items.map((block) => {
    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? null;
    const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? null;
    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? null;
    const guid = block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/)?.[1]?.trim() ?? null;
    const poster = block.match(/<img src="([^"]+)"/)?.[1] ?? null;
    return { title, link, pubDate, guid, poster };
  }).filter((i) => i.title && i.guid && i.pubDate);
}

function loadItems() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveItems(items) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(items, null, 2));
}

// Merges newly-fetched items into storage, deduping by guid (a re-poll of
// the feed always re-sends its current window) and dropping anything past
// MAX_AGE_MS or beyond MAX_ITEMS once sorted newest-first. Also re-applies
// the cam/telesync filter to EXISTING stored items, not just the incoming
// batch — the filter shipped after some had already been ingested, and
// filtering only new items would have left those sitting in the panel until
// they aged out on their own naturally. Same retroactive treatment for the
// quality-profile filter/dedup below: `allowedQualitySet` is optional (omit
// it, as every pre-existing test does, and this step no-ops) so a live
// Radarr-profile fetch is never required just to exercise the rest of this
// function, but `check()` below always supplies the real one.
function mergeIngested(incoming, allowedQualitySet) {
  const existing = loadItems();
  const byGuid = new Map(existing.map((i) => [i.guid, i]));
  for (const item of incoming) {
    if (!item || typeof item.guid !== 'string') continue;
    byGuid.set(item.guid, item);
  }
  const cutoff = Date.now() - MAX_AGE_MS;
  const filtered = [...byGuid.values()]
    .filter((i) => new Date(i.pubDate).getTime() >= cutoff)
    .filter((i) => !isLowQualityRelease(i.raw))
    .filter((i) => matchesAllowedQuality(i.res, i.format, allowedQualitySet));
  const merged = dedupeByTitle(filtered)
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
    .slice(0, MAX_ITEMS);
  saveItems(merged);
  return merged;
}

function log(msg) {
  console.log(`[sceneReleases] ${msg}`);
}

async function check() {
  try {
    const { data: xml } = await axios.get(FEED_URL, {
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Marquee scene-release watcher)' },
    });
    const rawItems = parseFeedXml(xml).filter((i) => !isLowQualityRelease(i.title));
    const parsed = rawItems.map((i) => {
      const { cleanTitle, year, badges, res, format } = parseSceneTitle(i.title);
      return { guid: i.guid, raw: i.title, link: i.link, pubDate: i.pubDate, poster: i.poster, cleanTitle, year, badges, res, format };
    });

    // A Radarr outage here shouldn't take the whole feed-watcher down — fall
    // back to no quality filtering (mergeIngested's existing no-profiles-
    // supplied behavior) rather than skipping the poll entirely, same
    // non-fatal-degrade spirit as routes/sceneReleases.js's own tracked-
    // status lookup.
    let allowedQualitySet = null;
    try {
      const { data: profiles } = await axios.get(`${process.env.RADARR_URL}/api/v3/qualityprofile`, {
        headers: { 'X-Api-Key': process.env.RADARR_API_KEY },
        timeout: 10000,
      });
      allowedQualitySet = buildAllowedQualitySet(profiles);
    } catch (err) {
      log(`could not read Radarr quality profiles, skipping quality filter this round: ${err.message}`);
    }

    const merged = mergeIngested(parsed, allowedQualitySet);
    log(`checked feed, ${parsed.length} item(s) seen (cam/telesync filtered out), ${merged.length} kept (matches a quality profile, deduped per movie).`);
  } catch (err) {
    log(`feed check failed: ${err.message}`);
  }
}

function start() {
  check();
  setInterval(check, INTERVAL_MS);
}

module.exports = {
  parseSceneTitle, parseFeedXml, loadItems, saveItems, mergeIngested, start, check, DATA_PATH,
  isLowQualityRelease, normalizeTitle, findTrackedMatch,
  buildAllowedQualitySet, matchesAllowedQuality, dedupeByTitle,
};
