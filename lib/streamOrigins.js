const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Durable log of where distinct playback sessions originate from, sourced
// from Tautulli's get_history (not the live get_activity feed nowPlaying.js
// polls). Owner-only: nowPlaying.js's mapSession() deliberately never
// carries ip_address to the shared family dashboard feed, so this is the
// one place in the app that reads it.
//
// Geolocated via Tautulli's own get_geoip_lookup API command, not a local
// database — switched from geoip-lite 2026-08-24 at the owner's request
// after noticing Tautulli's own IP lookup (in its UI) resolves real
// cities/ISPs that geoip-lite's free bundled database just couldn't
// (documented in the old topLocations() comment: ~94% of its city-less
// lookups had no region either, worst on large US carriers). A live
// external geo API (ipapi.co) was tried first and reverted — Tautulli
// already has this exact data locally (it maintains its own real MaxMind
// GeoLite2 database for its own IP-lookup UI feature), so calling its API
// is strictly better than a new third party: no new service ever sees a
// viewer's IP (Tautulli already did, it's the source of ip_address in the
// first place), no external rate limit, and no risk of the endpoint
// landing on a DNS blocklist the way ipapi.co did. geo_cache below still
// means it's a one-time cost per IP ever seen, not a per-session cost —
// no reason to re-ask Tautulli for the same answer twice, even though its
// own lookup is cheap.
//
// get_history, not get_activity: Tautulli's live "session_key" is just an
// ephemeral slot number that gets reused the moment a stream ends, not a
// real per-session identifier — a first pass here recorded straight off
// get_activity keyed by session_key and it only ever showed whatever
// happened to be playing while the server was up, no real year-to-date
// picture (confirmed empirically: 2000 sampled get_activity-driven rows
// collapsed to essentially one session_key). get_history's own
// `reference_id` is the real thing — verified against 2000 real rows:
// every one had a distinct reference_id, and every row sharing a
// reference_id had the exact same ip_address, so it's a safe dedupe key.
//
// Lazy-open. Schema setup (including the one-time migration below) is
// sequenced through a real Promise (`whenReady()`), not sqlite3's own
// implicit per-connection queue — db.run(CREATE TABLE) with no callback
// followed immediately by another db.run() has no ordering guarantee and
// can genuinely race (hit exactly this live on 2026-08-14 in
// diskSpaceHistory.js, and again in this file's first version on
// 2026-08-15). A plain db.serialize() fixes the simple case, but the
// migration here is conditional (check the schema, maybe drop, then
// create) and needs real sequencing, not just a flat statement queue —
// every run()/all() call below awaits whenReady() first, so nothing can
// query ahead of migration finishing regardless of connection internals.
let db = null;
function getDb() {
  if (!db) {
    const dbDir = process.env.SESSION_DB_DIR || '/app/data';
    fs.mkdirSync(dbDir, { recursive: true });
    db = new sqlite3.Database(path.join(dbDir, 'stream-origins.sqlite'));
  }
  return db;
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, function (err) { err ? reject(err) : resolve(this); });
  });
}
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}

// One-time migration: the first version of this table used a non-unique
// `session_key` column (Tautulli's live, reused-slot-number session key —
// see the syncFromHistory()-vs-get_activity comment above). Its handful of
// rows are trivial next to the full year-to-date backfill syncFromHistory()
// does anyway, so on detecting the old shape this just drops and recreates
// rather than migrating data forward.
async function migrate() {
  const cols = await dbAll(`PRAGMA table_info(stream_origins)`);
  if (cols.some(c => c.name === 'session_key')) {
    await dbRun(`DROP TABLE stream_origins`);
  }
  await dbRun(`CREATE TABLE IF NOT EXISTS stream_origins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference_id TEXT NOT NULL UNIQUE,
    city TEXT,
    region TEXT,
    country TEXT,
    lat REAL,
    lon REAL,
    at INTEGER
  )`);
  // Added after the table already existed in production — ALTER TABLE ADD COLUMN
  // (unlike DROP) is safe/idempotent in SQLite and doesn't need the drop-and-
  // recreate treatment the session_key migration above needed. Re-check cols since
  // the CREATE TABLE above is a no-op on an existing table.
  const colsAfterCreate = await dbAll(`PRAGMA table_info(stream_origins)`);
  if (!colsAfterCreate.some(c => c.name === 'region')) {
    await dbRun(`ALTER TABLE stream_origins ADD COLUMN region TEXT`);
  }
  // Same idempotent add — get_history's own friendly_name/user (see
  // syncFromHistory) attributes each origin to the family member who
  // actually streamed from it, so topLocations() can break a place down by
  // who's been streaming from there, not just how many streams. Rows
  // recorded before this column existed just read back NULL, folded into
  // an "Unknown" bucket by topLocations() rather than erroring.
  if (!colsAfterCreate.some(c => c.name === 'username')) {
    await dbRun(`ALTER TABLE stream_origins ADD COLUMN username TEXT`);
  }
  await dbRun(`CREATE TABLE IF NOT EXISTS sync_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_synced_at INTEGER
  )`);
  // One row per distinct IP ever seen, permanent (no TTL/expiry — a
  // residential IP's geolocation doesn't meaningfully drift) so a resync
  // or the initial year-to-date backfill never re-queries Tautulli for an
  // IP it's already resolved. `found = 0` rows (private ranges, or a
  // lookup that genuinely failed) are cached too, for the same reason —
  // without that, a bad/unmappable IP that recurs across many sessions
  // would hit Tautulli's API every single time.
  await dbRun(`CREATE TABLE IF NOT EXISTS geo_cache (
    ip TEXT PRIMARY KEY,
    found INTEGER NOT NULL,
    city TEXT,
    region TEXT,
    country TEXT,
    lat REAL,
    lon REAL,
    fetched_at INTEGER
  )`);
}

let ready = null;
function whenReady() {
  if (!ready) ready = migrate().catch(err => { console.error('[streamOrigins] migration error:', err.message); throw err; });
  return ready;
}

async function run(sql, params = []) {
  await whenReady();
  return dbRun(sql, params);
}
async function all(sql, params = []) {
  await whenReady();
  return dbAll(sql, params);
}

async function getWatermark() {
  const rows = await all(`SELECT last_synced_at FROM sync_state WHERE id = 1`);
  return rows.length ? rows[0].last_synced_at : null;
}

function setWatermark(ts) {
  return run(`INSERT INTO sync_state (id, last_synced_at) VALUES (1, ?)
              ON CONFLICT(id) DO UPDATE SET last_synced_at = excluded.last_synced_at`, [ts]);
}

// Local/LAN sessions have no public IP worth mapping — skip before ever
// touching the cache or Tautulli's lookup. Deliberately conservative
// (private + loopback + link-local, v4 and v6) since asking about one of
// these would just waste a call for a result we'd throw away anyway.
function isPrivateIp(ip) {
  if (/^(10\.|127\.|169\.254\.|192\.168\.)/.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^(::1|fc|fd|fe80)/i.test(ip)) return true;
  return false;
}

// Cache-first: a DB hit (whether previously found or not) never touches the
// network. Only a genuinely new IP calls Tautulli — see the module comment
// above for why that's a one-time cost, not a per-session one.
async function lookupGeo(ipAddress) {
  const cached = await all(`SELECT * FROM geo_cache WHERE ip = ?`, [ipAddress]);
  if (cached.length) {
    const row = cached[0];
    return row.found ? { city: row.city, region: row.region, country: row.country, lat: row.lat, lon: row.lon } : null;
  }
  if (!tautulliConfigured()) return null;

  let result = null;
  try {
    const { data } = await axios.get(`${process.env.TAUTULLI_URL}/api/v2`, {
      params: { apikey: process.env.TAUTULLI_API_KEY, cmd: 'get_geoip_lookup', ip_address: ipAddress }
    });
    const geo = data.response.data;
    // Tautulli's own get_geoip_lookup returns `result: "error"` (private/
    // reserved range, or a genuinely unmappable IP) rather than a non-2xx
    // status — same shape as the get_history/response.data envelope every
    // other Tautulli call in this file already unwraps.
    if (data.response.result === 'success' && typeof geo?.latitude === 'number' && typeof geo?.longitude === 'number') {
      result = {
        city: geo.city || null,
        region: geo.region || null,
        country: geo.country || null,
        lat: geo.latitude,
        lon: geo.longitude,
      };
    }
  } catch (err) {
    console.error('stream-origins geo lookup error:', err.message);
    // Deliberately not cached below — a network/timeout error against our
    // own Tautulli instance is transient (unlike "this IP genuinely can't
    // be mapped"), so let the next occurrence of this IP retry instead of
    // permanently recording it as unfound.
    return null;
  }

  await run(
    `INSERT INTO geo_cache (ip, found, city, region, country, lat, lon, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(ip) DO NOTHING`,
    [ipAddress, result ? 1 : 0, result?.city ?? null, result?.region ?? null, result?.country ?? null, result?.lat ?? null, result?.lon ?? null, Date.now()]
  ).catch(err => console.error('stream-origins geo_cache write error:', err.message));

  return result;
}

// `UNIQUE` on reference_id, upserted (not just ignored) on conflict —
// syncFromHistory()'s overlap window (see SYNC_OVERLAP_MS) relies on this
// being safe to call twice for the same session, and upserting (rather than
// the original INSERT OR IGNORE) means a resync also backfills/corrects a
// row's geo fields — how the `region` column got populated retroactively
// for existing rows after it was added, without needing the original IP
// (never persisted in stream_origins itself) to look it back up.
async function record(referenceId, ipAddress, username = null, at = Date.now()) {
  if (!ipAddress || isPrivateIp(ipAddress)) return;
  const geo = await lookupGeo(ipAddress);
  if (!geo) return;
  await run(
    `INSERT INTO stream_origins (reference_id, city, region, country, lat, lon, username, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(reference_id) DO UPDATE SET
       city = excluded.city, region = excluded.region, country = excluded.country,
       lat = excluded.lat, lon = excluded.lon, username = excluded.username`,
    [String(referenceId), geo.city, geo.region, geo.country, geo.lat, geo.lon, username || null, at]
  ).catch(err => console.error('stream-origins write error:', err.message));
}

// Calendar-year window, not a rolling one — the map resets every Jan 1
// rather than always showing "last 90 days", per how the owner wants this
// read (a year-to-date picture, not a moving average). Computed from the
// current date rather than hardcoded, so next year's reset needs no edit.
function yearStart(now = Date.now()) {
  return new Date(new Date(now).getFullYear(), 0, 1).getTime();
}

// Retains a rolling ~13 months, not just "since Jan 1" — the year-to-date VIEW
// still computes fresh from yearStart() below, but a 90-day range toggle needs raw
// rows to actually reach back 90 days even in, say, February (when Jan 1 is only
// ~45 days back). Pruning by calendar year start would silently truncate that.
const RETENTION_MS = 400 * 24 * 60 * 60 * 1000;

function pruneOld(now = Date.now()) {
  return run(`DELETE FROM stream_origins WHERE at < ?`, [now - RETENTION_MS]).catch(
    err => console.error('stream-origins prune error:', err.message)
  );
}

function tautulliConfigured() {
  return !!(process.env.TAUTULLI_URL && process.env.TAUTULLI_API_KEY);
}

// Full year-to-date backfill only ever happens once, on the very first run
// (no watermark row yet) — a real one, live-tested against this deployment's
// actual Tautulli history: ~16k raw rows, several minutes. Every run after
// that only re-scans a trailing SYNC_OVERLAP_MS window (comfortably wider
// than the 15-minute interval start() calls this on), which cheaply
// self-heals from a missed run or a Tautulli hiccup without redoing the
// whole year — the expensive backfill surviving restarts (persisted in the
// sync_state table, not in memory) is what actually matters, since restarts
// happen on every deploy. INSERT OR IGNORE (see record()) makes the overlap
// safe either way.
const SYNC_OVERLAP_MS = 2 * 60 * 60 * 1000;

async function syncFromHistory() {
  if (!tautulliConfigured()) return;
  const watermark = await getWatermark();
  // Floor matches RETENTION_MS (see pruneOld) — a fresh deployment's first backfill
  // should reach back as far as data actually gets kept, not just to Jan 1.
  const floor = Date.now() - RETENTION_MS;
  const since = watermark ? Math.max(watermark - SYNC_OVERLAP_MS, floor) : floor;
  const afterIso = new Date(since).toISOString().slice(0, 10);
  const seen = new Map(); // reference_id -> { ip, username, at } — last-write-wins is fine, both are constant per session
  const length = 2000;
  let start = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { data } = await axios.get(`${process.env.TAUTULLI_URL}/api/v2`, {
      params: { apikey: process.env.TAUTULLI_API_KEY, cmd: 'get_history', after: afterIso, order_column: 'date', order_dir: 'asc', start, length }
    });
    const rows = data.response.data.data || [];
    for (const r of rows) {
      if (!r.reference_id || !r.ip_address) continue;
      // Same friendly_name-over-user convention as nowPlaying.js's mapSession() —
      // friendly_name is the display name set in Plex, user is the raw account
      // username, used only when no friendly_name is set.
      seen.set(r.reference_id, { ip: r.ip_address, username: r.friendly_name || r.user || null, at: r.date * 1000 });
    }
    start += rows.length;
    if (rows.length < length) break;
  }
  for (const [referenceId, { ip, username, at }] of seen) {
    // eslint-disable-next-line no-await-in-loop
    await record(referenceId, ip, username, at);
  }
  await setWatermark(Date.now());
}

const RANGE_DAYS = { '30d': 30, '90d': 90 };

// 'ytd' resets every Jan 1 (calendar-year window, matching how the owner wants that
// particular view read); '30d'/'90d' are genuine rolling windows — both safe now
// that pruneOld() retains a full ~13 months rather than just since Jan 1. 'all' is
// bounded by whatever pruneOld() has actually kept (~13 months), not a literal
// unbounded history — there's no need for a separate "since epoch" case, `0` already
// satisfies `at >= 0` for every real row.
function rangeStart(range, now = Date.now()) {
  if (range === 'all') return 0;
  const days = RANGE_DAYS[range];
  return days ? now - days * 24 * 60 * 60 * 1000 : yearStart(now);
}

// One row per distinct city+region, most-streamed first, with each place's share of
// the window's total already computed as a percentage (plus the raw count) — the
// admin panel renders this straight through, no client-side math. Grouping by
// averaged lat/lon (not a raw per-row point) keeps a city that resolved to a
// handful of slightly different ISP coordinates from fragmenting into near-
// duplicate dots on the map. `region` is in the GROUP BY too (not just the label)
// — without it, same-named cities in different states (there are a lot of
// "Springfield"s) would incorrectly merge into one bucket.
async function topLocations({ limit = 12, range = 'ytd' } = {}) {
  // Grouped by username too (not just city/region/country) so each place can
  // report who actually streamed from there, not just how many streams —
  // merged back into one row per place in JS below. No SQL-level LIMIT here:
  // the per-place total (which limit/ordering/pct all depend on) isn't known
  // until every username sub-row for that place has been folded together.
  const rows = await all(
    `SELECT city, region, country, username, AVG(lat) AS lat, AVG(lon) AS lon, COUNT(*) AS count
     FROM stream_origins
     WHERE at >= ?
     GROUP BY city, region, country, username
     ORDER BY count DESC`,
    [rangeStart(range)]
  );
  const buckets = new Map();
  for (const r of rows) {
    const key = `${r.city ?? ''} ${r.region ?? ''} ${r.country ?? ''}`;
    let b = buckets.get(key);
    if (!b) {
      b = { city: r.city, region: r.region, country: r.country, latSum: 0, lonSum: 0, count: 0, users: [] };
      buckets.set(key, b);
    }
    // Weighted merge: this place's true AVG(lat/lon) is the count-weighted
    // average of each username sub-row's own already-averaged lat/lon.
    b.latSum += r.lat * r.count;
    b.lonSum += r.lon * r.count;
    b.count += r.count;
    b.users.push({ name: r.username || 'Unknown', count: r.count });
  }
  const places = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map(b => ({
      ...b,
      lat: b.latSum / b.count,
      lon: b.lonSum / b.count,
      users: b.users.sort((a, c) => c.count - a.count)
    }));
  const total = places.reduce((sum, p) => sum + p.count, 0);
  if (!total) return [];
  // Even Tautulli's own lookup can't always resolve a city (VPN exits, some
  // mobile/satellite carrier ranges) or, rarer, a region either — labeling it
  // plainly as "Unresolved" rather than bare "US" avoids the country-level
  // bucket reading as if it were one real, singularly popular place, when
  // it's actually many different unknown locations lumped together by NULL
  // city grouping the same way. A row can also have a region with no city
  // (rarer, but real) — "Region, Country" beats falling all the way back to
  // "Unresolved" when part of the picture is actually known.
  return places.map(r => ({
    place: placeLabel(r),
    lat: r.lat,
    lon: r.lon,
    count: r.count,
    pct: Math.round((r.count / total) * 1000) / 10,
    users: r.users
  }));
}

function placeLabel({ city, region, country }) {
  if (city && region) return `${city}, ${region}, ${country}`;
  if (city) return `${city}, ${country}`;
  if (region) return `${region}, ${country}`;
  return `Unresolved (${country || 'Unknown'})`;
}

const SYNC_INTERVAL_MS = 15 * 60 * 1000;

function start() {
  syncFromHistory().catch(err => console.error('stream-origins sync error:', err.message));
  setInterval(() => syncFromHistory().catch(err => console.error('stream-origins sync error:', err.message)), SYNC_INTERVAL_MS);
  pruneOld();
  setInterval(() => pruneOld(), 24 * 60 * 60 * 1000);
}

module.exports = { record, pruneOld, syncFromHistory, topLocations, start, yearStart, getWatermark, setWatermark };
