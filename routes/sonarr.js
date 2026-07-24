const express = require('express');
const axios = require('axios');
const requireAuth = require('./requireAuth');
const router = express.Router();

router.get('/today', requireAuth, async (req, res) => {
  try {
    const now = new Date();
    const localToday = localDateString(now);

    // Query a day of buffer on each side so a UTC/local timezone mismatch
    // can't silently cut off episodes airing near midnight, then filter
    // precisely to the container's actual local "today" below.
    const bufferStart = new Date(now); bufferStart.setDate(bufferStart.getDate() - 1);
    const bufferEnd = new Date(now); bufferEnd.setDate(bufferEnd.getDate() + 1);

    const { data } = await axios.get(`${process.env.SONARR_URL}/api/v3/calendar`, {
      params: {
        start: localDateString(bufferStart),
        end: localDateString(bufferEnd),
        includeSeries: true
      },
      headers: { 'X-Api-Key': process.env.SONARR_API_KEY }
    });

    const items = data
      .filter(ep => localDateString(new Date(ep.airDateUtc)) === localToday)
      .map(ep => ({
        series: ep.series?.title,
        episode: `S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}`,
        title: ep.title,
        overview: ep.overview || ep.series?.overview || '',
        airTime: ep.airDateUtc,
        hasFile: ep.hasFile,
        poster: ep.series?.images?.find(i => i.coverType === 'poster')?.remoteUrl || null
      }))
      .sort((a, b) => new Date(a.airTime) - new Date(b.airTime));

    res.json(items);
  } catch (err) {
    console.error('sonarr error:', err.code || err.response?.status, err.message);
    res.status(502).json({ error: 'Could not reach Sonarr' });
  }
});

// Formats a Date as YYYY-MM-DD using the container's local timezone (set via
// the TZ env var) rather than UTC — this is what "today" actually means to you.
function localDateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

module.exports = router;
