// ── Region dossiers ───────────────────────────────────────────────────────
// The other adapters in this folder answer "what is HERE" — a point and a
// radius. That is the right shape for a chapter standing somewhere.
//
// This one answers "what is this ECOREGION" — all 967 of them, whether or not
// anybody has ever stood in one. It compiles a durable file per region so the
// knowledge survives being offline, survives the HTTP cache being cleared, and
// can be copied to a machine that has never had a network.
//
// It calls the existing adapters rather than re-asking their upstreams, so a
// licence or a cadence is still declared in exactly one place (registry.mjs).
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ROOT } from '../core/db.mjs';
import { getJSON, qs } from './http.mjs';
import { resolveEcoregion } from './ecoregion.mjs';
import { groundProfile } from './soil.mjs';
import { hydrologyHere } from './hydrology.mjs';
import { communityHere } from './community.mjs';
import { climateAverages } from './phenology.mjs';
import { hazardsHere } from './hazards.mjs';
import { attributionFor, markFetched } from './registry.mjs';

export const DOSSIER_DIR = join(ROOT, 'data', 'dossiers');
export const INDEX_PATH = join(ROOT, 'data', 'regions', 'ecoregions-epa.json');

/**
 * How long each section stays true. Soil does not move; a drought does.
 * A section past its cadence is refetched on the next connected run; a section
 * inside it is never re-asked, because re-asking a settled question is just
 * noise with a timer on it.
 */
/**
 * Which registry sources each section draws on. IDs only — a licence or an
 * attribution string written here would be a second place for it to live, and
 * the second place is always the one that goes stale. registry.mjs is the
 * single declaration; attributionFor() renders it at export time.
 */
export const SECTION_SOURCES = {
  identity:  ['epa-ecoregions'],
  climate:   ['nasa-power'],
  soil:      ['usda-ssurgo', 'isric-soilgrids', 'usgs-3dep', 'mrlc-nlcd'],
  life:      ['inaturalist'],
  water:     ['usgs-nwis', 'water-quality-portal', 'nhdplus-hr', 'usgs-wbd'],
  resources: ['openstreetmap'],
  hazards:   ['nws', 'usdm', 'fema-nfhl', 'nasa-firms'],
  culture:   [],
};

export const CADENCE_DAYS = {
  identity: null,      // from the shipped index; never refetched
  climate: 180,
  soil: 3650,
  life: 30,
  water: 30,
  resources: 60,
  hazards: 7,
  culture: null,       // never auto-fetched — see cultureSlot()
};

// ── the index ─────────────────────────────────────────────────────────────
let _index = null;
export function index() {
  if (_index) return _index;
  if (!existsSync(INDEX_PATH)) {
    throw new Error('Region index missing. Run: npm run data -- --build-index');
  }
  _index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
  return _index;
}

export function regions({ scheme = 'epa-l4' } = {}) {
  const ix = index();
  return scheme === 'epa-l3' ? ix.level3 : ix.level4;
}

export function region(code, { scheme = 'epa-l4' } = {}) {
  return regions({ scheme }).find((r) => r.code.toLowerCase() === String(code).toLowerCase()) ?? null;
}

/** Every region whose extent overlaps a point — usually one L4 and its L3. */
export function regionsAt(lat, lng) {
  const hit = (r) => lng >= r.bbox[0] && lng <= r.bbox[2] && lat >= r.bbox[1] && lat <= r.bbox[3];
  return { level4: regions().filter(hit), level3: regions({ scheme: 'epa-l3' }).filter(hit) };
}

export function dossierPath(code, scheme = 'epa-l4') {
  return join(DOSSIER_DIR, scheme, `${code.toLowerCase()}.json`);
}

export function loadDossier(code, scheme = 'epa-l4') {
  const p = dossierPath(code, scheme);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

/** Which sections are past their cadence. Pure — never touches the network. */
export function staleSections(dossier) {
  if (!dossier) return Object.keys(CADENCE_DAYS).filter((k) => CADENCE_DAYS[k] !== null);
  const out = [];
  for (const [section, days] of Object.entries(CADENCE_DAYS)) {
    if (days === null) continue;
    const at = dossier.sections?.[section]?.fetched_at;
    if (!at) { out.push(section); continue; }
    const age = (Date.now() - new Date(at).getTime()) / 86400000;
    if (age > days) out.push(section);
  }
  return out;
}

// ── sampling ──────────────────────────────────────────────────────────────
/**
 * Points that are genuinely INSIDE the ecoregion, not merely inside its
 * bounding box. Ecoregions are long and crooked — the Balcones Canyonlands
 * bbox centre lands in a different ecoregion entirely — so each candidate is
 * checked against the authoritative boundary before it is used.
 */
export async function samplePoints(r, { want = 3 } = {}) {
  const [w, s, e, n] = r.bbox;
  const candidates = [
    [(s + n) / 2, (w + e) / 2],
    [s + (n - s) * 0.3, w + (e - w) * 0.3],
    [s + (n - s) * 0.7, w + (e - w) * 0.7],
    [s + (n - s) * 0.3, w + (e - w) * 0.7],
    [s + (n - s) * 0.7, w + (e - w) * 0.3],
    [s + (n - s) * 0.5, w + (e - w) * 0.2],
    [s + (n - s) * 0.5, w + (e - w) * 0.8],
    [s + (n - s) * 0.2, w + (e - w) * 0.5],
    [s + (n - s) * 0.8, w + (e - w) * 0.5],
  ];
  const inside = [];
  for (const [lat, lng] of candidates) {
    if (inside.length >= want) break;
    try {
      const eco = await resolveEcoregion(lat, lng);
      const match = r.scheme === 'epa-l3'
        ? eco?.level3_code === r.code
        : eco?.ecoregion_code === r.code;
      if (match) inside.push({ lat: round(lat), lng: round(lng) });
    } catch { /* offline or off-coverage; try the next */ }
  }
  // Nothing verified inside: fall back to the centre and say so.
  return inside.length ? inside : [{ lat: round((s + n) / 2), lng: round((w + e) / 2), unverified: true }];
}
const round = (n) => Number(n.toFixed(4));

// ── region-scale life ─────────────────────────────────────────────────────
// iNaturalist counts species across a whole bounding box, which is the one
// question a radius cannot answer. Common names included, because a person
// standing in a field needs "Ashe juniper", not a taxon id.
const INAT = 'https://api.inaturalist.org/v1';
const GROUPS = [
  ['plants', 'Plantae'], ['birds', 'Aves'], ['mammals', 'Mammalia'],
  ['reptiles_amphibians', 'Reptilia,Amphibia'], ['insects', 'Insecta'],
  ['fungi', 'Fungi'], ['fish', 'Actinopterygii'],
];

export async function lifeAcross(bbox, { perGroup = 40 } = {}) {
  const [w, s, e, n] = bbox;
  const base = { nelat: n, nelng: e, swlat: s, swlng: w, quality_grade: 'research' };
  const out = { source: 'iNaturalist research-grade observations', groups: {} };

  for (const [key, iconic] of GROUPS) {
    try {
      const { data, stale } = await getJSON(
        `${INAT}/observations/species_counts?${qs({ ...base, iconic_taxa: iconic, per_page: perGroup })}`,
        { ttlMs: 1000 * 60 * 60 * 24 * 30, timeout: 60000 });
      out.groups[key] = {
        species_recorded: data?.total_results ?? 0,
        stale: !!stale,
        most_observed: (data?.results ?? []).map((x) => ({
          observations: x.count,
          scientific_name: x.taxon?.name,
          common_name: x.taxon?.preferred_common_name ?? null,
          taxon_id: x.taxon?.id,
          wikipedia: x.taxon?.wikipedia_url ?? null,
        })),
      };
    } catch (err) { out.groups[key] = { error: err.message }; }
    await pause(600);                       // be a good citizen of a free API
  }

  // Threatened species are recorded, but their locations are not. The protocol
  // is explicit that sensitive species locations must not be published, so the
  // dossier carries names and status only, marked restricted.
  try {
    const { data } = await getJSON(
      `${INAT}/observations/species_counts?${qs({ ...base, threatened: true, per_page: 40 })}`,
      { ttlMs: 1000 * 60 * 60 * 24 * 30, timeout: 60000 });
    out.threatened = {
      sensitivity: 'restricted',
      note: 'Names and status only. Locations are deliberately not stored — the protocol ' +
            'forbids publishing sensitive species locations without permission.',
      count: data?.total_results ?? 0,
      species: (data?.results ?? []).map((x) => ({
        scientific_name: x.taxon?.name,
        common_name: x.taxon?.preferred_common_name ?? null,
        observations: x.count,
      })),
    };
  } catch (err) { out.threatened = { error: err.message }; }

  return out;
}

// ── culture ───────────────────────────────────────────────────────────────
/**
 * Deliberately NOT downloaded.
 *
 * The protocol says cultural knowledge, sacred places and Indigenous knowledge
 * require explicit permission from the holder, that no Elder speaks for a whole
 * nation without confirmation, and that restricted knowledge must not be fed to
 * AI systems without documented consent. Bulk-fetching a territory map into 967
 * files and calling it "culture" would break all three at once.
 *
 * So this section ships as a consultation slot: who to ask, what the chapter
 * must do first, and an empty place for what is shared WITH permission.
 */
export function cultureSlot(r) {
  return {
    status: 'not_downloaded_by_design',
    why: 'Cultural knowledge and Indigenous knowledge are not open data. They belong to ' +
         'people, who decide what may be recorded, shared or kept private.',
    before_you_record_anything: [
      'Identify the Indigenous nations whose territory this is, from them — not from a map.',
      'Contact the Tribal Historic Preservation Office, not a website.',
      'Relationship before request. Clear invitation. Informed consent. Fair compensation.',
      'Agree what may be recorded, what may be shared, and what must never leave the place.',
      'Agree benefit sharing before, not after.',
    ],
    where_to_start: [
      { name: 'NATHPO — Tribal Historic Preservation Officers directory', url: 'https://www.nathpo.org/thpos/' },
      { name: 'Native Land Digital — a starting point for conversation, explicitly not authoritative',
        url: 'https://native-land.ca/' },
      { name: 'US Bureau of Indian Affairs — tribal leaders directory',
        url: 'https://www.bia.gov/service/tribal-leaders-directory' },
    ],
    recorded_with_permission: [],
    sensitivity: 'restricted',
    region: r.name,
  };
}

// ── compile ───────────────────────────────────────────────────────────────
/**
 * Build or refresh a dossier. Only sections past their cadence are fetched,
 * so running this daily costs almost nothing and running it offline costs
 * nothing at all.
 */
export async function compile(code, { scheme = 'epa-l4', force = false, sections = null, onProgress } = {}) {
  const r = region(code, { scheme });
  if (!r) return { error: `no region ${code} in scheme ${scheme}` };

  const existing = loadDossier(r.code, scheme);
  const want = sections ?? (force ? Object.keys(CADENCE_DAYS) : staleSections(existing));
  const d = existing ?? {
    schema_version: 1,
    scheme, code: r.code, name: r.name,
    created_at: new Date().toISOString(),
    sections: {},
  };
  d.identity = {
    scheme, code: r.code, name: r.name,
    level3_code: r.level3_code ?? r.code, level3_name: r.level3_name ?? r.name,
    division: r.division, biome: r.biome, states: r.states,
    bbox: r.bbox, centroid: r.centroid,
  };
  d.sections.identity = { fetched_at: new Date().toISOString(), sources: SECTION_SOURCES.identity };

  if (!want.length) {
    writeDossier(r, scheme, d);
    return { region: r.code, name: r.name, unchanged: true, dossier: d };
  }

  const points = d.sample_points?.length && !force
    ? d.sample_points
    : await samplePoints(r);
  d.sample_points = points;
  const p0 = points[0];
  const say = (s) => onProgress?.(s);

  const stamp = (name, payload) => {
    const ids = SECTION_SOURCES[name] ?? [];
    d[name] = payload;
    d.sections[name] = { fetched_at: new Date().toISOString(), sources: ids };
    for (const id of ids) { try { markFetched(id); } catch { /* source not yet synced */ } }
  };

  if (want.includes('life')) {
    say('life');
    stamp('life', await lifeAcross(r.bbox));
  }
  if (want.includes('climate')) {
    say('climate');
    stamp('climate', await safe(() => climateAverages(p0.lat, p0.lng)));
  }
  if (want.includes('soil')) {
    say('soil');
    const profiles = [];
    for (const pt of points) {
      const g = await safe(() => groundProfile(pt.lat, pt.lng));
      if (g && !g.error) profiles.push({ at: [pt.lat, pt.lng], ...g });
      await pause(400);
    }
    stamp('soil', { sampled_points: profiles.length, profiles });
  }
  if (want.includes('water')) {
    say('water');
    const water = [];
    for (const pt of points.slice(0, 2)) {
      const h = await safe(() => hydrologyHere(pt.lat, pt.lng, { radiusKm: 25 }));
      if (h && !h.error) water.push({ at: [pt.lat, pt.lng], ...h });
      await pause(400);
    }
    stamp('water', { sampled_points: water.length, readings: water });
  }
  if (want.includes('resources')) {
    say('resources');
    stamp('resources', await safe(() => communityHere(p0.lat, p0.lng, { radiusKm: 25 })));
  }
  if (want.includes('hazards')) {
    say('hazards');
    stamp('hazards', await safe(() => hazardsHere(p0.lat, p0.lng)));
  }
  if (!d.culture) d.culture = cultureSlot(r);

  const path = writeDossier(r, scheme, d);
  return { region: r.code, name: r.name, refreshed: want, bytes: statSync(path).size, dossier: d };
}

/** Stamp attribution from the registry and write. Never touches the network. */
function writeDossier(r, scheme, d) {
  // Backfill: a dossier written before sources were declared here keeps its
  // fetched_at but gains the source ids, so an older file becomes correctly
  // attributed without refetching anything.
  for (const [section, ids] of Object.entries(SECTION_SOURCES)) {
    const sec = d.sections?.[section];
    if (sec && !sec.sources) { sec.sources = ids; delete sec.source; }
  }
  const used = Object.entries(SECTION_SOURCES)
    .filter(([section]) => d.sections?.[section])
    .flatMap(([, ids]) => ids);
  d.attribution = attributionFor([...new Set(used)]);
  d.updated_at = new Date().toISOString();
  const path = dossierPath(r.code, scheme);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(d, null, 1));
  return path;
}

async function safe(fn) {
  try { return await fn(); } catch (err) { return { error: err.message }; }
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ── coverage ──────────────────────────────────────────────────────────────
export function coverage() {
  const all4 = regions().length, all3 = regions({ scheme: 'epa-l3' }).length;
  const count = (scheme) => {
    const dir = join(DOSSIER_DIR, scheme);
    if (!existsSync(dir)) return { downloaded: 0, bytes: 0, stale: 0 };
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    let bytes = 0, stale = 0;
    for (const f of files) {
      const p = join(dir, f);
      bytes += statSync(p).size;
      try { if (staleSections(JSON.parse(readFileSync(p, 'utf8'))).length) stale++; } catch { stale++; }
    }
    return { downloaded: files.length, bytes, stale };
  };
  const l4 = count('epa-l4'), l3 = count('epa-l3');
  return {
    level4: { ...l4, total: all4, percent: Math.round((l4.downloaded / all4) * 100) },
    level3: { ...l3, total: all3, percent: Math.round((l3.downloaded / all3) * 100) },
    total_bytes: l4.bytes + l3.bytes,
    estimated_full_bytes: l4.downloaded ? Math.round((l4.bytes / l4.downloaded) * all4) : null,
  };
}
