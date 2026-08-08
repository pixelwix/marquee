// Single source of truth for which .env fields belong to which integration —
// used both by the health-check grid (lib/serviceHealth.js) and the
// per-service edit popups (routes/settings.js). Field-level descriptions
// mirror the ones already in .env's own comments where one exists.
const SERVICES = [
  {
    key: 'plex', label: 'Plex',
    fields: [
      { key: 'PLEX_SERVER_URL', label: 'Server URL', description: 'URL to reach your Plex server.' },
      { key: 'PLEX_ADMIN_TOKEN', label: 'Admin Token', description: 'Admin/owner token for your Plex server.' },
      { key: 'PLEX_MACHINE_ID', label: 'Machine Identifier', description: "Your Plex server's machine identifier." },
      { key: 'PLEX_CLIENT_ID', label: 'Client ID', description: 'A stable random UUID identifying this app to plex.tv (generate once, keep forever).' }
    ]
  },
  {
    key: 'tautulli', label: 'Tautulli',
    fields: [
      { key: 'TAUTULLI_URL', label: 'Tautulli URL', description: 'URL to reach Tautulli.' },
      { key: 'TAUTULLI_API_KEY', label: 'API Key', description: 'Tautulli API key.' },
      { key: 'TAUTULLI_SECTION_MOVIES', label: 'Movies Section ID', description: 'Plex library section ID for movies — optional, splits Recently Added/Top of Month by library.' },
      { key: 'TAUTULLI_SECTION_TV', label: 'TV Section ID', description: 'Plex library section ID for TV — optional.' },
      { key: 'TAUTULLI_SECTION_ANIME', label: 'Anime Section ID', description: 'Plex library section ID for anime — optional.' }
    ]
  },
  {
    key: 'overseerr', label: 'Overseerr',
    fields: [
      { key: 'OVERSEERR_URL', label: 'Overseerr URL', description: 'URL to reach Overseerr/Jellyseerr.' },
      { key: 'OVERSEERR_API_KEY', label: 'API Key', description: 'Overseerr API key.' },
      { key: 'OVERSEERR_WEBHOOK_SECRET', label: 'Webhook Secret', description: "Shared secret this app checks against Overseerr's webhook Authorization header." },
      { key: 'OVERSEERR_WEBHOOK_FORWARD_URL', label: 'Webhook Forward URL', description: 'Optional — forwards Overseerr webhook payloads on to another existing integration.' }
    ]
  },
  {
    key: 'sonarr', label: 'Sonarr',
    fields: [
      { key: 'SONARR_URL', label: 'Sonarr URL', description: 'URL to reach Sonarr.' },
      { key: 'SONARR_API_KEY', label: 'API Key', description: 'Sonarr API key.' }
    ]
  },
  {
    key: 'radarr', label: 'Radarr',
    fields: [
      { key: 'RADARR_URL', label: 'Radarr URL', description: 'URL to reach Radarr.' },
      { key: 'RADARR_API_KEY', label: 'API Key', description: 'Radarr API key.' }
    ]
  },
  {
    key: 'prowlarr', label: 'Prowlarr',
    fields: [
      { key: 'PROWLARR_URL', label: 'Prowlarr URL', description: 'URL to reach Prowlarr.' },
      { key: 'PROWLARR_API_KEY', label: 'API Key', description: 'Prowlarr API key.' }
    ]
  },
  {
    key: 'qbittorrent', label: 'qBittorrent',
    fields: [
      { key: 'QBITTORRENT_URL', label: 'WebUI URL', description: 'URL to reach qBittorrent WebUI.' },
      { key: 'QBITTORRENT_API_KEY', label: 'API Key', description: 'qBittorrent >= 5.2.0 only (WebUI > Settings > General). Preferred over Username/Password below when set — leave Username/Password blank if you use this.' },
      { key: 'QBITTORRENT_USERNAME', label: 'Username', description: 'WebUI username — only used if API Key above is blank.' },
      { key: 'QBITTORRENT_PASSWORD', label: 'Password', description: 'WebUI password — only used if API Key above is blank.' }
    ]
  },
  {
    key: 'sabnzbd', label: 'SABnzbd',
    fields: [
      { key: 'SABNZBD_URL', label: 'SABnzbd URL', description: 'URL to reach SABnzbd.' },
      { key: 'SABNZBD_API_KEY', label: 'API Key', description: 'SABnzbd API key.' }
    ]
  },
  {
    key: 'uptimeKuma', label: 'Uptime Kuma',
    fields: [
      { key: 'UPTIME_KUMA_DATA_DIR', label: 'Data Directory', description: "Uptime Kuma's data directory on the host — bind-mounted read-only into this container." },
      { key: 'UPTIME_KUMA_DB_PATH', label: 'Database Path', description: 'Path to kuma.db as seen inside this container (matches the bind-mount destination).' },
      { key: 'UPTIME_KUMA_WEBHOOK_SECRET', label: 'Webhook Secret', description: "Shared secret this app checks against Uptime Kuma's webhook notification (header or ?secret= query param)." }
    ]
  },
  {
    key: 'mediaStorage', label: 'Media Storage',
    fields: [
      { key: 'MEDIA_MOUNT_DIR', label: 'Mount Directory', description: "Host path bind-mounted read-only into this container (see docker-compose.yml) — parent directory containing your NAS's media share mounts, one subdirectory per share. Powers the admin Disk Space panel's real physical-volume data, independent of Radarr/Sonarr's own diskspace API." }
    ]
  },
  {
    key: 'nutUps', label: 'NUT UPS',
    fields: [
      { key: 'NUT_HOST', label: 'Host', description: 'Hostname/IP of the NUT server.' },
      { key: 'NUT_PORT', label: 'Port', description: 'NUT server port (default 3493).' },
      { key: 'NUT_USERNAME', label: 'Username', description: 'NUT username.' },
      { key: 'NUT_PASSWORD', label: 'Password', description: 'NUT password.' },
      { key: 'NUT_UPS_NAME', label: 'UPS Name', description: 'Name of the UPS as configured in NUT.' }
    ]
  },
  {
    // The monthly recap doesn't send SMTP directly — it triggers Tautulli's
    // own Email notifier (see lib/mailer.js for why: that notifier's
    // recipient field is set right before every send, and Tautulli masks
    // the password on read, so this app has to hold its own full copy of
    // the SMTP config rather than just pointing at Tautulli's). Tautulli
    // itself must already have notifier TAUTULLI_EMAIL_NOTIFIER_ID configured
    // as an Email agent with matching settings — this only edits this app's
    // own copy, not Tautulli's.
    key: 'email', label: 'Email (Recap)',
    fields: [
      { key: 'TAUTULLI_EMAIL_NOTIFIER_ID', label: 'Tautulli Notifier ID', description: "The Email notifier's ID in Tautulli (Settings > Notification Agents)." },
      { key: 'EMAIL_SMTP_SERVER', label: 'SMTP Server', description: 'SMTP hostname, e.g. smtp.mail.me.com.' },
      { key: 'EMAIL_SMTP_PORT', label: 'SMTP Port', description: 'SMTP port — typically 587.' },
      { key: 'EMAIL_SMTP_USER', label: 'SMTP Username', description: 'Usually the full sending account email address.' },
      { key: 'EMAIL_SMTP_PASSWORD', label: 'SMTP Password', description: 'An app-specific password if your provider requires one (e.g. iCloud, Gmail).' },
      { key: 'EMAIL_TLS', label: 'Encryption', description: '0 = None, 1 = STARTTLS (typically port 587), 2 = SSL/TLS (typically port 465).' },
      { key: 'EMAIL_FROM', label: 'From Address', description: 'The address recap emails are sent from.' },
      { key: 'EMAIL_FROM_NAME', label: 'From Name', description: 'Display name recap emails are sent as.' }
    ]
  }
];

module.exports = { SERVICES };
