const sqlite3 = require('sqlite3');
const sharp = require('sharp');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// A single scheduled announcement (e.g. "down Monday night for maintenance"),
// not a list — one row, always id=1, upserted in place. Separate db file from
// sessions/logins. Opened lazily (not at module load, unlike lib/loginLog.js)
// so computeStatus below stays importable/unit-testable without touching the
// filesystem — SESSION_DB_DIR only actually exists inside the container.
// `ready` is awaited by every query below before touching the connection —
// db.run(CREATE TABLE...) with no callback, immediately followed by another
// .run()/.get() on the same fresh connection, has no ordering guarantee and
// can genuinely race on a truly cold file (hit live in lib/recapUnsubscribes.js
// and lib/streamOrigins.js, which this mirrors).
let db = null;
let ready = null;
function getDb() {
  if (db) return db;
  const dbDir = process.env.SESSION_DB_DIR || '/app/data';
  fs.mkdirSync(dbDir, { recursive: true });
  db = new sqlite3.Database(path.join(dbDir, 'notice.sqlite'));
  ready = new Promise((resolve, reject) => {
    db.run(`CREATE TABLE IF NOT EXISTS notice (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      message TEXT NOT NULL,
      starts_at INTEGER,
      ends_at INTEGER,
      updated_at INTEGER
    )`, (err) => (err ? reject(err) : resolve()));
  });
  return db;
}

async function withDb() {
  const conn = getDb();
  await ready;
  return conn;
}

async function get() {
  const conn = await withDb();
  return new Promise((resolve, reject) => {
    conn.get(
      'SELECT message, starts_at AS startsAt, ends_at AS endsAt, updated_at AS updatedAt FROM notice WHERE id = 1',
      (err, row) => err ? reject(err) : resolve(row || null)
    );
  });
}

// Bind-mount destination for Kometa's config directory (see KOMETA_CONFIG_DIR
// in docker-compose.yml) — same "fixed internal path + env var gate" shape as
// MOUNT_ROOT/MEDIA_MOUNT_DIR in lib/mediaStorage.js. Left unset, the compose
// volume harmlessly re-mounts ./data and this feature just no-ops below.
const KOMETA_CONFIG_MOUNT = '/app/kometa-config';
const KOMETA_ANNOUNCEMENT_PATH = path.join(KOMETA_CONFIG_MOUNT, 'marquee-announcement.yml');
const KOMETA_POSTER_PATH = path.join(KOMETA_CONFIG_MOUNT, 'marquee-announcement-poster.png');
// Referenced from Kometa's own config.yml, which resolves paths relative to
// its /config mount the same way collection_files: config/franchises.yml
// does elsewhere in that file — see KOMETA_ANNOUNCEMENT_PATH's counterpart.
const KOMETA_POSTER_RELATIVE_PATH = 'config/marquee-announcement-poster.png';
// A host-side cron script (scripts/kometa-announcement-trigger.mjs, not part
// of this app) polls for this file every ~60s and, when present, runs a
// scoped `kometa --run --run-collections "📌 Server Announcement"` (9s,
// verified live) then deletes it — Marquee's own container has no Docker
// socket access and can't run that itself. Without this, the collection
// (and so the Home row's very existence) would only update on Kometa's next
// regularly scheduled run, up to ~12h away — the poster content above is
// already instant either way, this only closes the gap for the row
// appearing/disappearing. Content doesn't matter, only that the file exists.
const KOMETA_TRIGGER_PATH = path.join(KOMETA_CONFIG_MOUNT, '.announcement-changed');

// Escapes a value for a YAML double-quoted scalar. The message is free-text
// the owner types (up to 500 chars — see routes/notice.js), so it can contain
// quotes/backslashes that would otherwise break the generated YAML.
function yamlQuote(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Escapes text for placement inside SVG markup — same five characters as
// shared.js's browser-side escapeHtml, applied server-side here since the
// message is free text embedded directly into an SVG <text> element below.
function escapeXml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Greedy word-wrap by character-count estimate — there's no real font-metrics
// context available server-side without rendering, and this is a generated
// system card, not typeset-precision. buildAnnouncementPosterSvg below
// compensates for the estimate by shrinking font size until the wrapped
// result actually fits the poster, rather than trusting this to be exact.
function wrapText(text, maxCharsPerLine) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (let word of words) {
    // A single "word" longer than the whole line (a long unbroken string —
    // no real announcement reads this way, but nothing stops one from being
    // typed) can't be wrapped by the space-splitting logic below at all, and
    // would otherwise silently overflow the poster's width untouched by the
    // font-shrink loop in buildAnnouncementPosterSvg (which only reacts to
    // line *count*, not per-line width) — so it's hard-broken here instead.
    while (word.length > maxCharsPerLine) {
      if (current) { lines.push(current); current = ''; }
      lines.push(word.slice(0, maxCharsPerLine));
      word = word.slice(maxCharsPerLine);
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

const POSTER_WIDTH = 1000;
const POSTER_HEIGHT = 1500;

// Pure — testable without touching the filesystem, same reasoning as
// buildKometaYaml above. Standard 2:3 Plex poster dimensions. A Home hub row
// only ever shows a collection's title + poster, never its summary — so
// without this, "click in to actually read the message" was the only way
// anyone would ever see what the notice said. Font size shrinks in steps
// until the wrapped message actually fits the available height, so a
// message anywhere up to the 500-char cap (see routes/notice.js) still
// renders legibly instead of overflowing the card.
function buildAnnouncementPosterSvg(message, domain = process.env.MARQUEE_DOMAIN) {
  const fullMessage = domain ? `${message} Visit ${domain} for more info.` : message;
  const innerWidth = POSTER_WIDTH - 160;
  const availableHeight = POSTER_HEIGHT - 420; // leaves room for the header label + margins
  let fontSize = 58;
  let lines = [fullMessage];
  while (fontSize > 22) {
    const charsPerLine = Math.max(1, Math.floor(innerWidth / (fontSize * 0.55)));
    lines = wrapText(fullMessage, charsPerLine);
    const lineHeight = fontSize * 1.35;
    if (lines.length * lineHeight <= availableHeight) break;
    fontSize -= 2;
  }
  const lineHeight = fontSize * 1.35;
  const startY = (POSTER_HEIGHT - lines.length * lineHeight) / 2 + fontSize * 0.35 + 60;
  const tspans = lines
    .map((line, i) => `<tspan x="50%" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_WIDTH}" height="${POSTER_HEIGHT}">
  <rect width="100%" height="100%" fill="#12151c"/>
  <rect x="36" y="36" width="${POSTER_WIDTH - 72}" height="${POSTER_HEIGHT - 72}" fill="none" stroke="#e08a1e" stroke-width="4"/>
  <text x="50%" y="180" font-family="DejaVu Sans, sans-serif" font-size="34" font-weight="bold" fill="#e08a1e" text-anchor="middle" letter-spacing="4">SERVER ANNOUNCEMENT</text>
  <text x="50%" y="${startY}" font-family="DejaVu Sans, sans-serif" font-size="${fontSize}" fill="#f4f4f4" text-anchor="middle">${tspans}</text>
</svg>`;
}

// A Home hub row for a collection always renders the *member items'* own
// posters/titles, never the collection's own artwork (confirmed live
// 2026-08-27 — every Home row, including this one, works this way; there is
// no Plex setting that changes it). Grabbing "any recently added movie" for
// the collection meant Home showed a random real movie's poster with none of
// the actual message on it. Fixed by giving the collection a single, fixed,
// dedicated placeholder item to always match instead — see
// ensureAnnouncementMovieRatingKey below for how that item gets created/found
// and uploadAnnouncementPoster for how its OWN poster (not the collection's)
// gets the message text. This constant must match that placeholder's real
// Plex title exactly (confirmed live: Plex parsed the "Server Announcement
// (2026)" library folder down to the bare title "Server Announcement", no
// year — local guid, intentionally unmatched to any real TMDB title).
const ANNOUNCEMENT_MOVIE_TITLE = 'Server Announcement';

// Pure — testable without touching the filesystem. domain defaults to
// MARQUEE_DOMAIN the same way computeStatus below defaults now to Date.now():
// the "impure" read happens once at the call site, not buried in here.
function buildKometaYaml(message, domain = process.env.MARQUEE_DOMAIN) {
  const fullMessage = domain ? `${message} Visit ${domain} for more info.` : message;
  return `# Auto-generated by Marquee's notice board (lib/notice.js) — do not edit by
# hand, it's overwritten on every post and deleted when the notice is cleared.
collections:
  "📌 Server Announcement":
    summary: "${yamlQuote(fullMessage)}"
    file_poster: ${KOMETA_POSTER_RELATIVE_PATH}
    plex_search:
      all:
        title: ${ANNOUNCEMENT_MOVIE_TITLE}
    sync_mode: sync
    limit: 1
    visible_home: true
    visible_shared: true
    visible_library: true
`;
}

// Finds the dedicated placeholder movie's Plex ratingKey by exact title —
// searched live rather than cached, since this only ever runs on a notice
// post/clear (infrequent, and the ratingKey could change if the item is ever
// recreated). Returns null (not throwing) on any failure so a Plex hiccup
// doesn't block saving the notice itself, matching this file's other
// non-fatal Kometa/Plex side effects.
async function findAnnouncementMovieRatingKey() {
  try {
    const { data } = await axios.get(`${process.env.PLEX_SERVER_URL}/search`, {
      headers: { Accept: 'application/json' },
      params: { query: ANNOUNCEMENT_MOVIE_TITLE, 'X-Plex-Token': process.env.PLEX_ADMIN_TOKEN }
    });
    const match = (data.MediaContainer.Metadata || []).find(
      (m) => m.type === 'movie' && m.title === ANNOUNCEMENT_MOVIE_TITLE
    );
    return match ? match.ratingKey : null;
  } catch (err) {
    console.error('notice: could not look up the announcement placeholder movie (non-fatal):', err.message);
    return null;
  }
}

// Uploads the poster directly to the placeholder MOVIE item (not the
// collection — see ANNOUNCEMENT_MOVIE_TITLE above for why that's the one
// that actually shows on Home) via the same raw-bytes POST python-plexapi's
// own uploadPoster(filepath=...) uses under the hood (confirmed by reading
// Kometa's actual installed plexapi source: `POST /library/metadata/{ratingKey}
// /posters` with the image bytes as the body — no multipart wrapper needed).
// This runs immediately from Marquee itself rather than waiting on Kometa's
// next scheduled run (up to ~12h away) — the poster people actually see
// updates the moment the notice is saved.
async function uploadAnnouncementPoster(pngBuffer) {
  const ratingKey = await findAnnouncementMovieRatingKey();
  if (!ratingKey) return;
  try {
    await axios.post(`${process.env.PLEX_SERVER_URL}/library/metadata/${ratingKey}/posters`, pngBuffer, {
      params: { 'X-Plex-Token': process.env.PLEX_ADMIN_TOKEN },
      headers: { 'Content-Type': 'image/png' }
    });
  } catch (err) {
    console.error('notice: could not upload the announcement poster to Plex (non-fatal):', err.message);
  }
}

// This server's Movies library section id — same assumption ANNOUNCEMENT_MOVIE_TITLE
// already makes about this being a specific, known Marquee deployment rather than
// a generic one.
const PLEX_MOVIES_SECTION_ID = 1;

// Deletes the "📌 Server Announcement" collection directly via Plex, rather
// than relying on Kometa to do it. This turned out to matter: the scoped
// `--run-collections "📌 Server Announcement"` trigger (see
// scripts/kometa-announcement-trigger.mjs) works fine for creating/updating
// the collection when it's still defined in marquee-announcement.yml, but on
// clear that file goes to `collections: {}` — the collection is no longer
// defined *at all*, so there's nothing left for `--run-collections` to match,
// and Kometa silently does nothing (verified live 2026-08-28: a real clear
// left the collection sitting in Plex, still showing the last message, with
// no error anywhere). Actually deleting an orphaned collection is normally
// part of Kometa's full per-library cleanup pass, not something a
// single-collection scoped run triggers. Deleting it here directly sidesteps
// that gap entirely — confirmed live: this DELETE removes only the
// collection object, the placeholder movie itself is untouched.
async function deleteAnnouncementCollection() {
  try {
    const { data } = await axios.get(`${process.env.PLEX_SERVER_URL}/library/sections/${PLEX_MOVIES_SECTION_ID}/collections`, {
      headers: { Accept: 'application/json' },
      params: { 'X-Plex-Token': process.env.PLEX_ADMIN_TOKEN }
    });
    const match = (data.MediaContainer.Metadata || []).find((c) => c.title === '📌 Server Announcement');
    if (!match) return;
    await axios.delete(`${process.env.PLEX_SERVER_URL}/library/metadata/${match.ratingKey}`, {
      params: { 'X-Plex-Token': process.env.PLEX_ADMIN_TOKEN }
    });
  } catch (err) {
    console.error('notice: could not delete the announcement collection from Plex (non-fatal):', err.message);
  }
}

// Mirrors the notice into a collection on the Plex Home screen via Kometa —
// see the "Bulletin on the Marquee" plan. Kometa only picks this up on its
// own schedule (not instant), and this deliberately doesn't account for a
// future startsAt: it mirrors whatever was just posted immediately, the same
// way the DB write above does. Non-fatal — a write failure here shouldn't
// block saving the notice itself.
async function writeKometaAnnouncement(message) {
  if (process.env.KOMETA_CONFIG_DIR) {
    try {
      fs.mkdirSync(KOMETA_CONFIG_MOUNT, { recursive: true });
      fs.writeFileSync(KOMETA_ANNOUNCEMENT_PATH, buildKometaYaml(message), 'utf-8');
    } catch (err) {
      console.error('notice: could not write Kometa announcement mirror (non-fatal):', err.message);
    }
  }
  // Rendered once, used two ways: written to the file Kometa's file_poster
  // points at (so the Collections-tab card shows it too), and uploaded
  // straight to the placeholder movie's own poster on Plex directly — that
  // second path is what actually shows on Home, and unlike the Kometa file it
  // takes effect immediately instead of waiting for Kometa's next scheduled
  // run (up to ~12h away). Independent of KOMETA_CONFIG_DIR above: it only
  // needs the placeholder movie to already exist, and no-ops harmlessly
  // (via findAnnouncementMovieRatingKey returning null) if it doesn't.
  let pngBuffer;
  try {
    pngBuffer = await sharp(Buffer.from(buildAnnouncementPosterSvg(message))).png().toBuffer();
  } catch (err) {
    console.error('notice: could not render the announcement poster (non-fatal):', err.message);
    return;
  }
  if (process.env.KOMETA_CONFIG_DIR) {
    try {
      fs.mkdirSync(KOMETA_CONFIG_MOUNT, { recursive: true });
      fs.writeFileSync(KOMETA_POSTER_PATH, pngBuffer);
    } catch (err) {
      console.error('notice: could not write Kometa announcement poster (non-fatal):', err.message);
    }
  }
  await uploadAnnouncementPoster(pngBuffer);
  touchAnnouncementTrigger();
}

// See KOMETA_TRIGGER_PATH above — the actual scoped Kometa run happens on
// the host, outside this app; this just leaves the flag the host-side script
// polls for. Non-fatal and best-effort like every other Kometa side effect
// here: worst case the collection just waits for Kometa's next regular
// scheduled run instead of the ~60s-scoped one. Only called from the post
// path (writeKometaAnnouncement) — see clearKometaAnnouncement's comment for
// why calling this on clear would cause a real Kometa error every time.
function touchAnnouncementTrigger() {
  if (!process.env.KOMETA_CONFIG_DIR) return;
  try {
    fs.mkdirSync(KOMETA_CONFIG_MOUNT, { recursive: true });
    fs.writeFileSync(KOMETA_TRIGGER_PATH, '');
  } catch (err) {
    console.error('notice: could not write the Kometa run-trigger flag (non-fatal):', err.message);
  }
}

// Kometa's own config.yml always references this file's path (see the
// "Bulletin on the Marquee" plan) — deleting it outright would break Kometa's
// next scheduled run on a missing include, so clearing overwrites it with a
// valid empty collection instead of removing it.
// "collections: {}" looks like the obvious way to say "no collection right
// now", but Kometa treats an empty dict as invalid, not as "none defined" —
// any file referenced under collection_files: must have a genuinely non-empty
// collections (or dynamic_collections) attribute, full stop. That raised
// "YAML Error: collections or dynamic_collections attribute is required" as
// a real [ERROR] on every single run while no notice was active (i.e. most
// of the time) — cosmetic (the collection still correctly stayed off Plex,
// this app's own delete already handles that), but permanent noise in
// Kometa's own error reporting. First fix attempt kept a real collection
// block whose plex_search was guaranteed to never match anything real,
// assuming Kometa would just quietly skip it — verified live 2026-08-28
// this was wrong: a plex_search matching zero items raises its own
// Failed("Plex Error: No Items found in Plex"), a *different* real [ERROR]
// every run. Fixed for real using `schedule: never` (the same mechanism
// used for Manga Canon's hourly(10) schedule) — Kometa's schedule_check
// raises NotScheduled before any plex_search ever runs, and that's caught
// with logger.info(), not logger.error() (confirmed in kometa.py's own
// source). delete_not_scheduled: false because this app's direct Plex
// delete on clear already handles removal — no need for Kometa to also try.
const KOMETA_EMPTY_YAML = `# Auto-generated by Marquee's notice board (lib/notice.js) — do not edit by
# hand, it's overwritten on every post and reset here when the notice is
# cleared. No notice is currently posted — schedule: never means Kometa
# skips this collection before ever evaluating a search (see the comment
# above this constant in lib/notice.js for why "collections: {}" and a
# never-matching plex_search both fail differently).
collections:
  "📌 Server Announcement":
    schedule: never
    delete_not_scheduled: false
`;

async function clearKometaAnnouncement() {
  if (process.env.KOMETA_CONFIG_DIR) {
    try {
      fs.mkdirSync(KOMETA_CONFIG_MOUNT, { recursive: true });
      fs.writeFileSync(KOMETA_ANNOUNCEMENT_PATH, KOMETA_EMPTY_YAML, 'utf-8');
    } catch (err) {
      console.error('notice: could not reset Kometa announcement mirror (non-fatal):', err.message);
    }
    try {
      fs.rmSync(KOMETA_POSTER_PATH, { force: true });
    } catch (err) {
      console.error('notice: could not remove Kometa announcement poster (non-fatal):', err.message);
    }
  }
  // Deleted directly rather than triggering Kometa — see
  // deleteAnnouncementCollection's own comment for why a scoped
  // `--run-collections` trigger can't actually do this part anyway. Crucially,
  // do NOT call touchAnnouncementTrigger() here: `--run-collections` runs with
  // Kometa's config.requested_collections set, which makes it skip the
  // `schedule` check entirely (builder.py: `"schedule" in methods and not
  // self.config.requested_collections`) — so KOMETA_EMPTY_YAML's
  // `schedule: never` would never even be evaluated on that path, and Kometa
  // would instead hit "Collection Error: No builders were found" (a real
  // [ERROR]) every time, since the block below has no plex_search/tmdb/etc.
  // left to satisfy that check. Verified live 2026-08-28. schedule: never only
  // works correctly on Kometa's own regular/scheduled full runs, which do
  // respect it — so the fast trigger is POST-only; on clear, the direct
  // delete above is already instant and sufficient.
  await deleteAnnouncementCollection();
}

async function set({ message, startsAt, endsAt }) {
  const conn = await withDb();
  return new Promise((resolve, reject) => {
    conn.run(
      'INSERT OR REPLACE INTO notice (id, message, starts_at, ends_at, updated_at) VALUES (1, ?, ?, ?, ?)',
      [message, startsAt ?? null, endsAt ?? null, Date.now()],
      async err => {
        if (err) return reject(err);
        await writeKometaAnnouncement(message);
        resolve();
      }
    );
  });
}

async function clear() {
  const conn = await withDb();
  return new Promise((resolve, reject) => {
    conn.run('DELETE FROM notice WHERE id = 1', async err => {
      if (err) return reject(err);
      await clearKometaAnnouncement();
      resolve();
    });
  });
}

// Pure — testable without touching the DB. A missing startsAt means "show
// immediately", a missing endsAt means "show until cleared".
function computeStatus(notice, now = Date.now()) {
  if (!notice) return 'none';
  if (notice.startsAt && now < notice.startsAt) return 'scheduled';
  if (notice.endsAt && now > notice.endsAt) return 'expired';
  return 'active';
}

module.exports = { get, set, clear, computeStatus, buildKometaYaml, buildAnnouncementPosterSvg, KOMETA_EMPTY_YAML };
