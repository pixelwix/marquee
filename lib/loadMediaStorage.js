// lib/mediaStorage.js is deployment-local and gitignored (it reveals real NAS mount details),
// so a clean checkout — CI, or a Git-stack deploy that builds straight from GitHub — doesn't
// have it. Load it from the first place it exists: next to this file (Mac / deploy.sh builds),
// then MEDIA_STORAGE_MODULE (an absolute path, e.g. a copy kept in the mounted data/ folder),
// else fall back to the same "no NAS volumes" shape getVolumes() returns when MEDIA_MOUNT_DIR
// isn't set. Never require('./mediaStorage') directly at top level.
const path = require('path');

const FALLBACK = { getVolumes: async () => [] };

function loadMediaStorage(candidates = [path.join(__dirname, 'mediaStorage'), process.env.MEDIA_STORAGE_MODULE]) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return require(candidate);
    } catch (e) {
      // Only "this candidate doesn't exist" moves on; a candidate that exists but fails to load
      // (including its own missing requires, whose message also lists it in the require stack)
      // must still fail loudly.
      const firstLine = String(e.message).split('\n')[0];
      if (e.code !== 'MODULE_NOT_FOUND' || !firstLine.includes(`'${candidate}'`)) throw e;
    }
  }
  return FALLBACK;
}

module.exports = { loadMediaStorage, FALLBACK };
