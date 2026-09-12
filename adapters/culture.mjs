// ── Culture, history and community memory ─────────────────────────────────
// Atlas layer 11 — the one that was still empty after two research sweeps.
//
// A bioregion has a written memory and almost no community knows it. The creek
// appeared in newspapers a century ago; somebody has published research about
// this watershed; there are markers and ruins on it that OSM already knows. All
// of it is open, keyless, and about THIS place.
//
// And it has a sound. iNaturalist carries field recordings of the birds, frogs
// and insects of a specific watershed, each with its own licence.
//
// ── THE LICENCE RULE THAT SHAPES THIS FILE ────────────────────────────────
// A recording's MEDIA licence is a different field from its observation's
// licence, and the default is CC-BY-NC. Sampled live near Barton Creek:
// cc-by-nc 41, cc-by 2, and 2 with no licence at all.
//
// Three consequences, all enforced below rather than remembered:
//   1. CC-BY-NC cannot be redistributed by this project — the same call
//      INTEROP.md already made for One Earth Bioregions. So audio is LINKED at
//      its source and never copied, vendored or bundled. The OS hosts nothing.
//   2. Nothing carrying media may leave the machine. An export or a shared card
//      is redistribution. Facts about the recordings travel; the recordings
//      do not. `export_safe` says which is which on every block.
//   3. A recording with a null licence is NOT permissive, it is unlicensed —
//      the same absent-branch-first trap as ArcGIS's 'none'. Null is excluded
//      before anything else is considered.
import { getJSON, qs } from './http.mjs';
import { markFetched } from './registry.mjs';
import { displayName } from './life.mjs';

const INAT = 'https://api.inaturalist.org/v1';
const LOC = 'https://www.loc.gov/collections/chronicling-america/';
const OPENALEX = 'https://api.openalex.org/works';
const WIKI = 'https://en.wikipedia.org/w/api.php';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const MONTH = 1000 * 60 * 60 * 24 * 30;

// ── the media licence gate ─────────────────────────────────────────────────

/** Openly licensed enough to stream from its own host, with attribution. */
const STREAMABLE = new Set(['cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-sa', 'cc-by-nd', 'cc-by-nc-nd']);
/** Openly licensed enough that a copy could travel. Nothing NonCommercial is here. */
const REDISTRIBUTABLE = new Set(['cc0', 'cc-by', 'cc-by-sa']);

/**
 * What may be done with one piece of media. Absent is handled first and
 * excluded, because an unlicensed recording is all rights reserved — it is not
 * "no restrictions", it is no permission.
 */
export function mediaRights(licenseCode) {
  const code = String(licenseCode ?? '').trim().toLowerCase();
  if (!code || code === 'null' || code === 'none') {
    return { code: null, streamable: false, redistributable: false,
             why: 'no licence on the recording, which means all rights reserved — not free to use' };
  }
  if (!STREAMABLE.has(code)) {
    return { code, streamable: false, redistributable: false, why: `licence "${code}" is not one this OS knows how to honour` };
  }
  return {
    code,
    streamable: true,
    redistributable: REDISTRIBUTABLE.has(code),
    why: REDISTRIBUTABLE.has(code)
      ? `${code} — may be played and may travel, with attribution`
      : `${code} — may be played from its own host, but NonCommercial or ND terms mean no copy of it leaves this machine`,
  };
}

// ── the sound of a watershed ───────────────────────────────────────────────

/**
 * Field recordings made near a point.
 * Returns links, never files. Every item carries its own attribution because
 * every one of them is somebody's recording.
 */
export async function soundsHere(lat, lng, { radiusKm = 15, limit = 30, months = null } = {}) {
  const params = {
    lat: Number(lat).toFixed(4), lng: Number(lng).toFixed(4), radius: radiusKm,
    sounds: true, quality_grade: 'research', per_page: Math.min(limit, 100),
    order_by: 'observed_on', order: 'desc',
  };
  if (months) params.month = months.join(',');

  const { data, cached, stale } = await getJSON(`${INAT}/observations?${qs(params)}`,
    { ttlMs: MONTH, timeout: 30000 });
  if (!data) return { available: false, reason: 'no answer from iNaturalist', source: null };
  markFetched('inaturalist');

  const recordings = [];
  let unlicensed = 0;
  for (const o of data.results ?? []) {
    for (const snd of o.sounds ?? []) {
      const rights = mediaRights(snd.license_code);
      if (!rights.streamable) { unlicensed++; continue; }
      // One naming rule, imported rather than restated — see life.mjs.
      const named = displayName(o.taxon);
      recordings.push({
        species: named.name,
        species_name_is: named.name_is,
        common_name: named.common_name,
        scientific_name: named.scientific_name,
        observed_on: o.observed_on ?? null,
        recordist: snd.attribution ?? o.user?.name ?? o.user?.login ?? null,
        licence: rights.code,
        redistributable: rights.redistributable,
        // A URL, never a file. The OS hosts nothing and copies nothing.
        listen_url: snd.file_url ?? null,
        observation_url: o.uri ?? null,
        place_guess: o.place_guess ?? null,
      });
    }
  }

  const byMonth = {};
  for (const r of recordings) {
    const m = (r.observed_on ?? '').slice(0, 7);
    if (m) byMonth[m] = (byMonth[m] ?? 0) + 1;
  }
  const species = [...new Set(recordings.map((r) => r.species).filter(Boolean))];

  return {
    available: true,
    source: 'iNaturalist field recordings',
    source_id: 'inaturalist',
    cached: !!cached, stale: !!stale,
    radius_km: radiusKm,
    total_nearby: data.total_results ?? recordings.length,
    recordings,
    species,
    by_month: byMonth,
    excluded_unlicensed: unlicensed,
    // Pre-chewed for anything that has to state the fact without carrying the
    // media — a weekly card, a printed sheet, a message in a group chat. These
    // are facts about recordings, not recordings, so they travel freely.
    species_count: species.length,
    most_recent: recordings[0]
      ? { species: recordings[0].species, species_name_is: recordings[0].species_name_is,
          common_name: recordings[0].common_name, scientific_name: recordings[0].scientific_name,
          observed_on: recordings[0].observed_on }
      : null,
    card_fact: recordings.length
      ? `${data.total_results ?? recordings.length} field recordings from within ${radiusKm} km` +
        (recordings[0]?.species ? `, most recently ${recordings[0].species}` : '') +
        (recordings[0]?.observed_on ? ` on ${recordings[0].observed_on}` : '')
      : null,
    // The block as a whole cannot travel; the facts about it can.
    export_safe: false,
    export_note:
      'Recordings are linked at their own host and never copied. Most are CC-BY-NC, which this ' +
      'project does not redistribute — so no audio may enter an export, a card or anything else ' +
      'that leaves this machine. Counts, species and dates are facts and may travel freely.',
    readable: recordings.length
      ? `${data.total_results ?? recordings.length} field recordings within ${radiusKm} km — ` +
        `${species.length} species, most recently ${recordings[0].species ?? 'an unidentified caller'}` +
        `${recordings[0].observed_on ? ` on ${recordings[0].observed_on}` : ''}.`
      : `No field recordings within ${radiusKm} km yet.`,
  };
}

// ── what was written here ──────────────────────────────────────────────────

/**
 * Search terms for a place, longest first.
 *
 * A place row is named for people — "Barton Creek Greenbelt Reach" — and an
 * archive is indexed on what things were called. Searching the full label found
 * nothing, while "Barton Creek" has 235 newspaper pages behind it. So the full
 * name is tried first and shorter forms after, and the answer always reports
 * WHICH term found it: a result for a broader term is a weaker claim about this
 * exact place, and the reader should be able to see that rather than be told
 * "Barton Creek" when they asked about a particular reach of it.
 */
export function searchTerms(placeName) {
  const name = String(placeName ?? '').trim();
  if (!name) return [];
  const terms = [name];
  // Drop trailing administrative or descriptive words a newspaper never used.
  const trimmed = name.replace(
    /\s+(reach|greenbelt|commons|chapter|district|preserve|watershed|area|zone|site|park|trail|corridor)\b/gi, '').trim();
  if (trimmed && trimmed !== name) terms.push(trimmed);
  const words = trimmed.split(/\s+/);
  if (words.length > 2) terms.push(words.slice(0, 2).join(' '));
  return [...new Set(terms)];
}

/** Historic newspapers mentioning a place, from the Library of Congress. */
export async function inThePapers(placeName, { limit = 8 } = {}) {
  if (!placeName) return { available: false, reason: 'no place name to search for', source: null };
  let data = null, cached = false, stale = false, used = null, widened = false;
  const terms = searchTerms(placeName);
  for (const term of terms) {
    const r = await getJSON(
      `${LOC}?${qs({ q: `"${term}"`, fo: 'json', c: Math.min(limit, 20), at: 'results,pagination' })}`,
      { ttlMs: MONTH, timeout: 35000 });
    used = term;
    if (r.data?.results?.length) { data = r.data; cached = r.cached; stale = r.stale; widened = term !== terms[0]; break; }
    data = r.data; cached = r.cached; stale = r.stale;
  }
  const results = data?.results ?? [];
  markFetched('chronicling-america');
  const years = results.map((r) => String(r.date ?? '').slice(0, 4)).filter(Boolean).map(Number).filter(Number.isFinite);
  return {
    available: true,
    source: 'Chronicling America, Library of Congress (public domain)',
    source_id: 'chronicling-america',
    cached: !!cached, stale: !!stale,
    export_safe: true,          // public domain, all of it
    total: data?.pagination?.of ?? results.length,
    earliest_year: years.length ? Math.min(...years) : null,
    searched_for: used,
    // A hit on a broader term is a weaker claim about this exact place.
    widened_from: widened ? placeName : null,
    pages: results.map((r) => ({
      title: r.title ?? null,
      newspaper: Array.isArray(r.partof_title) ? r.partof_title[0] : (r.partof_title ?? null),
      date: r.date ?? null,
      url: r.id ?? r.url ?? null,
    })),
    readable: results.length
      ? `"${used}" appears on ${data?.pagination?.of ?? results.length} digitised newspaper pages` +
        `${years.length ? `, the earliest from ${Math.min(...years)}` : ''}` +
        `${widened ? ` (searched more broadly than "${placeName}")` : ''}.`
      : `"${placeName}" does not appear in the digitised newspapers.`,
  };
}

/** Research about this place. Most communities have no idea it exists. */
export async function researchAbout(placeName, { limit = 8 } = {}) {
  if (!placeName) return { available: false, reason: 'no place name to search for', source: null };
  let data = null, cached = false, stale = false, used = null, widened = false;
  for (const term of searchTerms(placeName)) {
    const r = await getJSON(
      `${OPENALEX}?${qs({ filter: `title.search:${term}`, per_page: Math.min(limit, 25), sort: 'cited_by_count:desc' })}`,
      { ttlMs: MONTH, timeout: 30000 });
    used = term; data = r.data; cached = r.cached; stale = r.stale;
    if (r.data?.results?.length) { widened = term !== searchTerms(placeName)[0]; break; }
  }
  markFetched('openalex');
  const works = data?.results ?? [];
  return {
    available: true,
    source: 'OpenAlex', source_id: 'openalex',
    cached: !!cached, stale: !!stale,
    export_safe: true,
    total: data?.meta?.count ?? works.length,
    searched_for: used,
    widened_from: widened ? placeName : null,
    works: works.map((w) => ({
      title: w.display_name ?? null,
      year: w.publication_year ?? null,
      cited_by: w.cited_by_count ?? 0,
      // Open access first: a citation a chapter cannot read is not much use.
      open_access_url: w.best_oa_location?.landing_page_url ?? w.open_access?.oa_url ?? null,
      doi: w.doi ?? null,
    })),
    open_access_count: works.filter((w) => w.open_access?.is_oa).length,
    readable: works.length
      ? `${data?.meta?.count ?? works.length} research papers name ${used}` +
        `, ${works.filter((w) => w.open_access?.is_oa).length} of the top ${works.length} readable without a subscription` +
        `${widened ? ` (searched more broadly than "${placeName}")` : ''}.`
      : `No research names ${placeName}.`,
  };
}

// ── what is standing here ──────────────────────────────────────────────────

/** Markers, ruins, memorials and named sites on the ground. */
export async function historicHere(lat, lng, { radiusKm = 5, limit = 60 } = {}) {
  const d = radiusKm / 111;
  const bbox = [lat - d, lng - d, lat + d, lng + d].map((v) => v.toFixed(4)).join(',');
  const body = `[out:json][timeout:45];(nwr["historic"](${bbox});nwr["heritage"](${bbox});` +
               `nwr["amenity"="grave_yard"](${bbox});nwr["landuse"="cemetery"](${bbox}););out center tags ${limit};`;
  let data, cached, stale;
  try {
    ({ data, cached, stale } = await getJSON(`${OVERPASS}?${qs({ data: body })}`, { ttlMs: MONTH, timeout: 60000 }));
  } catch (err) {
    return { available: false, reason: `Overpass did not answer (${err.message})`, source: null };
  }
  markFetched('openstreetmap');
  const sites = (data?.elements ?? []).map((el) => {
    const t = el.tags ?? {}; const pt = el.center ?? el;
    return {
      name: t.name ?? null,
      kind: t.historic ?? (t.heritage ? 'heritage site' : (t.landuse === 'cemetery' || t.amenity === 'grave_yard' ? 'cemetery' : null)),
      inscription: t.inscription ?? null,
      year: t.start_date ?? t['historic:date'] ?? null,
      wikidata: t.wikidata ?? null,
      lat: pt.lat ?? null, lng: pt.lon ?? null,
    };
  }).filter((s) => s.name || s.kind);
  return {
    available: true,
    source: 'OpenStreetMap via Overpass', source_id: 'openstreetmap',
    cached: !!cached, stale: !!stale, export_safe: true,
    sites, total: sites.length,
    readable: sites.length
      ? `${sites.length} marked historic site${sites.length === 1 ? '' : 's'} within ${radiusKm} km` +
        `${sites.find((s) => s.name) ? `, including ${sites.find((s) => s.name).name}` : ''}.`
      : `Nothing historic is mapped within ${radiusKm} km.`,
  };
}

/** Wikipedia articles anchored to this ground. */
export async function articlesHere(lat, lng, { radiusM = 5000, limit = 12 } = {}) {
  const { data, cached, stale } = await getJSON(
    `${WIKI}?${qs({ action: 'query', list: 'geosearch', gscoord: `${Number(lat).toFixed(5)}|${Number(lng).toFixed(5)}`,
                    gsradius: Math.min(radiusM, 10000), gslimit: Math.min(limit, 50), format: 'json' })}`,
    { ttlMs: MONTH, timeout: 25000 });
  markFetched('wikipedia');
  const pages = data?.query?.geosearch ?? [];
  return {
    available: true,
    source: 'Wikipedia GeoSearch', source_id: 'wikipedia',
    cached: !!cached, stale: !!stale, export_safe: true,
    articles: pages.map((p) => ({
      title: p.title, distance_m: Math.round(p.dist),
      url: `https://en.wikipedia.org/?curid=${p.pageid}`,
    })),
    readable: pages.length
      ? `${pages.length} Wikipedia article${pages.length === 1 ? '' : 's'} are anchored within ${radiusM / 1000} km, nearest "${pages[0].title}".`
      : 'No Wikipedia articles are anchored to this ground.',
  };
}

// ── all of layer 11 ────────────────────────────────────────────────────────

export async function cultureHere(lat, lng, { placeName = null, radiusKm = 5 } = {}) {
  const [historic, articles, papers, research, sounds] = await Promise.all([
    historicHere(lat, lng, { radiusKm }).catch(fail),
    articlesHere(lat, lng, { radiusM: radiusKm * 1000 }).catch(fail),
    placeName ? inThePapers(placeName).catch(fail) : Promise.resolve(null),
    placeName ? researchAbout(placeName).catch(fail) : Promise.resolve(null),
    soundsHere(lat, lng, { radiusKm: Math.max(radiusKm, 15) }).catch(fail),
  ]);
  const parts = [historic, articles, papers, research, sounds].filter((p) => p?.available);
  return {
    place_name: placeName, radius_km: radiusKm,
    historic, articles, papers, research, sounds,
    // One flag the whole way up: if anything in here cannot leave, the block cannot.
    export_safe: parts.every((p) => p.export_safe !== false),
    export_note: sounds?.available ? sounds.export_note : null,
    readable: parts.map((p) => p.readable).filter(Boolean).join(' '),
  };
}

const fail = (err) => ({ available: false, reason: err?.message ?? String(err), source: null });
