// Renders the Plex-invite welcome email as a standalone HTML string. Pure (data in,
// HTML string out) — no fetching here, see lib/inviteStats.js for the stats and
// lib/plexShare.js for the sharing operation itself. Visual design deliberately
// matches lib/monthlyRecapTemplate.js exactly (same three-family font system, same
// dark palette, same "program"/marquee-header structure) — see that file's own
// header comment for why; this is the same visual language applied to a different
// moment (welcome, not a recap).
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderLibraryBadge(libraries) {
  if (!libraries.length) return '';
  const names = libraries.map((l) => esc(l.title)).join(', ');
  return `<div class="featuring">Access granted: <b>${names}</b></div>`;
}

function renderWelcomeEmail(data) {
  const {
    recipientName, inviterName, siteName = 'Marquee', requestUrl = 'http://localhost:4000',
    libraries = [], stats, acceptUrl,
  } = data;
  const fontBase = `${requestUrl.replace(/\/$/, '')}/fonts`;
  const { movies, series, addedThisWeek } = stats;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Welcome to ${esc(siteName)}</title>
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
    background-image: linear-gradient(180deg, var(--bg-recessed), var(--bg));
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

  .stat-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 8px; }
  .stat-card { background: var(--bg-elevated); border: 1px solid var(--line); border-radius: 12px; padding: 18px 14px; text-align: center; }
  .stat-number { font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 28px; color: var(--ink); line-height: 1.1; }
  .stat-label { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-faint); margin-top: 6px; }
  .stat-foot { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: var(--ink-faint); text-align: center; margin: 14px 0 0; }
  .stat-foot b { color: var(--success); }

  .setup-list { display: flex; flex-direction: column; gap: 12px; }
  .setup-item { display: flex; gap: 14px; background: var(--bg-elevated); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; }
  .setup-num { flex: none; width: 26px; height: 26px; border-radius: 50%; background: var(--marquee); color: var(--marquee-ink); font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 13px; display: flex; align-items: center; justify-content: center; }
  .setup-text p { margin: 0; }
  .setup-title { font-family: 'Inter', sans-serif; font-size: 14.5px; font-weight: 700; color: var(--ink); margin-bottom: 3px !important; }
  .setup-sub { font-size: 12.5px; color: var(--ink-dim); line-height: 1.55; }
  .setup-path { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--marquee-dim); background: rgba(240,180,41,0.08); border-radius: 5px; padding: 1px 6px; display: inline-block; margin-top: 6px; }

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

  @media (max-width: 460px) {
    .stat-row { grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .stat-number { font-size: 20px; }
    .section { padding: 28px 20px; }
    .marquee-header { padding: 20px 20px 26px; }
    .wordmark { font-size: 26px; }
  }
</style>
</head>
<body>
<div class="program">

  <div class="marquee-header">
    <div class="eyebrow">You're On The List</div>
    <h1 class="wordmark">${esc(siteName)}<span>.</span></h1>
    <p class="tagline">Your private screening room is ready.</p>
    <p class="date-range">An invite from ${esc(inviterName)}</p>
    ${renderLibraryBadge(libraries)}
  </div>

  <div class="section">
    <p class="greeting">Hey <b>${esc(recipientName)}</b> &mdash; you've got the keys. Here's what's waiting for you tonight.</p>

    <div class="stat-row">
      <div class="stat-card">
        <div class="stat-number">${movies.toLocaleString('en-US')}</div>
        <div class="stat-label">Movies</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${series.toLocaleString('en-US')}</div>
        <div class="stat-label">TV Series</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${addedThisWeek}</div>
        <div class="stat-label">Added This Week</div>
      </div>
    </div>
    <p class="stat-foot">New stuff lands <b>almost every day</b> &mdash; ${addedThisWeek} titles/episodes added this week alone.</p>
  </div>

  <div class="section">
    <p class="section-label">Before You Start Watching</p>
    <div class="setup-list">
      <div class="setup-item">
        <div class="setup-num">1</div>
        <div class="setup-text">
          <p class="setup-title">Turn on Direct Play</p>
          <p class="setup-sub">This is the single biggest thing that stops buffering. When it's off, Plex has to transcode video on the fly, which is slow and stutters &mdash; Direct Play just streams the file as-is.</p>
          <span class="setup-path">Settings &rarr; Quality &rarr; Streaming &rarr; set to "Original / Maximum"</span>
        </div>
      </div>
      <div class="setup-item">
        <div class="setup-num">2</div>
        <div class="setup-text">
          <p class="setup-title">Turn off Plex's free channels</p>
          <p class="setup-sub">Plex bundles its own ad-supported movies &amp; shows alongside your library by default. Turn it off so you only see what's actually ours &mdash; no ads, no clutter.</p>
          <span class="setup-path">Settings &rarr; Online Media Sources &rarr; disable "Show Plex Movies &amp; TV Shows"</span>
        </div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="status-notice">
      <span class="status-dot"></span>
      <p>And don't forget to check out <a href="${esc(requestUrl)}"><b>${esc(requestUrl.replace(/^https?:\/\//, ''))}</b></a> &mdash; that's where you can request a title, report a problem with a file, and see your own watch stats.</p>
    </div>
  </div>

  <div class="section">
    <p class="section-label">Ready When You Are</p>
    ${acceptUrl ? `
    <div class="cta-row">
      <a class="cta-btn cta-primary" href="${esc(acceptUrl)}">Accept Invite</a>
      <a class="cta-btn cta-secondary" href="https://app.plex.tv">Open Plex</a>
    </div>` : `
    <div class="cta-row">
      <a class="cta-btn cta-primary" href="https://app.plex.tv">Open Plex</a>
      <a class="cta-btn cta-secondary" href="https://www.plex.tv/media-server-downloads/">Get the app</a>
    </div>`}
  </div>

  <div class="footer">
    <div class="footer-word">${esc(siteName)}</div>
    <p>You're getting this because you were just invited to the server.<br>Questions? Just reply &mdash; a person reads these.</p>
  </div>

</div>
</body>
</html>
`;
}

module.exports = { renderWelcomeEmail, esc };
