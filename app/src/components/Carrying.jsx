import React, { useEffect, useState } from 'react';
import { HandHeart, MapPin, Clock3, Users } from 'lucide-react';
import { callTool } from '../api.js';

/**
 * What is being carried, and what is being neglected.
 *
 * The design problem this component has is that the same numbers, laid out
 * slightly differently, are a leaderboard — and §6 refuses leaderboards of
 * people on evidence. Three rules keep it on the right side, and all three are
 * about presentation rather than data:
 *
 *   Nobody is shown a number unless something is actually wrong. A person
 *   holding a normal amount of work does not appear at all. There is no list of
 *   everyone with their totals beside them, because that list IS the
 *   leaderboard no matter how gently it is worded.
 *
 *   The sentence is addressed to the council, not to the person carrying it.
 *   "Somebody has to offer" rather than "you are overloaded" — §3.8's finding
 *   is that the person doing most of the work is the last one who will ask for
 *   relief, so asking them to self-report is asking the wrong human.
 *
 *   The place half leads with what has been NEGLECTED, not with what is most
 *   attended. Leading with the winner makes it a ranking of ground, which is
 *   harmless but useless; leading with the gap is the thing that actually gets
 *   somebody to walk down there.
 */
export default function Carrying() {
  const [care, setCare] = useState(null);
  const [attn, setAttn] = useState(null);

  useEffect(() => {
    let live = true;
    callTool('carrying', {}).then((r) => live && !r?.error && setCare(r)).catch(() => {});
    callTool('place_attention', { days: 90 }).then((r) => live && !r?.error && setAttn(r)).catch(() => {});
    return () => { live = false; };
  }, []);

  const heavy = (care?.overloaded ?? [])
    .map((n) => care.people.find((p) => p.name === n)).filter(Boolean);
  const longHeld = (care?.held_too_long ?? [])
    .filter((l) => !(care.overloaded ?? []).includes(l.name));
  const grouped = care?.owned_by_a_group ?? [];
  const neglected = attn?.neglected ?? [];
  const unpaid = care?.unpaid_warning;

  // Nothing wrong is the common case, and it is not worth a panel. The stretch
  // of screen a person reads is finite; spending it on "everything is fine"
  // costs the next real finding its place.
  if (!heavy.length && !longHeld.length && !grouped.length && !neglected.length && !unpaid) return null;

  return (
    <div className="space-y-3">
      {(heavy.length > 0 || longHeld.length > 0 || unpaid) && (
        <section className="rounded border border-[#E4C9C2] bg-[#FBF1EE] px-4 py-3">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--clay)]">
            <HandHeart className="h-3 w-3" /> What people are carrying
          </div>

          {heavy.map((p) => (
            <div key={p.name} className="mb-2 last:mb-0">
              <p className="text-sm leading-snug">
                <strong className="font-medium">{p.name}</strong> is named on {p.holding} of{' '}
                {care.total_open} open {care.total_open === 1 ? 'responsibility' : 'responsibilities'}.
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--ink-2)]">
                Somebody has to offer to take one — the person carrying it is the last
                one who will ask.
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {p.items.slice(0, 4).map((h, i) => (
                  <li key={i} className="flex items-baseline gap-1.5 text-[11px] text-[var(--ink-2)]">
                    <span className="text-[var(--ink-3)]">{h.role}</span>
                    <span className="truncate">{h.of}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {longHeld.map((l) => (
            <p key={l.name} className="flex items-center gap-1.5 text-[11px] text-[var(--ink-2)]">
              <Clock3 className="h-3 w-3 shrink-0" />
              {l.name} has held the same responsibility for {l.days} days. Worth asking
              whether they still want it.
            </p>
          ))}

          {unpaid && (
            <p className="mt-1.5 text-[11px] text-[var(--ink-2)]">{unpaid}</p>
          )}
        </section>
      )}

      {grouped.length > 0 && (
        <section className="rounded border border-[var(--line)] bg-[var(--paper-2)] px-4 py-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
            <Users className="h-3 w-3" /> Owned by a group, not a person
          </div>
          <ul className="space-y-1">
            {grouped.slice(0, 3).map((u, i) => (
              <li key={i} className="text-[11px] leading-snug text-[var(--ink-2)]">
                <span className="text-[var(--ink)]">{u.of}</span> is kept alive by {u.name}.
                {/* A guess and a record must not read the same. */}
                {u.certain
                  ? ' Ask which member would notice if the work stopped.'
                  : ' That name reads like a group — if it is one person, ignore this.'}
              </li>
            ))}
          </ul>
        </section>
      )}

      {neglected.length > 0 && (
        <section className="rounded border border-[#CFDDE3] bg-[#EDF2F4] px-4 py-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--water)]">
            <MapPin className="h-3 w-3" /> Nobody has been
          </div>
          <ul className="space-y-1">
            {neglected.slice(0, 4).map((n) => (
              <li key={n.id} className="text-xs leading-snug">
                <span className="font-medium">{n.name}</span>
                <span className="text-[var(--ink-2)]">
                  {n.never_visited
                    ? ` — not since it was added ${n.added_days_ago} days ago`
                    : ` — ${n.days_since} days`}
                  {n.open_work > 0 &&
                    `, with ${n.open_work} open project${n.open_work === 1 ? '' : 's'} there`}
                </span>
              </li>
            ))}
          </ul>
          {/* Said once, here, because the number is otherwise inexplicable at a
              place everyone knows has a gage on it. */}
          <p className="mt-1.5 text-[10px] text-[var(--ink-3)]">
            Only what a person recorded counts as having been there.
          </p>
        </section>
      )}
    </div>
  );
}
