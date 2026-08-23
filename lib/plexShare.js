// Plex library-sharing operations — inviting someone to the server with access to
// specific libraries only, and managing who already has access. Two different Plex
// APIs are involved, same split routes/auth.js's isAllowedOnServer already relies on:
//   - the LOCAL server (PLEX_SERVER_URL + PLEX_ADMIN_TOKEN) for library metadata —
//     same host routes/plex.js already talks to for search/images.
//   - plex.tv's CLOUD API (PLEX_MACHINE_ID + PLEX_ADMIN_TOKEN) for the actual sharing
//     relationship — shares are a plex.tv-mediated thing, not something the local
//     server tracks on its own. Confirmed live this only ever returns XML regardless
//     of an Accept: application/json header, so responses are parsed with xml2js
//     (already a dependency — routes/auth.js uses it the same way).
const axios = require('axios');
const { parseStringPromise } = require('xml2js');

function sharedServersUrl(shareId) {
  const base = `https://plex.tv/api/servers/${process.env.PLEX_MACHINE_ID}/shared_servers`;
  return shareId ? `${base}/${shareId}` : base;
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

/** Pure — turns plex.tv's raw shared_servers XML into a clean array. Split out from
 * getSharedUsers so it's testable with a captured XML fixture, no network call. */
function parseSharedServersXml(parsed) {
  const shares = parsed?.MediaContainer?.SharedServer || [];
  return shares.map((s) => {
    const a = s.$ || {};
    const sections = (s.Section || []).map((sec) => ({
      id: sec.$.key, title: sec.$.title, type: sec.$.type,
    }));
    return {
      id: a.id,
      username: a.username,
      email: a.email,
      userId: a.userID,
      owned: a.owned === '1',
      allLibraries: a.allLibraries === '1',
      libraries: sections,
      invitedAt: a.invitedAt ? Number(a.invitedAt) * 1000 : null,
      acceptedAt: a.acceptedAt ? Number(a.acceptedAt) * 1000 : null,
    };
  });
}

/** Everyone currently shared on this server, with their per-library access — same
 * underlying plex.tv data routes/auth.js's isAllowedOnServer already reads for the
 * login check, parsed further here into per-share library detail. */
async function getSharedUsers() {
  const { data } = await axios.get(sharedServersUrl(), {
    headers: { 'X-Plex-Token': process.env.PLEX_ADMIN_TOKEN },
  });
  const parsed = await parseStringPromise(data);
  return parseSharedServersXml(parsed);
}

// Grant/update/revoke below use the same shared_servers resource the read above
// confirmed live and working, form-encoded per the long-established convention
// third-party Plex tools (e.g. python-plexapi's inviteFriend/updateFriend) use for
// this exact endpoint. NOT yet confirmed with a real live call — deliberately not
// tested with a placeholder email during development, since that risks sending an
// unintended real invite. The first real use of inviteUser should be a genuine,
// intended invite, watched closely rather than assumed correct.

/** Invites someone by email with access to exactly the given library IDs. Plex sends
 * its own invite email/notification to the recipient; the caller (routes/invite.js)
 * separately sends the Marquee-branded welcome email through lib/mailer.js. */
async function inviteUser({ email, librarySectionIds }) {
  const params = new URLSearchParams();
  params.append('server_id', process.env.PLEX_MACHINE_ID);
  params.append('shared_server[invited_email]', email);
  for (const id of librarySectionIds) params.append('shared_server[library_section_ids][]', id);
  const { data } = await axios.post(sharedServersUrl(), params, {
    headers: { 'X-Plex-Token': process.env.PLEX_ADMIN_TOKEN, Accept: 'application/json' },
  });
  return data;
}

/** Changes an existing share's library access to exactly the given list (a full
 * replace, matching Plex's own semantics for this call — not additive). */
async function updateShareLibraries({ shareId, librarySectionIds }) {
  const params = new URLSearchParams();
  for (const id of librarySectionIds) params.append('shared_server[library_section_ids][]', id);
  const { data } = await axios.put(sharedServersUrl(shareId), params, {
    headers: { 'X-Plex-Token': process.env.PLEX_ADMIN_TOKEN, Accept: 'application/json' },
  });
  return data;
}

/** Revokes a share entirely. */
async function revokeShare(shareId) {
  await axios.delete(sharedServersUrl(shareId), {
    headers: { 'X-Plex-Token': process.env.PLEX_ADMIN_TOKEN },
  });
}

module.exports = {
  getLibraries,
  getSharedUsers,
  parseSharedServersXml,
  inviteUser,
  updateShareLibraries,
  revokeShare,
};
