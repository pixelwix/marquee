# Roadmap

## Phase 1 — foundation fixes (done)
- [x] Shared-user access check: parse Plex's `/api/users` XML properly (`xml2js`)
      instead of independent substring matches
- [x] Overseerr request attribution: map signed-in Plex user -> Overseerr user id,
      scope `/requests/mine` per-user
- [x] Persistent sessions via `connect-sqlite3` (mounted volume) so restarts don't
      log everyone out
- [x] Image-proxy path validation (`/api/plex/image`) — only forwards real
      Plex thumb/art paths
- [x] Drop raw Plex `/api/users` XML (PII) from logs
- [x] Publish as a general-purpose project ("Marquee") on GitHub

## Phase 2 — new features (done)
- [x] Continue Watching panel (Plex on-deck) — later replaced by Recently Watched
      (actual Tautulli watch history, styled like Now Playing) since on-deck just
      duplicated what's already visible in Plex itself
- [x] Now Playing: push updates via Plex WebSocket + SSE instead of 15s polling
- [x] Download queue panel (qBittorrent / SABnzbd, filtered to actively downloading)
- [x] Owner-only controls (Uptime Kuma monitor status + UPS status via NUT protocol)
- [x] Top of the Month leaderboard (top viewer/movie/TV/anime, gold/silver/bronze,
      rolling 30-day window via Tautulli)
- [x] Season picker for TV requests (was requesting every season by default) +
      requests now go through each user's own Overseerr permissions, not the
      shared admin API key
- [x] Cycling sign-in taglines, configurable per deployment (Skynet-themed for
      skyn3t.me)

## Phase 3 — hardening once public (done)
- [x] `COOKIE_SECURE=true` once behind HTTPS
- [x] Rate-limit `/api/auth/plex/pin` and `/plex/poll` — verified live, 11th
      rapid request correctly gets 429
- [x] Drop unused `cors` dependency
- [x] Baseline security headers (X-Content-Type-Options, X-Frame-Options,
      Referrer-Policy), explicit session cookie sameSite=lax
- [x] CRITICAL: path traversal in `/api/overseerr/tv/:id` — percent-encoded
      `/` in the id let any signed-in user pivot the admin-keyed request to
      arbitrary Overseerr API paths (confirmed reachable: `/settings/main`,
      leaking Overseerr's own API key). Fixed with numeric-only validation.

## Live
- [x] skyn3t.me now serves this dashboard directly (skyn3t-media retired).
      Host port made configurable (`HOST_PORT`, mapped to 81) rather than
      hardcoded, container still listens on 4000 internally regardless.
      Verified end-to-end over the real public URL after cutover.

## Phase 4 — post-launch refinements (done)
- [x] Floating request button: header icon on desktop, FAB on mobile styled
      like the avatar-chip; cache-busted static assets so Cloudflare's edge
      cache can't serve stale JS/CSS after a deploy
- [x] Search results distinguish "already in Plex" (disabled, teal "In Plex")
      from "already requested" (disabled, muted) instead of treating both the
      same
- [x] My Requests tab in the request modal — each family member's own
      Overseerr request history (title, poster, status: Available /
      Downloading / Pending Approval / Declined), scoped to their own
      Overseerr session

## Not yet started
- [ ] "Available now" notifications (Overseerr webhook -> toast / ntfy)
- [ ] PWA / installable
- [ ] Trending/Discover panel
- [ ] Disk space via Sonarr/Radarr diskspace API
- [ ] Kid-safe mode
- [ ] Plex Watchlist integration
- [ ] Audiobookshelf/Mylar3 integration
