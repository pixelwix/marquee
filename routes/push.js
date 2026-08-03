const express = require('express');
const requireAuth = require('./requireAuth');
const requireOwner = require('./requireOwner');
const subscriptions = require('../lib/pushSubscriptions');
const pushNotify = require('../lib/pushNotify');
const router = express.Router();

// Owner-only throughout — unlike the old family-wide push feature this is
// adapted from, this one exists specifically so the owner (the only person
// who can act on a stack alert) gets pinged even without the dashboard open.

// Public key only — safe to expose, it's what the browser's pushManager.
// subscribe() needs to create a subscription. The private key never leaves
// the server (see lib/pushNotify.js).
router.get('/vapid-public-key', requireAuth, requireOwner, (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || null });
});

router.post('/subscribe', requireAuth, requireOwner, async (req, res) => {
  const sub = req.body;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }
  try {
    await subscriptions.save(sub);
    res.json({ status: 'subscribed' });
  } catch (err) {
    console.error('push subscribe error:', err.message);
    res.status(500).json({ error: 'Could not save subscription' });
  }
});

router.post('/unsubscribe', requireAuth, requireOwner, async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Invalid request' });
  try {
    await subscriptions.remove(endpoint);
    res.json({ status: 'unsubscribed' });
  } catch (err) {
    console.error('push unsubscribe error:', err.message);
    res.status(500).json({ error: 'Could not remove subscription' });
  }
});

// Confirms a subscription actually reaches the device end-to-end — outside
// the normal path (only alerts.js's reconcile() sends real ones), so this
// exists purely for verifying setup, not something the UI calls today.
router.post('/test', requireAuth, requireOwner, async (req, res) => {
  try {
    await pushNotify.notifyOwners({ title: 'Marquee test notification', body: 'Push is working.', url: '/admin' });
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('push test error:', err.message);
    res.status(502).json({ error: 'Could not send test notification' });
  }
});

module.exports = router;
