// ── Phenology and the growing year ────────────────────────────────────────
// When the land wakes up here, how that compares to normal, and what will grow.
//
// This is the season clock's evidence. The protocol's twelve-stage loop is
// seasonal, and "is this year early or late?" is the question a seasonal cycle
// turns on — but it is unanswerable from a chapter's own records until the
// chapter has years of them. These three sources answer it on day one:
//
//   USA-NPN Spring Index (SI-x) — modelled first leaf and first bloom, current
//     year and thirty-year normal, on a 4km grid. The anomaly between them is
//     the single best free number for "the land is early this year".
//   USDA Plant Hardiness Zone — the number every grower actually uses.
//   NASA POWER — forty years of monthly climate normals, globally, so a chapter
//     outside the US still gets a growing year.
//
// All three are public domain and need no account.
import { getJSON, qs } from './http.mjs';
import { markFetched } from './registry.mjs';

const NPN = 'https://geoserver.usanpn.org/geoserver/wms';
const PHZ = 'https://phzmapi.org';
const POWER = 'https://power.larc.nasa.gov/api/temporal/climatology/point';
const SEASON = 1000 * 60 * 60 * 24 * 7;
const FOREVER = 1000 * 60 * 60 * 24 * 365;

/** Everything the growing year can say about a point. */
export async function growingYear(lat, lng, { zip = null } = {}) {
  const [spring, zone, normals] = await Promise.all([
    springIndex(lat, lng).catch(fail),
    zip ? hardinessZone(zip).catch(fail) : Promise.resolve({ available: false, reason: 'needs a postal code', source: null }),
    climateNormals(lat, lng).catch(fail),
  ]);
  return {
    spring, hardiness: zone, normals,
    readable: [spring.readable, zone.readable, normals.readable].filter(Boolean).join(' '),
  };
}

// ── Spring Index ───────────────────────────────────────────────────────────

/**
 * First leaf and first bloom for this year, against the thirty-year normal.
 *
 * GeoServer answers GetFeatureInfo with a day-of-year number, and -9999 for
 * "outside the model" — which reads as a perfectly plausible date if nothing
 * checks for it, and would put leaf-out somewhere in the year 1997.
 */
export async function springIndex(lat, lng) {
  const layers = {
    leaf_this_year: 'si-x:leaf_anomaly',
    leaf_normal: 'si-x:30yr_avg_six_leaf',
    bloom_normal: 'si-x:30yr_avg_six_bloom',
  };
  const out = {};
  let any = false;
  for (const [key, layer] of Object.entries(layers)) {
    const v = await gridValue(layer, lat, lng).catch(() => null);
    if (v != null) { out[key] = v; any = true; }
  }
  if (!any) return { available: false, reason: 'outside USA-NPN model coverage', source: null };
  markFetched('usa-npn');

  const normal = out.leaf_normal ?? null;
  const anomaly = out.leaf_this_year ?? null;
  return {
    available: true,
    source: 'USA National Phenology Network, Extended Spring Indices (public domain)',
    source_id: 'usa-npn',
    leaf_out_normal_doy: normal == null ? null : Math.round(normal),
    leaf_out_normal_date: normal == null ? null : dayOfYearToDate(normal),
    bloom_normal_doy: out.bloom_normal == null ? null : Math.round(out.bloom_normal),
    bloom_normal_date: out.bloom_normal == null ? null : dayOfYearToDate(out.bloom_normal),
    // The anomaly layer is days: negative is early, positive is late.
    anomaly_days: anomaly == null ? null : Math.round(anomaly),
    readable: readableSpring(normal, anomaly),
  };
}

async function gridValue(layer, lat, lng) {
  const d = 0.01;
  const url = `${NPN}?${qs({
    service: 'WMS', version: '1.1.1', request: 'GetFeatureInfo',
    layers: layer, query_layers: layer, srs: 'EPSG:4326',
    bbox: `${(lng - d).toFixed(4)},${(lat - d).toFixed(4)},${(lng + d).toFixed(4)},${(lat + d).toFixed(4)}`,
    width: 10, height: 10, x: 5, y: 5, info_format: 'application/json',
  })}`;
  const { data } = await getJSON(url, { ttlMs: SEASON, timeout: 30000 });
  const props = data?.features?.[0]?.properties ?? {};
  const v = Object.values(props).find((x) => typeof x === 'number');
  // -9999 is GeoServer's no-data, and it is a number, so it passes every check
  // except this one. Left alone it becomes a date in 1997.
  if (v == null || v <= -999 || v > 400) return null;
  return v;
}

function readableSpring(normal, anomaly) {
  if (normal == null && anomaly == null) return null;
  const parts = [];
  if (normal != null) parts.push(`Leaf-out here normally begins around ${dayOfYearToDate(normal)}`);
  if (anomaly != null && Math.abs(anomaly) >= 1) {
    parts.push(`this year is running ${Math.abs(Math.round(anomaly))} day${Math.abs(Math.round(anomaly)) === 1 ? '' : 's'} ${anomaly < 0 ? 'early' : 'late'}`);
  } else if (anomaly != null) {
    parts.push('this year is on time');
  }
  return parts.join('; ') + '.';
}

function dayOfYearToDate(doy) {
  const d = new Date(Date.UTC(2001, 0, 1));
  d.setUTCDate(Math.round(doy));
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

// ── hardiness ──────────────────────────────────────────────────────────────

/** The USDA zone, by postal code. The number every seed packet is written for. */
export async function hardinessZone(zip) {
  const clean = String(zip ?? '').trim().slice(0, 5);
  if (!/^\d{5}$/.test(clean)) return { available: false, reason: 'needs a five-digit US postal code', source: null };
  const { data, cached, stale } = await getJSON(`${PHZ}/${clean}.json`, { ttlMs: FOREVER, timeout: 20000 });
  if (!data?.zone) return { available: false, reason: `no hardiness zone for ${clean}`, source: null };
  markFetched('usda-hardiness');
  return {
    available: true, source: 'USDA Plant Hardiness Zone Map (public domain)', source_id: 'usda-hardiness',
    cached: !!cached, stale: !!stale,
    zone: data.zone,
    low_temp_range_f: data.temperature_range ?? null,
    readable: `Hardiness zone ${data.zone}${data.temperature_range ? ` — coldest nights ${data.temperature_range}°F` : ''}.`,
  };
}

// ── climate normals ────────────────────────────────────────────────────────

/** Forty years of monthly normals, anywhere on Earth. */
export async function climateNormals(lat, lng) {
  const { data, cached, stale } = await getJSON(
    `${POWER}?${qs({
      parameters: 'T2M,T2M_MIN,T2M_MAX,PRECTOTCORR', community: 'AG',
      longitude: Number(lng).toFixed(4), latitude: Number(lat).toFixed(4), format: 'JSON',
    })}`, { ttlMs: FOREVER, timeout: 40000 });
  const p = data?.properties?.parameter;
  if (!p?.T2M) return { available: false, reason: 'no climate normals for this point', source: null };
  markFetched('nasa-power');

  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const month = (k, m) => (p[k]?.[m] == null || p[k][m] <= -999 ? null : Math.round(p[k][m] * 10) / 10);
  const temps = MONTHS.map((m) => month('T2M', m)).filter((v) => v != null);
  const rain = MONTHS.map((m) => month('PRECTOTCORR', m)).filter((v) => v != null);
  const mins = MONTHS.map((m) => month('T2M_MIN', m)).filter((v) => v != null);
  const wettest = MONTHS[rain.indexOf(Math.max(...rain))];
  const driest = MONTHS[rain.indexOf(Math.min(...rain))];

  return {
    available: true, source: 'NASA POWER climatology (public domain)', source_id: 'nasa-power',
    cached: !!cached, stale: !!stale,
    monthly: Object.fromEntries(MONTHS.map((m) => [m.toLowerCase(), {
      mean_c: month('T2M', m), min_c: month('T2M_MIN', m), max_c: month('T2M_MAX', m),
      precip_mm_day: month('PRECTOTCORR', m),
    }])),
    annual_mean_c: temps.length ? Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10 : null,
    coldest_month_min_c: mins.length ? Math.min(...mins) : null,
    wettest_month: wettest ? title(wettest) : null,
    driest_month: driest ? title(driest) : null,
    readable: temps.length
      ? `Averages ${Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10}°C across the year` +
        (wettest && driest ? `, wettest in ${title(wettest)}, driest in ${title(driest)}.` : '.')
      : null,
  };
}

const title = (m) => m[0] + m.slice(1).toLowerCase();
const fail = (err) => ({ available: false, reason: err?.message ?? String(err), source: null });
