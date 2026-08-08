// Renders the monthly recap email as a standalone HTML string. Pure
// (data in, HTML string out) — no fetching here, see lib/monthlyRecap.js
// for gathering the data this expects. Visual design matches the dashboard
// itself: same three-family font system (Space Grotesk / Inter / JetBrains
// Mono, loaded from this app's own public/fonts/ — see fonts.css), same
// dark palette, and a real still from the recipient's own top-watched title
// as the header image (embedded as a data URI, not linked — most email
// clients block remote images by default, and this is generated fresh per
// recipient anyway so there's no shared-image caching to lose).
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderTopWatchedRows(topWatched) {
  if (!topWatched.length) {
    return `<div class="chart-row"><span class="chart-name" style="color:var(--ink-faint)">Nothing logged this month.</span></div>`;
  }
  return topWatched.map((t, i) => `
      <div class="chart-row">
        <span class="chart-rank">${String(i + 1).padStart(2, '0')}</span>
        <span class="chart-name">${esc(t.title)}</span>
        <span class="chart-metric">${t.plays} ${t.plays === 1 ? 'play' : 'plays'}</span>
      </div>`).join('');
}

function renderHeadliner(headliner) {
  if (!headliner) return '';
  return `
    <p class="section-label" style="margin: 26px 0 12px;">What You Binged</p>
    <div class="headliner">
      <div class="headliner-badge">${headliner.plays}&times;</div>
      <div class="headliner-text">
        <p class="headliner-title">${esc(headliner.title)}</p>
        <p class="headliner-sub">${headliner.plays} plays, ~${headliner.hours}h this month</p>
      </div>
    </div>`;
}

function renderRankBadge(rank) {
  if (rank.position == null) {
    return `
    <div class="rank-badge">
      <div class="rank-text">
        <p class="rank-label">Family Rank</p>
        <p class="rank-sub">No plays logged this month — nothing to rank yet.</p>
      </div>
    </div>`;
  }
  return `
    <div class="rank-badge">
      <div class="rank-number">#${rank.position}<span class="rank-of"> / ${rank.of}</span></div>
      <div class="rank-text">
        <p class="rank-label">Family Rank</p>
        <p class="rank-sub">${esc(ordinal(rank.position))} most-watched out of ${rank.of} people who tuned in this month</p>
      </div>
    </div>`;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function renderStatusNotice(uptime) {
  if (!uptime) return '';
  const rounded = uptime.percent;
  const clean = rounded >= 99.95;
  const text = clean
    ? `<b>${rounded}% uptime</b> this month. The projector never stopped rolling.`
    : `<b>${rounded}% uptime</b> this month — a few hiccups here and there, but back up fast every time.`;
  return `
  <div class="section">
    <p class="section-label">Service Status</p>
    <div class="status-notice">
      <span class="status-dot"></span>
      <p>${text}</p>
    </div>
  </div>`;
}

// `headlinerImageDataUri` is a full `data:image/...;base64,...` string
// fetched separately (see fetchHeadlinerImage in lib/monthlyRecap.js) —
// kept out of this pure renderer so it stays easy to test without a network
// call. Falls back to a plain gradient header when there's no headliner
// (a quiet month) or the image fetch failed.
function renderMonthlyRecapEmail(data) {
  const {
    recipientName, siteName = 'Marquee', requestUrl = 'http://localhost:4000', unsubscribeUrl = '#',
    period, hours, plays, streakDays, rank, topWatched, headliner,
    headlinerImageDataUri, uptime,
  } = data;
  const fontBase = `${requestUrl.replace(/\/$/, '')}/fonts`;

  const headerBg = headlinerImageDataUri
    ? `linear-gradient(180deg, rgba(12,14,18,0.55) 0%, rgba(12,14,18,0.72) 45%, var(--bg-recessed) 96%), url("${headlinerImageDataUri}")`
    : `linear-gradient(180deg, var(--bg-recessed), var(--bg))`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your ${esc(siteName)} recap — ${esc(period.label)}</title>
<style>
  @font-face { font-family: 'Inter'; font-style: normal; font-weight: 400 600; font-display: swap; src: url('${fontBase}/inter-latin.woff2') format('woff2'); }
  @font-face { font-family: 'JetBrains Mono'; font-style: normal; font-weight: 400 500; font-display: swap; src: url('${fontBase}/jetbrains-mono-latin.woff2') format('woff2'); }
  @font-face { font-family: 'Space Grotesk'; font-style: normal; font-weight: 500 700; font-display: swap; src: url('${fontBase}/space-grotesk-latin.woff2') format('woff2'); }

  :root {
    --bg: #12151A; --bg-elevated: #1B1F27; --bg-recessed: #0C0E12;
    --marquee: #F0B429; --marquee-dim: #C9962A; --marquee-ink: #12151A;
    --ink: #EDEFF3; --ink-dim: #8B92A3; --ink-faint: #565D6D; --line: #2A2F3A;
    --success: #4ADE80; --success-dim: #234A34;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg-recessed); color: var(--ink); font-family: 'Inter', sans-serif; padding: 32px 16px 64px; }
  a { color: var(--marquee); }
  .program { max-width: 640px; margin: 0 auto; background: var(--bg); border-radius: 18px; overflow: hidden; border: 1px solid var(--line); }

  .marquee-header {
    position: relative;
    background-image: ${headerBg};
    background-size: cover; background-position: center 20%;
    padding: 26px 32px 34px; text-align: center; color: #F4F5F7;
  }
  .marquee-header::after {
    content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 14px;
    background: radial-gradient(circle at center, var(--marquee) 0 2.5px, transparent 2.6px) repeat-x;
    background-size: 22px 100%; background-position: 11px 4px;
  }
  .eyebrow { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; font-weight: 600; letter-spacing: 0.22em; color: var(--marquee); text-transform: uppercase; margin: 14px 0 6px; }
  .wordmark { font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 34px; letter-spacing: 0.06em; text-transform: uppercase; margin: 0; color: #FAFAFB; }
  .wordmark span { color: var(--marquee); }
  .tagline { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; letter-spacing: 0.08em; text-transform: uppercase; color: #C6CAD3; margin: 8px 0 0; }
  .date-range { font-family: 'JetBrains Mono', monospace; font-size: 13px; color: #C6CAD3; margin: 10px 0 0; }
  .featuring { display: inline-block; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; color: #E8E9EC; background: rgba(12,14,18,0.55); border: 1px solid rgba(240,180,41,0.4); border-radius: 999px; padding: 5px 14px; margin-top: 18px; }
  .featuring b { color: var(--marquee); font-weight: 700; }

  .section { padding: 36px 32px; border-bottom: 1px solid var(--line); }
  .section:last-of-type { border-bottom: none; }
  .section-label { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: var(--ink-faint); margin: 0 0 16px; }

  .greeting { font-size: 21px; line-height: 1.5; margin: 0 0 26px; }
  .greeting b { color: var(--marquee-dim); }

  .rank-badge { display: flex; align-items: center; gap: 14px; background: linear-gradient(135deg, color-mix(in srgb, var(--marquee) 14%, var(--bg-elevated)), var(--bg-elevated)); border: 1px solid var(--marquee-dim); border-radius: 12px; padding: 16px 18px; margin-bottom: 14px; }
  .rank-number { font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 32px; color: var(--marquee); line-height: 1; flex: none; }
  .rank-of { font-family: 'JetBrains Mono', monospace; font-size: 13px; color: var(--ink-faint); }
  .rank-text { font-family: 'JetBrains Mono', monospace; }
  .rank-label { font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--marquee); margin: 0; }
  .rank-sub { font-size: 12.5px; color: var(--ink-dim); margin: 3px 0 0; }

  .stat-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 28px; }
  .stat-card { background: var(--bg-elevated); border: 1px solid var(--line); border-radius: 12px; padding: 18px 14px; text-align: center; }
  .stat-number { font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 28px; color: var(--ink); line-height: 1.1; }
  .stat-unit { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--marquee); font-weight: 700; margin-left: 2px; }
  .stat-label { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-faint); margin-top: 6px; }

  .headliner { display: flex; gap: 16px; align-items: center; background: var(--bg-elevated); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
  .headliner-badge { flex: none; width: 46px; height: 46px; border-radius: 50%; background: var(--marquee); color: var(--marquee-ink); display: flex; align-items: center; justify-content: center; font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 18px; }
  .headliner-text p { margin: 0; font-family: 'JetBrains Mono', monospace; }
  .headliner-title { font-family: 'Inter', sans-serif; font-size: 15.5px; font-weight: 700; color: var(--ink); }
  .headliner-sub { font-size: 12.5px; color: var(--ink-dim); margin-top: 2px !important; }

  .chart-title { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 700; color: var(--ink); margin: 0 0 10px; }
  .chart-row { display: flex; align-items: baseline; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--line); font-family: 'JetBrains Mono', monospace; }
  .chart-row:last-child { border-bottom: none; }
  .chart-rank { flex: none; width: 20px; font-weight: 800; font-size: 13px; color: var(--marquee-dim); }
  .chart-name { font-family: 'Inter', sans-serif; flex: 1; font-size: 14.5px; color: var(--ink); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chart-metric { flex: none; font-size: 12px; color: var(--ink-faint); }

  .status-notice { display: flex; gap: 12px; align-items: flex-start; background: var(--success-dim); border: 1px solid color-mix(in srgb, var(--success) 35%, var(--line)); border-radius: 12px; padding: 14px 16px; }
  .status-dot { flex: none; width: 10px; height: 10px; margin-top: 4px; border-radius: 50%; background: var(--success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 22%, transparent); }
  .status-notice p { margin: 0; font-size: 13px; line-height: 1.5; color: var(--ink); font-family: 'Inter', sans-serif; }
  .status-notice b { color: var(--success); }

  .cta-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .cta-btn { display: block; text-align: center; text-decoration: none; font-family: 'Space Grotesk', sans-serif; font-size: 13.5px; font-weight: 700; padding: 13px 10px; border-radius: 10px; }
  .cta-primary { background: var(--marquee); color: var(--marquee-ink); }
  .cta-secondary { background: transparent; border: 1px solid var(--line); color: var(--ink); }

  .footer { padding: 26px 32px 32px; text-align: center; font-family: 'JetBrains Mono', monospace; }
  .footer-word { font-weight: 800; letter-spacing: 0.08em; color: var(--ink-faint); font-size: 12px; text-transform: uppercase; }
  .footer p { font-size: 11.5px; color: var(--ink-faint); line-height: 1.7; margin: 10px 0 0; }
  .footer a { color: var(--ink-dim); }
  .unsubscribe { display: inline-block; margin-top: 16px; font-size: 11px; color: var(--ink-faint); text-decoration: underline; text-underline-offset: 2px; }

  @media (max-width: 460px) {
    .stat-row { grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .stat-number { font-size: 22px; }
    .section { padding: 28px 20px; }
    .marquee-header { padding: 20px 20px 26px; }
    .wordmark { font-size: 26px; }
  }
</style>
</head>
<body>
<div class="program">

  <div class="marquee-header">
    <div class="eyebrow">Now Showing At</div>
    <h1 class="wordmark">${esc(siteName)}<span>.</span></h1>
    <p class="tagline">I know what you watched last month.</p>
    <p class="date-range">${esc(recipientName)}'s recap &middot; ${esc(period.label)}</p>
    ${headliner ? `<div class="featuring">Your top watch: <b>${esc(headliner.title)}</b></div>` : ''}
  </div>

  <div class="section">
    <p class="greeting">Evening, <b>${esc(recipientName)}</b> — the projector's been running hot. Here's what you watched this month.</p>

    ${renderRankBadge(rank)}

    <div class="stat-row">
      <div class="stat-card">
        <div class="stat-number">${hours}<span class="stat-unit">hrs</span></div>
        <div class="stat-label">Watched</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${plays}</div>
        <div class="stat-label">Plays</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${streakDays}<span class="stat-unit">days</span></div>
        <div class="stat-label">Binge Streak</div>
      </div>
    </div>

    ${renderHeadliner(headliner)}
  </div>

  <div class="section">
    <p class="section-label">What You Watched</p>
    <div class="chart-group">
      <p class="chart-title">Your five most-played titles this month</p>
      ${renderTopWatchedRows(topWatched)}
    </div>
  </div>

  ${renderStatusNotice(uptime)}

  <div class="section">
    <p class="section-label">Anything We Missed?</p>
    <div class="cta-row">
      <a class="cta-btn cta-primary" href="${esc(requestUrl)}">Request a title</a>
      <a class="cta-btn cta-secondary" href="${esc(requestUrl)}">Report an issue</a>
    </div>
  </div>

  <div class="footer">
    <div class="footer-word">${esc(siteName)}</div>
    <p>You're getting this because you're on the guest list.<br>Questions? Just reply &mdash; a person reads these.</p>
    <a class="unsubscribe" href="${esc(unsubscribeUrl)}">Unsubscribe from monthly recaps</a>
  </div>

</div>
</body>
</html>
`;
}

module.exports = { renderMonthlyRecapEmail, esc, ordinal };
