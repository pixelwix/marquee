const express = require('express');
const requireAuth = require('./requireAuth');
const requireOwner = require('./requireOwner');
const rmab = require('../lib/rmabClient');
const bookRequests = require('../lib/bookRequests');
const rateLimit = require('../lib/rateLimit');
const router = express.Router();

// Request-a-book (request modal → Books). Hidden in the UI when RMAB isn't
// configured; these routes answer 503 in that case.
const requestLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, message: 'Too many requests submitted — try again in a few minutes.' });

// Lets the request modal decide whether to show the Books toggle at all.
router.get('/enabled', requireAuth, (req, res) => res.json({ enabled: rmab.isConfigured(), editions: require('../lib/abbBridge').isConfigured() }));

router.use((req, res, next) => (rmab.isConfigured() ? next() : res.status(503).json({ error: 'Book requests are not set up' })));

router.get('/search', requireAuth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  try {
    const [results, mine] = await Promise.all([rmab.search(q), bookRequests.openAsinsForUser(req.session.user.id)]);
    res.json(results.slice(0, 20).map(r => (r.availability === 'none' && mine.has(r.asin) ? { ...r, availability: 'requested' } : r)));
  } catch (err) {
    console.error('rmab search error:', err.response?.status || err.message);
    res.status(502).json({ error: 'Could not search books' });
  }
});

router.post('/request', requireAuth, requestLimiter, async (req, res) => {
  const b = req.body || {};
  if (typeof b.asin !== 'string' || !/^[A-Z0-9]{10}$/.test(b.asin) || typeof b.title !== 'string' || !b.title.trim()) {
    return res.status(400).json({ error: 'Invalid book' });
  }
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const cover = typeof b.cover === 'string' && /^https:\/\//.test(b.cover) ? b.cover.slice(0, 500) : '';
  try {
    const view = await bookRequests.create(req.session.user, {
      asin: b.asin, title: str(b.title, 300), author: str(b.author, 300), narrator: str(b.narrator, 500),
      description: str(b.description, 4000), cover,
      edition: ['produced', 'narrated', 'any'].includes(b.edition) ? b.edition : 'produced'
    });
    res.json(view);
  } catch (err) {
    console.error('book request error:', err.response?.status || err.message);
    res.status(502).json({ error: 'Could not submit request' });
  }
});

// For You (Books): suggestions built from the library every 6 hours. Anything this person
// has since requested is dropped; the rest is served as-is.
router.get('/suggestions', requireAuth, async (req, res) => {
  const data = require('../lib/bookSuggestions').read();
  if (!data) return res.json({ generatedAt: null, series: [], authors: [] });
  const mine = await bookRequests.openAsinsForUser(req.session.user.id).catch(() => new Set());
  const keep = s => !s.parts.some(p => mine.has(p.asin));
  res.json({ generatedAt: data.generatedAt, series: data.series.filter(keep), authors: data.authors.filter(keep) });
});

router.get('/requests/mine', requireAuth, async (req, res) => {
  try {
    res.json(await bookRequests.listForUser(req.session.user.id));
  } catch (err) {
    res.status(500).json({ error: 'Could not load book requests' });
  }
});

router.get('/requests/pending', requireAuth, requireOwner, async (req, res) => {
  try {
    res.json(await bookRequests.listPending());
  } catch (err) {
    res.status(500).json({ error: 'Could not load book requests' });
  }
});

router.post('/requests/:id/approve', requireAuth, requireOwner, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const view = await bookRequests.approve(id);
    if (!view) return res.status(404).json({ error: 'Not pending' });
    res.json(view);
  } catch (err) {
    console.error('book approve error:', err.response?.status || err.message);
    res.status(502).json({ error: 'Could not reach ReadMeABook' });
  }
});

router.post('/requests/:id/decline', requireAuth, requireOwner, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const ok = await bookRequests.decline(id).catch(() => null);
  if (!ok) return res.status(404).json({ error: 'Not pending' });
  res.json({ status: 'declined' });
});

module.exports = router;
