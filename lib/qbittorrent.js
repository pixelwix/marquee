const axios = require('axios');

// qBittorrent WebUI session & API key handling (compatible with qBittorrent 4.x & 5.0+ WebUI API).
let sidCookie = null;
let authDisabled = false;

function getBaseUrl() {
  return (process.env.QBITTORRENT_URL || '').replace(/\/+$/, '');
}

async function login() {
  const baseUrl = getBaseUrl();
  if (!baseUrl) throw new Error('QBITTORRENT_URL is not configured');

  // Skip login if API key is provided
  if (process.env.QBITTORRENT_API_KEY) return;

  const username = process.env.QBITTORRENT_USERNAME || '';
  const password = process.env.QBITTORRENT_PASSWORD || '';

  try {
    const { headers, data } = await axios.post(
      `${baseUrl}/api/v2/auth/login`,
      new URLSearchParams({ username, password }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: baseUrl,
          Origin: baseUrl
        },
        timeout: 5000
      }
    );

    const setCookie = headers['set-cookie']?.[0];
    if (setCookie) {
      sidCookie = setCookie.split(';')[0];
      authDisabled = false;
    } else if (data === 'Ok.' || data === 'Ok' || typeof data === 'string') {
      // Authentication is disabled or bypassed in qBittorrent settings
      sidCookie = null;
      authDisabled = true;
    } else {
      throw new Error('qBittorrent login did not return a session cookie');
    }
  } catch (err) {
    if (err.response?.status === 200) {
      authDisabled = true;
      sidCookie = null;
      return;
    }
    throw err;
  }
}

async function authedGet(path) {
  const baseUrl = getBaseUrl();
  const apiKey = process.env.QBITTORRENT_API_KEY;

  const get = () => {
    const headers = {
      Referer: baseUrl,
      Origin: baseUrl,
      ...(apiKey ? {
        Authorization: `Bearer ${apiKey}`,
        'X-Api-Key': apiKey,
        Cookie: `SID=${apiKey}`
      } : (sidCookie ? { Cookie: sidCookie } : {}))
    };
    return axios.get(`${baseUrl}${path}`, {
      headers,
      ...(apiKey ? { params: { apikey: apiKey } } : {}),
      timeout: 5000
    });
  };

  if (!apiKey && !sidCookie && !authDisabled) {
    try {
      await login();
    } catch {
      // If login fails or is bypassed, attempt request directly
    }
  }

  try {
    return (await get()).data;
  } catch (err) {
    if (!apiKey && (err.response?.status === 403 || err.response?.status === 401)) {
      // Session expired or unauthenticated — re-login and retry
      await login();
      return (await get()).data;
    }
    throw err;
  }
}

const STATE_MAP = {
  // qBittorrent 4.x & 5.0+ state mappings
  downloading: 'downloading', metaDL: 'downloading', forcedDL: 'downloading', allocating: 'downloading', moving: 'downloading',
  pausedDL: 'paused', pausedUP: 'paused', stoppedDL: 'paused', stoppedUP: 'paused',
  stalledDL: 'stalled', stalledUP: 'stalled',
  uploading: 'seeding', forcedUP: 'seeding',
  queuedDL: 'queued', queuedUP: 'queued',
  checkingDL: 'checking', checkingUP: 'checking', checkingResumeData: 'checking',
  error: 'error', missingFiles: 'error'
};

async function getTorrents() {
  const torrents = await authedGet('/api/v2/torrents/info');
  if (!Array.isArray(torrents)) return [];

  return torrents.map(t => ({
    id: t.hash,
    name: t.name,
    type: 'torrent',
    state: STATE_MAP[t.state] || 'other',
    progress: Math.round((t.progress || 0) * 100),
    speedKbps: Math.round((t.dlspeed || 0) / 1024),
    // qBittorrent uses 8640000 (100 days) as a sentinel for "no ETA"
    etaSeconds: t.eta && t.eta < 8640000 ? t.eta : null,
    sizeBytes: t.size || t.total_size || 0
  }));
}

module.exports = { getTorrents };
