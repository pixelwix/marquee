const express = require('express');
const requireAuth = require('./requireAuth');
const requireOwner = require('./requireOwner');
const settle = require('../lib/settle');
const uptimeKuma = require('../lib/uptimeKuma');
const ups = require('../lib/ups');
const loginLog = require('../lib/loginLog');
const router = express.Router();

const fs = require('fs');
const axios = require('axios');

router.get('/status', requireAuth, requireOwner, async (req, res) => {
  const [monitors, upsStatus] = await Promise.all([
    settle('uptime-kuma read', uptimeKuma.getMonitors(), []),
    settle('UPS query', ups.getStatus(), null)
  ]);
  res.json({ monitors, ups: upsStatus });
});

router.get('/logins', requireAuth, requireOwner, async (req, res) => {
  try {
    const logins = await loginLog.recent(20);
    res.json(logins.map(l => ({ username: l.username, thumb: l.thumb, isOwner: !!l.is_owner, at: l.at })));
  } catch (err) {
    console.error('login log read error', err.message);
    res.status(500).json({ error: 'Could not read sign-in history' });
  }
});

const path = require('path');

function updateEnvFile(updates) {
  const envPaths = [path.join(__dirname, '..', '.env')];
  const sessionDbDir = process.env.SESSION_DB_DIR || '/app/data';
  const dataEnvPath = path.join(sessionDbDir, '.env');
  if (!envPaths.includes(dataEnvPath)) {
    envPaths.push(dataEnvPath);
  }

  for (const envPath of envPaths) {
    try {
      let content = '';
      if (fs.existsSync(envPath)) {
        content = fs.readFileSync(envPath, 'utf8');
      }

      let lines = content.split('\n');
      const updatedKeys = new Set();

      lines = lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        const eqIdx = line.indexOf('=');
        if (eqIdx === -1) return line;
        const key = line.substring(0, eqIdx).trim();
        if (Object.prototype.hasOwnProperty.call(updates, key)) {
          updatedKeys.add(key);
          return `${key}=${updates[key]}`;
        }
        return line;
      });

      for (const [key, val] of Object.entries(updates)) {
        if (!updatedKeys.has(key)) {
          lines.push(`${key}=${val}`);
        }
      }

      const dir = path.dirname(envPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(envPath, lines.join('\n'), 'utf8');
    } catch (err) {
      console.error(`Error writing env file at ${envPath}:`, err.message);
    }
  }
}

const ALLOWED_CONFIG_KEYS = new Set([
  'SITE_NAME', 'SITE_TAGLINES', 'HOST_PORT', 'PUBLIC_URL', 'COOKIE_SECURE',
  'PLEX_SERVER_URL', 'PLEX_ADMIN_TOKEN', 'PLEX_MACHINE_ID', 'PLEX_CLIENT_ID',
  'TAUTULLI_URL', 'TAUTULLI_API_KEY', 'TAUTULLI_SECTION_MOVIES', 'TAUTULLI_SECTION_TV', 'TAUTULLI_SECTION_ANIME', 'TAUTULLI_LIBRARIES',
  'OVERSEERR_URL', 'OVERSEERR_API_KEY', 'OVERSEERR_WEBHOOK_SECRET', 'OVERSEERR_WEBHOOK_FORWARD_URL',
  'SONARR_URL', 'SONARR_API_KEY',
  'RADARR_URL', 'RADARR_API_KEY',
  'QBITTORRENT_URL', 'QBITTORRENT_API_KEY', 'QBITTORRENT_USERNAME', 'QBITTORRENT_PASSWORD',
  'SABNZBD_URL', 'SABNZBD_API_KEY',
  'UPTIME_KUMA_DB_PATH', 'UPTIME_KUMA_DATA_DIR',
  'NUT_HOST', 'NUT_PORT', 'NUT_USERNAME', 'NUT_PASSWORD', 'NUT_UPS_NAME'
]);

router.get('/settings', requireAuth, requireOwner, (req, res) => {
  const siteName = process.env.SITE_NAME || 'Marquee';
  const siteTaglines = (process.env.SITE_TAGLINES || 'Uplink to the home network.').split('|').filter(Boolean);
  const hostPort = process.env.HOST_PORT || 4000;
  const publicUrl = process.env.PUBLIC_URL || null;
  const cookieSecure = process.env.COOKIE_SECURE === 'true';
  const sessionDbDir = process.env.SESSION_DB_DIR || '/app/data';
  const webhookSecretSet = !!process.env.OVERSEERR_WEBHOOK_SECRET;
  const webhookForwardUrl = process.env.OVERSEERR_WEBHOOK_FORWARD_URL || null;

  const env = {};
  for (const k of ALLOWED_CONFIG_KEYS) {
    env[k] = process.env[k] || '';
  }

  res.json({
    siteName,
    siteTaglines,
    hostPort,
    publicUrl,
    cookieSecure,
    sessionDbDir,
    webhookSecretSet,
    webhookForwardUrl,
    env,
    services: {
      plex: { configured: !!(process.env.PLEX_SERVER_URL && process.env.PLEX_ADMIN_TOKEN), url: process.env.PLEX_SERVER_URL || null },
      tautulli: { configured: !!(process.env.TAUTULLI_URL && process.env.TAUTULLI_API_KEY), url: process.env.TAUTULLI_URL || null },
      overseerr: { configured: !!(process.env.OVERSEERR_URL && process.env.OVERSEERR_API_KEY), url: process.env.OVERSEERR_URL || null },
      sonarr: { configured: !!(process.env.SONARR_URL && process.env.SONARR_API_KEY), url: process.env.SONARR_URL || null },
      radarr: { configured: !!(process.env.RADARR_URL && process.env.RADARR_API_KEY), url: process.env.RADARR_URL || null },
      qbittorrent: { configured: !!process.env.QBITTORRENT_URL, url: process.env.QBITTORRENT_URL || null },
      sabnzbd: { configured: !!(process.env.SABNZBD_URL && process.env.SABNZBD_API_KEY), url: process.env.SABNZBD_URL || null },
      uptimeKuma: { configured: !!(process.env.UPTIME_KUMA_DB_PATH && fs.existsSync(process.env.UPTIME_KUMA_DB_PATH)) },
      nutUps: { configured: !!process.env.NUT_HOST, host: process.env.NUT_HOST || null, name: process.env.NUT_UPS_NAME || null }
    }
  });
});

router.post('/settings', requireAuth, requireOwner, (req, res) => {
  const updates = req.body || {};
  const validUpdates = {};

  for (const [key, value] of Object.entries(updates)) {
    if (ALLOWED_CONFIG_KEYS.has(key) && typeof value === 'string') {
      let valStr = value.trim();
      if (key.endsWith('_URL') && valStr) {
        valStr = valStr.replace(/\/+$/, '');
      }
      process.env[key] = valStr;
      validUpdates[key] = valStr;
    }
  }

  if (Object.keys(validUpdates).length === 0) {
    return res.status(400).json({ error: 'No valid setting updates provided' });
  }

  try {
    updateEnvFile(validUpdates);
    res.json({ status: 'ok', updatedKeys: Object.keys(validUpdates) });
  } catch (err) {
    console.error('Failed to write .env file:', err);
    res.status(500).json({ error: 'Failed to persist settings to disk' });
  }
});

async function checkServiceHealth(name, fn) {
  const start = Date.now();
  try {
    const res = await fn();
    const latencyMs = Date.now() - start;
    return { name, status: 'ok', latencyMs, details: res || null };
  } catch (err) {
    const latencyMs = Date.now() - start;
    return { name, status: 'error', latencyMs, error: err.message };
  }
}

router.get('/health', requireAuth, requireOwner, async (req, res) => {
  const checks = [];

  // Plex
  if (process.env.PLEX_SERVER_URL && process.env.PLEX_ADMIN_TOKEN) {
    checks.push(checkServiceHealth('Plex', async () => {
      const url = process.env.PLEX_SERVER_URL.replace(/\/+$/, '');
      const { data } = await axios.get(`${url}/identity`, {
        headers: { 'X-Plex-Token': process.env.PLEX_ADMIN_TOKEN },
        timeout: 4000
      });
      return { version: data?.MediaContainer?.version || 'connected' };
    }));
  } else {
    checks.push(Promise.resolve({ name: 'Plex', status: 'unconfigured' }));
  }

  // Tautulli
  if (process.env.TAUTULLI_URL && process.env.TAUTULLI_API_KEY) {
    checks.push(checkServiceHealth('Tautulli', async () => {
      const url = process.env.TAUTULLI_URL.replace(/\/+$/, '');
      const { data } = await axios.get(`${url}/api/v2`, {
        params: { cmd: 'get_activity', apikey: process.env.TAUTULLI_API_KEY },
        timeout: 4000
      });
      if (data?.response?.result !== 'success') throw new Error(data?.response?.message || 'Invalid API response');
      return { connected: true };
    }));
  } else {
    checks.push(Promise.resolve({ name: 'Tautulli', status: 'unconfigured' }));
  }

  // Overseerr
  if (process.env.OVERSEERR_URL && process.env.OVERSEERR_API_KEY) {
    checks.push(checkServiceHealth('Overseerr', async () => {
      const url = process.env.OVERSEERR_URL.replace(/\/+$/, '');
      const { data } = await axios.get(`${url}/api/v1/status`, {
        headers: { 'X-Api-Key': process.env.OVERSEERR_API_KEY },
        timeout: 4000
      });
      return { version: data?.version || 'connected' };
    }));
  } else {
    checks.push(Promise.resolve({ name: 'Overseerr', status: 'unconfigured' }));
  }

  // Sonarr
  if (process.env.SONARR_URL && process.env.SONARR_API_KEY) {
    checks.push(checkServiceHealth('Sonarr', async () => {
      const url = process.env.SONARR_URL.replace(/\/+$/, '');
      const { data } = await axios.get(`${url}/api/v3/system/status`, {
        params: { apikey: process.env.SONARR_API_KEY },
        timeout: 4000
      });
      return { version: data?.version || 'connected' };
    }));
  } else {
    checks.push(Promise.resolve({ name: 'Sonarr', status: 'unconfigured' }));
  }

  // Radarr
  if (process.env.RADARR_URL && process.env.RADARR_API_KEY) {
    checks.push(checkServiceHealth('Radarr', async () => {
      const url = process.env.RADARR_URL.replace(/\/+$/, '');
      const { data } = await axios.get(`${url}/api/v3/system/status`, {
        params: { apikey: process.env.RADARR_API_KEY },
        timeout: 4000
      });
      return { version: data?.version || 'connected' };
    }));
  } else {
    checks.push(Promise.resolve({ name: 'Radarr', status: 'unconfigured' }));
  }

  // qBittorrent
  if (process.env.QBITTORRENT_URL) {
    checks.push(checkServiceHealth('qBittorrent', async () => {
      const url = process.env.QBITTORRENT_URL.replace(/\/+$/, '');
      const apiKey = process.env.QBITTORRENT_API_KEY;
      const headers = {
        Referer: url,
        Origin: url,
        ...(apiKey ? { 'X-Api-Key': apiKey, Cookie: `SID=${apiKey}` } : {})
      };
      const { data } = await axios.get(`${url}/api/v2/app/version`, {
        headers,
        ...(apiKey ? { params: { apikey: apiKey } } : {}),
        timeout: 4000
      });
      return { version: data || 'connected' };
    }));
  } else {
    checks.push(Promise.resolve({ name: 'qBittorrent', status: 'unconfigured' }));
  }

  // SABnzbd
  if (process.env.SABNZBD_URL && process.env.SABNZBD_API_KEY) {
    checks.push(checkServiceHealth('SABnzbd', async () => {
      const url = process.env.SABNZBD_URL.replace(/\/+$/, '');
      const { data } = await axios.get(`${url}/api`, {
        params: { mode: 'version', output: 'json', apikey: process.env.SABNZBD_API_KEY },
        timeout: 4000
      });
      return { version: data?.version || 'connected' };
    }));
  } else {
    checks.push(Promise.resolve({ name: 'SABnzbd', status: 'unconfigured' }));
  }

  // Uptime Kuma
  if (process.env.UPTIME_KUMA_DB_PATH && fs.existsSync(process.env.UPTIME_KUMA_DB_PATH)) {
    checks.push(checkServiceHealth('Uptime Kuma', async () => {
      const monitors = await uptimeKuma.getMonitors();
      return { monitorCount: monitors.length };
    }));
  } else {
    checks.push(Promise.resolve({ name: 'Uptime Kuma', status: 'unconfigured' }));
  }

  // NUT UPS
  if (process.env.NUT_HOST) {
    checks.push(checkServiceHealth('NUT UPS', async () => {
      const status = await ups.getStatus();
      if (!status) throw new Error('Could not query UPS status');
      return status;
    }));
  } else {
    checks.push(Promise.resolve({ name: 'NUT UPS', status: 'unconfigured' }));
  }

  const results = await Promise.all(checks);
  res.json({ results });
});

module.exports = router;

