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
import * as ground from '../engines/ground.mjs';
import * as registry from '../adapters/registry.mjs';
import * as firstrun from '../engines/firstrun.mjs';
import * as loops from '../engines/loops.mjs';
import * as dispatch from '../engines/dispatch.mjs';
import * as attention from '../engines/attention.mjs';
import * as library from '../engines/library.mjs';
import { compile as compileDossier } from '../adapters/dossier.mjs';

const S = (props, required = []) => ({ type: 'object', properties: props, required });
const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const bool = (description) => ({ type: 'boolean', description });

function defaultChapter() {
  return one('SELECT id FROM chapters ORDER BY founded_at LIMIT 1')?.id ?? null;
}
const ch = (input) => input.chapter_id || defaultChapter();

/**
 * The place a land question means when nobody said which — the same anchor
 * ground_today uses, so "how is it out there?" and "what is the soil like?"
 * resolve to the same ground instead of one working and one refusing.
 * Returns null only when the chapter has no located place at all.
 */
function anchorId(input) {
  const chapter = ch(input);
  if (!chapter) return null;
  try { return ground.anchorPlace(chapter)?.id ?? null; } catch { return null; }
}

/** One refusal, so the three land tools word it identically. */
const noWhere = () => ({
  error: 'no_location',
  message: 'Add a place with coordinates, or pass a lat/lng — everything the land ' +
           'can tell you hangs off a point on it.',
  action: { tool: 'add_place', input: {} },
});

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
      source: {
        type: 'string', enum: ['notice', 'manual'],
        description:
          'How it was observed: "notice" for the one-line daily prompt in the interface, "manual" ' +
          'for a full entry by a person. Leave unset when the assistant is recording it — an ' +
          'observation must never be filed as if a human made it.',
      },
    }, ['title']),
    handler: (i) => {
      const { source, ...row } = i;
      return create('signals', 'signal', ch(i), {
        ...row, chapter_id: ch(i), verified: 0, source_adapter: source ?? 'assistant',
      }, i.sensitivity ?? 'public');
    },
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
      // The layer names and the open sources that can fill them come from the
      // registry, not from a second copy of the list living here. The copy that
      // used to sit in this handler is exactly the drift the registry prevents.
      const coverage = registry.layerCoverage(ch(i));
      return {
        registered: all('SELECT * FROM atlas_layers WHERE chapter_id=? ORDER BY layer_no', ch(i)),
        coverage,
        resolved: coverage.filter((l) => l.resolved).length,
        missing: coverage.filter((l) => !l.resolved)
          .map((l) => ({ layer_no: l.layer_no, name: l.name, available_upstream: l.available_upstream })),
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

  // ---------- what the land is doing ----------
  {
    name: 'ground_today',
    description:
      'What the land is doing right now at the chapter\'s anchor place: sun and moon computed ' +
      'locally, live weather and any official hazard alert, the nearest USGS gage measured against ' +
      'its own median for THIS calendar day across the whole period of record, and what this week ' +
      'held in earlier years. Read-only. Use it to answer "how is it out there?" and to open a ' +
      'briefing before anything is asked of anyone.',
    input_schema: S({
      chapter_id: str(''),
      place_id: str('Look out from this place instead of the chapter default.'),
    }),
    handler: (i) => ground.groundToday(ch(i), { place_id: i.place_id ?? null }),
  },
  {
    name: 'this_week_last_year',
    description:
      'Observations, decisions and gatherings recorded near this calendar date in earlier years. ' +
      'The chapter\'s own memory of the season — empty until there is a year of records, and it ' +
      'says so rather than pretending.',
    input_schema: S({
      chapter_id: str(''),
      window_days: num('How many days either side of today to look. Default 3.'),
    }),
    handler: (i) => ground.thisWeekInHistory(ch(i), { window_days: i.window_days ?? 3 }),
  },

  // ---------- the land itself: soil, life, hazard ----------
  // These three take a place_id, a lat/lng, or nothing at all. "Nothing" has to
  // work: ground_today already answers "how is it out there?" with no arguments
  // by resolving the chapter's anchor place, and a person asking "what is the
  // soil like here?" is asking the same kind of question. Refusing one while
  // answering the other is an inconsistency the caller has to learn rather than
  // one they can guess.
  {
    name: 'soil_at',
    description:
      'The ground under a place: soil series, taxonomic order, drainage, whether it is hydric, and ' +
      'depth-weighted pH, organic matter, clay and available water capacity over the top 30 cm — ' +
      'plus elevation and land cover. USDA SSURGO where it covers, ISRIC SoilGrids anywhere else. ' +
      'Resolved once and stored on the place; soil does not change on a schedule. Use it before ' +
      'designing any planting, restoration, septic, drainage or building work.',
    input_schema: S({
      place_id: str('A place to read and update; omit if giving coordinates.'),
      lat: num('Latitude, if no place_id'), lng: num('Longitude, if no place_id'),
      refresh: bool('Re-ask upstream even if the place already has an answer. Rarely needed.'),
    }),
    handler: async (i) => {
      const place = i.place_id ?? anchorId(i);
      if (place) return bio.locate(place, { refresh: !!i.refresh });
      if (i.lat == null || i.lng == null) return noWhere();
      const { groundProfile } = await import('../adapters/soil.mjs');
      return groundProfile(i.lat, i.lng);
    },
  },
  {
    name: 'life_here',
    description:
      'Atlas layer 5 — what lives here. The ranked species list people have actually identified ' +
      'nearby, how deeply the place has been recorded and since when, how many records are of ' +
      'something at risk, and whether the ground is inside a protected area. ' +
      'READ THIS BEFORE PUBLISHING ANYTHING FROM IT: the threatened block comes back at ' +
      '"restricted" and must stay there. No coordinates for rare taxa are requested from any ' +
      'upstream or stored, because aggregating obscured records is how the obscuring gets undone.',
    input_schema: S({
      place_id: str('A place; omit if giving coordinates.'),
      lat: num('Latitude, if no place_id'), lng: num('Longitude, if no place_id'),
      radius_km: num('Search radius in kilometres. Default 10.'),
      limit: num('How many species to list. Default 20.'),
    }),
    handler: async (i) => {
      const opts = { radiusKm: i.radius_km ?? 10, limit: i.limit ?? 20 };
      const place = i.place_id ?? anchorId(i);
      if (place) return bio.lifeHere(place, opts);
      if (i.lat == null || i.lng == null) return noWhere();
      const { lifeHere } = await import('../adapters/life.mjs');
      return lifeHere(i.lat, i.lng, opts);
    },
  },
  {
    name: 'hazards_at',
    description:
      'Atlas layer 6 — official National Weather Service alerts in effect, the FEMA regulatory ' +
      'flood zone, the US Drought Monitor class for the county, and satellite heat detections. ' +
      'With a place_id it also files active alerts as signals and records the flood zone on the ' +
      'place. Standing conditions (flood zone, drought class) are never filed as signals — only ' +
      'things that started. When a source cannot be reached it says so: silence here is never an ' +
      'all-clear.',
    input_schema: S({
      place_id: str('A place; omit if giving coordinates. Required to file signals.'),
      lat: num('Latitude, if no place_id'), lng: num('Longitude, if no place_id'),
      ingest: bool('File active alerts as signals. Default true when a place_id is given.'),
    }),
    handler: async (i) => {
      const place = i.place_id ?? anchorId(i);
      if (place) return bio.hazards(place, { ingest: i.ingest !== false });
      if (i.lat == null || i.lng == null) return noWhere();
      const { hazardsHere } = await import('../adapters/hazards.mjs');
      return hazardsHere(i.lat, i.lng);
    },
  },
  {
    name: 'upstream_sources',
    description:
      'Every open dataset and API this OS can reach: what it is, who publishes it, its licence, ' +
      'which Atlas layer it fills, whether it covers the US only or the whole world, and when it ' +
      'last actually answered. Also names any source that needs a key this machine does not have. ' +
      'Use it to answer "where did this number come from?" and to build the attribution an export ' +
      'has to carry.',
    input_schema: S({ layer_no: num('Only sources for this Atlas layer, 1-12.') }),
    handler: (i) => {
      registry.syncSources();
      const list = i.layer_no ? registry.sourcesForLayer(i.layer_no) : registry.SOURCES;
      const fetched = Object.fromEntries(
        all('SELECT id, last_fetched_at FROM upstream_sources').map((r) => [r.id, r.last_fetched_at]));
      return {
        sources: list.map((s) => ({
          id: s.id, name: s.name, project: s.project, atlas_layer: s.layer,
          license: s.license, attribution: s.attribution, url: s.url,
          coverage: s.coverage, adapter: s.adapter, cadence: s.cadence,
          default_sensitivity: s.sensitivity,
          needs_key: s.requires_key ?? null,
          last_answered: fetched[s.id] ?? null,
          notes: s.notes ?? null,
        })),
        needs_keys: registry.missingKeys(),
        note: 'Declared in adapters/registry.mjs. Licence and attribution live there once, so an ' +
              'export and the map legend cannot disagree about them.',
      };
    },
  },

  // ---------- the first sixty seconds ----------
  {
    name: 'look_around',
    description:
      'Everything this OS can find out about a point, live, WITHOUT WRITING ANYTHING: ' +
      'ecoregion, watershed, the soil under it, what lives around it, the nearest gage against ' +
      'its own period of record, weather, hazards, and today\'s light. Takes a place name ' +
      '("Barton Creek Greenbelt, Austin TX") or a lat/lng. Use it to answer "what is it like ' +
      'there?" for anywhere on earth, and as the first screen a new person ever sees — the ' +
      'reveal comes before any commitment is asked for. depth "quick" answers in seconds; ' +
      '"full" adds soil and species and takes longer.',
    input_schema: S({
      query: str('A place name, address, creek, or road junction.'),
      lat: num('Latitude, if you already have it.'),
      lng: num('Longitude, if you already have it.'),
      depth: { type: 'string', enum: ['quick', 'full'], description: 'Default quick.' },
    }),
    handler: (i) => firstrun.lookAround({
      query: i.query ?? null, lat: i.lat ?? null, lng: i.lng ?? null, depth: i.depth ?? 'quick',
    }),
  },
  {
    name: 'begin_here',
    description:
      'Found a chapter at a point and resolve it against the real world in one pass. ' +
      'Requires BOTH what the chapter represents and what it explicitly does not — that gate is ' +
      'not relaxed for being the first thing somebody does, because the easiest moment to make ' +
      'an unbounded claim of representation is the moment somebody is excited and typing fast.',
    input_schema: S({
      chapter_name: str('What this commons is called'),
      represents: str('What and whom it DOES represent'),
      does_not_represent: str('What and whom it explicitly does NOT represent'),
      place_name: str('The first place — defaults to the chapter name'),
      lat: num('Latitude'), lng: num('Longitude'),
      scale: { type: 'string', enum: ['site', 'watershed', 'bioregion', 'ecoregional'] },
      chapter_id: str('Short slug; derived from the name if omitted'),
      locality: str('Town/city'), region: str('State/province'), country: str('Country'),
    }, ['chapter_name', 'represents', 'does_not_represent', 'lat', 'lng']),
    handler: (i) => firstrun.beginHere(i),
  },

  // ---------- what came of it ----------
  {
    name: 'what_moved',
    description:
      'What people\'s observations actually turned into: the chain from a human observation to ' +
      'the project it started, the gates that closed, the council decision it caused, the ' +
      'measurements taken and the learning written up. Only observations a PERSON made are ' +
      'attributed to a person — gage readings, weather alerts and fire detections are excluded, ' +
      'because crediting somebody for a warning NOAA issued is worse than saying nothing. ' +
      'Use it to answer "did any of this matter?".',
    input_schema: S({
      chapter_id: str(''),
      since_days: num('Only count chains that moved in this many days. Default 90.'),
      limit: num('How many to return. Default 12.'),
    }),
    handler: (i) => loops.whatMoved(ch(i), {
      since_days: i.since_days ?? 90, limit: i.limit ?? 12,
    }),
  },
  {
    name: 'intake_promise',
    description:
      'Whether the commons is keeping the promise the protocol makes: a person can submit a ' +
      'need, receive a response, and appeal. Returns what was brought, what was answered, who ' +
      'has been waiting longest, and how many are past the fourteen-day mark.',
    input_schema: S({ chapter_id: str('') }),
    handler: (i) => loops.intakePromise(ch(i)),
  },
  {
    name: 'carrying',
    description:
      'Who is holding how much of the open work, and who has held the same thing longest. ' +
      'Counts only responsibilities still owed — an open project\'s maintenance owner, a ' +
      'pending decision\'s land seat, a recurring indicator\'s last reader — never finished ' +
      'work, because counting what people have completed would make this a scoreboard. ' +
      'Raises a person by name only when they hold more than half of everything open. Use it ' +
      'to answer "is anybody carrying too much?" before somebody quietly burns out.',
    input_schema: S({ chapter_id: str('') }),
    handler: (i) => attention.carrying(ch(i)),
  },
  {
    name: 'place_attention',
    description:
      'Which ground has actually been attended to lately and which has gone longest without ' +
      'anybody — observations, gatherings and readings a PERSON recorded, over a rolling ' +
      'window. Automated readings are excluded: a creek with a gage on it files data every ' +
      'three hours whether or not a human has been there. Ranks places, never people.',
    input_schema: S({
      chapter_id: str(''),
      days: num('Rolling window in days. Default 90.'),
    }),
    handler: (i) => attention.placeAttention(ch(i), { days: i.days ?? 90 }),
  },

  // ---------- what this locality already publishes ----------
  {
    name: 'discover_local_data',
    description:
      'Find datasets the chapter\'s OWN city or county publishes about a subject — water, soil, ' +
      'trees, flooding, historic sites — by asking the Socrata and ArcGIS Hub catalogues what its ' +
      'local portals hold. This is the layer no federal feed has: a city\'s own monitoring of the ' +
      'creek a chapter organizes around. Anything unambiguously PUBLIC DOMAIN is added to the ' +
      'Atlas automatically; every other licence, including open ones with attribution or ' +
      'share-alike conditions, is held as a candidate for a person to read. Accepting terms on ' +
      'the commons\' behalf is not something this can do for you.',
    input_schema: S({
      chapter_id: str(''),
      subject: str('What to look for: water, creek, soil, trees, flooding, heat, historic sites…'),
      locality: str('Override the chapter\'s own locality'),
      region: str('Override the chapter\'s own region or state'),
      limit: num('How many to consider. Default 12.'),
    }, ['subject']),
    handler: (i) => bio.discoverData(ch(i), {
      subject: i.subject, locality: i.locality, region: i.region, limit: i.limit ?? 12,
    }),
  },
  {
    name: 'list_discovered',
    description:
      'Datasets found on local portals: what was approved, what was declined and why, and what is ' +
      'still waiting on somebody to read a licence.',
    input_schema: S({
      chapter_id: str(''),
      status: { type: 'string', enum: ['candidate', 'approved', 'declined'] },
      subject: str('Only those found while looking for this subject'),
    }),
    handler: (i) => bio.listDiscovered(ch(i), { status: i.status ?? null, subject: i.subject ?? null }),
  },
  {
    name: 'approve_dataset',
    description:
      'Accept a discovered dataset\'s licence on behalf of the commons and put it on the Atlas. ' +
      'REFUSED without a named reviewer: this is somebody agreeing to terms, and a decision with ' +
      'no name on it cannot be questioned later. Public-domain datasets never need this — they ' +
      'approve themselves.',
    input_schema: S({
      dataset_id: str('From list_discovered'),
      reviewed_by: str('Who read the licence and is accepting it'),
      note: str('What the terms require — attribution text, share-alike, anything to honour'),
      sensitivity: { type: 'string', enum: ['public', 'members', 'council', 'restricted', 'sacred'] },
    }, ['dataset_id', 'reviewed_by']),
    handler: (i) => bio.approveDataset(i.dataset_id, {
      reviewed_by: i.reviewed_by, note: i.note ?? null, sensitivity: i.sensitivity ?? 'members',
    }),
  },
  {
    name: 'decline_dataset',
    description:
      'Refuse a discovered dataset, with the reason kept. A refusal nobody can read gets ' +
      're-litigated next season.',
    input_schema: S({
      dataset_id: str(''), reviewed_by: str('Who decided'),
      reason: str('Why — unclear terms, wrong place, superseded, not ours to publish'),
    }, ['dataset_id', 'reason']),
    handler: (i) => bio.declineDataset(i.dataset_id, { reviewed_by: i.reviewed_by ?? null, reason: i.reason }),
  },

  // ---------- reaching the people who are not the steward ----------
  {
    name: 'card_for_the_week',
    description:
      'The weekly card: a short, paste-ready block for the group chat the commons already uses. ' +
      'Carries the land (the part nobody else in that chat can produce), what people\'s ' +
      'observations turned into, the next gathering with its care provision spelled out, and ' +
      'ONE ask pointed at somebody who is not the steward. It SENDS NOTHING — a person posts it. ' +
      'Returns plain text plus structured sections; never carries media, because almost everything ' +
      'this OS can reach is CC-BY-NC and is not redistributed.',
    input_schema: S({
      chapter_id: str(''),
      days: num('How far back "this week" reaches. Default 7.'),
    }),
    handler: (i) => dispatch.cardForTheWeek(ch(i), { days: i.days ?? 7 }),
  },
  {
    name: 'mark_card_sent',
    description:
      'Record that a card was produced and posted, so the OS can notice a long silence. Kept in a ' +
      'local file rather than the database: when a card was last sent is a fact about this ' +
      'computer, not about the commons, and must never travel to another chapter in an export.',
    input_schema: S({ chapter_id: str('') }),
    handler: (i) => dispatch.markCardSent(ch(i)),
  },

  // ---------- the people, the memory, the growing year ----------
  {
    name: 'community_here',
    description:
      'Atlas layers 7-10 — what is already here. Where care can be reached (clinics, pharmacies, ' +
      'food banks, refuges, elder care, childcare, community rooms, public water), what is made ' +
      'and repaired, and how food, materials and energy move. From OpenStreetMap, so it is ' +
      'community-maintained: good for finding what exists, never a substitute for ringing ahead, ' +
      'and absence here is not evidence of absence.',
    input_schema: S({
      chapter_id: str(''), place_id: str('Defaults to the chapter\'s anchor place'),
      lat: num(''), lng: num(''), radius_km: num('Default 3'),
    }),
    handler: async (i) => {
      const place = i.place_id ?? anchorId(i);
      if (place) return bio.communityAt(place, { radiusKm: i.radius_km ?? 3 });
      if (i.lat == null || i.lng == null) return noWhere();
      const { communityHere } = await import('../adapters/community.mjs');
      return communityHere(i.lat, i.lng, { radiusKm: i.radius_km ?? 3 });
    },
  },
  {
    name: 'culture_here',
    description:
      'Atlas layer 11 — this place\'s memory. Historic sites and markers on the ground, Wikipedia ' +
      'articles anchored to it, digitised newspapers that named it, research published about it, ' +
      'and field recordings of what lives here. NOTE ON THE RECORDINGS: most are CC-BY-NC, which ' +
      'this project does not redistribute — audio is linked at its own host and never copied, and ' +
      'no recording may enter an export or anything shared. The counts, species and dates are ' +
      'facts and travel freely.',
    input_schema: S({
      chapter_id: str(''), place_id: str('Defaults to the chapter\'s anchor place'),
      lat: num(''), lng: num(''), radius_km: num('Default 5'),
    }),
    handler: async (i) => {
      const place = i.place_id ?? anchorId(i);
      if (place) return bio.cultureAt(place, { radiusKm: i.radius_km ?? 5 });
      if (i.lat == null || i.lng == null) return noWhere();
      const { cultureHere } = await import('../adapters/culture.mjs');
      return cultureHere(i.lat, i.lng, { radiusKm: i.radius_km ?? 5 });
    },
  },
  {
    name: 'growing_year',
    description:
      'When the land here wakes up, and whether this year is early or late. Thirty-year normal ' +
      'first-leaf and first-bloom dates from the USA-NPN Spring Index with this year\'s anomaly, ' +
      'the USDA hardiness zone, and forty years of monthly climate normals. This is the season ' +
      'clock\'s evidence — the question a seasonal cycle turns on, answerable on day one instead ' +
      'of after years of the chapter\'s own records.',
    input_schema: S({
      chapter_id: str(''), place_id: str('Defaults to the chapter\'s anchor place'),
      lat: num(''), lng: num(''), zip: str('US postal code, for the hardiness zone'),
    }),
    handler: async (i) => {
      const place = i.place_id ?? anchorId(i);
      if (place) return bio.growingYearAt(place, { zip: i.zip ?? null });
      if (i.lat == null || i.lng == null) return noWhere();
      const { growingYear } = await import('../adapters/phenology.mjs');
      return growingYear(i.lat, i.lng, { zip: i.zip ?? null });
    },
  },
  {
    name: 'propose_baseline',
    description:
      'Offer a defensible baseline for an indicator from public record, before anyone types a ' +
      'number. The protocol says monitoring must change decisions, but a decision_trigger set ' +
      'against a guessed baseline cannot honestly fire — so this draws the starting value from ' +
      'open data instead: creek discharge against its own multi-decade median for this calendar ' +
      'day, soil organic matter from the survey, species richness, the normal first-leaf date, ' +
      'climate normals. Every answer carries its source, licence and method. REFUSES rather than ' +
      'guesses: a wrong baseline makes a decision look evidenced when it is not.',
    input_schema: S({
      chapter_id: str(''),
      indicator: str('What is being measured — creek flow, soil organic matter, species richness, first leaf date, temperature'),
      place_id: str('Which place; defaults to the best-resolved one'),
    }, ['indicator']),
    handler: (i) => bio.proposeBaseline(ch(i), { indicator: i.indicator, place_id: i.place_id ?? null }),
  },

  {
    name: 'rsvp_to_gathering',
    description:
      'Say somebody is coming to a gathering that already exists. Increments its count — it does ' +
      'NOT create a gathering, because a phone at the back of a room tapping "I am coming" must ' +
      'never be able to invent an event nobody scheduled.',
    input_schema: S({
      gathering_id: str('The gathering being answered'),
      chapter_id: str(''),
    }, ['gathering_id']),
    handler: (i) => {
      const g = one('SELECT * FROM gatherings WHERE id=?', i.gathering_id);
      if (!g) return { error: 'not_found', message: 'No gathering with that id.' };
      run('UPDATE gatherings SET rsvp_count = rsvp_count + 1 WHERE id=?', g.id);
      const after = one('SELECT title, rsvp_count FROM gatherings WHERE id=?', g.id);
      return { ...after, note: 'Counted. Care provision is what decides who can actually come.' };
    },
  },

  {
    name: 'water_here',
    description:
      'Atlas layers 2 and 3 — what is in the water and where it goes. The nearest mapped channel ' +
      'with its stream order and how much ground drains through it, what it flows toward, and ' +
      'water quality sampling nearby: E. coli, nitrate, dissolved oxygen, turbidity, pH, ' +
      'conductance, temperature. Results are grouped by characteristic AND unit and never ' +
      'averaged across units — nitrate is reported both as N and as NO3 in the same dataset, and a ' +
      'median across the two is a number that corresponds to no measurement. Units that look wrong ' +
      'are flagged rather than printed as if they were concentrations.',
    input_schema: S({
      chapter_id: str(''), place_id: str('Defaults to the chapter\'s anchor place'),
      lat: num(''), lng: num(''),
      radius_km: num('Default 5'), since_years: num('How far back to look for sampling. Default 3.'),
    }),
    handler: async (i) => {
      const opts = { radiusKm: i.radius_km ?? 5, sinceYears: i.since_years ?? 3 };
      const place = i.place_id ?? anchorId(i);
      if (place) return bio.hydrologyAt(place, opts);
      if (i.lat == null || i.lng == null) return noWhere();
      const { hydrologyHere } = await import('../adapters/hydrology.mjs');
      return hydrologyHere(i.lat, i.lng, opts);
    },
  },

  {
    name: 'set_indicator_baseline',
    description:
      'Set the starting value an indicator is measured against. Use it after propose_baseline to ' +
      'accept a value from public record, or to record a reading somebody took. REFUSES to ' +
      'overwrite an existing baseline without a stated reason: moving a baseline rewrites the ' +
      'meaning of every measurement already taken against it, and the old readings do not change ' +
      'to match. Whether the number came from public record or from a person is kept either way.',
    input_schema: S({
      indicator_id: str('From list_indicators'),
      value: num('The baseline value'),
      unit: str('If the indicator has none yet'),
      method: str('How it was arrived at'),
      source: str('Where it came from, if public record'),
      licence: str('The source licence, if public record'),
      measured_at: str('YYYY-MM-DD; defaults to today'),
      reason: str('Required only when replacing a baseline that already exists'),
    }, ['indicator_id', 'value']),
    handler: (i) => bio.setBaseline(i.indicator_id, {
      value: i.value, unit: i.unit ?? null, method: i.method ?? null,
      source: i.source ?? null, licence: i.licence ?? null,
      measured_at: i.measured_at ?? null, reason: i.reason ?? null,
    }),
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

  // ---------- the ecoregion library ----------
  {
    name: 'library_status',
    description:
      'How much of the ecoregion library is downloaded, how much is stale, and which regions this ' +
      'chapter actually sits in. The library works with no network once downloaded.',
    input_schema: S({ chapter_id: str('') }),
    handler: (i) => ({
      coverage: library.coverage(),
      my_regions: ch(i) ? library.myRegions(ch(i)) : null,
      work: ch(i) ? library.workList(ch(i)) : null,
    }),
  },
  {
    name: 'list_regions',
    description:
      'Find ecoregions in the index that ships with the software — all 967 Level IV and 85 Level ' +
      'III. Narrow by free text, by a point, or by adjacency to another region. Entirely offline. ' +
      'Extents are rectangular and ecoregions are not, so a point usually matches several: these ' +
      'are candidates. For the definitive region at a point use locate_place.',
    input_schema: S({
      query: str('Name, code, state or biome — e.g. "Edwards", "30c", "Texas", "Great Plains"'),
      near: { type: 'object', description: 'Only regions whose extent covers this point',
              properties: { lat: { type: 'number' }, lng: { type: 'number' } } },
      next_to: str('Only regions adjacent to this region code'),
      scheme: { type: 'string', enum: ['epa-l4', 'epa-l3'] },
      downloaded_only: bool('Only regions already in the offline library'),
      limit: num('Default 25'),
    }),
    handler: (i) => {
      const scheme = i.scheme ?? 'epa-l4';
      let pool;
      let note = null;

      if (i.next_to) {
        pool = library.neighbours(i.next_to, { scheme, limit: 200 })
          .map((n) => library.region(n.code, { scheme }) ?? n);
      } else if (i.near && i.near.lat != null && i.near.lng != null) {
        const at = library.regionsAt(i.near.lat, i.near.lng);
        pool = scheme === 'epa-l3' ? at.level3 : at.level4;
        note = 'Candidates by rectangular extent. Use locate_place for the authoritative boundary.';
      } else {
        pool = library.regions({ scheme });
      }

      const q = (i.query ?? '').toLowerCase();
      const list = pool
        .filter((r) => !q || `${r.code} ${r.name} ${r.level3_name ?? ''} ${r.biome ?? ''} ${(r.states ?? []).join(' ')}`
          .toLowerCase().includes(q))
        .map((r) => ({
          code: r.code, name: r.name, level3_name: r.level3_name ?? r.name,
          biome: r.biome, states: r.states,
          downloaded: !!library.loadDossier(r.code, scheme),
        }))
        .filter((r) => !i.downloaded_only || r.downloaded);

      return { matches: list.length, note, regions: list.slice(0, i.limit ?? 25) };
    },
  },
  {
    name: 'region_brief',
    description:
      'Everything known about one ecoregion — plants, animals, threatened species, soil, climate, ' +
      'water and local resources — read entirely from disk. Works offline. If it has not been ' +
      'downloaded yet, says so and how to get it.',
    input_schema: S({
      code: str('Ecoregion code, e.g. 30c'),
      scheme: { type: 'string', enum: ['epa-l4', 'epa-l3'] },
    }, ['code']),
    handler: (i) => library.brief(i.code, { scheme: i.scheme ?? 'epa-l4' }),
  },
  {
    name: 'find_species',
    description:
      'Search every downloaded ecoregion for a plant, animal, insect or fungus by common or ' +
      'scientific name, and see which regions it is actually recorded in and how often. Entirely ' +
      'offline. Threatened species are searchable by name; their locations are never stored.',
    input_schema: S({ query: str('e.g. "Ashe juniper", "monarch", "Quercus"'), limit: num('Default 40') },
                    ['query']),
    handler: (i) => library.findSpecies(i.query, { limit: i.limit ?? 40 }),
  },
  {
    name: 'download_region',
    description:
      'Download or refresh one ecoregion\'s dossier from the open upstreams. Only sections past ' +
      'their refresh cadence are fetched, so calling this repeatedly is cheap. Needs a connection; ' +
      'everything it writes is then readable forever offline.',
    input_schema: S({
      code: str('Ecoregion code'),
      scheme: { type: 'string', enum: ['epa-l4', 'epa-l3'] },
      force: bool('Refetch every section even if current'),
    }, ['code']),
    handler: async (i) => {
      const r = await compileDossier(i.code, { scheme: i.scheme ?? 'epa-l4', force: !!i.force });
      if (r.error) return r;
      return {
        region: r.name ?? r.region, code: r.region,
        refreshed: r.refreshed ?? [], unchanged: !!r.unchanged,
        size_kb: r.bytes ? Math.round(r.bytes / 1024) : null,
        note: 'Stored on disk. Readable from now on with no connection.',
      };
    },
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
  // And the allowed VALUES, for the same reason and in the same place. Every enum
  // here is also a CHECK constraint in schema.sql, so an unlisted value was already
  // refused — but by SQLite, arriving as `CHECK constraint failed: kind IN (...)`.
  // That is the right refusal wearing the wrong face: database-speak, from a layer
  // the caller does not know exists, naming a column rather than the field they sent.
  //
  // It lands hardest on the AI callers, which are first-class here. A model handed a
  // schema and then refused for obeying it has no way to self-correct except by
  // guessing, which makes the whole registry untrustworthy rather than just this call.
  //
  // Written as a LIST because enum is not the only way a call can be wrong — unknown
  // field, wrong type and out-of-range all currently reach the catch-all below and
  // come back as raw SQLite too. The aim is a reason the caller can act on for every
  // way a call can be wrong, with the catch-all as the last resort rather than the
  // first responder. Add the next rule here; nothing else has to change.
  const props = t.input_schema?.properties ?? {};
  const given = input ?? {};
  const RULES = [
    {
      error: 'not_allowed_value',
      find: () => Object.entries(props)
        .filter(([k, spec]) => Array.isArray(spec.enum)
          && given[k] !== undefined && given[k] !== null
          && !spec.enum.includes(given[k]))
        .map(([k, spec]) => ({ field: k, got: given[k], allowed: spec.enum })),
      say: (b) => `${name}.${b.field} must be one of: ${b.allowed.join(', ')} — got ${JSON.stringify(b.got)}.`,
    },
  ];
  for (const rule of RULES) {
    const found = rule.find();
    if (found.length) return { error: rule.error, message: rule.say(found[0]), invalid: found };
  }
  try {
    return await t.handler(input ?? {});
  } catch (err) {
    return { error: err.message };
  }
}
