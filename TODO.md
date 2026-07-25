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

## Open question
- [ ] `skyn3t.me` currently routes to the other project (`skyn3t-media`), not
      this dashboard. Decide before treating this as "live."

## Phase 2 — new features
- [x] Continue Watching panel (Plex on-deck, personalized per signed-in user)
- [ ] Download queue panel (qBittorrent / SABnzbd)
- [ ] "Available now" notifications (Overseerr webhook -> toast / ntfy)
- [ ] Owner-only controls (Uptime Kuma status, disk space via nut-webgui)
- [ ] PWA / installable

## Phase 3 — hardening once public
- [ ] `COOKIE_SECURE=true` once behind HTTPS
- [ ] Rate-limit `/api/auth/plex/pin` and `/plex/poll`
- [ ] Drop unused `cors` dependency
