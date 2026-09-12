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
];

export const TOOL_MAP = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

/** Anthropic Messages API tool definitions (no handlers). */
export function anthropicTools() {
  return TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
}

export async function runTool(name, input = {}) {
  const t = TOOL_MAP[name];
  if (!t) return { error: `unknown tool ${name}` };
  try {
    return await t.handler(input ?? {});
  } catch (err) {
    return { error: err.message };
  }
}
