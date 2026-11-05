// ── Engines: Maker + Media + Culture, around the Green Fire Quest ─────────
// A quest is the unit of useful work. The manual's hard rule lives here:
// "A high project score never overrides a red flag, missing consent, unsafe
//  conditions, ecological harm, or the absence of a maintenance owner."
import { all, one, create, run } from '../core/db.mjs';
import { parseStamp } from '../core/time.mjs';

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

/**
 * The three that cannot be overridden, whatever the reason and whoever gives it.
 *
 * Everything else here is graduated: a named person may pass a gate with a
 * written reason, and the reason is kept and shown forever. That is Ostrom's
 * fifth principle — graduated sanctions, not binary refusal — and it exists
 * because a small group that cannot get past a blank field at nine o'clock on a
 * Sunday stops using the tool and never says why. The design–reality gap closes
 * systems more reliably than any missing feature.
 *
 * These three do not graduate, because an override is a decision made by
 * whoever is at the keyboard, and these are not that person's to make:
 *
 *   rights_holder_consent — it is not yours to waive on somebody's behalf
 *   indigenous_consent    — a consultation slot, and no dataset and no
 *                           deadline may close it
 *   youth_safeguarding    — the person it protects is not in the room
 *
 * The test of the line: could the person clicking override be the person the
 * gate protects? If not, it does not graduate.
 */
export const HARD_GATES = Object.freeze([
  'rights_holder_consent', 'indigenous_consent', 'youth_safeguarding',
]);

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

/**
 * "Still in the way", written once.
 *
 * Four places spelled this out and two of them forgot `overridden_at`, so a
 * gate a named person had passed with a written reason counted as clear in
 * canAdvance and as blocking in the operator — the same project reported two
 * different states depending on which screen you were looking at. A predicate
 * that exists in four copies has one correct copy and three that will drift.
 */
export function openGatesSql() {
  return `SELECT gate FROM quest_gates
           WHERE quest_id = ? AND required = 1 AND satisfied = 0 AND overridden_at IS NULL`;
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

/**
 * Pass a gate without satisfying it, on somebody's named authority.
 *
 * Not a way to make a gate optional — a way to make going past it an act with a
 * name and a reason attached, visible for as long as the quest exists. The
 * commons can then argue with the person rather than with the software.
 */
export function overrideGate(questId, gate, { reason, overridden_by } = {}) {
  if (HARD_GATES.includes(gate)) {
    return {
      error: 'cannot_be_overridden',
      message: `${gate.replace(/_/g, ' ')} cannot be passed by anybody at this keyboard. ` +
               (gate === 'rights_holder_consent'
                 ? 'Consent is not yours to waive on somebody else\'s behalf.'
                 : gate === 'indigenous_consent'
                   ? 'This is a consultation slot. No dataset and no deadline closes it — only a ' +
                     'rights holder does.'
                   : 'The person this protects is not in the room.'),
      hard_gates: HARD_GATES,
    };
  }
  if (!String(reason ?? '').trim() || !String(overridden_by ?? '').trim()) {
    return {
      error: 'reason_and_name_required',
      message: 'An override needs a reason and the name of the person giving it. Both are kept ' +
               'and shown for as long as the project exists — that is the whole of what makes ' +
               'this different from switching the gate off.',
    };
  }
  const row = one('SELECT id FROM quest_gates WHERE quest_id=? AND gate=?', questId, gate);
  if (!row) return { error: 'not_found', message: `No ${gate} gate on that project.` };
  run(`UPDATE quest_gates SET overridden_by=?, override_reason=?, overridden_at=datetime('now')
        WHERE quest_id=? AND gate=?`,
      String(overridden_by).trim(), String(reason).trim(), questId, gate);
  return {
    gate, overridden_by, reason,
    note: 'Recorded. This stays on the project and on every report that mentions it.',
    gates: gates(questId),
  };
}

/** Can this quest advance? Returns the blocking reasons, not just a boolean. */
export function canAdvance(questId, toStage) {
  const q = one('SELECT * FROM quests WHERE id=?', questId);
  if (!q) return { ok: false, blocked: ['quest not found'] };
  const blocked = [];
  const check_notes = [];
  const idx = STAGES.indexOf(toStage);
  if (idx < 0) blocked.push(`unknown stage "${toStage}"`);

  // ── The loop has an ORDER, and for a long time nothing enforced it ──────
  //
  // Everything below this checks the DEPTH of the destination: the gates, a
  // maintenance owner, a baselined indicator, something written down. Not one
  // of them looks at where the quest currently is. `q.stage` was read once, at
  // the bottom, purely to report `from:`.
  //
  // So a quest sitting at `council_review` could be sent to `signal` — index 0,
  // none of the depth checks fire, `blocked` comes back empty and the UPDATE
  // runs. Proved on a throwaway commons rather than argued: it rewound eleven
  // stages and then teleported four forward, in silence, twice.
  //
  // The tool's own description has always said "Move a quest to the NEXT
  // stage", and the interface offers one button called "Advance a stage". Both
  // read as though this were enforced, which is the condition this project
  // calls worse than no gate at all — a control that an auditor comparing the
  // manual to the code would tick off.
  //
  // One step forward, and nothing else. A quest that needs to go backwards is a
  // protocol question — who may send work back, and what is recorded when they
  // do — and inventing an answer here would be the same mistake in the other
  // direction. It is written down in STATUS.md instead.
  //
  // Checked FIRST and returned alone, deliberately. Listing "gate not
  // satisfied: land_access" for a stage the quest cannot legally reach is an
  // answer that sends somebody off to close a gate that was never the problem.
  const at = STAGES.indexOf(q.stage);
  const next = at >= 0 && at + 1 < STAGES.length ? STAGES[at + 1] : null;
  if (idx >= 0 && idx !== at + 1) {
    // The last stage is an END, not a failed attempt to go backwards. Without
    // this case a finished quest is told "a quest does not go backwards", which
    // is both wrong and confusing: nothing went wrong, the work is done.
    //
    // Whether it can re-enter the loop is the open question — turning.mjs
    // describes the season hinge as 12 → 6, and canAdvance now forbids exactly
    // that. Recorded in STATUS.md; refusing plainly beats guessing at it here.
    const finished = next === null;
    blocked.push(finished
      ? `this quest has finished the loop: it is at "${q.stage}", the last stage`
      : idx <= at
        ? `a quest does not go backwards: this one is at "${q.stage}"`
        : `stages are taken one at a time: this one is at "${q.stage}"`);
    return {
      ok: false, blocked, overridden: check_notes, from: q.stage, to: toStage,
      next_stage: next,
      message: finished
        ? `"${q.title ?? 'This quest'}" has already reached ${q.stage}, the end of the loop. There is no stage after it.`
        : `This quest is at "${q.stage}". The only stage it can move to is "${next}".`,
      rule: 'The loop is a sequence. A stage skipped is a question nobody asked.',
    };
  }

  // Build and everything after it require the gates closed.
  if (idx >= STAGES.indexOf('prototype')) {
    const open = gates(questId).filter((g) => g.required && !g.satisfied && !g.overridden_at);
    for (const g of open) blocked.push(`gate not satisfied: ${g.gate}`);
    // Named, never silent. An override that stopped mentioning itself would be
    // the gate switched off with extra steps.
    for (const g of gates(questId).filter((x) => x.overridden_at && !x.satisfied)) {
      check_notes.push(`${g.gate.replace(/_/g, ' ')} was passed by ${g.overridden_by}: ${g.override_reason}`);
    }
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
  return {
    ok: blocked.length === 0, blocked, overridden: check_notes,
    from: q.stage, to: toStage, next_stage: next,
    // The interface shows `message` and falls back to the bare error code, so a
    // refusal with no message reaches a person as the single word "blocked" —
    // every reason computed, none of them shown. The list IS the answer.
    message: blocked.length
      ? `Not yet. ${blocked.join('. ')}.`
      : undefined,
  };
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
  const d = parseStamp(ts);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}
