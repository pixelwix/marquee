const express = require('express');
const axios = require('axios');
const { parseStringPromise } = require('xml2js');
const router = express.Router();

const PLEX_HEADERS = {
  'X-Plex-Product': 'skyn3t',
  'X-Plex-Client-Identifier': process.env.PLEX_CLIENT_ID,
  'Accept': 'application/json'
};

// Step 1: frontend asks us for a PIN, we ask plex.tv, hand back the code + our pin id
router.post('/plex/pin', async (req, res) => {
  try {
    const { data } = await axios.post(
      'https://plex.tv/api/v2/pins?strong=true',
      null,
      { headers: PLEX_HEADERS }
    );
    // Stash the pin id in a short-lived cookie so the callback step knows what to poll
    res.cookie('plex_pin_id', data.id, { httpOnly: true, maxAge: 5 * 60 * 1000 });
    res.json({ code: data.code, clientId: process.env.PLEX_CLIENT_ID });
  } catch (err) {
    console.error('plex pin error', err.response?.data || err.message);
    res.status(502).json({ error: 'Could not reach plex.tv' });
  }
});

// Step 2: frontend polls us after the user approves the code on app.plex.tv
router.get('/plex/poll', async (req, res) => {
  const pinId = req.cookies.plex_pin_id;
  if (!pinId) return res.status(400).json({ error: 'No pending sign-in' });

  try {
    const { data } = await axios.get(
      `https://plex.tv/api/v2/pins/${pinId}`,
      { headers: PLEX_HEADERS }
    );

    if (!data.authToken) {
      return res.json({ status: 'pending' });
    }

    // We have a user token. Find out who they are.
    const { data: plexUser } = await axios.get('https://plex.tv/api/v2/user', {
      headers: { ...PLEX_HEADERS, 'X-Plex-Token': data.authToken }
    });

    const { allowed, isOwner } = await isAllowedOnServer(plexUser.id, data.authToken);
    if (!allowed) {
      return res.status(403).json({ status: 'denied', error: 'This Plex account does not have access to the server.' });
    }

    req.session.user = {
      id: plexUser.id,
      username: plexUser.username || plexUser.title,
      thumb: plexUser.thumb,
      plexToken: data.authToken,
      isOwner
    };
    res.clearCookie('plex_pin_id');
    res.json({ status: 'ok', user: req.session.user.username, isOwner });
  } catch (err) {
    console.error('plex poll error', err.response?.data || err.message);
    res.status(502).json({ error: 'Could not verify sign-in' });
  }
});

// Checks whether a plex.tv account id is the server owner or a user it's been shared with
async function isAllowedOnServer(userId, userToken) {
  console.log(`[access-check] verifying plex.tv user id=${userId} against machine id=${process.env.PLEX_MACHINE_ID}`);

  // Owner check: does this token see the server as itself?
  try {
    const { data: resources } = await axios.get('https://plex.tv/api/v2/resources', {
      params: { includeHttps: 1 },
      headers: { ...PLEX_HEADERS, 'X-Plex-Token': userToken }
    });
    const seenIds = resources.map(r => r.clientIdentifier);
    console.log('[access-check] resources visible to this token:', seenIds);
    const ownsServer = seenIds.includes(process.env.PLEX_MACHINE_ID);
    if (ownsServer) {
      console.log('[access-check] PASSED: owner/resources match');
      return { allowed: true, isOwner: true };
    }
  } catch (e) {
    console.error('[access-check] resources lookup failed:', e.response?.status, e.response?.data || e.message);
  }

  // Shared-user check: ask the server owner's account who it's shared with, and confirm
  // that *this specific user* is shared onto *this specific server* — checking user
  // presence and machine-id presence independently anywhere in the document would let
  // any user shared to any of your servers slip through as long as anyone was shared
  // to this one.
  try {
    const { data: friendsXml } = await axios.get('https://plex.tv/api/users', {
      headers: { ...PLEX_HEADERS, 'X-Plex-Token': process.env.PLEX_ADMIN_TOKEN },
      responseType: 'text'
    });
    const parsed = await parseStringPromise(friendsXml);
    const users = parsed?.MediaContainer?.User || [];
    const match = users.find(u => u.$?.id === String(userId));
    const sharedServers = match?.Server || [];
    const hasAccess = sharedServers.some(s => s.$?.machineIdentifier === process.env.PLEX_MACHINE_ID);
    console.log(`[access-check] shared-user found: ${!!match}, has access to this server: ${hasAccess}`);
    if (hasAccess) {
      console.log('[access-check] PASSED: shared-user match');
      return { allowed: true, isOwner: false };
    }
    console.log('[access-check] FAILED: no owner match and no shared-user match');
    return { allowed: false, isOwner: false };
  } catch (e) {
    console.error('[access-check] shared-user lookup failed:', e.response?.status, e.response?.data || e.message);
    return { allowed: false, isOwner: false };
  }
}

router.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not signed in' });
  res.json({ username: req.session.user.username, thumb: req.session.user.thumb, isOwner: req.session.user.isOwner });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ status: 'ok' }));
});

module.exports = router;
