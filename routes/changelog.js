const express = require('express');
const requireAuth = require('./requireAuth');
const requireOwner = require('./requireOwner');
const { getChangelog } = require('../lib/changelog');
const router = express.Router();

// Owner-only: TODO.md is written for the owner (file names, root causes), not the family.
// The footer version itself stays visible to everyone; only this popup is gated.
router.get('/', requireAuth, requireOwner, (req, res) => {
  res.json({ current: require('../package.json').version, versions: getChangelog() });
});

module.exports = router;
