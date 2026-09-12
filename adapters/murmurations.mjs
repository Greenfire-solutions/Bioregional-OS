// ── Murmurations Protocol adapter ─────────────────────────────────────────
// Upstream: MurmurationsNetwork (GPL-3.0) — index + library + schemas.
// This is the piece that lets a chapter be *discovered by* and *discover*
// the wider regenerative-economy network without anyone owning the directory.
// Protocol: you host a JSON profile at a URL, post that URL to the Index,
// aggregators read it. We generate the profile; you publish it.
import { getJSON, qs } from './http.mjs';
import { all, one, run } from '../core/db.mjs';

export const INDEX = 'https://index.murmurations.network/v2';
export const LIBRARY = 'https://library.murmurations.network/v2';

/** Build a Murmurations organizations-schema profile for a chapter. */
export function chapterProfile(chapter, { primaryUrl } = {}) {
  const url = primaryUrl || chapter.murmurations_primary_url;
  return {
    linked_schemas: ['organizations_schema-v1.0.0'],
    name: chapter.name,
    primary_url: url || undefined,
    description: [chapter.provisional_scope, chapter.represents].filter(Boolean).join(' — ') || undefined,
    mission: chapter.represents || undefined,
    latitude: chapter.lat ?? undefined,
    longitude: chapter.lng ?? undefined,
    locality: chapter.locality || undefined,
    region: chapter.region || undefined,
    country_name: chapter.country || undefined,
    tags: ['bioregional', 'commons', 'regenerative', chapter.scale].filter(Boolean),
  };
}

/**
 * An Offers & Wants profile from an intake item — how a need reaches the network.
 *
 * REFUSES a private item, and that refusal is the whole point of the function
 * having one. `intake.private` is honoured in the listing route, in the tool
 * that reads intake, and in the sensitivity it is filed at — and was not
 * honoured HERE, in the one place that publishes to a world-readable global
 * index that cannot be un-published. A need marked private is marked private
 * because it carries somebody's personal circumstances.
 *
 * The index is real and it is open: the live Murmurations index serves
 * thousands of profiles unauthenticated, with geolocation a first-class indexed
 * field, and removal is best-effort because aggregators may already have copied
 * the record. Federation is one-way with respect to erasure, which makes this
 * the wrong gate to leave to the caller.
 */
export function offerWantProfile(item, chapter, { primaryUrl } = {}) {
  if (item?.private) {
    return {
      error: 'private',
      message: 'This need is marked private. It stays in the commons — it does not go to a ' +
               'public index that cannot take it back.',
    };
  }
  return {
    linked_schemas: ['offers_wants_schema-v1.0.0'],
    title: item.body.slice(0, 100),
    description: item.body,
    offers_wants: item.kind === 'resource' || item.kind === 'opportunity' ? 'offer' : 'want',
    primary_url: primaryUrl || chapter.murmurations_primary_url || undefined,
    geolocation: chapter.lat != null ? { lat: chapter.lat, lon: chapter.lng } : undefined,
    tags: ['bioregional', item.kind],
  };
}

/** Validate a generated profile against the live Murmurations Library. */
export async function validate(profile) {
  const res = await fetch(`${LIBRARY}/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(profile),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

/** Post a hosted profile URL to the Index so aggregators can find it. */
export async function postToIndex(profileUrl) {
  const res = await fetch(`${INDEX}/nodes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profile_url: profileUrl }),
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

/**
 * Find other nodes in the network near this chapter — the federation discovery
 * path. Returns peers ready to be written into federation_peers.
 */
export async function discoverNearby({ lat, lng, range = '100km', schema = 'organizations_schema-v1.0.0', tags } = {}) {
  const params = { schema, page_size: 100 };
  if (lat != null && lng != null) { params.lat = lat; params.lon = lng; params.range = range; }
  if (tags) params.tags = tags;
  const { data, stale } = await getJSON(`${INDEX}/nodes?${qs(params)}`, { ttlMs: 1000 * 60 * 60 * 6 });
  const nodes = data?.data ?? [];
  return {
    stale: !!stale,
    peers: nodes.map((n) => ({
      name: n.name || n.profile_url,
      url: n.profile_url,
      lat: n.latitude ?? null,
      lng: n.longitude ?? null,
      locality: n.locality ?? null,
      tags: n.tags ?? [],
    })),
  };
}

/**
 * What a discovered node actually is, read from what it published.
 *
 * The index answers a geographic query with every organisation near the point —
 * asked around Austin it returns a taxi co-operative, a web host, a copywriting
 * agency and an individual researcher. Recording all of those as *chapters*,
 * which is what this did, makes the federation table assert something the data
 * never said, and the interface then repeats it to a person as fact.
 *
 * A bioregional chapter is identifiable because chapterProfile() publishes
 * `tags: ['bioregional', 'commons', 'regenerative', <scale>]`. Everything else
 * is an organisation that happens to be nearby, which is genuinely useful to
 * know and is simply not the same thing.
 *
 * Nothing is guessed from a NAME. "Hill Country Bioregional Network" reads like
 * a chapter and may be a mailing list; the tags are a claim its publisher made,
 * and that is the only evidence there is.
 */
export function classifyPeer({ tags = [], name = '' } = {}) {
  const t = new Set((tags ?? []).map((x) => String(x).toLowerCase().trim()));
  if (t.has('bioregional') && (t.has('commons') || t.has('regenerative'))) return 'chapter';
  if (t.has('index') || t.has('registry')) return 'registry';
  if (t.has('network') || t.has('federation')) return 'network';
  return tags?.length ? 'organisation' : 'unknown';
}

/** Persist discovered peers without duplicating what we already track. */
export function recordPeers(peers) {
  let added = 0;
  for (const p of peers) {
    if (!p.url) continue;
    const seen = one('SELECT id FROM federation_peers WHERE url = ?', p.url);
    if (seen) continue;
    run(
      `INSERT INTO federation_peers (id,name,kind,protocol,url,bioregion_name,status,tags,last_synced_at)
       VALUES (?,?,?,?,?,?,?,?,datetime('now'))`,
      `peer_${Math.random().toString(36).slice(2, 10)}`,
      p.name, classifyPeer(p), 'murmurations', p.url, p.locality ?? null, 'known',
      p.tags?.length ? JSON.stringify(p.tags) : null
    );
    added++;
  }
  return added;
}
