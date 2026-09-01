// Data-computation layer for the monthly recap email — mirrors the split in
// lib/myStats.js (pure, testable compute functions separate from the
// axios/Tautulli fetch calls), but scoped to a specific past calendar month
// instead of "year to date" / "streak counting back from right now", since a
// recap of a month that's already over has no "now" to anchor a live streak
// or a get_home_stats trailing-N-days window to.
const axios = require('axios');
const sharp = require('sharp');
const { computeTopWatched } = require('./myStats');

function tautulliBase() {
  return { base: `${process.env.TAUTULLI_URL}/api/v2`, apikey: process.env.TAUTULLI_API_KEY };
}

// The most recently completed calendar month relative to `now` — e.g. run on
// any day in August, this gives July 1 through Aug 1 (end is exclusive).
// Takes an explicit `now` so a specific month can be requested later (an
// admin "resend last month" action) without duplicating the boundary math.
function previousMonthRange(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1));
  return {
    key: start.toISOString().slice(0, 7),
    startIso: start.toISOString().slice(0, 10),
    startUnix: Math.floor(start.getTime() / 1000),
    endUnix: Math.floor(end.getTime() / 1000),
    label: start.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  };
}

// Tautulli's `before` param turned out fuzzy in testing (spilled a day past
// the requested cutoff, likely a local-timezone-vs-UTC mismatch internally)
// — safer to fetch from `after` alone (the only bound the rest of this
// codebase already relies on) and cut the upper edge ourselves against the
// row's own unix `date`, which isn't ambiguous.
function withinPeriod(row, period) {
  return row.date >= period.startUnix && row.date < period.endUnix;
}

function dayKey(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

// Longest run of consecutive calendar days (UTC) with a play, *within* the
// given rows — not myStats.js's computeStreak, which counts backward from
// "now" and so can't describe a month that's already over.
function computeLongestStreak(historyRows) {
  const days = [...new Set(historyRows.map(r => dayKey(r.date)))].sort();
  if (!days.length) return 0;
  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    const gap = new Date(days[i]) - new Date(days[i - 1]);
    if (gap === 86400000) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }
  return longest;
}

// Same idea as get_home_stats' top_users list (which is how myStats.js's
// live "Family Rank" is computed), but built from raw per-row duration
// across every user in the exact window, since get_home_stats can only
// express "trailing N days from right now", not an arbitrary past month.
function computeMonthlyRank(allUsersRows, userId) {
  const totals = new Map();
  for (const r of allUsersRows) {
    const uid = String(r.user_id);
    totals.set(uid, (totals.get(uid) || 0) + (r.duration || 0));
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const idx = ranked.findIndex(([uid]) => uid === String(userId));
  return { position: idx === -1 ? null : idx + 1, of: ranked.length };
}

async function fetchAllUsersHistory(period) {
  const { base, apikey } = tautulliBase();
  const { data } = await axios.get(base, {
    params: { apikey, cmd: 'get_history', after: period.startIso, length: 10000, order_column: 'date', order_dir: 'asc' },
  });
  const rows = data.response.data.data || [];
  return rows.filter(r => withinPeriod(r, period));
}

async function fetchUserHistory(userId, period) {
  const { base, apikey } = tautulliBase();
  const { data } = await axios.get(base, {
    params: { apikey, cmd: 'get_history', user_id: userId, after: period.startIso, length: 3000, order_column: 'date', order_dir: 'asc' },
  });
  const rows = data.response.data.data || [];
  return rows.filter(r => withinPeriod(r, period));
}

// The one clip a "What You Binged" header image gets built from — whichever
// show/movie the user racked up the most plays on this month. Groups by the
// same rating_key computeTopWatched (myStats.js) uses internally rather than
// matching back against its title string, since two different titles could
// collide on that string in principle. Returns null (not throws) when the
// user had zero plays, so a quiet-month recap can still render without a
// headliner section.
function computeHeadliner(userRows) {
  if (!userRows.length) return null;
  const groups = new Map();
  for (const r of userRows) {
    const key = r.grandparent_rating_key || r.rating_key;
    if (!groups.has(key)) groups.set(key, { title: r.grandparent_title || r.title, ratingKey: key, plays: 0, seconds: 0 });
    const g = groups.get(key);
    g.plays += 1;
    g.seconds += r.duration || 0;
  }
  const top = [...groups.values()].sort((a, b) => b.plays - a.plays)[0];
  return { title: top.title, ratingKey: top.ratingKey, plays: top.plays, hours: Math.round((top.seconds / 3600) * 10) / 10 };
}

// Fetches the headliner's backdrop art, resized, as a data URI ready to
// embed directly in the email — most clients block remote images by
// default, and this is generated fresh per recipient anyway, so there's
// nothing to gain from linking instead of embedding.
//
// Goes through Tautulli's own `pms_image_proxy` (which resizes server-side)
// rather than fetching the original straight from Plex — found live that
// skipping the resize is a real problem, not just a nice-to-have: an
// unresized art image pushed one generated email to ~1.6MB, and POSTing
// that through Tautulli's `notify` API pinned its process at 100% CPU and
// stopped responding to *any* request (including its own live Plex activity
// polling) until the container was restarted. 1200x400 matches what was
// already proven to work end-to-end (~200KB) before this was wired into
// real code.
//
// 2026-09 follow-up: that "~200KB" held for whatever image happened to be
// tested with, but Tautulli's proxy resizes without normalizing format —
// confirmed live it can hand back a PNG straight from Plex's own stored art
// file, and PNG's lossless compression on photographic backdrop art runs
// 5-7x larger than the equivalent JPEG at the same pixel dimensions (one
// real title measured: 472KB as PNG at these exact dimensions, 66-95KB as
// JPEG at quality 70-85). One real recap this size (base64 inflates it
// another ~4/3 on top) pushed a single email to 625KB total and Gmail
// silently clipped/mangled it for that recipient — everything else in the
// template was, and still is, only ~11KB. Always re-encoding to JPEG here
// now, rather than trusting whatever format comes back, with a quality
// ladder and a hard ceiling on the final encoded size so no single image can
// do this again regardless of its own compressibility. Returns null on
// outright failure OR on still being oversized at the lowest quality tried —
// either way degrades to the plain-gradient header (see
// monthlyRecapTemplate.js), never a broken/clipped recap.
const HEADLINER_IMAGE_WIDTH = 1200;
const HEADLINER_IMAGE_HEIGHT = 400;
const HEADLINER_JPEG_QUALITIES = [75, 60, 45, 30];
// Caps the base64-encoded data URI (what actually lands in the HTML and
// counts toward Gmail's ~102KB total-message clipping threshold), not the
// raw JPEG buffer. 75KB leaves ~27KB of headroom under that threshold for
// the rest of the template (measured at ~11KB for a typical recipient, with
// room to grow for a longer top-5/binge list) — tight enough to matter,
// loose enough that most images land a real header within the first couple
// quality steps instead of degrading to the plain gradient unnecessarily.
const HEADLINER_MAX_ENCODED_BYTES = 75 * 1024;

async function fetchHeadlinerImage(ratingKey) {
  if (!ratingKey) return null;
  try {
    const { base, apikey } = tautulliBase();
    const meta = await axios.get(base, { params: { apikey, cmd: 'get_metadata', rating_key: ratingKey } });
    const artPath = meta.data.response.data?.art;
    if (!artPath) return null;
    const { data } = await axios.get(base, {
      params: { apikey, cmd: 'pms_image_proxy', img: artPath, width: HEADLINER_IMAGE_WIDTH, height: HEADLINER_IMAGE_HEIGHT },
      responseType: 'arraybuffer',
    });
    for (const quality of HEADLINER_JPEG_QUALITIES) {
      // eslint-disable-next-line no-await-in-loop
      const jpeg = await sharp(data).jpeg({ quality }).toBuffer();
      const dataUri = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
      if (dataUri.length <= HEADLINER_MAX_ENCODED_BYTES) return dataUri;
    }
    console.error(`monthlyRecap: headliner image for ratingKey ${ratingKey} stayed over ${HEADLINER_MAX_ENCODED_BYTES} bytes even at the lowest quality tried — using the plain header instead`);
    return null;
  } catch (err) {
    console.error('monthlyRecap: headliner image fetch failed:', err.message);
    return null;
  }
}

// Below this many real plays in the month, a recap is mostly empty sections
// (see monthlyRecapTemplate.js's own null-handling for a headliner-less,
// rank-less recap) — not worth sending. This is the hard floor; the owner
// still picks who among the people above it actually gets sent to (see
// routes/recap.js's /candidates + /send), this just keeps genuinely quiet
// months off that list entirely.
const MIN_MONTHLY_PLAYS = 5;

// Pure — takes rows/users already fetched, so it's testable without a
// network call. Cross-references Tautulli's own user list for name/email,
// since fetchAllUsersHistory's rows only carry a user_id.
function computeCandidates(allUsersRows, users, minPlays = MIN_MONTHLY_PLAYS) {
  const totals = new Map();
  for (const r of allUsersRows) {
    const uid = String(r.user_id);
    if (!totals.has(uid)) totals.set(uid, { plays: 0, seconds: 0 });
    const t = totals.get(uid);
    t.plays += 1;
    t.seconds += r.duration || 0;
  }
  const usersById = new Map(users.map((u) => [String(u.user_id), u]));
  return [...totals.entries()]
    .filter(([, t]) => t.plays >= minPlays)
    .map(([userId, t]) => {
      const u = usersById.get(userId) || {};
      return {
        userId,
        name: u.friendly_name || u.username || userId,
        email: u.email || null,
        plays: t.plays,
        hours: Math.round((t.seconds / 3600) * 10) / 10,
      };
    })
    .sort((a, b) => b.plays - a.plays);
}

async function fetchAllUsers() {
  const { base, apikey } = tautulliBase();
  const { data } = await axios.get(base, { params: { apikey, cmd: 'get_users' } });
  return data.response.data || [];
}

async function listRecapCandidates(period = previousMonthRange(), minPlays = MIN_MONTHLY_PLAYS) {
  const [allRows, users] = await Promise.all([fetchAllUsersHistory(period), fetchAllUsers()]);
  return computeCandidates(allRows, users, minPlays);
}

async function fetchUserRecapData(userId, period = previousMonthRange()) {
  const [allRows, userRows] = await Promise.all([
    fetchAllUsersHistory(period),
    fetchUserHistory(userId, period),
  ]);

  const totalSeconds = userRows.reduce((sum, r) => sum + (r.duration || 0), 0);
  const topWatched = computeTopWatched(userRows, 5);
  const headliner = computeHeadliner(userRows);
  const headlinerImageDataUri = await fetchHeadlinerImage(headliner?.ratingKey);

  return {
    period,
    hours: Math.round(totalSeconds / 3600),
    plays: userRows.length,
    streakDays: computeLongestStreak(userRows),
    rank: computeMonthlyRank(allRows, userId),
    topWatched,
    headliner,
    headlinerImageDataUri,
  };
}

module.exports = {
  previousMonthRange,
  computeLongestStreak,
  computeMonthlyRank,
  computeHeadliner,
  computeCandidates,
  fetchHeadlinerImage,
  fetchAllUsersHistory,
  fetchUserHistory,
  fetchUserRecapData,
  fetchAllUsers,
  listRecapCandidates,
  MIN_MONTHLY_PLAYS,
};
