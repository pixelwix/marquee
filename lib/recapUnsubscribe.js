// Signs/verifies the unsubscribe link in the monthly recap email. Has to
// work without an active session — whoever clicks it in their inbox isn't
// necessarily signed into the site at that moment, maybe never has been on
// that device — so a plain requireAuth-gated route is the wrong shape here.
// Reuses SESSION_SECRET (already a server-side secret in this app, see
// server.js) rather than adding a second one to `.env` just for this.
const crypto = require('node:crypto');

function sign(userId) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET)
    .update(`recap-unsub:${userId}`)
    .digest('base64url');
}

// Constant-time compare — a token check is exactly the kind of thing timing
// attacks target, and crypto.timingSafeEqual is free/built-in here.
function verify(userId, token) {
  if (!token) return false;
  const expected = sign(userId);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function buildUnsubscribeUrl(userId, baseUrl = process.env.PUBLIC_URL || 'http://localhost:4000') {
  const token = sign(userId);
  return `${baseUrl.replace(/\/$/, '')}/api/recap/unsubscribe?user=${encodeURIComponent(userId)}&token=${encodeURIComponent(token)}`;
}

module.exports = { sign, verify, buildUnsubscribeUrl };
