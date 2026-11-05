import React, { useEffect, useState } from 'react';
import { callTool } from '../api.js';

/**
 * What the land is doing, for somebody who has not enrolled anything.
 *
 * The day clock, per DAILY_USE.md §4: sixty seconds, anyone, and it gives
 * before it asks. `ground_today` is the one public read in the system and it
 * answers a stranger with a projection — no coordinates, no place id, none of
 * the chapter's own records — so this panel can be rendered to anybody who
 * reaches the OS at all. See forAStranger() in engines/ground.mjs.
 *
 * One component rather than two, because it belongs on both screens a person
 * who is not the steward can land on: `/join` when they scan the code, and the
 * board when they are refused it. Those were written as two panels for about
 * ten minutes, which is how the button labels drifted into three copies before
 * verbs.js existed.
 *
 * It renders nothing at all rather than an error. The panel is a gift; a page
 * that refuses to open because a river gage is down would be worse than one
 * that opens without a headline.
 */
export default function GroundForAnyone({ className = '' }) {
  const [g, setG] = useState(null);

  useEffect(() => {
    let alive = true;
    callTool('ground_today', {})
      .then((r) => { if (alive && r && !r.error) setG(r); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!g) return null;

  // `water.standing` is the sentence, and it was being thrown away for the
  // number. "dry — as it usually is on this date", against 49 years of record,
  // is the thing a person did not know; a bare "0 ft3/s" reads as a broken
  // gage. The unit is written the way it is spoken, too — `headline()` does the
  // same replacement and this panel did not, so the one screen built for
  // strangers was the one printing ft3/s.
  const water = g.water?.site_name
    ? `${g.water.site_name}: ${g.water.standing
        ?? (g.water.current != null ? `${g.water.current} ${g.water.unit ?? ''}`.trim() : null)}`
    : null;
  const line = [
    g.place?.name,
    g.place?.ecoregion,
    water && water.replace(/ft3\/s/g, 'ft³/s'),
    g.sky?.daylight && `${g.sky.daylight} of daylight, ${g.sky.daylight_change}`,
  ].filter((x) => x && !/: (null|undefined)$/.test(x)).join(' · ');

  return (
    <section className={`rounded border border-[var(--line)] px-3.5 py-3 ${className}`}>
      <p className="text-[11px] uppercase tracking-wide text-[var(--ink-3)]">Right now, here</p>
      {g.headline && <p className="mt-1 text-[15px] font-medium leading-snug">{g.headline}</p>}
      {line && <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--ink-2)]">{line}</p>}
      {g.heard?.fact && (
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--ink-3)]">{g.heard.fact}</p>
      )}
      {g.credit && (
        <p className="mt-2 text-[10px] leading-relaxed text-[var(--ink-3)]">{g.credit}</p>
      )}
    </section>
  );
}
