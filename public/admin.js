// Owner-only control center — separate page from the family dashboard so
// none of this crowds the shared view. The real security boundary is
// server-side (every endpoint this page calls is requireAuth+requireOwner
// gated) — this client-side check just keeps a non-owner from landing on a
// page full of empty/error states instead of being sent back to the
// dashboard right away.
(async function initAdmin() {
  try {
    const me = await api('/api/auth/me');
    if (!me.isOwner) { location.href = '/'; return; }
  } catch (e) {
    location.href = '/';
    return;
  }

  initNotifyToggle();
  startPlexUptime();

  // System Status and Recent Sign-ins now live under Settings tabs (see
  // below) — loaded lazily on first view rather than eagerly here.
  loadAlerts();
  setInterval(loadAlerts, 30000);
  loadOrigins();
  setInterval(loadOrigins, 60000);
  loadWanted();
  setInterval(loadWanted, 60000);
  loadPendingRequests();
  setInterval(loadPendingRequests, 30000);
  loadAdminIssues();
  setInterval(loadAdminIssues, 30000);
  loadDiskSpace();
  setInterval(loadDiskSpace, 60000);
  loadSeeding();
  setInterval(loadSeeding, 60000);
  loadCleanupCandidates();
  loadDownloadIssues();
  setInterval(loadDownloadIssues, 15000);
  loadImportIssues();
  setInterval(loadImportIssues, 30000);
  loadIndexers();
  setInterval(loadIndexers, 60000);
})();

document.getElementById('admin-logout-btn').addEventListener('click', async () => {
  if (!await confirmDialog('Sign out?')) return;
  await api('/api/auth/logout', { method: 'POST' });
  location.href = '/';
});

// ---------- Owner Status (Uptime Kuma + UPS) ----------
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

// ---------- Database Backups ----------
function renderDbBackups(backups) {
  const body = document.getElementById('db-backup-body');
  if (!backups.length) {
    body.innerHTML = '<p class="empty-state">No backups yet.</p>';
    return;
  }
  body.innerHTML = backups.map(b => {
    const results = b.results || [];
    const failed = results.filter(r => !r.ok);
    const ok = results.filter(r => r.ok);
    const summary = results.length
      ? `${ok.length}/${results.length} databases backed up${failed.length ? ` · ${failed.length} failed` : ''}`
      : 'No databases found';
    return `
      <div class="audit-row">
        <span class="state-dot ${failed.length ? 'danger' : ''}"></span>
        <div class="audit-row-main">
          <div class="now-title">${b.startedAt ? timeAgo(b.startedAt) : b.stamp}</div>
          <div class="now-meta">${escapeHtml(summary)}${failed.length ? ` — ${failed.map(f => escapeHtml(f.name + ': ' + f.reason)).join('; ')}` : ''}</div>
        </div>
      </div>`;
  }).join('');
}

async function loadDbBackups() {
  const body = document.getElementById('db-backup-body');
  try {
    const { backups } = await api('/api/owner/db-backups?limit=10');
    renderDbBackups(backups);
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not load backup history.</p>';
  }
}

document.getElementById('run-db-backup-btn').addEventListener('click', async () => {
  const btn = document.getElementById('run-db-backup-btn');
  const status = document.getElementById('db-backup-status');
  btn.disabled = true;
  status.classList.remove('hidden');
  status.textContent = 'Running backup…';
  try {
    await api('/api/owner/db-backups/run', { method: 'POST' });
    status.textContent = 'Backup complete.';
    loadDbBackups();
  } catch (e) {
    status.textContent = `Failed: ${e.message}`;
  } finally {
    btn.disabled = false;
  }
});

// ---------- Image Cache ----------
async function loadMediaCacheStats() {
  const summary = document.getElementById('media-cache-summary');
  try {
    const { bytes, count, maxBytes } = await api('/api/owner/media-cache');
    summary.textContent = `${count} cached image${count === 1 ? '' : 's'} · ${formatBytes(bytes)} of ${formatBytes(maxBytes)} used.`;
  } catch (e) {
    summary.textContent = 'Could not load cache stats.';
  }
}

document.getElementById('flush-media-cache-btn').addEventListener('click', async () => {
  if (!await confirmDialog('Flush the entire image cache? Every poster and thumbnail will be re-fetched from Plex the next time it’s viewed.')) return;
  const btn = document.getElementById('flush-media-cache-btn');
  const status = document.getElementById('media-cache-status');
  btn.disabled = true;
  status.classList.remove('hidden');
  status.textContent = 'Flushing…';
  try {
    const { removed, freedBytes } = await api('/api/owner/media-cache/flush', { method: 'POST' });
    status.textContent = `Flushed ${removed} image${removed === 1 ? '' : 's'} (${formatBytes(freedBytes)} freed).`;
    loadMediaCacheStats();
  } catch (e) {
    status.textContent = `Failed: ${e.message}`;
  } finally {
    btn.disabled = false;
  }
});

// ---------- Family (recent sign-ins, pending requests, open issues) ----------
async function loadAdminLogins() {
  const body = document.getElementById('admin-logins-body');
  try {
    const logins = await api('/api/owner/logins');
    body.innerHTML = !logins.length ? '<p class="empty-state">No sign-ins recorded yet.</p>' : logins.map(l => `
      <div class="login-row">
        <img class="login-avatar" src="${l.thumb || ''}" loading="lazy" onerror="this.style.visibility='hidden'">
        <div>
          <div class="login-name">${escapeHtml(l.username)}${l.isOwner ? ' · Owner' : ''}</div>
          <div class="login-time">${timeAgo(l.at)}</div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not load sign-ins.</p>';
  }
}

// Shared by every poll-refreshed admin list that renders a poster/avatar
// <img> — same problem and fix as Now Playing/Recently Watched on the main
// dashboard (see renderNowPlaying in app.js): a full innerHTML rebuild on
// every poll recreates every <img> from scratch, which visibly reloads/
// flashes it even when nothing in the list actually changed. Reconciles by
// a caller-supplied stable key instead: an existing row (and its <img>) is
// created once and left alone, only updateRow's fields refresh in place.
// The key ends up on the row as data-recon-key — callers whose click
// handlers need to re-locate the source item (rather than reading it
// straight off other data-* attributes) can rely on that being present.
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

function createPendingRequestRow(r) {
  const row = document.createElement('div');
  row.className = 'pending-row';
  row.innerHTML = `
    <img class="result-poster" src="${r.poster || ''}" loading="lazy" onerror="this.style.visibility='hidden'">
    <div class="result-info">
      <div class="result-title"></div>
      <div class="pending-requester">
        <img src="${r.requestedByAvatar || ''}" loading="lazy" onerror="this.style.visibility='hidden'">
        <span class="requester-text"></span>
      </div>
    </div>
    <div class="pending-actions">
      <button class="approve-btn pill-btn"><span class="state-dot"></span><span class="btn-label">Approve</span></button>
      <button class="decline-btn pill-btn"><span class="state-dot danger"></span><span class="btn-label">Decline</span></button>
    </div>
  `;
  return row;
}

function updatePendingRequestRow(row, r) {
  row.dataset.id = r.id;
  row.dataset.mediaType = r.mediaType;
  row.dataset.tmdbId = r.tmdbId;
  row.querySelector('.result-title').textContent = r.title || 'Unknown title';
  row.querySelector('.requester-text').textContent = `${r.requestedBy} · ${timeAgo(r.requestedAt)}`;
}

async function loadPendingRequests() {
  const body = document.getElementById('admin-requests-body');
  try {
    const results = await api('/api/overseerr/requests/pending');
    if (!results.length) { body.innerHTML = '<p class="empty-state">Nothing pending.</p>'; return; }
    reconcileList(body, results, r => r.id, createPendingRequestRow, updatePendingRequestRow);
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not load pending requests.</p>';
  }
}

// Movies approve in one click (no seasons concept). TV requests go through
// the season picker below instead — Overseerr approves whatever seasons are
// currently on the request, so narrowing down what's approved means PUTting
// a trimmed seasons list first, then approving.
document.getElementById('admin-requests-body').addEventListener('click', async e => {
  const btn = e.target.closest('.approve-btn, .decline-btn');
  if (!btn) return;
  const row = btn.closest('.pending-row');

  if (btn.classList.contains('approve-btn') && row.dataset.mediaType === 'tv') {
    openApproveSeasonModal(row);
    return;
  }

  const action = btn.classList.contains('approve-btn') ? 'approve' : 'decline';
  row.querySelectorAll('button').forEach(b => b.disabled = true);
  btn.querySelector('.btn-label').textContent = '…';
  try {
    await api(`/api/overseerr/requests/${row.dataset.id}/${action}`, { method: 'POST' });
    row.remove();
    if (!document.getElementById('admin-requests-body').children.length) {
      document.getElementById('admin-requests-body').innerHTML = '<p class="empty-state">Nothing pending.</p>';
    }
  } catch (e) {
    row.querySelectorAll('button').forEach(b => b.disabled = false);
    btn.querySelector('.btn-label').textContent = action === 'approve' ? 'Approve' : 'Decline';
  }
});

// ---------- Approve-seasons modal (TV requests) ----------
let approveSeasonContext = null; // { row, tmdbId, requestedSeasons: number[] }

async function openApproveSeasonModal(row) {
  const listEl = document.getElementById('approve-season-list');
  const submitBtn = document.getElementById('approve-season-submit-btn');

  approveSeasonContext = { row, tmdbId: row.dataset.tmdbId, requestedSeasons: [] };
  document.getElementById('approve-season-title').textContent = row.querySelector('.result-title').textContent;
  listEl.innerHTML = '<p class="empty-state">Loading seasons…</p>';
  submitBtn.disabled = false;
  submitBtn.textContent = 'Approve Selected';
  document.getElementById('approve-season-modal').classList.remove('hidden');

  try {
    const data = await api(`/api/overseerr/tv/${approveSeasonContext.tmdbId}`);
    // Only seasons actually on this pending request are relevant here —
    // already-available seasons aren't part of the approval decision.
    const requested = data.seasons.filter(s => s.requested);
    approveSeasonContext.requestedSeasons = requested.map(s => s.seasonNumber);
    if (!requested.length) {
      listEl.innerHTML = '<p class="empty-state">No pending seasons found.</p>';
      submitBtn.disabled = true;
      return;
    }
    listEl.innerHTML = requested.map(s => `
      <div class="season-row">
        <input type="checkbox" value="${s.seasonNumber}" checked>
        <span class="season-row-name">${escapeHtml(s.name || `Season ${s.seasonNumber}`)}</span>
        <span class="season-row-episodes">${s.episodeCount} ep</span>
      </div>
    `).join('');
  } catch (e) {
    listEl.innerHTML = '<p class="empty-state">Could not load seasons.</p>';
    submitBtn.disabled = true;
  }
}

function closeApproveSeasonModal() {
  document.getElementById('approve-season-modal').classList.add('hidden');
  approveSeasonContext = null;
}

document.getElementById('close-approve-season-modal-btn').addEventListener('click', closeApproveSeasonModal);
document.getElementById('approve-season-cancel-btn').addEventListener('click', closeApproveSeasonModal);

document.getElementById('approve-season-submit-btn').addEventListener('click', async () => {
  if (!approveSeasonContext) return;
  const checked = [...document.querySelectorAll('#approve-season-list input[type="checkbox"]:checked')].map(cb => Number(cb.value));
  if (!checked.length) return;

  const { row, requestedSeasons } = approveSeasonContext;
  const submitBtn = document.getElementById('approve-season-submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Approving…';
  try {
    // Only trim the request's seasons if the owner actually unchecked
    // something — skips a needless PUT when approving everything as-requested.
    const narrowed = checked.length < requestedSeasons.length;
    if (narrowed) {
      await api(`/api/overseerr/requests/${row.dataset.id}`, {
        method: 'PUT',
        body: JSON.stringify({ seasons: checked })
      });
    }
    await api(`/api/overseerr/requests/${row.dataset.id}/approve`, { method: 'POST' });
    closeApproveSeasonModal();
    row.remove();
    if (!document.getElementById('admin-requests-body').children.length) {
      document.getElementById('admin-requests-body').innerHTML = '<p class="empty-state">Nothing pending.</p>';
    }
  } catch (e) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Failed — retry';
  }
});

function createAdminIssueRow(r) {
  const row = document.createElement('div');
  row.className = 'pending-row';
  row.innerHTML = `
    <img class="result-poster" src="${r.poster || ''}" loading="lazy" onerror="this.style.visibility='hidden'">
    <div class="result-info">
      <div class="result-title"></div>
      <div class="pending-requester">
        <img src="${r.reportedByAvatar || ''}" loading="lazy" onerror="this.style.visibility='hidden'">
        <span class="requester-text"></span>
      </div>
      <div class="issue-message hidden"></div>
    </div>
    <div class="pending-actions">
      <button class="search-release-btn pill-btn"><span class="state-dot"></span><span class="btn-label">Search</span></button>
      <button class="autofix-btn pill-btn"><span class="state-dot"></span><span class="btn-label">Auto Fix</span></button>
      <button class="approve-btn pill-btn"><span class="state-dot"></span><span class="btn-label">Resolve</span></button>
    </div>
  `;
  return row;
}

// The click handler below reads straight off this row's own dataset as
// openReleaseModal/openIssueFileInfo's ctx — every field it could need has
// to be kept current here on every poll, not just the visibly-displayed
// text (setting a data-* attribute doesn't touch the <img>, so this stays
// flicker-free the same way the text-only fields do).
function updateAdminIssueRow(row, r) {
  // loadAdminIssues() re-polls every 30s and reconciles by id — while an Auto
  // Fix is in flight this same row has had its innerHTML replaced by
  // renderTrackRow() (live grab/import progress, see trackAutoFix below), so
  // the fields this function writes to no longer exist in it. Without this
  // guard the poll would throw on the null .result-title lookup below, get
  // caught by loadAdminIssues()'s try/catch, and wipe the *entire* issues
  // list (body.innerHTML = ...) every 30s for as long as any auto-fix ran.
  if (row.dataset.autofixing === 'true') return;
  row.dataset.id = r.id;
  row.dataset.title = r.title || 'Unknown title';
  row.dataset.mediaType = r.mediaType || '';
  row.dataset.tmdbId = r.tmdbId || '';
  row.dataset.tvdbId = r.tvdbId || '';
  row.dataset.season = r.season || '';
  row.dataset.episode = r.episode || '';
  row.dataset.poster = r.poster || '';
  row.querySelector('.result-title').textContent = (r.title || 'Unknown title') + (r.season ? ` — S${r.season}E${r.episode}` : '');
  row.querySelector('.requester-text').textContent = `${r.reportedBy} · ${r.issueType} · ${timeAgo(r.reportedAt)}`;
  const msgEl = row.querySelector('.issue-message');
  if (r.message) { msgEl.textContent = r.message; msgEl.classList.remove('hidden'); }
  else msgEl.classList.add('hidden');
}

async function loadAdminIssues() {
  const body = document.getElementById('admin-issues-body');
  try {
    const results = await api('/api/overseerr/issues/open');
    if (!results.length) { body.innerHTML = '<p class="empty-state">Nothing open.</p>'; return; }
    reconcileList(body, results, r => r.id, createAdminIssueRow, updateAdminIssueRow);
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not load issues.</p>';
  }
}

// Same "Search button jumps straight to release search, tapping anywhere else
// on the row shows current-file details first" pattern as Wanted/Missing.
document.getElementById('admin-issues-body').addEventListener('click', async e => {
  const searchBtn = e.target.closest('.search-release-btn');
  if (searchBtn) {
    openReleaseModal(searchBtn.closest('.pending-row').dataset);
    return;
  }

  const autofixBtn = e.target.closest('.autofix-btn');
  if (autofixBtn) {
    runAutoFix(autofixBtn.closest('.pending-row'));
    return;
  }

  const approveBtn = e.target.closest('.approve-btn');
  if (approveBtn) {
    const row = approveBtn.closest('.pending-row');
    row.querySelectorAll('button').forEach(b => b.disabled = true);
    approveBtn.querySelector('.btn-label').textContent = '…';
    try {
      await api(`/api/overseerr/issues/${row.dataset.id}/resolve`, { method: 'POST' });
      row.remove();
      if (!document.getElementById('admin-issues-body').children.length) {
        document.getElementById('admin-issues-body').innerHTML = '<p class="empty-state">Nothing open.</p>';
      }
    } catch (err) {
      row.querySelectorAll('button').forEach(b => b.disabled = false);
      approveBtn.querySelector('.btn-label').textContent = 'Resolve';
    }
    return;
  }

  const row = e.target.closest('.pending-row');
  if (!row) return;
  openIssueFileInfo(row.dataset);
});

// ---------- Alerts (arr-stack health watchdog findings) ----------
// Populated by an external cron script (arr-health-watchdog.mjs on docker-host),
// which POSTs to /api/alerts/ingest on a 15-minute cycle — this panel just polls
// Marquee's own reconciled view of that data, same pattern as loadAdminIssues above.
function alertSeverityDotClass(severity) {
  if (severity === 'error') return 'state-dot danger';
  if (severity === 'warning') return 'state-dot warning';
  return 'state-dot paused'; // 'notice' — neutral
}

// One label per lib/alerts.js `source` value — arr-health-watchdog.mjs reports
// 'health'/'log-triage', lib/issueWatchdog.js reports the rest.
function alertSourceLabel(source) {
  return {
    'log-triage': 'Log triage',
    health: 'Health check',
    issue: 'Reported issue',
    import: 'Import stuck',
    attention: 'Download stuck',
    wanted: 'Wanted/missing',
    'error-torrents': 'Torrent needs attention',
  }[source] || source;
}

// The one alert-level action offered directly (not behind Suggest fix — there's
// nothing to reason about, qbit-error-torrents.mjs on docker-host already knows
// exactly which torrents are dead). See routes/alerts.js's qbit-remove-torrents
// route for why this is safe to expose as a single button.
function autofixAction(a) {
  return a.actionData?.type === 'qbit-remove-torrents' && a.actionData.hashes?.length ? a.actionData : null;
}

// Suggest-fix is only offered for alert sources with enough specific context to
// be worth reasoning over (matches routes/alerts.js's FIX_PROMPTS keys exactly —
// see TODO.md's v1.9.0 entry for why 'health'/'wanted'/'issue'/'attention' aren't
// included yet).
function canSuggestFix(source) {
  return source === 'log-triage' || source === 'import';
}

// Alert rows carry no media poster (they're not about a movie/show), so the
// same leading-image slot Wanted/Missing rows use for a poster instead gets
// a colored app-monogram badge here — a glance at the row tells you which
// app it's about without reading the text line. Colors are each app's own
// real brand color, not picked arbitrarily. `app` values match exactly
// what arr-health-watchdog.mjs/lib/issueWatchdog.js report (see
// alertSourceLabel above) — 'default' below covers anything unrecognized
// rather than rendering a blank badge.
const APP_ICONS = {
  sonarr: { label: 'SO', cls: 'sonarr' },
  radarr: { label: 'RA', cls: 'radarr' },
  prowlarr: { label: 'PR', cls: 'prowlarr' },
  overseerr: { label: 'OV', cls: 'overseerr' },
  downloads: { label: 'DL', cls: 'downloads' },
  qbittorrent: { label: 'QB', cls: 'downloads' },
};
function appIconInfo(app) {
  return APP_ICONS[app] || { label: (app || '?').slice(0, 2).toUpperCase(), cls: 'default' };
}

function createAlertRow(a) {
  const row = document.createElement('div');
  row.className = 'pending-row';
  row.innerHTML = `
    <div class="app-icon"></div>
    <div class="result-info">
      <div class="result-title"><span class="alert-dot"></span><span class="alert-title-text"></span></div>
      <div class="pending-requester"><span class="requester-text"></span></div>
      <div class="issue-message hidden"></div>
      <div class="alert-file-list-block hidden">
        <div class="alert-file-list-head">
          <span class="alert-file-list-label"></span>
        </div>
        <ul class="alert-file-list"></ul>
      </div>
      <div class="fix-suggestion hidden">
        <div class="fix-suggestion-head">
          <span class="fix-suggestion-label">Suggested fix</span>
          <button class="copy-fix-btn pill-btn pill-btn-icon" type="button" title="Copy steps"><span class="btn-label">⧉</span></button>
        </div>
        <ol class="fix-steps"></ol>
        <div class="fix-action hidden">
          <button class="test-download-client-btn pill-btn" type="button"><span class="btn-label"></span></button>
          <span class="fix-action-result"></span>
        </div>
      </div>
    </div>
    <div class="pending-actions">
      <button class="see-list-btn pill-btn hidden" type="button"><span class="btn-label">See list</span></button>
      ${canSuggestFix(a.source) ? '<button class="suggest-fix-btn pill-btn"><span class="btn-label">Suggest fix</span></button>' : ''}
      <button class="autofix-btn pill-btn hidden" type="button"><span class="btn-label"></span></button>
      <button class="dismiss-alert-btn pill-btn"><span class="btn-label">Dismiss</span></button>
    </div>
  `;
  return row;
}

// Parses routes/alerts.js's requested "1. ...\n2. ..." format into discrete
// steps for a real <ol>, stripping the leading numbering (the <ol> itself
// numbers them). Falls back to one step per non-empty line if the model
// didn't number them, and to the whole text as a single step if it came
// back as one unbroken paragraph — never silently drops content just
// because the format wasn't followed exactly.
function parseFixSteps(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const steps = lines.map(l => l.replace(/^\d+[.)]\s*/, '')).filter(Boolean);
  return steps.length ? steps : [text.trim()];
}

// Matches qbit-disk-guard.mjs's own FILES_MARKER exactly — the part of `detail`
// before it is the always-visible summary, the part after is one file per line for
// the collapsed "See list" panel. Any alert without the marker just has no file list
// (fileNames comes back empty), which covers every other alert source unchanged.
const FILES_MARKER = '\n###FILES###\n';
function splitDetailAndFiles(detail) {
  if (!detail) return { summary: '', fileNames: [] };
  const idx = detail.indexOf(FILES_MARKER);
  if (idx === -1) return { summary: detail, fileNames: [] };
  return {
    summary: detail.slice(0, idx),
    fileNames: detail.slice(idx + FILES_MARKER.length).split('\n').filter(Boolean),
  };
}

function updateAlertRow(row, a) {
  row.dataset.key = a.key;
  const icon = appIconInfo(a.app);
  const iconEl = row.querySelector('.app-icon');
  iconEl.className = `app-icon ${icon.cls}`;
  iconEl.textContent = icon.label;
  // Preserve the alert-dot class alongside the severity classes — setting
  // className to just alertSeverityDotClass()'s result was silently
  // wiping it out, which broke .result-title .alert-dot's margin-right
  // rule (it never matched anything once this ran) and pinned the dot
  // right up against the title text with no gap.
  row.querySelector('.alert-dot').className = `alert-dot ${alertSeverityDotClass(a.severity)}`;
  row.querySelector('.alert-title-text').textContent = a.title;
  row.querySelector('.requester-text').textContent =
    `${a.app} · ${alertSourceLabel(a.source)} · ${timeAgo(a.lastSeenAt)}`;
  const { summary, fileNames } = splitDetailAndFiles(a.detail);
  const msgEl = row.querySelector('.issue-message');
  if (summary) { msgEl.textContent = summary; msgEl.classList.remove('hidden'); }
  else msgEl.classList.add('hidden');

  // Re-checked every poll, not just at row creation — the hash list this button
  // acts on can genuinely change between polls (e.g. one torrent's problem
  // resolved on its own while another appeared), and it needs to disappear
  // entirely once nothing autofix-able is left.
  const autofix = autofixAction(a);
  const autofixBtn = row.querySelector('.autofix-btn');
  autofixBtn.classList.toggle('hidden', !autofix);
  if (autofix) {
    const n = autofix.hashes.length;
    autofixBtn.querySelector('.btn-label').textContent = `Remove ${n} dead torrent${n === 1 ? '' : 's'}`;
  }

  // This panel polls every 30s (see loadAlerts) — re-populate the list content every
  // time (it can genuinely change between polls, e.g. a still-running cleanup), but
  // only touch open/closed state when the list disappears entirely. Forcibly
  // re-collapsing an already-open panel on every poll would fight anyone actually
  // reading it.
  const seeListBtn = row.querySelector('.see-list-btn');
  const listBlock = row.querySelector('.alert-file-list-block');
  if (fileNames.length) {
    row.querySelector('.alert-file-list-label').textContent = `${fileNames.length} file${fileNames.length === 1 ? '' : 's'}`;
    row.querySelector('.alert-file-list').innerHTML = fileNames.map(f => `<li>${escapeHtml(f)}</li>`).join('');
    seeListBtn.classList.remove('hidden');
    seeListBtn.querySelector('.btn-label').textContent = listBlock.classList.contains('hidden') ? 'See list' : 'Hide list';
  } else {
    seeListBtn.classList.add('hidden');
    listBlock.classList.add('hidden');
  }
}

// Stream Origins — CH.11. Real data: lib/streamOrigins.js geoIP-resolves
// each new session's ip_address_public locally (no external call) and
// stores it, year-to-date, resetting every Jan 1. nowPlaying.js's own
// mapSession() still never carries that field to the shared family
// dashboard feed — this owner-only panel is the one place it's read.
// Real coastline data (see originsWorldPath.js, loaded before this file) on
// the same 720x360 equirectangular canvas the heat points are projected
// onto — ORIGINS_WORLD_PATH is a global from that file, not a local const.

function originsProject(lat, lon) {
  return { x: (lon + 180) * 2, y: (90 - lat) * 2 };
}

// Auto-frames the map to wherever the actual data is instead of always
// showing the full 720x360 world canvas — for a deployment whose viewers
// are overwhelmingly one region (the common case), the full world wastes
// most of the map on empty ocean/continents. Crops to the bounding box of
// the real points (+ the server point, if set) with padding, then expands
// the shorter axis to match .origins-map-wrap's 2:1 aspect ratio so the
// crop never stretches. Purely data-driven — a deployment with genuinely
// global viewers still gets the full spread, not a hardcoded region.
function originsViewBox(points, server) {
  const pts = (server ? [...points, server] : points).map(p => originsProject(p.lat, p.lon));
  if (!pts.length) return '0 0 720 360';
  const PAD = 40;
  const MIN_W = 200; // floor so a single-city deployment doesn't zoom in absurdly tight
  let minX = Math.min(...pts.map(p => p.x)) - PAD;
  let maxX = Math.max(...pts.map(p => p.x)) + PAD;
  let minY = Math.min(...pts.map(p => p.y)) - PAD;
  let maxY = Math.max(...pts.map(p => p.y)) + PAD;
  if (maxX - minX < MIN_W) {
    const cx = (minX + maxX) / 2;
    minX = cx - MIN_W / 2; maxX = cx + MIN_W / 2;
  }
  const targetH = (maxX - minX) / 2;
  if (targetH > maxY - minY) {
    const cy = (minY + maxY) / 2;
    minY = cy - targetH / 2; maxY = cy + targetH / 2;
  } else {
    const targetW = (maxY - minY) * 2;
    const cx = (minX + maxX) / 2;
    minX = cx - targetW / 2; maxX = cx + targetW / 2;
  }
  // Shift back inside the world canvas rather than shrinking, so the 2:1
  // ratio survives clamping.
  if (minX < 0) { maxX -= minX; minX = 0; }
  if (maxX > 720) { minX -= (maxX - 720); maxX = 720; }
  if (minY < 0) { maxY -= minY; minY = 0; }
  if (maxY > 360) { minY -= (maxY - 360); maxY = 360; }
  minX = Math.max(0, minX); maxX = Math.min(720, maxX);
  minY = Math.max(0, minY); maxY = Math.min(360, maxY);
  return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
}

// Great-circle-ish visual arc between two projected points — a quadratic
// Bezier lifted perpendicular to the chord, capped so short hops don't
// balloon and long hops don't flatten into a straight line.
function originsArcPath(x1, y1, x2, y2) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const lift = Math.min(dist * 0.28, 40);
  return `M${x1},${y1} Q${mx},${my - lift} ${x2},${y2}`;
}

const ORIGINS_MEDALS = ['🥇', '🥈', '🥉'];
const ORIGINS_RANK_CLASSES = ['gold', 'silver', 'bronze'];

// Rank 1 is the warmest/brightest point; each rank after fades a step cooler and
// dimmer, so the map reads at a glance which spots actually dominate rather than
// every dot looking equally important — reusing this app's existing gold/silver/
// bronze medal palette for ranks 1-3, plain amber for the rest.
function originsPointColor(rank) {
  if (rank === 0) return 'var(--gold)';
  if (rank === 1) return 'var(--silver)';
  if (rank === 2) return 'var(--bronze)';
  return 'var(--amber)';
}

let originsTooltipEl = null;
function originsTooltip() {
  if (!originsTooltipEl) {
    originsTooltipEl = document.createElement('div');
    originsTooltipEl.className = 'origins-tooltip hidden';
    document.getElementById('panel-origins').appendChild(originsTooltipEl);
  }
  return originsTooltipEl;
}

// Terse "who streamed from here" line for a legend row — names only, no
// counts (those live in the hover tooltip via originsUsersDetail below).
// Capped at 3 named users so one shared VPN exit or a big household doesn't
// blow out the row height; the rest are folded into a "& N more" tail.
function originsUsersByline(users) {
  if (!users?.length) return '';
  const names = users.map(u => u.name);
  const shown = names.slice(0, 3);
  const rest = names.length - shown.length;
  return escapeHtml(shown.join(', ')) + (rest > 0 ? ` <span class="origins-legend-who-more">& ${rest} more</span>` : '');
}

// Full per-user breakdown for a place, one line per person — the legend row
// only has room for a terse "who" byline (see originsUsersByline), so the
// tooltip is where the actual counts live.
function originsUsersDetail(users) {
  if (!users?.length) return '';
  return `<div class="origins-tooltip-users">${users.map(u =>
    `<span>${escapeHtml(u.name)} · ${u.count.toLocaleString('en-US')}</span>`
  ).join('')}</div>`;
}

function showOriginsTooltip(anchorEl, o) {
  const tip = originsTooltip();
  tip.innerHTML = `<div class="origins-tooltip-place">${escapeHtml(o.place)}</div>
    <div class="origins-tooltip-detail">${o.count.toLocaleString('en-US')} stream${o.count === 1 ? '' : 's'} · ${o.pct}%</div>
    ${originsUsersDetail(o.users)}`;
  const panelRect = document.getElementById('panel-origins').getBoundingClientRect();
  const anchorRect = anchorEl.getBoundingClientRect();
  tip.style.left = `${anchorRect.left - panelRect.left + anchorRect.width / 2}px`;
  tip.style.top = `${anchorRect.top - panelRect.top}px`;
  tip.classList.remove('hidden');
}
function hideOriginsTooltip() {
  originsTooltipEl?.classList.add('hidden');
}

function renderOrigins(locations, server) {
  const body = document.getElementById('origins-body');
  if (!locations.length) {
    const emptyLabel = originsRange === 'ytd' ? 'this year' : originsRange === 'all' ? '' : `in the last ${originsRange === '30d' ? '30' : '90'} days`;
    body.innerHTML = `<p class="empty-state">No streams recorded yet ${emptyLabel}.</p>`;
    return;
  }
  const sorted = [...locations].sort((a, b) => b.pct - a.pct);
  const maxPct = sorted[0].pct;

  // SERVER_LAT/SERVER_LON (routes/owner.js) is optional — when set, draw a
  // sparkline arc from every origin to that one point instead of isolated
  // heat-point blobs, so the map reads as "streams reaching your server"
  // rather than just "where viewers are." Unset falls back to the original
  // blob rendering unchanged.
  const points = server
    ? sorted.map((o, i) => {
        const { x, y } = originsProject(o.lat, o.lon);
        const sp = originsProject(server.lat, server.lon);
        const color = originsPointColor(i);
        const isTop = i === 0;
        const width = 0.8 + (o.pct / maxPct) * 1.6;
        const dotR = 2 + (o.pct / maxPct) * 3;
        return `<g class="origins-heat-point${isTop ? ' is-top' : ''}" data-idx="${i}">
          <path class="origins-arc${isTop ? ' origins-arc-top' : ''}" d="${originsArcPath(x, y, sp.x, sp.y)}"
            style="stroke:${color}" stroke-width="${width}" opacity="${isTop ? 0.85 : 0.4}" />
          <circle class="origins-origin-dot" cx="${x}" cy="${y}" r="${dotR}" style="fill:${color}" />
          <circle class="origins-heat-hitbox" cx="${x}" cy="${y}" r="10" />
        </g>`;
      }).join('') + `<circle class="origins-server-ring" cx="${originsProject(server.lat, server.lon).x}" cy="${originsProject(server.lat, server.lon).y}" r="6" />
      <circle class="origins-server-dot" cx="${originsProject(server.lat, server.lon).x}" cy="${originsProject(server.lat, server.lon).y}" r="4" />`
    : sorted.map((o, i) => {
        const { x, y } = originsProject(o.lat, o.lon);
        const coreR = 4 + (o.pct / maxPct) * 10;
        const glowR = coreR * 2.4;
        const color = originsPointColor(i);
        return `<g class="origins-heat-point${i === 0 ? ' is-top' : ''}" data-idx="${i}">
          <circle class="origins-heat-glow" cx="${x}" cy="${y}" r="${glowR}" style="fill:${color}" />
          <circle class="origins-heat-core" cx="${x}" cy="${y}" r="${coreR}" style="fill:${color}" />
          <circle class="origins-heat-hitbox" cx="${x}" cy="${y}" r="${Math.max(glowR, 10)}" />
        </g>`;
      }).join('');

  const legend = sorted.map((o, i) => {
    const rankMarker = i < 3
      ? `<span class="origins-legend-medal">${ORIGINS_MEDALS[i]}</span>`
      : `<span class="origins-legend-rank">${i + 1}</span>`;
    const rankClass = i < 3 ? ` ${ORIGINS_RANK_CLASSES[i]}` : '';
    return `
    <div class="origins-legend-row" data-idx="${i}">
      ${rankMarker}
      <div class="origins-legend-main">
        <div class="origins-legend-top-row">
          <span class="origins-legend-place${rankClass}">${escapeHtml(o.place)}</span>
          <span class="origins-legend-pct">${o.count.toLocaleString('en-US')} · ${o.pct}%</span>
        </div>
        <div class="origins-legend-who">${originsUsersByline(o.users)}</div>
        <div class="bar"><div class="bar-fill" style="width:${(o.pct / maxPct) * 100}%"></div></div>
      </div>
    </div>`;
  }).join('');

  body.innerHTML = `
    <div class="origins-map-wrap">
      <svg viewBox="${originsViewBox(sorted, server)}" role="img" aria-label="Map of stream origins">
        <filter id="origins-blur"><feGaussianBlur stdDeviation="3" /></filter>
        <path class="origins-land" d="${ORIGINS_WORLD_PATH}" />
        ${server ? `<g>${points}</g>` : `<g filter="url(#origins-blur)">${points}</g>`}
      </svg>
    </div>
    ${legend}
  `;

  // Hovering a map point highlights its legend row and vice versa — same `data-idx`
  // correlates the two, both driven by the one shared tooltip.
  const rows = body.querySelectorAll('.origins-legend-row');
  const mapPoints = body.querySelectorAll('.origins-heat-point');
  function setActive(idx) {
    rows.forEach((r) => r.classList.toggle('is-active', r.dataset.idx === idx));
    mapPoints.forEach((p) => p.classList.toggle('is-active', p.dataset.idx === idx));
  }
  function clearActive() {
    rows.forEach((r) => r.classList.remove('is-active'));
    mapPoints.forEach((p) => p.classList.remove('is-active'));
    hideOriginsTooltip();
  }
  mapPoints.forEach((p) => {
    p.addEventListener('mouseenter', () => { setActive(p.dataset.idx); showOriginsTooltip(p, sorted[Number(p.dataset.idx)]); });
    p.addEventListener('mouseleave', clearActive);
  });
  rows.forEach((r) => {
    r.addEventListener('mouseenter', () => { setActive(r.dataset.idx); showOriginsTooltip(r, sorted[Number(r.dataset.idx)]); });
    r.addEventListener('mouseleave', clearActive);
  });
}

let originsRange = 'ytd';
async function loadOrigins() {
  const body = document.getElementById('origins-body');
  try {
    const { locations, server } = await api(`/api/owner/stream-origins?range=${originsRange}`);
    renderOrigins(locations, server);
  } catch (e) {
    if (!body.children.length) body.innerHTML = '<p class="empty-state">Could not load stream origins.</p>';
  }
}

document.querySelectorAll('.origins-range-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('active')) return;
    document.querySelectorAll('.origins-range-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    originsRange = btn.dataset.range;
    document.getElementById('origins-body').innerHTML = '<p class="empty-state">Loading…</p>';
    loadOrigins();
  });
});

async function loadAlerts() {
  const body = document.getElementById('alerts-body');
  try {
    const results = await api('/api/alerts');
    if (!results.length) { body.innerHTML = '<p class="empty-state">No open issues — stack is healthy.</p>'; return; }
    reconcileList(body, results, a => a.key, createAlertRow, updateAlertRow);
  } catch (e) {
    // This panel polls every 30s (twice most others' 60s), so a momentary
    // network blip shows up here first and most often. Only replace the
    // panel with an error state if there's nothing already on screen (a
    // genuine first-load failure) — a transient hiccup mid-session should
    // just leave the last-known-good list up rather than flashing it away
    // and erasing real, still-actionable data for one missed poll.
    if (!body.children.length) body.innerHTML = '<p class="empty-state">Could not load alerts.</p>';
  }
}

// Soft-dismisses every currently-open alert in one call (see lib/alerts.js's
// acknowledgeAll) — confirmed first since, unlike Search All above, this
// hides real still-open problems from view until something re-triggers them,
// not a purely additive action.
document.getElementById('dismiss-all-alerts-btn').addEventListener('click', async () => {
  if (!await confirmDialog('Dismiss all open alerts? They’ll only reappear if the same problem is detected again.')) return;
  const btn = document.getElementById('dismiss-all-alerts-btn');
  btn.disabled = true;
  try {
    await api('/api/alerts/dismiss-all', { method: 'POST' });
    document.getElementById('alerts-body').innerHTML = '<p class="empty-state">No open issues — stack is healthy.</p>';
  } catch (err) {
    // Leave whatever was on screen as-is — the next 30s poll will reconcile
    // either way, so there's nothing useful to show inline here.
  } finally {
    btn.disabled = false;
  }
});

// Renders the parsed steps into the <ol>, and stashes a plain-text version
// (numbered, one per line) on the container for the copy button to read —
// simpler than re-deriving it from the rendered <li> text at copy time.
// `action` (from suggest-fix's response) is the one narrow, deterministic
// case where a one-click button is offered instead of a manual step — see
// routes/alerts.js's findAction for why this is safe to offer at all.
function renderFixSteps(fixEl, steps, { copyable, action = null }) {
  fixEl.querySelector('.fix-steps').innerHTML = steps.map(s => `<li>${escapeHtml(s)}</li>`).join('');
  fixEl.dataset.plainText = copyable ? steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : '';
  fixEl.querySelector('.copy-fix-btn').classList.toggle('hidden', !copyable);

  const actionEl = fixEl.querySelector('.fix-action');
  const resultEl = actionEl.querySelector('.fix-action-result');
  resultEl.textContent = '';
  resultEl.className = 'fix-action-result';
  if (action?.type === 'test-download-client') {
    actionEl.querySelector('.test-download-client-btn').querySelector('.btn-label').textContent = `Test ${action.clientName} Connection`;
    actionEl.classList.remove('hidden');
  } else {
    actionEl.classList.add('hidden');
  }

  fixEl.classList.remove('hidden');
}

document.getElementById('alerts-body').addEventListener('click', async e => {
  const copyBtn = e.target.closest('.copy-fix-btn');
  if (copyBtn) {
    const fixEl = copyBtn.closest('.fix-suggestion');
    try {
      await navigator.clipboard.writeText(fixEl.dataset.plainText || '');
      const label = copyBtn.querySelector('.btn-label');
      const prev = label.textContent;
      label.textContent = '✓';
      setTimeout(() => { label.textContent = prev; }, 1200);
    } catch (err) {
      // Clipboard API can be denied (permissions, non-HTTPS context, etc.) —
      // the steps are still right there on screen to select manually, so
      // this fails quiet rather than showing an alert for a non-critical
      // convenience action.
    }
    return;
  }

  const testBtn = e.target.closest('.test-download-client-btn');
  if (testBtn) {
    const row = testBtn.closest('.pending-row');
    const resultEl = testBtn.closest('.fix-action').querySelector('.fix-action-result');
    const label = testBtn.querySelector('.btn-label');
    const prevLabel = label.textContent;
    testBtn.disabled = true;
    label.textContent = 'Testing…';
    resultEl.textContent = '';
    resultEl.className = 'fix-action-result';
    try {
      const result = await api(`/api/alerts/${encodeURIComponent(row.dataset.key)}/actions/test-download-client`, { method: 'POST' });
      resultEl.textContent = result.ok ? '✓ Connected' : `✗ ${result.message || 'Connection failed'}`;
      resultEl.className = `fix-action-result ${result.ok ? 'ok' : 'error'}`;
    } catch (err) {
      resultEl.textContent = `✗ ${err.message || 'Could not run the test'}`;
      resultEl.className = 'fix-action-result error';
    } finally {
      testBtn.disabled = false;
      label.textContent = prevLabel;
    }
    return;
  }

  const autofixBtn = e.target.closest('.autofix-btn');
  if (autofixBtn) {
    const row = autofixBtn.closest('.pending-row');
    const label = autofixBtn.querySelector('.btn-label');
    const prevLabel = label.textContent;
    if (!await confirmDialog(`${prevLabel}? Their downloaded files (already unreachable — that's why they're flagged) are removed along with them.`)) return;
    autofixBtn.disabled = true;
    label.textContent = 'Removing…';
    try {
      const result = await api(`/api/alerts/${encodeURIComponent(row.dataset.key)}/actions/qbit-remove-torrents`, { method: 'POST' });
      if (result.failed) {
        label.textContent = `${result.removed} removed, ${result.failed} failed`;
        autofixBtn.disabled = false;
      } else {
        row.remove();
        if (!document.getElementById('alerts-body').children.length) {
          document.getElementById('alerts-body').innerHTML = '<p class="empty-state">No open issues — stack is healthy.</p>';
        }
      }
    } catch (err) {
      label.textContent = prevLabel;
      autofixBtn.disabled = false;
    }
    return;
  }

  const seeListBtn = e.target.closest('.see-list-btn');
  if (seeListBtn) {
    // Purely a local expand/collapse toggle — the full list already arrived with the
    // alert (see splitDetailAndFiles), no API round-trip needed unlike Suggest fix.
    const row = seeListBtn.closest('.pending-row');
    const listBlock = row.querySelector('.alert-file-list-block');
    listBlock.classList.toggle('hidden');
    seeListBtn.querySelector('.btn-label').textContent = listBlock.classList.contains('hidden') ? 'See list' : 'Hide list';
    return;
  }

  const suggestBtn = e.target.closest('.suggest-fix-btn');
  if (suggestBtn) {
    const row = suggestBtn.closest('.pending-row');
    const fixEl = row.querySelector('.fix-suggestion');
    suggestBtn.disabled = true;
    suggestBtn.querySelector('.btn-label').textContent = 'Thinking…';
    try {
      const { suggestion, action } = await api(`/api/alerts/${encodeURIComponent(row.dataset.key)}/suggest-fix`, { method: 'POST' });
      renderFixSteps(fixEl, parseFixSteps(suggestion), { copyable: true, action });
    } catch (err) {
      renderFixSteps(fixEl, ['Could not get a suggestion right now.'], { copyable: false });
    } finally {
      suggestBtn.disabled = false;
      // Once a suggestion is showing, relabel so the button reads as "get a
      // different one" rather than looking like it was never clicked —
      // previously stayed "Suggest fix" even with a suggestion already
      // filled in right next to it.
      suggestBtn.querySelector('.btn-label').textContent = fixEl.classList.contains('hidden') ? 'Suggest fix' : 'Refresh suggestion';
    }
    return;
  }

  const btn = e.target.closest('.dismiss-alert-btn');
  if (!btn) return;
  const row = btn.closest('.pending-row');
  btn.disabled = true;
  try {
    await api(`/api/alerts/${encodeURIComponent(row.dataset.key)}/dismiss`, { method: 'POST' });
    row.remove();
    if (!document.getElementById('alerts-body').children.length) {
      document.getElementById('alerts-body').innerHTML = '<p class="empty-state">No open issues — stack is healthy.</p>';
    }
  } catch (err) {
    btn.disabled = false;
  }
});

// Looks up what's currently on disk for a reported item, so the owner sees
// the actual file (quality/size/codec) before deciding to search for a
// replacement — rather than searching blind from just the issue report.
async function openIssueFileInfo(ctx) {
  const isMovie = ctx.mediaType === 'movie';
  openFileInfoModal({
    badge: isMovie ? 'MOVIE' : 'TV',
    title: ctx.title,
    subtitle: ctx.season ? `S${ctx.season}E${ctx.episode}` : '',
    poster: ctx.poster,
    file: undefined, // triggers the "Loading…" state below
    onSearch: () => openReleaseModal(ctx)
  });
  try {
    const url = isMovie
      ? `/api/radarr/file-info?tmdbId=${ctx.tmdbId}`
      : `/api/sonarr/file-info?tvdbId=${ctx.tvdbId}&season=${ctx.season}&episode=${ctx.episode}`;
    const info = await api(url);
    document.getElementById('file-info-details').textContent = formatFileDetails(info.file);
    if (info.poster) document.getElementById('file-info-poster').src = info.poster;
  } catch (e) {
    document.getElementById('file-info-details').textContent = 'Could not load file info.';
  }
}

// ---------- Release search modal ----------
// Interactive search against Radarr/Sonarr's own configured indexers, so a
// bad/wrong release reported as an issue (or a wanted/missing item — see
// below) can be fixed without leaving the dashboard. Can take up to ~a
// minute — this is a live indexer search, not a cached lookup, same as
// Sonarr/Radarr's own "Interactive Search" UI.
async function openReleaseModal(ctx) {
  const modal = document.getElementById('release-modal');
  const listEl = document.getElementById('release-list');
  document.getElementById('release-modal-title').textContent = ctx.title + (
    ctx.episode != null ? ` — S${ctx.season}E${ctx.episode}` :
    ctx.season != null ? ` — Season ${ctx.season}` : ''
  );
  listEl.innerHTML = '<p class="empty-state">Searching indexers… this can take up to a minute (longer for a whole-season search on a long-running show).</p>';
  modal.classList.remove('hidden');

  const isMovie = ctx.mediaType === 'movie';
  const url = isMovie
    ? `/api/radarr/releases?tmdbId=${ctx.tmdbId}`
    : `/api/sonarr/releases?tvdbId=${ctx.tvdbId}&season=${ctx.season}` + (ctx.episode != null ? `&episode=${ctx.episode}` : '');
  const grabUrl = isMovie ? '/api/radarr/releases/grab' : '/api/sonarr/releases/grab';

  try {
    const releases = await api(url);
    if (!releases.length) { listEl.innerHTML = '<p class="empty-state">No releases found.</p>'; return; }
    listEl.innerHTML = releases.map(r => `
      <div class="release-row ${r.rejected ? 'rejected' : ''}">
        <div class="release-info">
          <div class="release-title" title="${escapeHtml(r.title)}">${r.fullSeason ? '<span class="chan chan-teal">Season Pack</span> ' : ''}${escapeHtml(r.title)}</div>
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
    const row = btn.closest('.release-row');
    const releaseTitle = row.querySelector('.release-title').textContent;
    btn.disabled = true;
    btn.querySelector('.btn-label').textContent = 'Grabbing…';
    try {
      await api(grabUrl, {
        method: 'POST',
        body: JSON.stringify({ guid: btn.dataset.guid, indexerId: Number(btn.dataset.indexerId) })
      });
      trackGrab(row, ctx, isMovie, releaseTitle);
    } catch (err) {
      btn.disabled = false;
      btn.querySelector('.btn-label').textContent = 'Grab';
    }
  };
}

// Turns the grabbed row into a live-tracked status instead of freezing at
// "Grabbed ✓" — polls /grab-status (see routes/radarr.js / routes/sonarr.js)
// every 4s and updates the same row in place through downloading -> importing
// -> done/failed. Stops polling once the modal (and this row with it) is no
// longer in the document, e.g. the owner closed it or searched again.
function renderTrackRow(row, releaseTitle) {
  row.innerHTML = `
    <div class="release-info">
      <div class="release-title" title="${escapeHtml(releaseTitle)}">${escapeHtml(releaseTitle)}</div>
      <div class="track-stage"><span class="state-dot"></span><span class="stage-text">Grabbed</span></div>
      <div class="track-meta">Waiting for the downloader…</div>
      <div class="bar hidden"><div class="bar-fill"></div></div>
    </div>
  `;
}

function updateTrackRow(row, status, ctx, isMovie) {
  const dotEl = row.querySelector('.state-dot');
  const stageEl = row.querySelector('.stage-text');
  const metaEl = row.querySelector('.track-meta');
  const barEl = row.querySelector('.bar');
  dotEl.className = 'state-dot';
  barEl.classList.add('hidden');

  if (status.stage === 'downloading') {
    stageEl.textContent = 'Downloading';
    dotEl.classList.add('amber');
    barEl.classList.remove('hidden');
    row.querySelector('.bar-fill').style.width = (status.progress ?? 0) + '%';
    metaEl.textContent = [
      status.progress != null ? `${status.progress}%` : null,
      status.eta != null ? formatEta(status.eta) : null
    ].filter(Boolean).join(' · ');
  } else if (status.stage === 'importing') {
    stageEl.textContent = 'Importing';
    dotEl.classList.add('amber', 'pulse');
    metaEl.textContent = 'Matching file into the library…';
  } else if (status.stage === 'done') {
    stageEl.textContent = 'Done';
    metaEl.innerHTML = `<span class="track-result-ok">&#10003; Replaced</span> · ${escapeHtml(formatFileDetails(status.file))}`;
  } else if (status.stage === 'failed') {
    stageEl.textContent = 'Import failed';
    dotEl.classList.add('danger');
    metaEl.innerHTML = `<span class="track-result-fail">${escapeHtml(status.reason)}</span>`;
    if (status.downloadId) {
      const fixBtn = document.createElement('button');
      fixBtn.className = 'pill-btn fix-it-btn';
      fixBtn.innerHTML = '<span class="btn-label">Fix it &#8594;</span>';
      fixBtn.addEventListener('click', () => openManualImportModal(isMovie ? 'radarr' : 'sonarr', status.downloadId, ctx.title));
      row.querySelector('.release-info').appendChild(fixBtn);
    }
  } else {
    stageEl.textContent = 'Grabbed';
    metaEl.textContent = 'Waiting for the downloader…';
  }
}

const GRAB_TRACK_TIMEOUT_MS = 5 * 60 * 1000;
const GRAB_TRACK_INTERVAL_MS = 4000;

function trackGrab(row, ctx, isMovie, releaseTitle) {
  renderTrackRow(row, releaseTitle);
  const startedAt = Date.now();
  // Passed through as `since` so the server can tell a freshly-imported
  // file apart from one that was already there before this grab (the
  // "resolve an issue" flow replaces an existing file, so hasFile alone
  // isn't confirmation — see isFileFromThisGrab in lib/grabStatus.js).
  // ctx.episode is absent for a season-pack grab from the season list's
  // own Search button — grab-status then reports an aggregate for the
  // whole season instead of one episode (see routes/sonarr.js).
  const statusUrl = isMovie
    ? `/api/radarr/grab-status?tmdbId=${ctx.tmdbId}&since=${startedAt}`
    : `/api/sonarr/grab-status?tvdbId=${ctx.tvdbId}&season=${ctx.season}&since=${startedAt}` + (ctx.episode != null ? `&episode=${ctx.episode}` : '');

  const poll = async () => {
    if (!document.body.contains(row)) return; // modal closed / list re-rendered since
    try {
      const status = await api(statusUrl);
      updateTrackRow(row, status, ctx, isMovie);
      if (status.stage === 'done' || status.stage === 'failed') return; // terminal
    } catch (e) {
      // Transient network hiccup — just try again next tick.
    }
    if (Date.now() - startedAt > GRAB_TRACK_TIMEOUT_MS) {
      row.querySelector('.track-meta').textContent = 'Taking a while — check Import Issues later.';
      return;
    }
    setTimeout(poll, GRAB_TRACK_INTERVAL_MS);
  };
  poll();
}

document.getElementById('close-release-modal-btn').addEventListener('click', () => {
  document.getElementById('release-modal').classList.add('hidden');
});

// ---------- Auto Fix (issue row -> best in-profile release, no picker) ----------
// Same search Radarr/Sonarr already runs for the manual release picker above,
// just auto-grabbing the top result instead of waiting for a click. "Keeps
// within the profile parameters" is Radarr/Sonarr's own job, not reimplemented
// here — every release comes back already flagged `rejected`/`rejections` by
// whatever's actually configured on that movie/series (quality cutoff, custom
// formats, minimum age, ...), and mapReleases (lib/releaseSearch.js) already
// sorts eligible releases first, by seeders. Picking the first non-rejected
// one is exactly "the best release that still clears the configured profile."
async function runAutoFix(row) {
  const ctx = row.dataset;
  const isMovie = ctx.mediaType === 'movie';
  row.dataset.autofixing = 'true';
  row.querySelectorAll('button').forEach(b => b.disabled = true);
  const label = row.querySelector('.autofix-btn .btn-label');
  label.textContent = 'Searching…';

  const searchUrl = isMovie
    ? `/api/radarr/releases?tmdbId=${ctx.tmdbId}`
    : `/api/sonarr/releases?tvdbId=${ctx.tvdbId}&season=${ctx.season}&episode=${ctx.episode}`;
  const grabUrl = isMovie ? '/api/radarr/releases/grab' : '/api/sonarr/releases/grab';

  try {
    const releases = await api(searchUrl);
    const best = releases.find(r => !r.rejected);
    if (!best) {
      label.textContent = 'No eligible release';
      setTimeout(() => {
        row.dataset.autofixing = 'false';
        row.querySelectorAll('button').forEach(b => b.disabled = false);
        label.textContent = 'Auto Fix';
      }, 4000);
      return;
    }
    label.textContent = 'Grabbing…';
    await api(grabUrl, { method: 'POST', body: JSON.stringify({ guid: best.guid, indexerId: best.indexerId }) });
    trackAutoFix(row, ctx, isMovie, best.title);
  } catch (err) {
    row.dataset.autofixing = 'false';
    row.querySelectorAll('button').forEach(b => b.disabled = false);
    label.textContent = 'Failed — retry';
  }
}

// Reuses the release-modal's own renderTrackRow/updateTrackRow so an
// auto-fixed row shows the identical downloading -> importing -> done/failed
// progression a manual grab does — just in place in the issues list instead
// of inside the release-search modal. On a real confirmed replacement, also
// resolves the underlying report — the whole point of Auto Fix is not
// needing a second manual "Resolve" click once a replacement file actually
// landed. A failed import leaves the row as-is (with its "Fix it →"
// manual-import escape hatch from updateTrackRow) rather than auto-resolving
// something that didn't actually get fixed.
function trackAutoFix(row, ctx, isMovie, releaseTitle) {
  renderTrackRow(row, releaseTitle);
  const startedAt = Date.now();
  const statusUrl = isMovie
    ? `/api/radarr/grab-status?tmdbId=${ctx.tmdbId}&since=${startedAt}`
    : `/api/sonarr/grab-status?tvdbId=${ctx.tvdbId}&season=${ctx.season}&episode=${ctx.episode}&since=${startedAt}`;

  const poll = async () => {
    if (!document.body.contains(row)) return; // list re-rendered / row gone since
    try {
      const status = await api(statusUrl);
      updateTrackRow(row, status, ctx, isMovie);
      if (status.stage === 'done') {
        try {
          await api(`/api/overseerr/issues/${ctx.id}/resolve`, { method: 'POST' });
        } catch (e) {
          // File genuinely replaced — leave the "Done" row showing rather than
          // erroring; the owner can still hit Resolve by hand if this repeats.
          return;
        }
        row.remove();
        const body = document.getElementById('admin-issues-body');
        if (!body.children.length) body.innerHTML = '<p class="empty-state">Nothing open.</p>';
        return;
      }
      if (status.stage === 'failed') return; // terminal — updateTrackRow already showed the Fix-it path
    } catch (e) {
      // Transient network hiccup — just try again next tick.
    }
    if (Date.now() - startedAt > GRAB_TRACK_TIMEOUT_MS) {
      row.querySelector('.track-meta').textContent = 'Taking a while — check Import Issues later.';
      return;
    }
    setTimeout(poll, GRAB_TRACK_INTERVAL_MS);
  };
  poll();
}

// ---------- Stack: Search Library ----------
// Owner-only free-text search across Radarr/Sonarr's own tracked library (not
// TMDB/Overseerr) — lets you jump straight to an indexer search for anything
// already being managed, not just what Wanted/Missing happens to flag (e.g.
// re-grabbing a bad rip, or something Radarr/Sonarr hasn't realized is
// missing yet). Movie results go straight to the existing release-search
// modal; TV results need a season/episode picked first, since Sonarr only
// searches per-episode.
let librarySearchResults = [];
let librarySearchTimer;

document.getElementById('library-search-input').addEventListener('input', e => {
  clearTimeout(librarySearchTimer);
  const q = e.target.value.trim();
  const body = document.getElementById('library-search-body');
  if (!q) { body.innerHTML = '<p class="empty-state">Type to search.</p>'; return; }
  librarySearchTimer = setTimeout(async () => {
    body.innerHTML = '<p class="empty-state">Searching…</p>';
    try {
      const [movies, series] = await Promise.all([
        api(`/api/radarr/search?q=${encodeURIComponent(q)}`),
        api(`/api/sonarr/search?q=${encodeURIComponent(q)}`)
      ]);
      librarySearchResults = [...movies, ...series];
      if (!librarySearchResults.length) { body.innerHTML = '<p class="empty-state">No matches in your library.</p>'; return; }
      body.innerHTML = librarySearchResults.map((r, idx) => `
        <div class="pending-row" data-idx="${idx}">
          <img class="result-poster" src="${r.poster || ''}" loading="lazy" onerror="this.style.visibility='hidden'">
          <div class="result-info">
            <div class="result-title">${escapeHtml(r.title)}${r.year ? ` (${r.year})` : ''}</div>
            <div class="pending-requester">${r.mediaType === 'tv' ? 'Series' : 'Movie'}</div>
          </div>
          <div class="pending-actions">
            <button class="search-release-btn pill-btn"><span class="state-dot"></span><span class="btn-label">Search</span></button>
          </div>
        </div>
      `).join('');
    } catch (e) {
      body.innerHTML = '<p class="empty-state">Search failed.</p>';
    }
  }, 400);
});

// Tapping anywhere on the row acts (not just the Search button) — movies show
// their current file info first, TV shows drill into season -> episode first
// (also landing on the same file-info step) since Sonarr only searches per-episode.
document.getElementById('library-search-body').addEventListener('click', e => {
  const row = e.target.closest('.pending-row');
  if (!row) return;
  const item = librarySearchResults[Number(row.dataset.idx)];
  if (!item) return;
  if (item.mediaType === 'movie') {
    openFileInfoModal({
      badge: 'MOVIE',
      title: item.title,
      subtitle: item.year ? String(item.year) : '',
      poster: item.poster,
      file: item.file,
      onSearch: () => openReleaseModal(item)
    });
  } else {
    openLibraryBrowseSeasons(item);
  }
});

// Remembers which series/season is currently being browsed, so the episode
// list and the "Back to seasons" button know what to reload.
let libraryBrowseContext = null; // { seriesId, tvdbId, title, poster, seasons }
let libraryBrowseEpisodes = [];

function openLibraryBrowseSeasons(series) {
  libraryBrowseContext = { seriesId: series.seriesId, tvdbId: series.tvdbId, title: series.title, poster: series.poster, seasons: series.seasons };
  document.getElementById('library-browse-title').textContent = series.title;
  document.getElementById('library-browse-back').classList.add('hidden');
  const listEl = document.getElementById('library-browse-list');
  listEl.innerHTML = series.seasons.length ? series.seasons.map(se => `
    <div class="browse-row" data-season="${se.seasonNumber}">
      <div class="browse-row-name">Season ${se.seasonNumber}</div>
      <div class="browse-row-index">${se.episodeCount} ep</div>
      <button class="search-release-btn pill-btn browse-row-search" data-search-season="${se.seasonNumber}">
        <span class="state-dot"></span><span class="btn-label">Search</span>
      </button>
    </div>
  `).join('') : '<p class="empty-state">No seasons found.</p>';
  document.getElementById('library-browse-modal').classList.remove('hidden');
}

async function openLibraryBrowseEpisodes(season) {
  libraryBrowseContext.season = season;
  document.getElementById('library-browse-title').textContent = `${libraryBrowseContext.title} — Season ${season}`;
  document.getElementById('library-browse-back').classList.remove('hidden');
  const listEl = document.getElementById('library-browse-list');
  listEl.innerHTML = '<p class="empty-state">Loading…</p>';
  try {
    // A series added seconds ago (Find & Download's "not tracked yet" path)
    // may not have its episodes populated yet — Sonarr queues its own
    // RefreshSeries on add and fills them in ~2s later — so a genuinely
    // empty result gets a couple of quick retries before giving up.
    for (let attempt = 0; attempt < 3; attempt++) {
      libraryBrowseEpisodes = await api(`/api/sonarr/episodes?seriesId=${libraryBrowseContext.seriesId}&season=${season}`);
      if (libraryBrowseEpisodes.length || attempt === 2) break;
      await new Promise(r => setTimeout(r, 1500));
    }
    listEl.innerHTML = libraryBrowseEpisodes.length ? libraryBrowseEpisodes.map(ep => `
      <div class="browse-row" data-episode="${ep.episodeNumber}">
        <div class="browse-row-name">${ep.episodeNumber}. ${escapeHtml(ep.title || 'TBA')}</div>
        ${ep.hasFile ? '<div class="browse-row-index">Have file</div>' : ''}
      </div>
    `).join('') : '<p class="empty-state">No episodes found.</p>';
  } catch (e) {
    listEl.innerHTML = '<p class="empty-state">Could not load episodes.</p>';
  }
}

document.getElementById('library-browse-list').addEventListener('click', e => {
  // Checked before the row-level [data-season] handler below, since the
  // Search button sits inside that same row and would otherwise also
  // trigger the season -> episode drill-down.
  const searchBtn = e.target.closest('[data-search-season]');
  if (searchBtn) {
    openReleaseModal({
      mediaType: 'tv',
      tvdbId: libraryBrowseContext.tvdbId,
      season: Number(searchBtn.dataset.searchSeason),
      title: libraryBrowseContext.title
    });
    return;
  }

  const seasonRow = e.target.closest('[data-season]');
  if (seasonRow) { openLibraryBrowseEpisodes(Number(seasonRow.dataset.season)); return; }

  const epRow = e.target.closest('[data-episode]');
  if (!epRow) return;
  const episodeNumber = Number(epRow.dataset.episode);
  const ep = libraryBrowseEpisodes.find(x => x.episodeNumber === episodeNumber);
  document.getElementById('library-browse-modal').classList.add('hidden');
  openFileInfoModal({
    badge: 'TV',
    title: libraryBrowseContext.title,
    subtitle: `S${libraryBrowseContext.season}E${episodeNumber}${ep?.title ? ' — ' + ep.title : ''}`,
    poster: libraryBrowseContext.poster,
    file: ep?.file || null,
    onSearch: () => openReleaseModal({
      mediaType: 'tv',
      tvdbId: libraryBrowseContext.tvdbId,
      season: libraryBrowseContext.season,
      episode: episodeNumber,
      title: libraryBrowseContext.title
    })
  });
});

// ---------- Stack: Find & Download ----------
// Owner-only "search anything, add it if it's not already tracked" flow —
// distinct from Search Library above (which only ever matches what's already
// in Radarr/Sonarr, by fast substring). Tracked hits jump straight into the
// same release-search modal / season picker Search Library uses; untracked
// hits go through add-media-modal first (quality profile / root folder),
// then land in that exact same flow.
let findMediaResults = [];
let findMediaTimer;
let addMediaContext = null; // { item }

document.getElementById('find-media-input').addEventListener('input', e => {
  clearTimeout(findMediaTimer);
  const q = e.target.value.trim();
  const body = document.getElementById('find-media-body');
  if (!q) { body.innerHTML = '<p class="empty-state">Type to search.</p>'; return; }
  findMediaTimer = setTimeout(async () => {
    body.innerHTML = '<p class="empty-state">Searching…</p>';
    try {
      const [movies, series] = await Promise.all([
        api(`/api/radarr/lookup?term=${encodeURIComponent(q)}`),
        api(`/api/sonarr/lookup?term=${encodeURIComponent(q)}`)
      ]);
      findMediaResults = [...movies, ...series];
      if (!findMediaResults.length) { body.innerHTML = '<p class="empty-state">No matches.</p>'; return; }
      body.innerHTML = findMediaResults.map((r, idx) => `
        <div class="pending-row" data-idx="${idx}">
          <img class="result-poster" src="${r.poster || ''}" loading="lazy" onerror="this.style.visibility='hidden'">
          <div class="result-info">
            <div class="result-title">${escapeHtml(r.title)}${r.year ? ` (${r.year})` : ''}</div>
            <div class="pending-requester">${r.mediaType === 'tv' ? 'Series' : 'Movie'}${r.tracked ? ' · In library' : ''}</div>
          </div>
          <div class="pending-actions">
            <button class="search-release-btn pill-btn"><span class="state-dot"></span><span class="btn-label">${r.tracked ? 'Search' : 'Add'}</span></button>
          </div>
        </div>
      `).join('');
    } catch (e) {
      body.innerHTML = '<p class="empty-state">Search failed.</p>';
    }
  }, 400);
});

document.getElementById('find-media-body').addEventListener('click', e => {
  const row = e.target.closest('.pending-row');
  if (!row) return;
  const item = findMediaResults[Number(row.dataset.idx)];
  if (!item) return;
  if (!item.tracked) { openAddMediaModal(item); return; }
  if (item.mediaType === 'movie') {
    openReleaseModal(item);
  } else {
    openLibraryBrowseSeasons({ seriesId: item.seriesId, tvdbId: item.tvdbId, title: item.title, poster: item.poster, seasons: item.seasons });
  }
});

async function openAddMediaModal(item) {
  addMediaContext = { item };
  document.getElementById('add-media-title').textContent = `Add "${item.title}" to library`;
  const qualitySelect = document.getElementById('add-media-quality-input');
  const folderBlock = document.getElementById('add-media-folder-block');
  const folderSelect = document.getElementById('add-media-folder-input');
  const confirmBtn = document.getElementById('add-media-confirm-btn');
  const statusEl = document.getElementById('add-media-status');
  const isMovie = item.mediaType === 'movie';

  qualitySelect.innerHTML = '<option>Loading…</option>';
  folderBlock.classList.toggle('hidden', isMovie);
  statusEl.classList.add('hidden');
  confirmBtn.disabled = false;
  confirmBtn.textContent = 'Add & Search Releases';
  document.getElementById('add-media-modal').classList.remove('hidden');

  try {
    const options = await api(isMovie ? '/api/radarr/options' : '/api/sonarr/options');
    qualitySelect.innerHTML = options.qualityProfiles.map(p =>
      `<option value="${p.id}" ${p.id === options.defaultQualityProfileId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
    ).join('');
    if (!isMovie) {
      folderSelect.innerHTML = options.rootFolders.map(f =>
        `<option value="${escapeHtml(f)}" ${f === options.defaultRootFolder ? 'selected' : ''}>${escapeHtml(f)}</option>`
      ).join('');
    }
  } catch (e) {
    qualitySelect.innerHTML = '';
    statusEl.textContent = 'Could not load quality profiles/root folders.';
    statusEl.classList.remove('hidden');
    confirmBtn.disabled = true;
  }
}

function closeAddMediaModal() {
  document.getElementById('add-media-modal').classList.add('hidden');
  addMediaContext = null;
}
document.getElementById('close-add-media-modal-btn').addEventListener('click', closeAddMediaModal);
document.getElementById('add-media-cancel-btn').addEventListener('click', closeAddMediaModal);

document.getElementById('add-media-confirm-btn').addEventListener('click', async () => {
  if (!addMediaContext) return;
  const { item } = addMediaContext;
  const isMovie = item.mediaType === 'movie';
  const qualityProfileId = Number(document.getElementById('add-media-quality-input').value);
  const rootFolderPath = document.getElementById('add-media-folder-input').value;
  const confirmBtn = document.getElementById('add-media-confirm-btn');
  const statusEl = document.getElementById('add-media-status');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Adding…';
  statusEl.classList.add('hidden');
  try {
    if (isMovie) {
      const created = await api('/api/radarr/add', {
        method: 'POST',
        body: JSON.stringify({ tmdbId: item.tmdbId, qualityProfileId })
      });
      closeAddMediaModal();
      openReleaseModal({ mediaType: 'movie', tmdbId: created.tmdbId, title: created.title });
    } else {
      const created = await api('/api/sonarr/add', {
        method: 'POST',
        body: JSON.stringify({ tmdbId: item.tmdbId, qualityProfileId, rootFolderPath })
      });
      closeAddMediaModal();
      openLibraryBrowseSeasons({
        seriesId: created.seriesId,
        tvdbId: created.tvdbId,
        title: created.title,
        poster: created.poster,
        seasons: created.seasons
      });
    }
  } catch (e) {
    statusEl.textContent = e.message || 'Could not add to library.';
    statusEl.classList.remove('hidden');
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Add & Search Releases';
  }
});

// ---------- Current file info (shown before jumping to release search) ----------
function formatFileDetails(file) {
  return file
    ? [file.quality, file.resolution, file.videoCodec, file.audioCodec, formatBytes(file.size), file.releaseGroup]
        .filter(Boolean).join(' · ') + (file.dateAdded ? ` · added ${formatDate(file.dateAdded)}` : '')
    : 'No file on disk yet.';
}

// `file` is undefined when the caller doesn't have the answer yet (Open
// Issues fetches it after opening) — distinct from null, which means the
// server already confirmed there's no file.
function openFileInfoModal({ badge, title, subtitle, poster, file, onSearch }) {
  document.getElementById('file-info-badge').textContent = badge;
  document.getElementById('file-info-title').textContent = title || '';
  document.getElementById('file-info-subtitle').textContent = subtitle || '';
  const posterEl = document.getElementById('file-info-poster');
  posterEl.style.visibility = '';
  posterEl.src = poster || '';
  document.getElementById('file-info-details').textContent = file === undefined ? 'Loading…' : formatFileDetails(file);
  document.getElementById('file-info-search-btn').onclick = () => {
    document.getElementById('file-info-modal').classList.add('hidden');
    onSearch();
  };
  document.getElementById('file-info-modal').classList.remove('hidden');
}

document.getElementById('close-file-info-btn').addEventListener('click', () => {
  document.getElementById('file-info-modal').classList.add('hidden');
});

document.getElementById('library-browse-back').addEventListener('click', () => {
  openLibraryBrowseSeasons(libraryBrowseContext);
});

document.getElementById('close-library-browse-btn').addEventListener('click', () => {
  document.getElementById('library-browse-modal').classList.add('hidden');
});

// ---------- Stack: Disk Space ----------
// One row per actual physical volume (deduped server-side, see lib/diskspace.js)
// — a per-volume donut gauge (.disk-donut) instead of a linear bar, same
// amber/danger color semantics as the state-dot next to it.
function diskDonut(usedPercent, danger) {
  return `
    <svg class="disk-donut" viewBox="0 0 36 36">
      <circle class="disk-donut-track" cx="18" cy="18" r="15.5" pathLength="100"></circle>
      <circle class="disk-donut-fill${danger ? ' danger' : ''}" cx="18" cy="18" r="15.5" pathLength="100" stroke-dasharray="${usedPercent} 100"></circle>
    </svg>
  `;
}

// Hand-rolled polyline, same reasoning as diskDonut above — no charting
// dependency for one small shape. Free bytes over time, oldest to newest;
// height-normalized to its own min/max rather than a shared scale, since
// each volume's own trend shape (not its absolute size relative to others)
// is what's worth seeing at a glance here.
function diskSparkline(history) {
  if (!history || history.length < 2) return '';
  const width = 64;
  const height = 18;
  const values = history.map(h => h.freeBytes);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = history.map((h, i) => {
    const x = (i / (history.length - 1)) * width;
    const y = height - ((h.freeBytes - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="disk-sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><polyline points="${points}"></polyline></svg>`;
}

// null projection (see lib/diskspace.js's projectDaysUntilFull) covers both
// "not enough history yet" and "flat/growing, nothing worth projecting" —
// both render as nothing rather than a misleading number.
function diskProjectionLabel(projection) {
  if (!projection || projection.daysUntilFull == null) return '';
  const d = projection.daysUntilFull;
  if (d === 0) return { text: 'full now', level: 'danger' };
  if (d > 365) return { text: '> 1 year left', level: '' };
  const level = d < 14 ? 'danger' : d < 30 ? 'warning' : '';
  return { text: `~${d} day${d === 1 ? '' : 's'} left`, level };
}

async function loadDiskSpace() {
  const body = document.getElementById('diskspace-body');
  let disks;
  try {
    disks = await api('/api/owner/diskspace');
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not load disk space.</p>';
    return;
  }
  if (!disks.length) { body.innerHTML = '<p class="empty-state">No disk info available.</p>'; return; }

  // Trend data is a bonus on top of the current-state rows above, not a
  // requirement — a failure here still leaves a fully working panel.
  let historyByLabel = {};
  try {
    historyByLabel = await api('/api/owner/diskspace/history');
  } catch (e) {
    // no trend data this poll; rows below just render without it
  }

  body.innerHTML = disks.map(d => {
    const danger = d.usedPercent >= 90;
    const trend = historyByLabel[d.path];
    const sparkline = trend ? diskSparkline(trend.history) : '';
    const projection = trend ? diskProjectionLabel(trend.projection) : '';
    return `
      <div class="dl-row">
        ${diskDonut(d.usedPercent, danger)}
        <div class="dl-row-body">
          <div class="now-title">${escapeHtml(d.path)}</div>
          <div class="now-meta">
            <span class="state-dot ${danger ? 'danger' : ''}"></span>
            ${formatBytes(d.freeBytes)} free of ${formatBytes(d.totalBytes)} · ${d.usedPercent}% used
          </div>
          ${sparkline || projection ? `
          <div class="now-meta disk-trend">
            ${sparkline}
            ${projection ? `<span class="disk-projection${projection.level ? ' ' + projection.level : ''}">${projection.text}</span>` : ''}
          </div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ---------- Stack: Seeding ----------
// Just the count + overall ratio, no per-torrent list — qBittorrent's own
// "Global ratio" (all-time uploaded/downloaded), not a session-only figure.
async function loadSeeding() {
  const body = document.getElementById('seeding-body');
  try {
    const stats = await api('/api/downloads/seeding');
    if (!stats) { body.innerHTML = '<p class="empty-state">qBittorrent not configured.</p>'; return; }
    body.innerHTML = `
      <div class="stat-pair">
        <div class="stat-tile">
          <div class="stat-value">${stats.seedingCount}</div>
          <div class="stat-label">Seeding</div>
        </div>
        <div class="stat-tile">
          <div class="stat-value">${stats.ratio == null ? '—' : stats.ratio.toFixed(2)}</div>
          <div class="stat-label">Ratio</div>
        </div>
        <div class="stat-tile">
          <div class="stat-value">${formatBytes(stats.uploadedBytes)}</div>
          <div class="stat-label">Uploaded</div>
        </div>
        <div class="stat-tile">
          <div class="stat-value">${formatBytes(stats.downloadedBytes)}</div>
          <div class="stat-label">Downloaded</div>
        </div>
      </div>
    `;
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not load seeding stats.</p>';
  }
}

// ---------- Stack: Cleanup Candidates ----------
// A slow-moving report (watch history/file sizes don't shift minute to
// minute), unlike Seeding/Disk Space above — loaded once on page load with
// no recurring poll, rather than re-scanning Tautulli's whole movie library
// (thousands of rows) every 60s indefinitely. See lib/cleanupCandidates.js
// for exactly what qualifies; this is read-only by design — no delete
// action wired up, just a ranked report of where space could be reclaimed.
//
// The full ranked list lives in a modal (openCleanupModal below), not
// inline — a library-wide report can run into the thousands of rows (this
// deployment's own: 3,810), which would make the admin page itself
// unreasonably long. The card only ever shows a one-line summary + a
// button.
let cleanupCandidatesCache = [];

async function loadCleanupCandidates() {
  const body = document.getElementById('cleanup-body');
  const viewBtn = document.getElementById('view-cleanup-btn');
  try {
    cleanupCandidatesCache = await api('/api/owner/cleanup-candidates');
    if (!cleanupCandidatesCache.length) {
      body.innerHTML = '<p class="empty-state">Nothing flagged — Movies library configured?</p>';
      viewBtn.classList.add('hidden');
      return;
    }
    const totalBytes = cleanupCandidatesCache.reduce((sum, c) => sum + c.sizeBytes, 0);
    body.innerHTML = `<p class="now-meta">${cleanupCandidatesCache.length} movie${cleanupCandidatesCache.length === 1 ? '' : 's'} · ${formatBytes(totalBytes)} reclaimable</p>`;
    viewBtn.classList.remove('hidden');
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not check cleanup candidates.</p>';
    viewBtn.classList.add('hidden');
  }
}

function openCleanupModal() {
  const modal = document.getElementById('cleanup-modal');
  const listEl = document.getElementById('cleanup-list');
  listEl.innerHTML = cleanupCandidatesCache.map(c => `
    <div class="dl-row">
      <div class="dl-row-body">
        <div class="now-title">${escapeHtml(c.title)}${c.year ? ` (${c.year})` : ''}</div>
        <div class="now-meta">${formatBytes(c.sizeBytes)} · ${escapeHtml(c.reason)}</div>
      </div>
    </div>
  `).join('');
  modal.classList.remove('hidden');
}

document.getElementById('view-cleanup-btn').addEventListener('click', openCleanupModal);
document.getElementById('close-cleanup-modal-btn').addEventListener('click', () => {
  document.getElementById('cleanup-modal').classList.add('hidden');
});

// ---------- Stack: Download Issues ----------
// Not actively downloading and not seeding/complete — i.e. actually stuck or
// failed. Most torrents that are simply idling-while-seeding never show up
// here at all (filtered server-side), so this is meant to stay short.
function createDownloadIssueRow() {
  const row = document.createElement('div');
  row.className = 'dl-row';
  row.innerHTML = `
    <div class="dl-row-body">
      <div class="now-title"></div>
      <div class="now-meta"><span class="state-dot paused"></span><span class="dl-meta-text"></span></div>
    </div>
    <div class="pending-actions">
      <button class="dl-action-btn pill-btn" data-action="pause"><span class="state-dot"></span><span class="btn-label">Pause</span></button>
      <button class="dl-action-btn pill-btn hidden" data-action="force" title="Bypasses qBittorrent's own queue limits and retries even after errors — different from Resume, which still respects them"><span class="state-dot"></span><span class="btn-label">Force</span></button>
      <button class="dl-remove-btn pill-btn"><span class="state-dot danger"></span><span class="btn-label">Remove</span></button>
    </div>
  `;
  return row;
}

function updateDownloadIssueRow(row, d) {
  row.dataset.id = d.id;
  row.dataset.type = d.type;
  row.querySelectorAll('button').forEach(b => b.disabled = false);
  row.querySelector('.now-title').textContent = d.name;
  row.querySelector('.dl-meta-text').textContent = `${d.type === 'torrent' ? 'Torrent' : 'Usenet'} · ${titleCase(d.state)}`;

  const pauseResumeBtn = row.querySelector('[data-action="pause"], [data-action="resume"]');
  pauseResumeBtn.dataset.action = d.state === 'paused' ? 'resume' : 'pause';
  pauseResumeBtn.querySelector('.btn-label').textContent = d.state === 'paused' ? 'Resume' : 'Pause';

  row.querySelector('[data-action="force"]').classList.toggle('hidden', d.type !== 'torrent');
  row.querySelector('.dl-remove-btn .btn-label').textContent = 'Remove';
}

async function loadDownloadIssues() {
  const body = document.getElementById('download-issues-body');
  try {
    const items = await api('/api/downloads/queue/attention');
    if (!items.length) { body.innerHTML = '<p class="empty-state">Nothing stuck.</p>'; return; }
    reconcileList(body, items, d => `${d.type}-${d.id}`, createDownloadIssueRow, updateDownloadIssueRow);
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not load download issues.</p>';
  }
}

document.getElementById('download-issues-body').addEventListener('click', async e => {
  const row = e.target.closest('.dl-row');
  if (!row) return;

  const removeBtn = e.target.closest('.dl-remove-btn');
  if (removeBtn) {
    if (!await confirmDialog('Remove this download and delete any downloaded files?')) return;
    row.querySelectorAll('button').forEach(b => b.disabled = true);
    removeBtn.querySelector('.btn-label').textContent = '…';
    try {
      await api(`/api/downloads/queue/${row.dataset.type}/${row.dataset.id}`, { method: 'DELETE' });
      row.remove();
      if (!document.getElementById('download-issues-body').children.length) {
        document.getElementById('download-issues-body').innerHTML = '<p class="empty-state">Nothing stuck.</p>';
      }
    } catch (err) {
      row.querySelectorAll('button').forEach(b => b.disabled = false);
      removeBtn.querySelector('.btn-label').textContent = 'Remove';
    }
    return;
  }

  const actionBtn = e.target.closest('.dl-action-btn');
  if (!actionBtn) return;
  const action = actionBtn.dataset.action;
  const ACTION_LABELS = { pause: 'Pause', resume: 'Resume', force: 'Force' };
  row.querySelectorAll('button').forEach(b => b.disabled = true);
  actionBtn.querySelector('.btn-label').textContent = '…';
  try {
    await api(`/api/downloads/queue/${row.dataset.type}/${row.dataset.id}/${action}`, { method: 'POST' });
    loadDownloadIssues(); // refetch so the row reflects the real new state
  } catch (err) {
    row.querySelectorAll('button').forEach(b => b.disabled = false);
    actionBtn.querySelector('.btn-label').textContent = ACTION_LABELS[action] || action;
  }
});

// ---------- Family: Wanted / Missing ----------
// Monitored movies/episodes that have actually been released but Radarr/
// Sonarr never got a file for — reuses the same release-search modal as
// issues above, since the shape (mediaType/tmdbId or tvdbId+season+episode)
// is identical. Sorted most-overdue-first server-side, with `stuck` flagging
// releases out long enough to be worth calling out rather than a separate
// list — moved to the top of the page (was Stack) since that's the point of
// flagging it at all: something that prompts the owner to notice, not a
// second place they'd have to remember to check.
let wantedResults = [];

// A movie's tmdbId or an episode's tvdbId+season+episode — stable across
// polls, unlike array position (which reconciling by index would silently
// break the moment the sort order shifts, e.g. a newly-stuck item jumping
// to the top).
function wantedKey(r) {
  return r.mediaType === 'movie' ? `m${r.tmdbId}` : `e${r.tvdbId}-${r.season}-${r.episode}`;
}

function createWantedRow() {
  const row = document.createElement('div');
  row.className = 'pending-row';
  row.innerHTML = `
    <img class="result-poster" loading="lazy" onerror="this.style.visibility='hidden'">
    <div class="result-info">
      <div class="result-title"></div>
      <div class="pending-requester"></div>
    </div>
    <div class="pending-actions">
      <button class="search-release-btn pill-btn"><span class="state-dot"></span><span class="btn-label">Search</span></button>
    </div>
  `;
  return row;
}

function updateWantedRow(row, r) {
  const posterImg = row.querySelector('.result-poster');
  if (posterImg.getAttribute('src') == null) posterImg.src = r.poster || ''; // set once — never touched again
  row.querySelector('.result-title').textContent = r.title + (r.season ? ` — S${r.season}E${r.episode}` : '');
  row.querySelector('.pending-requester').innerHTML =
    `${r.stuck ? '<span class="state-dot danger"></span>' : ''}Released ${formatDate(r.date)}${r.stuck ? ` · ${r.daysSinceRelease}d overdue` : ''}`;
}

// The reconciled row list itself lives in a modal (view-wanted-btn below),
// not inline — same reasoning as Cleanup Candidates: a library-wide missing
// list can run long, and the admin page stays short regardless of how many
// items are on it. reconcileList still runs against the modal's list
// container on every poll whether or not the modal is currently open, so
// it's always current the moment it's opened, with the same no-flicker
// diffing this list already relied on before the move.
async function loadWanted() {
  const summary = document.getElementById('wanted-body');
  const viewBtn = document.getElementById('view-wanted-btn');
  const listEl = document.getElementById('wanted-list');
  try {
    wantedResults = await api('/api/owner/wanted');
    if (!wantedResults.length) {
      summary.innerHTML = '<p class="empty-state">Nothing missing.</p>';
      viewBtn.classList.add('hidden');
      return;
    }
    const stuckCount = wantedResults.filter(r => r.stuck).length;
    summary.innerHTML = `<p class="now-meta">${wantedResults.length} missing${stuckCount ? ` · ${stuckCount} overdue` : ''}</p>`;
    viewBtn.classList.remove('hidden');
    reconcileList(listEl, wantedResults, wantedKey, createWantedRow, updateWantedRow);
  } catch (e) {
    summary.innerHTML = '<p class="empty-state">Could not load wanted/missing.</p>';
    viewBtn.classList.add('hidden');
  }
}

// Triggers Radarr's/Sonarr's own automatic search for every item currently on
// the list — not the interactive per-row Search button below, which opens the
// release-search modal for one item. This just queues the search server-side
// (same as clicking "Search All Missing" in Radarr/Sonarr's own UI) and
// doesn't wait for it to finish, so the list itself won't visibly change right
// away — the existing 60s auto-refresh above will pick up whatever Radarr/
// Sonarr manage to grab and import on their own.
document.getElementById('search-all-wanted-btn').addEventListener('click', async () => {
  const btn = document.getElementById('search-all-wanted-btn');
  const status = document.getElementById('search-all-wanted-status');
  btn.disabled = true;
  status.classList.remove('hidden');
  status.textContent = 'Starting search…';
  try {
    const { movies, episodes, radarrOk, sonarrOk } = await api('/api/owner/wanted/search-all', { method: 'POST' });
    const total = movies + episodes;
    if (!total) {
      status.textContent = 'Nothing missing to search for.';
    } else {
      const parts = [];
      if (movies) parts.push(`${movies} movie${movies === 1 ? '' : 's'}`);
      if (episodes) parts.push(`${episodes} episode${episodes === 1 ? '' : 's'}`);
      status.textContent = `Searching for ${parts.join(' and ')}…`;
      if (!radarrOk) status.textContent += ' Radarr search failed to start.';
      if (!sonarrOk) status.textContent += ' Sonarr search failed to start.';
    }
  } catch (e) {
    status.textContent = `Failed: ${e.message}`;
  } finally {
    btn.disabled = false;
  }
});

// Clicking the Search button on a row goes straight to the release search, as
// before; clicking anywhere else on the row shows poster/overview/release
// details first — same "details before committing" pattern as the main
// dashboard's request modal.
document.getElementById('wanted-list').addEventListener('click', e => {
  const row = e.target.closest('.pending-row');
  if (!row) return;
  const item = wantedResults.find(r => wantedKey(r) === row.dataset.reconKey);
  if (!item) return;
  if (e.target.closest('.search-release-btn')) {
    openReleaseModal(item);
    return;
  }
  openWantedInfo(item);
});

document.getElementById('view-wanted-btn').addEventListener('click', () => {
  document.getElementById('wanted-list-modal').classList.remove('hidden');
});
document.getElementById('close-wanted-list-modal-btn').addEventListener('click', () => {
  document.getElementById('wanted-list-modal').classList.add('hidden');
});

function openWantedInfo(item) {
  const posterEl = document.getElementById('wanted-info-poster');
  posterEl.style.visibility = '';
  posterEl.src = item.poster || '';
  document.getElementById('wanted-info-title').textContent = item.title || '';
  document.getElementById('wanted-info-badge').textContent = item.mediaType === 'tv' ? 'TV' : 'MOVIE';
  document.getElementById('wanted-info-meta').textContent = item.season
    ? `S${item.season}E${item.episode}${item.episodeTitle ? ' — ' + item.episodeTitle : ''} · Released ${formatDate(item.date)}`
    : `Released ${formatDate(item.date)}`;
  document.getElementById('wanted-info-overview').textContent = item.overview || 'No synopsis available.';
  document.getElementById('wanted-info-search-btn').onclick = () => {
    document.getElementById('wanted-info-modal').classList.add('hidden');
    openReleaseModal(item);
  };
  document.getElementById('wanted-info-modal').classList.remove('hidden');
}

document.getElementById('close-wanted-info-btn').addEventListener('click', () => {
  document.getElementById('wanted-info-modal').classList.add('hidden');
});

// ---------- Stack: Import Issues ----------
// Radarr/Sonarr's own queue, filtered (server-side) to items something's
// actually wrong with — a stuck import, a download client error, etc. —
// not the whole in-progress queue.
function createImportIssueRow(r) {
  const row = document.createElement('div');
  row.className = 'pending-row';
  row.innerHTML = `
    <img class="result-poster" src="${r.poster || ''}" loading="lazy" onerror="this.style.visibility='hidden'">
    <div class="result-info">
      <div class="result-title"></div>
      <div class="issue-message"></div>
    </div>
    <div class="pending-actions">
      <button class="force-import-btn pill-btn hidden"><span class="state-dot"></span><span class="btn-label">Force Import</span></button>
      <button class="remove-queue-btn pill-btn"><span class="state-dot danger"></span><span class="btn-label">Remove</span></button>
    </div>
  `;
  return row;
}

function updateImportIssueRow(row, r) {
  row.dataset.id = r.id;
  row.dataset.service = r.service;
  row.dataset.downloadId = r.downloadId || '';
  row.dataset.title = r.title || 'Unknown title';
  row.querySelector('.result-title').textContent = r.title || 'Unknown title';
  row.querySelector('.issue-message').textContent = r.reason;
  row.querySelector('.force-import-btn').classList.toggle('hidden', !r.downloadId);
}

async function loadImportIssues() {
  const body = document.getElementById('import-issues-body');
  try {
    const [radarrItems, sonarrItems] = await Promise.all([
      api('/api/radarr/queue').then(items => items.map(i => ({ ...i, service: 'radarr' }))).catch(() => []),
      api('/api/sonarr/queue').then(items => items.map(i => ({ ...i, service: 'sonarr' }))).catch(() => [])
    ]);
    const results = [...radarrItems, ...sonarrItems];
    if (!results.length) { body.innerHTML = '<p class="empty-state">No import issues.</p>'; return; }
    // service+id, not id alone — Radarr's and Sonarr's queue ids are separate
    // spaces and could otherwise collide once combined into one list.
    reconcileList(body, results, r => `${r.service}-${r.id}`, createImportIssueRow, updateImportIssueRow);
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not load import issues.</p>';
  }
}

document.getElementById('import-issues-body').addEventListener('click', async e => {
  const importBtn = e.target.closest('.force-import-btn');
  if (importBtn) {
    const row = importBtn.closest('.pending-row');
    openManualImportModal(row.dataset.service, row.dataset.downloadId, row.dataset.title);
    return;
  }

  const btn = e.target.closest('.remove-queue-btn');
  if (!btn) return;
  if (!await confirmDialog('Remove this from the queue and blocklist the release?')) return;
  const row = btn.closest('.pending-row');
  row.querySelectorAll('button').forEach(b => b.disabled = true);
  btn.querySelector('.btn-label').textContent = '…';
  try {
    await api(`/api/${row.dataset.service}/queue/${row.dataset.id}`, { method: 'DELETE' });
    row.remove();
    if (!document.getElementById('import-issues-body').children.length) {
      document.getElementById('import-issues-body').innerHTML = '<p class="empty-state">No import issues.</p>';
    }
  } catch (err) {
    row.querySelectorAll('button').forEach(b => b.disabled = false);
    btn.querySelector('.btn-label').textContent = 'Remove';
  }
});

// ---------- Manual import ----------
// Shows what Radarr/Sonarr actually found in the download's folder — its best
// guess at which movie/episode it belongs to, and why it refused to import
// automatically (rejections) — so forcing it through is an informed choice,
// not a blind override. "Force Import" resubmits exactly the match Radarr/
// Sonarr already suggested; this isn't a "pick a different movie" tool.
let manualImportCandidates = [];
async function openManualImportModal(service, downloadId, title) {
  const modal = document.getElementById('manual-import-modal');
  const listEl = document.getElementById('manual-import-list');
  document.getElementById('manual-import-title').textContent = title;
  listEl.innerHTML = '<p class="empty-state">Loading… (if a TV episode title is still TBA, this refreshes the series first — can take up to 20s)</p>';
  modal.classList.remove('hidden');

  try {
    manualImportCandidates = await api(`/api/${service}/manual-import?downloadId=${encodeURIComponent(downloadId)}`);
    if (!manualImportCandidates.length) { listEl.innerHTML = '<p class="empty-state">No files found.</p>'; return; }
    listEl.innerHTML = manualImportCandidates.map((c, idx) => {
      const matched = service === 'radarr' ? c.movieTitle : (c.seriesTitle ? `${c.seriesTitle} — ${c.episodeLabel}` : null);
      return `
        <div class="release-row ${c.rejections.length ? 'rejected' : ''}">
          <div class="release-info">
            <div class="release-title" title="${escapeHtml(c.name || c.path)}">${escapeHtml(c.name || c.path)}</div>
            <div class="release-meta">
              ${matched ? `Matched: ${escapeHtml(matched)}` : 'No match found'}
              ${c.quality?.quality?.name ? ' · ' + escapeHtml(c.quality.quality.name) : ''}
            </div>
            ${c.rejections.length ? `<div class="release-rejections">${escapeHtml(c.rejections.join(', '))}</div>` : ''}
          </div>
          ${matched ? `
            <button class="force-import-confirm-btn pill-btn" data-idx="${idx}">
              <span class="state-dot"></span><span class="btn-label">Force Import</span>
            </button>
          ` : ''}
        </div>
      `;
    }).join('');
  } catch (e) {
    listEl.innerHTML = `<p class="empty-state">${escapeHtml(e.message || 'Could not look up import candidates.')}</p>`;
  }

  listEl.onclick = async e => {
    const btn = e.target.closest('.force-import-confirm-btn');
    if (!btn) return;
    const c = manualImportCandidates[Number(btn.dataset.idx)];
    if (!c) return;
    btn.disabled = true;
    btn.querySelector('.btn-label').textContent = 'Importing…';
    try {
      const payload = service === 'radarr'
        ? { path: c.path, folderName: c.folderName, movieId: c.movieId, quality: c.quality, languages: c.languages, releaseGroup: c.releaseGroup, indexerFlags: c.indexerFlags, downloadId: c.downloadId }
        : { path: c.path, folderName: c.folderName, seriesId: c.seriesId, episodeIds: c.episodeIds, quality: c.quality, languages: c.languages, releaseGroup: c.releaseGroup, indexerFlags: c.indexerFlags, downloadId: c.downloadId };
      await api(`/api/${service}/manual-import`, { method: 'POST', body: JSON.stringify(payload) });
      btn.querySelector('.btn-label').textContent = 'Importing ✓';
      loadImportIssues(); // the queue row should clear once the import lands
    } catch (err) {
      btn.disabled = false;
      btn.querySelector('.btn-label').textContent = 'Force Import';
    }
  };
}

document.getElementById('close-manual-import-btn').addEventListener('click', () => {
  document.getElementById('manual-import-modal').classList.add('hidden');
});

// ---------- Stack: Indexers ----------
// Read-only health check, reusing the same .monitor-pill component already
// used for Uptime Kuma monitors above — same "dot + name" shape fits fine
// for "is this indexer working" too.
async function loadIndexers() {
  const body = document.getElementById('indexers-body');
  try {
    const results = await api('/api/prowlarr/indexers');
    if (!results.length) { body.innerHTML = '<p class="empty-state">No indexers configured.</p>'; return; }
    body.innerHTML = `<div class="monitor-pills">${results.map(i => `
      <span class="monitor-pill ${i.healthy ? 'up' : 'down'}" title="${escapeHtml(i.reason || '')}">
        <span class="${dotClass(!i.healthy)}"></span>${escapeHtml(i.name)}
      </span>
    `).join('')}</div>`;
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not load indexers.</p>';
  }
}

// ---------- Settings ----------
// Two layers: an overview modal (service health grid + a Deployment button),
// and a shared edit popup that either a service card's Edit button or the
// Deployment button populates. Secrets are never sent to the browser (only
// whether one is currently set) — leaving a secret field blank means "don't
// change it," not "clear it." Node only loads env vars once at process
// start, so any save triggers a real container restart (the save endpoint
// exits the process; Docker's restart:unless-stopped policy brings it back
// up with the new values) — the edit popup then polls until the server
// responds again and reloads the page.

document.getElementById('open-settings-btn').addEventListener('click', openSettings);

// Services / System Status / Recent Sign-ins — same tabbed-modal pattern as
// the family dashboard's request modal. The latter two were previously
// always-visible panels on the admin page itself; moved here and made lazy
// (loaded on first view, not eagerly on page load or on an interval) since
// Settings is a "check occasionally" surface, not a live dashboard.
const settingsTabs = [
  { btn: document.getElementById('tab-settings-services-btn'), pane: document.getElementById('settings-services-tab') },
  { btn: document.getElementById('tab-settings-status-btn'), pane: document.getElementById('settings-status-tab') },
  { btn: document.getElementById('tab-settings-signins-btn'), pane: document.getElementById('settings-signins-tab') },
  { btn: document.getElementById('tab-settings-notice-btn'), pane: document.getElementById('settings-notice-tab') },
  { btn: document.getElementById('tab-settings-newsletter-btn'), pane: document.getElementById('settings-newsletter-tab') },
  { btn: document.getElementById('tab-settings-invite-btn'), pane: document.getElementById('settings-invite-tab') },
  { btn: document.getElementById('tab-settings-audit-btn'), pane: document.getElementById('settings-audit-tab') },
  { btn: document.getElementById('tab-settings-privacy-btn'), pane: document.getElementById('settings-privacy-tab') }
];
function activateSettingsTab(btn) {
  for (const t of settingsTabs) {
    const isActive = t.btn === btn;
    t.btn.classList.toggle('active', isActive);
    t.pane.classList.toggle('hidden', !isActive);
  }
}
let ownerStatusLoaded = false;
let adminLoginsLoaded = false;
let noticeSettingsLoaded = false;
let newsletterCandidatesLoaded = false;
let inviteTabLoaded = false;
let auditLogLoaded = false;
let privacySettingsLoaded = false;

settingsTabs[0].btn.addEventListener('click', () => activateSettingsTab(settingsTabs[0].btn));
settingsTabs[1].btn.addEventListener('click', () => {
  activateSettingsTab(settingsTabs[1].btn);
  if (!ownerStatusLoaded) { ownerStatusLoaded = true; loadOwnerStatus(); loadDbBackups(); loadMediaCacheStats(); }
});
settingsTabs[2].btn.addEventListener('click', () => {
  activateSettingsTab(settingsTabs[2].btn);
  if (!adminLoginsLoaded) { adminLoginsLoaded = true; loadAdminLogins(); }
});
settingsTabs[3].btn.addEventListener('click', () => {
  activateSettingsTab(settingsTabs[3].btn);
  if (!noticeSettingsLoaded) { noticeSettingsLoaded = true; loadNoticeSettings(); }
});
settingsTabs[4].btn.addEventListener('click', () => {
  activateSettingsTab(settingsTabs[4].btn);
  if (!newsletterCandidatesLoaded) { newsletterCandidatesLoaded = true; loadNewsletterCandidates(); }
});
settingsTabs[5].btn.addEventListener('click', () => {
  activateSettingsTab(settingsTabs[5].btn);
  if (!inviteTabLoaded) { inviteTabLoaded = true; loadInviteLibraries(); loadInviteShares(); }
});
settingsTabs[6].btn.addEventListener('click', () => {
  activateSettingsTab(settingsTabs[6].btn);
  if (!auditLogLoaded) { auditLogLoaded = true; loadAuditLog(); }
});
settingsTabs[7].btn.addEventListener('click', () => {
  activateSettingsTab(settingsTabs[7].btn);
  if (!privacySettingsLoaded) { privacySettingsLoaded = true; loadPrivacySettings(); }
});

async function openSettings() {
  document.getElementById('settings-modal').classList.remove('hidden');
  activateSettingsTab(settingsTabs[0].btn);
  loadServiceHealth();
}

document.getElementById('close-settings-btn').addEventListener('click', () => {
  document.getElementById('settings-modal').classList.add('hidden');
});

document.getElementById('run-health-check-btn').addEventListener('click', loadServiceHealth);

// serviceUpdates lags behind the health grid on purpose (see routes/settings.js's
// /updates comment) — it's fetched once per Settings-modal session, not on every
// "Run Health Check" click, since it hits slower/rate-limited external checks
// (GitHub releases) rather than fast local-network pings. lastServices is cached
// so a late-arriving update-check result can re-render the same grid without a
// second health check.
let lastServices = null;
let serviceUpdates = {};
let updatesLoaded = false;

async function loadServiceHealth() {
  const grid = document.getElementById('service-grid');
  grid.innerHTML = '<p class="empty-state">Checking services…</p>';
  try {
    lastServices = await api('/api/settings/services');
    renderServiceGrid();
  } catch (e) {
    grid.innerHTML = `<p class="empty-state">${escapeHtml(e.message || 'Could not check services.')}</p>`;
  }
  if (!updatesLoaded) { updatesLoaded = true; loadServiceUpdates(); }
}

async function loadServiceUpdates() {
  try {
    const updates = await api('/api/settings/updates');
    serviceUpdates = Object.fromEntries(updates.map(u => [u.key, u.update]));
    if (lastServices) renderServiceGrid();
  } catch (e) {
    // Silent — an overlay on the health grid, not something that should
    // block or blank it out if the update check itself fails.
  }
}

function updateBadgeTitle(update) {
  if (update.latestVersion) return `${update.currentVersion} → ${update.latestVersion}`;
  if (update.commitsBehind != null) return `${update.commitsBehind} commit${update.commitsBehind === 1 ? '' : 's'} behind`;
  return 'Update available';
}

function renderServiceGrid() {
  const grid = document.getElementById('service-grid');
  grid.innerHTML = lastServices.map(s => {
    const h = s.health || { status: 'unconfigured' };
    const statusText = h.status === 'online'
      ? escapeHtml(String(h.detail))
      : h.status === 'error' ? escapeHtml(h.message || 'Unreachable') : 'Not configured';
    const badgeLabel = h.status === 'online' ? 'Online' : h.status === 'error' ? 'Error' : 'Unconfigured';
    const update = serviceUpdates[s.key];
    const updateBadge = update?.updateAvailable
      ? `<span class="service-update-badge" title="${escapeHtml(updateBadgeTitle(update))}">Update available</span>`
      : '';
    return `
      <div class="service-card">
        <div class="service-card-head">
          <span class="service-card-name">${escapeHtml(s.label)}</span>
          <span class="service-badge ${h.status}">${badgeLabel}</span>
        </div>
        <div class="service-card-meta">${h.status === 'online' ? `&#9889; ${h.latencyMs}ms` : ''}</div>
        ${updateBadge}
        <div class="service-card-foot">
          <span class="service-card-status-text" title="${statusText}">${statusText}</span>
          <button class="pill-btn" data-service="${s.key}" data-label="${escapeHtml(s.label)}">Edit &#9998;</button>
        </div>
      </div>
    `;
  }).join('');
}

document.getElementById('service-grid').addEventListener('click', e => {
  const btn = e.target.closest('[data-service]');
  if (!btn) return;
  openSettingsEdit(`/api/settings/services/${btn.dataset.service}`, `${btn.dataset.label} Configuration`);
});

document.getElementById('edit-deployment-btn').addEventListener('click', () => {
  openSettingsEdit('/api/settings/deployment', 'Deployment Configuration');
});

// ---- Shared edit popup ----
let settingsEditFields = [];

async function openSettingsEdit(url, title) {
  const modal = document.getElementById('settings-edit-modal');
  const body = document.getElementById('settings-edit-body');
  const saveBtn = document.getElementById('settings-edit-save-btn');
  const status = document.getElementById('settings-edit-status');
  document.getElementById('settings-edit-title').textContent = title;
  status.className = 'settings-status hidden';
  status.textContent = '';
  saveBtn.disabled = true;
  saveBtn.textContent = 'Save Changes';
  body.innerHTML = '<p class="empty-state">Loading…</p>';
  modal.classList.remove('hidden');

  try {
    const data = await api(url);
    settingsEditFields = data.fields || data; // /deployment returns a bare array, /services/:key returns {fields}
    renderSettingsEdit();
  } catch (e) {
    body.innerHTML = `<p class="empty-state">${escapeHtml(e.message || 'Could not load settings.')}</p>`;
  }
}

function renderSettingsEdit() {
  const body = document.getElementById('settings-edit-body');
  body.innerHTML = settingsEditFields.map(f => {
    let inputHtml;
    if (f.readOnly) {
      inputHtml = `<input class="settings-input-full" type="text" value="${escapeHtml(f.value || '')}" disabled title="Read-only — changing this could make the app unreachable">`;
    } else if (f.isBoolean) {
      inputHtml = `
        <label class="settings-toggle">
          <input type="checkbox" data-key="${f.key}" data-type="boolean" ${f.value === 'true' ? 'checked' : ''}>
          <span class="settings-toggle-slider"></span>
        </label>
      `;
    } else if (f.isSecret) {
      const placeholder = f.hasValue ? '•••• set — leave blank to keep' : 'Not set';
      inputHtml = `<input class="settings-input-full" type="password" data-key="${f.key}" data-type="secret" placeholder="${placeholder}" autocomplete="off">`;
    } else {
      inputHtml = `<input class="settings-input-full" type="text" data-key="${f.key}" data-type="text" value="${escapeHtml(f.value || '')}">`;
    }
    return `
      <div class="settings-field-block">
        <label class="settings-field-block-label">${escapeHtml(f.label || f.key)}</label>
        ${inputHtml}
        ${f.description ? `<p class="settings-field-block-desc">${escapeHtml(f.description)}</p>` : ''}
      </div>
    `;
  }).join('');
  body.querySelectorAll('[data-key]').forEach(el => {
    el.addEventListener('input', updateSettingsEditSaveState);
    el.addEventListener('change', updateSettingsEditSaveState);
  });
}

function collectSettingsEditChanges() {
  const changes = {};
  document.querySelectorAll('#settings-edit-body [data-key]').forEach(el => {
    const key = el.dataset.key;
    const field = settingsEditFields.find(f => f.key === key);
    if (el.dataset.type === 'boolean') {
      const newValue = el.checked ? 'true' : 'false';
      if (newValue !== field.value) changes[key] = newValue;
    } else if (el.dataset.type === 'secret') {
      if (el.value !== '') changes[key] = el.value;
    } else if (el.value !== (field.value || '')) {
      changes[key] = el.value;
    }
  });
  return changes;
}

function updateSettingsEditSaveState() {
  document.getElementById('settings-edit-save-btn').disabled = !Object.keys(collectSettingsEditChanges()).length;
}

document.getElementById('close-settings-edit-btn').addEventListener('click', closeSettingsEdit);
document.getElementById('settings-edit-cancel-btn').addEventListener('click', closeSettingsEdit);
function closeSettingsEdit() {
  document.getElementById('settings-edit-modal').classList.add('hidden');
}

document.getElementById('settings-edit-save-btn').addEventListener('click', async () => {
  const changes = collectSettingsEditChanges();
  if (!Object.keys(changes).length) return;

  const changingSessionSecret = Object.prototype.hasOwnProperty.call(changes, 'SESSION_SECRET');
  const warning = changingSessionSecret
    ? 'This includes SESSION_SECRET — saving will sign out every family member, including you. The app will restart and this page will reload automatically. Continue?'
    : 'Save these changes? The app will restart (a few seconds of downtime) and this page will reload automatically.';
  if (!await confirmDialog(warning)) return;

  const saveBtn = document.getElementById('settings-edit-save-btn');
  const status = document.getElementById('settings-edit-status');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  status.className = 'settings-status';
  status.textContent = '';

  try {
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ changes }) });
    status.className = 'settings-status ok';
    status.textContent = 'Saved — restarting…';
    saveBtn.textContent = 'Restarting…';
    waitForSettingsRestart();
  } catch (e) {
    status.className = 'settings-status error';
    status.textContent = e.message || 'Could not save settings.';
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Changes';
  }
});

// Polls until the server answers again (any HTTP status — even 401 after a
// SESSION_SECRET change means it's back up) rather than a fixed delay, which
// would either reload too early or make the owner wait longer than needed.
async function waitForSettingsRestart() {
  await new Promise(r => setTimeout(r, 2000)); // give the process a moment to actually exit first
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.status) { location.reload(); return; }
    } catch (e) { /* still down — keep polling */ }
    await new Promise(r => setTimeout(r, 1500));
  }
  document.getElementById('settings-edit-status').textContent = 'Taking longer than expected — try reloading the page manually.';
}

// ---------- Settings: Notice Board ----------
// A single scheduled announcement shown on the family dashboard (e.g.
// "down Monday night for maintenance") — not a list of notices, one row,
// overwritten each time it's posted. No restart needed here (unlike the
// rest of Settings): this reads/writes its own small db, not .env.
function toDatetimeLocal(epochMs) {
  if (!epochMs) return '';
  const d = new Date(epochMs);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function formatNoticeDateTime(epochMs) {
  return new Date(epochMs).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Quick-start templates — fill the textarea, still fully editable before
// posting, not sent as-is. Second row is just for fun, not a real outage
// category — kept visually separate from the three above.
const NOTICE_PRESETS = {
  hardware: "We're experiencing a hardware issue with the server. Some features may be temporarily unavailable while we look into it.",
  network: "We're experiencing network connectivity issues. Streaming and requests may be slow or unavailable until this is resolved.",
  software: "We're troubleshooting a software issue affecting the server. Some features may not work correctly until this is resolved.",
  touchGrass: "Go touch grass. The couch isn't going anywhere.",
  watchedEverything: "Pretty sure you've watched everything at this point. Maybe try a walk?",
  skynetWisdom: "Skynet has determined you need sunlight. This is not a request."
};
document.querySelectorAll('[data-preset]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('notice-message-input').value = NOTICE_PRESETS[btn.dataset.preset];
  });
});

async function loadNoticeSettings() {
  const statusEl = document.getElementById('notice-status-text');
  const clearBtn = document.getElementById('notice-clear-btn');
  const messageInput = document.getElementById('notice-message-input');
  const startsInput = document.getElementById('notice-starts-input');
  const endsInput = document.getElementById('notice-ends-input');
  try {
    const current = await api('/api/notice/admin');
    if (!current) {
      statusEl.textContent = 'Nothing posted right now.';
      messageInput.value = '';
      startsInput.value = '';
      endsInput.value = '';
      clearBtn.classList.add('hidden');
      return;
    }
    const statusText = {
      active: 'Currently showing on the dashboard.',
      scheduled: `Scheduled to start ${formatNoticeDateTime(current.startsAt)}.`,
      expired: `Expired ${formatNoticeDateTime(current.endsAt)} — no longer showing.`
    };
    statusEl.textContent = statusText[current.status] || '';
    messageInput.value = current.message || '';
    startsInput.value = toDatetimeLocal(current.startsAt);
    endsInput.value = toDatetimeLocal(current.endsAt);
    clearBtn.classList.remove('hidden');
  } catch (e) {
    statusEl.textContent = 'Could not load notice.';
  }
}

document.getElementById('newsletter-test-email-btn').addEventListener('click', async () => {
  const btn = document.getElementById('newsletter-test-email-btn');
  const status = document.getElementById('newsletter-test-email-status');
  const to = document.getElementById('newsletter-test-email-to').value.trim();
  btn.disabled = true;
  status.classList.remove('hidden');
  status.textContent = 'Sending…';
  try {
    const result = await api('/api/recap/test-email', { method: 'POST', body: JSON.stringify(to ? { to } : {}) });
    status.textContent = `Sent to ${result.to}. Check that inbox to confirm it actually arrived.`;
  } catch (e) {
    status.textContent = `Failed: ${e.message}`;
  } finally {
    btn.disabled = false;
  }
});

// Newsletter (monthly recap) — deliberately no "send to everyone" anywhere
// here. /api/recap/candidates already only lists people with real activity
// that month (see MIN_MONTHLY_PLAYS in lib/monthlyRecap.js); this just lets
// the owner pick which of those actually get sent to, matching /send's own
// requirement of an explicit userIds list.
async function loadNewsletterCandidates() {
  const label = document.getElementById('newsletter-period-label');
  const body = document.getElementById('newsletter-candidates-body');
  try {
    const { period, candidates } = await api('/api/recap/candidates');
    label.textContent = `Monthly Recap — ${period.label}`;
    if (!candidates.length) {
      body.innerHTML = '<p class="empty-state">No one hit the activity threshold this month.</p>';
      return;
    }
    body.innerHTML = candidates.map(c => {
      const alreadySent = c.sendStatus === 'sent';
      const disabled = c.unsubscribed || !c.email || alreadySent;
      const note = c.unsubscribed ? 'unsubscribed' : !c.email ? 'no email on file'
        : alreadySent ? `sent ${timeAgo(c.sentAt)}` : c.sendStatus === 'sending' ? 'send in progress' : '';
      return `
        <label class="newsletter-candidate-row${disabled ? ' newsletter-candidate-row-disabled' : ''}" data-sent="${alreadySent ? 'true' : 'false'}" data-base-disabled="${c.unsubscribed || !c.email ? 'true' : 'false'}">
          <input type="checkbox" class="newsletter-candidate-checkbox" value="${escapeHtml(c.userId)}" ${disabled ? 'disabled' : ''}>
          <span class="now-title">${escapeHtml(c.name)}</span>
          <span class="now-meta">${c.plays} plays &middot; ${c.hours}h${note ? ` &middot; ${note}` : ''}</span>
        </label>`;
    }).join('');
    updateNewsletterSendButton();
    loadNewsletterHistory();
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not load candidates.</p>';
  }
}

function applyNewsletterResendMode() {
  const allow = document.getElementById('newsletter-allow-resend').checked;
  document.querySelectorAll('.newsletter-candidate-row[data-sent="true"]').forEach(row => {
    const cb = row.querySelector('.newsletter-candidate-checkbox');
    cb.disabled = row.dataset.baseDisabled === 'true' || !allow;
    row.classList.toggle('newsletter-candidate-row-disabled', cb.disabled);
    if (cb.disabled) cb.checked = false;
  });
  updateNewsletterSendButton();
}

document.getElementById('newsletter-allow-resend').addEventListener('change', applyNewsletterResendMode);

function updateNewsletterSendButton() {
  const checked = document.querySelectorAll('.newsletter-candidate-checkbox:checked').length;
  const btn = document.getElementById('newsletter-send-btn');
  btn.disabled = checked === 0;
  btn.textContent = checked ? `Send Recap to ${checked}` : 'Send Recap';
}

document.getElementById('newsletter-candidates-body').addEventListener('change', e => {
  if (e.target.classList.contains('newsletter-candidate-checkbox')) updateNewsletterSendButton();
});

document.getElementById('newsletter-select-all-btn').addEventListener('click', () => {
  document.querySelectorAll('.newsletter-candidate-checkbox:not(:disabled)').forEach(cb => { cb.checked = true; });
  updateNewsletterSendButton();
});

document.getElementById('newsletter-send-btn').addEventListener('click', async () => {
  const userIds = [...document.querySelectorAll('.newsletter-candidate-checkbox:checked')].map(cb => cb.value);
  if (!userIds.length) return;
  const resend = document.getElementById('newsletter-allow-resend').checked;
  const ok = await confirmDialog(`${resend ? 'Send or resend' : 'Send'} this month's recap to ${userIds.length} ${userIds.length === 1 ? 'person' : 'people'}? This sends real email right now.`);
  if (!ok) return;

  const btn = document.getElementById('newsletter-send-btn');
  const status = document.getElementById('newsletter-send-status');
  btn.disabled = true;
  status.classList.remove('hidden');
  status.textContent = 'Sending…';
  try {
    const result = await api('/api/recap/send', { method: 'POST', body: JSON.stringify({ userIds, resend }) });
    const parts = [`Sent ${result.sent} of ${result.requested}.`];
    if (result.failed.length) parts.push(`${result.failed.length} failed.`);
    if (result.skipped.length) parts.push(`${result.skipped.length} skipped.`);
    status.textContent = parts.join(' ');
    await loadNewsletterCandidates();
  } catch (e) {
    status.textContent = `Send failed: ${e.message}`;
  } finally {
    updateNewsletterSendButton();
  }
});

async function loadNewsletterHistory() {
  const body = document.getElementById('newsletter-history-body');
  try {
    const rows = await api('/api/recap/history?limit=30');
    body.innerHTML = rows.length ? rows.map(row => `
      <div class="audit-row">
        <span class="state-dot ${row.status === 'sent' ? '' : row.status === 'sending' ? 'paused' : 'danger'}"></span>
        <div class="audit-row-main">
          <div class="now-title">${escapeHtml(row.recipientName || row.userId)}${row.isResend ? ' · Resend' : ''}</div>
          <div class="now-meta">${escapeHtml(row.periodKey)} · ${escapeHtml(row.status)} · ${timeAgo(row.startedAt)}${row.error ? ` · ${escapeHtml(row.error)}` : ''}</div>
        </div>
      </div>`).join('') : '<p class="empty-state">No sends recorded yet.</p>';
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not load send history.</p>';
  }
}

// ---------- Invite to Plex ----------
let inviteLibrariesCache = [];

function libraryCheckboxesHtml(name, checkedIds = []) {
  const checkedSet = new Set(checkedIds.map(String));
  return inviteLibrariesCache.map(lib => `
    <label class="invite-library-option">
      <input type="checkbox" name="${name}" value="${escapeHtml(lib.id)}" ${checkedSet.has(String(lib.id)) ? 'checked' : ''}>
      ${escapeHtml(lib.title)}
    </label>`).join('');
}

async function loadInviteLibraries() {
  const body = document.getElementById('invite-libraries-body');
  try {
    inviteLibrariesCache = await api('/api/invite/libraries');
    body.innerHTML = inviteLibrariesCache.length
      ? `<div class="invite-library-list">${libraryCheckboxesHtml('invite-library')}</div>`
      : '<p class="empty-state">No libraries found.</p>';
    updateInviteSendButton();
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not load libraries from Plex.</p>';
  }
}

function updateInviteSendButton() {
  const email = document.getElementById('invite-email-input').value.trim();
  const checked = document.querySelectorAll('input[name="invite-library"]:checked').length;
  document.getElementById('invite-send-btn').disabled = !email || checked === 0;
}
document.getElementById('invite-email-input').addEventListener('input', updateInviteSendButton);
document.getElementById('invite-libraries-body').addEventListener('change', e => {
  if (e.target.name === 'invite-library') updateInviteSendButton();
});

document.getElementById('invite-send-btn').addEventListener('click', async () => {
  const email = document.getElementById('invite-email-input').value.trim();
  const librarySectionIds = [...document.querySelectorAll('input[name="invite-library"]:checked')].map(cb => cb.value);
  if (!email || !librarySectionIds.length) return;
  const libraryNames = inviteLibrariesCache.filter(l => librarySectionIds.includes(l.id)).map(l => l.title).join(', ');
  const ok = await confirmDialog(`Invite ${email} with access to ${libraryNames}? This grants real Plex access and sends real email right now.`);
  if (!ok) return;

  const btn = document.getElementById('invite-send-btn');
  const status = document.getElementById('invite-send-status');
  btn.disabled = true;
  status.classList.remove('hidden');
  status.textContent = 'Sending invite…';
  try {
    const result = await api('/api/invite', { method: 'POST', body: JSON.stringify({ email, librarySectionIds }) });
    status.textContent = `Invited ${result.email}.${result.welcomeEmailSent ? ' Welcome email sent.' : ' (Welcome email failed to send, but access was granted — check Settings → Newsletter config.)'}`;
    document.getElementById('invite-email-input').value = '';
    document.querySelectorAll('input[name="invite-library"]:checked').forEach(cb => { cb.checked = false; });
    await loadInviteShares();
  } catch (e) {
    status.textContent = `Invite failed: ${e.message}`;
  } finally {
    updateInviteSendButton();
  }
});

document.getElementById('invite-test-email-btn').addEventListener('click', async () => {
  const btn = document.getElementById('invite-test-email-btn');
  const status = document.getElementById('invite-test-email-status');
  btn.disabled = true;
  status.classList.remove('hidden');
  status.textContent = 'Sending…';
  try {
    const result = await api('/api/invite/test-email', { method: 'POST', body: JSON.stringify({}) });
    status.textContent = `Sent to ${result.to}. Check that inbox to confirm it actually arrived.`;
  } catch (e) {
    status.textContent = `Failed: ${e.message}`;
  } finally {
    btn.disabled = false;
  }
});

// Masks the local part of an email for the shares list (e.g. "c***0@hotmail.com") —
// this is the owner's own admin view, not a family-facing privacy setting (see
// lib/privacy.js for that), just less to expose on a shared screen/screenshot.
// Same first+last-char pattern as lib/privacy.js's maskUsername, applied here since
// that one's server-side and this list is rendered client-side from already-fetched
// share data.
function maskEmail(email) {
  if (!email) return '';
  const at = email.indexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const masked = local.length <= 2 ? local[0] + '***' : local[0] + '***' + local[local.length - 1];
  return masked + domain;
}

function shareRowHtml(share) {
  const libraryTags = share.allLibraries
    ? '<span class="invite-library-tag">All libraries</span>'
    : share.libraries.map(l => `<span class="invite-library-tag">${escapeHtml(l.title)}</span>`).join('');
  return `
    <div class="invite-share-row" data-share-id="${escapeHtml(share.id)}">
      <div class="invite-share-main">
        <div class="now-title">${escapeHtml(share.username || maskEmail(share.email))}</div>
        <div class="now-meta">${escapeHtml(maskEmail(share.email))}${share.acceptedAt ? ` · accepted ${timeAgo(share.acceptedAt)}` : ' · invite pending'}</div>
        <div class="invite-library-tags">${libraryTags}</div>
      </div>
      <div class="invite-share-actions">
        <button type="button" class="pill-btn invite-edit-btn">Edit</button>
        <button type="button" class="pill-btn invite-revoke-btn">Revoke</button>
      </div>
      <div class="invite-share-edit hidden">
        <div class="invite-library-list">${libraryCheckboxesHtml(`invite-edit-${share.id}`, share.libraries.map(l => l.id))}</div>
        <div class="settings-edit-actions">
          <button type="button" class="pill-btn invite-edit-cancel-btn">Cancel</button>
          <button type="button" class="btn-primary invite-edit-save-btn">Save Changes</button>
        </div>
      </div>
    </div>`;
}

async function loadInviteShares() {
  const body = document.getElementById('invite-shares-body');
  try {
    const shares = await api('/api/invite/shares');
    body.innerHTML = shares.length
      ? shares.map(shareRowHtml).join('')
      : '<p class="empty-state">No one else has access yet.</p>';
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not load current shares.</p>';
  }
}

document.getElementById('invite-shares-body').addEventListener('click', async e => {
  const row = e.target.closest('.invite-share-row');
  if (!row) return;
  const shareId = row.dataset.shareId;

  if (e.target.classList.contains('invite-edit-btn')) {
    row.querySelector('.invite-share-edit').classList.remove('hidden');
    return;
  }
  if (e.target.classList.contains('invite-edit-cancel-btn')) {
    row.querySelector('.invite-share-edit').classList.add('hidden');
    return;
  }
  if (e.target.classList.contains('invite-edit-save-btn')) {
    const librarySectionIds = [...row.querySelectorAll(`input[name="invite-edit-${shareId}"]:checked`)].map(cb => cb.value);
    if (!librarySectionIds.length) return;
    e.target.disabled = true;
    try {
      await api(`/api/invite/${encodeURIComponent(shareId)}`, { method: 'PATCH', body: JSON.stringify({ librarySectionIds }) });
      await loadInviteShares();
    } catch (err) {
      alert(`Could not update access: ${err.message}`);
      e.target.disabled = false;
    }
    return;
  }
  if (e.target.classList.contains('invite-revoke-btn')) {
    const name = row.querySelector('.now-title').textContent;
    const ok = await confirmDialog(`Revoke ${name}'s access entirely? They'll immediately lose access to the server.`);
    if (!ok) return;
    e.target.disabled = true;
    try {
      await api(`/api/invite/${encodeURIComponent(shareId)}`, { method: 'DELETE' });
      await loadInviteShares();
    } catch (err) {
      alert(`Could not revoke access: ${err.message}`);
      e.target.disabled = false;
    }
  }
});

async function loadAuditLog() {
  const body = document.getElementById('audit-log-body');
  try {
    const rows = await api('/api/owner/audit?limit=100');
    body.innerHTML = rows.length ? rows.map(row => `
      <div class="audit-row">
        <span class="state-dot ${row.success ? '' : 'danger'}"></span>
        <div class="audit-row-main">
          <div class="now-title">${escapeHtml(row.action)}</div>
          <div class="now-meta">${escapeHtml(row.actorName || 'Unknown actor')} · ${row.statusCode || '—'} · ${timeAgo(row.at)}${row.ipPrefix ? ` · ${escapeHtml(row.ipPrefix)}` : ''}</div>
        </div>
      </div>`).join('') : '<p class="empty-state">No audit events recorded yet.</p>';
  } catch (e) {
    body.innerHTML = '<p class="empty-state">Could not load audit history.</p>';
  }
}

document.getElementById('refresh-audit-btn').addEventListener('click', loadAuditLog);

// ---------- Settings: Privacy & Visibility ----------
// Controls what non-owner family members see of each other in Now Playing
// and Top of the Month (see lib/privacy.js) — never affects what the owner
// sees, and never affects what someone sees of their own stream/stats.
const PRIVACY_FIELDS = {
  streamUserIdentity: 'privacy-identity-input',
  streamMediaContent: 'privacy-media-input',
  streamTechnical: 'privacy-technical-input',
  statsLeaderboard: 'privacy-stats-input'
};
const PRIVACY_ENV_KEYS = {
  streamUserIdentity: 'PRIVACY_STREAM_USER_IDENTITY',
  streamMediaContent: 'PRIVACY_STREAM_MEDIA_CONTENT',
  streamTechnical: 'PRIVACY_STREAM_TECHNICAL',
  statsLeaderboard: 'PRIVACY_STATS'
};

async function loadPrivacySettings() {
  try {
    const privacy = await api('/api/settings/privacy');
    for (const [field, elId] of Object.entries(PRIVACY_FIELDS)) {
      const value = privacy[PRIVACY_ENV_KEYS[field]];
      if (value) document.getElementById(elId).value = value;
    }
  } catch (e) {
    document.getElementById('privacy-save-status').className = 'settings-status error';
    document.getElementById('privacy-save-status').textContent = 'Could not load privacy settings.';
    document.getElementById('privacy-save-status').classList.remove('hidden');
  }
}

function applyPrivacyPreset(values) {
  for (const [field, elId] of Object.entries(PRIVACY_FIELDS)) {
    document.getElementById(elId).value = values[field];
  }
}

document.getElementById('privacy-preset-strict').addEventListener('click', () => applyPrivacyPreset({
  streamUserIdentity: 'hide_identity', streamMediaContent: 'category_only',
  streamTechnical: 'hide_all_technical', statsLeaderboard: 'disable_leaderboard'
}));
document.getElementById('privacy-preset-family').addEventListener('click', () => applyPrivacyPreset({
  streamUserIdentity: 'generic_labels', streamMediaContent: 'show_name_only',
  streamTechnical: 'hide_device_info', statsLeaderboard: 'anonymous_leaderboard'
}));
document.getElementById('privacy-preset-open').addEventListener('click', () => applyPrivacyPreset({
  streamUserIdentity: 'full', streamMediaContent: 'full_details',
  streamTechnical: 'full_technical', statsLeaderboard: 'full_leaderboard'
}));

document.getElementById('privacy-save-btn').addEventListener('click', async () => {
  const btn = document.getElementById('privacy-save-btn');
  const status = document.getElementById('privacy-save-status');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  status.className = 'settings-status';
  status.textContent = '';
  status.classList.remove('hidden');

  const changes = {};
  for (const [field, elId] of Object.entries(PRIVACY_FIELDS)) {
    changes[PRIVACY_ENV_KEYS[field]] = document.getElementById(elId).value;
  }

  try {
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ changes }) });
    status.className = 'settings-status ok';
    status.textContent = 'Saved — restarting…';
    btn.textContent = 'Restarting…';
    await new Promise(r => setTimeout(r, 2000));
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (res.status) { location.reload(); return; }
      } catch (e) { /* still restarting — keep polling */ }
      await new Promise(r => setTimeout(r, 1500));
    }
    status.textContent = 'Taking longer than expected — try reloading the page manually.';
  } catch (e) {
    status.className = 'settings-status error';
    status.textContent = e.message || 'Could not save privacy settings.';
    btn.disabled = false;
    btn.textContent = 'Save Privacy Settings';
  }
});

document.getElementById('notice-save-btn').addEventListener('click', async () => {
  const message = document.getElementById('notice-message-input').value.trim();
  const startsValue = document.getElementById('notice-starts-input').value;
  const endsValue = document.getElementById('notice-ends-input').value;
  const statusMsg = document.getElementById('notice-save-status');
  statusMsg.className = 'settings-status';
  statusMsg.textContent = '';

  if (!message) {
    statusMsg.className = 'settings-status error';
    statusMsg.textContent = 'Message is required.';
    return;
  }
  // Resolved from the browser's own local time here, not sent as a bare
  // date-time string — the server would otherwise parse that against its
  // own timezone instead of whatever the owner actually picked.
  const startsAt = startsValue ? new Date(startsValue).getTime() : null;
  const endsAt = endsValue ? new Date(endsValue).getTime() : null;

  const btn = document.getElementById('notice-save-btn');
  btn.disabled = true;
  btn.textContent = 'Posting…';
  try {
    await api('/api/notice', { method: 'POST', body: JSON.stringify({ message, startsAt, endsAt }) });
    statusMsg.className = 'settings-status ok';
    statusMsg.textContent = 'Saved.';
    loadNoticeSettings();
  } catch (e) {
    statusMsg.className = 'settings-status error';
    statusMsg.textContent = e.message || 'Could not save notice.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Post Notice';
  }
});

document.getElementById('notice-clear-btn').addEventListener('click', async () => {
  if (!await confirmDialog('Clear the current notice? Family members will stop seeing it immediately.')) return;
  try {
    await api('/api/notice', { method: 'DELETE' });
    loadNoticeSettings();
  } catch (e) {
    document.getElementById('notice-save-status').textContent = 'Could not clear notice.';
  }
});

// ---------- Push notifications (owner-only) ----------
// Pings this device the moment a NEW or reopened stack alert lands (see
// lib/alerts.js's reconcile()), even without the dashboard open — unlike the
// old family-wide version of this feature (removed in v1.5.0 for going
// unused), this one is scoped to something actually worth a ping. Button
// stays hidden entirely if this deployment has no VAPID key configured, or
// the browser doesn't support Push at all — same graceful-absence pattern as
// every other optional integration in this app.
async function initNotifyToggle() {
  const btn = document.getElementById('notify-toggle-btn');
  if (!window.VAPID_PUBLIC_KEY || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  btn.classList.remove('hidden');

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  btn.classList.toggle('active', !!existing);

  // Every step here (service worker readiness, the browser's own permission
  // prompt, the subscribe/unsubscribe call, the backend round trip) can fail
  // or just never resolve — catching each explicitly means a denied/ignored
  // permission prompt or a failed subscribe() tells the owner why, instead
  // of the click looking like it did nothing at all.
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

// Web Push's applicationServerKey needs a Uint8Array — VAPID public keys are
// handed out base64url-encoded, this is the standard conversion (same as
// MDN's own push notification guide).
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

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
