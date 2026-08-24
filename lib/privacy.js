// Sanitizes Now Playing sessions and the Top of the Month leaderboard for
// non-owner family members, per an owner-configured privacy policy (Settings ->
// Privacy). Adapted from a community fork (raddadengineer/marquee) rather than
// ported as-is — that version assumed a flatter session shape (s.player,
// s.ipAddress, s.bitrate directly on the session) and a req.user convention;
// this app's real session shape (lib/nowPlaying.js's mapSession) nests device/
// codec/bitrate detail under `stream`, and auth state lives on
// req.session.user, not req.user. It also never sends ip_address/email to the
// family view at all (see mapSession's own comment) — so there's no
// "hide network IP" tier here, that data was never exposed in the first place.

const DEFAULT_PRIVACY_CONFIG = {
  streamUserIdentity: 'full', // 'full' | 'mask_usernames' | 'generic_labels' | 'hide_identity'
  streamMediaContent: 'full_details', // 'full_details' | 'show_name_only' | 'category_only' | 'blur_artwork'
  streamTechnical: 'full_technical', // 'full_technical' | 'hide_device_info' | 'hide_all_technical'
  statsLeaderboard: 'full_leaderboard' // 'full_leaderboard' | 'anonymous_leaderboard' | 'disable_leaderboard'
};

function getPrivacyConfigFromEnv() {
  const p = process.env;
  return {
    streamUserIdentity: p.PRIVACY_STREAM_USER_IDENTITY || DEFAULT_PRIVACY_CONFIG.streamUserIdentity,
    streamMediaContent: p.PRIVACY_STREAM_MEDIA_CONTENT || DEFAULT_PRIVACY_CONFIG.streamMediaContent,
    streamTechnical: p.PRIVACY_STREAM_TECHNICAL || DEFAULT_PRIVACY_CONFIG.streamTechnical,
    statsLeaderboard: p.PRIVACY_STATS || DEFAULT_PRIVACY_CONFIG.statsLeaderboard
  };
}

function maskUsername(name) {
  if (!name || typeof name !== 'string') return 'User ***';
  if (name.length <= 2) return name[0] + '***';
  return name[0] + '***' + name[name.length - 1];
}

/** requestingUser is req.session.user — {id, username, isOwner, ...} or undefined
 * for an unauthenticated caller (every route this is used on already requires
 * auth, so that's only a defensive fallback, not a real path). */
function sanitizeSession(session, requestingUser, config = getPrivacyConfigFromEnv()) {
  if (!session) return session;
  if (requestingUser?.isOwner) return session;

  // A signed-in family member always sees their own session in full — masking
  // someone's own stream from themselves would just be confusing, not private.
  const isSelf = requestingUser?.username && session.user === requestingUser.username;
  if (isSelf) return session;

  const s = { ...session };

  // `thumb` is the media poster, not a user avatar — this app's Now Playing
  // row shows the username as plain text (see app.js's renderNowPlaying),
  // there's no separate avatar image to strip here.
  if (config.streamUserIdentity === 'mask_usernames') {
    s.user = maskUsername(session.user);
  } else if (config.streamUserIdentity === 'generic_labels') {
    s.user = 'Family Member';
  } else if (config.streamUserIdentity === 'hide_identity') {
    delete s.user;
  }

  if (config.streamMediaContent === 'show_name_only') {
    // title is already "Show — Episode" for a TV episode (mapSession joins
    // grandparent_title in); subtitle carries the SxxEyy for episodes. A
    // movie has no natural "series-only" reduction, so it's left as-is.
    const dash = session.title.indexOf(' — ');
    if (dash !== -1) {
      s.title = session.title.slice(0, dash);
      s.subtitle = null;
    }
  } else if (config.streamMediaContent === 'category_only') {
    s.title = session.subtitle && /^S\d+E\d+$/.test(session.subtitle) ? 'Watching a TV Show' : 'Watching a Movie';
    s.subtitle = null;
    s.overview = '';
  } else if (config.streamMediaContent === 'blur_artwork') {
    s.blurArtwork = true;
  }

  if (config.streamTechnical === 'hide_device_info') {
    s.stream = { ...session.stream, player: null, product: null, platform: null };
  } else if (config.streamTechnical === 'hide_all_technical') {
    delete s.stream;
  }

  return s;
}

function sanitizeLeaderboard(topList, requestingUser, config = getPrivacyConfigFromEnv()) {
  if (!Array.isArray(topList)) return topList;
  if (requestingUser?.isOwner) return topList;

  if (config.statsLeaderboard === 'disable_leaderboard') return [];

  if (config.statsLeaderboard === 'anonymous_leaderboard') {
    return topList.map((u, i) => ({ ...u, name: `User #${i + 1}`, avatar: null }));
  }

  return topList;
}

module.exports = {
  DEFAULT_PRIVACY_CONFIG,
  getPrivacyConfigFromEnv,
  maskUsername,
  sanitizeSession,
  sanitizeLeaderboard
};
