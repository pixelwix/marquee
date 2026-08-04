// Thin client for the self-hosted CLIProxyAPI instance (subscription-backed, not
// metered) — same proxy already used by /mnt/docker/scripts/arr-health-watchdog.mjs
// for log-triage judging, called here for the owner-triggered "Suggest fix" button
// (see routes/alerts.js). Deliberately a single plain chat completion with no
// `tools` param — this code path has zero ability to execute anything, only to
// generate text suggesting what a human should check.
async function complete(prompt, { maxTokens = 300 } = {}) {
  if (!process.env.CLIPROXY_URL || !process.env.CLIPROXY_API_KEY) {
    throw new Error('CLIPROXY_URL/CLIPROXY_API_KEY not configured');
  }
  const res = await fetch(`${process.env.CLIPROXY_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.CLIPROXY_API_KEY}`,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`CLIProxyAPI HTTP ${res.status}`);
  const data = await res.json();
  const text = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  if (!text) throw new Error('CLIProxyAPI returned no text');
  return text;
}

module.exports = { complete };
