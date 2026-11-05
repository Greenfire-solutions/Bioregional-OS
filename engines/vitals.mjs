// ── The seven numbers ─────────────────────────────────────────────────────
// §8. How a commons would know it is working, without telemetry.
//
// The success metric for a tool like this is not attention. There is no company
// here to optimise, nobody is selling anything, and DAU would measure the one
// thing §6 refuses to chase. So the measures are about whether the LOOP is
// turning — every one of them computable locally from commons.db, and every one
// of them a question somebody would actually ask out loud:
//
//   Are needs being heard?            median days from received to answered
//   Does observation lead anywhere?   share of Critical signals with a project
//   Does monitoring change decisions? decisions revised after a trigger crossed
//   Is the work spread?               distinct people named in 90 days
//   Is care real?                     mean care provision across gatherings
//   Is knowledge travelling?          completed quests with a published learning
//   Is it still alive?                days since the last human observation
//
// If those seven are healthy and the app is opened twice a week, it is working.
// If DAU is high and those are flat, it is a toy.
//
// Two rules run through the whole file:
//
//   NO DATA IS NOT A ZERO. A chapter that has never held a gathering has no
//   care score; it does not have a care score of nought. Reporting the second
//   turns "we have not started" into "we are failing", which is both false and
//   the kind of false that makes somebody close the tab. Every measure below
//   can return null, and null renders as a sentence rather than as a number.
//
//   THE NUMBER AND THE JUDGEMENT ARE SEPARATE. Each measure carries its own
//   `healthy` flag and the threshold that produced it, so a chapter that
//   disagrees can argue with the threshold instead of with the arithmetic —
//   the same contract every item in engines/operator.mjs keeps by citing the
//   protocol rule it came from.
import { all, one } from '../core/db.mjs';
import { parseStamp } from '../core/time.mjs';
import { humanObservedSql } from '../core/provenance.mjs';

const WINDOW_DAYS = 90;

export function vitals(chapterId, { days = WINDOW_DAYS } = {}) {
  if (!chapterId) return { error: 'no_chapter' };
  const since = `-${Number(days) || WINDOW_DAYS} days`;

  const measures = [
    heard(chapterId),
    leadsAnywhere(chapterId),
    changesDecisions(chapterId),
    spread(chapterId, since, days),
    care(chapterId),
    travels(chapterId),
    alive(chapterId),
  ];

  const known = measures.filter((m) => m.value !== null);
  const unhealthy = known.filter((m) => m.healthy === false);

  return {
    chapter: one('SELECT name FROM chapters WHERE id=?', chapterId)?.name ?? chapterId,
    window_days: days,
    measures,
    // Deliberately not a score out of seven. A commons is not a percentage, and
    // the moment this returns one somebody will try to raise it.
    answered: known.length,
    unanswered: measures.length - known.length,
    sentence: vitalsSentence(measures, known, unhealthy),
  };
}

/** 1. Are needs being heard? */
function heard(chapterId) {
  // Only needs that were actually answered. Mixing in the ones still waiting,
  // measured against now, answers a different question — and the mixture moves
  // in the wrong direction when an old need is finally closed.
  const waits = all(
    `SELECT CAST(julianday(responded_at) - julianday(created_at) AS REAL) d
       FROM intake
      WHERE chapter_id = ? AND responded_at IS NOT NULL`, chapterId)
    .map((r) => r.d).filter((d) => d != null && d >= 0);

  const waiting = one(
    `SELECT COUNT(*) n FROM intake
      WHERE chapter_id = ? AND responded_at IS NULL AND status = 'received'`, chapterId)?.n ?? 0;

  // responded_at was added after chapters already existed, so every need
  // answered before the migration has an answer and no date for it. Reading
  // that as "no needs" is a confident, wrong, and flattering-in-reverse
  // sentence — it tells a commons that has been answering people for a year
  // that nobody has ever come to the door. Absence of a timestamp is not
  // absence of the thing it timed.
  const brought = one('SELECT COUNT(*) n FROM intake WHERE chapter_id = ?', chapterId)?.n ?? 0;
  const answeredUndated = one(
    `SELECT COUNT(*) n FROM intake
      WHERE chapter_id = ? AND responded_at IS NULL AND status <> 'received'`, chapterId)?.n ?? 0;

  const m = median(waits);
  return {
    key: 'heard',
    question: 'Are needs being heard?',
    value: m === null ? null : Number(m.toFixed(1)),
    unit: 'days to answer, median',
    // The protocol's own threshold, so the judgement is the commons' and not
    // this file's.
    healthy: m === null ? null : m <= 14,
    threshold: '14 days — the protocol\'s own flag on an unanswered need.',
    detail: waiting ? `${waiting} still waiting.` : null,
    sentence: m !== null
      ? `Half of all needs are answered within ${fmt(m)} day${m === 1 ? '' : 's'}.`
      : waiting
        ? `${waiting} need${waiting === 1 ? '' : 's'} brought and none answered yet.`
        : answeredUndated
          ? `${answeredUndated} need${answeredUndated === 1 ? ' was' : 's were'} brought and ` +
            'answered before this commons started recording when. The next one will be timed.'
          : brought
            ? `${brought} brought, none with a recorded answer.`
            : 'Nobody has brought a need yet. The front door may not be visible enough.',
    rule: 'A person must be able to submit a need, receive a response, and appeal.',
  };
}

/** 2. Does observation lead anywhere? */
function leadsAnywhere(chapterId) {
  const critical = all(
    `SELECT id FROM signals WHERE chapter_id = ? AND severity = 'Critical'`, chapterId);
  const withQuest = critical.filter((s) =>
    one(`SELECT 1 x FROM quests WHERE signal_id = ?`, s.id));

  const share = critical.length ? withQuest.length / critical.length : null;
  return {
    key: 'leads_anywhere',
    question: 'Does observation lead anywhere?',
    value: share === null ? null : Number(share.toFixed(2)),
    unit: 'share of critical observations with a project behind them',
    healthy: share === null ? null : share >= 0.8,
    threshold: 'Four in five. A critical observation with nothing behind it is the ' +
               'one case the operator already treats as blocking.',
    detail: critical.length ? `${withQuest.length} of ${critical.length}.` : null,
    sentence: share === null
      ? 'Nothing has been marked critical, so there is nothing here to answer yet.'
      : share === 1
        ? `Every critical observation (${critical.length}) has a project behind it.`
        : `${withQuest.length} of ${critical.length} critical observations have led to a project.`,
    rule: 'Observation must lead somewhere, or it is surveillance of a place nobody is helping.',
  };
}

/** 3. Does monitoring change decisions? */
function changesDecisions(chapterId) {
  // An indicator with a decision trigger is a promise that a reading can force
  // a change. The measure is whether any reading ever has — a trigger that has
  // never fired is either a healthy system or a promise nobody kept, and the
  // two look identical from here, so the sentence says so rather than guessing.
  const triggers = all(
    `SELECT i.id, i.name, i.target_value, i.decision_trigger, i.quest_id
       FROM indicators i
      WHERE i.chapter_id = ? AND i.decision_trigger IS NOT NULL
        AND trim(i.decision_trigger) <> ''`, chapterId);

  let crossed = 0, revised = 0;
  for (const t of triggers) {
    if (t.target_value == null) continue;
    const worst = one(
      `SELECT MIN(value) lo, MAX(value) hi, MIN(measured_at) first FROM measurements
        WHERE indicator_id = ?`, t.id);
    if (worst?.lo == null) continue;
    // Either direction counts as crossing: an indicator can be a floor or a
    // ceiling and the schema does not say which, so a reading outside the
    // target on either side is what there is to go on.
    const didCross = worst.lo < t.target_value || worst.hi > t.target_value;
    if (!didCross) continue;
    crossed++;
    const after = one(
      `SELECT COUNT(*) n FROM decisions
        WHERE quest_id = ? AND status IN ('decided', 'reversed')
          AND coalesce(decided_at, created_at) >= ?`, t.quest_id, worst.first)?.n ?? 0;
    if (after) revised++;
  }

  const share = crossed ? revised / crossed : null;
  return {
    key: 'changes_decisions',
    question: 'Does monitoring change decisions?',
    value: share === null ? null : Number(share.toFixed(2)),
    unit: 'share of crossed triggers followed by a decision',
    healthy: share === null ? null : share >= 0.5,
    threshold: 'Half. A trigger that never moves anything is a number being collected, not monitoring.',
    detail: triggers.length ? `${triggers.length} indicator${triggers.length === 1 ? '' : 's'} carry a trigger; ${crossed} crossed.` : null,
    sentence: !triggers.length
      ? 'No indicator carries a decision trigger yet, so no reading can force a change.'
      : !crossed
        ? `${triggers.length} trigger${triggers.length === 1 ? '' : 's'} set and none crossed. ` +
          'That is either a system behaving, or a promise nobody has had to keep.'
        : `${revised} of ${crossed} crossed trigger${crossed === 1 ? '' : 's'} were followed by a council decision.`,
    rule: 'Monitoring must change decisions.',
  };
}

/** 4. Is the work spread? */
function spread(chapterId, since, days) {
  // Every column in the schema where a person is named as doing something,
  // within the window. Counted DISTINCT, because the question is how many
  // shoulders there are — not how much was done, which is the leaderboard
  // question and is asked nowhere in this project.
  const names = new Set();
  const add = (rows) => rows.forEach((r) => {
    const n = String(r.who ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (n) names.add(n);
  });

  add(all(`SELECT maintenance_owner who FROM quests
            WHERE chapter_id = ? AND date(created_at) >= date('now', ?)`, chapterId, since));
  add(all(`SELECT land_seat_steward who FROM decisions
            WHERE chapter_id = ? AND date(coalesce(decided_at, created_at)) >= date('now', ?)`,
    chapterId, since));
  add(all(`SELECT g.reviewed_by who FROM quest_gates g JOIN quests q ON q.id = g.quest_id
            WHERE q.chapter_id = ? AND g.reviewed_at IS NOT NULL
              AND date(g.reviewed_at) >= date('now', ?)`, chapterId, since));
  add(all(`SELECT m.measured_by who FROM measurements m
             JOIN indicators i ON i.id = m.indicator_id
            WHERE i.chapter_id = ? AND date(m.measured_at) >= date('now', ?)`, chapterId, since));
  add(all(`SELECT author who FROM signals
            WHERE chapter_id = ? AND ${humanObservedSql('source_adapter')}
              AND date(coalesce(observed_at, created_at)) >= date('now', ?)`, chapterId, since));

  const n = names.size;
  return {
    key: 'spread',
    question: 'Is the work spread?',
    value: n || null,
    unit: `people named in ${days} days`,
    // §3.8: participation is radically unequal at any size, and that is normal.
    // The number worth noticing is not a ratio but an absolute floor — below a
    // handful, the commons is one person's illness away from stopping.
    healthy: n ? n >= 5 : null,
    threshold: 'Five. Not a fairness target — a resilience one. Below it, one person ' +
               'falling ill stops the commons.',
    detail: null,
    sentence: !n
      ? `Nobody is named on anything in the last ${days} days.`
      : `${n} ${n === 1 ? 'person has' : 'people have'} been named on something in ${days} days.`,
    rule: 'Ecological work fails when people are exhausted, excluded, unpaid, unsafe or unsupported.',
  };
}

/** 5. Is care real? */
function care(chapterId) {
  const rows = all(
    `SELECT care_meals + care_transport + care_childcare + care_accessibility provided
       FROM gatherings WHERE chapter_id = ?`, chapterId);
  const mean = rows.length
    ? rows.reduce((s, r) => s + (r.provided ?? 0), 0) / rows.length : null;
  return {
    key: 'care',
    question: 'Is care real?',
    value: mean === null ? null : Number(mean.toFixed(1)),
    unit: 'of four provisions, mean across gatherings',
    healthy: mean === null ? null : mean >= 2,
    threshold: 'Two of four — the same line the operator already draws on a single gathering.',
    detail: rows.length ? `Across ${rows.length} gathering${rows.length === 1 ? '' : 's'}.` : null,
    sentence: mean === null
      ? 'No gatherings yet, so there is nothing to say about how they are provisioned.'
      : `Gatherings provide ${fmt(mean)} of four: meals, transport, childcare, accessibility.`,
    rule: 'Ecological work fails when people are exhausted, excluded, unpaid, unsafe or unsupported.',
  };
}

/** 6. Is knowledge travelling? */
function travels(chapterId) {
  const done = all(
    `SELECT id FROM quests WHERE chapter_id = ? AND status = 'Complete'`, chapterId);
  const written = done.filter((q) =>
    one(`SELECT 1 x FROM learn WHERE quest_id = ? AND travels = 1`, q.id));
  const share = done.length ? written.length / done.length : null;
  return {
    key: 'travels',
    question: 'Is knowledge travelling?',
    value: share === null ? null : Number(share.toFixed(2)),
    unit: 'share of finished projects written up so they can travel',
    healthy: share === null ? null : share >= 0.5,
    threshold: 'Half. Knowledge that is not documented will be relearned from scratch somewhere else.',
    detail: done.length ? `${written.length} of ${done.length} finished.` : null,
    sentence: share === null
      ? 'Nothing has finished yet, so nothing is owed a write-up.'
      : `${written.length} of ${done.length} finished project${done.length === 1 ? '' : 's'} ` +
        'have been written up so another place can use them.',
    rule: 'Methods are documented so other places can adapt them without extracting local culture.',
  };
}

/** 7. Is it still alive? */
function alive(chapterId) {
  // A person, not a gage. The whole measure is worthless otherwise: an OS left
  // running on a windowsill ingests USGS readings forever and would report a
  // dead chapter as maximally alive.
  const last = one(
    `SELECT MAX(coalesce(observed_at, created_at)) at FROM signals
      WHERE chapter_id = ? AND ${humanObservedSql('source_adapter')}`, chapterId)?.at;
  const d = last ? daysSince(last) : null;
  return {
    key: 'alive',
    question: 'Is it still alive?',
    value: d,
    unit: 'days since a person last noticed something',
    healthy: d === null ? null : d <= 14,
    threshold: 'A fortnight. Long enough for a holiday, short enough to notice a stop.',
    detail: last ? `Last on ${String(last).slice(0, 10)}.` : null,
    sentence: d === null
      ? 'Nobody has recorded an observation yet.'
      : d === 0
        ? 'Somebody noticed something today.'
        : `${d} day${d === 1 ? '' : 's'} since a person last noticed something. ` +
          'Gage readings do not count.',
    rule: 'Dual intake: ecological conditions are understood through observation, not assumption.',
  };
}

function vitalsSentence(measures, known, unhealthy) {
  if (!known.length) {
    return 'Nothing has happened here yet that these seven questions can measure. ' +
           'That is what a new commons looks like, not a failing one.';
  }
  if (!unhealthy.length) {
    return `All ${known.length} of the seven questions this commons can answer are healthy` +
      (known.length < measures.length
        ? `. The other ${measures.length - known.length} have nothing to measure yet.`
        : '.');
  }
  const first = unhealthy[0];
  return unhealthy.length === 1
    ? `Six of the seven are fine. The one that is not: ${lower(first.question)} — ${first.sentence}`
    : `${unhealthy.length} of the seven need attention. The first: ${lower(first.question)} — ${first.sentence}`;
}

// ── helpers ───────────────────────────────────────────────────────────────

/** Median, not mean: one need that waited a year must not set the headline. */
function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Whole numbers read as whole numbers. "2.0 of four" is a machine talking. */
function fmt(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function lower(q) {
  return q.charAt(0).toLowerCase() + q.slice(1).replace(/\?$/, '');
}

function daysSince(ts) {
  if (!ts) return null;
  const d = parseStamp(ts);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}
