const fs = require('fs');
const path = require('path');
const abs = require('./absClient');
const rmab = require('./rmabClient');

// "For You" in the request modal's Books tab, built from what's already in
// Audiobookshelf:
//   - Missing from your series: gaps and the next book in every series you have
//   - More from your authors: unowned titles by the authors you have most of
// Lookups go through ReadMeABook's Audible search (which also says whether a
// book is already in the library or requested). Full-cast / dramatized
// editions are preferred, matching the house rule; a dramatized adaptation
// split into parts ("Dark Age (1 of 3)") becomes one suggestion that requests
// every part. Rebuilt every 6 hours into data/book-suggestions.json.
const REFRESH_MS = 6 * 60 * 60 * 1000;
const MAX_SERIES = 30;
const TOP_AUTHORS = 5;
const PER_AUTHOR = 4;
const PRODUCED = /dramati[sz]ed|full[- ]?cast|graphic ?audio|audio drama/i;
const JUNK = /summary|study guide|analysis of|omnibus|box ?set|boxed set|collection \d|books? \d+\s*[-–]\s*\d+|edizione|édition|edición|ausgabe|\bteil\b|sammelband/i;

function file() {
  return path.join(process.env.SESSION_DB_DIR || '/app/data', 'book-suggestions.json');
}

const norm = s => String(s || '').toLowerCase()
  .replace(/[\(\[][^\)\]]*[\)\]]/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
// "Dark Age (2 of 3) [Dramatized Adaptation]" -> part 2 of 3
function splitPart(title) {
  const m = String(title).match(/\(?(?:part )?(\d+) of (\d+)\)?/i);
  return m ? { n: Number(m[1]), of: Number(m[2]) } : null;
}
const isProduced = b => PRODUCED.test(b.title) || b.narratorCount >= 4;
// Base title for "do I already have this book?": drops edition tags and ", Book 2"-style suffixes,
// so a standard edition of a book owned as full cast doesn't count as new.
// UK/US title pairs count as the same book.
const baseTitle = s => norm(String(s || '').replace(/,?\s*book \d+\s*$/i, ''))
  .replace(/\bphilosopher s stone\b|\bphilosophers stone\b/, 'sorcerers stone').replace(/\bsorcerer s stone\b/, 'sorcerers stone');

// From the library: series -> { author, parts:Set }, author counts, owned titles/ASINs.
function readLibrary(items) {
  const series = new Map();
  const authors = new Map();
  const ownedTitles = new Set();
  const ownedAsins = new Set();
  for (const i of items) {
    const author = (i.author || '').split(',')[0].trim();
    if (author) authors.set(author, (authors.get(author) || 0) + 1);
    ownedTitles.add(baseTitle(i.title));
    if (i.asin) ownedAsins.add(i.asin);
    for (const s of String(i.series || '').split(',')) {
      const m = s.trim().match(/^(.*?)\s+#([\d.]+)$/);
      if (!m) continue;
      const entry = series.get(m[1]) || { author, parts: new Set() };
      entry.parts.add(Number(m[2]));
      series.set(m[1], entry);
    }
  }
  return { series, authors, ownedTitles, ownedAsins };
}

function eligible(b, lib) {
  return b.availability === 'none'
    && !lib.ownedAsins.has(b.asin)
    && !lib.ownedTitles.has(baseTitle(b.title))
    && (!b.language || /english/i.test(b.language))
    && !JUNK.test(b.title);
}

// Pick one edition of a book from its candidates: produced first, then the one with the
// most ratings-worthy metadata (duration). Split produced editions keep all their parts.
function bestEdition(candidates) {
  // Tiers: titled "Dramatized"/"Full Cast" > many narrators > standard reading.
  const titled = candidates.filter(b => PRODUCED.test(b.title));
  const ensemble = candidates.filter(b => !PRODUCED.test(b.title) && b.narratorCount >= 4);
  const pool = titled.length ? titled : ensemble.length ? ensemble : candidates;
  const split = pool.filter(b => splitPart(b.title));
  if (split.length && split.length === pool.length) {
    const of = splitPart(split[0].title).of;
    const parts = split.filter(b => splitPart(b.title).of === of)
      .sort((a, b) => splitPart(a.title).n - splitPart(b.title).n);
    const first = parts[0];
    return { ...first, title: first.title.replace(/\s*\(?(?:part )?1 of \d+\)?/i, '').trim(),
      produced: isProduced(first), parts: parts.map(strip), partCount: of, complete: parts.length === of };
  }
  const whole = pool.filter(b => !splitPart(b.title));
  const pick = (whole.length ? whole : pool).sort((a, b) => (b.hours || 0) - (a.hours || 0))[0];
  return { ...pick, produced: isProduced(pick), parts: [strip(pick)] };
}

// What the request endpoint needs for each part.
const strip = b => ({ asin: b.asin, title: b.title, author: b.author, narrator: b.narrator, description: b.description, cover: b.cover });

async function seriesSuggestions(lib) {
  const out = [];
  const entries = [...lib.series.entries()].slice(0, MAX_SERIES);
  for (const [name, s] of entries) {
    let results;
    try { results = await rmab.search(`${name} ${s.author}`); } catch { continue; }
    const max = Math.max(...s.parts);
    const byPart = new Map();
    for (const b of results) {
      const part = Number(b.seriesPart);
      if (!part || !Number.isInteger(part) || norm(b.seriesName) !== norm(name)) continue;
      if (s.parts.has(part) || part > max + 1 || !eligible(b, lib)) continue;
      byPart.set(part, [...(byPart.get(part) || []), b]);
    }
    for (const [part, candidates] of [...byPart.entries()].sort((a, b) => a[0] - b[0])) {
      const pick = bestEdition(candidates);
      if (pick.parts.length > 1 && !pick.complete) continue; // some parts already owned/requested
      out.push({ ...pick, reason: part > max ? `Next in ${name} (#${part})` : `Missing #${part} of ${name}` });
    }
  }
  return out;
}

async function authorSuggestions(lib, exclude) {
  const out = [];
  const top = [...lib.authors.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_AUTHORS);
  for (const [author] of top) {
    let results;
    try { results = await rmab.search(author); } catch { continue; }
    const byBook = new Map();
    for (const b of results) {
      if (!norm(b.author).includes(norm(author)) || !eligible(b, lib) || exclude.has(baseTitle(b.title))) continue;
      const key = norm(b.title.replace(/\s*\(?(?:part )?\d+ of \d+\)?/i, ''));
      byBook.set(key, [...(byBook.get(key) || []), b]);
    }
    const picks = [...byBook.values()].map(bestEdition)
      .filter(p => p.parts.length === 1 || p.complete).slice(0, PER_AUTHOR);
    for (const p of picks) out.push({ ...p, reason: `More from ${author}` });
  }
  return out;
}

async function rebuild() {
  if (!abs.isConfigured() || !rmab.isConfigured()) return null;
  const lib = readLibrary(await abs.fetchLibrary());
  const series = await seriesSuggestions(lib);
  const authors = await authorSuggestions(lib, new Set(series.map(s => baseTitle(s.title))));
  const result = { generatedAt: Date.now(), series, authors };
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(result));
  return result;
}

function read() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return null; }
}

function start() {
  const tick = () => rebuild().catch(err => console.error('book suggestions failed:', err.message));
  setTimeout(tick, 2 * 60 * 1000);
  setInterval(tick, REFRESH_MS);
}

module.exports = { rebuild, read, start, readLibrary, bestEdition, eligible, splitPart, norm };
