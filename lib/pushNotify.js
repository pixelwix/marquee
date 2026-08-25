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

// Shared send loop for both notifyOwners() and notifyUser() below. A
// subscription the push service reports as gone (410) or not found (404) —
// e.g. the browser data was cleared, or notifications were revoked at the OS
// level — is removed rather than retried forever.
async function sendToSubs(subs, payload) {
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

// Broadcasts to every device the owner has subscribed from (phone + desktop,
// say) — for stack-alert-style notifications only the owner can act on.
async function notifyOwners({ title, body, icon, url }) {
  if (!ensureConfigured()) return;
  const subs = await subscriptions.forOwner();
  await sendToSubs(subs, JSON.stringify({ title, body, icon, url }));
}

// Targets one specific family member's own subscribed devices — e.g. "your
// request is available" — rather than every owner device. Silently no-ops
// if that person never subscribed (most common case: most family members
// won't have turned notifications on), same as notifyOwners() no-ops when
// push isn't configured at all.
async function notifyUser(userId, { title, body, icon, url }) {
  if (!ensureConfigured() || !userId) return;
  const subs = await subscriptions.forUser(userId);
  await sendToSubs(subs, JSON.stringify({ title, body, icon, url }));
}

module.exports = { notifyOwners, notifyUser };
