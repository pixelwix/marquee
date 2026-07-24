const express = require('express');
const axios = require('axios');
const requireAuth = require('./requireAuth');
const router = express.Router();

router.get('/upcoming', requireAuth, async (req, res) => {
  try {
    const start = new Date().toISOString().slice(0, 10);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 45);
    const end = endDate.toISOString().slice(0, 10);

    const { data } = await axios.get(`${process.env.RADARR_URL}/api/v3/calendar`, {
      params: { start, end },
      headers: { 'X-Api-Key': process.env.RADARR_API_KEY }
    });
    const items = data
      .map(m => ({
        title: m.title,
        releaseDate: m.physicalRelease || m.inCinemas || m.digitalRelease,
        overview: m.overview,
        hasFile: m.hasFile,
        poster: m.images?.find(i => i.coverType === 'poster')?.remoteUrl || null
      }))
      .sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate));
    res.json(items);
  } catch (err) {
    console.error('radarr error:', err.code || err.response?.status, err.message);
    res.status(502).json({ error: 'Could not reach Radarr' });
  }
});

module.exports = router;
