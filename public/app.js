const signinScreen = document.getElementById('signin-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const signinStatus = document.getElementById('signin-status');
const store = { nowPlaying: [], recentlyWatched: [], recentlyAdded: [], airingToday: [], upcoming: [] };

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
    document.getElementById('panel-owner').classList.remove('hidden');
    loadOwnerStatus();
    setInterval(loadOwnerStatus, 15000);
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
  // No reconnect logic needed here — EventSource retries automatically, and the
  // server always sends a fresh "full" snapshot as soon as a connection opens.
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
      <div class="poster-grid" style="margin-bottom:1rem;">
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
    const sections = [
      { label: 'Top Viewer', items: data.user, isUser: true },
      { label: 'Top Movie', items: data.movie },
      { label: 'Top TV Show', items: data.tv },
      { label: 'Top Anime', items: data.anime }
    ];
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

// ---------- Owner Status (owner only — Uptime Kuma + UPS) ----------
async function loadOwnerStatus() {
  const body = document.getElementById('owner-body');
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
    body.innerHTML = html || '<p class="empty-state">Nothing configured.</p>';
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not reach status sources.</p>';
  }
}

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
document.getElementById('search-btn').addEventListener('click', () => {
  closeSeasonPicker();
  modal.classList.remove('hidden');
  document.getElementById('search-input').focus();
});
document.getElementById('close-modal-btn').addEventListener('click', () => {
  modal.classList.add('hidden');
  closeSeasonPicker();
});

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
          <button class="request-btn" data-id="${r.id}" data-type="${r.mediaType}" data-title="${escapeHtml(r.title)}" ${r.status ? 'disabled' : ''}>
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
  const id = Number(btn.dataset.id);
  const mediaType = btn.dataset.type;

  // TV shows go through the season picker instead of requesting the whole
  // series outright — movies have no seasons, so those still request directly.
  if (mediaType === 'tv') {
    openSeasonPicker(id, btn.dataset.title, btn);
    return;
  }
  btn.disabled = true;
  btn.textContent = '…';
  try {
    await api('/api/overseerr/request', {
      method: 'POST',
      body: JSON.stringify({ id, mediaType })
    });
    btn.textContent = 'Requested';
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Failed — retry';
  }
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
    seasonPickerContext.button.textContent = 'Requested';
    seasonPickerContext.button.disabled = true;
    closeSeasonPicker();
  } catch (e) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Failed — retry';
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

let recentlyWatchedInfoRequest = 0; // guards against a slower earlier fetch overwriting a later click

document.getElementById('recently-watched-body').addEventListener('click', async e => {
  const card = e.target.closest('.now-row');
  if (!card) return;
  const i = store.recentlyWatched[Number(card.dataset.idx)];
  if (!i) return;
  openInfo({
    poster: i.thumb, title: i.title, badge: 'CH.02 · RECENTLY WATCHED',
    meta: `${i.finished ? 'Finished' : i.progress + '% watched'} · ${timeAgo(i.watchedAt)}`,
    overview: i.overview
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
