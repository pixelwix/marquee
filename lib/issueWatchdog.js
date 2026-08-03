const alerts = require('./alerts');
const overseerrClient = require('./overseerrClient');
const radarrClient = require('./radarrClient');
const sonarrClient = require('./sonarrClient');
const downloadsClient = require('./downloadsClient');
const { annotateAndSort } = require('./stuckRequests');

// Periodically checks the same problem sources already surfaced in /admin's own
// panels (Overseerr open issues, Radarr/Sonarr stuck imports, stuck downloads, stuck
// Wanted/Missing releases) and feeds them into the same alert-reconciliation/push
// pipeline the external arr-health-watchdog.mjs already uses (see lib/alerts.js) —
// so these show up in the same Alerts panel and push exactly once per new/reopened
// problem, never per still-open one. Unlike the arr-watchdog (an external cron
// script, since it checks things outside Marquee entirely), everything here is
// already fetched in-process for these existing panels, so this runs as an
// in-process interval instead — same shape as lib/nowPlaying.js's scheduler.
//
// Deliberately excludes pending requests (routine/frequent, not "something's
// wrong" — the exact kind of thing that made the original, unscoped Web Push
// feature go unused before its v1.5.0 removal).
const INTERVAL_MS = 5 * 60 * 1000; // no LLM calls here, just fast local API reads —
                                    // can afford to check more often than the
                                    // external arr-watchdog's 15-minute cycle.

function log(msg) {
  console.log(`[issueWatchdog] ${msg}`);
}

// Runs one source's fetch+map, appending its scope only on success — a failed
// fetch is logged and simply omitted from `scopes`, so lib/alerts.js's reconcile()
// leaves that source's existing alerts untouched instead of wrongly auto-resolving
// them (same partial-failure safety as arr-health-watchdog.mjs).
async function checkSource(scopeName, fetchFn, mapFn, scopes, newAlerts) {
  try {
    const items = await fetchFn();
    scopes.push(scopeName);
    for (const item of items) newAlerts.push(mapFn(item));
  } catch (err) {
    log(`${scopeName} check failed: ${err.message}`);
  }
}

async function check() {
  const scopes = [];
  const newAlerts = [];

  await checkSource('overseerr:issue', overseerrClient.fetchOpenIssues, i => ({
    key: `overseerr:issue:${i.id}`,
    app: 'overseerr',
    source: 'issue',
    severity: 'warning',
    title: `${i.issueType}: ${i.title || 'Unknown title'}`,
    detail: i.message || null,
    wikiUrl: null,
  }), scopes, newAlerts);

  await checkSource('radarr:import', radarrClient.fetchImportQueue, r => ({
    key: `radarr:import:${r.id}`,
    app: 'radarr',
    source: 'import',
    severity: 'warning',
    title: r.title,
    detail: r.reason || null,
    wikiUrl: null,
  }), scopes, newAlerts);

  await checkSource('sonarr:import', sonarrClient.fetchImportQueue, r => ({
    key: `sonarr:import:${r.id}`,
    app: 'sonarr',
    source: 'import',
    severity: 'warning',
    title: r.title,
    detail: r.reason || null,
    wikiUrl: null,
  }), scopes, newAlerts);

  // Not a 1:1 map — needs downloads.js's own "stuck" filter applied first
  // (item.state !== 'downloading' && item.state !== 'seeding'), same as
  // routes/downloads.js's /queue/attention.
  await checkSource('downloads:attention', async () => {
    const items = await downloadsClient.fetchAll();
    return items.filter(item => item.state !== 'downloading' && item.state !== 'seeding');
  }, d => ({
    key: `downloads:attention:${d.type}-${d.id}`,
    app: 'downloads',
    source: 'attention',
    severity: 'warning',
    title: d.name,
    detail: `${d.type === 'torrent' ? 'Torrent' : 'Usenet'} — ${d.state}`,
    wikiUrl: null,
  }), scopes, newAlerts);

  // Two independent scopes even though both feed the same annotateAndSort() call —
  // a Radarr-only outage must not suppress auto-resolve of already-fixed Sonarr
  // wanted alerts, and vice versa.
  let movies = [];
  try {
    movies = await radarrClient.fetchMissingMovies();
    scopes.push('radarr:wanted');
  } catch (err) {
    log(`radarr:wanted check failed: ${err.message}`);
  }
  let episodes = [];
  try {
    episodes = await sonarrClient.fetchMissingEpisodes();
    scopes.push('sonarr:wanted');
  } catch (err) {
    log(`sonarr:wanted check failed: ${err.message}`);
  }
  for (const item of annotateAndSort([...movies, ...episodes])) {
    if (!item.stuck) continue;
    const isMovie = item.mediaType === 'movie';
    const wantedKey = isMovie ? `m${item.tmdbId}` : `e${item.tvdbId}-${item.season}-${item.episode}`;
    newAlerts.push({
      key: `${isMovie ? 'radarr' : 'sonarr'}:wanted:${wantedKey}`,
      app: isMovie ? 'radarr' : 'sonarr',
      source: 'wanted',
      severity: 'warning',
      title: isMovie ? item.title : `${item.title}${item.season != null ? ` — S${item.season}E${item.episode}` : ''}`,
      detail: `Released ${item.daysSinceRelease}d ago, still no file`,
      wikiUrl: null,
    });
  }

  try {
    const result = await alerts.reconcile({ scopes, alerts: newAlerts });
    log(`checked ${scopes.length} source(s), ${newAlerts.length} open item(s) reported — ${result.open} open in Marquee.`);
  } catch (err) {
    log(`reconcile failed: ${err.message}`);
  }
}

function start() {
  check();
  setInterval(check, INTERVAL_MS);
}

module.exports = { start };
