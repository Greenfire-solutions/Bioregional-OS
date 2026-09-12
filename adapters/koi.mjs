// ── KOI-net adapter (Knowledge Organization Infrastructure) ───────────────
// Upstream: BlockScience / DynamicalSystemsGroup koi-net (MIT), with Metagov
// and Regen Network. The idea this OS borrows: knowledge travels as *labels*
// (Reference Identifiers + manifests), while the material stays where it was
// made. A peer learns that your bank-stabilisation method exists and can ask
// for it — it does not silently copy your community's data.
import { all, one } from '../core/db.mjs';
import { makeRid, parseRid, visibleAt } from '../core/ids.mjs';
import { createHash } from 'node:crypto';

/** A manifest: what exists here, at what sensitivity, fingerprinted. */
export function manifest(chapterId, { clearance = 'public' } = {}) {
  const rows = all('SELECT * FROM rids WHERE chapter_id = ? ORDER BY updated_at DESC', chapterId);
  const visible = rows.filter((r) => visibleAt(clearance, r.sensitivity));
  return {
    '@type': 'koi:Manifest',
    chapter: chapterId,
    generated_at: new Date().toISOString(),
    clearance,
    withheld: rows.length - visible.length,
    objects: visible.map((r) => ({
      rid: r.rid,
      type: r.object_type,
      sensitivity: r.sensitivity,
      updated_at: r.updated_at,
      fingerprint: fingerprint(r),
    })),
  };
}

/**
 * Bundle a specific object for travel. Only things marked as travelling
 * knowledge (learn.travels = 1) leave at all — that is a protocol rule,
 * not a preference.
 */
export function bundle(rid, { clearance = 'public' } = {}) {
  const parsed = parseRid(rid);
  if (!parsed) return { error: 'malformed rid' };
  const meta = one('SELECT * FROM rids WHERE rid = ?', rid);
  if (!meta) return { error: 'unknown rid' };
  if (!visibleAt(clearance, meta.sensitivity)) return { error: 'withheld', sensitivity: meta.sensitivity };

  const TABLE = {
    learn: 'learn', quest: 'quests', signal: 'signals', place: 'places',
    decision: 'decisions', gathering: 'gatherings', chapter: 'chapters',
    indicator: 'indicators', hub: 'hubs',
  }[parsed.objectType];
  if (!TABLE) return { error: `type ${parsed.objectType} does not travel` };

  const row = one(`SELECT * FROM ${TABLE} WHERE id = ?`, parsed.localId);
  if (!row) return { error: 'not found' };
  if (parsed.objectType === 'learn' && !row.travels) return { error: 'marked do-not-travel' };

  return {
    '@type': 'koi:Bundle',
    rid,
    sensitivity: meta.sensitivity,
    object_type: parsed.objectType,
    source_chapter: parsed.chapterId,
    retrieved_at: new Date().toISOString(),
    contents: strip(row),
  };
}

/** Personal and locational detail never rides along by default. */
function strip(row) {
  const out = { ...row };
  for (const k of ['contact', 'submitted_by', 'granted_by', 'measured_by', 'author']) delete out[k];
  return out;
}

function fingerprint(r) {
  return createHash('sha1').update(`${r.rid}|${r.updated_at}`).digest('hex').slice(0, 12);
}
