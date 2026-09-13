// ── The library ───────────────────────────────────────────────────────────
// Everything downloaded, readable with no network at all.
//
// Every function here touches only the filesystem. That is the whole point:
// a chapter in a valley with no signal, or a laptop taken to a field station,
// still has the soil, the species, the climate and the water for its region.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  regions, region, regionsAt, loadDossier, staleSections,
  coverage, DOSSIER_DIR, CADENCE_DAYS,
} from '../adapters/dossier.mjs';
import { all, one } from '../core/db.mjs';

export { regions, region, regionsAt, loadDossier, staleSections, coverage };

/** The regions this chapter actually sits in — what to download first. */
export function myRegions(chapterId) {
  const places = all('SELECT name, lat, lng FROM places WHERE chapter_id=? AND lat IS NOT NULL', chapterId);
  const chapter = one('SELECT lat, lng FROM chapters WHERE id=?', chapterId);
  const points = [...places, ...(chapter?.lat != null ? [{ name: 'chapter centre', ...chapter }] : [])];
  const l4 = new Map(), l3 = new Map();
  for (const p of points) {
    const hit = regionsAt(p.lat, p.lng);
    for (const r of hit.level4) l4.set(r.code, r);
    for (const r of hit.level3) l3.set(r.code, r);
  }
  return { level4: [...l4.values()], level3: [...l3.values()], from_points: points.length };
}

/**
 * The one region this chapter is actually IN.
 *
 * Not the same question as myRegions(), and the difference cost the product its
 * central claim for every chapter that is not the demo.
 *
 * `regionsAt()` is a BOUNDING-BOX test, and it says so. For choosing what to
 * download that is correct and deliberate — you want every region that overlaps
 * your area. For "where am I" it is a guess, and the board was taking
 * `level4[0]`, the arbitrary first bbox hit. Ecoregions are long and crooked;
 * `samplePoints()` in dossier.mjs writes that lesson down thirty lines below the
 * function. Measured on real points:
 *
 *   Bend OR       6 bbox hits, picked 4b Western Cascades Montane Highlands.
 *                 The EPA polygon says 9d Ponderosa Pine/Bitterbrush Woodland.
 *   Asheville NC  13 hits, picked Southern Outer Piedmont. It is in the Blue Ridge.
 *   Missoula MT   3 hits, picked 15a. The polygon says 17s.
 *   Barton Creek  4 hits, picked 30c. Correct — which is why nobody saw this.
 *
 * The right answer was already in the row the whole time: `places.ecoregion_name`
 * is written by `resolveEcoregion()`, a real EPA polygon query, when the place is
 * located. The board printed the guess one comma away from the correct watershed
 * it took from the same table.
 *
 * So: the polygon answer decides, and the bbox hits are used only to recover the
 * CODE for a name, which is what the dossier library is keyed by. Names repeat
 * across Level III regions, so the intersection of the two is what disambiguates.
 *
 * Rows located before this existed carry a name and no code, which is the usual
 * trap — a lookup that fails has to read as "not resolved", never as "no region".
 * Hence the explicit `basis` field: a caller can tell a polygon answer from a
 * fallback, and nothing silently presents a guess as a fact.
 */
export function homeRegion(chapterId) {
  const place = one(
    `SELECT name, lat, lng, ecoregion_name, bioregion_name FROM places
      WHERE chapter_id=? AND lat IS NOT NULL
      ORDER BY (ecoregion_name IS NULL), rowid LIMIT 1`, chapterId);
  if (!place) return null;

  const candidates = regionsAt(place.lat, place.lng).level4;
  const named = (place.ecoregion_name ?? '').trim().toLowerCase();

  if (named) {
    const exact = candidates.find((r) => r.name.trim().toLowerCase() === named)
      // A place can sit just outside its own region's simplified bbox, so the
      // whole index is the second look. The polygon already decided; this is
      // only recovering a code.
      ?? regions().find((r) => r.name.trim().toLowerCase() === named);
    if (exact) return { ...exact, basis: 'polygon', place: place.name };
    // The polygon named a region the index does not carry. Say so rather than
    // substituting a neighbour: a wrong region confidently stated is worse than
    // an unresolved one.
    return {
      code: null, name: place.ecoregion_name, level3_name: place.bioregion_name ?? null,
      basis: 'polygon_unmatched', place: place.name,
    };
  }

  // Never located. Nearest bbox centre beats the first one in the file, but it
  // is still a guess and is labelled as one.
  if (!candidates.length) return null;
  const d2 = (r) => ((r.bbox[0] + r.bbox[2]) / 2 - place.lng) ** 2
    + ((r.bbox[1] + r.bbox[3]) / 2 - place.lat) ** 2;
  const nearest = [...candidates].sort((a, b) => d2(a) - d2(b) || a.code.localeCompare(b.code))[0];
  return { ...nearest, basis: 'guess', place: place.name };
}

/** Regions adjacent to mine — where a neighbouring chapter's knowledge applies. */
export function neighbours(code, { scheme = 'epa-l4', limit = 8 } = {}) {
  const r = region(code, { scheme });
  if (!r) return [];
  const touches = (a, b) =>
    a.bbox[0] <= b.bbox[2] && a.bbox[2] >= b.bbox[0] &&
    a.bbox[1] <= b.bbox[3] && a.bbox[3] >= b.bbox[1];
  return regions({ scheme })
    .filter((x) => x.code !== r.code && touches(r, x))
    .slice(0, limit)
    .map((x) => ({ code: x.code, name: x.name, level3_name: x.level3_name, downloaded: !!loadDossier(x.code, scheme) }));
}

/**
 * Search everything downloaded, offline, for a species — common or scientific.
 * "Where does Ashe juniper actually live?" answered from disk.
 */
export function findSpecies(query, { limit = 40 } = {}) {
  const q = String(query).toLowerCase();
  const hits = [];
  for (const scheme of ['epa-l4', 'epa-l3']) {
    const dir = join(DOSSIER_DIR, scheme);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      let d;
      try { d = JSON.parse(readFileSync(join(dir, file), 'utf8')); } catch { continue; }
      for (const [group, g] of Object.entries(d.life?.groups ?? {})) {
        for (const sp of g.most_observed ?? []) {
          if (`${sp.common_name ?? ''} ${sp.scientific_name ?? ''}`.toLowerCase().includes(q)) {
            hits.push({
              region_code: d.code, region: d.name, level3: d.identity?.level3_name,
              states: d.identity?.states, group,
              common_name: sp.common_name, scientific_name: sp.scientific_name,
              observations: sp.observations, wikipedia: sp.wikipedia,
            });
          }
        }
      }
      // Threatened species are searchable by name; their locations are not stored.
      for (const sp of d.life?.threatened?.species ?? []) {
        if (`${sp.common_name ?? ''} ${sp.scientific_name ?? ''}`.toLowerCase().includes(q)) {
          hits.push({
            region_code: d.code, region: d.name, group: 'threatened',
            common_name: sp.common_name, scientific_name: sp.scientific_name,
            observations: sp.observations,
            note: 'Listed as threatened here. Locations are deliberately not recorded.',
          });
        }
      }
    }
  }
  hits.sort((a, b) => (b.observations ?? 0) - (a.observations ?? 0));
  return { query, matches: hits.length, results: hits.slice(0, limit), searched: 'downloaded dossiers only (offline)' };
}

/** A plain-language brief on one region, entirely from disk. */
export function brief(code, { scheme = 'epa-l4' } = {}) {
  const r = region(code, { scheme });
  if (!r) return { error: `no region ${code}` };
  const d = loadDossier(r.code, scheme);
  if (!d) {
    return {
      region: r.name, code: r.code, downloaded: false,
      identity: r,
      hint: `Not downloaded yet. Run: npm run data -- --region ${r.code}`,
    };
  }
  const g = d.life?.groups ?? {};
  const topOf = (k, n = 6) => (g[k]?.most_observed ?? []).slice(0, n)
    .map((x) => x.common_name || x.scientific_name).filter(Boolean);
  const soil0 = d.soil?.profiles?.[0]?.soil;

  return {
    region: d.name, code: d.code, downloaded: true,
    updated_at: d.updated_at,
    stale_sections: staleSections(d),
    offline: true,
    identity: {
      level3: d.identity?.level3_name, division: d.identity?.division,
      biome: d.identity?.biome, states: d.identity?.states,
    },
    life: {
      plants_recorded: g.plants?.species_recorded ?? null,
      animals_recorded: ['birds', 'mammals', 'reptiles_amphibians', 'fish']
        .reduce((s, k) => s + (g[k]?.species_recorded ?? 0), 0) || null,
      insects_recorded: g.insects?.species_recorded ?? null,
      fungi_recorded: g.fungi?.species_recorded ?? null,
      threatened_count: d.life?.threatened?.count ?? null,
      signature_plants: topOf('plants'),
      signature_birds: topOf('birds', 4),
      signature_mammals: topOf('mammals', 4),
    },
    soil: soil0 ? {
      map_unit: soil0.map_unit ?? null,
      readable: soil0.readable ?? null,
      source: soil0.source ?? null,
      points_sampled: d.soil?.sampled_points ?? 0,
    } : null,
    climate: d.climate?.available ? {
      source: d.climate.source,
      readable: d.climate.readable ?? null,
    } : null,
    water: { points_sampled: d.water?.sampled_points ?? 0 },
    resources: d.resources?.layers ?? d.resources?.readable ?? null,
    culture: { status: d.culture?.status, start_with: d.culture?.where_to_start },
    sections: d.sections,
  };
}

/** What still needs downloading or refreshing, cheapest-first. */
export function workList(chapterId, { includeAll = false } = {}) {
  const mine = chapterId ? myRegions(chapterId) : { level4: [], level3: [] };
  const pool = includeAll
    ? [...regions().map((r) => ({ ...r, scheme: 'epa-l4' })),
       ...regions({ scheme: 'epa-l3' }).map((r) => ({ ...r, scheme: 'epa-l3' }))]
    : [...mine.level4.map((r) => ({ ...r, scheme: 'epa-l4' })),
       ...mine.level3.map((r) => ({ ...r, scheme: 'epa-l3' }))];

  const missing = [], stale = [];
  for (const r of pool) {
    const d = loadDossier(r.code, r.scheme);
    if (!d) missing.push({ code: r.code, name: r.name, scheme: r.scheme });
    else {
      const s = staleSections(d);
      if (s.length) stale.push({ code: r.code, name: r.name, scheme: r.scheme, sections: s });
    }
  }
  return { missing, stale, considered: pool.length, cadence_days: CADENCE_DAYS };
}
