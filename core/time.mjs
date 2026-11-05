// ── Reading a stamp back ──────────────────────────────────────────────────
//
// One parser, because there were eleven copies of
//
//   new Date(String(ts).replace(' ', 'T'))
//
// and `String.replace` with a string pattern replaces the FIRST occurrence
// only. That is fine for `2026-09-21 14:00`, which the database writes, and
// wrong for `2026-09-20 10:00 AM`, which is what `add_gathering` stores when a
// person types it — and what this project's own seed data writes. The second
// space survives, `new Date("2026-09-20T10:00 AM")` is Invalid Date, and every
// comparison against it is silently false.
//
// The visible cost was the join page: it picks the next gathering by comparing
// each `starts_at` to now, so a gathering written in the twelve-hour format was
// skipped. A person standing at the creek clean-up scanned the QR and was
// offered the seed swap the following day, or a greyed-out "I'm coming" tab —
// on the one screen built for a room full of people.
//
// Written to be boring: no library, no timezone cleverness, and it returns null
// rather than an Invalid Date, because a null fails a comparison loudly the
// first time somebody looks and an Invalid Date fails every comparison quietly
// forever.
const MERIDIEM = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i;
const PLAIN = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2}(?::\d{2})?)/;

export function parseStamp(ts) {
  const s = String(ts ?? '').trim();
  if (!s) return null;

  const m = s.match(MERIDIEM);
  if (m) {
    const [, date, hh, mm, ss, ap] = m;
    let h = Number(hh) % 12;
    if (ap.toLowerCase() === 'p') h += 12;
    const d = new Date(`${date}T${String(h).padStart(2, '0')}:${mm}:${ss ?? '00'}`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const p = s.match(PLAIN);
  const d = new Date(p ? `${p[1]}T${p[2]}` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Milliseconds since a stamp, or null when it cannot be read. */
export function msSince(ts) {
  const d = parseStamp(ts);
  return d ? Date.now() - d.getTime() : null;
}
