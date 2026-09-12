#!/usr/bin/env node
// End-to-end protocol test. Runs against a throwaway database, never your data.
//
//   npm test
//
// This does not test that the code runs. It tests that the code REFUSES —
// every gate in the manual, exercised from the same tool registry that Claude
// Code and the interface use.
// Set BEFORE any import that reaches core/db.mjs. The path is resolved lazily
// now, but this stays first as belt and braces, and the guard below is the belt.
process.env.BROS_DB = process.env.BROS_DB || '/tmp/bros-test-' + Date.now() + '.db';

import { rmSync } from 'node:fs';
import { runTool } from '../ai/tools.mjs';
import { one, db, openPath } from '../core/db.mjs';

db();
if (!/bros-test|\/tmp\//.test(openPath())) {
  console.error(`\n  REFUSING TO RUN: tests would write to ${openPath()}\n` +
                `  That is a real commons. Set BROS_DB to a throwaway path.\n`);
  process.exit(2);
}

let pass = 0, fail = 0;
const results = [];

function check(name, condition, detail) {
  if (condition) { pass++; results.push(['✓', name, null]); }
  else { fail++; results.push(['✗', name, detail]); }
}
const refused = (r, because) =>
  !!r?.error && (!because || JSON.stringify(r).toLowerCase().includes(because.toLowerCase()));

// ── fixture ───────────────────────────────────────────────────────────────
await runTool('create_chapter', {
  id: 'test', name: 'Test Commons', scale: 'watershed',
  represents: 'the people who signed up',
  does_not_represent: 'the county, any nation, or the watershed as a whole',
  lat: 30.26, lng: -97.79,
});

// ── Stage 2: Listen ───────────────────────────────────────────────────────
const intake = await runTool('submit_intake', {
  kind: 'need', body: 'The creek path floods and my kids cannot get to school.',
  submitted_by: 'A resident',
});
check('intake can be submitted', !!intake.id);

const responded = await runTool('respond_to_intake', {
  intake_id: intake.id, response: 'Brought to the next watershed circle.', status: 'in_council',
});
check('intake can be answered and moved out of received', responded.status === 'in_council');

check('declining with an empty reason is refused, naming what is missing',
  refused(await runTool('respond_to_intake',
    { intake_id: intake.id, response: '   ', status: 'declined' }), 'response'));

// ── Stage 5: Convene ──────────────────────────────────────────────────────
check('a council item without a Land Seat report is refused',
  refused(await runTool('propose_decision', { title: 'Do a thing', method: 'consent' }), 'land_seat'));

check('a council item WITH a Land Seat report but no red flags is accepted',
  !!(await runTool('propose_decision', {
    title: 'Publish the seasonal report', method: 'publish_notify',
    land_seat_report: 'Nothing downstream is affected by publishing.',
    land_seat_steward: 'M. Okafor',
  }))?.id);

check('an irreversible decision cannot use a light method',
  refused(await runTool('propose_decision', {
    title: 'Remove the weir', method: 'consent', reversible: false,
    land_seat_report: 'Downstream flow would change permanently.',
  }), 'method'));

const dec = await runTool('propose_decision', {
  title: 'Seasonal path closure', method: 'consent', reversible: true,
  land_seat_report: 'Low flow, exposed banks, uncertainty on recovery time.',
  land_seat_steward: 'R. Alvarez',
  red_flags: 'The running club was not consulted.',
});
check('a valid council item is accepted', !!dec.id);

check('a decision with an open red flag cannot be finalised',
  refused(await runTool('decide_council_item',
    { decision_id: dec.id, review_date: '2027-01-01' }), 'red flag'));

await runTool('clear_red_flag', {
  decision_id: dec.id, resolution: 'Alternate route agreed with the club.', resolved_by: 'R. Alvarez',
});
check('a decision cannot be finalised without a review date',
  refused(await runTool('decide_council_item', { decision_id: dec.id }), 'review date'));

const decided = await runTool('decide_council_item', { decision_id: dec.id, review_date: '2027-01-01' });
check('a decision with the flag resolved and a review date is finalised', decided.status === 'decided');

// ── Stages 7-8: Design & Build ────────────────────────────────────────────
const q = await runTool('open_quest', { title: 'Raise the creek path', category: 'Restoration' });
check('opening a quest creates its gates unsatisfied',
  (await runTool('quest_gates', { quest_id: q.id })).every((g) => !g.satisfied));

const blocked = await runTool('check_quest_advance', { quest_id: q.id, to_stage: 'prototype' });
check('a quest with open gates cannot reach build',
  blocked.ok === false && blocked.blocked.some((b) => b.includes('gate not satisfied')));

check('a gate does not close on a checkbox',
  refused(await runTool('satisfy_quest_gate',
    { quest_id: q.id, gate: 'land_access', evidence: '', reviewed_by: '' }), 'evidence'));

for (const gate of ['rights_holder_consent', 'land_access', 'permits_insurance',
                    'maintenance_owner', 'affected_party_process']) {
  await runTool('satisfy_quest_gate', {
    quest_id: q.id, gate, evidence: 'Signed agreement on file.', reviewed_by: 'R. Alvarez',
  });
}
const stillBlocked = await runTool('check_quest_advance', { quest_id: q.id, to_stage: 'prototype' });
check('gates closed but no maintenance owner still blocks build',
  stillBlocked.ok === false && stillBlocked.blocked.some((b) => /maintenance owner|smallest/.test(b)));

await runTool('update_quest', {
  quest_id: q.id, maintenance_owner: 'The path guild',
  smallest_experiment: 'Raise 20 metres of path and watch it through one wet season.',
});
const advanced = await runTool('advance_quest', { quest_id: q.id, to_stage: 'prototype' });
check('a fully gated, fully defined quest advances', advanced.stage === 'prototype');

check('a quest cannot be tested without a baseline to measure against',
  refused(await runTool('advance_quest', { quest_id: q.id, to_stage: 'test' }), 'baseline'));

// ── Stage 11: Measure ─────────────────────────────────────────────────────
check('an indicator without a decision trigger is refused',
  !(await runTool('add_indicator', { name: 'Flood days' }))?.id);

const ind = await runTool('add_indicator', {
  quest_id: q.id, name: 'Days the path is impassable', unit: 'days',
  baseline_value: 18, baseline_at: '2026-01-01',
  target_value: 4, target_by: '2027-01-01',
  method: 'Daily check by the school walking group.',
  decision_trigger: 'If impassable days rise above the baseline, stop and escalate to the watershed circle.',
});
check('an indicator with a decision trigger is accepted', !!ind.id);

const good = await runTool('record_measurement', { indicator_id: ind.id, value: 11, measured_by: 'Walking group' });
check('a reading toward the target is recorded as such', good.direction === 'toward_target');

const bad = await runTool('record_measurement', { indicator_id: ind.id, value: 24, measured_by: 'Walking group' });
check('a reading away from the target demands the trigger be applied now',
  bad.direction === 'away_from_target' && bad.review_needed === true);

// ── Stage 10: Exchange & Care ─────────────────────────────────────────────
const agent = await runTool('add_agent', { name: 'J. Fields', vf_agent_type: 'Person', role: 'Builder' });
check('paid work without acknowledged terms is refused',
  refused(await runTool('record_exchange', {
    vf_action: 'work', provider_id: agent.id, relationship: 'paid',
    resource_name: 'Path raising', vf_quantity: 12, vf_unit: 'hour',
  }), 'terms'));

const ev = await runTool('record_exchange', {
  vf_action: 'work', provider_id: agent.id, relationship: 'paid', terms_ack: true,
  resource_name: 'Path raising', vf_quantity: 12, vf_unit: 'hour',
});
check('paid work with acknowledged terms is recorded', !!ev.id);

// ── Data / AI engine ──────────────────────────────────────────────────────
check('AI may not be logged as deciding funding winners',
  refused(await runTool('log_ai_use', {
    tool: 'test', purpose: 'choose the funding winners for this round', human_reviewer: 'R. Alvarez',
  }), 'forbidden'));

check('AI use without a named human reviewer is refused',
  refused(await runTool('log_ai_use', { tool: 'test', purpose: 'draft a summary' }), 'reviewer'));

check('restricted material needs a documented correction path',
  refused(await runTool('log_ai_use', {
    tool: 'test', purpose: 'organize archive', data_class: 'restricted', human_reviewer: 'R. Alvarez',
  }), 'correction'));

check('ordinary AI use with a reviewer is logged',
  !!(await runTool('log_ai_use', {
    tool: 'test', purpose: 'draft a public summary', human_reviewer: 'R. Alvarez',
  }))?.id);

// ── Consent ───────────────────────────────────────────────────────────────
const consent = await runTool('record_consent', {
  subject: 'A resident interview', purpose: 'Short film about the path',
  granted_by: 'A resident', granted_at: '2026-05-01', benefit_sharing: 'Paid appearance fee',
});
const withdrawn = await runTool('withdraw_consent', { consent_id: consent.id, reason: 'Changed their mind' });
check('withdrawing consent names what must come down', !!withdrawn.action_required);

// ── Sensitivity ───────────────────────────────────────────────────────────
await runTool('add_signal', {
  title: 'A sacred site', category: 'Cultural', description: 'location withheld',
  lat: 30.3, lng: -97.8, sensitivity: 'sacred',
});
const pub = await runTool('get_atlas', { clearance: 'public' });
check('sacred material is withheld from a public atlas and the withholding is visible',
  pub.bros.redacted_features >= 1 &&
  !JSON.stringify(pub.features).includes('sacred site'));

// ── The operator ──────────────────────────────────────────────────────────
const next = await runTool('whats_next', {});
check('the operator reports what is waiting and cites a rule',
  next.total > 0 && !!next.first?.rule);

// ── Report ────────────────────────────────────────────────────────────────
const c = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', x: '\x1b[0m' };
console.log(`\n  Protocol tests\n  ${'─'.repeat(58)}`);
for (const [mark, name, detail] of results) {
  const col = mark === '✓' ? c.g : c.r;
  console.log(`  ${col}${mark}${c.x} ${name}`);
  if (detail) console.log(`      ${c.d}${detail}${c.x}`);
}
console.log(`  ${'─'.repeat(58)}`);
console.log(`  ${pass} passed, ${fail} failed\n`);
try { rmSync(process.env.BROS_DB, { force: true }); } catch {}
process.exit(fail ? 1 : 0);
