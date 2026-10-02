// Pure helpers for the admin "Collection Gaps" panel — cross-references the
// 80+ curated collections in Kometa's franchises.yml (see KOMETA_CONFIG_DIR,
// same mount lib/notice.js already reads) against what Radarr actually has
// on disk, surfacing exactly which movies are missing from each one so the
// owner can request them. Same split as lib/sceneReleases.js: parsing/
// matching logic lives here (testable without hitting any API), the actual
// Radarr calls live in the route.
const yaml = require('js-yaml');

// Narrows a named collection's membership for THIS gap check only —
// franchises.yml itself, and so the actual Plex collection Kometa builds
// from it, is completely untouched; these owners still want all 27 Bond
// films grouped together in Plex, just not counted as "missing" here.
// James Bond Collection → TMDB's own collection is every film since 1962
// (Connery through Brosnan); the owner only cares about completeness for
// the Daniel Craig era plus whatever comes next (2026-10-02 request) — no
// "Craig era" sub-collection exists on TMDB to reference instead, so this
// is a hand-maintained list. Add a new film's tmdbId here once one is
// announced with its own TMDB entry (the existing unreleased-movie filter
// already keeps it from counting as a gap before then).
const COLLECTION_TMDB_MOVIE_OVERRIDES = {
  'James Bond Collection': [36557, 10764, 37724, 206647, 370172], // Casino Royale, Quantum of Solace, Skyfall, Spectre, No Time to Die
};

// franchises.yml's `collections:` map has two shapes in practice: the vast
// majority give `tmdb_collection: <id>` (an official TMDB "collection"
// entity — Alien, Mission: Impossible, etc.), a handful give an explicit
// `tmdb_movie: [...]` list instead for curated groupings that aren't a real
// TMDB collection (e.g. "DC Tomorrowverse"). Anything with neither (there
// shouldn't be any, but a future hand-edit could add one) is skipped rather
// than crashing the whole panel over one bad entry.
function parseFranchiseCollections(yamlText) {
  const doc = yaml.load(yamlText) || {};
  const entries = Object.entries(doc.collections || {});
  const out = [];
  for (const [name, def] of entries) {
    if (!def) continue;
    if (COLLECTION_TMDB_MOVIE_OVERRIDES[name]) {
      out.push({ name, tmdbCollectionId: null, tmdbMovieIds: COLLECTION_TMDB_MOVIE_OVERRIDES[name] });
    } else if (Number.isInteger(def.tmdb_collection)) {
      out.push({ name, tmdbCollectionId: def.tmdb_collection, tmdbMovieIds: null });
    } else if (Array.isArray(def.tmdb_movie) && def.tmdb_movie.length) {
      out.push({ name, tmdbCollectionId: null, tmdbMovieIds: def.tmdb_movie.map(Number) });
    }
    // else: no recognizable movie source for this entry — silently skipped.
  }
  return out;
}

// For one collection definition, works out which of its official members
// (by TMDB id) are missing a downloaded file in Radarr's library.
// `radarrCollectionsByTmdbId` is Radarr's own GET /api/v3/collection,
// re-keyed by tmdbId — Radarr auto-discovers a TMDB collection's full
// official membership (title/year per movie) as soon as it knows about any
// one movie from it, so this is the official-membership source for the
// tmdb_collection-based definitions without ever needing a TMDB API key of
// Marquee's own. `libraryByTmdbId` is Radarr's main GET /api/v3/movie,
// re-keyed by tmdbId, used to check hasFile regardless of which schema the
// definition uses.
//
// Returns null for a fully-owned collection (nothing to show), or
// `{ name, tmdbCollectionId, totalCount, ownedCount, missingTmdbIds,
// unknown }` — `unknown: true` means a tmdb_collection-based definition
// where Radarr has never seen ANY movie from it (so there's no cached
// membership to check at all — e.g. the Batman Collection case from the
// 2026-08-28 manual audit, which was entirely unowned). That's surfaced
// separately in the UI rather than silently dropped, since "can't check"
// and "fully owned" mean very different things to the owner.
function matchCollectionGaps(definition, radarrCollectionsByTmdbId, libraryByTmdbId) {
  let members; // [{ tmdbId, title, year }]
  if (definition.tmdbCollectionId != null) {
    const radarrCollection = radarrCollectionsByTmdbId.get(definition.tmdbCollectionId);
    if (!radarrCollection) {
      return { name: definition.name, tmdbCollectionId: definition.tmdbCollectionId, unknown: true };
    }
    members = radarrCollection.movies || [];
  } else {
    members = definition.tmdbMovieIds.map(id => ({ tmdbId: id, title: null, year: null }));
  }
  if (!members.length) return null;

  const ownedCount = members.filter(m => libraryByTmdbId.get(m.tmdbId)?.hasFile).length;
  if (ownedCount === members.length) return null;

  const missingTmdbIds = members.filter(m => !libraryByTmdbId.get(m.tmdbId)?.hasFile).map(m => m.tmdbId);
  return {
    name: definition.name,
    tmdbCollectionId: definition.tmdbCollectionId,
    totalCount: members.length,
    ownedCount,
    missingTmdbIds
  };
}

// Runs matchCollectionGaps over every parsed definition, drops fully-owned
// ones, and sorts the rest biggest-gap-first (most missing movies) so the
// owner sees the most worth-acting-on collections at the top rather than
// alphabetical order burying a 4-missing collection under single-movie ones.
// "unknown" (can't-check) entries sort last regardless of alphabetical name,
// since there's nothing actionable to rank them by.
function computeAllGaps(definitions, radarrCollectionsByTmdbId, libraryByTmdbId) {
  const results = definitions
    .map(def => matchCollectionGaps(def, radarrCollectionsByTmdbId, libraryByTmdbId))
    .filter(Boolean);
  results.sort((a, b) => {
    if (a.unknown !== b.unknown) return a.unknown ? 1 : -1;
    return (b.missingTmdbIds?.length || 0) - (a.missingTmdbIds?.length || 0);
  });
  return results;
}

// A collection member that hasn't actually released yet (status other than
// 'released' — Radarr/TMDB use 'tba'/'announced'/'inCinemas' for anything
// not yet out, e.g. an "Untitled Alien: Romulus Sequel" placeholder, or
// Horizon: An American Saga's still-unreleased later chapters) can never
// have a real file to grab. Counting it as a gap told the owner to go
// request something that doesn't exist as a real release yet. `items` is
// the route's already-enriched missing-movie list (each carrying a `status`
// field read from Radarr's own library record or its live lookup) — split
// out here, pure, so the route's own "shrink totalCount, drop an
// all-unreleased collection entirely" bookkeeping has something testable to
// call rather than burying this in request-handling code.
function partitionByReleaseStatus(items) {
  return {
    released: items.filter(i => i.status === 'released'),
    unreleased: items.filter(i => i.status !== 'released')
  };
}

module.exports = { parseFranchiseCollections, matchCollectionGaps, computeAllGaps, partitionByReleaseStatus };
