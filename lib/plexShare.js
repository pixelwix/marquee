// Plex library-sharing operations — inviting someone to the server with access to
// specific libraries only, and managing who already has access. Two different Plex
// APIs are involved, same split routes/auth.js's isAllowedOnServer already relies on:
//   - the LOCAL server (PLEX_SERVER_URL + PLEX_ADMIN_TOKEN) for library metadata —
//     same host routes/plex.js already talks to for search/images.
//   - plex.tv's CLOUD API for the actual sharing relationship — shares are a
//     plex.tv-mediated thing, not something the local server tracks on its own.
//
// The real, working host+shape for the cloud side was confirmed live by capturing
// Plex's own web app (app.plex.tv) performing a real invite in the browser, then
// cross-checking the resulting share against plex.tv's API directly. It is NOT what
// any third-party doc (python-plexapi, community OpenAPI specs) describes — every
// one of those was tried first and every one 404'd. The two things they all got
// wrong: the host is `clients.plex.tv`, not `plex.tv`; and auth + device identity
// (X-Plex-Token, X-Plex-Client-Identifier, etc.) go as URL QUERY PARAMS, not
// headers — sending them as headers is what produced the 404s. Confirmed via a real
// invite's `POST https://clients.plex.tv/api/v2/shared_servers` (201) and its
// resulting share read back whole via `GET .../shared_servers/{id}`.
const axios = require('axios');

const V2_SHARED_SERVERS = 'https://clients.plex.tv/api/v2/shared_servers';
const V2_SERVERS = 'https://clients.plex.tv/api/v2/servers';

function plexAuthParams() {
  return {
    'X-Plex-Product': 'Marquee',
    'X-Plex-Client-Identifier': process.env.PLEX_CLIENT_ID,
    'X-Plex-Token': process.env.PLEX_ADMIN_TOKEN,
  };
}

/** Real library sections on this server — populates the invite form's checkboxes
 * and is the source of truth any submitted library IDs get validated against
 * server-side, never trusted as-given from a client. */
async function getLibraries() {
  const { data } = await axios.get(`${process.env.PLEX_SERVER_URL}/library/sections`, {
    headers: { Accept: 'application/json' },
    params: { 'X-Plex-Token': process.env.PLEX_ADMIN_TOKEN },
  });
  return (data.MediaContainer.Directory || []).map((d) => ({ id: d.key, title: d.title, type: d.type }));
}

/** The write API's `librarySectionIds` field wants a completely different numbering
 * scheme than everything else in this file — confirmed live by capturing a real
 * invite's request body: `[131025743]` for "Movies", not `1` (the local server's
 * section `key`, what getLibraries()/the admin UI/every read in this file otherwise
 * uses). This was the actual reason inviteUser() 404'd even after every other part
 * of the request (host, auth style, body shape) had been fixed — a structurally
 * valid request pointing at a library id that doesn't exist in the cloud API's own
 * numbering. `GET /api/v2/servers/{machineId}` returns both `key` and `id` together
 * per section, independent of any existing share, so it's the reliable source for
 * this translation rather than scraping it out of an existing share's data. */
async function getLibraryKeyToCloudId() {
  const { data } = await axios.get(`${V2_SERVERS}/${process.env.PLEX_MACHINE_ID}`, {
    params: plexAuthParams(), headers: { Accept: 'application/json' },
  });
  return new Map((data.librarySections || []).map((s) => [String(s.key), s.id]));
}

async function toCloudLibraryIds(librarySectionIds) {
  const keyToCloudId = await getLibraryKeyToCloudId();
  return librarySectionIds.map((key) => {
    const cloudId = keyToCloudId.get(String(key));
    if (cloudId == null) throw Object.assign(new Error(`No cloud library id found for section key ${key}`), { status: 502 });
    return cloudId;
  });
}

/** Pure — turns one of plex.tv's raw `shared_server` objects (same shape whether it
 * came from the accepted list or nested inside a pending invite) into the flat shape
 * the rest of this app uses. `invitedAccount` is the resolved Plex account for this
 * share when one exists (present directly on an accepted entry; only present at the
 * parent invite level for a still-pending one) — absent entirely for a pending
 * invite sent to an email with no Plex account yet. */
function normalizeShare(shared, invitedAccount) {
  return {
    id: String(shared.id),
    username: invitedAccount?.username || null,
    email: invitedAccount?.email || shared.invitedEmail || null,
    userId: shared.invitedId || invitedAccount?.id || null,
    owned: !!shared.owned,
    allLibraries: !!shared.allLibraries,
    libraries: (shared.libraries || []).map((l) => ({ id: String(l.key), title: l.title, type: l.type })),
    acceptedAt: shared.acceptedAt ? new Date(shared.acceptedAt).getTime() : null,
  };
}

/** Everyone currently shared on this server (accepted) plus everyone with a pending
 * invite — same underlying plex.tv data routes/auth.js's isAllowedOnServer already
 * reads for the login check, normalized here into per-share library detail. */
async function getSharedUsers() {
  const params = plexAuthParams();
  const [{ data: accepted }, { data: pending }] = await Promise.all([
    axios.get(`${V2_SHARED_SERVERS}/owned/accepted`, { params, headers: { Accept: 'application/json' } }),
    axios.get(`${V2_SHARED_SERVERS}/invites/owned/pending`, { params, headers: { Accept: 'application/json' } }),
  ]);
  const fromAccepted = accepted.map((s) => normalizeShare(s, s.invited));
  const fromPending = pending.flatMap((item) => (item.sharedServers || []).map((s) => normalizeShare(s, item.invited)));
  return [...fromAccepted, ...fromPending];
}

/** Invites someone by email with access to exactly the given library IDs. Plex sends
 * its own invite email/notification to the recipient; the caller (routes/invite.js)
 * separately sends the Marquee-branded welcome email through lib/mailer.js.
 * The real first invite (pixelwix@gmail.com) was sent via the browser, not this
 * function — the request BODY was never actually captured at the time (the network
 * inspection tool only exposes method/URL/status, not payloads), so this shape was
 * reconstructed from docs and was WRONG (missing `skipFriendship`,
 * `allowSubtitleAdmin`, `filterPhotos`, and defaulting `allowSync` to false) —
 * confirmed by every real call 404ing with the same "endpoint not found" error the
 * host/auth-style fix was originally chasing, which was actually this app's malformed
 * body never reaching real request validation at all. Fixed by intercepting
 * window.fetch/XHR in the browser and re-triggering a real (if duplicate, since
 * pixelwix is already shared) invite — the resulting request came back a real `422`
 * ("already sharing with pixelwix"), proving this exact shape is what Plex's own web
 * client sends and that it's structurally valid — the request still failed for
 * every *real* library selection until getLibraryKeyToCloudId() (below) was added,
 * since librarySectionIds needed cloud ids, not the local section keys this function
 * was given. */
async function inviteUser({ email, librarySectionIds }) {
  const body = {
    invitedEmail: email,
    machineIdentifier: process.env.PLEX_MACHINE_ID,
    librarySectionIds: await toCloudLibraryIds(librarySectionIds),
    settings: {
      allowSync: true, allowChannels: false, allowSubtitleAdmin: false, allowTuners: 0,
      filterMovies: '', filterMusic: '', filterPhotos: '', filterTelevision: '',
    },
    skipFriendship: true,
  };
  const { data } = await axios.post(V2_SHARED_SERVERS, body, {
    params: plexAuthParams(), headers: { 'Content-Type': 'application/json' },
  });
  return data;
}

/** Changes an existing share's library access to exactly the given list (a full
 * replace, matching Plex's own semantics for this call — not additive). shareId is
 * getSharedUsers()'s `id`. Confirmed live by capturing Plex's own "Edit" flow: this
 * is a POST (not PUT — PUT/PATCH both 405 on this endpoint) to the shared_servers/id
 * sub-resource, and critically the body's `settings` must be the share's CURRENT
 * settings round-tripped back, not fresh defaults — the edit UI only ever changes
 * libraries, so sending default settings here would silently reset whatever
 * allowSync/allowChannels/etc. the share already had. */
async function updateShareLibraries({ shareId, librarySectionIds }) {
  const { data: current } = await axios.get(`${V2_SHARED_SERVERS}/${shareId}`, {
    params: plexAuthParams(), headers: { Accept: 'application/json' },
  });
  const body = { settings: current.sharingSettings, librarySectionIds: await toCloudLibraryIds(librarySectionIds) };
  const { data } = await axios.post(`${V2_SHARED_SERVERS}/${shareId}`, body, {
    params: plexAuthParams(), headers: { 'Content-Type': 'application/json' },
  });
  return data;
}

/** Revokes a share entirely. shareId is getSharedUsers()'s `id`. */
async function revokeShare(shareId) {
  await axios.delete(`${V2_SHARED_SERVERS}/${shareId}`, { params: plexAuthParams() });
}

module.exports = {
  getLibraries,
  getSharedUsers,
  normalizeShare,
  inviteUser,
  updateShareLibraries,
  revokeShare,
};
