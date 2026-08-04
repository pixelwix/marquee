const express = require('express');
const alerts = require('../lib/alerts');
const router = express.Router();

// Called by Uptime Kuma itself (Settings -> Notifications -> Webhook), not by a
// signed-in browser — same shared-secret pattern as routes/overseerr.js's /webhook.
// Uptime Kuma's stock Webhook notification UI doesn't reliably expose a custom
// Authorization header across versions, so the secret is accepted via either the
// header (if configured) or a `secret` query param on the webhook URL itself.
router.post('/webhook', (req, res) => {
  const secret = req.headers.authorization || req.query.secret;
  if (!process.env.UPTIME_KUMA_WEBHOOK_SECRET || secret !== process.env.UPTIME_KUMA_WEBHOOK_SECRET) {
    return res.status(401).end();
  }
  res.status(200).end();

  const { heartbeat, monitor } = req.body;
  if (!heartbeat || !monitor) return;

  // Each monitor gets its own scope, not a shared 'uptimeKuma:monitor' one — with
  // several monitors, one recovering (status 1, empty alerts) must only resolve
  // its own row, never sweep away another monitor's still-open down alert. See
  // lib/alerts.js's planReconciliation: a scope auto-resolves any open alert whose
  // key wasn't reported, so scope granularity has to match alert-key granularity.
  const source = `monitor-${monitor.id}`;
  const key = `uptimeKuma:${source}`;
  const scopes = [key];

  // status: 1 = up, 0 = down (2 = pending, 3 = maintenance — ignored, neither a
  // resolved problem nor a new one worth alerting on).
  if (heartbeat.status === 0) {
    alerts.reconcile({
      scopes,
      alerts: [{
        key, app: 'uptimeKuma', source,
        severity: 'error',
        title: `${monitor.name} is down`,
        detail: heartbeat.msg || null
      }]
    }).catch(err => console.error('uptime-kuma webhook reconcile error', err.message));
  } else if (heartbeat.status === 1) {
    alerts.reconcile({ scopes, alerts: [] })
      .catch(err => console.error('uptime-kuma webhook reconcile error', err.message));
  }
});

module.exports = router;
