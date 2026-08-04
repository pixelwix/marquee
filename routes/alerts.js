const express = require('express');
const requireAuth = require('./requireAuth');
const requireOwner = require('./requireOwner');
const alerts = require('../lib/alerts');
const cliproxyClient = require('../lib/cliproxyClient');
const rateLimit = require('../lib/rateLimit');
const router = express.Router();

const suggestFixLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 20,
  message: 'Too many fix suggestions requested — try again in a few minutes.'
});

// Only alert sources with real, specific context worth reasoning over — 'health'
// alerts in particular would need actual tool access (docker/network diagnostics)
// to say anything beyond restating the symptom, which this deliberately doesn't do
// (see TODO.md's v1.9.0 entry). Keyed here, not just hidden client-side, so this
// can't be invoked against an unsupported alert type even via a direct API call.
const FIX_PROMPTS = {
  'log-triage': a => `You are helping diagnose a problem on a home media server. ${a.app} (a *arr media-automation app) had this issue detected from its logs:

"${a.title}"

Analysis: "${a.detail || 'none'}"

In 2-4 concise, specific sentences, suggest what the owner should check or do to fix this. Be practical and actionable — assume they have admin access to ${a.app} and standard *arr/Docker home-lab tools, but don't assume you know their exact setup. If you're not confident about the root cause, say what to check first rather than guessing.`,
  import: a => `You are helping diagnose a stuck import on a home media server. ${a.app} (a *arr media-automation app) rejected an import:

"${a.title}"

Reason given: "${a.detail || 'none'}"

In 2-4 concise, specific sentences, suggest what the owner should check or do to resolve this — e.g. whether it looks like a naming/quality mismatch, a custom format rule, something needing a manual import, or something else implied by the reason given.`,
};

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

// Read-only diagnosis, never a fix applied automatically — a plain CLIProxyAPI
// chat completion with no `tools` param, so this has zero ability to execute
// anything against Sonarr/Radarr/Prowlarr/etc.; it only reasons over the alert's
// own title/detail (already on hand) and returns text for the owner to act on.
router.post('/:key/suggest-fix', requireAuth, requireOwner, suggestFixLimiter, async (req, res) => {
  try {
    const alert = await alerts.getByKey(req.params.key);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    const buildPrompt = FIX_PROMPTS[alert.source];
    if (!buildPrompt) return res.status(400).json({ error: "Fix suggestions aren't available for this alert type" });
    const suggestion = await cliproxyClient.complete(buildPrompt(alert));
    res.json({ suggestion });
  } catch (err) {
    console.error('alerts suggest-fix error', err.message);
    res.status(502).json({ error: 'Could not get a suggestion right now' });
  }
});

module.exports = router;
