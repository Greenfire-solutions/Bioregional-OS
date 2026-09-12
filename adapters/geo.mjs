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
import { attributionFor, source as registrySource } from './registry.mjs';

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
 * Which registry source wrote a signal, from the `source_adapter` tag it carries.
 *
 * The tags are short ('usgs', 'nws') and registry ids are long ('usgs-nwis',
 * 'nws'), so the two have to be joined somewhere. Unmapped tags are NOT dropped
 * — they come back as an unresolved credit that says so, because an export
 * leaving the machine with a silently missing attribution is the failure this
 * whole block exists to prevent. Loud beats absent.
 */
const ADAPTER_SOURCE = {
  usgs: 'usgs-nwis', nws: 'nws', firms: 'nasa-firms', usdm: 'usdm',
  inaturalist: 'inaturalist', gbif: 'gbif', osm: 'openstreetmap',
};

function creditFor(signals) {
  const tags = new Set(signals.map((s) => s.source_adapter).filter(Boolean));
  const ids = [], unresolved = [];
  let ownWork = false;
  for (const tag of tags) {
    if (humanObserved(tag)) { ownWork = true; continue; }
    const id = ADAPTER_SOURCE[tag];
    if (id && registrySource(id)) ids.push(id);
    else unresolved.push(tag);
  }
  const credit = attributionFor(ids);
  if (ownWork) {
    credit.unshift({ source: "This chapter's own observations", license: 'Held by the commons that recorded them', attribution: null, url: null });
  }
  return {
    attribution: credit,
    // Named, never omitted. Redistributing data whose terms nobody resolved is
    // the one mistake in this file that reaches other people.
    unresolved_sources: unresolved.length ? unresolved : null,
    notice: unresolved.length
      ? `Some rows came from sources this OS could not resolve to a licence (${unresolved.join(', ')}). Check their terms before redistributing this file.`
      : 'Every source in this file is credited above. Honour the terms shown.',
  };
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
      ...creditFor(signals),
      generated_at: new Date().toISOString(),
    },
    features,
  };
}
