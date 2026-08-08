// Sends email through Tautulli's own Email notifier (agent_id 10) instead of
// adding a new SMTP dependency to this app — see TODO.md v1.11.x and
// [[marquee_monthly_recap]]. The notifier's SMTP settings are configured
// directly in Tautulli (Settings > Notification Agents), not here.
//
// Two things forced this specific shape, both confirmed against Tautulli's
// live behavior, not just its docs:
//   1. Tautulli's `notify` API has no per-recipient override — the Email
//      agent's own source (EMAIL.agent_notify) always reads the recipient
//      from its own saved config, never a per-call kwarg. Sending to a
//      specific person means updating that one field on the notifier
//      immediately before triggering it.
//   2. `set_notifier_config` is a full replace, not a merge. Omitting a
//      field (to change *only* the recipient) resets that field to its
//      default — confirmed live, it silently wiped the saved SMTP password
//      on the very next call. And `get_notifier_config` can't be used to
//      read the rest of the config back first to resubmit unchanged,
//      because Tautulli masks the password on read (returns four spaces,
//      not the real value). So this app has to hold its own copy of the
//      full SMTP config, in its own `.env`, and resend every field on every
//      send — not just delegate to whatever Tautulli already has saved.
const axios = require('axios');

function tautulliBase() {
  return { base: `${process.env.TAUTULLI_URL}/api/v2`, apikey: process.env.TAUTULLI_API_KEY };
}

function emailConfigured() {
  return Boolean(
    process.env.TAUTULLI_EMAIL_NOTIFIER_ID &&
    process.env.EMAIL_SMTP_SERVER &&
    process.env.EMAIL_SMTP_USER &&
    process.env.EMAIL_SMTP_PASSWORD &&
    process.env.EMAIL_FROM
  );
}

async function sendEmail({ to, subject, html }) {
  if (!emailConfigured()) throw new Error('Email is not configured (TAUTULLI_EMAIL_NOTIFIER_ID / EMAIL_* env vars)');
  const { base, apikey } = tautulliBase();
  const notifierId = process.env.TAUTULLI_EMAIL_NOTIFIER_ID;

  const configRes = await axios.get(base, {
    params: {
      apikey, cmd: 'set_notifier_config', notifier_id: notifierId, agent_id: 10,
      email_smtp_server: process.env.EMAIL_SMTP_SERVER,
      email_smtp_port: process.env.EMAIL_SMTP_PORT || 587,
      email_smtp_user: process.env.EMAIL_SMTP_USER,
      email_smtp_password: process.env.EMAIL_SMTP_PASSWORD,
      email_tls: process.env.EMAIL_TLS ?? 1,
      email_from: process.env.EMAIL_FROM,
      email_from_name: process.env.EMAIL_FROM_NAME || process.env.SITE_NAME || 'Marquee',
      email_html_support: 1,
      email_to: to,
    },
  });
  if (configRes.data.response.result !== 'success') {
    throw new Error(`Tautulli set_notifier_config failed: ${configRes.data.response.message}`);
  }

  // POST, not GET — confirmed live that even a modestly-sized HTML body
  // (with an embedded image) blows well past the ~8KB a GET request's own
  // headers/URL can hold, failing with a 431. Tautulli's API accepts the
  // same params either way; only the transport changes.
  const notifyRes = await axios.post(
    base,
    new URLSearchParams({ apikey, cmd: 'notify', notifier_id: notifierId, subject, body: html }),
  );
  if (notifyRes.data.response.result !== 'success') {
    throw new Error(`Tautulli notify failed: ${notifyRes.data.response.message}`);
  }
  return notifyRes.data.response.data;
}

// Sequential, never parallel — concurrent calls would race on the same
// notifier's saved `to` field (see the module comment above), and a small
// delay between sends is polite to the SMTP relay for a real batch. Returns
// a per-recipient result instead of throwing on the first failure, so one
// bad address doesn't stop the rest of a monthly run.
async function sendEmailBatch(messages, { delayMs = 2000 } = {}) {
  const results = [];
  for (const msg of messages) {
    try {
      await sendEmail(msg);
      results.push({ to: msg.to, ok: true });
    } catch (err) {
      results.push({ to: msg.to, ok: false, error: err.message });
    }
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return results;
}

module.exports = { sendEmail, sendEmailBatch, emailConfigured };
