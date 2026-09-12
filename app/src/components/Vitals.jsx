import React, { useEffect, useState } from 'react';
import { Activity, Loader2, RotateCw, Minus, Check, AlertCircle } from 'lucide-react';
import { callTool } from '../api.js';

/**
 * The seven numbers. §8.
 *
 * This is the page that answers "is this working?", and the reason it exists is
 * that the honest answer is not attention. There is no company here to optimise
 * and nothing to sell, so the measures are all about whether the loop is
 * turning — and none of them go up when somebody opens the app more often.
 *
 * Three presentation rules, each guarding against a specific way this page
 * could quietly become the dashboard §6 refuses:
 *
 *   An unknown is drawn as an unknown. A dash, grey, with a sentence saying
 *   what has not happened yet. Never a zero, never red. A chapter three weeks
 *   old would otherwise open this page and see five failures, which is both
 *   false and exactly the moment somebody gives up.
 *
 *   There is no total. No score out of seven, no percentage, no ring that
 *   fills — because the instant this page has one number on it, that number is
 *   the thing people manage, and the seven questions underneath it stop being
 *   read.
 *
 *   The threshold is shown next to the judgement. A commons that thinks five
 *   people is the wrong floor can say so; the number itself is not in dispute.
 */
export default function Vitals() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setData(await callTool('vitals', {}));
    setBusy(false);
  }
  useEffect(() => { load(); }, []);

  if (!data) {
    return <div className="flex items-center gap-2 p-8 text-sm text-[var(--ink-2)]">
      <Loader2 className="h-4 w-4 animate-spin" /> counting…
    </div>;
  }
  if (data.error) return <div className="p-8 text-sm text-[var(--ink-2)]">No chapter yet.</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium">How it is going</h2>
          <p className="mt-0.5 text-xs text-[var(--ink-2)]">
            Seven questions, answered from this commons’ own database. Nothing here is
            telemetry, and none of it counts how often anybody opens the app — if these are
            healthy and you open it twice a week, it is working.
          </p>
        </div>
        <button onClick={load} disabled={busy}
          className="ml-auto shrink-0 rounded border border-[var(--line)] p-1.5 hover:border-[var(--moss)]"
          title="Re-count">
          <RotateCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="rounded border border-[var(--line)] bg-[var(--paper-2)] px-4 py-3">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
          <Activity className="h-3 w-3" /> In one sentence
        </div>
        <p className="text-sm leading-snug">{data.sentence}</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {data.measures.map((m) => {
          // Three states, not two. The middle one is the whole point.
          const state = m.value === null ? 'unknown' : m.healthy ? 'ok' : 'attention';
          const S = STATE[state];
          const I = S.icon;
          return (
            <section key={m.key} className={`rounded border p-3 ${S.box}`}>
              <div className="flex items-baseline gap-2">
                <I className={`h-3.5 w-3.5 shrink-0 translate-y-0.5 ${S.mark}`} />
                <h3 className="text-xs font-medium">{m.question}</h3>
              </div>

              <div className="mt-1.5 flex items-baseline gap-1.5 pl-[1.375rem]">
                <span className={`text-xl leading-none ${S.mark}`}>
                  {m.value === null ? '—' : m.value}
                </span>
                <span className="text-[11px] text-[var(--ink-3)]">{m.unit}</span>
              </div>

              <p className="mt-1.5 pl-[1.375rem] text-[11px] leading-snug text-[var(--ink-2)]">
                {m.sentence}
              </p>
              {m.detail && (
                <p className="pl-[1.375rem] text-[11px] text-[var(--ink-3)]">{m.detail}</p>
              )}
              {/* Shown always, not on hover: a judgement whose threshold is hidden
                  is one nobody can argue with. */}
              <p className="mt-1.5 border-t border-[var(--line)] pt-1.5 pl-[1.375rem] text-[10px] leading-snug text-[var(--ink-3)]">
                {m.threshold}
              </p>
            </section>
          );
        })}
      </div>

      <p className="text-[11px] leading-snug text-[var(--ink-3)]">
        {data.unanswered > 0
          ? `${data.unanswered} of the seven have nothing to measure yet. That is what a new commons looks like.`
          : 'All seven have something to measure.'}
      </p>
    </div>
  );
}

const STATE = {
  ok:        { icon: Check,       mark: 'text-[var(--moss)]',  box: 'border-[#CBDCCD] bg-[#F2F6F2]' },
  attention: { icon: AlertCircle, mark: 'text-[var(--clay)]',  box: 'border-[#E4C9C2] bg-[#FBF1EE]' },
  // Grey and dashed. Nothing about "not yet" should read as a failure.
  unknown:   { icon: Minus,       mark: 'text-[var(--ink-3)]', box: 'border-dashed border-[var(--line)] bg-[var(--paper-2)]' },
};
