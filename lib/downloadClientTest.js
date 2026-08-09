const axios = require('axios');

// Read-only download-client connection testing for Sonarr/Radarr — the one
// action offered as a one-click button alongside a suggest-fix result (see
// routes/alerts.js). Deliberately narrow: this is the only "auto action"
// this app offers, chosen specifically because it's genuinely safe and
// reversible with no new infrastructure grant — no Docker socket access
// exists or is added for this (that would let this app control arbitrary
// containers on the host, a much bigger surface than a read-only API test).
const APPS = {
  sonarr: { url: () => process.env.SONARR_URL, key: () => process.env.SONARR_API_KEY },
  radarr: { url: () => process.env.RADARR_URL, key: () => process.env.RADARR_API_KEY },
};

async function listDownloadClients(app) {
  const cfg = APPS[app];
  if (!cfg) throw new Error(`Unsupported app: ${app}`);
  const { data } = await axios.get(`${cfg.url()}/api/v3/downloadclient`, {
    headers: { 'X-Api-Key': cfg.key() },
  });
  return data.map((c) => ({ id: c.id, name: c.name }));
}

// Purely a string match against the alert's own already-known title/detail
// text — never LLM-driven, so nothing about a model's phrasing decides
// what gets offered as a clickable action, only what's literally already
// named in the alert itself, matched against clients that genuinely exist
// right now in the *arr app's own configuration.
function matchDownloadClient(alert, clients) {
  const text = `${alert.title} ${alert.detail || ''}`.toLowerCase();
  return clients.find((c) => text.includes(c.name.toLowerCase())) || null;
}

// Fetches the client's own current config (masked secrets included) and
// POSTs it straight back to *arr's own /test endpoint — confirmed live
// that *arr recognizes the masked placeholder for an existing client ID
// and substitutes the real stored secret server-side, exactly what its own
// UI's "Test" button does. Never saves anything; a failed test changes
// nothing about the client's saved configuration.
async function testDownloadClient(app, clientId) {
  const cfg = APPS[app];
  if (!cfg) throw new Error(`Unsupported app: ${app}`);
  const headers = { 'X-Api-Key': cfg.key() };
  const { data: client } = await axios.get(`${cfg.url()}/api/v3/downloadclient/${clientId}`, { headers });
  try {
    await axios.post(`${cfg.url()}/api/v3/downloadclient/test`, client, { headers });
    return { ok: true };
  } catch (err) {
    const errors = err.response?.data;
    const message = Array.isArray(errors) && errors[0]?.errorMessage
      ? errors[0].errorMessage
      : 'Connection test failed';
    return { ok: false, message };
  }
}

module.exports = { listDownloadClients, matchDownloadClient, testDownloadClient };
