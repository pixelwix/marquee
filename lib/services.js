const fs = require('fs');

function isConfigured(serviceName) {
  switch (serviceName) {
    case 'plex':
      return !!(process.env.PLEX_SERVER_URL && process.env.PLEX_ADMIN_TOKEN);
    case 'tautulli':
      return !!(process.env.TAUTULLI_URL && process.env.TAUTULLI_API_KEY);
    case 'overseerr':
      return !!(process.env.OVERSEERR_URL && process.env.OVERSEERR_API_KEY);
    case 'sonarr':
      return !!(process.env.SONARR_URL && process.env.SONARR_API_KEY);
    case 'radarr':
      return !!(process.env.RADARR_URL && process.env.RADARR_API_KEY);
    case 'qbittorrent':
      return !!process.env.QBITTORRENT_URL;
    case 'sabnzbd':
      return !!(process.env.SABNZBD_URL && process.env.SABNZBD_API_KEY);
    case 'downloads':
      return !!(process.env.QBITTORRENT_URL || (process.env.SABNZBD_URL && process.env.SABNZBD_API_KEY));
    case 'uptimeKuma':
      return !!(process.env.UPTIME_KUMA_DB_PATH && fs.existsSync(process.env.UPTIME_KUMA_DB_PATH));
    case 'nutUps':
      return !!process.env.NUT_HOST;
    case 'systemStatus':
      return !!((process.env.UPTIME_KUMA_DB_PATH && fs.existsSync(process.env.UPTIME_KUMA_DB_PATH)) || process.env.NUT_HOST);
    default:
      return false;
  }
}

function getServicesState() {
  return {
    plex: isConfigured('plex'),
    tautulli: isConfigured('tautulli'),
    overseerr: isConfigured('overseerr'),
    sonarr: isConfigured('sonarr'),
    radarr: isConfigured('radarr'),
    qbittorrent: isConfigured('qbittorrent'),
    sabnzbd: isConfigured('sabnzbd'),
    downloads: isConfigured('downloads'),
    uptimeKuma: isConfigured('uptimeKuma'),
    nutUps: isConfigured('nutUps'),
    systemStatus: isConfigured('systemStatus')
  };
}

module.exports = { isConfigured, getServicesState };
