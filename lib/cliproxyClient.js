// Thin client for the self-hosted CLIProxyAPI instance (subscription-backed, not
// metered) — same proxy already used by /mnt/docker/scripts/arr-health-watchdog.mjs
// for log-triage judging, called here for the owner-triggered "Suggest fix" button
// (see routes/alerts.js). Deliberately a single plain chat completion with no
// `tools` param — this code path has zero ability to execute anything, only to
// generate text suggesting what a human should check.
//
// 500 tokens (~350-375 words), not 300 — found live that a real
// Sonarr/qBittorrent 409 suggestion got hard-cut mid-word with no
// indication it was truncated. Pulled out as its own function so the
// truncation behavior is directly testable without a real network call.
//
// routes/alerts.js's prompts now require one step per line (a bare
// numbered list, nothing else) specifically so this can be robust in a
// way sentence-boundary trimming never was: on a genuine truncation
// (Anthropic's own stop_reason tells us this, not a guess), the token cut
// landed somewhere inside the last line — there's no reliable way to tell
// whether that line happened to already be "complete" by coincidence, so
// it's dropped unconditionally rather than trusted. Unless it's the only
// line, in which case dropping it would leave nothing, so it's left as
// the least-bad option.
function trimIncompleteTrailingStep(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return text;
  lines.pop();
  return lines.join('\n');
}

// Free, local, tried first — same qwen2.5:7b-instruct on the Mac mini used by
// arr-health-watchdog.mjs's log-triage, reached through CLIProxyAPI's OpenAI-compat
// passthrough. This task (suggest a fix given an alert's own text) needs no live tool
// access or WebSearch, so a 7B model is a reasonable primary here. Returns null (never
// throws) on any failure, so complete() falls through to Claude.
async function completeWithOllama(prompt, maxTokens) {
  if (!process.env.OLLAMA_PROXY_URL || !process.env.CLIPROXY_API_KEY) return null;
  try {
    const res = await fetch(`${process.env.OLLAMA_PROXY_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.CLIPROXY_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const choice = data.choices?.[0];
    let text = (choice?.message?.content ?? '').trim();
    if (!text) throw new Error('empty response content');
    // Same truncation safety net as the Claude path below, just OpenAI's
    // finish_reason vocabulary ('length') instead of Anthropic's stop_reason.
    if (choice.finish_reason === 'length') text = trimIncompleteTrailingStep(text);
    return text;
  } catch (err) {
    console.error(`cliproxyClient: ollama attempt failed (falling back to Claude): ${err.message}`);
    return null;
  }
}

async function completeWithClaude(prompt, maxTokens) {
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
  let text = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  if (!text) throw new Error('CLIProxyAPI returned no text');
  // Safety net for the rare response that still hits the cap even at 500
  // tokens: drop the incomplete trailing step instead of showing a
  // mid-word cutoff. Anthropic's API reports truncation explicitly via
  // stop_reason, so this only ever fires on a genuine truncation, never on
  // a normal response that just happens to be short.
  if (data.stop_reason === 'max_tokens') text = trimIncompleteTrailingStep(text);
  return text;
}

async function complete(prompt, { maxTokens = 500 } = {}) {
  const ollamaText = await completeWithOllama(prompt, maxTokens);
  if (ollamaText) return ollamaText;
  return completeWithClaude(prompt, maxTokens);
}

module.exports = { complete, trimIncompleteTrailingStep };
