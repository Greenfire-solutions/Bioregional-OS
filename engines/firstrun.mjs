// ── The first sixty seconds ───────────────────────────────────────────────
// One question — where are you? — answered with everything this OS can find
// out about that point, before it asks for anything at all.
//
// Two rules shape this file:
//
//   1. IT WRITES NOTHING. `lookAround()` touches no table. A person can see
//      their ecoregion, their watershed, the ground under them and the creek
//      nearest them without creating an account, a chapter, or a row. The
//      product promise is delivered before any commitment is asked for, which
//      is the whole argument of docs/DAILY_USE.md §7.
//
//   2. IT DOES NOT SKIP THE GATE. `beginHere()` still requires the chapter to
//      say what it does and does NOT represent. That refusal is the first line
//      of the protocol and a smooth onboarding is not a reason to move it.
//      Unbounded claims of representation are the first failure mode of
//      place-based organizing, and the easiest moment to make one is the
//      moment somebody is excited and typing fast.
//
// Before this existed, a new person's first screen was somebody else's commons
// in Austin. That is an excellent demo and a poor beginning.
import { one, create } from '../core/db.mjs';
import * as geocode from '../adapters/geocode.mjs';
import { resolveEcoregion } from '../adapters/ecoregion.mjs';
import { resolveWatershed } from '../adapters/watershed.mjs';
import { skyToday } from '../adapters/sky.mjs';
import { weatherNow } from '../adapters/weather.mjs';
import { groundProfile } from '../adapters/soil.mjs';
import { lifeHere } from '../adapters/life.mjs';
import * as bio from './bioregional.mjs';
import { nearestGageContext } from './ground.mjs';
import { attributionFor } from '../adapters/registry.mjs';

/**
 * What is true about a point, gathered live and kept in memory.
 *
 * `depth: 'quick'` answers in a couple of seconds — the boundaries, the sky,
 * the weather and the nearest gage. `depth: 'full'` adds the soil under the
 * place and what lives around it, which are the two most striking answers and
 * also the two slowest, so the interface asks for them second.
 */
export async function lookAround({ query = null, lat = null, lng = null, depth = 'quick' } = {}) {
  let place = null;
  let alternatives = [];

  if (lat == null || lng == null) {
    if (!query) return { error: 'no_location', message: 'Give a place name, or a latitude and longitude.' };
    const found = await geocode.search(query, { limit: 5 });
    if (!found.results.length) {
      return {
        error: 'not_found',
        message: found.error ?? `Nothing found for "${query}". A town, a creek, or a road junction all work.`,
      };
    }
    // More than one plausible answer is a question for the person, not a guess.
    [place, ...alternatives] = found.results;
    place.geocoder = found.source;
    place.geocoder_id = found.source_id ?? null;
  } else {
    place = { name: null, lat: Number(lat), lng: Number(lng) };
    const named = await geocode.reverse(place.lat, place.lng).catch(() => null);
    if (named) place = { ...named, lat: place.lat, lng: place.lng };
  }

  const { lat: y, lng: x } = place;
  const sky = skyToday(y, x);

  const jobs = [
    resolveEcoregion(y, x).catch(() => null),
    resolveWatershed(y, x).catch(() => null),
    weatherNow(y, x).catch((e) => ({ available: false, reason: e.message })),
    nearestGageContext(y, x).catch(() => null),
  ];
  if (depth === 'full') {
    jobs.push(groundProfile(y, x).catch(() => null), lifeHere(y, x, { radiusKm: 10 }).catch(() => null));
  }
  const [ecoregion, watershed, weather, water, ground = null, life = null] = await Promise.all(jobs);

  const out = {
    place: {
      name: place.name, detail: place.detail ?? null,
      lat: y, lng: x,
      locality: place.locality ?? null, region: place.region ?? null, country: place.country ?? null,
      geocoder: place.geocoder ?? place.source ?? null,
      // The licence moved out of the adapter's prose and into the registry,
      // which is right — but the credit a person actually sees is the half with
      // legal weight, and ODbL requires it. Resolve it rather than reprinting it.
      geocoder_credit: credit(place.geocoder_id),
    },
    alternatives,
    ecoregion, watershed, sky, weather, water, ground, life,
    depth,
    wrote_nothing: true,
  };
  out.lines = reveal(out);
  return out;
}

/**
 * The reveal, as sentences rather than fields.
 * Ordered so the first one is the one a person repeats to somebody else.
 */
function reveal(g) {
  const lines = [];
  const eco = g.ecoregion;
  const wshed = g.watershed;

  if (eco?.ecoregion_name || wshed?.watershed_name) {
    const where = [
      eco?.ecoregion_name ? `the **${eco.ecoregion_name}**` : null,
      wshed?.watershed_name ? `the **${wshed.watershed_name}** watershed` : null,
    ].filter(Boolean).join(', in ');
    lines.push({ kind: 'place', text: `You are in ${where}.` });
    if (eco?.biome) lines.push({ kind: 'place', text: `Biome: ${eco.biome}.` });
  } else {
    // EPA ecoregions and USGS watersheds are United States services. Outside
    // their coverage the reveal still opens with where you are, and says what
    // is missing and how to fix it, rather than quietly starting with soil.
    const where = [g.place.locality, g.place.region, g.place.country].filter(Boolean).join(', ');
    lines.push({ kind: 'place', text: where ? `You are at ${g.place.name}, ${where}.` : `You are at ${g.place.name}.` });
    lines.push({
      kind: 'gap',
      text: 'Ecoregion and watershed boundaries here need the global ecoregion file — ' +
            'RESOLVE Ecoregions 2017, CC-BY, dropped into data/upstream/. ' +
            'The EPA and USGS services that answer instantly only cover the United States.',
    });
  }

  if (g.ground?.soil?.readable) {
    lines.push({ kind: 'ground', text: `The ground under you: ${g.ground.soil.readable}` });
  }
  if (g.ground?.elevation?.elevation_m != null) {
    const m = Math.round(g.ground.elevation.elevation_m);
    lines.push({ kind: 'ground', text: `${m} m above sea level${g.ground.land_cover?.class ? ` · ${g.ground.land_cover.class}` : ''}.` });
  }

  const w = g.water;
  if (w?.current != null) {
    const val = w.current === 0 ? 'dry' : `${fmt(w.current)} ${unit(w.unit)}`.trim();
    // When the reading IS the standing ("dry"), the standing already says it.
    const standing = w.standing && !w.standing.startsWith(val) ? `, ${w.standing}` : '';
    const said = w.current === 0 && w.standing ? w.standing : `${val}${standing}`;
    lines.push({
      kind: 'water',
      text: `Your nearest gage — ${w.site_name}${w.km_away != null ? `, ${w.km_away} km away` : ''} — is ${said}` +
            (w.years_of_record ? `, across ${w.years_of_record} years of record.` : '.'),
    });
  }

  if (g.life?.species?.available && g.life.species.top?.length) {
    // `name` is now guaranteed by the adapter and `name_is` says whether it is a
    // common name or a binomial, so there is nothing left to fall back to. The
    // `??` that used to be here was dead code wearing the costume of a
    // safeguard, which is worse than none because it stops anyone looking.
    const names = g.life.species.top.slice(0, 4).map((s) => s.name).filter(Boolean);
    if (names.length) lines.push({ kind: 'life', text: `Most recorded around you: ${names.join(', ')}.` });
  } else if (g.life?.readable) {
    lines.push({ kind: 'life', text: g.life.readable });
  }

  const alert = g.weather?.alerts?.[0];
  if (alert) lines.push({ kind: 'hazard', text: `${alert.event} in effect right now.` });
  else if (g.weather?.available && g.weather.current?.summary) {
    const t = g.weather.current.temperature_f;
    lines.push({
      kind: 'weather',
      text: `Right now: ${g.weather.current.summary.toLowerCase()}${t != null ? `, ${Math.round(t)}°F` : ''}.`,
    });
  }

  // Always last, and always present — it is the one line that needs no network.
  lines.push({
    kind: 'sky',
    text: g.sky.polar
      ? `The sun does not set here today.`
      : `Sunset is at ${clock(g.sky.sunset, g.weather?.timezone)}, and the day is ${g.sky.daylight_change}.`,
  });

  return lines;
}

/**
 * Found a chapter at a point, and resolve it properly on the way in.
 *
 * The two representation questions are not optional here for the same reason
 * they are not optional in `create_chapter` — this is simply the first place a
 * person meets them.
 */
export async function beginHere({
  chapter_id = null, chapter_name, represents, does_not_represent,
  scale = 'site', place_name, lat, lng, locality = null, region = null, country = null,
} = {}) {
  if (!chapter_name) return { error: 'missing', message: 'The chapter needs a name.' };
  if (!represents?.trim() || !does_not_represent?.trim()) {
    return {
      error: 'representation_required',
      message: 'A chapter must say what it represents AND what it does not. Unbounded claims of ' +
               'representation are the first failure mode of place-based organizing, so this is ' +
               'asked once, at the start, rather than argued about later.',
    };
  }
  if (lat == null || lng == null) return { error: 'missing', message: 'A chapter needs a point on the ground.' };

  const id = (chapter_id || slug(chapter_name)).slice(0, 48);
  if (one('SELECT id FROM chapters WHERE id=?', id)) {
    return { error: 'exists', message: `A chapter called "${id}" is already here.` };
  }

  create('chapters', 'chapter', id, {
    id, name: chapter_name, scale,
    represents: represents.trim(), does_not_represent: does_not_represent.trim(),
    lat: Number(lat), lng: Number(lng), locality, region, country,
  });

  const placeId = `plac_${Math.random().toString(16).slice(2, 10)}`;
  create('places', 'place', placeId, {
    id: placeId, chapter_id: id,
    name: place_name || chapter_name,
    region: region ?? null,
    lat: Number(lat), lng: Number(lng),
  });

  // Resolve it against the real world immediately — a place without a watershed
  // and an ecoregion fails the Minimum Viable Chapter Test on day one.
  const located = await bio.locate(placeId).catch((e) => ({ error: e.message }));

  return {
    chapter: one('SELECT * FROM chapters WHERE id=?', id),
    place: one('SELECT * FROM places WHERE id=?', placeId),
    located,
    next: 'Open Today. The land will tell you something before it asks you for anything.',
  };
}

/** Attribution for a source id, from the one registry that holds licences. */
function credit(id) {
  if (!id) return null;
  return attributionFor([id])[0]?.attribution ?? null;
}

const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'chapter';
const fmt = (n) => (n == null ? '' : n >= 100 ? Math.round(n).toLocaleString() : String(Math.round(n * 10) / 10));
/** USGS writes cubic feet per second as "ft3/s". People read ft³/s. */
const unit = (u) => (u ?? '').replace('ft3/s', 'ft\u00B3/s');
/** Formatted in the timezone of the PLACE when we know it, this machine's otherwise. */
const clock = (iso, timeZone = null) => {
  if (!iso) return '—';
  const opts = { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) };
  try { return new Date(iso).toLocaleTimeString('en-US', opts); }
  catch { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
};
