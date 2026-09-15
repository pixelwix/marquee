// Pure derivation of per-season available/requested status from Overseerr's
// /api/v1/tv/:id response shape — extracted out of routes/overseerr.js so it's
// directly testable (see the real bug this exists to prevent, in the test file).
//
// Real bug found live 2026-09-15: a freshly-made TV request (never yet
// approved) always showed "No pending seasons found" in the admin approval
// modal, even though Overseerr's own UI correctly showed it as a real
// Pending request. Overseerr's `mediaInfo.seasons[]` (per-season media
// availability) stays an empty array until a season's actual download/import
// has started — it is NOT where a fresh request's season list lives. The
// real season-level pending status for an unapproved request lives in
// `mediaInfo.requests[].seasons[]`, keyed off the *request's* own status (1 =
// pending), a completely separate status enum from the media-level one (2 =
// pending, 3 = processing, 4 = partially available, 5 = available) that the
// original code relied on exclusively.
function mapTvSeasons(data) {
  const mediaSeasons = data.mediaInfo?.seasons || [];
  const pendingRequestSeasons = (data.mediaInfo?.requests || [])
    .filter((r) => r.status === 1) // MediaRequestStatus.PENDING
    .flatMap((r) => r.seasons || [])
    .map((s) => s.seasonNumber);

  return (data.seasons || [])
    .filter((s) => s.seasonNumber > 0) // skip "Specials"
    .map((s) => {
      const info = mediaSeasons.find((ms) => ms.seasonNumber === s.seasonNumber);
      // Overseerr media status: 4 = partially available, 5 = available
      const available = info?.status === 4 || info?.status === 5;
      // Requested via either an already-populated media-level season status
      // (2 = pending, 3 = processing — present once Overseerr/Sonarr has
      // actually started tracking this season), or a still-pending request
      // that hasn't reached that stage yet (mediaSeasons empty, but the
      // request itself names this season).
      const requestedViaMediaInfo = info?.status === 2 || info?.status === 3;
      const requestedViaPendingRequest = pendingRequestSeasons.includes(s.seasonNumber);
      const requested = requestedViaMediaInfo || requestedViaPendingRequest;
      return { seasonNumber: s.seasonNumber, name: s.name, episodeCount: s.episodeCount, available, requested };
    });
}

module.exports = { mapTvSeasons };
