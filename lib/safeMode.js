// MARQUEE_SAFE_MODE=1 turns an instance into a safe test copy (the `pr` branch's deployment):
// it may READ every configured service so pages look real, but it never changes anything
// outside its own data folder. Installed once, first thing in server.js, so every axios
// instance and every fetch() goes through the same guard:
//   - non-GET requests are refused, except the few that only read or only sign in
//     (plex.tv PIN sign-in, qBittorrent's login, the CLIProxyAPI chat endpoints);
//   - GET requests that act through query params are refused too: Tautulli `cmd`s other than
//     get_* / status / pms_image_proxy (its email notifier is `cmd=notify`), and SABnzbd
//     `mode`s other than plain reads (pause/resume/delete are `mode=queue&name=...`);
//   - web push is a no-op, and server.js skips the jobs whose purpose is acting
//     (issue fix sweep, recap reminder, database backup).
// A refused request throws, so callers fail the same way they would if the service were down.

const SAFE_TAUTULLI_CMD = /^(get_|status$|pms_image_proxy$)/;
const SAFE_SAB_MODES = new Set(['version', 'queue', 'history', 'status', 'fullstatus', 'server_stats', 'warnings']);
// Jobs server.js must not start in safe mode.
const SKIPPED_JOBS = new Set(['issueFixSweep', 'recapReminder', 'dbBackup']);

let installed = false;

function enabled() {
  return process.env.MARQUEE_SAFE_MODE === '1';
}

function paramsOf(url, params) {
  const out = {};
  try {
    for (const [k, v] of new URL(url, 'http://localhost').searchParams) out[k] = v;
  } catch (e) { /* unparsable URL: no query params */ }
  if (params instanceof URLSearchParams) {
    for (const [k, v] of params) out[k] = v;
  } else if (params && typeof params === 'object') {
    Object.assign(out, params);
  }
  return out;
}

function allowedWrite(url) {
  let u;
  try { u = new URL(url); } catch (e) { return false; }
  if (u.hostname === 'plex.tv' && u.pathname.startsWith('/api/v2/pins')) return true;
  if (u.pathname.endsWith('/api/v2/auth/login')) return true; // qBittorrent session login
  const cliproxy = process.env.CLIPROXY_URL;
  if (cliproxy && url.startsWith(cliproxy.replace(/\/+$/, '') + '/v1/')) return true;
  return false;
}

/** Returns null when the request may go out, else a reason string. */
function refusal(method, url, params) {
  const m = String(method || 'get').toLowerCase();
  if (m !== 'get' && m !== 'head' && m !== 'options') {
    return allowedWrite(url) ? null : `${m.toUpperCase()} requests are blocked`;
  }
  const p = paramsOf(url, params);
  if (p.cmd !== undefined && !SAFE_TAUTULLI_CMD.test(String(p.cmd))) return `cmd=${p.cmd} is blocked`;
  if (p.mode !== undefined && (!SAFE_SAB_MODES.has(String(p.mode)) || p.name !== undefined)) {
    return `mode=${p.mode}${p.name !== undefined ? `&name=${p.name}` : ''} is blocked`;
  }
  return null;
}

function blockedError(reason, url) {
  const err = new Error(`MARQUEE_SAFE_MODE: ${reason} (${String(url).split('?')[0]})`);
  err.code = 'MARQUEE_SAFE_MODE';
  return err;
}

function fullUrl(config) {
  const url = config.url || '';
  if (/^https?:\/\//i.test(url) || !config.baseURL) return url;
  return config.baseURL.replace(/\/+$/, '') + '/' + url.replace(/^\/+/, '');
}

function axiosGuard(config) {
  const url = fullUrl(config);
  const reason = refusal(config.method, url, config.params);
  if (reason) throw blockedError(reason, url);
  return config;
}

function install() {
  if (!enabled() || installed) return;
  installed = true;

  const axios = require('axios');
  axios.interceptors.request.use(axiosGuard);
  const create = axios.create.bind(axios);
  axios.create = (...args) => {
    const instance = create(...args);
    instance.interceptors.request.use(axiosGuard);
    return instance;
  };

  if (typeof globalThis.fetch === 'function') {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = init.method || (typeof input === 'object' && input.method) || 'GET';
      const reason = refusal(method, url);
      if (reason) return Promise.reject(blockedError(reason, url));
      return realFetch(input, init);
    };
  }

  const webpush = require('web-push');
  webpush.sendNotification = async () => {
    console.log('[safe mode] web push skipped');
    return { statusCode: 201, body: '', headers: {} };
  };

  console.log('[safe mode] ON: reads only; outgoing changes, email, push and acting jobs are off');
}

function shouldStart(job) {
  return !(enabled() && SKIPPED_JOBS.has(job));
}

module.exports = { enabled, install, shouldStart, refusal, SKIPPED_JOBS };
