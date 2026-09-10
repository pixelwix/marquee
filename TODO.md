# Roadmap

Every shipped feature or fix gets its own version bump now (`package.json`
+ `package-lock.json`) and its own section here — no more letting the
version drift unversioned between batches. One bump per shipped unit of
work: a new capability bumps minor, a fix bumps patch. `git commit`/push
themselves now batch to every 10th shipped unit instead of running every
time (version bumps, TODO.md sections, and live deploys still happen every
time regardless — only the git commit action batches). **Current version:
 v1.59.3.**

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

## v1.45.0 — Stream Origins: sparkline arcs to server, state/region in labels

- [x] New `SERVER_LAT`/`SERVER_LON` deployment setting (optional) — when set, map draws an animated arc from each origin to that point instead of plain heat blobs
- [x] Legend/tooltip place labels now include state/region (e.g. "Saint Paul, US"), not just city/country
- [x] Unset `SERVER_LAT`/`SERVER_LON` falls back to the original heat-blob rendering unchanged
- [x] Added `ALL` to the range toggle (was 30D/90D/YTD only)

## v1.45.1 — Fix: hero header broken on mobile

- [x] Headline wrapping to 2 lines pushed the FEATURED tag past `.hero-mid`'s fixed 112px, clipped by `.hero`'s fixed 220px + overflow:hidden — both switch to `height: auto` under 480px
- [x] A long FEATURED title pushed the date pill off-screen instead of ellipsizing — the text block had no `min-width: 0`, so the flex row refused to shrink below its content width

## v1.46.0 — Stream Origins map auto-frames to where the data actually is

- [x] viewBox now auto-crops to the bounding box of the real points (+ server point) instead of always showing the full 720x360 world canvas — a region-clustered deployment (e.g. all-US) now fills the frame instead of mostly showing empty ocean
- [x] Purely data-driven, not hardcoded to any region — a deployment with genuinely global viewers still gets the full spread

## v1.47.0 — Push notifications for family members, not just the owner

- [x] `/api/push/subscribe`, `/unsubscribe`, `/vapid-public-key` no longer owner-only — any signed-in family member can turn on notifications for their own account
- [x] New bell icon on the family dashboard (`#notify-toggle-btn`), same subscribe flow as the existing admin one
- [x] `push_subscriptions` schema scoped per-user (`user_id`/`is_owner` columns, migrated from the old owner-only table) — `notifyOwners()` unchanged, new `notifyUser(userId, ...)` targets one person's own devices
- [x] Overseerr's `MEDIA_AVAILABLE` webhook now pushes "Your request is available" to the actual requester (resolved via `loginLog.findUserIdByUsername`), not just the in-app SSE toast

## v1.48.0 — "Just Mine" filter on Airing Today / Releasing Soon

- [x] Airing Today's toggle filters to shows you've actually watched before (per Tautulli history)
- [x] Releasing Soon's toggle filters to movies you personally requested (per Overseerr) — deliberately not watch history, since an upcoming movie is by definition unwatched
- [x] Both off by default; state doesn't persist across a reload

## v1.49.0 — My Requests now flags genuinely stuck requests

- [x] An approved/downloading request now shows "Stuck — released Xd ago, still searching" instead of sitting at "Approved" forever, when Radarr/Sonarr's own Wanted/Missing list confirms it's actually stuck (same threshold the owner's admin panel already uses)

## v1.49.1 — Fix: logout button pushed off-screen on mobile header

- [x] **Fix**: notify/theme/admin icon buttons + avatar chip + logout button didn't fit one row on a real phone (worse for admins, extra icon) — logout-btn was pushed past the viewport edge, unreachable. Shrunk `.icon-btn`/`.avatar-chip`/`.avatar`/`.avatar-name` under the existing 900px breakpoint instead of hiding/moving anything further.

## v1.49.2 — Fix: avatar chip scale + logout arrow centering, found via live mobile check on v1.49.1

- [x] **Fix**: avatar chip's name/role text stayed full-size while the icon buttons around it shrank in v1.49.1, reading oversized next to them — shrunk `.avatar-name`/`.avatar-role` font sizes under the same mobile breakpoint
- [x] **Fix**: logout button's `&#8594;` HTML entity rendered visibly off-center in its circle (asymmetric glyph metrics, not a centering bug) — replaced with the same stroke-based SVG icon pattern already used by the other header icon buttons, on both the family dashboard and admin page

## v1.49.3 — Fix: admin page's back arrow didn't match the new logout arrow style

- [x] **Fix**: admin header's back-to-dashboard button still used the raw `&#8592;` HTML entity (same off-center-glyph issue as the old logout arrow) — replaced with the matching stroke-based SVG arrow so both icon buttons render consistently

## v1.50.0 — Stream Origins: real geolocation instead of a local database

- [x] Switched from `geoip-lite` (free bundled database, ~94% of city-less lookups also had no region) to a live lookup, per owner request after noticing Tautulli's own IP lookup resolves real cities/ISPs it couldn't
- [x] New `geo_cache` table — one lookup per distinct IP ever seen, permanent (no TTL), so this stays a one-time cost per IP, not per-session or per-sync-run
- [x] `geoip-lite` dependency removed entirely
- [x] Sync watermark reset on deploy so the existing year-to-date history actually re-resolves through the new source too, not just new sessions going forward

## v1.50.1 — Fix: switched Stream Origins' geo source from ipapi.co to Tautulli's own lookup

- [x] **Fix**: first shipped against `ipapi.co` (a new third party) — hit its free-tier burst rate limit almost immediately during the year-to-date backfill (no throttling at all between calls)
- [x] **Fix**: separately, `ipapi.co` turned out to be on HaGeZi's Ultimate Blocklist (one of this deployment's own AdGuard filters), sinkholed to `0.0.0.0` — every lookup was failing before rate-limiting even became relevant
- [x] Root-caused better: Tautulli already maintains its own real MaxMind GeoLite2 database for its own IP-lookup UI feature, exposed via its `get_geoip_lookup` API command — switched to that instead of a new third party entirely. No new service ever sees a viewer's IP (Tautulli already did, it's the source of `ip_address` in the first place), no external rate limit, no blocklist risk
- [x] Confirmed `get_history` (already polled every sync) does NOT embed geo fields — a dedicated per-IP `get_geoip_lookup` call is genuinely required, verified live before committing to the approach

## v1.51.0 — Stream Origins: who streamed from where, not just where

- [x] `stream_origins` gets a `username` column, attributed from `get_history`'s own `friendly_name`/`user` (same convention as `nowPlaying.js`'s live feed) — no new Tautulli call needed, it was already in the synced rows
- [x] `topLocations()` now returns each place's per-user breakdown (`users: [{name, count}]`, most-streams-first), folding unattributed legacy rows into an "Unknown" bucket rather than erroring
- [x] Legend row gets a terse "who" byline under the place name (first 3 names, "& N more" beyond that); the hover tooltip carries the full per-user counts
- [x] Owner-only surface, unchanged — `nowPlaying.js`'s shared family feed still never carries this data

## v1.51.1 — Fix: GitHub Actions failing on record()'s live geo-lookup tests

- [x] **Fix**: 2 `streamOrigins.test.js` tests assert `record()` against a real IP, which now requires a live call to this deployment's own Tautulli (see v1.51.0's `friendly_name`/`user` sourcing, and the underlying v1.50.0 switch off `geoip-lite`) — CI has no `TAUTULLI_URL`/`TAUTULLI_API_KEY` and never will, so these could never pass there
- [x] Skipped (not mocked, matching this app's existing no-mock-Tautulli convention) via `test.skip` when the credentials aren't set — runs for real inside the deployment where the credentials exist

## v1.51.2 — Fix: streamOrigins test asserted a claim Tautulli's geo lookup doesn't actually honor

- [x] **Fix**: `record() skips IPs...` used the RFC 5737 TEST-NET-1 address as a stand-in for "an unresolvable public IP" — true of the old `geoip-lite` database, not reliably true of Tautulli's own live `get_geoip_lookup` (confirmed live: it doesn't treat that address as unmappable)
- [x] Rewrote to assert what the code actually guarantees unconditionally: a missing IP or an RFC1918 private-range IP never reaches `lookupGeo()` at all (`isPrivateIp()`'s own job) — deterministic in every environment, verified passing both with and without real Tautulli credentials

## v1.52.0 — Outdated-service detection in the Settings > Services grid

- [x] Sonarr/Radarr/Prowlarr: read their own native `/api/*/update` endpoint (Servarr apps already know installed-vs-latest, no need to re-derive it) — verified live, all three correctly reported up to date
- [x] Overseerr: its existing `/api/v1/status` call already returns `updateAvailable`/`commitsBehind` directly, just wasn't being surfaced
- [x] Plex: no public "latest version" API of its own (closed-source) — rides on Tautulli's `get_pms_update`, which already tracks this for its own UI. Verified live: correctly flagged 1.43.3 → 1.43.4 available
- [x] Tautulli, qBittorrent, SABnzbd: no built-in update-check API — falls back to each project's own GitHub releases (`releases/latest`), cached 12h in memory to stay well clear of GitHub's unauthenticated 60/hr rate limit. Verified live: correctly flagged Tautulli (2.17.2 → 2.18.0) and SABnzbd (5.1.1 → 5.1.2) outdated, qBittorrent up to date
- [x] "Update available" badge on the existing service card, fetched once per Settings-modal session (not on every "Run Health Check" click, since GitHub/native-update calls are slower than the local health pings)

## v1.53.0 — Cleanup Candidates: movies quietly taking up space, unwatched

- [x] New Stack panel section — ranks movies by reclaimable size, flagging never-watched-past-a-60-day-grace-period and watched-once-180+-days-ago, using Tautulli's own `get_library_media_info` (file_size/last_played/play_count already computed there per item)
- [x] TV deliberately out of scope for now — the same Tautulli endpoint returns show-level rows with those fields blank for TV sections; rolling them up ourselves from per-episode rows is real additional work, left as a known follow-up rather than shipped half-verified
- [x] Read-only report, no delete action — actually removing a file is a separate, more consequential feature
- [x] Loaded once on page load, no recurring poll (watch history/file sizes don't shift minute to minute, and the underlying Tautulli call returns thousands of rows)
- [x] Live-verified: 3,810 of 4,921 movies qualify on this deployment's actual library — a real fact about a large, mostly-speculative back-catalog, not a bug (the never-watched rule and the 180-day stale-rewatch rule were each independently verified against known rows)

## v1.53.1 — Fix: Cleanup Candidates was making the admin page too long

- [x] **Fix**: the inline top-20 list (v1.53.0) still added a real chunk of page length to an already-dense admin view, worse on a library where most of it qualifies (3,810 of 4,921 movies here)
- [x] Card now shows only a one-line summary (count + total reclaimable size) with a "View list" button — the full ranked list moved into a modal, same pattern as the existing Release Search modal, so the page itself stays short regardless of how many candidates there are

## v1.53.2 — Wanted/Missing gets the same list-in-a-modal treatment

- [x] Same pattern as v1.53.1's Cleanup Candidates fix: the reconciled row list moved into a modal (View list button), main page now shows just a one-line summary ("N missing · M overdue")
- [x] Search All and its status line stay on the main page (unchanged) — that's a bulk action independent of browsing the list
- [x] Per-row Search button and the click-through-to-poster/overview info popup both still work exactly as before, just inside the modal now — reconcileList() still runs against the modal's list container on every 60s poll whether or not the modal is open, so it's always current the moment it's opened

## v1.53.3 — Fix: release-search modal opened behind the Wanted/Missing list modal

- [x] **Fix**: v1.53.2 moved the Wanted/Missing row list into its own modal, but its per-row Search button opens `release-modal` on top of it without closing it first — both share `z-index: 20`, so which one visually wins is decided by DOM order, and `release-modal` was defined earlier in the HTML than the new list modal, so it lost
- [x] Moved `release-modal`'s markup to be defined last among content modals (only the generic confirm dialog comes after it), so it reliably stacks on top of whatever modal it's launched from — Wanted/Missing's list, its info popup, issue suggestions, etc. — instead of relying on each new modal happening to be added earlier in the file

## v1.54.0 — "Find & Download" — search for new media directly from the Stack panel

- [x] New search box under Search Library: searches TMDB/TVDB via Radarr's/Sonarr's own `lookup` endpoints (not Overseerr) — a single query surfaces both what's already tracked and what isn't, unlike Search Library above which only ever matches the existing library
- [x] Already-tracked hits jump straight into the same release-search modal / season-episode picker Search Library uses (movies straight to release search, TV through the same season → episode drill-down)
- [x] Untracked hits go through a new "Add to library" confirm step first (quality profile, plus root folder for TV) before landing in that same flow — added as monitored with `searchForMovie`/`searchForMissingEpisodes: false` so the owner picks the exact release themselves instead of waiting on Radarr's/Sonarr's own automatic search
- [x] Quality-profile and root-folder defaults are computed live from what the existing library actually uses most, not just whichever Radarr/Sonarr happens to list first — verified live this matters for Sonarr specifically, which splits TV across 4 root folders (`/tv`, `/tv2`, `/tv3`, `/anime2`) where the literal first one returned is actually the least-used
- [x] Sonarr queues its own `RefreshSeries` on add and populates episodes ~2s later (verified live) rather than instantly — the season/episode picker retries briefly instead of assuming the episode list is ready right away

## v1.54.1 — Fix: Find & Download's search box was unstyled + season packs

- [x] **Fix**: the new `#find-media-input` box from v1.54.0 wasn't included in the CSS rule styling `#library-search-input`/`#search-input`/`#report-search-input`, so it rendered as a bare unstyled browser input instead of matching the rest of the panel
- [x] Season list (used by both Search Library and Find & Download) gets its own Search button per row, for searching a whole season at once — Sonarr's `/release` endpoint tells a season-pack search apart from a single-episode one by which params it gets (`seriesId`+`seasonNumber` alone vs. adding `episodeId`); season-pack results come back flagged `fullSeason` and get a badge in the results list since they're now mixed in with per-episode releases
- [x] Grabbing a season pack reuses the exact same grab endpoint (Sonarr doesn't care whether a release is a pack or a single episode), but status tracking is aggregated across every queue record for that series+season rather than the single-episode match used everywhere else — a season pack shows up as one queue record per episode inside it, verified live

## v1.54.2 — Fix: Kometa never actually built the Server Announcement collection

- [x] **Fix**: `buildKometaYaml()` generated `plex_search: any: added.gte: 30`, treating Kometa's `added.gte`/`.after` filter as "N days" — it's actually "on or after this calendar date" and requires `YYYY-MM-DD`. Every real Kometa run rejected it with `Collection Error: added.after: 30 must match pattern YYYY-MM-DD`, so the announcement collection silently never built despite Marquee reporting the notice as posted — caught live 2026-08-27 watching a real scheduled Kometa run process it
- [x] Now computes an actual date 30 days before the write (`now` param, defaults to `Date.now()`, same pattern as `computeStatus`) — keeps the original "match anything recently added" intent, just as a real date Kometa accepts

## v1.55.0 — Server Announcement gets a real poster instead of a random movie's

- [x] A Plex Home hub row only ever shows a collection's title + poster, never its summary — so the announcement message itself was never actually visible on Home, just "📌 Server Announcement" over whatever random movie the `plex_search` filter happened to grab (e.g. "Above and Below")
- [x] `lib/notice.js` now renders the actual notice message as an SVG text card (dark background, amber border, wrapped and auto-shrunk to fit any length up to the 500-char cap) via `sharp`, and points the collection's `file_poster` at it — same lifecycle as the existing YAML mirror: regenerated on every post, removed when the notice is cleared
- [x] Added `sharp` as a dependency; Dockerfile now installs `fontconfig ttf-dejavu` at runtime (not just build time) — without a real font, sharp's SVG rendering (via librsvg) has no glyphs and text silently renders as empty boxes
- [x] Investigated moving the announcement above Trending Movies on Home — not possible. Confirmed via Plex's own `/hubs/promoted` API that hub order is fixed by Plex Media Server itself (dynamic library hubs always before promoted custom collections); no UI or documented API exposes reordering that

## v1.55.1 — Fix: a season-pack drop spammed the same episode over and over

- [x] **Fix**: a batch of newly-aired episodes all hitting Sonarr's "TBA title" import rejection at once (very common right after a season-pack drop) left Sonarr's own queue with several simultaneous records for the SAME episode — the pack's own file, plus another release Sonarr's automatic search grabbed later because the episode still looked missing while the first stayed stuck. Both the Import Issues list and the Alerts panel showed the identical episode repeated once per competing download — verified live against a real "Beauty in Black" S3 drop that produced exactly this (8 episodes, several 2-3x over)
- [x] `lib/sonarrClient.js`'s `fetchImportQueue` now groups by episode (new pure `groupQueueRecordsByEpisode` in `lib/grabStatus.js`, unit tested) — one row per episode; Remove now clears every underlying queue id in the group, Force Import resolves the episode via whichever download Sonarr matched first
- [x] Alerts panel's own dedup key was a second, independent bug: it used Sonarr's own queue-record id, which Sonarr can and does recreate for the same still-stuck episode across polls — churned the key and piled up duplicate "new" alerts instead of updating one ongoing alert in place. Now keyed on the stable `episodeId`

## v1.56.0 — Server Announcement actually shows on Home now, not a random movie

- [x] Root cause of yesterday's "still just shows Above and Below" complaint: a Plex Home hub row for a collection always renders its *member items'* own posters/titles, never the collection's own artwork — true for every collection-based Home row (confirmed live against "Trending Movies This Week" too), not fixable by any collection-level setting. The v1.55.0 poster was correctly generated and applied, just to a field Home structurally never displays
- [x] Fixed properly: created a real, dedicated placeholder movie ("Server Announcement", a tiny local unmatched video file dropped directly into the Movies library folder) and pointed the Kometa collection's `plex_search` at it by exact title instead of "grab whatever was recently added" — so the Home row now always shows this one fixed item instead of a random real movie
- [x] The actual per-message poster upload moved off Kometa's schedule entirely — `lib/notice.js` now pushes the rendered PNG straight to the placeholder movie's own Plex poster the moment a notice is posted, using the same raw-bytes upload python-plexapi's `uploadPoster()` does internally (confirmed by reading Kometa's own installed plexapi source). Updates are now instant instead of waiting up to ~12h for Kometa's next scheduled run; Kometa still owns creating/removing the collection itself on post/clear

## v1.56.1 — Server Announcement collection updates within ~60s of posting/clearing

- [x] The poster/message content already updated instantly (v1.56.0), but the Plex *collection* itself — what actually makes the Home row appear or disappear at all — still only rebuilt on Kometa's own schedule, up to ~12h away. Posting a bulletin could update its text immediately while the row itself hadn't shown up yet
- [x] `lib/notice.js` now drops a flag file (`.announcement-changed`) in the shared Kometa config mount on every post/clear. Marquee's own container has no Docker socket access and can't trigger Kometa itself, so a new host-side cron script (`scripts/kometa-announcement-trigger.mjs`, `* * * * *`, matching the existing `qbit-*.mjs` pattern) polls for it and runs a scoped `kometa --run --run-collections "📌 Server Announcement" --libraries Movies` — verified live at ~9-11s — instead of waiting for a full run
- [x] Chose this over a Docker-socket-mounted watcher container specifically to avoid giving any always-on service that kind of host access for a cosmetic feature — worst case here is a ~60s poll lag, not a new privilege surface

## v1.56.2 — Fix: clearing a bulletin left it stuck showing on Plex

- [x] **Fix**: the scoped `--run-collections "📌 Server Announcement"` trigger (v1.56.1) only works when the collection is still *defined* — on clear, `marquee-announcement.yml` goes to `collections: {}`, so there's nothing left by that name for a scoped run to match, and Kometa silently did nothing. Deleting an orphaned collection is normally part of Kometa's full per-library cleanup pass, which a single-collection scoped run never triggers. Verified live: a real clear left the collection sitting in Plex indefinitely, still showing the last message, no error anywhere
- [x] `lib/notice.js` now deletes the collection directly via Plex's API the moment a notice is cleared, instead of routing through Kometa at all for this part — looked up by title each time (`GET /library/sections/1/collections`), then a plain `DELETE /library/metadata/{ratingKey}`. Confirmed live this removes only the collection object; the placeholder movie itself is untouched and ready for the next message

## v1.56.3 — Fix: cleared-notice state was raising a real Kometa error every run

- [x] **Fix**: `collections: {}` looked like the obvious way to say "no notice active," but Kometa treats an empty dict as invalid, not as "none defined" — any file referenced under `collection_files:` must have a genuinely non-empty `collections`/`dynamic_collections` attribute. This raised `YAML Error: collections or dynamic_collections attribute is required` as a real `[ERROR]` on every single run while no notice was posted (i.e. most of the time) — found via a full audit of Kometa's logs, confirmed against Kometa's own source (`not self.collections` in `meta.py`, true for `{}`)

## v1.56.4 — Fix: the v1.56.3 fix traded one Kometa error for a different one

- [x] **Fix**: v1.56.3's `plex_search` guaranteed to match nothing turned out to raise its own real `[ERROR]` every run while cleared — `Failed("Plex Error: No Items found in Plex")` (`modules/plex.py`), confirmed live in a fresh Kometa run's logs. Fixed by switching the empty state to `schedule: never` (the same mechanism already used for Manga Canon's `hourly(10)`) — Kometa's schedule check raises `NotScheduled` before any `plex_search` is ever evaluated, and that's logged with `logger.info()`, not `logger.error()`, confirmed in Kometa's own exception handling in `kometa.py`. Added `delete_not_scheduled: false` since this app's direct Plex delete on clear (v1.56.2) already handles removal
- [x] **Second fix, same version**: `schedule: never` alone isn't safe on the near-instant `--run-collections` trigger path (`scripts/kometa-announcement-trigger.mjs`) — confirmed live and in Kometa's own source (`builder.py`) that `--run-collections` sets `config.requested_collections`, which makes Kometa skip the `schedule` check entirely, so a schedule-only collection block hits a *third* real error, "Collection Error: No builders were found". Fixed by no longer triggering that fast path on clear at all (`clearKometaAnnouncement` stopped calling `touchAnnouncementTrigger()`) — the direct Plex delete already removes the collection instantly, and `schedule: never` only ever needs to be seen by Kometa's own regular/scheduled full runs, where it works correctly
- [x] Cosmetic, not functional — the collection already correctly stayed off Plex either way (this app deletes it directly, see v1.56.2) — but permanent noise in Kometa's own error reporting. Fixed by keeping a real collection block whose `plex_search` is guaranteed to never match anything, instead of an empty dict; Kometa's own `minimum_items` floor then just never (re)creates it — this also gives a harmless fallback if this app's direct Plex delete on clear ever failed silently

## v1.57.0 — Origins map can now be turned off from Settings

- [x] Added a toggle (Settings -> Privacy & Visibility, next to the Strict/Family/Full Open presets) to show or hide the CH.11 Stream Origins map entirely — some owners don't want a live geo-map of where family members are streaming from on the admin dashboard at all
- [x] `PRIVACY_ORIGINS_ENABLED` (default on/unset) is checked server-side at startup — when off, the whole `#panel-origins` section and its `originsWorldPath.js` coastline-data script are stripped out of the rendered admin page entirely, not just hidden client-side. Same save-writes-.env-then-restarts flow as the other four privacy settings
- [x] `admin.js`'s origins polling (`loadOrigins()` + its 60s interval) now guards on `#panel-origins` actually existing in the page, since it won't when this is off

## v1.57.1 — Fix: monthly recap send falsely reported "failed" even when it fully succeeded

- [x] **Fix**: `POST /api/recap/send` stayed open for the entire real send — per-recipient Tautulli data fetch plus the mandatory ~2s-throttled email send (Tautulli's Email notifier has no per-recipient override, sends can't be parallelized) — confirmed live on a real 38-recipient send that this takes ~3.5 minutes end to end. The browser/network gave up long before that, showing "Send failed" even though the server had zero errors and completed every send successfully (confirmed after the fact via `recap_send_attempts`)
- [x] Split into a fast synchronous claim phase (responds immediately with `{queued, skipped}`) and a background phase that does the actual data-fetch-then-throttled-send work — a double-click still can't send the same person twice, since claiming (not sending) is what happens before the response
- [x] Admin UI now says "Queued N — sending now in the background" and auto-refreshes Recent Send History at 30s/90s/3min/5min so results show up without reopening the tab

## v1.57.2 — Fix: recap email always said "Evening" regardless of when it was actually sent

- [x] **Fix**: the recap's greeting line ("Evening, Name — the projector's been running hot...") was hardcoded, not derived from the actual send time — visibly wrong for a recap sent mid-afternoon (confirmed live via a real recap received at 12:23pm still saying "Evening")
- [x] New `timeOfDayGreeting()` in `lib/monthlyRecapTemplate.js` picks Morning/Afternoon/Evening/Night from the actual local time at render — computed per recipient, not once for the whole batch, so a large batch spanning real wall-clock time (see v1.57.1) now gets an honest greeting for whoever it actually reaches at that moment

## v1.57.3 — Code review hardening for the v1.57.1/v1.57.2 recap fixes

- [x] **Fix**: a careless global `sed` while hand-editing a "Current version" mention had also corrupted the real `## v1.57.0` changelog heading further down into a mangled duplicate `## v1.57.2.—`, and the three newest version entries had landed after the trailing `## Ideas` section instead of before it. Restored the correct heading and file ordering
- [x] The background recap-send job now has a startup-time reconciliation sweep (`recapSendLog.reconcileAbandoned()`, called once in `server.js` before any request can claim anything) — if a redeploy interrupts a batch mid-send, every recipient still marked `sending` from a dead process is immediately flipped to `failed` with a clear reason, instead of sitting silently until some unrelated later attempt happens to reclaim it (which, for a given month, might never happen)
- [x] A failed Uptime Kuma lookup mid-batch now logs plainly which batch and how many recipients will render without the Service Status section, instead of silently falling back to `null` with zero record anywhere that content was dropped
- [x] The background job's final summary log now counts a recipient who failed during data-fetch/render the same as one who failed at the actual send step — previously only the latter were counted as "failed", understating real failures in the operator-facing log line (the per-attempt DB record was always correct either way)
- [x] Recent Send History's refresh after a send now polls until every queued recipient actually leaves `sending` (or 10 minutes pass), reusing the same poll-until-terminal shape as `trackGrab`/`trackAutoFix` elsewhere in this file — replaces four fixed one-shot timers that couldn't stop early for a small batch, couldn't keep going past 5 minutes for a large one, and stacked redundant timers on a second send within that window
- [x] Removed a wrong code comment citing "arr-health-watchdog.mjs's restartBlipFor" as an in-repo precedent — that script lives outside this project entirely and doesn't exist anywhere in Marquee
- [x] `timeOfDayGreeting()` now pins its timezone explicitly (`RECAP_TIMEZONE` env var, defaulting to `America/Chicago`) via `Intl.DateTimeFormat` instead of reading the process's raw local hour — previously depended entirely on `docker-compose.yml`'s `TZ` var being present; a future deploy path that dropped it would have silently reverted to UTC and shifted every greeting by 5-6 hours

## v1.57.4 — Fix: a real recap email got clipped/mangled by Gmail

- [x] **Fix**: a user reported their recap arriving with all styling stripped, stats stacked as plain unlabeled text — Gmail clips any message over ~102KB and renders a stripped fallback. Measured the real email: 625KB total, 98% of it one embedded headliner image. Tautulli's `pms_image_proxy` resizes the image but doesn't normalize format, and had handed back a PNG straight from Plex's own stored art file for this title — PNG's lossless compression on photographic backdrop art runs 5-7x larger than the equivalent JPEG at the same pixel dimensions (measured: 472KB as PNG, 66-95KB as JPEG at quality 70-85 for the same image)
- [x] `fetchHeadlinerImage` now always re-encodes to JPEG via `sharp` (already a dependency) regardless of what format Tautulli hands back, trying a quality ladder (75/60/45/30) and capping the final base64-encoded size at 75KB — comfortably under Gmail's threshold alongside the rest of the template's own ~11-20KB. Still oversized at the lowest quality, or an outright fetch failure, both degrade to the existing plain-gradient header rather than ever risking another clipped email
- [x] Verified live across 6 real recipients' actual August recaps (previously up to 625KB) — all now land between 10.8KB and 85.9KB, most keeping a real header image

## v1.58.0 — "Played By": who's watched this title, in the media info popup

- [x] The media info modal (Now Playing / Recently Watched — the two entry points that carry a real Plex rating key) now shows a row of circular avatar chips under the stream details: everyone in the household who's watched this exact title, with their play count on hover. A TV rating key resolves up to the show (`grandparent_rating_key`) before querying, the same grouping `computeHeadliner` (lib/monthlyRecap.js) uses — Tautulli's `get_item_user_stats` only counts plays of the *exact* key it's given, and "played by" for a show should mean "has watched this show," not "has watched this specific episode"
- [x] New route: `GET /api/tautulli/played-by/:ratingKey`, backed by Tautulli's `get_item_user_stats` (verified live against real data first — same field shape as Top of the Month's leaderboard: `friendly_name`/`user_thumb`/`total_plays`). Reuses the existing `statsLeaderboard` privacy setting (lib/privacy.js) rather than adding a new toggle — this is the same category of exposure as that leaderboard, who watched what and how often
- [x] A user with no avatar (an anonymized privacy entry, or a real account that never set one, or a broken image URL) falls back to a colored initial-letter chip instead of a blank/broken image — color picked deterministically per name from the app's existing accent/medal tokens (teal/amber/gold/bronze/silver), not a new palette

## v1.58.1 - Fix: stack-alert push notifications were too noisy

- [x] Per-source push policy in `lib/alerts.js` (`planPush`, tested). Reconciliation and the /admin Alerts panel are unchanged - this only governs whether a *push* fires. `downloads:attention` and Sonarr/Radarr `wanted` are now **silent** (ongoing status, not incidents - a torrent parked 20 min or an episode the internet does not have yet should not page; genuinely broken downloads are still caught by qbit-error-torrents / qbit-disk-guard). Sonarr/Radarr `import` is **persist-gated**: only pushes once the same stuck import has stayed open >=10 min, so transient grab races clear silently. Everything else (health, log-triage, proxmox cluster, disk-guard, error-torrents, overseerr issues, uptime-kuma, sabnzbd cleanup) pushes on first sight as before.
- [x] New `pushed_at` column on the alerts table (CREATE + idempotent ALTER, same pattern as `action_data`) so a persist-gated alert cannot re-push on every subsequent touch; cleared on reopen so a resolved-then-recurring one re-qualifies.

## v1.58.2 - Stack-alert noise filter + two new one-click fixes

- [x] arr-health-watchdog.mjs: flappy /health entries (indexer + download-client availability) are now held until the same one shows up on two consecutive runs before alerting, and a "qBittorrent/SABnzbd unavailable" health entry is suppressed entirely while that container is inside its post-Watchtower-restart window (same restart-blip logic the log-triage path already used). "Could not reach <app>" is held one run too. New `classifyHealthEntry` pure fn + tests; state file gains `healthSeen` per app.
- [x] Import alerts: new one-click **Force import** button (routes/alerts.js `/actions/arr-force-import` + lib/arrForceImport.js) - reuses the same manual-import candidate lookup + ManualImport command the admin manual-import UI already drives, fired for every matched candidate at once. No blocklist, no file deletion. issueWatchdog attaches the downloadId as the alert's `action_data`.
- [x] Prowlarr health alerts: new one-click **Re-test indexers** button (`/actions/prowlarr-test-indexers` -> Prowlarr `/api/v1/indexer/testall`) so a disabled indexer re-enables now instead of waiting out its backoff.

## v1.58.3 - Removed Cleanup Candidates (Stack panel)

- [x] The movies-by-reclaimable-size report (v1.53.0) wasn't being used - removed entirely: `lib/cleanupCandidates.js`, its test, the `GET /api/owner/cleanup-candidates` route, the Stack-panel card + its modal (admin.html/admin.js), and `#cleanup-list` from the shared modal-list CSS rule.

## v1.59.0 — My Stats tab: motion, records, heatmap, library mix

- [x] The tab was all slow-moving year-to-date aggregates with nothing that changes visit-to-visit. Added four things, all from data the `/my-stats` route already had or two cheap extra `recordsFiltered` calls — no new dependency, no new toggle.
- [x] **Month-over-month + pace**: hero caption now shows "on pace for ~N hrs" (naive straight-line YTD extrapolation, `projectAnnualHours`). Tiles are now four (2×2): added Hours This Month, and both month tiles carry a ▲/▼ chip vs last calendar month (`computeMonthDeltas` — null % when last month was empty so a fresh January doesn't read "+100%").
- [x] **Records · this year**: longest consecutive-day run (`longestDailyRun`), biggest single day by plays, best month — off the year-history rows, labelled "this year" since that's the window.
- [x] **12-week viewing heatmap**: 84 day-cells shaded in five steps by hours watched (`computeDailyActivity`, zero-filled server-side). Shares the rolling window that already backs the binge streak — bumped 60→95 days.
- [x] **Library mix**: Movies/TV/Anime play-count split for the year as one stacked bar + counted legend. Raw `get_history` rows carry no `section_id`, so movie and anime counts come from two `length:1` filtered calls (`media_type=movie`, `section_id=<anime>`) reading `recordsFiltered`; TV is the remainder of the authoritative year total, clamped ≥0 (`computeTypeSplit`).
- [x] "This week — N plays · Xh" one-liner between hero and tiles (`computeThisWeek`).
- [x] `lib/myStats.js` gains seven pure helpers, all unit-tested (25 tests in `test/myStats.test.js`, up from 13).

## v1.59.1 — My Stats: drop the "Watch Activity" (last 30 days) charts

- [x] The by-day-of-week and by-hour-of-day duration bar charts were redundant next to the new 12-week heatmap and added little. Removed the section, the two `get_plays_by_dayofweek`/`get_plays_by_hourofday` calls, the `activity` response field, `renderActivityBars` (app.js), `parseActivitySeries` + its 2 tests (lib/myStats.js), and the `.chart-legend`/`.chart-title`/`.dow-*`/`.hod-*` CSS. `.chart-sub` stays — the heatmap and library-mix captions use it.

## v1.59.2 — My Stats: heatmap → 14-day bar strip (mobile is the primary surface)

- [x] The 12-week heatmap put all its per-day detail in hover tooltips, which don't exist on touch — decorative texture on a phone, where most of the traffic is. Replaced with a compact 14-day strip: one bar per day, height = hours watched (scaled to the busiest day), weekday initial under each, today rightmost. `renderHeatmap` → `renderDayBars`; `computeDailyActivity` window 84 → 14 days (same pure fn, no test change); `.heat-*` CSS → `.day-strip`/`.day-bar*`. Section label "Viewing heatmap" → "Recent activity".

## v1.59.3 — My Stats: Most Watched rows are tappable (poster, synopsis, Played By)

- [x] The top-3 Most Watched list was dead text. Each row is now a tap target that opens the existing info modal — poster + synopsis + the "Played By" chips (v1.58.0: who in the household has watched it, per-person play counts). `computeTopWatched` now carries `ratingKey` (grandparent/show key for episodes, movie key otherwise); `GET /api/tautulli/metadata/:ratingKey` now also returns `thumb`/`year`/`title`/`mediaType` for the poster + meta line, fetched only on click. Own `.mw-*` markup/CSS replacing the shared `.medal-rows` grid so rows are real buttons with proper tap targets; `computeTopWatched` test updated + one added (273 tests).

## Ideas
