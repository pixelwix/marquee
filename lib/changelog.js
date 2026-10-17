// Parses TODO.md's per-version sections ("## vX.Y.Z - Title" + "- [x] ..." bullets) into a
// newest-first list for the footer's What's new popup. Read once and cached — TODO.md ships in
// the image and only changes on deploy (which restarts the process anyway).
const fs = require('fs');
const path = require('path');

let cache = null;

// Strip the markdown that reads badly as plain text (bold, code ticks, links), keep the words.
function plain(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

const semverKey = (v) => v.split('.').map(n => n.padStart(5, '0')).join('.');

function parse(markdown) {
  const out = [];
  let cur = null;
  for (const line of markdown.split('\n')) {
    const head = line.match(/^## v(\d+\.\d+\.\d+)\s*[—–-]\s*(.+)$/);
    if (head) { cur = { v: head[1], title: plain(head[2]), items: [] }; out.push(cur); continue; }
    if (/^## /.test(line)) { cur = null; continue; }   // "## Ideas", "## v1.1.0 and earlier", etc.
    const bullet = cur && line.match(/^- (?:\[[ x]\] )?(.+)$/);
    if (bullet) cur.items.push(plain(bullet[1]));
    else if (cur && cur.items.length && /^\s{2,}\S/.test(line)) cur.items[cur.items.length - 1] += ' ' + plain(line);   // wrapped bullet
  }
  return out.sort((a, b) => semverKey(b.v).localeCompare(semverKey(a.v)));
}

function getChangelog() {
  if (!cache) {
    try { cache = parse(fs.readFileSync(path.join(__dirname, '..', 'TODO.md'), 'utf8')); }
    catch { cache = []; }
  }
  return cache;
}

module.exports = { getChangelog, parse };
