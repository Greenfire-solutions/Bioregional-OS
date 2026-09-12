// ── Settlement, care, skills and flows ────────────────────────────────────
// Atlas layers 7, 8, 9 and 10 — four layers, one query.
//
// What a commons needs to know about the people already in it: where care can
// be reached, what is already organized, who makes and repairs things, and how
// food, materials and energy move. Nearly all of it is in OpenStreetMap, which
// means it is ODbL, keyless, global, and already maintained by people who live
// there. The rest is the chapter's own work.
//
// ONE TAG LESSON, LEARNED BEFORE SHIPPING AND WORTH KEEPING: `amenity=shelter`
// in OSM is a bus shelter, a gazebo or a pergola. Around Barton Creek it matches
// 135 objects and NOT ONE of them is a refuge. Mapping that onto "care
// infrastructure" would have told a chapter it has 135 shelters when it has
// none — confident, plausible, and completely wrong. A refuge is
// `amenity=social_facility` with `social_facility=shelter`. The categories below
// are built from what the tags MEAN, not from what they sound like.
import { getJSON, qs } from './http.mjs';
import { markFetched } from './registry.mjs';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const WEEK = 1000 * 60 * 60 * 24 * 7;

/**
 * Every category, with the Atlas layer it belongs to and the OSM selector that
 * finds it. Declared once: the query, the partitioning and the layer report all
 * read this, so a category cannot exist in the query and be missing from the map.
 */
export const CATEGORIES = [
  // ── Layer 7 · human settlement and accessibility ──
  { key: 'transit', layer: 7, label: 'Transit', selector: '["highway"="bus_stop"]', match: (t) => t.highway === 'bus_stop' },
  { key: 'transit_station', layer: 7, label: 'Stations', selector: '["public_transport"="station"]', match: (t) => t.public_transport === 'station' },
  { key: 'school', layer: 7, label: 'Schools', selector: '["amenity"~"^(school|kindergarten|college|university)$"]', match: (t) => ['school', 'kindergarten', 'college', 'university'].includes(t.amenity) },
  { key: 'civic', layer: 7, label: 'Civic buildings', selector: '["amenity"~"^(townhall|post_office|police|fire_station|courthouse)$"]', match: (t) => ['townhall', 'post_office', 'police', 'fire_station', 'courthouse'].includes(t.amenity) },

  // ── Layer 8 · care and essential systems ──
  { key: 'health', layer: 8, label: 'Health care', selector: '["amenity"~"^(clinic|doctors|hospital|dentist|pharmacy)$"]', match: (t) => ['clinic', 'doctors', 'hospital', 'dentist', 'pharmacy'].includes(t.amenity) },
  // social_facility carries the sub-type that actually says what it is.
  { key: 'food_aid', layer: 8, label: 'Food aid', selector: '["social_facility"~"^(food_bank|soup_kitchen)$"]', match: (t) => ['food_bank', 'soup_kitchen'].includes(t.social_facility) },
  { key: 'refuge', layer: 8, label: 'Shelter and refuge', selector: '["social_facility"~"^(shelter|group_home|outreach)$"]', match: (t) => ['shelter', 'group_home', 'outreach'].includes(t.social_facility) },
  { key: 'elder_care', layer: 8, label: 'Elder and assisted care', selector: '["social_facility"~"^(nursing_home|assisted_living|day_care)$"]', match: (t) => ['nursing_home', 'assisted_living', 'day_care'].includes(t.social_facility) },
  { key: 'childcare', layer: 8, label: 'Childcare', selector: '["amenity"="childcare"]', match: (t) => t.amenity === 'childcare' },
  { key: 'gathering', layer: 8, label: 'Community rooms', selector: '["amenity"~"^(community_centre|library|social_centre)$"]', match: (t) => ['community_centre', 'library', 'social_centre'].includes(t.amenity) },
  { key: 'water_point', layer: 8, label: 'Public water', selector: '["amenity"~"^(drinking_water|water_point)$"]', match: (t) => ['drinking_water', 'water_point'].includes(t.amenity) },

  // ── Layer 9 · skills, spaces, tools, institutions ──
  { key: 'makerspace', layer: 9, label: 'Maker and hackerspaces', selector: '["leisure"="hackerspace"]', match: (t) => t.leisure === 'hackerspace' },
  { key: 'craft', layer: 9, label: 'Trades and crafts', selector: '["craft"]', match: (t) => !!t.craft },
  { key: 'repair', layer: 9, label: 'Repair', selector: '["shop"~"^(repair|hardware|doityourself|electronics_repair)$"]', match: (t) => ['repair', 'hardware', 'doityourself', 'electronics_repair'].includes(t.shop) },
  { key: 'reuse', layer: 9, label: 'Reuse and exchange', selector: '["shop"~"^(second_hand|charity)$"]', match: (t) => ['second_hand', 'charity'].includes(t.shop) },

  // ── Layer 10 · food, energy, material, money, information flows ──
  { key: 'market', layer: 10, label: 'Markets', selector: '["amenity"="marketplace"]', match: (t) => t.amenity === 'marketplace' },
  { key: 'food_retail', layer: 10, label: 'Local food', selector: '["shop"~"^(farm|greengrocer|bakery|butcher|dairy)$"]', match: (t) => ['farm', 'greengrocer', 'bakery', 'butcher', 'dairy'].includes(t.shop) },
  { key: 'community_garden', layer: 10, label: 'Community gardens', selector: '["garden:type"="community"]', match: (t) => t['garden:type'] === 'community' },
  { key: 'allotment', layer: 10, label: 'Allotments', selector: '["landuse"="allotments"]', match: (t) => t.landuse === 'allotments' },
  { key: 'recycling', layer: 10, label: 'Recycling and reuse', selector: '["amenity"="recycling"]["recycling_type"="centre"]', match: (t) => t.amenity === 'recycling' && t.recycling_type === 'centre' },
  // Split deliberately. `power=generator` matches every mapped rooftop solar
  // panel — 242 of them within 3 km of Barton Creek against 2 substations — so
  // lumping them together made "energy infrastructure" the largest category in
  // the whole layer and the headline read "most numerous: energy infrastructure
  // (244)". True, and useless. Distributed generation is a real and interesting
  // bioregional fact; it is just not a substation.
  { key: 'energy', layer: 10, label: 'Energy infrastructure', selector: '["power"~"^(plant|substation)$"]', match: (t) => ['plant', 'substation'].includes(t.power) },
  { key: 'distributed_generation', layer: 10, label: 'Rooftop and small-scale generation', selector: '["power"="generator"]', match: (t) => t.power === 'generator', count_only: true },
];

const BY_LAYER = (n) => CATEGORIES.filter((c) => c.layer === n);

/** Everything layers 7-10 can say about a point, in one Overpass round trip. */
export async function communityHere(lat, lng, { radiusKm = 3, limit = 600 } = {}) {
  const d = radiusKm / 111;
  const bbox = [lat - d, lng - d, lat + d, lng + d].map((v) => v.toFixed(4)).join(',');
  const body = `[out:json][timeout:60];(\n` +
    CATEGORIES.map((c) => `nwr${c.selector}(${bbox});`).join('\n') +
    `\n);out center tags ${limit};`;

  let data, cached, stale;
  try {
    ({ data, cached, stale } = await getJSON(`${OVERPASS}?${qs({ data: body })}`, { ttlMs: WEEK, timeout: 75000 }));
  } catch (err) {
    return { available: false, reason: `Overpass did not answer (${err.message})`, source: null };
  }
  markFetched('openstreetmap');

  const elements = data?.elements ?? [];
  const found = new Map(CATEGORIES.map((c) => [c.key, []]));
  let uncategorised = 0;

  for (const el of elements) {
    const t = el.tags ?? {};
    const cat = CATEGORIES.find((c) => c.match(t));
    if (!cat) { uncategorised++; continue; }
    const pt = el.center ?? el;
    found.get(cat.key).push({
      name: t.name ?? null,
      osm: `${el.type}/${el.id}`,
      lat: pt.lat ?? null, lng: pt.lon ?? null,
      // Opening hours and wheelchair access are the two tags that decide whether
      // a thing on a map is actually reachable by the person who needs it.
      hours: t.opening_hours ?? null,
      wheelchair: t.wheelchair ?? null,
      phone: t.phone ?? t['contact:phone'] ?? null,
      operator: t.operator ?? null,
    });
  }

  const categories = CATEGORIES.map((c) => ({
    key: c.key, label: c.label, layer: c.layer,
    count: found.get(c.key).length,
    // Some categories are a number, not a list. Two hundred unnamed rooftop
    // panels as map pins is noise; "242 mapped within 3 km" is a fact.
    items: c.count_only ? [] : found.get(c.key).slice(0, 25),
    count_only: !!c.count_only,
  })).filter((c) => c.count > 0);

  const byLayer = {};
  for (const n of [7, 8, 9, 10]) {
    byLayer[n] = categories.filter((c) => c.layer === n).reduce((s, c) => s + c.count, 0);
  }

  return {
    available: true,
    source: 'OpenStreetMap via Overpass (ODbL)',
    source_id: 'openstreetmap',
    attribution: '© OpenStreetMap contributors (ODbL)',
    cached: !!cached, stale: !!stale,
    radius_km: radiusKm,
    categories,
    by_layer: byLayer,
    total: categories.reduce((s, c) => s + c.count, 0),
    // A tally the map does not show is a tally somebody will eventually wonder
    // about, so the leftovers are counted rather than dropped.
    uncategorised,
    truncated: elements.length >= limit
      ? `Overpass returned the ${limit}-object cap — there is more here than this.` : null,
    // Nobody should read this as a directory. OSM is maintained by volunteers and
    // a clinic that closed last year can sit on the map for years.
    caveat: 'Community-maintained map data. Good for finding what exists; never a substitute ' +
            'for ringing ahead, and absence here is not evidence of absence.',
    readable: readableCommunity(categories, byLayer, radiusKm),
  };
}

/** Just one layer's worth, when that is all that is wanted. */
export async function layerHere(lat, lng, layerNo, opts = {}) {
  const all = await communityHere(lat, lng, opts);
  if (!all.available) return all;
  const cats = all.categories.filter((c) => c.layer === layerNo);
  return {
    ...all,
    categories: cats,
    total: cats.reduce((s, c) => s + c.count, 0),
    layer: layerNo,
  };
}

/** Which of layers 7-10 this point actually has anything for. */
export function layersCovered(result) {
  if (!result?.available) return [];
  return [7, 8, 9, 10].filter((n) => (result.by_layer?.[n] ?? 0) > 0);
}

function readableCommunity(categories, byLayer, radiusKm) {
  if (!categories.length) return `Nothing mapped within ${radiusKm} km — which may mean nothing is there, or that nobody has mapped it.`;
  const care = categories.filter((c) => c.layer === 8);
  // Rank on things a person could walk to, so a count-only category never
  // becomes the headline. No `?? categories[0]` here: falling back to a
  // count-only category would reinstate exactly the headline this is avoiding,
  // and it would do it silently. If there is nothing walkable, say so.
  const walkable = [...categories].filter((c) => !c.count_only).sort((a, b) => b.count - a.count);
  const top = walkable[0] ?? null;
  const careLine = care.length
    ? `${care.reduce((s, c) => s + c.count, 0)} places to reach care or gather`
    : 'no care infrastructure mapped';
  const head = `Within ${radiusKm} km: ${careLine}, ${byLayer[10] ?? 0} in the food and materials economy, ` +
               `${byLayer[9] ?? 0} making or repairing things.`;
  return top
    ? `${head} Most numerous: ${top.label.toLowerCase()} (${top.count}).`
    : `${head} Nothing here is mapped as somewhere a person could go.`;
}

export { BY_LAYER };
