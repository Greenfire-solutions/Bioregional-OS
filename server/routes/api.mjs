import { all, one, create, run, latestMeasurement } from '../../core/db.mjs';
import * as council from '../../engines/council.mjs';
import * as bio from '../../engines/bioregional.mjs';
import * as quest from '../../engines/quest.mjs';
import * as exchange from '../../engines/exchange.mjs';
import * as steward from '../../engines/stewardship.mjs';
import * as koi from '../../adapters/koi.mjs';
import { atlasGeoJSON } from '../../adapters/geo.mjs';
import { ecoregionPolygons, globalEcoregions } from '../../adapters/layers.mjs';
import { exportLedger } from '../../adapters/valueflows.mjs';
import { TOOLS, runTool } from '../../ai/tools.mjs';
import * as heartbeat from '../../engines/heartbeat.mjs';
import { whatsNext } from '../../engines/operator.mjs';
import { humanObservedSql, atPlaceCentroidSql } from '../../core/provenance.mjs';
import { DEMO_CHAPTER_ID } from '../../core/seedData.js';
import { clearanceFor, withhold, FULL } from '../clearance.mjs';
import { aiStream } from './ai.mjs';
import { claudeStream, claudeAvailable } from './claude.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../../core/db.mjs';

const defaultChapter = () => one('SELECT id FROM chapters ORDER BY founded_at LIMIT 1')?.id ?? null;

/**
 * Everything that leaves over HTTP passes through here once.
 *
 * The route answers; then, for any connection below the keyboard, every object
 * the connection may not read is withheld and counted. Streams return
 * undefined and are untouched. Done here rather than inside each route so a
 * route added next month is covered without anybody remembering.
 */
export async function api(req, res, url) {
  const clearance = clearanceFor(req);
  const out = await route(req, res, url, clearance);
  if (out === undefined || clearance === FULL) return out;

  // The tool route has already withheld, and it had to.
  //
  // `runTool` withholds BEFORE it applies a tool's public view, because the
  // view drops the `id` that withhold matches on — get that order wrong and the
  // projection blinds the protection. It also takes a snapshot of what was
  // protected BEFORE the handler ran, so a row the caller just created is not
  // withheld from its own author.
  //
  // Withholding a second time here would throw both of those away: the refusal
  // rule would fire on a receipt for something the caller just wrote, which is
  // how `submit_intake` came to answer a neighbour bringing a need with "That
  // is above what this connection may read."
  //
  // Protection belongs to whoever produced the answer. For tools that is
  // runTool; for every other route it is this wrapper.
  if (url.pathname.replace(/^\/api\/?/, '') === 'tool') return out;
  const deps = { hiddenIds: (levels) => new Set(
    all(`SELECT local_id FROM rids WHERE sensitivity IN (${levels.map(() => '?').join(',')})`, ...levels)
      .map((r) => r.local_id)) };
  // An HTTP envelope is `{ status: <number>, body }`. Testing for the KEYS
  // matched an intake row, which has `status: 'received'` and `body: 'the
  // culvert is blocked'` — so a neighbour bringing a need through the join page
  // had their need treated as a response envelope and got
  // `Invalid status code: received` from Node. The main action of the one
  // screen built for strangers has been broken; it took a stranger actually
  // pressing the button to find it.
  if (out && typeof out === 'object' && Number.isInteger(out.status) && 'body' in out) {
    return { ...out, body: withhold(out.body, clearance, deps) };
  }
  return withhold(out, clearance, deps);
}

async function route(req, res, url, clearance) {
  const p = url.pathname.replace(/^\/api\/?/, '');
  const q = Object.fromEntries(url.searchParams);
  const chapterId = q.chapter || defaultChapter();
  // `clearance` is earned from the connection, never read from the request. See
  // ../clearance.mjs — `?clearance=sacred` used to be honoured, which defeated
  // the entire ladder.

  // The assistant runs TOOLS, so the connection's clearance has to reach it.
  //
  // It did not. `aiStream` called `runTool` with no clearance at all, which
  // means `clearance === null` — the local-caller path — so every gate in
  // `mayRun` was skipped, and `anthropicTools()` publishes the whole registry.
  // A device on the gathering wifi could ask the assistant to do council work,
  // read restricted material, or open and close the wifi door. `aiStream` also
  // returns undefined, so `withhold` never ran over its answers either.
  //
  // The sibling route proves the omission rather than excusing it: the Claude
  // Code bridge next door has `fromThisMachine(req)` and this did not.
  //
  // Loopback-only, matching that sibling, rather than passing the clearance
  // through: the assistant streams tool calls it chooses itself, so a refusal
  // arrives mid-stream as text rather than as an answer a caller can act on,
  // and "the steward's own panel, at the steward's own machine" is a sentence
  // somebody can act on. If it is ever opened to devices, the clearance has to
  // travel INTO runTool, not be checked out here.
  if (req.method === 'POST' && p === 'ai') {
    if (clearance !== FULL) {
      return { status: 403, body: {
        error: 'loopback_only',
        message: 'The assistant runs at the computer the commons lives on, not over the wifi.',
      } };
    }
    return aiStream(req, res);   // streams, handles its own response
  }
  // Claude Code rather than the SDK: the steward's own subscription, no API key,
  // and loopback-only because it spawns a process and nothing here asks who you are.
  if (req.method === 'POST' && p === 'claude') return claudeStream(req, res, await readBody(req));

  switch (p) {
    case 'status':
      return {
        ok: true,
        version: '1.0.0',
        // A chapter's COORDINATES are not part of saying hello.
        //
        // `forAStranger()` strips lat/lng from the day clock on the stated
        // principle that a name is a fact about the land and a coordinate is a
        // direction to it — and this route handed the same numbers to the same
        // stranger, one call away, because it predates the principle. The join
        // page needs the chapter's NAME, which is what it renders.
        chapters: all('SELECT id,name,scale,represents,does_not_represent,lat,lng FROM chapters')
          .map((c) => (clearance === FULL ? c : { ...c, lat: undefined, lng: undefined })),
        default_chapter: chapterId,
        counts: {
          places: n('places'), signals: n('signals'), quests: n('quests'),
          decisions: n('decisions'), gatherings: n('gatherings'),
          intake: n('intake'), peers: n('federation_peers'),
        },
        // So the interface can mark demonstration data without keeping its own
        // copy of the id. Four copies of this literal were one rename away from
        // disagreeing about which half of a commons is fictional.
        demo_chapter: DEMO_CHAPTER_ID,
        ai_configured: !!process.env.ANTHROPIC_API_KEY,
        tools: TOOLS.length,
        // Two separate facts, kept separate on purpose. An API key and the
        // Claude Code CLI are different ways in with different bills attached,
        // and the panel says which one it is about to use.
        claude_code: await claudeAvailable(),
      };

    case 'dashboard':
      if (!chapterId) return { error: 'no chapter' };
      return {
        chapter: one('SELECT * FROM chapters WHERE id=?', chapterId),
        dashboard: bio.dashboard(chapterId),
        viability: council.minimumViableTest(chapterId),
        agenda: council.agenda(chapterId),
        due_for_review: council.dueForReview(chapterId),
        care_gaps: quest.careGaps(chapterId),
        benefit: exchange.benefitFlow(chapterId),
        consent: steward.consentAudit(chapterId),
        protected: steward.protectedInventory(chapterId),
      };

    case 'heartbeat': return heartbeat.status();
    case 'whats-next': return whatsNext(chapterId);
    case 'indicators': return all(
      `SELECT i.*,
              (SELECT value FROM measurements m WHERE m.indicator_id=i.id ${latestMeasurement('m')} LIMIT 1) latest_value,
              (SELECT measured_at FROM measurements m WHERE m.indicator_id=i.id ${latestMeasurement('m')} LIMIT 1) latest_at,
              (SELECT COUNT(*) FROM measurements m WHERE m.indicator_id=i.id) measurement_count
         FROM indicators i WHERE i.chapter_id=? ORDER BY i.created_at DESC`, chapterId);
    case 'places':   return all('SELECT * FROM places WHERE chapter_id=? ORDER BY name', chapterId);
    case 'hubs':     return all('SELECT * FROM hubs WHERE chapter_id=? ORDER BY name', chapterId);
    // Two computed flags, both about claims the interface would otherwise have to
    // guess at:
    //
    //   human_observed    — did a person put this here? One rule, in
    //                       core/provenance.mjs, so the UI keeps no second copy.
    //   at_place_centroid — is this coordinate the observation's OWN, or borrowed
    //                       from the place it was filed against? That is the
    //                       question a map pin answers, and it is not the same
    //                       as who observed it. Both rules live in
    //                       core/provenance.mjs so the map, this route and the
    //                       GeoJSON export bound for QGIS cannot disagree.
    case 'signals':  return all(
      `SELECT s.*,
              CASE WHEN ${humanObservedSql('s.source_adapter')} THEN 1 ELSE 0 END human_observed,
              CASE WHEN ${atPlaceCentroidSql('s')} THEN 1 ELSE 0 END at_place_centroid
         FROM signals s WHERE s.chapter_id=? ORDER BY s.created_at DESC LIMIT 500`, chapterId);
    case 'quests':   return all('SELECT * FROM quests WHERE chapter_id=? ORDER BY created_at DESC', chapterId);
    case 'decisions':return all('SELECT * FROM decisions WHERE chapter_id=? ORDER BY created_at DESC', chapterId);
    case 'gatherings':return all('SELECT * FROM gatherings WHERE chapter_id=? ORDER BY starts_at', chapterId);
    case 'intake':   return all('SELECT * FROM intake WHERE chapter_id=? AND private=0 ORDER BY created_at DESC', chapterId);
    case 'learn':    return all('SELECT * FROM learn WHERE chapter_id=? ORDER BY created_at DESC', chapterId);
    case 'federation': return all('SELECT * FROM federation_peers ORDER BY name');
    case 'exchange': return {
      events: all(`SELECT e.*, a.name AS provider_name FROM exchange_events e
                   LEFT JOIN agents a ON a.id=e.provider_id
                   WHERE e.chapter_id=? ORDER BY e.occurred_at DESC`, chapterId),
      flow: exchange.benefitFlow(chapterId),
      contributions: exchange.contributionSummary(chapterId),
    };

    // ---- map layers ----
    case 'layers/ecoregions': {
      const bbox = (q.bbox ?? '').split(',').map(Number);
      if (bbox.length !== 4 || bbox.some(Number.isNaN)) return { status: 400, body: { error: 'bbox=w,s,e,n required' } };
      const [west, south, east, north] = bbox;
      return await ecoregionPolygons({ west, south, east, north }, { level: q.level ?? 'l3' });
    }
    case 'layers/global': return globalEcoregions();
    case 'layers/atlas':  return atlasGeoJSON(chapterId, { clearance });

    // ---- exports ----
    case 'export/valueflows': return exportLedger(chapterId);
    case 'export/koi':        return koi.manifest(chapterId, { clearance });
    case 'export/geojson':    return atlasGeoJSON(chapterId, { clearance });

    // ---- protocol text, served to the UI ----
    case 'protocol': {
      const f = join(ROOT, 'docs', 'PROTOCOL.md');
      return { markdown: existsSync(f) ? readFileSync(f, 'utf8') : '' };
    }
    case 'doctrine': {
      const f = join(ROOT, 'content', 'greenfire', 'doctrine.json');
      return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { error: 'not built' };
    }

    // ---- generic tool invocation (same registry the AI uses) ----
    case 'tools': return TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
    case 'tool': {
      if (req.method !== 'POST') return { status: 405, body: { error: 'POST required' } };
      const body = await readBody(req);
      // The clearance travels with the call. Until it did, this line ran every
      // tool in the registry for whoever was on the wifi — see ai/access.mjs.
      return await runTool(body.name, body.input ?? {}, { via: 'ui', clearance });
    }

    // A QR for something the steward is about to show a room — the join link
    // with an invitation code in it. Keyboard only: a stranger has no business
    // asking this machine to draw pictures, and the code it carries was minted
    // at the keyboard a moment ago.
    case 'qr': {
      if (req.method !== 'POST') return { status: 405, body: { error: 'POST required' } };
      if (clearance !== FULL) {
        return { status: 403, body: { error: 'not_from_here', message: 'Made at the keyboard only.' } };
      }
      const body = await readBody(req);
      const text = String(body.text ?? '').trim();
      if (!text) return { status: 400, body: { error: 'missing_required', message: 'text is required.' } };
      try {
        const QRCode = (await import('qrcode')).default;
        return { text, qr: await QRCode.toDataURL(text, { margin: 1, width: 280 }) };
      } catch (err) {
        return { text, qr: null, error: 'qr_unavailable', message: err.message };
      }
    }

    default:
      return { status: 404, body: { error: `no route /api/${p}` } };
  }
}

function n(table) { return one(`SELECT COUNT(*) n FROM ${table}`)?.n ?? 0; }

export async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}
