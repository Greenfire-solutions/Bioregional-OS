// ── Attention: what is being carried, and what is being neglected ─────────
// Two halves of one question, deliberately in one file because they are the
// same measurement pointed in opposite directions.
//
//   carrying()        — who holds more open responsibility than is fair to ask
//   placeAttention()  — which ground has gone longest without anyone on it
//
// §3.8 predicts the participation curve: roughly 1% of any commons does most of
// the work, and the documented failure mode is not that they leave — it is that
// they burn out while everyone assumes they are fine. Care as Infrastructure
// treats that exhaustion as a failure of the commons, not of the person. So the
// app has to be able to notice a human is carrying too much and SAY SO. That is
// the mechanic that most distinguishes this from a productivity tool, which
// would quietly congratulate them.
//
// The line this file must not cross is §6: no leaderboards of people. The way
// it stays on the right side is a single rule, applied everywhere below —
//
//   ONLY OPEN OBLIGATIONS COUNT. Finished work is never load.
//
// Count what somebody has completed and this becomes a scoreboard with a
// concerned tone of voice. Count only what is still on their shoulders and it
// stays what it is: a description of a weight, addressed to the group that put
// it there. The same rule makes the number fall when work finishes, which is
// the behaviour you want from a warning and the opposite of what you want from
// a score.
//
// §5.11 is the mirror image, and §3.5 is why: rank consistency, bind it to
// ground, and point it at PLACES so it can never become a ranking of people.
// "Nobody has been to the Spring in 71 days" is a fact about the Spring.
import { all, one } from '../core/db.mjs';
import { humanObservedSql } from '../core/provenance.mjs';
import { benefitFlow } from './exchange.mjs';

// When one person holds this share of everything open, and at least this many
// things, the operator raises it as blocking. Both conditions matter: a share
// alone flags the only steward of a two-quest chapter, which is not a finding,
// it is what founding something looks like.
export const CARRYING_SHARE = 0.5;
export const CARRYING_MIN = 3;

// Long enough that a normal handover is not a warning; short enough that it is
// noticed inside a season rather than after one.
export const HELD_LONG_DAYS = 90;

/**
 * Mechanic §5.6 — the care ledger.
 *
 * Open responsibilities only, gathered from every column in the schema that
 * names a person as still owing something:
 *
 *   quests.maintenance_owner       on a quest that is not Complete or Stopped
 *   decisions.land_seat_steward    on a decision still proposed or in review
 *   decisions.land_seat_steward    on a decided one whose review date is due
 *   indicators.<last measured_by>  where the indicator is on a cadence and its
 *                                  quest is still live — a recurring duty is
 *                                  held by whoever last performed it
 *
 * Cleared gates, past measurements and completed quests are all absent on
 * purpose. They are the record of what somebody did, and this is not that list.
 */
export function carrying(chapterId) {
  if (!chapterId) return { error: 'no_chapter' };

  const held = [];

  for (const q of all(
    `SELECT id, title, stage, status, maintenance_owner, created_at
       FROM quests
      WHERE chapter_id = ? AND status NOT IN ('Complete', 'Stopped')
        AND maintenance_owner IS NOT NULL AND trim(maintenance_owner) <> ''`, chapterId)) {
    held.push({
      who: q.maintenance_owner,
      role: 'maintenance owner',
      of: q.title,
      id: q.id,
      kind: 'quest',
      since: q.created_at,
      // The gate exists precisely so that no project is built without somebody
      // agreeing to keep it alive. Naming them is the protocol working; this
      // file's job is noticing when the same name is on all of them.
      rule: 'No project proceeds without a named maintenance owner and an end-of-life plan.',
    });
  }

  for (const d of all(
    `SELECT id, title, status, land_seat_steward, review_date, decided_at, created_at
       FROM decisions
      WHERE chapter_id = ?
        AND land_seat_steward IS NOT NULL AND trim(land_seat_steward) <> ''
        AND (status IN ('proposed', 'in_review')
             OR (status = 'decided' AND review_date IS NOT NULL
                 AND date(review_date) <= date('now')))`, chapterId)) {
    const pending = d.status !== 'decided';
    held.push({
      who: d.land_seat_steward,
      role: pending ? 'land seat' : 'land seat, review now due',
      of: d.title,
      id: d.id,
      kind: 'decision',
      since: pending ? d.created_at : d.review_date,
      rule: 'Every agenda carries a Land Seat report, spoken by a named steward.',
    });
  }

  // A cadence is a promise to come back. Whoever last kept it is holding it
  // until somebody else does — which is why this reads the newest measurement
  // rather than counting them all. Counting would reward the person doing it;
  // this records that they are still the only one who has.
  for (const i of all(
    `SELECT i.id, i.name, i.cadence, q.title quest_title
       FROM indicators i
       JOIN quests q ON q.id = i.quest_id
      WHERE i.chapter_id = ? AND i.cadence IS NOT NULL AND trim(i.cadence) <> ''
        AND q.status NOT IN ('Complete', 'Stopped')`, chapterId)) {
    const last = one(
      `SELECT measured_by, measured_at FROM measurements
        WHERE indicator_id = ? AND measured_by IS NOT NULL AND trim(measured_by) <> ''
        ORDER BY measured_at DESC LIMIT 1`, i.id);
    if (!last) continue;
    held.push({
      who: last.measured_by,
      role: `reads ${i.name}${i.cadence ? `, ${i.cadence}` : ''}`,
      of: i.quest_title,
      id: i.id,
      kind: 'indicator',
      since: last.measured_at,
      rule: 'An indicator with a cadence is a commitment to return, not a one-off reading.',
    });
  }

  // ── Free-text names are one person or several, and getting it wrong hurts
  // in one direction only. "Maya", "maya" and "Maya " are one person holding
  // eight things, not three people holding a comfortable two or three each.
  // Splitting them UNDER-reports the load, which is exactly the direction that
  // lets somebody quietly drown. So grouping is case- and space-insensitive,
  // and the name shown back is the spelling that appears most often, because
  // that is the one the chapter would recognise.
  const people = new Map();
  for (const h of held) {
    const key = normalise(h.who);
    if (!key) continue;
    if (!people.has(key)) people.set(key, { spellings: new Map(), items: [] });
    const p = people.get(key);
    const raw = String(h.who).trim();
    p.spellings.set(raw, (p.spellings.get(raw) ?? 0) + 1);
    p.items.push(h);
  }

  // ── A committee is not a person, and this is not a quibble about wording.
  // The protocol requires a NAMED maintenance owner before anything is built,
  // and the oldest way that gate gets passed without being satisfied is to put
  // a working group in the field. "The Watershed Working Group" has agreed to
  // nothing: no individual has said yes, and there is nobody to relieve when it
  // stops happening. So an organisation is still shown carrying its load —
  // hiding it would make the totals lie — but it is never the subject of a
  // burnout warning, because a group cannot be exhausted. It gets the finding
  // that actually applies to it instead.
  //
  // The agents table is the only place that records which a name is. A name
  // that is not in it is treated as a person, because that is both the common
  // case and the safe direction: the cost of wrongly warning about a group is a
  // conversation, and the cost of wrongly staying quiet about a person is the
  // thing this mechanic exists to prevent.
  const orgs = new Set(
    all(`SELECT name FROM agents WHERE chapter_id = ? AND vf_agent_type = 'Organization'`, chapterId)
      .map((a) => normalise(a.name)));
  const known = new Set(
    all(`SELECT name FROM agents WHERE chapter_id = ?`, chapterId).map((a) => normalise(a.name)));

  const total = held.length;
  const rows = [...people.values()].map((p) => {
    const items = p.items.sort((a, b) => String(a.since).localeCompare(String(b.since)));
    const oldest = items[0];
    const name = commonest(p.spellings);
    return {
      name,
      // Authoritative: the chapter said so. This is the only flag allowed to
      // suppress a burnout warning.
      is_organisation: orgs.has(normalise(name)),
      // A guess from the shape of the name, and reported as a question rather
      // than a fact — see looksLikeAGroup(). It never silences anything.
      looks_like_a_group: !orgs.has(normalise(name)) && looksLikeAGroup(name),
      // Work is assigned to somebody the chapter has no record of. True of
      // almost every name in a young chapter, so it is a note, not a warning.
      unregistered: !known.has(normalise(name)),
      holding: items.length,
      share: total ? Number((items.length / total).toFixed(2)) : 0,
      longest_held_days: daysSince(oldest?.since),
      longest_held: oldest ? { of: oldest.of, role: oldest.role, since: oldest.since } : null,
      items,
    };
  });

  // Sorted heaviest first because the answer to "who needs relieving" is read
  // from the top. This is an order, not a rank — there is no score, nothing
  // accumulates, and a person disappears from the list entirely by handing work
  // over or finishing it. Both of those are the point.
  rows.sort((a, b) => b.holding - a.holding || b.longest_held_days - a.longest_held_days);

  const overloaded = rows.filter(
    (r) => !r.is_organisation && r.holding >= CARRYING_MIN && r.share > CARRYING_SHARE);
  const longHeld = rows.filter((r) => !r.is_organisation && r.longest_held_days > HELD_LONG_DAYS);

  // The finding that applies to a group instead. Not a welfare warning — a gate
  // one: work whose owner is a committee has an owner in the field and none in
  // the world.
  const unowned = rows
    .filter((r) => r.is_organisation || r.looks_like_a_group)
    .flatMap((r) => r.items
      .map((h) => ({
        name: r.name, of: h.of, id: h.id, kind: h.kind,
        // Says which of the two it is, because one is a record and the other is
        // a guess, and a reader is entitled to know which they are being told.
        certain: r.is_organisation,
      })));

  // The money question belongs here rather than in its own panel: a chapter
  // running on unpaid hours is the same finding as one person holding
  // everything, arriving through a different column.
  let unpaid = null;
  try { unpaid = benefitFlow(chapterId); } catch { /* no ledger yet */ }

  return {
    chapter: one('SELECT name FROM chapters WHERE id=?', chapterId)?.name ?? chapterId,
    total_open: total,
    people: rows,
    overloaded: overloaded.map((r) => r.name),
    held_too_long: longHeld.map((r) => ({ name: r.name, days: r.longest_held_days })),
    owned_by_a_group: unowned,
    unpaid_share: unpaid?.unpaid_share ?? null,
    unpaid_warning: unpaid?.warning ?? null,
    threshold: {
      share: CARRYING_SHARE, minimum: CARRYING_MIN, held_long_days: HELD_LONG_DAYS,
      why: 'Both conditions must hold. A share on its own flags the founder of a ' +
           'two-quest chapter, which is not a finding.',
    },
    rule: 'Exhaustion is a failure of the commons, not of the person carrying it.',
    sentence: carryingSentence(rows, overloaded, longHeld, unowned, total),
  };
}

function carryingSentence(rows, overloaded, longHeld, unowned, total) {
  if (!total) {
    return 'Nothing is currently named to anybody. That reads as light, but it more often ' +
           'means the maintenance owner and Land Seat fields are empty — which the gates ' +
           'are supposed to prevent.';
  }
  // These arrive as rows, not as the trimmed {name} / {name, days} shapes the
  // return value exposes. Reading them as the latter is silent: the first got
  // `undefined.name` only once somebody was actually overloaded, and the second
  // would have said "held for undefined days" on a screen nobody was testing.
  if (overloaded.length) {
    const r = overloaded[0];
    return `${r.name} is named on ${r.holding} of ${total} open ${
      total === 1 ? 'responsibility' : 'responsibilities'}. That is a question for the ` +
      'council, not for them — somebody has to offer, because the person carrying it ' +
      'is the last person who will ask.';
  }
  if (longHeld.length) {
    const l = longHeld[0];
    return `${l.name} has held the same responsibility for ${l.longest_held_days} days. Nothing is ` +
           'wrong with that, and it is worth asking whether they still want it.';
  }
  if (unowned.length) {
    const u = unowned[0];
    return `${u.of} is held by ${u.name}, which ${u.certain ? 'is' : 'reads like'} a group ` +
           'rather than a person. The gate is satisfied on paper: ask who in it would ' +
           'notice if the work stopped.';
  }
  // "People" is only honest once the organisations are out of the count.
  const humans = rows.filter((r) => !r.is_organisation).length;
  return `${total} open ${total === 1 ? 'responsibility' : 'responsibilities'}, ${
    humans} ${humans === 1 ? 'person' : 'people'} named${
    rows.length > humans ? ` and ${rows.length - humans} group` : ''}${
    rows.length - humans > 1 ? 's' : ''}. No one is carrying more than half of it.`;
}

/**
 * Mechanic §5.11 — Local Legend, for places.
 *
 * A rolling window of which ground has actually been attended to, and which has
 * gone longest without anybody. §3.5 is the argument: consistency is worth
 * making visible, and Strava's Local Legend is the pattern — except that this
 * one is aimed at the ground rather than at the people on it, so it cannot
 * become the leaderboard §6 refuses. There is no loss state. Missing a week
 * costs nothing. A place attended to for a year shows a line you cannot get
 * anywhere else.
 *
 * The trap, and it is the same one core/provenance.mjs exists for: a USGS gage
 * bolted to a creek files a reading there every three hours forever. Counting
 * those as attention means the most neglected place in the chapter reports as
 * the most visited one, and reports it with a straight face. Only what a PERSON
 * did counts as somebody having been there.
 */
export function placeAttention(chapterId, { days = 90 } = {}) {
  if (!chapterId) return { error: 'no_chapter' };

  const places = all(
    `SELECT id, name, watershed_name, ecoregion_name, lat, lng, created_at
       FROM places WHERE chapter_id = ? ORDER BY name`, chapterId);
  if (!places.length) {
    return {
      chapter: one('SELECT name FROM chapters WHERE id=?', chapterId)?.name ?? chapterId,
      window_days: days, places: [], neglected: [],
      sentence: 'No places yet. A commons that has not named its ground cannot notice ' +
                'when it stops going there.',
    };
  }

  const since = `-${Number(days) || 90} days`;

  const rows = places.map((p) => {
    // Four ways a person is present at a place. Each is a separate query rather
    // than one union so that the answer can say WHICH kind of attention it was —
    // a place that only ever gets observations is a different situation from one
    // that only ever gets meetings held about it.
    const observations = all(
      `SELECT title, author, coalesce(observed_at, created_at) at
         FROM signals
        WHERE chapter_id = ? AND place_id = ?
          AND ${humanObservedSql('source_adapter')}
          AND date(coalesce(observed_at, created_at)) >= date('now', ?)
        ORDER BY at DESC`, chapterId, p.id, since);

    const gatherings = all(
      `SELECT title, coalesce(starts_at, created_at) at, rsvp_count
         FROM gatherings
        WHERE chapter_id = ? AND place_id = ?
          AND date(coalesce(starts_at, created_at)) >= date('now', ?)
        ORDER BY at DESC`, chapterId, p.id, since);

    const work = all(
      `SELECT title, stage, created_at at
         FROM quests
        WHERE chapter_id = ? AND place_id = ? AND status NOT IN ('Complete', 'Stopped')`,
      chapterId, p.id);

    const readings = all(
      `SELECT i.name, m.measured_at at, m.measured_by
         FROM measurements m
         JOIN indicators i ON i.id = m.indicator_id
         JOIN quests q ON q.id = i.quest_id
        WHERE q.place_id = ? AND m.measured_by IS NOT NULL AND trim(m.measured_by) <> ''
          AND date(m.measured_at) >= date('now', ?)
        ORDER BY m.measured_at DESC`, p.id, since);

    // The last time anybody was here, over ALL of history rather than the
    // window — otherwise every long-neglected place reports the same "never",
    // and "nobody has been in 71 days" is the sentence that actually moves
    // somebody to go.
    const lastHuman = one(
      `SELECT MAX(at) at FROM (
         SELECT coalesce(observed_at, created_at) at FROM signals
           WHERE chapter_id = ? AND place_id = ? AND ${humanObservedSql('source_adapter')}
         UNION ALL
         SELECT coalesce(starts_at, created_at) at FROM gatherings
           WHERE chapter_id = ? AND place_id = ?
         UNION ALL
         SELECT m.measured_at at FROM measurements m
           JOIN indicators i ON i.id = m.indicator_id
           JOIN quests q ON q.id = i.quest_id
          WHERE q.place_id = ? AND m.measured_by IS NOT NULL AND trim(m.measured_by) <> ''
       )`, chapterId, p.id, chapterId, p.id, p.id);

    const visits = observations.length + gatherings.length + readings.length;

    return {
      id: p.id,
      name: p.name,
      watershed: p.watershed_name ?? null,
      visits,
      observations: observations.length,
      gatherings: gatherings.length,
      readings: readings.length,
      open_work: work.length,
      last_visit: lastHuman?.at ?? null,
      days_since: lastHuman?.at ? daysSince(lastHuman.at) : null,
      // Never visited is not the same as long-neglected, and a place added
      // yesterday is not being ignored. Both get their own answer below.
      never_visited: !lastHuman?.at,
      added_days_ago: daysSince(p.created_at),
      recent: [
        ...observations.slice(0, 3).map((o) => ({ kind: 'observation', title: o.title, at: o.at, who: o.author })),
        ...gatherings.slice(0, 2).map((g) => ({ kind: 'gathering', title: g.title, at: g.at })),
        ...readings.slice(0, 2).map((r) => ({ kind: 'reading', title: r.name, at: r.at, who: r.measured_by })),
      ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 4),
    };
  });

  const attended = [...rows].sort(
    (a, b) => b.visits - a.visits || String(a.name).localeCompare(String(b.name)));

  // A place is neglected if nobody has been for longer than the window. A place
  // never visited counts only once it has existed longer than the window, so
  // that adding ground to the Atlas does not immediately accuse you of
  // ignoring it.
  const neglected = rows
    .filter((r) => (r.never_visited ? r.added_days_ago > days : r.days_since > days))
    .sort((a, b) => (b.days_since ?? b.added_days_ago) - (a.days_since ?? a.added_days_ago));

  return {
    chapter: one('SELECT name FROM chapters WHERE id=?', chapterId)?.name ?? chapterId,
    window_days: days,
    places: attended,
    neglected,
    counts_only_people: true,
    note: 'Gage readings, weather alerts and fire detections are not attention. A creek ' +
          'with a gage on it reports every three hours whether or not anybody has been there.',
    sentence: attentionSentence(attended, neglected, days),
  };
}

function attentionSentence(attended, neglected, days) {
  const top = attended[0];
  if (neglected.length) {
    const n = neglected[0];
    return n.never_visited
      ? `Nobody has been to ${n.name} since it was added ${n.added_days_ago} days ago.`
      : `Nobody has been to ${n.name} in ${n.days_since} days.`;
  }
  if (!top || !top.visits) {
    return `No visits recorded in ${days} days. That may mean nothing has been written ` +
           'down rather than that nobody has been.';
  }
  return `${top.name} has been attended to ${top.visits} time${top.visits === 1 ? '' : 's'} ` +
         `in ${days} days — more than anywhere else.`;
}

// ── helpers ───────────────────────────────────────────────────────────────

// Words that almost always mean a body rather than a body of one. Used ONLY to
// raise a question, never to suppress a burnout warning, because the two errors
// do not cost the same:
//
//   Guessing a person is a group, wrongly — the sentence reads "ask who in
//   Maya R. would notice", which any human corrects on sight, and her load is
//   still on the list either way.
//
//   Guessing a group is a person, wrongly — the app tells the council to
//   relieve a committee. Nobody is relieved, because nobody was tired, and the
//   real finding (that this project's owner is nobody in particular) is never
//   said at all.
//
// So the heuristic is allowed to be wrong in the first direction and the
// registry is the only thing allowed to be trusted in the second. A person
// genuinely surnamed Church or Guild keeps their warning and gets an odd
// question attached, which is the right way round.
const GROUP_WORDS = /\b(group|committee|council|coalition|collective|team|society|association|alliance|partnership|trust|foundation|department|district|authority|board|network|cooperative|co-?op|friends of|volunteers|crew|circle|assembly|chapter|office|agency|commission|working group)\b/i;

/** A guess, from the shape of a name, that it names more than one person. */
export function looksLikeAGroup(name) {
  return GROUP_WORDS.test(String(name ?? ''));
}

/** Grouping key for a free-text person name. See the comment in carrying(). */
export function normalise(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The spelling a chapter would recognise: the one used most, ties to the first. */
function commonest(spellings) {
  let best = null, n = -1;
  for (const [s, count] of spellings) if (count > n) { best = s; n = count; }
  return best;
}

function daysSince(ts) {
  if (!ts) return 0;
  const d = new Date(String(ts).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}
