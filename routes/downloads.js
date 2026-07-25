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
  // qBittorrent's /torrents/info returns its entire history, including torrents
  // finished long ago that are just sitting there seeding — only actually-in-
  // progress items (or ones with a real problem) belong in a "queue" view.
  // SABnzbd's queue endpoint doesn't have this issue: completed items move to
  // its separate history endpoint automatically.
  const torrentItems = (torrents.status === 'fulfilled' ? torrents.value : [])
    .filter(t => t.progress < 100 || t.state === 'error');
  const items = [
    ...torrentItems,
    ...(usenet.status === 'fulfilled' ? usenet.value : [])
  ];
  items.sort((a, b) => (STATE_RANK[a.state] ?? 3) - (STATE_RANK[b.state] ?? 3) || b.progress - a.progress);
  res.json(items);
});

module.exports = router;
