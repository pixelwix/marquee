const axios = require('axios');

// One-click "force import" for a stuck Sonarr/Radarr import alert — reuses the
// exact same manual-import candidate lookup + ManualImport command the admin
// panel's manual-import UI already drives (routes/sonarr.js / routes/radarr.js),
// just fired for every matched candidate at once instead of one the owner
// hand-picked. No blocklist, no file deletion (the household's standing
// "don't blocklist" decision, 2026-08-13) — it only re-affirms the series/
// movie match Sonarr/Radarr itself already found and pushes past whatever
// rejection blocked the automatic import.

function cfg(app) {
  return app === 'radarr'
    ? { url: process.env.RADARR_URL, key: process.env.RADARR_API_KEY }
    : { url: process.env.SONARR_URL, key: process.env.SONARR_API_KEY };
}

async function run(app, downloadId) {
  const { url, key } = cfg(app);
  const headers = { 'X-Api-Key': key };
  const { data: candidates } = await axios.get(`${url}/api/v3/manualimport`, { params: { downloadId }, headers });

  const files = (candidates || []).map((f) => {
    const common = {
      path: f.path,
      folderName: f.folderName,
      downloadId: f.downloadId,
      quality: f.quality,
      languages: f.languages,
      releaseGroup: f.releaseGroup,
      indexerFlags: f.indexerFlags,
    };
    if (app === 'radarr') {
      return f.movie?.id ? { ...common, movieId: f.movie.id } : null;
    }
    const episodeIds = (f.episodes || []).map((e) => e.id);
    return f.series?.id && episodeIds.length ? { ...common, seriesId: f.series.id, episodeIds } : null;
  }).filter(Boolean);

  if (!files.length) {
    return {
      imported: 0,
      message: (candidates || []).length
        ? 'Files are there but none matched a series/movie automatically — review it in the admin panel'
        : 'No files left in that download folder',
    };
  }

  await axios.post(`${url}/api/v3/command`, { name: 'ManualImport', files, importMode: 'auto' }, { headers });
  return { imported: files.length };
}

module.exports = { run };
