// ── Locality discovery ────────────────────────────────────────────────────
// Atlas layers, found rather than enumerated.
//
// Every other adapter here is a RESOLVER: give it a point, it returns a value.
// This one is a DISCOVERER: give it a place and a subject, and it returns
// datasets — things somebody's own city or county already publishes about the
// ground they live on.
//
// That difference matters because the alternative does not scale. Austin's open
// data portal carries "Watershed Reach Integrity Scores" for Barton Creek; no
// federal feed has it, and nobody could have guessed the name. The equivalent
// exists for thousands of localities under names nobody can guess either. A
// hardcoded list serves one chapter. Asking the catalogue serves every chapter,
// including the ones that do not exist yet — and a bioregional tool should get
// SHARPER the more local you are, not vaguer.
//
// Two catalogues, both keyless:
//   • Socrata Discovery API — indexes Socrata portals, and carries a real
//     licence string, which is the only reason auto-approval is possible at all.
//   • ArcGIS Hub — indexes ArcGIS portals, and does NOT carry a usable licence.
//     See classifyLicense: its `license` field is 'none' or 'custom' almost
//     everywhere, and 'none' means "nobody filled this in", never "free to use".
import { getJSON, qs } from './http.mjs';
import { markFetched } from './registry.mjs';

const SOCRATA = 'https://api.us.socrata.com/api/catalog/v1';
const ARCGIS = 'https://hub.arcgis.com/api/v3/datasets';
const DAY = 1000 * 60 * 60 * 24;

// ── the licence gate ───────────────────────────────────────────────────────

/**
 * Only an unambiguous public-domain dedication may be auto-approved.
 *
 * This function is the whole safety story of this adapter, so it is an
 * ALLOWLIST and nothing else reaches 'public_domain'. The failure that matters
 * is not missing a public-domain dataset — that costs one human glance. It is
 * auto-publishing something whose terms nobody read, into an export that leaves
 * the machine.
 *
 * The specific trap, verified against live data: ArcGIS Hub returns the literal
 * string 'none' for the overwhelming majority of its datasets. That means "no
 * licence was recorded", which is the OPPOSITE of public domain — absent a
 * licence, the default is all rights reserved. Anything that reads 'none' as
 * 'no restrictions' would auto-publish most of the ArcGIS catalogue. Likewise
 * 'custom', and ArcGIS's structuredLicense.text, which in practice is a
 * liability disclaimer rather than a grant of rights.
 */
export function classifyLicense(raw) {
  const text = String(raw ?? '').trim();
  const norm = text.toLowerCase().replace(/[\s_]+/g, ' ').replace(/[.,;]+$/, '');

  // Absent is not permissive. This branch is first on purpose.
  if (!norm || norm === 'none' || norm === 'null' || norm === 'n/a' || norm === 'unknown'
      || norm === 'custom' || norm === 'other' || norm === 'not specified') {
    return {
      class: 'unknown', auto_approvable: false, raw: text || null, matched: null,
      why: text
        ? `the portal recorded the licence as "${text}", which records an absence rather than a permission`
        : 'the portal recorded no licence at all — and absent a licence the default is all rights reserved, not free to use',
    };
  }

  for (const [pattern, label] of PUBLIC_DOMAIN) {
    if (pattern.test(norm)) {
      return {
        class: 'public_domain', auto_approvable: true, raw: text, matched: label,
        why: `recognised as a public-domain dedication (${label})`,
      };
    }
  }
  for (const [pattern, label] of OPEN_WITH_CONDITIONS) {
    if (pattern.test(norm)) {
      return {
        class: 'open_with_conditions', auto_approvable: false, raw: text, matched: label,
        why: `open, but with conditions a person has to accept on the commons' behalf (${label})`,
      };
    }
  }
  return {
    class: 'unrecognised', auto_approvable: false, raw: text, matched: null,
    why: `the licence "${text}" is not one this OS knows how to read, so somebody has to`,
  };
}

/**
 * Auto-approvable. Every entry is either a dedication by the rights holder or a
 * statement that the work carries no copyright — never a third party's guess.
 */
const PUBLIC_DOMAIN = [
  [/^(u\.?s\.? )?public domain( \(.*\))?$/, 'public domain'],
  [/^public domain (mark|dedication)/, 'public domain mark'],
  [/\bcc0\b/, 'CC0'],
  [/creativecommons\.org\/publicdomain\/(zero|mark)\//, 'CC0 / PD mark URI'],
  [/^pddl(-1\.0)?$/, 'ODC PDDL'],
  [/open data commons public domain/, 'ODC PDDL'],
  [/^(works? of the )?(u\.?s\.?|united states) government\b.*public domain/, 'US government work'],
  [/^no (known )?copyright/, 'no known copyright'],
];

/** Open, but someone has to accept the terms — attribution, share-alike, non-commercial. */
const OPEN_WITH_CONDITIONS = [
  [/\bcc[- ]by[- ]nc/, 'CC-BY-NC (NonCommercial)'],
  [/\bcc[- ]by[- ]sa/, 'CC-BY-SA (ShareAlike)'],
  [/\bcc[- ]by\b/, 'CC-BY (attribution)'],
  [/\bodbl\b|open database licen[cs]e/, 'ODbL'],
  [/\bodc[- ]by\b/, 'ODC-BY'],
  [/open government licen[cs]e/, 'Open Government Licence'],
  [/\bapache|\bmit licen|\bgpl\b/, 'software licence applied to data'],
];

// ── finding the portals for a place ────────────────────────────────────────

/**
 * Which open-data portals serve this locality.
 * The catalogue has no "near here" filter, so the locality name is the query and
 * the portal domains in the answers are the result — which works because a
 * city's own portal ranks for its own name.
 */
export async function findPortals(locality, region = null, { limit = 4 } = {}) {
  const q = [locality, region].filter(Boolean).join(' ');
  if (!q.trim()) return [];
  const { data, cached, stale } = await getJSON(
    `${SOCRATA}?${qs({ q, limit: 40, only: 'dataset' })}`, { ttlMs: DAY * 30, timeout: 25000 });
  const counts = new Map();
  for (const r of data?.results ?? []) {
    const d = r?.metadata?.domain;
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  markFetched('socrata');
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([domain, hits]) => ({ domain, hits, cached: !!cached, stale: !!stale }));
}

// ── discovery ──────────────────────────────────────────────────────────────

/** The Atlas layer a subject most likely belongs to, so a candidate arrives pre-filed. */
const SUBJECT_LAYER = {
  // Water systems
  water: 3, creek: 3, stream: 3, river: 3, watershed: 3, waterway: 3, aquifer: 3,
  spring: 3, wetland: 3, drainage: 3, stormwater: 3, runoff: 3, riparian: 3,
  well: 3, sewer: 3, effluent: 3,
  // Land and soil
  soil: 4, geology: 4, geologic: 4, elevation: 4, topograph: 4, contour: 4,
  'land cover': 4, landcover: 4, erosion: 4, karst: 4, slope: 4,
  // Habitat and biodiversity
  tree: 5, canopy: 5, forest: 5, habitat: 5, wildlife: 5, species: 5,
  park: 5, preserve: 5, greenbelt: 5, vegetation: 5, pollinator: 5,
  // Climate stress and hazards
  climate: 6, heat: 6, wildfire: 6, hazard: 6, flood: 6, floodplain: 6,
  drought: 6, 'air quality': 6, emission: 6,
  // Human settlement and accessibility
  transit: 7, sidewalk: 7, bicycle: 7, road: 7, street: 7, housing: 7,
  census: 7, zoning: 7, parcel: 7, permit: 7, building: 7, address: 7,
  // Care and essential systems
  health: 8, clinic: 8, hospital: 8, shelter: 8, library: 8, 'emergency': 8,
  // Flows
  food: 10, garden: 10, farm: 10, energy: 10, solar: 10, waste: 10, recycl: 10,
  // Culture and memory
  historic: 11, heritage: 11, cemetery: 11, landmark: 11, archaeolog: 11,
};
/**
 * Which layer a candidate belongs to — decided by the DATASET, not by the search.
 *
 * Searching a portal for "creek" also returns library circulation figures,
 * because a portal's relevance ranking is its own business. Reading the layer
 * off the subject would then file a library dataset as a water layer, and since
 * it is public domain it would auto-approve straight onto the map. So the
 * dataset's own title and description have to name the subject; if they do not,
 * it gets no layer, and something with no layer is recorded but never mapped.
 * A candidate whose subject we cannot identify is not a candidate for the Atlas.
 */
export function layerFor(subject = '', title = '', description = '') {
  // Title first, then description. A word in the title is what the dataset IS;
  // a word in the description may be an aside, so it only decides when the
  // title is silent — and either way the matched term is returned so a person
  // can see why something landed on layer 6 and disagree with it.
  const t = String(title ?? '').toLowerCase();
  const dsc = String(description ?? '').toLowerCase();
  for (const [word, layer] of Object.entries(SUBJECT_LAYER)) {
    if (t.includes(word)) return { layer, matched: word, from: 'title' };
  }
  for (const [word, layer] of Object.entries(SUBJECT_LAYER)) {
    if (dsc.includes(word)) return { layer, matched: word, from: 'description' };
  }
  return { layer: null, matched: null, from: null };
}

/**
 * Datasets a locality publishes about a subject.
 * Returns candidates — never layers. Nothing here is registered; the engine
 * decides what happens next, and only a public-domain licence decides itself.
 */
export async function discover({ locality, region = null, subject, limit = 12 } = {}) {
  if (!subject) return { error: 'no_subject', message: 'Say what to look for — water, soil, trees, flooding, historic sites.' };
  if (!locality) return { error: 'no_locality', message: 'A locality name is what makes this local. Set one on the chapter, or pass one.' };

  const portals = await findPortals(locality, region).catch(() => []);
  const [socrata, arcgis] = await Promise.all([
    fromSocrata(portals.map((p) => p.domain), subject, limit).catch((e) => ({ error: e.message, results: [] })),
    fromArcGIS(locality, region, subject, limit).catch((e) => ({ error: e.message, results: [] })),
  ]);

  // What layer the SUBJECT implies, used to keep results that are genuinely about
  // it without demanding the word itself: "Waterway Setbacks" never says "creek"
  // and is exactly what somebody searching for creeks wants.
  const subjectFit = layerFor(subject, subject, '');

  const scored = [...(socrata.results ?? []), ...(arcgis.results ?? [])].map((c) => {
    const fit = layerFor(subject, c.title, c.description);
    const own = `${c.title ?? ''} ${c.description ?? ''}`.toLowerCase();
    const onSubject = own.includes(String(subject).toLowerCase())
      || (subjectFit.layer != null && fit.layer === subjectFit.layer);
    return { ...c, atlas_layer: fit.layer, layer_match: fit, on_subject: onSubject,
             license: classifyLicense(c.license_raw) };
  });

  // A catalogue ranks by its own relevance, and ArcGIS in particular will answer
  // "trees Asheville North Carolina" with anything about North Carolina. Keeping
  // those would mean telling somebody their city publishes eight datasets about
  // trees when it publishes none — a confident answer to a question that was
  // never actually answered, which is worse than an empty one.
  const candidates = scored.filter((c) => c.on_subject)
    .sort((a, b) => Number(b.license.auto_approvable) - Number(a.license.auto_approvable));
  const offSubject = scored.length - candidates.length;

  const auto = candidates.filter((c) => c.license.auto_approvable).length;
  return {
    locality, region, subject,
    portals: portals.map((p) => p.domain),
    candidates,
    counts: {
      total: candidates.length, public_domain: auto, needs_review: candidates.length - auto,
      off_subject_discarded: offSubject,
    },
    unreachable: [socrata.error, arcgis.error].filter(Boolean),
    readable: readableDiscovery({ locality, subject, candidates, auto, portals, offSubject }),
  };
}

async function fromSocrata(domains, subject, limit) {
  if (!domains.length) return { results: [] };
  const { data, cached, stale } = await getJSON(
    `${SOCRATA}?${qs({ domains: domains.join(','), q: subject, limit, only: 'dataset' })}`,
    { ttlMs: DAY * 7, timeout: 25000 });
  markFetched('socrata');
  return {
    cached: !!cached, stale: !!stale,
    results: (data?.results ?? []).map((r) => ({
      title: r.resource?.name ?? null,
      description: (r.resource?.description ?? '').slice(0, 400) || null,
      publisher: r.resource?.attribution ?? r.metadata?.domain ?? null,
      portal: r.metadata?.domain ?? null,
      portal_type: 'socrata',
      source_url: r.permalink ?? r.link ?? null,
      api_url: r.resource?.id && r.metadata?.domain
        ? `https://${r.metadata.domain}/resource/${r.resource.id}.geojson` : null,
      license_raw: r.metadata?.license ?? null,
      updated_at: r.resource?.updatedAt ?? null,
    })),
  };
}

async function fromArcGIS(locality, region, subject, limit) {
  const q = [subject, locality, region].filter(Boolean).join(' ');
  const { data, cached, stale } = await getJSON(
    `${ARCGIS}?${qs({ q, 'page[size]': Math.min(limit, 20) })}`, { ttlMs: DAY * 7, timeout: 30000 });
  markFetched('arcgis-hub');
  return {
    cached: !!cached, stale: !!stale,
    results: (data?.data ?? []).map((x) => {
      const a = x.attributes ?? {};
      return {
        title: a.name ?? null,
        description: (a.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 400) || null,
        publisher: a.source ?? a.owner ?? null,
        portal: 'ArcGIS Hub',
        portal_type: 'arcgis',
        source_url: a.slug ? `https://hub.arcgis.com/datasets/${a.slug}` : null,
        api_url: null,
        // Deliberately NOT structuredLicense.text: in practice that field holds a
        // liability disclaimer, and reading a disclaimer as a grant of rights is
        // exactly the mistake this whole gate exists to prevent.
        license_raw: a.license ?? null,
        updated_at: a.itemModified ? new Date(a.itemModified).toISOString() : null,
      };
    }),
  };
}

function readableDiscovery({ locality, subject, candidates, auto, portals, offSubject = 0 }) {
  // Saying which is which matters: "no portal" is a fact about the locality and
  // "the portal has nothing" is a fact about the subject, and a person can act
  // on the second but only shrug at the first.
  const noPortal = !portals.length
    ? `No open-data portal is indexed for ${locality}, so only the global catalogue was searched.`
    : null;

  if (!candidates.length) {
    const tail = offSubject
      ? ` ${offSubject} result${offSubject === 1 ? ' was' : 's were'} returned but none were actually about ${subject}.`
      : '';
    return (noPortal ?? `${portals[0]} publishes nothing about ${subject}.`) + tail;
  }

  const top = candidates[0];
  const where = top.portal && top.portal !== 'ArcGIS Hub' ? top.portal : (top.publisher ?? 'a local publisher');
  return ((noPortal ? noPortal + ' ' : '') +
         `${where} publishes ${candidates.length} dataset${candidates.length === 1 ? '' : 's'} about ${subject}` +
         `, starting with "${top.title}"` +
         (auto ? ` — ${auto} in the public domain and ready to use.`
               : ' — none public domain, so each one needs a person to read its terms.')
        ).replace(/\s{2,}/g, ' ');
}
