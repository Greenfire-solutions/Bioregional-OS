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
export async function askAssistant(messages, onEvent, signal) {
  const res = await fetch(`${base}/api/ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages }),
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
