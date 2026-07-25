const signinScreen = document.getElementById('signin-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const signinStatus = document.getElementById('signin-status');
const store = { nowPlaying: [], continueWatching: [], recentlyAdded: [], airingToday: [], upcoming: [] };

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

// ---------- Sign in with Plex ----------
document.getElementById('plex-signin-btn').addEventListener('click', async () => {
  signinStatus.textContent = 'Requesting sign-in code…';
  try {
    const { code, clientId } = await api('/api/auth/plex/pin', { method: 'POST' });
    const authUrl = `https://app.plex.tv/auth#?clientID=${clientId}&code=${code}&context[device][product]=skyn3t`;
    window.open(authUrl, '_blank', 'width=480,height=700');
    signinStatus.textContent = 'Waiting for approval in the Plex window…';
    pollSignIn();
  } catch (e) {
    signinStatus.textContent = 'Could not start sign-in. Try again.';
  }
});

function pollSignIn() {
  const interval = setInterval(async () => {
    try {
      const result = await api('/api/auth/plex/poll');
      if (result.status === 'ok') {
        clearInterval(interval);
        signinStatus.textContent = `Welcome, ${result.user}.`;
        showDashboard();
      }
    } catch (e) {
      clearInterval(interval);
      signinStatus.textContent = e.message || 'This Plex account does not have access.';
    }
  }, 2000);
  // stop trying after 3 minutes
  setTimeout(() => clearInterval(interval), 3 * 60 * 1000);
}

// ---------- Session check on load ----------
(async function init() {
  try {
    const me = await api('/api/auth/me');
    document.getElementById('whoami').textContent = me.username;
    showDashboard();
  } catch (e) {
    signinScreen.classList.remove('hidden');
  }
})();

function showDashboard() {
  signinScreen.classList.add('hidden');
  dashboardScreen.classList.remove('hidden');
  setHeroDate();
  loadNowPlaying();
  loadContinueWatching();
  loadRecentlyAdded();
  loadAiringToday();
  loadUpcoming();
  setInterval(loadNowPlaying, 15000); // keep "live" panel fresh
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
async function loadNowPlaying() {
  const body = document.getElementById('now-playing-body');
  const headline = document.getElementById('hero-headline');
  const indicator = document.getElementById('live-indicator');
  try {
    const sessions = await api('/api/tautulli/now-playing');
    store.nowPlaying = sessions;
    headline.textContent = sessions.length
      ? `${sessions.length} stream${sessions.length === 1 ? '' : 's'} live right now`
      : 'Nothing playing right now';
    indicator.style.visibility = sessions.length ? 'visible' : 'hidden';
    if (!sessions.length) {
      body.innerHTML = '<p class="empty-state">Nothing playing right now.</p>';
      return;
    }
    body.innerHTML = sessions.map((s, idx) => `
      <div class="now-row" data-idx="${idx}">
        <img class="thumb" src="${s.thumb || ''}" onerror="this.style.visibility='hidden'">
        <div style="flex:1; min-width:0;">
          <div class="now-title">${escapeHtml(s.title)}</div>
          <div class="now-meta"><span class="state-dot ${s.state === 'paused' ? 'paused' : ''}"></span>${escapeHtml(s.user || '')} · ${s.quality || ''} · ${s.state}</div>
          <div class="bar"><div class="bar-fill" style="width:${s.progress}%"></div></div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    headline.textContent = 'Could not reach Plex';
    body.innerHTML = '<p class="empty-state">Could not reach Plex.</p>';
  }
}

// ---------- Continue Watching ----------
async function loadContinueWatching() {
  const body = document.getElementById('continue-watching-body');
  try {
    const items = await api('/api/plex/on-deck');
    store.continueWatching = items;
    if (!items.length) { body.innerHTML = '<p class="empty-state">Nothing in progress.</p>'; return; }
    body.innerHTML = items.map((i, idx) => `
      <div class="poster-card" data-idx="${idx}">
        <div class="poster-frame">
          <img class="poster-img" src="${i.thumb || ''}" onerror="this.style.visibility='hidden'">
          <span class="poster-badge">${escapeHtml(i.subtitle || '')}</span>
          <div class="poster-overlay"><span class="poster-overlay-text">${escapeHtml(i.title)}</span></div>
          <div class="poster-progress"><div class="poster-progress-fill" style="width:${i.progress}%"></div></div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not reach Plex.</p>';
  }
}

// ---------- Recently Added ----------
async function loadRecentlyAdded() {
  const body = document.getElementById('recently-added-body');
  try {
    const data = await api('/api/tautulli/recently-added');
    store.recentlyAdded = data;

    const sections = data.all
      ? [{ key: 'all', label: null, items: data.all }]
      : [
          { key: 'movies', label: 'Movies', items: data.movies || [] },
          { key: 'tv', label: 'TV Shows', items: data.tv || [] },
          { key: 'anime', label: 'Anime', items: data.anime || [] }
        ].filter(s => s.items.length);

    if (!sections.length || sections.every(s => !s.items.length)) {
      body.innerHTML = '<p class="empty-state">Nothing added recently.</p>';
      return;
    }

    body.innerHTML = sections.map(s => `
      ${s.label ? `<div class="subsection-label">${s.label}</div>` : ''}
      <div class="poster-grid poster-grid-6" style="margin-bottom:1rem;">
        ${s.items.map((i, idx) => `
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

// ---------- Request modal ----------
const modal = document.getElementById('request-modal');
document.getElementById('search-btn').addEventListener('click', () => {
  modal.classList.remove('hidden');
  document.getElementById('search-input').focus();
});
document.getElementById('close-modal-btn').addEventListener('click', () => modal.classList.add('hidden'));

let searchTimer;
document.getElementById('search-input').addEventListener('input', e => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  const resultsEl = document.getElementById('search-results');
  if (!q) { resultsEl.innerHTML = ''; return; }
  searchTimer = setTimeout(async () => {
    try {
      const results = await api(`/api/overseerr/search?q=${encodeURIComponent(q)}`);
      resultsEl.innerHTML = results.map(r => `
        <div class="result-item">
          <img class="result-poster" src="${r.poster || ''}" onerror="this.style.visibility='hidden'">
          <div class="result-info">
            <div class="result-title">${escapeHtml(r.title)}</div>
            <div class="result-year">${r.year || ''} · ${r.mediaType === 'tv' ? 'Series' : 'Movie'}</div>
          </div>
          <button class="request-btn" data-id="${r.id}" data-type="${r.mediaType}" ${r.status ? 'disabled' : ''}>
            ${r.status ? 'Requested' : 'Request'}
          </button>
        </div>
      `).join('');
    } catch (e) {
      resultsEl.innerHTML = '<p class="empty-state">Search failed.</p>';
    }
  }, 400);
});

document.getElementById('search-results').addEventListener('click', async e => {
  const btn = e.target.closest('.request-btn');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.textContent = '…';
  try {
    await api('/api/overseerr/request', {
      method: 'POST',
      body: JSON.stringify({ id: Number(btn.dataset.id), mediaType: btn.dataset.type })
    });
    btn.textContent = 'Requested';
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Failed — retry';
  }
});

// ---------- Media info modal ----------
const infoModal = document.getElementById('info-modal');

function openInfo({ poster, title, badge, meta, overview, stream }) {
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

  infoModal.classList.remove('hidden');
}

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
    stream: s.stream
  });
});

document.getElementById('continue-watching-body').addEventListener('click', e => {
  const card = e.target.closest('.poster-card');
  if (!card) return;
  const i = store.continueWatching[Number(card.dataset.idx)];
  if (!i) return;
  openInfo({
    poster: i.thumb, title: i.episodeTitle ? `${i.title} — ${i.episodeTitle}` : i.title, badge: 'CH.02 · CONTINUE WATCHING',
    meta: `${i.subtitle || ''} · ${i.progress}% watched`,
    overview: i.overview
  });
});

document.getElementById('recently-added-body').addEventListener('click', e => {
  const card = e.target.closest('.poster-card');
  if (!card) return;
  const cat = card.dataset.cat;
  const list = store.recentlyAdded.all || store.recentlyAdded[cat] || [];
  const i = list[Number(card.dataset.idx)];
  if (!i) return;
  openInfo({
    poster: i.thumb, title: i.title, badge: 'CH.03 · RECENTLY ADDED',
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
    poster: i.poster, title: `${i.series} — ${i.episode}`, badge: 'CH.04 · AIRING TODAY',
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
    poster: i.poster, title: i.title, badge: 'CH.05 · RELEASING SOON',
    meta: `Releases ${formatDate(i.releaseDate)}`,
    overview: i.overview
  });
});

// ---------- Helpers ----------
function escapeHtml(str = '') {
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function timeAgo(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
function formatDate(iso) {
  if (!iso) return 'TBA';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
