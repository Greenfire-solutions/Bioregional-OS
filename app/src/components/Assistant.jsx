import React, { useEffect, useRef, useState } from 'react';
import { Send, Square, Wrench, AlertTriangle, Sparkles, Terminal, ShieldOff } from 'lucide-react';
import { askAssistant, askClaudeCode } from '../api.js';

const SUGGESTIONS = [
  'What is the state of the commons right now?',
  'Which quests are blocked, and by what?',
  'What ecoregions does the current map view cover?',
  'Run the Minimum Viable Chapter Test and tell me what to fix first.',
  'Pull the latest water data and tell me what changed.',
];

/** Enough of a tool call to recognise it, without pasting a wall of JSON. */
function inputSummary(input) {
  if (!input || typeof input !== 'object') return '';
  const parts = [];
  for (const [k, v] of Object.entries(input)) {
    if (v === null || v === undefined || v === '') continue;
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    parts.push(`${k}=${s.length > 28 ? s.slice(0, 28) + '…' : s}`);
    if (parts.length === 3) break;
  }
  return parts.join(' ');
}

export default function Assistant({ configured, claudeCode, onRefresh, toolCount }) {
  const hasCode = !!claudeCode?.available;
  // Claude Code first when it exists: it needs no key, spends no metered call,
  // and reaches the commons through the same MCP server a terminal does.
  const [engine, setEngine] = useState(hasCode ? 'code' : 'api');
  const [display, setDisplay] = useState([]);       // what the panel renders
  const [messages, setMessages] = useState([]);     // API-shaped history (api engine only)
  const [session, setSession] = useState(null);     // Claude Code continuity
  const [spend, setSpend] = useState(0);            // session usage estimate
  const [showSpend, setShowSpend] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef(null);
  const endRef = useRef(null);

  useEffect(() => { if (hasCode) setEngine('code'); }, [hasCode]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [display]);

  // Switching engines starts a new sitting. The two do not share a transcript:
  // one keeps history in this browser, the other in a CLI session on disk, and
  // pretending otherwise would drop half of whatever was already said.
  function switchTo(next) {
    if (next === engine || busy) return;
    setEngine(next);
    setDisplay([]); setMessages([]); setSession(null); setSpend(0);
  }

  /** Mutate the in-flight assistant turn. */
  function patchLast(fn) {
    setDisplay((d) => {
      const copy = [...d];
      copy[copy.length - 1] = fn({ ...copy[copy.length - 1] });
      return copy;
    });
  }

  async function send(text) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput('');
    setDisplay((d) => [...d, { role: 'user', text: q }, { role: 'assistant', text: '', tools: [] }]);
    setBusy(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let answer = '';
    const tools = [];

    const onEvent = (type, data) => {
      if (type === 'ready') {
        setSession(data.session_id ?? null);
        patchLast((l) => ({ ...l, ready: data }));
        return;
      }
      if (type === 'text') {
        // The two engines mean different things by a text event. The SDK sends
        // deltas that must be concatenated raw — a separator between them would
        // land mid-word. The CLI sends whole blocks, one per thought, and those
        // need a blank line or the end of one paragraph fuses to the start of
        // the next: "…what's actually urgent.**Most urgent:**".
        if (typeof data.delta === 'string') answer += data.delta;
        else if (data.text) answer += (answer ? '\n\n' : '') + data.text;
        patchLast((l) => ({ ...l, text: answer }));
        return;
      }
      if (type === 'tool') {
        tools.push({ name: data.name, state: 'running', args: inputSummary(data.input) });
        patchLast((l) => ({ ...l, tools: [...tools] }));
        return;
      }
      if (type === 'tool_result') {
        // The CLI sends no name back, so the pairing is positional: the oldest
        // call still running is the one that just answered.
        const t = data.name
          ? [...tools].reverse().find((x) => x.name === data.name && x.state === 'running')
          : tools.find((x) => x.state === 'running');
        if (t) {
          t.state = data.refused ? 'refused' : 'done';
          t.summary = data.summary ?? (data.refused ? refusalLine(data.preview) : undefined);
        }
        patchLast((l) => ({ ...l, tools: [...tools] }));
        return;
      }
      if (type === 'done') {
        if (data.session_id) setSession(data.session_id);
        if (typeof data.usage_estimate_usd === 'number') {
          setSpend((s) => s + data.usage_estimate_usd);
          patchLast((l) => ({ ...l, turn_usd: data.usage_estimate_usd, turns: data.turns }));
        }
        return;
      }
      if (type === 'error') patchLast((l) => ({ ...l, error: data.message, detail: data.detail }));
    };

    const run = engine === 'code'
      ? askClaudeCode({ prompt: q, resume: session }, onEvent, ctrl.signal)
      : askAssistant([...messages, { role: 'user', content: q }], onEvent, ctrl.signal);

    await run.catch((e) => {
      if (e.name !== 'AbortError') patchLast((l) => ({ ...l, error: e.message }));
    });

    if (engine === 'api' && answer) {
      setMessages((m) => [...m, { role: 'user', content: q }, { role: 'assistant', content: answer }]);
    }
    setBusy(false);
    abortRef.current = null;
    onRefresh?.();     // the assistant can change the world; reload what the UI shows
  }

  const nothingAvailable = !hasCode && !configured;

  return (
    <div className="flex h-full flex-col border-l border-[var(--line)] bg-[var(--paper-2)]">
      <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3">
        {engine === 'code'
          ? <Terminal className="h-4 w-4 text-[var(--moss)]" />
          : <Sparkles className="h-4 w-4 text-[var(--gold)]" />}
        <div className="text-sm font-medium">Assistant</div>
        {hasCode && configured && (
          <div className="ml-2 flex rounded border border-[var(--line)] text-[10px]">
            {[['code', 'Claude Code'], ['api', 'API key']].map(([id, label]) => (
              <button key={id} onClick={() => switchTo(id)} disabled={busy}
                className={`px-2 py-0.5 disabled:opacity-40 ${engine === id
                  ? 'bg-[var(--moss)] text-white'
                  : 'text-[var(--ink-3)] hover:text-[var(--ink)]'}`}>
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
          {engine === 'code' ? 'your subscription · logged' : 'advisory · logged'}
        </div>
      </div>

      {nothingAvailable && (
        <div className="border-b border-[var(--line)] bg-[#FBF7E8] px-4 py-3 text-xs text-[var(--ink-2)]">
          No assistant is reachable. Either install Claude Code and reopen this page — it runs on your
          own subscription and needs no key — or set
          <code className="mx-1 rounded bg-[var(--line-2)] px-1">ANTHROPIC_API_KEY</code> in
          <code className="mx-1 rounded bg-[var(--line-2)] px-1">.env</code>. The same
          {' '}{toolCount ?? ''} tools are available either way; see
          <code className="mx-1 rounded bg-[var(--line-2)] px-1">docs/CLAUDE_CODE.md</code>.
        </div>
      )}

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {display.length === 0 && !nothingAvailable && (
          <div className="space-y-2">
            <p className="text-xs text-[var(--ink-2)]">
              {engine === 'code'
                ? 'Claude Code, running here on your own subscription. It reaches the commons through the same tools it would from a terminal, and meets the same protocol refusals you would — it cannot write past a consent gate, a red flag or a missing Land Seat report.'
                : 'Ask about the land, the work, or the council. The assistant reads the same data the map shows and cannot write past a consent gate or a red flag.'}
            </p>
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)}
                className="block w-full rounded border border-[var(--line)] bg-[var(--paper)] px-3 py-2
                           text-left text-xs text-[var(--ink-2)] hover:border-[var(--moss)] hover:text-[var(--ink)]">
                {s}
              </button>
            ))}
            <p className="pt-1 text-[11px] text-[var(--ink-3)]">
              Today’s ground, what moved and what’s next are all computed on this machine and cost
              nothing — you never need the assistant to read them.
            </p>
          </div>
        )}

        {display.map((m, i) => (
          <div key={i}>
            {m.role === 'user' ? (
              <div className="ml-6 rounded border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm">{m.text}</div>
            ) : (
              <div className="space-y-2">
                {m.ready && (
                  <div className="font-mono text-[10px] text-[var(--ink-3)]">
                    {m.ready.commons_tools} commons tools · mcp {m.ready.mcp_status}
                  </div>
                )}
                {!!m.tools?.length && (
                  <div className="space-y-1">
                    {m.tools.map((t, j) => (
                      <div key={j} className="flex items-start gap-2 text-[11px] text-[var(--ink-3)]">
                        {t.state === 'refused'
                          ? <ShieldOff className="mt-0.5 h-3 w-3 shrink-0 text-[var(--clay)]" />
                          : <Wrench className={`mt-0.5 h-3 w-3 shrink-0 ${t.state === 'running'
                              ? 'animate-pulse text-[var(--gold)]' : 'text-[var(--moss)]'}`} />}
                        <span className="font-mono">{t.name}</span>
                        {t.args && <span className="truncate font-mono opacity-70">{t.args}</span>}
                        {t.summary && (
                          <span className={`truncate ${t.state === 'refused' ? 'text-[var(--clay)]' : ''}`}>
                            · {t.summary}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {m.text && <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.text}</div>}
                {showSpend && typeof m.turn_usd === 'number' && (
                  <div className="font-mono text-[10px] text-[var(--ink-3)]">
                    {m.turns} turns · usage estimate ${m.turn_usd.toFixed(4)}
                  </div>
                )}
                {m.error && (
                  <div className="flex items-start gap-2 rounded border border-[#E4C9C2] bg-[#FBF1EE] px-3 py-2 text-xs text-[var(--clay)]">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <div>
                      {m.error}
                      {m.detail && (
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[10px] opacity-80">
                          {JSON.stringify(m.detail)}
                        </pre>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* pb-16: the "I'm lost" button is fixed to the bottom-right of the
          viewport at z-30, which is exactly where this panel's send button sits.
          Enter still worked, so the panel looked fine and the button was dead.
          The composer clears it rather than the guide moving, because the guide
          belongs in the corner and this panel does not. */}
      <div className="border-t border-[var(--line)] p-3 pb-16">
        <div className="flex items-end gap-2">
          <textarea
            value={input} rows={2}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={nothingAvailable ? 'No assistant available' : 'Ask about this place…'}
            disabled={nothingAvailable}
            className="flex-1 resize-none rounded border border-[var(--line)] bg-[var(--paper)] px-3 py-2
                       text-sm outline-none focus:border-[var(--moss)] disabled:opacity-50"
          />
          {busy ? (
            <button onClick={() => abortRef.current?.abort()}
              className="rounded bg-[var(--clay)] p-2 text-white" title="Stop">
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button onClick={() => send()} disabled={!input.trim() || nothingAvailable}
              className="rounded bg-[var(--moss)] p-2 text-white disabled:opacity-40" title="Send">
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
        {engine === 'code' && spend > 0 && (
          // Quiet, and named for what it is. On a subscription no money leaves an
          // account for this; the number is what the same work would have cost
          // through the API. Calling it a bill would be a confident claim in the
          // one direction that changes behaviour.
          <button onClick={() => setShowSpend((v) => !v)}
            className="mt-2 font-mono text-[10px] text-[var(--ink-3)] hover:text-[var(--ink-2)]">
            this sitting · usage estimate ${spend.toFixed(3)} {showSpend ? '· hide per message' : '· per message'}
          </button>
        )}
      </div>
    </div>
  );
}

/** First readable thing out of a refusal blob — usually the protocol's own sentence. */
function refusalLine(preview) {
  try {
    const j = JSON.parse(preview);
    return j.message ?? j.error ?? 'refused';
  } catch {
    return String(preview ?? '').slice(0, 90) || 'refused';
  }
}
