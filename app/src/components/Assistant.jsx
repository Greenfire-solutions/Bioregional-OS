import React, { useEffect, useRef, useState } from 'react';
import { Send, Square, Wrench, AlertTriangle, Sparkles } from 'lucide-react';
import { askAssistant } from '../api.js';

const SUGGESTIONS = [
  'What is the state of the commons right now?',
  'Which quests are blocked, and by what?',
  'What ecoregions does the current map view cover?',
  'Run the Minimum Viable Chapter Test and tell me what to fix first.',
  'Pull the latest water data and tell me what changed.',
];

export default function Assistant({ configured, onRefresh }) {
  const [messages, setMessages] = useState([]);     // API-shaped history
  const [display, setDisplay] = useState([]);       // what the panel renders
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef(null);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [display]);

  async function send(text) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput('');
    const nextHistory = [...messages, { role: 'user', content: q }];
    setMessages(nextHistory);
    setDisplay((d) => [...d, { role: 'user', text: q }, { role: 'assistant', text: '', tools: [] }]);
    setBusy(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let answer = '';
    const tools = [];

    await askAssistant(nextHistory, (type, data) => {
      setDisplay((d) => {
        const copy = [...d];
        const last = { ...copy[copy.length - 1] };
        if (type === 'text') { answer += data.delta; last.text = answer; }
        if (type === 'tool') { tools.push({ name: data.name, state: 'running' }); last.tools = [...tools]; }
        if (type === 'tool_result') {
          const t = tools.findLast?.((x) => x.name === data.name && x.state === 'running')
                 ?? [...tools].reverse().find((x) => x.name === data.name && x.state === 'running');
          if (t) { t.state = 'done'; t.summary = data.summary; }
          last.tools = [...tools];
        }
        if (type === 'error') last.error = data.message;
        copy[copy.length - 1] = last;
        return copy;
      });
    }, ctrl.signal).catch((e) => {
      if (e.name !== 'AbortError') {
        setDisplay((d) => { const c = [...d]; c[c.length - 1] = { ...c[c.length - 1], error: e.message }; return c; });
      }
    });

    if (answer) setMessages((m) => [...m, { role: 'assistant', content: answer }]);
    setBusy(false);
    abortRef.current = null;
    onRefresh?.();     // the assistant can change the world; reload what the UI shows
  }

  return (
    <div className="flex h-full flex-col border-l border-[var(--line)] bg-[var(--paper-2)]">
      <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3">
        <Sparkles className="h-4 w-4 text-[var(--gold)]" />
        <div className="text-sm font-medium">Assistant</div>
        <div className="ml-auto text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
          advisory · logged
        </div>
      </div>

      {!configured && (
        <div className="border-b border-[var(--line)] bg-[#FBF7E8] px-4 py-3 text-xs text-[var(--ink-2)]">
          No <code className="rounded bg-[var(--line-2)] px-1">ANTHROPIC_API_KEY</code> set. Add one to
          <code className="mx-1 rounded bg-[var(--line-2)] px-1">.env</code>, or drive the same 23 tools
          from Claude Code over MCP — see <code className="rounded bg-[var(--line-2)] px-1">docs/CLAUDE_CODE.md</code>.
        </div>
      )}

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {display.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-[var(--ink-2)]">
              Ask about the land, the work, or the council. The assistant reads the same data the
              map shows and cannot write past a consent gate or a red flag.
            </p>
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)}
                className="block w-full rounded border border-[var(--line)] bg-[var(--paper)] px-3 py-2
                           text-left text-xs text-[var(--ink-2)] hover:border-[var(--moss)] hover:text-[var(--ink)]">
                {s}
              </button>
            ))}
          </div>
        )}

        {display.map((m, i) => (
          <div key={i}>
            {m.role === 'user' ? (
              <div className="ml-6 rounded border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm">{m.text}</div>
            ) : (
              <div className="space-y-2">
                {!!m.tools?.length && (
                  <div className="space-y-1">
                    {m.tools.map((t, j) => (
                      <div key={j} className="flex items-center gap-2 text-[11px] text-[var(--ink-3)]">
                        <Wrench className={`h-3 w-3 ${t.state === 'running' ? 'animate-pulse text-[var(--gold)]' : 'text-[var(--moss)]'}`} />
                        <span className="font-mono">{t.name}</span>
                        {t.summary && <span className="truncate">· {t.summary}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {m.text && <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.text}</div>}
                {m.error && (
                  <div className="flex items-start gap-2 rounded border border-[#E4C9C2] bg-[#FBF1EE] px-3 py-2 text-xs text-[var(--clay)]">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{m.error}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="border-t border-[var(--line)] p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input} rows={2}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask about this place…"
            className="flex-1 resize-none rounded border border-[var(--line)] bg-[var(--paper)] px-3 py-2
                       text-sm outline-none focus:border-[var(--moss)]"
          />
          {busy ? (
            <button onClick={() => abortRef.current?.abort()}
              className="rounded bg-[var(--clay)] p-2 text-white" title="Stop">
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button onClick={() => send()} disabled={!input.trim()}
              className="rounded bg-[var(--moss)] p-2 text-white disabled:opacity-40" title="Send">
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
