const signinScreen = document.getElementById('signin-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const signinStatus = document.getElementById('signin-status');
const store = { nowPlaying: [], recentlyWatched: [], recentlyAdded: [], airingToday: [], upcoming: [] };

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}

// ---------- Taglines ----------
// SITE_TAGLINES (server-injected, see server.js) — defaults to a single generic
// phrase, but a deployment can supply its own personality via .env.
(function cycleTagline() {
  const el = document.getElementById('tagline');
  const phrases = (window.SITE_TAGLINES && window.SITE_TAGLINES.length) ? window.SITE_TAGLINES : ['Uplink to the home network.'];
  let idx = 0;
  el.textContent = phrases[0];
  if (phrases.length <= 1) return;
  setInterval(() => {
    el.classList.add('fading');
    setTimeout(() => {
      idx = (idx + 1) % phrases.length;
      el.textContent = phrases[idx];
      el.classList.remove('fading');
    }, 300);
  }, 4000);
})();
// One phrase, picked once, as a small caption under the dashboard's own logo.
document.getElementById('header-tag').textContent =
  (window.SITE_TAGLINES || [])[Math.floor(Math.random() * (window.SITE_TAGLINES || []).length)] || '';

// ---------- Sign in with Plex ----------
document.getElementById('plex-signin-btn').addEventListener('click', async () => {
  signinStatus.textContent = 'Requesting sign-in code…';
  try {
    const { code, clientId } = await api('/api/auth/plex/pin', { method: 'POST' });
    const authUrl = `https://app.plex.tv/auth#?clientID=${clientId}&code=${code}&context[device][product]=Marquee`;
    const popup = window.open(authUrl, '_blank', 'width=480,height=700');
    signinStatus.textContent = 'Waiting for approval in the Plex window…';
    pollSignIn(popup);
  } catch (e) {
    signinStatus.textContent = 'Could not start sign-in. Try again.';
  }
});

function pollSignIn(popup) {
  // We can't reach into the popup's content (it's app.plex.tv, cross-origin), but
  // closing a window you opened is always allowed regardless of origin — Plex's
  // own page never closes it itself once approval is done, so we do it here.
  const interval = setInterval(async () => {
    try {
      const result = await api('/api/auth/plex/poll');
      if (result.status === 'ok') {
        clearInterval(interval);
        popup?.close();
        signinStatus.textContent = `Welcome, ${result.user}.`;
        showDashboard(result.isOwner);
      }
    } catch (e) {
      clearInterval(interval);
      popup?.close();
      signinStatus.textContent = e.message || 'This Plex account does not have access.';
    }
  }, 2000);
  // stop trying after 3 minutes
  setTimeout(() => { clearInterval(interval); popup?.close(); }, 3 * 60 * 1000);
}

// ---------- Session check on load ----------
(async function init() {
  try {
    const me = await api('/api/auth/me');
    document.getElementById('whoami').textContent = me.username;
    showDashboard(me.isOwner);
  } catch (e) {
    signinScreen.classList.remove('hidden');
  }
})();

function showDashboard(isOwner) {
  signinScreen.classList.add('hidden');
  dashboardScreen.classList.remove('hidden');
  setHeroDate();
  connectNowPlayingStream();
  loadRecentlyWatched();
  loadTopOfMonth();
  loadRecentlyAdded();
  loadAiringToday();
  loadUpcoming();
  loadDownloads();
  setInterval(loadDownloads, 5000);
  if (isOwner) {
    document.getElementById('admin-settings-btn').classList.remove('hidden');
    document.getElementById('panel-owner').classList.remove('hidden');
    loadOwnerStatus();
    setInterval(loadOwnerStatus, 15000);
    document.getElementById('panel-admin').classList.remove('hidden');
    loadAdminLogins();
    loadPendingRequests();
    setInterval(loadPendingRequests, 30000);
    loadAdminIssues();
    setInterval(loadAdminIssues, 30000);
    loadServerSettings();
    loadServiceHealth();
  }
}

function setHeroDate() {
  const now = new Date();
  document.getElementById('date-num').textContent = now.getDate();
  document.getElementById('date-txt').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'short' });
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  location.reload();
});

// ---------- Now Playing ----------
// Driven by Server-Sent Events instead of polling: the server keeps a live
// connection to Plex's own notification stream, so updates arrive the instant
// something changes rather than on a fixed interval. "full" events (a session
// started/stopped) re-render the whole panel; "update" events (progress/state
// on an existing session) patch just that row in place.
function connectNowPlayingStream() {
  const es = new EventSource('/api/tautulli/now-playing/stream');
  es.addEventListener('full', e => renderNowPlaying(JSON.parse(e.data)));
  es.addEventListener('update', e => patchNowPlayingRow(JSON.parse(e.data)));
  // Unrelated to Now Playing, but this connection is already open to every
  // dashboard, so Overseerr's "media available" webhook rides the same stream
  // instead of opening a second one — see lib/sse.js.
  es.addEventListener('media-available', e => showAvailableToast(JSON.parse(e.data)));
  // No reconnect logic needed here — EventSource retries automatically, and the
  // server always sends a fresh "full" snapshot as soon as a connection opens.
}

// ---------- "Available now" toast ----------
function showAvailableToast({ title, poster }) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <img class="toast-poster" src="${poster || ''}" onerror="this.style.visibility='hidden'">
    <div class="toast-body">
      <div class="toast-eyebrow">Available now</div>
      <div class="toast-title">${escapeHtml(title || 'A request')}</div>
    </div>
  `;
  const dismiss = () => {
    toast.classList.add('leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };
  toast.addEventListener('click', dismiss);
  setTimeout(dismiss, 8000);
  container.prepend(toast);
}

function renderNowPlaying(sessions) {
  const body = document.getElementById('now-playing-body');
  const headline = document.getElementById('hero-headline');
  const indicator = document.getElementById('live-indicator');

  store.nowPlaying = sessions;
  headline.textContent = sessions.length
    ? `${sessions.length} stream${sessions.length === 1 ? '' : 's'} live right now`
    : 'Nothing playing right now';
  indicator.style.visibility = sessions.length ? 'visible' : 'hidden';
  body.innerHTML = !sessions.length
    ? '<p class="empty-state">Nothing playing right now.</p>'
    : sessions.map((s, idx) => `
      <div class="now-row" data-idx="${idx}" data-session-key="${s.sessionKey}">
        <img class="thumb" src="${s.thumb || ''}" onerror="this.style.visibility='hidden'">
        <div style="flex:1; min-width:0;">
          <div class="now-title">${escapeHtml(s.title)}</div>
          <div class="now-meta"><span class="${dotClass(s.state === 'paused')}"></span>${escapeHtml(s.user || '')} · ${s.quality || ''} · <span class="state-word">${s.state}</span></div>
          <div class="bar"><div class="bar-fill" style="width:${s.progress}%"></div></div>
        </div>
      </div>
    `).join('');
  // Session count changed — Recently Watched's row count tracks it.
  renderRecentlyWatched();
}

function patchNowPlayingRow({ sessionKey, state, progress }) {
  const s = store.nowPlaying.find(x => x.sessionKey === sessionKey);
  const row = document.querySelector(`.now-row[data-session-key="${sessionKey}"]`);
  if (!s || !row) return;
  s.state = state;
  s.progress = progress;
  row.querySelector('.state-dot').classList.toggle('paused', state === 'paused');
  row.querySelector('.state-word').textContent = state;
  row.querySelector('.bar-fill').style.width = progress + '%';
}

// ---------- Recently Watched ----------
// Styled like Now Playing (small thumb per row) rather than a poster grid —
// on-deck/"continue watching" is already visible in Plex itself, so this shows
// actual watch history instead. Row count tracks how many streams are live in
// Now Playing (so the two panels visually pair up), with a floor of 5 so it
// doesn't shrink to almost nothing when few/no streams are active.
let recentlyWatchedLoaded = false;

async function loadRecentlyWatched() {
  try {
    store.recentlyWatched = await api('/api/tautulli/recently-watched');
    recentlyWatchedLoaded = true;
    renderRecentlyWatched();
  } catch (e) {
    document.getElementById('recently-watched-body').innerHTML = '<p class="empty-state">Could not reach Tautulli.</p>';
  }
}

function renderRecentlyWatched() {
  if (!recentlyWatchedLoaded) return;
  const body = document.getElementById('recently-watched-body');
  const count = Math.max(store.nowPlaying.length, 5);
  const items = store.recentlyWatched.slice(0, count);
  if (!items.length) { body.innerHTML = '<p class="empty-state">Nothing watched recently.</p>'; return; }
  body.innerHTML = items.map((i, idx) => `
    <div class="now-row" data-idx="${idx}">
      <img class="thumb" src="${i.thumb || ''}" onerror="this.style.visibility='hidden'">
      <div style="flex:1; min-width:0;">
        <div class="now-title">${escapeHtml(i.title)}</div>
        <div class="now-meta">
          <span class="${dotClass(!i.finished)}"></span>
          ${i.finished ? 'Finished' : i.progress + '% watched'} · ${timeAgo(i.watchedAt)}
        </div>
      </div>
    </div>
  `).join('');
}

// ---------- Recently Added ----------
async function loadRecentlyAdded() {
  const body = document.getElementById('recently-added-body');
  try {
    const data = await api('/api/tautulli/recently-added');
    store.recentlyAdded = data;

    let sections = [];
    if (data.all) {
      sections = [{ key: 'all', label: null, items: data.all }];
    } else if (Array.isArray(data.libraries) && data.libraries.length > 0) {
      sections = data.libraries.filter(s => s.items && s.items.length);
    } else {
      sections = [
        { key: 'movies', label: 'Movies', items: data.movies || [] },
        { key: 'tv', label: 'TV Shows', items: data.tv || [] },
        { key: 'anime', label: 'Anime', items: data.anime || [] }
      ].filter(s => s.items && s.items.length);
    }

    if (!sections.length || sections.every(s => !s.items.length)) {
      body.innerHTML = '<p class="empty-state">Nothing added recently.</p>';
      return;
    }

    // Same horizontal-scroll row as Releasing Soon; mobile shows fewer per row
    // since there's less width to scroll through per swipe.
    const cap = window.matchMedia('(max-width: 900px)').matches ? 6 : 10;

    body.innerHTML = sections.map(s => `
      ${s.label ? `<div class="subsection-label">${escapeHtml(s.label)}</div>` : ''}
      <div class="poster-grid poster-grid-scroll" style="margin-bottom:1rem;">
        ${s.items.slice(0, cap).map((i, idx) => `
          <div class="poster-card" data-cat="${s.key}" data-idx="${idx}">
            <div class="poster-frame">
              <img class="poster-img" src="${i.thumb || ''}" onerror="this.style.visibility='hidden'">
              <span class="poster-badge">${timeAgo(i.addedAt)}</span>
              <div class="poster-overlay"><span class="poster-overlay-text">${escapeHtml(i.title)}</span></div>
            </div>
          </div>
        `).join('')}
      </div>
    `).join('');
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not reach Tautulli.</p>';
  }
}

// ---------- Airing Today ----------
async function loadAiringToday() {
  const body = document.getElementById('airing-today-body');
  try {
    const items = await api('/api/sonarr/today');
    store.airingToday = items;
    if (!items.length) { body.innerHTML = '<p class="empty-state">Nothing airing today.</p>'; return; }
    body.innerHTML = items.map((i, idx) => `
      <div class="poster-card" data-idx="${idx}">
        <div class="poster-frame">
          <img class="poster-img" src="${i.poster || ''}" onerror="this.style.visibility='hidden'">
          <span class="poster-badge">${i.episode}</span>
          <div class="poster-overlay"><span class="poster-overlay-text">${escapeHtml(i.series)}</span></div>
        </div>
        <div class="poster-meta">${i.hasFile ? 'Downloaded' : 'Airing'}</div>
      </div>
    `).join('');
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not reach Sonarr.</p>';
  }
}

// ---------- Releasing Soon ----------
async function loadUpcoming() {
  const body = document.getElementById('upcoming-body');
  try {
    const items = await api('/api/radarr/upcoming');
    store.upcoming = items;
    if (!items.length) { body.innerHTML = '<p class="empty-state">Nothing on the calendar.</p>'; return; }
    body.innerHTML = items.map((i, idx) => `
      <div class="poster-card" data-idx="${idx}">
        <div class="poster-frame">
          <img class="poster-img" src="${i.poster || ''}" onerror="this.style.visibility='hidden'">
          <span class="poster-badge">${formatDate(i.releaseDate)}</span>
          <div class="poster-overlay"><span class="poster-overlay-text">${escapeHtml(i.title)}</span></div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not reach Radarr.</p>';
  }
}

// ---------- Download Queue ----------
async function loadDownloads() {
  const body = document.getElementById('downloads-body');
  try {
    const items = await api('/api/downloads/queue');
    if (!items.length) { body.innerHTML = '<p class="empty-state">Nothing downloading.</p>'; return; }
    body.innerHTML = items.map(d => `
      <div class="dl-row">
        <div class="dl-row-body">
          <div class="now-title">${escapeHtml(d.name)}</div>
          <div class="now-meta">
            <span class="${dotClass(d.state !== 'downloading')}"></span>
            ${d.type === 'torrent' ? 'Torrent' : 'Usenet'} · ${titleCase(d.state)}${d.speedKbps ? ' · ' + formatSpeed(d.speedKbps) : ''}${d.etaSeconds != null ? ' · ' + formatEta(d.etaSeconds) : ''}
          </div>
          <div class="bar"><div class="bar-fill" style="width:${d.progress}%"></div></div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not reach download clients.</p>';
  }
}

function formatSpeed(kbps) {
  return kbps >= 1024 ? `${(kbps / 1024).toFixed(1)} MB/s` : `${kbps} KB/s`;
}

function formatEta(seconds) {
  if (seconds >= 3600) return `${Math.round(seconds / 3600)}h left`;
  if (seconds >= 60) return `${Math.round(seconds / 60)}m left`;
  return `${seconds}s left`;
}

// ---------- Top of the Month ----------
async function loadTopOfMonth() {
  const body = document.getElementById('top-month-body');
  try {
    const data = await api('/api/tautulli/top-of-month');
    let sections = [];
    if (Array.isArray(data.tiles) && data.tiles.length > 0) {
      sections = data.tiles;
    } else {
      sections = [
        { label: 'Top Viewer', items: data.user, isUser: true },
        { label: 'Top Movie', items: data.movie },
        { label: 'Top TV Show', items: data.tv },
        { label: 'Top Anime', items: data.anime }
      ].filter(s => s.items && s.items.length);
    }
    body.innerHTML = sections.map(s => renderTopMonthTile(s.label, s.items, s.isUser)).join('');
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not reach Tautulli.</p>';
  }
}

// #1 gets the big medal frame; #2/#3 render as compact silver/bronze rows below it.
function renderTopMonthTile(label, items, isUser) {
  if (!items || !items.length) {
    return `
      <div class="top-month-tile ${isUser ? 'user' : ''}">
        <div class="top-month-frame"><img class="top-month-img" src="" onerror="this.style.visibility='hidden'"></div>
        <div class="top-month-label">${label}</div>
        <div class="empty-state">No data yet</div>
      </div>
    `;
  }
  const [first, second, third] = items;
  // Silver and bronze are flat children of one .medal-rows grid (not two nested
  // rows) so their badge/name/plays columns are sized together and actually align.
  const medalCells = (item, medal, cls) => item ? `
    <span class="medal-badge">${medal}</span>
    <span class="medal-name ${cls}">${escapeHtml(item.name || item.title)}</span>
    <span class="medal-plays">${item.plays}</span>
  ` : '';
  return `
    <div class="top-month-tile ${isUser ? 'user' : ''}">
      <span class="top-month-medal">🥇</span>
      <div class="top-month-frame"><img class="top-month-img" src="${(isUser ? first.avatar : first.thumb) || ''}" onerror="this.style.visibility='hidden'"></div>
      <div class="top-month-label">${label}</div>
      <div class="top-month-title">${escapeHtml(first.name || first.title)}</div>
      <div class="top-month-plays">${first.plays} play${first.plays === 1 ? '' : 's'}</div>
      <div class="medal-rows">
        ${medalCells(second, '🥈', 'silver')}
        ${medalCells(third, '🥉', 'bronze')}
      </div>
    </div>
  `;
}

function setDualHTML(id1, id2, html) {
  const el1 = document.getElementById(id1);
  const el2 = document.getElementById(id2);
  if (el1) el1.innerHTML = html;
  if (el2) el2.innerHTML = html;
}

// ---------- Owner Status (owner only — Uptime Kuma + UPS) ----------
async function loadOwnerStatus() {
  try {
    const { monitors, ups } = await api('/api/owner/status');
    let html = '';
    if (ups) {
      const onBattery = ups.status.includes('OB');
      html += `
        <div class="ups-status">
          <div class="now-title">${escapeHtml(ups.model || 'UPS')}</div>
          <div class="now-meta">
            <span class="${dotClass(onBattery)}"></span>
            ${escapeHtml(formatUpsStatus(ups.status))}${ups.loadPercent != null ? ' · ' + ups.loadPercent + '% load' : ''}${ups.batteryRuntimeSeconds != null ? ' · ' + formatEta(ups.batteryRuntimeSeconds) + ' runtime' : ''}
          </div>
          ${ups.batteryChargePercent != null ? `<div class="bar"><div class="bar-fill" style="width:${ups.batteryChargePercent}%"></div></div>` : ''}
        </div>
      `;
    }
    if (monitors.length) {
      html += `<div class="monitor-pills">${monitors.map(m => `
        <span class="monitor-pill ${m.status}"><span class="${dotClass(m.status !== 'up')}"></span>${escapeHtml(m.name)}</span>
      `).join('')}</div>`;
    }
    setDualHTML('owner-body', 'modal-owner-body', html || '<p class="empty-state">Nothing configured.</p>');
  } catch (e) {
    setDualHTML('owner-body', 'modal-owner-body', '<p class="empty-state">Could not reach status sources.</p>');
  }
}

// ---------- Admin panel (owner only) ----------
async function loadAdminLogins() {
  try {
    const logins = await api('/api/owner/logins');
    const html = !logins.length ? '<p class="empty-state">No sign-ins recorded yet.</p>' : logins.map(l => `
      <div class="login-row">
        <img class="login-avatar" src="${l.thumb || ''}" onerror="this.style.visibility='hidden'">
        <div>
          <div class="login-name">${escapeHtml(l.username)}${l.isOwner ? ' · Owner' : ''}</div>
          <div class="login-time">${timeAgo(l.at)}</div>
        </div>
      </div>
    `).join('');
    setDualHTML('admin-logins-body', 'modal-admin-logins-body', html);
  } catch (e) {
    setDualHTML('admin-logins-body', 'modal-admin-logins-body', '<p class="empty-state">Could not load sign-ins.</p>');
  }
}

async function loadPendingRequests() {
  try {
    const results = await api('/api/overseerr/requests/pending');
    if (!results.length) {
      setDualHTML('admin-requests-body', 'modal-admin-requests-body', '<p class="empty-state">Nothing pending.</p>');
      return;
    }
    const html = results.map(r => `
      <div class="pending-row" data-id="${r.id}">
        <img class="result-poster" src="${r.poster || ''}" onerror="this.style.visibility='hidden'">
        <div class="result-info">
          <div class="result-title">${escapeHtml(r.title || 'Unknown title')}</div>
          <div class="pending-requester">
            <img src="${r.requestedByAvatar || ''}" onerror="this.style.visibility='hidden'">
            ${escapeHtml(r.requestedBy)} · ${timeAgo(r.requestedAt)}
          </div>
        </div>
        <div class="pending-actions">
          <button class="approve-btn pill-btn"><span class="state-dot"></span><span class="btn-label">Approve</span></button>
          <button class="decline-btn pill-btn"><span class="state-dot danger"></span><span class="btn-label">Decline</span></button>
        </div>
      </div>
    `).join('');
    setDualHTML('admin-requests-body', 'modal-admin-requests-body', html);
  } catch (e) {
    setDualHTML('admin-requests-body', 'modal-admin-requests-body', '<p class="empty-state">Could not load pending requests.</p>');
  }
}

async function handlePendingRequestClick(e) {
  const btn = e.target.closest('.approve-btn, .decline-btn');
  if (!btn) return;
  const row = btn.closest('.pending-row');
  const action = btn.classList.contains('approve-btn') ? 'approve' : 'decline';
  row.querySelectorAll('button').forEach(b => b.disabled = true);
  btn.querySelector('.btn-label').textContent = '…';
  try {
    await api(`/api/overseerr/requests/${row.dataset.id}/${action}`, { method: 'POST' });
    loadPendingRequests();
  } catch (e) {
    row.querySelectorAll('button').forEach(b => b.disabled = false);
    btn.querySelector('.btn-label').textContent = action === 'approve' ? 'Approve' : 'Decline';
  }
}

document.getElementById('admin-requests-body').addEventListener('click', handlePendingRequestClick);
const modalRequestsBody = document.getElementById('modal-admin-requests-body');
if (modalRequestsBody) modalRequestsBody.addEventListener('click', handlePendingRequestClick);

async function loadAdminIssues() {
  try {
    const results = await api('/api/overseerr/issues/open');
    if (!results.length) {
      setDualHTML('admin-issues-body', 'modal-admin-issues-body', '<p class="empty-state">Nothing open.</p>');
      return;
    }
    const html = results.map(r => `
      <div class="pending-row" data-id="${r.id}" data-title="${escapeHtml(r.title || 'Unknown title')}"
           data-media-type="${r.mediaType || ''}" data-tmdb-id="${r.tmdbId || ''}" data-tvdb-id="${r.tvdbId || ''}"
           data-season="${r.season || ''}" data-episode="${r.episode || ''}">
        <img class="result-poster" src="${r.poster || ''}" onerror="this.style.visibility='hidden'">
        <div class="result-info">
          <div class="result-title">${escapeHtml(r.title || 'Unknown title')}${r.season ? ` — S${r.season}E${r.episode}` : ''}</div>
          <div class="pending-requester">
            <img src="${r.reportedByAvatar || ''}" onerror="this.style.visibility='hidden'">
            ${escapeHtml(r.reportedBy)} · ${r.issueType} · ${timeAgo(r.reportedAt)}
          </div>
          ${r.message ? `<div class="issue-message">${escapeHtml(r.message)}</div>` : ''}
        </div>
        <div class="pending-actions">
          <button class="search-release-btn pill-btn"><span class="state-dot"></span><span class="btn-label">Search</span></button>
          <button class="approve-btn pill-btn"><span class="state-dot"></span><span class="btn-label">Resolve</span></button>
        </div>
      </div>
    `).join('');
    setDualHTML('admin-issues-body', 'modal-admin-issues-body', html);
  } catch (e) {
    setDualHTML('admin-issues-body', 'modal-admin-issues-body', '<p class="empty-state">Could not load issues.</p>');
  }
}

async function handleAdminIssuesClick(e) {
  const searchBtn = e.target.closest('.search-release-btn');
  if (searchBtn) {
    openReleaseModal(searchBtn.closest('.pending-row').dataset);
    return;
  }
  const btn = e.target.closest('.approve-btn');
  if (!btn) return;
  const row = btn.closest('.pending-row');
  row.querySelectorAll('button').forEach(b => b.disabled = true);
  btn.querySelector('.btn-label').textContent = '…';
  try {
    await api(`/api/overseerr/issues/${row.dataset.id}/resolve`, { method: 'POST' });
    loadAdminIssues();
  } catch (e) {
    row.querySelectorAll('button').forEach(b => b.disabled = false);
    btn.querySelector('.btn-label').textContent = 'Resolve';
  }
}

document.getElementById('admin-issues-body').addEventListener('click', handleAdminIssuesClick);
const modalIssuesBody = document.getElementById('modal-admin-issues-body');
if (modalIssuesBody) modalIssuesBody.addEventListener('click', handleAdminIssuesClick);

// ---------- Server Settings & Integration Health (owner only) ----------
let currentEnvConfig = {};

const SERVICE_CONFIG_SCHEMAS = {
  Plex: {
    title: 'Plex Server Configuration',
    fields: [
      { key: 'PLEX_SERVER_URL', label: 'Plex Server URL', placeholder: 'http://localhost:32400', hint: 'The internal or external URL to reach your Plex Media Server.' },
      { key: 'PLEX_ADMIN_TOKEN', label: 'Plex Admin Token', placeholder: 'Your X-Plex-Token', hint: 'Owner authentication token for Plex.' },
      { key: 'PLEX_MACHINE_ID', label: 'Plex Machine ID', placeholder: 'Plex machine identifier', hint: 'Found in Plex Settings > General, or via GET /identity.' },
      { key: 'PLEX_CLIENT_ID', label: 'Plex Client ID', placeholder: 'marquee-app-a1b2c3d4', hint: 'Stable UUID identifying Marquee to plex.tv.' }
    ]
  },
  Tautulli: {
    title: 'Tautulli Configuration',
    fields: [
      { key: 'TAUTULLI_URL', label: 'Tautulli URL', placeholder: 'http://localhost:8181', hint: 'URL to reach Tautulli.' },
      { key: 'TAUTULLI_API_KEY', label: 'Tautulli API Key', placeholder: 'API Key', hint: 'Tautulli > Settings > Web Interface > API Key.' },
      { key: 'TAUTULLI_LIBRARIES', label: 'Custom Libraries (Comma-separated Label:SectionID)', placeholder: 'Movies:1, TV Shows:2, Documentaries:4, 4K Movies:5', hint: 'Custom Plex libraries to display. E.g. Movies:1, TV Shows:2, Documentaries:4.' },
      { key: 'TAUTULLI_SECTION_MOVIES', label: 'Legacy Movies Section ID (Optional)', placeholder: '1', hint: 'Fallback section ID for movies.' },
      { key: 'TAUTULLI_SECTION_TV', label: 'Legacy TV Shows Section ID (Optional)', placeholder: '2', hint: 'Fallback section ID for TV shows.' },
      { key: 'TAUTULLI_SECTION_ANIME', label: 'Legacy Anime Section ID (Optional)', placeholder: '3', hint: 'Fallback section ID for anime.' }
    ]
  },
  Overseerr: {
    title: 'Overseerr / Jellyseerr Configuration',
    fields: [
      { key: 'OVERSEERR_URL', label: 'Overseerr URL', placeholder: 'http://localhost:5055', hint: 'URL to reach Overseerr.' },
      { key: 'OVERSEERR_API_KEY', label: 'Overseerr API Key', placeholder: 'API Key', hint: 'Overseerr > Settings > General > API Key.' },
      { key: 'OVERSEERR_WEBHOOK_SECRET', label: 'Webhook Authorization Secret', placeholder: 'Secret token', hint: 'Passed in Overseerr notification headers.' },
      { key: 'OVERSEERR_WEBHOOK_FORWARD_URL', label: 'Webhook Forward URL (Optional)', placeholder: 'https://...', hint: 'Forwards Overseerr webhooks to an existing integration.' }
    ]
  },
  Sonarr: {
    title: 'Sonarr Configuration',
    fields: [
      { key: 'SONARR_URL', label: 'Sonarr URL', placeholder: 'http://localhost:8989', hint: 'URL to reach Sonarr.' },
      { key: 'SONARR_API_KEY', label: 'Sonarr API Key', placeholder: 'API Key', hint: 'Sonarr > Settings > General > Security > API Key.' }
    ]
  },
  Radarr: {
    title: 'Radarr Configuration',
    fields: [
      { key: 'RADARR_URL', label: 'Radarr URL', placeholder: 'http://localhost:7878', hint: 'URL to reach Radarr.' },
      { key: 'RADARR_API_KEY', label: 'Radarr API Key', placeholder: 'API Key', hint: 'Radarr > Settings > General > Security > API Key.' }
    ]
  },
  qBittorrent: {
    title: 'qBittorrent Configuration',
    fields: [
      { key: 'QBITTORRENT_URL', label: 'qBittorrent WebUI URL', placeholder: 'http://localhost:9080', hint: 'URL to reach qBittorrent WebUI.' },
      { key: 'QBITTORRENT_USERNAME', label: 'Username', placeholder: 'admin', hint: 'WebUI username.' },
      { key: 'QBITTORRENT_PASSWORD', label: 'Password', placeholder: '••••••••', type: 'password', hint: 'WebUI password.' }
    ]
  },
  SABnzbd: {
    title: 'SABnzbd Configuration',
    fields: [
      { key: 'SABNZBD_URL', label: 'SABnzbd URL', placeholder: 'http://localhost:8080', hint: 'URL to reach SABnzbd.' },
      { key: 'SABNZBD_API_KEY', label: 'SABnzbd API Key', placeholder: 'API Key', hint: 'SABnzbd > Settings > General > API Key.' }
    ]
  },
  'Uptime Kuma': {
    title: 'Uptime Kuma Configuration',
    fields: [
      { key: 'UPTIME_KUMA_DB_PATH', label: 'Database File Path', placeholder: '/app/uptime-kuma-data/kuma.db', hint: 'SQLite DB path inside container.' },
      { key: 'UPTIME_KUMA_DATA_DIR', label: 'Host Data Directory', placeholder: '/path/to/kuma/data', hint: 'Mounted host path for Uptime Kuma.' }
    ]
  },
  'NUT UPS': {
    title: 'Network UPS Tools (NUT) Configuration',
    fields: [
      { key: 'NUT_HOST', label: 'NUT Host IP / Hostname', placeholder: '192.168.1.100', hint: 'Host running upsd server.' },
      { key: 'NUT_PORT', label: 'NUT Port', placeholder: '3493', hint: 'Default NUT port is 3493.' },
      { key: 'NUT_USERNAME', label: 'Username (Optional)', placeholder: 'monuser', hint: 'NUT authentication username.' },
      { key: 'NUT_PASSWORD', label: 'Password (Optional)', placeholder: '••••••••', type: 'password', hint: 'NUT authentication password.' },
      { key: 'NUT_UPS_NAME', label: 'UPS Device Name', placeholder: 'ups', hint: 'UPS device name configured in upsd.conf.' }
    ]
  },
  ServerDeployment: {
    title: 'Server & Branding Configuration',
    fields: [
      { key: 'SITE_NAME', label: 'Site Branding Name', placeholder: 'Marquee', hint: 'Shown as the page title, wordmark, and logo.' },
      { key: 'SITE_TAGLINES', label: 'Sign-in Taglines', placeholder: 'Tagline 1|Tagline 2', hint: 'Pipe-separated list (|) of rotating taglines.' },
      { key: 'PUBLIC_URL', label: 'Public Application URL', placeholder: 'https://media.example.com', hint: 'External domain or public URL.' },
      { key: 'COOKIE_SECURE', label: 'HTTPS Cookie Security Mode', type: 'select', options: [{ val: 'false', label: 'HTTP (Development)' }, { val: 'true', label: 'HTTPS (Secure)' }], hint: 'Set to HTTPS (Secure) when running behind an SSL reverse proxy.' },
      { key: 'HOST_PORT', label: 'Host Machine Port', placeholder: '4000', hint: 'External host port for reverse proxy mapping.' }
    ]
  }
};

async function loadServerSettings() {
  const body = document.getElementById('server-config-body');
  if (!body) return;
  try {
    const s = await api('/api/owner/settings');
    if (s.env) currentEnvConfig = s.env;
    const html = `
      <table class="config-table">
        <tbody>
          <tr><td class="config-key">Site Name</td><td class="config-val">${escapeHtml(s.siteName)}</td></tr>
          <tr><td class="config-key">Sign-in Taglines</td><td class="config-val">${escapeHtml(s.siteTaglines.join(' | '))}</td></tr>
          <tr><td class="config-key">Host Port</td><td class="config-val">${escapeHtml(String(s.hostPort))}</td></tr>
          <tr><td class="config-key">Public URL</td><td class="config-val">${s.publicUrl ? escapeHtml(s.publicUrl) : 'Not configured'}</td></tr>
          <tr><td class="config-key">Cookie Security</td><td class="config-val"><span class="config-pill ${s.cookieSecure ? 'yes' : 'no'}">${s.cookieSecure ? 'HTTPS (Secure)' : 'HTTP (Development)'}</span></td></tr>
          <tr><td class="config-key">Session DB Dir</td><td class="config-val">${escapeHtml(s.sessionDbDir)}</td></tr>
          <tr><td class="config-key">Overseerr Webhook Secret</td><td class="config-val"><span class="config-pill ${s.webhookSecretSet ? 'yes' : 'no'}">${s.webhookSecretSet ? 'Configured' : 'Not configured'}</span></td></tr>
          <tr><td class="config-key">Webhook Forwarding URL</td><td class="config-val">${s.webhookForwardUrl ? escapeHtml(s.webhookForwardUrl) : 'None'}</td></tr>
        </tbody>
      </table>
    `;
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not load server configuration.</p>';
  }
}

async function loadServiceHealth() {
  const grid = document.getElementById('service-health-grid');
  if (!grid) return;
  grid.innerHTML = '<p class="empty-state">Testing service connections…</p>';
  try {
    const { results } = await api('/api/owner/health');
    if (!results || !results.length) {
      grid.innerHTML = '<p class="empty-state">No services checked.</p>';
      return;
    }
    grid.innerHTML = results.map(r => {
      const isOk = r.status === 'ok';
      const isErr = r.status === 'error';
      const badgeText = isOk ? 'Online' : (isErr ? 'Error' : 'Unconfigured');
      const latencyText = r.latencyMs != null ? `⚡ ${r.latencyMs}ms` : '—';
      let detailText = 'Not configured';
      if (isOk) {
        if (r.details?.version) detailText = `v${r.details.version}`;
        else if (r.details?.monitorCount != null) detailText = `${r.details.monitorCount} monitors`;
        else if (r.details?.batteryChargePercent != null) detailText = `UPS Battery ${r.details.batteryChargePercent}%`;
        else detailText = 'Operational';
      } else if (isErr) {
        detailText = r.error || 'Connection failed';
      }
      return `
        <div class="health-card clickable" data-service="${escapeHtml(r.name)}">
          <div class="health-card-head">
            <span class="health-card-title">${escapeHtml(r.name)}</span>
            <span class="health-badge ${r.status}">${badgeText}</span>
          </div>
          <div class="health-card-latency">${latencyText}</div>
          <div class="health-card-footer">
            <span class="health-card-details">${escapeHtml(detailText)}</span>
            <span class="card-edit-btn">Edit &#9998;</span>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    grid.innerHTML = '<p class="empty-state">Could not run health check.</p>';
  }
}

const serviceHealthGrid = document.getElementById('service-health-grid');
if (serviceHealthGrid) {
  serviceHealthGrid.addEventListener('click', e => {
    const card = e.target.closest('.health-card');
    if (card && card.dataset.service) {
      openEditSettingModal(card.dataset.service);
    }
  });
}

const editServerConfigBtn = document.getElementById('edit-server-config-btn');
if (editServerConfigBtn) {
  editServerConfigBtn.addEventListener('click', () => {
    openEditSettingModal('ServerDeployment');
  });
}

// Edit Setting Modal logic
const editSettingModal = document.getElementById('edit-setting-modal');
const editModalTitle = document.getElementById('edit-modal-title');
const editModalFormBody = document.getElementById('edit-modal-form-body');
const editModalStatus = document.getElementById('edit-modal-status');

function openEditSettingModal(serviceKey) {
  const schema = SERVICE_CONFIG_SCHEMAS[serviceKey];
  if (!schema || !editSettingModal) return;

  editModalTitle.textContent = schema.title;
  if (editModalStatus) {
    editModalStatus.textContent = '';
    editModalStatus.className = 'report-status';
  }

  let html = '';
  schema.fields.forEach(f => {
    const val = currentEnvConfig[f.key] || '';
    html += `<div class="setting-field">`;
    html += `<label for="setting-input-${f.key}">${escapeHtml(f.label)}</label>`;
    if (f.type === 'select') {
      html += `<select id="setting-input-${f.key}" data-key="${f.key}">`;
      (f.options || []).forEach(opt => {
        const selected = (val === opt.val) ? 'selected' : '';
        html += `<option value="${opt.val}" ${selected}>${escapeHtml(opt.label)}</option>`;
      });
      html += `</select>`;
    } else {
      const inputType = f.type || 'text';
      html += `<input id="setting-input-${f.key}" type="${inputType}" data-key="${f.key}" value="${escapeHtml(val)}" placeholder="${escapeHtml(f.placeholder || '')}" autocomplete="off">`;
    }
    if (f.hint) {
      html += `<div class="setting-hint">${escapeHtml(f.hint)}</div>`;
    }
    if (f.key === 'TAUTULLI_LIBRARIES') {
      html += `<button type="button" class="btn btn-secondary btn-sm" id="detect-libraries-btn" style="margin-top: 6px; font-size: 0.8rem; padding: 4px 10px;">Auto-Detect Libraries from Tautulli</button>`;
    }
    html += `</div>`;
  });

  editModalFormBody.innerHTML = html;

  const detectBtn = document.getElementById('detect-libraries-btn');
  if (detectBtn) {
    detectBtn.addEventListener('click', async () => {
      detectBtn.disabled = true;
      detectBtn.textContent = 'Detecting…';
      try {
        const libs = await api('/api/tautulli/libraries');
        if (Array.isArray(libs) && libs.length > 0) {
          const val = libs.map(l => `${l.name}:${l.sectionId}`).join(', ');
          const input = document.getElementById('setting-input-TAUTULLI_LIBRARIES');
          if (input) input.value = val;
          if (editModalStatus) {
            editModalStatus.textContent = `Detected ${libs.length} libraries! Click 'Save Changes' to apply.`;
            editModalStatus.className = 'report-status ok';
          }
        } else {
          if (editModalStatus) {
            editModalStatus.textContent = 'No libraries returned by Tautulli.';
            editModalStatus.className = 'report-status error';
          }
        }
      } catch (e) {
        if (editModalStatus) {
          editModalStatus.textContent = 'Could not fetch libraries from Tautulli. Verify Tautulli URL & API Key.';
          editModalStatus.className = 'report-status error';
        }
      } finally {
        detectBtn.disabled = false;
        detectBtn.textContent = 'Auto-Detect Libraries from Tautulli';
      }
    });
  }

  editSettingModal.classList.remove('hidden');
}

const closeEditSettingBtn = document.getElementById('close-edit-setting-btn');
if (closeEditSettingBtn) {
  closeEditSettingBtn.addEventListener('click', () => editSettingModal.classList.add('hidden'));
}
const cancelEditSettingBtn = document.getElementById('cancel-edit-setting-btn');
if (cancelEditSettingBtn) {
  cancelEditSettingBtn.addEventListener('click', () => editSettingModal.classList.add('hidden'));
}

const editSettingForm = document.getElementById('edit-setting-form');
if (editSettingForm) {
  editSettingForm.addEventListener('submit', async e => {
    e.preventDefault();
    const saveBtn = document.getElementById('save-setting-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    if (editModalStatus) editModalStatus.textContent = '';

    const inputs = editModalFormBody.querySelectorAll('[data-key]');
    const updates = {};
    inputs.forEach(input => {
      updates[input.dataset.key] = input.value;
    });

    try {
      await api('/api/owner/settings', {
        method: 'POST',
        body: JSON.stringify(updates)
      });

      for (const [k, v] of Object.entries(updates)) {
        currentEnvConfig[k] = v;
      }

      if (editModalStatus) {
        editModalStatus.textContent = 'Settings saved successfully!';
        editModalStatus.className = 'report-status ok';
      }

      setTimeout(() => {
        editSettingModal.classList.add('hidden');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
        loadServerSettings();
        loadServiceHealth();
      }, 600);
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
      if (editModalStatus) {
        editModalStatus.textContent = err.message || 'Failed to save settings.';
        editModalStatus.className = 'report-status error';
      }
    }
  });
}

// ---------- Admin & Settings Modal ----------
const adminSettingsModal = document.getElementById('admin-settings-modal');

function openAdminSettingsModal() {
  if (!adminSettingsModal) return;
  adminSettingsModal.classList.remove('hidden');
  loadOwnerStatus();
  loadAdminLogins();
  loadPendingRequests();
  loadAdminIssues();
  loadServerSettings();
  loadServiceHealth();
}

const adminSettingsBtn = document.getElementById('admin-settings-btn');
if (adminSettingsBtn) adminSettingsBtn.addEventListener('click', openAdminSettingsModal);

document.querySelectorAll('.open-admin-settings-btn').forEach(btn => {
  btn.addEventListener('click', openAdminSettingsModal);
});

const closeAdminSettingsBtn = document.getElementById('close-admin-settings-btn');
if (closeAdminSettingsBtn) {
  closeAdminSettingsBtn.addEventListener('click', () => {
    adminSettingsModal.classList.add('hidden');
  });
}

// Admin Modal Tabs
const tabAdminOverviewBtn = document.getElementById('tab-admin-overview-btn');
const tabAdminStatusBtn = document.getElementById('tab-admin-status-btn');
const tabAdminHealthBtn = document.getElementById('tab-admin-health-btn');

const adminTabOverview = document.getElementById('admin-tab-overview');
const adminTabStatus = document.getElementById('admin-tab-status');
const adminTabHealth = document.getElementById('admin-tab-health');

if (tabAdminOverviewBtn) {
  tabAdminOverviewBtn.addEventListener('click', () => {
    tabAdminOverviewBtn.classList.add('active');
    tabAdminStatusBtn.classList.remove('active');
    tabAdminHealthBtn.classList.remove('active');
    adminTabOverview.classList.remove('hidden');
    adminTabStatus.classList.add('hidden');
    adminTabHealth.classList.add('hidden');
  });
}

if (tabAdminStatusBtn) {
  tabAdminStatusBtn.addEventListener('click', () => {
    tabAdminOverviewBtn.classList.remove('active');
    tabAdminStatusBtn.classList.add('active');
    tabAdminHealthBtn.classList.remove('active');
    adminTabOverview.classList.add('hidden');
    adminTabStatus.classList.remove('hidden');
    adminTabHealth.classList.add('hidden');
  });
}

if (tabAdminHealthBtn) {
  tabAdminHealthBtn.addEventListener('click', () => {
    tabAdminOverviewBtn.classList.remove('active');
    tabAdminStatusBtn.classList.remove('active');
    tabAdminHealthBtn.classList.add('active');
    adminTabOverview.classList.add('hidden');
    adminTabStatus.classList.add('hidden');
    adminTabHealth.classList.remove('hidden');
  });
}

const refreshHealthBtn = document.getElementById('refresh-health-btn');
if (refreshHealthBtn) refreshHealthBtn.addEventListener('click', loadServiceHealth);

// ---------- Release search modal (owner only) ----------
// Interactive search against Radarr/Sonarr's own configured indexers, so a
// bad/wrong release reported as an issue can be fixed without leaving the
// dashboard. Can take up to ~a minute — this is a live indexer search, not a
// cached lookup, same as Sonarr/Radarr's own "Interactive Search" UI.
function formatBytes(bytes) {
  if (!bytes) return '';
  return (bytes / (1024 ** 3)).toFixed(1) + ' GB';
}

async function openReleaseModal(ctx) {
  const modal = document.getElementById('release-modal');
  const listEl = document.getElementById('release-list');
  document.getElementById('release-modal-title').textContent = ctx.title +
    (ctx.season ? ` — S${ctx.season}E${ctx.episode}` : '');
  listEl.innerHTML = '<p class="empty-state">Searching indexers… this can take up to a minute.</p>';
  modal.classList.remove('hidden');

  const isMovie = ctx.mediaType === 'movie';
  const url = isMovie
    ? `/api/radarr/releases?tmdbId=${ctx.tmdbId}`
    : `/api/sonarr/releases?tvdbId=${ctx.tvdbId}&season=${ctx.season}&episode=${ctx.episode}`;
  const grabUrl = isMovie ? '/api/radarr/releases/grab' : '/api/sonarr/releases/grab';

  try {
    const releases = await api(url);
    if (!releases.length) { listEl.innerHTML = '<p class="empty-state">No releases found.</p>'; return; }
    listEl.innerHTML = releases.map(r => `
      <div class="release-row ${r.rejected ? 'rejected' : ''}">
        <div class="release-info">
          <div class="release-title" title="${escapeHtml(r.title)}">${escapeHtml(r.title)}</div>
          <div class="release-meta">
            ${escapeHtml(r.quality || 'Unknown')} · ${formatBytes(r.sizeBytes)} · ${escapeHtml(r.indexer)}
            · ${r.protocol === 'torrent' ? `${r.seeders ?? 0} seeders` : `${r.ageDays ?? '?'}d old`}
          </div>
          ${r.rejected ? `<div class="release-rejections">${escapeHtml(r.rejections.join(', '))}</div>` : ''}
        </div>
        <button class="grab-btn pill-btn" data-guid="${escapeHtml(r.guid)}" data-indexer-id="${r.indexerId}">
          <span class="state-dot"></span><span class="btn-label">Grab</span>
        </button>
      </div>
    `).join('');
  } catch (e) {
    listEl.innerHTML = `<p class="empty-state">${escapeHtml(e.message || 'Search failed.')}</p>`;
  }

  listEl.onclick = async e => {
    const btn = e.target.closest('.grab-btn');
    if (!btn) return;
    btn.disabled = true;
    btn.querySelector('.btn-label').textContent = 'Grabbing…';
    try {
      await api(grabUrl, {
        method: 'POST',
        body: JSON.stringify({ guid: btn.dataset.guid, indexerId: Number(btn.dataset.indexerId) })
      });
      btn.querySelector('.btn-label').textContent = 'Grabbed ✓';
    } catch (err) {
      btn.disabled = false;
      btn.querySelector('.btn-label').textContent = 'Grab';
    }
  };
}

document.getElementById('close-release-modal-btn').addEventListener('click', () => {
  document.getElementById('release-modal').classList.add('hidden');
});

function formatUpsStatus(status) {
  const flags = {
    OL: 'Online', OB: 'On Battery', LB: 'Low Battery', CHRG: 'Charging', DISCHRG: 'Discharging',
    RB: 'Replace Battery', BYPASS: 'Bypass', CAL: 'Calibrating', OFF: 'Offline', OVER: 'Overloaded',
    TRIM: 'Trimming', BOOST: 'Boosting', FSD: 'Forced Shutdown'
  };
  return status.split(' ').map(f => flags[f] || f).join(' · ');
}

// ---------- Request modal ----------
const modal = document.getElementById('request-modal');
function openRequestModal() {
  closeSeasonPicker();
  modal.classList.remove('hidden');
  const searchInput = document.getElementById('search-input');
  searchInput.value = '';
  searchInput.focus();
  loadDiscover();
}
// Header icon button on desktop, floating button on mobile (see CSS) — both
// trigger the same modal.
document.getElementById('search-btn').addEventListener('click', openRequestModal);
document.getElementById('fab-request-btn').addEventListener('click', openRequestModal);
document.getElementById('close-modal-btn').addEventListener('click', () => {
  modal.classList.add('hidden');
  closeSeasonPicker();
  document.getElementById('tab-search-btn').click();
});

// ---------- Request modal tabs ----------
const tabSearchBtn = document.getElementById('tab-search-btn');
const tabMyRequestsBtn = document.getElementById('tab-myrequests-btn');
const searchTab = document.getElementById('search-tab');
const myRequestsTab = document.getElementById('myrequests-tab');
let myRequestsLoaded = false;

tabSearchBtn.addEventListener('click', () => {
  tabSearchBtn.classList.add('active');
  tabMyRequestsBtn.classList.remove('active');
  searchTab.classList.remove('hidden');
  myRequestsTab.classList.add('hidden');
});

tabMyRequestsBtn.addEventListener('click', () => {
  tabMyRequestsBtn.classList.add('active');
  tabSearchBtn.classList.remove('active');
  myRequestsTab.classList.remove('hidden');
  searchTab.classList.add('hidden');
  // Lazy-loaded on first visit to the tab, then left cached for the rest of
  // this modal session — requests don't change status fast enough to need
  // refetching every time the tab is reopened within the same visit.
  if (!myRequestsLoaded) {
    myRequestsLoaded = true;
    loadMyRequests();
  }
});

async function loadMyRequests() {
  const listEl = document.getElementById('my-requests-list');
  try {
    const results = await api('/api/overseerr/requests/mine');
    if (!results.length) {
      listEl.innerHTML = '<p class="empty-state">No requests yet.</p>';
      return;
    }
    const statusText = { available: 'Available', downloading: 'Downloading', pending: 'Pending Approval', declined: 'Declined' };
    listEl.innerHTML = results.map(r => `
      <div class="my-request-row">
        <img class="result-poster" src="${r.poster || ''}" onerror="this.style.visibility='hidden'">
        <div class="result-info">
          <div class="result-title">${escapeHtml(r.title || 'Unknown title')}</div>
          <div class="my-request-status ${r.availability}">
            <span class="status-dot"></span>${statusText[r.availability] || r.availability}
          </div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    listEl.innerHTML = '<p class="empty-state">Could not load requests.</p>';
  }
}

// Shared by the discover feed and actual search results — same item shape
// from the backend (routes/overseerr.js's mapDiscoverItem), same row markup.
// Keeps the last-rendered array around so a row click can look itself up by
// index and open the info modal with full details before requesting.
let currentSearchResults = [];
function renderSearchResults(results, emptyMessage) {
  currentSearchResults = results;
  const resultsEl = document.getElementById('search-results');
  if (!results.length) { resultsEl.innerHTML = `<p class="empty-state">${emptyMessage}</p>`; return; }
  resultsEl.innerHTML = results.map((r, idx) => `
    <div class="result-item" data-idx="${idx}">
      <img class="result-poster" src="${r.poster || ''}" onerror="this.style.visibility='hidden'">
      <div class="result-info">
        <div class="result-title">${escapeHtml(r.title)}</div>
        <div class="result-year">${r.year || ''} · ${r.mediaType === 'tv' ? 'Series' : 'Movie'}</div>
      </div>
      <button class="request-btn pill-btn ${r.availability === 'available' ? 'available' : ''}" data-id="${r.id}" data-type="${r.mediaType}" data-title="${escapeHtml(r.title)}" ${r.availability !== 'none' ? 'disabled' : ''}>
        <span class="state-dot ${r.availability === 'available' ? '' : 'paused'}"></span>
        <span class="btn-label">${r.availability === 'available' ? '✓ In Plex' : r.availability === 'requested' ? 'Requested' : 'Request'}</span>
      </button>
    </div>
  `).join('');
}

// Shown by default when the request modal opens (and whenever the search box
// is cleared) — trending + upcoming, already filtered server-side to things
// not already in the library or requested. Cached for the rest of the page
// session so reopening the modal doesn't refetch every time.
let discoverCache = null;
async function loadDiscover() {
  document.getElementById('discover-label').classList.remove('hidden');
  if (discoverCache) { renderSearchResults(discoverCache, 'Nothing to show.'); return; }
  document.getElementById('search-results').innerHTML = '<p class="empty-state">Loading…</p>';
  try {
    discoverCache = await api('/api/overseerr/discover');
    renderSearchResults(discoverCache, 'Nothing to show.');
  } catch (e) {
    document.getElementById('search-results').innerHTML = '<p class="empty-state">Could not load trending titles.</p>';
  }
}

let searchTimer;
document.getElementById('search-input').addEventListener('input', e => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (!q) { loadDiscover(); return; }
  document.getElementById('discover-label').classList.add('hidden');
  searchTimer = setTimeout(async () => {
    try {
      const results = await api(`/api/overseerr/search?q=${encodeURIComponent(q)}`);
      renderSearchResults(results, 'No results.');
    } catch (e) {
      document.getElementById('search-results').innerHTML = '<p class="empty-state">Search failed.</p>';
    }
  }, 400);
});

document.getElementById('search-results').addEventListener('click', async e => {
  const btn = e.target.closest('.request-btn');
  if (btn && !btn.disabled) {
    const id = Number(btn.dataset.id);
    const mediaType = btn.dataset.type;

    // TV shows go through the season picker instead of requesting the whole
    // series outright — movies have no seasons, so those still request directly.
    if (mediaType === 'tv') {
      openSeasonPicker(id, btn.dataset.title, btn);
      return;
    }
    btn.disabled = true;
    btn.querySelector('.btn-label').textContent = '…';
    try {
      await api('/api/overseerr/request', {
        method: 'POST',
        body: JSON.stringify({ id, mediaType })
      });
      btn.querySelector('.btn-label').textContent = 'Requested';
    } catch (e) {
      btn.disabled = false;
      btn.querySelector('.btn-label').textContent = 'Failed — retry';
    }
    return;
  }

  // Anywhere else in the row (poster, title, or a disabled/already-handled
  // button) — show details before committing to a request.
  const item = e.target.closest('.result-item');
  if (!item) return;
  const r = currentSearchResults[Number(item.dataset.idx)];
  if (!r) return;
  openInfo({
    poster: r.poster, title: r.title,
    badge: r.mediaType === 'tv' ? 'SERIES' : 'MOVIE',
    meta: r.year || '',
    overview: r.overview,
    request: r
  });
});

// ---------- Season picker ----------
let seasonPickerContext = null; // { id, button }

async function openSeasonPicker(id, title, button) {
  const listEl = document.getElementById('season-picker-list');
  const submitBtn = document.getElementById('season-picker-submit');

  seasonPickerContext = { id, button };
  document.getElementById('season-picker-title').textContent = title;
  listEl.innerHTML = '<p class="empty-state">Loading seasons…</p>';
  submitBtn.disabled = false;
  submitBtn.textContent = 'Request Selected Seasons';
  document.getElementById('search-results').classList.add('hidden');
  document.getElementById('search-input').classList.add('hidden');
  document.getElementById('season-picker').classList.remove('hidden');

  try {
    const data = await api(`/api/overseerr/tv/${id}`);
    if (!data.seasons.length) {
      listEl.innerHTML = '<p class="empty-state">No seasons found.</p>';
      return;
    }
    // Already-available/already-requested seasons are shown but not selectable —
    // everything else defaults to checked, so "request the whole thing" is still
    // a single click, but individual seasons can be unchecked first.
    listEl.innerHTML = data.seasons.map(s => {
      const handled = s.available || s.requested;
      const statusText = s.available ? 'Available' : s.requested ? 'Requested' : '';
      return `
        <div class="season-row ${handled ? 'unavailable' : ''}">
          <input type="checkbox" value="${s.seasonNumber}" ${handled ? 'disabled' : 'checked'}>
          <span class="season-row-name">${escapeHtml(s.name || `Season ${s.seasonNumber}`)}</span>
          <span class="season-row-episodes">${s.episodeCount} ep</span>
          ${statusText ? `<span class="season-row-status">${statusText}</span>` : ''}
        </div>
      `;
    }).join('');
  } catch (e) {
    listEl.innerHTML = '<p class="empty-state">Could not load seasons.</p>';
  }
}

function closeSeasonPicker() {
  document.getElementById('season-picker').classList.add('hidden');
  document.getElementById('search-results').classList.remove('hidden');
  document.getElementById('search-input').classList.remove('hidden');
  seasonPickerContext = null;
}

document.getElementById('season-picker-back').addEventListener('click', closeSeasonPicker);

document.getElementById('season-picker-submit').addEventListener('click', async () => {
  if (!seasonPickerContext) return;
  const checked = [...document.querySelectorAll('#season-picker-list input[type="checkbox"]:checked')].map(cb => Number(cb.value));
  if (!checked.length) return;
  const submitBtn = document.getElementById('season-picker-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Requesting…';
  try {
    await api('/api/overseerr/request', {
      method: 'POST',
      body: JSON.stringify({ id: seasonPickerContext.id, mediaType: 'tv', seasons: checked })
    });
    seasonPickerContext.button.querySelector('.btn-label').textContent = 'Requested';
    seasonPickerContext.button.disabled = true;
    closeSeasonPicker();
  } catch (e) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Failed — retry';
  }
});

// ---------- Media info modal ----------
const infoModal = document.getElementById('info-modal');
let infoReportRatingKey = null;
let infoRequestItem = null; // the search/discover result the info modal is currently showing, if any

function openInfo({ poster, title, badge, meta, overview, stream, ratingKey, request }) {
  const posterEl = document.getElementById('info-poster');
  posterEl.style.visibility = ''; // undo a previous onerror hide before loading the next poster
  posterEl.src = poster || '';
  document.getElementById('info-title').textContent = title || '';
  document.getElementById('info-badge').textContent = badge || '';
  document.getElementById('info-meta').textContent = meta || '';
  document.getElementById('info-overview').textContent = overview || 'No synopsis available.';

  const streamEl = document.getElementById('info-stream');
  if (stream) {
    streamEl.innerHTML = renderStreamInfo(stream);
    streamEl.classList.remove('hidden');
  } else {
    streamEl.innerHTML = '';
    streamEl.classList.add('hidden');
  }

  // Shown when opened from a search/discover result — click the title/poster
  // for details first, then request from here instead of committing blind.
  infoRequestItem = request || null;
  const requestSection = document.getElementById('info-request-section');
  requestSection.classList.toggle('hidden', !request);
  if (request) {
    const btn = document.getElementById('info-request-btn');
    btn.disabled = request.availability !== 'none';
    btn.classList.toggle('available', request.availability === 'available');
    btn.querySelector('.state-dot').classList.toggle('paused', request.availability !== 'available');
    btn.querySelector('.btn-label').textContent = request.availability === 'available' ? '✓ In Plex'
      : request.availability === 'requested' ? 'Requested' : 'Request';
  }

  // Only offered for things that carry a Plex rating key (Now Playing/Recently
  // Watched) — upcoming/not-yet-available items (Airing Today, Releasing Soon)
  // have nothing to report a playback problem with yet.
  infoReportRatingKey = ratingKey || null;
  resetReportForm();
  document.getElementById('info-report-section').classList.toggle('hidden', !ratingKey);

  infoModal.classList.remove('hidden');
}

document.getElementById('info-request-btn').addEventListener('click', async () => {
  const btn = document.getElementById('info-request-btn');
  if (btn.disabled || !infoRequestItem) return;
  const { id, mediaType, title } = infoRequestItem;
  // The list this came from (search results/discover) has its own matching
  // row — updated alongside this button so it doesn't go stale if the user
  // doesn't close this modal right away.
  const inlineBtn = document.querySelector(`#search-results .request-btn[data-id="${id}"][data-type="${mediaType}"]`);

  if (mediaType === 'tv') {
    infoModal.classList.add('hidden');
    openSeasonPicker(id, title, inlineBtn || btn);
    return;
  }

  const targets = [...new Set([btn, inlineBtn].filter(Boolean))];
  targets.forEach(b => { b.disabled = true; b.querySelector('.btn-label').textContent = '…'; });
  try {
    await api('/api/overseerr/request', { method: 'POST', body: JSON.stringify({ id, mediaType }) });
    targets.forEach(b => b.querySelector('.btn-label').textContent = 'Requested');
  } catch (e) {
    targets.forEach(b => { b.disabled = false; b.querySelector('.btn-label').textContent = 'Failed — retry'; });
  }
});

function resetReportForm() {
  document.getElementById('info-report-form').classList.add('hidden');
  document.querySelectorAll('#info-report-form .report-type-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('report-message').value = '';
  const submitBtn = document.getElementById('report-submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Send report';
  const status = document.getElementById('report-status');
  status.textContent = '';
  status.className = 'report-status';
  selectedReportType = null;
}

let selectedReportType = null;

document.getElementById('info-report-btn').addEventListener('click', () => {
  document.getElementById('info-report-form').classList.toggle('hidden');
});

document.querySelectorAll('#info-report-form .report-type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#info-report-form .report-type-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedReportType = btn.dataset.type;
    document.getElementById('report-submit-btn').disabled = false;
  });
});

document.getElementById('report-submit-btn').addEventListener('click', async () => {
  if (!infoReportRatingKey || !selectedReportType) return;
  const submitBtn = document.getElementById('report-submit-btn');
  const status = document.getElementById('report-status');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Sending…';
  try {
    await api('/api/overseerr/issue', {
      method: 'POST',
      body: JSON.stringify({
        ratingKey: infoReportRatingKey,
        issueType: selectedReportType,
        message: document.getElementById('report-message').value
      })
    });
    status.textContent = 'Thanks — reported.';
    status.className = 'report-status ok';
    submitBtn.textContent = 'Send report';
  } catch (e) {
    status.textContent = e.message || 'Could not submit report.';
    status.className = 'report-status error';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send report';
  }
});

// ---------- Report-an-issue modal (searches the Plex library directly) ----------
// Lets an admin find *any* library item — not just something recently watched —
// to report on, e.g. relaying a problem a family member described over text.
const reportModal = document.getElementById('report-modal');
// Trail of { ratingKey, title } from the show down to wherever browsing currently
// is (show -> season), so "Back" can step up one level and "report an episode"
// can still label the form with the show's title.
let reportBrowseStack = [];
let reportSelectedRatingKey = null;
let reportFormSelectedType = null;

function openReportModal() {
  reportModal.classList.remove('hidden');
  reportBrowseStack = [];
  document.getElementById('report-search-input').value = '';
  document.getElementById('report-search-results').innerHTML = '';
  showReportView('search');
  document.getElementById('report-search-input').focus();
}
document.getElementById('report-search-btn').addEventListener('click', openReportModal);
document.getElementById('fab-report-btn').addEventListener('click', openReportModal);
document.getElementById('close-report-modal-btn').addEventListener('click', () => reportModal.classList.add('hidden'));

function showReportView(view) {
  document.getElementById('report-search-view').classList.toggle('hidden', view !== 'search');
  document.getElementById('report-browse-view').classList.toggle('hidden', view !== 'browse');
  document.getElementById('report-form-view').classList.toggle('hidden', view !== 'form');
}

let reportSearchTimer;
document.getElementById('report-search-input').addEventListener('input', e => {
  clearTimeout(reportSearchTimer);
  const q = e.target.value.trim();
  const resultsEl = document.getElementById('report-search-results');
  if (!q) { resultsEl.innerHTML = ''; return; }
  reportSearchTimer = setTimeout(async () => {
    try {
      const results = await api(`/api/plex/search?q=${encodeURIComponent(q)}`);
      resultsEl.innerHTML = results.map(r => `
        <div class="result-item" data-ratingkey="${r.ratingKey}" data-title="${escapeHtml(r.title)}" data-type="${r.type}" data-thumb="${r.thumb || ''}" data-year="${r.year || ''}">
          <img class="result-poster" src="${r.thumb || ''}" onerror="this.style.visibility='hidden'">
          <div class="result-info">
            <div class="result-title">${escapeHtml(r.title)}</div>
            <div class="result-year">${r.year || ''} · ${r.type === 'show' ? 'Series' : 'Movie'}</div>
          </div>
        </div>
      `).join('');
    } catch (e) {
      resultsEl.innerHTML = '<p class="empty-state">Search failed.</p>';
    }
  }, 400);
});

document.getElementById('report-search-results').addEventListener('click', e => {
  const item = e.target.closest('.result-item');
  if (!item) return;
  const { ratingkey, title, type, thumb, year } = item.dataset;
  if (type === 'show') {
    reportBrowseStack = [{ ratingKey: ratingkey, title }];
    loadReportBrowse(ratingkey, title);
  } else {
    openReportForm({ ratingKey: ratingkey, title, subtitle: year, poster: thumb });
  }
});

// Same endpoint drills both levels — a show's ratingKey returns seasons, a
// season's ratingKey returns episodes.
async function loadReportBrowse(ratingKey, title) {
  showReportView('browse');
  document.getElementById('report-browse-title').textContent = title;
  const listEl = document.getElementById('report-browse-list');
  listEl.innerHTML = '<p class="empty-state">Loading…</p>';
  try {
    const items = await api(`/api/plex/children/${ratingKey}`);
    listEl.innerHTML = items.map(i => `
      <div class="browse-row" data-ratingkey="${i.ratingKey}" data-title="${escapeHtml(i.title)}" data-type="${i.type}" data-thumb="${i.thumb || ''}">
        <img class="browse-row-thumb" src="${i.thumb || ''}" onerror="this.style.visibility='hidden'">
        <div class="browse-row-name">${i.type === 'episode' ? `${i.index}. ${escapeHtml(i.title)}` : escapeHtml(i.title)}</div>
      </div>
    `).join('');
  } catch (e) {
    listEl.innerHTML = '<p class="empty-state">Could not load.</p>';
  }
}

document.getElementById('report-browse-list').addEventListener('click', e => {
  const row = e.target.closest('.browse-row');
  if (!row) return;
  const { ratingkey, title, type, thumb } = row.dataset;
  if (type === 'episode') {
    const showTitle = reportBrowseStack[0]?.title || '';
    openReportForm({ ratingKey: ratingkey, title: showTitle, subtitle: title, poster: thumb });
  } else {
    reportBrowseStack.push({ ratingKey: ratingkey, title });
    loadReportBrowse(ratingkey, title);
  }
});

document.getElementById('report-browse-back').addEventListener('click', () => {
  reportBrowseStack.pop();
  const top = reportBrowseStack[reportBrowseStack.length - 1];
  if (top) loadReportBrowse(top.ratingKey, top.title);
  else showReportView('search');
});

document.getElementById('report-form-back').addEventListener('click', () => {
  const top = reportBrowseStack[reportBrowseStack.length - 1];
  if (top) loadReportBrowse(top.ratingKey, top.title);
  else showReportView('search');
});

function openReportForm({ ratingKey, title, subtitle, poster }) {
  showReportView('form');
  reportSelectedRatingKey = ratingKey;
  reportFormSelectedType = null;
  const posterEl = document.getElementById('report-form-poster');
  posterEl.style.visibility = '';
  posterEl.src = poster || '';
  document.getElementById('report-form-title').textContent = title || '';
  document.getElementById('report-form-subtitle').textContent = subtitle || '';
  document.querySelectorAll('#report-form-view .report-type-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('report-form-message').value = '';
  const submitBtn = document.getElementById('report-form-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Send report';
  const status = document.getElementById('report-form-status');
  status.textContent = '';
  status.className = 'report-status';
}

document.querySelectorAll('#report-form-view .report-type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#report-form-view .report-type-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    reportFormSelectedType = btn.dataset.type;
    document.getElementById('report-form-submit').disabled = false;
  });
});

document.getElementById('report-form-submit').addEventListener('click', async () => {
  if (!reportSelectedRatingKey || !reportFormSelectedType) return;
  const submitBtn = document.getElementById('report-form-submit');
  const status = document.getElementById('report-form-status');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Sending…';
  try {
    await api('/api/overseerr/issue', {
      method: 'POST',
      body: JSON.stringify({
        ratingKey: reportSelectedRatingKey,
        issueType: reportFormSelectedType,
        message: document.getElementById('report-form-message').value
      })
    });
    status.textContent = 'Thanks — reported.';
    status.className = 'report-status ok';
    submitBtn.textContent = 'Send report';
  } catch (e) {
    status.textContent = e.message || 'Could not submit report.';
    status.className = 'report-status error';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send report';
  }
});

// Stream info shown on a Now Playing item — sourced from Tautulli, deliberately
// excludes ip_address (this modal is visible to any signed-in family member).
function renderStreamInfo(stream) {
  const rows = [];
  if (stream.player) {
    rows.push(['Player', [stream.player, stream.product].filter(Boolean).join(' · ')]);
  }
  if (stream.decision) rows.push(['Playback', titleCase(stream.decision)]);
  const video = [stream.streamResolution, stream.videoCodec?.toUpperCase()].filter(Boolean).join(' ');
  if (video) {
    const downscaled = stream.originalResolution && stream.streamResolution && stream.originalResolution !== stream.streamResolution;
    rows.push(['Video', downscaled ? `${video} (from ${stream.originalResolution})` : video]);
  }
  const audio = [stream.audioCodec?.toUpperCase(), stream.audioChannels].filter(Boolean).join(' ');
  if (audio) rows.push(['Audio', audio]);
  if (stream.bandwidthKbps) rows.push(['Bandwidth', `${(stream.bandwidthKbps / 1000).toFixed(1)} Mbps`]);
  if (stream.location) rows.push(['Network', stream.location.toUpperCase()]);

  return rows.map(([label, value]) => `
    <dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>
  `).join('');
}

function titleCase(str) {
  return str.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1));
}
document.getElementById('close-info-btn').addEventListener('click', () => infoModal.classList.add('hidden'));
infoModal.addEventListener('click', e => { if (e.target === infoModal) infoModal.classList.add('hidden'); });

document.getElementById('now-playing-body').addEventListener('click', e => {
  const card = e.target.closest('.now-row');
  if (!card) return;
  const s = store.nowPlaying[Number(card.dataset.idx)];
  if (!s) return;
  openInfo({
    poster: s.thumb, title: s.title, badge: 'CH.01 · ON AIR',
    meta: `${s.user || ''} · ${s.quality || ''} · ${s.progress}% watched`,
    overview: s.overview,
    stream: s.stream,
    ratingKey: s.ratingKey
  });
});

let recentlyWatchedInfoRequest = 0; // guards against a slower earlier fetch overwriting a later click

document.getElementById('recently-watched-body').addEventListener('click', async e => {
  const card = e.target.closest('.now-row');
  if (!card) return;
  const i = store.recentlyWatched[Number(card.dataset.idx)];
  if (!i) return;
  openInfo({
    poster: i.thumb, title: i.title, badge: 'CH.02 · RECENTLY WATCHED',
    meta: `${i.finished ? 'Finished' : i.progress + '% watched'} · ${timeAgo(i.watchedAt)}`,
    overview: i.overview,
    ratingKey: i.ratingKey
  });
  // get_history (the recently-watched data source) has no synopsis field, unlike
  // the other panels — fetched lazily here and cached on the item so repeat
  // clicks on the same row don't re-fetch.
  if (i.overview == null) {
    const requestId = ++recentlyWatchedInfoRequest;
    try {
      const { overview } = await api(`/api/tautulli/metadata/${i.ratingKey}`);
      i.overview = overview;
      if (requestId === recentlyWatchedInfoRequest) {
        document.getElementById('info-overview').textContent = overview || 'No synopsis available.';
      }
    } catch (e) {
      i.overview = '';
    }
  }
});

document.getElementById('recently-added-body').addEventListener('click', e => {
  const card = e.target.closest('.poster-card');
  if (!card) return;
  const cat = card.dataset.cat;
  const list = store.recentlyAdded.all || store.recentlyAdded[cat] || [];
  const i = list[Number(card.dataset.idx)];
  if (!i) return;
  openInfo({
    poster: i.thumb, title: i.title, badge: 'CH.04 · RECENTLY ADDED',
    meta: `${i.year || ''} · added ${timeAgo(i.addedAt)}`,
    overview: i.overview
  });
});

document.getElementById('airing-today-body').addEventListener('click', e => {
  const card = e.target.closest('.poster-card');
  if (!card) return;
  const i = store.airingToday[Number(card.dataset.idx)];
  if (!i) return;
  openInfo({
    poster: i.poster, title: `${i.series} — ${i.episode}`, badge: 'CH.05 · AIRING TODAY',
    meta: `${i.title || ''} · ${i.hasFile ? 'Downloaded' : 'Airing'}`,
    overview: i.overview
  });
});

document.getElementById('upcoming-body').addEventListener('click', e => {
  const card = e.target.closest('.poster-card');
  if (!card) return;
  const i = store.upcoming[Number(card.dataset.idx)];
  if (!i) return;
  openInfo({
    poster: i.poster, title: i.title, badge: 'CH.06 · RELEASING SOON',
    meta: `Releases ${formatDate(i.releaseDate)}`,
    overview: i.overview
  });
});

// ---------- Helpers ----------
function dotClass(bad) {
  return 'state-dot' + (bad ? ' paused' : '');
}
function escapeHtml(str = '') {
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function timeAgo(ts) {
  // Accepts either an epoch-ms number (Tautulli/login log) or an ISO date string
  // (Overseerr's createdAt) — normalize through Date so both work.
  const mins = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
function formatDate(iso) {
  if (!iso) return 'TBA';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
