const express = require('express');
const requireAuth = require('./requireAuth');
const qbittorrent = require('../lib/qbittorrent');
const sabnzbd = require('../lib/sabnzbd');
const router = express.Router();

const STATE_RANK = { downloading: 0, checking: 1, queued: 2 };

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
  const items = [
    ...(torrents.status === 'fulfilled' ? torrents.value : []),
    ...(usenet.status === 'fulfilled' ? usenet.value : [])
  ];
  items.sort((a, b) => (STATE_RANK[a.state] ?? 3) - (STATE_RANK[b.state] ?? 3) || b.progress - a.progress);
  res.json(items);
});

module.exports = router;
