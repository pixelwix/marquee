const express = require('express');
const requireAuth = require('./requireAuth');
const qbittorrent = require('../lib/qbittorrent');
const sabnzbd = require('../lib/sabnzbd');
const router = express.Router();

router.get('/queue', requireAuth, async (req, res) => {
  const [torrents, usenet] = await Promise.allSettled([
    process.env.QBITTORRENT_URL ? qbittorrent.getTorrents() : Promise.resolve([]),
    process.env.SABNZBD_URL ? sabnzbd.getQueue() : Promise.resolve([])
  ]);
  if (torrents.status === 'rejected') {
    console.error('qbittorrent queue error:', torrents.reason.code || torrents.reason.response?.status, torrents.reason.message);
  }
  if (usenet.status === 'rejected') {
    console.error('sabnzbd queue error:', usenet.reason.code || usenet.reason.response?.status, usenet.reason.message);
  }
  // Actively downloading only — qBittorrent's /torrents/info includes its entire
  // history (finished, seeding, stalled, errored), and this is meant to answer
  // "what's coming in right now," not double as a client for managing every torrent.
  const items = [
    ...(torrents.status === 'fulfilled' ? torrents.value : []),
    ...(usenet.status === 'fulfilled' ? usenet.value : [])
  ].filter(item => item.state === 'downloading');
  items.sort((a, b) => b.progress - a.progress);
  res.json(items);
});

module.exports = router;
