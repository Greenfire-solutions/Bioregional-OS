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

/** An Offers & Wants profile from an intake item — how a need reaches the network. */
export function offerWantProfile(item, chapter, { primaryUrl } = {}) {
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

/** Persist discovered peers without duplicating what we already track. */
export function recordPeers(peers) {
  let added = 0;
  for (const p of peers) {
    if (!p.url) continue;
    const seen = one('SELECT id FROM federation_peers WHERE url = ?', p.url);
    if (seen) continue;
    run(
      `INSERT INTO federation_peers (id,name,kind,protocol,url,bioregion_name,status,last_synced_at)
       VALUES (?,?,?,?,?,?,?,datetime('now'))`,
      `peer_${Math.random().toString(36).slice(2, 10)}`,
      p.name, 'chapter', 'murmurations', p.url, p.locality ?? null, 'known'
    );
    added++;
  }
  return added;
}
