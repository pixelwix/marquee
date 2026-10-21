# AGENTS.md — Marquee

Instructions for AI coding agents (Claude Code, Codex, Gemini) working in this repo.
`CLAUDE.md` and `GEMINI.md` are byte-identical copies of this file; edit `AGENTS.md`, then run
`python3 ~/Projects/agent-toolkit/skills/session-closer/scripts/sync_context.py --sync AGENTS.md`.
Human-facing setup lives in `README.md`; shipped work, version by version, in `TODO.md`.

## What this is

A self-hosted dashboard for a Plex family. Shared users get Now Playing, Recently Added,
today's episodes, upcoming releases, requests (movies/TV via Overseerr, audiobooks via
ReadMeABook) and notices. The server owner also gets `/admin`: request approval, issues,
release search, download queue, indexer health, alerts, disk space, scheduled scripts,
monthly recap emails, audit log.

Node/Express, no build step. Entry `server.js` → `routes/*.js` (HTTP) → `lib/*.js`
(service clients and logic) → `public/` (single-page front end, `public/app.js`).
State in `data/` (SQLite and JSON, gitignored). Config only in `.env` (template `.env.example`).

## Rules

- **Public repo.** Never commit private IPs, the real domain, hostnames, tokens or share
  paths. `git config core.hooksPath githooks` enables the pre-commit hook that blocks
  RFC1918 addresses and the deployment's domain. Use `localhost` / `example.com` in
  tracked files.
- `lib/mediaStorage.js` and its test are deployment-local and gitignored. Load it only via
  `lib/loadMediaStorage.js` (a test enforces this): a direct `require('./mediaStorage')` broke
  CI once and crashed the first Git-stack deploy (v1.78.1). Builds from GitHub get it from
  `MEDIA_STORAGE_MODULE` (a copy in the host's `data/local/`); after editing the file on the
  Mac, copy it there too.
- **Versioning — every ship:** bump `package.json` (feature → minor, fix → patch) and add a
  matching section to `TODO.md`. `TODO.md` feeds the owner-only "What's new" in the footer.
- **Commit and push every version.** A push to `main` is a deploy: Dockhand on the hosting
  box polls GitHub every 5 minutes and rebuilds the `marquee` stack from the new commit. Never
  push unfinished work to `main`; use a branch.
- **Tests:** `npm test` (node --test, `test/`). Add a test with every change to parsing,
  matching or state logic. Baseline 2026-10-21: 361 tests, 361 pass, 0 skipped, 0 fail.
- Never read or print `.env`. Secrets are written to it without being displayed.
- Changes must not affect Plex playback.

## Deploy and rollback

- **Normal deploy:** bump, commit, push `main`. Dockhand on the hosting box (Git stack
  `marquee`, compose `docker-compose.yml`, build on deploy) checks GitHub every 5 minutes and
  runs `docker compose up -d --build` when `main` has a new commit. Compose variables
  (`MARQUEE_DOMAIN`, `MARQUEE_DATA_DIR`, `MARQUEE_ENV_FILE` and the optional mount dirs) are
  stored in that Dockhand stack as absolute host paths; app config stays in the host `.env`.
- **Names (since 2026-10-21):** compose project `marquee`, image `marquee-marquee`, container
  still `skyn3t`. Always pass `-p marquee` to `docker compose` on the host; a plain
  `docker compose` in the old folder would start a second project and clash over the
  container name. Dockhand still lists an old, empty `skyn3t` stack: never deploy it.
- **Rollback:** revert the commit and push, or redeploy an earlier commit in Dockhand.
- **Emergency only:** `./deploy.sh` (rsync the working tree to the host's old build folder,
  build, tag `marquee-marquee:vX.Y.Z`) and `./rollback.sh [vX.Y.Z]` (switch to a saved image,
  including pre-Dockhand `skyn3t-marquee` tags up to v1.78.0). Both use project `marquee`, so
  they replace the same container. What they deploy stays live until the next push to `main`,
  which Dockhand then deploys over it, so push the fix promptly.
- Verify inside the running container (`docker exec skyn3t ...`), not just on the host.

## PR test copy (since 2026-10-21)

- Branch **`pr`** is the test branch: push changes there, check them on the test copy, then
  merge `pr` into `main` to go live. Dockhand Git stack `marquee-pr` (compose
  `docker-compose.pr.yml`) redeploys it within ~5 minutes; container `marquee-pr`, LAN port
  4101, its own `data/` (copied from production) and `.env` on the host.
- The test copy runs with `MARQUEE_SAFE_MODE=1` (`lib/safeMode.js`): it reads every real
  service but blocks outgoing changes (non-GET requests except Plex sign-in, the qBittorrent
  login and CLIProxyAPI chat; Tautulli `cmd`s other than get_*/status; SABnzbd actions), web
  push, email (Tautulli notify) and the acting jobs (issue fix sweep, recap reminder,
  database backup). Any new code that changes something outside Marquee must go through
  axios or fetch so the guard sees it, or check `safeMode.enabled()` itself; a new background
  job that acts must be added to `SKIPPED_JOBS`. Never point the test copy at production's
  Traefik route, Kometa folder or data.
- `pr` may be reset to `main` with `git push --force-with-lease origin main:pr` (the only
  branch where force-pushing is allowed).

## Session routine

- Start: `/session-starter` (git state → latest `SESSION_LOG.md` entry → context sync →
  `npm test`).
- Close: `/session-closer` (prepend a `SESSION_LOG.md` entry, sync context files, run
  tests, hand over).
