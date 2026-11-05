// ── Ecoregion / bioregion resolution ───────────────────────────────────────
// Upstream, all openly licensed:
//   EPA Ecoregions Level III & IV (public domain, US)  — authoritative, live query
//   RESOLVE Ecoregions 2017 (CC-BY-4.0)                — global ECO_ID reference
//   One Earth Bioregions 2023 (CC-BY-NC-4.0)           — 185-bioregion framing
// The One Earth framework is NonCommercial, so this OS treats it as a *reference
// label* only (name + code), never redistributing its geometry. See docs/INTEROP.md.
import { getJSON, qs } from './http.mjs';

const EPA = 'https://gispub.epa.gov/arcgis/rest/services/ORD/USEPA_Ecoregions_Level_III_and_IV/MapServer/7/query';

/** Resolve a point to its nested ecoregion hierarchy. Returns null off-coverage. */
export async function resolveEcoregion(lat, lng) {
  const url = `${EPA}?${qs({
    geometry: { x: lng, y: lat, spatialReference: { wkid: 4326 } },
    geometryType: 'esriGeometryPoint',
    inSR: 4326,
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'US_L4NAME,US_L4CODE,US_L3NAME,US_L3CODE,NA_L2NAME,NA_L1NAME,STATE_NAME',
    returnGeometry: false,
    f: 'json',
  })}`;
  const { data, cached, stale } = await getJSON(url, { ttlMs: 1000 * 60 * 60 * 24 * 90 });
  const a = data?.features?.[0]?.attributes;
  if (!a) return null;
  return {
    ecoregion_name: a.US_L4NAME,
    ecoregion_code: a.US_L4CODE,
    level3_name: a.US_L3NAME,
    level3_code: a.US_L3CODE,
    level2_name: titleish(a.NA_L2NAME),
    biome: titleish(a.NA_L1NAME),
    state: a.STATE_NAME,
    // The working bioregion label a chapter organizes under.
    bioregion_name: a.US_L3NAME,
    source: 'EPA Ecoregions Level III & IV', source_id: 'epa-ecoregions',
    cached: !!cached, stale: !!stale,
  };
}

function titleish(s) {
  if (!s) return s;
  return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}
