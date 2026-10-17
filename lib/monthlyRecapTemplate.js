// Renders the monthly recap email as a standalone HTML string. Pure
// (data in, HTML string out) — no fetching here, see lib/monthlyRecap.js
// for gathering the data this expects. Visual design matches the dashboard
// itself: same three-family font system (Space Grotesk / Inter / JetBrains
// Mono, loaded from this app's own public/fonts/ where the client supports
// web fonts), same dark palette, and a real still from the recipient's own
// top-watched title as the header image (a signed link, see lib/recapArt.js).
// Markup is email-safe (inline styles, tables); see the note further down.
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Was hardcoded to "Evening" regardless of actual send time — noticeably
// wrong for a recap that goes out mid-afternoon, or if a batch's per-
// recipient throttled send (see lib/mailer.js) spans a real boundary. `now`
// defaults to the actual moment this recipient's email is rendered (called
// live during routes/recap.js's per-user send loop, not once for the whole
// batch) — an explicit default param, not a module-load-time snapshot, kept
// this way specifically so a test can pass a fixed Date and get a
// deterministic answer.
//
// Pins the zone via Intl rather than reading now.getHours() (which only
// reflects the process's own OS-level TZ — today, docker-compose.yml's
// TZ=America/Chicago) — a future deploy path that drops that env var (a bare
// docker run, an edited compose file, a migration off compose) would
// otherwise silently fall back to UTC and shift every recipient's greeting
// by 5-6 hours, reintroducing the exact bug this function exists to fix.
// RECAP_TIMEZONE lets a different deployment override it the same way
// SITE_NAME/SITE_TAGLINES already do for branding; America/Chicago is this
// household's real zone (matches SERVER_LAT/SERVER_LON's Roseville, MN),
// not an arbitrary default.
function timeOfDayGreeting(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hourCycle: 'h23',
    timeZone: process.env.RECAP_TIMEZONE || 'America/Chicago',
  }).format(now));
  if (hour >= 5 && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 17) return 'Afternoon';
  if (hour >= 17 && hour < 21) return 'Evening';
  return 'Night';
}

// ---------------------------------------------------------------------------------------------------------------
// Email-safe markup. Every style is inline with literal colors, and layout is tables, because mail clients strip
// or ignore most CSS: Gmail (what most guests use) doesn't support CSS custom properties, color-mix(), grid, or
// background images, and many apps drop <style> blocks entirely. The first version of this template was built
// like a web page (classes + var(--…) + flex/grid + a data: URI header image) and arrived as unstyled plain text
// in Gmail (reported 2026-10-04, September recap). The only thing left in <style> is @font-face, as a progressive
// enhancement for clients that load web fonts (Apple Mail); every font-family carries a safe fallback stack.
// ---------------------------------------------------------------------------------------------------------------
const C = {
  page: '#0C0E12', card: '#12151A', raised: '#1B1F27', line: '#2A2F3A',
  gold: '#F0B429', goldDim: '#C9962A', goldInk: '#12151A',
  ink: '#EDEFF3', inkDim: '#8B92A3', inkFaint: '#6B7282',
  ok: '#4ADE80', okBg: '#1A3326', okLine: '#2F5A40', rankBg: '#2A2617',
};
const F = {
  display: "'Space Grotesk','Helvetica Neue',Helvetica,Arial,sans-serif",
  body: "'Inter',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif",
  mono: "'JetBrains Mono',Menlo,Consolas,'Courier New',monospace",
};
const label = (text, extra = '') => `<p style="margin:0 0 14px;font-family:${F.mono};font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${C.inkFaint};${extra}">${text}</p>`;
const section = (inner, last = false) => `<tr><td style="padding:30px 28px;${last ? '' : `border-bottom:1px solid ${C.line};`}">${inner}</td></tr>`;

function renderTopWatchedRows(topWatched) {
  if (!topWatched.length) {
    return `<p style="margin:0;font-family:${F.body};font-size:14px;color:${C.inkFaint};">Nothing logged this month.</p>`;
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${topWatched.map((t, i) => `
      <tr>
        <td width="30" style="padding:10px 0;${i ? `border-top:1px solid ${C.line};` : ''}font-family:${F.mono};font-size:13px;font-weight:700;color:${C.goldDim};vertical-align:top;">${String(i + 1).padStart(2, '0')}</td>
        <td style="padding:10px 8px 10px 0;${i ? `border-top:1px solid ${C.line};` : ''}font-family:${F.body};font-size:15px;color:${C.ink};vertical-align:top;">${esc(t.title)}</td>
        <td align="right" style="padding:10px 0;${i ? `border-top:1px solid ${C.line};` : ''}font-family:${F.mono};font-size:12px;color:${C.inkFaint};white-space:nowrap;vertical-align:top;">${t.plays} ${t.plays === 1 ? 'play' : 'plays'}</td>
      </tr>`).join('')}
    </table>`;
}

function renderHeadliner(headliner) {
  if (!headliner) return '';
  return `
    ${label('What You Binged', 'margin-top:26px;')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.raised}" style="background:${C.raised};border:1px solid ${C.line};border-radius:12px;">
      <tr>
        <td width="62" style="padding:16px 0 16px 16px;vertical-align:middle;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="46" height="46" align="center" bgcolor="${C.gold}" style="width:46px;height:46px;background:${C.gold};border-radius:23px;font-family:${F.display};font-size:17px;font-weight:700;color:${C.goldInk};">${headliner.plays}&times;</td></tr></table>
        </td>
        <td style="padding:16px 16px 16px 4px;vertical-align:middle;">
          <p style="margin:0;font-family:${F.body};font-size:16px;font-weight:700;color:${C.ink};">${esc(headliner.title)}</p>
          <p style="margin:3px 0 0;font-family:${F.mono};font-size:12.5px;color:${C.inkDim};">${headliner.plays} plays, ~${headliner.hours}h this month</p>
        </td>
      </tr>
    </table>`;
}

function renderRankBadge(rank) {
  const sub = rank.position == null
    ? 'No plays logged this month, so nothing to rank yet.'
    : `${esc(ordinal(rank.position))} most-watched out of ${rank.of} people who tuned in this month`;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.rankBg}" style="background:${C.rankBg};border:1px solid ${C.goldDim};border-radius:12px;margin:0 0 14px;">
      <tr>
        ${rank.position == null ? '' : `<td style="padding:16px 4px 16px 18px;white-space:nowrap;vertical-align:middle;font-family:${F.display};font-size:32px;font-weight:700;line-height:1;color:${C.gold};">#${rank.position}<span style="font-family:${F.mono};font-size:13px;font-weight:400;color:${C.inkFaint};"> / ${rank.of}</span></td>`}
        <td style="padding:16px 18px 16px ${rank.position == null ? 18 : 12}px;vertical-align:middle;">
          <p style="margin:0;font-family:${F.mono};font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${C.gold};">Family Rank</p>
          <p style="margin:3px 0 0;font-family:${F.mono};font-size:12.5px;line-height:1.45;color:${C.inkDim};">${sub}</p>
        </td>
      </tr>
    </table>`;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function renderStatusNotice(uptime) {
  if (!uptime) return '';
  const rounded = uptime.percent;
  const text = rounded >= 99.95
    ? `<b style="color:${C.ok};">${rounded}% uptime</b> this month. The projector never stopped rolling.`
    : `<b style="color:${C.ok};">${rounded}% uptime</b> this month. A few hiccups here and there, but back up fast every time.`;
  return section(`
    ${label('Service Status')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.okBg}" style="background:${C.okBg};border:1px solid ${C.okLine};border-radius:12px;">
      <tr><td style="padding:14px 16px;font-family:${F.body};font-size:13.5px;line-height:1.5;color:${C.ink};"><span style="color:${C.ok};">&#9679;</span>&nbsp; ${text}</td></tr>
    </table>`);
}

function statCell(number, unit, name) {
  return `<td width="33%" align="center" bgcolor="${C.raised}" style="background:${C.raised};border:1px solid ${C.line};border-radius:12px;padding:16px 6px;">
          <p style="margin:0;font-family:${F.display};font-size:26px;font-weight:700;line-height:1.1;color:${C.ink};">${number}${unit ? `<span style="font-family:${F.mono};font-size:12px;font-weight:700;color:${C.gold};"> ${unit}</span>` : ''}</p>
          <p style="margin:6px 0 0;font-family:${F.mono};font-size:10.5px;letter-spacing:1px;text-transform:uppercase;color:${C.inkFaint};">${name}</p>
        </td>`;
}

// `headlinerImageUrl` is a signed link to the top title's backdrop (lib/recapArt.js), built by the sender; null
// on a quiet month, and the header is then just text on the dark background.
function renderMonthlyRecapEmail(data) {
  const {
    recipientName, siteName = 'Marquee', requestUrl = 'http://localhost:4000', unsubscribeUrl = '#',
    period, hours, plays, streakDays, rank, topWatched, headliner, headlinerImageUrl, uptime,
  } = data;
  const fontBase = `${requestUrl.replace(/\/$/, '')}/fonts`;
  const preheader = [headliner && `Your top watch: ${headliner.title}`, `${hours} hrs, ${plays} plays in ${period.label}`].filter(Boolean).join(' · ');
  const gap = '<td width="10" style="width:10px;font-size:0;line-height:0;">&nbsp;</td>';

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>Your ${esc(siteName)} recap — ${esc(period.label)}</title>
<style>
  @font-face { font-family: 'Inter'; font-style: normal; font-weight: 400 600; src: url('${fontBase}/inter-latin.woff2') format('woff2'); }
  @font-face { font-family: 'JetBrains Mono'; font-style: normal; font-weight: 400 500; src: url('${fontBase}/jetbrains-mono-latin.woff2') format('woff2'); }
  @font-face { font-family: 'Space Grotesk'; font-style: normal; font-weight: 500 700; src: url('${fontBase}/space-grotesk-latin.woff2') format('woff2'); }
</style>
</head>
<body style="margin:0;padding:0;background:${C.page};" bgcolor="${C.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.page};">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background:${C.page};">
  <tr><td align="center" style="padding:28px 12px 56px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" style="max-width:600px;background:${C.card};border:1px solid ${C.line};border-radius:18px;">

      ${headlinerImageUrl ? `<tr><td style="padding:0;"><img src="${esc(headlinerImageUrl)}" width="600" alt="${esc(headliner?.title || '')}" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:18px 18px 0 0;"></td></tr>` : ''}
      <tr><td align="center" style="padding:${headlinerImageUrl ? 22 : 30}px 24px 28px;border-bottom:3px dotted ${C.gold};">
        <p style="margin:0 0 6px;font-family:${F.mono};font-size:11.5px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:${C.gold};">Now Showing At</p>
        <h1 style="margin:0;font-family:${F.display};font-size:34px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#FAFAFB;">${esc(siteName)}<span style="color:${C.gold};">.</span></h1>
        <p style="margin:8px 0 0;font-family:${F.mono};font-size:11.5px;letter-spacing:1px;text-transform:uppercase;color:#C6CAD3;">I know what you watched last month.</p>
        <p style="margin:10px 0 0;font-family:${F.mono};font-size:13px;color:#C6CAD3;">${esc(recipientName)}'s recap &middot; ${esc(period.label)}</p>
        ${headliner ? `<p style="margin:16px 0 0;"><span style="display:inline-block;font-family:${F.mono};font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#E8E9EC;border:1px solid ${C.goldDim};border-radius:999px;padding:5px 14px;">Your top watch: <b style="color:${C.gold};">${esc(headliner.title)}</b></span></p>` : ''}
      </td></tr>

      ${section(`
        <p style="margin:0 0 24px;font-family:${F.body};font-size:19px;line-height:1.5;color:${C.ink};">${timeOfDayGreeting()}, <b style="color:${C.goldDim};">${esc(recipientName)}</b>. The projector's been running hot. Here's what you watched this month.</p>
        ${renderRankBadge(rank)}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          ${statCell(hours, 'hrs', 'Watched')}${gap}${statCell(plays, '', 'Plays')}${gap}${statCell(streakDays, 'days', 'Binge Streak')}
        </tr></table>
        ${renderHeadliner(headliner)}`)}

      ${section(`
        ${label('What You Watched')}
        <p style="margin:0 0 6px;font-family:${F.mono};font-size:13px;font-weight:700;color:${C.ink};">Your five most-played titles this month</p>
        ${renderTopWatchedRows(topWatched)}`)}

      ${renderStatusNotice(uptime)}

      ${section(`
        ${label('Anything We Missed?')}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="50%" align="center" bgcolor="${C.gold}" style="background:${C.gold};border-radius:10px;"><a href="${esc(requestUrl)}" style="display:block;padding:13px 8px;font-family:${F.display};font-size:14px;font-weight:700;color:${C.goldInk};text-decoration:none;">Request a title</a></td>
          ${gap}
          <td width="50%" align="center" style="border:1px solid ${C.line};border-radius:10px;"><a href="${esc(requestUrl)}" style="display:block;padding:12px 8px;font-family:${F.display};font-size:14px;font-weight:700;color:${C.ink};text-decoration:none;">Report an issue</a></td>
        </tr></table>`, true)}

      <tr><td align="center" style="padding:24px 28px 30px;border-top:1px solid ${C.line};">
        <p style="margin:0;font-family:${F.mono};font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${C.inkFaint};">${esc(siteName)}</p>
        <p style="margin:10px 0 0;font-family:${F.mono};font-size:11.5px;line-height:1.7;color:${C.inkFaint};">You're getting this because you're on the guest list.<br>Questions? Just reply. A person reads these.</p>
        <p style="margin:16px 0 0;font-family:${F.mono};font-size:11px;"><a href="${esc(unsubscribeUrl)}" style="color:${C.inkFaint};text-decoration:underline;">Unsubscribe from monthly recaps</a></p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>
`;
}

module.exports = { renderMonthlyRecapEmail, esc, ordinal, timeOfDayGreeting };
