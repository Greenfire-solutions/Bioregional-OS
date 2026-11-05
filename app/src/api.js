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

/**
 * Put a file into the commons and get back the id of the stored object.
 *
 * The bytes go up as the raw body with the name in a header — there is no
 * multipart here, because a contract this small can be re-implemented from a
 * phone with `fetch` and cannot rot the way a parsing library does.
 *
 * The device header travels, exactly as it does on every other call: this is
 * a write to the steward's own disk, and a stranger on the gathering wifi does
 * not get one.
 */
export async function uploadFile(file, meta = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(meta)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const r = await fetch(`${base}/api/media${q.toString() ? `?${q}` : ''}`, {
    method: 'POST',
    headers: headers({
      'content-type': file.type || 'application/octet-stream',
      'x-bros-filename': file.name,
    }),
    body: file,
  });
  // A refusal here is a sentence worth showing — the type list, the size
  // limit, the missing consent record — so the body is returned either way and
  // the caller decides. Throwing would turn all three into "upload failed".
  try { return await r.json(); }
  catch { return { error: 'upload_failed', message: `The file did not go up (${r.status}).` }; }
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
