const express = require('express');
const requireAuth = require('./requireAuth');
const requireOwner = require('./requireOwner');
const alerts = require('../lib/alerts');
const router = express.Router();

// Called by the arr-stack health watchdog (/mnt/docker/scripts/arr-health-watchdog.mjs
// on docker-host), not by a signed-in browser — can't sit behind requireAuth's session
// check. Same shared-secret pattern as routes/overseerr.js's /webhook: a raw-string
// compare against the Authorization header, no session, no CSRF (see server.js's
// CSRF_EXEMPT_PATHS).
router.post('/ingest', async (req, res) => {
  if (!process.env.ALERTS_INGEST_SECRET || req.headers.authorization !== process.env.ALERTS_INGEST_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { scopes, alerts: incoming } = req.body;
  if (!Array.isArray(scopes) || !Array.isArray(incoming)) {
    return res.status(400).json({ error: 'scopes and alerts must be arrays' });
  }
  // Skip malformed individual items rather than rejecting the whole batch — one bad
  // entry from the watchdog shouldn't block every other real finding in the same run.
  const valid = incoming.filter(a =>
    a && typeof a.key === 'string' && typeof a.app === 'string' && typeof a.source === 'string' &&
    typeof a.severity === 'string' && typeof a.title === 'string'
  );
  try {
    const result = await alerts.reconcile({ scopes, alerts: valid });
    res.json({ status: 'ok', open: result.open });
  } catch (err) {
    console.error('alerts ingest error', err.message);
    res.status(502).json({ error: 'Could not reconcile alerts' });
  }
});

router.get('/', requireAuth, requireOwner, async (req, res) => {
  try {
    res.json(await alerts.listOpen());
  } catch (err) {
    console.error('alerts read error', err.message);
    res.status(502).json({ error: 'Could not read alerts' });
  }
});

router.post('/:key/dismiss', requireAuth, requireOwner, async (req, res) => {
  try {
    const matched = await alerts.acknowledge(req.params.key);
    if (!matched) return res.status(404).json({ error: 'Alert not found or already resolved' });
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('alerts dismiss error', err.message);
    res.status(502).json({ error: 'Could not dismiss alert' });
  }
});

module.exports = router;
