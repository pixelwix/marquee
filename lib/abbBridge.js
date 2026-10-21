const axios = require('axios');

// The AudioBook Bay bridge (github.com/pixelwix/abb-torznab) that ReadMeABook searches
// first. Marquee tells it which edition a requester wants for a book — full cast /
// dramatized, standard reading, or either — right before the request goes to ReadMeABook,
// so the bridge filters that book's search accordingly.
const EDITIONS = ['produced', 'narrated', 'any'];

function isConfigured() {
  return !!(process.env.ABB_BRIDGE_URL && process.env.ABB_BRIDGE_TOKEN);
}

async function setEdition(title, edition) {
  if (!isConfigured() || !EDITIONS.includes(edition)) return false;
  await axios.post(`${process.env.ABB_BRIDGE_URL}/prefs`, { title, preference: edition }, {
    headers: { 'X-Token': process.env.ABB_BRIDGE_TOKEN },
    timeout: 8000
  });
  return true;
}

module.exports = { isConfigured, setEdition, EDITIONS };
