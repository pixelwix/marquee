# Roadmap

Every shipped feature or fix gets its own version bump now (`package.json`
+ `package-lock.json`) and its own section here — no more letting the
version drift unversioned between batches. One bump per shipped unit of
work: a new capability bumps minor, a fix bumps patch. `git commit`/push
themselves now batch to every 10th shipped unit instead of running every
time (version bumps, TODO.md sections, and live deploys still happen every
time regardless — only the git commit action batches). **Current version:
v1.29.1.**

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

- [x] Now Playing — live push updates via Plex WebSocket + SSE, header
      shows total bandwidth alongside the stream count (Tautulli's own
      aggregate, not a manual per-session sum)
- [x] Recently Watched panel (Tautulli history)
- [x] Recently Added panel — split by Movies/TV/Anime, season-pack drops
      collapsed into one entry instead of one per episode, falls back to the
      series synopsis when an episode's own isn't indexed yet
- [x] Top of the Month leaderboard (top viewer/movie/TV/anime)
- [x] Airing Today / Releasing Soon panels (Sonarr/Radarr calendars)
- [x] Download Queue panel (qBittorrent/SABnzbd, actively-downloading only)
- [x] Owner-only System Status (Uptime Kuma monitors + UPS via NUT)
- [x] Request flow — search, season picker for TV, per-user Overseerr
      permissions (not a shared admin key)
- [x] Trending/Discover — request modal's default view before typing a
      search, filtered to things not already owned or requested
- [x] My Requests tab — each family member's own request history and status
- [x] "Available now" toast — pushed live over SSE when Overseerr reports a
      request finished downloading
- [x] PWA / installable, branded per-deployment
- [x] Cycling sign-in taglines / per-deployment branding
- [x] Admin panel — recent sign-ins, admin-wide pending requests with inline
      Approve/Decline
- [x] Report an issue — from a watched item, or library-wide search (show ->
      season -> episode), backed by Overseerr's own issue system
- [x] Admin: resolve issues + live search/grab a replacement release via
      Radarr/Sonarr's own indexers, without leaving the dashboard
- [x] Admin moved to its own page (/admin) instead of hidden dashboard
      panels, room to grow without crowding the family-facing view
- [x] Download Queue gains owner-only Pause/Resume/Remove
- [x] Admin Stack panel — Wanted/Missing (release search reused from
      issues), Import Issues (stuck/failed Radarr/Sonarr queue items, with
      Remove), Prowlarr indexer health, Disk space (Radarr/Sonarr diskspace
      API, deduped to actual physical volumes)
- [x] Plex Watchlist tab in the request modal — each family member's own
      Watchlist, cross-referenced against Overseerr for availability, one-tap
      request straight from it (movies direct, TV through the season picker)
- [x] My Requests status accuracy fix — "Downloading" now means actually
      present in Radarr/Sonarr's queue, not just "Overseerr handed it off"
      (previously showed unreleased/no-release-found items as downloading)
- [x] Admin: Search Library — free-text search across Radarr/Sonarr's own
      tracked library (not TMDB), TV results drill into season -> episode
      before searching indexers, since Sonarr only searches per-episode
- [x] Admin: Force Import for stuck Import Issues — reviews Radarr/Sonarr's
      manual-import candidate and rejection reason, then pushes the import
      through; TBA-title TV rejections trigger a Sonarr series refresh and
      recheck first, since that's often just stale metadata
- [x] Admin: current file info (quality/resolution/codecs/size/date added)
      shown before searching for a replacement, from both Search Library and
      Open Issues — see what you have before deciding to replace it
- [x] CSRF protection — every state-changing request now needs an Origin
      header matching its own Host (no hardcoded domain, no frontend
      changes); Overseerr's server-to-server webhook is explicitly exempted
      since it's already authenticated by its own shared secret
- [x] Automated test coverage (`npm test`, Node's built-in test runner, zero
      new dependencies) — unit tests for the pure logic that's needed fixing
      before: request-availability computation, CSRF origin check, TMDB guid
      extraction, file-info/discover-item mapping. Deliberately scoped to
      logic, not live Radarr/Sonarr/Overseerr integration — that's still
      verified by hand, which has caught more real bugs than fixtures would
- [x] Dependency vulnerabilities cleared (`npm audit`: 12 -> 0, 1 critical/9
      high) — all traced back to sqlite3's build-only toolchain (node-gyp's
      tar/glob/etc., never runs at server runtime). Bumped sqlite3 5.1.7 ->
      6.0.1, added an `overrides` entry for connect-sqlite3's stale peer
      range (it never actually imports sqlite3, just accepts an injected
      Database instance), switched the Dockerfile to `npm ci` for
      reproducible installs. Verified live: existing sessions, Uptime Kuma
      reads, and the login log all still work against the pre-upgrade
      on-disk data with zero migration needed
- [x] CI: `npm test` now runs automatically on every push to main via
      GitHub Actions, showing a pass/fail check right on the repo — no
      longer relies on someone remembering to run it by hand
- [x] Admin: Seeding stat in the Stack panel — count of torrents seeding,
      overall ratio (qBittorrent's real all-time "Global ratio", not the
      session-only figure), plus total uploaded/downloaded — just the
      numbers, no file list
- [x] Admin: Settings page — edit .env values from the browser instead of a
      terminal. Organized by integration (Plex/Tautulli/Overseerr/Sonarr/
      Radarr/qBittorrent/SABnzbd/Uptime Kuma/NUT UPS), each shown as a card
      with a real live health check (Online/Unconfigured/Error, latency,
      version — actually pings the service, not just "is it configured"),
      plus an Edit popup with friendly per-field labels/descriptions.
      Everything not tied to a specific integration (site branding, session/
      cookie behavior, port) lives in a separate Deployment Configuration
      popup. Secrets are masked and never sent to the browser; leaving one
      blank keeps it unchanged. Infrastructure-critical keys (PORT/HOST_PORT/
      CONTAINER_NAME) are read-only since changing them can make the app
      unreachable. Saving triggers a real container restart (Node only loads
      env vars once, at process start) — the popup polls until it's back and
      reloads itself. Verified live end-to-end: all 9 services report real
      status/latency/version, write+restart+session persistence all
      confirmed against the real deployment
- [x] Moved System Status (Uptime Kuma + UPS) and Recent Sign-ins off the
      main admin page into their own Settings tabs (alongside Services),
      loaded lazily on first view instead of always-on background polling.
      Family panel keeps Pending Requests + Open Issues
- [x] Notice Board — Settings tab lets the owner schedule a persistent
      dashboard announcement (e.g. "down Monday night for maintenance") with
      an optional start/end window; shows as a broadcast-style banner above
      the panel grid for every signed-in family member, not a toast that
      disappears after a few seconds. Single current notice, not a list.
      Verified live: posting, a future-scheduled notice correctly staying
      hidden from the family view until its start time, and clearing all
      confirmed against the real deployment. Quick-fill preset buttons for
      common cases (Hardware/Network/Software Issue) plus a just-for-fun row
      (Touch Grass, Watched Everything, Skynet Wisdom) — still fully
      editable before posting, not sent as-is
- [x] **Security fix**: every signed-in family member was incorrectly
      getting isOwner:true (full admin access — Settings, Force Import,
      deleting downloads, everyone's requests). The owner check matched any
      Plex token that could merely *see* this server in its own resources
      list, which includes ordinary shared users, not just the actual
      owner — Plex's own `owned` field on each resource is what actually
      distinguishes the two, and the code never checked it. Confirmed live
      against 6 real family accounts, all showing isOwner:true; fixed and
      force-cleared all 25 active sessions so everyone re-authenticates
      under the corrected check
- [x] Themed confirm dialog — replaces the browser's native confirm() (an
      unstyled OS popup) everywhere it was used: sign-out on both pages,
      removing a download, removing/blocklisting an import-queue item,
      clearing the notice, and the Settings restart warning
- [x] Adopted three ideas from a community fork's PR, adapted cleanly to the
      current codebase rather than merged wholesale (the fork was 44 commits
      behind and its qBittorrent state-mapping would have reintroduced an
      already-fixed bug): qBittorrent API-key auth (>= 5.2.0/WebAPI >= 2.14.1,
      confirmed against the real v5.2.3 deployment) alongside the existing
      username/password flow unchanged; Now Playing skips Tautulli polling
      cleanly instead of spamming errors when it's not configured; and a
      cycling backdrop banner behind the dashboard header, sourced from
      Overseerr's trending/discover feed with a top-of-month poster fallback
- [x] QBITTORRENT_API_KEY wired into the Settings qBittorrent edit form
      (was backend-only before) — also surfaced and fixed a real bug in the
      process: Settings save silently dropped any field not already a line
      in .env, since a deployment's .env can predate a field being added to
      the service registry. applyUpdates now appends missing keys as new
      lines instead of ignoring them. Verified live: switched the real
      deployment from username/password to API-key auth successfully
- [x] Force Start button (torrents only) next to Pause/Resume in Download
      Issues — bypasses qBittorrent's own queue limits and retries even
      after repeated errors, unlike a plain Resume which still respects
      those limits and won't budge a torrent stuck behind them. Verified
      live against two real stalled torrents: state changed from stalledDL
      to forcedDL (force_start:true) in qBittorrent itself after the click
- [x] Hero backdrop banner now cycles randomly instead of walking the
      Overseerr/top-of-month list in a fixed loop — picks a random slide on
      load and a random next slide each interval, only constrained to never
      repeat the one currently on screen. Verified the exact selection logic
      statistically (20k transitions: 0 immediate repeats, ~20% uniform
      distribution across 5 slides) and deployed live to the real container
      via `docker cp` with zero downtime/restart
- [x] My Requests shows an ETA next to "Downloading" (e.g. "Downloading ·
      45m left"), pulled from Radarr/Sonarr's own queue `timeleft` instead of
      leaving it a black box between request and the "Available now" toast.
      For a season pack (multiple episode-level queue records under one
      seriesId), takes the max across them — not fully available until the
      slowest one finishes. Added unit tests for the parsing/aggregation
      logic; verified the restart needed to load the backend change came
      back healthy with real family sessions re-validating cleanly
- [x] **Fix**: Settings showed qBittorrent as Unconfigured after switching
      from username/password to API-key auth — the health check
      (`checkQbittorrent` in serviceHealth.js) only ever checked for
      username+password, never the API key, unlike lib/qbittorrent.js's own
      auth logic which already preferred the key correctly. Now checks for
      either. Verified against the real deployment: the API-key request
      succeeds directly (v5.2.3) and the container restart came back clean
- [x] **Fix**: Prowlarr had no entry in serviceRegistry.js, so PROWLARR_URL/
      PROWLARR_API_KEY fell into the catch-all Deployment Configuration
      popup instead of getting their own Settings service card with a real
      health check — despite Prowlarr already being a first-class
      integration (indexer health in the admin Stack panel). Added a
      registry entry and a checkProwlarr health check (Servarr's own
      /api/v1/system/status). Settings grid is built dynamically from the
      registry, so no frontend changes needed. Verified against the real
      deployment: version 2.4.0.5397 returned successfully, restart came
      back clean
- [x] Click a torrent in Download Queue for details — seeds/peers (connected
      + total), connections (vs. limit, "-1" from qBittorrent handled as
      unlimited rather than shown literally), up/down speed, ratio, ETA,
      save path, and a per-file list with individual progress bars. Pulled
      from qBittorrent's own properties+files endpoints (`getTorrentDetails`
      in lib/qbittorrent.js) via a new owner-agnostic endpoint (same
      visibility as the queue itself — read-only, no control action).
      Torrent-only; SABnzbd/usenet rows aren't clickable, no equivalent data
      available. Added unit tests for the properties+files mapping,
      including the sentinel/edge cases (100-day "no ETA", -1 "no connection
      limit"). Verified live end-to-end against a real torrent in the actual
      queue — correct seeds/peers/size/save path/per-file progress returned
- [x] Owner-only Remove button on actively-downloading torrents in the main
      Download Queue panel (previously Remove only existed in the admin-only
      Download Issues panel, for stuck/paused/errored items — nothing let
      the owner pull a torrent that's downloading normally but shouldn't be,
      e.g. wrong release grabbed). Reuses the existing DELETE
      /queue/torrent/:id endpoint, already owner-gated server-side, so no
      backend changes needed — just an isOwner-gated button client-side,
      same confirm-dialog-then-delete-files pattern as Download Issues.
      Torrent-only, matching the details feature above. Zero-downtime static
      deploy, verified served live
- [x] Disk Space now prefers real physical-volume storage data read directly
      off a bind-mounted host path (`MEDIA_MOUNT_DIR`, optional — falls back
      to the existing Radarr/Sonarr diskspace API when unset), instead of
      only ever reflecting whatever root folders those two apps happen to
      have configured. Uses Node's `fs.statfs()` directly, no external API
      call or credentials needed. Extracted the dedup-by-capacity logic
      (lib/diskspace.js) so both sources share it. Required a full container
      recreate (new bind mount, not just a restart) — rebuilt from the fully
      synced source first so none of tonight's earlier hotfixes were lost in
      the process. Verified live end-to-end: real volumes, correctly deduped
      down from 7 mount points to 3 actual volumes, matching host `df`
      exactly. Also swapped the panel's linear bar for a per-volume donut
      gauge, same amber/danger color semantics as before
- [ ] Note: the NAS-specific integration piece of this (bind mount details,
      real host paths/share layout) stays local to this deployment only —
      not committed/pushed to GitHub, per owner's request
- [x] Wanted/Missing moved from Stack to the top of the admin Family card and
      now proactively flags stuck releases in the same list, instead of a
      second near-duplicate section (tried that first, merged after
      noticing the overlap). Every item gets `daysSinceRelease` + a `stuck`
      flag (lib/stuckRequests.js, >= 3 days out with no file — long enough
      that it's not just still propagating across indexers) computed
      server-side; sorted most-overdue-first, stuck ones get a danger dot +
      "Nd overdue", fresh ones render as before. Same info modal + release
      search as always. Verified live against the real Radarr/Sonarr queue:
      17 total wanted/missing, several genuinely stuck for months (one over
      1000 days)
- [x] Web Push for "Available now" — reaches subscribed devices even without
      a tab open, alongside the existing in-app SSE toast (same trigger,
      Overseerr's MEDIA_AVAILABLE webhook, same audience — every subscribed
      device, not scoped to who requested it, matching the SSE toast's own
      broadcast-to-everyone behavior). New bell icon in the header toggles
      subscribe/unsubscribe (hidden entirely if VAPID isn't configured).
      Subscriptions persist in their own push.sqlite (survives sign-out,
      unlike a session) with dead-subscription cleanup on a 404/410 send
      response. Verified live: web-push loads with real VAPID keys, storage
      layer's upsert/multi-user/remove all confirmed, image rebuilt clean
      (new npm dependency) with every earlier feature from this session
      still intact afterward. Note: iOS Safari only supports Web Push from
      an installed PWA, not a regular tab — not fixable app-side, WebKit's
      own restriction
- [x] **Perf audit, dead code**: removed unused `.span1`/`.poster-progress`
      CSS rules and an unused `THRESHOLD_DAYS` export (lib/stuckRequests.js);
      consolidated a byte-identical `parseTimeleft()` duplicated in
      lib/sabnzbd.js and lib/downloadQueueIds.js into lib/parseTimeleft.js.
      Verified nothing else references any of it before removing (checked
      static + dynamic/template-literal usage twice), all 57 tests still
      pass, live-verified both parseTimeleft call sites against real
      SABnzbd/Radarr/Sonarr data post-deploy.
- [x] **Perf audit, images**: added `loading="lazy"` to all 24 `<img>` tags
      (20 dynamic across app.js/admin.js, 4 static modal placeholders) —
      defers offscreen poster/thumbnail loads across Recently Added/Top of
      Month/Airing Today/Upcoming/search results.
- [x] **Perf audit, fonts**: self-hosted Inter/Space Grotesk/JetBrains Mono
      instead of a render-blocking Google Fonts `<link>` in both `<head>`s.
      Discovered Google serves these as variable fonts under the hood — the
      identical file backs every requested weight per subset (e.g. Inter
      400/500/600 latin all resolved to one URL) — so only 6 files
      (latin + latin-ext × 3 families, ~220KB total) were actually needed,
      not the 16 initially fetched. Dropped cyrillic/greek/vietnamese
      subsets entirely (irrelevant for this English-language dashboard).
      Local fonts.css mirrors Google's own @font-face structure exactly
      (same family/weight/unicode-range, just deduplicated files) for
      guaranteed pixel-identical rendering. Verified all 6 files serve with
      correct content-type/size and zero googleapis.com references remain
      in served HTML; visual spot-check still worth doing since I have no
      browser to confirm rendering myself.
- [x] **Perf audit, cache headers**: versioned bundles (app.js/admin.js/
      shared.js/style.css/fonts.css) switched from `no-cache` to
      `public, max-age=31536000, immutable` — safe because each gets a fresh
      `?v=<deploy timestamp>` on every restart, so the response body at any
      given URL is genuinely permanent. `sw.js` deliberately excluded and
      stays `no-cache` — it's the one script registered without a `?v=` (see
      `navigator.serviceWorker.register('sw.js')` in app.js), so long-lived
      caching would have silently blocked future service-worker updates
      from ever reaching clients. Fonts extended the same 1-week treatment
      icons already had (also unversioned, also rarely change). Verified
      every category live — sw.js/manifest/HTML still no-cache, everything
      else immutable/1-week as intended.
- [x] Copyright/version footer on both pages ("{{SITE_NAME}} v{{APP_VERSION}}
      · © {{COPYRIGHT_YEAR}}") — package.json's version is the single source
      of truth, year computed once at startup. Bumped 1.0.0 -> 1.1.0 (122
      commits deep, version had never been bumped once) to reflect tonight's
      batch as a real minor release rather than silently accumulating forever
      under the original number. Verified live on both pages: "skyn3t v1.1.0
      · © 2026"

## v1.2.0 — Releasing Soon parity, My Stats, Watchlist removed

- [x] Releasing Soon now shows a "Downloaded" status label under any movie
      already in the library, matching Airing Today's existing Airing/
      Downloaded pattern — the /api/radarr/upcoming endpoint already
      returned `hasFile`, so this was frontend-only. Caught a real bug in
      the process: the deploy landed on disk via `docker cp` but the
      container was never restarted, so the immutable-cached `app.js?v=...`
      bundle from the perf-audit caching scheme kept serving the old code
      to browsers/Cloudflare regardless — restarting to bump the deploy
      timestamp fixed it. Static frontend deploys now always restart, not
      just backend changes
- [x] My Stats — a fourth tab in the request modal (Search / My Requests /
      Watchlist / My Stats), reachable from the avatar chip which is now
      clickable. Per-signed-in-user, same pattern as My Requests: hours
      watched (last 12 months) as a hero number, family rank/binge streak/
      plays-this-month as tiles, and a top-3 most-watched list reusing Top
      of the Month's medal styling. Hours/plays-this-month come from
      Tautulli's get_user_watch_time_stats (one call covers both windows);
      binge streak and most-watched are computed from raw get_history rows
      (lib/myStats.js, unit tested); family rank reuses the same
      get_home_stats call Top of the Month already makes, just widened to
      365 days. Discovered get_history has no grandparent_thumb (unlike
      get_recently_added) — fixed by fetching a real poster via
      get_metadata for just the top-3 results, not every group. Verified
      live end-to-end against real data (716 hrs/year, rank #2 of 50, real
      Naruto Shippūden/My Hero Academia/K-ON! posters)
- [x] My Stats, round 2: dropped the Most Watched poster — now one flat
      gold/silver/bronze list (medal + title + play count) instead of a big
      #1 poster tile, so the per-item get_metadata round trip is gone
      entirely (computeTopWatched no longer needs a ratingKey at all). Added
      a "Watch Activity" section below it — by-day-of-week and by-hour-of-day
      breakdowns adapted from Tautulli's own Graphs page
      (get_plays_by_dayofweek/get_plays_by_hourofday, scoped to this user,
      y_axis=duration), stacked Movies/TV bars with a legend and hover
      tooltips, bar heights scaled per-chart to that chart's own tallest
      bucket. Live TV is dropped from the parsed series — this deployment
      never has any, so Tautulli's own chart would show a permanently-empty
      third legend entry. Also caught and fixed a real class-name collision:
      the stat-tile card class silently inherited `flex: 1 1 35%; min-width:
      90px` from an unrelated pre-existing Admin Seeding-panel rule of the
      same name — renamed to mystats-tile. Verified live against real data:
      correct hours/plays/rank, and the day/hour breakdowns cross-check
      against each other (a single 2h movie session shows up as both
      Tuesday's 2h Movies bar and hour 13's 2h Movies bar, same session)
- [x] Removed the Watchlist tab — it only paid off if someone actually used
      Plex's own native watchlist feature outside Marquee, and Search/
      Discover already covers "find something to request." Removed the tab
      button + pane, the modalTabs entry and its lazy-load wiring, the
      `/api/watchlist` route, and `lib/plexWatchlist.js` (Plex Discover API
      client) entirely — nothing else referenced it. Request modal is back
      to three tabs (Search / My Requests / My Stats). Verified live:
      `/api/watchlist` now 404s, everything else still responds correctly,
      clean restart with no errors

## v1.2.1 — Fix: Now Playing/Recently Watched poster flicker

- [x] Fixed Now Playing/Recently Watched flickering every ~10s. Root cause:
      `renderNowPlaying` did a full `innerHTML` rebuild on every SSE `full`
      event, recreating every `<img>` from scratch — even the safety-net
      refresh in lib/nowPlaying.js's `setInterval(refresh, 10000)`, which
      fires whether or not anything actually changed. It also unconditionally
      called `renderRecentlyWatched()`, fully re-rendering that panel too on
      the same timer even though its data is only fetched once on page load.
      Rewrote `renderNowPlaying` to reconcile rows by `sessionKey` instead —
      an existing row's `<img>` is now created once and left alone for the
      life of that session, only text/bar-width update in place; Recently
      Watched only re-renders when the live session count actually changes.
      `patchNowPlayingRow` (the lightweight per-event Plex-push path) was
      untouched aside from re-pointing at the still-separate `.state-word`
      span. Verified live: clean restart, no errors

## v1.3.0 — Now Playing live elapsed/ETA counter

- [x] Now Playing shows elapsed/total runtime + a wall-clock ETA above the
      progress bar (e.g. "10:49 / 23:00 · ETA 9:12 PM"), adapted from
      Tautulli's own activity view. Both computed entirely client-side from
      data every session already carries (progress % + durationMs) — no new
      backend field. `formatDuration` (shared.js) does mm:ss below an hour,
      h:mm:ss at or above; ETA is `now + time remaining`, recomputed on every
      live update (the full snapshot and the lightweight per-event patch
      alike) so it stays right through pauses. Mocked up first before
      building — the mockup surfaced that Tautulli's screenshot doesn't
      actually show a distinct "buffered ahead" bar segment either, just
      this same elapsed/ETA overlay, so that's what got built. CSS scoped to
      `.now-row .bar` rather than a global `.bar` override, since Download
      Queue/torrent file rows reuse the same `.bar`/`.bar-fill` classes.
      Verified the formatting logic by hand against known inputs; live
      verification of the on-screen result still pending an active session
      to check against (none running at deploy time)
- [x] Now Playing's elapsed/total/ETA/bar now tick every second instead of
      only on the ~10s Plex push cadence. Each session gets a `syncedAt`
      timestamp on every real update (both the full snapshot and the
      lightweight per-event patch); a 1s `setInterval` interpolates forward
      from the last known progress using wall-clock time since then
      (`interpolatedElapsedMs`), frozen in place whenever state isn't
      'playing' so a pause doesn't look like time is still passing. Every
      real sync resets the anchor, so interpolation drift can't accumulate
      beyond one sync interval. Bar width now goes through the same
      interpolated value (`updateNowBar`) instead of the raw synced
      percentage, with a `transition: width 1s linear` (scoped to
      `.now-row .bar-fill` only) so it reads as continuous movement rather
      than a once-a-second jump. Verified the interpolation math by hand
      (ticks forward correctly while playing, frozen while paused); live
      on-screen verification still pending an active session

## v1.3.1 — Fix: counter sync accuracy

- [x] **Fix**: found the counter was ticking smoothly from a slightly wrong
      starting point. The backend only ever kept a rounded whole-percent
      `progress_percent` (Tautulli's own field) — reconstructing elapsed
      time from that discards real precision, up to ~half a percent of
      runtime off (several seconds on a typical episode). Both Tautulli's
      `get_activity` and Plex's own push notifications actually carry an
      exact `view_offset` in ms; added `viewOffsetMs` to `mapSession` and to
      the `update` SSE payload (lib/nowPlaying.js), and switched
      `interpolatedElapsedMs` to anchor on that instead of reconstructing
      from the percentage. Verified against a real live session (someone
      streaming King of the Hill): reconstructing from the rounded percent
      was ~4.3s off the real position; confirmed via an authenticated curl
      request (reconstructed a valid signed session cookie from the sqlite
      store + SESSION_SECRET) that `/api/tautulli/now-playing` and the SSE
      `update` stream both now carry the exact value, and that consecutive
      real updates land ~10s apart matching Plex's own push cadence — the
      gap the 1s interpolation ticker is there to smooth over

## v1.4.0 — Track a grab through to done

- [x] Track a grab through to done instead of freezing at "Grabbed ✓". Real
      problem reported: the owner grabbed a replacement release for a
      reported issue, saw "Grabbed", and had no idea whether it actually
      downloaded or got imported without going to check Sonarr's own
      Activity/History directly. The grabbed row now keeps polling in place
      (same 4s cadence, new `/api/radarr/grab-status` and
      `/api/sonarr/grab-status` endpoints) through Downloading (%/speed/ETA)
      -> Importing -> Done (✓ Replaced, with the new file's quality/size) or
      Failed (the real rejection reason + a "Fix it" button straight into
      the existing manual-import flow). State classification
      (`lib/grabStatus.js`, unit tested) reuses the exact same
      trackedDownloadStatus/statusMessages fields the Import Issues panel
      already keys off — nothing new on the Radarr/Sonarr integration side,
      just surfaced live on the row instead of only after the fact in a
      separate panel. Same shared `openReleaseModal` function backs Open
      Issues, Wanted/Missing, and Search Library, so this applies to all
      three without per-call-site changes. Mocked up first. Gives up
      politely after 5 minutes of polling ("check Import Issues later")
      rather than polling forever silently; closing the modal early loses
      nothing since Import Issues independently catches any real stuck
      import regardless. Verified against two real cases on the live
      deployment: a genuinely stuck Sonarr import (exact real rejection
      reason + downloadId returned) and a fully-imported movie (exact real
      file quality/size/codec returned)

## v1.4.1 — Fix batch: admin flicker, grab timing, Notice Board, avatar label

- [x] Fixed the same poster-blink bug on the admin page — every poll-
      refreshed list there (Pending Requests 30s, Open Issues 30s, Wanted/
      Missing 60s, Import Issues 30s) did a full `innerHTML` rebuild each
      cycle, recreating every `<img>` from scratch, same root cause as the
      Now Playing/Recently Watched fix earlier. Added a shared
      `reconcileList(container, items, keyOf, createRow, updateRow)` helper
      to admin.js and converted all four — an existing row's `<img>` is now
      created once and left alone, only text/data-* attributes refresh in
      place. Wanted/Missing needed a real fix along the way, not just a
      refactor: its click handler looked items up by array index
      (`data-idx`), which reconciling by a stable key would have silently
      broken the moment sort order shifted (e.g. a newly-stuck item jumping
      to the top) — replaced with a real stable key (tmdbId, or
      tvdbId+season+episode). Open Issues' click handlers read straight off
      the row's own `dataset` as context for the release-search/file-info
      flows, so `updateAdminIssueRow` keeps every field current every poll,
      not just the visible text. Download Issues/Disk Space/Seeding/
      Indexers were untouched — no images, nothing to flicker. Verified
      live: all three underlying endpoints (Open Issues, Wanted/Missing,
      Sonarr queue) still return data matching exactly what the new render
      functions expect, clean restart with no new errors
- [x] **Fix**: grab tracking jumped straight to "Replaced" instead of
      showing Downloading/Importing. Root cause: the "resolve an issue"
      flow exists specifically to replace a file that's already there, so
      `hasFile` on the movie/episode is true *before* the grab too — the
      grab-status endpoint's "not in the queue yet" fallback treated any
      existing file as proof this specific grab had already succeeded.
      Fixed by passing `since` (the grab's start time, captured client-side)
      through to `/grab-status`, and added `isFileFromThisGrab` (lib/
      grabStatus.js, unit tested) — only counts as done once the file's own
      `dateAdded` is at/after that timestamp (small buffer for clock skew
      between this server and Radarr/Sonarr's host). No `since` given falls
      back to the old (immediate) behavior, so nothing else that might call
      this endpoint breaks. Verified against Supergirl's real pre-existing
      file live: `since=now` correctly returns `unknown` instead of
      `done`; `since=`(a day before the real dateAdded) correctly still
      returns `done`; no `since` at all matches the prior behavior exactly
- [x] Avatar chip subtitle changed from "Signed in" to "My Stats" — the
      chip was already clickable (opens My Stats), but "Signed in" read as
      plain status text with no hint it was tappable. Mocked up first.
- [x] **Fix**: Settings → Notice Board's "Nothing posted right now." was
      visibly clipped at the top. Root cause: `#notice-status-text` reuses
      `.discover-label`'s shared `-0.35rem` top margin (tuned to tuck it
      under the search input in the request modal, its original use) — here
      it's the first thing inside a scrollable settings tab with nothing
      above it, so the negative margin pulled the text up past the scroll
      container's own edge. Scoped override (`#notice-status-text { margin-
      top: 0; }`) rather than touching the shared class, since the request
      modal's usage is correct as-is. Verified the fresh cache-busted CSS
      URL actually serves the fix live.

## v1.4.2 — Fix: notification bell failed silently

- [x] **Fix**: the header bell (Web Push subscribe toggle) did nothing when
      clicked, with no error and no way to tell why. Root cause: the click
      handler had no error handling at all — service worker readiness, the
      browser's own permission prompt, subscribe()/unsubscribe(), and the
      backend round trip can all fail or (for an unanswered permission
      prompt) just never resolve, and none of that was ever surfaced.
      Wrapped the whole handler in try/catch with a clear alert() on
      failure (matching the existing denied-permission alert already used
      here), added a `btn.disabled` guard against double-clicks during the
      async chain, and a matching `.icon-btn:disabled` style. Root cause of
      the *specific* report is still unconfirmed (most likely either a
      missed/unanswered browser permission prompt or notifications already
      blocked at the browser level for this site) — the fix makes any of
      those visible instead of silent, rather than claiming to have
      reproduced the exact failure.

## v1.4.3 — Fix: bell's real root cause on Safari

- [x] **Fix**: v1.4.2's error surfacing paid off immediately — confirmed
      live (Safari on Mac) that the alert showed "unknown error" with no
      permission prompt ever appearing at all, before or after. Ruled out
      the VAPID key itself (decoded and checked by hand: a valid 65-byte
      uncompressed P-256 point) and the server (no corresponding error in
      the logs — this was failing entirely client-side, before ever
      reaching `/api/push/subscribe`). The code was relying on
      `pushManager.subscribe()` to implicitly trigger the browser's
      notification permission prompt, same as Chrome does — Safari doesn't
      reliably do that; it can reject outright with no prompt shown at all.
      Now calls `Notification.requestPermission()` explicitly first
      (the standard cross-browser-safe pattern) before ever calling
      `subscribe()`. Also improved the error alert to show `name: message`
      when both are present instead of just `message` alone, in case
      there's still more to learn from whatever Safari throws next. Deployed
      live; confirmation that this actually resolves it on Safari is
      pending a retry.

## v1.5.0 — Web Push removed entirely

- [x] Removed the notification bell and everything behind it: `lib/
      pushNotify.js`, `lib/pushSubscriptions.js`, `routes/push.js`, the
      `/api/push` mount in server.js, the `{{VAPID_PUBLIC_KEY}}` template
      placeholder + script tag, the bell button + its CSS
      (`.icon-btn.active`/`.icon-btn:disabled`), `initNotifyToggle()` +
      `urlBase64ToUint8Array()` in app.js, the `push`/`notificationclick`
      handlers in sw.js, the `pushNotify.notifyAll()` call in the Overseerr
      webhook handler (the SSE `media-available` broadcast next to it is
      untouched — that's the in-tab toast, a separate mechanism), the
      `web-push` npm dependency (via `npm uninstall`, not hand-edited, so
      package-lock.json stayed consistent), and the VAPID env var block from
      `.env.example`. The in-app "Available now" SSE toast still works
      exactly as before — this only removes the without-a-tab-open path.
      `push.sqlite` (subscription storage) was left alone on disk rather
      than deleted — orphaned but harmless.
      <br>Removing `web-push` meant a real image rebuild, not just a
      `docker cp` patch — and that surfaced a genuinely important gap along
      the way: the host's actual build-context directory
      (`/mnt/docker/skyn3t`, what `docker compose build` reads from) had
      been stale since before this session even started — still had the
      `/api/watchlist` route from before that removal, package.json still
      at `1.1.0`. Every deploy this whole session had been `docker cp`
      patches into the running container's writable layer only, which
      never touches that source directory. A `docker compose build` at any
      point would have silently reverted the *entire* session's work back
      to a stale baseline. Fully re-synced the real local tree there first
      (`rsync`, excluding `.git`/`node_modules`/`.env`/`data` — the last two
      to protect the live secrets/sqlite dbs already on the host) before
      rebuilding, and verified afterward that the NAS-specific Disk Space
      feature (the most sensitive thing to lose) still returns real
      physical-volume data post-rebuild, that `/api/watchlist` and
      `/api/push` both 404, and that other recent auth-gated endpoints
      (My Stats, grab-status) still respond correctly. Going forward, any
      change needing a real rebuild (a dependency change, not just static
      files) needs this same host-tree sync first, every time.

## v1.5.1 — Fix: Download Queue/Download Issues DOM churn on every poll

- [x] Ran a full performance + dead-code audit (unused functions/CSS/
      dependencies, duplicate logic, commented-out code, render-blocking
      resources, re-renders, bundle size, caching, N+1 patterns) at the
      owner's request. Result: the codebase came back almost entirely
      clean — zero unused functions (checked every `lib/` export
      cross-file and every top-level function within `app.js`/`admin.js`),
      zero unused CSS classes (206 checked, comments stripped first after
      an initial false-positive pass), zero dead npm dependencies, zero
      leftover debug `console.log`s, no render-blocking scripts (already
      at the end of `<body>`), no missing lazy-loading, caching already
      well-configured. One real finding: `/requests/mine`, `/requests/
      pending`, and `/issues/open` each fire one Overseerr lookup per
      item — investigated and *not* actionable, a pre-existing comment
      already documents Overseerr's request/issue APIs have no bulk
      title/poster lookup, and it's already parallelized; verified live
      that the high-traffic `/search`/`/discover` endpoints don't have
      this problem at all (Overseerr's own response already includes
      title/posterPath directly). The only actionable item: Download
      Queue (5s poll) and Download Issues (15s poll) were still doing a
      full `innerHTML` rebuild every cycle — no `<img>` tags in either so
      no visible flicker, but still unnecessary DOM churn on the app's
      two most frequent polls.
- [x] Converted both to the same `reconcileList`-by-key pattern already
      proven on Now Playing/Recently Watched and 4 admin panels. Added a
      matching `reconcileList` helper to `app.js` (mirrors the one already
      in `admin.js` — the two pages don't share modules by design, no
      bundler). Keyed by `${type}-${id}` (torrent hash / SABnzbd nzo_id
      are separate namespaces, prefixed to rule out a coincidental
      collision). Download Queue's owner-only Remove button and Download
      Issues' Pause/Resume/Force buttons are now added/removed or toggled
      in place on the persistent row rather than recreated — verified
      every existing click-handler dependency (`row.dataset.hash`/`.name`
      for the torrent-details click-through, `row.dataset.id`/`.type` for
      pause/resume/force/remove) still lines up field-for-field. Both
      queues were empty at deploy time, so this is verified by careful
      manual trace-through + the proven track record of this exact
      pattern elsewhere, not a live visual confirmation against real
      non-empty data — worth a glance next time something's actually
      downloading or stuck.

## v1.5.2 — Fix: Top of the Month now tracks the calendar month, not a rolling 30 days

- [x] `/api/tautulli/top-of-month`'s main leaderboard call (viewer/movie/TV)
      used a hardcoded `time_range: 30` against Tautulli's `get_home_stats` —
      a rolling trailing-30-days window with no relationship to the actual
      calendar month, so e.g. on the 2nd of a new month it was still mostly
      reflecting last month's plays. Tautulli's `time_range` is just "N days
      back from now", so swapped the hardcoded `30` for
      `new Date().getDate()` (days elapsed since the 1st) — resets to 1 on
      the 1st and grows a day at a time from there automatically, no
      rollover logic needed. Anime's separate 90-day/50-pool call is
      deliberately left alone (not tied to month-to-date) — it's already
      wider than any single calendar month specifically to compensate for
      low anime volume; shrinking it early in the month would starve it
      even more than the old fixed 30-day version did.

## v1.5.3 — Anime leaderboard now tracks the calendar month too

- [x] Owner reconsidered v1.5.2's choice to leave anime on a fixed 90-day
      window: anime now shares the same month-to-date `time_range` as
      viewer/movie/TV, so all four leaderboards reset together on the 1st.
      Since anime and TV were already being sliced from the same `top_tv`
      stat by `section_id`, this collapsed what used to be two
      `get_home_stats` calls into one (using the larger 50-row pool for
      everything, so anime still gets a real chance to surface in a
      combined top_tv ranking dominated by regular TV). Tradeoff accepted
      knowingly: anime will run sparse/empty for the first few days of a
      new month — genuinely low volume, no way around that once it's tied
      to the same shrinking window as everything else.

## v1.6.0 — Alerts panel: arr-stack health watchdog

- [x] New owner-only Alerts panel, first in the `/admin` bento grid for
      zero-scroll visibility. Populated by a new external cron script
      (`/mnt/docker/scripts/arr-health-watchdog.mjs` on docker-host, every
      15 minutes) that checks Sonarr/Radarr/Prowlarr's own structured
      `/health` endpoints (reliable, no LLM) plus a secondary log-triage
      pass — recent warn/error/fatal log lines get judged by CLIProxyAPI
      (subscription-backed, not metered) for whether they're a real
      actionable problem versus routine noise, biased toward silence on
      any failure (network, parse, LLM outage) rather than risking a false
      alert. Detect-and-alert only, deliberately no auto-fix — the owner
      still does the actual fixing. qBittorrent/SABnzbd left out of scope:
      neither has a `/health` concept, and their failure modes already
      have dedicated auto-remediation scripts (`qbit-stalled-cleanup.mjs`,
      `qbit-disk-guard.mjs`) that this would have mostly just narrated.
- [x] New `lib/alerts.js` (sqlite, same lazy-open pattern as `lib/
      notice.js`) + `routes/alerts.js`: `POST /api/alerts/ingest` (shared-
      secret auth, exact mirror of the existing `OVERSEERR_WEBHOOK_SECRET`
      pattern — not session-based, since the watchdog is an external
      script), `GET /api/alerts`, `POST /api/alerts/:key/dismiss`, all
      reconciled against a `scopes` list so a partial-failure run (an
      unreachable app, a down LLM) can never wrongly auto-resolve a real
      open alert — it just omits that scope and leaves prior state alone.
      Dismiss (`acknowledged_at`) is deliberately not the same as Resolve
      (`resolved_at`, only ever set by the watchdog observing a condition
      actually clear) — a dismissed alert resurfaces if it reopens or
      escalates in severity, so it can't go permanently silent while still
      broken, but stays quietly suppressed if it's just still open at the
      same severity you already looked at.
- [x] Pure reconciliation logic (`planReconciliation`) factored out and
      unit-tested (`test/alerts.test.js`, 8 cases) the same way `lib/
      notice.js` separates `computeStatus` from DB I/O.

## v1.7.0 — Web Push notifications, brought back scoped to stack alerts only

- [x] Web Push was removed entirely in v1.5.0 for going unused (the old
      version covered general family notifications — nobody had it on).
      Rebuilt from that same git history, adapted to a narrower, genuinely
      high-value case: the owner gets pinged the instant a NEW or reopened
      arr-stack alert lands (see v1.6.0's Alerts panel), even without the
      dashboard open. Owner-only throughout — `routes/push.js`'s three
      endpoints are all `requireAuth`+`requireOwner`, subscriptions live in a
      dedicated `lib/pushSubscriptions.js` (fresh `owner-push.sqlite`, not a
      resurrection of the old family-wide `push.sqlite` file the removal left
      on disk — that data is stale and the wrong shape for an owner-only
      feature anyway). `lib/alerts.js`'s `reconcile()` fires one batched
      notification per ingest run for whatever's newly-inserted or reopened —
      deliberately NOT for an alert that's simply still open on this cycle,
      which would re-notify for the same unresolved thing every 15 minutes
      and risk becoming exactly the kind of nagging that made the original
      version go unused. Notification click opens `/admin` directly (was `/`
      before, back when it served the whole family). VAPID keys reused the
      ones already sitting unused in production `.env` since the v1.5.0
      removal, rather than generating a new pair.
- [x] Real bug caught by `npm test` before deploy: `lib/pushSubscriptions.js`
      initially ported the old code's eager DB-open (`mkdirSync` at module
      load), which crashes outside a container where `/app/data` doesn't
      exist and doesn't match the lazy-open convention every other storage
      module here uses (`lib/notice.js`, `lib/alerts.js`). Fixed to match.

## v1.8.0 — Alerts/push extended to open issues, import issues, downloads, stuck wanted

- [x] The Alerts panel and push pipeline (v1.6.0/v1.7.0) now also cover the four
      other "needs the owner's action" categories already surfaced in `/admin`'s
      existing panels: Overseerr open issues, Radarr/Sonarr stuck imports, stuck
      downloads, and stuck Wanted/Missing releases (overdue 3+ days, same threshold
      `lib/stuckRequests.js` already used). Deliberately excludes new pending
      requests — too routine/frequent, the exact kind of thing that made the
      original Web Push feature go unused before its v1.5.0 removal.
- [x] New `lib/issueWatchdog.js`: an in-process scheduler (same `setInterval`
      shape as `lib/nowPlaying.js`, checks every 5 minutes — no LLM calls
      involved here unlike the external arr-health-watchdog, so it can afford
      to check more often) that feeds these into the exact same `lib/
      alerts.js` reconcile/push pipeline the arr-stack watchdog already uses —
      same panel, same dismiss/auto-resolve, same push-only-on-new-or-reopened
      behavior, zero new UI or storage code.
- [x] Refactor alongside it: extracted the fetch-and-map logic these panels
      already used (previously inlined in `routes/overseerr.js`, `radarr.js`,
      `sonarr.js`, `downloads.js`, `owner.js`) into new/extended `lib/`
      clients — `lib/overseerrClient.js` (added `fetchOpenIssues`, moved
      `resolveMedia`), `lib/radarrClient.js` and `lib/sonarrClient.js` (new —
      import-queue + wanted/missing fetchers), `lib/downloadsClient.js` (new
      — the qBittorrent/SABnzbd merge). Route handlers are now thin
      call-and-respond wrappers around the same lib functions the new
      watchdog also calls — zero HTTP response shape changes, confirmed via
      the full `npm test` suite (87/87) both before and after.

## v1.8.1 — Fix: Alerts panel flashing "Could not load" on transient blips

- [x] Owner reported the new Alerts panel (v1.8.0) intermittently flashing
      "Could not load alerts" mid-session, then recovering a poll or two
      later. Checked `docker logs skyn3t` across the reported window: zero
      server-side errors — the request never reached Express, ruling out a
      bug in the new code. Root cause: this panel polls every 30s (twice
      most others' 60s) using the same "wipe the whole panel to an error
      state on any fetch failure" pattern every panel in this app already
      uses — a momentary blip (network handoff, iOS backgrounding the PWA
      tab, whatever) shows up here first and most often purely because it
      checks twice as frequently, not because anything is actually broken.
      Fixed in `loadAlerts()` only (scoped to what was reported): a failed
      poll now only replaces the panel with an error state if nothing's
      already on screen (a genuine first-load failure) — a mid-session blip
      just leaves the last-known-good list up instead of erasing real,
      still-actionable alerts for one missed poll.

## v1.9.0 — "Suggest fix" button for log-triage/import alerts

- [x] Owner asked whether alerts should get a Fix button that has an agent look
      at the problem and show possible solutions. Explicit requirement: no risk
      of the agent breaking anything by accident. Built as a strictly read-only
      suggestion, not an action — the CLIProxyAPI request behind it has no
      `tools` param at all, so structurally (not just by prompt instruction) it
      cannot execute anything against Sonarr/Radarr/Prowlarr/qBittorrent/etc.,
      only generate text. New `lib/cliproxyClient.js` (thin client, mirrors the
      call shape already proven in `/mnt/docker/scripts/
      arr-health-watchdog.mjs`), new `POST /api/alerts/:key/suggest-fix`
      (owner-gated, rate-limited).
- [x] Scoped to exactly two alert `source` types — `log-triage` and `import` —
      the only ones with enough specific context (an LLM-written log summary; a
      service's own stated rejection reason) to get a genuinely useful
      suggestion rather than a restatement of the symptom. Deliberately NOT
      `health` alerts: a useful diagnosis there (like the real Mylar/Prowlarr
      port-mapping bug found earlier this session) needs actual tool access —
      running `docker inspect`, testing connectivity — which is a meaningfully
      bigger, riskier feature intentionally deferred rather than half-built.
      Restricted server-side (not just hidden in the UI), so the endpoint 400s
      on any other alert type even via a direct API call.
- [x] Zero changes to `lib/alerts.js`'s existing `reconcile`/`planReconciliation`
      (the tested reconciliation logic) — only one small additive `getByKey`
      export, so the existing 8-case `test/alerts.test.js` needed no changes
      and stayed a valid safety net (87/87 still passing after).

## v1.10.0 — Owner Disk Space panel: real physical-volume storage

- [x] Admin Disk Space panel now prefers real filesystem data read directly off
      a bind-mounted NAS share directory (`MEDIA_MOUNT_DIR` in `.env`, mounted
      read-only at `/app/media-mount`) — independent of Radarr/Sonarr's own
      diskspace API, which only reflects whatever root folders those two apps
      happen to have configured, not the NAS's actual storage pools. Falls
      back to the existing Radarr/Sonarr diskspace API when no mount is
      configured, so this is a strict addition, not a breaking change for
      other deployments.
- [x] New `lib/mediaStorage.js` (reads `statfs` per subdirectory under the
      mount) is deliberately **not** committed — gitignored alongside its test
      file, same as the rest of the Synology-specific integration. New
      `lib/diskspace.js` holds the actual shared/committed logic (grouping
      volumes by total capacity, deduping mount points that share the same
      physical volume) and is fully generic — no host paths, IPs, or NAS
      specifics anywhere in it.
- [x] `GET /api/owner/diskspace` stays owner-gated (`requireAuth` +
      `requireOwner`, unchanged) and only ever returns share labels (e.g.
      "movies, tv") plus byte counts — no host filesystem paths, no local IPs,
      nothing NAS-identifying in the response payload or the rendered admin
      panel.
- [x] `mediaStorage` added to `lib/serviceHealth.js`'s health-check registry
      and `lib/serviceRegistry.js`'s settings page (Media Storage — Mount
      Directory), so `MEDIA_MOUNT_DIR` is configured the same way every other
      integration is: through `.env`/the settings UI, never hardcoded.

## v1.10.1 — Fix: My Stats now uses true calendar year/month, not rolling windows

- [x] `hours`, family `rank`, and `topWatched` on the My Stats tab switch from
      a rolling 365-day window to true calendar year-to-date — same technique
      Top of the Month already used for its month-to-date window (Tautulli's
      `time_range`/`query_days` only mean "N days back from now", so N is
      computed as days-elapsed-since-the-period-started, resetting itself on
      Jan 1 with no separate rollover logic).
- [x] `playsThisMonth` switches from a rolling 30-day window to true
      calendar-month-to-date, matching Top of the Month exactly (`N = today's
      day-of-month`) — it was labeled "this month" but had the identical
      rolling-window bug Top of the Month had before v1.5.2.
- [x] `streakDays` deliberately stays on its own genuinely-rolling 60-day
      `get_history` call, split out from the one `topWatched` now uses — a
      streak spanning Dec 31 into January would otherwise look truncated for
      the first few days of a new year, since a Jan-1-onward window has no
      visibility into the prior year's plays.
- [x] `activity` (day-of-week / hour-of-day) intentionally left as a rolling
      30-day window, not calendar-month — "your viewing pattern over the last
      month" reads more useful than year-to-date, and stays meaningful in the
      first few days of a new month.
- [x] Guarded against `query_days` receiving a literal duplicate value (in
      January, days-elapsed-this-month and days-elapsed-this-year are
      numerically identical) by deduping before the request.
- [x] The hours-watched hero number's caption still hardcoded "Last 12
      months" from the old rolling window — updated to "Year to date" to
      match what it now actually shows.

## v1.10.2 — Releasing Soon: "Downloaded" now reads "Available now"

- [x] A movie on the Releasing Soon shelf that already has a file feels
      different from a TV episode that's aired and downloaded (Airing Today,
      unchanged) — "Available now" reads correctly for something you can
      watch tonight, where "Downloaded" read like a technical status. Scoped
      to just the Releasing Soon poster grid; Airing Today's own "Downloaded"
      label (and its detail-modal meta line) are a separate panel and
      intentionally untouched.

## v1.10.3 — Self-verifying deploy script

- [x] Bare `scp` of multiple files to docker-host's build context was
      observed twice to silently drop the largest file (`public/app.js`,
      ~65KB) with no error and exit 0, while the smaller files in the same
      command succeeded — not reproducible on demand (10/10 clean in
      isolated retesting, both solo and multi-file, and the destination is
      plain local ext4, not network storage), so likely a transient
      condition rather than a fixable deterministic bug. Rather than chase
      that further, built `deploy.sh`: rsyncs the working tree, then
      SHA-256-verifies every git-tracked file actually landed correctly
      before rebuilding — a dropped/corrupted file now fails loudly and
      stops the deploy instead of shipping unnoticed. Safe to re-run;
      rsync only re-transfers files that differ.
- [x] Reconciled `docker-compose.yml` with what was actually already running
      in production — the live container had Traefik routing labels/network
      that had been added directly on the host at some point and never
      synced back to git, so the checked-in file was stale relative to
      reality. Now identical; the deploy script would otherwise have
      silently overwritten production's Traefik config with the old
      host-port-mapping version on the next run.

## v1.10.4 — Fix: season-picker crash from the info modal; Plex-unconfigured startup crash

- [x] Requesting a TV show from the info modal (e.g. the hero banner's
      featured tag, or clicking a search result's poster/title rather than
      its Request button directly) called `openSeasonPicker()` without its
      `returnTabId` argument, throwing on `document.getElementById(undefined)`
      and breaking the request outright. Guarded both `openSeasonPicker` and
      `closeSeasonPicker` against a missing `returnTabId` (only the request
      modal's own tab system has one to hide/restore), and fixed the actual
      call site to also show `#request-modal` itself — the season picker
      lives inside it, so it rendered invisibly even once the crash was
      patched, since this entry point never opens the request modal the way
      every other season-picker call site does.
- [x] `lib/nowPlaying.js` assumed `PLEX_SERVER_URL`/`PLEX_ADMIN_TOKEN` are
      always set and connected to Plex's notification socket unconditionally
      at startup — a fresh/incomplete `.env` (first boot, before setup) would
      throw synchronously on the missing URL and crash the entire process,
      not just leave Now Playing empty. Added `plexConfigured()`, guarding
      `connectPlexSocket()` the same way `tautulliConfigured()` already
      guards Tautulli, with a log message instead of a hard crash.

## v1.11.0 — Monthly recap email: reusable template + data layer

- [x] New `lib/monthlyRecap.js`: per-user recap data for a specific past
      calendar month (defaults to the most recently completed one) — hours
      watched, plays, longest binge streak, Family Rank among everyone active
      that month, top 5 titles, and a "headliner" (the month's most-played
      title, grouped by `rating_key` the same way `computeTopWatched` in
      `lib/myStats.js` does). Deliberately its own functions rather than
      reusing `myStats.js`'s `computeStreak`/rank logic as-is: those are
      correctly built around "year to date" and "streak counting back from
      right now" (see v1.10.1), neither of which describes a month that's
      already over. `computeMonthlyRank` sums real per-user duration across
      an exact date range instead of leaning on `get_home_stats`, which can
      only express a trailing N-days-from-now window, not an arbitrary past
      month.
- [x] Tautulli's `before` param turned out fuzzy in testing (spilled a day
      past the requested cutoff) — fetches by `after` alone, same as every
      other Tautulli call in this codebase already does, and bounds the
      upper edge itself against each row's own unix `date` instead.
- [x] New `lib/monthlyRecapTemplate.js`: pure `renderMonthlyRecapEmail(data)`
      → HTML string. Same visual system as the dashboard itself — the three
      real fonts from `public/fonts/` (Space Grotesk / Inter / JetBrains
      Mono), the same dark palette, and a real still from the recipient's
      own top-watched title as the header image. Handles a quiet month
      (zero plays) without crashing — no headliner section, no rank number,
      just a plain message.
- [x] `fetchHeadlinerImage()` embeds the header art as a `data:` URI at
      generation time (same Tautulli-metadata-then-Plex-bytes shape as
      `routes/plex.js`'s `/image` proxy, just run server-side) rather than
      linking to it — most email clients block remote images by default,
      and this render is already per-recipient, so there's no shared-image
      caching being given up.
- [x] `lib/uptimeKuma.js` gained `getMonthlyUptime(monitorName, period)` for
      the recap's Service Status line. Guards against a low-sample month:
      found live that the `plex` monitor here logged only 8 heartbeats in
      all of July before its check interval was tightened in early August —
      an uptime percentage built from 8 samples would have been misleading,
      so this now requires at least one heartbeat per day of the period on
      average, returning `null` (quietly omitting the section) otherwise.
- [x] `test/monthlyRecap.test.js` covers the pure functions — month-boundary
      math (including a December→January rollover), longest-streak-in-range
      vs. myStats.js's live streak, and rank/headliner grouping — same
      `node:test` style as `test/myStats.test.js`.
- [x] Verified end-to-end against real data (Tautulli + the real Uptime Kuma
      DB, run inside the actual container): a real July 2026 recap for one
      user rendered correctly, uptime guard correctly returned `null` for
      July's sparse sample and a real percentage for a well-sampled window.
- [x] Sending is intentionally out of scope for this pass — no SMTP
      dependency exists in this project yet, no per-user email opt-in/
      unsubscribe tracking, no cron trigger. This ships the template and
      data layer only; wiring an actual send is future work.

## v1.12.0 — Monthly recap: real sending, routed through Tautulli

- [x] New `lib/mailer.js`: `sendEmail`/`sendEmailBatch`, routed through
      Tautulli's own Email notifier (`cmd=notify`) instead of adding a new
      SMTP dependency to this app. Two things forced its exact shape,
      confirmed live against Tautulli's own behavior rather than assumed
      from its docs:
      1. `notify` has no per-recipient override (`EMAIL.agent_notify` always
         reads the recipient from the notifier's own saved config) — sending
         to a specific person means updating that field immediately before
         triggering the send.
      2. `set_notifier_config` is a full replace, not a merge — omitting a
         field resets it to default. Confirmed live: a partial update (only
         changing the recipient) silently wiped the saved SMTP password.
         `get_notifier_config` can't be used to read the rest back first
         either, since Tautulli masks the password on read (returns four
         spaces, not the real value). So this app holds its own copy of the
         full SMTP config in `.env` (`EMAIL_SMTP_*`, `EMAIL_FROM*`,
         `TAUTULLI_EMAIL_NOTIFIER_ID`) and resends every field on every send.
- [x] **Incident, found and fixed during setup**: the first real end-to-end
      send used the unresized header image straight from Plex
      (`fetchHeadlinerImage` in `lib/monthlyRecap.js` had no width/height),
      producing a ~1.6MB email. POSTing that through Tautulli's `notify` API
      pinned its process at 100%+ CPU and stopped it from responding to
      *anything* — including its own live Plex activity polling — for
      several minutes, until the container was restarted. Root-caused, not
      just retried: `fetchHeadlinerImage` now goes through Tautulli's own
      `pms_image_proxy` at 1200x400 (the same size already proven to work
      fine, ~200KB, before this was wired into real code) instead of the
      unresized original.
- [x] Also caught before it caused the same failure twice: `lib/mailer.js`'s
      first version sent the `notify` call as a GET with the HTML body in
      `params` — fine for a plain-text test, but a 431 (request line too
      large) the moment a real recipient's email carries any real content.
      Switched to POST with a form-encoded body.
- [x] Verified end-to-end for real: a real July 2026 recap, sent to a real
      inbox, through the real Tautulli Email notifier, confirmed via
      Tautulli's own notification log (`success: 1`) after the fix — not
      just a syntax check.
- [x] Still not built: per-user opt-in/unsubscribe tracking (the template's
      unsubscribe link is still `href="#"`) and a monthly trigger (cron or
      otherwise) to actually run this for every user. `sendEmailBatch`
      exists and is sequential-by-design (concurrent sends would race on
      the notifier's single saved recipient field), but nothing calls it
      for the full user list yet.

## v1.13.0 — Monthly recap: unsubscribe/resubscribe

- [x] New `lib/recapUnsubscribe.js`: signs/verifies the unsubscribe link's
      token (HMAC-SHA256 of the user id, reusing `SESSION_SECRET` rather than
      adding a second secret to `.env`). Has to work without an active
      session — whoever clicks the link in their inbox isn't necessarily
      signed into the dashboard on that device — so the token itself is the
      authorization, not `requireAuth`. `buildUnsubscribeUrl(userId, baseUrl)`
      is what a future sender should call to put a real link in the email
      (the template's own default is still the placeholder `href="#"` until
      something wires this in).
- [x] New `lib/recapUnsubscribes.js`: persists opt-outs, same dedicated-
      sqlite-file pattern as `lib/pushSubscriptions.js`. **Found and fixed a
      real race while verifying live**, not just in theory: the shared
      lazy-`getDb()` pattern (open the file, fire off `CREATE TABLE IF NOT
      EXISTS` without waiting for it, return the connection) lets the very
      first query after a truly fresh file lose the race and fail with
      `SQLITE_ERROR: no such table`. Reproduced it reliably against a fresh
      file, then fixed by tracking a `ready` promise every query now awaits
      before running. `lib/pushSubscriptions.js` has the identical
      unguarded pattern — likely never hit in practice there only because
      its file was created long ago, not because the pattern is actually
      safe. Worth the same fix if it's ever touched again; not done here,
      out of scope for this pass.
- [x] New `routes/recap.js`: `GET /api/recap/unsubscribe` and `/resubscribe`,
      both public (no `requireAuth`), both return a small self-contained
      HTML confirmation page rather than JSON — a person clicks this from
      their inbox, not the app. Registered in `server.js` alongside the
      other `/api/*` mounts.
- [x] `test/recapUnsubscribe.test.js` covers the token logic (accepts a
      real token, rejects one signed for a different user, rejects
      garbage/missing tokens).
- [x] Verified end-to-end for real, through the live public domain (not
      just `docker exec`): a real signed link hit the deployed site, correctly
      unsubscribed, a tampered token correctly got a 403, and resubscribing
      flipped the DB row back — confirmed via `isUnsubscribed()` after each
      step, not assumed from the HTTP response alone.
- [x] Still not built: nothing calls `buildUnsubscribeUrl` or checks
      `isUnsubscribed` from an actual send yet — there's still no monthly
      batch/cron trigger (see v1.12.0's own note). This ships the opt-out
      primitive itself, ready for whenever that trigger exists.

## v1.14.0 — Monthly recap: activity threshold + owner-selected sending

- [x] `lib/monthlyRecap.js` gained `MIN_MONTHLY_PLAYS` (5) and
      `computeCandidates`/`listRecapCandidates` — everyone with at least 5
      real plays in the given month, cross-referenced against Tautulli's
      user list for name/email, sorted by plays descending. Pure compute
      function (`computeCandidates`) separate from the fetch, same split as
      everything else in this file.
- [x] New owner-only routes in `routes/recap.js`: `GET /candidates` (the
      eligible list, each row flagged with current unsubscribe status) and
      `POST /send` (`{ userIds: [...] }`). Deliberately no "send to
      everyone" endpoint — the owner reviews `/candidates` and sends only
      the `userIds` they actually pass in. `/send` re-derives the eligible
      list itself rather than trusting whatever the client saw when it
      called `/candidates` earlier, so the threshold/eligibility check
      holds at send time, not just at review time.
      Real per-recipient handling: skips (with a reason) anyone not in the
      eligible list, anyone with no email on file, and anyone who's
      unsubscribed — checked again here even though `/candidates` already
      flags it, since a real `/send` call could theoretically arrive with
      stale `userIds` gathered from an older `/candidates` response.
      Builds each recipient's own real unsubscribe link
      (`buildUnsubscribeUrl`) into their email — the first thing to
      actually pass a non-placeholder link into the template.
- [x] Verified the eligibility computation against real July 2026 data: 39
      of 48 active users met the 5-play threshold, correctly sorted,
      correctly cross-referenced for name/email. Verified both new routes
      correctly reject unauthenticated requests. Could not verify the full
      authenticated owner click-through here — that needs a real Plex OAuth
      browser session, not something curl can produce.
- [x] `test/monthlyRecap.test.js` gained 3 more cases for
      `computeCandidates` (threshold filtering, sort/name/email mapping,
      fallback to userId when a user has no friendly_name).
- [x] Still not built: a monthly cron/trigger. This is now a real,
      usable owner workflow (list candidates, pick who, send) but someone
      still has to call it — nothing runs it automatically yet.

## v1.15.0 — Monthly recap: Newsletter tab in Settings

- [x] New "Newsletter" tab in the admin Settings modal (after Notice
      Board), same lazy-loaded tab pattern as Services/System Status/Recent
      Sign-ins/Notice Board. Lists this month's eligible candidates
      (`GET /api/recap/candidates`) as a checkbox list — name, plays, hours,
      and a visible note (disabled + greyed out) for anyone unsubscribed or
      missing an email. "Select All" only selects the actually-selectable
      rows. Send button shows the live count ("Send Recap to N"), confirms
      before sending ("This sends real email right now"), and reports back
      sent/failed/skipped counts from the real `POST /api/recap/send`
      response.
- [x] This is the actual answer to "where do I go to select who to send
      it to" — until now `/candidates` and `/send` only existed as raw API
      endpoints with no way to use them short of a manual authenticated
      HTTP request.
- [x] New CSS (`.newsletter-candidate-row`) — first checkbox-select list in
      this app; everything else reused existing classes (`now-title`,
      `now-meta`, `pill-btn`, `btn-primary`, `settings-status`,
      `confirmDialog`).

## v1.16.0 — Monthly recap: end-of-month reminder

- [x] New `lib/recapReminder.js`: reminds the owner via push notification
      (same channel `lib/issueWatchdog.js` already uses) to go review and
      send last month's recap from the admin Newsletter tab. There's no
      auto-send anywhere in this feature by design (see v1.14.0's note),
      so without a reminder it's easy to just forget the whole thing exists
      some months.
- [x] In-process `setInterval` scheduler (checked every 6h), same shape as
      `lib/issueWatchdog.js`/`lib/nowPlaying.js` — this app has no external
      cron to hook into, so "the monthly cron trigger" from the last few
      entries' own "still not built" notes turned out to mean this, not a
      system-level cron job.
- [x] Fires once within the first 3 days of a new month (a grace window,
      not exactly the 1st — if the app/host happens to be down right at the
      boundary, it still catches up instead of silently missing the whole
      month), tracked against a persisted "last reminded month" so it never
      double-fires. Own dedicated sqlite file, built with the `ready`-promise
      pattern from v1.13.0's fix from the start, not retrofitted after
      hitting the same race again.
- [x] The push notification body includes the real eligible-candidate count
      for that month (via `listRecapCandidates`), not just a generic
      "check your email" — e.g. "12 people are eligible for July 2026's
      recap."
- [x] `test/recapReminder.test.js` covers the pure scheduling logic
      (`shouldRemind`/`monthKeyOf`) — grace window boundaries, already-
      reminded-this-month suppression.
- [x] Verified live: DB initializes cleanly on a truly fresh file (no
      crash, no error log), and — since today is past the grace window —
      correctly stays silent rather than firing, confirmed against the real
      current date rather than assumed from reading the code.

This closes out the monthly recap feature end to end: real per-user data,
a real template, real sending through Tautulli, unsubscribe/resubscribe,
an activity threshold, owner-selected recipients through a real UI tab, and
now a reminder so the whole thing actually gets used monthly instead of
forgotten.

## v1.17.0 — Monthly recap send ledger and duplicate prevention

- [x] New `lib/recapSendLog.js` persists a state row per recipient/month and
      a durable record for every attempt in `recap-sends.sqlite`: sending,
      sent, or failed; start/completion times; requesting owner; resend flag;
      and a bounded error message. The Newsletter tab shows the recent
      history instead of requiring a Tautulli container-log search.
- [x] Sending now atomically claims each recipient/month before generating
      or delivering the message. A double-click or concurrent request sees
      `sending` and skips; a completed send sees `sent` and skips. Failed
      attempts remain retryable without special handling.
- [x] A process crash cannot leave a recipient permanently locked in
      `sending`: active claims block duplicates for 15 minutes, after which
      an abandoned claim is safely reclaimable.
- [x] Resending a successful month requires an explicit `resend:true` API
      flag and an owner-visible "Allow explicit resends" checkbox. Already-
      sent candidates are disabled by default and annotated with when they
      were sent. This preserves intentional resends without making duplicate
      delivery an easy accident.
- [x] Added focused SQLite-backed tests for first claims, concurrent
      duplicate suppression, successful-send blocking, explicit resends,
      failed-send retry, and the new stable `YYYY-MM` period key.

## v1.18.0 — Security and owner-action audit log

- [x] New `lib/auditLog.js` writes a dedicated `audit.sqlite` trail for
      successful/denied Plex sign-ins, verification errors, sign-out,
      newsletter unsubscribe/resubscribe events, unauthorized mutations,
      and every authenticated owner POST/PUT/PATCH/DELETE after its real HTTP
      result is known.
- [x] Privacy boundaries are structural: request bodies are never stored,
      user agents are length-limited, IPv4 addresses are reduced to `/24`
      and IPv6 to `/64`, event detail is bounded, and records expire after
      180 days. This gives enough context for incident review without
      quietly building a permanent full-IP activity database.
- [x] New owner-only `GET /api/owner/audit` and an Audit Log tab under
      Settings show the latest actor, action, result, time, and masked
      network. Added tests for IP masking and normalized event persistence.

## v1.19.0 — Current Plex uptime in the footer

- [x] Both authenticated page footers now show Plex's current uninterrupted
      uptime beside the app version (for example, `Plex uptime 2d 16h`) and
      refresh it once a minute. A current down state reads `Plex down`; an
      unconfigured or stale monitor stays hidden instead of presenting an
      old heartbeat as current health.
- [x] New authenticated `GET /api/uptime-kuma/plex-uptime` reads the existing
      Uptime Kuma database mount. The streak begins at the first successful
      heartbeat after the most recent non-up heartbeat—not at container
      startup and not at an arbitrary calendar boundary.
- [x] Added unit coverage for up/down/stale/missing monitor states. The full
      suite is now 118 tests.

## v1.19.1 — Footer label uses lowercase plex

- [x] Changed the new footer status copy from `Plex uptime` / `Plex down` to
      lowercase `plex uptime` / `plex down` to match the requested styling.

## v1.20.0 — Newsletter admin configuration UI

- [x] Email/recap SMTP config (`TAUTULLI_EMAIL_NOTIFIER_ID`, `EMAIL_SMTP_*`,
      `EMAIL_FROM*`) is now a first-class entry in `lib/serviceRegistry.js`,
      which means it gets the exact same Settings → Services treatment as
      every other integration (live health check, "Edit" popup, secret
      masking) with zero new frontend code — the existing service-card
      system is already fully data-driven off that registry.
- [x] New `checkEmail()` in `lib/serviceHealth.js` — deliberately doesn't
      send anything on every Settings-modal open. Confirms the configured
      Tautulli notifier actually exists and is really an `email` agent
      (catches the most common misconfiguration, a wrong/stale
      `TAUTULLI_EMAIL_NOTIFIER_ID`, with zero side effect).
- [x] New `POST /api/recap/test-email`, and a "Send Test Email" button at
      the top of the Newsletter tab. Sends a small, clearly-labeled test
      message through the *exact* same `lib/mailer.js` path a real recap
      uses, so success here means the whole pipeline (SMTP credentials,
      Tautulli's notifier, network path) is actually confirmed end to end —
      not just that config values are present. Defaults the recipient to
      the requesting owner's own email (looked up from Tautulli by their
      Plex session user id) so the common case needs no typing.
- [x] Verified for real: the health check confirms the real configured
      notifier; the test-send resolved the real owner email
      (`m.abrahams@me.com`) automatically and the message landed,
      confirmed via Tautulli's own notification log (`success: 1`) — same
      standard as every other piece of this feature all along, not just a
      code read.

## v1.21.0 — Database lifecycle: automated backups + integrity checks

- [x] New `lib/dbBackup.js` — every `*.sqlite` file in `SESSION_DB_DIR` (9
      of them: sessions, notices, alerts, logins, push subscriptions, recap
      unsubscribes/reminders/sends, audit log) previously had zero backup
      path at all. A lost or corrupted data volume meant losing all of it
      with no recovery option.
- [x] Runs `PRAGMA integrity_check` on each database *before* backing it
      up — a database that's already corrupt is skipped and flagged in the
      manifest, not silently copied forward under a reassuring "backup
      completed" label.
- [x] Backs up via `VACUUM INTO`, not a raw file copy — confirmed live
      against the real `sqlite3` driver in this container (v3.52.0) that
      it produces a consistent snapshot of a live/open database. A plain
      copy risks an inconsistent read against a database with pending WAL
      writes; `VACUUM INTO` goes through SQLite's own transactional
      machinery and is documented as safe to run against a live database.
- [x] Runs automatically once a day (in-process `setInterval`, same
      scheduler shape as `lib/issueWatchdog.js`/`lib/recapReminder.js` —
      this app has no external cron to hook into), writing each run into
      `data/backups/<ISO-stamp>/` alongside a `manifest.json`. Backup
      directories older than 14 days are pruned automatically.
- [x] New owner-only routes: `GET /api/owner/db-backups` (recent history,
      read straight from the manifest files on disk — no new database
      needed to track backup history) and `POST /api/owner/db-backups/run`
      (manual trigger, audit-logged, same pattern as `/audit`).
- [x] New "Database Backups" section on Settings → System Status: shows
      recent runs with per-database pass/fail, and a "Run Backup Now"
      button.
- [x] Tests cover the retention/pruning cutoff logic, a full backup round
      trip against a real sqlite file, and confirm a deliberately corrupted
      file is skipped rather than backed up.
- [x] Deliberately scoped out: a formal schema-migration/versioning
      framework. Every table so far is `CREATE TABLE IF NOT EXISTS` and
      additive-only across 9 small, single/few-table databases — a
      migration framework would be disproportionate engineering for the
      app's actual current scale. Worth revisiting if a future change ever
      needs to alter or drop a column on data that must be preserved.
- [x] Restore is manual by design (documented in README): stop the
      container, copy the desired backup's `.sqlite` files over the live
      ones in `data/`, restart. No one-click restore button — a destructive
      action like overwriting live data with a backup shouldn't be a single
      accidental click away.

## v1.22.0 — Disk-backed image cache for Plex artwork

- [x] New `lib/mediaCache.js` — every movie/TV poster and thumbnail on the
      site previously round-tripped live to Plex on every single page
      load, for every visitor. Content-addressed disk cache (SHA-256 of
      the upstream path, spread across `<cachedir>/<first2>/<hash>`
      subdirectories) means Plex gets hit once per image, ever.
- [x] Atomic writes: data + metadata go to `*.tmp`, get fsynced, then
      renamed into place — a crash mid-download can never result in a
      truncated file being served as valid.
- [x] In-flight request dedupe via a key→Promise map cleared in a
      `finally` block — concurrent requests for the same not-yet-cached
      image share one upstream fetch, and a failed fetch never poisons
      the key for the next request.
- [x] The cache key doubles as the ETag (the upstream path is itself
      content-versioned by Plex, same assumption the old proxy route
      already relied on) — `If-None-Match` returns 304 without touching
      disk.
- [x] Mounted at bare `/img`, not `/api/img` — the existing service
      worker's fetch handler only skips `/api/`, so this gets client-side
      SW caching too, for free, with zero service-worker changes.
- [x] `lib/plexImage.js`'s `imageUrl()` — the single choke point every
      image URL on the site goes through — now points at `/img` instead
      of the old uncached proxy, confirmed with the user before making
      the switch live for every visitor.
- [x] LRU pruning by total bytes (not file count) on a 15-minute timer,
      evicting oldest-accessed-first down to 90% of `IMAGE_CACHE_MAX_BYTES`
      (default 1GB) — never inline on a request.
- [x] New "Image Cache" section on Settings → System Status: size/entry
      count, and a confirm-gated Flush Cache button.
- [x] Scope note: covers Plex-library artwork only (Now Playing, recently
      watched, top-of-month, in-library search/browse). Discover/request
      posters come from Overseerr/TMDB directly (never touched Plex to
      begin with) and user profile avatars are public plex.tv CDN URLs
      already served unproxied — neither needed or got this cache.
- [x] Verified live end to end: real family browsing traffic populated
      real cached entries before this was even fully built out; a warm
      hit served in 6ms with zero upstream calls; flush genuinely emptied
      the cache directory on disk; LRU eviction ordering confirmed via a
      dedicated test against a real tiny-cap scenario.

## v1.22.1 — Fix desktop scroll stutter

- [x] Root cause: `body { background-attachment: fixed }` on the page's
      gradient background, combined with 14+ `.card` elements each
      running `backdrop-filter: blur(20px)` on the bento grid. Desktop's
      wider viewport shows far more of those blurred cards at once than
      mobile's single-column stack, and `background-attachment: fixed`
      forces a slower repaint path in several desktop browsers — the
      layer-promotion hint on cards alone barely helped, since the
      underlying scroll itself was still stuck off the compositor thread.
- [x] Fix preserves the exact same visual result: replaced
      `background-attachment: fixed` with a `position: fixed; z-index: -1`
      `.bg-fixed` div holding the same gradients — pixel-identical (stays
      put behind everything while scrolling) but composites on the GPU
      properly instead of falling back to the slower path. Added
      `will-change: transform` to `.card` alongside it so each card
      composites independently. Zero visual/design change — confirmed
      by the user after testing on the live site ("much much better").

## v1.22.2 — Fix Alerts panel: truncated fix suggestions, row alignment

- [x] Root cause of the truncated "Suggested fix" text (would cut off
      mid-word, e.g. "...temporarily bans an"): `lib/cliproxyClient.js`'s
      `complete()` capped every suggest-fix completion at 300 tokens, but
      the prompt's own "2-4 concise sentences" instruction doesn't reliably
      hold — a genuinely compliant, detailed technical answer can already
      run close to that cap on its own. Raised to 500 tokens, and added a
      `trimToLastSentence()` safety net (new, tested) that trims back to
      the last complete sentence on the rare response that still hits the
      cap, using Anthropic's own `stop_reason: "max_tokens"` so it only
      ever fires on a genuine truncation.
- [x] Found and fixed a real bug in that safety net during testing:
      `lastIndexOf('. ')` requires a trailing space after the period, which
      misses the *final* sentence of an already-complete response (nothing
      follows its closing period) — would have silently dropped the last
      sentence of every properly-terminated suggestion. Rewrote using a
      regex requiring punctuation followed by whitespace or end-of-string.
- [x] Fixed `.pending-row`'s default `align-items: center` pinning the
      Suggest fix/Dismiss buttons to the vertical middle of a much taller
      wrapped-paragraph alert instead of the top — scoped the fix to
      `#alerts-body` specifically so Wanted/Missing and other lists that
      share `.pending-row` (correctly centered for their single-line
      content) aren't affected.
- [x] The Suggest fix button now relabels to "Refresh suggestion" once a
      suggestion is already showing, instead of silently staying labeled
      "Suggest fix" right next to a suggestion that's already there.
- [x] Verified live against the exact real alert that surfaced this
      (`sonarr:log-triage`, a qBittorrent 409 auth issue) — the real
      completion now ends cleanly on a full sentence with proper
      punctuation, confirmed via direct in-container call, not just tests.

## v1.23.0 — Suggest-fix: numbered steps + copy button

- [x] `routes/alerts.js`'s `FIX_PROMPTS` now request a bare numbered list
      (2-4 steps, one per line, nothing before or after) instead of "2-4
      concise sentences" — a wall of prose read poorly as something to
      actually follow while working through a fix by hand.
- [x] New `parseFixSteps()` in `admin.js` turns that into a real `<ol>`,
      stripping the model's own "1. "/"2. " prefixes since the list
      element numbers them; falls back to one step per line (or the whole
      text as a single step) if the model doesn't perfectly comply, so
      nothing is ever silently dropped for a format miss.
- [x] `lib/cliproxyClient.js`'s truncation safety net reworked for the new
      line-based format: `trimIncompleteTrailingStep()` drops the whole
      trailing line unconditionally on a genuine truncation
      (`stop_reason: "max_tokens"`), rather than trying to find a sentence
      boundary inside a line that's already known to be untrustworthy.
- [x] New Copy button next to each suggestion — copies a plain numbered
      list to the clipboard so the steps are easy to reference while
      you're actually in Sonarr/qBittorrent's settings doing them. Fails
      quiet (no alert) if the Clipboard API is unavailable — the steps are
      still right there on screen to select manually.
- [x] Verified live against the real `sonarr:log-triage` alert: raw
      completion came back as a clean 4-line numbered list, parsed
      correctly into 4 discrete steps with no leftover numbering.
- [x] Deliberately scoped out for now (contemplating separately): any
      "auto fix" action that would let the agent actually execute a
      suggested step — current design stays strictly read-only/manual.

## v1.24.0 — One safe, one-click action: test download client connection

- [x] Resolves the auto-fix-vs-manual-fix question from earlier: no
      Docker socket access exists or was added (that would let this app
      control arbitrary containers on the host — a much bigger surface
      than anything else in this app). Instead, the only "auto action"
      offered is a genuinely safe, reversible, read-only one: testing a
      Sonarr/Radarr download client's connection via *arr's own `/test`
      API — the same call its own UI's "Test" button makes. Never mutates
      anything; a failed test changes no saved configuration.
- [x] New `lib/downloadClientTest.js` — `matchDownloadClient()` is a pure,
      deterministic string match against the alert's own already-known
      title/detail text, checked against Sonarr/Radarr's *actually
      currently configured* download clients. Never LLM-driven — the
      model's suggestion text has zero influence over what action gets
      offered, only the alert's own persisted fields do.
- [x] `POST /:key/suggest-fix` now also returns an `action` alongside the
      suggestion when one matches. New `POST /:key/actions/test-download-
      client` re-derives the match from scratch server-side rather than
      trusting anything client-supplied — worst case even a forged direct
      call can only trigger a harmless connection test against one of the
      owner's own already-configured clients.
- [x] Verified against a real, live failure (not synthetic): qBittorrent
      happened to be genuinely unreachable during testing (a real
      ECONNRESET, unrelated to this feature) — the test correctly reported
      `{ok: false, message: "Unable to connect to qBittorrent"}` with a
      clean 200 response, not a crash. Also verified the success path
      earlier against the real API directly. Full suggest-fix -> action
      round trip confirmed end to end through the real mounted route.
- [x] 5 new tests for `matchDownloadClient`'s matching logic (149/149
      total passing).

## v1.24.1 — Alert rows: app icon badges

- [x] Alert rows now carry a colored app-monogram badge (SO/RA/PR/OV/DL,
      each app's own real brand color) in the same leading-image slot
      Wanted/Missing rows use for a poster — alerts have no media poster
      of their own, so this fills that slot with something that still
      identifies at a glance what the row is about.
- [x] New `APP_ICONS`/`appIconInfo()` in `admin.js`, covering every `app`
      value the alert pipeline actually reports (sonarr/radarr/prowlarr
      from arr-health-watchdog.mjs, overseerr/downloads from
      lib/issueWatchdog.js), with a graceful initials-based fallback for
      anything unrecognized rather than a blank badge.
- [x] Row structure/spacing was already shared with Wanted/Missing via the
      same `.pending-row` class — this was the one piece actually missing
      to make Alerts read the same way. Verified live against the real
      open `sonarr:log-triage` alert.

## v1.24.2 — Fix alert severity dot touching the title text

- [x] `updateAlertRow` was setting the dot's `className` directly to
      `alertSeverityDotClass()`'s result (e.g. `"state-dot warning"`),
      which silently replaced the element's `alert-dot` class entirely —
      the `.result-title .alert-dot { margin-right: 0.4rem }` spacing rule
      never actually matched anything once JS ran, pinning the dot right
      up against the title with no gap. Now preserves `alert-dot` alongside
      the severity classes.

## v1.24.3 — Fix Alerts action buttons overflowing off-screen on mobile

- [x] `.pending-row` never wraps by default, so on a phone-width viewport
      the Suggest fix/Refresh suggestion + Dismiss buttons (and, since
      v1.24.0, the Test Connection button) had nowhere left to go next to
      the icon and title and were simply overflowing off the right edge
      of the screen instead of dropping to their own line.
- [x] Scoped to `#alerts-body` specifically (same scoping already used for
      the row-alignment fix) rather than touching `.pending-row` globally,
      so Wanted/Missing and other lists sharing that class are unaffected.
      Under 900px, the row wraps and the action buttons take a full-width
      second line, indented to line up under the title text rather than
      the icon.

## v1.24.4 — Fix container running in UTC instead of local time

- [x] Root cause of "Airing Today shows tomorrow's episodes before
      midnight": the container had no `TZ` set at all, defaulting to UTC —
      confirmed live, the container's own clock was reporting Aug 9 04:21
      UTC while it was actually Aug 8 23:21 CDT, a full calendar day
      ahead. `routes/sonarr.js`'s `localDateString()` uses JS's local-time
      getters (`getFullYear`/`getMonth`/`getDate`), which follow whatever
      timezone the container itself is set to — not the user's actual
      location — so "today" was being computed a day early every night
      after ~7pm Central.
- [x] Fixed at the source: added `TZ=America/Chicago` to the container's
      environment in docker-compose.yml (matching the same timezone
      already used for Kometa's own scheduler in this deployment) rather
      than patching the date logic itself — this fixes "today" everywhere
      it's computed server-side, not just Airing Today specifically.
- [x] Verified live: container's own clock now reports the correct local
      time and `localDateString(new Date())` returns the correct calendar
      date, confirmed against real wall-clock time at the moment of the fix.

## v1.24.5 — Add pull-to-refresh for the installed PWA

- [x] Standalone/installed PWAs lose the browser's native pull-to-refresh
      gesture entirely — it's chrome-level behavior tied to the address
      bar, which disappears once the app runs without browser UI. The
      dashboard's own data already refreshes on its own timers, but
      there was no manual "pull down to force it now" gesture once
      installed.
- [x] Added `public/pull-to-refresh.js`: a small vanilla-JS touch handler,
      gated to only attach in standalone mode (checks
      `display-mode: standalone`), so it never doubles up with a normal
      browser tab's native gesture. Wired to a new `refreshDashboard()`
      in app.js, which re-runs everything `showDashboard()` loads minus
      the one-time setup calls (`connectNowPlayingStream()` opens its own
      persistent EventSource — calling it again would open a second one).
- [x] Verified live: no console errors on load, and the touch-pull mechanics
      themselves confirmed correct via synthetic touch events (bypassing the
      standalone-mode gate) — threshold detection, ready-state, and the
      release correctly triggering `refreshDashboard()` (Sleeper's own
      `refreshLive()` equivalent) — all checked directly against the
      deployed script.

## v1.25.0 — "Search All" for Wanted/Missing

- [x] Added a **Search All** button next to the Wanted/Missing subhead
      (CH.09 Family) that triggers Radarr's/Sonarr's own automatic search
      — the same action their native "Search All Missing" buttons trigger
      — for every item currently on the list, instead of the existing
      per-row Search button's interactive release-search modal (still
      there, unchanged, for reviewing candidates on one item at a time).
- [x] `lib/radarrClient.js`/`lib/sonarrClient.js`: `fetchMissingMovies`/
      `fetchMissingEpisodes` now also carry through the item's own
      Radarr/Sonarr internal id (distinct from tmdbId/tvdbId), and new
      `searchMissingMovies`/`searchMissingEpisodes` POST Radarr's/
      Sonarr's `/api/v3/command` (`MoviesSearch`/`EpisodeSearch`) — lets
      Radarr/Sonarr pick releases per their own real quality-profile/
      indexer rules instead of this app re-implementing that logic.
- [x] New `POST /api/owner/wanted/search-all` (`routes/owner.js`)
      re-fetches the Wanted/Missing list itself server-side rather than
      trusting ids from the client, so it always searches what's
      actually still missing right now. One service being unreachable
      doesn't block the other. Logged to the audit trail like other
      owner bulk actions (db backup, cache flush).
- [x] Fires the search and returns immediately — doesn't wait for
      Radarr/Sonarr to finish (same as their own native buttons); the
      existing 60s Wanted/Missing auto-refresh picks up whatever gets
      grabbed and imported on its own.
- [x] Verified live against the real Radarr/Sonarr instances (bypassing
      HTTP/auth, direct function calls): 13 missing movies + 30 missing
      episodes found, 100% of ids resolved correctly, both
      `MoviesSearch`/`EpisodeSearch` commands dispatched successfully.
      Confirmed the new route is registered and gated by the same
      auth/CSRF-origin middleware stack as every other owner POST route
      (401/403 behavior matches `media-cache/flush`). All 144 existing
      tests still pass.

## v1.26.0 — "Dismiss All" for Alerts

- [x] Added a **Dismiss All** button next to the Stack Health subhead
      (CH.08 Alerts), same placement pattern as v1.25.0's Search All
      button. Confirmed before running (`confirmDialog`) — unlike Search
      All, which is purely additive, this hides real still-open problems
      from view, so a misclick has a real cost.
- [x] `lib/alerts.js`: new `acknowledgeAll()` — bulk version of the
      existing single-alert `acknowledge()`, same soft-dismiss semantics
      (sets `acknowledged_at`, never deletes the row). A dismissed alert
      still reappears on its own through the normal `reconcile()` path
      if the same problem escalates or gets reopened later.
- [x] New `POST /api/alerts/dismiss-all` (`routes/alerts.js`), scoped
      exactly like `listOpen()` reads (`status='open' AND
      acknowledged_at IS NULL`) so it only ever touches what's actually
      showing right now.
- [x] No new tests — `acknowledgeAll()` is a direct DB-mutating function,
      same (untested) category as `acknowledge()` itself; the pure
      `planReconciliation()` this all ultimately feeds into is already
      covered in `test/alerts.test.js`. All 144 existing tests still pass.

## v1.26.1 — Fix: "Suggest fix" now tries a free local model before Claude

`lib/cliproxyClient.js` (the owner-triggered "Suggest fix" button, CH.08
Alerts) had a single provider tier — any CLIProxyAPI/Claude hiccup meant
the button just failed. Same pattern already shipped for
`arr-health-watchdog.mjs`'s log-triage: try a free local model
(qwen2.5:7b-instruct on a Mac mini's Ollama, reached through CLIProxyAPI's
OpenAI-compat passthrough) first, fall back to Claude only if that fails.

- [x] New `completeWithOllama()` / `completeWithClaude()`, split out of
      the old single `complete()` body. `complete()` tries Ollama first,
      falls through to Claude on any failure (network error, empty
      response). Same truncation safety net on both paths — Ollama's
      `finish_reason === 'length'` mirrors Claude's `stop_reason ===
      'max_tokens'` check already in place.
- [x] New `OLLAMA_PROXY_URL`/`OLLAMA_MODEL` in `.env` (not committed).
- [x] Verified live: a real completion via Ollama, and (with
      `OLLAMA_PROXY_URL` forced unreachable) a real fallthrough to Claude
      producing a correct suggestion. All 4 existing
      `test/cliproxyClient.test.js` tests still pass unchanged — they only
      cover `trimIncompleteTrailingStep`, not the network path.
- [x] No WebSearch/tool-calling involved on either path (this button
      never had any), so this is a straightforward reliability upgrade,
      not a quality tradeoff like the Sleeper injury-advisor fallback.

## v1.27.0 — qbit-disk-guard alerts: full removed-file list, expand-on-click

`qbit-disk-guard.mjs`'s Marquee alert only ever said "removed N torrents,"
never which ones. Added a "See list" toggle (CH.08 Alerts), same
expand-in-place pattern as Suggest fix, but purely local — the full list
already arrives with the alert, no API round-trip needed.

- [x] `qbit-disk-guard.mjs`: `detail` now carries the full (untruncated)
      removed-file list after a `###FILES###` marker line — the always
      -visible summary stays short, the marker section is parsed out
      client-side. No alerts-table schema change (`detail` was already a
      free TEXT column).
- [x] `public/admin.js`: new `splitDetailAndFiles()` parses the marker;
      alert rows unaffected by it (no marker present) render exactly as
      before. New "See list" pill button + collapsed `<ul>` panel, styled
      like `.fix-suggestion` but neutral-toned (`.alert-file-list-block`
      in `style.css`) since this is informational, not a suggested fix.
      Re-populates on every 30s poll but only forces the panel closed if
      the file list disappears entirely — doesn't fight an already-open
      panel shut on every poll.
- [x] Verified: full 144-test suite still passes; a synthetic alert
      ingested with a real `###FILES###` payload round-tripped correctly
      through `lib/alerts.js` storage and back out; `splitDetailAndFiles()`
      tested directly for both the marker and no-marker cases. Not
      verified in an actual browser click-through this session (no
      browser tooling available) — logic/plumbing confirmed, not a
      pixel-level check.

## v1.27.1 — Fix: Import Issues "Remove" no longer deletes the file or blocklists

`routes/sonarr.js` and `routes/radarr.js`'s `DELETE /queue/:id` (the "Remove"
button on the admin Import Issues panel) used `removeFromClient: true,
blocklist: true` — clicking it deleted the actual downloaded file/torrent
and permanently blocked Sonarr/Radarr from ever grabbing that release
again. Neither was intended; the button was only meant to clear a stuck
item off the queue view.

- [x] Both routes now use `removeFromClient: false, blocklist: false` —
      Remove only clears Sonarr/Radarr's own queue, the file/torrent is
      left completely untouched, and the release can be grabbed again
      later if it ever becomes relevant.
- [x] Same "don't delete, don't blocklist" decision already applied
      earlier this session to `arr-reject-cleanup.mjs`'s automated
      handling of "not an upgrade" queue rejections — this keeps the
      manual button and the automated path consistent.
- [x] All 144 existing tests still pass unchanged (no test coverage for
      this route's specific params either before or after).

## v1.28.0 — Disk Space trend: sparkline + "days until full" projection

The Admin Stack panel's Disk Space section only ever showed a current
snapshot — no way to tell whether a volume was steadily filling up or just
temporarily tight. Added hourly history + a linear-regression projection,
surfaced right in the existing panel.

- [x] `lib/diskSpaceHistory.js` (new) — hourly in-process poller, same
      `setInterval`-scheduler shape as `lib/issueWatchdog.js`/
      `lib/recapReminder.js`/`lib/dbBackup.js` (this app has no external
      cron to hook into). Owns its own `diskspace-history.sqlite`, same
      one-file-per-concern convention as alerts/notice/sessions. 90-day
      retention, pruned on every poll — trivial row count (~2160 rows per
      volume) at that cadence.
- [x] `getCurrentRows()` — the real-filesystem-first, Radarr/Sonarr-fallback
      fetch logic that used to live inline in `routes/owner.js`'s
      `GET /diskspace` moved here, so the live route and the periodic
      poller read current disk space through the exact same path instead
      of two copies that could drift apart. `routes/owner.js` now just
      calls it.
- [x] New `GET /api/owner/diskspace/history` — history + projection per
      volume, keyed by the same combined/shortest label the current-state
      route already uses (that labeling is already deterministic —
      `combinedLabelRows` sorts before joining — so it's a stable join key
      across snapshots).
- [x] `lib/diskspace.js`: new pure `projectDaysUntilFull(history)` —
      ordinary least-squares slope of free bytes over time rather than
      just first-vs-last, so one noisy reading (a big torrent finishing
      then moving off-volume, say) doesn't single-handedly swing the
      projection. Returns `null` — not a misleading number — for fewer
      than 2 samples, flat/growing space, or same-instant samples.
- [x] `public/admin.js`/`style.css`: hand-rolled sparkline (`<polyline>`,
      own min/max scale per volume) and a "~X days left" label under each
      volume's existing free/total row, colored amber under 30 days, red
      under 14. History fetch failing doesn't blank the panel — the
      current-state rows it already had still render fine without a trend
      line.
- [x] Real bug caught and fixed during this build, not just theoretical:
      `getDb()`'s `CREATE TABLE` immediately followed by a dependent
      `CREATE INDEX` raced on the very first startup against a brand-new
      file — no ordering guarantee between separate `db.run()` calls
      without `db.serialize()` — and crashed the whole process (the
      index's own uncallbacked `db.run()` had nowhere for its error to go
      but an uncaught `'error'` event). Every other lazy-`getDb()` module
      in this app (`alerts.js`, etc.) only ever issues one schema
      statement, so none of them were exposed to this. Fixed with
      `db.serialize()` plus error callbacks on both statements —
      confirmed clean on a from-scratch file after the fix.
- [x] Verified against live data, not just the test suite: `getCurrentRows()`/
      `recordSnapshot()`/`getHistoryWithProjection()` run directly inside
      the container against the real NAS volumes, correct real byte counts
      and labels (`tv2`; `comics, movies, tv, workouts`; `anime2, tv3`).
      Not verified in an actual logged-in browser session this session (no
      credential entry into the app's own login — same boundary as every
      other live-UI check this project has had) — logic/plumbing/live-data
      confirmed, not a pixel-level check.
- [x] 151 tests passing (was 144): `projectDaysUntilFull` covered for
      too-few-samples, straight-line shrink, flat/growing, same-instant
      samples, order-independence/noisy-sample robustness via least
      squares, and the negative-days floor; `pruneOld` covered against a
      temp sqlite dir, same shape as `dbBackup.test.js`. Deliberately not
      unit-testing `getCurrentRows()`/`recordSnapshot()` themselves — same
      scope split as the rest of this app's tests, live Radarr/Sonarr/
      mediaStorage integration isn't mocked, it's checked live instead
      (see the bullet above).

## v1.29.0 — "Because you watched X" personalized recommendations

Trending (the request modal's default view) was global — same feed for
every family member. Added a personalized companion strip above it, seeded
by each signed-in user's own most recent watch.

- [x] New `GET /api/overseerr/recommendations` (`routes/overseerr.js`) —
      pulls this user's own Tautulli history (`user_id` filter, same
      personalization source as My Stats/Recently Watched — Tautulli uses
      the Plex account id directly, no separate mapping needed), resolves
      the most recent distinct watch to a TMDB id via `get_metadata`'s
      guids (`lib/guid.js`'s existing `extractTmdbId`, same show-not-
      episode grouping as `lib/myStats.js`'s `computeTopWatched`), then
      calls Overseerr's own `/movie|tv/{id}/recommendations` (TMDB's
      recommendations, proxied — same response shape as `/discover`, so
      `mapDiscoverItem` and its not-owned/not-requested filter both apply
      completely unchanged).
- [x] Walks back through up to the last 10 distinct watches rather than
      only ever trying the single most recent one — a title with no
      Plex-matched guid at all (self-added, obscure) would otherwise
      silently kill the feature for however long it stays most recent, and
      a seed that resolves fine but has nothing new left to recommend is
      exactly as much a dead end as one that fails to resolve.
- [x] Placement decision (was an open question in the original Ideas
      entry): lives in the request modal, right above the existing global
      Trending list — same modal, same card markup, personalized result
      first. Not a separate dashboard panel; this is a companion to
      Trending, not a replacement for it.
- [x] Renders nothing (not an empty-state message) when there's no watch
      history yet or nothing new to suggest — a bonus on top of Trending,
      not something that needs its own "nothing here" noise the way the
      main list does.
- [x] `public/app.js`: fixed a real gap this surfaced — the info modal's
      "sync the originating row's button back after requesting" logic was
      hardcoded to `#search-results` only. With two lists able to show the
      same title at once now, generalized it to update every matching
      button across both containers, not just one.
- [x] `#because-results` given its own bounded height/scroll in CSS rather
      than inheriting `.search-results`' `flex: 1` — two `flex: 1` lists
      stacked would have fought each other for the modal's space; this one
      stays a compact strip, the main Trending list still gets the room.
- [x] Verified against live data end-to-end, not just read for correctness:
      ran the exact route logic directly inside the container against a
      real user's real history — correctly resolved "Reacher" to its TMDB
      id, correctly pulled 20 raw recommendations from Overseerr, correctly
      filtered to 5 not-already-owned titles with the right shape. Not
      verified in an actual logged-in browser session (no credential entry
      into the app's own login, same boundary as the Disk Space trend
      feature above) — logic/plumbing/live-data confirmed, not a
      pixel-level check.
- [x] No new tests — this route has no pure logic of its own beyond
      orchestration (fetch history, resolve a TMDB id, call Overseerr,
      filter with the already-tested `mapDiscoverItem`); same as
      `/discover`, which has never had its own test file either — only
      `mapDiscoverItem` itself is covered, and it's reused completely
      unchanged here. 151 tests still pass.

## v1.29.1 — Fix: "Because you watched" moved to its own tab

Shipped in v1.29.0 as a strip above the request modal's global Trending
list; moved to its own "For You" tab instead — ordered first, ahead of
Search/My Requests/My Stats.

- [x] New `#tab-because-btn`/`#because-tab` pane, added to the existing
      `modalTabs` array — the whole point of that array (per its own
      comment) is that adding a tab is one more entry, not more pairwise
      show/hide wiring, and that held up unchanged here. Search stays the
      tab actually shown by default when the modal opens (unchanged) even
      though For You now sits to its left.
- [x] Lazy-loaded on first visit to the tab, same pattern as My Requests/
      My Stats (`becauseLoaded` flag), rather than eagerly fetched
      alongside Trending every time the modal opens.
- [x] `#because-results` dropped the bounded-height/own-scroll CSS override
      from v1.29.0 — that was specifically to keep it from fighting
      Trending for space while they shared one pane; as its own tab it
      just gets the same full-height `flex: 1` treatment as every other
      tab's results list.
- [x] Now shows a real empty-state message ("Watch a few things and check
      back...") instead of rendering nothing when there's no history yet —
      the right call flipped once this became a tab someone can
      deliberately click into, rather than a bonus strip that was allowed
      to just quietly not appear above a Trending list that was still full
      either way.
- [x] Fixed a real bug this surfaced: the info modal's "which tab to
      return to when the season picker closes" was hardcoded to Search for
      any TV request opened through it. Threaded the originating tab
      through `openInfo`'s `request`/`infoRequestItem` instead, so
      requesting a TV show from For You now correctly returns to For You,
      not Search.
- [x] 151 tests still pass — same as v1.29.0, no new pure logic here either.

## v1.30.0 — Admin: Stream Origins world map

New CH.11 card on the admin page showing where streams have originated
from this year, worldwide — sketched first as a static mock with sample
data to nail the visual, then wired to the real thing.

- [x] `lib/streamOrigins.js` (new): hooks into `nowPlaying.js`'s existing
      Tautulli poll — whenever a session key wasn't in the previous cache
      (a stream that just started), geoIP-resolves its
      `ip_address_public` via `geoip-lite`'s own bundled database. No
      external API call per stream, no data leaves the server just to
      plot a dot. `nowPlaying.js`'s `mapSession()` still never carries
      that field to the shared family dashboard feed — this owner-only
      panel is the one place in the app that reads it.
- [x] Calendar-year window, not a rolling one: `topLocations()` only
      counts this year's rows, and `pruneOld()` (run daily) drops
      everything before the current Jan 1. Computed from the current
      date rather than hardcoded, so it resets on its own every New
      Year's with no edit needed.
- [x] New owner-gated route, `GET /api/owner/stream-origins`, returns
      each distinct city's share of the year as a percentage — all the
      math happens server-side, the client just renders it.
- [x] World map is a set of hand-placed blurred landmass blobs, not real
      coastline data — reads as glassy/abstract rather than a shaky
      attempt at cartographic accuracy, and matches the same soft-blob
      language as the amber heat points sitting on top of them (biggest/
      brightest glow = most streams). Top origin gets a subtle pulse
      (respects `prefers-reduced-motion`).
- [x] Ranked legend below the map reuses the existing `.bar`/`.bar-fill`
      component rather than inventing new UI.
- [x] 155 tests pass, 4 new (`test/streamOrigins.test.js`): private/
      missing IPs are skipped, a public IP resolves and records,
      aggregation + percentage math, and year-boundary pruning.

## v1.30.1 — Fix: stream-origins startup race

Deploying v1.30.0 threw a real error on first boot: `stream-origins prune
error: SQLITE_ERROR: no such table: stream_origins`. `start()` calls
`pruneOld()` immediately at server startup — the same shape that hit a
genuine `CREATE TABLE`-vs-next-statement race in `diskSpaceHistory.js` on
2026-08-14 (see its own comment). `streamOrigins.js` had copied the
older eager top-level db-open pattern instead of that already-proven fix.

- [x] Switched to the same lazy `getDb()` + `db.serialize()` shape
      `diskSpaceHistory.js` uses — the schema statement is guaranteed to
      finish before anything else on the same connection can run.
- [x] Confirmed live in the actual container: `docker logs skyn3t`
      showed the error on the v1.30.0 deploy, clean startup with no
      errors after this fix redeployed.
- [x] Also confirmed `geoip-lite`'s declared `engines: node >=24` isn't
      a real problem — the container runs Node 20, and a lookup inside
      it (`docker exec skyn3t node -e "geoip.lookup('8.8.8.8')"`)
      resolves correctly regardless.
- [x] 155 tests still pass.

## v1.30.2 — Fix: deploy.sh was clobbering the real Traefik domain

Real outage: the live site went down right after a v1.30.1 deploy.
`docker-compose.yml`'s Traefik label has always carried a placeholder
`Host(\`example.com\`)` rule in this (public) repo — the real domain was
only ever set by hand-editing docker-host's copy directly, never
committed. `deploy.sh` rsyncs the whole working tree except `.git`,
`node_modules`, and `.env` — `docker-compose.yml` isn't excluded, so
that hand-edit got silently overwritten the moment this file next
differed from git, taking the live routing label down with it.

- [x] Immediate fix: patched docker-host's live `docker-compose.yml`
      back to the real domain and recreated the container to restore
      service, verified the site returns 200 from outside the LAN.
- [x] Durable fix: the label now reads
      `` Host(`${MARQUEE_DOMAIN:-example.com}`) `` — sourced from `.env`,
      which `deploy.sh` already excludes from sync the same way it
      protects the rest of `.env`. Added `MARQUEE_DOMAIN` to
      `.env.example` (documented, defaults to a placeholder) and set the
      real value directly in docker-host's actual `.env` (not read, only
      appended — same append-without-reading approach used for secrets
      elsewhere in this app).
- [x] Redeployed through the normal `deploy.sh` path (not just the
      manual patch) to confirm the templated version reproduces the
      same working router and survives a real sync.

## v1.31.0 — Fix: Stream Origins was only showing "currently playing"

v1.30.0 recorded stream origins off Tautulli's live `get_activity` feed,
keyed by its `session_key` — turns out that's just a reused slot number
(session 1, 2, 3...), not a real per-stream identifier, so the map only
ever reflected whatever happened to be playing while the server was up
(confirmed empirically: 2000 sampled rows collapsed to essentially one
session_key). Rebuilt on Tautulli's `get_history` instead, keyed by its
`reference_id` (verified against 2000 real rows: always distinct, always
the same `ip_address` across every row sharing one) — a real year-to-date
aggregate now, not a live snapshot.

- [x] `lib/nowPlaying.js`'s `get_activity` hook removed entirely —
      `streamOrigins.js` no longer has any live-tracking path, just the
      history sync.
- [x] `syncFromHistory()`: paginates `get_history` from the start of the
      year, groups rows by `reference_id` (one real session can span
      several rows — pause/resume, a mid-stream quality change), records
      whichever aren't already stored.
- [x] One-time schema migration on deploy: the old `session_key` column
      (non-unique) gets dropped and recreated as `reference_id` (`UNIQUE`,
      `INSERT OR IGNORE`) the first time the new code runs against the
      old table — old rows are trivial next to the real backfill anyway,
      not worth migrating forward. Covered by its own test file
      (`streamOrigins.migration.test.js`, fresh temp DB + cache-busted
      require, since it's a one-time-per-instance code path).
- [x] Startup/schema-race fix generalized: `getDb()` no longer relies on
      sqlite3's own connection-level statement ordering at all (the
      `db.serialize()` fix from v1.30.1) — every query now awaits a real
      `whenReady()` promise that runs the migration first, needed because
      the migration is a genuinely conditional multi-step sequence (check
      schema, maybe drop, then create), not a flat statement list.
- [x] Added a watermark (`sync_state` table) so the expensive full
      year-to-date backfill only ever happens once, ever — confirmed live
      against this deployment's real Tautulli history: ~16k raw rows,
      ~373 seconds. Every sync after that (the 15-minute interval, and
      every restart/deploy) only re-scans a 2-hour trailing window
      instead, comfortably covering the interval with room for a missed
      run. Checked impact of the one-time run directly: container CPU
      stayed at 2.7%, the live site kept responding in ~140ms throughout
      — async I/O leaves the event loop free between the many awaited
      Tautulli/sqlite calls.
- [x] Real result on this deployment: 12 distinct cities year-to-date
      (Minneapolis, Saint Paul, Miami, Detroit, Brooklyn, and others),
      not the 4 that the old live-tracking version had accumulated.
- [x] 158 tests pass, 3 new since v1.30.1: two for `record()`'s new
      `(referenceId, ip, at)` shape and idempotency, one for the
      migration path, plus a watermark read/write test.

## v1.31.1 — Stream Origins: real coastlines instead of abstract blobs

The world map background was a set of hand-placed blurred landmass
ellipses, deliberately not real coastline data (see the original
comment). Replaced with the real thing.

- [x] New `public/originsWorldPath.js`: an SVG path built offline from
      Natural Earth's public-domain 110m Admin 0 Countries GeoJSON,
      projected through the exact same equirectangular formula the heat
      points already used (`x=(lon+180)*2, y=(90-lat)*2` on the same
      720x360 canvas) — no change needed to the point-placement math,
      it was already geographically correct, just plotted against an
      abstract background before.
- [x] Simplified (Douglas-Peucker, ~0.35 unit tolerance) from the raw
      ~840KB GeoJSON down to ~45KB — the closed-ring case needed its own
      fix (a plain open-polyline D-P pass degenerates on a ring, since
      GeoJSON's first/last coordinate are the same point, collapsing the
      whole ring to one point on the first split; fixed by splitting at
      the farthest point first, then simplifying each half as an open
      arc). Small enough to load as a separate script rather than
      bloating admin.js with a 45KB string literal.
- [x] Antarctica deliberately excluded — equirectangular projection
      stretches it into a distorted band across the entire bottom edge,
      and no stream will ever originate there.
- [x] Land no longer blurred (real coastlines read better crisp); heat
      points keep their glow/pulse unchanged.
- [x] Verified visually with the same mock-data preview-page approach
      used to build the feature originally — real, recognizable
      continents, heat points now landing exactly on their true
      locations instead of approximately inside a blob.

## Ideas

