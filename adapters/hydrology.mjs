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

  const characteristics = groupByUnit(rows);

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
  const distinct = new Set(chars.map((c) => c.name)).size;
  // Lead with a group whose unit is trustworthy; a bacterial count labelled
  // "hours" is not a sentence worth writing.
  const lead = chars.find((c) => c.latest && !c.unit_looks_wrong && c.samples >= 3) ?? chars[0];
  const val = lead.latest
    ? `${lead.name} last read ${lead.latest.value}${lead.unit ? ` ${lead.unit}` : ''} on ${lead.latest.date}`
    : `${lead.name} sampled ${lead.samples} times`;
  const split = chars.filter((c) => c.also_reported_in).length;
  return `${distinct} water quality measures tracked within ${radiusKm} km over ${years} years — ${val}.` +
    (split ? ` Some are reported in more than one unit and are kept apart rather than averaged together.` : '');
}


/**
 * Group results by characteristic AND unit. Exported so the rule can be tested
 * without a network call — and so there is one implementation rather than a
 * test-only twin that can drift from the one that runs.
 */
export function groupByUnit(rows) {
  // Grouped by CHARACTERISTIC **and UNIT**, never by characteristic alone.
  //
  // This is not tidiness. Nitrate in this dataset arrives in two units — mg/L
  // as N and mg/L as NO3, twenty samples each — and they are the same substance
  // on scales that differ by a factor of about 4.4. Medianing across them gave
  // 2.39, which is the median of neither group and corresponds to no real
  // measurement, printed confidently with one of the two unit labels attached.
  // That is a quotable, plausible, wrong number about whether water is safe.
  const groups = new Map();
  for (const r of rows) {
    const name = r.CharacteristicName;
    if (!name) continue;
    const unit = cleanUnit(r['ResultMeasure/MeasureUnitCode']);
    const key = `${name}\u0000${unit ?? ''}`;
    if (!groups.has(key)) {
      groups.set(key, { name, unit, values: [], unmeasured: 0, latest: null, stations: new Set() });
    }
    const g = groups.get(key);
    if (r.MonitoringLocationIdentifier) g.stations.add(r.MonitoringLocationIdentifier);
    // The blank-cell rule. An empty ResultMeasureValue means the sample was
    // taken and no value recorded — not that the value was zero.
    const raw = r['ResultMeasureValue'];
    const value = (raw == null || String(raw).trim() === '') ? null : Number(raw);
    if (value == null || !Number.isFinite(value)) { g.unmeasured++; continue; }
    g.values.push(value);
    const date = r.ActivityStartDate || null;
    if (date && (!g.latest || date > g.latest.date)) g.latest = { date, value };
  }

  const measured = [...groups.values()].filter((g) => g.values.length || g.unmeasured);
  const unitsPer = new Map();
  for (const g of measured) {
    if (!unitsPer.has(g.name)) unitsPer.set(g.name, new Set());
    unitsPer.get(g.name).add(g.unit ?? '(unstated)');
  }

  const characteristics = measured.map((g) => {
    const sorted = [...g.values].sort((a, b) => a - b);
    const others = [...unitsPer.get(g.name)].filter((u) => u !== (g.unit ?? '(unstated)'));
    return {
      name: g.name,
      unit: g.unit,
      samples: g.values.length,
      // A characteristic sampled and not recorded is not a reading.
      sampled_but_not_recorded: g.unmeasured,
      stations: g.stations.size,
      median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
      min: sorted.length ? sorted[0] : null,
      max: sorted.length ? sorted[sorted.length - 1] : null,
      latest: g.latest,
      // Named on every row so nobody has to notice the duplicate themselves.
      also_reported_in: others.length ? others : null,
      // WQP's unit column carries junk for some bacterial counts — 'None' and
      // 'hours' against E. coli. Flagged rather than printed as if it were a
      // concentration.
      unit_looks_wrong: g.unit != null && /^(hours?|days?|minutes?)$/i.test(g.unit) ? g.unit : null,
    };
  }).sort((a, b) => b.samples - a.samples);

  return characteristics;
}

// ── where the water goes ───────────────────────────────────────────────────

/**
 * The stream network here. Stream order is how far down the branching a reach
 * sits; drainage area is how much ground is upstream of it. Those two numbers
 * are what turn "our creek" into "everything that happens on 302 square
 * kilometres arrives here".
 */
/**
 * Reaches within a true geodesic distance of a point, not a bounding box.
 * A box is wider at its corners than its edges, which quietly changes the
 * answer to "what is nearest" depending on which way the creek runs.
 */
async function reachesIn(lat, lng, metres) {
  const { data, cached, stale } = await getJSON(
    `${NHD}/3/query?${qs({
      geometry: `${lng},${lat}`, geometryType: 'esriGeometryPoint', inSR: 4326,
      distance: metres, units: 'esriSRUnit_Meter',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'gnis_name,lengthkm,streamorde,totdasqkm,ftype',
      returnGeometry: false, f: 'json',
    })}`, { ttlMs: DAY * 90, timeout: 45000 });
  return { feats: (data?.features ?? []).map((f) => f.attributes).filter(Boolean), cached, stale };
}

export async function flowlinesNear(lat, lng, { radiusKm = 5 } = {}) {
  // TWO QUERIES, because these are two questions at two scales. "What water am I
  // on?" is answered within a few hundred metres. "Where does it go?" is
  // answered by the largest water in the wider area. One query cannot do both:
  // ranked by size it called this point the Colorado River, five kilometres
  // away; ranked by smallest-named it called it Blunn Creek. Both were true of
  // somewhere else.
  //
  // And the honest answer here turned out to be neither of the ones I expected.
  // The seed place is called "Barton Creek Greenbelt Reach", but the nearest
  // mapped channel to its coordinates is Skunk Hollow Creek — Barton Creek is
  // four hundred metres further. That is a fact about the place, not a fault in
  // the query, and it is the kind of thing a chapter should find out early. A
  // heuristic tuned until it said "Barton Creek" would have been a lie that
  // matched the label on the door.
  const [near, wide] = await Promise.all([
    reachesIn(lat, lng, 400),
    reachesIn(lat, lng, radiusKm * 1000),
  ]);
  const { cached, stale } = wide;
  const feats = wide.feats;
  if (!feats.length) {
    return { available: false, reason: 'no NHD flowlines here — outside coverage, or no mapped channel', source: null };
  }
  markFetched('nhdplus-hr');

  // Two different questions, and answering only one of them answers the wrong
  // one. "What creek is this?" wants the reach you are standing on. "Where does
  // it go?" wants the largest water in range, because that is what it drains to.
  //
  // Ranking only by size told a chapter organizing around Barton Creek that it
  // was on the Colorado River, which is five kilometres away and true of
  // nowhere they stand. Both are reported, labelled.
  const named = [...new Set(feats.map((f) => f.gnis_name).filter(Boolean))];
  const biggest = (list) => [...list].sort((a, b) =>
    (b.streamorde ?? 0) - (a.streamorde ?? 0) || (b.totdasqkm ?? 0) - (a.totdasqkm ?? 0))[0];
  // Within 400 m, the largest named channel is the one you are on.
  const main = biggest(near.feats.filter((f) => f.gnis_name)) ?? biggest(near.feats) ?? biggest(feats);
  const nearestIsNamed = !!biggest(near.feats.filter((f) => f.gnis_name));
  const receiving = biggest(feats);

  return {
    available: true,
    source: 'USGS NHDPlus High Resolution (public domain)', source_id: 'nhdplus-hr',
    cached: !!cached, stale: !!stale,
    nearest_reach: reach(main),
    nearest_is_named: nearestIsNamed,
    // What this water drains into, when that is something different. This is
    // the "flow direction" the protocol names in layer 2.
    receiving_water: receiving && receiving.gnis_name !== main.gnis_name ? reach(receiving) : null,
    within_km: radiusKm,
    named_waters: named,
    reach_count: feats.length,
    readable: readableNetwork(main, receiving, feats.length),
  };
}

const reach = (f) => (!f ? null : {
  name: f.gnis_name ?? null,
  stream_order: f.streamorde ?? null,
  drainage_area_km2: f.totdasqkm == null ? null : Math.round(f.totdasqkm * 10) / 10,
});

function readableNetwork(main, receiving, count) {
  // "Nearest mapped channel", not "your creek". They are often the same and
  // sometimes are not, and the difference is worth a person knowing.
  const here = main.gnis_name
    ? `The nearest mapped channel is ${main.gnis_name}, an order-${main.streamorde} stream draining ${Math.round(main.totdasqkm ?? 0)} km² above this point.`
    : `${count} mapped channels here, none named, the largest order-${main.streamorde ?? '?'}.`;
  const to = receiving && receiving.gnis_name && receiving.gnis_name !== main.gnis_name
    ? ` It drains toward the ${receiving.gnis_name}.`
    : '';
  return here + to;
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

const UNITLESS = new Set(['none', 'n/a', 'na', 'unitless', '']);
const cleanUnit = (u) => {
  const t = String(u ?? '').trim();
  return UNITLESS.has(t.toLowerCase()) ? null : (t || null);
};

const fail = (err) => ({ available: false, reason: err?.message ?? String(err), source: null });
