// Wraps a raw Plex image path (e.g. "/library/metadata/123/thumb/456") behind our
// own proxy, or returns null for a missing one. Callers stay responsible for
// picking which field to pass — Plex's own API uses camelCase (grandparentThumb)
// while Tautulli's uses snake_case (grandparent_thumb), so there's no single field
// name to standardize on here, only the URL-building step.
function imageUrl(path) {
  return path ? `/api/plex/image?path=${encodeURIComponent(path)}` : null;
}

module.exports = { imageUrl };
