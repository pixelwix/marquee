# Session Log

Newest first. One entry per working session: goal, changes, validation, handover.
Per-version detail lives in `TODO.md`; this file is the handover between sessions.

### Session 2026-10-20 — Audiobooks in Marquee (v1.70.0–v1.76.2)

- **Goal**:
  - Bring the family's audiobooks into Marquee: show them, request them, prefer full-cast editions.
- **Changes Completed**:
  - v1.70–1.71: Scheduled Scripts countdowns and polish.
  - v1.72: Books row in Recently Added (`lib/absClient.js`, `routes/audiobooks.js`; covers proxied).
  - v1.73: Book requests through ReadMeABook (`lib/rmabClient.js`, `lib/bookRequests.js`,
    `routes/books.js`): owner approval for family requests, stuck detection, status sync from the
    request list (the single-request endpoint 500s on finished requests).
  - v1.74: "Needs a manual pick" state.
  - v1.75: Edition toggle (Full cast / Standard / Either), sent to the indexer bridge's `/prefs`
    before the request (`lib/abbBridge.js`).
  - v1.76: Books "For You" (`lib/bookSuggestions.js`, `GET /api/books/suggestions`, rebuilt every
    6 h): series gaps / next books and more from top authors; full-cast preferred, split parts
    folded into one request, owned editions and UK/US title pairs skipped.
  - Batch committed and pushed as `db7801a`.
  - Added `AGENTS.md` (+ synced `CLAUDE.md`, `GEMINI.md`) and this log.
- **Validation**:
  - `npm test`: 353 tests, 351 pass, 2 skipped, 0 fail.
  - Deployed with `./deploy.sh`; Books row, requests, edition choice and For You checked live.
- **Next Steps / Handover**:
  - Confirm the full-cast rule on a fresh live request once the audiobook indexer is stable.
  - Optionally show which edition was actually grabbed back to the requester.
  - Next commit due around v1.86 (batched every ~10 versions).

---
