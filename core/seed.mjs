// Seed the commons from the Green Fire prototype data (Austin / Barton Creek).
// Everything here is demonstration material — it is labelled as such in the UI.
// Run `npm run seed -- --reset` to start over.
import { db, all, one, create, run, close } from './db.mjs';
import {
  INITIAL_PLACES, INITIAL_HUBS, INITIAL_SIGNALS, INITIAL_QUESTS,
  INITIAL_DECISIONS, INITIAL_GATHERINGS, INITIAL_EXCHANGE,
  INITIAL_LEARN, INITIAL_FEDERATION,
} from './seedData.js';

const CHAPTER = 'barton-creek';

// The prototype used free-text statuses; the schema uses a closed set.
const QUEST_STATUS = {
  'Open': 'Open', 'In Progress': 'Active', 'Active': 'Active',
  'Paused': 'Paused', 'Complete': 'Complete', 'Completed': 'Complete', 'Stopped': 'Stopped',
};
const reset = process.argv.includes('--reset');

db();

if (reset) {
  for (const t of ['quest_gates', 'measurements', 'indicators', 'exchange_events', 'agents',
                   'gatherings', 'decisions', 'quests', 'signals', 'hubs', 'places',
                   'intake', 'learn', 'media_consent', 'ai_log', 'atlas_layers',
                   'federation_peers', 'rids', 'chapters']) {
    run(`DELETE FROM ${t}`);
  }
  console.log('  cleared existing data');
}

if (one('SELECT id FROM chapters WHERE id=?', CHAPTER)) {
  console.log('  chapter already seeded — nothing to do (use --reset to start over)');
  close();
  process.exit(0);
}

create('chapters', 'chapter', CHAPTER, {
  id: CHAPTER,
  name: 'Barton Creek Commons',
  scale: 'watershed',
  represents:
    'A voluntary commons of residents, stewards and organizations coordinating care along the ' +
    'Barton Creek Greenbelt and the Lower Colorado eastside reach in Austin, Texas.',
  does_not_represent:
    'This chapter does not represent the City of Austin, Travis County, Texas Parks and Wildlife, ' +
    'any Indigenous nation, private landowners, or the watershed as a whole. It holds no ' +
    'territorial authority and speaks only for its own members and their documented work.',
  provisional_scope: 'Barton Creek subwatershed and the Lower Colorado eastside commons.',
  lat: 30.2610, lng: -97.7940,
  locality: 'Austin', region: 'Texas', country: 'United States',
});

const placeMap = {};
for (const p of INITIAL_PLACES) {
  const row = create('places', 'place', CHAPTER, {
    chapter_id: CHAPTER, name: p.name, region: p.region, description: p.description,
    lat: p.lat, lng: p.lng, bioregion_name: p.bioregion, ecoregion_name: p.ecoregion,
    watershed_name: p.watershed, health_score: p.healthScore,
  });
  placeMap[p.id] = row.id;
}

for (const h of INITIAL_HUBS) {
  create('hubs', 'hub', CHAPTER, {
    chapter_id: CHAPTER, place_id: placeMap[h.placeId] ?? null, name: h.name,
    type: h.type === 'Stewardship Hub' ? 'Stewardship Hub' : 'Civic Commons',
    description: h.description, lat: h.lat, lng: h.lng, stewards_count: h.stewardsCount ?? 0,
  });
}

const signalMap = {};
for (const s of INITIAL_SIGNALS) {
  const row = create('signals', 'signal', CHAPTER, {
    chapter_id: CHAPTER, place_id: placeMap[s.placeId] ?? null, title: s.title,
    category: s.category, severity: s.severity, location_name: s.locationName,
    lat: s.lat, lng: s.lng, description: s.description, author: s.author,
    verified: s.verified ? 1 : 0, source_adapter: 'manual',
  });
  signalMap[s.id] = row.id;
}

const questMap = {};
for (const q of INITIAL_QUESTS) {
  const row = create('quests', 'quest', CHAPTER, {
    chapter_id: CHAPTER, place_id: placeMap[q.placeId] ?? null,
    signal_id: signalMap[q.relatedSignalId ?? q.signalId] ?? null,
    title: q.title, category: q.category, status: QUEST_STATUS[q.status] ?? 'Open',
    location_name: q.locationName, lat: q.lat, lng: q.lng,
    description: q.description ?? q.summary ?? null,
    stage: 'council_review',
  });
  questMap[q.id] = row.id;
  // Gates start unsatisfied — that is the point.
  for (const gate of ['rights_holder_consent', 'land_access', 'permits_insurance',
                      'maintenance_owner', 'affected_party_process']) {
    create('quest_gates', 'gate', CHAPTER, { quest_id: row.id, gate, required: 1, satisfied: 0 });
  }
}

for (const d of INITIAL_DECISIONS) {
  create('decisions', 'decision', CHAPTER, {
    chapter_id: CHAPTER, title: d.title, body: d.proposal,
    method: d.status === 'Consented' ? 'consent' : 'consent',
    scale: 'watershed',
    status: d.status === 'Consented' ? 'decided' : 'in_review',
    reversible: 1,
    land_seat_report:
      'Seeded record — the original prototype predates the Land Seat requirement. ' +
      'Replace with a real ecological briefing before this decision is reviewed.',
    land_seat_steward: d.author,
    affected_parties: [...(d.governs ?? []), ...(d.outsideAuthority ?? [])].join('; '),
    red_flags: (d.objections ?? []).filter((o) => o.status === 'Active').map((o) => o.text).join(' | ') || null,
    review_date: d.reviewDate ?? null,
    decided_at: d.status === 'Consented' ? d.createdAt : null,
  });
}

for (const g of INITIAL_GATHERINGS) {
  create('gatherings', 'gathering', CHAPTER, {
    chapter_id: CHAPTER, place_id: placeMap[g.placeId] ?? null,
    quest_id: questMap[(g.relatedQuestIds ?? [])[0]] ?? null,
    title: g.title,
    kind: /circle|assembly/i.test(g.type) ? 'council' : 'workshop',
    starts_at: g.date ? `${g.date} ${(g.time ?? '').split(' - ')[0] ?? ''}`.trim() : null,
    location_name: g.locationName, description: g.description,
    rsvp_count: g.rsvpsCount ?? 0,
    care_meals: 0, care_transport: 0, care_childcare: 0, care_accessibility: 0,
    care_notes: 'No care provision recorded yet — see the care gap report.',
  });
}

// Exchange offerings become ValueFlows events with named agents.
for (const e of INITIAL_EXCHANGE) {
  const agent = create('agents', 'agent', CHAPTER, {
    chapter_id: CHAPTER, name: e.author, vf_agent_type: 'Person', role: 'Contributor',
  });
  create('exchange_events', 'exchange_event', CHAPTER, {
    chapter_id: CHAPTER, vf_action: 'give', provider_id: agent.id,
    resource_name: e.title, vf_quantity: 1, vf_unit: 'offering',
    relationship: 'volunteer', terms_ack: 1, note: e.description,
  });
}

for (const l of INITIAL_LEARN) {
  create('learn', 'learn', CHAPTER, {
    chapter_id: CHAPTER, title: l.title, kind: 'guide',
    summary: l.summary, license: 'CC-BY-SA-4.0', travels: 1,
  });
}

for (const f of INITIAL_FEDERATION) {
  run(`INSERT INTO federation_peers (id,name,kind,protocol,bioregion_name,status,notes)
       VALUES (?,?,?,?,?,?,?)`,
    f.id, f.name, 'network', 'manual', f.bioregion,
    f.status === 'Connected' ? 'connected' : 'known',
    `${f.sharedProtocols} shared protocols (seeded record)`);
}

// One indicator with a baseline, so the Measure stage has something to stand on.
const firstQuest = Object.values(questMap)[0];
if (firstQuest) {
  create('indicators', 'indicator', CHAPTER, {
    chapter_id: CHAPTER, quest_id: firstQuest,
    name: 'Exposed bank length at Twin Falls', unit: 'metres',
    baseline_value: 42, baseline_at: '2026-08-01',
    target_value: 15, target_by: '2027-06-01',
    method: 'Tape measure along the scarp, two observers, photographed from fixed points.',
    cadence: 'Quarterly, plus after any flood above bankfull',
    decision_trigger: 'If exposed length increases after one full season, pause plantings and escalate to the watershed circle.',
    stewardship_horizon: 'Re-check annually for five years after project close.',
  });
}

const counts = ['places', 'hubs', 'signals', 'quests', 'decisions', 'gatherings',
                'exchange_events', 'learn', 'federation_peers', 'indicators']
  .map((t) => `${t}=${one(`SELECT COUNT(*) n FROM ${t}`).n}`).join('  ');
console.log(`  seeded ${CHAPTER}\n  ${counts}`);
close();
