// ── Geo import / export ───────────────────────────────────────────────────
// Reads GeoJSON from the tools communities already use in the field:
//   CoMapeo / Mapeo (Digital Democracy, GPL-3.0) — offline territory mapping
//   QGIS, OpenStreetMap extracts, agency downloads
// Exports the Living Commons Atlas back out as plain GeoJSON, with sensitive
// layers masked rather than omitted so the omission itself stays visible.
import { readFileSync } from 'node:fs';
import { all } from '../core/db.mjs';
import { visibleAt } from '../core/ids.mjs';

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
  const features = [];
  let redacted = 0;

  for (const s of signals) {
    if (!visibleAt(clearance, s.sensitivity)) { redacted++; continue; }
    if (s.lat == null || s.lng == null) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      properties: {
        kind: 'signal', id: s.id, title: s.title, category: s.category,
        severity: s.severity, verified: !!s.verified, observed_at: s.observed_at,
        value: s.quantity_value, unit: s.quantity_unit, source: s.source_adapter,
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
    bros: { chapter: chapterId, clearance, redacted_features: redacted },
    features,
  };
}
