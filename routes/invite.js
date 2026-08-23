const express = require('express');
const requireAuth = require('./requireAuth');
const requireOwner = require('./requireOwner');
const plexShare = require('../lib/plexShare');
const { fetchInviteStats } = require('../lib/inviteStats');
const { fetchAllUsers } = require('../lib/monthlyRecap');
const { renderWelcomeEmail } = require('../lib/welcomeEmailTemplate');
const { sendEmail } = require('../lib/mailer');
const auditLog = require('../lib/auditLog');
const router = express.Router();
const siteName = process.env.SITE_NAME || 'Marquee';
const publicUrl = (process.env.PUBLIC_URL || 'http://localhost:4000').replace(/\/$/, '');

// Owner-only, all of it — granting/revoking real access to the Plex server is
// exactly the kind of action that stays a human decision, same standing rule as
// every other mutating admin action in this app (notice board, recap send).

router.get('/libraries', requireAuth, requireOwner, async (req, res) => {
  try {
    res.json(await plexShare.getLibraries());
  } catch (err) {
    console.error('invite libraries error:', err.message);
    res.status(502).json({ error: 'Could not load libraries from Plex' });
  }
});

router.get('/shares', requireAuth, requireOwner, async (req, res) => {
  try {
    // Confirmed live: the account owner never appears in this list at all (it's
    // purely "who you've shared the server with"), and every entry's `owned` field
    // is true regardless of who the recipient is — it describes the server being
    // shared (always yours, from this call), not the recipient. Not a useful filter;
    // every entry returned here is a real shared guest.
    res.json(await plexShare.getSharedUsers());
  } catch (err) {
    console.error('invite shares error:', err.message);
    res.status(502).json({ error: 'Could not load current shares from Plex' });
  }
});

// Re-derives the real library list on every request rather than trusting the IDs a
// client submits — same "server re-derives, never trusts the client" rule as every
// other mutating action in this codebase (e.g. routes/alerts.js's qbit-remove-torrents).
async function validatedLibraryIds(requestedIds) {
  if (!Array.isArray(requestedIds) || !requestedIds.length) {
    throw Object.assign(new Error('At least one library must be selected'), { status: 400 });
  }
  const real = await plexShare.getLibraries();
  const realIds = new Set(real.map((l) => l.id));
  const invalid = requestedIds.filter((id) => !realIds.has(String(id)));
  if (invalid.length) {
    throw Object.assign(new Error(`Not a real library: ${invalid.join(', ')}`), { status: 400 });
  }
  return { ids: requestedIds.map(String), libraries: real.filter((l) => requestedIds.includes(l.id)) };
}

router.post('/', requireAuth, requireOwner, async (req, res) => {
  const { email, librarySectionIds } = req.body || {};
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }
  try {
    const { ids, libraries } = await validatedLibraryIds(librarySectionIds);
    const invited = await plexShare.inviteUser({ email, librarySectionIds: ids });

    // Plex sends its own invite email/notification separately, but it has no way to
    // suppress that — this is the Marquee-branded welcome on top of it, made to be
    // the complete, useful one by embedding the same real accept link Plex's own
    // email would (from inviteUser()'s response, same field getSharedUsers() would
    // eventually surface as `inviteToken` too) so the recipient doesn't need Plex's.
    let welcomeEmailSent = false;
    try {
      const stats = await fetchInviteStats();
      const acceptUrl = invited?.inviteToken
        ? `https://clients.plex.tv/servers/shared_servers/accept?invite_token=${encodeURIComponent(invited.inviteToken)}`
        : undefined;
      const html = renderWelcomeEmail({
        recipientName: email.split('@')[0],
        inviterName: req.session.user.username,
        siteName,
        requestUrl: publicUrl,
        libraries,
        stats,
        acceptUrl,
      });
      await sendEmail({ to: email, subject: `Welcome to ${siteName}`, html });
      welcomeEmailSent = true;
    } catch (err) {
      // Non-fatal — the actual Plex access grant above already succeeded, and
      // Plex's own invite email still went out. A failed welcome email shouldn't
      // make the whole invite look like it failed.
      console.error('invite: welcome email failed (non-fatal, access was still granted):', err.message);
    }

    auditLog.record({ kind: 'admin', action: 'POST /api/invite', actorId: req.session.user.id,
      actorName: req.session.user.username, success: true, statusCode: 200,
      detail: { email, libraries: libraries.map((l) => l.title), welcomeEmailSent },
      ...auditLog.requestContext(req) }).catch((err) => console.error('audit log write error:', err.message));

    res.json({ status: 'ok', email, libraries, welcomeEmailSent });
  } catch (err) {
    console.error('invite send error:', err.message);
    auditLog.record({ kind: 'admin', action: 'POST /api/invite', actorId: req.session.user.id,
      actorName: req.session.user.username, success: false, statusCode: err.status || 502,
      detail: { email, error: err.message }, ...auditLog.requestContext(req) })
      .catch((auditErr) => console.error('audit log write error:', auditErr.message));
    res.status(err.status || 502).json({ error: err.message || 'Invite failed' });
  }
});

router.patch('/:shareId', requireAuth, requireOwner, async (req, res) => {
  try {
    const { ids, libraries } = await validatedLibraryIds(req.body?.librarySectionIds);
    await plexShare.updateShareLibraries({ shareId: req.params.shareId, librarySectionIds: ids });
    auditLog.record({ kind: 'admin', action: 'PATCH /api/invite/:shareId', actorId: req.session.user.id,
      actorName: req.session.user.username, success: true, statusCode: 200,
      detail: { shareId: req.params.shareId, libraries: libraries.map((l) => l.title) },
      ...auditLog.requestContext(req) }).catch((err) => console.error('audit log write error:', err.message));
    res.json({ status: 'ok', libraries });
  } catch (err) {
    console.error('invite update error:', err.message);
    res.status(err.status || 502).json({ error: err.message || 'Update failed' });
  }
});

router.delete('/:shareId', requireAuth, requireOwner, async (req, res) => {
  try {
    await plexShare.revokeShare(req.params.shareId);
    auditLog.record({ kind: 'admin', action: 'DELETE /api/invite/:shareId', actorId: req.session.user.id,
      actorName: req.session.user.username, success: true, statusCode: 200,
      detail: { shareId: req.params.shareId }, ...auditLog.requestContext(req) })
      .catch((err) => console.error('audit log write error:', err.message));
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('invite revoke error:', err.message);
    res.status(502).json({ error: 'Revoke failed' });
  }
});

// Same "test email" pattern as routes/recap.js's /test-email — proves the welcome
// email pipeline (Tautulli stats, mailer, real render) end to end without touching
// Plex sharing at all.
router.post('/test-email', requireAuth, requireOwner, async (req, res) => {
  const to = req.body?.to || (await fetchAllUsers()).find(
    (u) => String(u.user_id) === String(req.session.user.id)
  )?.email;
  if (!to) {
    return res.status(400).json({ error: "No email on file for your account in Tautulli — pass a \"to\" address explicitly." });
  }
  try {
    const stats = await fetchInviteStats();
    const libraries = await plexShare.getLibraries();
    const html = renderWelcomeEmail({
      recipientName: to.split('@')[0],
      inviterName: req.session.user.username,
      siteName,
      requestUrl: publicUrl,
      libraries,
      stats,
    });
    await sendEmail({ to, subject: `${siteName} — test welcome email`, html });
    res.json({ status: 'ok', to });
  } catch (err) {
    console.error('invite test-email error:', err.message);
    res.status(502).json({ error: err.message || 'Send failed' });
  }
});

module.exports = router;
