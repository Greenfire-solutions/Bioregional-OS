import React, { useEffect, useState } from 'react';
import { Armchair, Droplets, AlertTriangle, Sun, Eye, HelpCircle } from 'lucide-react';
import { callTool } from '../api.js';

/**
 * The chair at the council table that nobody sits in.
 *
 * Every agenda item has always required a Land Seat report, and the report has
 * always been free text. The OS held the gage reading, the official alerts and
 * the position of the year, and none of it reached the person writing the
 * field — so the report got written from memory while the machine beside them
 * held the measurements.
 *
 * This panel sits above the agenda for one reason: it has to be readable while
 * somebody is writing, not after. Two rules about what it must not become:
 *
 *   It never drafts the report. The Land Seat is a person speaking for a place;
 *   a generated paragraph is nobody speaking, and a field pre-filled with
 *   plausible prose is the fastest way to make a protocol requirement into a
 *   formality nobody reads.
 *
 *   It names the two things it cannot know. A brief that showed only what the
 *   database holds would read as complete, and the two missing pieces —
 *   downstream effects and stated uncertainty — are exactly the ones that
 *   matter most to whoever is affected and not in the room.
 */
export default function LandSeat() {
  const [b, setB] = useState(null);

  useEffect(() => {
    let live = true;
    callTool('land_seat_brief', {}).then((r) => live && !r?.error && setB(r)).catch(() => {});
    return () => { live = false; };
  }, []);

  if (!b) return null;

  return (
    <section className="rounded border border-[#CBDCCD] bg-[#F2F6F2] px-4 py-3">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--moss)]">
          <Armchair className="h-3 w-3" /> The Land Seat
        </span>
        <span className="text-[10px] text-[var(--ink-3)]">
          {[b.place?.name, b.watershed, b.region].filter(Boolean).join(' · ')}
        </span>
      </div>

      <p className="text-sm leading-snug">{b.sentence}</p>

      <div className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {b.water && (
          <Row Icon={Droplets} tone={b.water.stale ? 'warn' : 'plain'}>
            {b.water.reading}
            {b.water.stale
              ? <span className="text-[var(--clay)]"> — {b.water.age_days} days old, treat as history</span>
              : <span className="text-[var(--ink-3)]"> · {b.water.age_days === 0 ? 'today' : `${b.water.age_days}d ago`}</span>}
          </Row>
        )}
        {b.hazards.slice(0, 2).map((h, i) => (
          <Row key={i} Icon={AlertTriangle} tone="warn">
            {h.severity}: {h.title}
          </Row>
        ))}
        {b.season?.next_turn && (
          <Row Icon={Sun}>
            {b.season.next_turn}
            {b.season.daylight && <span className="text-[var(--ink-3)]"> · {b.season.daylight}, {b.season.change_per_day}</span>}
          </Row>
        )}
        {b.unaddressed_critical.map((t, i) => (
          <Row key={i} Icon={Eye} tone="warn">
            Critical and unaddressed: {t}
          </Row>
        ))}
      </div>

      {b.noticed?.length > 0 && (
        <p className="mt-2 text-[11px] leading-snug text-[var(--ink-2)]">
          People have noticed: {b.noticed.slice(0, 3).map((n) => n.title).join('; ')}
          {b.noticed.length > 3 && `, and ${b.noticed.length - 3} more`}.
        </p>
      )}

      {/* Said plainly, because the brief would otherwise read as the report. */}
      <div className="mt-2.5 border-t border-[#CBDCCD] pt-2">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
          <HelpCircle className="h-3 w-3" /> Nothing here can answer these
        </div>
        <ul className="space-y-0.5">
          {b.must_be_spoken_by_a_person.map((q) => (
            <li key={q.field} className="text-[11px] leading-snug">
              <span className="text-[var(--ink)]">{q.question}</span>{' '}
              <span className="text-[var(--ink-3)]">{q.why}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-[10px] leading-snug text-[var(--ink-3)]">{b.note}</p>
      </div>
    </section>
  );
}

function Row({ Icon, tone = 'plain', children }) {
  return (
    <div className={`flex items-start gap-1.5 text-[11px] leading-snug ${
      tone === 'warn' ? 'text-[var(--clay)]' : 'text-[var(--ink-2)]'}`}>
      <Icon className="mt-0.5 h-3 w-3 shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}
