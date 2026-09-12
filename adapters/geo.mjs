// ── Geo import / export ───────────────────────────────────────────────────
// Reads GeoJSON from the tools communities already use in the field:
//   CoMapeo / Mapeo (Digital Democracy, GPL-3.0) — offline territory mapping
//   QGIS, OpenStreetMap extracts, agency downloads
// Exports the Living Commons Atlas back out as plain GeoJSON, with sensitive
// layers masked rather than omitted so the omission itself stays visible.
import { readFileSync } from 'node:fs';
import { all } from '../core/db.mjs';
import { visibleAt } from '../core/ids.mjs';
import { humanObserved, atPlaceCentroid } from '../core/provenance.mjs';
import { creditForTags } from './registry.mjs';
import { isDemoChapter, DEMO_NOTICE } from '../core/seedData.js';
import { HUMAN_SOURCES } from '../core/provenance.mjs';

/** Turn a GeoJSON FeatureCollection into draft signals for review. */
export function signalsFromGeoJSON(path, { chapterId, placeId = null, defaultCategory = 'Ecological' } = {}) {
  const gj = JSON.parse(readFileSync(path, 'utf8'));
  const feats = gj.type === 'FeatureCollection' ? gj.features : [gj];
  return feats.map((f) => {
    const p = f.properties ?? {};
    const [lng, lat] = centroid(f.geometry) ?? [null, null];
    return {
      chapter_id: chapterId,
      place_id: placeId,
      title: p.name || p.title || p.categoryId || 'Imported observation',
      category: mapCategory(p.categoryId || p.category) || defaultCategory,
      severity: 'Info',
      location_name: p.placeName || p.location || null,
      lat, lng,
      description: p.notes || p.description || null,
      author: p.observedBy || 'Field import',
      verified: 0,
      observed_at: p.timestamp || p.created_at || null,
      source_adapter: p.categoryId ? 'comapeo' : 'geojson',
      source_ref: f.id ? String(f.id) : null,
      // Imported field data is members-only until a human reviews it.
      sensitivity: 'members',
    };
  });
}

const CATEGORY_MAP = {
  water: 'Hydrological', river: 'Hydrological', spring: 'Hydrological',
  animal: 'Ecological', plant: 'Ecological', tree: 'Ecological', habitat: 'Ecological',
  threat: 'Disturbance', logging: 'Disturbance', mining: 'Disturbance', pollution: 'Disturbance',
  building: 'Infrastructure', road: 'Infrastructure',
  sacred: 'Cultural', cultural: 'Cultural', history: 'Cultural',
};
function mapCategory(raw) {
  if (!raw) return null;
  const k = String(raw).toLowerCase();
  return Object.entries(CATEGORY_MAP).find(([kw]) => k.includes(kw))?.[1] ?? null;
}

function centroid(geom) {
  if (!geom) return null;
  if (geom.type === 'Point') return geom.coordinates;
  const coords = flatten(geom.coordinates);
  if (!coords.length) return null;
  const n = coords.length;
  return [coords.reduce((s, c) => s + c[0], 0) / n, coords.reduce((s, c) => s + c[1], 0) / n];
}
function flatten(a) {
  if (typeof a[0] === 'number') return [a];
  return a.flatMap(flatten);
}

/**
 * Export atlas + signals as GeoJSON. Anything above the caller's clearance
 * is emitted as a redaction marker with no coordinates — the map shows that
 * something is being protected without revealing where.
 */
export function atlasGeoJSON(chapterId, { clearance = 'public' } = {}) {
  const signals = all('SELECT * FROM signals WHERE chapter_id = ?', chapterId);
  const hubs = all('SELECT * FROM hubs WHERE chapter_id = ?', chapterId);
  const places = all('SELECT lat, lng FROM places WHERE chapter_id = ?', chapterId);
  const features = [];
  let redacted = 0;
  let borrowed = 0;

  for (const s of signals) {
    if (!visibleAt(clearance, s.sensitivity)) { redacted++; continue; }
    if (s.lat == null || s.lng == null) continue;
    // Every row here becomes a Point, and a Point in QGIS looks equally certain
    // whether it is a gage bolted to a riverbank or a county-wide heat advisory
    // filed at the chapter's own coordinate. The geometry cannot carry that
    // difference, so the properties have to — otherwise an export is a pile of
    // confident points and the least certain of them look the same as the most.
    const atCentroid = atPlaceCentroid(s, places);
    if (atCentroid) borrowed++;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      properties: {
        kind: 'signal', id: s.id, title: s.title, category: s.category,
        severity: s.severity, verified: !!s.verified, observed_at: s.observed_at,
        value: s.quantity_value, unit: s.quantity_unit, source: s.source_adapter,
        // Same two flags, from the same two rules, as /api/signals and the 3D map.
        human_observed: humanObserved(s.source_adapter),
        at_place_centroid: atCentroid,
        location_precision: atCentroid ? 'filed at the place — real extent may be wider' : 'its own coordinate',
      },
    });
  }
  for (const h of hubs) {
    if (h.lat == null || h.lng == null) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [h.lng, h.lat] },
      properties: { kind: 'hub', id: h.id, title: h.name, type: h.type, stewards: h.stewards_count },
    });
  }
  return {
    type: 'FeatureCollection',
    bros: {
      chapter: chapterId, clearance, redacted_features: redacted,
      // Counted, not just flagged per-feature: someone opening this in QGIS
      // should be told up front how much of it is approximate.
      features_at_place_centroid: borrowed,
      // This file LEAVES THE MACHINE. It carried no credit at all until now,
      // which for an ODbL or CC-BY source is not a tidiness problem — it is the
      // condition of being allowed to share it. Resolved from the registry, so
      // it cannot go stale the way retyped prose does.
      ...creditForTags(signals.map((s) => s.source_adapter), { humanTags: [...HUMAN_SOURCES, null] }),
      // A GeoJSON has no interface around it. Opened in QGIS, the seeded
      // "Unpermitted Stormwater Outfall Discharge" is a Critical finding about a
      // real creek naming a real city department, with nothing on the file
      // saying it was invented. Only the example commons is marked — a notice on
      // every export is noise, and noise is not read.
      ...(isDemoChapter(chapterId) ? { demonstration_data: DEMO_NOTICE } : {}),
      generated_at: new Date().toISOString(),
    },
    features,
  };
}
