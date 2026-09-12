// ── Living things ─────────────────────────────────────────────────────────
// iNaturalist  (CC-BY-NC for most observations; taxon names are facts)
//   → community-verified counts WITH common names, which is what a person
//     standing in a field actually needs.
// GBIF         (CC0 / CC-BY per dataset)
//   → the scientific record: occurrence totals, taxonomy, authority.
// USDA PLANTS  (public domain, US)
//   → native vs introduced status, growth habit, duration.
import { getJSON, qs } from './http.mjs';

const INAT = 'https://api.inaturalist.org/v1';
const GBIF = 'https://api.gbif.org/v1';

const GROUPS = {
  plants:   { iconic: 'Plantae',  gbifKingdom: 6 },
  animals:  { iconic: 'Animalia', gbifKingdom: 1 },
  birds:    { iconic: 'Aves' },
  insects:  { iconic: 'Insecta' },
  fungi:    { iconic: 'Fungi',    gbifKingdom: 5 },
  amphibians_reptiles: { iconic: 'Amphibia,Reptilia' },
};

/** The species most often actually seen inside a bounding box, by group. */
export async function speciesIn(bbox, { group = 'plants', limit = 60, threatenedOnly = false } = {}) {
  const [w, s, e, n] = bbox;
  const g = GROUPS[group];
  if (!g) throw new Error(`unknown group ${group}`);
  const params = {
    nelat: n, nelng: e, swlat: s, swlng: w,
    iconic_taxa: g.iconic, per_page: Math.min(limit, 200),
    quality_grade: 'research',
    ...(threatenedOnly ? { threatened: true } : {}),
  };
  const { data, stale } = await getJSON(`${INAT}/observations/species_counts?${qs(params)}`,
    { ttlMs: 1000 * 60 * 60 * 24 * 30, timeout: 45000 });
  return {
    group,
    total_species: data?.total_results ?? 0,
    stale: !!stale,
    species: (data?.results ?? []).map((r) => ({
      observations: r.count,
      name: r.taxon?.name,
      common_name: r.taxon?.preferred_common_name ?? null,
      rank: r.taxon?.rank,
      taxon_id: r.taxon?.id,
      threatened: r.taxon?.threatened ?? null,
      introduced: r.taxon?.introduced ?? null,
      native: r.taxon?.native ?? null,
      wikipedia: r.taxon?.wikipedia_url ?? null,
    })),
  };
}

/** GBIF's count of everything recorded inside a polygon — the scientific baseline. */
export async function occurrenceTotals(bbox) {
  const [w, s, e, n] = bbox;
  const wkt = `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`;
  const out = {};
  for (const [name, kingdomKey] of [['plants', 6], ['animals', 1], ['fungi', 5]]) {
    try {
      const { data } = await getJSON(
        `${GBIF}/occurrence/search?${qs({ geometry: wkt, limit: 0, kingdomKey })}`,
        { ttlMs: 1000 * 60 * 60 * 24 * 30, timeout: 60000 });
      out[name] = data?.count ?? null;
    } catch { out[name] = null; }
  }
  return { source: 'GBIF', totals: out, wkt_used: wkt };
}

/** Native status, habit and duration for US plants — the practical questions. */
export async function plantProfile(scientificName) {
  try {
    const { data } = await getJSON(
      `https://plantsservices.sc.egov.usda.gov/api/PlantSearch?${qs({ searchText: scientificName })}`,
      { ttlMs: 1000 * 60 * 60 * 24 * 365, timeout: 30000 });
    const hit = (Array.isArray(data) ? data : [])[0]?.Plant;
    if (!hit) return null;
    return {
      symbol: hit.Symbol,
      scientific_name: strip(hit.ScientificName),
      common_name: hit.CommonName,
      duration: hit.Duration ?? null,
      growth_habit: hit.GrowthHabit ?? null,
      native_status: hit.NativeStatus ?? null,
      source: 'USDA PLANTS (public domain)',
    };
  } catch { return null; }
}
const strip = (s) => (s ?? '').replace(/<[^>]+>/g, '').trim();
