// Relays homelab alerts to WhatsApp via OpenClaw's Gateway HTTP API
// (POST /tools/invoke, tool "message"/"send") — a second delivery channel
// alongside the existing web-push notifyOwners(), added 2026-09-13.
// Never throws past the caller in a way that should break reconciliation;
// the caller wraps this in its own try/catch same as pushNotify.

async function notifyWhatsApp({ title, body }) {
  const url = process.env.OPENCLAW_GATEWAY_URL;
  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  const target = process.env.OPENCLAW_ALERT_TARGET;
  if (!url || !token || !target) return; // feature not configured, silently skip

  const message = body ? `${title}\n${body}` : title;
  const res = await fetch(`${url}/tools/invoke`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tool: 'message',
      action: 'send',
      args: { channel: 'whatsapp', target, message },
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`OpenClaw relay HTTP ${res.status}`);
  }
}

module.exports = { notifyWhatsApp };
