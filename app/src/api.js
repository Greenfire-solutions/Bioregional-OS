const base = '';

// ── The device this browser is, if it has been enrolled ───────────────────
// A token handed over once by the steward, kept here and sent as a header on
// every call. A header rather than the URL, because a URL ends up in history,
// in server logs and in the Referer of every outbound link, and a token in any
// of those has left the room it was given in. See server/clearance.mjs.
//
// Nothing here is a sign-in. There is no account and no password; the browser
// either holds a token or it does not, and forgetting it is one click.
const DEVICE_KEY = 'bros.device';

export function device() {
  try { return JSON.parse(localStorage.getItem(DEVICE_KEY) ?? 'null'); } catch { return null; }
}
export function rememberDevice(d) {
  try { localStorage.setItem(DEVICE_KEY, JSON.stringify(d)); } catch { /* private window */ }
}
export function forgetDevice() {
  try { localStorage.removeItem(DEVICE_KEY); } catch { /* private window */ }
}
function headers(extra = {}) {
  const d = device();
  return d?.token ? { ...extra, 'x-bros-device': d.token } : extra;
}

export async function get(path, params) {
  const q = params ? '?' + new URLSearchParams(params) : '';
  const r = await fetch(`${base}/api/${path}${q}`, { headers: headers() });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

export async function post(path, body = {}) {
  const r = await fetch(`${base}/api/${path}`, {
    method: 'POST',
    headers: headers({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return r.json();
}

export async function callTool(name, input = {}) {
  return post('tool', { name, input });
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
    headers: headers({ 'content-type': 'application/json' }),
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
