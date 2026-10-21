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
- `lib/mediaStorage.js` and its test are deployment-local and gitignored; nothing tracked
  may `require` them at top level (CI broke on that once). Load them lazily and guarded.
- **Versioning — every ship:** bump `package.json` (feature → minor, fix → patch) and add a
  matching section to `TODO.md`. `TODO.md` feeds the owner-only "What's new" in the footer.
- **Commit when done:** create a git commit and push when the work/version is complete.
  `deploy.sh` keeps a per-version image, so rollback does not depend on git.
- **Tests:** `npm test` (node --test, `test/`). Add a test with every change to parsing,
  matching or state logic. Baseline 2026-10-20: 356 tests, 356 pass, 0 skipped, 0 fail.
- Never read or print `.env`. Secrets are written to it without being displayed.
- Changes must not affect Plex playback.

## Deploy and rollback

- `./deploy.sh`: rsync the working tree to the hosting box's build context (checksum
  verified file by file), `docker compose build && up -d`, tag the image `vX.Y.Z`
  (newest 20 kept). Host and paths are inside the script.
- `./rollback.sh` lists versions; `./rollback.sh vX.Y.Z` switches back. Code only; `data/`
  is shared.
- Verify inside the running container (`docker exec`), not just on the host.

## Session routine

- Start: `/session-starter` (git state → latest `SESSION_LOG.md` entry → context sync →
  `npm test`).
- Close: `/session-closer` (prepend a `SESSION_LOG.md` entry, sync context files, run
  tests, hand over).
