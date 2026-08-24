# Roadmap

Every shipped feature or fix gets its own version bump now (`package.json`
+ `package-lock.json`) and its own section here — no more letting the
version drift unversioned between batches. One bump per shipped unit of
work: a new capability bumps minor, a fix bumps patch. `git commit`/push
themselves now batch to every 10th shipped unit instead of running every
time (version bumps, TODO.md sections, and live deploys still happen every
time regardless — only the git commit action batches). **Current version:
v1.44.0.**

Condensed to a real changelog as of `v1.42.0` — it had grown to 2650 lines of
prose-with-rationale per bullet. Every entry from here forward stays terse:
one line per item, just what changed/fixed, no root-cause narrative or
"verified live" description — that detail belongs in the commit, not here.

`v1.1.0` through `v1.4.1` below are a one-time retroactive reconstruction —
package.json had said `1.1.0` since the batch that first added a version
footer, and everything from `v1.2.0` on had actually shipped already with
no version bump at all (13 commits' worth), so those got grouped into what
the bumps should have been after the fact. Everything from here forward
gets versioned as it ships, not reconstructed later.

## Versions at a glance

- **v1.1.0 and earlier** — foundation: dashboard panels, request/download
  flow, admin console + Stack tools, security fixes, perf audit, Web Push
- **v1.2.0** — Releasing Soon "Downloaded" parity, My Stats tab, Watchlist
  tab removed
- **v1.2.1** — fix: Now Playing/Recently Watched poster flicker
- **v1.3.0** — Now Playing live elapsed/ETA counter
- **v1.3.1** — fix: counter sync accuracy (exact `view_offset`)
- **v1.4.0** — track a release grab through to done
- **v1.4.1** — fix batch: admin poster flicker, grab-status timing, Notice
  Board clipped text, avatar chip label
- **v1.4.2** — fix: notification bell failed silently
- **v1.4.3** — fix: bell's real root cause on Safari (implicit permission
  prompt unreliable there)
- **v1.5.0** — Web Push removed entirely (notification bell, subscribe/
  unsubscribe, VAPID)
- **v1.5.1** — fix: Download Queue/Download Issues poster-blink-class DOM
  churn on every poll

---

## v1.1.0 and earlier

- [x] Now Playing — live push updates via Plex WebSocket + SSE, header shows total bandwidth
- [x] Recently Watched panel (Tautulli history)
- [x] Recently Added panel — split by Movies/TV/Anime, season packs collapsed into one entry
- [x] Top of the Month leaderboard (top viewer/movie/TV/anime)
- [x] Airing Today / Releasing Soon panels (Sonarr/Radarr calendars)
- [x] Download Queue panel (qBittorrent/SABnzbd, actively-downloading only)
- [x] Owner-only System Status (Uptime Kuma monitors + UPS via NUT)
- [x] Request flow — search, season picker for TV, per-user Overseerr permissions
- [x] Trending/Discover default view in the request modal, filtered to not-owned/not-requested
- [x] My Requests tab — each family member's own request history and status
- [x] "Available now" toast when a request finishes downloading
- [x] PWA / installable, branded per-deployment
- [x] Cycling sign-in taglines / per-deployment branding
- [x] Admin panel — recent sign-ins, admin-wide pending requests with inline Approve/Decline
- [x] Report an issue flow, backed by Overseerr's own issue system
- [x] Admin: resolve issues + live search/grab a replacement release via Radarr/Sonarr
- [x] Admin moved to its own page (`/admin`)
- [x] Download Queue gains owner-only Pause/Resume/Remove
- [x] Admin Stack panel — Wanted/Missing, Import Issues, Prowlarr indexer health, Disk space
- [x] Plex Watchlist tab in the request modal, cross-referenced against Overseerr
- [x] **Fix**: My Requests status accuracy — "Downloading" now means actually in the queue
- [x] Admin: Search Library — free-text search across Radarr/Sonarr's own tracked library
- [x] Admin: Force Import for stuck Import Issues
- [x] Admin: current file info shown before searching for a replacement
- [x] CSRF protection on every state-changing request
- [x] Automated test coverage (`npm test`, Node's built-in test runner)
- [x] Dependency vulnerabilities cleared (`npm audit` 12 → 0)
- [x] CI: `npm test` runs automatically on every push via GitHub Actions
- [x] Admin: Seeding stat in the Stack panel (count, ratio, uploaded/downloaded)
- [x] Admin: Settings page — edit `.env` values from the browser, live health checks
- [x] Moved System Status and Recent Sign-ins into their own Settings tabs
- [x] Notice Board — owner can schedule a persistent dashboard announcement
- [x] **Security fix**: every signed-in family member incorrectly had `isOwner:true`
- [x] Themed confirm dialog replaces the browser's native `confirm()`
- [x] Adopted qBittorrent API-key auth, quieter Tautulli-unconfigured handling, cycling backdrop banner from a community fork
- [x] `QBITTORRENT_API_KEY` wired into the Settings edit form; fixed Settings silently dropping unregistered `.env` fields
- [x] Force Start button (torrents) in Download Issues
- [x] Hero backdrop banner now cycles randomly instead of a fixed loop
- [x] My Requests shows an ETA next to "Downloading"
- [x] **Fix**: Settings showed qBittorrent as Unconfigured after switching to API-key auth
- [x] **Fix**: Prowlarr had no Settings service card/health check
- [x] Click a torrent in Download Queue for details (seeds/peers/speed/ratio/ETA/files)
- [x] Owner-only Remove button on actively-downloading torrents in Download Queue
- [x] Disk Space now prefers real physical-volume data from a bind-mounted host path
- [ ] Note: the NAS-specific integration piece stays local, not pushed to GitHub
- [x] Wanted/Missing moved to the top of the admin Family card, flags stuck releases
- [x] Web Push for "Available now" (subscribe bell, VAPID)
- [x] **Perf audit**: removed dead CSS/exports, deduped `parseTimeleft()`
- [x] **Perf audit**: added `loading="lazy"` to all `<img>` tags
- [x] **Perf audit**: self-hosted fonts instead of render-blocking Google Fonts
- [x] **Perf audit**: immutable cache headers on versioned bundles
- [x] Copyright/version footer on both pages; version bumped 1.0.0 → 1.1.0

## v1.2.0 — Releasing Soon parity, My Stats, Watchlist removed

- [x] Releasing Soon shows a "Downloaded" status label matching Airing Today; fixed static deploys not restarting to bust the cache
- [x] My Stats tab — hours watched, family rank, binge streak, plays this month, top-3 most-watched
- [x] My Stats round 2 — dropped the poster tile for a flat medal list, added Watch Activity (day/hour breakdowns)
- [x] Removed the Watchlist tab and its backing route/client

## v1.2.1 — Fix: Now Playing/Recently Watched poster flicker

- [x] **Fix**: Now Playing/Recently Watched flickering every ~10s from a full innerHTML rebuild — reconciled rows by key instead

## v1.3.0 — Now Playing live elapsed/ETA counter

- [x] Now Playing shows elapsed/total runtime + wall-clock ETA above the progress bar
- [x] Elapsed/ETA/bar now tick every second via client-side interpolation instead of only on the ~10s push cadence

## v1.3.1 — Fix: counter sync accuracy

- [x] **Fix**: counter drifted up to ~half a percent off — now anchors on Plex's exact `view_offset` instead of a rounded percent

## v1.4.0 — Track a grab through to done

- [x] A grabbed release now tracks live through Downloading → Importing → Done/Failed instead of freezing at "Grabbed ✓"

## v1.4.1 — Fix batch: admin flicker, grab timing, Notice Board, avatar label

- [x] **Fix**: same poster-blink bug fixed on the admin page's 4 poll-refreshed lists (reconcile-by-key)
- [x] **Fix**: grab tracking jumped straight to "Replaced" instead of showing Downloading/Importing
- [x] Avatar chip subtitle changed from "Signed in" to "My Stats"
- [x] **Fix**: Notice Board's empty-state text was visibly clipped at the top

## v1.4.2 — Fix: notification bell failed silently

- [x] **Fix**: bell click had no error handling at all — now surfaces failures instead of silently doing nothing

## v1.4.3 — Fix: bell's real root cause on Safari

- [x] **Fix**: Safari never showed the permission prompt — now calls `Notification.requestPermission()` explicitly first

## v1.5.0 — Web Push removed entirely

- [x] Removed the notification bell, VAPID, and everything behind it (unused)
- [x] Found and fixed a stale build-context directory on docker-host that had been silently reverting deploys all session

## v1.5.1 — Fix: Download Queue/Download Issues DOM churn on every poll

- [x] Full perf/dead-code audit — came back clean except one real finding
- [x] Download Queue and Download Issues converted to reconcile-by-key, same pattern as Now Playing

## v1.5.2 — Fix: Top of the Month now tracks the calendar month, not a rolling 30 days

- [x] **Fix**: leaderboard used a rolling 30-day window instead of month-to-date — switched to days-elapsed-since-the-1st

## v1.5.3 — Anime leaderboard now tracks the calendar month too

- [x] Anime leaderboard switched from a fixed 90-day window to the same month-to-date window as the rest

## v1.6.0 — Alerts panel: arr-stack health watchdog

- [x] New owner-only Alerts panel, fed by an external cron watchdog checking Sonarr/Radarr/Prowlarr health + LLM log triage
- [x] New `lib/alerts.js` + `routes/alerts.js`: ingest, list, dismiss, with per-scope reconciliation
- [x] Reconciliation logic factored out and unit-tested

## v1.7.0 — Web Push notifications, brought back scoped to stack alerts only

- [x] Web Push rebuilt, owner-only, pings on a new/reopened arr-stack alert only (not every cycle)
- [x] **Fix**: eager DB-open crashed outside a container — matched the lazy-open pattern

## v1.8.0 — Alerts/push extended to open issues, import issues, downloads, stuck wanted

- [x] Alerts/push pipeline extended to cover Overseerr issues, stuck imports, stuck downloads, stuck Wanted/Missing
- [x] New `lib/issueWatchdog.js` scheduler; extracted fetch/map logic into shared `lib/` clients

## v1.8.1 — Fix: Alerts panel flashing "Could not load" on transient blips

- [x] **Fix**: a momentary poll failure wiped the whole panel — now only shows an error state on a genuine first-load failure

## v1.9.0 — "Suggest fix" button for log-triage/import alerts

- [x] Read-only "Suggest fix" button (no tool access, can't execute anything) for log-triage/import alerts
- [x] Scoped to only the two alert types with enough context for a genuinely useful suggestion

## v1.10.0 — Owner Disk Space panel: real physical-volume storage

- [x] Disk Space panel now prefers real filesystem data off a bind-mounted NAS share, falls back to Radarr/Sonarr's API
- [x] New `lib/mediaStorage.js` (gitignored, Synology-specific) + generic `lib/diskspace.js`

## v1.10.1 — Fix: My Stats now uses true calendar year/month, not rolling windows

- [x] **Fix**: hours/rank/topWatched switched from rolling 365-day to true calendar year-to-date
- [x] **Fix**: playsThisMonth switched from rolling 30-day to true calendar-month-to-date
- [x] `streakDays` deliberately kept on its own rolling 60-day window
- [x] Activity chart intentionally kept on a rolling 30-day window
- [x] Hero caption updated from "Last 12 months" to "Year to date"

## v1.10.2 — Releasing Soon: "Downloaded" now reads "Available now"

- [x] Releasing Soon's "Downloaded" label reworded to "Available now"

## v1.10.3 — Self-verifying deploy script

- [x] New `deploy.sh`: rsyncs the working tree, SHA-256-verifies every file landed before rebuilding
- [x] Reconciled `docker-compose.yml` with what was actually running in production (Traefik labels)

## v1.10.4 — Fix: season-picker crash from the info modal; Plex-unconfigured startup crash

- [x] **Fix**: requesting a TV show from the info modal crashed the season picker (missing `returnTabId`)
- [x] **Fix**: a fresh/incomplete `.env` crashed the whole process on startup instead of just leaving Now Playing empty

## v1.11.0 — Monthly recap email: reusable template + data layer

- [x] New `lib/monthlyRecap.js`: per-user monthly recap data (hours, plays, streak, rank, top 5, headliner)
- [x] New `lib/monthlyRecapTemplate.js`: pure HTML email renderer matching the dashboard's visual system
- [x] Header image embedded as a `data:` URI at generation time
- [x] New `getMonthlyUptime()` for the recap's Service Status line, guarded against low-sample months
- [x] Sending itself intentionally out of scope for this pass — template/data layer only

## v1.12.0 — Monthly recap: real sending, routed through Tautulli

- [x] New `lib/mailer.js` — sends real email routed through Tautulli's own Email notifier
- [x] **Incident**: an unresized header image pinned Tautulli at 100% CPU for several minutes — fixed by resizing via Tautulli's own image proxy first
- [x] **Fix**: first version sent as GET with the HTML body in params — got a 431 on any real content, switched to POST
- [x] Verified end-to-end with a real send to a real inbox
- [x] Still not built: per-user opt-in/unsubscribe tracking, a monthly trigger

## v1.13.0 — Monthly recap: unsubscribe/resubscribe

- [x] New `lib/recapUnsubscribe.js`: signed unsubscribe-link tokens, works without an active session
- [x] New `lib/recapUnsubscribes.js`: persists opt-outs
- [x] **Fix**: found and fixed a real cold-start SQLite race while verifying live (same class of bug hit again later in v1.33.1)
- [x] New `routes/recap.js`: public unsubscribe/resubscribe pages
- [x] Still not built: nothing calls this from an actual send yet, no monthly trigger

## v1.14.0 — Monthly recap: activity threshold + owner-selected sending

- [x] New `MIN_MONTHLY_PLAYS` threshold (5) + `listRecapCandidates` — everyone eligible for a given month
- [x] New owner-only `GET /candidates` and `POST /send` routes; re-derives eligibility server-side at send time
- [x] Still not built: a monthly cron/trigger — someone still has to call it

## v1.15.0 — Monthly recap: Newsletter tab in Settings

- [x] New Newsletter tab in Settings — checkbox list of eligible candidates, Send button with live count + confirmation

## v1.16.0 — Monthly recap: end-of-month reminder

- [x] New `lib/recapReminder.js`: pushes the owner a reminder to review/send last month's recap, once within the first 3 days of a new month
- [x] Push body includes the real eligible-candidate count for that month

## v1.17.0 — Monthly recap send ledger and duplicate prevention

- [x] New `lib/recapSendLog.js`: durable per-recipient/month send state (sending/sent/failed) shown in the Newsletter tab
- [x] Sending now atomically claims each recipient/month, preventing double-sends from a double-click or concurrent request
- [x] Abandoned claims (a crash mid-send) auto-reclaim after 15 minutes
- [x] Resending a completed month now requires an explicit resend flag + owner checkbox

## v1.18.0 — Security and owner-action audit log

- [x] New `lib/auditLog.js`: dedicated audit trail for sign-ins, sign-outs, unsubscribe events, unauthorized mutations, owner mutations
- [x] Privacy-bounded: no request bodies, masked IPs, bounded detail, 180-day expiry
- [x] New owner-only Audit Log tab under Settings

## v1.19.0 — Current Plex uptime in the footer

- [x] Footer now shows Plex's current uninterrupted uptime, refreshed every minute
- [x] New `GET /api/uptime-kuma/plex-uptime`, reading the existing Uptime Kuma database

## v1.19.1 — Footer label uses lowercase plex

- [x] Footer uptime label changed to lowercase "plex uptime"/"plex down"

## v1.20.0 — Newsletter admin configuration UI

- [x] Recap SMTP config is now a first-class Settings service card (health check, Edit popup, secret masking)
- [x] New `checkEmail()` health check confirms the configured Tautulli notifier really is an email agent
- [x] New "Send Test Email" button on the Newsletter tab, through the real send pipeline

## v1.21.0 — Database lifecycle: automated backups + integrity checks

- [x] New `lib/dbBackup.js`: daily automated backup of every sqlite file, with an integrity check before backup
- [x] Backs up via `VACUUM INTO` for a consistent snapshot of a live database
- [x] New owner-only backup-history routes + a "Database Backups" Settings section with a manual trigger
- [x] Restore is deliberately manual (documented), no one-click restore button

## v1.22.0 — Disk-backed image cache for Plex artwork

- [x] New `lib/mediaCache.js`: content-addressed disk cache for Plex posters/thumbnails — Plex now gets hit once per image, ever
- [x] Atomic writes, in-flight request dedupe, ETag support, LRU pruning by total bytes
- [x] Mounted at `/img` (not `/api/img`) so the existing service worker also caches it client-side
- [x] New "Image Cache" Settings section with size/entry count and a Flush Cache button

## v1.22.1 — Fix desktop scroll stutter

- [x] **Fix**: desktop scroll stutter from `background-attachment: fixed` + many blurred cards — replaced with a fixed background div for GPU compositing

## v1.22.2 — Fix Alerts panel: truncated fix suggestions, row alignment

- [x] **Fix**: suggested fixes got cut off mid-word — raised the token cap and added a sentence-boundary safety net
- [x] **Fix**: a bug in that safety net that would have dropped the last sentence of a complete response
- [x] **Fix**: alert row buttons were vertically centered instead of top-aligned on wrapped text
- [x] Suggest fix button now relabels to "Refresh suggestion" once a suggestion is showing

## v1.23.0 — Suggest-fix: numbered steps + copy button

- [x] Suggest-fix now returns a numbered step list instead of prose, rendered as a real `<ol>`
- [x] New Copy button next to each suggestion
- [x] Truncation safety net reworked for the new line-based format

## v1.24.0 — One safe, one-click action: test download client connection

- [x] New one-click, read-only "test download client connection" action for a matched alert (Sonarr/Radarr's own `/test` API)
- [x] Deliberately no Docker socket access or auto-fix execution — action selection is a pure string match, never LLM-driven

## v1.24.1 — Alert rows: app icon badges

- [x] Alert rows now show a colored app-monogram badge (SO/RA/PR/OV/DL) in place of a poster

## v1.24.2 — Fix alert severity dot touching the title text

- [x] **Fix**: severity dot's className overwrite was dropping its spacing class, pinning it against the title

## v1.24.3 — Fix Alerts action buttons overflowing off-screen on mobile

- [x] **Fix**: alert row action buttons overflowed off-screen on mobile — now wrap to their own line

## v1.24.4 — Fix container running in UTC instead of local time

- [x] **Fix**: container had no `TZ` set, causing Airing Today to show tomorrow's episodes early — set `TZ=America/Chicago`

## v1.24.5 — Add pull-to-refresh for the installed PWA

- [x] Added a manual pull-to-refresh gesture for the installed/standalone PWA (lost natively once installed)

## v1.25.0 — "Search All" for Wanted/Missing

- [x] New "Search All" button triggers Radarr's/Sonarr's own automatic search across every item on the Wanted/Missing list
- [x] New `POST /api/owner/wanted/search-all`, re-derives the list server-side, audit-logged

## v1.26.0 — "Dismiss All" for Alerts

- [x] New "Dismiss All" button for the Alerts panel, confirmed before running
- [x] New `lib/alerts.js` `acknowledgeAll()` + `POST /api/alerts/dismiss-all`

## v1.26.1 — Fix: "Suggest fix" now tries a free local model before Claude

- [x] Suggest-fix now tries a free local Ollama model first, falling back to Claude only on failure

## v1.27.0 — qbit-disk-guard alerts: full removed-file list, expand-on-click

- [x] Disk-guard alerts now include the full removed-file list behind a "See list" expand-in-place toggle

## v1.27.1 — Fix: Import Issues "Remove" no longer deletes the file or blocklists

- [x] **Fix**: Import Issues' Remove button was deleting the actual file and blocklisting the release — now only clears the queue entry

## v1.28.0 — Disk Space trend: sparkline + "days until full" projection

- [x] New `lib/diskSpaceHistory.js`: hourly disk-space history poller with 90-day retention
- [x] New per-volume sparkline + linear-regression "days until full" projection in the Disk Space panel
- [x] **Fix**: found and fixed another cold-start SQLite race on first boot (same class as v1.13.0)

## v1.29.0 — "Because you watched X" personalized recommendations

- [x] New `GET /api/overseerr/recommendations`: personalized strip seeded by each user's own most recent watch
- [x] Walks back through up to 10 recent watches if the most recent has no resolvable TMDB match
- [x] Lives in the request modal above the global Trending list
- [x] **Fix**: the info modal's request-button sync was hardcoded to one results container — generalized to both

## v1.29.1 — Fix: "Because you watched" moved to its own tab

- [x] Moved "Because you watched" from a strip above Trending into its own "For You" tab
- [x] Now shows a real empty-state message instead of rendering nothing
- [x] **Fix**: TV requests from the For You tab incorrectly returned to Search after closing the season picker

## v1.30.0 — Admin: Stream Origins world map

- [x] New CH.11 admin card: a world map of where streams originated this year, from geoIP on new session starts
- [x] Calendar-year window, resets automatically on Jan 1
- [x] Ranked legend below the map with each city's share of the year

## v1.30.1 — Fix: stream-origins startup race

- [x] **Fix**: another cold-start SQLite race, same fix shape as `diskSpaceHistory.js`

## v1.30.2 — Fix: deploy.sh was clobbering the real Traefik domain

- [x] **Fix**: real outage — `deploy.sh`'s rsync was overwriting docker-host's hand-edited real domain in `docker-compose.yml`. Now sourced from `MARQUEE_DOMAIN` in `.env` instead of hardcoded

## v1.31.0 — Fix: Stream Origins was only showing "currently playing"

- [x] **Fix**: Stream Origins was keyed off a reused live session slot, so it only ever reflected whatever was playing when the server was up — rebuilt on Tautulli's real history instead, a genuine year-to-date aggregate
- [x] One-time schema migration + a watermark so the expensive full backfill only ever runs once

## v1.31.1 — Stream Origins: real coastlines instead of abstract blobs

- [x] World map background replaced with real coastline data (Natural Earth GeoJSON, simplified)

## v1.33.1 — Fix SQLite cold-start race in 4 more lib files

- [x] **Fix**: audit found and fixed the same cold-start SQLite race in 4 more files with no prior test coverage

## v1.33.2 — Fix: non-constant-time webhook secret comparisons

- [x] **Fix**: 3 webhook auth checks used plain `!==` instead of constant-time comparison — switched to `timingSafeEqual`

## v1.33.3 — Fix: missing numeric guard on Tautulli metadata route

- [x] **Fix**: one route's numeric path param reached an outbound request unchecked — added the same guard every other route already has

## v1.33.4 — Document 5 env vars missing from .env.example

- [x] Documented 5 env vars that were read in code but missing from `.env.example`

## v1.33.5 — Fix: unbounded Overseerr session cache

- [x] **Fix**: per-user Overseerr session cache had no eviction — added a 24h TTL

## v1.33.6 — Add global default timeout to every outbound request

- [x] Set a global 15s axios timeout so a hung upstream service no longer leaves a request pending indefinitely

## v1.34.0 — Push notification when a request needs approval

- [x] Owner now gets pushed when a new request needs approval (`MEDIA_PENDING`), not just when media becomes available

## v1.35.0 — Approve specific seasons instead of all-or-nothing

- [x] New season-picker modal on the admin Requests panel — approve just some seasons of a TV request instead of all-or-nothing

## v1.35.1 — Fix: POST /request skipped the seasons-shape validation

- [x] **Fix**: added the same seasons-shape validation the sibling PUT route already had

## v1.35.2 — Fix: no rate limit on /discover, /recommendations, or SSE clients

- [x] **Fix**: added rate limits to `/discover` and `/recommendations`, and a 50-connection cap on SSE clients

## v1.35.3 — Fix: alert-ingest fields flowed unescaped into the LLM prompt

- [x] **Fix**: alert title/detail now delimiter-wrapped before reaching the Suggest-fix prompt (low-severity, no tool access)

## v1.35.4 — Fix: Plex auth token stored in plaintext in sessions.sqlite

- [x] **Fix**: the real Plex auth token was stored in plaintext in the session store — now field-level AES-256-GCM encrypted

## v1.36.0 — Issue-report status tracking ("My Reports")

- [x] New `GET /api/overseerr/issues/mine` + "My Reports" tab — see your own issue reports and their status (open/in-progress/resolved)

## v1.36.1 — Fix: report flag itself wasn't color-coded

- [x] The Report FAB's flag icon itself now color-codes by your reports' resolution status, not just the tab's rows

## v1.36.2 — Fix: My Reports tab didn't scroll

- [x] **Fix**: two new tab panes were missing from the modal's flex-sizing selector list, so their inner lists didn't scroll

## v1.37.0 — Auto Fix: one-click replacement for a reported issue

- [x] New one-click "Auto Fix" next to the manual Search flow on Open Issues — finds a release, grabs it, tracks it, resolves the report
- [x] **Fix**: found and fixed a bug where the 30s issues poll would wipe the whole list mid-auto-fix

## v1.38.0 — Auto Fix runs automatically on report, not just on click

- [x] Auto Fix now fires automatically the moment a playback-related issue is reported, not just on manual click
- [x] New `lib/autoFixIssue.js` server-side orchestrator, dedup guard for duplicate reports of the same broken episode
- [x] Owner gets pushed only when something needs a human (no eligible release, import failure, stuck grab)

## v1.38.1 — Fix: Suggest-fix's primary tier no longer depends on a Mac mini

- [x] Suggest-fix's primary completion tier switched from a local Ollama model to Antigravity/Gemini through the existing proxy

## v1.38.2 — Fix: CI has been failing on every push since Auto Fix shipped

- [x] **Fix**: CI had been failing on every push for weeks — a gitignored local-only file crashed the whole test file on a fresh clone. Wrapped in a try/catch fallback

## v1.39.0 — Alerts panel: one-click Auto-fix for dead qBittorrent torrents

- [x] New one-click "Remove N dead torrents" button on Alerts for missing-files qBittorrent torrents (never for unregistered — always a manual call there)
- [x] New `action_data` column on alerts for structured per-alert action payloads

## v1.40.0 — Notice Board mirrors onto the Plex Home screen via Kometa

- [x] Posting/clearing the Notice Board now also writes a Kometa collection YAML, mirroring the announcement onto the Plex Home screen
- [x] Opt-in and off by default (`KOMETA_CONFIG_DIR`), registered in Settings like every other optional integration

## v1.41.0 — Invite to Plex: per-library sharing + a real welcome email

- [x] New owner-only Invite to Plex Settings tab — invite by email with access to exactly the libraries checked, manage/edit/revoke existing shares
- [x] New `lib/plexShare.js`, `lib/inviteStats.js`, `lib/welcomeEmailTemplate.js`, `routes/invite.js`
- [x] **Fix**: found and fixed a real bug before shipping — the shares list was filtering on a field that doesn't actually identify the owner's row
- [x] Write calls (invite/edit/revoke) deliberately shipped unverified against the live Plex API, pending a real first invite

## v1.41.1 — Fixed the real Plex invite/update/revoke API shape

- [x] **Fix**: the real Plex invite/update/revoke API shape was wrong — found the actual host + auth style by capturing Plex's own web app performing a real invite
- [x] `lib/plexShare.js` rewritten around the confirmed-real `clients.plex.tv` v2 API
- [x] Completed the first real invite live; welcome email now carries the real Plex accept link

## v1.41.2 — Fixed the shares list crash, caught by testing the actual tab

- [x] **Fix**: the shares list silently crashed client-side — `normalizeShare()` now returns `id` as a string, not a raw number
- [x] Added a regression test that actually catches the type, not just the value

## v1.42.0 — Privacy & Visibility: control what family members see of each other

- [x] New owner-only Settings tab controlling what non-owners see of each other in Now Playing/Top of the Month, with 3 one-click presets
- [x] New `lib/privacy.js`, adapted from a community fork to this app's real data shapes, not ported as-is
- [x] **Fix**: live SSE Now Playing updates had no per-client filtering at all — `lib/sse.js` now supports per-client sanitization
- [x] **Fix**: caught before shipping — `thumb` is the media poster here, not a user avatar; the fork's approach would've blanked posters for no reason

## v1.42.1 — Fix: Kometa always showed "Unconfigured" in Settings regardless of real state

- [x] **Fix**: Kometa had a Settings card but no entry in `serviceHealth.js`'s check map at all — always fell back to "Unconfigured" even with `KOMETA_CONFIG_DIR` genuinely set. Added `checkKometa`, verifying the real mounted config path is writable.

## v1.43.0 — Theme picker: 5 presets, sitewide, persisted per browser

- [x] New theme button (both pages) opens a picker — 5 presets (Marquee Glass, Midnight Cyber, OLED Pure Black, Nordic Slate, Sunset Amber), persisted via localStorage, applied instantly with no flash on reload
- [x] Adapted from the same community fork as v1.42.0, not ported as-is — real per-element CSS audit of ~26 hardcoded backgrounds (converted real surfaces like modals/inputs/cards to theme variables; deliberately left photo-overlay chrome like the hero icon buttons hardcoded, since inverting those would look wrong sitting on arbitrary poster art)
- [x] Verified live across all 5 themes, both pages, and inside the Settings modal

## v1.43.1 — Fix: Invite to Plex was 404ing on every real invite

- [x] **Fix**: root cause was `librarySectionIds` needing the cloud API's own numeric library id (e.g. `131025743`), not the local server's small section `key` (e.g. `1`) every read in this file already used — a structurally valid but semantically wrong request, silently rejected as "not found." New `getLibraryKeyToCloudId()`/`toCloudLibraryIds()` translate before every write.
- [x] **Fix**: the invite request body itself was also wrong (missing `skipFriendship`, `allowSubtitleAdmin`, `filterPhotos`; `allowSync` defaulted false) — never actually verified against a real request body before, only the host/auth style. Fixed by intercepting fetch/XHR in the browser to capture Plex's own real request.
- [x] **Fix**: `updateShareLibraries()` was never live-tested at all — real method is `POST` to `shared_servers/{id}`, not `PUT` (405s), and must round-trip the share's *current* settings or it silently resets them.
- [x] All three write operations (invite/update/revoke) now confirmed working via this app's own code against the real live API, not just via the browser.

## v1.43.2 — Mask emails in the Invite to Plex shares list

- [x] Current Shares now shows a masked email (e.g. `c***0@hotmail.com`) instead of the full address — less exposed on a shared screen or screenshot

## v1.44.0 — Stream Origins: time-range toggle, counts, hover detail, medal ranks

- [x] New 30D/90D/YTD toggle (was hardcoded to year-to-date)
- [x] Legend now shows raw stream counts alongside percentage, not just percentage
- [x] Hover a map point or legend row for a detail tooltip; the two cross-highlight each other
- [x] Top 3 locations get gold/silver/bronze medal styling (color + 🥇🥈🥉), reusing the same convention as Top of the Month
- [x] `pruneOld()` changed from resetting every Jan 1 to a rolling ~13-month retention, so 90D stays accurate year-round instead of truncating in Jan-Mar

## Ideas
