const settle = require('./settle');
const qbittorrent = require('./qbittorrent');
const sabnzbd = require('./sabnzbd');

// Merges qBittorrent's torrent queue and SABnzbd's usenet queue into one list.
// Shared by routes/downloads.js's /queue and /queue/attention routes, and
// lib/issueWatchdog.js, which feeds stuck/failed items into the Alerts
// panel/push pipeline.
async function fetchAll() {
  const [torrents, usenet] = await Promise.all([
    settle('qbittorrent queue', process.env.QBITTORRENT_URL ? qbittorrent.getTorrents() : Promise.resolve([]), []),
    settle('sabnzbd queue', process.env.SABNZBD_URL ? sabnzbd.getQueue() : Promise.resolve([]), [])
  ]);
  return [...torrents, ...usenet];
}

module.exports = { fetchAll };
