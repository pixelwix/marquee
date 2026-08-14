// Shared by both diskspace sources (real filesystem via lib/mediaStorage.js,
// and the Radarr/Sonarr diskspace-API fallback in routes/owner.js) — multiple
// mount points/root folders routinely point at the same underlying physical
// volume, so grouping by total capacity is how either source collapses those
// down to one row per actual volume.
function groupByTotal(volumes) {
  const groups = new Map();
  for (const v of volumes) {
    const key = v.totalBytes;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v);
  }
  return [...groups.values()];
}

function toDisplayRows(rows) {
  return rows
    .map(v => ({
      path: v.label,
      freeBytes: v.freeBytes,
      totalBytes: v.totalBytes,
      usedPercent: v.totalBytes ? Math.round((1 - v.freeBytes / v.totalBytes) * 100) : 0
    }))
    .sort((a, b) => a.freeBytes - b.freeBytes);
}

// Radarr/Sonarr fallback: labels are container mount-point paths ("/",
// "/config", "/downloads/completed") — implementation detail, not something
// worth showing all of. The shortest one reads as the cleanest generic
// description of the volume ("/" over "/config").
function shortestLabelRows(volumes) {
  const rows = groupByTotal(volumes).map(group =>
    group.reduce((a, b) => (b.label.length < a.label.length ? b : a))
  );
  return toDisplayRows(rows);
}

// Real media-storage source: each label is a share name the user actually
// recognizes (movies, tv, comics...) — combining them makes it clear which
// shares live on the same physical volume, instead of one name silently
// hiding the others. Free space is the minimum across the group rather than
// an arbitrary member's — a small, conservative floor if it drifts between
// shares queried a moment apart, same reasoning as the old exact-match issue
// this dedup was built to avoid.
function combinedLabelRows(volumes) {
  const rows = groupByTotal(volumes).map(group => {
    const sorted = [...group].sort((a, b) => a.label.localeCompare(b.label));
    return {
      label: sorted.map(v => v.label).join(', '),
      totalBytes: sorted[0].totalBytes,
      freeBytes: Math.min(...sorted.map(v => v.freeBytes))
    };
  });
  return toDisplayRows(rows);
}

// Ordinary least-squares slope of freeBytes over time, from whatever
// snapshots lib/diskSpaceHistory.js has recorded for one volume. Least
// squares rather than just first-vs-last so one noisy/short-lived reading
// (a big torrent briefly finishing then getting moved off-volume, say)
// doesn't single-handedly swing the projection.
//
// Returns null (not just a null daysUntilFull) when there's nothing useful
// to say: fewer than 2 samples, or free space flat/growing — an infinite or
// negative "days until full" is noise, not a projection worth showing.
function projectDaysUntilFull(history) {
  if (!history || history.length < 2) return null;

  const n = history.length;
  const meanT = history.reduce((sum, h) => sum + h.recordedAt, 0) / n;
  const meanF = history.reduce((sum, h) => sum + h.freeBytes, 0) / n;
  let num = 0;
  let den = 0;
  for (const h of history) {
    const dt = h.recordedAt - meanT;
    num += dt * (h.freeBytes - meanF);
    den += dt * dt;
  }
  if (den === 0) return null; // all samples at the same instant

  const bytesPerMs = num / den; // negative = shrinking, i.e. filling up
  if (bytesPerMs >= 0) return null; // flat or growing — nothing to project

  const latest = history.reduce((a, b) => (b.recordedAt > a.recordedAt ? b : a));
  const msUntilFull = -latest.freeBytes / bytesPerMs;
  const daysUntilFull = msUntilFull / 86400000;
  const bytesPerDay = bytesPerMs * 86400000;

  return { daysUntilFull: Math.max(0, Math.round(daysUntilFull)), bytesPerDay };
}

module.exports = { groupByTotal, shortestLabelRows, combinedLabelRows, projectDaysUntilFull };
