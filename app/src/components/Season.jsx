import React, { useEffect, useState } from 'react';
import { RefreshCcw, Loader2, CheckCircle2, CircleDot, TrendingUp, EyeOff, HelpCircle, ListOrdered, Lock } from 'lucide-react';
import { callTool } from '../api.js';

/**
 * The turning. §5.10.
 *
 * Closing a season and opening the next one — the stage 11 → 12 → 6 hinge that
 * makes the twelve-stage loop a loop instead of a line. Everything else in this
 * OS is daily or weekly; without this the cycle runs forward and never closes,
 * and nobody ever gets the experience of having finished anything.
 *
 * The one thing this screen must not do is let somebody close a season by
 * pressing a button. The machine's half of the review — what moved, what
 * finished, what travelled — is computed and shown, and then three questions
 * sit between that and the Close button, because those three are the entire
 * value of a review:
 *
 *   What did not change?
 *   What unintended effects appeared?
 *   Whose experience is missing?
 *
 * A report made only of what moved is a progress report, and nothing has ever
 * gone wrong in one. So the computed numbers are placed ABOVE the questions, on
 * purpose — the answers are better when the person writing them is looking at
 * the season while they write.
 */
export default function Season() {
  const [state, setState] = useState(null);
  const [review, setReview] = useState(null);
  const [pri, setPri] = useState(null);
  const [answers, setAnswers] = useState({});
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);

  async function load() {
    setBusy(true);
    const [s, r, p] = await Promise.all([
      callTool('seasons', {}), callTool('season_review', {}), callTool('seasonal_priorities', {}),
    ]);
    setState(s); setReview(r?.error ? null : r); setPri(p?.error ? null : p); setBusy(false);
  }
  useEffect(() => { load(); }, []);

  async function open() {
    setBusy(true);
    const r = await callTool('open_season', { name });
    setRefusal(r?.error ? r : null);
    if (!r?.error) { setName(''); await load(); } else setBusy(false);
  }

  async function close() {
    setBusy(true);
    const r = await callTool('close_season', answers);
    setRefusal(r?.error ? r : null);
    if (!r?.error) { setAnswers({}); await load(); } else setBusy(false);
  }

  if (!state) {
    return <div className="flex items-center gap-2 p-8 text-sm text-[var(--ink-2)]">
      <Loader2 className="h-4 w-4 animate-spin" /> reading the season…
    </div>;
  }
  if (state.error) return <div className="p-8 text-sm text-[var(--ink-2)]">No chapter yet.</div>;

  const open_ = state.open;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-medium">The season</h2>
        <p className="mt-0.5 text-xs text-[var(--ink-2)]">
          The protocol’s loop is seasonal, not daily. This is where it closes: what changed and
          with what uncertainty, then what should stop, continue, change or travel.
        </p>
      </div>

      {/* Stage 6's required output, which the twelve-stage loop asks for and
          nothing in this OS produced. It sits here rather than with the
          projects because a priority list is a statement about a SEASON — and
          it shows what is held back beside what is ranked, since "what next"
          and "what is stopping what we already chose" are one conversation. */}
      {pri?.total > 0 && (
        <section className="rounded border border-[var(--line)] bg-[var(--paper-2)] px-4 py-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
            <ListOrdered className="h-3 w-3" /> What is urgent, regenerative, feasible and maintainable
          </div>
          <p className="text-xs leading-snug text-[var(--ink-2)]">{pri.sentence}</p>

          {pri.ranked.length > 0 && (
            <ol className="mt-2 space-y-1">
              {pri.ranked.map((r, i) => (
                <li key={r.id} className="flex items-baseline gap-2 text-xs">
                  <span className="w-4 shrink-0 text-right text-[var(--ink-3)]">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{r.quest}</span>
                  <span className="shrink-0 text-[11px] text-[var(--ink-3)]">
                    weakest: {r.weakest}
                  </span>
                </li>
              ))}
            </ol>
          )}

          {pri.blocked.length > 0 && (
            <div className="mt-2 border-t border-[var(--line)] pt-2">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
                <Lock className="h-3 w-3" /> Not ranked, and why
              </div>
              <ul className="space-y-0.5">
                {pri.blocked.slice(0, 5).map((b) => (
                  <li key={b.id} className="text-[11px] leading-snug text-[var(--ink-2)]">
                    <span className="text-[var(--ink)]">{b.quest}</span> — {b.blocked[0]}
                    {b.blocked.length > 1 && `, and ${b.blocked.length - 1} more`}
                  </li>
                ))}
              </ul>
              {/* The manual's sentence, as the reason there is no number here. */}
              <p className="mt-1.5 text-[10px] leading-snug text-[var(--ink-3)]">
                These have no score at all rather than a low one. A high project score never
                overrides a red flag, missing consent or an absent maintenance owner.
              </p>
            </div>
          )}
        </section>
      )}

      {!open_ && (
        <section className="rounded border border-[var(--line)] bg-[var(--paper-2)] p-4">
          <p className="text-sm">{state.sentence}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Autumn 2026, or the low-water season"
              className="min-w-0 flex-1 rounded border border-[var(--line)] bg-[var(--paper)] px-2.5 py-1.5 text-sm" />
            <button onClick={open} disabled={busy || !name.trim()}
              className="rounded bg-[var(--moss)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              Open the season
            </button>
          </div>
          <p className="mt-2 text-[11px] text-[var(--ink-3)]">
            The name is what the next review gets read against.
          </p>
        </section>
      )}

      {open_ && review && (
        <>
          <section className="rounded border border-[var(--line)] bg-[var(--paper-2)] px-4 py-3">
            <div className="flex items-baseline gap-2">
              <CircleDot className="h-3.5 w-3.5 translate-y-0.5 text-[var(--moss)]" />
              <h3 className="text-sm font-medium">{open_.name}</h3>
              <span className="text-[11px] text-[var(--ink-3)]">
                open since {String(open_.opened_at).slice(0, 10)}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-[var(--ink-2)]">{review.sentence}</p>
          </section>

          {/* The machine's half. Above the questions, so the answers are written
              by somebody looking at the season rather than remembering it. */}
          <section>
            <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
              <TrendingUp className="h-3 w-3" /> What the readings say
            </div>
            {review.changed.length === 0 ? (
              <p className="text-xs text-[var(--ink-2)]">
                No indicator carries a baseline yet, so nothing can be said to have changed.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {review.changed.map((c, i) => (
                  <li key={i} className={`rounded border px-3 py-2 text-xs leading-snug ${
                    c.state === 'moved' ? 'border-[#CBDCCD] bg-[#F2F6F2]'
                      : 'border-dashed border-[var(--line)] bg-[var(--paper-2)] text-[var(--ink-2)]'}`}>
                    {c.sentence}
                    {c.measured_by && (
                      <span className="text-[var(--ink-3)]"> — read by {c.measured_by}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4">
              {[
                ['Finished', review.finished.length],
                ['Still running', review.continuing.length],
                ['Can travel', review.travelled.length],
                ['Finished, unwritten', review.unwritten.length],
                ['Needs brought', review.for_whom.needs_brought],
                ['Answered', review.for_whom.needs_answered],
                ['Observations by people', review.for_whom.observations],
                ['Decisions', review.for_whom.decisions],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline gap-1.5">
                  <dt className="text-[var(--ink-3)]">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* The half no machine will supply. */}
          <section className="rounded border border-[var(--gold)] bg-[#FCFAF2] p-4">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[#8A6D1F]">
              <HelpCircle className="h-3 w-3" /> The three a database cannot answer
            </div>
            <p className="mb-3 text-[11px] leading-snug text-[var(--ink-2)]">
              A season does not close on what has been computed above. These are what make it a
              review instead of a progress report.
            </p>

            {(review.must_be_answered_by_people ?? []).map((q) => (
              <label key={q.field} className="mb-3 block">
                <span className="text-xs font-medium">{q.question}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-[var(--ink-3)]">{q.why}</span>
                <textarea rows={2}
                  value={answers[q.field] ?? ''}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.field]: e.target.value }))}
                  className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--paper)] px-2.5 py-1.5 text-sm" />
              </label>
            ))}

            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              {[['stops', 'What should stop'], ['continues', 'What should continue or expand'],
                ['changes', 'What should adapt'], ['travels', 'What knowledge can travel']].map(([f, l]) => (
                <label key={f} className="block">
                  <span className="text-[11px] text-[var(--ink-2)]">{l}</span>
                  <input value={answers[f] ?? ''}
                    onChange={(e) => setAnswers((a) => ({ ...a, [f]: e.target.value }))}
                    className="mt-0.5 w-full rounded border border-[var(--line)] bg-[var(--paper)] px-2.5 py-1.5 text-sm" />
                </label>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input value={answers.closed_by ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, closed_by: e.target.value }))}
                placeholder="Who is closing it"
                className="min-w-0 flex-1 rounded border border-[var(--line)] bg-[var(--paper)] px-2.5 py-1.5 text-sm" />
              <button onClick={close} disabled={busy}
                className="flex items-center gap-1.5 rounded bg-[var(--moss)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                Close the season
              </button>
            </div>

            {/* The engine's refusal, shown as it was written — it names each
                question and says why it will not be answered for you. */}
            {refusal && (
              <div className="mt-3 rounded border border-[#E4C9C2] bg-[#FBF1EE] px-3 py-2 text-xs">
                <p>{refusal.message}</p>
                {refusal.missing?.length > 0 && (
                  <ul className="mt-1 list-disc pl-4 text-[11px] text-[var(--ink-2)]">
                    {refusal.missing.map((m) => <li key={m.field}>{m.question}</li>)}
                  </ul>
                )}
              </div>
            )}
          </section>
        </>
      )}

      {state.closed?.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
            <CheckCircle2 className="h-3 w-3" /> Seasons closed
          </div>
          <ul className="space-y-2">
            {state.closed.map((s) => (
              <li key={s.id} className="rounded border border-[var(--line)] bg-[var(--paper-2)] px-3 py-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium">{s.name}</span>
                  <span className="text-[10px] text-[var(--ink-3)]">
                    closed {String(s.closed_at).slice(0, 10)}{s.closed_by ? ` by ${s.closed_by}` : ''}
                  </span>
                </div>
                {/* The answers, not the numbers. The numbers are in the stored
                    report; these are what the chapter actually learned. */}
                <dl className="mt-1 space-y-0.5 text-[11px] leading-snug">
                  {[['Did not change', s.what_did_not_change],
                    ['Unintended', s.unintended_effects],
                    ['Missing', s.whose_experience_is_missing]].filter(([, v]) => v).map(([k, v]) => (
                    <div key={k} className="flex gap-1.5">
                      <dt className="shrink-0 text-[var(--ink-3)]">{k}</dt>
                      <dd className="text-[var(--ink-2)]">{v}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!open_ && !state.closed?.length && (
        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-[var(--ink-3)]">
          <EyeOff className="mt-0.5 h-3 w-3 shrink-0" />
          Nothing else in this OS closes anything. Without a season the loop runs forward
          forever, and a loop that never closes is a list.
        </p>
      )}
    </div>
  );
}
