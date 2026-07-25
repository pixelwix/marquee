const express = require('express');
const requireAuth = require('./requireAuth');
const requireOwner = require('./requireOwner');
const settle = require('../lib/settle');
const uptimeKuma = require('../lib/uptimeKuma');
const ups = require('../lib/ups');
const router = express.Router();

router.get('/status', requireAuth, requireOwner, async (req, res) => {
  const [monitors, upsStatus] = await Promise.all([
    settle('uptime-kuma read', uptimeKuma.getMonitors(), []),
    settle('UPS query', ups.getStatus(), null)
  ]);
  res.json({ monitors, ups: upsStatus });
});

module.exports = router;
