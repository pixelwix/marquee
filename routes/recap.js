const express = require('express');
const requireAuth = require('./requireAuth');
const requireOwner = require('./requireOwner');
const { verify, sign, buildUnsubscribeUrl } = require('../lib/recapUnsubscribe');
const unsubscribes = require('../lib/recapUnsubscribes');
const { previousMonthRange, listRecapCandidates, fetchUserRecapData, MIN_MONTHLY_PLAYS } = require('../lib/monthlyRecap');
const { renderMonthlyRecapEmail } = require('../lib/monthlyRecapTemplate');
const { sendEmailBatch } = require('../lib/mailer');
const sendLog = require('../lib/recapSendLog');
const auditLog = require('../lib/auditLog');
const uptimeKuma = require('../lib/uptimeKuma');
const router = express.Router();
const siteName = process.env.SITE_NAME || 'Marquee';
const publicUrl = (process.env.PUBLIC_URL || 'http://localhost:4000').replace(/\/$/, '');

// No requireAuth on either of these — whoever clicks the link in their
// inbox isn't necessarily signed into a session on that device. The HMAC
// token (see lib/recapUnsubscribe.js) is the actual authorization here, not
// a login.
function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — ${siteName}</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #12151A; color: #EDEFF3; font-family: system-ui, sans-serif; text-align: center; padding: 24px; box-sizing: border-box; }
  .card { max-width: 420px; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  p { color: #8B92A3; font-size: 14px; line-height: 1.6; margin: 0; }
  a { color: #F0B429; }
</style>
</head>
<body><div class="card">${body}</div></body>
</html>`;
}

router.get('/unsubscribe', async (req, res) => {
  const { user, token } = req.query;
  if (!user || !verify(user, token)) {
    return res.status(403).send(page('Link expired', '<h1>This link isn’t valid</h1><p>It may be out of date. Reply to a recap email if you’d still like to be unsubscribed.</p>'));
  }
  try {
    await unsubscribes.unsubscribe(user);
    auditLog.record({ kind: 'security', action: 'recap_unsubscribe', actorId: user,
      success: true, statusCode: 200, ...auditLog.requestContext(req) })
      .catch(err => console.error('audit log write error:', err.message));
    const resubUrl = `/api/recap/resubscribe?user=${encodeURIComponent(user)}&token=${encodeURIComponent(sign(user))}`;
    res.send(page('Unsubscribed', `<h1>You’re unsubscribed</h1><p>You won’t get the monthly recap anymore. Changed your mind? <a href="${resubUrl}">Resubscribe</a>.</p>`));
  } catch (err) {
    console.error('recap unsubscribe error:', err.message);
    res.status(500).send(page('Something went wrong', '<h1>Couldn’t process that</h1><p>Try again in a bit, or reply to a recap email.</p>'));
  }
});

router.get('/resubscribe', async (req, res) => {
  const { user, token } = req.query;
  if (!user || !verify(user, token)) {
    return res.status(403).send(page('Link expired', '<h1>This link isn’t valid</h1><p>It may be out of date.</p>'));
  }
  try {
    await unsubscribes.resubscribe(user);
    auditLog.record({ kind: 'security', action: 'recap_resubscribe', actorId: user,
      success: true, statusCode: 200, ...auditLog.requestContext(req) })
      .catch(err => console.error('audit log write error:', err.message));
    res.send(page('Resubscribed', '<h1>You’re back on the list</h1><p>You’ll get the next monthly recap.</p>'));
  } catch (err) {
    console.error('recap resubscribe error:', err.message);
    res.status(500).send(page('Something went wrong', '<h1>Couldn’t process that</h1><p>Try again in a bit.</p>'));
  }
});

// ---------- Owner-only: review + selective send ----------
// Deliberately no "send to everyone" endpoint at all — the owner reviews
// /candidates (already filtered to real activity, MIN_MONTHLY_PLAYS) and
// passes back exactly who to send to. /send only ever touches the userIds
// it's given.

router.get('/candidates', requireAuth, requireOwner, async (req, res) => {
  try {
    const period = previousMonthRange();
    const candidates = await listRecapCandidates(period);
    const sendStatuses = await sendLog.statusFor(period.key);
    const withStatus = await Promise.all(candidates.map(async (c) => ({
      ...c,
      unsubscribed: await unsubscribes.isUnsubscribed(c.userId),
      sendStatus: sendStatuses.get(c.userId)?.status || null,
      sentAt: sendStatuses.get(c.userId)?.lastSentAt || null,
    })));
    res.json({ period, minPlays: MIN_MONTHLY_PLAYS, candidates: withStatus });
  } catch (err) {
    console.error('recap candidates error:', err.message);
    res.status(500).json({ error: 'Could not load candidates' });
  }
});

router.get('/history', requireAuth, requireOwner, async (req, res) => {
  try {
    res.json(await sendLog.history(req.query.limit));
  } catch (err) {
    console.error('recap history error:', err.message);
    res.status(500).json({ error: 'Could not load recap history' });
  }
});

router.post('/send', requireAuth, requireOwner, async (req, res) => {
  const { userIds, resend = false } = req.body || {};
  const allowResend = resend === true;
  if (!Array.isArray(userIds) || !userIds.length) {
    return res.status(400).json({ error: 'userIds (non-empty array) is required' });
  }
  try {
    const period = previousMonthRange();
    // Recomputed here, not trusted from the client's earlier /candidates
    // call — the threshold/eligibility check has to hold at send time, not
    // just at review time (someone could otherwise be sent a recap for a
    // month they didn't actually qualify for by the time the request lands).
    const candidates = await listRecapCandidates(period);
    const byId = new Map(candidates.map((c) => [c.userId, c]));
    const uptime = await uptimeKuma.getMonthlyUptime('plex', period);

    const messages = [];
    const skipped = [];
    const preparationFailures = [];
    for (const rawId of userIds) {
      const userId = String(rawId);
      const candidate = byId.get(userId);
      if (!candidate) {
        skipped.push({ userId, reason: `below the ${MIN_MONTHLY_PLAYS}-play threshold, or not a real user this month` });
        continue;
      }
      if (!candidate.email) {
        skipped.push({ userId, reason: 'no email on file' });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      if (await unsubscribes.isUnsubscribed(userId)) {
        skipped.push({ userId, reason: 'unsubscribed' });
        continue;
      }
      // Atomic claim prevents double-clicks/concurrent requests from sending
      // the same user's month twice. A completed send can only be claimed
      // again when the owner explicitly passes resend:true.
      // eslint-disable-next-line no-await-in-loop
      const claim = await sendLog.claim({ periodKey: period.key, userId,
        recipientName: candidate.name, requestedBy: req.session.user.username, resend: allowResend });
      if (!claim.claimed) {
        skipped.push({ userId, reason: claim.reason, sentAt: claim.lastSentAt });
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const data = await fetchUserRecapData(userId, period);
        const html = renderMonthlyRecapEmail({
          recipientName: candidate.name,
          siteName,
          requestUrl: publicUrl,
          period,
          ...data,
          uptime,
          unsubscribeUrl: buildUnsubscribeUrl(userId),
        });
        messages.push({ userId, attemptId: claim.attemptId, to: candidate.email,
          subject: `Your ${siteName} recap — ${period.label}`, html });
      } catch (err) {
        // eslint-disable-next-line no-await-in-loop
        await sendLog.finish(claim.attemptId, { ok: false, error: err.message });
        preparationFailures.push({ userId, ok: false, error: err.message });
      }
    }

    const sendResults = await sendEmailBatch(messages);
    for (let i = 0; i < sendResults.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sendLog.finish(messages[i].attemptId, { ok: sendResults[i].ok, error: sendResults[i].error || null });
    }
    const failed = [...preparationFailures, ...sendResults
      .map((r, i) => ({ userId: messages[i].userId, ...r }))
      .filter((r) => !r.ok)];

    res.json({
      period,
      requested: userIds.length,
      sent: sendResults.filter((r) => r.ok).length,
      failed,
      skipped,
    });
  } catch (err) {
    console.error('recap send error:', err.message);
    res.status(500).json({ error: 'Send failed' });
  }
});

module.exports = router;
