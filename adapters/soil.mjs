// ── Land and soil ─────────────────────────────────────────────────────────
// Atlas layer 4. What the ground under a place actually is.
//
// Three upstreams, all open, and all resolved ONCE per place and then never
// again — soil does not change on a heartbeat, and a scheduler that re-asks a
// question whose answer is fixed is just noise with a timer on it.
//
//   1. USDA SSURGO via Soil Data Access — the authoritative US soil survey.
//      POST only, raw SQL, longitude first, errors as OGC XML. All three of
//      those are handled in postJSON and in the query below.
//   2. ISRIC SoilGrids v2 (CC-BY-4.0) — the same questions answered anywhere on
//      Earth at 250m, so a chapter outside the US is not left with nothing.
//   3. USGS 3DEP for elevation, MRLC NLCD for land cover.
//
// Everything reports its own source and says plainly when it has none.
import { getJSON, postJSON, qs } from './http.mjs';
import { markFetched } from './registry.mjs';

const SDA = 'https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest';
const SOILGRIDS = 'https://rest.isric.org/soilgrids/v2.0/properties/query';
const EPQS = 'https://epqs.nationalmap.gov/v1/json';
const NLCD = 'https://www.mrlc.gov/geoserver/mrlc_display/wms';

const FOREVER = 1000 * 60 * 60 * 24 * 365;   // soil, elevation and survey lines do not move

// ── the whole profile ──────────────────────────────────────────────────────

/** Soil, elevation and land cover for a point, each independently degradable. */
export async function groundProfile(lat, lng) {
  const [soil, elevation, cover] = await Promise.all([
    resolveSoil(lat, lng).catch((e) => unavailable(e)),
    resolveElevation(lat, lng).catch((e) => unavailable(e)),
    resolveLandCover(lat, lng).catch((e) => unavailable(e)),
  ]);
  return { soil, elevation, land_cover: cover };
}

const unavailable = (err) => ({ available: false, reason: err?.message ?? String(err), source: null });

// ── soil ───────────────────────────────────────────────────────────────────

/** SSURGO where it covers, SoilGrids everywhere else. */
export async function resolveSoil(lat, lng) {
  try {
    const us = await ssurgo(lat, lng);
    if (us) return us;
  } catch { /* fall through — a survey gap is not an error worth failing on */ }
  return soilGrids(lat, lng);
}

async function ssurgo(lat, lng) {
  // Longitude first inside the WKT point. Getting this backwards returns a
  // perfectly valid answer about a completely different place, which is the
  // worst kind of wrong.
  const query =
    'SELECT TOP 40 mu.mukey, mu.muname, c.cokey, c.compname, c.comppct_r, c.drainagecl, ' +
    'c.taxorder, c.taxsubgrp, c.hydricrating, c.slope_r, ch.hzname, ch.hzdept_r, ch.hzdepb_r, ' +
    'ch.om_r, ch.ph1to1h2o_r, ch.claytotal_r, ch.sandtotal_r, ch.silttotal_r, ch.awc_r, ch.cec7_r ' +
    'FROM mapunit mu JOIN component c ON c.mukey = mu.mukey ' +
    'LEFT JOIN chorizon ch ON ch.cokey = c.cokey ' +
    `WHERE mu.mukey IN (SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point(${num(lng)} ${num(lat)})')) ` +
    "AND c.majcompflag = 'Yes' ORDER BY c.comppct_r DESC, ch.hzdept_r";

  const { data, cached, stale } = await postJSON(SDA, { format: 'JSON+COLUMNNAME', query }, { ttlMs: FOREVER });
  const table = data?.Table;
  if (!Array.isArray(table) || table.length < 2) return null;   // off-survey

  const rows = asObjects(table);
  const dominant = rows[0];
  const horizons = rows
    .filter((r) => r.cokey === dominant.cokey && r.hzdept_r != null)
    .map((r) => ({
      name: r.hzname, top_cm: n(r.hzdept_r), bottom_cm: n(r.hzdepb_r),
      organic_matter_pct: n(r.om_r), ph: n(r.ph1to1h2o_r),
      clay_pct: n(r.claytotal_r), sand_pct: n(r.sandtotal_r), silt_pct: n(r.silttotal_r),
      available_water_capacity: n(r.awc_r), cec: n(r.cec7_r),
    }));

  const rooting = weightedToDepth(horizons, 30);
  markFetched('usda-ssurgo');
  return {
    available: true,
    source: 'USDA SSURGO via Soil Data Access',
    source_id: 'usda-ssurgo',
    cached: !!cached, stale: !!stale,
    map_unit: dominant.muname ?? null,
    map_unit_key: dominant.mukey ?? null,
    series: dominant.compname ?? null,
    series_share_pct: n(dominant.comppct_r),
    taxonomic_order: dominant.taxorder ?? null,
    taxonomic_subgroup: dominant.taxsubgrp ?? null,
    drainage: dominant.drainagecl ?? null,
    // Hydric soils mark wetland; it is a permitting question before it is an
    // ecological one, so a quest touching this ground should know early.
    hydric: dominant.hydricrating === 'Yes',
    slope_pct: n(dominant.slope_r),
    rooting_zone: rooting,
    horizons,
    readable: readableSoil({
      series: dominant.compname, muname: dominant.muname,
      order: dominant.taxorder, drainage: dominant.drainagecl, rooting,
    }),
  };
}

async function soilGrids(lat, lng) {
  const props = ['phh2o', 'soc', 'clay', 'sand', 'silt', 'cec', 'nitrogen', 'bdod'];
  const url = `${SOILGRIDS}?${qs({ lon: num(lng), lat: num(lat), value: 'mean' })}` +
    props.map((p) => `&property=${p}`).join('') +
    ['0-5cm', '5-15cm', '15-30cm'].map((d) => `&depth=${d}`).join('');
  const { data, cached, stale } = await getJSON(url, { ttlMs: FOREVER, timeout: 45000 });
  const layers = data?.properties?.layers;
  if (!Array.isArray(layers) || !layers.length) {
    return { available: false, reason: 'no soil data at this coordinate', source: null };
  }

  // SoilGrids answers in scaled integers. pH arrives as 70 and means 7.0. Divide
  // by the layer's own d_factor or every number here is plausible and wrong.
  const out = {};
  for (const layer of layers) {
    const factor = layer.unit_measure?.d_factor || 1;
    const unit = layer.unit_measure?.target_units ?? null;
    const depths = {};
    for (const d of layer.depths ?? []) {
      const v = d.values?.mean;
      if (v == null) continue;
      depths[d.label] = Math.round((v / factor) * 100) / 100;
    }
    const vals = Object.values(depths);
    if (!vals.length) continue;
    out[layer.name] = {
      unit,
      by_depth: depths,
      rooting_zone_mean: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100,
    };
  }

  markFetched('isric-soilgrids');
  const rooting = {
    depth_cm: 30,
    ph: out.phh2o?.rooting_zone_mean ?? null,
    // SoilGrids reports organic carbon; organic matter is conventionally ~1.72x it.
    organic_matter_pct: out.soc?.rooting_zone_mean == null
      ? null : Math.round(out.soc.rooting_zone_mean * 0.172 * 100) / 100,
    clay_pct: out.clay?.rooting_zone_mean ?? null,
    sand_pct: out.sand?.rooting_zone_mean ?? null,
    silt_pct: out.silt?.rooting_zone_mean ?? null,
    cec: out.cec?.rooting_zone_mean ?? null,
  };
  return {
    available: true,
    source: 'ISRIC SoilGrids 2.0', source_id: 'isric-soilgrids',
    source_id: 'isric-soilgrids',
    cached: !!cached, stale: !!stale,
    resolution: '250 m modelled — not a field survey',
    series: null, map_unit: null, drainage: null, hydric: null,
    rooting_zone: rooting,
    properties: out,
    readable: readableSoil({ order: null, drainage: null, rooting, modelled: true }),
  };
}

/**
 * Depth-weighted average over the top N centimetres.
 * The rooting zone is the number a grower, a restoration plan and a septic
 * assessment all actually want; a surface-horizon reading flatters thin soils.
 */
function weightedToDepth(horizons, depthCm) {
  const keys = ['organic_matter_pct', 'ph', 'clay_pct', 'sand_pct', 'silt_pct', 'available_water_capacity', 'cec'];
  const acc = Object.fromEntries(keys.map((k) => [k, { sum: 0, weight: 0 }]));
  let covered = 0;
  for (const h of horizons) {
    if (h.top_cm == null || h.bottom_cm == null || h.top_cm >= depthCm) continue;
    const thickness = Math.min(h.bottom_cm, depthCm) - h.top_cm;
    if (thickness <= 0) continue;
    covered = Math.max(covered, Math.min(h.bottom_cm, depthCm));
    for (const k of keys) {
      if (h[k] == null) continue;
      acc[k].sum += h[k] * thickness;
      acc[k].weight += thickness;
    }
  }
  const out = { depth_cm: depthCm, measured_to_cm: covered || null };
  for (const k of keys) {
    out[k] = acc[k].weight ? Math.round((acc[k].sum / acc[k].weight) * 100) / 100 : null;
  }
  return out;
}

/** One sentence, because the panel has one line for it. */
function readableSoil({ series, muname, order, drainage, rooting, modelled = false }) {
  const bits = [];
  if (series) bits.push(muname ? muname.replace(/,.*$/, '') : series);
  else if (modelled) bits.push('Modelled soil');
  if (order) bits.push(order.toLowerCase().replace(/s$/, ''));
  if (drainage) bits.push(drainage.toLowerCase());
  const chem = [];
  if (rooting?.ph != null) chem.push(`pH ${rooting.ph}`);
  if (rooting?.organic_matter_pct != null) chem.push(`${rooting.organic_matter_pct}% organic matter`);
  if (rooting?.clay_pct != null) chem.push(`${Math.round(rooting.clay_pct)}% clay`);
  const head = bits.join(', ');
  const tail = chem.length ? ` — ${chem.join(', ')} in the top 30 cm` : '';
  return (head + tail) || null;
}

// ── elevation ──────────────────────────────────────────────────────────────

export async function resolveElevation(lat, lng) {
  try {
    const { data, cached, stale } = await getJSON(
      `${EPQS}?${qs({ x: num(lng), y: num(lat), units: 'Meters', wkid: 4326, includeDate: false })}`,
      { ttlMs: FOREVER, timeout: 20000 });
    const v = Number(data?.value);
    if (Number.isFinite(v)) {
      markFetched('usgs-3dep');
      return {
        available: true, metres: Math.round(v * 10) / 10, feet: Math.round(v * 3.28084),
        resolution_m: data?.resolution ?? null,
        source: 'USGS 3DEP', source_id: 'usgs-3dep',
        cached: !!cached, stale: !!stale,
      };
    }
  } catch { /* outside 3DEP coverage, or the service is down */ }
  const { data } = await getJSON(
    `https://api.open-meteo.com/v1/elevation?${qs({ latitude: num(lat), longitude: num(lng) })}`,
    { ttlMs: FOREVER, timeout: 20000 });
  const v = data?.elevation?.[0];
  if (!Number.isFinite(v)) return { available: false, reason: 'no elevation upstream answered', source: null };
  return {
    available: true, metres: Math.round(v * 10) / 10, feet: Math.round(v * 3.28084),
    resolution_m: null, source: 'Open-Meteo digital elevation', source_id: 'open-meteo',
  };
}

// ── land cover ─────────────────────────────────────────────────────────────

/**
 * NLCD classes. GetFeatureInfo answers with PALETTE_INDEX, which IS the NLCD
 * class code — but only if you know that, which is why the table lives here and
 * not in a comment on a magic number.
 */
export const NLCD_CLASSES = {
  11: 'Open water', 12: 'Perennial ice and snow',
  21: 'Developed, open space', 22: 'Developed, low intensity',
  23: 'Developed, medium intensity', 24: 'Developed, high intensity',
  31: 'Barren land', 32: 'Unconsolidated shore',
  41: 'Deciduous forest', 42: 'Evergreen forest', 43: 'Mixed forest',
  51: 'Dwarf scrub', 52: 'Shrub and scrub',
  71: 'Grassland and herbaceous', 72: 'Sedge and herbaceous', 73: 'Lichens', 74: 'Moss',
  81: 'Pasture and hay', 82: 'Cultivated crops',
  90: 'Woody wetlands', 95: 'Emergent herbaceous wetlands',
};

/** Broad groupings, for the one question a chapter usually asks of this layer. */
const COVER_GROUP = (code) => {
  if (code >= 21 && code <= 24) return 'developed';
  if (code >= 41 && code <= 43) return 'forest';
  if (code === 52 || code === 51) return 'shrubland';
  if (code >= 71 && code <= 74) return 'herbaceous';
  if (code === 81 || code === 82) return 'agricultural';
  if (code === 90 || code === 95) return 'wetland';
  if (code === 11 || code === 12) return 'water';
  if (code === 31 || code === 32) return 'barren';
  return null;
};

export async function resolveLandCover(lat, lng, { year = 2021 } = {}) {
  const layer = `NLCD_${year}_Land_Cover_L48`;
  const d = 0.0005;
  const url = `${NLCD}?${qs({
    service: 'WMS', version: '1.1.1', request: 'GetFeatureInfo',
    layers: layer, query_layers: layer, srs: 'EPSG:4326',
    bbox: `${num(lng - d)},${num(lat - d)},${num(lng + d)},${num(lat + d)}`,
    width: 10, height: 10, x: 5, y: 5, info_format: 'application/json',
  })}`;
  const { data, cached, stale } = await getJSON(url, { ttlMs: FOREVER, timeout: 30000 });
  const code = data?.features?.[0]?.properties?.PALETTE_INDEX;
  if (code == null || code === 0) {
    return { available: false, reason: 'outside NLCD coverage (conterminous US only)', source: null };
  }
  markFetched('mrlc-nlcd');
  return {
    available: true,
    code, class: NLCD_CLASSES[code] ?? `NLCD class ${code}`,
    group: COVER_GROUP(code),
    year,
    source: `USGS NLCD ${year}`, source_id: 'mrlc-nlcd',
    cached: !!cached, stale: !!stale,
  };
}

const n = (v) => (v == null || v === '' ? null : Number(v));
const num = (v) => Number(v).toFixed(6);

/** Turn SDA's untyped [[columns],[row]...] into objects. Everything arrives as a string. */
function asObjects(table) {
  const [cols, ...rows] = table;
  return rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
}
