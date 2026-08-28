const sqlite3 = require('sqlite3');
const sharp = require('sharp');
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

// Pure — testable without touching the filesystem. domain defaults to
// MARQUEE_DOMAIN and now defaults to Date.now() the same way computeStatus
// below does: the "impure" read happens once at the call site, not buried in here.
//
// plex_search just needs to match *something* (limit: 1 below then grabs
// whatever it finds so the collection has a poster to hijack for the
// announcement text) — added.gte/.after is Kometa's "date this or later"
// filter and requires an actual calendar date (YYYY-MM-DD), not a bare
// day-count. Passing 30 literally (the original bug) failed Kometa's own
// date validation every run, so the announcement collection never built —
// verified live 2026-08-27: "Collection Error: added.after: 30 must match
// pattern YYYY-MM-DD". Computing "30 days ago" here keeps the original
// "recently added" intent while giving Kometa a real date.
function buildKometaYaml(message, domain = process.env.MARQUEE_DOMAIN, now = new Date()) {
  const fullMessage = domain ? `${message} Visit ${domain} for more info.` : message;
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().slice(0, 10);
  return `# Auto-generated by Marquee's notice board (lib/notice.js) — do not edit by
# hand, it's overwritten on every post and deleted when the notice is cleared.
collections:
  "📌 Server Announcement":
    summary: "${yamlQuote(fullMessage)}"
    file_poster: ${KOMETA_POSTER_RELATIVE_PATH}
    plex_search:
      any:
        added.gte: "${thirtyDaysAgoStr}"
    limit: 1
    visible_home: true
    visible_shared: true
    visible_library: true
`;
}

// Mirrors the notice into a collection on the Plex Home screen via Kometa —
// see the "Bulletin on the Marquee" plan. Kometa only picks this up on its
// own schedule (not instant), and this deliberately doesn't account for a
// future startsAt: it mirrors whatever was just posted immediately, the same
// way the DB write above does. Non-fatal — a write failure here shouldn't
// block saving the notice itself.
async function writeKometaAnnouncement(message) {
  if (!process.env.KOMETA_CONFIG_DIR) return;
  try {
    fs.mkdirSync(KOMETA_CONFIG_MOUNT, { recursive: true });
    fs.writeFileSync(KOMETA_ANNOUNCEMENT_PATH, buildKometaYaml(message), 'utf-8');
  } catch (err) {
    console.error('notice: could not write Kometa announcement mirror (non-fatal):', err.message);
  }
  // The poster is what actually makes the message readable from Home (a hub
  // row only ever shows title + poster, never the summary above) — separate
  // try/catch so a poster-render failure never blocks the yml write that
  // already worked, or vice versa.
  try {
    await sharp(Buffer.from(buildAnnouncementPosterSvg(message))).png().toFile(KOMETA_POSTER_PATH);
  } catch (err) {
    console.error('notice: could not write Kometa announcement poster (non-fatal):', err.message);
  }
}

// Kometa's own config.yml always references this file's path (see the
// "Bulletin on the Marquee" plan) — deleting it outright would break Kometa's
// next scheduled run on a missing include, so clearing overwrites it with a
// valid empty collection instead of removing it.
const KOMETA_EMPTY_YAML = `# Auto-generated by Marquee's notice board (lib/notice.js) — do not edit by
# hand, it's overwritten on every post and reset here when the notice is
# cleared. Empty (no collections) means no notice is currently posted.
collections: {}
`;

function clearKometaAnnouncement() {
  if (!process.env.KOMETA_CONFIG_DIR) return;
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
    conn.run('DELETE FROM notice WHERE id = 1', err => {
      if (err) return reject(err);
      clearKometaAnnouncement();
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

module.exports = { get, set, clear, computeStatus, buildKometaYaml, buildAnnouncementPosterSvg };
