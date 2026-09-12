// ── Engines: Maker + Media + Culture, around the Green Fire Quest ─────────
// A quest is the unit of useful work. The manual's hard rule lives here:
// "A high project score never overrides a red flag, missing consent, unsafe
//  conditions, ecological harm, or the absence of a maintenance owner."
import { all, one, create, run } from '../core/db.mjs';

export const STAGES = [
  'signal', 'listening', 'baseline', 'council_review', 'research', 'co_design',
  'resource_plan', 'prototype', 'teach_tell', 'test', 'decide', 'report_replicate',
];

/**
 * Every gate the manual names, created unsatisfied on every quest.
 *
 * Four of the nine were declared in the schema and never instantiated — so no
 * project was ever blocked pending an ECOLOGICAL ASSESSMENT, which in a
 * bioregional OS is the gate most obviously load-bearing, nor pending
 * indigenous consent, youth safeguarding or data consent. The CHECK constraint
 * listed them, the interface offered them, and `openQuest` created five.
 *
 * A gate that exists in the schema and never fires is worse than no gate: it
 * reads, to anyone auditing the protocol against the code, as a control that is
 * in place.
 *
 * All nine are required, and that is deliberate rather than severe. A gate here
 * closes on EVIDENCE plus a named reviewer, and "not applicable, because no
 * minors are involved in a culvert survey — R. Alvarez" is evidence. So the
 * cost of a gate that does not apply is one sentence from a person, and the
 * permanent record is of somebody having considered it. The alternative —
 * defaulting the awkward four to not-required — makes exactly the four gates
 * about consent and safety the four that are silently skipped.
 */
export const GATES = [
  'rights_holder_consent', 'indigenous_consent', 'land_access',
  'youth_safeguarding', 'permits_insurance', 'ecological_assessment',
  'maintenance_owner', 'affected_party_process', 'data_consent',
];

/** Kept as the old name so nothing reads as if the set were still partial. */
const BUILD_GATES = GATES;

export function openQuest(chapterId, q) {
  const quest = create('quests', 'quest', chapterId, { ...q, chapter_id: chapterId });
  ensureGates(chapterId, quest.id);
  return quest;
}

/**
 * Declare any gate this quest is missing, leaving the ones it has alone.
 *
 * Idempotent, so it can run on a quest opened before a gate existed without
 * reopening one somebody already closed. That matters more than it sounds: the
 * four gates added here did not exist on any quest in any commons until now,
 * and re-creating a satisfied gate would quietly discard a reviewer's name.
 */
export function ensureGates(chapterId, questId) {
  const have = new Set(all('SELECT gate FROM quest_gates WHERE quest_id=?', questId).map((g) => g.gate));
  let added = 0;
  for (const gate of GATES) {
    if (have.has(gate)) continue;
    create('quest_gates', 'gate', chapterId, { quest_id: questId, gate, required: 1, satisfied: 0 });
    added++;
  }
  return added;
}

export function gates(questId) {
  // Declared on read, not by a migration, and this is the one place in the
  // project that writes during a read. The reason: four gates were added to a
  // protocol that already had quests in commonses this code will never see, and
  // "what gates does this quest have?" has to answer with all of them or the
  // answer is wrong. A migration would fix the databases we know about; doing
  // it here fixes the ones we do not, on the first question anybody asks.
  // ensureGates is idempotent and never touches a gate that already exists, so
  // a reviewer's name and evidence cannot be discarded by it.
  const q = one('SELECT chapter_id FROM quests WHERE id=?', questId);
  if (q) ensureGates(q.chapter_id, questId);
  return all('SELECT * FROM quest_gates WHERE quest_id=? ORDER BY gate', questId);
}

export function satisfyGate(questId, gate, { evidence, reviewed_by }) {
  if (!evidence || !reviewed_by) {
    return { error: 'evidence_required', message: 'A gate closes on evidence and a named reviewer, not a checkbox.' };
  }
  run(
    `UPDATE quest_gates SET satisfied=1, evidence=?, reviewed_by=?, reviewed_at=datetime('now')
      WHERE quest_id=? AND gate=?`,
    evidence, reviewed_by, questId, gate
  );
  return gates(questId);
}

/** Can this quest advance? Returns the blocking reasons, not just a boolean. */
export function canAdvance(questId, toStage) {
  const q = one('SELECT * FROM quests WHERE id=?', questId);
  if (!q) return { ok: false, blocked: ['quest not found'] };
  const blocked = [];
  const idx = STAGES.indexOf(toStage);
  if (idx < 0) blocked.push(`unknown stage "${toStage}"`);

  // Build and everything after it require the gates closed.
  if (idx >= STAGES.indexOf('prototype')) {
    const open = gates(questId).filter((g) => g.required && !g.satisfied);
    for (const g of open) blocked.push(`gate not satisfied: ${g.gate}`);
    if (!q.maintenance_owner) blocked.push('no maintenance owner named');
    if (!q.smallest_experiment) blocked.push('smallest useful experiment not defined');
  }
  // Measurement requires a baseline to measure against.
  if (idx >= STAGES.indexOf('test')) {
    const withBaseline = one(
      'SELECT COUNT(*) n FROM indicators WHERE quest_id=? AND baseline_value IS NOT NULL', questId)?.n ?? 0;
    if (!withBaseline) blocked.push('no indicator with a baseline — nothing to measure change against');
  }
  if (idx >= STAGES.indexOf('report_replicate')) {
    const learn = one('SELECT COUNT(*) n FROM learn WHERE quest_id=?', questId)?.n ?? 0;
    if (!learn) blocked.push('nothing written down — knowledge cannot travel');
  }
  return { ok: blocked.length === 0, blocked, from: q.stage, to: toStage };
}

export function advance(questId, toStage) {
  const check = canAdvance(questId, toStage);
  if (!check.ok) return { error: 'blocked', ...check };
  run('UPDATE quests SET stage=? WHERE id=?', toStage, questId);
  return one('SELECT * FROM quests WHERE id=?', questId);
}

/** Gatherings must carry care provision — that is infrastructure, not catering. */
export function careGaps(chapterId) {
  return all(
    `SELECT id, title, starts_at, care_meals, care_transport, care_childcare, care_accessibility
       FROM gatherings
      WHERE chapter_id=? AND (care_meals+care_transport+care_childcare+care_accessibility) < 2
      ORDER BY starts_at`, chapterId
  );
}

/**
 * Stage 6, Prioritize: "What is urgent, regenerative, feasible, and maintainable?"
 *
 * The manual asks for a seasonal priority list and refers, once, to a "project
 * score" — in the sentence that says a high one never overrides a red flag. The
 * rule was implemented and the score it refers to never existed, which meant the
 * protocol's own safeguard guarded nothing.
 *
 * Two decisions shape this, and both are refusals:
 *
 * NOTHING HERE IS SELF-ASSESSED. Every component is read from rows somebody
 * already had to create — the severity of the originating observation, whether
 * an indicator carries a baseline, how many gates are closed, whether a
 * maintenance owner is named. A project cannot be made to look urgent by
 * someone ticking "urgent". The failure mode of a scored form is that the score
 * measures who is most comfortable claiming importance.
 *
 * A BLOCKED PROJECT HAS NO SCORE AT ALL. Not a low one — `overall` is null and
 * `blocked` carries the reasons. A low number still sorts, and anything that
 * sorts will eventually be read as "nearly ready". Making the composite
 * structurally absent is the manual's sentence turned from advice into a
 * property: a high project score cannot override a red flag, because while
 * there is a red flag there is no score to be high.
 */
export function score(questId) {
  const q = one('SELECT * FROM quests WHERE id=?', questId);
  if (!q) return { error: 'not_found' };

  const signal = q.signal_id
    ? one('SELECT severity, category, coalesce(observed_at, created_at) at FROM signals WHERE id=?', q.signal_id)
    : null;
  const gs = gates(questId);
  const closed = gs.filter((g) => g.satisfied).length;
  const openRequired = gs.filter((g) => g.required && !g.satisfied);
  const indicators = all(
    `SELECT baseline_value, target_value, decision_trigger FROM indicators WHERE quest_id=?`, questId);
  const withBaseline = indicators.filter((i) => i.baseline_value != null).length;

  // ── urgent ──────────────────────────────────────────────────────────────
  // What the land said, and how long ago it said it. An old critical signal is
  // more urgent than a new one, not less — it has been waiting.
  const sev = signal?.severity ?? null;
  const ageDays = signal?.at ? daysSince(signal.at) : null;
  const urgent = clamp(
    (sev === 'Critical' ? 0.7 : sev === 'Watch' ? 0.4 : signal ? 0.2 : 0.1) +
    (ageDays != null ? Math.min(ageDays / 180, 0.3) : 0));

  // ── regenerative ────────────────────────────────────────────────────────
  // Can it show it did anything? A project with a desired condition, a
  // baseline to measure against and a trigger that can stop it is capable of
  // being regenerative. One with none of those is capable of being believed.
  const regenerative = clamp(
    (q.desired_condition ? 0.35 : 0) +
    (withBaseline ? 0.35 : 0) +
    (indicators.some((i) => (i.decision_trigger ?? '').trim()) ? 0.2 : 0) +
    (q.ecological_fit ? 0.1 : 0));

  // ── feasible ────────────────────────────────────────────────────────────
  const feasible = clamp(
    (gs.length ? (closed / gs.length) * 0.5 : 0) +
    (q.smallest_experiment ? 0.3 : 0) +
    (q.budget_note ? 0.2 : 0));

  // ── maintainable ────────────────────────────────────────────────────────
  // The manual pairs the maintenance owner with the end-of-life plan, because
  // a project nobody can stop is not a project somebody is maintaining.
  const maintainable = clamp(
    (q.maintenance_owner ? 0.5 : 0) +
    (q.end_of_life_plan ? 0.3 : 0) +
    (indicators.length ? 0.2 : 0));

  const parts = { urgent, regenerative, feasible, maintainable };

  // The red flags that void the composite. Deliberately the manual's own list:
  // red flag, missing consent, unsafe conditions, ecological harm, absent
  // maintenance owner.
  const blocked = [];
  for (const g of openRequired) blocked.push(`gate not satisfied: ${g.gate.replace(/_/g, ' ')}`);
  if (!q.maintenance_owner) blocked.push('no maintenance owner named');
  const flagged = all(
    `SELECT title FROM decisions WHERE quest_id=? AND red_flags IS NOT NULL AND trim(red_flags) <> ''`,
    questId);
  for (const d of flagged) blocked.push(`open red flag on "${d.title}"`);

  return {
    quest: q.title,
    id: q.id,
    stage: q.stage,
    parts,
    // Null while anything is blocking. See the note above — this is the
    // manual's sentence expressed as a missing value rather than a warning.
    overall: blocked.length ? null
      : Number(((urgent + regenerative + feasible + maintainable) / 4).toFixed(2)),
    blocked,
    weakest: Object.entries(parts).sort((a, b) => a[1] - b[1])[0][0],
    rule: 'A high project score never overrides a red flag, missing consent, unsafe conditions, ' +
          'ecological harm, or the absence of a maintenance owner.',
    sentence: blocked.length
      ? `${q.title} is not ranked: ${blocked[0]}${blocked.length > 1 ? `, and ${blocked.length - 1} more` : ''}.`
      : `${q.title} scores weakest on ${Object.entries(parts).sort((a, b) => a[1] - b[1])[0][0]}.`,
    note: 'Every part is read from records somebody already had to create. Nothing here is ' +
          'self-assessed, because a scored form measures who is most comfortable claiming importance.',
  };
}

/**
 * Stage 6's required output: the seasonal priority list.
 *
 * Blocked projects are not omitted — they are listed separately, because "what
 * should we do next season" and "what is stopping the things we already chose"
 * are the same conversation and hiding the second one makes the first look
 * shorter than it is.
 */
export function priorities(chapterId) {
  const quests = all(
    `SELECT id FROM quests WHERE chapter_id=? AND status NOT IN ('Complete','Stopped')`, chapterId);
  const scored = quests.map((q) => score(q.id)).filter((s) => !s.error);
  const ranked = scored.filter((s) => s.overall != null).sort((a, b) => b.overall - a.overall);
  const held = scored.filter((s) => s.overall == null);
  return {
    ranked,
    blocked: held,
    total: scored.length,
    rule: 'What is urgent, regenerative, feasible, and maintainable?',
    sentence: !scored.length
      ? 'No open projects to prioritise.'
      : !ranked.length
        ? `All ${held.length} open project${held.length === 1 ? ' is' : 's are'} blocked. ` +
          'The season\'s priority is unblocking them, not choosing between them.'
        : `${ranked.length} ranked, ${held.length} held back. First: ${ranked[0].quest}.`,
  };
}

function clamp(n) { return Number(Math.max(0, Math.min(1, n)).toFixed(2)); }
function daysSince(ts) {
  if (!ts) return null;
  const d = new Date(String(ts).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}
