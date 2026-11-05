// ── The Land Seat ─────────────────────────────────────────────────────────
// The chair at the council table that nobody sits in.
//
// The protocol requires every agenda item to carry a Land Seat report —
// "ecological observations, seasonal conditions, downstream effects,
// uncertainty, red flags" — and `engines/council.mjs` has always refused a
// proposal without one. What it could not do was tell whether the report had
// anything to do with the land. The field was free text, validated for
// non-emptiness, and the OS knew a great deal that never reached it: the gage
// reading against its own record, the hazard alerts, where the year had got to.
//
// So a steward wrote the Land Seat report from memory while the machine beside
// them held the measurements.
//
// Two functions here, and the distinction between them is the whole design:
//
//   brief()    — what the land is doing, offered to whoever is WRITING the
//                report. It is material, not a draft. Nothing auto-writes the
//                report, because the Land Seat is a person speaking for a
//                place and a generated paragraph is nobody speaking.
//
//   context()  — the same facts, frozen onto the decision at the moment it was
//                proposed. This is the part that pays off later: a decision
//                made in the third year of a drought reads very differently
//                once the drought breaks, and "monitoring must change
//                decisions" is unanswerable if nobody recorded what the
//                monitoring said at the time.
//
// Entirely local: the database plus NOAA's solar equations computed on this
// machine. No network call, because a council meeting in a church hall with no
// wifi must still be able to seat the land.
import { all, one } from '../core/db.mjs';
import { parseStamp } from '../core/time.mjs';
import { skyToday, nextSolarEvent } from '../adapters/sky.mjs';
import { anchorPlace } from './ground.mjs';
import { humanObservedSql, automatedSql } from '../core/provenance.mjs';

/** How far back a water reading still counts as "what the creek is doing". */
const WATER_FRESH_DAYS = 14;

/**
 * What the land is doing, for the person writing the report.
 *
 * Returns facts and the sentences that carry them, never a finished paragraph.
 */
export function brief(chapterId, { place_id = null } = {}) {
  if (!chapterId) return { error: 'no_chapter' };
  const place = anchorPlace(chapterId, place_id);

  // ── Water: the reading, and whether it is unusual for this date ─────────
  // Written by the USGS adapter into the same signals table as everything
  // else, so this reads what was already ingested rather than fetching.
  // quantity_value is the reading; `description` is the PARAMETER NAME the
  // gage reports under ("Discharge, cubic feet per second"). Printing the
  // latter as the reading produced a Land Seat line that named a unit and no
  // number, which reads as information and is not.
  const water = one(
    `SELECT title, description, quantity_value, quantity_unit, location_name,
            coalesce(observed_at, created_at) at
       FROM signals
      WHERE chapter_id = ? AND source_adapter = 'usgs'
      ORDER BY coalesce(observed_at, created_at) DESC LIMIT 1`, chapterId);
  const waterAge = water ? daysSince(water.at) : null;

  // ── Hazards: only what an official upstream raised, never our own guess ──
  const hazards = all(
    `SELECT title, severity, description, coalesce(observed_at, created_at) at
       FROM signals
      WHERE chapter_id = ? AND ${automatedSql('source_adapter')}
        AND severity IN ('Watch', 'Critical')
        AND date(coalesce(observed_at, created_at)) >= date('now', '-14 days')
      ORDER BY CASE severity WHEN 'Critical' THEN 0 ELSE 1 END,
               coalesce(observed_at, created_at) DESC`, chapterId);

  // ── What people have noticed lately, which is the other half of evidence ─
  const noticed = all(
    `SELECT title, author, severity, coalesce(observed_at, created_at) at
       FROM signals
      WHERE chapter_id = ? AND ${humanObservedSql('source_adapter')}
        AND date(coalesce(observed_at, created_at)) >= date('now', '-30 days')
      ORDER BY CASE severity WHEN 'Critical' THEN 0 WHEN 'Watch' THEN 1 ELSE 2 END,
               coalesce(observed_at, created_at) DESC LIMIT 6`, chapterId);

  // ── Unresolved: a critical observation with nothing behind it is a red
  // flag the council should hear before it decides something else.
  const unaddressed = all(
    `SELECT title FROM signals
      WHERE chapter_id = ? AND severity = 'Critical'
        AND id NOT IN (SELECT signal_id FROM quests WHERE signal_id IS NOT NULL)`, chapterId);

  // ── Season: computed here, never fetched. A council meeting with no wifi
  // must still be able to say where the year has got to.
  let season = null;
  if (place?.lat != null) {
    try {
      const sky = skyToday(place.lat, place.lng);
      const next = nextSolarEvent();
      season = {
        daylight: sky.daylight ?? null,
        change_per_day: sky.daylight_change ?? null,
        moon: sky.moon?.phase ?? null,
        // `at`, not `date`. The field that does not exist stringifies to
        // "undefined" rather than throwing, so the sentence read "September
        // equinox on undefined" and looked like a formatting slip instead of a
        // wrong property name.
        next_turn: next ? `${next.name} on ${String(next.at).slice(0, 10)}` +
          (next.days_away != null ? ` (${next.days_away} days)` : '') : null,
      };
    } catch { season = null; }
  }

  const observations = [];
  if (water) {
    observations.push(
      waterAge > WATER_FRESH_DAYS
        ? `The most recent water reading is ${waterAge} days old — ${waterReading(water)}. ` +
          'Treat it as history, not conditions.'
        : waterReading(water));
  }
  for (const h of hazards.slice(0, 3)) observations.push(`${h.severity}: ${h.title}`);
  if (season?.next_turn) observations.push(`The season: ${season.next_turn}.`);

  return {
    chapter: one('SELECT name FROM chapters WHERE id=?', chapterId)?.name ?? chapterId,
    place: place ? { id: place.id, name: place.name } : null,
    region: place?.ecoregion_name ?? null,
    watershed: place?.watershed_name ?? null,
    water: water
      ? { title: water.title, measure: water.description ?? null,
          value: water.quantity_value ?? null, unit: water.quantity_unit ?? null,
          reading: waterReading(water), at: water.at,
          age_days: waterAge, stale: waterAge > WATER_FRESH_DAYS }
      : null,
    hazards,
    noticed,
    unaddressed_critical: unaddressed.map((u) => u.title),
    season,
    observations,
    // The five things the protocol asks a Land Seat report to carry, with the
    // two the database cannot supply marked as the speaker's own work. A brief
    // that silently omitted them would read as complete.
    must_be_spoken_by_a_person: [
      { field: 'downstream_effects',
        question: 'Who or what is downstream of this, and what reaches them?',
        why: 'The database knows this place. It does not know what runs out of it.' },
      { field: 'uncertainty_note',
        question: 'What is not known here, and how much does the decision rest on it?',
        why: 'An unstated uncertainty becomes a certainty the moment it is written down.' },
    ],
    sentence: landSentence({ water, waterAge, hazards, unaddressed, place, season }),
    note: 'Material for the report, not the report. The Land Seat is a person speaking for ' +
          'a place — a generated paragraph is nobody speaking.',
  };
}

/**
 * The same facts, small enough to freeze onto a decision.
 *
 * Stored as JSON at proposal time so that a review years later can ask what the
 * land was doing when this was decided, rather than what it is doing now.
 */
export function context(chapterId, { place_id = null } = {}) {
  const b = brief(chapterId, { place_id });
  if (b.error) return null;
  return {
    captured_at: new Date().toISOString(),
    place: b.place?.name ?? null,
    region: b.region,
    watershed: b.watershed,
    water: b.water,
    hazards: b.hazards.map((h) => ({ severity: h.severity, title: h.title, at: h.at })),
    unaddressed_critical: b.unaddressed_critical,
    season: b.season,
    sentence: b.sentence,
  };
}

function landSentence({ water, waterAge, hazards, unaddressed, place, season }) {
  const parts = [];
  if (!place) {
    return 'This chapter has no located place, so nothing can be said about the ground ' +
           'underneath this decision. That is itself worth saying out loud at the table.';
  }
  if (hazards.length) {
    const worst = hazards[0];
    parts.push(`${worst.severity === 'Critical' ? 'A critical' : 'An official'} alert stands: ${worst.title}`);
  }
  if (water) {
    parts.push(waterAge > WATER_FRESH_DAYS
      ? `water last read ${waterAge} days ago`
      : waterReading(water));
  } else {
    parts.push('no water reading has been taken');
  }
  if (unaddressed.length) {
    parts.push(`${unaddressed.length} critical observation${unaddressed.length === 1 ? '' : 's'} ` +
               'with no project behind them');
  }
  // Not lowercased: the phrase opens with a month, and tidying the sentence
  // joint was turning "September equinox" into "september equinox".
  if (season?.next_turn) parts.push(season.next_turn);
  return `${parts.join('; ')}.`;
}

/** The reading as a person would say it: a place, a number and a unit. */
function waterReading(w) {
  if (!w) return null;
  const where = String(w.title ?? '').split(' — ')[0];
  if (w.quantity_value == null) return w.title;
  return `${where} is at ${w.quantity_value}${w.quantity_unit ? ` ${w.quantity_unit}` : ''}`;
}

function daysSince(ts) {
  if (!ts) return null;
  const d = parseStamp(ts);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}
