const express = require('express');
const requireOwner = require('./requireOwner');
const uptimeKuma = require('../lib/uptimeKuma');
const ups = require('../lib/ups');
const router = express.Router();

router.get('/status', requireOwner, async (req, res) => {
  const [monitors, upsStatus] = await Promise.allSettled([
    uptimeKuma.getMonitors(),
    ups.getStatus()
  ]);
  if (monitors.status === 'rejected') console.error('uptime-kuma read error:', monitors.reason.message);
  if (upsStatus.status === 'rejected') console.error('UPS query error:', upsStatus.reason.message);
  res.json({
    monitors: monitors.status === 'fulfilled' ? monitors.value : [],
    ups: upsStatus.status === 'fulfilled' ? upsStatus.value : null
  });
});

module.exports = router;
