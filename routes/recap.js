const express = require('express');
const requireAuth = require('./requireAuth');
const requireOwner = require('./requireOwner');
const { verify, sign, buildUnsubscribeUrl } = require('../lib/recapUnsubscribe');
const unsubscribes = require('../lib/recapUnsubscribes');
const { previousMonthRange, listRecapCandidates, fetchUserRecapData, fetchAllUsers, MIN_MONTHLY_PLAYS } = require('../lib/monthlyRecap');
const { renderMonthlyRecapEmail } = require('../lib/monthlyRecapTemplate');
const { sendEmail, sendEmailBatch } = require('../lib/mailer');
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

// Sends a small, clearly-labeled test message — not a real recap — through
// the exact same lib/mailer.js path a real send uses, so "it worked" here
// means the whole pipeline (Tautulli notifier config, SMTP credentials,
// network path) is actually confirmed end to end, not just that config
// values are present. Defaults the recipient to the requesting owner's own
// Tautulli email (matched by their Plex session user id) so the common case
// needs no typing; `to` in the body overrides that when given.
router.post('/test-email', requireAuth, requireOwner, async (req, res) => {
  try {
    const to = (req.body && req.body.to) || (await fetchAllUsers()).find(
      (u) => String(u.user_id) === String(req.session.user.id)
    )?.email;
    if (!to) {
      return res.status(400).json({ error: "No email on file for your account in Tautulli — pass a \"to\" address explicitly." });
    }
    await sendEmail({
      to,
      subject: `${siteName} — test email`,
      html: `<div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <h2 style="margin:0 0 12px">This is a test</h2>
        <p style="color:#555;line-height:1.6">If you're reading this, ${siteName}'s recap email pipeline is configured correctly — SMTP credentials, Tautulli's notifier, and the network path all worked.</p>
        <p style="color:#999;font-size:12px;margin-top:24px">Sent from Settings → Newsletter, ${new Date().toISOString()}</p>
      </div>`,
    });
    auditLog.record({ kind: 'admin', action: 'POST /api/recap/test-email', actorId: req.session.user.id,
      actorName: req.session.user.username, success: true, statusCode: 200, detail: { to },
      ...auditLog.requestContext(req) }).catch((err) => console.error('audit log write error:', err.message));
    res.json({ status: 'ok', to });
  } catch (err) {
    console.error('recap test-email error:', err.message);
    res.status(502).json({ error: err.message || 'Send failed' });
  }
});

// Split into a fast synchronous "claim" phase (responds right away) and a
// slow background phase (data fetch + render + the actually-mandatory
// throttled send, see lib/mailer.js's sendEmailBatch comment — Tautulli's
// Email notifier has no per-recipient override, so sends MUST stay
// sequential with a real delay between them, never parallelized). Before
// this split, the whole request stayed open for however long a real batch
// took end to end — confirmed live at ~3.5 minutes for 38 recipients (2s
// mandatory delay + per-user Tautulli data fetch + render, each awaited in
// sequence). That's well past what a browser tab, Cloudflare, or Traefik
// will patiently hold a connection open for — a real 2026-09-01 send of all
// 38 people completed with zero errors on the server (confirmed after the
// fact via recap_send_attempts), but the owner's browser had already given
// up and shown "Send failed" long before the response could ever arrive.
// Claiming (fast, local DB only) still happens before responding, so the
// response's "queued" count is real and a double-click still can't send the
// same person twice — only the slow per-user work moves to the background.
router.post('/send', requireAuth, requireOwner, async (req, res) => {
  const { userIds, resend = false } = req.body || {};
  const allowResend = resend === true;
  if (!Array.isArray(userIds) || !userIds.length) {
    return res.status(400).json({ error: 'userIds (non-empty array) is required' });
  }

  let period, claimed, skipped;
  try {
    period = previousMonthRange();
    // Recomputed here, not trusted from the client's earlier /candidates
    // call — the threshold/eligibility check has to hold at send time, not
    // just at review time (someone could otherwise be sent a recap for a
    // month they didn't actually qualify for by the time the request lands).
    const candidates = await listRecapCandidates(period);
    const byId = new Map(candidates.map((c) => [c.userId, c]));

    claimed = [];
    skipped = [];
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
      claimed.push({ userId, candidate, attemptId: claim.attemptId });
    }
  } catch (err) {
    console.error('recap send error:', err.message);
    return res.status(500).json({ error: 'Send failed' });
  }

  // Respond now — everything from here is real network work (per-user
  // Tautulli data fetch, then the throttled send) that the client should
  // never have to sit through. Progress is visible via GET /api/recap/history
  // (already polled by the admin UI) as each attempt finishes below.
  res.json({ period, requested: userIds.length, queued: claimed.length, skipped });
  if (!claimed.length) return;

  (async () => {
    // A failed lookup here used to abort the whole request before anyone was
    // claimed — safe to just retry. Now that claiming already happened, the
    // batch has to proceed either way, but that means every recipient in it
    // silently loses the Service Status section with no record anywhere else
    // that it was dropped — logging plainly here, naming the batch, is the
    // only place that gap is visible at all.
    const uptime = await uptimeKuma.getMonthlyUptime('plex', period).catch((err) => {
      console.error(`recap send (${period.label}): uptime lookup failed, all ${claimed.length} email(s) in this batch will render without the Service Status section:`, err.message);
      return null;
    });

    const messages = [];
    let preparationFailures = 0;
    for (const { userId, candidate, attemptId } of claimed) {
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
        messages.push({ userId, attemptId, to: candidate.email,
          subject: `Your ${siteName} recap — ${period.label}`, html });
      } catch (err) {
        // eslint-disable-next-line no-await-in-loop
        await sendLog.finish(attemptId, { ok: false, error: err.message });
        preparationFailures += 1;
        console.error(`recap send: preparing ${userId} failed:`, err.message);
      }
    }

    const sendResults = await sendEmailBatch(messages);
    for (let i = 0; i < sendResults.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sendLog.finish(messages[i].attemptId, { ok: sendResults[i].ok, error: sendResults[i].error || null });
    }
    // Counts every claimed recipient, not just the ones that made it as far
    // as sendEmailBatch — a prep failure above (bad Tautulli data, a render
    // error) is just as real a failure as an SMTP one, and recap_send_attempts
    // already records both the same way; this line should read the same.
    const sentCount = sendResults.filter((r) => r.ok).length;
    const failedCount = preparationFailures + sendResults.filter((r) => !r.ok).length;
    console.log(`recap send (${period.label}): ${sentCount} sent, ${failedCount} failed, out of ${claimed.length} queued`);
  })().catch((err) => console.error('recap send: background job crashed:', err.message));
});

module.exports = router;
