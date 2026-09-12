// ── The one tool registry ─────────────────────────────────────────────────
// Defined once, exposed twice:
//   • mcp/server.mjs  → Claude Code drives the whole OS over MCP
//   • server/routes/ai.mjs → the in-app assistant, same tools, same rules
// Handlers go through the engines, so the protocol gates apply to the AI
// exactly as they apply to a person. The AI cannot write past a red flag.
import { all, one, create, run } from '../core/db.mjs';
import * as council from '../engines/council.mjs';
import * as bio from '../engines/bioregional.mjs';
import * as quest from '../engines/quest.mjs';
import * as exchange from '../engines/exchange.mjs';
import * as steward from '../engines/stewardship.mjs';
import * as murmur from '../adapters/murmurations.mjs';
import * as koi from '../adapters/koi.mjs';
import { atlasGeoJSON, signalsFromGeoJSON } from '../adapters/geo.mjs';
import { ecoregionPolygons } from '../adapters/layers.mjs';
import * as operator from '../engines/operator.mjs';

const S = (props, required = []) => ({ type: 'object', properties: props, required });
const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const bool = (description) => ({ type: 'boolean', description });

function defaultChapter() {
  return one('SELECT id FROM chapters ORDER BY founded_at LIMIT 1')?.id ?? null;
}
const ch = (input) => input.chapter_id || defaultChapter();

export const TOOLS = [
  // ---------- orientation ----------
  {
    name: 'chapter_status',
    description:
      'Overall state of the commons: chapter identity, the seasonal bioregional dashboard ' +
      '(critical/watch signals, unlocated places, overdue indicators), and the Minimum Viable ' +
      'Chapter Test. Start here when asked how the commons is doing.',
    input_schema: S({ chapter_id: str('Chapter id; omit for the default chapter.') }),
    handler: (i) => {
      const id = ch(i);
      if (!id) return { error: 'No chapter yet. Use create_chapter first.' };
      return {
        chapter: one('SELECT * FROM chapters WHERE id=?', id),
        dashboard: bio.dashboard(id),
        minimum_viable_test: council.minimumViableTest(id),
        care_gaps: quest.careGaps(id),
        benefit_flow: exchange.benefitFlow(id),
      };
    },
  },
  {
    name: 'create_chapter',
    description:
      'Found a chapter. The manual requires a chapter to publish what it does AND does not ' +
      'represent — both fields are mandatory, because unbounded claims of representation are ' +
      'the first failure mode of place-based organizing.',
    input_schema: S({
      id: str('Short slug, e.g. barton-creek'),
      name: str('Chapter name'),
      scale: { type: 'string', enum: ['site', 'watershed', 'bioregion', 'ecoregional'] },
      represents: str('What and whom this chapter DOES represent'),
      does_not_represent: str('What and whom it explicitly does NOT represent'),
      lat: num('Centre latitude'), lng: num('Centre longitude'),
      locality: str('Town/city'), region: str('State/province'), country: str('Country'),
    }, ['id', 'name', 'represents', 'does_not_represent']),
    handler: (i) => create('chapters', 'chapter', i.id, { ...i }),
  },

  // ---------- the map & its layers ----------
  {
    name: 'list_places',
    description: 'All places in the chapter with their resolved ecoregion, biome and watershed.',
    input_schema: S({ chapter_id: str('') }),
    handler: (i) => all('SELECT * FROM places WHERE chapter_id=? ORDER BY name', ch(i)),
  },
  {
    name: 'add_place',
    description:
      'Add a place, then resolve it against open reference data (EPA ecoregions, USGS watershed ' +
      'boundaries). Resolution happens automatically — a place without a watershed and ecoregion ' +
      'fails the Minimum Viable Chapter Test.',
    input_schema: S({
      chapter_id: str(''), name: str('Place name'),
      lat: num('Latitude'), lng: num('Longitude'),
      region: str('Human-readable region'), description: str('What this place is'),
    }, ['name', 'lat', 'lng']),
    handler: async (i) => {
      const id = ch(i);
      const p = create('places', 'place', id, {
        chapter_id: id, name: i.name, lat: i.lat, lng: i.lng,
        region: i.region ?? null, description: i.description ?? null,
      });
      return await bio.locate(p.id);
    },
  },
  {
    name: 'locate_place',
    description:
      'Re-resolve a place against the live ecoregion and watershed services. Returns the full ' +
      'nested hierarchy: ecoregion → level III → level II → biome, plus HUC12 subwatershed.',
    input_schema: S({ place_id: str('Place id') }, ['place_id']),
    handler: (i) => bio.locate(i.place_id),
  },
  {
    name: 'get_ecoregion_layer',
    description:
      'Fetch ecoregion polygons as GeoJSON for a bounding box — this is the data behind the 3D ' +
      'map. Use it to answer questions about which ecoregions border each other, how large they ' +
      'are, or what biome a region belongs to. Source: EPA Ecoregions Level III/IV, public domain.',
    input_schema: S({
      west: num('West lng'), south: num('South lat'), east: num('East lng'), north: num('North lat'),
      level: { type: 'string', enum: ['l3', 'l4'], description: 'Level III (coarse) or IV (fine). Default l3.' },
    }, ['west', 'south', 'east', 'north']),
    handler: async (i) => {
      const gj = await ecoregionPolygons(i, { level: i.level ?? 'l3' });
      // Return the summary, not megabytes of coordinates — the map renders the geometry.
      const names = {};
      for (const f of gj.features) {
        const k = i.level === 'l4' ? f.properties.US_L4NAME : f.properties.US_L3NAME;
        names[k] = (names[k] ?? 0) + 1;
      }
      return { feature_count: gj.features.length, ecoregions: names, bbox: [i.west, i.south, i.east, i.north] };
    },
  },
  {
    name: 'get_atlas',
    description:
      'The Living Commons Atlas as GeoJSON — signals and hubs, filtered by the caller\'s clearance. ' +
      'Material above the clearance is counted as redacted, never silently dropped.',
    input_schema: S({
      chapter_id: str(''),
      clearance: { type: 'string', enum: ['public', 'members', 'council', 'restricted', 'sacred'] },
    }),
    handler: (i) => atlasGeoJSON(ch(i), { clearance: i.clearance ?? 'public' }),
  },

  // ---------- observation ----------
  {
    name: 'list_signals',
    description: 'Signals (observations from land and people), newest first.',
    input_schema: S({
      chapter_id: str(''),
      severity: { type: 'string', enum: ['Info', 'Watch', 'Critical'] },
      category: str('Hydrological | Ecological | Climate | Disturbance | Social | Infrastructure | Cultural'),
      limit: num('Default 50'),
    }),
    handler: (i) => all(
      `SELECT * FROM signals WHERE chapter_id=?
        ${i.severity ? 'AND severity=?' : ''} ${i.category ? 'AND category=?' : ''}
       ORDER BY created_at DESC LIMIT ?`,
      ...[ch(i), i.severity, i.category, i.limit ?? 50].filter((v) => v !== undefined && v !== null)
    ),
  },
  {
    name: 'add_signal',
    description: 'Record an observation. Unverified by default — verification is a human act.',
    input_schema: S({
      chapter_id: str(''), place_id: str(''), title: str('Short title'),
      category: str('Hydrological | Ecological | Climate | Disturbance | Social | Infrastructure | Cultural'),
      severity: { type: 'string', enum: ['Info', 'Watch', 'Critical'] },
      description: str('What was observed'), location_name: str(''),
      lat: num(''), lng: num(''), author: str('Who observed it'),
      sensitivity: { type: 'string', enum: ['public', 'members', 'council', 'restricted', 'sacred'] },
    }, ['title']),
    handler: (i) => create('signals', 'signal', ch(i), {
      ...i, chapter_id: ch(i), verified: 0, source_adapter: 'assistant',
    }, i.sensitivity ?? 'public'),
  },
  {
    name: 'ingest_water_data',
    description:
      'Pull live USGS stream gage readings (discharge, gage height) near a place and file them as ' +
      'Hydrological signals. Public domain data. Run this to refresh the water picture.',
    input_schema: S({ place_id: str('Place id') }, ['place_id']),
    handler: (i) => bio.ingestWater(i.place_id),
  },

  // ---------- the work ----------
  {
    name: 'list_quests',
    description: 'Projects and their stage in the 12-step Green Fire Quest pathway.',
    input_schema: S({ chapter_id: str(''), status: str('Open | Active | Paused | Complete | Stopped') }),
    handler: (i) => all(
      `SELECT * FROM quests WHERE chapter_id=? ${i.status ? 'AND status=?' : ''} ORDER BY created_at DESC`,
      ...[ch(i), i.status].filter(Boolean)
    ),
  },
  {
    name: 'open_quest',
    description:
      'Open a project. Its consent and safety gates are created unsatisfied — the quest cannot ' +
      'reach the build stage until each one is closed with evidence and a named reviewer.',
    input_schema: S({
      chapter_id: str(''), title: str('Project title'), place_id: str(''), signal_id: str(''),
      category: str(''), description: str(''), need_statement: str('The need and the place'),
      desired_condition: str('What measurable condition should change, by when, for whom'),
      smallest_experiment: str('The smallest useful and safe experiment'),
      maintenance_owner: str('Who maintains this after the project period'),
    }, ['title']),
    handler: (i) => quest.openQuest(ch(i), { ...i, chapter_id: ch(i) }),
  },
  {
    name: 'quest_gates',
    description:
      'The consent/safety gates on a quest and whether each is satisfied. Use this before ' +
      'claiming a project is ready to build.',
    input_schema: S({ quest_id: str('') }, ['quest_id']),
    handler: (i) => quest.gates(i.quest_id),
  },
  {
    name: 'check_quest_advance',
    description:
      'Ask whether a quest may advance to a stage, and get the specific blocking reasons if not. ' +
      'Read-only — safe to call freely.',
    input_schema: S({ quest_id: str(''), to_stage: str('Target stage') }, ['quest_id', 'to_stage']),
    handler: (i) => quest.canAdvance(i.quest_id, i.to_stage),
  },

  // ---------- council ----------
  {
    name: 'council_agenda',
    description: 'Open council items, plus decisions whose review date has arrived.',
    input_schema: S({ chapter_id: str('') }),
    handler: (i) => ({ agenda: council.agenda(ch(i)), due_for_review: council.dueForReview(ch(i)) }),
  },
  {
    name: 'propose_decision',
    description:
      'Put an item to council. A Land Seat report is REQUIRED: ecological observations, seasonal ' +
      'conditions, downstream effects, uncertainty and red flags. Irreversible items must use a ' +
      'supermajority/consensus or explicit-permission method. The tool refuses otherwise.',
    input_schema: S({
      chapter_id: str(''), title: str(''), body: str(''),
      method: {
        type: 'string',
        enum: ['publish_notify', 'delegated_after_advice', 'consent', 'participatory_fund',
               'supermajority_consensus', 'explicit_permission', 'emergency'],
      },
      scale: { type: 'string', enum: ['site', 'watershed', 'bioregion', 'ecoregional'] },
      reversible: bool('Is this reversible?'),
      land_seat_report: str('REQUIRED. Ecological conditions, downstream effects, uncertainty, red flags.'),
      land_seat_steward: str('Who served the Land Seat'),
      affected_parties: str(''), review_date: str('YYYY-MM-DD'), red_flags: str(''),
    }, ['title', 'land_seat_report']),
    handler: (i) => council.propose(ch(i), { ...i }),
  },
  {
    name: 'minimum_viable_test',
    description:
      'Run the manual\'s ten-question Minimum Viable Chapter Test and return which checks fail ' +
      'and the specific fix for each.',
    input_schema: S({ chapter_id: str('') }),
    handler: (i) => council.minimumViableTest(ch(i)),
  },

  // ---------- exchange & care ----------
  {
    name: 'benefit_flow',
    description:
      'Who carried the work and whether value returned to them. Flags a chapter running on more ' +
      'than 80% unpaid labour — the manual treats exhaustion as a failure mode, not a virtue.',
    input_schema: S({ chapter_id: str('') }),
    handler: (i) => ({
      flow: exchange.benefitFlow(ch(i)),
      contributions: exchange.contributionSummary(ch(i)),
      unacknowledged_terms: exchange.unacknowledgedTerms(ch(i)),
    }),
  },
  {
    name: 'record_exchange',
    description:
      'Log a contribution as a ValueFlows economic event. Paid, contractor, apprentice, credit, ' +
      'work-trade and revenue-share relationships require terms_ack — the contributor must have ' +
      'seen the terms before work began.',
    input_schema: S({
      chapter_id: str(''), quest_id: str(''),
      vf_action: { type: 'string', enum: ['work', 'produce', 'consume', 'use', 'transfer', 'give', 'receive', 'raise', 'lower', 'cite', 'accept'] },
      provider_id: str('Agent id'), receiver_id: str('Agent id'),
      resource_name: str('What was contributed'), vf_quantity: num(''), vf_unit: str('e.g. hour'),
      relationship: { type: 'string', enum: ['paid', 'contractor', 'apprentice', 'credit', 'work_trade', 'volunteer', 'revenue_share'] },
      terms_ack: bool('Has the contributor acknowledged the terms?'), note: str(''),
    }, ['vf_action', 'relationship']),
    handler: (i) => exchange.record(ch(i), { ...i }),
  },

  // ---------- federation & knowledge ----------
  {
    name: 'discover_peers',
    description:
      'Search the Murmurations network for other place-based and regenerative organizations near ' +
      'this chapter, and record them as federation peers. This is how a chapter finds its neighbours.',
    input_schema: S({ chapter_id: str(''), range: str('e.g. 100km'), tags: str('Comma-separated filter tags') }),
    handler: async (i) => {
      const c = one('SELECT * FROM chapters WHERE id=?', ch(i));
      const res = await murmur.discoverNearby({ lat: c?.lat, lng: c?.lng, range: i.range ?? '100km', tags: i.tags });
      const added = murmur.recordPeers(res.peers);
      return { found: res.peers.length, newly_recorded: added, stale: res.stale, peers: res.peers.slice(0, 25) };
    },
  },
  {
    name: 'murmurations_profile',
    description:
      'Generate (and validate against the live Murmurations Library) the public profile that makes ' +
      'this chapter discoverable to the wider network. Returns the JSON to host at a public URL.',
    input_schema: S({ chapter_id: str(''), primary_url: str('Public URL where the profile will be hosted') }),
    handler: async (i) => {
      const c = one('SELECT * FROM chapters WHERE id=?', ch(i));
      const profile = murmur.chapterProfile(c, { primaryUrl: i.primary_url });
      const validation = await murmur.validate(profile).catch((e) => ({ ok: false, error: e.message }));
      return { profile, validation };
    },
  },
  {
    name: 'knowledge_manifest',
    description:
      'The KOI-style manifest of what knowledge exists here and at what sensitivity — what could ' +
      'travel to another chapter, and what is withheld. Labels travel; material stays.',
    input_schema: S({
      chapter_id: str(''),
      clearance: { type: 'string', enum: ['public', 'members', 'council', 'restricted', 'sacred'] },
    }),
    handler: (i) => koi.manifest(ch(i), { clearance: i.clearance ?? 'public' }),
  },

  // ---------- the guardrail ----------
  {
    name: 'log_ai_use',
    description:
      'Record that AI materially shaped a public report, map, plan, match or recommendation. ' +
      'The manual requires this whenever AI output reaches people. A named human reviewer is ' +
      'mandatory; restricted or sacred material also needs a correction path. Call this after ' +
      'you produce anything the chapter will act on or publish.',
    input_schema: S({
      chapter_id: str(''), tool: str('e.g. Claude Opus 5 via BioRegional OS'),
      purpose: str('What the AI did'),
      data_class: { type: 'string', enum: ['public', 'members', 'council', 'restricted', 'sacred'] },
      human_reviewer: str('REQUIRED — the person accountable for this output'),
      known_limits: str(''), correction_path: str(''), affected_object_rid: str(''),
    }, ['tool', 'purpose', 'human_reviewer']),
    handler: (i) => steward.logAI(ch(i), { ...i }),
  },

  // ---------- Stage 2: Listen ----------
  {
    name: 'list_intake',
    description:
      'Community intake — needs, ideas, stories, resources, opportunities and concerns people ' +
      'have brought. Private items are excluded unless include_private is true.',
    input_schema: S({
      chapter_id: str(''),
      status: { type: 'string', enum: ['received','acknowledged','in_council','routed','declined','appealed'] },
      include_private: bool('Include items marked private. Default false.'),
    }),
    handler: (i) => all(
      `SELECT * FROM intake WHERE chapter_id=? ${i.include_private ? '' : 'AND private=0'}
        ${i.status ? 'AND status=?' : ''} ORDER BY created_at DESC`,
      ...[ch(i), i.status].filter(Boolean)
    ),
  },
  {
    name: 'submit_intake',
    description:
      'Someone brings a need, idea, story, resource, opportunity or concern. This is Stage 2 of ' +
      'the loop and the front door of the whole commons. Mark it private if it contains personal ' +
      'circumstances — private items stay out of public listings and exports.',
    input_schema: S({
      chapter_id: str(''),
      kind: { type: 'string', enum: ['need','idea','story','resource','opportunity','concern'] },
      body: str('What they said, in their words where possible'),
      submitted_by: str('Who brought it'),
      contact: str('How to reach them back'),
      affected_parties: str('Who else this touches'),
      private: bool('Keep out of public listings'),
    }, ['body']),
    handler: (i) => create('intake', 'intake', ch(i), {
      ...i, chapter_id: ch(i), status: 'received',
    }, i.private ? 'council' : 'members'),
  },
  {
    name: 'respond_to_intake',
    description:
      'Answer someone who brought something, and move it out of "received". The protocol requires ' +
      'that a person can submit a need, receive a response, and appeal — this closes the second leg.',
    input_schema: S({
      intake_id: str('Intake id'),
      response: str('What the commons is saying back'),
      status: { type: 'string', enum: ['acknowledged','in_council','routed','declined','appealed'] },
    }, ['intake_id', 'response']),
    handler: (i) => {
      const row = one('SELECT * FROM intake WHERE id=?', i.intake_id);
      if (!row) return { error: 'not_found' };
      if (i.status === 'declined' && !i.response.trim()) {
        return { error: 'reason_required', message: 'Declining without a reason is not a response.' };
      }
      run(`UPDATE intake SET response=?, status=? WHERE id=?`,
          i.response, i.status ?? 'acknowledged', i.intake_id);
      return one('SELECT * FROM intake WHERE id=?', i.intake_id);
    },
  },

  // ---------- moving work forward (these were unreachable) ----------
  {
    name: 'satisfy_quest_gate',
    description:
      'Close a consent or safety gate on a quest. Requires the evidence and the name of the person ' +
      'who reviewed it — a gate does not close on a checkbox. This is what unblocks a project.',
    input_schema: S({
      quest_id: str(''),
      gate: {
        type: 'string',
        enum: ['rights_holder_consent','indigenous_consent','land_access','youth_safeguarding',
               'permits_insurance','ecological_assessment','maintenance_owner',
               'affected_party_process','data_consent'],
      },
      evidence: str('What actually satisfies this — the document, the conversation, the permit'),
      reviewed_by: str('The person accountable for that judgement'),
    }, ['quest_id', 'gate', 'evidence', 'reviewed_by']),
    handler: (i) => quest.satisfyGate(i.quest_id, i.gate, { evidence: i.evidence, reviewed_by: i.reviewed_by }),
  },
  {
    name: 'advance_quest',
    description:
      'Move a quest to the next stage of the Green Fire Quest pathway. Refuses with specific ' +
      'reasons if gates are open, no maintenance owner is named, no baseline exists, or nothing ' +
      'has been written down. Check first with check_quest_advance.',
    input_schema: S({
      quest_id: str(''),
      to_stage: {
        type: 'string',
        enum: ['signal','listening','baseline','council_review','research','co_design',
               'resource_plan','prototype','teach_tell','test','decide','report_replicate'],
      },
    }, ['quest_id', 'to_stage']),
    handler: (i) => quest.advance(i.quest_id, i.to_stage),
  },
  {
    name: 'update_quest',
    description:
      'Fill in or correct a quest definition — the need, the desired measurable condition, the ' +
      'smallest useful experiment, ecological fit, budget, maintenance owner, end-of-life plan.',
    input_schema: S({
      quest_id: str(''), need_statement: str(''), desired_condition: str(''),
      smallest_experiment: str(''), ecological_fit: str(''), budget_note: str(''),
      maintenance_owner: str(''), end_of_life_plan: str(''),
      status: { type: 'string', enum: ['Open','Active','Paused','Complete','Stopped'] },
    }, ['quest_id']),
    handler: (i) => {
      const fields = ['need_statement','desired_condition','smallest_experiment','ecological_fit',
                      'budget_note','maintenance_owner','end_of_life_plan','status']
        .filter((f) => i[f] !== undefined);
      if (!fields.length) return { error: 'nothing_to_update' };
      run(`UPDATE quests SET ${fields.map((f) => `${f}=?`).join(',')} WHERE id=?`,
          ...fields.map((f) => i[f]), i.quest_id);
      return one('SELECT * FROM quests WHERE id=?', i.quest_id);
    },
  },
  {
    name: 'decide_council_item',
    description:
      'Finalise a council decision. Refuses while a red flag is open, and refuses without a review ' +
      'date — monitoring must be able to change the decision later.',
    input_schema: S({
      decision_id: str(''), review_date: str('YYYY-MM-DD — when this gets looked at again'),
    }, ['decision_id']),
    handler: (i) => council.decide(i.decision_id, { review_date: i.review_date }),
  },
  {
    name: 'clear_red_flag',
    description:
      'Record that a red flag on a council item has been resolved, and how. The text of what was ' +
      'resolved is kept in the decision body so the history is not erased.',
    input_schema: S({
      decision_id: str(''), resolution: str('How the objection was answered or the harm prevented'),
      resolved_by: str('Who resolved it'),
    }, ['decision_id', 'resolution', 'resolved_by']),
    handler: (i) => {
      const d = one('SELECT * FROM decisions WHERE id=?', i.decision_id);
      if (!d) return { error: 'not_found' };
      if (!d.red_flags) return { error: 'no_red_flag', message: 'There is no open red flag on this item.' };
      run(`UPDATE decisions SET red_flags=NULL, body = COALESCE(body,'') ||
             char(10) || char(10) || '[Red flag resolved ' || date('now') || ' by ' || ? || '] ' ||
             'Was: ' || ? || ' — Resolution: ' || ?
           WHERE id=?`,
          i.resolved_by, d.red_flags, i.resolution, i.decision_id);
      return one('SELECT * FROM decisions WHERE id=?', i.decision_id);
    },
  },

  // ---------- Stage 11: Measure ----------
  {
    name: 'list_indicators',
    description: 'Indicators and their latest measurements — what is actually being tracked and whether it moved.',
    input_schema: S({ chapter_id: str(''), quest_id: str('') }),
    handler: (i) => all(
      `SELECT i.*,
              (SELECT value FROM measurements m WHERE m.indicator_id=i.id ORDER BY m.measured_at DESC LIMIT 1) AS latest_value,
              (SELECT measured_at FROM measurements m WHERE m.indicator_id=i.id ORDER BY m.measured_at DESC LIMIT 1) AS latest_at,
              (SELECT COUNT(*) FROM measurements m WHERE m.indicator_id=i.id) AS measurement_count
         FROM indicators i WHERE i.chapter_id=? ${i.quest_id ? 'AND i.quest_id=?' : ''}
        ORDER BY i.created_at DESC`,
      ...[ch(i), i.quest_id].filter(Boolean)
    ),
  },
  {
    name: 'add_indicator',
    description:
      'Define what will be measured. The protocol requires a baseline, a desired condition with a ' +
      'date, a method, and a DECISION TRIGGER — the result that would force the project to change, ' +
      'pause or stop. An indicator without a trigger is decoration.',
    input_schema: S({
      chapter_id: str(''), quest_id: str(''), name: str('What is being measured'),
      unit: str('metres, litres, count, degrees C…'),
      baseline_value: num('What was true before'), baseline_at: str('YYYY-MM-DD'),
      target_value: num('What should be true'), target_by: str('YYYY-MM-DD'),
      method: str('Who measures, how, to what standard'),
      cadence: str('How often'),
      decision_trigger: str('REQUIRED. What result causes adaptation, pause, escalation or stopping'),
      stewardship_horizon: str('Who checks again after the project ends, and for how long'),
    }, ['name', 'decision_trigger']),
    handler: (i) => create('indicators', 'indicator', ch(i), { ...i, chapter_id: ch(i) }),
  },
  {
    name: 'record_measurement',
    description:
      'Record a reading against an indicator. Reports whether this crosses the decision trigger, ' +
      'so measurement can actually change a decision rather than just accumulate.',
    input_schema: S({
      indicator_id: str(''), value: num('The reading'),
      uncertainty: num('Plus or minus'), measured_by: str('Who took it'),
      method_note: str('Anything unusual about the conditions'),
      measured_at: str('YYYY-MM-DD, defaults to today'),
    }, ['indicator_id', 'value']),
    handler: (i) => {
      const ind = one('SELECT * FROM indicators WHERE id=?', i.indicator_id);
      if (!ind) return { error: 'not_found' };
      const m = create('measurements', 'measurement', ind.chapter_id, {
        indicator_id: i.indicator_id, value: i.value, uncertainty: i.uncertainty ?? null,
        measured_by: i.measured_by ?? null, method_note: i.method_note ?? null,
        measured_at: i.measured_at ?? null, source_adapter: 'manual',
      });
      // Moving away from the target is the case the manual cares about.
      let direction = null;
      if (ind.baseline_value != null && ind.target_value != null) {
        const wanted = ind.target_value - ind.baseline_value;
        const got = i.value - ind.baseline_value;
        direction = Math.sign(wanted) === Math.sign(got) || got === 0 ? 'toward_target' : 'away_from_target';
      }
      return {
        measurement: m, indicator: ind.name, direction,
        decision_trigger: ind.decision_trigger,
        review_needed: direction === 'away_from_target',
        note: direction === 'away_from_target'
          ? 'This reading moves away from the target. The decision trigger above should be applied now, not at the next review.'
          : null,
      };
    },
  },

  // ---------- Culture, Maker, Media ----------
  {
    name: 'list_gatherings',
    description: 'Gatherings and their care provision score.',
    input_schema: S({ chapter_id: str('') }),
    handler: (i) => all('SELECT * FROM gatherings WHERE chapter_id=? ORDER BY starts_at', ch(i)),
  },
  {
    name: 'add_gathering',
    description:
      'Schedule a gathering. Care provision is part of the record, not an afterthought — a ' +
      'gathering with fewer than two provisions is flagged by the care gap report.',
    input_schema: S({
      chapter_id: str(''), title: str(''), quest_id: str(''), place_id: str(''),
      kind: { type: 'string', enum: ['session','council','workshop','work_party','listening','screening','market','ceremony'] },
      starts_at: str('YYYY-MM-DD HH:MM'), location_name: str(''), description: str(''),
      care_meals: bool('Food provided'), care_transport: bool('Transport help'),
      care_childcare: bool('Child or elder care'), care_accessibility: bool('Accessibility accommodations'),
      care_notes: str('What is actually on offer, and who to ask'),
    }, ['title']),
    handler: (i) => create('gatherings', 'gathering', ch(i), { ...i, chapter_id: ch(i) }),
  },
  {
    name: 'add_hub',
    description: 'Register a hub — a physical or distributed node of the commons.',
    input_schema: S({
      chapter_id: str(''), name: str(''), place_id: str(''),
      type: {
        type: 'string',
        enum: ['Council and Culture House','Field Station','Maker and Repair Lab','Learning Commons',
               'Media and Data Lab','Food, Seed, and Water Node','Resilience and Care Node',
               'Stewardship Hub','Civic Commons'],
      },
      description: str(''), lat: num(''), lng: num(''), stewards_count: num(''),
    }, ['name']),
    handler: (i) => create('hubs', 'hub', ch(i), { ...i, chapter_id: ch(i) }),
  },
  {
    name: 'add_agent',
    description: 'Register a person, organization or ecological agent who takes part in exchange.',
    input_schema: S({
      chapter_id: str(''), name: str(''),
      vf_agent_type: { type: 'string', enum: ['Person','Organization','EcologicalAgent'] },
      role: str(''), contact: str(''),
    }, ['name']),
    handler: (i) => create('agents', 'agent', ch(i), { ...i, chapter_id: ch(i) }),
  },
  {
    name: 'list_agents',
    description: 'Everyone and everything registered as an economic agent in this commons.',
    input_schema: S({ chapter_id: str('') }),
    handler: (i) => all('SELECT * FROM agents WHERE chapter_id=? ORDER BY name', ch(i)),
  },
  {
    name: 'publish_learning',
    description:
      'Write down what was learned so it can travel. Set travels=false for knowledge that must ' +
      'stay in this place — that flag is honoured by the federation layer.',
    input_schema: S({
      chapter_id: str(''), title: str(''), quest_id: str(''),
      kind: { type: 'string', enum: ['guide','workshop','toolkit','case_study','story','protocol'] },
      summary: str('What another place would need to know'),
      license: str('Default CC-BY-SA-4.0'),
      travels: bool('May another chapter receive this? Default true.'),
    }, ['title', 'summary']),
    handler: (i) => create('learn', 'learn', ch(i), {
      ...i, chapter_id: ch(i), travels: i.travels === false ? 0 : 1,
      license: i.license ?? 'CC-BY-SA-4.0',
    }),
  },

  // ---------- Media consent register ----------
  {
    name: 'record_consent',
    description:
      'Register media consent before anything is published. Records who granted it, for what ' +
      'purpose, whether they review before publication, whether they may withdraw, and what ' +
      'benefit sharing was agreed.',
    input_schema: S({
      chapter_id: str(''), subject: str('Who or what the material is about'),
      purpose: str('Exactly what it will be used for'),
      granted_by: str('Who gave consent'), granted_at: str('YYYY-MM-DD'),
      review_before_publication: bool('Default true'), withdrawable: bool('Default true'),
      benefit_sharing: str('What returns to them if this generates value'),
      sensitive_location_masked: bool('Are sensitive locations removed?'),
      notes: str(''),
    }, ['subject', 'purpose']),
    handler: (i) => create('media_consent', 'consent', ch(i), {
      ...i, chapter_id: ch(i),
      review_before_publication: i.review_before_publication === false ? 0 : 1,
      withdrawable: i.withdrawable === false ? 0 : 1,
    }, 'members'),
  },
  {
    name: 'withdraw_consent',
    description:
      'Someone has withdrawn their consent. Marks it immediately and lists what needs to come down. ' +
      'The protocol treats this as non-negotiable.',
    input_schema: S({ consent_id: str(''), reason: str('') }, ['consent_id']),
    handler: (i) => {
      const c = one('SELECT * FROM media_consent WHERE id=?', i.consent_id);
      if (!c) return { error: 'not_found' };
      if (!c.withdrawable) {
        return { error: 'not_withdrawable',
                 message: 'This record was created as non-withdrawable. Escalate to council — do not overwrite it here.' };
      }
      run(`UPDATE media_consent SET withdrawn_at=datetime('now'),
             notes=COALESCE(notes,'') || char(10) || '[Withdrawn] ' || COALESCE(?,'') WHERE id=?`,
          i.reason ?? '', i.consent_id);
      return { withdrawn: one('SELECT * FROM media_consent WHERE id=?', i.consent_id),
               action_required: `Anything published under "${c.purpose}" about "${c.subject}" must be taken down or re-cleared.` };
    },
  },
  {
    name: 'consent_audit',
    description: 'Consent that has been withdrawn, never granted, or has no benefit sharing agreed.',
    input_schema: S({ chapter_id: str('') }),
    handler: (i) => steward.consentAudit(ch(i)),
  },

  // ---------- Atlas layer registry ----------
  {
    name: 'register_atlas_layer',
    description:
      'Record one of the twelve Living Commons Atlas layers: what it is, where it came from, its ' +
      'licence, and how sensitive it is. Sensitive species locations, sacred places and personal ' +
      'information must be classified above "public".',
    input_schema: S({
      chapter_id: str(''),
      layer_no: num('1-12, matching the atlas layer list in the protocol'),
      name: str(''), source: str('Where the data came from'), source_license: str(''),
      sensitivity: { type: 'string', enum: ['public','members','council','restricted','sacred'] },
      geojson_path: str('Path to a local file, if any'), notes: str(''),
    }, ['layer_no', 'name']),
    handler: (i) => create('atlas_layers', 'atlas_layer', ch(i), { ...i, chapter_id: ch(i) },
                           i.sensitivity ?? 'public'),
  },
  {
    name: 'list_atlas_layers',
    description: 'Which of the twelve atlas layers exist, their sources, licences and sensitivity.',
    input_schema: S({ chapter_id: str('') }),
    handler: (i) => {
      const rows = all('SELECT * FROM atlas_layers WHERE chapter_id=? ORDER BY layer_no', ch(i));
      const NAMES = ['Ecoregions','Watersheds and flow direction','Water systems','Land and soil',
        'Habitat and biodiversity','Climate stress and hazards','Human settlement and accessibility',
        'Care and essential systems','Skills, spaces, tools, and institutions',
        'Food, energy, material, labor, money, and information flows',
        'Culture, history, and community memory','Active projects, maintenance, and outcomes'];
      const have = new Set(rows.map((r) => r.layer_no));
      return {
        registered: rows,
        missing: NAMES.map((n, idx) => ({ layer_no: idx + 1, name: n }))
                      .filter((l) => !have.has(l.layer_no)),
      };
    },
  },

  // ---------- Federation: actually sending and receiving ----------
  {
    name: 'export_knowledge',
    description:
      'Bundle one object for travel to another chapter. Refuses anything above the given clearance ' +
      'or marked do-not-travel, and strips personal detail. Labels travel; material stays.',
    input_schema: S({
      rid: str('The Reference Identifier, from knowledge_manifest'),
      clearance: { type: 'string', enum: ['public','members','council','restricted','sacred'] },
    }, ['rid']),
    handler: (i) => koi.bundle(i.rid, { clearance: i.clearance ?? 'public' }),
  },
  {
    name: 'publish_to_network',
    description:
      'Post this chapter\'s hosted profile URL to the Murmurations Index so aggregators and other ' +
      'chapters can find it. The profile must already be hosted at a public URL — generate it with ' +
      'murmurations_profile first. This is the one action that makes the chapter publicly visible.',
    input_schema: S({ profile_url: str('The public URL where your profile JSON is hosted') }, ['profile_url']),
    handler: (i) => murmur.postToIndex(i.profile_url),
  },
  {
    name: 'import_field_data',
    description:
      'Import a GeoJSON file of field observations (CoMapeo, Mapeo, QGIS, an agency download) as ' +
      'draft signals. Everything imported lands unverified and members-only until a human reviews it.',
    input_schema: S({
      chapter_id: str(''), path: str('Path to the .geojson file on this computer'),
      place_id: str('Attach to this place'), dry_run: bool('Preview without saving'),
    }, ['path']),
    handler: (i) => {
      const id = ch(i);
      let drafts;
      try { drafts = signalsFromGeoJSON(i.path, { chapterId: id, placeId: i.place_id ?? null }); }
      catch (e) { return { error: `could not read ${i.path}: ${e.message}` }; }
      if (i.dry_run) return { would_import: drafts.length, preview: drafts.slice(0, 10) };
      let n = 0;
      for (const d of drafts) {
        const { sensitivity, ...row } = d;
        create('signals', 'signal', id, row, sensitivity ?? 'members');
        n++;
      }
      return { imported: n, note: 'All imported observations are unverified and members-only until reviewed.' };
    },
  },

  // ---------- what needs doing ----------
  {
    name: 'whats_next',
    description:
      'The single most useful call: everything across all twelve stages that is waiting on a human, ' +
      'ranked by whether it blocks other work or has already slipped. Use this to answer "what ' +
      'should we do?" rather than guessing.',
    input_schema: S({ chapter_id: str('') }),
    handler: (i) => operator.whatsNext(ch(i)),
  },
];

export const TOOL_MAP = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

/** Anthropic Messages API tool definitions (no handlers). */
export function anthropicTools() {
  return TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
}

export async function runTool(name, input = {}) {
  const t = TOOL_MAP[name];
  if (!t) return { error: `unknown tool ${name}` };
  // Required fields are enforced here, not in each handler, so every caller —
  // MCP, the assistant, the REST API, the generated forms — gets the same answer.
  const missing = (t.input_schema?.required ?? []).filter((k) => {
    const v = (input ?? {})[k];
    return v === undefined || v === null || (typeof v === 'string' && !v.trim());
  });
  if (missing.length) {
    return {
      error: 'missing_required',
      message: `${name} requires: ${missing.join(', ')}. ` +
               (t.input_schema.properties[missing[0]]?.description ?? ''),
      missing,
    };
  }
  try {
    return await t.handler(input ?? {});
  } catch (err) {
    return { error: err.message };
  }
}
