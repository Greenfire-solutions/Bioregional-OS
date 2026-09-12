// ── Geocoding ─────────────────────────────────────────────────────────────
// Turning "Barton Creek Greenbelt, Austin TX" into a point, so the first sixty
// seconds can ask one question instead of two numbers.
//
// Two upstreams, both keyless:
//   1. Nominatim (OpenStreetMap, ODbL) — free-form, global, the only one that
//      understands a creek, a road junction or a farm name. Its usage policy
//      allows at most one request a second and requires a real User-Agent, and
//      both are honoured below. Nothing is bulk-downloaded; a person types a
//      place and gets back the coordinate they already knew.
//   2. Open-Meteo geocoding (CC-BY-4.0) — a gazetteer of settlements. Narrower,
//      but it answers when Nominatim is rate-limited or down.
//
// Reverse geocoding exists for the other door: the browser hands over a
// coordinate and the person should still see the name of where they are.
import { getJSON, qs } from './http.mjs';

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OPEN_METEO = 'https://geocoding-api.open-meteo.com/v1/search';

// Nominatim asks for no more than one request a second. This is a shared gate
// rather than a per-call sleep, so concurrent callers queue instead of racing.
let lastCall = 0;
async function polite() {
  const wait = 1100 - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

/**
 * Candidate places for what somebody typed. Always a list, because "Springfield"
 * is a real answer with fourteen right answers and the person should pick.
 */
export async function search(query, { limit = 5 } = {}) {
  const q = String(query ?? '').trim();
  if (q.length < 2) return { results: [], source: null };

  try {
    await polite();
    const { data, stale } = await getJSON(
      `${NOMINATIM}/search?${qs({ format: 'jsonv2', limit, q, addressdetails: 1 })}`,
      { ttlMs: 1000 * 60 * 60 * 24 * 30, timeout: 15000 });
    const results = (Array.isArray(data) ? data : []).map(fromNominatim).filter(Boolean);
    if (results.length) {
      return { results, source: 'OpenStreetMap / Nominatim (ODbL)', stale: !!stale };
    }
  } catch { /* fall through */ }

  try {
    const { data } = await getJSON(
      `${OPEN_METEO}?${qs({ name: q, count: limit, language: 'en', format: 'json' })}`,
      { ttlMs: 1000 * 60 * 60 * 24 * 30, timeout: 15000 });
    return {
      results: (data?.results ?? []).map((r) => ({
        name: r.name,
        detail: [r.admin1, r.country].filter(Boolean).join(', '),
        lat: r.latitude, lng: r.longitude,
        locality: r.name, region: r.admin1 ?? null, country: r.country ?? null,
        kind: 'settlement',
      })),
      source: 'Open-Meteo geocoding (CC-BY-4.0)',
    };
  } catch (err) {
    return { results: [], source: null, error: `no geocoder reachable (${err.message})` };
  }
}

/** The name of a coordinate — for the "use where I am" door. */
export async function reverse(lat, lng) {
  try {
    await polite();
    const { data } = await getJSON(
      `${NOMINATIM}/reverse?${qs({ format: 'jsonv2', lat, lon: lng, zoom: 14, addressdetails: 1 })}`,
      { ttlMs: 1000 * 60 * 60 * 24 * 30, timeout: 15000 });
    const one = fromNominatim(data);
    return one ? { ...one, source: 'OpenStreetMap / Nominatim (ODbL)' } : null;
  } catch {
    return null;
  }
}

function fromNominatim(r) {
  if (!r?.lat || !r?.lon) return null;
  const a = r.address ?? {};
  const locality = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.suburb ?? a.county ?? null;
  const full = String(r.display_name ?? '');
  // The first comma-separated part is the name; the rest is the answer to "which one?"
  const [head, ...rest] = full.split(',').map((p) => p.trim());
  return {
    name: r.name || head || locality || 'Unnamed place',
    detail: rest.slice(0, 3).join(', ') || null,
    lat: Number(r.lat), lng: Number(r.lon),
    locality,
    region: a.state ?? a.region ?? null,
    country: a.country ?? null,
    kind: r.type ?? r.category ?? null,
  };
}
