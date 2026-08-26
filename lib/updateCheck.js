const axios = require('axios');
const qbittorrent = require('./qbittorrent');

// Whether each integration is actually up to date, distinct from
// lib/serviceHealth.js's "is it reachable right now" check. Three different
// sources depending on what each app exposes:
//
// - Sonarr/Radarr/Prowlarr (Servarr-family apps) have a native /api/*/update
//   endpoint — their own built-in updater already knows what's installed vs.
//   latest, so this just reads that instead of re-deriving it.
// - Overseerr's own /api/v1/status (already called by serviceHealth.js)
//   already returns updateAvailable/commitsBehind directly.
// - Plex is closed-source with no public "latest version" API of its own —
//   but Tautulli tracks this anyway for its own UI (get_pms_update), so
//   Plex's update status rides on Tautulli being configured instead.
// - Tautulli, qBittorrent, and SABnzbd have no built-in update-check API at
//   all, so these fall back to each project's own GitHub releases.
//
// Every check returns null (not an error) when the integration isn't
// configured or the request fails — same "quietly absent" shape as
// serviceHealth's `unconfigured` status, since an update check is
// meaningless without a reachable, configured service.

// GitHub's unauthenticated API is rate-limited to 60 req/hour, and a
// project's latest release changes at most a few times a month — a long
// in-memory TTL costs nothing real and keeps this well clear of that limit.
// Not persisted: a fresh check on container restart is fine.
const GITHUB_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const githubCache = new Map(); // repo -> { tag, fetchedAt }

function extractVersion(str) {
  const m = String(str || '').match(/\d+(?:\.\d+)+/);
  return m ? m[0] : null;
}

// Numeric, segment-by-segment rather than a string/semver-library compare —
// handles differing segment counts (Sonarr's four-part 4.0.19.2979 vs a
// typical three-part release) by treating a missing trailing segment as 0.
function isNewer(latest, current) {
  const a = latest.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

async function latestGithubTag(repo) {
  const cached = githubCache.get(repo);
  if (cached && Date.now() - cached.fetchedAt < GITHUB_CACHE_TTL_MS) return cached.tag;
  const { data } = await axios.get(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { 'User-Agent': 'marquee-update-check', Accept: 'application/vnd.github+json' },
    timeout: 8000
  });
  const tag = extractVersion(data.tag_name);
  githubCache.set(repo, { tag, fetchedAt: Date.now() });
  return tag;
}

async function fromGithub(repo, currentVersionRaw) {
  const current = extractVersion(currentVersionRaw);
  if (!current) return null;
  const latest = await latestGithubTag(repo);
  if (!latest) return null;
  return { currentVersion: current, latestVersion: latest, updateAvailable: isNewer(latest, current) };
}

// Shared by Sonarr/Radarr/Prowlarr: the response is every update between
// installed and latest, newest first. The installed entry and the latest
// entry are the same one when already up to date, flagged directly rather
// than left for us to infer from position in the list.
function fromArrUpdateList(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const installed = list.find(u => u.installed);
  const latest = list.find(u => u.latest) || list[0];
  if (!installed) return null;
  return {
    currentVersion: installed.version,
    latestVersion: latest.version,
    updateAvailable: installed.version !== latest.version
  };
}

async function checkSonarr() {
  if (!process.env.SONARR_URL || !process.env.SONARR_API_KEY) return null;
  const { data } = await axios.get(`${process.env.SONARR_URL}/api/v3/update`, {
    headers: { 'X-Api-Key': process.env.SONARR_API_KEY }, timeout: 5000
  });
  return fromArrUpdateList(data);
}

async function checkRadarr() {
  if (!process.env.RADARR_URL || !process.env.RADARR_API_KEY) return null;
  const { data } = await axios.get(`${process.env.RADARR_URL}/api/v3/update`, {
    headers: { 'X-Api-Key': process.env.RADARR_API_KEY }, timeout: 5000
  });
  return fromArrUpdateList(data);
}

async function checkProwlarr() {
  if (!process.env.PROWLARR_URL || !process.env.PROWLARR_API_KEY) return null;
  const { data } = await axios.get(`${process.env.PROWLARR_URL}/api/v1/update`, {
    headers: { 'X-Api-Key': process.env.PROWLARR_API_KEY }, timeout: 5000
  });
  return fromArrUpdateList(data);
}

async function checkOverseerr() {
  if (!process.env.OVERSEERR_URL || !process.env.OVERSEERR_API_KEY) return null;
  const { data } = await axios.get(`${process.env.OVERSEERR_URL}/api/v1/status`, {
    headers: { 'X-Api-Key': process.env.OVERSEERR_API_KEY }, timeout: 5000
  });
  // No clean "latest version" string here — Overseerr tracks itself by
  // commit, not a release tag, so commitsBehind is the meaningful number
  // to show instead of a version diff.
  return { currentVersion: data.version, commitsBehind: data.commitsBehind ?? null, updateAvailable: !!data.updateAvailable };
}

// Rides on Tautulli rather than a Plex API of its own — Plex is closed-
// source with no public "latest version" endpoint, but Tautulli already
// tracks this for its own UI. get_pms_update's own `version` field is the
// LATEST available version, not the one currently running, so this also
// needs get_server_info for the current one.
async function checkPlex() {
  if (!process.env.TAUTULLI_URL || !process.env.TAUTULLI_API_KEY) return null;
  const [updateResp, infoResp] = await Promise.all([
    axios.get(`${process.env.TAUTULLI_URL}/api/v2`, { params: { apikey: process.env.TAUTULLI_API_KEY, cmd: 'get_pms_update' }, timeout: 5000 }),
    axios.get(`${process.env.TAUTULLI_URL}/api/v2`, { params: { apikey: process.env.TAUTULLI_API_KEY, cmd: 'get_server_info' }, timeout: 5000 })
  ]);
  if (updateResp.data.response?.result !== 'success' || infoResp.data.response?.result !== 'success') return null;
  const update = updateResp.data.response.data;
  const current = infoResp.data.response.data?.pms_version;
  if (!current) return null;
  return { currentVersion: current, latestVersion: update?.version || null, updateAvailable: !!update?.update_available };
}

async function checkTautulli() {
  if (!process.env.TAUTULLI_URL || !process.env.TAUTULLI_API_KEY) return null;
  const { data } = await axios.get(`${process.env.TAUTULLI_URL}/api/v2`, {
    params: { apikey: process.env.TAUTULLI_API_KEY, cmd: 'get_tautulli_info' }, timeout: 5000
  });
  if (data.response?.result !== 'success') return null;
  return fromGithub('Tautulli/Tautulli', data.response.data?.tautulli_version);
}

async function checkQbittorrent() {
  const hasApiKey = !!process.env.QBITTORRENT_API_KEY;
  const hasUserPass = !!(process.env.QBITTORRENT_USERNAME && process.env.QBITTORRENT_PASSWORD);
  if (!process.env.QBITTORRENT_URL || !(hasApiKey || hasUserPass)) return null;
  const current = await qbittorrent.authedGet('/api/v2/app/version');
  return fromGithub('qbittorrent/qBittorrent', current);
}

async function checkSabnzbd() {
  if (!process.env.SABNZBD_URL || !process.env.SABNZBD_API_KEY) return null;
  const { data } = await axios.get(`${process.env.SABNZBD_URL}/api`, {
    params: { mode: 'version', apikey: process.env.SABNZBD_API_KEY, output: 'json' }, timeout: 5000
  });
  return fromGithub('sabnzbd/sabnzbd', data.version);
}

const CHECKS = {
  plex: checkPlex,
  tautulli: checkTautulli,
  overseerr: checkOverseerr,
  sonarr: checkSonarr,
  radarr: checkRadarr,
  prowlarr: checkProwlarr,
  qbittorrent: checkQbittorrent,
  sabnzbd: checkSabnzbd
};

// Any single service's check failing (network hiccup, unexpected response
// shape) shouldn't blank out the others — same per-service isolation as
// serviceHealth.js's checkAll(), just resolving to null on failure instead
// of an error status, since there's no "Update check" badge state to show
// for a check that itself couldn't run.
async function checkAll() {
  const entries = await Promise.all(
    Object.entries(CHECKS).map(async ([key, fn]) => {
      try {
        return [key, await fn()];
      } catch (err) {
        console.error(`update check error (${key}):`, err.message);
        return [key, null];
      }
    })
  );
  return Object.fromEntries(entries);
}

module.exports = { checkAll, extractVersion, isNewer, fromArrUpdateList };
