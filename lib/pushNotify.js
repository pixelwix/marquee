const webpush = require('web-push');
const subscriptions = require('./pushSubscriptions');

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_SUBJECT) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  configured = true;
  return true;
}

// Broadcasts to every device the owner has subscribed from (phone + desktop,
// say) — there's only ever one audience here (see lib/pushSubscriptions.js),
// unlike the old family-wide notifyAll() this is adapted from. A subscription
// the push service reports as gone (410) or not found (404) — e.g. the
// browser data was cleared, or notifications were revoked at the OS level —
// is removed rather than retried forever.
async function notifyOwners({ title, body, icon, url }) {
  if (!ensureConfigured()) return;
  const subs = await subscriptions.all();
  const payload = JSON.stringify({ title, body, icon, url });
  await Promise.all(subs.map(async sub => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await subscriptions.remove(sub.endpoint).catch(() => {});
      } else {
        console.error('push send error:', err.statusCode || err.message);
      }
    }
  }));
}

module.exports = { notifyOwners };
