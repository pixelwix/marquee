const signinScreen = document.getElementById('signin-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const signinStatus = document.getElementById('signin-status');
const store = { nowPlaying: [], recentlyWatched: [], recentlyAdded: [], airingToday: [], upcoming: [] };

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

let isOwner = false;

function showDashboard(owner) {
  isOwner = owner;
  signinScreen.classList.add('hidden');
  dashboardScreen.classList.remove('hidden');
  startPlexUptime();
  setHeroDate();
  loadNotice();
  loadHeroBanners();
  connectNowPlayingStream();
  loadRecentlyWatched();
  loadTopOfMonth();
  loadRecentlyAdded();
  loadAiringToday();
  loadUpcoming();
  loadDownloads();
  setInterval(loadDownloads, 5000);
  loadReportFlagStatus();
  initNotifyToggle();
  // Everything owner-only (sign-ins, pending requests, issues, system status,
  // stack management) lives on its own page now instead of crowding this one.
  document.getElementById('admin-link-btn').classList.toggle('hidden', !isOwner);
}

// Re-runs everything showDashboard() loads, minus the one-time setup calls —
// connectNowPlayingStream() opens its own persistent EventSource (calling it
// again would open a second one), and startPlexUptime()/setInterval belong to
// timers that already run on their own cadence. Used by pull-to-refresh.js.
function refreshDashboard() {
  return Promise.all([
    loadNotice(),
    loadHeroBanners(),
    loadRecentlyWatched(),
    loadTopOfMonth(),
    loadRecentlyAdded(),
    loadAiringToday(),
    loadUpcoming(),
    loadDownloads(),
  ]);
}

function setHeroDate() {
  const now = new Date();
  document.getElementById('date-num').textContent = now.getDate();
  document.getElementById('date-txt').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'short' });
}

// ---------- Notice board ----------
// Owner-scheduled announcement (e.g. planned maintenance) — checked once on
// load, not pushed live; the scheduling use case (e.g. "starts Monday 9am")
// doesn't need it to appear mid-session without a refresh.
async function loadNotice() {
  const banner = document.getElementById('notice-banner');
  try {
    const notice = await api('/api/notice');
    if (notice) {
      document.getElementById('notice-banner-text').textContent = notice.message;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  } catch (e) {
    banner.classList.add('hidden');
  }
}

// ---------- Hero backdrop banner ----------
// Cycles through wide backdrop images behind the header, sourced from
// Overseerr's trending/discover feed (same data already used by the request
// modal's default view). Falls back to this month's top movie/TV/anime
// posters if Overseerr isn't configured/reachable or has nothing with a
// backdrop — a portrait poster in a landscape slot isn't ideal, but it's a
// reasonable degrade rather than showing nothing.
let heroBanners = [];
let heroBannerIndex = 0;
let heroBannerTimer = null;

async function loadHeroBanners() {
  let items = [];
  try {
    const discover = await api('/api/overseerr/discover');
    items = discover.filter(i => i.backdrop);
  } catch (e) { /* Overseerr not configured/reachable — fall through below */ }

  if (!items.length) {
    try {
      const top = await api('/api/tautulli/top-of-month');
      items = [top.movie?.[0], top.tv?.[0], top.anime?.[0]]
        .filter(i => i && i.thumb)
        .map(i => ({ backdrop: i.thumb, title: i.title }));
    } catch (e) { /* nothing to show — banner just stays off */ }
  }

  heroBanners = items;
  heroBannerIndex = Math.floor(Math.random() * heroBanners.length);
  if (heroBannerTimer) { clearInterval(heroBannerTimer); heroBannerTimer = null; }
  if (!heroBanners.length) return;

  showHeroBanner(heroBanners[heroBannerIndex]);
  if (heroBanners.length > 1) {
    heroBannerTimer = setInterval(() => {
      // Random, but never repeat the slide currently on screen.
      let next;
      do {
        next = Math.floor(Math.random() * heroBanners.length);
      } while (next === heroBannerIndex);
      heroBannerIndex = next;
      showHeroBanner(heroBanners[heroBannerIndex]);
    }, 12000);
  }
}

function showHeroBanner(item) {
  const slideA = document.querySelector('#hero-bg .slide-a');
  const slideB = document.querySelector('#hero-bg .slide-b');
  if (!slideA || !slideB || !item) return;
  const active = slideA.classList.contains('active') ? slideA : slideB;
  const inactive = active === slideA ? slideB : slideA;
  // Preload before swapping — crossfading onto a half-downloaded image looks
  // broken, and the currently-visible slide just stays put until this loads.
  const img = new Image();
  img.onload = () => {
    inactive.style.backgroundImage = `url("${item.backdrop}")`;
    active.classList.remove('active');
    inactive.classList.add('active');
  };
  img.src = item.backdrop;

  const tag = document.getElementById('hero-featured-tag');
  const label = item.year ? `${item.title} (${item.year})` : item.title;
  tag.textContent = `FEATURED · ${label}`;
  tag.classList.remove('hidden');
  // Only Overseerr-sourced items (which carry an id) have enough data for the
  // info modal's Request flow — the top-of-month fallback doesn't, so its
  // tag is just a label, not a click target.
  tag.onclick = item.id ? () => openInfo({
    poster: item.poster || item.backdrop,
    title: item.title,
    badge: item.mediaType === 'tv' ? 'SERIES' : 'MOVIE',
    meta: item.year || '',
    overview: item.overview,
    request: item
  }) : null;
  tag.style.cursor = item.id ? 'pointer' : 'default';
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  if (!await confirmDialog('Sign out?')) return;
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
    <img class="toast-poster" src="${poster || ''}" loading="lazy" onerror="this.style.visibility='hidden'">
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

// Reconciles by sessionKey instead of replacing the whole list on every
// update. This panel refreshes on a safety-net timer (see lib/nowPlaying.js)
// even when nothing actually changed, and a full innerHTML rebuild recreates
// every <img> from scratch each time — which visibly reloads/flashes the
// poster even though the same stream is still playing the same thing. An
// existing row's <img> is now only ever created once, for the duration of
// that session, and just has its text/bar updated in place after that.
function renderNowPlaying({ sessions, totalBandwidthKbps }) {
  const body = document.getElementById('now-playing-body');
  const headline = document.getElementById('hero-headline');
  const indicator = document.getElementById('live-indicator');

  const sessionCountChanged = sessions.length !== store.nowPlaying.length;
  store.nowPlaying = sessions;
  const bandwidth = totalBandwidthKbps ? ` · ${(totalBandwidthKbps / 1000).toFixed(1)} Mbps` : '';
  headline.textContent = sessions.length
    ? `${sessions.length} stream${sessions.length === 1 ? '' : 's'} live right now${bandwidth}`
    : 'Nothing playing right now';
  indicator.style.visibility = sessions.length ? 'visible' : 'hidden';

  if (!sessions.length) {
    body.innerHTML = '<p class="empty-state">Nothing playing right now.</p>';
  } else {
    if (!body.querySelector('.now-row')) body.innerHTML = ''; // clear the empty-state message
    const incomingKeys = new Set(sessions.map(s => s.sessionKey));
    for (const row of body.querySelectorAll('.now-row[data-session-key]')) {
      if (!incomingKeys.has(row.dataset.sessionKey)) row.remove();
    }
    sessions.forEach((s, idx) => {
      let row = body.querySelector(`.now-row[data-session-key="${s.sessionKey}"]`);
      if (!row) {
        row = document.createElement('div');
        row.className = 'now-row';
        row.dataset.sessionKey = s.sessionKey;
        row.innerHTML = `
          <img class="thumb" src="${s.thumb || ''}" loading="lazy" onerror="this.style.visibility='hidden'">
          <div style="flex:1; min-width:0;">
            <div class="now-title"></div>
            <div class="now-meta"><span class="state-dot"></span><span class="now-meta-text"></span> · <span class="state-word"></span></div>
            <div class="now-eta"></div>
            <div class="bar"><div class="bar-fill"></div></div>
          </div>
        `;
      }
      row.dataset.idx = idx;
      row.querySelector('.now-title').textContent = s.title;
      row.querySelector('.thumb').classList.toggle('privacy-blur', !!s.blurArtwork);
      row.querySelector('.state-dot').className = dotClass(s.state === 'paused');
      row.querySelector('.now-meta-text').textContent = `${s.user || ''} · ${s.quality || ''}`;
      row.querySelector('.state-word').textContent = s.state;
      // syncedAt anchors the per-second interpolation below to this exact
      // instant, before computing anything off it.
      s.syncedAt = Date.now();
      updateNowBar(row, s);
      updateNowEta(row, s);
      body.appendChild(row); // no-op DOM move if already in place — keeps row order matching sessions order
    });
  }

  // Recently Watched's row count tracks how many streams are live — only
  // worth re-rendering when that count actually changed, not on every
  // safety-net refresh (its own data doesn't change on that cadence anyway).
  if (sessionCountChanged) renderRecentlyWatched();
}

// Both the full snapshot and the lightweight per-event patch only arrive
// roughly every ~10s during normal playback (Plex's own notification
// cadence) — without this, the elapsed/total/ETA/bar only ever visibly
// ticked on that same cadence. Interpolates forward from the last known
// position using wall-clock time elapsed since then (see the 1s ticker
// below), frozen in place whenever the session isn't actively 'playing' so
// a pause doesn't make it look like time is still passing. Anchored on the
// exact viewOffsetMs rather than reconstructing from the rounded whole-
// percent progress field — that rounding alone can be several seconds off
// on a typical episode, which would otherwise show up as a real (if small)
// sync error even before any interpolation happens.
function interpolatedElapsedMs(s) {
  const base = s.viewOffsetMs != null ? s.viewOffsetMs : (s.durationMs || 0) * (s.progress / 100);
  if (s.state !== 'playing' || !s.syncedAt) return base;
  return Math.min(s.durationMs || 0, base + (Date.now() - s.syncedAt));
}

function updateNowBar(row, s) {
  const pct = s.durationMs ? Math.min(100, (interpolatedElapsedMs(s) / s.durationMs) * 100) : s.progress;
  row.querySelector('.bar-fill').style.width = pct + '%';
}

// Elapsed/total runtime + a wall-clock ETA, shown above the progress bar —
// both computed client-side from data every session already carries
// (progress % + durationMs), no new backend field needed.
function updateNowEta(row, s) {
  const el = row.querySelector('.now-eta');
  if (!s.durationMs) { el.textContent = ''; return; }
  const elapsedMs = interpolatedElapsedMs(s);
  const remainingMs = Math.max(0, s.durationMs - elapsedMs);
  const eta = new Date(Date.now() + remainingMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  el.innerHTML = `${formatDuration(elapsedMs)}<span class="sep">/</span>${formatDuration(s.durationMs)}<span class="sep">·</span>ETA <span class="eta-val">${eta}</span>`;
}

// Ticks every second so the counter/bar advance smoothly between the real
// ~10s updates above, instead of visibly jumping once per sync. Sessions
// that aren't 'playing' are skipped — interpolatedElapsedMs would just
// return the same frozen value again anyway, so there's nothing to redraw.
setInterval(() => {
  for (const s of store.nowPlaying) {
    if (s.state !== 'playing') continue;
    const row = document.querySelector(`.now-row[data-session-key="${s.sessionKey}"]`);
    if (!row) continue;
    updateNowBar(row, s);
    updateNowEta(row, s);
  }
}, 1000);

function patchNowPlayingRow({ sessionKey, state, progress, viewOffsetMs }) {
  const s = store.nowPlaying.find(x => x.sessionKey === sessionKey);
  const row = document.querySelector(`.now-row[data-session-key="${sessionKey}"]`);
  if (!s || !row) return;
  s.state = state;
  s.progress = progress;
  s.viewOffsetMs = viewOffsetMs;
  s.syncedAt = Date.now();
  row.querySelector('.state-dot').classList.toggle('paused', state === 'paused');
  row.querySelector('.state-word').textContent = state;
  updateNowBar(row, s);
  updateNowEta(row, s);
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
      <img class="thumb" src="${i.thumb || ''}" loading="lazy" onerror="this.style.visibility='hidden'">
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

    // Same horizontal-scroll row as Releasing Soon; mobile shows fewer per row
    // since there's less width to scroll through per swipe.
    const cap = window.matchMedia('(max-width: 900px)').matches ? 6 : 10;

    body.innerHTML = sections.map(s => `
      ${s.label ? `<div class="subsection-label">${s.label}</div>` : ''}
      <div class="poster-grid poster-grid-scroll" style="margin-bottom:1rem;">
        ${s.items.slice(0, cap).map((i, idx) => `
          <div class="poster-card" data-cat="${s.key}" data-idx="${idx}">
            <div class="poster-frame">
              <img class="poster-img" src="${i.thumb || ''}" loading="lazy" onerror="this.style.visibility='hidden'">
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
// "Just Mine" filter (Airing Today) — matches by title against every TV show
// this signed-in user has ever watched per Tautulli history (GET
// /api/tautulli/my-shows), same title-based show identity this codebase
// already uses everywhere else (see routes/tautulli.js's showIdentity(),
// lib/myStats.js's computeTopWatched) rather than introducing a tvdbId
// cross-reference nothing else here needs. Fetched lazily (only once the
// toggle is actually turned on) and cached for the rest of the page session.
let myShowsCache = null;
async function loadMyShows() {
  if (myShowsCache) return myShowsCache;
  try {
    const data = await api('/api/tautulli/my-shows');
    myShowsCache = new Set(data.tvTitles);
  } catch (e) {
    myShowsCache = new Set();
  }
  return myShowsCache;
}

// "Just Mine" filter (Releasing Soon) — deliberately a different signal than
// Airing Today's: an upcoming movie is by definition one nobody's watched
// yet, so "have I watched this" can never match anything actually useful
// here. What's actually meaningful is "did I ask for this" — matches by
// title against this user's own Overseerr requests (GET
// /api/overseerr/requests/mine, already built for the My Requests tab), so
// the filter reads as "movies I requested that are now coming up."
let myRequestedMoviesCache = null;
async function loadMyRequestedMovies() {
  if (myRequestedMoviesCache) return myRequestedMoviesCache;
  try {
    const results = await api('/api/overseerr/requests/mine');
    myRequestedMoviesCache = new Set(results.filter(r => r.mediaType === 'movie').map(r => r.title));
  } catch (e) {
    myRequestedMoviesCache = new Set();
  }
  return myRequestedMoviesCache;
}

let airingMineOnly = false;
function renderAiringToday() {
  const body = document.getElementById('airing-today-body');
  const items = store.airingToday || [];
  // data-idx stays the item's index in the full, unfiltered store.airingToday
  // (not its position in this filtered render) — the click handler below
  // indexes straight into that array, and needs to keep working identically
  // whether the filter is on or off.
  const shown = items
    .map((i, idx) => ({ i, idx }))
    .filter(({ i }) => !airingMineOnly || myShowsCache?.has(i.series));
  if (!shown.length) {
    body.innerHTML = `<p class="empty-state">${airingMineOnly ? 'Nothing airing today from shows you watch.' : 'Nothing airing today.'}</p>`;
    return;
  }
  body.innerHTML = shown.map(({ i, idx }) => `
    <div class="poster-card" data-idx="${idx}">
      <div class="poster-frame">
        <img class="poster-img" src="${i.poster || ''}" loading="lazy" onerror="this.style.visibility='hidden'">
        <span class="poster-badge">${i.episode}</span>
        <div class="poster-overlay"><span class="poster-overlay-text">${escapeHtml(i.series)}</span></div>
      </div>
      <div class="poster-meta">${i.hasFile ? 'Downloaded' : 'Airing'}</div>
    </div>
  `).join('');
}

async function loadAiringToday() {
  const body = document.getElementById('airing-today-body');
  try {
    store.airingToday = await api('/api/sonarr/today');
    renderAiringToday();
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not reach Sonarr.</p>';
  }
}

document.getElementById('airing-mine-toggle').addEventListener('click', async () => {
  const btn = document.getElementById('airing-mine-toggle');
  airingMineOnly = !airingMineOnly;
  btn.classList.toggle('active', airingMineOnly);
  btn.setAttribute('aria-pressed', String(airingMineOnly));
  if (airingMineOnly) await loadMyShows();
  renderAiringToday();
});

// ---------- Releasing Soon ----------
let upcomingMineOnly = false;
function renderUpcoming() {
  const body = document.getElementById('upcoming-body');
  const items = store.upcoming || [];
  const shown = items
    .map((i, idx) => ({ i, idx }))
    .filter(({ i }) => !upcomingMineOnly || myRequestedMoviesCache?.has(i.title));
  if (!shown.length) {
    body.innerHTML = `<p class="empty-state">${upcomingMineOnly ? 'Nothing upcoming from movies you requested.' : 'Nothing on the calendar.'}</p>`;
    return;
  }
  body.innerHTML = shown.map(({ i, idx }) => `
    <div class="poster-card" data-idx="${idx}">
      <div class="poster-frame">
        <img class="poster-img" src="${i.poster || ''}" loading="lazy" onerror="this.style.visibility='hidden'">
        <span class="poster-badge">${formatDate(i.releaseDate)}</span>
        <div class="poster-overlay"><span class="poster-overlay-text">${escapeHtml(i.title)}</span></div>
      </div>
      ${i.hasFile ? '<div class="poster-meta">Available now</div>' : ''}
    </div>
  `).join('');
}

async function loadUpcoming() {
  const body = document.getElementById('upcoming-body');
  try {
    store.upcoming = await api('/api/radarr/upcoming');
    renderUpcoming();
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not reach Radarr.</p>';
  }
}

document.getElementById('upcoming-mine-toggle').addEventListener('click', async () => {
  const btn = document.getElementById('upcoming-mine-toggle');
  upcomingMineOnly = !upcomingMineOnly;
  btn.classList.toggle('active', upcomingMineOnly);
  btn.setAttribute('aria-pressed', String(upcomingMineOnly));
  if (upcomingMineOnly) await loadMyRequestedMovies();
  renderUpcoming();
});

// Shared by every poll-refreshed list here that would otherwise do a full
// innerHTML rebuild every cycle — same problem and fix as Now Playing/
// Recently Watched (see renderNowPlaying above) and admin.js's own
// reconcileList: an existing row is created once and left alone, only
// updateRow's fields refresh in place, so nothing gets torn down and
// rebuilt just because a 5s/15s timer ticked with no real change.
function reconcileList(container, items, keyOf, createRow, updateRow) {
  const incomingKeys = new Set(items.map(item => String(keyOf(item))));
  for (const row of container.querySelectorAll('[data-recon-key]')) {
    if (!incomingKeys.has(row.dataset.reconKey)) row.remove();
  }
  if (!container.querySelector('[data-recon-key]')) container.innerHTML = ''; // clear an empty-state message
  items.forEach(item => {
    const key = String(keyOf(item));
    let row = container.querySelector(`[data-recon-key="${key}"]`);
    if (!row) {
      row = createRow(item);
      row.dataset.reconKey = key;
    }
    updateRow(row, item);
    container.appendChild(row); // no-op DOM move if already in place — keeps row order matching items order
  });
}

// ---------- Download Queue ----------
// Actively downloading only, for everyone — anything stuck (paused, stalled,
// errored) is an owner-only concern, see admin.js's "Download Issues"
// section instead. Most of what "stuck" would otherwise include here is just
// fully-downloaded torrents idling before/during seeding, which nobody
// browsing this panel needs to see.
function createDownloadRow() {
  const row = document.createElement('div');
  row.className = 'dl-row';
  row.innerHTML = `
    <div class="dl-row-body">
      <div class="now-title"></div>
      <div class="now-meta"><span class="state-dot"></span><span class="dl-meta-text"></span></div>
      <div class="bar"><div class="bar-fill"></div></div>
    </div>
  `;
  return row;
}

function updateDownloadRow(row, d) {
  row.classList.toggle('dl-row-clickable', d.type === 'torrent');
  if (d.type === 'torrent') {
    row.dataset.hash = d.id;
    row.dataset.name = d.name;
  }
  row.querySelector('.now-title').textContent = d.name;
  row.querySelector('.state-dot').className = dotClass(d.state !== 'downloading');
  row.querySelector('.dl-meta-text').textContent = [
    d.type === 'torrent' ? 'Torrent' : 'Usenet',
    titleCase(d.state),
    d.speedKbps ? formatSpeed(d.speedKbps) : null,
    d.etaSeconds != null ? formatEta(d.etaSeconds) : null
  ].filter(Boolean).join(' · ');
  row.querySelector('.bar-fill').style.width = d.progress + '%';

  // Add/remove the button entirely rather than just hiding it, so the click
  // handler's `.dl-remove-btn` lookup reliably reflects whether this row is
  // actually actionable right now.
  const wantsRemove = isOwner && d.type === 'torrent';
  const removeBtn = row.querySelector('.dl-remove-btn');
  if (wantsRemove && !removeBtn) {
    const btn = document.createElement('button');
    btn.className = 'dl-remove-btn pill-btn';
    btn.innerHTML = '<span class="state-dot danger"></span><span class="btn-label">Remove</span>';
    row.appendChild(btn);
  } else if (!wantsRemove && removeBtn) {
    removeBtn.remove();
  } else if (removeBtn) {
    removeBtn.disabled = false;
    removeBtn.querySelector('.btn-label').textContent = 'Remove';
  }
}

async function loadDownloads() {
  const body = document.getElementById('downloads-body');
  try {
    const items = await api('/api/downloads/queue');
    if (!items.length) { body.innerHTML = '<p class="empty-state">Nothing downloading.</p>'; return; }
    // Torrent hash and SABnzbd nzo_id are separate namespaces — prefix by
    // type so a coincidental collision between the two can't merge two
    // different real downloads into one row.
    reconcileList(body, items, d => `${d.type}-${d.id}`, createDownloadRow, updateDownloadRow);
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not reach download clients.</p>';
  }
}

// Delegated so it keeps working across loadDownloads' re-renders every 5s
// instead of needing listeners re-attached each poll.
document.getElementById('downloads-body').addEventListener('click', async e => {
  const removeBtn = e.target.closest('.dl-remove-btn');
  if (removeBtn) {
    const row = removeBtn.closest('.dl-row');
    if (!await confirmDialog('Remove this download and delete any downloaded files?')) return;
    row.querySelectorAll('button').forEach(b => b.disabled = true);
    removeBtn.querySelector('.btn-label').textContent = '…';
    try {
      await api(`/api/downloads/queue/torrent/${encodeURIComponent(row.dataset.hash)}`, { method: 'DELETE' });
      row.remove();
      if (!document.getElementById('downloads-body').children.length) {
        document.getElementById('downloads-body').innerHTML = '<p class="empty-state">Nothing downloading.</p>';
      }
    } catch (err) {
      row.querySelectorAll('button').forEach(b => b.disabled = false);
      removeBtn.querySelector('.btn-label').textContent = 'Remove';
    }
    return;
  }

  const row = e.target.closest('.dl-row-clickable');
  if (row) openTorrentDetails(row.dataset.hash, row.dataset.name);
});

const torrentModal = document.getElementById('torrent-modal');

async function openTorrentDetails(hash, name) {
  torrentModal.classList.remove('hidden');
  const statsEl = document.getElementById('torrent-details-stats');
  const filesEl = document.getElementById('torrent-details-files');
  document.getElementById('torrent-details-title').textContent = name || '';
  statsEl.innerHTML = '';
  filesEl.innerHTML = '<p class="empty-state">Loading…</p>';
  try {
    const d = await api(`/api/downloads/queue/torrent/${encodeURIComponent(hash)}/details`);
    const rows = [
      ['Seeds', `${d.seeds} (${d.seedsTotal} total)`],
      ['Peers', `${d.peers} (${d.peersTotal} total)`],
      ['Connections', `${d.connections}${d.connectionsLimit > 0 ? ' / ' + d.connectionsLimit : ''}`],
      ['Speed', `↓ ${formatSpeed(d.downloadSpeedKbps)} · ↑ ${formatSpeed(d.uploadSpeedKbps)}`],
      ['ETA', d.etaSeconds != null ? formatEta(d.etaSeconds) : 'Unknown'],
      ['Ratio', d.ratio != null ? d.ratio.toFixed(2) : 'Unknown'],
      ['Size', formatBytes(d.sizeBytes)],
      ['Save Path', d.savePath || 'Unknown']
    ];
    statsEl.innerHTML = rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd>`).join('');
    filesEl.innerHTML = d.files.map(f => `
      <div class="torrent-file-row">
        <div class="now-title">${escapeHtml(f.name)}</div>
        <div class="now-meta">${formatBytes(f.sizeBytes)} · ${f.progress}%</div>
        <div class="bar"><div class="bar-fill" style="width:${f.progress}%"></div></div>
      </div>
    `).join('');
  } catch (e) {
    filesEl.innerHTML = '<p class="empty-state">Could not load torrent details.</p>';
  }
}

document.getElementById('close-torrent-btn').addEventListener('click', () => torrentModal.classList.add('hidden'));
torrentModal.addEventListener('click', e => { if (e.target === torrentModal) torrentModal.classList.add('hidden'); });

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
        <div class="top-month-frame"><img class="top-month-img" src="" loading="lazy" onerror="this.style.visibility='hidden'"></div>
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
      <div class="top-month-frame"><img class="top-month-img" src="${(isUser ? first.avatar : first.thumb) || ''}" loading="lazy" onerror="this.style.visibility='hidden'"></div>
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

// ---------- My Stats ----------
// Personal, per-signed-in-user numbers behind the request modal's fourth
// tab — hero (hours watched YTD + pace), a this-week line, four stat tiles
// with month-over-month deltas, personal records, a 14-day activity strip,
// the Movies/TV/Anime library mix, and a top-3 most-watched list.
// renderMostWatched: medal + title + plays, gold/silver/bronze name colour
// like Top of the Month. Each row is a tap target that opens the info modal
// — poster, synopsis, and the "Played By" chips (who in the household has
// watched it, with per-person play counts) — via a get_metadata round trip
// made only on click, keyed by the show/movie ratingKey computeTopWatched
// carries.
function renderMostWatched(topWatched) {
  if (!topWatched || !topWatched.length) return '<p class="empty-state">Nothing watched yet this year.</p>';
  const medals = ['🥇', '🥈', '🥉'];
  const classes = ['gold', 'silver', 'bronze'];
  const rows = topWatched.map((item, i) => `
    <button class="mw-row" data-idx="${i}"${item.ratingKey ? '' : ' disabled'}>
      <span class="mw-badge">${medals[i] || ''}</span>
      <span class="mw-name ${classes[i] || ''}">${escapeHtml(item.title)}</span>
      <span class="mw-plays">${item.plays} play${item.plays === 1 ? '' : 's'}</span>
      ${item.ratingKey ? '<span class="mw-chev">›</span>' : ''}
    </button>
  `).join('');
  return `<div class="mw-list">${rows}</div>`;
}

// A ▲/▼ change chip vs last month. null (last month had no activity) renders
// nothing rather than a misleading "+100%".
function renderStatDelta(deltaPct) {
  if (deltaPct == null || deltaPct === 0) return '';
  const up = deltaPct > 0;
  return `<span class="stat-delta ${up ? 'up' : 'down'}">${up ? '▲' : '▼'}${Math.abs(deltaPct)}%</span>`;
}

// Compact 14-day activity strip — one bar per day, height = hours watched
// that day, scaled to the busiest day in the window. Replaces the old
// hover-only heatmap with something that reads on a phone: weekday initial
// under each bar, today rightmost. dailyActivity is zero-filled server-side.
function renderDayBars(days) {
  if (!days || !days.length) return '';
  const max = Math.max(0.5, ...days.map(d => d.hours));
  const bars = days.map(d => {
    const pct = d.hours > 0 ? Math.max(6, Math.round((d.hours / max) * 100)) : 0;
    const wd = new Date(d.date).toLocaleDateString(undefined, { weekday: 'narrow' });
    const label = new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const title = d.plays ? `${label} — ${d.plays} play${d.plays === 1 ? '' : 's'}, ${d.hours}h` : `${label} — nothing`;
    return `<div class="day-bar" title="${escapeHtml(title)}">
      <div class="day-bar-track">${pct ? `<div class="day-bar-fill" style="height:${pct}%"></div>` : ''}</div>
      <span class="day-bar-lbl">${wd}</span>
    </div>`;
  }).join('');
  return `<div class="day-strip">${bars}</div>`;
}

// Movies / TV / Anime play-count split for the year as one stacked bar plus a
// counted legend. Segments under a couple percent are still given a sliver so
// the colour shows.
function renderTypeSplit(split) {
  if (!split) return '';
  const total = split.movies + split.tv + split.anime;
  if (!total) return '';
  const parts = [
    { key: 'movies', lbl: 'Movies', n: split.movies },
    { key: 'tv', lbl: 'TV', n: split.tv },
    { key: 'anime', lbl: 'Anime', n: split.anime }
  ].filter(p => p.n > 0);
  const bar = parts.map(p => `<div class="type-seg ${p.key}" style="flex:${p.n}" title="${p.lbl}: ${p.n} plays"></div>`).join('');
  const legend = parts.map(p =>
    `<span><span class="dot ${p.key}"></span>${p.lbl} <b>${Math.round((p.n / total) * 100)}%</b> · ${p.n}</span>`
  ).join('');
  return `
    <div class="card-label" style="margin-top: 1.3rem;">Library mix</div>
    <div class="chart-sub">This year</div>
    <div class="type-split">${bar}</div>
    <div class="type-legend">${legend}</div>`;
}

let myStatsTopWatched = []; // stashed so the Most Watched click handler can read ratingKey/title/plays by index
let myStatsInfoRequest = 0; // guards a slower metadata fetch from overwriting a newer click (same pattern as recentlyWatchedInfoRequest)

async function loadMyStats() {
  const body = document.getElementById('mystats-body');
  try {
    const s = await api('/api/tautulli/my-stats');
    myStatsTopWatched = s.topWatched || [];
    const d = s.deltas || { plays: {}, hours: {} };
    const tiles = [
      { val: s.rank ? `#${s.rank.position}` : '—', lbl: 'Family Rank', cls: 'teal' },
      { val: s.streakDays ? `${s.streakDays} day${s.streakDays === 1 ? '' : 's'}` : '—', lbl: 'Binge Streak', cls: 'amber' },
      { val: `${s.playsThisMonth}${renderStatDelta(d.plays?.deltaPct)}`, lbl: 'Plays This Month', cls: '' },
      { val: `${d.hours?.current ?? 0}h${renderStatDelta(d.hours?.deltaPct)}`, lbl: 'Hours This Month', cls: 'teal' }
    ];
    const rec = s.records || {};
    const records = [
      rec.longestStreak ? { val: `${rec.longestStreak}d`, lbl: 'Longest streak' } : null,
      rec.biggestDay ? { val: `${rec.biggestDay.plays} plays`, lbl: `Biggest day · ${formatDate(rec.biggestDay.date)}` } : null,
      rec.bestMonth ? { val: new Date(rec.bestMonth.month + '-01').toLocaleDateString(undefined, { month: 'long' }), lbl: `Best month · ${rec.bestMonth.plays} plays` } : null
    ].filter(Boolean);
    body.innerHTML = `
      <div class="stat-hero">
        <div><span class="stat-hero-num">${s.hours}</span><span class="stat-hero-unit">hrs watched</span></div>
        <div class="stat-hero-cap">Year to date${s.hoursPace ? ` · on pace for ~${s.hoursPace}` : ''}</div>
      </div>
      ${s.thisWeek ? `<div class="stat-thisweek">This week — <b>${s.thisWeek.plays}</b> play${s.thisWeek.plays === 1 ? '' : 's'} · <b>${s.thisWeek.hours}h</b></div>` : ''}
      <div class="stat-tiles four">
        ${tiles.map(t => `
          <div class="mystats-tile">
            <div class="stat-tile-val ${t.cls}">${t.val}</div>
            <div class="stat-tile-lbl">${t.lbl}</div>
          </div>
        `).join('')}
      </div>
      ${records.length ? `
        <div class="card-label">Records · this year</div>
        <div class="stat-records">
          ${records.map(r => `<div class="stat-record"><div class="stat-record-val">${escapeHtml(String(r.val))}</div><div class="stat-record-lbl">${escapeHtml(r.lbl)}</div></div>`).join('')}
        </div>
      ` : ''}
      ${s.dailyActivity?.length ? `
        <div class="card-label" style="margin-top: 1.3rem;">Recent activity</div>
        <div class="chart-sub">Last 14 days · hours per day</div>
        ${renderDayBars(s.dailyActivity)}
      ` : ''}
      ${renderTypeSplit(s.typeSplit)}
      <div class="card-label" style="margin-top: 1.3rem;">Most Watched</div>
      ${renderMostWatched(s.topWatched)}
    `;
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not reach Tautulli.</p>';
  }
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
// Avatar chip jumps straight to the My Stats tab instead of landing on the
// default Search tab — same modal, just a different entry point.
function openMyStats() {
  openRequestModal();
  document.getElementById('tab-mystats-btn').click();
}
const avatarChipBtn = document.getElementById('avatar-chip-btn');
avatarChipBtn.addEventListener('click', openMyStats);
avatarChipBtn.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  openMyStats();
});
document.getElementById('close-modal-btn').addEventListener('click', () => {
  modal.classList.add('hidden');
  closeSeasonPicker();
  document.getElementById('tab-search-btn').click();
});

// ---------- Request modal tabs ----------
// Each tab is a { btn, pane } pair; activateTab flips every pane/button at once
// so adding a new tab is just one more entry here rather than more pairwise
// on/off toggling.
const modalTabs = [
  { btn: document.getElementById('tab-because-btn'), pane: document.getElementById('because-tab') },
  { btn: document.getElementById('tab-search-btn'), pane: document.getElementById('search-tab') },
  { btn: document.getElementById('tab-myrequests-btn'), pane: document.getElementById('myrequests-tab') },
  { btn: document.getElementById('tab-mystats-btn'), pane: document.getElementById('mystats-tab') }
];
function activateTab(btn) {
  for (const t of modalTabs) {
    const isActive = t.btn === btn;
    t.btn.classList.toggle('active', isActive);
    t.pane.classList.toggle('hidden', !isActive);
  }
}

let becauseLoaded = false;
let myRequestsLoaded = false;
let myStatsLoaded = false;

modalTabs[0].btn.addEventListener('click', () => {
  activateTab(modalTabs[0].btn);
  if (!becauseLoaded) {
    becauseLoaded = true;
    loadBecauseYouWatched();
  }
});

modalTabs[1].btn.addEventListener('click', () => activateTab(modalTabs[1].btn));

modalTabs[2].btn.addEventListener('click', () => {
  activateTab(modalTabs[2].btn);
  // Lazy-loaded on first visit to the tab, then left cached for the rest of
  // this modal session — requests don't change status fast enough to need
  // refetching every time the tab is reopened within the same visit.
  if (!myRequestsLoaded) {
    myRequestsLoaded = true;
    loadMyRequests();
  }
});

modalTabs[3].btn.addEventListener('click', () => {
  activateTab(modalTabs[3].btn);
  if (!myStatsLoaded) {
    myStatsLoaded = true;
    loadMyStats();
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
    const statusText = { available: 'Available', downloading: 'Downloading', approved: 'Approved', pending: 'Pending Approval', declined: 'Declined' };
    // r.stuck (routes/overseerr.js's /requests/mine, cross-referenced against
    // Radarr's/Sonarr's own Wanted/Missing list) overrides an otherwise-stale
    // "Approved" that would just sit there forever with no hint anything's
    // actually wrong — same stuck concept the owner's admin panel already
    // shows, surfaced here from the requester's own point of view.
    listEl.innerHTML = results.map(r => {
      const statusClass = r.stuck ? 'stuck' : r.availability;
      const label = r.stuck
        ? `Stuck — released ${r.daysSinceRelease}d ago, still searching`
        : `${statusText[r.availability] || r.availability}${r.availability === 'downloading' && r.etaSeconds != null ? ' · ' + formatEta(r.etaSeconds) : ''}`;
      return `
      <div class="my-request-row">
        <img class="result-poster" src="${r.poster || ''}" loading="lazy" onerror="this.style.visibility='hidden'">
        <div class="result-info">
          <div class="result-title">${escapeHtml(r.title || 'Unknown title')}</div>
          <div class="my-request-status ${statusClass}">
            <span class="status-dot"></span>${label}
          </div>
        </div>
      </div>
    `;
    }).join('');
  } catch (e) {
    listEl.innerHTML = '<p class="empty-state">Could not load requests.</p>';
  }
}

// Shared by the discover feed and actual search results — same item shape
// from the backend (lib/overseerrClient.js's mapDiscoverItem), same row
// markup. Keeps the last-rendered array around per container so a row
// click can look itself up by index and open the info modal with full details
// before requesting.
const resultsStore = {};
function renderSearchResults(results, emptyMessage, containerId = 'search-results') {
  resultsStore[containerId] = results;
  const resultsEl = document.getElementById(containerId);
  if (!results.length) { resultsEl.innerHTML = `<p class="empty-state">${emptyMessage}</p>`; return; }
  resultsEl.innerHTML = results.map((r, idx) => `
    <div class="result-item" data-idx="${idx}">
      <img class="result-poster" src="${r.poster || ''}" loading="lazy" onerror="this.style.visibility='hidden'">
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

// Its own tab (For You) rather than a strip above Trending — personalized,
// seeded by this user's own most recent watch via Overseerr's
// recommendations endpoint, same not-owned/not-requested filter Trending
// uses. Lazy-loaded on first visit to the tab, same pattern as My Requests/
// My Stats below.
async function loadBecauseYouWatched() {
  try {
    renderBecauseYouWatched(await api('/api/overseerr/recommendations'));
  } catch (e) {
    renderBecauseYouWatched({ seedTitle: null, items: [] });
  }
}
function renderBecauseYouWatched(rec) {
  const label = document.getElementById('because-label');
  if (!rec.seedTitle || !rec.items.length) {
    label.classList.add('hidden');
    renderSearchResults([], 'Watch a few things and check back — this fills in once there’s some recent history to go on.', 'because-results');
    return;
  }
  label.textContent = `Because you watched ${rec.seedTitle}`;
  label.classList.remove('hidden');
  renderSearchResults(rec.items, '', 'because-results');
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

// Shared by every results container (search results, and — for the season
// picker — its own return tab) so the same row markup and request flow work
// regardless of which one triggered it.
async function handleResultsClick(e, containerId, tabId) {
  const btn = e.target.closest('.request-btn');
  if (btn && !btn.disabled) {
    const id = Number(btn.dataset.id);
    const mediaType = btn.dataset.type;

    // TV shows go through the season picker instead of requesting the whole
    // series outright — movies have no seasons, so those still request directly.
    if (mediaType === 'tv') {
      openSeasonPicker(id, btn.dataset.title, btn, tabId);
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
  const r = resultsStore[containerId]?.[Number(item.dataset.idx)];
  if (!r) return;
  openInfo({
    poster: r.poster, title: r.title,
    badge: r.mediaType === 'tv' ? 'SERIES' : 'MOVIE',
    meta: r.year || '',
    overview: r.overview,
    request: r,
    tabId
  });
}
document.getElementById('search-results').addEventListener('click', e => handleResultsClick(e, 'search-results', 'search-tab'));
document.getElementById('because-results').addEventListener('click', e => handleResultsClick(e, 'because-results', 'because-tab'));

// ---------- Season picker ----------
// Shown in place of whichever tab triggered it — returnTabId remembers which
// one to bring back when the picker closes.
let seasonPickerContext = null; // { id, button, returnTabId }

async function openSeasonPicker(id, title, button, returnTabId) {
  const listEl = document.getElementById('season-picker-list');
  const submitBtn = document.getElementById('season-picker-submit');

  seasonPickerContext = { id, button, returnTabId };
  document.getElementById('season-picker-title').textContent = title;
  listEl.innerHTML = '<p class="empty-state">Loading seasons…</p>';
  submitBtn.disabled = false;
  submitBtn.textContent = 'Request Selected Seasons';
  // returnTabId is optional — a caller outside the request modal's own tab system
  // (e.g. the info modal's Request button) has no tab of its own to hide/restore.
  if (returnTabId) document.getElementById(returnTabId).classList.add('hidden');
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
  if (seasonPickerContext?.returnTabId) {
    document.getElementById(seasonPickerContext.returnTabId).classList.remove('hidden');
  }
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

function openInfo({ poster, title, badge, meta, overview, stream, ratingKey, request, tabId }) {
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
  // tabId travels along so a TV request from here knows which tab to return
  // to when the season picker it opens gets closed (Search, For You, ...).
  infoRequestItem = request ? { ...request, tabId } : null;
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

  loadPlayedBy(ratingKey);

  infoModal.classList.remove('hidden');
}

// Cycles through the app's existing accent/medal tokens for a user with no
// avatar (see .played-by-chip.fill-* in style.css) — deterministic per name
// so the same person gets the same color across popups, not a fresh random
// one every time the section re-renders.
const PLAYED_BY_FILLS = ['teal', 'amber', 'gold', 'bronze', 'silver'];
function playedByFill(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return PLAYED_BY_FILLS[Math.abs(hash) % PLAYED_BY_FILLS.length];
}

// A user with no avatar (an anonymized entry, or a real Plex account that
// never set one) falls back to an initial-letter chip; a user WITH an
// avatar falls back the same way if that image URL 404s, via this handler
// (mirrors info-poster's own onerror convention elsewhere in this file,
// just swapping to a visible fallback instead of hiding).
function handlePlayedByImgError(img) {
  const chip = img.parentElement;
  chip.classList.add(`fill-${playedByFill(chip.dataset.name)}`);
  chip.textContent = chip.dataset.name.trim().charAt(0).toUpperCase() || '?';
}

function renderPlayedBy(players) {
  return players.map(p => {
    const title = `${p.name} · ${p.plays} play${p.plays === 1 ? '' : 's'}`;
    const nameAttr = escapeHtml(p.name);
    if (p.avatar) {
      return `<div class="played-by-chip" data-name="${nameAttr}" title="${escapeHtml(title)}"><img src="${p.avatar}" loading="lazy" alt="${nameAttr}" onerror="handlePlayedByImgError(this)"></div>`;
    }
    const initial = escapeHtml(p.name.trim().charAt(0).toUpperCase() || '?');
    return `<div class="played-by-chip fill-${playedByFill(p.name)}" title="${escapeHtml(title)}">${initial}</div>`;
  }).join('');
}

let playedByRequest = 0; // guards against a slower earlier fetch overwriting a later click, same pattern as recentlyWatchedInfoRequest above

async function loadPlayedBy(ratingKey) {
  const section = document.getElementById('info-played-by');
  const chipsEl = document.getElementById('info-played-by-chips');
  section.classList.add('hidden');
  chipsEl.innerHTML = '';
  if (!ratingKey) return;

  const requestId = ++playedByRequest;
  try {
    const { players } = await api(`/api/tautulli/played-by/${ratingKey}`);
    if (requestId !== playedByRequest) return; // a newer click already superseded this one
    if (!players || !players.length) return;
    chipsEl.innerHTML = renderPlayedBy(players);
    section.classList.remove('hidden');
  } catch (e) {
    // Quiet failure — Played By is a nice-to-have on top of the info modal,
    // not something worth surfacing an error state for.
  }
}

document.getElementById('info-request-btn').addEventListener('click', async () => {
  const btn = document.getElementById('info-request-btn');
  if (btn.disabled || !infoRequestItem) return;
  const { id, mediaType, title, tabId } = infoRequestItem;
  // The same title can be sitting rendered in more than one tab's results at
  // once (Search and For You aren't mutually exclusive) even though only
  // one is visible right now — every matching row gets updated so none of
  // them go stale if the user switches tabs without closing this modal.
  const inlineBtns = [...document.querySelectorAll(`#search-results .request-btn[data-id="${id}"][data-type="${mediaType}"], #because-results .request-btn[data-id="${id}"][data-type="${mediaType}"]`)];

  if (mediaType === 'tv') {
    infoModal.classList.add('hidden');
    // This button can be reached from the info modal directly (e.g. the hero
    // banner tag), where the request modal was never opened at all — show it
    // now so the season picker (which lives inside it) is actually visible.
    // tabId (threaded through from wherever this info modal was opened)
    // is which tab to return to when the picker closes; the default Search
    // tab covers every entry point that never passed one at all (the hero
    // banner tag, Now Playing, etc.).
    modal.classList.remove('hidden');
    openSeasonPicker(id, title, inlineBtns[0] || btn, tabId || 'search-tab');
    return;
  }

  const targets = [...new Set([btn, ...inlineBtns].filter(Boolean))];
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

// ---------- Report modal tabs (New Report / My Reports) ----------
// Same { btn, pane } pair pattern as the request modal's tabs above.
const reportModalTabs = [
  { btn: document.getElementById('tab-newreport-btn'), pane: document.getElementById('newreport-tab') },
  { btn: document.getElementById('tab-myreports-btn'), pane: document.getElementById('myreports-tab') }
];
function activateReportTab(btn) {
  for (const t of reportModalTabs) {
    const isActive = t.btn === btn;
    t.btn.classList.toggle('active', isActive);
    t.pane.classList.toggle('hidden', !isActive);
  }
}
let myReportsLoaded = false;
reportModalTabs[0].btn.addEventListener('click', () => activateReportTab(reportModalTabs[0].btn));
reportModalTabs[1].btn.addEventListener('click', () => {
  activateReportTab(reportModalTabs[1].btn);
  // Same once-per-page-session caching as loadMyRequests() — a report's status
  // doesn't change fast enough to need refetching every time this tab reopens.
  if (!myReportsLoaded) {
    myReportsLoaded = true;
    loadMyReports();
  }
});

async function loadMyReports() {
  const listEl = document.getElementById('my-reports-list');
  try {
    const results = await api('/api/overseerr/issues/mine');
    if (!results.length) {
      listEl.innerHTML = '<p class="empty-state">No reports yet.</p>';
      return;
    }
    const statusText = { open: 'Open', in_progress: 'In progress', resolved: 'Fixed' };
    listEl.innerHTML = results.map(r => `
      <div class="my-request-row">
        <img class="result-poster" src="${r.poster || ''}" loading="lazy" onerror="this.style.visibility='hidden'">
        <div class="result-info">
          <div class="result-title">${escapeHtml(r.title || 'Unknown title')}${r.episode ? ` · S${r.season}E${r.episode}` : ''}</div>
          <div class="my-request-status ${r.status}">
            <span class="status-dot"></span>${statusText[r.status] || r.status} · ${escapeHtml(r.issueType)}
          </div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    listEl.innerHTML = '<p class="empty-state">Could not load reports.</p>';
  }
}

// ---------- Report FAB flag color ----------
// The Report FAB's flag icon (⚑) doubles as an at-a-glance status of your own
// report history, without having to open the modal at all — red while nothing
// you've reported has been fixed yet, amber once some (but not all) of it has,
// and back to its default teal once everything's resolved (or you've never
// reported anything). Runs once on dashboard load; report status doesn't
// change fast enough within one visit to need re-checking on an interval.
async function loadReportFlagStatus() {
  const icon = document.querySelector('#fab-report-btn .fab-icon');
  if (!icon) return;
  try {
    const results = await api('/api/overseerr/issues/mine');
    icon.classList.remove('fab-icon-danger', 'fab-icon-warning');
    if (!results.length) return;
    const resolvedCount = results.filter(r => r.status === 'resolved').length;
    if (resolvedCount === results.length) return; // all fixed — stays teal
    icon.classList.add(resolvedCount === 0 ? 'fab-icon-danger' : 'fab-icon-warning');
  } catch (e) {
    // Overseerr not configured/reachable — leave the icon at its default teal,
    // same graceful-degrade as loadHeroBanners() above.
  }
}

// Same Web Push subscribe/unsubscribe flow as admin.js's initNotifyToggle
// (routes/push.js's /subscribe and /unsubscribe are no longer owner-only —
// see lib/pushSubscriptions.js) — kept as its own copy rather than a shared
// module since the two pages don't currently share any JS file, and the only
// difference is which icon-btn id it wires up.
async function initNotifyToggle() {
  const btn = document.getElementById('notify-toggle-btn');
  if (!window.VAPID_PUBLIC_KEY || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  btn.classList.remove('hidden');

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  btn.classList.toggle('active', !!existing);

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const reg = await navigator.serviceWorker.ready;
      const current = await reg.pushManager.getSubscription();
      if (current) {
        await current.unsubscribe();
        await api('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: current.endpoint }) });
        btn.classList.remove('active');
        return;
      }
      if (Notification.permission === 'denied') {
        alert('Notifications are blocked for this site — check your browser\'s site settings (usually the padlock/site info icon next to the address bar) to allow them, then try again.');
        return;
      }
      // Relying on subscribe() to implicitly trigger the permission prompt
      // works on Chrome but isn't reliable on Safari — it can reject
      // straight away with no prompt ever shown. Requesting permission
      // explicitly first is the standard cross-browser-safe pattern.
      if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          alert(permission === 'denied'
            ? 'Notifications weren\'t enabled — permission was denied.'
            : 'Notifications weren\'t enabled — no response to the permission prompt.');
          return;
        }
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(window.VAPID_PUBLIC_KEY)
      });
      await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub) });
      btn.classList.add('active');
    } catch (err) {
      console.error('push toggle failed:', err);
      const detail = err && (err.name && err.message ? `${err.name}: ${err.message}` : err.message || err.name || String(err));
      alert('Could not update notification settings (' + (detail || 'unknown error') + '). If your browser showed a permission prompt, it may need a response first — try clicking again.');
    } finally {
      btn.disabled = false;
    }
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

function openReportModal() {
  reportModal.classList.remove('hidden');
  activateReportTab(reportModalTabs[0].btn);
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
          <img class="result-poster" src="${r.thumb || ''}" loading="lazy" onerror="this.style.visibility='hidden'">
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
        <img class="browse-row-thumb" src="${i.thumb || ''}" loading="lazy" onerror="this.style.visibility='hidden'">
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

// My Stats → Most Watched: open the info modal (poster + synopsis + Played By)
// for the tapped show/movie. Poster and synopsis come from a get_metadata
// fetch made only now; the "Played By" chips load off the ratingKey inside
// openInfo, same as Recently Watched.
document.getElementById('mystats-body').addEventListener('click', async e => {
  const row = e.target.closest('.mw-row');
  if (!row || row.disabled) return;
  const item = myStatsTopWatched[Number(row.dataset.idx)];
  if (!item || !item.ratingKey) return;
  const playsLabel = `${item.plays} play${item.plays === 1 ? '' : 's'} this year`;
  openInfo({ title: item.title, badge: 'MOST WATCHED', meta: playsLabel, ratingKey: String(item.ratingKey) });
  const requestId = ++myStatsInfoRequest;
  try {
    const m = await api(`/api/tautulli/metadata/${item.ratingKey}`);
    if (requestId !== myStatsInfoRequest) return; // a newer click already superseded this one
    const posterEl = document.getElementById('info-poster');
    if (m.thumb) { posterEl.style.visibility = ''; posterEl.src = m.thumb; }
    document.getElementById('info-overview').textContent = m.overview || 'No synopsis available.';
    document.getElementById('info-meta').textContent = m.year ? `${m.year} · ${playsLabel}` : playsLabel;
  } catch (err) {
    // Poster/synopsis are a nice-to-have — the modal still shows the title and Played By.
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

// ---------- Theme picker ----------
// MARQUEE_THEMES/getTheme/setTheme live in shared.js (loaded by both pages);
// this is just the DOM wiring for this page's #theme-btn/#theme-modal.
const themeModal = document.getElementById('theme-modal');
function renderThemeGrid() {
  const active = getTheme();
  document.getElementById('theme-grid').innerHTML = MARQUEE_THEMES.map(t => `
    <button class="theme-card${t.id === active ? ' active' : ''}" data-theme-id="${escapeHtml(t.id)}">
      <div class="theme-card-name">${escapeHtml(t.name)}</div>
      <div class="theme-card-desc">${escapeHtml(t.desc)}</div>
      <div class="theme-swatches">
        <span class="theme-swatch" style="background:${escapeHtml(t.primary)}"></span>
        <span class="theme-swatch" style="background:${escapeHtml(t.card)}"></span>
        <span class="theme-swatch" style="background:${escapeHtml(t.accent)}"></span>
      </div>
      <div class="theme-card-check">&#10003; Active</div>
    </button>
  `).join('');
}
document.getElementById('theme-btn').addEventListener('click', () => {
  renderThemeGrid();
  themeModal.classList.remove('hidden');
});
document.getElementById('close-theme-btn').addEventListener('click', () => themeModal.classList.add('hidden'));
document.getElementById('theme-grid').addEventListener('click', e => {
  const card = e.target.closest('.theme-card');
  if (!card) return;
  setTheme(card.dataset.themeId);
  renderThemeGrid();
});
