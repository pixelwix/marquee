// Wraps a raw Plex image path (e.g. "/library/metadata/123/thumb/456") behind our
// own proxy, or returns null for a missing one. Callers stay responsible for
// picking which field to pass — Plex's own API uses camelCase (grandparentThumb)
// while Tautulli's uses snake_case (grandparent_thumb), so there's no single field
// name to standardize on here, only the URL-building step.
//
// Points at lib/mediaCache.js's disk-backed /img route, not the old
// uncached routes/plex.js /image proxy — this is the only place that ever
// builds one of these URLs, so this one line is what actually puts every
// image on the site behind the cache.
function imageUrl(path) {
  return path ? `/img?path=${encodeURIComponent(path)}` : null;
}

module.exports = { imageUrl };
