// Signed links to the monthly recap's header image (the recipient's top title's backdrop art).
//
// The image used to be embedded in the email as a data URI. Gmail doesn't display data: images at all, and the
// base64 bulk pushed some recaps past Gmail's ~102KB clipping threshold (see lib/monthlyRecap.js). A plain linked
// image works in Gmail (its image proxy fetches it once) and in Apple Mail, so the email links to
// GET /api/recap/art/<ratingKey>.jpg?s=<sig>. The signature keeps that public route from being an open proxy into
// the whole Plex library: only rating keys this app put into a recap can be fetched. Reuses SESSION_SECRET, same
// as lib/recapUnsubscribe.js.
const crypto = require('node:crypto');

function sign(ratingKey) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET)
    .update(`recap-art:${ratingKey}`)
    .digest('base64url');
}

function verify(ratingKey, sig) {
  if (!sig || !/^\d+$/.test(String(ratingKey))) return false;
  const a = Buffer.from(sign(ratingKey));
  const b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function buildHeadlinerArtUrl(ratingKey, baseUrl = process.env.PUBLIC_URL || 'http://localhost:4000') {
  if (!ratingKey) return null;
  return `${baseUrl.replace(/\/$/, '')}/api/recap/art/${encodeURIComponent(ratingKey)}.jpg?s=${encodeURIComponent(sign(ratingKey))}`;
}

module.exports = { sign, verify, buildHeadlinerArtUrl };
