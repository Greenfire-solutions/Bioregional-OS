// ── Map layers ────────────────────────────────────────────────────────────
// Polygon geometry for the 3D map. Live from EPA (public domain, US coverage);
// a global layer can be dropped into data/upstream/global-ecoregions.geojson
// (see docs/INTEROP.md — RESOLVE Ecoregions 2017 is CC-BY-4.0 and safe to
// vendor; One Earth Bioregions 2023 is CC-BY-NC and is not redistributed here).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getJSON, qs } from './http.mjs';
import { ROOT } from '../core/db.mjs';

const EPA_BASE = 'https://gispub.epa.gov/arcgis/rest/services/ORD/USEPA_Ecoregions_Level_III_and_IV/MapServer/7/query';
const GLOBAL = join(ROOT, 'data', 'upstream', 'global-ecoregions.geojson');

/** Ecoregion polygons intersecting a bbox, simplified for the viewport. */
export async function ecoregionPolygons({ west, south, east, north }, { level = 'l3', simplify } = {}) {
  const span = Math.max(Math.abs(east - west), Math.abs(north - south));
  // Simplify proportionally to how much world is on screen — keeps payloads sane.
  const offset = simplify ?? Math.max(0.002, Math.min(0.2, span / 220));
  const url = `${EPA_BASE}?${qs({
    geometry: { xmin: west, ymin: south, xmax: east, ymax: north, spatialReference: { wkid: 4326 } },
    geometryType: 'esriGeometryEnvelope',
    inSR: 4326,
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'US_L3NAME,US_L3CODE,US_L4NAME,US_L4CODE,NA_L2NAME,NA_L1NAME',
    returnGeometry: true,
    maxAllowableOffset: offset,
    outSR: 4326,
    f: 'geojson',
  })}`;
  const { data, cached, stale } = await getJSON(url, { ttlMs: 1000 * 60 * 60 * 24 * 30, timeout: 45000 });
  const fc = data?.type === 'FeatureCollection' ? data : { type: 'FeatureCollection', features: [] };

  // Merge L4 polygons up to L3 visually by tagging the display name once here,
  // so the renderer never has to know which level it is looking at.
  for (const f of fc.features) {
    const p = f.properties ?? {};
    p.display_name = level === 'l4' ? p.US_L4NAME : p.US_L3NAME;
    p.display_code = level === 'l4' ? p.US_L4CODE : p.US_L3CODE;
    p.biome = p.NA_L1NAME;
    p.division = p.NA_L2NAME;
  }
  fc.bros = { level, source: 'EPA Ecoregions Level III & IV (public domain)', cached: !!cached, stale: !!stale };
  return fc;
}

/** Optional global layer, if the operator has vendored one. */
export function globalEcoregions() {
  if (!existsSync(GLOBAL)) {
    return {
      type: 'FeatureCollection', features: [],
      bros: {
        missing: true,
        hint: 'Drop a RESOLVE Ecoregions 2017 GeoJSON at data/upstream/global-ecoregions.geojson ' +
              'to enable the global layer. See docs/INTEROP.md for sources and licences.',
      },
    };
  }
  return JSON.parse(readFileSync(GLOBAL, 'utf8'));
}

/** Deterministic colour per ecoregion name, so the map is stable between loads. */
export function colorFor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return hslToRgb(hue, 42 + (h % 18), 38 + ((h >> 3) % 16));
}
function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return [f(0), f(8), f(4)];
}
