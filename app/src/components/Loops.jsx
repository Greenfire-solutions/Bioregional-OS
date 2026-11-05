import React, { useEffect, useState } from 'react';
import { Sprout, Inbox, ChevronRight, Scale, Flag, Ruler, BookOpen, ShieldCheck } from 'lucide-react';
import { callTool } from '../api.js';

/**
 * What came of it.
 *
 * Two things the data has always known and the interface never said: that
 * somebody's observation became a project the council then decided on, and
 * whether needs people brought were actually answered.
 *
 * This is the closest thing here to a reward, and it is deliberately not one —
 * no counter, no total, no comparison between people. It is a statement about
 * what happened, addressed to whoever made it happen.
 */
export default function Loops() {
  const [moved, setMoved] = useState(null);
  const [intake, setIntake] = useState(null);

  useEffect(() => {
    let live = true;
    callTool('what_moved', { limit: 3 }).then((r) => live && !r?.error && setMoved(r)).catch(() => {});
    callTool('intake_promise', {}).then((r) => live && !r?.error && setIntake(r)).catch(() => {});
    return () => { live = false; };
  }, []);

  const hasMoved = moved?.items?.length > 0;
  const hasIntake = intake && intake.brought > 0;
  if (!hasMoved && !hasIntake) return null;

  return (
    <div className="space-y-3">
      {hasMoved && (
        <section className="rounded border border-[#CBDCCD] bg-[#F2F6F2] px-4 py-3">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--moss)]">
            <Sprout className="h-3 w-3" /> Because of these observations
          </div>
          <ul className="space-y-2.5">
            {moved.items.map((it, i) => (
              <li key={i}>
                <p className="text-sm leading-snug">{it.sentence}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-1 text-[11px] text-[var(--ink-3)]">
                  {it.became.map((b, j) => (
                    <React.Fragment key={j}>
                      {j > 0 && <ChevronRight className="h-3 w-3" />}
                      <span className="flex items-center gap-1" title={b.detail ?? ''}>
                        {ICON[b.kind]}{b.title}
                      </span>
                    </React.Fragment>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {moved.total > moved.items.length && (
            <p className="mt-2 text-[11px] text-[var(--ink-3)]">
              and {moved.total - moved.items.length} more.
            </p>
          )}
        </section>
      )}

      {hasIntake && (
        <section className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded border px-4 py-2.5 text-xs ${
          intake.overdue > 0
            ? 'border-[#E4C9C2] bg-[#FBF1EE]'
            : 'border-[var(--line)] bg-[var(--paper-2)]'}`}>
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
            <Inbox className="h-3 w-3" /> Needs brought
          </span>
          <span className={intake.overdue > 0 ? 'text-[var(--clay)]' : ''}>{intake.sentence}</span>
          {intake.oldest_unanswered && (
            <span className="w-full text-[11px] text-[var(--ink-2)]">
              Longest: {intake.oldest_unanswered.from} — “{intake.oldest_unanswered.body}”
            </span>
          )}
        </section>
      )}
    </div>
  );
}

const cls = 'h-3 w-3 shrink-0';
const ICON = {
  quest: <Flag className={cls} />,
  decision: <Scale className={cls} />,
  gate: <ShieldCheck className={cls} />,
  measurement: <Ruler className={cls} />,
  learning: <BookOpen className={cls} />,
};
