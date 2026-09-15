import React, { useCallback, useEffect, useState } from 'react';
import {
  ListChecks, MapPin, CheckCircle2, Clock, UserPlus, Camera, Eye, AlertTriangle, Loader2,
} from 'lucide-react';
import { callTool, get } from '../api.js';
import { verb } from '../verbs.js';

/**
 * The work, and the evidence.
 *
 * Two questions, and they belong on one screen because they are the same
 * conversation: what is there to do, and has what was done been checked. Split
 * across two tabs, the checking half becomes a place people visit when they
 * remember to, which is never.
 *
 * The order is deliberate. What NOBODY has picked up comes first — that is the
 * only section a person who has just walked in can act on, and putting the
 * in-hand work above it would make the screen open on other people's business.
 */
export default function Work({ onAct, primary }) {
  const [board, setBoard] = useState(null);
  const [pending, setPending] = useState([]);
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    setBusy(true);
    const [b, p] = await Promise.all([
      callTool('task_board', {}).catch(() => null),
      callTool('pending_proofs', {}).catch(() => []),
    ]);
    setBoard(b?.error ? null : b);
    setPending(Array.isArray(p) ? p : []);
    setBusy(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (busy && !board) {
    return (
      <div className="flex items-center gap-2 py-8 text-xs text-[var(--ink-2)]">
        <Loader2 className="h-4 w-4 animate-spin" /> reading the work…
      </div>
    );
  }

  const unclaimed = board?.unclaimed ?? [];
  const inHand = board?.in_hand ?? [];
  const nothing = !unclaimed.length && !inHand.length && !pending.length;

  return (
    <div className="space-y-5">
      <div className="mb-3 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-medium">The work</h2>
          <p className="mt-0.5 text-xs text-[var(--ink-2)]">
            {board?.sentence ?? 'Tasks inside the projects, and the evidence they were done.'}
          </p>
        </div>
        {primary && (
          <button onClick={primary.onClick}
            className="flex shrink-0 items-center gap-1.5 rounded bg-[var(--moss)] px-3.5 py-2
                       text-xs font-medium text-[var(--on-accent)] hover:brightness-110"
            style={{ boxShadow: 'var(--glow)' }}>
            <ListChecks className="h-4 w-4" />{primary.label}
          </button>
        )}
      </div>

      {nothing && (
        // An empty screen that explains itself, rather than a blank one that
        // reads as broken. It names the thing that has to exist first — a
        // project — because a task with no project to belong to is the one
        // thing this screen cannot offer to create.
        <div className="rounded border border-dashed border-[var(--line)] px-4 py-8 text-center">
          <p className="text-sm text-[var(--ink-2)]">Nothing written down to do yet.</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-[var(--ink-3)]">
            A task belongs to a project. Open a project first, then add the things somebody is
            actually going to do — or press a piece of ground on the Atlas and put one there.
          </p>
        </div>
      )}

      {!!pending.length && (
        <section>
          <SectionHead icon={Eye} n={pending.length}>Waiting to be checked</SectionHead>
          <p className="mb-2 text-[11px] leading-snug text-[var(--ink-3)]">
            Somebody who was not there looks at these. The person who did the work cannot check
            their own — the commons refuses it.
          </p>
          <div className="space-y-3">
            {pending.map((p) => <ProofCard key={p.id} proof={p} onAct={onAct} />)}
          </div>
        </section>
      )}

      {!!unclaimed.length && (
        <section>
          <SectionHead icon={UserPlus} n={unclaimed.length}>Nobody has picked these up</SectionHead>
          <div className="space-y-2">
            {unclaimed.map((t) => <TaskCard key={t.id} task={t} onAct={onAct} />)}
          </div>
        </section>
      )}

      {!!inHand.length && (
        <section>
          <SectionHead icon={Clock} n={inHand.length}>In hand</SectionHead>
          <div className="space-y-2">
            {inHand.map((t) => <TaskCard key={t.id} task={t} onAct={onAct} />)}
          </div>
        </section>
      )}

      {board && (
        <p className="border-t border-[var(--line-2)] pt-3 text-[10px] leading-snug text-[var(--ink-3)]">
          {board.note}
        </p>
      )}
    </div>
  );
}

function SectionHead({ icon: I, n, children }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <I className="h-3.5 w-3.5 text-[var(--ink-3)]" />
      <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--ink-2)]">{children}</h3>
      <span className="tabular-nums text-[11px] text-[var(--ink-3)]">{n}</span>
    </div>
  );
}

function TaskCard({ task, onAct }) {
  const carrying = task.assignees ?? [];
  const needsEvidence = task.evidence === 'none';
  return (
    <div className="rounded border border-[var(--line)] bg-[var(--paper)] p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm leading-snug">{task.title}</h4>
          <p className="mt-0.5 text-[11px] text-[var(--ink-3)]">
            {task.project_title}
            {task.due_at ? ` · by ${String(task.due_at).slice(0, 10)}` : ''}
            {task.lat != null && task.lng != null ? ' · has a point on the map' : ''}
          </p>
          {task.description && (
            <p className="mt-1 text-xs leading-snug text-[var(--ink-2)]">{task.description}</p>
          )}
        </div>
        {task.lat != null && <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ink-3)]" />}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {carrying.length
          ? carrying.map((a) => (
            <span key={a.id} className="rounded-full bg-[var(--paper-2)] px-2 py-0.5 text-[10px] text-[var(--ink-2)]">
              {a.person_name}{a.role !== 'doing' ? ` · ${a.role}` : ''}
            </span>
          ))
          : <span className="text-[10px] text-[var(--ink-3)]">nobody yet</span>}
        <Evidence state={task.evidence} />
      </div>

      {/* One row of what can actually be done to THIS task, in the order it
          happens: take it on, photograph it, close it. A card that offered all
          of them all the time would make every task look the same. */}
      <div className="mt-2.5 flex flex-wrap gap-2 border-t border-[var(--line-2)] pt-2">
        {!carrying.length && (
          <Act onClick={() => onAct?.('claim_task', { task_id: task.id })}>{verb('claim_task')}</Act>
        )}
        {!!carrying.length && needsEvidence && task.requires_before_after && (
          <Act tone="gold" onClick={() => onAct?.('submit_proof', { task_id: task.id })}>
            <Camera className="h-3 w-3" />{verb('submit_proof')}
          </Act>
        )}
        {!!carrying.length && (!task.requires_before_after || !needsEvidence) && (
          <Act onClick={() => onAct?.('complete_task', { task_id: task.id })}>{verb('complete_task')}</Act>
        )}
        {!!carrying.length && (
          <Act onClick={() => onAct?.('release_task', { task_id: task.id })}>{verb('release_task')}</Act>
        )}
      </div>
    </div>
  );
}

/** The one word for where a task's evidence stands, said the same way everywhere. */
function Evidence({ state }) {
  if (state === 'not_required') return null;
  const look = {
    none: ['needs a before & after', 'text-[var(--clay)] bg-[#FBF1EE]'],
    submitted: ['evidence filed', 'text-[#8A6D1F] bg-[#FBF3DC]'],
    verified: ['checked', 'text-[var(--moss)] bg-[var(--paper-2)]'],
  }[state];
  if (!look) return null;
  return <span className={`rounded-full px-2 py-0.5 text-[10px] ${look[1]}`}>{look[0]}</span>;
}

/**
 * A pair, side by side, at a size somebody can actually judge.
 *
 * This is the one screen in the OS that has to show pictures rather than
 * describe them: the whole claim a proof makes is that these two photographs
 * are of the same ground, and no amount of metadata substitutes for looking.
 */
function ProofCard({ proof, onAct }) {
  const gone = (m) => !m || m.withdrawn_at;
  return (
    <div className="rounded border border-[var(--line)] bg-[var(--paper)] p-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h4 className="text-sm">{proof.task_title}</h4>
        <span className="text-[11px] text-[var(--ink-3)]">{proof.project_title}</span>
        <span className="ml-auto text-[10px] text-[var(--ink-3)]">
          {proof.submitted_by ? `filed by ${proof.submitted_by}` : 'filed'} ·{' '}
          {String(proof.created_at ?? '').slice(0, 10)}
        </span>
      </div>

      {proof.note && <p className="mt-1 text-xs leading-snug text-[var(--ink-2)]">{proof.note}</p>}

      <div className="mt-2 grid grid-cols-2 gap-2">
        {[['Before', proof.before], ['After', proof.after]].map(([label, m]) => (
          <figure key={label} className="min-w-0">
            <figcaption className="mb-1 text-[10px] uppercase tracking-wide text-[var(--ink-3)]">{label}</figcaption>
            {gone(m) ? (
              <div className="flex aspect-[4/3] items-center justify-center rounded border border-dashed
                              border-[var(--line)] px-2 text-center text-[10px] leading-snug text-[var(--ink-3)]">
                {m?.withdrawn_at ? 'withdrawn' : 'missing'}
              </div>
            ) : /^video\//.test(m.content_type) ? (
              <video src={m.url} controls className="aspect-[4/3] w-full rounded bg-black object-cover" />
            ) : (
              <img src={m.url} alt={`${label} — ${proof.task_title}`} loading="lazy"
                   className="aspect-[4/3] w-full rounded border border-[var(--line)] object-cover" />
            )}
            {/* Said on the evidence itself, not in a report nobody opens. A
                hash that could not be taken is a different thing from a hash
                that matches, and the two must never look alike. */}
            {m && !m.withdrawn_at && (
              <p className="mt-0.5 truncate font-mono text-[9px] text-[var(--ink-3)]"
                 title={m.sha256 ?? 'no hash'}>
                {m.hash_source === 'content' && m.sha256
                  ? `sha256 ${m.sha256.slice(0, 12)}…`
                  : 'not hashed — this file could not be read back'}
              </p>
            )}
          </figure>
        ))}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-2 border-t border-[var(--line-2)] pt-2">
        <Act tone="moss"
             onClick={() => onAct?.('review_proof', { proof_id: proof.id, decision: 'verified' })}>
          <CheckCircle2 className="h-3 w-3" />This was done
        </Act>
        <Act tone="urgent"
             onClick={() => onAct?.('review_proof', { proof_id: proof.id, decision: 'rejected' })}>
          <AlertTriangle className="h-3 w-3" />Send it back
        </Act>
      </div>
    </div>
  );
}

function Act({ onClick, tone = 'plain', children }) {
  const tones = {
    plain: 'border-[var(--line)] bg-[var(--paper)] text-[var(--ink-2)] hover:border-[var(--moss)] hover:text-[var(--moss)]',
    moss: 'border-[var(--moss)] bg-[var(--moss)] text-[var(--on-accent)] hover:brightness-110',
    gold: 'border-[#E8D9B0] bg-[#FBF3DC] text-[#8A6D1F] hover:border-[var(--gold)]',
    urgent: 'border-[#E4C9C2] bg-[#FBF1EE] text-[var(--clay)] hover:border-[var(--clay)]',
  };
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-[11px] font-medium
                  transition-colors ${tones[tone]}`}>
      {children}
    </button>
  );
}
