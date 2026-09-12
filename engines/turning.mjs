// ── The turning ───────────────────────────────────────────────────────────
// §5.10. Closing a season and opening the next one.
//
// The protocol's loop is seasonal, and everything else in this OS is daily or
// weekly — which means the twelve-stage cycle has never actually turned. It
// runs forward and nothing ever closes. This is the stage 11 → 12 → 6 hinge:
//
//   11. Measure            What changed, for whom, and with what uncertainty?
//                          → an impact and learning report
//   12. Adapt & Replicate  What should stop, continue, change, or travel?
//                          → the next cycle and a reusable toolkit
//    6. Prioritize         What is urgent, regenerative, feasible, maintainable?
//                          → a seasonal priority list
//
// The design decision that shapes the whole file: the machine computes what
// changed, and REFUSES to close a season until a person has answered the
// questions no machine can. The protocol's quarterly learning review asks eight
// questions, and five of them are queries — what changed, what travelled, what
// finished, what is still open, what the indicators did. Three of them are not:
//
//   What did NOT change?
//   What unintended effects appeared?
//   Whose experience is missing?
//
// Those three are the entire value of a review. A commons that answers only the
// five computable ones has generated a progress report, and a progress report
// is the genre in which nothing has ever gone wrong. "Whose experience is
// missing" in particular cannot be derived from a database BY DEFINITION —
// the people missing from it are the ones not in it. So closing refuses without
// them, the same way a council item refuses without a Land Seat report.
//
// Ritual is also the point, not decoration. Volunteer groups are sustained by
// marking things (§3.3), and a loop that never visibly closes gives nobody the
// experience of having finished anything.
import { all, one, run, create, LATEST_MEASUREMENT } from '../core/db.mjs';
import { humanObservedSql } from '../core/provenance.mjs';
import { whatsNext } from './operator.mjs';
import { carrying } from './attention.mjs';
import { priorities } from './quest.mjs';
import { vitals } from './vitals.mjs';

/**
 * Everything the database can say about the season, computed and read-only.
 *
 * Safe to call at any time — this is what a council reads BEFORE deciding what
 * stops and what continues, not the act of closing.
 */
export function seasonReview(chapterId) {
  if (!chapterId) return { error: 'no_chapter' };

  const open = currentSeason(chapterId);
  // Everything since this season opened, or the last 90 days if a chapter has
  // never opened one — a review of "all of history" on a three-year-old commons
  // is not a season review, it is an annual report nobody asked for.
  const since = open?.opened_at ?? isoDaysAgo(90);

  // ── Stage 11: what changed, and with what uncertainty ──────────────────
  const changed = [];
  for (const i of all(
    `SELECT id, name, unit, baseline_value, baseline_at, target_value, quest_id
       FROM indicators WHERE chapter_id = ? AND baseline_value IS NOT NULL`, chapterId)) {
    const latest = one(
      `SELECT value, uncertainty, measured_at, measured_by FROM measurements
        WHERE indicator_id = ? ${LATEST_MEASUREMENT} LIMIT 1`, i.id);
    if (!latest) {
      changed.push({
        indicator: i.name, unit: i.unit,
        // A baseline with nothing read against it is a real finding, and it is
        // the one most likely to be quietly dropped from a report.
        state: 'never_measured',
        sentence: `${i.name} has a baseline and has never been read against it.`,
      });
      continue;
    }
    const delta = latest.value - i.baseline_value;
    // Uncertainty is not decoration. A change smaller than the error bar on the
    // reading is not a change, and reporting it as one is how a commons talks
    // itself into believing an intervention worked.
    const withinNoise = latest.uncertainty != null && Math.abs(delta) <= latest.uncertainty;
    changed.push({
      indicator: i.name, unit: i.unit,
      baseline: i.baseline_value, latest: latest.value,
      delta: Number(delta.toFixed(3)),
      uncertainty: latest.uncertainty ?? null,
      target: i.target_value ?? null,
      measured_at: latest.measured_at,
      measured_by: latest.measured_by ?? null,
      state: withinNoise ? 'within_uncertainty' : delta === 0 ? 'unchanged' : 'moved',
      sentence: withinNoise
        ? `${i.name} moved ${fmt(delta)}${unit(i.unit)}, which is inside the ±${latest.uncertainty}` +
          `${unit(i.unit)} uncertainty on the reading. That is not a change.`
        : delta === 0
          ? `${i.name} is exactly at its baseline.`
          : `${i.name} moved ${fmt(delta)}${unit(i.unit)} from a baseline of ${i.baseline_value}` +
            (latest.uncertainty != null ? ` (±${latest.uncertainty})` : ', with no stated uncertainty') +
            '.',
    });
  }

  // ── Stage 12: what stops, continues, changes, travels ──────────────────
  const finished = all(
    `SELECT id, title, stage FROM quests
      WHERE chapter_id = ? AND status = 'Complete' AND date(created_at) >= date(?)`, chapterId, since);
  const stopped = all(
    `SELECT id, title FROM quests
      WHERE chapter_id = ? AND status = 'Stopped'`, chapterId);
  const continuing = all(
    `SELECT id, title, stage FROM quests
      WHERE chapter_id = ? AND status IN ('Open', 'Active', 'Paused')`, chapterId);
  const travelled = all(
    `SELECT l.id, l.title, l.kind, l.license FROM learn l
      WHERE l.chapter_id = ? AND l.travels = 1 AND date(l.created_at) >= date(?)`, chapterId, since);

  // Finished and never written up. Stage 12's own output is a reusable toolkit,
  // and a project that ended without one did not reach stage 12 — it stopped at
  // stage 8 and everybody went home.
  const unwritten = finished.filter((q) =>
    !one('SELECT 1 x FROM learn WHERE quest_id = ?', q.id));

  // ── For whom ───────────────────────────────────────────────────────────
  const needs = one(
    `SELECT COUNT(*) brought,
            SUM(CASE WHEN status <> 'received' THEN 1 ELSE 0 END) answered
       FROM intake WHERE chapter_id = ? AND date(created_at) >= date(?)`, chapterId, since);
  const gatherings = all(
    `SELECT title, coalesce(starts_at, created_at) at, rsvp_count,
            care_meals + care_transport + care_childcare + care_accessibility care
       FROM gatherings WHERE chapter_id = ? AND date(coalesce(starts_at, created_at)) >= date(?)`,
    chapterId, since);
  const observations = one(
    `SELECT COUNT(*) n FROM signals
      WHERE chapter_id = ? AND ${humanObservedSql('source_adapter')}
        AND date(coalesce(observed_at, created_at)) >= date(?)`, chapterId, since)?.n ?? 0;
  const decisions = all(
    `SELECT id, title, method, decided_at, uncertainty_note, reversible
       FROM decisions WHERE chapter_id = ? AND status = 'decided' AND date(decided_at) >= date(?)`,
    chapterId, since);

  return {
    chapter: one('SELECT name FROM chapters WHERE id=?', chapterId)?.name ?? chapterId,
    season: open ? { id: open.id, name: open.name, opened_at: open.opened_at } : null,
    since,
    // Stage 11
    changed,
    moved: changed.filter((c) => c.state === 'moved').length,
    within_uncertainty: changed.filter((c) => c.state === 'within_uncertainty').length,
    never_measured: changed.filter((c) => c.state === 'never_measured').length,
    for_whom: {
      needs_brought: needs?.brought ?? 0,
      needs_answered: needs?.answered ?? 0,
      observations,
      gatherings: gatherings.length,
      people_at_gatherings: gatherings.reduce((s, g) => s + (g.rsvp_count ?? 0), 0),
      decisions: decisions.length,
    },
    // Stage 12
    finished, stopped, continuing, travelled, unwritten,
    decisions,
    // The two engines a council should have open beside this one.
    carrying: safely(() => carrying(chapterId)),
    vitals: safely(() => vitals(chapterId)),
    // The three the machine refuses to guess at.
    must_be_answered_by_people: MUST_ANSWER,
    sentence: reviewSentence(changed, finished, travelled, observations, open),
  };
}

/**
 * The three questions this engine will not answer for anybody.
 *
 * Worded as the protocol words them. They are here as data rather than as prose
 * in a component so that the form, the refusal and the stored report cannot
 * drift into asking three slightly different things.
 */
export const MUST_ANSWER = Object.freeze([
  { field: 'what_did_not_change',
    question: 'What did not change?',
    why: 'A report made only of what moved is a progress report, and nothing has ever gone ' +
         'wrong in one.' },
  { field: 'unintended_effects',
    question: 'What unintended effects appeared?',
    why: 'The effects worth knowing about are the ones nobody set an indicator for.' },
  { field: 'whose_experience_is_missing',
    question: 'Whose experience is missing?',
    why: 'This one cannot be computed by definition — the people missing from the database ' +
         'are the ones not in it.' },
]);

/** Open a season. Nothing else in the loop needs one to exist; this names it. */
export function openSeason(chapterId, { name, priorities } = {}) {
  if (!chapterId) return { error: 'no_chapter' };
  if (!String(name ?? '').trim()) {
    return { error: 'name_required', message: 'A season needs a name the chapter will recognise — ' +
      '"Autumn 2026", "the low-water season". It is what the next review will be read against.' };
  }
  const open = currentSeason(chapterId);
  if (open) {
    return {
      error: 'season_already_open',
      message: `"${open.name}" is still open. Close it first — that is the point of the ritual, ` +
               'and two open seasons means neither ever gets reviewed.',
      season: open,
    };
  }
  // The priority list is stage 6's required output, so it comes from stage 6.
  // Projects that can be ranked, ranked — then whatever the operator says is
  // blocking, because a season whose list is only its blockages has no
  // direction and a season that ignores them has no honesty.
  const stage6 = safely(() => priorities(chapterId));
  const ranked = (stage6?.ranked ?? []).slice(0, 5).map((r) => r.quest);
  const blocking = safely(() => whatsNext(chapterId))?.items
    ?.filter((i) => i.kind === 'blocking' || i.kind === 'slipped')
    ?.slice(0, 7 - ranked.length)?.map((i) => i.title) ?? [];
  const suggested = [...ranked, ...blocking];

  const row = create('seasons', 'season', chapterId, {
    chapter_id: chapterId,
    name: String(name).trim(),
    priorities: JSON.stringify(priorities?.length ? priorities : suggested),
  });
  return {
    ...row,
    priorities: priorities?.length ? priorities : suggested,
    suggested_from_the_operator: !priorities?.length,
    sentence: `"${row.name}" is open. ${suggested.length && !priorities?.length
      ? `Its priority list starts as the ${suggested.length} thing${suggested.length === 1 ? '' : 's'} ` +
        'the operator says are blocking or slipped — change it to whatever the council actually decided.'
      : 'Nothing is blocking, so the list is whatever the council chooses to make it.'}`,
  };
}

/**
 * Close a season: stage 11's impact and learning report, plus stage 12's
 * stop / continue / change / travel.
 *
 * Refuses without the three answers no machine can supply. That refusal is the
 * feature — see the file header.
 */
export function closeSeason(chapterId, input = {}) {
  if (!chapterId) return { error: 'no_chapter' };
  const open = currentSeason(chapterId);
  if (!open) {
    return {
      error: 'no_open_season',
      message: 'No season is open to close. Open one first — a review with no period attached ' +
               'is a review of everything, which is a review of nothing.',
      action: { tool: 'open_season', input: {} },
    };
  }

  const missing = MUST_ANSWER.filter((q) => !String(input[q.field] ?? '').trim());
  if (missing.length) {
    return {
      error: 'review_incomplete',
      message: 'A season does not close on what the database can compute. ' +
               `Still unanswered: ${missing.map((m) => m.question).join(' ')}`,
      missing: missing.map((m) => ({ field: m.field, question: m.question, why: m.why })),
      // Handed back so a person answering them is not also made to go and find
      // the numbers they are answering about.
      review: seasonReview(chapterId),
    };
  }

  const report = seasonReview(chapterId);
  run(`UPDATE seasons
          SET closed_at = datetime('now'), closed_by = ?, report = ?,
              what_did_not_change = ?, unintended_effects = ?, whose_experience_is_missing = ?,
              stops = ?, continues = ?, changes = ?, travels = ?
        WHERE id = ?`,
    String(input.closed_by ?? '').trim() || null,
    JSON.stringify(report),
    input.what_did_not_change, input.unintended_effects, input.whose_experience_is_missing,
    input.stops ?? null, input.continues ?? null, input.changes ?? null, input.travels ?? null,
    open.id);

  const closed = one('SELECT * FROM seasons WHERE id = ?', open.id);
  return {
    ...closed,
    report,
    sentence: `"${closed.name}" is closed. ${report.moved} indicator${report.moved === 1 ? '' : 's'} ` +
      `moved, ${report.finished.length} project${report.finished.length === 1 ? '' : 's'} finished, ` +
      `${report.travelled.length} write-up${report.travelled.length === 1 ? '' : 's'} can travel. ` +
      'Open the next one when the council has met.',
    next: { tool: 'open_season', input: {} },
  };
}

/** Every season this chapter has been through, newest first. */
export function seasons(chapterId) {
  if (!chapterId) return { error: 'no_chapter' };
  const rows = all(
    `SELECT id, name, opened_at, closed_at, closed_by, what_did_not_change,
            unintended_effects, whose_experience_is_missing, stops, continues, changes, travels,
            priorities
       FROM seasons WHERE chapter_id = ? ORDER BY opened_at DESC`, chapterId);
  return {
    open: rows.find((r) => !r.closed_at) ?? null,
    closed: rows.filter((r) => r.closed_at).map((r) => ({ ...r, priorities: parse(r.priorities) })),
    total: rows.length,
    sentence: !rows.length
      ? 'No season has been opened yet. The twelve-stage loop is seasonal — without one it ' +
        'runs forward and never closes, and nobody gets the experience of having finished anything.'
      : rows.find((r) => !r.closed_at)
        ? `"${rows.find((r) => !r.closed_at).name}" is open.`
        : `${rows.length} season${rows.length === 1 ? '' : 's'} closed. Nothing is open now.`,
  };
}

// ── helpers ───────────────────────────────────────────────────────────────

function currentSeason(chapterId) {
  return one(
    `SELECT * FROM seasons WHERE chapter_id = ? AND closed_at IS NULL
      ORDER BY opened_at DESC LIMIT 1`, chapterId);
}

function reviewSentence(changed, finished, travelled, observations, open) {
  const moved = changed.filter((c) => c.state === 'moved').length;
  const noise = changed.filter((c) => c.state === 'within_uncertainty').length;
  if (!changed.length && !finished.length && !observations) {
    return (open ? `"${open.name}" ` : 'This period ') +
      'has nothing measured, nothing finished and nothing noticed yet. Closing it now would ' +
      'produce an honest and very short report.';
  }
  const parts = [];
  if (moved) parts.push(`${moved} indicator${moved === 1 ? '' : 's'} moved`);
  if (noise) parts.push(`${noise} moved less than the uncertainty on the reading`);
  if (finished.length) parts.push(`${finished.length} project${finished.length === 1 ? '' : 's'} finished`);
  if (travelled.length) parts.push(`${travelled.length} write-up${travelled.length === 1 ? '' : 's'} can travel`);
  if (observations) parts.push(`${observations} observation${observations === 1 ? '' : 's'} by people`);
  return `${parts.join(', ')}. The three questions that matter are still unanswered.`;
}

/** An engine failing must not take the review down with it. */
function safely(fn) {
  try { const r = fn(); return r?.error ? null : r; } catch { return null; }
}

function parse(s) {
  try { return JSON.parse(s ?? 'null'); } catch { return null; }
}

function isoDaysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 19).replace('T', ' ');
}

function fmt(n) {
  const s = Number(n.toFixed(3));
  return s > 0 ? `+${s}` : String(s);
}

function unit(u) {
  return u ? ` ${u}` : '';
}
