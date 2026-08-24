const axios = require('axios');
const fs = require('fs');
const uptimeKuma = require('./uptimeKuma');
const ups = require('./ups');
const mediaStorage = require('./mediaStorage');
const { combinedLabelRows } = require('./diskspace');

// Every check response shapes/fields confirmed live against real instances
// before wiring this in: Plex's "/" (version + machineIdentifier), Sonarr/
// Radarr's /api/v3/system/status (version), Overseerr's /api/v1/status
// (version), Tautulli's cmd=status (result/message, no version), qBittorrent's
// /api/v2/app/version (plain string, needs the same login flow as
// lib/qbittorrent.js), SABnzbd's mode=version (version field).

function describeError(e) {
  if (e.code === 'ECONNREFUSED') return 'Connection refused';
  if (e.code === 'ENOTFOUND') return 'Host not found';
  if (e.code === 'ETIMEDOUT' || e.code === 'ECONNABORTED') return 'Timed out';
  if (e.response?.status === 401 || e.response?.status === 403) return 'Authentication failed';
  if (e.response?.status) return `HTTP ${e.response.status}`;
  return e.message || 'Unreachable';
}

async function timed(fn) {
  const start = Date.now();
  try {
    const status = await fn();
    return { status: 'online', latencyMs: Date.now() - start, detail: status || 'Operational' };
  } catch (e) {
    return { status: 'error', message: describeError(e) };
  }
}

async function checkPlex() {
  if (!process.env.PLEX_SERVER_URL || !process.env.PLEX_ADMIN_TOKEN) return { status: 'unconfigured' };
  return timed(async () => {
    const { data } = await axios.get(`${process.env.PLEX_SERVER_URL}/`, {
      headers: { Accept: 'application/json', 'X-Plex-Token': process.env.PLEX_ADMIN_TOKEN },
      timeout: 5000
    });
    return data.MediaContainer?.version;
  });
}

async function checkTautulli() {
  if (!process.env.TAUTULLI_URL || !process.env.TAUTULLI_API_KEY) return { status: 'unconfigured' };
  return timed(async () => {
    const { data } = await axios.get(`${process.env.TAUTULLI_URL}/api/v2`, {
      params: { apikey: process.env.TAUTULLI_API_KEY, cmd: 'status' },
      timeout: 5000
    });
    if (data.response?.result !== 'success') throw new Error(data.response?.message || 'Unexpected response');
    return null; // no version in this call — falls back to "Operational"
  });
}

async function checkOverseerr() {
  if (!process.env.OVERSEERR_URL || !process.env.OVERSEERR_API_KEY) return { status: 'unconfigured' };
  return timed(async () => {
    const { data } = await axios.get(`${process.env.OVERSEERR_URL}/api/v1/status`, {
      headers: { 'X-Api-Key': process.env.OVERSEERR_API_KEY },
      timeout: 5000
    });
    return data.version;
  });
}

async function checkSonarr() {
  if (!process.env.SONARR_URL || !process.env.SONARR_API_KEY) return { status: 'unconfigured' };
  return timed(async () => {
    const { data } = await axios.get(`${process.env.SONARR_URL}/api/v3/system/status`, {
      headers: { 'X-Api-Key': process.env.SONARR_API_KEY },
      timeout: 5000
    });
    return data.version;
  });
}

async function checkRadarr() {
  if (!process.env.RADARR_URL || !process.env.RADARR_API_KEY) return { status: 'unconfigured' };
  return timed(async () => {
    const { data } = await axios.get(`${process.env.RADARR_URL}/api/v3/system/status`, {
      headers: { 'X-Api-Key': process.env.RADARR_API_KEY },
      timeout: 5000
    });
    return data.version;
  });
}

async function checkProwlarr() {
  if (!process.env.PROWLARR_URL || !process.env.PROWLARR_API_KEY) return { status: 'unconfigured' };
  return timed(async () => {
    const { data } = await axios.get(`${process.env.PROWLARR_URL}/api/v1/system/status`, {
      headers: { 'X-Api-Key': process.env.PROWLARR_API_KEY },
      timeout: 5000
    });
    return data.version;
  });
}

async function checkQbittorrent() {
  const hasApiKey = !!process.env.QBITTORRENT_API_KEY;
  const hasUserPass = !!(process.env.QBITTORRENT_USERNAME && process.env.QBITTORRENT_PASSWORD);
  if (!process.env.QBITTORRENT_URL || !(hasApiKey || hasUserPass)) {
    return { status: 'unconfigured' };
  }
  return timed(async () => {
    // API key preferred over username/password, same precedence as lib/qbittorrent.js.
    if (hasApiKey) {
      const { data } = await axios.get(`${process.env.QBITTORRENT_URL}/api/v2/app/version`, {
        headers: { Authorization: `Bearer ${process.env.QBITTORRENT_API_KEY}` },
        timeout: 5000
      });
      return data;
    }
    const { headers } = await axios.post(
      `${process.env.QBITTORRENT_URL}/api/v2/auth/login`,
      new URLSearchParams({ username: process.env.QBITTORRENT_USERNAME, password: process.env.QBITTORRENT_PASSWORD }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: process.env.QBITTORRENT_URL }, timeout: 5000 }
    );
    const sid = headers['set-cookie']?.[0]?.split(';')[0];
    if (!sid) throw new Error('Login did not return a session');
    const { data } = await axios.get(`${process.env.QBITTORRENT_URL}/api/v2/app/version`, { headers: { Cookie: sid }, timeout: 5000 });
    return data;
  });
}

async function checkSabnzbd() {
  if (!process.env.SABNZBD_URL || !process.env.SABNZBD_API_KEY) return { status: 'unconfigured' };
  return timed(async () => {
    const { data } = await axios.get(`${process.env.SABNZBD_URL}/api`, {
      params: { mode: 'version', apikey: process.env.SABNZBD_API_KEY, output: 'json' },
      timeout: 5000
    });
    if (!data.version) throw new Error('Unexpected response');
    return data.version;
  });
}

async function checkMediaStorage() {
  if (!process.env.MEDIA_MOUNT_DIR) return { status: 'unconfigured' };
  return timed(async () => {
    const volumes = combinedLabelRows(await mediaStorage.getVolumes());
    if (!volumes.length) throw new Error('Mount directory has no readable subdirectories');
    return `${volumes.length} volume${volumes.length === 1 ? '' : 's'}`;
  });
}

async function checkUptimeKuma() {
  if (!process.env.UPTIME_KUMA_DATA_DIR || !process.env.UPTIME_KUMA_DB_PATH) return { status: 'unconfigured' };
  if (!fs.existsSync(process.env.UPTIME_KUMA_DB_PATH)) return { status: 'error', message: 'Database file not found' };
  return timed(async () => {
    const monitors = await uptimeKuma.getMonitors();
    return `${monitors.length} monitor${monitors.length === 1 ? '' : 's'}`;
  });
}

// Kometa itself has no HTTP API to ping — it's a periodic batch job, not a
// running service — so this checks the one thing this app actually depends
// on: that the bind-mounted config directory (see lib/notice.js's
// writeKometaAnnouncement) exists and is writable from inside this
// container, at the container-internal mount path, not the host path
// KOMETA_CONFIG_DIR itself names (this process can't see the host's
// filesystem directly).
async function checkKometa() {
  if (!process.env.KOMETA_CONFIG_DIR) return { status: 'unconfigured' };
  const mountPath = '/app/kometa-config';
  return timed(async () => {
    fs.mkdirSync(mountPath, { recursive: true });
    fs.accessSync(mountPath, fs.constants.W_OK);
    return 'Config directory mounted';
  });
}

async function checkNutUps() {
  if (!process.env.NUT_HOST) return { status: 'unconfigured' };
  return timed(async () => {
    const status = await ups.getStatus();
    if (!status) throw new Error('No UPS data returned');
    return status.model || status.status;
  });
}

// Deliberately doesn't send anything — a passive health check running every
// time the Settings modal opens is the wrong place for a real send (that's
// what the Newsletter tab's own "Send test email" button is for). This just
// confirms the configured Tautulli notifier actually exists and is really
// an Email agent, which is enough to catch the most common misconfiguration
// (wrong/stale TAUTULLI_EMAIL_NOTIFIER_ID) without any side effect.
async function checkEmail() {
  const required = ['TAUTULLI_EMAIL_NOTIFIER_ID', 'EMAIL_SMTP_SERVER', 'EMAIL_SMTP_USER', 'EMAIL_SMTP_PASSWORD', 'EMAIL_FROM'];
  if (!required.every((k) => process.env[k])) return { status: 'unconfigured' };
  if (!process.env.TAUTULLI_URL || !process.env.TAUTULLI_API_KEY) {
    return { status: 'error', message: 'Tautulli must be configured too — email sends through its notifier' };
  }
  return timed(async () => {
    const { data } = await axios.get(`${process.env.TAUTULLI_URL}/api/v2`, {
      params: { apikey: process.env.TAUTULLI_API_KEY, cmd: 'get_notifier_config', notifier_id: process.env.TAUTULLI_EMAIL_NOTIFIER_ID },
      timeout: 5000
    });
    if (data.response?.result !== 'success') throw new Error(data.response?.message || 'Could not read notifier config');
    if (data.response.data?.agent_name !== 'email') throw new Error(`Notifier ${process.env.TAUTULLI_EMAIL_NOTIFIER_ID} is not an Email agent`);
    return 'Notifier verified';
  });
}

const CHECKS = {
  plex: checkPlex,
  tautulli: checkTautulli,
  overseerr: checkOverseerr,
  sonarr: checkSonarr,
  radarr: checkRadarr,
  prowlarr: checkProwlarr,
  qbittorrent: checkQbittorrent,
  sabnzbd: checkSabnzbd,
  mediaStorage: checkMediaStorage,
  kometa: checkKometa,
  uptimeKuma: checkUptimeKuma,
  nutUps: checkNutUps,
  email: checkEmail
};

async function checkAll() {
  const entries = await Promise.all(Object.entries(CHECKS).map(async ([key, fn]) => [key, await fn()]));
  return Object.fromEntries(entries);
}

module.exports = { checkAll };
