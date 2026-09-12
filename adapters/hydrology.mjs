// ── Water systems and flow direction ──────────────────────────────────────
// Finishing Atlas layer 3, and the half of layer 2 the protocol names and the
// OS did not have: "Watersheds AND FLOW DIRECTION".
//
// A chapter organizing around a creek needs two things the gage cannot tell it:
// what is IN the water, and where the water goes. Both are public domain.
//
//   Water Quality Portal (USGS + EPA + tribal programmes, 430M results) —
//     nitrate, E. coli, dissolved oxygen, turbidity, temperature, at real
//     monitoring stations, by whoever sampled them.
//   NHDPlus High Resolution — the stream network. Stream order says how far
//     down the branching a reach sits; drainage area says how much ground is
//     upstream of you. Together they answer "what happens here affects what?"
//
// WQP answers in CSV, so the blank-cell trap applies in full: a missing result
// value must never become a zero, because zero nitrate and unmeasured nitrate
// are opposite findings.
import { getJSON, getText, qs } from './http.mjs';
import { markFetched } from './registry.mjs';

const WQP = 'https://www.waterqualitydata.us/data';
const NHD = 'https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer';
const DAY = 1000 * 60 * 60 * 24;

/**
 * The characteristics a commons actually asks about, rather than all 20,000 in
 * the portal. Named here so the query, the parsing and the summary agree.
 */
export const WATCHED = [
  'Escherichia coli', 'Nitrate', 'Phosphorus', 'Dissolved oxygen (DO)',
  'pH', 'Temperature, water', 'Turbidity', 'Specific conductance',
];

/** Everything layers 2 and 3 can still say about a point. */
export async function hydrologyHere(lat, lng, { radiusKm = 5, sinceYears = 3 } = {}) {
  const [quality, network] = await Promise.all([
    waterQualityNear(lat, lng, { radiusKm, sinceYears }).catch(fail),
    flowlinesNear(lat, lng, { radiusKm }).catch(fail),
  ]);
  return {
    quality, network,
    readable: [network.readable, quality.readable].filter(Boolean).join(' '),
  };
}

// ── what is in the water ───────────────────────────────────────────────────

export async function waterQualityNear(lat, lng, { radiusKm = 5, sinceYears = 3, limit = 400 } = {}) {
  const d = radiusKm / 111;
  const since = new Date(Date.now() - sinceYears * 365 * DAY);
  const url = `${WQP}/Result/search?${qs({
    bBox: [lng - d, lat - d, lng + d, lat + d].map((v) => v.toFixed(4)).join(','),
    startDateLo: `${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}-${since.getFullYear()}`,
    mimeType: 'csv', zip: 'no', dataProfile: 'resultPhysChem',
  })}` + WATCHED.map((c) => `&characteristicName=${encodeURIComponent(c)}`).join('');

  const { data, cached, stale } = await getText(url, { ttlMs: DAY * 7, timeout: 90000 });
  const rows = parseCsv(data, limit);
  if (!rows.length) {
    return {
      available: true, source: 'Water Quality Portal (public domain)', source_id: 'water-quality-portal',
      cached: !!cached, stale: !!stale, radius_km: radiusKm,
      characteristics: [], total_results: 0,
      readable: `No water quality sampling within ${radiusKm} km in the last ${sinceYears} years.`,
    };
  }
  markFetched('water-quality-portal');

  const byChar = new Map();
  for (const r of rows) {
    const name = r.CharacteristicName;
    if (!name) continue;
    // The blank-cell rule. An empty ResultMeasureValue means the sample was
    // taken and no value recorded — not that the value was zero. `Number('')`
    // is 0, and "0 mg/L nitrate" and "nitrate not measured" are opposite
    // findings for anyone deciding whether a creek is safe.
    const raw = r['ResultMeasureValue'];
    const value = (raw == null || String(raw).trim() === '') ? null : Number(raw);
    if (!byChar.has(name)) byChar.set(name, { name, unit: null, values: [], unmeasured: 0, latest: null, stations: new Set() });
    const c = byChar.get(name);
    c.unit = c.unit ?? (r['ResultMeasure/MeasureUnitCode'] || null);
    if (r.MonitoringLocationIdentifier) c.stations.add(r.MonitoringLocationIdentifier);
    if (value == null || !Number.isFinite(value)) { c.unmeasured++; continue; }
    c.values.push(value);
    const date = r.ActivityStartDate || null;
    if (date && (!c.latest || date > c.latest.date)) c.latest = { date, value };
  }

  const characteristics = [...byChar.values()].map((c) => {
    const sorted = [...c.values].sort((a, b) => a - b);
    return {
      name: c.name, unit: c.unit,
      samples: c.values.length,
      // Reported separately, never folded into the count: a characteristic
      // sampled thirty times and recorded twice is not thirty readings.
      sampled_but_not_recorded: c.unmeasured,
      stations: c.stations.size,
      median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
      min: sorted.length ? sorted[0] : null,
      max: sorted.length ? sorted[sorted.length - 1] : null,
      latest: c.latest,
    };
  }).sort((a, b) => b.samples - a.samples);

  return {
    available: true,
    source: 'Water Quality Portal — USGS, EPA and tribal programmes (public domain)',
    source_id: 'water-quality-portal',
    cached: !!cached, stale: !!stale,
    radius_km: radiusKm, since_years: sinceYears,
    total_results: rows.length,
    truncated: rows.length >= limit ? `Capped at ${limit} results; there is more here.` : null,
    characteristics,
    readable: readableQuality(characteristics, radiusKm, sinceYears),
  };
}

function readableQuality(chars, radiusKm, years) {
  if (!chars.length) return null;
  const ecoli = chars.find((c) => /coli/i.test(c.name));
  const top = chars[0];
  const lead = ecoli && ecoli.latest
    ? `E. coli last read ${ecoli.latest.value} ${ecoli.unit ?? ''} on ${ecoli.latest.date}`.replace(/\s+/g, ' ')
    : `${top.name} sampled ${top.samples} times`;
  return `${chars.length} water quality measures tracked within ${radiusKm} km over ${years} years — ${lead}.`;
}

// ── where the water goes ───────────────────────────────────────────────────

/**
 * The stream network here. Stream order is how far down the branching a reach
 * sits; drainage area is how much ground is upstream of it. Those two numbers
 * are what turn "our creek" into "everything that happens on 302 square
 * kilometres arrives here".
 */
export async function flowlinesNear(lat, lng, { radiusKm = 2 } = {}) {
  const d = radiusKm / 111;
  const { data, cached, stale } = await getJSON(
    `${NHD}/3/query?${qs({
      geometry: { xmin: lng - d, ymin: lat - d, xmax: lng + d, ymax: lat + d, spatialReference: { wkid: 4326 } },
      geometryType: 'esriGeometryEnvelope', inSR: 4326,
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'gnis_name,lengthkm,streamorde,totdasqkm,ftype',
      returnGeometry: false, f: 'json',
    })}`, { ttlMs: DAY * 90, timeout: 45000 });

  const feats = (data?.features ?? []).map((f) => f.attributes).filter(Boolean);
  if (!feats.length) {
    return { available: false, reason: 'no NHD flowlines here — outside coverage, or no mapped channel', source: null };
  }
  markFetched('nhdplus-hr');

  // The mainstem is the largest thing passing through: highest stream order,
  // then largest drainage area. An unnamed first-order ditch is not the answer
  // to "what creek is this".
  const ranked = [...feats].sort((a, b) =>
    (b.streamorde ?? 0) - (a.streamorde ?? 0) || (b.totdasqkm ?? 0) - (a.totdasqkm ?? 0));
  const main = ranked[0];
  const named = [...new Set(feats.map((f) => f.gnis_name).filter(Boolean))];

  return {
    available: true,
    source: 'USGS NHDPlus High Resolution (public domain)', source_id: 'nhdplus-hr',
    cached: !!cached, stale: !!stale,
    mainstem: {
      name: main.gnis_name ?? null,
      stream_order: main.streamorde ?? null,
      drainage_area_km2: main.totdasqkm == null ? null : Math.round(main.totdasqkm * 10) / 10,
      type: main.ftype ?? null,
    },
    named_waters: named,
    reach_count: feats.length,
    readable: main.gnis_name
      ? `${main.gnis_name} here is an order-${main.streamorde} stream draining ` +
        `${Math.round((main.totdasqkm ?? 0))} km² upstream of this point.`
      : `${feats.length} mapped channels here, the largest an order-${main.streamorde ?? '?'} reach` +
        `${main.totdasqkm ? ` draining ${Math.round(main.totdasqkm)} km²` : ''}.`,
  };
}

// ── csv ────────────────────────────────────────────────────────────────────

/** Minimal RFC4180-ish parser: WQP quotes fields containing commas. */
function parseCsv(text, limit = Infinity) {
  if (!text) return [];
  const rows = [];
  let field = '', row = [], inQuotes = false, header = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (!header) header = row;
      else if (row.length === header.length) {
        rows.push(Object.fromEntries(header.map((h, j) => [h, row[j]])));
        if (rows.length >= limit) return rows;
      }
      row = [];
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    if (header && row.length === header.length) rows.push(Object.fromEntries(header.map((h, j) => [h, row[j]])));
  }
  return rows;
}

const fail = (err) => ({ available: false, reason: err?.message ?? String(err), source: null });
