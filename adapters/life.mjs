// ── Habitat and biodiversity ──────────────────────────────────────────────
// Atlas layer 5. What lives here, what is under pressure here, and whether the
// ground is protected.
//
// This is the richest open data in the whole catalogue and the only layer where
// getting the plumbing right is not enough — getting the *disclosure* right is
// the harder half. Two rules are built into the shape of this file rather than
// checked afterwards:
//
//   1. THE COMMON LIST CARRIES NO COORDINATES. iNaturalist species_counts
//      returns names and counts, never places. So "what lives here" is safe to
//      publish, because it is a fact about the bioregion, not about a nest.
//
//   2. NOTHING RARE IS EVER PLACED. For anything threatened, this adapter asks
//      only for COUNTS — GBIF is queried with limit=0 and facets only, so a
//      coordinate for a rare species never enters the process at all. That is a
//      stronger guarantee than fetching records and filtering them afterwards,
//      because a filter can be forgotten and a query that returns no rows
//      cannot leak. Aggregating obscured records is exactly how the obscuring
//      gets undone, and orchids, cacti, ginseng and turtles are taken that way.
//
// The threatened block is still returned at 'restricted': the presence of a
// rare species inside a small box is itself the sensitive fact, even with no
// point attached to it.
import { getJSON, qs } from './http.mjs';
import { markFetched } from './registry.mjs';

/**
 * The level anything with a conservation status is held at. Named, exported and
 * asserted in the test suite rather than left as a string literal inside one
 * function — a rule that protects something is a rule worth being able to test.
 */
export const THREATENED_SENSITIVITY = 'restricted';

/**
 * How a taxon is named for a person, and which kind of name that turned out to
 * be. One function because the rule is used in two adapters, and a naming rule
 * living in two places is a naming rule that will eventually disagree with
 * itself.
 *
 * The flag exists because `name` alone is a fallback between two plausible
 * answers — a common name or a Latin binomial — and the caller cannot tell
 * which won. That is the shape that puts "Malvaviscus arboreus" into a sentence
 * written for "Turk's Cap" with nothing anywhere recording that it happened.
 */
export function displayName(taxon) {
  const common = taxon?.preferred_common_name ?? null;
  const scientific = taxon?.name ?? null;
  return {
    name: common ?? scientific ?? null,
    name_is: common ? 'common' : (scientific ? 'scientific' : null),
    common_name: common,
    scientific_name: scientific,
  };
}

const INAT = 'https://api.inaturalist.org/v1';
const GBIF = 'https://api.gbif.org/v1';
const WEEK = 1000 * 60 * 60 * 24 * 7;

/** Everything layer 5 can say about a point, each part degrading on its own. */
export async function lifeHere(lat, lng, { radiusKm = 10, limit = 20 } = {}) {
  const [common, threatened, depth, protection] = await Promise.all([
    speciesHere(lat, lng, { radiusKm, limit }).catch((e) => unavailable(e)),
    threatenedHere(lat, lng, { radiusKm }).catch((e) => unavailable(e)),
    recordDepth(lat, lng, { radiusKm }).catch((e) => unavailable(e)),
    protectedArea(lat, lng).catch((e) => unavailable(e)),
  ]);
  return {
    radius_km: radiusKm,
    species: common,
    threatened,
    record_depth: depth,
    protection,
    readable: readableLife({ common, threatened, depth, protection, radiusKm }),
  };
}

const unavailable = (err) => ({ available: false, reason: err?.message ?? String(err), source: null });

// ── what lives here ────────────────────────────────────────────────────────

/**
 * The ranked species list. No coordinates are requested and none are returned —
 * species_counts is a tally, which is why this one is safe at 'public'.
 */
export async function speciesHere(lat, lng, { radiusKm = 10, limit = 20, group = null } = {}) {
  const params = {
    lat: r4(lat), lng: r4(lng), radius: radiusKm,
    per_page: Math.min(limit, 200), quality_grade: 'research',
  };
  if (group) params.iconic_taxa = group;
  const { data, cached, stale } = await getJSON(`${INAT}/observations/species_counts?${qs(params)}`,
    { ttlMs: WEEK, timeout: 30000 });
  const results = data?.results ?? [];
  if (!results.length && !data) return { available: false, reason: 'no answer from iNaturalist', source: null };

  markFetched('inaturalist');
  return {
    available: true,
    source: 'iNaturalist research-grade observations',
    source_id: 'inaturalist',
    sensitivity: 'public',
    cached: !!cached, stale: !!stale,
    total_species: data?.total_results ?? results.length,
    // Plants get counted separately because this is the layer a medicine walk,
    // a seed collection and a restoration planting all start from.
    // `name` is a display name that may be either a common name or a Latin
    // binomial, so it carries a flag saying which — the same fix as `at_is` on
    // the loops engine. Without it a caller renders "Malvaviscus arboreus" in a
    // sentence written for "Turk's Cap" and cannot tell that it happened.
    // `common_name` is explicitly null when there is none, so nobody has to
    // guess whether the field is absent or the species simply has no common name.
    top: results.map((r) => ({
      ...displayName(r.taxon),
      rank: r.taxon?.rank ?? null,
      observations: r.count,
      introduced: r.taxon?.introduced ?? null,
      taxon_id: r.taxon?.id ?? null,
    })),
    note: 'Counts of what people have identified here. No coordinates are requested or stored.',
  };
}

/**
 * What is under pressure here — names and statuses only, held at 'restricted'.
 * Deliberately no coordinates, no counts per location, no map layer.
 */
export async function threatenedHere(lat, lng, { radiusKm = 10, limit = 25 } = {}) {
  const { data, cached, stale } = await getJSON(
    `${INAT}/observations/species_counts?${qs({
      lat: r4(lat), lng: r4(lng), radius: radiusKm, threatened: true,
      per_page: Math.min(limit, 100), quality_grade: 'research',
    })}`, { ttlMs: WEEK, timeout: 30000 });

  const results = data?.results ?? [];
  markFetched('inaturalist');
  return {
    available: true,
    source: 'iNaturalist conservation statuses',
    source_id: 'inaturalist',
    // The protocol's ladder, applied by the adapter rather than by whoever
    // remembers to. A record here must never be created at 'public'.
    sensitivity: THREATENED_SENSITIVITY,
    cached: !!cached, stale: !!stale,
    total_taxa: data?.total_results ?? results.length,
    taxa: results.map((r) => ({
      ...displayName(r.taxon),
      status: r.taxon?.conservation_status?.status_name ?? null,
      // iNaturalist's own obscuring decision, carried forward rather than re-made.
      upstream_geoprivacy: r.taxon?.conservation_status?.geoprivacy ?? null,
    })),
    disclosure:
      'Names and statuses only. No coordinates are requested from any upstream for these taxa, ' +
      'and none are stored. Publishing this list at "public" can undo the obscuring that ' +
      'protects them — keep it at council or restricted.',
  };
}

/**
 * How deeply this place has been recorded, and how much of that record is of
 * something at risk. Facets only: limit=0 means GBIF returns counts and not one
 * single coordinate.
 */
export async function recordDepth(lat, lng, { radiusKm = 10 } = {}) {
  const d = radiusKm / 111;   // close enough at any latitude a chapter organizes at
  const url = `${GBIF}/occurrence/search?${qs({
    decimalLatitude: `${r4(lat - d)},${r4(lat + d)}`,
    decimalLongitude: `${r4(lng - d)},${r4(lng + d)}`,
    hasCoordinate: true,
    limit: 0,
  })}&facet=iucnRedListCategory&facet=year&facet=kingdomKey&facetLimit=8&year.facetLimit=250`;
  // year.facetLimit is per-facet on purpose: the other facets want their top
  // handful, but the year facet has to cover the WHOLE range or "earliest" is
  // really "earliest of the eight busiest years" — which in a well-recorded
  // place reads as 2013 when the true answer is 1801.
  const { data, cached, stale } = await getJSON(url, { ttlMs: WEEK, timeout: 30000 });
  if (!data) return { available: false, reason: 'no answer from GBIF', source: null };

  const facet = (name) => Object.fromEntries(
    (data.facets?.find((f) => f.field === name)?.counts ?? []).map((c) => [c.name, c.count]));
  const iucn = facet('IUCN_RED_LIST_CATEGORY');
  // GBIF facets on the kingdom KEY, not the name, so the numbers have to be
  // turned back into words here rather than shown to a person as "6".
  const kingdoms = Object.fromEntries(
    Object.entries(facet('KINGDOM_KEY'))
      .map(([k, v]) => [KINGDOMS[k] ?? `kingdom ${k}`, v])
      .filter(([, v]) => v > 0));
  const years = facet('YEAR');
  const yearKeys = Object.keys(years).map(Number).filter(Number.isFinite);
  // Busiest years are what a person wants to see; the full span is what tells
  // them whether this place has a memory or only a smartphone era.
  const busiest = Object.fromEntries(
    Object.entries(years).sort((a, b) => b[1] - a[1]).slice(0, 8));

  markFetched('gbif');
  return {
    available: true,
    source: 'GBIF occurrence records',
    source_id: 'gbif',
    sensitivity: 'public',
    cached: !!cached, stale: !!stale,
    total_records: data.count ?? 0,
    by_kingdom: kingdoms,
    busiest_years: busiest,
    earliest_year: yearKeys.length ? Math.min(...yearKeys) : null,
    years_of_record: yearKeys.length || null,
    // VU/EN/CR counted, never placed. This is the honest way to say "there is
    // something here worth protecting" without saying where it is.
    at_risk: {
      vulnerable: iucn.VU ?? 0,
      endangered: iucn.EN ?? 0,
      critically_endangered: iucn.CR ?? 0,
      near_threatened: iucn.NT ?? 0,
      data_deficient: iucn.DD ?? 0,
      least_concern: iucn.LC ?? 0,
    },
    note: 'Counts only — this query asks for zero records, so no coordinate for any taxon is fetched.',
  };
}

// ── is the ground protected ────────────────────────────────────────────────

/**
 * PAD-US. The authoritative USGS host has been answering 502; the Forest
 * Service mirror covers only Forest Service land. Both are tried, and when
 * neither answers this says so rather than implying the ground is unprotected —
 * "no data" and "not protected" are very different answers to a quest gate.
 */
export async function protectedArea(lat, lng) {
  const geometry = { x: Number(lng), y: Number(lat), spatialReference: { wkid: 4326 } };
  const common = {
    geometry, geometryType: 'esriGeometryPoint', inSR: 4326,
    spatialRel: 'esriSpatialRelIntersects', returnGeometry: false, f: 'json',
  };
  const attempts = [
    {
      label: 'USGS PAD-US',
      url: `https://gis1.usgs.gov/arcgis/rest/services/padus4_1/Protection_Status/MapServer/0/query?${
        qs({ ...common, outFields: 'Unit_Nm,Mang_Name,Des_Tp,GAP_Sts,Loc_Own' })}`,
      map: (a) => ({ unit: a.Unit_Nm, manager: a.Mang_Name, designation: a.Des_Tp, gap_status: a.GAP_Sts, owner: a.Loc_Own }),
    },
    {
      label: 'USFS PAD-US mirror (Forest Service land only)',
      url: `https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_PADUS_01/MapServer/0/query?${
        qs({ ...common, outFields: 'unit_nm,mang_name,des_tp,own_name' })}`,
      map: (a) => ({ unit: a.unit_nm, manager: a.mang_name, designation: a.des_tp, gap_status: null, owner: a.own_name }),
    },
  ];

  const reasons = [];
  for (const attempt of attempts) {
    try {
      const { data, cached, stale } = await getJSON(attempt.url, { ttlMs: 1000 * 60 * 60 * 24 * 90, timeout: 25000 });
      const a = data?.features?.[0]?.attributes;
      markFetched('padus');
      if (!a) {
        return {
          available: true, protected: false, source: attempt.label,
          source_id: 'padus', cached: !!cached, stale: !!stale,
          note: 'No protected-area polygon covers this point in the layer that answered.',
        };
      }
      return {
        available: true, protected: true, ...attempt.map(a),
        source: attempt.label, source_id: 'padus',
        cached: !!cached, stale: !!stale,
      };
    } catch (err) { reasons.push(`${attempt.label}: ${err.message}`); }
  }
  return {
    available: false, protected: null, source: null,
    reason: reasons.join('; '),
    note: 'No protected-area service answered. This is not evidence that the ground is unprotected.',
  };
}

// ── one line for the panel ─────────────────────────────────────────────────

function readableLife({ common, threatened, depth, protection, radiusKm = 10 }) {
  const bits = [];
  if (common?.available && common.total_species) {
    bits.push(`${common.total_species.toLocaleString()} species recorded within ${radiusKm} km`);
  }
  if (depth?.available && depth.earliest_year) {
    bits.push(`records back to ${depth.earliest_year}`);
  }
  if (threatened?.available && threatened.total_taxa) {
    bits.push(`${threatened.total_taxa} of them carry a conservation status`);
  }
  if (protection?.available && protection.protected && protection.unit) {
    bits.push(`the ground is inside ${protection.unit}`);
  }
  if (!bits.length) return null;
  return bits.join(', ').replace(/^./, (c) => c.toUpperCase()) + '.';
}

const KINGDOMS = {
  0: 'Unplaced', 1: 'Animals', 2: 'Archaea', 3: 'Bacteria', 4: 'Chromista',
  5: 'Fungi', 6: 'Plants', 7: 'Protozoa', 8: 'Viruses',
};

const r4 = (n) => Number(Number(n).toFixed(4));
