const axios = require('axios');
const { plainText } = require('./absClient');

// ReadMeABook (audiobook requests -> Prowlarr -> qBittorrent/SABnzbd ->
// Audiobookshelf). Marquee talks to it with one RMAB API token owned by the
// RMAB admin, so every request lands in RMAB as the admin's (and skips RMAB's
// own approval). Who actually asked, and the family approval step, live in
// Marquee (lib/bookRequests.js). RMAB only lets tokens use search, create
// request and read request — approve/search-terms are not token endpoints.
const STUCK_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

function isConfigured() {
  return !!(process.env.RMAB_URL && process.env.RMAB_API_TOKEN);
}

function client() {
  return axios.create({
    baseURL: process.env.RMAB_URL,
    headers: { Authorization: `Bearer ${process.env.RMAB_API_TOKEN}` },
    timeout: 20000
  });
}

// RMAB's Audible search result (AudibleAudiobook + enrichAudiobooksWithMatches)
// -> request-modal row. isAvailable = already in Audiobookshelf; isRequested =
// someone already has an RMAB request for it.
function mapSearchResult(r) {
  return {
    asin: r.asin,
    title: r.title || 'Untitled',
    author: r.author || '',
    narrator: r.narrator || '',
    description: plainText(r.description),
    cover: r.coverArtUrl || null,
    hours: r.durationMinutes ? Math.round(r.durationMinutes / 6) / 10 : null,
    year: r.releaseDate ? String(r.releaseDate).slice(0, 4) : '',
    series: r.series ? `${r.series}${r.seriesPart ? ' #' + r.seriesPart : ''}` : '',
    seriesName: r.series || '',
    seriesPart: r.seriesPart || '',
    language: r.language || '',
    narratorCount: (r.narrator || '').split(',').filter(s => s.trim()).length,
    availability: r.isAvailable ? 'available' : r.isRequested ? 'requested' : 'none'
  };
}

// RMAB request status -> the requester-facing state Marquee shows. "stuck" is
// RMAB's awaiting_search (it found nothing and keeps retrying daily) once it
// has been that way for two days, or has already failed 3+ searches (a
// request Marquee linked to that RMAB has been retrying since long before).
const STUCK_AFTER_SEARCHES = 3;
function describeStatus(rmabStatus, createdAt, now = Date.now(), searchAttempts = 0) {
  switch (rmabStatus) {
    case 'available':
    case 'downloaded':
      return 'available';
    case 'downloading':
    case 'processing':
    case 'awaiting_import':
      return 'downloading';
    case 'failed':
    case 'denied':
    case 'cancelled':
      return 'failed';
    case 'awaiting_search':
      return (createdAt && now - new Date(createdAt).getTime() > STUCK_AFTER_MS) || searchAttempts >= STUCK_AFTER_SEARCHES ? 'stuck' : 'searching';
    default:
      return 'searching'; // pending, searching, awaiting_release, awaiting_approval
  }
}

async function search(q) {
  const { data } = await client().get('/api/audiobooks/search', { params: { q } });
  return (data.results || []).map(mapSearchResult);
}

// Returns { ok: true, requestId, status } or { ok: false, reason } for RMAB's
// named rejections (already_available, duplicate, being_processed, ...).
async function createRequest(book) {
  try {
    const { data } = await client().post('/api/requests', {
      audiobook: {
        asin: book.asin,
        title: book.title,
        author: book.author,
        narrator: book.narrator || undefined,
        description: book.description || undefined,
        coverArtUrl: book.cover || undefined
      }
    });
    return { ok: true, requestId: data.request?.id, status: data.request?.status || 'pending' };
  } catch (err) {
    const code = err.response?.data?.error;
    if (err.response?.status === 409) return { ok: false, reason: code || 'Conflict', message: err.response.data.message };
    throw err;
  }
}

// Every RMAB request (token = admin, so all of them), newest first, as
// { id, asin, status, searchAttempts }. Used by the status sync instead of
// GET /api/requests/:id, which RMAB answers with a 500 ("Failed to fetch
// request") for any request that has reached processing/downloaded/available.
async function listRequests() {
  const { data } = await client().get('/api/requests', { params: { limit: 100 } });
  return (data.requests || []).filter(r => !r.deletedAt).map(r => ({
    id: r.id, asin: r.audiobook?.audibleAsin || null, status: r.status, searchAttempts: r.searchAttempts ?? null,
    error: r.errorMessage || null
  }));
}

// The RMAB request already open for this book, if any — used when RMAB
// answers DuplicateRequest/BeingProcessed so Marquee can follow that request
// instead of calling it a failure. Token requests are the admin's, so this
// sees every request.
async function findRequestByAsin(asin) {
  return (await listRequests()).find(r => r.asin === asin) || null;
}

async function getRequest(id) {
  const { data } = await client().get(`/api/requests/${encodeURIComponent(id)}`);
  const r = data.request || data;
  return { id: r.id, status: r.status, createdAt: r.createdAt, searchAttempts: r.searchAttempts ?? null, error: r.errorMessage || null };
}

module.exports = { isConfigured, mapSearchResult, describeStatus, search, createRequest, listRequests, findRequestByAsin, getRequest, STUCK_AFTER_MS };
