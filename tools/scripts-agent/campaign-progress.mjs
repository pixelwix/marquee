// Read-only summaries for the companion scripts agent. Only aggregate fields leave the host.
import fs from 'node:fs';
import path from 'node:path';
const read = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const queued = new Set(['queued', 'import_pending', 'submitting', 'submitted']);
const waiting = new Set(['no_candidate', 'no-candidate', 'retry-pending', 'review_wait']);
function report(title, unit, rows, updated, now, classify, savings, excluded = 0) {
  const counts = { completed: 0, queued: 0, waiting: 0, held: 0, pending: 0 };
  let savedGB = 0;
  for (const row of rows) {
    const category = classify(row);
    counts[category]++;
    if (category === 'completed') savedGB += Math.max(0, Number(savings(row)) || 0);
  }
  const date = new Date(updated || '');
  const valid = Number.isFinite(date.getTime());
  return { available: true, title, unit, enrolled: rows.length, remaining: rows.length - counts.completed,
    ...counts, excluded, savedGB: Math.round(savedGB * 1000) / 1000,
    updated: valid ? date.toISOString() : null, stale: !valid || now - date > 45 * 60000 };
}
function category(status, verified) {
  if (verified) return 'completed';
  if (queued.has(status)) return 'queued';
  if (waiting.has(status)) return 'waiting';
  return status === 'pending' || !status ? 'pending' : 'held';
}
export function movieBatchProgress(dir, now = new Date()) {
  const cfg = read(path.join(dir, 'settings.json'));
  if (!cfg?.search_scope?.enabled) return null;
  const state = read(path.join(dir, 'state.json')), status = read(path.join(dir, 'status.json'));
  const snapshot = cfg.search_scope.movies, decisions = read(path.join(dir, 'audit-review-decisions.json'));
  if (!state?.movies || !snapshot || !decisions) return { available: false, title: 'Oversized movies' };
  const rows = Object.entries(snapshot).map(([id, original]) => ({ id, original, entry: state.movies[id] || {}, decision: decisions[id] || {} }));
  return report('Oversized movies', 'movies', rows, status?.time, now, row => {
    const { entry: e, original: o, decision: d } = row;
    const verified = e.status === 'verified_unmonitored' && e.verifiedFileId && e.verifiedFileId !== o.fileId &&
      e.oldFileId === o.fileId && e.newBytes > 0 && e.newBytes <= Math.min(10000000000, o.bytes * 0.8);
    if (verified) return 'completed';
    if ((d.holdAnyFile || d.fileId === o.fileId) && d.action === 'hold') return 'held';
    if (['no_candidate', 'failed'].includes(e.status) && (e.lastAttempt || 0) < cfg.search_scope.requestedAt) return 'pending';
    return category(e.status, false);
  }, row => (row.original.bytes - row.entry.newBytes) / 1e9);
}
export function hevcProgress(logsDir, cohort, now = new Date()) {
  const title = cohort === 'library' ? 'Four-show Library HEVC' : 'Reality HEVC';
  const state = read(path.join(logsDir, `${cohort}-hevc-state.json`));
  const status = read(path.join(logsDir, `${cohort}-hevc-status.json`));
  if (!state?.episodes || !status) return { available: false, title };
  const all = Object.values(state.episodes), rows = all.filter(r => r.status !== 'held');
  return report(title, 'episodes', rows, status.at, now,
    r => category(r.status, r.status === 'verified' && r.verified?.fileId && r.verified?.savedGB > 0),
    r => r.verified?.savedGB, all.length - rows.length);
}
export function campaignForJob(name, root, now = new Date()) {
  if (name === 'radarr-movie-replacements.py') return movieBatchProgress(path.join(root, 'movie-replacements'), now);
  if (name === 'sonarr-reality-hevc.py') return hevcProgress(path.join(root, 'logs'), 'reality', now);
  if (name === 'sonarr-library-hevc.py') return hevcProgress(path.join(root, 'logs'), 'library', now);
  return null;
}
