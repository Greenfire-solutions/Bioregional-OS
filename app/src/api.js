const base = '';

export async function get(path, params) {
  const q = params ? '?' + new URLSearchParams(params) : '';
  const r = await fetch(`${base}/api/${path}${q}`);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

export async function callTool(name, input = {}) {
  const r = await fetch(`${base}/api/tool`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, input }),
  });
  return r.json();
}

/** Stream the assistant. onEvent(type, data) fires for text / tool / tool_result / done / error. */
/**
 * The same stream shape as askAssistant, from a different engine.
 *
 * /api/ai is the Anthropic SDK and needs a key. /api/claude is the Claude Code
 * CLI on the steward's own subscription and needs none — it carries a
 * `session_id` so the next turn resumes the same conversation rather than
 * starting over, which is what makes the panel feel like one sitting rather
 * than a row of unrelated questions.
 */
export async function askClaudeCode({ prompt, resume }, onEvent, signal) {
  return sseStream('/api/claude', { prompt, resume }, onEvent, signal);
}

export async function askAssistant(messages, onEvent, signal) {
  return sseStream('/api/ai', { messages }, onEvent, signal);
}

async function sseStream(path, payload, onEvent, signal) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.body) { onEvent('error', { message: 'No response stream.' }); return; }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const p of parts) {
      const ev = /^event: (.+)$/m.exec(p)?.[1];
      const dt = /^data: (.+)$/m.exec(p)?.[1];
      if (ev && dt) { try { onEvent(ev, JSON.parse(dt)); } catch {} }
    }
  }
}
