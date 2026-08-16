const axios = require('axios');

// Requests made with the static admin API key are evaluated under the admin's
// own Overseerr permissions (auto-approve, quota, etc.) regardless of the
// `userId` attribution field on the request — so a shared family member's
// request would silently bypass whatever restrictions their actual Overseerr
// account has. Authenticating with their own Plex token instead (the same
// token already captured at sign-in) gets a real per-user session, so
// Overseerr enforces that user's own permissions. This also auto-provisions
// their Overseerr account on first use, same as Overseerr's own "Sign in with
// Plex" flow would.
const sessionsByPlexUserId = new Map(); // plexUserId -> { cookie, overseerrUserId, cachedAt }

// Entries otherwise live for the process's entire lifetime — this just bounds
// that with a periodic forced refresh, on top of the existing 401-triggered
// invalidate()/retry in routes/overseerr.js's postAsUser. Long enough that a
// normal browsing session never hits it, short enough to actually bound growth
// on a container that runs for weeks.
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

async function getSession(plexUserId, plexToken) {
  const key = String(plexUserId);
  const cached = sessionsByPlexUserId.get(key);
  if (cached && Date.now() - cached.cachedAt < SESSION_TTL_MS) return cached;

  const { headers, data } = await axios.post(
    `${process.env.OVERSEERR_URL}/api/v1/auth/plex`,
    { authToken: plexToken },
    { headers: { 'Content-Type': 'application/json' } }
  );
  const setCookie = headers['set-cookie']?.[0];
  const cookie = setCookie ? setCookie.split(';')[0] : null;
  if (!cookie) throw new Error('Overseerr Plex auth did not return a session cookie');

  const session = { cookie, overseerrUserId: data.id, cachedAt: Date.now() };
  sessionsByPlexUserId.set(key, session);
  return session;
}

function invalidate(plexUserId) {
  sessionsByPlexUserId.delete(String(plexUserId));
}

module.exports = { getSession, invalidate };
