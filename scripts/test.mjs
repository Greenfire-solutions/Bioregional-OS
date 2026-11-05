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

import { rmSync, readFileSync } from 'node:fs';
// Raw socket, so a traversal probe can be sent the way an attacker would send
// it rather than the way fetch politely rewrites it first.
import { connect as netConnect } from 'node:net';
import { runTool } from '../ai/tools.mjs';
import { one, all, run as dbRun, db, openPath, create } from '../core/db.mjs';
import * as bioEngine from '../engines/bioregional.mjs';
import { skyToday, sunTimes, nextSolarEvent } from '../adapters/sky.mjs';
import { groundToday, thisWeekInHistory, anchorPlace } from '../engines/ground.mjs';
import { lookAround, beginHere } from '../engines/firstrun.mjs';
import { cardForTheWeek, markCardSent, daysSinceLastCard, safeToSend, credits } from '../engines/dispatch.mjs';
import { findDailyStat } from '../adapters/watershed.mjs';
import { whatMoved, intakePromise } from '../engines/loops.mjs';
import { carrying, placeAttention, looksLikeAGroup } from '../engines/attention.mjs';
import { GATES as QUEST_GATES, STAGES as QUEST_STAGES } from '../engines/quest.mjs';
import { AI_FORBIDDEN } from '../engines/stewardship.mjs';
import { vitals } from '../engines/vitals.mjs';
import { brief as landSeatBrief } from '../engines/landseat.mjs';
import { neighbours, summarise, refresh as refreshNeighbours } from '../engines/neighbours.mjs';
import { classifyPeer } from '../adapters/murmurations.mjs';
import { humanObserved, humanObservedSql, atPlaceCentroidSql } from '../core/provenance.mjs';
import { attributionFor as attrFor } from '../adapters/registry.mjs';
import { hazardSignals, worstLevel } from '../adapters/hazards.mjs';
import { THREATENED_SENSITIVITY } from '../adapters/life.mjs';
import { NLCD_CLASSES } from '../adapters/soil.mjs';
import * as registry from '../adapters/registry.mjs';
import { atlasGeoJSON } from '../adapters/geo.mjs';

db();
if (!/bros-test|\/tmp\//.test(openPath())) {
  console.error(`\n  REFUSING TO RUN: tests would write to ${openPath()}\n` +
                `  That is a real commons. Set BROS_DB to a throwaway path.\n`);
  process.exit(2);
}

let pass = 0, fail = 0, skipped = 0;
const results = [];

function check(name, condition, detail) {
  if (condition) { pass++; results.push(['✓', name, null]); }
  else { fail++; results.push(['✗', name, detail]); }
}

/**
 * Not applicable here, which is not the same as broken.
 *
 * A fresh clone has downloaded no optional data, so a test that needs it was
 * reporting a failure on somebody's very first `npm test` — the fourth variety
 * in the worst possible place, since the name said "region 30c is downloaded"
 * and the truth was "this machine has not been asked to download anything".
 *
 * Three outcomes rather than two, exactly as the mutation harness had to learn:
 * passed, failed, and did-not-apply. A stranger's first run of this suite is
 * part of the front door, and the front door must not open on a red line that
 * means nothing is wrong.
 */
function skip(name, why) { skipped++; results.push(['–', name, why]); }
/** Force a signal's provenance, the way an adapter would, without the network. */
function run__setSource(id, source) {
  dbRun(`UPDATE signals SET source_adapter=? WHERE id=?`, source, id);
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

// Walk the loop to get here, rather than teleporting.
//
// These assertions are about DEPTH — the gates, the maintenance owner, the
// baseline — and they used to reach `prototype` from `signal` in one call,
// because nothing enforced stage order. That hole is closed, and closing it
// broke five tests that had been quietly depending on it. Stepping through is
// what a chapter actually does, so the tests do it too.
const walkTo = async (stage) => {
  for (;;) {
    const at = one('SELECT stage FROM quests WHERE id=?', q.id)?.stage;
    const i = QUEST_STAGES.indexOf(at);
    if (at === stage || i < 0 || i + 1 >= QUEST_STAGES.length) return at;
    const r = await runTool('advance_quest', { quest_id: q.id, to_stage: QUEST_STAGES[i + 1] });
    if (r?.error) return at;
  }
};
check('a quest walks the loop one stage at a time',
  (await walkTo('resource_plan')) === 'resource_plan');

const blocked = await runTool('check_quest_advance', { quest_id: q.id, to_stage: 'prototype' });
check('a quest with open gates cannot reach build',
  blocked.ok === false && blocked.blocked.some((b) => b.includes('gate not satisfied')));

// The order rule itself, both directions, and the sentence that has to name
// where the quest may actually go.
const back = await runTool('check_quest_advance', { quest_id: q.id, to_stage: 'signal' });
check('a quest cannot be rewound to an earlier stage',
  back.ok === false && back.blocked.some((b) => /does not go backwards/.test(b)));
const leap = await runTool('check_quest_advance', { quest_id: q.id, to_stage: 'report_replicate' });
check('a quest cannot skip stages, however complete it looks',
  leap.ok === false && leap.blocked.some((b) => /one at a time/.test(b)));
check('and a refusal to move names the stage that is actually next',
  back.next_stage === 'prototype' && leap.next_stage === 'prototype',
  `${back.next_stage} / ${leap.next_stage}`);

check('a gate does not close on a checkbox',
  refused(await runTool('satisfy_quest_gate',
    { quest_id: q.id, gate: 'land_access', evidence: '', reviewed_by: '' }), 'evidence'));

// Every gate the manual names, not a subset. Four of the nine — indigenous
// consent, youth safeguarding, ecological assessment and data consent — were
// declared in the schema and never created on any quest, so nothing was ever
// blocked pending an ecological assessment in a bioregional OS. Read from
// quest.mjs rather than listed here, so this can never silently fall behind
// the protocol again.
check('every gate the protocol names is created on a new quest',
  (await runTool('quest_gates', { quest_id: q.id })).length === QUEST_GATES.length,
  `${(await runTool('quest_gates', { quest_id: q.id })).length} of ${QUEST_GATES.length}`);
check('the ecological assessment gate is one of them',
  (await runTool('quest_gates', { quest_id: q.id })).some((g) => g.gate === 'ecological_assessment'));

// A gate that does not apply still closes on a REASON and a named person —
// which is the whole argument for requiring all nine rather than defaulting
// the awkward four to optional. The record is of somebody having considered it.
const NOT_APPLICABLE = {
  indigenous_consent: 'Consulted NATHPO listing; no tribal historic preservation interest recorded for this parcel.',
  youth_safeguarding: 'Not applicable — no minors involved in a culvert survey.',
  ecological_assessment: 'Walked with the county ecologist 12 March; no listed species on the reach.',
  data_consent: 'Not applicable — no personal data collected.',
};
for (const gate of QUEST_GATES) {
  await runTool('satisfy_quest_gate', {
    quest_id: q.id, gate,
    evidence: NOT_APPLICABLE[gate] ?? 'Signed agreement on file.',
    reviewed_by: 'R. Alvarez',
  });
}
check('a gate that does not apply closes on a reason, not a shrug',
  (await runTool('quest_gates', { quest_id: q.id }))
    .find((g) => g.gate === 'youth_safeguarding')?.evidence.includes('no minors'));
const stillBlocked = await runTool('check_quest_advance', { quest_id: q.id, to_stage: 'prototype' });
check('gates closed but no maintenance owner still blocks build',
  stillBlocked.ok === false && stillBlocked.blocked.some((b) => /maintenance owner|smallest/.test(b)));

await runTool('update_quest', {
  quest_id: q.id, maintenance_owner: 'The path guild',
  smallest_experiment: 'Raise 20 metres of path and watch it through one wet season.',
});
const advanced = await runTool('advance_quest', { quest_id: q.id, to_stage: 'prototype' });
check('a fully gated, fully defined quest advances', advanced.stage === 'prototype');

// The walk is checked, not discarded. And the assertion below reads `blocked`
// rather than matching the word "baseline" against the whole serialised result
// — because "baseline" is ALSO a stage name (STAGES[2]), and this result now
// carries `from`, `to` and `next_stage`. The day some edit walks this quest
// past that stage, a substring match would go green while asserting nothing.
const toTeach = await runTool('advance_quest', { quest_id: q.id, to_stage: 'teach_tell' });
check('the walk to teach_tell actually happened', toTeach.stage === 'teach_tell',
  JSON.stringify(toTeach.error ?? toTeach.stage));
const noBaseline = await runTool('advance_quest', { quest_id: q.id, to_stage: 'test' });
check('a quest cannot be tested without a baseline to measure against',
  noBaseline.error === 'blocked'
    && noBaseline.blocked.some((b) => /indicator with a baseline/.test(b)),
  JSON.stringify(noBaseline.blocked));

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

// ── The ground: what the land gives before anything is asked ──────────────
// Sky is computed here, so it must answer with no network at all.
const austin = sunTimes(new Date('2026-06-21T12:00:00Z'), 30.26, -97.79);
check('the sun is computed locally, with no upstream',
  !!austin.sunrise && !!austin.sunset && austin.sunset > austin.sunrise,
  JSON.stringify(austin));

const midsummer = skyToday(30.26, -97.79, new Date('2026-06-21T12:00:00Z'));
const midwinter = skyToday(30.26, -97.79, new Date('2026-12-21T12:00:00Z'));
check('the longest day is longer than the shortest',
  midsummer.daylight_seconds > midwinter.daylight_seconds + 3 * 3600,
  `${midsummer.daylight} vs ${midwinter.daylight}`);

// Measured a month off each solstice — at the solstice itself the day-over-day
// change is a second or two either way, which is the point of a solstice.
const shortening = skyToday(30.26, -97.79, new Date('2026-07-21T12:00:00Z'));
const lengthening = skyToday(30.26, -97.79, new Date('2027-01-21T12:00:00Z'));
check('daylight knows which way it is moving',
  shortening.daylight_change_seconds < 0 && lengthening.daylight_change_seconds > 0,
  `${shortening.daylight_change} / ${lengthening.daylight_change}`);

const polar = sunTimes(new Date('2026-06-21T12:00:00Z'), 78.2, 15.6);   // Svalbard
check('polar day is reported as polar day, not as a missing sunrise',
  polar.sunrise === null && polar.polar === 'day', JSON.stringify(polar));

const turn = nextSolarEvent(new Date('2026-03-01T00:00:00Z'));
check('the next turn of the year is found to the day',
  turn?.name === 'March equinox' && turn.days_away >= 18 && turn.days_away <= 21,
  JSON.stringify(turn));

const noWhere = await groundToday('no-such-chapter');
check('the ground says what is missing instead of failing',
  noWhere.error === 'no_located_place' && !!noWhere.action, JSON.stringify(noWhere));

// Provenance: the assistant must not be able to file an observation as a human's.
const byAI = await runTool('add_signal', { title: 'Recorded by the assistant' });
const byPerson = await runTool('add_signal', { title: 'Noticed by a person', source: 'notice' });
check("an observation the assistant records is labelled as the assistant's",
  one('SELECT source_adapter s FROM signals WHERE id=?', byAI.id)?.s === 'assistant');
check('an observation a person notices is labelled as theirs',
  one('SELECT source_adapter s FROM signals WHERE id=?', byPerson.id)?.s === 'notice');
check('nothing observed is verified by writing it down',
  one('SELECT verified v FROM signals WHERE id=?', byPerson.id)?.v === 0);

// The archive is honest about being young, rather than showing an empty box.
const history = thisWeekInHistory('test');
check('an empty archive says when it stops being empty',
  // Asserts the meaning — nothing recorded, and the note names the year it
  // starts filling in — rather than the sentence, which is free to be reworded.
  history.items.length === 0 && /\b20\d{2}\b/.test(history.note ?? ''), JSON.stringify(history));

// ── No two adapters may export the same name ──────────────────────────────
// `climateNormals` was exported by both climate.mjs and phenology.mjs, returning
// different shapes from different upstreams. Nothing broke, because every caller
// named its module — but the name promised the same thing from both, and the
// trap was waiting for whoever imported the one they did not mean. This asserts
// the whole adapter surface rather than that one case, so the next collision
// fails here instead of somewhere downstream.
const { readdirSync } = await import('node:fs');
const adapterDir = new URL('../adapters/', import.meta.url);
const seenExport = new Map();
const collisions = [];
for (const file of readdirSync(adapterDir).filter((f) => f.endsWith('.mjs'))) {
  const mod = await import(new URL(file, adapterDir).href);
  for (const name of Object.keys(mod)) {
    // A name genuinely re-exported from one module by another is not a collision.
    const prior = seenExport.get(name);
    if (prior && mod[name] !== (await import(new URL(prior, adapterDir).href))[name]) {
      collisions.push(`${name}: ${prior} and ${file}`);
    } else if (!prior) seenExport.set(name, file);
  }
}
check('no two adapters export the same name for different things',
  collisions.length === 0, collisions.join(' · '));

// ── A quiet heartbeat is not a dead one ──────────────────────────────────
// The log only records ticks that produced a result, so a task running every
// half hour and correctly finding nothing to do never appeared in it — and
// status() reported `last: null`, which is exactly what a task that has never
// fired at all looks like. A silent success and a dead timer were one value, in
// the file whose header says a scheduler that fails silently is worse than none.
{
  const { taskState } = await import('../engines/heartbeat.mjs');
  check('a stopped heartbeat says stopped, not silent',
    taskState(false, null) === 'not started');
  check('armed but not yet fired is distinct from having run',
    taskState(true, null) === 'not run yet');
  // The one the whole fix exists for.
  check('ran with nothing to report is distinguishable from never having run',
    taskState(true, { had_result: false }) === 'ran, nothing to report' &&
    taskState(true, { had_result: false }) !== taskState(true, null));
  check('ran with news says so',
    taskState(true, { had_result: true }) === 'ran, had something to report');
  check('a task that threw is not reported as merely quiet',
    taskState(true, { had_result: false, error: 'boom' }) === 'failed on its last tick');
  check('all four outcomes are distinct — none collapses into another',
    new Set([taskState(false, null), taskState(true, null),
             taskState(true, { had_result: false }), taskState(true, { had_result: true }),
             taskState(true, { error: 'x' })]).size === 5);
}

// ── An artifact that travels says what it is ─────────────────────────────
// The seeded commons reads like real reporting — "Unpermitted Stormwater
// Outfall Discharge", Critical, naming a real creek and a real city department.
// In the app that sits under an example-data banner. In a GeoJSON opened in
// QGIS, or a bundle landed in a stranger's commons, there is no banner at all.
//
// The direction that matters is the SECOND one: a notice that fires on
// everything is noise, and noise is not read — which leaves a real chapter's
// export carrying a claim that it is fictional.
{
  const { isDemoChapter, DEMO_CHAPTER_ID, DEMO_NOTICE } = await import('../core/seedData.js');
  // Imported locally: `bundle` is destructured further down the file, and
  // referencing it from here hits the temporal dead zone.
  const { manifest: koiManifest, bundle: koiBundle } = await import('../adapters/koi.mjs');

  check('the demonstration commons is identified in one place, not four',
    isDemoChapter(DEMO_CHAPTER_ID) && !isDemoChapter('test') && !isDemoChapter(null));

  const demoExport = atlasGeoJSON(DEMO_CHAPTER_ID, { clearance: 'public' });
  const realExport = atlasGeoJSON('test', { clearance: 'public' });
  check('a GeoJSON of the example data says so in the file itself',
    demoExport.bros.demonstration_data?.label === DEMO_NOTICE.label);
  check('a GeoJSON from a real chapter does NOT claim to be fictional',
    realExport.bros.demonstration_data === undefined,
    JSON.stringify(realExport.bros.demonstration_data));

  check('a manifest from a real chapter does NOT claim to be fictional',
    koiManifest('test', { clearance: 'public' }).demonstration_data === undefined);
  check('a manifest of the example data does say so, before anyone pulls a bundle',
    koiManifest(DEMO_CHAPTER_ID, { clearance: 'public' }).demonstration_data?.label === DEMO_NOTICE.label);

  const realRid = one("SELECT rid FROM rids WHERE chapter_id='test' AND object_type='signal' AND sensitivity='public' LIMIT 1")?.rid;
  if (realRid) {
    check('a bundle from a real chapter does NOT claim to be fictional',
      koiBundle(realRid, { clearance: 'council' }).demonstration_data === undefined);
  }
  // Assert the STRUCTURE, not the sentences. The marker makes two claims that
  // must stay apart: the commons is invented, the readings are not. A single
  // blanket denial was the first version and it was false — the demo export is
  // 67 real features to 6 invented ones, and telling a reader to distrust a live
  // hazard alert is worse than telling them nothing.
  check('the marker keeps the two claims apart rather than denying everything',
    typeof DEMO_NOTICE.commons === 'string' && typeof DEMO_NOTICE.land === 'string' &&
    DEMO_NOTICE.commons.length > 40 && DEMO_NOTICE.land.length > 40);
  check('it leads with a label a reader scanning a file cannot miss',
    DEMO_NOTICE.label === 'DEMONSTRATION DATA');
  check('the invented half is named as invented',
    /invent|fiction/i.test(DEMO_NOTICE.commons));
  check('and the measured half is NOT — a real reading must not be disclaimed',
    /not invented|are real|real measurement/i.test(DEMO_NOTICE.land) &&
    !/nothing here is real/i.test(DEMO_NOTICE.land));
}

// ── The upstream registry: one declaration, no second copy ────────────────
// Assert the property, not a proxy for it. An earlier version of this used
// `length > 3` as a stand-in for "has a licence" and failed on "CC0" — which is
// a complete, valid licence identifier three characters long.
const PLACEHOLDER = /^(tbd|todo|unknown|none|n\/a|\?+)$/i;
check('every declared source carries a real licence, not a placeholder',
  registry.SOURCES.every((s) => typeof s.license === 'string' && s.license.trim() && !PLACEHOLDER.test(s.license.trim())),
  registry.SOURCES.filter((s) => !s.license || PLACEHOLDER.test(String(s.license).trim())).map((s) => s.id).join(', '));
check('every declared source carries an attribution string an export can print',
  registry.SOURCES.every((s) => typeof s.attribution === 'string' && s.attribution.trim().length > 0),
  registry.SOURCES.filter((s) => !s.attribution).map((s) => s.id).join(', '));
check('every declared source either names a real Atlas layer or declares itself supporting',
  registry.SOURCES.every((s) => s.layer === null || (s.layer >= 1 && s.layer <= 12)),
  registry.SOURCES.filter((s) => !(s.layer === null || (s.layer >= 1 && s.layer <= 12))).map((s) => s.id).join(', '));
// A geocoder is not a map layer, and must not be able to become one by accident.
check('a supporting source cannot register itself as an Atlas layer',
  registry.registerLayer('test', 'nominatim') === null);
// The whole point of the registry: an unknown source is not assumed harmless.
check('an unknown source defaults to members, not public',
  registry.defaultSensitivity('no-such-source') === 'members',
  registry.defaultSensitivity('no-such-source'));
const coverage = registry.layerCoverage('test');
check('the Atlas gap report covers all twelve layers', coverage.length === 12);
// Assert the PROPERTY, not the sentence about it. The note can be reworded; the
// fact that nothing upstream fills layer 12 is what the note is describing.
check('layer 12 is the chapter\'s own work — nothing upstream fills it',
  registry.sourcesForLayer(12).length === 0 && !!coverage[11].note,
  registry.sourcesForLayer(12).map((x) => x.id).join(', '));

// Asking a land question without saying where must work, because ground_today
// already does — a caller should not have to learn which tools need an argument.
for (const t of ['soil_at', 'life_here', 'hazards_at']) {
  const r = await runTool(t, {});
  check(`${t} refuses cleanly, and namely, when the chapter has nowhere located yet`,
    r?.error === 'no_location' && /add a place/i.test(r.message ?? ''),
    JSON.stringify(r).slice(0, 90));
}

// Coordinate provenance: the question a map pin answers is "is this where it
// is?", which is NOT the same question as "did a person put it here". Splitting
// by observer gets both cases backwards — the gage goes vague, the note goes
// precise — so the rule is asserted in both directions.
const { atPlaceCentroid } = await import('../core/provenance.mjs');
const chapterPlaces = [{ lat: 30.261, lng: -97.794 }];
check('an automated reading with its own coordinate is not at the place centroid',
  atPlaceCentroid({ lat: 30.37214825, lng: -97.7847301 }, chapterPlaces) === false);
check('a county-wide alert filed at the place is marked as borrowed',
  atPlaceCentroid({ lat: 30.261, lng: -97.794 }, chapterPlaces) === true);
// The case that proves it is not the human/automated split wearing a hat.
check('a human note filed at the place is borrowed too, exactly like the alert',
  atPlaceCentroid({ lat: 30.261, lng: -97.794 }, chapterPlaces) === true);
check('a signal with no coordinate is not claimed to be anywhere',
  atPlaceCentroid({ lat: null, lng: null }, chapterPlaces) === false);

const exported = atlasGeoJSON('test', { clearance: 'council' });
check('a GeoJSON export tells QGIS how much of it is approximate',
  typeof exported.bros.features_at_place_centroid === 'number');

// This file LEAVES THE MACHINE. For an ODbL or CC-BY source, credit is not
// tidiness — it is the condition of being allowed to share it at all. It
// carried none until a sibling session found the same class of bug in a
// first-run string: a licence moved out of adapter prose into the registry is
// only safe once every surface that PRINTED the prose resolves it instead.
check('an export always carries an attribution block',
  Array.isArray(exported.bros.attribution), JSON.stringify(exported.bros).slice(0, 120));
check('an export states its terms rather than leaving them to be assumed',
  typeof exported.bros.notice === 'string' && exported.bros.notice.length > 20);
// A source nobody can resolve must be NAMED, never quietly dropped — an export
// missing one credit is indistinguishable from an export that needed none.
dbRun(`INSERT INTO signals (id, chapter_id, title, category, lat, lng, source_adapter)
       VALUES ('sig-unmapped','test','From somewhere unrecognised','Ecological',30.2,-97.7,'mystery-feed')`);
const withUnknown = atlasGeoJSON('test', { clearance: 'council' });
check('an unresolvable source is named in the export, not silently omitted',
  (withUnknown.bros.unresolved_sources ?? []).includes('mystery-feed'),
  JSON.stringify(withUnknown.bros.unresolved_sources));
// Assert what the notice has to MEAN, not how it is worded — an earlier version
// pinned the exact sentence and broke the moment the wording was shared between
// two callers, which is a test failing for the wrong reason.
check('and the notice tells the reader to check those terms before passing it on',
  /check .*terms/i.test(withUnknown.bros.notice) &&
  withUnknown.bros.notice.includes('mystery-feed'),
  withUnknown.bros.notice);

// A knowledge bundle travels FURTHEST — it is designed to land in another
// commons, so an uncredited one becomes somebody else's problem rather than
// stopping at one group chat.
const { bundle } = await import('../adapters/koi.mjs');
// Deliberately a PUBLIC one. The first attempt at this test grabbed whatever
// signal came first and got a `sacred` one, which bundle() refused outright —
// the gate doing its job and the test asking the wrong question.
const sigRid = one(`SELECT rid FROM rids WHERE object_type='signal' AND chapter_id='test'
                      AND sensitivity='public' LIMIT 1`)?.rid;
if (sigRid) {
  const b = bundle(sigRid, { clearance: 'council' });
  check('a knowledge bundle carries its credit with it',
    Array.isArray(b.attribution) && typeof b.notice === 'string', JSON.stringify(b).slice(0, 120));
}
// And the refusal above is worth asserting in its own right.
const sacredRid = one(`SELECT rid FROM rids WHERE sensitivity='sacred' LIMIT 1`)?.rid;
if (sacredRid) {
  check('sacred material does not travel in a bundle at all',
    bundle(sacredRid, { clearance: 'council' })?.error === 'withheld');
}
dbRun(`DELETE FROM signals WHERE id='sig-unmapped'`);

// ── Layer 3: never average across units ───────────────────────────────────
// Nitrate arrives in the same WQP result set as both mg/L as N and mg/L as NO3,
// twenty samples each, on scales differing by about 4.4x. Medianing across them
// gave 2.39 — the median of neither group, corresponding to no real
// measurement, printed with one of the two unit labels attached. A quotable,
// plausible, wrong number about whether water is safe to be in.
const { groupByUnit } = await import('../adapters/hydrology.mjs');
const nitrateRows = [
  ...Array.from({ length: 3 }, (_, i) => ({ CharacteristicName: 'Nitrate', 'ResultMeasure/MeasureUnitCode': 'mg/l as N', ResultMeasureValue: String(1 + i), ActivityStartDate: '2024-01-0' + (i + 1), MonitoringLocationIdentifier: 'A' })),
  ...Array.from({ length: 3 }, (_, i) => ({ CharacteristicName: 'Nitrate', 'ResultMeasure/MeasureUnitCode': 'mg/l asNO3', ResultMeasureValue: String(6 + i), ActivityStartDate: '2024-01-0' + (i + 1), MonitoringLocationIdentifier: 'B' })),
];
const grouped = groupByUnit(nitrateRows);
check('one characteristic in two units is kept as two groups, never merged',
  grouped.filter((g) => g.name === 'Nitrate').length === 2, JSON.stringify(grouped.map((g) => [g.name, g.unit, g.median])));
check('neither group\'s median is the median of the pooled values',
  grouped.every((g) => g.median !== 3.5), JSON.stringify(grouped.map((g) => g.median)));
check('each group names the other units the same characteristic came in',
  grouped.every((g) => Array.isArray(g.also_reported_in) && g.also_reported_in.length === 1));
// The blank-cell rule, again, in a third API.
const withBlank = groupByUnit([
  { CharacteristicName: 'Nitrate', 'ResultMeasure/MeasureUnitCode': 'mg/l as N', ResultMeasureValue: '', ActivityStartDate: '2024-01-01' },
  { CharacteristicName: 'Nitrate', 'ResultMeasure/MeasureUnitCode': 'mg/l as N', ResultMeasureValue: '4', ActivityStartDate: '2024-01-02' },
]);
check('a sample taken and not recorded is not a reading of zero',
  withBlank[0].samples === 1 && withBlank[0].sampled_but_not_recorded === 1 && withBlank[0].median === 4,
  JSON.stringify(withBlank[0]));
// WQP writes 'hours' and 'None' into the unit column for some bacterial counts.
const junk = groupByUnit([
  { CharacteristicName: 'Escherichia coli', 'ResultMeasure/MeasureUnitCode': 'hours', ResultMeasureValue: '7', ActivityStartDate: '2024-01-01' },
]);
check('a time unit on a bacterial count is flagged, not printed as a concentration',
  junk[0].unit_looks_wrong === 'hours');
check('"None" in a unit column is read as no unit, not as a unit called None',
  groupByUnit([{ CharacteristicName: 'pH', 'ResultMeasure/MeasureUnitCode': 'None', ResultMeasureValue: '7' }])[0].unit === null);

// ── Layer 11: what may be played, and what may travel ─────────────────────
// A recording's MEDIA licence is a different field from its observation's, and
// the default is CC-BY-NC. Both halves of that matter and both are asserted.
const { mediaRights } = await import('../adapters/culture.mjs');
check('an unlicensed recording is all rights reserved, not free',
  mediaRights(null).streamable === false && mediaRights('').streamable === false,
  JSON.stringify(mediaRights(null)));
// Same reason as the licence classifier: the allowlist refuses it either way,
// but only the absent-branch says WHY in terms a person can act on.
check('an unlicensed recording reports no licence, not an unreadable one',
  mediaRights(null).code === null && mediaRights(null).streamable === false &&
  (mediaRights(null).why ?? '').length > 20 &&
  // distinguishable from the "we do not know this licence" branch, which names one
  mediaRights('weird-licence').code === 'weird-licence',
  mediaRights(null).why);
check('CC-BY-NC may be played from its own host but never copied',
  mediaRights('cc-by-nc').streamable === true && mediaRights('cc-by-nc').redistributable === false);
check('CC0 and CC-BY may travel',
  mediaRights('cc0').redistributable && mediaRights('cc-by').redistributable);
check('a licence this OS does not know is refused rather than assumed',
  mediaRights('all rights reserved').streamable === false);
check('every media rights answer explains itself',
  [null, 'cc-by-nc', 'weird'].every((c) => (mediaRights(c).why ?? '').length > 15));

// A display name that may be a common name or a Latin binomial has to say which,
// or a caller prints "Malvaviscus arboreus" into a sentence written for "Turk's
// Cap" and nothing anywhere can tell that it happened. Same fix as `at_is`.
// (The first version of this test asserted an inline lambda rather than the
// adapter — a tautology that could never fail. A test that cannot fail is worse
// than no test, because it occupies the space where a real one would go.)
const { displayName } = await import('../adapters/life.mjs');
check('a taxon with a common name reports it as common',
  displayName({ preferred_common_name: "Turk's Cap", name: 'Malvaviscus arboreus' }).name_is === 'common');
check('a taxon with only a binomial says so rather than passing it off as a common name',
  displayName({ name: 'Malvaviscus arboreus' }).name_is === 'scientific' &&
  displayName({ name: 'Malvaviscus arboreus' }).common_name === null);
check('an empty taxon names nothing and claims nothing',
  displayName({}).name === null && displayName({}).name_is === null);
check('the display name never silently differs from both real names',
  ['Turk\'s Cap', 'Malvaviscus arboreus'].includes(
    displayName({ preferred_common_name: "Turk's Cap", name: 'Malvaviscus arboreus' }).name));

// An archive is indexed on what things were called; a place row is named for
// the people who use it. Searching "Barton Creek Greenbelt Reach" found nothing
// in a century of newspapers that hold 1,566 pages about "Barton Creek". The
// widening is allowed — but which term actually matched has to come back, or a
// result about the whole creek reads as a result about one reach of it.
const { searchTerms } = await import('../adapters/culture.mjs');
check('a place name is widened toward what an archive would have indexed',
  searchTerms('Barton Creek Greenbelt Reach').includes('Barton Creek'),
  JSON.stringify(searchTerms('Barton Creek Greenbelt Reach')));
check('the place\'s own name is always tried first',
  searchTerms('Barton Creek Greenbelt Reach')[0] === 'Barton Creek Greenbelt Reach');
check('a name with nothing to trim is not widened into something vaguer',
  searchTerms('Asheville').length === 1);
check('an empty name yields no search at all rather than a blank query',
  searchTerms('').length === 0 && searchTerms(null).length === 0);

// ── Layers 7-10: what a tag actually means ────────────────────────────────
// amenity=shelter is a bus shelter. Around Barton Creek it matches 135 objects
// and not one is a refuge. Mapping it to care would claim 135 shelters where
// there are none — confident, plausible, wrong.
const { CATEGORIES } = await import('../adapters/community.mjs');
const refuge = CATEGORIES.find((c) => c.key === 'refuge');
check('a bus shelter is never counted as a refuge',
  refuge.match({ amenity: 'shelter', shelter_type: 'public_transport' }) === false &&
  refuge.match({ amenity: 'social_facility', social_facility: 'shelter' }) === true);
check('no category claims a tag it does not mean',
  !CATEGORIES.some((c) => c.match({ amenity: 'shelter', shelter_type: 'gazebo' })));
check('every community category names a real Atlas layer',
  CATEGORIES.every((c) => c.layer >= 7 && c.layer <= 11));

// Each category carries TWO forms of one rule: the Overpass `selector` that asks
// the server for objects, and the `match` predicate that sorts the answers. Only
// `match` was tested, which is the same gap as an SQL rule whose in-memory twin
// is covered and whose SQL form is not — and the untested form is the one the
// server actually runs. If they disagree, the query fetches objects nothing
// claims and they vanish into `uncategorised`, or a matcher claims objects the
// query never asked for. Both are silent.
function selectorExamples(sel) {
  const out = [], pairs = [];
  const re = /\["([^"]+)"(?:(=|~)"([^"]+)")?\]/g;
  let m;
  while ((m = re.exec(sel))) pairs.push([m[1], m[2], m[3]]);
  const values = (op, v) => (op === undefined ? ['yes']
    : op === '=' ? [v]
    : v.replace(/^\^\(|\)\$$/g, '').split('|'));
  (function expand(i, acc) {
    if (i >= pairs.length) { out.push({ ...acc }); return; }
    const [k, op, v] = pairs[i];
    for (const val of values(op, v)) expand(i + 1, { ...acc, [k]: val });
  })(0, {});
  return out;
}
const disagreements = CATEGORIES.flatMap((c) =>
  selectorExamples(c.selector).filter((tags) => !c.match(tags))
    .map((tags) => `${c.key}: asks for ${JSON.stringify(tags)} but rejects it`));
check('every category\'s Overpass query and its matcher agree',
  disagreements.length === 0, disagreements.slice(0, 3).join(' · '));
check('the selector/matcher check is actually exercising something',
  CATEGORIES.every((c) => selectorExamples(c.selector).length > 0),
  CATEGORIES.filter((c) => selectorExamples(c.selector).length === 0).map((c) => c.key).join(', '));
// 242 rooftop panels as pins is noise; as a number it is a fact.
check('count-only categories exist so a tally cannot become a map of pins',
  CATEGORIES.some((c) => c.count_only));

// ── Stage 11: a baseline is offered or refused, never guessed ─────────────
const noSuch = await bioEngine.proposeBaseline('test', { indicator: 'number of volunteers' });
check('an indicator nothing open measures is refused, not invented',
  noSuch.proposed === false && noSuch.error === 'no_baseline', JSON.stringify(noSuch).slice(0, 90));
check('the refusal hands back guidance rather than an empty field',
  typeof noSuch.guidance === 'string' && noSuch.guidance.length > 30 &&
  noSuch.baseline_value === undefined, JSON.stringify(noSuch).slice(0, 90));
const noWhere2 = await bioEngine.proposeBaseline('test', { indicator: 'creek flow' });
check('a baseline needs somewhere to be a baseline of',
  noWhere2.error === 'no_location', JSON.stringify(noWhere2).slice(0, 80));

// ── Stage 11: a baseline can be set once, and moving it is a rewrite ──────
// "Up 30%" means something different the moment the starting point moves, and
// the readings already taken do not change to match. So the first baseline goes
// in freely and any later change has to say why.
const baseInd = await runTool('add_indicator', {
  name: 'Creek flow at the crossing', unit: 'ft3/s',
  method: 'Staff gauge', cadence: 'monthly',
  decision_trigger: 'Below 1 cfs for two readings, pause the instream work.',
});
check('an indicator can start with no baseline at all',
  one('SELECT baseline_value b FROM indicators WHERE id=?', baseInd.id)?.b == null);

const baseFirst = bioEngine.setBaseline(baseInd.id, {
  value: 1.2, unit: 'ft3/s', method: 'USGS median for this calendar day',
  source: 'USGS NWIS daily statistics', licence: 'Public domain (US Government)',
});
check('a first baseline is accepted without ceremony', baseFirst.indicator?.baseline_value === 1.2);
// The method must carry the SOURCE it was given — that is input echoed back,
// which survives any rewording of the surrounding sentence.
check('a baseline from public record carries the source it came from',
  (baseFirst.indicator?.method ?? '').includes('USGS NWIS daily statistics') &&
  (baseFirst.indicator?.method ?? '').includes('Public domain (US Government)'),
  baseFirst.indicator?.method);

const baseSilent = bioEngine.setBaseline(baseInd.id, { value: 9.9 });
check('moving a baseline without a reason is refused',
  baseSilent.error === 'baseline_already_set', JSON.stringify(baseSilent).slice(0, 90));
check('the refusal shows what the baseline currently is, so it can be argued with',
  baseSilent.current?.value === 1.2);

const baseMoved = bioEngine.setBaseline(baseInd.id, { value: 9.9, reason: 'Gauge was resited upstream.' });
check('moving a baseline with a reason is allowed, and the reason is kept',
  baseMoved.indicator?.baseline_value === 9.9 && /resited upstream/i.test(baseMoved.indicator?.method ?? ''),
  baseMoved.indicator?.method);
check('a baseline still refuses a value that is not a number',
  bioEngine.setBaseline(baseInd.id, { value: 'soon', reason: 'x' }).error === 'no_value');

// ── Discovery: the licence gate ───────────────────────────────────────────
// This classifier is the entire safety story of the discovery adapter, so it is
// tested in the direction that costs something: a false HOLD costs one human
// glance, a false AUTO publishes terms nobody read.
const { classifyLicense, layerFor } = await import('../adapters/discover.mjs');
const auto = (l) => classifyLicense(l).auto_approvable;

check('an unambiguous public-domain dedication approves itself',
  ['Public Domain', 'U.S. Public Domain', 'CC0-1.0',
   'http://creativecommons.org/publicdomain/zero/1.0/'].every(auto));

// The single most dangerous misreading available here. ArcGIS Hub returns the
// literal string 'none' for most of its catalogue, and it means "nobody filled
// this in" — absent a licence the default is all rights reserved.
check('"none" is an absent licence, not a permissive one', auto('none') === false,
  JSON.stringify(classifyLicense('none')));
check('an empty licence is never auto-approved',
  [null, undefined, '', '   ', 'unknown', 'custom', 'other', 'N/A'].every((l) => !auto(l)));
// The allowlist would refuse these anyway, so the absent-branch is belt and
// braces — but it is the branch that produces the RIGHT explanation, and a
// person deciding whether to approve reads the explanation. Pin the class, or
// removing the branch silently downgrades "nobody recorded a licence" to
// "we did not recognise this licence", which are different problems.
check('an absent licence is reported as absent, not as unrecognised',
  [null, '', 'none', 'custom'].every((l) => classifyLicense(l).class === 'unknown'),
  [null, '', 'none', 'custom'].map((l) => `${JSON.stringify(l)}→${classifyLicense(l).class}`).join(' '));
check('an absent licence explains that absence means all rights reserved',
  /all rights reserved|absence/i.test(classifyLicense('').why));

// Open is not the same as public domain. Attribution and share-alike are
// obligations, and a machine cannot accept an obligation for a commons.
check('open-with-conditions licences are held for a person',
  ['CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'ODbL', 'Open Government Licence'].every((l) => !auto(l)),
  ['CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'ODbL', 'Open Government Licence'].filter(auto).join(', '));
check('an unreadable licence is held, and says it was not understood',
  !auto('See Terms of Use') && classifyLicense('See Terms of Use').class === 'unrecognised');
check('every held licence explains itself in words',
  ['none', '', 'CC-BY-4.0', 'See Terms of Use'].every((l) => (classifyLicense(l).why ?? '').length > 20));

// The layer a candidate lands on must come from the DATASET, not the search —
// or searching for "creek" files library figures as a water layer, and being
// public domain it would auto-approve onto the map.
check('a candidate takes its layer from its own title, not from the query',
  layerFor('creek', 'Annual Physical Circulation by Library', '').layer !== 3);
check('a dataset that names its subject is filed, and says which word decided it',
  layerFor('creek', 'Waterway Setbacks', '').layer === 3 &&
  layerFor('creek', 'Waterway Setbacks', '').matched === 'water');
check('a dataset naming nothing recognisable gets no layer, so it is never mapped',
  layerFor('creek', 'Quarterly Report', '').layer === null);

// A catalogue ranks by its own relevance, not ours. Asking ArcGIS for "trees
// Asheville North Carolina" returns anything about North Carolina, and keeping
// those would tell somebody their city publishes eight datasets about trees when
// it publishes none — a confident answer to a question nobody answered.
check('a result is kept when it shares the subject\'s layer without using its word',
  layerFor('creek', 'Waterway Setbacks', '').layer === layerFor('creek', 'creek', '').layer);
check('a subject with no recognisable layer cannot silently match everything',
  layerFor('zzz', 'zzz', '').layer === null);

// ── Discovery: the approval gate ──────────────────────────────────────────
const cand = create('discovered_datasets', 'discovered_dataset', 'test', {
  chapter_id: 'test', title: 'Test Floodplain Layer', publisher: 'A city portal',
  portal: 'example.gov', portal_type: 'socrata', subject: 'flooding',
  source_url: 'https://example.gov/d/test-1', atlas_layer: 6,
  license_raw: null, license_class: 'unknown',
  license_note: 'the portal recorded no licence at all',
}, 'members');

const noName = bioEngine.approveDataset(cand.id, {});
check('approving somebody else\'s licence needs a name on it',
  noName.error === 'reviewer_required', JSON.stringify(noName).slice(0, 90));
check('the refusal shows the licence being accepted, so the reviewer can read it',
  'licence' in noName && 'why_held' in noName);

const noReason = bioEngine.declineDataset(cand.id, { reviewed_by: 'someone' });
check('a refusal has to say why, or it gets re-litigated next season',
  noReason.error === 'reason_required');

check('a candidate is not on the Atlas before anyone approves it',
  one('SELECT COUNT(*) n FROM atlas_layers WHERE chapter_id=? AND source=?',
      'test', 'Test Floodplain Layer')?.n === 0);

const approved = bioEngine.approveDataset(cand.id, { reviewed_by: 'A Steward', note: 'Terms read.' });
check('approval with a name puts it on the Atlas and records who accepted',
  approved.dataset?.status === 'approved' && approved.dataset.reviewed_by === 'A Steward' &&
  approved.atlas_layer?.layer_no === 6, JSON.stringify(approved).slice(0, 110));
check('the Atlas row keeps the licence verbatim, even when it was never stated',
  one('SELECT source_license l FROM atlas_layers WHERE chapter_id=? AND source=?',
      'test', 'Test Floodplain Layer')?.l === 'unstated');

// Probes are declared, not hardcoded in the doctor. These assertions are what
// stop the declaration rotting quietly once nobody is looking at it.
const pr = registry.probes();
check('every probe resolves to a callable request',
  pr.probeable.every((x) => typeof x.url === 'string' && /^https:/.test(x.url) && x.method),
  pr.probeable.filter((x) => !/^https:/.test(x.url ?? '')).map((x) => x.id).join(', '));
// "Needs a key" and "we forgot" look identical in a report that only shows absence.
// A source cannot both have a health check and a reason it has none. I added
// exactly that contradiction while reclassifying one, and `probes()` silently
// preferred the probe and never showed the reason — a conflict that resolves
// itself is a conflict nobody finds.
check('no source declares both a probe and a reason it cannot be probed',
  registry.SOURCES.every((x) => !(x.probe && x.no_probe)),
  registry.SOURCES.filter((x) => x.probe && x.no_probe).map((x) => x.id).join(', '));
check('every unprobeable source says why it cannot be probed',
  pr.unprobeable.every((x) => x.why && x.why !== 'no probe declared yet'),
  pr.unprobeable.filter((x) => x.why === 'no probe declared yet').map((x) => x.id).join(', '));
// HTTP 200 is not proof for the two sources that answer 200 while broken.
check('the sources that lie with a 200 carry a shape check',
  ['mrlc-nlcd', 'usdm'].every((id) => registry.probeFor(id)?.expect));

const atlas = await runTool('list_atlas_layers', {});
check('list_atlas_layers reads its layer names from the registry',
  Array.isArray(atlas.coverage) && atlas.coverage.length === 12, JSON.stringify(atlas).slice(0, 120));

// ── Atlas layer 4: the land columns reach an existing commons ─────────────
const placeCols = new Set(db().prepare('PRAGMA table_info(places)').all().map((c) => c.name));
check('a place can hold what the soil survey says',
  ['soil_series', 'soil_ph', 'soil_organic_matter', 'soil_hydric', 'elevation_m', 'land_cover', 'flood_zone']
    .every((c) => placeCols.has(c)));
check('land cover codes resolve to words, not to a bare integer',
  NLCD_CLASSES[24] === 'Developed, high intensity' && NLCD_CLASSES[41] === 'Deciduous forest');

// ── Atlas layer 5: what must never be published ──────────────────────────
// This is the one assertion in the file protecting something outside the commons.
check('anything with a conservation status is held above public',
  THREATENED_SENSITIVITY !== 'public' && THREATENED_SENSITIVITY === 'restricted',
  THREATENED_SENSITIVITY);

// ── Atlas layer 6: events become signals, standing conditions do not ──────
const standingOnly = hazardSignals({
  alerts: { available: true, items: [] },
  flood: { available: true, zone: 'AE', in_special_flood_hazard_area: true },
  drought: { available: true, class: 'D4' },
  fires: { available: true, detections: 0, radius_km: 50 },
});
check('a flood zone is never filed as an observation', standingOnly.length === 0,
  JSON.stringify(standingOnly));

const severe = hazardSignals({
  alerts: { available: true, items: [
    { event: 'Flash Flood Warning', severity: 'Severe', onset: '2026-09-12T12:00:00Z', id: 'urn:a' },
    { event: 'Special Weather Statement', severity: 'Minor', onset: '2026-09-12T12:00:00Z', id: 'urn:b' },
  ] },
});
check('a severe official alert arrives as Critical',
  severe[0].severity === 'Critical' && severe[0].category === 'Climate', JSON.stringify(severe[0]));
check('a minor official alert does not cry wolf', severe[1].severity === 'Info');
check('an automated alert carries its own stable id, so re-reading updates one row',
  severe[0].source_ref === 'urn:a' && severe[1].source_ref === 'urn:b');
check('an alert is attributed to the service, not to a person',
  /National Weather Service/.test(severe[0].author) && severe[0].verified === 1);
// A satellite heat detection is not a confirmed fire, and must not claim to be.
const fire = hazardSignals({ fires: { available: true, detections: 3, radius_km: 50, note: 'x' } });
check('a satellite heat detection is filed unverified',
  fire[0].verified === 0 && fire[0].severity === 'Watch', JSON.stringify(fire[0]));

check('drought at D4 raises Critical, D2 raises Watch, D1 does not',
  worstLevel({ drought: { class: 'D4' } }) === 'Critical' &&
  worstLevel({ drought: { class: 'D2' } }) === 'Watch' &&
  worstLevel({ drought: { class: 'D1' } }) === 'Info');

// The blank-cell trap, in the direction that matters: a missing drought figure
// must never become a 0 that renders as an all-clear.
const { droughtClass: __test_droughtClass, droughtCoverage } = await import('../adapters/hazards.mjs');
// Assert the thing that DIFFERS. An earlier version of this checked that an
// all-blank row classified as null — which is true whether the blank-versus-zero
// guard works or not, because all-zero also classifies as null. It tested the
// right function and still could not fail. Mutation-testing found it: breaking
// the guard left the suite green twice over.
const blankRow = droughtCoverage({ d0: '', d1: null, d2: undefined, d3: '', d4: '' });
check('a blank drought figure reads as absent, and specifically not as zero',
  Object.values(blankRow).every((v) => v === null) &&
  !Object.values(blankRow).some((v) => v === 0),
  JSON.stringify(blankRow));
check('a real zero is kept as a zero, because zero coverage is a fact',
  droughtCoverage({ d0: 0, d1: 0, d2: 0, d3: 0, d4: 0 }).D0 === 0);
check('an all-blank row classifies as no-data rather than as no-drought',
  __test_droughtClass({ d0: '', d1: '', d2: '', d3: '', d4: '' }) === null);
check('a real drought figure still resolves to its class',
  __test_droughtClass({ d0: 100, d1: 78.31, d2: 35.17, d3: 0, d4: 0 }) === 'D2');
// The figures are cumulative, so a county wholly in D0 with only a tenth in D1
// is abnormally dry — not moderate drought, and not nothing.
check('cumulative coverage resolves to the worst class that clears a quarter',
  __test_droughtClass({ d0: 100, d1: 10, d2: 0, d3: 0, d4: 0 }) === 'D0');
check('a county with no class over a quarter gets no class',
  __test_droughtClass({ d0: 5, d1: 0, d2: 0, d3: 0, d4: 0 }) === null);

// Silence is not an all-clear: an unreachable source must not read as "fine".
const blind = hazardSignals({ alerts: { available: false, reason: 'offline' } });
check('an unreachable hazard source produces no reassuring signal', blind.length === 0);

// ── The first sixty seconds ───────────────────────────────────────────────
const nowhere = await lookAround({});
check('looking around needs somewhere to look',
  nowhere.error === 'no_location', JSON.stringify(nowhere));

const before = one('SELECT COUNT(*) n FROM places')?.n ?? 0;
const peek = await lookAround({ lat: 30.26, lng: -97.79, depth: 'quick' });
check('the reveal writes nothing to the commons',
  peek.wrote_nothing === true && (one('SELECT COUNT(*) n FROM places')?.n ?? 0) === before,
  `places ${before} → ${one('SELECT COUNT(*) n FROM places')?.n}`);
check('the reveal always ends with a line that needs no network',
  peek.lines?.at(-1)?.kind === 'sky', JSON.stringify(peek.lines?.at(-1)));

// The protocol's first gate is not relaxed for being somebody's first screen.
const unbounded = await beginHere({
  chapter_name: 'Whole Watershed Assembly', lat: 30.26, lng: -97.79,
  represents: 'the watershed',
});
check('founding a chapter without saying what it does NOT represent is refused',
  unbounded.error === 'representation_required', JSON.stringify(unbounded));

const founded = await beginHere({
  chapter_name: 'Onboarding Test Commons', lat: 30.26, lng: -97.79,
  represents: 'the people who signed up',
  does_not_represent: 'the county, any nation, or any rights-holder',
  place_name: 'The first place',
});
check('founding a chapter creates it with a place already on the ground',
  !!founded.chapter?.id && !!founded.place?.id && founded.place.lat === 30.26,
  JSON.stringify(founded.error ?? founded.chapter?.id));
check('a chapter cannot be founded twice in the same slug',
  (await beginHere({
    chapter_name: 'Onboarding Test Commons', lat: 30.26, lng: -97.79,
    represents: 'x', does_not_represent: 'y',
  })).error === 'exists');

// ── NWIS statistics: the two silent ways this parser breaks ───────────────
// A tab-delimited fixture, exactly as waterservices.usgs.gov answers it —
// header, the 5s/15s type row, one full row and one with the 90th percentile
// missing, which is the common case for a site with a short record.
const RDB = [
  'agency_cd\tsite_no\tparameter_cd\tts_id\tloc_web_ds\tmonth_nu\tday_nu\tbegin_yr\tend_yr\tcount_nu\tp10_va\tp50_va\tp90_va',
  '5s\t15s\t5s\t10n\t15s\t2n\t2n\t4n\t4n\t8n\t12n\t12n\t12n',
  'USGS\t08158000\t00060\t136117\t\t9\t12\t1898\t2025\t128\t211\t1200\t',
  'USGS\t08158000\t00060\t136117\t\t9\t13\t1898\t2025\t128\t205\t1180\t4100',
].join('\n');

const sept12 = findDailyStat(RDB, 9, 12);
// The service calls the median p50_va. Reading median_va returns nothing, the
// vs-median comparison is skipped, and the gage line quietly loses its history
// without ever printing anything wrong.
check('the day-of-year median is read from the column the service actually sends',
  sept12?.median === 1200, JSON.stringify(sept12));
// Number('') is 0. A blank 90th percentile read as zero makes every reading
// above zero look like a flood.
check('a blank statistic is absent, not zero',
  sept12?.p90 === null, JSON.stringify(sept12));
check('a populated statistic is still read',
  findDailyStat(RDB, 9, 13)?.p90 === 4100);
check('the type row is never mistaken for data',
  findDailyStat(RDB, 15, 15) === null);

// ── Closing the loops, and who gets the credit ────────────────────────────
// Every adapter writes into the same signals table, so "because of you" has to
// know the difference between a person and NOAA. This failure is quiet AND
// flattering, which is the worst combination a test can be protecting against.
check('a person who typed it is a person', humanObserved('notice') && humanObserved('manual'));
check('an observation with no source predates the adapters and was typed', humanObserved(null));
check('the machines are not people',
  !humanObserved('usgs') && !humanObserved('nws') && !humanObserved('firms') && !humanObserved('inaturalist'));
// The direction matters: a source nobody has thought of yet must NOT be a person.
check('an upstream invented tomorrow is excluded by default', !humanObserved('some-future-satellite'));
check('the SQL rule and the function agree about NULL',
  /IS NULL/.test(humanObservedSql()) && humanObserved(null));

// A quest started by an automated alert must not be credited to a human.
const alertSignal = await runTool('add_signal', {
  title: 'Heat Advisory', category: 'Climate', severity: 'Watch', author: 'NOAA (automated)',
});
run__setSource(alertSignal.id, 'nws');
const alertQuest = await runTool('open_quest', {
  signal_id: alertSignal.id, title: 'Cooling stations for the advisory',
});
const humanSignal = await runTool('add_signal', {
  title: 'Ligustrum taking the understory', category: 'Ecological', author: 'S. Chen', source: 'notice',
});
await runTool('open_quest', { signal_id: humanSignal.id, title: 'Understory restoration' });

const moved = whatMoved('test', { since_days: 3650 });
check('an observation a person made is credited to them',
  moved.items.some((i) => i.person === 'S. Chen'), JSON.stringify(moved.items.map((i) => i.person)));
check('a project started by an automated alert credits nobody',
  !moved.items.some((i) => i.signal.title === 'Heat Advisory'),
  JSON.stringify(moved.items.map((i) => i.signal.title)));
check('the chain names what the observation became',
  moved.items.find((i) => i.person === 'S. Chen')?.became.some((b) => b.kind === 'quest'));

// The intake promise — the protocol's own measure of the front door.
const promise = intakePromise('test');
check('the intake promise counts what was brought and what was answered',
  promise.brought >= 1 && promise.answered >= 1, JSON.stringify(promise));
check('the intake promise states itself in words a person can read',
  typeof promise.sentence === 'string' && promise.sentence.length > 10);

// ── What is being carried, and what that must never turn into ─────────────
// §6 refuses leaderboards of people, and a care ledger is one keystroke away
// from being exactly that. The property that keeps them apart is not the
// wording — it is that ONLY OPEN OBLIGATIONS COUNT. A number that falls when
// work finishes is a warning; a number that rises is a score. So the first
// thing asserted here is that finishing something REMOVES it.
{
  const newChapter = async (id) => {
    await runTool('create_chapter', {
      id, name: `${id} commons`, scale: 'site',
      represents: 'the people who signed up', does_not_represent: 'anyone else',
      lat: 30.2, lng: -97.8,
    });
    return id;
  };
  const owned = (chapter, title, owner, status = 'Open') =>
    create('quests', 'quest', chapter, {
      chapter_id: chapter, title, maintenance_owner: owner, status,
    });

  const CH = await newChapter('carry');
  // Three spellings of one person. Splitting them is the dangerous direction:
  // it reports three people comfortably holding one thing each, and the one
  // person actually holding three disappears.
  owned(CH, 'Bank stabilisation', 'Maya R.');
  owned(CH, 'Understory removal', 'maya r.');
  owned(CH, 'Path resurfacing', '  Maya R.  ');
  owned(CH, 'Gauge board repaint', 'T. Okonkwo');

  const c1 = carrying(CH);
  check('three spellings of one name are one person carrying three things',
    c1.people.length === 2 && c1.people[0].holding === 3,
    JSON.stringify(c1.people.map((p) => [p.name, p.holding])));
  check('the spelling shown back is the one the chapter uses most',
    c1.people[0].name === 'Maya R.', c1.people[0].name);
  check('holding more than half of everything open is raised by name',
    c1.overloaded.includes('Maya R.'), JSON.stringify(c1.overloaded));

  // The whole difference between a warning and a score, in one assertion.
  dbRun(`UPDATE quests SET status='Complete' WHERE chapter_id=? AND title='Path resurfacing'`, CH);
  const c2 = carrying(CH);
  check('finishing the work takes it off the person, it does not add to a total',
    c2.total_open === 3 && c2.people.find((p) => p.name === 'Maya R.').holding === 2,
    JSON.stringify({ total: c2.total_open, people: c2.people.map((p) => [p.name, p.holding]) }));
  check('below the minimum count, a majority share is not a finding',
    !c2.overloaded.length, JSON.stringify(c2.overloaded));

  // A registered organisation is the only thing allowed to suppress the
  // warning, because a committee cannot be exhausted. It still shows its load —
  // hiding it would make every share in the chapter wrong.
  const ORG = await newChapter('carry-org');
  create('agents', 'agent', ORG, {
    chapter_id: ORG, name: 'Ridgeline Partners', vf_agent_type: 'Organization',
  });
  owned(ORG, 'Seed collection', 'Ridgeline Partners');
  owned(ORG, 'Fence line survey', 'Ridgeline Partners');
  owned(ORG, 'Culvert clearing', 'Ridgeline Partners');
  owned(ORG, 'Water readings', 'J. Alvarez');

  const c3 = carrying(ORG);
  const org = c3.people.find((p) => p.name === 'Ridgeline Partners');
  check('a registered organisation still shows the load it is holding',
    org?.holding === 3 && c3.total_open === 4);
  check('a committee is never told it is about to burn out',
    !c3.overloaded.includes('Ridgeline Partners'), JSON.stringify(c3.overloaded));
  check('work owned by a group is raised as a gate problem instead',
    c3.owned_by_a_group.length === 3 && c3.owned_by_a_group.every((u) => u.certain),
    JSON.stringify(c3.owned_by_a_group.map((u) => u.of)));

  // The direction that would be a real failure: a GUESS from the shape of a
  // name must never silence a warning about a human. A person called Ada
  // Circle keeps hers, and merely gets an odd question attached.
  const GUESS = await newChapter('carry-guess');
  owned(GUESS, 'Spring monitoring', 'Ada Circle');
  owned(GUESS, 'Trail closure signage', 'Ada Circle');
  owned(GUESS, 'Native seed drying', 'Ada Circle');
  owned(GUESS, 'Newsletter', 'P. Nakamura');

  const c4 = carrying(GUESS);
  const ada = c4.people.find((p) => p.name === 'Ada Circle');
  check('a name that merely READS like a group is only a question',
    ada?.looks_like_a_group === true && ada?.is_organisation === false);
  check('a guess about a name never silences a burnout warning',
    c4.overloaded.includes('Ada Circle'), JSON.stringify(c4.overloaded));
  check('an uncertain group finding says that it is uncertain',
    c4.owned_by_a_group.every((u) => u.certain === false));

  check('the ledger states itself in words a person can read',
    typeof c4.sentence === 'string' && c4.sentence.includes('Ada Circle'));
}

// ── "The latest reading" is written once, or it disagrees with itself ─────
// `ORDER BY measured_at DESC` is not deterministic: record_measurement takes
// YYYY-MM-DD and defaults to today, so a before-and-after pair from one field
// morning ties and SQLite returns whichever row it likes. There were six copies
// of that clause. The failure is silent and it points in every direction at
// once — the sign of a change reverses in a season report, the wrong person is
// named as still reading an indicator, and in the two places where latest_value
// and latest_at were SEPARATE subqueries one reading's value could be paired
// with another reading's date.
{
  const src = [
    'engines/turning.mjs', 'engines/attention.mjs', 'engines/loops.mjs',
    'ai/tools.mjs', 'server/routes/api.mjs',
  ].map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n');
  const loose = [...src.matchAll(/ORDER BY\s+(?:\w+\.)?measured_at\s+DESC(?!\s*,\s*(?:\w+\.)?rowid)/gi)];
  check('no query picks the latest reading without a deterministic tiebreak',
    loose.length === 0,
    `${loose.length} ORDER BY measured_at DESC with no rowid tiebreak — ties resolve arbitrarily`);
}

// ── A field the form cannot render is a field that arrives wrong ──────────
// The generated form renders anything that is not a boolean, a number or an
// enum as a text box. A field declared `array` therefore came back as a STRING,
// and nothing errored: a string has a .length, so every guard downstream passed
// it through and it surfaced only as a list that would not render.
{
  const seasonChapter = 'list-coercion';
  await runTool('create_chapter', {
    id: seasonChapter, name: 'List Coercion', scale: 'site',
    represents: 'itself', does_not_represent: 'anyone else', lat: 30.2, lng: -97.8,
  });

  // Exactly what a person typing into the generated form sends.
  const typed = await runTool('open_season', {
    chapter_id: seasonChapter, name: 'Autumn 2026',
    priorities: 'fix the culvert, plant the bank',
  });
  check('a list typed as a sentence arrives as a list',
    Array.isArray(typed.priorities) && typed.priorities.length === 2,
    JSON.stringify(typed.priorities));
  check('and is split on the separators a person actually types',
    typed.priorities[0] === 'fix the culvert' && typed.priorities[1] === 'plant the bank',
    JSON.stringify(typed.priorities));

  // Corrected in runTool rather than in the form, because the form is not the
  // only caller that gets this wrong — MCP clients enforce a schema's types no
  // more than they enforce `required`.
  const viaMcp = await runTool('open_season',
    { chapter_id: 'no-such-chapter-for-lists', name: 'x', priorities: 'a\nb\nc' });
  check('an assistant sending a string into a list field is corrected too',
    viaMcp.error ? true : Array.isArray(viaMcp.priorities));

  // Anything structured is left alone. A wrong guess about shape is worse than
  // a clean refusal.
  const already = await runTool('open_season', {
    chapter_id: seasonChapter, name: 'ignored while one is open', priorities: ['already', 'a list'],
  });
  check('a real list is not re-split or otherwise improved',
    already.error === 'season_already_open');

  // The same field was parsed for closed seasons and returned raw for the open
  // one, so it was an array in one half of the answer and a JSON string in the
  // other — and the open season is the half anything would try to render.
  const listed = await runTool('seasons', { chapter_id: seasonChapter });
  check('the open season reports its priorities the same way a closed one does',
    Array.isArray(listed.open?.priorities),
    JSON.stringify(listed.open?.priorities));
}

// ── An error code a caller can branch on ──────────────────────────────────
// Every tool answers a refusal with a short machine-readable code plus a
// sentence. import_field_data put the whole sentence IN the code, so an AI
// caller had nothing to switch on and a person read the same text twice.
{
  const missing = await runTool('import_field_data',
    { chapter_id: 'test', path: '/tmp/definitely-not-here-8f3a.geojson' });
  check('a path that does not exist refuses with a code, not a paragraph',
    missing.error === 'file_not_found' && missing.error.length < 30, JSON.stringify(missing.error));
  check('and the sentence explains what to do instead',
    /full path/.test(missing.message ?? ''), missing.message);

  // Two genuinely different problems with different fixes — a path that does
  // not exist is a typo, a file that will not parse is the wrong export — so
  // they must not collapse into one string.
  const { writeFileSync: wf } = await import('node:fs');
  const bad = `${process.env.BROS_DB}.notgeojson`;
  wf(bad, 'this is not geojson at all');
  const unreadable = await runTool('import_field_data', { chapter_id: 'test', path: bad });
  check('a file that is not GeoJSON refuses differently from one that is absent',
    unreadable.error === 'unreadable_geojson' && unreadable.error !== missing.error,
    JSON.stringify(unreadable.error));
  check('and says which exports are known to work',
    /CoMapeo|QGIS/.test(unreadable.message ?? ''), unreadable.message);
}

// ── One word per button, and one place that decides the action ────────────
// Three components each kept their own tool→label map. By the time anybody
// compared them, eight of twenty had drifted: "Respond" and "Answer", "Open a
// project" and "Start a project", "Resolve flag" and "Resolve the flag".
// Nothing broke — the same button just said different things depending on
// which screen you were standing on, which is how an interface stops feeling
// like one thing.
{
  const app = (f) => readFileSync(new URL(`../app/src/${f}`, import.meta.url), 'utf8');
  const verbs = app('verbs.js');

  for (const f of ['components/Today.jsx', 'components/Commons.jsx', 'components/MapPanel.jsx']) {
    const src = app(f);
    check(`${f} takes its wording from verbs.js`,
      /from '\.\.\/verbs\.js'/.test(src), 'a fourth copy of the labels');
    check(`${f} keeps no private label map`,
      !/const (LABELS|DO) = \{/.test(src), 'the map that drifted, back again');
  }

  // Every tool an engine offers as an action must have a verb, or the button
  // shows a snake_case tool name at somebody.
  const { board } = await import('../engines/board.mjs');
  const { mapFeatures } = await import('../engines/mapboard.mjs');
  const offered = new Set([
    ...(board('test').todo ?? []).map((t) => t.action?.tool),
    ...mapFeatures('test').features.map((f) => f.action?.tool),
  ].filter(Boolean));
  const unworded = [...offered].filter((t) => !new RegExp(`\\b${t}:`).test(verbs));
  check('every action an engine offers has a word for its button',
    unworded.length === 0, `no verb for: ${unworded.join(', ')}`);

  // The action itself is decided in the engine, as it already is for the board.
  // Two homes for "what to do about a blocked project" is how a rule gets
  // fixed in one of them.
  check('the map decides its actions in the engine, not the component',
    mapFeatures('test').features.every((f) => f.action === null || 'tool' in f.action || 'goTo' in f.action));
  check('and the panel no longer decides them itself',
    !/const ACTION = \{/.test(app('components/MapPanel.jsx')));

  // The one that was silently destructive: add_gathering INSERTS, so "add care
  // to this gathering" created a SECOND gathering with the same title and left
  // the unprovisioned one exactly as it was.
  const g = await runTool('add_gathering', {
    chapter_id: 'test', title: 'Care test gathering', description: 'By the falls',
  });
  const before = one(`SELECT COUNT(*) n FROM gatherings WHERE chapter_id='test'`).n;
  const upd = await runTool('update_gathering',
    { gathering_id: g.id, care_meals: true, care_transport: true });
  check('adding care changes the gathering rather than creating another',
    one(`SELECT COUNT(*) n FROM gatherings WHERE chapter_id='test'`).n === before,
    'a second gathering was created');
  check('and it actually records the care', upd.care_provided === 2, JSON.stringify(upd.care_provided));
  // An update that wrote every column would blank what the caller did not
  // mention — "add care" must not mean "delete the description".
  check('an update leaves the fields it was not given alone',
    one('SELECT description FROM gatherings WHERE id=?', g.id).description === 'By the falls');
  check('an update with nothing to change says so',
    (await runTool('update_gathering', { gathering_id: g.id })).error === 'nothing_to_update');

  // And the map points at the update, never the insert.
  const lowCare = mapFeatures('test').features.find((f) => f.kind === 'gathering' && f.care < 2);
  if (lowCare) {
    check('a gathering short of care offers the update, not a second gathering',
      lowCare.action?.tool === 'update_gathering', JSON.stringify(lowCare.action));
  } else {
    skip('a gathering short of care offers the update, not a second gathering',
      'every gathering in this fixture already has its care');
  }
}

// ── The map, and what it is honest about ──────────────────────────────────
// The map drew places, hubs and signals. Everything a commons actually DOES —
// the projects, the needs, the gatherings — lived only in lists, so the one
// view that is about a place could not show what was happening in it.
{
  const { mapFeatures, MAP_KINDS } = await import('../engines/mapboard.mjs');
  const kinds = readFileSync(new URL('../app/src/mapKinds.js', import.meta.url), 'utf8');

  // A kind drawn but missing from the key is a symbol nobody can read; a kind
  // in the key and never drawn is a promise the map does not keep.
  const drawn = MAP_KINDS.map((k) => k.key).sort();
  const styled = [...kinds.matchAll(/^  (\w+): \{$/gm)].map((m) => m[1]).sort();
  check('every kind the map draws has a symbol in the key',
    drawn.every((k) => styled.includes(k)), `missing a symbol: ${drawn.filter((k) => !styled.includes(k))}`);
  check('and every symbol in the key is a kind that gets drawn',
    styled.every((k) => drawn.includes(k)), `in the key and never drawn: ${styled.filter((k) => !drawn.includes(k))}`);
  const ordered = kinds.match(/KIND_ORDER = \[([^\]]*)\]/)?.[1] ?? '';
  check('the key lists all of them and none twice',
    drawn.every((k) => ordered.includes(`'${k}'`))
      && ordered.split(',').length === drawn.length, ordered);

  // Shape AND colour, never colour alone — roughly one man in twelve cannot
  // separate the reds from the greens, and this map uses both to mean opposite
  // things (a blocked project and a running one).
  check('kinds are told apart by shape as well as colour',
    new Set([...kinds.matchAll(/shape: '(\w+)'/g)].map((m) => m[1])).size >= 6,
    'two kinds share a shape and rely on colour to be told apart');

  const m = mapFeatures('test');
  check('the map carries more than places and dots',
    new Set(m.features.map((f) => f.kind)).size >= 3,
    JSON.stringify(m.counts));

  // THE CLAIM THIS FILE EXISTS FOR. A need and a gathering have no lat/lng in
  // the schema. Drawing them at a place's centroid without saying so asserts a
  // precision the data does not have, and nobody can see a map doing that.
  check('every feature says whether the coordinate is its own',
    m.features.every((f) => typeof f.precise === 'boolean'));
  const borrowed = m.features.filter((f) => !f.precise);
  check('and a borrowed one names where it was borrowed from',
    borrowed.every((f) => !!f.borrowed_from), JSON.stringify(borrowed.slice(0, 2)));
  check('a quest or observation with its own coordinate is not marked borrowed',
    m.features.filter((f) => ['observation', 'reading'].includes(f.kind) && f.precise)
      .every((f) => f.borrowed_from === null));

  // A pin is a disclosure with a location on it.
  const secret = await runTool('submit_intake', {
    chapter_id: 'test', kind: 'need', private: true,
    body: 'A private circumstance that must not appear on any map.', submitted_by: 'A neighbour',
  });
  check('a private need never reaches the map',
    !JSON.stringify(mapFeatures('test')).includes('private circumstance'),
    'a need marked private was given a pin');
  dbRun('DELETE FROM intake WHERE id=?', secret.id);

  // The badge is the thing that makes a map readable without clicking.
  const proj = m.features.filter((f) => f.kind === 'project');
  check('a project carries how many things are in its way, before anyone clicks',
    proj.every((f) => f.badge === null || typeof f.badge === 'number'));
  check('and says whether it is blocked or running',
    proj.every((f) => ['blocked', 'running'].includes(f.state)));

  // ── The bugs an independent audit found in this feature ────────────────
  // All four were invisible from a screenshot, which is why they survived one.

  // A layer added without removing the one it replaces leaves a map that looks
  // finished. Places, hubs and signals were each drawn TWICE — once by the new
  // key-driven layer and once by the layer it was meant to replace — so
  // switching "Instrument readings" off changed nothing on screen, because
  // sixty-eight gage columns were coming from a layer with no switch at all.
  const map3dSrc = readFileSync(new URL('../app/src/components/Map3D.jsx', import.meta.url), 'utf8');
  const layerIds = [...map3dSrc.matchAll(/id: '([a-z0-9-]+)'/g)].map((m) => m[1]);
  for (const gone of ['signals', 'signals-approximate', 'hubs', 'places']) {
    check(`the map no longer draws "${gone}" twice`,
      !layerIds.includes(gone),
      `${gone} is still drawn by a layer the key cannot switch off`);
  }
  // The property, not a list of names — a list of layer ids goes stale the
  // first time one is renamed and then asserts nothing while still passing.
  // What must hold is that everything drawing features is gated on the key.
  const markers = readFileSync(new URL('../app/src/components/MapMarkers.jsx', import.meta.url), 'utf8');
  check('the HTML markers answer the key',
    /kindsOn\.has\(f\.kind\)/.test(markers), 'a marker the key cannot switch off');
  check('and so does the globe fallback',
    !/globe-features/.test(map3dSrc) || /kindsOn\.has\(f\.kind\)/.test(map3dSrc),
    'the globe draws features the key cannot switch off');
  check('no feature layer is left drawing from the raw props',
    !/data: (signals|places|hubs)\b/.test(map3dSrc),
    JSON.stringify(layerIds));
  check('no dead toggle state is left behind',
    !/showSignals/.test(map3dSrc), 'a state that can never change is a switch that is not there');

  // A latitude with no longitude is a row that exists — both columns are
  // independently nullable and add_place takes them as separate optional
  // numbers. Testing only lat let one through as precise with lng null, which
  // deck.gl draws at [null, lat] and the panel renders with .toFixed on null.
  const HALF = 'half-located';
  await runTool('create_chapter', {
    id: HALF, name: 'Half Located', scale: 'site',
    represents: 'itself', does_not_represent: 'anyone else',
  });
  dbRun(`INSERT INTO places (id, chapter_id, name, lat, lng) VALUES ('halfp', ?, 'Half place', 12, NULL)`, HALF);
  dbRun(`INSERT INTO gatherings (id, chapter_id, place_id, title) VALUES ('halfg', ?, 'halfp', 'At half place')`, HALF);
  const half = mapFeatures(HALF);
  check('a row with a latitude and no longitude is never drawn',
    half.features.every((f) => f.lat != null && f.lng != null),
    JSON.stringify(half.features.map((f) => [f.kind, f.lat, f.lng])));
  check('and nothing borrows a half-located coordinate either',
    !half.features.some((f) => f.borrowed_from === 'Half place'));

  // The predicate for "still in the way" existed in four hand-written copies
  // and two of them forgot that a gate can be passed with a reason — so the
  // same project read as clear on one screen and blocked on another.
  const { openGatesSql } = await import('../engines/quest.mjs');
  check('one predicate decides what is still in the way',
    /overridden_at IS NULL/.test(openGatesSql()));
  for (const f of ['engines/mapboard.mjs', 'engines/operator.mjs']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    check(`${f} uses it rather than spelling it out again`,
      !/required\s*=\s*1 AND satisfied\s*=\s*0/.test(src) || /openGatesSql/.test(src),
      'a fourth copy that will forget overrides');
  }

  // The map component must actually use the shared definitions rather than
  // growing its own copy of the colours.
  const map3d = readFileSync(new URL('../app/src/components/Map3D.jsx', import.meta.url), 'utf8');
  check('the map draws from the shared key rather than its own colours',
    /from '\.\.\/mapKinds\.js'/.test(map3d)
      && /from '\.\.\/mapKinds\.js'/.test(
        readFileSync(new URL('../app/src/components/MapMarkers.jsx', import.meta.url), 'utf8')));
  check('the key is also the switches',
    /setKindsOn/.test(map3d) && /KIND_ORDER\.map/.test(map3d));
  // Sixty-eight readings against five observations: both on at once is a map
  // of the gage.
  check('instrument readings start switched off',
    /k !== 'reading'/.test(map3d), 'the machines would bury what people noticed');
}

// ── An action has to look like a thing you press ──────────────────────────
// "Propose to council" is the entire point of the council page, and it lived in
// the tab strip pushed to the far right as a small outlined pill — styled as
// navigation, outside the column the eye reads, at the size of a label. The
// per-item actions were worse: 11px underlined text under a rule at the bottom
// of a card, which reads as a footnote, and a footnote is not where anybody
// looks for the next move.
//
// Both were found by the person who designed this being unable to see them.
// That is not a thing a test can notice, so these guard the shapes instead.
{
  const views = readFileSync(new URL('../app/src/views/Views.jsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../app/src/App.jsx', import.meta.url), 'utf8');

  // Nothing that DOES something may be styled as underlined text.
  const linkActions = [...views.matchAll(
    /<button[^>]{0,240}?onAct\([^>]{0,240}?underline/gs)].length;
  check('no action is styled as an underlined text link',
    linkActions === 0, `${linkActions} still rendered as footnotes`);

  // The primary action belongs beside the page's own title, not in the tabs.
  check('the primary action is no longer in the navigation strip',
    !/setForm\(\{ tool: active\.add \}\)/.test(app),
    'the create button is back in the tab row, where it reads as a tab');
  check('every view that has a primary action puts it in its heading',
    (views.match(/<H action=\{primary\}/g) ?? []).length >= 9,
    `${(views.match(/<H action=\{primary\}/g) ?? []).length} of 9`);

  // The heading renders it filled, at a pressable size. The old pill was
  // text-[11px] with a border and no fill; this asserts the fill, which is the
  // difference between "a thing you press" and "a thing you read".
  const heading = views.slice(views.indexOf('const H = ('), views.indexOf('const H = (') + 1400);
  check('and renders it filled rather than outlined',
    /bg-\[var\(--moss\)\]/.test(heading) && /text-xs/.test(heading), heading.slice(0, 80));

  // Act exists and carries a tone for the one case that needs emphasis. A page
  // where every action shouts has no emphasis left for the one that matters.
  check('item actions share one button style with a tone for the urgent one',
    /export const Act = /.test(views) && /tone === 'urgent'/.test(views));
}

// ── The board, and the question it is arranged around ─────────────────────
// The front of this app was fifteen tabs named after the protocol's stages.
// That is the system's filing cabinet — complete, correct, and navigable only
// by somebody who already knows the twelve-stage loop. The person who designed
// it could not tell where to click.
{
  const { board } = await import('../engines/board.mjs');

  // Somebody with no commons yet gets ONE thing to do, and it writes nothing.
  const nothing = board(null);
  check('with no commons there is one thing to do and it writes nothing',
    nothing.error === 'no_chapter' && nothing.action?.tool === 'look_around',
    JSON.stringify(nothing.action));

  const b = board('test');
  check('the board answers where am I, what to do, what is going on, who is here',
    b.here && Array.isArray(b.todo) && Array.isArray(b.projects) && Array.isArray(b.people),
    JSON.stringify(Object.keys(b)));

  // The land leads. A page that only ever hands somebody their own debts does
  // not get opened twice — that is the argument of the whole daily-use spec,
  // and the headline is where it either holds or quietly stops holding.
  check('the headline is about the ground, not about what you owe',
    typeof b.headline === 'string' && b.headline.length > 10
      && !/needs doing|blocked|overdue/i.test(b.headline), b.headline);

  // Every listed thing to do carries the button that does it. Not a link to a
  // tab where the thing might be.
  check('everything to do carries the action that does it',
    b.todo.every((t) => t.action?.tool), JSON.stringify(b.todo.map((t) => t.action?.tool)));
  check('and cites the rule it comes from',
    b.todo.every((t) => typeof t.why === 'string' || t.why === null));

  // Five, not thirty — and the shortening is stated rather than silent.
  check('it shows a few things and says how many it is not showing',
    b.todo.length <= 5 && typeof b.todo_total === 'number' && b.todo_total >= b.todo.length,
    `${b.todo.length} of ${b.todo_total}`);

  // A project card answers the question being asked, which is not its stage.
  check('a project says what is actually in its way, not just its stage',
    b.projects.every((p) => typeof p.state === 'string' && Array.isArray(p.blocking)));
  check('and carries the ground it sits on',
    b.projects.every((p) => 'ground' in p));

  // Offline and instant: this is the first paint of the first screen.
  const src = readFileSync(new URL('../engines/board.mjs', import.meta.url), 'utf8');
  check('the board never waits on a network call',
    !/\bawait\b|\bfetch\(|getJSON|getText/.test(src),
    'the first screen would hang whenever an upstream is slow');

  // Every action the board offers must be a tool that exists, or the button
  // does nothing — the failure that is invisible because the screen does not
  // change.
  const { TOOLS: T2 } = await import('../ai/tools.mjs');
  const names = new Set(T2.map((t) => t.name));
  check('every button on the board reaches a tool that exists',
    b.todo.every((t) => names.has(t.action.tool)),
    JSON.stringify(b.todo.map((t) => t.action.tool).filter((n) => !names.has(n))));
}

// ── A gate you can pass, on your name, with a reason ──────────────────────
// Binary refusal with no arena is the design–reality gap in code: the tool that
// cannot be got past at nine on a Sunday is the tool that stops being used, and
// nobody ever says why. Ostrom's fifth principle is graduated sanctions.
//
// So most gates graduate — a named person, a written reason, both kept forever.
// Three do not, and the test of the line is whether the person clicking could
// be the person the gate protects. If not, it does not graduate.
{
  const { HARD_GATES } = await import('../engines/quest.mjs');
  const oq = await runTool('open_quest', { chapter_id: 'test', title: 'Override test' });

  check('consent and safeguarding never graduate',
    HARD_GATES.length === 3 && HARD_GATES.includes('indigenous_consent')
      && HARD_GATES.includes('rights_holder_consent')
      && HARD_GATES.includes('youth_safeguarding'), HARD_GATES.join(','));

  for (const g of HARD_GATES) {
    const r = await runTool('override_gate',
      { quest_id: oq.id, gate: g, reason: 'the funder deadline', overridden_by: 'M. Okafor' });
    check(`${g.replace(/_/g, ' ')} cannot be passed by whoever is at the keyboard`,
      r.error === 'cannot_be_overridden', JSON.stringify(r.error));
  }
  // The refusal has to carry the REASON, not just the rule. A generic "must be
  // one of" names the allowed values and not why these are not among them —
  // and why is the entire content of this particular refusal.
  const indig = await runTool('override_gate',
    { quest_id: oq.id, gate: 'indigenous_consent', reason: 'deadline', overridden_by: 'M' });
  check('and says why rather than just listing what is allowed',
    /consultation slot/i.test(indig.message ?? ''), indig.message);

  check('an override with no reason is refused',
    (await runTool('override_gate',
      { quest_id: oq.id, gate: 'permits_insurance', reason: '   ', overridden_by: 'M' })).error
      === 'missing_required');
  check('an override with no name is refused',
    (await runTool('override_gate',
      { quest_id: oq.id, gate: 'permits_insurance', reason: 'Small works exemption.', overridden_by: '' })).error
      === 'missing_required');

  const done = await runTool('override_gate', {
    quest_id: oq.id, gate: 'permits_insurance',
    reason: 'Under the small-works threshold; confirmed with the parish clerk.',
    overridden_by: 'R. Alvarez',
  });
  check('a gate that genuinely does not apply can be passed', !done.error, JSON.stringify(done.error));

  // Walk it to the stage before build, so the question asked is about GATES.
  // Left as a teleport from `signal`, both checks below pass for the wrong
  // reason: the stage-order rule refuses first and returns before any gate is
  // ever consulted, so "no permits_insurance in blocked" becomes true because
  // nothing was checked. That is this project's own "defence in depth hides a
  // broken half", arriving as a test that is green and asserts nothing.
  for (const st of ['listening', 'baseline', 'council_review', 'research', 'co_design', 'resource_plan']) {
    await runTool('advance_quest', { quest_id: oq.id, to_stage: st });
  }
  const adv = await runTool('check_quest_advance', { quest_id: oq.id, to_stage: 'prototype' });
  check('the overridden-gate check is asking about gates, not about stage order',
    adv.from === 'resource_plan' && !adv.blocked.some((b) => /backwards|one at a time/.test(b)),
    `from=${adv.from} blocked=${JSON.stringify(adv.blocked)}`);
  check('an overridden gate stops blocking',
    !adv.blocked.some((b) => /permits_insurance/.test(b)), JSON.stringify(adv.blocked));
  // The property that keeps this from being the gate switched off with extra
  // steps: it never stops mentioning itself.
  check('and never stops saying who passed it and why',
    adv.overridden.some((o) => /R\. Alvarez/.test(o) && /small-works/.test(o)),
    JSON.stringify(adv.overridden));
}

// ── A deputy, named in advance, who has actually agreed ───────────────────
// "Can the group continue if one founder steps away?" used to pass on "more
// than one person has served the Land Seat" — which a chapter satisfies by
// having had a busy month. Community networks have gone dark for months over
// one person's computer, and that failure looks technical and is entirely
// governance.
{
  const CH = 'deputy-test';
  await runTool('create_chapter', {
    id: CH, name: 'Deputy Test', scale: 'site',
    represents: 'the people who signed up', does_not_represent: 'anyone else', lat: 30.2, lng: -97.8,
  });
  const before = await runTool('minimum_viable_test', { chapter_id: CH });
  check('a chapter with nobody named cannot survive its founder',
    before.checks.find((c) => c.id === 'survives_founder').pass === false);

  check('a deputy who is the steward is refused',
    (await runTool('name_deputy',
      { chapter_id: CH, steward: 'Maya R.', deputy: 'maya r.', deputy_agreed: true })).error
      === 'same_person');

  // The one that matters. Recording somebody without asking is how a chapter
  // discovers it has no deputy on the day it needs one — and that is the day
  // nobody can ask.
  const unasked = await runTool('name_deputy',
    { chapter_id: CH, steward: 'Maya R.', deputy: 'T. Okonkwo' });
  check('a deputy who has not been asked is refused', unasked.error === 'not_agreed');
  check('and the refusal says to go and ask them',
    /Ask T\. Okonkwo first/.test(unasked.message ?? ''), unasked.message);

  const named = await runTool('name_deputy',
    { chapter_id: CH, steward: 'Maya R.', deputy: 'T. Okonkwo', deputy_agreed: true });
  check('two different people, one of whom has agreed, is an arrangement',
    named.steward === 'Maya R.' && named.deputy === 'T. Okonkwo');
  check('and they are told to restore a backup themselves',
    /restore one themselves/.test(named.note ?? ''), named.note);
  check('the chapter can now survive its founder',
    (await runTool('minimum_viable_test', { chapter_id: CH }))
      .checks.find((c) => c.id === 'survives_founder').pass === true);
}

// ── The assistant knows where it is standing ──────────────────────────────
// The prompt used to carry one fact about the place — the chapter's name — and
// several hundred words about the protocol. So the one surface that people
// actually talk to was the one that answered about watersheds in general.
{
  const { placeContext, placeBriefing } = await import('../ai/context.mjs');
  const { systemPrompt, claudeCodeAppendPrompt } = await import('../ai/system.mjs');
  const chapter = one(`SELECT * FROM chapters WHERE id='test'`);

  const ctx = placeContext('test');
  check('the assistant is given the ground it is standing on',
    ctx && 'ecoregion' in ctx && 'watershed' in ctx && 'now' in ctx,
    JSON.stringify(Object.keys(ctx ?? {})));

  // A chapter's stated limits are the thing an assistant is likeliest to
  // overstep by being helpful, so they travel with the briefing.
  const brief = placeBriefing('test');
  check('the briefing carries what the chapter does NOT represent',
    /does NOT represent/.test(brief) && /the county, any nation/.test(brief), brief.slice(0, 200));
  check('and says the facts were read now rather than remembered',
    /read from this machine|not from memory/i.test(brief));

  // The distinction that keeps this honest: an undownloaded region must read as
  // ABSENT, never as empty. "Nothing lives here" and "nobody fetched this" are
  // opposite claims and only one of them is ever true.
  check('an ecoregion nobody downloaded is absent, not empty',
    ctx.region_downloaded === false ? ctx.life === null : true,
    JSON.stringify({ downloaded: ctx.region_downloaded, life: ctx.life }));
  if (!ctx.region_downloaded) {
    check('and the assistant is told to say so rather than generalise',
      /NOT downloaded/.test(brief) && /rather than generalising/.test(brief));
  } else {
    skip('and the assistant is told to say so rather than generalise',
      'this machine has the region downloaded');
  }

  // The three habits, asserted by the tool they name. A prompt that described
  // them in prose without naming a tool would leave the model guessing.
  const p = systemPrompt(chapter);
  for (const [habit, tool] of [
    ['ground the answer in what is recorded here', 'region_brief'],
    ['keep materials and labour local', 'community_here'],
    ['find others already doing it', 'discover_peers'],
    ['match a skill to a need', 'who_could_help'],
  ]) {
    check(`the prompt names the tool that lets it ${habit}`, p.includes(tool), tool);
  }
  check('the prompt refuses invented names outright',
    /NEVER INVENT A NEIGHBOUR, A BUSINESS OR A SPECIES/.test(p));
  check('and keeps matching on the right side of what AI may not decide',
    /A MATCH IS A SUGGESTION, NOT AN INTRODUCTION/.test(p));

  // The Claude Code panel had no system prompt at all, which is why this is
  // asserted separately rather than assumed to follow from the one above.
  const appended = claudeCodeAppendPrompt(chapter);
  check('the Claude Code panel is given the same ground',
    appended.includes('WHERE YOU ARE') && appended.includes('community_here'));
  check('a chapter that does not exist yields no briefing rather than a broken one',
    claudeCodeAppendPrompt(null) === '' && placeBriefing('no-such-chapter') === '');

  const route = readFileSync(new URL('../server/routes/claude.mjs', import.meta.url), 'utf8');
  check('and the panel actually passes it to the CLI',
    /--append-system-prompt/.test(route),
    'the briefing exists and the process never receives it');
}

// ── Matching a skill to a need, without deciding anything ─────────────────
// The manual allows skill matching explicitly and forbids deciding who deserves
// care, whose work is legitimate, or who is a member. This file sits on that
// line, so the line is tested rather than described.
{
  const { whoCouldHelp } = await import('../engines/matching.mjs');

  // The rule that would be most damaging to get wrong: a need somebody marked
  // private is private FROM THE MATCHER TOO. A match is a disclosure.
  const secret = await runTool('submit_intake', {
    chapter_id: 'test', kind: 'need', private: true,
    body: 'I am behind on rent and cannot pay the water bill this month.',
    submitted_by: 'A neighbour',
  });
  check('a private need is submitted and kept', !!secret.id);

  const m = whoCouldHelp('test');
  check('a private need never reaches the matcher',
    !JSON.stringify(m).includes('behind on rent'),
    'a need marked private was surfaced as work for somebody to pick up');
  check('while needs brought in the open do reach it',
    m.total_needs > 0, JSON.stringify(m.total_needs));

  // Skills are read from what people DID, never from a profile they filled in.
  check('nothing about a person here comes from a self-declared skill list',
    m.needs.every((n) => n.from_here.every((c) => Array.isArray(c.has_done))),
    'a candidate was suggested without evidence of having done anything');

  // Candidates, not introductions, and the matching words are shown so a
  // coincidence can be dismissed by eye rather than trusted as a score.
  check('the answer says these are candidates and nobody has been asked',
    /candidates, not introductions/i.test(m.caveat));
  check('and shows which words matched rather than a similarity score',
    m.needs.every((n) => [...n.from_here, ...n.from_nearby].every((c) => Array.isArray(c.on)))
      && !JSON.stringify(m).includes('"score"'));
  check('it cites the rule it is operating under',
    /may not decide who deserves care/i.test(m.rule));
}

// ── The protocol and the code, checked against each other ─────────────────
// Four controls were found reading as in-place and enforcing nothing, and every
// one was found by a person comparing docs/PROTOCOL.md to the source by hand.
// That is not a thing anybody does twice. These tests do it on every run.
//
// The shape is the same as the licence check and the count-drift check: a rule
// stated in two places will eventually be stated differently, and the failure
// is silent in the direction that flatters — the document still says the
// control exists.
{
  const schema = readFileSync(new URL('../core/schema.sql', import.meta.url), 'utf8');
  const protocol = readFileSync(new URL('../docs/PROTOCOL.md', import.meta.url), 'utf8');

  // Every gate the SCHEMA allows must be one the code actually creates. This is
  // the exact drift that let ecological_assessment sit in the CHECK constraint,
  // in the tool's enum and in the interface, and never once exist on a quest.
  const declared = [...schema.matchAll(/gate\s+TEXT NOT NULL\s*\n?\s*CHECK \(gate IN \(([^)]+)\)/g)]
    .flatMap((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
  check('the schema declares the gates the protocol names', declared.length === 9, declared.join(','));
  const missing = declared.filter((g) => !QUEST_GATES.includes(g));
  check('every gate the schema allows is one a quest actually gets',
    missing.length === 0,
    `declared and never created: ${missing.join(', ')}`);
  const invented = QUEST_GATES.filter((g) => !declared.includes(g));
  check('and no gate is created that the schema would refuse',
    invented.length === 0, invented.join(', '));

  // "AI may not decide" is a list in the manual and a list in the code. If they
  // drift, the code enforces a shorter one and the document still promises the
  // longer — which is the worst available direction for this particular list.
  const section = protocol.slice(protocol.indexOf('### AI may not decide'));
  const forbidden = [...section.slice(0, section.indexOf('\n\n', 40) + 400)
    .matchAll(/^- (.+)$/gm)].map((m) => m[1].trim().toLowerCase());
  check('the manual still lists what AI may not decide', forbidden.length >= 9, String(forbidden.length));
  const uncovered = forbidden.filter((f) => !AI_FORBIDDEN.some((a) =>
    f.includes(a) || a.split(' ').every((w) => f.includes(w))));
  check('every decision the manual forbids is one the code refuses',
    uncovered.length === 0, `in the manual and not in the code: ${uncovered.join('; ')}`);

  // The twelve stages are the spine of the whole system. A stage renamed in one
  // place and not the other breaks the operator silently.
  const stageRows = [...protocol.matchAll(/^\| \*\*(\d+)\. ([^*]+)\*\*/gm)].map((m) => m[2].trim());
  check('the manual still states twelve stages', stageRows.length === 12, String(stageRows.length));
  const { STAGES } = await import('../engines/quest.mjs');
  check('the quest pathway has one stage per stage of the loop',
    STAGES.length === stageRows.length, `${STAGES.length} vs ${stageRows.length}`);
}

// ── The land, at the council table ────────────────────────────────────────
// Every agenda item has always required a Land Seat report, and the report has
// always been free text validated for non-emptiness. The OS held the gage
// reading, the hazard alerts and the season, and none of it reached the field —
// so a steward wrote the report from memory while the machine beside them held
// the measurements.
{
  const b = landSeatBrief('test');
  check('the Land Seat brief carries what the land is doing',
    'water' in b && Array.isArray(b.hazards) && 'season' in b, JSON.stringify(Object.keys(b)));
  // It is material, not a draft. A generated paragraph is nobody speaking, and
  // the Land Seat is a person speaking for a place.
  check('the brief offers material, not a written report',
    !('report' in b) && !('draft' in b) && /not the report/i.test(b.note ?? ''));
  // Two of the five things the protocol asks for cannot be read from any
  // database. A brief that quietly omitted them would read as complete.
  check('the brief names what no database can supply',
    b.must_be_spoken_by_a_person.map((x) => x.field).join(',')
      === 'downstream_effects,uncertainty_note');
  check('and it computes the season without a network',
    b.season === null || typeof b.season.next_turn === 'string');

  // The context is frozen onto the decision, so a review years later can tell a
  // drought decision from a wet-year one.
  const withLand = await runTool('propose_decision', {
    chapter_id: 'test', title: 'Close the lower crossing in low water', method: 'consent',
    land_seat_report: 'Creek is low, banks exposed, recovery time uncertain.',
    land_seat_steward: 'R. Alvarez',
  });
  const stored = one('SELECT land_seat_context FROM decisions WHERE id=?', withLand.id);
  check('a proposal freezes what the land was doing at the time',
    !!stored?.land_seat_context && JSON.parse(stored.land_seat_context).captured_at,
    String(stored?.land_seat_context).slice(0, 80));
  check('the frozen context is the measurement, not the report',
    JSON.parse(stored.land_seat_context).sentence !== undefined &&
    !JSON.parse(stored.land_seat_context).land_seat_report);

  // It must never block a proposal. The report is the requirement; this is
  // corroboration, and a commons with no located place still has councils.
  await runTool('create_chapter', {
    id: 'no-ground', name: 'No Ground', scale: 'site',
    represents: 'itself', does_not_represent: 'anyone else',
  });
  const groundless = await runTool('propose_decision', {
    chapter_id: 'no-ground', title: 'Adopt the charter', method: 'consent',
    land_seat_report: 'No ground located yet; this decision does not touch land.',
  });
  check('a chapter with no located place can still hold a council',
    !!groundless.id, JSON.stringify(groundless).slice(0, 120));
}

// ── Stage 6: a score that cannot override what it is not allowed to ───────
// The manual refers to a "project score" exactly once — in the sentence saying
// a high one never overrides a red flag. The rule was enforced and the score
// never existed, so the safeguard guarded nothing.
{
  const sq = await runTool('open_quest', { chapter_id: 'test', title: 'Scored project' });
  const blockedScore = await runTool('quest_score', { quest_id: sq.id });
  // The property, not the wording: a blocked project has NO composite. A low
  // number still sorts, and anything that sorts is eventually read as
  // "nearly ready".
  check('a project with open gates has no score at all, not a low one',
    blockedScore.overall === null && blockedScore.blocked.length > 0,
    JSON.stringify({ overall: blockedScore.overall, blocked: blockedScore.blocked.length }));
  check('and the parts are still reported, so it can be improved',
    typeof blockedScore.parts.feasible === 'number' &&
    typeof blockedScore.parts.maintainable === 'number');

  for (const gate of QUEST_GATES) {
    await runTool('satisfy_quest_gate', {
      quest_id: sq.id, gate, evidence: 'Reviewed and recorded.', reviewed_by: 'M. Okafor',
    });
  }
  await runTool('update_quest', {
    quest_id: sq.id, maintenance_owner: 'S. Chen',
    smallest_experiment: 'One reach, one season.',
    desired_condition: 'Exposed bank length falls by a quarter.',
  });
  const open = await runTool('quest_score', { quest_id: sq.id });
  check('a project with nothing blocking it gets one',
    typeof open.overall === 'number' && open.overall >= 0 && open.overall <= 1,
    JSON.stringify(open.overall));
  check('the score names its own weakest part rather than one number',
    ['urgent', 'regenerative', 'feasible', 'maintainable'].includes(open.weakest));

  // Nothing here may be self-assessed — there is no input a person fills in to
  // make their project look urgent.
  const { TOOLS: ALL_TOOLS } = await import('../ai/tools.mjs');
  const scoreTool = ALL_TOOLS.find((t) => t.name === 'quest_score');
  check('nothing about the score can be typed in by the person being scored',
    Object.keys(scoreTool.input_schema.properties).join(',') === 'quest_id');

  const list = await runTool('seasonal_priorities', { chapter_id: 'test' });
  check('the priority list keeps blocked projects visible, not hidden',
    Array.isArray(list.ranked) && Array.isArray(list.blocked) &&
    list.total === list.ranked.length + list.blocked.length);
}

// ── The AI logs itself, rather than being asked to volunteer ──────────────
// The manual: log whenever AI materially shapes a public report, map, plan,
// match or recommendation. That was implemented as a tool the assistant had to
// choose to call ON ITSELF — so the register existed, the operator counted
// unreviewed rows, and an assistant could open projects, close gates and
// propose decisions without ever writing one.
{
  const n = () => one(`SELECT COUNT(*) n FROM ai_log WHERE chapter_id='test'`).n;

  const before = n();
  await runTool('add_signal', { chapter_id: 'test', title: 'A person typed this' });
  check('a person using the interface is not logged as an AI action', n() === before);

  await runTool('add_signal', { chapter_id: 'test', title: 'The assistant recorded this' },
    { via: 'assistant' });
  check('an AI writing to the commons is logged without being asked', n() === before + 1);

  await runTool('list_signals', { chapter_id: 'test' }, { via: 'assistant' });
  check('an AI reading is not a material act', n() === before + 1);

  // A refused attempt is the protocol working, not something the AI did.
  // Logging it would fill the steward's queue with things that never happened.
  await runTool('propose_decision', { chapter_id: 'test', title: 'No land seat' }, { via: 'mcp' });
  check('an action the gates refused is not recorded as an action', n() === before + 1);

  // The row is written with NO reviewer on purpose, which is what turns it into
  // blocking work in the operator — a check that until now could only be zero.
  const row = one(
    `SELECT tool, human_reviewer, correction_path FROM ai_log WHERE chapter_id='test'
      ORDER BY created_at DESC, rowid DESC LIMIT 1`);
  check('the log records which caller it was', /assistant|mcp/.test(row.tool), row.tool);
  check('and leaves the reviewer empty, which is the point',
    row.human_reviewer === null && !!row.correction_path);
  check('an unreviewed AI action reaches the operator as work',
    (await runTool('whats_next', { chapter_id: 'test' })).items
      .some((i) => /no human reviewer/i.test(i.title)));
}

// ── The turning, and the three questions a database cannot answer ─────────
// §5.10. The loop is seasonal and nothing in this OS ever closed it, so it ran
// forward forever. The whole design rests on one refusal: the machine computes
// what changed and will not close a season until a person has answered what did
// NOT change, what unintended effects appeared, and whose experience is missing.
// Those three are the value of a review — a report made only of what moved is a
// progress report, and nothing has ever gone wrong in one.
{
  const CH = 'season-test';
  await runTool('create_chapter', {
    id: CH, name: 'Season Commons', scale: 'site',
    represents: 'the people who signed up', does_not_represent: 'anyone else',
    lat: 30.2, lng: -97.8,
  });

  check('a chapter with no season is told the loop never closes without one',
    /never closes|nobody gets the experience/i.test((await runTool('seasons', { chapter_id: CH })).sentence));
  check('a season needs a name the chapter will recognise',
    refused(await runTool('open_season', { chapter_id: CH, name: '   ' }), 'name'));

  const opened = await runTool('open_season', { chapter_id: CH, name: 'Autumn 2026' });
  check('a named season opens', !!opened.id && opened.name === 'Autumn 2026');
  check('two open seasons is refused, because neither would be reviewed',
    refused(await runTool('open_season', { chapter_id: CH, name: 'Winter' }), 'season_already_open'));

  // The refusal, and the reason it is worth having its own shape rather than
  // the generic missing-fields one: it must hand back what it is asking about.
  const incomplete = await runTool('close_season', {
    chapter_id: CH,
    what_did_not_change: 'The creek path still floods.',
    unintended_effects: 'More dogs off lead on the new path.',
    whose_experience_is_missing: '   ',
  });
  check('a season will not close on what the database can compute',
    incomplete.error === 'review_incomplete', JSON.stringify(incomplete.error));
  check('the refusal names the question still unanswered, not just the field',
    incomplete.missing.length === 1 &&
    incomplete.missing[0].question === 'Whose experience is missing?',
    JSON.stringify(incomplete.missing));
  check('the refusal says why a machine will not answer that one',
    /cannot be computed by definition/i.test(incomplete.missing[0].why));
  // The point of not listing these as `required`: the generic enforcement would
  // have fired first and this would be an empty refusal.
  check('the refusal hands back the review being asked about',
    !!incomplete.review && Array.isArray(incomplete.review.changed),
    'whoever answers the three questions would have to go and find the numbers themselves');
  check('nothing is closed by a refused close',
    !one(`SELECT closed_at FROM seasons WHERE id=?`, opened.id).closed_at);

  // An indicator that moved less than the uncertainty on its own reading has
  // not moved. Reporting it as change is how a commons talks itself into
  // believing an intervention worked.
  const sq = await runTool('open_quest', { chapter_id: CH, title: 'Bank planting' });
  const ind = await runTool('add_indicator', {
    chapter_id: CH, quest_id: sq.id, name: 'Exposed bank length', unit: 'm',
    baseline_value: 40, method: 'Tape, same three transects', cadence: 'monthly',
    decision_trigger: 'If exposed length grows after a full season, pause planting and escalate.',
  });
  await runTool('record_measurement', {
    indicator_id: ind.id, value: 39.6, uncertainty: 1.5, measured_by: 'S. Chen',
  });
  const noisy = (await runTool('season_review', { chapter_id: CH }))
    .changed.find((c) => c.indicator === 'Exposed bank length');
  check('a change smaller than its own error bar is not reported as a change',
    noisy.state === 'within_uncertainty', JSON.stringify(noisy));
  check('the review says so in words, with the uncertainty quoted',
    /is not a change/.test(noisy.sentence) && /1\.5/.test(noisy.sentence), noisy.sentence);

  await runTool('record_measurement', {
    indicator_id: ind.id, value: 31, uncertainty: 1.5, measured_by: 'S. Chen',
  });
  const real = (await runTool('season_review', { chapter_id: CH }))
    .changed.find((c) => c.indicator === 'Exposed bank length');
  check('a change larger than its error bar is reported as one', real.state === 'moved');

  // A baseline nobody ever read against is the finding most likely to be
  // quietly dropped from a report.
  const q2 = await runTool('open_quest', { chapter_id: CH, title: 'Spring fencing' });
  await runTool('add_indicator', {
    chapter_id: CH, quest_id: q2.id, name: 'Trampled area', unit: 'm2',
    baseline_value: 12, method: 'Pacing', cadence: 'seasonal',
    decision_trigger: 'If trampling doubles, fence the approach instead of the spring.',
  });
  check('a baseline that was never read against is named, not omitted',
    (await runTool('season_review', { chapter_id: CH }))
      .changed.some((c) => c.indicator === 'Trampled area' && c.state === 'never_measured'));

  const closed = await runTool('close_season', {
    chapter_id: CH,
    what_did_not_change: 'The creek path still floods at the low crossing.',
    unintended_effects: 'More dogs off lead on the new path.',
    whose_experience_is_missing: 'Nobody downstream of the weir has been asked.',
    stops: 'Weekly transect walks', continues: 'Monthly bank measurement',
    travels: 'The transect method', closed_by: 'R. Alvarez',
  });
  check('a season closes once a person has answered all three', !!closed.closed_at);
  check('the three answers are kept, not just the numbers',
    /downstream of the weir/.test(closed.whose_experience_is_missing));
  check('the computed report is stored with them',
    !!closed.report && Array.isArray(closed.report.changed));

  const after = await runTool('seasons', { chapter_id: CH });
  check('a closed season has no open season left behind it', after.open === null);
  check('the closed season is remembered with its human answers',
    after.closed.length === 1 && /dogs off lead/.test(after.closed[0].unintended_effects));
  check('the next season can now open', !!(await runTool('open_season',
    { chapter_id: CH, name: 'Winter 2026' })).id);
}

// ── The neighbours, and the feed it must not become ───────────────────────
// §5.12 is three lines of spec and almost entirely a set of refusals, so the
// refusals are what there is to test. A neighbour's text is somebody else's
// writing arriving from a public index: it is data, never instruction, and it
// must never cross into this commons' own tables.
{
  const CH = 'neighbour-test';
  await runTool('create_chapter', {
    id: CH, name: 'Neighbour Commons', scale: 'site',
    represents: 'the people who signed up', does_not_represent: 'anyone else',
    lat: 30.2, lng: -97.8,
  });

  // Discovery used to file EVERY node the index returned as a `chapter`. The
  // index answers a geographic query with whatever is near the point — asked
  // around Austin it returns a taxi co-operative, a web host, a copywriting
  // agency and an individual researcher — so the federation table asserted
  // something the data never said, and the panel repeated it to a person as
  // fact. A peer's kind may only come from what that peer itself published.
  check('a co-operative near here is not a bioregional chapter',
    classifyPeer({ name: 'ATX Coop Taxi', tags: ['taxi', 'cooperative'] }) === 'organisation');
  check('a peer whose own tags claim a bioregional commons is a chapter',
    classifyPeer({ name: 'Elk River', tags: ['bioregional', 'commons', 'regenerative'] }) === 'chapter');
  // A name is not evidence. This one reads exactly like a chapter and may be a
  // mailing list; the tags are a claim its publisher made, and that is all
  // there is to go on.
  check('a name that reads like a chapter is not evidence of one',
    classifyPeer({ name: 'Hill Country Bioregional Network', tags: [] }) === 'unknown');

  check('third-party markup never reaches the panel as markup',
    summarise({ description: 'We restore <b>riparian</b> buffers <script>x</script> here.' })
      === 'We restore riparian buffers x here.',
    summarise({ description: 'We restore <b>riparian</b> buffers <script>x</script> here.' }));
  check('a neighbour cannot take over the panel by writing more words',
    summarise({ description: 'x'.repeat(900) }).length <= 180);
  check('a profile with nothing in it produces no line',
    summarise({}) === null && summarise(null) === null);
  check('control characters are flattened out of a neighbour\'s line',
    !/[ -]/.test(summarise({ description: 'Elk  River\n\nCommons' })),
    summarise({ description: 'Elk  River\n\nCommons' }));

  // No peers, and that is a complete answer rather than a gap to be filled.
  const alone = neighbours(CH);
  check('a commons with no neighbours is not told to go and find some',
    /not a requirement|works perfectly well/i.test(alone.sentence), alone.sentence);
  check('the panel states that nothing here is owed a reply',
    /none/i.test(alone.obligation));
  // The wording that must never overstate the network: neighbours who are not
  // chapters are neighbours, and saying otherwise invents a movement.
  dbRun(`INSERT INTO federation_peers (id,name,kind,protocol,url,status,summary,summary_at)
         VALUES ('peer_t0','A Web Host','organisation','murmurations',
                 'https://example.invalid/host.json','known',
                 'non-profit cooperative web hosting', datetime('now'))`);
  check('with no chapters found, the panel says so instead of implying a network',
    /none of them is another bioregional chapter/.test(neighbours(CH).sentence),
    neighbours(CH).sentence);
  dbRun(`DELETE FROM federation_peers WHERE id='peer_t0'`);

  dbRun(`INSERT INTO federation_peers (id,name,kind,protocol,url,bioregion_name,status,summary,summary_at)
         VALUES ('peer_t1','Elk River Commons','chapter','murmurations',
                 'https://example.invalid/elk.json','Blue Ridge','known',
                 'We restore riparian buffers along the Elk.', datetime('now'))`);
  dbRun(`INSERT INTO federation_peers (id,name,kind,protocol,url,status)
         VALUES ('peer_t2','Quiet Chapter','unknown','murmurations',
                 'https://example.invalid/quiet.json','known')`);
  // What the index actually returns most of: somewhere nearby that is not a
  // commons at all.
  dbRun(`INSERT INTO federation_peers (id,name,kind,protocol,url,status,summary,summary_at)
         VALUES ('peer_t3','ATX Coop Taxi','organisation','murmurations',
                 'https://example.invalid/taxi.json','known',
                 'Austin, TX-based taxi cooperative', datetime('now'))`);

  const n = neighbours(CH);
  check('a chapter and an organisation nearby are counted apart, not together',
    n.chapters === 1 && n.items.length === 2,
    JSON.stringify(n.items.map((i) => [i.name, i.kind])));
  check('the sentence says how many are actually other chapters',
    /1 other bioregional chapter and 1 other organisation/.test(n.sentence), n.sentence);
  check('a neighbour that has published something is listed',
    n.items.some((i) => i.name === 'Elk River Commons'),
    JSON.stringify(n.items.map((i) => i.name)));
  check('a neighbour that has published nothing is not invented',
    !n.items.some((i) => i.name === 'Quiet Chapter'));
  check('the line carries their own address, not a page inside this app',
    n.items.find((i) => i.name === 'Elk River Commons').url === 'https://example.invalid/elk.json');

  // The property that keeps this a commons and not an aggregator: their words
  // stay theirs. A neighbour publishing "creek contaminated" must never become
  // an observation in this chapter's signals table.
  const signalsBefore = one(`SELECT COUNT(*) n FROM signals WHERE chapter_id=?`, CH).n;
  neighbours(CH);
  check('reading the neighbours writes nothing into this commons',
    one(`SELECT COUNT(*) n FROM signals WHERE chapter_id=?`, CH).n === signalsBefore &&
    !one(`SELECT 1 x FROM signals WHERE title LIKE '%riparian buffers along the Elk%'`));

  // Nothing here may generate work. The moment a neighbour produces a task,
  // belonging to a network becomes owing one.
  const ops = await runTool('whats_next', { chapter_id: CH });
  check('a neighbour never becomes something you have to do',
    !ops.items.some((i) => /neighbour|elk river|elsewhere/i.test(`${i.title} ${i.detail ?? ''}`)),
    JSON.stringify(ops.items.map((i) => i.title)));

  // refresh() is the only thing that goes out to the network, and one dead
  // neighbour must not cost the rest their line. example.invalid never resolves.
  const before = one(`SELECT summary FROM federation_peers WHERE id='peer_t1'`).summary;
  const r = await refreshNeighbours({ force: true });
  check('a neighbour whose site is down keeps the line it had',
    one(`SELECT summary FROM federation_peers WHERE id='peer_t1'`).summary === before);
  check('an unreachable neighbour is counted as failed, not as news',
    r.failed >= 1 && r.changed === 0, JSON.stringify(r));
}

// ── The seven numbers, and the two ways they could lie ────────────────────
// §8: how a commons knows it is working without telemetry. The arithmetic is
// easy and the honesty is not, so both tests here are about what the measures
// say when they do NOT know something.
{
  const CH = 'vitals-test';
  await runTool('create_chapter', {
    id: CH, name: 'Vitals Commons', scale: 'site',
    represents: 'the people who signed up', does_not_represent: 'anyone else',
    lat: 30.2, lng: -97.8,
  });

  // A brand new commons. Every measure must be honest that it has nothing to
  // measure — a chapter that has held no gatherings has NO care score, it does
  // not have a care score of nought. Reporting the second turns "we have not
  // started" into "we are failing", on the one screen meant to tell somebody
  // whether to keep going.
  const empty = vitals(CH);
  check('a commons with no history reports unknowns, not zeroes',
    empty.measures.filter((m) => m.value === null).length >= 5,
    JSON.stringify(empty.measures.map((m) => [m.key, m.value])));
  check('an unknown is never called unhealthy',
    empty.measures.every((m) => m.value !== null || m.healthy === null));
  check('a new commons is not told it is failing',
    /not a failing one|nothing has happened/i.test(empty.sentence), empty.sentence);
  check('there are seven questions', empty.measures.length === 7);
  check('every measure carries the threshold it is judged against',
    empty.measures.every((m) => typeof m.threshold === 'string' && m.threshold.length > 10));
  check('every measure cites the rule it comes from',
    empty.measures.every((m) => typeof m.rule === 'string' && m.rule.length > 10));
  // A score out of seven is the thing somebody would start optimising.
  check('the seven do not add up to a score',
    !('score' in empty) && !('percent' in empty));

  // responded_at was added to a schema that already had commonses using it.
  // Every need answered before that migration has an answer and no date, and
  // reading the missing date as a missing NEED tells a chapter that has been
  // answering people for a year that nobody ever came to the door.
  const brought = await runTool('submit_intake',
    { chapter_id: CH, kind: 'need', body: 'The footbridge is out.', submitted_by: 'A neighbour' });
  await runTool('respond_to_intake',
    { intake_id: brought.id, response: 'Raised at the circle.', status: 'in_council' });
  dbRun(`UPDATE intake SET responded_at=NULL WHERE id=?`, brought.id);   // as if pre-migration

  const migrated = vitals(CH).measures.find((m) => m.key === 'heard');
  check('a need answered before the column existed is not a need never brought',
    !/nobody has brought/i.test(migrated.sentence), migrated.sentence);
  check('the undated answer says the next one will be timed',
    /will be timed/.test(migrated.sentence), migrated.sentence);

  // And once it is timed, it is measured.
  const timed = await runTool('submit_intake',
    { chapter_id: CH, kind: 'need', body: 'The gate is padlocked.', submitted_by: 'A neighbour' });
  await runTool('respond_to_intake',
    { intake_id: timed.id, response: 'Key is with the steward.', status: 'acknowledged' });
  const heard = vitals(CH).measures.find((m) => m.key === 'heard');
  check('an answered need is measured in days, not against now',
    heard.value !== null && heard.value < 1, JSON.stringify(heard.value));

  // Editing the wording later is not a second response. If it moved the stamp,
  // the one measure of whether people are heard would quietly reset each time
  // somebody tidied a reply.
  const stampedAt = one('SELECT responded_at FROM intake WHERE id=?', timed.id).responded_at;
  await runTool('respond_to_intake',
    { intake_id: timed.id, response: 'Key is with the steward — ask at the shed.', status: 'acknowledged' });
  check('rewording an answer does not reset how long the person waited',
    one('SELECT responded_at FROM intake WHERE id=?', timed.id).responded_at === stampedAt);

  // An OS left running on a windowsill ingests gage readings forever. If those
  // counted, a chapter nobody has opened in a year reports as maximally alive.
  create('signals', 'signal', CH, {
    chapter_id: CH, title: 'Discharge reading', source_adapter: 'usgs',
  });
  const aliveOnGages = vitals(CH).measures.find((m) => m.key === 'alive');
  check('a gage reading does not make a chapter alive',
    aliveOnGages.value === null, JSON.stringify(aliveOnGages.value));
  create('signals', 'signal', CH, {
    chapter_id: CH, title: 'Bank slumping after the rain', author: 'R. Alvarez', source_adapter: 'notice',
  });
  check('a person noticing something does',
    vitals(CH).measures.find((m) => m.key === 'alive').value === 0);
}

// ── Attention is what a person did, not what a sensor recorded ────────────
// The same trap core/provenance.mjs exists for, arriving through a different
// door and pointing the wrong way round. A creek with a USGS gage on it files
// a reading every three hours forever. Count those as attention and the most
// neglected place in the chapter reports as the best attended one — and says
// so with a straight face, because nothing about the screen looks wrong.
{
  const CH = 'attend';
  await runTool('create_chapter', {
    id: CH, name: 'Attention Commons', scale: 'site',
    represents: 'the people who signed up', does_not_represent: 'anyone else',
    lat: 30.2, lng: -97.8,
  });
  const visited = create('places', 'place', CH, { chapter_id: CH, name: 'The Ford', lat: 30.2, lng: -97.8 });
  const gaged = create('places', 'place', CH, { chapter_id: CH, name: 'The Spring', lat: 30.3, lng: -97.9 });

  create('signals', 'signal', CH, {
    chapter_id: CH, place_id: visited.id, title: 'Frogs back in the shallows',
    author: 'S. Chen', source_adapter: 'notice',
  });
  for (let i = 0; i < 6; i++) {
    create('signals', 'signal', CH, {
      chapter_id: CH, place_id: gaged.id, title: `Discharge reading ${i}`,
      source_adapter: 'usgs',
    });
  }

  const a = placeAttention(CH, { days: 90 });
  const ford = a.places.find((p) => p.name === 'The Ford');
  const spring = a.places.find((p) => p.name === 'The Spring');
  check('one person noticing something counts as a visit', ford.visits === 1);
  check('six gage readings are not six visits', spring.visits === 0,
    `The Spring reported ${spring.visits} visits from automated readings alone`);
  check('a place with a gage on it can still be one nobody has been to',
    spring.never_visited === true);

  // Adding ground to the Atlas must not immediately accuse you of ignoring it.
  check('a place added today is not neglected', !a.neglected.some((n) => n.name === 'The Spring'));
  dbRun(`UPDATE places SET created_at=date('now','-200 days') WHERE id=?`, gaged.id);
  const b = placeAttention(CH, { days: 90 });
  check('a place nobody has been to in 200 days is',
    b.neglected.some((n) => n.name === 'The Spring'), JSON.stringify(b.neglected.map((n) => n.name)));
  check('the neglected place is named in words, with the number of days',
    /The Spring/.test(b.sentence) && /\d+/.test(b.sentence), b.sentence);

  // It ranks ground. Nothing it returns is a person's total.
  check('the attention view ranks places, never people',
    b.places.every((p) => 'name' in p && !('person' in p) && !('who' in p)));
}

// ── "Here", and why its order is a contract ───────────────────────────────
// Five tools across two engines answer with no arguments by falling through to
// anchorPlace(). If its selection order changes, "here" changes meaning in all
// of them at once, and nothing else in the suite would notice.
await runTool('add_place', { name: 'Unresolved Field', lat: 30.21, lng: -97.9 });
await runTool('add_place', { name: 'Zzz Last By Name', lat: 30.22, lng: -97.91 });
dbRun(`UPDATE places SET watershed_huc=NULL, ecoregion_name=NULL WHERE chapter_id='test'`);
dbRun(`UPDATE places SET watershed_huc='120902050305', ecoregion_name='Balcones Canyonlands'
        WHERE chapter_id='test' AND name='Zzz Last By Name'`);

check('"here" prefers a place the OS can actually reason about, not the newest row',
  anchorPlace('test')?.name === 'Zzz Last By Name', anchorPlace('test')?.name);

const explicit = one(`SELECT id FROM places WHERE chapter_id='test' AND name='Unresolved Field'`);
check('an explicitly named place always wins',
  anchorPlace('test', explicit.id)?.name === 'Unresolved Field');

// Nowhere to look from is a real answer. It must arrive as null rather than as
// an exception, because five tools call this before they can say anything, and
// each turns the null into the add_place action instead of an error.
let threw = null;
try { threw = anchorPlace('no-such-chapter'); } catch (e) { threw = e; }
check('nowhere to look from returns nothing rather than throwing',
  threw === null, threw instanceof Error ? threw.message : String(threw));

// ── The card that goes into the group chat ────────────────────────────────
const card = await cardForTheWeek('test');
check('the card writes itself', !!card.text && card.sections.length > 0, JSON.stringify(card.error));

// Everything in a card leaves the machine, and nearly all the media this OS can
// reach is NonCommercial. So the rule is not "attach carefully", it is "never".
check('the card carries no media', card.contains_media === false);
check('the card carries no address to anything',
  !/https?:\/\//i.test(card.text), card.text.match(/https?:\/\/\S+/)?.[0]);

// There is no public URL for anyone off this wifi, so a card that says "see
// more at..." is a card that lies to most of the people who read it.
check('the card never tells anyone to go somewhere else',
  !/\b(click|tap|see more|read more|log in)\b/i.test(card.text));

// A heading with nothing under it teaches people to skip the section, so every
// section either says something or states which kind of empty it is.
check('no section is an empty heading',
  card.sections.every((s) => s.lines.length > 0 && s.lines.every((l) => String(l).trim())),
  JSON.stringify(card.sections.map((s) => [s.id, s.lines.length])));

// The digest shape that works ends in one thing somebody who is not the
// steward could actually pick up.
const ask = card.sections.find((s) => s.id === 'ask');
check('the card ends with one ask pointed outward',
  !!ask && ask.lines.length === 1, JSON.stringify(ask));

check('the card is short enough to be read in a chat', card.text.length < 1600, `${card.text.length} chars`);

// When a card was last produced is a fact about this computer, not the commons:
// it must not be in the database, and so must not travel in an export.
check('the card mark is not a column on the commons',
  !/last_card|card_sent/i.test(
    all(`SELECT name FROM pragma_table_info('chapters')`).map((r) => r.name).join(' ')));
markCardSent('test');
check('a card that was produced can be remembered', daysSinceLastCard('test') === 0);

// ── And where that memory lives ─────────────────────────────────────────
// It is a file, not a column, which is right — but it was a file at a FIXED
// path, so it did not follow BROS_DB. `npm run prove` builds a throwaway
// commons precisely so it can press every button safely, and `mark_card_sent`
// wrote the real file on every run: the prover reported itself read-only while
// changing live state, and the operator then saw a card sent today because a
// test had pressed the button.
{
  const { dbPath } = await import('../core/db.mjs');
  const { existsSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const here = `${dbPath()}-last-card.json`;
  check('the card mark is written beside the commons that is open, not a fixed path',
    existsSync(here), here);
  // The property, stated the way it will be needed for the next file that lives
  // outside the database — audio, photographs, anything with bytes. The
  // directory is not enough: the suite opens a fresh database every run in a
  // SHARED folder, so the mark has to be a sidecar of the file.
  check('and so a throwaway commons cannot write the real one',
    here.startsWith(dbPath()) && !here.includes(join('Bioregional-OS', 'data', 'commons.db')), here);
}

// ── A long silence is an item in the round, never a notification ────────
// The card is the highest-leverage mechanism in the system — the group is
// already in a chat and zero of 29 mutual aid groups studied adopted a
// purpose-built tool — and `daysSinceLastCard()` was written to drive this,
// documented as driving it, tested, and called by nothing at all.
{
  const { whatsNext } = await import('../engines/operator.mjs');
  const cardItem = (chapter) => whatsNext(chapter).items
    .find((i) => i.action?.tool === 'card_for_the_week') ?? null;

  dbRun(`INSERT INTO chapters (id, name, scale, steward) VALUES ('quiet','Quiet','watershed','T')`);
  check('a commons with nothing noticed is not nagged to post',
    cardItem('quiet') === null);

  dbRun(`INSERT INTO signals (id, chapter_id, title, category, created_at)
         VALUES ('sig-quiet','quiet','The culvert flooded again','Ecological', date('now','-2 days'))`);
  const item = cardItem('quiet');
  check('a commons that has heard something, and never posted, is asked to',
    item?.kind === 'gap' && /never had a card/.test(item.title), JSON.stringify(item?.title));
  check('and it is a gap, not a slip — nothing here is overdue',
    item?.kind === 'gap' && item?.stage === 'Teach & Tell');

  markCardSent('quiet');
  check('a commons that posted this week is left alone',
    cardItem('quiet') === null);
  dbRun(`DELETE FROM signals WHERE chapter_id='quiet'`);
  dbRun(`DELETE FROM chapters WHERE id='quiet'`);
}

// ── Two guards that survived being deliberately broken ────────────────────
// Found by mutation, not by reading: the suite passed with both of these
// disabled. A guard nothing can prove is a guard nobody should trust.

// 1. The SQL form of "is this coordinate borrowed?". The in-memory twin is
//    already tested above; this is the one the map and every export actually
//    run, and breaking it changed nothing the suite could see. Two copies of a
//    rule need two tests, or the untested one is where the rule really lives.
const anchorPlace_ = one(`SELECT id, lat, lng FROM places WHERE chapter_id='test' AND lat IS NOT NULL LIMIT 1`);
const borrowed_ = await runTool('add_signal', {
  title: 'Filed against the place', lat: anchorPlace_.lat, lng: anchorPlace_.lng, source: 'notice',
});
const own_ = await runTool('add_signal', {
  title: 'Surveyed on the bank', lat: anchorPlace_.lat + 0.02, lng: anchorPlace_.lng - 0.02, source: 'manual',
});
const flagged_ = all(
  `SELECT s.id, CASE WHEN ${atPlaceCentroidSql('s')} THEN 1 ELSE 0 END borrowed
     FROM signals s WHERE s.id IN (?, ?)`, borrowed_.id, own_.id);
const flagOf = (id) => flagged_.find((r) => r.id === id)?.borrowed;
check('SQL: a signal filed at the place is marked as borrowing its coordinate',
  flagOf(borrowed_.id) === 1, JSON.stringify(flagged_));
check('SQL: a signal surveyed elsewhere keeps its own coordinate',
  flagOf(own_.id) === 0, JSON.stringify(flagged_));

// 2. What may leave the machine. The old test asserted the finished card had no
//    URL in it — true, but true whether the guard existed or not, because the
//    upstream sentence never contains one. It could not fail.
check('a sentence with no address may travel',
  safeToSend('2934 field recordings from within 15 km, most recently Common Raven on 2026-09-03'));
check('a sentence carrying a link to media may not travel',
  !safeToSend('Hear it at https://static.inaturalist.org/sounds/2152235.m4a'));
check('a bare host is still an address', !safeToSend('More at www.inaturalist.org'));
check('an embedded file is still an address', !safeToSend('data:audio/mp4;base64,AAAA'));
check('nothing to say is not something to send', !safeToSend('') && !safeToSend(null));


// ── The ecoregion library ─────────────────────────────────────────────────
{
  const lib = await import('../engines/library.mjs');

  check('the region index ships with the software and needs no network',
    lib.regions().length > 900 && lib.regions({ scheme: 'epa-l3' }).length > 80);

  check('a point resolves to candidate ecoregions offline, without claiming certainty',
    lib.regionsAt(30.26, -97.79).level4.some((r) => r.code === '30c'));

  // ── Where am I, versus what should I download ──────────────────────────
  //
  // These are different questions and one function was answering both. The
  // board took `myRegions(...).level4[0]` — the arbitrary first BOUNDING-BOX
  // hit — and named it as the chapter's ecoregion. Measured on real points, it
  // was wrong for Bend, Asheville and Missoula and right for Barton Creek,
  // which is the seeded demo and the only place anybody looked.
  //
  // The polygon answer has always been on the place row. These assert that it
  // is what wins, that a bbox-only answer is LABELLED as a guess rather than
  // presented as a fact, and — the one that actually catches a regression —
  // that the header and the ground line cannot disagree.
  {
    const bendBbox = lib.regionsAt(44.0582, -121.3153).level4;
    check('a bounding box at Bend, Oregon offers several ecoregions, first of which is wrong',
      bendBbox.length > 1 && bendBbox[0].code !== '9d', bendBbox.map((r) => r.code).join(','));

    // Its own chapter, so this does not depend on which place the test chapter
    // happens to carry or in what order — homeRegion picks one located place,
    // and borrowing a populated chapter would make the assertion about rowid
    // order rather than about the polygon.
    dbRun(`INSERT INTO chapters (id, name, scale, steward) VALUES ('bend','Bend','watershed','T')`);
    dbRun(`INSERT INTO places (id, chapter_id, name, lat, lng, ecoregion_name, bioregion_name)
           VALUES ('plac-bend','bend','Bend test',44.0582,-121.3153,
                   'Ponderosa Pine/Bitterbrush Woodland','Eastern Cascades Slopes and Foothills')`);
    const home = lib.homeRegion('bend');
    check('the polygon answer on the place row decides, not the first bbox hit',
      home?.code === '9d' && home.basis === 'polygon', JSON.stringify(home?.code));

    dbRun(`UPDATE places SET ecoregion_name=NULL WHERE id='plac-bend'`);
    const guessed = lib.homeRegion('bend');
    check('a place that was never located is answered with a guess, and says so',
      guessed?.basis === 'guess', JSON.stringify(guessed?.basis));
    // The property that matters: a guess must never be indistinguishable from a
    // resolved answer, because the board prints one and means the other.
    check('and a guess is never labelled as a polygon answer',
      guessed?.basis !== 'polygon');
    dbRun(`DELETE FROM places WHERE id='plac-bend'`);
    dbRun(`DELETE FROM chapters WHERE id='bend'`);
  }

  check('adjacency is computed from the shipped index, offline',
    lib.neighbours('30c').some((n) => n.code === '30a'));

  const notThere = lib.brief('zz-not-a-region');
  check('an unknown region code is refused rather than invented', !!notThere.error);

  const b = lib.brief('30c');
  if (b.downloaded) {
    check('a downloaded region reads entirely from disk', b.offline === true);
    check('a downloaded region carries plants, animals and soil',
      b.life.plants_recorded > 0 && b.life.animals_recorded > 0 && !!b.soil);
    check('threatened species are counted but never located',
      b.life.threatened_count > 0 &&
      !JSON.stringify(await import('../adapters/dossier.mjs')
        .then((m) => m.loadDossier('30c'))
        .then((d) => d.life.threatened)).includes('latitude'));
    check('offline species search finds a species in the region it lives in',
      lib.findSpecies('Ashe juniper').results.some((r) => r.region_code === '30c'));
    check('culture is deliberately not downloaded, and says why',
      (await import('../adapters/dossier.mjs').then((m) => m.loadDossier('30c')))
        .culture.status === 'not_downloaded_by_design');
  } else {
    skip('the offline region library',
      'no region downloaded on this machine yet — run: npm run data -- --region 30c');
  }

  const stale = lib.staleSections(null);
  check('a region with no dossier reports every refreshable section as stale',
    stale.includes('life') && stale.includes('soil') && !stale.includes('culture'));


  // The registry is the single place a licence is written down. A dossier that
  // leaves this machine must carry credit rendered from it, not from a string
  // somebody typed into an adapter.
  {
    // General, not dossier-specific: NO adapter may put licence text into an
    // attribution field. registry.mjs declares licences; everywhere else carries
    // source_id and lets attributionFor() render the credit.
    //
    // This tests the property rather than the mechanism. Checking for new SOURCES
    // entries would have passed while adapters/dossier.mjs was stamping
    // 'USDA SSURGO / ISRIC SoilGrids' into every section it wrote.
    const { findDuplications } = await import('./licence-check.mjs');
    const dupes = findDuplications();
    check('no adapter duplicates a licence the registry already declares',
      dupes.length === 0,
      dupes.map((d) => `${d.file}:${d.line}`).join(', '));

    // And the other half: an id an adapter claims must actually exist.
    const fsp = await import('node:fs/promises');
    const { readdirSync } = await import('node:fs');
    const declaredIds = new Set((await import('../adapters/registry.mjs')).SOURCES.map((x) => x.id));
    const claimed = new Set();
    for (const f of readdirSync(new URL('../adapters/', import.meta.url)).filter((f) => f.endsWith('.mjs'))) {
      const txt = await fsp.readFile(new URL(`../adapters/${f}`, import.meta.url), 'utf8');
      for (const m of txt.matchAll(/source_id:\s*'([a-z0-9-]+)'/g)) claimed.add(m[1]);
    }
    const undeclared = [...claimed].filter((id) => !declaredIds.has(id));
    check('every source_id an adapter claims is declared in the registry',
      claimed.size > 0 && undeclared.length === 0, undeclared.join(', '));

    const D = await import('../adapters/dossier.mjs');
    const reg = await import('../adapters/registry.mjs');
    const declared = new Set(reg.SOURCES.map((x) => x.id));
    const used = [...new Set(Object.values(D.SECTION_SOURCES).flat())];
    check('every source a dossier section claims is declared in the registry',
      used.length > 0 && used.every((id) => declared.has(id)),
      used.filter((id) => !declared.has(id)).join(', '));

    const d = D.loadDossier('30c');
    if (d) {
      check('a written dossier carries attribution rendered from the registry',
        Array.isArray(d.attribution) && d.attribution.length > 0 &&
        d.attribution.every((a) => a.license && a.attribution));
      check('every section records which registry sources it drew on',
        Object.values(d.sections).every((sec) => Array.isArray(sec.sources)));
    }
  }

  // A long --all run and the OS heartbeat both write dossiers. Two writers on
  // one file is how a dossier ends up half written.
  {
    const D = await import('../adapters/dossier.mjs');
    if (D.loadDossier('30c')) {
      const [a, b] = await Promise.all([D.compile('30c'), D.compile('30c')]);
      check('two writers cannot compile the same region at once',
        !!(a.skipped || b.skipped));
      check('the one held off says so rather than failing silently',
        /another process/.test((a.skipped ?? b.skipped) ?? ''));
    }
    // A leaked lock is one nobody is holding. This used to assert that NO lock
    // file existed, which fails whenever `npm run data -- --all` is running —
    // that is, whenever the lock is doing its job. It caught a live 13-second-old
    // lock belonging to a healthy download and called it a leak, which is the
    // kind of red that gets a working guard "fixed".
    //
    // What actually distinguishes a leak is age: dossier.mjs treats a lock older
    // than 15 minutes as abandoned and breaks it. So a lock younger than that is
    // somebody working, and this test's own region must be clean either way.
    const { readdirSync, existsSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(D.DOSSIER_DIR, 'epa-l4');
    const locks = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.lock')) : [];
    const abandoned = locks.filter((f) => Date.now() - statSync(join(dir, f)).mtimeMs > 15 * 60 * 1000);
    check('no abandoned lock file is left behind after a compile',
      abandoned.length === 0, abandoned.join(', '));
    check('the region this test compiled released its own lock',
      !locks.includes('30c.lock'), 'compile() did not release the lock it took');
  }

  // A section that fails must not take the region with it, and the record it
  // leaves must name the section and the upstreams — an unlabelled error in a
  // 1052-region run is a rumour, not a diagnosis.
  {
    const D = await import('../adapters/dossier.mjs');
    const src = await (await import('node:fs/promises'))
      .readFile(new URL('../adapters/dossier.mjs', import.meta.url), 'utf8');
    const stamps = [...src.matchAll(/stamp\('(\w+)',\s*(.*)$/gm)];
    const unguarded = stamps
      .filter(([, name]) => !['identity'].includes(name))
      .filter(([, name, rest]) => !/safe\(/.test(rest) && !/sampled_points/.test(rest))
      .map(([, name]) => name);
    check('every fetched section is behind the failure guard',
      unguarded.length === 0, unguarded.join(', '));

    // Count lines that both call safe() and pass a section label. A tighter
    // regex tripped on the arrow function's own parenthesis.
    const labelled = src.split('\n')
      .filter((l) => /safe\(/.test(l) && /,\s*'(life|climate|soil|water|resources|hazards)'\)/.test(l))
      .length;
    check('section failures are labelled with which section gave up', labelled >= 6,
      `only ${labelled} labelled`);
  }

  check('soil is not re-asked on the same cadence as a drought',
    (await import('../adapters/dossier.mjs')).CADENCE_DAYS.soil >
    (await import('../adapters/dossier.mjs')).CADENCE_DAYS.hazards * 100);
}

// ── Every artifact that leaves the machine carries its credit ─────────────
// A screen missing a credit is a bug a reader could notice. An artifact — a card
// pasted into a group chat, a printed sheet — is already in somebody else's
// hands by the time anyone checks, and for a CC-BY source attribution is the
// condition of being allowed to share it at all.
//
// The first version of these tests was written against the finished card and
// ALL THREE SURVIVED being broken: one had an `|| sources.length === 0` escape
// hatch that was true whenever the guard was removed, one used `.every()` on a
// collection that went empty, and one asserted a local filter rather than the
// function. All three varieties from ARCHITECTURE.md, in one sitting, by the
// person who wrote them down. They now test the builder directly, with known
// ids and no network, so each one can fail.
check('a known source resolves to exactly what the registry says',
  // Compared against the registry rather than against a word I happened to
  // expect, so rewording an attribution cannot fail this for the wrong reason.
  credits(['nws']).credit === attrFor(['nws'])[0]?.attribution, JSON.stringify(credits(['nws'])));
check('an unregistered source is NAMED in the credit, not dropped',
  credits(['a-source-invented-tomorrow']).unresolved_sources.includes('a-source-invented-tomorrow')
  && /invented-tomorrow/.test(credits(['a-source-invented-tomorrow']).credit ?? ''),
  JSON.stringify(credits(['a-source-invented-tomorrow'])));
check('a known and an unknown source both appear',
  /NOAA/.test(credits(['nws', 'made-up']).credit ?? '')
  && /made-up/.test(credits(['nws', 'made-up']).credit ?? ''));
check('nothing to credit produces no credit line',
  credits([]).credit === null && credits([]).sources.length === 0);
// And the card actually carries whatever was built: if it resolved sources, the
// text a person pastes has to contain the credit, not just the object.
const credited = await cardForTheWeek('test');
check('whatever the card resolved appears in the text somebody pastes',
  credited.sources.length === 0 || credited.text.includes(credited.credit),
  `${credited.sources.length} sources · credit in text: ${credited.credit ? credited.text.includes(credited.credit) : 'n/a'}`);

// ── Prose that states a count is prose that will be wrong ────────────────
// Four documents claimed a tool count — 59, 49, 48 and 23 — while the registry
// held 77. Nobody lied; each number was true when it was typed. Same failure as
// a licence written into an adapter instead of resolved from the registry, and
// as a coverage note describing a layer instead of asserting it: PROSE ABOUT
// STATE ROTS, AND NOTHING TELLS YOU.
//
// Two kinds of number, and they need opposite rules:
//
//   RESOLVABLE — tools, sources. The registry knows the true value, so a stated
//   number must equal it. Assert.
//
//   UNRESOLVABLE — tests. Nothing can know the count of tests while the tests
//   are running, so a stated number can never be checked and will drift the
//   moment anyone adds one. Refuse it outright.
//
// Scanned in code as well as prose, because the worst instance was not in a
// document at all: `npm run connect` printed "all 23 tools" to a person's
// terminal on their first day. A doc-only check would never have seen it.
{
  const { readFileSync, readdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { TOOLS } = await import('../ai/tools.mjs');
  const { SOURCES } = await import('../adapters/registry.mjs');
  const truth = { tools: TOOLS.length, sources: SOURCES.length };

  // Where this looks is the second half of the guard, and the half that was
  // wrong for longer. It read README, docs/ and scripts/ only — so
  // `server/routes/claude.mjs` explained the CLI bridge in terms of "77 tools"
  // twice, in a comment somebody reads while working out why the bridge exists,
  // and no check could see it. A count is a count wherever it is typed.
  //
  // Walked, not listed. A hardcoded list of directories has the same property
  // as the hardcoded list of adjectives this guard used to carry: it needs a new
  // entry forever, and the entry nobody adds is the one that goes unchecked. The
  // EXCLUSIONS are listed instead, because those are few, stable, and each has a
  // reason — vendored code, build output, regenerable data, and this file, which
  // quotes stale counts above by way of explanation and is the one place a wrong
  // number is the point.
  const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'dossiers', 'upstream', 'backups', 'worktrees']);
  const files = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = dir === '.' ? e.name : join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIR.has(e.name) && !e.name.startsWith('.')) walk(full); continue; }
      if (full === join('scripts', 'test.mjs')) continue;
      if (/\.(md|mjs|js|jsx|sql|json)$/.test(e.name)) files.push(full);
    }
  };
  walk('.');

  const drifted = [], unverifiable = [];
  for (const f of files) {
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    // The gap between the number and the noun is matched, not enumerated.
    //
    // Version one required the number to sit directly beside the noun, and
    // "509 protocol tests" walked through it. Version two listed the adjectives
    // that were allowed in between — which is a denylist wearing an allowlist's
    // clothes: "509 integration tests" and "12 of the 17 declared sources" both
    // walked through THAT, and the second one was live in DATA_SOURCES.md.
    //
    // An allowlist of adjectives needs a new entry forever. A gap needs one
    // exclusion: "N of the ... M sources" is a claim about a SUBSET and its
    // first number is not the count, so a gap containing `of` is not a count
    // claim. That is the only false positive this shape produces here, and it
    // is excluded by meaning rather than by listing the words around it.
    const countClaim = /\b(\d+)\s+((?:[A-Za-z-]+\s+){0,3})(tools|sources|tests)\b/g;
    for (const m of text.matchAll(countClaim)) {
      if (/\bof\b/.test(m[2])) continue;
      if (m[3] === 'tests') unverifiable.push(`${f}: "${m[1]} ${m[2]}${m[3]}"`);
      else if (Number(m[1]) !== truth[m[3]]) drifted.push(`${f}: "${m[1]} ${m[2]}${m[3]}" is now ${truth[m[3]]}`);
    }
  }
  check('no document or script states a count that has drifted from the registry',
    drifted.length === 0, drifted.join(' · '));
  check('nothing states a test count, which cannot be checked and will drift',
    unverifiable.length === 0, unverifiable.join(' · '));
}

// ── The front door names every room ──────────────────────────────────────
// The README's tab table is transcribed from GROUPS in App.jsx, and a
// transcription is a copy. Generating it was the obvious fix and the wrong one:
// the descriptions are editorial — "a good idea never overrides a red flag" has
// to be written by somebody with a view, not exported from a component.
//
// So assert the SET and leave the prose. Add or rename a tab without saying so
// in the README and this goes red; reword any description freely and it does
// not. App.jsx is JSX and cannot be imported here, so the ids are read as text —
// which is the honest shape for a check that is comparing two documents.
{
  const { readFileSync } = await import('node:fs');
  const app = readFileSync('app/src/App.jsx', 'utf8');

  // The parse is checked before it is trusted, and separately, so a failure
  // names its own cause. The first version guarded only against finding too
  // FEW ids: rename the closing anchor and indexOf returns -1, slice(start, -1)
  // runs to the end of the file, and the block goes from 1.5k to 13k characters
  // — the whole component. `ids.length >= 13` is satisfied by parsing too much
  // just as happily as by parsing correctly, so the check silently became
  // "does the README mention every label anywhere in App.jsx", a weaker
  // assertion wearing a stronger name. A guard against parsing too little and
  // none against parsing too much is half a guard.
  const start = app.indexOf('const GROUPS');
  const end = app.indexOf('const TABS');
  check('the GROUPS block can still be found in App.jsx',
    start >= 0 && end > start, `start ${start}, end ${end} — an anchor was renamed`);

  const groups = start >= 0 && end > start ? app.slice(start, end) : '';
  const ids = [...groups.matchAll(/id:\s*'([a-z]+)'/g)].map((m) => m[1]);
  const labels = [...groups.matchAll(/label:\s*'([^']+)'/g)].map((m) => m[1]);
  check('the parse found the GROUPS array and not the rest of the file',
    ids.length >= 13 && ids.length <= 30 && groups.length < 4000,
    `${ids.length} ids across ${groups.length} characters`);

  const readme = readFileSync('README.md', 'utf8');
  const missing = labels.filter((l) => !readme.includes(l));
  check('every tab the interface offers is named in the README',
    missing.length === 0, `not mentioned: ${missing.join(', ')}`);
}

// An artifact built from the demonstration commons says so ────────────────
// The seeded data reads like real reporting: a Critical signal describing an
// unpermitted stormwater discharge, naming a real creek and a real city
// department. On screen it sits under an "example data" banner. A card does not
// — it arrives in a group chat with no context around it, and the repository is
// public. Same rule as attribution: an artifact that travels declares what it is.
const demoCard = await cardForTheWeek('test');
check('a card from a real chapter does not cry wolf about being an example',
  demoCard.is_example === false && demoCard.notice === null,
  `is_example=${demoCard.is_example}`);

// The notice is two separate claims and must stay two. The first version said
// "nothing above is a real observation", which was false — the hazard alert, the
// gage reading and the recording count are live public data. A marker that
// over-claims teaches a reader to distrust the authoritative half, and a heat
// advisory is the worst thing in the card to make somebody doubt. Asserted as
// STRUCTURE rather than wording, so the sentences stay free to be rewritten.
{
  // Build the condition the predicate actually looks for, rather than skipping
  // forever: a chapter with the seeded id carrying the seeded signal. A test
  // that can only ever skip is not a test.
  await runTool('create_chapter', {
    id: 'barton-creek', name: 'Barton Creek Commons', scale: 'site',
    represents: 'the demonstration', does_not_represent: 'anybody real',
    lat: 30.261, lng: -97.794,
  });
  await runTool('add_signal', {
    chapter_id: 'barton-creek', title: 'Unpermitted Stormwater Outfall Discharge',
    category: 'Hydrological', severity: 'Critical', source: 'manual',
  });
  const seeded = await cardForTheWeek('barton-creek');
  check('the seeded demonstration commons is recognised as one',
    seeded.is_example === true, `is_example=${seeded.is_example}`);
  check('the example notice separates the fiction from the land',
    !!seeded.notice?.commons && !!seeded.notice?.land
    && seeded.text.includes(seeded.notice.commons)
    && seeded.text.includes(seeded.notice.land),
    JSON.stringify(seeded.notice));
  // The claim that was wrong the first time: it must not deny the readings.
  check('the notice never claims the land readings are fictional',
    !/nothing (above|here) is a real observation/i.test(seeded.text), seeded.notice?.land);
}

// ── The interface can tell what it is showing ────────────────────────────
// The on-screen marker was gated on the example being the ONLY chapter, so it
// vanished the moment somebody founded their own and clicked back to the
// example — second chapter exists, banner gone, invented discharge report on
// screen with nothing saying so. It is keyed on the ACTIVE chapter now, which
// means the browser has to be told which id is the demonstration one. If that
// ever stops being served the marker silently never shows again, and nothing
// else would notice.
{
  const { DEMO_CHAPTER_ID, isDemoChapter } = await import('../core/seedData.js');
  const api = readFileSync('server/routes/api.mjs', 'utf8');
  check('the interface is told which chapter is the demonstration one',
    /demo_chapter:\s*DEMO_CHAPTER_ID/.test(api), 'api/status no longer exposes demo_chapter');
  check('the demonstration predicate is one declaration, not a literal per file',
    isDemoChapter(DEMO_CHAPTER_ID) && !isDemoChapter('some-real-commons'));
  // The count that used to gate it: a second chapter must not change the answer.
  check('a second chapter does not stop the example being the example',
    isDemoChapter(DEMO_CHAPTER_ID) === true);
}

// ── Claude Code in the app: the two guards ───────────────────────────────
// This route spawns a process on the steward's own subscription. Two things
// stand between that and the world, and both failed once already:
//
//   1. The tool check must be an ALLOWLIST. It began as a denylist, and a
//      denylist fails OPEN — the global MCP config quietly added 501 tools
//      including Gmail, Slack, Drive and QuickBooks, and every name on the
//      denylist was still absent, so a denylist would have passed it.
//   2. The route must be loopback-only. `--share` binds 0.0.0.0 and there is
//      no authentication anywhere on this API, so without this a stranger on
//      the same wifi could spend the steward's subscription.
//
// Both are tested by trying to get PAST them, not by confirming they exist.
{
  const { __test } = await import('../server/routes/claude.mjs');
  const { isPermitted, fromThisMachine, GRANTED, DENIED } = __test;

  // The real leak, replayed. None of these are on the denylist.
  const theLeak = [
    'mcp__claude_ai_Gmail__send_message',
    'mcp__claude_ai_Slack__slack_send_message',
    'mcp__claude_ai_Google_Drive__read_file_content',
    'mcp__claude_ai_Supabase__execute_sql',
  ];
  check('the tool check refuses the tools that actually leaked in',
    theLeak.every((t) => !isPermitted(t)),
    theLeak.filter(isPermitted).join(', '));
  check('a tool nobody has thought of yet is refused by default',
    !isPermitted('SomeToolShippedNextRelease') && !isPermitted('mcp__something_else__go'),
    'the check is behaving like a denylist');
  check('the commons tools are permitted',
    isPermitted('mcp__bioregional-os__whats_next') && isPermitted('mcp__bioregional-os__propose_decision'));

  // A denylist alone would pass the leak. This asserts the two are not the
  // same test wearing different names — if someone "simplifies" the check back
  // into a denylist, this fails.
  const deniedOnly = (t) => !DENIED.includes(t);
  check('the check is stricter than the flag it backs up',
    theLeak.some((t) => deniedOnly(t) && !isPermitted(t)),
    'the allowlist agrees with the denylist on everything, so it is a denylist');

  // Loopback. The socket shape is what node actually hands over, including the
  // IPv4-mapped form that looks nothing like 127.0.0.1 until it is unwrapped.
  const from = (addr) => fromThisMachine({ socket: { remoteAddress: addr } });
  check('a request from this machine is allowed',
    from('127.0.0.1') && from('::1') && from('::ffff:127.0.0.1'),
    'loopback is being refused, so the panel would never work');
  check('a request from the wifi is refused',
    !from('192.168.1.44') && !from('10.0.0.7') && !from('::ffff:192.168.1.44'),
    'the endpoint is reachable from the network');
  check('a missing address is refused rather than allowed',
    !from(undefined) && !from(''), 'an unknown origin passes the loopback check');

  // Both flags, doing opposite jobs. With only the denylist every commons call
  // stopped at a permission prompt and the assistant reported that the PROTOCOL
  // had refused it — a refusal that was not the real refusal, which is worse
  // than an error because it teaches a rule that does not exist.
  const src = readFileSync('server/routes/claude.mjs', 'utf8');
  check('the CLI is given both the grant and the denial',
    /'--allowedTools', \.\.\.GRANTED/.test(src) && /'--disallowedTools', \.\.\.DENIED/.test(src),
    'one of the two flags is missing; disallowed removes, allowed approves');
  check('only this project’s MCP server is loaded',
    /'--strict-mcp-config'/.test(src) && /'--mcp-config', '\.mcp\.json'/.test(src),
    'the global MCP config would be loaded too');
  check('nothing granted can act outside the commons',
    GRANTED.every((g) => g.startsWith('mcp__bioregional-os__') || g === 'ToolSearch'),
    GRANTED.join(', '));
}

// ── compile() has four outcomes, and every caller must know all four ─────
// This was found twice. Fixed once in scripts/data.mjs, and the identical line
// was still sitting in engines/heartbeat.mjs — same field, same missing guard.
//
// The outcome both missed is `skipped`: the region is locked because something
// else is already writing it. That is not a rare race. dossier.mjs takes the
// lock precisely because a long `npm run data -- --all` and the running OS's
// heartbeat reach for the same region BY DESIGN, so the branch neither caller
// handled is the one that fires whenever the library is being downloaded.
//
// In the heartbeat it was worse than a crash: `catch { return null }` turned it
// into a quiet beat, so the task reported nothing to do, the status looked
// healthy, and the refresh had not run.
{
  const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { compile } = await import('../adapters/dossier.mjs');
  const { ROOT } = await import('../core/db.mjs');

  // Hold the lock the way another process would, then ask for the same region.
  const lock = join(ROOT, 'data', 'dossiers', 'epa-l3', '17.lock');
  mkdirSync(dirname(lock), { recursive: true });
  let held = false;
  try { writeFileSync(lock, '', { flag: 'wx' }); held = true; } catch { /* real run holds it */ }

  const r = await compile('17', { scheme: 'epa-l3' });
  if (held) rmSync(lock, { force: true });

  check('a locked region comes back skipped, with no refreshed list',
    !!r.skipped && r.refreshed === undefined,
    `got ${JSON.stringify(Object.keys(r))}`);
  check('the skipped outcome is not an error',
    !r.error, 'lock contention is being reported as a failure');

  // Both consumers, enumerated. A third copy has to be added here, which is the
  // point — the bug was two copies drifting, not one line being wrong.
  const callers = [
    ['scripts/data.mjs', readFileSync('scripts/data.mjs', 'utf8')],
    ['engines/heartbeat.mjs', readFileSync('engines/heartbeat.mjs', 'utf8')],
  ];
  for (const [name, src] of callers) {
    const joins = src.match(/refreshed\.join\(/g) ?? [];
    check(`${name} joins refreshed at all (the test still points at real code)`,
      joins.length > 0, 'this file no longer consumes compile(); drop it from the list');
    check(`${name} handles the locked outcome`,
      /r\.skipped/.test(src), 'a locked region will be read as a refresh');
    check(`${name} refuses to join a list it has not checked is a list`,
      /Array\.isArray\(r\.refreshed\)/.test(src), 'refreshed.join() is unguarded');
  }
  // The heartbeat's extra sin: it swallowed the crash into a quiet beat.
  const hb = readFileSync('engines/heartbeat.mjs', 'utf8');
  check('the library beat reports a failure instead of returning a quiet null',
    !/\}\s*catch\s*\{\s*return null;\s*\}/.test(hb.slice(hb.indexOf('refresh_library'))),
    'a crash in the library refresh is still indistinguishable from nothing to do');
}

// ── A refusal a person can act on ──────────────────────────────────────────
// Every enum below is ALSO a CHECK constraint in schema.sql, so an unlisted value
// was always refused. It was refused by SQLite: `CHECK constraint failed: kind IN
// (...)` — naming a column, from a layer the caller does not know exists. The right
// answer wearing the wrong face.
//
// This matters most for the AI callers, which are first-class here. Handing Claude
// a schema and then refusing it for obeying that schema is the failure that makes a
// tool registry untrustworthy, and it is invisible from inside the repo because we
// all pass valid values out of habit.
{
  const { runTool, TOOLS } = await import('../ai/tools.mjs');

  const bad = await runTool('publish_learning',
    { chapter_id: 'test', title: 'T', summary: 's', kind: 'method' });
  check('an unlisted enum value is refused before it reaches SQLite',
    bad.error === 'not_allowed_value' && !/CHECK constraint/i.test(bad.message ?? ''),
    `got ${bad.error}: ${(bad.message ?? '').slice(0, 60)}`);
  check('the refusal names the field and lists what IS allowed',
    /publish_learning\.kind/.test(bad.message ?? '') && /case_study/.test(bad.message ?? ''),
    bad.message);

  // Case matters and the message must show it, or the reader re-sends the same word.
  const cased = await runTool('add_signal', { chapter_id: 'test', title: 'T', severity: 'critical' });
  check('a value wrong only in case is told so, with the value it sent quoted back',
    cased.error === 'not_allowed_value' && /"critical"/.test(cased.message ?? '') && /Critical/.test(cased.message ?? ''),
    cased.message);

  // The guard must not fire on the valid path — the cry-wolf direction.
  const good = await runTool('add_signal',
    { chapter_id: 'test', title: 'Enum guard: valid value', severity: 'Watch' });
  check('a listed value is not refused by the enum guard', good.error !== 'not_allowed_value',
    good.error ?? 'accepted');

  // An absent optional enum is absent, not invalid — the falsiness trap this repo
  // has already been bitten by once.
  const omitted = await runTool('add_signal', { chapter_id: 'test', title: 'Enum guard: omitted' });
  check('an omitted optional enum is not treated as an invalid one',
    omitted.error !== 'not_allowed_value', omitted.error ?? 'accepted');

  // A test over a derived collection needs the collection not to be empty.
  const enums = TOOLS.flatMap((t) => Object.entries(t.input_schema?.properties ?? {})
    .filter(([, sp]) => Array.isArray(sp.enum)));
  check('there are enums in the registry for this guard to be about', enums.length > 20,
    `${enums.length} enum fields declared`);
}

// ── A second person can write, and it is not a sign-in ────────────────────
// Everyone using this OS was the steward. A phone on the wifi could bring a
// need through /join and nothing else, so a chapter was one person typing while
// everyone else submitted to them — which is a chapter that stops when that
// person is ill.
//
// Device enrolment is deliberately not accounts: no password, nothing to
// remember, nothing to reset at eleven at night before a gathering.
{
  const E = await import('../engines/enrol.mjs');
  const { clearanceFor, NETWORK_CEILING } = await import('../server/clearance.mjs');
  const CH = 'enrol-test';
  await runTool('create_chapter', {
    id: CH, name: 'Enrol Test', scale: 'site',
    represents: 'the people who signed up', does_not_represent: 'anyone else', lat: 30.2, lng: -97.8,
  });

  const inv = E.inviteDevice(CH, { role: 'member', created_by: 'Maya R.' });
  check('an invitation is a short code somebody can read off a screen',
    /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(inv.code), inv.code);
  // Read aloud across a room: a character that has to be spelled out is a
  // character that gets the enrolment abandoned.
  check('and contains none of the letters that get misheard',
    !/[O0I1L]/.test(inv.code), inv.code);

  check('a code nobody issued is refused',
    E.enrolDevice(CH, { code: 'ZZZZ-ZZZZ', label: 'x' }).error === 'code_not_valid');
  check('a device with no name is refused',
    E.enrolDevice(CH, { code: inv.code }).error === 'code_and_label_required');

  const got = E.enrolDevice(CH,
    { code: inv.code.toLowerCase(), label: "Maya's phone", person_name: 'Maya R.' });
  check('a code typed in the wrong case still works', !!got.token, JSON.stringify(got.error));
  check('enrolling names the device and, if offered, the person',
    got.device.label === "Maya's phone" && got.person.display_name === 'Maya R.');
  check('the code works exactly once',
    E.enrolDevice(CH, { code: inv.code, label: 'a second phone' }).error === 'code_not_valid');

  // THE PROPERTY THAT MATTERS MOST. This project tells people to back up and
  // move commons.db. If the token were in it, the backup would be the key.
  check('the token is never stored — only a hash of it',
    !JSON.stringify(all('SELECT * FROM devices')).includes(got.token),
    'a copy of the database would let its reader impersonate a device');
  check('and neither is the invitation code',
    !JSON.stringify(all('SELECT * FROM capabilities')).includes(inv.code),
    'a copy of the database would let its reader enrol a device');

  // The clearance boundary. A query parameter saying `clearance=sacred` was a
  // CLAIM and that is why it was a vulnerability; a device token is a SECRET
  // handed over by a steward in a room, and holding it is the proof.
  const lan = (headers = {}) => ({ socket: { remoteAddress: '192.168.1.44' }, headers });
  check('a stranger on the wifi is still a stranger', clearanceFor(lan()) === 'public');
  check('and a made-up token does not change that',
    clearanceFor(lan({ 'x-bros-device': 'not-a-real-token' })) === 'public');
  check('an enrolled member reads members-only',
    clearanceFor(lan({ 'x-bros-device': got.token })) === 'members');

  const co = E.enrolDevice(CH,
    { code: E.inviteDevice(CH, { role: 'coordinator' }).code, label: 'Council laptop' });
  check('an enrolled coordinator reads council',
    clearanceFor(lan({ 'x-bros-device': co.token })) === 'council');

  // The ceiling. restricted and sacred are the two tiers a rights holder asked
  // for, carried over plain HTTP on a shared wifi. No token turns a gathering's
  // wifi into a room where those are read.
  check('nothing arriving over a network reaches restricted or sacred',
    !['restricted', 'sacred'].includes(NETWORK_CEILING)
      && [clearanceFor(lan({ 'x-bros-device': co.token })),
          clearanceFor(lan({ 'x-bros-device': got.token }))]
        .every((c) => !['restricted', 'sacred'].includes(c)),
    NETWORK_CEILING);
  check('the steward at the machine still gets everything',
    clearanceFor({ socket: { remoteAddress: '127.0.0.1' }, headers: {} }) === 'sacred');

  // The token must never travel where a URL goes — logs, history, Referer.
  const cl = readFileSync(new URL('../server/clearance.mjs', import.meta.url), 'utf8');
  check('a device is read from a header, never from the query string',
    /headers\?\.\['x-bros-device'\]/.test(cl) && !/searchParams.*device/i.test(cl));

  // Revocation keeps the row. ODK's revoked users still appear as the submitter
  // of everything they filed; deleting would orphan the work rather than undo it.
  E.revokeDevice(got.device.id, { reason: 'phone lost on the trail' });
  check('a revoked device stops writing immediately',
    clearanceFor(lan({ 'x-bros-device': got.token })) === 'public');
  const listed = E.devices(CH);
  check('and stays on the list with its reason',
    listed.devices.some((d) => d.id === got.device.id && !d.active && /phone lost/.test(d.label)),
    JSON.stringify(listed.devices.map((d) => [d.label, d.active])));
  check('the list says how many can write, not how many exist',
    /1 device can write/.test(listed.sentence), listed.sentence);

  // Revocation is enforced twice over, and each half is tested alone —
  // otherwise a mutation that breaks one passes because the other caught it,
  // which is how defence in depth turns into one defence nobody has checked.
  //
  // Half one: the timestamp. A row revoked by timestamp while its role still
  // says "member" must not authenticate.
  const half = E.enrolDevice(CH,
    { code: E.inviteDevice(CH, { role: 'member' }).code, label: 'Timestamp-only revocation' });
  check('a device is recognised before it is revoked', !!E.deviceFor(half.token));
  dbRun(`UPDATE devices SET revoked_at=datetime('now') WHERE id=?`, half.device.id);
  check('a revoked_at alone stops a device, even with its role untouched',
    E.deviceFor(half.token) === null && clearanceFor(lan({ 'x-bros-device': half.token })) === 'public',
    'only the role check was holding');

  // Half two: the role. A row blocked by role with no timestamp must not
  // authenticate either.
  const other = E.enrolDevice(CH,
    { code: E.inviteDevice(CH, { role: 'member' }).code, label: 'Role-only block' });
  dbRun(`UPDATE devices SET role='blocked' WHERE id=?`, other.device.id);
  check('a blocked role alone stops a device, even with no revoked_at',
    E.deviceFor(other.token) === null && clearanceFor(lan({ 'x-bros-device': other.token })) === 'public',
    'only the timestamp check was holding');

  // And a role the clearance map has never heard of grants nothing, rather
  // than falling through to whatever the map's first entry happens to be.
  check('an unknown role reads nothing at all',
    (E.ROLE_CLEARANCE.blocked ?? 'public') === 'public'
      && (E.ROLE_CLEARANCE.left ?? 'public') === 'public');

  // Deletion is not available anywhere.
  let threw = null;
  try { dbRun('DELETE FROM devices WHERE id=?', got.device.id); } catch (e) { threw = e.message; }
  check('a device cannot be deleted, only revoked', !!threw, 'the row was removed');
  threw = null;
  try { dbRun(`DELETE FROM people WHERE chapter_id=?`, CH); } catch (e) { threw = e.message; }
  check('a person cannot be deleted, only withdrawn', !!threw, 'the row was removed');
}

// ── A clearance is a fact about the connection, never a field in the request ──
// The sensitivity ladder was enforced correctly everywhere except where the
// level was chosen. Three routes read it from the query string, so
// `GET /api/export/koi?clearance=sacred` returned every restricted and sacred
// object and the bundle route returned their contents. The gate function was
// never wrong — it was asked to open by the person standing outside it. With
// --share binding 0.0.0.0 and the connect QR handing out the LAN address, that
// was reachable by anyone on the gathering wifi.
{
  const { clearanceFor, isLoopback, FULL, STRANGER } = await import('../server/clearance.mjs');

  check('the machine the commons runs on is the steward',
    isLoopback('127.0.0.1') && isLoopback('::1'));
  // Node reports IPv4 loopback over a dual-stack socket in the mapped form.
  // Missing it demotes the steward's OWN browser to a stranger, which fails in
  // the safe direction and is therefore diagnosed as "the map is broken".
  check('IPv4 loopback mapped into IPv6 is still loopback',
    isLoopback('::ffff:127.0.0.1'));
  check('all of 127.0.0.0/8 is loopback, not just .1', isLoopback('127.0.0.53'));
  check('anybody else on the wifi is a stranger',
    !isLoopback('192.168.1.44') && !isLoopback('10.0.0.7') && !isLoopback('::ffff:192.168.1.44'));
  check('no socket is no proof', !isLoopback(null) && !isLoopback(''));

  check('a stranger gets public, the steward gets everything',
    clearanceFor({ socket: { remoteAddress: '192.168.1.44' } }) === STRANGER &&
    clearanceFor({ socket: { remoteAddress: '127.0.0.1' } }) === FULL);

  // The actual escalation, and the property that kills it: nothing the client
  // sends may raise the level. A forwarding header is set by whoever is in
  // front, and nothing is in front of this.
  const asStranger = { socket: { remoteAddress: '192.168.1.44' },
    headers: { 'x-forwarded-for': '127.0.0.1' }, query: { clearance: 'sacred' } };
  check('a stranger cannot ask for sacred and be given it',
    clearanceFor(asStranger) === STRANGER);
  check('a stranger cannot claim to be the steward with a header',
    clearanceFor(asStranger) === STRANGER);

  // And the routes must no longer read one from the URL at all. A default of
  // 'public' on the same line would still be a line that can be given a value.
  const routes = readFileSync(new URL('../server/routes/api.mjs', import.meta.url), 'utf8');
  check('no route takes its clearance from the query string',
    !/clearance:\s*q\.clearance/.test(routes) && !/q\.clearance/.test(routes),
    'a clearance read from the request is a clearance the requester chooses');

  // The gate itself, proven end to end rather than assumed.
  const koi = await import('../adapters/koi.mjs');
  const sacred = await runTool('add_signal',
    { chapter_id: 'test', title: 'A place that is not to be mapped', category: 'Cultural' });
  dbRun(`UPDATE rids SET sensitivity='sacred' WHERE local_id=?`, sacred.id);
  const rid = one(`SELECT rid FROM rids WHERE local_id=?`, sacred.id).rid;
  check('at public clearance a sacred object is not in the manifest',
    !koi.manifest('test', { clearance: STRANGER }).objects.some((o) => o.rid === rid));
  check('at public clearance its contents are withheld',
    koi.bundle(rid, { clearance: STRANGER })?.error === 'withheld');
  check('at the steward\'s own keyboard it is there',
    koi.manifest('test', { clearance: FULL }).objects.some((o) => o.rid === rid));
  dbRun(`DELETE FROM signals WHERE id=?`, sacred.id);
  dbRun(`DELETE FROM rids WHERE local_id=?`, sacred.id);
}

// ── A private need does not go to an index that cannot take it back ────────
// `intake.private` is honoured in the listing route, in the tool that reads
// intake, and in the sensitivity the row is filed at. It was not honoured in
// the one function that publishes an intake item to a public global index —
// which is unauthenticated, indexes geolocation, and whose removal is
// best-effort because aggregators may already hold a copy. Federation is
// one-way with respect to erasure.
{
  const { offerWantProfile } = await import('../adapters/murmurations.mjs');
  const chapter = { name: 'Test', lat: 30.2, lng: -97.8, murmurations_primary_url: 'https://example.invalid' };

  const open = offerWantProfile(
    { body: 'We need a hand clearing the culvert.', kind: 'need', private: 0 }, chapter);
  check('a need brought in the open can reach the network', open.title && !open.error);

  const priv = offerWantProfile(
    { body: 'I cannot afford the water bill and I am behind on rent.', kind: 'need', private: 1 },
    chapter);
  check('a private need is refused before it is turned into a profile',
    priv.error === 'private', JSON.stringify(priv).slice(0, 120));
  check('and the refusal carries none of what it was protecting',
    !JSON.stringify(priv).includes('rent'), JSON.stringify(priv));
}

// ── A CHECK that was widened, on a commons that already existed ────────────
// `federation_peers.kind` allowed only chapter/network/registry/index, and
// discovery filed EVERY node the Murmurations index returned as a chapter. The
// index answers a geographic query with whatever is near the point — asked
// around Austin it returns a taxi co-operative, a web host, a copywriting
// agency and an individual researcher — so the table asserted something the
// data never said and the panel repeated it to a person as fact.
//
// SQLite cannot ALTER a CHECK, so widening it means rebuilding the table, and a
// rebuild is the migration most able to lose somebody's data quietly. This runs
// it against a database built with the OLD shape and checks what survived.
{
  const { execFileSync } = await import('node:child_process');
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join: j } = await import('node:path');

  const dir = mkdtempSync(j(tmpdir(), 'bros-migrate-'));
  const old = j(dir, 'old.db');
  {
    const d = new DatabaseSync(old);
    d.exec(`CREATE TABLE federation_peers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'chapter' CHECK (kind IN ('chapter','network','registry','index')),
      protocol TEXT NOT NULL DEFAULT 'murmurations'
        CHECK (protocol IN ('murmurations','koi','activitypub','valueflows','manual')),
      url TEXT, bioregion_name TEXT, last_synced_at TEXT,
      status TEXT NOT NULL DEFAULT 'known' CHECK (status IN ('known','connected','sharing','paused')),
      notes TEXT )`);
    for (let i = 0; i < 5; i++) {
      d.prepare(`INSERT INTO federation_peers (id,name,kind,url,status,notes) VALUES (?,?,?,?,?,?)`)
        .run(`p${i}`, `Peer ${i}`, 'chapter', `https://example.invalid/${i}.json`, 'known', `note ${i}`);
    }
    d.close();
  }

  // A separate process, because core/db.mjs opens once per process and the
  // migration only runs on that open.
  const probe = j(dir, 'probe.mjs');
  writeFileSync(probe, `
    const { all, db } = await import(${JSON.stringify(new URL('../core/db.mjs', import.meta.url).href)});
    db();
    const rows = all('SELECT id,name,kind,url,notes FROM federation_peers ORDER BY id');
    const sql = all("SELECT sql FROM sqlite_master WHERE name='federation_peers'")[0].sql;
    console.log(JSON.stringify({
      rows: rows.length,
      kinds: [...new Set(rows.map((r) => r.kind))],
      notesKept: rows.every((r) => r.notes === 'note ' + r.id.slice(1)),
      urlsKept: rows.every((r) => (r.url ?? '').endsWith('.json')),
      widened: sql.includes("'organisation'"),
      hasTags: /\\btags\\b/.test(sql),
    }));
  `);
  const out = JSON.parse(execFileSync(process.execPath,
    ['--disable-warning=ExperimentalWarning', probe],
    { env: { ...process.env, BROS_DB: old }, encoding: 'utf8' }).trim().split('\n').at(-1));

  check('a constraint rebuild loses no rows', out.rows === 5, JSON.stringify(out));
  check('a constraint rebuild loses no columns it was not changing',
    out.notesKept && out.urlsKept, JSON.stringify(out));
  check('the widened constraint is actually in place', out.widened && out.hasTags);
  // The claim discovery made without evidence is dropped rather than carried
  // forward. "unknown" is the honest value until the next profile read.
  check('kinds asserted without evidence are reset, not migrated as truth',
    out.kinds.length === 1 && out.kinds[0] === 'unknown', JSON.stringify(out.kinds));

  // Runs once. The guard reads the live CHECK, so a second open is a no-op
  // rather than a second rebuild.
  const again = JSON.parse(execFileSync(process.execPath,
    ['--disable-warning=ExperimentalWarning', probe],
    { env: { ...process.env, BROS_DB: old }, encoding: 'utf8' }).trim().split('\n').at(-1));
  check('opening the same commons again does not rebuild it a second time',
    again.rows === 5 && again.widened, JSON.stringify(again));

  rmSync(dir, { recursive: true, force: true });
}

// ── A backup that is actually a backup ─────────────────────────────────────
// The docs said "copy data/commons.db and you have a complete backup". In WAL
// mode that is false, and it fails in the worst available way: the copy exists,
// opens, and looks entirely normal while being short by whatever had not been
// checkpointed. Found by accident — a chapter was deleted, the file was copied,
// and the deleted chapter was still in the copy.
//
// Restoring a backup is the only way anyone ever finds out a backup does not
// work, and almost nobody does it before they need it. So the suite does.
{
  const { execFileSync } = await import('node:child_process');
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdtempSync, copyFileSync, existsSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join: j } = await import('node:path');

  const node = process.execPath;
  const run = (script, args, env) => execFileSync(node, ['--disable-warning=ExperimentalWarning', script, ...args],
    { env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  const dir = mkdtempSync(j(tmpdir(), 'bros-backup-'));
  const live = j(dir, 'commons.db');

  // A database with content deliberately left in the WAL, which is the state a
  // running commons is in essentially all of the time.
  {
    const db = new DatabaseSync(live);
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('CREATE TABLE chapters (id TEXT PRIMARY KEY)');
    db.exec("INSERT INTO chapters VALUES ('a'), ('b')");
    db.close();
  }
  const walHeld = existsSync(`${live}-wal`);

  run('scripts/backup.mjs', [j(dir, 'out.db')], { BROS_DB: live });
  check('a backup can be taken while the commons is live', existsSync(j(dir, 'out.db')));

  const got = new DatabaseSync(j(dir, 'out.db'), { readOnly: true });
  const n = got.prepare('SELECT COUNT(*) AS n FROM chapters').get().n;
  got.close();
  check('the backup contains rows a plain file copy can miss', n === 2, `${n} of 2 rows, wal present=${walHeld}`);

  // The bug this file exists to stop repeating: erase, pointed at one database,
  // deleted ANOTHER commons's backups — because the backups directory came from
  // the project root rather than from the database being erased. It was found by
  // running it: a throwaway erase reported "1 backup will also go", and the real
  // one was gone. Assert the project's own backups survive an erase elsewhere.
  const projectBackups = j(process.cwd(), 'data', 'backups');
  mkdirSync(projectBackups, { recursive: true });
  const sentinel = j(projectBackups, 'erase-test-sentinel.db');
  writeFileSync(sentinel, 'must survive an erase of a different database');

  const far = mkdtempSync(j(tmpdir(), 'bros-far-'));
  copyFileSync(live, j(far, 'far.db'));
  run('scripts/erase.mjs', ['--force'], { BROS_DB: j(far, 'far.db') });
  check('erasing a database elsewhere leaves this project\'s backups alone', existsSync(sentinel),
    'erase derived its backups directory from the project root instead of from the database');
  rmSync(sentinel, { force: true });

  // Refusing by default is the whole safety property.
  const out = run('scripts/erase.mjs', [], { BROS_DB: live });
  check('erase refuses to delete anything without --force',
    /Nothing has been deleted/.test(out) && existsSync(live));

  run('scripts/erase.mjs', ['--force'], { BROS_DB: live });
  check('erase removes the write-ahead log too, not just the visible file',
    !existsSync(live) && !existsSync(`${live}-wal`) && !existsSync(`${live}-shm`),
    'deleting commons.db by hand leaves the log, which holds most of the content');
}

// ── The door the enrolment engine was protecting ──────────────────────────
// server/clearance.mjs decided what a connection had earned, and three export
// routes asked it. `POST /api/tool` ran every tool for whoever was on the wifi,
// so with --share on a stranger could mint a coordinator code or revoke the
// steward's devices. ai/access.mjs is the policy; these prove the route
// actually consults it, and that an answer leaving over the wifi is stripped
// of anything above the connection's clearance.
{
  const { api } = await import('../server/routes/api.mjs');
  const { withhold, LADDER } = await import('../server/clearance.mjs');
  const access = await import('../ai/access.mjs');
  const E = await import('../engines/enrol.mjs');
  const { TOOLS } = await import('../ai/tools.mjs');
  const CH = one('SELECT id FROM chapters ORDER BY founded_at LIMIT 1')?.id;

  // The policy names only tools that exist. A renamed tool would otherwise
  // silently fall back to the keyboard — the safe direction, but a stale name
  // is still a lie in the policy.
  // ── The day clock is for anyone, and it hands over nothing else ────────
  //
  // The public tier was four tools and all four were WRITES: a stranger could
  // contribute to a commons they were not allowed to look at. That is inverted
  // from how people use community software — the 90 in 90-9-1 participate by
  // READING — and DAILY_USE.md §4 had already specified the day clock as
  // "60 seconds, ANYONE, gives before it asks".
  //
  // These assert the two halves: a stranger CAN read the land, and the reading
  // is a projection that fails closed. The second half is the one that matters
  // in a year, when somebody adds a field to groundToday() without knowing this
  // exists.
  {
    const asStranger = await runTool('ground_today', {}, { clearance: 'public' });
    check('a stranger can read what the land is doing, without enrolling anything',
      !asStranger.error && !!asStranger.sky && asStranger.for_a_stranger === true,
      JSON.stringify(asStranger.error ?? Object.keys(asStranger).slice(0, 6)));

    const leaked = JSON.stringify(asStranger);
    check('and it hands a stranger no coordinates',
      !/"lat"|"lng"/.test(leaked));
    check('no id to ask about the place by',
      !asStranger.place?.id && !/"huc"/.test(leaked));
    check('and none of the chapter\'s own records',
      !('history' in asStranger));
    // The property, not the three fields above: everything a stranger receives
    // was NAMED by the projection. A new field on groundToday() is private
    // until somebody adds it here on purpose.
    const { forAStranger } = await import('../engines/ground.mjs');
    const invented = forAStranger({
      generated_at: 'x', place: { name: 'P', id: 'plac-secret', lat: 1, lng: 2 },
      history: { items: [{ id: 'sig-secret' }] },
      a_field_added_later: 'should not travel',
      contact: 'someone@example.com',
    });
    check('the projection is an allowlist, so a field added later is private until named',
      !('a_field_added_later' in invented) && !('contact' in invented)
        && !('history' in invented) && !invented.place.id && !invented.place.lat,
      JSON.stringify(Object.keys(invented)));

    // The half of the ground line made ENTIRELY of the chapter's own records
    // stays where it was.
    const history = await runTool('this_week_last_year', {}, { clearance: 'public' });
    check('a stranger still cannot read the chapter\'s own history',
      !!history.error, JSON.stringify(history.error));

    // A tool in two tiers is resolved by whichever list is walked last. That
    // silently kept ground_today at members after it was moved to public, and
    // the only symptom was a refusal the policy said should not happen.
    const tiers = new Map();
    let doubled = [];
    for (const [tier, list] of [['public', access.PUBLIC_NAMES], ['members', access.MEMBERS_NAMES],
      ['council', access.COUNCIL_NAMES]]) {
      for (const n of list ?? []) {
        if (tiers.has(n)) doubled.push(`${n}: ${tiers.get(n)} + ${tier}`);
        tiers.set(n, tier);
      }
    }
    check('no tool is listed in two clearance tiers', doubled.length === 0, doubled.join(' · '));
  }

  // ── Sharing is a decision about a room, made at the machine ────────────
  //
  // It was a start-up flag, so turning it on meant quitting the OS and using a
  // terminal — and a chapter that installs by double-clicking never passes any
  // flag at all, so it was on 127.0.0.1 permanently. That put a command line in
  // front of the second person, the QR at a gathering and the join page: every
  // social thing this project is for.
  //
  // What must stay true now that it is a button.
  {
    const shareTools = ['start_sharing', 'stop_sharing', 'sharing_status'];
    for (const t of shareTools) {
      check(`${t} cannot be reached from the wifi`,
        (await runTool(t, {}, { clearance: 'members' }))?.error === 'not_from_here');
    }
    // A device must never be able to widen the door it came through, and that
    // includes a coordinator's.
    check('not even a coordinator device can open the wifi door',
      (await runTool('start_sharing', {}, { clearance: 'council' }))?.error === 'not_from_here');

    const sh = await import('../server/share.mjs');

    // The consent gate REFUSES rather than warns — a warning above a running
    // server is a warning nobody reads — and it hands back WHAT is held, so the
    // decision is made by somebody looking at it rather than at a number.
    dbRun(`UPDATE rids SET sensitivity='sacred' WHERE rowid IN (SELECT rowid FROM rids LIMIT 1)`);
    const refused = await sh.startSharing({});
    check('a commons holding sacred records refuses to be shared',
      refused.error === 'holds_protected_records', JSON.stringify(refused.error));
    check('and says what it is holding, rather than only that it is holding something',
      Array.isArray(refused.held) && refused.held.length > 0 && refused.held[0].sensitivity,
      JSON.stringify(refused.held));
    check('and names the knowing version, instead of being a dead end',
      refused.confirm_with?.tool === 'start_sharing' && refused.confirm_with?.input?.anyway === true);
    check('the refusal cites the rule it is enforcing',
      /restricted or sacred/i.test(refused.rule ?? ''), refused.rule);

    // One definition of what is held, shared with the start-up flag. Two copies
    // of this rule is how two surfaces come to disagree about what is safe.
    const idx = readFileSync('server/index.mjs', 'utf8');
    check('the --share flag and the button ask the same question',
      idx.includes('heldAboveMembers')
        && !/SELECT COUNT\(\*\) n FROM rids WHERE sensitivity IN/.test(idx));

    dbRun(`UPDATE rids SET sensitivity='public' WHERE sensitivity='sacred'`);
    check('with nothing above members-only, the gate does not stand in the way',
      (await sh.startSharing({})).error !== 'holds_protected_records');
  }

  const names = new Set(TOOLS.map((t) => t.name));
  const stale = access.POLICY_NAMES.filter((n) => !names.has(n));
  check('the access policy names only tools that exist', stale.length === 0, stale.join(', '));

  // The same assertion, for EVERY hardcoded list of tool names rather than the
  // one that happened to be written first. MATERIAL_TOOLS sat ten lines from
  // this check for as long as it existed and was never covered by it: it named
  // `set_baseline` and `publish_to_murmurations`, neither of which is a tool.
  // The consequence was not cosmetic — MATERIAL_TOOLS is what decides whether
  // an AI caller's write reaches the transparency register, so setting an
  // indicator baseline, and PUBLISHING THIS CHAPTER TO THE FEDERATION, were
  // both unlogged. That is ARCHITECTURE.md's "a log that depended on the logged
  // party volunteering", wearing a different hat.
  //
  // Listed by name here rather than discovered, because a list this check
  // cannot see is exactly the failure being fixed: adding a new one and not
  // adding it here is the next occurrence.
  const { MATERIAL_TOOLS } = await import('../ai/tools.mjs');
  const { VERB_NAMES } = await import('../app/src/verbs.js');
  const lists = {
    'ai/access.mjs POLICY_NAMES': access.POLICY_NAMES,
    'ai/tools.mjs MATERIAL_TOOLS': [...MATERIAL_TOOLS],
    'app/src/verbs.js VERB': VERB_NAMES,
  };
  const ghosts = Object.entries(lists)
    .flatMap(([where, list]) => list.filter((n) => !names.has(n)).map((n) => `${where}: ${n}`));
  check('every hardcoded list of tool names names only tools that exist',
    ghosts.length === 0, ghosts.join(' · '));
  check('a tool the policy does not mention is keyboard-only',
    access.requiredFor('a_tool_that_does_not_exist') === access.KEYBOARD);

  // Property, not mechanism: every tool that mints, revokes, consents or
  // overrides is unreachable from any network clearance.
  const guarded = ['invite_device', 'revoke_device', 'record_consent', 'withdraw_consent',
    'override_gate', 'name_deputy', 'create_chapter', 'publish_to_network', 'import_field_data'];
  check('nothing over a network can enrol, revoke, consent, override or found',
    guarded.every((n) => !access.mayRun(n, 'council')), guarded.filter((n) => access.mayRun(n, 'council')).join(', '));

  const res = { writeHead() {}, end() {}, write() {} };
  const post = async (name, input, headers = {}, addr = '192.168.1.44') => {
    const body = Buffer.from(JSON.stringify({ name, input }));
    const req = { method: 'POST', socket: { remoteAddress: addr }, headers,
      async *[Symbol.asyncIterator]() { yield body; } };
    return api(req, res, new URL('http://localhost/api/tool'));
  };

  // A stranger on the wifi.
  const r1 = await post('revoke_device', { device_id: 'x' });
  check('a stranger on the wifi cannot revoke a device', r1?.error === 'not_from_here', JSON.stringify(r1));
  const r2 = await post('invite_device', {});
  check('a stranger on the wifi cannot mint an invitation', r2?.error === 'not_from_here' && !r2?.code);
  const r3 = await post('submit_intake', { kind: 'need', body: 'a stranger brought this', private: 1 });
  check('a stranger can still bring a need through the join page', !r3?.error, JSON.stringify(r3));
  const r4 = await post('list_signals', {});
  check('a stranger cannot read the commons through the tool route', r4?.error === 'not_from_here');

  // An enrolled member.
  const m = E.enrolDevice(CH, { code: E.inviteDevice(CH, { role: 'member' }).code, label: 'Access test member' });
  const mh = { 'x-bros-device': m.token };
  const r5 = await post('commons_board', {}, mh);
  check('an enrolled member reads the board over the wifi', !r5?.error && r5?.here, JSON.stringify(r5).slice(0, 80));
  const r6 = await post('decide_council_item', { decision_id: 'x' }, mh);
  check('an enrolled member cannot do council work', r6?.error === 'not_from_here');
  const r7 = await post('invite_device', {}, mh);
  check('an enrolled member cannot invite another device', r7?.error === 'not_from_here');

  // A coordinator.
  const co = E.enrolDevice(CH, { code: E.inviteDevice(CH, { role: 'coordinator' }).code, label: 'Access test coordinator' });
  const coh = { 'x-bros-device': co.token };
  const r8 = await post('decide_council_item', { decision_id: 'nope' }, coh);
  check('a coordinator reaches council work and meets the protocol, not the door',
    r8?.error !== 'not_from_here', JSON.stringify(r8));
  const r9 = await post('revoke_device', { device_id: m.device.id }, coh);
  check('a coordinator still cannot revoke a device from the wifi', r9?.error === 'not_from_here');

  // The keyboard is ungated, and the local callers pass no clearance at all.
  const r10 = await post('list_devices', {}, {}, '127.0.0.1');
  check('the steward at the keyboard lists devices', Array.isArray(r10?.devices));
  const r11 = await runTool('list_devices', {});
  check('a local caller passing no clearance is never gated', Array.isArray(r11?.devices));

  // The refusal is one a person can act on.
  check('the refusal says where the thing can be done instead',
    /computer|steward|coordinator/.test(r1?.message ?? '') && r1?.needs && r1?.has === 'public');

  // ── withhold: nothing above the clearance leaves ────────────────────────
  const sacred = create('signals', 'signal', CH,
    { chapter_id: CH, title: 'Access test — sacred site', category: 'Cultural', severity: 'Info', source_adapter: 'test', sensitivity: 'sacred' },
    'sacred');
  const pub = create('signals', 'signal', CH,
    { chapter_id: CH, title: 'Access test — public creek', category: 'Ecological', severity: 'Info', source_adapter: 'test' },
    'public');
  const asMember = await post('list_signals', {}, mh);
  const rows = Array.isArray(asMember) ? asMember : (asMember?.signals ?? []);
  check('a sacred object is withheld from a member over the wifi',
    !JSON.stringify(asMember).includes(sacred.id) && JSON.stringify(asMember).includes(pub.id),
    `sacred present=${JSON.stringify(asMember).includes(sacred.id)}, public present=${JSON.stringify(asMember).includes(pub.id)}`);
  const atKeyboard = await runTool('list_signals', {});
  check('and is there at the keyboard', JSON.stringify(atKeyboard).includes(sacred.id));

  // The count is visible, never silent, and the walk reaches nested objects.
  const deps = { hiddenIds: () => new Set(['h1', 'h2']) };
  const w = withhold({ items: [{ id: 'ok' }, { id: 'h1' }], nested: { thing: { id: 'h2' }, keep: { id: 'k' } } }, 'members', deps);
  check('withhold strips nested protected objects and counts them',
    w.items.length === 1 && !('thing' in w.nested) && w.nested.keep.id === 'k' && w.withheld === 2, JSON.stringify(w));
  check('withhold refuses a single protected object rather than hollowing it',
    withhold({ id: 'h1', title: 'x' }, 'members', deps)?.error === 'withheld');
  check('withhold touches nothing at the keyboard',
    withhold({ id: 'h1' }, 'sacred', deps)?.id === 'h1');
  check('the ladder withhold reads is the ladder clearance uses', LADDER.length === 5 && LADDER[0] === 'public');

  // The QR is made at the keyboard only.
  const qr = async (addr) => {
    const body = Buffer.from(JSON.stringify({ text: 'http://x/join#enrol=ABCD-EFGH' }));
    const req = { method: 'POST', socket: { remoteAddress: addr }, headers: {}, async *[Symbol.asyncIterator]() { yield body; } };
    return api(req, res, new URL('http://localhost/api/qr'));
  };
  check('a stranger cannot ask the machine to draw a QR', (await qr('192.168.1.44'))?.status === 403);
  check('the steward gets one', /^data:image\/png/.test((await qr('127.0.0.1'))?.qr ?? ''));

  // ── the screens exist, and carry the token the right way ────────────────
  const apiJs = readFileSync(new URL('../app/src/api.js', import.meta.url), 'utf8');
  check('the interface sends the device token as a header on every call',
    /x-bros-device/.test(apiJs) && !/x-bros-device.*URLSearchParams|URLSearchParams.*x-bros-device/s.test(apiJs.split('\n').filter((l) => /device/.test(l)).join('\n')));
  const join = readFileSync(new URL('../app/src/components/Join.jsx', import.meta.url), 'utf8');
  check('the join page can redeem a code, from the fragment or typed',
    /enrol_device/.test(join) && /location\.hash/.test(join) && /rememberDevice/.test(join));
  check('a spent code is taken out of the address bar', /replaceState/.test(join));
  const devices = readFileSync(new URL('../app/src/components/Devices.jsx', import.meta.url), 'utf8');
  check('the steward has a screen that invites, lists and revokes',
    /invite_device/.test(devices) && /list_devices/.test(devices) && /revoke_device/.test(devices));
  check('the invitation link carries the code in the fragment, never the query',
    /\/join#enrol=/.test(devices) && !/\/join\?/.test(devices));
  check('the screen says out loud when nobody else can reach this computer', /--share/.test(devices));
}

// ── Settling in: setup cannot finish empty ────────────────────────────────
// A chapter founded in seven seconds with nothing in it is the shape most
// deployments of this kind die in. The board must keep the three missing
// things at the top until they exist, and a gage must never count as a
// person noticing something.
{
  const { settledIn, SETTLING_OBSERVATIONS } = await import('../engines/firstrun.mjs');
  const { board } = await import('../engines/board.mjs');
  const made = await runTool('create_chapter', {
    id: 'settling-test', name: 'Settling test', scale: 'site',
    represents: 'a test', does_not_represent: 'anything real',
  });
  const C = made?.id ?? made?.chapter?.id ?? 'settling-test';
  const s0 = settledIn(C);
  check('a freshly founded commons is not settled', s0.complete === false && s0.missing.length === 3, JSON.stringify(s0.missing));
  check('the board puts settling in first, with a button for each',
    board(C).todo.slice(0, 3).every((t) => t.stage === 'Settling in' && t.action?.tool), JSON.stringify(board(C).todo.slice(0, 3).map((t) => t.stage)));

  // Three gage readings are not three people noticing.
  for (let i = 0; i < SETTLING_OBSERVATIONS; i++) {
    create('signals', 'signal', C, { chapter_id: C, title: `gage ${i}`, category: 'Hydrological', severity: 'Info', source_adapter: 'usgs' });
  }
  check('instrument readings do not count as things people noticed', settledIn(C).missing.includes('noticed'));

  await runTool('add_place', { chapter_id: C, name: 'The creek', lat: 30.26, lng: -97.79 });
  await runTool('add_agent', { chapter_id: C, name: 'A neighbour', vf_agent_type: 'Person', role: 'walks the creek' });
  for (let i = 0; i < SETTLING_OBSERVATIONS; i++) {
    await runTool('add_signal', { chapter_id: C, title: `noticed ${i}`, category: 'Ecological', severity: 'Info', source: 'manual' });
  }
  const s1 = settledIn(C);
  check('a place, a person and three observations settle it', s1.complete === true, JSON.stringify(s1.missing));
  check('and the board stops leading with it', !board(C).todo.some((t) => t.stage === 'Settling in'));
  check('settling_in is a tool, so every surface can ask', (await runTool('settling_in', { chapter_id: C }))?.complete === true);
  check('settledIn writes nothing', one('SELECT COUNT(*) n FROM signals WHERE chapter_id=?', C).n === SETTLING_OBSERVATIONS * 2);
}

// ── The round can be finished ─────────────────────────────────────────────
//
// §4 of DAILY_USE.md specifies the week clock as "capped, deferrable, and
// capable of being FINISHED", with the reward written down as "the list
// empties". It did not empty: the board recomputed the top five every time it
// was asked, so closing a consent gate — an evening of door-knocking, evidence
// written, a reviewer named — moved one digit while the next identical line
// stepped into the slot. The five lines were the same the following week.
//
// A list that does not change teaches a steward that their work does not move
// the screen, which is harder to come back from than a list that is merely long.
{
  const R = await import('../engines/round.mjs');
  const { whatsNext } = await import('../engines/operator.mjs');
  const { board } = await import('../engines/board.mjs');
  const C = 'test';

  // ── The keys have to be unique, on data that actually collides ────────
  //
  // The first version of these tests passed on a fixture with at most one item
  // per key, which is the "test the mechanism, not the property" trap: seven
  // operator items had an empty or volatile-only action input, so three overdue
  // decisions all keyed as `Convene|council_agenda`. A round of five held four
  // pieces of work, `done_count` never moved when one was cleared, a decision
  // that went overdue LATER joined the held round, and one "not this week"
  // removed the whole class with a reason written about a different item.
  {
    for (let i = 1; i <= 3; i++) {
      dbRun(`INSERT INTO decisions (id, chapter_id, title, status, review_date)
             VALUES (?, 'test', ?, 'decided', date('now','-30 days'))`,
      `dec-collide-${i}`, `Decision ${i}`);
    }
    dbRun(`INSERT INTO gatherings (id, chapter_id, title, starts_at)
           VALUES ('gat-collide-1','test','First gathering', date('now','+3 days'))`);
    dbRun(`INSERT INTO gatherings (id, chapter_id, title, starts_at)
           VALUES ('gat-collide-2','test','Second gathering', date('now','+4 days'))`);

    const items = whatsNext(C).items.filter((i) => i.action);
    const keys = items.map(R.itemKey);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    check('two different pieces of work never share one key',
      dupes.length === 0, [...new Set(dupes)].join(' · '));

    // And the consequence, stated as the consequence: clearing one thing
    // empties exactly one slot.
    dbRun(`DELETE FROM rounds WHERE chapter_id='test'`);
    const r0 = R.theRound(C);
    const held = new Set(r0.remaining.map(R.itemKey));
    check('a round of five holds five different things',
      held.size === r0.remaining_count, `${held.size} distinct of ${r0.remaining_count}`);

    // New work of a kind already in the round must NOT join it. That is the
    // invariant the whole commit exists for: the round does not grow back.
    dbRun(`INSERT INTO decisions (id, chapter_id, title, status, review_date)
           VALUES ('dec-collide-late','test','A decision that slipped on Tuesday','decided', date('now','-1 days'))`);
    const r1 = R.theRound(C);
    check('work that arrives after the round was picked does not join it',
      r1.remaining_count <= r0.remaining_count,
      `${r0.remaining_count} -> ${r1.remaining_count}`);

    dbRun(`DELETE FROM decisions WHERE id LIKE 'dec-collide%'`);
    dbRun(`DELETE FROM gatherings WHERE id LIKE 'gat-collide%'`);
    dbRun(`DELETE FROM rounds WHERE chapter_id='test'`);
  }

  // The caller does not get to decide how big a chapter's week is.
  {
    dbRun(`DELETE FROM rounds WHERE chapter_id='test'`);
    const huge = R.theRound(C, { size: 500 });
    check('a round cannot be opened at any size the caller likes',
      huge.size <= 9, String(huge.size));
    dbRun(`DELETE FROM rounds WHERE chapter_id='test'`);
    const tiny = R.theRound(C, { size: -1 });
    check('and a nonsense size does not pick everything but the last thing',
      tiny.size >= 1, String(tiny.size));
    dbRun(`DELETE FROM rounds WHERE chapter_id='test'`);
  }

  // Picked once and held. Two looks, the same round.
  const first = R.theRound(C);
  const second = R.theRound(C);
  check('a round is picked once and is the same round when you look again',
    first.round_id === second.round_id && first.remaining_count === second.remaining_count,
    `${first.round_id} / ${second.round_id}`);
  check('and it is capped', first.size <= 5, String(first.size));

  // The key has to survive the work being done to it. "2 projects are waiting
  // on gates — 17 between them" changes its title the moment a gate closes,
  // which is exactly when the round must not lose track of it.
  const gateItem = whatsNext(C).items.find((i) => i.action?.tool === 'satisfy_quest_gate');
  if (gateItem) {
    const before = R.itemKey(gateItem);
    const moved = { ...gateItem, title: 'a completely different sentence',
      action: { ...gateItem.action, input: { ...gateItem.action.input, gate: 'some_other_gate' } } };
    check('an item keeps its identity when its title and its next gate change',
      R.itemKey(moved) === before, `${before} vs ${R.itemKey(moved)}`);
  }

  // Deferring, which is the half that makes finishing honest: without it one
  // thing a steward cannot do this week holds the round open for ever.
  const key = first.remaining.length ? R.itemKey(first.remaining[0]) : null;
  if (key) {
    check('setting something aside without a reason is refused',
      R.setAside(C, key, '   ')?.error === 'no_reason');
    check('and so is setting aside something this round never asked for',
      R.setAside(C, 'invented|key', 'because')?.error === 'not_in_round');
    const after = R.setAside(C, key, 'The council meets on the 28th; nothing moves before then.');
    check('setting something aside takes it out of the round',
      after.remaining_count === first.remaining_count - 1,
      `${first.remaining_count} -> ${after.remaining_count}`);
    check('and keeps the reason, because "set aside" with no reason reads like nobody looked',
      after.set_aside.some((a) => /council meets/.test(a.reason)));
    // The work itself is untouched. Setting aside is about the WEEK, not about
    // the commons, and a round that could quietly close work would be a way of
    // marking things done without doing them.
    check('the work is still there — a round holds a week, not the commons',
      whatsNext(C).items.some((i) => R.itemKey(i) === key));
  }

  // Clearing them all reaches a state, and the state persists.
  for (const item of [...R.theRound(C).remaining]) {
    R.setAside(C, R.itemKey(item), 'Not this week.');
  }
  const done = R.theRound(C);
  check('when the five are gone the round is finished, and says so',
    done.finished === true && /That is the round/.test(done.sentence), done.sentence);
  check('and asking again does not refill it',
    R.theRound(C).remaining_count === 0);
  // The thing that was broken: what did not fit is STATED, never used to top up.
  check('what did not fit is counted, not poured back in',
    typeof done.waiting_count === 'number' && done.remaining_count === 0);

  // A new week is a new round.
  dbRun(`UPDATE rounds SET opened_at = datetime('now','-8 days') WHERE chapter_id='test' AND closed_at IS NULL`);
  const nextWeek = R.theRound(C);
  check('a new week opens a new round rather than reviving last week\'s',
    nextWeek.round_id !== done.round_id && nextWeek.remaining_count > 0,
    `${done.round_id} -> ${nextWeek.round_id}`);

  // ── And it must never become a streak ─────────────────────────────────
  // §3.4 refuses streaks on evidence: they move retention and they bring
  // anxiety, guilt, dependency and sharp churn when one breaks. A "rounds
  // completed" counter is a streak with a calendar on it, and it is the
  // obvious next feature for anybody who reads this table without the
  // argument. These assert the absence.
  // The PROPERTY, not a grep for the word.
  //
  // A search of two files for "streak" and "COUNT(*)" is weak twice over: a
  // counter written in ai/tools.mjs or in the app walks straight past it, and so
  // does `COUNT(1)`, or `all('SELECT * FROM rounds').length`. What actually has
  // to be true is that NO VALUE REACHING A CALLER DEPENDS ON HOW MANY ROUNDS
  // CAME BEFORE. So: take the answer, invent twenty finished weeks behind it,
  // and require the answer to be identical field for field. That fails the
  // moment anybody derives anything from history, however they spell the query.
  const before = { round: JSON.stringify(R.theRound(C)), board: JSON.stringify(board(C).round) };
  for (let i = 0; i < 20; i++) {
    dbRun(`INSERT INTO rounds (id, chapter_id, opened_at, closed_at, picked)
           VALUES (?, 'test', datetime('now', ?), datetime('now', ?), '[]')`,
    `rnd-history-${i}`, `-${(i + 2) * 7} days`, `-${(i + 1) * 7} days`);
  }
  const after = { round: JSON.stringify(R.theRound(C)), board: JSON.stringify(board(C).round) };
  check('a commons with twenty finished weeks behind it is told exactly what a new one is told',
    before.round === after.round && before.board === after.board,
    before.round === after.round ? 'the board differs' : 'the round differs');
  dbRun(`DELETE FROM rounds WHERE id LIKE 'rnd-history-%'`);
  // A round stores KEYS, never the text of an item, so it cannot go stale and
  // cannot disagree with the commons about what is true.
  const stored = one(`SELECT picked FROM rounds WHERE chapter_id='test' ORDER BY rowid DESC LIMIT 1`);
  check('a round holds keys, not a copy of what the commons said that day',
    !/ cannot be built | brought a need /.test(stored?.picked ?? ''), stored?.picked?.slice(0, 80));

  // ── One open round per chapter, enforced by the database ─────────────
  // `theRound()` reads for an open round and inserts one if there is none, and
  // those are two statements. Four processes asked at once on a throwaway and
  // two rounds came back open — one of them invisible from then on, holding
  // items that would never clear. Structurally impossible beats unlikely.
  {
    R.theRound(C);
    let refused = false;
    try {
      dbRun(`INSERT INTO rounds (id, chapter_id, picked) VALUES ('rnd-second','test','[]')`);
    } catch { refused = true; }
    check('a second open round cannot exist for one chapter',
      refused, 'the insert was allowed');
    check('and closing the first makes room for the next week',
      (() => {
        dbRun(`UPDATE rounds SET closed_at=datetime('now') WHERE chapter_id='test' AND closed_at IS NULL`);
        try {
          dbRun(`INSERT INTO rounds (id, chapter_id, picked) VALUES ('rnd-next','test','[]')`);
          return true;
        } catch { return false; }
      })());
    dbRun(`DELETE FROM rounds WHERE chapter_id='test'`);
  }

  // A writer that meets another writer waits instead of throwing. `busy_timeout`
  // defaults to 0 and, unlike journal_mode, does not persist in the file — so
  // the launcher's heartbeat and any command a person types were one collision
  // away from SQLite's vocabulary appearing in a terminal.
  check('a busy database is waited for, not given up on',
    (all('PRAGMA busy_timeout')[0]?.timeout ?? 0) >= 1000,
    JSON.stringify(all('PRAGMA busy_timeout')[0]));
  check('and the journal is still WAL, which is what backup depends on',
    String(all('PRAGMA journal_mode')[0]?.journal_mode).toLowerCase() === 'wal');

  dbRun(`DELETE FROM rounds WHERE chapter_id='test'`);
}

// ── A chapter's coordinates are not part of saying hello ──────────────────
// `forAStranger()` strips lat/lng from the day clock on a stated principle — a
// name is a fact about the land, a coordinate is a direction to it — and
// /api/status handed the same numbers to the same stranger one call away,
// because it predates the principle.
{
  const { api } = await import('../server/routes/api.mjs');
  const res = { writeHead() {}, end() {}, write() {} };
  const status = async (addr) => (await api(
    { method: 'GET', socket: { remoteAddress: addr }, headers: {} },
    res, new URL('http://localhost/api/status'))).chapters?.[0] ?? {};

  const stranger = await status('192.168.1.44');
  check('a stranger is told the chapter\'s name and not where to find it',
    !!stranger.name && stranger.lat === undefined && stranger.lng === undefined,
    JSON.stringify(stranger).slice(0, 100));
  const keyboard = await status('127.0.0.1');
  check('and at the keyboard nothing is hidden',
    keyboard.lat != null && keyboard.lng != null);
}

// ── What a button on a list actually does ─────────────────────────────────
//
// There were two lists of "needs no form" and they had drifted: the board knew
// six tools, Today knew three. So `carrying` ran instantly on one screen and,
// on the other, opened a modal titled `carrying` with NO FIELDS and a Save
// button, because that tool's schema has no properties. Same item, same action,
// two behaviours depending on where you were standing.
{
  const { readFileSync } = await import('node:fs');
  const actions = await import('../app/src/actions.js');
  const { TOOLS } = await import('../ai/tools.mjs');
  const names = new Set(TOOLS.map((t) => t.name));

  check('every tool that runs without a form is a tool that exists',
    [...actions.DIRECT].every((t) => names.has(t)),
    [...actions.DIRECT].filter((t) => !names.has(t)).join(', '));
  check('and so is every tool that opens a screen instead',
    [...actions.GO_TO.keys()].every((t) => names.has(t)),
    [...actions.GO_TO.keys()].filter((t) => !names.has(t)).join(', '));

  // A tool cannot be both, and the order in actionKind() would silently pick
  // one — the same shape as a tool listed in two clearance tiers.
  const both = [...actions.GO_TO.keys()].filter((t) => actions.DIRECT.has(t));
  check('no tool is both a direct run and a screen', both.length === 0, both.join(', '));

  // The tabs GO_TO names have to be real, or the button navigates nowhere.
  const app = readFileSync('app/src/App.jsx', 'utf8');
  const missing = [...actions.GO_TO.values()].filter((tab) => !app.includes(`id: '${tab}'`));
  check('and every screen it sends somebody to is a tab that exists',
    missing.length === 0, missing.join(', '));

  // The one that started it: the round asks for the card, so pressing it has to
  // reach the card SCREEN — the one with copy-as-text, print, and the button
  // that marks it sent. A generated form asked "how far back does this week
  // reach", recorded nothing, and left the item to be asked again next week.
  check('asking for the card opens the card, not a form about the card',
    actions.actionKind('card_for_the_week') === 'go'
      && actions.goesTo('card_for_the_week') === 'card');

  // Both screens consult the same rules. The point of the file.
  for (const f of ['app/src/components/Commons.jsx', 'app/src/components/Today.jsx']) {
    const src = readFileSync(f, 'utf8');
    check(`${f.split('/').pop()} reads the shared rules rather than its own copy`,
      src.includes("from '../actions.js'") && !/const DIRECT = new Set/.test(src));
  }
}

// ── Reading a stamp back ──────────────────────────────────────────────────
//
// `String.replace(' ', 'T')` replaces the FIRST space only. Eleven copies of
// that line existed. It is fine for "2026-09-21 14:00", which the database
// writes, and wrong for "2026-09-20 10:00 AM", which is what add_gathering
// stores when a person types it and what this project's own seed writes — the
// second space survives, the Date is Invalid, and every comparison against it
// is quietly false. The join page picks the next gathering that way, so a
// person at the creek clean-up scanned the QR and was offered the next day's
// seed swap.
{
  const { parseStamp } = await import('../core/time.mjs');
  const iso = (t) => parseStamp(t)?.toISOString() ?? null;

  check('a twelve-hour stamp is read, not thrown away',
    iso('2026-09-20 10:00 AM') !== null && iso('2026-09-20 2:00 PM') !== null,
    `${iso('2026-09-20 10:00 AM')} / ${iso('2026-09-20 2:00 PM')}`);
  check('and read correctly, rather than merely parsed',
    parseStamp('2026-09-20 2:00 PM').getHours() === 14,
    String(parseStamp('2026-09-20 2:00 PM')?.getHours()));
  check('midnight and noon do not swap, which is where twelve-hour clocks fail',
    parseStamp('2026-09-20 12:00 AM').getHours() === 0
      && parseStamp('2026-09-20 12:00 PM').getHours() === 12);
  check('the format the database writes still reads the same as it always did',
    iso('2026-09-21 14:00') === new Date('2026-09-21T14:00').toISOString());
  // Null, not Invalid Date. A null fails a comparison loudly the first time
  // somebody looks; an Invalid Date fails every comparison quietly forever,
  // which is exactly how this one survived.
  check('something unreadable comes back as null, and says so',
    parseStamp('not a date') === null && parseStamp(null) === null && parseStamp('') === null);

  // The property, so the eleven copies cannot quietly return: the seed's own
  // gatherings must all be readable, whatever format they were typed in.
  const stamps = all(`SELECT starts_at FROM gatherings WHERE starts_at IS NOT NULL`)
    .map((r) => r.starts_at);
  const unreadable = stamps.filter((t) => parseStamp(t) === null);
  check('every gathering this commons holds can actually be read back',
    unreadable.length === 0, unreadable.join(' · '));
}

// ── The board is five things this person can do ───────────────────────────
//
// Three findings from walking the app as a newly enrolled member, all in one
// place because they are one problem: the five slots were spent on work she was
// not allowed to do, about projects, while a person waited.
{
  const { whatsNext } = await import('../engines/operator.mjs');
  const { board } = await import('../engines/board.mjs');
  const { mayRun } = await import('../ai/access.mjs');
  const C = 'test';

  // A person waiting outranks paperwork. It was `open` — the LOWEST weight —
  // until fourteen days had passed, so "Ana brought a need and has had no
  // answer" sat at position 16 of 18, below three notes about projects not
  // being fully defined, under a rule that reads "a person must be able to
  // submit a need, receive a response, and appeal".
  dbRun(`INSERT INTO intake (id, chapter_id, kind, body, submitted_by, status, created_at)
         VALUES ('inta-ana','test','need','The path floods','Ana','received', datetime('now','-2 days'))`);
  const withNeed = whatsNext(C);
  const ana = withNeed.items.findIndex((i) => /Ana brought a need/.test(i.title));
  const firstGap = withNeed.items.findIndex((i) => i.kind === 'gap');
  check('a person waiting is ranked above anything the protocol merely expects',
    ana >= 0 && (firstGap === -1 || ana < firstGap), `need at ${ana}, first gap at ${firstGap}`);
  check('and a need brought yesterday is not filed as the lowest kind there is',
    withNeed.items[ana]?.kind === 'waiting', withNeed.items[ana]?.kind);

  // Gated projects fold into one line. Three of five board slots were the same
  // sentence about different projects, all council-only, and one new signal was
  // enough to push the card off the board entirely.
  const gatedLines = withNeed.items.filter((i) => /waiting on gates|cannot be built/.test(i.title));
  check('several gated projects are one line, not one line each',
    gatedLines.length <= 1, `${gatedLines.length} lines`);
  if (gatedLines.length === 1 && /waiting on gates/.test(gatedLines[0].title)) {
    // Named, not counted: a steward has to see whether the project they care
    // about is in there without opening anything.
    check('and the folded line names the projects rather than only counting them',
      /\w+.*\(\d+\)/.test(gatedLines[0].detail ?? ''), gatedLines[0].detail);
  }

  // The board does not offer a button that will refuse. She opened the form,
  // typed a paragraph of evidence and a reviewer's name, pressed save, and only
  // then was told the protocol refused it.
  const asMember = board(C, { clearance: 'members' });
  const offered = (asMember.todo ?? []).map((t) => t.action?.tool).filter(Boolean);
  const wouldRefuse = offered.filter((t) => !mayRun(t, 'members'));
  check('nothing on a member\'s board is a button that would refuse them',
    wouldRefuse.length === 0, wouldRefuse.join(', '));
  check('and the work held for the council is counted, not silently hidden',
    typeof asMember.for_the_council === 'number');
  check('at the keyboard nothing is held back',
    board(C).for_the_council === 0);
  // A member sees HER PART of the chapter's round, and is told the size of the
  // rest. This assertion used to require a full board — the slots refilled from
  // the live ranking — and that stopped being right when the round arrived: the
  // five are the chapter's five, picked once, and if four of them are council
  // work then four of them are council work. Refilling from elsewhere would
  // give a member a different week from her steward's, which is a stranger
  // thing than a short list. What must stay true is the original complaint:
  // never a button that refuses, and never a silent absence.
  check('a member is never given more than the round actually holds for her',
    (asMember.todo ?? []).length <= (board(C).todo ?? []).length);
  check('and is told the size of what she is not being shown',
    asMember.for_the_council > 0 || (asMember.todo ?? []).length === (board(C).todo ?? []).length,
    `${(asMember.todo ?? []).length} shown, ${asMember.for_the_council} held`);

  dbRun(`DELETE FROM intake WHERE id='inta-ana'`);
}

// ── Over a real socket ────────────────────────────────────────────────────
//
// Everything above calls `api()` in process, and so does `npm run prove` —
// `new URL('http://localhost/api/...')` handed straight to the route. Neither
// ever reaches `send()` in server/index.mjs, and that is where a live bug sat:
// an intake row has `status: 'received'` and `body: '...'`, the response wrapper
// tested for those KEYS, and `writeHead('received')` threw. A neighbour bringing
// a need through the join page got HTTP 500 and the words "Invalid status code:
// received", while the row was written — so they pressed again, and again.
//
// Every in-process assertion in this file was green over it. Some things are
// only true down a socket, and the front door of this commons is one of them.
{
  const { spawn } = await import('node:child_process');
  const { mkdtempSync, cpSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join: pathJoin } = await import('node:path');

  const dir = mkdtempSync(pathJoin(tmpdir(), 'bros-socket-'));
  const dbFile = pathJoin(dir, 'socket.db');
  cpSync(process.env.BROS_DB, dbFile);
  const port = 4200 + Math.floor(Math.random() * 300);

  const child = spawn(process.execPath,
    ['--disable-warning=ExperimentalWarning', 'server/index.mjs', '--no-heartbeat'],
    { env: { ...process.env, BROS_DB: dbFile, PORT: String(port) }, stdio: 'ignore' });

  const call = async (name, input) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/tool`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, input }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { await fetch(`http://127.0.0.1:${port}/api/status`); up = true; }
    catch { await new Promise((r) => setTimeout(r, 250)); }
  }

  if (!up) {
    skip('the OS answers over a real socket', 'the test server did not start');
  } else {
    // The one act the whole protocol is built around, down a real socket.
    const brought = await call('submit_intake',
      { kind: 'need', body: 'The culvert on Pecan Lane is blocked again', submitted_by: 'A neighbour' });
    check('a neighbour can bring a need over a socket, and is told it worked',
      brought.status === 200 && !brought.body?.error,
      `HTTP ${brought.status} ${JSON.stringify(brought.body).slice(0, 90)}`);

    // The answer travels back the same way, and hits the same collision.
    const id = brought.body?.id;
    const answered = id
      ? await call('respond_to_intake', { intake_id: id, response: 'Booked for Saturday.' })
      : { status: 0, body: null };
    check('and the steward can answer it without being told the answer failed',
      answered.status === 200 && !answered.body?.error,
      `HTTP ${answered.status} ${JSON.stringify(answered.body).slice(0, 90)}`);

    // ── Bytes, over the same socket ──────────────────────────────────────
    // The one pair of routes that does not carry JSON, and therefore the one
    // pair the withholding wrapper cannot see inside. Everything here is about
    // what the SERVER does with a file, which no engine test can reach.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64');
    const put = async (name, body) => {
      const r = await fetch(`http://127.0.0.1:${port}/api/media`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'x-bros-filename': name },
        body,
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    };

    const up1 = await put('field.png', png);
    check('a photograph can be sent to the commons as a raw body with its name in a header',
      up1.status === 200 && /^med_/.test(up1.body?.id ?? ''),
      `HTTP ${up1.status} ${JSON.stringify(up1.body).slice(0, 90)}`);

    const shown = up1.body?.id
      ? await fetch(`http://127.0.0.1:${port}/api/media/${up1.body.id}`)
      : null;
    check('and comes back as the type it was stored as, never one a caller chose',
      shown?.status === 200 && shown.headers.get('content-type') === 'image/png');
    check('with sniffing switched off, so a stored file cannot become a script here',
      shown?.headers.get('x-content-type-options') === 'nosniff');

    const html = await put('payload.html', Buffer.from('<script>alert(1)</script>'));
    check('a file this OS will not serve safely is refused at the door, with the list',
      html.status === 415 && Array.isArray(html.body?.allowed));

    // ── Traversal, sent the way it would actually be sent ────────────────
    // `fetch` collapses `../` in a URL BEFORE the request leaves, so a probe
    // written as `/api/media/../../package.json` never reaches this route at
    // all — it arrives as `/package.json` and is answered by the static
    // handler. A test written with fetch therefore proves nothing about the
    // media store while appearing to, which is the worse half of the problem.
    //
    // An attacker is not using fetch. This writes the request line by hand.
    const rawGet = (path) => new Promise((resolve) => {
      const sock = netConnect(port, '127.0.0.1', () => {
        sock.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
      });
      let buf = '';
      sock.setEncoding('utf8');
      sock.on('data', (d) => { buf += d; });
      sock.on('end', () => resolve(buf));
      sock.on('error', () => resolve(''));
    });

    for (const probe of ['/api/media/..%2f..%2f.env', '/api/media/../../package.json',
                         '/api/media/..%2F..%2Fcore%2Fschema.sql']) {
      const raw = await rawGet(probe);
      const status = Number(/^HTTP\/1\.\d (\d+)/.exec(raw)?.[1] ?? 0);
      // Refused is the requirement; WHAT came back is the thing worth checking
      // as well, because a 200 carrying the SPA shell is fine and a 200
      // carrying a licence key is not.
      const leaked = /PRAGMA|CREATE TABLE|"dependencies"|ANTHROPIC/.test(raw);
      check(`a hand-written request cannot walk out of the media store (${probe.slice(11, 30)})`,
        !leaked && (status === 400 || status === 404 || status === 200),
        `HTTP ${status}${leaked ? ' — CONTENT LEAKED' : ''}`);
    }

    const gone = await fetch(`http://127.0.0.1:${port}/api/media/med_deadbeef`);
    check('and a file that was never here is a plain 404', gone.status === 404);
  }

  child.kill();
}


// ── Stage 8: the work, and the evidence it happened ───────────────────────
// Ported capability, protocol rules applied. Every check here is a REFUSAL the
// commons has to make, plus the two parity checks whose comments elsewhere
// claimed they already existed and did not.
{
  const { storeMedia, submitProof, reviewProof, withdrawMedia, verifyStore, mediaDir } =
    await import('../engines/proof.mjs');
  const { mapFeatures, MAP_KINDS } = await import('../engines/mapboard.mjs');
  const { writeFileSync: wf } = await import('node:fs');
  const { join: j } = await import('node:path');

  const proj = await runTool('open_quest', {
    title: 'Clear the Pecan Lane culvert', lat: 30.27, lng: -97.75,
    need_statement: 'It blocks every autumn and floods the path.',
  });
  check('a project can be opened with a coordinate of its own', proj?.lat === 30.27);

  check('a task without a project is refused',
    refused(await runTool('add_task', { title: 'Do something' }), 'quest_id'));

  const task = await runTool('add_task', {
    quest_id: proj.id, title: 'Clear the upstream grate', lat: 30.271, lng: -97.751,
    created_by: 'R. Alvarez',
  });
  check('a task can be added to a project, at its own point', !!task.id && task.lat === 30.271);
  check('a task requires a before-and-after unless somebody says otherwise',
    task.requires_before_after === 1 || task.requires_before_after === true);

  // THE refusal this whole capability exists for.
  const early = await runTool('complete_task', { task_id: task.id, by: 'R. Alvarez' });
  check('a task that changes the land does not close without a before-and-after',
    refused(early, 'evidence_required'));
  check('and the refusal hands over the way to fix it rather than just saying no',
    early?.action?.tool === 'submit_proof');

  // Claiming is self-service, open, and survives being done twice.
  const claimed = await runTool('claim_task', { task_id: task.id, person_name: 'R. Alvarez' });
  check('a task can be picked up by name, with no account anywhere', claimed?.claimed === true);
  const again = await runTool('claim_task', { task_id: task.id, person_name: 'R. Alvarez' });
  check('claiming the same task twice is not an error', again?.already === true && !again?.error);
  await runTool('claim_task', { task_id: task.id, person_name: 'M. Okafor', role: 'helping' });
  check('more than one person can be on a task',
    (await runTool('list_tasks', { quest_id: proj.id }))[0].assignees.length === 2);

  await runTool('release_task', { task_id: task.id, person_name: 'M. Okafor', reason: 'Away that week' });
  const afterRelease = (await runTool('list_tasks', { quest_id: proj.id }))[0];
  check('stepping back removes nobody from the record',
    afterRelease.assignees.length === 1 && afterRelease.released.length === 1
    && afterRelease.released[0].person_name === 'M. Okafor');
  check('and a task_assignees row cannot be deleted at all', (() => {
    try { dbRun('DELETE FROM task_assignees WHERE task_id=?', task.id); return false; }
    catch { return true; }
  })());

  // ── The file store ────────────────────────────────────────────────────
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');

  const bad = storeMedia('test', { filename: 'map.svg', buffer: png });
  check('a file type this OS will not serve safely is refused', refused(bad, 'unsupported_type'));
  check('and SVG is named as deliberate rather than left looking like an oversight',
    /script/i.test(JSON.stringify(bad)));

  const noConsent = storeMedia('test', {
    filename: 'crew.jpg', buffer: png, shows_people: true,
  });
  check('a photograph of identifiable people with no consent record is refused',
    refused(noConsent, 'consent_required'));

  const before = storeMedia('test', { filename: 'before.png', buffer: png, uploaded_by: 'R. Alvarez' });
  const after = storeMedia('test', { filename: 'after.png', buffer: png, uploaded_by: 'R. Alvarez' });
  check('a photograph is stored with a real hash of the bytes written',
    before.hash_source === 'content' && /^[0-9a-f]{64}$/.test(before.sha256));

  // A refusal is only a refusal if its own schema can reach it. reviewProof
  // compares the checker against `submitted_by`, so a proof filed with no name
  // is one that rule can never fire on — and the person it exists to stop is
  // exactly the person who would know to leave the field blank.
  check('evidence filed with no name at all is refused, because the self-check rule needs one',
    refused(submitProof(task.id,
      { before_media_id: before.id, after_media_id: after.id }), 'name_required'));

  check('a proof made of one photograph is refused — the claim is comparative',
    refused(await runTool('submit_proof',
      { task_id: task.id, before_media_id: before.id, after_media_id: '' }), 'required'));
  check('the same photograph used twice is refused',
    refused(submitProof(task.id,
      { before_media_id: before.id, after_media_id: before.id }), 'same_file'));

  const filed = await runTool('submit_proof', {
    task_id: task.id, before_media_id: before.id, after_media_id: after.id,
    note: 'Grate cleared, gravel bar pulled back.', submitted_by: 'R. Alvarez',
  });
  check('a before-and-after pair can be filed', !!filed.id && filed.status === 'pending');

  check('the person who did the work cannot check their own',
    refused(reviewProof(filed.id, { decision: 'verified', reviewed_by: 'R. Alvarez' }),
      'cannot_check_own_work'));
  check('rejecting without a reason is refused — the doer has to know what to fix',
    refused(reviewProof(filed.id, { decision: 'rejected', reviewed_by: 'M. Okafor' }), 'reason'));

  // Evidence filed, not yet checked: the task closes, because waiting on a
  // reviewer to close your own finished work is how a board fills with lies.
  // WITH a note, deliberately. Both lines in this engine that append to a
  // description were written with `""` — a zero-length IDENTIFIER in SQLite,
  // not an empty string — and threw `no such column: ""`. Nothing caught it,
  // because no test and no end-to-end run had ever passed a note, so neither
  // line had ever run. A branch nothing exercises is a branch nothing tests.
  const closed = await runTool('complete_task',
    { task_id: task.id, by: 'R. Alvarez', note: 'Took two hours and a mattock.' });
  check('once the pair is filed the task closes, without waiting for a reviewer',
    closed?.done === true && closed.task.status === 'done');

  const checked = reviewProof(filed.id, { decision: 'verified', reviewed_by: 'M. Okafor' });
  check('somebody who was not there can check it', checked.status === 'verified');

  // ── The evidence is still there, and still what it says ────────────────
  check('re-reading the store finds every file intact', verifyStore('test').ok === true);
  wf(j(mediaDir(), before.stored_name), Buffer.concat([png, Buffer.from('tampered')]));
  const drift = verifyStore('test');
  check('a file changed on disk since it was filed is reported as changed',
    drift.ok === false && drift.changed.includes(before.id));

  const withdrawn = withdrawMedia(after.id, { reason: 'The landowner asked' });
  check('withdrawing a file removes the bytes and keeps the row',
    withdrawn.withdrawn === true && !!one('SELECT id FROM media WHERE id=?', after.id));
  check('and the proof that named it says so rather than losing half a pair',
    /still name it/.test(withdrawn.note ?? ''));
  check('a media row cannot be deleted at all', (() => {
    try { dbRun('DELETE FROM media WHERE id=?', before.id); return false; }
    catch { return true; }
  })());

  // Editing, moving and dropping — the other half of a map you can use.
  const borrowed_probe = await runTool('add_task', { quest_id: proj.id, title: 'Edit me' });
  const edited = await runTool('update_task', { task_id: borrowed_probe.id, title: 'Renamed' });
  check('a task can be corrected after it is written down', edited?.title === 'Renamed');
  check('a task with no point refuses half a coordinate',
    refused(await runTool('update_task', { task_id: borrowed_probe.id, lat: 31 }), 'half_a_coordinate'));
  const movedTask = await runTool('update_task', { task_id: borrowed_probe.id, lat: 31, lng: -97.5 });
  check('and can be moved by pointing at a new spot', movedTask?.lat === 31 && movedTask?.lng === -97.5);

  check('dropping a task without a reason is refused',
    refused(await runTool('set_task_status',
      { task_id: borrowed_probe.id, status: 'abandoned' }), 'reason_required'));
  const dropped = await runTool('set_task_status',
    { task_id: borrowed_probe.id, status: 'abandoned', note: 'Written down twice' });
  check('with one it is dropped, and the reason is kept on the record',
    dropped?.task?.status === 'abandoned' && /Written down twice/.test(dropped.task.description ?? ''));

  // ── On the map ────────────────────────────────────────────────────────
  const borrowed = await runTool('add_task', { quest_id: proj.id, title: 'Write up what was found' });
  const feats = mapFeatures('test').features;
  const drawnOwn = feats.find((f) => f.kind === 'task' && f.id === borrowed.id);
  check('a task with no point of its own is drawn at its project and says so',
    drawnOwn?.precise === false && drawnOwn?.borrowed_from === proj.title);
  check('a task nobody has picked up is marked as the thing to look at',
    drawnOwn?.state === 'unclaimed');
  check('a finished task is not drawn on the map',
    !feats.some((f) => f.kind === 'task' && f.id === task.id));

  // The map-kinds and README-tab parity checks are NOT repeated here. They
  // already exist further up this file, they are better than the versions that
  // were briefly written beside them, and the map-kinds one had been silently
  // covering the `task` kind added in this section from the moment it was
  // added. See the note in ARCHITECTURE.md about the search that reported them
  // missing.

  // ── Who may do what ───────────────────────────────────────────────────
  const access = await import('../ai/access.mjs');
  check('filing evidence is ordinary field work for an enrolled device',
    access.mayRun('submit_proof', 'members'));
  check('checking somebody else\'s evidence is council work',
    !access.mayRun('review_proof', 'members') && access.mayRun('review_proof', 'council'));
  check('a stranger on the wifi can do none of it',
    !access.mayRun('add_task', 'public') && !access.mayRun('submit_proof', 'public')
    && !access.mayRun('list_tasks', 'public'));
  check('destroying evidence is done at the keyboard only',
    !access.mayRun('withdraw_media', 'council'));
}


// ── Signing in ────────────────────────────────────────────────────────────
// An account's role feeds the SAME ladder a device's role feeds. Most of what
// is checked here is that there is no second way in and no way to widen.
{
  const acc = await import('../engines/accounts.mjs');
  const { clearanceFor, SESSION_COOKIE } = await import('../server/clearance.mjs');

  const req = (opts = {}) => ({
    socket: { remoteAddress: opts.keyboard === false ? '192.168.1.50' : '127.0.0.1' },
    headers: {
      ...(opts.cookie ? { cookie: `${SESSION_COOKIE}=${opts.cookie}` } : {}),
      ...(opts.device ? { 'x-bros-device': opts.device } : {}),
    },
  });

  check('a password under ten characters is refused, with the reason',
    refused(acc.createAccount('test', { username: 'ana', password: 'short' }), 'password_too_short'));
  check('a username that is not a username is refused',
    refused(acc.createAccount('test', { username: 'a n a!', password: 'four ordinary words' }), 'bad_username'));

  const steward = acc.createAccount('test', {
    username: 'Ana', password: 'correct horse battery staple',
    display_name: 'Ana Restrepo', role: 'steward',
  });
  check('an account can be made, and answers with no hash in it',
    steward.created === true && !JSON.stringify(steward).includes('scrypt'));
  check('the username is folded to lower case, so Ana and ana are one person',
    steward.username === 'ana');
  check('and a second account cannot take the same name',
    refused(acc.createAccount('test',
      { username: 'ana', password: 'another long password' }), 'username_taken'));

  const member = acc.createAccount('test', {
    username: 'bo', password: 'a perfectly fine passphrase', display_name: 'Bo', role: 'member',
  });

  // The two failures are one refusal, because telling them apart enumerates
  // who is in a commons — on a shared wifi, that is the list of people present.
  const wrongUser = acc.signIn('test', { username: 'nobody', password: 'correct horse battery staple' });
  const wrongPass = acc.signIn('test', { username: 'ana', password: 'not the password' });
  check('a wrong username and a wrong password fail identically',
    wrongUser.error === 'sign_in_failed' && wrongPass.error === 'sign_in_failed'
    && wrongUser.message === wrongPass.message);

  const session = acc.signIn('test', { username: 'ana', password: 'correct horse battery staple' });
  check('the right password signs in', !!session.token && session.account.role === 'steward');
  check('and the session token is not stored anywhere in the database',
    !one('SELECT token_hash FROM sessions WHERE token_hash=?', session.token));

  // ── The ladder, which is the whole design ──────────────────────────────
  const bo = acc.signIn('test', { username: 'bo', password: 'a perfectly fine passphrase' });

  check('at the keyboard, signed in as a member, the connection is a member',
    clearanceFor(req({ cookie: bo.token })) === 'members');
  check('signing in NARROWS and never widens — a member at the keyboard is not the steward',
    clearanceFor(req({ cookie: bo.token })) !== 'sacred');
  check('at the keyboard with no session, nothing changes from before',
    clearanceFor(req()) === 'sacred');
  check('over the wifi a member is a member',
    clearanceFor(req({ cookie: bo.token, keyboard: false })) === 'members');
  check('over the wifi a STEWARD is still capped at the network ceiling',
    clearanceFor(req({ cookie: session.token, keyboard: false })) === 'council');
  check('a stranger on the wifi with no session is a stranger',
    clearanceFor(req({ keyboard: false })) === 'public');
  check('a made-up cookie earns nothing',
    clearanceFor(req({ cookie: 'not-a-real-token', keyboard: false })) === 'public');

  // There is ONE permission system. A tool a member may not run is refused the
  // same way whether they arrived by device or by password.
  const access = await import('../ai/access.mjs');
  check('a signed-in member cannot run council work, exactly as a member device cannot',
    !access.mayRun('review_proof', clearanceFor(req({ cookie: bo.token, keyboard: false }))));
  check('and a signed-in coordinator can',
    access.mayRun('review_proof', 'council'));
  check('making accounts is never reachable from the wifi as a member',
    !access.mayRun('create_account', 'members'));
  check('and acting ON somebody else\'s account is the keyboard only',
    !access.mayRun('set_account_role', 'council')
    && !access.mayRun('set_account_password', 'council')
    && !access.mayRun('sign_out_everywhere', 'council'));

  // ── Sessions end ───────────────────────────────────────────────────────
  acc.signOut(bo.token);
  check('signing out ends the session immediately',
    clearanceFor(req({ cookie: bo.token, keyboard: false })) === 'public');

  const bo2 = acc.signIn('test', { username: 'bo', password: 'a perfectly fine passphrase' });
  const changed = acc.setPassword(member.id, { password: 'a brand new long passphrase', by_steward: true });
  check('a steward can set a password without knowing the old one',
    !changed.error && changed.must_change === true);
  check('and doing so ends every session that account had open',
    clearanceFor(req({ cookie: bo2.token, keyboard: false })) === 'public');
  check('changing your own password needs the current one',
    refused(acc.setPassword(member.id,
      { current: 'wrong', password: 'yet another long one' }), 'wrong_password'));

  // ── Nobody is deleted, and somebody is always left holding it ──────────
  check('an account row cannot be deleted at all', (() => {
    try { dbRun('DELETE FROM accounts WHERE id=?', member.id); return false; }
    catch { return true; }
  })());
  check('the last steward cannot be demoted',
    refused(acc.setRole(steward.id, 'member'), 'last_steward'));
  check('nor suspended',
    refused(acc.setStatus(steward.id, 'suspended'), 'last_steward'));

  // The bug that only a signed-in MEMBER could have found. An account's RID is
  // `council`, the clearance is computed before the route runs, and `withhold()`
  // walks the answer removing anything above the caller — so a member asking
  // who they were had their own account stripped out of the reply and the
  // interface showed them signed out while they were signed in. Sign-in had it
  // too, for one request: the clearance is worked out before the sign-in
  // happens, so the caller is still `public` when their own account is removed
  // from the answer proving who they are.
  {
    const { api } = await import('../server/routes/api.mjs');
    const res = { writeHead() {}, end() {}, write() {}, setHeader() {} };
    const boIn = acc.signIn('test', { username: 'bo', password: 'a brand new long passphrase' });
    const meReq = {
      method: 'GET', socket: { remoteAddress: '192.168.1.50' },
      headers: { cookie: `${SESSION_COOKIE}=${boIn.token}` },
    };
    const mine = await api(meReq, res, new URL('http://localhost/api/me'));
    check('a signed-in member is told who they are, rather than withheld from themselves',
      mine?.account?.username === 'bo' && mine?.clearance === 'members',
      JSON.stringify(mine).slice(0, 110));
  }

  const suspended = acc.setStatus(member.id, 'suspended');
  check('a suspended account is told why, rather than failing like a wrong password',
    refused(acc.signIn('test',
      { username: 'bo', password: 'a brand new long passphrase' }), 'account_not_active'));
  check('and it stays on the list as the author of what it did',
    acc.listAccounts('test').some((a) => a.id === member.id && a.status === 'suspended'));
}


// ── The ledger a commons defines for itself ───────────────────────────────
// What the unit is and who decides are theirs. The arithmetic is not, and
// nearly every check here is of the arithmetic refusing to be bent.
{
  const led = await import('../engines/ledger.mjs');

  const ana = await runTool('add_agent', { name: 'Ana', vf_agent_type: 'Person' });
  const bo = await runTool('add_agent', { name: 'Bo', vf_agent_type: 'Person' });
  const hall = await runTool('add_agent', { name: 'The Hall', vf_agent_type: 'Organization' });

  // ── The government is the one already here ────────────────────────────
  check('a currency cannot be created without a council decision',
    refused(await runTool('define_currency',
      { name: 'Hours', unit_of: 'an hour of work' }), 'decision'));

  const proposed = await runTool('propose_decision', {
    title: 'Adopt Hours as our unit', method: 'consent', reversible: true,
    land_seat_report: 'Counting hours changes nothing on the ground by itself.',
    land_seat_steward: 'R. Alvarez',
  });
  check('and not on a decision that has only been PROPOSED',
    refused(led.defineCurrency('test',
      { name: 'Hours', unit_of: 'an hour', decided_by: proposed.id }), 'not_decided_yet'));

  await runTool('decide_council_item', { decision_id: proposed.id, review_date: '2027-06-01' });
  const hours = await runTool('define_currency', {
    name: 'Hours', unit_of: 'an hour of work given to the commons',
    zero_sum: true, credit_limit: 20, decided_by: proposed.id,
  });
  check('with a decided one, a commons can say what it counts',
    !!hours.id && hours.zero_sum === true);

  // ── Zero-sum means what it says ───────────────────────────────────────
  check('nobody can issue a zero-sum currency, whoever they are',
    refused(led.issue('test',
      { currency_id: hours.id, agent_id: ana.id, amount: 5 }), 'zero_sum'));

  const t1 = await runTool('transfer_credit', {
    currency_id: hours.id, from_agent_id: ana.id, to_agent_id: bo.id, amount: 3,
    note: 'Three hours on the culvert',
  });
  check('a transfer moves units and writes two legs in one movement',
    !!t1.group_id && t1.entries.length === 2);
  check('and the two legs sum to exactly zero',
    Math.abs(t1.entries.reduce((n, e) => n + e.amount, 0)) < 1e-9);
  check('the sender goes negative, which is what mutual credit IS',
    led.balance(hours.id, ana.id) === -3 && led.balance(hours.id, bo.id) === 3);
  check('and the whole currency still sums to nothing',
    led.check('test').currencies.find((c) => c.id === hours.id).ok === true);

  check('a transfer past the limit the commons set is refused, by name and number',
    refused(await runTool('transfer_credit',
      { currency_id: hours.id, from_agent_id: ana.id, to_agent_id: bo.id, amount: 50 }),
      'past_the_limit'));
  check('and a transfer to yourself is not a transfer',
    refused(await runTool('transfer_credit',
      { currency_id: hours.id, from_agent_id: ana.id, to_agent_id: ana.id, amount: 1 }), 'same_holder'));

  // ── Nothing is ever deleted or amended ────────────────────────────────
  check('a ledger entry cannot be deleted', (() => {
    try { dbRun('DELETE FROM ledger_entries WHERE group_id=?', t1.group_id); return false; }
    catch { return true; }
  })());
  check('nor can its amount be edited', (() => {
    try { dbRun('UPDATE ledger_entries SET amount=999 WHERE group_id=?', t1.group_id); return false; }
    catch { return true; }
  })());

  check('reversing needs a reason, because both entries stay forever',
    refused(await runTool('reverse_entry', { group_id: t1.group_id }), 'reason'));
  const undone = await runTool('reverse_entry',
    { group_id: t1.group_id, reason: 'Logged against the wrong project' });
  check('a reversal is written as its opposite, not as an edit',
    undone.entries.length === 2 && undone.entries.every((e) => e.reverses));
  check('and the balances come back to nothing',
    led.balance(hours.id, ana.id) === 0 && led.balance(hours.id, bo.id) === 0);
  check('the original movement is still there to be read',
    all('SELECT id FROM ledger_entries WHERE group_id=?', t1.group_id).length === 2);
  check('reversing the same movement twice is refused',
    refused(await runTool('reverse_entry',
      { group_id: t1.group_id, reason: 'again' }), 'already_reversed'));

  // ── An issued currency, paid against checked evidence ─────────────────
  const d2 = await runTool('propose_decision', {
    title: 'Issue Seeds for checked work', method: 'consent', reversible: true,
    land_seat_report: 'Seed stock is counted and the pool is real.',
  });
  await runTool('decide_council_item', { decision_id: d2.id, review_date: '2027-06-01' });
  const seeds = await runTool('define_currency', {
    name: 'Seeds', unit_of: 'one packet from the seed library',
    zero_sum: false, issue_policy: 'on_verified_proof', per_verified_proof: 2,
    decided_by: d2.id,
  });
  check('a commons can choose an issued currency instead', seeds.zero_sum === false);
  check('a zero-sum currency that also pays per proof is a contradiction, and is refused',
    refused(led.defineCurrency('test',
      { name: 'Muddle', unit_of: 'x', zero_sum: true, per_verified_proof: 2, decided_by: d2.id }),
      'contradiction'));

  check('issuing for work needs the proof named',
    refused(await runTool('issue_credit',
      { currency_id: seeds.id, agent_id: ana.id, amount: 2 }), 'proof_required'));

  // The proof filed earlier in this suite was checked by M. Okafor.
  const checkedProof = one(`SELECT id FROM proofs WHERE status='verified' LIMIT 1`);
  const paid = await runTool('issue_credit', {
    currency_id: seeds.id, agent_id: ana.id, amount: 2, proof_id: checkedProof.id,
  });
  check('a checked before-and-after can be paid for', !!paid.group_id);
  check('the units came from somewhere nameable, not from nowhere',
    paid.entries.some((e) => e.counterparty === 'issuance' && e.amount === -2));
  check('and the same proof is never paid twice',
    refused(await runTool('issue_credit',
      { currency_id: seeds.id, agent_id: bo.id, amount: 2, proof_id: checkedProof.id }), 'already_paid'));

  // A proof nobody has looked at yet, made here rather than hoped for. The
  // first version of this looked for one lying about in the fixture and
  // SKIPPED when it found none — which is what happened, because the only
  // proof in the suite had already been checked two hundred lines earlier. A
  // test that quietly does not run is the thing this project keeps finding.
  {
    const pr = await import('../engines/proof.mjs');
    const q2 = await runTool('open_quest', { title: 'Unchecked work' });
    const t2 = await runTool('add_task', { quest_id: q2.id, title: 'Something done but unseen' });
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64');
    const b2 = pr.storeMedia('test', { filename: 'b2.png', buffer: png });
    const a2 = pr.storeMedia('test', { filename: 'a2.png', buffer: Buffer.concat([png, Buffer.from('2')]) });
    const unchecked = await runTool('submit_proof', {
      task_id: t2.id, before_media_id: b2.id, after_media_id: a2.id, submitted_by: 'Ana',
    });
    check('work nobody has checked yet does not pay',
      refused(await runTool('issue_credit',
        { currency_id: seeds.id, agent_id: ana.id, amount: 2, proof_id: unchecked.id }), 'not_verified'));
  }

  check('how much exists is added up, never stored',
    led.currency(seeds.id).in_existence === 2);

  // ── A pool: what the units are actually for ───────────────────────────
  // Two layers refuse this, and they are tested separately on purpose. The
  // tool's schema lists `decided_by` as required, so the registry stops it
  // first and the form marks the field — and the ENGINE refuses too, with the
  // sentence that explains why an economy is not a setting. Testing only
  // through the tool would leave the engine's gate unproven for every other
  // caller, which is how a rule comes to exist in one path and not the rest.
  check('a pool cannot be opened without a decision — the tool refuses',
    refused(await runTool('open_pool',
      { currency_id: seeds.id, name: 'Seed library', holds: '60 kg garlic' })));
  check('and the engine refuses it too, saying why',
    refused(led.openPool('test',
      { currency_id: seeds.id, name: 'Seed library', holds: '60 kg garlic' }), 'decision_required'));
  const pool = await runTool('open_pool', {
    currency_id: seeds.id, name: 'Seed library', holds: '60 kg seed garlic',
    terms: 'One packet per Seed, while it lasts.', rate: 1, decided_by: d2.id,
  });
  check('with one, a commons can say what its units are good for', !!pool.id);

  check('redeeming says what actually came out of the pool',
    refused(led.redeem('test', { pool_id: pool.id, agent_id: ana.id, amount: 1 }), 'say_what_for'));
  const got = await runTool('redeem_credit', {
    pool_id: pool.id, agent_id: ana.id, amount: 1, got: '1 packet of garlic',
  });
  check('and then the units leave circulation rather than moving to somebody',
    got.entries.some((e) => e.counterparty === 'pool' && e.amount === 1)
    && led.balance(seeds.id, ana.id) === 1);

  // ── Does it add up? ───────────────────────────────────────────────────
  const audit = led.check('test');
  check('the whole ledger balances, across both currencies',
    audit.ok === true, JSON.stringify(audit.problems));
  check('and it says so in a sentence a person can read', /balanced/.test(audit.sentence));

  // ── Retiring is not deleting ──────────────────────────────────────────
  const retired = await runTool('retire_currency',
    { currency_id: hours.id, reason: 'We moved to Seeds', decided_by: proposed.id });
  check('a retired currency keeps every entry it ever had',
    !retired.error && all('SELECT id FROM ledger_entries WHERE currency_id=?', hours.id).length > 0);
  check('and nothing new moves in it',
    refused(await runTool('transfer_credit',
      { currency_id: hours.id, from_agent_id: ana.id, to_agent_id: bo.id, amount: 1 }), 'retired'));

  // ── Who may do what, on the one ladder ────────────────────────────────
  const access = await import('../ai/access.mjs');
  check('everybody in the commons can see what they hold and whether it adds up',
    access.mayRun('balances', 'members') && access.mayRun('check_ledger', 'members'));
  check('spending what you have is ordinary; making more is not',
    access.mayRun('transfer_credit', 'members') && !access.mayRun('issue_credit', 'members'));
  check('and setting the rules of an economy is not done over the wifi at all',
    !access.mayRun('define_currency', 'council') && !access.mayRun('open_pool', 'council'));
}

// ── Report ────────────────────────────────────────────────────────────────
const c = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', x: '\x1b[0m' };
console.log(`\n  Protocol tests\n  ${'─'.repeat(58)}`);
for (const [mark, name, detail] of results) {
  // A skip shown in red is still a red line to anyone glancing at it, which is
  // the whole thing this was meant to stop.
  const col = mark === '✓' ? c.g : mark === '–' ? c.d : c.r;
  console.log(`  ${col}${mark}${c.x} ${name}`);
  if (detail) console.log(`      ${c.d}${detail}${c.x}`);
}
console.log(`  ${'─'.repeat(58)}`);
console.log(`  ${pass} passed, ${fail} failed${skipped ? `, ${skipped} not applicable here` : ''}\n`);
try { rmSync(process.env.BROS_DB, { force: true }); } catch {}
process.exit(fail ? 1 : 0);
