const express = require('express');
const requireAuth = require('./requireAuth');
const settle = require('../lib/settle');
const qbittorrent = require('../lib/qbittorrent');
const sabnzbd = require('../lib/sabnzbd');
const router = express.Router();

router.get('/queue', requireAuth, async (req, res) => {
  const [torrents, usenet] = await Promise.all([
    settle('qbittorrent queue', process.env.QBITTORRENT_URL ? qbittorrent.getTorrents() : Promise.resolve([]), []),
    settle('sabnzbd queue', process.env.SABNZBD_URL ? sabnzbd.getQueue() : Promise.resolve([]), [])
  ]);
  // Actively downloading only — qBittorrent's /torrents/info includes its entire
  // history (finished, seeding, stalled, errored), and this is meant to answer
  // "what's coming in right now," not double as a client for managing every torrent.
  const items = [...torrents, ...usenet].filter(item => item.state === 'downloading');
  items.sort((a, b) => b.progress - a.progress);
  res.json(items);
});

module.exports = router;
