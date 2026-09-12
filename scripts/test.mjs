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
import { runTool } from '../ai/tools.mjs';
import { one, all, run as dbRun, db, openPath, create } from '../core/db.mjs';
import * as bioEngine from '../engines/bioregional.mjs';
import { skyToday, sunTimes, nextSolarEvent } from '../adapters/sky.mjs';
import { groundToday, thisWeekInHistory, anchorPlace } from '../engines/ground.mjs';
import { lookAround, beginHere } from '../engines/firstrun.mjs';
import { cardForTheWeek, markCardSent, daysSinceLastCard, safeToSend, credits } from '../engines/dispatch.mjs';
import { findDailyStat } from '../adapters/watershed.mjs';
import { whatMoved, intakePromise } from '../engines/loops.mjs';
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
    const { readdirSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(D.DOSSIER_DIR, 'epa-l4');
    check('no lock file is left behind after a compile',
      !existsSync(dir) || !readdirSync(dir).some((f) => f.endsWith('.lock')));
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

  const files = [
    'README.md',
    ...readdirSync('docs').filter((f) => f.endsWith('.md')).map((f) => join('docs', f)),
    // This file is the checker and quotes the wrong numbers above by way of
    // explanation, so it is the one place a stale count is the point.
    ...readdirSync('scripts').filter((f) => f.endsWith('.mjs') && f !== 'test.mjs').map((f) => join('scripts', f)),
  ];

  const drifted = [], unverifiable = [];
  for (const f of files) {
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    for (const m of text.matchAll(/\b(\d{2,4})\s+(tools|sources|tests)\b/g)) {
      if (m[2] === 'tests') unverifiable.push(`${f}: "${m[1]} tests"`);
      else if (Number(m[1]) !== truth[m[2]]) drifted.push(`${f}: "${m[1]} ${m[2]}" is now ${truth[m[2]]}`);
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
