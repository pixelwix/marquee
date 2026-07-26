// Radarr and Sonarr both return the same release shape from their v3 /release
// endpoint (an interactive/manual search against every configured indexer).
// Trimmed here to what the UI needs — never forwarding downloadUrl/commentUrl,
// which embed the indexer's own API key — and capped to a sane count, since a
// season/episode search can return 500+ results across every indexer.
function mapReleases(releases, limit = 40) {
  return [...releases]
    .sort((a, b) => {
      if (a.rejected !== b.rejected) return a.rejected ? 1 : -1;
      return (b.seeders || 0) - (a.seeders || 0);
    })
    .slice(0, limit)
    .map(r => ({
      guid: r.guid,
      indexerId: r.indexerId,
      title: r.title,
      indexer: r.indexer,
      protocol: r.protocol, // 'torrent' | 'usenet'
      sizeBytes: r.size,
      seeders: r.seeders ?? null,
      ageDays: r.age != null ? Math.round(r.age) : null,
      quality: r.quality?.quality?.name || null,
      rejected: r.rejected,
      rejections: r.rejections || []
    }));
}

module.exports = { mapReleases };
