// Small utilities shared by both index.html (app.js) and admin.html (admin.js).
// Loaded before either page-specific script.

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

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
function formatSpeed(kbps) {
  return kbps >= 1024 ? `${(kbps / 1024).toFixed(1)} MB/s` : `${kbps} KB/s`;
}
// mm:ss below an hour, h:mm:ss at or above — same threshold Tautulli's own
// activity view uses for its elapsed/total counters.
function formatDuration(ms) {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  const ss = String(sec).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
function formatEta(seconds) {
  if (seconds >= 3600) return `${Math.round(seconds / 3600)}h left`;
  if (seconds >= 60) return `${Math.round(seconds / 60)}m left`;
  return `${seconds}s left`;
}
function formatBytes(bytes) {
  if (!bytes) return '';
  const gb = bytes / (1024 ** 3);
  // Release/download sizes never got big enough for this to matter before —
  // whole-volume disk space (admin Stack panel) is the first place values
  // routinely cross into TB.
  return gb >= 1000 ? (gb / 1024).toFixed(1) + ' TB' : gb.toFixed(1) + ' GB';
}

function formatUptime(seconds) {
  const totalMinutes = Math.max(0, Math.floor(seconds / 60));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

let plexUptimeTimer = null;
async function loadPlexUptime() {
  const el = document.getElementById('plex-uptime-footer');
  if (!el) return;
  try {
    const uptime = await api('/api/uptime-kuma/plex-uptime');
    if (uptime.status === 'up') el.textContent = ` · plex uptime ${formatUptime(uptime.seconds)}`;
    else if (uptime.status === 'down') el.textContent = ' · plex down';
    else el.textContent = '';
  } catch (e) {
    el.textContent = '';
  }
}

function startPlexUptime() {
  loadPlexUptime();
  if (!plexUptimeTimer) plexUptimeTimer = setInterval(loadPlexUptime, 60000);
}
function titleCase(str) {
  return str.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1));
}

// Replaces the browser's native confirm() (a plain unstyled OS dialog) with
// the app's own themed modal — same Promise<boolean> shape, so every call
// site just becomes `if (!await confirmDialog('...')) return;`. Relies on
// both pages having a #confirm-modal with #confirm-message/#confirm-cancel-btn/
// #confirm-ok-btn (see index.html/admin.html).
function confirmDialog(message) {
  return new Promise(resolve => {
    const modal = document.getElementById('confirm-modal');
    const okBtn = document.getElementById('confirm-ok-btn');
    const cancelBtn = document.getElementById('confirm-cancel-btn');
    document.getElementById('confirm-message').textContent = message;
    modal.classList.remove('hidden');

    function cleanup(result) {
      modal.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// Clicking a modal's backdrop closes it, sitewide — applies automatically to
// every ".modal" on the page (both index.html and admin.html), no per-modal
// wiring needed. Triggers the modal's own close button rather than just
// toggling .hidden directly, so any extra cleanup a specific modal's close
// handler does (e.g. resetting the request modal back to its Search tab)
// still runs the same way it would from clicking the X. e.target === modal
// only when the click actually landed on the backdrop itself, not on the
// card or anything inside it.
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', e => {
    if (e.target !== modal) return;
    modal.querySelector('.pill-btn-icon')?.click();
  });
});

// ---------- Theme picker ----------
// 5 preset color themes, switchable from a header icon button on both pages
// (see #theme-btn/#theme-modal in index.html/admin.html, wired up in
// app.js/admin.js), persisted per-browser via localStorage so it sticks
// across visits without needing a server round-trip.
const MARQUEE_THEMES = [
  { id: 'marquee-light', name: 'Marquee Glass', desc: 'Soft translucent glass & ambient light', primary: '#2F6FED', card: 'rgba(255,255,255,0.7)', accent: '#0F8F76' },
  { id: 'midnight-cyber', name: 'Midnight Cyber', desc: 'Neon cyan & magenta dark mode', primary: '#00F0FF', card: 'rgba(18,22,34,0.75)', accent: '#FF007A' },
  { id: 'oled-black', name: 'OLED Pure Black', desc: 'High-contrast pitch black & crisp amber', primary: '#FFC658', card: '#000000', accent: '#E08A1E' },
  { id: 'nordic-slate', name: 'Nordic Slate', desc: 'Cool slate blue & icy teal', primary: '#88C0D0', card: 'rgba(46,52,64,0.85)', accent: '#81A1C1' },
  { id: 'sunset-amber', name: 'Sunset Amber', desc: 'Warm dark copper & gold', primary: '#E0A21E', card: 'rgba(26,20,18,0.85)', accent: '#D97706' }
];
function getTheme() { return localStorage.getItem('marquee-theme') || 'marquee-light'; }
function setTheme(themeId) {
  const valid = MARQUEE_THEMES.some(t => t.id === themeId);
  const target = valid ? themeId : 'marquee-light';
  document.documentElement.setAttribute('data-theme', target);
  localStorage.setItem('marquee-theme', target);
  return target;
}
