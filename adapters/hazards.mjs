// ── Climate stress and hazards ────────────────────────────────────────────
// Atlas layer 6. The first upstream in this OS that is allowed to raise a
// Watch or a Critical signal without a human typing it.
//
// That privilege comes with a matching restraint, and it shapes this file:
//
//   • A STANDING CONDITION IS NOT AN EVENT. Being inside a FEMA flood zone is
//     true every day; it belongs on the place, not in the signal stream, or the
//     stream fills with a fact nobody can act on and stops being read.
//     Only things that STARTED become signals.
//
//   • SILENCE IS NEVER AN ALL-CLEAR. Every check here reports unavailability as
//     unavailability. A hazard panel that renders "no alerts" when it actually
//     means "could not reach NOAA" is worse than a blank one, because a person
//     will believe it.
//
// Upstreams: NOAA NWS alerts (public domain, no key), FEMA National Flood
// Hazard Layer (public domain), US Drought Monitor, NASA FIRMS (needs a key).
import { getJSON, qs } from './http.mjs';
import { markFetched } from './registry.mjs';

const NWS = 'https://api.weather.gov';
const NFHL = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';
const USDM = 'https://usdmdataservices.unl.edu/api';
const FIRMS = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';

// Same rounding weather.mjs uses, so the two share one cache entry for the
// alerts call instead of asking NOAA the same question twice.
const r3 = (n) => Number(n).toFixed(3);

/** Everything layer 6 can say about a point. Each part fails on its own. */
export async function hazardsHere(lat, lng, { fireRadiusKm = 50 } = {}) {
  const [alerts, flood, drought, fires] = await Promise.all([
    activeAlerts(lat, lng).catch((e) => unavailable(e)),
    floodZone(lat, lng).catch((e) => unavailable(e)),
    droughtStatus(lat, lng).catch((e) => unavailable(e)),
    activeFires(lat, lng, { radiusKm: fireRadiusKm }).catch((e) => unavailable(e)),
  ]);

  const checked = [alerts, flood, drought, fires];
  const unreachable = checked.filter((c) => c && c.available === false && !c.needs_key);
  const out = {
    alerts, flood, drought, fires,
    // The standing conditions, separated from the events, because they answer
    // different questions and only one of them is news.
    standing: [flood?.zone ? `FEMA flood zone ${flood.zone}` : null,
               drought?.available && drought.class ? `Drought ${drought.class}` : null].filter(Boolean),
    level: worstLevel({ alerts, drought, fires }),
    unreachable: unreachable.length ? unreachable.map((c) => c.reason) : null,
  };
  out.readable = readableHazards(out);
  return out;
}

const unavailable = (err) => ({ available: false, reason: err?.message ?? String(err), source: null });

// ── official alerts ────────────────────────────────────────────────────────

export async function activeAlerts(lat, lng) {
  const { data, cached, stale } = await getJSON(
    `${NWS}/alerts/active?${qs({ point: `${r3(lat)},${r3(lng)}` })}`,
    { ttlMs: 1000 * 60 * 10, timeout: 20000 });
  if (!data) return { available: false, reason: 'no answer from the National Weather Service', source: null };
  markFetched('nws');
  const items = (data.features ?? []).map((f) => ({
    event: f.properties?.event ?? null,
    severity: f.properties?.severity ?? null,
    urgency: f.properties?.urgency ?? null,
    certainty: f.properties?.certainty ?? null,
    headline: f.properties?.headline ?? null,
    area: f.properties?.areaDesc ?? null,
    onset: f.properties?.onset ?? f.properties?.effective ?? null,
    ends: f.properties?.ends ?? f.properties?.expires ?? null,
    id: f.properties?.id ?? f.id ?? null,
  }));
  return {
    available: true, source: 'NOAA National Weather Service (public domain)', source_id: 'nws',
    cached: !!cached, stale: !!stale,
    count: items.length, items,
    coverage_note: 'Official alerts exist only inside US National Weather Service coverage.',
  };
}

// ── the regulatory floodplain ──────────────────────────────────────────────

/**
 * A standing condition, not an event — this belongs on the place record.
 * Note what it is NOT: an absence of a mapped zone is not an absence of flood
 * risk. Huge amounts of real flooding happen outside the regulatory map, and a
 * commons reading this as "safe" is exactly the failure worth guarding against.
 */
export async function floodZone(lat, lng) {
  const { data, cached, stale } = await getJSON(
    `${NFHL}?${qs({
      geometry: { x: Number(lng), y: Number(lat), spatialReference: { wkid: 4326 } },
      geometryType: 'esriGeometryPoint', inSR: 4326,
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE',
      returnGeometry: false, f: 'json',
    })}`, { ttlMs: 1000 * 60 * 60 * 24 * 90, timeout: 25000 });

  const a = data?.features?.[0]?.attributes;
  markFetched('fema-nfhl');
  if (!a) {
    return {
      available: true, zone: null, in_special_flood_hazard_area: false,
      source: 'FEMA National Flood Hazard Layer (public domain)', source_id: 'fema-nfhl',
      cached: !!cached, stale: !!stale,
      caveat: 'No mapped zone here. That is not the same as no flood risk — much flooding ' +
              'happens outside the regulatory floodplain, and some areas are simply unmapped.',
    };
  }
  return {
    available: true,
    zone: a.FLD_ZONE ?? null,
    subtype: a.ZONE_SUBTY ?? null,
    // "T" means the point sits in a Special Flood Hazard Area — the 1%-annual-chance
    // floodplain, which is what insurance and most permitting actually turn on.
    in_special_flood_hazard_area: a.SFHA_TF === 'T',
    base_flood_elevation: a.STATIC_BFE != null && a.STATIC_BFE > -9999 ? a.STATIC_BFE : null,
    source: 'FEMA National Flood Hazard Layer (public domain)', source_id: 'fema-nfhl',
    cached: !!cached, stale: !!stale,
  };
}

// ── drought ────────────────────────────────────────────────────────────────

const DROUGHT_LABEL = {
  D0: 'abnormally dry', D1: 'moderate drought', D2: 'severe drought',
  D3: 'extreme drought', D4: 'exceptional drought',
};

/**
 * US Drought Monitor, by county.
 *
 * Two things about this host cost an hour to find and are worth writing down:
 * it rejects some user agents outright (curl gets nothing at all, which is how
 * it first looked unreachable), and it answers CSV unless you ask for JSON by
 * Accept header — there is no format query parameter. Its JSON field names are
 * lowercase (`d0`..`d4`), and the newest week comes back FIRST.
 */
export async function droughtStatus(lat, lng) {
  let fips = null;
  try {
    const { data } = await getJSON(
      `https://geo.fcc.gov/api/census/area?${qs({ lat: r3(lat), lon: r3(lng), format: 'json' })}`,
      { ttlMs: 1000 * 60 * 60 * 24 * 365, timeout: 15000 });
    fips = data?.results?.[0]?.county_fips ?? null;
  } catch { /* no county, no drought lookup */ }
  if (!fips) {
    return { available: false, reason: 'could not resolve a US county for this point', source: null };
  }

  const end = new Date();
  const start = new Date(end.getTime() - 21 * 86400000);
  const fmtDate = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  const url = `${USDM}/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent?${qs({
    aoi: fips, startdate: fmtDate(start), enddate: fmtDate(end), statisticsType: 1,
  })}`;
  const { data, cached, stale } = await getJSON(url, {
    ttlMs: 1000 * 60 * 60 * 24 * 3, timeout: 20000,
    headers: { accept: 'application/json' },
  });
  const latest = Array.isArray(data) ? data[0] : null;   // newest week first
  if (!latest) return { available: false, reason: 'no drought record returned for this county', source: null };

  // The USDM reports the percentage of the county in each class, cumulatively:
  // D1 coverage is included in D0. So the class a place is "in" is the most
  // severe one covering a meaningful share of it, read from the worst end down.
  //
  // `Number('') === 0` is the trap here, and it is the dangerous direction: a
  // blank cell would read as "0% of this county is in drought", `worst` would
  // come back null, and the panel would print a clean all-clear built out of
  // missing data. Absent has to stay distinguishable from zero.
  const coverage = droughtCoverage(latest);
  if (DROUGHT_CLASSES.every((c) => coverage[c] === null)) {
    return {
      available: false, source: null,
      reason: 'the drought record for this county came back with no readable coverage figures',
    };
  }
  const worst = droughtClass(latest);
  markFetched('usdm');
  return {
    available: true, source: 'US Drought Monitor (public domain)', source_id: 'usdm',
    cached: !!cached, stale: !!stale,
    county: latest.county ?? null,
    county_fips: fips,
    valid_at: (latest.validStart ?? latest.mapDate ?? '').slice(0, 10) || null,
    class: worst,
    label: worst ? DROUGHT_LABEL[worst] : 'no drought class covers a quarter of this county',
    coverage_pct: coverage,
    // Naming a partial read stops a half-answer from reading as a whole one.
    incomplete: DROUGHT_CLASSES.filter((c) => coverage[c] === null).length
      ? `no figure returned for ${DROUGHT_CLASSES.filter((c) => coverage[c] === null).join(', ')}`
      : null,
  };
}

/**
 * The drought classifier — ONE implementation, exported, and used by the live
 * path above.
 *
 * It was briefly two: an inline copy in droughtStatus and a `__test_` twin for
 * the test suite. Mutation-testing found it — breaking the real one left every
 * test green, because the tests were exercising the copy. A test-only duplicate
 * of a rule is not a test of that rule; it is a second place for the rule to
 * live, with the test pointed at the wrong one.
 *
 * Returns the most severe class covering at least a quarter of the county, or
 * null meaning "no class qualifies" — never "no data", which is the caller's
 * separate question and is answered by droughtCoverage being all-null.
 */
export const DROUGHT_CLASSES = ['D4', 'D3', 'D2', 'D1', 'D0'];

export function droughtCoverage(row = {}) {
  const pct = (c) => {
    const raw = row[c.toLowerCase()] ?? row[c];
    // Absent is not zero. `Number('')` is 0, and a blank cell read as 0%
    // coverage produces a clean all-clear assembled out of missing data.
    if (raw == null || raw === '') return null;
    const v = Number(raw);
    return Number.isFinite(v) ? v : null;
  };
  return Object.fromEntries(DROUGHT_CLASSES.map((c) => [c, pct(c)]));
}

export function droughtClass(row = {}) {
  const cov = droughtCoverage(row);
  if (DROUGHT_CLASSES.every((c) => cov[c] === null)) return null;
  return DROUGHT_CLASSES.find((c) => cov[c] !== null && cov[c] >= 25) ?? null;
}

// ── active fire ────────────────────────────────────────────────────────────

/**
 * NASA FIRMS. The one source here that needs an account, which breaks this OS's
 * no-account promise — so it degrades to a named, actionable absence rather
 * than an error, and never to a silent zero.
 */
export async function activeFires(lat, lng, { radiusKm = 50, days = 1, env = process.env } = {}) {
  const key = env.FIRMS_MAP_KEY;
  if (!key) {
    return {
      available: false, needs_key: 'FIRMS_MAP_KEY', source: null,
      reason: 'NASA FIRMS needs a free map key',
      how: 'Get one at https://firms.modaps.eosdis.nasa.gov/api/map_key/ and put ' +
           'FIRMS_MAP_KEY=... in the .env file. Everything else here works without an account.',
    };
  }
  const d = radiusKm / 111;
  const box = [lng - d, lat - d, lng + d, lat + d].map((v) => v.toFixed(3)).join(',');
  const { data, cached, stale } = await getJSON(
    `${FIRMS}/${key}/VIIRS_SNPP_NRT/${box}/${days}`, { ttlMs: 1000 * 60 * 30, timeout: 25000 })
    .catch(async (err) => { throw new Error(`FIRMS: ${err.message}`); });

  // FIRMS answers in CSV even on the JSON-shaped path; getJSON will have thrown
  // if it is not parseable, so anything here is already structured.
  const rows = Array.isArray(data) ? data : [];
  markFetched('nasa-firms');
  return {
    available: true, source: 'NASA FIRMS VIIRS (public domain)', source_id: 'nasa-firms',
    cached: !!cached, stale: !!stale,
    radius_km: radiusKm, window_days: days,
    detections: rows.length,
    note: 'Satellite heat detections, not confirmed fires. Controlled burns and flares show up too.',
  };
}

// ── severity ───────────────────────────────────────────────────────────────

/**
 * Map upstream hazards onto the OS's own three levels.
 * NWS severity is the authority where it exists; drought and fire are mapped
 * conservatively, because this is the one adapter that can put 'Critical' in
 * front of a person without anyone reviewing it first.
 */
export function worstLevel({ alerts, drought, fires }) {
  let level = 'Info';
  const raise = (l) => {
    const order = { Info: 0, Watch: 1, Critical: 2 };
    if (order[l] > order[level]) level = l;
  };
  for (const a of alerts?.items ?? []) {
    if (a.severity === 'Extreme' || a.severity === 'Severe') raise('Critical');
    else if (a.severity === 'Moderate') raise('Watch');
  }
  if (drought?.class === 'D4') raise('Critical');
  else if (drought?.class === 'D3' || drought?.class === 'D2') raise('Watch');
  if (fires?.available && fires.detections > 0) raise('Watch');
  return level;
}

/**
 * Hazards shaped as BioRegional OS signals, so the engine ingests them exactly
 * the way it ingests gage readings.
 *
 * Only events. The flood zone and the drought class are standing conditions and
 * are deliberately absent from this list — they belong on the place record.
 */
export function hazardSignals(hazards, { lat = null, lng = null, locationName = null } = {}) {
  const out = [];
  for (const a of hazards?.alerts?.items ?? []) {
    out.push({
      title: a.event ?? 'Weather alert',
      category: 'Climate',
      severity: a.severity === 'Extreme' || a.severity === 'Severe' ? 'Critical'
        : a.severity === 'Moderate' ? 'Watch' : 'Info',
      description: [a.headline, a.area].filter(Boolean).join(' — ') || null,
      location_name: locationName, lat, lng,
      author: 'NOAA National Weather Service (automated)',
      verified: 1,
      observed_at: a.onset ?? null,
      source_adapter: 'nws',
      // The alert id is stable for the life of the alert, so re-reading the feed
      // updates one row instead of stacking duplicates every hour.
      //
      // The fallback is PREFIXED on purpose. It is a fallback between two
      // different identifier schemes, and if an alert arrived once with an id
      // and once without, an unprefixed synthetic key would look like a second
      // alert and quietly duplicate the row. Prefixed, the duplicate is visible
      // in the data instead of hiding in it.
      source_ref: a.id ?? `synthetic:${a.event}@${a.onset}`,
    });
  }
  if (hazards?.fires?.available && hazards.fires.detections > 0) {
    out.push({
      title: `${hazards.fires.detections} satellite heat detection${hazards.fires.detections === 1 ? '' : 's'} within ${hazards.fires.radius_km} km`,
      category: 'Disturbance',
      severity: 'Watch',
      description: hazards.fires.note,
      location_name: locationName, lat, lng,
      author: 'NASA FIRMS (automated)',
      verified: 0,   // a detection is not a confirmed fire; a human closes that gap
      observed_at: new Date().toISOString(),
      source_adapter: 'firms',
      source_ref: `firms:${new Date().toISOString().slice(0, 10)}`,
    });
  }
  return out;
}

function readableHazards(h) {
  const a = h.alerts?.items?.[0];
  // The slice is deliberate, not lazy. NWS timestamps carry their own offset
  // (2026-09-12T19:00:00-05:00), so taking the first sixteen characters shows
  // the time LOCAL TO THE HAZARD — which is the only time that means anything
  // for "until when". Running it through new Date().toLocaleString() would
  // rewrite it into whatever timezone the reader happens to be sitting in, and
  // an evacuation deadline in the wrong timezone is worse than none.
  if (a) return `${a.event} in effect${a.ends ? ` until ${a.ends.slice(0, 16).replace('T', ' ')}` : ''}.`;
  if (h.fires?.available && h.fires.detections > 0) {
    return `${h.fires.detections} heat detection${h.fires.detections === 1 ? '' : 's'} within ${h.fires.radius_km} km in the last day.`;
  }
  if (h.drought?.available && h.drought.class) {
    return `${DROUGHT_LABEL[h.drought.class]} (${h.drought.class}) across this county.`;
  }
  if (h.alerts?.available) {
    return h.standing.length
      ? `No active alerts. Standing: ${h.standing.join(', ')}.`
      : 'No active alerts.';
  }
  return 'Hazard sources could not be reached — this is not an all-clear.';
}
