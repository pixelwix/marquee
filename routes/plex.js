const express = require('express');
const axios = require('axios');
const requireAuth = require('./requireAuth');
const router = express.Router();

// Only actual Plex thumb/art paths are allowed through — anything else could be used
// to make arbitrary authenticated GET requests to the Plex server with the admin token.
const IMAGE_PATH_RE = /^\/library\/metadata\/\d+\/(thumb|art)\/\d+$/;

// Proxies Plex thumbnail images so we don't expose the admin token to the browser
router.get('/image', requireAuth, async (req, res) => {
  if (!IMAGE_PATH_RE.test(req.query.path || '')) {
    return res.status(400).end();
  }
  try {
    const { data, headers } = await axios.get(`${process.env.PLEX_SERVER_URL}${req.query.path}`, {
      headers: { 'X-Plex-Token': process.env.PLEX_ADMIN_TOKEN },
      responseType: 'arraybuffer'
    });
    res.set('Content-Type', headers['content-type']);
    res.send(data);
  } catch (err) {
    res.status(502).end();
  }
});

module.exports = router;
