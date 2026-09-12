// ── Engines: Maker + Media + Culture, around the Green Fire Quest ─────────
// A quest is the unit of useful work. The manual's hard rule lives here:
// "A high project score never overrides a red flag, missing consent, unsafe
//  conditions, ecological harm, or the absence of a maintenance owner."
import { all, one, create, run } from '../core/db.mjs';

export const STAGES = [
  'signal', 'listening', 'baseline', 'council_review', 'research', 'co_design',
  'resource_plan', 'prototype', 'teach_tell', 'test', 'decide', 'report_replicate',
];

/** Gates that must be satisfied before a quest may leave design and get built. */
const BUILD_GATES = [
  'rights_holder_consent', 'land_access', 'permits_insurance',
  'maintenance_owner', 'affected_party_process',
];

export function openQuest(chapterId, q) {
  const quest = create('quests', 'quest', chapterId, { ...q, chapter_id: chapterId });
  // Every quest starts with its gates declared, unsatisfied.
  for (const gate of BUILD_GATES) {
    create('quest_gates', 'gate', chapterId, { quest_id: quest.id, gate, required: 1, satisfied: 0 });
  }
  return quest;
}

export function gates(questId) {
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
